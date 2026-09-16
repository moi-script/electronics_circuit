"use client";

import { Circle } from "react-konva";
import type { Point } from "@/model/types";
import { tokens } from "@/theme/tokens";

export default function ErrorOverlay({ points }: { points: Point[] }) {
  return (
    <>
      {points.map((p, i) => (
        <Circle key={`${p[0]},${p[1]},${i}`} x={p[0]} y={p[1]} radius={5} stroke={tokens.error} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
      ))}
    </>
  );
}
