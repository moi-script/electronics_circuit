import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { simplifyPath, snapPoint } from "./geometry";
import { nextReference, nextUid } from "./refs";
import type { SimOutcome } from "./simTypes";
import { emptyProject, type Analysis, type Category, type ComponentInstance, type LibraryData, type Point, type Project, type Rotation } from "./types";
import { partMap } from "./wiring";

export const HISTORY_LIMIT = 100;

export type Tool = { kind: "select" } | { kind: "place"; partId: string } | { kind: "wire"; points: Point[] };
export type Selection = { kind: "component" | "wire"; uid: string } | null;
export type PanelName = "properties" | "plot" | "focus";

/** Last group and part shown in the component browser (session only, never saved). */
export interface BrowserMemory {
  category: Category | null;
  partId: string | null;
}

export type SimStatus = "idle" | "running" | "done" | "failed" | "stopped";

export interface SimSlice {
  status: SimStatus;
  outcome: SimOutcome | null;
  /** The circuit changed since the outcome was produced. */
  stale: boolean;
  startedAt: number | null;
  /** Project the running (or last) run was started with. */
  runProject: Project | null;
}

export const idleSim = (): SimSlice => ({ status: "idle", outcome: null, stale: false, startedAt: null, runProject: null });

export interface EditorState {
  library: LibraryData | null;
  project: Project;
  filePath: string | null;
  dirty: boolean;
  selection: Selection;
  tool: Tool;
  past: Project[];
  future: Project[];
  clipboard: ComponentInstance | null;
  panels: Record<PanelName, boolean>;
  browser: BrowserMemory;
  sim: SimSlice;

  setLibrary(library: LibraryData): void;
  newProject(): void;
  loadProject(project: Project, filePath: string | null): void;
  markSaved(filePath: string): void;
  setTool(tool: Tool): void;
  select(selection: Selection): void;
  placePart(partId: string, at: Point): string | null;
  beginChange(): void;
  moveComponent(uid: string, at: Point): void;
  rotateSelected(): void;
  mirrorSelected(): void;
  deleteSelected(): void;
  setParam(uid: string, key: string, value: string): void;
  setReference(uid: string, ref: string): void;
  addWire(points: Point[]): string | null;
  copySelected(): void;
  paste(): string | null;
  undo(): void;
  redo(): void;
  togglePanel(name: PanelName): void;
  rememberBrowser(memory: BrowserMemory): void;
  setView(zoom: number, pan: Point): void;
  startRun(): void;
  finishRun(outcome: SimOutcome): void;
  setAnalysis(analysis: Analysis): void;
  toggleProbe(ref: string): void;
}

const freshSession = () => ({
  filePath: null as string | null,
  dirty: false,
  selection: null as Selection,
  tool: { kind: "select" } as Tool,
  past: [] as Project[],
  future: [] as Project[],
  sim: idleSim(),
});

export function createEditorStore(initial: { library?: LibraryData | null; project?: Project } = {}) {
  return createStore<EditorState>()((set, get) => {
    const commit = (mutate: (draft: Project) => void, options: { stale?: boolean } = {}) => {
      const { project, past, sim } = get();
      const draft = structuredClone(project);
      mutate(draft);
      set({
        project: draft,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
        sim: options.stale === false ? sim : { ...sim, stale: true },
      });
    };
    const staleSim = () => ({ ...get().sim, stale: true });
    const withSelectedComponent = (mutate: (c: ComponentInstance) => void) => {
      const selection = get().selection;
      if (selection?.kind !== "component") return;
      if (!get().project.components.some((c) => c.uid === selection.uid)) return;
      commit((d) => {
        const c = d.components.find((c) => c.uid === selection.uid);
        if (c) mutate(c);
      });
    };
    const withComponent = (uid: string, mutate: (c: ComponentInstance) => void) => {
      if (!get().project.components.some((c) => c.uid === uid)) return;
      commit((d) => {
        const c = d.components.find((c) => c.uid === uid);
        if (c) mutate(c);
      });
    };
    const componentUids = () => get().project.components.map((c) => c.uid);
    const references = () => get().project.components.map((c) => c.ref);

    return {
      library: initial.library ?? null,
      project: initial.project ?? emptyProject(),
      ...freshSession(),
      clipboard: null,
      panels: { properties: false, plot: false, focus: false },
      browser: { category: null, partId: null },

      setLibrary: (library) => set({ library }),
      newProject: () => set({ project: emptyProject(), ...freshSession() }),
      loadProject: (project, filePath) => set({ project, ...freshSession(), filePath }),
      markSaved: (filePath) => set({ filePath, dirty: false }),
      setTool: (tool) => set({ tool }),
      select: (selection) => set({ selection }),

      placePart: (partId, at) => {
        const part = partMap(get().library).get(partId);
        if (!part) return null;
        const uid = nextUid("c", componentUids());
        const ref = nextReference(part.refPrefix, references());
        const [x, y] = snapPoint(at);
        commit((d) => {
          d.components.push({ uid, part: partId, ref, x, y, rot: 0, mirror: false, params: {} });
        });
        set({ selection: { kind: "component", uid }, tool: { kind: "select" } });
        return uid;
      },

      beginChange: () => {
        const { project, past } = get();
        set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [], dirty: true, sim: staleSim() });
      },

      moveComponent: (uid, at) => {
        const [x, y] = snapPoint(at);
        set((state) => ({
          project: {
            ...state.project,
            components: state.project.components.map((c) => (c.uid === uid ? { ...c, x, y } : c)),
          },
          dirty: true,
          sim: { ...state.sim, stale: true },
        }));
      },

      rotateSelected: () => withSelectedComponent((c) => { c.rot = ((c.rot + 90) % 360) as Rotation; }),
      mirrorSelected: () => withSelectedComponent((c) => { c.mirror = !c.mirror; }),

      deleteSelected: () => {
        const selection = get().selection;
        if (!selection) return;
        commit((d) => {
          if (selection.kind === "component") d.components = d.components.filter((c) => c.uid !== selection.uid);
          else d.wires = d.wires.filter((w) => w.uid !== selection.uid);
        });
        set({ selection: null });
      },

      setParam: (uid, key, value) => withComponent(uid, (c) => { c.params[key] = value; }),
      setReference: (uid, ref) => withComponent(uid, (c) => { c.ref = ref; }),

      addWire: (points) => {
        const path = simplifyPath(points);
        if (path.length < 2) return null;
        const uid = nextUid("w", get().project.wires.map((w) => w.uid));
        commit((d) => { d.wires.push({ uid, points: path }); });
        return uid;
      },

      copySelected: () => {
        const selection = get().selection;
        if (selection?.kind !== "component") return;
        const c = get().project.components.find((c) => c.uid === selection.uid);
        if (c) set({ clipboard: structuredClone(c) });
      },

      paste: () => {
        const clip = get().clipboard;
        const part = clip && partMap(get().library).get(clip.part);
        if (!clip || !part) return null;
        const uid = nextUid("c", componentUids());
        const ref = nextReference(part.refPrefix, references());
        const placed = { ...structuredClone(clip), uid, ref, x: clip.x + 20, y: clip.y + 20 };
        commit((d) => { d.components.push(placed); });
        set({ clipboard: placed, selection: { kind: "component", uid } });
        return uid;
      },

      undo: () => {
        const { past, project, future } = get();
        if (past.length === 0) return;
        set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], selection: null, dirty: true, sim: staleSim() });
      },

      redo: () => {
        const { past, project, future } = get();
        if (future.length === 0) return;
        set({ project: future[0], past: [...past, project], future: future.slice(1), selection: null, dirty: true, sim: staleSim() });
      },

      togglePanel: (name) => set((state) => ({ panels: { ...state.panels, [name]: !state.panels[name] } })),
      rememberBrowser: (browser) => set({ browser }),
      setView: (zoom, pan) => set((state) => ({ project: { ...state.project, view: { zoom, pan } } })),

      startRun: () => set({ sim: { status: "running", outcome: get().sim.outcome, stale: get().sim.stale, startedAt: Date.now(), runProject: get().project } }),

      finishRun: (outcome) => {
        const { sim, project, panels } = get();
        const status: SimStatus = outcome.status === "ok" ? "done" : outcome.status === "stopped" ? "stopped" : "failed";
        const openPlot = outcome.status === "ok" && outcome.result.analysis !== "op";
        set({
          sim: { status, outcome, stale: sim.runProject !== null && sim.runProject !== project, startedAt: null, runProject: sim.runProject },
          panels: openPlot ? { ...panels, plot: true } : panels,
        });
      },

      setAnalysis: (analysis) => {
        if (JSON.stringify(get().project.analysis) === JSON.stringify(analysis)) return;
        commit((d) => { d.analysis = analysis; });
      },

      toggleProbe: (ref) => commit((d) => {
        d.probes = d.probes.includes(ref) ? d.probes.filter((p) => p !== ref) : [...d.probes, ref];
      }, { stale: false }),
    };
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;

/** The app-wide store. Tests create their own with `createEditorStore`. */
export const editorStore = createEditorStore();

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
