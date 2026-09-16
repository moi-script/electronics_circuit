"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, type Backend } from "@/backend/backend";
import { getBackend } from "@/backend/index";
import { editorStore, useEditor } from "@/model/store";
import ComponentBrowser from "./ComponentBrowser";
import { createFileActions } from "./fileActions";
import FocusToolbar from "./FocusToolbar";
import PlotDock from "./plot/PlotDock";
import PropertiesPanel from "./PropertiesPanel";
import RecoveryBanner from "./RecoveryBanner";
import { createRunActions } from "./runActions";
import StatusBar from "./StatusBar";
import TopBar from "./TopBar";
import { useAutosave } from "./useAutosave";
import { useShortcuts } from "./useShortcuts";

// Konva needs a real browser canvas, so the canvas never renders on the server.
const Canvas = dynamic(() => import("./canvas/Canvas"), { ssr: false, loading: () => <div className="h-full bg-bg" /> });

export default function AppShell() {
  const panels = useEditor((s) => s.panels);
  const selection = useEditor((s) => s.selection);
  const [backend, setBackend] = useState<Backend | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const notify = useCallback((message: string) => setNotice(message), []);

  useEffect(() => {
    let alive = true;
    getBackend()
      .then(async (b) => {
        if (!alive) return;
        setBackend(b);
        const library = await b.loadLibrary();
        if (alive) editorStore.getState().setLibrary(library);
      })
      .catch((e) => { if (alive) notify(`Could not load parts: ${errorMessage(e)}`); });
    return () => { alive = false; };
  }, [notify]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    // Test hook for Playwright; never shipped in production builds.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __multysm?: typeof editorStore }).__multysm = editorStore;
    }
  }, []);

  const files = useMemo(
    () => backend && createFileActions({
      store: editorStore,
      backend,
      confirmDiscard: () => window.confirm("Discard unsaved changes?"),
      notify,
    }),
    [backend, notify],
  );
  const runActions = useMemo(() => backend && createRunActions(editorStore, backend), [backend]);

  const openComponents = () => setBrowserOpen(true);
  useShortcuts({
    openComponents,
    newFile: files ? () => void files.newFile() : undefined,
    open: files ? () => void files.open() : undefined,
    save: files ? () => void files.save() : undefined,
    saveAs: files ? () => void files.saveAs() : undefined,
    toggleRun: runActions ? runActions.toggle : undefined,
    isBlocked: () => browserOpen,
  });
  useAutosave(backend, notify);

  const focus = panels.focus;
  const showProperties = !focus && (panels.properties || selection !== null);

  return (
    <div className="flex h-full flex-col">
      {!focus && <TopBar onOpenComponents={openComponents} files={files} run={runActions} />}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <Canvas />
          {focus && <FocusToolbar onOpenComponents={openComponents} run={runActions} />}
          <RecoveryBanner backend={backend} />
          {notice && (
            <div role="alert" className="absolute bottom-3 left-3 rounded border border-error bg-panel px-3 py-2 text-error">
              {notice}
            </div>
          )}
        </main>
        {showProperties && <PropertiesPanel />}
      </div>
      {!focus && panels.plot && <PlotDock />}
      {!focus && <StatusBar />}
      <ComponentBrowser open={browserOpen} onClose={() => setBrowserOpen(false)} />
    </div>
  );
}
