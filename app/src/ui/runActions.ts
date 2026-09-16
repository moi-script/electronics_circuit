import { errorMessage, type Backend } from "@/backend/backend";
import { analysisProblem } from "@/model/analysis";
import type { SimOutcome } from "@/model/simTypes";
import type { EditorStore } from "@/model/store";

export interface RunActions {
  run(): Promise<void>;
  stop(): Promise<void>;
  toggle(): void;
}

export function createRunActions(store: EditorStore, backend: Backend): RunActions {
  const run = async () => {
    const s = store.getState();
    if (s.sim.status === "running") return;
    if (analysisProblem(s.project.analysis, s.project, s.library) !== null) return;
    s.startRun();
    let outcome: SimOutcome;
    try {
      outcome = await backend.simulate(s.project);
    } catch (e) {
      outcome = { status: "engine", message: errorMessage(e), log: [] };
    }
    store.getState().finishRun(outcome);
  };
  const stop = async () => {
    if (store.getState().sim.status === "running") await backend.stopSimulation();
  };
  return {
    run,
    stop,
    toggle: () => { void (store.getState().sim.status === "running" ? stop() : run()); },
  };
}
