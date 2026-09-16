import { formatValue } from "./format";
import { partBounds, pinPosition } from "./geometry";
import { GROUND_NET, type SimOutcome, type UiResult } from "./simTypes";
import type { SimSlice } from "./store";
import type { PartDef, Point, Project } from "./types";

const ENGINE_MESSAGES: [RegExp, string][] = [
  [/timestep too small/i, "The simulation didn't converge. Try a smaller max step."],
  [/singular matrix/i, "Part of the circuit is floating. Check that every part connects to ground."],
  [/no convergence|gmin/i, "The simulation didn't converge. Check source values and connections."],
];

export function engineMessage(log: string[]): string {
  const text = log.join("\n");
  return ENGINE_MESSAGES.find(([pattern]) => pattern.test(text))?.[1] ?? "The simulator reported an error.";
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Components whose reference appears in the log as an element or subcircuit name (`rr1`, `xu1.q1`). */
export function partsNamedInLog(log: string[], project: Project): string[] {
  const text = log.join("\n");
  return project.components
    .filter((c) => /^[A-Za-z][A-Za-z0-9_]*$/.test(c.ref))
    .filter((c) => new RegExp(`(^|[^a-z0-9_])[a-z]?${escapeRegExp(c.ref)}(?=\\.|[^a-z0-9_]|$)`, "i").test(text))
    .map((c) => c.uid);
}

export function signalValue(result: UiResult, id: string): number | null {
  const values = result.signals.find((s) => s.id === id)?.values;
  return values && values.length > 0 ? values[values.length - 1] : null;
}

export interface CanvasLabel {
  key: string;
  point: Point;
  text: string;
  tone: "net" | "meter";
}

function netOfPin(result: UiResult, uid: string, pin: string): string | undefined {
  return result.nets.pinNet.find((p) => p.uid === uid && p.pin === pin)?.net;
}

function netVoltage(result: UiResult, net: string | undefined): number | null {
  if (net === undefined) return null;
  return net === GROUND_NET ? 0 : signalValue(result, net);
}

export function canvasLabels(result: UiResult, project: Project, parts: Map<string, PartDef>): CanvasLabel[] {
  const labels: CanvasLabel[] = [];
  for (const [net, members] of Object.entries(result.nets.netPins)) {
    if (net === GROUND_NET) continue;
    const value = signalValue(result, net);
    if (value === null) continue;
    let best: { length: number; a: Point; b: Point } | null = null;
    for (const wire of project.wires) {
      if (result.nets.wireNet[wire.uid] !== net) continue;
      for (let i = 1; i < wire.points.length; i++) {
        const a = wire.points[i - 1];
        const b = wire.points[i];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!best || length > best.length) best = { length, a, b };
      }
    }
    let point: Point | null = null;
    if (best) {
      point = [(best.a[0] + best.b[0]) / 2, (best.a[1] + best.b[1]) / 2 - 6];
    } else {
      const first = members[0];
      const inst = project.components.find((c) => c.uid === first.uid);
      const pin = inst && parts.get(inst.part)?.manifest.symbol.pins.find((p) => p.id === first.pin);
      if (inst && pin) {
        const [x, y] = pinPosition(inst, pin);
        point = [x + 6, y - 6];
      }
    }
    if (point) labels.push({ key: `net:${net}`, point, text: formatValue(value, "V"), tone: "net" });
  }

  for (const inst of project.components) {
    const part = parts.get(inst.part);
    if (!part) continue;
    let text: string | null = null;
    if (inst.part === "indicators.voltmeter") {
      const p = netVoltage(result, netOfPin(result, inst.uid, "p"));
      const n = netVoltage(result, netOfPin(result, inst.uid, "n"));
      if (p !== null && n !== null) text = `${inst.ref} ${formatValue(p - n, "V")}`;
    } else if (inst.part === "indicators.ammeter") {
      const i = signalValue(result, `v.x${inst.ref.toLowerCase()}.vsense#branch`);
      if (i !== null) text = `${inst.ref} ${formatValue(i, "A")}`;
    }
    if (text) {
      const bounds = partBounds(inst, part.manifest.symbol);
      labels.push({ key: `meter:${inst.uid}`, point: [bounds.x + bounds.width + 8, bounds.y], text, tone: "meter" });
    }
  }
  return labels;
}

export interface SimFeedback {
  partMessages: Map<string, string[]>;
  pinErrors: { uid: string; pin: string }[];
  bar: { message: string; log: string[] | null } | null;
  problemUids: string[];
  showLabels: boolean;
}

const EMPTY: SimFeedback = { partMessages: new Map(), pinErrors: [], bar: null, problemUids: [], showLabels: false };

export function simFeedback(sim: SimSlice, project: Project): SimFeedback {
  const outcome: SimOutcome | null = sim.outcome;
  if (!outcome || sim.stale || sim.status === "running") return EMPTY;
  switch (outcome.status) {
    case "ok":
      return { ...EMPTY, showLabels: outcome.result.analysis === "op" };
    case "netlist": {
      const partMessages = new Map<string, string[]>();
      const loose: string[] = [];
      for (const error of outcome.errors) {
        if (error.componentUid) partMessages.set(error.componentUid, [...(partMessages.get(error.componentUid) ?? []), error.message]);
        else loose.push(error.message);
      }
      return {
        partMessages,
        pinErrors: outcome.errors.filter((e) => e.componentUid && e.pin).map((e) => ({ uid: e.componentUid!, pin: e.pin! })),
        bar: loose.length > 0 ? { message: loose.join(" · "), log: null } : null,
        problemUids: [...partMessages.keys()],
        showLabels: false,
      };
    }
    case "engine": {
      const uids = partsNamedInLog(outcome.log, project);
      const message = engineMessage(outcome.log);
      return {
        ...EMPTY,
        partMessages: new Map(uids.map((uid) => [uid, [message]])),
        bar: { message, log: outcome.log },
        problemUids: uids,
      };
    }
    case "timeout":
      return { ...EMPTY, bar: { message: `Stopped after ${outcome.seconds} s. Try a shorter stop time or a larger max step.`, log: null } };
    case "busy":
      return { ...EMPTY, bar: { message: "A simulation is already running.", log: null } };
    case "stopped":
      return EMPTY;
  }
}
