"use client";

import { analysisProblem } from "@/model/analysis";
import { useEditor } from "@/model/store";
import type { RunActions } from "./runActions";

export default function RunButton({ actions }: { actions: RunActions | null }) {
  const status = useEditor((s) => s.sim.status);
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  if (status === "running") {
    return (
      <button className="rounded border border-accent px-3 py-1 font-semibold text-accent" onClick={() => void actions?.stop()} title="Stop (Ctrl+Enter)">
        ■ Stop
      </button>
    );
  }
  const problem = analysisProblem(project.analysis, project, library);
  return (
    <button
      className="rounded bg-accent px-3 py-1 font-semibold text-bg disabled:opacity-40"
      disabled={!actions || problem !== null}
      onClick={() => void actions?.run()}
      title={problem ?? "Run (Ctrl+Enter)"}
    >
      ▶ Run
    </button>
  );
}
