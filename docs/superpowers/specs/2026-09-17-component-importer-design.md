# Component importer: SPICE models and KiCad symbols — design

Date: 2026-09-17. Builds on branch `plan-4-simulation-run` and the product spec
`2026-09-15-multysm-design.md` (§4.2 manifest, §4.4 packs, §4.5 sources of models and symbols).

## 1. Goal and scope

Let users grow the component library themselves, inside the app, from the SPICE model files that
chip makers publish and from KiCad symbol libraries. Multisim's database is proprietary and is not
used (spec §4.5). Vendor models are user-imported into the user's own data folder and never shipped.

In scope:
1. User packs folder, loaded next to `components/core` by both the library and the simulator (§2).
2. SPICE importer: `.model` and `.subckt` definitions become parts (§3).
3. KiCad `.kicad_sym` importer: real symbols, matched to models, with a pin-mapping fallback (§4).
4. Import dialog, manage/remove imports (§5).

Out of scope: bundling imported models into `.msym` project files; `.mspack` zip install and the
full Library Manager (enable/disable, versions, dependencies); editing imported parts after import;
behavioral verification of models beyond "loads in ngspice"; LTspice `.asy` symbols.

Delivery: one spec, two plans, each usable on its own.
- **Plan 5a:** §2, §3, generic and built-in symbols (§4.4), smoke test (§3.6), dialog without
  KiCad files (§5), manage/remove.
- **Plan 5b:** KiCad reader, SVG conversion, matching and the pin-mapping UI (§4.1–§4.3, §5.2 pin table).

## 2. Storage and loading

### 2.1 Layout
Each import is one user pack:

```
<app data dir>/packs/                 (%APPDATA%/multysm/packs on Windows)
  imported-ti-opamps/                 one folder per import, named from the first source file
    pack.json
    components/Analog/lm358.json
    symbols/lm358.svg
    models/lm358.lib
```

`pack.json`: `{ "id", "name", "origin": "import", "sources": [file names], "importedAt": Unix seconds,
"parts": [{ "id", "modelName" }] }`. Pack ids are `imported-<slug>`; a clash appends `-2`, `-3`, …

### 2.2 Loading
- A new `library_roots(app)` returns `components/core` followed by every directory in `packs/` that
  contains a `pack.json`. `load_library` (command) and `simulate` both use it.
- `SimShared::with_library` takes the root list; its cache stamp is the newest mtime across all
  roots and the `packs/` directory itself, so imports and removals are picked up without restarting.
- The loader already rejects a duplicate part id across roots (first root wins, issue reported);
  core is loaded first.

### 2.3 Ids
Imported part ids: `imported.<pack slug with _>.<model name slug>`, e.g.
`imported.ti_opamps.lm358`, matching the manifest id pattern `^[a-z0-9]+(\.[a-z0-9_]+)+$`. Slugs
lower-case the name and map every other character to `_`. The prefix `imported` is reserved and never
used by core parts. A candidate whose model name already exists in an earlier import is marked
`already_imported`; if ticked, the new pack's part is written and the old pack's copy is removed from
that pack (the old pack folder is deleted when it becomes empty).

### 2.4 Removal
"Manage imports" lists packs (name, sources, date, part count) with Remove, which deletes the folder
and reloads the library. Projects using a removed part show the existing unknown-part error on those
parts; nothing else changes.

## 3. SPICE import

### 3.1 Reading
- Accepted extensions: `.lib .mod .cir .sub .spice .txt`. Maximum 20 MB per file.
- Decode as UTF-8, falling back to Latin-1.
- Join `+` continuation lines. Remove `*` comment lines and inline `;` and `$` comments, but keep the
  comment block directly above each definition for the description and pin hints.
- Directives are matched case-insensitively.

### 3.2 Definitions collected
- `.model NAME TYPE(params)` and `.model NAME TYPE params`.
- `.subckt NAME port… [PARAMS: k=v …]` … `.ends [NAME]`, including nested `.model` lines. Nested
  `.subckt` blocks are rejected as `unsupported`.
- Element lines inside a subcircuit that reference other definitions: `X… NAME` (subcircuit) and
  device lines whose model name is a `.model` in the file (D, Q, M, J).
- First definition of a name wins; later duplicates add a file warning.

### 3.3 Candidates

| Definition | Kind | Pins (id, name) | Template | Ref prefix |
|---|---|---|---|---|
| `.model X D` | diode | A Anode, K Cathode | `{ref} {pin.A} {pin.K} X` | D |
| `NPN`, `PNP` | bjt | C, B, E | `{ref} {pin.C} {pin.B} {pin.E} X` | Q |
| `NMOS`, `PMOS` | mosfet | D, G, S | `{ref} {pin.D} {pin.G} {pin.S} {pin.S} X` | M |
| `VDMOS` | mosfet | D, G, S | `{ref} {pin.D} {pin.G} {pin.S} X` | M |
| `NJF`, `PJF` | jfet | D, G, S | `{ref} {pin.D} {pin.G} {pin.S} X` | J |
| `.subckt X p1 … pn` | subckt | ids `1`…`n`, names = port names | `X{ref} {pin.1} … {pin.n} X` | U |

Other `.model` types become `unsupported` candidates ("R/C/SW/… models are not importable").
`PARAMS:` defaults become `si` params (`key` = lower-cased slug, `label` = original name, `default` =
original value); the template appends `PARAMS: NAME={key} …`.

A subcircuit referenced by another subcircuit in the same file is a helper: it is listed but
unticked by default.

### 3.4 Model file per part
Each part's `models/<part slug>.lib` holds its own definition plus the transitive closure of the
definitions it references, dependencies first. The manifest points at it with `spice.subckt` (the
netlist builder inlines that file once per netlist, whatever the device kind). Simulations therefore
only parse what a circuit uses.

### 3.5 Rejections (per candidate, with a message)
- `unsafe`: the part's model text fails `check_spice_text`.
- `missing_dependency`: a referenced name is not defined in any of the files being imported.
- `unsupported`: see §3.2 and §3.3.
- `.include` / `.lib` lines are never followed. They add a file warning suggesting the user import
  the named file together with this one.

### 3.6 Dialect and smoke test
- The engine sends `set ngbehavior=psa` before loading each circuit, so PSpice/LTspice-style models
  load. The existing `crates/multysm-core/tests/circuits.rs` and starter pack tests must still pass.
  If they don't, the setting is applied only to netlists containing parts whose id starts with
  `imported.`.
- On commit, each ticked part gets an operating-point run: one instance with every pin to ground
  through 1 MΩ, plus a 1 V source through 1 kΩ on its first pin, 5 s timeout. If ngspice rejects the
  circuit while loading it, the part becomes `failed` with the log and is not written. Convergence
  failures and timeouts under this artificial bias count as a pass. The test checks loading, not
  correct behavior.

## 4. KiCad symbols (Plan 5b)

### 4.1 Reading `.kicad_sym` (KiCad 6–9)
- An S-expression reader. The library holds `(symbol "NAME" …)` entries with `property`, graphics
  in sub-symbols `NAME_<unit>_<style>`, and `pin` entries.
- `extends`: the derived symbol takes the parent's graphics and pins, with its own properties.
- Units: every unit ≥ 1 with style 0 or 1 is drawn, laid out left to right with a 20 px gap; unit 0
  (common) graphics are drawn in every unit. Style 2 (De Morgan) is skipped.
- Pins: `hide` pins, including power pins, become visible pins. `no_connect` pins are `optional`.
  Pin id = pin number (sanitized to `^[A-Za-z0-9_+-]+$`), pin name = pin name unless `~`.

### 4.2 Geometry and SVG
- Scale 10 px per 2.54 mm; flip y. The symbol box is the bounding box of graphics and pin tips,
  expanded to multiples of 10 px, with pin tips snapped to the 10 px grid. A pin moved more than
  1 px by snapping adds a warning.
- Rectangles, polylines, circles, arcs (start/mid/end → SVG arc through three points), béziers, pin
  lines (from `at` along the pin rotation for `length`), and 6 px text for pin numbers and names
  (when the symbol shows them).
- `stroke="currentColor"`. Fill `outline` → `currentColor`; `background` and `none` → no fill.

### 4.3 Matching symbol → model, in order
1. `Sim.Name` (with optional `Sim.Library` file name) and `Sim.Pins` (`<pin number>=<port>` pairs).
   KiCad 6 fields `Spice_Model` and `Spice_Node_Sequence` are read the same way.
2. Name: the symbol name or `Value` against model names, from the files being imported and from
   existing imports. Comparison is case-insensitive and ignores these suffixes: `-SMD`, `/NOPB`,
   `-Q1`, a trailing package code after `_`, and whitespace.
3. Pin mapping: port count = pin count and all ports numeric → by number. Otherwise normalized names
   (upper case, strip spaces/underscores; `IN+`=`+IN`=`INP`=`NONINV`, `IN-`=`-IN`=`INN`=`INV`,
   `V+`=`VCC`=`VDD`, `V-`=`VEE`=`VSS`=`GND`, `OUT`=`OUTPUT`).
4. Any model port still unmapped → `needs_pins`. The user completes the mapping in the dialog, and
   import is blocked until every port has a pin. Extra symbol pins with no port are dropped from the
   part.

A symbol with no model → `no_model`, not importable. A model with no symbol keeps its §4.4 symbol.

### 4.4 Symbols without KiCad (Plan 5a)
- diode, bjt, mosfet, jfet: copy the matching core SVG (`diode`, `npn`/`pnp`, `nmos`, and new
  `pmos`/`njf`/`pjf` symbols added to core) into the pack, with the core pin positions.
- subckt: a generated box. Ports alternate left/right in order (odd ports left, even right), 20 px
  apart, box width 80 px (wider when names need it), part name centred, 6 px port names inside the
  box.

## 5. Commands and UI

### 5.1 Commands (`src-tauri`, logic in `multysm-core::import`)
- File picking uses `@tauri-apps/plugin-dialog` `open({ multiple: true })` from the frontend (no command).
- `preview_import(paths) -> ImportPreview`:
  `{ previewId, files: [{ path, warnings, error? }], candidates: [{ key, id, name, kind, category,
  source, refPrefix, pins, svg, mapping?: { ports, pins, pairs }, status, messages, selected }] }`.
  No writes, no simulation. The parsed preview is kept in Tauri state under `previewId` (the latest
  one only).
- `commit_import(previewId, choices: [{ key, selected, category, pairs? }]) -> ImportReport`: builds
  the pack in `packs/.tmp-<id>/`, smoke-tests each part (§3.6), deletes failures, writes
  `pack.json`, renames into place. Progress events: `import-progress { done, total }`. Cancel with
  `cancel_import()`: parts already tested are kept. Report: `{ packId, imported: [id], failed:
  [{ key, message, log }], skipped: [key] }`.
- `list_imports() -> [pack.json]`, `remove_import(packId)`.
- `Backend` gains the same methods. The mock backend returns a fixed preview (an op-amp subcircuit,
  a diode model, one unsupported model, one `needs_pins` candidate) and simulates success.

### 5.2 Dialog
1. Component browser: "Import parts…" → file picker → preview dialog.
2. Preview: search box, "Select all ready"; a row per candidate with tick box, symbol thumbnail,
   name, kind, category dropdown (15 categories, §5.3 guess preselected) and status tag. Non-ready
   rows cannot be ticked, except `needs_pins` once mapped and `already_imported`. File warnings are
   shown above the table.
3. Row details: pins list; for `needs_pins`, a table of model port → symbol pin dropdowns (Plan 5b).
4. "Import N parts" → progress "Testing 37/120…" with Cancel → report (imported count, failures with
   Show log). The library reloads, and imported parts show an "Imported" badge in the browser.
5. "Manage imports" in the browser: list with Remove.

### 5.3 Category guess
Model type first: D → Diodes; NPN/PNP/NMOS/PMOS/VDMOS/NJF/PJF → Transistors. Subcircuits by name,
then description:
- `^(SN)?74[A-Z]*\d+` → TTL
- `^(CD|MC14)?40\d\d` → CMOS
- op-amp/opamp/comparator/`^(LM|TL|OPA|AD|LT|MC)\d` → Analog
- regulator/LDO/`^(LM78|LM79|LM317|LM337|78|79)` → Power
- `555` → Mixed
- otherwise → Misc.

### 5.4 Errors
- A file that is unreadable, too large or unparseable becomes a file error. The other files continue.
- A disk write failure during commit aborts the commit, deletes the temp folder and reports the
  error; no partial pack is left.
- A hand-edited pack that no longer validates shows in the existing library issues list.

## 6. Testing
- Rust unit (`multysm-core::import`):
  - SPICE reader: continuations, comments, `PARAMS:`, dependency closure, duplicates, unsafe text,
    `.include` warning, helper detection.
  - Candidate table (§3.3) and category guess.
  - KiCad reader: extends, multi-unit layout, hidden and `no_connect` pins, arc conversion, grid
    snapping.
  - Matching rules (§4.3).
- Fixtures in `crates/multysm-core/tests/fixtures/import/`: a PSpice op-amp macromodel with
  `PARAMS:` and helper subcircuits, a discrete `.model` collection, and a `.kicad_sym` excerpt with a
  multi-unit op-amp and an `extends` entry. Each is written for the tests or taken from a source whose
  license allows it.
- Rust integration: preview + commit the fixtures into a temp packs dir, load the library with
  core + packs, build an inverting amplifier with the imported op-amp, and simulate with real ngspice.
  Also run removal and reload.
- Vitest: dialog states (ticking rules, category edit, `needs_pins` blocking, report view), backend
  method wiring.
- Playwright (mock): import → part appears with badge → place it on the canvas.
