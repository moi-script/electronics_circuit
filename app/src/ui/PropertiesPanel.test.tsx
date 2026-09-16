import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
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

  it("rotates, mirrors and deletes from buttons", () => {
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("button", { name: "Mirror" }));
    expect(state().project.components[0]).toMatchObject({ rot: 90, mirror: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(state().project.components.find((c) => c.uid === uid)).toBeUndefined();
  });
});
