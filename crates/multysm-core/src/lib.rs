//! multysm simulation core: manifests, netlists and the ngspice engine.

pub mod circuit;
pub mod engine;
pub mod library;
pub mod netlist;
pub mod si;

use circuit::Project;
use engine::{run_netlist, EngineConfig, EngineError, SimResult};
use library::Library;
use netlist::{build_netlist, Netlist, NetlistError};

#[derive(Debug, thiserror::Error)]
pub enum SimulateError {
    #[error("the circuit has {} problem(s)", .0.len())]
    Netlist(Vec<NetlistError>),
    #[error(transparent)]
    Engine(#[from] EngineError),
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
