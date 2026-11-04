import { formatValue } from "./format";
import { buildNets } from "./nets";
import { parseSi } from "./si";
import { GROUND_NET, type NetsData, type UiResult } from "./simTypes";
import type { SimSlice } from "./store";
import type { PartDef, Project } from "./types";

/** Above this an LED burns out. Real parts are rated ~20 mA with a ~30 mA absolute maximum. */
export const LED_MAX_CURRENT = 0.05;
/** Current an LED needs to look fully lit. */
export const LED_FULL_CURRENT = 0.02;
/** Current an LED needs to show any light at all. */
export const LED_MIN_CURRENT = 1e-4;
/** A voltage source delivering more than this is treated as short-circuited. */
export const SOURCE_SHORT_CURRENT = 5;

export type PartEffect =
  | { kind: "glow"; brightness: number; color: string }
  | { kind: "blown"; message: string };

const THERMAL_VOLTAGE = 0.02585;

const isLed = (part: PartDef) => part.refPrefix === "D" && part.manifest.tags.includes("light");
const isVoltageSource = (part: PartDef) => part.refPrefix === "V" && part.manifest.spice.kind === "analog";

const LED_COLORS: [RegExp, string][] = [
  [/green/i, "#5dff7a"],
  [/blue/i, "#5aa8ff"],
  [/yellow|amber/i, "#ffd84a"],
  [/white/i, "#f4f7ff"],
];

export function ledColor(part: PartDef): string {
  return LED_COLORS.find(([pattern]) => pattern.test(part.manifest.name))?.[1] ?? "#ff4b3e";
}

interface DiodeModel { is: number; n: number; rs: number }

function modelParam(models: string[], key: string, fallback: number): number {
  const match = new RegExp(`\\b${key}=([^\\s)]+)`, "i").exec(models.join(" "));
  const parsed = match ? parseSi(match[1]) : null;
  return parsed?.ok ? parsed.value : fallback;
}

function diodeModel(part: PartDef): DiodeModel {
  const models = part.manifest.spice.models ?? [];
  return { is: modelParam(models, "Is", 1e-14), n: modelParam(models, "N", 1), rs: modelParam(models, "Rs", 0) };
}

/** Forward current through a diode with series resistance for a terminal voltage `v`. */
export function diodeCurrent(v: number, { is, n, rs }: DiodeModel): number {
  if (!(v > 0)) return 0;
  const nvt = n * THERMAL_VOLTAGE;
  if (rs <= 0) return is * Math.expm1(v / nvt);
  // v = nvt * ln(1 + i/is) + i*rs is monotonic in i: bisect on [0, v/rs].
  let lo = 0;
  let hi = v / rs;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (nvt * Math.log1p(mid / is) + mid * rs > v) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function netOf(nets: NetsData, uid: string, pin: string): string | undefined {
  return nets.pinNet.find((p) => p.uid === uid && p.pin === pin)?.net;
}

/** The two nodes a two-terminal template connects, e.g. `{ref} {pin.p} {pin.n} DC 5` or `{ref} {pin.1} 0 DC 5`. */
function templateNodes(part: PartDef, uid: string, nets: NetsData): (string | undefined)[] {
  const tokens = (part.manifest.spice.template ?? "").split(/\s+/).slice(1, 3);
  return tokens.map((token) => {
    if (token === "0") return GROUND_NET;
    const pin = /^\{pin\.([^}]+)\}$/.exec(token)?.[1];
    return pin === undefined ? undefined : netOf(nets, uid, pin);
  });
}

function samples(result: UiResult, net: string | undefined): number[] | null {
  if (net === undefined) return null;
  if (net === GROUND_NET) return [0];
  return result.signals.find((s) => s.id === net)?.values ?? null;
}

const at = (values: number[], k: number) => values[Math.min(k, values.length - 1)];

/**
 * Visual consequences of the last run: lit LEDs, and parts destroyed by a short circuit or
 * overcurrent. Shorted voltage sources are found from connectivity alone, so they show even
 * when the engine refuses the circuit.
 */
export function partEffects(sim: SimSlice, project: Project, parts: Map<string, PartDef>): Map<string, PartEffect> {
  const effects = new Map<string, PartEffect>();
  const outcome = sim.outcome;
  if (!outcome || sim.stale || sim.status === "running") return effects;
  if (outcome.status !== "ok" && outcome.status !== "engine") return effects;

  const result = outcome.status === "ok" ? outcome.result : null;
  const nets = result?.nets ?? buildNets(project, parts);
  const timeDomain = result !== null && result.analysis !== "ac";

  for (const inst of project.components) {
    const part = parts.get(inst.part);
    if (!part) continue;

    if (isVoltageSource(part)) {
      const [a, b] = templateNodes(part, inst.uid, nets);
      if (a !== undefined && a === b) {
        effects.set(inst.uid, { kind: "blown", message: `Short circuit: ${inst.ref}'s terminals are wired straight together.` });
        continue;
      }
      const current = timeDomain ? result.signals.find((s) => s.id === `${inst.ref.toLowerCase()}#branch`)?.values : undefined;
      const peak = current ? Math.max(...current.map(Math.abs)) : 0;
      if (peak > SOURCE_SHORT_CURRENT) {
        effects.set(inst.uid, { kind: "blown", message: `Short circuit: ${inst.ref} is delivering ${formatValue(peak, "A")}.` });
      }
      continue;
    }

    if (isLed(part) && timeDomain) {
      const anode = samples(result, netOf(nets, inst.uid, "A"));
      const cathode = samples(result, netOf(nets, inst.uid, "K"));
      if (!anode || !cathode) continue;
      const model = diodeModel(part);
      const count = Math.max(anode.length, cathode.length);
      const currents = Array.from({ length: count }, (_, k) => diodeCurrent(at(anode, k) - at(cathode, k), model));
      const peak = Math.max(...currents);
      if (peak > LED_MAX_CURRENT) {
        effects.set(inst.uid, {
          kind: "blown",
          message: `${inst.ref} burnt out: ${formatValue(peak, "A")} is more than it can take. Add a series resistor.`,
        });
        continue;
      }
      const final = currents[count - 1];
      if (final > LED_MIN_CURRENT) {
        const brightness = Math.min(1, Math.log(final / LED_MIN_CURRENT) / Math.log(LED_FULL_CURRENT / LED_MIN_CURRENT));
        effects.set(inst.uid, { kind: "glow", brightness: Math.max(0.15, brightness), color: ledColor(part) });
      }
    }
  }
  return effects;
}
