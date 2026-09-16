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
            // The unit follows the swept part, not a guess from the reference's first letter
            // (a current source can be named e.g. "ISRC1", and nothing stops a voltage source
            // from being named "I1").
            let unit = match project.components.iter().find(|c| &c.reference == source) {
                Some(c) if c.part == "sources.dc_current" => "A",
                _ => "V",
            };
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
