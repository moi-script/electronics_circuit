import { describe, expect, it } from "vitest";
import library from "@/backend/mock-library.json";
import { emptyProject, type LibraryData } from "./types";
import { isConnectionPoint, wireClick, wirePreview } from "./wireTool";
import { partMap } from "./wiring";

const parts = partMap(library as unknown as LibraryData);

describe("wire tool", () => {
  it("starts, extends with orthogonal corners, and finishes on a connection", () => {
    const start = wireClick([], [0, 0], true);
    expect(start).toEqual({ points: [[0, 0]], finished: null });
    const bend = wireClick(start.points, [40, 30], false);
    expect(bend).toEqual({ points: [[0, 0], [40, 0], [40, 30]], finished: null });
    const done = wireClick(bend.points, [80, 30], true);
    expect(done).toEqual({ points: [], finished: [[0, 0], [40, 0], [40, 30], [80, 30]] });
  });

  it("ignores a second click on the last point", () => {
    expect(wireClick([[10, 10]], [10, 10], true)).toEqual({ points: [[10, 10]], finished: null });
  });

  it("previews the route to the cursor", () => {
    expect(wirePreview([[0, 0]], [30, 20])).toEqual([[0, 0], [30, 0], [30, 20]]);
    expect(wirePreview([], [30, 20])).toEqual([]);
    expect(wirePreview([[0, 0]], null)).toEqual([[0, 0]]);
  });

  it("treats pins and any point on a wire as connections", () => {
    const project = emptyProject();
    project.components.push({ uid: "c1", part: "basic.resistor", ref: "R1", x: 0, y: 0, rot: 0, mirror: false, params: {} });
    project.wires.push({ uid: "w1", points: [[100, 100], [200, 100]] });
    expect(isConnectionPoint([60, 10], project, parts)).toBe(true);
    expect(isConnectionPoint([150, 100], project, parts)).toBe(true);
    expect(isConnectionPoint([150, 110], project, parts)).toBe(false);
  });
});
