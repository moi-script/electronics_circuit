import { emptyProject, type Project } from "@/model/types";

/** V1 (10 V) -> R1 -> R2 -> ground, same layout as the Rust command tests. */
export function dividerProject(withGround = true): Project {
  const project = emptyProject();
  project.components = [
    { uid: "c1", part: "sources.dc_voltage", ref: "V1", x: 0, y: 100, rot: 0, mirror: false, params: { voltage: "10" } },
    { uid: "c2", part: "basic.resistor", ref: "R1", x: 100, y: 90, rot: 0, mirror: false, params: {} },
    { uid: "c3", part: "basic.resistor", ref: "R2", x: 200, y: 90, rot: 0, mirror: false, params: {} },
    ...(withGround ? [{ uid: "c4", part: "sources.ground", ref: "GND1", x: 10, y: 200, rot: 0 as const, mirror: false, params: {} }] : []),
  ];
  project.wires = [
    { uid: "w1", points: [[20, 100], [100, 100]] },
    { uid: "w2", points: [[160, 100], [200, 100]] },
    { uid: "w3", points: [[260, 100], [260, 200], [20, 200]] },
    { uid: "w4", points: [[20, 160], [20, 200]] },
  ];
  return project;
}
