//! Circuit JSON → SPICE netlist.

mod build;
mod nets;
pub mod template;
mod validate;

pub use build::{build_netlist, Netlist};
pub use nets::{build_nets, Nets, PinKey, GROUND};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    UnknownPart,
    NoGround,
    UnconnectedPin,
    InvalidParam,
    Template,
    ModelFile,
    BadAnalysis,
    InvalidReference,
    DuplicateReference,
    RefPrefixMismatch,
    InvalidRotation,
}

/// A problem found before simulation, tied to a component when possible so
/// the editor can highlight it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NetlistError {
    pub code: ErrorCode,
    pub message: String,
    pub component_uid: Option<String>,
}

impl NetlistError {
    pub fn new(code: ErrorCode, message: String, uid: Option<&str>) -> Self {
        Self { code, message, component_uid: uid.map(str::to_string) }
    }
}
