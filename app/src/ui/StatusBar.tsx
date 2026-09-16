"use client";

import { useEffect, useRef, useState } from "react";
import { GRID, partBounds } from "@/model/geometry";
import { simFeedback } from "@/model/results";
import { simStatusText } from "@/model/simStatus";
import { editorStore, useEditor } from "@/model/store";
import { partMap } from "@/model/wiring";

export default function StatusBar() {
  const { tool, project, library, sim } = useEditor((s) => s);
  const zoom = Math.round((project.view?.zoom ?? 1) * 100);
  const issues = library?.issues ?? [];
  const toolName = tool.kind === "place" ? `Placing ${tool.partId}` : tool.kind === "wire" ? "Wire" : "Select";
  const [now, setNow] = useState(() => Date.now());
  const problemUids = simFeedback(sim, project).problemUids;
  const index = useRef(0);
  const outcomeRef = useRef(sim.outcome);
  if (outcomeRef.current !== sim.outcome) {
    outcomeRef.current = sim.outcome;
    index.current = 0;
  }

  useEffect(() => {
    if (sim.status !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [sim.status]);

  const statusText = simStatusText(sim, now);

  const selectProblem = () => {
    const uid = problemUids[index.current % problemUids.length];
    index.current += 1;
    const s = editorStore.getState();
    s.select({ kind: "component", uid });
    const inst = s.project.components.find((c) => c.uid === uid);
    const part = inst && partMap(s.library).get(inst.part);
    const canvas = document.querySelector<HTMLElement>('[data-testid="canvas"]');
    if (inst && part && canvas) {
      const b = partBounds(inst, part.manifest.symbol);
      const zoom = s.project.view?.zoom ?? 1;
      const rect = canvas.getBoundingClientRect();
      s.setView(zoom, [rect.width / 2 - (b.x + b.width / 2) * zoom, rect.height / 2 - (b.y + b.height / 2) * zoom]);
    }
  };

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[12px] text-muted">
      <span>{toolName}</span>
      <span>Grid {GRID}</span>
      <span>Zoom {zoom}%</span>
      <span>{project.components.length} parts · {project.wires.length} wires</span>
      {problemUids.length > 0 ? (
        <button data-testid="sim-status" className="text-error hover:underline" onClick={selectProblem}>{statusText}</button>
      ) : (
        <span data-testid="sim-status">{statusText}</span>
      )}
      <span className="flex-1" />
      {issues.length > 0 && (
        <span className="text-error" title={issues.map((i) => `${i.path}: ${i.message}`).join("\n")}>
          {issues.length} library issue{issues.length === 1 ? "" : "s"}
        </span>
      )}
    </footer>
  );
}
