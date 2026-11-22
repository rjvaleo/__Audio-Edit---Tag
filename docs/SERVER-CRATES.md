# The server's crates

Until 20 Nov 2026 the server was one crate, `core/crates/server`, of about
27,000 lines. Any change in it rebuilt and retested all of it.

Task 007 step 2 split it by area. The rule was that **nothing it does changes**:
- the same routes;
- the same JSON;
- the same files written.

The code was moved, not rewritten.

## The crates

| Crate | What is in it | Uses |
|---|---|---|
| `server-core` | `App` and its state, http, json, persistence, safety, the log, and the engine control the state holds: the live engine, grains (`grain_lfos`, `grain_notes`), the rack, the pad, automation, MIDI, docs, the Wave synth and board. Also the stems job, the GPU and FLAC helpers, user tags, annotations, capture, video, offline and the render cache. | — |
| `server-ui` | The interface: everything embedded, `ui_build_id`, `ui_from_disk`, `build.rs`, and the `ui-from-disk` feature | core (for `http`) |
| `server-library` | The library and search: `routes/library`, `listen_tags`, `map`, `audio_view` | core, ui |
| `server-compose` | Compositions, markers, annotations, presets: `compose`, `routes/compose`, `routes/presets` | core |
| `server-engine` | The engine and grain control routes: `engine_api`, `grains`, `fx_rack`, `pad_automation`, `prism`, `edit_view`, plus `padpresets` | core, library, compose |
| `server-export` | Export, video, recording: `routes/export`, `video`, `record`, plus `grain_export` and `record` | core, compose, engine, library |
| `server-stems` | Stems: `routes/stems`, `stem_kits`, and `make` | core, library |
| `server-analytics` | `analytics`, `perf`, `retention` and `routes/analytics` | core |
| `server` | `routes.rs`, the one table that calls every handler; `serve`; the integration tests in `tests/` | all of them |

`audiolab` still depends on `server` alone.

Every old `server::…` path still works. `server`'s `lib.rs` re-exports the core,
and the modules that moved out, under their old names: `server::state::App`,
`server::routes::route`, `server::json::Value` and so on.

## How the moved code still reads as one crate

- **`crate::…` paths are unchanged.** Each area crate starts with
  `pub use server_core::*;`, so `crate::state`, `crate::json` and the rest
  resolve as before.
- **`use super::*` in a route file still finds what it found.**
  - Each area's `routes.rs` carries the same imports the server's `routes.rs`
    had: `App`, `Request`, `Response`, `Value`, `Path`, `Arc`.
  - It also has a `pub use` for each of its route files.
- **A route file that calls into another area names what it takes** in its
  crate's `routes.rs`. For example, `server-engine` takes `library_file` and
  `identity_for`.
- **`pub(super)` in the route files became `pub`,** because the table is now in
  another crate.

## Why the core is the biggest

The core is about 14,700 lines. `App` (`state.rs`) holds the live engine, the
rack, automation, the grain LFOs and notes, MIDI, the Wave synth and the stems
job, and each of those reaches back into `App`. They are one knot: none can move
out without changing how it is built, which this split was not allowed to do.

What could move did: every route handler, and every module only the routes use.
A change in a route file now rebuilds:
- that area's crate;
- `server`, which holds only the table;
- `audiolab`.

It no longer rebuilds the core or the other areas.

Cutting the knot is later work. For example, the engine's state could sit behind
a trait so that `rack` and `live` no longer need `App`.

## The tests

- **The Rust test runners name every crate:** `tools/pc/run-tests.cmd` and
  `tools/pc/run-tests-mac.sh`. CI runs the whole workspace.
- **Each module's unit tests went with it.**
- **`tools/test-changed.mjs`'s `serverRoutes`** reads the handlers from
  `core/crates/server-*/src/routes/*.rs`, and from the core for the table's
  `crate::module::handler` lines.
  - A change in a handler reruns only the specs that call its routes.
  - A change anywhere else in the server crates reruns them all: the core, the
    table, a crate's `lib.rs` or `routes.rs`, or `server-ui`.
- **The test map was remade after the split** (21 Nov 2026, at `cb673d9`, on the MacBook), so
  it knows the moved files.
- **`npm run test:changed` tests only the crates a change reaches** on the PC:
  the changed crates and the crates that use them (`run-tests.cmd rust <crate>…`).
  A change in a route file runs that area's crate, `server` and `audiolab`; a
  change in the core runs every server crate.
