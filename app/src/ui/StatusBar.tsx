"use client";

import { useEffect, useState } from "react";
import { GRID } from "@/model/geometry";
import { simStatusText } from "@/model/simStatus";
import { useEditor } from "@/model/store";

export default function StatusBar() {
  const { tool, project, library, sim } = useEditor((s) => s);
  const zoom = Math.round((project.view?.zoom ?? 1) * 100);
  const issues = library?.issues ?? [];
  const toolName = tool.kind === "place" ? `Placing ${tool.partId}` : tool.kind === "wire" ? "Wire" : "Select";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (sim.status !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [sim.status]);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[12px] text-muted">
      <span>{toolName}</span>
      <span>Grid {GRID}</span>
      <span>Zoom {zoom}%</span>
      <span>{project.components.length} parts · {project.wires.length} wires</span>
      <span data-testid="sim-status">{simStatusText(sim, now)}</span>
      <span className="flex-1" />
      {issues.length > 0 && (
        <span className="text-error" title={issues.map((i) => `${i.path}: ${i.message}`).join("\n")}>
          {issues.length} library issue{issues.length === 1 ? "" : "s"}
        </span>
      )}
    </footer>
  );
}
