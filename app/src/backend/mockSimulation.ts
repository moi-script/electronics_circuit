import { pinPosition, pointOnSegment, samePoint } from "@/model/geometry";
import { parseSi } from "@/model/si";
import { GROUND_NET, type NetlistError, type NetsData, type SimOutcome, type UiResult, type UiSignal } from "@/model/simTypes";
import type { LibraryData, PartDef, Point, Project } from "@/model/types";
import { partMap } from "@/model/wiring";

/** Connectivity with the same rules as multysm-core `build_nets` (enough for the mock). */
export function mockNets(project: Project, parts: Map<string, PartDef>): NetsData {
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

const SOURCE_PARTS = new Set(["sources.dc_voltage", "sources.dc_current", "sources.ac_voltage", "sources.ac_current", "sources.pulse_voltage", "sources.vcc"]);

function netlistErrors(project: Project, parts: Map<string, PartDef>, nets: NetsData): NetlistError[] {
  const errors: NetlistError[] = [];
  if (!nets.netPins[GROUND_NET]) {
    errors.push({ code: "no_ground", message: "The circuit has no ground. Add a Ground part.", componentUid: null });
  }
  for (const [net, members] of Object.entries(nets.netPins)) {
    if (net === GROUND_NET || members.length !== 1) continue;
    const { uid, pin } = members[0];
    const inst = project.components.find((c) => c.uid === uid)!;
    const def = parts.get(inst.part)!.manifest.symbol.pins.find((p) => p.id === pin)!;
    if (def.optional) continue;
    errors.push({ code: "unconnected_pin", message: `${inst.ref} pin ${def.name ?? def.id} is not connected`, componentUid: uid, pin });
  }
  return errors;
}

const range = (n: number, f: (k: number) => number) => Array.from({ length: n }, (_, k) => f(k));
const si = (text: string, fallback: number) => {
  const parsed = parseSi(text);
  return parsed.ok ? parsed.value : fallback;
};

/** Deterministic fake results so the UI works in a plain browser and in tests. */
export function mockSimulate(project: Project, library: LibraryData | null): SimOutcome {
  const parts = partMap(library);
  const nets = mockNets(project, parts);
  const errors = netlistErrors(project, parts, nets);
  if (errors.length > 0) return { status: "netlist", errors };

  const netNames = Object.keys(nets.netPins).filter((n) => n !== GROUND_NET);
  const level = (i: number) => (5 * (i + 1)) / netNames.length;
  const analysis = project.analysis;
  let x: UiResult["x"] = null;
  let shape: (k: number) => number = () => 1;
  let count = 1;
  if (analysis.type === "tran") {
    const stop = si(analysis.stop, 0.01);
    count = 200;
    x = { label: "time", unit: "s", values: range(count, (k) => (stop * k) / (count - 1)), log: false };
    const values = x.values;
    shape = (k) => 1 - Math.exp(-values[k] / (stop / 5));
  } else if (analysis.type === "ac") {
    const start = si(analysis.start, 10);
    const stop = si(analysis.stop, 1e5);
    count = 50;
    x = { label: "frequency", unit: "Hz", values: range(count, (k) => start * (stop / start) ** (k / (count - 1))), log: true };
  } else if (analysis.type === "dc") {
    const start = si(analysis.start, 0);
    const stop = si(analysis.stop, 5);
    count = 50;
    const unit = project.components.find((c) => c.ref === analysis.source)?.part === "sources.dc_current" ? "A" : "V";
    x = { label: analysis.source, unit, values: range(count, (k) => start + ((stop - start) * k) / (count - 1)), log: false };
    shape = (k) => k / (count - 1);
  }

  const signals: UiSignal[] = netNames.map((net, i) => {
    if (analysis.type === "ac" && x) {
      const fc = Math.sqrt(x.values[0] * x.values[x.values.length - 1]);
      const freqs = x.values;
      return {
        id: net,
        kind: "voltage",
        values: freqs.map((f) => 20 * Math.log10(1 / Math.sqrt(1 + (f / fc) ** 2)) - i),
        phase: freqs.map((f) => (-Math.atan(f / fc) * 180) / Math.PI),
      };
    }
    return { id: net, kind: "voltage", values: range(count, (k) => level(i) * shape(k)) };
  });
  for (const inst of project.components) {
    if (SOURCE_PARTS.has(inst.part)) {
      signals.push({ id: `${inst.ref.toLowerCase()}#branch`, kind: "current", values: range(count, () => -0.001) });
    } else if (inst.part === "indicators.ammeter") {
      signals.push({ id: `v.x${inst.ref.toLowerCase()}.vsense#branch`, kind: "current", values: range(count, () => 0.005) });
    }
  }
  return { status: "ok", result: { analysis: analysis.type, x, signals, nets }, elapsedMs: 12 };
}
