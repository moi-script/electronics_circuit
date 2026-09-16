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
    assert_eq!(lib.parts.len(), 35, "{:?}", lib.parts.keys().collect::<Vec<_>>());
    let mut per_group: std::collections::BTreeMap<String, usize> = Default::default();
    for part in lib.parts.values() {
        *per_group.entry(format!("{:?}", part.manifest.category)).or_default() += 1;
    }
    let expected: std::collections::BTreeMap<String, usize> = [
        ("Sources", 7), ("Basic", 7), ("Diodes", 4), ("Transistors", 3), ("Analog", 2),
        ("Ttl", 4), ("Cmos", 2), ("Mixed", 1), ("Indicators", 5),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    assert_eq!(per_group, expected);
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

#[test]
fn param_key_ref_is_reserved() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "r.svg", "<svg/>");
    let manifest = RESISTOR.replace(r#""key": "resistance""#, r#""key": "ref""#).replace("{resistance}", "{ref}");
    write(tmp.path(), "resistor.json", &manifest);
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.parts.is_empty());
    assert!(lib.issues.iter().any(|i| i.message.starts_with("schema:")), "{:?}", lib.issues);
}

const SWITCH: &str = r#"{
  "schema": 1, "id": "basic.switch", "name": "Switch", "category": "Basic",
  "symbol": { "width": 60, "height": 20, "svg": "s.svg",
              "pins": [{ "id": "1", "x": 0, "y": 10 }, { "id": "2", "x": 60, "y": 10 }] },
  "params": [{ "key": "closed", "label": "State", "default": "DEFAULT", "type": "choice" OPTIONS }],
  "spice": { "kind": "analog", "refPrefix": "R", "template": "{ref} {pin.1} {pin.2} {closed}" }
}"#;

const OPEN_CLOSED: &str =
    r#"[{ "label": "Open", "value": "1e12" }, { "label": "Closed", "value": "1m" }]"#;

fn switch(default: &str, options: Option<&str>) -> String {
    let options = options.map(|o| format!(r#", "options": {o}"#)).unwrap_or_default();
    SWITCH.replace("DEFAULT", default).replace(" OPTIONS", &options)
}

fn load_switch(default: &str, options: Option<&str>) -> multysm_core::library::Library {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "s.svg", "<svg/>");
    write(tmp.path(), "switch.json", &switch(default, options));
    load_library(&[tmp.path().to_path_buf()])
}

#[test]
fn choice_param_loads_with_its_options() {
    let lib = load_switch("1e12", Some(OPEN_CLOSED));
    assert!(lib.issues.is_empty(), "{:?}", lib.issues);
    let param = &lib.get("basic.switch").unwrap().manifest.params[0];
    assert_eq!(param.kind, ParamKind::Choice);
    assert_eq!(param.options.len(), 2);
    assert_eq!(param.options[1].label, "Closed");
    assert_eq!(param.options[1].value, "1m");
}

#[test]
fn choice_param_without_options_becomes_an_issue() {
    for options in [None, Some("[]")] {
        let lib = load_switch("1e12", options);
        assert!(lib.parts.is_empty());
        assert!(lib.issues.iter().any(|i| i.message.starts_with("schema:")), "{:?}", lib.issues);
    }
}

#[test]
fn choice_default_outside_the_options_becomes_an_issue() {
    let lib = load_switch("2", Some(OPEN_CLOSED));
    assert!(lib.parts.is_empty());
    assert!(lib.issues[0].message.contains("default '2' is not one of its options"), "{:?}", lib.issues);
}

#[test]
fn unsafe_choice_value_becomes_an_issue() {
    let lib = load_switch("1 $x", Some(r#"[{ "label": "Bad", "value": "1 $x" }]"#));
    assert!(lib.parts.is_empty());
    assert!(lib.issues[0].message.contains("option value '1 $x' is not allowed"), "{:?}", lib.issues);
}

#[test]
fn choice_value_with_spice_syntax_characters_becomes_an_issue() {
    let lib = load_switch("1)", Some(r#"[{ "label": "Bad", "value": "1)" }]"#));
    assert!(lib.parts.is_empty());
    assert!(lib.issues[0].message.contains("option value '1)' is not allowed"), "{:?}", lib.issues);
}

#[test]
fn params_template_and_brace_expressions_in_a_subckt_load() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "p.svg", "<svg/>");
    write(
        tmp.path(),
        "pot.lib",
        ".subckt POT a w b params: R=10000 P=0.5\nR1 a w {max(R*P, 1e-3)}\nR2 w b {max(R*(1-P), 1e-3)}\n.ends POT\n",
    );
    write(tmp.path(), "pot.json", r#"{
      "schema": 1, "id": "basic.pot", "name": "Pot", "category": "Basic",
      "symbol": { "width": 60, "height": 30, "svg": "p.svg",
                  "pins": [{ "id": "1", "x": 0, "y": 10 }, { "id": "w", "x": 30, "y": 30 }, { "id": "2", "x": 60, "y": 10 }] },
      "params": [{ "key": "resistance", "label": "Resistance", "default": "10k", "type": "si" },
                 { "key": "position", "label": "Position", "default": "0.5", "type": "si" }],
      "spice": { "kind": "analog", "refPrefix": "RV", "subckt": "pot.lib",
                 "template": "X{ref} {pin.1} {pin.w} {pin.2} POT PARAMS: R={resistance} P={position}" }
    }"#);
    let lib = load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.issues.is_empty(), "{:?}", lib.issues);
}
