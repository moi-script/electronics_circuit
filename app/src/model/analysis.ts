import { formatValue } from "./format";
import { parseSi } from "./si";
import type { Analysis, LibraryData, Project } from "./types";

export const ANALYSIS_DEFAULTS = {
  op: { type: "op" },
  tran: { type: "tran", stop: "10m", step: "10u" },
  ac: { type: "ac", start: "10", stop: "100k", pointsPerDecade: 10 },
  dc: { type: "dc", source: "", start: "0", stop: "5", step: "0.1" },
} as const satisfies Record<Analysis["type"], Analysis>;

const DC_SOURCE_PARTS = ["sources.dc_voltage", "sources.dc_current"];

export function dcSources(project: Project): string[] {
  return project.components.filter((c) => DC_SOURCE_PARTS.includes(c.part)).map((c) => c.ref);
}

export function dcSweepUnit(project: Project, source: string): "V" | "A" {
  return project.components.find((c) => c.ref === source)?.part === "sources.dc_current" ? "A" : "V";
}

const short = (text: string, unit: string) => {
  const parsed = parseSi(text);
  return parsed.ok ? formatValue(parsed.value, unit, { trim: true }) : text;
};

export function analysisSummary(analysis: Analysis): string {
  switch (analysis.type) {
    case "op": return "Operating point";
    case "tran": return `Transient · ${short(analysis.stop, "s")}`;
    case "ac": return `AC · ${short(analysis.start, "Hz")}–${short(analysis.stop, "Hz")}`;
    case "dc": {
      const unit = analysis.source.toUpperCase().startsWith("I") ? "A" : "V";
      return `DC sweep · ${analysis.source} ${short(analysis.start, "").trim()}→${short(analysis.stop, unit)}`;
    }
  }
}

function value(label: string, text: string): { ok: true; value: number } | { ok: false; problem: string } {
  const parsed = parseSi(text);
  return parsed.ok ? parsed : { ok: false, problem: `${label}: ${parsed.error}` };
}

/** Why the analysis can't run, or null when it can. */
export function analysisProblem(analysis: Analysis, project: Project, library: LibraryData | null): string | null {
  if (!library) return "Loading parts…";
  switch (analysis.type) {
    case "op":
      return null;
    case "tran": {
      const stop = value("Stop time", analysis.stop);
      if (!stop.ok) return stop.problem;
      const step = value("Max step", analysis.step);
      if (!step.ok) return step.problem;
      if (stop.value <= 0) return "Stop time must be greater than 0";
      if (step.value <= 0) return "Max step must be greater than 0";
      if (step.value > stop.value) return "Max step must not exceed the stop time";
      return null;
    }
    case "ac": {
      const start = value("Start frequency", analysis.start);
      if (!start.ok) return start.problem;
      const stop = value("Stop frequency", analysis.stop);
      if (!stop.ok) return stop.problem;
      if (start.value <= 0) return "Start frequency must be greater than 0";
      if (start.value >= stop.value) return "Start frequency must be below the stop frequency";
      if (!Number.isInteger(analysis.pointsPerDecade) || analysis.pointsPerDecade < 1 || analysis.pointsPerDecade > 1000) {
        return "Points per decade must be a whole number from 1 to 1000";
      }
      return null;
    }
    case "dc": {
      const sources = dcSources(project);
      if (sources.length === 0) return "Add a DC voltage or current source to sweep.";
      if (!sources.includes(analysis.source)) return "Pick a source.";
      const start = value("Start", analysis.start);
      if (!start.ok) return start.problem;
      const stop = value("Stop", analysis.stop);
      if (!stop.ok) return stop.problem;
      const step = value("Step", analysis.step);
      if (!step.ok) return step.problem;
      if (step.value <= 0) return "Step must be greater than 0";
      if (start.value === stop.value) return "Start and stop must differ";
      return null;
    }
  }
}
