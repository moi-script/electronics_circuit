import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import ImportDialog from "./ImportDialog";

async function openDialog(backend = createMockBackend()) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(<ImportDialog backend={backend} open onClose={onClose} onImported={onImported} />);
  await screen.findByRole("table", { name: "Import candidates" });
  return { backend, onClose, onImported };
}

const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) });

describe("ImportDialog", () => {
  it("closes without a preview when no files are picked", async () => {
    const backend = createMockBackend();
    backend.pickImportFiles = async () => [];
    const onClose = vi.fn();
    render(<ImportDialog backend={backend} open onClose={onClose} onImported={() => {}} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows candidates with default ticks, statuses and file warnings", async () => {
    await openDialog();
    expect(within(row("DEMO_OPAMP")).getByRole("checkbox")).toBeChecked();
    expect(within(row("DEMO_INPUT")).getByRole("checkbox")).not.toBeChecked();
    const sw = within(row("DEMO_SWITCH"));
    expect(sw.getByRole("checkbox")).toBeDisabled();
    expect(sw.getByText("Unsupported")).toBeTruthy();
    expect(screen.getByText(/not_here\.lib/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import 2 parts" })).toBeEnabled();
  });

  it("ticks, selects all ready, filters and disables import at zero", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Select all ready" }));
    expect(screen.getByRole("button", { name: "Import 3 parts" })).toBeEnabled();
    for (const name of ["DEMO_OPAMP", "DEMO_INPUT", "DEMO_SCHOTTKY"]) fireEvent.click(within(row(name)).getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Import 0 parts" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Filter parts…"), { target: { value: "schott" } });
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + one match
  });

  it("imports with edited categories, reports progress and the result", async () => {
    const { backend, onImported, onClose } = await openDialog();
    const commit = vi.spyOn(backend, "commitImport");
    fireEvent.change(within(row("DEMO_OPAMP")).getByRole("combobox"), { target: { value: "Analog" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 parts" }));
    expect(await screen.findByText("Imported 2 parts")).toBeTruthy();
    const choices = commit.mock.calls[0][1];
    expect(choices.find((c) => c.key === "0:DEMO_OPAMP")).toEqual({ key: "0:DEMO_OPAMP", selected: true, category: "Analog" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ packId: "imported-demo-parts" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("lists failed parts with their log", async () => {
    const backend = createMockBackend();
    backend.commitImport = async () => ({
      packId: null, imported: [], skipped: [], cancelled: false,
      failed: [{ key: "0:DEMO_OPAMP", name: "DEMO_OPAMP", message: "ngspice could not load the model", log: ["unknown subckt"] }],
    });
    await openDialog(backend);
    fireEvent.click(screen.getByRole("button", { name: "Import 2 parts" }));
    expect(await screen.findByText("Imported 0 parts")).toBeTruthy();
    expect(screen.getByText(/ngspice could not load the model/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    expect(screen.getByText("unknown subckt")).toBeTruthy();
  });

  it("shows a preview error", async () => {
    const backend = createMockBackend();
    backend.previewImport = async () => { throw "cannot read demo_parts.lib"; };
    render(<ImportDialog backend={backend} open onClose={() => {}} onImported={() => {}} />);
    expect(await screen.findByText("cannot read demo_parts.lib")).toBeTruthy();
  });
});
