# SPICE Component Importer (Plan 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users import SPICE model files (`.lib .mod .cir .sub .spice .txt`) inside the app. Each ticked `.model`/`.subckt` becomes a part in a user pack under the app data folder, and those parts load, place and simulate like built-in parts.

**Architecture:**
- **Core:** a new `multysm-core::import` module does all the work.
  - `spice` reads files into definitions.
  - `candidate` turns definitions into part candidates (pins, template, params, per-part model text with dependencies, status, category guess).
  - `symbols` provides built-in device symbols or a generated box.
  - `pack` writes and lists user packs.
  - `smoke` test-loads each part in ngspice.
  - `import::preview` and `import::commit` tie these together.
- **Tauri:** loads `components/core` plus every user pack for both the library and the simulator, and exposes preview/commit/cancel/list/remove commands.
- **Frontend:** adds backend methods (Tauri and mock), an import dialog, a manage-imports dialog, and an "Imported" badge in the component browser.

**Tech Stack:** Rust (multysm-core, serde, jsonschema loader, ngspice FFI), Tauri 2 (`tauri::Emitter` events, `tauri-plugin-dialog`), Next.js 16 + React 19 + zustand 5 + Tailwind 4, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-component-importer-design.md` (Plan 5a scope: §2, §3, §4.4, §5 without the pin-mapping table)

## Global Constraints

- Theme: soft-dark tokens only (`bg #1b1d23`, `panel #22252d`, `line #2e323c`, `text #c9ced8`, `muted #8a91a0`, `wire #7aa2d6`, `accent #5fb3a8`, `selected #e0b25c`, `error #d97a7a`, `grid #2c3039`) via Tailwind classes (`bg-panel`, `text-muted`, `border-line`, …).
- Max import file size: 20 MB. Smoke test timeout: 5 s per part.
- User packs live in `<app data dir>/packs/<pack id>/` with `pack.json`. Pack ids: `imported-<slug>`. Part ids: `imported.<pack slug with _>.<part slug>`, matching `^[a-z0-9]+(\.[a-z0-9_]+)+$`.
- Imported SPICE text must pass `check_spice_text`. `.include`/`.lib` are never followed.
- Project file format unchanged. Core part ids unchanged. All existing Rust, Vitest and Playwright tests must keep passing.
- Shell: use Git Bash (the Bash tool). PowerShell `>` writes UTF-16.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never commit the Next-generated `app/next-env.d.ts` change or the pre-existing uncommitted `src-tauri/Cargo.toml` change; stage files by path.

## Deviations from the spec (decided while planning)

- `pick_import_files` is not a Rust command. The frontend calls `@tauri-apps/plugin-dialog` `open({ multiple: true })` directly, the same way `pickOpenPath` already works.
- `pack.json` stores `importedAt` as Unix seconds (no date crate) and `parts` as a list of `{ id, modelName }` (needed to detect and replace re-imported parts). The UI shows `parts.length`.
- The spec's §2.3 update is applied to the spec file in Task 1's commit.

## File map

```
components/core/symbols/{pmos.svg,njf.svg,pjf.svg}              new device symbols (Task 3)
crates/multysm-core/src/lib.rs                                  pub mod import
crates/multysm-core/src/import/mod.rs                           preview, commit, report types (Task 6)
crates/multysm-core/src/import/spice.rs                         SPICE reader (Task 1)
crates/multysm-core/src/import/category.rs                      category guess (Task 2)
crates/multysm-core/src/import/candidate.rs                     candidates (Task 2)
crates/multysm-core/src/import/symbols.rs                       device + box symbols (Task 3)
crates/multysm-core/src/import/pack.rs                          pack writing/listing/removal (Task 4)
crates/multysm-core/src/import/smoke.rs                         smoke test (Task 5)
crates/multysm-core/src/engine/mod.rs                           ngbehavior=psa (Task 5)
crates/multysm-core/tests/fixtures/import/{opamp_macro.lib,discretes.lib}
crates/multysm-core/tests/import.rs                             integration (Task 6)
src-tauri/src/{library_dto.rs,simulation.rs,commands.rs,lib.rs} roots (Task 7)
src-tauri/src/import_commands.rs                                import commands (Task 7)
src-tauri/tests/{simulation.rs,commands.rs}                     updated signatures (Task 7)
app/src/model/importTypes.ts                                    types (Task 8)
app/src/backend/{backend.ts,tauriBackend.ts,mockBackend.ts,mockImport.ts,mockImport.test.ts}
app/src/ui/ImportDialog.tsx (+ .test.tsx)                       (Task 9)
app/src/ui/ManageImports.tsx (+ .test.tsx)                      (Task 10)
app/src/ui/{ComponentBrowser.tsx,ComponentBrowser.test.tsx,AppShell.tsx}
app/e2e/import.spec.ts                                          (Task 10)
```

---

### Task 1: SPICE file reader

**Files:**
- Create: `crates/multysm-core/src/import/mod.rs` (module declarations only for now)
- Create: `crates/multysm-core/src/import/spice.rs`
- Modify: `crates/multysm-core/src/lib.rs` (add `pub mod import;`)
- Modify: `docs/superpowers/specs/2026-09-17-component-importer-design.md` (§2.1 `pack.json` shape and the pick-files note, per "Deviations")

**Interfaces:**
- Produces:
  - `pub const MAX_FILE_BYTES: u64`
  - `pub enum DefKind { Model { model_type: String }, Subckt { ports: Vec<String>, params: Vec<(String, String)>, nested: bool } }`
  - `pub struct Definition { pub name: String, pub kind: DefKind, pub text: String, pub comments: Vec<String>, pub subckt_refs: Vec<String>, pub tokens: Vec<String> }`, where `subckt_refs` and `tokens` are upper-case.
  - `pub struct SpiceFile { pub definitions: Vec<Definition>, pub warnings: Vec<String> }`
  - `pub fn parse_spice(text: &str) -> SpiceFile`
  - `pub fn read_spice_file(path: &Path) -> Result<SpiceFile, String>`

- [ ] **Step 1: Create the module skeleton**

`crates/multysm-core/src/import/mod.rs`:
```rust
//! Importing parts from SPICE model files into user packs.

pub mod spice;
```
In `crates/multysm-core/src/lib.rs`, add `pub mod import;` after `pub mod engine;`.

- [ ] **Step 2: Write the failing tests**

Create `crates/multysm-core/src/import/spice.rs` with only the tests module:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn names(file: &SpiceFile) -> Vec<&str> {
        file.definitions.iter().map(|d| d.name.as_str()).collect()
    }

    #[test]
    fn reads_models_with_and_without_parentheses() {
        let file = parse_spice(".model D1N4148 D(IS=4.352n N=1.906)\n.MODEL Q2N3904 npn IS=1e-14 BF=300\n");
        assert_eq!(names(&file), ["D1N4148", "Q2N3904"]);
        assert_eq!(file.definitions[0].kind, DefKind::Model { model_type: "D".into() });
        assert_eq!(file.definitions[1].kind, DefKind::Model { model_type: "NPN".into() });
        assert_eq!(file.definitions[1].text, ".MODEL Q2N3904 npn IS=1e-14 BF=300");
    }

    #[test]
    fn joins_continuations_and_strips_comments() {
        let text = "* header\n\n* Ideal diode\n.model DX D(IS=1e-14 ; saturation\n+ N=1.5 $ emission\n+ RS=2)\n";
        let file = parse_spice(text);
        let d = &file.definitions[0];
        assert_eq!(d.text, ".model DX D(IS=1e-14 N=1.5 RS=2)");
        assert_eq!(d.comments, ["Ideal diode"]);
    }

    #[test]
    fn reads_subcircuits_with_ports_params_and_references() {
        let text = "\
.SUBCKT LM358 IN+ IN- VCC VEE OUT PARAMS: GAIN=100k VOS = 1m
X1 IN+ IN- N1 STAGE1
Q1 VCC N1 OUT QOUT
.model QOUT NPN(BF=100)
.ENDS LM358
.subckt STAGE1 a b c
R1 a c 1k
.ends
";
        let file = parse_spice(text);
        assert_eq!(names(&file), ["LM358", "STAGE1"]);
        let DefKind::Subckt { ports, params, nested } = &file.definitions[0].kind else { panic!() };
        assert_eq!(ports, &["IN+", "IN-", "VCC", "VEE", "OUT"]);
        assert_eq!(params, &[("GAIN".to_string(), "100k".to_string()), ("VOS".to_string(), "1m".to_string())]);
        assert!(!nested);
        assert_eq!(file.definitions[0].subckt_refs, ["STAGE1"]);
        assert!(file.definitions[0].tokens.contains(&"QOUT".to_string()));
        assert!(file.definitions[0].text.starts_with(".SUBCKT LM358"));
        assert!(file.definitions[0].text.ends_with(".ENDS LM358"));
    }

    #[test]
    fn x_line_reference_ignores_params() {
        let file = parse_spice(".subckt TOP a b\nX1 a b INNER PARAMS: K=2\nX2 a b INNER2 K=3\n.ends\n");
        assert_eq!(file.definitions[0].subckt_refs, ["INNER", "INNER2"]);
    }

    #[test]
    fn marks_nested_subcircuits() {
        let file = parse_spice(".subckt OUTER a\n.subckt INNER b\nR1 b 0 1\n.ends INNER\nR2 a 0 1\n.ends OUTER\n");
        assert_eq!(names(&file), ["OUTER"]);
        let DefKind::Subckt { nested, .. } = file.definitions[0].kind else { panic!() };
        assert!(nested);
    }

    #[test]
    fn keeps_first_duplicate_and_warns_about_includes() {
        let file = parse_spice(".model A D(IS=1)\n.model a D(IS=2)\n.include \"other.lib\"\n.lib models.lib\n");
        assert_eq!(names(&file), ["A"]);
        assert!(file.definitions[0].text.contains("IS=1"));
        assert_eq!(file.warnings.len(), 3, "{:?}", file.warnings);
        assert!(file.warnings[0].contains("defined more than once"));
        assert!(file.warnings[1].contains("other.lib"));
        assert!(file.warnings[2].contains("models.lib"));
    }

    #[test]
    fn unterminated_subcircuit_is_a_warning() {
        let file = parse_spice(".subckt OPEN a b\nR1 a b 1k\n");
        assert!(file.definitions.is_empty());
        assert!(file.warnings[0].contains("OPEN"));
    }

    #[test]
    fn decodes_latin1() {
        let bytes = b"* R\xe9sistance\n.model DX D(IS=1)\n";
        assert_eq!(parse_spice(&decode(bytes)).definitions.len(), 1);
    }

    #[test]
    fn rejects_files_over_the_size_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.lib");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert!(read_spice_file(&path).unwrap_err().contains("20 MB"));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::spice`
Expected: compile errors (`parse_spice`, `SpiceFile`, … not found).

- [ ] **Step 4: Implement the reader**

Put this above the tests module in `spice.rs`:
```rust
//! Reads SPICE model files into `.model` and `.subckt` definitions.

use std::fs;
use std::path::Path;

/// Largest file the importer reads.
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub enum DefKind {
    /// `model_type` is upper case: `D`, `NPN`, `NMOS`, …
    Model { model_type: String },
    /// `params` keep their original spelling; `nested` is true when the body defines another subcircuit.
    Subckt { ports: Vec<String>, params: Vec<(String, String)>, nested: bool },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Definition {
    /// Name as written in the file.
    pub name: String,
    pub kind: DefKind,
    /// The definition's logical lines (continuations joined, comments removed), newline separated.
    pub text: String,
    /// Comment lines directly above the definition, without the leading `*`.
    pub comments: Vec<String>,
    /// Upper-case subcircuit names used by `X` lines in the body.
    pub subckt_refs: Vec<String>,
    /// Every upper-case token of the body's element lines; model references are the ones that name a `.model`.
    pub tokens: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SpiceFile {
    pub definitions: Vec<Definition>,
    pub warnings: Vec<String>,
}

pub fn read_spice_file(path: &Path) -> Result<SpiceFile, String> {
    let size = fs::metadata(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?.len();
    if size > MAX_FILE_BYTES {
        return Err(format!("{} is larger than 20 MB", path.display()));
    }
    let bytes = fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    Ok(parse_spice(&decode(&bytes)))
}

/// UTF-8, or Latin-1 when the bytes are not valid UTF-8.
pub(crate) fn decode(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

enum Line {
    Comment(String),
    Blank,
    Code(String),
}

/// Joins `+` continuations and removes `;` and ` $` inline comments.
fn logical_lines(text: &str) -> Vec<Line> {
    let mut lines: Vec<Line> = Vec::new();
    for raw in text.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            lines.push(Line::Blank);
            continue;
        }
        if let Some(comment) = trimmed.strip_prefix('*') {
            lines.push(Line::Comment(comment.trim().to_string()));
            continue;
        }
        let code = strip_inline_comment(trimmed);
        if let Some(rest) = code.strip_prefix('+') {
            if let Some(Line::Code(previous)) = lines.iter_mut().rev().find(|l| matches!(l, Line::Code(_))) {
                previous.push(' ');
                previous.push_str(rest.trim());
                continue;
            }
        }
        if !code.is_empty() {
            lines.push(Line::Code(code));
        }
    }
    lines
}

fn strip_inline_comment(line: &str) -> String {
    let mut end = line.len();
    if let Some(i) = line.find(';') {
        end = end.min(i);
    }
    let bytes = line.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'$' && (i == 0 || bytes[i - 1].is_ascii_whitespace()) {
            end = end.min(i);
            break;
        }
    }
    line[..end].trim_end().to_string()
}

fn directive(line: &str) -> String {
    line.split_whitespace().next().unwrap_or("").to_ascii_lowercase()
}

struct Open {
    name: String,
    ports: Vec<String>,
    params: Vec<(String, String)>,
    nested: bool,
    depth: usize,
    lines: Vec<String>,
    comments: Vec<String>,
    subckt_refs: Vec<String>,
    tokens: Vec<String>,
}

pub fn parse_spice(text: &str) -> SpiceFile {
    let mut file = SpiceFile::default();
    let mut comments: Vec<String> = Vec::new();
    let mut open: Option<Open> = None;

    for line in logical_lines(text) {
        let code = match line {
            Line::Blank => {
                if open.is_none() {
                    comments.clear();
                }
                continue;
            }
            Line::Comment(c) => {
                if open.is_none() {
                    comments.push(c);
                }
                continue;
            }
            Line::Code(code) => code,
        };
        let dir = directive(&code);

        if let Some(sub) = open.as_mut() {
            sub.lines.push(code.clone());
            match dir.as_str() {
                ".subckt" => {
                    sub.nested = true;
                    sub.depth += 1;
                }
                ".ends" => {
                    if sub.depth == 0 {
                        let sub = open.take().expect("open subcircuit");
                        push_definition(
                            &mut file,
                            Definition {
                                name: sub.name,
                                kind: DefKind::Subckt { ports: sub.ports, params: sub.params, nested: sub.nested },
                                text: sub.lines.join("\n"),
                                comments: sub.comments,
                                subckt_refs: sub.subckt_refs,
                                tokens: sub.tokens,
                            },
                        );
                    } else {
                        sub.depth -= 1;
                    }
                }
                _ if dir.starts_with('.') => {}
                _ if sub.depth == 0 => {
                    let tokens: Vec<String> = code.split_whitespace().map(str::to_ascii_uppercase).collect();
                    if tokens[0].starts_with('X') {
                        if let Some(name) = x_line_subckt(&tokens) {
                            sub.subckt_refs.push(name);
                        }
                    }
                    sub.tokens.extend(tokens.into_iter().skip(1));
                }
                _ => {}
            }
            continue;
        }

        match dir.as_str() {
            ".model" => {
                let mut parts = code.split_whitespace().skip(1);
                let name = parts.next().unwrap_or("").to_string();
                let model_type: String = parts
                    .next()
                    .unwrap_or("")
                    .split('(')
                    .next()
                    .unwrap_or("")
                    .to_ascii_uppercase();
                if name.is_empty() || model_type.is_empty() {
                    file.warnings.push(format!("'{code}' is not a complete .model line"));
                } else {
                    push_definition(
                        &mut file,
                        Definition {
                            name,
                            kind: DefKind::Model { model_type },
                            text: code.clone(),
                            comments: std::mem::take(&mut comments),
                            subckt_refs: vec![],
                            tokens: vec![],
                        },
                    );
                }
            }
            ".subckt" => {
                let (name, ports, params) = subckt_header(&code);
                open = Some(Open {
                    name,
                    ports,
                    params,
                    nested: false,
                    depth: 0,
                    lines: vec![code.clone()],
                    comments: std::mem::take(&mut comments),
                    subckt_refs: vec![],
                    tokens: vec![],
                });
            }
            ".include" | ".inc" | ".lib" => {
                let target = code.split_whitespace().nth(1).unwrap_or("").trim_matches(|c| c == '"' || c == '\'');
                file.warnings.push(format!(
                    "'{}' is not followed; import {target} together with this file",
                    directive(&code)
                ));
            }
            _ => {}
        }
        comments.clear();
    }

    if let Some(sub) = open {
        file.warnings.push(format!("subcircuit {} has no .ends and was skipped", sub.name));
    }
    file
}

fn push_definition(file: &mut SpiceFile, definition: Definition) {
    if file.definitions.iter().any(|d| d.name.eq_ignore_ascii_case(&definition.name)) {
        file.warnings.push(format!("{} is defined more than once; the first definition is used", definition.name));
    } else {
        file.definitions.push(definition);
    }
}

/// `.subckt NAME ports… [PARAMS:] [k=v …]`, tolerating spaces around `=`.
fn subckt_header(line: &str) -> (String, Vec<String>, Vec<(String, String)>) {
    let normalized = line.replace(" =", "=").replace("= ", "=");
    let mut tokens = normalized.split_whitespace().skip(1);
    let name = tokens.next().unwrap_or("").to_string();
    let mut ports = Vec::new();
    let mut params = Vec::new();
    let mut in_params = false;
    for token in tokens {
        if token.eq_ignore_ascii_case("params:") {
            in_params = true;
        } else if let Some((key, value)) = token.split_once('=') {
            in_params = true;
            params.push((key.to_string(), value.to_string()));
        } else if !in_params {
            ports.push(token.to_string());
        }
    }
    (name, ports, params)
}

/// The subcircuit named by an `X` line: the last token before any `PARAMS:` or `k=v`.
fn x_line_subckt(tokens: &[String]) -> Option<String> {
    tokens
        .iter()
        .skip(1)
        .take_while(|t| t.as_str() != "PARAMS:" && !t.contains('='))
        .last()
        .cloned()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::spice`
Expected: 9 passed.

- [ ] **Step 6: Update the spec for the planning deviations**

In `docs/superpowers/specs/2026-09-17-component-importer-design.md` §2.1, replace the `pack.json` sentence with:
```
`pack.json`: `{ "id", "name", "origin": "import", "sources": [file names], "importedAt": Unix seconds,
"parts": [{ "id", "modelName" }] }`. Pack ids are `imported-<slug>`; a clash appends `-2`, `-3`, …
```
In §5.1, replace the `pick_import_files` bullet with:
```
- File picking uses `@tauri-apps/plugin-dialog` `open({ multiple: true })` from the frontend (no command).
```

- [ ] **Step 7: Commit**

```bash
cd /c/multysm
git add crates/multysm-core/src/lib.rs crates/multysm-core/src/import docs/superpowers/specs/2026-09-17-component-importer-design.md
git commit -m "feat(multysm-core): read .model and .subckt definitions from SPICE files

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Candidates and category guess

**Files:**
- Create: `crates/multysm-core/src/import/category.rs`
- Create: `crates/multysm-core/src/import/candidate.rs`
- Create: `crates/multysm-core/src/import/symbols.rs` (stub only here; Task 3 fills it in)
- Modify: `crates/multysm-core/src/import/mod.rs`

**Interfaces:**
- Consumes (Task 1): `SpiceFile`, `Definition`, `DefKind`.
- Produces:
  - `pub fn guess_category(kind: PartKind, name: &str, comments: &[String]) -> Category`
  - `pub enum PartKind { Diode, Bjt, Mosfet, Jfet, Subckt }`, serialized lowercase.
  - `pub enum CandidateStatus { Ready, AlreadyImported, Unsupported, Unsafe, MissingDependency }`, serialized snake_case.
  - `pub struct Candidate { key, name, slug, kind: Option<PartKind>, model_type: Option<String>, category, source, ref_prefix, template, params: Vec<Param>, symbol: GeneratedSymbol, model_text (not serialized), description: Option<String>, status, messages: Vec<String>, selected: bool, replaces: Option<String> }`, serialized camelCase.
  - `pub fn build_candidates(files: &[(String, SpiceFile)], existing: &BTreeMap<String, String>) -> Vec<Candidate>`. `existing` maps upper-case model name → pack id.
  - `pub fn slug(text: &str) -> String`
  - Stub `symbols::GeneratedSymbol { pub file_name: String, pub svg: String, pub width: i64, pub height: i64, pub pins: Vec<Pin> }` and `symbols::symbol_for(kind: PartKind, model_type: &str, name: &str, ports: &[String]) -> GeneratedSymbol`, which Task 3 replaces with real symbols.

- [ ] **Step 1: Add the symbols stub so candidates compile**

`crates/multysm-core/src/import/symbols.rs`:
```rust
//! Symbols for imported parts: built-in device drawings or a generated box.

use serde::Serialize;

use super::candidate::PartKind;
use crate::library::Pin;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GeneratedSymbol {
    /// File name inside the pack's `symbols/` folder.
    pub file_name: String,
    pub svg: String,
    pub width: i64,
    pub height: i64,
    pub pins: Vec<Pin>,
}

pub fn symbol_for(kind: PartKind, _model_type: &str, name: &str, ports: &[String]) -> GeneratedSymbol {
    let pins = match kind {
        PartKind::Diode => vec![pin("A", "Anode", 0, 10), pin("K", "Cathode", 40, 10)],
        PartKind::Bjt => vec![pin("C", "C", 30, 0), pin("B", "B", 0, 20), pin("E", "E", 30, 40)],
        PartKind::Mosfet | PartKind::Jfet => vec![pin("D", "D", 30, 0), pin("G", "G", 0, 20), pin("S", "S", 30, 40)],
        PartKind::Subckt => ports.iter().enumerate().map(|(i, p)| pin(&(i + 1).to_string(), p, 0, 10 * i as i64)).collect(),
    };
    GeneratedSymbol { file_name: format!("{name}.svg"), svg: String::new(), width: 40, height: 40, pins }
}

pub(crate) fn pin(id: &str, name: &str, x: i64, y: i64) -> Pin {
    Pin { id: id.into(), name: Some(name.into()), x, y, optional: false }
}
```

- [ ] **Step 2: Write the failing category tests**

`crates/multysm-core/src/import/category.rs`, tests only:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::candidate::PartKind;
    use crate::library::Category;

    #[test]
    fn device_models_follow_their_type() {
        assert_eq!(guess_category(PartKind::Diode, "1N5819", &[]), Category::Diodes);
        assert_eq!(guess_category(PartKind::Bjt, "BC547", &[]), Category::Transistors);
        assert_eq!(guess_category(PartKind::Mosfet, "IRF540", &[]), Category::Transistors);
        assert_eq!(guess_category(PartKind::Jfet, "J310", &[]), Category::Transistors);
    }

    #[test]
    fn subcircuits_are_guessed_from_name_then_comments() {
        let s = PartKind::Subckt;
        assert_eq!(guess_category(s, "SN74HC00", &[]), Category::Ttl);
        assert_eq!(guess_category(s, "74LS04", &[]), Category::Ttl);
        assert_eq!(guess_category(s, "CD4093", &[]), Category::Cmos);
        assert_eq!(guess_category(s, "4017", &[]), Category::Cmos);
        assert_eq!(guess_category(s, "LM358", &[]), Category::Analog);
        assert_eq!(guess_category(s, "OPA2134", &[]), Category::Analog);
        assert_eq!(guess_category(s, "LM7805", &[]), Category::Power);
        assert_eq!(guess_category(s, "LM317", &[]), Category::Power);
        assert_eq!(guess_category(s, "NE555", &[]), Category::Mixed);
        assert_eq!(guess_category(s, "XYZ1", &["Low-dropout regulator".into()]), Category::Power);
        assert_eq!(guess_category(s, "XYZ2", &["Rail-to-rail op amp".into()]), Category::Analog);
        assert_eq!(guess_category(s, "MYSTERY", &[]), Category::Misc);
    }
}
```
Add `pub mod category; pub mod candidate; pub mod symbols;` to `import/mod.rs`, create `candidate.rs` containing only:
```rust
//! Turns SPICE definitions into importable part candidates.

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PartKind {
    Diode,
    Bjt,
    Mosfet,
    Jfet,
    Subckt,
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::category`
Expected: compile error, `guess_category` not found.

- [ ] **Step 4: Implement the category guess**

Above the tests in `category.rs`:
```rust
//! Guesses a browser category for an imported part.

use super::candidate::PartKind;
use crate::library::Category;

pub fn guess_category(kind: PartKind, name: &str, comments: &[String]) -> Category {
    match kind {
        PartKind::Diode => return Category::Diodes,
        PartKind::Bjt | PartKind::Mosfet | PartKind::Jfet => return Category::Transistors,
        PartKind::Subckt => {}
    }
    let upper = name.to_ascii_uppercase();
    if let Some(category) = by_name(&upper) {
        return category;
    }
    let description = comments.join(" ").to_ascii_lowercase();
    if description.contains("regulator") || description.contains("ldo") {
        Category::Power
    } else if ["op amp", "op-amp", "opamp", "operational amplifier", "comparator"].iter().any(|k| description.contains(k)) {
        Category::Analog
    } else if description.contains("555") || description.contains("timer") {
        Category::Mixed
    } else {
        Category::Misc
    }
}

fn by_name(upper: &str) -> Option<Category> {
    let letters_then_digits = |prefix: &str| {
        upper.strip_prefix(prefix).is_some_and(|rest| rest.chars().next().is_some_and(|c| c.is_ascii_digit()))
    };
    let after_sn = upper.strip_prefix("SN").unwrap_or(upper);
    if let Some(rest) = after_sn.strip_prefix("74") {
        if rest.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
            return Some(Category::Ttl);
        }
    }
    let after_cmos = upper.strip_prefix("CD").or_else(|| upper.strip_prefix("MC14")).unwrap_or(upper);
    if after_cmos.len() >= 4 && after_cmos.starts_with("40") && after_cmos[2..4].chars().all(|c| c.is_ascii_digit()) {
        return Some(Category::Cmos);
    }
    if upper.contains("555") {
        return Some(Category::Mixed);
    }
    if ["LM78", "LM79", "LM317", "LM337", "LM1117", "LT1086"].iter().any(|p| upper.starts_with(p))
        || (upper.starts_with("78") || upper.starts_with("79")) && upper.len() <= 6
    {
        return Some(Category::Power);
    }
    if ["LM", "TL", "OPA", "AD", "LT", "MC", "NE", "LMV", "TLV", "MCP"].iter().any(|p| letters_then_digits(p)) {
        return Some(Category::Analog);
    }
    None
}
```

- [ ] **Step 5: Run category tests**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::category`
Expected: 2 passed. (`NE555` hits the `555` rule before the `NE` analog prefix; `LM7805` hits `LM78` before `LM`.)

- [ ] **Step 6: Write the failing candidate tests**

Append to `candidate.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::spice::parse_spice;
    use std::collections::BTreeMap;

    fn build(text: &str) -> Vec<Candidate> {
        build_candidates(&[("demo.lib".into(), parse_spice(text))], &BTreeMap::new())
    }

    fn by_name<'a>(cs: &'a [Candidate], name: &str) -> &'a Candidate {
        cs.iter().find(|c| c.name == name).unwrap_or_else(|| panic!("no candidate {name}"))
    }

    #[test]
    fn device_models_get_templates_and_pins() {
        let cs = build(".model D1 D(IS=1n)\n.model Q1 PNP(BF=80)\n.model M1 PMOS(VTO=-2)\n.model M2 VDMOS(VTO=3)\n.model J1 NJF(VTO=-2)\n");
        assert_eq!(by_name(&cs, "D1").template, "{ref} {pin.A} {pin.K} D1");
        assert_eq!(by_name(&cs, "D1").ref_prefix, "D");
        assert_eq!(by_name(&cs, "Q1").template, "{ref} {pin.C} {pin.B} {pin.E} Q1");
        assert_eq!(by_name(&cs, "M1").template, "{ref} {pin.D} {pin.G} {pin.S} {pin.S} M1");
        assert_eq!(by_name(&cs, "M2").template, "{ref} {pin.D} {pin.G} {pin.S} M2");
        assert_eq!(by_name(&cs, "J1").template, "{ref} {pin.D} {pin.G} {pin.S} J1");
        assert!(cs.iter().all(|c| c.status == CandidateStatus::Ready && c.selected));
        assert_eq!(by_name(&cs, "D1").model_text, ".model D1 D(IS=1n)");
    }

    #[test]
    fn unsupported_model_types_are_listed() {
        let cs = build(".model SW1 SW(VT=1)\n");
        assert_eq!(cs[0].status, CandidateStatus::Unsupported);
        assert!(!cs[0].selected);
        assert!(cs[0].messages[0].contains("SW"));
    }

    #[test]
    fn subcircuits_bring_their_dependencies_first() {
        let text = "\
* Dual op amp
.subckt AMP inp inn out PARAMS: GAIN=1e5 EXPR={2*K}
X1 inp inn mid STAGE
Q1 out mid 0 QX
.ends
.subckt STAGE a b c
R1 a c 1k
.ends
.model QX NPN(BF=50)
.model UNUSED D(IS=1)
";
        let cs = build(text);
        let amp = by_name(&cs, "AMP");
        assert_eq!(amp.template, "X{ref} {pin.1} {pin.2} {pin.3} AMP PARAMS: GAIN={gain}");
        assert_eq!(amp.params.len(), 1, "non-numeric defaults are not exposed");
        assert_eq!(amp.params[0].key, "gain");
        assert_eq!(amp.params[0].default, "1e5");
        let stage_at = amp.model_text.find(".subckt STAGE").unwrap();
        let qx_at = amp.model_text.find(".model QX").unwrap();
        let amp_at = amp.model_text.find(".subckt AMP").unwrap();
        assert!(stage_at < amp_at && qx_at < amp_at, "{}", amp.model_text);
        assert!(!amp.model_text.contains("UNUSED"));
        assert_eq!(amp.description.as_deref(), Some("Dual op amp"));
        assert_eq!(amp.category, Category::Analog, "from the \"Dual op amp\" comment");
        assert!(!by_name(&cs, "STAGE").selected, "helpers start unticked");
        assert_eq!(by_name(&cs, "STAGE").status, CandidateStatus::Ready);
    }

    #[test]
    fn missing_subcircuit_dependency() {
        let cs = build(".subckt TOP a b\nX1 a b NOWHERE\n.ends\n");
        assert_eq!(cs[0].status, CandidateStatus::MissingDependency);
        assert!(cs[0].messages[0].contains("NOWHERE"));
    }

    #[test]
    fn dependencies_resolve_across_files() {
        let files = vec![
            ("a.lib".to_string(), parse_spice(".subckt TOP a b\nX1 a b LOW\n.ends\n")),
            ("b.lib".to_string(), parse_spice(".subckt LOW a b\nR1 a b 1\n.ends\n")),
        ];
        let cs = build_candidates(&files, &BTreeMap::new());
        let top = cs.iter().find(|c| c.name == "TOP").unwrap();
        assert_eq!(top.status, CandidateStatus::Ready);
        assert_eq!(top.source, "a.lib");
        assert!(top.model_text.contains(".subckt LOW"));
    }

    #[test]
    fn unsafe_and_nested_definitions_are_blocked() {
        let cs = build(".subckt BAD a\nR1 a 0 {shell}\n.ends\n.subckt NEST a\n.subckt IN b\n.ends\n.ends\n");
        assert_eq!(by_name(&cs, "BAD").status, CandidateStatus::Unsafe);
        assert_eq!(by_name(&cs, "NEST").status, CandidateStatus::Unsupported);
    }

    #[test]
    fn already_imported_models_are_marked_and_unticked() {
        let existing = BTreeMap::from([("D1".to_string(), "imported-old".to_string())]);
        let cs = build_candidates(&[("x.lib".into(), parse_spice(".model d1 D(IS=1)\n"))], &existing);
        assert_eq!(cs[0].status, CandidateStatus::AlreadyImported);
        assert_eq!(cs[0].replaces.as_deref(), Some("imported-old"));
        assert!(!cs[0].selected);
    }

    #[test]
    fn keys_and_slugs_are_stable() {
        let cs = build(".subckt LM358/NOPB a b\nR1 a b 1\n.ends\n");
        assert_eq!(cs[0].key, "0:LM358/NOPB");
        assert_eq!(cs[0].slug, "lm358_nopb");
        assert_eq!(slug("7-Seg Driver"), "7_seg_driver");
    }
}
```

- [ ] **Step 7: Run to verify failure**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::candidate`
Expected: compile errors (`build_candidates`, `Candidate`, … not found).

- [ ] **Step 8: Implement candidates**

Replace the body of `candidate.rs` (keep the tests module) with:
```rust
//! Turns SPICE definitions into importable part candidates.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::category::guess_category;
use super::spice::{DefKind, Definition, SpiceFile};
use super::symbols::{symbol_for, GeneratedSymbol};
use crate::library::spice_policy::check_spice_text;
use crate::library::{Category, Param, ParamKind};
use crate::si::parse_si;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PartKind {
    Diode,
    Bjt,
    Mosfet,
    Jfet,
    Subckt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateStatus {
    Ready,
    AlreadyImported,
    Unsupported,
    Unsafe,
    MissingDependency,
}

impl CandidateStatus {
    pub fn importable(self) -> bool {
        matches!(self, CandidateStatus::Ready | CandidateStatus::AlreadyImported)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// `<file index>:<name>`, unique within one preview.
    pub key: String,
    pub name: String,
    /// File-name and id friendly form of `name`.
    pub slug: String,
    pub kind: Option<PartKind>,
    /// Upper-case `.model` type; `None` for subcircuits.
    pub model_type: Option<String>,
    pub category: Category,
    /// File name the definition came from.
    pub source: String,
    pub ref_prefix: String,
    pub template: String,
    pub params: Vec<Param>,
    pub symbol: GeneratedSymbol,
    /// The definition and its dependencies, dependencies first.
    #[serde(skip)]
    pub model_text: String,
    pub description: Option<String>,
    pub status: CandidateStatus,
    pub messages: Vec<String>,
    /// Ticked by default in the preview.
    pub selected: bool,
    /// Pack id holding an earlier import of the same model name.
    pub replaces: Option<String>,
}

/// Lower case, every run of other characters becomes `_`, trimmed of `_`.
pub fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

fn param_key(name: &str) -> String {
    let s = slug(name);
    if s.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && s != "ref" { s } else { format!("p_{s}") }
}

fn device_kind(model_type: &str) -> Option<(PartKind, &'static str, &'static str)> {
    Some(match model_type {
        "D" => (PartKind::Diode, "D", "{ref} {pin.A} {pin.K}"),
        "NPN" | "PNP" => (PartKind::Bjt, "Q", "{ref} {pin.C} {pin.B} {pin.E}"),
        "NMOS" | "PMOS" => (PartKind::Mosfet, "M", "{ref} {pin.D} {pin.G} {pin.S} {pin.S}"),
        "VDMOS" => (PartKind::Mosfet, "M", "{ref} {pin.D} {pin.G} {pin.S}"),
        "NJF" | "PJF" => (PartKind::Jfet, "J", "{ref} {pin.D} {pin.G} {pin.S}"),
        _ => return None,
    })
}

pub fn build_candidates(files: &[(String, SpiceFile)], existing: &BTreeMap<String, String>) -> Vec<Candidate> {
    // First definition of a name across all files wins.
    let mut defs: BTreeMap<String, &Definition> = BTreeMap::new();
    let mut origin: BTreeMap<String, usize> = BTreeMap::new();
    for (index, (_, file)) in files.iter().enumerate() {
        for def in &file.definitions {
            let upper = def.name.to_ascii_uppercase();
            if !defs.contains_key(&upper) {
                defs.insert(upper.clone(), def);
                origin.insert(upper, index);
            }
        }
    }
    let helpers: BTreeSet<String> = defs.values().flat_map(|d| d.subckt_refs.iter().cloned()).collect();

    let mut candidates = Vec::new();
    for (index, (source, file)) in files.iter().enumerate() {
        for def in &file.definitions {
            let upper = def.name.to_ascii_uppercase();
            if origin.get(&upper) != Some(&index) {
                continue;
            }
            candidates.push(candidate(index, source, def, &defs, &helpers, existing));
        }
    }
    candidates
}

fn candidate(
    index: usize,
    source: &str,
    def: &Definition,
    defs: &BTreeMap<String, &Definition>,
    helpers: &BTreeSet<String>,
    existing: &BTreeMap<String, String>,
) -> Candidate {
    let upper = def.name.to_ascii_uppercase();
    let mut messages = Vec::new();
    let mut status = CandidateStatus::Ready;
    let mut params = Vec::new();

    let (kind, model_type, ref_prefix, template, ports) = match &def.kind {
        DefKind::Model { model_type } => match device_kind(model_type) {
            Some((kind, prefix, pins)) => {
                (Some(kind), Some(model_type.clone()), prefix.to_string(), format!("{pins} {}", def.name), vec![])
            }
            None => {
                status = CandidateStatus::Unsupported;
                messages.push(format!("{model_type} models are not importable"));
                (None, Some(model_type.clone()), String::new(), String::new(), vec![])
            }
        },
        DefKind::Subckt { ports, params: defaults, nested } => {
            if *nested {
                status = CandidateStatus::Unsupported;
                messages.push("subcircuits defined inside other subcircuits are not supported".into());
            }
            let pins: Vec<String> = (1..=ports.len()).map(|i| format!("{{pin.{i}}}")).collect();
            let mut template = format!("X{{ref}} {} {}", pins.join(" "), def.name);
            let mut assignments = Vec::new();
            for (name, value) in defaults {
                if parse_si(value).is_err() {
                    continue;
                }
                let key = param_key(name);
                assignments.push(format!("{name}={{{key}}}"));
                params.push(Param {
                    key,
                    label: name.clone(),
                    unit: String::new(),
                    default: value.clone(),
                    kind: ParamKind::Si,
                    options: vec![],
                });
            }
            if !assignments.is_empty() {
                template.push_str(" PARAMS: ");
                template.push_str(&assignments.join(" "));
            }
            (Some(PartKind::Subckt), None, "U".to_string(), template, ports.clone())
        }
    };

    let mut model_text = String::new();
    if status == CandidateStatus::Ready {
        let mut order = Vec::new();
        let mut missing = BTreeSet::new();
        collect(&upper, defs, &mut BTreeSet::new(), &mut order, &mut missing);
        if missing.is_empty() {
            model_text = order.iter().map(|name| defs[name].text.as_str()).collect::<Vec<_>>().join("\n\n");
            if let Err(e) = check_spice_text(&model_text) {
                status = CandidateStatus::Unsafe;
                messages.push(format!("model text is not allowed: {e}"));
            }
        } else {
            status = CandidateStatus::MissingDependency;
            let names: Vec<String> = missing.into_iter().collect();
            messages.push(format!("uses {} which is not defined in the imported files", names.join(", ")));
        }
    }

    let replaces = existing.get(&upper).cloned();
    if status == CandidateStatus::Ready && replaces.is_some() {
        status = CandidateStatus::AlreadyImported;
        messages.push("already imported; tick to replace it".into());
    }

    let slug_name = slug(&def.name);
    let symbol = match kind {
        Some(kind) => symbol_for(kind, model_type.as_deref().unwrap_or(""), &slug_name, &ports),
        None => super::symbols::GeneratedSymbol { file_name: String::new(), svg: String::new(), width: 0, height: 0, pins: vec![] },
    };
    let description = (!def.comments.is_empty()).then(|| def.comments.join(" "));
    Candidate {
        key: format!("{index}:{}", def.name),
        name: def.name.clone(),
        slug: slug_name,
        kind,
        model_type,
        category: kind.map_or(Category::Misc, |k| guess_category(k, &def.name, &def.comments)),
        source: source.to_string(),
        ref_prefix,
        template,
        params,
        symbol,
        model_text,
        description,
        selected: status == CandidateStatus::Ready && !helpers.contains(&upper),
        status,
        messages,
        replaces,
    }
}

/// Post-order walk: dependencies are pushed before the definitions that use them.
fn collect(
    name: &str,
    defs: &BTreeMap<String, &Definition>,
    seen: &mut BTreeSet<String>,
    order: &mut Vec<String>,
    missing: &mut BTreeSet<String>,
) {
    if !seen.insert(name.to_string()) {
        return;
    }
    let Some(def) = defs.get(name) else {
        missing.insert(name.to_string());
        return;
    };
    for sub in &def.subckt_refs {
        collect(sub, defs, seen, order, missing);
    }
    for token in &def.tokens {
        if !def.subckt_refs.contains(token)
            && defs.get(token).is_some_and(|d| matches!(d.kind, DefKind::Model { .. }))
        {
            collect(token, defs, seen, order, missing);
        }
    }
    order.push(name.to_string());
}
```

- [ ] **Step 9: Run candidate tests**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::`
Expected: all spice, category and candidate tests pass.

Note on `unsafe_and_nested_definitions_are_blocked`: `{shell}` contains the token `shell`, which `check_spice_text` rejects, so BAD becomes `Unsafe`. NEST is `Unsupported` because its body has a nested `.subckt`.

- [ ] **Step 10: Commit**

```bash
cd /c/multysm
git add crates/multysm-core/src/import
git commit -m "feat(multysm-core): build import candidates with dependencies and category guesses

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Device and box symbols

**Files:**
- Create: `components/core/symbols/pmos.svg`, `components/core/symbols/njf.svg`, `components/core/symbols/pjf.svg`
- Modify: `crates/multysm-core/src/import/symbols.rs` (replace the stub)

**Interfaces:**
- Consumes: `PartKind` (Task 2).
- Produces: `symbol_for(kind, model_type, name, ports) -> GeneratedSymbol` (same signature as the stub). `file_name` is `<slug>.svg` for boxes and `<device>.svg` (`diode.svg`, `npn.svg`, `pnp.svg`, `nmos.svg`, `pmos.svg`, `njf.svg`, `pjf.svg`) for devices. `svg` is non-empty.

- [ ] **Step 1: Add the three device symbols**

`components/core/symbols/pmos.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 20h10M10 10v20M15 8v7M15 17v6M15 25v7M15 11h15V0M15 29h15v11M15 20h15v9M20 17l5 3-5 3"/></svg>
```
`components/core/symbols/njf.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 20h14M14 8v24M14 11h16V0M14 29h16v11M8 17l5 3-5 3"/></svg>
```
`components/core/symbols/pjf.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 20h14M14 8v24M14 11h16V0M14 29h16v11M13 17l-5 3 5 3"/></svg>
```
These files aren't referenced by any core manifest. The loader only reads `.json` files, so the core library is unaffected.

- [ ] **Step 2: Write the failing tests**

Replace `symbols.rs` with the tests below plus the stub's code kept above them for now:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn devices_use_built_in_drawings_and_core_pin_positions() {
        let d = symbol_for(PartKind::Diode, "D", "x", &[]);
        assert_eq!((d.file_name.as_str(), d.width, d.height), ("diode.svg", 40, 20));
        assert_eq!(d.pins.iter().map(|p| (p.id.as_str(), p.x, p.y)).collect::<Vec<_>>(), [("A", 0, 10), ("K", 40, 10)]);
        assert!(d.svg.contains("currentColor"));
        assert_eq!(symbol_for(PartKind::Bjt, "PNP", "x", &[]).file_name, "pnp.svg");
        assert_eq!(symbol_for(PartKind::Bjt, "NPN", "x", &[]).file_name, "npn.svg");
        assert_eq!(symbol_for(PartKind::Mosfet, "PMOS", "x", &[]).file_name, "pmos.svg");
        assert_eq!(symbol_for(PartKind::Mosfet, "VDMOS", "x", &[]).file_name, "nmos.svg");
        assert_eq!(symbol_for(PartKind::Jfet, "PJF", "x", &[]).file_name, "pjf.svg");
    }

    #[test]
    fn box_alternates_ports_left_and_right_on_the_grid() {
        let ports: Vec<String> = ["IN+", "IN-", "V+", "V-", "OUT"].iter().map(|s| s.to_string()).collect();
        let s = symbol_for(PartKind::Subckt, "", "lm358", &ports);
        assert_eq!(s.file_name, "lm358.svg");
        let pins: Vec<(&str, &str, i64, i64)> =
            s.pins.iter().map(|p| (p.id.as_str(), p.name.as_deref().unwrap(), p.x, p.y)).collect();
        assert_eq!(pins, [
            ("1", "IN+", 0, 20), ("2", "IN-", s.width, 20),
            ("3", "V+", 0, 40), ("4", "V-", s.width, 40),
            ("5", "OUT", 0, 60),
        ]);
        assert_eq!(s.height, 80);
        assert!(s.width >= 80 && s.width % 10 == 0);
        assert!(s.svg.contains(">lm358<") && s.svg.contains(">IN+<"));
    }

    #[test]
    fn box_escapes_xml_and_grows_for_long_names() {
        let s = symbol_for(PartKind::Subckt, "", "a_very_long_subcircuit_name", &["<a>".to_string()]);
        assert!(s.svg.contains("&lt;a&gt;"));
        assert!(s.width > 80);
        assert_eq!(s.height, 40);
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::symbols`
Expected: FAIL (the stub returns empty SVG, wrong file names and positions).

- [ ] **Step 4: Implement**

Replace everything above the tests module in `symbols.rs` with:
```rust
//! Symbols for imported parts: built-in device drawings or a generated box.

use serde::Serialize;

use super::candidate::PartKind;
use crate::library::Pin;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GeneratedSymbol {
    /// File name inside the pack's `symbols/` folder.
    pub file_name: String,
    pub svg: String,
    pub width: i64,
    pub height: i64,
    pub pins: Vec<Pin>,
}

const DIODE: &str = include_str!("../../../../components/core/symbols/diode.svg");
const NPN: &str = include_str!("../../../../components/core/symbols/npn.svg");
const PNP: &str = include_str!("../../../../components/core/symbols/pnp.svg");
const NMOS: &str = include_str!("../../../../components/core/symbols/nmos.svg");
const PMOS: &str = include_str!("../../../../components/core/symbols/pmos.svg");
const NJF: &str = include_str!("../../../../components/core/symbols/njf.svg");
const PJF: &str = include_str!("../../../../components/core/symbols/pjf.svg");

pub fn symbol_for(kind: PartKind, model_type: &str, name: &str, ports: &[String]) -> GeneratedSymbol {
    let three = |file: &str, svg: &str, first: &str, second: &str, third: &str| GeneratedSymbol {
        file_name: file.into(),
        svg: svg.trim().into(),
        width: 40,
        height: 40,
        pins: vec![pin(first, first, 30, 0), pin(second, second, 0, 20), pin(third, third, 30, 40)],
    };
    match (kind, model_type) {
        (PartKind::Diode, _) => GeneratedSymbol {
            file_name: "diode.svg".into(),
            svg: DIODE.trim().into(),
            width: 40,
            height: 20,
            pins: vec![pin("A", "Anode", 0, 10), pin("K", "Cathode", 40, 10)],
        },
        (PartKind::Bjt, "PNP") => three("pnp.svg", PNP, "C", "B", "E"),
        (PartKind::Bjt, _) => three("npn.svg", NPN, "C", "B", "E"),
        (PartKind::Mosfet, "PMOS") => three("pmos.svg", PMOS, "D", "G", "S"),
        (PartKind::Mosfet, _) => three("nmos.svg", NMOS, "D", "G", "S"),
        (PartKind::Jfet, "PJF") => three("pjf.svg", PJF, "D", "G", "S"),
        (PartKind::Jfet, _) => three("njf.svg", NJF, "D", "G", "S"),
        (PartKind::Subckt, _) => box_symbol(name, ports),
    }
}

pub(crate) fn pin(id: &str, name: &str, x: i64, y: i64) -> Pin {
    Pin { id: id.into(), name: Some(name.into()), x, y, optional: false }
}

fn round_up_10(v: i64) -> i64 {
    (v + 9) / 10 * 10
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Odd ports on the left, even on the right, 20 px apart starting at y = 20.
fn box_symbol(name: &str, ports: &[String]) -> GeneratedSymbol {
    let rows = (ports.len() as i64 + 1) / 2;
    let height = (rows * 20 + 20).max(40);
    let longest = |side: usize| ports.iter().skip(side).step_by(2).map(|p| p.len() as i64).max().unwrap_or(0);
    let width = round_up_10((name.len() as i64 * 6 + 30).max((longest(0) + longest(1)) * 4 + 40)).max(80);

    let mut pins = Vec::new();
    let mut body = format!(r#"<rect x="10" y="4" width="{}" height="{}" rx="2"/>"#, width - 20, height - 8);
    for (i, port) in ports.iter().enumerate() {
        let row = i as i64 / 2;
        let y = 20 + row * 20;
        let left = i % 2 == 0;
        let x = if left { 0 } else { width };
        pins.push(pin(&(i + 1).to_string(), port, x, y));
        let (x1, x2, label_x, anchor) = if left { (0, 10, 13, "start") } else { (width - 10, width, width - 13, "end") };
        body.push_str(&format!(r#"<path d="M{x1} {y}h{}"/>"#, x2 - x1));
        body.push_str(&format!(
            r#"<text x="{label_x}" y="{}" font-size="6" text-anchor="{anchor}" fill="currentColor" stroke="none">{}</text>"#,
            y + 2,
            escape(port)
        ));
    }
    body.push_str(&format!(
        r#"<text x="{}" y="{}" font-size="8" text-anchor="middle" fill="currentColor" stroke="none">{}</text>"#,
        width / 2,
        height - 8,
        escape(name)
    ));
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" fill="none" stroke="currentColor" stroke-width="1.5" font-family="Segoe UI, sans-serif">{body}</svg>"#
    );
    GeneratedSymbol { file_name: format!("{name}.svg"), svg, width, height, pins }
}
```

- [ ] **Step 5: Run tests**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::`
Expected: all pass. The candidate tests are unaffected, since they don't inspect symbols.

- [ ] **Step 6: Commit**

```bash
cd /c/multysm
git add components/core/symbols/pmos.svg components/core/symbols/njf.svg components/core/symbols/pjf.svg crates/multysm-core/src/import/symbols.rs
git commit -m "feat(multysm-core): device and generated box symbols for imported parts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Writing, listing and removing user packs

**Files:**
- Create: `crates/multysm-core/src/import/pack.rs`
- Modify: `crates/multysm-core/src/import/mod.rs` (add `pub mod pack;`)

**Interfaces:**
- Consumes: `Candidate`, `slug` (Task 2), `GeneratedSymbol` (Task 3), `crate::library::{load_library, Manifest, Symbol, Spice, DeviceSpice, Category}`.
- Produces:
  - `#[derive(Serialize, Deserialize)] #[serde(rename_all = "camelCase")] pub struct PackInfo { pub id: String, pub name: String, pub origin: String, pub sources: Vec<String>, pub imported_at: u64, pub parts: Vec<PackPart> }`
  - `pub struct PackPart { pub id: String, pub model_name: String }` (camelCase)
  - `pub fn list_packs(packs_dir: &Path) -> Vec<PackInfo>`, sorted by id; skips folders without a readable `pack.json`.
  - `pub fn pack_roots(packs_dir: &Path) -> Vec<PathBuf>`: folders of `list_packs`, same order.
  - `pub fn existing_models(packs_dir: &Path) -> BTreeMap<String, String>`: upper-case model name → pack id.
  - `pub fn new_pack_id(packs_dir: &Path, first_source: &str) -> String`
  - `pub fn part_id(pack_id: &str, part_slug: &str) -> String`
  - `pub fn write_part(pack_dir: &Path, pack_id: &str, candidate: &Candidate, category: Category) -> Result<PackPart, String>`
  - `pub fn write_pack_info(pack_dir: &Path, info: &PackInfo) -> Result<(), String>`
  - `pub fn remove_pack(packs_dir: &Path, pack_id: &str) -> Result<(), String>`
  - `pub fn remove_part(packs_dir: &Path, pack_id: &str, model_name: &str) -> Result<(), String>`: deletes that part's files and its `pack.json` entry, and the pack folder when no parts remain.
  - `pub fn now_seconds() -> u64`

- [ ] **Step 1: Write the failing tests**

`crates/multysm-core/src/import/pack.rs`, tests only (add `pub mod pack;` to `import/mod.rs`):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::candidate::build_candidates;
    use crate::import::spice::parse_spice;
    use crate::library::load_library;
    use std::collections::BTreeMap;

    fn candidates() -> Vec<Candidate> {
        let text = ".model D5819 D(IS=31.7u N=1.373)\n.subckt AMP inp inn out PARAMS: GAIN=1e5\nE1 out 0 inp inn {GAIN}\n.ends\n";
        build_candidates(&[("vendor parts.lib".into(), parse_spice(text))], &BTreeMap::new())
    }

    fn write_pack(packs: &Path, id: &str, cs: &[Candidate]) -> PathBuf {
        let dir = packs.join(id);
        let parts: Vec<PackPart> = cs.iter().map(|c| write_part(&dir, id, c, c.category).unwrap()).collect();
        write_pack_info(&dir, &PackInfo {
            id: id.into(), name: id.into(), origin: "import".into(),
            sources: vec!["vendor parts.lib".into()], imported_at: 1, parts,
        }).unwrap();
        dir
    }

    #[test]
    fn written_parts_load_as_a_library_without_issues() {
        let packs = tempfile::tempdir().unwrap();
        let id = new_pack_id(packs.path(), "vendor parts.lib");
        assert_eq!(id, "imported-vendor-parts");
        let dir = write_pack(packs.path(), &id, &candidates());
        let library = load_library(&[dir]);
        assert!(library.issues.is_empty(), "{:#?}", library.issues);
        let amp = library.get("imported.vendor_parts.amp").expect("amp part");
        assert_eq!(amp.manifest.name, "AMP");
        assert_eq!(amp.manifest.category, Category::Misc);
        assert!(amp.manifest.tags.contains(&"imported".to_string()));
        assert_eq!(amp.manifest.params[0].key, "gain");
        let text = std::fs::read_to_string(amp.subckt_path.as_ref().unwrap()).unwrap();
        assert!(text.contains(".subckt AMP"));
        assert!(library.get("imported.vendor_parts.d5819").is_some());
    }

    #[test]
    fn pack_ids_do_not_clash() {
        let packs = tempfile::tempdir().unwrap();
        write_pack(packs.path(), "imported-vendor-parts", &candidates());
        assert_eq!(new_pack_id(packs.path(), "Vendor-Parts.LIB"), "imported-vendor-parts-2");
    }

    #[test]
    fn lists_packs_roots_and_existing_models() {
        let packs = tempfile::tempdir().unwrap();
        write_pack(packs.path(), "imported-b", &candidates()[..1]);
        write_pack(packs.path(), "imported-a", &candidates()[1..]);
        std::fs::create_dir_all(packs.path().join(".tmp-x")).unwrap();
        let listed: Vec<String> = list_packs(packs.path()).into_iter().map(|p| p.id).collect();
        assert_eq!(listed, ["imported-a", "imported-b"]);
        assert_eq!(pack_roots(packs.path()), [packs.path().join("imported-a"), packs.path().join("imported-b")]);
        let models = existing_models(packs.path());
        assert_eq!(models.get("D5819").map(String::as_str), Some("imported-b"));
        assert_eq!(models.get("AMP").map(String::as_str), Some("imported-a"));
    }

    #[test]
    fn removes_parts_and_packs() {
        let packs = tempfile::tempdir().unwrap();
        let dir = write_pack(packs.path(), "imported-x", &candidates());
        remove_part(packs.path(), "imported-x", "d5819").unwrap();
        let info = &list_packs(packs.path())[0];
        assert_eq!(info.parts.len(), 1);
        assert!(!dir.join("components/Diodes/d5819.json").exists());
        remove_part(packs.path(), "imported-x", "AMP").unwrap();
        assert!(!dir.exists(), "empty pack folder is deleted");

        write_pack(packs.path(), "imported-y", &candidates());
        remove_pack(packs.path(), "imported-y").unwrap();
        assert!(list_packs(packs.path()).is_empty());
        assert!(remove_pack(packs.path(), "../outside").is_err());
        assert!(remove_pack(packs.path(), "imported-missing").is_err());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::pack`
Expected: compile errors.

- [ ] **Step 3: Implement**

Above the tests in `pack.rs`:
```rust
//! User packs created by imports: `<packs>/<id>/{pack.json,components,symbols,models}`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::candidate::{slug, Candidate};
use crate::library::{Category, DeviceSpice, Manifest, Spice, Symbol};

pub const PACK_FILE: &str = "pack.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPart {
    pub id: String,
    pub model_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub origin: String,
    pub sources: Vec<String>,
    pub imported_at: u64,
    pub parts: Vec<PackPart>,
}

pub fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn is_pack_id(id: &str) -> bool {
    id.starts_with("imported-") && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn read_info(dir: &Path) -> Option<PackInfo> {
    let text = fs::read_to_string(dir.join(PACK_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn list_packs(packs_dir: &Path) -> Vec<PackInfo> {
    let mut packs: Vec<PackInfo> = fs::read_dir(packs_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| read_info(&e.path()).filter(|info| is_pack_id(&info.id) && e.file_name() == info.id.as_str()))
        .collect();
    packs.sort_by(|a, b| a.id.cmp(&b.id));
    packs
}

pub fn pack_roots(packs_dir: &Path) -> Vec<PathBuf> {
    list_packs(packs_dir).into_iter().map(|p| packs_dir.join(p.id)).collect()
}

pub fn existing_models(packs_dir: &Path) -> BTreeMap<String, String> {
    let mut models = BTreeMap::new();
    for pack in list_packs(packs_dir) {
        for part in pack.parts {
            models.entry(part.model_name.to_ascii_uppercase()).or_insert_with(|| pack.id.clone());
        }
    }
    models
}

pub fn new_pack_id(packs_dir: &Path, first_source: &str) -> String {
    let stem = Path::new(first_source).file_stem().and_then(|s| s.to_str()).unwrap_or("parts");
    let base_slug = slug(stem).replace('_', "-");
    let base = format!("imported-{}", if base_slug.is_empty() { "parts" } else { &base_slug });
    let taken = |id: &str| packs_dir.join(id).exists();
    if !taken(&base) {
        return base;
    }
    (2..).map(|n| format!("{base}-{n}")).find(|id| !taken(id)).expect("unbounded")
}

pub fn part_id(pack_id: &str, part_slug: &str) -> String {
    let pack = pack_id.trim_start_matches("imported-").replace('-', "_");
    format!("imported.{pack}.{part_slug}")
}

fn category_dir(category: Category) -> String {
    serde_json::to_value(category).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "Misc".into())
}

fn write(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    fs::write(path, contents).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

pub fn write_part(pack_dir: &Path, pack_id: &str, candidate: &Candidate, category: Category) -> Result<PackPart, String> {
    let id = part_id(pack_id, &candidate.slug);
    let symbol = &candidate.symbol;
    write(&pack_dir.join("symbols").join(&symbol.file_name), &symbol.svg)?;
    write(&pack_dir.join("models").join(format!("{}.lib", candidate.slug)), &format!("{}\n", candidate.model_text))?;

    let mut tags = vec!["imported".to_string()];
    if let Some(kind) = candidate.kind {
        tags.push(serde_json::to_value(kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default());
    }
    if let Some(model_type) = &candidate.model_type {
        tags.push(model_type.to_ascii_lowercase());
    }
    let manifest = Manifest {
        schema: 1,
        id: id.clone(),
        name: candidate.name.clone(),
        category,
        tags,
        symbol: Symbol {
            width: symbol.width,
            height: symbol.height,
            svg: format!("../../symbols/{}", symbol.file_name),
            pins: symbol.pins.clone(),
        },
        params: candidate.params.clone(),
        spice: Spice::Analog(DeviceSpice {
            ref_prefix: candidate.ref_prefix.clone(),
            template: candidate.template.clone(),
            models: vec![],
            subckt: Some(format!("../../models/{}.lib", candidate.slug)),
        }),
        live: None,
        controls: vec![],
    };
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    write(&pack_dir.join("components").join(category_dir(category)).join(format!("{}.json", candidate.slug)), &json)?;
    Ok(PackPart { id, model_name: candidate.name.clone() })
}

pub fn write_pack_info(pack_dir: &Path, info: &PackInfo) -> Result<(), String> {
    let json = serde_json::to_string_pretty(info).map_err(|e| e.to_string())?;
    write(&pack_dir.join(PACK_FILE), &json)
}

fn pack_dir(packs_dir: &Path, pack_id: &str) -> Result<PathBuf, String> {
    let dir = packs_dir.join(pack_id);
    if !is_pack_id(pack_id) || read_info(&dir).is_none() {
        return Err(format!("no imported pack '{pack_id}'"));
    }
    Ok(dir)
}

pub fn remove_pack(packs_dir: &Path, pack_id: &str) -> Result<(), String> {
    let dir = pack_dir(packs_dir, pack_id)?;
    fs::remove_dir_all(&dir).map_err(|e| format!("cannot remove {}: {e}", dir.display()))
}

pub fn remove_part(packs_dir: &Path, pack_id: &str, model_name: &str) -> Result<(), String> {
    let dir = pack_dir(packs_dir, pack_id)?;
    let mut info = read_info(&dir).expect("checked by pack_dir");
    let part_slug = slug(model_name);
    info.parts.retain(|p| !p.model_name.eq_ignore_ascii_case(model_name));
    if info.parts.is_empty() {
        return fs::remove_dir_all(&dir).map_err(|e| format!("cannot remove {}: {e}", dir.display()));
    }
    for entry in walkdir::WalkDir::new(dir.join("components")).into_iter().flatten() {
        if entry.path().file_stem().is_some_and(|s| s == part_slug.as_str()) {
            let _ = fs::remove_file(entry.path());
        }
    }
    let _ = fs::remove_file(dir.join("models").join(format!("{part_slug}.lib")));
    let _ = fs::remove_file(dir.join("symbols").join(format!("{part_slug}.svg")));
    write_pack_info(&dir, &info)
}
```
Device symbols (`diode.svg`, …) are shared inside a pack and are never removed per part.

- [ ] **Step 4: Run tests**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::pack`
Expected: 4 passed. If `written_parts_load_as_a_library_without_issues` reports a schema issue, print `library.issues` and fix the manifest fields to match `schemas/manifest.schema.json`. Don't loosen the schema.

- [ ] **Step 5: Commit**

```bash
cd /c/multysm
git add crates/multysm-core/src/import
git commit -m "feat(multysm-core): write, list and remove imported user packs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: PSpice compatibility and the smoke test

**Files:**
- Modify: `crates/multysm-core/src/engine/mod.rs` (`Engine::run`)
- Create: `crates/multysm-core/src/import/smoke.rs`
- Modify: `crates/multysm-core/src/import/mod.rs` (add `pub mod smoke;`)
- Modify: `crates/multysm-core/tests/engine_smoke.rs` (a PSpice-syntax test)

**Interfaces:**
- Consumes: `Candidate` (Task 2), `run_netlist_with`, `EngineConfig`, `netlist::template::render`.
- Produces:
  - `pub const SMOKE_TIMEOUT: Duration` (5 s)
  - `pub fn smoke_netlist(candidate: &Candidate) -> Result<String, String>`
  - `pub fn smoke_test(config: &EngineConfig, candidate: &Candidate) -> Result<(), (String, Vec<String>)>`: `Err((message, log))`.

- [ ] **Step 1: Write the failing PSpice-syntax engine test**

Look at the top of `crates/multysm-core/tests/engine_smoke.rs` for its imports and helper usage, then append:
```rust
#[test]
fn pspice_value_sources_load() {
    // `VALUE={…}` controlled sources are PSpice syntax; ngspice only accepts them in PSpice compatibility mode.
    let netlist = "* psa\nV1 in 0 DC 1.5\nE1 out 0 VALUE={V(in)*2}\nR1 out 0 1k\n.op\n.end\n";
    let result = multysm_core::engine::run_netlist(&common::engine_config(), netlist).expect("PSpice syntax loads");
    let out = result.last("out").unwrap();
    assert!((out - 3.0).abs() < 1e-6, "v(out) = {out}");
}
```
If `engine_smoke.rs` has no `mod common;`, add `mod common;` at its top.

- [ ] **Step 2: Run to verify failure**

Run: `cd /c/multysm && cargo test -p multysm-core --test engine_smoke pspice_value_sources_load`
Expected: FAIL with an `EngineError::Circuit` log about `VALUE`/an unknown parameter. If it already passes, ngspice accepts this syntax natively. Keep the test anyway and still do Step 3, because other PSpice constructs need the mode.

- [ ] **Step 3: PSpice compatibility — decided against (done during execution)**

`set ngbehavior=psa` was tried and reverted. `pspice_value_sources_load` passes without it, and
`psa` stops treating `gnd` as ground, which core subcircuits (`ne555.lib`, `sn74xx.lib`) use as a port
name. No engine change; spec §3.6 updated.

Known environment issue: `timeout_stops_a_long_run` and `cancel_stops_a_long_run_and_the_engine_is_reusable`
fail on machines with less than ~3.2 GB free memory ("memory required (3200003200 Bytes) is more than
memory available"), with or without `psa`. They are unrelated to this plan.

- [ ] **Step 4: Run the whole core suite**

Run: `cd /c/multysm && cargo test -p multysm-core`
Expected: all tests pass.

- [ ] **Step 5: Write the failing smoke tests**

`crates/multysm-core/src/import/smoke.rs`, tests only:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::candidate::build_candidates;
    use crate::import::spice::parse_spice;
    use std::collections::BTreeMap;

    fn candidate(text: &str, name: &str) -> Candidate {
        build_candidates(&[("t.lib".into(), parse_spice(text))], &BTreeMap::new())
            .into_iter()
            .find(|c| c.name == name)
            .unwrap()
    }

    fn config() -> EngineConfig {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/ngspice");
        EngineConfig::from_vendor_dir(&dir)
    }

    #[test]
    fn netlist_ties_every_pin_and_drives_the_first() {
        let c = candidate(".subckt AMP a b out PARAMS: GAIN=10\nE1 out 0 a b {GAIN}\n.ends\n", "AMP");
        let text = smoke_netlist(&c).unwrap();
        assert!(text.contains("XU1 n1 n2 n3 AMP PARAMS: GAIN=10"), "{text}");
        for pin in ["n1", "n2", "n3"] {
            assert!(text.contains(&format!("Rg_{pin} {pin} 0 1meg")), "{text}");
        }
        assert!(text.contains("Vsmoke vsmoke 0 DC 1") && text.contains("Rsmoke vsmoke n1 1k"));
        assert!(text.contains(".subckt AMP") && text.trim_end().ends_with(".end"));
    }

    #[test]
    fn good_models_pass_and_broken_ones_fail_with_a_log() {
        let good = candidate(".model DG D(IS=1e-14)\n", "DG");
        assert_eq!(smoke_test(&config(), &good), Ok(()));
        let bad = candidate(".subckt BROKEN a b\nQ1 a b 0 QMISSING\n.ends\n", "BROKEN");
        let (message, log) = smoke_test(&config(), &bad).unwrap_err();
        assert!(message.contains("ngspice"), "{message}");
        assert!(!log.is_empty());
    }
}
```

- [ ] **Step 6: Run to verify failure**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::smoke`
Expected: compile errors.

- [ ] **Step 7: Implement**

Above the tests in `smoke.rs`:
```rust
//! Loads one imported part in ngspice to catch models that don't parse.

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use super::candidate::Candidate;
use crate::engine::{run_netlist_with, EngineConfig, EngineError};
use crate::netlist::template::render;

pub const SMOKE_TIMEOUT: Duration = Duration::from_secs(5);

fn node(pin_id: &str) -> String {
    let safe: String = pin_id.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    format!("n{safe}")
}

pub fn smoke_netlist(candidate: &Candidate) -> Result<String, String> {
    let pins = &candidate.symbol.pins;
    let first = pins.first().ok_or("the part has no pins")?;
    let reference = format!("{}1", candidate.ref_prefix);
    let device = render(&candidate.template, |name| {
        if name == "ref" {
            return Some(reference.clone());
        }
        if let Some(pin) = name.strip_prefix("pin.") {
            return pins.iter().any(|p| p.id == pin).then(|| node(pin));
        }
        candidate.params.iter().find(|p| p.key == name).map(|p| p.default.clone())
    })
    .map_err(|e| e.to_string())?;

    let mut lines = vec!["* multysm import smoke test".to_string(), device];
    for pin in pins {
        let n = node(&pin.id);
        lines.push(format!("Rg_{n} {n} 0 1meg"));
    }
    lines.push("Vsmoke vsmoke 0 DC 1".into());
    lines.push(format!("Rsmoke vsmoke {} 1k", node(&first.id)));
    lines.push(candidate.model_text.clone());
    lines.push(".op".into());
    lines.push(".end".into());
    Ok(lines.join("\n") + "\n")
}

pub fn smoke_test(config: &EngineConfig, candidate: &Candidate) -> Result<(), (String, Vec<String>)> {
    let netlist = smoke_netlist(candidate).map_err(|e| (e, vec![]))?;
    match run_netlist_with(config, &netlist, &AtomicBool::new(false), Some(SMOKE_TIMEOUT)) {
        // Loading is what's being checked. The artificial bias (floating supplies, 1 V on one pin)
        // often keeps real macromodels from converging or makes them slow; that is not a broken model.
        Ok(_) | Err(EngineError::Run { .. }) | Err(EngineError::Timeout { .. }) => Ok(()),
        Err(error) => {
            let log = error.log().map(<[String]>::to_vec).unwrap_or_default();
            Err((format!("ngspice could not load the model: {}", error.to_string().lines().next().unwrap_or("")), log))
        }
    }
}
```
If `netlist::template` isn't `pub`, make it `pub mod template;` in `crates/multysm-core/src/netlist/mod.rs` (check first with `grep -n "mod template" crates/multysm-core/src/netlist/mod.rs`). The `EngineError::Load` message also starts with "could not load ngspice", so it contains "ngspice" too.

- [ ] **Step 8: Run tests**

Run: `cd /c/multysm && cargo test -p multysm-core --lib import::smoke`
Expected: 2 passed. The broken fixture is `Q1 a b 0 QMISSING` (undefined model): this ngspice build accepts `R1 a b` with no value. Run and convergence errors count as a pass. If this build accepts it, use `Q1 a b c QMISSING` (model not defined) as the broken body.

- [ ] **Step 9: Commit**

```bash
cd /c/multysm
git add crates/multysm-core/src/engine/mod.rs crates/multysm-core/src/import crates/multysm-core/tests/engine_smoke.rs crates/multysm-core/src/netlist/mod.rs
git commit -m "feat(multysm-core): PSpice compatibility mode and import smoke test

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Preview and commit, with an end-to-end core test

**Files:**
- Modify: `crates/multysm-core/src/import/mod.rs`
- Create: `crates/multysm-core/tests/fixtures/import/opamp_macro.lib`
- Create: `crates/multysm-core/tests/fixtures/import/discretes.lib`
- Create: `crates/multysm-core/tests/import.rs`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct PreviewFile { pub path: String, pub name: String, pub warnings: Vec<String>, pub error: Option<String> }`
  - `#[derive(Serialize, Clone)] #[serde(rename_all = "camelCase")] pub struct Preview { pub files: Vec<PreviewFile>, pub candidates: Vec<Candidate> }`
  - `pub fn preview(paths: &[PathBuf], packs_dir: &Path) -> Preview`
  - `#[derive(Deserialize)] #[serde(rename_all = "camelCase")] pub struct Choice { pub key: String, pub selected: bool, pub category: Category }`
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct FailedPart { pub key: String, pub name: String, pub message: String, pub log: Vec<String> }`
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct ImportReport { pub pack_id: Option<String>, pub imported: Vec<String>, pub failed: Vec<FailedPart>, pub skipped: Vec<String>, pub cancelled: bool }`
  - `pub fn commit(preview: &Preview, choices: &[Choice], packs_dir: &Path, config: &EngineConfig, cancel: &AtomicBool, progress: &mut dyn FnMut(usize, usize)) -> Result<ImportReport, String>`
  - `Category` needs `Deserialize`. It already derives it.

- [ ] **Step 1: Add fixtures (written for this project, no third-party text)**

`crates/multysm-core/tests/fixtures/import/opamp_macro.lib`:
```
* multysm test fixture: simple op-amp macromodel in PSpice style
* Connections: non-inverting input, inverting input, positive supply, negative supply, output
.SUBCKT DEMO_OPAMP INP INN VCC VEE OUT PARAMS: AOL=100k ROUT=75
XIN INP INN MID DEMO_INPUT
EGAIN GAINOUT 0 VALUE={V(MID)*AOL}
RO GAINOUT OUT {ROUT}
DHI OUT VCC DCLAMP
DLO VEE OUT DCLAMP
.MODEL DCLAMP D(IS=1e-15)
.ENDS DEMO_OPAMP
*
.SUBCKT DEMO_INPUT P N O
RIN P N 2meg
EDIFF O 0 P N 1
RDIFF O 0 1meg
.ENDS
.include "not_here.lib"
```
`crates/multysm-core/tests/fixtures/import/discretes.lib`:
```
* multysm test fixture: discrete device models
.model DEMO_SCHOTTKY D(IS=31.7u N=1.373 RS=0.051 CJO=110p BV=40)
.model DEMO_NPN NPN(IS=1e-14 BF=200 VAF=100)
.model DEMO_PMOS PMOS(LEVEL=1 VTO=-2 KP=0.05)
.model DEMO_SWITCH SW(VT=1 RON=1)
```

- [ ] **Step 2: Write the failing integration test**

`crates/multysm-core/tests/import.rs`:
```rust
mod common;

use std::sync::atomic::AtomicBool;

use common::{core_library, engine_config, workspace_root, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::import::candidate::CandidateStatus;
use multysm_core::import::pack::list_packs;
use multysm_core::import::{commit, preview, Choice};
use multysm_core::library::load_library;
use multysm_core::simulate;

fn fixtures() -> Vec<std::path::PathBuf> {
    let dir = workspace_root().join("crates/multysm-core/tests/fixtures/import");
    vec![dir.join("opamp_macro.lib"), dir.join("discretes.lib")]
}

fn choices(p: &multysm_core::import::Preview) -> Vec<Choice> {
    p.candidates.iter().map(|c| Choice { key: c.key.clone(), selected: c.selected, category: c.category }).collect()
}

#[test]
fn preview_lists_candidates_and_file_warnings() {
    let packs = tempfile::tempdir().unwrap();
    let p = preview(&fixtures(), packs.path());
    assert_eq!(p.files.len(), 2);
    assert!(p.files[0].warnings.iter().any(|w| w.contains("not_here.lib")));
    let status = |name: &str| p.candidates.iter().find(|c| c.name == name).unwrap().status;
    assert_eq!(status("DEMO_OPAMP"), CandidateStatus::Ready);
    assert_eq!(status("DEMO_SWITCH"), CandidateStatus::Unsupported);
    let helper = p.candidates.iter().find(|c| c.name == "DEMO_INPUT").unwrap();
    assert!(!helper.selected);
    assert!(list_packs(packs.path()).is_empty(), "preview never writes");
}

#[test]
fn unreadable_files_are_reported_without_stopping_the_rest() {
    let packs = tempfile::tempdir().unwrap();
    let mut paths = fixtures();
    paths.insert(0, packs.path().join("missing.lib"));
    let p = preview(&paths, packs.path());
    assert!(p.files[0].error.is_some());
    assert!(p.candidates.iter().any(|c| c.name == "DEMO_OPAMP"));
}

#[test]
fn imported_op_amp_simulates_in_an_inverting_amplifier() {
    let packs = tempfile::tempdir().unwrap();
    let p = preview(&fixtures(), packs.path());
    let mut done = Vec::new();
    let report = commit(&p, &choices(&p), packs.path(), &engine_config(), &AtomicBool::new(false), &mut |d, t| done.push((d, t)))
        .unwrap();
    assert!(report.failed.is_empty(), "{:#?}", report.failed);
    assert_eq!(report.imported.len(), 4, "{:?}", report.imported); // opamp, schottky, npn, pmos
    assert_eq!(done.last(), Some(&(4, 4)));
    let pack_id = report.pack_id.clone().unwrap();
    assert_eq!(pack_id, "imported-opamp-macro");

    let core = workspace_root().join("components/core");
    let library = load_library(&[core, packs.path().join(&pack_id)]);
    assert!(library.issues.is_empty(), "{:#?}", library.issues);
    drop(core_library());

    let mut b = CircuitBuilder::new(&library, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vin = b.add("sources.dc_voltage", "V1", &[("voltage", "0.5")]);
    let vp = b.add("sources.dc_voltage", "V2", &[("voltage", "15")]);
    let vn = b.add("sources.dc_voltage", "V3", &[("voltage", "15")]);
    let rin = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let rf = b.add("basic.resistor", "R2", &[("resistance", "10k")]);
    let amp = b.add("imported.opamp_macro.demo_opamp", "U1", &[]);
    b.connect((&vin, "n"), (&gnd, "1"));
    b.connect((&vin, "p"), (&rin, "1"));
    b.connect((&rin, "2"), (&amp, "2"));
    b.connect((&rf, "1"), (&amp, "2"));
    b.connect((&rf, "2"), (&amp, "5"));
    b.connect((&amp, "1"), (&gnd, "1"));
    b.connect((&vp, "n"), (&gnd, "1"));
    b.connect((&vp, "p"), (&amp, "3"));
    b.connect((&vn, "p"), (&gnd, "1"));
    b.connect((&vn, "n"), (&amp, "4"));

    let (netlist, result) = simulate(&b.build(), &library, &engine_config()).unwrap();
    let out = netlist.nets.pin_net[&(amp.clone(), "5".to_string())].clone();
    let v = result.last(&out).unwrap();
    assert!((v + 5.0).abs() < 0.05, "inverting gain of -10 on 0.5 V gives -5 V, got {v}");
}

#[test]
fn reimport_replaces_the_old_part_and_removes_the_empty_pack() {
    let packs = tempfile::tempdir().unwrap();
    let discretes = vec![fixtures()[1].clone()];
    let first = preview(&discretes, packs.path());
    let only_schottky: Vec<Choice> = first
        .candidates
        .iter()
        .map(|c| Choice { key: c.key.clone(), selected: c.name == "DEMO_SCHOTTKY", category: c.category })
        .collect();
    commit(&first, &only_schottky, packs.path(), &engine_config(), &AtomicBool::new(false), &mut |_, _| {}).unwrap();

    let second = preview(&discretes, packs.path());
    let again = second.candidates.iter().find(|c| c.name == "DEMO_SCHOTTKY").unwrap();
    assert_eq!(again.status, CandidateStatus::AlreadyImported);
    let mut picks = choices(&second);
    picks.iter_mut().find(|c| c.key == again.key).unwrap().selected = true;
    let report = commit(&second, &picks, packs.path(), &engine_config(), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
    assert_eq!(report.pack_id.as_deref(), Some("imported-discretes-2"));

    let ids: Vec<String> = list_packs(packs.path()).into_iter().map(|p| p.id).collect();
    assert_eq!(ids, ["imported-discretes-2"], "the first pack held only the replaced part");
}

#[test]
fn cancelled_commit_keeps_tested_parts_and_skips_the_rest() {
    let packs = tempfile::tempdir().unwrap();
    let p = preview(&fixtures(), packs.path());
    let cancel = AtomicBool::new(false);
    let report = commit(&p, &choices(&p), packs.path(), &engine_config(), &cancel, &mut |done, _| {
        if done == 1 {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    })
    .unwrap();
    assert!(report.cancelled);
    assert_eq!(report.imported.len(), 1);
    assert_eq!(report.skipped.len(), 3);
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /c/multysm && cargo test -p multysm-core --test import`
Expected: compile errors (`preview`, `commit`, `Choice` not found).

- [ ] **Step 4: Implement `import/mod.rs`**

```rust
//! Importing parts from SPICE model files into user packs.

pub mod candidate;
pub mod category;
pub mod pack;
pub mod smoke;
pub mod spice;
pub mod symbols;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use crate::engine::EngineConfig;
use crate::library::Category;
use candidate::{build_candidates, Candidate, CandidateStatus};
use pack::{existing_models, new_pack_id, now_seconds, remove_part, write_pack_info, write_part, PackInfo};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub path: String,
    pub name: String,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub files: Vec<PreviewFile>,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub key: String,
    pub selected: bool,
    pub category: Category,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedPart {
    pub key: String,
    pub name: String,
    pub message: String,
    pub log: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// `None` when nothing was imported (no pack was created).
    pub pack_id: Option<String>,
    pub imported: Vec<String>,
    pub failed: Vec<FailedPart>,
    /// Keys not attempted because the import was cancelled.
    pub skipped: Vec<String>,
    pub cancelled: bool,
}

fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned())
}

/// Reads and analyses the files. Never writes and never runs ngspice.
pub fn preview(paths: &[PathBuf], packs_dir: &Path) -> Preview {
    let mut files = Vec::new();
    let mut parsed = Vec::new();
    for path in paths {
        let name = file_name(path);
        match spice::read_spice_file(path) {
            Ok(file) => {
                files.push(PreviewFile { path: path.display().to_string(), name: name.clone(), warnings: file.warnings.clone(), error: None });
                parsed.push((name, file));
            }
            Err(error) => {
                files.push(PreviewFile { path: path.display().to_string(), name: name.clone(), warnings: vec![], error: Some(error) });
                parsed.push((name, spice::SpiceFile::default()));
            }
        }
    }
    let candidates = build_candidates(&parsed, &existing_models(packs_dir));
    Preview { files, candidates }
}

/// Smoke-tests and writes the chosen parts into a new pack. The pack is built in a temporary
/// folder and renamed into place, so a failed write never leaves a half-written pack behind.
pub fn commit(
    preview: &Preview,
    choices: &[Choice],
    packs_dir: &Path,
    config: &EngineConfig,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<ImportReport, String> {
    let chosen: Vec<(&Candidate, Category)> = choices
        .iter()
        .filter(|c| c.selected)
        .filter_map(|choice| {
            preview
                .candidates
                .iter()
                .find(|c| c.key == choice.key && c.status.importable())
                .map(|c| (c, choice.category))
        })
        .collect();

    fs::create_dir_all(packs_dir).map_err(|e| format!("cannot create {}: {e}", packs_dir.display()))?;
    let first_source = chosen.first().map_or("parts", |(c, _)| c.source.as_str());
    let pack_id = new_pack_id(packs_dir, first_source);
    let temp = packs_dir.join(format!(".tmp-{pack_id}"));
    let _ = fs::remove_dir_all(&temp);

    let mut report = ImportReport { pack_id: None, imported: vec![], failed: vec![], skipped: vec![], cancelled: false };
    let mut parts = Vec::new();
    let mut replaced: Vec<(String, String)> = Vec::new();
    let total = chosen.len();

    let result = (|| -> Result<(), String> {
        for (index, (candidate, category)) in chosen.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                report.skipped.push(candidate.key.clone());
                continue;
            }
            match smoke::smoke_test(config, candidate) {
                Ok(()) => {
                    parts.push(write_part(&temp, &pack_id, candidate, *category)?);
                    report.imported.push(pack::part_id(&pack_id, &candidate.slug));
                    if let (CandidateStatus::AlreadyImported, Some(old)) = (candidate.status, &candidate.replaces) {
                        replaced.push((old.clone(), candidate.name.clone()));
                    }
                }
                Err((message, log)) => report.failed.push(FailedPart {
                    key: candidate.key.clone(),
                    name: candidate.name.clone(),
                    message,
                    log,
                }),
            }
            progress(index + 1, total);
        }
        if parts.is_empty() {
            return Ok(());
        }
        let mut sources: Vec<String> = chosen.iter().map(|(c, _)| c.source.clone()).collect();
        sources.dedup();
        write_pack_info(&temp, &PackInfo {
            id: pack_id.clone(),
            name: sources.join(", "),
            origin: "import".into(),
            sources,
            imported_at: now_seconds(),
            parts: std::mem::take(&mut parts),
        })?;
        fs::rename(&temp, packs_dir.join(&pack_id)).map_err(|e| format!("cannot finish the import: {e}"))?;
        report.pack_id = Some(pack_id.clone());
        // Only after the new pack is in place, so a failed rename never loses the old copy.
        for (old_pack, model_name) in &replaced {
            remove_part(packs_dir, old_pack, model_name)?;
        }
        Ok(())
    })();

    let _ = fs::remove_dir_all(&temp);
    result.map(|()| report)
}
```
Nothing is written into the final pack folder until the rename. The early `continue` for a cancelled import still calls no `progress`. The cancelled test sets the flag inside the first progress callback, so exactly one part is imported and three are skipped.

- [ ] **Step 5: Run the integration tests**

Run: `cd /c/multysm && cargo test -p multysm-core --test import`
Expected: 5 passed.
- If `imported_op_amp_simulates_in_an_inverting_amplifier` panics in `CircuitBuilder::connect` ("would touch"), reorder the `b.add` calls, not the assertions. The builder places parts by insertion order.
- If the op-amp output isn't -5 V, print `netlist.text` and check that pins 1–5 map to INP, INN, VCC, VEE, OUT.

- [ ] **Step 6: Run the whole core suite**

Run: `cd /c/multysm && cargo test -p multysm-core`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /c/multysm
git add crates/multysm-core/src/import/mod.rs crates/multysm-core/tests/import.rs crates/multysm-core/tests/fixtures/import
git commit -m "feat(multysm-core): import preview and commit into a new user pack

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Tauri — load user packs, import commands

**Files:**
- Modify: `src-tauri/src/library_dto.rs` (add `library_roots`)
- Modify: `src-tauri/src/simulation.rs` (roots instead of one root)
- Modify: `src-tauri/src/commands.rs` (`packs_dir`, `load_library`, `simulate`)
- Create: `src-tauri/src/import_commands.rs`
- Modify: `src-tauri/src/lib.rs` (register module, state, commands)
- Modify: `src-tauri/tests/simulation.rs`, `src-tauri/tests/commands.rs` (signature updates plus a packs test)

**Interfaces:**
- Consumes: `multysm_core::import::{preview, commit, Preview, Choice, ImportReport}`, `import::pack::{pack_roots, list_packs, remove_pack, PackInfo}`.
- Produces:
  - `pub fn library_roots(packs_dir: &Path) -> Vec<PathBuf>` (core first).
  - `run_simulation(shared, project, roots: &[PathBuf], config, timeout)` and `run_claimed(guard, project, roots: &[PathBuf], config, timeout)`.
  - `pub fn packs_dir(app: &AppHandle) -> Result<PathBuf, String>`
  - Tauri commands: `preview_import(paths: Vec<String>) -> PreviewDto { previewId: u64, files, candidates }`, `commit_import(previewId: u64, choices: Vec<Choice>) -> ImportReport`, `cancel_import()`, `list_imports() -> Vec<PackInfo>`, `remove_import(packId: String)`.
  - Event `import-progress` with payload `{ done: usize, total: usize }`.

- [ ] **Step 1: Update the simulation tests to the new signature (failing)**

In `src-tauri/tests/simulation.rs` replace:
```rust
fn root() -> PathBuf {
    components_root()
}
```
with:
```rust
fn root() -> Vec<PathBuf> {
    vec![components_root()]
}
```
Then replace every `&root()` argument with `&root()`. Unchanged text, now a `&Vec<PathBuf>`, which coerces to `&[PathBuf]`. Append:
```rust
#[test]
fn simulates_parts_from_user_packs() {
    use multysm_app_lib::library_dto::library_roots;
    use std::sync::atomic::AtomicBool;

    let packs = tempfile::tempdir().unwrap();
    let lib = packs.path().join("demo.lib");
    std::fs::write(&lib, ".model DEMO_D D(IS=1e-14)\n").unwrap();
    let p = multysm_core::import::preview(&[lib], packs.path());
    let choices: Vec<multysm_core::import::Choice> = p
        .candidates
        .iter()
        .map(|c| multysm_core::import::Choice { key: c.key.clone(), selected: true, category: c.category })
        .collect();
    multysm_core::import::commit(&p, &choices, packs.path(), &engine_config(), &AtomicBool::new(false), &mut |_, _| {}).unwrap();

    let roots = library_roots(packs.path());
    assert_eq!(roots.len(), 2);
    // V1 -> D1 (imported) -> R1 -> ground, using the divider layout with R1 swapped for the diode.
    let json = r#"{
  "format": 1, "app": "test", "packs": [],
  "components": [
    { "uid": "c1", "part": "sources.dc_voltage", "ref": "V1", "x": 0, "y": 100, "rot": 0, "mirror": false, "params": { "voltage": "5" } },
    { "uid": "c2", "part": "imported.demo.demo_d", "ref": "D1", "x": 100, "y": 90, "rot": 0, "mirror": false, "params": {} },
    { "uid": "c3", "part": "basic.resistor", "ref": "R2", "x": 200, "y": 90, "rot": 0, "mirror": false, "params": {} },
    { "uid": "c4", "part": "sources.ground", "ref": "GND1", "x": 10, "y": 200, "rot": 0, "mirror": false, "params": {} }
  ],
  "wires": [
    { "uid": "w1", "points": [[20,100],[100,100]] },
    { "uid": "w2", "points": [[140,100],[200,100]] },
    { "uid": "w3", "points": [[260,100],[260,200],[20,200]] },
    { "uid": "w4", "points": [[20,160],[20,200]] }
  ],
  "analysis": { "type": "op" }, "probes": [], "view": null
}"#;
    let project = parse_project(json).unwrap();
    let outcome = run_simulation(&SimShared::default(), &project, &roots, &engine_config(), Duration::from_secs(30));
    assert!(matches!(outcome, SimOutcome::Ok { .. }), "{outcome:?}");
}
```
The diode symbol is 40 px wide, so its K pin is at x=140. That's why `w2` starts at 140.

Run: `cd /c/multysm && cargo test -p multysm-app --test simulation`
Expected: compile errors (`library_roots` not found, the `run_simulation` argument type mismatches).

- [ ] **Step 2: Implement roots in `library_dto.rs`**

Add below `components_root`:
```rust
/// Built-in parts first, then every imported user pack.
pub fn library_roots(packs_dir: &std::path::Path) -> Vec<PathBuf> {
    let mut roots = vec![components_root()];
    roots.extend(multysm_core::import::pack::pack_roots(packs_dir));
    roots
}
```

- [ ] **Step 3: Switch `simulation.rs` to root lists**

1. `CachedLibrary` gains `roots: Vec<PathBuf>`.
2. `execute`, `run_simulation` and `run_claimed` take `roots: &[PathBuf]` instead of `components: &Path`, and pass `roots` to `with_library`.
3. `with_library` becomes:
```rust
    fn with_library<T>(&self, roots: &[PathBuf], f: impl FnOnce(&Library) -> T) -> T {
        let stamp = roots.iter().filter_map(|root| newest_mtime(root)).max();
        let mut cache = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let fresh = matches!(&*cache, Some(c) if stamp.is_some() && c.stamp == stamp && c.roots == roots);
        if !fresh {
            *cache = Some(CachedLibrary { stamp, roots: roots.to_vec(), library: load_library(roots) });
        }
        f(&cache.as_ref().expect("library cached above").library)
    }
```
4. Remove the now-unused `Path` import if the compiler warns.

- [ ] **Step 4: Update `commands.rs`**

```rust
use crate::library_dto::{library_dto, library_roots, LibraryDto};

/// `<app data>/packs`, created on first use.
pub fn packs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("packs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn load_library(app: AppHandle) -> Result<LibraryDto, String> {
    Ok(library_dto(&multysm_core::library::load_library(&library_roots(&packs_dir(&app)?))))
}
```
In `simulate`, add `app: AppHandle` as the first parameter. Compute `let roots = library_roots(&packs_dir(&app)?);` before `SimShared::claim`, and call `run_claimed(&guard, &project, &roots, &engine_config(), SIM_TIMEOUT)`. Remove `components_root` from the imports if unused.

`load_library` now returns `Result`. The frontend `invoke<LibraryData>` is unaffected, because an `Err` rejects the promise, which `AppShell` already reports.

- [ ] **Step 5: Import commands**

`src-tauri/src/import_commands.rs`:
```rust
//! Import commands: preview SPICE files, commit chosen parts, manage user packs.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use multysm_core::import::pack::{list_packs, remove_pack, PackInfo};
use multysm_core::import::{commit, preview, Choice, ImportReport, Preview};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::packs_dir;
use crate::simulation::engine_config;

#[derive(Default)]
pub struct ImportShared {
    latest: Mutex<Option<(u64, Preview)>>,
    next_id: AtomicU64,
    cancel: AtomicBool,
}

#[derive(Default, Clone)]
pub struct ImportState(pub Arc<ImportShared>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDto {
    pub preview_id: u64,
    #[serde(flatten)]
    pub preview: Preview,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

#[tauri::command]
pub async fn preview_import(app: AppHandle, state: tauri::State<'_, ImportState>, paths: Vec<String>) -> Result<PreviewDto, String> {
    let packs = packs_dir(&app)?;
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let result = preview(&paths, &packs);
        let id = shared.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        *shared.latest.lock().unwrap_or_else(|e| e.into_inner()) = Some((id, result.clone()));
        PreviewDto { preview_id: id, preview: result }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn commit_import(
    app: AppHandle,
    state: tauri::State<'_, ImportState>,
    preview_id: u64,
    choices: Vec<Choice>,
) -> Result<ImportReport, String> {
    let packs = packs_dir(&app)?;
    let shared = state.0.clone();
    let preview = match &*shared.latest.lock().unwrap_or_else(|e| e.into_inner()) {
        Some((id, preview)) if *id == preview_id => preview.clone(),
        _ => return Err("This preview is out of date. Pick the files again.".into()),
    };
    shared.cancel.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        commit(&preview, &choices, &packs, &engine_config(), &shared.cancel, &mut |done, total| {
            let _ = app.emit("import-progress", Progress { done, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_import(state: tauri::State<'_, ImportState>) {
    state.0.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn list_imports(app: AppHandle) -> Result<Vec<PackInfo>, String> {
    Ok(list_packs(&packs_dir(&app)?))
}

#[tauri::command]
pub fn remove_import(app: AppHandle, pack_id: String) -> Result<(), String> {
    remove_pack(&packs_dir(&app)?, &pack_id)
}
```
In `lib.rs`:
- Add `pub mod import_commands;` and `.manage(import_commands::ImportState::default())`.
- Add the five commands to `generate_handler!`: `import_commands::preview_import`, `import_commands::commit_import`, `import_commands::cancel_import`, `import_commands::list_imports`, `import_commands::remove_import`.

- [ ] **Step 6: Fix remaining callers and run the Tauri tests**

Run: `cd /c/multysm && grep -rn "run_simulation\|run_claimed\|components_root\|load_library" src-tauri/tests src-tauri/src/bin`
Update each simulation call to pass a root list (`&[components_root()]` or `&vec![components_root()]`). A test calling the `load_library` command directly now needs an `AppHandle`; switch it to `library_dto(&multysm_core::library::load_library(&[components_root()]))`, which is what it covered before.
Run: `cd /c/multysm && cargo test -p multysm-app`
Expected: all pass, including `simulates_parts_from_user_packs`.

- [ ] **Step 7: Commit**

```bash
cd /c/multysm
git add src-tauri/src src-tauri/tests
git commit -m "feat(src-tauri): load user packs and add import commands

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend import types and backends

**Files:**
- Create: `app/src/model/importTypes.ts`
- Modify: `app/src/backend/backend.ts`, `app/src/backend/tauriBackend.ts`, `app/src/backend/mockBackend.ts`
- Create: `app/src/backend/mockImport.ts`, `app/src/backend/mockImport.test.ts`

**Interfaces:**
- Consumes: the Task 7 command names and JSON shapes.
- Produces (TS):
```ts
export type CandidateStatus = "ready" | "already_imported" | "unsupported" | "unsafe" | "missing_dependency";
export type PartKind = "diode" | "bjt" | "mosfet" | "jfet" | "subckt";
export interface ImportSymbol { fileName: string; svg: string; width: number; height: number; pins: Pin[] }
export interface ImportCandidate { key: string; name: string; slug: string; kind: PartKind | null; modelType: string | null; category: Category; source: string; refPrefix: string; template: string; params: Param[]; symbol: ImportSymbol; description: string | null; status: CandidateStatus; messages: string[]; selected: boolean; replaces: string | null }
export interface ImportPreviewFile { path: string; name: string; warnings: string[]; error: string | null }
export interface ImportPreview { previewId: number; files: ImportPreviewFile[]; candidates: ImportCandidate[] }
export interface ImportChoice { key: string; selected: boolean; category: Category }
export interface ImportReport { packId: string | null; imported: string[]; failed: { key: string; name: string; message: string; log: string[] }[]; skipped: string[]; cancelled: boolean }
export interface PackInfo { id: string; name: string; origin: string; sources: string[]; importedAt: number; parts: { id: string; modelName: string }[] }
export const importable = (status: CandidateStatus) => status === "ready" || status === "already_imported";
```
- `Backend` additions:
```ts
  pickImportFiles(): Promise<string[]>;
  previewImport(paths: string[]): Promise<ImportPreview>;
  commitImport(previewId: number, choices: ImportChoice[], onProgress: (done: number, total: number) => void): Promise<ImportReport>;
  cancelImport(): Promise<void>;
  listImports(): Promise<PackInfo[]>;
  removeImport(packId: string): Promise<void>;
```
- Mock: `createMockBackend()` imports parts into its in-memory library, so `loadLibrary()` afterwards includes them (tagged `imported`).

- [ ] **Step 1: Write the types file** exactly as in Interfaces. Add `import type { Category, Param, Pin } from "./types";` at the top.

- [ ] **Step 2: Write the failing mock tests**

`app/src/backend/mockImport.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createMockBackend } from "./mockBackend";

describe("mock import", () => {
  it("previews a fixed set of candidates", async () => {
    const backend = createMockBackend();
    expect(await backend.pickImportFiles()).toEqual(["demo_parts.lib"]);
    const preview = await backend.previewImport(["demo_parts.lib"]);
    expect(preview.candidates.map((c) => [c.name, c.status, c.selected])).toEqual([
      ["DEMO_OPAMP", "ready", true],
      ["DEMO_INPUT", "ready", false],
      ["DEMO_SCHOTTKY", "ready", true],
      ["DEMO_SWITCH", "unsupported", false],
    ]);
    expect(preview.files[0].warnings).toHaveLength(1);
  });

  it("imports chosen parts into the library and lists and removes the pack", async () => {
    const backend = createMockBackend();
    const before = (await backend.loadLibrary()).parts.length;
    const preview = await backend.previewImport(["demo_parts.lib"]);
    const progress: number[] = [];
    const report = await backend.commitImport(
      preview.previewId,
      preview.candidates.map((c) => ({ key: c.key, selected: c.selected, category: c.name === "DEMO_OPAMP" ? "Analog" : c.category })),
      (done) => progress.push(done),
    );
    expect(report.imported).toEqual(["imported.demo_parts.demo_opamp", "imported.demo_parts.demo_schottky"]);
    expect(progress).toEqual([1, 2]);
    const library = await backend.loadLibrary();
    expect(library.parts.length).toBe(before + 2);
    const amp = library.parts.find((p) => p.manifest.id === "imported.demo_parts.demo_opamp")!;
    expect(amp.manifest.category).toBe("Analog");
    expect(amp.manifest.tags).toContain("imported");
    expect(amp.refPrefix).toBe("U");

    const packs = await backend.listImports();
    expect(packs.map((p) => [p.id, p.parts.length])).toEqual([["imported-demo-parts", 2]]);
    await backend.removeImport("imported-demo-parts");
    expect(await backend.listImports()).toEqual([]);
    expect((await backend.loadLibrary()).parts.length).toBe(before);
  });

  it("rejects a stale preview id", async () => {
    const backend = createMockBackend();
    await expect(backend.commitImport(99, [], () => {})).rejects.toBe("This preview is out of date. Pick the files again.");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /c/multysm/app && npx vitest run src/backend/mockImport.test.ts`
Expected: FAIL (`pickImportFiles` is not a function).

- [ ] **Step 4: Implement the mock import data**

`app/src/backend/mockImport.ts`:
```ts
import type { ImportCandidate, ImportPreview, PackInfo } from "@/model/importTypes";
import type { PartDef } from "@/model/types";

const box = (name: string, ports: string[]) => {
  const width = 80;
  const height = Math.max(40, Math.ceil(ports.length / 2) * 20 + 20);
  return {
    fileName: `${name.toLowerCase()}.svg`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="4" width="${width - 20}" height="${height - 8}"/></svg>`,
    width,
    height,
    pins: ports.map((port, i) => ({ id: String(i + 1), name: port, x: i % 2 === 0 ? 0 : width, y: 20 + Math.floor(i / 2) * 20 })),
  };
};

const diode = {
  fileName: "diode.svg",
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h13M27 10h13M13 2v16l14-8zM27 2v16"/></svg>`,
  width: 40,
  height: 20,
  pins: [{ id: "A", name: "Anode", x: 0, y: 10 }, { id: "K", name: "Cathode", x: 40, y: 10 }],
};

const base = { source: "demo_parts.lib", params: [], messages: [], replaces: null, description: null } as const;

/** A fixed preview so the import UI works in the plain browser and in tests. */
export function mockPreview(previewId: number): ImportPreview {
  const candidates: ImportCandidate[] = [
    { ...base, key: "0:DEMO_OPAMP", name: "DEMO_OPAMP", slug: "demo_opamp", kind: "subckt", modelType: null, category: "Misc",
      refPrefix: "U", template: "X{ref} {pin.1} {pin.2} {pin.3} {pin.4} {pin.5} DEMO_OPAMP",
      symbol: box("DEMO_OPAMP", ["INP", "INN", "VCC", "VEE", "OUT"]), description: "simple op-amp macromodel", status: "ready", selected: true },
    { ...base, key: "0:DEMO_INPUT", name: "DEMO_INPUT", slug: "demo_input", kind: "subckt", modelType: null, category: "Misc",
      refPrefix: "U", template: "X{ref} {pin.1} {pin.2} {pin.3} DEMO_INPUT", symbol: box("DEMO_INPUT", ["P", "N", "O"]), status: "ready", selected: false },
    { ...base, key: "0:DEMO_SCHOTTKY", name: "DEMO_SCHOTTKY", slug: "demo_schottky", kind: "diode", modelType: "D", category: "Diodes",
      refPrefix: "D", template: "{ref} {pin.A} {pin.K} DEMO_SCHOTTKY", symbol: diode, status: "ready", selected: true },
    { ...base, key: "0:DEMO_SWITCH", name: "DEMO_SWITCH", slug: "demo_switch", kind: null, modelType: "SW", category: "Misc",
      refPrefix: "", template: "", symbol: { fileName: "", svg: "", width: 0, height: 0, pins: [] },
      status: "unsupported", messages: ["SW models are not importable"], selected: false },
  ];
  return {
    previewId,
    files: [{ path: "demo_parts.lib", name: "demo_parts.lib", warnings: ["'.include' is not followed; import not_here.lib together with this file"], error: null }],
    candidates,
  };
}

export function mockPart(candidate: ImportCandidate, packSlug: string, category: ImportCandidate["category"]): PartDef {
  return {
    manifest: {
      schema: 1,
      id: `imported.${packSlug}.${candidate.slug}`,
      name: candidate.name,
      category,
      tags: ["imported", candidate.kind ?? ""],
      symbol: { width: candidate.symbol.width, height: candidate.symbol.height, svg: candidate.symbol.fileName, pins: candidate.symbol.pins },
      params: candidate.params,
      spice: { kind: "analog", refPrefix: candidate.refPrefix, template: candidate.template },
    },
    svg: candidate.symbol.svg,
    refPrefix: candidate.refPrefix,
  };
}

export type MockPack = PackInfo & { partDefs: PartDef[] };
```

- [ ] **Step 5: Wire the backends**

In `backend.ts`, add the six methods from Interfaces to `Backend` and `import type { ImportChoice, ImportPreview, ImportReport, PackInfo } from "@/model/importTypes";`.

In `mockBackend.ts`:
```ts
import { mockPart, mockPreview, type MockPack } from "./mockImport";
// inside createMockBackend, next to the other locals:
  const packs: MockPack[] = [];
  let previewId = 0;
// replace loadLibrary:
    loadLibrary: async () => {
      library = structuredClone(libraryJson) as unknown as LibraryData;
      library.parts.push(...packs.flatMap((p) => p.partDefs));
      return library;
    },
// add methods:
    pickImportFiles: async () => ["demo_parts.lib"],
    previewImport: async () => mockPreview(++previewId),
    commitImport: async (id, choices, onProgress) => {
      if (id !== previewId) throw "This preview is out of date. Pick the files again.";
      const preview = mockPreview(id);
      const chosen = choices.flatMap((choice) => {
        const candidate = preview.candidates.find((c) => c.key === choice.key);
        return choice.selected && candidate && (candidate.status === "ready" || candidate.status === "already_imported")
          ? [{ candidate, category: choice.category }]
          : [];
      });
      const packSlug = "demo_parts";
      const partDefs = chosen.map(({ candidate, category }, i) => {
        onProgress(i + 1, chosen.length);
        return mockPart(candidate, packSlug, category);
      });
      if (partDefs.length > 0) {
        packs.push({
          id: "imported-demo-parts", name: "demo_parts.lib", origin: "import", sources: ["demo_parts.lib"],
          importedAt: Math.floor(Date.now() / 1000),
          parts: partDefs.map((p) => ({ id: p.manifest.id, modelName: p.manifest.name })),
          partDefs,
        });
      }
      return { packId: partDefs.length > 0 ? "imported-demo-parts" : null, imported: partDefs.map((p) => p.manifest.id), failed: [], skipped: [], cancelled: false };
    },
    cancelImport: async () => {},
    listImports: async () => packs.map(({ partDefs: _parts, ...info }) => info),
    removeImport: async (packId) => {
      const index = packs.findIndex((p) => p.id === packId);
      if (index === -1) throw `no imported pack '${packId}'`;
      packs.splice(index, 1);
    },
```

In `tauriBackend.ts`:
```ts
import { listen } from "@tauri-apps/api/event";
import type { ImportPreview, ImportReport, PackInfo } from "@/model/importTypes";

const importFilters = [{ name: "SPICE models", extensions: ["lib", "mod", "cir", "sub", "spice", "txt"] }];
// methods:
  pickImportFiles: async () => {
    const picked = await open({ multiple: true, directory: false, filters: importFilters });
    return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  },
  previewImport: (paths) => invoke<ImportPreview>("preview_import", { paths }),
  commitImport: async (previewId, choices, onProgress) => {
    const unlisten = await listen<{ done: number; total: number }>("import-progress", (e) => onProgress(e.payload.done, e.payload.total));
    try {
      return await invoke<ImportReport>("commit_import", { previewId, choices });
    } finally {
      unlisten();
    }
  },
  cancelImport: () => invoke<void>("cancel_import"),
  listImports: () => invoke<PackInfo[]>("list_imports"),
  removeImport: (packId) => invoke<void>("remove_import", { packId }),
```

- [ ] **Step 6: Run tests and type-check**

Run: `cd /c/multysm/app && npx vitest run src/backend && npx tsc --noEmit -p .`
Expected: all pass, no type errors. Fix any other `Backend` implementations flagged by `tsc` (test doubles in `*.test.ts*`) by spreading `createMockBackend()` into them.

- [ ] **Step 7: Commit**

```bash
cd /c/multysm
git add app/src/model/importTypes.ts app/src/backend
git commit -m "feat(app): import types and backend methods (Tauri and mock)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Import dialog

**Files:**
- Create: `app/src/ui/ImportDialog.tsx`
- Create: `app/src/ui/ImportDialog.test.tsx`

**Interfaces:**
- Consumes: `Backend` import methods (Task 8), `importable`, `CATEGORIES`, `SymbolPreview`. Check `app/src/ui/SymbolPreview.tsx` for its props (`part: PartDef, width, height, showPins?`) and pass a `PartDef` built with `mockPart`-like logic: `{ manifest: { …symbol }, svg, refPrefix }`.
- Produces: `export default function ImportDialog({ backend, open, onClose, onImported }: { backend: Backend; open: boolean; onClose(): void; onImported(report: ImportReport): void })`

Behaviour:
1. **On open:** calls `backend.pickImportFiles()`. An empty result closes the dialog. Otherwise it calls `previewImport` and shows the table. Any rejection shows the message in the dialog, with a Close button.
2. **Table:**
   - Rows: tick box (disabled when `!importable(status)`), thumbnail, name, kind (`modelType ?? kind`), category `<select>` (15 options), status tag. Tag text: ready → "Ready", already_imported → "Already imported", unsupported → "Unsupported", unsafe → "Blocked", missing_dependency → "Missing dependency".
   - Messages show in a `title` and under the row.
   - File errors and warnings are listed above the table.
   - A search box filters by name. "Select all ready" ticks every `ready` row.
   - The primary button reads `Import N parts` (N = ticked importable rows) and is disabled at 0.
3. **Importing:** shows "Testing d/t…" with Cancel (`backend.cancelImport()`).
4. **Report:** "Imported N parts". Failures are listed with message plus a "Show log" toggle, and "Cancelled — M parts skipped" when cancelled. Done calls `onImported(report)` then `onClose()`.

- [ ] **Step 1: Write the failing tests**

`app/src/ui/ImportDialog.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import ImportDialog from "./ImportDialog";

async function openDialog(backend = createMockBackend()) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(<ImportDialog backend={backend} open onClose={onClose} onImported={onImported} />);
  await screen.findByRole("table", { name: "Import candidates" });
  return { backend, onClose, onImported };
}

const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) });

describe("ImportDialog", () => {
  it("closes without a preview when no files are picked", async () => {
    const backend = createMockBackend();
    backend.pickImportFiles = async () => [];
    const onClose = vi.fn();
    render(<ImportDialog backend={backend} open onClose={onClose} onImported={() => {}} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows candidates with default ticks, statuses and file warnings", async () => {
    await openDialog();
    expect(within(row("DEMO_OPAMP")).getByRole("checkbox")).toBeChecked();
    expect(within(row("DEMO_INPUT")).getByRole("checkbox")).not.toBeChecked();
    const sw = within(row("DEMO_SWITCH"));
    expect(sw.getByRole("checkbox")).toBeDisabled();
    expect(sw.getByText("Unsupported")).toBeTruthy();
    expect(screen.getByText(/not_here\.lib/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import 2 parts" })).toBeEnabled();
  });

  it("ticks, selects all ready, filters and disables import at zero", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Select all ready" }));
    expect(screen.getByRole("button", { name: "Import 3 parts" })).toBeEnabled();
    for (const name of ["DEMO_OPAMP", "DEMO_INPUT", "DEMO_SCHOTTKY"]) fireEvent.click(within(row(name)).getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Import 0 parts" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Filter parts…"), { target: { value: "schott" } });
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + one match
  });

  it("imports with edited categories, reports progress and the result", async () => {
    const { backend, onImported, onClose } = await openDialog();
    const commit = vi.spyOn(backend, "commitImport");
    fireEvent.change(within(row("DEMO_OPAMP")).getByRole("combobox"), { target: { value: "Analog" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 parts" }));
    expect(await screen.findByText("Imported 2 parts")).toBeTruthy();
    const choices = commit.mock.calls[0][1];
    expect(choices.find((c) => c.key === "0:DEMO_OPAMP")).toEqual({ key: "0:DEMO_OPAMP", selected: true, category: "Analog" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ packId: "imported-demo-parts" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("lists failed parts with their log", async () => {
    const backend = createMockBackend();
    backend.commitImport = async () => ({
      packId: null, imported: [], skipped: [], cancelled: false,
      failed: [{ key: "0:DEMO_OPAMP", name: "DEMO_OPAMP", message: "ngspice could not load the model", log: ["unknown subckt"] }],
    });
    await openDialog(backend);
    fireEvent.click(screen.getByRole("button", { name: "Import 2 parts" }));
    expect(await screen.findByText("Imported 0 parts")).toBeTruthy();
    expect(screen.getByText(/ngspice could not load the model/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    expect(screen.getByText("unknown subckt")).toBeTruthy();
  });

  it("shows a preview error", async () => {
    const backend = createMockBackend();
    backend.previewImport = async () => { throw "cannot read demo_parts.lib"; };
    render(<ImportDialog backend={backend} open onClose={() => {}} onImported={() => {}} />);
    expect(await screen.findByText("cannot read demo_parts.lib")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /c/multysm/app && npx vitest run src/ui/ImportDialog.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`app/src/ui/ImportDialog.tsx`:
```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage, type Backend } from "@/backend/backend";
import { importable, type CandidateStatus, type ImportCandidate, type ImportPreview, type ImportReport } from "@/model/importTypes";
import { CATEGORIES, type Category, type PartDef } from "@/model/types";
import SymbolPreview from "./SymbolPreview";

const STATUS_TEXT: Record<CandidateStatus, string> = {
  ready: "Ready",
  already_imported: "Already imported",
  unsupported: "Unsupported",
  unsafe: "Blocked",
  missing_dependency: "Missing dependency",
};

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "preview"; preview: ImportPreview }
  | { kind: "importing"; done: number; total: number }
  | { kind: "report"; report: ImportReport };

function previewPart(c: ImportCandidate): PartDef {
  return {
    manifest: {
      schema: 1, id: c.key, name: c.name, category: c.category, tags: [],
      symbol: { width: c.symbol.width, height: c.symbol.height, svg: c.symbol.fileName, pins: c.symbol.pins },
      params: c.params, spice: { kind: "analog", refPrefix: c.refPrefix, template: c.template },
    },
    svg: c.symbol.svg,
    refPrefix: c.refPrefix,
  };
}

export default function ImportDialog({ backend, open, onClose, onImported }: {
  backend: Backend; open: boolean; onClose(): void; onImported(report: ImportReport): void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [ticked, setTicked] = useState<Map<string, boolean>>(new Map());
  const [categories, setCategories] = useState<Map<string, Category>>(new Map());
  const [filter, setFilter] = useState("");
  const [openLog, setOpenLog] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPhase({ kind: "loading" });
    setFilter("");
    (async () => {
      try {
        const paths = await backend.pickImportFiles();
        if (!alive) return;
        if (paths.length === 0) { onClose(); return; }
        const preview = await backend.previewImport(paths);
        if (!alive) return;
        setTicked(new Map(preview.candidates.map((c) => [c.key, c.selected])));
        setCategories(new Map(preview.candidates.map((c) => [c.key, c.category])));
        setPhase({ kind: "preview", preview });
      } catch (e) {
        if (alive) setPhase({ kind: "error", message: errorMessage(e) });
      }
    })();
    return () => { alive = false; };
    // Re-pick only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preview = phase.kind === "preview" ? phase.preview : null;
  const shown = useMemo(
    () => (preview?.candidates ?? []).filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [preview, filter],
  );
  if (!open) return null;

  const count = preview ? preview.candidates.filter((c) => importable(c.status) && ticked.get(c.key)).length : 0;

  const runImport = async () => {
    if (!preview) return;
    const choices = preview.candidates.map((c) => ({
      key: c.key,
      selected: importable(c.status) && (ticked.get(c.key) ?? false),
      category: categories.get(c.key) ?? c.category,
    }));
    setPhase({ kind: "importing", done: 0, total: count });
    try {
      const report = await backend.commitImport(preview.previewId, choices, (done, total) =>
        setPhase({ kind: "importing", done, total }));
      setPhase({ kind: "report", report });
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  };

  const button = "rounded px-3 py-1 text-muted hover:bg-line hover:text-text disabled:opacity-40";
  const primary = "rounded bg-accent px-4 py-1 font-semibold text-bg disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4">
      <div role="dialog" aria-modal="true" aria-label="Import parts"
        className="flex max-h-full w-[880px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="font-semibold text-text">Import parts</span>
          {phase.kind !== "importing" && <button aria-label="Close" className={button} onClick={onClose}>✕</button>}
        </div>

        {phase.kind === "loading" && <div className="p-4 text-muted">Reading files…</div>}

        {phase.kind === "error" && (
          <div className="flex flex-col gap-3 p-4">
            <div role="alert" className="text-error">{phase.message}</div>
            <button className={`${button} self-end`} onClick={onClose}>Close</button>
          </div>
        )}

        {preview && (
          <>
            {preview.files.some((f) => f.error || f.warnings.length > 0) && (
              <ul className="max-h-24 overflow-y-auto border-b border-line px-3 py-2 text-[12px]">
                {preview.files.flatMap((f) => [
                  ...(f.error ? [<li key={`${f.path}:error`} className="text-error">{f.name}: {f.error}</li>] : []),
                  ...f.warnings.map((w, i) => <li key={`${f.path}:${i}`} className="text-muted">{f.name}: {w}</li>),
                ])}
              </ul>
            )}
            <div className="flex items-center gap-2 border-b border-line p-2">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter parts…"
                className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-text placeholder:text-muted focus:border-accent focus:outline-none" />
              <button className={button} onClick={() => setTicked((t) => new Map([...t, ...preview.candidates.filter((c) => c.status === "ready").map((c) => [c.key, true] as const)]))}>
                Select all ready
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table aria-label="Import candidates" className="w-full text-left">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr><th className="px-3 py-1"></th><th></th><th>Name</th><th>Kind</th><th>Category</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const canTick = importable(c.status);
                    return (
                      <tr key={c.key} aria-label={c.name} title={c.messages.join("\n")} className="border-t border-line align-top">
                        <td className="px-3 py-1">
                          <input type="checkbox" aria-label={`Import ${c.name}`} disabled={!canTick}
                            checked={canTick && (ticked.get(c.key) ?? false)}
                            onChange={(e) => setTicked((t) => new Map(t).set(c.key, e.target.checked))} />
                        </td>
                        <td className="py-1">{c.symbol.svg && <SymbolPreview part={previewPart(c)} width={32} height={20} />}</td>
                        <td className="py-1">
                          <div className="text-text">{c.name}</div>
                          {c.messages.length > 0 && <div className="text-[11px] text-muted">{c.messages.join(" · ")}</div>}
                        </td>
                        <td className="py-1 text-muted">{c.modelType ?? c.kind ?? ""}</td>
                        <td className="py-1">
                          <select aria-label={`Category for ${c.name}`} disabled={!canTick} value={categories.get(c.key) ?? c.category}
                            onChange={(e) => setCategories((m) => new Map(m).set(c.key, e.target.value as Category))}
                            className="rounded border border-line bg-bg px-1 text-text">
                            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                        </td>
                        <td className={`py-1 pr-3 ${canTick ? "text-accent" : "text-error"}`}>{STATUS_TEXT[c.status]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 border-t border-line p-2">
              <button className={button} onClick={onClose}>Cancel</button>
              <button className={primary} disabled={count === 0} onClick={() => void runImport()}>
                Import {count} parts
              </button>
            </div>
          </>
        )}

        {phase.kind === "importing" && (
          <div className="flex items-center justify-between gap-3 p-4">
            <span className="text-text">Testing {phase.done}/{phase.total}…</span>
            <button className={button} onClick={() => void backend.cancelImport()}>Cancel</button>
          </div>
        )}

        {phase.kind === "report" && (
          <div className="flex flex-col gap-2 p-4">
            <div className="text-text">Imported {phase.report.imported.length} parts</div>
            {phase.report.cancelled && <div className="text-muted">Cancelled — {phase.report.skipped.length} parts skipped</div>}
            {phase.report.failed.length > 0 && (
              <ul className="max-h-64 overflow-y-auto">
                {phase.report.failed.map((f) => (
                  <li key={f.key} className="border-t border-line py-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-error">{f.name}: {f.message}</span>
                      {f.log.length > 0 && (
                        <button className={button} onClick={() => setOpenLog(openLog === f.key ? null : f.key)}>
                          {openLog === f.key ? "Hide log" : "Show log"}
                        </button>
                      )}
                    </div>
                    {openLog === f.key && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{f.log.join("\n")}</pre>}
                  </li>
                ))}
              </ul>
            )}
            <button className={`${primary} self-end`} onClick={() => { onImported(phase.report); onClose(); }}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
```
The row test helper matches rows by accessible name through `aria-label={c.name}`. `getByRole("row", { name: /DEMO_OPAMP/ })` matches only that row, because the header row has no such name.

- [ ] **Step 4: Run tests**

Run: `cd /c/multysm/app && npx vitest run src/ui/ImportDialog.test.tsx && npx tsc --noEmit -p .`
Expected: 6 passed, no type errors. If the linter rejects the `eslint-disable` comment (no ESLint config in this repo), delete the comment line.

- [ ] **Step 5: Commit**

```bash
cd /c/multysm
git add app/src/ui/ImportDialog.tsx app/src/ui/ImportDialog.test.tsx
git commit -m "feat(app): import dialog with preview, progress and report

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Manage imports, browser integration and end-to-end

**Files:**
- Create: `app/src/ui/ManageImports.tsx`, `app/src/ui/ManageImports.test.tsx`
- Modify: `app/src/ui/ComponentBrowser.tsx`, `app/src/ui/ComponentBrowser.test.tsx`
- Modify: `app/src/ui/AppShell.tsx`
- Create: `app/e2e/import.spec.ts`

**Interfaces:**
- Consumes: `Backend` (Task 8), `ImportDialog` (Task 9).
- Produces:
  - `ManageImports({ backend, open, onClose, onChanged }: { backend: Backend; open: boolean; onClose(): void; onChanged(): void })`
  - `ComponentBrowser` gains optional props `onImport?(): void` and `onManageImports?(): void`. The buttons render only when the prop is given. Parts tagged `imported` show an "Imported" badge in the list.

- [ ] **Step 1: Write the failing ManageImports tests**

`app/src/ui/ManageImports.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import ManageImports from "./ManageImports";

async function withOneImport() {
  const backend = createMockBackend();
  const preview = await backend.previewImport(["demo_parts.lib"]);
  await backend.commitImport(preview.previewId, preview.candidates.map((c) => ({ key: c.key, selected: c.selected, category: c.category })), () => {});
  return backend;
}

describe("ManageImports", () => {
  it("says when nothing is imported", async () => {
    render(<ManageImports backend={createMockBackend()} open onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText("No imported parts yet.")).toBeTruthy();
  });

  it("lists packs and removes one", async () => {
    const backend = await withOneImport();
    const onChanged = vi.fn();
    render(<ManageImports backend={backend} open onClose={() => {}} onChanged={onChanged} />);
    expect(await screen.findByText("demo_parts.lib")).toBeTruthy();
    expect(screen.getByText("2 parts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove demo_parts.lib" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText("No imported parts yet.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /c/multysm/app && npx vitest run src/ui/ManageImports.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement ManageImports**

`app/src/ui/ManageImports.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage, type Backend } from "@/backend/backend";
import type { PackInfo } from "@/model/importTypes";

export default function ManageImports({ backend, open, onClose, onChanged }: {
  backend: Backend; open: boolean; onClose(): void; onChanged(): void;
}) {
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPacks(await backend.listImports());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [backend]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const remove = async (pack: PackInfo) => {
    try {
      await backend.removeImport(pack.id);
      onChanged();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Manage imports" onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[560px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="font-semibold text-text">Imported parts</span>
          <button aria-label="Close" onClick={onClose} className="rounded px-2 py-1 text-muted hover:bg-line hover:text-text">✕</button>
        </div>
        {error && <div role="alert" className="px-3 py-2 text-error">{error}</div>}
        {packs === null ? (
          <div className="p-4 text-muted">Loading…</div>
        ) : packs.length === 0 ? (
          <div className="p-4 text-muted">No imported parts yet.</div>
        ) : (
          <ul className="overflow-y-auto">
            {packs.map((pack) => (
              <li key={pack.id} className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-text">{pack.name}</div>
                  <div className="text-[11px] text-muted">
                    <span>{pack.parts.length} parts</span> · {new Date(pack.importedAt * 1000).toLocaleDateString()}
                  </div>
                </div>
                <button aria-label={`Remove ${pack.name}`} onClick={() => void remove(pack)}
                  className="rounded px-3 py-1 text-error hover:bg-line">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Browser buttons and badge — failing tests**

Append to `app/src/ui/ComponentBrowser.test.tsx`, inside its `describe`:
```tsx
  it("offers import and manage buttons when handlers are given", () => {
    const onImport = vi.fn();
    const onManageImports = vi.fn();
    render(<ComponentBrowser open onClose={() => {}} onImport={onImport} onManageImports={onManageImports} />);
    fireEvent.click(screen.getByRole("button", { name: "Import parts…" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage imports" }));
    expect(onImport).toHaveBeenCalled();
    expect(onManageImports).toHaveBeenCalled();
  });

  it("badges imported parts", () => {
    const library = structuredClone(editorStore.getState().library!);
    const resistor = library.parts.find((p) => p.manifest.id === "basic.resistor")!;
    library.parts.push({ ...resistor, manifest: { ...resistor.manifest, id: "imported.x.r", name: "Imported R", tags: ["imported"] } });
    editorStore.getState().setLibrary(library);
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    expect(within(screen.getByRole("option", { name: /Imported R/ })).getByText("Imported")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import parts…" })).toBeNull();
  });
```
Run: `cd /c/multysm/app && npx vitest run src/ui/ComponentBrowser.test.tsx`
Expected: the 2 new tests FAIL.

- [ ] **Step 5: Implement browser changes**

In `ComponentBrowser.tsx`:
1. Change the signature to:
```tsx
export default function ComponentBrowser({ open, onClose, onImport, onManageImports }: {
  open: boolean; onClose(): void; onImport?(): void; onManageImports?(): void;
}) {
```
2. In the header row, after the search `<input>` and before the Close button:
```tsx
          {onImport && (
            <button onClick={() => { close(); onImport(); }} className="rounded px-2 py-1 text-muted hover:bg-line hover:text-text">
              Import parts…
            </button>
          )}
          {onManageImports && (
            <button onClick={() => { close(); onManageImports(); }} className="rounded px-2 py-1 text-muted hover:bg-line hover:text-text">
              Manage imports
            </button>
          )}
```
3. In the part list item, after the name `<span>`:
```tsx
                    {part.manifest.tags.includes("imported") && (
                      <span className="rounded border border-line px-1 text-[10px] text-accent">Imported</span>
                    )}
```
Run: `cd /c/multysm/app && npx vitest run src/ui/ComponentBrowser.test.tsx src/ui/ManageImports.test.tsx`
Expected: all pass.

- [ ] **Step 6: Wire AppShell**

In `app/src/ui/AppShell.tsx`:
```tsx
import ImportDialog from "./ImportDialog";
import ManageImports from "./ManageImports";
// state, next to browserOpen:
  const [importOpen, setImportOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const reloadLibrary = useCallback(async () => {
    if (!backend) return;
    try {
      editorStore.getState().setLibrary(await backend.loadLibrary());
    } catch (e) {
      notify(`Could not load parts: ${errorMessage(e)}`);
    }
  }, [backend, notify]);
// isBlocked in useShortcuts:
    isBlocked: () => browserOpen || importOpen || manageOpen,
// replace the ComponentBrowser element and add the dialogs:
      <ComponentBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onImport={backend ? () => setImportOpen(true) : undefined}
        onManageImports={backend ? () => setManageOpen(true) : undefined}
      />
      {backend && (
        <ImportDialog
          backend={backend}
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={(report) => {
            void reloadLibrary();
            if (report.imported.length > 0) setBrowserOpen(true);
          }}
        />
      )}
      {backend && (
        <ManageImports backend={backend} open={manageOpen} onClose={() => setManageOpen(false)} onChanged={() => void reloadLibrary()} />
      )}
```
`onImported` runs before `onClose` in the dialog, so reopening the browser happens after the import dialog closes, with the reloaded library.

- [ ] **Step 7: End-to-end test (mock backend)**

`app/e2e/import.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

type Store = { getState(): { library: unknown; tool: { kind: string; partId?: string } } };

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => {
      const store = (window as unknown as { __multysm?: Store }).__multysm;
      return !!store && store.getState().library !== null;
    }))
    .toBe(true);
});

test("imports parts from a SPICE file and places one", async ({ page }) => {
  await page.getByRole("button", { name: "Components" }).click();
  await page.getByRole("button", { name: "Import parts…" }).click();

  const dialog = page.getByRole("dialog", { name: "Import parts" });
  await expect(dialog.getByRole("row", { name: /DEMO_OPAMP/ })).toBeVisible();
  await dialog.getByLabel("Category for DEMO_OPAMP").selectOption("Analog");
  await dialog.getByRole("button", { name: "Import 2 parts" }).click();
  await expect(dialog.getByText("Imported 2 parts")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  const browser = page.getByRole("dialog", { name: "Add component" });
  await browser.getByRole("button", { name: "group Analog" }).click();
  const option = browser.getByRole("option", { name: /DEMO_OPAMP/ });
  await expect(option.getByText("Imported")).toBeVisible();
  await option.dblclick();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __multysm: Store }).__multysm.getState().tool))
    .toEqual({ kind: "place", partId: "imported.demo_parts.demo_opamp" });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Components" }).click();
  await page.getByRole("button", { name: "Manage imports" }).click();
  const manage = page.getByRole("dialog", { name: "Manage imports" });
  await manage.getByRole("button", { name: "Remove demo_parts.lib" }).click();
  await expect(manage.getByText("No imported parts yet.")).toBeVisible();
});
```

- [ ] **Step 8: Run all frontend checks**

Run: `cd /c/multysm/app && npx tsc --noEmit -p . && npx vitest run && npx playwright test`
Expected: type-check clean, all Vitest tests pass, all Playwright specs pass (including `import.spec.ts`). If `Escape` doesn't leave place mode, remove that line: the Components button still opens the browser.

- [ ] **Step 9: Run the Rust suites once more**

Run: `cd /c/multysm && cargo test --workspace`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
cd /c/multysm
git add app/src/ui/ManageImports.tsx app/src/ui/ManageImports.test.tsx app/src/ui/ComponentBrowser.tsx app/src/ui/ComponentBrowser.test.tsx app/src/ui/AppShell.tsx app/e2e/import.spec.ts
git commit -m "feat(app): import and manage parts from the component browser

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual check (desktop)

After Task 10, in `npm run tauri dev` (or the project's usual desktop run command, see `docs/desktop-checklist.md`):
1. **Import:** open Components → Import parts… → pick `crates/multysm-core/tests/fixtures/import/opamp_macro.lib` and `discretes.lib` → Import.
2. **Browser:** check that DEMO_OPAMP (Misc, or the category you chose), DEMO_SCHOTTKY, DEMO_NPN and DEMO_PMOS appear with the Imported badge.
3. **Simulate:** build the inverting amplifier from Task 6, run the operating point, and confirm the output label reads about -5 V.
4. **Remove:** Manage imports → Remove, and confirm the parts disappear and the circuit shows unknown-part errors on Run.
