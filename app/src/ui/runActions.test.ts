import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "@/backend/backend";
import type { SimOutcome } from "@/model/simTypes";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import { createRunActions } from "./runActions";

const state = () => editorStore.getState();

function fakeBackend(result: Promise<SimOutcome> | (() => Promise<SimOutcome>)) {
  return {
    simulate: vi.fn(typeof result === "function" ? result : () => result),
    stopSimulation: vi.fn(async () => {}),
  } as unknown as Backend & { simulate: ReturnType<typeof vi.fn>; stopSimulation: ReturnType<typeof vi.fn> };
}

beforeEach(() => resetEditor());

describe("createRunActions", () => {
  it("runs the project and stores the outcome", async () => {
    const backend = fakeBackend(Promise.resolve({ status: "stopped" }));
    const actions = createRunActions(editorStore, backend);
    const done = actions.run();
    expect(state().sim.status).toBe("running");
    await done;
    expect(backend.simulate).toHaveBeenCalledWith(state().project);
    expect(state().sim.status).toBe("stopped");
  });

  it("turns a rejected call into an engine failure", async () => {
    const actions = createRunActions(editorStore, fakeBackend(Promise.reject("boom")));
    await actions.run();
    expect(state().sim.outcome).toEqual({ status: "engine", message: "boom", log: [] });
  });

  it("does not run when the analysis cannot run or a run is in flight", async () => {
    const backend = fakeBackend(Promise.resolve({ status: "stopped" }));
    const actions = createRunActions(editorStore, backend);
    state().setAnalysis({ type: "tran", stop: "abc", step: "1u" });
    await actions.run();
    expect(backend.simulate).not.toHaveBeenCalled();
    state().setAnalysis({ type: "op" });
    state().startRun();
    await actions.run();
    expect(backend.simulate).not.toHaveBeenCalled();
  });

  it("stops only while running, and toggle picks the right action", async () => {
    let finish: (o: SimOutcome) => void = () => {};
    const backend = fakeBackend(() => new Promise<SimOutcome>((resolve) => { finish = resolve; }));
    const actions = createRunActions(editorStore, backend);
    await actions.stop();
    expect(backend.stopSimulation).not.toHaveBeenCalled();
    actions.toggle();
    expect(state().sim.status).toBe("running");
    actions.toggle();
    expect(backend.stopSimulation).toHaveBeenCalledTimes(1);
    finish({ status: "stopped" });
    await vi.waitFor(() => expect(state().sim.status).toBe("stopped"));
  });
});
