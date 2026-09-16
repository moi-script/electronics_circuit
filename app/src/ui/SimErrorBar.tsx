"use client";

import { useMemo, useState } from "react";
import { simFeedback } from "@/model/results";
import { useEditor } from "@/model/store";

export default function SimErrorBar() {
  const sim = useEditor((s) => s.sim);
  const project = useEditor((s) => s.project);
  const bar = useMemo(() => simFeedback(sim, project).bar, [sim, project]);
  const [dismissed, setDismissed] = useState<typeof sim.outcome>(null);
  const [showLog, setShowLog] = useState(false);
  if (!bar || dismissed === sim.outcome) return null;
  return (
    <div role="alert" className="absolute left-1/2 top-2 z-30 w-[36rem] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded border border-error bg-panel px-3 py-2 text-error">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">{bar.message}</span>
        {bar.log && bar.log.length > 0 && (
          <button className="text-muted hover:text-text" onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide log" : "Show log"}</button>
        )}
        <button aria-label="Dismiss" className="text-muted hover:text-text" onClick={() => { setDismissed(sim.outcome); setShowLog(false); }}>✕</button>
      </div>
      {showLog && bar.log && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{bar.log.join("\n")}</pre>
      )}
    </div>
  );
}
