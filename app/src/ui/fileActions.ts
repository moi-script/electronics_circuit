import { errorMessage, type Backend } from "@/backend/backend";
import type { EditorStore } from "@/model/store";
import { APP_VERSION } from "@/model/types";
import { partMap } from "@/model/wiring";

export interface FileActions {
  newFile(): Promise<void>;
  open(): Promise<void>;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
}

interface Deps {
  store: EditorStore;
  backend: Backend;
  confirmDiscard(): boolean;
  notify(message: string): void;
}

const fileName = (path: string | null) => path?.split(/[\\/]/).pop() ?? "untitled.msym";

export function createFileActions({ store, backend, confirmDiscard, notify }: Deps): FileActions {
  const canDiscard = () => !store.getState().dirty || confirmDiscard();

  const writeTo = async (path: string): Promise<boolean> => {
    const { project } = store.getState();
    try {
      await backend.saveProject(path, { ...project, format: 1, app: APP_VERSION });
      store.getState().markSaved(path);
      await backend.clearRecovery();
      return true;
    } catch (e) {
      notify(`Could not save: ${errorMessage(e)}`);
      return false;
    }
  };

  const saveAs = async () => {
    const path = await backend.pickSavePath(fileName(store.getState().filePath));
    return path ? writeTo(path) : false;
  };

  return {
    newFile: async () => {
      if (!canDiscard()) return;
      if (store.getState().sim.status === "running") await backend.stopSimulation();
      store.getState().newProject();
      await backend.clearRecovery();
    },

    open: async () => {
      if (!canDiscard()) return;
      const path = await backend.pickOpenPath();
      if (!path) return;
      if (store.getState().sim.status === "running") await backend.stopSimulation();
      try {
        const project = await backend.openProject(path);
        store.getState().loadProject(project, path);
        await backend.clearRecovery();
        const parts = partMap(store.getState().library);
        const missing = project.components.filter((c) => !parts.has(c.part)).length;
        if (missing > 0) notify(`${missing} part(s) in this project are not in the installed library`);
      } catch (e) {
        notify(`Could not open: ${errorMessage(e)}`);
      }
    },

    save: async () => {
      const path = store.getState().filePath;
      return path ? writeTo(path) : saveAs();
    },

    saveAs,
  };
}
