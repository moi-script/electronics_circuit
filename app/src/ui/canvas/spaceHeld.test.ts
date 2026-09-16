import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isSpaceHeld, useSpaceHeld } from "./spaceHeld";

afterEach(() => cleanup());

function fireKey(type: "keydown" | "keyup", target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent(type, { code: "Space", bubbles: true }));
}

describe("spaceHeld", () => {
  it("sets held on Space keydown and clears on keyup", () => {
    renderHook(() => useSpaceHeld());
    expect(isSpaceHeld()).toBe(false);
    fireKey("keydown");
    expect(isSpaceHeld()).toBe(true);
    fireKey("keyup");
    expect(isSpaceHeld()).toBe(false);
  });

  it("ignores Space typed into an input, textarea, or contenteditable element", () => {
    renderHook(() => useSpaceHeld());

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey("keydown", input);
    expect(isSpaceHeld()).toBe(false);
    input.remove();

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    fireKey("keydown", textarea);
    expect(isSpaceHeld()).toBe(false);
    textarea.remove();

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    fireKey("keydown", editable);
    expect(isSpaceHeld()).toBe(false);
    editable.remove();
  });
});
