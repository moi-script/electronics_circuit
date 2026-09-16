import { describe, expect, it } from "vitest";
import library from "@/backend/mock-library.json";
import { danglingEnds, junctionPoints, partMap, pinPoints, snapTarget } from "./wiring";
import { emptyProject, type LibraryData, type Point, type Project } from "./types";

const parts = partMap(library as unknown as LibraryData);

/** Resistor pins are at local (0,10) and (60,10). */
function project(wires: Point[][], resistors: [number, number][] = []): Project {
  const p = emptyProject();
  p.components = resistors.map(([x, y], i) => ({
    uid: `c${i + 1}`, part: "basic.resistor", ref: `R${i + 1}`, x, y, rot: 0, mirror: false, params: {},
  }));
  p.wires = wires.map((points, i) => ({ uid: `w${i + 1}`, points }));
  return p;
}

describe("wiring helpers", () => {
  it("indexes parts and lists absolute pin points", () => {
    expect(parts.get("basic.resistor")?.refPrefix).toBe("R");
    expect(pinPoints(project([], [[100, 100]]), parts)).toEqual([
      { uid: "c1", pin: "1", point: [100, 110] },
      { uid: "c1", pin: "2", point: [160, 110] },
    ]);
  });

  it("puts a junction dot where a wire ends on another wire", () => {
    const p = project([[[0, 0], [100, 0]], [[50, 0], [50, 50]]]);
    expect(junctionPoints(p, parts)).toEqual([[50, 0]]);
  });

  it("puts a junction dot where three wires meet", () => {
    const p = project([[[0, 0], [50, 0]], [[50, 0], [100, 0]], [[50, 0], [50, 50]]]);
    expect(junctionPoints(p, parts)).toEqual([[50, 0]]);
  });

  it("has no dot for a plain pin-to-pin wire or for crossing wires", () => {
    const pinToPin = project([[[60, 10], [200, 10]]], [[0, 0], [200, 0]]);
    expect(junctionPoints(pinToPin, parts)).toEqual([]);
    const crossing = project([[[0, 0], [100, 0]], [[50, -50], [50, 50]]]);
    expect(junctionPoints(crossing, parts)).toEqual([]);
  });

  it("reports wire ends that connect to nothing", () => {
    const p = project([[[60, 10], [200, 10], [200, 80]]], [[0, 0]]);
    expect(danglingEnds(p, parts)).toEqual([[200, 80]]);
  });

  it("snaps to a nearby pin first, then a wire vertex, then the grid", () => {
    const p = project([[[300, 300], [400, 300]]], [[0, 0]]);
    expect(snapTarget([63, 12], p, parts)).toEqual([60, 10]);
    expect(snapTarget([398, 303], p, parts)).toEqual([400, 300]);
    expect(snapTarget([123, 87], p, parts)).toEqual([120, 90]);
  });
});
