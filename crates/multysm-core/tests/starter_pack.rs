//! Simulation checks for the v1 starter pack parts (spec §5).

mod common;

use common::{core_library, engine_config, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::engine::SimResult;
use multysm_core::library::Library;
use multysm_core::netlist::Netlist;
use multysm_core::simulate;

fn net(netlist: &Netlist, uid: &str, pin: &str) -> String {
    netlist.nets.pin_net[&(uid.to_string(), pin.to_string())].clone()
}

fn run(lib: &Library, b: CircuitBuilder<'_>) -> (Netlist, SimResult) {
    simulate(&b.build(), lib, &engine_config()).unwrap_or_else(|e| panic!("simulation failed: {e:?}"))
}

fn peak(result: &SimResult, name: &str) -> f64 {
    result.real(name).unwrap().iter().fold(0.0, |m: f64, v| m.max(v.abs()))
}

fn tran(stop: &str, step: &str) -> Analysis {
    Analysis::Tran { stop: stop.into(), step: step.into() }
}

// ---- Sources ----

#[test]
fn dc_current_source_into_1k_gives_1v() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let i1 = b.add("sources.dc_current", "I1", &[("current", "1m")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&i1, "n"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&i1, "p"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &r1, "1")).unwrap();
    assert!((v - 1.0).abs() < 0.01, "V(R1) = {v}");
}

#[test]
fn ac_voltage_source_peak_equals_amplitude() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, tran("2m", "5u"));
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.ac_voltage", "V1", &[("amplitude", "2"), ("frequency", "1k")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let p = peak(&result, &net(&netlist, &r1, "1"));
    assert!((p - 2.0).abs() < 0.06, "peak {p}");
}

#[test]
fn ac_current_source_peak_into_1k() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, tran("2m", "5u"));
    let gnd = b.add("sources.ground", "GND1", &[]);
    let i1 = b.add("sources.ac_current", "I1", &[("amplitude", "1m"), ("frequency", "1k")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&i1, "n"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&i1, "p"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let p = peak(&result, &net(&netlist, &r1, "1"));
    assert!((p - 1.0).abs() < 0.03, "peak {p}");
}

#[test]
fn vcc_rail_holds_its_voltage() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.vcc", "V1", &[]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&vcc, "1"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &r1, "1")).unwrap();
    assert!((v - 5.0).abs() < 1e-3, "VCC = {v}");
}

// ---- Basic ----

#[test]
fn inductor_is_a_short_at_dc() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "1")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let l1 = b.add("basic.inductor", "L1", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&l1, "1"));
    b.connect((&l1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &l1, "1")).unwrap();
    assert!(v.abs() < 1e-3, "V(L1) = {v}");
}

/// 5 V -> switch -> 1k -> ground; returns the voltage on the 1k.
fn two_pin_switch_output(part: &str, key: &str, value: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let s1 = b.add(part, "S1", &[(key, value)]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&v1, "p"), (&s1, "1"));
    b.connect((&s1, "2"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &r1, "1")).unwrap()
}

#[test]
fn spst_switch_open_and_closed() {
    let closed = two_pin_switch_output("basic.spst", "closed", "1");
    let open = two_pin_switch_output("basic.spst", "closed", "0");
    assert!(closed > 4.99, "closed: {closed}");
    assert!(open < 1e-3, "open: {open}");
}

#[test]
fn push_button_released_and_pressed() {
    let pressed = two_pin_switch_output("basic.push_button", "pressed", "1");
    let released = two_pin_switch_output("basic.push_button", "pressed", "0");
    assert!(pressed > 4.99, "pressed: {pressed}");
    assert!(released < 1e-3, "released: {released}");
}

#[test]
fn spdt_switch_routes_common_to_a_or_b() {
    let lib = core_library();
    for (pos, a_high) in [("0", true), ("1", false)] {
        let mut b = CircuitBuilder::new(&lib, Analysis::Op);
        let gnd = b.add("sources.ground", "GND1", &[]);
        let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
        let s1 = b.add("basic.spdt", "S1", &[("pos", pos)]);
        let ra = b.add("basic.resistor", "RA", &[("resistance", "1k")]);
        let rb = b.add("basic.resistor", "RB", &[("resistance", "1k")]);
        b.connect((&v1, "p"), (&s1, "c"));
        b.connect((&s1, "a"), (&ra, "1"));
        b.connect((&s1, "b"), (&rb, "1"));
        b.connect((&ra, "2"), (&gnd, "1"));
        b.connect((&rb, "2"), (&gnd, "1"));
        b.connect((&v1, "n"), (&gnd, "1"));
        let (netlist, result) = run(&lib, b);
        let va = result.last(&net(&netlist, &ra, "1")).unwrap();
        let vb = result.last(&net(&netlist, &rb, "1")).unwrap();
        let (on, off) = if a_high { (va, vb) } else { (vb, va) };
        assert!(on > 4.99 && off < 1e-3, "pos {pos}: A={va} B={vb}");
    }
}

#[test]
fn potentiometer_divides_by_position() {
    let lib = core_library();
    for (position, expected) in [("0.5", 5.0), ("0.25", 7.5)] {
        let mut b = CircuitBuilder::new(&lib, Analysis::Op);
        let gnd = b.add("sources.ground", "GND1", &[]);
        let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "10")]);
        let rv = b.add("basic.potentiometer", "RV1", &[("resistance", "10k"), ("position", position)]);
        let load = b.add("basic.resistor", "RL", &[("resistance", "1e9")]);
        b.connect((&v1, "p"), (&rv, "1"));
        b.connect((&rv, "2"), (&gnd, "1"));
        b.connect((&rv, "w"), (&load, "1"));
        b.connect((&load, "2"), (&gnd, "1"));
        b.connect((&v1, "n"), (&gnd, "1"));
        let (netlist, result) = run(&lib, b);
        let v = result.last(&net(&netlist, &rv, "w")).unwrap();
        assert!((v - expected).abs() / expected < 0.01, "position {position}: {v}");
    }
}
