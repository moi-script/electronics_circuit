"use client";

import { useMemo, useState } from "react";
import { useEditor } from "@/model/store";
import { CATEGORIES, type PartDef } from "@/model/types";
import { filterParts } from "./partSearch";

export default function PartsPanel() {
  const library = useEditor((s) => s.library);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const parts = library?.parts ?? [];
  const activeId = tool.kind === "place" ? tool.partId : null;
  const filtered = useMemo(() => filterParts(parts, query), [parts, query]);

  const partButton = (part: PartDef) => (
    <button
      key={part.manifest.id}
      aria-label={`place ${part.manifest.name}`}
      onClick={() => setTool({ kind: "place", partId: part.manifest.id })}
      className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-line ${
        activeId === part.manifest.id ? "bg-line text-selected" : "text-text"
      }`}
    >
      {part.manifest.name}
    </button>
  );

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search parts…"
        className="m-2 rounded border border-line bg-bg px-2 py-1 text-text placeholder:text-muted focus:outline-none focus:border-accent"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {library === null && <div className="px-2 py-1 text-muted">Loading parts…</div>}
        {query.trim() !== ""
          ? filtered.length > 0
            ? filtered.map(partButton)
            : <div className="px-2 py-1 text-muted">No parts match</div>
          : CATEGORIES.map((category) => {
              const inCategory = filtered.filter((p) => p.manifest.category === category);
              const empty = inCategory.length === 0;
              const open = !empty && !collapsed.has(category);
              return (
                <div key={category}>
                  <button
                    aria-label={`category ${category}`}
                    disabled={empty}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(category)) next.delete(category);
                        else next.add(category);
                        return next;
                      })
                    }
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-left ${
                      empty ? "cursor-default text-muted/60" : "text-muted hover:text-text"
                    }`}
                  >
                    <span>{open ? "▾" : "▸"} {category}</span>
                    {empty && <span className="text-[11px]">coming soon</span>}
                  </button>
                  {open && <div className="ml-3">{inCategory.map(partButton)}</div>}
                </div>
              );
            })}
      </div>
    </aside>
  );
}
