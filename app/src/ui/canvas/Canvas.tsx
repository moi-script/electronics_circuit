"use client";

import type Konva from "konva";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Layer, Stage } from "react-konva";
import { snapPoint } from "@/model/geometry";
import { editorStore, useEditor } from "@/model/store";
import type { Point } from "@/model/types";
import { partMap } from "@/model/wiring";
import PartNode from "./PartNode";
import { isSpaceHeld, useSpaceHeld } from "./spaceHeld";
import WireLayer from "./WireLayer";
import { gridStyle, screenToWorld, zoomAt } from "./viewport";

function useElementSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export default function Canvas() {
  const container = useRef<HTMLDivElement>(null);
  const size = useElementSize(container);
  // Reactive so children (parts/wires) re-render and drop `draggable` before a Space+drag pan starts.
  useSpaceHeld();
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const parts = useMemo(() => partMap(library), [library]);
  const zoom = project.view?.zoom ?? 1;
  const pan: Point = project.view?.pan ?? [0, 0];
  const [pointer, setPointer] = useState<Point | null>(null);
  const panStart = useRef<{ mouse: Point; pan: Point } | null>(null);

  const worldPointer = (stage: Konva.Stage | null): Point | null => {
    const p = stage?.getPointerPosition();
    return p ? screenToWorld([p.x, p.y], zoom, pan) : null;
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = e.target.getStage()?.getPointerPosition();
    if (!p) return;
    const next = zoomAt(zoom, pan, [p.x, p.y], e.evt.deltaY);
    editorStore.getState().setView(next.zoom, next.pan);
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && isSpaceHeld())) {
      e.evt.preventDefault();
      panStart.current = { mouse: [e.evt.clientX, e.evt.clientY], pan };
      return;
    }
    if (e.evt.button !== 0) return;
    const world = worldPointer(e.target.getStage());
    if (!world) return;
    const state = editorStore.getState();
    if (state.tool.kind === "place") {
      state.placePart(state.tool.partId, world);
    } else if (state.tool.kind === "select" && e.target === e.target.getStage()) {
      state.select(null);
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const start = panStart.current;
    if (start) {
      editorStore.getState().setView(zoom, [
        start.pan[0] + e.evt.clientX - start.mouse[0],
        start.pan[1] + e.evt.clientY - start.mouse[1],
      ]);
      return;
    }
    setPointer(worldPointer(e.target.getStage()));
  };

  const endPan = () => {
    panStart.current = null;
  };

  const placing = tool.kind === "place" ? parts.get(tool.partId) : undefined;
  const ghostAt = pointer && snapPoint(pointer);

  return (
    <div
      ref={container}
      data-testid="canvas"
      className="h-full w-full overflow-hidden"
      style={gridStyle(zoom, pan)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={pan[0]}
          y={pan[1]}
          scaleX={zoom}
          scaleY={zoom}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endPan}
          onMouseLeave={() => {
            endPan();
            setPointer(null);
          }}
        >
          <Layer>
            <WireLayer project={project} parts={parts} selection={selection} selectable={tool.kind === "select"} />
            {project.components.map((inst) => {
              const part = parts.get(inst.part);
              return part ? (
                <PartNode
                  key={inst.uid}
                  inst={inst}
                  part={part}
                  selected={selection?.kind === "component" && selection.uid === inst.uid}
                  interactive={tool.kind === "select"}
                />
              ) : null;
            })}
            {placing && ghostAt && (
              <PartNode
                inst={{ uid: "ghost", part: placing.manifest.id, ref: "", x: ghostAt[0], y: ghostAt[1], rot: 0, mirror: false, params: {} }}
                part={placing}
                selected={false}
                interactive={false}
                ghost
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
