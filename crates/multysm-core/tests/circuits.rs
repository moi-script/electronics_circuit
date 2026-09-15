mod common;

use common::{core_library, engine_config, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::simulate;

fn net(netlist: &multysm_core::netlist::Netlist, uid: &str, pin: &str) -> String {
    netlist.nets.pin_net[&(uid.to_string(), pin.to_string())].clone()
}

#[test]
fn rc_charges_to_63_percent_at_tau() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Tran { stop: "5m".into(), step: "10u".into() });
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add(
        "sources.pulse_voltage",
        "V1",
        &[("v1", "0"), ("v2", "5"), ("rise", "1u"), ("fall", "1u"), ("width", "1"), ("period", "2")],
    );
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let c1 = b.add("basic.capacitor", "C1", &[("capacitance", "1u")]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&c1, "1"));
    b.connect((&c1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));

    let (netlist, result) = simulate(&b.build(), &lib, &engine_config()).unwrap();

    let v = result.sample_at(&net(&netlist, &c1, "1"), 1e-3).unwrap();
    let expected = 5.0 * (1.0 - (-1.0f64).exp());
    assert!((v - expected).abs() / expected < 0.03, "v(C1) at tau = {v}, expected {expected}");
}

#[test]
fn led_forward_voltage_is_realistic() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "330")]);
    let d1 = b.add("diodes.led", "D1", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&d1, "A"));
    b.connect((&d1, "K"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));

    let (netlist, result) = simulate(&b.build(), &lib, &engine_config()).unwrap();

    let vf = result.last(&net(&netlist, &d1, "A")).unwrap();
    assert!((1.5..2.0).contains(&vf), "LED forward voltage {vf}");
}

#[test]
fn nand_gate_truth_table() {
    let lib = core_library();
    let config = engine_config();
    for (a, b_in, expect_high) in [("0", "0", true), ("0", "5", true), ("5", "0", true), ("5", "5", false)] {
        let mut b = CircuitBuilder::new(&lib, Analysis::Tran { stop: "1m".into(), step: "10u".into() });
        let gnd = b.add("sources.ground", "GND1", &[]);
        let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
        let va = b.add("sources.dc_voltage", "VA", &[("voltage", a)]);
        let vb = b.add("sources.dc_voltage", "VB", &[("voltage", b_in)]);
        let u1 = b.add("ttl.7400", "U1", &[]);
        b.connect((&vcc, "p"), (&u1, "14"));
        b.connect((&vcc, "n"), (&gnd, "1"));
        b.connect((&u1, "7"), (&gnd, "1"));
        b.connect((&va, "p"), (&u1, "1"));
        b.connect((&va, "n"), (&gnd, "1"));
        b.connect((&vb, "p"), (&u1, "2"));
        b.connect((&vb, "n"), (&gnd, "1"));

        let (netlist, result) = simulate(&b.build(), &lib, &config).unwrap();

        let y = result.last(&net(&netlist, &u1, "3")).unwrap();
        if expect_high {
            assert!(y > 3.0, "NAND({a},{b_in}) = {y}V, expected high");
        } else {
            assert!(y < 0.5, "NAND({a},{b_in}) = {y}V, expected low");
        }
    }
}

#[test]
fn timer_555_astable_frequency() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Tran { stop: "5m".into(), step: "2u".into() });
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let r2 = b.add("basic.resistor", "R2", &[("resistance", "10k")]);
    let c1 = b.add("basic.capacitor", "C1", &[("capacitance", "10n")]);
    let c2 = b.add("basic.capacitor", "C2", &[("capacitance", "10n")]);
    let u1 = b.add("mixed.555", "U1", &[]);
    let rl = b.add("basic.resistor", "RL", &[("resistance", "1k")]);
    b.connect((&vcc, "n"), (&gnd, "1"));
    b.connect((&vcc, "p"), (&u1, "8"));
    b.connect((&u1, "4"), (&vcc, "p"));
    b.connect((&r1, "1"), (&vcc, "p"));
    b.connect((&r1, "2"), (&u1, "7"));
    b.connect((&r2, "1"), (&u1, "7"));
    b.connect((&r2, "2"), (&u1, "6"));
    b.connect((&c1, "1"), (&u1, "6"));
    b.connect((&u1, "2"), (&c1, "1"));
    b.connect((&c1, "2"), (&gnd, "1"));
    b.connect((&u1, "5"), (&c2, "1"));
    b.connect((&c2, "2"), (&gnd, "1"));
    b.connect((&u1, "1"), (&gnd, "1"));
    b.connect((&u1, "3"), (&rl, "1"));
    b.connect((&rl, "2"), (&gnd, "1"));

    let (netlist, result) = simulate(&b.build(), &lib, &engine_config()).unwrap();

    let time = result.real("time").unwrap();
    let out = result.real(&net(&netlist, &u1, "3")).unwrap();
    let rises: Vec<f64> = (1..time.len())
        .filter(|&i| time[i] > 1e-3 && out[i - 1] < 2.5 && out[i] >= 2.5)
        .map(|i| time[i])
        .collect();
    assert!(rises.len() >= 3, "only {} rising edges", rises.len());
    let period = (rises[rises.len() - 1] - rises[0]) / (rises.len() - 1) as f64;
    let expected = 1.0 / (0.693 * (1e3 + 2.0 * 10e3) * 10e-9);
    let freq = 1.0 / period;
    assert!((freq - expected).abs() / expected < 0.10, "555 at {freq:.0} Hz, expected {expected:.0} Hz");
}

#[test]
fn netlist_errors_stop_before_the_engine() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    b.add("basic.resistor", "R1", &[]);
    match simulate(&b.build(), &lib, &engine_config()) {
        Err(multysm_core::SimulateError::Netlist(errors)) => assert!(!errors.is_empty()),
        other => panic!("expected netlist errors, got {other:?}"),
    }
}
