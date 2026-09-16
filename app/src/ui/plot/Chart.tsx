"use client";

import { useEffect, useRef } from "react";
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

export default function Chart({ x, xUnit, logX, series }: { x: number[]; xUnit: string; logX: boolean; series: ChartSeries[] }) {
  const host = useRef<HTMLDivElement>(null);

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
    const plot = new uPlot(options, [x, ...series.map((s) => s.values)] as uPlot.AlignedData, el);
    const observer = new ResizeObserver(() => plot.setSize(size()));
    observer.observe(el);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [x, xUnit, logX, series]);

  return <div ref={host} data-testid="chart" className="h-full w-full overflow-hidden text-[11px] text-muted" />;
}
