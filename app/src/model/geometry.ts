import type { ComponentInstance, Pin, Point } from "./types";

export const GRID = 10;

/** `+ 0` turns -0 into 0 so results compare equal in tests and JSON. */
export const snap = (v: number): number => Math.round(v / GRID) * GRID + 0;

export const snapPoint = ([x, y]: Point): Point => [snap(x), snap(y)];

export const samePoint = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];

type Placement = Pick<ComponentInstance, "x" | "y" | "rot" | "mirror">;

/** Mirror flips local x, then rotate clockwise on screen about (x, y). Matches circuit.rs. */
export function pinPosition(inst: Placement, pin: Pick<Pin, "x" | "y">): Point {
  const x = inst.mirror ? -pin.x : pin.x;
  const y = pin.y;
  let dx = x;
  let dy = y;
  switch (inst.rot) {
    case 90: dx = -y; dy = x; break;
    case 180: dx = -x; dy = -y; break;
    case 270: dx = y; dy = -x; break;
  }
  return [inst.x + dx + 0, inst.y + dy + 0];
}

export function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return cross === 0
    && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
    && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

/** Horizontal leg first, then vertical. */
export function orthogonalRoute(from: Point, to: Point): Point[] {
  return simplifyPath([from, [to[0], from[1]], to]);
}

/** Drops repeated points and the middle point of collinear triples. */
export function simplifyPath(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length > 0 && samePoint(out[out.length - 1], p)) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((b[0] - a[0]) * (p[1] - a[1]) === (b[1] - a[1]) * (p[0] - a[0])) out.pop();
    }
    out.push(p);
  }
  return out;
}

export function partBounds(inst: Placement, symbol: { width: number; height: number }) {
  const corners = [[0, 0], [symbol.width, 0], [0, symbol.height], [symbol.width, symbol.height]]
    .map(([x, y]) => pinPosition(inst, { x, y }));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
