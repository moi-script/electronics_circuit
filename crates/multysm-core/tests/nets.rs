mod common;

use common::{core_library, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::netlist::{build_nets, ErrorCode, GROUND};

fn key(uid: &str, pin: &str) -> (String, String) {
    (uid.to_string(), pin.to_string())
}

#[test]
fn divider_nets_are_named_in_pin_order() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "10")]);
    let r1 = b.add("basic.resistor", "R1", &[]);
    let r2 = b.add("basic.resistor", "R2", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&r2, "1"));
    b.connect((&r2, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));

    let nets = build_nets(&b.build(), &lib).unwrap();

    assert_eq!(nets.pin_net[&key(&gnd, "1")], GROUND);
    assert_eq!(nets.pin_net[&key(&v1, "p")], "n1");
    assert_eq!(nets.pin_net[&key(&v1, "n")], GROUND);
    assert_eq!(nets.pin_net[&key(&r1, "1")], "n1");
    assert_eq!(nets.pin_net[&key(&r1, "2")], "n2");
    assert_eq!(nets.pin_net[&key(&r2, "1")], "n2");
    assert_eq!(nets.pin_net[&key(&r2, "2")], GROUND);
    assert_eq!(nets.net_pins[GROUND].len(), 3);
}

#[test]
fn wire_ending_on_another_wire_joins_it_but_crossing_does_not() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let r1 = b.add("basic.resistor", "R1", &[]); // pins (0,10) (60,10)
    let r2 = b.add("basic.resistor", "R2", &[]); // pins (1000,1010) (1060,1010)
    let r3 = b.add("basic.resistor", "R3", &[]); // pins (2000,4010) (2060,4010)
    assert_eq!(b.pin_pos((&r1, "2")), (60, 10));
    assert_eq!(b.pin_pos((&r3, "1")), (2000, 4010));

    // L-shaped wire R1.2 -> R2.1
    b.wire(vec![[60, 10], [1000, 10], [1000, 1010]]);
    // R3.1 ends in the middle of the first segment above: T-junction
    b.wire(vec![[2000, 4010], [500, 4010], [500, 10]]);
    // R3.2 route crosses the first wire at (300,10) without a vertex there
    b.wire(vec![[300, -500], [300, 500], [2060, 500], [2060, 4010]]);

    let nets = build_nets(&b.build(), &lib).unwrap();

    let joined = &nets.pin_net[&key(&r1, "2")];
    assert_eq!(&nets.pin_net[&key(&r2, "1")], joined);
    assert_eq!(&nets.pin_net[&key(&r3, "1")], joined);
    assert_ne!(&nets.pin_net[&key(&r3, "2")], joined);
}

#[test]
fn pins_at_the_same_point_connect_without_a_wire() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let r1 = b.add("basic.resistor", "R1", &[]);
    let r2 = b.add("basic.resistor", "R2", &[]);
    let mut project = b.build();
    // Move R2 so its pin 1 sits exactly on R1 pin 2 at (60,10).
    project.components[1].x = 60;
    project.components[1].y = 0;

    let nets = build_nets(&project, &lib).unwrap();
    assert_eq!(nets.pin_net[&key(&r1, "2")], nets.pin_net[&key(&r2, "1")]);
}

#[test]
fn unknown_part_is_reported_with_its_uid() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    b.add("basic.resistor", "R1", &[]);
    let mut project = b.build();
    project.components[0].part = "basic.flux_capacitor".into();

    let errors = build_nets(&project, &lib).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].code, ErrorCode::UnknownPart);
    assert_eq!(errors[0].component_uid.as_deref(), Some("c1"));
}
