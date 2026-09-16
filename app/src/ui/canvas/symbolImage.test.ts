import { describe, expect, it } from "vitest";
import { symbolDataUrl } from "./symbolImage";

const decode = (url: string) => decodeURIComponent(url.slice("data:image/svg+xml;charset=utf-8,".length));

describe("symbolDataUrl", () => {
  it("recolors currentColor and sets the raster size", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20" stroke="currentColor"><path d="M0 10h60"/></svg>';
    const out = decode(symbolDataUrl(svg, "#c9ced8", 240, 80));
    expect(out).toContain('stroke="#c9ced8"');
    expect(out).not.toContain("currentColor");
    expect(out).toMatch(/^<svg[^>]* width="240" height="80"/);
  });

  it("replaces existing width and height attributes", () => {
    const out = decode(symbolDataUrl('<svg width="10" height="5" viewBox="0 0 10 5"></svg>', "#fff", 40, 20));
    expect(out.match(/width=/g)).toHaveLength(1);
    expect(out).toContain('width="40" height="20"');
  });
});
