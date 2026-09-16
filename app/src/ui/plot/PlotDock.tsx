"use client";

import { useEffect, useMemo, useState } from "react";
import { listSignals, netOfProbe, tickedKeys, TRACE_COLORS, type PlotSignal } from "@/model/signals";
import { useEditor } from "@/model/store";
import { partMap } from "@/model/wiring";
import Chart, { type ChartSeries } from "./Chart";
import SignalList from "./SignalList";

const message = "flex flex-1 items-center justify-center text-muted";

export default function PlotDock() {
  const sim = useEditor((s) => s.sim);
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const toggleProbe = useEditor((s) => s.toggleProbe);
  const parts = useMemo(() => partMap(library), [library]);
  const [hiddenAuto, setHiddenAuto] = useState<Set<string>>(new Set());
  // Signals with no auto-tick and no saved probe (e.g. source currents) can only be
  // shown for this session -- there is nothing to persist them by.
  const [manual, setManual] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState(false);

  const result = sim.outcome?.status === "ok" ? sim.outcome.result : null;
  // listSignals only reads project.components; depending on the whole project would rebuild the
  // signal list (and, downstream, the uPlot instance) on every pan or zoom.
  const signals = useMemo(() => (result ? listSignals(result, project, parts) : []), [result, project.components, parts]);
  const savedTicked = useMemo(
    () => new Set(result ? tickedKeys(signals, project.probes, hiddenAuto, result) : []),
    [signals, project.probes, hiddenAuto, result],
  );

  // A new run outcome starts a fresh tick state: manual/hidden-auto sets from a previous project
  // (or a previous run's signal set) shouldn't leak into this one.
  useEffect(() => {
    setHiddenAuto(new Set());
    setManual(new Set());
  }, [sim.outcome]);
  const ticked = useMemo(
    () => signals.filter((s) => savedTicked.has(s.key) || manual.has(s.key)).map((s) => s.key),
    [signals, savedTicked, manual],
  );
  const colors = useMemo(() => new Map(ticked.map((key, i) => [key, TRACE_COLORS[i % TRACE_COLORS.length]])), [ticked]);
  const showPhase = result?.analysis === "ac" && phase;
  const series = useMemo<ChartSeries[]>(
    () => ticked.flatMap((key) => {
      const s = signals.find((signal) => signal.key === key);
      if (!s) return [];
      return [{ key, label: s.label, unit: showPhase ? "°" : result?.analysis === "ac" ? "dB" : s.unit, color: colors.get(key)!, values: showPhase ? s.phase ?? s.values : s.values }];
    }),
    [ticked, signals, colors, showPhase, result],
  );

  const toggle = (signal: PlotSignal) => {
    if (signal.auto) {
      setHiddenAuto((prev) => {
        const next = new Set(prev);
        if (next.has(signal.key)) next.delete(signal.key);
        else next.add(signal.key);
        return next;
      });
    } else if (signal.probe) {
      const net = signal.key.startsWith("v:") ? signal.key.slice(2) : null;
      if (net !== null && result && savedTicked.has(signal.key)) {
        // Unticking a net removes every stored probe that resolves to it, not just the one
        // (the net's current first pin) that would be used to tick it again.
        for (const ref of project.probes) if (netOfProbe(ref, result) === net) toggleProbe(ref);
      } else {
        toggleProbe(signal.probe);
      }
    } else {
      setManual((prev) => {
        const next = new Set(prev);
        if (next.has(signal.key)) next.delete(signal.key);
        else next.add(signal.key);
        return next;
      });
    }
  };

  return (
    <section aria-label="Plot" className="relative flex h-60 shrink-0 border-t border-line bg-panel">
      {!result ? (
        <div className={message}>Run a transient, AC or DC sweep to see a plot.</div>
      ) : result.analysis === "op" ? (
        <div className={message}>Operating point: values are shown on the wires.</div>
      ) : (
        <>
          <SignalList signals={signals} ticked={new Set(ticked)} colors={colors} onToggle={toggle} />
          <div className={`relative min-w-0 flex-1 p-2 ${sim.stale ? "opacity-50" : ""}`}>
            {result.analysis === "ac" && (
              <div role="group" aria-label="AC view" className="absolute right-3 top-1 z-10 flex gap-1">
                {(["Mag", "Phase"] as const).map((label) => {
                  const pressed = (label === "Phase") === phase;
                  return (
                    <button
                      key={label}
                      aria-pressed={pressed}
                      onClick={() => setPhase(label === "Phase")}
                      className={`rounded px-2 text-[11px] ${pressed ? "bg-line text-text" : "text-muted hover:text-text"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {series.length === 0 ? (
              <div className={`${message} h-full`}>Tick a signal to plot it.</div>
            ) : (
              <Chart x={result.x?.values ?? []} xUnit={result.x?.unit ?? ""} logX={result.x?.log ?? false} series={series} />
            )}
          </div>
        </>
      )}
      {result && sim.stale && (
        <span className="absolute left-56 top-1 rounded bg-line px-2 text-[11px] text-muted">outdated</span>
      )}
    </section>
  );
}
