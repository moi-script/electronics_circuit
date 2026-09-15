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
use std::sync::Mutex;

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
}

#[derive(Debug, Clone, PartialEq)]
pub enum Vector {
    Real(Vec<f64>),
    Complex(Vec<(f64, f64)>),
}

#[derive(Debug, Clone, PartialEq)]
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

pub fn run_netlist(config: &EngineConfig, netlist: &str) -> Result<SimResult, EngineError> {
    let mut guard = ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(Engine::start(config)?);
    }
    let engine = guard.as_ref().expect("engine started above");
    if engine.dll_path != config.dll_path {
        return Err(EngineError::ConfigMismatch);
    }
    engine.run(netlist)
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
            let path = path.to_string_lossy().replace('\\', "/");
            engine.command(&format!("codemodel {path}"));
        }
        take_log();
        Ok(engine)
    }

    fn command(&self, command: &str) -> c_int {
        let command = CString::new(command).expect("command has no NUL byte");
        unsafe { (self.api.command)(command.as_ptr()) }
    }

    fn run(&self, netlist: &str) -> Result<SimResult, EngineError> {
        self.command("remcirc");
        self.command("destroy all");
        take_log();

        let lines: Vec<CString> = netlist
            .lines()
            .map(|line| CString::new(line).expect("netlist has no NUL byte"))
            .collect();
        let mut pointers: Vec<*mut c_char> =
            lines.iter().map(|line| line.as_ptr() as *mut c_char).collect();
        pointers.push(std::ptr::null_mut());

        let status = unsafe { (self.api.circ)(pointers.as_mut_ptr()) };
        let mut log = take_log();
        if status != 0 || has_error(&log) {
            return Err(EngineError::Circuit { log });
        }

        let status = self.command("run");
        log.extend(take_log());
        if status != 0 || has_error(&log) {
            return Err(EngineError::Run { log });
        }

        let (plot, vectors) = unsafe { self.collect_vectors() };
        if vectors.is_empty() {
            return Err(EngineError::Run { log });
        }
        Ok(SimResult { plot, vectors, log })
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

unsafe extern "C" fn on_bg_thread(_running: bool, _id: c_int, _user: *mut c_void) -> c_int {
    0
}
