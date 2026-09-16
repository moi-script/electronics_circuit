import { beforeEach, describe, expect, it } from "vitest";
import library from "@/backend/mock-library.json";
import { createEditorStore, HISTORY_LIMIT, idleSim, type EditorStore } from "./store";
import { emptyProject, type LibraryData } from "./types";

let store: EditorStore;
const s = () => store.getState();
const comp = (uid: string) => s().project.components.find((c) => c.uid === uid)!;

beforeEach(() => {
  store = createEditorStore({ library: library as unknown as LibraryData });
});

describe("editor store", () => {
  it("places parts with snapped positions, numbered references and selection", () => {
    s().setTool({ kind: "place", partId: "basic.resistor" });
    const a = s().placePart("basic.resistor", [103, 47])!;
    const b = s().placePart("basic.resistor", [200, 0])!;
    const g = s().placePart("sources.ground", [0, 0])!;
    expect(comp(a)).toMatchObject({ ref: "R1", x: 100, y: 50, rot: 0, mirror: false, params: {} });
    expect(comp(b).ref).toBe("R2");
    expect(comp(g).ref).toBe("GND1");
    expect(s().selection).toEqual({ kind: "component", uid: g });
    expect(s().tool).toEqual({ kind: "select" });
    expect(s().dirty).toBe(true);
  });

  it("ignores unknown parts", () => {
    expect(s().placePart("basic.flux_capacitor", [0, 0])).toBeNull();
    expect(s().project.components).toHaveLength(0);
    expect(s().past).toHaveLength(0);
  });

  it("rotates in 90 degree steps and toggles mirror on the selection", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    for (const expected of [90, 180, 270, 0]) {
      s().rotateSelected();
      expect(comp(uid).rot).toBe(expected);
    }
    s().mirrorSelected();
    expect(comp(uid).mirror).toBe(true);
  });

  it("records a drag as one undo step", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().beginChange();
    s().moveComponent(uid, [14, 0]);
    s().moveComponent(uid, [31, 22]);
    expect(comp(uid)).toMatchObject({ x: 30, y: 20 });
    s().undo();
    expect(comp(uid)).toMatchObject({ x: 0, y: 0 });
    s().redo();
    expect(comp(uid)).toMatchObject({ x: 30, y: 20 });
  });

  it("clears redo history when a new change is made", () => {
    s().placePart("basic.resistor", [0, 0]);
    s().undo();
    expect(s().future).toHaveLength(1);
    s().placePart("basic.capacitor", [0, 0]);
    expect(s().future).toHaveLength(0);
  });

  it("caps undo history", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().select({ kind: "component", uid });
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s().mirrorSelected();
    expect(s().past).toHaveLength(HISTORY_LIMIT);
  });

  it("deletes the selected component or wire", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    const wire = s().addWire([[0, 10], [100, 10]])!;
    s().select({ kind: "component", uid });
    s().deleteSelected();
    expect(s().project.components).toHaveLength(0);
    s().select({ kind: "wire", uid: wire });
    s().deleteSelected();
    expect(s().project.wires).toHaveLength(0);
    expect(s().selection).toBeNull();
  });

  it("edits parameters and references", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().setParam(uid, "resistance", "4.7k");
    s().setReference(uid, "RLOAD");
    expect(comp(uid)).toMatchObject({ ref: "RLOAD", params: { resistance: "4.7k" } });
  });

  it("adds simplified wires and rejects degenerate ones", () => {
    expect(s().addWire([[0, 0], [0, 0]])).toBeNull();
    const w1 = s().addWire([[0, 0], [10, 0], [20, 0], [20, 30]]);
    const w2 = s().addWire([[0, 0], [0, 50]]);
    expect([w1, w2]).toEqual(["w1", "w2"]);
    expect(s().project.wires[0].points).toEqual([[0, 0], [20, 0], [20, 30]]);
  });

  it("copies and pastes with a new reference and offset", () => {
    const uid = s().placePart("basic.resistor", [100, 100])!;
    s().setParam(uid, "resistance", "10k");
    s().copySelected();
    const pasted = s().paste()!;
    expect(comp(pasted)).toMatchObject({ ref: "R2", x: 120, y: 120, params: { resistance: "10k" } });
    const again = s().paste()!;
    expect(comp(again)).toMatchObject({ ref: "R3", x: 140, y: 140 });
  });

  it("loads and resets projects without history", () => {
    s().placePart("basic.resistor", [0, 0]);
    const loaded = emptyProject();
    s().loadProject(loaded, "C:/demo.msym");
    expect(s()).toMatchObject({ filePath: "C:/demo.msym", dirty: false, selection: null });
    expect(s().past).toHaveLength(0);
    s().placePart("basic.resistor", [0, 0]);
    s().markSaved("C:/other.msym");
    expect(s()).toMatchObject({ filePath: "C:/other.msym", dirty: false });
    s().newProject();
    expect(s().project.components).toHaveLength(0);
    expect(s().filePath).toBeNull();
  });

  it("does not dirty the project on no-op edits to a missing or wrong-kind selection", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    const wire = s().addWire([[0, 10], [100, 10]])!;
    s().markSaved("C:/demo.msym");
    const { project, past, future, dirty } = s();
    expect(dirty).toBe(false);

    s().setParam("nope", "resistance", "4.7k");
    expect(s().project).toBe(project);
    expect(s().past).toBe(past);
    expect(s().future).toBe(future);
    expect(s().dirty).toBe(false);

    s().setReference("nope", "RLOAD");
    expect(s().project).toBe(project);
    expect(s().past).toBe(past);
    expect(s().dirty).toBe(false);

    s().select({ kind: "wire", uid: wire });
    s().rotateSelected();
    expect(comp(uid).rot).toBe(0);
    expect(s().project).toBe(project);
    expect(s().past).toBe(past);
    expect(s().dirty).toBe(false);

    s().mirrorSelected();
    expect(comp(uid).mirror).toBe(false);
    expect(s().project).toBe(project);
    expect(s().past).toBe(past);
    expect(s().dirty).toBe(false);
  });

  it("toggles panels and updates the view without dirtying", () => {
    expect(s().panels).toEqual({ properties: false, plot: false, focus: false });
    s().togglePanel("plot");
    expect(s().panels.plot).toBe(true);
    s().setView(2, [10, 20]);
    expect(s().project.view).toEqual({ zoom: 2, pan: [10, 20] });
    expect(s().dirty).toBe(false);
  });

  it("remembers the component browser position without dirtying", () => {
    expect(s().browser).toEqual({ category: null, partId: null });
    s().rememberBrowser({ category: "Diodes", partId: "diodes.led" });
    expect(s().browser).toEqual({ category: "Diodes", partId: "diodes.led" });
    s().newProject();
    expect(s().browser).toEqual({ category: "Diodes", partId: "diodes.led" });
    expect(s().dirty).toBe(false);
  });

  it("runs through the simulation states without touching history or dirty", () => {
    const past = s().past;
    s().startRun();
    expect(s().sim.status).toBe("running");
    expect(s().sim.startedAt).not.toBeNull();
    s().finishRun({ status: "stopped" });
    expect(s().sim.status).toBe("stopped");
    s().finishRun({ status: "netlist", errors: [] });
    expect(s().sim.status).toBe("failed");
    s().finishRun({ status: "busy" });
    expect(s().sim.status).toBe("failed");
    expect(s().past).toBe(past);
    expect(s().dirty).toBe(false);
  });

  it("opens the plot dock after a successful non-op run", () => {
    const ok = (analysis: "op" | "tran") => ({
      status: "ok" as const,
      elapsedMs: 5,
      result: { analysis, x: null, signals: [], nets: { pinNet: [], netPins: {}, wireNet: {} } },
    });
    s().startRun();
    s().finishRun(ok("op"));
    expect(s().panels.plot).toBe(false);
    expect(s().sim.status).toBe("done");
    s().startRun();
    s().finishRun(ok("tran"));
    expect(s().panels.plot).toBe(true);
  });

  it("marks results stale on circuit edits and undo, not on view, selection or probes", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().startRun();
    s().finishRun({ status: "stopped" });
    expect(s().sim.stale).toBe(false);
    s().setView(2, [5, 5]);
    s().select(null);
    s().toggleProbe(`pin:${uid}:1`);
    expect(s().sim.stale).toBe(false);
    s().setParam(uid, "resistance", "2k");
    expect(s().sim.stale).toBe(true);
    s().startRun();
    s().finishRun({ status: "stopped" });
    expect(s().sim.stale).toBe(false);
    s().undo();
    expect(s().sim.stale).toBe(true);
  });

  it("marks a result stale when the circuit changed during the run", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().startRun();
    s().setParam(uid, "resistance", "2k");
    s().finishRun({ status: "stopped" });
    expect(s().sim.stale).toBe(true);
  });

  it("sets the analysis as an undoable edit and ignores no-ops", () => {
    s().setAnalysis({ type: "op" });
    expect(s().project.analysis).toEqual({ type: "op" });
    expect(s().dirty).toBe(true);
    const past = s().past.length;
    s().setAnalysis({ type: "op" });
    expect(s().past.length).toBe(past);
    s().undo();
    expect(s().project.analysis.type).toBe("tran");
  });

  it("toggles probes as undoable edits", () => {
    s().toggleProbe("pin:c1:1");
    expect(s().project.probes).toEqual(["pin:c1:1"]);
    s().toggleProbe("pin:c1:1");
    expect(s().project.probes).toEqual([]);
    s().undo();
    expect(s().project.probes).toEqual(["pin:c1:1"]);
  });

  it("resets the simulation when a project is created or loaded", () => {
    s().startRun();
    s().newProject();
    expect(s().sim).toEqual(idleSim());
  });
});
