import type { CSSProperties } from "react";
import { GRID } from "@/model/geometry";
import type { Point } from "@/model/types";
import { tokens } from "@/theme/tokens";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.1;

export const screenToWorld = ([sx, sy]: Point, zoom: number, pan: Point): Point =>
  [(sx - pan[0]) / zoom, (sy - pan[1]) / zoom];

export const worldToScreen = ([wx, wy]: Point, zoom: number, pan: Point): Point =>
  [wx * zoom + pan[0], wy * zoom + pan[1]];

/** Zoom one step in (deltaY < 0) or out about `screen`, keeping that world point fixed. */
export function zoomAt(zoom: number, pan: Point, screen: Point, deltaY: number): { zoom: number; pan: Point } {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP));
  const [wx, wy] = screenToWorld(screen, zoom, pan);
  return { zoom: next, pan: [screen[0] - wx * next, screen[1] - wy * next] };
}

/** Subtle dot grid as a CSS background: a dot every 2 grid cells (every 5 when zoomed far out). */
export function gridStyle(zoom: number, pan: Point): CSSProperties {
  const size = GRID * (zoom < 0.5 ? 5 : 2) * zoom;
  return {
    backgroundColor: tokens.bg,
    backgroundImage: `radial-gradient(circle, ${tokens.grid} 1px, transparent 1.5px)`,
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${pan[0] - size / 2}px ${pan[1] - size / 2}px`,
  };
}
