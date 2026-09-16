import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { LibraryData, Project } from "@/model/types";
import type { Backend } from "./backend";

const filters = [{ name: "multysm project", extensions: ["msym"] }];

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
};
