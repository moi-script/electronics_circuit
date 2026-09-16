import type { Backend } from "./backend";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let backend: Promise<Backend> | null = null;

/** The desktop backend inside the Tauri window, the in-memory mock anywhere else. */
export function getBackend(): Promise<Backend> {
  backend ??= isTauri()
    ? import("./tauriBackend").then((m) => m.tauriBackend)
    : import("./mockBackend").then((m) => m.mockBackend);
  return backend;
}
