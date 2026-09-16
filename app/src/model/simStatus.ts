import type { SimSlice } from "./store";

export function simStatusText(sim: SimSlice, now: number): string {
  if (sim.status === "running") {
    const seconds = Math.max(0, now - (sim.startedAt ?? now)) / 1000;
    // Truncate rather than round so a run just past N.x seconds doesn't read as N.(x+1).
    return `Running… ${(Math.floor(seconds * 10) / 10).toFixed(1)} s`;
  }
  const outcome = sim.outcome;
  if (!outcome) return "";
  switch (outcome.status) {
    case "ok": return sim.stale ? "Values outdated — run again" : `Done in ${(outcome.elapsedMs / 1000).toFixed(2)} s`;
    case "stopped": return "Stopped";
    case "timeout": return `Stopped after ${outcome.seconds} s`;
    case "busy": return "A simulation is already running.";
    case "engine": return sim.stale ? "" : "Simulation failed";
    case "netlist":
      return sim.stale ? "" : `${outcome.errors.length} problem${outcome.errors.length === 1 ? "" : "s"}`;
  }
}
