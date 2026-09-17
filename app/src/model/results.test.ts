import { describe, expect, it } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { mockSimulate } from "@/backend/mockSimulation";
import { testLibrary } from "@/test/resetEditor";
import { canvasLabels, engineMessage, partsNamedInLog, simFeedback } from "./results";
import { idleSim } from "./store";
import type { SimOutcome, UiResult } from "./simTypes";
import { partMap } from "./wiring";

const parts = partMap(testLibrary);

function opResult(project = dividerProject()): UiResult {
  project.analysis = { type: "op" };
  const outcome = mockSimulate(project, testLibrary);
  if (outcome.status !== "ok") throw new Error(outcome.status);
  return outcome.result;
}

describe("engineMessage", () => {
  it("maps known ngspice failures to plain advice", () => {
    expect(engineMessage(["stderr Error: timestep too small"])).toBe("The simulation didn't converge. Try a smaller max step.");
    expect(engineMessage(["warning: SINGULAR MATRIX"])).toBe("Part of the circuit is floating. Check that every part connects to ground.");
    expect(engineMessage(["gmin stepping failed"])).toBe("The simulation didn't converge. Check source values and connections.");
    expect(engineMessage(["no convergence in dc"])).toBe("The simulation didn't converge. Check source values and connections.");
    expect(engineMessage(["something else"])).toBe("The simulator reported an error.");
  });

  it("appends the outcome message to the generic fallback when the log doesn't match a known pattern", () => {
    expect(engineMessage([], "could not load ngspice from X")).toBe("The simulator reported an error. could not load ngspice from X");
    expect(engineMessage([])).toBe("The simulator reported an error.");
    expect(engineMessage(["timestep too small"], "could not load ngspice from X")).toBe("The simulation didn't converge. Try a smaller max step.");
  });
});

describe("partsNamedInLog", () => {
  it("finds references by element and subcircuit names", () => {
    const project = dividerProject();
    project.components.push({ uid: "c9", part: "mixed.555", ref: "U1", x: 0, y: 0, rot: 0, mirror: false, params: {} });
    const log = ["Error on line: rr1 n1 n2 1e3", "singular matrix at node xu1.qraw", "R10 is fine"];
    expect(partsNamedInLog(log, project).sort()).toEqual(["c2", "c9"]);
  });
});

describe("canvasLabels", () => {
  it("labels each non-ground net at the midpoint of its longest wire segment", () => {
    const project = dividerProject();
    const result = opResult(project);
    const labels = canvasLabels(result, project, parts).filter((l) => l.tone === "net");
    expect(labels).toHaveLength(2);
    const w1 = labels.find((l) => l.point[0] === 60)!;
    expect(w1.point).toEqual([60, 94]);
    expect(w1.text).toMatch(/ V$/);
  });

  it("places a label beside the first pin when a net has no wires", () => {
    const project = dividerProject();
    project.wires = project.wires.filter((w) => w.uid !== "w2");
    project.components[2].x = 160;
    project.wires[1] = { uid: "w3", points: [[220, 100], [220, 200], [20, 200]] };
    const result = opResult(project);
    const labels = canvasLabels(result, project, parts).filter((l) => l.tone === "net");
    expect(labels.some((l) => l.point[0] === 166 && l.point[1] === 94)).toBe(true);
  });

  it("adds meter readings beside meters", () => {
    const project = dividerProject();
    project.components.push({ uid: "c6", part: "indicators.ammeter", ref: "AM1", x: 400, y: 0, rot: 0, mirror: false, params: {} });
    project.wires.push({ uid: "w9", points: [[420, 0], [420, -20]] });
    const result: UiResult = {
      ...opResult(dividerProject()),
      signals: [{ id: "v.xam1.vsense#branch", kind: "current", values: [0.005] }],
    };
    const meters = canvasLabels(result, project, parts).filter((l) => l.tone === "meter");
    expect(meters).toEqual([{ key: "meter:c6", point: [448, 0], text: "AM1 5.00 mA", tone: "meter" }]);
  });
});

describe("simFeedback", () => {
  const netlist: SimOutcome = {
    status: "netlist",
    errors: [
      { code: "no_ground", message: "The circuit has no ground. Add a Ground part.", componentUid: null },
      { code: "unconnected_pin", message: "R3 pin 1 is not connected", componentUid: "c5", pin: "1" },
      { code: "unconnected_pin", message: "R3 pin 2 is not connected", componentUid: "c5", pin: "2" },
    ],
  };

  it("routes netlist errors to parts, pins and the bar", () => {
    const f = simFeedback({ ...idleSim(), status: "failed", outcome: netlist }, dividerProject());
    expect(f.partMessages.get("c5")).toEqual(["R3 pin 1 is not connected", "R3 pin 2 is not connected"]);
    expect(f.pinErrors).toEqual([{ uid: "c5", pin: "1" }, { uid: "c5", pin: "2" }]);
    expect(f.bar).toEqual({ message: "The circuit has no ground. Add a Ground part.", log: null });
    expect(f.problemUids).toEqual(["c5"]);
    expect(f.showLabels).toBe(false);
  });

  it("maps engine failures and timeouts to the bar", () => {
    const project = dividerProject();
    const engine = simFeedback({ ...idleSim(), status: "failed", outcome: { status: "engine", message: "m", log: ["timestep too small near rr2"] } }, project);
    expect(engine.bar).toEqual({ message: "The simulation didn't converge. Try a smaller max step.", log: ["timestep too small near rr2"] });
    expect(engine.problemUids).toEqual(["c3"]);
    const timeout = simFeedback({ ...idleSim(), status: "failed", outcome: { status: "timeout", seconds: 30 } }, project);
    expect(timeout.bar?.message).toBe("Stopped after 30 s. Try a shorter stop time or a larger max step.");
  });

  it("surfaces outcome.message when the log has no known pattern (or is empty)", () => {
    const project = dividerProject();
    const engine = simFeedback(
      { ...idleSim(), status: "failed", outcome: { status: "engine", message: "could not load ngspice from X", log: [] } },
      project,
    );
    expect(engine.bar?.message).toContain("could not load ngspice from X");
    expect(engine.bar?.log).toContain("could not load ngspice from X");
  });

  it("shows nothing when stale and labels only for fresh op results", () => {
    expect(simFeedback({ ...idleSim(), status: "failed", outcome: netlist, stale: true }, dividerProject()).bar).toBeNull();
    const ok: SimOutcome = { status: "ok", elapsedMs: 1, result: opResult() };
    expect(simFeedback({ ...idleSim(), status: "done", outcome: ok }, dividerProject()).showLabels).toBe(true);
    expect(simFeedback({ ...idleSim(), status: "done", outcome: ok, stale: true }, dividerProject()).showLabels).toBe(false);
  });

  it("returns a fresh partMessages map on every call", () => {
    const project = dividerProject();
    const a = simFeedback({ ...idleSim(), status: "stopped", outcome: { status: "stopped" } }, project);
    const b = simFeedback({ ...idleSim(), status: "stopped", outcome: { status: "stopped" } }, project);
    expect(a.partMessages).not.toBe(b.partMessages);
    expect(a.pinErrors).not.toBe(b.pinErrors);
    expect(a.problemUids).not.toBe(b.problemUids);
  });
});
