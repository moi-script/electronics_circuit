import { describe, expect, it } from "vitest";
import { parseSi } from "./si";

const value = (s: string) => {
  const r = parseSi(s);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r.value;
};
const close = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-12;

describe("parseSi (mirrors multysm-core si::parse_si)", () => {
  it("parses plain numbers", () => {
    expect(value("10")).toBe(10);
    expect(value(" -2.5 ")).toBe(-2.5);
    expect(value(".5")).toBe(0.5);
    expect(value("1e3")).toBe(1000);
  });

  it("applies scale suffixes with SPICE-friendly case rules", () => {
    expect(value("4.7k")).toBe(4700);
    expect(close(value("2meg"), 2e6)).toBe(true);
    expect(close(value("2M"), 2e6)).toBe(true);
    expect(close(value("5m"), 5e-3)).toBe(true);
    expect(close(value("10u"), 1e-5)).toBe(true);
    expect(close(value("10µ"), 1e-5)).toBe(true);
    expect(close(value("100n"), 1e-7)).toBe(true);
    expect(close(value("22p"), 22e-12)).toBe(true);
    expect(close(value("3f"), 3e-15)).toBe(true);
    expect(close(value("1G"), 1e9)).toBe(true);
  });

  it("ignores units", () => {
    expect(close(value("10uF"), 1e-5)).toBe(true);
    expect(value("1F")).toBe(1);
    expect(value("1kΩ")).toBe(1000);
    expect(value("60Hz")).toBe(60);
  });

  it("rejects bad input with a message", () => {
    for (const bad of ["", "   ", "abc", "-", ".", "1e400"]) {
      const r = parseSi(bad);
      expect(r.ok, bad).toBe(false);
    }
  });
});
