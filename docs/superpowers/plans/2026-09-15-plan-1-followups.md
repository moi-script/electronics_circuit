# Plan 1 follow-ups (carry into Plans 2 and 3)

Deferred findings from the Plan 1 (Rust simulation core) reviews. None blocks Plan 1. Each should be picked up by the plan named.

## Engine
- **Plan 2:** `run_netlist` is synchronous, holds a global mutex and has no timeout. The Tauri command must run it on `spawn_blocking` or a dedicated thread. The spec's 30 s timeout and a responsive Stop need `bg_run` / `bg_halt`.
- **Plan 3, before live mode:** the `on_exit` callback only logs. After ngspice's controlled exit its state is invalid, and the leaked library can't be reloaded. Add a "needs reset" flag and a recovery path.
- **Plan 3:** a failed `Engine::start` leaks the library again and re-runs `ngSpice_Init` on the next call.
- **Plan 3:** `ConfigMismatch` compares only `dll_path`, not `codemodel_dir`.
- **Plan 3:** `has_error` is a text heuristic. Pre-run validation is the main guard.
- **Plan 3:** add a test that forces a code-model load failure, and tighten the broken-netlist test to check the log names the bad line.
- **Vendor:** ngspice 46 is used because the official ngspice 47 DLL build imports `sndfile.dll` and `samplerate.dll`, which its package doesn't ship. Re-vendor 47+ with those DLLs if newer fixes are needed.

## Netlist and library
- **Plan 2:** validate `rot` as 0/90/180/270. Other values are silently treated as 0.
- **Plan 2:** add `schemas/project.schema.json` (spec §7). Record pack id and version on component instances (spec §4.4).
- **Plan 3:** check pin-id uniqueness in manifests. Validate param `default` values as SI at load time.
- **Plan 3:** support `models` as a `.lib` path (spec §4.2). Only inline text works today.
- **Plan 3:** the duplicate-reference check covers component references but not generated names (`Rtie_*`, rendered `X` subcircuit names).
- **Plan 3:** text params containing spaces can add tokens to their own element line. This isn't injection, but sanitize it in the UI.
- **Plan 3:** templates are validated at load time only (models and subckt text are re-checked at build time). The subckt path isn't re-checked at build time (a symlink could be swapped in between).
- **Plan 3:** XSPICE file-reading code models (e.g. `filesource`) are allowed in `.model` lines and can read local files.
- **Plan 3:** check that the DC sweep source is a source part. Its reference match is case-sensitive.
- **Later:** connectivity is O(segments × points), and the union-find has no rank. Fine for schematic sizes today.
- **Plan 3:** the behavioural 555 model runs about 3.8% below the ideal astable frequency. Tune it before tightening the test tolerance.
- **Cosmetic:** redundant `use crate::library::Pin` in the `circuit.rs` tests.
