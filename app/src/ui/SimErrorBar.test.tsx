import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import SimErrorBar from "./SimErrorBar";

const state = () => editorStore.getState();

beforeEach(() => resetEditor());

describe("SimErrorBar", () => {
  it("is hidden without a failure", () => {
    render(<SimErrorBar />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows engine advice with an expandable log, and closes", () => {
    state().startRun();
    state().finishRun({ status: "engine", message: "m", log: ["stderr Error: timestep too small"] });
    render(<SimErrorBar />);
    expect(screen.getByRole("alert")).toHaveTextContent("The simulation didn't converge. Try a smaller max step.");
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    expect(screen.getByText("stderr Error: timestep too small")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows circuit-wide netlist problems and hides when outdated", () => {
    state().startRun();
    state().finishRun({ status: "netlist", errors: [{ code: "no_ground", message: "The circuit has no ground. Add a Ground part.", componentUid: null }] });
    render(<SimErrorBar />);
    expect(screen.getByRole("alert")).toHaveTextContent("no ground");
    act(() => state().setAnalysis({ type: "op" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
