import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ImportPreview, ImportReport, PackInfo } from "@/model/importTypes";
import type { SimOutcome } from "@/model/simTypes";
import type { LibraryData, Project } from "@/model/types";
import type { Backend } from "./backend";

const filters = [{ name: "multysm project", extensions: ["msym"] }];
const importFilters = [{ name: "SPICE models", extensions: ["lib", "mod", "cir", "sub", "spice", "txt"] }];

export const tauriBackend: Backend = {
  kind: "tauri",
  loadLibrary: () => invoke<LibraryData>("load_library"),
  pickOpenPath: async () => {
    const picked = await open({ multiple: false, directory: false, filters });
    return typeof picked === "string" ? picked : null;
  },
  pickSavePath: async (suggestedName) => (await save({ defaultPath: suggestedName, filters })) ?? null,
  openProject: (path) => invoke<Project>("open_project", { path }),
  saveProject: (path, project) => invoke<void>("save_project", { path, project }),
  writeRecovery: (project) => invoke<void>("write_recovery", { project }),
  readRecovery: () => invoke<Project | null>("read_recovery"),
  clearRecovery: () => invoke<void>("clear_recovery"),
  simulate: (project) => invoke<SimOutcome>("simulate", { project }),
  stopSimulation: () => invoke<void>("stop_simulation"),
  pickImportFiles: async () => {
    const picked = await open({ multiple: true, directory: false, filters: importFilters });
    return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  },
  previewImport: (paths) => invoke<ImportPreview>("preview_import", { paths }),
  commitImport: async (previewId, choices, onProgress) => {
    const unlisten = await listen<{ done: number; total: number }>("import-progress", (e) => onProgress(e.payload.done, e.payload.total));
    try {
      return await invoke<ImportReport>("commit_import", { previewId, choices });
    } finally {
      unlisten();
    }
  },
  cancelImport: () => invoke<void>("cancel_import"),
  listImports: () => invoke<PackInfo[]>("list_imports"),
  removeImport: (packId) => invoke<void>("remove_import", { packId }),
};
