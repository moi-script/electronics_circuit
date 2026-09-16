import { describe, expect, it } from "vitest";
import { emptyProject } from "@/model/types";
import { errorMessage } from "./backend";
import { getBackend, isTauri } from "./index";
import { createMockBackend } from "./mockBackend";

describe("mock backend", () => {
  it("serves the exported core library", async () => {
    const library = await createMockBackend().loadLibrary();
    expect(library.categories).toHaveLength(15);
    expect(library.parts).toHaveLength(8);
    const resistor = library.parts.find((p) => p.manifest.id === "basic.resistor")!;
    expect(resistor.refPrefix).toBe("R");
    expect(resistor.svg).toContain("<svg");
  });

  it("saves, reopens and remembers the last path", async () => {
    const backend = createMockBackend();
    const project = emptyProject();
    project.components.push({ uid: "c1", part: "basic.resistor", ref: "R1", x: 0, y: 0, rot: 0, mirror: false, params: {} });
    expect(await backend.pickSavePath("untitled.msym")).toBe("untitled.msym");
    await backend.saveProject("demo.msym", project);
    expect(await backend.pickOpenPath()).toBe("demo.msym");
    expect(await backend.openProject("demo.msym")).toEqual(project);
  });

  it("rejects opening a missing file with a message", async () => {
    await expect(createMockBackend().openProject("nope.msym")).rejects.toBe("Cannot open nope.msym: not found");
  });

  it("keeps a recovery copy until cleared", async () => {
    const backend = createMockBackend();
    expect(await backend.readRecovery()).toBeNull();
    await backend.writeRecovery(emptyProject());
    expect(await backend.readRecovery()).toEqual(emptyProject());
    await backend.clearRecovery();
    expect(await backend.readRecovery()).toBeNull();
  });

  it("is selected outside the desktop window", async () => {
    expect(isTauri()).toBe(false);
    expect((await getBackend()).kind).toBe("mock");
  });
});

describe("errorMessage", () => {
  it("reads strings, errors and anything else", () => {
    expect(errorMessage("boom")).toBe("boom");
    expect(errorMessage(new Error("bad"))).toBe("bad");
    expect(errorMessage(42)).toBe("42");
  });
});
