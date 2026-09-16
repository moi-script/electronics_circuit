import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import AnalysisPicker from "./AnalysisPicker";

const state = () => editorStore.getState();
const open = () => fireEvent.click(screen.getByRole("button", { name: /Transient|Operating point|AC ·|DC sweep/ }));

beforeEach(() => resetEditor());

describe("AnalysisPicker", () => {
  it("shows the current analysis and opens the settings", () => {
    render(<AnalysisPicker />);
    expect(screen.getByRole("button", { name: "Transient · 10 ms" })).toBeTruthy();
    open();
    expect(screen.getByRole("dialog", { name: "Analysis" })).toBeTruthy();
    expect((screen.getByLabelText("Stop time") as HTMLInputElement).value).toBe("10m");
  });

  it("switches analysis type with defaults and remembers typed values", () => {
    render(<AnalysisPicker />);
    open();
    const stop = screen.getByLabelText("Stop time");
    fireEvent.change(stop, { target: { value: "20m" } });
    fireEvent.keyDown(stop, { key: "Enter" });
    expect(state().project.analysis).toEqual({ type: "tran", stop: "20m", step: "10u" });
    fireEvent.click(screen.getByLabelText("AC sweep"));
    expect(state().project.analysis).toEqual({ type: "ac", start: "10", stop: "100k", pointsPerDecade: 10 });
    expect(screen.getByRole("button", { name: "AC · 10 Hz–100 kHz" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Transient"));
    expect(state().project.analysis).toEqual({ type: "tran", stop: "20m", step: "10u" });
  });

  it("does not commit invalid values and shows why", () => {
    render(<AnalysisPicker />);
    open();
    const stop = screen.getByLabelText("Stop time");
    fireEvent.change(stop, { target: { value: "abc" } });
    fireEvent.blur(stop);
    expect(screen.getByRole("alert")).toHaveTextContent("not a number");
    expect(state().project.analysis).toEqual({ type: "tran", stop: "10m", step: "10u" });
  });

  it("explains settings that cannot run", () => {
    render(<AnalysisPicker />);
    open();
    const step = screen.getByLabelText("Max step");
    fireEvent.change(step, { target: { value: "1" } });
    fireEvent.keyDown(step, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("Max step must not exceed the stop time");
  });

  it("lists DC sources and says when there are none", () => {
    render(<AnalysisPicker />);
    open();
    fireEvent.click(screen.getByLabelText("DC sweep"));
    expect(screen.getByRole("status")).toHaveTextContent("Add a DC voltage or current source to sweep.");
    state().placePart("sources.dc_voltage", [0, 0]);
    fireEvent.click(screen.getByLabelText("Operating point"));
    fireEvent.click(screen.getByLabelText("DC sweep"));
    const source = screen.getByLabelText("Source") as HTMLSelectElement;
    fireEvent.change(source, { target: { value: "V1" } });
    expect(state().project.analysis).toMatchObject({ type: "dc", source: "V1" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes with Done and Escape", () => {
    render(<AnalysisPicker />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
