"use client";

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatValue } from "@/model/format";
import { tokens } from "@/theme/tokens";

export interface ChartSeries {
  key: string;
  label: string;
  unit: string;
  color: string;
  values: number[];
}

const tickText = (unit: string) => (_u: uPlot, splits: number[]) => splits.map((v) => formatValue(v, unit, { trim: true }).trim());

const data = (x: number[], series: ChartSeries[]) => [x, ...series.map((s) => s.values)] as uPlot.AlignedData;

export default function Chart({ x, xUnit, logX, series }: { x: number[]; xUnit: string; logX: boolean; series: ChartSeries[] }) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  // The plot instance only needs to be rebuilt when its structure (which traces, their units,
  // colors, and the axes) changes; a pan/zoom or a re-run with the same ticked signals should
  // just push new data into the existing instance instead of tearing it down and losing state.
  const structure = useMemo(
    () => JSON.stringify({ keys: series.map((s) => s.key), labels: series.map((s) => s.label), units: series.map((s) => s.unit), colors: series.map((s) => s.color), logX, xUnit }),
    [series, logX, xUnit],
  );

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const units = [...new Set(series.map((s) => s.unit))];
    const size = () => ({ width: Math.max(el.clientWidth, 100), height: Math.max(el.clientHeight - 28, 60) });
    const axis = { stroke: tokens.muted, grid: { stroke: tokens.grid, width: 1 }, ticks: { stroke: tokens.line, width: 1 } };
    const options: uPlot.Options = {
      ...size(),
      scales: { x: { time: false, distr: logX ? 3 : 1 }, y: { auto: true }, y2: { auto: true } },
      axes: [
        { ...axis, values: tickText(xUnit) },
        { ...axis, scale: "y", size: 64, values: tickText(units[0] ?? "") },
        ...(units.length > 1 ? [{ ...axis, scale: "y2", side: 1, size: 64, grid: { show: false }, values: tickText(units[1]) }] : []),
      ],
      series: [
        { label: xUnit, value: (_u, v) => (v == null ? "—" : formatValue(v, xUnit)) },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          scale: s.unit === units[0] ? "y" : "y2",
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : formatValue(v, s.unit)),
        })),
      ],
      cursor: { drag: { x: false, y: false } },
    };
    const instance = new uPlot(options, data(x, series), el);
    plot.current = instance;
    const observer = new ResizeObserver(() => instance.setSize(size()));
    observer.observe(el);
    return () => {
      observer.disconnect();
      instance.destroy();
      plot.current = null;
    };
    // x and series values are pushed via setData below; only the structural key should recreate the plot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure]);

  useEffect(() => {
    plot.current?.setData(data(x, series));
  }, [x, series]);

  return <div ref={host} data-testid="chart" className="h-full w-full overflow-hidden text-[11px] text-muted" />;
}
