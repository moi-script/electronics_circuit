"use client";

import type { CSSProperties } from "react";
import type { PartDef } from "@/model/types";
import { tokens } from "@/theme/tokens";
import { symbolDataUrl } from "./canvas/symbolImage";

/** Space kept around the symbol for pin labels when pins are shown. */
export const PIN_LABEL_MARGIN = 28;

export function fitScale(symbolWidth: number, symbolHeight: number, boxWidth: number, boxHeight: number, margin: number): number {
  return Math.min((boxWidth - 2 * margin) / symbolWidth, (boxHeight - 2 * margin) / symbolHeight);
}

/** Puts a pin label outside the symbol, on the side the pin sits on. */
function labelStyle(x: number, y: number, width: number, height: number): CSSProperties {
  if (x <= 0) return { right: 5, top: -7 };
  if (x >= width) return { left: 5, top: -7 };
  if (y <= 0) return { left: 4, bottom: 2 };
  if (y >= height) return { left: 4, top: 2 };
  return { left: 5, top: -7 };
}

export default function SymbolPreview({ part, width, height, showPins = false }: {
  part: PartDef;
  width: number;
  height: number;
  showPins?: boolean;
}) {
  const { width: symbolWidth, height: symbolHeight, pins } = part.manifest.symbol;
  const scale = fitScale(symbolWidth, symbolHeight, width, height, showPins ? PIN_LABEL_MARGIN : 0);
  const drawnWidth = symbolWidth * scale;
  const drawnHeight = symbolHeight * scale;
  const left = (width - drawnWidth) / 2;
  const top = (height - drawnHeight) / 2;
  // Rasterize at 2x so the preview stays sharp on high-DPI screens.
  const src = symbolDataUrl(part.svg, tokens.text, Math.max(1, Math.round(drawnWidth * 2)), Math.max(1, Math.round(drawnHeight * 2)));

  return (
    <div className="relative shrink-0" style={{ width, height }} data-testid={showPins ? "symbol-preview" : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
      <img alt="" src={src} draggable={false} className="absolute" style={{ left, top, width: drawnWidth, height: drawnHeight }} />
      {showPins && pins.map((pin) => (
        <div
          key={pin.id}
          data-testid={`pin-${pin.id}`}
          className="absolute"
          style={{ left: left + pin.x * scale, top: top + pin.y * scale }}
        >
          <span className="absolute block h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
          <span
            className="absolute whitespace-nowrap text-[10px] leading-none text-muted"
            style={labelStyle(pin.x, pin.y, symbolWidth, symbolHeight)}
          >
            {pin.name ?? pin.id}
          </span>
        </div>
      ))}
    </div>
  );
}
