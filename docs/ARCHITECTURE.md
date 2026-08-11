# Architecture — as built

What exists, as of 11 August 2026. 585 tests passing.

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

Ten crates, ~25k lines. Dependencies point one way only — `audio-core` depends
on nothing, `server` depends on everything.

| Crate | Lines | Tests | Responsibility |
|---|---:|---:|---|
| `audio-core` | 2588 | 78 | Container probe and decode, peak tiles, FFT, spectrogram, statistics, WAV writer |
| `catalog` | 1103 | 26 | The classification taxonomy — categories, machines, instruments, confidence |
| `indexer` | 755 | 20 | Library walk, classify, write the TSV index |
| `fx` | 7843 | 190 | Biquads, EQ, compressor, channel maximiser, five stretchers, sines/transients/noise separation |
| `edit` | 1663 | 54 | Non-destructive edit list, windowed render, export |
| `engine` | 1538 | 22 | Block renderer, transport, cpal device |
| `search` | 1059 | 20 | Acoustic fingerprints, similarity ranking, learned tags |
| `yamnet` | 1395 | 51 | ONNX inference, band-limited resampling, label policy |
| `server` | 7017 | 124 | HTTP/1.1, routes, JSON, persistence, sessions |
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

`output_frames()` must equal what `process()` actually produces, because the
timeline is laid out from the prediction before any audio is rendered. A
windowed render must match the full render: filters get 200 ms of pre-roll, and
stretch renders whole because WSOLA picks each splice from the previous one.

A saved session is refused if the file has changed — frames, channels or sample
rate — because stale offsets pointing at the wrong audio is worse than losing
the edit.

## DSP

`fx` holds RBJ biquads, a three-band parametric EQ with high-pass, a
feed-forward compressor with a soft knee, a one-knob channel maximiser, and
five time stretchers.

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

**Only the grain cloud runs in the audio callback.** The other four are offline
renders folded into the engine's source before playback starts, and the two new
ones are further from a callback than any of the others — the hybrid makes two
full spectrogram passes over the file before it stretches anything. Measured on
five seconds of stereo at 16×: vocoder 1.7 s, PVSOLA 4.6 s, hybrid 4.4 s.

**Grain randomness is addressed, not streamed.** Every grain's jitter is a pure
function of its index and a seed. The waveform, the playback and the exported
file are three separate renders, and a running generator would give each of
them different audio — the picture would stop matching the sound. The offline
renderer, the real-time renderer and the visualiser all enumerate grains
through one function for the same reason.

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

`server/src/live.rs` bridges a document to the engine. Structure — cuts, fades,
reverse — is folded into the engine's source offline. Stretch, pitch, every
grain control and the whole rack are live.

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

Roughly thirty endpoints, in groups: library (`/api/folders`, `/api/files`,
`/api/scan`), display (`/api/peaks`, `/api/spectrogram`, `/api/thumbs`),
document (`/api/edit`, `/api/rack`, `/api/export`), engine
(`/api/engine/transport`, `/api/engine/grains`), knowledge (`/api/similar`,
`/api/labels`, `/api/usertags`), plus `/audio` for rendered playback and
`/grains3d` for the visualiser.

Absent means unchanged. A control that posts one field does not reset the
twenty it did not mention.

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
| `PRESETS.json` | Named stretch and rack settings |
| `exports/` | Rendered files |

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
| Time-stretch as the headline feature | Built, five engines rather than one |
| Real-time contract | Built — native output, not WASM |
| ML tagging and semantic search | Built — YAMNet, fingerprints, learned tags |
| Sound Designer II rescue | Partial — SD2 data forks read as headerless PCM |
| UCS as the metadata spine | Not adopted; the taxonomy in `catalog` is used instead |
| Destructive mode | Not built, and no longer wanted |
| Plugins | Not built |
| Automation | Not built |
| Multi-file / timeline | Not built; the app is single-document by design |
