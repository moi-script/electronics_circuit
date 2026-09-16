"use client";

import { Text } from "react-konva";
import type { CanvasLabel } from "@/model/results";
import { tokens } from "@/theme/tokens";

export default function OpLabels({ labels, zoom }: { labels: CanvasLabel[]; zoom: number }) {
  const scale = 1 / zoom;
  return (
    <>
      {labels.map((label) => (
        <Text
          key={label.key}
          x={label.point[0]}
          y={label.point[1]}
          offsetY={10}
          scaleX={scale}
          scaleY={scale}
          text={label.text}
          fontSize={10}
          fontFamily="Segoe UI, system-ui, sans-serif"
          fill={label.tone === "meter" ? tokens.accent : tokens.muted}
          listening={false}
        />
      ))}
    </>
  );
}
