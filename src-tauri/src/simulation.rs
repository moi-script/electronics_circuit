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

/// Clears `running` however the run ends (including a panic). Owns an `Arc` so it can be moved
/// into a `spawn_blocking` task: the busy check and the `cancel` reset that guard against happen
/// synchronously in the async command, before the blocking task (and therefore before a
/// same-tick `stop_simulation` call) ever runs -- see `SimShared::claim`.
pub struct RunningGuard(Arc<SimShared>);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.running.store(false, Ordering::SeqCst);
    }
}

impl SimShared {
    /// Claims the run slot and clears any stale `cancel` flag left by a previous run. Returns
    /// `None` when another run is already in flight (the caller should reply `Busy`). Must be
    /// called synchronously, before scheduling the blocking work, so a `stop_simulation` issued
    /// right after `simulate` can never race the reset and get its cancel silently cleared.
    pub fn claim(shared: &Arc<SimShared>) -> Option<RunningGuard> {
        if shared.running.swap(true, Ordering::SeqCst) {
            return None;
        }
        shared.cancel.store(false, Ordering::SeqCst);
        Some(RunningGuard(shared.clone()))
    }
}

fn execute(shared: &SimShared, project: &Project, components: &Path, config: &EngineConfig, timeout: Duration) -> SimOutcome {
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

/// Runs a simulation, doing the busy check and `cancel` reset itself. Used directly by tests;
/// the Tauri `simulate` command instead claims the run synchronously with `SimShared::claim`
/// (see `run_claimed`) so that work happens before, not inside, the blocking task.
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
    struct LocalGuard<'a>(&'a AtomicBool);
    impl Drop for LocalGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _guard = LocalGuard(&shared.running);
    shared.cancel.store(false, Ordering::SeqCst);
    execute(shared, project, components, config, timeout)
}

/// Runs a simulation whose run slot was already claimed with `SimShared::claim`. The guard is
/// kept alive for the whole call and clears `running` on drop.
pub fn run_claimed(guard: &RunningGuard, project: &Project, components: &Path, config: &EngineConfig, timeout: Duration) -> SimOutcome {
    execute(&guard.0, project, components, config, timeout)
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
