mod common;

use common::{core_library, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::library::Library;
use multysm_core::netlist::{build_netlist, ErrorCode};

fn divider(lib: &Library, analysis: Analysis) -> CircuitBuilder<'_> {
    let mut b = CircuitBuilder::new(lib, analysis);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "10")]);
    let r1 = b.add("basic.resistor", "R1", &[]);
    let r2 = b.add("basic.resistor", "R2", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&r2, "1"));
    b.connect((&r2, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    b
}

#[test]
fn divider_netlist_text() {
    let lib = core_library();
    let netlist = build_netlist(&divider(&lib, Analysis::Op).build(), &lib).unwrap();
    assert_eq!(
        netlist.text,
        "* multysm netlist\nV1 n1 0 DC 1e1\nR1 n1 n2 1e3\nR2 n2 0 1e3\n.op\n.end\n"
    );
}

#[test]
fn analysis_directives() {
    let lib = core_library();
    let cases = [
        (Analysis::Tran { stop: "5m".into(), step: "10u".into() }, ".tran 1e-5 5e-3"),
        (
            Analysis::Ac { start: "10".into(), stop: "1meg".into(), points_per_decade: 20 },
            ".ac dec 20 1e1 1e6",
        ),
        (
            Analysis::Dc { source: "V1".into(), start: "0".into(), stop: "5".into(), step: "100m".into() },
            ".dc V1 0e0 5e0 1e-1",
        ),
    ];
    for (analysis, directive) in cases {
        let text = build_netlist(&divider(&lib, analysis).build(), &lib).unwrap().text;
        assert!(text.contains(&format!("\n{directive}\n.end\n")), "{text}");
    }
}

#[test]
fn dc_sweep_of_missing_source_is_an_error() {
    let lib = core_library();
    let analysis = Analysis::Dc {
        source: "V9".into(), start: "0".into(), stop: "1".into(), step: "1".into(),
    };
    let errors = build_netlist(&divider(&lib, analysis).build(), &lib).unwrap_err();
    assert_eq!(errors[0].code, ErrorCode::BadAnalysis);
}

#[test]
fn missing_ground_is_an_error() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let v1 = b.add("sources.dc_voltage", "V1", &[]);
    let r1 = b.add("basic.resistor", "R1", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&v1, "n"), (&r1, "2"));
    let errors = build_netlist(&b.build(), &lib).unwrap_err();
    assert!(errors.iter().any(|e| e.code == ErrorCode::NoGround));
}

#[test]
fn unconnected_required_pin_is_an_error_naming_the_component() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let r1 = b.add("basic.resistor", "R1", &[]);
    b.connect((&r1, "1"), (&gnd, "1"));
    let errors = build_netlist(&b.build(), &lib).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].code, ErrorCode::UnconnectedPin);
    assert_eq!(errors[0].message, "R1 pin 2 is not connected");
    assert_eq!(errors[0].component_uid.as_deref(), Some(r1.as_str()));
}

#[test]
fn unconnected_optional_pins_get_tie_resistors() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let u1 = b.add("ttl.7400", "U1", &[]);
    b.connect((&vcc, "p"), (&u1, "14"));
    b.connect((&vcc, "n"), (&gnd, "1"));
    b.connect((&u1, "7"), (&gnd, "1"));

    let netlist = build_netlist(&b.build(), &lib).unwrap();
    let y1 = &netlist.nets.pin_net[&(u1.clone(), "3".to_string())];
    assert!(netlist.text.contains(&format!("Rtie_{y1} {y1} 0 1e9")), "{}", netlist.text);
    assert_eq!(netlist.text.matches("Rtie_").count(), 12);
}

#[test]
fn invalid_parameter_is_an_error() {
    let lib = core_library();
    let mut project = divider(&lib, Analysis::Op).build();
    project.components[2].params.insert("resistance".into(), "lots".into());
    let errors = build_netlist(&project, &lib).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].code, ErrorCode::InvalidParam);
    assert_eq!(errors[0].message, "R1: Resistance 'lots' is not a valid value");
}

#[test]
fn models_and_subcircuits_are_included_once() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[]);
    let d1 = b.add("diodes.led", "D1", &[]);
    let d2 = b.add("diodes.led", "D2", &[]);
    let u1 = b.add("ttl.7400", "U1", &[]);
    let u2 = b.add("ttl.7400", "U2", &[]);
    b.connect((&vcc, "n"), (&gnd, "1"));
    b.connect((&vcc, "p"), (&d1, "A"));
    b.connect((&d1, "K"), (&d2, "A"));
    b.connect((&d2, "K"), (&gnd, "1"));
    b.connect((&u1, "14"), (&vcc, "p"));
    b.connect((&u2, "14"), (&vcc, "p"));
    b.connect((&u1, "7"), (&gnd, "1"));
    b.connect((&u2, "7"), (&gnd, "1"));

    let text = build_netlist(&b.build(), &lib).unwrap().text;
    assert_eq!(text.matches(".model LED_RED").count(), 1);
    assert_eq!(text.matches(".subckt SN7400").count(), 1);
    assert!(text.contains("XU1 "));
    assert!(text.contains("XU2 "));
}
