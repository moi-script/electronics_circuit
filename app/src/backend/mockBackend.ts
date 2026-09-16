import type { LibraryData, Project } from "@/model/types";
import type { Backend } from "./backend";
import libraryJson from "./mock-library.json";

/** In-memory backend for the plain browser and tests. Rejects with strings like Tauri. */
export function createMockBackend(): Backend & { files: Map<string, string> } {
  const files = new Map<string, string>();
  let recovery: string | null = null;
  let lastPath: string | null = null;
  return {
    kind: "mock",
    files,
    loadLibrary: async () => structuredClone(libraryJson) as unknown as LibraryData,
    pickOpenPath: async () => lastPath,
    pickSavePath: async (suggestedName) => suggestedName,
    openProject: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw `Cannot open ${path}: not found`;
      return JSON.parse(text) as Project;
    },
    saveProject: async (path, project) => {
      files.set(path, JSON.stringify(project));
      lastPath = path;
    },
    writeRecovery: async (project) => {
      recovery = JSON.stringify(project);
    },
    readRecovery: async () => (recovery === null ? null : (JSON.parse(recovery) as Project)),
    clearRecovery: async () => {
      recovery = null;
    },
  };
}

export const mockBackend = createMockBackend();
