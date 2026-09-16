"use client";

import { useEffect, useMemo, useState } from "react";

/** Symbols are rasterized at 4x (MAX_ZOOM) so they stay crisp when zoomed in. */
export const RASTER_SCALE = 4;

export function symbolDataUrl(svg: string, color: string, width: number, height: number): string {
  const sized = svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) =>
    `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="${width}" height="${height}">`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized.replaceAll("currentColor", color))}`;
}

const cache = new Map<string, HTMLImageElement>();

export function useSymbolImage(svg: string, color: string, width: number, height: number) {
  const url = useMemo(
    () => symbolDataUrl(svg, color, width * RASTER_SCALE, height * RASTER_SCALE),
    [svg, color, width, height],
  );
  const [loaded, setLoaded] = useState<HTMLImageElement | undefined>(undefined);

  useEffect(() => {
    let image = cache.get(url);
    if (!image) {
      image = new window.Image();
      image.src = url;
      cache.set(url, image);
    }
    if (image.complete && image.naturalWidth > 0) {
      setLoaded(image);
      return;
    }
    const target = image;
    const onLoad = () => setLoaded(target);
    target.addEventListener("load", onLoad);
    return () => target.removeEventListener("load", onLoad);
  }, [url]);

  return loaded && loaded.src === url ? loaded : undefined;
}
