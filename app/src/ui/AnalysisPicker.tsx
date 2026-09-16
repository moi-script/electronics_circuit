"use client";

import { useEffect, useRef, useState } from "react";
import { ANALYSIS_DEFAULTS, analysisProblem, analysisSummary, dcSources, dcSweepUnit } from "@/model/analysis";
import { parseSi } from "@/model/si";
import { useEditor } from "@/model/store";
import type { Analysis } from "@/model/types";

type Kind = Analysis["type"];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "tran", label: "Transient" },
  { kind: "op", label: "Operating point" },
  { kind: "ac", label: "AC sweep" },
  { kind: "dc", label: "DC sweep" },
];

function fieldError(text: string, integer: boolean): string | null {
  if (integer) {
    const n = Number(text.trim());
    return Number.isInteger(n) && n >= 1 && n <= 1000 ? null : "Use a whole number from 1 to 1000";
  }
  const parsed = parseSi(text);
  return parsed.ok ? null : parsed.error;
}

function Field(props: { label: string; unit?: string; value: string; integer?: boolean; onCommit(value: string): void }) {
  const [text, setText] = useState(props.value);
  const [synced, setSynced] = useState(props.value);
  const [touched, setTouched] = useState(false);
  if (props.value !== synced) {
    setSynced(props.value);
    setText(props.value);
    setTouched(false);
  }
  const error = touched ? fieldError(text, props.integer ?? false) : null;
  const id = `analysis-${props.label.replace(/\s+/g, "-").toLowerCase()}`;
  const commit = () => {
    setTouched(true);
    if (fieldError(text, props.integer ?? false) === null && text !== props.value) props.onCommit(text);
  };
  return (
    <div className="py-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="w-32 text-muted">{props.label}</label>
        <input
          id={id}
          value={text}
          onChange={(e) => { setText(e.target.value); setTouched(true); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className={`w-24 rounded border bg-bg px-2 py-1 text-text focus:outline-none ${error ? "border-error" : "border-line focus:border-accent"}`}
        />
        {props.unit && <span className="text-muted">{props.unit}</span>}
      </div>
      {error && <div role="alert" className="mt-1 pl-[8.5rem] text-[11px] text-error">{error}</div>}
    </div>
  );
}

const barButton = "rounded px-2 py-1 text-muted hover:bg-line hover:text-text";

export default function AnalysisPicker() {
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const setAnalysis = useEditor((s) => s.setAnalysis);
  const analysis = project.analysis;
  const [open, setOpen] = useState(false);
  const remembered = useRef<Partial<Record<Kind, Analysis>>>({});
  const root = useRef<HTMLDivElement>(null);
  const sources = dcSources(project);
  const problem = analysisProblem(analysis, project, library);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const switchTo = (kind: Kind) => {
    if (kind === analysis.type) return;
    remembered.current[analysis.type] = analysis;
    const next = remembered.current[kind]
      ?? (kind === "dc" ? { ...ANALYSIS_DEFAULTS.dc, source: sources[0] ?? "" } : ANALYSIS_DEFAULTS[kind]);
    setAnalysis(next);
  };
  const update = (patch: Record<string, string | number>) => setAnalysis({ ...analysis, ...patch } as Analysis);

  return (
    <div ref={root} className="relative">
      <button className={barButton} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Analysis settings">
        {analysisSummary(analysis)}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Analysis"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
          className="absolute right-0 top-9 z-40 w-80 rounded-lg border border-line bg-panel p-3"
        >
          <div role="radiogroup" aria-label="Analysis type" className="grid grid-cols-2 gap-1 border-b border-line pb-2">
            {KINDS.map(({ kind, label }) => (
              <label key={kind} className="flex cursor-pointer items-center gap-2 text-text">
                <input type="radio" name="analysis-type" checked={analysis.type === kind} onChange={() => switchTo(kind)} />
                {label}
              </label>
            ))}
          </div>
          <div className="py-2">
            {analysis.type === "op" && <p className="text-muted">Node voltages are shown on the wires.</p>}
            {analysis.type === "tran" && (
              <>
                <Field label="Stop time" unit="s" value={analysis.stop} onCommit={(v) => update({ stop: v })} />
                <Field label="Max step" unit="s" value={analysis.step} onCommit={(v) => update({ step: v })} />
              </>
            )}
            {analysis.type === "ac" && (
              <>
                <Field label="Start frequency" unit="Hz" value={analysis.start} onCommit={(v) => update({ start: v })} />
                <Field label="Stop frequency" unit="Hz" value={analysis.stop} onCommit={(v) => update({ stop: v })} />
                <Field label="Points per decade" integer value={String(analysis.pointsPerDecade)} onCommit={(v) => update({ pointsPerDecade: Number(v) })} />
              </>
            )}
            {analysis.type === "dc" && (
              <>
                <div className="flex items-center gap-2 py-1">
                  <label htmlFor="analysis-source" className="w-32 text-muted">Source</label>
                  <select
                    id="analysis-source"
                    value={analysis.source}
                    disabled={sources.length === 0}
                    onChange={(e) => update({ source: e.target.value })}
                    className="w-24 rounded border border-line bg-bg px-2 py-1 text-text focus:border-accent focus:outline-none"
                  >
                    {!sources.includes(analysis.source) && <option value={analysis.source}>{analysis.source || "—"}</option>}
                    {sources.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                  </select>
                </div>
                <Field label="Start" unit={dcSweepUnit(project, analysis.source)} value={analysis.start} onCommit={(v) => update({ start: v })} />
                <Field label="Stop" unit={dcSweepUnit(project, analysis.source)} value={analysis.stop} onCommit={(v) => update({ stop: v })} />
                <Field label="Step" unit={dcSweepUnit(project, analysis.source)} value={analysis.step} onCommit={(v) => update({ step: v })} />
              </>
            )}
          </div>
          {problem && <p role="status" className="pb-2 text-error">{problem}</p>}
          <div className="flex justify-end">
            <button className="rounded border border-line px-3 py-1 text-text hover:border-accent" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
