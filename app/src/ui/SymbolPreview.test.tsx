import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { testLibrary } from "@/test/resetEditor";
import SymbolPreview, { fitScale, PIN_LABEL_MARGIN } from "./SymbolPreview";

const part = (id: string) => testLibrary.parts.find((p) => p.manifest.id === id)!;

describe("fitScale", () => {
  it("fits the symbol inside the box minus the margin", () => {
    expect(fitScale(60, 20, 220, 160, 28)).toBeCloseTo(164 / 60);
    expect(fitScale(20, 20, 24, 16, 0)).toBeCloseTo(16 / 20);
  });
});

describe("SymbolPreview", () => {
  it("draws the symbol as an image", () => {
    const { container } = render(<SymbolPreview part={part("basic.resistor")} width={24} height={16} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.queryByTestId("symbol-preview")).toBeNull();
  });

  it("marks and labels every pin at its scaled position", () => {
    render(<SymbolPreview part={part("basic.resistor")} width={220} height={160} showPins />);
    const scale = fitScale(60, 20, 220, 160, PIN_LABEL_MARGIN);
    const left = (220 - 60 * scale) / 2;
    const top = (160 - 20 * scale) / 2;
    const pin2 = screen.getByTestId("pin-2");
    expect(parseFloat(pin2.style.left)).toBeCloseTo(left + 60 * scale);
    expect(parseFloat(pin2.style.top)).toBeCloseTo(top + 10 * scale);
    expect(pin2).toHaveTextContent("2");
    expect(screen.getByTestId("pin-1")).toHaveTextContent("1");
  });

  it("uses pin names when the manifest has them", () => {
    render(<SymbolPreview part={part("diodes.led")} width={220} height={160} showPins />);
    expect(screen.getByTestId("pin-A")).toHaveTextContent("Anode");
    expect(screen.getByTestId("pin-K")).toHaveTextContent("Cathode");
    expect(screen.getByTestId("symbol-preview").querySelectorAll("[data-testid^='pin-']")).toHaveLength(2);
  });
});
