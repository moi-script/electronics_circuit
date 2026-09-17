mod common;

use multysm_core::engine::run_netlist_with;
use multysm_core::engine::{run_netlist, EngineError};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

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
fn no_analysis_is_an_error() {
    let netlist = "* noan\nV1 a 0 1\nR1 a 0 1k\n.end\n";
    match run_netlist(&common::engine_config(), netlist) {
        Err(EngineError::Run { log }) => assert!(!log.is_empty()),
        other => panic!("expected EngineError::Run, got {other:?}"),
    }
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

#[test]
fn nul_byte_is_an_error_not_a_panic() {
    let netlist = "* nul\nV1 a 0 1\nR1 a 0 1k\0\n.op\n.end\n";
    match run_netlist(&common::engine_config(), netlist) {
        Err(EngineError::Circuit { log }) => assert_eq!(log, vec!["netlist contains a NUL byte"]),
        other => panic!("expected EngineError::Circuit, got {other:?}"),
    }
}

#[test]
fn results_and_errors_serialize_to_json() {
    let config = common::engine_config();
    let result = run_netlist(&config, "* s\nV1 a 0 DC 1\nR1 a 0 1k\n.op\n.end\n").unwrap();
    let json = serde_json::to_value(&result).unwrap();
    assert!(serde_json::to_string(&result).is_ok());
    assert_eq!(json["vectors"]["a"]["type"], "real");
    assert_eq!(json["vectors"]["a"]["values"][0], 1.0);

    let err = EngineError::Run { log: vec!["stderr Error: x".into()] };
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "run");
    assert_eq!(json["log"][0], "stderr Error: x");
    let json = serde_json::to_value(multysm_core::SimulateError::Engine(EngineError::ConfigMismatch)).unwrap();
    assert_eq!(json["kind"], "config_mismatch");
    assert!(json.get("log").is_none());
}

const LONG_RC: &str =
    "* long\nV1 in 0 PULSE(0 5 0 1u 1u 1m 2m)\nR1 in out 1k\nC1 out 0 1u\n.tran 1u 100\n.end\n";

#[test]
fn cancel_stops_a_long_run_and_the_engine_is_reusable() {
    let config = common::engine_config();
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    let setter = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let outcome = run_netlist_with(&config, LONG_RC, &cancel, None);
    setter.join().unwrap();
    assert!(matches!(outcome, Err(EngineError::Stopped)), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(4), "stop took {:?}", started.elapsed());

    let after = run_netlist(&config, "* a\nV1 x 0 DC 1\nR1 x 0 1k\n.op\n.end\n").unwrap();
    assert!(after.real("x").is_some());
}

#[test]
fn timeout_stops_a_long_run() {
    let config = common::engine_config();
    let started = Instant::now();
    let outcome = run_netlist_with(&config, LONG_RC, &AtomicBool::new(false), Some(Duration::from_secs(1)));
    assert!(matches!(outcome, Err(EngineError::Timeout { seconds: 1 })), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(5), "timeout took {:?}", started.elapsed());

    let after = run_netlist(&config, "* b\nV1 y 0 DC 2\nR1 y 0 1k\n.op\n.end\n").unwrap();
    assert!(after.real("y").is_some());
}

#[test]
fn stopped_and_timeout_errors_have_kinds() {
    assert_eq!(EngineError::Stopped.kind(), "stopped");
    assert_eq!(EngineError::Timeout { seconds: 30 }.kind(), "timeout");
}

#[test]
fn quick_runs_finish_without_waiting_for_the_poll_limits() {
    let config = common::engine_config();
    run_netlist(&config, "* warm\nV1 x 0 DC 1\nR1 x 0 1k\n.op\n.end\n").unwrap();
    let started = Instant::now();
    run_netlist(&config, "* quick\nV1 x 0 DC 1\nR1 x 0 1k\n.op\n.end\n").unwrap();
    // `engine::START_WAIT` (1 s) is the grace period `run_netlist_with` gives `ngSpice_running()`
    // to come up before it starts trusting the poll; this guards that a run this small finishes
    // on its own well before that window, rather than accidentally blocking on it. 900 ms keeps
    // that margin meaningful while giving slower CI runners more room than 800 ms did.
    assert!(started.elapsed() < Duration::from_millis(900), "op took {:?}", started.elapsed());
}
