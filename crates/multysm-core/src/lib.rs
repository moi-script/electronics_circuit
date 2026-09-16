//! multysm simulation core: manifests, netlists and the ngspice engine.

pub mod circuit;
pub mod engine;
pub mod library;
pub mod netlist;
pub mod project_file;
pub mod si;

use circuit::Project;
use engine::{run_netlist, EngineConfig, EngineError, SimResult};
use library::Library;
use netlist::{build_netlist, Netlist, NetlistError};

/// Serializes as `{ "kind": "netlist", "message", "errors": [NetlistError] }`
/// or, for engine failures, the `EngineError` shape
/// (`{ "kind": "load"|"circuit"|"run"|"config_mismatch", "message", "log"? }`).
#[derive(Debug, thiserror::Error)]
pub enum SimulateError {
    #[error("the circuit has {} problem(s)", .0.len())]
    Netlist(Vec<NetlistError>),
    #[error(transparent)]
    Engine(#[from] EngineError),
}

impl serde::Serialize for SimulateError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        match self {
            SimulateError::Netlist(errors) => {
                let mut out = serializer.serialize_struct("SimulateError", 3)?;
                out.serialize_field("kind", "netlist")?;
                out.serialize_field("message", &self.to_string())?;
                out.serialize_field("errors", errors)?;
                out.end()
            }
            SimulateError::Engine(e) => e.serialize(serializer),
        }
    }
}

/// Project → netlist → ngspice → results. The netlist is returned so callers
/// can map net names back to component pins.
pub fn simulate(
    project: &Project,
    library: &Library,
    config: &EngineConfig,
) -> Result<(Netlist, SimResult), SimulateError> {
    let netlist = build_netlist(project, library).map_err(SimulateError::Netlist)?;
    let result = run_netlist(config, &netlist.text)?;
    Ok((netlist, result))
}
