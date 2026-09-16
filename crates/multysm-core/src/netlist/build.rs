//! Builds SPICE netlist text from a project, with pre-run checks.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use super::nets::{build_nets, Nets, GROUND};
use super::template::render;
use super::validate::{is_valid_reference, is_valid_text_param};
use super::{ErrorCode, NetlistError};
use crate::circuit::{Analysis, Project};
use crate::library::spice_policy::check_spice_text;
use crate::library::{Library, ParamKind, Spice};
use crate::si::{format_spice, parse_si};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Netlist {
    pub text: String,
    pub nets: Nets,
}

pub fn build_netlist(project: &Project, library: &Library) -> Result<Netlist, Vec<NetlistError>> {
    let nets = build_nets(project, library)?;
    let mut errors = Vec::new();

    if !nets.net_pins.contains_key(GROUND) {
        errors.push(NetlistError::new(
            ErrorCode::NoGround,
            "The circuit has no ground. Add a Ground part.".into(),
            None,
        ));
    }

    check_references(project, library, &mut errors);

    for inst in &project.components {
        if !matches!(inst.rot, 0 | 90 | 180 | 270) {
            errors.push(NetlistError::new(
                ErrorCode::InvalidRotation,
                format!("{}: rotation {}° is not 0, 90, 180 or 270", inst.reference, inst.rot),
                Some(inst.uid.as_str()),
            ));
        }
    }

    let mut tie_lines = Vec::new();
    for (net, pins) in &nets.net_pins {
        if net == GROUND || pins.len() != 1 {
            continue;
        }
        let (uid, pin_id) = &pins[0];
        let inst = project
            .components
            .iter()
            .find(|c| &c.uid == uid)
            .expect("pin belongs to a component");
        let part = library.get(&inst.part).expect("build_nets verified parts");
        let pin = part
            .manifest
            .symbol
            .pins
            .iter()
            .find(|p| &p.id == pin_id)
            .expect("pin exists in manifest");
        if pin.optional {
            tie_lines.push(format!("Rtie_{net} {net} 0 1e9"));
        } else {
            errors.push(NetlistError::new(
                ErrorCode::UnconnectedPin,
                format!("{} pin {} is not connected", inst.reference, pin.name.as_deref().unwrap_or(&pin.id)),
                Some(uid.as_str()),
            ));
        }
    }

    let mut device_lines = Vec::new();
    let mut models: Vec<String> = Vec::new();
    let mut subckt_files: Vec<(PathBuf, String)> = Vec::new(); // (path, owning component uid)

    for inst in &project.components {
        let part = library.get(&inst.part).expect("build_nets verified parts");
        let Some(device) = part.manifest.spice.device() else {
            continue;
        };
        let errors_before = errors.len();
        if !is_valid_reference(&inst.reference) {
            // Reported by check_references; never render it.
            continue;
        }

        let mut values: BTreeMap<String, String> = BTreeMap::new();
        values.insert("ref".into(), inst.reference.clone());
        for pin in &part.manifest.symbol.pins {
            let net = &nets.pin_net[&(inst.uid.clone(), pin.id.clone())];
            values.insert(format!("pin.{}", pin.id), net.clone());
        }
        for param in &part.manifest.params {
            let raw = inst.params.get(&param.key).unwrap_or(&param.default);
            let value = match param.kind {
                ParamKind::Text if is_valid_text_param(raw) => raw.clone(),
                ParamKind::Text => {
                    errors.push(NetlistError::new(
                        ErrorCode::InvalidParam,
                        format!(
                            "{}: {} contains a character that is not allowed (control characters, ';', '$', '{{', '}}')",
                            inst.reference, param.label
                        ),
                        Some(inst.uid.as_str()),
                    ));
                    continue;
                }
                ParamKind::Si => match parse_si(raw) {
                    Ok(v) => format_spice(v),
                    Err(_) => {
                        errors.push(NetlistError::new(
                            ErrorCode::InvalidParam,
                            format!("{}: {} '{}' is not a valid value", inst.reference, param.label, raw),
                            Some(inst.uid.as_str()),
                        ));
                        continue;
                    }
                },
            };
            values.insert(param.key.clone(), value);
        }

        if errors.len() == errors_before {
            match render(&device.template, |name| values.get(name).cloned()) {
                Ok(line) => {
                    let element = line.split_whitespace().next().unwrap_or("");
                    let name = match device.subckt {
                        Some(_) => element.strip_prefix(['X', 'x']).unwrap_or(element),
                        None => element,
                    };
                    let prefix = &device.ref_prefix;
                    let matches = name
                        .get(..prefix.len())
                        .is_some_and(|start| start.eq_ignore_ascii_case(prefix));
                    if matches {
                        device_lines.push(line);
                    } else {
                        errors.push(NetlistError::new(
                            ErrorCode::RefPrefixMismatch,
                            format!(
                                "{}: a {} reference must start with '{prefix}'",
                                inst.reference, part.manifest.name
                            ),
                            Some(inst.uid.as_str()),
                        ));
                    }
                }
                Err(e) => errors.push(NetlistError::new(
                    ErrorCode::Template,
                    format!("{}: {e}", inst.reference),
                    Some(inst.uid.as_str()),
                )),
            }
        }

        for model in &device.models {
            if !models.contains(model) {
                if let Err(e) = check_spice_text(model) {
                    errors.push(NetlistError::new(
                        ErrorCode::ModelFile,
                        format!("{}: model {e}", inst.reference),
                        Some(inst.uid.as_str()),
                    ));
                    continue;
                }
                models.push(model.clone());
            }
        }
        if device.subckt.is_some() {
            match &part.subckt_path {
                Some(path) => {
                    if !subckt_files.iter().any(|(p, _)| p == path) {
                        subckt_files.push((path.clone(), inst.uid.clone()));
                    }
                }
                None => errors.push(NetlistError::new(
                    ErrorCode::ModelFile,
                    format!("{}: the part's subcircuit file was not resolved", inst.reference),
                    Some(inst.uid.as_str()),
                )),
            }
        }
    }

    let mut subckt_texts = Vec::new();
    for (path, uid) in &subckt_files {
        match fs::read_to_string(path) {
            // Re-checked here because the file may have changed since loading.
            Ok(text) => match check_spice_text(&text) {
                Ok(()) => subckt_texts.push(text.trim_end().to_string()),
                Err(e) => errors.push(NetlistError::new(
                    ErrorCode::ModelFile,
                    format!("model file {} {e}", path.display()),
                    Some(uid.as_str()),
                )),
            },
            Err(e) => errors.push(NetlistError::new(
                ErrorCode::ModelFile,
                format!("cannot read model file {}: {e}", path.display()),
                Some(uid.as_str()),
            )),
        }
    }

    let directive = analysis_directive(project).map_err(|e| errors.push(e));

    if !errors.is_empty() {
        return Err(errors);
    }

    let mut lines = vec!["* multysm netlist".to_string()];
    lines.extend(device_lines);
    lines.extend(tie_lines);
    lines.extend(models);
    lines.extend(subckt_texts);
    lines.push(directive.expect("errors checked above"));
    lines.push(".end".into());
    Ok(Netlist { text: lines.join("\n") + "\n", nets })
}

/// Reference syntax (every component) and case-insensitive uniqueness
/// (devices only; ground symbols never reach the netlist).
fn check_references(project: &Project, library: &Library, errors: &mut Vec<NetlistError>) {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for inst in &project.components {
        if !is_valid_reference(&inst.reference) {
            errors.push(NetlistError::new(
                ErrorCode::InvalidReference,
                format!(
                    "'{}' is not a valid reference: use a letter followed by letters, digits or '_'",
                    inst.reference.escape_debug()
                ),
                Some(inst.uid.as_str()),
            ));
            continue;
        }
        let is_ground = library
            .get(&inst.part)
            .is_some_and(|part| matches!(part.manifest.spice, Spice::Ground));
        if is_ground {
            continue;
        }
        if !seen.insert(inst.reference.to_ascii_uppercase()) {
            errors.push(NetlistError::new(
                ErrorCode::DuplicateReference,
                format!("reference '{}' is used by more than one component", inst.reference),
                Some(inst.uid.as_str()),
            ));
        }
    }
}

fn analysis_directive(project: &Project) -> Result<String, NetlistError> {
    let si = |label: &str, raw: &str| {
        parse_si(raw).map(format_spice).map_err(|_| {
            NetlistError::new(
                ErrorCode::BadAnalysis,
                format!("Analysis {label} '{raw}' is not a valid value"),
                None,
            )
        })
    };
    Ok(match &project.analysis {
        Analysis::Op => ".op".to_string(),
        Analysis::Tran { stop, step } => {
            format!(".tran {} {}", si("step", step)?, si("stop time", stop)?)
        }
        Analysis::Ac { start, stop, points_per_decade } => format!(
            ".ac dec {} {} {}",
            points_per_decade,
            si("start frequency", start)?,
            si("stop frequency", stop)?
        ),
        Analysis::Dc { source, start, stop, step } => {
            if !project.components.iter().any(|c| &c.reference == source) {
                return Err(NetlistError::new(
                    ErrorCode::BadAnalysis,
                    format!("DC sweep source '{source}' is not in the circuit"),
                    None,
                ));
            }
            format!(".dc {} {} {} {}", source, si("start", start)?, si("stop", stop)?, si("step", step)?)
        }
    })
}
