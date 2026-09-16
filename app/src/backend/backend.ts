import type { LibraryData, Project } from "@/model/types";

/** Everything the UI needs from outside the webview. */
export interface Backend {
  readonly kind: "tauri" | "mock";
  loadLibrary(): Promise<LibraryData>;
  pickOpenPath(): Promise<string | null>;
  pickSavePath(suggestedName: string): Promise<string | null>;
  openProject(path: string): Promise<Project>;
  saveProject(path: string, project: Project): Promise<void>;
  writeRecovery(project: Project): Promise<void>;
  readRecovery(): Promise<Project | null>;
  clearRecovery(): Promise<void>;
}

/** Tauri commands reject with strings; everything else with Errors. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
