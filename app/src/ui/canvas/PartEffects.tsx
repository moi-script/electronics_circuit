"use client";

import Konva from "konva";
import type { Context } from "konva/lib/Context";
import { useEffect, useRef } from "react";
import { Circle, Shape } from "react-konva";

/** Symbol stroke color for a part destroyed by the run. */
export const CHARRED = "#7a6252";

const EXPLOSION_MS = 1400;

interface Area {
  width: number;
  height: number;
}

/** Soft light around a lit LED; `brightness` is 0..1. */
export function LedGlow({ width, height, brightness, color }: Area & { brightness: number; color: string }) {
  const radius = 14 + 16 * brightness;
  return (
    <>
      <Circle
        x={width / 2 - 2}
        y={height / 2}
        radius={radius}
        opacity={0.35 + 0.65 * brightness}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndRadius={radius}
        fillRadialGradientColorStops={[0, color, 0.35, `${color}aa`, 1, `${color}00`]}
        globalCompositeOperation="lighter"
        listening={false}
      />
      <Circle x={width / 2 - 2} y={height / 2} radius={2 + 2 * brightness} fill="#ffffff" opacity={0.5 * brightness} listening={false} />
    </>
  );
}

/** Burn mark left under a destroyed part. */
export function Scorch({ width, height }: Area) {
  const radius = Math.max(width, height) * 0.6;
  return (
    <Circle
      x={width / 2}
      y={height / 2}
      radius={radius}
      fillRadialGradientStartRadius={0}
      fillRadialGradientEndRadius={radius}
      fillRadialGradientColorStops={[0, "rgba(10,6,4,0.85)", 0.55, "rgba(30,18,10,0.45)", 1, "rgba(30,18,10,0)"]}
      listening={false}
    />
  );
}

/** Deterministic pseudo-random numbers so every explosion of a part looks the same. */
function random(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface Spark { angle: number; speed: number; life: number }
interface Puff { dx: number; delay: number; size: number }

function drawExplosion(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, sparks: Spark[], puffs: Puff[]) {
  const flash = t / 250;
  if (flash < 1) {
    const r = 6 + 44 * flash;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,230,${1 - flash})`);
    g.addColorStop(1, "rgba(255,220,120,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const fire = t / 650;
  if (fire < 1) {
    const r = 8 + 26 * Math.sqrt(fire);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,236,150,${1 - fire})`);
    g.addColorStop(0.4, `rgba(255,140,40,${0.9 * (1 - fire)})`);
    g.addColorStop(1, "rgba(200,40,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineCap = "round";
  for (const spark of sparks) {
    const life = t / spark.life;
    if (life >= 1) continue;
    const s = t / 1000;
    const dist = spark.speed * s;
    const x = cx + Math.cos(spark.angle) * dist;
    const y = cy + Math.sin(spark.angle) * dist + 90 * s * s;
    const tail = Math.min(dist, 7);
    ctx.strokeStyle = `rgba(255,${200 - 120 * life},60,${1 - life})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(spark.angle) * tail, y - Math.sin(spark.angle) * tail);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  for (const puff of puffs) {
    const life = (t - puff.delay) / (EXPLOSION_MS - puff.delay);
    if (life <= 0 || life >= 1) continue;
    const r = puff.size * (0.6 + life);
    ctx.fillStyle = `rgba(90,90,96,${0.45 * (1 - life)})`;
    ctx.beginPath();
    ctx.arc(cx + puff.dx * (1 + life), cy - 34 * life, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** One-shot burst of flash, fire, sparks and smoke. Replays whenever `runId` changes. */
export function Explosion({ width, height, runId, seed }: Area & { runId: number; seed: number }) {
  const shape = useRef<Konva.Shape>(null);
  const started = useRef(0);
  const rand = random(seed);
  const sparks = useRef<Spark[]>(Array.from({ length: 16 }, () => ({ angle: rand() * Math.PI * 2, speed: 50 + rand() * 90, life: 450 + rand() * 450 })));
  const puffs = useRef<Puff[]>(Array.from({ length: 6 }, () => ({ dx: (rand() - 0.5) * 16, delay: 150 + rand() * 350, size: 5 + rand() * 5 })));

  useEffect(() => {
    const node = shape.current;
    const layer = node?.getLayer();
    if (!node || !layer) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      started.current = -Infinity;
      layer.batchDraw();
      return;
    }
    started.current = performance.now();
    const animation = new Konva.Animation(() => {
      if (performance.now() - started.current > EXPLOSION_MS) {
        animation.stop();
      }
    }, layer);
    animation.start();
    return () => {
      animation.stop();
    };
  }, [runId]);

  return (
    <Shape
      ref={shape}
      listening={false}
      sceneFunc={(context: Context) => {
        const t = performance.now() - started.current;
        if (t > EXPLOSION_MS) return;
        const ctx = context._context;
        ctx.save();
        drawExplosion(ctx, t, width / 2, height / 2, sparks.current, puffs.current);
        ctx.restore();
      }}
    />
  );
}
