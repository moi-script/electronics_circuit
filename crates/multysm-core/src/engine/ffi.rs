//! Raw bindings to the ngspice shared library (sharedspice.h).

use std::os::raw::{c_char, c_double, c_int, c_short, c_void};
use std::path::Path;

use libloading::Library;

#[repr(C)]
pub struct NgComplex {
    pub cx_real: c_double,
    pub cx_imag: c_double,
}

#[repr(C)]
pub struct VectorInfo {
    pub v_name: *mut c_char,
    pub v_type: c_int,
    pub v_flags: c_short,
    pub v_realdata: *mut c_double,
    pub v_compdata: *mut NgComplex,
    pub v_length: c_int,
}

pub type SendChar = unsafe extern "C" fn(*mut c_char, c_int, *mut c_void) -> c_int;
pub type SendStat = unsafe extern "C" fn(*mut c_char, c_int, *mut c_void) -> c_int;
pub type ControlledExit = unsafe extern "C" fn(c_int, bool, bool, c_int, *mut c_void) -> c_int;
pub type SendData = unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut c_void) -> c_int;
pub type SendInitData = unsafe extern "C" fn(*mut c_void, c_int, *mut c_void) -> c_int;
pub type BgThreadRunning = unsafe extern "C" fn(bool, c_int, *mut c_void) -> c_int;

type InitFn = unsafe extern "C" fn(
    Option<SendChar>,
    Option<SendStat>,
    Option<ControlledExit>,
    Option<SendData>,
    Option<SendInitData>,
    Option<BgThreadRunning>,
    *mut c_void,
) -> c_int;
type CircFn = unsafe extern "C" fn(*mut *mut c_char) -> c_int;
type CommandFn = unsafe extern "C" fn(*const c_char) -> c_int;
type CurPlotFn = unsafe extern "C" fn() -> *mut c_char;
type AllVecsFn = unsafe extern "C" fn(*mut c_char) -> *mut *mut c_char;
type VecInfoFn = unsafe extern "C" fn(*mut c_char) -> *mut VectorInfo;
type RunningFn = unsafe extern "C" fn() -> bool;

pub struct NgspiceApi {
    pub init: InitFn,
    pub circ: CircFn,
    pub command: CommandFn,
    pub cur_plot: CurPlotFn,
    pub all_vecs: AllVecsFn,
    pub vec_info: VecInfoFn,
    pub running: RunningFn,
}

impl NgspiceApi {
    /// Loads the library and keeps it loaded for the life of the process
    /// (ngspice cannot be safely unloaded and reloaded).
    ///
    /// # Safety
    /// `path` must point to a genuine ngspice shared library.
    pub unsafe fn load(path: &Path) -> Result<Self, libloading::Error> {
        let lib: &'static Library = Box::leak(Box::new(Library::new(path)?));
        Ok(Self {
            init: *lib.get::<InitFn>(b"ngSpice_Init\0")?,
            circ: *lib.get::<CircFn>(b"ngSpice_Circ\0")?,
            command: *lib.get::<CommandFn>(b"ngSpice_Command\0")?,
            cur_plot: *lib.get::<CurPlotFn>(b"ngSpice_CurPlot\0")?,
            all_vecs: *lib.get::<AllVecsFn>(b"ngSpice_AllVecs\0")?,
            vec_info: *lib.get::<VecInfoFn>(b"ngGet_Vec_Info\0")?,
            running: *lib.get::<RunningFn>(b"ngSpice_running\0")?,
        })
    }
}
