# The native app's engine

The engine of the JUCE plan. Since 21 Nov 2026 it lives here, in MultiGrainLive's repository under `native/` (it was a repository of its own in `WORK DIR/idmlab-move/native`, with no copy anywhere else). The plan and its records stay in `WORK DIR/idmlab-move/`: the plan `PLAN.md`; phase 1, the core: `PHASE1.md`; phase 2, MultiGrainLive's instruments as modules: `PHASE2.md`; the audio plan `AUDIO-PLAN.md`.

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

The workspace builds from MGL's own crates in `../core/crates` and from two other repositories beside MGL's folder, laid out as in `~/Documents`: `../../GitHub/M Clone` (idMLab) and `../../GitHub/prism-fx`. The test scripts send copies to the other machines in the same layout (`~/idmlab-native/MultiGrainLive/native` on the MacBook, `D:\mgl-test\idmlab-check\MultiGrainLive\native` on the PC). Nothing is built or run on the iMac.

**The sound card's buffer is never below 64 frames** (RJ, 21 Nov 2026). Grain works out its sound 128 frames at a time; at 32-frame callbacks Hybrid and PVSOLA with eight voices overrun (143% and 123% of the slot), at 64 the worst takes 74%. The probe raises any smaller `--buffer` to 64, and the app's host must do the same.

### Changing the output rate

`Controller::set_rate(rate)` constructs replacements on the controller thread and
queues a linear crossfade lasting `Config::fade_frames`. `ne_set_rate` exposes it
to C (0 queued, -13 invalid rate, -14 unsupported module/state, -15 still fading).
Render again before requesting another rate change. Frame numbers stay monotonic;
clock modules carry their beat position and advance at the new rate.

Native adapters capture factories when added. Custom modules use
`add_with_factory(id, Box::new(|rate, max_block| ...))`. A factory must reconstruct
its configuration for that rate; it must not borrow an audio-owned instance.
`prepare` runs on the controller. Optional `rate_state`/`rehome` and `transfer`
hooks run at adoption and must not allocate, free, lock or wait.

The factory wrapper remembers current controls and held notes, including notes
from cables (4096 distinct controls/sound slots and 2048 held keys per module).
Instruments restart their attacks under the crossfade. Arbitrary `Thing` payloads
cannot be reconstructed generically: after `give`/`give_at`, rate changes refuse
that module rather than lose its state. Grain decks with opaque rack/parts/bank
or octave builders likewise need a caller-supplied reconstruction factory.
Existing Grain handles refer to their original instance; applications retaining
handles must arrange handles for replacements in their factory.

### Parallel rendering

Set `Config::parallel = true` to create up to four workers (available cores minus
one). It is off by default. `worker_init: Option<fn(usize)>` runs once on each
worker before any render, for the host's future audio-workgroup integration.
Apple workers request interactive QoS; Windows workers request above-normal
priority. The host owns realtime scheduling policy.

The compiler keeps the original serial order and also emits DAG levels. Input
mixing completes before a level starts; workers borrow only their node, its
outputs and the completed input sources. Output sums retain their original
order. Feedback plans use the original serial path. The audio thread helps with
jobs, spins briefly, then joins through an OS semaphore. All jobs and scratch
are sized off audio. Workers copy the caller's floating-point controls so offline
renders and the host's denormal guard each retain their original results.

Only explicitly weighted modules may run on workers. A level needs at least two
active weighted branches and 8192 frame-weight units. Wave uses 16 units and
checks for active voices. The measured effect list uses 8 units for the more
expensive reverbs, 2 for effects that only pay at larger levels, and 0 for cheap
or unmeasured kernels. Thus eight Waves qualify at 64 frames, while eight
2-unit effects wait until 512. These conservative hints were measured on the M1
Pro; they are not a hard scheduling guarantee for every machine or parameter.

`engine-core/pool-tests` is a validation-only feature that changes Config's
default to run the existing fixtures with the pool enabled. Production callers
should select Config explicitly, not enable this feature. The ignored cost tests
measure serial/pool wall and calling-thread CPU time, wake/join overhead, a work
size sweep and the individual effect scheduling gate. Thread CPU excludes worker
CPU and must not be read as total engine CPU consumption.
