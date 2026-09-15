//! Connectivity: which pins are joined by wires.
//!
//! Rules: consecutive wire vertices are joined; any pin or wire vertex lying
//! on a wire segment joins that wire; pins/vertices at the same coordinate
//! are joined. Wires that merely cross (no vertex on the other) stay apart.

use std::collections::BTreeMap;

use super::{ErrorCode, NetlistError};
use crate::circuit::{pin_position, point_on_segment, Project};
use crate::library::{Library, Spice};

pub type PinKey = (String, String);

pub const GROUND: &str = "0";

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Nets {
    pub pin_net: BTreeMap<PinKey, String>,
    pub net_pins: BTreeMap<String, Vec<PinKey>>,
}

pub fn build_nets(project: &Project, library: &Library) -> Result<Nets, Vec<NetlistError>> {
    let mut errors = Vec::new();
    let mut points: Vec<(i64, i64)> = Vec::new();
    let mut pins: Vec<(PinKey, bool)> = Vec::new(); // index-aligned with the first points

    for inst in &project.components {
        let Some(part) = library.get(&inst.part) else {
            errors.push(NetlistError::new(
                ErrorCode::UnknownPart,
                format!("{}: unknown part '{}'", inst.reference, inst.part),
                Some(inst.uid.as_str()),
            ));
            continue;
        };
        let is_ground = matches!(part.manifest.spice, Spice::Ground);
        for pin in &part.manifest.symbol.pins {
            points.push(pin_position(inst, pin));
            pins.push(((inst.uid.clone(), pin.id.clone()), is_ground));
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    let mut segments: Vec<(usize, usize)> = Vec::new();
    for wire in &project.wires {
        let first = points.len();
        points.extend(wire.points.iter().map(|p| (p[0], p[1])));
        for i in 1..wire.points.len() {
            segments.push((first + i - 1, first + i));
        }
    }

    let mut sets = UnionFind::new(points.len());
    let mut by_coord: BTreeMap<(i64, i64), usize> = BTreeMap::new();
    for (i, p) in points.iter().enumerate() {
        match by_coord.get(p) {
            Some(&j) => sets.union(i, j),
            None => {
                by_coord.insert(*p, i);
            }
        }
    }
    for &(a, b) in &segments {
        sets.union(a, b);
        for (i, p) in points.iter().enumerate() {
            if point_on_segment(*p, points[a], points[b]) {
                sets.union(i, a);
            }
        }
    }

    let mut names: BTreeMap<usize, String> = BTreeMap::new();
    for (i, (_, is_ground)) in pins.iter().enumerate() {
        if *is_ground {
            names.insert(sets.find(i), GROUND.to_string());
        }
    }
    let mut next = 1;
    let mut nets = Nets::default();
    for (i, (key, _)) in pins.iter().enumerate() {
        let root = sets.find(i);
        let name = names
            .entry(root)
            .or_insert_with(|| {
                let name = format!("n{next}");
                next += 1;
                name
            })
            .clone();
        nets.pin_net.insert(key.clone(), name.clone());
        nets.net_pins.entry(name).or_default().push(key.clone());
    }
    Ok(nets)
}

struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        Self { parent: (0..n).collect() }
    }

    fn find(&mut self, i: usize) -> usize {
        let mut root = i;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        let mut node = i;
        while self.parent[node] != root {
            let next = self.parent[node];
            self.parent[node] = root;
            node = next;
        }
        root
    }

    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.parent[rb.max(ra)] = ra.min(rb);
        }
    }
}
