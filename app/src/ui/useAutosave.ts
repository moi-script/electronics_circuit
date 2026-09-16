"use client";

import { useEffect } from "react";
import { errorMessage, type Backend } from "@/backend/backend";
import { editorStore, type EditorStore } from "@/model/store";
import type { Project } from "@/model/types";

export const AUTOSAVE_MS = 30_000;

/** Returns a tick that writes the recovery file when the project is dirty and changed. */
export function createAutosave(store: EditorStore, backend: Backend) {
  let lastWritten: Project | null = null;
  return async (): Promise<boolean> => {
    const { dirty, project } = store.getState();
    if (!dirty || project === lastWritten) return false;
    await backend.writeRecovery(project);
    lastWritten = project;
    return true;
  };
}

export function useAutosave(backend: Backend | null, notify: (message: string) => void) {
  useEffect(() => {
    if (!backend) return;
    const tick = createAutosave(editorStore, backend);
    const id = window.setInterval(() => {
      tick().catch((e) => notify(`Autosave failed: ${errorMessage(e)}`));
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [backend, notify]);
}
