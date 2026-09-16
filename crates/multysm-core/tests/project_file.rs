use multysm_core::circuit::Analysis;
use multysm_core::project_file::{parse_project, project_to_json, ProjectFileError};

const SPEC_EXAMPLE: &str = r#"{
  "format": 1, "app": "0.1.0",
  "packs": [{ "id": "core", "version": "1.0.0" }],
  "components": [{ "uid": "c7", "part": "basic.resistor", "ref": "R1",
                   "x": 120, "y": 80, "rot": 90, "mirror": false,
                   "params": { "resistance": "4.7k" } }],
  "wires": [{ "uid": "w3", "points": [[120,80],[200,80]] }],
  "analysis": { "type": "tran", "stop": "10m", "step": "10u" },
  "probes": ["net:out"],
  "view": { "zoom": 1, "pan": [0,0] }
}"#;

#[test]
fn parses_the_spec_example_and_round_trips() {
    let project = parse_project(SPEC_EXAMPLE).unwrap();
    assert_eq!(project.components[0].reference, "R1");
    assert_eq!(project.analysis, Analysis::Tran { stop: "10m".into(), step: "10u".into() });
    let again = parse_project(&project_to_json(&project)).unwrap();
    assert_eq!(again, project);
}

#[test]
fn invalid_json_is_rejected() {
    assert!(matches!(parse_project("{ nope"), Err(ProjectFileError::Json(_))));
}

#[test]
fn wrong_format_version_is_rejected() {
    let text = SPEC_EXAMPLE.replace(r#""format": 1"#, r#""format": 2"#);
    assert!(matches!(parse_project(&text), Err(ProjectFileError::Schema(_))));
}

#[test]
fn rotation_must_be_a_right_angle() {
    let text = SPEC_EXAMPLE.replace(r#""rot": 90"#, r#""rot": 45"#);
    assert!(matches!(parse_project(&text), Err(ProjectFileError::Schema(_))));
}

#[test]
fn duplicate_uids_are_rejected() {
    let text = SPEC_EXAMPLE.replace(r#""uid": "w3""#, r#""uid": "c7""#);
    match parse_project(&text) {
        Err(ProjectFileError::Schema(messages)) => {
            assert!(messages.iter().any(|m| m.contains("duplicate uid 'c7'")), "{messages:?}")
        }
        other => panic!("expected schema error, got {other:?}"),
    }
}
