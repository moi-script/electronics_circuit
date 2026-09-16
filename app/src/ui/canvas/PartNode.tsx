"use client";

import { Circle, Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { partBounds, snapPoint } from "@/model/geometry";
import { editorStore } from "@/model/store";
import type { ComponentInstance, PartDef } from "@/model/types";
import { tokens } from "@/theme/tokens";
import { useSymbolImage } from "./symbolImage";

interface Props {
  inst: ComponentInstance;
  part: PartDef;
  selected: boolean;
  /** Clickable and draggable (select tool only). */
  interactive: boolean;
  ghost?: boolean;
}

export default function PartNode({ inst, part, selected, interactive, ghost = false }: Props) {
  const { width, height, pins } = part.manifest.symbol;
  const image = useSymbolImage(part.svg, selected ? tokens.selected : tokens.text, width, height);
  const bounds = partBounds(inst, part.manifest.symbol);
  const firstParam = part.manifest.params[0];
  const label = firstParam ? `${inst.ref} ${inst.params[firstParam.key] ?? firstParam.default}` : inst.ref;

  return (
    <>
      <Group
        x={inst.x}
        y={inst.y}
        rotation={inst.rot}
        scaleX={inst.mirror ? -1 : 1}
        opacity={ghost ? 0.5 : 1}
        listening={interactive}
        draggable={interactive}
        onMouseDown={(e) => {
          if (e.evt.button !== 0) return; // let middle-drag pan the stage
          e.cancelBubble = true;
          editorStore.getState().select({ kind: "component", uid: inst.uid });
        }}
        onDragStart={() => {
          const state = editorStore.getState();
          state.select({ kind: "component", uid: inst.uid });
          state.beginChange();
        }}
        onDragMove={(e) => {
          const [x, y] = snapPoint([e.target.x(), e.target.y()]);
          e.target.position({ x, y });
          editorStore.getState().moveComponent(inst.uid, [x, y]);
        }}
      >
        <Rect width={width} height={height} fill="rgba(0,0,0,0)" />
        {image && <KonvaImage image={image} width={width} height={height} listening={false} />}
        {pins.map((pin) => (
          <Circle key={pin.id} x={pin.x} y={pin.y} radius={1.5} fill={tokens.muted} listening={false} />
        ))}
      </Group>
      {!ghost && (
        <Text
          x={bounds.x}
          y={bounds.y - 14}
          text={label}
          fontSize={11}
          fontFamily="Segoe UI, system-ui, sans-serif"
          fill={selected ? tokens.selected : tokens.muted}
          listening={false}
        />
      )}
    </>
  );
}
