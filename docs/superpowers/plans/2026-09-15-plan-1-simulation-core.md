# Plan 1 — Rust Simulation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless Rust crate that loads component manifests, turns a circuit (project JSON) into a SPICE netlist, runs it through ngspice, and returns waveform data — proven by end-to-end tests on an RC circuit, an LED, a 7400 NAND gate (XSPICE digital) and a 555 astable.

**Architecture:** `crates/multysm-core` has four focused modules: `si` (value parsing), `library` (manifest types, JSON Schema validation, loader), `netlist` (templates, connectivity, netlist builder with pre-run checks) and `engine` (ngspice shared-library FFI). No Tauri or UI code; everything is verified with `cargo test`. Plan 2 (Tauri shell + editor) and Plan 3 (integration, plots, full starter pack) build on this crate.

**Tech Stack:** Rust stable (edition 2021), serde / serde_json, jsonschema 0.26, thiserror 2, walkdir 2, libloading 0.8, tempfile 3 (dev). ngspice shared library (Windows x64 `ngspice.dll`) with XSPICE code models.

**Spec:** `docs/superpowers/specs/2026-09-15-multysm-design.md`

## Global Constraints

- Platform: Windows 11 x64; Rust MSVC toolchain.
- The repo path must contain no spaces (ngspice `codemodel` command paths are unquoted). Current path: `C:\multysm`.
- ngspice lives in `vendor/ngspice/` (`ngspice.dll` + `codemodels/*.cm`) and is git-ignored.
- Manifest files: one JSON per part under `components/core/<Category>/`, validated against `schemas/manifest.schema.json`, `"schema": 1`.
- Template placeholders: `{ref}` = full reference (`R1`), `{pin.<id>}` = net name, `{<param key>}` = parameter value.
- All `si` parameter values are parsed by `si::parse_si` and written to SPICE with `si::format_spice` (never pass user text like `2M` straight to SPICE — in SPICE `M` means milli).
- SI suffix rule: `meg` (any case) and `M` = 1e6; `m` = 1e-3; `f` = 1e-15; `F` = farad unit (×1); other letters `T G K/k U/u/µ N/n P/p` case-insensitive; unknown trailing letters are units (×1).
- Ground net name is `0`; other nets are `n1`, `n2`, … in order of first pin appearance (components in project order, pins in manifest order).
- Unconnected optional pins get `Rtie_<net> <net> 0 1e9`; unconnected required pins are errors.
- The 15 categories, exact strings: `Sources`, `Basic`, `Diodes`, `Transistors`, `Analog`, `TTL`, `CMOS`, `Advanced Peripherals`, `Misc Digital`, `Mixed`, `Indicators`, `Power`, `Misc`, `RF`, `Electromechanical`.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File map

```
Cargo.toml                                   workspace
crates/multysm-core/Cargo.toml
crates/multysm-core/src/lib.rs               module list + simulate() pipeline
crates/multysm-core/src/si.rs                parse_si, format_spice
crates/multysm-core/src/circuit.rs           Project/ComponentInstance/Wire/Analysis + pin_position, point_on_segment
crates/multysm-core/src/library/mod.rs       re-exports
crates/multysm-core/src/library/manifest.rs  Manifest types
crates/multysm-core/src/library/loader.rs    load_library
crates/multysm-core/src/netlist/mod.rs       NetlistError, ErrorCode, re-exports
crates/multysm-core/src/netlist/template.rs  placeholders, render
crates/multysm-core/src/netlist/nets.rs      build_nets (union-find connectivity)
crates/multysm-core/src/netlist/build.rs     build_netlist
crates/multysm-core/src/engine/mod.rs        run_netlist, SimResult, EngineConfig
crates/multysm-core/src/engine/ffi.rs        ngspice symbols + callbacks types
crates/multysm-core/tests/common/mod.rs      paths, library(), CircuitBuilder
crates/multysm-core/tests/library.rs
crates/multysm-core/tests/nets.rs
crates/multysm-core/tests/netlist.rs
crates/multysm-core/tests/engine_smoke.rs
crates/multysm-core/tests/circuits.rs
schemas/manifest.schema.json
components/core/Sources/{ground,dc_voltage,pulse_voltage}.json
components/core/Basic/{resistor,capacitor}.json
components/core/Diodes/led.json
components/core/TTL/7400.json
components/core/Mixed/555.json
components/core/symbols/*.svg
components/core/models/{sn7400.lib,ne555.lib}
vendor/ngspice/                              (git-ignored)
```

---

### Task 0: Toolchain, ngspice and workspace scaffold

**Needs the user:** installers require approval/UAC. Run the commands, or ask the user to run them with `! <command>`.

**Files:**
- Create: `Cargo.toml`, `crates/multysm-core/Cargo.toml`, `crates/multysm-core/src/lib.rs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: a compiling crate `multysm_core`; `vendor/ngspice/ngspice.dll`, `vendor/ngspice/codemodels/analog.cm`, `vendor/ngspice/codemodels/digital.cm`.

- [ ] **Step 1: Install the MSVC build tools and Rust**

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --wait"
winget install --id Rustlang.Rustup
```
Open a new terminal, then run: `rustc --version; cargo --version`
Expected: both print a version (1.80 or newer).

- [ ] **Step 2: Download ngspice (shared library build)**

Go to https://sourceforge.net/projects/ngspice/files/ng-spice-rework/ , open the newest numbered folder (45 or newer) and download `ngspice-<version>_dll_64.7z`. Extract it (Windows 11 `tar` reads .7z):

```powershell
New-Item -ItemType Directory -Force C:\multysm\vendor\ngspice\codemodels
tar -xf $HOME\Downloads\ngspice-*_dll_64.7z -C $env:TEMP
Copy-Item "$env:TEMP\Spice64_dll\dll-vs\ngspice.dll" C:\multysm\vendor\ngspice\
Copy-Item "$env:TEMP\Spice64_dll\lib\ngspice\*.cm" C:\multysm\vendor\ngspice\codemodels\
Get-ChildItem C:\multysm\vendor\ngspice -Recurse | Select-Object Name
```
Expected: `ngspice.dll`, `analog.cm`, `digital.cm` (plus others) are listed. If the archive layout differs, locate `ngspice.dll` and the `*.cm` files inside it and copy them to the same destinations.

- [ ] **Step 3: Ignore vendor and Rust build output**

Append to `.gitignore`:
```
vendor/
Cargo.lock.bak
```
(`target/` is already ignored.)

- [ ] **Step 4: Create the workspace**

`Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["crates/multysm-core"]
```

`crates/multysm-core/Cargo.toml`:
```toml
[package]
name = "multysm-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
jsonschema = { version = "0.26", default-features = false }
walkdir = "2"
libloading = "0.8"

[dev-dependencies]
tempfile = "3"
```

`crates/multysm-core/src/lib.rs`:
```rust
//! multysm simulation core: manifests, netlists and the ngspice engine.
```

- [ ] **Step 5: Verify it builds**

Run: `cargo test -p multysm-core`
Expected: compiles, `test result: ok. 0 passed`.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock crates .gitignore
git commit -m "chore: scaffold multysm-core Rust workspace"
```

---

### Task 1: SI value parser

**Files:**
- Create: `crates/multysm-core/src/si.rs`
- Modify: `crates/multysm-core/src/lib.rs`

**Interfaces:**
- Produces: `pub fn parse_si(input: &str) -> Result<f64, SiError>`, `pub fn format_spice(value: f64) -> String`, `pub enum SiError { Empty, NotANumber(String) }`.

- [ ] **Step 1: Write the failing tests**

`crates/multysm-core/src/si.rs`:
```rust
//! Parsing of engineering values like `4.7k`, `100n`, `2meg`.

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() <= b.abs() * 1e-12 + 1e-30
    }

    #[test]
    fn plain_numbers() {
        assert_eq!(parse_si("10").unwrap(), 10.0);
        assert_eq!(parse_si(" -2.5 ").unwrap(), -2.5);
        assert_eq!(parse_si(".5").unwrap(), 0.5);
        assert_eq!(parse_si("1e3").unwrap(), 1000.0);
        assert_eq!(parse_si("3E-3").unwrap(), 0.003);
    }

    #[test]
    fn scale_suffixes() {
        assert!(close(parse_si("4.7k").unwrap(), 4700.0));
        assert!(close(parse_si("4.7K").unwrap(), 4700.0));
        assert!(close(parse_si("2meg").unwrap(), 2e6));
        assert!(close(parse_si("2MEG").unwrap(), 2e6));
        assert!(close(parse_si("2M").unwrap(), 2e6));
        assert!(close(parse_si("5m").unwrap(), 5e-3));
        assert!(close(parse_si("10u").unwrap(), 10e-6));
        assert!(close(parse_si("10µ").unwrap(), 10e-6));
        assert!(close(parse_si("100n").unwrap(), 100e-9));
        assert!(close(parse_si("22p").unwrap(), 22e-12));
        assert!(close(parse_si("3f").unwrap(), 3e-15));
        assert!(close(parse_si("1G").unwrap(), 1e9));
        assert!(close(parse_si("1T").unwrap(), 1e12));
    }

    #[test]
    fn units_are_ignored() {
        assert!(close(parse_si("10uF").unwrap(), 10e-6));
        assert!(close(parse_si("1F").unwrap(), 1.0));
        assert!(close(parse_si("5V").unwrap(), 5.0));
        assert!(close(parse_si("1kΩ").unwrap(), 1000.0));
        assert!(close(parse_si("10mA").unwrap(), 10e-3));
        assert!(close(parse_si("60Hz").unwrap(), 60.0));
    }

    #[test]
    fn rejects_non_numbers() {
        assert_eq!(parse_si(""), Err(SiError::Empty));
        assert_eq!(parse_si("   "), Err(SiError::Empty));
        assert_eq!(parse_si("abc"), Err(SiError::NotANumber("abc".into())));
        assert_eq!(parse_si("-"), Err(SiError::NotANumber("-".into())));
        assert_eq!(parse_si("."), Err(SiError::NotANumber(".".into())));
    }

    #[test]
    fn formats_for_spice() {
        assert_eq!(format_spice(4700.0), "4.7e3");
        assert_eq!(format_spice(10.0), "1e1");
        assert_eq!(format_spice(0.0), "0e0");
        assert_eq!(format_spice(1e-5), "1e-5");
        assert_eq!(format_spice(parse_si("4.7k").unwrap()), "4.7e3");
        assert_eq!(format_spice(parse_si("10u").unwrap()), "1e-5");
    }
}
```

Add to `lib.rs`:
```rust
pub mod si;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p multysm-core si::`
Expected: FAIL to compile — `cannot find function parse_si`.

- [ ] **Step 3: Implement**

Insert above the `#[cfg(test)]` block in `si.rs`:
```rust
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum SiError {
    #[error("empty value")]
    Empty,
    #[error("'{0}' is not a number")]
    NotANumber(String),
}

/// Parses an engineering value. Case rules: `meg`/`M` = 1e6, `m` = 1e-3,
/// `f` = 1e-15, `F` = farad (x1). Other scale letters are case-insensitive.
/// Unknown trailing letters are treated as units and ignored.
pub fn parse_si(input: &str) -> Result<f64, SiError> {
    let s = input.trim();
    if s.is_empty() {
        return Err(SiError::Empty);
    }
    let len = numeric_prefix_len(s);
    if len == 0 {
        return Err(SiError::NotANumber(s.to_string()));
    }
    let mantissa = &s[..len];
    let exponent = scale_exponent(&s[len..]);
    // Parse "4.7e3" rather than computing 4.7 * 1000, which is not exact.
    let parsed = if exponent == 0 {
        mantissa.parse::<f64>()
    } else if mantissa.contains(['e', 'E']) {
        mantissa.parse::<f64>().map(|v| v * 10f64.powi(exponent))
    } else {
        format!("{mantissa}e{exponent}").parse::<f64>()
    };
    parsed.map_err(|_| SiError::NotANumber(s.to_string()))
}

/// Writes a value in a form every SPICE accepts, e.g. `4.7e3`.
pub fn format_spice(value: f64) -> String {
    format!("{value:e}")
}

fn numeric_prefix_len(s: &str) -> usize {
    let b = s.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let mut digits = 0;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
        digits += 1;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return 0;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let exp_start = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > exp_start {
            i = j;
        }
    }
    i
}

fn scale_exponent(suffix: &str) -> i32 {
    let suffix = suffix.trim();
    if suffix.to_lowercase().starts_with("meg") {
        return 6;
    }
    match suffix.chars().next() {
        Some('T' | 't') => 12,
        Some('G' | 'g') => 9,
        Some('M') => 6,
        Some('K' | 'k') => 3,
        Some('m') => -3,
        Some('U' | 'u' | 'µ' | 'μ') => -6,
        Some('N' | 'n') => -9,
        Some('P' | 'p') => -12,
        Some('f') => -15,
        _ => 0,
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p multysm-core si::`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/multysm-core/src
git commit -m "feat(core): SI value parser and SPICE formatter"
```

---

### Task 2: Template placeholders and rendering

**Files:**
- Create: `crates/multysm-core/src/netlist/mod.rs`, `crates/multysm-core/src/netlist/template.rs`
- Modify: `crates/multysm-core/src/lib.rs`

**Interfaces:**
- Produces: `netlist::template::placeholders(&str) -> Result<Vec<String>, TemplateError>`, `netlist::template::render(&str, impl Fn(&str) -> Option<String>) -> Result<String, TemplateError>`, `pub enum TemplateError { Unclosed, Unknown(String) }`.

- [ ] **Step 1: Write the failing tests**

`crates/multysm-core/src/netlist/template.rs`:
```rust
//! `{placeholder}` templates used by manifests.

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn lists_placeholders_in_order() {
        assert_eq!(
            placeholders("{ref} {pin.1} {pin.2} {resistance}").unwrap(),
            vec!["ref", "pin.1", "pin.2", "resistance"]
        );
        assert_eq!(placeholders("no braces").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn unclosed_brace_is_an_error() {
        assert_eq!(placeholders("{ref {pin.1}"), Ok(vec!["ref {pin.1".to_string()]));
        assert_eq!(placeholders("{ref"), Err(TemplateError::Unclosed));
    }

    #[test]
    fn renders_values() {
        let values: BTreeMap<&str, &str> =
            [("ref", "R1"), ("pin.1", "n1"), ("pin.2", "0"), ("resistance", "1e3")].into();
        let out = render("{ref} {pin.1} {pin.2} {resistance}", |k| {
            values.get(k).map(|v| v.to_string())
        })
        .unwrap();
        assert_eq!(out, "R1 n1 0 1e3");
    }

    #[test]
    fn unknown_placeholder_is_an_error() {
        let err = render("{ref} {nope}", |k| (k == "ref").then(|| "R1".to_string()));
        assert_eq!(err, Err(TemplateError::Unknown("nope".into())));
    }
}
```

`crates/multysm-core/src/netlist/mod.rs`:
```rust
//! Circuit JSON → SPICE netlist.

pub mod template;
```

Add to `lib.rs`:
```rust
pub mod netlist;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p multysm-core template::`
Expected: FAIL to compile — `cannot find function placeholders`.

- [ ] **Step 3: Implement**

Insert above the tests in `template.rs`:
```rust
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum TemplateError {
    #[error("unclosed '{{' in template")]
    Unclosed,
    #[error("unknown placeholder {{{0}}}")]
    Unknown(String),
}

pub fn placeholders(template: &str) -> Result<Vec<String>, TemplateError> {
    let mut names = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let end = after.find('}').ok_or(TemplateError::Unclosed)?;
        names.push(after[..end].to_string());
        rest = &after[end + 1..];
    }
    Ok(names)
}

pub fn render(
    template: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<String, TemplateError> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find('}').ok_or(TemplateError::Unclosed)?;
        let name = &after[..end];
        let value = lookup(name).ok_or_else(|| TemplateError::Unknown(name.to_string()))?;
        out.push_str(&value);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p multysm-core template::`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/multysm-core/src
git commit -m "feat(core): manifest template placeholders and rendering"
```

---

### Task 3: Manifest types, JSON Schema and library loader

**Files:**
- Create: `schemas/manifest.schema.json`, `crates/multysm-core/src/library/mod.rs`, `crates/multysm-core/src/library/manifest.rs`, `crates/multysm-core/src/library/loader.rs`, `crates/multysm-core/tests/library.rs`
- Modify: `crates/multysm-core/src/lib.rs`

**Interfaces:**
- Consumes: `netlist::template::placeholders`.
- Produces:
  - `library::Manifest { schema: u32, id: String, name: String, category: Category, tags: Vec<String>, symbol: Symbol, params: Vec<Param>, spice: Spice, live: Option<serde_json::Value>, controls: Vec<serde_json::Value> }`
  - `library::Symbol { width: i64, height: i64, svg: String, pins: Vec<Pin> }`, `library::Pin { id: String, name: Option<String>, x: i64, y: i64, optional: bool }`
  - `library::Param { key: String, label: String, unit: String, default: String, kind: ParamKind }`, `library::ParamKind { Si, Text }`
  - `library::Spice { Ground, Analog(DeviceSpice), Digital(DeviceSpice) }` with `fn device(&self) -> Option<&DeviceSpice>`; `library::DeviceSpice { ref_prefix: String, template: String, models: Vec<String>, subckt: Option<String> }`
  - `library::Category` (15 variants, `Category::ALL: [Category; 15]`)
  - `library::Part { manifest: Manifest, dir: PathBuf }`, `library::LibraryIssue { path: PathBuf, message: String }`, `library::Library { parts: BTreeMap<String, Part>, issues: Vec<LibraryIssue> }` with `fn get(&self, id: &str) -> Option<&Part>`
  - `library::load_library(roots: &[PathBuf]) -> Library`

- [ ] **Step 1: Write the schema**

`schemas/manifest.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "multysm component manifest",
  "type": "object",
  "required": ["schema", "id", "name", "category", "symbol", "spice"],
  "additionalProperties": false,
  "properties": {
    "schema": { "const": 1 },
    "id": { "type": "string", "pattern": "^[a-z0-9]+(\\.[a-z0-9_]+)+$" },
    "name": { "type": "string", "minLength": 1 },
    "category": {
      "enum": ["Sources", "Basic", "Diodes", "Transistors", "Analog", "TTL", "CMOS",
               "Advanced Peripherals", "Misc Digital", "Mixed", "Indicators", "Power",
               "Misc", "RF", "Electromechanical"]
    },
    "tags": { "type": "array", "items": { "type": "string" } },
    "symbol": {
      "type": "object",
      "required": ["width", "height", "svg", "pins"],
      "additionalProperties": false,
      "properties": {
        "width": { "type": "integer", "minimum": 10 },
        "height": { "type": "integer", "minimum": 10 },
        "svg": { "type": "string", "minLength": 1 },
        "pins": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["id", "x", "y"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string", "minLength": 1 },
              "name": { "type": "string" },
              "x": { "type": "integer" },
              "y": { "type": "integer" },
              "optional": { "type": "boolean" }
            }
          }
        }
      }
    },
    "params": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "label", "default", "type"],
        "additionalProperties": false,
        "properties": {
          "key": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
          "label": { "type": "string" },
          "unit": { "type": "string" },
          "default": { "type": "string" },
          "type": { "enum": ["si", "text"] }
        }
      }
    },
    "spice": {
      "type": "object",
      "required": ["kind"],
      "properties": { "kind": { "enum": ["ground", "analog", "digital"] } },
      "if": { "properties": { "kind": { "const": "ground" } } },
      "then": { "additionalProperties": false, "properties": { "kind": true } },
      "else": {
        "required": ["refPrefix", "template"],
        "additionalProperties": false,
        "properties": {
          "kind": true,
          "refPrefix": { "type": "string", "pattern": "^[A-Z]+$" },
          "template": { "type": "string", "minLength": 1 },
          "models": { "type": "array", "items": { "type": "string" } },
          "subckt": { "type": "string" }
        }
      }
    },
    "live": { "type": ["object", "null"] },
    "controls": { "type": "array", "items": { "type": "object" } }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`crates/multysm-core/tests/library.rs`:
```rust
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p multysm-core --test library`
Expected: FAIL to compile — `could not find library in multysm_core`.

- [ ] **Step 4: Implement the manifest types**

`crates/multysm-core/src/library/manifest.rs`:
```rust
//! Component manifest types (one JSON file per part).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub category: Category,
    #[serde(default)]
    pub tags: Vec<String>,
    pub symbol: Symbol,
    #[serde(default)]
    pub params: Vec<Param>,
    pub spice: Spice,
    #[serde(default)]
    pub live: Option<serde_json::Value>,
    #[serde(default)]
    pub controls: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Category {
    Sources,
    Basic,
    Diodes,
    Transistors,
    Analog,
    #[serde(rename = "TTL")]
    Ttl,
    #[serde(rename = "CMOS")]
    Cmos,
    #[serde(rename = "Advanced Peripherals")]
    AdvancedPeripherals,
    #[serde(rename = "Misc Digital")]
    MiscDigital,
    Mixed,
    Indicators,
    Power,
    Misc,
    #[serde(rename = "RF")]
    Rf,
    Electromechanical,
}

impl Category {
    pub const ALL: [Category; 15] = [
        Category::Sources,
        Category::Basic,
        Category::Diodes,
        Category::Transistors,
        Category::Analog,
        Category::Ttl,
        Category::Cmos,
        Category::AdvancedPeripherals,
        Category::MiscDigital,
        Category::Mixed,
        Category::Indicators,
        Category::Power,
        Category::Misc,
        Category::Rf,
        Category::Electromechanical,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Symbol {
    pub width: i64,
    pub height: i64,
    pub svg: String,
    pub pins: Vec<Pin>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pin {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub x: i64,
    pub y: i64,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Param {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub unit: String,
    pub default: String,
    #[serde(rename = "type")]
    pub kind: ParamKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParamKind {
    Si,
    Text,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Spice {
    Ground,
    Analog(DeviceSpice),
    Digital(DeviceSpice),
}

impl Spice {
    pub fn device(&self) -> Option<&DeviceSpice> {
        match self {
            Spice::Ground => None,
            Spice::Analog(d) | Spice::Digital(d) => Some(d),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSpice {
    pub ref_prefix: String,
    pub template: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub subckt: Option<String>,
}
```

- [ ] **Step 5: Implement the loader**

`crates/multysm-core/src/library/loader.rs`:
```rust
//! Loads and validates manifests from one or more library folders.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use super::manifest::Manifest;
use crate::netlist::template::placeholders;

const MANIFEST_SCHEMA: &str = include_str!("../../../../schemas/manifest.schema.json");

#[derive(Debug, Clone)]
pub struct Part {
    pub manifest: Manifest,
    /// Folder containing the manifest; relative file paths resolve from here.
    pub dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LibraryIssue {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct Library {
    pub parts: BTreeMap<String, Part>,
    pub issues: Vec<LibraryIssue>,
}

impl Library {
    pub fn get(&self, id: &str) -> Option<&Part> {
        self.parts.get(id)
    }
}

pub fn load_library(roots: &[PathBuf]) -> Library {
    let schema: serde_json::Value =
        serde_json::from_str(MANIFEST_SCHEMA).expect("bundled manifest schema is valid JSON");
    let validator = jsonschema::validator_for(&schema).expect("bundled manifest schema compiles");

    let mut library = Library::default();
    let mut origins: BTreeMap<String, PathBuf> = BTreeMap::new();

    for root in roots {
        let mut files: Vec<PathBuf> = WalkDir::new(root)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.into_path())
            .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
            .filter(|p| p.file_name().is_some_and(|name| name != "pack.json"))
            .collect();
        files.sort();

        for path in files {
            match load_part(&path, &validator) {
                Ok(part) => {
                    let id = part.manifest.id.clone();
                    if let Some(first) = origins.get(&id) {
                        library.issues.push(LibraryIssue {
                            path: path.clone(),
                            message: format!(
                                "duplicate part id '{id}' (first defined in {})",
                                first.display()
                            ),
                        });
                    } else {
                        origins.insert(id.clone(), path.clone());
                        library.parts.insert(id, part);
                    }
                }
                Err(messages) => library.issues.extend(
                    messages
                        .into_iter()
                        .map(|message| LibraryIssue { path: path.clone(), message }),
                ),
            }
        }
    }
    library
}

fn load_part(path: &Path, validator: &jsonschema::Validator) -> Result<Part, Vec<String>> {
    let text = fs::read_to_string(path).map_err(|e| vec![format!("cannot read file: {e}")])?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| vec![format!("invalid JSON: {e}")])?;

    let schema_errors: Vec<String> = validator
        .iter_errors(&value)
        .map(|e| format!("schema: {e}"))
        .collect();
    if !schema_errors.is_empty() {
        return Err(schema_errors);
    }

    let manifest: Manifest =
        serde_json::from_value(value).map_err(|e| vec![format!("invalid manifest: {e}")])?;
    let dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();

    let mut problems = Vec::new();
    if !dir.join(&manifest.symbol.svg).is_file() {
        problems.push(format!("symbol file '{}' not found", manifest.symbol.svg));
    }
    if let Some(device) = manifest.spice.device() {
        if let Some(subckt) = &device.subckt {
            if !dir.join(subckt).is_file() {
                problems.push(format!("subcircuit file '{subckt}' not found"));
            }
        }
        match placeholders(&device.template) {
            Ok(names) => {
                for name in names {
                    let known = name == "ref"
                        || name.strip_prefix("pin.").is_some_and(|pin| {
                            manifest.symbol.pins.iter().any(|p| p.id == pin)
                        })
                        || manifest.params.iter().any(|p| p.key == name);
                    if !known {
                        problems.push(format!("template uses unknown placeholder {{{name}}}"));
                    }
                }
            }
            Err(e) => problems.push(format!("template: {e}")),
        }
    }

    if problems.is_empty() {
        Ok(Part { manifest, dir })
    } else {
        Err(problems)
    }
}
```

`crates/multysm-core/src/library/mod.rs`:
```rust
//! Component library: manifest types and loading.

mod loader;
mod manifest;

pub use loader::{load_library, Library, LibraryIssue, Part};
pub use manifest::{Category, DeviceSpice, Manifest, Param, ParamKind, Pin, Spice, Symbol};
```

Add to `lib.rs`:
```rust
pub mod library;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p multysm-core --test library`
Expected: 8 passed. If `jsonschema::validator_for` or `iter_errors` does not exist in the resolved version, run `cargo doc -p jsonschema --open` and use that version's equivalent (compile a `Validator` from a `&Value`; iterate errors whose `Display` is the message) — do not change the tests.

- [ ] **Step 7: Commit**

```bash
git add schemas crates/multysm-core
git commit -m "feat(core): manifest types, JSON Schema and library loader"
```

---

### Task 4: Core starter manifests for the engine tests

**Files:**
- Create: `components/core/Sources/ground.json`, `components/core/Sources/dc_voltage.json`, `components/core/Sources/pulse_voltage.json`, `components/core/Basic/resistor.json`, `components/core/Basic/capacitor.json`, `components/core/Diodes/led.json`, `components/core/TTL/7400.json`, `components/core/Mixed/555.json`, `components/core/symbols/{ground,dc_voltage,pulse_voltage,resistor,capacitor,led,dip14,timer555}.svg`, `components/core/models/sn7400.lib`, `components/core/models/ne555.lib`, `crates/multysm-core/tests/common/mod.rs`
- Modify: `crates/multysm-core/tests/library.rs`

**Interfaces:**
- Produces part ids and pin ids used by later tasks:
  - `sources.ground` pin `1`
  - `sources.dc_voltage` pins `p`, `n`; param `voltage`
  - `sources.pulse_voltage` pins `p`, `n`; params `v1 v2 delay rise fall width period`
  - `basic.resistor` pins `1`, `2`; param `resistance`
  - `basic.capacitor` pins `1`, `2`; param `capacitance`
  - `diodes.led` pins `A`, `K`
  - `ttl.7400` pins `1`–`14` (7 = GND, 14 = VCC; all others optional)
  - `mixed.555` pins `1` GND, `2` TRIG, `3` OUT, `4` RESET, `5` CTRL (optional), `6` THRES, `7` DISCH, `8` VCC
- Produces test helpers in `tests/common/mod.rs`: `workspace_root() -> PathBuf`, `core_library() -> Library`.

- [ ] **Step 1: Write the failing test**

`crates/multysm-core/tests/common/mod.rs`:
```rust
#![allow(dead_code)]

use multysm_core::library::{load_library, Library};
use std::path::{Path, PathBuf};

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crate lives in <root>/crates/multysm-core")
        .to_path_buf()
}

pub fn core_library() -> Library {
    let lib = load_library(&[workspace_root().join("components").join("core")]);
    assert!(lib.issues.is_empty(), "core library issues: {:#?}", lib.issues);
    lib
}
```

Append to `crates/multysm-core/tests/library.rs`:
```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p multysm-core --test library core_library_loads_cleanly`
Expected: FAIL — `missing sources.ground`.

- [ ] **Step 3: Write the symbols**

All symbols use `stroke="currentColor"` so the editor can recolor them.

`components/core/symbols/ground.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 0v8M2 8h16M5 12h10M8 16h4"/></svg>
```
`components/core/symbols/dc_voltage.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 0v20M20 40v20M8 20h24M14 40h12"/><path d="M17 12h6M20 9v6"/></svg>
```
`components/core/symbols/pulse_voltage.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 0v15M20 45v15"/><circle cx="20" cy="30" r="15"/><path d="M11 34h5v-8h8v8h5"/></svg>
```
`components/core/symbols/resistor.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h10l4-7 8 14 8-14 8 14 8-14 4 7h10"/></svg>
```
`components/core/symbols/capacitor.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h16M24 10h16M16 0v20M24 0v20"/></svg>
```
`components/core/symbols/led.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h13M27 10h13M13 2v16l14-8zM27 2v16M22 1l5-4M26 3l5-4"/></svg>
```
`components/core/symbols/dip14.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 160" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="5" width="60" height="150" rx="3"/><path d="M34 5a6 6 0 0 0 12 0"/></svg>
```
`components/core/symbols/timer555.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 100" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="10" width="60" height="80" rx="3"/><text x="40" y="55" font-size="12" text-anchor="middle" fill="currentColor" stroke="none">555</text></svg>
```

- [ ] **Step 4: Write the manifests**

`components/core/Sources/ground.json`:
```json
{
  "schema": 1, "id": "sources.ground", "name": "Ground", "category": "Sources",
  "tags": ["gnd", "0V"],
  "symbol": { "width": 20, "height": 20, "svg": "../symbols/ground.svg",
              "pins": [{ "id": "1", "x": 10, "y": 0 }] },
  "spice": { "kind": "ground" }
}
```

`components/core/Sources/dc_voltage.json`:
```json
{
  "schema": 1, "id": "sources.dc_voltage", "name": "DC Voltage Source", "category": "Sources",
  "tags": ["battery", "V"],
  "symbol": { "width": 40, "height": 60, "svg": "../symbols/dc_voltage.svg",
              "pins": [{ "id": "p", "name": "+", "x": 20, "y": 0 },
                       { "id": "n", "name": "-", "x": 20, "y": 60 }] },
  "params": [{ "key": "voltage", "label": "Voltage", "unit": "V", "default": "5", "type": "si" }],
  "spice": { "kind": "analog", "refPrefix": "V", "template": "{ref} {pin.p} {pin.n} DC {voltage}" }
}
```

`components/core/Sources/pulse_voltage.json`:
```json
{
  "schema": 1, "id": "sources.pulse_voltage", "name": "Pulse / Clock Source", "category": "Sources",
  "tags": ["clock", "square", "V"],
  "symbol": { "width": 40, "height": 60, "svg": "../symbols/pulse_voltage.svg",
              "pins": [{ "id": "p", "name": "+", "x": 20, "y": 0 },
                       { "id": "n", "name": "-", "x": 20, "y": 60 }] },
  "params": [
    { "key": "v1", "label": "Low voltage", "unit": "V", "default": "0", "type": "si" },
    { "key": "v2", "label": "High voltage", "unit": "V", "default": "5", "type": "si" },
    { "key": "delay", "label": "Delay", "unit": "s", "default": "0", "type": "si" },
    { "key": "rise", "label": "Rise time", "unit": "s", "default": "1n", "type": "si" },
    { "key": "fall", "label": "Fall time", "unit": "s", "default": "1n", "type": "si" },
    { "key": "width", "label": "Pulse width", "unit": "s", "default": "500u", "type": "si" },
    { "key": "period", "label": "Period", "unit": "s", "default": "1m", "type": "si" }
  ],
  "spice": { "kind": "analog", "refPrefix": "V",
             "template": "{ref} {pin.p} {pin.n} PULSE({v1} {v2} {delay} {rise} {fall} {width} {period})" }
}
```

`components/core/Basic/resistor.json`:
```json
{
  "schema": 1, "id": "basic.resistor", "name": "Resistor", "category": "Basic",
  "tags": ["passive", "R"],
  "symbol": { "width": 60, "height": 20, "svg": "../symbols/resistor.svg",
              "pins": [{ "id": "1", "x": 0, "y": 10 }, { "id": "2", "x": 60, "y": 10 }] },
  "params": [{ "key": "resistance", "label": "Resistance", "unit": "Ω", "default": "1k", "type": "si" }],
  "spice": { "kind": "analog", "refPrefix": "R", "template": "{ref} {pin.1} {pin.2} {resistance}" }
}
```

`components/core/Basic/capacitor.json`:
```json
{
  "schema": 1, "id": "basic.capacitor", "name": "Capacitor", "category": "Basic",
  "tags": ["passive", "C"],
  "symbol": { "width": 40, "height": 20, "svg": "../symbols/capacitor.svg",
              "pins": [{ "id": "1", "x": 0, "y": 10 }, { "id": "2", "x": 40, "y": 10 }] },
  "params": [{ "key": "capacitance", "label": "Capacitance", "unit": "F", "default": "1u", "type": "si" }],
  "spice": { "kind": "analog", "refPrefix": "C", "template": "{ref} {pin.1} {pin.2} {capacitance}" }
}
```

`components/core/Diodes/led.json`:
```json
{
  "schema": 1, "id": "diodes.led", "name": "LED (red)", "category": "Diodes",
  "tags": ["light", "indicator", "D"],
  "symbol": { "width": 40, "height": 20, "svg": "../symbols/led.svg",
              "pins": [{ "id": "A", "name": "Anode", "x": 0, "y": 10 },
                       { "id": "K", "name": "Cathode", "x": 40, "y": 10 }] },
  "spice": { "kind": "analog", "refPrefix": "D", "template": "{ref} {pin.A} {pin.K} LED_RED",
             "models": [".model LED_RED D(Is=1e-20 N=1.5 Rs=2 BV=5 IBV=10u)"] }
}
```

`components/core/TTL/7400.json`:
```json
{
  "schema": 1, "id": "ttl.7400", "name": "7400 Quad 2-input NAND", "category": "TTL",
  "tags": ["nand", "gate", "logic", "74"],
  "symbol": { "width": 80, "height": 160, "svg": "../symbols/dip14.svg",
    "pins": [
      { "id": "1",  "name": "1A",  "x": 0,  "y": 10,  "optional": true },
      { "id": "2",  "name": "1B",  "x": 0,  "y": 20,  "optional": true },
      { "id": "3",  "name": "1Y",  "x": 80, "y": 15,  "optional": true },
      { "id": "4",  "name": "2A",  "x": 0,  "y": 40,  "optional": true },
      { "id": "5",  "name": "2B",  "x": 0,  "y": 50,  "optional": true },
      { "id": "6",  "name": "2Y",  "x": 80, "y": 45,  "optional": true },
      { "id": "7",  "name": "GND", "x": 40, "y": 160 },
      { "id": "8",  "name": "3Y",  "x": 80, "y": 95,  "optional": true },
      { "id": "9",  "name": "3A",  "x": 0,  "y": 90,  "optional": true },
      { "id": "10", "name": "3B",  "x": 0,  "y": 100, "optional": true },
      { "id": "11", "name": "4Y",  "x": 80, "y": 125, "optional": true },
      { "id": "12", "name": "4A",  "x": 0,  "y": 120, "optional": true },
      { "id": "13", "name": "4B",  "x": 0,  "y": 130, "optional": true },
      { "id": "14", "name": "VCC", "x": 40, "y": 0 }
    ] },
  "spice": { "kind": "digital", "refPrefix": "U",
             "template": "X{ref} {pin.1} {pin.2} {pin.3} {pin.4} {pin.5} {pin.6} {pin.7} {pin.8} {pin.9} {pin.10} {pin.11} {pin.12} {pin.13} {pin.14} SN7400",
             "subckt": "../models/sn7400.lib" }
}
```

`components/core/Mixed/555.json`:
```json
{
  "schema": 1, "id": "mixed.555", "name": "555 Timer", "category": "Mixed",
  "tags": ["timer", "oscillator", "NE555", "LM555"],
  "symbol": { "width": 80, "height": 100, "svg": "../symbols/timer555.svg",
    "pins": [
      { "id": "1", "name": "GND",   "x": 40, "y": 100 },
      { "id": "2", "name": "TRIG",  "x": 0,  "y": 20 },
      { "id": "3", "name": "OUT",   "x": 80, "y": 50 },
      { "id": "4", "name": "RESET", "x": 20, "y": 0 },
      { "id": "5", "name": "CTRL",  "x": 0,  "y": 60, "optional": true },
      { "id": "6", "name": "THRES", "x": 0,  "y": 40 },
      { "id": "7", "name": "DISCH", "x": 0,  "y": 80 },
      { "id": "8", "name": "VCC",   "x": 40, "y": 0 }
    ] },
  "spice": { "kind": "analog", "refPrefix": "U",
             "template": "X{ref} {pin.1} {pin.2} {pin.3} {pin.4} {pin.5} {pin.6} {pin.7} {pin.8} NE555_BEH",
             "subckt": "../models/ne555.lib" }
}
```

- [ ] **Step 5: Write the models**

`components/core/models/sn7400.lib`:
```spice
* 7400 quad 2-input NAND (XSPICE digital) - multysm core pack
.subckt SN7400 a1 b1 y1 a2 b2 y2 gnd y3 a3 b3 y4 a4 b4 vcc
Rpwr vcc gnd 1e6
Ain [a1 b1 a2 b2 a3 b3 a4 b4] [da1 db1 da2 db2 da3 db3 da4 db4] ttl_in
Ag1 [da1 db1] dy1 ttl_nand
Ag2 [da2 db2] dy2 ttl_nand
Ag3 [da3 db3] dy3 ttl_nand
Ag4 [da4 db4] dy4 ttl_nand
Aout [dy1 dy2 dy3 dy4] [y1 y2 y3 y4] ttl_out
.model ttl_in adc_bridge(in_low=0.8 in_high=2.0)
.model ttl_out dac_bridge(out_low=0.2 out_high=3.4 out_undef=1.8)
.model ttl_nand d_nand(rise_delay=10n fall_delay=10n)
.ends SN7400
```

`components/core/models/ne555.lib`:
```spice
* Behavioral 555 timer - multysm core pack (not a vendor model)
.subckt NE555_BEH gnd trig out reset ctrl thres disch vcc
Rdiv1 vcc ctrl 5k
Rdiv2 ctrl lo 5k
Rdiv3 lo gnd 5k
* SR latch; the RC delay on q breaks the algebraic loop
Bset qraw gnd V = V(reset,gnd) < 0.7 ? 0 : (V(trig,gnd) < V(lo,gnd) ? 1 : (V(thres,gnd) > V(ctrl,gnd) ? 0 : (V(q,gnd) > 0.5 ? 1 : 0)))
Rlatch qraw q 1k
Clatch q gnd 1n
Bout oint gnd V = V(q,gnd) > 0.5 ? V(vcc,gnd) - 1.7 : 0.1
Rout oint out 10
Bqn qn gnd V = V(q,gnd) > 0.5 ? 0 : 1
Sdis disch gnd qn gnd SWDIS
.model SWDIS SW(Vt=0.5 Vh=0.1 Ron=10 Roff=1e9)
.ends NE555_BEH
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cargo test -p multysm-core --test library`
Expected: 9 passed.

- [ ] **Step 7: Commit**

```bash
git add components crates/multysm-core/tests
git commit -m "feat(core): starter manifests, symbols and models for engine tests"
```

---

### Task 5: Circuit (project) types and pin geometry

**Files:**
- Create: `crates/multysm-core/src/circuit.rs`
- Modify: `crates/multysm-core/src/lib.rs`, `crates/multysm-core/tests/common/mod.rs`

**Interfaces:**
- Consumes: `library::{Library, Pin}`.
- Produces:
  - `circuit::Project { format: u32, app: String, packs: Vec<PackRef>, components: Vec<ComponentInstance>, wires: Vec<Wire>, analysis: Analysis, probes: Vec<String>, view: Option<serde_json::Value> }`
  - `circuit::PackRef { id: String, version: String }`
  - `circuit::ComponentInstance { uid: String, part: String, reference: String /* JSON "ref" */, x: i64, y: i64, rot: u16, mirror: bool, params: BTreeMap<String, String> }`
  - `circuit::Wire { uid: String, points: Vec<[i64; 2]> }`
  - `circuit::Analysis { Op, Tran { stop, step }, Ac { start, stop, points_per_decade: u32 }, Dc { source, start, stop, step } }` (JSON tag `"type"`, `pointsPerDecade`)
  - `circuit::pin_position(&ComponentInstance, &Pin) -> (i64, i64)`
  - `circuit::point_on_segment(p: (i64, i64), a: (i64, i64), b: (i64, i64)) -> bool`
  - Test helper `common::CircuitBuilder` with `new(&Library, Analysis)`, `add(part, reference, &[(key, value)]) -> String /*uid*/`, `connect((uid, pin), (uid, pin))`, `wire(Vec<[i64; 2]>)`, `pin_pos((uid, pin)) -> (i64, i64)`, `build() -> Project`

- [ ] **Step 1: Write the failing tests**

`crates/multysm-core/src/circuit.rs`:
```rust
//! The saved circuit (`.msym` project) and schematic geometry.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Pin;

    fn inst(rot: u16, mirror: bool) -> ComponentInstance {
        ComponentInstance {
            uid: "c1".into(),
            part: "basic.resistor".into(),
            reference: "R1".into(),
            x: 100,
            y: 200,
            rot,
            mirror,
            params: Default::default(),
        }
    }

    fn pin(x: i64, y: i64) -> Pin {
        Pin { id: "2".into(), name: None, x, y, optional: false }
    }

    #[test]
    fn pin_position_applies_rotation_clockwise() {
        let p = pin(60, 10);
        assert_eq!(pin_position(&inst(0, false), &p), (160, 210));
        assert_eq!(pin_position(&inst(90, false), &p), (90, 260));
        assert_eq!(pin_position(&inst(180, false), &p), (40, 190));
        assert_eq!(pin_position(&inst(270, false), &p), (110, 140));
    }

    #[test]
    fn pin_position_mirrors_before_rotating() {
        let p = pin(60, 10);
        assert_eq!(pin_position(&inst(0, true), &p), (40, 210));
        assert_eq!(pin_position(&inst(90, true), &p), (90, 140));
    }

    #[test]
    fn point_on_segment_handles_ends_interior_and_misses() {
        assert!(point_on_segment((0, 0), (0, 0), (10, 0)));
        assert!(point_on_segment((5, 0), (0, 0), (10, 0)));
        assert!(point_on_segment((10, 0), (0, 0), (10, 0)));
        assert!(!point_on_segment((11, 0), (0, 0), (10, 0)));
        assert!(!point_on_segment((5, 1), (0, 0), (10, 0)));
        assert!(point_on_segment((3, 3), (0, 0), (6, 6)));
    }

    #[test]
    fn project_json_round_trip() {
        let json = r#"{
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
        let project: Project = serde_json::from_str(json).unwrap();
        assert_eq!(project.components[0].reference, "R1");
        assert_eq!(
            project.analysis,
            Analysis::Tran { stop: "10m".into(), step: "10u".into() }
        );
        let again: Project =
            serde_json::from_str(&serde_json::to_string(&project).unwrap()).unwrap();
        assert_eq!(again, project);
    }

    #[test]
    fn ac_analysis_uses_camel_case() {
        let a: Analysis = serde_json::from_str(
            r#"{ "type": "ac", "start": "10", "stop": "1meg", "pointsPerDecade": 20 }"#,
        )
        .unwrap();
        assert_eq!(
            a,
            Analysis::Ac { start: "10".into(), stop: "1meg".into(), points_per_decade: 20 }
        );
    }
}
```

Add to `lib.rs`:
```rust
pub mod circuit;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p multysm-core circuit::`
Expected: FAIL to compile — `cannot find type ComponentInstance`.

- [ ] **Step 3: Implement**

Insert above the tests in `circuit.rs`:
```rust
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::library::Pin;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub format: u32,
    pub app: String,
    #[serde(default)]
    pub packs: Vec<PackRef>,
    pub components: Vec<ComponentInstance>,
    pub wires: Vec<Wire>,
    pub analysis: Analysis,
    #[serde(default)]
    pub probes: Vec<String>,
    #[serde(default)]
    pub view: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackRef {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentInstance {
    pub uid: String,
    pub part: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub x: i64,
    pub y: i64,
    #[serde(default)]
    pub rot: u16,
    #[serde(default)]
    pub mirror: bool,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Wire {
    pub uid: String,
    pub points: Vec<[i64; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Analysis {
    Op,
    Tran {
        stop: String,
        step: String,
    },
    Ac {
        start: String,
        stop: String,
        #[serde(rename = "pointsPerDecade")]
        points_per_decade: u32,
    },
    Dc {
        source: String,
        start: String,
        stop: String,
        step: String,
    },
}

/// Absolute schematic position of a pin. Mirror flips the local x axis,
/// then rotation is applied clockwise on screen (y grows downward).
pub fn pin_position(inst: &ComponentInstance, pin: &Pin) -> (i64, i64) {
    let x = if inst.mirror { -pin.x } else { pin.x };
    let y = pin.y;
    let (dx, dy) = match inst.rot % 360 {
        90 => (-y, x),
        180 => (-x, -y),
        270 => (y, -x),
        _ => (x, y),
    };
    (inst.x + dx, inst.y + dy)
}

/// True when `p` lies on the closed segment from `a` to `b`.
pub fn point_on_segment(p: (i64, i64), a: (i64, i64), b: (i64, i64)) -> bool {
    let cross = (b.0 - a.0) * (p.1 - a.1) - (b.1 - a.1) * (p.0 - a.0);
    cross == 0
        && p.0 >= a.0.min(b.0)
        && p.0 <= a.0.max(b.0)
        && p.1 >= a.1.min(b.1)
        && p.1 <= a.1.max(b.1)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p multysm-core circuit::`
Expected: 5 passed.

- [ ] **Step 5: Add the CircuitBuilder test helper**

Append to `crates/multysm-core/tests/common/mod.rs`:
```rust
use multysm_core::circuit::{
    pin_position, point_on_segment, Analysis, ComponentInstance, Project, Wire,
};

/// Builds test circuits without hand-placing coordinates. Parts are placed on
/// a parabola (x = i*1000, y = i*i*1000) so straight wires rarely cross pins;
/// `connect` panics if a wire would touch any other pin. Add all parts first.
pub struct CircuitBuilder<'a> {
    library: &'a Library,
    project: Project,
}

impl<'a> CircuitBuilder<'a> {
    pub fn new(library: &'a Library, analysis: Analysis) -> Self {
        Self {
            library,
            project: Project {
                format: 1,
                app: "test".into(),
                packs: vec![],
                components: vec![],
                wires: vec![],
                analysis,
                probes: vec![],
                view: None,
            },
        }
    }

    pub fn add(&mut self, part: &str, reference: &str, params: &[(&str, &str)]) -> String {
        assert!(self.library.get(part).is_some(), "unknown part {part}");
        let i = self.project.components.len() as i64;
        let uid = format!("c{}", i + 1);
        self.project.components.push(ComponentInstance {
            uid: uid.clone(),
            part: part.into(),
            reference: reference.into(),
            x: i * 1000,
            y: i * i * 1000,
            rot: 0,
            mirror: false,
            params: params.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        });
        uid
    }

    pub fn pin_pos(&self, (uid, pin_id): (&str, &str)) -> (i64, i64) {
        let inst = self
            .project
            .components
            .iter()
            .find(|c| c.uid == uid)
            .unwrap_or_else(|| panic!("no component {uid}"));
        let pin = self
            .library
            .get(&inst.part)
            .unwrap()
            .manifest
            .symbol
            .pins
            .iter()
            .find(|p| p.id == pin_id)
            .unwrap_or_else(|| panic!("{uid} has no pin {pin_id}"));
        pin_position(inst, pin)
    }

    pub fn connect(&mut self, a: (&str, &str), b: (&str, &str)) {
        let pa = self.pin_pos(a);
        let pb = self.pin_pos(b);
        for inst in &self.project.components {
            for pin in &self.library.get(&inst.part).unwrap().manifest.symbol.pins {
                let key = (inst.uid.as_str(), pin.id.as_str());
                if key == a || key == b {
                    continue;
                }
                assert!(
                    !point_on_segment(pin_position(inst, pin), pa, pb),
                    "wire {a:?} -> {b:?} would touch {key:?}; reorder the parts"
                );
            }
        }
        self.wire(vec![[pa.0, pa.1], [pb.0, pb.1]]);
    }

    pub fn wire(&mut self, points: Vec<[i64; 2]>) {
        let uid = format!("w{}", self.project.wires.len() + 1);
        self.project.wires.push(Wire { uid, points });
    }

    pub fn build(self) -> Project {
        self.project
    }
}
```

Run: `cargo test -p multysm-core`
Expected: all tests pass (the helper compiles; `dead_code` is allowed).

- [ ] **Step 6: Commit**

```bash
git add crates/multysm-core
git commit -m "feat(core): project types, pin geometry and test circuit builder"
```

---

### Task 6: Connectivity (nets)

**Files:**
- Create: `crates/multysm-core/src/netlist/nets.rs`, `crates/multysm-core/tests/nets.rs`
- Modify: `crates/multysm-core/src/netlist/mod.rs`

**Interfaces:**
- Consumes: `circuit::{Project, pin_position, point_on_segment}`, `library::{Library, Spice}`.
- Produces:
  - `netlist::NetlistError { code: ErrorCode, message: String, component_uid: Option<String> }` with `NetlistError::new(code, message: String, uid: Option<&str>)`; derives `Debug, Clone, PartialEq, serde::Serialize`
  - `netlist::ErrorCode { UnknownPart, NoGround, UnconnectedPin, InvalidParam, Template, ModelFile, BadAnalysis }` (serde `snake_case`)
  - `netlist::PinKey = (String, String)` (component uid, pin id)
  - `netlist::Nets { pin_net: BTreeMap<PinKey, String>, net_pins: BTreeMap<String, Vec<PinKey>> }`
  - `netlist::GROUND: &str = "0"`
  - `netlist::build_nets(&Project, &Library) -> Result<Nets, Vec<NetlistError>>`

- [ ] **Step 1: Write the failing tests**

`crates/multysm-core/tests/nets.rs`:
```rust
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
```

Replace `crates/multysm-core/src/netlist/mod.rs` with:
```rust
//! Circuit JSON → SPICE netlist.

mod nets;
pub mod template;

pub use nets::{build_nets, Nets, PinKey, GROUND};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    UnknownPart,
    NoGround,
    UnconnectedPin,
    InvalidParam,
    Template,
    ModelFile,
    BadAnalysis,
}

/// A problem found before simulation, tied to a component when possible so
/// the editor can highlight it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NetlistError {
    pub code: ErrorCode,
    pub message: String,
    pub component_uid: Option<String>,
}

impl NetlistError {
    pub fn new(code: ErrorCode, message: String, uid: Option<&str>) -> Self {
        Self { code, message, component_uid: uid.map(str::to_string) }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p multysm-core --test nets`
Expected: FAIL to compile — `file not found for module nets`.

- [ ] **Step 3: Implement**

`crates/multysm-core/src/netlist/nets.rs`:
```rust
//! Connectivity: which pins are joined by wires.
//!
//! Rules: consecutive wire vertices are joined; any pin or wire vertex lying
//! on a wire segment joins that wire; pins/vertices at the same coordinate
//! are joined. Wires that merely cross (no vertex on the other) stay apart.

use std::collections::BTreeMap;

use super::{ErrorCode, NetlistError};
use crate::circuit::{pin_position, point_on_segment, Project};
use crate::library::{Library, Spice};

pub type PinKey = (String, String);

pub const GROUND: &str = "0";

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Nets {
    pub pin_net: BTreeMap<PinKey, String>,
    pub net_pins: BTreeMap<String, Vec<PinKey>>,
}

pub fn build_nets(project: &Project, library: &Library) -> Result<Nets, Vec<NetlistError>> {
    let mut errors = Vec::new();
    let mut points: Vec<(i64, i64)> = Vec::new();
    let mut pins: Vec<(PinKey, bool)> = Vec::new(); // index-aligned with the first points

    for inst in &project.components {
        let Some(part) = library.get(&inst.part) else {
            errors.push(NetlistError::new(
                ErrorCode::UnknownPart,
                format!("{}: unknown part '{}'", inst.reference, inst.part),
                Some(inst.uid.as_str()),
            ));
            continue;
        };
        let is_ground = matches!(part.manifest.spice, Spice::Ground);
        for pin in &part.manifest.symbol.pins {
            points.push(pin_position(inst, pin));
            pins.push(((inst.uid.clone(), pin.id.clone()), is_ground));
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    let mut segments: Vec<(usize, usize)> = Vec::new();
    for wire in &project.wires {
        let first = points.len();
        points.extend(wire.points.iter().map(|p| (p[0], p[1])));
        for i in 1..wire.points.len() {
            segments.push((first + i - 1, first + i));
        }
    }

    let mut sets = UnionFind::new(points.len());
    let mut by_coord: BTreeMap<(i64, i64), usize> = BTreeMap::new();
    for (i, p) in points.iter().enumerate() {
        match by_coord.get(p) {
            Some(&j) => sets.union(i, j),
            None => {
                by_coord.insert(*p, i);
            }
        }
    }
    for &(a, b) in &segments {
        sets.union(a, b);
        for (i, p) in points.iter().enumerate() {
            if point_on_segment(*p, points[a], points[b]) {
                sets.union(i, a);
            }
        }
    }

    let mut names: BTreeMap<usize, String> = BTreeMap::new();
    for (i, (_, is_ground)) in pins.iter().enumerate() {
        if *is_ground {
            names.insert(sets.find(i), GROUND.to_string());
        }
    }
    let mut next = 1;
    let mut nets = Nets::default();
    for (i, (key, _)) in pins.iter().enumerate() {
        let root = sets.find(i);
        let name = names
            .entry(root)
            .or_insert_with(|| {
                let name = format!("n{next}");
                next += 1;
                name
            })
            .clone();
        nets.pin_net.insert(key.clone(), name.clone());
        nets.net_pins.entry(name).or_default().push(key.clone());
    }
    Ok(nets)
}

struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        Self { parent: (0..n).collect() }
    }

    fn find(&mut self, i: usize) -> usize {
        let mut root = i;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        let mut node = i;
        while self.parent[node] != root {
            let next = self.parent[node];
            self.parent[node] = root;
            node = next;
        }
        root
    }

    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.parent[rb.max(ra)] = ra.min(rb);
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p multysm-core --test nets`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/multysm-core
git commit -m "feat(core): wire connectivity and net naming"
```

---

### Task 7: Netlist builder with pre-run checks

**Files:**
- Create: `crates/multysm-core/src/netlist/build.rs`, `crates/multysm-core/tests/netlist.rs`
- Modify: `crates/multysm-core/src/netlist/mod.rs`

**Interfaces:**
- Consumes: `build_nets`, `template::render`, `si::{parse_si, format_spice}`, `library::{Library, ParamKind, Spice}`, `circuit::{Analysis, Project}`.
- Produces: `netlist::Netlist { text: String, nets: Nets }`, `netlist::build_netlist(&Project, &Library) -> Result<Netlist, Vec<NetlistError>>`.

- [ ] **Step 1: Write the failing tests**

`crates/multysm-core/tests/netlist.rs`:
```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p multysm-core --test netlist`
Expected: FAIL to compile — `no function build_netlist in netlist`.

- [ ] **Step 3: Implement**

In `crates/multysm-core/src/netlist/mod.rs`, change the module list to:
```rust
mod build;
mod nets;
pub mod template;

pub use build::{build_netlist, Netlist};
pub use nets::{build_nets, Nets, PinKey, GROUND};
```

`crates/multysm-core/src/netlist/build.rs`:
```rust
//! Builds SPICE netlist text from a project, with pre-run checks.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use super::nets::{build_nets, Nets, GROUND};
use super::template::render;
use super::{ErrorCode, NetlistError};
use crate::circuit::{Analysis, Project};
use crate::library::{Library, ParamKind};
use crate::si::{format_spice, parse_si};

#[derive(Debug, Clone, PartialEq)]
pub struct Netlist {
    pub text: String,
    pub nets: Nets,
}

pub fn build_netlist(project: &Project, library: &Library) -> Result<Netlist, Vec<NetlistError>> {
    let nets = build_nets(project, library)?;
    let mut errors = Vec::new();

    if !nets.net_pins.contains_key(GROUND) {
        errors.push(NetlistError::new(
            ErrorCode::NoGround,
            "The circuit has no ground. Add a Ground part.".into(),
            None,
        ));
    }

    let mut tie_lines = Vec::new();
    for (net, pins) in &nets.net_pins {
        if net == GROUND || pins.len() != 1 {
            continue;
        }
        let (uid, pin_id) = &pins[0];
        let inst = project
            .components
            .iter()
            .find(|c| &c.uid == uid)
            .expect("pin belongs to a component");
        let part = library.get(&inst.part).expect("build_nets verified parts");
        let pin = part
            .manifest
            .symbol
            .pins
            .iter()
            .find(|p| &p.id == pin_id)
            .expect("pin exists in manifest");
        if pin.optional {
            tie_lines.push(format!("Rtie_{net} {net} 0 1e9"));
        } else {
            errors.push(NetlistError::new(
                ErrorCode::UnconnectedPin,
                format!("{} pin {} is not connected", inst.reference, pin.name.as_deref().unwrap_or(&pin.id)),
                Some(uid.as_str()),
            ));
        }
    }

    let mut device_lines = Vec::new();
    let mut models: Vec<String> = Vec::new();
    let mut subckt_files: Vec<(PathBuf, String)> = Vec::new(); // (path, owning component uid)

    for inst in &project.components {
        let part = library.get(&inst.part).expect("build_nets verified parts");
        let Some(device) = part.manifest.spice.device() else {
            continue;
        };
        let errors_before = errors.len();

        let mut values: BTreeMap<String, String> = BTreeMap::new();
        values.insert("ref".into(), inst.reference.clone());
        for pin in &part.manifest.symbol.pins {
            let net = &nets.pin_net[&(inst.uid.clone(), pin.id.clone())];
            values.insert(format!("pin.{}", pin.id), net.clone());
        }
        for param in &part.manifest.params {
            let raw = inst.params.get(&param.key).unwrap_or(&param.default);
            let value = match param.kind {
                ParamKind::Text => raw.clone(),
                ParamKind::Si => match parse_si(raw) {
                    Ok(v) => format_spice(v),
                    Err(_) => {
                        errors.push(NetlistError::new(
                            ErrorCode::InvalidParam,
                            format!("{}: {} '{}' is not a valid value", inst.reference, param.label, raw),
                            Some(inst.uid.as_str()),
                        ));
                        continue;
                    }
                },
            };
            values.insert(param.key.clone(), value);
        }

        match render(&device.template, |name| values.get(name).cloned()) {
            Ok(line) => device_lines.push(line),
            Err(e) if errors.len() == errors_before => errors.push(NetlistError::new(
                ErrorCode::Template,
                format!("{}: {e}", inst.reference),
                Some(inst.uid.as_str()),
            )),
            Err(_) => {}
        }

        for model in &device.models {
            if !models.contains(model) {
                models.push(model.clone());
            }
        }
        if let Some(subckt) = &device.subckt {
            let path = part.dir.join(subckt);
            if !subckt_files.iter().any(|(p, _)| p == &path) {
                subckt_files.push((path, inst.uid.clone()));
            }
        }
    }

    let mut subckt_texts = Vec::new();
    for (path, uid) in &subckt_files {
        match fs::read_to_string(path) {
            Ok(text) => subckt_texts.push(text.trim_end().to_string()),
            Err(e) => errors.push(NetlistError::new(
                ErrorCode::ModelFile,
                format!("cannot read model file {}: {e}", path.display()),
                Some(uid.as_str()),
            )),
        }
    }

    let directive = analysis_directive(project).map_err(|e| errors.push(e));

    if !errors.is_empty() {
        return Err(errors);
    }

    let mut lines = vec!["* multysm netlist".to_string()];
    lines.extend(device_lines);
    lines.extend(tie_lines);
    lines.extend(models);
    lines.extend(subckt_texts);
    lines.push(directive.expect("errors checked above"));
    lines.push(".end".into());
    Ok(Netlist { text: lines.join("\n") + "\n", nets })
}

fn analysis_directive(project: &Project) -> Result<String, NetlistError> {
    let si = |label: &str, raw: &str| {
        parse_si(raw).map(format_spice).map_err(|_| {
            NetlistError::new(
                ErrorCode::BadAnalysis,
                format!("Analysis {label} '{raw}' is not a valid value"),
                None,
            )
        })
    };
    Ok(match &project.analysis {
        Analysis::Op => ".op".to_string(),
        Analysis::Tran { stop, step } => {
            format!(".tran {} {}", si("step", step)?, si("stop time", stop)?)
        }
        Analysis::Ac { start, stop, points_per_decade } => format!(
            ".ac dec {} {} {}",
            points_per_decade,
            si("start frequency", start)?,
            si("stop frequency", stop)?
        ),
        Analysis::Dc { source, start, stop, step } => {
            if !project.components.iter().any(|c| &c.reference == source) {
                return Err(NetlistError::new(
                    ErrorCode::BadAnalysis,
                    format!("DC sweep source '{source}' is not in the circuit"),
                    None,
                ));
            }
            format!(".dc {} {} {} {}", source, si("start", start)?, si("stop", stop)?, si("step", step)?)
        }
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p multysm-core --test netlist`
Expected: 8 passed.

If `models_and_subcircuits_are_included_once` or another builder-based test panics with "would touch", swap the order of the two `connect` calls it names or add the parts in a different order — do not weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add crates/multysm-core
git commit -m "feat(core): netlist builder with pre-run checks"
```

---

### Task 8: ngspice engine (FFI)

**Files:**
- Create: `crates/multysm-core/src/engine/ffi.rs`, `crates/multysm-core/src/engine/mod.rs`, `crates/multysm-core/tests/engine_smoke.rs`
- Modify: `crates/multysm-core/src/lib.rs`, `crates/multysm-core/tests/common/mod.rs`

**Interfaces:**
- Produces:
  - `engine::EngineConfig { dll_path: PathBuf, codemodel_dir: PathBuf }` with `EngineConfig::from_vendor_dir(&Path)`
  - `engine::run_netlist(&EngineConfig, netlist: &str) -> Result<SimResult, EngineError>` (thread-safe; one ngspice instance per process)
  - `engine::SimResult { plot: String, vectors: BTreeMap<String, Vector>, log: Vec<String> }` with `real(&str) -> Option<&[f64]>`, `last(&str) -> Option<f64>`, `sample_at(&str, t: f64) -> Option<f64>`
  - `engine::Vector { Real(Vec<f64>), Complex(Vec<(f64, f64)>) }`
  - `engine::EngineError { Load { path, reason }, Circuit { log }, Run { log }, ConfigMismatch }`
  - Test helper `common::engine_config() -> EngineConfig`

- [ ] **Step 1: Write the failing test**

Append to `crates/multysm-core/tests/common/mod.rs`:
```rust
use multysm_core::engine::EngineConfig;

pub fn engine_config() -> EngineConfig {
    let dir = workspace_root().join("vendor").join("ngspice");
    assert!(
        dir.join("ngspice.dll").is_file(),
        "ngspice not found in {} — see Plan 1, Task 0",
        dir.display()
    );
    EngineConfig::from_vendor_dir(&dir)
}
```

`crates/multysm-core/tests/engine_smoke.rs`:
```rust
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
```

Add to `lib.rs`:
```rust
pub mod engine;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p multysm-core --test engine_smoke`
Expected: FAIL to compile — `could not find engine`.

- [ ] **Step 3: Implement the FFI bindings**

`crates/multysm-core/src/engine/ffi.rs`:
```rust
//! Raw bindings to the ngspice shared library (sharedspice.h).

use std::os::raw::{c_char, c_double, c_int, c_short, c_void};
use std::path::Path;

use libloading::Library;

#[repr(C)]
pub struct NgComplex {
    pub cx_real: c_double,
    pub cx_imag: c_double,
}

#[repr(C)]
pub struct VectorInfo {
    pub v_name: *mut c_char,
    pub v_type: c_int,
    pub v_flags: c_short,
    pub v_realdata: *mut c_double,
    pub v_compdata: *mut NgComplex,
    pub v_length: c_int,
}

pub type SendChar = unsafe extern "C" fn(*mut c_char, c_int, *mut c_void) -> c_int;
pub type SendStat = unsafe extern "C" fn(*mut c_char, c_int, *mut c_void) -> c_int;
pub type ControlledExit = unsafe extern "C" fn(c_int, bool, bool, c_int, *mut c_void) -> c_int;
pub type SendData = unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut c_void) -> c_int;
pub type SendInitData = unsafe extern "C" fn(*mut c_void, c_int, *mut c_void) -> c_int;
pub type BgThreadRunning = unsafe extern "C" fn(bool, c_int, *mut c_void) -> c_int;

type InitFn = unsafe extern "C" fn(
    Option<SendChar>,
    Option<SendStat>,
    Option<ControlledExit>,
    Option<SendData>,
    Option<SendInitData>,
    Option<BgThreadRunning>,
    *mut c_void,
) -> c_int;
type CircFn = unsafe extern "C" fn(*mut *mut c_char) -> c_int;
type CommandFn = unsafe extern "C" fn(*const c_char) -> c_int;
type CurPlotFn = unsafe extern "C" fn() -> *mut c_char;
type AllVecsFn = unsafe extern "C" fn(*mut c_char) -> *mut *mut c_char;
type VecInfoFn = unsafe extern "C" fn(*mut c_char) -> *mut VectorInfo;

pub struct NgspiceApi {
    pub init: InitFn,
    pub circ: CircFn,
    pub command: CommandFn,
    pub cur_plot: CurPlotFn,
    pub all_vecs: AllVecsFn,
    pub vec_info: VecInfoFn,
}

impl NgspiceApi {
    /// Loads the library and keeps it loaded for the life of the process
    /// (ngspice cannot be safely unloaded and reloaded).
    ///
    /// # Safety
    /// `path` must point to a genuine ngspice shared library.
    pub unsafe fn load(path: &Path) -> Result<Self, libloading::Error> {
        let lib: &'static Library = Box::leak(Box::new(Library::new(path)?));
        Ok(Self {
            init: *lib.get::<InitFn>(b"ngSpice_Init\0")?,
            circ: *lib.get::<CircFn>(b"ngSpice_Circ\0")?,
            command: *lib.get::<CommandFn>(b"ngSpice_Command\0")?,
            cur_plot: *lib.get::<CurPlotFn>(b"ngSpice_CurPlot\0")?,
            all_vecs: *lib.get::<AllVecsFn>(b"ngSpice_AllVecs\0")?,
            vec_info: *lib.get::<VecInfoFn>(b"ngGet_Vec_Info\0")?,
        })
    }
}
```

- [ ] **Step 4: Implement the engine**

`crates/multysm-core/src/engine/mod.rs`:
```rust
//! Runs netlists through the ngspice shared library.
//!
//! ngspice keeps global state, so there is exactly one instance per process,
//! guarded by a mutex. Output lines from ngspice are collected into a log;
//! lines starting with "stderr" that mention "error" or "aborted" fail the run.

mod ffi;

use std::collections::BTreeMap;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub struct EngineConfig {
    pub dll_path: PathBuf,
    pub codemodel_dir: PathBuf,
}

impl EngineConfig {
    pub fn from_vendor_dir(dir: &Path) -> Self {
        Self { dll_path: dir.join("ngspice.dll"), codemodel_dir: dir.join("codemodels") }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("could not load ngspice from {path}: {reason}")]
    Load { path: PathBuf, reason: String },
    #[error("ngspice rejected the circuit:\n{}", .log.join("\n"))]
    Circuit { log: Vec<String> },
    #[error("simulation failed:\n{}", .log.join("\n"))]
    Run { log: Vec<String> },
    #[error("ngspice is already loaded from a different path")]
    ConfigMismatch,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Vector {
    Real(Vec<f64>),
    Complex(Vec<(f64, f64)>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct SimResult {
    pub plot: String,
    /// Keyed by lower-case vector name, e.g. `time`, `n1`, `v1#branch`.
    pub vectors: BTreeMap<String, Vector>,
    pub log: Vec<String>,
}

impl SimResult {
    pub fn real(&self, name: &str) -> Option<&[f64]> {
        match self.vectors.get(&name.to_lowercase())? {
            Vector::Real(values) => Some(values),
            Vector::Complex(_) => None,
        }
    }

    pub fn last(&self, name: &str) -> Option<f64> {
        self.real(name)?.last().copied()
    }

    /// Linear interpolation of `name` at time `t` (transient results).
    pub fn sample_at(&self, name: &str, t: f64) -> Option<f64> {
        let time = self.real("time")?;
        let values = self.real(name)?;
        let i = time.iter().position(|&x| x >= t)?;
        if i == 0 {
            return values.first().copied();
        }
        let (t0, t1, v0, v1) = (time[i - 1], time[i], values[i - 1], values[i]);
        Some(if t1 == t0 { v1 } else { v0 + (v1 - v0) * (t - t0) / (t1 - t0) })
    }
}

static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);

pub fn run_netlist(config: &EngineConfig, netlist: &str) -> Result<SimResult, EngineError> {
    let mut guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(Engine::start(config)?);
    }
    let engine = guard.as_ref().expect("engine started above");
    if engine.dll_path != config.dll_path {
        return Err(EngineError::ConfigMismatch);
    }
    engine.run(netlist)
}

struct Engine {
    api: ffi::NgspiceApi,
    dll_path: PathBuf,
}

impl Engine {
    fn start(config: &EngineConfig) -> Result<Self, EngineError> {
        let load_error = |reason: String| EngineError::Load { path: config.dll_path.clone(), reason };
        let api = unsafe { ffi::NgspiceApi::load(&config.dll_path) }
            .map_err(|e| load_error(e.to_string()))?;
        unsafe {
            (api.init)(
                Some(on_output),
                Some(on_status),
                Some(on_exit),
                Some(on_data),
                Some(on_init_data),
                Some(on_bg_thread),
                std::ptr::null_mut(),
            );
        }
        let engine = Self { api, dll_path: config.dll_path.clone() };
        for name in ["analog.cm", "digital.cm"] {
            let path = config.codemodel_dir.join(name);
            if !path.is_file() {
                return Err(load_error(format!("code model {} not found", path.display())));
            }
            let path = path.to_string_lossy().replace('\\', "/");
            engine.command(&format!("codemodel {path}"));
        }
        take_log();
        Ok(engine)
    }

    fn command(&self, command: &str) -> c_int {
        let command = CString::new(command).expect("command has no NUL byte");
        unsafe { (self.api.command)(command.as_ptr()) }
    }

    fn run(&self, netlist: &str) -> Result<SimResult, EngineError> {
        self.command("remcirc");
        self.command("destroy all");
        take_log();

        let lines: Vec<CString> = netlist
            .lines()
            .map(|line| CString::new(line).expect("netlist has no NUL byte"))
            .collect();
        let mut pointers: Vec<*mut c_char> =
            lines.iter().map(|line| line.as_ptr() as *mut c_char).collect();
        pointers.push(std::ptr::null_mut());

        let status = unsafe { (self.api.circ)(pointers.as_mut_ptr()) };
        let mut log = take_log();
        if status != 0 || has_error(&log) {
            return Err(EngineError::Circuit { log });
        }

        let status = self.command("run");
        log.extend(take_log());
        if status != 0 || has_error(&log) {
            return Err(EngineError::Run { log });
        }

        let (plot, vectors) = unsafe { self.collect_vectors() };
        if vectors.is_empty() {
            return Err(EngineError::Run { log });
        }
        Ok(SimResult { plot, vectors, log })
    }

    unsafe fn collect_vectors(&self) -> (String, BTreeMap<String, Vector>) {
        let plot_ptr = (self.api.cur_plot)();
        if plot_ptr.is_null() {
            return (String::new(), BTreeMap::new());
        }
        let plot = CStr::from_ptr(plot_ptr).to_string_lossy().into_owned();
        let names = (self.api.all_vecs)(plot_ptr);
        let mut vectors = BTreeMap::new();
        if names.is_null() {
            return (plot, vectors);
        }
        let mut i = 0;
        loop {
            let name_ptr = *names.add(i);
            if name_ptr.is_null() {
                break;
            }
            let name = CStr::from_ptr(name_ptr).to_string_lossy().to_lowercase();
            let info = (self.api.vec_info)(name_ptr);
            if !info.is_null() {
                let info = &*info;
                let len = info.v_length.max(0) as usize;
                if !info.v_realdata.is_null() {
                    let data = std::slice::from_raw_parts(info.v_realdata, len).to_vec();
                    vectors.insert(name, Vector::Real(data));
                } else if !info.v_compdata.is_null() {
                    let data = std::slice::from_raw_parts(info.v_compdata, len)
                        .iter()
                        .map(|c| (c.cx_real, c.cx_imag))
                        .collect();
                    vectors.insert(name, Vector::Complex(data));
                }
            }
            i += 1;
        }
        (plot, vectors)
    }
}

fn has_error(log: &[String]) -> bool {
    log.iter().any(|line| {
        let line = line.to_lowercase();
        line.starts_with("stderr") && (line.contains("error") || line.contains("aborted"))
    })
}

fn push_log(line: String) {
    LOG.lock().unwrap_or_else(|e| e.into_inner()).push(line);
}

fn take_log() -> Vec<String> {
    std::mem::take(&mut *LOG.lock().unwrap_or_else(|e| e.into_inner()))
}

unsafe extern "C" fn on_output(text: *mut c_char, _id: c_int, _user: *mut c_void) -> c_int {
    if !text.is_null() {
        push_log(CStr::from_ptr(text).to_string_lossy().into_owned());
    }
    0
}

unsafe extern "C" fn on_status(_text: *mut c_char, _id: c_int, _user: *mut c_void) -> c_int {
    0
}

unsafe extern "C" fn on_exit(
    status: c_int,
    _unload: bool,
    _quit: bool,
    _id: c_int,
    _user: *mut c_void,
) -> c_int {
    push_log(format!("stderr Error: ngspice requested exit (status {status})"));
    0
}

unsafe extern "C" fn on_data(_data: *mut c_void, _count: c_int, _id: c_int, _user: *mut c_void) -> c_int {
    0
}

unsafe extern "C" fn on_init_data(_data: *mut c_void, _id: c_int, _user: *mut c_void) -> c_int {
    0
}

unsafe extern "C" fn on_bg_thread(_running: bool, _id: c_int, _user: *mut c_void) -> c_int {
    0
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p multysm-core --test engine_smoke`
Expected: 4 passed.

If a test fails, print `result.log` / the error log first (it contains ngspice's own messages) and use superpowers:systematic-debugging. Known pitfalls: a missing MSVC runtime makes `Library::new` fail (install the "Microsoft Visual C++ Redistributable x64"); vector names differ in case (the code lower-cases them).

- [ ] **Step 6: Commit**

```bash
git add crates/multysm-core
git commit -m "feat(core): ngspice shared-library engine"
```

---

### Task 9: `simulate` pipeline and end-to-end circuit tests

**Files:**
- Modify: `crates/multysm-core/src/lib.rs`
- Create: `crates/multysm-core/tests/circuits.rs`

**Interfaces:**
- Consumes: `build_netlist`, `run_netlist`, `CircuitBuilder`, `core_library`, `engine_config`.
- Produces: `multysm_core::simulate(&Project, &Library, &EngineConfig) -> Result<(Netlist, SimResult), SimulateError>`, `multysm_core::SimulateError { Netlist(Vec<NetlistError>), Engine(EngineError) }` — the function Plan 3's Tauri command will call.

- [ ] **Step 1: Write the failing tests**

`crates/multysm-core/tests/circuits.rs`:
```rust
mod common;

use common::{core_library, engine_config, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::simulate;

fn net(netlist: &multysm_core::netlist::Netlist, uid: &str, pin: &str) -> String {
    netlist.nets.pin_net[&(uid.to_string(), pin.to_string())].clone()
}

#[test]
fn rc_charges_to_63_percent_at_tau() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Tran { stop: "5m".into(), step: "10u".into() });
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add(
        "sources.pulse_voltage",
        "V1",
        &[("v1", "0"), ("v2", "5"), ("rise", "1u"), ("fall", "1u"), ("width", "1"), ("period", "2")],
    );
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let c1 = b.add("basic.capacitor", "C1", &[("capacitance", "1u")]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&c1, "1"));
    b.connect((&c1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));

    let (netlist, result) = simulate(&b.build(), &lib, &engine_config()).unwrap();

    let v = result.sample_at(&net(&netlist, &c1, "1"), 1e-3).unwrap();
    let expected = 5.0 * (1.0 - (-1.0f64).exp());
    assert!((v - expected).abs() / expected < 0.03, "v(C1) at tau = {v}, expected {expected}");
}

#[test]
fn led_forward_voltage_is_realistic() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "330")]);
    let d1 = b.add("diodes.led", "D1", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&d1, "A"));
    b.connect((&d1, "K"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));

    let (netlist, result) = simulate(&b.build(), &lib, &engine_config()).unwrap();

    let vf = result.last(&net(&netlist, &d1, "A")).unwrap();
    assert!((1.5..2.0).contains(&vf), "LED forward voltage {vf}");
}

#[test]
fn nand_gate_truth_table() {
    let lib = core_library();
    let config = engine_config();
    for (a, b_in, expect_high) in [("0", "0", true), ("0", "5", true), ("5", "0", true), ("5", "5", false)] {
        let mut b = CircuitBuilder::new(&lib, Analysis::Tran { stop: "1m".into(), step: "10u".into() });
        let gnd = b.add("sources.ground", "GND1", &[]);
        let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
        let va = b.add("sources.dc_voltage", "VA", &[("voltage", a)]);
        let vb = b.add("sources.dc_voltage", "VB", &[("voltage", b_in)]);
        let u1 = b.add("ttl.7400", "U1", &[]);
        b.connect((&vcc, "p"), (&u1, "14"));
        b.connect((&vcc, "n"), (&gnd, "1"));
        b.connect((&u1, "7"), (&gnd, "1"));
        b.connect((&va, "p"), (&u1, "1"));
        b.connect((&va, "n"), (&gnd, "1"));
        b.connect((&vb, "p"), (&u1, "2"));
        b.connect((&vb, "n"), (&gnd, "1"));

        let (netlist, result) = simulate(&b.build(), &lib, &config).unwrap();

        let y = result.last(&net(&netlist, &u1, "3")).unwrap();
        if expect_high {
            assert!(y > 3.0, "NAND({a},{b_in}) = {y}V, expected high");
        } else {
            assert!(y < 0.5, "NAND({a},{b_in}) = {y}V, expected low");
        }
    }
}

#[test]
fn timer_555_astable_frequency() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Tran { stop: "5m".into(), step: "2u".into() });
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let r2 = b.add("basic.resistor", "R2", &[("resistance", "10k")]);
    let c1 = b.add("basic.capacitor", "C1", &[("capacitance", "10n")]);
    let c2 = b.add("basic.capacitor", "C2", &[("capacitance", "10n")]);
    let u1 = b.add("mixed.555", "U1", &[]);
    let rl = b.add("basic.resistor", "RL", &[("resistance", "1k")]);
    b.connect((&vcc, "n"), (&gnd, "1"));
    b.connect((&vcc, "p"), (&u1, "8"));
    b.connect((&u1, "4"), (&vcc, "p"));
    b.connect((&r1, "1"), (&vcc, "p"));
    b.connect((&r1, "2"), (&u1, "7"));
    b.connect((&r2, "1"), (&u1, "7"));
    b.connect((&r2, "2"), (&u1, "6"));
    b.connect((&c1, "1"), (&u1, "6"));
    b.connect((&u1, "2"), (&c1, "1"));
    b.connect((&c1, "2"), (&gnd, "1"));
    b.connect((&u1, "5"), (&c2, "1"));
    b.connect((&c2, "2"), (&gnd, "1"));
    b.connect((&u1, "1"), (&gnd, "1"));
    b.connect((&u1, "3"), (&rl, "1"));
    b.connect((&rl, "2"), (&gnd, "1"));

    let (netlist, result) = simulate(&b.build(), &lib, &engine_config()).unwrap();

    let time = result.real("time").unwrap();
    let out = result.real(&net(&netlist, &u1, "3")).unwrap();
    let rises: Vec<f64> = (1..time.len())
        .filter(|&i| time[i] > 1e-3 && out[i - 1] < 2.5 && out[i] >= 2.5)
        .map(|i| time[i])
        .collect();
    assert!(rises.len() >= 3, "only {} rising edges", rises.len());
    let period = (rises[rises.len() - 1] - rises[0]) / (rises.len() - 1) as f64;
    let expected = 1.0 / (0.693 * (1e3 + 2.0 * 10e3) * 10e-9);
    let freq = 1.0 / period;
    assert!((freq - expected).abs() / expected < 0.10, "555 at {freq:.0} Hz, expected {expected:.0} Hz");
}

#[test]
fn netlist_errors_stop_before_the_engine() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    b.add("basic.resistor", "R1", &[]);
    match simulate(&b.build(), &lib, &engine_config()) {
        Err(multysm_core::SimulateError::Netlist(errors)) => assert!(!errors.is_empty()),
        other => panic!("expected netlist errors, got {other:?}"),
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p multysm-core --test circuits`
Expected: FAIL to compile — `no function simulate in the root`.

- [ ] **Step 3: Implement**

Replace `crates/multysm-core/src/lib.rs` with:
```rust
//! multysm simulation core: manifests, netlists and the ngspice engine.

pub mod circuit;
pub mod engine;
pub mod library;
pub mod netlist;
pub mod si;

use circuit::Project;
use engine::{run_netlist, EngineConfig, EngineError, SimResult};
use library::Library;
use netlist::{build_netlist, Netlist, NetlistError};

#[derive(Debug, thiserror::Error)]
pub enum SimulateError {
    #[error("the circuit has {} problem(s)", .0.len())]
    Netlist(Vec<NetlistError>),
    #[error(transparent)]
    Engine(#[from] EngineError),
}

/// Project → netlist → ngspice → results. The netlist is returned so callers
/// can map net names back to component pins.
pub fn simulate(
    project: &Project,
    library: &Library,
    config: &EngineConfig,
) -> Result<(Netlist, SimResult), SimulateError> {
    let netlist = build_netlist(project, library).map_err(SimulateError::Netlist)?;
    let result = run_netlist(config, &netlist.text)?;
    Ok((netlist, result))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p multysm-core --test circuits`
Expected: 5 passed.

If a builder `connect` panics with "would touch", reorder the parts or connections in that test as the message says. If the 555 test fails to converge (log mentions "timestep too small") or the frequency is off, debug the model in `components/core/models/ne555.lib` with superpowers:systematic-debugging — print `netlist.text` and write it to the scratchpad to run manually — rather than loosening the 10% tolerance. If the NAND test fails with a code-model error, confirm `digital.cm` loaded (check `result.log` / error log for `codemodel`).

- [ ] **Step 5: Run the whole suite**

Run: `cargo test -p multysm-core`
Expected: every test passes (si 5, template 4, circuit 5, library 9, nets 4, netlist 8, engine_smoke 4, circuits 5).

- [ ] **Step 6: Commit and push**

```bash
git add crates/multysm-core
git commit -m "feat(core): simulate pipeline with RC, LED, NAND and 555 end-to-end tests"
git push origin main
```
