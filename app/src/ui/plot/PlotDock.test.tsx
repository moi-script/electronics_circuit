import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dividerProject } from "@/test/fixtures";
import { mockSimulate } from "@/backend/mockSimulation";
import { editorStore } from "@/model/store";
import { probeRef } from "@/model/signals";
import { resetEditor, testLibrary } from "@/test/resetEditor";
import PlotDock from "./PlotDock";

vi.mock("./Chart", () => ({
  default: (props: { series: { label: string; color: string }[]; logX: boolean }) => (
    <div data-testid="chart" data-log={String(props.logX)}>{props.series.map((s) => `${s.label}=${s.color}`).join(",")}</div>
  ),
}));

const state = () => editorStore.getState();

function runMock() {
  const outcome = mockSimulate(state().project, testLibrary);
  state().startRun();
  state().finishRun(outcome);
}

beforeEach(() => {
  resetEditor();
  state().loadProject(dividerProject(), null);
});

describe("PlotDock", () => {
  it("invites a run when there is no result", () => {
    render(<PlotDock />);
    expect(screen.getByText("Run a transient, AC or DC sweep to see a plot.")).toBeTruthy();
  });

  it("says where operating-point values are", () => {
    state().setAnalysis({ type: "op" });
    runMock();
    render(<PlotDock />);
    expect(screen.getByText("Operating point: values are shown on the wires.")).toBeTruthy();
  });

  it("lists signals and plots ticked ones, saving probes", () => {
    runMock();
    render(<PlotDock />);
    expect(screen.getByText("Tick a signal to plot it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "V(R1:2)" }));
    expect(state().project.probes).toEqual([probeRef("c2", "2")]);
    expect(screen.getByTestId("chart")).toHaveTextContent("V(R1:2)=#5fb3a8");
    fireEvent.click(screen.getByRole("checkbox", { name: "I(V1)" }));
    expect(screen.getByTestId("chart")).toHaveTextContent("V(R1:2)=#5fb3a8,I(V1)=#d9a35f");
    expect(state().sim.stale).toBe(false);
  });

  it("dims and badges outdated results", () => {
    runMock();
    render(<PlotDock />);
    act(() => state().setParam("c2", "resistance", "2k"));
    expect(screen.getByText("outdated")).toBeTruthy();
  });

  it("offers magnitude and phase for AC", () => {
    state().setAnalysis({ type: "ac", start: "10", stop: "100k", pointsPerDecade: 10 });
    runMock();
    render(<PlotDock />);
    fireEvent.click(screen.getByRole("checkbox", { name: "V(R1:2)" }));
    expect(screen.getByTestId("chart")).toHaveAttribute("data-log", "true");
    expect(screen.getByRole("button", { name: "Mag" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Phase" }));
    expect(screen.getByRole("button", { name: "Phase" })).toHaveAttribute("aria-pressed", "true");
  });
});
