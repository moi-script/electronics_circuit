import { describe, expect, it } from "vitest";
import { formatValue } from "./format";

describe("formatValue", () => {
  it("uses three significant figures and engineering prefixes", () => {
    expect(formatValue(4.9712, "V")).toBe("4.97 V");
    expect(formatValue(0.0033, "V")).toBe("3.30 mV");
    expect(formatValue(-12, "V")).toBe("−12.0 V");
    expect(formatValue(0, "V")).toBe("0 V");
    expect(formatValue(0.005, "A")).toBe("5.00 mA");
    expect(formatValue(1e5, "Hz")).toBe("100 kHz");
    expect(formatValue(2.2e-7, "s")).toBe("220 ns");
    expect(formatValue(0.99996, "V")).toBe("1.00 V");
    expect(formatValue(999.96, "Hz")).toBe("1.00 kHz");
  });

  it("can trim trailing zeros", () => {
    expect(formatValue(0.01, "s", { trim: true })).toBe("10 ms");
    expect(formatValue(10, "Hz", { trim: true })).toBe("10 Hz");
    expect(formatValue(2.5e-3, "s", { trim: true })).toBe("2.5 ms");
  });

  it("handles non-finite values", () => {
    expect(formatValue(Number.NaN, "V")).toBe("— V");
  });
});
