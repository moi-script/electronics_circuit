# Component browser and v1 starter pack — design

Date: 2026-09-16. Builds on the desktop editor (Plan 2, merged to `main` at `98fbfb0`) and the
product spec `2026-09-15-multysm-design.md` (§4.6 starter pack, §5 UI).

## 1. Goal

1. Replace the left Parts panel and the Ctrl+K command palette with a single **Add component**
   modal, opened from a **＋ Components** button in the top bar. The modal lists every part grouped
   by category and shows the selected part's symbol.
2. Fill the v1 starter pack: add the 26 parts from spec §4.6 that are not in `components/core`
   yet, plus an AC current source (8 → 35 manifests), each with a hand-drawn symbol and a SPICE
   model verified in ngspice.

## 2. UI: the Add component modal

### 2.1 Entry points
- Top bar: the text button "Add part" becomes **＋ Components** (plus icon + label, tooltip
  "Components (Ctrl+K)").
- Shortcuts: **Ctrl+K** and **P** open the modal (both exist today and opened the palette).
- **Ctrl+B** (toggle parts panel) is removed, along with the `parts` entry of the store's panel
  visibility state. Focus mode (F11) keeps hiding the Properties panel and plot dock.

### 2.2 Layout
Centred dialog, about 880×560 px (shrinks to fit smaller windows), over a dimmed backdrop,
`role="dialog"` with `aria-label="Add component"`.

```
┌ Add component ─────────────────────────────────── [✕] ┐
│ [Search…                                            ] │
│ Groups        │ Parts             │ Details           │
│  Sources   5  │  ▫ Resistor       │  ┌─────────────┐  │
│ ▸Basic     7  │ ▸▫ Capacitor      │  │  large      │  │
│  Diodes    4  │  ▫ Inductor       │  │  symbol     │  │
│  …            │  …                │  └─────────────┘  │
│  RF  coming soon                  │  Capacitor · Basic│
│               │                   │  Capacitance: 1µ  │
│               │                   │       [Place]     │
└───────────────┴───────────────────┴───────────────────┘
```

- **Search** (top, autofocused). Empty query: the three-column browse view. Non-empty query: the
  Groups column stays, the Parts column shows matches from all groups (via the existing
  `filterParts`) with the group name as a muted suffix, and "No parts match" when empty.
- **Groups**: all 15 categories in `CATEGORIES` order, each with its part count. Categories with no
  parts are disabled and show "coming soon".
- **Parts**: the parts of the selected group, each row a 24×16 symbol thumbnail plus name.
- **Details**: the highlighted part's symbol drawn large (fit into ~220×160) with a dot at each pin
  and its pin name (or id when unnamed); the part name and group; the default value of each
  parameter as "Label: default unit"; a **Place** button.

### 2.3 Behaviour
- Clicking a part highlights it. **Place**, **Enter**, or **double-click** sets the tool to
  `{ kind: "place", partId }` and closes the modal. The existing place flow on the canvas is unchanged.
- **↑/↓** move the highlight in the Parts column; **Esc**, **✕**, or a backdrop click close without
  placing.
- The modal remembers the last group and highlighted part for the session (component state held in
  the store, not persisted). The search query resets on each open.
- While the library is loading, the modal shows "Loading parts…".

### 2.4 Code
- New `app/src/ui/ComponentBrowser.tsx` (the modal) and `app/src/ui/SymbolPreview.tsx` (renders
  a part's SVG via `symbolDataUrl` plus absolutely positioned pin markers and labels, scaled to a box).
- `AppShell.tsx` renders `ComponentBrowser` instead of `PartsPanel` and `CommandPalette`; the canvas
  takes the freed width.
- Deleted: `PartsPanel.tsx`, `PartsPanel.test.tsx`, `CommandPalette.tsx`, `CommandPalette.test.tsx`.
  Their test cases (grouping, empty categories, search, keyboard selection) move to
  `ComponentBrowser.test.tsx`.

## 3. Manifest format changes

### 3.1 `choice` parameters
Switch state is a pick, not a number. New param type:

```json
{ "key": "closed", "label": "State", "type": "choice", "default": "0",
  "options": [{ "label": "Open", "value": "0" }, { "label": "Closed", "value": "1" }] }
```

- Rust `manifest.rs`: `ParamKind::Choice` and `Param.options: Vec<ChoiceOption>` (empty for other
  kinds). The loader reports an issue when a choice param has no options, when its default is not
  one of the option values, or when an option value fails `is_valid_text_param`.
- `netlist/build.rs`: a choice value that is not one of the option values is an `InvalidParam`
  error ("{ref}: {label} '{raw}' is not one of the options"); otherwise the value is inserted as-is.
- `schemas/manifest.schema.json`: `"choice"` in the type enum and an `options` array
  (required when type is `choice`).
- `app/src/model/types.ts`: `type: "si" | "text" | "choice"`, `options?: {label: string; value: string}[]`.
- `PropertiesPanel.tsx`: choice params render as a `<select>`; changes go through the same store
  action as other params (one undo step).

### 3.2 Computed values live in subcircuits
Templates only substitute placeholders, and `{…}` is the placeholder syntax, so templates cannot
hold ngspice brace expressions. Parts that need arithmetic pass parameters into a shipped
subcircuit, which does the math itself:

```
X{ref} {pin.1} {pin.w} {pin.2} POT PARAMS: R={resistance} P={position}
```

`pot.lib` then uses `R1 a w {max(R*P,1m)}` and `R2 w b {max(R*(1-P),1m)}`. The template engine
and the SPICE content policy need no changes; a library test confirms a template with `PARAMS:`
and a `.lib` with brace expressions both load without issues.

## 4. New parts

Symbols: hand-drawn SVG in `components/core/symbols/`, `stroke="currentColor"`,
`stroke-width="1.5"`, no fill colours, pins on a 10 px grid at the symbol edge, matching the
existing symbols. Models: `components/core/models/`. Part ids follow `<group>.<name>`.

| Group | Part (id) | Pins | Params (default) | SPICE |
|---|---|---|---|---|
| Sources | DC current (`sources.dc_current`) | p, n | current (1m A) | `{ref} {pin.p} {pin.n} DC {current}` (ref prefix I) |
| Sources | AC voltage (`sources.ac_voltage`) | p, n | amplitude (1 V), frequency (1k Hz), offset (0 V) | `{ref} p n SIN({offset} {amplitude} {frequency}) AC {amplitude}` |
| Sources | AC current (`sources.ac_current`) | p, n | amplitude (1m A), frequency (1k Hz), offset (0 A) | `{ref} p n SIN(…) AC {amplitude}` |
| Sources | VCC rail (`sources.vcc`) | 1 | voltage (5 V) | `{ref} {pin.1} 0 DC {voltage}` (ref prefix V) |
| Basic | Inductor (`basic.inductor`) | 1, 2 | inductance (1m H) | `{ref} 1 2 {inductance}` |
| Basic | Potentiometer (`basic.potentiometer`) | 1, w, 2 | resistance (10k Ω), position (0.5) | subckt `POT` (§3.2) |
| Basic | SPST switch (`basic.spst`) | 1, 2 | State: Open/Closed (Open) | subckt `SW_SPST PARAMS: C={closed}`; `R 1 2 {C > 0.5 ? 1m : 1e12}` |
| Basic | SPDT switch (`basic.spdt`) | c, a, b | Position: A/B (A) | subckt `SW_SPDT PARAMS: S={pos}`; c–a closed when S=0, c–b when S=1 |
| Basic | Push button (`basic.push_button`) | 1, 2 | State: Released/Pressed (Released) | subckt `SW_SPST` |
| Diodes | 1N4148 (`diodes.1n4148`) | A, K | — | `D` + published `.model D1N4148` |
| Diodes | 1N4007 (`diodes.1n4007`) | A, K | — | `D` + published `.model D1N4007` |
| Diodes | Zener 1N4733A 5.1 V (`diodes.zener_5v1`) | A, K | — | `D` + `.model` with `BV=5.1 IBV=…` |
| Transistors | NPN 2N2222 (`transistors.2n2222`) | C, B, E | — | `Q` + published `.model Q2N2222 NPN(…)` |
| Transistors | PNP 2N2907 (`transistors.2n2907`) | C, B, E | — | `Q` + published `.model Q2N2907 PNP(…)` |
| Transistors | N-MOSFET 2N7000 (`transistors.2n7000`) | D, G, S | — | `M {D} {G} {S} {S}` + published `.model` |
| Analog | Ideal op-amp (`analog.opamp_ideal`) | in+, in−, out, V+, V− | — | subckt `OPAMP_IDEAL`: gain 1e5, Rin 1e12, Rout 1, output limited to the supply pins |
| Analog | LM741 (`analog.lm741`) | in+, in−, out, V+, V− | — | subckt `LM741` behavioural macromodel (finite gain/GBW, rail clamping) |
| TTL | 7404 hex inverter (`ttl.7404`) | DIP-14 | — | XSPICE subckt `SN7404`, same bridge models as `sn7400.lib` |
| TTL | 7408 quad AND (`ttl.7408`) | DIP-14 | — | XSPICE subckt `SN7408` |
| TTL | 7432 quad OR (`ttl.7432`) | DIP-14 | — | XSPICE subckt `SN7432` |
| CMOS | 4011 quad NAND (`cmos.4011`) | DIP-14 | — | XSPICE subckt `CD4011`; bridge thresholds for 5 V operation |
| CMOS | 4017 decade counter (`cmos.4017`) | DIP-16 (Q0–Q9, CLK, INH, RST, CO, VDD, VSS) | — | XSPICE subckt `CD4017`: 5 `d_dff` Johnson counter + gate decoding |
| Indicators | Voltmeter (`indicators.voltmeter`) | +, − | — | `R{…} + − 10Meg` (ref prefix VM → rendered as `R` element; see §4.1) |
| Indicators | Ammeter (`indicators.ammeter`) | +, − | — | `V{…} + − DC 0` |
| Indicators | Probe (`indicators.probe`) | 1 | — | `R{…} {pin.1} 0 1e12` |
| Indicators | Logic probe (`indicators.logic_probe`) | 1 | — | `R{…} {pin.1} 0 1e12` |
| Indicators | 7-segment, common cathode (`indicators.seven_segment`) | a–g, dp, K | — | subckt `SEG7_CC`: 8 LEDs to K |

The table has 27 new parts: the 26 missing from spec §4.6 plus the AC current source (not in
§4.6, added because it is the AC voltage source's pair). With the 8 existing manifests (ground,
DC voltage, pulse, resistor, capacitor, LED, 555, 7400) the library has **35 manifests** in 9
groups.

New symbols needed: `dc_current`, `ac_voltage`, `ac_current`, `vcc`, `inductor`,
`potentiometer`, `spst`, `spdt`, `push_button`, `diode`, `zener`, `npn`, `pnp`, `nmos`, `opamp`,
`dip16`, `voltmeter`, `ammeter`, `probe`, `logic_probe`, `seven_segment`. The two general-purpose
diodes share `diode.svg`; 7404/7408/7432/4011 share `dip14.svg`.

Model sources: published model lines for the discrete devices are taken from vendor datasheets or
the ngspice/KiCad-Spice-Library collections, only where the licence permits redistribution; the
source is recorded in a comment at the top of each `.lib` or next to the `.model` line. The LM741
is written from scratch as a behavioural macromodel, not copied.

### 4.1 Reference prefixes
Reference designators come from `refPrefix`; the SPICE element letter comes from the template.
Meters and probes use `refPrefix` values `VM`, `AM`, `PR`, `LP` and templates that start with the
right element letter (e.g. `R{ref} …` renders `RVM1`). Parts with a `U` prefix (ICs, op-amps,
7-segment) use `X{ref}`, like the 7400 and 555 today.

## 5. Testing

Rust (`cargo test --workspace`):
- `core_library_loads_cleanly`: expected part count updated; zero issues.
- Library tests for `choice`: valid load; missing options, bad default, and unsafe option value
  each become an issue. Netlist test: a choice value outside the options is `InvalidParam`.
- A test that every core part renders a netlist line: place one instance with every pin on its own
  net plus a ground, build, and assert no errors.
- ngspice circuit tests in `crates/multysm-core/tests/circuits.rs`, one per family:
  - 1N4148 forward drop at 1 mA is 0.55–0.75 V; the Zener holds 4.9–5.3 V in reverse at 5 mA.
  - 2N2222 switch: 5 V through 1k into the base with a 1k collector load, V(CE) < 0.3 V; with the
    base grounded, V(CE) > 4.9 V. 2N2907 and 2N7000 have equivalent on/off checks.
  - Ideal op-amp inverting amplifier (10k/1k, ±12 V): 0.1 V in gives −1.0 V ±1 %. LM741 in the
    same circuit gives −1.0 V ±5 %, and its output stays within the supplies when overdriven.
  - Truth tables for 7404, 7408, 7432 and 4011 (as the existing NAND test).
  - 4017: after reset, successive clock edges move the high output Q0 → Q1 → Q2.
  - SPST open vs closed, SPDT A vs B, potentiometer at 0.5 halves the voltage.
  - Ammeter current on a 5 V / 1k loop is 5 mA ±1 %. 7-seg segment `a` conducts through 330 Ω.
  - DC current source into 1k gives 1 V; AC voltage source `.tran` peak equals the amplitude.
- `app/src/backend/mock-library.json` regenerated from the real loader so frontend tests see the
  full library.

Frontend (`npm --prefix app test`):
- `ComponentBrowser.test.tsx`: groups with counts and "coming soon"; selecting a group lists its
  parts; highlighting a part shows its details and pin labels; search across groups; ↑/↓ and
  Enter place; Esc closes without placing; reopening keeps the last group and part.
- `SymbolPreview.test.tsx`: one marker and label per pin, positioned by the scale factor.
- `PropertiesPanel.test.tsx`: a choice param renders a select and updates the store.
- `useShortcuts.test.ts`: Ctrl+K and P open the browser; Ctrl+B does nothing.

End-to-end (`npm --prefix app run e2e`): existing tests that used the side panel or palette go
through the modal; one new test opens ＋ Components, picks Transistors → 2N2222, sees its pins in
the preview, places it, and sees `Q1` on the canvas.

## 6. Desktop checklist updates
- Item 2 → "＋ Components opens the browser; 9 groups have parts; selecting a part shows its
  symbol with pin labels."
- Item 3 → "Ctrl+K → type `555` → Enter → click: the 555 symbol appears with the label `U1`."

## 7. Out of scope
- Toggling switches or buttons during a run (live mode, phase 2).
- Meter readouts on the canvas and probes feeding the plot dock (Plan 3 simulation UI). Until then,
  meters and probes only contribute their netlist elements.
- Parts for Advanced Peripherals, Misc Digital, Power, Misc, RF, Electromechanical.
- `.mspack` import and the Library Manager.
