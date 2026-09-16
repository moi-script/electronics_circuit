import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import ComponentBrowser from "./ComponentBrowser";

const state = () => editorStore.getState();
const search = () => screen.getByPlaceholderText("Search components…");
const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent);

beforeEach(() => resetEditor());

describe("ComponentBrowser", () => {
  it("renders nothing when closed", () => {
    render(<ComponentBrowser open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows loading while the library is missing", () => {
    resetEditor(null);
    render(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getByText("Loading parts…")).toBeTruthy();
  });

  it("lists all 15 groups with counts and marks empty ones", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getAllByRole("button", { name: /^group / })).toHaveLength(15);
    expect(screen.getByRole("button", { name: "group Basic" })).toHaveTextContent("7");
    const rf = screen.getByRole("button", { name: "group RF" });
    expect(rf).toHaveTextContent("coming soon");
    expect(rf).toBeDisabled();
  });

  it("opens on the first group and highlights its first part", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "group Sources" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(optionNames()[0]).toBe("AC Current Source");
  });

  it("lists a group's parts by name and shows the highlighted part's details", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    expect(optionNames()).toEqual([
      "Capacitor", "Inductor", "Potentiometer", "Push Button", "Resistor", "SPDT Switch", "SPST Switch",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Resistor" }));
    const details = screen.getByRole("region", { name: "Details" });
    expect(within(details).getByText("Resistance")).toBeTruthy();
    expect(within(details).getByText("1k Ω")).toBeTruthy();
    expect(within(details).getByTestId("pin-1")).toBeTruthy();
    expect(within(details).getByTestId("pin-2")).toBeTruthy();
  });

  it("shows choice defaults by their label", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    fireEvent.click(screen.getByRole("option", { name: "SPST Switch" }));
    expect(within(screen.getByRole("region", { name: "Details" })).getByText("Open")).toBeTruthy();
  });

  it("searches every group and places the highlighted match on Enter", () => {
    const onClose = vi.fn();
    render(<ComponentBrowser open onClose={onClose} />);
    fireEvent.change(search(), { target: { value: "2n2222" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Transistors");
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(state().tool).toEqual({ kind: "place", partId: "transistors.2n2222" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says when nothing matches", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.getByText("No parts match")).toBeTruthy();
  });

  it("moves the highlight with the arrow keys", () => {
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    fireEvent.keyDown(search(), { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Capacitor" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Inductor" })).toHaveAttribute("aria-selected", "true");
  });

  it("places with the Place button and with a double-click", () => {
    const onClose = vi.fn();
    render(<ComponentBrowser open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    fireEvent.click(screen.getByRole("option", { name: "Inductor" }));
    fireEvent.click(screen.getByRole("button", { name: "Place" }));
    expect(state().tool).toEqual({ kind: "place", partId: "basic.inductor" });
    fireEvent.doubleClick(screen.getByRole("option", { name: "Capacitor" }));
    expect(state().tool).toEqual({ kind: "place", partId: "basic.capacitor" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape, the close button and the backdrop without placing", () => {
    const onClose = vi.fn();
    render(<ComponentBrowser open onClose={onClose} />);
    fireEvent.keyDown(search(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(state().tool).toEqual({ kind: "select" });
  });

  it("keeps keyboard focus in the dialog after a mouse click, so Enter still places", async () => {
    const user = userEvent.setup();
    render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Basic" }));
    // A real click moves focus off the input unless the row's mousedown default is prevented.
    await user.click(screen.getByRole("option", { name: "Inductor" }));
    expect(document.activeElement).toBe(search());
    await user.keyboard("{Enter}");
    expect(state().tool).toEqual({ kind: "place", partId: "basic.inductor" });
  });

  it("keeps keyboard focus in the dialog after clicking a group, so Escape still closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ComponentBrowser open onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "group Diodes" }));
    expect(document.activeElement).toBe(search());
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reopens on the last group and part", () => {
    const { rerender } = render(<ComponentBrowser open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "group Diodes" }));
    fireEvent.click(screen.getByRole("option", { name: "LED (red)" }));
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(state().browser).toEqual({ category: "Diodes", partId: "diodes.led" });
    rerender(<ComponentBrowser open={false} onClose={() => {}} />);
    rerender(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "group Diodes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("option", { name: "LED (red)" })).toHaveAttribute("aria-selected", "true");
  });

  it("remembers a search hit's own group, not the previously browsed group", () => {
    const { rerender } = render(<ComponentBrowser open onClose={() => {}} />);
    // Start on "Sources" (the default group), then search for a part that lives elsewhere.
    fireEvent.change(search(), { target: { value: "2n2222" } });
    fireEvent.click(screen.getByRole("option", { name: /2N2222/ }));
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(state().browser).toEqual({ category: "Transistors", partId: "transistors.2n2222" });
    rerender(<ComponentBrowser open={false} onClose={() => {}} />);
    rerender(<ComponentBrowser open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "group Transistors" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("option", { name: /2N2222/ })).toHaveAttribute("aria-selected", "true");
  });
});
