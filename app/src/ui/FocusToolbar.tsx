"use client";

import { useEditor } from "@/model/store";

const button = "rounded px-2 py-1 text-muted hover:bg-line hover:text-text";

export default function FocusToolbar({ onOpenPalette }: { onOpenPalette(): void }) {
  const { setTool, togglePanel } = useEditor((s) => s);
  return (
    <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1 rounded-lg border border-line bg-panel p-1">
      <button className={button} onClick={() => setTool({ kind: "select" })}>Select</button>
      <button className={button} onClick={() => setTool({ kind: "wire", points: [] })}>Wire</button>
      <button className={button} onClick={onOpenPalette}>Add part</button>
      <span className="mx-1 w-px bg-line" />
      <button className={button} onClick={() => togglePanel("focus")} title="Exit focus (F11)">Exit focus</button>
    </div>
  );
}
