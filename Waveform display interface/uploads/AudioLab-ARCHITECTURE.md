# AudioLab — Architecture Specification

**Cross-platform audio editor and sound cataloger. Rust core, browser + native, TDD.**

Version 1.0 — 8 August 2026
Status: **design locked.** All sixteen decisions recorded (§2.3, §12). No open questions block
interface design — §8 is ready for handoff. No code written yet.

---

## 0. What this document is

The complete technical design for all four pillars of AudioLab, decided together so that no pillar
paints another into a corner. It defines crate boundaries, data models, trait contracts, the
format matrix, the analysis schema, the plugin story, and the TDD strategy.

It deliberately stops short of UI design. §8 defines the **UI contract** — the commands, events, and
data shapes the interface must speak — so the interface can be designed independently in Claude
Design and brought back for implementation without renegotiating the core.

**The four pillars, all first-class:**

| # | Pillar | One-line definition |
|---|---|---|
| 1 | **Format I/O** | Open, edit and save every professional and legacy audio format, losslessly, with metadata intact. |
| 2 | **Edit engine** | Sample-accurate non-destructive editing — cut, copy, paste, insert, fade, with unlimited undo. |
| 3 | **DSP & plugins** | Built-in processing with best-in-class time-stretching, plus a plugin substrate that works in both builds. |
| 4 | **Sound Navigator** | Ingest a sound library, analyse every file, auto-tag it against UCS, and search it by text, metadata, or similarity. |

---

## 1. Product definition

### 1.1 What AudioLab is

A **destructive-capable, non-destructive-by-default single-file and multi-clip audio editor** with an
integrated **sound library manager**, running as a native desktop application and as a browser
application from the same Rust core.

Positioning: the missing intersection. The professional SFX tools (Soundminer, BaseHead) have
world-class metadata and no perceptual search. The ML sample browsers (Sononym, Atlas) have
similarity search and effectively no professional metadata. Nobody ships free-text semantic search
over a **local** library with full BWF/iXML/UCS fidelity, and nobody pairs it with a real editor.

### 1.2 The four differentiators

1. **Format completeness including the archive tail.** SD2 rescue, Wave64, RF64, CAF, AIFF-C — the
   formats that lock people out of their own back catalogue. Nothing else in Rust does this.
2. **Text→audio semantic search over a local library.** "metallic door creak on concrete" — no
   incumbent in this market has it.
3. **Tiered progressive scan.** Library is searchable in minutes, not days. Sononym's fatal flaw is
   that its scan is all-or-nothing.
4. **Transparent time-stretch as a headline feature**, live and re-editable in the edit graph, not a
   destructive dialog.

### 1.3 Explicit non-goals for v1

- Not a DAW. No MIDI sequencing, no virtual instruments, no tempo map beyond clip warping.
- No cloud sync, no server component, no telemetry. **Local-only is a selling point** — post houses
  under NDA cannot use cloud scanners. Say so loudly.
- No multitrack mixing console. Tracks exist as edit lanes, not as a mixer.
- No collaborative editing (but the command-log undo model leaves the door open).

---

## 2. Architecture

### 2.1 The shape

```
┌────────────────────────────────────────────────────────────────────────┐
│  UI — one web codebase (designed in Claude Design, implemented in TS)  │
│  browser: served as a PWA        │        desktop: Tauri v2 webview    │
└────────────────┬─────────────────────────────────┬─────────────────────┘
                 │  typed Command / Event bus (§8) │
┌────────────────▼──────────────────┐ ┌────────────▼──────────────────────┐
│ BROWSER HOST ADAPTER              │ │ NATIVE HOST ADAPTER               │
│ • core in a DedicatedWorker       │ │ • core linked as a Rust lib       │
│ • AudioWorklet = thin RT shim     │ │ • cpal callback = thin RT shim    │
│ • OPFS SyncAccessHandle for I/O   │ │ • std::fs + mmap, native dialogs  │
│ • SharedArrayBuffer ring buffers  │ │ • rtrb ring buffers               │
│ • File System Access (Chromium)   │ │ • real filesystem paths           │
└────────────────┬──────────────────┘ └────────────┬──────────────────────┘
                 └───────────────┬──────────────────┘
        ┌────────────────────────▼─────────────────────────┐
        │  audiolab-core — pure Rust, zero platform APIs   │
        │  every I/O behind a trait, every DSP allocation- │
        │  free, one process() function both hosts call    │
        └──────────────────────────────────────────────────┘
```

**The single most important rule in this document:** `std::fs::File`, `memmap2::Mmap`, `web_sys`,
`tokio`, and anything else platform-shaped must never appear below the host adapter layer. If a
format parser or a DSP node touches a platform type, the browser build dies and it is not
retrofittable. This is enforced in CI (§9.5).

### 2.2 Crate map

Per **D11** (§2.3), the crate boundary is also the **licence boundary**. `[pub]` crates are published
to crates.io under MIT/Apache-2.0; `[closed]` crates are proprietary.

```
audiolab/
├── crates/
│   ├── audiolab-io          [pub]    # RandomAccessSource/Sink traits, byte-level chunk r/w
│   ├── audiolab-formats     [pub]    # WAV/RF64/W64/AIFF/AIFC/FLAC/CAF/SD2/AU/raw — read + write
│   ├── audiolab-metadata    [pub]    # bext, iXML, aXML, ID3, Vorbis comments, UCS grammar
│   ├── audiolab-buffer      [pub]    # AudioBuffer, sample-format conversion, dither, channel maps
│   ├── audiolab-dsp         [pub]    # STFT, mel, MFCC, onsets, YIN, chroma, HPSS, envelopes
│   ├── audiolab-peaks       [pub]    # peak pyramid + spectrogram tiles and cache format
│   ├── audiolab-stretch     [closed] # time/pitch engines (WSOLA, phase-locked PV, PGHI, granular)
│   ├── audiolab-fx          [closed] # built-in effects implementing the Effect trait
│   ├── audiolab-graph       [closed] # edit graph, clips, automation, render cache, latency comp
│   ├── audiolab-analysis    [closed] # per-file descriptor extraction (pillar 4, pass 2)
│   ├── audiolab-embed       [closed] # ONNX inference: CLAP, YAMNet (pillar 4, pass 3)
│   ├── audiolab-catalog     [closed] # SQLite schema, FTS5, vector index, hybrid ranking
│   ├── audiolab-engine      [closed] # transport, scheduler, the one RT process() entry point
│   ├── audiolab-core        [closed] # facade: re-exports, Command/Event bus, session state
│   ├── audiolab-host-native [closed] # cpal, std::fs, mmap, native dialogs, Tauri commands
│   └── audiolab-host-web    [closed] # wasm-bindgen, AudioWorklet shim, OPFS, SAB rings
├── apps/
│   ├── desktop/             [closed] # Tauri v2 shell
│   └── web/                 [closed] # PWA shell
├── ui/                      [closed] # shared TypeScript UI — one codebase, two shells
├── fuzz/                            # cargo-fuzz targets for every parser
└── testdata/                        # golden files, conformance corpora (git-lfs)
```

The published crates must never depend on a closed crate — dependencies point one way only. This is
a CI check, not a convention (§9.5).

`audiolab-core` and everything below it compile on **stable Rust**, single-threaded, no platform
deps. Parallelism is an additive `parallel` feature (rayon) so a broken nightly can never block a
release.

### 2.3 The ten cross-cutting decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Web UI + Tauri v2 on desktop, same UI in the browser.** | The UI is designed in a web tool. A native Rust GUI means hand-porting every design change forever. |
| D2 | **Audio I/O is not shared; `process()` is.** Browser = AudioWorklet, desktop = cpal in the Rust process (never through the webview). | WebKitGTK's Web Audio on Linux is a liability. Only the host adapter differs, which is where it should. |
| D3 | **All decode, resample, render and bounce in Rust.** Never `decodeAudioData`, never `OfflineAudioContext`, never WebCodecs on the core path. | The browser resamples with an unspecified resampler. Doing it ourselves is what makes browser and native output bit-identical and golden-file testable. |
| D4 | **Edit-list architecture, never "load the file into RAM."** | wasm32 caps linear memory at 4 GB; memory64 is Tier-3 in Rust and 10–100% slower. One hour of 24/96 stereo is ~2 GB as f32. This is not retrofittable. |
| D5 | **One `RandomAccessSource` trait, four impls** (File, Mmap, OPFS SyncAccessHandle, Cursor). Written in the first TDD cycle, before any parser. | See §2.1. |
| D6 | **SQLite as the catalog, one file, both platforms.** | Same schema desktop and browser; FTS5 and vectors in the same transaction; users can open it with any tool — a marketing feature for people burned by Soundminer's encrypted wrapper. |
| D7 | **`cargo-deny` license allowlist in CI from commit one.** Allow MIT/Apache-2.0/ISC/BSD/Zlib/Unicode-3.0/MPL-2.0; deny GPL/AGPL/LGPL. | Nearly every mature MIR and time-stretch library is copyleft. One config file prevents 90% of the ways this goes wrong. |
| D8 | **Internal `Effect` trait is the universal substrate**; CLAP hosting is a native-only addition; WCLAP is the v2 cross-platform target. | Native plugins cannot run in a browser. The trait is the only thing that gives feature parity, and it costs nothing. |
| D9 | **Undo is a command log over the edit graph, not over audio samples.** | Bytes, not gigabytes. Composes with scripting and later collaboration. |
| D10 | **Tiered progressive analysis** — headers in minutes, descriptors in background, embeddings lazily. | The competitor-killing feature and an architectural constraint on the catalog schema. |
| D11 | **Open core.** The six lowest crates ship MIT/Apache-2.0 on crates.io; everything above stays proprietary. | See §2.4. |
| D12 | **v1 is a single-file editor, built lane-shaped.** One lane visible; the model and the view component both accept N. | See §4.7. |
| D13 | **Browser ships first; desktop follows at v1.1.** The native *host adapter* still exists from Phase 0 — the equivalence test requires it — but the Tauri *app shell* defers. | See §2.5. No installer, no notarization, instant trial. The cost is that every browser risk becomes a launch blocker. |
| D14 | **Chromium full; Firefox and Safari degraded to import-only.** | See §2.5. Folder management has no technical path outside Chromium. |
| D15 | **Port signalsmith-stretch's core to Rust up front**, in Phase 3. Keep the C++ binding as an A/B reference oracle, never as a shipped dependency. | See §5.1. One engine, both platforms, equivalence test intact. |
| D16 | **Catalog scale target: 100k–500k files.** | See §6.6. Sets `sqlite-vec` brute-force as primary and keeps the single-file property. |

### 2.4 Licence model (D11)

**Open core, split on the crate boundary.**

**Published, MIT/Apache-2.0:** `audiolab-io`, `-formats`, `-metadata`, `-buffer`, `-dsp`, `-peaks`.
**Proprietary:** everything above them, plus both app shells and the UI.

**Why publish the bottom half.** There is currently **no permissive Rust equivalent to librosa's
feature set, and no Rust SD2 reader at all**. Publishing makes AudioLab the reference
implementation, which is worth more than exclusivity — format support is table stakes a competitor
could add anyway. The moat is the *integration*: editor + catalog + semantic search.

**Why not GPL, despite what it appears to unlock.** Going GPL would open aubio (onsets, pitch,
tempo, MFCC), Rubber Band (stretch), bliss-audio, and SoundTouch. That looks like it saves the
`audiolab-dsp` engineer-quarter. It does not, for three reasons:

1. **Those libraries are C/C++ and cannot cross the WASM boundary.** There is no C++ stdlib and no
   sysroot for `wasm32-unknown-unknown`. Using them means switching the browser build to Emscripten
   or wasi-sdk and abandoning `wasm-bindgen` — or writing the Rust versions anyway, for the web.
2. **It would break the keystone test.** Rubber Band natively + a Rust engine in the browser
   produces *different output*, which destroys the cross-host equivalence test (§9.1) — the single
   guarantee that keeps the two platforms from silently diverging. Two engines, doubled maintenance,
   and the correctness guarantee gone.
3. **Essentia is out regardless.** Its pretrained models are CC BY-NC-ND — non-commercial only —
   so even the paid UPF commercial licence leaves them unusable.

Plus: **GPL blocks Mac App Store and iOS entirely** (anti-tivoization vs Apple's terms — what got
VLC pulled). Direct notarized distribution is unaffected, which is how Reaper and Ardour ship
anyway, so it is a real but survivable constraint — just not one worth taking on for no benefit.

**The asymmetry that settles it:** permissive → GPL later is a one-line change. GPL → proprietary is
impossible once outside contributions land, absent a CLA from day one.

**Obligations this creates:**

- **CLA required** on the published crates from the first outside PR, or dual-licensing later
  becomes impossible.
- **Semver discipline and issue triage** on six public crates. This is a real tax on a solo
  developer and the main argument against. If it bites, the fallback is to keep everything
  proprietary and publish later — `cargo-deny` keeps that door open either way.
- **Dependency direction is one-way and CI-enforced** (§9.5). A published crate that reaches up into
  a closed one cannot be released.
- MPL-2.0 (Symphonia) is fine in both halves — file-level copyleft only, linking is unrestricted.

### 2.5 Release scope and platform matrix (D13, D14)

**v1 is the browser build. Desktop follows at v1.1.**

The upside is distribution: no installer, no notarization, no Gatekeeper, no App Store. A user
clicks a link and is editing. For a tool competing against $199–$899 incumbents with dongles, an
instant trial is a real weapon.

**What this costs, stated plainly.** Every browser-specific risk moves from "v1.1 problem" to
"launch blocker":

| Risk | Was | Now |
|---|---|---|
| 4 GB WASM ceiling (D4) | Design constraint | **Ship-blocking.** Streaming must be right at launch. |
| COOP/COEP + nightly threads | Optimization | **Ship-blocking.** If threads fail, analysis is single-threaded at launch. |
| Safari AudioWorklet module bug | Known unknown | **Ship-blocking** for the Safari tier. |
| OPFS quota and eviction | Cache concern | **Ship-blocking.** Derived data must fit and survive. |
| CLAP model download | Installer decision | **First-run UX.** 30–60 MB before the user's first search. |

Consequently **the three Phase 0 spikes are release gates, not design inputs** (§10). If the Safari
AudioWorklet path fails, Safari drops to the degraded tier or out entirely — that is a v1 scoping
decision, not a bug to fix later.

**The native host adapter is still built from Phase 0.** The cross-host equivalence test (§9.1)
requires a native renderer to compare against, and it runs on every commit. What defers to v1.1 is
the **Tauri app shell** — window, menus, native dialogs, file associations — not the native core
path. This keeps the shared-core bet honest without paying for a second product at launch.

**Browser tier matrix (D14):**

| | Chromium | Firefox | Safari |
|---|---|---|---|
| Open, edit, process, export | ✅ | ✅ | ✅ |
| Persisted folder access, library management | ✅ | ❌ | ❌ |
| Write back to the original file | ✅ | ❌ | ❌ |
| Import into OPFS via `webkitdirectory` | ✅ | ✅ | ✅ |
| Threads (COOP/COEP) | ✅ | ✅ | ✅ |
| WebGPU fast path | ⚠️ Linux only from 144/147 | ⚠️ nightly on Linux | ✅ |

The degraded tier is an **explicit designed flow**, not an error state: Firefox and Safari users
import a folder into OPFS, work normally, and export out. The UI must say what they are giving up
and offer the desktop app — once it exists — as the answer. Designing that flow is real work and
is in scope for the Claude Design handoff (§8).

---

## 3. Pillar 1 — Format I/O

### 3.1 The abstraction, first

```rust
pub trait RandomAccessSource {
    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize>;
    fn len(&self) -> io::Result<u64>;
}

pub trait Sink {
    fn write_all_at(&mut self, offset: u64, buf: &[u8]) -> io::Result<()>;
    fn set_len(&mut self, len: u64) -> io::Result<()>;
    fn flush(&mut self) -> io::Result<()>;
}
```

Every parser is generic over `RandomAccessSource`. Impls: `std::fs::File` (native),
`memmap2::Mmap` (native, behind cfg), `FileSystemSyncAccessHandle` (browser worker),
`io::Cursor<Vec<u8>>` (tests, and small in-memory files).

Note the browser constraint that shapes everything downstream: `createSyncAccessHandle` is
**dedicated-worker only** and **OPFS only**. It does not exist inside `AudioWorkletGlobalScope`.
So disk-streaming playback is always: worker reads synchronously → pushes into a SAB ring →
worklet pulls. That is Chrome's documented worker+worklet+SAB pattern and it is the only shape
that works.

### 3.2 The format matrix

| Format | Read | Write | Hand-written work |
|---|---|---|---|
| **WAV** PCM 8/16/24/32, f32/f64, EXTENSIBLE | `symphonia-format-riff` | vendored `bwavfile` (MIT) | Chunk-level r/w for `bext`, `iXML`, `axml`, `cue `/`adtl`, `smpl`, `inst`, `levl`, `LIST-INFO`. `levl` and `smpl` exist in **no** crate. |
| **RF64 / BW64** | `bwavfile` | `bwavfile` (auto-upgrades at 4 GB) | Read both `ds64` chunk-size interpretations permissively; write the one Reaper/Pro Tools/ffmpeg emit. |
| **Wave64 (.w64)** | — | — | **Entirely ours.** ~400 lines. RIFF with 16-byte GUIDs and u64 sizes. The `ChunkSize` field is self-inclusive — off-by-24 in every naive port. |
| **AIFF / AIFF-C** | `symphonia-format-riff` or `aifc` | **`aifc`** (MIT/Apache, no alloc, no unsafe, no panic) | 80-bit IEEE-754 extended sample-rate conversion (15-bit biased exponent, 64 *explicit* mantissa bits — the integer bit is stored, not implied). `MARK`/`INST` loop-ID resolution. `aifc` caps at 4 GB. |
| **FLAC** native | `symphonia-bundle-flac` | **`flac-codec`** (RFC 9639, verified against reference impl) | SEEKTABLE generation, PICTURE handling. |
| **Ogg FLAC** | `symphonia-format-ogg` + flac | `ogg` crate muxer + `flac-codec` frames | Ogg-FLAC mapping glue. |
| **CAF** | `symphonia-format-caf` (rated only "Good") | — | **The writer is entirely ours.** Big-endian, 12-byte chunk headers, `pakt` table for non-LPCM. Note `data`'s leading `UInt32 mEditCount`, and `mChunkSize` is *signed* with −1 = streaming. |
| **MP3** | `symphonia-bundle-mp3` (excellent, gapless) | omit, or native-only dynamic-linked | Patents expired 2017, but every usable encoder binding is LGPL and WASM has no dynamic linking. **Recommend: decode yes, encode no.** |
| **Opus** | `opus-rs` (pure Rust port of libopus 1.6) | `opus-rs` | Ogg-Opus container mapping (`OpusHead`/`OpusTags`, pre-skip, granulepos). **Gate `opus-rs` behind an RFC 6716 conformance test — it is 0.1.x, single-vendor, self-declared production-ready.** Keep libopus FFI as native fallback. |
| **Vorbis** | `symphonia-codec-vorbis` | `vorbis_rs` (C dep, native only) | No pure-Rust encoder exists. Do not attempt one; transcode to Opus on web. |
| **AAC / ALAC / MP4** | symphonia (all "Great") | skip | — |
| **Sound Designer II** | — | — | **Entirely ours, read-only.** See §3.3. |
| **AU / .snd** | — | — | **Ours, trivial.** Big-endian, magic `0x2E736E64`, six BE u32s, 24-byte minimum header. |
| **VOC, IRCAM/BICSF** | — | — | **Ours, trivial.** Fixed headers. |
| **SoundFont 2** | `soundfont` / `rustysynth` (MIT) | — | Avoid `oxisynth` (LGPL-2.1). |
| **SFZ** | `sofiza` (MIT/Apache) | — | — |
| **Raw / headerless** | — | — | **Ours.** This is both the SD2 fallback and a feature in its own right. |

**Rejected:** libsndfile. LGPL-2.1, and its FAQ is unambiguous that static linking is only legal if
your application is GPL or LGPL. It is also in maintenance-only mode (1.2.2, Aug 2023). We use it
as a **differential test oracle** in CI — licensing affects shipping, not testing.

**Deferred:** EXS24 (undocumented, reverse-engineered only), Akai S1000/S3000 (disk-image parsing),
Ensoniq PARIS (dead platform), MPEG-4 ALS (no user base). Nuendo is not a format — it writes
WAV/W64/BWF/AIFF.

### 3.3 Sound Designer II — the archive-rescue feature

This is the format that earns goodwill, and it is the hardest one. Audio lives in the **data fork**;
every format parameter lives in the classic Mac OS **resource fork**. Lose the resource fork —
copy via Windows, FAT/exFAT, most zip tools, git — and you have an unlabelled byte blob. PRONOM
fmt/209 has **no signature** for SD2, which confirms it: there is nothing to sniff.

**Resource fork contents** (Digidesign spec):

| Resource | ID | Contents |
|---|---|---|
| `'STR '` | 1000 | sample size — **decimal ASCII string** of *bytes* per sample (`"2"` = 16-bit) |
| `'STR '` | 1001 | sample rate — floating-point **string**, e.g. `"44100.0000"` |
| `'STR '` | 1002 | channels — decimal string |
| `'sdDD'` | 1000 | comments, SMPTE timecode, tempo, cursor position, zoom |
| `'sdML'` | 1000 | marker list — position, type (1 numbered / 2 text), text |
| `'sdLL'` | 1000 | loop list — start/end frame, index, direction, channel |

The three mandatory parameters are **ASCII strings, not binary**. And the data fork is
**big-endian** — the Digidesign spec text mislabels it as little-endian while describing MSB-first
byte order; libsndfile's `sd2.c` opens with `/* SD2 is always big endian. */`. Ignore the label.

**Importer algorithm:**

1. Probe for a resource fork in five locations, in order: `name/..namedfork/rsrc` (macOS native),
   `._name` (AppleDouble sidecar), `.AppleDouble/name` (netatalk), `__MACOSX/._name` (macOS zip),
   `name.rsrc`.
2. AppleDouble parse: big-endian, magic `0x00051607`, version u4, 16 reserved bytes, entry count u2,
   then 12-byte descriptors `{id: u4, offset: u4, length: u4}`. **Entry ID 2 is the resource fork.**
3. Classic resource-fork parse: 16-byte header (dataOffset, mapOffset, dataLength, mapLength, BE u32);
   type list at `map_offset + 30`; scan for `'STR '` IDs 1000–1002.
4. **Steal libsndfile's detection hack**: if the first two BE u32s read as `0x51607` and `0x20000`,
   the "resource fork" file is actually a whole AppleDouble wrapper — skip 0x52 bytes and re-read.
   Also steal the sanity heuristic: if `sample_rate <= 4 && sample_size > 4`, the two got swapped.
5. **No resource fork → raw-import dialog**, seeded by heuristics:
   - length divisibility (÷2, ÷3, ÷4, ÷6) constrains bit depth × channels
   - autocorrelation at candidate interleave strides detects channel count
   - try both endiannesses, pick the one with lower mean absolute first-difference — byte-swapped
     16-bit PCM looks like white noise. **Show the user both waveforms and let them choose.**
   - DC offset and clipping checks distinguish signed 16-bit from unsigned 8-bit
   - if importing a Pro Tools session folder, the session file names the rate and depth — seed every
     SD2 file in the folder from it

This is as much a UI problem as a parsing problem. Budget for the dialog.

**"SD2f in an AIFF wrapper" does not exist.** `Sd2f` is the classic Mac OS OSType file-type code
written into Finder Info. The real AIFF connection is duller: an SD2 data fork plus a synthesised
54-byte AIFF header *is* a valid AIFF file, which is what the old Mac conversion utilities did.

### 3.4 Sample representation

One internal type, one convention, documented once:

```rust
pub struct AudioBuffer {
    channels: SmallVec<[Vec<f32>; 2]>,   // planar, not interleaved
    sample_rate: u32,
    channel_map: ChannelMap,             // speaker assignment, ambisonic order
}
```

Int↔float convention: **divide by `2^(n-1)`** on the way in; **clamp** on the way back; dither
optional (TPDF, noise-shaped variants selectable). `aifc` deliberately refuses to do sample-format
conversion for you, so this is ours and must be exactly one implementation used by every codec path.

### 3.5 Format-layer hard problems

1. RF64 `ds64` chunk-size ambiguity — the spec never says whether table entries include the 8-byte
   chunk header, and real files exist both ways.
2. BWF `bext` sentinel handling — `0x7FFF` means "unset" for the five v2 loudness fields, scaling is
   ×100 signed. Writing `0` where you meant "unknown" silently claims 0.00 LUFS.
3. Cache invalidation — `(mtime, size)` alone collides, and network volumes lie about mtime. Add a
   content hash.
4. Symphonia is **decode-only** and every encode path is a different crate with a different sample
   representation. The `AudioBuffer` adapters in both directions are load-bearing.

---

## 4. Pillar 2 — Edit engine

### 4.1 The model

**Source layer (immutable, content-addressed).** Decoded audio, never mutated. Peak pyramids and
STFT overviews cached alongside, keyed by content hash.

**Edit graph (declarative, serializable).** This *is* the project document — small, diffable,
versionable.

```rust
pub struct Clip {
    source: SourceId,
    source_offset: u64,        // frames into the source
    length: u64,               // frames
    timeline_position: u64,    // frames on the timeline
    gain: f32,
    fade_in: Fade,             // shape + length
    fade_out: Fade,
    stretch: Option<Stretch>,  // ratio, algorithm, formant, transient mode, quality tier
    chain: EffectChain,
}
```

**Render cache.** Materialised audio for graph subtrees, keyed by a **structural hash** of
`(node type, parameter values, automation curve digest, sample rate, upstream cache keys)`. A
parameter change invalidates that node and its descendants only.

**Undo/redo = command log over the graph.** Every mutation is a `Command` with an inverse. Memory
cost is bytes.

### 4.2 Edit operations

The operations RJ named, defined precisely:

| Operation | Semantics |
|---|---|
| **Cut** | Remove range, ripple everything after it earlier by the range length. |
| **Copy** | Range → clipboard as a source-reference + range, not as samples. |
| **Paste (overwrite)** | Replace the destination range in place. |
| **Paste (insert)** | Split the clip at the insertion point, ripple later material right. |
| **Delete** | Remove range, leave silence (no ripple). |
| **Trim / crop** | Keep selection, discard the rest. |
| **Split** | Clip → two clips at the playhead. `split(t)` then `join` must be exact identity. |
| **Silence** | Zero the range in the graph (a gain-0 segment, not written samples). |
| **Fade in/out, crossfade** | Shape (linear, exp, log, S-curve, equal-power) + length; crossfade is an overlap region with paired shapes. |
| **Normalize / gain** | Peak, true-peak, or LUFS target. Non-destructive: a gain node. |
| **Reverse, invert** | Graph nodes, not sample writes. |
| **Insert file / insert silence** | Ripple insert of a new clip or a gap. |

Every one of these is a `Command` with a tested inverse. Sample-accurate throughout — positions are
`u64` frame counts, never floats, never seconds.

### 4.3 Destructive mode

Not everyone wants a graph. Provide:

- **Apply / Bake** — render a clip's chain to a new source file and repoint the clip. Always creates
  a *new* source; never overwrites. The old source is what makes undo cheap.
- **Destructive file editor mode** (WaveLab-style) for people who just want to top-and-tail a WAV.
  It maps onto the same graph: a single clip with an immediate bake on save.

### 4.4 Render cache mechanics

- Cache in **1–4 second chunks**, not whole clips, so a small edit doesn't invalidate a 10-minute
  render.
- **Warm-up per chunk**: to render chunk *k* independently, run the chain from
  `k_start − warmup_samples` and discard. Every `Effect` declares `warmup_samples()`.
- **Effects with long IRs** (reverb, long delays) need generous warmup or must be excluded from
  chunk-parallel rendering.
- **A stretch node is a clip-level barrier** — it renders whole-clip and caches whole-clip. Time and
  pitch nodes are the worst offenders for chunk independence.
- **Two-tier quality**: cache a fast preview render (WSOLA stretch, cubic resample) for immediate
  playback; swap in a background high-quality render when ready. This is the single biggest
  perceived-performance lever in an editor with expensive stretching.

### 4.5 Waveform and spectrogram

**Peak pyramid format** — REAPEAKS-shaped header, our own body:

```
magic "ALPK" | version u16 | channels u8 | n_levels u8 | sample_rate u32
             | source_size u64 | source_mtime u64 | source_blake3 [u8;32]
per level:   div_factor u32 | n_buckets u64
per bucket per channel: min f32, max f32, sum_of_squares f32
```

Levels at div = 256, 4096, 65536. f32 not i16 because we edit float material and want headroom.
Sum-of-squares so we can draw the dual min/max + RMS envelope. Level 0 is built during decode;
higher levels are built by **reducing the level below** (min-of-mins, max-of-maxes, sum-of-sums) —
O(n) total and trivially unit-testable as a pure fold. Same file on OPFS and on disk.

Content hash in the header, not just `(size, mtime)` — see §3.5.

**Rendering, three tiers, in this order:**

1. **Canvas2D from precomputed peaks** — the default. It is fast precisely because the pyramid
   already reduced the data to ~1 value per pixel column. Never let the UI layer decode audio.
2. **WebGL2 / wgpu-over-GL** for spectrogram tiles and multi-clip scrolling — universally available.
3. **WebGPU / native wgpu** as an opt-in fast path. Not the default: WebGPU is still absent on
   Linux Firefox and only landed in Chrome 144/147 on Linux, and Tauri's Linux WebKitGTK almost
   certainly lacks it.

**Spectrogram** via `realfft` (real-to-complex, ~2× faster and half the memory of `rustfft` for real
input). CPU first, rayon-parallel, tiles cached in the same sidecar as peaks. GPU FFT is a v2
optimisation requiring compute shaders, hence WebGPU-only, hence excluded on Linux.

### 4.6 The real-time contract

```rust
impl Engine {
    /// The ONE function both hosts call.
    /// No allocation, no lock, no syscall, no panic.
    pub fn process(&mut self, ctx: &mut RtCtx, out: &mut Blocks<'_>) { … }
}
```

- **Native:** cpal callback → block adapter → `engine.process()`. Commands arrive via
  `rtrb::Producer`. Disk streaming via `creek` (MIT/Apache, RT-safe, built for exactly this).
- **Browser:** AudioWorklet `process()` (128 frames) → the *same* block adapter → the *same*
  `engine.process()`. Commands arrive via a SAB-backed SPSC ring. Disk streaming: worker holds an
  OPFS `SyncAccessHandle`, decodes with Symphonia, pushes into a SAB ring.
- Continuous parameters (gain, transport position, meters) use `triple_buffer` — latest-wins, not a
  queue. Discrete events use the ring.
- **Enforcement:** wrap the RT entry point in `assert_no_alloc`, and on Linux/macOS in
  `rtsan_standalone::nonblocking`. rtsan has no WASM support, so **the WASM RT guarantee is only as
  good as the native tests** — which is precisely why the worklet shim must stay under 100 lines.
- Build explicit **under-run counters** into the ring. Chrome's own docs acknowledge the
  worker↔worklet sync is "rather loose"; we want telemetry, not mystery glitches.

### 4.7 v1 scope: single-file, lane-shaped (D12)

**v1 is a wave editor, not an arrangement window.** One file open, one waveform, selection-based
editing, with regions and markers. This matches the stated use case exactly — *"cut, copy, paste,
insert little bits and pieces into itself"* — and it is the shape that closes the product loop with
the Navigator: browse library → audition → open → top-and-tail → save with metadata intact → back to
the library. Multi-clip arrangement is a different product and does not serve the cataloging story.

**This is a UI constraint, not an architectural one.** A ripple insert already produces a sequence
of segments referencing possibly several sources — v1 is multi-clip *internally* the moment you
implement "insert into itself." §4.1's graph handles both, unchanged.

**Lane-shaped, so v2 is additive.** Build the waveform view as a **lane** from day one:

- The graph carries `tracks: Vec<Lane>`; v1 asserts `len() == 1`.
- The view component takes `lanes: Lane[]` and renders N; v1 passes one.
- The transport, selection model, and coordinate system are lane-indexed from the start.
- Do **not** hardcode a single-waveform layout. Adding lanes in v2 must be a data change, not a
  redesign.

**Deferred to v2:** track headers, clip drag/trim handles, snapping, inter-clip crossfade editing,
summing bus, multi-stream disk reads, anything mixer-shaped. That list is the bulk of an editor's
UI complexity, and deferring it means six surfaces designed well rather than nine designed thinly.

**Regions and markers are the v1 feature that makes this not a compromise.**

| Capability | Detail |
|---|---|
| Markers | Named points; imported from and exported to `cue `/`adtl` (WAV), `MARK` (AIFF), `sdML` (SD2) |
| Regions | Named ranges, nestable, with per-region metadata fields |
| Auto-region | Split on silence threshold, on detected onsets, or at a fixed interval |
| **Batch region export** | Every region → its own file, with UCS-conformant naming, per-region metadata written to `bext`/iXML, and **direct ingestion into the catalog** |
| Loop points | `smpl` chunk round-trip, for sampler interop |

That batch-export path is a genuinely strong sound-design workflow — load a 40-minute field
recording, mark 60 regions, export each as a separately-named, UCS-tagged, catalogued file. It is
only possible in a single-file editor, and no competitor pairs it with semantic search.

---

## 5. Pillar 3 — DSP and plugins

### 5.1 Time-stretch: the headline feature

Four engines, selectable per clip, because no single algorithm wins everywhere.

| Engine | Algorithm | Use | Cost |
|---|---|---|---|
| **Fast** | WSOLA (Verhelst & Roelands, ICASSP 1993) | Live preview, drums, speech, moderate ratios | Cheapest by a wide margin |
| **Studio** | Phase vocoder with **identity phase locking** (Laroche & Dolson 1999) + transient detection and phase reset | The default. Music, polyphony, wide ratios | Moderate |
| **Reference** | **RTPGHI** — real-time phase gradient heap integration (Průša & Holighaus) | Highest transparency, offline/bake | Highest |
| **Creative** | Granular + Paulstretch-class extreme stretch | Sound design, 10×–1000× ratios | Low |

Formant preservation across all: spectral-envelope estimation (cepstral liftering / true-envelope)
with independent formant ratio, so pitch and timbre are separable.

**Key sourcing decision.** `signalsmith-stretch` (Geraint Luff) is **MIT**, and its design writeup
is public. Its approach is a close cousin of PGHI implemented cheaply: it measures relative phase
between neighbouring time-frequency points as a complex product `X[p₂]·conj(X[p₁])` — giving a
magnitude-weighted phase average for free, no `atan2`, no explicit peak picking — then does two
passes (horizontal/time neighbours, then vertical/frequency). Multichannel picks the loudest channel
and copies inter-channel phase differences exactly, which is why its stereo image holds up.

The existing Rust bindings use `cc` + `bindgen` on **C++**, which will very likely not build for
`wasm32-unknown-unknown` (no C++ stdlib, no sysroot).

**Decision D15: port the core to Rust up front, in Phase 3.** Upstream is MIT, so this is permitted
including modification. Budget 3–4 weeks. The C++ binding is vendored as an **A/B reference oracle
during development** — render the same material through both, assert bounded difference — and is
never a shipped dependency.

The alternative (C++ binding natively, WSOLA in the browser) was rejected for the same reason GPL
was: two engines produce different output, which breaks the cross-host equivalence test (§9.1). And
under D13 the browser build ships *first*, so a native-only quality engine would mean launching
without the headline feature.

Payoffs beyond parity: one codebase, `no_std`-capable, SIMD-portable via `portable_simd`, no bindgen
in CI, no C++ exceptions, and we own the code that differentiates the product.

**There is no Rust implementation of PGHI/RTPGHI.** The reference (LTFAT/PHASERET) is GPL MATLAB+C.
Read the papers, write it fresh. This is a genuine gap and a differentiator.

**License traps, non-negotiable:**

| Library | License | Verdict |
|---|---|---|
| **Rubber Band** | GPL-2.0-or-later **or** paid commercial; explicitly requires a commercial licence for App Store distribution | ❌ **Never link, not even "just for testing," into the same binary** |
| **SoundTouch** | LGPL-2.1 | ⚠️ Avoid — LGPL compliance in WASM/iOS static builds is genuinely hard |
| `pvoc` crate | GPL-3.0 | ❌ |
| PaulXStretch, LTFAT/PHASERET, SMS Tools | GPL/AGPL | ⚠️ Read the papers, write fresh. Algorithms are unencumbered. |
| **signalsmith-stretch** | **MIT** | ✅ Including modification and porting |

### 5.2 The rest of the effect set

Ordered by build priority, each with its reference:

| Effect | Reference | Notes |
|---|---|---|
| **Gain, pan, normalize, DC removal** | — | Week 1. |
| **Parametric EQ** | RBJ Audio EQ Cookbook; **Orfanidis** or matched-Z for high-frequency accuracy | `biquad` crate is adequate but thin — we will outgrow it. Add linear-phase (FFT) mode later; it reports large latency, which stresses the compensation path. |
| **Dynamics** — compressor, limiter, gate, expander, keyed expander, de-esser, ducker | Feed-forward topology; true-peak limiting per BS.1770 | Lookahead limiters report large latency — the classic un-compensated comb-filtering bug. Test explicitly. |
| **SRC** | Julius Smith resampling | `rubato` v4: Async (sinc/polynomial, variable ratio), Fft (synchronous fixed ratio, best offline), Slip (near-identical rates). `process_into_buffer()` is allocation-free → RT-safe. |
| **Reverb (FDN)** | **Jot & Chaigne 1991**; **Dattorro 1997** | RJ has an FDN running in TypeScript already and has flagged that it was built on inference rather than the primary source. Port from the papers. |
| **Convolution reverb** | **Gardner 1995** — zero-latency non-uniform partitioning | `fft-convolver` (MIT) does uniform partitioning; non-uniform is ours. |
| **Modulation** — chorus, flanger, phaser | — | — |
| **Saturation / tube** | Yeh & Smith wave digital filters; **Bilbao & Parker, antiderivative antialiasing (ADAA)** | ADAA is what separates a good saturator from an aliasing mess. |
| **Restoration** — declick, decrackle, dehum, denoise, spectral repair | Spectral subtraction, Wiener filtering | The RX-class feature set. `nnnoiseless` (BSD-3) is speech-only, 48k mono, fixed model — a one-click "voice cleanup," not a suite. `cathar` is new and unproven: read it, don't depend on it. |
| **Vocoder, rotary speaker, cabinet sim, Van der Pol filter** | RJ's existing reference-paper folder | Direct ports of his TypeScript work into the `Effect` trait. |

### 5.3 The Effect trait

```rust
pub trait Effect: Send {
    fn prepare(&mut self, ctx: &PrepareContext);      // rate, max block, channel count
    fn latency_samples(&self) -> u32;                 // may change on param change
    fn tail_samples(&self) -> u32;                    // for offline render tail
    fn warmup_samples(&self) -> u32;                  // for chunk-independent rendering
    fn process(&mut self, io: &mut ProcessContext<'_>);  // RT-safe: no alloc, no lock, no syscall
    fn reset(&mut self);
    fn params(&self) -> &ParamSet;
}
```

Compiled into both targets. Every built-in effect implements it. This is the only thing that gives
web/native feature parity, and it costs nothing.

### 5.4 Parameter and automation model

Design once, correctly — everything hangs off it.

- **Stable numeric IDs** (hash of a stable string name, as CLAP does), never array indices. Indices
  break preset compatibility the moment you insert a parameter.
- **Store `f64` plain values** with declared min/max/default plus a mapping curve
  (linear/log/exp/stepped/toggle) for the UI. Do **not** make normalized 0–1 the source of truth —
  it makes preset migration and text I/O miserable.
- **Automation as sample-accurate events**, not per-block values: a block carries
  `(offset_in_block, param_id, value)`. Adopt CLAP's `clap_event_param_value` / `param_mod` shape
  directly so the CLAP bridge is trivial later.
- **Modulation is separate from automation and additive** (CLAP's model — `param_mod` is a temporary
  offset that doesn't change the stored value). Otherwise you can't LFO a parameter the user is also
  automating.
- **Main thread owns authoritative state.** Audio thread receives via lock-free SPSC and reports
  gestures back via another. Never a `Mutex` shared with the audio thread.
- **In the browser** this maps onto SAB + ring buffer — exactly the Web Audio Modules 2.0 approach,
  which deliberately bypasses `AudioParam` for this reason. If cross-origin isolation is
  unavailable, degrade to `port.postMessage` with block-quantized automation and **document the
  degradation**.

### 5.5 Latency compensation

- Cumulative delay by longest path from source to sink; insert compensating delay lines on shorter
  paths at merge points. Topological sort + max over predecessors.
- Latency changes (minimum→linear-phase EQ) emit a notification and trigger a re-plan.
- **Offline render must not apply latency naively**: pre-roll each chain by its latency and discard
  the first `L` samples; render `tail_samples()` extra so reverb tails aren't truncated.

### 5.6 Plugins

| Stage | What | Why |
|---|---|---|
| **v1** | Internal `Effect` trait only | Universal, zero cost, full parity |
| **v1.5** | **CLAP hosting natively** via `clack-host` (MIT/Apache) | CLAP spec is **MIT**, thread-safety and RT-safety are actually specified, Rust hosting is real today |
| **v2** | **WCLAP** — CLAP compiled to WASM+WASI | The official CLAP-org direction (`free-audio/web-clap`, MIT). A working browser host already exists, built by the signalsmith-stretch author. Run `wasmtime` natively and native WASM in-browser so one plugin binary runs identically in both builds. |
| **Maybe** | WAM 2.0 adapter | Only if a specific plugin users want is WAM-only. JS-centric, browser-only, no native story. |
| **Not v1** | VST3 | The Steinberg SDK licence is GPL-3.0 **or** a proprietary agreement, and it governs *hosting* as well as building. Structural risk. |
| **Later** | LV2 (ISC, clean) via `livi`; AU (macOS only, needs ObjC interop) | Cheap to add, Linux-centric ecosystem / platform-specific |

---

## 6. Pillar 4 — Sound Navigator

### 6.1 UCS is the spine

The Universal Category System is **public domain**, frozen at v8.2, and already adopted by
Soundminer, Soundly, BaseHead, Nuendo, and most SFX publishers. Supporting it is table stakes.
*Authoring* it well is the differentiator: auto-suggest CatID from audio + text, batch rename,
round-trip to embedded chunks.

Structure: two-level controlled vocabulary — **Category** → **SubCategory** (753 of them) with a
**CatID**, plus **9,972 synonyms**. Filename convention:
`CatID_FXName_CreatorID_SourceID_UserData`.

The canonical list has **no machine-readable source** — it's distributed as a spreadsheet. Vendor
it, checksum it, and **publish our normalized JSON**. That's a small open-source contribution that
buys real goodwill in exactly the community we're selling to.

### 6.2 Metadata containers

Read *and* write, non-destructively, with full fidelity:

| Container | Where | Notes |
|---|---|---|
| **BWF `bext`** | WAV/RF64 | Description, Originator, OriginationDate/Time, TimeReference, UMID, coding history, v2 loudness fields (watch the `0x7FFF` sentinel) |
| **iXML** | WAV/RF64 | The pro-audio workhorse. Project, Scene, Take, Tape, Circled, track lists, and the ASWG extension namespace |
| **aXML / ADM** | WAV/RF64 | Object-based audio metadata |
| **`cue `/`adtl`, `smpl`, `inst`** | WAV | Markers, regions, loop points. `smpl` is in **no** crate. |
| **ID3** | WAV (`id3 ` chunk), MP3, AIFF | via `id3` crate |
| **Vorbis comments** | FLAC, Ogg | via `flac-codec` metadata module |
| **UCS filename** | all | Parse and generate. This is metadata too, and often the *only* metadata. |

**Never silently overwrite embedded metadata.** Read it, show it, propose changes, commit on user
action. Post-house users have been burned by tools that rewrote their `bext`.

### 6.3 The tiered scan — the competitive lever

| Pass | What | Cost/file | When |
|---|---|---|---|
| **1 — Index** | Header parse, file stat, filename UCS parse, embedded chunk read, content hash | ~1 ms | Immediately. **Library is searchable in minutes.** |
| **2 — Descriptors** | Loudness, peaks, spectral moments, onsets, tempo, f0, key, envelope, stereo correlation | ~50–200 ms | Background, resumable, priority-ordered by folder the user is browsing |
| **3 — Embeddings** | CLAP audio embedding, YAMNet coarse gate | ~200 ms–1 s | Lazy / idle-time / on-demand per folder |

Every pass writes independently and is separately resumable. Sononym's fatal flaw is that its scan
is all-or-nothing and takes days-to-weeks on a real library.

### 6.4 The analysis feature set

**Basic:** duration, sample rate, bit depth, channels, sample peak, **true peak**, RMS, **LUFS
integrated / short-term / LRA** (EBU R128 / ITU-R BS.1770 via the `ebur128` crate, MIT), DC offset,
clipping detection, leading/trailing silence trim points.

**Spectral:** centroid, spread, rolloff, flatness, MFCCs, chroma.

**Temporal:** onset detection (spectral flux → complex-domain → **SuperFlux**), tempo via
autocorrelation over the onset detection function, attack time, envelope shape descriptors.

**Pitch:** f0 via **YIN** (fast path, ~200 LOC) with an ONNX model as the accurate path; key
detection by chroma-profile correlation; harmonicity/inharmonicity; monophonic vs polyphonic.

**Classification:** one-shot vs loop, tonal vs percussive (via HPSS), noise vs tonal, stereo width
and correlation, mono-compatibility.

**The licensing problem, and why we build `audiolab-dsp` ourselves.** Every mature MIR library is
copyleft: **aubio GPL-3.0**, **bliss-audio GPL-3.0**, **Essentia AGPL-3.0** — and Essentia's
pretrained models are **CC BY-NC-ND** (non-commercial only), so even the paid commercial licence
leaves the models unusable. The permissive Rust stack (`rustfft`, `realfft`, `ebur128`, `symphonia`,
`rubato`) covers DSP primitives but **not** onsets, tempo, pitch, or chroma.

So we write: STFT/mel/MFCC (~200 LOC), SuperFlux onsets (~500 LOC), ODF-autocorrelation tempo
(~300 LOC), YIN f0 (~200 LOC), log-frequency chroma + key profiles, HPSS median filtering (~150 LOC),
envelope descriptors. **Budget one engineer-quarter.** This is unavoidable, and it is itself a
defensible asset — there is currently no MIT/Apache Rust equivalent to librosa's feature set.

The largest genuine gap is the **constant-Q transform**. No mature permissive Rust CQT exists.
Either implement Brown–Puckette, or approximate chroma from an FFT bin→pitch-class mapping with a
log-frequency triangular filterbank — good enough for key detection on samples.

### 6.5 ML tagging and semantic search

**Model: LAION-CLAP, fusion checkpoint.** ~86 M params, **512-dim** embeddings, 48 kHz input, HF
weights **Apache-2.0**, code CC0. The fusion checkpoints handle variable-length audio, which matters
because sound libraries contain both 0.4 s one-shots and 40-minute field recordings.

**Why CLAP specifically:** it is the *only* family that produces a joint audio/text space. PANNs,
VGGish, YAMNet, OpenL3, AST, BEATs all produce audio-only embeddings — great for "find similar,"
useless for "find me a metallic door creak." One CLAP model gives us three features:

1. text→audio search
2. audio→audio similarity
3. **zero-shot classification against arbitrary label sets — including the 753 UCS SubCategory names
   and their 9,972 synonyms**

That third point is the crux: **CLAP + the UCS synonym list *is* the auto-tagger, with no training
required**, and it upgrades free when UCS does.

**Worth tracking:** Sony AI's Woosh-CLAP (2026) reports **248% higher retrieval performance on
professional sound libraries** when trained on ~1 M commercially-licensed studio SFX vs public-data
CLAP. That is direct evidence that generic CLAP under-performs on pro SFX vocabulary and that
domain fine-tuning is the highest-leverage improvement available. Its licence text is
self-contradictory (paper says both "CC BY 4.0" and "non-commercial") — **verify before depending
on it.**

**Coarse gate:** YAMNet (~3.7 M params, Apache-2.0) for cheap speech/music/SFX triage before the
expensive passes, at millions-of-files scale.

**Runtime:**

- **Desktop:** `ort` (ONNX Runtime bindings, MIT/Apache). CoreML on Apple Silicon, DirectML on
  Windows, CUDA where present — for free. Note it is at 2.0.0-rc; wrap it behind a trait.
- **Browser:** two routes. (a) `tract` compiled to WASM — pure Rust, one codebase, CPU-only, needs
  op-by-op validation of the HTSAT+RoBERTa graph. (b) hand the model to `onnxruntime-web` /
  `transformers.js` via JS interop — gets WebGPU and quantized models today.
  **Prototype (a), ship (b) if op coverage bites.** CLAP in the browser is already a solved problem:
  `Xenova/clap-htsat-unfused` publishes ONNX weights with a quantized variant.
- **Model sizing:** ~340 MB at fp32 is not shippable in an installer. Int8-quantize to ~90 MB, and
  **split the graph** — ship only the **text tower** in the browser build (that's all you need at
  query time) and precompute audio embeddings on desktop. That turns 340 MB into ~30–60 MB. Plan a
  first-run download **with an offline-install path** — post houses are frequently air-gapped.

### 6.6 Storage and search

**Scale target: 100k–500k files (D16).** This is the sizing that everything below assumes, and it
keeps the design in its simple regime:

| At 500k files | Figure | Consequence |
|---|---|---|
| Vectors (512-dim int8) | ~256 MB | `sqlite-vec` brute force, ~50–150 ms/query. **No HNSW index needed** — the single-file property (D6) survives. |
| Peak pyramids | tens of GB | Fits Chrome (60% of disk). **Tight on Firefox** (best-effort caps at min(10% of disk, 10 GiB)) — the degraded tier may need a thinner profile. |
| Catalog + FTS5 | ~1–3 GB | Within `wa-sqlite` `OPFSCoopSyncVFS`'s validated range. |
| Pass 3 (CLAP) at ~0.5 s/file | ~70 h single-threaded, ~10 h on 8 threads | An overnight-to-weekend job. **Tolerable only because of the tiered scan** — passes 1 and 2 make the library usable long before this finishes. |

Above ~500k this becomes a different design in three places: `usearch` with mmap'd HNSW instead of
brute force, a thinner derived-data profile in the browser than on desktop, and threads promoted
from optimization to requirement. **Keep the vector backend behind a trait** so crossing that line
later is a swap, not a rewrite — but do not build for it now.

**SQLite. One file. Both platforms.**

- **Desktop:** `rusqlite` with `bundled` + `sqlite-vec`. ⚠️ **Verify FTS5 is compiled into the
  bundled build** — it is not documented on the crate page. Confirm in CI with
  `PRAGMA compile_options`.
- **Browser:** `wa-sqlite` with `OPFSCoopSyncVFS` — the current recommendation, good performance
  past 1 GB, works on recent versions of all major browsers. Caveats to design around: SharedWorkers
  **cannot** access OPFS (so: dedicated worker + cross-tab messaging); **Safari private browsing has
  no OPFS at all**; **Chrome incognito caps OPFS at 100 MB**.
- **Vectors:** `sqlite-vec` (pre-v1 — wrap behind a trait), with `usearch` as the escape hatch if we
  outgrow it (mmap'd HNSW, predicate filtering, int8/binary quantization, >4 B keys). At SFX-library
  scale (≤ ~2 M files × 512 dims) sqlite-vec's brute-force path with int8 quantization is ~1 GB of
  vectors and sub-second scans.
- **Also store a 64-dim PCA projection** of each 512-dim CLAP vector for instant fuzzy pre-filtering.

**Hybrid ranking — three arms, reciprocal rank fusion with k = 60:**

```
score = w_fts × 1/(60 + fts_rank) + w_vec × 1/(60 + vec_rank)
```

1. **BM25** over metadata text (FTS5)
2. **CLAP** text→audio embedding similarity
3. **Structured filters** — CatID, sample rate, channels, duration range, library

Critically, filters must be a **pre-filter on the vector arm** (`sqlite-vec` partition keys /
`usearch` predicates), never a post-filter. Post-filtering a k=100 KNN through "must be 96 kHz
stereo" returns nothing.

**Weight by query shape.** A query that exactly matches a CatID or library name weights BM25
heavily; a descriptive natural-language query weights CLAP heavily. A cheap classifier on the query
string picks the weights — and the weights are exposed in the UI, because Sononym proved users like
the dial.

**Storage quota is a real risk.** Chrome allows 60% of disk per origin; Firefox best-effort
min(10% of disk, 10 GiB); Safari ~60% but **deletes script-created data after 7 days with no user
interaction** when tracking prevention is on. Call `navigator.storage.persist()` on first use, and
**treat OPFS as a cache that can vanish** — never the only copy of user work.

### 6.7 Auto-classification with provenance

Propose a CatID from three independent sources and **show all three**:

1. CLAP zero-shot against the UCS subcategory + synonym vocabulary
2. Filename parse (UCS convention, or heuristic)
3. Existing embedded metadata

Let the user commit. **Never silently overwrite.** The Beck & Lerch (Georgia Tech, 2026) four-stage
cascade — curated lookup → SubCategory match → Category match → reverse synonym lookup — resolves
91–97% of files on public datasets and is the right template for mapping foreign taxonomies
(AudioSet, FSD50K, ESC-50) into UCS.

---

## 7. Where the platforms genuinely diverge

Being honest about this up front prevents promising things the browser cannot do.

| Capability | Native desktop | Browser (Chromium) | Browser (Firefox / Safari) |
|---|---|---|---|
| Open/save arbitrary files | ✅ real paths | ✅ File System Access | ⚠️ `<input>` / download only |
| **Watch and manage a library folder in place** | ✅ | ✅ persisted directory handles | ❌ **no path at all** |
| Files > 4 GB | ✅ | ⚠️ streaming only | ⚠️ streaming only |
| Native plugins (CLAP) | ✅ | ❌ | ❌ |
| WCLAP plugins | ✅ | ✅ | ✅ |
| CLAP audio embeddings computed locally | ✅ fast (CoreML/DirectML/CUDA) | ⚠️ slow, WebGPU where available | ⚠️ slow |
| ASIO / low-latency exclusive-mode audio | ✅ | ❌ | ❌ |
| Multi-threaded analysis | ✅ | ✅ with COOP/COEP | ✅ with COOP/COEP |

**Positioning that follows from this: the desktop app is the librarian; the browser is the editor.**
The browser build opens, edits, processes and exports anything. Managing a 200 GB library in place
is a desktop feature — and that is the honest reason to install the app.

Fallback for Firefox/Safari: `<input webkitdirectory multiple>` gives a flat file list with
`webkitRelativePath` — read-only, no persistence, no write-back. Good enough for "import and catalog
into OPFS," not for "manage my library."

---

## 8. The UI contract

This is the boundary for interface design. The UI never touches audio data directly — it sends
`Command`s and receives `Event`s and pre-reduced data (peak tiles, spectrogram tiles, search
results).

### 8.1 Surfaces

**v1 ships ten surfaces for a single-file editor, in the browser (D12, D13).** Track lanes, clip
drag/trim, snapping and anything mixer-shaped are explicitly out — but the editor surface must be
laid out as a **lane**, so v2 adds lanes without a redesign (§4.7).

Two things the designer must know follow from D13/D14 and are easy to miss: every flow needs a
**Chromium path and a degraded path** (persisted folder handle vs one-shot import into OPFS), and
there is a **first-run model download** of 30–60 MB before the first semantic search — that needs a
designed moment, not a spinner.

| Surface | Purpose |
|---|---|
| **Editor** | Waveform/spectrogram lane, transport, selection, edit tools, fades, markers, regions |
| **Regions** | Region list, auto-region by silence/onset/interval, per-region metadata, **batch export to catalog** |
| **Effect rack** | Chain per clip, parameter panels, presets, A/B, bypass |
| **Stretch panel** | Ratio, algorithm, formant, transient mode, quality tier, warp markers |
| **Navigator — Browse** | Folder tree, file grid/list, waveform thumbnails, instant audition |
| **Navigator — Search** | Query bar (free text + filters), the ranking-weight dial, result list with similarity scores |
| **Navigator — Inspect** | Full metadata for the selected file, editable, with provenance shown per field |
| **Navigator — Scan** | Library roots, scan progress by pass, resumable, per-folder priority |
| **Import** | Format detection, the raw/SD2 dialog with waveform-preview endianness picking, and the **degraded-tier folder import** for Firefox/Safari |
| **Export** | Format, bit depth, dither, sample rate, metadata carry-forward, batch |

### 8.2 The bus

```ts
// UI → core
type Command =
  | { kind: 'transport';  action: 'play'|'stop'|'locate'; position?: number }
  | { kind: 'edit';       op: EditOp }                    // every §4.2 operation
  | { kind: 'param';      target: NodeId; id: ParamId; value: number }
  | { kind: 'requestPeaks';  clip: ClipId; range: [number, number]; pxWidth: number }
  | { kind: 'search';     query: string; filters: Filter[]; weights: RankWeights }
  | { kind: 'scan';       roots: string[]; passes: (1|2|3)[] }
  | { kind: 'undo' } | { kind: 'redo' }
  | ...

// core → UI
type Event =
  | { kind: 'position';    frames: number }               // high rate, coalesced
  | { kind: 'meters';      peak: number[]; rms: number[] } // triple-buffered
  | { kind: 'graphChanged'; revision: number }
  | { kind: 'peaks';       tile: PeakTile }                // binary, not JSON
  | { kind: 'scanProgress'; pass: 1|2|3; done: number; total: number }
  | { kind: 'searchResults'; hits: Hit[] }
  | { kind: 'underrun';    count: number }
  | ...
```

**Transport note:** Tauri's IPC is JSON-serialized by default and will bottleneck on waveform
payloads. Peak tiles, spectrogram tiles, and audition audio go over a **custom protocol returning
raw bytes**, never `invoke()`.

### 8.3 What the designer needs to know

- Positions are **frames**, displayed as time / samples / timecode / bars — the user picks.
- Peak tiles arrive as (min, max, rms) per pixel column per channel. The waveform view should be
  designed around that data shape, including the dual envelope.
- Search results carry per-arm scores (keyword, semantic, filter), so the UI can explain *why*
  something matched. This is worth designing for — it's a trust feature.
- Metadata fields carry **provenance** (embedded / filename / inferred / user), and the UI must show
  it. Never present an inferred CatID as if it were embedded.
- The raw-import dialog is a real screen, not an afterthought — two candidate waveforms side by
  side, and the user picks the one that isn't noise.

---

## 9. TDD strategy

### 9.1 The pyramid

1. **Pure functions over buffers — the bulk, target >80% of the codebase.** Every DSP unit is
   `fn process(&mut self, input: &[f32], output: &mut [f32])` with explicit state. Plain
   `cargo test`, stable toolchain, no platform.
2. **Golden-file DSP tests.** Deterministic stimuli (impulse, sweep, white noise from a **seeded**
   PRNG — never `thread_rng`), rendered and compared against checked-in references with an explicit
   epsilon. Denormals and FMA make exact equality a trap: always tolerance-based
   (`assert_all_close(abs=1e-6, rel=1e-5)`), and pin `-C target-cpu` in CI.
3. **Property tests (`proptest`).** The highest-value invariants:
   - peak pyramid: `level[n+1]` ⊇ reduction of `level[n]`; peaks of any range ⊇ actual sample min/max
   - edit graph: `split(t)` then `join` == identity; `insert` then `delete` == identity; total
     duration == sum of segment durations
   - resampler: 48k→44.1k→48k round-trip within bounded error; DC in == DC out
   - ring buffer: producer/consumer sequences never lose or duplicate
   - format round-trip: decode(encode(buf)) == buf for every (format, bit depth, channel count)
4. **Fuzz every parser (`cargo-fuzz` + `arbitrary`).** WAV/AIFF/CAF/RIFF chunk walkers, ID3, Vorbis
   comments, iXML, resource forks, AppleDouble, our peak cache, our project file. Structure-aware
   fuzzing via `Arbitrary` for our own formats; raw `&[u8]` for containers. **A panic in WASM is an
   unrecoverable abort** — parser panics are release-blocking bugs.
5. **RT-safety as a CI gate, not a review comment.** A native test that runs `engine.process()`
   10,000 times inside `assert_no_alloc` and under `RTSAN_ENABLE=1` with `#[nonblocking]`. This is
   the single highest-leverage test in the project.
6. **WASM tests** — `wasm-pack test --headless --chrome --firefox --safari`, with
   `wasm_bindgen_test_configure!(run_in_dedicated_worker)` for the OPFS layer, since
   `createSyncAccessHandle` only exists there. **Known gap: the wasm-bindgen-test harness does not
   document COOP/COEP support, so threaded WASM tests likely need a custom test server. Spike this
   in week 1, not week 20.**
7. **Cross-host equivalence — the keystone test.** Run the same project file through the native
   renderer and the WASM renderer, hash both outputs, assert equal. This is only possible *because*
   of D3, and it is what keeps two platforms from silently diverging.
8. **The audio callback itself cannot be unit-tested** — so keep it to five lines and test the block
   adapter's ring arithmetic separately against a simulated jittery consumer (128 / 480 / 1024-frame
   pulls, random under-runs).

### 9.2 Test corpora, wired into CI

- **Toisto AIFF Test Suite** — by the author of the `aifc` crate; the most systematic AIFF
  conformance corpus available.
- **`ietf-wg-cellar/flac-test-files`** — the RFC 9639 corpus: subset/non-subset, unusual block sizes,
  32-bit, wasted bits.
- **libsndfile's test suite** and `sndfile-convert` as a **differential oracle** for every format
  both support. LGPL affects shipping, not testing.
- **Byte-level golden files for every hand-written writer** (RF64, W64, CAF, AU, `levl`, `bext`).
  Assert exact bytes, not just round-trip — **round-trip tests pass happily on two symmetric bugs.**
- **A synthesised SD2 corpus**: files with intact named forks, AppleDouble sidecars,
  AppleDouble-wrapping-a-resource-fork, and bare data forks with no metadata at all.
- Note: bwavfile's RF64 test file is **>4 GB** — budget CI disk and mark it nightly-only.

### 9.3 The first three TDD cycles

1. `RandomAccessSource` + `Cursor` impl + a chunk walker that finds `fmt `/`data` in a RIFF file.
   Red, green, refactor. No audio yet.
2. `AudioBuffer` + int↔float conversion, both directions, every bit depth, with property tests on
   round-trip and clamping.
3. WAV decode → `AudioBuffer` → WAV encode, byte-identical for PCM 16 and 24.

### 9.4 CI matrix

| Job | Runs |
|---|---|
| `cargo test --all` on stable | Linux, macOS, Windows |
| `cargo clippy -- -D warnings`, `cargo fmt --check` | Linux |
| **`cargo deny check licenses`** | Linux — **blocking** |
| `cargo test --target wasm32-unknown-unknown` via wasm-pack | Chrome, Firefox headless |
| RT-safety gate (`assert_no_alloc` + rtsan) | Linux, macOS |
| Cross-host equivalence | Linux |
| Fuzz smoke (60 s/target) | Linux — nightly, full corpus weekly |
| Differential vs libsndfile | Linux |
| Big-file tests (>4 GB) | Nightly only |

### 9.5 The architectural CI gate

Two mechanical gates, both added **before the first parser is written**:

1. **Platform-purity gate.** Grep the dependency graph of `audiolab-core` and everything below it;
   **fail the build** if `std::fs`, `memmap2`, `web_sys`, `js_sys`, `tokio`, or `cpal` appear. This
   is D3 and D5 made mechanical.
2. **Licence-boundary gate (D11).** Fail the build if any `[pub]` crate — `audiolab-io`,
   `-formats`, `-metadata`, `-buffer`, `-dsp`, `-peaks` — depends on a `[closed]` crate.
   Dependencies point one way only, and a violation caught at release time is a refactor; caught at
   commit time it's a one-line fix.

---

## 10. Roadmap

Under D13 the browser is the v1 product, so the sequence below ships web at Phase 4 and the desktop
shell at v1.1.

**Phase 0 — Foundations and gates (weeks 1–4)**

Three spikes run first. Under D13 these are **release gates, not design inputs** — each can change
what v1 supports:

1. **WASM build spike.** `realfft`/`rustfft` with `-C target-feature=+simd128` (a real 2–4× on the
   STFT path). Verify the toolchain end to end. *Gate: if SIMD is unavailable, pass 2 and 3 scan
   budgets need re-planning.*
2. **AudioWorklet spike, Safari included.** Passing a compiled `WebAssembly.Module` via
   `processorOptions` is the recommended path but has an unresolved WebKit bug. The fallback —
   postMessage raw bytes, compile in-scope — is proven. *Gate: if neither works in Safari, Safari
   drops out of the v1 matrix (D14).*
3. **COOP/COEP + `wasm-bindgen-test` harness spike.** *Gate: if threads are not viable, pass 3 is
   ~70 h single-threaded at the D16 scale target and the Navigator's first-run story changes.*

Then the foundations: `RandomAccessSource`, `AudioBuffer`, WAV read/write, peak pyramid, the
`Effect` trait, the parameter model, `cargo-deny`, both architectural CI gates (§9.5), and the
cross-host equivalence harness — which means the **native host adapter is built here**, even though
the desktop app ships much later.

Also Phase 0: the **CLA** and the published-crate release process (D11), both cheaper now than
retrofitted.

**Phase 1 — Editor MVP (weeks 5–12)**
Edit graph + command log undo. All §4.2 operations. Transport and playback both hosts. Waveform
**lane** from peaks (§4.7). WAV/AIFF/FLAC read+write with metadata. Gain, normalize, fades, SRC.
**Ship something that opens a file, cuts a bit out, and saves it — on both platforms,
bit-identically.**

**Phase 2 — Formats and metadata (weeks 13–20)**
RF64, W64, CAF, AU, raw import. **SD2 rescue including the import dialog.** Full BWF/iXML/`smpl`/
`cue` read+write. UCS filename grammar. Markers, regions, auto-region, and **batch region export**.
This is the phase that makes AudioLab worth switching to. First public release of the `[pub]` crates.

**Phase 3 — DSP (weeks 21–34)**
WSOLA (fast preview) first. **Then the signalsmith-stretch Rust port (D15), 3–4 weeks**, with the
C++ binding vendored as an A/B oracle. Render cache with two-tier quality. EQ, dynamics, FDN reverb
ported from Jot & Chaigne and Dattorro, saturation with ADAA. Latency compensation. RTPGHI as the
reference engine last — it is the differentiator, not the dependency.

**Phase 4 — Navigator (weeks 25–42, overlapping)**
`audiolab-dsp` feature extraction (the engineer-quarter). SQLite catalog with FTS5. Passes 1 and 2.
Then CLAP embeddings, `sqlite-vec` search, hybrid RRF ranking, UCS auto-classification with
provenance. Plus the **degraded-tier import flow** for Firefox and Safari (D14) — real UI work, not
an error state.

Phases 3 and 4 overlap deliberately: different crates, and the Navigator's DSP work feeds the
editor's analysis displays.

**→ v1 ships here: the browser build.**

**Phase 5 — Desktop (v1.1)**
Tauri v2 app shell: window, menus, native dialogs, file associations, drag-and-drop, auto-update.
The native host adapter and core path have been under test since Phase 0, so this is shell work, not
a port. Native folder watching lifts the Chromium-only constraint on library management.

**Phase 6 — Plugins and depth**
CLAP hosting via `clack-host`. WCLAP prototype. Restoration suite. Convolution reverb. Spectrogram
editing. Multi-lane timeline (the v2 half of D12).

---

## 11. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
**Under D13 (browser first), risks 1, 2, 5, 7 and 12 are launch blockers rather than v1.1 concerns.**
They are marked 🚦 below.

| 1 | 🚦 **4 GB WASM ceiling, no usable memory64 in Rust** (Tier-3 target, wasm-bindgen unsupported, 10–100% slower anyway) | **Critical** | D4. Edit-list + windowed streaming from day one. Not retrofittable, and now not deferrable either. |
| 2 | 🚦 **File System Access is Chromium-only** — Firefox's position is "harmful," Safari never shipped pickers | **Critical** | D14: Chromium full, others import-only. Design the degraded flow as a real surface (§2.5). Desktop lifts this at v1.1. Do not promise folder sync on Safari, ever. |
| 3 | **Every mature MIR library is copyleft** | **Critical** | Accepted, not mitigated — D11 chose open core, so `audiolab-dsp` is written in-house. Budget one engineer-quarter. `cargo-deny` from commit one. Note this cost would **not** have been avoided by going GPL: those libraries are C/C++ and can't reach the WASM build (§2.4). |
| 4 | **Rubber Band's licence** — GPL or paid commercial, App Store distribution explicitly requires the commercial licence | High | Never link it, not even for testing. Port MIT signalsmith-stretch instead. |
| 5 | 🚦 **Cross-origin isolation tax** — COOP/COEP breaks third-party embeds; `Document-Isolation-Policy` is Chrome-137-desktop-only | High | Core works single-threaded when `crossOriginIsolated === false`. Runtime check, not compile-time assumption. Phase 0 gate 3. |
| 6 | **Nightly + `-Z build-std` for WASM threads** is a permanent CI liability | High | Core builds on stable; `parallel` is additive. Pin nightly in `rust-toolchain.toml`, treat bumps as scheduled work. |
| 7 | 🚦 **Passing a `WebAssembly.Module` into an AudioWorklet in Safari** — WebKit bug status unknown | High | Spike week 1 (Phase 0 gate 2). Fallback path (raw bytes, compile in-scope) is proven. If both fail, Safari leaves the v1 matrix — a scoping call, not a bug. |
| 8 | **Tauri on Linux is WebKitGTK**, often years behind (Ubuntu 22.04 ≈ Safari 15); no WebGPU | High | Never route audio through the webview. Canvas2D default. Consider bundling a newer webkit2gtk. |
| 9 | **signalsmith-stretch is C++**, will likely not build for `wasm32-unknown-unknown` | High | Port the algorithm to Rust (MIT permits it). Keep the binding as an A/B oracle. |
| 10 | **Three load-bearing deps are pre-1.0** — `ort` 2.0-rc, `sqlite-vec` pre-v1, `opus-rs` 0.1.x | Medium | Wrap each behind a trait. Conformance-test `opus-rs` against RFC 6716 vectors before shipping. |
| 11 | **CLAP model distribution** — 340 MB fp32 is unshippable | Medium | Int8 quantize (~90 MB), split towers (text-only in browser), first-run download with an offline-install path. |
| 12 | 🚦 **OPFS quota and eviction** — Safari deletes after 7 days of no interaction; Chrome incognito caps at 100 MB; Firefox best-effort caps at min(10% disk, 10 GiB) | **High** under D13 | `navigator.storage.persist()` on first use. OPFS is a cache that can vanish, never the only copy of user work. At D16 scale the peak cache is tens of GB — the degraded tier may need a thinner derived-data profile (§6.6). |
| 13 | **rtsan has no WASM support** — browser RT-safety is unverifiable by tooling | Medium | Keep the worklet shim <100 lines. Verify natively. Ship under-run counters. |
| 14 | **Tauri IPC is JSON** — bulk peak/spectrogram transfer will bottleneck | Medium | Binary custom protocol. Benchmark before designing the UI data flow. |
| 15 | **UCS has no machine-readable canonical source** | Low | Vendor, checksum, publish our normalized JSON as an open-source contribution. |
| 16 | **Symphonia's CAF demuxer is rated only "Good"** | Low | Plan to contribute fixes upstream or write our own. |

---

## 12. Decisions still open

### Resolved

- ✅ **D11 — Licence model → open core.** Six lowest crates MIT/Apache-2.0, everything above
  proprietary. Rationale in **§2.4**. GPL rejected because its payoff is in C/C++ libraries that
  cannot cross the WASM boundary, and using them would break the cross-host equivalence test.
- ✅ **D12 — v1 editing scope → single-file, lane-shaped.** Detail in **§4.7**. Regions, markers
  and batch region export ship in v1; lanes, clip drag/trim, snapping and summing defer to v2.
- ✅ **D13 — Browser ships first, desktop at v1.1.** Detail in **§2.5**. Native host adapter still
  built in Phase 0 for the equivalence test; only the Tauri shell defers.
- ✅ **D14 — Chromium full, Firefox and Safari import-only.** Matrix in **§2.5**. The degraded flow
  is a designed surface, not an error state.
- ✅ **D15 — Port signalsmith-stretch to Rust up front**, Phase 3, 3–4 weeks. Detail in **§5.1**.
- ✅ **D16 — Catalog scale target 100k–500k files.** Sizing table in **§6.6**. Keeps `sqlite-vec`
  brute force and the single-file property; vector backend stays behind a trait.
- ✅ **MP3 → decode yes, encode no.** Patents expired 2017, but every usable encoder binding is
  LGPL, and WASM has no dynamic linking, so LGPL is effectively GPL there.
- ✅ **CLA → adopt day one**, alongside the first published crate. Retrofitting means chasing every
  past contributor, and without one, dual-licensing later is impossible.
- ✅ **CLAP model delivery → int8-quantized, split towers** (text encoder only in the browser),
  first-run download with an offline-installer path for air-gapped facilities.

### Deferred by design

Not open questions — decisions that require a measurement that does not exist yet.

1. **Native-Rust GUI fallback for Linux.** Keep the wgpu waveform renderer separable so it could be
   composited under a transparent webview region if WebKitGTK's canvas proves too slow. Decide after
   the Phase 5 desktop work, on measured numbers. Irrelevant to v1 under D13.
2. **`sqlite-vec` vs `usearch`.** D16 sets brute force as primary. Revisit only if the library grows
   past ~500k files or `sqlite-vec` fails to reach 1.0 before Phase 4. The trait boundary makes this
   a swap.
3. **Safari's place in the v1 matrix.** Determined by Phase 0 gate 2, not by preference.
4. **Whether pass 3 is viable at launch.** Determined by Phase 0 gate 3. If threads fail, the
   Navigator ships with passes 1 and 2 and CLAP embeddings become a v1.1 feature.

**No open decisions remain that block interface design.** §8 is ready for handoff.

---

## Appendix A — Approved dependencies

MIT / Apache-2.0 / BSD / ISC / Zlib / Unicode-3.0 / MPL-2.0 only. Enforced by `cargo-deny`.

Under D11 this allowlist is doubly load-bearing: the six published crates are MIT/Apache-2.0
themselves, so a copyleft dependency anywhere beneath them is not just a shipping risk but a
licence contradiction in a crate we publish.

**Core:** `symphonia` (MPL-2.0, decode), `bwavfile` (MIT, vendor it — 3 years stale), `aifc`
(MIT/Apache, AIFF r/w), `flac-codec` (MIT/Apache), `hound` (Apache-2.0), `ogg` (BSD-3),
`opus-rs` (BSD-3, gate on conformance), `rustfft` + `realfft` (MIT/Apache), `rubato` (MIT/Apache),
`ebur128` (MIT), `dasp` (MIT/Apache), `biquad` (MIT/Apache), `fft-convolver` (MIT)

**Runtime:** `cpal` (Apache-2.0), `creek` (MIT/Apache), `rtrb` (MIT/Apache), `triple_buffer`,
`assert_no_alloc`, `rtsan-standalone` (dev), `wgpu` (MIT/Apache), `wasm-bindgen` / `web-sys`,
Tauri v2 (MIT/Apache)

**Catalog:** `rusqlite` bundled (MIT), `sqlite-vec` (MIT/Apache, pre-v1), `usearch` (fallback),
`ort` (MIT/Apache) desktop, `tract` (MIT/Apache) browser, `id3` (MIT), `lofty` (unified tags)

**Plugins:** `clack-host` (MIT/Apache), later `wasmtime` for WCLAP

**Banned:** libsndfile (LGPL-2.1, static linking prohibited), Rubber Band (GPL/commercial),
SoundTouch (LGPL-2.1), aubio and every binding (GPL-3.0), bliss-audio (GPL-3.0), Essentia
(AGPL-3.0 + non-commercial models), `pvoc` (GPL-3.0), `oxisynth` (LGPL-2.1), `wav` crate (LGPL-3.0),
`mp3lame-encoder` (LGPL-3.0), libfdk-aac (non-OSI + patent disclaimer), VST3 SDK (GPL-3.0 or
Steinberg agreement)

---

## Appendix B — Primary sources

**Time and pitch**
Verhelst & Roelands, "An Overlap-Add Technique Based on Waveform Similarity (WSOLA)," ICASSP 1993 ·
Laroche & Dolson, "Improved Phase Vocoder Time-Scale Modification of Audio," IEEE TSAP 1999 ·
Průša & Holighaus, "Phase Vocoder Done Right" (PGHI/RTPGHI), EUSIPCO 2017 ·
Serra & Smith, "Spectral Modeling Synthesis," CMJ 1990 ·
Luff, "The Design of Signalsmith Stretch," 2023

**Effects**
RBJ Audio EQ Cookbook · Orfanidis, "Digital Parametric Equalizer Design with Prescribed
Nyquist-Frequency Gain," JAES 1997 · Jot & Chaigne, "Digital Delay Networks for Designing Artificial
Reverberators," AES 1991 · Dattorro, "Effect Design Part 1–3," JAES 1997 · Gardner, "Efficient
Convolution Without Input-Output Delay," JAES 1995 · Bilbao, Esqueda, Parker & Välimäki,
"Antiderivative Antialiasing for Memoryless Nonlinearities," IEEE SPL 2017

**Analysis**
ITU-R BS.1770 / EBU R128 · Böck & Widmer, "Maximum Filter Vibrato Suppression for Onset Detection"
(SuperFlux), DAFx 2013 · de Cheveigné & Kawahara, "YIN, a fundamental frequency estimator," JASA
2002 · Brown & Puckette, "An efficient algorithm for the calculation of a constant Q transform,"
JASA 1992

**ML and taxonomy**
Wu et al., "Large-scale Contrastive Language-Audio Pretraining" (LAION-CLAP), ICASSP 2023 ·
Kong et al., "PANNs," IEEE/ACM TASLP 2020 · Beck & Lerch, "Sound Effects Dataset Unification With
the Universal Category System," arXiv 2606.05571, 2026 · Sony AI, "Woosh-CLAP," arXiv 2604.01929,
2026 (verify licence)

**Formats**
EBU Tech 3285 (BWF) · EBU Tech 3306 (RF64) · RFC 9639 (FLAC) · RFC 6716 (Opus) ·
Digidesign Sound Designer II specification · Apple Core Audio Format specification ·
UCS v8.2 category list

**Plugins and platform**
CLAP specification (MIT) · `free-audio/web-clap` WCLAP draft (MIT) · Buffa et al., "Web Audio
Modules 2.0," WWW Companion 2022 · BBC `audiowaveform` DataFormat.md · REAPER `reapeaks.txt`
