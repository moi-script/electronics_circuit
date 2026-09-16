"use client";

import { useEffect, useState } from "react";
import type { Backend } from "@/backend/backend";
import { editorStore } from "@/model/store";
import type { Project } from "@/model/types";

export default function RecoveryBanner({ backend }: { backend: Backend | null }) {
  const [recovered, setRecovered] = useState<Project | null>(null);

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    backend
      .readRecovery()
      .then((project) => { if (alive) setRecovered(project); })
      // An unreadable recovery file is not worth interrupting startup for.
      .catch(() => {});
    return () => { alive = false; };
  }, [backend]);

  if (!backend || !recovered) return null;

  const restore = () => {
    editorStore.getState().loadProject(recovered, null);
    editorStore.setState({ dirty: true });
    setRecovered(null);
  };
  const discard = async () => {
    setRecovered(null);
    await backend.clearRecovery();
  };

  return (
    <div role="status" className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-panel px-4 py-2">
      <span className="text-text">Restore unsaved work from your last session?</span>
      <button onClick={restore} className="rounded bg-accent px-2 py-1 font-semibold text-bg">Restore</button>
      <button onClick={discard} className="rounded border border-line px-2 py-1 text-muted hover:text-text">Discard</button>
    </div>
  );
}
