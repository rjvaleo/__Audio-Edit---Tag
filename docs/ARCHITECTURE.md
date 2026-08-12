# Architecture — as built

What exists, as of 11 August 2026. 785 tests passing.

The original design brief is
[`Waveform display interface/uploads/AudioLab-ARCHITECTURE.md`](../Waveform%20display%20interface/uploads/AudioLab-ARCHITECTURE.md) —
a forward-looking specification written before the build. It is kept as
history. **This document is the current one**; where the two disagree, this one
is right.

---

## The shape

One native binary. It serves a local HTTP interface on `127.0.0.1:8737`, owns
the audio device directly, and reads a folder of audio it never writes to.

    browser  ──HTTP──▶  audiolab  ──cpal──▶  sound card
       ▲                   │
       │                   ├──▶ Audio Library/   (read only, always)
       └── UI embedded ────┤
           in the binary   └──▶ data/            (everything it remembers)

There is no `<audio>` element and no browser playback. The engine owns the
device; the interface posts transport commands and polls one endpoint for
position, grains and spectrum together, because all three describe the same
instant and fetching them separately would let them disagree.

## The workspace

Ten crates, ~36k lines. Dependencies point one way only — `audio-core` depends
on nothing, `server` depends on everything.

| Crate | Lines | Tests | Responsibility |
|---|---:|---:|---|
| `audio-core` | 2928 | 86 | Container probe and decode, **AIFF writer**, peak tiles, FFT, spectrogram, statistics, WAV writer |
| `catalog` | 1103 | 26 | The classification taxonomy — categories, machines, instruments, confidence |
| `indexer` | 785 | 20 | Library walk, classify, write the TSV index |
| `fx` | 12582 | 237 | Biquads, EQ, compressor, channel maximiser, five stretchers, **nine live shapers**, the parameter layer, sines/transients/noise separation |
| `edit` | 3429 | 112 | Non-destructive edit list, **zero-crossing snap**, **measurement**, windowed render, WAV and AIFF export |
| `engine` | 3243 | 44 | Block renderer, **all five streaming engines**, transport, cpal device |
| `search` | 1059 | 20 | Acoustic fingerprints, similarity ranking, learned tags |
| `yamnet` | 1395 | 51 | ONNX inference, band-limited resampling, label policy |
| `server` | 9395 | 189 | HTTP/1.1, 37 API routes, JSON, persistence, **marker and region commands** |
| `audiolab` | 58 | — | The binary |

### Dependencies

Two direct crates; 136 in the tree once theirs are counted.

- **`cpal` 0.18** — the audio device. Chosen over WASM/AudioWorklet because
  performing with this is a goal and only native gives device choice and a
  latency dial.
- **`tract-onnx` 0.23** — YAMNet inference. Chosen over onnxruntime because it
  is pure Rust, and onnxruntime would have needed a native library built per
  target.

The project began with a zero-dependency rule. It was lifted deliberately, and
what it was protecting survives: both crates are pure Rust, so the Windows
cross-build is still one command with nothing installed but the mingw linker.
**That is the test for a third dependency** — not "is it a dependency" but
"does it break the cross-build".

Written here rather than pulled in: the HTTP server on `std::net`, the JSON
parser, the FFT, every filter and stretcher, the TSV store.

---

## Format I/O

`probe()` identifies a container by walking chunks — seeking, never assuming a
layout, because real files put `LIST`, `bext` and `JUNK` ahead of the ones that
matter. It handles RIFF/WAVE and FORM/AIFF/AIFC, PCM at 8/16/24/32 bit and
float at 32/64, little and big endian.

**Writing** is WAV (little-endian) and AIFF/AIFC (big-endian). `aiff.rs` puts
the sample rate in the 80-bit extended float the format wants — whose leading
mantissa bit is explicit, unlike an IEEE double — and writes `NAME`, `ANNO` and
an `APPL` chunk holding the settings that produced the sound. Byte order is the
trap and does not fail loudly: a file written little-endian behind a big-endian
header opens fine and is noise, so the quantiser takes the endianness rather
than assuming it, and the round trip is tested at every depth.

**Anything unrecognised becomes headerless PCM** rather than an error. That is
deliberate — SD2 data forks and raw dumps are real sounds with no header — and
it is why a peak cache or a text sidecar will play as noise, and why the
browser has a *Play all files* switch to decide whether they are listed at all.
A skip list keeps known non-audio extensions from being probed in the first
place.

Chunk sizes are clamped to the file rather than trusted: writers that stream
sometimes leave the final size at zero or `0xFFFFFFFF`, and believing it means
reading past the end. Data lengths are always a whole number of frames, so the
frame count and the byte count cannot disagree about where the audio ends.

## The edit model

A document is an **edit list**: clips referencing ranges of the source, plus a
stretch spec and an effect rack. Cutting an hour costs two integers. The source
file is never written; export renders to a new file and is the only thing in
the app that writes audio.

Edit operations address the **pre-stretch** timeline, so cutting a second
removes a second of source whatever the ratio is doing to the output.

**Where an edit lands is a separate question from what it does.** `edit::snap`
resolves a requested position to the nearest zero crossing or a fixed grid, and
moves the *request* — nothing in it reads or rewrites a clip list, which is what
keeps it out of the render path. Absent means no snap, so a caller that has
never heard of it gets exactly the position it asked for; the interface turns it
on, as Peak does. Crossings are looked for per channel rather than in the mono
mix: two channels in opposite phase sum to nothing at all, and a mix-based
search would call every frame of that file a crossing.

**`edit::analyse` measures the edited timeline** — peak, RMS, runs of silence,
the worst discontinuity — so the operations in `ops.rs` stay pure arithmetic on
the clip list and take their numbers as arguments. It measures what will be
*heard*: stretch, fades, gains and effects included.

`output_frames()` must equal what `process()` actually produces, because the
timeline is laid out from the prediction before any audio is rendered. A
windowed render must match the full render: filters get 200 ms of pre-roll, and
stretch renders whole because WSOLA picks each splice from the previous one.

**A sound opens at its defaults.** Sessions are written and are not applied on
open: settings arriving without being asked for are indistinguishable from a
bug, and were reported as one. The validation that refuses a saved session whose
file has changed — frames, channels or sample rate — is still there and still
tested, because presets go through the same reader; it is simply no longer on
the path a file takes when you open it. Work done in the current run is
unaffected: a session is created once per file per process.

**A reader must never be stricter than its writer.** `stretch_from_json` clamped
the ratio at 4×, the pitch at two octaves and the window at 200 ms — the bounds
from before the granular engine widened them — while the edit route wrote
100×, four octaves and two seconds. So a preset saved at 20× was written to disk
at 20× and read back at 4×, with nothing rejected and nothing warned, and the
file on disk still saying 20×. It looked like the interface losing the value
rather than the loader. Everything saved went through it. If those bounds ever
need to differ again, the *writer* is the place to change.

## DSP

`fx` holds RBJ biquads, a three-band parametric EQ with high-pass, a
feed-forward compressor with a soft knee, a one-knob channel maximiser, five
time stretchers, and nine live shapers.

The stretchers all answer the same controls — density, overlap, layers, the
jitters, drift, scan, envelope, pan — each in its own terms, because every one
of them lays something down repeatedly and so has a rate, a length, a place it
reads from and a speed it reads at. A window is a splice for WSOLA and an
analysis frame for the vocoder. Each keeps a small *extended* set that reaches
the constants it was tuned around; those exist to break it on purpose.

Three are primitives and two are built out of them:

| Engine | What it is |
|---|---|
| WSOLA | Splice search in the time domain. `stretch.rs` |
| Phase vocoder | STFT, identity phase locking. `vocoder.rs` |
| Granular | Deterministic grain cloud. `grain.rs` |
| PVSOLA | The vocoder, re-anchored to the waveform by a WSOLA splice every few frames. `pvsola.rs` |
| Hybrid | Separate, stretch each part its own way, sum. `hybrid.rs`, on `decompose.rs` and `noise.rs` |

Because the last two *run* the first three, the first three's parameters reach
them and their panels show them — PVSOLA carries the vocoder's whole extended
set, the hybrid carries the vocoder's and WSOLA's both. A control that reaches
the audio with no control on the panel is the same defect as one that does
nothing, so there is a test asserting the correspondence in both directions:
everything a panel shows moves the audio, and what PVSOLA does not show (WSOLA's
splice group, since it finds its splice with its own search) provably does not.

**The separation is what makes the hybrid possible.** `decompose.rs` median
filters the magnitude spectrogram along time and along frequency: a held
partial is a horizontal ridge and survives the first, an attack is a vertical
ridge and survives the second. Driedger's HPR-M then assigns a bin to the
harmonic part only if the horizontal estimate beats the vertical by a clear
margin, to the percussive part only if the reverse, and to a *residual* if
neither wins. The margin is the whole point — without it there is no third
part, and the residual is exactly the material that is neither tone nor hit.
The three masks partition, so the parts sum back to the input bin for bin.

**`noise.rs` does not stretch the residual at all.** Repeating noise is audible
as a ring at the hop rate no matter what the window does, so instead the
residual's spectral envelope is measured, interpolated along the new timeline,
and imposed on freshly generated noise. Nothing is reused, so nothing can
repeat. The phases come from the same addressed splitmix the grain cloud uses,
so three separate renders still agree.

**PVSOLA answers phasiness rather than trading it away.** A vocoder's phase
error is cumulative; re-anchoring every few frames means it never has time to
accumulate. Two things about the implementation are load-bearing and were both
found by measurement rather than by reading: the splice must not be cut from
the vocoder's overlap-add ramp-up, and the cross-fade must be *linear* rather
than equal-power, because the search has just spent its whole effort making the
two sides correlated. The discarded run-up is measured in output frames, not
input frames — measuring it in input frames makes the cost grow with the square
of the ratio.

Built from the papers in `Reference Docs/`, chiefly Driedger's *Time-Scale
Modification Algorithms for Music Audio*. The vocoder's phase propagation is
equations 5.10–5.12 and the code is laid out to be read against them. The
separation is Fitzgerald and Driedger, PVSOLA is Moinet and Dutoit (DAFx-12),
the noise morphing is Moliner, Lehtonen and Välimäki (2023).

**All five run in the audio callback.** Each is a `Streamer` keeping its state
between blocks, overlap-adding into a ring long enough for the widest window
any control allows, and allocating nothing — proved by a counting global
allocator across two hundred blocks with the controls moving on every one.

**The offline renderers are loops over the same streamers.** Live-equals-export
is a property of there being one implementation rather than two kept in step,
and it is asserted at 1e-6. When the vocoder had two they matched to about
−80 dB: close enough to hear nothing, far enough that the guarantee was a claim.

Anything expensive is built off the audio thread and handed over by ownership —
the transient map, the hybrid's separated source, the bank of extra layers for
the layer control. Until the hybrid's separation arrives the callback plays the
grain cloud rather than silence.

**A block must be made faster than it plays**, and that is invisible in every
other test: a streamer that is correct and slow passes all of them and drops
out the moment you press play. What matters is the worst block, not the mean.
Measured: granular 0.2%, WSOLA 7.5%, vocoder 12%, PVSOLA 18%, hybrid 17% of the
real-time budget; with sixteen vocoder layers, 44%. PVSOLA makes a whole vocoder
run per anchor, which in one callback measured at 89%, so it is made a slice at
a time across the blocks the previous round plays for.

**Pitch is its own stage.** `PitchRing` drives the inner engine at ratio × pitch
and resamples the result, with the same four-point Hermite the offline renderer
uses — one curve, because two would be two different sounds. PVSOLA and the
hybrid cannot be `Streamer`s (one takes parameters of its own, the other reads a
separated source), so they drive the ring directly rather than going without.

**Switching engines cross-fades.** Switching outright put a step of 0.63 into a
waveform whose neighbouring samples were moving by 0.0003. The outgoing engine
keeps running for about twenty milliseconds and the two are mixed equal-power —
two engines rendering the same instant agree about what is there and not at all
about its phase.

**Grain randomness is addressed, not streamed.** Every grain's jitter is a pure
function of its index and a seed. The waveform, the playback and the exported
file are three separate renders, and a running generator would give each of
them different audio — the picture would stop matching the sound. The offline
renderer, the real-time renderer and the visualiser all enumerate grains
through one function for the same reason.

### The live shapers

Nine effects that run under the fingers rather than being applied and waited
for: invert, swap channels, width, DC offset, ring modulator, rappify, reverse
boomerang, amplitude fit and gate. Built from the reference documents rather
than from the names — **rappify** is extreme dynamic filtering, not distortion,
and **amplitude fit** is per-grain normalisation, not compression.

Two are better live than they were offline. *Boomerang* offline needs to know
where the selection ends; live it is a rolling buffer read backwards, so the
reversal chases the playhead and the throw length becomes a control it never
had. *Amplitude fit* offline normalises a file grain by grain; live it is the
same idea on the last thirty milliseconds with the waiting removed.

**One rack slot variant serves all nine.** The older three effects each carry a
settings struct and hand-written JSON; a shaper describes its own parameters
instead, so one pair of conversions serves all of them and the next one added
needs no rack work at all. An unknown kind is dropped rather than guessed at —
a slot this version does not recognise is one from a newer version.

### The parameter layer

`fx::params` gives every parameter a stable key, a range, a default, a sweep
and a unit, readable and writable by name. Automation and modulation then become
one small thing that writes keys rather than a change to every effect. It went
in first because it is the expensive thing to retrofit; nothing is built on it
yet.

**The key is the contract.** It will live in saved automation, so renaming one
silently detaches whatever drives it.

## Real time

Three layers, deliberately separable:

- **`render`** — blocks, no device. Grains become voices; a grain that outlives
  its block stays active into the next. The voice pool is a fixed array, so
  running out drops the newest grain rather than allocating in a callback.
- **`transport`** — play, seek, loop, live parameters. The callback minus the
  sound card, so it is testable frame by frame.
- **`device`** — cpal, deliberately thin.

Two rules the engine learned the hard way and which must not be undone: **the
engine stops itself** at the length its own schedule implies, because a grain
stream is happy to run forever reading the clamped last sample; and **a loop
end of zero means the whole document**, with the engine substituting its own
length rather than the interface computing it.

The callback publishes two things anything drawing a playhead needs: **the loop
it actually resolved**, because only it knows what a zero end means under the
current ratio, and **the output latency the backend reports**, because the
position counter counts frames produced and the device holds a buffer of them
before any are heard.

**The source is conformed to the device before the audio thread sees it.** The
streaming engines index their input with the count they are rendering at, so a
mono file on a stereo device was read two samples at a time — twice too fast,
and out of material half way. The grain cloud maps the device's channel back to
a source channel first, which is why it was the only engine unaffected.

`server/src/live.rs` bridges a document to the engine. Structure — cuts, fades,
reverse — is folded into the engine's source offline. Stretch, pitch, every
grain control and the whole rack are live.

It also decides **what** is played: `Playing::Raw` for an audition from the
library, which is the file itself with no edits, stretch, grains or rack, and
`Playing::Document` for the editor. Parameters are only pushed at the audio
thread while it is holding that document — otherwise one document's settings
land on another's buffer, which is heard as a sound playing at the wrong speed
and stopping early.

## Machine listening

`yamnet` runs the AudioSet classifier through tract. The mel frontend is inside
the ONNX graph, so there is no separate feature extractor to get wrong.

Audio is resampled to 16 kHz with a windowed-sinc filter rather than by
dropping samples — naive decimation aliases, and there is a test that proves
the naive version fails the same check. Short one-shots are tiled up to the
model's window, because a snare that is shorter than the patch is otherwise
classified on mostly silence.

Labels propagate within a family of related filenames, and a sonically similar
stranger may only contribute when nothing specific was heard in the file
itself.

## The server

Hand-rolled HTTP/1.1 on `std::net`. Every path from the interface is resolved
inside the library with `resolve_within`, which rejects absolute paths, parent
components and Windows prefixes before touching the filesystem, then
canonicalises both sides so a symlink pointing outside is caught too.

Thirty-seven API endpoints, in groups: library (`/api/folders`,
`/api/files`, `/api/scan`), display (`/api/peaks`, `/api/spectrogram`,
`/api/thumbs`), document (`/api/edit`, `/api/measure`, `/api/rack`, `/api/fx`,
`/api/export`), annotations (`/api/markers`, `/api/annot`), engine
(`/api/engine/load`, `/api/engine/transport`, `/api/engine/grains`), knowledge
(`/api/similar`, `/api/labels`, `/api/usertags`), plus `/audio` for rendered
playback and `/grains3d` for the visualiser.

`/api/fx` serves the shaper catalogue and the interface draws every module from
it, so an effect gains a control by declaring one in `fx::shape` and neither the
rack nor the interface is touched.

Absent means unchanged. A control that posts one field does not reset the
twenty it did not mention.

Presets have four routes rather than two, because capturing and editing want
opposite things: `/api/presets` captures whatever a file currently has and
needs that file, while `/api/presets/update` and `/api/presets/duplicate` write
values given outright and work with nothing open at all — which is what the
preset manager needs, since there the preset is the thing being edited and not
the sound. All of them read through the same `stretch_from_json`, so the
manager cannot store a value the engines would refuse.

## What the app remembers

Everything in `data/`, beside the launcher — deliberately not under
`core/target`, which `cargo clean` would take with it.

| File | Holds |
|---|---|
| `config.json` | The chosen library path |
| `AUDIO-INDEX.tsv` | The scan: one row per file, with its classification |
| `FINGERPRINTS.tsv` | Acoustic fingerprints for similarity search |
| `LABELS.tsv` | What YAMNet heard |
| `USER-TAGS.tsv` | Tags you added by hand |
| `TAG-OVERRIDES.json` | Corrections to what was inferred |
| `SESSIONS.json` | Open documents and their edits |
| `PRESETS.json` | Named stretch and rack settings, every engine's at once |
| `exports/` | Legacy. Exports now go **beside the original**, in the library, as AIFF — see the README |

TSV rather than a database: the format is proven at 75,000 rows, it is
append-only which is what makes a scan resumable, and you can open it in a
spreadsheet. A database would add a C dependency and break the single
cross-compiled binary.

## The interface

Plain HTML, CSS and JavaScript. No bundler, no framework, no build step. `ui/index.html`, `ui/app.css`, `ui/app.js` and
`visualiser/grain-views.html` are embedded into the binary with `include_str!`
— **which means the binary must be rebuilt after any interface edit**.

Controls follow one table: name, control, reading, in three columns whose
widths are declared once. Four kinds — slider, knob, rocker switch, three-way
choice — sharing one contract, so they are interchangeable at the call site.
See [CONTROLS.md](CONTROLS.md) and [MENUS.md](MENUS.md).

The visualiser is p5.js in WEBGL — the one place a library is loaded. It is
served from the binary rather than from a CDN, as are the two fonts, so the app
reaches the internet at no point at all.

---

## Where the original brief stands

| Planned | Now |
|---|---|
| Format I/O, edit engine, DSP, navigator | Built |
| Time-stretch as the headline feature | Built, five engines rather than one, all five live |
| Real-time contract | Built — native output, not WASM |
| Peak's DSP menu | Built as nine live rack effects rather than apply-and-wait |
| Peak's edit and Action menus | Built — snap, crop, duplicate, insert silence, normalize RMS, find peak, strip silence, repair click, markers and regions |
| ML tagging and semantic search | Built — YAMNet, fingerprints, learned tags |
| Sound Designer II rescue | Partial — SD2 data forks read as headerless PCM |
| UCS as the metadata spine | Not adopted; the taxonomy in `catalog` is used instead |
| Destructive mode | Not built, and no longer wanted |
| Plugins | Not built |
| Automation | Not built — but `fx::params` is the layer it needs, and every effect implements it |
| Multi-file / timeline | Not built; the app is single-document by design |
