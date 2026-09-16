use multysm_app_lib::commands::{read_project_file, write_project_file};
use multysm_app_lib::library_dto::{components_root, library_dto};
use multysm_core::library::load_library;
use multysm_core::project_file::parse_project;

#[test]
fn core_library_dto_has_parts_svgs_and_prefixes() {
    let dto = library_dto(&load_library(&[components_root()]));
    assert!(dto.issues.is_empty(), "{:?}", dto.issues);
    assert_eq!(dto.categories.len(), 15);
    let resistor = dto.parts.iter().find(|p| p.manifest.id == "basic.resistor").unwrap();
    assert!(resistor.svg.contains("<svg"));
    assert_eq!(resistor.ref_prefix, "R");
    let ground = dto.parts.iter().find(|p| p.manifest.id == "sources.ground").unwrap();
    assert_eq!(ground.ref_prefix, "GND");
}

#[test]
fn library_dto_serializes_with_camel_case_fields() {
    let dto = library_dto(&load_library(&[components_root()]));
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["categories"][5], "TTL");
    let part = &json["parts"][0];
    assert!(part["refPrefix"].is_string());
    assert!(part["svg"].is_string());
    assert!(part["manifest"]["symbol"]["pins"].is_array());
}

#[test]
fn project_files_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("demo.msym");
    let project = parse_project(
        r#"{ "format": 1, "app": "0.1.0", "components": [], "wires": [],
             "analysis": { "type": "op" } }"#,
    )
    .unwrap();
    write_project_file(&path, &project).unwrap();
    assert_eq!(read_project_file(&path).unwrap(), project);
}

#[test]
fn unreadable_or_invalid_project_files_give_messages() {
    let dir = tempfile::tempdir().unwrap();
    let missing = read_project_file(&dir.path().join("missing.msym")).unwrap_err();
    assert!(missing.starts_with("Cannot open"), "{missing}");
    let bad = dir.path().join("bad.msym");
    std::fs::write(&bad, "{ nope").unwrap();
    assert!(read_project_file(&bad).unwrap_err().contains("not valid JSON"));
}
