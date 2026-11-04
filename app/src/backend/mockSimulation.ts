import { buildNets as mockNets } from "@/model/nets";
import { parseSi } from "@/model/si";
import { GROUND_NET, type NetlistError, type NetsData, type SimOutcome, type UiResult, type UiSignal } from "@/model/simTypes";
import type { LibraryData, PartDef, Project } from "@/model/types";
import { partMap } from "@/model/wiring";

export { mockNets };

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
