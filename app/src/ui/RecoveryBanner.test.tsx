import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import { editorStore } from "@/model/store";
import { emptyProject } from "@/model/types";
import { resetEditor } from "@/test/resetEditor";
import RecoveryBanner from "./RecoveryBanner";

beforeEach(() => resetEditor());

async function withRecovery() {
  const backend = createMockBackend();
  const project = emptyProject();
  project.components.push({ uid: "c1", part: "basic.resistor", ref: "R1", x: 0, y: 0, rot: 0, mirror: false, params: {} });
  await backend.writeRecovery(project);
  return backend;
}

describe("RecoveryBanner", () => {
  it("shows nothing without a recovery file", async () => {
    await act(async () => { render(<RecoveryBanner backend={createMockBackend()} />); });
    expect(screen.queryByText(/Restore unsaved work/)).toBeNull();
  });

  it("restores the recovered project as unsaved", async () => {
    const backend = await withRecovery();
    await act(async () => { render(<RecoveryBanner backend={backend} />); });
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(editorStore.getState().project.components).toHaveLength(1);
    expect(editorStore.getState()).toMatchObject({ dirty: true, filePath: null });
    expect(screen.queryByText(/Restore unsaved work/)).toBeNull();
  });

  it("discards the recovery file", async () => {
    const backend = await withRecovery();
    await act(async () => { render(<RecoveryBanner backend={backend} />); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Discard" })); });
    expect(await backend.readRecovery()).toBeNull();
    expect(editorStore.getState().project.components).toHaveLength(0);
  });
});
