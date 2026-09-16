"use client";

import { useSyncExternalStore } from "react";

let held = false;
const listeners = new Set<() => void>();

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  // jsdom does not always compute `isContentEditable`, so check the attribute too.
  return target.isContentEditable || target.closest('[contenteditable="true"]') !== null;
}

function setHeld(next: boolean) {
  if (held === next) return;
  held = next;
  listeners.forEach((listener) => listener());
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code === "Space" && !isEditableTarget(e.target)) setHeld(true);
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === "Space") setHeld(false);
}

let installCount = 0;

/** Installs the window listeners once, shared across every subscriber. */
function install(): () => void {
  if (installCount === 0) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }
  installCount += 1;
  return () => {
    installCount -= 1;
    if (installCount === 0) {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      held = false;
    }
  };
}

function subscribe(callback: () => void): () => void {
  const uninstall = install();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
    uninstall();
  };
}

function getSnapshot(): boolean {
  return held;
}

/** Synchronous read for event handlers (mousedown callbacks etc.); always current. */
export function isSpaceHeld(): boolean {
  return held;
}

/** Reactive: re-renders the caller when Space is pressed or released. */
export function useSpaceHeld(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
