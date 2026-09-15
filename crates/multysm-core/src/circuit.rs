//! The saved circuit (`.msym` project) and schematic geometry.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::library::Pin;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub format: u32,
    pub app: String,
    #[serde(default)]
    pub packs: Vec<PackRef>,
    pub components: Vec<ComponentInstance>,
    pub wires: Vec<Wire>,
    pub analysis: Analysis,
    #[serde(default)]
    pub probes: Vec<String>,
    #[serde(default)]
    pub view: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackRef {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentInstance {
    pub uid: String,
    pub part: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub x: i64,
    pub y: i64,
    #[serde(default)]
    pub rot: u16,
    #[serde(default)]
    pub mirror: bool,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Wire {
    pub uid: String,
    pub points: Vec<[i64; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Analysis {
    Op,
    Tran {
        stop: String,
        step: String,
    },
    Ac {
        start: String,
        stop: String,
        #[serde(rename = "pointsPerDecade")]
        points_per_decade: u32,
    },
    Dc {
        source: String,
        start: String,
        stop: String,
        step: String,
    },
}

/// Absolute schematic position of a pin. Mirror flips the local x axis,
/// then rotation is applied clockwise on screen (y grows downward).
pub fn pin_position(inst: &ComponentInstance, pin: &Pin) -> (i64, i64) {
    let x = if inst.mirror { -pin.x } else { pin.x };
    let y = pin.y;
    let (dx, dy) = match inst.rot % 360 {
        90 => (-y, x),
        180 => (-x, -y),
        270 => (y, -x),
        _ => (x, y),
    };
    (inst.x + dx, inst.y + dy)
}

/// True when `p` lies on the closed segment from `a` to `b`.
pub fn point_on_segment(p: (i64, i64), a: (i64, i64), b: (i64, i64)) -> bool {
    let cross = (b.0 - a.0) * (p.1 - a.1) - (b.1 - a.1) * (p.0 - a.0);
    cross == 0
        && p.0 >= a.0.min(b.0)
        && p.0 <= a.0.max(b.0)
        && p.1 >= a.1.min(b.1)
        && p.1 <= a.1.max(b.1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Pin;

    fn inst(rot: u16, mirror: bool) -> ComponentInstance {
        ComponentInstance {
            uid: "c1".into(),
            part: "basic.resistor".into(),
            reference: "R1".into(),
            x: 100,
            y: 200,
            rot,
            mirror,
            params: Default::default(),
        }
    }

    fn pin(x: i64, y: i64) -> Pin {
        Pin { id: "2".into(), name: None, x, y, optional: false }
    }

    #[test]
    fn pin_position_applies_rotation_clockwise() {
        let p = pin(60, 10);
        assert_eq!(pin_position(&inst(0, false), &p), (160, 210));
        assert_eq!(pin_position(&inst(90, false), &p), (90, 260));
        assert_eq!(pin_position(&inst(180, false), &p), (40, 190));
        assert_eq!(pin_position(&inst(270, false), &p), (110, 140));
    }

    #[test]
    fn pin_position_mirrors_before_rotating() {
        let p = pin(60, 10);
        assert_eq!(pin_position(&inst(0, true), &p), (40, 210));
        assert_eq!(pin_position(&inst(90, true), &p), (90, 140));
    }

    #[test]
    fn point_on_segment_handles_ends_interior_and_misses() {
        assert!(point_on_segment((0, 0), (0, 0), (10, 0)));
        assert!(point_on_segment((5, 0), (0, 0), (10, 0)));
        assert!(point_on_segment((10, 0), (0, 0), (10, 0)));
        assert!(!point_on_segment((11, 0), (0, 0), (10, 0)));
        assert!(!point_on_segment((5, 1), (0, 0), (10, 0)));
        assert!(point_on_segment((3, 3), (0, 0), (6, 6)));
    }

    #[test]
    fn project_json_round_trip() {
        let json = r#"{
          "format": 1, "app": "0.1.0",
          "packs": [{ "id": "core", "version": "1.0.0" }],
          "components": [{ "uid": "c7", "part": "basic.resistor", "ref": "R1",
                           "x": 120, "y": 80, "rot": 90, "mirror": false,
                           "params": { "resistance": "4.7k" } }],
          "wires": [{ "uid": "w3", "points": [[120,80],[200,80]] }],
          "analysis": { "type": "tran", "stop": "10m", "step": "10u" },
          "probes": ["net:out"],
          "view": { "zoom": 1, "pan": [0,0] }
        }"#;
        let project: Project = serde_json::from_str(json).unwrap();
        assert_eq!(project.components[0].reference, "R1");
        assert_eq!(
            project.analysis,
            Analysis::Tran { stop: "10m".into(), step: "10u".into() }
        );
        let again: Project =
            serde_json::from_str(&serde_json::to_string(&project).unwrap()).unwrap();
        assert_eq!(again, project);
    }

    #[test]
    fn ac_analysis_uses_camel_case() {
        let a: Analysis = serde_json::from_str(
            r#"{ "type": "ac", "start": "10", "stop": "1meg", "pointsPerDecade": 20 }"#,
        )
        .unwrap();
        assert_eq!(
            a,
            Analysis::Ac { start: "10".into(), stop: "1meg".into(), points_per_decade: 20 }
        );
    }
}
