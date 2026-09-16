"use client";

import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/model/store";
import type { PartDef } from "@/model/types";
import { filterParts } from "./partSearch";

export default function CommandPalette({ open, onClose }: { open: boolean; onClose(): void }) {
  const library = useEditor((s) => s.library);
  const setTool = useEditor((s) => s.setTool);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => filterParts(library?.parts ?? [], query).slice(0, 20), [library, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  if (!open) return null;

  const choose = (part: PartDef | undefined) => {
    if (!part) return;
    setTool({ kind: "place", partId: part.manifest.id });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-bg/60 pt-[18vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Place a part"
        className="h-fit w-[28rem] max-w-[90vw] overflow-hidden rounded-lg border border-line bg-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          placeholder="Search parts to place…"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          className="w-full border-b border-line bg-transparent px-3 py-2 text-text placeholder:text-muted focus:outline-none"
        />
        <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
          {results.map((part, i) => (
            <li
              key={part.manifest.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={() => choose(part)}
              className={`flex cursor-pointer justify-between px-3 py-1.5 ${i === active ? "bg-line text-text" : "text-muted"}`}
            >
              <span>{part.manifest.name}</span>
              <span className="text-[11px]">{part.manifest.category}</span>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-muted">No parts match</li>}
        </ul>
      </div>
    </div>
  );
}
