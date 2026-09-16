import { orthogonalRoute, pointOnSegment, samePoint, simplifyPath } from "./geometry";
import type { PartDef, Point, Project } from "./types";
import { pinPoints } from "./wiring";

/** A pin, or any point on an existing wire (vertex or segment interior). */
export function isConnectionPoint(p: Point, project: Project, parts: Map<string, PartDef>): boolean {
  return (
    pinPoints(project, parts).some((pin) => samePoint(pin.point, p)) ||
    project.wires.some((w) => w.points.some((b, i) => i > 0 && pointOnSegment(p, w.points[i - 1], b)))
  );
}

/** One click of the wire tool: start, extend, or finish when the target is a connection. */
export function wireClick(points: Point[], target: Point, connection: boolean): { points: Point[]; finished: Point[] | null } {
  if (points.length === 0) return { points: [target], finished: null };
  const last = points[points.length - 1];
  if (samePoint(last, target)) return { points, finished: null };
  const path = simplifyPath([...points, ...orthogonalRoute(last, target).slice(1)]);
  return connection ? { points: [], finished: path } : { points: path, finished: null };
}

export function wirePreview(points: Point[], cursor: Point | null): Point[] {
  if (points.length === 0 || !cursor) return points;
  return simplifyPath([...points, ...orthogonalRoute(points[points.length - 1], cursor).slice(1)]);
}
