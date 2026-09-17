import { describe, expect, it } from "vitest";
import { idleSim, type SimSlice } from "./store";
import { simStatusText } from "./simStatus";

const sim = (patch: Partial<SimSlice>): SimSlice => ({ ...idleSim(), ...patch });
const ok = { status: "ok" as const, elapsedMs: 412, result: { analysis: "tran" as const, x: null, signals: [], nets: { pinNet: [], netPins: {}, wireNet: {} } } };

describe("simStatusText", () => {
  it("describes each state", () => {
    expect(simStatusText(idleSim(), 0)).toBe("");
    expect(simStatusText(sim({ status: "running", startedAt: 1000 }), 4250)).toBe("Running… 3.2 s");
    expect(simStatusText(sim({ status: "done", outcome: ok }), 0)).toBe("Done in 0.41 s");
    expect(simStatusText(sim({ status: "done", outcome: ok, stale: true }), 0)).toBe("Values outdated — run again");
    expect(simStatusText(sim({ status: "stopped", outcome: { status: "stopped" } }), 0)).toBe("Stopped");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "timeout", seconds: 30 } }), 0)).toBe("Stopped after 30 s");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "netlist", errors: [{ code: "no_ground", message: "x", componentUid: null }] } }), 0)).toBe("1 problem");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "netlist", errors: [] } }), 0)).toBe("0 problems");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "engine", message: "m", log: [] } }), 0)).toBe("Simulation failed");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "busy" } }), 0)).toBe("A simulation is already running.");
    expect(simStatusText(sim({ status: "failed", outcome: { status: "netlist", errors: [] }, stale: true }), 0)).toBe("");
  });
});
