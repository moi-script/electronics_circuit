import { describe, expect, it } from "vitest";
import {
  orthogonalRoute, partBounds, pinPosition, pointOnSegment, simplifyPath, snap, snapPoint,
} from "./geometry";
import type { Rotation } from "./types";

const inst = (rot: Rotation, mirror = false) => ({ x: 100, y: 200, rot, mirror });
const pin = { x: 60, y: 10 };

describe("geometry (mirrors multysm-core circuit.rs)", () => {
  it("snaps to the 10 unit grid", () => {
    expect(snap(14)).toBe(10);
    expect(snap(15)).toBe(20);
    expect(snapPoint([-4, 26])).toEqual([0, 30]);
  });

  it("rotates pins clockwise on screen", () => {
    expect(pinPosition(inst(0), pin)).toEqual([160, 210]);
    expect(pinPosition(inst(90), pin)).toEqual([90, 260]);
    expect(pinPosition(inst(180), pin)).toEqual([40, 190]);
    expect(pinPosition(inst(270), pin)).toEqual([110, 140]);
  });

  it("mirrors before rotating", () => {
    expect(pinPosition(inst(0, true), pin)).toEqual([40, 210]);
    expect(pinPosition(inst(90, true), pin)).toEqual([90, 140]);
  });

  it("detects points on segments", () => {
    expect(pointOnSegment([5, 0], [0, 0], [10, 0])).toBe(true);
    expect(pointOnSegment([10, 0], [0, 0], [10, 0])).toBe(true);
    expect(pointOnSegment([11, 0], [0, 0], [10, 0])).toBe(false);
    expect(pointOnSegment([5, 1], [0, 0], [10, 0])).toBe(false);
  });

  it("routes orthogonally, horizontal first", () => {
    expect(orthogonalRoute([0, 0], [30, 20])).toEqual([[0, 0], [30, 0], [30, 20]]);
    expect(orthogonalRoute([0, 0], [30, 0])).toEqual([[0, 0], [30, 0]]);
    expect(orthogonalRoute([0, 0], [0, 40])).toEqual([[0, 0], [0, 40]]);
  });

  it("simplifies paths by dropping duplicates and collinear middles", () => {
    expect(simplifyPath([[0, 0], [0, 0], [10, 0], [20, 0], [20, 10]])).toEqual([[0, 0], [20, 0], [20, 10]]);
    expect(simplifyPath([[5, 5], [5, 5]])).toEqual([[5, 5]]);
  });

  it("computes axis-aligned bounds after rotation", () => {
    const symbol = { width: 60, height: 20 };
    expect(partBounds(inst(0), symbol)).toEqual({ x: 100, y: 200, width: 60, height: 20 });
    expect(partBounds(inst(90), symbol)).toEqual({ x: 80, y: 200, width: 20, height: 60 });
  });
});
