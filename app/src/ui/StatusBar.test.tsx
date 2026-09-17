import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import StatusBar from "./StatusBar";

const state = () => editorStore.getState();

beforeEach(() => resetEditor());

describe("StatusBar problems", () => {
  it("selects erroring parts in turn", () => {
    const a = state().placePart("basic.resistor", [100, 100])!;
    const b = state().placePart("basic.resistor", [300, 100])!;
    state().startRun();
    state().finishRun({
      status: "netlist",
      errors: [
        { code: "unconnected_pin", message: "R1 pin 1 is not connected", componentUid: a, pin: "1" },
        { code: "unconnected_pin", message: "R2 pin 1 is not connected", componentUid: b, pin: "1" },
      ],
    }, state().sim.runId);
    render(<StatusBar />);
    const button = screen.getByRole("button", { name: "2 problems" });
    fireEvent.click(button);
    expect(state().selection).toEqual({ kind: "component", uid: a });
    fireEvent.click(button);
    expect(state().selection).toEqual({ kind: "component", uid: b });
    fireEvent.click(button);
    expect(state().selection).toEqual({ kind: "component", uid: a });
  });
});
