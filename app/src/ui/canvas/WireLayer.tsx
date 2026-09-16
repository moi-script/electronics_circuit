"use client";

import { useMemo } from "react";
import { Circle, Line } from "react-konva";
import { editorStore, type Selection } from "@/model/store";
import type { PartDef, Project } from "@/model/types";
import { danglingEnds, junctionPoints } from "@/model/wiring";
import { tokens } from "@/theme/tokens";
import { isSpaceHeld } from "./spaceHeld";

interface Props {
  project: Project;
  parts: Map<string, PartDef>;
  selection: Selection;
  selectable: boolean;
}

export default function WireLayer({ project, parts, selection, selectable }: Props) {
  const junctions = useMemo(() => junctionPoints(project, parts), [project, parts]);
  const dangling = useMemo(() => danglingEnds(project, parts), [project, parts]);
  return (
    <>
      {project.wires.map((wire) => {
        const selected = selection?.kind === "wire" && selection.uid === wire.uid;
        return (
          <Line
            key={wire.uid}
            points={wire.points.flat()}
            stroke={selected ? tokens.selected : tokens.wire}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            hitStrokeWidth={10}
            lineCap="round"
            lineJoin="round"
            listening={selectable}
            onMouseDown={(e) => {
              if (e.evt.button !== 0) return;
              if (isSpaceHeld()) return; // let the click bubble to the Stage so Space+drag can pan
              e.cancelBubble = true;
              editorStore.getState().select({ kind: "wire", uid: wire.uid });
            }}
          />
        );
      })}
      {junctions.map(([x, y]) => (
        <Circle key={`j${x},${y}`} x={x} y={y} radius={3} fill={tokens.wire} listening={false} />
      ))}
      {dangling.map(([x, y]) => (
        <Circle key={`d${x},${y}`} x={x} y={y} radius={2.5} stroke={tokens.error} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      ))}
    </>
  );
}
