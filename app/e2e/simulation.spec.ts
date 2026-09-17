import { expect, test, type Page } from "@playwright/test";

type Store = { getState(): Record<string, (...args: unknown[]) => unknown> & { library: unknown } };

function divider(withGround: boolean, extraResistor = false) {
  return {
    format: 1, app: "e2e", packs: [],
    components: [
      { uid: "c1", part: "sources.dc_voltage", ref: "V1", x: 0, y: 100, rot: 0, mirror: false, params: { voltage: "10" } },
      { uid: "c2", part: "basic.resistor", ref: "R1", x: 100, y: 90, rot: 0, mirror: false, params: {} },
      { uid: "c3", part: "basic.resistor", ref: "R2", x: 200, y: 90, rot: 0, mirror: false, params: {} },
      ...(withGround ? [{ uid: "c4", part: "sources.ground", ref: "GND1", x: 10, y: 200, rot: 0, mirror: false, params: {} }] : []),
      ...(extraResistor ? [{ uid: "c5", part: "basic.resistor", ref: "R3", x: 400, y: 300, rot: 0, mirror: false, params: {} }] : []),
    ],
    wires: [
      { uid: "w1", points: [[20, 100], [100, 100]] },
      { uid: "w2", points: [[160, 100], [200, 100]] },
      { uid: "w3", points: [[260, 100], [260, 200], [20, 200]] },
      { uid: "w4", points: [[20, 160], [20, 200]] },
    ],
    analysis: { type: "tran", stop: "10m", step: "10u" },
    probes: [],
    view: { zoom: 1, pan: [100, 100] },
  };
}

async function load(page: Page, project: unknown) {
  await page.evaluate((p) => {
    const store = (window as unknown as { __multysm: Store }).__multysm;
    store.getState().loadProject(p, null);
  }, project);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => {
      const store = (window as unknown as { __multysm?: Store }).__multysm;
      return !!store && store.getState().library !== null;
    }))
    .toBe(true);
});

test("shows problems on the canvas and in the status bar", async ({ page }) => {
  await load(page, divider(false, true));
  await page.getByRole("button", { name: "▶ Run" }).click();
  // Next.js renders its own empty role="alert" route announcer; scope to the one with content.
  await expect(page.getByRole("alert").filter({ hasText: "no ground" })).toBeVisible();
  await expect(page.getByRole("button", { name: "3 problems" })).toBeVisible();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-error-parts", "1");
});

test("runs an operating point and labels the nets", async ({ page }) => {
  await load(page, divider(true));
  await page.getByRole("button", { name: "Transient · 10 ms" }).click();
  await page.getByRole("dialog", { name: "Analysis" }).getByLabel("Operating point").check();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "▶ Run" }).click();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-op-labels", "2");
  await expect(page.getByTestId("sim-status")).toContainText("Done in");
});

test("plots a transient and marks it outdated after an edit", async ({ page }) => {
  await load(page, divider(true));
  await page.keyboard.press("Control+Enter");
  const plot = page.getByRole("region", { name: "Plot" });
  await expect(plot).toBeVisible();
  await plot.getByRole("checkbox", { name: "V(R1:2)" }).check();
  await expect(plot.getByTestId("chart").locator("canvas").first()).toBeVisible();
  await page.evaluate(() => {
    const store = (window as unknown as { __multysm: Store }).__multysm;
    store.getState().setParam("c2", "resistance", "2k");
  });
  await expect(plot.getByText("outdated")).toBeVisible();
});
