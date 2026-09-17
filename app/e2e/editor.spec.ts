import { expect, test, type Page } from "@playwright/test";

type World = [number, number];

async function editor(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as { __multysm: { getState(): Record<string, unknown> } }).__multysm;
    const s = store.getState();
    return JSON.parse(JSON.stringify({
      project: s.project, tool: s.tool, selection: s.selection, filePath: s.filePath, dirty: s.dirty, panels: s.panels,
    }));
  });
}

async function screenPoint(page: Page, [wx, wy]: World) {
  const box = (await page.getByTestId("canvas").boundingBox())!;
  const { project } = await editor(page);
  const zoom = project.view?.zoom ?? 1;
  const [px, py] = project.view?.pan ?? [0, 0];
  return { x: box.x + wx * zoom + px, y: box.y + wy * zoom + py };
}

async function clickWorld(page: Page, point: World) {
  const p = await screenPoint(page, point);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

async function placeViaBrowser(page: Page, query: string, at: World) {
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search components…").fill(query);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Add component" })).toBeHidden();
  await clickWorld(page, at);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Components" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => {
      const store = (window as unknown as { __multysm?: { getState(): { library: unknown } } }).__multysm;
      return !!store && store.getState().library !== null;
    }))
    .toBe(true);
});

test("shows the soft-dark layout", async ({ page }) => {
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(27, 29, 35)");
  // Run is enabled once the library loads even for an empty circuit; RunButton disables only
  // for an invalid analysis or a missing backend (see RunButton.test.tsx).
  await expect(page.getByRole("button", { name: "▶ Run" })).toBeEnabled();
  await page.getByRole("button", { name: "Components" }).click();
  const dialog = page.getByRole("dialog", { name: "Add component" });
  await expect(dialog.getByRole("button", { name: /^group / })).toHaveCount(15);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("browses groups and places a transistor", async ({ page }) => {
  await page.getByRole("button", { name: "Components" }).click();
  const dialog = page.getByRole("dialog", { name: "Add component" });
  await dialog.getByRole("button", { name: "group Transistors" }).click();
  await dialog.getByRole("option", { name: /NPN Transistor 2N2222/ }).click();
  const preview = dialog.getByTestId("symbol-preview");
  await expect(preview.getByTestId("pin-B")).toHaveText("B");
  await expect(preview.getByTestId("pin-C")).toHaveText("C");
  await expect(preview.getByTestId("pin-E")).toHaveText("E");
  await dialog.getByRole("button", { name: "Place" }).click();
  await expect(dialog).toBeHidden();
  await clickWorld(page, [300, 300]);
  const { project } = await editor(page);
  expect(project.components).toHaveLength(1);
  expect(project.components[0]).toMatchObject({ part: "transistors.2n2222", ref: "Q1" });
});

test("places, rotates and deletes a part", async ({ page }) => {
  await placeViaBrowser(page, "resistor", [200, 200]);
  let state = await editor(page);
  expect(state.project.components).toHaveLength(1);
  expect(state.project.components[0]).toMatchObject({ ref: "R1", x: 200, y: 200 });
  await expect(page.getByLabel("Reference")).toHaveValue("R1");
  await page.keyboard.press("r");
  state = await editor(page);
  expect(state.project.components[0].rot).toBe(90);
  await page.keyboard.press("Delete");
  state = await editor(page);
  expect(state.project.components).toHaveLength(0);
});

test("wires two resistors with an orthogonal route", async ({ page }) => {
  await placeViaBrowser(page, "resistor", [100, 100]);
  await placeViaBrowser(page, "resistor", [300, 200]);
  await page.keyboard.press("w");
  await clickWorld(page, [160, 110]); // R1 pin 2
  await clickWorld(page, [300, 210]); // R2 pin 1
  const { project, tool } = await editor(page);
  expect(project.wires).toHaveLength(1);
  expect(project.wires[0].points).toEqual([[160, 110], [300, 110], [300, 210]]);
  expect(tool).toEqual({ kind: "wire", points: [] });
});

test("undoes and redoes", async ({ page }) => {
  await placeViaBrowser(page, "capacitor", [200, 200]);
  await page.keyboard.press("Control+Z");
  expect((await editor(page)).project.components).toHaveLength(0);
  await page.keyboard.press("Control+Y");
  expect((await editor(page)).project.components).toHaveLength(1);
});

test("saves and reopens a project", async ({ page }) => {
  await placeViaBrowser(page, "led (red)", [200, 200]);
  await page.keyboard.press("Control+S");
  await expect.poll(async () => (await editor(page)).filePath).toBe("untitled.msym");
  expect((await editor(page)).dirty).toBe(false);
  await page.getByRole("button", { name: "New" }).click();
  await expect.poll(async () => (await editor(page)).project.components.length).toBe(0);
  await page.getByRole("button", { name: "Open" }).click();
  await expect.poll(async () => (await editor(page)).project.components.length).toBe(1);
});

test("focus mode hides and restores the panels", async ({ page }) => {
  await page.keyboard.press("F11");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Exit focus" }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});

test("zooms with the wheel and pans with middle drag", async ({ page }) => {
  const p = await screenPoint(page, [300, 300]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await editor(page)).project.view.zoom).toBeGreaterThan(1);
  const before = (await editor(page)).project.view.pan;
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(p.x + 80, p.y + 40, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  const after = (await editor(page)).project.view.pan;
  expect(after[0] - before[0]).toBeCloseTo(80, 0);
  expect(after[1] - before[1]).toBeCloseTo(40, 0);
});
