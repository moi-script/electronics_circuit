import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import ManageImports from "./ManageImports";

async function withOneImport() {
  const backend = createMockBackend();
  const preview = await backend.previewImport(["demo_parts.lib"]);
  await backend.commitImport(preview.previewId, preview.candidates.map((c) => ({ key: c.key, selected: c.selected, category: c.category })), () => {});
  return backend;
}

describe("ManageImports", () => {
  it("says when nothing is imported", async () => {
    render(<ManageImports backend={createMockBackend()} open onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText("No imported parts yet.")).toBeTruthy();
  });

  it("lists packs and removes one", async () => {
    const backend = await withOneImport();
    const onChanged = vi.fn();
    render(<ManageImports backend={backend} open onClose={() => {}} onChanged={onChanged} />);
    expect(await screen.findByText("demo_parts.lib")).toBeTruthy();
    expect(screen.getByText("2 parts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove demo_parts.lib" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText("No imported parts yet.")).toBeTruthy();
  });
});
