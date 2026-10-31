# Shared effects

*22 October 2026. Steps 1–5 built (step 5 in idMLab); see the end. Since 31
October every effect in this program's rack comes from prism-fx; see
[The rack moved](#the-rack-moved).*

The effects in [HYPERPRISM.md](HYPERPRISM.md) and
[EFFECT-INTAKE.md](EFFECT-INTAKE.md) are written once, in a Rust crate of
their own, and used by two programs: this one, and idMLab in M Clone. Both
already do their sound in Rust with no outside crates, so one crate can serve
both. What differs is how each drives an effect — this program a block at a
time, idMLab a sample at a time — and that is the adapter's job, not the
effect's. The crate also carries each effect's parameter table and its shared
panel, so the two programs cannot disagree about a range or a layout.

## Why a crate, and why first

The other way to share was to rebuild idMLab's host natively, like this
program. That may still happen. Either way the effects live in one crate, so
the crate comes first. It also opens the shortest road to giving idMLab this
program's grain engines (see *Later*), which it does not have.

## The two hosts as they are

| | This program | idMLab |
| --- | --- | --- |
| Runs | Native, through cpal | In the browser: Rust compiled to wasm32 in an AudioWorklet |
| Effect call | `fx::Effect::process(buf, channels, sample_rate)`: a block, interleaved, in place, any channel count | `Module::process(ctx, ports)`: once per sample, because every cable is a one-sample delay |
| Channels | Stereo | Mono effects; stereo is two cables until multichannel frames land (its master plan's P1) |
| Parameters | By key, from a `ParamSpec` table (`fx/src/params.rs`) | By index, a flat `&[f32]`; ranges written again in TypeScript |
| Smoothing | The engine's, 15 ms, with control-rate chunks | Each module's own `Tracked`, 5 ms |
| Mix | Each effect's own wet and dry | A shared shell appends mix, level and mute to every effect |
| Outside crates | None (`fx` → `audio-core`, which has none) | None (`dsp-core`), deliberately; no wasm-bindgen |

## The crate

A new repository, `~/Documents/GitHub/prism-fx` (working name), holding one
library crate and a small generator. No outside crates. `std` is allowed: both
targets have it. `#![forbid(unsafe_code)]`, as `dsp-core` already does.

```
prism-fx/
  Cargo.toml            workspace
  crates/prism-fx/      the effects
    src/lib.rs          Kernel, DynKernel, the catalogue
    src/spec.rs         Descriptor, ParamSpec, Panel
    src/util/           smoothing, delay lines, oscillators, filters, fft
    src/effects/        one file per effect
    tests/              contract tests over the whole catalogue
  crates/prism-gen/     writes catalog.json and the TypeScript for idMLab
```

### The kernel

Every effect is a `Kernel`: stereo in place, one frame at a time, with a block
method whose default is the frame method in a loop.

```rust
pub trait Kernel: Send {
    /// Allocate everything here. Nothing allocates after this.
    fn new(sample_rate: f32) -> Self where Self: Sized;
    fn descriptor() -> &'static Descriptor where Self: Sized;

    /// Real units, clamped to the spec. Smoothed inside the kernel.
    fn set_param(&mut self, index: usize, value: f32);
    fn param(&self, index: usize) -> f32;
    fn reset(&mut self);

    /// One stereo frame, in place.
    fn tick(&mut self, frame: &mut [f32; 2]);

    /// A block, planar. Must equal `tick` over the same frames.
    fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let mut f = [*l, *r];
            self.tick(&mut f);
            (*l, *r) = (f[0], f[1]);
        }
    }

    fn latency_frames(&self) -> u32 { 0 }
    fn tail_seconds(&self) -> f32 { 0.0 }
}
```

`DynKernel` is the same trait made object-safe, so a host holds
`Box<dyn DynKernel>`. `prism_fx::make(id, sample_rate)` builds one from the
catalogue, and `prism_fx::CATALOG` lists every descriptor.

- **Why frames.** idMLab cannot call a block: its graph is one sample deep.
  This program can call a frame too, but calls the block, and an effect that
  gains from blocks — a long FIR, anything vectorised — overrides `process`.
  A contract test holds the two to the same output.
- **Spectral effects** buffer inside `tick` and report the delay through
  `latency_frames`. Neither host reads that yet: this program's rack pre-rolls
  a flat 200 ms (`Rack::preroll_frames`), and idMLab has no latency
  compensation. The first spectral effect brings that work with it.
- **Smoothing lives in the kernel**, per parameter, from the spec's
  `smooth_ms`, as idMLab's modules already do. This program's engine keeps its
  own smoother; two short ramps in series are harmless.
- **Mix belongs to the kernel** where the original had one (wet and dry,
  with the original's law). idMLab's shell still adds its own mix, level and
  mute around it, as it does for every module.

### One table for everything

```rust
pub struct ParamSpec {
    pub key: &'static str,      // the persistence contract: never renamed
    pub label: &'static str,
    pub min: f32, pub max: f32, pub default: f32,
    pub log: bool,
    pub unit: &'static str,
    pub kind: ParamKind,        // Continuous | Int | Toggle | Choice(&'static [&'static str])
    pub smooth_ms: f32,
}

pub struct Descriptor {
    pub id: &'static str,       // "tremolo": the persistence contract
    pub code: u16,              // idMLab's wire number; appended, never reused
    pub version: u16,
    pub label: &'static str,
    pub category: Category,
    pub params: &'static [ParamSpec],   // index = position; append only
    pub panel: Panel,
    pub source: &'static str,   // e.g. "Hyperprism Tremolo; Pluggo Tremellow"
}

pub struct Panel {
    pub groups: &'static [Group],       // label + parameter keys, in reading order
    pub primary: &'static [&'static str],
    pub displays: &'static [Display],   // meter, curve, network diagram, …
    pub pad: Option<PadPair>,           // the Prism pad's default X and Y, with ranges
}
```

The first five `ParamSpec` fields are this program's `ParamSpec`, so the
conversion is a copy. Indices are positions in `params`, which is why
parameters are only ever appended. A key that stops meaning anything keeps its
slot and is marked retired, never removed.

`Panel` is the shared interface from [EFFECT-INTAKE.md](EFFECT-INTAKE.md): the
groups and order taken from the original, in one vocabulary both programs
draw.

### The generated descriptors

`cargo run -p prism-gen` writes two files from the catalogue:

- **`catalog.json`** — every descriptor, for anything that wants to read it.
- **`prismModules.ts`** — for idMLab: a `ModuleDescriptor` per effect in its
  own shape (`src/modular/model/graph.ts`), the parameter-index table its
  bridge needs, and the module codes. It replaces hand-written entries in
  `registry/audioModules.ts` and `PARAM_INDICES` for these effects.

Each generated file carries the crate version and a hash of the catalogue. A
test in idMLab regenerates and compares, so a stale file fails the build. This
program needs no generated file: its server serves the catalogue from Rust,
as `GET /api/fx` already does for its own effects.

That one table is the point. idMLab's Delay today allows 8 s in TypeScript
and clamps at 4 s in Rust, with different default feedback and mix; a
generated descriptor cannot drift that way.

## The adapters

### This program

- `fx` takes a dependency on `prism-fx`.
- A rack slot gains one variant, `Prism { id, params }`, beside `Gain`, `Eq`,
  `Comp` and `Shape` (`server/src/rack.rs`). Its key strings are the
  descriptor's.
- `PrismEffect` wraps a `Box<dyn DynKernel>` and implements `fx::Effect` and
  `Params`. It de-interleaves into two preallocated buffers, calls `process`,
  and interleaves back. For a mono file it feeds the one channel to both
  sides and keeps the left. That is a choice: this program's own stereo
  effects skip mono files today (`Width` returns early), and a prism effect
  could do the same.
- `GET /api/fx` appends the catalogue as entries with kind `prism:<id>`, and
  adds each one's panel. The UI already draws any effect from its spec;
  drawing the panel's groups and pad pair is the one new piece of UI.
- Automation needs nothing: lanes name `fx.<slot id>.<key>`, and `resolve`
  maps a unit to a value through the spec, which a prism spec answers the same
  way.

### idMLab

*Built 23 October 2026 on idMLab's `sound-port` branch; see its
`docs/SOUND-PORT-PLAN.md`. Where it differs from the plan below: `Prism` is
19, idMLab's effects became stereo first so a prism module runs in true
stereo rather than mono-summed, and the generator is `rust/prism-gen` in
idMLab's workspace.*

- `dsp-core` takes a dependency on `prism-fx`.
- `ModuleKind` gains `Prism = 16`, the next free number, and the variant is the
  descriptor's `code`. Both are wire protocol, so both only ever grow.
- `PrismModule` implements `Module`. Each sample it reads its input, runs
  `tick`, and writes its output. Until multichannel frames (P1) land, the input
  is the mono sum fed to both sides, and the output is the two sides averaged.
  That limit is stated on every stereo effect's panel, and it lifts with P1
  without touching any effect.
- Parameters arrive by index from the generated table. The shell's mix, level
  and mute follow them, as for every module.
- **Fix first:** the mix knob does not reach any Rust effect today.
  `compileAudioPlan.ts` moves `mix` out of the parameters into `wet`, and
  nothing in `audio/wasm/` reads `wet`. A prism effect's own wet control would
  inherit that bug, so it is fixed before the first prism module ships.

## Rules the crate enforces

Each is a test in `prism-fx`, run over every entry in `CATALOG`, so a new
effect is covered the moment it is listed.

- **Frame and block agree**: `tick` over N frames equals `process` on N
  frames, bit for bit.
- **Block size does not matter**: 1, 64 and 1024 frames per call agree
  within 1e-5. This program's `fx/tests/shape.rs` already checks this for its
  own effects.
- **Every control reaches the output**: moving each parameter from default to
  each end changes the render. This program has the same rule in
  `fx/tests/every_control_reaches_the_render.rs`.
- **Finite under abuse**: random parameter sweeps and full-scale noise never
  produce NaN or infinity. idMLab's hostile-sweep test does this for its
  effects.
- **Reset is a fresh start**: after `reset`, a render equals the first render.
- **No allocation after `new`**: a counting allocator, as in this program's
  `fx/tests/no_alloc.rs`.
- **The catalogue is consistent**: ids and codes unique, every panel key a real
  parameter, defaults inside ranges, the pad pair inside each range.

## Repository and builds

- `prism-fx` is its own repository. Both programs name it as a **git
  dependency on a tag**, so CI builds on a clean machine: this program's
  `.github/workflows/ci.yml` cannot see a sibling folder. For working on both
  at once, each checkout has a local `.cargo/config.toml` `[patch]` pointing
  at `~/Documents/GitHub/prism-fx`, and that file is not committed.
- idMLab's `npm run build:wasm` builds `dsp-core` with `prism-fx` inside it.
  `prism-gen` runs before it in the same script, so the TypeScript and the
  wasm always come from one catalogue.
- The FFT moves too. This program's hand-written one (`audio-core/src/fft.rs`)
  becomes `prism_fx::util::fft`, so the crate keeps no outside crates. idMLab's
  master plan names `rustfft` for its spectral work (P9); this replaces that
  need.

## The first slice

Small enough to prove the path in both programs, with real effects.

| Effect | Why | Source |
| --- | --- | --- |
| Tremolo, with Auto-Pan as its stereo phase | New, simple, and stereo | [HYPERPRISM.md](HYPERPRISM.md#the-four-new-effects) |
| Decimator | New, and it has hard edges to test | [HYPERPRISM.md](HYPERPRISM.md#the-four-new-effects) |
| Echo | It exists here, so moving it proves nothing breaks | `fx/src/dattorro.rs`, keys `delayMs`, `feedback`, `damping`, `wet`, `dry`, `glideMs` |

### Order of work

Tests come first at every step, as both programs' rules ask.

1. **The repository.** `Kernel`, `DynKernel`, `Descriptor`, `ParamSpec`,
   `Panel`, `CATALOG`, the contract tests and the counting allocator, with no
   effects yet. The contract tests pass on an empty catalogue and fail on a
   bad entry planted in a test.
2. **Tremolo and Decimator** in the crate, each with its own behaviour tests
   (from HYPERPRISM.md) on top of the contract tests.
3. **Echo, moved.** The prism Echo keeps every key and its behaviour. A test
   renders this program's existing Echo and the prism one on the same input
   and parameters, and requires them to match before the old one is removed.
   Documents that use Echo then load unchanged.
4. **This program's adapter**: the `Prism` slot, `PrismEffect`, the catalogue
   in `/api/fx`, the panel's groups and pad pair in the UI. Every existing
   `fx` test still passes; the rack gains the three effects; a Playwright spec
   adds one and moves its controls.
5. **idMLab's adapter**: the mix fix, `prism-gen` and the generated
   `prismModules.ts`, `ModuleKind::Prism`, `PrismModule`, and the bridge
   entries. `dsp-core`'s effect contract table includes the three, its
   bridge test covers the generated indices, and `npm run verify:wasm` passes.
6. **One listen in each program**, the same file through the same settings.

### Done means

- Tremolo, Decimator and Echo come from `prism-fx` in both programs.
- This program's documents with Echo load and sound the same.
- idMLab's three new modules show ranges that come only from the crate.
- A change to a range in the crate fails idMLab's build until the descriptors
  are regenerated.

## Later

- **The other effects.** This program's own have all moved (see
  [The rack moved](#the-rack-moved)). What is left is the intake's effects not
  yet written, family by family, in the order EFFECT-INTAKE.md gives.
- **The grain engines.** *Built.* The five stretch engines, the `Stretcher`
  and the `BlockRenderer` moved unchanged into `prism-grain`, a sibling crate
  in the prism-fx repository, with no dependencies. `fx` re-exports its modules
  under their old paths (`fx::grain`, `fx::stretch` and the rest), and `engine`
  re-exports `render` and `stretcher`. They are not rack effects and have no
  `Kernel`. idMLab's `dsp-core` depends on it too and wraps the `Stretcher` as
  a rack module.
- **A native idMLab**, if it comes, links the same crates and drops the wasm
  adapter.

## Open questions

- **The name.** The crates are still `prism-fx` and `prism-grain`; the
  repository is `rjvaleo/hyper-efx`.
- **Where the repository lives remotely.** *Answered:* GitHub,
  `rjvaleo/hyper-efx`. Both crates are still named by path here, so CI cannot
  build them yet; see [The rack moved](#the-rack-moved).
- **Stereo in idMLab before P1.** *Answered:* idMLab's effects became stereo
  first, and it runs prism modules in true stereo.
- **Mono files in this program.** *Answered:* the one channel is fed to both
  sides and the left kept, unless the effect has its own mono path
  (`Kernel::has_mono`), which it then runs (`tick_mono`).
- **Retiring this program's own effects.** *Done in the rack, 31 October:* the
  rack builds every effect from prism-fx. The old code stays as the parity
  reference; when to delete it is open.

## Corrected during the build

*22 October 2026. Steps 1–4 are built in this program; idMLab's adapter
(step 5) is set aside for now.*

- **The crate's layout.** `smooth.rs` sits at the top of `src/`, not under
  `src/util/`, and `prism-gen` is not written: it belongs to step 5.
- **`ParamSpec` gained `glides`.** A glide time names the control it glides
  (Echo's `glideMs` glides `delayMs`). The contract's deaf-control check needs
  it: a glide changes nothing unless its control moves, and moving every
  control at once instead made a real fault — a value stored and applied only
  when something else moves — look like a glide.
- **The deaf-control check** tries each control from the defaults, then with
  every other control at its far end (an effect can be transparent at rest, as
  the Decimator is at 100 % and 24 bits), then — for a glide — while its
  control moves. It listens for a second, long enough for Echo's default
  repeats.
- **Two more states for it, added with the SoundHack plug-ins** (23 October):
  every other control a quarter of the way along, and every switch on with
  the rest at their defaults. A delay's far ends (ten seconds, all dry) hide
  its wet sound, and its rest (no depth, no feedback) silences its LFO. A
  pitch shifter's just tuning sounds the same as equal tuning at no shift or
  a whole octave. A granulator's tuning waits for keys other than the root.
  None of those is a fault, and none needed a `when`.
- **Echo matches bit for bit** with the settings held, mono and stereo, at
  several block sizes, and after a reset (`fx/tests/prism.rs`, which renders
  the old `fx::dattorro::Echo`). Wet, dry, feedback and damping now glide over
  5 ms where they stepped at the block edge. The old Echo stays in
  `dattorro.rs` only as that test's reference; the rack no longer builds it,
  and `dattorro_echo` documents open on the prism one and save as `prism:echo`.
- **The dependency is a path**, `../../../../GitHub/prism-fx/crates/prism-fx`,
  because prism-fx has no remote yet. CI cannot see it, so it must become a git
  dependency on a tag before this is pushed.
- **`/api/fx`** lists prism effects among the shapers with kind `prism:<id>`, a
  `category`, `choices` and `step` on their controls, and the panel (groups,
  primary, displays, and the pad as `x`, `xMin`, `xMax`, `y`, `yMin`, `yMax`).
- **Effects that take a sound.** A descriptor's `sound` names one (a
  convolution's impulse), and `Kernel::set_sound` hands it over, interleaved at
  its own rate, off the audio thread — the one place after `new` an effect may
  allocate. The contract and the allocation test attach a test sound to any
  effect that takes one. Here, a slot keeps its sound as a library path;
  `App::set_rack` decodes it once into `fx::prism`'s cache when the rack is
  stored, and building the chain hands it over from there.
- **`ParamSpec::when`.** A control that only means something in one setting of
  another — Spectral Dynamics' reduction, in Gate-Duck — says so. The contract
  tries it in that setting, and the rack dims it outside it.
- **`prism_fx::fft`.** The crate's own radix-2 FFT, for the spectral effects.
- **`automation::unit_for`** now picks whichever end of its final bracket gives
  the value back, because a prism count or choice is a step, and bisection on a
  step lands on its edge.

## The rack moved

*31 October 2026. Built and merged: this program's PR #13, prism-fx's PR #1.*

- **Every effect the rack builds is prism-fx's.** The 33 shape kinds go
  through `fx::shape::make`, which builds `ShapeKind::prism_id` with
  `fx::prism::moved`. `RackSpec::build` (`server/src/rack.rs`) does the same
  for the EQ, the compressor, the gain and the channel maximizer. Each is built
  as this program's own was (`PrismEffect::as_built`: the kernel as made, with
  only the stored controls set) and given the stored settings by key. Documents
  keep their kinds and keys.
- **Held bit for bit.** `fx/tests/prism_parity.rs` renders all 37 against the
  old ones: at the defaults, with each control moved across its range, and with
  controls moved while running; mono and stereo; blocks of 512 and 61. It also
  holds the keys and ranges the same, and the compressor's gain-reduction
  telemetry. Tests in `rack.rs` hold the built rack to the old build.
- **prism-fx gained `Kernel::has_mono` and `tick_mono`**, for an effect whose
  original treated one channel its own way: the detune averages its voices
  into mono, and the utility skips swap and mid-side. `PrismEffect` uses
  `tick_mono` for one channel. **`Kernel::telemetry`** carries the compressor's
  gain reduction to its meter.
- **Where this program's own is still built.** `moved` in `rack.rs` keeps the
  old effect when the prism control cannot hold a stored value exactly: a gain
  past ±24 dB, and an EQ whose high-pass is below prism's 10 Hz floor. Every new
  EQ starts at 0 Hz, so it stays this program's own until its high-pass is set
  to 10 Hz or more. `shape::make` falls back to `make_own` should a build of
  prism-fx lack a kind.
- **The old DSP stays** as the parity reference, as the old Echo did:
  `shape::make_own`, `dattorro.rs`, `reverb.rs`, `phaser.rs`, `eq.rs`,
  `comp.rs` and `master.rs`.
- **Channels past the second** pass through untouched.
- **Still a path.** prism-fx now has a remote, but `fx/Cargo.toml` and
  `engine/Cargo.toml` name `prism-fx` and `prism-grain` by path
  (`../../../../GitHub/prism-fx/crates/…`). CI checks out this repository
  alone (`.github/workflows/ci.yml`), so it cannot build the workspace until
  they become git dependencies.
