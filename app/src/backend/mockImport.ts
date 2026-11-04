import type { ImportCandidate, ImportPreview, PackInfo } from "@/model/importTypes";
import type { Param, PartDef } from "@/model/types";

const box = (name: string, ports: string[]) => {
  const width = 80;
  const height = Math.max(40, Math.ceil(ports.length / 2) * 20 + 20);
  return {
    fileName: `${name.toLowerCase()}.svg`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="4" width="${width - 20}" height="${height - 8}"/></svg>`,
    width,
    height,
    pins: ports.map((port, i) => ({ id: String(i + 1), name: port, x: i % 2 === 0 ? 0 : width, y: 20 + Math.floor(i / 2) * 20 })),
  };
};

const diode = {
  fileName: "diode.svg",
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M0 10h13M27 10h13M13 2v16l14-8zM27 2v16"/></svg>`,
  width: 40,
  height: 20,
  pins: [{ id: "A", name: "Anode", x: 0, y: 10 }, { id: "K", name: "Cathode", x: 40, y: 10 }],
};

const base = () => ({ source: "demo_parts.lib", params: [] as Param[], messages: [] as string[], replaces: null, description: null as string | null });

/** A fixed preview so the import UI works in the plain browser and in tests. */
export function mockPreview(previewId: number): ImportPreview {
  const candidates: ImportCandidate[] = [
    { ...base(), key: "0:DEMO_OPAMP", name: "DEMO_OPAMP", slug: "demo_opamp", kind: "subckt", modelType: null, category: "Misc",
      refPrefix: "U", template: "X{ref} {pin.1} {pin.2} {pin.3} {pin.4} {pin.5} DEMO_OPAMP",
      symbol: box("DEMO_OPAMP", ["INP", "INN", "VCC", "VEE", "OUT"]), description: "simple op-amp macromodel", status: "ready", selected: true },
    { ...base(), key: "0:DEMO_INPUT", name: "DEMO_INPUT", slug: "demo_input", kind: "subckt", modelType: null, category: "Misc",
      refPrefix: "U", template: "X{ref} {pin.1} {pin.2} {pin.3} DEMO_INPUT", symbol: box("DEMO_INPUT", ["P", "N", "O"]), status: "ready", selected: false },
    { ...base(), key: "0:DEMO_SCHOTTKY", name: "DEMO_SCHOTTKY", slug: "demo_schottky", kind: "diode", modelType: "D", category: "Diodes",
      refPrefix: "D", template: "{ref} {pin.A} {pin.K} DEMO_SCHOTTKY", symbol: diode, status: "ready", selected: true },
    { ...base(), key: "0:DEMO_SWITCH", name: "DEMO_SWITCH", slug: "demo_switch", kind: null, modelType: "SW", category: "Misc",
      refPrefix: "", template: "", symbol: { fileName: "", svg: "", width: 0, height: 0, pins: [] },
      status: "unsupported", messages: ["SW models are not importable"], selected: false },
  ];
  return {
    previewId,
    files: [{ path: "demo_parts.lib", name: "demo_parts.lib", warnings: ["'.include' is not followed; import not_here.lib together with this file"], error: null }],
    candidates,
  };
}

export function mockPart(candidate: ImportCandidate, packSlug: string, category: ImportCandidate["category"]): PartDef {
  return {
    manifest: {
      schema: 1,
      id: `imported.${packSlug}.${candidate.slug}`,
      name: candidate.name,
      category,
      tags: ["imported", candidate.kind ?? ""],
      symbol: { width: candidate.symbol.width, height: candidate.symbol.height, svg: candidate.symbol.fileName, pins: candidate.symbol.pins },
      params: candidate.params,
      spice: { kind: "analog", refPrefix: candidate.refPrefix, template: candidate.template },
    },
    svg: candidate.symbol.svg,
    refPrefix: candidate.refPrefix,
  };
}

export type MockPack = PackInfo & { partDefs: PartDef[] };
