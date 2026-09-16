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
