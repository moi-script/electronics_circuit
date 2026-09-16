import { describe, expect, it } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { mockSimulate } from "@/backend/mockSimulation";
import { testLibrary } from "@/test/resetEditor";
import type { UiResult } from "./simTypes";
import { listSignals, netNames, probeRef, tickedKeys } from "./signals";
import type { Project } from "./types";
import { partMap } from "./wiring";

const parts = partMap(testLibrary);

function tran(project: Project): UiResult {
  const outcome = mockSimulate(project, testLibrary);
  if (outcome.status !== "ok") throw new Error(JSON.stringify(outcome));
  return outcome.result;
}

describe("netNames", () => {
  it("names nets by ground, probe part, or first pin", () => {
    const project = dividerProject();
    project.components.push({ uid: "c5", part: "indicators.probe", ref: "PR1", x: 170, y: 100, rot: 0, mirror: false, params: {} });
    project.wires.push({ uid: "w5", points: [[180, 130], [180, 100]] });
    const result = tran(project);
    const names = netNames(result, project, parts);
    const netOf = (uid: string, pin: string) => result.nets.pinNet.find((p) => p.uid === uid && p.pin === pin)!.net;
    expect(names.get("0")).toBe("GND");
    expect(names.get(netOf("c1", "p"))).toBe("V1:+");
    expect(names.get(netOf("c2", "2"))).toBe("PR1");
  });
});

describe("listSignals", () => {
  it("lists net voltages and source currents with readable labels", () => {
    const project = dividerProject();
    const signals = listSignals(tran(project), project, parts);
    expect(signals.map((s) => s.label)).toEqual(["V(R1:2)", "V(V1:+)", "I(V1)"]);
    expect(signals.every((s) => !s.auto)).toBe(true);
    expect(signals[0].probe).toBe(probeRef("c2", "2"));
    expect(signals[2]).toMatchObject({ unit: "A", probe: null });
  });

  it("auto-ticks probe nets, voltmeter differences and ammeter currents", () => {
    const project = dividerProject();
    project.components.push(
      { uid: "c5", part: "indicators.probe", ref: "PR1", x: 170, y: 100, rot: 0, mirror: false, params: {} },
      { uid: "c6", part: "indicators.voltmeter", ref: "VM1", x: 400, y: 0, rot: 0, mirror: false, params: {} },
      { uid: "c7", part: "indicators.ammeter", ref: "AM1", x: 600, y: 0, rot: 0, mirror: false, params: {} },
    );
    project.wires.push(
      { uid: "w5", points: [[180, 130], [180, 100]] },
      { uid: "w6", points: [[420, 0], [420, -40], [200, -40], [200, 100]] },
      { uid: "w7", points: [[420, 60], [420, 200], [260, 200]] },
      { uid: "w8", points: [[620, 0], [620, -60], [100, -60], [100, 100]] },
      { uid: "w9", points: [[620, 60], [620, 220], [20, 220], [20, 200]] },
    );
    const result = tran(project);
    const signals = listSignals(result, project, parts);
    const auto = signals.filter((s) => s.auto).map((s) => s.label);
    expect(auto).toEqual(["V(VM1)", "I(AM1)", "V(PR1)"]);
    const vm = signals.find((s) => s.label === "V(VM1)")!;
    const top = result.signals.find((s) => s.id === result.nets.pinNet.find((p) => p.uid === "c6" && p.pin === "p")!.net)!;
    expect(vm.values).toEqual(top.values);
  });
});

describe("tickedKeys", () => {
  it("combines auto signals, saved probes and hidden auto signals", () => {
    const project = dividerProject();
    const signals = listSignals(tran(project), project, parts);
    const ticked = tickedKeys(signals, [probeRef("c2", "2"), "pin:c99:1", "garbage"], new Set());
    expect(ticked).toEqual([signals[0].key]);
    const auto = [{ ...signals[1], auto: true }, signals[0]];
    expect(tickedKeys(auto, [], new Set([signals[1].key]))).toEqual([]);
  });
});
