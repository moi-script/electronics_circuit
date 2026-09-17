"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage, type Backend } from "@/backend/backend";
import type { PackInfo } from "@/model/importTypes";

export default function ManageImports({ backend, open, onClose, onChanged }: {
  backend: Backend; open: boolean; onClose(): void; onChanged(): void;
}) {
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPacks(await backend.listImports());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [backend]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const remove = async (pack: PackInfo) => {
    try {
      await backend.removeImport(pack.id);
      onChanged();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Manage imports" onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[560px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="font-semibold text-text">Imported parts</span>
          <button aria-label="Close" onClick={onClose} className="rounded px-2 py-1 text-muted hover:bg-line hover:text-text">✕</button>
        </div>
        {error && <div role="alert" className="px-3 py-2 text-error">{error}</div>}
        {packs === null ? (
          <div className="p-4 text-muted">Loading…</div>
        ) : packs.length === 0 ? (
          <div className="p-4 text-muted">No imported parts yet.</div>
        ) : (
          <ul className="overflow-y-auto">
            {packs.map((pack) => (
              <li key={pack.id} className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-text">{pack.name}</div>
                  <div className="text-[11px] text-muted">
                    <span>{pack.parts.length} parts</span> · {new Date(pack.importedAt * 1000).toLocaleDateString()}
                  </div>
                </div>
                <button aria-label={`Remove ${pack.name}`} onClick={() => void remove(pack)}
                  className="rounded px-3 py-1 text-error hover:bg-line">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
