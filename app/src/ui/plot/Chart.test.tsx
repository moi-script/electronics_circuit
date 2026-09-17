import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Chart, { type ChartSeries } from "./Chart";

const instances: { setData: ReturnType<typeof vi.fn>; setSize: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];

vi.mock("uplot", () => ({
  default: class FakeUPlot {
    setData = vi.fn();
    setSize = vi.fn();
    destroy = vi.fn();
    constructor() {
      instances.push(this as unknown as (typeof instances)[number]);
    }
  },
}));

vi.mock("uplot/dist/uPlot.min.css", () => ({}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

const series = (label: string, values: number[]): ChartSeries => ({ key: label, label, unit: "V", color: "#5fb3a8", values });

describe("Chart", () => {
  it("creates one uPlot instance and pushes new data via setData instead of recreating", () => {
    const { rerender } = render(<Chart x={[0, 1]} xUnit="s" logX={false} series={[series("a", [1, 2])]} />);
    expect(instances).toHaveLength(1);

    // Same structure (keys/units/colors/axes), new values: should reuse the instance.
    rerender(<Chart x={[0, 1, 2]} xUnit="s" logX={false} series={[series("a", [1, 2, 3])]} />);
    expect(instances).toHaveLength(1);
    expect(instances[0].setData).toHaveBeenCalledWith([[0, 1, 2], [1, 2, 3]]);
    expect(instances[0].destroy).not.toHaveBeenCalled();

    // A structural change (a new ticked series) should rebuild the plot.
    rerender(<Chart x={[0, 1, 2]} xUnit="s" logX={false} series={[series("a", [1, 2, 3]), series("b", [4, 5, 6])]} />);
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
  });
});
