# Wave: the wavetable synth page. Architecture

*Draft 1, 7 Nov 2026. It is based on `research.md` (synths and DSP), `style-research.md` (look and controls) and `codebase-map.md` (MultiGrainLive as it is). Nothing here is built. The mock-ups come next, and the build waits for RJ's approval of mock-up v3.*

**The rule that shapes everything: show, don't tell.** Every control draws what it does to the sound. Labels are second.

---

## 1. What it is

A new page, **Wave**, on MultiGrainLive's left rail. It is a polyphonic wavetable synth that plays from MIDI, the on-screen keyboard and the computer keyboard. Its sound goes through its own FX rack, made from prism-fx effects, into the master. It also has a **wavetable creator**: draw, paint harmonics, process, morph, and import any sound from the library. A sound you play can go back into the library with one button.

The library tie-in makes it MultiGrainLive's synth rather than a generic one:
- **Library → table.** Any sound, or its loop region, becomes a wavetable. This is `docs/WAVETABLE-MODE.md`'s idea: the region is baked through the grain engine first, so its granular character survives into the tone.
- **Table → library.** "Print" records what you play, and the result arrives in the library tagged and placed on the map like any other sound.

## 2. Feature set for v1

This is the research report's MUST list (§5), trimmed to what makes one great instrument. Items marked *(v1.x)* are designed for now and built later.

| Area | v1 |
|---|---|
| **Oscillators** | 3 wavetable oscillators (A, B, C), plus a Sub (sine/tri/square, −1/−2 oct) and a Noise (coloured noise tables). Per oscillator: octave, semitones, fine, pan, level, phase plus random, free-run, and a route to Filter 1 / Filter 2 / both / direct. Position interpolation: Stepped / Crossfade / Smooth / Spectral. Quality: Draft / Normal (2×) / HQ (4×). |
| **Tables** | 2048 samples × up to 256 frames. Import frames of 64–4096 samples, resampled to 2048 in the spectrum. Mip levels are built off the audio thread and swapped in. |
| **Warps** | Two warp slots per oscillator, each with an amount and a unison spread. **Phase warps:** Sync, Window Sync, Formant, Bend ±, Squeeze, Asym ±, PWM, Mirror, Flip, Quantize, Remap (a drawn curve). **Between oscillators:** FM (linear, through zero), PM, AM, RM, from any oscillator, the sub, noise or a filter output. Fold and Saturate *(v1.x: Vital's spectral morphs)*. |
| **Unison** | 1–16 voices per oscillator. Detune with a range, and a curve (Linear / Super / Exp / Inv / Random plus a continuous power). Blend with constant loudness. Width. Per-voice spread of position and warp. Random phase. *(v1.x: stacks and chords)* |
| **Filters** | 2 filters, routed serial, parallel or split, with a per-oscillator balance. Models: SVF 12/24 (LP, BP, HP, Notch, Peak, Morph), Ladder, Diode, Comb ±, Formant (vowel). Drive, keytrack. |
| **Modulators** | 4 envelopes (DAHDSR, a curve on each segment, loop modes). **4 LFOs behind 4 buttons** (RJ, 7 Nov), each drawable, with the modes Free / Trigger / Sync / Envelope / Loop, a rate in Hz, tempo or key, plus rise, delay and smooth. 8 macros. Velocity, note, aftertouch, mod wheel, pitch bend, random per note. |
| **Modulation** | Drag a source onto any control. Each control shows a single-pass ring with a live dot. There is also a matrix with 64 rows: source, via, amount, a curve per row, uni/bi, bypass and destination. |
| **Voicing** | Poly (up to 32), Mono, Legato, Glide (time or rate, a curve), voice stealing, MPE, pitch-bend range, scale quantise using the app's `fx::tuning::SCALES`. |
| **FX** | The prism-fx rack the app already has: the same slots, the same 86 effects, in a `synth:<patch>` document. |
| **Creator** | Draw (freehand, line, curve, points with power handles, shapes, snap). Harmonic magnitude and phase bars. Process each frame or all frames (normalise, remove DC, flip, zero-cross, fade edges, FFT filter, redux, fold, slew, align phases). Morph-fill between keyframes (Crossfade / Spectral / Zero-phase). Insert, remove, reorder, sort by brightness, reverse. A formula field (Serum's grammar). Import (a library sound, a loop region baked through the grain engine, a file, multiple single cycles, Serum `clm`, `.wt`, WaveEdit), with frame-size modes: by count, by note, pitch-follow, FFT. Export as a Serum-compatible WAV. Undo/redo. *(v1.x: Vital-style non-destructive layers with keyframes)* |
| **Presets** | Patches with tags and search. Browse with the mouse wheel. A/B compare. |

## 3. Engine: a new crate, `core/crates/wave`

**Pure DSP with no I/O and no dependency on the server.** It depends only on prism-fx and `realfft`. It is added to the workspace and to the `opt-level = 3` dev-profile list. Its starting point is idMLab's `rust/dsp-core` (`bank.rs`, `voice.rs`, `envelope.rs`, `lfo.rs`, `modmatrix.rs`), which already depends only on prism-fx. That code is ported, not linked, because the two apps evolve separately.

```
wave/src/
  table.rs      Wavetable { frames: Vec<[f32;2048]>, mips: Arc<MipSet> }, built with realfft; 11 levels,
                each 2048 samples wide down to a floor of 256, padded for wrap, DC removed at build.
  mip.rs        pick level from inc·warp_slope, fractional crossfade between levels L and L+1
  osc.rs        u32 phase, cubic Hermite read, frame crossfade, unison (SIMD across voices, `wide::f32x8`)
  warp.rs       phase warps g(φ) with g′max for level choice; FM/PM/AM/RM inputs; DC blocker after warps
  oversample.rs 2×/4× polyphase half-band decimator
  filter.rs     SVF, ladder, diode, comb, formant (or prism-fx's, where it already has the model)
  env.rs, lfo.rs, macro.rs, modmatrix.rs     (from idMLab dsp-core)
  voice.rs      one note: 3 osc + sub + noise → 2 filters → amp env; mod state per voice
  bank.rs       VoiceBank: fixed capacity 32, note_on/off, steal oldest/quietest, legato/glide, MPE per-note
  patch.rs      Patch (every parameter by key) + Routing (mod rows); JSON through the app's json crate
  render.rs     Synth::render(out, frames) with events (note on/off, CC, MPE) applied at the right frame
```

**Real-time rules, the same as the engine's.**
- Nothing on the audio thread allocates, locks or does an FFT.
- Tables, mip sets, routings and patches are built on a worker and handed over through `pending_*` slots, as `pending_rack` already is.
- A replaced table is passed to a drop thread, never freed in the callback.
- Parameter moves arrive as `(key, value)` writes into a fixed ring, are smoothed for 15 ms, and are read at control rate (every 32 frames). Audio-rate sources (FM, envelopes, LFOs under 1 kHz) run per sample.

**Where it plays: a third deck.** `Decks { main, prism, synth }`.
- The synth deck is **always running**: there is no transport, and it renders whenever voices are sounding.
- Its output goes through its own FX rack, the existing `fx` rack type with crossfaded swaps.
- It is summed **before** the master soft ceiling, scope, meters and capture, so it is heard, metered and recorded like everything else.
- The Prism deck currently misses all of that (`decks.rs`, noted in the map). Fixing it belongs in the same change, as one small adjacent fix.

**Notes in.**
- **MIDI:** add `midir`. A MIDI thread parses notes, CC, pitch bend, aftertouch and MPE into a lock-free SPSC event queue. Each event is stamped with the device frame it should land on.
- **On-screen keyboard and QWERTY:** `POST /api/wave/note`. HTTP adds a few milliseconds, which is fine for auditioning; real playing uses MIDI.
- The computer keyboard goes through the app's single keydown dispatcher (`320-keyboard.js:376`). While Wave is the page, the Keys layout plays Wave notes instead of pitch-shifting the grain deck.

**Export: invariant 11, "what you hear is what you export".**
- The synth has no "source" to render offline. What it exports is a **take**: notes and parameter moves recorded with their frames.
- Print renders the take through the same `wave` crate offline, so the export matches the speakers sample for sample, with the same seeds and the same tables.
- Test: play a take live into capture, render it offline, and compare them within a tolerance.

## 4. Server: `/api/wave/*` routes in the same `match`

| Route | Does |
|---|---|
| `GET /api/wave/patch` · `POST /api/wave/patch` | The whole patch. A POST rebuilds the routing off the audio thread. |
| `POST /api/wave/param` | `{key, value, live?}`. `live:true` means heard, not stored, as with `/api/rack/param`. |
| `POST /api/wave/note` | `{note, vel, on}` |
| `GET /api/wave/state` | Telemetry at about 30 Hz for the screen: voices sounding, per-voice position, envelope stage and LFO phase, the modulated value of each ringed control, output meters. |
| `GET/POST /api/wave/table/:osc` | Frames as f32 PCM. A POST rebuilds the mips on a worker. |
| `POST /api/wave/table/import` | From `{sound}`, `{sound, region, baked:true}` or a file, with `{mode: count, note, pitch, fft}`. |
| `GET /api/wave/table/export` | A WAV with a `clm ` chunk |
| `GET/POST /api/wave/presets` | List, save, tag, delete. Remove means unlist, never delete. |
| `POST /api/wave/print` | Render the last take into the library. |

**Data dir.** `wave/patches/*.json`, `wave/tables/*.wav` (a Serum `clm` WAV, so the tables open in other synths), and `wave/tables/*.recipe.json` (the creator's edit history, kept for v1.x layers).

## 5. UI: one page, four views, one control kit

**Page.**
- A rail item `data-page="wave"` and a body class `wavepage`.
- It does **not** need an open sound, so it is not in `EDIT_PAGES`.
- The centre area holds the instrument. The dock holds the keyboard strip and the macros, so they stay in reach from every view.

**Views.** These are tabs in the page header. No view scrolls; each fits the centre at 1440×900.
1. **Play.** Osc A/B/C, Sub, Noise, Filters 1–2, Amp env, a modulator area (4 envelopes behind 4 buttons, 4 LFOs behind 4 buttons), the 8 macros, and voicing.
2. **Create.** The wavetable creator for the chosen oscillator: a large frame editor, harmonic bars, a frame strip/keyframe lane, tools, process, morph and import.
3. **Matrix.** The 64 rows, each with its curve.
4. **FX.** The app's rack, in the new look.

**The control kit: the part that rolls out to the rest of the app if RJ likes it.**
- Files: `ui/app/5xx-kit-*.js` plus `ui/kit.css`. Its tokens are separate from the page's.
- Every control has a fixed footprint: a picture slot, a body, and a readout slot sized for its widest value. Nothing is ever cut off, and modules never change width.
- One rAF scheduler draws only what is dirty or moving.

| Control | Shows |
|---|---|
| `kit.knob` | Cap, single-pass value arc, mod arc, live dot. A *face* variant whose centre is a small screen: the warp knob shows the warped wave, the phase knob shows the wave around a circle. |
| `kit.wave3d` | The table as a 3D waterfall, with the current frame lit and per-voice playheads. Drag it to scan. |
| `kit.strip` | The frames as thumbnails, with the playhead and the mod bracket. It also picks frames in Create. |
| `kit.fan` | Unison as stacked waves. Drag for detune and width; scroll for the voice count. |
| `kit.lens` | The filter curve over the oscillator's real harmonics. Drag for cutoff and resonance. |
| `kit.ridge` | An envelope you shape by dragging its curve, with voice dots running along it. |
| `kit.loop` | An LFO shape you draw, with phase dots. |
| `kit.silhouette` | A fader filled with the sound's own shape |
| `kit.glyph` | Every other slider: a picture that changes with the value |
| `kit.puck` | Two-axis morph, which leaves a trail when modulated |
| `kit.tabs4` | The four-button switcher for LFOs and envelopes |

**Live state.**
- The UI never runs modulation itself; that is unlike the Prism LFO module, which sends from the page.
- The engine runs the LFOs and envelopes. The page reads `/api/wave/state` at 30 Hz and draws dots and rings from it.
- That keeps what you see true to what you hear (WITNESS.md's rule).

## 6. Tests

- **Rust, `wave` crate:**
  - every mip level has no energy above its band;
  - a sweep from 20 Hz to 20 kHz stays below −90 dBFS of aliasing in Normal quality;
  - every warp is the identity at 0;
  - unison loudness is constant across blend;
  - the voice bank's stealing order;
  - a seeded render matches a golden file;
  - offline print equals live capture.
- **Server:** routes with the `Scratch` harness, `live:true` not stored, a `clm` WAV round-trips.
- **Playwright (one worker, scratch server 8791, device routes mocked):** the page opens; every control draws; drag-to-modulate makes a ring; Create draws, and the frame shows on the strip; nothing is truncated, and every module keeps its fixed width (the `design-pass` checks extended to the kit).

## 7. Build order (once the mock-up is approved)

1. The `wave` crate core: table, mips, osc, unison, the phase warps, filters, env/LFO/matrix, voice bank, with tests.
2. The third deck, MIDI, the `/api/wave` routes, and the patch and table files.
3. The kit and the Play view. RJ plays it.
4. Create (the creator), import and export.
5. Matrix, FX, presets, Print.
6. v1.x: spectral morphs, layers with keyframes, stacks and chords.

## 8. Open questions (each answered in the mock-ups, not by asking)

- The page name: **Wave** for now.
- Should the keyboard live in the dock or under the instrument? Mock-up v1 tries the dock.
- How much of Create fits beside Play? v1 gives it its own view; v2 will try a split.
