import { GROUND_NET, type UiResult } from "./simTypes";
import type { PartDef, Project } from "./types";

export const TRACE_COLORS = ["#5fb3a8", "#d9a35f", "#7aa2d6", "#c98bd1", "#8fc27a", "#d97a7a", "#6fc4c4", "#c9ced8"];

const PROBE_PARTS = new Set(["indicators.probe", "indicators.logic_probe"]);

export const probeRef = (uid: string, pin: string) => `pin:${uid}:${pin}`;

export interface PlotSignal {
  key: string;
  label: string;
  unit: "V" | "A";
  auto: boolean;
  /** Saved probe reference for net voltages; null for signals that can't be saved. */
  probe: string | null;
  values: number[];
  phase?: number[];
}

/** First pin (component order, then manifest pin order) on each net. */
function firstPins(result: UiResult, project: Project, parts: Map<string, PartDef>) {
  const byPin = new Map(result.nets.pinNet.map((p) => [`${p.uid} ${p.pin}`, p.net]));
  const first = new Map<string, { uid: string; pin: string; label: string }>();
  for (const inst of project.components) {
    for (const pin of parts.get(inst.part)?.manifest.symbol.pins ?? []) {
      const net = byPin.get(`${inst.uid} ${pin.id}`);
      if (net !== undefined && !first.has(net)) first.set(net, { uid: inst.uid, pin: pin.id, label: `${inst.ref}:${pin.name ?? pin.id}` });
    }
  }
  return { byPin, first };
}

export function netNames(result: UiResult, project: Project, parts: Map<string, PartDef>): Map<string, string> {
  const { byPin, first } = firstPins(result, project, parts);
  const names = new Map<string, string>();
  for (const inst of project.components) {
    if (!PROBE_PARTS.has(inst.part)) continue;
    const net = byPin.get(`${inst.uid} 1`);
    if (net !== undefined && net !== GROUND_NET && !names.has(net)) names.set(net, inst.ref);
  }
  for (const net of Object.keys(result.nets.netPins)) {
    if (net === GROUND_NET) names.set(net, "GND");
    else if (!names.has(net)) names.set(net, first.get(net)?.label ?? net);
  }
  return names;
}

export function listSignals(result: UiResult, project: Project, parts: Map<string, PartDef>): PlotSignal[] {
  const names = netNames(result, project, parts);
  const { byPin, first } = firstPins(result, project, parts);
  const byId = new Map(result.signals.map((s) => [s.id, s]));
  const length = result.x?.values.length ?? 1;
  const netValues = (net: string | undefined) =>
    net === undefined ? null : net === GROUND_NET ? new Array<number>(length).fill(0) : byId.get(net)?.values ?? null;

  const meters: PlotSignal[] = [];
  const probed = new Set<string>();
  for (const inst of project.components) {
    // Subtracting AC magnitudes (dB) node-to-node is meaningless, so voltmeters are skipped in AC.
    if (inst.part === "indicators.voltmeter" && result.analysis !== "ac") {
      const p = netValues(byPin.get(`${inst.uid} p`));
      const n = netValues(byPin.get(`${inst.uid} n`));
      if (p && n) meters.push({ key: `vm:${inst.uid}`, label: `V(${inst.ref})`, unit: "V", auto: true, probe: null, values: p.map((v, i) => v - (n[i] ?? 0)) });
    } else if (inst.part === "indicators.ammeter") {
      const s = byId.get(`v.x${inst.ref.toLowerCase()}.vsense#branch`);
      if (s) meters.push({ key: `am:${inst.uid}`, label: `I(${inst.ref})`, unit: "A", auto: true, probe: null, values: s.values, phase: s.phase });
    } else if (PROBE_PARTS.has(inst.part)) {
      const net = byPin.get(`${inst.uid} 1`);
      if (net !== undefined) probed.add(net);
    }
  }

  const voltages: PlotSignal[] = result.signals
    .filter((s) => s.kind === "voltage" && s.id !== GROUND_NET)
    .map((s) => ({
      key: `v:${s.id}`,
      label: `V(${names.get(s.id) ?? s.id})`,
      unit: "V" as const,
      auto: probed.has(s.id),
      probe: first.has(s.id) ? probeRef(first.get(s.id)!.uid, first.get(s.id)!.pin) : null,
      values: s.values,
      phase: s.phase,
    }))
    .sort((a, b) => Number(b.auto) - Number(a.auto) || a.label.localeCompare(b.label));

  const refs = new Map(project.components.map((c) => [c.ref.toLowerCase(), c.ref]));
  const currents: PlotSignal[] = result.signals
    .filter((s) => s.kind === "current" && !s.id.includes("."))
    .flatMap((s) => {
      const ref = refs.get(s.id.replace(/#branch$/, ""));
      return ref ? [{ key: `i:${s.id}`, label: `I(${ref})`, unit: "A" as const, auto: false, probe: null, values: s.values, phase: s.phase }] : [];
    });

  return [...meters, ...voltages, ...currents];
}

/** The net a saved `pin:<uid>:<pin>` probe currently resolves to, via the live pin→net map, so a
 * probe keeps ticking its net even after the net's "first pin" (used only for labels) changes.
 * Returns undefined for a malformed ref or one whose pin no longer exists (a stale probe, which
 * is simply ignored rather than treated as an error). */
export function netOfProbe(ref: string, result: UiResult): string | undefined {
  const parts = ref.split(":");
  if (parts.length !== 3 || parts[0] !== "pin") return undefined;
  const [, uid, pin] = parts;
  return result.nets.pinNet.find((p) => p.uid === uid && p.pin === pin)?.net;
}

export function tickedKeys(signals: PlotSignal[], probes: string[], hiddenAuto: Set<string>, result: UiResult): string[] {
  const probedNets = new Set(probes.flatMap((ref) => {
    const net = netOfProbe(ref, result);
    return net !== undefined ? [net] : [];
  }));
  return signals
    .filter((s) => {
      if (s.auto) return !hiddenAuto.has(s.key);
      if (s.key.startsWith("v:")) return probedNets.has(s.key.slice(2));
      return s.probe !== null && probes.includes(s.probe);
    })
    .map((s) => s.key);
}
