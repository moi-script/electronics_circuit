import { describe, expect, it } from "vitest";
import type { Point } from "@/model/types";
import { gridStyle, MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen, zoomAt } from "./viewport";

describe("viewport", () => {
  it("converts between screen and world coordinates", () => {
    const pan: Point = [100, 50];
    expect(screenToWorld([300, 250], 2, pan)).toEqual([100, 100]);
    expect(worldToScreen([100, 100], 2, pan)).toEqual([300, 250]);
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    const pan: Point = [40, -20];
    const cursor: Point = [500, 300];
    const before = screenToWorld(cursor, 1, pan);
    const next = zoomAt(1, pan, cursor, -100);
    expect(next.zoom).toBeCloseTo(1.1);
    const after = screenToWorld(cursor, next.zoom, next.pan);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(zoomAt(1, pan, cursor, 100).zoom).toBeCloseTo(1 / 1.1);
  });

  it("clamps zoom", () => {
    expect(zoomAt(MAX_ZOOM, [0, 0], [0, 0], -1).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(MIN_ZOOM, [0, 0], [0, 0], 1).zoom).toBe(MIN_ZOOM);
  });

  it("sizes the dot grid with zoom and follows pan", () => {
    expect(gridStyle(1, [0, 0])).toMatchObject({ backgroundSize: "20px 20px", backgroundPosition: "-10px -10px" });
    expect(gridStyle(2, [30, 40])).toMatchObject({ backgroundSize: "40px 40px", backgroundPosition: "10px 20px" });
    expect(gridStyle(0.3, [0, 0]).backgroundSize).toBe("15px 15px");
  });
});
