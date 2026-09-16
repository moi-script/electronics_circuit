import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tokens } from "./tokens";

// jsdom's test environment replaces the global `URL` (even the one imported
// from "node:url") so that a relative `new URL(path, import.meta.url)`
// resolves against `document.location` instead of the given file:// base.
// Resolving the path with `node:path` instead avoids that entirely.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"), "utf8");

describe("theme tokens", () => {
  it("CSS theme and TS tokens agree", () => {
    for (const [name, value] of Object.entries(tokens)) {
      expect(css).toContain(`--color-${name}: ${value};`);
    }
  });

  it("uses no pure black or pure white", () => {
    for (const value of Object.values(tokens)) {
      expect(["#000000", "#ffffff"]).not.toContain(value.toLowerCase());
    }
  });
});
