"use client";

import { useEffect, useMemo, useState } from "react";
import { editorStore, useEditor } from "@/model/store";
import { CATEGORIES, type Category, type Param, type PartDef } from "@/model/types";
import { filterParts } from "./partSearch";
import SymbolPreview from "./SymbolPreview";

function defaultText(param: Param): string {
  if (param.type === "choice") {
    return param.options?.find((o) => o.value === param.default)?.label ?? param.default;
  }
  return param.unit ? `${param.default} ${param.unit}` : param.default;
}

export default function ComponentBrowser({ open, onClose }: { open: boolean; onClose(): void }) {
  const library = useEditor((s) => s.library);
  const setTool = useEditor((s) => s.setTool);
  const rememberBrowser = useEditor((s) => s.rememberBrowser);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const parts = useMemo(() => library?.parts ?? [], [library]);
  const counts = useMemo(() => {
    const byCategory = new Map<Category, number>();
    for (const part of parts) byCategory.set(part.manifest.category, (byCategory.get(part.manifest.category) ?? 0) + 1);
    return byCategory;
  }, [parts]);
  const current = category ?? CATEGORIES.find((c) => (counts.get(c) ?? 0) > 0) ?? null;
  const searching = query.trim() !== "";
  const listed = useMemo(
    () => searching ? filterParts(parts, query) : filterParts(parts.filter((p) => p.manifest.category === current), ""),
    [parts, query, searching, current],
  );
  const active = listed.find((p) => p.manifest.id === activeId) ?? listed[0];

  useEffect(() => {
    if (!open) return;
    const memory = editorStore.getState().browser;
    setQuery("");
    setCategory(memory.category);
    setActiveId(memory.partId);
  }, [open]);

  if (!open) return null;

  const close = () => {
    rememberBrowser({ category: current, partId: active?.manifest.id ?? null });
    onClose();
  };

  const choose = (part: PartDef | undefined) => {
    if (!part) return;
    rememberBrowser({ category: part.manifest.category, partId: part.manifest.id });
    setTool({ kind: "place", partId: part.manifest.id });
    onClose();
  };

  const move = (delta: number) => {
    if (listed.length === 0) return;
    const index = active ? listed.indexOf(active) : 0;
    const next = listed[Math.min(Math.max(index + delta, 0), listed.length - 1)];
    setActiveId(next.manifest.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4" onMouseDown={close}>
      <div
        role="dialog"
        aria-label="Add component"
        className="flex h-[560px] max-h-full w-[880px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          else if (e.key === "Enter") { e.preventDefault(); choose(active); }
          else if (e.key === "Escape") { e.preventDefault(); close(); }
        }}
      >
        <div className="flex items-center gap-2 border-b border-line p-2">
          <input
            autoFocus
            value={query}
            placeholder="Search components…"
            onChange={(e) => { setQuery(e.target.value); setActiveId(null); }}
            className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-text placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button aria-label="Close" onClick={close} className="rounded px-2 py-1 text-muted hover:bg-line hover:text-text">✕</button>
        </div>

        {library === null ? (
          <div className="p-4 text-muted">Loading parts…</div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <nav aria-label="Groups" className="w-48 shrink-0 overflow-y-auto border-r border-line py-1">
              {CATEGORIES.map((c) => {
                const count = counts.get(c) ?? 0;
                const selected = !searching && c === current;
                return (
                  <button
                    key={c}
                    aria-label={`group ${c}`}
                    aria-pressed={selected}
                    disabled={count === 0}
                    onClick={() => { setCategory(c); setQuery(""); setActiveId(null); }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-left ${
                      count === 0 ? "cursor-default text-muted/60" : selected ? "bg-line text-text" : "text-muted hover:text-text"
                    }`}
                  >
                    <span className="truncate">{c}</span>
                    <span className="text-[11px]">{count === 0 ? "coming soon" : count}</span>
                  </button>
                );
              })}
            </nav>

            <ul role="listbox" aria-label="Parts" className="w-64 shrink-0 overflow-y-auto border-r border-line py-1">
              {listed.map((part) => {
                const selected = part === active;
                return (
                  <li
                    key={part.manifest.id}
                    role="option"
                    aria-selected={selected}
                    onClick={() => setActiveId(part.manifest.id)}
                    onDoubleClick={() => choose(part)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1 ${selected ? "bg-line text-text" : "text-muted hover:text-text"}`}
                  >
                    <SymbolPreview part={part} width={24} height={16} />
                    <span className="min-w-0 flex-1 truncate">{part.manifest.name}</span>
                    {searching && <span className="text-[11px] text-muted">{part.manifest.category}</span>}
                  </li>
                );
              })}
              {listed.length === 0 && <li className="px-3 py-2 text-muted">No parts match</li>}
            </ul>

            <section aria-label="Details" className="flex min-w-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-4">
              {active && (
                <>
                  <SymbolPreview part={active} width={220} height={160} showPins />
                  <div className="text-center">
                    <div className="text-text">{active.manifest.name}</div>
                    <div className="text-[11px] uppercase tracking-wide text-muted">{active.manifest.category}</div>
                  </div>
                  <dl className="w-full">
                    {active.manifest.params.map((param) => (
                      <div key={param.key} className="flex justify-between gap-2 border-b border-line py-1">
                        <dt className="text-muted">{param.label}</dt>
                        <dd className="text-text">{defaultText(param)}</dd>
                      </div>
                    ))}
                  </dl>
                  <button onClick={() => choose(active)} className="mt-auto rounded bg-accent px-4 py-1 font-semibold text-bg">
                    Place
                  </button>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
