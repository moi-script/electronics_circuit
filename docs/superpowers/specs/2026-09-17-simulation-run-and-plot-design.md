# Simulation run, analysis picker and plot dock (Plan A) — design

Date: 2026-09-17. Builds on `main` at `94f25e1` (component browser and 35-part starter pack) and the
product spec `2026-09-15-multysm-design.md` (§5.2 layout, §5.4 canvas, §6.1 analyses, §6.4 errors).

## 1. Goal and scope

Make ▶ Run work end to end: pick an analysis, run it in ngspice without freezing the window, stop
it at any time, and read the result as a plot or as values on the canvas, with problems shown on the
parts that caused them.

In scope (Plan A):
1. Run pipeline: background run with Stop and a 30 s timeout (§2).
2. Analysis picker in the top bar (§3).
3. Plot dock with auto-plotted probe parts and a signal checklist (§4).
4. Canvas feedback: error highlighting, a simulation error bar, operating-point labels (§5).

Out of scope (Plan B and later): two plot cursors and measurements; stacked high/low logic traces;
a probe tool on wires; plot export; resizable dock; live mode (spec §6.2); virtual instruments.

## 2. Run pipeline

### 2.1 Core (`crates/multysm-core`)
- `ffi.rs`: load `ngSpice_running` (`extern "C" fn() -> bool`) into `NgspiceApi`.
- `engine`: the run uses `bg_run` instead of `run`, then polls `ngSpice_running()` every 20 ms.
  - New `pub fn run_netlist_with(config, netlist, cancel: &AtomicBool, timeout: Option<Duration>)
    -> Result<SimResult, EngineError>`. When `cancel` becomes true or the timeout passes, it sends
    `bg_halt`, waits (polling, at most 5 s) until `ngSpice_running()` is false, and returns
    `EngineError::Stopped` or `EngineError::Timeout`. Otherwise it collects vectors exactly as today.
  - `run_netlist(config, netlist)` becomes `run_netlist_with(config, netlist, &AtomicBool::new(false), None)`.
  - New `EngineError` variants `Stopped` and `Timeout { seconds: u64 }`; `kind()` returns `"stopped"` / `"timeout"`.
- `lib.rs`: `pub fn simulate_with(project, library, config, cancel, timeout)`; `simulate` delegates
  with no cancel and no timeout, so every existing test keeps its behaviour.
- `NetlistError` gains `pub pin: Option<String>` (serialized as `pin`, omitted when `None`); the
  unconnected-pin check sets it to the pin id.
- New module `results.rs` with the UI-facing result:

```rust
pub struct UiResult {
    pub analysis: String,            // "op" | "tran" | "ac" | "dc"
    pub x: Option<UiAxis>,           // None for op
    pub signals: Vec<UiSignal>,
    pub nets: Nets,                  // pinNet, netPins, wireNet (existing serializer)
}
pub struct UiAxis { pub label: String, pub unit: String, pub values: Vec<f64>, pub log: bool }
pub struct UiSignal {
    pub id: String,                  // ngspice vector name, lower case: "n3", "v1#branch"
    pub kind: SignalKind,            // Voltage | Current
    pub values: Vec<f64>,            // op/tran/dc: real; ac: magnitude in dB
    pub phase: Option<Vec<f64>>,     // ac only: phase in degrees
}
pub fn to_ui_result(project: &Project, netlist: &Netlist, result: &SimResult, max_points: usize) -> UiResult
```

  - `x` is `time` (s) for tran, `frequency` (Hz, `log: true`) for ac, and the swept source value for
    dc (label = source reference, unit V or A by source kind).
  - Voltage signals are the vectors that are net names in `netlist.nets.net_pins`; current signals
    are vectors ending in `#branch`. Other vectors (internal subcircuit nodes) are dropped.
  - Decimation: when a vector has more than `max_points` (20 000) points, the x range is split into
    `max_points / 2` buckets and each bucket keeps its min and max samples in time order. The same
    sample indices are kept for `x` and every signal, so traces stay aligned. Op results are one
    point each and never decimated.

### 2.2 Tauri shell (`src-tauri`)
- App state: `SimState { library: Mutex<Option<(SystemTime, Library)>>, cancel: Arc<AtomicBool>,
  running: AtomicBool }`. The library is loaded on first run and reloaded when the newest mtime
  under `components/core` is newer than the cached one.
- `#[tauri::command] async fn simulate(state, project) -> SimOutcome`: if `running` is already set,
  returns `Busy`; otherwise clears `cancel`, sets `running`, runs `simulate_with` on
  `tauri::async_runtime::spawn_blocking` with a 30 s timeout, converts with `to_ui_result`, and
  clears `running` on every path.
- `#[tauri::command] fn stop_simulation(state)`: sets `cancel`.
- `SimOutcome` is serialized with `#[serde(tag = "status", rename_all = "camelCase")]`:
  `ok { result: UiResult, elapsedMs }`, `netlist { errors: NetlistError[] }`,
  `engine { message, log: string[] }`, `stopped`, `timeout { seconds }`, `busy`.

### 2.3 Frontend
- `backend.ts`: `Backend` gains `simulate(project: Project): Promise<SimOutcome>` and
  `stopSimulation(): Promise<void>`; TS types for `SimOutcome`, `UiResult`, `UiSignal`, `UiAxis`,
  `NetlistError` (`code`, `message`, `componentUid?`, `pin?`) in `model/simTypes.ts`.
- `mockBackend.ts`: deterministic fake results so UI and e2e tests run without ngspice:
  - no `sources.ground` part → `netlist` outcome with a no-ground error;
  - any required pin with no wire end or other pin on it → `netlist` unconnected-pin error with `componentUid` and `pin`;
  - `op` → every net 5·(i+1)/N volts;
  - `tran` → each net an RC charge curve `v·(1 − e^(−t/τ))` over 200 points to the stop time;
  - `ac` / `dc` → 50-point sweeps of the same shape; nets computed with the existing TS wiring helpers.
- Store `sim` slice (not in undo history, never marks the project dirty):
  `{ status: "idle" | "running" | "done" | "failed" | "stopped", outcome: SimOutcome | null,
  stale: boolean, startedAt: number | null }` with actions `startRun()`, `finishRun(outcome)`,
  `markStale()`. Every project-changing store action sets `stale = true` (including undo/redo);
  view changes (pan/zoom) and selection do not.
- Run button: `▶ Run` (enabled whenever the library is loaded and the analysis is valid) becomes
  `■ Stop` while running. Shortcut **Ctrl+Enter** toggles run/stop. Focus-mode toolbar gets the same button.
- Status bar: `Running… 3.2 s` (ticks every 100 ms) · `Done in 0.41 s` · `Stopped` ·
  `Stopped after 30 s` · `2 problems` (clickable, §5.1) · `Values outdated — run again` when stale.
- A run while another is in flight is impossible from the UI (button shows Stop); a `busy` outcome
  is treated as failed with "A simulation is already running."

## 3. Analysis picker

- `ui/AnalysisPicker.tsx`: a top-bar button left of Run whose label is `analysisSummary(analysis)`
  (`model/analysis.ts`):
  - `Operating point`
  - `Transient · 10 ms` (stop time)
  - `AC · 10 Hz–100 kHz`
  - `DC sweep · V1 0→5 V`
- Clicking opens a popover (`role="dialog"`, `aria-label="Analysis"`) with four radio buttons and the fields:

| Analysis | Fields (defaults) |
|---|---|
| Operating point | none; text "Node voltages are shown on the wires." |
| Transient | Stop time (`10m`, s), Max step (`10u`, s) |
| AC sweep | Start frequency (`10`, Hz), Stop frequency (`100k`, Hz), Points per decade (`10`, integer 1–1000) |
| DC sweep | Source (select of references of `sources.dc_voltage` and `sources.dc_current` parts), Start (`0`), Stop (`5`), Step (`0.1`) |

- Fields validate with `parseSi` as the user types (inline error, same style as Properties). A field
  commits on blur/Enter when valid; each commit is one store action (`setAnalysis`), undoable, and
  marks the project dirty.
- Switching type commits the new type with the session's remembered values for that type (or the
  defaults). Remembered values live in component state, not in the project.
- Extra checks: tran max step must be > 0 and ≤ stop time; ac start < stop; dc step > 0 and
  start ≠ stop. DC sweep with no DC source shows "Add a DC voltage or current source to sweep." and
  Run is disabled; a DC sweep whose saved source reference no longer exists shows "Pick a source."
- `analysisIsRunnable(project)` (in `model/analysis.ts`) drives Run's enabled state.
- Esc, outside click or **Done** closes the popover.

## 4. Plot dock

- `ui/plot/PlotDock.tsx` replaces the placeholder. It opens automatically (sets `panels.plot`) when
  a run finishes with `ok` for tran, ac or dc. For op it does not auto-open; if open, it shows
  "Operating point: values are shown on the wires." Ctrl+J still toggles. Fixed height 240 px.
- Layout: signal checklist (`ui/plot/SignalList.tsx`, 200 px wide) on the left, chart on the right,
  and an `outdated` badge top-right when `sim.stale`. When stale the chart renders at 50 % opacity.
- Signal model (`model/signals.ts`, pure):
  - `netName(net, result, project, library)`:
    - `GND` for the ground net `0`;
    - else the reference of a `indicators.probe` or `indicators.logic_probe` on the net;
    - else the first pin in component order, as `REF:pinName` (pin `name` if present, else id), e.g. `R1:2`, `U1:OUT`.
  - `listSignals(result, project, library)` returns entries `{ key, label, unit, color, auto, series }`:
    - voltage of every net except ground: `V(<netName>)`, V;
    - current of every `#branch` vector not inside a meter: `I(<REF>)`, A;
    - one `V(<VM ref>)` per voltmeter, computed as `V(p) − V(n)` (a ground pin counts as 0);
    - one `I(<AM ref>)` per ammeter, from the vector `v.x<ref lower>.vsense#branch`.
  - Auto-ticked: nets touched by probe/logic-probe parts, voltmeter differences, ammeter currents.
  - `probeRef(uid, pinId)` → `pin:<uid>:<pinId>`; project `probes` stores these for ticked net
    voltages. A stored ref whose pin no longer exists is ignored (not an error). Ticking and unticking
    is one store action (`toggleProbe`), undoable and marks the project dirty. The resulting stale
    flag does **not** dim the plot, because probes don't change the circuit — `toggleProbe` is the one
    project action that does not set `stale`.
  - Colors: trace i uses palette `[accent #5fb3a8, #d9a35f, #7aa2d6, #c98bd1, #8fc27a, #d97a7a, #6fc4c4, #c9ced8]` in order of ticking.
- Chart (`ui/plot/Chart.tsx`): uPlot (`uplot` npm dependency) wrapper that creates the plot on
  mount, updates data on prop change, and resizes with a `ResizeObserver`.
  - Y auto-scales. Volts use the left axis and amps the right axis when both are ticked.
  - X is time (s) for tran, a log-frequency axis for ac, and the source value for dc.
  - Axis ticks use engineering units (`2.5 ms`, `1 kHz`).
  - AC shows magnitude (dB) with a `Mag | Phase` toggle.
  - Hover shows uPlot's legend values for the x position.
  - Nothing ticked: "Tick a signal to plot it."

## 5. Canvas feedback

### 5.1 Pre-run problems (`netlist` outcome)
- Parts named by `componentUid` render in `error` color (`PartNode` `error` prop) with a Konva
  tooltip showing their messages on hover.
- Errors with `pin` also draw a 5 px `error` ring at that pin (`ui/canvas/ErrorOverlay.tsx`).
- Errors without `componentUid` appear in the error bar (§5.2).
- Status bar `N problems` button: first click selects the first erroring part and centres the view
  on it; subsequent clicks cycle through erroring parts.
- Highlights are hidden while `sim.stale`.

### 5.2 Simulation error bar (`ui/SimErrorBar.tsx`)
- A slim `error`-bordered bar above the canvas, shown for: netlist errors without a part, `engine`
  outcomes, and `timeout`. It has a close button, and it is hidden when stale.
- Engine messages come from `engineMessage(log)` (`model/results.ts`), first match wins
  (case-insensitive):

| Log contains | Message |
|---|---|
| `timestep too small` | The simulation didn't converge. Try a smaller max step. |
| `singular matrix` | Part of the circuit is floating. Check that every part connects to ground. |
| `no convergence` or `gmin` | The simulation didn't converge. Check source values and connections. |
| (anything else) | The simulator reported an error. |

- **Show log** expands the raw log (monospace, max 160 px, scrollable).
- `partsNamedInLog(log, project)`: tokens in the log matching a component reference, optionally
  prefixed by one element letter or `x` and followed by `.` or a word boundary (e.g. `rr1`, `xu1.q1`),
  case-insensitive. Those parts are highlighted as in §5.1.
- Timeout message: "Stopped after 30 s. Try a shorter stop time or a larger max step."

### 5.3 Operating-point labels (`ui/canvas/OpLabels.tsx`)
- Shown after an `ok` op outcome while not stale; not listening for events.
- One label per non-ground net: `formatValue(v, "V")` with 3 significant figures and engineering
  prefix (`4.97 V`, `3.30 mV`, `−12.0 V`, `0 V`), `muted` color, 10 px at any zoom (scaled by
  1/zoom).
- Position (`opLabelPositions` in `model/results.ts`): midpoint of the net's longest wire segment
  (from `nets.wireNet` and project wire points), offset 6 px up; a net with no wires uses its first
  pin position offset 6 px up-right.
- Meters: voltmeters show `formatValue(V(p) − V(n), "V")` and ammeters `formatValue(I, "A")`, in
  `accent`, 8 px right of the part's bounding box.

## 6. Testing

Rust:
- Engine: a long transient (`.tran 1u 10`, RC) with `cancel` set from another thread after 200 ms
  returns `Stopped` within 2 s; the same with a 1 s timeout returns `Timeout`; a normal run after
  either succeeds (the engine is reusable).
- `simulate` behaviour unchanged: all existing `circuits.rs`/`starter_pack.rs` tests pass untouched.
- `to_ui_result`:
  - op, tran, ac (magnitude dB and phase) and dc on small circuits;
  - internal subcircuit vectors dropped;
  - decimation keeps the first and last samples, the global min and max, and alignment (a 100 000-point synthetic `SimResult`).
- Unconnected-pin errors carry `pin`.
- `src-tauri/tests/commands.rs`: `SimOutcome` serialization shape for each variant.

Frontend (Vitest):
- `model/analysis.ts`: summaries and runnable checks.
- `model/signals.ts`: net naming priorities, auto-ticks, voltmeter difference, probe refs.
- `model/results.ts`: `formatValue`, `engineMessage`, `partsNamedInLog`, `opLabelPositions`.
- Store: `sim` transitions, stale on project edits and undo, not on view/selection/toggleProbe.
- Components:
  - `AnalysisPicker`: validation, commit, DC source list;
  - `SignalList`: tick/untick;
  - `SimErrorBar`: messages, Show log;
  - Run button: run/stop and the Ctrl+Enter shortcut;
  - `PlotDock`: empty, op and stale states. uPlot itself is not rendered in jsdom — `Chart` is mocked in component tests.

End-to-end (Playwright, mock backend):
- Place two resistors, run → error bar or highlight visible and `N problems` in the status bar.
- Add a DC source and a ground, wire them, choose Operating point, run → op labels visible.
- Switch to Transient, run → plot dock opens with a chart canvas; edit a part → `outdated` badge.

Desktop checklist additions (manual, real ngspice):
- RC charge transient plots a rising curve.
- Stop during a `10 s` transient returns within a second.
- The LED circuit's op labels show about 1.9 V at the anode.

## 7. Compatibility
- Project format unchanged: `analysis` and `probes` already exist; `probes` entries now use the
  `pin:<uid>:<pinId>` form (older free-form entries are ignored).
- `NetlistError.pin` is additive; `simulate` keeps its signature.
