import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor, testLibrary } from "@/test/resetEditor";
import type { PartDef } from "@/model/types";
import PropertiesPanel from "./PropertiesPanel";

const state = () => editorStore.getState();
let uid: string;

beforeEach(() => {
  resetEditor();
  uid = state().placePart("basic.resistor", [0, 0])!;
});

describe("PropertiesPanel", () => {
  it("shows the selected part with its defaults", () => {
    render(<PropertiesPanel />);
    expect(screen.getByText("Resistor")).toBeTruthy();
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe("R1");
    expect((screen.getByLabelText("Resistance") as HTMLInputElement).value).toBe("1k");
  });

  it("commits a valid SI value on Enter", () => {
    render(<PropertiesPanel />);
    const input = screen.getByLabelText("Resistance");
    fireEvent.change(input, { target: { value: "4.7k" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(state().project.components[0].params.resistance).toBe("4.7k");
  });

  it("shows an error and does not commit an invalid value", () => {
    render(<PropertiesPanel />);
    const input = screen.getByLabelText("Resistance");
    fireEvent.change(input, { target: { value: "lots" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("not a number");
    expect(state().project.components[0].params.resistance).toBeUndefined();
  });

  it("validates references", () => {
    render(<PropertiesPanel />);
    const input = screen.getByLabelText("Reference");
    fireEvent.change(input, { target: { value: "1R" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("letter");
    expect(state().project.components[0].ref).toBe("R1");
    fireEvent.change(input, { target: { value: "RLOAD" } });
    fireEvent.blur(input);
    expect(state().project.components[0].ref).toBe("RLOAD");
  });

  it("follows an external change to the same param", () => {
    render(<PropertiesPanel />);
    act(() => state().setParam(uid, "resistance", "4.7k"));
    expect((screen.getByLabelText("Resistance") as HTMLInputElement).value).toBe("4.7k");
  });

  it("does not re-apply a stale value after undo", () => {
    render(<PropertiesPanel />);
    const input = screen.getByLabelText("Resistance") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4.7k" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(state().project.components[0].params.resistance).toBe("4.7k");

    // undo() also clears selection (store.ts, unchanged here), which would
    // unmount this panel entirely and trivially "pass" without exercising the
    // bug. Re-selecting the same component in the same act() batch keeps the
    // Field instance mounted through the revert, matching the finding's
    // "the panel stays mounted" premise, so the stale value is still in local
    // state when blur happens next.
    act(() => {
      state().undo();
      state().select({ kind: "component", uid });
    });
    expect(state().project.components[0].params.resistance).toBeUndefined();
    expect(screen.getByLabelText("Resistance")).toBe(input);

    fireEvent.blur(input);
    expect(state().project.components[0].params.resistance).toBeUndefined();
    expect(input.value).toBe("1k");
  });

  it("rotates, mirrors and deletes from buttons", () => {
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("button", { name: "Mirror" }));
    expect(state().project.components[0]).toMatchObject({ rot: 90, mirror: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(state().project.components.find((c) => c.uid === uid)).toBeUndefined();
  });

  it("edits a choice param with a select", () => {
    const testSwitch: PartDef = {
      svg: "<svg/>",
      refPrefix: "S",
      manifest: {
        schema: 1, id: "basic.test_switch", name: "Test Switch", category: "Basic", tags: [],
        symbol: { width: 60, height: 20, svg: "s.svg", pins: [{ id: "1", x: 0, y: 10 }, { id: "2", x: 60, y: 10 }] },
        params: [{
          key: "closed", label: "State", default: "0", type: "choice",
          options: [{ label: "Open", value: "0" }, { label: "Closed", value: "1" }],
        }],
        spice: { kind: "analog", refPrefix: "S", template: "X{ref} {pin.1} {pin.2} SW_SPST PARAMS: S={closed}" },
      },
    };
    resetEditor({ ...testLibrary, parts: [...testLibrary.parts, testSwitch] });
    const id = state().placePart("basic.test_switch", [100, 100])!;
    render(<PropertiesPanel />);
    const select = screen.getByLabelText("State") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("0");
    expect(screen.getByRole("option", { name: "Closed" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "1" } });
    expect(state().project.components.find((c) => c.uid === id)!.params.closed).toBe("1");
  });
});
