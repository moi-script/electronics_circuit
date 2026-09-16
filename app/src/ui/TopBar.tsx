"use client";

import { useEditor } from "@/model/store";
import AnalysisPicker from "./AnalysisPicker";
import type { FileActions } from "./fileActions";

const barButton = "rounded px-2 py-1 text-muted hover:bg-line hover:text-text disabled:opacity-40";

export default function TopBar({ onOpenComponents, files }: { onOpenComponents(): void; files: FileActions | null }) {
  const { tool, setTool, undo, redo, past, future, filePath, dirty } = useEditor((s) => s);
  const name = filePath ? filePath.split(/[\\/]/).pop() : "Untitled";
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-3">
      <span className="mr-3 font-semibold text-accent">multysm</span>
      <button className={barButton} disabled={!files} onClick={() => void files?.newFile()} title="New (Ctrl+N)">New</button>
      <button className={barButton} disabled={!files} onClick={() => void files?.open()} title="Open (Ctrl+O)">Open</button>
      <button className={barButton} disabled={!files} onClick={() => void files?.save()} title="Save (Ctrl+S)">Save</button>
      <button className={barButton} disabled={!files} onClick={() => void files?.saveAs()} title="Save As (Ctrl+Shift+S)">Save As</button>
      <span className="mx-2 h-5 w-px bg-line" />
      <button className={`${barButton} ${tool.kind === "select" ? "text-text" : ""}`} onClick={() => setTool({ kind: "select" })} title="Select (Esc)">Select</button>
      <button className={`${barButton} ${tool.kind === "wire" ? "text-text" : ""}`} onClick={() => setTool({ kind: "wire", points: [] })} title="Wire (W)">Wire</button>
      <button className={barButton} onClick={onOpenComponents} title="Components (Ctrl+K)" aria-label="Components">
        <span className="mr-1 text-accent">＋</span>Components
      </button>
      <span className="mx-2 h-5 w-px bg-line" />
      <button className={barButton} onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">Undo</button>
      <button className={barButton} onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Y)">Redo</button>
      <span className="flex-1 truncate text-center text-muted">{name}{dirty ? " •" : ""}</span>
      <AnalysisPicker />
      <span className="mx-2 h-5 w-px bg-line" />
      <button className="rounded bg-accent px-3 py-1 font-semibold text-bg opacity-40" disabled title="Simulation arrives in Plan 3">▶ Run</button>
    </header>
  );
}
