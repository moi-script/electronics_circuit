import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import RunButton from "./RunButton";

const actions = () => ({ run: vi.fn(async () => {}), stop: vi.fn(async () => {}), toggle: vi.fn() });

beforeEach(() => resetEditor());

describe("RunButton", () => {
  it("runs, and becomes Stop while running", () => {
    const a = actions();
    const { rerender } = render(<RunButton actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "▶ Run" }));
    expect(a.run).toHaveBeenCalled();
    editorStore.getState().startRun();
    rerender(<RunButton actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "■ Stop" }));
    expect(a.stop).toHaveBeenCalled();
  });

  it("is disabled with the reason when the analysis cannot run", () => {
    editorStore.getState().setAnalysis({ type: "tran", stop: "1m", step: "5m" });
    render(<RunButton actions={actions()} />);
    const button = screen.getByRole("button", { name: "▶ Run" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Max step must not exceed the stop time");
  });

  it("is disabled without a backend", () => {
    render(<RunButton actions={null} />);
    expect(screen.getByRole("button", { name: "▶ Run" })).toBeDisabled();
  });
});
