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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::ser::{Serialize, SerializeStruct, Serializer};

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
    #[error("the simulation was stopped")]
    Stopped,
    #[error("the simulation took longer than {seconds} s and was stopped")]
    Timeout { seconds: u64 },
}

impl EngineError {
    /// Stable machine-readable name of the variant.
    pub fn kind(&self) -> &'static str {
        match self {
            EngineError::Load { .. } => "load",
            EngineError::Circuit { .. } => "circuit",
            EngineError::Run { .. } => "run",
            EngineError::ConfigMismatch => "config_mismatch",
            EngineError::Stopped => "stopped",
            EngineError::Timeout { .. } => "timeout",
        }
    }

    pub fn log(&self) -> Option<&[String]> {
        match self {
            EngineError::Circuit { log } | EngineError::Run { log } => Some(log),
            _ => None,
        }
    }
}

/// Serializes as `{ "kind": "load"|"circuit"|"run"|"config_mismatch",
/// "message": <Display text>, "log"?: [lines] }`.
impl Serialize for EngineError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut out = serializer.serialize_struct("EngineError", 3)?;
        out.serialize_field("kind", self.kind())?;
        out.serialize_field("message", &self.to_string())?;
        match self.log() {
            Some(log) => out.serialize_field("log", log)?,
            None => out.skip_field("log")?,
        }
        out.end()
    }
}

/// Serializes as `{ "type": "real", "values": [..] }` or
/// `{ "type": "complex", "values": [[re, im], ..] }`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "type", content = "values", rename_all = "lowercase")]
pub enum Vector {
    Real(Vec<f64>),
    Complex(Vec<(f64, f64)>),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
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

/// Set by ngspice's background-thread callback: `true` when no background
/// run is active. Cleared just before `bg_run`.
static BG_IDLE: AtomicBool = AtomicBool::new(true);

const POLL: Duration = Duration::from_millis(10);
/// If ngspice never reports the background thread, give up waiting after this.
const START_WAIT: Duration = Duration::from_secs(1);
/// Longest wait for a halted run to wind down.
const HALT_WAIT: Duration = Duration::from_secs(5);

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
            let path_str = path.to_string_lossy().replace('\\', "/");
            let status = engine.command(&format!("codemodel {path_str}"));
            let log = take_log();
            if status != 0 || has_error(&log) {
                return Err(load_error(format!(
                    "failed to load code model {}:\n{}",
                    path.display(),
                    log.join("\n")
                )));
            }
        }
        take_log();
        Ok(engine)
    }

    fn command(&self, command: &str) -> c_int {
        match CString::new(command) {
            Ok(command) => unsafe { (self.api.command)(command.as_ptr()) },
            Err(_) => {
                push_log("stderr Error: command contains a NUL byte".into());
                1
            }
        }
    }

    fn run(
        &self,
        netlist: &str,
        cancel: &AtomicBool,
        timeout: Option<Duration>,
    ) -> Result<SimResult, EngineError> {
        self.command("remcirc");
        self.command("destroy all");
        take_log();

        let Ok(lines) = netlist.lines().map(CString::new).collect::<Result<Vec<CString>, _>>() else {
            return Err(EngineError::Circuit { log: vec!["netlist contains a NUL byte".into()] });
        };
        let mut pointers: Vec<*mut c_char> =
            lines.iter().map(|line| line.as_ptr() as *mut c_char).collect();
        pointers.push(std::ptr::null_mut());

        let status = unsafe { (self.api.circ)(pointers.as_mut_ptr()) };
        let mut log = take_log();
        if status != 0 || has_error(&log) {
            return Err(EngineError::Circuit { log });
        }

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

        let (plot, vectors) = unsafe { self.collect_vectors() };
        // "const" is ngspice's built-in constants plot; it is the current plot
        // whenever no analysis (.op, .tran, .ac, ...) actually ran, so a run
        // that leaves it in place produced no simulation results even though
        // `vectors` is non-empty (it holds only physical constants).
        if vectors.is_empty() || plot == "const" {
            return Err(EngineError::Run { log });
        }
        Ok(SimResult { plot, vectors, log })
    }

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

unsafe extern "C" fn on_bg_thread(noruns: bool, _id: c_int, _user: *mut c_void) -> c_int {
    BG_IDLE.store(noruns, Ordering::SeqCst);
    0
}
