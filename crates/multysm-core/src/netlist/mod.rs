//! Circuit JSON → SPICE netlist.

mod build;
mod nets;
pub mod template;
pub(crate) mod validate;

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
