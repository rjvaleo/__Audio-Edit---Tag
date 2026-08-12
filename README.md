# Audio Edit & Tag

[![Rust](https://img.shields.io/badge/Rust-1.97-000000?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Edition](https://img.shields.io/badge/edition-2021-000000?logo=rust&logoColor=white)](https://doc.rust-lang.org/edition-guide/)
[![Tests](https://img.shields.io/badge/tests-785%20passing-2ea44f)](#building-from-source)
[![Crates](https://img.shields.io/badge/workspace-10%20crates-dea584?logo=rust&logoColor=white)](#the-stack)
[![Dependencies](https://img.shields.io/badge/direct%20deps-2-4c9a2a)](#the-stack)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple&logoColor=white)](#start-here)
[![Windows](https://img.shields.io/badge/Windows-x86__64%20cross--built-0078D6?logo=windows&logoColor=white)](#building-from-source)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](#licence)
[![Docs](https://img.shields.io/badge/docs-architecture%20%C2%B7%20controls%20%C2%B7%20menus-informational)](docs/)

Browse, audition, tag, edit and mangle a large audio library without moving or
renaming a single audio file. Tags and edits are sidecar data; **the original
audio is never written to**. Rendering happens only when you explicitly export.

## Start here

| | |
|---|---|
| **macOS** | double-click **`Start.command`** |
| **Windows** | double-click **`StartHere.bat`** |

Either one starts a small local server and opens your browser at
`http://127.0.0.1:8737/`. Nothing else needs installing — no Python, no runtime,
no Node. Close the window or press Ctrl-C to stop it.

On the first run it opens on the bundled `Audio Library` folder. After that it
remembers whichever library you pick, and you can change it any time from the
Library tab.

## The stack

Everything below the interface is Rust, in one workspace that builds to one
binary. The interface is plain HTML, CSS and JavaScript with no build step and
no bundler, embedded into that binary at compile time.

It reaches the internet at no point. p5.js and both fonts are served from the
binary rather than from a CDN, so the grain visualiser works offline like
everything else does.

<table>
<tr><th align="left">Layer</th><th align="left">Built with</th></tr>
<tr><td>Core</td><td>

![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![Cargo](https://img.shields.io/badge/Cargo-000000?logo=rust&logoColor=white)

</td></tr>
<tr><td>Audio out</td><td>

![cpal](https://img.shields.io/badge/cpal-0.18-dea584)
![CoreAudio](https://img.shields.io/badge/CoreAudio-000000?logo=apple&logoColor=white)
![WASAPI](https://img.shields.io/badge/WASAPI-0078D6?logo=windows&logoColor=white)

</td></tr>
<tr><td>Machine listening</td><td>

![tract](https://img.shields.io/badge/tract--onnx-0.23-dea584)
![ONNX](https://img.shields.io/badge/ONNX-005CED?logo=onnx&logoColor=white)
![YAMNet](https://img.shields.io/badge/YAMNet-521%20classes-ff6f00?logo=tensorflow&logoColor=white)

</td></tr>
<tr><td>Interface</td><td>

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Canvas](https://img.shields.io/badge/Canvas%202D-333)
![No build step](https://img.shields.io/badge/build%20step-none-2ea44f)
![No bundler](https://img.shields.io/badge/bundler-none-2ea44f)

</td></tr>
<tr><td>Visualisers</td><td>

![p5.js](https://img.shields.io/badge/p5.js-1.7%20vendored-ED225D?logo=p5dotjs&logoColor=white)
![Offline](https://img.shields.io/badge/network%20calls-none-2ea44f)
![WebGL](https://img.shields.io/badge/WebGL-990000?logo=webgl&logoColor=white)

</td></tr>
<tr><td>Storage</td><td>

![TSV](https://img.shields.io/badge/TSV-flat%20files-6aa84f)
![JSON](https://img.shields.io/badge/JSON-hand--rolled-000000?logo=json&logoColor=white)

</td></tr>
</table>

**Two external crates, on purpose.** `cpal` for the audio device and
`tract-onnx` for the classifier — 136 crates in the tree once their own
dependencies are counted. Everything else is written here: the HTTP/1.1 server
on `std::net`, the JSON parser, the FFT, every filter and stretcher, the TSV
store. Both dependencies are pure Rust, which is what keeps the Windows
cross-build a single command with nothing but a linker installed.

### The workspace

| Crate | Lines | Tests | What it is |
|---|---:|---:|---|
| `audio-core` | 2588 | 78 | Container probe and decode (WAV, AIFF, AIFC, headerless PCM), peak tiles, FFT, spectrogram, statistics, WAV writer |
| `catalog` | 1103 | 26 | The classification taxonomy — categories, machines, instruments, confidence |
| `indexer` | 785 | 20 | Library walk, classify, write the TSV index |
| `fx` | 12294 | 237 | RBJ biquads, parametric EQ, compressor, channel maximiser, the five stretchers, and the sines/transients/noise separation |
| `edit` | 1663 | 54 | Non-destructive edit list, windowed render, export |
| `engine` | 2773 | 33 | Real-time block renderer, transport, cpal device |
| `search` | 1059 | 20 | Acoustic fingerprints, similarity ranking, learned tags |
| `yamnet` | 1395 | 51 | ONNX inference, band-limited resampling, label policy |
| `server` | 7737 | 134 | HTTP/1.1 on `std::net`, routes, JSON, persistence, sessions |
| `audiolab` | 58 | — | The binary |

### Five time stretchers

All five answer the same set of controls — density, overlap, layers, the
jitters, drift, scan, envelope, pan — each in its own terms, because every one
of them lays something down repeatedly and so has a rate, a length, a place it
reads from and a speed it reads at.

| | Domain | Good at | Bad at |
|---|---|---|---|
| **WSOLA** | Time | Transients, percussion, one-shots | Dense polyphony smears |
| **Phase vocoder** | Frequency | Chords, sustained tone, pads | Transients smear, noise goes watery |
| **PVSOLA** | Both | Sustained pitched material, long ratios | Small splice artefacts; ~2.5× the vocoder's cost |
| **Hybrid** | Both | Anything mixed, and any ratio at all | The slow one — roughly 5× the vocoder |
| **Granular** | Time | Extreme ratios, texture | Not trying to be transparent |

The last two are built out of the first three rather than beside them.
**PVSOLA** runs the vocoder for a handful of frames at a time and then stops
trusting the propagated phase, re-anchoring to the waveform with a WSOLA
splice — so the drift that makes a long vocoder stretch sound hollow never gets
time to accumulate. Measured on a sawtooth, it holds the waveform closer to the
source than the vocoder does, and by more the longer the stretch runs.

**Hybrid** separates the sound into steady partials, attacks and everything
else, and gives each the method that suits it: the vocoder for the partials,
WSOLA for the attacks, and for the residual, *noise morphing* — the spectral
envelope of the original noise imposed on freshly generated noise, so a
one-second breath becomes ten seconds of breath rather than ten copies of one.
It is the only engine here that will not repeat itself at long ratios, and the
only one with a level for each of the three parts, so a sound's air can be
turned down without touching its tone.

Each also has an *extended* set that reaches the constants the algorithm was
tuned around — and because the last two run the first three, they carry those
engines' extended sets as well: PVSOLA the vocoder's, Hybrid the vocoder's and
WSOLA's both — the similarity search radius, spectral magnitude freeze and blur,
how far to believe the measured frequency, the window shape. They are there to
break it on purpose.

Built from the papers in `Reference Docs/`, chiefly Driedger's
*Time-Scale Modification Algorithms for Music Audio* — the phase propagation
follows equations 5.10 to 5.12 and the code is laid out to be read against it.
The separation is Fitzgerald's median filtering with Driedger's HPR-M masks;
PVSOLA is Moinet and Dutoit (DAFx-12); the noise morphing is Moliner, Lehtonen
and Välimäki (2023).

## Documentation

| | |
|---|---|
| [`docs/STATE.md`](docs/STATE.md) | **Start here if you are picking this up.** The whole project state in one file — how it works, what is decided, what is open, and every trap that has cost time |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How it is built, as built — the crates, the edit model, the DSP, the real-time layers, the server, what it stores |
| [`docs/CONTROLS.md`](docs/CONTROLS.md) | Every control: click, drag, alt-drag, double-click, right-click, press-and-hold, wheel, keyboard |
| [`docs/MENUS.md`](docs/MENUS.md) | Every menu item, what it needs to be available, and what it does |
| [`visualiser/PRECOMPUTED-WEATHER.md`](visualiser/PRECOMPUTED-WEATHER.md) | The aesthetic argument behind the ten grain views |
| [`Reference Docs/md/STRETCH-ROADMAP.md`](Reference%20Docs/md/STRETCH-ROADMAP.md) | The stretching theories, which are implemented, and what is next |

## Layout

    Start.command     macOS launcher
    StartHere.bat     Windows launcher
    bin/              built programs, if you have them. Not in git; see below
    data/             everything the app remembers. Not in git; see below
    core/             the Rust workspace
    docs/             state, architecture, controls, menus
    ui/               the interface, embedded into the binary at build time
    visualiser/       the p5.js grain views, served at /grains3d
    models/           the YAMNet ONNX model
    Audio Library/    sample audio to try it on
    Reference Docs/   papers, the stretch roadmap, and the classification taxonomy

## The built programs

`bin/` is **not tracked in git**. The classifier took the binaries from 4.7 MB
to 74 MB, and git keeps every version of that forever.

The launchers build from source when `bin/` is empty, so a fresh clone works —
it just takes a minute the first time. If you want them there, put them there:

    cargo build --release --manifest-path core/Cargo.toml
    cp core/target/release/audiolab bin/

Either launcher runs **whichever binary is newer**, the shipped one or your own
build. It used to prefer `bin/` outright, which meant a rebuild could silently
have no effect because the launcher was still running a copy from weeks ago.

## Where your work is kept

Everything the app remembers lives in **`data/`**, beside the launcher — the
chosen library path, tag overrides, markers, presets, saved sessions, acoustic
fingerprints, learned labels and the scan index. It is deliberately *not* under
`core/target`, because `cargo build --release` output gets cleaned and would
take your work with it.

`data/` is not tracked in git; it is per-machine, and the library path differs
between the Mac and the PC.

## Building from source

    cargo build --release --manifest-path core/Cargo.toml     # this machine
    cargo test  --release --manifest-path core/Cargo.toml     # 785 tests

For the Windows build from a Mac, once per machine:

    rustup target add x86_64-pc-windows-gnu
    brew install mingw-w64

then

    cargo build --release --manifest-path core/Cargo.toml --target x86_64-pc-windows-gnu
    cp core/target/x86_64-pc-windows-gnu/release/audiolab.exe bin/

**The interface is embedded into the binary** with `include_str!`. After editing
anything in `ui/` or `visualiser/`, rebuild — otherwise the browser is served
the old file.

## Worth knowing

- **Nothing here renames, moves or overwrites audio.** Edits are an edit list —
  clips referencing ranges of the source — so cutting an hour costs two
  integers. Export is the only thing that writes audio, and it writes a new file.
- **Provenance is shown, not hidden.** Values are marked measured, inferred or
  guessed, because a lot of this library is headerless PCM where the truth has
  to be reconstructed.
- **Anything the probe cannot recognise is read as headerless PCM**, which is
  why a peak cache or a text sidecar will play as noise. That fallback is
  deliberate — SD2 data forks and raw dumps are real sounds with no header — so
  it stays, and **Play all files** in the View menu decides whether the browser
  offers them.
- **Mono vs dual-mono stereo cannot be determined from raw PCM** — both give an
  identical 0.5 delta ratio. Headerless channel counts come from neighbouring
  headered files instead.
- **The waveform is sample accurate when zoomed in.** Past the point where there
  are more pixels than samples, the display stops being a min/max summary and
  draws the samples themselves; the zoom readout switches to `n smp` to say so.
- **Grain randomness is a pure function of grain index and seed**, never a
  running generator — because the waveform, the playback and the exported file
  are three separate renders, and a stateful generator would give each of them
  different audio.

## Licence

MIT OR Apache-2.0.
