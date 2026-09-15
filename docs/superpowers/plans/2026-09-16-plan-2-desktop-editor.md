# Plan 2 — Desktop Shell and Schematic Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri desktop window running a Next.js schematic editor. It has the soft-dark hybrid layout, a parts panel fed by the real component library, a canvas to place, move, rotate, mirror and wire parts, a properties panel, undo/redo, a Ctrl+K part palette, Focus mode, and open/save/autosave of `.msym` projects. No simulation yet (Plan 3 adds Run and plots).

**Architecture:** The Rust workspace gains `src-tauri` (crate `multysm-app`), a thin shell exposing Tauri commands over `multysm-core`: library loading, project open/save and recovery. The UI lives in `app/`, a Next.js static export. Its model layer (`src/model/`) is plain TypeScript: types, SI parsing, geometry, wiring and a Zustand store, all Vitest-tested. The UI layer (`src/ui/`) is React plus react-konva. The UI talks to the backend only through the `Backend` interface (`src/backend/`), which has two implementations: `tauriBackend` (desktop) and `mockBackend` (plain browser and Playwright, using a library fixture exported from the real parts).

**Tech Stack:** Tauri 2 (`tauri = "2"`, `tauri-build = "2"`, `tauri-plugin-dialog = "2"`, `@tauri-apps/cli 2.11.4`, `@tauri-apps/api 2.11.1`, `@tauri-apps/plugin-dialog 2.7.3`), Next.js 16.3.5, React 19.3.0, konva 10.5.0, react-konva 19.2.7, zustand 5.0.15, Tailwind CSS 4.3.3, TypeScript ^5.9, Vitest 5.0.1 + jsdom 30.0.1 + @testing-library/react 16.3.3, Playwright 1.63.0.

**Spec:** `docs/superpowers/specs/2026-09-15-multysm-design.md` (UI: §5, project file: §7, testing: §9). Deferred items: `docs/superpowers/plans/2026-09-15-plan-1-followups.md`.

## Global Constraints

- One theme only, soft-dark, with these exact tokens: `bg #1b1d23`, `panel #22252d`, `line #2e323c`, `text #c9ced8`, `muted #8a91a0`, `wire #7aa2d6`, `accent #5fb3a8`, `selected #e0b25c`, `error #d97a7a`, `grid #2c3039`. No pure black, no pure white, no light mode.
- Layout (spec §5.2): top bar 40 px; left Parts panel (`Ctrl+B`); center canvas; right Properties panel, shown only when something is selected (`Ctrl+I` pins it open); bottom plot dock (`Ctrl+J`, placeholder until Plan 3); status bar. `F11` Focus mode hides every panel and shows a floating toolbar.
- Shortcuts (spec §5.3): `Ctrl+K` / `P` part palette · `W` wire · `Esc` select · `R` rotate · `M` mirror · `Del` · `Ctrl+Z` / `Ctrl+Y` · `Ctrl+C` / `Ctrl+V` · wheel zoom · middle-drag or `Space`+drag pan. Shortcuts are ignored while typing in an input.
- Grid: 10 world units; everything snaps to it. Wires are orthogonal.
- Geometry must match `multysm-core` exactly: mirror flips local x, then rotation is applied clockwise on screen (y down) about the instance origin; `rot ∈ {0, 90, 180, 270}`.
- Project file shape is spec §7, written with `format: 1`, `app: "0.1.0"`, `packs: [{ id: "core", version: "1.0.0" }]`. Projects are untrusted: the backend validates with `schemas/project.schema.json`.
- References are auto-assigned as `refPrefix` plus the next free number (ground parts use `GND`).
- The frontend never reads files directly; all file access goes through Tauri commands or dialogs.
- The UI must stay usable in a plain browser (`npm --prefix app run dev`) through `mockBackend`.
- Cargo in Git Bash: `export PATH="$HOME/.cargo/bin:$PATH"`. The repo path has no spaces.
- Commit after every task; messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File map

```
package.json                         root: @tauri-apps/cli + scripts (dev = tauri dev)
Cargo.toml                           workspace members + "src-tauri"
schemas/project.schema.json          .msym schema
crates/multysm-core/src/project_file.rs   parse_project, project_to_json
src-tauri/                           Tauri shell (crate multysm-app, lib multysm_app_lib)
  Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json, app-icon.svg, icons/
  src/main.rs, src/lib.rs            builder, plugins, commands registration
  src/library_dto.rs                 LibraryDto (parts + SVG markup + issues)
  src/commands.rs                    load_library, open_project, save_project, recovery
  src/bin/export_library.rs          prints LibraryDto JSON (mock fixture)
app/                                 Next.js static export
  package.json, next.config.ts, tsconfig.json, postcss.config.mjs, vitest.config.ts, playwright.config.ts
  src/app/{layout.tsx, page.tsx, globals.css}
  src/theme/tokens.ts
  src/model/{types.ts, si.ts, geometry.ts, wiring.ts, refs.ts, store.ts}
  src/backend/{backend.ts, tauriBackend.ts, mockBackend.ts, mock-library.json, index.ts}
  src/ui/{AppShell.tsx, TopBar.tsx, PartsPanel.tsx, PropertiesPanel.tsx, StatusBar.tsx, PlotDock.tsx,
          FocusToolbar.tsx, CommandPalette.tsx, RecoveryBanner.tsx, useShortcuts.ts, useAutosave.ts}
  src/ui/canvas/{Canvas.tsx, Grid.tsx, PartNode.tsx, WireLayer.tsx, symbolImage.ts, viewport.ts}
  e2e/editor.spec.ts
```

---

### Task 1: Project file parsing and rotation checks in core

**Files:**
- Create: `schemas/project.schema.json`, `crates/multysm-core/src/project_file.rs`, `crates/multysm-core/tests/project_file.rs`
- Modify: `crates/multysm-core/src/lib.rs`, `crates/multysm-core/src/netlist/mod.rs`, `crates/multysm-core/src/netlist/build.rs`, `crates/multysm-core/tests/netlist.rs`

**Interfaces:**
- Produces: `multysm_core::project_file::{parse_project(&str) -> Result<Project, ProjectFileError>, project_to_json(&Project) -> String, ProjectFileError { Json(String), Schema(Vec<String>) }}`; `netlist::ErrorCode::InvalidRotation`.

- [ ] **Step 1: Write the schema**

`schemas/project.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "multysm project (.msym)",
  "type": "object",
  "required": ["format", "app", "components", "wires", "analysis"],
  "properties": {
    "format": { "const": 1 },
    "app": { "type": "string" },
    "packs": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "version"],
        "properties": { "id": { "type": "string" }, "version": { "type": "string" } }
      }
    },
    "components": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["uid", "part", "ref", "x", "y"],
        "additionalProperties": false,
        "properties": {
          "uid": { "type": "string", "minLength": 1 },
          "part": { "type": "string", "minLength": 1 },
          "ref": { "type": "string" },
          "x": { "type": "integer" },
          "y": { "type": "integer" },
          "rot": { "enum": [0, 90, 180, 270] },
          "mirror": { "type": "boolean" },
          "params": { "type": "object", "additionalProperties": { "type": "string" } }
        }
      }
    },
    "wires": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["uid", "points"],
        "additionalProperties": false,
        "properties": {
          "uid": { "type": "string", "minLength": 1 },
          "points": {
            "type": "array",
            "minItems": 2,
            "items": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "integer" } }
          }
        }
      }
    },
    "analysis": {
      "type": "object",
      "required": ["type"],
      "properties": { "type": { "enum": ["op", "tran", "ac", "dc"] } }
    },
    "probes": { "type": "array", "items": { "type": "string" } },
    "view": { "type": ["object", "null"] }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`crates/multysm-core/tests/project_file.rs`:
```rust
use multysm_core::circuit::Analysis;
use multysm_core::project_file::{parse_project, project_to_json, ProjectFileError};

const SPEC_EXAMPLE: &str = r#"{
  "format": 1, "app": "0.1.0",
  "packs": [{ "id": "core", "version": "1.0.0" }],
  "components": [{ "uid": "c7", "part": "basic.resistor", "ref": "R1",
                   "x": 120, "y": 80, "rot": 90, "mirror": false,
                   "params": { "resistance": "4.7k" } }],
  "wires": [{ "uid": "w3", "points": [[120,80],[200,80]] }],
  "analysis": { "type": "tran", "stop": "10m", "step": "10u" },
  "probes": ["net:out"],
  "view": { "zoom": 1, "pan": [0,0] }
}"#;

#[test]
fn parses_the_spec_example_and_round_trips() {
    let project = parse_project(SPEC_EXAMPLE).unwrap();
    assert_eq!(project.components[0].reference, "R1");
    assert_eq!(project.analysis, Analysis::Tran { stop: "10m".into(), step: "10u".into() });
    let again = parse_project(&project_to_json(&project)).unwrap();
    assert_eq!(again, project);
}

#[test]
fn invalid_json_is_rejected() {
    assert!(matches!(parse_project("{ nope"), Err(ProjectFileError::Json(_))));
}

#[test]
fn wrong_format_version_is_rejected() {
    let text = SPEC_EXAMPLE.replace(r#""format": 1"#, r#""format": 2"#);
    assert!(matches!(parse_project(&text), Err(ProjectFileError::Schema(_))));
}

#[test]
fn rotation_must_be_a_right_angle() {
    let text = SPEC_EXAMPLE.replace(r#""rot": 90"#, r#""rot": 45"#);
    assert!(matches!(parse_project(&text), Err(ProjectFileError::Schema(_))));
}

#[test]
fn duplicate_uids_are_rejected() {
    let text = SPEC_EXAMPLE.replace(r#""uid": "w3""#, r#""uid": "c7""#);
    match parse_project(&text) {
        Err(ProjectFileError::Schema(messages)) => {
            assert!(messages.iter().any(|m| m.contains("duplicate uid 'c7'")), "{messages:?}")
        }
        other => panic!("expected schema error, got {other:?}"),
    }
}
```

Append to `crates/multysm-core/tests/netlist.rs`:
```rust
#[test]
fn rotation_that_is_not_a_right_angle_is_an_error() {
    let lib = core_library();
    let mut project = divider(&lib, Analysis::Op).build();
    project.components[2].rot = 45;
    let errors = build_netlist(&project, &lib).unwrap_err();
    assert!(errors.iter().any(|e| e.code == ErrorCode::InvalidRotation
        && e.component_uid.as_deref() == Some(project.components[2].uid.as_str())));
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p multysm-core --test project_file --test netlist`
Expected: FAIL to compile (`project_file` module and `ErrorCode::InvalidRotation` don't exist).

- [ ] **Step 4: Implement**

`crates/multysm-core/src/project_file.rs`:
```rust
//! Reading and writing `.msym` project files. Project files are untrusted:
//! they are validated against `schemas/project.schema.json` before use.

use std::collections::BTreeSet;

use crate::circuit::Project;

const PROJECT_SCHEMA: &str = include_str!("../../../schemas/project.schema.json");

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ProjectFileError {
    #[error("not valid JSON: {0}")]
    Json(String),
    #[error("not a valid multysm project: {}", .0.join("; "))]
    Schema(Vec<String>),
}

pub fn parse_project(text: &str) -> Result<Project, ProjectFileError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| ProjectFileError::Json(e.to_string()))?;
    let schema: serde_json::Value =
        serde_json::from_str(PROJECT_SCHEMA).expect("bundled project schema is valid JSON");
    let validator = jsonschema::validator_for(&schema).expect("bundled project schema compiles");
    let errors: Vec<String> = validator.iter_errors(&value).map(|e| e.to_string()).collect();
    if !errors.is_empty() {
        return Err(ProjectFileError::Schema(errors));
    }
    let project: Project =
        serde_json::from_value(value).map_err(|e| ProjectFileError::Schema(vec![e.to_string()]))?;

    let mut seen = BTreeSet::new();
    let uids = project.components.iter().map(|c| &c.uid).chain(project.wires.iter().map(|w| &w.uid));
    let duplicates: Vec<String> = uids
        .filter(|uid| !seen.insert(uid.as_str()))
        .map(|uid| format!("duplicate uid '{uid}'"))
        .collect();
    if !duplicates.is_empty() {
        return Err(ProjectFileError::Schema(duplicates));
    }
    Ok(project)
}

pub fn project_to_json(project: &Project) -> String {
    serde_json::to_string_pretty(project).expect("projects always serialize")
}
```

Add `pub mod project_file;` to `crates/multysm-core/src/lib.rs` (keep modules alphabetical).

In `crates/multysm-core/src/netlist/mod.rs`, add the variant `InvalidRotation` to the end of `ErrorCode`.

In `crates/multysm-core/src/netlist/build.rs`, `build_netlist` already collects errors in a `Vec<NetlistError>` named `errors`. Right after the existing `check_references(...)` call, add:
```rust
    for inst in &project.components {
        if !matches!(inst.rot, 0 | 90 | 180 | 270) {
            errors.push(NetlistError::new(
                ErrorCode::InvalidRotation,
                format!("{}: rotation {}° is not 0, 90, 180 or 270", inst.reference, inst.rot),
                Some(inst.uid.as_str()),
            ));
        }
    }
```
If `check_references` is called somewhere other than near the top of `build_netlist`, put this loop just before the first per-component rendering loop. The only requirement is that it runs before errors are returned.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p multysm-core`
Expected: all tests pass (74 previous + 6 new), no warnings.

- [ ] **Step 6: Commit**

```bash
git add schemas/project.schema.json crates/multysm-core
git commit -m "feat(core): validated .msym project parsing and rotation checks"
```

---

### Task 2: Desktop shell scaffold (first window)

**Files:**
- Create: `package.json`, `app/package.json`, `app/next.config.ts`, `app/tsconfig.json`, `app/postcss.config.mjs`, `app/vitest.config.ts`, `app/next-env.d.ts`, `app/src/app/layout.tsx`, `app/src/app/page.tsx`, `app/src/app/globals.css`, `app/src/theme/tokens.ts`, `app/src/theme/tokens.test.ts`, `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/app-icon.svg`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/icons/*` (generated)
- Modify: `Cargo.toml` (workspace members), `.gitignore`

**Interfaces:**
- Produces: `tokens` (`app/src/theme/tokens.ts`): `{ bg, panel, line, text, muted, wire, accent, selected, error, grid }`. Tailwind colour utilities `bg-bg`, `bg-panel`, `border-line`, `text-text`, `text-muted`, `text-accent`, `bg-accent`, `text-selected`, `text-error`. Crate `multysm-app` with `multysm_app_lib::run()`. Scripts: root `npm run dev` (desktop), `npm --prefix app run dev` (browser), `npm --prefix app test`.

- [ ] **Step 1: Root and app package manifests**

`package.json`:
```json
{
  "name": "multysm",
  "private": true,
  "scripts": {
    "tauri": "tauri",
    "dev": "tauri dev",
    "build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "2.11.4"
  }
}
```

`app/package.json`:
```json
{
  "name": "multysm-app",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@tauri-apps/api": "2.11.1",
    "@tauri-apps/plugin-dialog": "2.7.3",
    "konva": "10.5.0",
    "next": "16.3.5",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-konva": "19.2.7",
    "zustand": "5.0.15"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@tailwindcss/postcss": "4.3.3",
    "@testing-library/react": "16.3.3",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "6.1.1",
    "jsdom": "30.0.1",
    "tailwindcss": "4.3.3",
    "typescript": "^5.9",
    "vitest": "5.0.1"
  }
}
```

Run: `npm install && npm --prefix app install`
Expected: both install without errors. If a pinned version fails to resolve or has a peer conflict, use the nearest compatible version and record it in the report. Never use `--force`.

- [ ] **Step 2: Next.js config, theme and placeholder page**

`app/next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  devIndicators: false,
};

export default nextConfig;
```

`app/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "out", "e2e"]
}
```

`app/next-env.d.ts`:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

`app/postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`app/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
```

`app/src/theme/tokens.ts`:
```ts
/** Soft-dark theme: the only theme. Mirrored in src/app/globals.css. */
export const tokens = {
  bg: "#1b1d23",
  panel: "#22252d",
  line: "#2e323c",
  text: "#c9ced8",
  muted: "#8a91a0",
  wire: "#7aa2d6",
  accent: "#5fb3a8",
  selected: "#e0b25c",
  error: "#d97a7a",
  grid: "#2c3039",
} as const;

export type TokenName = keyof typeof tokens;
```

`app/src/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  --color-bg: #1b1d23;
  --color-panel: #22252d;
  --color-line: #2e323c;
  --color-text: #c9ced8;
  --color-muted: #8a91a0;
  --color-wire: #7aa2d6;
  --color-accent: #5fb3a8;
  --color-selected: #e0b25c;
  --color-error: #d97a7a;
  --color-grid: #2c3039;
  --font-sans: "Segoe UI", system-ui, sans-serif;
}

html,
body {
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 13px;
}

:focus-visible {
  outline: 1px solid var(--color-accent);
  outline-offset: 1px;
}
```

`app/src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "multysm" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/src/app/page.tsx` (placeholder, replaced in Task 8):
```tsx
export default function Home() {
  return (
    <main className="flex h-full items-center justify-center bg-bg text-muted">
      <div className="rounded-lg border border-line bg-panel px-8 py-6 text-center">
        <div className="text-lg text-text">multysm</div>
        <div className="mt-1">Editor loading soon</div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Write the token test, run it**

`app/src/theme/tokens.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tokens } from "./tokens";

const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

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
```

Run: `npm --prefix app test`
Expected: 2 passed.

Run: `npm --prefix app run build`
Expected: the build succeeds and `app/out/index.html` exists.

- [ ] **Step 4: Tauri crate**

In the root `Cargo.toml`, change `members` to `["crates/multysm-core", "src-tauri"]`.

`src-tauri/Cargo.toml`:
```toml
[package]
name = "multysm-app"
version = "0.1.0"
edition = "2021"

[lib]
name = "multysm_app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
multysm-core = { path = "../crates/multysm-core" }

[dev-dependencies]
tempfile = "3"
```

`src-tauri/build.rs`:
```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/src/main.rs`:
```rust
// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    multysm_app_lib::run()
}
```

`src-tauri/src/lib.rs`:
```rust
//! multysm desktop shell: a thin Tauri layer over multysm-core.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running multysm");
}
```

`src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "multysm",
  "version": "0.1.0",
  "identifier": "com.multysm.app",
  "build": {
    "beforeDevCommand": "npm --prefix app run dev",
    "devUrl": "http://localhost:3000",
    "beforeBuildCommand": "npm --prefix app run build",
    "frontendDist": "../app/out"
  },
  "app": {
    "windows": [
      {
        "title": "multysm",
        "width": 1400,
        "height": 900,
        "minWidth": 1000,
        "minHeight": 640,
        "backgroundColor": "#1b1d23"
      }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
```

`src-tauri/capabilities/default.json`:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window permissions",
  "windows": ["main"],
  "permissions": ["core:default", "dialog:default"]
}
```

`src-tauri/app-icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#22252d"/><path d="M96 256h72l28-72 56 144 56-144 28 72h80" fill="none" stroke="#5fb3a8" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

Run: `npx tauri icon src-tauri/app-icon.svg`
Expected: `src-tauri/icons/` now contains `icon.ico`, `32x32.png` and the rest. If the CLI rejects SVG input, convert the SVG to a 1024×1024 PNG with any available tool (for example `npx --yes sharp-cli -i src-tauri/app-icon.svg -o src-tauri/app-icon.png resize 1024 1024`), run `tauri icon` on the PNG, and note it in the report.

Append to `.gitignore`:
```
src-tauri/gen/
app/test-results/
app/playwright-report/
```

- [ ] **Step 5: Verify the shell builds and opens**

Run: `cargo build -p multysm-app`
Expected: compiles with no warnings.

Run: `npm run dev` (from the repo root)
Expected: Next.js starts on port 3000, then a native window titled "multysm" opens with the dark placeholder card. Close the window to stop. If you are an automated agent and cannot see windows, check that the process reaches `Running target\debug\multysm-app.exe` without errors, stop it, and say in the report that visual confirmation is left to the user.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json Cargo.toml Cargo.lock .gitignore app src-tauri
git commit -m "feat(app): Tauri + Next.js desktop shell with soft-dark theme"
```

Make sure `app/node_modules`, `app/.next`, `app/out` and `src-tauri/gen` are not staged.

---

### Task 3: Tauri commands (library, projects, recovery)

**Files:**
- Create: `src-tauri/src/library_dto.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/bin/export_library.rs`, `src-tauri/tests/commands.rs`, `app/src/backend/mock-library.json` (generated)
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `multysm_core::library::{load_library, Library, Manifest, Category}`, `multysm_core::project_file::{parse_project, project_to_json}`, `multysm_core::circuit::Project`.
- Produces:
  - Rust: `library_dto::{LibraryDto { categories: Vec<Category>, parts: Vec<PartDto>, issues: Vec<IssueDto> }, PartDto { manifest: Manifest, svg: String, ref_prefix: String }, IssueDto { path: String, message: String }, library_dto(&Library) -> LibraryDto, components_root() -> PathBuf}`; `commands::{read_project_file(&Path) -> Result<Project, String>, write_project_file(&Path, &Project) -> Result<(), String>}`.
  - Tauri commands (JS names and args): `load_library() -> LibraryDto`, `open_project({ path }) -> Project`, `save_project({ path, project })`, `write_recovery({ project })`, `read_recovery() -> Project | null`, `clear_recovery()`. Errors are returned as strings.
  - JSON shape of `LibraryDto`: `{ categories: string[15], parts: [{ manifest, svg, refPrefix }], issues: [{ path, message }] }`.

- [ ] **Step 1: Write the failing tests**

`src-tauri/tests/commands.rs`:
```rust
use multysm_app_lib::commands::{read_project_file, write_project_file};
use multysm_app_lib::library_dto::{components_root, library_dto};
use multysm_core::library::load_library;
use multysm_core::project_file::parse_project;

#[test]
fn core_library_dto_has_parts_svgs_and_prefixes() {
    let dto = library_dto(&load_library(&[components_root()]));
    assert!(dto.issues.is_empty(), "{:?}", dto.issues);
    assert_eq!(dto.categories.len(), 15);
    let resistor = dto.parts.iter().find(|p| p.manifest.id == "basic.resistor").unwrap();
    assert!(resistor.svg.contains("<svg"));
    assert_eq!(resistor.ref_prefix, "R");
    let ground = dto.parts.iter().find(|p| p.manifest.id == "sources.ground").unwrap();
    assert_eq!(ground.ref_prefix, "GND");
}

#[test]
fn library_dto_serializes_with_camel_case_fields() {
    let dto = library_dto(&load_library(&[components_root()]));
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["categories"][5], "TTL");
    let part = &json["parts"][0];
    assert!(part["refPrefix"].is_string());
    assert!(part["svg"].is_string());
    assert!(part["manifest"]["symbol"]["pins"].is_array());
}

#[test]
fn project_files_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("demo.msym");
    let project = parse_project(
        r#"{ "format": 1, "app": "0.1.0", "components": [], "wires": [],
             "analysis": { "type": "op" } }"#,
    )
    .unwrap();
    write_project_file(&path, &project).unwrap();
    assert_eq!(read_project_file(&path).unwrap(), project);
}

#[test]
fn unreadable_or_invalid_project_files_give_messages() {
    let dir = tempfile::tempdir().unwrap();
    let missing = read_project_file(&dir.path().join("missing.msym")).unwrap_err();
    assert!(missing.starts_with("Cannot open"), "{missing}");
    let bad = dir.path().join("bad.msym");
    std::fs::write(&bad, "{ nope").unwrap();
    assert!(read_project_file(&bad).unwrap_err().contains("not valid JSON"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p multysm-app --test commands`
Expected: FAIL to compile (`commands` and `library_dto` modules don't exist).

- [ ] **Step 3: Implement**

`src-tauri/src/library_dto.rs`:
```rust
//! Library data as sent to the UI: manifests plus symbol SVG markup
//! (the webview never reads files itself).

use std::fs;
use std::path::PathBuf;

use multysm_core::library::{Category, Library, Manifest};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LibraryDto {
    pub categories: Vec<Category>,
    pub parts: Vec<PartDto>,
    pub issues: Vec<IssueDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartDto {
    pub manifest: Manifest,
    pub svg: String,
    pub ref_prefix: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct IssueDto {
    pub path: String,
    pub message: String,
}

/// Built-in component folder. `MULTYSM_COMPONENTS` overrides it; otherwise the
/// repository's `components/core` is used (bundling comes with packaging).
pub fn components_root() -> PathBuf {
    std::env::var_os("MULTYSM_COMPONENTS")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../components/core"))
}

pub fn library_dto(library: &Library) -> LibraryDto {
    let mut issues: Vec<IssueDto> = library
        .issues
        .iter()
        .map(|i| IssueDto { path: i.path.display().to_string(), message: i.message.clone() })
        .collect();
    let mut parts = Vec::new();
    for part in library.parts.values() {
        match fs::read_to_string(&part.symbol_path) {
            Ok(svg) => parts.push(PartDto {
                ref_prefix: part
                    .manifest
                    .spice
                    .device()
                    .map_or_else(|| "GND".to_string(), |d| d.ref_prefix.clone()),
                svg,
                manifest: part.manifest.clone(),
            }),
            Err(e) => issues.push(IssueDto {
                path: part.symbol_path.display().to_string(),
                message: format!("cannot read symbol: {e}"),
            }),
        }
    }
    LibraryDto { categories: Category::ALL.to_vec(), parts, issues }
}
```

`src-tauri/src/commands.rs`:
```rust
//! Tauri commands: the only API the UI calls.

use std::fs;
use std::path::{Path, PathBuf};

use multysm_core::circuit::Project;
use multysm_core::project_file::{parse_project, project_to_json};
use tauri::{AppHandle, Manager};

use crate::library_dto::{components_root, library_dto, LibraryDto};

pub fn read_project_file(path: &Path) -> Result<Project, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    parse_project(&text).map_err(|e| e.to_string())
}

pub fn write_project_file(path: &Path, project: &Project) -> Result<(), String> {
    fs::write(path, project_to_json(project)).map_err(|e| format!("Cannot save {}: {e}", path.display()))
}

#[tauri::command]
pub fn load_library() -> LibraryDto {
    library_dto(&multysm_core::library::load_library(&[components_root()]))
}

#[tauri::command]
pub fn open_project(path: String) -> Result<Project, String> {
    read_project_file(Path::new(&path))
}

#[tauri::command]
pub fn save_project(path: String, project: Project) -> Result<(), String> {
    write_project_file(Path::new(&path), &project)
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recovery.msym"))
}

#[tauri::command]
pub fn write_recovery(app: AppHandle, project: Project) -> Result<(), String> {
    write_project_file(&recovery_path(&app)?, &project)
}

#[tauri::command]
pub fn read_recovery(app: AppHandle) -> Result<Option<Project>, String> {
    let path = recovery_path(&app)?;
    if !path.is_file() {
        return Ok(None);
    }
    read_project_file(&path).map(Some)
}

#[tauri::command]
pub fn clear_recovery(app: AppHandle) -> Result<(), String> {
    let path = recovery_path(&app)?;
    if path.is_file() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Replace `src-tauri/src/lib.rs` with:
```rust
//! multysm desktop shell: a thin Tauri layer over multysm-core.

pub mod commands;
pub mod library_dto;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_library,
            commands::open_project,
            commands::save_project,
            commands::write_recovery,
            commands::read_recovery,
            commands::clear_recovery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running multysm");
}
```

`src-tauri/src/bin/export_library.rs`:
```rust
//! Prints the core library as UI JSON; used to refresh the browser mock fixture:
//! `cargo run -q -p multysm-app --bin export_library > app/src/backend/mock-library.json`

fn main() {
    let library = multysm_core::library::load_library(&[multysm_app_lib::library_dto::components_root()]);
    let dto = multysm_app_lib::library_dto::library_dto(&library);
    println!("{}", serde_json::to_string_pretty(&dto).expect("library DTO serializes"));
}
```

In `src-tauri/Cargo.toml`, add `default-run = "multysm-app"` under `[package]` so `tauri dev` still launches the app binary.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p multysm-app`
Expected: 4 passed, no warnings.

- [ ] **Step 5: Generate the mock library fixture**

Run: `mkdir -p app/src/backend && cargo run -q -p multysm-app --bin export_library > app/src/backend/mock-library.json`
Expected: valid JSON with 8 parts. Check with `node -e "const l=require('./app/src/backend/mock-library.json'); console.log(l.parts.length, l.categories.length)"`, which should print `8 15`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri app/src/backend/mock-library.json Cargo.lock
git commit -m "feat(app): Tauri commands for library, projects and recovery"
```

---

### Task 4: Frontend model types, SI parser and geometry

**Files:**
- Create: `app/src/model/types.ts`, `app/src/model/si.ts`, `app/src/model/si.test.ts`, `app/src/model/geometry.ts`, `app/src/model/geometry.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `Category`, `CATEGORIES`, `Pin`, `Param`, `Manifest`, `PartDef`, `LibraryIssue`, `LibraryData`, `Point`, `Rotation`, `ComponentInstance`, `Wire`, `Analysis`, `Project`, `APP_VERSION`, `emptyProject()`
  - `si.ts`: `parseSi(input: string): SiResult` where `SiResult = { ok: true; value: number } | { ok: false; error: string }`
  - `geometry.ts`: `GRID`, `snap(v)`, `snapPoint(p)`, `samePoint(a, b)`, `pinPosition(inst, pin): Point`, `pointOnSegment(p, a, b)`, `orthogonalRoute(from, to): Point[]`, `simplifyPath(points): Point[]`, `partBounds(inst, symbol): { x; y; width; height }`

- [ ] **Step 1: Write the types (no test; used by the tests below)**

`app/src/model/types.ts`:
```ts
/** Shapes shared with the Rust backend (serde JSON). */

export type Category =
  | "Sources" | "Basic" | "Diodes" | "Transistors" | "Analog" | "TTL" | "CMOS"
  | "Advanced Peripherals" | "Misc Digital" | "Mixed" | "Indicators" | "Power"
  | "Misc" | "RF" | "Electromechanical";

export const CATEGORIES: Category[] = [
  "Sources", "Basic", "Diodes", "Transistors", "Analog", "TTL", "CMOS",
  "Advanced Peripherals", "Misc Digital", "Mixed", "Indicators", "Power",
  "Misc", "RF", "Electromechanical",
];

export interface Pin {
  id: string;
  name?: string | null;
  x: number;
  y: number;
  optional?: boolean;
}

export interface Param {
  key: string;
  label: string;
  unit?: string;
  default: string;
  type: "si" | "text";
}

export interface Manifest {
  schema: number;
  id: string;
  name: string;
  category: Category;
  tags: string[];
  symbol: { width: number; height: number; svg: string; pins: Pin[] };
  params: Param[];
  spice: {
    kind: "ground" | "analog" | "digital";
    refPrefix?: string;
    template?: string;
    models?: string[];
    subckt?: string | null;
  };
  live?: unknown;
  controls?: unknown[];
}

export interface PartDef {
  manifest: Manifest;
  /** Symbol SVG markup; strokes use currentColor. */
  svg: string;
  refPrefix: string;
}

export interface LibraryIssue {
  path: string;
  message: string;
}

export interface LibraryData {
  categories: Category[];
  parts: PartDef[];
  issues: LibraryIssue[];
}

export type Point = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export interface ComponentInstance {
  uid: string;
  part: string;
  ref: string;
  x: number;
  y: number;
  rot: Rotation;
  mirror: boolean;
  /** Overrides only; missing keys use the manifest default. */
  params: Record<string, string>;
}

export interface Wire {
  uid: string;
  points: Point[];
}

export type Analysis =
  | { type: "op" }
  | { type: "tran"; stop: string; step: string }
  | { type: "ac"; start: string; stop: string; pointsPerDecade: number }
  | { type: "dc"; source: string; start: string; stop: string; step: string };

export interface Project {
  format: 1;
  app: string;
  packs: { id: string; version: string }[];
  components: ComponentInstance[];
  wires: Wire[];
  analysis: Analysis;
  probes: string[];
  view: { zoom: number; pan: Point } | null;
}

export const APP_VERSION = "0.1.0";

export function emptyProject(): Project {
  return {
    format: 1,
    app: APP_VERSION,
    packs: [{ id: "core", version: "1.0.0" }],
    components: [],
    wires: [],
    analysis: { type: "tran", stop: "10m", step: "10u" },
    probes: [],
    view: { zoom: 1, pan: [0, 0] },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`app/src/model/si.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseSi } from "./si";

const value = (s: string) => {
  const r = parseSi(s);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r.value;
};
const close = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-12;

describe("parseSi (mirrors multysm-core si::parse_si)", () => {
  it("parses plain numbers", () => {
    expect(value("10")).toBe(10);
    expect(value(" -2.5 ")).toBe(-2.5);
    expect(value(".5")).toBe(0.5);
    expect(value("1e3")).toBe(1000);
  });

  it("applies scale suffixes with SPICE-friendly case rules", () => {
    expect(value("4.7k")).toBe(4700);
    expect(close(value("2meg"), 2e6)).toBe(true);
    expect(close(value("2M"), 2e6)).toBe(true);
    expect(close(value("5m"), 5e-3)).toBe(true);
    expect(close(value("10u"), 1e-5)).toBe(true);
    expect(close(value("10µ"), 1e-5)).toBe(true);
    expect(close(value("100n"), 1e-7)).toBe(true);
    expect(close(value("22p"), 22e-12)).toBe(true);
    expect(close(value("3f"), 3e-15)).toBe(true);
    expect(close(value("1G"), 1e9)).toBe(true);
  });

  it("ignores units", () => {
    expect(close(value("10uF"), 1e-5)).toBe(true);
    expect(value("1F")).toBe(1);
    expect(value("1kΩ")).toBe(1000);
    expect(value("60Hz")).toBe(60);
  });

  it("rejects bad input with a message", () => {
    for (const bad of ["", "   ", "abc", "-", ".", "1e400"]) {
      const r = parseSi(bad);
      expect(r.ok, bad).toBe(false);
    }
  });
});
```

`app/src/model/geometry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  orthogonalRoute, partBounds, pinPosition, pointOnSegment, simplifyPath, snap, snapPoint,
} from "./geometry";
import type { Rotation } from "./types";

const inst = (rot: Rotation, mirror = false) => ({ x: 100, y: 200, rot, mirror });
const pin = { x: 60, y: 10 };

describe("geometry (mirrors multysm-core circuit.rs)", () => {
  it("snaps to the 10 unit grid", () => {
    expect(snap(14)).toBe(10);
    expect(snap(15)).toBe(20);
    expect(snapPoint([-4, 26])).toEqual([0, 30]);
  });

  it("rotates pins clockwise on screen", () => {
    expect(pinPosition(inst(0), pin)).toEqual([160, 210]);
    expect(pinPosition(inst(90), pin)).toEqual([90, 260]);
    expect(pinPosition(inst(180), pin)).toEqual([40, 190]);
    expect(pinPosition(inst(270), pin)).toEqual([110, 140]);
  });

  it("mirrors before rotating", () => {
    expect(pinPosition(inst(0, true), pin)).toEqual([40, 210]);
    expect(pinPosition(inst(90, true), pin)).toEqual([90, 140]);
  });

  it("detects points on segments", () => {
    expect(pointOnSegment([5, 0], [0, 0], [10, 0])).toBe(true);
    expect(pointOnSegment([10, 0], [0, 0], [10, 0])).toBe(true);
    expect(pointOnSegment([11, 0], [0, 0], [10, 0])).toBe(false);
    expect(pointOnSegment([5, 1], [0, 0], [10, 0])).toBe(false);
  });

  it("routes orthogonally, horizontal first", () => {
    expect(orthogonalRoute([0, 0], [30, 20])).toEqual([[0, 0], [30, 0], [30, 20]]);
    expect(orthogonalRoute([0, 0], [30, 0])).toEqual([[0, 0], [30, 0]]);
    expect(orthogonalRoute([0, 0], [0, 40])).toEqual([[0, 0], [0, 40]]);
  });

  it("simplifies paths by dropping duplicates and collinear middles", () => {
    expect(simplifyPath([[0, 0], [0, 0], [10, 0], [20, 0], [20, 10]])).toEqual([[0, 0], [20, 0], [20, 10]]);
    expect(simplifyPath([[5, 5], [5, 5]])).toEqual([[5, 5]]);
  });

  it("computes axis-aligned bounds after rotation", () => {
    const symbol = { width: 60, height: 20 };
    expect(partBounds(inst(0), symbol)).toEqual({ x: 100, y: 200, width: 60, height: 20 });
    expect(partBounds(inst(90), symbol)).toEqual({ x: 80, y: 200, width: 20, height: 60 });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL (`./si` and `./geometry` can't be resolved).

- [ ] **Step 4: Implement**

`app/src/model/si.ts`:
```ts
/**
 * Engineering value parser. Must match multysm-core `si::parse_si`:
 * `meg` (any case) and `M` = 1e6, `m` = 1e-3, `f` = 1e-15, `F` = farad (x1);
 * other scale letters case-insensitive; unknown trailing letters are units.
 */
export type SiResult = { ok: true; value: number } | { ok: false; error: string };

export function parseSi(input: string): SiResult {
  const s = input.trim();
  if (s === "") return { ok: false, error: "Enter a value" };
  const match = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s);
  if (!match) return { ok: false, error: `'${s}' is not a number` };
  const mantissa = match[0];
  const exponent = scaleExponent(s.slice(mantissa.length));
  // Parse "4.7e3" rather than computing 4.7 * 1000, which is not exact.
  const value = exponent === 0
    ? Number(mantissa)
    : /[eE]/.test(mantissa)
      ? Number(mantissa) * 10 ** exponent
      : Number(`${mantissa}e${exponent}`);
  if (!Number.isFinite(value)) return { ok: false, error: `'${s}' is out of range` };
  return { ok: true, value };
}

function scaleExponent(suffix: string): number {
  const rest = suffix.trim();
  if (rest.toLowerCase().startsWith("meg")) return 6;
  switch (rest.charAt(0)) {
    case "T": case "t": return 12;
    case "G": case "g": return 9;
    case "M": return 6;
    case "K": case "k": return 3;
    case "m": return -3;
    case "U": case "u": case "µ": case "μ": return -6;
    case "N": case "n": return -9;
    case "P": case "p": return -12;
    case "f": return -15;
    default: return 0;
  }
}
```

`app/src/model/geometry.ts`:
```ts
import type { ComponentInstance, Pin, Point } from "./types";

export const GRID = 10;

/** `+ 0` turns -0 into 0 so results compare equal in tests and JSON. */
export const snap = (v: number): number => Math.round(v / GRID) * GRID + 0;

export const snapPoint = ([x, y]: Point): Point => [snap(x), snap(y)];

export const samePoint = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];

type Placement = Pick<ComponentInstance, "x" | "y" | "rot" | "mirror">;

/** Mirror flips local x, then rotate clockwise on screen about (x, y). Matches circuit.rs. */
export function pinPosition(inst: Placement, pin: Pick<Pin, "x" | "y">): Point {
  const x = inst.mirror ? -pin.x : pin.x;
  const y = pin.y;
  let dx = x;
  let dy = y;
  switch (inst.rot) {
    case 90: dx = -y; dy = x; break;
    case 180: dx = -x; dy = -y; break;
    case 270: dx = y; dy = -x; break;
  }
  return [inst.x + dx + 0, inst.y + dy + 0];
}

export function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return cross === 0
    && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
    && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

/** Horizontal leg first, then vertical. */
export function orthogonalRoute(from: Point, to: Point): Point[] {
  return simplifyPath([from, [to[0], from[1]], to]);
}

/** Drops repeated points and the middle point of collinear triples. */
export function simplifyPath(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length > 0 && samePoint(out[out.length - 1], p)) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((b[0] - a[0]) * (p[1] - a[1]) === (b[1] - a[1]) * (p[0] - a[0])) out.pop();
    }
    out.push(p);
  }
  return out;
}

export function partBounds(inst: Placement, symbol: { width: number; height: number }) {
  const corners = [[0, 0], [symbol.width, 0], [0, symbol.height], [symbol.width, symbol.height]]
    .map(([x, y]) => pinPosition(inst, { x, y }));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix app test`
Expected: all pass (tokens 2, si 4, geometry 7).

- [ ] **Step 6: Commit**

```bash
git add app/src/model
git commit -m "feat(app): model types, SI parser and schematic geometry"
```

---

### Task 5: References and wiring helpers

**Files:**
- Create: `app/src/model/refs.ts`, `app/src/model/refs.test.ts`, `app/src/model/wiring.ts`, `app/src/model/wiring.test.ts`

**Interfaces:**
- Consumes: `geometry.ts` (`pinPosition`, `pointOnSegment`, `samePoint`, `snapPoint`), `types.ts`, fixture `@/backend/mock-library.json` (Task 3).
- Produces:
  - `refs.ts`: `nextReference(prefix: string, existing: Iterable<string>): string`, `nextUid(prefix: "c" | "w", existing: Iterable<string>): string`, `isValidReference(ref: string): boolean`
  - `wiring.ts`: `partMap(library: LibraryData | null): Map<string, PartDef>`, `PinPoint { uid: string; pin: string; point: Point }`, `pinPoints(project, parts): PinPoint[]`, `junctionPoints(project, parts): Point[]`, `danglingEnds(project, parts): Point[]`, `snapTarget(p: Point, project, parts, radius?: number): Point`

- [ ] **Step 1: Write the failing tests**

`app/src/model/refs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isValidReference, nextReference, nextUid } from "./refs";

describe("references", () => {
  it("uses the next free number for a prefix, case-insensitively", () => {
    expect(nextReference("R", [])).toBe("R1");
    expect(nextReference("R", ["R1", "r3", "C2", "R7x", "RL1"])).toBe("R4");
    expect(nextReference("GND", ["GND1"])).toBe("GND2");
  });

  it("escapes regex characters in prefixes", () => {
    expect(nextReference("R+", ["R+1", "RR2"])).toBe("R+2");
  });

  it("numbers uids per kind", () => {
    expect(nextUid("c", ["c1", "c9", "w20"])).toBe("c10");
    expect(nextUid("w", ["c1"])).toBe("w1");
  });

  it("validates references like multysm-core", () => {
    for (const ok of ["R1", "r1", "GND_1", "U"]) expect(isValidReference(ok)).toBe(true);
    for (const bad of ["", "1R", "_R", "R 1", "R-1", "R1;"]) expect(isValidReference(bad)).toBe(false);
  });
});
```

`app/src/model/wiring.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import library from "@/backend/mock-library.json";
import { danglingEnds, junctionPoints, partMap, pinPoints, snapTarget } from "./wiring";
import { emptyProject, type LibraryData, type Point, type Project } from "./types";

const parts = partMap(library as unknown as LibraryData);

/** Resistor pins are at local (0,10) and (60,10). */
function project(wires: Point[][], resistors: [number, number][] = []): Project {
  const p = emptyProject();
  p.components = resistors.map(([x, y], i) => ({
    uid: `c${i + 1}`, part: "basic.resistor", ref: `R${i + 1}`, x, y, rot: 0, mirror: false, params: {},
  }));
  p.wires = wires.map((points, i) => ({ uid: `w${i + 1}`, points }));
  return p;
}

describe("wiring helpers", () => {
  it("indexes parts and lists absolute pin points", () => {
    expect(parts.get("basic.resistor")?.refPrefix).toBe("R");
    expect(pinPoints(project([], [[100, 100]]), parts)).toEqual([
      { uid: "c1", pin: "1", point: [100, 110] },
      { uid: "c1", pin: "2", point: [160, 110] },
    ]);
  });

  it("puts a junction dot where a wire ends on another wire", () => {
    const p = project([[[0, 0], [100, 0]], [[50, 0], [50, 50]]]);
    expect(junctionPoints(p, parts)).toEqual([[50, 0]]);
  });

  it("puts a junction dot where three wires meet", () => {
    const p = project([[[0, 0], [50, 0]], [[50, 0], [100, 0]], [[50, 0], [50, 50]]]);
    expect(junctionPoints(p, parts)).toEqual([[50, 0]]);
  });

  it("has no dot for a plain pin-to-pin wire or for crossing wires", () => {
    const pinToPin = project([[[60, 10], [200, 10]]], [[0, 0], [200, 0]]);
    expect(junctionPoints(pinToPin, parts)).toEqual([]);
    const crossing = project([[[0, 0], [100, 0]], [[50, -50], [50, 50]]]);
    expect(junctionPoints(crossing, parts)).toEqual([]);
  });

  it("reports wire ends that connect to nothing", () => {
    const p = project([[[60, 10], [200, 10], [200, 80]]], [[0, 0]]);
    expect(danglingEnds(p, parts)).toEqual([[200, 80]]);
  });

  it("snaps to a nearby pin first, then a wire vertex, then the grid", () => {
    const p = project([[[300, 300], [400, 300]]], [[0, 0]]);
    expect(snapTarget([63, 12], p, parts)).toEqual([60, 10]);
    expect(snapTarget([398, 303], p, parts)).toEqual([400, 300]);
    expect(snapTarget([123, 87], p, parts)).toEqual([120, 90]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL (`./refs` and `./wiring` can't be resolved).

- [ ] **Step 3: Implement**

`app/src/model/refs.ts`:
```ts
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `prefix` + one more than the highest existing number for that prefix. */
export function nextReference(prefix: string, existing: Iterable<string>): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, "i");
  let max = 0;
  for (const ref of existing) {
    const match = pattern.exec(ref);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${max + 1}`;
}

export const nextUid = (prefix: "c" | "w", existing: Iterable<string>): string =>
  nextReference(prefix, existing);

/** Same rule as multysm-core `validate::is_valid_reference`. */
export const isValidReference = (ref: string): boolean => /^[A-Za-z][A-Za-z0-9_]*$/.test(ref);
```

`app/src/model/wiring.ts`:
```ts
import { pinPosition, pointOnSegment, samePoint, snapPoint } from "./geometry";
import type { LibraryData, PartDef, Point, Project } from "./types";

export interface PinPoint {
  uid: string;
  pin: string;
  point: Point;
}

export function partMap(library: LibraryData | null): Map<string, PartDef> {
  return new Map((library?.parts ?? []).map((part) => [part.manifest.id, part]));
}

export function pinPoints(project: Project, parts: Map<string, PartDef>): PinPoint[] {
  return project.components.flatMap((inst) =>
    (parts.get(inst.part)?.manifest.symbol.pins ?? []).map((pin) => ({
      uid: inst.uid,
      pin: pin.id,
      point: pinPosition(inst, pin),
    })),
  );
}

/**
 * How many connections meet at `p`: each wire segment ending at `p` counts 1,
 * a segment passing through `p` counts 2, each pin at `p` counts 1.
 */
function arms(p: Point, project: Project, pins: PinPoint[]): number {
  let count = pins.filter((pin) => samePoint(pin.point, p)).length;
  for (const wire of project.wires) {
    for (let i = 1; i < wire.points.length; i++) {
      const a = wire.points[i - 1];
      const b = wire.points[i];
      if (samePoint(p, a) || samePoint(p, b)) count += 1;
      else if (pointOnSegment(p, a, b)) count += 2;
    }
  }
  return count;
}

function uniqueWireEnds(project: Project): Point[] {
  const ends: Point[] = [];
  for (const wire of project.wires) {
    for (const end of [wire.points[0], wire.points[wire.points.length - 1]]) {
      if (!ends.some((e) => samePoint(e, end))) ends.push(end);
    }
  }
  return ends;
}

/** Points that get a junction dot: three or more connections meet there. */
export function junctionPoints(project: Project, parts: Map<string, PartDef>): Point[] {
  const pins = pinPoints(project, parts);
  return uniqueWireEnds(project).filter((p) => arms(p, project, pins) >= 3);
}

/** Wire ends that touch no pin and no other wire. */
export function danglingEnds(project: Project, parts: Map<string, PartDef>): Point[] {
  const pins = pinPoints(project, parts);
  return uniqueWireEnds(project).filter((p) => arms(p, project, pins) === 1);
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Nearest pin within `radius`, else nearest wire vertex, else the grid point. */
export function snapTarget(p: Point, project: Project, parts: Map<string, PartDef>, radius = 6): Point {
  const nearest = (candidates: Point[]) =>
    candidates
      .map((c) => ({ c, d: distance(c, p) }))
      .filter(({ d }) => d <= radius)
      .sort((x, y) => x.d - y.d)[0]?.c;
  return (
    nearest(pinPoints(project, parts).map((pin) => pin.point)) ??
    nearest(project.wires.flatMap((w) => w.points)) ??
    snapPoint(p)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix app test`
Expected: all pass (refs 4, wiring 6, plus earlier suites).

- [ ] **Step 5: Commit**

```bash
git add app/src/model
git commit -m "feat(app): reference numbering and wiring helpers"
```

---

### Task 6: Editor store (project state, tools, undo/redo)

**Files:**
- Create: `app/src/model/store.ts`, `app/src/model/store.test.ts`

**Interfaces:**
- Consumes: `refs.ts`, `wiring.ts` (`partMap`), `geometry.ts` (`snapPoint`, `simplifyPath`), `types.ts`.
- Produces (`store.ts`):
  - `type Tool = { kind: "select" } | { kind: "place"; partId: string } | { kind: "wire"; points: Point[] }`
  - `type Selection = { kind: "component" | "wire"; uid: string } | null`
  - `type PanelName = "parts" | "properties" | "plot" | "focus"`
  - `interface EditorState` with fields `library, project, filePath, dirty, selection, tool, past, future, clipboard, panels: Record<PanelName, boolean>` and actions `setLibrary(library)`, `newProject()`, `loadProject(project, filePath)`, `markSaved(filePath)`, `setTool(tool)`, `select(selection)`, `placePart(partId, at): string | null`, `beginChange()`, `moveComponent(uid, at)`, `rotateSelected()`, `mirrorSelected()`, `deleteSelected()`, `setParam(uid, key, value)`, `setReference(uid, ref)`, `addWire(points): string | null`, `copySelected()`, `paste(): string | null`, `undo()`, `redo()`, `togglePanel(name)`, `setView(zoom, pan)`
  - `createEditorStore(initial?: { library?: LibraryData | null; project?: Project })`, `type EditorStore`, singleton `editorStore`, hook `useEditor(selector)`
  - `HISTORY_LIMIT = 100`

Behavior: every project-changing action goes through one `commit`, which pushes the previous project to `past` (capped at 100), clears `future` and sets `dirty`. Dragging calls `beginChange()` once at drag start, then `moveComponent` (no history) while moving. `setView` changes neither history nor `dirty`.

- [ ] **Step 1: Write the failing tests**

`app/src/model/store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import library from "@/backend/mock-library.json";
import { createEditorStore, HISTORY_LIMIT, type EditorStore } from "./store";
import { emptyProject, type LibraryData } from "./types";

let store: EditorStore;
const s = () => store.getState();
const comp = (uid: string) => s().project.components.find((c) => c.uid === uid)!;

beforeEach(() => {
  store = createEditorStore({ library: library as unknown as LibraryData });
});

describe("editor store", () => {
  it("places parts with snapped positions, numbered references and selection", () => {
    s().setTool({ kind: "place", partId: "basic.resistor" });
    const a = s().placePart("basic.resistor", [103, 47])!;
    const b = s().placePart("basic.resistor", [200, 0])!;
    const g = s().placePart("sources.ground", [0, 0])!;
    expect(comp(a)).toMatchObject({ ref: "R1", x: 100, y: 50, rot: 0, mirror: false, params: {} });
    expect(comp(b).ref).toBe("R2");
    expect(comp(g).ref).toBe("GND1");
    expect(s().selection).toEqual({ kind: "component", uid: g });
    expect(s().tool).toEqual({ kind: "select" });
    expect(s().dirty).toBe(true);
  });

  it("ignores unknown parts", () => {
    expect(s().placePart("basic.flux_capacitor", [0, 0])).toBeNull();
    expect(s().project.components).toHaveLength(0);
    expect(s().past).toHaveLength(0);
  });

  it("rotates in 90 degree steps and toggles mirror on the selection", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    for (const expected of [90, 180, 270, 0]) {
      s().rotateSelected();
      expect(comp(uid).rot).toBe(expected);
    }
    s().mirrorSelected();
    expect(comp(uid).mirror).toBe(true);
  });

  it("records a drag as one undo step", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().beginChange();
    s().moveComponent(uid, [14, 0]);
    s().moveComponent(uid, [31, 22]);
    expect(comp(uid)).toMatchObject({ x: 30, y: 20 });
    s().undo();
    expect(comp(uid)).toMatchObject({ x: 0, y: 0 });
    s().redo();
    expect(comp(uid)).toMatchObject({ x: 30, y: 20 });
  });

  it("clears redo history when a new change is made", () => {
    s().placePart("basic.resistor", [0, 0]);
    s().undo();
    expect(s().future).toHaveLength(1);
    s().placePart("basic.capacitor", [0, 0]);
    expect(s().future).toHaveLength(0);
  });

  it("caps undo history", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().select({ kind: "component", uid });
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s().mirrorSelected();
    expect(s().past).toHaveLength(HISTORY_LIMIT);
  });

  it("deletes the selected component or wire", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    const wire = s().addWire([[0, 10], [100, 10]])!;
    s().select({ kind: "component", uid });
    s().deleteSelected();
    expect(s().project.components).toHaveLength(0);
    s().select({ kind: "wire", uid: wire });
    s().deleteSelected();
    expect(s().project.wires).toHaveLength(0);
    expect(s().selection).toBeNull();
  });

  it("edits parameters and references", () => {
    const uid = s().placePart("basic.resistor", [0, 0])!;
    s().setParam(uid, "resistance", "4.7k");
    s().setReference(uid, "RLOAD");
    expect(comp(uid)).toMatchObject({ ref: "RLOAD", params: { resistance: "4.7k" } });
  });

  it("adds simplified wires and rejects degenerate ones", () => {
    expect(s().addWire([[0, 0], [0, 0]])).toBeNull();
    const w1 = s().addWire([[0, 0], [10, 0], [20, 0], [20, 30]]);
    const w2 = s().addWire([[0, 0], [0, 50]]);
    expect([w1, w2]).toEqual(["w1", "w2"]);
    expect(s().project.wires[0].points).toEqual([[0, 0], [20, 0], [20, 30]]);
  });

  it("copies and pastes with a new reference and offset", () => {
    const uid = s().placePart("basic.resistor", [100, 100])!;
    s().setParam(uid, "resistance", "10k");
    s().copySelected();
    const pasted = s().paste()!;
    expect(comp(pasted)).toMatchObject({ ref: "R2", x: 120, y: 120, params: { resistance: "10k" } });
    const again = s().paste()!;
    expect(comp(again)).toMatchObject({ ref: "R3", x: 140, y: 140 });
  });

  it("loads and resets projects without history", () => {
    s().placePart("basic.resistor", [0, 0]);
    const loaded = emptyProject();
    s().loadProject(loaded, "C:/demo.msym");
    expect(s()).toMatchObject({ filePath: "C:/demo.msym", dirty: false, selection: null });
    expect(s().past).toHaveLength(0);
    s().placePart("basic.resistor", [0, 0]);
    s().markSaved("C:/other.msym");
    expect(s()).toMatchObject({ filePath: "C:/other.msym", dirty: false });
    s().newProject();
    expect(s().project.components).toHaveLength(0);
    expect(s().filePath).toBeNull();
  });

  it("toggles panels and updates the view without dirtying", () => {
    expect(s().panels.parts).toBe(true);
    s().togglePanel("parts");
    expect(s().panels.parts).toBe(false);
    s().setView(2, [10, 20]);
    expect(s().project.view).toEqual({ zoom: 2, pan: [10, 20] });
    expect(s().dirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL (`./store` can't be resolved).

- [ ] **Step 3: Implement**

`app/src/model/store.ts`:
```ts
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { simplifyPath, snapPoint } from "./geometry";
import { nextReference, nextUid } from "./refs";
import { emptyProject, type ComponentInstance, type LibraryData, type Point, type Project, type Rotation } from "./types";
import { partMap } from "./wiring";

export const HISTORY_LIMIT = 100;

export type Tool = { kind: "select" } | { kind: "place"; partId: string } | { kind: "wire"; points: Point[] };
export type Selection = { kind: "component" | "wire"; uid: string } | null;
export type PanelName = "parts" | "properties" | "plot" | "focus";

export interface EditorState {
  library: LibraryData | null;
  project: Project;
  filePath: string | null;
  dirty: boolean;
  selection: Selection;
  tool: Tool;
  past: Project[];
  future: Project[];
  clipboard: ComponentInstance | null;
  panels: Record<PanelName, boolean>;

  setLibrary(library: LibraryData): void;
  newProject(): void;
  loadProject(project: Project, filePath: string | null): void;
  markSaved(filePath: string): void;
  setTool(tool: Tool): void;
  select(selection: Selection): void;
  placePart(partId: string, at: Point): string | null;
  beginChange(): void;
  moveComponent(uid: string, at: Point): void;
  rotateSelected(): void;
  mirrorSelected(): void;
  deleteSelected(): void;
  setParam(uid: string, key: string, value: string): void;
  setReference(uid: string, ref: string): void;
  addWire(points: Point[]): string | null;
  copySelected(): void;
  paste(): string | null;
  undo(): void;
  redo(): void;
  togglePanel(name: PanelName): void;
  setView(zoom: number, pan: Point): void;
}

const freshSession = () => ({
  filePath: null as string | null,
  dirty: false,
  selection: null as Selection,
  tool: { kind: "select" } as Tool,
  past: [] as Project[],
  future: [] as Project[],
});

export function createEditorStore(initial: { library?: LibraryData | null; project?: Project } = {}) {
  return createStore<EditorState>()((set, get) => {
    const commit = (mutate: (draft: Project) => void) => {
      const { project, past } = get();
      const draft = structuredClone(project);
      mutate(draft);
      set({ project: draft, past: [...past, project].slice(-HISTORY_LIMIT), future: [], dirty: true });
    };
    const withSelectedComponent = (mutate: (c: ComponentInstance) => void) => {
      const selection = get().selection;
      if (selection?.kind !== "component") return;
      commit((d) => {
        const c = d.components.find((c) => c.uid === selection.uid);
        if (c) mutate(c);
      });
    };
    const withComponent = (uid: string, mutate: (c: ComponentInstance) => void) =>
      commit((d) => {
        const c = d.components.find((c) => c.uid === uid);
        if (c) mutate(c);
      });
    const componentUids = () => get().project.components.map((c) => c.uid);
    const references = () => get().project.components.map((c) => c.ref);

    return {
      library: initial.library ?? null,
      project: initial.project ?? emptyProject(),
      ...freshSession(),
      clipboard: null,
      panels: { parts: true, properties: false, plot: false, focus: false },

      setLibrary: (library) => set({ library }),
      newProject: () => set({ project: emptyProject(), ...freshSession() }),
      loadProject: (project, filePath) => set({ project, ...freshSession(), filePath }),
      markSaved: (filePath) => set({ filePath, dirty: false }),
      setTool: (tool) => set({ tool }),
      select: (selection) => set({ selection }),

      placePart: (partId, at) => {
        const part = partMap(get().library).get(partId);
        if (!part) return null;
        const uid = nextUid("c", componentUids());
        const ref = nextReference(part.refPrefix, references());
        const [x, y] = snapPoint(at);
        commit((d) => {
          d.components.push({ uid, part: partId, ref, x, y, rot: 0, mirror: false, params: {} });
        });
        set({ selection: { kind: "component", uid }, tool: { kind: "select" } });
        return uid;
      },

      beginChange: () => {
        const { project, past } = get();
        set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [], dirty: true });
      },

      moveComponent: (uid, at) => {
        const [x, y] = snapPoint(at);
        set((state) => ({
          project: {
            ...state.project,
            components: state.project.components.map((c) => (c.uid === uid ? { ...c, x, y } : c)),
          },
          dirty: true,
        }));
      },

      rotateSelected: () => withSelectedComponent((c) => { c.rot = ((c.rot + 90) % 360) as Rotation; }),
      mirrorSelected: () => withSelectedComponent((c) => { c.mirror = !c.mirror; }),

      deleteSelected: () => {
        const selection = get().selection;
        if (!selection) return;
        commit((d) => {
          if (selection.kind === "component") d.components = d.components.filter((c) => c.uid !== selection.uid);
          else d.wires = d.wires.filter((w) => w.uid !== selection.uid);
        });
        set({ selection: null });
      },

      setParam: (uid, key, value) => withComponent(uid, (c) => { c.params[key] = value; }),
      setReference: (uid, ref) => withComponent(uid, (c) => { c.ref = ref; }),

      addWire: (points) => {
        const path = simplifyPath(points);
        if (path.length < 2) return null;
        const uid = nextUid("w", get().project.wires.map((w) => w.uid));
        commit((d) => { d.wires.push({ uid, points: path }); });
        return uid;
      },

      copySelected: () => {
        const selection = get().selection;
        if (selection?.kind !== "component") return;
        const c = get().project.components.find((c) => c.uid === selection.uid);
        if (c) set({ clipboard: structuredClone(c) });
      },

      paste: () => {
        const clip = get().clipboard;
        const part = clip && partMap(get().library).get(clip.part);
        if (!clip || !part) return null;
        const uid = nextUid("c", componentUids());
        const ref = nextReference(part.refPrefix, references());
        const placed = { ...structuredClone(clip), uid, ref, x: clip.x + 20, y: clip.y + 20 };
        commit((d) => { d.components.push(placed); });
        set({ clipboard: placed, selection: { kind: "component", uid } });
        return uid;
      },

      undo: () => {
        const { past, project, future } = get();
        if (past.length === 0) return;
        set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], selection: null, dirty: true });
      },

      redo: () => {
        const { past, project, future } = get();
        if (future.length === 0) return;
        set({ project: future[0], past: [...past, project], future: future.slice(1), selection: null, dirty: true });
      },

      togglePanel: (name) => set((state) => ({ panels: { ...state.panels, [name]: !state.panels[name] } })),
      setView: (zoom, pan) => set((state) => ({ project: { ...state.project, view: { zoom, pan } } })),
    };
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;

/** The app-wide store. Tests create their own with `createEditorStore`. */
export const editorStore = createEditorStore();

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix app test`
Expected: all pass (store 11 plus earlier suites).

- [ ] **Step 5: Commit**

```bash
git add app/src/model
git commit -m "feat(app): editor store with tools, clipboard and undo/redo"
```

---

### Task 7: Backend interface (Tauri and mock)

**Files:**
- Create: `app/src/backend/backend.ts`, `app/src/backend/tauriBackend.ts`, `app/src/backend/mockBackend.ts`, `app/src/backend/index.ts`, `app/src/backend/backend.test.ts`

**Interfaces:**
- Consumes: Tauri commands from Task 3; `mock-library.json`; `types.ts`.
- Produces:
  - `backend.ts`: `interface Backend { kind: "tauri" | "mock"; loadLibrary(): Promise<LibraryData>; pickOpenPath(): Promise<string | null>; pickSavePath(suggestedName: string): Promise<string | null>; openProject(path): Promise<Project>; saveProject(path, project): Promise<void>; writeRecovery(project): Promise<void>; readRecovery(): Promise<Project | null>; clearRecovery(): Promise<void> }`, `errorMessage(e: unknown): string`
  - `tauriBackend.ts`: `tauriBackend: Backend`
  - `mockBackend.ts`: `createMockBackend(): Backend & { files: Map<string, string> }`, `mockBackend`
  - `index.ts`: `isTauri(): boolean`, `getBackend(): Promise<Backend>` (Tauri inside the desktop window, mock otherwise)

- [ ] **Step 1: Write the failing tests**

`app/src/backend/backend.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { emptyProject } from "@/model/types";
import { errorMessage } from "./backend";
import { getBackend, isTauri } from "./index";
import { createMockBackend } from "./mockBackend";

describe("mock backend", () => {
  it("serves the exported core library", async () => {
    const library = await createMockBackend().loadLibrary();
    expect(library.categories).toHaveLength(15);
    expect(library.parts).toHaveLength(8);
    const resistor = library.parts.find((p) => p.manifest.id === "basic.resistor")!;
    expect(resistor.refPrefix).toBe("R");
    expect(resistor.svg).toContain("<svg");
  });

  it("saves, reopens and remembers the last path", async () => {
    const backend = createMockBackend();
    const project = emptyProject();
    project.components.push({ uid: "c1", part: "basic.resistor", ref: "R1", x: 0, y: 0, rot: 0, mirror: false, params: {} });
    expect(await backend.pickSavePath("untitled.msym")).toBe("untitled.msym");
    await backend.saveProject("demo.msym", project);
    expect(await backend.pickOpenPath()).toBe("demo.msym");
    expect(await backend.openProject("demo.msym")).toEqual(project);
  });

  it("rejects opening a missing file with a message", async () => {
    await expect(createMockBackend().openProject("nope.msym")).rejects.toBe("Cannot open nope.msym: not found");
  });

  it("keeps a recovery copy until cleared", async () => {
    const backend = createMockBackend();
    expect(await backend.readRecovery()).toBeNull();
    await backend.writeRecovery(emptyProject());
    expect(await backend.readRecovery()).toEqual(emptyProject());
    await backend.clearRecovery();
    expect(await backend.readRecovery()).toBeNull();
  });

  it("is selected outside the desktop window", async () => {
    expect(isTauri()).toBe(false);
    expect((await getBackend()).kind).toBe("mock");
  });
});

describe("errorMessage", () => {
  it("reads strings, errors and anything else", () => {
    expect(errorMessage("boom")).toBe("boom");
    expect(errorMessage(new Error("bad"))).toBe("bad");
    expect(errorMessage(42)).toBe("42");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL (backend modules can't be resolved).

- [ ] **Step 3: Implement**

`app/src/backend/backend.ts`:
```ts
import type { LibraryData, Project } from "@/model/types";

/** Everything the UI needs from outside the webview. */
export interface Backend {
  readonly kind: "tauri" | "mock";
  loadLibrary(): Promise<LibraryData>;
  pickOpenPath(): Promise<string | null>;
  pickSavePath(suggestedName: string): Promise<string | null>;
  openProject(path: string): Promise<Project>;
  saveProject(path: string, project: Project): Promise<void>;
  writeRecovery(project: Project): Promise<void>;
  readRecovery(): Promise<Project | null>;
  clearRecovery(): Promise<void>;
}

/** Tauri commands reject with strings; everything else with Errors. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
```

`app/src/backend/tauriBackend.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { LibraryData, Project } from "@/model/types";
import type { Backend } from "./backend";

const filters = [{ name: "multysm project", extensions: ["msym"] }];

export const tauriBackend: Backend = {
  kind: "tauri",
  loadLibrary: () => invoke<LibraryData>("load_library"),
  pickOpenPath: async () => {
    const picked = await open({ multiple: false, directory: false, filters });
    return typeof picked === "string" ? picked : null;
  },
  pickSavePath: async (suggestedName) => (await save({ defaultPath: suggestedName, filters })) ?? null,
  openProject: (path) => invoke<Project>("open_project", { path }),
  saveProject: (path, project) => invoke<void>("save_project", { path, project }),
  writeRecovery: (project) => invoke<void>("write_recovery", { project }),
  readRecovery: () => invoke<Project | null>("read_recovery"),
  clearRecovery: () => invoke<void>("clear_recovery"),
};
```

`app/src/backend/mockBackend.ts`:
```ts
import type { LibraryData, Project } from "@/model/types";
import type { Backend } from "./backend";
import libraryJson from "./mock-library.json";

/** In-memory backend for the plain browser and tests. Rejects with strings like Tauri. */
export function createMockBackend(): Backend & { files: Map<string, string> } {
  const files = new Map<string, string>();
  let recovery: string | null = null;
  let lastPath: string | null = null;
  return {
    kind: "mock",
    files,
    loadLibrary: async () => structuredClone(libraryJson) as unknown as LibraryData,
    pickOpenPath: async () => lastPath,
    pickSavePath: async (suggestedName) => suggestedName,
    openProject: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw `Cannot open ${path}: not found`;
      return JSON.parse(text) as Project;
    },
    saveProject: async (path, project) => {
      files.set(path, JSON.stringify(project));
      lastPath = path;
    },
    writeRecovery: async (project) => {
      recovery = JSON.stringify(project);
    },
    readRecovery: async () => (recovery === null ? null : (JSON.parse(recovery) as Project)),
    clearRecovery: async () => {
      recovery = null;
    },
  };
}

export const mockBackend = createMockBackend();
```

`app/src/backend/index.ts`:
```ts
import type { Backend } from "./backend";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let backend: Promise<Backend> | null = null;

/** The desktop backend inside the Tauri window, the in-memory mock anywhere else. */
export function getBackend(): Promise<Backend> {
  backend ??= isTauri()
    ? import("./tauriBackend").then((m) => m.tauriBackend)
    : import("./mockBackend").then((m) => m.mockBackend);
  return backend;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix app test`
Expected: all pass (backend 6 plus earlier suites).

- [ ] **Step 5: Commit**

```bash
git add app/src/backend
git commit -m "feat(app): backend interface with Tauri and mock implementations"
```

---

### Task 8: App shell layout and panels

**Files:**
- Create: `app/src/test/setup.ts`, `app/src/test/resetEditor.ts`, `app/src/ui/AppShell.tsx`, `app/src/ui/TopBar.tsx`, `app/src/ui/PartsPanel.tsx`, `app/src/ui/partSearch.ts`, `app/src/ui/partSearch.test.ts`, `app/src/ui/PartsPanel.test.tsx`, `app/src/ui/PropertiesPanel.tsx`, `app/src/ui/PropertiesPanel.test.tsx`, `app/src/ui/StatusBar.tsx`, `app/src/ui/PlotDock.tsx`, `app/src/ui/FocusToolbar.tsx`, `app/src/ui/canvas/Canvas.tsx` (placeholder; replaced in Task 9)
- Modify: `app/vitest.config.ts`, `app/src/app/page.tsx`

**Interfaces:**
- Consumes: `editorStore`, `useEditor`, `EditorState` (Task 6); `getBackend`, `errorMessage` (Task 7); `parseSi` (Task 4); `isValidReference` (Task 5); `partMap` (Task 5); `tokens`.
- Produces:
  - `partSearch.ts`: `filterParts(parts: PartDef[], query: string): PartDef[]`, which matches name, id, tags and category case-insensitively, and returns every part (sorted by name) for an empty query
  - `resetEditor(library?)` test helper
  - Default-exported React components: `AppShell`, `TopBar`, `PartsPanel`, `PropertiesPanel`, `StatusBar`, `PlotDock`, `FocusToolbar`, `Canvas`
  - The AppShell loads the library from the backend on mount and shows a `role="alert"` message if loading fails.

Layout rules: flex column. Top bar `h-10`. Middle row: Parts panel (`w-56`, hidden when `panels.parts` is false), canvas (`flex-1`), Properties panel (`w-64`, shown when a selection exists or `panels.properties` is pinned). Plot dock `h-48` when `panels.plot`. Status bar `h-6`. In Focus mode (`panels.focus`) only the canvas and the floating `FocusToolbar` render. Panels use `bg-panel` with `border-line` borders, text is `text-text` or `text-muted`, and there are no heavy shadows.

- [ ] **Step 1: Test setup and helper**

Add the DOM matchers: `npm --prefix app install --save-dev @testing-library/jest-dom@^6`.

`app/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

`app/src/test/resetEditor.ts`:
```ts
import library from "@/backend/mock-library.json";
import { editorStore } from "@/model/store";
import type { LibraryData } from "@/model/types";

export const testLibrary = library as unknown as LibraryData;

/** Resets the app-wide store between UI tests (keeps its bound actions). */
export function resetEditor(lib: LibraryData | null = testLibrary) {
  editorStore.getState().newProject();
  editorStore.setState({
    library: lib,
    clipboard: null,
    panels: { parts: true, properties: false, plot: false, focus: false },
  });
}
```

In `app/vitest.config.ts`, add `setupFiles: ["src/test/setup.ts"]` inside `test`.

- [ ] **Step 2: Write the failing tests**

`app/src/ui/partSearch.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { testLibrary } from "@/test/resetEditor";
import { filterParts } from "./partSearch";

const ids = (query: string) => filterParts(testLibrary.parts, query).map((p) => p.manifest.id);

describe("filterParts", () => {
  it("returns every part sorted by name for an empty query", () => {
    const all = filterParts(testLibrary.parts, "  ");
    expect(all).toHaveLength(8);
    expect(all.map((p) => p.manifest.name)).toEqual([...all.map((p) => p.manifest.name)].sort());
  });

  it("matches names, ids, tags and categories case-insensitively", () => {
    expect(ids("resist")).toEqual(["basic.resistor"]);
    expect(ids("NAND")).toEqual(["ttl.7400"]);
    expect(ids("ttl")).toEqual(["ttl.7400"]);
    expect(ids("555")).toEqual(["mixed.555"]);
    expect(ids("zzz")).toEqual([]);
  });
});
```

`app/src/ui/PartsPanel.test.tsx`:
```tsx
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
```

`app/src/ui/PropertiesPanel.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import PropertiesPanel from "./PropertiesPanel";

const state = () => editorStore.getState();
let uid: string;

beforeEach(() => {
  resetEditor();
  uid = state().placePart("basic.resistor", [0, 0])!;
});

describe("PropertiesPanel", () => {
  it("shows the selected part with its defaults", () => {
    render(<PropertiesPanel />);
    expect(screen.getByText("Resistor")).toBeTruthy();
    expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe("R1");
    expect((screen.getByLabelText("Resistance") as HTMLInputElement).value).toBe("1k");
  });

  it("commits a valid SI value on Enter", () => {
    render(<PropertiesPanel />);
    const input = screen.getByLabelText("Resistance");
    fireEvent.change(input, { target: { value: "4.7k" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(state().project.components[0].params.resistance).toBe("4.7k");
  });

  it("shows an error and does not commit an invalid value", () => {
    render(<PropertiesPanel />);
    const input = screen.getByLabelText("Resistance");
    fireEvent.change(input, { target: { value: "lots" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("not a number");
    expect(state().project.components[0].params.resistance).toBeUndefined();
  });

  it("validates references", () => {
    render(<PropertiesPanel />);
    const input = screen.getByLabelText("Reference");
    fireEvent.change(input, { target: { value: "1R" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("letter");
    expect(state().project.components[0].ref).toBe("R1");
    fireEvent.change(input, { target: { value: "RLOAD" } });
    fireEvent.blur(input);
    expect(state().project.components[0].ref).toBe("RLOAD");
  });

  it("rotates, mirrors and deletes from buttons", () => {
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("button", { name: "Mirror" }));
    expect(state().project.components[0]).toMatchObject({ rot: 90, mirror: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(state().project.components.find((c) => c.uid === uid)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL (UI modules can't be resolved).

- [ ] **Step 4: Implement**

`app/src/ui/partSearch.ts`:
```ts
import type { PartDef } from "@/model/types";

export function filterParts(parts: PartDef[], query: string): PartDef[] {
  const q = query.trim().toLowerCase();
  const matches = q === ""
    ? parts
    : parts.filter(({ manifest: m }) =>
        [m.name, m.id, m.category, ...m.tags].some((field) => field.toLowerCase().includes(q)));
  return [...matches].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}
```

`app/src/ui/PartsPanel.tsx`:
```tsx
"use client";

import { useMemo, useState } from "react";
import { useEditor } from "@/model/store";
import { CATEGORIES, type PartDef } from "@/model/types";
import { filterParts } from "./partSearch";

export default function PartsPanel() {
  const library = useEditor((s) => s.library);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const parts = library?.parts ?? [];
  const activeId = tool.kind === "place" ? tool.partId : null;
  const filtered = useMemo(() => filterParts(parts, query), [parts, query]);

  const partButton = (part: PartDef) => (
    <button
      key={part.manifest.id}
      aria-label={`place ${part.manifest.name}`}
      onClick={() => setTool({ kind: "place", partId: part.manifest.id })}
      className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-line ${
        activeId === part.manifest.id ? "bg-line text-selected" : "text-text"
      }`}
    >
      {part.manifest.name}
    </button>
  );

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search parts…"
        className="m-2 rounded border border-line bg-bg px-2 py-1 text-text placeholder:text-muted focus:outline-none focus:border-accent"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {library === null && <div className="px-2 py-1 text-muted">Loading parts…</div>}
        {query.trim() !== ""
          ? filtered.length > 0
            ? filtered.map(partButton)
            : <div className="px-2 py-1 text-muted">No parts match</div>
          : CATEGORIES.map((category) => {
              const inCategory = filtered.filter((p) => p.manifest.category === category);
              const empty = inCategory.length === 0;
              const open = !empty && !collapsed.has(category);
              return (
                <div key={category}>
                  <button
                    aria-label={`category ${category}`}
                    disabled={empty}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(category)) next.delete(category);
                        else next.add(category);
                        return next;
                      })
                    }
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-left ${
                      empty ? "cursor-default text-muted/60" : "text-muted hover:text-text"
                    }`}
                  >
                    <span>{open ? "▾" : "▸"} {category}</span>
                    {empty && <span className="text-[11px]">coming soon</span>}
                  </button>
                  {open && <div className="ml-3">{inCategory.map(partButton)}</div>}
                </div>
              );
            })}
      </div>
    </aside>
  );
}
```

`app/src/ui/PropertiesPanel.tsx`:
```tsx
"use client";

import { useState } from "react";
import { isValidReference } from "@/model/refs";
import { parseSi } from "@/model/si";
import { useEditor } from "@/model/store";
import { partMap } from "@/model/wiring";

/** Text field that validates on commit (Enter or blur) and shows an inline error. */
function Field(props: {
  label: string;
  unit?: string;
  initial: string;
  validate: (value: string) => string | null;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  const [error, setError] = useState<string | null>(null);
  const id = `field-${props.label.replace(/\s+/g, "-").toLowerCase()}`;
  const commit = () => {
    const problem = props.validate(value);
    setError(problem);
    if (!problem && value !== props.initial) props.onCommit(value);
  };
  return (
    <div className="border-b border-line py-2">
      <label htmlFor={id} className="mb-1 block text-muted">{props.label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className={`min-w-0 flex-1 rounded border bg-bg px-2 py-1 text-text focus:outline-none ${
            error ? "border-error" : "border-line focus:border-accent"
          }`}
        />
        {props.unit && <span className="text-muted">{props.unit}</span>}
      </div>
      {error && <div role="alert" className="mt-1 text-error">{error}</div>}
    </div>
  );
}

const panelButton = "rounded border border-line px-2 py-1 text-text hover:border-accent";

export default function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const { rotateSelected, mirrorSelected, deleteSelected, setParam, setReference } = useEditor((s) => s);

  if (!selection) {
    return (
      <aside className="w-64 shrink-0 border-l border-line bg-panel p-3 text-muted">Nothing selected</aside>
    );
  }

  if (selection.kind === "wire") {
    return (
      <aside className="w-64 shrink-0 border-l border-line bg-panel p-3">
        <div className="mb-3 text-muted">WIRE · {selection.uid}</div>
        <button className={panelButton} onClick={deleteSelected}>Delete</button>
      </aside>
    );
  }

  const component = project.components.find((c) => c.uid === selection.uid);
  const part = component && partMap(library).get(component.part);
  if (!component || !part) return null;

  return (
    <aside key={component.uid} className="w-64 shrink-0 overflow-y-auto border-l border-line bg-panel p-3">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{part.manifest.category}</div>
      <div className="mb-2 text-text">{part.manifest.name}</div>
      <Field
        label="Reference"
        initial={component.ref}
        validate={(v) => (isValidReference(v) ? null : "Use a letter followed by letters, digits or _")}
        onCommit={(v) => setReference(component.uid, v)}
      />
      {part.manifest.params.map((param) => (
        <Field
          key={param.key}
          label={param.label}
          unit={param.unit}
          initial={component.params[param.key] ?? param.default}
          validate={(v) => {
            if (param.type === "text") return null;
            const parsed = parseSi(v);
            return parsed.ok ? null : parsed.error;
          }}
          onCommit={(v) => setParam(component.uid, param.key, v)}
        />
      ))}
      <div className="mt-3 text-muted">Rotation {component.rot}°{component.mirror ? " · mirrored" : ""}</div>
      <div className="mt-2 flex gap-2">
        <button className={panelButton} onClick={rotateSelected}>Rotate</button>
        <button className={panelButton} onClick={mirrorSelected}>Mirror</button>
        <button className={panelButton} onClick={deleteSelected}>Delete</button>
      </div>
    </aside>
  );
}
```

`app/src/ui/TopBar.tsx`:
```tsx
"use client";

import { useEditor } from "@/model/store";

const barButton = "rounded px-2 py-1 text-muted hover:bg-line hover:text-text disabled:opacity-40";

export default function TopBar() {
  const { tool, setTool, undo, redo, past, future, filePath, dirty } = useEditor((s) => s);
  const name = filePath ? filePath.split(/[\\/]/).pop() : "Untitled";
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-3">
      <span className="mr-3 font-semibold text-accent">multysm</span>
      <button className={`${barButton} ${tool.kind === "select" ? "text-text" : ""}`} onClick={() => setTool({ kind: "select" })} title="Select (Esc)">Select</button>
      <button className={`${barButton} ${tool.kind === "wire" ? "text-text" : ""}`} onClick={() => setTool({ kind: "wire", points: [] })} title="Wire (W)">Wire</button>
      <span className="mx-2 h-5 w-px bg-line" />
      <button className={barButton} onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">Undo</button>
      <button className={barButton} onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Y)">Redo</button>
      <span className="flex-1 truncate text-center text-muted">{name}{dirty ? " •" : ""}</span>
      <button className="rounded bg-accent px-3 py-1 font-semibold text-bg opacity-40" disabled title="Simulation arrives in Plan 3">▶ Run</button>
    </header>
  );
}
```

`app/src/ui/StatusBar.tsx`:
```tsx
"use client";

import { GRID } from "@/model/geometry";
import { useEditor } from "@/model/store";

export default function StatusBar() {
  const { tool, project, library } = useEditor((s) => s);
  const zoom = Math.round((project.view?.zoom ?? 1) * 100);
  const issues = library?.issues ?? [];
  const toolName = tool.kind === "place" ? `Placing ${tool.partId}` : tool.kind === "wire" ? "Wire" : "Select";
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[12px] text-muted">
      <span>{toolName}</span>
      <span>Grid {GRID}</span>
      <span>Zoom {zoom}%</span>
      <span>{project.components.length} parts · {project.wires.length} wires</span>
      <span className="flex-1" />
      {issues.length > 0 && (
        <span className="text-error" title={issues.map((i) => `${i.path}: ${i.message}`).join("\n")}>
          {issues.length} library issue{issues.length === 1 ? "" : "s"}
        </span>
      )}
    </footer>
  );
}
```

`app/src/ui/PlotDock.tsx`:
```tsx
export default function PlotDock() {
  return (
    <section className="flex h-48 shrink-0 items-center justify-center border-t border-line bg-panel text-muted">
      Simulation results appear here after Run.
    </section>
  );
}
```

`app/src/ui/FocusToolbar.tsx`:
```tsx
"use client";

import { useEditor } from "@/model/store";

const button = "rounded px-2 py-1 text-muted hover:bg-line hover:text-text";

export default function FocusToolbar() {
  const { setTool, togglePanel } = useEditor((s) => s);
  return (
    <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1 rounded-lg border border-line bg-panel p-1">
      <button className={button} onClick={() => setTool({ kind: "select" })}>Select</button>
      <button className={button} onClick={() => setTool({ kind: "wire", points: [] })}>Wire</button>
      <span className="mx-1 w-px bg-line" />
      <button className={button} onClick={() => togglePanel("focus")} title="Exit focus (F11)">Exit focus</button>
    </div>
  );
}
```

`app/src/ui/canvas/Canvas.tsx` (placeholder until Task 9):
```tsx
export default function Canvas() {
  return <div className="h-full w-full bg-bg" data-testid="canvas" />;
}
```

`app/src/ui/AppShell.tsx`:
```tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { errorMessage } from "@/backend/backend";
import { getBackend } from "@/backend/index";
import { editorStore, useEditor } from "@/model/store";
import FocusToolbar from "./FocusToolbar";
import PartsPanel from "./PartsPanel";
import PlotDock from "./PlotDock";
import PropertiesPanel from "./PropertiesPanel";
import StatusBar from "./StatusBar";
import TopBar from "./TopBar";

// Konva needs a real browser canvas, so the canvas never renders on the server.
const Canvas = dynamic(() => import("./canvas/Canvas"), { ssr: false, loading: () => <div className="h-full bg-bg" /> });

export default function AppShell() {
  const panels = useEditor((s) => s.panels);
  const selection = useEditor((s) => s.selection);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getBackend()
      .then((backend) => backend.loadLibrary())
      .then((library) => { if (alive) editorStore.getState().setLibrary(library); })
      .catch((e) => { if (alive) setLoadError(`Could not load parts: ${errorMessage(e)}`); });
    return () => { alive = false; };
  }, []);

  const focus = panels.focus;
  const showProperties = !focus && (panels.properties || selection !== null);

  return (
    <div className="flex h-full flex-col">
      {!focus && <TopBar />}
      <div className="flex min-h-0 flex-1">
        {!focus && panels.parts && <PartsPanel />}
        <main className="relative min-w-0 flex-1">
          <Canvas />
          {focus && <FocusToolbar />}
          {loadError && (
            <div role="alert" className="absolute bottom-3 left-3 rounded border border-error bg-panel px-3 py-2 text-error">
              {loadError}
            </div>
          )}
        </main>
        {showProperties && <PropertiesPanel />}
      </div>
      {!focus && panels.plot && <PlotDock />}
      {!focus && <StatusBar />}
    </div>
  );
}
```

Replace `app/src/app/page.tsx`:
```tsx
import AppShell from "@/ui/AppShell";

export default function Home() {
  return <AppShell />;
}
```

- [ ] **Step 5: Run tests and build**

Run: `npm --prefix app test`
Expected: all pass (partSearch 2, PartsPanel 3, PropertiesPanel 5 plus earlier suites).

Run: `npm --prefix app run build`
Expected: the static export succeeds.

Run: `npm --prefix app run dev` and open http://localhost:3000.
Expected: dark layout with top bar, a parts panel listing 15 categories (Basic, Sources, Diodes, TTL and Mixed have parts), a dark canvas area and a status bar. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat(app): soft-dark app shell with parts and properties panels"
```

---

### Task 9: Schematic canvas (render, select, move, place, pan, zoom)

**Files:**
- Create: `app/src/ui/canvas/viewport.ts`, `app/src/ui/canvas/viewport.test.ts`, `app/src/ui/canvas/symbolImage.ts`, `app/src/ui/canvas/symbolImage.test.ts`, `app/src/ui/canvas/PartNode.tsx`, `app/src/ui/canvas/WireLayer.tsx`
- Modify: `app/src/ui/canvas/Canvas.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `editorStore`, `useEditor` (Task 6); `partMap`, `snapTarget`, `junctionPoints`, `danglingEnds` (Task 5); `GRID`, `snapPoint`, `partBounds` (Task 4); `tokens`.
- Produces:
  - `viewport.ts`: `MIN_ZOOM = 0.25`, `MAX_ZOOM = 4`, `ZOOM_STEP = 1.1`, `screenToWorld(p, zoom, pan): Point`, `worldToScreen(p, zoom, pan): Point`, `zoomAt(zoom, pan, screen, deltaY): { zoom; pan }`, `gridStyle(zoom, pan): CSSProperties`
  - `symbolImage.ts`: `RASTER_SCALE = 4`, `symbolDataUrl(svg, color, width, height): string`, `useSymbolImage(svg, color, width, height): HTMLImageElement | undefined`
  - `Canvas` (default export). The canvas container has `data-testid="canvas"`. Screen position of a world point = canvas bounding box origin + `worldToScreen(point, zoom, pan)`.
  - `PartNode` props: `{ inst: ComponentInstance; part: PartDef; selected: boolean; interactive: boolean; ghost?: boolean }`. `WireLayer` props: `{ project; parts; selection; selectable: boolean }`.

Canvas behavior:
- **Stage transform:** the stage is offset by `project.view.pan` and scaled by `project.view.zoom`. The dot grid is a CSS background that follows the same transform.
- **Zoom:** the mouse wheel zooms about the cursor, clamped to 0.25–4.
- **Pan:** middle-drag, or left-drag while Space is held.
- **Select tool:**
  - Clicking a part or wire selects it; clicking empty canvas clears the selection.
  - Dragging a part calls `beginChange()` once, then `moveComponent` with grid snapping.
- **Place tool:** a 50%-opacity ghost follows the snapped cursor, and clicking places the part (the store switches back to the select tool).
- **Rendering:**
  - Parts use their SVG symbol recolored to `text`, or to `selected` when selected. Small `muted` pin dots.
  - Each part has a label above its bounds: reference plus first parameter value, e.g. `R1 1k`.
  - Wires are drawn in `wire` (`selected` when selected), 1.5 px wide at every zoom.
  - Junction dots use `wire`; dangling wire ends get a small `error` ring.
- **Wire clicks:** while the wire tool is active, clicks pass through parts and wires to the stage (Task 10 handles them).

- [ ] **Step 1: Write the failing tests**

`app/src/ui/canvas/viewport.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Point } from "@/model/types";
import { gridStyle, MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen, zoomAt } from "./viewport";

describe("viewport", () => {
  it("converts between screen and world coordinates", () => {
    const pan: Point = [100, 50];
    expect(screenToWorld([300, 250], 2, pan)).toEqual([100, 100]);
    expect(worldToScreen([100, 100], 2, pan)).toEqual([300, 250]);
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    const pan: Point = [40, -20];
    const cursor: Point = [500, 300];
    const before = screenToWorld(cursor, 1, pan);
    const next = zoomAt(1, pan, cursor, -100);
    expect(next.zoom).toBeCloseTo(1.1);
    const after = screenToWorld(cursor, next.zoom, next.pan);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(zoomAt(1, pan, cursor, 100).zoom).toBeCloseTo(1 / 1.1);
  });

  it("clamps zoom", () => {
    expect(zoomAt(MAX_ZOOM, [0, 0], [0, 0], -1).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(MIN_ZOOM, [0, 0], [0, 0], 1).zoom).toBe(MIN_ZOOM);
  });

  it("sizes the dot grid with zoom and follows pan", () => {
    expect(gridStyle(1, [0, 0])).toMatchObject({ backgroundSize: "20px 20px", backgroundPosition: "-10px -10px" });
    expect(gridStyle(2, [30, 40])).toMatchObject({ backgroundSize: "40px 40px", backgroundPosition: "10px 20px" });
    expect(gridStyle(0.3, [0, 0]).backgroundSize).toBe("15px 15px");
  });
});
```

`app/src/ui/canvas/symbolImage.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { symbolDataUrl } from "./symbolImage";

const decode = (url: string) => decodeURIComponent(url.slice("data:image/svg+xml;charset=utf-8,".length));

describe("symbolDataUrl", () => {
  it("recolors currentColor and sets the raster size", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20" stroke="currentColor"><path d="M0 10h60"/></svg>';
    const out = decode(symbolDataUrl(svg, "#c9ced8", 240, 80));
    expect(out).toContain('stroke="#c9ced8"');
    expect(out).not.toContain("currentColor");
    expect(out).toMatch(/^<svg[^>]* width="240" height="80"/);
  });

  it("replaces existing width and height attributes", () => {
    const out = decode(symbolDataUrl('<svg width="10" height="5" viewBox="0 0 10 5"></svg>', "#fff", 40, 20));
    expect(out.match(/width=/g)).toHaveLength(1);
    expect(out).toContain('width="40" height="20"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL (`./viewport` and `./symbolImage` can't be resolved).

- [ ] **Step 3: Implement the pure helpers**

`app/src/ui/canvas/viewport.ts`:
```ts
import type { CSSProperties } from "react";
import { GRID } from "@/model/geometry";
import type { Point } from "@/model/types";
import { tokens } from "@/theme/tokens";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.1;

export const screenToWorld = ([sx, sy]: Point, zoom: number, pan: Point): Point =>
  [(sx - pan[0]) / zoom, (sy - pan[1]) / zoom];

export const worldToScreen = ([wx, wy]: Point, zoom: number, pan: Point): Point =>
  [wx * zoom + pan[0], wy * zoom + pan[1]];

/** Zoom one step in (deltaY < 0) or out about `screen`, keeping that world point fixed. */
export function zoomAt(zoom: number, pan: Point, screen: Point, deltaY: number): { zoom: number; pan: Point } {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP));
  const [wx, wy] = screenToWorld(screen, zoom, pan);
  return { zoom: next, pan: [screen[0] - wx * next, screen[1] - wy * next] };
}

/** Subtle dot grid as a CSS background: a dot every 2 grid cells (every 5 when zoomed far out). */
export function gridStyle(zoom: number, pan: Point): CSSProperties {
  const size = GRID * (zoom < 0.5 ? 5 : 2) * zoom;
  return {
    backgroundColor: tokens.bg,
    backgroundImage: `radial-gradient(circle, ${tokens.grid} 1px, transparent 1.5px)`,
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${pan[0] - size / 2}px ${pan[1] - size / 2}px`,
  };
}
```

`app/src/ui/canvas/symbolImage.ts`:
```ts
"use client";

import { useEffect, useMemo, useState } from "react";

/** Symbols are rasterized at 4x (MAX_ZOOM) so they stay crisp when zoomed in. */
export const RASTER_SCALE = 4;

export function symbolDataUrl(svg: string, color: string, width: number, height: number): string {
  const sized = svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) =>
    `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="${width}" height="${height}">`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized.replaceAll("currentColor", color))}`;
}

const cache = new Map<string, HTMLImageElement>();

export function useSymbolImage(svg: string, color: string, width: number, height: number) {
  const url = useMemo(
    () => symbolDataUrl(svg, color, width * RASTER_SCALE, height * RASTER_SCALE),
    [svg, color, width, height],
  );
  const [loaded, setLoaded] = useState<HTMLImageElement | undefined>(undefined);

  useEffect(() => {
    let image = cache.get(url);
    if (!image) {
      image = new window.Image();
      image.src = url;
      cache.set(url, image);
    }
    if (image.complete && image.naturalWidth > 0) {
      setLoaded(image);
      return;
    }
    const target = image;
    const onLoad = () => setLoaded(target);
    target.addEventListener("load", onLoad);
    return () => target.removeEventListener("load", onLoad);
  }, [url]);

  return loaded && loaded.src === url ? loaded : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix app test`
Expected: all pass (viewport 4, symbolImage 2 plus earlier suites).

- [ ] **Step 5: Implement the canvas components**

`app/src/ui/canvas/PartNode.tsx`:
```tsx
"use client";

import { Circle, Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { partBounds, snapPoint } from "@/model/geometry";
import { editorStore } from "@/model/store";
import type { ComponentInstance, PartDef } from "@/model/types";
import { tokens } from "@/theme/tokens";
import { useSymbolImage } from "./symbolImage";

interface Props {
  inst: ComponentInstance;
  part: PartDef;
  selected: boolean;
  /** Clickable and draggable (select tool only). */
  interactive: boolean;
  ghost?: boolean;
}

export default function PartNode({ inst, part, selected, interactive, ghost = false }: Props) {
  const { width, height, pins } = part.manifest.symbol;
  const image = useSymbolImage(part.svg, selected ? tokens.selected : tokens.text, width, height);
  const bounds = partBounds(inst, part.manifest.symbol);
  const firstParam = part.manifest.params[0];
  const label = firstParam ? `${inst.ref} ${inst.params[firstParam.key] ?? firstParam.default}` : inst.ref;

  return (
    <>
      <Group
        x={inst.x}
        y={inst.y}
        rotation={inst.rot}
        scaleX={inst.mirror ? -1 : 1}
        opacity={ghost ? 0.5 : 1}
        listening={interactive}
        draggable={interactive}
        onMouseDown={(e) => {
          if (e.evt.button !== 0) return; // let middle-drag pan the stage
          e.cancelBubble = true;
          editorStore.getState().select({ kind: "component", uid: inst.uid });
        }}
        onDragStart={() => {
          const state = editorStore.getState();
          state.select({ kind: "component", uid: inst.uid });
          state.beginChange();
        }}
        onDragMove={(e) => {
          const [x, y] = snapPoint([e.target.x(), e.target.y()]);
          e.target.position({ x, y });
          editorStore.getState().moveComponent(inst.uid, [x, y]);
        }}
      >
        <Rect width={width} height={height} fill="rgba(0,0,0,0)" />
        {image && <KonvaImage image={image} width={width} height={height} listening={false} />}
        {pins.map((pin) => (
          <Circle key={pin.id} x={pin.x} y={pin.y} radius={1.5} fill={tokens.muted} listening={false} />
        ))}
      </Group>
      {!ghost && (
        <Text
          x={bounds.x}
          y={bounds.y - 14}
          text={label}
          fontSize={11}
          fontFamily="Segoe UI, system-ui, sans-serif"
          fill={selected ? tokens.selected : tokens.muted}
          listening={false}
        />
      )}
    </>
  );
}
```

`app/src/ui/canvas/WireLayer.tsx`:
```tsx
"use client";

import { useMemo } from "react";
import { Circle, Line } from "react-konva";
import { editorStore, type Selection } from "@/model/store";
import type { PartDef, Project } from "@/model/types";
import { danglingEnds, junctionPoints } from "@/model/wiring";
import { tokens } from "@/theme/tokens";

interface Props {
  project: Project;
  parts: Map<string, PartDef>;
  selection: Selection;
  selectable: boolean;
}

export default function WireLayer({ project, parts, selection, selectable }: Props) {
  const junctions = useMemo(() => junctionPoints(project, parts), [project, parts]);
  const dangling = useMemo(() => danglingEnds(project, parts), [project, parts]);
  return (
    <>
      {project.wires.map((wire) => {
        const selected = selection?.kind === "wire" && selection.uid === wire.uid;
        return (
          <Line
            key={wire.uid}
            points={wire.points.flat()}
            stroke={selected ? tokens.selected : tokens.wire}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            hitStrokeWidth={10}
            lineCap="round"
            lineJoin="round"
            listening={selectable}
            onMouseDown={(e) => {
              if (e.evt.button !== 0) return;
              e.cancelBubble = true;
              editorStore.getState().select({ kind: "wire", uid: wire.uid });
            }}
          />
        );
      })}
      {junctions.map(([x, y]) => (
        <Circle key={`j${x},${y}`} x={x} y={y} radius={3} fill={tokens.wire} listening={false} />
      ))}
      {dangling.map(([x, y]) => (
        <Circle key={`d${x},${y}`} x={x} y={y} radius={2.5} stroke={tokens.error} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      ))}
    </>
  );
}
```

Replace `app/src/ui/canvas/Canvas.tsx`:
```tsx
"use client";

import type Konva from "konva";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Layer, Stage } from "react-konva";
import { snapPoint } from "@/model/geometry";
import { editorStore, useEditor } from "@/model/store";
import type { Point } from "@/model/types";
import { partMap } from "@/model/wiring";
import PartNode from "./PartNode";
import WireLayer from "./WireLayer";
import { gridStyle, screenToWorld, zoomAt } from "./viewport";

function useElementSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function useSpaceHeld() {
  const held = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) held.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") held.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return held;
}

export default function Canvas() {
  const container = useRef<HTMLDivElement>(null);
  const size = useElementSize(container);
  const spaceHeld = useSpaceHeld();
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const parts = useMemo(() => partMap(library), [library]);
  const zoom = project.view?.zoom ?? 1;
  const pan: Point = project.view?.pan ?? [0, 0];
  const [pointer, setPointer] = useState<Point | null>(null);
  const panStart = useRef<{ mouse: Point; pan: Point } | null>(null);

  const worldPointer = (stage: Konva.Stage | null): Point | null => {
    const p = stage?.getPointerPosition();
    return p ? screenToWorld([p.x, p.y], zoom, pan) : null;
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = e.target.getStage()?.getPointerPosition();
    if (!p) return;
    const next = zoomAt(zoom, pan, [p.x, p.y], e.evt.deltaY);
    editorStore.getState().setView(next.zoom, next.pan);
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceHeld.current)) {
      e.evt.preventDefault();
      panStart.current = { mouse: [e.evt.clientX, e.evt.clientY], pan };
      return;
    }
    if (e.evt.button !== 0) return;
    const world = worldPointer(e.target.getStage());
    if (!world) return;
    const state = editorStore.getState();
    if (state.tool.kind === "place") {
      state.placePart(state.tool.partId, world);
    } else if (state.tool.kind === "select" && e.target === e.target.getStage()) {
      state.select(null);
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const start = panStart.current;
    if (start) {
      editorStore.getState().setView(zoom, [
        start.pan[0] + e.evt.clientX - start.mouse[0],
        start.pan[1] + e.evt.clientY - start.mouse[1],
      ]);
      return;
    }
    setPointer(worldPointer(e.target.getStage()));
  };

  const endPan = () => {
    panStart.current = null;
  };

  const placing = tool.kind === "place" ? parts.get(tool.partId) : undefined;
  const ghostAt = pointer && snapPoint(pointer);

  return (
    <div
      ref={container}
      data-testid="canvas"
      className="h-full w-full overflow-hidden"
      style={gridStyle(zoom, pan)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={pan[0]}
          y={pan[1]}
          scaleX={zoom}
          scaleY={zoom}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endPan}
          onMouseLeave={() => {
            endPan();
            setPointer(null);
          }}
        >
          <Layer>
            <WireLayer project={project} parts={parts} selection={selection} selectable={tool.kind === "select"} />
            {project.components.map((inst) => {
              const part = parts.get(inst.part);
              return part ? (
                <PartNode
                  key={inst.uid}
                  inst={inst}
                  part={part}
                  selected={selection?.kind === "component" && selection.uid === inst.uid}
                  interactive={tool.kind === "select"}
                />
              ) : null;
            })}
            {placing && ghostAt && (
              <PartNode
                inst={{ uid: "ghost", part: placing.manifest.id, ref: "", x: ghostAt[0], y: ghostAt[1], rot: 0, mirror: false, params: {} }}
                part={placing}
                selected={false}
                interactive={false}
                ghost
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Build and try it**

Run: `npm --prefix app test && npm --prefix app run build`
Expected: tests pass, and the static export succeeds (Konva stays out of the server render thanks to the dynamic import in `AppShell`).

Run: `npm --prefix app run dev` and open http://localhost:3000.
Expected:
- Clicking **Resistor** in the parts panel shows a translucent ghost that follows the cursor; clicking the canvas places `R1 1k`.
- Dragging it snaps to the grid, clicking empty space deselects, the wheel zooms about the cursor, and middle-drag pans.

Stop the server.

- [ ] **Step 7: Commit**

```bash
git add app/src/ui/canvas
git commit -m "feat(app): Konva schematic canvas with place, select, move, pan and zoom"
```

---

### Task 10: Wire tool, keyboard shortcuts and part palette

**Files:**
- Create: `app/src/model/wireTool.ts`, `app/src/model/wireTool.test.ts`, `app/src/ui/useShortcuts.ts`, `app/src/ui/useShortcuts.test.ts`, `app/src/ui/CommandPalette.tsx`, `app/src/ui/CommandPalette.test.tsx`
- Modify: `app/src/ui/canvas/Canvas.tsx`, `app/src/ui/AppShell.tsx`, `app/src/ui/TopBar.tsx`, `app/src/ui/FocusToolbar.tsx`

**Interfaces:**
- Consumes: `orthogonalRoute`, `pointOnSegment`, `samePoint`, `simplifyPath` (Task 4); `pinPoints`, `snapTarget` (Task 5); `EditorStore`, `editorStore` (Task 6); `filterParts` (Task 8).
- Produces:
  - `wireTool.ts`: `isConnectionPoint(p, project, parts): boolean` (a pin, or any point on a wire), `wireClick(points, target, connection): { points: Point[]; finished: Point[] | null }`, `wirePreview(points, cursor): Point[]`
  - `useShortcuts.ts`: `interface ShortcutActions { openPalette(): void; newFile?(): void; open?(): void; save?(): void; saveAs?(): void }`, `interface KeyInput { key; ctrlKey; metaKey; shiftKey; target }`, `handleShortcut(e: KeyInput, store: EditorStore, actions): boolean` (true = handled, so the caller calls `preventDefault`), `useShortcuts(actions)`
  - `CommandPalette` props `{ open: boolean; onClose(): void }`; the dialog has `role="dialog"` and `aria-label="Place a part"`
  - `TopBar` props `{ onOpenPalette(): void }`; `FocusToolbar` props `{ onOpenPalette(): void }`

Wire tool behavior:
- **Target:** each left click uses the `snapTarget` point (nearest pin, else wire vertex, else grid).
- **First click** starts the wire.
- **Later clicks** extend it with an orthogonal (horizontal-first) route.
- **Finishing:** clicking a connection point (pin or wire) commits the wire with `addWire`, and the tool stays in wire mode ready for the next wire. Double-click also commits the path drawn so far.
- **Escape** drops an unfinished wire; a second Escape returns to the select tool.
- **Preview:** a dashed `wire`-colored line shows the path to the cursor, plus a small `accent` ring at the snap target.
- **Cursor:** crosshair while placing or wiring.

Shortcut map, all ignored while typing in an input or textarea:

| Key | Action |
|---|---|
| `Ctrl/Cmd+K`, `P` | Open palette |
| `Ctrl+Z` | Undo |
| `Ctrl+Y`, `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / paste |
| `Ctrl+B` | Toggle Parts panel |
| `Ctrl+I` | Pin Properties panel |
| `Ctrl+J` | Toggle plot dock |
| `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S` | File actions (only when provided) |
| `F11` | Focus mode |
| `Escape` | Clear unfinished wire, else select tool and clear selection |
| `Delete`, `Backspace` | Delete selection |
| `W` | Wire tool |
| `R` | Rotate |
| `M` | Mirror |

- [ ] **Step 1: Write the failing tests**

`app/src/model/wireTool.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import library from "@/backend/mock-library.json";
import { emptyProject, type LibraryData } from "./types";
import { isConnectionPoint, wireClick, wirePreview } from "./wireTool";
import { partMap } from "./wiring";

const parts = partMap(library as unknown as LibraryData);

describe("wire tool", () => {
  it("starts, extends with orthogonal corners, and finishes on a connection", () => {
    const start = wireClick([], [0, 0], true);
    expect(start).toEqual({ points: [[0, 0]], finished: null });
    const bend = wireClick(start.points, [40, 30], false);
    expect(bend).toEqual({ points: [[0, 0], [40, 0], [40, 30]], finished: null });
    const done = wireClick(bend.points, [80, 30], true);
    expect(done).toEqual({ points: [], finished: [[0, 0], [40, 0], [40, 30], [80, 30]] });
  });

  it("ignores a second click on the last point", () => {
    expect(wireClick([[10, 10]], [10, 10], true)).toEqual({ points: [[10, 10]], finished: null });
  });

  it("previews the route to the cursor", () => {
    expect(wirePreview([[0, 0]], [30, 20])).toEqual([[0, 0], [30, 0], [30, 20]]);
    expect(wirePreview([], [30, 20])).toEqual([]);
    expect(wirePreview([[0, 0]], null)).toEqual([[0, 0]]);
  });

  it("treats pins and any point on a wire as connections", () => {
    const project = emptyProject();
    project.components.push({ uid: "c1", part: "basic.resistor", ref: "R1", x: 0, y: 0, rot: 0, mirror: false, params: {} });
    project.wires.push({ uid: "w1", points: [[100, 100], [200, 100]] });
    expect(isConnectionPoint([60, 10], project, parts)).toBe(true);
    expect(isConnectionPoint([150, 100], project, parts)).toBe(true);
    expect(isConnectionPoint([150, 110], project, parts)).toBe(false);
  });
});
```

`app/src/ui/useShortcuts.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorStore, type EditorStore } from "@/model/store";
import { testLibrary } from "@/test/resetEditor";
import { handleShortcut, type ShortcutActions } from "./useShortcuts";

let store: EditorStore;
let actions: ShortcutActions;
const s = () => store.getState();
const press = (key: string, opts: { ctrl?: boolean; shift?: boolean; target?: EventTarget | null } = {}) =>
  handleShortcut(
    { key, ctrlKey: !!opts.ctrl, metaKey: false, shiftKey: !!opts.shift, target: opts.target ?? document.body },
    store,
    actions,
  );

beforeEach(() => {
  store = createEditorStore({ library: testLibrary });
  actions = { openPalette: vi.fn() };
  s().placePart("basic.resistor", [0, 0]);
});

describe("handleShortcut", () => {
  it("rotates, mirrors and deletes the selection", () => {
    expect(press("r")).toBe(true);
    expect(press("M")).toBe(true);
    expect(s().project.components[0]).toMatchObject({ rot: 90, mirror: true });
    expect(press("Delete")).toBe(true);
    expect(s().project.components).toHaveLength(0);
  });

  it("undoes and redoes", () => {
    press("z", { ctrl: true });
    expect(s().project.components).toHaveLength(0);
    press("y", { ctrl: true });
    expect(s().project.components).toHaveLength(1);
    press("z", { ctrl: true });
    press("Z", { ctrl: true, shift: true });
    expect(s().project.components).toHaveLength(1);
  });

  it("switches to the wire tool and escapes in two steps", () => {
    press("w");
    s().setTool({ kind: "wire", points: [[0, 0]] });
    press("Escape");
    expect(s().tool).toEqual({ kind: "wire", points: [] });
    press("Escape");
    expect(s().tool).toEqual({ kind: "select" });
    expect(s().selection).toBeNull();
  });

  it("opens the palette with Ctrl+K and P", () => {
    press("k", { ctrl: true });
    press("p");
    expect(actions.openPalette).toHaveBeenCalledTimes(2);
  });

  it("toggles panels and focus mode", () => {
    press("b", { ctrl: true });
    press("j", { ctrl: true });
    press("F11");
    expect(s().panels).toMatchObject({ parts: false, plot: true, focus: true });
  });

  it("uses file actions only when provided", () => {
    expect(press("s", { ctrl: true })).toBe(false);
    actions.save = vi.fn();
    actions.saveAs = vi.fn();
    expect(press("s", { ctrl: true })).toBe(true);
    expect(press("S", { ctrl: true, shift: true })).toBe(true);
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.saveAs).toHaveBeenCalledTimes(1);
  });

  it("ignores keys typed into inputs", () => {
    const input = document.createElement("input");
    expect(press("r", { target: input })).toBe(false);
    expect(s().project.components[0].rot).toBe(0);
  });
});
```

`app/src/ui/CommandPalette.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "@/model/store";
import { resetEditor } from "@/test/resetEditor";
import CommandPalette from "./CommandPalette";

beforeEach(() => resetEditor());

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    render(<CommandPalette open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("places the best match on Enter", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search parts to place…");
    fireEvent.change(input, { target: { value: "cap" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editorStore.getState().tool).toEqual({ kind: "place", partId: "basic.capacitor" });
    expect(onClose).toHaveBeenCalled();
  });

  it("moves through results with the arrow keys", () => {
    render(<CommandPalette open onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Search parts to place…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editorStore.getState().tool).toEqual({ kind: "place", partId: "ttl.7400" });
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Search parts to place…"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL (`./wireTool`, `./useShortcuts` and `./CommandPalette` can't be resolved).

- [ ] **Step 3: Implement the wire tool logic and shortcuts**

`app/src/model/wireTool.ts`:
```ts
import { orthogonalRoute, pointOnSegment, samePoint, simplifyPath } from "./geometry";
import type { PartDef, Point, Project } from "./types";
import { pinPoints } from "./wiring";

/** A pin, or any point on an existing wire (vertex or segment interior). */
export function isConnectionPoint(p: Point, project: Project, parts: Map<string, PartDef>): boolean {
  return (
    pinPoints(project, parts).some((pin) => samePoint(pin.point, p)) ||
    project.wires.some((w) => w.points.some((b, i) => i > 0 && pointOnSegment(p, w.points[i - 1], b)))
  );
}

/** One click of the wire tool: start, extend, or finish when the target is a connection. */
export function wireClick(points: Point[], target: Point, connection: boolean): { points: Point[]; finished: Point[] | null } {
  if (points.length === 0) return { points: [target], finished: null };
  const last = points[points.length - 1];
  if (samePoint(last, target)) return { points, finished: null };
  const path = simplifyPath([...points, ...orthogonalRoute(last, target).slice(1)]);
  return connection ? { points: [], finished: path } : { points: path, finished: null };
}

export function wirePreview(points: Point[], cursor: Point | null): Point[] {
  if (points.length === 0 || !cursor) return points;
  return simplifyPath([...points, ...orthogonalRoute(points[points.length - 1], cursor).slice(1)]);
}
```

`app/src/ui/useShortcuts.ts`:
```ts
"use client";

import { useEffect, useRef } from "react";
import { editorStore, type EditorStore } from "@/model/store";

export interface ShortcutActions {
  openPalette(): void;
  newFile?(): void;
  open?(): void;
  save?(): void;
  saveAs?(): void;
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
  const s = store.getState();
  const key = e.key.toLowerCase();

  if (e.ctrlKey || e.metaKey) {
    switch (key) {
      case "k": actions.openPalette(); return true;
      case "z": if (e.shiftKey) s.redo(); else s.undo(); return true;
      case "y": s.redo(); return true;
      case "c": s.copySelected(); return true;
      case "v": s.paste(); return true;
      case "b": s.togglePanel("parts"); return true;
      case "i": s.togglePanel("properties"); return true;
      case "j": s.togglePanel("plot"); return true;
      case "n": return run(actions.newFile);
      case "o": return run(actions.open);
      case "s": return e.shiftKey ? run(actions.saveAs) : run(actions.save);
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
    case "p": actions.openPalette(); return true;
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
```

`app/src/ui/CommandPalette.tsx`:
```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/model/store";
import type { PartDef } from "@/model/types";
import { filterParts } from "./partSearch";

export default function CommandPalette({ open, onClose }: { open: boolean; onClose(): void }) {
  const library = useEditor((s) => s.library);
  const setTool = useEditor((s) => s.setTool);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => filterParts(library?.parts ?? [], query).slice(0, 20), [library, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  if (!open) return null;

  const choose = (part: PartDef | undefined) => {
    if (!part) return;
    setTool({ kind: "place", partId: part.manifest.id });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-bg/60 pt-[18vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Place a part"
        className="h-fit w-[28rem] max-w-[90vw] overflow-hidden rounded-lg border border-line bg-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          placeholder="Search parts to place…"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          className="w-full border-b border-line bg-transparent px-3 py-2 text-text placeholder:text-muted focus:outline-none"
        />
        <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
          {results.map((part, i) => (
            <li
              key={part.manifest.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={() => choose(part)}
              className={`flex cursor-pointer justify-between px-3 py-1.5 ${i === active ? "bg-line text-text" : "text-muted"}`}
            >
              <span>{part.manifest.name}</span>
              <span className="text-[11px]">{part.manifest.category}</span>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-muted">No parts match</li>}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix app test`
Expected: all pass (wireTool 4, useShortcuts 7, CommandPalette 4 plus earlier suites).

- [ ] **Step 5: Wire the tool into the canvas and the palette into the shell**

In `app/src/ui/canvas/Canvas.tsx`:
1. Change the react-konva import to `import { Circle, Layer, Line, Stage } from "react-konva";`. Add `import { tokens } from "@/theme/tokens";` and `import { isConnectionPoint, wireClick, wirePreview } from "@/model/wireTool";`, and add `snapTarget` to the `@/model/wiring` import.
2. In `onMouseDown`, replace the `if (state.tool.kind === "place") { … } else if (…select…) { … }` chain with:
```tsx
    if (state.tool.kind === "place") {
      state.placePart(state.tool.partId, world);
    } else if (state.tool.kind === "wire") {
      const target = snapTarget(world, state.project, parts);
      const step = wireClick(state.tool.points, target, isConnectionPoint(target, state.project, parts));
      if (step.finished) state.addWire(step.finished);
      state.setTool({ kind: "wire", points: step.points });
    } else if (e.target === e.target.getStage()) {
      state.select(null);
    }
```
3. Add a double-click handler and pass `onDblClick={onDblClick}` to `<Stage>`:
```tsx
  const onDblClick = () => {
    const state = editorStore.getState();
    if (state.tool.kind !== "wire") return;
    if (state.tool.points.length >= 2) state.addWire(state.tool.points);
    state.setTool({ kind: "wire", points: [] });
  };
```
4. Above the `return`, add:
```tsx
  const wireTarget = tool.kind === "wire" && pointer ? snapTarget(pointer, project, parts) : null;
```
5. Inside `<Layer>`, after the ghost part, add:
```tsx
            {tool.kind === "wire" && tool.points.length > 0 && (
              <Line
                points={wirePreview(tool.points, wireTarget).flat()}
                stroke={tokens.wire}
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                dash={[4, 4]}
                listening={false}
              />
            )}
            {wireTarget && (
              <Circle x={wireTarget[0]} y={wireTarget[1]} radius={4} stroke={tokens.accent} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
            )}
```
6. On the container `<div>`, merge the cursor into the style: `style={{ ...gridStyle(zoom, pan), cursor: tool.kind === "select" ? "default" : "crosshair" }}`.

In `app/src/ui/TopBar.tsx`, change the signature to `export default function TopBar({ onOpenPalette }: { onOpenPalette(): void })`. After the Wire button, add:
```tsx
      <button className={barButton} onClick={onOpenPalette} title="Place a part (Ctrl+K)">Add part</button>
```

In `app/src/ui/FocusToolbar.tsx`, change the signature to `export default function FocusToolbar({ onOpenPalette }: { onOpenPalette(): void })`. After the Wire button, add:
```tsx
      <button className={button} onClick={onOpenPalette}>Add part</button>
```

In `app/src/ui/AppShell.tsx`:
1. Add imports: `import CommandPalette from "./CommandPalette";` and `import { useShortcuts } from "./useShortcuts";`.
2. Inside the component, add:
```tsx
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = () => setPaletteOpen(true);
  useShortcuts({ openPalette });
```
3. Render `<TopBar onOpenPalette={openPalette} />` and `<FocusToolbar onOpenPalette={openPalette} />`. As the last child of the outer `div`, add `<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />`.

- [ ] **Step 6: Test, build and try it**

Run: `npm --prefix app test && npm --prefix app run build`
Expected: all tests pass and the build succeeds.

Run: `npm --prefix app run dev`, open http://localhost:3000, and try:
1. Ctrl+K, type `res`, Enter, click to place. Place a second resistor the same way.
2. Press `W`, click R1's right pin, click an empty point, then click R2's left pin. A wire appears, with a corner where you clicked.
3. `R` rotates the selected part, `Ctrl+Z` undoes, and `F11` toggles Focus mode.

Stop the server.

- [ ] **Step 7: Commit**

```bash
git add app/src
git commit -m "feat(app): wire tool, keyboard shortcuts and part palette"
```

---

### Task 11: Open, save, autosave and recovery

**Files:**
- Create: `app/src/ui/fileActions.ts`, `app/src/ui/fileActions.test.ts`, `app/src/ui/useAutosave.ts`, `app/src/ui/useAutosave.test.ts`, `app/src/ui/RecoveryBanner.tsx`, `app/src/ui/RecoveryBanner.test.tsx`
- Modify: `app/src/ui/AppShell.tsx`, `app/src/ui/TopBar.tsx`

**Interfaces:**
- Consumes: `Backend`, `errorMessage`, `getBackend`, `createMockBackend` (Task 7); `EditorStore`, `editorStore`, `createEditorStore` (Task 6); `partMap` (Task 5); `ShortcutActions`, `useShortcuts` (Task 10).
- Produces:
  - `fileActions.ts`: `interface FileActions { newFile(): Promise<void>; open(): Promise<void>; save(): Promise<boolean>; saveAs(): Promise<boolean> }`, `createFileActions({ store, backend, confirmDiscard, notify }): FileActions`
  - `useAutosave.ts`: `AUTOSAVE_MS = 30_000`, `createAutosave(store, backend): () => Promise<boolean>` (writes recovery only when dirty and changed since the last write), `useAutosave(backend: Backend | null, notify: (message: string) => void)`
  - `RecoveryBanner` props `{ backend: Backend | null }`
  - `TopBar` props become `{ onOpenPalette(): void; files: FileActions | null }`

Behavior:
- **New / Open** ask `confirmDiscard()` first when the project is dirty.
- **Save** writes to the current path, or asks for one (suggesting `untitled.msym`). **Save As** always asks, suggesting the current file name.
- **Saving** stamps `format: 1` and `app: "0.1.0"`, marks the project saved, and clears the recovery file.
- **Opening** a project that uses parts missing from the library notifies `"N part(s) in this project are not in the installed library"`.
- **Autosave:** every 30 s, if dirty, the project is written to the recovery file; failures notify once per failure.
- **Recovery banner:** on startup, if a recovery file exists, `RecoveryBanner` offers Restore (loads the project unsaved and dirty) or Discard (clears it).
- **Notices:** errors and notices appear as a small `role="alert"` toast in the canvas corner and disappear after 6 s.

- [ ] **Step 1: Write the failing tests**

`app/src/ui/fileActions.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import { createEditorStore, type EditorStore } from "@/model/store";
import { testLibrary } from "@/test/resetEditor";
import { createFileActions, type FileActions } from "./fileActions";

let store: EditorStore;
let backend: ReturnType<typeof createMockBackend>;
let files: FileActions;
let confirm: ReturnType<typeof vi.fn>;
let notify: ReturnType<typeof vi.fn>;
const s = () => store.getState();

beforeEach(() => {
  store = createEditorStore({ library: testLibrary });
  backend = createMockBackend();
  confirm = vi.fn(() => false);
  notify = vi.fn();
  files = createFileActions({ store, backend, confirmDiscard: confirm, notify });
  s().placePart("basic.resistor", [0, 0]);
});

describe("file actions", () => {
  it("saves an untitled project after asking for a path", async () => {
    const pick = vi.spyOn(backend, "pickSavePath");
    await backend.writeRecovery(s().project);
    expect(await files.save()).toBe(true);
    expect(pick).toHaveBeenCalledWith("untitled.msym");
    expect(s()).toMatchObject({ filePath: "untitled.msym", dirty: false });
    const saved = JSON.parse(backend.files.get("untitled.msym")!);
    expect(saved).toMatchObject({ format: 1, app: "0.1.0" });
    expect(saved.components).toHaveLength(1);
    expect(await backend.readRecovery()).toBeNull();
  });

  it("saves again without asking, and Save As always asks", async () => {
    await files.save();
    const pick = vi.spyOn(backend, "pickSavePath");
    s().placePart("basic.capacitor", [100, 0]);
    await files.save();
    expect(pick).not.toHaveBeenCalled();
    await files.saveAs();
    expect(pick).toHaveBeenCalledWith("untitled.msym");
  });

  it("keeps the project dirty when the save dialog is cancelled", async () => {
    vi.spyOn(backend, "pickSavePath").mockResolvedValue(null);
    expect(await files.save()).toBe(false);
    expect(s().dirty).toBe(true);
  });

  it("reports save failures", async () => {
    vi.spyOn(backend, "saveProject").mockRejectedValue("Cannot save x: denied");
    expect(await files.save()).toBe(false);
    expect(notify).toHaveBeenCalledWith("Could not save: Cannot save x: denied");
  });

  it("opens the chosen project", async () => {
    await files.save();
    s().newProject();
    await files.open();
    expect(s().project.components).toHaveLength(1);
    expect(s()).toMatchObject({ filePath: "untitled.msym", dirty: false });
    expect(s().past).toHaveLength(0);
  });

  it("reports open failures and missing parts", async () => {
    vi.spyOn(backend, "pickOpenPath").mockResolvedValueOnce("gone.msym");
    s().markSaved("x.msym");
    await files.open();
    expect(notify).toHaveBeenCalledWith("Could not open: Cannot open gone.msym: not found");

    const project = structuredClone(s().project);
    project.components.push({ ...project.components[0], uid: "c9", part: "rf.antenna" });
    await backend.saveProject("odd.msym", project);
    await files.open();
    expect(notify).toHaveBeenCalledWith("1 part(s) in this project are not in the installed library");
  });

  it("asks before discarding unsaved changes", async () => {
    await files.newFile();
    expect(confirm).toHaveBeenCalled();
    expect(s().project.components).toHaveLength(1);
    confirm.mockReturnValue(true);
    await files.newFile();
    expect(s().project.components).toHaveLength(0);
  });
});
```

`app/src/ui/useAutosave.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createMockBackend } from "@/backend/mockBackend";
import { createEditorStore } from "@/model/store";
import { testLibrary } from "@/test/resetEditor";
import { createAutosave } from "./useAutosave";

describe("autosave", () => {
  it("writes recovery only when dirty and changed", async () => {
    const store = createEditorStore({ library: testLibrary });
    const backend = createMockBackend();
    const tick = createAutosave(store, backend);
    expect(await tick()).toBe(false);
    store.getState().placePart("basic.resistor", [0, 0]);
    expect(await tick()).toBe(true);
    expect((await backend.readRecovery())?.components).toHaveLength(1);
    expect(await tick()).toBe(false);
    store.getState().placePart("basic.resistor", [100, 0]);
    expect(await tick()).toBe(true);
  });
});
```

`app/src/ui/RecoveryBanner.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL (`./fileActions`, `./useAutosave` and `./RecoveryBanner` can't be resolved).

- [ ] **Step 3: Implement**

`app/src/ui/fileActions.ts`:
```ts
import { errorMessage, type Backend } from "@/backend/backend";
import type { EditorStore } from "@/model/store";
import { APP_VERSION } from "@/model/types";
import { partMap } from "@/model/wiring";

export interface FileActions {
  newFile(): Promise<void>;
  open(): Promise<void>;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
}

interface Deps {
  store: EditorStore;
  backend: Backend;
  confirmDiscard(): boolean;
  notify(message: string): void;
}

const fileName = (path: string | null) => path?.split(/[\\/]/).pop() ?? "untitled.msym";

export function createFileActions({ store, backend, confirmDiscard, notify }: Deps): FileActions {
  const canDiscard = () => !store.getState().dirty || confirmDiscard();

  const writeTo = async (path: string): Promise<boolean> => {
    const { project } = store.getState();
    try {
      await backend.saveProject(path, { ...project, format: 1, app: APP_VERSION });
      store.getState().markSaved(path);
      await backend.clearRecovery();
      return true;
    } catch (e) {
      notify(`Could not save: ${errorMessage(e)}`);
      return false;
    }
  };

  const saveAs = async () => {
    const path = await backend.pickSavePath(fileName(store.getState().filePath));
    return path ? writeTo(path) : false;
  };

  return {
    newFile: async () => {
      if (!canDiscard()) return;
      store.getState().newProject();
      await backend.clearRecovery();
    },

    open: async () => {
      if (!canDiscard()) return;
      const path = await backend.pickOpenPath();
      if (!path) return;
      try {
        const project = await backend.openProject(path);
        store.getState().loadProject(project, path);
        await backend.clearRecovery();
        const parts = partMap(store.getState().library);
        const missing = project.components.filter((c) => !parts.has(c.part)).length;
        if (missing > 0) notify(`${missing} part(s) in this project are not in the installed library`);
      } catch (e) {
        notify(`Could not open: ${errorMessage(e)}`);
      }
    },

    save: async () => {
      const path = store.getState().filePath;
      return path ? writeTo(path) : saveAs();
    },

    saveAs,
  };
}
```

`app/src/ui/useAutosave.ts`:
```ts
"use client";

import { useEffect } from "react";
import { errorMessage, type Backend } from "@/backend/backend";
import { editorStore, type EditorStore } from "@/model/store";
import type { Project } from "@/model/types";

export const AUTOSAVE_MS = 30_000;

/** Returns a tick that writes the recovery file when the project is dirty and changed. */
export function createAutosave(store: EditorStore, backend: Backend) {
  let lastWritten: Project | null = null;
  return async (): Promise<boolean> => {
    const { dirty, project } = store.getState();
    if (!dirty || project === lastWritten) return false;
    await backend.writeRecovery(project);
    lastWritten = project;
    return true;
  };
}

export function useAutosave(backend: Backend | null, notify: (message: string) => void) {
  useEffect(() => {
    if (!backend) return;
    const tick = createAutosave(editorStore, backend);
    const id = window.setInterval(() => {
      tick().catch((e) => notify(`Autosave failed: ${errorMessage(e)}`));
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [backend, notify]);
}
```

`app/src/ui/RecoveryBanner.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import type { Backend } from "@/backend/backend";
import { editorStore } from "@/model/store";
import type { Project } from "@/model/types";

export default function RecoveryBanner({ backend }: { backend: Backend | null }) {
  const [recovered, setRecovered] = useState<Project | null>(null);

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    backend
      .readRecovery()
      .then((project) => { if (alive) setRecovered(project); })
      // An unreadable recovery file is not worth interrupting startup for.
      .catch(() => {});
    return () => { alive = false; };
  }, [backend]);

  if (!backend || !recovered) return null;

  const restore = () => {
    editorStore.getState().loadProject(recovered, null);
    editorStore.setState({ dirty: true });
    setRecovered(null);
  };
  const discard = async () => {
    setRecovered(null);
    await backend.clearRecovery();
  };

  return (
    <div role="status" className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-panel px-4 py-2">
      <span className="text-text">Restore unsaved work from your last session?</span>
      <button onClick={restore} className="rounded bg-accent px-2 py-1 font-semibold text-bg">Restore</button>
      <button onClick={discard} className="rounded border border-line px-2 py-1 text-muted hover:text-text">Discard</button>
    </div>
  );
}
```

In `app/src/ui/TopBar.tsx`, change the signature to `export default function TopBar({ onOpenPalette, files }: { onOpenPalette(): void; files: FileActions | null })`, add `import type { FileActions } from "./fileActions";`, and insert at the start of the bar, right after the `multysm` wordmark:
```tsx
      <button className={barButton} disabled={!files} onClick={() => void files?.newFile()} title="New (Ctrl+N)">New</button>
      <button className={barButton} disabled={!files} onClick={() => void files?.open()} title="Open (Ctrl+O)">Open</button>
      <button className={barButton} disabled={!files} onClick={() => void files?.save()} title="Save (Ctrl+S)">Save</button>
      <button className={barButton} disabled={!files} onClick={() => void files?.saveAs()} title="Save As (Ctrl+Shift+S)">Save As</button>
      <span className="mx-2 h-5 w-px bg-line" />
```

Replace `app/src/ui/AppShell.tsx` with:
```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, type Backend } from "@/backend/backend";
import { getBackend } from "@/backend/index";
import { editorStore, useEditor } from "@/model/store";
import CommandPalette from "./CommandPalette";
import { createFileActions } from "./fileActions";
import FocusToolbar from "./FocusToolbar";
import PartsPanel from "./PartsPanel";
import PlotDock from "./PlotDock";
import PropertiesPanel from "./PropertiesPanel";
import RecoveryBanner from "./RecoveryBanner";
import StatusBar from "./StatusBar";
import TopBar from "./TopBar";
import { useAutosave } from "./useAutosave";
import { useShortcuts } from "./useShortcuts";

// Konva needs a real browser canvas, so the canvas never renders on the server.
const Canvas = dynamic(() => import("./canvas/Canvas"), { ssr: false, loading: () => <div className="h-full bg-bg" /> });

export default function AppShell() {
  const panels = useEditor((s) => s.panels);
  const selection = useEditor((s) => s.selection);
  const [backend, setBackend] = useState<Backend | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const notify = useCallback((message: string) => setNotice(message), []);

  useEffect(() => {
    let alive = true;
    getBackend()
      .then(async (b) => {
        if (!alive) return;
        setBackend(b);
        const library = await b.loadLibrary();
        if (alive) editorStore.getState().setLibrary(library);
      })
      .catch((e) => { if (alive) notify(`Could not load parts: ${errorMessage(e)}`); });
    return () => { alive = false; };
  }, [notify]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const files = useMemo(
    () => backend && createFileActions({
      store: editorStore,
      backend,
      confirmDiscard: () => window.confirm("Discard unsaved changes?"),
      notify,
    }),
    [backend, notify],
  );

  const openPalette = () => setPaletteOpen(true);
  useShortcuts({
    openPalette,
    newFile: files ? () => void files.newFile() : undefined,
    open: files ? () => void files.open() : undefined,
    save: files ? () => void files.save() : undefined,
    saveAs: files ? () => void files.saveAs() : undefined,
  });
  useAutosave(backend, notify);

  const focus = panels.focus;
  const showProperties = !focus && (panels.properties || selection !== null);

  return (
    <div className="flex h-full flex-col">
      {!focus && <TopBar onOpenPalette={openPalette} files={files} />}
      <div className="flex min-h-0 flex-1">
        {!focus && panels.parts && <PartsPanel />}
        <main className="relative min-w-0 flex-1">
          <Canvas />
          {focus && <FocusToolbar onOpenPalette={openPalette} />}
          <RecoveryBanner backend={backend} />
          {notice && (
            <div role="alert" className="absolute bottom-3 left-3 rounded border border-error bg-panel px-3 py-2 text-error">
              {notice}
            </div>
          )}
        </main>
        {showProperties && <PropertiesPanel />}
      </div>
      {!focus && panels.plot && <PlotDock />}
      {!focus && <StatusBar />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests and build**

Run: `npm --prefix app test && npm --prefix app run build`
Expected: all tests pass (fileActions 7, autosave 1, RecoveryBanner 3 plus earlier suites) and the build succeeds.

- [ ] **Step 5: Try it in the desktop window**

Run: `npm run dev` (repo root).
Expected, in the multysm window:
1. Place two parts and a wire, then click **Save**. A native save dialog opens; save as `demo.msym`, and the title area shows `demo.msym` without the `•`.
2. Click **New** (the canvas clears), then **Open** and pick `demo.msym`; the circuit is back.

Close the window. If you are an automated agent without a display, run `cargo test -p multysm-app` instead and leave the visual check to the user in the report.

- [ ] **Step 6: Commit**

```bash
git add app/src
git commit -m "feat(app): open, save, autosave and crash recovery"
```

---

### Task 12: End-to-end tests and desktop checklist

**Files:**
- Create: `app/playwright.config.ts`, `app/e2e/editor.spec.ts`, `docs/desktop-checklist.md`
- Modify: `app/src/ui/AppShell.tsx`

**Interfaces:**
- Consumes: the whole UI in the browser, with the mock backend.
- Produces: a test hook, `window.__multysm` (the editor store), available only when `process.env.NODE_ENV !== "production"`; `npm --prefix app run e2e`.

- [ ] **Step 1: Test hook and Playwright config**

In `app/src/ui/AppShell.tsx`, add inside the component:
```tsx
  useEffect(() => {
    // Test hook for Playwright; never shipped in production builds.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __multysm?: typeof editorStore }).__multysm = editorStore;
    }
  }, []);
```

`app/playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

Run: `npx --prefix app playwright install chromium`
Expected: Chromium downloads (a one-time step).

- [ ] **Step 2: Write the end-to-end tests**

`app/e2e/editor.spec.ts`:
```ts
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

async function placeViaPalette(page: Page, query: string, at: World) {
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search parts to place…").fill(query);
  await page.keyboard.press("Enter");
  await clickWorld(page, at);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "place Resistor" })).toBeVisible();
});

test("shows the soft-dark layout", async ({ page }) => {
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(27, 29, 35)");
  await expect(page.getByRole("button", { name: /^category / })).toHaveCount(15);
  await expect(page.getByRole("button", { name: "▶ Run" })).toBeDisabled();
});

test("places, rotates and deletes a part", async ({ page }) => {
  await placeViaPalette(page, "resistor", [200, 200]);
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
  await placeViaPalette(page, "resistor", [100, 100]);
  await placeViaPalette(page, "resistor", [300, 200]);
  await page.keyboard.press("w");
  await clickWorld(page, [160, 110]); // R1 pin 2
  await clickWorld(page, [300, 210]); // R2 pin 1
  const { project, tool } = await editor(page);
  expect(project.wires).toHaveLength(1);
  expect(project.wires[0].points).toEqual([[160, 110], [300, 110], [300, 210]]);
  expect(tool).toEqual({ kind: "wire", points: [] });
});

test("undoes and redoes", async ({ page }) => {
  await placeViaPalette(page, "capacitor", [200, 200]);
  await page.keyboard.press("Control+Z");
  expect((await editor(page)).project.components).toHaveLength(0);
  await page.keyboard.press("Control+Y");
  expect((await editor(page)).project.components).toHaveLength(1);
});

test("saves and reopens a project", async ({ page }) => {
  await placeViaPalette(page, "led", [200, 200]);
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
  await expect(page.getByRole("button", { name: "place Resistor" })).toBeHidden();
  await page.getByRole("button", { name: "Exit focus" }).click();
  await expect(page.getByRole("button", { name: "place Resistor" })).toBeVisible();
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
```

- [ ] **Step 3: Run the end-to-end tests**

Run: `npm --prefix app run e2e`
Expected: 7 passed. A failure means a real UI bug. Debug it (`npx --prefix app playwright test --headed`, or read the trace) and fix the app code; don't weaken the test. If a Chromium-reserved key combination is swallowed by the browser, use the matching TopBar button in that test and note it in the report.

- [ ] **Step 4: Desktop checklist**

`docs/desktop-checklist.md`:
```markdown
# Desktop checklist (run before each release)

Prerequisites: Rust (MSVC), Node 22, `npm install` and `npm --prefix app install` done,
ngspice in `vendor/ngspice` (needed from Plan 3).

1. `npm run dev` opens a window titled "multysm" with the dark layout, and no white flash.
2. The parts panel lists 15 categories; Basic, Sources, Diodes, TTL and Mixed have parts.
3. Ctrl+K → type `555` → Enter → click: the 555 symbol appears with the label `U1`.
4. `W`, then click pin to pin: the wire routes at right angles, and a junction dot appears where a wire ends on another wire.
5. `R`, `M` and `Del` work on the selection; Ctrl+Z / Ctrl+Y undo and redo.
6. Wheel zoom stays sharp at 400%; middle-drag pans.
7. Save → native dialog → reopen the file: the circuit is identical.
8. Make a change, wait 30 s, then close the window without saving. Reopen: the "Restore unsaved work" banner appears, and Restore brings the change back.
9. F11 hides every panel and shows the floating toolbar; "Exit focus" restores them.
10. `cargo test --workspace` and `npm --prefix app test` pass.
```

- [ ] **Step 5: Run everything once more**

Run: `cargo test --workspace && npm --prefix app test && npm --prefix app run build && npm --prefix app run e2e`
Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add app/playwright.config.ts app/e2e app/src/ui/AppShell.tsx docs/desktop-checklist.md
git commit -m "test(app): Playwright editor flows and desktop release checklist"
```

---

## Not in this plan (carried to Plan 3)

- Run / Pause / Stop, analysis settings picker, plot dock contents, and highlighting errors on the canvas (the `simulate` Tauri command must run on a blocking thread; see Plan 1 follow-ups).
- Placeholder rendering for parts missing from the library (Plan 2 only notifies), and pack id/version on component instances (Phase 3 packs).
- Resizable side panels (fixed widths for now).
- Bundling `components/core` and ngspice into the installer (`components_root()` currently points at the repository).
