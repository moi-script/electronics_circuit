import { describe, expect, it } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { testLibrary } from "@/test/resetEditor";
import { buildNets } from "./nets";
import { diodeCurrent, partEffects } from "./partEffects";
import { simFeedback } from "./results";
import { GROUND_NET, type SimOutcome, type UiResult, type UiSignal } from "./simTypes";
import { idleSim } from "./store";
import { emptyProject, type Project } from "./types";
import { partMap } from "./wiring";

const parts = partMap(testLibrary);
const ledModel = { is: 1e-20, n: 1.5, rs: 2 };

/** V1 -> R1 -> D1 (LED) -> ground. */
function ledProject(): Project {
  const project = emptyProject();
  project.components = [
    { uid: "c1", part: "sources.dc_voltage", ref: "V1", x: 0, y: 100, rot: 0, mirror: false, params: {} },
    { uid: "c2", part: "basic.resistor", ref: "R1", x: 100, y: 90, rot: 0, mirror: false, params: {} },
    { uid: "c3", part: "diodes.led", ref: "D1", x: 200, y: 90, rot: 0, mirror: false, params: {} },
    { uid: "c4", part: "sources.ground", ref: "GND1", x: 10, y: 200, rot: 0, mirror: false, params: {} },
  ];
  project.wires = [
    { uid: "w1", points: [[20, 100], [100, 100]] },
    { uid: "w2", points: [[160, 100], [200, 100]] },
    { uid: "w3", points: [[240, 100], [240, 200], [20, 200]] },
    { uid: "w4", points: [[20, 160], [20, 200]] },
  ];
  return project;
}

/** An op result where each pin's net sits at `volts[uid.pin]` and V1 delivers `sourceCurrent`. */
function result(project: Project, volts: Record<string, number>, sourceCurrent = -0.01): UiResult {
  const nets = buildNets(project, parts);
  const signals: UiSignal[] = nets.pinNet
    .filter((p) => p.net !== GROUND_NET && `${p.uid}.${p.pin}` in volts)
    .map((p) => ({ id: p.net, kind: "voltage", values: [volts[`${p.uid}.${p.pin}`]] }));
  signals.push({ id: "v1#branch", kind: "current", values: [sourceCurrent] });
  return { analysis: "op", x: null, signals, nets };
}

const done = (outcome: SimOutcome) => ({ ...idleSim(), status: "done" as const, outcome });
const ok = (r: UiResult): SimOutcome => ({ status: "ok", result: r, elapsedMs: 1 });

describe("diodeCurrent", () => {
  it("follows the LED model: nothing when reverse biased, milliamps near its forward voltage", () => {
    expect(diodeCurrent(-2, ledModel)).toBe(0);
    expect(diodeCurrent(1.2, ledModel)).toBeLessThan(1e-6);
    const i = diodeCurrent(1.6, ledModel);
    expect(i).toBeGreaterThan(5e-3);
    expect(i).toBeLessThan(3e-2);
  });
});

describe("partEffects", () => {
  it("lights an LED carrying forward current", () => {
    const project = ledProject();
    const effects = partEffects(done(ok(result(project, { "c3.A": 1.62 }))), project, parts);
    const d1 = effects.get("c3");
    expect(d1?.kind).toBe("glow");
    if (d1?.kind === "glow") expect(d1.brightness).toBeGreaterThan(0.5);
    expect(effects.has("c1")).toBe(false);
  });

  it("leaves an LED dark below its forward voltage", () => {
    const project = ledProject();
    expect(partEffects(done(ok(result(project, { "c3.A": 1.1 }))), project, parts).size).toBe(0);
  });

  it("burns out an LED driven with no series resistor", () => {
    const project = ledProject();
    const d1 = partEffects(done(ok(result(project, { "c3.A": 5 }))), project, parts).get("c3");
    expect(d1).toMatchObject({ kind: "blown" });
  });

  it("blows a voltage source delivering a short-circuit current", () => {
    const project = ledProject();
    const v1 = partEffects(done(ok(result(project, { "c3.A": 1.5 }, -40))), project, parts).get("c1");
    expect(v1).toMatchObject({ kind: "blown" });
  });

  it("finds a source shorted by a wire even when the engine refuses the circuit", () => {
    const project = dividerProject();
    project.wires.push({ uid: "w9", points: [[20, 100], [20, 160]] });
    const engine: SimOutcome = { status: "engine", message: "", log: ["singular matrix"] };
    const sim = { ...idleSim(), status: "failed" as const, outcome: engine };
    expect(partEffects(sim, project, parts).get("c1")).toMatchObject({ kind: "blown" });

    const feedback = simFeedback(sim, project, parts);
    expect(feedback.bar?.message).toMatch(/Short circuit: V1/);
    expect(feedback.problemUids).toEqual(["c1"]);
  });

  it("shows nothing for a stale or running result", () => {
    const project = ledProject();
    const outcome = ok(result(project, { "c3.A": 5 }));
    expect(partEffects({ ...done(outcome), stale: true }, project, parts).size).toBe(0);
    expect(partEffects({ ...done(outcome), status: "running" }, project, parts).size).toBe(0);
  });
});
