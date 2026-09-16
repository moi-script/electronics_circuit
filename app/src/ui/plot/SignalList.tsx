"use client";

import type { PlotSignal } from "@/model/signals";

export default function SignalList({ signals, ticked, colors, onToggle }: {
  signals: PlotSignal[];
  ticked: Set<string>;
  colors: Map<string, string>;
  onToggle(signal: PlotSignal): void;
}) {
  return (
    <ul aria-label="Signals" className="w-52 shrink-0 overflow-y-auto border-r border-line py-1">
      {signals.map((signal) => (
        <li key={signal.key}>
          <label className="flex cursor-pointer items-center gap-2 px-3 py-0.5 text-text hover:bg-line">
            <input type="checkbox" checked={ticked.has(signal.key)} onChange={() => onToggle(signal)} aria-label={signal.label} />
            <span className="min-w-0 flex-1 truncate">{signal.label}</span>
            {ticked.has(signal.key) && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colors.get(signal.key) }} />}
          </label>
        </li>
      ))}
    </ul>
  );
}
