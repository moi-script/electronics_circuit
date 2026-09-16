import { describe, expect, it } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import { createEditorStore } from "@/model/store";
import { testLibrary } from "@/test/resetEditor";
import { createAutosave } from "./useAutosave";

describe("autosave", () => {
  it("writes recovery only when dirty and changed", async () => {
    const store = createEditorStore({ library: testLibrary });
    const backend = createMockBackend();
    const tick = createAutosave(store, backend);
    expect(await tick()).toBe(false);
    store.getState().placePart("basic.resistor", [0, 0]);
    expect(await tick()).toBe(true);
    expect((await backend.readRecovery())?.components).toHaveLength(1);
    expect(await tick()).toBe(false);
    store.getState().placePart("basic.resistor", [100, 0]);
    expect(await tick()).toBe(true);
  });
});
