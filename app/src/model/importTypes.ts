import type { Category, Param, Pin } from "./types";

export type CandidateStatus = "ready" | "already_imported" | "unsupported" | "unsafe" | "missing_dependency";
export type PartKind = "diode" | "bjt" | "mosfet" | "jfet" | "subckt";
export interface ImportSymbol { fileName: string; svg: string; width: number; height: number; pins: Pin[] }
export interface ImportCandidate { key: string; name: string; slug: string; kind: PartKind | null; modelType: string | null; category: Category; source: string; refPrefix: string; template: string; params: Param[]; symbol: ImportSymbol; description: string | null; status: CandidateStatus; messages: string[]; selected: boolean; replaces: string | null }
export interface ImportPreviewFile { path: string; name: string; warnings: string[]; error: string | null }
export interface ImportPreview { previewId: number; files: ImportPreviewFile[]; candidates: ImportCandidate[] }
export interface ImportChoice { key: string; selected: boolean; category: Category }
export interface ImportReport { packId: string | null; imported: string[]; failed: { key: string; name: string; message: string; log: string[] }[]; skipped: string[]; cancelled: boolean }
export interface PackInfo { id: string; name: string; origin: string; sources: string[]; importedAt: number; parts: { id: string; modelName: string }[] }
export const importable = (status: CandidateStatus) => status === "ready" || status === "already_imported";
