import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import CommandPalette from "./CommandPalette";

beforeEach(() => resetEditor());

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    render(<CommandPalette open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("places the best match on Enter", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search parts to place…");
    fireEvent.change(input, { target: { value: "cap" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editorStore.getState().tool).toEqual({ kind: "place", partId: "basic.capacitor" });
    expect(onClose).toHaveBeenCalled();
  });

  it("moves through results with the arrow keys", () => {
    render(<CommandPalette open onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Search parts to place…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editorStore.getState().tool).toEqual({ kind: "place", partId: "diodes.1n4148" });
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Search parts to place…"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
