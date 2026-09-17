mod common;

use std::sync::atomic::AtomicBool;

use common::{core_library, engine_config, workspace_root, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::import::candidate::CandidateStatus;
use multysm_core::import::pack::list_packs;
use multysm_core::import::{commit, preview, Choice};
use multysm_core::library::load_library;
use multysm_core::simulate;

fn fixtures() -> Vec<std::path::PathBuf> {
    let dir = workspace_root().join("crates/multysm-core/tests/fixtures/import");
    vec![dir.join("opamp_macro.lib"), dir.join("discretes.lib")]
}

fn choices(p: &multysm_core::import::Preview) -> Vec<Choice> {
    p.candidates.iter().map(|c| Choice { key: c.key.clone(), selected: c.selected, category: c.category }).collect()
}

#[test]
fn preview_lists_candidates_and_file_warnings() {
    let packs = tempfile::tempdir().unwrap();
    let p = preview(&fixtures(), packs.path());
    assert_eq!(p.files.len(), 2);
    assert!(p.files[0].warnings.iter().any(|w| w.contains("not_here.lib")));
    let status = |name: &str| p.candidates.iter().find(|c| c.name == name).unwrap().status;
    assert_eq!(status("DEMO_OPAMP"), CandidateStatus::Ready);
    assert_eq!(status("DEMO_SWITCH"), CandidateStatus::Unsupported);
    let helper = p.candidates.iter().find(|c| c.name == "DEMO_INPUT").unwrap();
    assert!(!helper.selected);
    assert!(list_packs(packs.path()).is_empty(), "preview never writes");
}

#[test]
fn unreadable_files_are_reported_without_stopping_the_rest() {
    let packs = tempfile::tempdir().unwrap();
    let mut paths = fixtures();
    paths.insert(0, packs.path().join("missing.lib"));
    let p = preview(&paths, packs.path());
    assert!(p.files[0].error.is_some());
    assert!(p.candidates.iter().any(|c| c.name == "DEMO_OPAMP"));
}

#[test]
fn imported_op_amp_simulates_in_an_inverting_amplifier() {
    let packs = tempfile::tempdir().unwrap();
    let p = preview(&fixtures(), packs.path());
    let mut done = Vec::new();
    let report = commit(&p, &choices(&p), packs.path(), &engine_config(), &AtomicBool::new(false), &mut |d, t| done.push((d, t)))
        .unwrap();
    assert!(report.failed.is_empty(), "{:#?}", report.failed);
    assert_eq!(report.imported.len(), 4, "{:?}", report.imported); // opamp, schottky, npn, pmos
    assert_eq!(done.last(), Some(&(4, 4)));
    let pack_id = report.pack_id.clone().unwrap();
    assert_eq!(pack_id, "imported-opamp-macro");

    let core = workspace_root().join("components/core");
    let library = load_library(&[core, packs.path().join(&pack_id)]);
    assert!(library.issues.is_empty(), "{:#?}", library.issues);
    drop(core_library());

    let mut b = CircuitBuilder::new(&library, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vin = b.add("sources.dc_voltage", "V1", &[("voltage", "0.5")]);
    let vp = b.add("sources.dc_voltage", "V2", &[("voltage", "15")]);
    let vn = b.add("sources.dc_voltage", "V3", &[("voltage", "15")]);
    let rin = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let rf = b.add("basic.resistor", "R2", &[("resistance", "10k")]);
    let amp = b.add("imported.opamp_macro.demo_opamp", "U1", &[]);
    b.connect((&vin, "n"), (&gnd, "1"));
    b.connect((&vin, "p"), (&rin, "1"));
    b.connect((&rin, "2"), (&amp, "2"));
    b.connect((&rf, "1"), (&amp, "2"));
    b.connect((&rf, "2"), (&amp, "5"));
    b.connect((&amp, "1"), (&gnd, "1"));
    b.connect((&vp, "n"), (&gnd, "1"));
    b.connect((&vp, "p"), (&amp, "3"));
    b.connect((&vn, "p"), (&gnd, "1"));
    b.connect((&vn, "n"), (&amp, "4"));

    let (netlist, result) = simulate(&b.build(), &library, &engine_config()).unwrap();
    let out = netlist.nets.pin_net[&(amp.clone(), "5".to_string())].clone();
    let v = result.last(&out).unwrap();
    assert!((v + 5.0).abs() < 0.05, "inverting gain of -10 on 0.5 V gives -5 V, got {v}");
}

#[test]
fn reimport_replaces_the_old_part_and_removes_the_empty_pack() {
    let packs = tempfile::tempdir().unwrap();
    let discretes = vec![fixtures()[1].clone()];
    let first = preview(&discretes, packs.path());
    let only_schottky: Vec<Choice> = first
        .candidates
        .iter()
        .map(|c| Choice { key: c.key.clone(), selected: c.name == "DEMO_SCHOTTKY", category: c.category })
        .collect();
    commit(&first, &only_schottky, packs.path(), &engine_config(), &AtomicBool::new(false), &mut |_, _| {}).unwrap();

    let second = preview(&discretes, packs.path());
    let again = second.candidates.iter().find(|c| c.name == "DEMO_SCHOTTKY").unwrap();
    assert_eq!(again.status, CandidateStatus::AlreadyImported);
    let mut picks = choices(&second);
    picks.iter_mut().find(|c| c.key == again.key).unwrap().selected = true;
    let report = commit(&second, &picks, packs.path(), &engine_config(), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
    assert_eq!(report.pack_id.as_deref(), Some("imported-discretes-2"));

    let ids: Vec<String> = list_packs(packs.path()).into_iter().map(|p| p.id).collect();
    assert_eq!(ids, ["imported-discretes-2"], "the first pack held only the replaced part");
}

#[test]
fn cancelled_commit_keeps_tested_parts_and_skips_the_rest() {
    let packs = tempfile::tempdir().unwrap();
    let p = preview(&fixtures(), packs.path());
    let cancel = AtomicBool::new(false);
    let report = commit(&p, &choices(&p), packs.path(), &engine_config(), &cancel, &mut |done, _| {
        if done == 1 {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    })
    .unwrap();
    assert!(report.cancelled);
    assert_eq!(report.imported.len(), 1);
    assert_eq!(report.skipped.len(), 3);
}
