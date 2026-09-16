# Component Browser and v1 Starter Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the left Parts panel and Ctrl+K palette with one "Add component" modal that browses parts by group with a symbol preview, and grow the core library from 8 to 35 simulated parts.

**Architecture:** Parts stay data-driven (JSON manifest + SVG symbol + SPICE model under `components/core`). One small format addition (`choice` params) lets switches be picked instead of typed; parts that need arithmetic or a different element letter are subcircuit instances whose `.lib` files do the math. The UI adds `SymbolPreview` and `ComponentBrowser` React components, remembers the last group/part in the zustand store, and removes `PartsPanel` and `CommandPalette`.

**Tech Stack:** Rust (multysm-core, serde, jsonschema, ngspice via FFI with XSPICE), Next.js 16 + React 19 + zustand 5 + Tailwind 4, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-component-browser-and-starter-pack-design.md`

## Global Constraints

- Theme: soft-dark tokens only (`bg #1b1d23`, `panel #22252d`, `line #2e323c`, `text #c9ced8`, `muted #8a91a0`, `accent #5fb3a8`, `selected #e0b25c`, `error #d97a7a`); use the Tailwind classes that map to them (`bg-panel`, `text-muted`, …).
- Symbols: SVG with `fill="none" stroke="currentColor" stroke-width="1.5"`, `viewBox` equal to the manifest's `width`×`height`, pins on the symbol edge. Text uses `fill="currentColor" stroke="none"`.
- Part ids follow `<group>.<name>` and match `^[a-z0-9]+(\.[a-z0-9_]+)+$`.
- The netlist builder requires the element name (after stripping a leading `X` for subcircuit parts) to start with `refPrefix`. Parts whose reference letters differ from their SPICE letter are `X{ref} …` subcircuits.
- The template engine is not changed. `{…}` in templates is always a placeholder; brace expressions live only in `.lib` files.
- Model files and `models` strings may only contain `.model`, `.subckt`, `.ends`, `.param`, `.func`, comments (`*`) and element lines (the existing SPICE content policy).
- Every model records where it came from: a `*` comment at the top of a `.lib`, or a `"* …"` entry before the `.model` string in a manifest's `models` array.
- Final library: **35 manifests** in 9 groups (Sources 7, Basic 7, Diodes 4, Transistors 3, Analog 2, TTL 4, CMOS 2, Mixed 1, Indicators 5).
- Shell: run commands in Git Bash (the Bash tool). PowerShell `>` writes UTF-16 and breaks the generated JSON fixture.
- Commit messages end with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File map

```
components/core/
  Sources/{dc_current,ac_voltage,ac_current,vcc}.json
  Basic/{inductor,potentiometer,spst,spdt,push_button}.json
  Diodes/{1n4148,1n4007,zener_5v1}.json
  Transistors/{2n2222,2n2907,2n7000}.json
  Analog/{opamp_ideal,lm741}.json
  TTL/{7404,7408,7432}.json
  CMOS/{4011,4017}.json
  Indicators/{voltmeter,ammeter,probe,logic_probe,seven_segment}.json
  symbols/{dc_current,ac_voltage,ac_current,vcc,inductor,potentiometer,spst,spdt,push_button,
           diode,zener,npn,pnp,nmos,opamp,dip16,voltmeter,ammeter,probe,logic_probe,seven_segment}.svg
  models/{switch,pot,opamp_ideal,lm741,sn7404,sn7408,sn7432,cd4011,cd4017,meters,seg7}.lib
schemas/manifest.schema.json                       (choice params)
crates/multysm-core/src/library/{manifest.rs,loader.rs,mod.rs}
crates/multysm-core/src/netlist/{mod.rs,build.rs}
crates/multysm-core/tests/{library.rs,netlist.rs,starter_pack.rs (new)}
app/src/model/{types.ts,store.ts,store.test.ts}
app/src/test/resetEditor.ts
app/src/backend/mock-library.json                  (regenerated)
app/src/ui/{PropertiesPanel.tsx,PropertiesPanel.test.tsx}
app/src/ui/{SymbolPreview.tsx,SymbolPreview.test.tsx}          (new)
app/src/ui/{ComponentBrowser.tsx,ComponentBrowser.test.tsx}    (new)
app/src/ui/{AppShell.tsx,TopBar.tsx,FocusToolbar.tsx,useShortcuts.ts,useShortcuts.test.ts}
app/src/ui/{PartsPanel.tsx,PartsPanel.test.tsx,CommandPalette.tsx,CommandPalette.test.tsx} (deleted)
app/e2e/editor.spec.ts
docs/desktop-checklist.md
```

---

### Task 1: `choice` parameters

**Files:**
- Modify: `crates/multysm-core/src/library/manifest.rs`, `crates/multysm-core/src/library/mod.rs`, `crates/multysm-core/src/library/loader.rs`, `crates/multysm-core/src/netlist/mod.rs`, `crates/multysm-core/src/netlist/build.rs`, `schemas/manifest.schema.json`, `app/src/model/types.ts`, `app/src/ui/PropertiesPanel.tsx`
- Test: `crates/multysm-core/tests/library.rs`, `crates/multysm-core/tests/netlist.rs`, `app/src/ui/PropertiesPanel.test.tsx`

**Interfaces:**
- Produces (Rust): `ParamKind::Choice`; `Param.options: Vec<ChoiceOption>`; `pub struct ChoiceOption { pub label: String, pub value: String }` re-exported from `multysm_core::library`.
- Produces (JSON/TS): param `{ "type": "choice", "options": [{ "label", "value" }] }`; `Param.type: "si" | "text" | "choice"`, `Param.options?: { label: string; value: string }[]`.

- [ ] **Step 1: Write the failing Rust library tests**

Append to `crates/multysm-core/tests/library.rs`:

```rust
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
```

- [ ] **Step 2: Write the failing Rust netlist test**

Append to `crates/multysm-core/tests/netlist.rs` (it already has `mod common;`, `CircuitBuilder`, `build_netlist`, `ErrorCode`):

```rust
#[test]
fn choice_params_render_their_value_and_reject_other_values() {
    let tmp = tempfile::tempdir().unwrap();
    let put = |rel: &str, text: &str| std::fs::write(tmp.path().join(rel), text).unwrap();
    put("g.svg", "<svg/>");
    put("s.svg", "<svg/>");
    put("ground.json", r#"{ "schema": 1, "id": "sources.ground", "name": "Ground", "category": "Sources",
      "symbol": { "width": 20, "height": 20, "svg": "g.svg", "pins": [{ "id": "1", "x": 10, "y": 0 }] },
      "spice": { "kind": "ground" } }"#);
    put("switch.json", r#"{ "schema": 1, "id": "basic.switch", "name": "Switch", "category": "Basic",
      "symbol": { "width": 60, "height": 20, "svg": "s.svg",
                  "pins": [{ "id": "1", "x": 0, "y": 10 }, { "id": "2", "x": 60, "y": 10 }] },
      "params": [{ "key": "closed", "label": "State", "default": "1e12", "type": "choice",
                   "options": [{ "label": "Open", "value": "1e12" }, { "label": "Closed", "value": "1m" }] }],
      "spice": { "kind": "analog", "refPrefix": "R", "template": "{ref} {pin.1} {pin.2} {closed}" } }"#);
    let lib = multysm_core::library::load_library(&[tmp.path().to_path_buf()]);
    assert!(lib.issues.is_empty(), "{:?}", lib.issues);

    for (value, accepted) in [("1m", true), ("5", false)] {
        let mut b = CircuitBuilder::new(&lib, Analysis::Op);
        let gnd = b.add("sources.ground", "GND1", &[]);
        let s1 = b.add("basic.switch", "R1", &[("closed", value)]);
        b.connect((&s1, "1"), (&gnd, "1"));
        b.connect((&s1, "2"), (&gnd, "1"));
        match build_netlist(&b.build(), &lib) {
            Ok(netlist) => {
                assert!(accepted, "value {value} should be rejected");
                assert!(netlist.text.contains("R1 0 0 1m"), "{}", netlist.text);
            }
            Err(errors) => {
                assert!(!accepted, "value {value} should render: {errors:?}");
                assert!(errors.iter().any(|e| e.code == ErrorCode::InvalidParam
                    && e.message.contains("'5' is not one of the options")), "{errors:?}");
            }
        }
    }
}
```

- [ ] **Step 3: Run the Rust tests to verify they fail**

Run: `cargo test -p multysm-core --test library --test netlist`
Expected: compile error — `ParamKind::Choice` and `options` do not exist.

- [ ] **Step 4: Implement the manifest types**

In `crates/multysm-core/src/library/manifest.rs`, replace `Param` and `ParamKind` with:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Param {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub unit: String,
    pub default: String,
    #[serde(rename = "type")]
    pub kind: ParamKind,
    /// Allowed values for `choice` params; empty for other kinds.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<ChoiceOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChoiceOption {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParamKind {
    Si,
    Text,
    Choice,
}
```

In `crates/multysm-core/src/library/mod.rs`, add `ChoiceOption` to the `pub use manifest::{…}` list.

- [ ] **Step 5: Update the JSON schema**

In `schemas/manifest.schema.json`, replace the `params.items` object with:

```json
      "items": {
        "type": "object",
        "required": ["key", "label", "default", "type"],
        "additionalProperties": false,
        "properties": {
          "key": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$", "not": { "const": "ref" } },
          "label": { "type": "string" },
          "unit": { "type": "string" },
          "default": { "type": "string" },
          "type": { "enum": ["si", "text", "choice"] },
          "options": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["label", "value"],
              "additionalProperties": false,
              "properties": { "label": { "type": "string" }, "value": { "type": "string" } }
            }
          }
        },
        "if": { "properties": { "type": { "const": "choice" } } },
        "then": { "required": ["options"] }
      }
```

- [ ] **Step 6: Validate choices in the loader**

In `crates/multysm-core/src/netlist/mod.rs`, change `mod validate;` to `pub(crate) mod validate;`.

In `crates/multysm-core/src/library/loader.rs`, add imports:

```rust
use super::manifest::ParamKind;
use crate::netlist::validate::is_valid_text_param;
```

and in `load_part`, directly after `let mut problems = Vec::new();` insert:

```rust
    for param in &manifest.params {
        if param.kind != ParamKind::Choice {
            continue;
        }
        for option in &param.options {
            let value = &option.value;
            if value.is_empty() || value.chars().any(char::is_whitespace) || !is_valid_text_param(value) {
                problems.push(format!("param '{}' option value '{value}' is not allowed", param.key));
            }
        }
        if !param.options.iter().any(|o| o.value == param.default) {
            problems.push(format!(
                "param '{}' default '{}' is not one of its options",
                param.key, param.default
            ));
        }
    }
```

Note: `unsafe_choice_value_becomes_an_issue` uses the same unsafe string as the default, so the first issue is the option-value message.

- [ ] **Step 7: Accept only listed choices in the netlist**

In `crates/multysm-core/src/netlist/build.rs`, add two arms to the `match param.kind` (before `ParamKind::Si`):

```rust
                ParamKind::Choice if param.options.iter().any(|o| &o.value == raw) => raw.clone(),
                ParamKind::Choice => {
                    errors.push(NetlistError::new(
                        ErrorCode::InvalidParam,
                        format!("{}: {} '{}' is not one of the options", inst.reference, param.label, raw),
                        Some(inst.uid.as_str()),
                    ));
                    continue;
                }
```

- [ ] **Step 8: Run the Rust tests to verify they pass**

Run: `cargo test --workspace`
Expected: all pass, including the 6 new tests.

- [ ] **Step 9: Write the failing frontend test**

In `app/src/ui/PropertiesPanel.test.tsx`, add imports `import { testLibrary } from "@/test/resetEditor";` and `import type { PartDef } from "@/model/types";`, then add inside `describe("PropertiesPanel", …)`:

```tsx
  it("edits a choice param with a select", () => {
    const testSwitch: PartDef = {
      svg: "<svg/>",
      refPrefix: "S",
      manifest: {
        schema: 1, id: "basic.test_switch", name: "Test Switch", category: "Basic", tags: [],
        symbol: { width: 60, height: 20, svg: "s.svg", pins: [{ id: "1", x: 0, y: 10 }, { id: "2", x: 60, y: 10 }] },
        params: [{
          key: "closed", label: "State", default: "0", type: "choice",
          options: [{ label: "Open", value: "0" }, { label: "Closed", value: "1" }],
        }],
        spice: { kind: "analog", refPrefix: "S", template: "X{ref} {pin.1} {pin.2} SW_SPST PARAMS: S={closed}" },
      },
    };
    resetEditor({ ...testLibrary, parts: [...testLibrary.parts, testSwitch] });
    const id = state().placePart("basic.test_switch", [100, 100])!;
    render(<PropertiesPanel />);
    const select = screen.getByLabelText("State") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("0");
    expect(screen.getByRole("option", { name: "Closed" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "1" } });
    expect(state().project.components.find((c) => c.uid === id)!.params.closed).toBe("1");
  });
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npm --prefix app test -- PropertiesPanel`
Expected: FAIL — the "State" field is an `INPUT`, not a `SELECT`.

- [ ] **Step 11: Implement the TS types and the select**

In `app/src/model/types.ts`, replace `Param` with:

```ts
export interface ChoiceOption {
  label: string;
  value: string;
}

export interface Param {
  key: string;
  label: string;
  unit?: string;
  default: string;
  type: "si" | "text" | "choice";
  /** Present for `choice` params. */
  options?: ChoiceOption[];
}
```

In `app/src/ui/PropertiesPanel.tsx`, add this component below `Field`:

```tsx
function ChoiceField(props: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  const id = `field-${props.label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="border-b border-line py-2">
      <label htmlFor={id} className="mb-1 block text-muted">{props.label}</label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded border border-line bg-bg px-2 py-1 text-text focus:border-accent focus:outline-none"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
```

and replace the `part.manifest.params.map(...)` block with:

```tsx
      {part.manifest.params.map((param) =>
        param.type === "choice" ? (
          <ChoiceField
            key={param.key}
            label={param.label}
            value={component.params[param.key] ?? param.default}
            options={param.options ?? []}
            onChange={(v) => setParam(component.uid, param.key, v)}
          />
        ) : (
          <Field
            key={param.key}
            label={param.label}
            unit={param.unit}
            initial={component.params[param.key] ?? param.default}
            validate={(v) => {
              if (param.type === "text") return null;
              const parsed = parseSi(v);
              return parsed.ok ? null : parsed.error;
            }}
            onCommit={(v) => setParam(component.uid, param.key, v)}
          />
        ),
      )}
```

- [ ] **Step 12: Run the frontend tests to verify they pass**

Run: `npm --prefix app test`
Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add schemas/manifest.schema.json crates/multysm-core app/src/model/types.ts app/src/ui/PropertiesPanel.tsx app/src/ui/PropertiesPanel.test.tsx
git commit -m "feat(core): choice parameters for picked values like switch state"
```

---

### Task 2: Sources and Basic parts

**Files:**
- Create: `components/core/Sources/{dc_current,ac_voltage,ac_current,vcc}.json`, `components/core/Basic/{inductor,potentiometer,spst,spdt,push_button}.json`, `components/core/symbols/{dc_current,ac_voltage,ac_current,vcc,inductor,potentiometer,spst,spdt,push_button}.svg`, `components/core/models/{switch,pot}.lib`
- Test: `crates/multysm-core/tests/starter_pack.rs` (new)

**Interfaces:**
- Consumes: `choice` params (Task 1); test helpers `common::{core_library, engine_config, CircuitBuilder}`; `multysm_core::simulate(&Project, &Library, &EngineConfig) -> Result<(Netlist, SimResult), SimulateError>`; `SimResult::{last, real, sample_at}`.
- Produces: part ids `sources.dc_current` (pins p,n; param `current`), `sources.ac_voltage` (p,n; `amplitude`,`frequency`,`offset`), `sources.ac_current` (same), `sources.vcc` (pin 1; `voltage`), `basic.inductor` (1,2; `inductance`), `basic.potentiometer` (1,w,2; `resistance`,`position`), `basic.spst` (1,2; `closed` 0/1), `basic.spdt` (c,a,b; `pos` 0=A/1=B), `basic.push_button` (1,2; `pressed` 0/1). Test helpers in `starter_pack.rs`: `net`, `run`, `peak`.

- [ ] **Step 1: Write the failing tests**

Create `crates/multysm-core/tests/starter_pack.rs`:

```rust
//! Simulation checks for the v1 starter pack parts (spec §5).

mod common;

use common::{core_library, engine_config, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::engine::SimResult;
use multysm_core::library::Library;
use multysm_core::netlist::Netlist;
use multysm_core::simulate;

fn net(netlist: &Netlist, uid: &str, pin: &str) -> String {
    netlist.nets.pin_net[&(uid.to_string(), pin.to_string())].clone()
}

fn run(lib: &Library, b: CircuitBuilder<'_>) -> (Netlist, SimResult) {
    simulate(&b.build(), lib, &engine_config()).unwrap_or_else(|e| panic!("simulation failed: {e:?}"))
}

fn peak(result: &SimResult, name: &str) -> f64 {
    result.real(name).unwrap().iter().fold(0.0, |m: f64, v| m.max(v.abs()))
}

fn tran(stop: &str, step: &str) -> Analysis {
    Analysis::Tran { stop: stop.into(), step: step.into() }
}

// ---- Sources ----

#[test]
fn dc_current_source_into_1k_gives_1v() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let i1 = b.add("sources.dc_current", "I1", &[("current", "1m")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&i1, "n"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&i1, "p"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &r1, "1")).unwrap();
    assert!((v - 1.0).abs() < 0.01, "V(R1) = {v}");
}

#[test]
fn ac_voltage_source_peak_equals_amplitude() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, tran("2m", "5u"));
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.ac_voltage", "V1", &[("amplitude", "2"), ("frequency", "1k")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let p = peak(&result, &net(&netlist, &r1, "1"));
    assert!((p - 2.0).abs() < 0.06, "peak {p}");
}

#[test]
fn ac_current_source_peak_into_1k() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, tran("2m", "5u"));
    let gnd = b.add("sources.ground", "GND1", &[]);
    let i1 = b.add("sources.ac_current", "I1", &[("amplitude", "1m"), ("frequency", "1k")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&i1, "n"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&i1, "p"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let p = peak(&result, &net(&netlist, &r1, "1"));
    assert!((p - 1.0).abs() < 0.03, "peak {p}");
}

#[test]
fn vcc_rail_holds_its_voltage() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.vcc", "V1", &[]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&vcc, "1"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &r1, "1")).unwrap();
    assert!((v - 5.0).abs() < 1e-3, "VCC = {v}");
}

// ---- Basic ----

#[test]
fn inductor_is_a_short_at_dc() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "1")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let l1 = b.add("basic.inductor", "L1", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&l1, "1"));
    b.connect((&l1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &l1, "1")).unwrap();
    assert!(v.abs() < 1e-3, "V(L1) = {v}");
}

/// 5 V -> switch -> 1k -> ground; returns the voltage on the 1k.
fn two_pin_switch_output(part: &str, key: &str, value: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let s1 = b.add(part, "S1", &[(key, value)]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&v1, "p"), (&s1, "1"));
    b.connect((&s1, "2"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &r1, "1")).unwrap()
}

#[test]
fn spst_switch_open_and_closed() {
    let closed = two_pin_switch_output("basic.spst", "closed", "1");
    let open = two_pin_switch_output("basic.spst", "closed", "0");
    assert!(closed > 4.99, "closed: {closed}");
    assert!(open < 1e-3, "open: {open}");
}

#[test]
fn push_button_released_and_pressed() {
    let pressed = two_pin_switch_output("basic.push_button", "pressed", "1");
    let released = two_pin_switch_output("basic.push_button", "pressed", "0");
    assert!(pressed > 4.99, "pressed: {pressed}");
    assert!(released < 1e-3, "released: {released}");
}

#[test]
fn spdt_switch_routes_common_to_a_or_b() {
    let lib = core_library();
    for (pos, a_high) in [("0", true), ("1", false)] {
        let mut b = CircuitBuilder::new(&lib, Analysis::Op);
        let gnd = b.add("sources.ground", "GND1", &[]);
        let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
        let s1 = b.add("basic.spdt", "S1", &[("pos", pos)]);
        let ra = b.add("basic.resistor", "RA", &[("resistance", "1k")]);
        let rb = b.add("basic.resistor", "RB", &[("resistance", "1k")]);
        b.connect((&v1, "p"), (&s1, "c"));
        b.connect((&s1, "a"), (&ra, "1"));
        b.connect((&s1, "b"), (&rb, "1"));
        b.connect((&ra, "2"), (&gnd, "1"));
        b.connect((&rb, "2"), (&gnd, "1"));
        b.connect((&v1, "n"), (&gnd, "1"));
        let (netlist, result) = run(&lib, b);
        let va = result.last(&net(&netlist, &ra, "1")).unwrap();
        let vb = result.last(&net(&netlist, &rb, "1")).unwrap();
        let (on, off) = if a_high { (va, vb) } else { (vb, va) };
        assert!(on > 4.99 && off < 1e-3, "pos {pos}: A={va} B={vb}");
    }
}

#[test]
fn potentiometer_divides_by_position() {
    let lib = core_library();
    for (position, expected) in [("0.5", 5.0), ("0.25", 7.5)] {
        let mut b = CircuitBuilder::new(&lib, Analysis::Op);
        let gnd = b.add("sources.ground", "GND1", &[]);
        let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "10")]);
        let rv = b.add("basic.potentiometer", "RV1", &[("resistance", "10k"), ("position", position)]);
        let load = b.add("basic.resistor", "RL", &[("resistance", "1e9")]);
        b.connect((&v1, "p"), (&rv, "1"));
        b.connect((&rv, "2"), (&gnd, "1"));
        b.connect((&rv, "w"), (&load, "1"));
        b.connect((&load, "2"), (&gnd, "1"));
        b.connect((&v1, "n"), (&gnd, "1"));
        let (netlist, result) = run(&lib, b);
        let v = result.last(&net(&netlist, &rv, "w")).unwrap();
        assert!((v - expected).abs() / expected < 0.01, "position {position}: {v}");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p multysm-core --test starter_pack`
Expected: FAIL with `unknown part sources.dc_current` (and similar) from `CircuitBuilder::add`.

- [ ] **Step 3: Add the source parts**

`components/core/Sources/dc_current.json`:
```json
{
  "schema": 1, "id": "sources.dc_current", "name": "DC Current Source", "category": "Sources",
  "tags": ["current", "constant", "I"],
  "symbol": { "width": 40, "height": 60, "svg": "../symbols/dc_current.svg",
              "pins": [{ "id": "p", "name": "+", "x": 20, "y": 0 },
                       { "id": "n", "name": "-", "x": 20, "y": 60 }] },
  "params": [{ "key": "current", "label": "Current", "unit": "A", "default": "1m", "type": "si" }],
  "spice": { "kind": "analog", "refPrefix": "I", "template": "{ref} {pin.p} {pin.n} DC {current}" }
}
```

`components/core/Sources/ac_voltage.json`:
```json
{
  "schema": 1, "id": "sources.ac_voltage", "name": "AC Voltage Source", "category": "Sources",
  "tags": ["sine", "signal", "V"],
  "symbol": { "width": 40, "height": 60, "svg": "../symbols/ac_voltage.svg",
              "pins": [{ "id": "p", "name": "+", "x": 20, "y": 0 },
                       { "id": "n", "name": "-", "x": 20, "y": 60 }] },
  "params": [
    { "key": "amplitude", "label": "Amplitude", "unit": "V", "default": "1", "type": "si" },
    { "key": "frequency", "label": "Frequency", "unit": "Hz", "default": "1k", "type": "si" },
    { "key": "offset", "label": "Offset", "unit": "V", "default": "0", "type": "si" }
  ],
  "spice": { "kind": "analog", "refPrefix": "V",
             "template": "{ref} {pin.p} {pin.n} SIN({offset} {amplitude} {frequency}) AC {amplitude}" }
}
```

`components/core/Sources/ac_current.json`:
```json
{
  "schema": 1, "id": "sources.ac_current", "name": "AC Current Source", "category": "Sources",
  "tags": ["sine", "signal", "I"],
  "symbol": { "width": 40, "height": 60, "svg": "../symbols/ac_current.svg",
              "pins": [{ "id": "p", "name": "+", "x": 20, "y": 0 },
                       { "id": "n", "name": "-", "x": 20, "y": 60 }] },
  "params": [
    { "key": "amplitude", "label": "Amplitude", "unit": "A", "default": "1m", "type": "si" },
    { "key": "frequency", "label": "Frequency", "unit": "Hz", "default": "1k", "type": "si" },
    { "key": "offset", "label": "Offset", "unit": "A", "default": "0", "type": "si" }
  ],
  "spice": { "kind": "analog", "refPrefix": "I",
             "template": "{ref} {pin.p} {pin.n} SIN({offset} {amplitude} {frequency}) AC {amplitude}" }
}
```

`components/core/Sources/vcc.json`:
```json
{
  "schema": 1, "id": "sources.vcc", "name": "VCC Rail", "category": "Sources",
  "tags": ["supply", "rail", "power", "5V"],
  "symbol": { "width": 40, "height": 30, "svg": "../symbols/vcc.svg",
              "pins": [{ "id": "1", "name": "VCC", "x": 20, "y": 30 }] },
  "params": [{ "key": "voltage", "label": "Voltage", "unit": "V", "default": "5", "type": "si" }],
  "spice": { "kind": "analog", "refPrefix": "V", "template": "{ref} {pin.1} 0 DC {voltage}" }
}
```

Symbols (one file each, exact content):

`components/core/symbols/dc_current.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="20" cy="30" r="10"/><path d="M20 0v20M20 40v20M20 24v12M16 32l4 4 4-4"/></svg>
```
`components/core/symbols/ac_voltage.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="20" cy="30" r="10"/><path d="M20 0v20M20 40v20M13 30c2-6 5-6 7 0s5 6 7 0"/></svg>
```
`components/core/symbols/ac_current.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="20" cy="30" r="10"/><path d="M20 0v20M20 40v20M14 26c2-4 4-4 6 0s4 4 6 0M20 30v7M18 35l2 2 2-2"/></svg>
```
`components/core/symbols/vcc.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 30V12M8 12h24"/><text x="20" y="8" font-size="8" text-anchor="middle" fill="currentColor" stroke="none">VCC</text></svg>
```

- [ ] **Step 4: Add the basic parts and their models**

`components/core/models/switch.lib`:
```spice
* Ideal switches - multysm core pack (not vendor models).
* S is the state from the part's choice param: 0 or 1.
.subckt SW_SPST a b params: S=0
R1 a b {ternary_fcn(S > 0.5, 1e-3, 1e12)}
.ends SW_SPST
.subckt SW_SPDT c a b params: S=0
R1 c a {ternary_fcn(S > 0.5, 1e12, 1e-3)}
R2 c b {ternary_fcn(S > 0.5, 1e-3, 1e12)}
.ends SW_SPDT
```

`components/core/models/pot.lib`:
```spice
* Potentiometer - multysm core pack (not a vendor model).
* R is the total resistance; P is the wiper position from pin 1 (0..1).
.subckt POT a w b params: R=10000 P=0.5
R1 a w {max(R*min(max(P, 0), 1), 1e-3)}
R2 w b {max(R*(1 - min(max(P, 0), 1)), 1e-3)}
.ends POT
```

If ngspice reports an unknown function for `ternary_fcn` in Step 6, replace each `ternary_fcn(x, y, z)` with `(x ? y : z)`; both forms are ngspice numparam syntax.

`components/core/Basic/inductor.json`:
```json
{
  "schema": 1, "id": "basic.inductor", "name": "Inductor", "category": "Basic",
  "tags": ["passive", "coil", "L"],
  "symbol": { "width": 60, "height": 20, "svg": "../symbols/inductor.svg",
              "pins": [{ "id": "1", "x": 0, "y": 10 }, { "id": "2", "x": 60, "y": 10 }] },
  "params": [{ "key": "inductance", "label": "Inductance", "unit": "H", "default": "1m", "type": "si" }],
  "spice": { "kind": "analog", "refPrefix": "L", "template": "{ref} {pin.1} {pin.2} {inductance}" }
}
```

`components/core/Basic/potentiometer.json`:
```json
{
  "schema": 1, "id": "basic.potentiometer", "name": "Potentiometer", "category": "Basic",
  "tags": ["variable", "trimmer", "RV"],
  "symbol": { "width": 60, "height": 30, "svg": "../symbols/potentiometer.svg",
              "pins": [{ "id": "1", "x": 0, "y": 10 },
                       { "id": "w", "name": "wiper", "x": 30, "y": 30 },
                       { "id": "2", "x": 60, "y": 10 }] },
  "params": [
    { "key": "resistance", "label": "Resistance", "unit": "Ω", "default": "10k", "type": "si" },
    { "key": "position", "label": "Wiper position (0-1)", "default": "0.5", "type": "si" }
  ],
  "spice": { "kind": "analog", "refPrefix": "RV", "subckt": "../models/pot.lib",
             "template": "X{ref} {pin.1} {pin.w} {pin.2} POT PARAMS: R={resistance} P={position}" }
}
```

`components/core/Basic/spst.json`:
```json
{
  "schema": 1, "id": "basic.spst", "name": "SPST Switch", "category": "Basic",
  "tags": ["toggle", "switch"],
  "symbol": { "width": 60, "height": 20, "svg": "../symbols/spst.svg",
              "pins": [{ "id": "1", "x": 0, "y": 10 }, { "id": "2", "x": 60, "y": 10 }] },
  "params": [{ "key": "closed", "label": "State", "default": "0", "type": "choice",
               "options": [{ "label": "Open", "value": "0" }, { "label": "Closed", "value": "1" }] }],
  "spice": { "kind": "analog", "refPrefix": "S", "subckt": "../models/switch.lib",
             "template": "X{ref} {pin.1} {pin.2} SW_SPST PARAMS: S={closed}" }
}
```

`components/core/Basic/spdt.json`:
```json
{
  "schema": 1, "id": "basic.spdt", "name": "SPDT Switch", "category": "Basic",
  "tags": ["toggle", "changeover", "switch"],
  "symbol": { "width": 60, "height": 40, "svg": "../symbols/spdt.svg",
              "pins": [{ "id": "c", "name": "common", "x": 0, "y": 20 },
                       { "id": "a", "name": "A", "x": 60, "y": 10 },
                       { "id": "b", "name": "B", "x": 60, "y": 30 }] },
  "params": [{ "key": "pos", "label": "Position", "default": "0", "type": "choice",
               "options": [{ "label": "A", "value": "0" }, { "label": "B", "value": "1" }] }],
  "spice": { "kind": "analog", "refPrefix": "S", "subckt": "../models/switch.lib",
             "template": "X{ref} {pin.c} {pin.a} {pin.b} SW_SPDT PARAMS: S={pos}" }
}
```

`components/core/Basic/push_button.json`:
```json
{
  "schema": 1, "id": "basic.push_button", "name": "Push Button", "category": "Basic",
  "tags": ["momentary", "button", "switch"],
  "symbol": { "width": 60, "height": 30, "svg": "../symbols/push_button.svg",
              "pins": [{ "id": "1", "x": 0, "y": 20 }, { "id": "2", "x": 60, "y": 20 }] },
  "params": [{ "key": "pressed", "label": "State", "default": "0", "type": "choice",
               "options": [{ "label": "Released", "value": "0" }, { "label": "Pressed", "value": "1" }] }],
  "spice": { "kind": "analog", "refPrefix": "S", "subckt": "../models/switch.lib",
             "template": "X{ref} {pin.1} {pin.2} SW_SPST PARAMS: S={pressed}" }
}
```

Symbols:

`components/core/symbols/inductor.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h10a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0h10"/></svg>
```
`components/core/symbols/potentiometer.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h10l4-7 8 14 8-14 8 14 8-14 4 7h10M30 30V16M26 20l4-4 4 4"/></svg>
```
`components/core/symbols/spst.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h17M43 10h17M21 9l19-8"/><circle cx="19" cy="10" r="2"/><circle cx="41" cy="10" r="2"/></svg>
```
`components/core/symbols/spdt.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 20h17M43 10h17M43 30h17M21 19l19-8"/><circle cx="19" cy="20" r="2"/><circle cx="41" cy="10" r="2"/><circle cx="41" cy="30" r="2"/></svg>
```
`components/core/symbols/push_button.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 20h17M43 20h17M16 12h28M30 12V3M24 3h12"/><circle cx="19" cy="20" r="2"/><circle cx="41" cy="20" r="2"/></svg>
```

- [ ] **Step 5: Run the library tests**

Run: `cargo test -p multysm-core --test library`
Expected: PASS (`core_library_loads_cleanly` still finds zero issues).

- [ ] **Step 6: Run the starter pack tests to verify they pass**

Run: `cargo test -p multysm-core --test starter_pack`
Expected: 9 passed. A failure is a model or manifest bug: print `netlist.text` in the failing test to inspect it, fix the part, don't loosen the assertion.

- [ ] **Step 7: Commit**

```bash
git add components/core crates/multysm-core/tests/starter_pack.rs
git commit -m "feat(parts): current, AC and VCC sources, inductor, potentiometer, switches and push button"
```

---

### Task 3: Diodes and Transistors

**Files:**
- Create: `components/core/Diodes/{1n4148,1n4007,zener_5v1}.json`, `components/core/Transistors/{2n2222,2n2907,2n7000}.json`, `components/core/symbols/{diode,zener,npn,pnp,nmos}.svg`
- Test: `crates/multysm-core/tests/starter_pack.rs`

**Interfaces:**
- Consumes: `starter_pack.rs` helpers `net`, `run` (Task 2); `sources.dc_current` (Task 2).
- Produces: `diodes.1n4148`, `diodes.1n4007`, `diodes.zener_5v1` (pins A, K); `transistors.2n2222`, `transistors.2n2907` (pins C, B, E); `transistors.2n7000` (pins D, G, S).

- [ ] **Step 1: Write the failing tests**

Append to `crates/multysm-core/tests/starter_pack.rs`:

```rust
// ---- Diodes ----

/// Pushes `current` through the diode from anode to cathode (or cathode to
/// anode when `reverse`) and returns the voltage across it.
fn diode_voltage(part: &str, current: &str, reverse: bool) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let i1 = b.add("sources.dc_current", "I1", &[("current", current)]);
    let d1 = b.add(part, "D1", &[]);
    let (top, bottom) = if reverse { ("K", "A") } else { ("A", "K") };
    b.connect((&i1, "n"), (&d1, top));
    b.connect((&d1, bottom), (&gnd, "1"));
    b.connect((&i1, "p"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &d1, top)).unwrap()
}

#[test]
fn diode_forward_drops_are_realistic() {
    let v4148 = diode_voltage("diodes.1n4148", "1m", false);
    assert!((0.55..0.75).contains(&v4148), "1N4148 at 1 mA: {v4148}");
    let v4007 = diode_voltage("diodes.1n4007", "10m", false);
    assert!((0.55..0.85).contains(&v4007), "1N4007 at 10 mA: {v4007}");
}

#[test]
fn zener_holds_its_breakdown_voltage() {
    let v = diode_voltage("diodes.zener_5v1", "5m", true);
    assert!((4.9..5.3).contains(&v), "zener at 5 mA reverse: {v}");
}

// ---- Transistors ----

/// Switch stage: 5 V -> 1k -> the "high side" pin; the control pin is driven
/// (through 1k for BJTs, directly for the MOSFET) from `drive` volts; the
/// "low side" pin goes to ground (NPN, NMOS) or 5 V (PNP). Returns V at the
/// load-side pin.
fn npn_collector(drive: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let vb = b.add("sources.dc_voltage", "VB", &[("voltage", drive)]);
    let rc = b.add("basic.resistor", "RC", &[("resistance", "1k")]);
    let rb = b.add("basic.resistor", "RB", &[("resistance", "1k")]);
    let q1 = b.add("transistors.2n2222", "Q1", &[]);
    b.connect((&vcc, "p"), (&rc, "1"));
    b.connect((&rc, "2"), (&q1, "C"));
    b.connect((&q1, "E"), (&gnd, "1"));
    b.connect((&vb, "p"), (&rb, "1"));
    b.connect((&rb, "2"), (&q1, "B"));
    b.connect((&vb, "n"), (&gnd, "1"));
    b.connect((&vcc, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &q1, "C")).unwrap()
}

fn pnp_collector(drive: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let vb = b.add("sources.dc_voltage", "VB", &[("voltage", drive)]);
    let rc = b.add("basic.resistor", "RC", &[("resistance", "1k")]);
    let rb = b.add("basic.resistor", "RB", &[("resistance", "1k")]);
    let q1 = b.add("transistors.2n2907", "Q1", &[]);
    b.connect((&vcc, "p"), (&q1, "E"));
    b.connect((&q1, "C"), (&rc, "1"));
    b.connect((&rc, "2"), (&gnd, "1"));
    b.connect((&vb, "p"), (&rb, "1"));
    b.connect((&rb, "2"), (&q1, "B"));
    b.connect((&vb, "n"), (&gnd, "1"));
    b.connect((&vcc, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &q1, "C")).unwrap()
}

fn nmos_drain(gate: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vdd = b.add("sources.dc_voltage", "VDD", &[("voltage", "5")]);
    let vg = b.add("sources.dc_voltage", "VG", &[("voltage", gate)]);
    let rd = b.add("basic.resistor", "RD", &[("resistance", "1k")]);
    let m1 = b.add("transistors.2n7000", "M1", &[]);
    b.connect((&vdd, "p"), (&rd, "1"));
    b.connect((&rd, "2"), (&m1, "D"));
    b.connect((&m1, "S"), (&gnd, "1"));
    b.connect((&vg, "p"), (&m1, "G"));
    b.connect((&vg, "n"), (&gnd, "1"));
    b.connect((&vdd, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &m1, "D")).unwrap()
}

#[test]
fn npn_switches_on_and_off() {
    let on = npn_collector("5");
    let off = npn_collector("0");
    assert!(on < 0.3, "2N2222 on: Vce = {on}");
    assert!(off > 4.9, "2N2222 off: Vce = {off}");
}

#[test]
fn pnp_switches_on_and_off() {
    let on = pnp_collector("0");
    let off = pnp_collector("5");
    assert!(on > 4.7, "2N2907 on: Vc = {on}");
    assert!(off < 0.1, "2N2907 off: Vc = {off}");
}

#[test]
fn nmos_switches_on_and_off() {
    let on = nmos_drain("5");
    let off = nmos_drain("0");
    assert!(on < 0.3, "2N7000 on: Vds = {on}");
    assert!(off > 4.9, "2N7000 off: Vds = {off}");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p multysm-core --test starter_pack`
Expected: the 5 new tests FAIL with `unknown part diodes.1n4148` (etc.); the Task 2 tests still pass.

- [ ] **Step 3: Add the diodes**

`components/core/Diodes/1n4148.json`:
```json
{
  "schema": 1, "id": "diodes.1n4148", "name": "1N4148 Switching Diode", "category": "Diodes",
  "tags": ["signal", "fast", "D"],
  "symbol": { "width": 40, "height": 20, "svg": "../symbols/diode.svg",
              "pins": [{ "id": "A", "name": "Anode", "x": 0, "y": 10 },
                       { "id": "K", "name": "Cathode", "x": 40, "y": 10 }] },
  "spice": { "kind": "analog", "refPrefix": "D", "template": "{ref} {pin.A} {pin.K} D1N4148",
             "models": ["* 1N4148: manufacturer SPICE parameters as published in common SPICE model collections",
                        ".model D1N4148 D(IS=4.352n N=1.906 RS=0.6458 BV=110 IBV=0.0001 CJO=7.048p VJ=0.869 M=0.03 FC=0.5 TT=3.48n)"] }
}
```

`components/core/Diodes/1n4007.json`:
```json
{
  "schema": 1, "id": "diodes.1n4007", "name": "1N4007 Rectifier Diode", "category": "Diodes",
  "tags": ["rectifier", "power", "D"],
  "symbol": { "width": 40, "height": 20, "svg": "../symbols/diode.svg",
              "pins": [{ "id": "A", "name": "Anode", "x": 0, "y": 10 },
                       { "id": "K", "name": "Cathode", "x": 40, "y": 10 }] },
  "spice": { "kind": "analog", "refPrefix": "D", "template": "{ref} {pin.A} {pin.K} D1N4007",
             "models": ["* 1N4007: manufacturer SPICE parameters as published in common SPICE model collections",
                        ".model D1N4007 D(IS=7.02767n RS=0.0341512 N=1.80803 EG=1.05743 XTI=5 BV=1000 IBV=5e-08 CJO=1e-11 VJ=0.7 M=0.5 FC=0.5 TT=1e-07)"] }
}
```

`components/core/Diodes/zener_5v1.json`:
```json
{
  "schema": 1, "id": "diodes.zener_5v1", "name": "Zener Diode 5.1 V (1N4733A)", "category": "Diodes",
  "tags": ["zener", "regulator", "reference", "D"],
  "symbol": { "width": 40, "height": 20, "svg": "../symbols/zener.svg",
              "pins": [{ "id": "A", "name": "Anode", "x": 0, "y": 10 },
                       { "id": "K", "name": "Cathode", "x": 40, "y": 10 }] },
  "spice": { "kind": "analog", "refPrefix": "D", "template": "{ref} {pin.A} {pin.K} D1N4733A",
             "models": ["* 1N4733A: parameters fitted by multysm to the datasheet (5.1 V at 49 mA); not a vendor model",
                        ".model D1N4733A D(IS=1e-11 N=1.1 RS=1 BV=5.1 IBV=49m CJO=180p VJ=0.75 M=0.33 TT=50n)"] }
}
```

`components/core/symbols/diode.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h13M27 10h13M13 2v16l14-8zM27 2v16"/></svg>
```
`components/core/symbols/zener.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h13M27 10h13M13 2v16l14-8zM23 0l4 2v16l4 2"/></svg>
```

- [ ] **Step 4: Add the transistors**

`components/core/Transistors/2n2222.json`:
```json
{
  "schema": 1, "id": "transistors.2n2222", "name": "NPN Transistor 2N2222", "category": "Transistors",
  "tags": ["bjt", "npn", "Q"],
  "symbol": { "width": 40, "height": 40, "svg": "../symbols/npn.svg",
              "pins": [{ "id": "C", "name": "C", "x": 30, "y": 0 },
                       { "id": "B", "name": "B", "x": 0, "y": 20 },
                       { "id": "E", "name": "E", "x": 30, "y": 40 }] },
  "spice": { "kind": "analog", "refPrefix": "Q", "template": "{ref} {pin.C} {pin.B} {pin.E} Q2N2222",
             "models": ["* 2N2222: manufacturer SPICE parameters as published in common SPICE model collections",
                        ".model Q2N2222 NPN(IS=14.34f XTI=3 EG=1.11 VAF=74.03 BF=255.9 NE=1.307 ISE=14.34f IKF=0.2847 XTB=1.5 BR=6.092 NC=2 ISC=0 IKR=0 RC=1 CJC=7.306p MJC=0.3416 VJC=0.75 FC=0.5 CJE=22.01p MJE=0.377 VJE=0.75 TR=46.91n TF=411.1p ITF=0.6 VTF=1.7 XTF=3 RB=10)"] }
}
```

`components/core/Transistors/2n2907.json`:
```json
{
  "schema": 1, "id": "transistors.2n2907", "name": "PNP Transistor 2N2907", "category": "Transistors",
  "tags": ["bjt", "pnp", "Q"],
  "symbol": { "width": 40, "height": 40, "svg": "../symbols/pnp.svg",
              "pins": [{ "id": "C", "name": "C", "x": 30, "y": 0 },
                       { "id": "B", "name": "B", "x": 0, "y": 20 },
                       { "id": "E", "name": "E", "x": 30, "y": 40 }] },
  "spice": { "kind": "analog", "refPrefix": "Q", "template": "{ref} {pin.C} {pin.B} {pin.E} Q2N2907",
             "models": ["* 2N2907: manufacturer SPICE parameters as published in common SPICE model collections",
                        ".model Q2N2907 PNP(IS=650.6E-18 XTI=3 EG=1.11 VAF=115.7 BF=231.7 NE=1.829 ISE=54.81f IKF=1.079 XTB=1.5 BR=3.563 NC=2 ISC=0 IKR=0 RC=0.715 CJC=14.76p MJC=0.5383 VJC=0.75 FC=0.5 CJE=19.82p MJE=0.3357 VJE=0.75 TR=111.3n TF=603.7p ITF=0.65 VTF=5 XTF=1.7 RB=10)"] }
}
```

`components/core/Transistors/2n7000.json`:
```json
{
  "schema": 1, "id": "transistors.2n7000", "name": "N-MOSFET 2N7000", "category": "Transistors",
  "tags": ["mosfet", "nmos", "fet", "M"],
  "symbol": { "width": 40, "height": 40, "svg": "../symbols/nmos.svg",
              "pins": [{ "id": "D", "name": "D", "x": 30, "y": 0 },
                       { "id": "G", "name": "G", "x": 0, "y": 20 },
                       { "id": "S", "name": "S", "x": 30, "y": 40 }] },
  "spice": { "kind": "analog", "refPrefix": "M", "template": "{ref} {pin.D} {pin.G} {pin.S} {pin.S} M2N7000",
             "models": ["* 2N7000: simplified level-1 model written by multysm from datasheet values (Vth 2.1 V); not a vendor model",
                        ".model M2N7000 NMOS(LEVEL=1 VTO=2.1 KP=0.1 LAMBDA=0.01 RD=1 RS=0.5 CBD=25p CGSO=20p CGDO=3p)"] }
}
```

`components/core/symbols/npn.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 20h14M14 8v24M14 15l16-9V0M14 25l16 9v6M23 35l7-1-4-6"/></svg>
```
`components/core/symbols/pnp.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 20h14M14 8v24M14 15l16-9V0M14 25l16 9v6M21 24l-7 1 4 6"/></svg>
```
`components/core/symbols/nmos.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 20h10M10 10v20M15 8v7M15 17v6M15 25v7M15 11h15V0M15 29h15v11M15 20h15v9M20 17l-5 3 5 3"/></svg>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p multysm-core --test starter_pack --test library`
Expected: all pass (14 in `starter_pack`).

- [ ] **Step 6: Commit**

```bash
git add components/core crates/multysm-core/tests/starter_pack.rs
git commit -m "feat(parts): 1N4148, 1N4007, 5.1 V zener, 2N2222, 2N2907 and 2N7000"
```

---

### Task 4: Op-amps

**Files:**
- Create: `components/core/Analog/{opamp_ideal,lm741}.json`, `components/core/symbols/opamp.svg`, `components/core/models/{opamp_ideal,lm741}.lib`
- Test: `crates/multysm-core/tests/starter_pack.rs`

**Interfaces:**
- Consumes: `starter_pack.rs` helpers `net`, `run`.
- Produces: `analog.opamp_ideal`, `analog.lm741` with pins `inp` (+), `inn` (−), `out`, `vp` (V+), `vn` (V−); ref prefix `U`.

- [ ] **Step 1: Write the failing tests**

Append to `crates/multysm-core/tests/starter_pack.rs`:

```rust
// ---- Analog ----

/// Inverting amplifier: Vin -> 1k -> in-, 10k from in- to out, in+ to ground,
/// supplies at +/-12 V. Returns V(out).
fn inverting_amp(part: &str, vin: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vp = b.add("sources.dc_voltage", "VP", &[("voltage", "12")]);
    let vn = b.add("sources.dc_voltage", "VN", &[("voltage", "12")]);
    let vi = b.add("sources.dc_voltage", "VI", &[("voltage", vin)]);
    let ri = b.add("basic.resistor", "RI", &[("resistance", "1k")]);
    let rf = b.add("basic.resistor", "RF", &[("resistance", "10k")]);
    let u1 = b.add(part, "U1", &[]);
    b.connect((&vp, "n"), (&gnd, "1"));
    b.connect((&vp, "p"), (&u1, "vp"));
    b.connect((&vn, "p"), (&gnd, "1"));
    b.connect((&vn, "n"), (&u1, "vn"));
    b.connect((&vi, "n"), (&gnd, "1"));
    b.connect((&vi, "p"), (&ri, "1"));
    b.connect((&ri, "2"), (&u1, "inn"));
    b.connect((&rf, "1"), (&u1, "inn"));
    b.connect((&rf, "2"), (&u1, "out"));
    b.connect((&u1, "inp"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &u1, "out")).unwrap()
}

#[test]
fn ideal_opamp_inverting_gain_is_minus_ten() {
    let out = inverting_amp("analog.opamp_ideal", "0.1");
    assert!((out + 1.0).abs() < 0.01, "ideal op-amp out = {out}");
    let overdriven = inverting_amp("analog.opamp_ideal", "2");
    assert!((-12.01..=12.01).contains(&overdriven), "overdriven out = {overdriven}");
}

#[test]
fn lm741_inverting_gain_is_minus_ten_and_clamps() {
    let out = inverting_amp("analog.lm741", "0.1");
    assert!((out + 1.0).abs() < 0.05, "LM741 out = {out}");
    let overdriven = inverting_amp("analog.lm741", "2");
    assert!((-12.0..=12.0).contains(&overdriven), "overdriven out = {overdriven}");
    assert!(overdriven < -9.0, "LM741 should swing close to the negative rail, got {overdriven}");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p multysm-core --test starter_pack`
Expected: the 2 new tests FAIL with `unknown part analog.opamp_ideal` / `analog.lm741`.

- [ ] **Step 3: Add the models, manifests and symbol**

`components/core/models/opamp_ideal.lib`:
```spice
* Ideal op-amp - multysm core pack (not a vendor model).
* Open-loop gain 1e5, input resistance 1e12, output 1 ohm, output limited to the supply pins.
.subckt OPAMP_IDEAL inp inn out vpos vneg
Rin inp inn 1e12
Bgain oint 0 V = min(max(1e5*(V(inp)-V(inn)), V(vneg)), V(vpos))
Rout oint out 1
.ends OPAMP_IDEAL
```

`components/core/models/lm741.lib`:
```spice
* LM741 behavioural macromodel - written for multysm core pack (not a vendor model).
* DC gain 2e5, dominant pole about 5 Hz (GBW about 1 MHz), 2 Mohm input,
* 75 ohm output, output swing limited to 1.5 V inside each rail.
.subckt LM741 inp inn out vpos vneg
Rin inp inn 2Meg
Bgm 0 n1 I = 1e-3*max(min(V(inp)-V(inn), 1e-4), -1e-4)
R1 n1 0 200Meg
C1 n1 0 159p
Bout oint 0 V = min(max(V(n1), V(vneg)+1.5), V(vpos)-1.5)
Rout oint out 75
Rq vpos vneg 6k
.ends LM741
```

`components/core/Analog/opamp_ideal.json`:
```json
{
  "schema": 1, "id": "analog.opamp_ideal", "name": "Op-Amp (ideal)", "category": "Analog",
  "tags": ["opamp", "amplifier", "comparator", "U"],
  "symbol": { "width": 60, "height": 60, "svg": "../symbols/opamp.svg",
              "pins": [{ "id": "inn", "name": "-", "x": 0, "y": 20 },
                       { "id": "inp", "name": "+", "x": 0, "y": 40 },
                       { "id": "out", "name": "OUT", "x": 60, "y": 30 },
                       { "id": "vp", "name": "V+", "x": 30, "y": 0 },
                       { "id": "vn", "name": "V-", "x": 30, "y": 60 }] },
  "spice": { "kind": "analog", "refPrefix": "U", "subckt": "../models/opamp_ideal.lib",
             "template": "X{ref} {pin.inp} {pin.inn} {pin.out} {pin.vp} {pin.vn} OPAMP_IDEAL" }
}
```

`components/core/Analog/lm741.json`:
```json
{
  "schema": 1, "id": "analog.lm741", "name": "LM741 Op-Amp", "category": "Analog",
  "tags": ["opamp", "amplifier", "741", "U"],
  "symbol": { "width": 60, "height": 60, "svg": "../symbols/opamp.svg",
              "pins": [{ "id": "inn", "name": "-", "x": 0, "y": 20 },
                       { "id": "inp", "name": "+", "x": 0, "y": 40 },
                       { "id": "out", "name": "OUT", "x": 60, "y": 30 },
                       { "id": "vp", "name": "V+", "x": 30, "y": 0 },
                       { "id": "vn", "name": "V-", "x": 30, "y": 60 }] },
  "spice": { "kind": "analog", "refPrefix": "U", "subckt": "../models/lm741.lib",
             "template": "X{ref} {pin.inp} {pin.inn} {pin.out} {pin.vp} {pin.vn} LM741" }
}
```

`components/core/symbols/opamp.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 5v50l40-25zM0 20h10M0 40h10M50 30h10M30 0v17.5M30 60v-17.5M14 20h6M14 40h6M17 37v6"/></svg>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p multysm-core --test starter_pack --test library`
Expected: all pass (16 in `starter_pack`).

- [ ] **Step 5: Commit**

```bash
git add components/core crates/multysm-core/tests/starter_pack.rs
git commit -m "feat(parts): ideal op-amp and LM741 macromodel"
```

---

### Task 5: TTL and CMOS logic

**Files:**
- Create: `components/core/TTL/{7404,7408,7432}.json`, `components/core/CMOS/{4011,4017}.json`, `components/core/symbols/dip16.svg`, `components/core/models/{sn7404,sn7408,sn7432,cd4011,cd4017}.lib`
- Test: `crates/multysm-core/tests/starter_pack.rs`

**Interfaces:**
- Consumes: `starter_pack.rs` helpers `net`, `run`, `tran`; existing `components/core/symbols/dip14.svg`.
- Produces: `ttl.7404` (DIP-14: 1 1A, 2 1Y, 3 2A, 4 2Y, 5 3A, 6 3Y, 7 GND, 8 4Y, 9 4A, 10 5Y, 11 5A, 12 6Y, 13 6A, 14 VCC); `ttl.7408`, `ttl.7432`, `cmos.4011` (same pinout as the 7400); `cmos.4017` (DIP-16: 1 Q5, 2 Q1, 3 Q0, 4 Q2, 5 Q6, 6 Q7, 7 Q3, 8 VSS, 9 Q8, 10 Q4, 11 Q9, 12 CO, 13 INH, 14 CLK, 15 RST, 16 VDD).

- [ ] **Step 1: Write the failing tests**

Append to `crates/multysm-core/tests/starter_pack.rs`:

```rust
// ---- Logic ----

/// Powers `part` from 5 V on `supply.0` with `supply.1` grounded, drives each
/// input pin from its own DC source, and returns V(output) at the end of a
/// 1 ms transient.
fn gate_output(part: &str, supply: (&str, &str), inputs: &[(&str, &str)], output: &str) -> f64 {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, tran("1m", "10u"));
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vcc = b.add("sources.dc_voltage", "VCC", &[("voltage", "5")]);
    let u1 = b.add(part, "U1", &[]);
    let mut sources = Vec::new();
    for (i, (_, volts)) in inputs.iter().enumerate() {
        sources.push(b.add("sources.dc_voltage", &format!("VIN{i}"), &[("voltage", *volts)]));
    }
    b.connect((&vcc, "p"), (&u1, supply.0));
    b.connect((&vcc, "n"), (&gnd, "1"));
    b.connect((&u1, supply.1), (&gnd, "1"));
    for ((pin, _), source) in inputs.iter().zip(&sources) {
        b.connect((source, "p"), (&u1, *pin));
        b.connect((source, "n"), (&gnd, "1"));
    }
    let (netlist, result) = run(&lib, b);
    result.last(&net(&netlist, &u1, output)).unwrap()
}

fn assert_level(label: &str, v: f64, high: bool, high_min: f64) {
    if high {
        assert!(v > high_min, "{label} = {v} V, expected high");
    } else {
        assert!(v < 0.5, "{label} = {v} V, expected low");
    }
}

#[test]
fn ttl_7404_inverts() {
    for (a, high) in [("0", true), ("5", false)] {
        let y = gate_output("ttl.7404", ("14", "7"), &[("1", a)], "2");
        assert_level(&format!("NOT({a})"), y, high, 3.0);
    }
}

fn two_input_truth_table(part: &str, supply: (&str, &str), high_min: f64, expect: [bool; 4]) {
    for ((a, b), high) in [("0", "0"), ("0", "5"), ("5", "0"), ("5", "5")].into_iter().zip(expect) {
        let y = gate_output(part, supply, &[("1", a), ("2", b)], "3");
        assert_level(&format!("{part}({a},{b})"), y, high, high_min);
    }
}

#[test]
fn ttl_7408_and_truth_table() {
    two_input_truth_table("ttl.7408", ("14", "7"), 3.0, [false, false, false, true]);
}

#[test]
fn ttl_7432_or_truth_table() {
    two_input_truth_table("ttl.7432", ("14", "7"), 3.0, [false, true, true, true]);
}

#[test]
fn cmos_4011_nand_truth_table() {
    two_input_truth_table("cmos.4011", ("14", "7"), 4.5, [true, true, true, false]);
}

#[test]
fn cmos_4017_counts_on_clock_edges() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, tran("2.5m", "10u"));
    let gnd = b.add("sources.ground", "GND1", &[]);
    let vdd = b.add("sources.dc_voltage", "VDD", &[("voltage", "5")]);
    let clk = b.add(
        "sources.pulse_voltage",
        "VCLK",
        &[("v1", "0"), ("v2", "5"), ("delay", "500u"), ("rise", "1u"), ("fall", "1u"), ("width", "500u"), ("period", "1m")],
    );
    let rst = b.add(
        "sources.pulse_voltage",
        "VRST",
        &[("v1", "5"), ("v2", "0"), ("delay", "100u"), ("rise", "1u"), ("fall", "1u"), ("width", "10"), ("period", "20")],
    );
    let u1 = b.add("cmos.4017", "U1", &[]);
    b.connect((&vdd, "p"), (&u1, "16"));
    b.connect((&vdd, "n"), (&gnd, "1"));
    b.connect((&u1, "8"), (&gnd, "1"));
    b.connect((&u1, "13"), (&gnd, "1"));
    b.connect((&clk, "p"), (&u1, "14"));
    b.connect((&clk, "n"), (&gnd, "1"));
    b.connect((&rst, "p"), (&u1, "15"));
    b.connect((&rst, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);

    let at = |pin: &str, t: f64| result.sample_at(&net(&netlist, &u1, pin), t).unwrap();
    // Pins: Q0 = 3, Q1 = 2, Q2 = 4. Rising clock edges at 0.5 ms and 1.5 ms.
    assert_level("Q0 @0.3ms", at("3", 0.3e-3), true, 4.5);
    assert_level("Q1 @0.3ms", at("2", 0.3e-3), false, 4.5);
    assert_level("Q1 @1.0ms", at("2", 1.0e-3), true, 4.5);
    assert_level("Q0 @1.0ms", at("3", 1.0e-3), false, 4.5);
    assert_level("Q2 @2.0ms", at("4", 2.0e-3), true, 4.5);
    assert_level("Q1 @2.0ms", at("2", 2.0e-3), false, 4.5);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p multysm-core --test starter_pack`
Expected: the 5 new tests FAIL with `unknown part ttl.7404` (etc.).

- [ ] **Step 3: Add the TTL models and manifests**

`components/core/models/sn7404.lib`:
```spice
* 7404 hex inverter (XSPICE digital) - multysm core pack
.subckt SN7404 a1 y1 a2 y2 a3 y3 gnd y4 a4 y5 a5 y6 a6 vcc
Rpwr vcc gnd 1e6
Ain [a1 a2 a3 a4 a5 a6] [da1 da2 da3 da4 da5 da6] ttl_in
Ag1 da1 dy1 ttl_inv
Ag2 da2 dy2 ttl_inv
Ag3 da3 dy3 ttl_inv
Ag4 da4 dy4 ttl_inv
Ag5 da5 dy5 ttl_inv
Ag6 da6 dy6 ttl_inv
Aout [dy1 dy2 dy3 dy4 dy5 dy6] [y1 y2 y3 y4 y5 y6] ttl_out
.model ttl_in adc_bridge(in_low=0.8 in_high=2.0)
.model ttl_out dac_bridge(out_low=0.2 out_high=3.4 out_undef=1.8)
.model ttl_inv d_inverter(rise_delay=10n fall_delay=10n)
.ends SN7404
```

`components/core/models/sn7408.lib`:
```spice
* 7408 quad 2-input AND (XSPICE digital) - multysm core pack
.subckt SN7408 a1 b1 y1 a2 b2 y2 gnd y3 a3 b3 y4 a4 b4 vcc
Rpwr vcc gnd 1e6
Ain [a1 b1 a2 b2 a3 b3 a4 b4] [da1 db1 da2 db2 da3 db3 da4 db4] ttl_in
Ag1 [da1 db1] dy1 ttl_and
Ag2 [da2 db2] dy2 ttl_and
Ag3 [da3 db3] dy3 ttl_and
Ag4 [da4 db4] dy4 ttl_and
Aout [dy1 dy2 dy3 dy4] [y1 y2 y3 y4] ttl_out
.model ttl_in adc_bridge(in_low=0.8 in_high=2.0)
.model ttl_out dac_bridge(out_low=0.2 out_high=3.4 out_undef=1.8)
.model ttl_and d_and(rise_delay=10n fall_delay=10n)
.ends SN7408
```

`components/core/models/sn7432.lib`:
```spice
* 7432 quad 2-input OR (XSPICE digital) - multysm core pack
.subckt SN7432 a1 b1 y1 a2 b2 y2 gnd y3 a3 b3 y4 a4 b4 vcc
Rpwr vcc gnd 1e6
Ain [a1 b1 a2 b2 a3 b3 a4 b4] [da1 db1 da2 db2 da3 db3 da4 db4] ttl_in
Ag1 [da1 db1] dy1 ttl_or
Ag2 [da2 db2] dy2 ttl_or
Ag3 [da3 db3] dy3 ttl_or
Ag4 [da4 db4] dy4 ttl_or
Aout [dy1 dy2 dy3 dy4] [y1 y2 y3 y4] ttl_out
.model ttl_in adc_bridge(in_low=0.8 in_high=2.0)
.model ttl_out dac_bridge(out_low=0.2 out_high=3.4 out_undef=1.8)
.model ttl_or d_or(rise_delay=10n fall_delay=10n)
.ends SN7432
```

`components/core/TTL/7404.json`:
```json
{
  "schema": 1, "id": "ttl.7404", "name": "7404 Hex Inverter", "category": "TTL",
  "tags": ["not", "inverter", "gate", "logic", "74"],
  "symbol": { "width": 80, "height": 160, "svg": "../symbols/dip14.svg",
    "pins": [
      { "id": "1",  "name": "1A",  "x": 0,  "y": 10,  "optional": true },
      { "id": "2",  "name": "1Y",  "x": 80, "y": 10,  "optional": true },
      { "id": "3",  "name": "2A",  "x": 0,  "y": 30,  "optional": true },
      { "id": "4",  "name": "2Y",  "x": 80, "y": 30,  "optional": true },
      { "id": "5",  "name": "3A",  "x": 0,  "y": 50,  "optional": true },
      { "id": "6",  "name": "3Y",  "x": 80, "y": 50,  "optional": true },
      { "id": "7",  "name": "GND", "x": 40, "y": 160 },
      { "id": "8",  "name": "4Y",  "x": 80, "y": 70,  "optional": true },
      { "id": "9",  "name": "4A",  "x": 0,  "y": 70,  "optional": true },
      { "id": "10", "name": "5Y",  "x": 80, "y": 90,  "optional": true },
      { "id": "11", "name": "5A",  "x": 0,  "y": 90,  "optional": true },
      { "id": "12", "name": "6Y",  "x": 80, "y": 110, "optional": true },
      { "id": "13", "name": "6A",  "x": 0,  "y": 110, "optional": true },
      { "id": "14", "name": "VCC", "x": 40, "y": 0 }
    ] },
  "spice": { "kind": "digital", "refPrefix": "U",
             "template": "X{ref} {pin.1} {pin.2} {pin.3} {pin.4} {pin.5} {pin.6} {pin.7} {pin.8} {pin.9} {pin.10} {pin.11} {pin.12} {pin.13} {pin.14} SN7404",
             "subckt": "../models/sn7404.lib" }
}
```

`components/core/TTL/7408.json` — identical pin list to `components/core/TTL/7400.json`:
```json
{
  "schema": 1, "id": "ttl.7408", "name": "7408 Quad 2-input AND", "category": "TTL",
  "tags": ["and", "gate", "logic", "74"],
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
             "template": "X{ref} {pin.1} {pin.2} {pin.3} {pin.4} {pin.5} {pin.6} {pin.7} {pin.8} {pin.9} {pin.10} {pin.11} {pin.12} {pin.13} {pin.14} SN7408",
             "subckt": "../models/sn7408.lib" }
}
```

`components/core/TTL/7432.json`: the same file as `7408.json` with these three changes — `"id": "ttl.7432"`, `"name": "7432 Quad 2-input OR"`, `"tags": ["or", "gate", "logic", "74"]`, template ending `SN7432`, and `"subckt": "../models/sn7432.lib"`. Write it out in full.

- [ ] **Step 4: Add the CMOS models, manifests and symbol**

`components/core/models/cd4011.lib`:
```spice
* CD4011 quad 2-input NAND (XSPICE digital, thresholds for 5 V supply) - multysm core pack
.subckt CD4011 a1 b1 y1 a2 b2 y2 vss y3 a3 b3 y4 a4 b4 vdd
Rpwr vdd vss 1e6
Ain [a1 b1 a2 b2 a3 b3 a4 b4] [da1 db1 da2 db2 da3 db3 da4 db4] cmos_in
Ag1 [da1 db1] dy1 cmos_nand
Ag2 [da2 db2] dy2 cmos_nand
Ag3 [da3 db3] dy3 cmos_nand
Ag4 [da4 db4] dy4 cmos_nand
Aout [dy1 dy2 dy3 dy4] [y1 y2 y3 y4] cmos_out
.model cmos_in adc_bridge(in_low=1.5 in_high=3.5)
.model cmos_out dac_bridge(out_low=0.05 out_high=4.95 out_undef=2.5)
.model cmos_nand d_nand(rise_delay=20n fall_delay=20n)
.ends CD4011
```

`components/core/models/cd4017.lib`:
```spice
* CD4017 decade counter (XSPICE digital, thresholds for 5 V supply) - multysm core pack
* Five-stage Johnson counter clocked on CLK rising edges while INH is low; RST is asynchronous.
* Subcircuit pin order follows the DIP: Q5 Q1 Q0 Q2 Q6 Q7 Q3 VSS Q8 Q4 Q9 CO INH CLK RST VDD
.subckt CD4017 q5 q1 q0 q2 q6 q7 q3 vss q8 q4 q9 co inh clk rst vdd
Rpwr vdd vss 1e6
Ain [clk inh rst] [dclk dinh drst] cmos_in
Aclk [dclk ~dinh] dce cmos_and
Af1 s5n dce null drst s1 s1n cmos_dff
Af2 s1 dce null drst s2 s2n cmos_dff
Af3 s2 dce null drst s3 s3n cmos_dff
Af4 s3 dce null drst s4 s4n cmos_dff
Af5 s4 dce null drst s5 s5n cmos_dff
Ad0 [s1n s5n] d0 cmos_and
Ad1 [s1 s2n] d1 cmos_and
Ad2 [s2 s3n] d2 cmos_and
Ad3 [s3 s4n] d3 cmos_and
Ad4 [s4 s5n] d4 cmos_and
Ad5 [s1 s5] d5 cmos_and
Ad6 [s1n s2] d6 cmos_and
Ad7 [s2n s3] d7 cmos_and
Ad8 [s3n s4] d8 cmos_and
Ad9 [s4n s5] d9 cmos_and
Aco s5n dco cmos_buf
Aout [d0 d1 d2 d3 d4 d5 d6 d7 d8 d9 dco] [q0 q1 q2 q3 q4 q5 q6 q7 q8 q9 co] cmos_out
.model cmos_in adc_bridge(in_low=1.5 in_high=3.5)
.model cmos_out dac_bridge(out_low=0.05 out_high=4.95 out_undef=2.5)
.model cmos_and d_and(rise_delay=20n fall_delay=20n)
.model cmos_buf d_buffer(rise_delay=20n fall_delay=20n)
.model cmos_dff d_dff(clk_delay=20n reset_delay=20n ic=0)
.ends CD4017
```

Decoding reference (state after n clocks → s1..s5): 0 → 00000, 1 → 10000, 2 → 11000, 3 → 11100, 4 → 11110, 5 → 11111, 6 → 01111, 7 → 00111, 8 → 00011, 9 → 00001. Each `Ad<n>` line is true in exactly state n; CO is high for states 0–4.

`components/core/CMOS/4011.json`: the `7408.json` pin list with `"name": "VSS"` for pin 7 and `"name": "VDD"` for pin 14:
```json
{
  "schema": 1, "id": "cmos.4011", "name": "4011 Quad 2-input NAND", "category": "CMOS",
  "tags": ["nand", "gate", "logic", "4000", "cmos"],
  "symbol": { "width": 80, "height": 160, "svg": "../symbols/dip14.svg",
    "pins": [
      { "id": "1",  "name": "1A",  "x": 0,  "y": 10,  "optional": true },
      { "id": "2",  "name": "1B",  "x": 0,  "y": 20,  "optional": true },
      { "id": "3",  "name": "1Y",  "x": 80, "y": 15,  "optional": true },
      { "id": "4",  "name": "2A",  "x": 0,  "y": 40,  "optional": true },
      { "id": "5",  "name": "2B",  "x": 0,  "y": 50,  "optional": true },
      { "id": "6",  "name": "2Y",  "x": 80, "y": 45,  "optional": true },
      { "id": "7",  "name": "VSS", "x": 40, "y": 160 },
      { "id": "8",  "name": "3Y",  "x": 80, "y": 95,  "optional": true },
      { "id": "9",  "name": "3A",  "x": 0,  "y": 90,  "optional": true },
      { "id": "10", "name": "3B",  "x": 0,  "y": 100, "optional": true },
      { "id": "11", "name": "4Y",  "x": 80, "y": 125, "optional": true },
      { "id": "12", "name": "4A",  "x": 0,  "y": 120, "optional": true },
      { "id": "13", "name": "4B",  "x": 0,  "y": 130, "optional": true },
      { "id": "14", "name": "VDD", "x": 40, "y": 0 }
    ] },
  "spice": { "kind": "digital", "refPrefix": "U",
             "template": "X{ref} {pin.1} {pin.2} {pin.3} {pin.4} {pin.5} {pin.6} {pin.7} {pin.8} {pin.9} {pin.10} {pin.11} {pin.12} {pin.13} {pin.14} CD4011",
             "subckt": "../models/cd4011.lib" }
}
```

`components/core/CMOS/4017.json`:
```json
{
  "schema": 1, "id": "cmos.4017", "name": "4017 Decade Counter", "category": "CMOS",
  "tags": ["counter", "johnson", "divider", "4000", "cmos"],
  "symbol": { "width": 80, "height": 140, "svg": "../symbols/dip16.svg",
    "pins": [
      { "id": "14", "name": "CLK", "x": 0,  "y": 20 },
      { "id": "13", "name": "INH", "x": 0,  "y": 40 },
      { "id": "15", "name": "RST", "x": 0,  "y": 60 },
      { "id": "16", "name": "VDD", "x": 40, "y": 0 },
      { "id": "8",  "name": "VSS", "x": 40, "y": 140 },
      { "id": "3",  "name": "Q0",  "x": 80, "y": 10,  "optional": true },
      { "id": "2",  "name": "Q1",  "x": 80, "y": 20,  "optional": true },
      { "id": "4",  "name": "Q2",  "x": 80, "y": 30,  "optional": true },
      { "id": "7",  "name": "Q3",  "x": 80, "y": 40,  "optional": true },
      { "id": "10", "name": "Q4",  "x": 80, "y": 50,  "optional": true },
      { "id": "1",  "name": "Q5",  "x": 80, "y": 60,  "optional": true },
      { "id": "5",  "name": "Q6",  "x": 80, "y": 70,  "optional": true },
      { "id": "6",  "name": "Q7",  "x": 80, "y": 80,  "optional": true },
      { "id": "9",  "name": "Q8",  "x": 80, "y": 90,  "optional": true },
      { "id": "11", "name": "Q9",  "x": 80, "y": 100, "optional": true },
      { "id": "12", "name": "CO",  "x": 80, "y": 120, "optional": true }
    ] },
  "spice": { "kind": "digital", "refPrefix": "U",
             "template": "X{ref} {pin.1} {pin.2} {pin.3} {pin.4} {pin.5} {pin.6} {pin.7} {pin.8} {pin.9} {pin.10} {pin.11} {pin.12} {pin.13} {pin.14} {pin.15} {pin.16} CD4017",
             "subckt": "../models/cd4017.lib" }
}
```

`components/core/symbols/dip16.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 140" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="5" width="60" height="130" rx="3"/><path d="M34 5a6 6 0 0 0 12 0"/></svg>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p multysm-core --test starter_pack --test library`
Expected: all pass (21 in `starter_pack`). If ngspice rejects `null` or `~` in `cd4017.lib`, the engine error log names the line; `NULL` (upper case) is the documented XSPICE spelling for an unconnected port, and inverted inputs can instead use the `s<n>n` outputs.

- [ ] **Step 6: Commit**

```bash
git add components/core crates/multysm-core/tests/starter_pack.rs
git commit -m "feat(parts): 7404, 7408, 7432, 4011 and 4017 decade counter"
```

---

### Task 6: Indicators

**Files:**
- Create: `components/core/Indicators/{voltmeter,ammeter,probe,logic_probe,seven_segment}.json`, `components/core/symbols/{voltmeter,ammeter,probe,logic_probe,seven_segment}.svg`, `components/core/models/{meters,seg7}.lib`
- Test: `crates/multysm-core/tests/starter_pack.rs`

**Interfaces:**
- Consumes: `starter_pack.rs` helpers `net`, `run`.
- Produces: `indicators.voltmeter` (pins p, n; prefix VM), `indicators.ammeter` (p, n; prefix AM; current vector `v.x<ref lower>.vsense#branch`), `indicators.probe` (pin 1; PR), `indicators.logic_probe` (pin 1; LP), `indicators.seven_segment` (pins a b c d e f g dp K; prefix DS).

- [ ] **Step 1: Write the failing tests**

Append to `crates/multysm-core/tests/starter_pack.rs`:

```rust
// ---- Indicators ----

#[test]
fn voltmeter_does_not_load_the_circuit() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "10")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let vm = b.add("indicators.voltmeter", "VM1", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&vm, "p"));
    b.connect((&vm, "n"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &vm, "p")).unwrap();
    assert!(v > 9.99, "V(VM1) = {v}");
}

#[test]
fn ammeter_reads_the_loop_current() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let am = b.add("indicators.ammeter", "AM1", &[]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    b.connect((&v1, "p"), (&am, "p"));
    b.connect((&am, "n"), (&r1, "1"));
    b.connect((&r1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (_, result) = run(&lib, b);
    let name = result
        .vectors
        .keys()
        .find(|k| k.contains("xam1") && k.ends_with("#branch"))
        .unwrap_or_else(|| panic!("no ammeter current in {:?}", result.vectors.keys().collect::<Vec<_>>()))
        .clone();
    let i = result.last(&name).unwrap().abs();
    assert!((i - 5e-3).abs() / 5e-3 < 0.01, "I(AM1) = {i}");
}

#[test]
fn probes_do_not_load_the_circuit() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let pr = b.add("indicators.probe", "PR1", &[]);
    let lp = b.add("indicators.logic_probe", "LP1", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&pr, "1"));
    b.connect((&pr, "1"), (&lp, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &pr, "1")).unwrap();
    assert!(v > 4.99, "probed node = {v}");
}

#[test]
fn seven_segment_a_lights_through_330_ohms() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "330")]);
    let ds = b.add("indicators.seven_segment", "DS1", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&ds, "a"));
    b.connect((&ds, "K"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let (netlist, result) = run(&lib, b);
    let v = result.last(&net(&netlist, &ds, "a")).unwrap();
    assert!((1.5..2.1).contains(&v), "segment a forward voltage = {v}");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p multysm-core --test starter_pack`
Expected: the 4 new tests FAIL with `unknown part indicators.voltmeter` (etc.).

- [ ] **Step 3: Add the models, manifests and symbols**

`components/core/models/meters.lib`:
```spice
* Meters and probes - multysm core pack (not vendor models).
* Readouts on the canvas arrive with the simulation UI; these only add harmless elements.
.subckt VMETER p n
R1 p n 10Meg
.ends VMETER
.subckt AMMETER p n
Vsense p n DC 0
.ends AMMETER
.subckt PROBE p
R1 p 0 1e12
.ends PROBE
```

`components/core/models/seg7.lib`:
```spice
* Common-cathode 7-segment display - multysm core pack (not a vendor model).
* One red LED per segment and decimal point, all cathodes on k.
.subckt SEG7_CC a b c d e f g dp k
Da a k LED_SEG
Db b k LED_SEG
Dc c k LED_SEG
Dd d k LED_SEG
De e k LED_SEG
Df f k LED_SEG
Dg g k LED_SEG
Ddp dp k LED_SEG
.model LED_SEG D(Is=1e-20 N=1.5 Rs=2 BV=5 IBV=10u)
.ends SEG7_CC
```

`components/core/Indicators/voltmeter.json`:
```json
{
  "schema": 1, "id": "indicators.voltmeter", "name": "Voltmeter", "category": "Indicators",
  "tags": ["meter", "voltage", "measure"],
  "symbol": { "width": 40, "height": 60, "svg": "../symbols/voltmeter.svg",
              "pins": [{ "id": "p", "name": "+", "x": 20, "y": 0 },
                       { "id": "n", "name": "-", "x": 20, "y": 60 }] },
  "spice": { "kind": "analog", "refPrefix": "VM", "subckt": "../models/meters.lib",
             "template": "X{ref} {pin.p} {pin.n} VMETER" }
}
```

`components/core/Indicators/ammeter.json`:
```json
{
  "schema": 1, "id": "indicators.ammeter", "name": "Ammeter", "category": "Indicators",
  "tags": ["meter", "current", "measure"],
  "symbol": { "width": 40, "height": 60, "svg": "../symbols/ammeter.svg",
              "pins": [{ "id": "p", "name": "+", "x": 20, "y": 0 },
                       { "id": "n", "name": "-", "x": 20, "y": 60 }] },
  "spice": { "kind": "analog", "refPrefix": "AM", "subckt": "../models/meters.lib",
             "template": "X{ref} {pin.p} {pin.n} AMMETER" }
}
```

`components/core/Indicators/probe.json`:
```json
{
  "schema": 1, "id": "indicators.probe", "name": "Probe", "category": "Indicators",
  "tags": ["probe", "measure", "plot"],
  "symbol": { "width": 20, "height": 30, "svg": "../symbols/probe.svg",
              "pins": [{ "id": "1", "x": 10, "y": 30 }] },
  "spice": { "kind": "analog", "refPrefix": "PR", "subckt": "../models/meters.lib",
             "template": "X{ref} {pin.1} PROBE" }
}
```

`components/core/Indicators/logic_probe.json`:
```json
{
  "schema": 1, "id": "indicators.logic_probe", "name": "Logic Probe", "category": "Indicators",
  "tags": ["probe", "logic", "digital"],
  "symbol": { "width": 20, "height": 30, "svg": "../symbols/logic_probe.svg",
              "pins": [{ "id": "1", "x": 10, "y": 30 }] },
  "spice": { "kind": "analog", "refPrefix": "LP", "subckt": "../models/meters.lib",
             "template": "X{ref} {pin.1} PROBE" }
}
```

`components/core/Indicators/seven_segment.json` (tags avoid "led" so searching "led" still finds the LED first):
```json
{
  "schema": 1, "id": "indicators.seven_segment", "name": "7-Segment Display (CC)", "category": "Indicators",
  "tags": ["display", "digit", "segment"],
  "symbol": { "width": 60, "height": 100, "svg": "../symbols/seven_segment.svg",
    "pins": [
      { "id": "a",  "name": "a",  "x": 0,  "y": 10, "optional": true },
      { "id": "b",  "name": "b",  "x": 0,  "y": 20, "optional": true },
      { "id": "c",  "name": "c",  "x": 0,  "y": 30, "optional": true },
      { "id": "d",  "name": "d",  "x": 0,  "y": 40, "optional": true },
      { "id": "e",  "name": "e",  "x": 0,  "y": 50, "optional": true },
      { "id": "f",  "name": "f",  "x": 0,  "y": 60, "optional": true },
      { "id": "g",  "name": "g",  "x": 0,  "y": 70, "optional": true },
      { "id": "dp", "name": "dp", "x": 0,  "y": 80, "optional": true },
      { "id": "K",  "name": "K",  "x": 30, "y": 100 }
    ] },
  "spice": { "kind": "analog", "refPrefix": "DS", "subckt": "../models/seg7.lib",
             "template": "X{ref} {pin.a} {pin.b} {pin.c} {pin.d} {pin.e} {pin.f} {pin.g} {pin.dp} {pin.K} SEG7_CC" }
}
```

`components/core/symbols/voltmeter.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="20" cy="30" r="12"/><path d="M20 0v18M20 42v18"/><text x="20" y="34" font-size="12" text-anchor="middle" fill="currentColor" stroke="none">V</text></svg>
```
`components/core/symbols/ammeter.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="20" cy="30" r="12"/><path d="M20 0v18M20 42v18"/><text x="20" y="34" font-size="12" text-anchor="middle" fill="currentColor" stroke="none">A</text></svg>
```
`components/core/symbols/probe.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 30" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 30V18M5 11h10M10 6v10"/><circle cx="10" cy="11" r="7"/></svg>
```
`components/core/symbols/logic_probe.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 30" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 30V18"/><rect x="3" y="4" width="14" height="14" rx="2"/><text x="10" y="15" font-size="9" text-anchor="middle" fill="currentColor" stroke="none">L</text></svg>
```
`components/core/symbols/seven_segment.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="2" width="48" height="90" rx="3"/><path d="M0 10h10M0 20h10M0 30h10M0 40h10M0 50h10M0 60h10M0 70h10M0 80h10M30 92v8M26 20h16M44 22v22M44 50v22M26 74h16M24 50v22M24 22v22M26 47h16"/><circle cx="50" cy="78" r="1.5"/></svg>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p multysm-core --test starter_pack --test library`
Expected: all pass (25 in `starter_pack`).

- [ ] **Step 5: Commit**

```bash
git add components/core crates/multysm-core/tests/starter_pack.rs
git commit -m "feat(parts): voltmeter, ammeter, probes and 7-segment display"
```

---

### Task 7: Whole-library checks and the frontend fixture

**Files:**
- Modify: `crates/multysm-core/tests/library.rs`, `crates/multysm-core/tests/netlist.rs`, `app/src/backend/mock-library.json` (regenerated), `app/src/ui/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: all 35 manifests (Tasks 2–6); `export_library` binary (`src-tauri/src/bin/export_library.rs`).
- Produces: `mock-library.json` with 35 parts, used by every frontend test and the browser mock backend.

- [ ] **Step 1: Write the failing whole-library tests**

In `crates/multysm-core/tests/library.rs`, replace `core_library_loads_cleanly` with:

```rust
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
```

Append to `crates/multysm-core/tests/netlist.rs`:

```rust
#[test]
fn every_core_part_renders_a_netlist_line() {
    let lib = core_library();
    for (id, part) in &lib.parts {
        let Some(device) = part.manifest.spice.device() else { continue };
        let reference = format!("{}1", device.ref_prefix);
        let mut b = CircuitBuilder::new(&lib, Analysis::Op);
        let gnd = b.add("sources.ground", "GND1", &[]);
        let dut = b.add(id, &reference, &[]);
        let pins: Vec<String> = part.manifest.symbol.pins.iter().map(|p| p.id.clone()).collect();
        let mut loads = Vec::new();
        for i in 0..pins.len() {
            loads.push(b.add("basic.resistor", &format!("RL{i}"), &[]));
        }
        for (pin, load) in pins.iter().zip(&loads) {
            b.connect((&dut, pin.as_str()), (load, "1"));
            b.connect((load, "2"), (&gnd, "1"));
        }
        let netlist = build_netlist(&b.build(), &lib).unwrap_or_else(|e| panic!("{id}: {e:#?}"));
        let upper = reference.to_uppercase();
        assert!(
            netlist.text.lines().any(|l| {
                let first = l.split_whitespace().next().unwrap_or("").to_uppercase();
                first == upper || first == format!("X{upper}")
            }),
            "{id} has no element line:\n{}",
            netlist.text
        );
    }
}
```

- [ ] **Step 2: Run the Rust tests**

Run: `cargo test --workspace`
Expected: all pass. If `every_core_part_renders_a_netlist_line` panics with "wire … would touch …", the placement collided for that part: add the loads before the part (swap the `dut` and `loads` additions for all parts) and re-run. If it reports netlist errors for a part, that part's manifest is broken; fix the manifest.

- [ ] **Step 3: Regenerate the mock library (Git Bash)**

Run: `cargo run -q -p multysm-app --bin export_library > app/src/backend/mock-library.json`
Then: `node -e "const l=require('./app/src/backend/mock-library.json'); console.log(l.parts.length, l.categories.length, l.issues.length)"`
Expected: `35 15 0`

- [ ] **Step 4: Run the frontend tests and update the fixture-dependent expectation**

Run: `npm --prefix app test`
Expected: exactly one failure, in `CommandPalette.test.tsx` "moves through results with the arrow keys": the second part by name is now `1N4148 Switching Diode` (after `1N4007 Rectifier Diode`), not the 7400. Change that expectation to:

```tsx
    expect(editorStore.getState().tool).toEqual({ kind: "place", partId: "diodes.1n4148" });
```

(`CommandPalette` is deleted in Task 11; this keeps the suite green until then.) Any other failure is a real regression — investigate it before continuing.

Run: `npm --prefix app test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/multysm-core/tests app/src/backend/mock-library.json app/src/ui/CommandPalette.test.tsx
git commit -m "test(parts): whole-library checks and 35-part UI fixture"
```

---

### Task 8: Store — browser memory and no parts panel

**Files:**
- Modify: `app/src/model/store.ts`, `app/src/model/store.test.ts`, `app/src/test/resetEditor.ts`, `app/src/ui/useShortcuts.ts`, `app/src/ui/useShortcuts.test.ts`, `app/src/ui/AppShell.tsx`

**Interfaces:**
- Produces: `type PanelName = "properties" | "plot" | "focus"`; `interface BrowserMemory { category: Category | null; partId: string | null }`; `EditorState.browser: BrowserMemory`; `EditorState.rememberBrowser(memory: BrowserMemory): void`.

- [ ] **Step 1: Write the failing tests**

In `app/src/model/store.test.ts`, replace the test "toggles panels and updates the view without dirtying" with:

```ts
  it("toggles panels and updates the view without dirtying", () => {
    expect(s().panels).toEqual({ properties: false, plot: false, focus: false });
    s().togglePanel("plot");
    expect(s().panels.plot).toBe(true);
    s().setView(2, [10, 20]);
    expect(s().project.view).toEqual({ zoom: 2, pan: [10, 20] });
    expect(s().dirty).toBe(false);
  });

  it("remembers the component browser position without dirtying", () => {
    expect(s().browser).toEqual({ category: null, partId: null });
    s().rememberBrowser({ category: "Diodes", partId: "diodes.led" });
    expect(s().browser).toEqual({ category: "Diodes", partId: "diodes.led" });
    s().newProject();
    expect(s().browser).toEqual({ category: "Diodes", partId: "diodes.led" });
    expect(s().dirty).toBe(false);
  });
```

In `app/src/ui/useShortcuts.test.ts`, replace "toggles panels and focus mode" with:

```ts
  it("toggles the plot dock and focus mode", () => {
    press("j", { ctrl: true });
    press("F11");
    expect(s().panels).toMatchObject({ plot: true, focus: true });
  });

  it("has no Ctrl+B shortcut", () => {
    expect(press("b", { ctrl: true })).toBe(false);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix app test -- store useShortcuts`
Expected: FAIL — `panels` still has `parts`, `browser` is undefined, Ctrl+B returns true.

- [ ] **Step 3: Implement**

In `app/src/model/store.ts`:
- add `Category` to the type import from `./types`;
- change `export type PanelName = "parts" | "properties" | "plot" | "focus";` to `export type PanelName = "properties" | "plot" | "focus";`;
- below it add:

```ts
/** Last group and part shown in the component browser (session only, never saved). */
export interface BrowserMemory {
  category: Category | null;
  partId: string | null;
}
```

- in `EditorState`, add `browser: BrowserMemory;` next to `panels` and `rememberBrowser(memory: BrowserMemory): void;` next to `togglePanel`;
- in the initial state, change `panels` to `panels: { properties: false, plot: false, focus: false },` and add `browser: { category: null, partId: null },`;
- next to `togglePanel`, add `rememberBrowser: (browser) => set({ browser }),`.

In `app/src/test/resetEditor.ts`, change the `setState` call to:

```ts
  editorStore.setState({
    library: lib,
    clipboard: null,
    panels: { properties: false, plot: false, focus: false },
    browser: { category: null, partId: null },
  });
```

In `app/src/ui/useShortcuts.ts`, delete the line `case "b": s.togglePanel("parts"); return true;`.

In `app/src/ui/AppShell.tsx`, change `{!focus && panels.parts && <PartsPanel />}` to `{!focus && <PartsPanel />}` (the panel is removed entirely in Task 11).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix app test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/model app/src/test app/src/ui/useShortcuts.ts app/src/ui/useShortcuts.test.ts app/src/ui/AppShell.tsx
git commit -m "feat(app): remember the component browser position; drop the parts panel toggle"
```

---

### Task 9: SymbolPreview

**Files:**
- Create: `app/src/ui/SymbolPreview.tsx`
- Test: `app/src/ui/SymbolPreview.test.tsx`

**Interfaces:**
- Consumes: `symbolDataUrl(svg, color, width, height)` from `app/src/ui/canvas/symbolImage.ts`; `tokens` from `@/theme/tokens`; `PartDef`.
- Produces: `export function fitScale(symbolWidth: number, symbolHeight: number, boxWidth: number, boxHeight: number, margin: number): number`; `export const PIN_LABEL_MARGIN = 28`; default export `SymbolPreview({ part, width, height, showPins? }: { part: PartDef; width: number; height: number; showPins?: boolean })`. With `showPins`, the root has `data-testid="symbol-preview"` and each pin renders `data-testid="pin-<id>"` positioned at `left/top` px with a label of `pin.name ?? pin.id`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/ui/SymbolPreview.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { testLibrary } from "@/test/resetEditor";
import SymbolPreview, { fitScale, PIN_LABEL_MARGIN } from "./SymbolPreview";

const part = (id: string) => testLibrary.parts.find((p) => p.manifest.id === id)!;

describe("fitScale", () => {
  it("fits the symbol inside the box minus the margin", () => {
    expect(fitScale(60, 20, 220, 160, 28)).toBeCloseTo(164 / 60);
    expect(fitScale(20, 20, 24, 16, 0)).toBeCloseTo(16 / 20);
  });
});

describe("SymbolPreview", () => {
  it("draws the symbol as an image", () => {
    const { container } = render(<SymbolPreview part={part("basic.resistor")} width={24} height={16} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.queryByTestId("symbol-preview")).toBeNull();
  });

  it("marks and labels every pin at its scaled position", () => {
    render(<SymbolPreview part={part("basic.resistor")} width={220} height={160} showPins />);
    const scale = fitScale(60, 20, 220, 160, PIN_LABEL_MARGIN);
    const left = (220 - 60 * scale) / 2;
    const top = (160 - 20 * scale) / 2;
    const pin2 = screen.getByTestId("pin-2");
    expect(parseFloat(pin2.style.left)).toBeCloseTo(left + 60 * scale);
    expect(parseFloat(pin2.style.top)).toBeCloseTo(top + 10 * scale);
    expect(pin2).toHaveTextContent("2");
    expect(screen.getByTestId("pin-1")).toHaveTextContent("1");
  });

  it("uses pin names when the manifest has them", () => {
    render(<SymbolPreview part={part("diodes.led")} width={220} height={160} showPins />);
    expect(screen.getByTestId("pin-A")).toHaveTextContent("Anode");
    expect(screen.getByTestId("pin-K")).toHaveTextContent("Cathode");
    expect(screen.getByTestId("symbol-preview").querySelectorAll("[data-testid^='pin-']")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix app test -- SymbolPreview`
Expected: FAIL — cannot resolve `./SymbolPreview`.

- [ ] **Step 3: Implement**

Create `app/src/ui/SymbolPreview.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import type { PartDef } from "@/model/types";
import { tokens } from "@/theme/tokens";
import { symbolDataUrl } from "./canvas/symbolImage";

/** Space kept around the symbol for pin labels when pins are shown. */
export const PIN_LABEL_MARGIN = 28;

export function fitScale(symbolWidth: number, symbolHeight: number, boxWidth: number, boxHeight: number, margin: number): number {
  return Math.min((boxWidth - 2 * margin) / symbolWidth, (boxHeight - 2 * margin) / symbolHeight);
}

/** Puts a pin label outside the symbol, on the side the pin sits on. */
function labelStyle(x: number, y: number, width: number, height: number): CSSProperties {
  if (x <= 0) return { right: 5, top: -7 };
  if (x >= width) return { left: 5, top: -7 };
  if (y <= 0) return { left: 4, bottom: 2 };
  if (y >= height) return { left: 4, top: 2 };
  return { left: 5, top: -7 };
}

export default function SymbolPreview({ part, width, height, showPins = false }: {
  part: PartDef;
  width: number;
  height: number;
  showPins?: boolean;
}) {
  const { width: symbolWidth, height: symbolHeight, pins } = part.manifest.symbol;
  const scale = fitScale(symbolWidth, symbolHeight, width, height, showPins ? PIN_LABEL_MARGIN : 0);
  const drawnWidth = symbolWidth * scale;
  const drawnHeight = symbolHeight * scale;
  const left = (width - drawnWidth) / 2;
  const top = (height - drawnHeight) / 2;
  // Rasterize at 2x so the preview stays sharp on high-DPI screens.
  const src = symbolDataUrl(part.svg, tokens.text, Math.max(1, Math.round(drawnWidth * 2)), Math.max(1, Math.round(drawnHeight * 2)));

  return (
    <div className="relative shrink-0" style={{ width, height }} data-testid={showPins ? "symbol-preview" : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
      <img alt="" src={src} draggable={false} className="absolute" style={{ left, top, width: drawnWidth, height: drawnHeight }} />
      {showPins && pins.map((pin) => (
        <div
          key={pin.id}
          data-testid={`pin-${pin.id}`}
          className="absolute"
          style={{ left: left + pin.x * scale, top: top + pin.y * scale }}
        >
          <span className="absolute block h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
          <span
            className="absolute whitespace-nowrap text-[10px] leading-none text-muted"
            style={labelStyle(pin.x, pin.y, symbolWidth, symbolHeight)}
          >
            {pin.name ?? pin.id}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix app test -- SymbolPreview`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/ui/SymbolPreview.tsx app/src/ui/SymbolPreview.test.tsx
git commit -m "feat(app): symbol preview with pin markers and labels"
```

---

### Task 10: ComponentBrowser modal

**Files:**
- Create: `app/src/ui/ComponentBrowser.tsx`
- Test: `app/src/ui/ComponentBrowser.test.tsx`

**Interfaces:**
- Consumes: `useEditor`, `editorStore`, `BrowserMemory`, `rememberBrowser`, `setTool` (Task 8); `SymbolPreview` (Task 9); `filterParts(parts, query)` from `./partSearch`; `CATEGORIES`.
- Produces: default export `ComponentBrowser({ open, onClose }: { open: boolean; onClose(): void })`. Accessible structure used by tests and e2e: `role="dialog"` named "Add component"; search input placeholder "Search components…"; group buttons named `group <Category>` with `aria-pressed`; `role="listbox"` named "Parts" with `role="option"` rows (`aria-selected`); `section` named "Details"; button "Place"; button "Close".

- [ ] **Step 1: Write the failing tests**

Create `app/src/ui/ComponentBrowser.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import ComponentBrowser from "./ComponentBrowser";

const state = () => editorStore.getState();
const search = () => screen.getByPlaceholderText("Search components…");
const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent);

beforeEach(() => resetEditor());

describe("ComponentBrowser", () => {
  it("renders nothing when closed", () => {
    render(<ComponentBrowser open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows loading while the library is missing", () => {
    resetEditor(null);
    render(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getByText("Loading parts…")).toBeTruthy();
  });

  it("lists all 15 groups with counts and marks empty ones", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getAllByRole("button", { name: /^group / })).toHaveLength(15);
    expect(screen.getByRole("button", { name: "group Basic" })).toHaveTextContent("7");
    const rf = screen.getByRole("button", { name: "group RF" });
    expect(rf).toHaveTextContent("coming soon");
    expect(rf).toBeDisabled();
  });

  it("opens on the first group and highlights its first part", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "group Sources" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(optionNames()[0]).toBe("AC Current Source");
  });

  it("lists a group's parts by name and shows the highlighted part's details", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    expect(optionNames()).toEqual([
      "Capacitor", "Inductor", "Potentiometer", "Push Button", "Resistor", "SPDT Switch", "SPST Switch",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Resistor" }));
    const details = screen.getByRole("region", { name: "Details" });
    expect(within(details).getByText("Resistance")).toBeTruthy();
    expect(within(details).getByText("1k Ω")).toBeTruthy();
    expect(within(details).getByTestId("pin-1")).toBeTruthy();
    expect(within(details).getByTestId("pin-2")).toBeTruthy();
  });

  it("shows choice defaults by their label", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    fireEvent.click(screen.getByRole("option", { name: "SPST Switch" }));
    expect(within(screen.getByRole("region", { name: "Details" })).getByText("Open")).toBeTruthy();
  });

  it("searches every group and places the highlighted match on Enter", () => {
    const onClose = vi.fn();
    render(<ComponentBrowser open onClose={onClose} />);
    fireEvent.change(search(), { target: { value: "2n2222" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Transistors");
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(state().tool).toEqual({ kind: "place", partId: "transistors.2n2222" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says when nothing matches", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.getByText("No parts match")).toBeTruthy();
  });

  it("moves the highlight with the arrow keys", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    fireEvent.keyDown(search(), { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Capacitor" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Inductor" })).toHaveAttribute("aria-selected", "true");
  });

  it("places with the Place button and with a double-click", () => {
    const onClose = vi.fn();
    render(<ComponentBrowser open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    fireEvent.click(screen.getByRole("option", { name: "Inductor" }));
    fireEvent.click(screen.getByRole("button", { name: "Place" }));
    expect(state().tool).toEqual({ kind: "place", partId: "basic.inductor" });
    fireEvent.doubleClick(screen.getByRole("option", { name: "Capacitor" }));
    expect(state().tool).toEqual({ kind: "place", partId: "basic.capacitor" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape, the close button and the backdrop without placing", () => {
    const onClose = vi.fn();
    render(<ComponentBrowser open onClose={onClose} />);
    fireEvent.keyDown(search(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(state().tool).toEqual({ kind: "select" });
  });

  it("reopens on the last group and part", () => {
    const { rerender } = render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Diodes" }));
    fireEvent.click(screen.getByRole("option", { name: "LED (red)" }));
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(state().browser).toEqual({ category: "Diodes", partId: "diodes.led" });
    rerender(<ComponentBrowser open={false} onClose={() => {}} />);
    rerender(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "group Diodes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("option", { name: "LED (red)" })).toHaveAttribute("aria-selected", "true");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix app test -- ComponentBrowser`
Expected: FAIL — cannot resolve `./ComponentBrowser`.

- [ ] **Step 3: Implement**

Create `app/src/ui/ComponentBrowser.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { editorStore, useEditor } from "@/model/store";
import { CATEGORIES, type Category, type Param, type PartDef } from "@/model/types";
import { filterParts } from "./partSearch";
import SymbolPreview from "./SymbolPreview";

function defaultText(param: Param): string {
  if (param.type === "choice") {
    return param.options?.find((o) => o.value === param.default)?.label ?? param.default;
  }
  return param.unit ? `${param.default} ${param.unit}` : param.default;
}

export default function ComponentBrowser({ open, onClose }: { open: boolean; onClose(): void }) {
  const library = useEditor((s) => s.library);
  const setTool = useEditor((s) => s.setTool);
  const rememberBrowser = useEditor((s) => s.rememberBrowser);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const parts = useMemo(() => library?.parts ?? [], [library]);
  const counts = useMemo(() => {
    const byCategory = new Map<Category, number>();
    for (const part of parts) byCategory.set(part.manifest.category, (byCategory.get(part.manifest.category) ?? 0) + 1);
    return byCategory;
  }, [parts]);
  const current = category ?? CATEGORIES.find((c) => (counts.get(c) ?? 0) > 0) ?? null;
  const searching = query.trim() !== "";
  const listed = useMemo(
    () => searching ? filterParts(parts, query) : filterParts(parts.filter((p) => p.manifest.category === current), ""),
    [parts, query, searching, current],
  );
  const active = listed.find((p) => p.manifest.id === activeId) ?? listed[0];

  useEffect(() => {
    if (!open) return;
    const memory = editorStore.getState().browser;
    setQuery("");
    setCategory(memory.category);
    setActiveId(memory.partId);
  }, [open]);

  if (!open) return null;

  const close = () => {
    rememberBrowser({ category: current, partId: active?.manifest.id ?? null });
    onClose();
  };

  const choose = (part: PartDef | undefined) => {
    if (!part) return;
    rememberBrowser({ category: part.manifest.category, partId: part.manifest.id });
    setTool({ kind: "place", partId: part.manifest.id });
    onClose();
  };

  const move = (delta: number) => {
    if (listed.length === 0) return;
    const index = active ? listed.indexOf(active) : 0;
    const next = listed[Math.min(Math.max(index + delta, 0), listed.length - 1)];
    setActiveId(next.manifest.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4" onMouseDown={close}>
      <div
        role="dialog"
        aria-label="Add component"
        className="flex h-[560px] max-h-full w-[880px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          else if (e.key === "Enter") { e.preventDefault(); choose(active); }
          else if (e.key === "Escape") { e.preventDefault(); close(); }
        }}
      >
        <div className="flex items-center gap-2 border-b border-line p-2">
          <input
            autoFocus
            value={query}
            placeholder="Search components…"
            onChange={(e) => { setQuery(e.target.value); setActiveId(null); }}
            className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-text placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button aria-label="Close" onClick={close} className="rounded px-2 py-1 text-muted hover:bg-line hover:text-text">✕</button>
        </div>

        {library === null ? (
          <div className="p-4 text-muted">Loading parts…</div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <nav aria-label="Groups" className="w-48 shrink-0 overflow-y-auto border-r border-line py-1">
              {CATEGORIES.map((c) => {
                const count = counts.get(c) ?? 0;
                const selected = !searching && c === current;
                return (
                  <button
                    key={c}
                    aria-label={`group ${c}`}
                    aria-pressed={selected}
                    disabled={count === 0}
                    onClick={() => { setCategory(c); setQuery(""); setActiveId(null); }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-left ${
                      count === 0 ? "cursor-default text-muted/60" : selected ? "bg-line text-text" : "text-muted hover:text-text"
                    }`}
                  >
                    <span className="truncate">{c}</span>
                    <span className="text-[11px]">{count === 0 ? "coming soon" : count}</span>
                  </button>
                );
              })}
            </nav>

            <ul role="listbox" aria-label="Parts" className="w-64 shrink-0 overflow-y-auto border-r border-line py-1">
              {listed.map((part) => {
                const selected = part === active;
                return (
                  <li
                    key={part.manifest.id}
                    role="option"
                    aria-selected={selected}
                    onClick={() => setActiveId(part.manifest.id)}
                    onDoubleClick={() => choose(part)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1 ${selected ? "bg-line text-text" : "text-muted hover:text-text"}`}
                  >
                    <SymbolPreview part={part} width={24} height={16} />
                    <span className="min-w-0 flex-1 truncate">{part.manifest.name}</span>
                    {searching && <span className="text-[11px] text-muted">{part.manifest.category}</span>}
                  </li>
                );
              })}
              {listed.length === 0 && <li className="px-3 py-2 text-muted">No parts match</li>}
            </ul>

            <section aria-label="Details" className="flex min-w-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-4">
              {active && (
                <>
                  <SymbolPreview part={active} width={220} height={160} showPins />
                  <div className="text-center">
                    <div className="text-text">{active.manifest.name}</div>
                    <div className="text-[11px] uppercase tracking-wide text-muted">{active.manifest.category}</div>
                  </div>
                  <dl className="w-full">
                    {active.manifest.params.map((param) => (
                      <div key={param.key} className="flex justify-between gap-2 border-b border-line py-1">
                        <dt className="text-muted">{param.label}</dt>
                        <dd className="text-text">{defaultText(param)}</dd>
                      </div>
                    ))}
                  </dl>
                  <button onClick={() => choose(active)} className="mt-auto rounded bg-accent px-4 py-1 font-semibold text-bg">
                    Place
                  </button>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix app test -- ComponentBrowser`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/ui/ComponentBrowser.tsx app/src/ui/ComponentBrowser.test.tsx
git commit -m "feat(app): component browser modal with groups, symbols and details"
```

---

### Task 11: Wire the browser into the app

**Files:**
- Modify: `app/src/ui/AppShell.tsx`, `app/src/ui/TopBar.tsx`, `app/src/ui/FocusToolbar.tsx`, `app/src/ui/useShortcuts.ts`, `app/src/ui/useShortcuts.test.ts`
- Delete: `app/src/ui/PartsPanel.tsx`, `app/src/ui/PartsPanel.test.tsx`, `app/src/ui/CommandPalette.tsx`, `app/src/ui/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `ComponentBrowser` (Task 10).
- Produces: `ShortcutActions.openComponents(): void` (renamed from `openPalette`); `TopBar({ onOpenComponents, files })`; `FocusToolbar({ onOpenComponents })`; a top-bar button with accessible name "Components".

- [ ] **Step 1: Update the shortcut test (failing)**

In `app/src/ui/useShortcuts.test.ts`, rename every `openPalette` to `openComponents` (the `actions` object and the Ctrl+K/P test), and rename that test to `"opens the component browser with Ctrl+K and P"`.

Run: `npm --prefix app test -- useShortcuts`
Expected: FAIL — `actions.openComponents` is never called.

- [ ] **Step 2: Rename the action**

In `app/src/ui/useShortcuts.ts`, rename `openPalette(): void;` to `openComponents(): void;` in `ShortcutActions`, and both `actions.openPalette()` calls (the `"k"` and `"p"` cases) to `actions.openComponents()`.

Run: `npm --prefix app test -- useShortcuts`
Expected: PASS.

- [ ] **Step 3: Replace the panel and palette in the shell**

In `app/src/ui/TopBar.tsx`, rename the prop `onOpenPalette` to `onOpenComponents` (signature `{ onOpenComponents(): void; files: FileActions | null }`) and replace the "Add part" button with:

```tsx
      <button className={barButton} onClick={onOpenComponents} title="Components (Ctrl+K)" aria-label="Components">
        <span className="mr-1 text-accent">＋</span>Components
      </button>
```

In `app/src/ui/FocusToolbar.tsx`, rename the prop to `onOpenComponents` and replace the "Add part" button with:

```tsx
      <button className={button} onClick={onOpenComponents} title="Components (Ctrl+K)" aria-label="Components">＋ Components</button>
```

In `app/src/ui/AppShell.tsx`:
- remove the imports of `CommandPalette` and `PartsPanel`; add `import ComponentBrowser from "./ComponentBrowser";`;
- rename `const [paletteOpen, setPaletteOpen] = useState(false);` to `const [browserOpen, setBrowserOpen] = useState(false);`;
- rename `const openPalette = () => setPaletteOpen(true);` to `const openComponents = () => setBrowserOpen(true);` and pass `openComponents` to `useShortcuts`, `TopBar` (`onOpenComponents={openComponents}`) and `FocusToolbar` (`onOpenComponents={openComponents}`);
- delete the line `{!focus && <PartsPanel />}`;
- replace `<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />` with `<ComponentBrowser open={browserOpen} onClose={() => setBrowserOpen(false)} />`.

Delete the old components:

```bash
git rm app/src/ui/PartsPanel.tsx app/src/ui/PartsPanel.test.tsx app/src/ui/CommandPalette.tsx app/src/ui/CommandPalette.test.tsx
```

- [ ] **Step 4: Check nothing else references them**

Run: `grep -rn "PartsPanel\|CommandPalette\|openPalette\|onOpenPalette" app/src`
Expected: no output.

- [ ] **Step 5: Run the unit tests and the production build**

Run: `npm --prefix app test && npm --prefix app run build`
Expected: all tests pass; the build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui
git commit -m "feat(app): open the component browser from the top bar, Ctrl+K and P; remove the parts panel and palette"
```

---

### Task 12: End-to-end tests, checklist and full run

**Files:**
- Modify: `app/e2e/editor.spec.ts`, `docs/desktop-checklist.md`

**Interfaces:**
- Consumes: the browser's accessible names (Task 10) and the "Components" button (Task 11).

- [ ] **Step 1: Update the Playwright tests**

In `app/e2e/editor.spec.ts`:

Replace `placeViaPalette` with:

```ts
async function placeViaBrowser(page: Page, query: string, at: World) {
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search components…").fill(query);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Add component" })).toBeHidden();
  await clickWorld(page, at);
}
```

and rename every `placeViaPalette(` call to `placeViaBrowser(`. In the save/reopen test, change the query `"led"` to `"led (red)"`.

Replace `beforeEach` with:

```ts
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Components" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() =>
      (window as unknown as { __multysm: { getState(): { library: unknown } } }).__multysm.getState().library !== null))
    .toBe(true);
});
```

Replace the layout test with:

```ts
test("shows the soft-dark layout", async ({ page }) => {
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(27, 29, 35)");
  await expect(page.getByRole("button", { name: "▶ Run" })).toBeDisabled();
  await page.getByRole("button", { name: "Components" }).click();
  const dialog = page.getByRole("dialog", { name: "Add component" });
  await expect(dialog.getByRole("button", { name: /^group / })).toHaveCount(15);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
```

Replace the focus-mode test with:

```ts
test("focus mode hides and restores the panels", async ({ page }) => {
  await page.keyboard.press("F11");
  await expect(page.getByRole("button", { name: "Save" })).toBeHidden();
  await page.getByRole("button", { name: "Exit focus" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
});
```

Add a new test:

```ts
test("browses groups and places a transistor", async ({ page }) => {
  await page.getByRole("button", { name: "Components" }).click();
  const dialog = page.getByRole("dialog", { name: "Add component" });
  await dialog.getByRole("button", { name: "group Transistors" }).click();
  await dialog.getByRole("option", { name: /NPN Transistor 2N2222/ }).click();
  const preview = dialog.getByTestId("symbol-preview");
  await expect(preview.getByTestId("pin-B")).toHaveText("B");
  await expect(preview.getByTestId("pin-C")).toHaveText("C");
  await expect(preview.getByTestId("pin-E")).toHaveText("E");
  await dialog.getByRole("button", { name: "Place" }).click();
  await expect(dialog).toBeHidden();
  await clickWorld(page, [300, 300]);
  const { project } = await editor(page);
  expect(project.components).toHaveLength(1);
  expect(project.components[0]).toMatchObject({ part: "transistors.2n2222", ref: "Q1" });
});
```

- [ ] **Step 2: Run the end-to-end tests**

Run: `npm --prefix app run e2e`
Expected: 8 passed. A failure means a real UI bug: debug with `npx --prefix app playwright test --headed` and fix the app code; don't weaken the test.

- [ ] **Step 3: Update the desktop checklist**

In `docs/desktop-checklist.md`, replace items 2 and 3 with:

```markdown
2. "＋ Components" opens the Add component browser: 15 groups, 9 of them with parts; selecting a part shows its symbol with pin labels.
3. Ctrl+K → type `555` → Enter → click: the 555 symbol appears with the label `U1`.
```

- [ ] **Step 4: Run everything**

Run: `cargo test --workspace && npm --prefix app test && npm --prefix app run build && npm --prefix app run e2e`
Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add app/e2e/editor.spec.ts docs/desktop-checklist.md
git commit -m "test(app): end-to-end component browser flow and updated desktop checklist"
```

---

## Not in this plan

- Flipping switches or pressing buttons during a run (live mode, phase 2).
- Meter readouts on the canvas and probes feeding the plot dock (the simulation UI plan).
- Parts for Advanced Peripherals, Misc Digital, Power, Misc, RF and Electromechanical.
- `.mspack` import and the Library Manager.
