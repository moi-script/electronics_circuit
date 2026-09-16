import library from "@/backend/mock-library.json";
import { editorStore } from "@/model/store";
import type { LibraryData } from "@/model/types";

export const testLibrary = library as unknown as LibraryData;

/** Resets the app-wide store between UI tests (keeps its bound actions). */
export function resetEditor(lib: LibraryData | null = testLibrary) {
  editorStore.getState().newProject();
  editorStore.setState({
    library: lib,
    clipboard: null,
    panels: { properties: false, plot: false, focus: false },
    browser: { category: null, partId: null },
  });
}
