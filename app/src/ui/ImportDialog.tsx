"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage, type Backend } from "@/backend/backend";
import { importable, type CandidateStatus, type ImportCandidate, type ImportPreview, type ImportReport } from "@/model/importTypes";
import { CATEGORIES, type Category, type PartDef } from "@/model/types";
import SymbolPreview from "./SymbolPreview";

const STATUS_TEXT: Record<CandidateStatus, string> = {
  ready: "Ready",
  already_imported: "Already imported",
  unsupported: "Unsupported",
  unsafe: "Blocked",
  missing_dependency: "Missing dependency",
};

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "preview"; preview: ImportPreview }
  | { kind: "importing"; done: number; total: number }
  | { kind: "report"; report: ImportReport };

function previewPart(c: ImportCandidate): PartDef {
  return {
    manifest: {
      schema: 1, id: c.key, name: c.name, category: c.category, tags: [],
      symbol: { width: c.symbol.width, height: c.symbol.height, svg: c.symbol.fileName, pins: c.symbol.pins },
      params: c.params, spice: { kind: "analog", refPrefix: c.refPrefix, template: c.template },
    },
    svg: c.symbol.svg,
    refPrefix: c.refPrefix,
  };
}

export default function ImportDialog({ backend, open, onClose, onImported }: {
  backend: Backend; open: boolean; onClose(): void; onImported(report: ImportReport): void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [ticked, setTicked] = useState<Map<string, boolean>>(new Map());
  const [categories, setCategories] = useState<Map<string, Category>>(new Map());
  const [filter, setFilter] = useState("");
  const [openLog, setOpenLog] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPhase({ kind: "loading" });
    setFilter("");
    (async () => {
      try {
        const paths = await backend.pickImportFiles();
        if (!alive) return;
        if (paths.length === 0) { onClose(); return; }
        const preview = await backend.previewImport(paths);
        if (!alive) return;
        setTicked(new Map(preview.candidates.map((c) => [c.key, c.selected])));
        setCategories(new Map(preview.candidates.map((c) => [c.key, c.category])));
        setPhase({ kind: "preview", preview });
      } catch (e) {
        if (alive) setPhase({ kind: "error", message: errorMessage(e) });
      }
    })();
    return () => { alive = false; };
    // Re-pick only when the dialog opens.
  }, [open]);

  const preview = phase.kind === "preview" ? phase.preview : null;
  const shown = useMemo(
    () => (preview?.candidates ?? []).filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [preview, filter],
  );
  if (!open) return null;

  const count = preview ? preview.candidates.filter((c) => importable(c.status) && ticked.get(c.key)).length : 0;

  const runImport = async () => {
    if (!preview) return;
    const choices = preview.candidates.map((c) => ({
      key: c.key,
      selected: importable(c.status) && (ticked.get(c.key) ?? false),
      category: categories.get(c.key) ?? c.category,
    }));
    setPhase({ kind: "importing", done: 0, total: count });
    try {
      const report = await backend.commitImport(preview.previewId, choices, (done, total) =>
        setPhase({ kind: "importing", done, total }));
      setPhase({ kind: "report", report });
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  };

  const button = "rounded px-3 py-1 text-muted hover:bg-line hover:text-text disabled:opacity-40";
  const primary = "rounded bg-accent px-4 py-1 font-semibold text-bg disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4">
      <div role="dialog" aria-modal="true" aria-label="Import parts"
        className="flex max-h-full w-[880px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="font-semibold text-text">Import parts</span>
          {phase.kind !== "importing" && <button aria-label="Close" className={button} onClick={onClose}>✕</button>}
        </div>

        {phase.kind === "loading" && <div className="p-4 text-muted">Reading files…</div>}

        {phase.kind === "error" && (
          <div className="flex flex-col gap-3 p-4">
            <div role="alert" className="text-error">{phase.message}</div>
            <button className={`${button} self-end`} onClick={onClose}>Close</button>
          </div>
        )}

        {preview && (
          <>
            {preview.files.some((f) => f.error || f.warnings.length > 0) && (
              <ul className="max-h-24 overflow-y-auto border-b border-line px-3 py-2 text-[12px]">
                {preview.files.flatMap((f) => [
                  ...(f.error ? [<li key={`${f.path}:error`} className="text-error">{f.name}: {f.error}</li>] : []),
                  ...f.warnings.map((w, i) => <li key={`${f.path}:${i}`} className="text-muted">{f.name}: {w}</li>),
                ])}
              </ul>
            )}
            <div className="flex items-center gap-2 border-b border-line p-2">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter parts…"
                className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-text placeholder:text-muted focus:border-accent focus:outline-none" />
              <button className={button} onClick={() => setTicked((t) => new Map([...t, ...preview.candidates.filter((c) => c.status === "ready").map((c) => [c.key, true] as const)]))}>
                Select all ready
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table aria-label="Import candidates" className="w-full text-left">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr><th className="px-3 py-1"></th><th></th><th>Name</th><th>Kind</th><th>Category</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const canTick = importable(c.status);
                    return (
                      <tr key={c.key} aria-label={c.name} title={c.messages.join("\n")} className="border-t border-line align-top">
                        <td className="px-3 py-1">
                          <input type="checkbox" aria-label={`Import ${c.name}`} disabled={!canTick}
                            checked={canTick && (ticked.get(c.key) ?? false)}
                            onChange={(e) => setTicked((t) => new Map(t).set(c.key, e.target.checked))} />
                        </td>
                        <td className="py-1">{c.symbol.svg && <SymbolPreview part={previewPart(c)} width={32} height={20} />}</td>
                        <td className="py-1">
                          <div className="text-text">{c.name}</div>
                          {c.messages.length > 0 && <div className="text-[11px] text-muted">{c.messages.join(" · ")}</div>}
                        </td>
                        <td className="py-1 text-muted">{c.modelType ?? c.kind ?? ""}</td>
                        <td className="py-1">
                          <select aria-label={`Category for ${c.name}`} disabled={!canTick} value={categories.get(c.key) ?? c.category}
                            onChange={(e) => setCategories((m) => new Map(m).set(c.key, e.target.value as Category))}
                            className="rounded border border-line bg-bg px-1 text-text">
                            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                        </td>
                        <td className={`py-1 pr-3 ${canTick ? "text-accent" : "text-error"}`}>{STATUS_TEXT[c.status]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 border-t border-line p-2">
              <button className={button} onClick={onClose}>Cancel</button>
              <button className={primary} disabled={count === 0} onClick={() => void runImport()}>
                Import {count} parts
              </button>
            </div>
          </>
        )}

        {phase.kind === "importing" && (
          <div className="flex items-center justify-between gap-3 p-4">
            <span className="text-text">Testing {phase.done}/{phase.total}…</span>
            <button className={button} onClick={() => void backend.cancelImport()}>Cancel</button>
          </div>
        )}

        {phase.kind === "report" && (
          <div className="flex flex-col gap-2 p-4">
            <div className="text-text">Imported {phase.report.imported.length} parts</div>
            {phase.report.cancelled && <div className="text-muted">Cancelled — {phase.report.skipped.length} parts skipped</div>}
            {phase.report.failed.length > 0 && (
              <ul className="max-h-64 overflow-y-auto">
                {phase.report.failed.map((f) => (
                  <li key={f.key} className="border-t border-line py-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-error">{f.name}: {f.message}</span>
                      {f.log.length > 0 && (
                        <button className={button} onClick={() => setOpenLog(openLog === f.key ? null : f.key)}>
                          {openLog === f.key ? "Hide log" : "Show log"}
                        </button>
                      )}
                    </div>
                    {openLog === f.key && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{f.log.join("\n")}</pre>}
                  </li>
                ))}
              </ul>
            )}
            <button className={`${primary} self-end`} onClick={() => { onImported(phase.report); onClose(); }}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
