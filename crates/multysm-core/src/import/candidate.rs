//! Turns SPICE definitions into importable part candidates.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::category::guess_category;
use super::spice::{DefKind, Definition, SpiceFile};
use super::symbols::{symbol_for, GeneratedSymbol};
use crate::library::spice_policy::check_spice_text;
use crate::library::{Category, Param, ParamKind};
use crate::si::parse_si;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PartKind {
    Diode,
    Bjt,
    Mosfet,
    Jfet,
    Subckt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateStatus {
    Ready,
    AlreadyImported,
    Unsupported,
    Unsafe,
    MissingDependency,
}

impl CandidateStatus {
    pub fn importable(self) -> bool {
        matches!(self, CandidateStatus::Ready | CandidateStatus::AlreadyImported)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// `<file index>:<name>`, unique within one preview.
    pub key: String,
    pub name: String,
    /// File-name and id friendly form of `name`.
    pub slug: String,
    pub kind: Option<PartKind>,
    /// Upper-case `.model` type; `None` for subcircuits.
    pub model_type: Option<String>,
    pub category: Category,
    /// File name the definition came from.
    pub source: String,
    pub ref_prefix: String,
    pub template: String,
    pub params: Vec<Param>,
    pub symbol: GeneratedSymbol,
    /// The definition and its dependencies, dependencies first.
    #[serde(skip)]
    pub model_text: String,
    pub description: Option<String>,
    pub status: CandidateStatus,
    pub messages: Vec<String>,
    /// Ticked by default in the preview.
    pub selected: bool,
    /// Pack id holding an earlier import of the same model name.
    pub replaces: Option<String>,
}

/// Lower case, every run of other characters becomes `_`, trimmed of `_`.
pub fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

fn param_key(name: &str) -> String {
    let s = slug(name);
    if s.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && s != "ref" { s } else { format!("p_{s}") }
}

fn device_kind(model_type: &str) -> Option<(PartKind, &'static str, &'static str)> {
    Some(match model_type {
        "D" => (PartKind::Diode, "D", "{ref} {pin.A} {pin.K}"),
        "NPN" | "PNP" => (PartKind::Bjt, "Q", "{ref} {pin.C} {pin.B} {pin.E}"),
        "NMOS" | "PMOS" => (PartKind::Mosfet, "M", "{ref} {pin.D} {pin.G} {pin.S} {pin.S}"),
        "VDMOS" => (PartKind::Mosfet, "M", "{ref} {pin.D} {pin.G} {pin.S}"),
        "NJF" | "PJF" => (PartKind::Jfet, "J", "{ref} {pin.D} {pin.G} {pin.S}"),
        _ => return None,
    })
}

pub fn build_candidates(files: &[(String, SpiceFile)], existing: &BTreeMap<String, String>) -> Vec<Candidate> {
    // First definition of a name across all files wins.
    let mut defs: BTreeMap<String, &Definition> = BTreeMap::new();
    let mut origin: BTreeMap<String, usize> = BTreeMap::new();
    for (index, (_, file)) in files.iter().enumerate() {
        for def in &file.definitions {
            let upper = def.name.to_ascii_uppercase();
            if !defs.contains_key(&upper) {
                defs.insert(upper.clone(), def);
                origin.insert(upper, index);
            }
        }
    }
    let helpers: BTreeSet<String> = defs.values().flat_map(|d| d.subckt_refs.iter().cloned()).collect();

    let mut candidates = Vec::new();
    for (index, (source, file)) in files.iter().enumerate() {
        for def in &file.definitions {
            let upper = def.name.to_ascii_uppercase();
            if origin.get(&upper) != Some(&index) {
                continue;
            }
            candidates.push(candidate(index, source, def, &defs, &helpers, existing));
        }
    }
    candidates
}

fn candidate(
    index: usize,
    source: &str,
    def: &Definition,
    defs: &BTreeMap<String, &Definition>,
    helpers: &BTreeSet<String>,
    existing: &BTreeMap<String, String>,
) -> Candidate {
    let upper = def.name.to_ascii_uppercase();
    let mut messages = Vec::new();
    let mut status = CandidateStatus::Ready;
    let mut params = Vec::new();

    let (kind, model_type, ref_prefix, template, ports) = match &def.kind {
        DefKind::Model { model_type } => match device_kind(model_type) {
            Some((kind, prefix, pins)) => {
                (Some(kind), Some(model_type.clone()), prefix.to_string(), format!("{pins} {}", def.name), vec![])
            }
            None => {
                status = CandidateStatus::Unsupported;
                messages.push(format!("{model_type} models are not importable"));
                (None, Some(model_type.clone()), String::new(), String::new(), vec![])
            }
        },
        DefKind::Subckt { ports, params: defaults, nested } => {
            if *nested {
                status = CandidateStatus::Unsupported;
                messages.push("subcircuits defined inside other subcircuits are not supported".into());
            }
            let pins: Vec<String> = (1..=ports.len()).map(|i| format!("{{pin.{i}}}")).collect();
            let mut template = format!("X{{ref}} {} {}", pins.join(" "), def.name);
            let mut assignments = Vec::new();
            for (name, value) in defaults {
                if parse_si(value).is_err() {
                    continue;
                }
                let key = param_key(name);
                assignments.push(format!("{name}={{{key}}}"));
                params.push(Param {
                    key,
                    label: name.clone(),
                    unit: String::new(),
                    default: value.clone(),
                    kind: ParamKind::Si,
                    options: vec![],
                });
            }
            if !assignments.is_empty() {
                template.push_str(" PARAMS: ");
                template.push_str(&assignments.join(" "));
            }
            (Some(PartKind::Subckt), None, "U".to_string(), template, ports.clone())
        }
    };

    let mut model_text = String::new();
    if status == CandidateStatus::Ready {
        let mut order = Vec::new();
        let mut missing = BTreeSet::new();
        collect(&upper, defs, &mut BTreeSet::new(), &mut order, &mut missing);
        if missing.is_empty() {
            model_text = order.iter().map(|name| defs[name].text.as_str()).collect::<Vec<_>>().join("\n\n");
            if let Err(e) = check_spice_text(&model_text) {
                status = CandidateStatus::Unsafe;
                messages.push(format!("model text is not allowed: {e}"));
            }
        } else {
            status = CandidateStatus::MissingDependency;
            let names: Vec<String> = missing.into_iter().collect();
            messages.push(format!("uses {} which is not defined in the imported files", names.join(", ")));
        }
    }

    let replaces = existing.get(&upper).cloned();
    if status == CandidateStatus::Ready && replaces.is_some() {
        status = CandidateStatus::AlreadyImported;
        messages.push("already imported; tick to replace it".into());
    }

    let slug_name = slug(&def.name);
    let symbol = match kind {
        Some(kind) => symbol_for(kind, model_type.as_deref().unwrap_or(""), &slug_name, &ports),
        None => super::symbols::GeneratedSymbol { file_name: String::new(), svg: String::new(), width: 0, height: 0, pins: vec![] },
    };
    let description = (!def.comments.is_empty()).then(|| def.comments.join(" "));
    Candidate {
        key: format!("{index}:{}", def.name),
        name: def.name.clone(),
        slug: slug_name,
        kind,
        model_type,
        category: kind.map_or(Category::Misc, |k| guess_category(k, &def.name, &def.comments)),
        source: source.to_string(),
        ref_prefix,
        template,
        params,
        symbol,
        model_text,
        description,
        selected: status == CandidateStatus::Ready && !helpers.contains(&upper),
        status,
        messages,
        replaces,
    }
}

/// Post-order walk: dependencies are pushed before the definitions that use them.
fn collect(
    name: &str,
    defs: &BTreeMap<String, &Definition>,
    seen: &mut BTreeSet<String>,
    order: &mut Vec<String>,
    missing: &mut BTreeSet<String>,
) {
    if !seen.insert(name.to_string()) {
        return;
    }
    let Some(def) = defs.get(name) else {
        missing.insert(name.to_string());
        return;
    };
    for sub in &def.subckt_refs {
        collect(sub, defs, seen, order, missing);
    }
    for token in &def.tokens {
        if !def.subckt_refs.contains(token)
            && defs.get(token).is_some_and(|d| matches!(d.kind, DefKind::Model { .. }))
        {
            collect(token, defs, seen, order, missing);
        }
    }
    order.push(name.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::spice::parse_spice;
    use std::collections::BTreeMap;

    fn build(text: &str) -> Vec<Candidate> {
        build_candidates(&[("demo.lib".into(), parse_spice(text))], &BTreeMap::new())
    }

    fn by_name<'a>(cs: &'a [Candidate], name: &str) -> &'a Candidate {
        cs.iter().find(|c| c.name == name).unwrap_or_else(|| panic!("no candidate {name}"))
    }

    #[test]
    fn device_models_get_templates_and_pins() {
        let cs = build(".model D1 D(IS=1n)\n.model Q1 PNP(BF=80)\n.model M1 PMOS(VTO=-2)\n.model M2 VDMOS(VTO=3)\n.model J1 NJF(VTO=-2)\n");
        assert_eq!(by_name(&cs, "D1").template, "{ref} {pin.A} {pin.K} D1");
        assert_eq!(by_name(&cs, "D1").ref_prefix, "D");
        assert_eq!(by_name(&cs, "Q1").template, "{ref} {pin.C} {pin.B} {pin.E} Q1");
        assert_eq!(by_name(&cs, "M1").template, "{ref} {pin.D} {pin.G} {pin.S} {pin.S} M1");
        assert_eq!(by_name(&cs, "M2").template, "{ref} {pin.D} {pin.G} {pin.S} M2");
        assert_eq!(by_name(&cs, "J1").template, "{ref} {pin.D} {pin.G} {pin.S} J1");
        assert!(cs.iter().all(|c| c.status == CandidateStatus::Ready && c.selected));
        assert_eq!(by_name(&cs, "D1").model_text, ".model D1 D(IS=1n)");
    }

    #[test]
    fn unsupported_model_types_are_listed() {
        let cs = build(".model SW1 SW(VT=1)\n");
        assert_eq!(cs[0].status, CandidateStatus::Unsupported);
        assert!(!cs[0].selected);
        assert!(cs[0].messages[0].contains("SW"));
    }

    #[test]
    fn subcircuits_bring_their_dependencies_first() {
        let text = "\
* Dual op amp
.subckt AMP inp inn out PARAMS: GAIN=1e5 EXPR={2*K}
X1 inp inn mid STAGE
Q1 out mid 0 QX
.ends
.subckt STAGE a b c
R1 a c 1k
.ends
.model QX NPN(BF=50)
.model UNUSED D(IS=1)
";
        let cs = build(text);
        let amp = by_name(&cs, "AMP");
        assert_eq!(amp.template, "X{ref} {pin.1} {pin.2} {pin.3} AMP PARAMS: GAIN={gain}");
        assert_eq!(amp.params.len(), 1, "non-numeric defaults are not exposed");
        assert_eq!(amp.params[0].key, "gain");
        assert_eq!(amp.params[0].default, "1e5");
        let stage_at = amp.model_text.find(".subckt STAGE").unwrap();
        let qx_at = amp.model_text.find(".model QX").unwrap();
        let amp_at = amp.model_text.find(".subckt AMP").unwrap();
        assert!(stage_at < amp_at && qx_at < amp_at, "{}", amp.model_text);
        assert!(!amp.model_text.contains("UNUSED"));
        assert_eq!(amp.description.as_deref(), Some("Dual op amp"));
        assert_eq!(amp.category, Category::Analog, "from the \"Dual op amp\" comment");
        assert!(!by_name(&cs, "STAGE").selected, "helpers start unticked");
        assert_eq!(by_name(&cs, "STAGE").status, CandidateStatus::Ready);
    }

    #[test]
    fn missing_subcircuit_dependency() {
        let cs = build(".subckt TOP a b\nX1 a b NOWHERE\n.ends\n");
        assert_eq!(cs[0].status, CandidateStatus::MissingDependency);
        assert!(cs[0].messages[0].contains("NOWHERE"));
    }

    #[test]
    fn dependencies_resolve_across_files() {
        let files = vec![
            ("a.lib".to_string(), parse_spice(".subckt TOP a b\nX1 a b LOW\n.ends\n")),
            ("b.lib".to_string(), parse_spice(".subckt LOW a b\nR1 a b 1\n.ends\n")),
        ];
        let cs = build_candidates(&files, &BTreeMap::new());
        let top = cs.iter().find(|c| c.name == "TOP").unwrap();
        assert_eq!(top.status, CandidateStatus::Ready);
        assert_eq!(top.source, "a.lib");
        assert!(top.model_text.contains(".subckt LOW"));
    }

    #[test]
    fn unsafe_and_nested_definitions_are_blocked() {
        let cs = build(".subckt BAD a\nR1 a 0 {shell}\n.ends\n.subckt NEST a\n.subckt IN b\n.ends\n.ends\n");
        assert_eq!(by_name(&cs, "BAD").status, CandidateStatus::Unsafe);
        assert_eq!(by_name(&cs, "NEST").status, CandidateStatus::Unsupported);
    }

    #[test]
    fn already_imported_models_are_marked_and_unticked() {
        let existing = BTreeMap::from([("D1".to_string(), "imported-old".to_string())]);
        let cs = build_candidates(&[("x.lib".into(), parse_spice(".model d1 D(IS=1)\n"))], &existing);
        assert_eq!(cs[0].status, CandidateStatus::AlreadyImported);
        assert_eq!(cs[0].replaces.as_deref(), Some("imported-old"));
        assert!(!cs[0].selected);
    }

    #[test]
    fn keys_and_slugs_are_stable() {
        let cs = build(".subckt LM358/NOPB a b\nR1 a b 1\n.ends\n");
        assert_eq!(cs[0].key, "0:LM358/NOPB");
        assert_eq!(cs[0].slug, "lm358_nopb");
        assert_eq!(slug("7-Seg Driver"), "7_seg_driver");
    }
}
