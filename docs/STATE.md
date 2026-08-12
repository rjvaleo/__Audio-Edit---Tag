# Audio Edit & Tag — complete state

Written 11 August 2026 as a handoff, and kept up to date since. **785 tests
passing, working tree clean.** Everything an agent picking this up needs to know, in one file,
because the per-topic notes live in `~/.claude/projects/…` on one machine and
this repo travels.

---

## 1. What it is, and how to run it

Browse, audition, tag, edit and mangle a large audio library without moving or
renaming a single file. One native Rust binary serving a local HTTP interface on
`127.0.0.1:8737`, owning the audio device directly.

    ./Start.command          # macOS
    StartHere.bat            # Windows

    cargo build --release --manifest-path core/Cargo.toml
    cargo test  --release --manifest-path core/Cargo.toml     # 785 tests

**The interface is embedded in the binary** with `include_str!` — `ui/index.html`,
`ui/app.css`, `ui/app.js`, `visualiser/grain-views.html`. **Rebuild after any
interface edit or the browser is served the old file.** This has cost more time
than anything else in this project.

If you run the binary directly rather than through the launcher, set
`AUDIOLAB_DATA` or it writes its data beside the binary instead of into `data/`.

    AUDIOLAB_DATA="$PWD/data" ./bin/audiolab

It reaches the internet at no point. p5.js and both fonts are served from the
binary.

---

## 2. How the user works — read this first

Getting this wrong once produced *"You got it SO FUCKING WRONG"* and a wasted
rebuild.

- **Build, don't ask.** Standing instruction. *"Just build the final version — do
  the rewrite, it is OK if nothing is working."* Reserve questions for decisions
  that would waste real work if guessed.
- **Messages arrive mid-turn, voice-dictated and terse.** Often fragments
  ("swap edit and browse buttons"). Read them as precise instructions.
- **When a UI description is genuinely ambiguous, ask once with concrete
  options** rather than building twice.
- **They notice contrast, spacing and wasted vertical space.** Several rounds
  were spent reclaiming rows. Default to compact.
- **TDD is expected, not optional.** They asked for it explicitly, and for Rust
  for the audio.
- **They react strongly to things that sound good — capture the settings
  immediately** when they say so. In-memory-only state nearly lost their
  "Swarm 1" preset.
- **Do not fake capability.** An unimplemented control must not appear as a live
  one. They approved "Not built yet" labelling.
- Standing permissions: the Zero Dependency Rule is lifted ("use whatever is
  best"). The tracked `.wav` files in `Audio Library/` stay ("leave the audio in
  there, it is small").

---

## 3. Architecture

Rewritten from Python into Rust starting 8 Aug 2026. The old Python app still
sits in `app/`, untouched and **not deleted**.

Ten crates in `core/crates/`, ~32k lines.

| crate | what it is |
|---|---|
| `audio-core` | container probe/decode (WAV, AIFF, AIFC, headerless PCM), peak tiles, FFT, spectrogram, stats, WAV writer |
| `catalog` | classification taxonomy, ported from `ingest_index_v2.py` |
| `indexer` | library walk, classify, write the TSV index |
| `fx` | biquads, EQ, compressor, channel maximiser, **five stretchers**, **nine live shapers** (`shape.rs`) and the parameter layer (`params.rs`) — `stretch.rs` (WSOLA + dispatch), `vocoder.rs`, `grain.rs`, `pvsola.rs`, `hybrid.rs` on `decompose.rs` + `noise.rs`, plus `stream.rs`, `transient.rs`, `master.rs` |
| `edit` | non-destructive edit list (clips), windowed render, export, **zero-crossing snap** (`snap.rs`) and **measurement** (`analyse.rs`) |
| `engine` | real-time: `render` (blocks), `transport` (play/seek/loop), `device` (cpal) |
| `search` | acoustic fingerprints, similarity ranking, learned tags |
| `yamnet` | ONNX inference via tract, band-limited resampling, label policy |
| `server` | hand-rolled HTTP/1.1 on `std::net`, routes, JSON, persistence, **marker and region commands** (`annot.rs`) |
| `audiolab` | the binary |

### Dependencies

Two direct crates, 136 in the tree. **`cpal` 0.18** (audio device) and
**`tract-onnx` 0.23** (YAMNet). Both pure Rust, which preserves what the
original zero-dependency rule was protecting: the Windows cross-build is one
command with nothing but the mingw linker. **That is the test for a third
dependency** — not "is it a dependency" but "does it break the cross-build".

Written here rather than pulled in: the HTTP server, the JSON parser, the FFT,
every filter and stretcher, the TSV store.

**Not WebAssembly.** All DSP runs natively. `audio-core`, `fx` and `catalog`
compile cleanly to `wasm32-unknown-unknown` — that door is open on purpose, but
nothing uses it.

### Toolchain

rustup, Rust 1.97.1 (replaced Homebrew's 1.70), `x86_64-pc-windows-gnu` target,
mingw-w64 linker. A real PE32+ `.exe` has been built and verified from the Mac —
**but it has never actually been run on Windows.**

### What it stores

Everything in `data/`, beside the launcher, deliberately *not* under
`core/target` which `cargo clean` would take with it.

`config.json` · `AUDIO-INDEX.tsv` · `FINGERPRINTS.tsv` · `LABELS.tsv` ·
`USER-TAGS.tsv` · `TAG-OVERRIDES.json` · `SESSIONS.json` · `PRESETS.json` ·
`exports/`

TSV rather than a database: proven at 75,000 rows, append-only which is what
makes a scan resumable, and openable in a spreadsheet. A database would add a C
dependency and break the single cross-compiled binary.

---

## 4. Invariants

Each has tests pinning it. If a change requires breaking one, that is a design
conversation, not a patch.

1. **The source file is never written.** Edits, effects and stretch are all
   sidecar. Audio reaches disk only through an explicit Export to a NEW file, or
   a capture, which also writes a new file beside the original and never
   overwrites. Verified by MD5 after editing. Export writes **into the library**,
   beside the sound it came from — a new name every time, never an existing
   one; see §7e.
2. **Grain randomness is a pure function of grain index and seed** — never a
   running generator. The waveform, playback and export are three separate
   renders; a stateful RNG would give each different audio and the picture would
   stop matching the sound.
3. **The offline renderer, the real-time renderer and the visualiser share one
   enumeration** (`fx::grain::grains()` / `GrainStream`, both via one
   `event_at`). This is the rule that keeps being *nearly* broken — the block
   renderer once had its own copy of the grain envelope with a comment promising
   it matched. `env_at` and `pan_gains` are public for exactly this reason.
4. **Effects must not change buffer length.** That is why time-stretch is a
   property of the *document* (`EditList.stretch`), not a rack effect.
5. **`output_frames()` must equal what `process()` actually produces.** The
   timeline is laid out from the prediction before any audio is rendered.
6. **A windowed render must match the full render.** Filters get 200 ms
   pre-roll; stretch renders whole because WSOLA picks each splice from the
   previous one.
7. **Edit operations address the PRE-stretch timeline** (`base_frames()`).
8. **A sound opens at its defaults.** Sessions are written and are *not*
   applied on open — see §7d. The validation that refuses a saved session whose
   file has changed (frames, channels or sample rate) is still there and still
   tested, because presets go through the same reader; it is simply no longer
   on the path a file takes when you open it.

   Work done in the current run is untouched by this: a session is created once
   per file per process, so switching tabs and coming back keeps everything.
9. **Every control is inert at its default, exactly.** A document that never
   touches a new control must render byte-for-byte what it did before that
   control existed — asserted field by field, not by spreading defaults, which
   would test nothing.
10. **Nothing reaches the output above the ceiling** once the channel maximiser
    is on. Everything upstream of the final clamp is smoothed and can be caught
    out by a transient the attack did not reach in time; the clamp cannot.
11. **What you hear is what you export.** Newly enforced structurally for WSOLA
    — see §5.

---

## 5. The five stretchers

`fx::stretch::Algorithm` = `Wsola | Vocoder | Pvsola | Hybrid | Granular`,
picked from one row in the Time & Pitch panel. Not a quality ladder — they fail
in different directions.

| | Domain | Good at | Bad at |
|---|---|---|---|
| WSOLA | time | transients, percussion | dense polyphony smears |
| Phase vocoder | frequency | chords, sustained tone | transients smear, noise goes watery |
| PVSOLA | both | sustained pitched material, long ratios | small splice artefacts; ~2.5× the vocoder |
| Hybrid | both | anything mixed; the only one that will not repeat noise | ~5× the vocoder |
| Granular | time | extreme ratios, texture | not trying to be transparent |

**The whole `STRETCH-ROADMAP.md` is built** — candidates 1–6 exist, 7–10 do not.

### How the last two are built

They are built *out of* the first three rather than beside them.

- **PVSOLA** (`pvsola.rs`) runs the vocoder for `anchor_frames` frames, then
  restarts it on a fresh segment whose phase comes from the input, splicing the
  two with WSOLA's correlation search. Nothing carries across an anchor, so
  phase drift never accumulates.
- **Hybrid** (`hybrid.rs`) separates with `decompose.rs`, sends the partials to
  the vocoder, the attacks to WSOLA with transient preservation forced on, and
  the residual to `noise.rs`; then sums with a level per part.
- **`decompose.rs`** — median filter the magnitude spectrogram along time (keeps
  horizontal ridges = partials) and along frequency (keeps vertical ridges =
  attacks), then Driedger HPR-M binary masks with a margin. **The margin is the
  point**: without it there is no residual at all and the noise morpher has
  nothing to work on. The masks partition, so the parts sum back to the input.
- **`noise.rs`** — does not stretch noise. Measures the residual's spectral
  envelope, interpolates it along the new timeline, imposes it on fresh noise.
  Nothing is reused so nothing can repeat.

Sources: Driedger's thesis (vocoder phase propagation is eqs 5.10–5.12 and the
code is laid out to be read against them), Fitzgerald + Driedger HPR-M for the
separation, Moinet and Dutoit DAFx-12 for PVSOLA, Moliner et al. 2023 for noise
morphing.

### One control model, every engine

Density, overlap, layers, size jitter, position jitter, pitch jitter, pitch
drift, drift rate, scan, reverse, envelope, size range, wrap, layer spread, link
jitter, step the drift, pan spread — **all of them drive all five engines**.
They were never granular ideas: every engine lays something down repeatedly, so
every one has a rate, a length, a place it reads from and a speed it reads at. A
window is a splice for WSOLA and an analysis frame for the vocoder.

Where there was no exact analogue the nearest honest thing was built:
- Vocoder **size jitter** varies the synthesis hop, because a fixed transform
  size is the basis of the phase propagation and cannot vary.
- Vocoder **reverse** reads the frame back to front *before* the transform.
- **Layers** wraps the whole engine (`layered()` in `stretch.rs`), not an engine
  change, because nothing about it is engine-specific.

**Layers are a cloud, not a comb.** Every layer used to read the *same* instant
of the source and be laid down a fixed fraction of a hop later — a delay line,
and regular delays make regular notches. Sixteen layers took the spectrum's
ripple from 7.8 dB to 11.9 dB and made the sound thinner, not fuller. Two
controls fix it: **Scatter** throws each layer's read pointer somewhere else and
**Range** says how far — small is a chorus, large is a wash. Layer zero never
moves, or turning scatter up would slide the whole cloud off the beat. After:
granular 7.9 dB, WSOLA 5.9, vocoder 6.0, PVSOLA 6.0 — at or below one layer.
The hybrid never combed, because its three parts are already three signals.

**One concept, one control.** `grain.overlap` is the only overlap and
`grain.scan` is the only read-pointer control; per-engine duplicates were
removed. PVSOLA and Hybrid added no duplicates — they inherit the grain controls
through the engines they call, and are deliberately **not** wrapped in
`layered()`, which would run every layer twice.

### The panels show what reaches the audio

`fx/tests/routing.rs` pins the entire table in both directions: everything a
panel shows moves the audio, and what a panel does not show provably does not.

- PVSOLA carries the vocoder's whole extended set (it *is* the vocoder between
  anchors) and deliberately **not** WSOLA's — it finds its splice with its own
  search, so those would be decoration.
- Hybrid carries the vocoder's *and* WSOLA's, and holds transient preservation
  on so the detector group is live with no switch for it.
- In `app.js` the two shared groups are built by `vocoderControls()` and
  `wsolaControls()`, called from three engines each. **Do not re-duplicate.**

### Streaming — the current work

**The chosen direction (user decision, 11 Aug 2026): streaming engines in the
audio callback.** They were told it is weeks of work and chose it over
pre-rendering.

Done: **`fx/src/stream.rs` — `Streamer` trait and `WsolaStream`.**

- Keeps state between blocks: read position, write position, and the stretch of
  waveform it expects to follow what it just laid down.
- Overlap-add into a ring long enough for the widest window any control allows;
  a frame is handed out only once the write pointer has passed it, at which
  point nothing further can contribute.
- **Everything sized at construction from the widest settings**, not the current
  ones, because the current ones change between blocks.
- The transient map is the one thing that must allocate (it walks the whole
  file), so it is built on the caller's thread and handed over via `set_map` —
  the same arrangement the rack uses.
- **`stretch::wsola` is now a loop over the same streamer**, driven in 64k
  chunks. Live-equals-export is a property of there being one implementation
  rather than two staying in step. All 78 stretch tests passed unchanged, which
  is what says the rewrite is faithful.

Proven, not asserted: streaming matches offline to 1e-5 at every ratio and does
not depend on block size; `fx/tests/no_alloc.rs` uses a counting global
allocator to show **zero allocations across 200 blocks, and across 120 blocks
with the controls moving on every one**. That test file contains exactly one
`#[test]` because the counter is global and two would race.

Seeking is honest about its limit: each window's position is chosen to continue
the one before, so where WSOLA is depends on every splice since the last seek —
unlike a grain, whose randomness is addressed by index. After a seek it lands on
the same material at the same level (0.95 correlation), not the same samples.

### Level bugs that hid here — read before touching normalisation

Both survived their own tests, and both were caught only by asserting
*amplitude* rather than "did it change" and "is it finite".

1. **The vocoder peaked at 20× the source.** It divides by the summed *square*
   of the window, which tails toward nothing where only one frame overlaps, and
   the guard was `1e-6`. It started when overlap moved to the shared control and
   the vocoder went from 75% to 50% overlap. Now floored at a share of the peak
   (`NORM_FLOOR`).
2. **WSOLA's loop required the read to stay a window short of the end.** Fine
   while it crept forward; a scan starting at the end and running backwards
   fails on its second hop, so reverse scan rendered one window then silence.

**Granular layers used to lose level and the others did not.** Measured: at 16
layers with jitter, granular landed at 0.25 = 1/√16 — the overlap-add divides by
grain *count* while decorrelated grains only sum by its square root. With layer
spread on and no jitter it is worse (0.09), because averaging time-shifted
copies is a comb filter. WSOLA and the vocoder hold level because `layered()`
measures one layer's RMS and scales the sum back to it; granular's layering is
older and never got that. **The fix is not free** — the real-time renderer
cannot measure RMS ahead of a block, so fixing the render alone would have made
live and export disagree. **Fixed 11 Aug 2026 by `grain::layer_gain`**, which
both paths call — see §12.

### Three PVSOLA traps, all found by measuring

The first version was measurably *worse* than the plain vocoder it exists to
improve on.

1. **Do not splice from the vocoder's ramp-up.** Each run's first ~window of
   output has incomplete overlap-add depth. Each run now gets a discarded run-up.
2. **The cross-fade must be linear, not equal power.** Equal power is right for
   uncorrelated signals; the splice search has just spent its whole effort
   making the two sides correlated, so equal power sums to more than either side
   and bumps at every anchor.
3. **Measure the run-up in *output* frames, not input frames.** In input frames
   the discarded run-up grows with the ratio while the material it protects does
   not, so cost goes as the *square* of the stretch — 21.6 s at 16× where it
   should be 4.6 s. There is a test pinning this.

### Testing rulers

- **A spectral measure cannot see phasiness.** It does not move energy to new
  frequencies; it moves partials out of the phase relationship that gave the
  waveform its shape, and a magnitude spectrum is blind to that by construction.
  The first PVSOLA test measured spectral purity, reported a regression, and was
  measuring nothing. Use best waveform correlation against the source over one
  period of lag, **averaged over the whole stretch**, and check the margin
  *widens with the ratio*.
- **Crest factor is the wrong ruler for compression.** A fast release lets the
  gain back up between peaks, so a harder setting can come out with a *wider*
  crest. Use gain reduction.
- **Two channels that are scaled copies come out identical linked or not.** The
  stretch is deterministic, so both channels ask it the same question and
  `stereo_link` cannot change the answer. Any test of it needs a *delayed* right
  channel. **This has cost time twice.**
- **A threshold control cannot be tested with uniform material.** Give the
  detector hits far above the bar and every setting finds the same ones. Grade
  the amplitudes so some sit near it.
- Every control has two tests: **inert at its default** (spelled out field by
  field) and **reaches the audio when moved**, with the length held and the
  output finite *and bounded*.

### Cost, measured

Five seconds of stereo at 16×: vocoder 1.7 s, PVSOLA 4.6 s, hybrid 4.4 s — all
linear in length and ratio.

---

## 6. The real-time engine

Three layers, deliberately separable (`crates/engine`):

- **`render.rs`** — `BlockRenderer`. Grains become *voices*: a grain that
  outlives its block stays active into the next carrying its position. Fixed
  `[Voice; 1024]` and `[GrainStream; 16]`, so it never allocates — a full pool
  drops the newest grain and bumps a counter.
- **`transport.rs`** — `Core::fill`, the callback minus the sound card. Play,
  seek, loop, capture, spectrum.
- **`device.rs`** — cpal, deliberately thin, on its own thread because
  `cpal::Stream` is not `Send` on macOS.

`Shared` keeps scalars as atomics and the two compound values behind mutexes the
callback only ever **`try_lock`s**. If the UI thread holds one, the callback
keeps the copy it has and picks the change up next block — under 3 ms late,
versus a dropout if it blocked.

**Parameters are read per grain, not per block.** `GrainStream::next` recomputes
`plan()` from the current params for every grain, so a slider moved now shapes
the very next grain.

The rack is handed over by **ownership** — the UI thread builds it, the callback
adopts it — so the allocation stays off the audio thread and filter state is
never shared.

`GrainStream::seek` derives the index from position ÷ hop, so scrubbing to a
moment gives the same grains as playing to it.

Two rules learned the hard way, which must not be undone:
- **The engine stops itself** at the length its own schedule implies. A grain
  stream is happy to run forever reading the clamped last sample — playback ran
  20 s past the end of a 1.67 s file before this.
- **A loop end of zero means "the whole document"** and the engine substitutes
  its own length. The UI used to compute that and got it wrong after a stretch
  change.

### Which engines run live

**`engine::stretcher::Stretcher` holds every engine the callback can run**, all
built when the device opens and never allocated again — building one on demand
would be an allocation in the audio callback, and switching engines is the
moment you least want a dropout. Only the selected one is asked for audio, so
the one being switched *to* is re-seeked to the transport's position first: it
may have been sitting somewhere from minutes ago, or never have run.

| Engine | Live? |
|---|---|
| Granular | yes — `BlockRenderer` |
| WSOLA | yes — `Pitched<WsolaStream>` |
| Vocoder | yes — `Pitched<VocoderStream>`, both stereo modes |
| PVSOLA | yes — `PvsolaStream`, two vocoder runs swapped at each anchor |
| Hybrid | yes — `HybridStream`, three engines on three separated sources |

**Every engine streams, and each is the only implementation there is.**
`stretch::wsola`, `vocoder::stretch`, `pvsola::stretch` and `hybrid::stretch`
are loops over their streamers; the old whole-buffer versions are deleted.

**The hybrid's separation does not depend on the ratio.** Splitting a sound into
partials, attacks and everything else is a property of the sound, not of what is
being done to it — which is what makes the engine streamable at all. It runs on
a thread of its own, only when the hybrid is selected, and is thrown away if the
file changed while it ran. It costs about a tenth of a second per second of
stereo; until it arrives the hybrid plays the grain cloud rather than silence. Live-versus-export is asserted at 1e-6, which is the
difference between two implementations that agree and one implementation. When
the vocoder had two, they matched to about −80 dB — close enough to hear
nothing, far enough that the guarantee was a claim rather than a fact.

Two things had to change to stream the vocoder. The overlap-add cannot be
normalised at the end because there is no end, so it goes into a ring. And the
normalisation floor cannot be a maximum over the output — it is derived from the
window and the hop, by laying frames until the overlap is complete and taking
that peak, which is what the maximum was converging to and is the more honest
quantity besides.

`is_live()` in `engine/src/stretcher.rs` is the authority; `LIVE_ENGINES` in
`app.js` mirrors it. The three that fall back are marked with a dot on the
picker and a line of text in the panel, because a control that quietly does
something else is worse than one that admits it.

**Switching engines cross-fades.** Switching outright put a step of 0.63 into a
waveform whose neighbouring samples were moving by 0.0003, and dropped the level
to 0.21 from 0.34 while the incoming engine's overlap-add ramped up. The
outgoing engine now keeps running for about 20 ms and the two are mixed, equal
power — two engines rendering the same instant agree about what is there and not
at all about its phase. That is the opposite of PVSOLA's splice, where the
search correlates the two sides first and linear is then right.

**A block must be made faster than it plays.** That is the one property that
separates a live engine from a rendered one, and it is invisible in every other
test — a streamer that is correct and slow passes all of them and drops out the
moment you press play. What matters is the *worst* block, not the mean: PVSOLA
makes a whole vocoder run per anchor, and doing it in one callback measured at
89% of the budget. It is made a slice at a time now, spread across the blocks
the previous round plays for. Measured worst block: granular 0.2%, WSOLA 7.5%,
vocoder 12%, PVSOLA 18%, hybrid 17%. With layers, which are the expensive case:
WSOLA ×8 20%, vocoder ×8 24%, vocoder ×16 44%. `pv_cost.rs` guards all of it.

**The layer offset is what makes layers affordable.** Each layer is delayed by
its own fraction of a hop, which interleaves the frames — and keeps every layer
from transforming on the same block. Sixteen vocoder layers firing together
measured at 160% of the budget; staggered they are 44%.

**Pitch needed its own stage.** Offline WSOLA shifts by over-stretching and
reading back faster; folding that into the splice instead would have been a
different sound. `Pitched` drives the inner engine at ratio × pitch and
resamples the result, sized for the widest shift the control allows.

**Two engines never got that stage** — reported by ear, 11 Aug 2026: *"it
doesn't sound like the PVSOLA or Hybrid respect the pitch slider."* They did
not. Both are built *out of* the other engines rather than beside them, so
neither can be a `Streamer` — PVSOLA takes parameters of its own, and the
hybrid reads a separated source rather than the input — and `Pitched<S>`
requires one. So they were wired in bare, and the pitch control moved the
exported file while doing nothing at all to what came out of the callback.

The resampling half is now `fx::stream::PitchRing`, with no engine attached.
`Pitched<S>` is that plus a `Streamer`; `PitchedPvsola` and `PitchedHybrid`
drive it directly. **One resampler**, which is the point — two would be two
different sounds, and this project has been caught by that shape before.

Two more came out of the same hour, both invisible until something asserted
samples rather than pitch:

- **The two resamplers were not the same curve.** Offline used four-point
  Hermite, the streaming stage used two-point linear. A pitched stream and a
  pitched export were audibly alike and numerically 0.11 apart. `hermite` is
  shared now.
- **The offline resampler computed its read position in `f32`.** At a hundred
  thousand frames the gap between representable `f32` values is about eight
  thousandths of a sample, so the interpolation fraction was wrong by that
  much. Both ends compute it in `f64` now, and the streaming side *derives* it
  from the output frame rather than accumulating, so a long render cannot walk
  away from `f × pitch`.

They agree exactly now — every frame but the last. At the final output frame
the offline render has run out of stretched audio and clamps to its last
sample while the stream reads the real thing, which is a finite buffer meeting
an endless one rather than a disagreement. The test excludes that frame and
bounds it separately rather than widening the tolerance to hide it.

**The transient map is handed over like the rack**, because deriving one runs an
onset detector across the whole file. It is rebuilt only when something it
depends on moves, and not at all while transients are not being preserved —
a plain stretch is a straight line, which is arithmetic, so the ratio stays free
to move under the pointer.

### The playhead is drawn from two numbers the engine publishes

The position is polled twenty times a second and carried forward on the wall
clock in between, so the line moves at the frame rate rather than in twenty
steps. Carrying forward needs two corrections, and without them a short loop
draws ghosts.

**The loop.** Carrying forward is monotonic and a loop is not. Between one poll
and the next the playhead ran past the loop end and was dragged back when the
truth arrived — fifty milliseconds of overshoot, which on a short loop is most
of the loop, drawn outside it and flickering as it was corrected. `Shared` now
publishes the loop the callback *resolved*, and the carried-forward part wraps
there. It has to be published rather than computed: a loop end of zero means
"the whole document" and only the callback knows how long that is under the
current ratio — which is the same mistake the comment on `loop_bounds` was
already written about.

**The output latency.** `position` counts frames *produced*; the device holds a
buffer of them before any reach a speaker, so a line drawn from the counter
leads the sound. cpal's `OutputCallbackInfo` reports the gap between the
callback and the moment its first sample is heard — **655 frames, 13.6 ms, on
this machine** — and it was being discarded as `_`. Measured, not assumed, and
zero until a device says otherwise.

`server/src/live.rs` bridges a document to the engine: structure (cuts, fades,
reverse) is folded into the source offline at load; stretch, pitch, every grain
control and the whole rack are live.

**Correction worth carrying:** I initially said the hybrid cannot stream because
its median filtering needs the whole file. Wrong — the time median spans
`time_span` frames, which at the default 17 is ±8 frames ≈ 93 ms of lookahead.
Bounded. **All four non-granular engines can stream**, at ~100 ms latency for
the hybrid. Its one genuinely global step is a normalisation floor taken from
the whole file, which needs replacing with a fixed one.

---

## 7. The interface

Plain HTML, CSS and JavaScript. No bundler, no framework, no build step.

Controls follow one table — **name, control, reading** — in three columns whose
widths are declared once. Four kinds sharing one contract so they are
interchangeable at the call site: `param()` slider, `knob()` , `check()` rocker
switch, `seg()` three-way choice.

**Every control in the stretch tray carries an explanation**, attached with
`tip()` and set on the whole row so the name, the slider and the reading all
say the same thing. It deliberately overwrites the label-only title `param`
puts on the name for clipping, and deliberately does *not* overwrite a
segment's own words — those are about one choice and are the more useful of the
two. A hundred controls across the five engines; a test of the interface would
be the way to keep it that way, and there isn't one, so the check is a loop in
the browser console over `.param` rows looking for a missing or label-only
title.

### The stretch tray

Two half-width modules side by side, equal widths:

- **Standard** — the engine picker with *Reset all* right-aligned on it, then
  Time & pitch, Grain shape, Pitch movement.
- **Extended** — everything that used to be a constant inside an algorithm, with
  its own *Reset* on the first group's rule.

The picker holds **five** engines and decides what both columns contain. Neither
panel has a heading; the sub-nav says *Time & Pitch*. The dock's tabs sit on the
preset row under the transport rather than down the left edge, which returned
58 px to the controls.

**Reset all** puts every control back on **both** sides but stays on the engine
you are in — which engine you are in is not a setting to be undone. Neither
reset touches the grain seed.

### The preset manager

**Manage…** on the preset row opens a modal: presets down the left, every stored
value of the selected one on the right, editable. A preset holds **all five**
engines' settings at once, so most of it is invisible from the panels — this is
the only place the whole thing shows.

Rows are generated from `PM_SCHEMA` in `app.js`, not written out, so a new
control needs one line there. The schema carries **no ranges**: the server
clamps every value through the same `stretch_from_json` the document uses, and
the manager shows back what was actually stored, so a value pulled into range
says so immediately. An empty number box means *nothing stored* — shown empty
rather than as zero, because zero is a real setting.

Four routes: `/api/presets` captures from a file; `/api/presets/update` and
`/api/presets/duplicate` write values outright with no file open;
`/api/presets/delete`. Renaming onto an existing name is a 409, not a swallow.

### The server

Roughly thirty endpoints. Every path from the interface is resolved inside the
library with `resolve_within`, which rejects absolute paths, parent components
and Windows prefixes, then canonicalises both sides so a symlink pointing
outside is caught too.

**Absent means unchanged.** A control that posts one field does not reset the
twenty it did not mention.

---

## 7b. Live shaping — the Peak work

Peak's DSP menu is a list of things you apply to a selection and wait for. Most
of them have no reason to work that way, so they are rack effects here and run
under the fingers while the sound plays. Built from `Reference Docs/md/peak/`
rather than from the names, which mattered: **Rappify** turned out to be extreme
*dynamic filtering*, not distortion, and **Amplitude Fit** is per-grain
normalisation, not compression.

### `fx::params` — the layer automation needs

Every parameter has a stable **key**, a range, a default, a sweep (log or
linear) and a unit, and is readable and writable by name through the `Params`
trait. Automation and modulation then become one small thing that writes keys
rather than a change to every effect. This went in *first* because it is the
expensive thing to retrofit.

**The key is the contract.** It will live in saved automation, so renaming one
silently detaches whatever drives it.

`ParamSpec::from_unit` snaps its endpoints exactly rather than trusting
`exp(ln(x))`, which returns 19999.992 for a maximum of 20000 — inside the range,
so a clamp will not catch it, and it fails a comparison much later.

### The nine shapers (`fx::shape`)

Invert · Swap · Width · DC offset · Ring modulate · Rappify · Reverse boomerang ·
Amplitude fit · Gate. All implement `Params`.

Two are **better live than they ever were offline**. *Reverse boomerang* offline
needs to know where the selection ends; live it is a rolling buffer read
backwards, so the reversal chases the playhead and the throw length becomes a
control it never had. *Amplitude fit* offline normalises a file grain by grain;
live it is the same idea on the last thirty milliseconds with the waiting
removed.

**Four bugs the tests caught, all of them subtle:**

1. The boomerang's read pointer **stood still**. The distance behind the write
   head grew one per sample and the write head moves too, so they cancelled — a
   held sample, not a reversal. It has to grow at *two*.
2. The gate's envelope decayed by a fixed factor per sample — a time constant of
   its own, unrelated to the release control — so the gate never closed inside
   the release it was asked for.
3. Amplitude fit followed at the grain rate in *both* directions, which measures
   something nearer an average than a peak, so it asked for far too much gain. A
   signal at 0.29 came out at 1.45. Fast up, grain-rate down.
4. Rappify's band was far too gentle for "extreme dynamic filtering".

**One was the test's fault**, and worth remembering as a pattern: the boomerang
test compared against a window a throw earlier rather than the source running
backwards from the moment the pass begins. The code was right; the expectation
was not. It correlates at 0.97.

### How they are wired

**One `SlotSpec::Shape` variant for all nine**, not nine variants. The older
three (gain, EQ, comp) each carry a settings struct and hand-written JSON; a
shaper describes its own parameters instead, so one pair of conversions serves
all of them and the next one added needs no rack work at all. Parameters are a
*list* rather than a map because that is what automation will address.

`RackSpec::build` takes the **device's** rate and width, because a delay-based
effect sizes its buffer once and may not resize while running.

An unknown kind is **dropped rather than guessed at** — a slot this version does
not recognise is one from a newer version.

**`/api/fx` serves the catalogue** and the interface draws every module from it.
Nothing in `app.js` knows what any shaper does. An effect gains a control by
declaring one in `fx::shape` and neither the rack nor the interface is touched.
It is also what automation will read to know what it may address.

Two interface bugs found by driving it: `slotSummary` fell through to the
compressor's fields for any unknown kind, so the first shaper **threw** — and
the exception aborted the chain redraw partway, which looked like the slot
failing to be added while the server was storing it correctly the whole time.
And the summary printed anything with a maximum of one as a percentage, turning
the gate's −40 dB threshold into −4000%.

### What is planned and not built

- **Pre/post rack.** Shapers currently run *after* the stretcher only, because
  that is where the rack has always been. The user wants them placeable either
  side. A pre-rack has to be rendered into the source off-thread and handed
  over, like the hybrid's separation — the engines read the source at arbitrary
  positions, so a stateful filter cannot be applied per-read. Near-live for
  time-domain effects, but not per-block live the way post is.
- **Phase 2, spectral:** Harmonic rotate (rotate the spectrum around a
  horizontal axis) and Convolve (multiply the spectrum of a captured impulse
  with the target). Both fit an STFT rack effect.
- ~~**Phase 3, the edits.**~~ **Built** — see §7c.
- **Automation and modulation.** Asked for explicitly, beyond presets. The
  parameter layer is the foundation; nothing is built on it yet.
- **Three views** — *edit*, *granulate*, *browse*, each with its own view of the
  sound pool and its own display. Currently two modes. The live shaping belongs
  in *granulate*.

---

## 7c. The Peak edits — Phase 3

Peak's Edit and Action menus, less its own furniture (sampler transfer, CD
burning, plug-in hosting) and less what a nondestructive clip list cannot
honestly do. Built 11 Aug 2026, from `Reference Docs/md/peak/peak-editing.md`
and `peak-menus.md` rather than from the command names.

### Snap is the one that matters

Every cut, fade and loop point used to land wherever the pointer was. Joining
two places in a waveform that are not at the same amplitude puts a step into
the signal, and a step is a click — which is why Peak has Auto Snap on by
default and why this was built first.

`edit::snap` — `SnapUnit` is `Off | ZeroCrossing | Grid(n)`. One `Grid` covers
every fixed grid Peak has, because CD frames (588), PS2 loop boundaries (28),
Xbox (64) and "custom units" differ only in the number.

**Snapping moves the request, never the document.** Nothing in `snap.rs` reads
or rewrites a clip list: the caller asks where a position should be and then
does what it was going to do at the answer. That is what keeps it out of the
render path and out of every test written before it existed.

**Absent means no snap** at the API. The interface turns it on. That way
invariant 9 holds — a caller that has never heard of snap gets exactly the
position it asked for — while the *program* behaves the way Peak does.

Two decisions worth keeping:

- **Crossings are looked for per channel, not in the mono mix.** Two channels
  in opposite phase sum to nothing at all, so a mix-based search would call
  every frame of that file a crossing and every frame a click.
- **The landing point is scored on the loudest channel.** The click a cut makes
  is the largest step in any one channel, so that is what has to be small.

Measured, not asserted: a cut with both edges on a peak of the cycle steps by
1.9; snapped, by under a twentieth of that.

### The rest

| | where | note |
|---|---|---|
| Crop | `ops::crop` | tail cut first, or the head cut moves the end out from under it |
| Duplicate | `ops::duplicate` | Peak takes its copies from the clipboard; a selection is the same idea without a clipboard to keep in step |
| Insert silence | `ops::insert_silence` | ours only had *Silence*, which overwrites — there was no way to make a document longer |
| Normalize (RMS) | `ops::normalize_rms` | Peak soft-clips into the ceiling to hit a target; here the ceiling wins and the result comes out quieter, which is the honest half of the same bargain |
| Find peak | `analyse::find_peak` | a measurement, on its own route — an undo entry for something that changed nothing is worse than none |
| Strip silence | `analyse::SilenceScan` + `ops::strip_silence` | runs applied back to front |
| Repair click | `analyse::worst_spike` + `ops::repair_click` | excises rather than redraws — see below |
| Set selection, Fit selection, Zoom at sample level, Go to | `app.js` | pure view; no server involved |
| Markers→regions, region split, nudge, rename, delete | `server::annot` | notes about audio, not audio |

**A silent clip says what it *is*, not what its level happens to be.** Inserted
silence is `Clip { silent: true }`, not a gain of zero, because a gain is
something later operations are entitled to change — an absolute `set_gain`
across a selection holding a pause would otherwise start playing whatever was
at that source position. It also means a long pause costs no reads.

**Repair Click excises, it does not redraw.** Peak's repair interpolates across
the damaged samples; a clip list has no way to write a sample. So the damage is
removed and the two edges are ramped into the join over a fraction of a
millisecond — which is what makes the result *provably* free of a step rather
than merely smaller. The edges are snapped first, which is what keeps the taper
as short as it is.

**The click detector measures deviation from the neighbours, not the step
between them.** A single-sample spike has two steps, in and out, and the larger
is usually the one *leaving* it — a step detector names the first clean sample
*after* the anomaly. Measuring each sample against the midpoint of its
neighbours names the bad sample, and on a square digital click, whose middle is
flat, it names the leading edge.

**A gate on the instantaneous sample value calls a loud sine silent twice a
cycle.** Strip Silence judges level over a 5 ms window; the threshold only
means what it says once it does.

### Peak's own worked examples are the tests

Three markers "Foo 1", "Foo 2", "Foo 3" become **two** regions named after the
first two. `Event #000` starting at `10` gives `Event 010`, `Event 011`. Both
are straight out of the manual and both are asserted. Letters count
spreadsheet-fashion — A…Z, AA, AB — so a run longer than the alphabet never
repeats a name, and a split picks a name nothing else is using rather than
producing a second "Foo 2".

### Three bugs the browser found that the tests did not

1. **Measuring a stretched document was quadratic.** `render_fx` renders the
   whole timeline and slices when a stretch is active, so a block loop over it
   renders the file once per block. A thirty-second sound at 6× looked exactly
   like a hang. `measure_peak_fx` had it too, and had had it all along.
2. **A block boundary is not a click.** A windowed render resets the rack and
   gives it a fixed pre-roll, so two blocks rendered independently do not join
   continuously once anything in the rack has memory. The detector reported a
   click at every multiple of 65536 on audio that had none — 0.19 where the
   real worst was 0.02. Each block is now rendered with the frames before it
   included, and only the interior is judged.
3. **The snap radius has to be smaller than the excision half-width.** With the
   default 10 ms radius and a 1 ms repair window, both edges were pulled onto
   the *same* crossing, the window closed to nothing and Repair Click silently
   did nothing at all.

---

## 7d. Auditioning versus editing

Two things you can do to a sound, and for a long time they were the same thing.

**The library auditions the sound. The editor plays the document.** Clicking a
file in the browser is a question about the file — *what is this?* — and
answering it through whatever stretch, grain cloud and rack that file was last
left with answers a different question entirely. A one-shot playing back
thirty-six times longer than it is, eleven semitones down, because of something
set in a previous run, tells you nothing about the sound.

`live::Playing` is the distinction, `live::playback_list` is the whole of the
rule, and `/api/engine/load?raw=1` is how the interface asks for an audition.
**Absent means the document**, so nothing written before this asks for a bare
file by accident. The rack is held separately from the list and has to be
dropped on its own; the stretch and grain settings go with the list.

The engine remembers which kind it was given (`engine.raw`), because both go
through the same load: without it, pressing play in the editor would resume the
audition. Crossing between the two modes while something is playing stops it,
the same rule as choosing a different sound.

### What is playing is what is on the screen

Three things had to be true for that, and none of them were.

**The source is laid out for the device.** The streaming engines index their
input with the channel count they are *rendering* at, which is the device's. A
mono file on a stereo device was therefore read two samples at a time — twice
too fast, and out of material half way, heard as a fast playback that stops.
**The grain cloud was the only engine unaffected**, because it maps the
device's channel back to a source channel before it reads (`render.rs`, `sch`),
which is exactly why granular was the only engine that sounded right and the
report arrived as "granular is the only one that plays it back normally".

`engine::conform_channels` now runs in `live::load` beside the resampler, so
`Source.channels` is the device's from then on. It was hiding behind
`let (dev_rate, _dev_channels) = …` — the channel count was fetched and thrown
away. Widening copies a channel outward; narrowing averages, because dropping
the right half of a stereo file is a worse answer than mixing it.

**Parameters only reach the source they belong to.** `push_params` returns
early unless `live::holding` says the engine has that document. Opening a
second sound and moving a slider before playing it used to push the new
document's settings onto the old one's buffer — parameters saying one length
over samples of another. Nothing is lost by returning: a load reads the
document as it stands, so the settings arrive in full the moment the sound is
played.

**Every setting reaches the audio.** `merge_stretch` is that list, and
`vocoder` was missing from it — so the whole vocoder panel moved the exported
file and nothing you could hear until the file happened to be reloaded. The
same family as PVSOLA and the hybrid having no pitch stage. There is a test
that changes every field and checks none is still at its default.

The engine is still only loaded when something is played, because a load folds
the whole document and hands it over. So the engine can hold a different sound
from the one on screen — but only while nothing is playing, and pressing play
closes that window before any sound comes out.

**And a sound opens at its defaults.** It used to open with whatever was
restored from `SESSIONS.json`. Settings that arrive without being asked for are
indistinguishable from a bug, and they were being reported as one.

Sessions are still written. **Nothing reads them now** — worth knowing rather
than worth worrying about: it means no one's work was thrown away to make this
change, and the old behaviour is one line in `identity_for`. `App::restore` is
still there and still correct. **Presets are the deliberate way to put settings
back on a sound**, which is what they were built for.

---

## 7e. Export

**AIFF, beside the original, named for what was done to it, with the settings
inside.**

    aahh pvsola 2.50x -7.0st 60ms.aiff

The engine and the three settings that decide what you hear are in the name, so
a folder of exports is readable without opening any of it. Always all four,
even at their defaults: a name that omits what is inert cannot be predicted,
sorted or grepped. A name already taken gets ` 2`, ` 3` — exporting the same
settings twice is a normal thing to do and replacing the first would be the one
thing this program does not do.

**The file is its own preset.** `audio-core/src/aiff.rs` writes an `APPL` chunk
behind the signature `AuLb` holding the whole document's settings as
`stretch_to_json` gives them — every engine, every extended control, the grain
cloud and the rack — plus a `NAME` with the original file's name and an `ANNO`
line so anything else that opens it sees why it is the length it is. A `FORM`
is a list of chunks and a reader must skip what it does not know, which is what
makes this safe: our own probe already walks chunks and ignores the rest, and
macOS `afinfo` reads the result as a plain 24-bit AIFF.

16- and 24-bit are AIFF; 32-bit float is AIFC, which is the same file with a
`FVER` chunk and an `fl32` type.

Two things worth knowing about writing AIFF. **The rate is an 80-bit extended
float** whose leading mantissa bit is explicit, unlike an IEEE double — that is
the part that catches people out, so `encode_extended80` is pinned against both
the decoder in `probe.rs` and the literal bit pattern everyone else's 44.1 kHz
files have. And **byte order is the trap**: a file written little-endian behind
a big-endian header does not fail to open, it opens and is loud noise. `quantise`
takes the endianness rather than assuming it, and there is a round-trip test at
all three depths.

### Reading them back in — the pinned one

Not built, explicitly deferred, and the reason the format is what it is: a good
accident should be findable months later from the file alone, with no session
and nothing to keep in step. The pieces are all here — the settings are already
in every file written from today, `probe.rs` already walks the chunks it would
be found in, and `persist::stretch_from_json` already parses that exact shape
with every clamp applied. What is missing is the way in: most likely the file
browser noticing the chunk and offering it, which is where you would be when
you found the sound.

---

## 8. The visualisers

`visualiser/grain-views.html` — one p5.js WEBGL page served at `/grains3d`,
standalone or in an in-page pop-over with `?embed=1`. Ten views in two suites:

- **V1, the object** — Shear, Braid, Swarm, Shells, Lattice.
- **V2, the moment** — Tunnel, Mandala, Rorschach, Vortex, Ripple. Centred on
  now, time moves past a fixed camera, mirrored.

The JS port of `rand01` is a BigInt splitmix64 matching the Rust exactly — the
picture is drawn from the same grain schedule the renderer uses, which is the
point.

**Per view** (the *look*): speed, glow, orbit, trail, colour-by, mirrors,
palette. Ten views is ten different things to look at. Each has a **factory look
of its own**.

**Shared** (the *cloud*): ratio, window, density, overlap, the jitters.

**Look and saved slots → `localStorage`** (decisions outlive the window).
**Camera → `sessionStorage`** — an empty store *is* the signal that this is the
session's first look, which is what makes every view open zoomed in on the
playhead.

**The slots**: sixteen, as one ruled rectangle bottom-right, 8×2, inset 10 px so
the rounded border does not clip it. `×` if filled, name in the tooltip. Click
recalls, double-click stores, press-and-hold erases with the cell draining while
held. All three gestures come from pointer events with clicks counted by hand —
a `dblclick` listener still lets the first click through, so storing over a full
slot would briefly recall what you were replacing.

---

## 9. Tagging

Three systems, kept apart on purpose. Conflating them is what made the old tags
useless.

| | crate | says | colour |
|---|---|---|---|
| **Heard as** | `yamnet` | what it *is* — AudioSet's 521 nouns | blue |
| **Sounds like** | `search` | what it is *like* — calibrated texture words | green |
| **Your tags** | `search::learn` | what *you* call it — learned by example | amber |

**Thresholds, measured and different on purpose.** A label that applies itself
needs a stricter bar than a tag merely offered. `learn::NEAR` **0.95** for
anything auto-applied — propagation at 0.90 renamed a jazz piano loop "Tabla".
`learn::LEARN` **0.85** for proposals you click to accept. There is very little
daylight: five snares sit 0.85–0.91 of each other and the first *unrelated*
sound is at 0.838.

Three things checked rather than assumed:
- **The mel frontend is inside the ONNX graph**, so the silent-garbage hazard
  never applied. `models/yamnet.onnx`, 16 MB, loaded at runtime.
- **Downsampling must be band-limited.** `yamnet::resample` is a windowed sinc,
  with a test for the alias *and* a test asserting the naive method fails it.
- **A one-shot must be tiled before the model sees it.** A 100 ms hit is nine
  parts silence: `snare 3` → "Door". `present()` tiles anything shorter than a
  patch to ≥0.25 s.

Rules learned by breaking something: filename families may overwrite a faint
wrong answer, a sonic stranger may not; "Speech" is not a vague label in a
sample library (it means vocal); one trailing number is a take, not a name; user
tags never mix into the suggested field, or the system learns from itself.

`USER-TAGS.tsv` has **no version marker and is never invalidated — these are
decisions.**

---

## 10. Gotchas — each of these has cost time

1. **Rebuild the binary after any UI edit.** The single most frequent trap.
2. **`git add -A` is unsafe in this repo.** Large parts of `Audio Library/` are
   untracked and can appear between one command and the next. A blind `add -A`
   swept in 108 files and put ~300 MB of loose objects in `.git`. **Stage paths
   explicitly.**
3. **The automation browser lies about layout.** `document.hidden` is true, so
   `requestAnimationFrame` never fires and `setTimeout` is throttled to ~1 s;
   `innerWidth` and `clientWidth` intermittently read 0. **Take a screenshot
   first to force layout, then measure.** Never conclude a feature is broken
   from a backgrounded pane.
4. **Never gate data loading on `requestAnimationFrame`.** A non-painting tab
   never fires it; the spectrogram silently never loaded for this reason.
5. **`std::sync::Mutex` is not reentrant.** Calling `app.edits.snapshot()` from
   inside `app.edits.with()` deadlocks the request and every edit after it. Read
   from the session already in hand.
6. **Do not capture part of `state.rack` in a control's closure.** `pushRack`
   replaces `state.rack` wholesale, so a reference taken at build time is
   orphaned from the first push on. The maximiser switch was dead this way and
   *passed its own test*, because the test clicked it as the first action after
   a load. **Read through a getter.** Other panels have not been audited for
   this.
7. **A reader stricter than its writer is silent data loss.**
   `persist::stretch_from_json` clamped ratio at 4×, pitch at ±24 st and window
   at 200 ms while the edit route wrote 100×, ±48 st and 2000 ms. A preset saved
   at 20× was written to disk at 20× and read back at 4×, with nothing warned
   and the file still saying 20×. **Any time a value has two clamps, check they
   are the same pair.** Fixed 11 Aug 2026.
8. **A test with a non-strict inequality can pin a bug in place.**
   `sensitivity_opens_the_gate` asserted a looser detector found *no fewer*
   onsets — true of a control that does nothing — and the clamp test asserted
   the narrow bounds above. Both fixed.
9. **Assert amplitude, not just "it changed" and "it is finite".** Two level
   bugs survived full suites because nothing bounded the output.
10. **`empty` is already a class in `app.css`** carrying 40 px of padding.
11. **There were two copies of the tray layout in the stylesheet.** Grep before
    adding a layout rule; a duplicate that half-applies is worse than a conflict
    that fails loudly.
12. **`pagehide` writes state on unload**, so clearing storage and reloading
    does not give a clean slate.
13. **The shell's `grep` here is ugrep** and silently returns no matches for
    patterns that plainly exist, especially in `Reference Docs/md/`. Count with
    Python before concluding a document lacks something.
14. **Python patch scripts must assert every replacement.** `str.replace` fails
    silently. Twice this session an anchor did not exist and the edit vanished —
    once a whole block of tests that then reported "0 filtered out" rather than
    failing.
15. **A wall-clock maximum measures the scheduler, not the code.** The same
    sixteen-layer case measured 44%, 92% and 237% of the real-time budget across
    three runs while its mean never moved off 43%. Use a percentile, and assert
    the *shape* — worst against mean — rather than an absolute.
16. **An exception in a render loop looks like a data bug.** `slotSummary` threw
    on the first shaper added, which aborted `renderRack` partway; the slot
    appeared not to have been added at all, and the server had stored it
    correctly the whole time. Check the browser console before blaming the
    server.
17. **Anything extrapolated between polls has to know where it wraps.** The
    playhead carried its position forward on the wall clock, monotonically,
    while the engine looped. On a short loop it spent most of its time drawn
    outside the loop and snapping back, which reads as ghosts. Publish the
    resolved bound; do not recompute it.
18. **A frame counter is not a playhead.** It counts what has been produced,
    and the device holds a buffer before anything is heard. The offset is real
    — 13.6 ms here — and the backend will tell you if you ask.
19. **A mono file is not a stereo file with half the samples.** Anything that
    indexes a buffer by a channel count has to be told *whose* count it is. The
    streaming engines were handed the device's and read mono sources twice as
    fast; the grain cloud mapped the channel back first and was the only engine
    that sounded right, which is what the bug report was about. `Source` now
    always matches the device.
20. **The one setting that cannot test a control is its default.** The
    live-equals-export test ran at zero semitones and the pitch test ran only
    WSOLA, so two engines shipped with no pitch on the audio thread at all and
    both tests stayed green. Where a control has a wrapper, assert on an engine
    that does *not* have it.
21. **Two resamplers is two sounds.** The offline pitch shift interpolated with
    four-point Hermite and the streaming one with two-point linear. Both were
    right; neither matched. Anything computed on both paths has to be one
    function called twice, not two functions that agree in the comments.
22. **`f32` runs out of resolution long before a file does.** At a hundred
    thousand frames its steps are eight thousandths of a sample, which is
    enough to move an interpolation fraction. Positions along a timeline are
    `f64`, and derived from an index rather than accumulated.
23. **A windowed render is not a continuous one.** `render_fx` resets the rack
    and gives it a fixed pre-roll for each window, so two blocks rendered
    independently do not join smoothly once anything in the rack has memory.
    Anything looking for discontinuities has to render its own overlap; the
    click detector reported one at every multiple of the block size before it
    did.
24. **A control that reads the engine's state instead of the document's.** Play
    asked whether the engine had *anything* loaded — true exactly once, on the
    first play after launch — and resumed whatever it was holding for every
    press after that. Pick a second sound and the first one played under the
    new picture. Selecting deliberately does not load (loading folds the whole
    document and hands it over), so anything that starts the transport has to
    ask what is *selected*, not what is loaded. Found by ear, not by a test;
    the interface still has none.
25. **`render_fx` per block on a stretched document is quadratic.** It renders
    the whole timeline and slices, so a block loop renders the file once per
    block. Two separate places had this and both looked like a hang rather than
    a bug. Check `is_stretched()` and render once.
26. **Struct-update syntax cannot see private fields from another crate.** Tests
    in `tests/` are a separate crate, so `Thing { field: v, ..Default::default() }`
    fails on any struct with private state. Use the setter — which for anything
    implementing `Params` is the better test anyway, because it exercises the
    path automation will use.

---

## 11. Reference docs

Every PDF in `Reference Docs/` is extracted to markdown in `Reference Docs/md/`.
**Read those, not the PDFs.** Page markers `<!-- p.N -->` are kept. Start at
`Reference Docs/md/INDEX.md`.

- `md/tsm-algorithms-thesis-driedger.md` — the 104-page thesis behind
  `stretch.rs` and `grain.rs`. The one that matters.
- `md/STRETCH-ROADMAP.md` — the theories, which are implemented, what is next.
  **Fully built through candidate 6.**
- `md/peak/peak-menus.md` — Peak 6 Chapter 12, every menu and command. **199
  commands; 182 are not in ours**, but most of those are Peak's own furniture
  (Quit, Hide Others, sampler transfer, VST hosting, CD burning). Filtering to
  what fits leaves about twenty, which matches the user's *"we won't use all of
  it but some of it, 10%."* The DSP ones are built — see §7b. The edit and menu
  ones are Phase 3 and are next.
- `md/peak/peak-dsp.md` — **read this before implementing any of them.** Several
  are not what their names suggest: Rappify is dynamic filtering, Amplitude Fit
  is per-grain normalisation, Harmonic Rotate rotates the spectrum around a
  horizontal axis, Convolve multiplies two spectra.
- `md/peak/peak-editing.md`, `peak-dsp.md`, `peak-shortcuts-and-actions.md`.

Project docs: `docs/ARCHITECTURE.md` (as-built), `docs/CONTROLS.md` (every
gesture), `docs/MENUS.md` (every menu item).

---

## 12. What is open

**Nothing is waiting on a decision.** The granular layers question was answered
on 11 Aug 2026 — option two, compensate by √N in both paths from
`grain::layer_gain`. Kept here because the reasoning still governs the code:

| | 2 | 4 | 8 | 16 |
|---|---|---|---|---|
| Granular, jitter on, spread 0 | 0.71 | 0.52 | 0.37 | **0.25** |
| Granular, no jitter, spread 1 | 0.93 | 0.77 | 0.13 | **0.09** |
| Granular, no jitter, spread 0 | 1.00 | 1.00 | 1.00 | 1.00 |
| WSOLA / Vocoder / PVSOLA / Hybrid | 1.00 | 1.00 | 1.00 | 1.00 |

The grains really are being created — two separate things eat the level.
**Decorrelation**: the overlap-add divides by grain *count* while grains that do
not line up sum by its *square root*, so 16 jittered layers land at exactly
1/√16 and every doubling loses 3 dB. **The layer offset**: averaging
time-shifted copies of otherwise identical audio is a comb filter, which is why
the no-jitter case is worse than the jittered one.

The other engines hold level because `layered()` measures one layer's RMS and
scales the sum back to it. Granular's layering is older, lives inside
`granular()` and shares one normalisation across all layers.

**The fix is not free**, which is why it was asked rather than done: the
real-time renderer cannot measure RMS ahead of a block, so routing granular
through the same wrapper would fix the render and leave live playback quiet
while the exported file came out level — and live-equals-export is a hard rule
here. No fixed gain works for both cases: √N is exact when the layers are
decorrelated and 4× too loud when they are identical.

1. **Match the render, accept a live/export difference** on layers only, and say
   so in the interface.
2. **Compensate by √N in both paths.** Exact whenever jitter is on — which is
   when layers are worth using — identical live and offline, no measurement
   needed; too loud on the degenerate no-jitter case.
3. **Leave it** and treat layers as a texture control you re-balance by ear.

**Recommended: 2.** It is right for the case people actually use, the same in
both paths, and needs no measurement.

**Next, and explicitly asked for — "do phase 3", interrupted to write this
down:**

1. ~~**Phase 3, the Peak edits.**~~ **Done, 11 Aug 2026 — see §7c.** Snap,
   crop, duplicate, insert silence, set selection, fit selection, zoom at
   sample level, markers→regions, new region split, nudge, rename, go to,
   normalize RMS, find peak, strip silence, repair click. Everything on the
   list. What is *not* there: Peak's clipboard (cut/copy/paste between
   documents), Bars/Beats snap, Loop Surfer, and the Pencil Tool — the first
   three need a clipboard, a tempo and a loop model this program does not have
   yet, and the last needs a way to write a sample, which a clip list is not.
2. **Read an export's settings back in.** Deferred on purpose while the format
   was built — see §7e. Every file written from today already carries them.
3. **Pre/post rack split** — shapers before *or* after the stretcher. §7b says
   why the pre side has to be a handover rather than a per-block chain.
4. **Phase 2 spectral shapers** — harmonic rotate, convolve.
5. **Automation and modulation** on the parameter layer.
6. **The third view** — granulate.

**Earlier, and done — the streaming work the user chose:**

1. ~~Wire `WsolaStream` into the engine.~~ **Done.** WSOLA plays live.
2. ~~Streaming vocoder.~~ **Done.** Both stereo modes.
3. ~~Streaming PVSOLA.~~ **Done.**
4. **Streaming hybrid** — bounded lookahead (~93 ms at defaults); replace the
   whole-file normalisation floor with a fixed one.

**Not started:**

- The Windows binary has never been *run* on Windows.
- Menus are populated from what the app exposes, not from Peak Chapter 12.
- The **3D sonic space** view. `/api/sounds` and `/api/space` already serve
  everything it needs.

**Thin coverage, honestly:**

- `server/src/live.rs` — the audio-thread bridge. Hard to test without a device.
- **The interface.** No automated tests at all; only ever checked by driving the
  browser, which lies (see §10.3).

**Lower value, still open:**

- The label pass is synchronous — fine for 66 files, not for a real library.
- `classify.rs:494` duration-veto bug.
- Other panels have not been audited for the captured-reference bug (§10.6).

---

## 13. Recent history

    5f874c6  Snap edits to zero crossings, and do the rest of Peak's edits
    4cb7260  Write down the whole state, including the Peak work
    4cda809  Draw every shaper from its own description
    d260c74  Wire the shapers into the rack, generically
    95e843a  Add parameter API and live shape effects
    05879fb  Bring the docs up to live layering
    d520e3e  Layer the streaming engines live, so you can hear them
    3b65f58  Scatter the layers, so they make a cloud instead of a comb
    e77d979  Stream the hybrid — all five engines run in the callback now
    3fe4cea  Cross-fade between engines, so switching one does not click
    6a52cdf  Stream PVSOLA, and spread its work across the blocks it plays for
    e492768  Stream the phase vocoder, and delete the copy of it
    f1e8ac3  Let the engine picker change what you hear, not just what you export
    3b4d361  Put back the level granular layering takes away
    0756f51  Write down the three options on granular layers
    d08064c  Write the whole project state down in one file
    15b86dc  Make WSOLA a streaming engine, and have the offline render drive it
    eebe611  Pin the whole routing table, and add a preset manager
    90e07bb  Show the underlying engines' controls on the two new panels
    5de2f48  Finish the stretch roadmap: PVSOLA and a hybrid engine
    da0cd6e  Stop tracking the built programs, and run whichever is newer
    d990eb3  Serve p5 and the fonts from the binary, so the views work offline
