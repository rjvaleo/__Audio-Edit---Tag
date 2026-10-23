# Pluggo: instruments, analysis and utilities

*22 October 2026. Spec — not built. Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md).*

Thirty Pluggo 3.6.1 plug-ins (Cycling '74; reference manual dated 2006),
none of which is an ordinary audio effect: twenty-three instruments, the
Generic Effect template, four displays (beatN, D-Meter, Light Organ, Phase
Scope) and three routing utilities. **The patches could not be read.** In 28
of the 30, the `mxfr` resource starts with the same encoded header
(`EEY94W67ARU39AEHKQH36EAH42YHHHH…`) and decodes to binary, not Max text. They
are stored in Pluggo's protected form, so every `ui.txt` is empty and no
object positions exist. Only Generic Effect decodes. D-Meter and Phase Scope
have no patch at all. So the sources for this batch are the parameter tables
(`Mpf2`), the preset banks (`Mpst`/`Mpnm`), the reference manual and its
screenshots. Signal flow goes no further than those. Anything beyond them is
marked *inferred*. Positions are regions read from the screenshots, and panel
sizes are the screenshot sizes in pixels. The preset tables for fm 4-op,
moving waves and xmod synth have misaligned columns (values like 5×10²⁶), so
no defaults are taken from them. **Only Generic Effect belongs in the rack.**
Everything else maps to the sequencer voice, the granular engine, the master
bus or the visualiser, or to a new instrument voice. Those new voices group
into six kinds, so the batch needs six new voices rather than seventeen.

| Plug-in | Here | Shared-panel pad pair (X / Y) |
| --- | --- | --- |
| additive heaven | New — Additive voice | `ratio2` 0.5–4 / `releaseMs` 5–4000 log |
| analogue drums | New — Drum synth voice | `kickHz` 30–100 / `kickDecayMs` 50–2000 log |
| analogue percussion | New — Drum synth voice (perc model) | `p1Ratio` 0–12.7 / `p1PitchDepth` 0–1 |
| bassline | Adjust — Seq voice | `cutoff` 50–5000 Hz log / `res` 0–0.95 |
| beatN | Not applicable | — |
| big ben bell | New — FM voice | `stereo` 0–1 / `decayMs` 200–8000 log |
| deep bass | Adjust — Seq voice + step grid | `cutoff` 50–5000 Hz log / `famt` 0–1 |
| easy sampler | New — Kit voice (one pitched pad) | `tuneCents` ±100 / `releaseMs` 0–6000 |
| filtered drums | New — Kit voice | `cutoffHz` 50–10000 log / `drive` 0–1 |
| flying waves | Adjust — Prism pad on engine targets | level 0–1 / `stretch.semitones` ±(span×6) |
| fm 4-op | New — FM voice | `ratio2` 0.5–8 / `feedback` 0–1 |
| harmonic dreamz | New — Additive voice | `tremHz` 0.1–2000 log / `tremDepth` 0–1 |
| lofi drums | New — Kit voice | `cutoffHz` 50–10000 log / `res` 0–1 |
| moving waves | New — Wave voice (vector) | `x` 0–1 / `y` 0–1 (the original joystick) |
| pgs-1 | New — Analog multi voice | `f1Hz` 100–8000 log / `f1Q` 0.5–12 |
| qsynth | New — Analog multi voice (parallel) | `f2Hz` 100–8000 log / `f3Hz` 100–8000 log |
| quick drums | New — Kit voice | `pad1Level` 0–1 / `pad2Level` 0–1 |
| shape synth | Adjust — Seq voice | `shape` 0–1 / `shapePhaseDeg` 0–180 |
| Sine Bank | New — Additive voice (free mode) | `spread` 0–2 / `transpose` 0.5–2 |
| vocalese | New — Kit voice (phoneme set) | `speed` −1–1 / `cutoffHz` 200–12700 log |
| wavy waves | New — Wave voice (sequence) | `lRateHz` 0.1–100 log / `rRateHz` 0.1–100 log |
| white grains | Adjust — granular engine | `stretch.windowMs` 5–200 log / `stretch.grain.pitchJitterSemis` 0–12 |
| xmod synth | New — Analog multi voice (matrix) | `f1Hz` 100–8000 log / `mod1Amt` 0–1 |
| Generic Effect | Adjust — ModDelay, new `Generic` mode | `ffRateHz` 0.01–50 log / `ffDepthMs` 0–20 |
| D-Meter | Adjust — master-bus VU panel | — (display) |
| Light Organ | New — visualiser view | `sensitivity` / `fade` (view targets; open) |
| Phase Scope | Exists — master-bus Lissajous + correlation | — (display) |
| PluggoBus Send | Not applicable | — |
| PluggoBus Rcv | Not applicable | — |
| PluggoSync | Not applicable | — |

## Where the instruments go

**There is no MIDI here.** Notes come from the sequencer's step grid: each
step has a scale degree, an octave and a rest. The engine plays the
document's file along its own timeline. So three things on nearly every
Pluggo synth have no direct meaning: *Pitch Bend Range*, *Mod Wheel Range* and
*Polyphony*. Each is listed under the original interface below and dropped
from the tables. Where the mod wheel was wired to one setting (a ratio, a
waveshape, a filter), that setting is an ordinary control here, so automation
lanes and the pad can move it.

**Existing homes.**
- **Seq voice** — the scale sequencer's synth (`ui/sequencer/`, docs/SEQUENCER.md):
  one oscillator per step (sine, triangle, saw, square, pulse with PW), amp
  ADSR (`atk dec sus rel`), one 12 dB low-pass (`cutoff res`, `keyFollow`),
  filter ADSR with a bipolar amount (`fatk fdec fsus frel famt`), three LFOs
  (sine/tri/saw → filter, reso, volume, PW, delay wet), tape delay, reverb, a
  1–16-step grid, BPM 40–240, step lengths 1/16–1/2 and four directions. It
  plays through the engine on the shared transport.
- **Granular engine** — Stretch, Pitch ±48 semitones, Window 5–2000 ms,
  position, rate, jitter and drift, all as automation targets
  (`STRETCH_TARGETS`).
- **Master bus / visualiser** — `/api/engine/master`: band spectrum up to
  2,048 bands, raw L/R pairs, a 300 ms RMS VU with a fast peak, and
  correlation.

**Proposed new voice kinds**, each a table of controls in `ParamSpec` shape:
- **Additive** — up to 32 partials, each with level, ratio (or Hz) and pan.
- **FM** — four operators with breakpoint envelopes and eight routings.
- **Analog multi** — three oscillators, up to three multimode filters, two
  ADSRs and two ARs, two LFOs, and a source/amount on each destination.
- **Wave** — oscillators that read single-cycle tables, with two players:
  vector (XY crossfade of four) or sequence (16 steps).
- **Drum synth** — synthesised kick, snare, hat and toms, plus a four-voice
  FM/noise percussion model.
- **Kit** — one sample per pad from the library, with an optional bus through
  drive and a filter.

That is six kinds. Kit and Additive are the cheapest and together cover eight
plug-ins.

**Sample content cannot be copied.** The drum samples, the phoneme recordings,
the 707/808/909 lo-fi sets and the 28 "digital waves" (w0–w27) all belong to
the original. Kits load from the library. Wave tables are generated here or
loaded as single-cycle files.

**Batch-level open questions.**
- **Where do the new voices live?** One option is extra voices on the Seq page
  (JS), which already has the transport, the grid and the route into the
  engine. The other is Rust sources beside the engine. The tables below are in
  `ParamSpec` form so either home can take them.
- **The Prism pad on a voice.** HYPERPRISM.md's pad drives rack slots and the
  engine's Time & Pitch pair. A voice needs a third kind of entry, which would
  send through the sequencer bridge.
- **Breakpoint envelopes.** analogue percussion, fm 4-op, qsynth, pgs-1 and
  white grains store their envelopes as point lists, which are not scalar
  controls. They fit the shape of automation-lane points, but a lane is tied to
  the document clock. These envelopes restart on every note.

---

## Instruments

### additive heaven
*Pluggo 3.6.1, Cycling '74, 2006 · Max/MSP VST, protected patch · params.tsv, presets.tsv (32), manual pp. 6–7, screenshot p006-0*

An additive synth with eight voices, each with its own level, frequency ratio
and pan, under one shared ADSR. Voice 1 is fixed at the played pitch, and the
other seven range from 0.1× to 10×, so tones run from harmonic to clangorous.
What sets it apart is the per-voice pan: a bell or pad gets width from where
its partials sit, not from chorus or delay.

**Original interface.** 420×212, blue. Eight numbered voice columns run left
to right, each with a pan dial on top. Column 1 has a single level slider
marked `vol`. Columns 2–8 have two sliders, `v` (level) and `h` (harmonic),
with a number box under them showing the ratio (the shot shows 1., 3., 0.75,
2., 8., 8., 3.). To the right is an `adsr env` block of four sliders, and at
the far right a `vol` dial.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Pan 1–8 | dial | L–R (64 = centre) | per preset | top of each column |
| Harmonic volume 1–8 (`level_01–08`) | slider | 0–100 % | Thriftshop: 100/40/15/13/42/47/22/28 % | column, left slider |
| Harmonic 2–8 (`harmonic_02–08`) | slider + number | 0.1×–10× (curve not stated) | per preset | column, right slider |
| Attack | slider | 2–8002 ms | per preset | adsr env |
| Decay | slider | 2–6002 ms | per preset | adsr env |
| Sustain | slider | 0–100 %, scaled by velocity | per preset | adsr env |
| Release | slider | 5–10 005 ms | per preset | adsr env |
| Volume | dial | 0–100 % | per preset | far right |
| Pitch Bend Range | hidden | 2–12 semitones | — | global |
| Mod Wheel Range | hidden | ±100 %, moves harmonic 2 | — | global |
| Polyphony | hidden | 1–32 | — | param table only |
| Presets | menu | 32 | — | Thriftshop sounds, Dinner Bell, Outside Windbells, Churchtops, Gated Walls, … |

**Signal flow.** For each note, eight oscillators run at the note frequency
times their ratio. Voice 1's ratio is always 1. The manual does not say what
waveform they use; sine is *inferred*. Each voice is scaled by its level and
panned, the eight are summed, and the sum is shaped by the ADSR. Sustain is
multiplied by velocity. The mod wheel offsets voice 2's ratio. The manual's
header lists the output as mono, but per-voice pan needs a stereo output.

**Here.** New (instrument) — **Additive voice**. The engine is the wrong home,
because it reads a file and this generates sound. This table defines the
Additive kind. harmonic dreamz and Sine Bank add to it.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `count` | Partials | 1–32 | 8 | no | |
| `level1`…`level32` | Level n | 0–1 | 1, then 0 | no | |
| `ratio2`…`ratio32` | Ratio n | 0.1–10 | n | yes | × |
| `pan1`…`pan32` | Pan n | −1–1 | 0 | no | |
| `attackMs` | Attack | 2–8000 | 2 | yes | ms |
| `decayMs` | Decay | 2–6000 | 500 | yes | ms |
| `sustain` | Sustain | 0–1 | 0.8 | no | |
| `releaseMs` | Release | 5–10 000 | 300 | yes | ms |
| `volume` | Volume | 0–1 | 0.8 | no | |

**Shared panel.**
1. **Partials** (primary) — one column per active partial, in the original's
   order: pan dial, level slider, ratio slider with a number.
2. **Envelope** — four sliders.
3. **Output** — volume dial.

A partial display (ratio across, level up, pan as colour) sits above the
columns. Prism pad: X `ratio2` 0.5–4, Y `releaseMs` 5–4000.

**Tests.**
- With only partial 1 at level 1, the output is one spectral peak at the note
  frequency, and nothing else rises above −60 dB.
- With `ratio2` = 2 and `level2` = 1, a second peak appears at 2f.
- With `pan1` = −1, the right channel is silent while only partial 1 sounds.
- After note-off, the level falls 60 dB within `releaseMs` + 10 %.

**Open questions.**
- What waveform does each voice use (sine is assumed)?
- What curve does the harmonic slider follow from 0.1× to 10×?

### analogue drums
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (16), manual pp. 8–10, screenshot p008-0*

A synthesised analogue-style kit: kick, snare, hi-hat (closed and open) and
three toms, with no samples. Each voice has a few shaping controls, such as
the kick's tone sweep and attack click and the snare's snap and high cut.
Pads and lights on the panel let you play it without MIDI.

**Original interface.** 381×236, yellow. The top band has four boxed groups
headed `bass`, `snare`, `hihat` and `toms`, with dials in 2×2 blocks:
- bass: `tune` `tone` / `dec` `att`;
- snare: `tune` `snap` / `dec` `hicut`;
- hihat: `tune` / `Cdec` `Odec`;
- toms: `low` `mid` / `hi` `dec`.

The bottom band has four level dials over seven red indicator lights and
seven grey pads, labelled `bdrm` `snare` `hhcl` `hhop` `low` `mid` `hi`. A
`vol` dial sits at the right.

| Control | Type | Range / unit | Default (Boom-Tschick, linear *inferred*) | Position / group |
| --- | --- | --- | --- | --- |
| Bass tune | dial | 20–147 Hz | 65 Hz | bass |
| Bass tone (start of the pitch drop) | dial | 0–254 Hz | 158 Hz | bass |
| Bass decay | dial | 0–3000 ms | 1583 ms | bass |
| Bass attack (click from noise + saw) | dial | 0–100 % | 100 % | bass |
| Snare tune | dial | 100–1270 Hz | 533 Hz | snare |
| Snare snap | dial | 0–100 % | 100 % | snare |
| Snare decay | dial | 0–3000 ms | 1016 ms | snare |
| Snare hicut (LP) | dial | 700–5780 Hz | 1980 Hz | snare |
| Hi-hat tune (noise offset) | dial | 0–1000 Hz | 543 Hz | hihat |
| Hi-hat closed / open decay | dials | 0–1000 / 0–3000 ms | 276 / 1748 ms | hihat |
| Tom low / mid / hi | dials | 30–157 / 100–354 / 200–581 Hz | 95 / 230 / 389 Hz | toms |
| Tom decay (shared) | dial | 0–3000 ms | 1465 ms | toms |
| Bass, snare, hat, tom volume | dials | 0–100 % | 84/100/100/100 % | bottom band |
| Indicator lights ×7 | display | on when struck | — | bottom band |
| Pads ×7 | button | plays at velocity 127 | — | bottom band |
| Volume | dial | 0–100 % | 40 % | right |
| Mod Wheel Range | hidden | ±100 %, moves kick tune | — | global |
| Presets | menu | 16 | — | Boom-Tschick, JazzMaster D, Thru The Floor, Bug Zapper, … |

MIDI notes: kick 36, snare 38, closed hat 42, open hat 46, toms 41/43/45.

**Signal flow.**
- **Kick:** a pitched body that falls from tune + tone to tune over its decay
  (sine body *inferred*), plus an attack burst of pink noise mixed with a saw.
- **Snare:** a tuned body plus a noise "snap", through a low-pass at hicut.
- **Hats:** noise shifted up by the tune amount. How the shift is done is not
  stated (frequency shift is *inferred*). Closed and open hats have their own
  decays. Whether a closed hit chokes an open one is not stated.
- **Toms:** three tuned bodies sharing one decay.

Everything is summed to mono, then the volume.

**Here.** New (instrument) — **Drum synth voice**. A step on the Seq grid
picks a pad by its degree: degree 1 is the kick, and so on.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `kickHz` | Kick tune | 20–150 | 65 | yes | Hz |
| `kickSweepHz` | Kick tone | 0–254 | 158 | no | Hz |
| `kickDecayMs` | Kick decay | 5–3000 | 1580 | yes | ms |
| `kickClick` | Kick attack | 0–1 | 1 | no | |
| `snareHz` | Snare tune | 100–1270 | 533 | yes | Hz |
| `snareSnap` | Snap | 0–1 | 1 | no | |
| `snareDecayMs` | Snare decay | 5–3000 | 1016 | yes | ms |
| `snareCutHz` | Snare hicut | 700–5780 | 1980 | yes | Hz |
| `hatHz` | Hat tune | 0–1000 | 543 | no | Hz |
| `hatClosedMs` | Closed decay | 5–1000 | 276 | yes | ms |
| `hatOpenMs` | Open decay | 5–3000 | 1748 | yes | ms |
| `tomLowHz` / `tomMidHz` / `tomHiHz` | Tom low / mid / hi | 30–157 / 100–354 / 200–581 | 95 / 230 / 389 | yes | Hz |
| `tomDecayMs` | Tom decay | 5–3000 | 1465 | yes | ms |
| `kickLevel` / `snareLevel` / `hatLevel` / `tomLevel` | Level | 0–1 | 0.84 / 1 / 1 / 1 | no | |
| `volume` | Volume | 0–1 | 0.4 | no | |

**Shared panel.**
1. Four groups in the original's order — Kick, Snare, Hat, Toms — with dials in
   the same 2×2 blocks.
2. A Levels row.
3. Seven pads, each a button with a light.
4. Output.

The primary control is the kick tune. Prism pad: X `kickHz` 30–100, Y
`kickDecayMs` 50–2000.

**Tests.**
- At the end of a kick hit, the measured pitch is within 5 % of `kickHz`.
- The closed hat reaches −60 dB sooner than the open hat at default settings.
- The low, mid and high toms' spectral peaks come out in ascending order.
- A level of 0 silences that pad and leaves the others unchanged.

**Open questions.**
- Does a closed hat choke an open one?
- What waveform is the kick's body?

### analogue percussion
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32), manual pp. 11–13, screenshot p011-0*

Four percussion voices, each covering one octave of notes. Each voice pairs
two oscillators: the second frequency-modulates the first and also feeds a
noise path. Three drawn five-point envelopes (amplitude, noise and pitch)
shape each hit, and a global EQ and drive follow. It is built from
single-cycle tables, so extreme tunings alias, and the presets use that.

**Original interface.** 414×373, gold. Four horizontal strips, numbered 1–4,
each with:
- **left:** an `amp` / `noise` / `pitch` selector of three LED buttons, and the
  key range (`C1–B1`, `C2–B2`, `C3–B3`, `C4–B4`);
- **middle:** a large black envelope display, with the active envelope in red
  and the other two in grey;
- **right:** `OSC 1` and `OSC 2` menus, `hi cut` and `noise vol` dials, then
  `tune`, `harmonic`, `pitch depth` and `env. scale` dials.

The right column has an `EQ` block of three small vertical sliders, and
`drive` and `vol` dials.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| OSC 1 / OSC 2 waveform (×4) | menu | sine, triangle, saw, square, noise | per preset | strip, top right |
| Hi cut (×4) | dial | 0–10 000 Hz | per preset | strip |
| Noise vol (×4) | dial | 0–100 % (noise + OSC 2) | per preset | strip |
| Tune (×4) | dial | +0…+127 semitones added to the note | per preset | strip |
| Harmonic (×4) | dial | 0×–12.7× (OSC 2 ratio) | per preset | strip |
| Pitch depth (×4) | dial | 0–100 % | per preset | strip |
| Env. scale (×4) | dial | 0–3.2 s across the display | per preset | strip |
| Envelope select (×4) | 3 LED buttons | amp / noise / pitch | amp | strip, left |
| Envelope editor (×4) | display, 5 draggable points, no sustain | 0–1 (amp, noise), ±12 semitones (pitch) | per preset | strip, middle |
| EQ low / mid / high | 3 sliders | ±6 dB at 200 / 1000 / 5000 Hz (param table says ±12) | per preset | right column |
| Drive | dial | 0–100 % | per preset | right column |
| Vol | dial | 0–100 % | per preset | right column |
| Presets | menu | 32 | — | Noise Plus Ultra, Kick-Snare-Hat-Hat, Harley Set, Just a Bad Idea, … |

The envelopes are not in the parameter table, and the manual says random and
evolve leave them alone.

**Signal flow.**
- **OSC 1** sounds at the note plus Tune, bent by the pitch envelope times
  Pitch depth, and is frequency-modulated by OSC 2 at Harmonic × its
  frequency.
- **The noise path** mixes OSC 2 with a noise generator, filters it at Hi cut,
  and shapes it with the noise envelope and Noise vol.
- **The amp envelope** shapes OSC 1.

The four voices are summed and pass through a three-band EQ, an overdrive and
the volume. Output is stereo per the page header, but how it is panned is not
stated.

**Here.** New (instrument) — **Drum synth voice**, percussion model (four
voices, each on its own pad). Envelopes are stored as point lists, not
`ParamSpec`s.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `p{n}Osc1` / `p{n}Osc2` | Osc 1 / Osc 2 | sine, tri, saw, square, noise | sine / sine | no | |
| `p{n}TuneSemis` | Tune | 0–127 | 0 | no | st |
| `p{n}Ratio` | Harmonic | 0–12.7 | 1 | no | × |
| `p{n}Noise` | Noise vol | 0–1 | 0 | no | |
| `p{n}PitchDepth` | Pitch depth | 0–1 | 0.5 | no | |
| `p{n}HiCutHz` | Hi cut | 20–10 000 | 10 000 | yes | Hz |
| `p{n}EnvScaleS` | Env. scale | 0.01–3.2 | 0.5 | yes | s |
| `eqLowDb` / `eqMidDb` / `eqHighDb` | EQ | −6–6 | 0 | no | dB |
| `drive` | Drive | 0–1 | 0 | no | |
| `volume` | Vol | 0–1 | 0.8 | no | |

**Shared panel.**
1. Four voice rows, each laid out as the original: envelope selector, envelope
   editor (a display with draggable points), then the oscillator and noise
   dials.
2. **Master** — the EQ sliders, drive and vol.

Prism pad: X `p1Ratio` 0–12.7, Y `p1PitchDepth` 0–1.

**Tests.**
- With Harmonic 0 and both oscillators on sine, voice output has one spectral
  peak: no FM sidebands.
- With a pitch envelope at +12 at time 0 and depth 1, the starting frequency is
  twice the settled frequency.
- Noise vol 0 leaves no noise floor above −80 dB between partials.
- An EQ at 0/0/0 dB leaves the signal unchanged, sample for sample.

**Open questions.**
- Is "hi cut" a low-pass, as its name says, or a high-pass, as the manual's
  description says?
- How are the four voices panned?

### bassline
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32), manual pp. 21–23, screenshot p021-0*

A one-oscillator analogue-style bass synth. It has a sub-oscillator an octave
down, a 12 or 24 dB resonant low-pass with key follow, one LFO for pitch and
cutoff, and separate amp and filter envelopes. It also works as a lead (the
presets Majestic Walk and Rubber Band Man).

**Original interface.** 382×141, grey, in two rows of boxed groups.
- **Top row:** `glide`, `subosc` and `mod` dials and a `wave` switch (square
  and saw icons), then a filter group with a `12/24` switch and `cut`, `res`,
  `key`, `mod` and `env` dials.
- **Bottom row:** a `wave speed` group with a three-way LFO-shape switch and a
  dial, then `amp adsr` (four dials), `filter adsr` (four dials) and `vol`.

| Control | Type | Range / unit | Default (Moog-a-licious) | Position / group |
| --- | --- | --- | --- | --- |
| Glide | dial | 2–256 ms | 2 ms | top left |
| Sub-osc level | dial | 0–100 % | 69 % | top left |
| Osc modulation (LFO → pitch) | dial | 0–1200 cents | 0 | top left |
| Osc waveform | switch | square / saw | square | top left |
| Filter type | switch | 12 dB / 24 dB | 24 dB | filter |
| Cutoff | dial | 0–10 kHz | 1.7 kHz | filter |
| Resonance | dial | 0–1 (1 = self-oscillation) | 0 | filter |
| Key follow | dial | 0–1000 % | 504 % | filter |
| Filter mod (LFO → cutoff) | dial | 0–5 kHz | 0 | filter |
| Filter env amount | dial | 0–100 % | 91 % | filter |
| LFO waveform | 3-way switch | saw / square / triangle | saw | wave speed |
| LFO speed | dial | 0.6–20 Hz | ~12 Hz | wave speed |
| Amp A / D / S / R | dials | 0–5000 / 0–4000 ms / 0–100 % / 0–6000 ms | 0 / 4000 / 25 % / 1843 ms | amp adsr |
| Filter A / D / S / R | dials | same ranges | 0 / 1071 / 0 / 0 | filter adsr |
| Volume | dial | 0–100 % | 42 % | right |
| Pitch Bend / Mod Wheel Range, Polyphony | hidden | 2–12 st / ±100 % / 1–32 | — | global |
| Presets | menu | 32 | — | Moog-a-licious, Pinkerton Bass, Chippy Bass, Staccato Glide, … |

**Signal flow.** An oscillator (square or saw) with a square sub an octave
below, both gliding to each new note. The LFO bends pitch by up to an octave.
Then a resonant low-pass (2- or 4-pole) whose cutoff is the knob, plus key
follow, plus the filter envelope times its amount, plus the LFO times filter
mod. Then the amp envelope and volume. Mono.

**Here.** Adjust — **Seq voice**. It already has the square and saw waves,
cutoff, res, key follow, a filter ADSR with an amount, an amp ADSR, volume, and
an LFO that can target the filter. It needs:
- a sub-oscillator;
- glide;
- a 24 dB slope;
- `pitch` as an LFO target, in cents;
- a square LFO shape.

The last two are new choices on the existing menus. Every new default keeps
today's sound.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `sub` | Sub | 0–1 | 0 | no | |
| `glideMs` | Glide | 0–256 | 0 | no | ms |
| `slope` | 12/24 | 0–1 (switch: 12, 24 dB) | 0 | no | |
| `lfo{n}Target` += `pitch` | Target | menu choice; depth reads 0–1200 cents | — | — | ct |
| `lfo{n}Wave` += `square` | Shape | menu choice | — | — | |

**Shared panel.**
1. **Osc** — wave switch, sub, glide, mod.
2. **Filter** (primary) — 12/24 switch, cutoff, res, key, mod, env.
3. **LFO** — shape switch, speed.
4. **Amp ADSR**, **Filter ADSR**, **Volume**.

Prism pad: X `cutoff` 50–5000 Hz log, Y `res` 0–0.95.

**Tests.**
- With `sub` = 1 and the main oscillator at 0, the spectral peak sits at half
  the note frequency.
- With `glideMs` = 100, the frequency has not reached the new note at 20 ms
  and has at 150 ms.
- With `slope` = 24 dB, attenuation one octave above cutoff is 24 ± 3 dB, and
  at 12 dB it is 12 ± 3 dB.
- An LFO on `pitch` at 1200 cents swings the frequency by a full octave peak
  to peak.

### beatN
*Pluggo 3.6.1 · Max/MSP VST, protected · Mpf2 (1 param), presets.tsv (Default), manual pp. 24–25, screenshot p024-0*

A tempo calculator with no audio in or out. From a tempo (typed in, or taken
from the host or PluggoSync) and a note value times a multiplier, it shows the
duration in beats per second, in milliseconds, in samples at 44.1 kHz, and as
buffer memory.

**Original interface.** 537×146, plain grey. Three columns:
- **`Tempo`:** number boxes for beats/min (142.000015 in the shot), beats/sec,
  duration (ms) and duration (samples).
- **`Sync Modifiers`:** a horizontal slider with a `multiplier` number box,
  and `sync source` (`host`) and `note value (divisor)` (`1/4`) menus.
- **`Sync Rates`:** the same four readouts for the modified value, plus
  memory (16-bit samples, "36K") and memory (32-bit samples, "72K").

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| beats/min | number | 1–300 BPM (read-only in Host and Plug modes) | 120 *inferred* | Tempo |
| multiplier | slider + number | 0–10 | 1 | Sync Modifiers |
| sync source | menu | Free, Host, Plug, UDT | — | Sync Modifiers |
| note value (divisor) | menu | 1 … 64t (dotted and triplet values) | 1/4 | Sync Modifiers |
| Readouts ×10 | number displays | BPM, beats/s, ms, samples, memory 16/32-bit | — | Tempo, Sync Rates |

`Mpf2` declares a single parameter and the only preset holds 0. The four
controls are not host parameters (*inferred*). Free mode disables the tempo,
multiplier and divisor.

**Signal flow.** None. The duration is 60 / BPM × the beats in the note value
× the multiplier. Samples are that duration × 44 100, and memory is samples ×
2 or × 4 bytes.

**Here.** Not applicable. The engine has no tempo: a stretch has a ratio, not
a BPM. The sequencer shows its own BPM and step length. A helper on `ms`
controls (Echo `delayMs`, the planned Multi Delay) that sets a time from the
sequencer's BPM and a note value would cover what beatN is for. That is a
question for the delay specs, not a source.

### big ben bell
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (16), manual pp. 26–27, screenshot p026-0*

An FM bell with four controls. A five-position switch picks one of five
built-in modulator ratios, a stereo control detunes the left channel's
modulator to widen the bell, and an attack/decay envelope shapes it. There is
no sustain. Moving the stereo control also shifts the apparent tuning.

**Original interface.** 382×141, green. One small box at the top centre holds
a vertical five-position `harmonic` switch (marked 1–5) and three dials:
`stereo`, `attack` and `decay`.

| Control | Type | Range / unit | Default (Bing-Bong) | Position / group |
| --- | --- | --- | --- | --- |
| Harmonic | 5-position switch | presets 1–5 (ratios not stated) | 1 | box, left |
| Stereo | dial | 0–100 % | 0 | box |
| Attack | dial | 2–10 002 ms | 2 ms | box |
| Decay | dial | 100–10 100 ms | ~6100 ms | box, right |
| Volume Level | hidden | 0–1 | 0.5 | global |
| Pitch Bend / Mod Wheel Range, Polyphony | hidden | 2–12 st / ±100 % / 1–32 | — | global |
| Presets | menu | 16 | — | Bing-Bong, Heavenly Doorbell, Church Bells (MW), I-Beam Chord, … |

**Signal flow.** Two-operator FM, one carrier and one modulator (*inferred*).
The modulator ratio comes from the five-entry table. Left and right are
computed separately, and Stereo offsets the left modulator. An attack-decay
envelope shapes the amplitude. Whether it also shapes the modulation index is
not stated. Output is mono by the header, but Stereo implies two channels.

**Here.** New (instrument) — **FM voice**, as a two-operator patch with a
stereo offset. This table adds to the FM kind defined under fm 4-op.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `bellRatio` | Harmonic | menu, 5 entries | 1 | no | |
| `stereo` | Stereo | 0–1 | 0 | no | |
| `attackMs` | Attack | 2–10 000 | 2 | yes | ms |
| `decayMs` | Decay | 100–10 000 | 6000 | yes | ms |
| `volume` | Volume | 0–1 | 0.5 | no | |

**Shared panel.** One group in the original's order: harmonic switch
(primary), stereo, attack, decay. Then output. Prism pad: X `stereo` 0–1, Y
`decayMs` 200–8000.

**Tests.**
- With `stereo` = 0, left and right are sample-identical.
- With `stereo` > 0, the correlation is below 1.
- The level falls 60 dB within `decayMs` + 10 %.
- The five `bellRatio` entries give five different sideband spacings.

**Open questions.**
- What are the five modulator ratios? They need to be chosen here, or
  measured by ear from the presets, since the patch cannot be read.

### deep bass
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32), manual pp. 46–48, screenshot p046-0*

A simple mono bass synth with two 16-step sequencers locked to the host clock.
One sets the filter cutoff per step. The other transposes the held note per
step, rather than playing its own notes. The oscillator is four stacked
voices: main, an octave-down sub, and a pair detuned ±1 cent.

**Original interface.** 382×376, light grey.
- **Top strip:** an osc-wave switch (saw/square icons), then `wave` (the mix),
  `glide`, a `12/24` switch, and `cut`, `res`, `env`, `att.`, `decay` and
  `vol` dials.
- **Below, the cutoff sequencer:** an on/off switch and a `sync` menu (showing
  8) at the left, and 16 vertical sliders scaled `127` to `cutoff 0`.
- **Under that, the pitch sequencer:** on/off, a `sync` menu (16), and 16
  sliders from `+12` through `0` to `pitch −12`.

| Control | Type | Range / unit | Default (Walk the Walk) | Position / group |
| --- | --- | --- | --- | --- |
| Waveform type (`osc_type`) | switch | saw / square | square | top strip |
| Waveform mix (`osc_wave`) | dial | 0–100 % of voices 2–4 | 43 % | top strip |
| Glide | dial | 2–256 ms | 2 ms | top strip |
| Filter type | switch | 12 / 24 dB | 24 dB | top strip |
| Cutoff | dial | 0–10 kHz (ignored while the cutoff sequencer runs) | 2.2 kHz | top strip |
| Resonance | dial | 0–1 | 0 | top strip |
| Filter env amount | dial | 0–100 % | 51 % | top strip |
| Filter env attack / decay | dials | 0–4000 ms each | 0 / 536 ms | top strip |
| Volume | dial | 0–100 % | 61 % | top strip |
| Sequence on/off ×2 | switch | off / on | on / on | sequencer, left |
| Sync rate ×2 | menu | 32nd, 16th, 8th (table allows 0–4) | — | sequencer, left |
| Cutoff steps ×16 | sliders | 0–10 kHz, not modulatable | per preset | cutoff sequencer |
| Pitch steps ×16 | sliders | −12…+12 semitones, not modulatable | per preset | pitch sequencer |
| Pitch Bend / Mod Wheel Range | hidden | 2–12 st / ±100 % | — | global |
| Presets | menu | 32 | — | Walk the Walk, Radar Dub, Flight of the Filter, Quad Filter Sweep, … |

**Signal flow.**
1. **Oscillator:** the main voice, plus three more mixed in by Mix: an octave
   down, +1 cent and −1 cent. All glide.
2. **Filter:** a 12 or 24 dB resonant low-pass, with an attack-decay envelope
   added to the cutoff.

No amplitude envelope is listed, so the gate is *inferred*. Both sequencers
follow the host's song position, so a locate jumps them to the matching step.
A cutoff step replaces the cutoff knob. A pitch step adds its offset to the
held note.

**Here.** Adjust — **Seq voice and step grid**. The grid already supplies a
note per step (degree and octave). In a chromatic scale, the pitch
sequencer's ±12 offsets are degree changes. It needs:
- a cutoff value per step;
- a 1/32 step length;
- a four-voice unison/sub mix on the oscillator.

It shares `glideMs` and `slope` with bassline.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `unison` | Wave mix | 0–1 | 0 | no | |
| `cutoffSeq` | Cutoff steps | switch | 0 | no | |
| `stepCutoff1`…`stepCutoff16` | Step n cutoff | 20–10 000 | = `cutoff` | yes | Hz |
| `stepLen` += `1/32` | Step len | menu choice | — | — | |

**Shared panel.**
1. **Voice** — wave switch, mix, glide.
2. **Filter** — 12/24, cut, res, env, att, decay.
3. **Volume**.
4. **Cutoff steps** — on/off, a row of 16 sliders.
5. **Pitch steps** — the existing grid.

Prism pad: X `cutoff` 50–5000 Hz log, Y `famt` 0–1.

**Tests.**
- With `cutoffSeq` on, the filter's cutoff during step k equals
  `stepCutoffk`, and the cutoff knob has no effect.
- With `stepLen` = 1/32 at 120 BPM, each step lasts 62.5 ms.
- With `unison` = 0, the output is one oscillator (no beating). At 1, energy
  appears an octave below the note.

**Open questions.**
- The parameter table allows five sync rates (0–4), but the manual names
  three. What are the other two?

### easy sampler
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32), manual pp. 55–57, screenshot p055-0*

One sample, played by note. It has a root note, fine tune, a loop toggle that
uses the file's own loop points when it has them, and an ADSR. It is the
simplest sampler: drop in a loop and play it back by key.

**Original interface.** 450×141, red. One boxed row:
- a yellow `play` button;
- a `name` field (`Atmosphere 003.aif`);
- a `loop` LED;
- a `root` display (`C3`);
- a `tune` dial;
- an `adsr env` group of four dials;
- a `vol` dial.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Play | button | plays E3 (note 64) at velocity 127 for ½ s | — | left |
| Sample name | file field (click or drop) | full path saved with the preset | — | left |
| Loop | LED toggle | off / on | per preset | middle |
| Root note | number | C-2…G8 (0–127) | per preset | middle |
| Tune | dial | ±1 semitone | per preset | middle |
| A / D / S / R | dials | 0–5000 / 0–4000 ms / 0–100 % / 0–6000 ms | per preset | adsr env |
| Vol | dial | 0–100 % | per preset | right |
| Pitch Bend / Mod Wheel Range, Polyphony | hidden | 2–12 st / ±100 % / 1–32 | — | global |
| Presets | menu | 32 | — | AtmoPad 1–3, Rolling Thunder Bass, Kick Loop 115bpm, Cultural Exchange 96bpm, … |

**Signal flow.** The file plays at a rate of 2^((note − root + tune) / 12):
pitch and speed move together. With Loop on, it repeats between the file's
loop points, or over the whole file, until note-off. ADSR, volume, mono.

**Here.** New (instrument) — **Kit voice** with one pitched pad. The engine
already plays a held loop at a fixed transposition (Stretch and Pitch linked
as varispeed). But it plays the document's timeline, not notes, and has no
envelope. The Kit kind is defined under filtered drums. These keys add a
pitched mode to a pad.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `pad{n}Pitched` | Pitched | switch | 0 | no | |
| `pad{n}Root` | Root | 0–127 | 60 | no | note |
| `pad{n}TuneCents` | Tune | −100–100 | 0 | no | ct |
| `pad{n}Loop` | Loop | switch | 0 | no | |
| `pad{n}AttackMs` | Attack | 0–5000 | 0 | no | ms |
| `pad{n}DecayMs` | Decay | 0–4000 | 0 | no | ms |
| `pad{n}Sustain` | Sustain | 0–1 | 1 | no | |
| `pad{n}ReleaseMs` | Release | 0–6000 | 50 | no | ms |

**Shared panel.** One row as the original: play button, sample name (library
picker), loop switch, root number, tune dial (primary), ADSR dials, volume. A
waveform display shows the loop points. Prism pad: X `tuneCents` ±100, Y
`releaseMs` 0–6000.

**Tests.**
- A note 12 above the root plays the sample in half the time, an octave up.
- With Loop on and the note held for three times the sample length, the
  output never falls silent. With Loop off, it falls silent after one pass.
- A file with embedded loop points loops between them, not over the whole
  file.

### filtered drums
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (8), manual pp. 63–65, screenshot p063-0*

An eight-pad sample drum module. Each pad has tune, attack, decay, pan and
level. A send switch per pad routes it, in mono, through a shared overdrive
and a resonant multimode filter. Pads 3 and 4 can choke each other, as hats
do.

**Original interface.** 399×299, yellow. Eight numbered columns, 1–8. The
rows, top to bottom:
- `filter` (an LED toggle, green when on);
- `tune`, `attack`, `decay`, `pan` and `vol` dials (a small red LED between
  columns 3 and 4 in the vol row is the 3/4 choke);
- `load` (red button);
- `trig` (grey pad);
- `name` (`o_kick o_snar o_chat o_ohat o_clap o_rims o_ride o_crsh`).

The right column holds `drive`, `cutoff` and `reso` dials, a `type` menu
(`low`), and `filter vol` and `vol` dials.

| Control | Type | Range / unit | Default (Stock 909) | Position / group |
| --- | --- | --- | --- | --- |
| Filter send ×8 | LED toggle | off / on | pad 1 on | row 1 |
| Tune ×8 | dial | 0.07×–1.9× | ≈1× | row 2 |
| Attack ×8 | dial | 5–2005 ms | 5 ms | row 3 |
| Decay ×8 | dial | 50–6050 ms | per pad | row 4 |
| Pan ×8 | dial | L–R | ≈centre | row 5 |
| Vol ×8 | dial | 0–100 % | 100 % | row 6 |
| Ch 3/4 exclusive | LED toggle | off / on | on | between 3 and 4 |
| Load ×8 / Trig ×8 | buttons | file dialog / audition | — | rows 7–8 |
| Name ×8 | display | first six characters | — | row 9 |
| Drive | dial | 0–100 % | 100 % | right |
| Cutoff | dial | 0–10 kHz | 4.3 kHz | right |
| Reso | dial | 0–1 | 0.24 | right |
| Type | menu | low-pass, high-pass, band-pass | low | right |
| Filter vol | dial | 0–100 % | 40 % | right |
| Vol | dial | 0–100 % | 100 % | right |
| Presets | menu | 8 | — | Stock 909, Woodcock Drums, Modularity 1, Midas Muffler, … |

MIDI notes: 36, 38, 42, 46, 40, 41, 43, 45.

**Signal flow.** Each pad plays its sample at rate Tune through an
attack-decay envelope. Pads without the send are panned into a stereo mix.
Pads with the send are summed in mono, at centre with their pan ignored,
through overdrive, then the filter, then Filter vol, and into the same mix.
With the choke on, pad 3 cuts pad 4 and pad 4 cuts pad 3.

**Here.** New (instrument) — **Kit voice**. This table defines the Kit kind.
quick drums, lofi drums, easy sampler and vocalese use or extend it. Samples
come from the library; the original o_* samples are not reused. A step's
degree on the Seq grid picks the pad.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `pads` | Pads | 1–16 | 8 | no | |
| `pad{n}Sample` | Sample | library reference (not numeric) | — | — | |
| `pad{n}Tune` | Tune | 0.07–1.9 | 1 | yes | × |
| `pad{n}AttackMs` | Attack | 5–2000 | 5 | yes | ms |
| `pad{n}DecayMs` | Decay | 50–6000 | 6000 | yes | ms |
| `pad{n}Pan` | Pan | −1–1 | 0 | no | |
| `pad{n}Level` | Vol | 0–1 | 1 | no | |
| `pad{n}Send` | Filter | switch | 0 | no | |
| `choke34` | 3/4 exclusive | switch | 0 | no | |
| `drive` | Drive | 0–1 | 0 | no | |
| `cutoffHz` | Cutoff | 20–10 000 | 10 000 | yes | Hz |
| `res` | Reso | 0–1 | 0 | no | |
| `filterType` | Type | LP, HP, BP | LP | no | |
| `filterLevel` | Filter vol | 0–1 | 1 | no | |
| `volume` | Vol | 0–1 | 1 | no | |

**Shared panel.**
1. **Pads** (primary) — a grid as the original, one column per pad, with rows
   for send, tune, attack, decay, pan, vol, load, trig and name. The choke
   switch sits between pads 3 and 4.
2. **Filter bus** — drive, cutoff, reso, type menu, filter vol.
3. **Output**.

Prism pad: X `cutoffHz` 50–10 000 log, Y `drive` 0–1.

**Tests.**
- With the choke on, triggering pad 3 while pad 4 rings brings pad 4 below
  −60 dB within 5 ms.
- A pad with its send on comes out with L == R whatever its pan.
- `pad{n}Tune` = 1.9 plays the sample in 1/1.9 of its length.
- With drive 0, cutoff at maximum, res 0 and LP, the filter bus equals its dry
  sum within 0.5 dB.

### flying waves
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (8), manual pp. 71–72, screenshot p071-0*

A theremin played with the mouse. Drag a crosshair over a grid: up and down is
pitch over a chosen octave span, left and right is level. Any audio file can
stand in as the oscillator's waveform. Two MIDI controllers (data entry and
the mod wheel) can play it in place of the mouse.

**Original interface.** 325×264, dark frame. A large square green grid with a
red crosshair fills the left. At the right is an `ext. wave` button with a
green light, a small vertical `vol` slider, and a `scale` number (`x 5`).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Play area | XY pad | Y = pitch over the scale span, X = level | — | left, main |
| ext. wave | button | loads any audio file as the waveform | — | right |
| Vol | slider | 0–100 % | 50 % | right |
| Scale | number/menu | ×10, ×5, ×4, ×2, ×1 octaves | ×10 | right |
| Presets | menu | 8 | — | Sine, Triangle, Saw, Square, Pulse, Spectrum 1–3 |

**Signal flow.** An oscillator reads the chosen waveform at a pitch set by Y,
scaled over the octave span, and its level follows X. There is no envelope:
the tone sounds continuously. The base pitch at the bottom of the grid is not
stated.

**Here.** Adjust — **Prism pad on engine targets**. The pad is the original's
play area. Y drives the engine's Pitch (`stretch.semitones`, ±48), with
limits set by a span. X drives output level. The waveform is a short loop of
the document read as a wavetable (WAVETABLE-MODE.md, not built), or any file
looped. Two things to add:
- the pad's engine entry needs a level target beside Stretch and Pitch;
- the pad needs a span preset that sets the Y limits in octaves.

×10 exceeds the engine's ±48 semitones, so the span stops at 8.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `padSpanOct` | Scale | 1–8 | 5 | no | oct |
| `engine.level` (pad target) | Level | 0–1 | 0.5 | no | |

**Shared panel.** The pad is the whole interface, with span and volume beside
it as in the original. The display is the pad's dot and trail. Prism pad: X
level 0–1, Y `stretch.semitones` ±(span × 6).

**Tests.**
- At span 2, the top and bottom of the pad differ by 24 semitones.
- X = 0 produces silence.
- A recorded drag replays the same pitch curve from its two lanes.

**Open questions.**
- Where does the pitch range sit? Centred on the file's own pitch, or with the
  bottom at the file's pitch?

### fm 4-op
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32, columns misaligned), manual pp. 73–74, screenshot p073-0*

A four-operator FM synth built for learning. It shows the eight routings, a
drawn four-segment envelope per operator, and the ratio or fixed frequency of
each operator. Operator 4 has self-feedback.

**Original interface.** 414×206, green.
- **Left column:** an `algorithm` display (the routing diagram) with a small
  vertical selector, then `glide`, `env. scale`, `osc 4 feedback` and `volume`
  dials.
- **Four operator panels**, numbered 1 (top left), 2 (top right), 3 (bottom
  left) and 4 (bottom right). Each has a `wave` menu (`sine`) and a large
  envelope editor with red points and a white sustain dot.
- **Operators 2–4** add a `freq/harm` toggle (a small button) above a vertical
  slider with a number box (1., 1.02, 1. in the shot).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Algorithm | display + selector | 0–7 (8 routings) | per preset | left |
| Glide | dial | 2–256 ms | — | left |
| Env. scale | dial | 0–25 400 ms across the editors | — | left |
| Osc 4 feedback | dial | 0–100 % | — | left |
| Volume | dial | 0–100 % | — | left |
| Wave ×4 | menu | sine … pulse (5 choices; middle three not named) | sine | each operator |
| Freq/harm ×3 | toggle | harmonic (relative) / fixed frequency | harmonic | ops 2–4 |
| Ratio/freq ×3 | slider + number | 0–10× or 0–10 kHz (500 steps) | — | ops 2–4 |
| Envelope ×4 | display, 4 segments + sustain | not modulatable | — | each operator |
| Pitch Bend / Mod Wheel Range (→ op 2), Polyphony | hidden | 2–12 st / ±100 % / 1–32 | — | global |
| Presets | menu | 32 | — | Classic FM Organ, Classic FM Piano, Classic FM Steel Drum, The Metal Prism, … |

**Signal flow.** Four operators, each a wave oscillator times its own
envelope. The algorithm decides which feed others as phase modulators and
which are summed to the output. Operator 1 runs at the note pitch (only 2–4
have the slider; *inferred*). Each of 2–4 runs at note × ratio or at a fixed
frequency. Operator 4 feeds its own output back to its phase. Glide on the
note pitch, then volume. Mono. The eight routings are drawn on the panel but
not described in the text. The usual 4-op set is *inferred*.

**Here.** New (instrument) — **FM voice**. This table defines the FM kind.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `algorithm` | Algorithm | 1–8 | 1 | no | |
| `wave1`…`wave4` | Wave | 5 choices (sine first) | sine | no | |
| `fixed2`…`fixed4` | Freq/harm | switch | 0 | no | |
| `ratio2`…`ratio4` | Ratio | 0–10 | 1 | no | × |
| `hz2`…`hz4` | Freq (when fixed) | 0–10 000 | 440 | yes | Hz |
| `feedback` | Osc 4 feedback | 0–1 | 0 | no | |
| `glideMs` | Glide | 2–256 | 2 | yes | ms |
| `envScaleS` | Env. scale | 0.1–25.4 | 2 | yes | s |
| `volume` | Volume | 0–1 | 0.4 | no | |
| `env{n}` | Envelope n | point list (4 segments, sustain point) | — | — | |

**Shared panel.**
1. **Global** — algorithm display (primary; picks by clicking a diagram),
   glide, env. scale, feedback, volume.
2. **Operators** — four panels in the original's 2×2 order: wave menu,
   envelope editor, and freq/harm switch plus ratio slider and number.

Prism pad: X `ratio2` 0.5–8, Y `feedback` 0–1.

**Tests.**
- With every modulator's envelope at zero, the output is one sine at the note
  frequency.
- With `ratio2` = 1 modulating operator 1, all partials sit at integer
  multiples of the note.
- With `fixed2` on at 440 Hz, the sideband spacing is the same for two
  different notes.
- With `feedback` = 0 and operator 4 alone at the output, it is a pure sine.

**Open questions.**
- What are the eight routings and their order? Reading them needs the
  algorithm display's picture or the patch.
- Which waves are choices 2–4?

### harmonic dreamz
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32), manual pp. 83–85, screenshot p083-0*

An additive synth on the first sixteen harmonics, each with its own gain. Two
things move it:
- **a random detuner** that pushes one partial off by up to ±50 Hz ten times a
  second;
- **a sine tremolo** whose high range reaches audio rate, where it becomes
  ring-mod-like sidebands.

**Original interface.** 382×312, blue, in three stacked boxes. `adsr envelope`
holds four dials. `partials gain` holds 16 vertical sliders numbered 1–16. The
bottom box holds a `detune` dial; `low` and `hi` range LEDs; `rate` and
`depth` dials under a `tremolo` label; and `vol`.

| Control | Type | Range / unit | Default (Ray's Organ) | Position / group |
| --- | --- | --- | --- | --- |
| A / D / S / R | dials | 0–5000 / 0–4000 ms / 0–100 % / 0–6000 ms | 0 / 315 ms / 32 % / 1606 ms | adsr envelope |
| Partials gain 1–16 | sliders | 0–100 % | 100/93/1/13/2/0…/9/0/36 % | partials gain |
| Detune | dial | 0–±50 Hz, one random partial every 0.1 s | 2.8 Hz | bottom |
| Tremolo range | 2 LEDs | low 0.01–20 Hz / hi 0.01–10 000 Hz | low | bottom |
| Tremolo rate | dial | 0.01 Hz to the range top | ~13 Hz | bottom |
| Tremolo depth (`lfo_depth`) | dial | 0–100 % (on the panel, not in the manual) | 14 % | bottom |
| Vol | dial | 0–100 % | 100 % | bottom right |
| Compression Threshold | hidden | 30–127 (not in the manual) | 104 | param table |
| Mod Wheel Range, Polyphony | hidden | ±100 % / 1–32 | — | global |
| Presets | menu | 32 | — | Ray's Organ, Funeral Parlor, 24-hr Plumbing, Paradox, … |

**Signal flow.**
1. Sixteen oscillators at 1…16 × the note, scaled by their gains.
2. Every 100 ms, one partial chosen at random gets a random offset within
   ±Detune Hz.
3. The sum is multiplied by a sine tremolo (rate, depth).
4. The ADSR.
5. A compressor or limiter set by the hidden threshold (*inferred* from the
   name).
6. Volume.

Mono.

**Here.** New (instrument) — **Additive voice**, harmonic mode. It uses the
Additive kind's `level1…16` with ratios fixed at 1…16, and adds:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `harmonicLock` | Harmonic | switch (ratios = n) | 1 | no | |
| `detuneHz` | Detune | 0–50 | 0 | no | Hz |
| `detuneEveryMs` | Detune interval | 10–1000 | 100 | yes | ms |
| `tremHz` | Tremolo rate | 0.01–10 000 | 4 | yes | Hz |
| `tremDepth` | Tremolo depth | 0–1 | 0 | no | |
| `limitDb` | Limit | −24–0 | 0 | no | dB |

The low/hi switch folds into one log range. The panel can keep the two LEDs
as a range shortcut.

**Shared panel.**
1. **Envelope**.
2. **Partials** (primary) — 16 sliders.
3. **Motion** — detune, tremolo range, rate, depth.
4. **Vol**.

Prism pad: X `tremHz` 0.1–2000 log, Y `tremDepth` 0–1.

**Tests.**
- With `detuneHz` = 0, every peak sits exactly at n·f.
- With `detuneHz` = 50 over 2 s, at least one partial is measured more than
  5 Hz off n·f.
- With the tremolo at 200 Hz and depth 1, sidebands appear at ±200 Hz around
  each partial.

### lofi drums
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (8), manual pp. 106–107, screenshot p106-0*

A thirteen-pad drum module of deliberately degraded samples, recorded at
22.05 kHz and 8 bits from classic drum machines. Unlike filtered drums, every
pad goes through the drive and filter.

**Original interface.** 414×160, yellow. Thirteen columns, each with `tune`,
`dec` and `vol` dials, a red load LED, a grey trigger pad, and a name: `bdrm
snare hhcl hhop low mid hi rim cow hand tamb crash ride`. The right column
holds `drive`, `cut` and `reso` dials, an `l/h/b` filter-type row of three
LEDs, a `vol` dial and a kit menu (`707`).

| Control | Type | Range / unit | Default (Straight 707) | Position / group |
| --- | --- | --- | --- | --- |
| Tune ×13 | dial | 0.07×–1.9× | ≈1× | row 1 |
| Decay ×13 | dial | 5–1505 ms | ≈1500 ms | row 2 |
| Vol ×13 | dial | 0–100 % | per pad | row 3 |
| Load / Trigger ×13 | buttons | file dialog / audition | — | rows 4–5 |
| Drive | dial | 0–100 % | 0 | right |
| Cutoff | dial | 0–10 kHz | 10 kHz | right |
| Reso | dial | 0–1 | 0.05 | right |
| Filter type | 3 LEDs | low-, high-, band-pass | low | right |
| Vol | dial | 0–100 % | 100 % | right |
| Kit (`kit_sel`) | menu | 3 kits: 707, 808, 909 (*inferred* from the menu and preset names; not in the manual) | 707 | right, bottom |
| Presets | menu | 8 | — | Straight 707, Stock 808, Out of the Box 909, Mod Wheel Squeedgy, … |

MIDI notes: 36, 38, 42, 46, 41, 43, 45, 37, 56, 39, 54, 49, 51.

**Signal flow.** Each pad plays its sample at Tune through a decay envelope.
The thirteen are summed, then pass through overdrive, a resonant LP/HP/BP
filter and the volume. There are no pan controls, so the output is mono
(*inferred*). The kit menu swaps the whole sample set.

**Here.** New (instrument) — **Kit voice** with all pads on the filter bus.
The lo-fi character comes from passing library samples through the planned
Decimator (HYPERPRISM.md) at 22.05 kHz and 8 bits, baked per pad when it
loads, not from copying the original sets. It adds to the Kit kind:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `routeAll` | All through filter | switch | 0 (1 here) | no | |
| `padRateHz` | Kit sample rate | 4000–48 000 | 22 050 | yes | Hz |
| `padBits` | Kit bits | 4–24 | 8 | no | bit |
| `kit` | Kit | menu of saved kits | — | no | |

**Shared panel.**
1. **Pads** — thirteen columns of tune, dec, vol, load, trig and name.
2. **Filter bus** — drive, cut, reso, type LEDs.
3. **Output** — vol and the kit menu.

Prism pad: X `cutoffHz` 50–10 000 log, Y `res` 0–1.

**Tests.**
- With `routeAll` on, a cutoff change alters every pad.
- With `padBits` = 8, a pad's output has no more than 256 distinct levels
  before the filter.
- With drive 0, cutoff at maximum and reso 0, the output equals the dry sum
  within 0.5 dB.

### moving waves
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32, columns misaligned), manual pp. 125–128, screenshot p125-0*

A vector synth. Four oscillators sit at the corners of a joystick, and the
stick's position crossfades between them. Separate X and Y LFOs move the
crossfade on their own, and a third LFO moves the filter. Each oscillator
picks from 33 waves.

**Original interface.** 414×136, blue, in four boxes.
- **`osc`:** rows `a`–`d`, each with a `wave` menu (sine, pulse, sine, pulse
  in the shot) and a `tune` dial.
- **`mod`:** a round joystick pad with corners `a` (top left), `b` (top
  right), `c` (bottom left) and `d` (bottom right), with a `y` indicator bar
  at its right and an `x` bar below it.
- **`lfo`:** rows `x`, `y` and `cut`, each with `depth` and `rate` dials and
  four shape LEDs.
- **`filter/env`:** `lp/hp/bp` LEDs; `cut`, `res` and `env` dials; a `filter`
  ADSR row and an `amp` ADSR row; `vol`.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wave a–d | menu | saw, square, triangle, pulse, sine, wav0–wav27 | — | osc |
| Tune a–d | dial | ±1 semitone | — | osc |
| Joystick (`target_X`, `target_Y`) | XY pad | 0–127 each; not on MIDI, open to modulators | — | mod |
| X / Y indicators | display | LFO-driven position | — | mod |
| X, Y, cut LFO depth | dial | 0–100 % | — | lfo |
| X, Y, cut LFO rate | dial | 0.8–20 Hz | — | lfo |
| X, Y, cut LFO shape | 4 LEDs | tri, square, saw, random | — | lfo |
| Filter type | 3 LEDs | low-, high-, band-pass | — | filter/env |
| Cut / Res / Env | dials | 0–10 kHz / 0–1 / 0–100 % | — | filter/env |
| Filter ADSR, Amp ADSR | 4 dials each | 0–5000 / 0–4000 ms / 0–100 % / 0–6000 ms | — | filter/env |
| Vol | dial | 0–100 % | — | filter/env |
| Pitch Bend / Mod Wheel Range, Polyphony | hidden | 2–12 st / ±100 % / 1–32 | — | global |
| Presets | menu | 32 | — | Monks and Stars, Accordians & Organs, Random Walk, Radar Sweep, … |

**Signal flow.**
1. Four oscillators are mixed with bilinear weights from the stick position,
   offset by the X and Y LFOs.
2. A resonant multimode filter, whose cutoff is the knob plus the envelope
   plus the cut LFO.
3. The amp ADSR, then volume.

Mono. The manual says X crossfades A/B against C/D. On the panel, though,
A and C are on the left and B and D on the right. The two disagree.

**Here.** New (instrument) — **Wave voice**, vector player. The wavetables are
our own: five basic shapes plus generated or user-loaded single-cycle tables
in place of wav0–27. This table defines the Wave kind's shared part.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `waveA`…`waveD` | Wave | table menu | saw, square, tri, sine | no | |
| `tuneA`…`tuneD` | Tune | −100–100 | 0 | no | ct |
| `x` / `y` | Vector X / Y | 0–1 | 0.5 / 0.5 | no | |
| `xLfoDepth` / `yLfoDepth` / `cutLfoDepth` | Depth | 0–1 | 0 | no | |
| `xLfoHz` / `yLfoHz` / `cutLfoHz` | Rate | 0.8–20 | 1 | yes | Hz |
| `xLfoShape` / `yLfoShape` / `cutLfoShape` | Shape | tri, square, saw, random | tri | no | |
| `filterType` | Filter | LP, HP, BP | LP | no | |
| `cutoffHz` | Cut | 20–10 000 | 5000 | yes | Hz |
| `res` | Res | 0–1 | 0 | no | |
| `fEnv` | Env | 0–1 | 0 | no | |
| `aA aD aS aR`, `fA fD fS fR` | ADSR | 0–5000 / 0–4000 / 0–1 / 0–6000 | 0/500/1/300 | no | ms |
| `glideMs` | Glide | 0–1000 | 0 | no | ms |
| `volume` | Vol | 0–1 | 0.7 | no | |

**Shared panel.** Groups in the original's order:
1. **Osc** — four rows of menu and tune.
2. **Mod** (primary) — the vector XY pad with its two indicator bars.
3. **LFO** — three rows of depth, rate and shape.
4. **Filter/env**.

This is the one instrument whose own control is the Prism pad. X `x` 0–1,
Y `y` 0–1.

**Tests.**
- At `x` = 0, `y` = 0, only oscillator A is above −60 dB.
- At (1, 1), only D is.
- With all LFO depths 0, the mix weights are constant over time.
- A random-shape LFO gives different values on two successive cycles.

**Open questions.**
- Which axis fades which pair? The manual and the panel disagree.

### pgs-1
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv (60 params), presets.tsv (32), manual pp. 139–142, screenshot p139-0*

"Pretty Good Synth": a large mono analogue-style synth. It has three warpable
oscillators and two multimode filters edited on response displays. Its
modulation sources are two ADSRs, two ARs, two LFOs and velocity, each picked
per destination. Two VCAs, overdrive and a digital delay follow, so a preset
is a finished sound. A playable keyboard and wheels sit on the panel.

**Original interface.** 739×475, dark red.
- **Left column:** `OSC 1`, `OSC 2` and `OSC 3` panels, each with a `type`
  menu, a large `coarse` dial, a `modulation` menu over a horizontal amount
  slider, small `fine` and `warp` dials, and a `mix` dial.
- **Centre, top:** `FILTER 1` and `FILTER 2`, each with a type menu
  (`lowpass`, `highshelf`), a `kf` toggle, a response display with selection
  fences and a gain line, and a mod-source menu over an amount slider.
- **Centre, middle:** `ENV/AR 1` and `ENV/AR 2`, each a 5-point ADSR graph
  with the sustain point ringed in yellow, labelled `^ADSR n`, plus `AR n`
  `att` and `rel` dials.
- **Centre, bottom:** `LFOs` (two shape menus and two `rate` dials) and `VCAs`
  (two source menus, `constant` and `ar 1`, and two `amt` dials).
- **Right column, `OUTPUT`:** `overdrive`, `delay time`, `delay feedback`,
  `delay mix` and `output level`.
- **Bottom strip:** `Pitch Bend Range` (2 semis), `Portamento Time` (25 ms),
  pitch and mod wheels, and a five-octave keyboard.

| Control | Type | Range / unit | Default (Aquaman) | Position / group |
| --- | --- | --- | --- | --- |
| Osc type ×3 | menu | off, sine, pulse, saw, triangle, noise | tri / sine / off | OSC n |
| Coarse ×3 | dial | −32…+31 semitones | 0 / +12 / +1 | OSC n |
| Fine ×3 | dial | ±20 cents | 0 | OSC n |
| Mod source ×3 | menu | off, adsr 1, adsr 2, ar 1, ar 2, lfo 1, lfo 2 | lfo 1 / off / off | OSC n |
| Mod amount ×3 | slider | ±100 % | 0 % | OSC n |
| Warp ×3 | dial | 0–100 % | 0 | OSC n |
| Mix ×3 | dial | 0–127 (table 0–157) | 118 / 109 / 0 | OSC n |
| Filter type ×2 | menu | display-only, LP, HP, BP, band-stop, peak/notch, low shelf, high shelf | LP / high shelf | FILTER n |
| Key follow ×2 | toggle | off / on | off | FILTER n |
| Filter display ×2 | display (drag centre = freq, fences = Q, line = gain) | — | — | FILTER n |
| Filter freq ×2 (hidden) | — | 20–17 000 Hz | 5016 / 3520 Hz | FILTER n |
| Filter gain ×2 (hidden) | — | 0.0001–16 | 1 / 0.125 | FILTER n |
| Filter Q ×2 (hidden) | — | 0.01–25 | 1.99 / 0.81 | FILTER n |
| Filter mod source ×2 | menu | off, adsr 1/2, ar 1/2, lfo 1/2, velocity | off | FILTER n |
| Filter mod depth ×2 | slider | ±100 % | 0 | FILTER n |
| ADSR editor ×2 | display, 5 points | — | — | ENV/AR n |
| AR attack / release ×2 | dials | 0–2000 ms | — | ENV/AR n |
| LFO shape ×2 | menu | off, triangle, sine, square, up-saw, down-saw (table: 4 values) | triangle | LFOs |
| LFO rate ×2 | dial | 0.01–10 Hz | — | LFOs |
| VCA source ×2 | menu | constant, adsr 1/2, ar 1/2, lfo 1/2 (table: 8 values) | constant / ar 1 | VCAs |
| VCA amount ×2 | dial | 0–99 % | 92 / 86 % | VCAs |
| Overdrive | dial | 0–100 % (table 0–90) | 14 | OUTPUT |
| Delay time | dial | 0–2560 ms | — | OUTPUT |
| Delay feedback | dial | 0–99 % | 0 | OUTPUT |
| Delay mix | dial | dry:wet 100:0 → 0:100 | dry | OUTPUT |
| Output level | dial | 0–127 (table 0–157) | — | OUTPUT |
| Pitch Bend Range | number | 2–12 semitones | 7 | bottom strip |
| Portamento | number | 0–5000 ms | 1744 ms | bottom strip |
| MW → Osc 1–3, Filter 1–2 | hidden | ±100 % | — | global |
| Wheels, keyboard | controls | play without MIDI | — | bottom strip |
| Presets | menu | 32 | — | Aquaman, The Incredible Hulk, Wonder Woman, The Silver Surfer, … |

**Signal flow.**
1. **Oscillators:** three oscillators, each with a coarse/fine offset, a
   pitch-modulation source × amount, and Warp, which changes the waveform's
   read rate inside each cycle.
2. **Mix**, then Filter 1 and Filter 2. Series is *inferred*; the manual does
   not say. Each filter's cutoff follows key (optional) and its mod source.
3. **Hidden overdrive stages** sit around the filters, per the manual.
4. **VCAs:** two VCAs set the level, each as a source × amount or a constant.
5. **Output:** overdrive, then a digital delay (time, feedback, wet/dry), then
   output level.

Mono, with portamento.

**Here.** New (instrument) — **Analog multi voice**. The delay is not part of
the voice: an Echo slot (`delayMs`, `feedback`, `wet`, `dry`) after the voice
covers it. Overdrive stays in the voice as `drive`. This table defines the
Analog multi kind.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `o{n}Wave` | Type | off, sine, pulse, saw, tri, noise | saw / off / off | no | |
| `o{n}Coarse` | Coarse | −32–31 | 0 | no | st |
| `o{n}Fine` | Fine | −20–20 | 0 | no | ct |
| `o{n}ModSrc` | Modulation | off, adsr1, adsr2, ar1, ar2, lfo1, lfo2 | off | no | |
| `o{n}ModAmt` | Amount | −1–1 | 0 | no | |
| `o{n}Warp` | Warp | 0–1 | 0 | no | |
| `o{n}Mix` | Mix | 0–1 | 0.8 | no | |
| `f{n}Type` | Filter | off, LP, HP, BP, BS, peak, low shelf, high shelf | LP / off | no | |
| `f{n}Hz` | Freq | 20–17 000 | 5000 | yes | Hz |
| `f{n}Q` | Q | 0.1–25 | 0.7 | yes | |
| `f{n}GainDb` | Gain | −24–24 | 0 | no | dB |
| `f{n}ModSrc` | Mod source | as osc, plus velocity | off | no | |
| `f{n}ModAmt` | Mod depth | −1–1 | 0 | no | |
| `f{n}Key` | kf | switch | 0 | no | |
| `routing` | Filters | series, parallel | series | no | |
| `ar{n}AttackMs` / `ar{n}ReleaseMs` | AR att / rel | 0–2000 | 5 / 300 | no | ms |
| `adsr{n}` | ADSR n | point list (5 points, sustain) | — | — | |
| `lfo{n}Shape` | LFO shape | off, tri, sine, square, up-saw, down-saw | tri | no | |
| `lfo{n}Hz` | LFO rate | 0.01–10 | 1 | yes | Hz |
| `vca{n}Src` | VCA source | constant, adsr1/2, ar1/2, lfo1/2 | adsr1 / constant | no | |
| `vca{n}Amt` | VCA amount | 0–1 | 1 | no | |
| `drive` | Overdrive | 0–1 | 0 | no | |
| `glideMs` | Portamento | 0–5000 | 0 | no | ms |
| `level` | Output level | 0–1 | 0.7 | no | |

The original stores filter gain as a ratio (0.0001–16). Here it is ±24 dB.
The original's ratio range is roughly −80 to +24 dB, but below −24 the shelf
is effectively off.

**Shared panel.** The original's three columns, in its order:
1. **Oscillators** — three panels.
2. **Filters** (primary; each a response display with its type menu, kf
   switch, mod source and depth), **Envelopes** (ADSR editors with AR dials),
   **LFOs** and **VCAs**.
3. **Output** — drive, level; the delay shows as the Echo slot that follows.

Prism pad: X `f1Hz` 100–8000 log, Y `f1Q` 0.5–12.

**Tests.**
- With oscillators 2 and 3 off, oscillator 1 on sine, both filters off and
  the VCA constant at 1, the output is a pure sine.
- With `o1Coarse` = +12, the frequency doubles.
- A band-stop at f with Q 4 notches a sweep by more than 30 dB at f.
- With `o1ModSrc` = lfo1 and amount 1, the pitch is periodic at the LFO rate.

**Open questions.**
- Are the two filters in series or in parallel?
- The LFO shape list (six in the manual, four in the table) and the VCA source
  list (seven against eight) disagree. Which is the real set?

### qsynth
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32), manual pp. 163–164, screenshot p163-0*

One oscillator feeding three resonant filters in parallel. Each filter has its
own drawn cutoff envelope and gain envelope, its own LFO depth and its own
place in the stereo field. Opening and closing the filters moves the sound
across the stereo image.

**Original interface.** 429×419, purple.
- **Top bar:** `wave` (four LEDs with icons); `LFO rate` with three shape
  LEDs; `time scale`; `volume`.
- **Top right:** a routing diagram, a sine feeding filters 1, 2 and 3, which
  feed `L` and `R`.
- **Three rows, numbered 1–3:** a `freq env` / `gain env` LED selector, a large
  envelope display (red for active, grey for the other, white sustain point),
  and `Q`, `Freq`, `mod` and `level` dials.

| Control | Type | Range / unit | Default (Thermian's Revenge) | Position / group |
| --- | --- | --- | --- | --- |
| Wave | 4 LEDs | tri, (square), (saw), random — middle two *inferred* from icons | random | top bar |
| LFO shape | 3 LEDs | tri, (saw), square | tri | top bar |
| LFO rate | dial | 0–20 Hz | 20 Hz | top bar |
| Time scale | dial | 0–20 s across the displays | 6.5 s | top bar |
| Volume | dial | 0–100 % | 17 % | top bar |
| Envelope select ×3 | 2 LEDs | freq env / gain env | — | row n, left |
| Envelope editor ×3 | display, 5 points + sustain | not modulatable | — | row n |
| Q ×3 | dial | 0–1 | 0.21 / 0.27 / 0.28 | row n |
| Freq ×3 | dial | 0–10 kHz | 2.3 / 6.1 / 5.6 kHz | row n |
| Mod ×3 (LFO → cutoff) | dial | 0–100 % | 0 / 82 / 80 % | row n |
| Level ×3 | dial | 0–100 % | 64 / 100 / 100 % | row n |
| Routing diagram | display | fixed | — | top right |
| Pitch Bend / Mod Wheel Range, Polyphony | hidden | 2–12 st / ±100 % / 1–32 | — | global |
| Presets | menu | 32 | — | Thermian's Revenge, Mercury … Planet X, Pulsar Twins, … |

**Signal flow.**
1. One oscillator.
2. Three resonant filters in parallel. The type is not stated; low-pass is
   *inferred*. Each cutoff is Freq shaped by its frequency envelope, plus the
   shared LFO times Mod.
3. Each filter's output is shaped by its gain envelope and Level, then panned
   to its place. From the diagram, filter 2 goes left, filter 3 right and
   filter 1 both (*inferred*).
4. Volume.

The header says mono, but the panning makes it stereo.

**Here.** New (instrument) — **Analog multi voice** with `routing` =
parallel and three filters. It adds to the Analog multi kind:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `f3…` | Filter 3 | as `f{n}` | LP | — | |
| `f{n}Pan` | Pan | −1–1 | 0 / −1 / 1 | no | |
| `f{n}Level` | Level | 0–1 | 1 | no | |
| `f{n}FreqEnv` / `f{n}GainEnv` | Envelopes | point lists (5 points, sustain) | — | — | |
| `f{n}LfoAmt` | Mod | 0–1 | 0 | no | |
| `envScaleS` | Time scale | 0.1–20 | 2 | yes | s |

**Shared panel.**
1. **Top** — wave, LFO shape and rate, time scale, volume, and the routing
   diagram as a display.
2. **Three filter rows** (primary) — envelope selector, envelope editor, Q,
   Freq, mod, level.

Prism pad: X `f2Hz` 100–8000 log, Y `f3Hz` 100–8000 log.

**Tests.**
- With only filter 2 at level 1, the right channel is silent.
- With only filter 1 and pan 0, L == R.
- With every `f{n}LfoAmt` = 0, each cutoff is constant through a held note
  with flat envelopes.

**Open questions.**
- Which pan does each filter have? The diagram is small.
- What type are the three filters?

### quick drums
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (8), manual pp. 165–166, screenshot p165-0*

The plainest drum module: eight sample pads with only pan and level, and a
3/4 choke. It is meant to cost almost no CPU.

**Original interface.** 362×177, yellow. Eight numbered columns. The rows are
`pan` dials, `vol` dials (with a small LED between 3 and 4 for the choke),
`load` buttons, `trig` pads, and `name` (`o_kick … o_crsh`, as in filtered
drums).

| Control | Type | Range / unit | Default (Quick 909) | Position / group |
| --- | --- | --- | --- | --- |
| Pan ×8 | dial | L–R | spread across | row 1 |
| Vol ×8 | dial | 0–100 % | 100/83/69/68/100/63/77/100 % | row 2 |
| Ch 3/4 exclusive | LED toggle | off / on | off | between 3 and 4 |
| Load / Trig ×8 | buttons | file dialog / audition | — | rows 3–4 |
| Name ×8 | display | six characters | — | row 5 |
| Presets | menu | 8 | — | Quick 909, Quick HR-16, Quick 707, Strange Days Mix, … |

MIDI notes as for filtered drums.

**Signal flow.** Each pad plays its sample once at its level, panned into a
stereo mix. There is no envelope, tuning or filter.

**Here.** New (instrument) — **Kit voice**, with nothing beyond the Kit kind's
`pad{n}Level`, `pad{n}Pan` and `choke34`. This is the base kit: build it
first, with the rest of filtered drums' keys at their neutral defaults.

**Shared panel.** **Pads**: columns of pan, vol, load, trig and name, with
the choke between 3 and 4. **Output**. Prism pad: X `pad1Level` 0–1, Y
`pad2Level` 0–1.

**Tests.**
- `pad{n}Pan` = −1 leaves the right channel silent for that pad.
- Level 0 silences the pad.
- The choke behaves as in filtered drums.

### shape synth
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32), manual pp. 181–183, screenshot p181-0*

Two oscillators into a waveshaper, then a resonant low-pass. The mod wheel
(CC 1) moves the waveshape live, from near-square to near-pulse. Noise can be
mixed into the shaping table, and a phase offset, also moved by the LFO,
gives the odder shapes.

**Original interface.** 414×214, purple, with group headings `wave shape`,
`osc`, `filter`, `lfo` and `env`.
- **`wave shape`:** `shape`, `noise` and `phase` dials over a large display of
  the transfer curve (a pink S-curve).
- **`osc`:** `tune` and `fine` dials. Beside it, a small signal diagram: two
  sine icons, then a shaper box, then a filter icon.
- **`filter`:** `cut`, `res`, `env` and `lfo` dials, with `amp. adsr` and
  `filter adsr` rows of four dials below.
- **`lfo`:** three shape LEDs and `spd` and `depth` dials.
- **`vol`** at bottom right.

| Control | Type | Range / unit | Default (Mod Wheel Mambo) | Position / group |
| --- | --- | --- | --- | --- |
| Shape (CC 1) | dial | square → pulse | 56 % | wave shape |
| Noise | dial | 0–100 % | 0 | wave shape |
| Phase | dial | 0–180° | 0 | wave shape |
| Transfer display | display | the current shape | — | wave shape |
| Osc 2 tune | dial | ±12 semitones | −12 | osc |
| Osc 2 fine | dial | ±1 semitone | 0 | osc |
| Cut / Res / Env / LFO | dials | 0–10 kHz / 0–1 / 0–100 % / 0–100 % | 4.2 kHz / 0.49 / 37 % / 0 | filter |
| Amp ADSR, Filter ADSR | 4 dials each | 0–5000 / 0–4000 ms / 0–100 % / 0–6000 ms | amp 0/0/100 %/0 | env |
| LFO shape | 3 LEDs | tri, (saw), square | tri | lfo |
| LFO speed | dial | 0–20 Hz | 0 | lfo |
| LFO depth (→ shape phase) | dial | 0–100 % | 0 | lfo |
| Vol | dial | 0–100 % | 43 % | bottom right |
| Pitch Bend / Mod Wheel Range, Polyphony | hidden | 2–12 st / ±100 % / 1–32 | — | global |
| Presets | menu | 32 | — | Mod Wheel Mambo, Dr. Detuna, Raft-bound, Man from K.L.A.M.P., … |

**Signal flow.**
1. Two oscillators (the second offset by tune and fine) are summed.
2. A waveshaper. Shape selects the transfer curve, noise is added into the
   curve, and phase offsets where the curve is read. The LFO moves the phase.
3. A resonant low-pass, plus the filter envelope and the LFO.
4. The amp ADSR, then volume. Mono.

The oscillators' waveform is not stated; sine is *inferred* from the diagram.

**Here.** Adjust — **Seq voice**. It needs:
- a second oscillator;
- a waveshaper after the oscillators;
- `phase` as an LFO target.

The waveshaper's curve family is designed here. At its centre the curve is
the identity, so the default leaves the voice as it is.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `osc2Level` | Osc 2 | 0–1 | 0 | no | |
| `osc2Semis` | Tune | −12–12 | 0 | no | st |
| `osc2Fine` | Fine | −100–100 | 0 | no | ct |
| `shape` | Shape | 0–1 (0.5 = identity) | 0.5 | no | |
| `shapeNoise` | Noise | 0–1 | 0 | no | |
| `shapePhaseDeg` | Phase | 0–180 | 0 | no | ° |
| `lfo{n}Target` += `phase` | Target | menu choice | — | — | |

**Shared panel.**
1. **Wave shape** (primary) — shape, noise, phase, and the transfer-curve
   display.
2. **Osc** — tune, fine.
3. **Filter** — cut, res, env, lfo.
4. **Amp ADSR**, **Filter ADSR**.
5. **LFO** — shape, speed, depth.
6. **Vol**.

Prism pad: X `shape` 0–1, Y `shapePhaseDeg` 0–180.

**Tests.**
- With `shape` = 0.5, noise 0 and phase 0, the output equals today's voice
  sample for sample.
- Moving `shape` away from 0.5 on a sine input adds harmonics: the THD rises
  monotonically with distance.
- With `osc2Semis` = 0, `osc2Fine` = 0 and `osc2Level` = 1, there is no beating
  (the envelope is flat within 0.1 dB).

### Sine Bank
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv (9 named), Mpf2 (73 params), presets.tsv (8), manual pp. 187–188, screenshot p187-0*

Up to 32 free-running sines, with no MIDI and no audio input: a drone or test
source. You draw rough frequencies and amplitudes on two bar displays and set
exact values per sine with a select number. A global transpose multiplies
every frequency. A spread pulls the sines toward their average, or pushes
them away from it.

**Original interface.** 298×222.
- **Top:** a horizontal slider for the sine count.
- **Upper bar display:** pink, with one red bar per sine for frequency.
- **Number boxes at the right, top to bottom:** `# Sines` (8), `Sine Select`
  (1), `MIDI Note #` (50.000), `Frequency` (146.83), `Transpose` (1.),
  `Spread` (1.), `Portamento` (100).
- **Lower bar display:** blue, for amplitudes, with `Sine Select` (1) and
  `Amplitude` (0.57) beside it.
- **`Volume`** (0.5) at the bottom.

| Control | Type | Range / unit | Default (Mellotone) | Position / group |
| --- | --- | --- | --- | --- |
| # Sines | slider + number | 1–32 | 8 | top |
| Frequency bars | display (drawable) | one bar per sine | — | upper |
| Sine select (freq) | number | 1–32 | 1 | right, upper |
| MIDI note # | number | 0–127 (fractional) | 50 | right, upper |
| Frequency | number | 8.18–12 543 Hz | 146.83 Hz | right, upper |
| Transpose | number | −5–5, 1 = none | 1 | right, upper |
| Spread | number | 0–5 (0 = all at the mean, 1 = as drawn) | 1 | right, upper |
| Portamento | number | 0–5000 ms | 100 ms | right, upper |
| Amplitude bars | display (drawable) | one bar per sine | — | lower |
| Sine select (amp) | number | 1–32 | 1 | right, lower |
| Amplitude | number | 0–1 | 0.57 | right, lower |
| Volume | number | 0–1 | 0.5 | bottom |
| Presets | menu | 8 | — | Mellotone, Sine Spread, Low Beating, High Beating, Bipolar, A 440, … |

`Mpf2` declares 73 parameters. That is the nine named here plus, *inferred*,
32 frequencies and 32 amplitudes held behind the two bar displays.

**Signal flow.**
1. For each active sine, the frequency is the mean + (drawn − mean) × Spread,
   times Transpose.
2. Changes glide over Portamento.
3. Each sine is scaled by its amplitude, the sines are summed, then volume.
   Mono.

**Here.** New (instrument) — **Additive voice**, free mode: frequencies in Hz,
no notes, and it runs while the transport plays. It adds to the Additive
kind:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `freeMode` | Free | switch (Hz, no note) | 0 (1 here) | no | |
| `hz1`…`hz32` | Frequency n | 8.18–12 543 | 146.83 | yes | Hz |
| `transpose` | Transpose | 0.125–8 | 1 | yes | × |
| `spread` | Spread | 0–5 | 1 | no | |
| `portamentoMs` | Portamento | 0–5000 | 100 | no | ms |

`level{n}` is the amplitude and `count` is # Sines.

**Shared panel.**
1. **Count** — slider.
2. **Frequencies** (primary) — a drawable bar display, with select, note and
   Hz numbers.
3. **Spread** — transpose, spread, portamento.
4. **Amplitudes** — a drawable bar display, with select and amplitude.
5. **Volume**.

Prism pad: X `spread` 0–2, Y `transpose` 0.5–2.

**Tests.**
- With `spread` = 0, all sines sit at the mean frequency: one peak.
- With `transpose` = 2, every peak doubles.
- With `count` = 1, there is one peak, at `hz1`.
- A frequency change with portamento 100 ms has not arrived at 20 ms and has
  at 150 ms.

**Open questions.**
- The manual allows Transpose from −5 to 5. What does a negative multiplier
  do? This spec limits it to positive values.

### vocalese
*Pluggo 3.6.1 · Max/MSP VST, protected · Mpf2 (6 params, outside the usual table), Mpst (4 presets × 6), manual pp. 232–233, screenshot p232-0*

A phoneme player: each note from 36 to 67 plays one recorded speech sound.
Vowels loop and consonants play once. Speed (forward or reversed, on the
pitch bend) and a resonant low-pass (on the mod wheel) are the performance
controls. A cartoon wizard image is there for character only.

**Original interface.** 900×340, black. It has no visible controls:
- a box at the top left with the current phoneme's name (`zhh`);
- a purple bar across the top;
- a waveform of the phoneme in purple on the left;
- a 3-D wizard on the right (`vocalese_bkgd.pct`).

The six parameters are reached through the host or Pluggo's parameter view.

| Control | Type | Range / unit | Default (Kristin; order *inferred*) | Position / group |
| --- | --- | --- | --- | --- |
| Playback speed (pitch bend) | hidden | 1× reversed … 1× forward | 0.51 (normalised) | — |
| Volume | hidden | 0–100 % | 0.65 | — |
| LP cutoff (mod wheel) | hidden | 0–12.7 kHz | 0.66 | — |
| LP resonance | hidden | 0–0.99 | 0 | — |
| AR attack | hidden | 0–5000 ms | 0 | — |
| AR release | hidden | 0–6000 ms | 0 | — |
| Phoneme name | display | current note's phoneme | — | top left |
| Waveform | display | current sample | — | left |
| Presets | menu | 4 | — | Kristin, Sluggo, As the Wizard Speaks..., When Worlds Collide |

The notes, by phoneme:
- **36–45**, looped vowels: eee ihh ehh aaa ahh ohh uhh uuu ooo aww.
- **46–67**, one-shot: rrr lll mmm nnn nng ngg fff sss thh shh xxx hee hoo
  hah bbb ddd jjj ggg vvv zzz thz zhh.

**Signal flow.** The note picks a phoneme sample, which plays at Speed: a
signed rate, so negative reads backwards. Vowels loop while the note is held.
Then a resonant low-pass, an attack-release envelope and the volume. Mono.

**Here.** New (instrument) — **Kit voice** loaded with a phoneme set: one pad
per phoneme, looping on the vowel pads. The original recordings are not ours;
the set is recorded or chosen from the library. It adds to the Kit kind:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `speed` | Speed | −1–1 (signed rate) | 1 | no | × |
| `kitCutoffHz` | Lowpass | 20–12 700 | 12 700 | yes | Hz |
| `kitRes` | Resonance | 0–0.99 | 0 | no | |
| `pad{n}Loop` | Loop | switch (from easy sampler) | vowels 1 | no | |
| `attackMs` / `releaseMs` | AR | 0–5000 / 0–6000 | 0 / 50 | no | ms |

**Shared panel.**
1. **Pads** — a list of phoneme names, each with a loop switch.
2. **Play** (primary) — speed and the low-pass with resonance.
3. **Envelope** — attack and release.
4. **Volume**.

The phoneme name and waveform are displays. Prism pad: X `speed` −1–1, Y
`kitCutoffHz` 200–12 700.

**Tests.**
- With `speed` = −1, the output is the pad's sample reversed.
- A looped pad held for three times its length never falls silent. A one-shot
  pad ends after one pass.
- With `speed` = 0, the output is silent and does not click.

**Open questions.**
- Is the Mpst value order the manual's order? The first preset stores speed
  0.51, which on a linear −1…+1 map is nearly stopped. Either the mapping is
  not linear, or the order differs.

### wavy waves
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (32), manual pp. 249–251, screenshot p249-0*

A wave-sequencing synth. Sixteen steps each choose a waveform, and the
oscillator steps through them, free-running or locked to a multiple of the
host's tempo. There are two step players, left and right, at their own rates.
An LFO can make the stepping hitch. It makes sense only with the host
transport running.

**Original interface.** 414×125, purple.
- **Top:** a `wave` row of 16 menus, numbered 1 2 3 4 four times. The shot
  shows saw ×4, sqr ×4, sin ×4 and w0 ×4.
- **Below:** `speed L` and `speed R` blocks, each with five sync LEDs (`f`, 1,
  2, 3, 4) and a dial.
- **Filter:** `cut`, `res`, `env` and `lfo` dials, with `amp. adsr` and
  `filter adsr` rows.
- **`lfo`:** shape LEDs, `rate`, and `mod` (the step-rate modulation).
- **`glide`** and **`vol`**.

| Control | Type | Range / unit | Default (TwoStep) | Position / group |
| --- | --- | --- | --- | --- |
| Wave 1–16 | menu | saw, square, triangle, pulse, sine, w0–w27 (table allows 0–33) | saw×4, sqr×4, sin×4, w0×4 | top row |
| Step sync L / R | 5 LEDs | free, 1×, 2×, 3×, 4× | 2× / 1× | speed L / R |
| Step speed L / R | dial | 0–100 Hz (free mode only) | 16 / 17 Hz | speed L / R |
| Cut / Res / Env / LFO | dials | 0–10 kHz / 0–1 / 0–100 % / 0–100 % | 2.6 kHz / 0.57 / 55 % / 0 | filter |
| Amp ADSR, Filter ADSR | 4 dials each | 0–5000 / 0–4000 ms / 0–100 % / 0–6000 ms | per preset | filter |
| LFO shape | LEDs | tri, square (table: 2 values; manual: 0–2) | tri | lfo |
| LFO rate | dial | 0–20 Hz | 14 Hz | lfo |
| LFO mod (→ step rate) | dial | 0–100 % | 0 | lfo |
| Glide | dial | 0–127 (time not stated) | 82 | right |
| Vol | dial | 0–100 % | 28 % | right |
| Pitch Bend / Mod Wheel Range, Polyphony | hidden | 2–12 st / ±100 % / 2–32 | — | global |
| Presets | menu | 32 | — | TwoStep, Krikkets, Jalopy, Weed Whacker, Thrashing Machine, … |

**Signal flow.**
1. Two players read the same 16-step list. The left and right sides are
   *inferred* to be two oscillators, mixed. Each advances a step at its own
   rate: free Hz, or the host's sync pulse times 1–4.
2. The LFO modulates the step rate continuously.
3. The mix passes a resonant low-pass (envelope, LFO), then the amp ADSR,
   glide and volume. Mono.

**Here.** New (instrument) — **Wave voice**, sequence player. Sync comes from
the sequencer's BPM, the one clock here. It adds to the Wave kind:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `step1Wave`…`step16Wave` | Wave n | table menu | saw | no | |
| `lSync` / `rSync` | Sync L / R | free, 1×, 2×, 3×, 4× | free | no | |
| `lRateHz` / `rRateHz` | Speed L / R | 0.1–100 | 4 | yes | Hz |
| `stepLfo` | LFO mod | 0–1 | 0 | no | |
| `lfoShape` / `lfoHz` / `cutLfo` | LFO | tri, square / 0.01–20 / 0–1 | tri / 1 / 0 | — | |

**Shared panel.**
1. **Steps** (primary) — 16 menus in four groups of four, as the original.
2. **Speed L / R** — sync switch and dial.
3. **Filter** — cut, res, env, lfo.
4. **Amp ADSR**, **Filter ADSR**.
5. **LFO** — shape, rate, mod.
6. **Glide**, **vol**.

A step display lights the current step for each side. Prism pad: X `lRateHz`
0.1–100, Y `rRateHz` 0.1–100.

**Tests.**
- With all 16 steps on the same wave, the spectrum is constant over time.
- With `lSync` = 2× at 120 BPM and the right side silent, the wave changes
  every 250 ms (a beat divided by the multiplier; *inferred* semantics).
- With `stepLfo` = 0, the step intervals are equal within one sample.

**Open questions.**
- Do the left and right players go to different channels? The header says
  mono.
- What does "1/2/3/4 ×" mean exactly: a multiple of the beat, or of the bar?

### white grains
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (16), manual pp. 254–255, screenshot p254-0*

A granular synth on a built-in waveform, not a sample. Three drawn seven-point
envelopes move the amplitude, the pitch and the grain size through each note.
That makes it a short, scripted granular gesture per note, from robotic to
broom-like noise.

**Original interface.** 382×469, purple.
- **Top box:** a `wave` menu (`sine`), `b.width` and `glide` dials, and an
  `env. scale` slider with a number (19.).
- **Below, three large breakpoint displays:** `amplitude`, `pitch` (with a
  centre zero line) and `grain size`. Each has seven red points and a white
  sustain point.

| Control | Type | Range / unit | Default (As You'd Expect) | Position / group |
| --- | --- | --- | --- | --- |
| Waveform | menu | sine, triangle, square, saw, noise, pulse, 3 digital | sine | top |
| Bandwidth | dial | 0–12.7 kHz | 1.7 kHz | top |
| Glide | dial | 2–1272 ms | 2 ms | top |
| Env. scale | slider + number | 0–25.4 (seconds *inferred*) | 19 | top |
| Amplitude env | display, 7 points + sustain | not modulatable | — | 1st display |
| Pitch env | display, 7 points + sustain | ± around the note | — | 2nd display |
| Grain size env | display, 7 points + sustain | — | — | 3rd display |
| Level Adjustment | hidden | 0–1 | 0.17 | param table |
| Polyphony | hidden | 1–32 | 8 | param table |
| Presets | menu | 16 | — | As You'd Expect, What Computers Hear, Digital Brook, UFOlogy, … |

**Signal flow.** Grains are cut from a looping single-cycle waveform at the
note pitch, offset by the pitch envelope. Grain length follows the size
envelope, and output follows the amplitude envelope, all over Env. scale
seconds. Bandwidth is described only as a base rate that makes the result
more random as it rises; a grain-rate or frequency jitter is *inferred*.
Glide, level, mono.

**Here.** Adjust — **granular engine**. Every control has a target already:
- grain size → `stretch.windowMs`;
- pitch → `stretch.semitones`;
- bandwidth → `stretch.grain.pitchJitterSemis` or `stretch.grain.rateHz`;
- the three envelopes → automation lanes, looped over a note-length range.

Two things are missing:
- **a built-in waveform source**, so the engine can granulate a generated
  cycle rather than a file (WAVETABLE-MODE.md);
- **a way to start the lanes from a note** rather than from the document
  clock.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `source` (document) | Source | file, sine, tri, square, saw, noise, pulse | file | no | |
| `sourceHz` | Source pitch | 20–2000 | 220 | yes | Hz |

**Shared panel.** The Time & Pitch panel as it is, with a Source menu at its
head. The three envelopes show as lanes on Window, Pitch and output level in
the Automation dock. Prism pad: X `stretch.windowMs` 5–200 log, Y
`stretch.grain.pitchJitterSemis` 0–12.

**Tests.**
- With `source` = sine at 220 Hz, Pitch 0, jitter 0 and Window 50 ms, the
  output's main peak is at 220 Hz ±1 %.
- A Window lane step from 10 to 100 ms changes the measured grain length at
  that frame.
- With `source` = file, the output is unchanged from today.

**Open questions.**
- What does Bandwidth do exactly?
- What unit is Env. scale in?

### xmod synth
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv (56), presets.tsv (32, columns misaligned), manual pp. 259–262, screenshot p259-0*

A three-oscillator analogue model whose range comes from a four-slot
modulation matrix. Any of eight sources (two LFOs, two envelopes, the three
oscillators, noise) can drive the FM or pulse width of any oscillator, or the
filter, with a sign. A ring modulator, noise and a filter that morphs from
low-pass through band-pass to high-pass round it out.

**Original interface.** 414×153, grey.
- **Left, rows `osc 1`–`osc 3`:** a `wave` name with a dial, a `pitch` number
  (organ feet: 4, 32, 32), an offset number (`+0`, oscillators 2 and 3), and
  `tune` and `vol` dials.
- **Left, a `lfo 1/2` row:** `wave` menus (`tri`, `s&h`) with `speed` dials.
- **Middle, four matrix rows:** a `source` menu (env2, lfo1, lfo1, lfo1), a
  `mod` dial, a `+/−` LED, and a `dest` menu (filter…, filter…, osc1 FM,
  osc1 FM).
- **Right:** `cut`, `reso` and `lp/bp/hp` dials, the `env 1 adsr` and
  `env 2 adsr` rows, and `ring`, `noise`, `glide` and `vol`.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wave ×3 | dial + name | saw, square, triangle, pulse, sine, wav0–27 | — | osc n |
| Pitch ×3 | number | 32′, 16′, 8′, 4′, 2′ | — | osc n |
| Offset (osc 2, 3) | number | −6…+6 semitones | +0 | osc n |
| Tune ×3 | dial | ±1 semitone | — | osc n |
| Vol ×3 | dial | 0–100 % | — | osc n |
| LFO wave ×2 | menu | tri, square, saw, s&h | tri / s&h | lfo 1/2 |
| LFO rate ×2 | dial | 0.8–20 Hz | — | lfo 1/2 |
| Mod source ×4 | menu | LFO 1, LFO 2, Env 1, Env 2, Osc 1, Osc 2, Osc 3, Noise | — | matrix |
| Mod depth ×4 | dial | 0–100 % | — | matrix |
| Mod sign ×4 | LED | + / − | — | matrix |
| Mod dest ×4 | menu | Osc 1 FM, Osc 1 PWM, Osc 2 FM, Osc 2 PWM, Osc 3 FM, Osc 3 PWM, Filter FM (table: 7) | — | matrix |
| Cut / Reso | dials | 0–10 kHz / 0–1 | — | right |
| lp/bp/hp | dial | continuous morph LP → BP → HP | — | right |
| Env 1, Env 2 ADSR | 4 dials each | 0–5000 / 0–4000 ms / 0–100 % / 0–6000 ms | — | right |
| Ring | dial | 0–100 % | — | right |
| Noise | dial | 0–100 % | — | right |
| Glide | dial | 2–637 ms | — | right |
| Vol | dial | 0–100 % | — | right |
| Pitch Bend Range, MW Range 1–4 (→ mod depth n), Polyphony | hidden | 2–12 st / ±100 % / 1–32 | — | global |
| Presets | menu | 32 | — | Starter Stock, Daftly Speaking, Mister Roboto, TelStar, 16 mm, … |

**Signal flow.**
1. Three oscillators at their octave, offset and tune, plus noise, are mixed.
   A ring-modulated component is added. Which oscillators are ring-modulated
   is not stated; osc 1 × osc 2 is *inferred*.
2. A resonant state-variable filter whose output morphs from LP through BP to
   HP.
3. Env 1 shapes the amplitude (*inferred*; the manual does not say which
   envelope is the VCA).
4. Each of the four matrix slots adds source × depth × sign to its
   destination's frequency, pulse width or cutoff.
5. Glide, then volume. Mono.

**Here.** New (instrument) — **Analog multi voice** with a matrix in place of
per-destination sources. It adds to the Analog multi kind:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `o{n}Feet` | Pitch | 32′, 16′, 8′, 4′, 2′ | 8′ | no | |
| `o{n}Level` | Vol | 0–1 | 0.7 / 0 / 0 | no | |
| `ring` | Ring | 0–1 | 0 | no | |
| `noise` | Noise | 0–1 | 0 | no | |
| `filterMorph` | lp/bp/hp | 0–2 | 0 | no | |
| `mod{n}Src` | Source | lfo1, lfo2, env1, env2, osc1, osc2, osc3, noise | lfo1 | no | |
| `mod{n}Dest` | Dest | o1 FM, o1 PWM, o2 FM, o2 PWM, o3 FM, o3 PWM, filter | filter | no | |
| `mod{n}Amt` | Mod | 0–1 | 0 | no | |
| `mod{n}Neg` | +/− | switch | 0 | no | |
| `lfo{n}Shape` += `s&h` | LFO shape | menu choice | — | — | |

**Shared panel.**
1. **Oscillators** — three rows, then the LFO row.
2. **Matrix** (primary) — four rows of source, depth, sign and dest.
3. **Filter** — cut, reso, morph.
4. **Envelopes** — env 1 and env 2.
5. **Mix** — ring, noise, glide, vol.

Prism pad: X `f1Hz` 100–8000 log, Y `mod1Amt` 0–1.

**Tests.**
- `filterMorph` 0, 1 and 2 give low-pass, band-pass and high-pass responses: a
  sweep is highest below, at, and above cutoff respectively.
- With every `mod{n}Amt` = 0, a held note's pitch and cutoff are constant.
- With osc 1 at 8′ and osc 2 at 16′, osc 2 is an octave below osc 1.
- Inverting `mod1Neg` mirrors the modulation (the cutoff moves the opposite
  way).

**Open questions.**
- What does the ring modulator multiply?
- Which envelope is the amplifier?

---

## Analysis and visuals

### D-Meter
*Pluggo 3.6.1 · compiled code (no decoded patch), Mpf2 (0 params) · manual p. 49, screenshot p049-0*

A mastering meter in the style of a Dorrough, showing an average and a peak
on one scale at one dB per LED. The average is a bar that moves more slowly
than a VU. The peak is a single LED that behaves like an AES/EBU digital
meter. The offset between the two is exaggerated so each reads clearly. The
target is to keep each at the top of its own yellow zone. Audio passes
through untouched.

**Original interface.** 340×118, black. Two rows of LED segments (L above,
R below), about 40 per row. The scale numbers `39 35 30 25 20 15 10 5 0` run
left to right above them. Unlit segments show their zone colours: green, then
yellow, then dark orange and red, then yellow again, then red. In the shot,
the average is lit in green from 39 to about 26, plus three yellow segments.
A single bright segment near 10 is the peak.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| L meter | display, ~40 LEDs | 1 dB per LED; scale 39…0 | — | top row |
| R meter | display, ~40 LEDs | same | — | bottom row |
| Average bar | display | slower than a VU | — | both rows |
| Peak dot | display | single LED | — | both rows |
| Scale legend | display | 39 35 30 25 20 15 10 5 0 | — | above |

There are no parameters and no presets.

**Signal flow.** Stereo through, unchanged. Each channel's average is drawn as
a bar. The averaging time is not stated, only that it is slower than a VU.
Each channel's peak is drawn as one LED, offset on the scale from the average
by a fixed amount (the "exaggerated difference"; the amount is not stated).

**Here.** Adjust — the master bus's **VU panel**. The data is all there: a
300 ms RMS bar, a fast peak and a peak hold from `/api/engine/master`, per
channel. Add a second meter style:
- LED segments at 1 dB;
- the average as a bar and the peak as a single dot;
- two marked target zones;
- a peak offset that shifts the dot, so the two read apart as in the
  original.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `meterStyle` | Style | bar, LED | bar | no | |
| `ledDb` | dB per LED | 0.5–3 | 1 | no | dB |
| `ledSpanDb` | Span | 20–60 | 40 | no | dB |
| `peakOffsetDb` | Peak offset | 0–20 | 0 | no | dB |
| `avgZoneDb` / `peakZoneDb` | Target zones | −40–0 | −18 / −3 | no | dBFS |

**Shared panel.** A display only, in the right half of the Time & Pitch tray
where the VU is now. Style, span and zones are in the panel's menu. There is
no pad.

**Tests.**
- A −18 dBFS sine lights the average up to the −18 segment, ±1 segment.
- A single full-scale spike in silence lights the peak dot but moves the
  average by less than 1 segment.
- A left-only signal lights only the top row.

**Open questions.**
- What is the scale's reference? The numbers 39…0 may be dB below full scale,
  or below a reference that sits above it.
- How large was the peak offset?

### Light Organ
*Pluggo 3.6.1 · Max/MSP VST, protected · params.tsv, presets.tsv (8), manual pp. 103–104, screenshot p103-0*

A visual toy. Three band-pass filters measure the input, and their levels draw
coloured ovals and lines that fade at a chosen rate, with occasional flashes
of background colour. Audio passes through. Its output is the picture.

**Original interface.** 408×320. Pluggo's window bar sits at the top: a
`View` menu (`Light Organ`) and a `Meter` menu (`Off`). Below it is a thin
strip with three small icons and three horizontal sliders. These are probably
the Pluggo window's own controls (*inferred*), since there are six parameters,
not three. The drawing fills the rest: concentric, overlapping ellipses in
bright green, blues and dark red, crossed by thin coloured lines radiating
outward.

| Control | Type | Range / unit | Default (Third Eye) | Position / group |
| --- | --- | --- | --- | --- |
| Sensitivity | hidden | 0–199 (input gain) | 41 | — |
| Spread | hidden | 0–100 (higher = narrower bands) | 55 | — |
| Variation | hidden | 0 / 1 (two centre positions) | 1 | — |
| Mode | hidden | ovals, lines, both | lines | — |
| Fade | hidden | 0–99 (background redraw rate) | 99 | — |
| Flashes | hidden | off / on | off | — |
| Drawing | display | whole window | — | main |
| Presets | menu | 8 | — | Third Eye, Local Weather, Pickup Sticks, Scratched Cornea, Seizure, Strobe, 50's Design, Blotter Plotter |

**Signal flow.** The input is gained by Sensitivity and split into three band-
pass bands. Spread sets their width; the centre frequencies are not stated.
Each band's level sets the size and colour of a shape: ovals, lines, or both.
Shapes are drawn about one of two centres, and the background is repainted
every Fade frames, so shapes linger. Flashes repaints in a random colour now
and then. The redraw rate depends on CPU load.

**Here.** New — a **visualiser view** behind the picker, beside Swarm 2D …
Lattice. It needs no server work: the three bands are sums over the band
spectrum from `/api/engine/master`. WebGL, written here, like the rest of the
visualiser. The view's settings:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `sensitivity` | Sensitivity | 0–2 | 0.4 | no | × |
| `bandsHz` | Bands | three centres | 200 / 1500 / 6000 | yes | Hz |
| `spreadOct` | Spread | 0.3–3 (octaves; narrower = higher original value) | 1 | yes | oct |
| `variation` | Variation | 0 / 1 | 1 | no | |
| `mode` | Mode | ovals, lines, both | lines | no | |
| `fade` | Fade | 0–1 (trail persistence) | 1 | no | |
| `flashes` | Flashes | switch | 0 | no | |

The band centres are our choice, because the original does not state its own.

**Shared panel.** The view, with a settings strip like the visualiser's other
views. Sensitivity is primary. Prism pad: X `sensitivity`, Y `fade`. The pad
would need view targets; see the open question below.

**Tests.**
- Silence leaves an empty frame once a full fade has passed.
- A 100 Hz sine moves only the low band's shape.
- `sensitivity` = 0 draws nothing.
- At 60 fps with a 20 Hz feed, consecutive frames interpolate, so no shape
  jumps by more than its per-frame step.

**Open questions.**
- Can the Prism pad drive a view's settings, or only audio controls?

### Phase Scope
*Pluggo 3.6.1 · compiled code (no decoded patch) · manual p. 143, screenshots p143-0, p143-1*

A stereo phase display: left plotted against right. In-phase material draws a
line, and out-of-phase or decorrelated material spreads into a cloud.

**Original interface.** 195×137 in each of two shots. A dark grey field with
a 6×4 grid. In the in-phase shot, a short thin green trace runs diagonally
from lower left to upper right through the centre. In the out-of-phase shot,
it is a small scatter of green dots around the centre.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Scope | display | L on one axis, R on the other (unrotated: L = R is the diagonal) | — | whole window |
| Presets | menu | 1 | — | Default |

**Signal flow.** It takes stereo in and passes no audio out. It plots
recent (L, R) sample pairs as points.

**Here.** Exists — the master bus's **Lissajous** and **correlation**. The
`/api/engine/master` response carries the raw `(L, R)` pairs
(`audio_core::meter::lissajous`). The interface draws them with a bright head
of the newest 160 points and shows the correlation in words: mono, stereo,
wide, phase. The only difference is orientation. Phase Scope draws L against
R unrotated, so identical channels lie on a diagonal. If the panel draws
mid/side (identical channels vertical), an "L/R axes" orientation choice is
the whole adjustment.

**Shared panel.** As it is today. No pad.

**Tests.**
- With L = R, every plotted point satisfies |x − y| < 1e−6 in L/R orientation,
  and the correlation reads 1.
- With L = −R, the points lie on the other diagonal and the correlation
  reads −1.

---

## Template

### Generic Effect
*Pluggo 3.6.1 · Max/MSP VST, decoded patch · patch.txt (9 `pp`, 20 `setprogram`), params.tsv, presets.tsv (20), manual pp. 78–79, screenshot p078-0*

A modulated comb filter. It has separate feedforward and feedback delays, each
with its own sine modulation, and three gains: dry, feedforward and feedback,
each signed. Vibrato, flanger, chorus, doubling and spring-like smears are
all settings of this one structure. The first five presets come from
Dattorro's "Effect Design, Part 2", which the rack's ModDelay already
implements in part.

**Original interface.** It has no custom panel. The screenshot (352×267) is
Pluggo's generic parameter view: a header row reading `Parameter | Min | Max |
Value`, then one row per parameter with a horizontal slider and a numeric
value, and a footer reading `pluggo effect: Generic Effect`. The decoded
patch's top level is a test harness, not a panel (`adc~`/`dac~`, a
"start audio" comment, and preset capture and recall buttons). So `ui.txt`
positions describe the harness and are not used. In Max's object order the
patcher lists `plugout~` first and `teeth~ 100.` last.

| Control | Type | Range / unit | Default (Vibrato) | Position / group |
| --- | --- | --- | --- | --- |
| Gain (dry) | slider | −1–1 (negative inverts) | 0 | row 1 |
| Feedforward Gain | slider | −1–1 | 1 | row 2 |
| Feedback Gain | slider | −1–1 | 0 | row 3 |
| Feedforward Delay | slider | 0–100 ms | 1 ms | row 4 |
| FF Mod Freq | slider | 0–50 Hz | 3 Hz | row 5 |
| FF Mod Depth | slider | 0–100 (ms *inferred*) | 0.95 | row 6 |
| Feedback Delay | slider | 0–100 ms | 1 ms | row 7 |
| FB Mod Freq | slider | 0–50 Hz | 0 | row 8 |
| FB Mod Depth | slider | 0–100 | 0 | row 9 |
| Presets | menu | 20 | — | Vibrato, Flange, Chorus, White Chorus, Double, Takeoff, Cheap Spring, Squeeze Flange, Machine Gun Vibrato, from the planet Xorx, more from Xorx, Subtle Depression, Distorted Flange, Bulbous, Large Bathroom, Mind of its Own, Percussive Xorx, Xorx Fabric Softener, Mellow Xorx, Mistuned AM Radio |

Some presets in real units, in the order gain / FF / FB / FF delay / FF rate /
FF depth / FB delay:

| Preset | Gain | FF | FB | FF delay | FF rate | FF depth | FB delay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Flange | 0.71 | 0.71 | −0.71 | 1 ms | 1.5 Hz | 0.63 | 1 ms |
| Chorus | 1 | 0.71 | 0 | 5 ms | 1 Hz | 1.13 | 5 ms |
| White Chorus | 0.71 | 1 | 0.71 | 10 ms | 1.4 Hz | 1.11 | 10 ms |
| Double | 0.71 | 0.71 | 0 | 20 ms | 0.66 Hz | 1.41 | 20 ms |

Mistuned AM Radio puts the feed-forward delay (37 ms) under audio-rate
modulation: 50 Hz at a depth of 12. That makes sidebands rather than a sweep.

**Signal flow.** Mono. The core is Max's `teeth~`, a comb with separately
timed feedforward and feedback paths. Each output sample is:

> Gain × input
> \+ FF gain × input delayed by D₁
> \+ FB gain × output delayed by D₂

- D₁ is the FF delay plus FF depth × a sine at FF freq, built from two
  `cycle~` oscillators, one per path, scaled and added to the base times.
- D₂ is the same for the feedback path.

The delays clip at 0 ms. With a fixed feedback delay and a modulated
feedforward delay, this is Dattorro's chorus, with the white chorus's signed
blend. Modulating the feedback delay (Mind of its Own) sweeps the resonances
themselves.

**Here.** Adjust — **ModDelay** (`dattorro.rs`), a fourth `ModDelayMode::Generic`
with its own spec table. Today's ModDelay feeds back from the same modulated
tap it outputs, and its wet and dry are 0–1. The original needs:
- a second, independently modulated feedback tap;
- the feedback taken from the output;
- signed dry and feedforward gains.

A new mode keeps the three existing modes and their saved values as they are.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `blend` | Gain | −1–1 | 0 | no | |
| `ffGain` | Feedforward | −1–1 | 1 | no | |
| `fbGain` | Feedback | −0.98–0.98 | 0 | no | |
| `ffDelayMs` | FF delay | 0.1–100 | 1 | yes | ms |
| `ffRateHz` | FF rate | 0.01–50 | 3 | yes | Hz |
| `ffDepthMs` | FF depth | 0–100 | 0.95 | no | ms |
| `fbDelayMs` | FB delay | 0.1–100 | 1 | yes | ms |
| `fbRateHz` | FB rate | 0.01–50 | 0.1 | yes | Hz |
| `fbDepthMs` | FB depth | 0–100 | 0 | no | ms |
| `stereo` | Stereo phase | 0–1 | 0.5 | no | |

Feedback is limited to ±0.98, as in the existing ModDelay specs, because
±1 does not decay. `stereo` follows the rack's convention for a mono original:
it offsets the right channel's LFO phase. The buffer grows from 160 ms to
cover 100 ms of base delay plus 100 ms of depth.

**Shared panel.** The original's order, in three groups:
1. **Gains** — blend, feedforward, feedback (sliders).
2. **Feedforward** (primary) — delay, rate, depth (dials).
3. **Feedback** — delay, rate, depth (dials).

Then stereo. An impulse-response display would show the comb, but the
original has none and it is not required. Prism pad: X `ffRateHz` 0.01–50
log, Y `ffDepthMs` 0–20. These are Hyperprism's Frequency / Depth pair for
chorus and flanger.

**Tests.**
- With `blend` = 1 and `ffGain` = `fbGain` = 0, the output equals the input.
- With `blend` = 0, `ffGain` = 1, `ffDepthMs` = 0 and `ffDelayMs` = 10, an
  impulse comes back exactly once, at 10 ms.
- With `ffGain` = 0, `blend` = 1, `fbGain` = 0.5 and `fbDelayMs` = 5, an
  impulse gives a train at 5 ms spacing, each copy half the last.
- The Vibrato preset has no dry component, and the instantaneous frequency of
  a 1 kHz sine deviates periodically at 3 Hz.

---

## Utilities

- **PluggoBus Send** — Not applicable. It sends a plug-in's input to one of
  eight bus channels (4 stereo pairs, with level, a delay of up to 1024
  samples, and thru), so another plug-in such as a vocoder or convolver can
  take a second input. Here a second input to an effect is a sound from the
  library, as HYPERPRISM.md's Convolution and Spectral Dynamics plan.
- **PluggoBus Rcv** — Not applicable. It is the other end of the bus (source
  per channel, mix with input), and there is no bus here to receive from.
- **PluggoSync** — Not applicable. It derives a clock from clicks in its
  input, or runs an internal BPM, and gives four divided sync outputs. Here
  the engine's playback time is the only clock, and the sequencer already
  follows it.
