import { describe, expect, it } from "vitest";
import { testLibrary } from "@/test/resetEditor";
import { emptyProject, type Project } from "./types";
import { ANALYSIS_DEFAULTS, analysisProblem, analysisSummary, dcSources } from "./analysis";

const withParts = (...parts: [string, string][]): Project => {
  const project = emptyProject();
  project.components = parts.map(([part, ref], i) => ({ uid: `c${i + 1}`, part, ref, x: 0, y: 0, rot: 0, mirror: false, params: {} }));
  return project;
};

describe("analysisSummary", () => {
  it("describes each analysis in plain words", () => {
    expect(analysisSummary({ type: "op" })).toBe("Operating point");
    expect(analysisSummary(ANALYSIS_DEFAULTS.tran)).toBe("Transient · 10 ms");
    expect(analysisSummary(ANALYSIS_DEFAULTS.ac)).toBe("AC · 10 Hz–100 kHz");
    expect(analysisSummary({ ...ANALYSIS_DEFAULTS.dc, source: "V1" })).toBe("DC sweep · V1 0→5 V");
    expect(analysisSummary({ type: "tran", stop: "oops", step: "1u" })).toBe("Transient · oops");
  });
});

describe("dcSources", () => {
  it("lists DC voltage and current source references in order", () => {
    const project = withParts(["basic.resistor", "R1"], ["sources.dc_current", "I1"], ["sources.dc_voltage", "V1"], ["sources.ac_voltage", "V2"]);
    expect(dcSources(project)).toEqual(["I1", "V1"]);
  });
});

describe("analysisProblem", () => {
  const project = withParts(["sources.dc_voltage", "V1"]);
  it("accepts the defaults", () => {
    expect(analysisProblem(ANALYSIS_DEFAULTS.tran, project, testLibrary)).toBeNull();
    expect(analysisProblem(ANALYSIS_DEFAULTS.ac, project, testLibrary)).toBeNull();
    expect(analysisProblem({ type: "op" }, project, testLibrary)).toBeNull();
    expect(analysisProblem({ ...ANALYSIS_DEFAULTS.dc, source: "V1" }, project, testLibrary)).toBeNull();
  });

  it("explains invalid settings", () => {
    expect(analysisProblem({ type: "tran", stop: "abc", step: "1u" }, project, testLibrary)).toMatch(/^Stop time: /);
    expect(analysisProblem({ type: "tran", stop: "1m", step: "2m" }, project, testLibrary)).toBe("Max step must not exceed the stop time");
    expect(analysisProblem({ type: "tran", stop: "1m", step: "0" }, project, testLibrary)).toBe("Max step must be greater than 0");
    expect(analysisProblem({ type: "ac", start: "1k", stop: "10", pointsPerDecade: 10 }, project, testLibrary)).toBe("Start frequency must be below the stop frequency");
    expect(analysisProblem({ type: "ac", start: "10", stop: "1k", pointsPerDecade: 0 }, project, testLibrary)).toBe("Points per decade must be a whole number from 1 to 1000");
    expect(analysisProblem({ ...ANALYSIS_DEFAULTS.dc, source: "V9" }, project, testLibrary)).toBe("Pick a source.");
    expect(analysisProblem({ ...ANALYSIS_DEFAULTS.dc, source: "" }, emptyProject(), testLibrary)).toBe("Add a DC voltage or current source to sweep.");
    expect(analysisProblem({ type: "dc", source: "V1", start: "1", stop: "1", step: "0.1" }, project, testLibrary)).toBe("Start and stop must differ");
  });

  it("waits for the library", () => {
    expect(analysisProblem({ type: "op" }, project, null)).toBe("Loading parts…");
  });
});
