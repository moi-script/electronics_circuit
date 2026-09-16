# Simulation Run and Plot (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ▶ Run work end to end — analysis picker, background ngspice run with Stop and timeout, plot dock, error highlighting and operating-point labels on the canvas.

**Architecture:**
- **Core:** the Rust engine switches to ngspice's `bg_run`, polls for completion and halts on cancel or timeout. A new `results` module turns raw vectors into a decimated, UI-shaped result.
- **Tauri:** runs the core on a blocking worker and returns one tagged `SimOutcome`.
- **Frontend:** adds a `sim` store slice, pure model modules (analysis, format, results, signals), and React components: the analysis picker, run button, plot dock (uPlot), error bar and Konva overlays. A mock backend fakes results for the browser and tests.

**Tech Stack:** Rust (multysm-core, ngspice FFI via libloading, serde), Tauri 2, Next.js 16 + React 19 + zustand 5 + Tailwind 4, react-konva, uPlot, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-simulation-run-and-plot-design.md`

## Global Constraints

- Theme: soft-dark tokens only (`bg #1b1d23`, `panel #22252d`, `line #2e323c`, `text #c9ced8`, `muted #8a91a0`, `wire #7aa2d6`, `accent #5fb3a8`, `selected #e0b25c`, `error #d97a7a`, `grid #2c3039`) via Tailwind classes or `tokens` from `@/theme/tokens`. The only other colors allowed are the trace palette: `#5fb3a8, #d9a35f, #7aa2d6, #c98bd1, #8fc27a, #d97a7a, #6fc4c4, #c9ced8`.
- Run timeout: 30 s. Decimation cap: 20 000 points per result. Engine poll interval: 10 ms.
- Project format unchanged. `probes` entries use `pin:<uid>:<pinId>`.
- `simulate(project, library, config)` keeps its signature and behaviour; all existing Rust tests must pass untouched.
- Simulation state is never part of undo history and never marks the project dirty. `setAnalysis` and `toggleProbe` are project edits (undoable, dirty).
- Every project edit marks results stale, except `toggleProbe`. Pan, zoom and selection don't.
- Shell: use Git Bash (the Bash tool). PowerShell `>` writes UTF-16.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never commit the Next-generated `app/next-env.d.ts` change.

## File map

```
crates/multysm-core/src/engine/{ffi.rs,mod.rs}           bg_run, cancel, timeout
crates/multysm-core/src/lib.rs                           simulate_with; pub mod results
crates/multysm-core/src/results.rs                       UiResult, to_ui_result, decimation (new)
crates/multysm-core/src/netlist/{mod.rs,build.rs}        NetlistError camelCase + pin
crates/multysm-core/tests/{engine_smoke.rs,netlist.rs,ui_results.rs (new)}
src-tauri/src/{simulation.rs (new),commands.rs,lib.rs}
src-tauri/tests/simulation.rs (new)
app/package.json                                          uplot
app/src/model/simTypes.ts (new)                           SimOutcome & result types
app/src/backend/{backend.ts,tauriBackend.ts,mockBackend.ts,mockSimulation.ts (new),mockSimulation.test.ts (new)}
app/src/model/store.ts, store.test.ts, app/src/test/resetEditor.ts
app/src/model/{format.ts,analysis.ts,simStatus.ts,results.ts,signals.ts} + tests (new)
app/src/ui/{AnalysisPicker.tsx,RunButton.tsx,runActions.ts,SimErrorBar.tsx} + tests (new)
app/src/ui/plot/{PlotDock.tsx,SignalList.tsx,Chart.tsx} + tests (new; old app/src/ui/PlotDock.tsx deleted)
app/src/ui/canvas/{Canvas.tsx,PartNode.tsx,OpLabels.tsx (new),ErrorOverlay.tsx (new)}
app/src/ui/{AppShell.tsx,TopBar.tsx,FocusToolbar.tsx,StatusBar.tsx,useShortcuts.ts,useShortcuts.test.ts}
app/e2e/simulation.spec.ts (new), docs/desktop-checklist.md
```

---

### Task 1: Engine background run with Stop and timeout

**Files:**
- Modify: `crates/multysm-core/src/engine/ffi.rs`, `crates/multysm-core/src/engine/mod.rs`, `crates/multysm-core/src/lib.rs`
- Test: `crates/multysm-core/tests/engine_smoke.rs`

**Interfaces:**
- Produces: `engine::run_netlist_with(config: &EngineConfig, netlist: &str, cancel: &AtomicBool, timeout: Option<Duration>) -> Result<SimResult, EngineError>`; `EngineError::Stopped`, `EngineError::Timeout { seconds: u64 }` (`kind()` = `"stopped"` / `"timeout"`); `multysm_core::simulate_with(project, library, config, cancel: &AtomicBool, timeout: Option<Duration>) -> Result<(Netlist, SimResult), SimulateError>`.

- [ ] **Step 1: Write the failing tests**

Append to `crates/multysm-core/tests/engine_smoke.rs` and add at the top `use multysm_core::engine::run_netlist_with;` plus `use std::sync::atomic::{AtomicBool, Ordering}; use std::sync::Arc; use std::time::{Duration, Instant};`:

```rust
const LONG_RC: &str =
    "* long\nV1 in 0 PULSE(0 5 0 1u 1u 1m 2m)\nR1 in out 1k\nC1 out 0 1u\n.tran 1u 100\n.end\n";

#[test]
fn cancel_stops_a_long_run_and_the_engine_is_reusable() {
    let config = common::engine_config();
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    let setter = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let outcome = run_netlist_with(&config, LONG_RC, &cancel, None);
    setter.join().unwrap();
    assert!(matches!(outcome, Err(EngineError::Stopped)), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(4), "stop took {:?}", started.elapsed());

    let after = run_netlist(&config, "* a\nV1 x 0 DC 1\nR1 x 0 1k\n.op\n.end\n").unwrap();
    assert!(after.real("x").is_some());
}

#[test]
fn timeout_stops_a_long_run() {
    let config = common::engine_config();
    let started = Instant::now();
    let outcome = run_netlist_with(&config, LONG_RC, &AtomicBool::new(false), Some(Duration::from_secs(1)));
    assert!(matches!(outcome, Err(EngineError::Timeout { seconds: 1 })), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(5), "timeout took {:?}", started.elapsed());

    let after = run_netlist(&config, "* b\nV1 y 0 DC 2\nR1 y 0 1k\n.op\n.end\n").unwrap();
    assert!(after.real("y").is_some());
}

#[test]
fn stopped_and_timeout_errors_have_kinds() {
    assert_eq!(EngineError::Stopped.kind(), "stopped");
    assert_eq!(EngineError::Timeout { seconds: 30 }.kind(), "timeout");
}

#[test]
fn quick_runs_finish_without_waiting_for_the_poll_limits() {
    let config = common::engine_config();
    run_netlist(&config, "* warm\nV1 x 0 DC 1\nR1 x 0 1k\n.op\n.end\n").unwrap();
    let started = Instant::now();
    run_netlist(&config, "* quick\nV1 x 0 DC 1\nR1 x 0 1k\n.op\n.end\n").unwrap();
    assert!(started.elapsed() < Duration::from_millis(800), "op took {:?}", started.elapsed());
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p multysm-core --test engine_smoke`
Expected: compile error — `run_netlist_with`, `EngineError::Stopped`, `EngineError::Timeout` don't exist.

- [ ] **Step 3: Load `ngSpice_running`**

In `crates/multysm-core/src/engine/ffi.rs`, add `type RunningFn = unsafe extern "C" fn() -> bool;`, a field `pub running: RunningFn,` in `NgspiceApi`, and in `load`: `running: *lib.get::<RunningFn>(b"ngSpice_running\0")?,`.

- [ ] **Step 4: Implement the background run**

In `crates/multysm-core/src/engine/mod.rs`:

Imports: `use std::sync::atomic::{AtomicBool, Ordering};` and `use std::time::{Duration, Instant};`.

Add variants to `EngineError`:
```rust
    #[error("the simulation was stopped")]
    Stopped,
    #[error("the simulation took longer than {seconds} s and was stopped")]
    Timeout { seconds: u64 },
```
and to `kind()`: `EngineError::Stopped => "stopped", EngineError::Timeout { .. } => "timeout",`.

Add below the `LOG`/`ENGINE` statics:
```rust
/// Set by ngspice's background-thread callback: `true` when no background
/// run is active. Cleared just before `bg_run`.
static BG_IDLE: AtomicBool = AtomicBool::new(true);

const POLL: Duration = Duration::from_millis(10);
/// If ngspice never reports the background thread, give up waiting after this.
const START_WAIT: Duration = Duration::from_secs(1);
/// Longest wait for a halted run to wind down.
const HALT_WAIT: Duration = Duration::from_secs(5);
```

Replace `run_netlist` with:
```rust
pub fn run_netlist(config: &EngineConfig, netlist: &str) -> Result<SimResult, EngineError> {
    run_netlist_with(config, netlist, &AtomicBool::new(false), None)
}

/// Like `run_netlist`, but the analysis runs on ngspice's background thread and
/// is halted when `cancel` becomes true (`Stopped`) or `timeout` passes (`Timeout`).
pub fn run_netlist_with(
    config: &EngineConfig,
    netlist: &str,
    cancel: &AtomicBool,
    timeout: Option<Duration>,
) -> Result<SimResult, EngineError> {
    let mut guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(Engine::start(config)?);
    }
    let engine = guard.as_ref().expect("engine started above");
    if engine.dll_path != config.dll_path {
        return Err(EngineError::ConfigMismatch);
    }
    engine.run(netlist, cancel, timeout)
}
```

Change `fn run(&self, netlist: &str)` to `fn run(&self, netlist: &str, cancel: &AtomicBool, timeout: Option<Duration>)` and replace its block from `let status = self.command("run");` up to (not including) `let (plot, vectors) = unsafe { self.collect_vectors() };` with:
```rust
        BG_IDLE.store(false, Ordering::SeqCst);
        let status = self.command("bg_run");
        if status != 0 {
            BG_IDLE.store(true, Ordering::SeqCst);
            log.extend(take_log());
            return Err(EngineError::Run { log });
        }
        let started = Instant::now();
        loop {
            if BG_IDLE.load(Ordering::SeqCst) {
                break;
            }
            // Fallback when the thread callback never arrives.
            if started.elapsed() > START_WAIT && !unsafe { (self.api.running)() } {
                break;
            }
            let stop = if cancel.load(Ordering::SeqCst) {
                Some(EngineError::Stopped)
            } else {
                timeout
                    .filter(|limit| started.elapsed() >= *limit)
                    .map(|limit| EngineError::Timeout { seconds: limit.as_secs() })
            };
            if let Some(error) = stop {
                self.halt();
                take_log();
                return Err(error);
            }
            std::thread::sleep(POLL);
        }
        log.extend(take_log());
        if has_error(&log) {
            return Err(EngineError::Run { log });
        }
```

Add to `impl Engine`:
```rust
    fn halt(&self) {
        self.command("bg_halt");
        let started = Instant::now();
        while !BG_IDLE.load(Ordering::SeqCst)
            && unsafe { (self.api.running)() }
            && started.elapsed() < HALT_WAIT
        {
            std::thread::sleep(POLL);
        }
        BG_IDLE.store(true, Ordering::SeqCst);
    }
```

Replace `on_bg_thread`:
```rust
unsafe extern "C" fn on_bg_thread(noruns: bool, _id: c_int, _user: *mut c_void) -> c_int {
    BG_IDLE.store(noruns, Ordering::SeqCst);
    0
}
```

Notes for the implementer:
- sharedspice.h documents `BGThreadRunning(bool noruns, …)`: it is called with `false` when the background thread starts and `true` when it ends. The code relies on this.
- If the tests show a halted run leaves ngspice unable to load the next circuit, check what `remcirc` / `destroy all` print after a halt and add whatever reset command ngspice needs (for example `bg_halt` followed by waiting for `ngSpice_running()` to be false). Record what you changed in the report.
- Don't loosen the test time limits.

- [ ] **Step 5: Add `simulate_with`**

In `crates/multysm-core/src/lib.rs`, add `use std::sync::atomic::AtomicBool; use std::time::Duration;`, import `run_netlist_with`, and replace `simulate` with:
```rust
pub fn simulate(
    project: &Project,
    library: &Library,
    config: &EngineConfig,
) -> Result<(Netlist, SimResult), SimulateError> {
    simulate_with(project, library, config, &AtomicBool::new(false), None)
}

/// `simulate` with cancellation and an optional time limit (see `run_netlist_with`).
pub fn simulate_with(
    project: &Project,
    library: &Library,
    config: &EngineConfig,
    cancel: &AtomicBool,
    timeout: Option<Duration>,
) -> Result<(Netlist, SimResult), SimulateError> {
    let netlist = build_netlist(project, library).map_err(SimulateError::Netlist)?;
    let result = run_netlist_with(config, &netlist.text, cancel, timeout)?;
    Ok((netlist, result))
}
```
Update the `SimulateError` doc comment's kind list to include `"stopped"|"timeout"`.

- [ ] **Step 6: Run the tests**

Run: `cargo test --workspace`
Expected: all pass, including the 4 new engine tests and every existing circuit/starter-pack test.

- [ ] **Step 7: Commit**

```bash
git add crates/multysm-core/src crates/multysm-core/tests/engine_smoke.rs
git commit -m "feat(core): background ngspice runs with stop and timeout"
```

---

### Task 2: UI-shaped results and pin-level netlist errors

**Files:**
- Create: `crates/multysm-core/src/results.rs`, `crates/multysm-core/tests/ui_results.rs`
- Modify: `crates/multysm-core/src/lib.rs` (`pub mod results;`), `crates/multysm-core/src/netlist/mod.rs`, `crates/multysm-core/src/netlist/build.rs`
- Test: `crates/multysm-core/tests/netlist.rs`

**Interfaces:**
- Consumes: `simulate` (Task 1); `Netlist { text, nets }`; `Nets { pin_net, net_pins, wire_net }` (serializes `pinNet`, `netPins`, `wireNet`); `SimResult { plot, vectors: BTreeMap<String, Vector>, log }`; `Vector::{Real(Vec<f64>), Complex(Vec<(f64, f64)>)}`.
- Produces: `results::{UiResult, UiAxis, UiSignal, SignalKind, to_ui_result, MAX_POINTS}`, serialized as:
  - `UiResult`: `{ analysis, x: {label, unit, values, log} | null, signals: [...], nets }`;
  - `UiSignal`: `{ id, kind: "voltage"|"current", values, phase? }`.
  
  `NetlistError` serializes as `{ code, message, componentUid: string|null, pin?: string }`; `NetlistError::with_pin(self, pin: &str) -> Self`.

- [ ] **Step 1: Write the failing netlist-error tests**

Append to `crates/multysm-core/tests/netlist.rs`:

```rust
#[test]
fn unconnected_pin_errors_name_the_pin_and_serialize_camel_case() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let r1 = b.add("basic.resistor", "R1", &[]);
    b.connect((&r1, "1"), (&gnd, "1"));
    let errors = build_netlist(&b.build(), &lib).unwrap_err();
    let error = errors.iter().find(|e| e.code == ErrorCode::UnconnectedPin).expect("unconnected pin error");
    assert_eq!(error.pin.as_deref(), Some("2"));
    let json = serde_json::to_value(error).unwrap();
    assert_eq!(json["componentUid"], r1.as_str());
    assert_eq!(json["pin"], "2");
    assert_eq!(json["code"], "unconnected_pin");
}

#[test]
fn errors_without_a_pin_omit_the_field() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let r1 = b.add("basic.resistor", "R1", &[]);
    let r2 = b.add("basic.resistor", "R2", &[]);
    b.connect((&r1, "1"), (&r2, "1"));
    b.connect((&r1, "2"), (&r2, "2"));
    let errors = build_netlist(&b.build(), &lib).unwrap_err();
    let no_ground = errors.iter().find(|e| e.code == ErrorCode::NoGround).unwrap();
    let json = serde_json::to_value(no_ground).unwrap();
    assert!(json.get("pin").is_none());
    assert!(json["componentUid"].is_null());
}
```

If `serde_json` isn't a dev-dependency of multysm-core, it's a normal dependency already, so the test can use it.

- [ ] **Step 2: Write the failing results tests**

Create `crates/multysm-core/tests/ui_results.rs`:

```rust
mod common;

use std::collections::BTreeMap;

use common::{core_library, engine_config, CircuitBuilder};
use multysm_core::circuit::Analysis;
use multysm_core::engine::{SimResult, Vector};
use multysm_core::library::Library;
use multysm_core::netlist::{Netlist, Nets};
use multysm_core::results::{to_ui_result, SignalKind, UiResult, MAX_POINTS};
use multysm_core::simulate;

/// V1 (10 V) -> R1 1k -> R2 1k -> ground, with the given analysis. Returns (lib-owned) result and uids.
fn divider(lib: &Library, analysis: Analysis) -> (UiResult, String, String) {
    let mut b = CircuitBuilder::new(lib, analysis);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "10")]);
    let r1 = b.add("basic.resistor", "R1", &[]);
    let r2 = b.add("basic.resistor", "R2", &[]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&r2, "1"));
    b.connect((&r2, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let project = b.build();
    let (netlist, result) = simulate(&project, lib, &engine_config()).unwrap();
    let mid = netlist.nets.pin_net[&(r1.clone(), "2".to_string())].clone();
    (to_ui_result(&project, &netlist, &result, MAX_POINTS), mid, v1)
}

fn signal<'a>(ui: &'a UiResult, id: &str) -> &'a multysm_core::results::UiSignal {
    ui.signals.iter().find(|s| s.id == id).unwrap_or_else(|| panic!("no signal {id} in {:?}", ui.signals.iter().map(|s| &s.id).collect::<Vec<_>>()))
}

#[test]
fn op_result_has_no_axis_and_single_point_signals() {
    let lib = core_library();
    let (ui, mid, _) = divider(&lib, Analysis::Op);
    assert_eq!(ui.analysis, "op");
    assert!(ui.x.is_none());
    let v = signal(&ui, &mid);
    assert_eq!(v.kind, SignalKind::Voltage);
    assert_eq!(v.values.len(), 1);
    assert!((v.values[0] - 5.0).abs() < 1e-6);
    let i = signal(&ui, "v1#branch");
    assert_eq!(i.kind, SignalKind::Current);
    assert!(ui.signals.iter().all(|s| s.id != "0"));
    let json = serde_json::to_value(&ui).unwrap();
    assert!(json["x"].is_null());
    assert!(json["nets"]["pinNet"].is_array());
    assert!(json["nets"]["wireNet"].is_object());
}

#[test]
fn tran_result_uses_time_axis() {
    let lib = core_library();
    let (ui, mid, _) = divider(&lib, Analysis::Tran { stop: "1m".into(), step: "10u".into() });
    let x = ui.x.as_ref().unwrap();
    assert_eq!((x.label.as_str(), x.unit.as_str(), x.log), ("time", "s", false));
    assert!(x.values.len() > 10);
    assert_eq!(signal(&ui, &mid).values.len(), x.values.len());
}

#[test]
fn dc_sweep_uses_the_source_as_axis() {
    let lib = core_library();
    let (ui, mid, _) = divider(
        &lib,
        Analysis::Dc { source: "V1".into(), start: "0".into(), stop: "5".into(), step: "1".into() },
    );
    let x = ui.x.as_ref().unwrap();
    assert_eq!((x.label.as_str(), x.unit.as_str()), ("V1", "V"));
    assert_eq!(x.values.len(), 6);
    let v = &signal(&ui, &mid).values;
    assert!((v[5] - 2.5).abs() < 1e-6, "{v:?}");
}

#[test]
fn ac_result_has_log_frequency_magnitude_db_and_phase() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(
        &lib,
        Analysis::Ac { start: "10".into(), stop: "1meg".into(), points_per_decade: 10 },
    );
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.ac_voltage", "V1", &[("amplitude", "1")]);
    let r1 = b.add("basic.resistor", "R1", &[("resistance", "1k")]);
    let c1 = b.add("basic.capacitor", "C1", &[("capacitance", "10n")]);
    b.connect((&v1, "p"), (&r1, "1"));
    b.connect((&r1, "2"), (&c1, "1"));
    b.connect((&c1, "2"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let project = b.build();
    let (netlist, result) = simulate(&project, &lib, &engine_config()).unwrap();
    let out = netlist.nets.pin_net[&(c1.clone(), "1".to_string())].clone();
    let ui = to_ui_result(&project, &netlist, &result, MAX_POINTS);
    let x = ui.x.as_ref().unwrap();
    assert_eq!((x.label.as_str(), x.unit.as_str(), x.log), ("frequency", "Hz", true));
    let s = signal(&ui, &out);
    let phase = s.phase.as_ref().unwrap();
    assert!(s.values[0].abs() < 0.1, "low-frequency gain {} dB", s.values[0]);
    assert!(*s.values.last().unwrap() < -30.0, "high-frequency gain {} dB", s.values.last().unwrap());
    assert!(phase[0].abs() < 5.0 && *phase.last().unwrap() < -80.0, "phase {phase:?}");
}

#[test]
fn internal_subcircuit_vectors_are_dropped_but_ammeter_current_is_kept() {
    let lib = core_library();
    let mut b = CircuitBuilder::new(&lib, Analysis::Op);
    let gnd = b.add("sources.ground", "GND1", &[]);
    let v1 = b.add("sources.dc_voltage", "V1", &[("voltage", "5")]);
    let am = b.add("indicators.ammeter", "AM1", &[]);
    let rv = b.add("basic.potentiometer", "RV1", &[]);
    b.connect((&v1, "p"), (&am, "p"));
    b.connect((&am, "n"), (&rv, "1"));
    b.connect((&rv, "2"), (&gnd, "1"));
    b.connect((&rv, "w"), (&gnd, "1"));
    b.connect((&v1, "n"), (&gnd, "1"));
    let project = b.build();
    let (netlist, result) = simulate(&project, &lib, &engine_config()).unwrap();
    let ui = to_ui_result(&project, &netlist, &result, MAX_POINTS);
    assert!(ui.signals.iter().any(|s| s.id == "v.xam1.vsense#branch"));
    for s in &ui.signals {
        let top_level = !s.id.contains('.') || s.id.ends_with(".vsense#branch");
        assert!(top_level, "internal vector {} leaked", s.id);
    }
}

#[test]
fn decimation_keeps_ends_extremes_and_alignment() {
    let lib = core_library();
    let project = CircuitBuilder::new(&lib, Analysis::Tran { stop: "1".into(), step: "1u".into() }).build();
    let n = 100_000;
    let time: Vec<f64> = (0..n).map(|i| i as f64 * 1e-5).collect();
    let mut wave: Vec<f64> = (0..n).map(|i| (i as f64 * 0.01).sin()).collect();
    wave[54_321] = 7.0;
    wave[12_345] = -9.0;
    let mut vectors = BTreeMap::new();
    vectors.insert("time".to_string(), Vector::Real(time.clone()));
    vectors.insert("n1".to_string(), Vector::Real(wave));
    let mut nets = Nets::default();
    nets.net_pins.insert("n1".into(), vec![("c1".into(), "1".into())]);
    let netlist = Netlist { text: String::new(), nets };
    let result = SimResult { plot: "tran1".into(), vectors, log: vec![] };

    let ui = to_ui_result(&project, &netlist, &result, 2_000);
    let x = &ui.x.as_ref().unwrap().values;
    let v = &signal(&ui, "n1").values;
    assert_eq!(x.len(), v.len());
    assert!(x.len() <= 2_002, "{} points", x.len());
    assert_eq!(x[0], 0.0);
    assert_eq!(*x.last().unwrap(), time[n - 1]);
    assert!(x.windows(2).all(|w| w[0] < w[1]));
    assert!(v.contains(&7.0) && v.contains(&-9.0));
    let at_peak = x.iter().position(|t| (*t - time[54_321]).abs() < 1e-12).unwrap();
    assert_eq!(v[at_peak], 7.0);
}
```

- [ ] **Step 3: Run to verify they fail**

Run: `cargo test -p multysm-core --test netlist --test ui_results`
Expected: compile errors — `pin` field and `results` module missing.

- [ ] **Step 4: Implement pin-level errors**

In `crates/multysm-core/src/netlist/mod.rs`, replace `NetlistError` and its impl:
```rust
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetlistError {
    pub code: ErrorCode,
    pub message: String,
    pub component_uid: Option<String>,
    /// Pin id for pin-level problems (unconnected pins).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin: Option<String>,
}

impl NetlistError {
    pub fn new(code: ErrorCode, message: String, uid: Option<&str>) -> Self {
        Self { code, message, component_uid: uid.map(str::to_string), pin: None }
    }

    pub fn with_pin(mut self, pin: &str) -> Self {
        self.pin = Some(pin.to_string());
        self
    }
}
```

In `crates/multysm-core/src/netlist/build.rs`, the unconnected-pin push becomes:
```rust
            errors.push(
                NetlistError::new(
                    ErrorCode::UnconnectedPin,
                    format!("{} pin {} is not connected", inst.reference, pin.name.as_deref().unwrap_or(&pin.id)),
                    Some(uid.as_str()),
                )
                .with_pin(&pin.id),
            );
```

Search for any other `NetlistError {` struct literals (`grep -rn "NetlistError {" crates src-tauri`) and add `pin: None` if found.

- [ ] **Step 5: Implement `results.rs`**

Create `crates/multysm-core/src/results.rs`:

```rust
//! Simulation results shaped for the UI: named signals on a shared x axis,
//! decimated so large transients stay small enough for the webview.

use serde::Serialize;

use crate::circuit::{Analysis, Project};
use crate::engine::{SimResult, Vector};
use crate::netlist::{Netlist, Nets, GROUND};

/// Upper bound on points per result sent to the UI.
pub const MAX_POINTS: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UiResult {
    pub analysis: &'static str,
    pub x: Option<UiAxis>,
    pub signals: Vec<UiSignal>,
    pub nets: Nets,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UiAxis {
    pub label: String,
    pub unit: String,
    pub values: Vec<f64>,
    pub log: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SignalKind {
    Voltage,
    Current,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UiSignal {
    /// ngspice vector name, lower case (`n3`, `v1#branch`, `v.xam1.vsense#branch`).
    pub id: String,
    pub kind: SignalKind,
    /// Real values; for AC, magnitude in dB.
    pub values: Vec<f64>,
    /// AC only: phase in degrees.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<Vec<f64>>,
}

pub fn to_ui_result(project: &Project, netlist: &Netlist, result: &SimResult, max_points: usize) -> UiResult {
    let (analysis, x) = match &project.analysis {
        Analysis::Op => ("op", None),
        Analysis::Tran { .. } => ("tran", axis(result, "time", "time", "s", false)),
        Analysis::Ac { .. } => ("ac", axis(result, "frequency", "frequency", "Hz", true)),
        Analysis::Dc { source, .. } => {
            let unit = if source.to_ascii_uppercase().starts_with('I') { "A" } else { "V" };
            let values = result
                .vectors
                .iter()
                .find(|(name, _)| name.ends_with("sweep"))
                .map(|(_, v)| real_part(v));
            ("dc", values.map(|values| UiAxis { label: source.clone(), unit: unit.into(), values, log: false }))
        }
    };

    let mut signals = Vec::new();
    for (name, vector) in &result.vectors {
        let kind = if name != GROUND && netlist.nets.net_pins.contains_key(name) {
            SignalKind::Voltage
        } else if name.ends_with("#branch") && (!name.contains('.') || name.ends_with(".vsense#branch")) {
            SignalKind::Current
        } else {
            continue;
        };
        let (values, phase) = match vector {
            Vector::Real(values) => (values.clone(), None),
            Vector::Complex(values) => (
                values.iter().map(|(re, im)| 20.0 * re.hypot(*im).max(1e-15).log10()).collect(),
                Some(values.iter().map(|(re, im)| im.atan2(*re).to_degrees()).collect()),
            ),
        };
        signals.push(UiSignal { id: name.clone(), kind, values, phase });
    }

    let mut ui = UiResult { analysis, x, signals, nets: netlist.nets.clone() };
    decimate(&mut ui, max_points);
    ui
}

fn axis(result: &SimResult, name: &str, label: &str, unit: &str, log: bool) -> Option<UiAxis> {
    result.vectors.get(name).map(|v| UiAxis { label: label.into(), unit: unit.into(), values: real_part(v), log })
}

fn real_part(vector: &Vector) -> Vec<f64> {
    match vector {
        Vector::Real(values) => values.clone(),
        Vector::Complex(values) => values.iter().map(|(re, _)| *re).collect(),
    }
}

/// Min/max decimation over index buckets. Every signal keeps its own min and
/// max per bucket; the union of those indices (plus both ends) is applied to
/// the axis and all signals so they stay aligned.
fn decimate(ui: &mut UiResult, max_points: usize) {
    let Some(len) = ui.x.as_ref().map(|x| x.values.len()) else { return };
    if len <= max_points || len == 0 {
        return;
    }
    let series: Vec<&[f64]> =
        ui.signals.iter().map(|s| s.values.as_slice()).filter(|v| v.len() == len).collect();
    let per_bucket = 2 * series.len().max(1);
    let buckets = (max_points / per_bucket).max(1);
    let size = len.div_ceil(buckets);
    let mut keep = Vec::with_capacity(max_points + 2);
    for start in (0..len).step_by(size) {
        let end = (start + size).min(len);
        if series.is_empty() {
            keep.push(start);
            keep.push(end - 1);
            continue;
        }
        for values in &series {
            let (mut lo, mut hi) = (start, start);
            for i in start..end {
                if values[i] < values[lo] {
                    lo = i;
                }
                if values[i] > values[hi] {
                    hi = i;
                }
            }
            keep.push(lo);
            keep.push(hi);
        }
    }
    keep.push(0);
    keep.push(len - 1);
    keep.sort_unstable();
    keep.dedup();

    let pick = |values: &[f64]| keep.iter().map(|&i| values[i]).collect::<Vec<f64>>();
    if let Some(x) = ui.x.as_mut() {
        x.values = pick(&x.values);
    }
    for signal in &mut ui.signals {
        if signal.values.len() == len {
            signal.values = pick(&signal.values);
        }
        if let Some(phase) = signal.phase.as_mut().filter(|p| p.len() == len) {
            *phase = pick(phase);
        }
    }
}
```

In `crates/multysm-core/src/lib.rs`, add `pub mod results;`. If `Nets` doesn't implement `Clone` or `Default`, it does (`#[derive(Debug, Clone, Default, PartialEq, Serialize)]`), so no change is needed. `Vector` and `SimResult` fields are already public.

- [ ] **Step 6: Run the tests**

Run: `cargo test --workspace`
Expected: all pass. If the DC sweep scale vector isn't named `…sweep` in this ngspice build, print `result.vectors.keys()` in the failing test, match the real name in `to_ui_result` (keep the rule general, not tied to `V1`), and note it in the report.

- [ ] **Step 7: Commit**

```bash
git add crates/multysm-core
git commit -m "feat(core): UI-shaped simulation results with decimation; pin on netlist errors"
```

---

### Task 3: Tauri simulate and stop commands

**Files:**
- Create: `src-tauri/src/simulation.rs`, `src-tauri/tests/simulation.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`

**Interfaces:**
- Consumes: `simulate_with`, `EngineError::{Stopped, Timeout}` (Task 1); `to_ui_result`, `UiResult`, `MAX_POINTS`, `NetlistError` (Task 2); `library_dto::components_root()`.
- Produces:
  - Rust: `simulation::{SimShared, SimState, SimOutcome, run_simulation, engine_config, SIM_TIMEOUT}`.
  - Tauri commands `simulate({ project }) -> SimOutcome` and `stop_simulation()`.
  - JSON: `SimOutcome` is tagged by `status`:
    - `{status:"ok", result, elapsedMs}`
    - `{status:"netlist", errors}`
    - `{status:"engine", message, log}`
    - `{status:"stopped"}`
    - `{status:"timeout", seconds}`
    - `{status:"busy"}`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/tests/simulation.rs`:

```rust
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use multysm_app_lib::library_dto::components_root;
use multysm_app_lib::simulation::{engine_config, run_simulation, SimOutcome, SimShared};
use multysm_core::project_file::parse_project;

/// V1 (10 V) -> R1 1k -> R2 1k -> ground. `ground: false` leaves out the ground part.
fn divider(analysis: &str, ground: bool) -> multysm_core::circuit::Project {
    let gnd = if ground {
        r#",{ "uid": "c4", "part": "sources.ground", "ref": "GND1", "x": 10, "y": 200, "rot": 0, "mirror": false, "params": {} }"#
    } else {
        ""
    };
    let json = format!(
        r#"{{
  "format": 1, "app": "test", "packs": [],
  "components": [
    {{ "uid": "c1", "part": "sources.dc_voltage", "ref": "V1", "x": 0, "y": 100, "rot": 0, "mirror": false, "params": {{ "voltage": "10" }} }},
    {{ "uid": "c2", "part": "basic.resistor", "ref": "R1", "x": 100, "y": 90, "rot": 0, "mirror": false, "params": {{}} }},
    {{ "uid": "c3", "part": "basic.resistor", "ref": "R2", "x": 200, "y": 90, "rot": 0, "mirror": false, "params": {{}} }}
    {gnd}
  ],
  "wires": [
    {{ "uid": "w1", "points": [[20,100],[100,100]] }},
    {{ "uid": "w2", "points": [[160,100],[200,100]] }},
    {{ "uid": "w3", "points": [[260,100],[260,200],[20,200]] }},
    {{ "uid": "w4", "points": [[20,160],[20,200]] }}
  ],
  "analysis": {analysis},
  "probes": [],
  "view": null
}}"#
    );
    parse_project(&json).unwrap_or_else(|e| panic!("{e}\n{json}"))
}

fn root() -> PathBuf {
    components_root()
}

#[test]
fn op_run_returns_ok_with_signals() {
    let shared = SimShared::default();
    let outcome = run_simulation(&shared, &divider(r#"{ "type": "op" }"#, true), &root(), &engine_config(), Duration::from_secs(30));
    let SimOutcome::Ok { result, .. } = outcome else { panic!("{outcome:?}") };
    let values: Vec<f64> = result.signals.iter().filter(|s| s.id != "v1#branch").map(|s| s.values[0]).collect();
    assert!(values.iter().any(|v| (v - 5.0).abs() < 1e-6), "{values:?}");
    assert!(values.iter().any(|v| (v - 10.0).abs() < 1e-6), "{values:?}");
    assert!(!shared.running.load(Ordering::SeqCst));
}

#[test]
fn missing_ground_is_a_netlist_outcome() {
    let shared = SimShared::default();
    let outcome = run_simulation(&shared, &divider(r#"{ "type": "op" }"#, false), &root(), &engine_config(), Duration::from_secs(30));
    let SimOutcome::Netlist { errors } = outcome else { panic!("{outcome:?}") };
    assert!(errors.iter().any(|e| e.message.contains("no ground")));
}

#[test]
fn a_second_run_while_running_is_busy() {
    let shared = SimShared::default();
    shared.running.store(true, Ordering::SeqCst);
    let outcome = run_simulation(&shared, &divider(r#"{ "type": "op" }"#, true), &root(), &engine_config(), Duration::from_secs(30));
    assert!(matches!(outcome, SimOutcome::Busy), "{outcome:?}");
    assert!(shared.running.load(Ordering::SeqCst), "a busy reply must not clear the other run's flag");
}

#[test]
fn cancel_stops_a_long_run() {
    let shared = Arc::new(SimShared::default());
    let project = divider(r#"{ "type": "tran", "stop": "100", "step": "1u" }"#, true);
    let setter = {
        let shared = shared.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            shared.cancel.store(true, Ordering::SeqCst);
        })
    };
    let started = Instant::now();
    let outcome = run_simulation(&shared, &project, &root(), &engine_config(), Duration::from_secs(30));
    setter.join().unwrap();
    assert!(matches!(outcome, SimOutcome::Stopped), "{outcome:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!shared.running.load(Ordering::SeqCst));
}

#[test]
fn outcomes_serialize_with_a_status_tag() {
    assert_eq!(serde_json::to_value(SimOutcome::Stopped).unwrap(), serde_json::json!({ "status": "stopped" }));
    assert_eq!(serde_json::to_value(SimOutcome::Busy).unwrap(), serde_json::json!({ "status": "busy" }));
    assert_eq!(
        serde_json::to_value(SimOutcome::Timeout { seconds: 30 }).unwrap(),
        serde_json::json!({ "status": "timeout", "seconds": 30 })
    );
    let engine = serde_json::to_value(SimOutcome::Engine { message: "m".into(), log: vec!["l".into()] }).unwrap();
    assert_eq!(engine, serde_json::json!({ "status": "engine", "message": "m", "log": ["l"] }));

    let shared = SimShared::default();
    let ok = run_simulation(&shared, &divider(r#"{ "type": "op" }"#, true), &root(), &engine_config(), Duration::from_secs(30));
    let json = serde_json::to_value(&ok).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(json["elapsedMs"].is_u64());
    assert!(json["result"]["signals"].is_array());
    assert!(json["result"]["nets"]["wireNet"].is_object());
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p multysm-app --test simulation`
Expected: compile error — `multysm_app_lib::simulation` doesn't exist.

- [ ] **Step 3: Implement `simulation.rs`**

Create `src-tauri/src/simulation.rs`:

```rust
//! Running simulations for the UI: one run at a time, cancellable, with a
//! cached component library.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use multysm_core::circuit::Project;
use multysm_core::engine::{EngineConfig, EngineError};
use multysm_core::library::{load_library, Library};
use multysm_core::netlist::NetlistError;
use multysm_core::results::{to_ui_result, UiResult, MAX_POINTS};
use multysm_core::{simulate_with, SimulateError};
use serde::Serialize;

pub const SIM_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SimOutcome {
    Ok {
        result: UiResult,
        #[serde(rename = "elapsedMs")]
        elapsed_ms: u64,
    },
    Netlist { errors: Vec<NetlistError> },
    Engine { message: String, log: Vec<String> },
    Stopped,
    Timeout { seconds: u64 },
    Busy,
}

struct CachedLibrary {
    stamp: Option<SystemTime>,
    library: Library,
}

#[derive(Default)]
pub struct SimShared {
    library: Mutex<Option<CachedLibrary>>,
    pub cancel: AtomicBool,
    pub running: AtomicBool,
}

/// Tauri-managed state.
#[derive(Default, Clone)]
pub struct SimState(pub Arc<SimShared>);

/// ngspice location. `MULTYSM_NGSPICE` overrides it; otherwise the repository's
/// `vendor/ngspice` is used (bundling comes with packaging).
pub fn engine_config() -> EngineConfig {
    let dir = std::env::var_os("MULTYSM_NGSPICE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor/ngspice"));
    EngineConfig::from_vendor_dir(&dir)
}

/// Clears `running` however the run ends (including a panic).
struct RunningGuard<'a>(&'a AtomicBool);

impl Drop for RunningGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub fn run_simulation(
    shared: &SimShared,
    project: &Project,
    components: &Path,
    config: &EngineConfig,
    timeout: Duration,
) -> SimOutcome {
    if shared.running.swap(true, Ordering::SeqCst) {
        return SimOutcome::Busy;
    }
    let _guard = RunningGuard(&shared.running);
    shared.cancel.store(false, Ordering::SeqCst);
    let started = Instant::now();

    shared.with_library(components, |library| {
        match simulate_with(project, library, config, &shared.cancel, Some(timeout)) {
            Ok((netlist, result)) => SimOutcome::Ok {
                result: to_ui_result(project, &netlist, &result, MAX_POINTS),
                elapsed_ms: started.elapsed().as_millis() as u64,
            },
            Err(SimulateError::Netlist(errors)) => SimOutcome::Netlist { errors },
            Err(SimulateError::Engine(EngineError::Stopped)) => SimOutcome::Stopped,
            Err(SimulateError::Engine(EngineError::Timeout { seconds })) => SimOutcome::Timeout { seconds },
            Err(SimulateError::Engine(error)) => SimOutcome::Engine {
                message: error.to_string(),
                log: error.log().map(<[String]>::to_vec).unwrap_or_default(),
            },
        }
    })
}

impl SimShared {
    fn with_library<T>(&self, root: &Path, f: impl FnOnce(&Library) -> T) -> T {
        let stamp = newest_mtime(root);
        let mut cache = self.library.lock().unwrap_or_else(|e| e.into_inner());
        let fresh = matches!(&*cache, Some(c) if stamp.is_some() && c.stamp == stamp);
        if !fresh {
            *cache = Some(CachedLibrary { stamp, library: load_library(&[root.to_path_buf()]) });
        }
        f(&cache.as_ref().expect("library cached above").library)
    }
}

fn newest_mtime(dir: &Path) -> Option<SystemTime> {
    let mut newest = fs::metadata(dir).and_then(|m| m.modified()).ok();
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let stamp = if path.is_dir() {
            newest_mtime(&path)
        } else {
            entry.metadata().and_then(|m| m.modified()).ok()
        };
        newest = newest.max(stamp);
    }
    newest
}
```

- [ ] **Step 4: Add the commands and register them**

Append to `src-tauri/src/commands.rs`:
```rust
use crate::simulation::{engine_config, run_simulation, SimOutcome, SimState, SIM_TIMEOUT};

#[tauri::command]
pub async fn simulate(state: tauri::State<'_, SimState>, project: Project) -> Result<SimOutcome, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_simulation(&shared, &project, &components_root(), &engine_config(), SIM_TIMEOUT)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_simulation(state: tauri::State<'_, SimState>) {
    state.0.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
}
```
(Move the new `use` line up with the other imports.)

In `src-tauri/src/lib.rs`: add `pub mod simulation;`, `.manage(simulation::SimState::default())` before `.invoke_handler`, and `commands::simulate, commands::stop_simulation,` to `generate_handler!`.

- [ ] **Step 5: Run the tests**

Run: `cargo test --workspace`
Expected: all pass. If `parse_project` rejects the test JSON, fix the fixture to match `schemas/project.schema.json` (not the schema) and note it.

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git commit -m "feat(app): simulate and stop_simulation Tauri commands"
```

---

### Task 4: Frontend simulation types and backends

**Files:**
- Create: `app/src/model/simTypes.ts`, `app/src/backend/mockSimulation.ts`, `app/src/backend/mockSimulation.test.ts`, `app/src/test/fixtures.ts`
- Modify: `app/src/backend/backend.ts`, `app/src/backend/tauriBackend.ts`, `app/src/backend/mockBackend.ts`

**Interfaces:**
- Consumes: JSON shapes from Task 3; `partMap`, `pinPoints` (`@/model/wiring`); `pinPosition`, `pointOnSegment`, `samePoint` (`@/model/geometry`); `parseSi`.
- Produces: the TS types `SimOutcome`, `UiResult`, `UiSignal`, `UiAxis`, `NetsData`, `PinNet`, `NetlistError`, `ErrorCode`, `SignalKind`; `Backend.simulate(project): Promise<SimOutcome>`, `Backend.stopSimulation(): Promise<void>`; `mockNets(project, parts): NetsData`; `mockSimulate(project, library): SimOutcome`. Test fixture `dividerProject(withGround?: boolean): Project` in `app/src/test/fixtures.ts`.

- [ ] **Step 1: Write the types**

Create `app/src/model/simTypes.ts`:

```ts
/** Simulation shapes shared with the Rust backend (serde JSON). */

export type SignalKind = "voltage" | "current";

export interface UiAxis {
  label: string;
  unit: string;
  values: number[];
  log: boolean;
}

export interface UiSignal {
  /** ngspice vector name, lower case: "n3", "v1#branch", "v.xam1.vsense#branch". */
  id: string;
  kind: SignalKind;
  /** Real values; for AC, magnitude in dB. */
  values: number[];
  /** AC only: phase in degrees. */
  phase?: number[];
}

export interface PinNet {
  uid: string;
  pin: string;
  net: string;
}

export interface NetsData {
  pinNet: PinNet[];
  netPins: Record<string, { uid: string; pin: string }[]>;
  wireNet: Record<string, string>;
}

export interface UiResult {
  analysis: "op" | "tran" | "ac" | "dc";
  x: UiAxis | null;
  signals: UiSignal[];
  nets: NetsData;
}

export type ErrorCode =
  | "unknown_part" | "no_ground" | "unconnected_pin" | "invalid_param" | "template" | "model_file"
  | "bad_analysis" | "invalid_reference" | "duplicate_reference" | "ref_prefix_mismatch" | "invalid_rotation";

export interface NetlistError {
  code: ErrorCode;
  message: string;
  componentUid: string | null;
  pin?: string;
}

export type SimOutcome =
  | { status: "ok"; result: UiResult; elapsedMs: number }
  | { status: "netlist"; errors: NetlistError[] }
  | { status: "engine"; message: string; log: string[] }
  | { status: "stopped" }
  | { status: "timeout"; seconds: number }
  | { status: "busy" };

/** The ground net name. */
export const GROUND_NET = "0";
```

- [ ] **Step 2: Write the failing mock tests**

Create `app/src/test/fixtures.ts`:

```ts
import { emptyProject, type Project } from "@/model/types";

/** V1 (10 V) -> R1 -> R2 -> ground, same layout as the Rust command tests. */
export function dividerProject(withGround = true): Project {
  const project = emptyProject();
  project.components = [
    { uid: "c1", part: "sources.dc_voltage", ref: "V1", x: 0, y: 100, rot: 0, mirror: false, params: { voltage: "10" } },
    { uid: "c2", part: "basic.resistor", ref: "R1", x: 100, y: 90, rot: 0, mirror: false, params: {} },
    { uid: "c3", part: "basic.resistor", ref: "R2", x: 200, y: 90, rot: 0, mirror: false, params: {} },
    ...(withGround ? [{ uid: "c4", part: "sources.ground", ref: "GND1", x: 10, y: 200, rot: 0 as const, mirror: false, params: {} }] : []),
  ];
  project.wires = [
    { uid: "w1", points: [[20, 100], [100, 100]] },
    { uid: "w2", points: [[160, 100], [200, 100]] },
    { uid: "w3", points: [[260, 100], [260, 200], [20, 200]] },
    { uid: "w4", points: [[20, 160], [20, 200]] },
  ];
  return project;
}
```

Create `app/src/backend/mockSimulation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { testLibrary } from "@/test/resetEditor";
import { partMap } from "@/model/wiring";
import { mockNets, mockSimulate } from "./mockSimulation";

const parts = partMap(testLibrary);

describe("mockNets", () => {
  it("groups pins joined by wires and names the ground net 0", () => {
    const nets = mockNets(dividerProject(), parts);
    const netOf = (uid: string, pin: string) => nets.pinNet.find((p) => p.uid === uid && p.pin === pin)!.net;
    expect(netOf("c1", "p")).toBe(netOf("c2", "1"));
    expect(netOf("c2", "2")).toBe(netOf("c3", "1"));
    expect(netOf("c3", "2")).toBe("0");
    expect(netOf("c1", "n")).toBe("0");
    expect(netOf("c1", "p")).not.toBe(netOf("c2", "2"));
    expect(nets.wireNet.w2).toBe(netOf("c2", "2"));
    expect(nets.netPins["0"]).toHaveLength(3);
  });
});

describe("mockSimulate", () => {
  it("reports a missing ground", () => {
    const outcome = mockSimulate(dividerProject(false), testLibrary);
    expect(outcome.status).toBe("netlist");
    if (outcome.status !== "netlist") return;
    expect(outcome.errors.some((e) => e.code === "no_ground" && e.componentUid === null)).toBe(true);
  });

  it("reports unconnected pins with the pin id", () => {
    const project = dividerProject();
    project.components.push({ uid: "c5", part: "basic.resistor", ref: "R3", x: 400, y: 400, rot: 0, mirror: false, params: {} });
    const outcome = mockSimulate(project, testLibrary);
    expect(outcome.status).toBe("netlist");
    if (outcome.status !== "netlist") return;
    const errors = outcome.errors.filter((e) => e.code === "unconnected_pin");
    expect(errors.map((e) => [e.componentUid, e.pin])).toEqual([["c5", "1"], ["c5", "2"]]);
    expect(errors[0].message).toBe("R3 pin 1 is not connected");
  });

  it("returns one point per net for an operating point", () => {
    const project = dividerProject();
    project.analysis = { type: "op" };
    const outcome = mockSimulate(project, testLibrary);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.analysis).toBe("op");
    expect(outcome.result.x).toBeNull();
    const voltages = outcome.result.signals.filter((s) => s.kind === "voltage");
    expect(voltages).toHaveLength(2);
    expect(voltages.every((s) => s.values.length === 1)).toBe(true);
    expect(outcome.result.signals.some((s) => s.id === "v1#branch")).toBe(true);
  });

  it("returns 200-point curves for a transient", () => {
    const outcome = mockSimulate(dividerProject(), testLibrary);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.x?.values).toHaveLength(200);
    expect(outcome.result.x?.unit).toBe("s");
    expect(outcome.result.signals[0].values).toHaveLength(200);
  });

  it("returns log-frequency sweeps with phase for AC", () => {
    const project = dividerProject();
    project.analysis = { type: "ac", start: "10", stop: "100k", pointsPerDecade: 10 };
    const outcome = mockSimulate(project, testLibrary);
    if (outcome.status !== "ok") throw new Error(outcome.status);
    expect(outcome.result.x?.log).toBe(true);
    expect(outcome.result.signals.find((s) => s.kind === "voltage")?.phase).toHaveLength(50);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm --prefix app test -- mockSimulation`
Expected: FAIL — cannot resolve `./mockSimulation`.

- [ ] **Step 4: Implement the mock**

Create `app/src/backend/mockSimulation.ts`:

```ts
import { pinPosition, pointOnSegment, samePoint } from "@/model/geometry";
import { parseSi } from "@/model/si";
import { GROUND_NET, type NetlistError, type NetsData, type SimOutcome, type UiResult, type UiSignal } from "@/model/simTypes";
import type { LibraryData, PartDef, Point, Project } from "@/model/types";
import { partMap } from "@/model/wiring";

/** Connectivity with the same rules as multysm-core `build_nets` (enough for the mock). */
export function mockNets(project: Project, parts: Map<string, PartDef>): NetsData {
  const points: Point[] = [];
  const parent: number[] = [];
  const idOf = (p: Point) => {
    const found = points.findIndex((q) => samePoint(q, p));
    if (found !== -1) return found;
    points.push(p);
    parent.push(points.length - 1);
    return points.length - 1;
  };
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  const pins: { uid: string; pin: string; id: number; ground: boolean }[] = [];
  for (const inst of project.components) {
    const part = parts.get(inst.part);
    if (!part) continue;
    for (const pin of part.manifest.symbol.pins) {
      pins.push({ uid: inst.uid, pin: pin.id, id: idOf(pinPosition(inst, pin)), ground: part.manifest.spice.kind === "ground" });
    }
  }
  for (const wire of project.wires) {
    const ids = wire.points.map(idOf);
    for (let i = 1; i < ids.length; i++) union(ids[i - 1], ids[i]);
  }
  for (const wire of project.wires) {
    for (let i = 1; i < wire.points.length; i++) {
      const a = wire.points[i - 1];
      const b = wire.points[i];
      points.forEach((p, id) => { if (pointOnSegment(p, a, b)) union(id, idOf(a)); });
    }
  }

  const names = new Map<number, string>();
  for (const pin of pins) if (pin.ground) names.set(find(pin.id), GROUND_NET);
  let next = 1;
  for (const pin of pins) {
    const root = find(pin.id);
    if (!names.has(root)) names.set(root, `n${next++}`);
  }

  const pinNet = pins.map((p) => ({ uid: p.uid, pin: p.pin, net: names.get(find(p.id))! }));
  const netPins: NetsData["netPins"] = {};
  for (const p of pinNet) (netPins[p.net] ??= []).push({ uid: p.uid, pin: p.pin });
  const wireNet: NetsData["wireNet"] = {};
  for (const wire of project.wires) {
    const name = names.get(find(idOf(wire.points[0])));
    if (name) wireNet[wire.uid] = name;
  }
  return { pinNet, netPins, wireNet };
}

const SOURCE_PARTS = new Set(["sources.dc_voltage", "sources.dc_current", "sources.ac_voltage", "sources.ac_current", "sources.pulse_voltage", "sources.vcc"]);

function netlistErrors(project: Project, parts: Map<string, PartDef>, nets: NetsData): NetlistError[] {
  const errors: NetlistError[] = [];
  if (!nets.netPins[GROUND_NET]) {
    errors.push({ code: "no_ground", message: "The circuit has no ground. Add a Ground part.", componentUid: null });
  }
  for (const [net, members] of Object.entries(nets.netPins)) {
    if (net === GROUND_NET || members.length !== 1) continue;
    const { uid, pin } = members[0];
    const inst = project.components.find((c) => c.uid === uid)!;
    const def = parts.get(inst.part)!.manifest.symbol.pins.find((p) => p.id === pin)!;
    if (def.optional) continue;
    errors.push({ code: "unconnected_pin", message: `${inst.ref} pin ${def.name ?? def.id} is not connected`, componentUid: uid, pin });
  }
  return errors;
}

const range = (n: number, f: (k: number) => number) => Array.from({ length: n }, (_, k) => f(k));
const si = (text: string, fallback: number) => {
  const parsed = parseSi(text);
  return parsed.ok ? parsed.value : fallback;
};

/** Deterministic fake results so the UI works in a plain browser and in tests. */
export function mockSimulate(project: Project, library: LibraryData | null): SimOutcome {
  const parts = partMap(library);
  const nets = mockNets(project, parts);
  const errors = netlistErrors(project, parts, nets);
  if (errors.length > 0) return { status: "netlist", errors };

  const netNames = Object.keys(nets.netPins).filter((n) => n !== GROUND_NET);
  const level = (i: number) => (5 * (i + 1)) / netNames.length;
  const analysis = project.analysis;
  let x: UiResult["x"] = null;
  let shape: (k: number) => number = () => 1;
  let count = 1;
  if (analysis.type === "tran") {
    const stop = si(analysis.stop, 0.01);
    count = 200;
    x = { label: "time", unit: "s", values: range(count, (k) => (stop * k) / (count - 1)), log: false };
    const values = x.values;
    shape = (k) => 1 - Math.exp(-values[k] / (stop / 5));
  } else if (analysis.type === "ac") {
    const start = si(analysis.start, 10);
    const stop = si(analysis.stop, 1e5);
    count = 50;
    x = { label: "frequency", unit: "Hz", values: range(count, (k) => start * (stop / start) ** (k / (count - 1))), log: true };
  } else if (analysis.type === "dc") {
    const start = si(analysis.start, 0);
    const stop = si(analysis.stop, 5);
    count = 50;
    const unit = project.components.find((c) => c.ref === analysis.source)?.part === "sources.dc_current" ? "A" : "V";
    x = { label: analysis.source, unit, values: range(count, (k) => start + ((stop - start) * k) / (count - 1)), log: false };
    shape = (k) => k / (count - 1);
  }

  const signals: UiSignal[] = netNames.map((net, i) => {
    if (analysis.type === "ac" && x) {
      const fc = Math.sqrt(x.values[0] * x.values[x.values.length - 1]);
      const freqs = x.values;
      return {
        id: net,
        kind: "voltage",
        values: freqs.map((f) => 20 * Math.log10(1 / Math.sqrt(1 + (f / fc) ** 2)) - i),
        phase: freqs.map((f) => (-Math.atan(f / fc) * 180) / Math.PI),
      };
    }
    return { id: net, kind: "voltage", values: range(count, (k) => level(i) * shape(k)) };
  });
  for (const inst of project.components) {
    if (SOURCE_PARTS.has(inst.part)) {
      signals.push({ id: `${inst.ref.toLowerCase()}#branch`, kind: "current", values: range(count, () => -0.001) });
    } else if (inst.part === "indicators.ammeter") {
      signals.push({ id: `v.x${inst.ref.toLowerCase()}.vsense#branch`, kind: "current", values: range(count, () => 0.005) });
    }
  }
  return { status: "ok", result: { analysis: analysis.type, x, signals, nets }, elapsedMs: 12 };
}
```

- [ ] **Step 5: Extend the backends**

In `app/src/backend/backend.ts`, import `SimOutcome` from `@/model/simTypes` and add to `Backend`:
```ts
  simulate(project: Project): Promise<SimOutcome>;
  stopSimulation(): Promise<void>;
```

In `app/src/backend/tauriBackend.ts` add:
```ts
  simulate: (project) => invoke<SimOutcome>("simulate", { project }),
  stopSimulation: () => invoke<void>("stop_simulation"),
```

In `app/src/backend/mockBackend.ts`, import `mockSimulate`, keep a `let library: LibraryData | null = null;` set inside `loadLibrary`, and add:
```ts
    simulate: async (project) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return mockSimulate(project, library);
    },
    stopSimulation: async () => {},
```
`loadLibrary` becomes: `loadLibrary: async () => (library = structuredClone(libraryJson) as unknown as LibraryData),`.

- [ ] **Step 6: Run the tests**

Run: `npm --prefix app test && npx --prefix app tsc --noEmit -p app`
Expected: all pass; no type errors (the existing `backend.test.ts` may need no change; if its fake backends must satisfy `Backend`, add the two methods to them).

- [ ] **Step 7: Commit**

```bash
git add app/src/model/simTypes.ts app/src/backend app/src/test/fixtures.ts
git commit -m "feat(app): simulation types, Tauri calls and a mock simulator"
```

---

### Task 5: Store simulation slice, analysis and probe edits

**Files:**
- Modify: `app/src/model/store.ts`, `app/src/model/store.test.ts`, `app/src/test/resetEditor.ts`

**Interfaces:**
- Consumes: `SimOutcome` (Task 4).
- Produces:
  - `type SimStatus = "idle" | "running" | "done" | "failed" | "stopped"`
  - `interface SimSlice { status: SimStatus; outcome: SimOutcome | null; stale: boolean; startedAt: number | null; runProject: Project | null }`
  - `idleSim(): SimSlice`
  - `EditorState.sim`, plus the actions `startRun()`, `finishRun(outcome: SimOutcome)`, `setAnalysis(analysis: Analysis)` and `toggleProbe(ref: string)`.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe` of `app/src/model/store.test.ts` (it builds a store `s()` over `createEditorStore({ library })`; follow the file's existing setup helpers):

```ts
  it("runs through the simulation states without touching history or dirty", () => {
    const past = s().past;
    s().startRun();
    expect(s().sim.status).toBe("running");
    expect(s().sim.startedAt).not.toBeNull();
    s().finishRun({ status: "stopped" });
    expect(s().sim.status).toBe("stopped");
    s().finishRun({ status: "netlist", errors: [] });
    expect(s().sim.status).toBe("failed");
    s().finishRun({ status: "busy" });
    expect(s().sim.status).toBe("failed");
    expect(s().past).toBe(past);
    expect(s().dirty).toBe(false);
  });

  it("opens the plot dock after a successful non-op run", () => {
    const ok = (analysis: "op" | "tran") => ({
      status: "ok" as const,
      elapsedMs: 5,
      result: { analysis, x: null, signals: [], nets: { pinNet: [], netPins: {}, wireNet: {} } },
    });
    s().startRun();
    s().finishRun(ok("op"));
    expect(s().panels.plot).toBe(false);
    expect(s().sim.status).toBe("done");
    s().startRun();
    s().finishRun(ok("tran"));
    expect(s().panels.plot).toBe(true);
  });

  it("marks results stale on circuit edits and undo, not on view, selection or probes", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().startRun();
    s().finishRun({ status: "stopped" });
    expect(s().sim.stale).toBe(false);
    s().setView(2, [5, 5]);
    s().select(null);
    s().toggleProbe(`pin:${uid}:1`);
    expect(s().sim.stale).toBe(false);
    s().setParam(uid, "resistance", "2k");
    expect(s().sim.stale).toBe(true);
    s().startRun();
    s().finishRun({ status: "stopped" });
    expect(s().sim.stale).toBe(false);
    s().undo();
    expect(s().sim.stale).toBe(true);
  });

  it("marks a result stale when the circuit changed during the run", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().startRun();
    s().setParam(uid, "resistance", "2k");
    s().finishRun({ status: "stopped" });
    expect(s().sim.stale).toBe(true);
  });

  it("sets the analysis as an undoable edit and ignores no-ops", () => {
    s().setAnalysis({ type: "op" });
    expect(s().project.analysis).toEqual({ type: "op" });
    expect(s().dirty).toBe(true);
    const past = s().past.length;
    s().setAnalysis({ type: "op" });
    expect(s().past.length).toBe(past);
    s().undo();
    expect(s().project.analysis.type).toBe("tran");
  });

  it("toggles probes as undoable edits", () => {
    s().toggleProbe("pin:c1:1");
    expect(s().project.probes).toEqual(["pin:c1:1"]);
    s().toggleProbe("pin:c1:1");
    expect(s().project.probes).toEqual([]);
    s().undo();
    expect(s().project.probes).toEqual(["pin:c1:1"]);
  });

  it("resets the simulation when a project is created or loaded", () => {
    s().startRun();
    s().newProject();
    expect(s().sim).toEqual(idleSim());
  });
```
Add `idleSim` to the import from `./store`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix app test -- store`
Expected: FAIL — `sim`, `startRun`, `idleSim` etc. undefined.

- [ ] **Step 3: Implement**

In `app/src/model/store.ts`:

Imports: add `Analysis` to the types import and `import type { SimOutcome } from "./simTypes";`.

Add types and helper above `EditorState`:
```ts
export type SimStatus = "idle" | "running" | "done" | "failed" | "stopped";

export interface SimSlice {
  status: SimStatus;
  outcome: SimOutcome | null;
  /** The circuit changed since the outcome was produced. */
  stale: boolean;
  startedAt: number | null;
  /** Project the running (or last) run was started with. */
  runProject: Project | null;
}

export const idleSim = (): SimSlice => ({ status: "idle", outcome: null, stale: false, startedAt: null, runProject: null });
```

In `EditorState` add `sim: SimSlice;` and the actions:
```ts
  startRun(): void;
  finishRun(outcome: SimOutcome): void;
  setAnalysis(analysis: Analysis): void;
  toggleProbe(ref: string): void;
```

`freshSession` gains `sim: idleSim(),`.

Change `commit` to:
```ts
    const commit = (mutate: (draft: Project) => void, options: { stale?: boolean } = {}) => {
      const { project, past, sim } = get();
      const draft = structuredClone(project);
      mutate(draft);
      set({
        project: draft,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
        sim: options.stale === false ? sim : { ...sim, stale: true },
      });
    };
    const staleSim = () => ({ ...get().sim, stale: true });
```

Then:
- `beginChange`: add `sim: staleSim()` to its `set`.
- `moveComponent`: inside the `set((state) => ({ … }))`, add `sim: { ...state.sim, stale: true },`.
- `undo` and `redo`: add `sim: staleSim()` to their `set`.

Add the actions:
```ts
      startRun: () => set({ sim: { status: "running", outcome: get().sim.outcome, stale: get().sim.stale, startedAt: Date.now(), runProject: get().project } }),

      finishRun: (outcome) => {
        const { sim, project, panels } = get();
        const status: SimStatus = outcome.status === "ok" ? "done" : outcome.status === "stopped" ? "stopped" : "failed";
        const openPlot = outcome.status === "ok" && outcome.result.analysis !== "op";
        set({
          sim: { status, outcome, stale: sim.runProject !== null && sim.runProject !== project, startedAt: null, runProject: sim.runProject },
          panels: openPlot ? { ...panels, plot: true } : panels,
        });
      },

      setAnalysis: (analysis) => {
        if (JSON.stringify(get().project.analysis) === JSON.stringify(analysis)) return;
        commit((d) => { d.analysis = analysis; });
      },

      toggleProbe: (ref) => commit((d) => {
        d.probes = d.probes.includes(ref) ? d.probes.filter((p) => p !== ref) : [...d.probes, ref];
      }, { stale: false }),
```

Note: `finishRun` compares by identity. `runProject` is the project object when the run started, and every edit replaces `project` with a new object, so an identity change means the circuit was edited. `toggleProbe` also replaces the object, so a probe toggle during a run marks the finished result stale. That's harmless: the plot is merely dimmed until the next run. The test above doesn't toggle probes during a run.

In `app/src/test/resetEditor.ts`, import `idleSim` and add `sim: idleSim(),` to the `setState` object.

- [ ] **Step 4: Run the tests**

Run: `npm --prefix app test && npx --prefix app tsc --noEmit -p app`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/model/store.ts app/src/model/store.test.ts app/src/test/resetEditor.ts
git commit -m "feat(app): simulation state, analysis and probe edits in the store"
```

---

### Task 6: Value formatting, analysis model and the analysis picker

**Files:**
- Create: `app/src/model/format.ts`, `app/src/model/format.test.ts`, `app/src/model/analysis.ts`, `app/src/model/analysis.test.ts`, `app/src/ui/AnalysisPicker.tsx`, `app/src/ui/AnalysisPicker.test.tsx`
- Modify: `app/src/ui/TopBar.tsx`

**Interfaces:**
- Consumes: `setAnalysis` (Task 5); `parseSi`; `Analysis`, `LibraryData`, `Project`.
- Produces:
  - `formatValue(value: number, unit: string, options?: { trim?: boolean }): string`
  - `ANALYSIS_DEFAULTS: { op; tran; ac; dc }`
  - `analysisSummary(analysis: Analysis): string`
  - `dcSources(project: Project): string[]`
  - `analysisProblem(analysis: Analysis, project: Project, library: LibraryData | null): string | null`
  - `AnalysisPicker` (default export, no props): a button whose accessible name is the summary, and a popover `role="dialog"` named "Analysis".

- [ ] **Step 1: Write the failing model tests**

Create `app/src/model/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatValue } from "./format";

describe("formatValue", () => {
  it("uses three significant figures and engineering prefixes", () => {
    expect(formatValue(4.9712, "V")).toBe("4.97 V");
    expect(formatValue(0.0033, "V")).toBe("3.30 mV");
    expect(formatValue(-12, "V")).toBe("−12.0 V");
    expect(formatValue(0, "V")).toBe("0 V");
    expect(formatValue(0.005, "A")).toBe("5.00 mA");
    expect(formatValue(1e5, "Hz")).toBe("100 kHz");
    expect(formatValue(2.2e-7, "s")).toBe("220 ns");
    expect(formatValue(0.99996, "V")).toBe("1.00 V");
    expect(formatValue(999.96, "Hz")).toBe("1.00 kHz");
  });

  it("can trim trailing zeros", () => {
    expect(formatValue(0.01, "s", { trim: true })).toBe("10 ms");
    expect(formatValue(10, "Hz", { trim: true })).toBe("10 Hz");
    expect(formatValue(2.5e-3, "s", { trim: true })).toBe("2.5 ms");
  });

  it("handles non-finite values", () => {
    expect(formatValue(Number.NaN, "V")).toBe("— V");
  });
});
```

Create `app/src/model/analysis.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { testLibrary } from "@/test/resetEditor";
import { emptyProject, type Project } from "./types";
import { ANALYSIS_DEFAULTS, analysisProblem, analysisSummary, dcSources } from "./analysis";

const withParts = (...parts: [string, string][]): Project => {
  const project = emptyProject();
  project.components = parts.map(([part, ref], i) => ({ uid: `c${i + 1}`, part, ref, x: 0, y: 0, rot: 0, mirror: false, params: {} }));
  return project;
};

describe("analysisSummary", () => {
  it("describes each analysis in plain words", () => {
    expect(analysisSummary({ type: "op" })).toBe("Operating point");
    expect(analysisSummary(ANALYSIS_DEFAULTS.tran)).toBe("Transient · 10 ms");
    expect(analysisSummary(ANALYSIS_DEFAULTS.ac)).toBe("AC · 10 Hz–100 kHz");
    expect(analysisSummary({ ...ANALYSIS_DEFAULTS.dc, source: "V1" })).toBe("DC sweep · V1 0→5 V");
    expect(analysisSummary({ type: "tran", stop: "oops", step: "1u" })).toBe("Transient · oops");
  });
});

describe("dcSources", () => {
  it("lists DC voltage and current source references in order", () => {
    const project = withParts(["basic.resistor", "R1"], ["sources.dc_current", "I1"], ["sources.dc_voltage", "V1"], ["sources.ac_voltage", "V2"]);
    expect(dcSources(project)).toEqual(["I1", "V1"]);
  });
});

describe("analysisProblem", () => {
  const project = withParts(["sources.dc_voltage", "V1"]);
  it("accepts the defaults", () => {
    expect(analysisProblem(ANALYSIS_DEFAULTS.tran, project, testLibrary)).toBeNull();
    expect(analysisProblem(ANALYSIS_DEFAULTS.ac, project, testLibrary)).toBeNull();
    expect(analysisProblem({ type: "op" }, project, testLibrary)).toBeNull();
    expect(analysisProblem({ ...ANALYSIS_DEFAULTS.dc, source: "V1" }, project, testLibrary)).toBeNull();
  });

  it("explains invalid settings", () => {
    expect(analysisProblem({ type: "tran", stop: "abc", step: "1u" }, project, testLibrary)).toMatch(/^Stop time: /);
    expect(analysisProblem({ type: "tran", stop: "1m", step: "2m" }, project, testLibrary)).toBe("Max step must not exceed the stop time");
    expect(analysisProblem({ type: "tran", stop: "1m", step: "0" }, project, testLibrary)).toBe("Max step must be greater than 0");
    expect(analysisProblem({ type: "ac", start: "1k", stop: "10", pointsPerDecade: 10 }, project, testLibrary)).toBe("Start frequency must be below the stop frequency");
    expect(analysisProblem({ type: "ac", start: "10", stop: "1k", pointsPerDecade: 0 }, project, testLibrary)).toBe("Points per decade must be a whole number from 1 to 1000");
    expect(analysisProblem({ ...ANALYSIS_DEFAULTS.dc, source: "V9" }, project, testLibrary)).toBe("Pick a source.");
    expect(analysisProblem({ ...ANALYSIS_DEFAULTS.dc, source: "" }, emptyProject(), testLibrary)).toBe("Add a DC voltage or current source to sweep.");
    expect(analysisProblem({ type: "dc", source: "V1", start: "1", stop: "1", step: "0.1" }, project, testLibrary)).toBe("Start and stop must differ");
  });

  it("waits for the library", () => {
    expect(analysisProblem({ type: "op" }, project, null)).toBe("Loading parts…");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix app test -- format analysis`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the models**

Create `app/src/model/format.ts`:
```ts
const PREFIXES: [number, string][] = [
  [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"],
];

/** Engineering notation with 3 significant figures, e.g. `4.97 V`, `3.30 mV`, `−12.0 V`. */
export function formatValue(value: number, unit: string, options: { trim?: boolean } = {}): string {
  if (!Number.isFinite(value)) return `— ${unit}`;
  const abs = Math.abs(value);
  if (abs < 1e-18) return `0 ${unit}`;
  let i = PREFIXES.findIndex(([scale]) => abs >= scale);
  if (i === -1) i = PREFIXES.length - 1;
  let text = (abs / PREFIXES[i][0]).toPrecision(3);
  if (Number(text) >= 1000 && i > 0) {
    i -= 1;
    text = (abs / PREFIXES[i][0]).toPrecision(3);
  }
  if (options.trim) text = String(Number(text));
  return `${value < 0 ? "−" : ""}${text} ${PREFIXES[i][1]}${unit}`;
}
```

Create `app/src/model/analysis.ts`:
```ts
import { formatValue } from "./format";
import { parseSi } from "./si";
import type { Analysis, LibraryData, Project } from "./types";

export const ANALYSIS_DEFAULTS = {
  op: { type: "op" },
  tran: { type: "tran", stop: "10m", step: "10u" },
  ac: { type: "ac", start: "10", stop: "100k", pointsPerDecade: 10 },
  dc: { type: "dc", source: "", start: "0", stop: "5", step: "0.1" },
} as const satisfies Record<Analysis["type"], Analysis>;

const DC_SOURCE_PARTS = ["sources.dc_voltage", "sources.dc_current"];

export function dcSources(project: Project): string[] {
  return project.components.filter((c) => DC_SOURCE_PARTS.includes(c.part)).map((c) => c.ref);
}

export function dcSweepUnit(project: Project, source: string): "V" | "A" {
  return project.components.find((c) => c.ref === source)?.part === "sources.dc_current" ? "A" : "V";
}

const short = (text: string, unit: string) => {
  const parsed = parseSi(text);
  return parsed.ok ? formatValue(parsed.value, unit, { trim: true }) : text;
};

export function analysisSummary(analysis: Analysis): string {
  switch (analysis.type) {
    case "op": return "Operating point";
    case "tran": return `Transient · ${short(analysis.stop, "s")}`;
    case "ac": return `AC · ${short(analysis.start, "Hz")}–${short(analysis.stop, "Hz")}`;
    case "dc": {
      const unit = analysis.source.toUpperCase().startsWith("I") ? "A" : "V";
      return `DC sweep · ${analysis.source} ${short(analysis.start, "").trim()}→${short(analysis.stop, unit)}`;
    }
  }
}

function value(label: string, text: string): { ok: true; value: number } | { ok: false; problem: string } {
  const parsed = parseSi(text);
  return parsed.ok ? parsed : { ok: false, problem: `${label}: ${parsed.error}` };
}

/** Why the analysis can't run, or null when it can. */
export function analysisProblem(analysis: Analysis, project: Project, library: LibraryData | null): string | null {
  if (!library) return "Loading parts…";
  switch (analysis.type) {
    case "op":
      return null;
    case "tran": {
      const stop = value("Stop time", analysis.stop);
      if (!stop.ok) return stop.problem;
      const step = value("Max step", analysis.step);
      if (!step.ok) return step.problem;
      if (stop.value <= 0) return "Stop time must be greater than 0";
      if (step.value <= 0) return "Max step must be greater than 0";
      if (step.value > stop.value) return "Max step must not exceed the stop time";
      return null;
    }
    case "ac": {
      const start = value("Start frequency", analysis.start);
      if (!start.ok) return start.problem;
      const stop = value("Stop frequency", analysis.stop);
      if (!stop.ok) return stop.problem;
      if (start.value <= 0) return "Start frequency must be greater than 0";
      if (start.value >= stop.value) return "Start frequency must be below the stop frequency";
      if (!Number.isInteger(analysis.pointsPerDecade) || analysis.pointsPerDecade < 1 || analysis.pointsPerDecade > 1000) {
        return "Points per decade must be a whole number from 1 to 1000";
      }
      return null;
    }
    case "dc": {
      const sources = dcSources(project);
      if (sources.length === 0) return "Add a DC voltage or current source to sweep.";
      if (!sources.includes(analysis.source)) return "Pick a source.";
      const start = value("Start", analysis.start);
      if (!start.ok) return start.problem;
      const stop = value("Stop", analysis.stop);
      if (!stop.ok) return stop.problem;
      const step = value("Step", analysis.step);
      if (!step.ok) return step.problem;
      if (step.value <= 0) return "Step must be greater than 0";
      if (start.value === stop.value) return "Start and stop must differ";
      return null;
    }
  }
}
```

(`library` is only checked for presence here. Parts are recognized by id, so no manifest lookup is needed.)

Run: `npm --prefix app test -- format analysis`
Expected: PASS.

- [ ] **Step 4: Write the failing picker tests**

Create `app/src/ui/AnalysisPicker.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import AnalysisPicker from "./AnalysisPicker";

const state = () => editorStore.getState();
const open = () => fireEvent.click(screen.getByRole("button", { name: /Transient|Operating point|AC ·|DC sweep/ }));

beforeEach(() => resetEditor());

describe("AnalysisPicker", () => {
  it("shows the current analysis and opens the settings", () => {
    render(<AnalysisPicker />);
    expect(screen.getByRole("button", { name: "Transient · 10 ms" })).toBeTruthy();
    open();
    expect(screen.getByRole("dialog", { name: "Analysis" })).toBeTruthy();
    expect((screen.getByLabelText("Stop time") as HTMLInputElement).value).toBe("10m");
  });

  it("switches analysis type with defaults and remembers typed values", () => {
    render(<AnalysisPicker />);
    open();
    const stop = screen.getByLabelText("Stop time");
    fireEvent.change(stop, { target: { value: "20m" } });
    fireEvent.keyDown(stop, { key: "Enter" });
    expect(state().project.analysis).toEqual({ type: "tran", stop: "20m", step: "10u" });
    fireEvent.click(screen.getByLabelText("AC sweep"));
    expect(state().project.analysis).toEqual({ type: "ac", start: "10", stop: "100k", pointsPerDecade: 10 });
    expect(screen.getByRole("button", { name: "AC · 10 Hz–100 kHz" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Transient"));
    expect(state().project.analysis).toEqual({ type: "tran", stop: "20m", step: "10u" });
  });

  it("does not commit invalid values and shows why", () => {
    render(<AnalysisPicker />);
    open();
    const stop = screen.getByLabelText("Stop time");
    fireEvent.change(stop, { target: { value: "abc" } });
    fireEvent.blur(stop);
    expect(screen.getByRole("alert")).toHaveTextContent("not a number");
    expect(state().project.analysis).toEqual({ type: "tran", stop: "10m", step: "10u" });
  });

  it("explains settings that cannot run", () => {
    render(<AnalysisPicker />);
    open();
    const step = screen.getByLabelText("Max step");
    fireEvent.change(step, { target: { value: "1" } });
    fireEvent.keyDown(step, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("Max step must not exceed the stop time");
  });

  it("lists DC sources and says when there are none", () => {
    render(<AnalysisPicker />);
    open();
    fireEvent.click(screen.getByLabelText("DC sweep"));
    expect(screen.getByRole("status")).toHaveTextContent("Add a DC voltage or current source to sweep.");
    state().placePart("sources.dc_voltage", [0, 0]);
    fireEvent.click(screen.getByLabelText("Operating point"));
    fireEvent.click(screen.getByLabelText("DC sweep"));
    const source = screen.getByLabelText("Source") as HTMLSelectElement;
    fireEvent.change(source, { target: { value: "V1" } });
    expect(state().project.analysis).toMatchObject({ type: "dc", source: "V1" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes with Done and Escape", () => {
    render(<AnalysisPicker />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify they fail**

Run: `npm --prefix app test -- AnalysisPicker`
Expected: FAIL — cannot resolve `./AnalysisPicker`.

- [ ] **Step 6: Implement the picker**

Create `app/src/ui/AnalysisPicker.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { ANALYSIS_DEFAULTS, analysisProblem, analysisSummary, dcSources, dcSweepUnit } from "@/model/analysis";
import { parseSi } from "@/model/si";
import { useEditor } from "@/model/store";
import type { Analysis } from "@/model/types";

type Kind = Analysis["type"];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "tran", label: "Transient" },
  { kind: "op", label: "Operating point" },
  { kind: "ac", label: "AC sweep" },
  { kind: "dc", label: "DC sweep" },
];

function fieldError(text: string, integer: boolean): string | null {
  if (integer) {
    const n = Number(text.trim());
    return Number.isInteger(n) && n >= 1 && n <= 1000 ? null : "Use a whole number from 1 to 1000";
  }
  const parsed = parseSi(text);
  return parsed.ok ? null : parsed.error;
}

function Field(props: { label: string; unit?: string; value: string; integer?: boolean; onCommit(value: string): void }) {
  const [text, setText] = useState(props.value);
  const [synced, setSynced] = useState(props.value);
  const [touched, setTouched] = useState(false);
  if (props.value !== synced) {
    setSynced(props.value);
    setText(props.value);
    setTouched(false);
  }
  const error = touched ? fieldError(text, props.integer ?? false) : null;
  const id = `analysis-${props.label.replace(/\s+/g, "-").toLowerCase()}`;
  const commit = () => {
    setTouched(true);
    if (fieldError(text, props.integer ?? false) === null && text !== props.value) props.onCommit(text);
  };
  return (
    <div className="py-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="w-32 text-muted">{props.label}</label>
        <input
          id={id}
          value={text}
          onChange={(e) => { setText(e.target.value); setTouched(true); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className={`w-24 rounded border bg-bg px-2 py-1 text-text focus:outline-none ${error ? "border-error" : "border-line focus:border-accent"}`}
        />
        {props.unit && <span className="text-muted">{props.unit}</span>}
      </div>
      {error && <div role="alert" className="mt-1 pl-[8.5rem] text-[11px] text-error">{error}</div>}
    </div>
  );
}

const barButton = "rounded px-2 py-1 text-muted hover:bg-line hover:text-text";

export default function AnalysisPicker() {
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const setAnalysis = useEditor((s) => s.setAnalysis);
  const analysis = project.analysis;
  const [open, setOpen] = useState(false);
  const remembered = useRef<Partial<Record<Kind, Analysis>>>({});
  const root = useRef<HTMLDivElement>(null);
  const sources = dcSources(project);
  const problem = analysisProblem(analysis, project, library);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const switchTo = (kind: Kind) => {
    if (kind === analysis.type) return;
    remembered.current[analysis.type] = analysis;
    const next = remembered.current[kind]
      ?? (kind === "dc" ? { ...ANALYSIS_DEFAULTS.dc, source: sources[0] ?? "" } : ANALYSIS_DEFAULTS[kind]);
    setAnalysis(next);
  };
  const update = (patch: Record<string, string | number>) => setAnalysis({ ...analysis, ...patch } as Analysis);

  return (
    <div ref={root} className="relative">
      <button className={barButton} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Analysis settings">
        {analysisSummary(analysis)}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Analysis"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
          className="absolute right-0 top-9 z-40 w-80 rounded-lg border border-line bg-panel p-3"
        >
          <div role="radiogroup" aria-label="Analysis type" className="grid grid-cols-2 gap-1 border-b border-line pb-2">
            {KINDS.map(({ kind, label }) => (
              <label key={kind} className="flex cursor-pointer items-center gap-2 text-text">
                <input type="radio" name="analysis-type" checked={analysis.type === kind} onChange={() => switchTo(kind)} />
                {label}
              </label>
            ))}
          </div>
          <div className="py-2">
            {analysis.type === "op" && <p className="text-muted">Node voltages are shown on the wires.</p>}
            {analysis.type === "tran" && (
              <>
                <Field label="Stop time" unit="s" value={analysis.stop} onCommit={(v) => update({ stop: v })} />
                <Field label="Max step" unit="s" value={analysis.step} onCommit={(v) => update({ step: v })} />
              </>
            )}
            {analysis.type === "ac" && (
              <>
                <Field label="Start frequency" unit="Hz" value={analysis.start} onCommit={(v) => update({ start: v })} />
                <Field label="Stop frequency" unit="Hz" value={analysis.stop} onCommit={(v) => update({ stop: v })} />
                <Field label="Points per decade" integer value={String(analysis.pointsPerDecade)} onCommit={(v) => update({ pointsPerDecade: Number(v) })} />
              </>
            )}
            {analysis.type === "dc" && (
              <>
                <div className="flex items-center gap-2 py-1">
                  <label htmlFor="analysis-source" className="w-32 text-muted">Source</label>
                  <select
                    id="analysis-source"
                    value={analysis.source}
                    disabled={sources.length === 0}
                    onChange={(e) => update({ source: e.target.value })}
                    className="w-24 rounded border border-line bg-bg px-2 py-1 text-text focus:border-accent focus:outline-none"
                  >
                    {!sources.includes(analysis.source) && <option value={analysis.source}>{analysis.source || "—"}</option>}
                    {sources.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                  </select>
                </div>
                <Field label="Start" unit={dcSweepUnit(project, analysis.source)} value={analysis.start} onCommit={(v) => update({ start: v })} />
                <Field label="Stop" unit={dcSweepUnit(project, analysis.source)} value={analysis.stop} onCommit={(v) => update({ stop: v })} />
                <Field label="Step" unit={dcSweepUnit(project, analysis.source)} value={analysis.step} onCommit={(v) => update({ step: v })} />
              </>
            )}
          </div>
          {problem && <p role="status" className="pb-2 text-error">{problem}</p>}
          <div className="flex justify-end">
            <button className="rounded border border-line px-3 py-1 text-text hover:border-accent" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

In the "does not commit invalid values" test, `role="alert"` is the field error. The `role="status"` paragraph is the whole-analysis problem. Both can appear together; the tests query them by role separately.

In `app/src/ui/TopBar.tsx`, import `AnalysisPicker` and render `<AnalysisPicker />` just before the Run button, with a `<span className="mx-2 h-5 w-px bg-line" />` separator before it.

- [ ] **Step 7: Run the tests**

Run: `npm --prefix app test && npx --prefix app tsc --noEmit -p app`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/src/model/format.ts app/src/model/format.test.ts app/src/model/analysis.ts app/src/model/analysis.test.ts app/src/ui/AnalysisPicker.tsx app/src/ui/AnalysisPicker.test.tsx app/src/ui/TopBar.tsx
git commit -m "feat(app): analysis picker with validation and plain summaries"
```

---

### Task 7: Run and Stop

**Files:**
- Create: `app/src/ui/runActions.ts`, `app/src/ui/runActions.test.ts`, `app/src/ui/RunButton.tsx`, `app/src/ui/RunButton.test.tsx`, `app/src/model/simStatus.ts`, `app/src/model/simStatus.test.ts`
- Modify: `app/src/ui/TopBar.tsx`, `app/src/ui/FocusToolbar.tsx`, `app/src/ui/StatusBar.tsx`, `app/src/ui/AppShell.tsx`, `app/src/ui/useShortcuts.ts`, `app/src/ui/useShortcuts.test.ts`

**Interfaces:**
- Consumes: `startRun`, `finishRun`, `SimSlice` (Task 5); `analysisProblem` (Task 6); `Backend.simulate/stopSimulation` (Task 4); `errorMessage`.
- Produces:
  - `interface RunActions { run(): Promise<void>; stop(): Promise<void>; toggle(): void }`
  - `createRunActions(store: EditorStore, backend: Backend): RunActions`
  - `RunButton({ actions }: { actions: RunActions | null })`
  - `simStatusText(sim: SimSlice, now: number): string`
  - `ShortcutActions.toggleRun?(): void`, triggered by Ctrl+Enter
  - `TopBar({ onOpenComponents, files, run })` and `FocusToolbar({ onOpenComponents, run })`

- [ ] **Step 1: Write the failing tests**

Create `app/src/model/simStatus.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { idleSim, type SimSlice } from "./store";
import { simStatusText } from "./simStatus";

const sim = (patch: Partial<SimSlice>): SimSlice => ({ ...idleSim(), ...patch });
const ok = { status: "ok" as const, elapsedMs: 412, result: { analysis: "tran" as const, x: null, signals: [], nets: { pinNet: [], netPins: {}, wireNet: {} } } };

describe("simStatusText", () => {
  it("describes each state", () => {
    expect(simStatusText(idleSim(), 0)).toBe("");
    expect(simStatusText(sim({ status: "running", startedAt: 1000 }), 4250)).toBe("Running… 3.2 s");
    expect(simStatusText(sim({ status: "done", outcome: ok }), 0)).toBe("Done in 0.41 s");
    expect(simStatusText(sim({ status: "done", outcome: ok, stale: true }), 0)).toBe("Values outdated — run again");
    expect(simStatusText(sim({ status: "stopped", outcome: { status: "stopped" } }), 0)).toBe("Stopped");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "timeout", seconds: 30 } }), 0)).toBe("Stopped after 30 s");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "netlist", errors: [{ code: "no_ground", message: "x", componentUid: null }] } }), 0)).toBe("1 problem");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "netlist", errors: [] } }), 0)).toBe("0 problems");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "engine", message: "m", log: [] } }), 0)).toBe("Simulation failed");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "busy" } }), 0)).toBe("A simulation is already running.");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "netlist", errors: [] }, stale: true }), 0)).toBe("");
  });
});
```

Create `app/src/ui/runActions.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "@/backend/backend";
import type { SimOutcome } from "@/model/simTypes";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import { createRunActions } from "./runActions";

const state = () => editorStore.getState();

function fakeBackend(result: Promise<SimOutcome> | (() => Promise<SimOutcome>)) {
  return {
    simulate: vi.fn(typeof result === "function" ? result : () => result),
    stopSimulation: vi.fn(async () => {}),
  } as unknown as Backend & { simulate: ReturnType<typeof vi.fn>; stopSimulation: ReturnType<typeof vi.fn> };
}

beforeEach(() => resetEditor());

describe("createRunActions", () => {
  it("runs the project and stores the outcome", async () => {
    const backend = fakeBackend(Promise.resolve({ status: "stopped" }));
    const actions = createRunActions(editorStore, backend);
    const done = actions.run();
    expect(state().sim.status).toBe("running");
    await done;
    expect(backend.simulate).toHaveBeenCalledWith(state().project);
    expect(state().sim.status).toBe("stopped");
  });

  it("turns a rejected call into an engine failure", async () => {
    const actions = createRunActions(editorStore, fakeBackend(Promise.reject("boom")));
    await actions.run();
    expect(state().sim.outcome).toEqual({ status: "engine", message: "boom", log: [] });
  });

  it("does not run when the analysis cannot run or a run is in flight", async () => {
    const backend = fakeBackend(Promise.resolve({ status: "stopped" }));
    const actions = createRunActions(editorStore, backend);
    state().setAnalysis({ type: "tran", stop: "abc", step: "1u" });
    await actions.run();
    expect(backend.simulate).not.toHaveBeenCalled();
    state().setAnalysis({ type: "op" });
    state().startRun();
    await actions.run();
    expect(backend.simulate).not.toHaveBeenCalled();
  });

  it("stops only while running, and toggle picks the right action", async () => {
    let finish: (o: SimOutcome) => void = () => {};
    const backend = fakeBackend(() => new Promise<SimOutcome>((resolve) => { finish = resolve; }));
    const actions = createRunActions(editorStore, backend);
    await actions.stop();
    expect(backend.stopSimulation).not.toHaveBeenCalled();
    actions.toggle();
    expect(state().sim.status).toBe("running");
    actions.toggle();
    expect(backend.stopSimulation).toHaveBeenCalledTimes(1);
    finish({ status: "stopped" });
    await vi.waitFor(() => expect(state().sim.status).toBe("stopped"));
  });
});
```

Create `app/src/ui/RunButton.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import RunButton from "./RunButton";

const actions = () => ({ run: vi.fn(async () => {}), stop: vi.fn(async () => {}), toggle: vi.fn() });

beforeEach(() => resetEditor());

describe("RunButton", () => {
  it("runs, and becomes Stop while running", () => {
    const a = actions();
    const { rerender } = render(<RunButton actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "▶ Run" }));
    expect(a.run).toHaveBeenCalled();
    editorStore.getState().startRun();
    rerender(<RunButton actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "■ Stop" }));
    expect(a.stop).toHaveBeenCalled();
  });

  it("is disabled with the reason when the analysis cannot run", () => {
    editorStore.getState().setAnalysis({ type: "tran", stop: "1m", step: "5m" });
    render(<RunButton actions={actions()} />);
    const button = screen.getByRole("button", { name: "▶ Run" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Max step must not exceed the stop time");
  });

  it("is disabled without a backend", () => {
    render(<RunButton actions={null} />);
    expect(screen.getByRole("button", { name: "▶ Run" })).toBeDisabled();
  });
});
```

In `app/src/ui/useShortcuts.test.ts`, add a test (the file's `actions` object gains `toggleRun: vi.fn()` in its setup):
```ts
  it("toggles the simulation with Ctrl+Enter", () => {
    expect(press("Enter", { ctrl: true })).toBe(true);
    expect(actions.toggleRun).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix app test -- simStatus runActions RunButton useShortcuts`
Expected: FAIL — modules missing; Ctrl+Enter not handled.

- [ ] **Step 3: Implement**

Create `app/src/model/simStatus.ts`:
```ts
import type { SimSlice } from "./store";

export function simStatusText(sim: SimSlice, now: number): string {
  if (sim.status === "running") return `Running… ${(Math.max(0, now - (sim.startedAt ?? now)) / 1000).toFixed(1)} s`;
  const outcome = sim.outcome;
  if (!outcome) return "";
  switch (outcome.status) {
    case "ok": return sim.stale ? "Values outdated — run again" : `Done in ${(outcome.elapsedMs / 1000).toFixed(2)} s`;
    case "stopped": return "Stopped";
    case "timeout": return `Stopped after ${outcome.seconds} s`;
    case "busy": return "A simulation is already running.";
    case "engine": return sim.stale ? "" : "Simulation failed";
    case "netlist":
      return sim.stale ? "" : `${outcome.errors.length} problem${outcome.errors.length === 1 ? "" : "s"}`;
  }
}
```

Create `app/src/ui/runActions.ts`:
```ts
import { errorMessage, type Backend } from "@/backend/backend";
import { analysisProblem } from "@/model/analysis";
import type { SimOutcome } from "@/model/simTypes";
import type { EditorStore } from "@/model/store";

export interface RunActions {
  run(): Promise<void>;
  stop(): Promise<void>;
  toggle(): void;
}

export function createRunActions(store: EditorStore, backend: Backend): RunActions {
  const run = async () => {
    const s = store.getState();
    if (s.sim.status === "running") return;
    if (analysisProblem(s.project.analysis, s.project, s.library) !== null) return;
    s.startRun();
    let outcome: SimOutcome;
    try {
      outcome = await backend.simulate(s.project);
    } catch (e) {
      outcome = { status: "engine", message: errorMessage(e), log: [] };
    }
    store.getState().finishRun(outcome);
  };
  const stop = async () => {
    if (store.getState().sim.status === "running") await backend.stopSimulation();
  };
  return {
    run,
    stop,
    toggle: () => { void (store.getState().sim.status === "running" ? stop() : run()); },
  };
}
```

Create `app/src/ui/RunButton.tsx`:
```tsx
"use client";

import { analysisProblem } from "@/model/analysis";
import { useEditor } from "@/model/store";
import type { RunActions } from "./runActions";

export default function RunButton({ actions }: { actions: RunActions | null }) {
  const status = useEditor((s) => s.sim.status);
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  if (status === "running") {
    return (
      <button className="rounded border border-accent px-3 py-1 font-semibold text-accent" onClick={() => void actions?.stop()} title="Stop (Ctrl+Enter)">
        ■ Stop
      </button>
    );
  }
  const problem = analysisProblem(project.analysis, project, library);
  return (
    <button
      className="rounded bg-accent px-3 py-1 font-semibold text-bg disabled:opacity-40"
      disabled={!actions || problem !== null}
      onClick={() => void actions?.run()}
      title={problem ?? "Run (Ctrl+Enter)"}
    >
      ▶ Run
    </button>
  );
}
```

In `app/src/ui/useShortcuts.ts`: add `toggleRun?(): void;` to `ShortcutActions`, and in the Ctrl/Meta switch add `case "enter": return run(actions.toggleRun);`.

In `app/src/ui/TopBar.tsx`: add prop `run: RunActions | null` (type import from `./runActions`) and replace the disabled Run button with `<RunButton actions={run} />`.

In `app/src/ui/FocusToolbar.tsx`: add prop `run: RunActions | null` and render `<span className="mx-1 w-px bg-line" /><RunButton actions={run} />` before the Exit focus separator.

In `app/src/ui/StatusBar.tsx`: read `sim` from the store, keep a `now` state updated every 100 ms while `sim.status === "running"` (`useEffect` with `setInterval`, cleared on status change), and render `<span data-testid="sim-status">{simStatusText(sim, now)}</span>` before the flex spacer.

In `app/src/ui/AppShell.tsx`:
```tsx
  const runActions = useMemo(() => backend && createRunActions(editorStore, backend), [backend]);
```
Pass `toggleRun: runActions ? runActions.toggle : undefined` to `useShortcuts`, `run={runActions}` to `TopBar` and `FocusToolbar`.

- [ ] **Step 4: Run the tests and build**

Run: `npm --prefix app test && npm --prefix app run build`
Expected: all pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src
git commit -m "feat(app): run and stop simulations from the top bar and Ctrl+Enter"
```

---

### Task 8: Result model for the canvas

**Files:**
- Create: `app/src/model/results.ts`, `app/src/model/results.test.ts`

**Interfaces:**
- Consumes: `SimSlice` (Task 5); `SimOutcome`, `UiResult`, `GROUND_NET` (Task 4); `formatValue` (Task 6); `pinPosition`, `partBounds`; `PartDef`, `Project`, `Point`.
- Produces:
  - `engineMessage(log: string[]): string`
  - `partsNamedInLog(log: string[], project: Project): string[]` (uids)
  - `interface CanvasLabel { key: string; point: Point; text: string; tone: "net" | "meter" }`
  - `canvasLabels(result: UiResult, project: Project, parts: Map<string, PartDef>): CanvasLabel[]`
  - `interface SimFeedback { partMessages: Map<string, string[]>; pinErrors: { uid: string; pin: string }[]; bar: { message: string; log: string[] | null } | null; problemUids: string[]; showLabels: boolean }`
  - `simFeedback(sim: SimSlice, project: Project): SimFeedback`
  - `signalValue(result: UiResult, id: string): number | null` (last value)

- [ ] **Step 1: Write the failing tests**

Create `app/src/model/results.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { mockSimulate } from "@/backend/mockSimulation";
import { testLibrary } from "@/test/resetEditor";
import { canvasLabels, engineMessage, partsNamedInLog, simFeedback } from "./results";
import { idleSim } from "./store";
import type { SimOutcome, UiResult } from "./simTypes";
import { partMap } from "./wiring";

const parts = partMap(testLibrary);

function opResult(project = dividerProject()): UiResult {
  project.analysis = { type: "op" };
  const outcome = mockSimulate(project, testLibrary);
  if (outcome.status !== "ok") throw new Error(outcome.status);
  return outcome.result;
}

describe("engineMessage", () => {
  it("maps known ngspice failures to plain advice", () => {
    expect(engineMessage(["stderr Error: timestep too small"])).toBe("The simulation didn't converge. Try a smaller max step.");
    expect(engineMessage(["warning: SINGULAR MATRIX"])).toBe("Part of the circuit is floating. Check that every part connects to ground.");
    expect(engineMessage(["gmin stepping failed"])).toBe("The simulation didn't converge. Check source values and connections.");
    expect(engineMessage(["no convergence in dc"])).toBe("The simulation didn't converge. Check source values and connections.");
    expect(engineMessage(["something else"])).toBe("The simulator reported an error.");
  });
});

describe("partsNamedInLog", () => {
  it("finds references by element and subcircuit names", () => {
    const project = dividerProject();
    project.components.push({ uid: "c9", part: "mixed.555", ref: "U1", x: 0, y: 0, rot: 0, mirror: false, params: {} });
    const log = ["Error on line: rr1 n1 n2 1e3", "singular matrix at node xu1.qraw", "R10 is fine"];
    expect(partsNamedInLog(log, project).sort()).toEqual(["c2", "c9"]);
  });
});

describe("canvasLabels", () => {
  it("labels each non-ground net at the midpoint of its longest wire segment", () => {
    const project = dividerProject();
    const result = opResult(project);
    const labels = canvasLabels(result, project, parts).filter((l) => l.tone === "net");
    expect(labels).toHaveLength(2);
    const w1 = labels.find((l) => l.point[0] === 60)!;
    expect(w1.point).toEqual([60, 94]);
    expect(w1.text).toMatch(/ V$/);
  });

  it("places a label beside the first pin when a net has no wires", () => {
    const project = dividerProject();
    project.wires = project.wires.filter((w) => w.uid !== "w2");
    project.components[2].x = 160;
    project.wires[1] = { uid: "w3", points: [[220, 100], [220, 200], [20, 200]] };
    const result = opResult(project);
    const labels = canvasLabels(result, project, parts).filter((l) => l.tone === "net");
    expect(labels.some((l) => l.point[0] === 166 && l.point[1] === 94)).toBe(true);
  });

  it("adds meter readings beside meters", () => {
    const project = dividerProject();
    project.components.push({ uid: "c6", part: "indicators.ammeter", ref: "AM1", x: 400, y: 0, rot: 0, mirror: false, params: {} });
    project.wires.push({ uid: "w9", points: [[420, 0], [420, -20]] });
    const result: UiResult = {
      ...opResult(dividerProject()),
      signals: [{ id: "v.xam1.vsense#branch", kind: "current", values: [0.005] }],
    };
    const meters = canvasLabels(result, project, parts).filter((l) => l.tone === "meter");
    expect(meters).toEqual([{ key: "meter:c6", point: [448, 0], text: "AM1 5.00 mA", tone: "meter" }]);
  });
});

describe("simFeedback", () => {
  const netlist: SimOutcome = {
    status: "netlist",
    errors: [
      { code: "no_ground", message: "The circuit has no ground. Add a Ground part.", componentUid: null },
      { code: "unconnected_pin", message: "R3 pin 1 is not connected", componentUid: "c5", pin: "1" },
      { code: "unconnected_pin", message: "R3 pin 2 is not connected", componentUid: "c5", pin: "2" },
    ],
  };

  it("routes netlist errors to parts, pins and the bar", () => {
    const f = simFeedback({ ...idleSim(), status: "failed", outcome: netlist }, dividerProject());
    expect(f.partMessages.get("c5")).toEqual(["R3 pin 1 is not connected", "R3 pin 2 is not connected"]);
    expect(f.pinErrors).toEqual([{ uid: "c5", pin: "1" }, { uid: "c5", pin: "2" }]);
    expect(f.bar).toEqual({ message: "The circuit has no ground. Add a Ground part.", log: null });
    expect(f.problemUids).toEqual(["c5"]);
    expect(f.showLabels).toBe(false);
  });

  it("maps engine failures and timeouts to the bar", () => {
    const project = dividerProject();
    const engine = simFeedback({ ...idleSim(), status: "failed", outcome: { status: "engine", message: "m", log: ["timestep too small near rr2"] } }, project);
    expect(engine.bar).toEqual({ message: "The simulation didn't converge. Try a smaller max step.", log: ["timestep too small near rr2"] });
    expect(engine.problemUids).toEqual(["c3"]);
    const timeout = simFeedback({ ...idleSim(), status: "failed", outcome: { status: "timeout", seconds: 30 } }, project);
    expect(timeout.bar?.message).toBe("Stopped after 30 s. Try a shorter stop time or a larger max step.");
  });

  it("shows nothing when stale and labels only for fresh op results", () => {
    expect(simFeedback({ ...idleSim(), status: "failed", outcome: netlist, stale: true }, dividerProject()).bar).toBeNull();
    const ok: SimOutcome = { status: "ok", elapsedMs: 1, result: opResult() };
    expect(simFeedback({ ...idleSim(), status: "done", outcome: ok }, dividerProject()).showLabels).toBe(true);
    expect(simFeedback({ ...idleSim(), status: "done", outcome: ok, stale: true }, dividerProject()).showLabels).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix app test -- results`
Expected: FAIL — cannot resolve `./results`.

- [ ] **Step 3: Implement**

Create `app/src/model/results.ts`:
```ts
import { formatValue } from "./format";
import { partBounds, pinPosition } from "./geometry";
import { GROUND_NET, type SimOutcome, type UiResult } from "./simTypes";
import type { SimSlice } from "./store";
import type { PartDef, Point, Project } from "./types";

const ENGINE_MESSAGES: [RegExp, string][] = [
  [/timestep too small/i, "The simulation didn't converge. Try a smaller max step."],
  [/singular matrix/i, "Part of the circuit is floating. Check that every part connects to ground."],
  [/no convergence|gmin/i, "The simulation didn't converge. Check source values and connections."],
];

export function engineMessage(log: string[]): string {
  const text = log.join("\n");
  return ENGINE_MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? "The simulator reported an error.";
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Components whose reference appears in the log as an element or subcircuit name (`rr1`, `xu1.q1`). */
export function partsNamedInLog(log: string[], project: Project): string[] {
  const text = log.join("\n");
  return project.components
    .filter((c) => /^[A-Za-z][A-Za-z0-9_]*$/.test(c.ref))
    .filter((c) => new RegExp(`(^|[^a-z0-9_])[a-z]?${escapeRegExp(c.ref)}(?=\\.|[^a-z0-9_]|$)`, "i").test(text))
    .map((c) => c.uid);
}

export function signalValue(result: UiResult, id: string): number | null {
  const values = result.signals.find((s) => s.id === id)?.values;
  return values && values.length > 0 ? values[values.length - 1] : null;
}

export interface CanvasLabel {
  key: string;
  point: Point;
  text: string;
  tone: "net" | "meter";
}

function netOfPin(result: UiResult, uid: string, pin: string): string | undefined {
  return result.nets.pinNet.find((p) => p.uid === uid && p.pin === pin)?.net;
}

function netVoltage(result: UiResult, net: string | undefined): number | null {
  if (net === undefined) return null;
  return net === GROUND_NET ? 0 : signalValue(result, net);
}

export function canvasLabels(result: UiResult, project: Project, parts: Map<string, PartDef>): CanvasLabel[] {
  const labels: CanvasLabel[] = [];
  for (const [net, members] of Object.entries(result.nets.netPins)) {
    if (net === GROUND_NET) continue;
    const value = signalValue(result, net);
    if (value === null) continue;
    let best: { length: number; a: Point; b: Point } | null = null;
    for (const wire of project.wires) {
      if (result.nets.wireNet[wire.uid] !== net) continue;
      for (let i = 1; i < wire.points.length; i++) {
        const a = wire.points[i - 1];
        const b = wire.points[i];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!best || length > best.length) best = { length, a, b };
      }
    }
    let point: Point | null = null;
    if (best) {
      point = [(best.a[0] + best.b[0]) / 2, (best.a[1] + best.b[1]) / 2 - 6];
    } else {
      const first = members[0];
      const inst = project.components.find((c) => c.uid === first.uid);
      const pin = inst && parts.get(inst.part)?.manifest.symbol.pins.find((p) => p.id === first.pin);
      if (inst && pin) {
        const [x, y] = pinPosition(inst, pin);
        point = [x + 6, y - 6];
      }
    }
    if (point) labels.push({ key: `net:${net}`, point, text: formatValue(value, "V"), tone: "net" });
  }

  for (const inst of project.components) {
    const part = parts.get(inst.part);
    if (!part) continue;
    let text: string | null = null;
    if (inst.part === "indicators.voltmeter") {
      const p = netVoltage(result, netOfPin(result, inst.uid, "p"));
      const n = netVoltage(result, netOfPin(result, inst.uid, "n"));
      if (p !== null && n !== null) text = `${inst.ref} ${formatValue(p - n, "V")}`;
    } else if (inst.part === "indicators.ammeter") {
      const i = signalValue(result, `v.x${inst.ref.toLowerCase()}.vsense#branch`);
      if (i !== null) text = `${inst.ref} ${formatValue(i, "A")}`;
    }
    if (text) {
      const bounds = partBounds(inst, part.manifest.symbol);
      labels.push({ key: `meter:${inst.uid}`, point: [bounds.x + bounds.width + 8, bounds.y], text, tone: "meter" });
    }
  }
  return labels;
}

export interface SimFeedback {
  partMessages: Map<string, string[]>;
  pinErrors: { uid: string; pin: string }[];
  bar: { message: string; log: string[] | null } | null;
  problemUids: string[];
  showLabels: boolean;
}

const EMPTY: SimFeedback = { partMessages: new Map(), pinErrors: [], bar: null, problemUids: [], showLabels: false };

export function simFeedback(sim: SimSlice, project: Project): SimFeedback {
  const outcome: SimOutcome | null = sim.outcome;
  if (!outcome || sim.stale || sim.status === "running") return EMPTY;
  switch (outcome.status) {
    case "ok":
      return { ...EMPTY, showLabels: outcome.result.analysis === "op" };
    case "netlist": {
      const partMessages = new Map<string, string[]>();
      const loose: string[] = [];
      for (const error of outcome.errors) {
        if (error.componentUid) partMessages.set(error.componentUid, [...(partMessages.get(error.componentUid) ?? []), error.message]);
        else loose.push(error.message);
      }
      return {
        partMessages,
        pinErrors: outcome.errors.filter((e) => e.componentUid && e.pin).map((e) => ({ uid: e.componentUid!, pin: e.pin! })),
        bar: loose.length > 0 ? { message: loose.join(" · "), log: null } : null,
        problemUids: [...partMessages.keys()],
        showLabels: false,
      };
    }
    case "engine": {
      const uids = partsNamedInLog(outcome.log, project);
      const message = engineMessage(outcome.log);
      return {
        ...EMPTY,
        partMessages: new Map(uids.map((uid) => [uid, [message]])),
        bar: { message, log: outcome.log },
        problemUids: uids,
      };
    }
    case "timeout":
      return { ...EMPTY, bar: { message: `Stopped after ${outcome.seconds} s. Try a shorter stop time or a larger max step.`, log: null } };
    case "busy":
      return { ...EMPTY, bar: { message: "A simulation is already running.", log: null } };
    case "stopped":
      return EMPTY;
  }
}
```

The "places a label beside the first pin" test moves R2 to x=160 so its pin 1 sits on R1 pin 2 at (160,100), with no wire on that net, and reroutes w3 from R2's new pin 2 at (220,100). The net's first member in component order is R1 pin 2, so the label lands at (166,94).

The meter test's expected x of 448 comes from the ammeter at x=400: `partBounds` gives width 40, so 400 + 40 + 8 = 448. Its y is `bounds.y` = 0.

- [ ] **Step 4: Run the tests**

Run: `npm --prefix app test -- results && npx --prefix app tsc --noEmit -p app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/model/results.ts app/src/model/results.test.ts
git commit -m "feat(app): result model for canvas labels, error routing and engine advice"
```

---

### Task 9: Signal model for the plot

**Files:**
- Create: `app/src/model/signals.ts`, `app/src/model/signals.test.ts`

**Interfaces:**
- Consumes: `UiResult`, `GROUND_NET` (Task 4); `PartDef`, `Project`.
- Produces:
  - `TRACE_COLORS: string[]`
  - `probeRef(uid: string, pin: string): string`
  - `netNames(result, project, parts): Map<string, string>`
  - `interface PlotSignal { key: string; label: string; unit: "V" | "A"; auto: boolean; probe: string | null; values: number[]; phase?: number[] }`
  - `listSignals(result, project, parts): PlotSignal[]`
  - `tickedKeys(signals: PlotSignal[], probes: string[], hiddenAuto: Set<string>): string[]` (in list order)

- [ ] **Step 1: Write the failing tests**

Create `app/src/model/signals.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { mockSimulate } from "@/backend/mockSimulation";
import { testLibrary } from "@/test/resetEditor";
import type { UiResult } from "./simTypes";
import { listSignals, netNames, probeRef, tickedKeys } from "./signals";
import type { Project } from "./types";
import { partMap } from "./wiring";

const parts = partMap(testLibrary);

function tran(project: Project): UiResult {
  const outcome = mockSimulate(project, testLibrary);
  if (outcome.status !== "ok") throw new Error(JSON.stringify(outcome));
  return outcome.result;
}

describe("netNames", () => {
  it("names nets by ground, probe part, or first pin", () => {
    const project = dividerProject();
    project.components.push({ uid: "c5", part: "indicators.probe", ref: "PR1", x: 170, y: 100, rot: 0, mirror: false, params: {} });
    project.wires.push({ uid: "w5", points: [[180, 130], [180, 100]] });
    const result = tran(project);
    const names = netNames(result, project, parts);
    const netOf = (uid: string, pin: string) => result.nets.pinNet.find((p) => p.uid === uid && p.pin === pin)!.net;
    expect(names.get("0")).toBe("GND");
    expect(names.get(netOf("c1", "p"))).toBe("V1:+");
    expect(names.get(netOf("c2", "2"))).toBe("PR1");
  });
});

describe("listSignals", () => {
  it("lists net voltages and source currents with readable labels", () => {
    const project = dividerProject();
    const signals = listSignals(tran(project), project, parts);
    expect(signals.map((s) => s.label)).toEqual(["V(R1:2)", "V(V1:+)", "I(V1)"]);
    expect(signals.every((s) => !s.auto)).toBe(true);
    expect(signals[0].probe).toBe(probeRef("c2", "2"));
    expect(signals[2]).toMatchObject({ unit: "A", probe: null });
  });

  it("auto-ticks probe nets, voltmeter differences and ammeter currents", () => {
    const project = dividerProject();
    project.components.push(
      { uid: "c5", part: "indicators.probe", ref: "PR1", x: 170, y: 100, rot: 0, mirror: false, params: {} },
      { uid: "c6", part: "indicators.voltmeter", ref: "VM1", x: 400, y: 0, rot: 0, mirror: false, params: {} },
      { uid: "c7", part: "indicators.ammeter", ref: "AM1", x: 600, y: 0, rot: 0, mirror: false, params: {} },
    );
    project.wires.push(
      { uid: "w5", points: [[180, 130], [180, 100]] },
      { uid: "w6", points: [[420, 0], [420, -40], [200, -40], [200, 100]] },
      { uid: "w7", points: [[420, 60], [420, 200], [260, 200]] },
      { uid: "w8", points: [[620, 0], [620, -60], [100, -60], [100, 100]] },
      { uid: "w9", points: [[620, 60], [620, 220], [20, 220], [20, 200]] },
    );
    const result = tran(project);
    const signals = listSignals(result, project, parts);
    const auto = signals.filter((s) => s.auto).map((s) => s.label);
    expect(auto).toEqual(["V(VM1)", "I(AM1)", "V(PR1)"]);
    const vm = signals.find((s) => s.label === "V(VM1)")!;
    const top = result.signals.find((s) => s.id === result.nets.pinNet.find((p) => p.uid === "c6" && p.pin === "p")!.net)!;
    expect(vm.values).toEqual(top.values);
  });
});

describe("tickedKeys", () => {
  it("combines auto signals, saved probes and hidden auto signals", () => {
    const project = dividerProject();
    const signals = listSignals(tran(project), project, parts);
    const ticked = tickedKeys(signals, [probeRef("c2", "2"), "pin:c99:1", "garbage"], new Set());
    expect(ticked).toEqual([signals[0].key]);
    const auto = [{ ...signals[1], auto: true }, signals[0]];
    expect(tickedKeys(auto, [], new Set([signals[1].key]))).toEqual([]);
  });
});
```

The voltmeter test wires the voltmeter's `p` to R2 pin 1 at (200,100), on the R1:2 net, and its `n` to the ground rail at (260,200). The ammeter runs from the V1:+ net at (100,100) to ground at (20,200). The `V(VM1)` values therefore equal the R1:2 net's values.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix app test -- signals`
Expected: FAIL — cannot resolve `./signals`.

- [ ] **Step 3: Implement**

Create `app/src/model/signals.ts`:
```ts
import { GROUND_NET, type UiResult } from "./simTypes";
import type { PartDef, Project } from "./types";

export const TRACE_COLORS = ["#5fb3a8", "#d9a35f", "#7aa2d6", "#c98bd1", "#8fc27a", "#d97a7a", "#6fc4c4", "#c9ced8"];

const PROBE_PARTS = new Set(["indicators.probe", "indicators.logic_probe"]);

export const probeRef = (uid: string, pin: string) => `pin:${uid}:${pin}`;

export interface PlotSignal {
  key: string;
  label: string;
  unit: "V" | "A";
  auto: boolean;
  /** Saved probe reference for net voltages; null for signals that can't be saved. */
  probe: string | null;
  values: number[];
  phase?: number[];
}

/** First pin (component order, then manifest pin order) on each net. */
function firstPins(result: UiResult, project: Project, parts: Map<string, PartDef>) {
  const byPin = new Map(result.nets.pinNet.map((p) => [`${p.uid} ${p.pin}`, p.net]));
  const first = new Map<string, { uid: string; pin: string; label: string }>();
  for (const inst of project.components) {
    for (const pin of parts.get(inst.part)?.manifest.symbol.pins ?? []) {
      const net = byPin.get(`${inst.uid} ${pin.id}`);
      if (net !== undefined && !first.has(net)) first.set(net, { uid: inst.uid, pin: pin.id, label: `${inst.ref}:${pin.name ?? pin.id}` });
    }
  }
  return { byPin, first };
}

export function netNames(result: UiResult, project: Project, parts: Map<string, PartDef>): Map<string, string> {
  const { byPin, first } = firstPins(result, project, parts);
  const names = new Map<string, string>();
  for (const inst of project.components) {
    if (!PROBE_PARTS.has(inst.part)) continue;
    const net = byPin.get(`${inst.uid} 1`);
    if (net !== undefined && net !== GROUND_NET && !names.has(net)) names.set(net, inst.ref);
  }
  for (const net of Object.keys(result.nets.netPins)) {
    if (net === GROUND_NET) names.set(net, "GND");
    else if (!names.has(net)) names.set(net, first.get(net)?.label ?? net);
  }
  return names;
}

export function listSignals(result: UiResult, project: Project, parts: Map<string, PartDef>): PlotSignal[] {
  const names = netNames(result, project, parts);
  const { byPin, first } = firstPins(result, project, parts);
  const byId = new Map(result.signals.map((s) => [s.id, s]));
  const length = result.x?.values.length ?? 1;
  const netValues = (net: string | undefined) =>
    net === undefined ? null : net === GROUND_NET ? new Array<number>(length).fill(0) : byId.get(net)?.values ?? null;

  const meters: PlotSignal[] = [];
  const probed = new Set<string>();
  for (const inst of project.components) {
    if (inst.part === "indicators.voltmeter") {
      const p = netValues(byPin.get(`${inst.uid} p`));
      const n = netValues(byPin.get(`${inst.uid} n`));
      if (p && n) meters.push({ key: `vm:${inst.uid}`, label: `V(${inst.ref})`, unit: "V", auto: true, probe: null, values: p.map((v, i) => v - (n[i] ?? 0)) });
    } else if (inst.part === "indicators.ammeter") {
      const s = byId.get(`v.x${inst.ref.toLowerCase()}.vsense#branch`);
      if (s) meters.push({ key: `am:${inst.uid}`, label: `I(${inst.ref})`, unit: "A", auto: true, probe: null, values: s.values, phase: s.phase });
    } else if (PROBE_PARTS.has(inst.part)) {
      const net = byPin.get(`${inst.uid} 1`);
      if (net !== undefined) probed.add(net);
    }
  }

  const voltages: PlotSignal[] = result.signals
    .filter((s) => s.kind === "voltage" && s.id !== GROUND_NET)
    .map((s) => ({
      key: `v:${s.id}`,
      label: `V(${names.get(s.id) ?? s.id})`,
      unit: "V" as const,
      auto: probed.has(s.id),
      probe: first.has(s.id) ? probeRef(first.get(s.id)!.uid, first.get(s.id)!.pin) : null,
      values: s.values,
      phase: s.phase,
    }))
    .sort((a, b) => Number(b.auto) - Number(a.auto) || a.label.localeCompare(b.label));

  const refs = new Map(project.components.map((c) => [c.ref.toLowerCase(), c.ref]));
  const currents: PlotSignal[] = result.signals
    .filter((s) => s.kind === "current" && !s.id.includes("."))
    .flatMap((s) => {
      const ref = refs.get(s.id.replace(/#branch$/, ""));
      return ref ? [{ key: `i:${s.id}`, label: `I(${ref})`, unit: "A" as const, auto: false, probe: null, values: s.values, phase: s.phase }] : [];
    });

  return [...meters, ...voltages, ...currents];
}

export function tickedKeys(signals: PlotSignal[], probes: string[], hiddenAuto: Set<string>): string[] {
  return signals
    .filter((s) => (s.auto ? !hiddenAuto.has(s.key) : s.probe !== null && probes.includes(s.probe)))
    .map((s) => s.key);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix app test -- signals && npx --prefix app tsc --noEmit -p app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/model/signals.ts app/src/model/signals.test.ts
git commit -m "feat(app): signal naming and auto-ticked traces for the plot dock"
```

---

### Task 10: Plot dock

**Files:**
- Create: `app/src/ui/plot/Chart.tsx`, `app/src/ui/plot/SignalList.tsx`, `app/src/ui/plot/PlotDock.tsx`, `app/src/ui/plot/PlotDock.test.tsx`
- Delete: `app/src/ui/PlotDock.tsx`
- Modify: `app/package.json` (+ lockfile), `app/src/ui/AppShell.tsx`

**Interfaces:**
- Consumes: `listSignals`, `tickedKeys`, `TRACE_COLORS`, `PlotSignal` (Task 9); `toggleProbe`, `sim` (Task 5); `formatValue` (Task 6); `partMap`.
- Produces:
  - `Chart({ x, xUnit, logX, series })`, where each series is `{ key, label, unit, color, values }` and the root has `data-testid="chart"`
  - `SignalList({ signals, ticked, colors, onToggle })`
  - `PlotDock()`: `section` named "Plot"

- [ ] **Step 1: Add uPlot**

Run: `npm --prefix app install uplot@^1.6.31`
Expected: `uplot` in `app/package.json` dependencies (it ships its own types).

- [ ] **Step 2: Write the failing tests**

Create `app/src/ui/plot/PlotDock.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { mockSimulate } from "@/backend/mockSimulation";
import { editorStore } from "@/model/store";
import { probeRef } from "@/model/signals";
import { resetEditor, testLibrary } from "@/test/resetEditor";
import PlotDock from "./PlotDock";

vi.mock("./Chart", () => ({
  default: (props: { series: { label: string; color: string }[]; logX: boolean }) => (
    <div data-testid="chart" data-log={String(props.logX)}>{props.series.map((s) => `${s.label}=${s.color}`).join(",")}</div>
  ),
}));

const state = () => editorStore.getState();

function runMock() {
  const outcome = mockSimulate(state().project, testLibrary);
  state().startRun();
  state().finishRun(outcome);
}

beforeEach(() => {
  resetEditor();
  state().loadProject(dividerProject(), null);
});

describe("PlotDock", () => {
  it("invites a run when there is no result", () => {
    render(<PlotDock />);
    expect(screen.getByText("Run a transient, AC or DC sweep to see a plot.")).toBeTruthy();
  });

  it("says where operating-point values are", () => {
    state().setAnalysis({ type: "op" });
    runMock();
    render(<PlotDock />);
    expect(screen.getByText("Operating point: values are shown on the wires.")).toBeTruthy();
  });

  it("lists signals and plots ticked ones, saving probes", () => {
    runMock();
    render(<PlotDock />);
    expect(screen.getByText("Tick a signal to plot it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "V(R1:2)" }));
    expect(state().project.probes).toEqual([probeRef("c2", "2")]);
    expect(screen.getByTestId("chart")).toHaveTextContent("V(R1:2)=#5fb3a8");
    fireEvent.click(screen.getByRole("checkbox", { name: "I(V1)" }));
    expect(screen.getByTestId("chart")).toHaveTextContent("V(R1:2)=#5fb3a8,I(V1)=#d9a35f");
    expect(state().sim.stale).toBe(false);
  });

  it("dims and badges outdated results", () => {
    runMock();
    render(<PlotDock />);
    state().setParam("c2", "resistance", "2k");
    expect(screen.getByText("outdated")).toBeTruthy();
  });

  it("offers magnitude and phase for AC", () => {
    state().setAnalysis({ type: "ac", start: "10", stop: "100k", pointsPerDecade: 10 });
    runMock();
    render(<PlotDock />);
    fireEvent.click(screen.getByRole("checkbox", { name: "V(R1:2)" }));
    expect(screen.getByTestId("chart")).toHaveAttribute("data-log", "true");
    expect(screen.getByRole("button", { name: "Mag" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Phase" }));
    expect(screen.getByRole("button", { name: "Phase" })).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm --prefix app test -- PlotDock`
Expected: FAIL — cannot resolve `./PlotDock` in `ui/plot`.

- [ ] **Step 4: Implement**

Create `app/src/ui/plot/Chart.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatValue } from "@/model/format";
import { tokens } from "@/theme/tokens";

export interface ChartSeries {
  key: string;
  label: string;
  unit: string;
  color: string;
  values: number[];
}

const tickText = (unit: string) => (_u: uPlot, splits: number[]) => splits.map((v) => formatValue(v, unit, { trim: true }).trim());

export default function Chart({ x, xUnit, logX, series }: { x: number[]; xUnit: string; logX: boolean; series: ChartSeries[] }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const units = [...new Set(series.map((s) => s.unit))];
    const size = () => ({ width: Math.max(el.clientWidth, 100), height: Math.max(el.clientHeight - 28, 60) });
    const axis = { stroke: tokens.muted, grid: { stroke: tokens.grid, width: 1 }, ticks: { stroke: tokens.line, width: 1 } };
    const options: uPlot.Options = {
      ...size(),
      scales: { x: { time: false, distr: logX ? 3 : 1 }, y: { auto: true }, y2: { auto: true } },
      axes: [
        { ...axis, values: tickText(xUnit) },
        { ...axis, scale: "y", size: 64, values: tickText(units[0] ?? "") },
        ...(units.length > 1 ? [{ ...axis, scale: "y2", side: 1, size: 64, grid: { show: false }, values: tickText(units[1]) }] : []),
      ],
      series: [
        { label: xUnit, value: (_u, v) => (v == null ? "—" : formatValue(v, xUnit)) },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          scale: s.unit === units[0] ? "y" : "y2",
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : formatValue(v, s.unit)),
        })),
      ],
      cursor: { drag: { x: false, y: false } },
    };
    const plot = new uPlot(options, [x, ...series.map((s) => s.values)] as uPlot.AlignedData, el);
    const observer = new ResizeObserver(() => plot.setSize(size()));
    observer.observe(el);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [x, xUnit, logX, series]);

  return <div ref={host} data-testid="chart" className="h-full w-full overflow-hidden text-[11px] text-muted" />;
}
```

Create `app/src/ui/plot/SignalList.tsx`:
```tsx
"use client";

import type { PlotSignal } from "@/model/signals";

export default function SignalList({ signals, ticked, colors, onToggle }: {
  signals: PlotSignal[];
  ticked: Set<string>;
  colors: Map<string, string>;
  onToggle(signal: PlotSignal): void;
}) {
  return (
    <ul aria-label="Signals" className="w-52 shrink-0 overflow-y-auto border-r border-line py-1">
      {signals.map((signal) => (
        <li key={signal.key}>
          <label className="flex cursor-pointer items-center gap-2 px-3 py-0.5 text-text hover:bg-line">
            <input type="checkbox" checked={ticked.has(signal.key)} onChange={() => onToggle(signal)} aria-label={signal.label} />
            <span className="min-w-0 flex-1 truncate">{signal.label}</span>
            {ticked.has(signal.key) && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colors.get(signal.key) }} />}
          </label>
        </li>
      ))}
    </ul>
  );
}
```

Create `app/src/ui/plot/PlotDock.tsx`:
```tsx
"use client";

import { useMemo, useState } from "react";
import { listSignals, tickedKeys, TRACE_COLORS, type PlotSignal } from "@/model/signals";
import { useEditor } from "@/model/store";
import { partMap } from "@/model/wiring";
import Chart, { type ChartSeries } from "./Chart";
import SignalList from "./SignalList";

const message = "flex flex-1 items-center justify-center text-muted";

export default function PlotDock() {
  const sim = useEditor((s) => s.sim);
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const toggleProbe = useEditor((s) => s.toggleProbe);
  const parts = useMemo(() => partMap(library), [library]);
  const [hiddenAuto, setHiddenAuto] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState(false);

  const result = sim.outcome?.status === "ok" ? sim.outcome.result : null;
  const signals = useMemo(() => (result ? listSignals(result, project, parts) : []), [result, project, parts]);
  const ticked = useMemo(() => tickedKeys(signals, project.probes, hiddenAuto), [signals, project.probes, hiddenAuto]);
  const colors = useMemo(() => new Map(ticked.map((key, i) => [key, TRACE_COLORS[i % TRACE_COLORS.length]])), [ticked]);
  const showPhase = result?.analysis === "ac" && phase;
  const series = useMemo<ChartSeries[]>(
    () => ticked.flatMap((key) => {
      const s = signals.find((signal) => signal.key === key);
      if (!s) return [];
      return [{ key, label: s.label, unit: showPhase ? "°" : result?.analysis === "ac" ? "dB" : s.unit, color: colors.get(key)!, values: showPhase ? s.phase ?? s.values : s.values }];
    }),
    [ticked, signals, colors, showPhase, result],
  );

  const toggle = (signal: PlotSignal) => {
    if (signal.auto) {
      setHiddenAuto((prev) => {
        const next = new Set(prev);
        if (next.has(signal.key)) next.delete(signal.key);
        else next.add(signal.key);
        return next;
      });
    } else if (signal.probe) {
      toggleProbe(signal.probe);
    }
  };

  return (
    <section aria-label="Plot" className="relative flex h-60 shrink-0 border-t border-line bg-panel">
      {!result ? (
        <div className={message}>Run a transient, AC or DC sweep to see a plot.</div>
      ) : result.analysis === "op" ? (
        <div className={message}>Operating point: values are shown on the wires.</div>
      ) : (
        <>
          <SignalList signals={signals} ticked={new Set(ticked)} colors={colors} onToggle={toggle} />
          <div className={`relative min-w-0 flex-1 p-2 ${sim.stale ? "opacity-50" : ""}`}>
            {result.analysis === "ac" && (
              <div role="group" aria-label="AC view" className="absolute right-3 top-1 z-10 flex gap-1">
                {(["Mag", "Phase"] as const).map((label) => {
                  const pressed = (label === "Phase") === phase;
                  return (
                    <button
                      key={label}
                      aria-pressed={pressed}
                      onClick={() => setPhase(label === "Phase")}
                      className={`rounded px-2 text-[11px] ${pressed ? "bg-line text-text" : "text-muted hover:text-text"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {series.length === 0 ? (
              <div className={`${message} h-full`}>Tick a signal to plot it.</div>
            ) : (
              <Chart x={result.x?.values ?? []} xUnit={result.x?.unit ?? ""} logX={result.x?.log ?? false} series={series} />
            )}
          </div>
        </>
      )}
      {result && sim.stale && (
        <span className="absolute left-56 top-1 rounded bg-line px-2 text-[11px] text-muted">outdated</span>
      )}
    </section>
  );
}
```

Delete `app/src/ui/PlotDock.tsx` and change the AppShell import to `import PlotDock from "./plot/PlotDock";`.

- [ ] **Step 5: Run the tests and build**

Run: `npm --prefix app test && npm --prefix app run build`
Expected: all pass; build succeeds (uPlot CSS import works in Next).

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/package-lock.json app/src/ui/plot app/src/ui/AppShell.tsx
git rm app/src/ui/PlotDock.tsx
git commit -m "feat(app): plot dock with signal list and uPlot chart"
```

---

### Task 11: Canvas feedback and the error bar

**Files:**
- Create: `app/src/ui/canvas/OpLabels.tsx`, `app/src/ui/canvas/ErrorOverlay.tsx`, `app/src/ui/SimErrorBar.tsx`, `app/src/ui/SimErrorBar.test.tsx`, `app/src/ui/StatusBar.test.tsx`
- Modify: `app/src/ui/canvas/Canvas.tsx`, `app/src/ui/canvas/PartNode.tsx`, `app/src/ui/StatusBar.tsx`, `app/src/ui/AppShell.tsx`

**Interfaces:**
- Consumes: `simFeedback`, `canvasLabels`, `CanvasLabel` (Task 8); `pinPosition`, `partBounds`; store `select`, `setView`.
- Produces:
  - `PartNode` prop `errors?: string[]`
  - `OpLabels({ labels, zoom })` and `ErrorOverlay({ points })`
  - `SimErrorBar()`
  - Canvas container attributes `data-error-parts` (count of parts with errors) and `data-op-labels` (count of labels)
  - status bar button named `N problem(s)`

- [ ] **Step 1: Write the failing tests**

Create `app/src/ui/SimErrorBar.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import SimErrorBar from "./SimErrorBar";

const state = () => editorStore.getState();

beforeEach(() => resetEditor());

describe("SimErrorBar", () => {
  it("is hidden without a failure", () => {
    render(<SimErrorBar />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows engine advice with an expandable log, and closes", () => {
    state().startRun();
    state().finishRun({ status: "engine", message: "m", log: ["stderr Error: timestep too small"] });
    render(<SimErrorBar />);
    expect(screen.getByRole("alert")).toHaveTextContent("The simulation didn't converge. Try a smaller max step.");
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    expect(screen.getByText("stderr Error: timestep too small")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows circuit-wide netlist problems and hides when outdated", () => {
    state().startRun();
    state().finishRun({ status: "netlist", errors: [{ code: "no_ground", message: "The circuit has no ground. Add a Ground part.", componentUid: null }] });
    render(<SimErrorBar />);
    expect(screen.getByRole("alert")).toHaveTextContent("no ground");
    state().setAnalysis({ type: "op" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
```

Create `app/src/ui/StatusBar.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import StatusBar from "./StatusBar";

const state = () => editorStore.getState();

beforeEach(() => resetEditor());

describe("StatusBar problems", () => {
  it("selects erroring parts in turn", () => {
    const a = state().placePart("basic.resistor", [100, 100])!;
    const b = state().placePart("basic.resistor", [300, 100])!;
    state().startRun();
    state().finishRun({
      status: "netlist",
      errors: [
        { code: "unconnected_pin", message: "R1 pin 1 is not connected", componentUid: a, pin: "1" },
        { code: "unconnected_pin", message: "R2 pin 1 is not connected", componentUid: b, pin: "1" },
      ],
    });
    render(<StatusBar />);
    const button = screen.getByRole("button", { name: "2 problems" });
    fireEvent.click(button);
    expect(state().selection).toEqual({ kind: "component", uid: a });
    fireEvent.click(button);
    expect(state().selection).toEqual({ kind: "component", uid: b });
    fireEvent.click(button);
    expect(state().selection).toEqual({ kind: "component", uid: a });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix app test -- SimErrorBar StatusBar`
Expected: FAIL — `SimErrorBar` missing; no problems button.

- [ ] **Step 3: Implement the error bar and status bar**

Create `app/src/ui/SimErrorBar.tsx`:
```tsx
"use client";

import { useMemo, useState } from "react";
import { simFeedback } from "@/model/results";
import { useEditor } from "@/model/store";

export default function SimErrorBar() {
  const sim = useEditor((s) => s.sim);
  const project = useEditor((s) => s.project);
  const bar = useMemo(() => simFeedback(sim, project).bar, [sim, project]);
  const [dismissed, setDismissed] = useState<typeof sim.outcome>(null);
  const [showLog, setShowLog] = useState(false);
  if (!bar || dismissed === sim.outcome) return null;
  return (
    <div role="alert" className="absolute left-1/2 top-2 z-30 w-[36rem] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded border border-error bg-panel px-3 py-2 text-error">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">{bar.message}</span>
        {bar.log && bar.log.length > 0 && (
          <button className="text-muted hover:text-text" onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide log" : "Show log"}</button>
        )}
        <button aria-label="Dismiss" className="text-muted hover:text-text" onClick={() => { setDismissed(sim.outcome); setShowLog(false); }}>✕</button>
      </div>
      {showLog && bar.log && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{bar.log.join("\n")}</pre>
      )}
    </div>
  );
}
```

In `app/src/ui/StatusBar.tsx`, add a problems button. When `simFeedback(sim, project).problemUids` is non-empty, render the sim status text as a `<button>` instead of the span. Its accessible name is the status text (e.g. "2 problems"). It keeps an index in `useRef(0)` that resets when `sim.outcome` changes, and on click:
```ts
    const uid = problemUids[index.current % problemUids.length];
    index.current += 1;
    const s = editorStore.getState();
    s.select({ kind: "component", uid });
    const inst = s.project.components.find((c) => c.uid === uid);
    const part = inst && partMap(s.library).get(inst.part);
    const canvas = document.querySelector<HTMLElement>('[data-testid="canvas"]');
    if (inst && part && canvas) {
      const b = partBounds(inst, part.manifest.symbol);
      const zoom = s.project.view?.zoom ?? 1;
      const rect = canvas.getBoundingClientRect();
      s.setView(zoom, [rect.width / 2 - (b.x + b.width / 2) * zoom, rect.height / 2 - (b.y + b.height / 2) * zoom]);
    }
```
Give the button `className="text-error hover:underline"`. Keep `data-testid="sim-status"` on whichever element shows the text.

- [ ] **Step 4: Implement canvas overlays**

Create `app/src/ui/canvas/OpLabels.tsx`:
```tsx
"use client";

import { Text } from "react-konva";
import type { CanvasLabel } from "@/model/results";
import { tokens } from "@/theme/tokens";

export default function OpLabels({ labels, zoom }: { labels: CanvasLabel[]; zoom: number }) {
  const scale = 1 / zoom;
  return (
    <>
      {labels.map((label) => (
        <Text
          key={label.key}
          x={label.point[0]}
          y={label.point[1]}
          offsetY={10}
          scaleX={scale}
          scaleY={scale}
          text={label.text}
          fontSize={10}
          fontFamily="Segoe UI, system-ui, sans-serif"
          fill={label.tone === "meter" ? tokens.accent : tokens.muted}
          listening={false}
        />
      ))}
    </>
  );
}
```

Create `app/src/ui/canvas/ErrorOverlay.tsx`:
```tsx
"use client";

import { Circle } from "react-konva";
import type { Point } from "@/model/types";
import { tokens } from "@/theme/tokens";

export default function ErrorOverlay({ points }: { points: Point[] }) {
  return (
    <>
      {points.map((p, i) => (
        <Circle key={`${p[0]},${p[1]},${i}`} x={p[0]} y={p[1]} radius={5} stroke={tokens.error} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      ))}
    </>
  );
}
```

In `app/src/ui/canvas/PartNode.tsx`:
- Add the prop `errors?: string[]` and `const [hovered, setHovered] = useState(false);` (import `useState`).
- Change the color: `const color = errors && errors.length > 0 ? tokens.error : selected ? tokens.selected : tokens.text;` and use it for `useSymbolImage`. The label `fill` becomes `errors?.length ? tokens.error : selected ? tokens.selected : tokens.muted`.
- On the `Group`, add `onMouseEnter={() => setHovered(true)}` and `onMouseLeave={() => setHovered(false)}`.
- After the label `Text`, when `!ghost && hovered && errors?.length`, render:
```tsx
        <Text x={bounds.x} y={bounds.y + bounds.height + 6} text={errors.join("\n")} fontSize={11}
          fontFamily="Segoe UI, system-ui, sans-serif" fill={tokens.error} listening={false} />
```

In `app/src/ui/canvas/Canvas.tsx`:
- Read `const sim = useEditor((s) => s.sim);`.
- Compute:
```tsx
  const feedback = useMemo(() => simFeedback(sim, project), [sim, project]);
  const labels = useMemo(
    () => (feedback.showLabels && sim.outcome?.status === "ok" ? canvasLabels(sim.outcome.result, project, parts) : []),
    [feedback, sim, project, parts],
  );
  const errorPins = useMemo(() => feedback.pinErrors.flatMap(({ uid, pin }) => {
    const inst = project.components.find((c) => c.uid === uid);
    const def = inst && parts.get(inst.part)?.manifest.symbol.pins.find((p) => p.id === pin);
    return inst && def ? [pinPosition(inst, def)] : [];
  }), [feedback, project, parts]);
```
- Pass `errors={feedback.partMessages.get(inst.uid)}` to each placed `PartNode`.
- Render `<OpLabels labels={labels} zoom={zoom} />` and `<ErrorOverlay points={errorPins} />` in the `Layer` after the parts.
- Add `data-error-parts={feedback.partMessages.size}` and `data-op-labels={labels.length}` to the container `div`.
- Imports: `simFeedback`, `canvasLabels` from `@/model/results`; `pinPosition` from `@/model/geometry`; the two overlays.

In `app/src/ui/AppShell.tsx`, render `<SimErrorBar />` inside `<main>` right after `<Canvas />`.

- [ ] **Step 5: Run the tests and build**

Run: `npm --prefix app test && npm --prefix app run build`
Expected: all pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/src
git commit -m "feat(app): error highlights, simulation error bar and operating-point labels"
```

---

### Task 12: End-to-end flows, checklist and full run

**Files:**
- Create: `app/e2e/simulation.spec.ts`
- Modify: `docs/desktop-checklist.md`

**Interfaces:**
- Consumes: everything above; `window.__multysm` test hook (the editor store); mock backend.

- [ ] **Step 1: Write the end-to-end tests**

Create `app/e2e/simulation.spec.ts`:
```ts
import { expect, test, type Page } from "@playwright/test";

type Store = { getState(): Record<string, (...args: unknown[]) => unknown> & { library: unknown } };

function divider(withGround: boolean, extraResistor = false) {
  return {
    format: 1, app: "e2e", packs: [],
    components: [
      { uid: "c1", part: "sources.dc_voltage", ref: "V1", x: 0, y: 100, rot: 0, mirror: false, params: { voltage: "10" } },
      { uid: "c2", part: "basic.resistor", ref: "R1", x: 100, y: 90, rot: 0, mirror: false, params: {} },
      { uid: "c3", part: "basic.resistor", ref: "R2", x: 200, y: 90, rot: 0, mirror: false, params: {} },
      ...(withGround ? [{ uid: "c4", part: "sources.ground", ref: "GND1", x: 10, y: 200, rot: 0, mirror: false, params: {} }] : []),
      ...(extraResistor ? [{ uid: "c5", part: "basic.resistor", ref: "R3", x: 400, y: 300, rot: 0, mirror: false, params: {} }] : []),
    ],
    wires: [
      { uid: "w1", points: [[20, 100], [100, 100]] },
      { uid: "w2", points: [[160, 100], [200, 100]] },
      { uid: "w3", points: [[260, 100], [260, 200], [20, 200]] },
      { uid: "w4", points: [[20, 160], [20, 200]] },
    ],
    analysis: { type: "tran", stop: "10m", step: "10u" },
    probes: [],
    view: { zoom: 1, pan: [100, 100] },
  };
}

async function load(page: Page, project: unknown) {
  await page.evaluate((p) => {
    const store = (window as unknown as { __multysm: Store }).__multysm;
    store.getState().loadProject(p, null);
  }, project);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => {
      const store = (window as unknown as { __multysm?: Store }).__multysm;
      return !!store && store.getState().library !== null;
    }))
    .toBe(true);
});

test("shows problems on the canvas and in the status bar", async ({ page }) => {
  await load(page, divider(false, true));
  await page.getByRole("button", { name: "▶ Run" }).click();
  await expect(page.getByRole("alert")).toContainText("no ground");
  await expect(page.getByRole("button", { name: "3 problems" })).toBeVisible();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-error-parts", "1");
});

test("runs an operating point and labels the nets", async ({ page }) => {
  await load(page, divider(true));
  await page.getByRole("button", { name: "Transient · 10 ms" }).click();
  await page.getByRole("dialog", { name: "Analysis" }).getByLabel("Operating point").check();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "▶ Run" }).click();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-op-labels", "2");
  await expect(page.getByTestId("sim-status")).toContainText("Done in");
});

test("plots a transient and marks it outdated after an edit", async ({ page }) => {
  await load(page, divider(true));
  await page.keyboard.press("Control+Enter");
  const plot = page.getByRole("region", { name: "Plot" });
  await expect(plot).toBeVisible();
  await plot.getByRole("checkbox", { name: "V(R1:2)" }).check();
  await expect(plot.getByTestId("chart").locator("canvas").first()).toBeVisible();
  await page.evaluate(() => {
    const store = (window as unknown as { __multysm: Store }).__multysm;
    store.getState().setParam("c2", "resistance", "2k");
  });
  await expect(plot.getByText("outdated")).toBeVisible();
});
```

The first test expects `3 problems`: the mock reports the missing ground, shown in the error bar, plus R3's two unconnected pins. The status text counts every netlist error, and it's a button because at least one error names a part.

- [ ] **Step 2: Run the end-to-end suite**

Run: `npm --prefix app run e2e`
Expected: 11 passed (8 existing + 3 new). A failure is a real bug or a test-mechanics issue: debug with `npx --prefix app playwright test --headed`, fix app code, and don't weaken assertions.

- [ ] **Step 3: Update the desktop checklist**

In `docs/desktop-checklist.md`, insert after item 9 (renumber the final "tests pass" item to 13):
```markdown
10. Build an RC circuit (DC source, 1k, 1µ, ground), Transient · 10 ms, ▶ Run: the plot dock opens; tick the capacitor net and a rising curve appears.
11. Set Transient stop time to `10` and max step `1u`, Run, then ■ Stop within a second: the status bar shows "Stopped" and a new Run works.
12. LED + 330 Ω + 5 V + ground, Operating point, Run: the anode net label reads about 1.9 V; remove the ground and Run: the error bar says the circuit has no ground.
```

- [ ] **Step 4: Run everything**

Run: `cargo test --workspace && npm --prefix app test && npm --prefix app run build && npm --prefix app run e2e`
Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add app/e2e/simulation.spec.ts docs/desktop-checklist.md
git commit -m "test(app): end-to-end simulation flows and desktop checklist"
```

---

## Not in this plan (Plan B and later)

- Two plot cursors with Δt, ΔV and frequency readouts; measurements.
- Stacked high/low logic traces for logic probes.
- Probe tool on wires; plot export; resizable dock.
- Live mode (spec §6.2) and virtual instruments.
- Engine follow-ups from Plan 1: `on_exit` recovery flag, failed-start library leak, `ConfigMismatch` comparing `codemodel_dir`.
