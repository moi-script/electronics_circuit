import { describe, expect, it } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { testLibrary } from "@/test/resetEditor";
import { partMap } from "@/model/wiring";
import { mockNets, mockSimulate } from "./mockSimulation";

const parts = partMap(testLibrary);

describe("mockNets", () => {
  it("groups pins joined by wires and names the ground net 0", () => {
    const nets = mockNets(dividerProject(), parts);
    const netOf = (uid: string, pin: string) => nets.pinNet.find((p) => p.uid === uid && p.pin === pin)!.net;
    expect(netOf("c1", "p")).toBe(netOf("c2", "1"));
    expect(netOf("c2", "2")).toBe(netOf("c3", "1"));
    expect(netOf("c3", "2")).toBe("0");
    expect(netOf("c1", "n")).toBe("0");
    expect(netOf("c1", "p")).not.toBe(netOf("c2", "2"));
    expect(nets.wireNet.w2).toBe(netOf("c2", "2"));
    expect(nets.netPins["0"]).toHaveLength(3);
  });
});

describe("mockSimulate", () => {
  it("reports a missing ground", () => {
    const outcome = mockSimulate(dividerProject(false), testLibrary);
    expect(outcome.status).toBe("netlist");
    if (outcome.status !== "netlist") return;
    expect(outcome.errors.some((e) => e.code === "no_ground" && e.componentUid === null)).toBe(true);
  });

  it("reports unconnected pins with the pin id", () => {
    const project = dividerProject();
    project.components.push({ uid: "c5", part: "basic.resistor", ref: "R3", x: 400, y: 400, rot: 0, mirror: false, params: {} });
    const outcome = mockSimulate(project, testLibrary);
    expect(outcome.status).toBe("netlist");
    if (outcome.status !== "netlist") return;
    const errors = outcome.errors.filter((e) => e.code === "unconnected_pin");
    expect(errors.map((e) => [e.componentUid, e.pin])).toEqual([["c5", "1"], ["c5", "2"]]);
    expect(errors[0].message).toBe("R3 pin 1 is not connected");
  });

  it("returns one point per net for an operating point", () => {
    const project = dividerProject();
    project.analysis = { type: "op" };
    const outcome = mockSimulate(project, testLibrary);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.analysis).toBe("op");
    expect(outcome.result.x).toBeNull();
    const voltages = outcome.result.signals.filter((s) => s.kind === "voltage");
    expect(voltages).toHaveLength(2);
    expect(voltages.every((s) => s.values.length === 1)).toBe(true);
    expect(outcome.result.signals.some((s) => s.id === "v1#branch")).toBe(true);
  });

  it("returns 200-point curves for a transient", () => {
    const outcome = mockSimulate(dividerProject(), testLibrary);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.x?.values).toHaveLength(200);
    expect(outcome.result.x?.unit).toBe("s");
    expect(outcome.result.signals[0].values).toHaveLength(200);
  });

  it("returns log-frequency sweeps with phase for AC", () => {
    const project = dividerProject();
    project.analysis = { type: "ac", start: "10", stop: "100k", pointsPerDecade: 10 };
    const outcome = mockSimulate(project, testLibrary);
    if (outcome.status !== "ok") throw new Error(outcome.status);
    expect(outcome.result.x?.log).toBe(true);
    expect(outcome.result.signals.find((s) => s.kind === "voltage")?.phase).toHaveLength(50);
  });
});
