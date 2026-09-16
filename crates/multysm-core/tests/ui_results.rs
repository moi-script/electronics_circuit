mod common;

use std::collections::BTreeMap;

use common::{core_library, engine_config, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::engine::{SimResult, Vector};
use multysm_core::library::Library;
use multysm_core::netlist::{Netlist, Nets};
use multysm_core::results::{to_ui_result, SignalKind, UiResult, MAX_POINTS};
use multysm_core::simulate;

/// V1 (10 V) -> R1 1k -> R2 1k -> ground, with the given analysis. Returns (lib-owned) result and uids.
fn divider(lib: &Library, analysis: Analysis) -> (UiResult, String, String) {
    let mut b = CircuitBuilder::new(lib, analysis);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "10")]);
    let r1 = b.add("basic.resistor", "R1", &[]);
    let r2 = b.add("basic.resistor", "R2", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&r2, "1"));
    b.connect((&r2, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let project = b.build();
    let (netlist, result) = simulate(&project, lib, &engine_config()).unwrap();
    let mid = netlist.nets.pin_net[&(r1.clone(), "2".to_string())].clone();
    (to_ui_result(&project, &netlist, &result, MAX_POINTS), mid, v1)
}

fn signal<'a>(ui: &'a UiResult, id: &str) -> &'a multysm_core::results::UiSignal {
    ui.signals.iter().find(|s| s.id == id).unwrap_or_else(|| panic!("no signal {id} in {:?}", ui.signals.iter().map(|s| &s.id).collect::<Vec<_>>()))
}

#[test]
fn op_result_has_no_axis_and_single_point_signals() {
    let lib = core_library();
    let (ui, mid, _) = divider(&lib, Analysis::Op);
    assert_eq!(ui.analysis, "op");
    assert!(ui.x.is_none());
    let v = signal(&ui, &mid);
    assert_eq!(v.kind, SignalKind::Voltage);
    assert_eq!(v.values.len(), 1);
    assert!((v.values[0] - 5.0).abs() < 1e-6);
    let i = signal(&ui, "v1#branch");
    assert_eq!(i.kind, SignalKind::Current);
    assert!(ui.signals.iter().all(|s| s.id != "0"));
    let json = serde_json::to_value(&ui).unwrap();
    assert!(json["x"].is_null());
    assert!(json["nets"]["pinNet"].is_array());
    assert!(json["nets"]["wireNet"].is_object());
}

#[test]
fn tran_result_uses_time_axis() {
    let lib = core_library();
    let (ui, mid, _) = divider(&lib, Analysis::Tran { stop: "1m".into(), step: "10u".into() });
    let x = ui.x.as_ref().unwrap();
    assert_eq!((x.label.as_str(), x.unit.as_str(), x.log), ("time", "s", false));
    assert!(x.values.len() > 10);
    assert_eq!(signal(&ui, &mid).values.len(), x.values.len());
}

#[test]
fn dc_sweep_uses_the_source_as_axis() {
    let lib = core_library();
    let (ui, mid, _) = divider(
        &lib,
        Analysis::Dc { source: "V1".into(), start: "0".into(), stop: "5".into(), step: "1".into() },
    );
    let x = ui.x.as_ref().unwrap();
    assert_eq!((x.label.as_str(), x.unit.as_str()), ("V1", "V"));
    assert_eq!(x.values.len(), 6);
    let v = &signal(&ui, &mid).values;
    assert!((v[5] - 2.5).abs() < 1e-6, "{v:?}");
}

#[test]
fn ac_result_has_log_frequency_magnitude_db_and_phase() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(
        &lib,
        Analysis::Ac { start: "10".into(), stop: "1meg".into(), points_per_decade: 10 },
    );
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.ac_voltage", "V1", &[("amplitude", "1")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let c1 = b.add("basic.capacitor", "C1", &[("capacitance", "10n")]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&c1, "1"));
    b.connect((&c1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let project = b.build();
    let (netlist, result) = simulate(&project, &lib, &engine_config()).unwrap();
    let out = netlist.nets.pin_net[&(c1.clone(), "1".to_string())].clone();
    let ui = to_ui_result(&project, &netlist, &result, MAX_POINTS);
    let x = ui.x.as_ref().unwrap();
    assert_eq!((x.label.as_str(), x.unit.as_str(), x.log), ("frequency", "Hz", true));
    let s = signal(&ui, &out);
    let phase = s.phase.as_ref().unwrap();
    assert!(s.values[0].abs() < 0.1, "low-frequency gain {} dB", s.values[0]);
    assert!(*s.values.last().unwrap() < -30.0, "high-frequency gain {} dB", s.values.last().unwrap());
    assert!(phase[0].abs() < 5.0 && *phase.last().unwrap() < -80.0, "phase {phase:?}");
}

#[test]
fn internal_subcircuit_vectors_are_dropped_but_ammeter_current_is_kept() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let am = b.add("indicators.ammeter", "AM1", &[]);
    let rv = b.add("basic.potentiometer", "RV1", &[]);
    b.connect((&v1, "p"), (&am, "p"));
    b.connect((&am, "n"), (&rv, "1"));
    b.connect((&rv, "2"), (&gnd, "1"));
    b.connect((&rv, "w"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let project = b.build();
    let (netlist, result) = simulate(&project, &lib, &engine_config()).unwrap();
    let ui = to_ui_result(&project, &netlist, &result, MAX_POINTS);
    assert!(ui.signals.iter().any(|s| s.id == "v.xam1.vsense#branch"));
    for s in &ui.signals {
        let top_level = !s.id.contains('.') || s.id.ends_with(".vsense#branch");
        assert!(top_level, "internal vector {} leaked", s.id);
    }
}

#[test]
fn decimation_keeps_ends_extremes_and_alignment() {
    let lib = core_library();
    let project = CircuitBuilder::new(&lib, Analysis::Tran { stop: "1".into(), step: "1u".into() }).build();
    let n = 100_000;
    let time: Vec<f64> = (0..n).map(|i| i as f64 * 1e-5).collect();
    let mut wave: Vec<f64> = (0..n).map(|i| (i as f64 * 0.01).sin()).collect();
    wave[54_321] = 7.0;
    wave[12_345] = -9.0;
    let mut vectors = BTreeMap::new();
    vectors.insert("time".to_string(), Vector::Real(time.clone()));
    vectors.insert("n1".to_string(), Vector::Real(wave));
    let mut nets = Nets::default();
    nets.net_pins.insert("n1".into(), vec![("c1".into(), "1".into())]);
    let netlist = Netlist { text: String::new(), nets };
    let result = SimResult { plot: "tran1".into(), vectors, log: vec![] };

    let ui = to_ui_result(&project, &netlist, &result, 2_000);
    let x = &ui.x.as_ref().unwrap().values;
    let v = &signal(&ui, "n1").values;
    assert_eq!(x.len(), v.len());
    assert!(x.len() <= 2_002, "{} points", x.len());
    assert_eq!(x[0], 0.0);
    assert_eq!(*x.last().unwrap(), time[n - 1]);
    assert!(x.windows(2).all(|w| w[0] < w[1]));
    assert!(v.contains(&7.0) && v.contains(&-9.0));
    let at_peak = x.iter().position(|t| (*t - time[54_321]).abs() < 1e-12).unwrap();
    assert_eq!(v[at_peak], 7.0);
}
