import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import PartsPanel from "./PartsPanel";

beforeEach(() => resetEditor());

describe("PartsPanel", () => {
  it("shows all 15 categories and marks empty ones", () => {
    render(<PartsPanel />);
    expect(screen.getAllByRole("button", { name: /^category / })).toHaveLength(15);
    expect(screen.getByRole("button", { name: "category RF" })).toHaveTextContent("coming soon");
    expect(screen.getByRole("button", { name: "category Basic" })).not.toHaveTextContent("coming soon");
  });

  it("filters parts by search", () => {
    render(<PartsPanel />);
    fireEvent.change(screen.getByPlaceholderText("Search parts…"), { target: { value: "resist" } });
    expect(screen.getAllByRole("button", { name: /^place / }).map((b) => b.textContent)).toEqual(["Resistor"]);
  });

  it("enters place mode when a part is clicked", () => {
    render(<PartsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "place Capacitor" }));
    expect(editorStore.getState().tool).toEqual({ kind: "place", partId: "basic.capacitor" });
  });
});
