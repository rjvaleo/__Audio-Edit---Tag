# The native app's engine

The engine of the JUCE plan (`../PLAN.md`). Phase 1, the core: `../PHASE1.md`. Phase 2, MultiGrainLive's instruments as modules: `../PHASE2.md`.

| Folder | What it is |
|---|---|
| `engine-core/` | The graph, cables, queues, clock, sound bank and plain utility modules. Rust, no dependencies. |
| `engine-capi/` | The same behind a C interface, built as a static library for the JUCE app. |
| `engine-idmlab/` | idMLab's Rust modules, run inside the engine (`../IDMLAB-WRAP.md`). |
| `engine-mgl/` | MultiGrainLive's own, wrapped as they are: every prism-fx effect (with Place, and the suites), the Wave synth, the grain deck (with Poly), the Sound module's document, the master ceiling. |
| `probe/` | A JUCE console app that plays the engine on the real sound card and checks it against an offline replay. |
| `tools/` | `test-on-mbp.sh` and `test-on-pc.sh` run the tests on the MacBook and the PC; `mgl-engine-tests-on-mbp.sh` and `prism-grain-tests-on-mbp.sh` run MGL's own engine tests and prism-grain's there; `probe-on-mbp.sh` builds and runs the probe. |

Tests always run with the allocation check on:

```
cargo test --workspace --features engine-core/rt-check
```

The workspace builds from three other repositories, which it expects beside this folder laid out as in `~/Documents`: `../GitHub/M Clone`, `../GitHub/prism-fx` and `../MultiGrainLive`. On the iMac those are links; the test scripts send copies of the committed code to the other machines. Nothing is built or run on the iMac.
