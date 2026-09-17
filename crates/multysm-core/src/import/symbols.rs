//! Symbols for imported parts: built-in device drawings or a generated box.

use serde::Serialize;

use super::candidate::PartKind;
use crate::library::Pin;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GeneratedSymbol {
    /// File name inside the pack's `symbols/` folder.
    pub file_name: String,
    pub svg: String,
    pub width: i64,
    pub height: i64,
    pub pins: Vec<Pin>,
}

pub fn symbol_for(kind: PartKind, _model_type: &str, name: &str, ports: &[String]) -> GeneratedSymbol {
    let pins = match kind {
        PartKind::Diode => vec![pin("A", "Anode", 0, 10), pin("K", "Cathode", 40, 10)],
        PartKind::Bjt => vec![pin("C", "C", 30, 0), pin("B", "B", 0, 20), pin("E", "E", 30, 40)],
        PartKind::Mosfet | PartKind::Jfet => vec![pin("D", "D", 30, 0), pin("G", "G", 0, 20), pin("S", "S", 30, 40)],
        PartKind::Subckt => ports.iter().enumerate().map(|(i, p)| pin(&(i + 1).to_string(), p, 0, 10 * i as i64)).collect(),
    };
    GeneratedSymbol { file_name: format!("{name}.svg"), svg: String::new(), width: 40, height: 40, pins }
}

pub(crate) fn pin(id: &str, name: &str, x: i64, y: i64) -> Pin {
    Pin { id: id.into(), name: Some(name.into()), x, y, optional: false }
}
