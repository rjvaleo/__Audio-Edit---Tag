# The native app's engine

Phase 1 of the JUCE plan (`../PLAN.md`); the design and results are in `../PHASE1.md`.

| Folder | What it is |
|---|---|
| `engine-core/` | The graph, cables, queues, clock, sound bank and plain utility modules. Rust, no dependencies. |
| `engine-capi/` | The same behind a C interface, built as a static library for the JUCE app. |
| `probe/` | A JUCE console app that plays the engine on the real sound card and checks it against an offline replay. |
| `tools/` | `test-on-mbp.sh` runs the tests on the MacBook; `probe-on-mbp.sh` builds and runs the probe there. |

Tests always run with the allocation check on:

```
cargo test --workspace --features engine-core/rt-check
```
