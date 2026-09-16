use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use multysm_app_lib::library_dto::components_root;
use multysm_app_lib::simulation::{engine_config, run_simulation, SimOutcome, SimShared};
use multysm_core::project_file::parse_project;

/// V1 (10 V) -> R1 1k -> R2 1k -> ground. `ground: false` leaves out the ground part.
fn divider(analysis: &str, ground: bool) -> multysm_core::circuit::Project {
    let gnd = if ground {
        r#",{ "uid": "c4", "part": "sources.ground", "ref": "GND1", "x": 10, "y": 200, "rot": 0, "mirror": false, "params": {} }"#
    } else {
        ""
    };
    let json = format!(
        r#"{{
  "format": 1, "app": "test", "packs": [],
  "components": [
    {{ "uid": "c1", "part": "sources.dc_voltage", "ref": "V1", "x": 0, "y": 100, "rot": 0, "mirror": false, "params": {{ "voltage": "10" }} }},
    {{ "uid": "c2", "part": "basic.resistor", "ref": "R1", "x": 100, "y": 90, "rot": 0, "mirror": false, "params": {{}} }},
    {{ "uid": "c3", "part": "basic.resistor", "ref": "R2", "x": 200, "y": 90, "rot": 0, "mirror": false, "params": {{}} }}
    {gnd}
  ],
  "wires": [
    {{ "uid": "w1", "points": [[20,100],[100,100]] }},
    {{ "uid": "w2", "points": [[160,100],[200,100]] }},
    {{ "uid": "w3", "points": [[260,100],[260,200],[20,200]] }},
    {{ "uid": "w4", "points": [[20,160],[20,200]] }}
  ],
  "analysis": {analysis},
  "probes": [],
  "view": null
}}"#
    );
    parse_project(&json).unwrap_or_else(|e| panic!("{e}\n{json}"))
}

fn root() -> PathBuf {
    components_root()
}

#[test]
fn op_run_returns_ok_with_signals() {
    let shared = SimShared::default();
    let outcome = run_simulation(&shared, &divider(r#"{ "type": "op" }"#, true), &root(), &engine_config(), Duration::from_secs(30));
    let SimOutcome::Ok { result, .. } = outcome else { panic!("{outcome:?}") };
    let values: Vec<f64> = result.signals.iter().filter(|s| s.id != "v1#branch").map(|s| s.values[0]).collect();
    assert!(values.iter().any(|v| (v - 5.0).abs() < 1e-6), "{values:?}");
    assert!(values.iter().any(|v| (v - 10.0).abs() < 1e-6), "{values:?}");
    assert!(!shared.running.load(Ordering::SeqCst));
}

#[test]
fn missing_ground_is_a_netlist_outcome() {
    let shared = SimShared::default();
    let outcome = run_simulation(&shared, &divider(r#"{ "type": "op" }"#, false), &root(), &engine_config(), Duration::from_secs(30));
    let SimOutcome::Netlist { errors } = outcome else { panic!("{outcome:?}") };
    assert!(errors.iter().any(|e| e.message.contains("no ground")));
}

#[test]
fn a_second_run_while_running_is_busy() {
    let shared = SimShared::default();
    shared.running.store(true, Ordering::SeqCst);
    let outcome = run_simulation(&shared, &divider(r#"{ "type": "op" }"#, true), &root(), &engine_config(), Duration::from_secs(30));
    assert!(matches!(outcome, SimOutcome::Busy), "{outcome:?}");
    assert!(shared.running.load(Ordering::SeqCst), "a busy reply must not clear the other run's flag");
}

#[test]
fn cancel_stops_a_long_run() {
    let shared = Arc::new(SimShared::default());
    let project = divider(r#"{ "type": "tran", "stop": "100", "step": "1u" }"#, true);
    let setter = {
        let shared = shared.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            shared.cancel.store(true, Ordering::SeqCst);
        })
    };
    let started = Instant::now();
    let outcome = run_simulation(&shared, &project, &root(), &engine_config(), Duration::from_secs(30));
    setter.join().unwrap();
    assert!(matches!(outcome, SimOutcome::Stopped), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!shared.running.load(Ordering::SeqCst));
}

#[test]
fn outcomes_serialize_with_a_status_tag() {
    assert_eq!(serde_json::to_value(SimOutcome::Stopped).unwrap(), serde_json::json!({ "status": "stopped" }));
    assert_eq!(serde_json::to_value(SimOutcome::Busy).unwrap(), serde_json::json!({ "status": "busy" }));
    assert_eq!(
        serde_json::to_value(SimOutcome::Timeout { seconds: 30 }).unwrap(),
        serde_json::json!({ "status": "timeout", "seconds": 30 })
    );
    let engine = serde_json::to_value(SimOutcome::Engine { message: "m".into(), log: vec!["l".into()] }).unwrap();
    assert_eq!(engine, serde_json::json!({ "status": "engine", "message": "m", "log": ["l"] }));

    let shared = SimShared::default();
    let ok = run_simulation(&shared, &divider(r#"{ "type": "op" }"#, true), &root(), &engine_config(), Duration::from_secs(30));
    let json = serde_json::to_value(&ok).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(json["elapsedMs"].is_u64());
    assert!(json["result"]["signals"].is_array());
    assert!(json["result"]["nets"]["wireNet"].is_object());
}
