# multysm — Design Spec

**Date:** 2026-09-15
**Status:** Approved in brainstorming, pending written-spec review

## 1. Purpose

A modern, calm replacement for NI Multisim aimed at **students and makers**. The current tool is dated, visually straining, and shows far more information than most users need. multysm keeps the core workflow (draw a schematic, simulate, read the result) and removes the clutter.

**Hard requirements**
- Mixed-signal simulation: analog parts and digital logic (TTL, CMOS, 555) working together in one circuit.
- A component system that is data-driven, so new parts and downloadable packs can be added without code changes.
- One soft-dark theme; no light mode.
- Desktop app first; web version later, reusing the same UI.

**Non-goals (for now)**
- PCB layout, professional features (Monte Carlo, large vendor model sets shipped in-box), accounts/cloud sync.

## 2. Technology

| Concern | Choice |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend | Next.js (static export), TypeScript |
| Schematic canvas | react-konva |
| Plots | uPlot |
| State | Zustand (with undo/redo history) |
| UI styling | Tailwind CSS + shadcn/ui, restyled to the soft-dark tokens |
| Backend | Rust: `crates/multysm-core` (simulation core) + thin `src-tauri` shell |
| Simulation engine | ngspice shared library (`ngspice.dll`) with XSPICE, via Rust FFI |
| Web version (phase 4) | ngspice compiled to WebAssembly behind the same `SimulationClient` interface |

Rejected: Python sidecar (hard to bundle, no clean streaming, no web path), Electron + ngspice CLI (heavy, no step callbacks for live mode), React Flow (built for node graphs, not schematics).

## 3. Architecture

```
┌──────────────────────── Tauri desktop window ────────────────────────┐
│  FRONTEND  (Next.js static export, TypeScript)                       │
│  Schematic Editor ──► Circuit Model (Zustand store, JSON)            │
│  Parts Panel / Property Panel / Plot Dock                            │
│                        │                                             │
│                   SimulationClient (single TS interface)             │
│                        │                                             │
│          desktop: Tauri IPC        web (later): WASM ngspice         │
└────────────────────────┼─────────────────────────────────────────────┘
                         ▼
  BACKEND (Rust)
   ├─ library  : load + validate component manifests and packs
   ├─ netlist  : Circuit JSON + manifests → SPICE netlist text
   ├─ engine   : ngspice FFI (load, run, bg_run, halt, resume, alter, callbacks)
   └─ commands : Tauri IPC surface — the only API the UI calls
```

**Simulation data flow**
1. The editor mutates the Circuit JSON (component instances + wires). It is the single source of truth.
2. Run sends Circuit JSON + analysis settings to Rust.
3. `netlist` builds connectivity: wires/pins that touch form nets; the net containing a ground part is node `0`. Each component's manifest template is filled with its net names and parameter values. Models/subcircuits are collected once. The analysis directive is appended.
4. `engine` loads the netlist into ngspice and runs it. Results arrive via callbacks and are streamed to the UI in batches.
5. The plot dock renders vectors; in live mode renderers on the canvas consume the same stream.

The netlist is always regenerated and never hand-edited.

**`SimulationClient` interface (TypeScript)**
- `loadLibrary(): Promise<Library>`
- `run(circuit, analysis): SimulationSession` — session emits `data`, `status`, `error`, `done`.
- `session.pause() / resume() / stop()`
- `session.setControl(targetId, value)` (live mode)
- `session.setSpeed(ratio)` (live mode)

Implementations: `TauriSimulationClient` (desktop), `MockSimulationClient` (browser dev + Playwright), `WasmSimulationClient` (phase 4).

## 4. Component system

### 4.1 Categories
All 15 groups exist from day one: Sources, Basic, Diodes, Transistors, Analog, TTL, CMOS, Advanced Peripherals, Misc Digital, Mixed, Indicators, Power, Misc, RF, Electromechanical. Empty categories are shown greyed with a "coming soon" hint.

### 4.2 Manifest (one JSON file per part)

```json
{
  "schema": 1,
  "id": "basic.resistor",
  "name": "Resistor",
  "category": "Basic",
  "tags": ["passive", "R"],
  "symbol": {
    "width": 60, "height": 20,
    "svg": "symbols/resistor.svg",
    "pins": [
      { "id": "1", "x": 0,  "y": 10 },
      { "id": "2", "x": 60, "y": 10 }
    ]
  },
  "params": [
    { "key": "resistance", "label": "Resistance", "unit": "Ω", "default": "1k", "type": "si" }
  ],
  "spice": {
    "kind": "analog",
    "refPrefix": "R",
    "template": "{ref} {pin.1} {pin.2} {resistance}"
  },
  "live": null,
  "controls": []
}
```

**`spice` variants**
| Kind | Fields |
|---|---|
| Primitive (R, C, L, sources) | `template` |
| Model part (1N4148, 2N2222) | `template` + `models` (inline `.model` text or `.lib` path) |
| Subcircuit (LM741, 555) | `subckt` file ref (path relative to the manifest); the `template` lists pins in subcircuit port order, e.g. `X{ref} {pin.1} {pin.2} … NE555_BEH` |
| Digital (7400, 4017) | `kind: "digital"`, XSPICE model, hidden-by-default `power` pins (VCC/GND) |

**Rules**
- Manifests are validated against `schemas/manifest.schema.json` at startup. Invalid files are skipped and listed in a "Library issues" panel; the app still starts.
- `{ref}` is the full reference (`R1`), `{pin.<id>}` the net name, `{<param key>}` the parameter value. Pins may be marked `"optional": true`; unconnected optional pins are tied to ground through 1 GΩ.
- Parameters of type `si` accept SI suffixes (`p n u µ m k meg g`); one shared Rust parser.
- Symbols are SVG drawn on a 10 px grid. The canvas recolors strokes to the theme so every symbol stays readable on dark backgrounds.
- An unknown `schema` version makes that part unavailable, not the library.

### 4.3 Live behaviors and controls (declared, not coded)

```json
"live": { "renderer": "glow", "signal": "i(pin.A)",
          "config": { "color": "#ff5a5a", "threshold": "1m", "max": "20m" } },
"controls": [
  { "type": "toggle", "target": "V{ref}_ctl", "on": "5", "off": "0", "key": "Space" }
]
```

Built-in renderers (set grows over app versions): `glow`, `segments`, `matrix`, `readout`, `rotate`, `position`, `sound`, `panel`.
Built-in control types: `toggle`, `momentary`, `knob`, `slider`, `selector`.

**Fallback:** if a manifest references a renderer the app does not have, the part still simulates, draws its static symbol, and shows an "update app for live visuals" badge.

### 4.4 Packs
- `.mspack` = zip containing `pack.json`, `components/`, `symbols/`, `models/`.
- `pack.json`: `id`, `name`, `version`, `author`, `license`, `requires` (`app` semver range, `renderers` list), `dependencies` (other packs, for shared models).
- Packs are **data only**, never executable code.
- Locations: built-in `components/core/` (shipped), user packs in `%APPDATA%/multysm/packs/`.
- Library Manager (phase 3): install, enable/disable, remove, view issues.
- Every component instance records its pack id + version, so projects can report missing packs.

### 4.5 Sources of models and symbols
No single library provides symbol + model + app metadata. Plan:
- Built-in primitives use ngspice's own device models and XSPICE digital models (including the ngspice 74xx digital models).
- Model-heavy parts draw on KiCad-Spice-Library and similar collections, respecting each file's license.
- Symbols for the starter pack are hand-drawn SVG; a phase-3 importer converts KiCad `.kicad_sym` + SPICE model into draft manifests.
- Vendor model files that cannot be redistributed are user-imported, not shipped. Multisim's database is proprietary and not used.
- eSim (GPL) is studied as a reference only.

### 4.6 v1 starter pack
| Category | Parts |
|---|---|
| Sources | Ground, DC voltage, DC current, AC voltage, Pulse/clock, VCC (+5 V) rail |
| Basic | Resistor, Capacitor, Inductor, Potentiometer, SPST switch, SPDT switch, Push button |
| Diodes | Diode (1N4148), Diode (1N4007), Zener, LED |
| Transistors | NPN (2N2222), PNP (2N2907), N-MOSFET (2N7000) |
| Analog | Ideal op-amp, LM741 |
| TTL | 7400 NAND, 7404 NOT, 7408 AND, 7432 OR |
| CMOS | 4011 NAND, 4017 decade counter |
| Mixed | 555 timer |
| Indicators | Voltmeter, Ammeter, Probe, Logic probe, 7-segment display |
| Advanced Peripherals, Misc Digital, Power, Misc, RF, Electromechanical | Empty in v1 |

In v1 switches/buttons are set before a run (value in properties); clicking them during a run arrives with live mode (phase 2).

## 5. UI

### 5.1 Theme (soft-dark, only theme)
| Token | Value | Use |
|---|---|---|
| `bg` | `#1b1d23` | Canvas |
| `panel` | `#22252d` | Panels, bars |
| `line` | `#2e323c` | Borders, dividers |
| `text` | `#c9ced8` | Text, part strokes |
| `muted` | `#8a91a0` | Secondary text, grid labels |
| `wire` | `#7aa2d6` | Wires, junctions |
| `accent` | `#5fb3a8` | Run button, primary plot trace |
| `selected` | `#e0b25c` | Selection |
| `error` | `#d97a7a` | Error highlights |

No pure black, no pure white. Grid is subtle dots (`#2c3039`).

### 5.2 Layout (Hybrid)
| Region | Contents | Behavior |
|---|---|---|
| Top bar | Menus, analysis picker, Run / Pause / Stop | Always visible, 40 px |
| Left: Parts | Search + 15-category tree | Resizable; `Ctrl+B` toggles |
| Center: Canvas | Dot grid, 10 px snap, zoom/pan | Always visible |
| Right: Properties | Name, parameters (unit-aware), rotation/mirror | Only when something is selected; `Ctrl+I` pins |
| Bottom: Plot dock | Waveform tabs, cursors, measurements | Auto-opens after run; `Ctrl+J` toggles |
| Status bar | Grid, zoom, sim state, error count (clickable) | Minimal |

**Focus mode (`F11`):** all panels hide; floating toolbar; properties as a small card next to the part; plot floats in a corner.

### 5.3 Shortcuts
`Ctrl+K` / `P` part search palette · `W` wire · `Esc` select · `R` rotate · `M` mirror · `Del` · `Ctrl+Z` / `Ctrl+Y` · `Ctrl+C` / `Ctrl+V` · `Space` run/pause · wheel zoom · middle-drag or `Space`+drag pan.

### 5.4 Canvas behavior
- Orthogonal wire routing; dropping a wire end on a wire creates a junction dot.
- Probe tool on a wire adds that net's voltage to the plot dock.
- Error highlights in `error` color with a plain-language tooltip (e.g. "Node floating: C1 pin 2 not connected").
- Clutter rules: no ribbon, no icon wall, no parameters until selection, delayed tooltips.

## 6. Simulation

### 6.1 Analysis mode (v1)
| Analysis | Settings |
|---|---|
| DC operating point (`.op`) | None; values shown as labels on wires |
| Transient (`.tran`) | Stop time, max step (defaults provided) |
| AC sweep (`.ac`) | Start/stop frequency, points per decade; log axis |
| DC sweep (`.dc`) | Source, start, stop, step |

Plot dock: multiple traces, two cursors (Δt, ΔV, frequency), auto-scale, digital signals drawn as stacked high/low logic traces.

### 6.2 Live mode (phase 2)
- ngspice runs in its background thread (`bg_run`); data arrives per step via callback.
- Rust paces simulation time to a speed ratio (1×, 0.1×, 10×) so a 1 Hz 555 blinks once per second.
- UI updates batched to ~30 fps.
- Controls: interactive parts are controllable sources; a click does halt → `alter` → resume.
- Value edits pause/resume; topology edits stop and auto-restart.

### 6.3 Virtual instruments (phase 3)
Function generator, 2-channel oscilloscope, multimeter, logic analyzer. Each is a manifest part using the `panel` renderer.

### 6.4 Errors and guardrails
- ngspice errors are mapped back to the component/net that caused them and highlighted on canvas.
- Pre-run checks in `netlist`: no ground, floating pins, unknown part, missing model, invalid parameter.
- Convergence failure stops cleanly with a suggestion ("Try a smaller max step", "Add a ground").
- Run timeout (default 30 s); Stop always responsive (engine on its own thread).

## 7. Project file (`.msym`, JSON)

```json
{
  "format": 1, "app": "0.1.0",
  "packs": [{ "id": "core", "version": "1.0.0" }],
  "components": [{ "uid": "c7", "part": "basic.resistor", "ref": "R1",
                   "x": 120, "y": 80, "rot": 90, "mirror": false,
                   "params": { "resistance": "4.7k" } }],
  "wires": [{ "uid": "w3", "points": [[120,80],[200,80]] }],
  "analysis": { "type": "tran", "stop": "10m", "step": "10u" },
  "probes": ["net:out"],
  "view": { "zoom": 1, "pan": [0,0] }
}
```
- Validated against `schemas/project.schema.json`.
- Autosave to a recovery file every 30 s.
- Missing packs: project opens with a warning; affected parts render as placeholders.

## 8. Repository layout

```
multysm/
├─ app/                  Next.js (static export)
│  ├─ src/editor/        canvas, tools, selection, wiring
│  ├─ src/panels/        parts, properties, plot dock, status bar
│  ├─ src/renderers/     glow, segments, readout, …
│  ├─ src/sim/           SimulationClient + tauri/mock implementations
│  ├─ src/store/         Zustand circuit store, undo/redo
│  └─ src/theme/         soft-dark tokens
├─ crates/multysm-core/ Rust simulation core (no Tauri dependency, cargo-testable)
│  ├─ src/library/       manifests, packs, schema validation
│  ├─ src/netlist/       connectivity, templates
│  ├─ src/engine/        ngspice FFI, background thread, pacing
│  └─ src/si.rs          SI value parsing
├─ src-tauri/            Tauri shell; src/commands.rs = IPC surface calling multysm-core
├─ vendor/ngspice/       ngspice.dll + codemodels (downloaded, git-ignored)
├─ components/core/      built-in starter pack
├─ schemas/              manifest / pack / project JSON Schemas
└─ docs/
```

## 9. Testing

| Layer | Tool | Coverage |
|---|---|---|
| Rust netlist | `cargo test` | Circuit JSON → expected netlist text; SI parsing; pre-run checks |
| Rust engine | `cargo test` + ngspice | RC reaches 63 % at τ; 555 frequency within tolerance; 7400 truth table |
| Manifests | CI script | Every manifest passes schema; every part simulates in a minimal test circuit |
| UI logic | Vitest | Snapping, junctions, undo/redo, store |
| UI flows | Playwright vs `npm run dev` with `MockSimulationClient` | Place → wire → run → plot visible |
| Desktop | Manual release checklist | Install, open, run bundled examples |

## 10. Roadmap

| Phase | Scope |
|---|---|
| **v1** | Tauri shell; soft-dark hybrid layout; place/wire/edit; starter pack; `.op/.tran/.ac/.dc`; plot dock with logic traces; save/load; error highlighting; 5 example circuits (RC charge, LED + resistor, 555 astable, NAND truth table, op-amp inverting amp) |
| **Phase 2** | Live mode: background sim + pacing, renderers (`glow`, `segments`, `readout`), controls, Focus mode polish |
| **Phase 3** | Instruments (scope, function generator, multimeter, logic analyzer); `.mspack` Library Manager; KiCad symbol + SPICE model importer |
| **Phase 4** | Web version: WASM ngspice behind `SimulationClient` |
