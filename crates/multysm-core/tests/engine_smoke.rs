mod common;

use multysm_core::engine::{run_netlist, EngineError};

#[test]
fn divider_operating_point() {
    let netlist = "* divider\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 1k\n.op\n.end\n";
    let result = run_netlist(&common::engine_config(), netlist).unwrap();
    let out = result.last("out").expect("vector 'out'");
    assert!((out - 5.0).abs() < 1e-6, "out = {out}");
}

#[test]
fn rc_transient_has_time_vector_and_interpolates() {
    let netlist = "* rc\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n.end\n";
    let result = run_netlist(&common::engine_config(), netlist).unwrap();
    assert!(result.real("time").unwrap().len() > 10);
    let v = result.sample_at("out", 1e-3).unwrap();
    assert!((v - 3.1606).abs() < 0.1, "v(out) at tau = {v}");
}

#[test]
fn runs_back_to_back_do_not_leak_old_circuits() {
    let config = common::engine_config();
    let a = run_netlist(&config, "* a\nV1 x 0 DC 1\nR1 x 0 1k\n.op\n.end\n").unwrap();
    let b = run_netlist(&config, "* b\nV1 y 0 DC 2\nR1 y 0 1k\n.op\n.end\n").unwrap();
    assert!(a.real("x").is_some());
    assert!(b.real("y").is_some());
    assert!(b.real("x").is_none());
}

#[test]
fn broken_netlist_returns_an_error_with_log() {
    let netlist = "* broken\nR1 a 0 1k\nQ9 nonsense\n.op\n.end\n";
    match run_netlist(&common::engine_config(), netlist) {
        Err(EngineError::Circuit { log }) | Err(EngineError::Run { log }) => {
            assert!(!log.is_empty())
        }
        other => panic!("expected an error, got {other:?}"),
    }
}
