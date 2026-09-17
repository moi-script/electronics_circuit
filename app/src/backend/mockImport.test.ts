import { describe, expect, it } from "vitest";
import { createMockBackend } from "./mockBackend";

describe("mock import", () => {
  it("previews a fixed set of candidates", async () => {
    const backend = createMockBackend();
    expect(await backend.pickImportFiles()).toEqual(["demo_parts.lib"]);
    const preview = await backend.previewImport(["demo_parts.lib"]);
    expect(preview.candidates.map((c) => [c.name, c.status, c.selected])).toEqual([
      ["DEMO_OPAMP", "ready", true],
      ["DEMO_INPUT", "ready", false],
      ["DEMO_SCHOTTKY", "ready", true],
      ["DEMO_SWITCH", "unsupported", false],
    ]);
    expect(preview.files[0].warnings).toHaveLength(1);
  });

  it("imports chosen parts into the library and lists and removes the pack", async () => {
    const backend = createMockBackend();
    const before = (await backend.loadLibrary()).parts.length;
    const preview = await backend.previewImport(["demo_parts.lib"]);
    const progress: number[] = [];
    const report = await backend.commitImport(
      preview.previewId,
      preview.candidates.map((c) => ({ key: c.key, selected: c.selected, category: c.name === "DEMO_OPAMP" ? "Analog" : c.category })),
      (done) => progress.push(done),
    );
    expect(report.imported).toEqual(["imported.demo_parts.demo_opamp", "imported.demo_parts.demo_schottky"]);
    expect(progress).toEqual([1, 2]);
    const library = await backend.loadLibrary();
    expect(library.parts.length).toBe(before + 2);
    const amp = library.parts.find((p) => p.manifest.id === "imported.demo_parts.demo_opamp")!;
    expect(amp.manifest.category).toBe("Analog");
    expect(amp.manifest.tags).toContain("imported");
    expect(amp.refPrefix).toBe("U");

    const packs = await backend.listImports();
    expect(packs.map((p) => [p.id, p.parts.length])).toEqual([["imported-demo-parts", 2]]);
    await backend.removeImport("imported-demo-parts");
    expect(await backend.listImports()).toEqual([]);
    expect((await backend.loadLibrary()).parts.length).toBe(before);
  });

  it("rejects a stale preview id", async () => {
    const backend = createMockBackend();
    await expect(backend.commitImport(99, [], () => {})).rejects.toBe("This preview is out of date. Pick the files again.");
  });
});
