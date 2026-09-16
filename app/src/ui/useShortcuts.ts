"use client";

import { useEffect, useRef } from "react";
import { editorStore, type EditorStore } from "@/model/store";

export interface ShortcutActions {
  openComponents(): void;
  newFile?(): void;
  open?(): void;
  save?(): void;
  saveAs?(): void;
  toggleRun?(): void;
  /** When true, no shortcut is handled (e.g. the component browser modal owns the keyboard). */
  isBlocked?(): boolean;
}

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

const run = (action?: () => void) => {
  action?.();
  return action !== undefined;
};

/** Applies a keyboard shortcut. Returns true when handled (the caller prevents the default). */
export function handleShortcut(e: KeyInput, store: EditorStore, actions: ShortcutActions): boolean {
  if (isTyping(e.target)) return false;
  if (actions.isBlocked?.()) return false;
  const s = store.getState();
  const key = e.key.toLowerCase();

  if (e.ctrlKey || e.metaKey) {
    switch (key) {
      case "k": actions.openComponents(); return true;
      case "z": if (e.shiftKey) s.redo(); else s.undo(); return true;
      case "y": s.redo(); return true;
      case "c": s.copySelected(); return true;
      case "v": s.paste(); return true;
      case "i": s.togglePanel("properties"); return true;
      case "j": s.togglePanel("plot"); return true;
      case "n": return run(actions.newFile);
      case "o": return run(actions.open);
      case "s": return e.shiftKey ? run(actions.saveAs) : run(actions.save);
      case "enter": return run(actions.toggleRun);
      default: return false;
    }
  }

  switch (e.key) {
    case "F11":
      s.togglePanel("focus");
      return true;
    case "Escape":
      if (s.tool.kind === "wire" && s.tool.points.length > 0) {
        s.setTool({ kind: "wire", points: [] });
      } else {
        s.setTool({ kind: "select" });
        s.select(null);
      }
      return true;
    case "Delete":
    case "Backspace":
      s.deleteSelected();
      return true;
  }

  switch (key) {
    case "p": actions.openComponents(); return true;
    case "w": s.setTool({ kind: "wire", points: [] }); return true;
    case "r": s.rotateSelected(); return true;
    case "m": s.mirrorSelected(); return true;
    default: return false;
  }
}

export function useShortcuts(actions: ShortcutActions) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (handleShortcut(e, editorStore, latest.current)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
