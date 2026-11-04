import { pinPosition, pointOnSegment, samePoint } from "./geometry";
import { GROUND_NET, type NetsData } from "./simTypes";
import type { PartDef, Point, Project } from "./types";

/** Connectivity with the same rules as multysm-core `build_nets` (enough for the mock and for
 * spotting shorts when the engine refuses to run). */
export function buildNets(project: Project, parts: Map<string, PartDef>): NetsData {
  const points: Point[] = [];
  const parent: number[] = [];
  const idOf = (p: Point) => {
    const found = points.findIndex((q) => samePoint(q, p));
    if (found !== -1) return found;
    points.push(p);
    parent.push(points.length - 1);
    return points.length - 1;
  };
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  const pins: { uid: string; pin: string; id: number; ground: boolean }[] = [];
  for (const inst of project.components) {
    const part = parts.get(inst.part);
    if (!part) continue;
    for (const pin of part.manifest.symbol.pins) {
      pins.push({ uid: inst.uid, pin: pin.id, id: idOf(pinPosition(inst, pin)), ground: part.manifest.spice.kind === "ground" });
    }
  }
  for (const wire of project.wires) {
    const ids = wire.points.map(idOf);
    for (let i = 1; i < ids.length; i++) union(ids[i - 1], ids[i]);
  }
  for (const wire of project.wires) {
    for (let i = 1; i < wire.points.length; i++) {
      const a = wire.points[i - 1];
      const b = wire.points[i];
      points.forEach((p, id) => { if (pointOnSegment(p, a, b)) union(id, idOf(a)); });
    }
  }

  const names = new Map<number, string>();
  for (const pin of pins) if (pin.ground) names.set(find(pin.id), GROUND_NET);
  let next = 1;
  for (const pin of pins) {
    const root = find(pin.id);
    if (!names.has(root)) names.set(root, `n${next++}`);
  }

  const pinNet = pins.map((p) => ({ uid: p.uid, pin: p.pin, net: names.get(find(p.id))! }));
  const netPins: NetsData["netPins"] = {};
  for (const p of pinNet) (netPins[p.net] ??= []).push({ uid: p.uid, pin: p.pin });
  const wireNet: NetsData["wireNet"] = {};
  for (const wire of project.wires) {
    const name = names.get(find(idOf(wire.points[0])));
    if (name) wireNet[wire.uid] = name;
  }
  return { pinNet, netPins, wireNet };
}
