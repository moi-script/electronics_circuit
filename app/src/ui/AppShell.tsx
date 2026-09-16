"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { errorMessage } from "@/backend/backend";
import { getBackend } from "@/backend/index";
import { editorStore, useEditor } from "@/model/store";
import FocusToolbar from "./FocusToolbar";
import PartsPanel from "./PartsPanel";
import PlotDock from "./PlotDock";
import PropertiesPanel from "./PropertiesPanel";
import StatusBar from "./StatusBar";
import TopBar from "./TopBar";

// Konva needs a real browser canvas, so the canvas never renders on the server.
const Canvas = dynamic(() => import("./canvas/Canvas"), { ssr: false, loading: () => <div className="h-full bg-bg" /> });

export default function AppShell() {
  const panels = useEditor((s) => s.panels);
  const selection = useEditor((s) => s.selection);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getBackend()
      .then((backend) => backend.loadLibrary())
      .then((library) => { if (alive) editorStore.getState().setLibrary(library); })
      .catch((e) => { if (alive) setLoadError(`Could not load parts: ${errorMessage(e)}`); });
    return () => { alive = false; };
  }, []);

  const focus = panels.focus;
  const showProperties = !focus && (panels.properties || selection !== null);

  return (
    <div className="flex h-full flex-col">
      {!focus && <TopBar />}
      <div className="flex min-h-0 flex-1">
        {!focus && panels.parts && <PartsPanel />}
        <main className="relative min-w-0 flex-1">
          <Canvas />
          {focus && <FocusToolbar />}
          {loadError && (
            <div role="alert" className="absolute bottom-3 left-3 rounded border border-error bg-panel px-3 py-2 text-error">
              {loadError}
            </div>
          )}
        </main>
        {showProperties && <PropertiesPanel />}
      </div>
      {!focus && panels.plot && <PlotDock />}
      {!focus && <StatusBar />}
    </div>
  );
}
