import { pinPosition, pointOnSegment, samePoint, snapPoint } from "./geometry";
import type { LibraryData, PartDef, Point, Project } from "./types";

export interface PinPoint {
  uid: string;
  pin: string;
  point: Point;
}

export function partMap(library: LibraryData | null): Map<string, PartDef> {
  return new Map((library?.parts ?? []).map((part) => [part.manifest.id, part]));
}

export function pinPoints(project: Project, parts: Map<string, PartDef>): PinPoint[] {
  return project.components.flatMap((inst) =>
    (parts.get(inst.part)?.manifest.symbol.pins ?? []).map((pin) => ({
      uid: inst.uid,
      pin: pin.id,
      point: pinPosition(inst, pin),
    })),
  );
}

/**
 * How many connections meet at `p`: each wire segment ending at `p` counts 1,
 * a segment passing through `p` counts 2, each pin at `p` counts 1.
 */
function arms(p: Point, project: Project, pins: PinPoint[]): number {
  let count = pins.filter((pin) => samePoint(pin.point, p)).length;
  for (const wire of project.wires) {
    for (let i = 1; i < wire.points.length; i++) {
      const a = wire.points[i - 1];
      const b = wire.points[i];
      if (samePoint(p, a) || samePoint(p, b)) count += 1;
      else if (pointOnSegment(p, a, b)) count += 2;
    }
  }
  return count;
}

function uniqueWireEnds(project: Project): Point[] {
  const ends: Point[] = [];
  for (const wire of project.wires) {
    for (const end of [wire.points[0], wire.points[wire.points.length - 1]]) {
      if (!ends.some((e) => samePoint(e, end))) ends.push(end);
    }
  }
  return ends;
}

/** Points that get a junction dot: three or more connections meet there. */
export function junctionPoints(project: Project, parts: Map<string, PartDef>): Point[] {
  const pins = pinPoints(project, parts);
  return uniqueWireEnds(project).filter((p) => arms(p, project, pins) >= 3);
}

/** Wire ends that touch no pin and no other wire. */
export function danglingEnds(project: Project, parts: Map<string, PartDef>): Point[] {
  const pins = pinPoints(project, parts);
  return uniqueWireEnds(project).filter((p) => arms(p, project, pins) === 1);
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Nearest pin within `radius`, else nearest wire vertex, else the grid point. */
export function snapTarget(p: Point, project: Project, parts: Map<string, PartDef>, radius = 6): Point {
  const nearest = (candidates: Point[]) =>
    candidates
      .map((c) => ({ c, d: distance(c, p) }))
      .filter(({ d }) => d <= radius)
      .sort((x, y) => x.d - y.d)[0]?.c;
  return (
    nearest(pinPoints(project, parts).map((pin) => pin.point)) ??
    nearest(project.wires.flatMap((w) => w.points)) ??
    snapPoint(p)
  );
}
