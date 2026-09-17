"use client";

import { useEditor } from "@/model/store";
import RunButton from "./RunButton";
import type { RunActions } from "./runActions";

const button = "rounded px-2 py-1 text-muted hover:bg-line hover:text-text";

export default function FocusToolbar({ onOpenComponents, run }: { onOpenComponents(): void; run: RunActions | null }) {
  const { setTool, togglePanel } = useEditor((s) => s);
  return (
    <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1 rounded-lg border border-line bg-panel p-1">
      <button className={button} onClick={() => setTool({ kind: "select" })}>Select</button>
      <button className={button} onClick={() => setTool({ kind: "wire", points: [] })}>Wire</button>
      <button className={button} onClick={onOpenComponents} title="Components (Ctrl+K)" aria-label="Components">＋ Components</button>
      <span className="mx-1 w-px bg-line" />
      <RunButton actions={run} />
      <span className="mx-1 w-px bg-line" />
      <button className={button} onClick={() => togglePanel("focus")} title="Exit focus (F11)">Exit focus</button>
    </div>
  );
}
