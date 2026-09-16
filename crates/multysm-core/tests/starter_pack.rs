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

// ---- Diodes ----

/// Pushes `current` through the diode from anode to cathode (or cathode to
/// anode when `reverse`) and returns the voltage across it.
fn diode_voltage(part: &str, current: &str, reverse: bool) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let i1 = b.add("sources.dc_current", "I1", &[("current", current)]);
    let d1 = b.add(part, "D1", &[]);
    let (top, bottom) = if reverse { ("K", "A") } else { ("A", "K") };
    b.connect((&i1, "n"), (&d1, top));
    b.connect((&d1, bottom), (&gnd, "1"));
    b.connect((&i1, "p"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &d1, top)).unwrap()
}

#[test]
fn diode_forward_drops_are_realistic() {
    let v4148 = diode_voltage("diodes.1n4148", "1m", false);
    assert!((0.55..0.75).contains(&v4148), "1N4148 at 1 mA: {v4148}");
    let v4007 = diode_voltage("diodes.1n4007", "10m", false);
    assert!((0.55..0.85).contains(&v4007), "1N4007 at 10 mA: {v4007}");
}

#[test]
fn zener_holds_its_breakdown_voltage() {
    let v = diode_voltage("diodes.zener_5v1", "5m", true);
    assert!((4.9..5.3).contains(&v), "zener at 5 mA reverse: {v}");
}

// ---- Transistors ----

/// Switch stage: 5 V -> 1k -> the "high side" pin; the control pin is driven
/// (through 1k for BJTs, directly for the MOSFET) from `drive` volts; the
/// "low side" pin goes to ground (NPN, NMOS) or 5 V (PNP). Returns V at the
/// load-side pin.
fn npn_collector(drive: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let vb = b.add("sources.dc_voltage", "VB", &[("voltage", drive)]);
    let rc = b.add("basic.resistor", "RC", &[("resistance", "1k")]);
    let rb = b.add("basic.resistor", "RB", &[("resistance", "1k")]);
    let q1 = b.add("transistors.2n2222", "Q1", &[]);
    b.connect((&vcc, "p"), (&rc, "1"));
    b.connect((&rc, "2"), (&q1, "C"));
    b.connect((&q1, "E"), (&gnd, "1"));
    b.connect((&vb, "p"), (&rb, "1"));
    b.connect((&rb, "2"), (&q1, "B"));
    b.connect((&vb, "n"), (&gnd, "1"));
    b.connect((&vcc, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &q1, "C")).unwrap()
}

fn pnp_collector(drive: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let vb = b.add("sources.dc_voltage", "VB", &[("voltage", drive)]);
    let rc = b.add("basic.resistor", "RC", &[("resistance", "1k")]);
    let rb = b.add("basic.resistor", "RB", &[("resistance", "1k")]);
    let q1 = b.add("transistors.2n2907", "Q1", &[]);
    b.connect((&vcc, "p"), (&q1, "E"));
    b.connect((&q1, "C"), (&rc, "1"));
    b.connect((&rc, "2"), (&gnd, "1"));
    b.connect((&vb, "p"), (&rb, "1"));
    b.connect((&rb, "2"), (&q1, "B"));
    b.connect((&vb, "n"), (&gnd, "1"));
    b.connect((&vcc, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &q1, "C")).unwrap()
}

fn nmos_drain(gate: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vdd = b.add("sources.dc_voltage", "VDD", &[("voltage", "5")]);
    let vg = b.add("sources.dc_voltage", "VG", &[("voltage", gate)]);
    let rd = b.add("basic.resistor", "RD", &[("resistance", "1k")]);
    let m1 = b.add("transistors.2n7000", "M1", &[]);
    b.connect((&vdd, "p"), (&rd, "1"));
    b.connect((&rd, "2"), (&m1, "D"));
    b.connect((&m1, "S"), (&gnd, "1"));
    b.connect((&vg, "p"), (&m1, "G"));
    b.connect((&vg, "n"), (&gnd, "1"));
    b.connect((&vdd, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &m1, "D")).unwrap()
}

#[test]
fn npn_switches_on_and_off() {
    let on = npn_collector("5");
    let off = npn_collector("0");
    assert!(on < 0.3, "2N2222 on: Vce = {on}");
    assert!(off > 4.9, "2N2222 off: Vce = {off}");
}

#[test]
fn pnp_switches_on_and_off() {
    let on = pnp_collector("0");
    let off = pnp_collector("5");
    assert!(on > 4.7, "2N2907 on: Vc = {on}");
    assert!(off < 0.1, "2N2907 off: Vc = {off}");
}

#[test]
fn nmos_switches_on_and_off() {
    let on = nmos_drain("5");
    let off = nmos_drain("0");
    assert!(on < 0.3, "2N7000 on: Vds = {on}");
    assert!(off > 4.9, "2N7000 off: Vds = {off}");
}

// ---- Analog ----

/// Inverting amplifier: Vin -> 1k -> in-, 10k from in- to out, in+ to ground,
/// supplies at +/-12 V. Returns V(out).
fn inverting_amp(part: &str, vin: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vp = b.add("sources.dc_voltage", "VP", &[("voltage", "12")]);
    let vn = b.add("sources.dc_voltage", "VN", &[("voltage", "12")]);
    let vi = b.add("sources.dc_voltage", "VI", &[("voltage", vin)]);
    let ri = b.add("basic.resistor", "RI", &[("resistance", "1k")]);
    let rf = b.add("basic.resistor", "RF", &[("resistance", "10k")]);
    let u1 = b.add(part, "U1", &[]);
    b.connect((&vp, "n"), (&gnd, "1"));
    b.connect((&vp, "p"), (&u1, "vp"));
    b.connect((&vn, "p"), (&gnd, "1"));
    b.connect((&vn, "n"), (&u1, "vn"));
    b.connect((&vi, "n"), (&gnd, "1"));
    b.connect((&vi, "p"), (&ri, "1"));
    b.connect((&ri, "2"), (&u1, "inn"));
    b.connect((&rf, "1"), (&u1, "inn"));
    b.connect((&rf, "2"), (&u1, "out"));
    b.connect((&u1, "inp"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &u1, "out")).unwrap()
}

#[test]
fn ideal_opamp_inverting_gain_is_minus_ten() {
    let out = inverting_amp("analog.opamp_ideal", "0.1");
    assert!((out + 1.0).abs() < 0.01, "ideal op-amp out = {out}");
    let overdriven = inverting_amp("analog.opamp_ideal", "2");
    assert!((-12.01..=12.01).contains(&overdriven), "overdriven out = {overdriven}");
}

#[test]
fn lm741_inverting_gain_is_minus_ten_and_clamps() {
    let out = inverting_amp("analog.lm741", "0.1");
    assert!((out + 1.0).abs() < 0.05, "LM741 out = {out}");
    let overdriven = inverting_amp("analog.lm741", "2");
    assert!((-12.0..=12.0).contains(&overdriven), "overdriven out = {overdriven}");
    assert!(overdriven < -9.0, "LM741 should swing close to the negative rail, got {overdriven}");
}

// ---- Logic ----

/// Powers `part` from 5 V on `supply.0` with `supply.1` grounded, drives each
/// input pin from its own DC source, and returns V(output) at the end of a
/// 1 ms transient.
fn gate_output(part: &str, supply: (&str, &str), inputs: &[(&str, &str)], output: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, tran("1m", "10u"));
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let u1 = b.add(part, "U1", &[]);
    let mut sources = Vec::new();
    for (i, (_, volts)) in inputs.iter().enumerate() {
        sources.push(b.add("sources.dc_voltage", &format!("VIN{i}"), &[("voltage", *volts)]));
    }
    b.connect((&vcc, "p"), (&u1, supply.0));
    b.connect((&vcc, "n"), (&gnd, "1"));
    b.connect((&u1, supply.1), (&gnd, "1"));
    for ((pin, _), source) in inputs.iter().zip(&sources) {
        b.connect((source, "p"), (&u1, *pin));
        b.connect((source, "n"), (&gnd, "1"));
    }
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &u1, output)).unwrap()
}

fn assert_level(label: &str, v: f64, high: bool, high_min: f64) {
    if high {
        assert!(v > high_min, "{label} = {v} V, expected high");
    } else {
        assert!(v < 0.5, "{label} = {v} V, expected low");
    }
}

#[test]
fn ttl_7404_inverts() {
    for (a, high) in [("0", true), ("5", false)] {
        let y = gate_output("ttl.7404", ("14", "7"), &[("1", a)], "2");
        assert_level(&format!("NOT({a})"), y, high, 3.0);
    }
}

fn two_input_truth_table(part: &str, supply: (&str, &str), high_min: f64, expect: [bool; 4]) {
    for ((a, b), high) in [("0", "0"), ("0", "5"), ("5", "0"), ("5", "5")].into_iter().zip(expect) {
        let y = gate_output(part, supply, &[("1", a), ("2", b)], "3");
        assert_level(&format!("{part}({a},{b})"), y, high, high_min);
    }
}

#[test]
fn ttl_7408_and_truth_table() {
    two_input_truth_table("ttl.7408", ("14", "7"), 3.0, [false, false, false, true]);
}

#[test]
fn ttl_7432_or_truth_table() {
    two_input_truth_table("ttl.7432", ("14", "7"), 3.0, [false, true, true, true]);
}

#[test]
fn cmos_4011_nand_truth_table() {
    two_input_truth_table("cmos.4011", ("14", "7"), 4.5, [true, true, true, false]);
}

#[test]
fn cmos_4017_counts_on_clock_edges() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, tran("2.5m", "10u"));
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vdd = b.add("sources.dc_voltage", "VDD", &[("voltage", "5")]);
    let clk = b.add(
        "sources.pulse_voltage",
        "VCLK",
        &[("v1", "0"), ("v2", "5"), ("delay", "500u"), ("rise", "1u"), ("fall", "1u"), ("width", "500u"), ("period", "1m")],
    );
    let rst = b.add(
        "sources.pulse_voltage",
        "VRST",
        &[("v1", "5"), ("v2", "0"), ("delay", "100u"), ("rise", "1u"), ("fall", "1u"), ("width", "10"), ("period", "20")],
    );
    let u1 = b.add("cmos.4017", "U1", &[]);
    b.connect((&vdd, "p"), (&u1, "16"));
    b.connect((&vdd, "n"), (&gnd, "1"));
    b.connect((&u1, "8"), (&gnd, "1"));
    b.connect((&u1, "13"), (&gnd, "1"));
    b.connect((&clk, "p"), (&u1, "14"));
    b.connect((&clk, "n"), (&gnd, "1"));
    b.connect((&rst, "p"), (&u1, "15"));
    b.connect((&rst, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);

    let at = |pin: &str, t: f64| result.sample_at(&net(&netlist, &u1, pin), t).unwrap();
    // Pins: Q0 = 3, Q1 = 2, Q2 = 4. Rising clock edges at 0.5 ms and 1.5 ms.
    assert_level("Q0 @0.3ms", at("3", 0.3e-3), true, 4.5);
    assert_level("Q1 @0.3ms", at("2", 0.3e-3), false, 4.5);
    assert_level("Q1 @1.0ms", at("2", 1.0e-3), true, 4.5);
    assert_level("Q0 @1.0ms", at("3", 1.0e-3), false, 4.5);
    assert_level("Q2 @2.0ms", at("4", 2.0e-3), true, 4.5);
    assert_level("Q1 @2.0ms", at("2", 2.0e-3), false, 4.5);
}
