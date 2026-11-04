import { expect, test } from "@playwright/test";

type Store = { getState(): { library: unknown; tool: { kind: string; partId?: string } } };

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => {
      const store = (window as unknown as { __multysm?: Store }).__multysm;
      return !!store && store.getState().library !== null;
    }))
    .toBe(true);
});

test("imports parts from a SPICE file and places one", async ({ page }) => {
  await page.getByRole("button", { name: "Components" }).click();
  await page.getByRole("button", { name: "Import parts…" }).click();

  const dialog = page.getByRole("dialog", { name: "Import parts" });
  await expect(dialog.getByRole("row", { name: /DEMO_OPAMP/ })).toBeVisible();
  await dialog.getByLabel("Category for DEMO_OPAMP").selectOption("Analog");
  await dialog.getByRole("button", { name: "Import 2 parts" }).click();
  await expect(dialog.getByText("Imported 2 parts")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  const browser = page.getByRole("dialog", { name: "Add component" });
  await browser.getByRole("button", { name: "group Analog" }).click();
  const option = browser.getByRole("option", { name: /DEMO_OPAMP/ });
  await expect(option.getByText("Imported")).toBeVisible();
  await option.dblclick();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __multysm: Store }).__multysm.getState().tool))
    .toEqual({ kind: "place", partId: "imported.demo_parts.demo_opamp" });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Components" }).click();
  await page.getByRole("button", { name: "Manage imports" }).click();
  const manage = page.getByRole("dialog", { name: "Manage imports" });
  await manage.getByRole("button", { name: "Remove demo_parts.lib" }).click();
  await expect(manage.getByText("No imported parts yet.")).toBeVisible();
});
