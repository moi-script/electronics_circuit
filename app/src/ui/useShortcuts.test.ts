import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorStore, type EditorStore } from "@/model/store";
import { testLibrary } from "@/test/resetEditor";
import { handleShortcut, type ShortcutActions } from "./useShortcuts";

let store: EditorStore;
let actions: ShortcutActions;
const s = () => store.getState();
const press = (key: string, opts: { ctrl?: boolean; shift?: boolean; target?: EventTarget | null } = {}) =>
  handleShortcut(
    { key, ctrlKey: !!opts.ctrl, metaKey: false, shiftKey: !!opts.shift, target: opts.target ?? document.body },
    store,
    actions,
  );

beforeEach(() => {
  store = createEditorStore({ library: testLibrary });
  actions = { openComponents: vi.fn(), toggleRun: vi.fn() };
  s().placePart("basic.resistor", [0, 0]);
});

describe("handleShortcut", () => {
  it("rotates, mirrors and deletes the selection", () => {
    expect(press("r")).toBe(true);
    expect(press("M")).toBe(true);
    expect(s().project.components[0]).toMatchObject({ rot: 90, mirror: true });
    expect(press("Delete")).toBe(true);
    expect(s().project.components).toHaveLength(0);
  });

  it("undoes and redoes", () => {
    press("z", { ctrl: true });
    expect(s().project.components).toHaveLength(0);
    press("y", { ctrl: true });
    expect(s().project.components).toHaveLength(1);
    press("z", { ctrl: true });
    press("Z", { ctrl: true, shift: true });
    expect(s().project.components).toHaveLength(1);
  });

  it("switches to the wire tool and escapes in two steps", () => {
    press("w");
    s().setTool({ kind: "wire", points: [[0, 0]] });
    press("Escape");
    expect(s().tool).toEqual({ kind: "wire", points: [] });
    press("Escape");
    expect(s().tool).toEqual({ kind: "select" });
    expect(s().selection).toBeNull();
  });

  it("opens the component browser with Ctrl+K and P", () => {
    press("k", { ctrl: true });
    press("p");
    expect(actions.openComponents).toHaveBeenCalledTimes(2);
  });

  it("toggles the plot dock and focus mode", () => {
    press("j", { ctrl: true });
    press("F11");
    expect(s().panels).toMatchObject({ plot: true, focus: true });
  });

  it("has no Ctrl+B shortcut", () => {
    expect(press("b", { ctrl: true })).toBe(false);
  });

  it("toggles the simulation with Ctrl+Enter", () => {
    expect(press("Enter", { ctrl: true })).toBe(true);
    expect(actions.toggleRun).toHaveBeenCalledTimes(1);
  });

  it("uses file actions only when provided", () => {
    expect(press("s", { ctrl: true })).toBe(false);
    actions.save = vi.fn();
    actions.saveAs = vi.fn();
    expect(press("s", { ctrl: true })).toBe(true);
    expect(press("S", { ctrl: true, shift: true })).toBe(true);
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.saveAs).toHaveBeenCalledTimes(1);
  });

  it("ignores keys typed into inputs", () => {
    const input = document.createElement("input");
    expect(press("r", { target: input })).toBe(false);
    expect(s().project.components[0].rot).toBe(0);
  });

  it("ignores every shortcut while the component browser is open", () => {
    actions.isBlocked = () => true;
    expect(press("Delete")).toBe(false);
    expect(s().project.components).toHaveLength(1);
    expect(press("r")).toBe(false);
    expect(s().project.components[0].rot).toBe(0);
    expect(press("k", { ctrl: true })).toBe(false);
    expect(press("z", { ctrl: true })).toBe(false);
    expect(press("Escape")).toBe(false);
  });
});
