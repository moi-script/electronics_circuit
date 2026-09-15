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

const DIODE: &str = r#"{
  "schema": 1, "id": "diodes.test", "name": "Diode", "category": "Diodes",
  "symbol": { "width": 40, "height": 20, "svg": "d.svg",
              "pins": [{ "id": "A", "x": 0, "y": 10 }, { "id": "K", "x": 40, "y": 10 }] },
  "spice": { "kind": "analog", "refPrefix": "D", "template": "{ref} {pin.A} {pin.K} DTEST",
             "models": [MODELS] SUBCKT }
}"#;

fn diode(models: &str, subckt: Option<&str>) -> String {
    let subckt = subckt.map(|s| format!(r#", "subckt": "{s}""#)).unwrap_or_default();
    DIODE.replace("MODELS", models).replace("SUBCKT", &subckt)
}

#[test]
fn model_string_with_control_block_becomes_an_issue() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "d.svg", "<svg/>");
    write(
        tmp.path(),
        "diode.json",
        &diode(r#"".model DTEST D\n.control\nshell echo pwned\n.endc""#, None),
    );
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert_eq!(lib.issues.len(), 1, "{:?}", lib.issues);
    assert!(lib.issues[0].message.contains(".control"), "{:?}", lib.issues);
}

#[test]
fn subckt_file_with_shell_becomes_an_issue() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "d.svg", "<svg/>");
    write(tmp.path(), "evil.lib", ".subckt EVIL a b\nR1 a b 1k\n.ends EVIL\nshell echo pwned\n");
    write(tmp.path(), "diode.json", &diode(r#"".model DTEST D""#, Some("evil.lib")));
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert_eq!(lib.issues.len(), 1, "{:?}", lib.issues);
    assert!(lib.issues[0].message.contains("shell"), "{:?}", lib.issues);
}

#[test]
fn include_directive_in_models_becomes_an_issue() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "d.svg", "<svg/>");
    write(tmp.path(), "diode.json", &diode(r#"".include C:/secrets.lib""#, None));
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert!(lib.issues[0].message.contains(".include"), "{:?}", lib.issues);
}

#[test]
fn clean_models_and_subckt_load() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "d.svg", "<svg/>");
    write(tmp.path(), "ok.lib", "* ok\n.subckt OK a b\nR1 a b 1k\n+ \n.ends OK\n");
    write(tmp.path(), "diode.json", &diode(r#"".model DTEST D(Is=1e-14)""#, Some("ok.lib")));
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.issues.is_empty(), "{:?}", lib.issues);
    assert!(lib.get("diodes.test").is_some());
}

#[test]
fn pin_id_with_spaces_is_a_schema_issue() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "r.svg", "<svg/>");
    write(tmp.path(), "resistor.json", &RESISTOR.replace(r#""id": "2""#, r#""id": "2 x""#));
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert!(lib.issues.iter().any(|i| i.message.starts_with("schema:")), "{:?}", lib.issues);
}

#[test]
fn symbol_path_escaping_the_root_becomes_an_issue() {
    let outer = tempfile::tempdir().unwrap();
    write(outer.path(), "outside.svg", "<svg/>");
    let root = outer.path().join("lib");
    write(&root, "Basic/resistor.json", &RESISTOR.replace("r.svg", "../../outside.svg"));
    let lib = load_library(&[root]);
    assert!(lib.parts.is_empty());
    assert_eq!(lib.issues.len(), 1, "{:?}", lib.issues);
    assert!(lib.issues[0].message.contains("outside the library folder"), "{:?}", lib.issues);
}

#[test]
fn absolute_subckt_path_becomes_an_issue() {
    let outer = tempfile::tempdir().unwrap();
    write(outer.path(), "abs.lib", ".subckt ABS a b\nR1 a b 1k\n.ends ABS\n");
    let abs = outer.path().join("abs.lib").to_string_lossy().replace('\\', "/");
    let root = outer.path().join("lib");
    write(&root, "d.svg", "<svg/>");
    write(&root, "diode.json", &diode(r#"".model DTEST D""#, Some(&abs)));
    let lib = load_library(&[root]);
    assert!(lib.parts.is_empty());
    assert_eq!(lib.issues.len(), 1, "{:?}", lib.issues);
    assert!(lib.issues[0].message.contains("must be a relative path"), "{:?}", lib.issues);
}

#[test]
fn relative_paths_inside_the_root_resolve_to_canonical_paths() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "symbols/r.svg", "<svg/>");
    write(tmp.path(), "Basic/resistor.json", &RESISTOR.replace("r.svg", "../symbols/r.svg"));
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.issues.is_empty(), "{:?}", lib.issues);
    let part = lib.get("basic.resistor").unwrap();
    assert_eq!(part.symbol_path, fs::canonicalize(tmp.path().join("symbols/r.svg")).unwrap());
    assert_eq!(part.subckt_path, None);
}

#[test]
fn core_parts_have_resolved_subckt_paths() {
    let lib = common::core_library();
    let path = lib.get("ttl.7400").unwrap().subckt_path.as_ref().unwrap();
    assert!(path.ends_with("sn7400.lib") && path.is_absolute(), "{}", path.display());
}

#[test]
fn nonexistent_root_is_exactly_one_issue() {
    let tmp = tempfile::tempdir().unwrap();
    let lib = load_library(&[tmp.path().join("does-not-exist")]);
    assert!(lib.parts.is_empty());
    assert_eq!(lib.issues.len(), 1, "{:?}", lib.issues);
}
