use multysm_core::library::{load_library, Category, ParamKind, Spice};
use std::fs;
use std::path::Path;

const RESISTOR: &str = r#"{
  "schema": 1, "id": "basic.resistor", "name": "Resistor", "category": "Basic",
  "symbol": { "width": 60, "height": 20, "svg": "r.svg",
              "pins": [{ "id": "1", "x": 0, "y": 10 }, { "id": "2", "x": 60, "y": 10 }] },
  "params": [{ "key": "resistance", "label": "Resistance", "unit": "Ω", "default": "1k", "type": "si" }],
  "spice": { "kind": "analog", "refPrefix": "R", "template": "{ref} {pin.1} {pin.2} {resistance}" }
}"#;

fn write(dir: &Path, rel: &str, text: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

#[test]
fn loads_a_valid_manifest() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "Basic/resistor.json", RESISTOR);
    write(tmp.path(), "Basic/r.svg", "<svg/>");

    let lib = load_library(&[tmp.path().to_path_buf()]);

    assert!(lib.issues.is_empty(), "{:?}", lib.issues);
    let part = lib.get("basic.resistor").unwrap();
    assert_eq!(part.manifest.category, Category::Basic);
    assert_eq!(part.manifest.params[0].kind, ParamKind::Si);
    assert!(matches!(part.manifest.spice, Spice::Analog(_)));
    assert_eq!(part.dir, tmp.path().join("Basic"));
}

#[test]
fn invalid_json_becomes_an_issue() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "bad.json", "{ not json");
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert_eq!(lib.issues.len(), 1);
    assert!(lib.issues[0].message.starts_with("invalid JSON"));
}

#[test]
fn schema_violation_becomes_an_issue() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "r.svg", "<svg/>");
    write(tmp.path(), "noid.json", &RESISTOR.replace(r#""id": "basic.resistor", "#, ""));
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert!(lib.issues.iter().any(|i| i.message.starts_with("schema:")));
}

#[test]
fn duplicate_ids_keep_the_first() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "a/resistor.json", RESISTOR);
    write(tmp.path(), "a/r.svg", "<svg/>");
    write(tmp.path(), "b/resistor.json", RESISTOR);
    write(tmp.path(), "b/r.svg", "<svg/>");
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert_eq!(lib.parts.len(), 1);
    assert_eq!(lib.get("basic.resistor").unwrap().dir, tmp.path().join("a"));
    assert!(lib.issues[0].message.contains("duplicate part id"));
}

#[test]
fn missing_symbol_file_becomes_an_issue() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "resistor.json", RESISTOR);
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert!(lib.issues[0].message.contains("symbol file 'r.svg' not found"));
}

#[test]
fn unknown_template_placeholder_becomes_an_issue() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "r.svg", "<svg/>");
    write(tmp.path(), "resistor.json", &RESISTOR.replace("{resistance}", "{value}"));
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert!(lib.issues[0].message.contains("unknown placeholder {value}"));
}

#[test]
fn pack_json_is_not_a_manifest() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "pack.json", r#"{ "id": "core" }"#);
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.issues.is_empty());
}

#[test]
fn category_list_has_fifteen_groups() {
    assert_eq!(Category::ALL.len(), 15);
}

mod common;

#[test]
fn core_library_loads_cleanly() {
    let lib = common::core_library();
    for id in [
        "sources.ground",
        "sources.dc_voltage",
        "sources.pulse_voltage",
        "basic.resistor",
        "basic.capacitor",
        "diodes.led",
        "ttl.7400",
        "mixed.555",
    ] {
        assert!(lib.get(id).is_some(), "missing {id}");
    }
}
