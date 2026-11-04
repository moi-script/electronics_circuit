import { mockPart, mockPreview, type MockPack } from "./mockImport";
import { mockSimulate } from "./mockSimulation";
import type { LibraryData, Project } from "@/model/types";
import type { Backend } from "./backend";
import libraryJson from "./mock-library.json";

/** In-memory backend for the plain browser and tests. Rejects with strings like Tauri. */
export function createMockBackend(): Backend & { files: Map<string, string> } {
  const files = new Map<string, string>();
  let recovery: string | null = null;
  let lastPath: string | null = null;
  let library: LibraryData | null = null;
  const packs: MockPack[] = [];
  let previewId = 0;
  return {
    kind: "mock",
    files,
    loadLibrary: async () => {
      library = structuredClone(libraryJson) as unknown as LibraryData;
      library.parts.push(...packs.flatMap((p) => p.partDefs));
      return library;
    },
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
    simulate: async (project) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return mockSimulate(project, library);
    },
    stopSimulation: async () => {},
    pickImportFiles: async () => ["demo_parts.lib"],
    previewImport: async () => mockPreview(++previewId),
    commitImport: async (id, choices, onProgress) => {
      if (id !== previewId) throw "This preview is out of date. Pick the files again.";
      const preview = mockPreview(id);
      const chosen = choices.flatMap((choice) => {
        const candidate = preview.candidates.find((c) => c.key === choice.key);
        return choice.selected && candidate && (candidate.status === "ready" || candidate.status === "already_imported")
          ? [{ candidate, category: choice.category }]
          : [];
      });
      const packSlug = "demo_parts";
      const partDefs = chosen.map(({ candidate, category }, i) => {
        onProgress(i + 1, chosen.length);
        return mockPart(candidate, packSlug, category);
      });
      if (partDefs.length > 0) {
        packs.push({
          id: "imported-demo-parts", name: "demo_parts.lib", origin: "import", sources: ["demo_parts.lib"],
          importedAt: Math.floor(Date.now() / 1000),
          parts: partDefs.map((p) => ({ id: p.manifest.id, modelName: p.manifest.name })),
          partDefs,
        });
      }
      return { packId: partDefs.length > 0 ? "imported-demo-parts" : null, imported: partDefs.map((p) => p.manifest.id), failed: [], skipped: [], cancelled: false };
    },
    cancelImport: async () => {},
    listImports: async () => packs.map(({ partDefs: _parts, ...info }) => info),
    removeImport: async (packId) => {
      const index = packs.findIndex((p) => p.id === packId);
      if (index === -1) throw `no imported pack '${packId}'`;
      packs.splice(index, 1);
    },
  };
}

export const mockBackend = createMockBackend();
