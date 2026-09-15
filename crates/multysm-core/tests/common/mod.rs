#![allow(dead_code)]

use multysm_core::library::{load_library, Library};
use std::path::{Path, PathBuf};

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crate lives in <root>/crates/multysm-core")
        .to_path_buf()
}

pub fn core_library() -> Library {
    let lib = load_library(&[workspace_root().join("components").join("core")]);
    assert!(lib.issues.is_empty(), "core library issues: {:#?}", lib.issues);
    lib
}

use multysm_core::circuit::{
    pin_position, point_on_segment, Analysis, ComponentInstance, Project, Wire,
};

/// Builds test circuits without hand-placing coordinates. Parts are placed on
/// a parabola (x = i*1000, y = i*i*1000) so straight wires rarely cross pins;
/// `connect` panics if a wire would touch any other pin. Add all parts first.
pub struct CircuitBuilder<'a> {
    library: &'a Library,
    project: Project,
}

impl<'a> CircuitBuilder<'a> {
    pub fn new(library: &'a Library, analysis: Analysis) -> Self {
        Self {
            library,
            project: Project {
                format: 1,
                app: "test".into(),
                packs: vec![],
                components: vec![],
                wires: vec![],
                analysis,
                probes: vec![],
                view: None,
            },
        }
    }

    pub fn add(&mut self, part: &str, reference: &str, params: &[(&str, &str)]) -> String {
        assert!(self.library.get(part).is_some(), "unknown part {part}");
        let i = self.project.components.len() as i64;
        let uid = format!("c{}", i + 1);
        self.project.components.push(ComponentInstance {
            uid: uid.clone(),
            part: part.into(),
            reference: reference.into(),
            x: i * 1000,
            y: i * i * 1000,
            rot: 0,
            mirror: false,
            params: params.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        });
        uid
    }

    pub fn pin_pos<U: AsRef<str>>(&self, (uid, pin_id): (U, &str)) -> (i64, i64) {
        let uid = uid.as_ref();
        let inst = self
            .project
            .components
            .iter()
            .find(|c| c.uid == uid)
            .unwrap_or_else(|| panic!("no component {uid}"));
        let pin = self
            .library
            .get(&inst.part)
            .unwrap()
            .manifest
            .symbol
            .pins
            .iter()
            .find(|p| p.id == pin_id)
            .unwrap_or_else(|| panic!("{uid} has no pin {pin_id}"));
        pin_position(inst, pin)
    }

    pub fn connect<A: AsRef<str>, B: AsRef<str>>(&mut self, a: (A, &str), b: (B, &str)) {
        let a = (a.0.as_ref(), a.1);
        let b = (b.0.as_ref(), b.1);
        let pa = self.pin_pos(a);
        let pb = self.pin_pos(b);
        for inst in &self.project.components {
            for pin in &self.library.get(&inst.part).unwrap().manifest.symbol.pins {
                let key = (inst.uid.as_str(), pin.id.as_str());
                if key == a || key == b {
                    continue;
                }
                assert!(
                    !point_on_segment(pin_position(inst, pin), pa, pb),
                    "wire {a:?} -> {b:?} would touch {key:?}; reorder the parts"
                );
            }
        }
        self.wire(vec![[pa.0, pa.1], [pb.0, pb.1]]);
    }

    pub fn wire(&mut self, points: Vec<[i64; 2]>) {
        let uid = format!("w{}", self.project.wires.len() + 1);
        self.project.wires.push(Wire { uid, points });
    }

    pub fn build(self) -> Project {
        self.project
    }
}
