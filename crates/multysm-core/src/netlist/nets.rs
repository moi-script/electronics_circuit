//! Connectivity: which pins are joined by wires.
//!
//! Rules: consecutive wire vertices are joined; any pin or wire vertex lying
//! on a wire segment joins that wire; pins/vertices at the same coordinate
//! are joined. Wires that merely cross (no vertex on the other) stay apart.

use std::collections::BTreeMap;

use serde::{Serialize, Serializer};

use super::{ErrorCode, NetlistError};
use crate::circuit::{pin_position, point_on_segment, Project};
use crate::library::{Library, Spice};

pub type PinKey = (String, String);

pub const GROUND: &str = "0";

/// Connectivity of a project. Serializes as
/// `{ "pinNet": [{ uid, pin, net }], "netPins": { net: [{ uid, pin }] }, "wireNet": { wireUid: net } }`.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Nets {
    #[serde(serialize_with = "pin_net_as_list")]
    pub pin_net: BTreeMap<PinKey, String>,
    #[serde(serialize_with = "net_pins_as_objects")]
    pub net_pins: BTreeMap<String, Vec<PinKey>>,
    /// Net of each wire that touches at least one pin, keyed by wire uid.
    pub wire_net: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct PinNet<'a> {
    uid: &'a str,
    pin: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    net: Option<&'a str>,
}

fn pin_net_as_list<S: Serializer>(map: &BTreeMap<PinKey, String>, s: S) -> Result<S::Ok, S::Error> {
    s.collect_seq(map.iter().map(|((uid, pin), net)| PinNet { uid, pin, net: Some(net) }))
}

fn net_pins_as_objects<S: Serializer>(
    map: &BTreeMap<String, Vec<PinKey>>,
    s: S,
) -> Result<S::Ok, S::Error> {
    s.collect_map(map.iter().map(|(net, pins)| {
        let pins: Vec<PinNet> =
            pins.iter().map(|(uid, pin)| PinNet { uid, pin, net: None }).collect();
        (net, pins)
    }))
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
    let mut wire_starts: Vec<(&str, usize)> = Vec::new();
    for wire in &project.wires {
        let first = points.len();
        if !wire.points.is_empty() {
            wire_starts.push((wire.uid.as_str(), first));
        }
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
    for (uid, first) in wire_starts {
        if let Some(name) = names.get(&sets.find(first)) {
            nets.wire_net.insert(uid.to_string(), name.clone());
        }
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
