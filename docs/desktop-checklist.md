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
