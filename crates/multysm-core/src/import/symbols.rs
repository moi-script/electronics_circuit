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

const DIODE: &str = include_str!("../../../../components/core/symbols/diode.svg");
const NPN: &str = include_str!("../../../../components/core/symbols/npn.svg");
const PNP: &str = include_str!("../../../../components/core/symbols/pnp.svg");
const NMOS: &str = include_str!("../../../../components/core/symbols/nmos.svg");
const PMOS: &str = include_str!("../../../../components/core/symbols/pmos.svg");
const NJF: &str = include_str!("../../../../components/core/symbols/njf.svg");
const PJF: &str = include_str!("../../../../components/core/symbols/pjf.svg");

pub fn symbol_for(kind: PartKind, model_type: &str, name: &str, ports: &[String]) -> GeneratedSymbol {
    let three = |file: &str, svg: &str, first: &str, second: &str, third: &str| GeneratedSymbol {
        file_name: file.into(),
        svg: svg.trim().into(),
        width: 40,
        height: 40,
        pins: vec![pin(first, first, 30, 0), pin(second, second, 0, 20), pin(third, third, 30, 40)],
    };
    match (kind, model_type) {
        (PartKind::Diode, _) => GeneratedSymbol {
            file_name: "diode.svg".into(),
            svg: DIODE.trim().into(),
            width: 40,
            height: 20,
            pins: vec![pin("A", "Anode", 0, 10), pin("K", "Cathode", 40, 10)],
        },
        (PartKind::Bjt, "PNP") => three("pnp.svg", PNP, "C", "B", "E"),
        (PartKind::Bjt, _) => three("npn.svg", NPN, "C", "B", "E"),
        (PartKind::Mosfet, "PMOS") => three("pmos.svg", PMOS, "D", "G", "S"),
        (PartKind::Mosfet, _) => three("nmos.svg", NMOS, "D", "G", "S"),
        (PartKind::Jfet, "PJF") => three("pjf.svg", PJF, "D", "G", "S"),
        (PartKind::Jfet, _) => three("njf.svg", NJF, "D", "G", "S"),
        (PartKind::Subckt, _) => box_symbol(name, ports),
    }
}

pub(crate) fn pin(id: &str, name: &str, x: i64, y: i64) -> Pin {
    Pin { id: id.into(), name: Some(name.into()), x, y, optional: false }
}

fn round_up_10(v: i64) -> i64 {
    (v + 9) / 10 * 10
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Odd ports on the left, even on the right, 20 px apart starting at y = 20.
fn box_symbol(name: &str, ports: &[String]) -> GeneratedSymbol {
    let rows = (ports.len() as i64 + 1) / 2;
    let height = (rows * 20 + 20).max(40);
    let longest = |side: usize| ports.iter().skip(side).step_by(2).map(|p| p.len() as i64).max().unwrap_or(0);
    let width = round_up_10((name.len() as i64 * 6 + 30).max((longest(0) + longest(1)) * 4 + 40)).max(80);

    let mut pins = Vec::new();
    let mut body = format!(r#"<rect x="10" y="4" width="{}" height="{}" rx="2"/>"#, width - 20, height - 8);
    for (i, port) in ports.iter().enumerate() {
        let row = i as i64 / 2;
        let y = 20 + row * 20;
        let left = i % 2 == 0;
        let x = if left { 0 } else { width };
        pins.push(pin(&(i + 1).to_string(), port, x, y));
        let (x1, x2, label_x, anchor) = if left { (0, 10, 13, "start") } else { (width - 10, width, width - 13, "end") };
        body.push_str(&format!(r#"<path d="M{x1} {y}h{}"/>"#, x2 - x1));
        body.push_str(&format!(
            r#"<text x="{label_x}" y="{}" font-size="6" text-anchor="{anchor}" fill="currentColor" stroke="none">{}</text>"#,
            y + 2,
            escape(port)
        ));
    }
    body.push_str(&format!(
        r#"<text x="{}" y="{}" font-size="8" text-anchor="middle" fill="currentColor" stroke="none">{}</text>"#,
        width / 2,
        height - 8,
        escape(name)
    ));
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" fill="none" stroke="currentColor" stroke-width="1.5" font-family="Segoe UI, sans-serif">{body}</svg>"#
    );
    GeneratedSymbol { file_name: format!("{name}.svg"), svg, width, height, pins }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn devices_use_built_in_drawings_and_core_pin_positions() {
        let d = symbol_for(PartKind::Diode, "D", "x", &[]);
        assert_eq!((d.file_name.as_str(), d.width, d.height), ("diode.svg", 40, 20));
        assert_eq!(d.pins.iter().map(|p| (p.id.as_str(), p.x, p.y)).collect::<Vec<_>>(), [("A", 0, 10), ("K", 40, 10)]);
        assert!(d.svg.contains("currentColor"));
        assert_eq!(symbol_for(PartKind::Bjt, "PNP", "x", &[]).file_name, "pnp.svg");
        assert_eq!(symbol_for(PartKind::Bjt, "NPN", "x", &[]).file_name, "npn.svg");
        assert_eq!(symbol_for(PartKind::Mosfet, "PMOS", "x", &[]).file_name, "pmos.svg");
        assert_eq!(symbol_for(PartKind::Mosfet, "VDMOS", "x", &[]).file_name, "nmos.svg");
        assert_eq!(symbol_for(PartKind::Jfet, "PJF", "x", &[]).file_name, "pjf.svg");
    }

    #[test]
    fn box_alternates_ports_left_and_right_on_the_grid() {
        let ports: Vec<String> = ["IN+", "IN-", "V+", "V-", "OUT"].iter().map(|s| s.to_string()).collect();
        let s = symbol_for(PartKind::Subckt, "", "lm358", &ports);
        assert_eq!(s.file_name, "lm358.svg");
        let pins: Vec<(&str, &str, i64, i64)> =
            s.pins.iter().map(|p| (p.id.as_str(), p.name.as_deref().unwrap(), p.x, p.y)).collect();
        assert_eq!(pins, [
            ("1", "IN+", 0, 20), ("2", "IN-", s.width, 20),
            ("3", "V+", 0, 40), ("4", "V-", s.width, 40),
            ("5", "OUT", 0, 60),
        ]);
        assert_eq!(s.height, 80);
        assert!(s.width >= 80 && s.width % 10 == 0);
        assert!(s.svg.contains(">lm358<") && s.svg.contains(">IN+<"));
    }

    #[test]
    fn box_escapes_xml_and_grows_for_long_names() {
        let s = symbol_for(PartKind::Subckt, "", "a_very_long_subcircuit_name", &["<a>".to_string()]);
        assert!(s.svg.contains("&lt;a&gt;"));
        assert!(s.width > 80);
        assert_eq!(s.height, 40);
    }
}
