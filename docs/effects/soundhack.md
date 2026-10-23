# SoundHack Delay Trio and Freesound

*22 October 2026. Spec; built 23 October — see [Built](#built) at the end, which overrides the spec where they differ. Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md).*

*Batch A · Tom Erbe, SoundHack · Delay Trio (`SDKM912`, bundle 9.1.1–9.1.2, 2018) and Freesound (`SFSM910`, bundle 9.1.0, on-screen "v. 9.10 – 2017") · Mac AU / VST / VST3, JUCE 5, universal x86_64 + i386 · 9 effects*

These nine are Tom Erbe's free teaching plug-ins. They share one look and one
framework, so the batch reads as a family. Every one is a JUCE
`AudioProcessorValueTreeState` plug-in, which made the sources unusually exact.
Parameter ids, ranges, skews, defaults and unit strings come from the processor
constructors. The value-to-text functions give menu choices. The editors'
`resized()` give every control's x, y, w and h, and their constructors give the
window size. The DSP comes from a Ghidra decompile of each `processBlock`. It
was read for behaviour only and is described here in my own words. Nothing was
run or loaded. The manuals say almost nothing. The Delay Trio PDF is one
paragraph and says outright "There is currently no manual". The Freesound PDF
has a sentence per plug-in and five screenshots. **Delay Trio has no
screenshots**, so its layouts are given from the code's coordinates alone.
The Freesound screenshots are of v. 9 (2014–2015). The binaries are v. 9.10,
and where the two differ, both are given. Of the nine, 0 exist as they are,
6 extend an existing or planned effect, and 3 are new.

| Effect | Here | Shared-panel pad pair (X / Y) |
| --- | --- | --- |
| ++bubbler | New `Bubbler` | `density` / `grainSize` |
| ++delay | New `DelayPlus` | `delayMs` / `feedback` |
| ++flipper | Adjust Boomerang (`ReverseMix`) | `throwMs` / `overlap` |
| ++pitchdelay | Adjust Harmonizer (`PitchShifter`) | `semitones` / `feedback` |
| ++chebyshev | New `Chebyshev` | `h3Db` / `h2Db` |
| ++compand | Adjust Compressor | `thresholdDb` / `ratio` |
| ++decimate | Adjust planned Decimator | `rate` / `bits` |
| ++matrix | Adjust planned Stereo Matrix | `midGain` / `sideGain` |
| ++phasor | Adjust Phaser | `rateHz` / `sweep` |

**What every original shares.** Everything below is in the code. Where I say
what a part looks like, that comes from the Freesound screenshots.

- **Window.** All nine are 474 px wide. The heights are 120, 162, 186, 302 or
  324.
- **Title.** A rounded badge at the top left reads "soundhack ++name". A
  footer at the bottom right reads "soundhack ++name v. N – year tom erbe".
- **Main controls.** These are 72×72 rotary dials (102×102 on ++delay's top
  row). Each shows its value as large text in the centre, with its label
  below. Switches are 18-px-high pill buttons. A switch either shows the
  current state's text ("peak detect", "LR > MS") or is filled grey when on
  ("360out").
- **In and out gain.** Two small 36×36 rotaries sit at the top right, input at
  (390,6) and output at (432,6). Each is ±20 dB with a default of 0, except
  ++compand's output, which is 0–60 dB with a default of 10. Through
  `sh01LAF::setVuLevels`, they double as the input and output level meters:
  the green bars in the ++phasor screenshot. The delays add a third small
  rotary to their left for wet/dry, at (342,6), or (336,6) on ++delay.
- **Colour.** An 18×18 rotary at the bottom left, `color` (0–1), re-tints the
  interface. It has no effect on the audio, and no audio code reads it.
- **No preset menu.** `getNumPrograms` returns 1, so only host presets exist.
- **Clipping.** Every output is hard-clipped at ±1.5. Every parameter change
  is smoothed linearly across one block.

**Batch-wide decisions.**

- **Gain and colour.** The in/out gain pairs become the rack's own Gain or
  Utility slots, not per-effect keys. Two exceptions keep a `driveDb`:
  ++chebyshev and ++decimate. In those two, input level changes the sound
  itself (polynomial order, distance to the quantisation step), not just the
  loudness. `color` is dropped, because the app has its own theme. The shared
  panel's header shows the slot's input and output meters, the way the
  original's gain knobs did.
- **Tempo sync is left out of the ParamSpec tables.** That matches batch C1,
  because the rack has no tempo source. Five originals have it: ++delay twice,
  ++pitchdelay, ++bubbler, ++flipper and ++phasor. Each records what its sync
  does, so the switch can be added once a tempo exists.
- **MIDI.** ++bubbler and ++pitchdelay are `aumf` (music effects), and both
  read note-ons. The rack has no MIDI input, so this is recorded but not
  specified.
- **Percent becomes fraction.** Where an original shows 0–100 %, the key here
  is 0–1, and 0–200 % becomes 0–2. That is the app's convention (Echo
  `feedback`, Phaser `depth`).
- **The feedback loop the Delay Trio shares.** Three of the four delays use
  the same loop, and two specs below refer to it:
  - a 4-point Hermite read from a power-of-two ring buffer;
  - a DC blocker (one pole at 1 − 126/sr), switched in once feedback passes
    100 %;
  - a level-riding gain stage. A running average of the loop's absolute level
    sets the gain: unity below 0.5, a gentle cubic cut from 0.5 to 3, and a
    fixed ⅓ above 3. This is what lets feedback reach 200 % without running
    away. It is "saturation" only in the sense the manual uses the word.
  - The wet output passes through an arctangent soft clip before the wet/dry
    crossfade.

---

### ++bubbler
*SoundHack Delay Trio, Tom Erbe, 2018 (v. 9.12) · AU `aumf` "+2bb" / VST / VST3 · `delay_trio_rm.pdf` (one paragraph); `++bubbler` Info.plist, `.rsrc` (DeRez: names only); x86_64 slice: constructor, value-to-text lambdas, `resized`, `processBlock` (Ghidra); `inspect-sh-bubbler.json`*

A granular delay. A delay line feeds up to eight grain voices. Each grain is
pulled out of the line with its own random delay time, start time, length,
pan, direction and pitch. The pitches come from a one-octave keyboard of
allowed intervals, in equal or just tuning. The summed grains are filtered and
fed back. It sits between a delay and a cloud generator, and the interval
keyboard is what makes it musical rather than noisy.

**Original interface.** The window is 474×324 and has no screenshot; the layout
below is from `resized()`. Under the header sit two rows of six dials. Between
them is a 12-key interval keyboard: black keys at y=141 and white keys at
y=162. Two switches and the colour control sit at the bottom. The dial labels
are the on-screen strings.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| time | dial | 10–10 000 ms, skew 0.3 | 80 | 6,48 (72×72) · delay |
| time vari | dial | 0–100 % | 0 | 84,48 · delay |
| feedback | dial | 0–200 % | 0 | 162,48 · delay |
| filter freq | dial | 20–20 000 Hz, skew 0.3 | 20 000 | 240,48 · filter |
| resonance | dial | 0–100 % | 10 | 318,48 · filter |
| pan vari | dial | 0–100 % | 0 | 396,48 · grain |
| density | dial | 0–200 % | 50 | 6,186 · grain |
| grain size | dial | 0–50 (unit string "ms"; see open questions) | 30 | 84,186 · grain |
| g start vari | dial | 0–100 % | 0 | 162,186 · grain |
| octave | dial | −4 to +4, step 1 | 0 | 240,186 · pitch |
| oct vari | dial | 0–2 | 0 | 318,186 · pitch |
| g reversal | dial | 0–100 % | 0 | 396,186 · grain |
| pitch keys 0–11 | 12 switches | on/off | all off (= root only) | black keys 1, 3, 6, 8, 10 at y=141, x = 42, 108, 246, 312, 378; white keys 0, 2, 4, 5, 7, 9, 11 at y=162, x = 6, 72, 138, 210, 276, 342, 408 (each 60×18) |
| 12tet / just | switch | 0 = "12tet", 1 = "just" | 12tet | 6,279 (72×18) |
| timelock | switch | on/off | off | 84,279 (96×18) |
| wet/dry | small dial | 0–100 % | 50 | 342,6 (36×36) |
| in / out | small dials and meters | ±20 dB | 0 | 390,6 / 432,6 |
| colour | small dial | 0–1 (interface tint) | 0 | 6,300 (18×18) |

**Signal flow.**

1. **Input to the line.** Input × in-gain is summed with the filtered grain
   feedback and written to a ring buffer per channel. The loop's level-riding
   gain stage (see the batch notes) sits on the write.
2. **Delay time.** The base delay is `time`. *timelock* snaps it to a whole
   multiple, or a whole fraction, of the host's beat.
3. **When a grain starts.** Grain length is `grain size` × delay time ÷ 100,
   with a floor of 0.001. The time between grain starts is grain length ÷
   (density × 0.04). Density 25 gives one grain per grain length; the default
   of 50 gives two overlapping grains; 0 starts none. A new grain starts when
   that interval has passed and one of the eight voices is free.
4. **Per grain.** Each grain draws from its own random generator:
   - *start offset* and *length*, jittered by up to ± `g start vari` %;
   - *delay*, set to time × (1 ± `time vari` %);
   - *pan*, set to centre ± `pan vari`/2;
   - *pitch*, set to 2^(octave + random × oct vari) × ratio[a random enabled
     key]. The ratios come from equal temperament or a 5-limit just table
     (15/16, 8/9, 2/3, 4/3, 9/5, 15/8, …);
   - *reverse*: with probability `g reversal` %, the grain plays backward.
5. **Grain envelope.** Grains shorter than 0.1 s use a triangle envelope.
   Longer grains use 50 ms linear ramps at each end.
6. **Feedback.** The grains are summed. The sum × feedback goes through a
   2-pole resonant low-pass, which is bypassed at 19 kHz and above. Resonance
   0–100 % moves the damping from 1.414 down to 0.1. The result is written back
   into the line.
7. **Output.** The wet signal is arctangent-soft-clipped, crossfaded with the
   dry by wet/dry, multiplied by out-gain and clipped at ±1.5.

The output is stereo even when the input is mono, because of the per-grain pan.
On MIDI, a note-on turns on the key `note mod 12` and sets octave to
`note / 12 − 5`, clamped to ±4. The matching note-off clears that key, and
controller 123 (all notes off) clears every key.

**Here.** New: a `Bubbler` ShapeKind. It is a delay buffer with an
eight-voice grain scheduler. The grain code in `grain.rs` serves the
time-stretch engines, not the rack, but its windowing can be reused.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `delayMs` | Time | 10–10 000 | 80 | yes | ms |
| `timeVar` | Time vari | 0–1 | 0 | | |
| `feedback` | Feedback | 0–2 | 0 | | |
| `filterHz` | Filter | 20–20 000 | 20 000 | yes | Hz |
| `resonance` | Resonance | 0–1 | 0.1 | | |
| `panVar` | Pan vari | 0–1 | 0 | | |
| `density` | Density | 0–2 | 0.5 | | |
| `grainSize` | Grain size | 0–0.5 (× delay time) | 0.3 | | |
| `startVar` | Start vari | 0–1 | 0 | | |
| `octave` | Octave | −4 to 4 (whole steps) | 0 | | oct |
| `octaveVar` | Oct vari | 0–2 | 0 | | oct |
| `reverse` | Reverse | 0–1 | 0 | | |
| `just` | Just tuning | 0–1 (switch) | 0 | | |
| `key0` … `key11` | Unison … Major 7th | 0–1 (switch) | 0 (none on = unison) | | |
| `mix` | Mix | 0–1 | 0.5 | | |

**Shared panel.**

- **Delay:** Time (primary), Time vari, Feedback.
- **Filter:** Filter, Resonance.
- **Grains:** Density, Grain size, Start vari, Pan vari, Reverse.
- **Pitch:** Octave, Oct vari, the 12-key interval keyboard (a display-style
  row of switches laid out as one octave of piano keys, as the original
  does), and a Just switch.
- **Header:** Mix and the meters.
- **Prism pad:** X `density` 0–2, Y `grainSize` 0–0.5.

**Tests.**

- Density 0 with mix 1 gives silence after the input stops and the buffer
  drains.
- With one key on (unison), octave +1, oct vari 0 and reverse 0, the output's
  dominant frequency is twice that of a sine input.
- Reverse 1 with a rising chirp input produces only falling grains: the
  frequency slope within each grain is negative.
- Feedback 2 with a 0 dBFS input stays bounded (|y| ≤ 1.5) over 30 s.

**Open questions.**

- **Grain size unit.** `grain size` declares "ms", but the DSP scales it as a
  percent of the delay time. Should it follow the DSP, as above, or become real
  milliseconds?
- **MIDI.** Should the keyboard and octave be playable from MIDI once the app
  has MIDI input?

---

### ++delay
*SoundHack Delay Trio, Tom Erbe, 2018 (v. 9.11) · AU `aufx` "+2dl" / VST / VST3 · `delay_trio_rm.pdf`; Info.plist, `.rsrc`; x86_64 constructor, lambdas, editor constructor and `resized`, `processBlock` (Ghidra)*

The "most typical delay options" member of the trio. It is one interpolated
delay line per channel, with a large set of extras:

- an LFO and an envelope follower that both modulate the delay time;
- a resonant low-pass and a high-pass inside the feedback loop;
- feedback to 200 %, held in check by the loop's gain stage;
- polarity, freeze and a second crossfaded read head.

With two heads and a ramp LFO, it becomes a tape-style pitch shifter.

**Original interface.** The window is 474×302 and has no screenshot. Four
large dials form the top row (102×102). Six dials form the second row
(72×72). Five switches sit on a row at y=256.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| time | large dial | 1–10 000 ms, skew 0.3 | 80 | 6,48 (102×102) · delay |
| feedback | large dial | 0–200 % | 0 | 126,48 · delay |
| lfofreq | large dial | 0.01–10 Hz, skew 0.3 | 1 | 246,48 · modulation |
| lfodepth | large dial | 0–100 %, skew 0.2 | 0 | 366,48 · modulation |
| lfoshape | dial (menu) | sine, tri, square, ramp+, ramp−, rand | sine | 6,166 (72×72) · modulation |
| lfophase | dial | −180 to 180° (right channel's LFO offset) | 0 | 84,166 · modulation |
| autotime | dial | 0–100 % (`envmodulate`) | 0 | 162,166 · modulation |
| lpf-freq | dial | 20–20 000 Hz, skew 0.3 | 20 000 | 240,166 · filter |
| hpf-freq | dial | 20–2000 Hz, skew 0.3 | 20 | 318,166 · filter |
| resonance | dial | 0–100 % | 10 | 396,166 · filter |
| feedback + / − | switch | "feedback +" (0), "feedback −" (1) | + | 6,256 (84×18) |
| freeze | switch | on/off | off | 108,256 (78×18) |
| delaylock | switch | on/off | off | 204,256 |
| lfolock | switch | on/off | off | 300,256 |
| onehead / twohead | switch | "onehead" (0), "twohead" (1) | onehead | 390,256 |
| wet/dry | small dial | 0–100 % | 50 | 336,6 (36×36) |
| in / out | small dials and meters | ±20 dB | 0 | 390,6 / 432,6 |
| colour | small dial | 0–1 | 0 | 6,280 (18×18) |

**Signal flow.** Per channel (stereo in gives two independent lines):

1. **Glide.** The delay time glides to each new value over 100 ms.
2. **LFO.** It is a wavetable (sine, tri, square, ramp up, ramp down) at
   lfofreq. *rand* picks a new random target once per cycle and slides to it.
   The right channel reads the LFO lfophase/360 of a cycle ahead.
3. **Envelope.** An envelope follower takes the running mean of |L+R| over a
   short window.
4. **Effective delay.** It is time × (1 + depth × LFO), minus time × (autotime
   × 0.06 × envelope, capped at 1). So louder input shortens the delay and
   bends the pitch.
5. **Locks.** *delaylock* snaps the delay to whole multiples or fractions of
   the host's beat. *lfolock* does the same to the LFO rate.
6. **Read and loop.** The line is read with Hermite interpolation. The read ×
   feedback (signed by the polarity switch) + input then passes through, in
   order:
   - the low-pass: 2-pole, resonance 0–100 % taking the damping from 1.414 down
     to 0.1, bypassed at 19 kHz and above;
   - the high-pass: 2-pole Butterworth;
   - the shared DC blocker and level-riding gain stage;
   - and is written back.
7. **Two heads.** *twohead* adds a second read head with its LFO half a cycle
   away. The two heads are crossfaded through a window table, a Tempophon dual
   head. With a ramp shape, this pitch-shifts the repeats.
8. **Freeze.** The line recirculates its own delayed sample and ignores new
   input, so the loop holds. The dry signal still passes.
9. **Output.** The wet signal is arctangent-soft-clipped, then mixed by
   wet/dry, scaled by out-gain and clipped at ±1.5.

**Here.** New: a `DelayPlus` ShapeKind. Echo shares the idea, but it caps at
4 s and ±0.98 feedback, and it has no modulation, high-pass, freeze or second
head. Its `glideMs` is the same as this plug-in's fixed 100 ms glide.
Extending Echo would add twelve keys and put a gain stage into a loop that
saved documents hear as linear. Instead, the new effect reuses Echo's `Delay`
line.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `delayMs` | Time | 1–10 000 | 80 | yes | ms |
| `feedback` | Feedback | 0–2 | 0 | | |
| `invert` | Feedback − | 0–1 (switch) | 0 | | |
| `rateHz` | LFO rate | 0.01–10 | 1 | yes | Hz |
| `depth` | LFO depth | 0–1 | 0 | | |
| `shape` | LFO shape | 0–5 (sine, tri, square, ramp+, ramp−, random) | 0 | | |
| `phase` | LFO phase | −180 to 180 | 0 | | ° |
| `envMod` | Auto time | 0–1 | 0 | | |
| `lowpassHz` | Low-pass | 20–20 000 | 20 000 | yes | Hz |
| `highpassHz` | High-pass | 20–2000 | 20 | yes | Hz |
| `resonance` | Resonance | 0–1 | 0.1 | | |
| `freeze` | Freeze | 0–1 (switch) | 0 | | |
| `twoHead` | Two heads | 0–1 (switch) | 0 | | |
| `mix` | Mix | 0–1 | 0.5 | | |

**Shared panel.**

- **Delay:** Time and Feedback as large dials (primary, as in the original),
  then Feedback −, Freeze and Two heads switches.
- **Modulation:** LFO rate, LFO depth, LFO shape (menu), LFO phase, Auto time.
- **Filter:** Low-pass, High-pass, Resonance.
- **Header:** Mix and the meters.
- **Prism pad:** X `delayMs` 1–2000 ms (log), Y `feedback` 0–1.2. This is
  Hyperprism Echo's pair.

**Tests.**

- With feedback 0, LFO depth 0 and mix 1, an impulse comes out exactly
  `delayMs` later, within one sample.
- Freeze on: after the input goes silent, the output's RMS over the next 5 s
  stays within 1 dB of the RMS just before.
- Feedback 2 with any input never exceeds |1.5|, and does not grow over 60 s.
- Two heads with ramp+ at depth 1: a 440 Hz sine comes out with a steady
  shifted pitch, not at 440 Hz.

**Open questions.** None beyond the batch-wide tempo-sync question. The two
locks are the sync controls here.

---

### ++flipper
*SoundHack Delay Trio, Tom Erbe, 2018 (v. 9.12) · AU `aufx` "+2fp" / VST / VST3 · `delay_trio_rm.pdf`; Info.plist, `.rsrc`; x86_64 constructor, `createEditor`, `resized`, `paint`, `processBlock` (Ghidra)*

A "segmented sound reverser". It cuts the input into consecutive segments and
plays each one backward as the next one is recorded. The old and new reversed
segments are crossfaded so the seams do not click. With tempo lock, the
segments become beat-length chunks, which turns it into a rhythmic reverser.

**Original interface.** The window is 474×120 and has no screenshot. It has
two full-width horizontal sliders, and a third row with the colour control and
one switch. This is the same layout as ++matrix and ++decimate.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| fliptime | horizontal slider | 0.1–10 s, skew 0.3 | 1 | 6,48 (462×18) |
| overlap | horizontal slider | 0–100 % | 15 | 6,72 (462×18) |
| tempolock | switch | on/off | off | 30,96 (84×18) |
| in / out | small dials and meters | ±20 dB | 0 | 390,6 / 432,6 |
| colour | small dial | 0–1 | 0 | 6,96 (18×18) |

**Signal flow.**

1. **Write.** Input × in-gain is written to a ring per channel.
2. **Read.** Two read pointers step backward through it.
3. **Flip.** When the current segment has run for `fliptime` × sr samples, a
   flip happens. The newest reversed head jumps to the write position. The
   previous head carries on backward and fades out. The new head fades in.
4. **Fade length.** The fade takes `overlap` × segment samples, with a floor
   of one sample.
5. **No dry.** The output is reversed audio only. There is no wet/dry.
6. **tempolock.** It replaces the segment with the host's beat length doubled
   or halved until it brackets `fliptime`, clamped to 0.05–20 s.
7. **Output.** Out-gain is applied, then the clip at ±1.5.

**Here.** Adjust Boomerang (`ReverseMix`, `REV_SPECS`), which is the same idea
with a fixed seam fade.

- Raise `throwMs`'s maximum from 2000 to 10 000. `MAX_THROW_S` goes from 2 to
  10, which costs about 15 MB at 48 kHz × 8 channels.
- Add `overlap`. Its default must equal the current fixed fade expressed as a
  fraction of the throw, so saved slots sound the same.
- A Flipper preset is `mix` 1.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `throwMs` | Throw | 20–10 000 (was 20–2000) | 400 | yes | ms |
| `mix` | Mix | 0–1 | 0.5 | | |
| `overlap` | Overlap | 0–1 | current fade ÷ throw | | |

**Shared panel.** One group with two horizontal sliders, Throw (primary) and
Overlap, matching the original's two full-width sliders. Mix and the meters
go in the header. Prism pad: X `throwMs` 50–4000 ms (log), Y `overlap` 0–1.

**Tests.**

- Mix 1, throw 500 ms, with a rising sine sweep as input: within each 500 ms
  segment the output frequency falls.
- Overlap 0 against overlap 0.5 at a segment seam: the 0.5 case's
  sample-to-sample step at the seam is smaller.
- An existing document's Boomerang slot renders identical audio before and
  after the change.

**Open questions.**

- **Overlap scaling.** The binary multiplies the 0–100 overlap value directly
  by the segment length, so the default of 15 means a fade of 15 segments.
  A divide by 100 may have been lost. Should the rebuild follow the binary
  literally, or treat overlap as a percent, as the label says (as above)?

---

### ++pitchdelay
*SoundHack Delay Trio, Tom Erbe, 2018 (v. 9.11) · AU `aumf` "+2pd" / VST / VST3 · `delay_trio_rm.pdf`; Info.plist, `.rsrc`; x86_64 constructor, lambdas (`%dc`, "12tet" / "just"), constructor tables, `resized`, `processBlock` (Ghidra)*

"Essentially the same plug-in" as ++delay, with its controls aimed at pitch.
A Tempophon dual-head shifter sits inside a delay's feedback loop, so every
repeat is transposed again: an echo that climbs or falls. Transposition is
semitones, cents and octaves, in equal or 5-limit just tuning. This is very
likely what HYPERPRISM.md's open question imagines for EchoTranz: "a
transpose control on Echo, with a pitch shifter in the feedback path".

**Original interface.** The window is 474×186 and has no screenshot. It has
one row of six dials, with two switches below.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| time | dial | 5–5000 ms, skew 0.25 | 80 | 6,48 (72×72) · delay |
| pitch | dial | −12 to +12 semitones, step 1 | 0 | 84,48 · pitch |
| cents | dial | −100 to +100, step 1 (shown "%dc") | 0 | 162,48 · pitch |
| octave | dial | −3 to +3, step 1 | 0 | 240,48 · pitch |
| feedback | dial | 0–200 % | 0 | 318,48 · delay |
| depth | dial | 0–100 % (`loopdepth`) | 0 | 396,48 · pitch |
| 12tet / just | switch | 0 = "12tet", 1 = "just" | 12tet | 6,138 (72×18) |
| delaylock | switch | on/off | off | 96,138 (96×18) |
| wet/dry | small dial | 0–100 % | 50 | 342,6 (36×36) |
| in / out | small dials and meters | ±20 dB | 0 | 390,6 / 432,6 |
| colour | small dial | 0–1 | 0 | 6,162 (18×18) |

**Signal flow.**

1. **Pitch ratio.** ratio = table[pitch] × 2^(cents/1200 + octave). The table
   is equal temperament, or a just table (15/16, 8/9, 2/3, 4/3, 9/5, 15/8 …
   up to 2) when *just* is on.
2. **Two heads.** Two read heads, half a cycle apart, drift through the line
   at (ratio − 1) samples per sample. They wrap inside a span of `depth` % of
   the delay time, with a floor of 1 %. Each head is weighted by a crossfade
   window.
3. **Feedback loop.** The pair's output × feedback + input goes through the
   shared DC blocker and gain stage, and is written back. So the shift
   compounds on each repeat.
4. **Lock.** *delaylock* snaps the delay to the host's beat.
5. **Output.** The wet signal is soft-clipped with an arctangent, then mixed,
   scaled and clipped at ±1.5.
6. **MIDI.** A note-on sets pitch to `note mod 12` (0 to +11) and octave to
   `note / 12 − 5`, clamped to ±3.

**Here.** Adjust Harmonizer (`PitchShifter`, `PITCH_SPECS`). Its `PitchCore`
is already this dual-head crossfade. What it lacks is a delay before the
heads. Each addition below has a default that leaves current slots unchanged.

- **`delayMs`.** Default 0. At 0, the window is the whole delay, which is
  today's behaviour.
- **`cents`.**
- **`just`.** When on, `semitones` reads through the just table.
- **`semitones` range.** Widened to ±48, which takes in the original's
  ±12 st × ±3 oct.
- **`feedback` maximum.** Raised from 0.95 to 2. The level-riding gain stage
  engages only when feedback is above 0.95.
- **`windowMs`.** Stays as it is. The original's depth maps to windowMs =
  delayMs × depth.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `semitones` | Pitch | −48 to 48 (was ±24) | 7 | | st |
| `windowMs` | Window | 10–250 | 60 | yes | ms |
| `feedback` | Feedback | 0–2 (was 0–0.95) | 0 | | |
| `wet` | Wet | 0–1 | 0.5 | | |
| `dry` | Dry | 0–1 | 1 | | |
| `delayMs` | Delay | 0–5000 | 0 | | ms |
| `cents` | Cents | −100 to 100 | 0 | | ct |
| `just` | Just tuning | 0–1 (switch) | 0 | | |

**Shared panel.**

- **Delay:** Delay, Feedback.
- **Pitch:** Pitch (primary), Cents, Window, and a Just switch. The original's
  separate octave dial is folded into Pitch.
- **Header:** Wet and Dry. The original's single wet/dry dial is drawn as
  these two.
- **Prism pad:** X `semitones` −12 to 12, Y `feedback` 0–1.2.

**Tests.**

- With delayMs 0, the output matches the current Harmonizer bit for bit.
  This is the regression test.
- delayMs 300, semitones 12, feedback 0.9, wet 1, dry 0, with a 220 Hz input
  burst: the repeats come at 300 ms intervals, at 440, then 880 Hz.
- Just on, semitones 7: the output-to-input frequency ratio is 1.5 (3/2),
  not 2^(7/12).
- Feedback 2 with continuous input stays below |1.5|.

---

### ++chebyshev
*SoundHack Freesound, Tom Erbe, 2015 (screenshot v. 9) / 2017 (binary v. 9.10) · AU `aufx` "+2ch" / VST / VST3 · `freesound_manual.pdf` text and screenshot `p001-2.png`; Info.plist, `.rsrc`; x86_64 constructor, editor constructor, `resized`, `processBlock` (Ghidra)*

A harmonic distortion built from Chebyshev polynomials. Fed a full-scale
sine, polynomial Tₖ produces exactly the k-th harmonic. A level per polynomial
is therefore a level per added harmonic. Erbe's own guide is: T3 for gentle
saturation, T7 for harsh, and T2 or T4 for "a dying amplifier".

**Original interface.** The window is 474×162. The screenshot shows a teal
title badge and six dials in a row, labelled cp 1, cp 2, cp 3, cp 4, cp 5,
cp 7. They show 0.00 and five −60.00 values, which are the defaults. Below are
the colour dot and the version footer. There is no cp 6.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| cp 1 | dial | −60 to 0 dB | 0 | 6,48 (72×72) |
| cp 2 | dial | −60 to 0 dB | −60 | 84,48 |
| cp 3 | dial | −60 to 0 dB | −60 | 162,48 |
| cp 4 | dial | −60 to 0 dB | −60 | 240,48 |
| cp 5 | dial | −60 to 0 dB | −60 | 318,48 |
| cp 7 | dial | −60 to 0 dB | −60 | 396,48 |
| in / out | small dials and meters | ±20 dB | 0 | 390,6 / 432,6 |
| colour | small dial | 0–1 | 0 | 6,138 (18×18) |

**Signal flow.**

1. **Drive.** x = input × in-gain.
2. **Shape.** y = Σ gₖ·Tₖ(x) ÷ Σ gₖ, over k = 1, 2, 3, 4, 5, 7, where
   gₖ = 10^(dB/20).
   - Dividing by the sum keeps the output level near the input's at full
     scale.
   - −60 dB means 0.001, not off.
   - T2 and T4 carry constant terms (−1 and +1). Odd settings therefore add
     DC, and the original does nothing about it.
3. **Output.** Out-gain is applied, then the clip at ±1.5. Channels are
   independent. There is no oversampling.

**Here.** New: a `Chebyshev` ShapeKind.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `driveDb` | Drive | −20 to 20 | 0 | | dB |
| `h1Db` | Fundamental | −60 to 0 | 0 | | dB |
| `h2Db` | 2nd | −60 to 0 | −60 | | dB |
| `h3Db` | 3rd | −60 to 0 | −60 | | dB |
| `h4Db` | 4th | −60 to 0 | −60 | | dB |
| `h5Db` | 5th | −60 to 0 | −60 | | dB |
| `h7Db` | 7th | −60 to 0 | −60 | | dB |

**Shared panel.** One "Harmonics" group of six dials in order 1, 2, 3, 4, 5,
7, as in the original, with Drive first and primary. A small bar display of
the six levels would show the harmonic recipe at a glance. Prism pad: X `h3Db`
−60 to 0, Y `h2Db` −60 to 0, the odd/even balance.

**Tests.**

- Defaults: for |x| ≤ 1 the output is within 0.01 of the input. It is not
  exact, because the −60 dB terms are 0.001, not 0.
- h1 at −60 and h3 at 0, with a full-scale 100 Hz sine: the output's largest
  component is at 300 Hz, at least 40 dB above 100 Hz.
- h2 at 0, with a full-scale sine: the output has a 2nd harmonic and a
  non-zero DC term.
- Drive +20 dB on a 0 dBFS input never exceeds |1.5|.

**Open questions.**

- **DC.** Should the rebuild add a DC blocker after the even orders? The
  original does not, and a following DC slot handles it.

---

### ++compand
*SoundHack Freesound, Tom Erbe, 2014 (screenshot v. 9) / 2017 (binary v. 9.10) · AU `aufx` "+2cm" / VST / VST3 · `freesound_manual.pdf` text and screenshot `p001-0.png`; release notes; x86_64 constructor, lambdas, editor `paint` / `resized`, `processBlock`, `CompInitGainTable`, `CompSetThreshold`, `CompRMSDetect` (Ghidra)*

A compressor and downward expander in one. The ratio knob runs from heavy
compression above the threshold, through 1:1, to expansion below it. It has a
soft knee, a peak or RMS detector with an adjustable RMS window ("response"),
and stereo linking. The gain curve is a precomputed 8192-point table indexed
by the detected level.

**Original interface.** The window is 474×186. The screenshot has a pink
badge and six dials, showing ratio "2.0:1", threshold −20.00, attack 5.00,
release 0.60, softknee 0.00 and response 64. Below them are a "peak detect"
switch (white) and a "linked" switch (grey, so on). At the top right, the
in/out dials read 0 and 10.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| ratio | dial | 0.025–4 slope, skew 0.4. Shown "N:1" below 1 and "1:N" above | 1 (1:1) | 6,48 (72×72) |
| threshold | dial | −60 to 0 dB | −20 | 84,48 |
| attack | dial | 1–100 ms | 5 | 162,48 |
| release | dial | 0.1–2 s | 0.5 | 240,48 |
| softknee | dial | 0–1 | 0 | 318,48 |
| response | dial | 64–4096 samples, step 1, skew 0.3 | 480 | 396,48 |
| peak detect / rms detect | switch | 0 = peak, 1 = rms | peak | 6,138 (84×18) |
| not linked / linked | switch | 0 / 1 | not linked | 108,138 (84×18) |
| in | small dial and meter | ±20 dB | 0 | 390,6 |
| out | small dial and meter | 0–60 dB (makeup) | 10 | 432,6 |
| colour | small dial | 0–1 | 0 | 6,162 (18×18) |

**Signal flow.**

1. **Detector.** In peak mode it is |x|. In RMS mode it is the root of a
   running mean square over `response` samples.
2. **Envelope.** The detected level is followed with separate attack and
   release rates. Release falls 20 dB per `release` seconds.
3. **Gain.** The envelope indexes the gain table, and the result is averaged
   with the previous sample's gain. With level L dB, threshold T and knee
   width K = softknee × 12 dB:
   - **ratio < 1 (compression):** above T, the gain is (T − L)(1 − ratio) dB,
     so the output slope above T is `ratio`, and 0.5 means 2:1.
   - **ratio > 1 (expansion):** below T, the gain is (L − T)(ratio − 1) dB.
   - Either way, the K-dB band below the knee point is blended in.
4. **Stereo.** Channels are processed alone unless *linked* is on. Linked,
   the louder channel's level sets one gain for both.
5. **Output.** Out (makeup) gain is applied, then the clip at ±1.5.

**Here.** Adjust Compressor (`comp.rs`). It is already feed-forward with a
soft knee and a linked peak detector. Add:

- an `expand` ratio for below threshold (1 = off);
- the RMS detector and its window;
- a `link` switch, default on, which is today's behaviour;
- a higher `ratio` ceiling, 20 → 40, for the original's 0.025 slope.

Mapping: an original ratio s < 1 becomes `ratio` = 1/s, and s > 1 becomes
`expand` = s. softknee × 12 becomes `kneeDb`, attack and release become
`attackMs` and `releaseMs`, and out becomes `makeupDb`. Makeup above 24 dB is
out of range and goes to a Gain slot. In becomes a Gain slot before.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `ratio` | Ratio | 1–40 (was 1–20) | existing | | :1 |
| `expand` | Expand | 1–4 | 1 | | 1: |
| `detect` | RMS | 0–1 (switch: peak / RMS) | 0 | | |
| `rmsMs` | Response | 1–100 | 10 | yes | ms |
| `link` | Linked | 0–1 (switch) | 1 | | |

**Shared panel.**

- **Dials, in the original's order:** Ratio (primary), Threshold, Attack,
  Release, Knee, Response.
- **Switches:** RMS and Linked.
- **Header:** Makeup and the meters, plus a gain-reduction display.

The original's single ratio dial, which runs from 40:1 through 1:1 to 1:4,
could be drawn as one bipolar dial writing `ratio` or `expand`. That would be
a UI choice only. Prism pad: X `thresholdDb` −60 to 0, Y `ratio` 1–20. This is
the existing Hyperprism Compressor pair.

**Tests.**

- With expand 1, detect 0 and link 1, the output matches the current
  Compressor bit for bit.
- Threshold −20, ratio 2, knee 0, with a steady −10 dBFS sine: the output
  settles at −15 dBFS (± 0.5).
- Expand 2, threshold −20, with a −30 dBFS sine: the output settles at
  −40 dBFS.
- Link 0, with a loud left channel and a quiet right channel: the right
  channel is not reduced.

**Open questions.**

- **Attack.** The attack coefficient is computed differently from release,
  and its exact curve was not settled by the static read. Should Attack keep
  the app's one-pole time constant, as assumed above?

---

### ++decimate
*SoundHack Freesound, Tom Erbe, 2015 (screenshot v. 9) / 2017 (binary v. 9.10) · AU `aufx` "+210" / VST / VST3 · `freesound_manual.pdf` text and screenshot `p001-3.png`; x86_64 constructor, lambdas, editor, `processBlock` (Ghidra)*

Bit-depth and sample-rate reduction "for added aliasing and decimation
noise". Two details separate it from a plain crusher:

- **Fractional bits.** Bit depth is continuous: between whole depths, it
  crossfades the two neighbouring truncations.
- **Averaging.** The rate reduction averages each block of N samples before
  holding the result. A plain crusher keeps one sample. N is a power of two.

**Original interface.** The window is 474×120. The screenshot has a red
badge and two full-width sliders, labelled "depth" (32.00) and "averaging"
(1.00).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| depth | horizontal slider | 1–32 bits, continuous, skew 0.3 | 32 | 6,48 (462×18) |
| averaging | horizontal slider | 1–256 samples. The parameter `folding` steps by 1, but display and DSP snap to 1, 2, 4 … 256 | 1 | 6,72 (462×18) |
| in / out | small dials and meters | ±20 dB | 0 | 390,6 / 432,6 |
| colour | small dial | 0–1 | 0 | 6,96 (18×18) |

**Signal flow.**

1. **Drive.** Input × in-gain.
2. **Average.** Over each run of N samples (N from averaging), the input is
   averaged.
3. **Quantise.** The average is scaled to a 32-bit integer and masked to its
   top ⌊depth⌋ bits. It is also masked to ⌊depth⌋+1 bits, and the two are
   blended by the fractional part of depth.
4. **Hold.** The result is held for the N output samples.
5. **Output.** There is no anti-alias filter. Out-gain is applied, then the
   clip at ±1.5. Channels are independent.

**Here.** Adjust the planned Decimator (HYPERPRISM.md: `rate` 1–100 % hold,
`bits` 1–24, `mix`). It is not built yet, so no saved values are at stake.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `rate` | Sample rate | 0.39–100 (was 1–100) | 100 | yes | % |
| `bits` | Bit depth | 1–32 continuous (was 1–24) | 32 | | bits |
| `average` | Average | 0–1 (switch: hold / average) | 0 | | |
| `snap` | Power of two | 0–1 (switch) | 0 | | |
| `driveDb` | Drive | −20 to 20 | 0 | | dB |
| `mix` | Mix | 0–1 | 1 | | |

`rate` = 100/N. With `snap` on, N is rounded to a power of two. An ++decimate
preset is `average` 1 and `snap` 1. With `bits` fractional, the effect blends
⌊bits⌋ and ⌊bits⌋+1 truncations, as in the original.

**Shared panel.** Two horizontal sliders, Sample rate (primary) and Bit
depth, as in the original. Average and Power of two switches sit under them.
Drive and Mix go in the header. Prism pad: X `rate` 1–100 % (log), Y `bits`
1–24. This is Hyperprism Sonic Decimator's pair.

**Tests.**

- Rate 100 and bits 32 pass the input unchanged, to 32-bit precision.
- Bits 1: the output takes at most 2 distinct values. Bits 1.5: at most 4,
  and the mean error lies between the 1-bit and 2-bit cases.
- Average 1, snap 1, rate 25 % (N = 4): every 4-sample block of output is
  constant and equals the mean of its 4 inputs.
- Average 0, rate 25 %: each block equals its first input sample.

---

### ++matrix
*SoundHack Freesound, Tom Erbe, 2015 (screenshot v. 9) / 2017 (binary v. 9.10) · AU `aufx` "+2mx" / VST / VST3 · `freesound_manual.pdf` text and screenshot `p002-0.png`; x86_64 constructor, lambdas, editor, `processBlock` (Ghidra)*

A mid/side encoder or decoder with a gain on each of mid and side. Erbe's
intended use is a sandwich: encode, process only the centre or only the sides
with other plug-ins, then decode. It is also for real M/S microphone pairs.

**Original interface.** The window is 474×120. The screenshot has a beige
badge and two full-width sliders, "mid gain" and "side gain" (0.00 each).
Below them are the colour dot and a "LR > MS" switch.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| mid gain | horizontal slider | −12 to +12 dB | 0 | 6,48 (462×18) |
| side gain | horizontal slider | −12 to +12 dB | 0 | 6,72 (462×18) |
| direction | switch | 0 = "LR>MS" (encode), 1 = "MS>LR" (decode) | LR>MS | 30,96 (84×18) |
| in / out | small dials and meters | ±20 dB | 0 | 390,6 / 432,6 |
| colour | small dial | 0–1 | 0 | 6,96 (18×18) |

**Signal flow.** Stereo only. Both inputs are scaled by in-gain first.

- **Encode:** left out = ½(L+R) × mid × out, and right out = ½(L−R) × side ×
  out. Encode is not clipped.
- **Decode:** left out = (M × mid + S × side) × out, and right out =
  (M × mid − S × side) × out, clipped at ±1.5.

Encode followed by decode at unity returns the input.

**Here.** Adjust the planned Stereo Matrix. It is not built, so its ranges
can still move. Add a `mode` menu:

- **0, Process (the plan's behaviour):** L/R in, M/S gains and rotation, L/R
  out;
- **1, Encode:** L/R in, M on left and S on right out;
- **2, Decode:** the reverse.

Widen `midGain` and `sideGain` to 0–4. That covers +12 dB (3.98), and the
display should show dB.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `mode` | Mode | 0–2 (Process, Encode LR→MS, Decode MS→LR) | 0 | | |
| `midGain` | Mid | 0–4 (was 0–2) | 1 | | x |
| `sideGain` | Side | 0–4 (was 0–3) | 1 | | x |

The other planned keys (`pan`, `gainDb`, `rotate`, `monoBelowHz`) are
unchanged and apply in Process mode.

**Shared panel.** Mid (primary) and Side as two horizontal sliders, as in the
original, then the Mode menu. In Process mode, the plan's Pan, Position and
Mono below follow. Prism pad: X `midGain` 0–2, Y `sideGain` 0–2.

**Tests.**

- An Encode slot followed by a Decode slot, all at unity, gives
  L_out = L_in and R_out = R_in within 1e-6.
- Encode with a mono input (L = R): the right output (side) is 0.
- Decode with sideGain 0: the left and right outputs are identical.

---

### ++phasor
*SoundHack Freesound, Tom Erbe, 2015 (screenshot v. 9) / 2017 (binary v. 9.10) · AU `aufx` "+2pz" / VST / VST3 · `freesound_manual.pdf` text and screenshot `p002-1.png`; x86_64 constructor, lambdas, editor, `processBlock` (Ghidra)*

A phaser built from eight cascaded second-order all-pass sections, all tuned
to one LFO-swept frequency. Its distinctive control is the outputs. Taps after
1, 2, 4 and 8 sections (360°, 720°, 1440° and 2880°, giving 1, 2, 4 and 8
notches) can each be switched on. The switched-on taps are summed with the dry
signal. The feedback is inverted and saturated.

**Original interface.** The window is 474×186. The screenshot has a blue badge
and six dials, reading frequency 948.7, width 1.00, feedback 0.00, modfreq
0.32, moddepth 50.0 and modshape "sine". Under them are output switches
"360out" (grey, so on), "720out", "1440out" and "2880out", and a "tempolock"
switch under modshape. The v9.10 binary labels the same four switches
"360 out", "720 out", "1080 out" and "1440 out". Its parameter ids are
`360out`, `720out`, `1080out` and `1440out`, but the DSP taps after 1, 2, 4 and
8 sections. So the screenshot's labels are the true ones.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| frequency | dial | 300–3000 Hz, skew 0.3 | 500 | 6,48 (72×72) · filter |
| width | dial | 0.1–10 (`bandwidth`, relative to frequency), skew 0.3 | 1 | 84,48 · filter |
| feedback | dial | 0–100 | 50 | 162,48 · filter |
| modfreq | dial | 0.01–10 Hz (`lfospeed`), skew 0.25 | 1 | 240,48 · LFO |
| moddepth | dial | 0–100 (`lfodepth`) | 50 | 318,48 · LFO |
| modshape | dial (menu) | sine, tri, rand (step 1) | sine | 396,48 · LFO |
| 360out | switch | on/off | on | 6,138 (72×18) · outputs |
| 720out | switch | on/off | off | 84,138 · outputs |
| 1440out (`1080out`) | switch | on/off | off | 162,138 · outputs |
| 2880out (`1440out`) | switch | on/off | off | 240,138 · outputs |
| tempolock | switch | on/off | off | 384,138 (84×18) · LFO |
| in / out | small dials and meters | ±20 dB | 0 | 390,6 / 432,6 |
| colour | small dial | 0–1 | 0 | 6,162 (18×18) |

**Signal flow.**

1. **Centre frequency.** f = frequency × 4^(LFO × moddepth/100), so depth 100
   sweeps ±2 octaves. The LFO is a sine or triangle table, or *rand*: a new
   random target each cycle with a linear slide, drawn per channel.
   *tempolock* replaces modfreq with one cycle per host beat.
2. **Sections.** Each section is a 2-pole all-pass. Its pole radius is
   r = e^(−π·width·f/sr), and its coefficients are −2r·cos(2πf/sr) and r².
3. **Chain input.** It is x + atan(−0.125 × feedback × previous output), so
   the feedback is negative and soft-limited.
4. **Output.** y = atan((x + Σ enabled taps) × out ÷ (1 + number of enabled
   taps)), clipped at ±1.5.

**Here.** Adjust Phaser (`phaser.rs`). It is already Smith's all-pass chain
with `notches` 1–8 sections. Add:

- an LFO `shape`;
- four tap switches. With all four off (the default), the output is today's
  single tap after `notches` sections. With any on, the output becomes the
  original's normalised dry + taps sum.

Mapping:

| Original | Phaser key |
| --- | --- |
| frequency | `centreHz` |
| spread | 1 (all sections on one frequency) |
| width | `resonance` = e^(−π·width·centreHz/sr), approximate because it varies with f |
| modfreq | `rateHz` |
| moddepth | `sweep` (see open questions) |
| feedback | negative `feedback`, roughly −feedback/100 × 0.95 |
| stereo | 0 |

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `shape` | LFO shape | 0–2 (sine, triangle, random) | 0 | | |
| `tap1` | 360° out | 0–1 (switch) | 0 | | |
| `tap2` | 720° out | 0–1 (switch) | 0 | | |
| `tap4` | 1440° out | 0–1 (switch) | 0 | | |
| `tap8` | 2880° out | 0–1 (switch) | 0 | | |

**Shared panel.**

- **Filter:** Centre (primary), Notch width, Feedback, Notches.
- **LFO:** Rate, Sweep, LFO shape (menu).
- **Outputs:** the four tap switches in a row, as in the original.
- **Header:** Wet and Dry.
- **Prism pad:** X `rateHz` 0–10, Y `sweep` 0–4 oct. This is the existing
  Phaser pair: rate and depth.

**Tests.**

- With all taps off, the output matches the current Phaser bit for bit.
- tap1 only, rate 0, sweep 0, centre 1000 Hz, wet/dry as in the original:
  white noise in gives a notch at 1000 Hz (≥ 20 dB down).
- tap8 only: the same input gives 8 notches.
- Shape random: two runs with different seeds give different sweep paths,
  and both stay within the sweep range.

**Open questions.**

- **Sweep span.** Is Phaser's `sweep` the total span or ± span? The original's
  depth 100 means ±2 octaves, which is `sweep` 4 or 2.
- **LFO display.** The v9.10 value-to-text shows "sine" for both 0 and 1, and
  "tri" is unreachable. The DSP uses 0 = sine, 1 = tri, 2 = rand. This looks
  like an original display bug and is not carried over.

---

**Batch open questions.**

- **Tempo.** Five originals lock to the host tempo (++delay ×2, ++pitchdelay,
  ++bubbler, ++flipper, ++phasor). Each lock is described above, ready for
  whenever the rack gets a tempo source, as in batch C1.
- **MIDI.** ++bubbler (interval keys, octave) and ++pitchdelay (pitch,
  octave) are playable from MIDI note-ons in the original. Should these
  become automation targets fed by a future MIDI input, or be dropped?

---

## Built

*23 October 2026. In prism-fx, so MultiGrainLive and idMLab share them.*

**How it differs from the spec above.** Each plug-in is its own prism effect,
named after the original (`prism:sh-delay`, label "++delay"), not an
adjustment of an existing effect. The decompiled code was read again for each
one before building (static reading only), and that reading corrects the spec
in places, noted below. Each keeps its own in and out gain, as the original
did. Tempo locks and MIDI are left out, as the batch decided. Percent controls
are fractions. Controls glide per sample where the originals ramped across a
host block, so the sound does not depend on the block size.

| Effect | Id, code | Category, picker group | Pad (X / Y) |
| --- | --- | --- | --- |
| ++decimate | `sh-decimate`, 8 | Distortion, Utility & Shaping | `averaging` / `depth` |
| ++matrix | `sh-matrix`, 9 | Stereo, Utility & Shaping | `midDb` / `sideDb` |
| ++phasor | `sh-phasor`, 10 | Modulation, Chorus & Phasing | `rateHz` / `depth` |
| ++delay | `sh-delay`, 11 | Delay, Reverb & Delay | `delayMs` / `feedback` |
| ++pitchdelay | `sh-pitchdelay`, 12 | Pitch, Pitch & Motion | `delayMs` / `feedback` |
| ++flipper | `sh-flipper`, 13 | Delay, Reverb & Delay | `flipS` / `overlap` |
| ++bubbler | `sh-bubbler`, 14 | Granular, Pitch & Motion | `density` / `grainSize` |
| ++chebyshev | `sh-chebyshev`, 15 | Distortion, Utility & Shaping | `inDb` / `t3Db` |
| ++compand | `sh-compand`, 16 | Dynamics, EQ & Compression | `threshDb` / `ratio` |

**Faithful, where the spec said otherwise or said nothing.**

- **The Delay Trio's read** is a four-point Hermite interpolator whose index
  and fraction put an unmodulated echo at the set time plus one sample.
- **Startup values.** ++pitchdelay and ++bubbler move their own dials in
  their constructors. The defaults here are those values: ++pitchdelay starts
  in just tuning at 209.83 ms, full depth, all wet. ++bubbler starts at
  190.5 ms with time variation 50 %, grain size 10 %, density 80 % and
  reversal 50 %.
- **Feedback stages.**
  - ++delay's DC blocker waits for feedback over 100 %. ++pitchdelay's and
    ++bubbler's are always on.
  - ++delay's low-pass steps aside above 19 kHz.
  - The level stage's window is one ring shared by both sides.
- **Square LFO.** ++delay's square is summed from odd harmonics up to the 25th
  (weighted 1/24, as the original has it).
- **Pitch and tuning.**
  - ++pitchdelay crossfades two heads with triangles and clips its wet sound
    as `0.9·atan(2y)`.
  - ++bubbler's just table includes 7/5 and 7/4. Its octave variation gives
    whole octaves only.
  - Overlapping ++bubbler grains at a new pitch sit flat of it, because each
    grain reads its shifted sound from its own start. An octave up at the
    defaults peaks near 390 Hz. This is the original's schedule, and it is
    kept.
- **++chebyshev** does not clamp its input. Drive past full scale runs the
  polynomials into the ±1.5 clip, and the even ones offset silence: with only
  cp 2 up, silence comes out near −1.
- **++compand's curve.**
  - The knee is 12 dB × knee wide, centred on the threshold.
  - In the compression knee the level rises slightly just below the
    threshold.
  - The detector is clamped to full scale.
  - Gain is averaged with the previous sample's gain.

**Changed from the originals: their bugs, fixed.**

| Effect | The original | Here |
| --- | --- | --- |
| ++delay | *Feedback +* gave negative feedback | *Feedback −* is a switch, off by default, and off is positive |
| ++delay | Frozen, the right side read at the left's delay and skipped the out gain | Each side reads its own delay, and both get the out gain |
| ++delay | Two heads on the random shape stepped the second head every sample, a buzz | Each head slides to its own random targets |
| ++delay, ++pitchdelay, ++bubbler | A time that landed exactly on its target kept gliding | It stops there |
| ++pitchdelay | The 100 ms time glide was worked out and then thrown away, so the time snapped and clicked | It glides |
| ++flipper | The fade was overlap × segment with overlap 0–100, so at the default 15 the new head reached a fifteenth of its level and every seam stepped | Overlap is a share of the segment |
| ++bubbler | In and out gain were never read | They act |
| ++bubbler | Reversal compared a 0–1 random number with the 0–100 dial, so 1 or more reversed every grain | A chance per grain |
| ++bubbler | The read's fraction was mirrored, putting whole-sample reads one early | Reads at the true position |
| ++bubbler | Grain times were a float clock that coarsened after about six minutes | Counted in whole samples |
| ++compand | The attack coefficient came out infinite, so attack did nothing | The detector rises at most 20 dB per attack time |
| ++compand | The expansion knee took a linear level from a dB one: a step at its foot, a boost inside | Its top is in dB, as the compression knee's is |
| ++compand | One RMS window for both sides, which kept stale values when it shortened | One per side, re-summed when it shortens |
| ++compand | No ±1.5 clip in stereo | Clipped, as the mono path was |
| ++phasor | The random shape could not be reached | It works: a new target each cycle, and a slide to it |

**Tests.** The tests are in prism-fx: `tests/sh_*.rs`, from 4 to 10 per
effect. Each also passes the contract checks over the whole catalogue. In
MultiGrainLive, `tests/ui/prism-fx.spec.mjs` checks that all nine are in the
picker, where each is filed, the ++delay and ++bubbler panels, and
++compand's Response, which dims until RMS detect is on.

