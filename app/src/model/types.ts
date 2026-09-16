/** Shapes shared with the Rust backend (serde JSON). */

export type Category =
  | "Sources" | "Basic" | "Diodes" | "Transistors" | "Analog" | "TTL" | "CMOS"
  | "Advanced Peripherals" | "Misc Digital" | "Mixed" | "Indicators" | "Power"
  | "Misc" | "RF" | "Electromechanical";

export const CATEGORIES: Category[] = [
  "Sources", "Basic", "Diodes", "Transistors", "Analog", "TTL", "CMOS",
  "Advanced Peripherals", "Misc Digital", "Mixed", "Indicators", "Power",
  "Misc", "RF", "Electromechanical",
];

export interface Pin {
  id: string;
  name?: string | null;
  x: number;
  y: number;
  optional?: boolean;
}

export interface Param {
  key: string;
  label: string;
  unit?: string;
  default: string;
  type: "si" | "text";
}

export interface Manifest {
  schema: number;
  id: string;
  name: string;
  category: Category;
  tags: string[];
  symbol: { width: number; height: number; svg: string; pins: Pin[] };
  params: Param[];
  spice: {
    kind: "ground" | "analog" | "digital";
    refPrefix?: string;
    template?: string;
    models?: string[];
    subckt?: string | null;
  };
  live?: unknown;
  controls?: unknown[];
}

export interface PartDef {
  manifest: Manifest;
  /** Symbol SVG markup; strokes use currentColor. */
  svg: string;
  refPrefix: string;
}

export interface LibraryIssue {
  path: string;
  message: string;
}

export interface LibraryData {
  categories: Category[];
  parts: PartDef[];
  issues: LibraryIssue[];
}

export type Point = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export interface ComponentInstance {
  uid: string;
  part: string;
  ref: string;
  x: number;
  y: number;
  rot: Rotation;
  mirror: boolean;
  /** Overrides only; missing keys use the manifest default. */
  params: Record<string, string>;
}

export interface Wire {
  uid: string;
  points: Point[];
}

export type Analysis =
  | { type: "op" }
  | { type: "tran"; stop: string; step: string }
  | { type: "ac"; start: string; stop: string; pointsPerDecade: number }
  | { type: "dc"; source: string; start: string; stop: string; step: string };

export interface Project {
  format: 1;
  app: string;
  packs: { id: string; version: string }[];
  components: ComponentInstance[];
  wires: Wire[];
  analysis: Analysis;
  probes: string[];
  view: { zoom: number; pan: Point } | null;
}

export const APP_VERSION = "0.1.0";

export function emptyProject(): Project {
  return {
    format: 1,
    app: APP_VERSION,
    packs: [{ id: "core", version: "1.0.0" }],
    components: [],
    wires: [],
    analysis: { type: "tran", stop: "10m", step: "10u" },
    probes: [],
    view: { zoom: 1, pan: [0, 0] },
  };
}
