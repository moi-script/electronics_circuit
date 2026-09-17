//! Loads one imported part in ngspice to catch models that don't parse.

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use super::candidate::Candidate;
use crate::engine::{run_netlist_with, EngineConfig, EngineError};
use crate::netlist::template::render;

pub const SMOKE_TIMEOUT: Duration = Duration::from_secs(5);

fn node(pin_id: &str) -> String {
    let safe: String = pin_id.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    format!("n{safe}")
}

pub fn smoke_netlist(candidate: &Candidate) -> Result<String, String> {
    let pins = &candidate.symbol.pins;
    let first = pins.first().ok_or("the part has no pins")?;
    let reference = format!("{}1", candidate.ref_prefix);
    let device = render(&candidate.template, |name| {
        if name == "ref" {
            return Some(reference.clone());
        }
        if let Some(pin) = name.strip_prefix("pin.") {
            return pins.iter().any(|p| p.id == pin).then(|| node(pin));
        }
        candidate.params.iter().find(|p| p.key == name).map(|p| p.default.clone())
    })
    .map_err(|e| e.to_string())?;

    let mut lines = vec!["* multysm import smoke test".to_string(), device];
    for pin in pins {
        let n = node(&pin.id);
        lines.push(format!("Rg_{n} {n} 0 1meg"));
    }
    lines.push("Vsmoke vsmoke 0 DC 1".into());
    lines.push(format!("Rsmoke vsmoke {} 1k", node(&first.id)));
    lines.push(candidate.model_text.clone());
    lines.push(".op".into());
    lines.push(".end".into());
    Ok(lines.join("\n") + "\n")
}

pub fn smoke_test(config: &EngineConfig, candidate: &Candidate) -> Result<(), (String, Vec<String>)> {
    let netlist = smoke_netlist(candidate).map_err(|e| (e, vec![]))?;
    match run_netlist_with(config, &netlist, &AtomicBool::new(false), Some(SMOKE_TIMEOUT)) {
        // Loading is what's being checked. The artificial bias (floating supplies, 1 V on one pin)
        // often keeps real macromodels from converging or makes them slow; that is not a broken model.
        Ok(_) | Err(EngineError::Run { .. }) | Err(EngineError::Timeout { .. }) => Ok(()),
        Err(error) => {
            let log = error.log().map(<[String]>::to_vec).unwrap_or_default();
            Err((format!("ngspice could not load the model: {}", error.to_string().lines().next().unwrap_or("")), log))
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::candidate::build_candidates;
    use crate::import::spice::parse_spice;
    use std::collections::BTreeMap;

    fn candidate(text: &str, name: &str) -> Candidate {
        build_candidates(&[("t.lib".into(), parse_spice(text))], &BTreeMap::new())
            .into_iter()
            .find(|c| c.name == name)
            .unwrap()
    }

    fn config() -> EngineConfig {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/ngspice");
        EngineConfig::from_vendor_dir(&dir)
    }

    #[test]
    fn netlist_ties_every_pin_and_drives_the_first() {
        let c = candidate(".subckt AMP a b out PARAMS: GAIN=10\nE1 out 0 a b {GAIN}\n.ends\n", "AMP");
        let text = smoke_netlist(&c).unwrap();
        assert!(text.contains("XU1 n1 n2 n3 AMP PARAMS: GAIN=10"), "{text}");
        for pin in ["n1", "n2", "n3"] {
            assert!(text.contains(&format!("Rg_{pin} {pin} 0 1meg")), "{text}");
        }
        assert!(text.contains("Vsmoke vsmoke 0 DC 1") && text.contains("Rsmoke vsmoke n1 1k"));
        assert!(text.contains(".subckt AMP") && text.trim_end().ends_with(".end"));
    }

    #[test]
    fn good_models_pass_and_broken_ones_fail_with_a_log() {
        let good = candidate(".model DG D(IS=1e-14)\n", "DG");
        assert_eq!(smoke_test(&config(), &good), Ok(()));
        let bad = candidate(".subckt BROKEN a b\nQ1 a b 0 QMISSING\n.ends\n", "BROKEN");
        let (message, log) = smoke_test(&config(), &bad).unwrap_err();
        assert!(message.contains("ngspice"), "{message}");
        assert!(!log.is_empty());
    }
}
