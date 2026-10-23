# Pluggo: distortion, dynamics, stereo and glitch

*22 October 2026. Spec — not built. Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md).*

*Batch D1 of the effect specs. 24 Pluggo 3.6.1 plug-ins (Cycling '74, 2006, Max/MSP
patches running in the pluggo VST shell). Written 22 October 2026.*

Twenty-four Pluggo effects, read from the plug-ins' resources and the *Pluggo Plug-in
Reference Guide*. Two are already here (Degrader is the planned Decimator, Stereo
Adjuster is Width), six are additions to an existing or planned effect, and sixteen are
new. The new ones are not sixteen separate builds: seven of them — Fragulator,
Granular-to-Go, Shuffler, Slice-n-Dice, Stutterer, SquirrelParade and Pendulum — are
the same machine underneath, a ring buffer of the live input read back by voices that
loop, jump, repitch and drop out, so they share one core (see *Shared pieces*). For the
granular instrument the important finding is that Granular-to-Go and Fragulator are the
grain cloud run on live input with three controls the cloud does not have — a per-grain
chance of sounding, per-grain amplitude jitter and a loop inside each grain — and that
Shuffler, Slice-n-Dice and Stutterer are, on a file, a stepped and looped lane on the
cloud's Read position. Cyclotron was listed as granular but is a step-sequenced filter;
Raindrops is granular in frequency rather than time.

**Sources, and their limits.** For every plug-in except Limi the Max patch is stored
encrypted inside the collective (`mxfr` resource, `mx@c` header; each embedded file is
hex-armoured with two 16-letter alphabets and a position-dependent key, no period up to
2 000 bytes). The packs' `patch.txt` for these is that cipher text, not Max text, and
`ui.txt` is empty, so there are no object positions to read. Only Limi decoded. What
each section says about the DSP therefore comes from the manual, the published
parameter table (`Mpf2`), the presets (`Mpnm`/`Mpst`, with the true per-preset stride,
which is larger than the published parameter count for nine plug-ins because tables
and sync settings are stored in presets but not published), the menu labels (`Choi`),
the names of the abstractions embedded in each collective, and the manual's
screenshots. Anything not stated by those is marked *inferred*. Positions for custom
interfaces are read off the screenshots, in screenshot pixels, and are approximate.
Where the manual and the parameter table disagree on a range, the table wins and the
difference is noted.

| Effect | Here | Shared-panel pad pair (X / Y) |
| --- | --- | --- |
| Degrader | Exists — planned Decimator | `rate` / `bits` |
| Monstercrunch | Adjust — Fuzz (new, this batch) | `hiRateHz` / `loRateHz` |
| PluggoFuzz | New — `Fuzz` | `outHz` / `driveDb` |
| Waveshaper | New — `Waveshaper` | `driveDb` / `mix` |
| Dynamical | New — `CurveDynamics` | `drive` / `gain` |
| Limi | New — `Limiter` | `inputDb` / `releaseMs` |
| Noyzckippr | Adjust — Ring | `hz` / `bandQ` |
| Audio Rate Pan | Adjust — planned Tremolo | `rateHz` / `phaseMult` |
| Center Channel | Adjust — planned Stereo Matrix | `delayL` / `thru` |
| Pendulum | New — `Pendulum` | `rateHz` / `windowMs` |
| Stereo Adjuster | Exists — Width | `width` / — (Utility: `width` / `gainDb`) |
| Stereo Faker | Adjust — Flanger | `delayMs` / `rateHz` |
| Cyclotron | New — `StepFilter` | `stepMs` / `glideMs` |
| Fragulator | New — `Fragulator` | `bufferSamples` / `speed` |
| Granular-to-Go | New — `GrainToGo` | `loopSamples` / `speed` |
| Raindrops | New — `Raindrops` | `dropsPerSec` / `decayMs` |
| Shuffler | New — `Shuffler` | `bars` / `sustain` |
| Slice-n-Dice | Adjust — Shuffler (this batch) | `bars` / `sustain` |
| SquirrelParade | New — `SquirrelParade` | `grainSamples` / `fm1` |
| Stutterer | New — `Stutterer` | `sliceMsL` / `countL` |
| Convolver | New — `CrossSynth` | `balance` / `filterBlur` |
| Vocoder 10-band | New — `ChannelVocoder` | `baseHz` / `spread` |
| Vocoder 16-band | New — `ChannelVocoder`, `bands` 16 | `baseHz` / `spread` |
| Xformer | New — `StepGate` | `decay` / `accent` |

## Shared pieces

These come up in several sections and are stated once here.

- **Pluggo's two views.** Every Pluggo plug-in has a generic *Parameters* view: a
  header row (Parameter | Min | Max | Value), one row per published parameter with a
  horizontal slider and a value readout, and an information strip at the bottom
  carrying a one-line description over a decorative graphic. Some also have a custom
  *Interface* view. Where a plug-in has only the generic view, its "layout" is that
  list, top to bottom, in parameter order. The shared panel keeps that order.
- **Live buffer core.** One internal module, not a ShapeKind: a per-channel ring buffer
  of the slot's input (up to 60 s), plus *readers* that each have a start, a length, a
  rate (signed), a loop flag, a fade length and a gain. Fragulator, Granular-to-Go,
  Shuffler, Slice-n-Dice, Stutterer, SquirrelParade and Pendulum are schedulers over
  it. Writing it once is what keeps sixteen "new" effects from being sixteen builds.
- **Randomness.** Every random draw (Granular-to-Go, Fragulator, Raindrops,
  SquirrelParade, Noyzckippr's noise) comes from the document seed and the slot id, as
  `Grain::rand01` does, so a render repeats exactly. The originals were not seeded.
- **Step tables.** `SlotSpec::Shape` stores a flat `(key, value)` list, so tables of up
  to 32 steps are plain keys (`f01`…`f16`), automatable like any other control. The
  128- and 256-point curves of Dynamical and Waveshaper are too many for that and need
  one shared addition: an optional `table: Vec<f32>` on `SlotSpec::Shape`, saved and
  preset with the slot, not automatable. The shared panel draws both as a **step
  display** — a display that accepts drags. That is the one control this batch adds to
  the vocabulary.
- **Tempo.** Cyclotron, Audio Rate Pan, Shuffler, Slice-n-Dice and Xformer could follow
  a host or PluggoSync clock. Here they take a `bpm` control; whether a document tempo
  exists to follow is a batch-wide open question, at the end.
- **PluggoBus.** Several plug-ins could take a second signal from a PluggoBus. The rack
  has no buses, so each section replaces the bus with *the other channel* of the slot
  and says so.
- **Defaults.** Default values are the plug-in's first preset, converted to real units,
  unless that would make a new slot silent or surprising; exceptions are noted.

---

### Degrader
*Pluggo 3.6.1, Cycling '74 (Adam Schabtach), 2006 · VST (Max patch, encrypted) ·
params.tsv, presets.tsv, manual p. 50–51, screenshot p050-0*

Makes the input sound as if it were sampled at a lower rate and stored in fewer bits,
without changing the real rate or depth. The two are independent, so it covers both
aliasing and quantisation grit. Bit reduction makes it louder, because the signal
heads toward a full-scale square.

**Original interface.** Generic parameter list only, 352×152 in the screenshot; four
rows, then the strip "Sampling-rate/word-size degrader by Adam Schabtach". Stereo in,
stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Rate | slider | 0–100 % of the current sample rate | 100 | row 1 |
| Resolution | slider (continuous) | 1–24 bits | 15.95 ("16 Bits") | row 2 |
| Direct Level | slider | −70 to +12 dB | −70 | row 3 |
| FX Level | slider | −70 to +12 dB | 0 | row 4 |
| Presets | menu | 10: 16 Bits, 12 Bits, 8 Bits, 4 Bits, 22kHz, 11kHz, 5.5kHz, Early Mac Audio, Current Mac Audio, Current PC Audio :-) | 16 Bits | host menu |

**Signal flow.** Per channel: a sample-and-hold clocked at Rate × the sample rate (a
phase accumulator; the held value changes only when it wraps), then rounding to
2^Resolution levels with no dither and no anti-alias filter. Resolution is continuous
in the presets (12 Bits stores 12.27), so the step size moves smoothly rather than in
whole bits. The result is scaled by FX Level and added to the input scaled by Direct
Level. At Rate 0 the hold never updates (inferred: the output freezes on one value).

**Here.** Exists: the planned **Decimator** in HYPERPRISM.md. Rate → `rate`, Resolution
→ `bits`, the two levels → `mix` (FX 0 dB with Direct −70 is `mix` 1; the "Current Mac
Audio" preset is `mix` 0). Two build notes for the planned spec: make `bits` continuous
so the presets and a pad sweep are smooth, and let `rate` reach about 0.1 % rather than
stopping at 1 %. The +12 dB of headroom on either level is a Gain slot after it.

**Shared panel.** One group: Sample rate (slider, primary), Bit depth (slider), Mix
(dial). Pad: X `rate` 1–100 %, Y `bits` 1–24 — Hyperprism's own Sonic Decimator pair.

**Tests.**
- At `rate` 50 % each output value repeats for exactly two samples.
- At `bits` 4 a full-scale sine has at most 16 distinct output values.
- At `bits` 2.5 the number of distinct values lies strictly between those at 2 and 3.

---

### Monstercrunch
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted) · params.tsv,
presets.tsv, manual p. 117–118, screenshot p117-0*

Amplifies the input enormously, clips it between a lower and an upper limit that each
move with their own oscillator, then low-passes the result hard. With both limits
moving at different rates the distortion pumps in a complex but repeating way; at high
gain the moving limits act as amplitude modulation.

**Original interface.** Generic parameter list, 352×313, eleven rows, strip "pluggo
effect: Monstercrunch". Mono. The manual lists nine parameters; the plug-in publishes
eleven (the two Offset controls are missing from the manual).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Initial Gain | slider | 0–360 (× input) | 54 | row 1 |
| LowerModFreq | slider | 0–100 Hz | 4 | row 2 |
| LowerModOffset | slider | 0–1 | 0.42 | row 3 |
| LowerModDepth | slider | 0–2 | 0.55 | row 4 |
| UpperModFreq | slider | 0–100 Hz | 1 | row 5 |
| UpperModOffset | slider | 0–1 | 0.78 | row 6 |
| UpperModDepth | slider | 0–2 | 1.97 | row 7 |
| LowpassCutoff | slider | 0–4000 Hz | 2074 | row 8 |
| LowpassResonance | slider | 0–0.99 | 0.66 | row 9 |
| Output Gain | slider | 0–1 | 0.07 | row 10 |
| Direct Gain | slider | 0–1 | 0.18 | row 11 |
| Presets | menu | 8: prettily, ethnic rolled r, lovely, nicely, heliport, space fill, headpound sizzle, a kind of swing | prettily | host menu |

**Signal flow.** Input × Initial Gain → clip between a lower and an upper bound → a
resonant two-pole low-pass (cutoff, resonance 0–0.99; the range matches MSP's `lores~`,
inferred) → × Output Gain, plus the input × Direct Gain. Each bound is its Offset moved
by a sine at its Mod Freq with its Mod Depth (inferred: bound = offset + depth × sin,
with the lower bound negated). What happens when the bounds cross is not stated
(inferred: the output sits on the crossing value). The Output Gain defaults are tiny
(0.03–0.12) because the clipped signal is near full scale.

**Here.** Adjust the new **Fuzz** (PluggoFuzz, below): Monstercrunch is Fuzz in Hard
Clip mode with moving bounds and its output filter set to low-pass. Fuzz gets six keys
and a dry level; at their defaults the bounds sit at ±1 and do not move, so Fuzz is
unchanged.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `loBound` | Lower limit | 0–1 | 1 | no | |
| `loDepth` | Lower swing | 0–2 | 0 | no | |
| `loRateHz` | Lower rate | 0–100 | 1 | no | Hz |
| `hiBound` | Upper limit | 0–1 | 1 | no | |
| `hiDepth` | Upper swing | 0–2 | 0 | no | |
| `hiRateHz` | Upper rate | 0–100 | 1 | no | Hz |
| `dry` | Dry | 0–1 | 0 | no | |

Initial Gain 0–360 is Fuzz `driveDb` 0–51 dB; cutoff and resonance are Fuzz's output
filter in low-pass mode.

**Shared panel.** Fuzz's panel with a fourth group, *Limits*: Lower (limit, swing, rate)
and Upper (limit, swing, rate) as two rows of three dials, upper first. Pad: X
`hiRateHz` 0–20 Hz, Y `loRateHz` 0–20 Hz — the two "pincers" the manual says are the
point of the effect.

**Tests.**
- With swings 0 and limits 0.5, a full-scale sine's output peaks at 0.5 (before the
  output filter, which is bypassed for the test).
- With `hiDepth` 1 at 5 Hz and a loud steady input, the output envelope's spectrum
  peaks at 5 Hz.
- With all six new keys at default, Fuzz output is bit-identical to Fuzz before the
  change.

---

### PluggoFuzz
*Pluggo 3.6.1, Cycling '74 (Adam Schabtach; presets Joshua Kit Clayton), 2006 · VST
(Max patch, encrypted; embedded skin `fuzzpict.pict2.pct`) · params.tsv, presets.tsv,
choices.txt, manual p. 151–154, screenshots p151-0, p153-0*

A distortion with four clipping characters and a multi-mode filter before and after the
clipper. The filters are the point: shaping what goes into the clipper and what comes
out of it is most of what distinguishes one fuzz tone from another.

**Original interface.** Two views. *Parameters* (352×348): twelve rows, strip
"PluggoFuzz by Adam Schabtach. Presets by Joshua Kit Clayton." on red. *Equalization*
(≈265×333): two filter-response graphs, "Input Filter" above and "Output Filter"
below, each with its mode menu to the right of its title (screenshot shows "Low Shelf"
and "Peak/Notch") and two handles on the curve — a filled dot (frequency and gain) and
a hollow dot (Q) (inferred from the drawing). Mono.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Mode | menu | Soft Clip, Hard Clip, Foldover, Wrap | Soft Clip | row 1 · Distortion |
| Intensity | slider | 1–11 "Bogons" | 3 | row 2 · Distortion |
| Input Gain | slider | −12 to +12 dB | 0 | row 3 · Input |
| Input Filter Mode | menu | 7 modes, Low Pass … Peak/Notch | Low Pass | row 4 · Input; Equalization top |
| Input Filter Freq. | slider / graph handle | 20–16 000 Hz | 5829 | row 5 · Input |
| Input Filter Q | slider / graph handle | 0.01–20 | 0.21 | row 6 · Input |
| Input Filter Gain | slider | 0.001–2 (manual 0.01–2) | 1 | row 7 · Input |
| Output Filter Mode | menu | as input | Peak/Notch | row 8 · Output; Equalization bottom |
| Output Filter Freq. | slider / graph handle | 20–16 000 Hz | 653 | row 9 · Output |
| Output Filter Q | slider / graph handle | 0.01–20 | 1.78 | row 10 · Output |
| Output Filter Gain | slider | 0.001–2 | 0.50 | row 11 · Output |
| Output Gain | slider | −12 to +12 dB | −2 | row 12 |
| Filter graphs | display | response curves | — | Equalization view |
| Presets | menu | 8: Rumble, Squawk, Where's the Love?, Bug Zapper, Zipper, Not So Rough, Loaded With Power, Dust Storm | Rumble | host menu |

The filter menus have seven entries (0–6); the resource holds no labels for them. The
manual names Low Pass first and Peak/Notch last, the manual's text mentions Bandpass,
and the screenshot shows Low Shelf. Inferred order: Low Pass, High Pass, Band Pass,
Band Stop, Low Shelf, High Shelf, Peak/Notch.

**Signal flow.** Input Gain → input biquad (mode, frequency, Q, gain) → drive set by
Intensity → shaper → output biquad → Output Gain. Shapers, from the manual: *Soft
Clip* rounds into the limit like an overdriven valve stage; *Hard Clip* cuts square;
*Foldover* reflects the part beyond the limit back downward; *Wrap* takes what passed
the limit, inverts it and adds it back, like an overloaded converter. How Intensity
maps to gain is not recoverable (encrypted patch).

**Here.** New `Fuzz` ShapeKind, filters from `biquad.rs`. Per channel.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `mode` | Mode | 0–3 (Soft, Hard, Fold, Wrap) | 0 | no | |
| `driveDb` | Drive | 0–54 | 10 | no | dB |
| `inGainDb` | Input | −12 to 12 | 0 | no | dB |
| `inMode` | Input filter | 0–6 | 0 | no | |
| `inHz` | Input frequency | 20–16 000 | 5829 | yes | Hz |
| `inQ` | Input Q | 0.01–20 | 0.21 | yes | |
| `inGain` | Input filter gain | 0.001–2 | 1 | no | |
| `outMode` | Output filter | 0–6 | 6 | no | |
| `outHz` | Output frequency | 20–16 000 | 653 | yes | Hz |
| `outQ` | Output Q | 0.01–20 | 1.78 | yes | |
| `outGain` | Output filter gain | 0.001–2 | 0.5 | no | |
| `outGainDb` | Output | −12 to 12 | −2 | no | dB |

`driveDb` replaces Intensity because Monstercrunch needs up to 51 dB; Intensity 1–11
maps onto its lower part (mapping open). Plus the Monstercrunch keys above.

**Shared panel.** Three groups in signal order: *Input* (gain dial, filter menu,
frequency, Q, gain), *Distortion* (mode menu, Drive — primary — as a large dial),
*Output* (filter menu, frequency, Q, gain, output dial). One display: both filter
curves stacked, as in the Equalization view, with draggable handles. Pad: X `outHz`
200–5 000 Hz, Y `driveDb` 0–40 dB — the manual's wah suggestion on one axis, drive on
the other.

**Tests.**
- Hard Clip at `driveDb` 0, filters set flat, input a ±0.5 sine: output equals input.
- Hard Clip at `driveDb` 30: no output sample exceeds the clip level.
- Foldover on a slow ramp from 0 to 2× the limit: output rises to the limit then falls.
- Soft Clip has lower third-harmonic level than Hard Clip at `driveDb` 6.

**Open questions.** Intensity's mapping to gain, and the exact soft-clip curve.

---

### Waveshaper
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted; embedded `helpPict.pct`)
· presets.tsv (256 values per preset), manual p. 247–248, screenshot p247-0*

Maps every input sample through a drawn transfer curve: input on the horizontal axis,
output on the vertical. The diagonal is no change; anything else rectifies, folds,
clips or scrambles. There are no knobs — the curve is the instrument.

**Original interface.** Custom view, 308×354. A square graph (≈262×258 at the top,
"Input Signal" −1.0…+1.0 along the bottom, "Output Signal" −1.0…+1.0 up the left side)
in which the curve is drawn with the mouse. Below it, two rows of buttons: "top ->
bottom", "smooth"; "bottom -> top", "null". Mono. The published parameter table came
back empty because the plug-in publishes one 256-element curve rather than named
parameters; every preset stores exactly 256 values (0–1, meaning −1…+1).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Transfer curve | drawable display | 256 points, each −1…+1 | identity | ≈x40,y5 (262×258) |
| top -> bottom | button | copies the upper half of the curve onto the lower half | — | ≈x118,y316 |
| smooth | button | averages each point with its neighbours | — | ≈x192,y316 |
| bottom -> top | button | copies the lower half onto the upper | — | ≈x118,y338 |
| null | button | resets to the diagonal | — | ≈x192,y338 |
| Presets | menu | 12: No Effect, Full Rectify, Half Rectify, Soft Clip, Hard Clip, Phase Invert, Quantize, Mountains, Double Curve, Broken Vee, Lightning, Venus de Pluggo | No Effect | host menu |

Read from the stored curves: Full Rectify is |x|, Half Rectify zeroes the negative
half, Soft Clip and Hard Clip bend or flatten the last quarter, Phase Invert is −x,
Quantize is a staircase, and the last five are wild multi-segment shapes.

**Signal flow.** The input, clipped to ±1, indexes the 256-point table ((x+1)/2 × 255).
Interpolation between points is not stated; the staircase in Quantize is drawn into the
table, so linear interpolation is consistent with it (inferred). The mirror buttons
make the curve symmetric — "copies" is read here as odd symmetry, so a mirrored curve
still passes through zero (inferred). Nothing follows the table.

**Here.** New `Waveshaper` ShapeKind using the shared `table` field (256 points).
Two keys are added that the original did not have, because a fixed curve does nothing
useful to a quiet file without a drive in front of it:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `driveDb` | Drive (not in original) | −24 to 24 | 0 | no | dB |
| `mix` | Mix (not in original) | 0–1 | 1 | no | |

The four buttons are panel actions on the table, not parameters.

**Shared panel.** The curve display is the primary control and fills the panel; the
four actions sit under it in the original's two rows; Drive and Mix are two small dials
to the right. Pad: X `driveDb` −12…+24 dB, Y `mix` 0–1.

**Tests.**
- The null curve with drive 0 and mix 1 returns the input to within interpolation
  error (< 1e-6 for inputs on table points).
- Phase Invert returns −x; Full Rectify never returns a negative sample.
- "smooth" applied once strictly reduces the largest point-to-point jump of Broken Vee.

---

### Dynamical
*Pluggo 3.6.1, Cycling '74 (jhno), 2006 · VST (Max patch, encrypted; embedded
`jhnob.black2`, `rms1~`, `damp`, `switch2`, `mssmoof`, `dynamical.pict`, `arrows.pict`)
· params.tsv, presets (139 values each: 11 parameters + a 128-point curve), choices.txt,
manual p. 52–54, screenshot p052-0*

A gain controller whose response is a drawn curve of input level against output level.
A diagonal leaves the level alone; flatter compresses, steeper expands, and any shape
at all is allowed, so it does gating, expanding, compressing and stranger things from
one interface.

**Original interface.** Custom view, 327×309, black. "input" title top-left; three thin
horizontal sliders across the top labelled response, drive and detection (detection is
a meter); a large response-curve graph (≈x83,y50, 230×185; cyan with the curve filled
dark blue) with a small slider at its top-left and bottom-right corners (inferred:
Range Min and Range Max). Left column: a "gain redux" dial (display, ≈x40,y135), "lin |
log" and "in | out" arrow switches (≈x20,y190–215), "line" and "smooth" buttons
(≈x20,y235–255). Bottom row: four black knobs with number boxes — damp down, damp up,
lookahead, gain (≈x115–300,y240). Mono.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Response curve | drawable display | 128 points, input level → output level | Power Drain's bell | centre |
| response | slider | 1–256 (slow → fast detection) | 112 | top row 1 |
| drive | slider | 0–255 (detector input level) | 91 | top row 2 |
| detection | meter | detected level | — | top row 3 |
| gain redux | dial display | current gain change | — | left |
| lin / log | switch | Linear, Log (published 1–2) | Log | left |
| in / out | switch | processing on / bypassed (1–2) | in | left |
| line | button | resets the curve to the diagonal | — | lower left |
| smooth | button | smooths the curve | — | lower left |
| damp down | knob + number | 0–1 (gain-down speed: attack) | 0.15 | bottom 1 |
| damp up | knob + number | 0–1 (gain-up speed: release) | 0.22 | bottom 2 |
| lookahead | knob + number | 0–1 published, shown 0–250 ms | 34 ms | bottom 3 |
| gain | knob + number | 0–1 published, shown 0–2 | 1.19 | bottom 4 |
| Range Min / Max | sliders (inferred position) | 0–127 | 0 / 127 | graph corners |
| Source Bus L | menu (Parameters view only) | None, PluggoBus1L … 4R | None | — |
| Presets | menu | 8: Power Drain, Drum Loop Weed-Out, Mountains, Hard Gate, Gentle Punch, Sudden Expander, Time Pusher, Envelopes | Power Drain | host menu |

**Signal flow.** The detector takes the input (or a PluggoBus signal as a key) × drive,
measures RMS over a window set by response (`rms1~`), and converts it to a curve index
on a linear or a logarithmic scale; Range Min/Max restrict the indices used (inferred).
The curve gives the wanted output level; the gain is wanted ÷ detected. That gain is
smoothed asymmetrically — damp down when it falls, damp up when it rises (`damp`,
`mssmoof`) — and applied to the input delayed by the lookahead, then × gain. The
lookahead delays the output. How response and drive map to time and level is not
recoverable.

**Here.** New `CurveDynamics` ShapeKind with the shared `table` field (128 points). The
Compressor cannot draw a curve, so this is not an Adjust. The in/out switch is the
slot's own bypass; the bus key becomes *the other channel*.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `gain` | Gain | 0–2 | 1.19 | no | |
| `response` | Response | 1–256 | 112 | yes | |
| `drive` | Drive | 0–255 | 91 | no | |
| `dampDown` | Damp down | 0–1 | 0.15 | no | |
| `dampUp` | Damp up | 0–1 | 0.22 | no | |
| `logScale` | Log | 0–1 | 1 | no | |
| `lookaheadMs` | Lookahead | 0–250 | 34 | no | ms |
| `rangeMin` | Range min | 0–127 | 0 | no | |
| `rangeMax` | Range max | 0–127 | 127 | no | |
| `key` | Key | 0 self, 1 other channel | 0 | no | |

**Shared panel.** *Detector* (response slider, drive slider — primary — detection
meter, log switch, key menu); *Curve* (the curve display with the gain-reduction
display beside it, line and smooth actions under it); *Envelope* (damp down, damp up,
lookahead, gain as four dials in the original's order). Pad: X `drive` 0–255, Y
`gain` 0–2.

**Tests.**
- The diagonal curve with lookahead 0 and gain 1 leaves a steady tone's level unchanged.
- A curve flat at half height reduces a loud steady tone and leaves a quiet one louder
  relative to it (the ratio of their levels shrinks).
- Lookahead 50 ms delays the output by 50 ms ± 1 sample.
- Raising `dampUp` lengthens the time the gain takes to recover after a burst.

**Open questions.** The time and level meaning of response and drive.

---

### Limi
*Pluggo 3.6.1, Cycling '74 (jhno), 2006 · VST (Max patch, **decoded**) · patch.txt,
params.tsv, presets.tsv, ui.txt, manual p. 105, screenshot p105-0*

A look-ahead limiter: nothing leaves above the Limit, over an extreme range of gains,
with double-precision internals. It serves as clip protection, a mastering level
maximiser, or, pushed hard, a compressor-distortion.

**Original interface.** Generic parameter list, 354×223, seven rows, strip "Limi (by
jhno)" over `limi.pict`. The decoded patcher also holds a small hidden block of
utility objects (numbers, incdec arrows, `capture $1` / `recall $1` / `set $1`
messages at x 491–660, y 219–293 in object order) that are not part of the shown view.
Stereo. The patch's `pp` objects are authoritative over the manual where they differ:
Preamp and Output Gain are −48…+48 dB (manual −76…+18) and Release Coarse starts at 0.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Preamp Gain | slider | −48 to +48 dB | +6 | row 1 |
| Limit | slider | −48 to +48 dB | 0 | row 2 |
| Release Coarse | slider | 0–120 s | 1 | row 3 |
| Release Fine | slider | 0–1000 ms | 0 | row 4 |
| Lookahead | slider | 1–1024 samples | 200 | row 5 |
| Response | menu | exponential, linear | exponential | row 6 |
| Output Gain | slider | −48 to +48 dB | 0 | row 7 |
| Presets | menu | 8: Basic Mastering, Big Push, 1 Sample Delay, Preamp = Distort, Active Ride, All She Got, Start Template, Inactive Ride | Basic Mastering | host menu |

Preset facts from the patch's `setprogram` lines: Big Push is +24 dB in, 2 s release,
400 samples ahead; Preamp = Distort is −15 dB in, Limit −32, 727 ms, linear, +32 out;
All She Got is +48 in, Limit −48, linear, +42 out.

**Signal flow.** `plugin~` → `limi~` (jhno's compiled limiter) → `plugout~`. The patch
converts each dB control with exp(dB/8.6859) squared — that is 10^(dB/10) — before
sending it as `preamp`, `max` (Limit) and `postamp`. Release is coarse × 1000 + fine,
clipped to 0.03–121 000 ms, sent as `release`; Lookahead is sent in samples; Response
sends `lin 0/1`. Inside `limi~` (not in the patch): the output is delayed by the
look-ahead so the gain can come down before a peak arrives, then recovers over the
release time with an exponential or a straight-line shape (the manual's description).

**Here.** New `Limiter` ShapeKind. Not an Adjust of Maximizer: Maximizer is one-knob by
design (attack, release and knee all follow `amount`), and Limi is the opposite.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `inputDb` | Input | −48 to 48 | 6 | no | dB |
| `ceilingDb` | Limit | −48 to 48 | 0 | no | dB |
| `releaseMs` | Release | 0.03–121 000 | 1000 | yes | ms |
| `lookahead` | Look-ahead | 1–1024 | 200 | yes | samples |
| `linear` | Linear release | 0–1 | 0 | no | |
| `outputDb` | Output | −48 to 48 | 0 | no | dB |

The original's coarse/fine pair becomes one log control; the slot reports
`lookahead` as latency.

**Shared panel.** One group in the original's order: Input (dial, primary), Limit
(dial), Release (dial), Look-ahead (number), Linear (switch), Output (dial), with a
gain-reduction meter as the display. Pad: X `inputDb` −12…+36 dB, Y `releaseMs`
10–5 000 ms.

**Tests.**
- With `inputDb` +24 on a full-scale tone, no output sample exceeds `ceilingDb` (with
  `outputDb` 0) by more than 1e-6.
- Output lags input by exactly `lookahead` samples.
- A signal that never reaches the ceiling passes with unity gain.
- After a single loud burst, gain is back within 1 dB of unity after one `releaseMs`
  in linear mode.

**Open questions.** The squared conversion means a 6 dB setting sends a factor of 4. If
`limi~` takes amplitudes, every dB label in Limi is doubled in effect; if it takes
power, the labels are right. The spec follows the labels.

---

### Noyzckippr
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted) · params.tsv,
presets.tsv, manual p. 132–133, screenshot p132-0*

Multiplies the input by band-passed white noise. With a low centre and a very narrow
band the noise moves slowly and the result is an irregular tremolo; higher up it
becomes a broken radio.

**Original interface.** Generic parameter list, 352×198, six rows, strip "pluggo
effect: Noyzckippr". Mono.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Noise Output Gain | slider | 0–1200 | 355 | row 1 |
| Noise Input Gain | slider | 0–7 | 0.57 | row 2 |
| Noise CF | slider | 0–4000 Hz | 31 | row 3 |
| Noise Q | slider | 0.5–80 (manual 0–80) | 12 | row 4 |
| Output Gain | slider | 0–1 | 0.41 | row 5 |
| Direct Gain | slider | 0–1 | 0 | row 6 |
| Presets | menu | 16, e.g. Candy Crunch, Harsh Tremolo, Soft Distortion, Noise Mod, Tiny Baby Rattle, Deathsquad Rally, Beautiful Breakup | Candy Crunch | host menu |

**Signal flow.** White noise × Noise Input Gain → band-pass at Noise CF with Noise Q →
× Noise Output Gain → multiplied with the input → × Output Gain, plus the input ×
Direct Gain. The manual warns that lowering Q raises the level sharply, so the band-pass
is not peak-normalised (inferred: like MSP `reson~`). The two noise gains straddle a
linear filter, so only their product matters.

**Here.** Adjust **Ring**: Ring already multiplies the input by a carrier at `hz` with a
`mix`; Noyzckippr is Ring with a noise band for its carrier. Noise CF is Ring's `hz`;
Output and Direct gains are `mix` (every preset has Direct 0) and a Gain slot.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `carrier` | Carrier | 0 sine, 1 noise band | 0 | no | |
| `bandQ` | Band Q | 0.5–80 | 12 | yes | |
| `noiseGainDb` | Noise gain | −40 to 80 | 46 | no | dB |

`noiseGainDb` 46 is the default preset's 0.57 × 355. `sweep` moves the band centre in
noise mode as it moves the sine.

**Shared panel.** Ring's panel with a Carrier menu first; in noise mode, Band Q and
Noise gain appear beside Frequency. Pad: X `hz` 1–4 000 Hz, log, Y `bandQ` 0.5–80.

**Tests.**
- In noise mode, a burst of input followed by digital silence gives exact silence after
  the burst: the noise multiplies the input, it is never added to it.
- At centre 3 Hz and Q 80 the output envelope's spectrum has its energy below 10 Hz.
- The same seed renders the same output twice; sine mode is unchanged from today's Ring.

---

### Audio Rate Pan
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted) · params.tsv, presets
(12 values: 8 published + 4 sync settings), choices.txt, manual p. 14–16, screenshot
p014-0*

An auto-panner that runs from slow sweeps up to audio rate, where it turns into ring
modulation. Two things set it apart: the pan rate can itself be modulated, and a phase
multiplier bends the pan curve from a sine into jumps and irregular trajectories.

**Original interface.** Generic parameter list, 352×267, nine rows; the last row,
Tempo/Sync, holds a slider, a mode menu (Free shown) and a value. In synced modes the
Coarse Pan Freq row swaps to a multiplier slider and a note-value menu. Mono or stereo
in, stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Coarse Pan Freq | slider (integer) | 0–75 Hz | 0 | row 1 · Rate |
| (synced) Coarse Pan Freq Mult | slider | 0–25 | — | row 1 when synced |
| (synced) Coarse Pan Note Value | menu | 1 … 1/64t | — | row 1 when synced |
| Fine Pan Freq | slider | 0–1 Hz | 0.3 | row 2 · Rate |
| Mod Freq | slider | 0–10 Hz | 0 | row 3 · Rate mod |
| Mod Depth | slider | 0–4 | 0 | row 4 · Rate mod |
| Coarse Phase Mult | slider | 0–125 | 0 | row 5 · Shape |
| Fine Phase Mult | slider | 0–1 | 0.25 | row 6 · Shape |
| Pan Depth | slider | 0–100 % | 81 | row 7 |
| Input | switch | Mono, Stereo | Mono | row 8 |
| Tempo/Sync | slider + menu | 1–300 BPM; Free, Host, Plug, UDT | Free | row 9 |
| Presets | menu | 16, e.g. Back and Forth, Irregular Pan, Punchy 47, Quasi Ring Mod, Stereo Shudder, Queasy Pan, Swaggart Picnic | Back and Forth | host menu |

**Signal flow.** Pan rate = coarse + fine Hz, or a tempo-derived rate when synced. A
second sine at Mod Freq modulates that rate by Mod Depth (inferred: rate × (1 + depth
× sine)). The pan oscillator's phase is multiplied by coarse + fine Phase Mult before
it reaches the pan law: at 0.25 one oscillator cycle is one sweep of an ordinary sine
pan; other values make the phase wrap inside the cycle, producing jumps and, at high
values, ring-modulation sidebands (inferred from the manual's description). Pan Depth
blends from no movement to full (a channel reaches silence). Mono input: the left input
is panned across both outputs. Stereo input: each channel is modulated in place, the
two in opposition (inferred).

**Here.** Adjust the planned **Tremolo** (HYPERPRISM.md): its `stereo` 1 is already
Auto-Pan. Widen its rate to audio rate and add the rate modulation and phase multiplier.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `rateHz` (widened) | Rate | 0.01–80 | 4 | yes | Hz |
| `modHz` | Rate mod speed | 0–10 | 0 | no | Hz |
| `modDepth` | Rate mod depth | 0–4 | 0 | no | |
| `phaseMult` | Phase multiplier | 0–126 | 0.25 | no | |
| `monoIn` | Mono input | 0–1 | 0 | no | |

Tremolo's own default stays 4 Hz; the Audio Rate Pan preset is `rateHz` 0.3, depth
0.81, stereo 1, `monoIn` 1.

**Shared panel.** *Rate* (Rate dial, primary; Mod speed; Mod depth), *Shape* (shape
menu, Phase multiplier), *Stereo* (Depth, Stereo phase, Mono input). Pad: X `rateHz`
0.05–80 Hz, Y `phaseMult` 0–8.

**Tests.**
- Depth 0 returns the input on both channels.
- At 75 Hz and depth 1 on a 1 kHz sine, the output spectrum has sidebands at 925 and
  1075 Hz.
- With `modDepth` 0 the left channel's gain minima are evenly spaced; with `modDepth` 1
  they are not.
- With `phaseMult` 0.25 the output matches the Tremolo without the new keys.

---

### Center Channel
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted) · params.tsv,
presets.tsv, choices.txt, manual p. 31–32, screenshot p031-0*

Subtracts one input channel from the other — the old vocal-remover trick, since
anything mixed dead centre cancels. A delay on each side turns the subtraction into
filtering: a few samples is a high-pass, a hundred is an airy comb.

**Original interface.** Generic parameter list, 352×244, eight rows, strip "pluggo
effect: Center Channel". Stereo in, the difference to one output.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Left Source | menu | Off, LeftIn, RightIn, PluggoBus1L … 4R | LeftIn | row 1 |
| Right Source | menu | as above | RightIn | row 2 |
| Left Delay | slider | 0–1024 samples (manual 2048) | 0 | row 3 |
| Right Delay | slider | 0–1024 samples | 0 | row 4 |
| Output Gain | slider | 0–1 | 1 | row 5 |
| Destination | menu | LeftOut shown; full list not in the resource | LeftOut | row 6 |
| Left Thru | slider | 0–1 | 0 | row 7 |
| Right Thru | slider | 0–1 | 0 | row 8 |
| Presets | menu | 8: Left = Left - Right, Half Orig & Half Diff, No Bass, Most of the Bass, Airy Ambience + Dry, Some Movement, Left Minus Left, Right Minus Right | Left = Left - Right | host menu |

**Signal flow.** (Left source delayed by Left Delay) − (Right source delayed by Right
Delay), × Output Gain, sent to the Destination; each output also carries its own input
× its Thru gain. No Bass uses a 9.7-sample delay; Airy Ambience 113 samples with some
dry; Left Minus Left subtracts a channel from a 4-sample-late copy of itself.

**Here.** Adjust the planned **Stereo Matrix**: with `midGain` 0 and `sideGain` 1 it
already outputs the difference. It needs the two pre-delays, a dry blend, and a choice
of where the difference goes.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `delayL` | Left delay | 0–1024 | 0 | no | samples |
| `delayR` | Right delay | 0–1024 | 0 | no | samples |
| `thru` | Dry | 0–1 | 0 | no | |
| `sideOut` | Difference to | 0 stereo (S, −S), 1 left, 2 right, 3 both (S, S) | 0 | no | |

Sources become fixed (left minus right); a bus source has no equivalent. Left-minus-left
is `delayL` with both sources the same, which needs the sources menu back — left out
until someone asks.

**Shared panel.** Stereo Matrix's panel with a *Difference* group (Left delay, Right
delay, Difference to, Dry) after its Mid/Side group. Pad: X `delayL` 0–128 samples, Y
`thru` 0–1.

**Tests.**
- Identical left and right, `midGain` 0, `sideGain` 1, delays 0: silence.
- Mono input with `delayL` 1: no DC in the output, and a Nyquist-rate tone doubles.
- `sideOut` 1 leaves the right output at `thru` × right input.

---

### Pendulum
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted) · params.tsv,
presets.tsv, manual p. 137–138, screenshot p137-0*

Four delay taps, two per channel, each with its delay time swept by its own ramp. A
moving tap is a moving tape head, so each tap pitch-shifts while it moves — and plays
backwards when the head moves back faster than the tape. Spreads make the four taps
differ, and spacing inserts silence between sweeps.

**Original interface.** Generic parameter list, 352×313, eleven rows, strip "Pendulum is
a four tap delay (2 per channel) where the position of each of the taps is controlled by
a ramp wave oscillator." Mono or stereo in, stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Master Window | slider (integer) | 1–1000 ms | 623 | row 1 · Window |
| Window Spread | slider | 0–0.25 | 0.12 | row 2 · Window |
| Master Freq | slider | 0–20 Hz | 6 | row 3 · Motion |
| Freq Spread | slider | 0–0.25 | 0.25 | row 4 · Motion |
| Spacing Left | slider | 1–10 | 1 | row 5 · Spacing |
| Spacing Right | slider | 1–10 | 1 | row 6 · Spacing |
| Delay Left | slider | 0–1000 ms | 0 | row 7 · Offset |
| Delay Right | slider | 0–1000 ms | 317 | row 8 · Offset |
| Phase Spread | slider | 0–0.25 | 0 | row 9 |
| Gain | slider | −76 to +18 dB | 0 | row 10 |
| Dry Gain | slider | −76 to +18 dB | −76 | row 11 |
| Presets | menu | 8: In your head, Choral, Automatik, Squiggles, Pantone, A little sluggish, Cuisinart, Seasick | In your head | host menu |

**Signal flow.** Per tap: delay = channel offset + window × ramp, the ramp running at the
tap's frequency. The four taps' windows, frequencies and starting phases are the master
values spread apart by the spread fractions (inferred: ± spread around the master).
Spacing stretches each ramp's cycle so the tap sweeps for 1/spacing of it and is silent
for the rest (inferred). A ramp sweeping window W at f Hz plays at 1 − W·f times speed:
the default (623 ms at 6 Hz) is about −2.7, i.e. backwards. Whether the ramp resets are
windowed is not stated. Taps sum per channel, × Gain, plus dry.

**Granular relation.** Each tap is a grain stream of one grain at a time: length 1/f,
read pointer sweeping through the window, pitch from W·f. Four taps with Phase Spread
are four layers with `layerSpread`; Spacing is a duty cycle the cloud does not have.
On the live-buffer core this is four readers.

**Here.** New `Pendulum` ShapeKind on the live-buffer core.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `windowMs` | Window | 1–1000 | 623 | yes | ms |
| `windowSpread` | Window spread | 0–0.25 | 0.12 | no | |
| `rateHz` | Rate | 0–20 | 6 | no | Hz |
| `rateSpread` | Rate spread | 0–0.25 | 0.25 | no | |
| `spacingL` | Spacing left | 1–10 | 1 | no | |
| `spacingR` | Spacing right | 1–10 | 1 | no | |
| `delayLMs` | Delay left | 0–1000 | 0 | no | ms |
| `delayRMs` | Delay right | 0–1000 | 317 | no | ms |
| `phaseSpread` | Phase spread | 0–0.25 | 0 | no | |
| `wetDb` | Wet | −76 to 18 | 0 | no | dB |
| `dryDb` | Dry | −76 to 18 | −76 | no | dB |

**Shared panel.** *Window* (Window — primary — and spread), *Motion* (Rate and spread,
Phase spread), *Spacing* (left, right), *Offset* (Delay left, right), *Levels* (Wet,
Dry). Pad: X `rateHz` 0–20 Hz, Y `windowMs` 1–1000 ms.

**Tests.**
- `rateHz` 0: the output is the input delayed by the offsets, unchanged in pitch.
- `windowMs` 1 at any rate: no audible pitch change (a 1 kHz tone stays within 1 %).
- Window 100 ms at 5 Hz, spacing 1: a 1 kHz tone comes out at 500 Hz.
- `spacingL` 2: the left taps are silent for half of each cycle.

**Open questions.** Whether the taps are windowed at the ramp reset.

---

### Stereo Adjuster
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted) · params.tsv,
presets.tsv, manual p. 202, screenshot p202-0*

One slider for stereo width: middle is unchanged, left folds to mono, right widens by
mixing in the left-minus-right difference until the centre fades ("Karaoke").

**Original interface.** Generic parameter list, 352×83: one row, strip "pluggo effect:
Stereo Adjuster". Stereo.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Mono/Stereo | slider | 0–127 (0 mono, 64 unchanged) | 64 | row 1 |
| Presets | menu | 3: "Stereo" (64), "Mono" (0), "Karaoke" (127) | "Stereo" | host menu |

**Signal flow.** Below 64 the channels blend toward their sum; above 64 the difference
signal is added in. The exact law above 64 is not recoverable.

**Here.** Exists: **Width** [`width` 0–2]. `width` = value ÷ 64 (0 → 0, 64 → 1, 127 →
1.98). True karaoke (no centre at all) is Stereo Matrix with `midGain` 0.

**Shared panel.** Width's single slider. Width has one control, so the pad has only an
X; placed as Utility instead, the pad is X `width` 0–2, Y `gainDb`.

**Tests.**
- `width` 0: left equals right.
- `width` 1: output is bit-identical to input.

**Open questions.** Whether the original's top end removes the centre entirely (then
"Karaoke" belongs to Stereo Matrix, not Width).

---

### Stereo Faker
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted) · params.tsv,
presets.tsv, choices.txt, manual p. 203, screenshot p203-0*

Makes stereo from mono by sending a comb filter to one side and its complement to the
other: the same delayed copy added on the left and subtracted on the right. The two
sides sum back to the original, so it folds to mono cleanly. An optional slow sweep
moves the comb.

**Original interface.** Custom view, 330×114, pale green. A number box reading "37"
with the label "Samples" (≈x75,y8); a wide light-blue horizontal slider for the delay
(≈x8,y28, 208×56); a small dark-grey grid at the right with green dots — a phase scope
of left against right (≈x223,y18, 98×70); bottom row: "Modulate", a toggle, a number
box "10." and "Seconds per Cycle" (≈x75–320,y93). Mono in, stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| DelayTime | slider + number | 0–127 samples (manual 1–127) | 1 | top |
| Phase scope | display | left vs right | — | right |
| Modulate | toggle | Off, On | Off | bottom |
| SweepTime | number | 10–50 s per cycle (manual misprints "10 10") | 10 | bottom |
| Presets | menu | 8: Pseudo, Impostor, Con Artist, Canard, Forgery, Cubic Zirconium, Facade, Hoax | Pseudo | host menu |

**Signal flow.** Left = input + input delayed by DelayTime; right = input − the same
delayed copy (scaling inferred: ½ each). With Modulate on, the delay moves periodically
with a period of SweepTime (shape and span not stated; inferred: between near zero and
the set delay).

**Here.** Adjust **Flanger**: with feedback 0, wet and dry 1, and stereo phase 0 it is
already the left channel. It needs the right channel to subtract, and a shorter minimum
delay (0.1 ms is 4.4 samples at 44.1 kHz; Pseudo uses 1).

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `complement` | Complement right | 0–1 | 0 | no | |
| `delayMs` (min lowered) | Delay | 0.02–100 | 1.5 | yes | ms |

Lowering a minimum only widens what can be set; existing documents are untouched. The
mapping: delay = samples ÷ rate; `rateHz` = 1 ÷ SweepTime (0.02–0.1 Hz); `depthMs` 0
when Modulate is off.

**Shared panel.** Flanger's panel with the Complement switch in its Stereo group, and a
phase scope added as its display (useful for every stereo effect). Pad: X `delayMs`
0.02–3 ms, Y `rateHz` 0.01–0.2 Hz.

**Tests.**
- Complement on, feedback 0, wet = dry = 1, depth 0: left + right = 2 × input exactly.
- Same settings: left − right = 2 × the input delayed by `delayMs`.
- Complement off: output identical to today's Flanger.

---

### Cyclotron
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted; embedded
`CyclotronHelp.pict`) · params.tsv, presets (48 values: 6 published, two 16-step
tables, sync settings), choices.txt, manual p. 43–45, screenshots p043-0, p044-0*

A step-sequenced filter: sixteen steps of cutoff and sixteen of resonance drive a
low-pass or band-pass filter, with glide between steps and tempo sync. It is filed under
filter, not granular, and has no grains in it.

**Original interface.** Custom view, 404×399, dark grey with orange and green. Top: an
orange 16-bar multislider labelled "frequency" (≈x22,y5, 295×125); under it a row of
sixteen round step lights, the current step lit red (y≈130), then a row of sixteen
check boxes — the checked one marks the last step (y≈147); below, a green 16-bar
multislider labelled "resonance" (≈x22,y165, 295×120). The right edge carries the title
"cyclotron sequenced filter" written vertically. Bottom: "sync" menu (Free) and "note"
menu (1/4) (≈x30–150,y318), "tempo" knob with number 120.0 (≈x165,y320), "glide" and
"volume" knobs (≈x220–300,y320), "reset" switches (≈x40,y362) and a "mode" menu
(Lowpass, ≈x98,y362). A second, generic view (342×208) lists Tempo/Sync, Glide, Filter
Mode, # of Steps, Clock Source, Gain, Step Time, Bar Reset. Mono.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| frequency | 16-step multislider | 0–1 per step | preset | top |
| step lights | display | current step | — | under frequency |
| step count boxes | 16 check boxes | last step 1–16 | 16 | under lights |
| resonance | 16-step multislider | 0–1 per step | preset | middle |
| sync / Clock Source | menu | Free, UDT, Host, Plug (Clock Source published 0–2: Internal …) | Free | bottom left |
| note / Step Time | menu + multiplier | 1 … 1/64t | 1/4 | bottom left |
| tempo | knob + number | 10–240 BPM | 120 | bottom |
| glide | knob | 0–500 ms | 0 | bottom |
| volume / Gain | knob | −12 to +12 dB | −2 | bottom |
| mode | menu | Lowpass, Bandpass | Lowpass | bottom |
| reset / Bar Reset | toggle | Off, On | Off | bottom left |
| Presets | menu | 8: Sequenced Filtering, Basic Filter Sweep, Crank the Q, 4-note Self Oscillation, Sample & Hold, Complimentary Q, More Stepped Filtering, Even More | Sequenced Filtering | host menu |

In the preset vector, values 4–19 are the frequency steps and 20–35 the resonance steps
(read from the patterns: "4-note Self Oscillation" fills only the first four of each).

**Signal flow.** A clock (tempo × step time, or host) advances steps 1…N; each step
sets a target cutoff and resonance from the tables, reached over the glide time; they
drive a resonant low-pass or band-pass. Bar Reset returns to step 1 on a bar line in
synced modes. How the 0–1 table values map to Hz and to Q is not recoverable (inferred:
exponential across the audio range for frequency).

**Granular relation.** None in the DSP. Two links are worth having: the step clock can
take the cloud's grain rate (one step per grain, a filter that changes with every grain),
and a looped, stepped lane on Chamberlin's `lowFreq` already does a Cyclotron to any
file with no new code.

**Here.** New `StepFilter` ShapeKind, reusing Chamberlin's state-variable core.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `mode` | Mode | 0 low-pass, 1 band-pass | 0 | no | |
| `steps` | Steps | 1–16 | 16 | no | |
| `stepMs` | Step | 10–4000 | 500 | yes | ms |
| `glideMs` | Glide | 0–500 | 0 | no | ms |
| `gainDb` | Volume | −12 to 12 | −2 | no | dB |
| `lowHz` | Bottom (not in original) | 20–2000 | 60 | yes | Hz |
| `highHz` | Top (not in original) | 200–18 000 | 8000 | yes | Hz |
| `qMax` | Q at top (not in original) | 0.5–40 | 20 | yes | |
| `f01`…`f16` | Step frequency | 0–1 | preset 1 | no | |
| `q01`…`q16` | Step resonance | 0–1 | preset 1 | no | |

`lowHz`, `highHz` and `qMax` stand in for the unknown table mapping and make the
sequence transposable.

**Shared panel.** *Sequence* (frequency step display — primary — step lights, step
count, resonance step display), *Clock* (Step, Glide), *Filter* (Mode, Bottom, Top, Q,
Volume). Pad: X `stepMs` 60–2 000 ms, Y `glideMs` 0–500 ms.

**Tests.**
- All sixteen frequency steps equal: output matches Chamberlin's low-pass at that
  frequency within 0.1 dB.
- With `stepMs` 100 and glide 0, the band-pass centre changes exactly every 100 ms.
- `steps` 4: step 5's values never sound.

**Open questions.** The table-to-Hz and table-to-Q laws.

---

### Fragulator
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted; embedded
`stutter_pshift22.mxt`) · params.tsv, presets.tsv, choices.txt, manual p. 75–76,
screenshot p075-0*

Chops the input into fragments of a set size and loops each one, forwards or
backwards, at a set speed, while the next fragment records. Tiny fragments buzz like
bit-crushing; larger ones pitch-shift and ring-modulate. Feedback, repetition, dropout
and random amplitude turn it into a stammering, glitching sampler.

**Original interface.** Generic parameter list, 352×290, ten rows, strip "Fragulator may
be used for pitch shift ring modulation and downsampling effects." Mono. The table
overrides the manual: Buffer Size is 16–11 025 samples (manual 6–1024) and PBSpeed
0–4 (manual 0–2).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Buffer Size | slider (integer) | 16–11 025 samples | 30 | row 1 |
| PBSpeed | slider | 0–4 × | 3.79 | row 2 |
| PBDirection | menu | Forward, Reverse | Forward | row 3 |
| Feedback | slider | 0–0.99 | 0 | row 4 |
| Amp Variation | slider | 0–1 | 0 | row 5 |
| Repetition | slider | 0–1 (probability) | 0 | row 6 |
| Dropout | slider | 0–1 (probability) | 0 | row 7 |
| Gain | slider | −76 to +18 dB | 0 | row 8 |
| Dry Gain | slider | −76 to +18 dB | −76 | row 9 |
| Declick | switch | Off, On | Off | row 10 |
| Presets | menu | 16, e.g. Metal Filings, Helium, RoboDuck, Steel Wool, Plummeting, Kraftbot, LockedGroove, Octave Drop, 2400 Baud | Metal Filings | host menu |

**Signal flow.** The input plus Feedback × the output from one buffer earlier is
recorded in fragments of Buffer Size. While one records, the previous plays: looped at
PBSpeed, forwards or reversed, for exactly Buffer Size output samples, then the next
fragment takes over. At each switch, three draws: with probability Repetition the old
fragment plays again instead of the new one; with probability Dropout the fragment is
silent; and its level is scaled down by a random amount up to Amp Variation. Fragments
butt together with no crossfade — the discontinuities are the sound (Metal Filings is a
30-sample buffer, a buzz near 1.5 kHz). Declick fades only when Buffer Size changes.

**Granular relation.** Fragulator is the grain cloud with one layer, overlap 1 (hop =
size, the "fitted" branch GRAIN-EMISSION.md describes), a rectangular window, grain size
= Buffer Size (0.4–250 ms), per-grain rate = PBSpeed with the grain looping inside its
own length, and `reverse` = PBDirection. The cloud has no rectangular envelope, no loop
inside a grain, no per-grain chance (Dropout), no amplitude jitter (Amp Variation), no
"hold the last grain" (Repetition) and no feedback. On the live-buffer core every one of
those is one line in the scheduler.

**Here.** New `Fragulator` ShapeKind on the live-buffer core.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `bufferSamples` | Buffer | 16–11 025 | 30 | yes | samples |
| `speed` | Speed | 0–4 | 3.79 | no | x |
| `reverse` | Reverse | 0–1 | 0 | no | |
| `feedback` | Feedback | 0–0.99 | 0 | no | |
| `ampVar` | Amp variation | 0–1 | 0 | no | |
| `repeat` | Repetition | 0–1 | 0 | no | |
| `dropout` | Dropout | 0–1 | 0 | no | |
| `wetDb` | Wet | −76 to 18 | 0 | no | dB |
| `dryDb` | Dry | −76 to 18 | −76 | no | dB |
| `declick` | Declick | 0–1 | 0 | no | |

**Shared panel.** *Fragment* (Buffer — primary — Speed, Reverse), *Chance* (Repetition,
Dropout, Amp variation), *Feedback*, *Levels* (Wet, Dry, Declick). Pad: X
`bufferSamples` 16–4 096, Y `speed` 0.25–4.

**Tests.**
- Speed 1, forward, no feedback or chance: output equals the input delayed by one
  buffer, sample for sample.
- Speed 2 with a 2 048-sample buffer: a 441 Hz sine comes out with its strongest
  component at 882 Hz.
- Dropout 1: silence. Repetition 1 after the first fragment: output is periodic with
  period one buffer.
- Two renders with the same seed are identical; a different seed differs when any chance
  control is above 0.

---

### Granular-to-Go
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted; embedded
`granular_globule2`, `granular_globber`, `granular_goober`, two `randPulse`, two
`kitSynthEnv2~`) · params.tsv, presets.tsv, choices.txt, manual p. 80–82, screenshot
p080-0*

A granular synthesizer on its own live input. Each event — a *pulse* — grabs a short
piece of recent input, loops it at a speed under an envelope for the pulse's duration,
at a random level, and may or may not sound. Every one of those four things has an
offset and a random range, so it runs from exact pitch-shifting and ring modulation
(ranges at zero) to a blurred cloud.

**Original interface.** Generic parameter list, 352×359, thirteen rows, strip
"Granular-to-go grabs a random number of samples from the input and plays them with
random duration amplitude and speed". Mono in, stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| PulseOffset | slider | 5–1000 ms | 5 | row 1 · Pulse |
| PulseRange | slider | 0–1000 ms | 96 | row 2 · Pulse |
| AmpOffset | slider | 0–127 | 0 | row 3 · Amp |
| AmpRange | slider | 0–127 | 127 | row 4 · Amp |
| Density | slider | 0–100 % (chance a pulse sounds) | 100 | row 5 |
| GrainOffset | slider | 1–11 025 samples | 491 | row 6 · Grain |
| GrainRange | slider | 0–11 025 samples | 1568 | row 7 · Grain |
| PBSpeedOffset | slider | 0.001–10 × | 0.8 | row 8 · Speed |
| PBSpeedRange | slider | 0–10 × | 0.4 | row 9 · Speed |
| Gain | slider | −76 to +18 dB | 0 | row 10 |
| Dry Gain | slider | −76 to +18 dB | −76 | row 11 |
| On/Off Left | switch | Off, On | On | row 12 |
| On/Off Right | switch | Off, On | On | row 13 |
| Presets | menu | 16, e.g. Number Crunch, Skipping CDs, Komputor, Interference, Light Speed, Insta-Type, Syncopation, Gravel Pit, Really Sparse | Number Crunch | host menu |

**Signal flow.** Two voices, one per output side (inferred from the paired `randPulse`
and `kitSynthEnv2~`). For each voice, pulse after pulse with no gap or overlap: draw a
duration (PulseOffset + random × PulseRange), a loop length (GrainOffset + random ×
GrainRange samples, taken from the most recent input), a level ((AmpOffset + random ×
AmpRange) ÷ 127) and a speed (PBSpeedOffset + random × PBSpeedRange); with probability
Density the pulse sounds. During the pulse the captured loop plays repeatedly at that
speed under an envelope (shape not stated). The manual describes PBSpeed once as the
event rate and once as the rate notes are played at; the plug-in's own description
("plays them with random … speed") settles it as playback speed.

**Granular relation — how it maps onto the cloud.**

| Granular-to-Go | Cloud control | Fit |
| --- | --- | --- |
| Pulse offset + range | `windowMs` + `sizeJitter`, `sizeRange` above 1 for the wide ranges | good; 5–2 000 ms is inside the window's 5–2 000 ms |
| One voice per side, end to end | `layers` 2, `overlap` 1, `rateHz` 0 (the fitted branch), `panSpread` 1 | good |
| PBSpeed offset + range | `semitones` (12·log₂ speed) + `pitchJitterSemis` | partial: 0.001× is −120 st, below the −48 floor; range is one-sided upward |
| Density % | — | missing: per-grain chance of sounding |
| Amp offset + range | — | missing: per-grain amplitude jitter |
| Grain offset + range (loop length) | — | missing: a loop inside the grain; nearest is a very short window with `scan` 0 |
| Input is the last ≤ 250 ms of live audio | `position` + `positionJitterMs`, on a file | different source |

So the rack effect is the faithful version, and two small cloud controls — a grain
chance and an amplitude jitter — would let the engine do most of Granular-to-Go to the
file itself. Those belong in a grain-controls spec, not here.

**Here.** New `GrainToGo` ShapeKind on the live-buffer core.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `pulseMs` | Pulse | 5–1000 | 5 | yes | ms |
| `pulseRangeMs` | Pulse range | 0–1000 | 96 | no | ms |
| `ampMin` | Level | 0–1 | 0 | no | |
| `ampRange` | Level range | 0–1 | 1 | no | |
| `density` | Density | 0–1 | 1 | no | |
| `loopSamples` | Grain | 1–11 025 | 491 | yes | samples |
| `loopRangeSamples` | Grain range | 0–11 025 | 1568 | no | samples |
| `speed` | Speed | 0.001–10 | 0.8 | yes | x |
| `speedRange` | Speed range | 0–10 | 0.4 | no | x |
| `wetDb` | Wet | −76 to 18 | 0 | no | dB |
| `dryDb` | Dry | −76 to 18 | −76 | no | dB |
| `leftOn` | Left | 0–1 | 1 | no | |
| `rightOn` | Right | 0–1 | 1 | no | |

**Shared panel.** Four offset-and-range pairs as four rows of two dials, in the
original's order — *Pulse*, *Level*, *Grain*, *Speed* — then *Density*, *Levels* (Wet,
Dry) and *Sides* (Left, Right switches). Primary: Grain. A display shows recent pulses
as blocks (length, level, speed) on a time line. Pad: X `loopSamples` 1–11 025, Y `speed`
0.1–4 — the manual's recognisability axis against pitch.

**Tests.**
- All ranges 0, density 1, level 1, speed 1, `loopSamples` larger than one pulse: each
  pulse is an unaltered piece of recent input.
- Density 0: silence.
- Ranges 0, speed 2: a 440 Hz input sine comes out at 880 Hz.
- With pulse range above 0, left and right differ; with the same seed, two renders
  match.

---

### Raindrops
*Pluggo 3.6.1, Cycling '74 (jhno), 2006 · VST (Max patch, encrypted; embedded
`raindrop.mxt`, `iraindrops.pict`) · params.tsv, presets.tsv, manual p. 167–168,
screenshot p167-0*

Turns a sound into a field of particles: band-pass "droplets" appear at random, each
tuned to a random frequency in a range, each with its own short envelope, each letting
through only its sliver of the input's spectrum. A drive stage at the end saturates
them.

**Original interface.** Generic parameter list, 352×267, nine rows, strip "Raindrops (by
jhno)". Mono.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–1 | 1 | row 1 |
| Dry Level | slider | 0–1 | 0 | row 2 |
| Density | slider | 0–1000 drops | 500 | row 3 · Drops |
| Attack | slider | 0–1000 ms | 1 | row 4 · Envelope |
| Decay | slider | 0–1000 ms | 10 | row 5 · Envelope |
| Min Frequency | slider | 1–20 000 Hz | 625 | row 6 · Range |
| Max Frequency | slider | 1–20 000 Hz | 5313 | row 7 · Range |
| Resonance | slider | 0–200 Q | 137 | row 8 |
| Gain/Overdrive | slider | 0–1 | 0.42 | row 9 |
| Presets | menu | 8: Raindrops, Hailstorm, Exciter, Rings, Blips, Exciter 2, Bathtub Fun, Just a Few Drops | Raindrops | host menu |

**Signal flow.** Drops are triggered at about Density per second (timing distribution
not stated). Each picks a centre between Min and Max Frequency, retunes a band-pass of
the input to it with Q Resonance, and gates the filter's output with an attack-decay
envelope. The manual's own note says there are really two band-pass filters giving the
illusion of a network, so drops alternate between two filter voices and a new drop cuts
the oldest short (inferred). The sum goes through Gain/Overdrive — a gain into a
saturator, distorting when high — then wet and dry are mixed.

**Granular relation.** Raindrops is a grain cloud in frequency: Density is a true
emission rate (`rateHz` in GRAIN-EMISSION.md's sense — independent of drop length);
attack + decay is the grain's length and attack ÷ (attack + decay) is the `envelope`
peak position; the Min–Max range is a per-grain random draw, as pitch jitter is, but of
a filter centre; the two voices are two layers. A cloud whose grains each carry a
random band-pass would be the engine-side version; this spec is the rack version.

**Here.** New `Raindrops` ShapeKind (band-passes from Chamberlin's core).

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 1 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `dropsPerSec` | Density | 0–1000 | 500 | no | /s |
| `attackMs` | Attack | 0–1000 | 1 | no | ms |
| `decayMs` | Decay | 0–1000 | 10 | no | ms |
| `minHz` | Lowest | 1–20 000 | 625 | yes | Hz |
| `maxHz` | Highest | 1–20 000 | 5313 | yes | Hz |
| `q` | Resonance | 0.5–200 | 137 | yes | |
| `drive` | Gain/Overdrive | 0–1 | 0.42 | no | |
| `voices` | Voices (not in original) | 1–16 | 2 | no | |

**Shared panel.** *Drops* (Density — primary), *Envelope* (Attack, Decay), *Range*
(Lowest, Highest, Resonance, Voices), *Output* (Drive, Wet, Dry). A display plots the
drops as dots of frequency against time. Pad: X `dropsPerSec` 0–1000, Y `decayMs` 1–500.

**Tests.**
- `dropsPerSec` 0: the wet output is silent.
- Lowest = Highest = 1 kHz, Q 100, white-noise input: the output spectrum peaks at 1 kHz.
- At 5 drops per second, onsets counted over 10 s fall between 30 and 70.

---

### Shuffler
*Pluggo 3.6.1, Cycling '74 (jhno), 2006 · VST (Max patch, encrypted; embedded
`lineseq3.2~`, `multimate`, `changef`, `ratesync~`, `jhnob.black2`, `shuffler.pict`,
`swirl.tall.pict`) · params.tsv, presets (80 values: 14 published, 32 slice positions,
32 slice speeds, 2 unknown), manual p. 185–186, screenshot p185-0*

Records the input into a loop and plays it back in slices, in any order and at any
speed per slice: re-ordered beats, reversed hits, stutters, smears. An attack-sustain
glide inside each slice and a freeze switch make it a live re-arranger.

**Original interface.** Custom view, 348×349, dark. Left: two stacked multisliders — slice
*position* per step (dark-blue bars on steel blue, ≈x2,y12, 250×165) and slice *speed*
per step (short dark lines on mauve, ≈x2,y190, 250×125) — each with thin horizontal
sliders above and below (≈y3, y180, y320, y330; inferred: wet, dry, stereo, delay are
among them). Right column: number boxes "# Slices" (8), "Sync" (UDT), "BPM" (160.),
"Multiply" (4.), "Delay" (0) (≈x255,y3–70); "Attack" and "Sustain" knobs (≈x258,y85 and
y128); three small boxes and a round "Restart" button (≈x255,y168); a thin vertical
slider labelled "Fz" (≈x256,y185, 8×125) and a "Pitch" control (≈x268,y250); a white
spiral graphic (≈x290,y185); a pair of arrows at bottom right (mode, inferred). Mono.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Slice positions | 32-step multislider | 0–1 of the loop | preset | top left |
| Slice speeds | 32-step multislider | 0–1 (0.732 most common; inferred 1×) | preset | lower left |
| # Slices (steps) | number | 1–32 (manual 1–16) | 8 | right |
| Sync Source | menu | UDT, Host, Plug (published 0–5) | UDT | right |
| BPM | number | 1–1000 (manual 1–300) | 160 | right |
| Multiply | number | 0.01–8 (bars per cycle) | 4 | right |
| Delay | number | 0–500 ms | 0 | right |
| Attack | knob | 0–1 | 0 | right |
| Sustain | knob | 0–1 | 1 | right |
| Mode | switch | 0–1 | 0 | inferred: arrows |
| Freeze (Fz) | switch | 0–1 | 0 | right |
| Restart (trigger) | button | restarts the sequence | — | right |
| pitch | control | 0–599 (not in manual) | 300 | right ("Pitch") |
| Wet / Dry | sliders | 0–1 | 1 / 0 | thin sliders |
| Stereo | slider | −2 to +2 | 0.11 | thin slider |
| Presets | menu | 12: Durge, Gravity, Scattered, Stuck, What to do, Stepping, Four is Enough?, 3 Slow 1 Fast, Jackhammer, Convergence, Unnatural Echos, Off the Mark | Durge | host menu |

**Signal flow.** The input records continuously into a loop one cycle long (Multiply
bars of 4/4 at BPM; 6 s for the default) unless Freeze holds it. The cycle is cut into N
steps; at step k the read head jumps to position[k] × loop and plays at speed[k]. Attack
and Sustain shape how the read head reaches its slice position (`lineseq3.2~`): Attack
is the time to arrive, Sustain the target; Mode changes how the two apply. Delay offsets
the output; Stereo sets a width (the manual's "1 is mono" is unexplained). Restart
resets the step counter. The speed table's units and the 0–599 pitch control's role are
not recoverable.

**Granular relation.** On a file, Shuffler is a stepped, looped automation lane on the
cloud's Read position (`stretch.grain.position`) with `scan` 0, plus a stepped lane on
Pitch for the speeds. The engine can already do that to a whole document. The rack
effect is for doing it to whatever comes out of the engine, live.

**Here.** New `Shuffler` ShapeKind on the live-buffer core.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 1 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `steps` | Slices | 1–32 | 8 | no | |
| `bpm` | Tempo | 1–1000 | 160 | yes | BPM |
| `bars` | Bars per cycle | 0.01–8 | 4 | yes | |
| `attack` | Attack | 0–1 | 0 | no | |
| `sustain` | Sustain | 0–1 | 1 | no | |
| `mode` | Mode | 0–1 | 0 | no | |
| `freeze` | Freeze | 0–1 | 0 | no | |
| `restart` | Restart | 0–1 (rising edge) | 0 | no | |
| `delayMs` | Delay | 0–500 | 0 | no | ms |
| `stereo` | Stereo | −2 to 2 | 0.11 | no | |
| `quantize` | Snap to slices | 0–1 | 0 | no | |
| `p01`…`p32` | Slice position | 0–1 | preset 1 | no | |
| `s01`…`s32` | Slice speed | 0–1 | 0.732 | no | |

`quantize` is the Slice-n-Dice addition (next section).

**Shared panel.** *Slices* (position step display — primary — over the speed step
display, sharing a step axis), *Clock* (Slices, Tempo, Bars, Delay, Restart), *Glide*
(Attack, Sustain, Mode), *Loop* (Freeze), *Output* (Wet, Dry, Stereo). Pad: X `bars`
0.25–8, Y `sustain` 0–1.

**Tests.**
- Positions k ÷ N, speeds at unity, attack 0, sustain 1: the output is the input delayed
  by one cycle.
- Freeze on: after freezing, a change in the input does not reach the output.
- With 8 slices of a 1 s cycle, position jumps happen every 125 ms ± 1 sample.

**Open questions.** The speed-table law, the 0–599 pitch control, and Mode.

---

### Slice-n-Dice
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted; embedded
`aboutSnD.pict`) · params.tsv, presets (41 values: 4 published, 32 slice choices,
sync settings), choices.txt, manual p. 190–192, screenshots p190-0, p191-0*

Records continuously, cuts the last stretch into 32 equal slices, and plays them back in
the order a multislider says. A diagonal is a plain delay, the other diagonal is a
"backwards" made of forward slices, and anything else is a skipping CD.

**Original interface.** Two views. *Parameters* (352×115): Total Time 1/4, Sync, Dry
Level, Wet Level. *Slicer* (352×294): a 32-step multislider (light blue, ≈x20,y10,
285×160; vertical axis "slice →", horizontal "time →"); right of it a grey dry slider
and a blue wet slider (≈x310 and x323, y10–165) with a "0" readout; below, "time 1/4 ="
number box (4000) "ms"; "sync" menu (Free) with a note-value box (1); a total-time
readout (16000 ms); buttons "forward", "reverse", "random". Mono.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Slice order | 32-step multislider | slice 1–32 per step | Forward | Slicer, top |
| Total Time (1/4) | slider / number | 32–4000 ms (time of a quarter) | 1974 | Slicer, bottom |
| Note Value | menu | 1 … 1/64t (multiplies total time) | 1 | Slicer, beside sync |
| Total time | display | ms | — | under sync |
| Sync | menu | Free, Host, PluggoSync | Free | Slicer |
| Dry Level | slider | −70 to +18 dB (grey) | 0 | Slicer right |
| Wet Level | slider | −70 to +18 dB (blue) | 0 | Slicer right |
| forward / reverse / random | buttons | fill the table | — | Slicer bottom |
| Presets | menu | 10: Forward, Backward, Bipolar, Forth & Back, Digital Error #1, Digital Error #2, Max Whatshisname, Froggy Backmasking, 2x @ 2x speed, K-k-k-Ken! | Forward | host menu |

**Signal flow.** The input records into a buffer of the total time T; T is cut into 32
slices; at output step k (each T ÷ 32 long) the slice named by step k of the table is
played from the last completed T. The output therefore lags by T. Slices play forward
at normal speed; there is no per-slice speed.

**Granular relation.** As Shuffler: a stepped, looped lane on Read position, here with
32 fixed slots.

**Here.** Adjust **Shuffler** (this batch): Slice-n-Dice is Shuffler with 32 steps,
speeds at unity, attack 0, sustain 1, and positions snapped to slice starts. Add
`quantize` (in Shuffler's table above) and ship the ten presets as Shuffler presets.
Total time maps to `bpm` and `bars` (T = bars × 4 × 60 000 ÷ bpm); the dB levels map to
`wet` and `dry`.

**Shared panel.** Shuffler's panel; a Slice-n-Dice preset opens with the speed display
collapsed and Forward / Reverse / Random as table actions. Pad: X `bars`, Y `sustain`,
as Shuffler.

**Tests.**
- `quantize` on: every position lands on a multiple of 1 ÷ `steps`.
- The Forward table equals a delay of exactly one cycle.
- The Backward table: output slice k correlates best with input slice 31 − k.

---

### SquirrelParade
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted; embedded
`matrix_switch_4.mxt`, `sp_bak16.pct`) · params.tsv (36), presets.tsv, choices.txt,
manual p. 198–199, screenshot p198-0*

Four granular channels read the input, each at its own speed, and a 4×4 matrix lets any
channel frequency-modulate any other's playback speed. Repeat and dropout make the
grains stutter and vanish. A built-in test tone shows what the warping does.

**Original interface.** Custom view, 432×257, lavender, with a squirrel drawing and the
title "QUIRREL PARADE" across the top (background picture). Number boxes in a row:
"stereo spread" (≈x93,y75), "grain size", "window", "repeat", "dropout" (≈x188–372,y75).
Left: an "output" vertical slider (≈x10,y125, 25×105) with a number under it. Centre: the
"send / recv" matrix, 4×4 round buttons with 1–4 across ("send") and down ("recv")
(≈x90,y125, 70×70; orange or cyan when on, purple when off, inferred). Under it "test
tone" with "freq" number (440.) and an "on/off" toggle (≈x92–150,y233). Right: three
rows of four number boxes — "grain base speed", "grain fm depth", "grain volume", each
1–4 (≈x188–372, y118 / y172 / y233). Mono in, stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| stereo spread | number | −1 to 1 | 0.27 | top row |
| grain size | number (integer) | 4–44 100 samples | 3056 | top row |
| window | number | 0–1 (fade fraction) | 0.27 | top row |
| repeat | number | 0–1 (probability) | 0 | top row |
| dropout | number | 0–1 (probability) | 0 | top row |
| output | slider | −76 to +18 dB | 0 | left |
| send/recv matrix | 16 toggles (FM 1.1 … FM 4.4) | Off, On | preset | centre |
| test tone freq | number | 0–2000 Hz | 440 | centre bottom |
| test tone on/off | toggle | Off, On | Off | centre bottom |
| grain base speed 1–4 | numbers | 0–10 × | 1, 0.01, 0.02, 1 | right row 1 |
| grain fm depth 1–4 | numbers | 0–10 | 0.17, 0.03, 0.05, 0.12 | right row 2 |
| grain volume 1–4 | numbers | 0–0.25 | 0.25, 0, 0, 0.25 | right row 3 |
| Presets | menu | 16, e.g. Take Us To Your Acorn, Raining Nuts, Squirrel And Hold, Squirbulence, Fragulation Station, Scoiattolo Futuristo, Gershwin In The Trees?, The Nuthouse, Squirrel Trouble | Take Us To Your Acorn | host menu |

**Signal flow.** The input (or the test-tone sine) feeds four grain players. Each plays
grains of the grain size from recent input with linear fades over the window fraction
at its ends, at a speed of base speed + fm depth × modulator, where the modulator is the
sum of the outputs of the channels whose matrix cell routes into it — audio-rate cross
modulation of playback speed, including feedback loops (inferred from the manual's
send/receive description). Per grain, with probability repeat the previous grain plays
again; with probability dropout it is muted. Each channel × its volume, spread across
the stereo field by stereo spread (negative reverses the order), × output.

**Granular relation.** Four layers with independent rates (`layers` 4, each with its
own pitch), a linear-fade window (`envelope` near 0.5 with a trapezoid), `panSpread` for
stereo spread. Two things the cloud lacks: per-layer rate set by hand, and cross-layer
FM — the cloud's `pitchDriftSemis` is a slow random wander, not one layer driving
another. Repeat and dropout are the same missing per-grain hold and chance as
Fragulator's.

**Here.** New `SquirrelParade` ShapeKind on the live-buffer core.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `speed1`…`speed4` | Base speed 1–4 | 0–10 | 1, 0.01, 0.02, 1 | no | x |
| `fm1`…`fm4` | FM depth 1–4 | 0–10 | 0.17, 0.03, 0.05, 0.12 | no | |
| `vol1`…`vol4` | Volume 1–4 | 0–0.25 | 0.25, 0, 0, 0.25 | no | |
| `grainSamples` | Grain size | 4–44 100 | 3056 | yes | samples |
| `window` | Window | 0–1 | 0.27 | no | |
| `repeat` | Repeat | 0–1 | 0 | no | |
| `dropout` | Dropout | 0–1 | 0 | no | |
| `spread` | Stereo spread | −1 to 1 | 0.27 | no | |
| `outDb` | Output | −76 to 18 | 0 | no | dB |
| `fm11`…`fm44` | Send j → receive i | 0–1 each | preset 1 | no | |
| `toneHz` | Test tone | 0–2000 | 440 | no | Hz |
| `tone` | Test tone on | 0–1 | 0 | no | |

**Shared panel.** *Grains* (Grain size — primary — Window, Repeat, Dropout, Stereo
spread), *Channels* (a 4-column block: speed, FM depth, volume per channel, matching the
original's three rows), *Matrix* (4×4 switch grid), *Test* (tone frequency, on), *Output*.
Pad: X `grainSamples` 64–44 100, Y `fm1` 0–2.

**Tests.**
- Matrix off, FM 0, one channel at speed 1 and volume 0.25, window 0: output is the input
  × 0.25, delayed, apart from grain boundaries.
- Speed 2 on that channel: a 440 Hz test tone comes out at 880 Hz.
- Turning on one matrix cell with FM depth 1 adds sidebands around the carrier tone.
- Dropout 1: silence.

---

### Stutterer
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted; embedded `stutt2.mxt`,
`stutterer.pict`, `istutterer.pict`) · params.tsv (25), presets (93 values: 25 + two
32-point pitch trajectories + 4 unknown), manual p. 204–205, screenshot p204-0*

Grabs the last moment of the input and repeats it a set number of times — on a button,
or automatically at an interval — with each repeat's pitch following a drawn
trajectory, optionally reversed or frozen. Left and right are fully independent, so the
two sides stutter against each other.

**Original interface.** Custom view, 428×178, teal and grey, mirror-symmetric. Top
centre: three round buttons — left bang, a larger green big bang, right bang
(≈x186–245,y3). Under them, two small controls and two narrow vertical sliders in the
centre column (≈x200–222,y28–115; inferred: pitch min and max per side). Each half: a
"freeze" and a "reverse" toggle (left ≈x28,y32 and x95,y32; right mirrored, labelled
"esrever" and "ezeerf"); a pitch-trajectory multislider (left ≈x28,y45, 170×70; right
≈x228,y45); outer narrow vertical sliders for dry and wet (≈x5–22 and x405–422,
y45–115). Four rows along the bottom, a slider and number per side with the label in the
centre: "stutter time" (182 | 146), "# of stutters" (13 | 17), "auto trigger" (1100 |
1800, with an on toggle at each far end), "portamento" (0.92 | 0.61). Mono or stereo in,
stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Left / Right Dry | slider | 0–127 | 127 | outer sliders |
| Left / Right Wet | slider | 0–127 | 127 | outer sliders |
| Left / Right Number | slider + number | 0–74 stutters | 6 / 10 | bottom row 2 |
| Left / Right Stutter Time | slider + number | 1–60 000 ms | 60 / 47 | bottom row 1 |
| Left / Right AutoTrigger | toggle | Off, On | On | bottom row 3 ends |
| Left / Right Trigger Time | slider + number | 1–60 000 ms | 3600 / 2150 | bottom row 3 |
| Left / Right Portamento | slider + number | 0–1 | 0.62 / 0 | bottom row 4 |
| Left / Right Freeze | toggle | Off, On | Off | top |
| Left / Right Reverse | toggle | Off, On | Off / On | top |
| Left / Right Pitch Min | slider | 0–127 (64 = unchanged, inferred) | 64 | centre |
| Left / Right Pitch Max | slider | 0–127 | 64 | centre |
| Left / Right pitch trajectory | 32-step multislider | 0–1 | flat | halves |
| Left / Right Bang | button | trigger one side | — | top |
| Big Bang | button | trigger both | — | top centre |
| Presets | menu | 8: Tight, Stutterer, Up-n-Down, Tune, Metric, All Reverse, Bang Your Head, 3 One Sec Loops | Tight | host menu |

**Signal flow.** Per side: a trigger (its bang, big bang, or every Trigger Time when auto
is on) captures the last Stutter Time of input — unless Freeze, which keeps the previous
capture — and plays it Number times back to back, reversed if set. Repeat k's pitch is
the trajectory's value at k, scaled between Pitch Min and Max; Portamento glides between
those pitches. Dry and wet are 0–127 levels. The presets that leave pitch alone set Min
and Max both to 64, so 64 is unity (inferred); the unit of the rest of the scale is not
recoverable.

**Granular relation.** A stutter is one grain (size = Stutter Time) emitted Number times
in a row with a stepped pitch lane — the cloud with `scan` 0 for the duration of the
burst and a pitch sequence per grain. Nothing in the engine repeats a single grain a
counted number of times.

**Here.** New `Stutterer` ShapeKind on the live-buffer core.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `dryL`, `dryR` | Dry | 0–1 | 1 | no | |
| `wetL`, `wetR` | Wet | 0–1 | 1 | no | |
| `countL`, `countR` | Stutters | 0–74 | 6 / 10 | no | |
| `sliceMsL`, `sliceMsR` | Stutter time | 1–60 000 | 60 / 47 | yes | ms |
| `autoL`, `autoR` | Auto trigger | 0–1 | 1 | no | |
| `everyMsL`, `everyMsR` | Trigger every | 1–60 000 | 3600 / 2150 | yes | ms |
| `glideL`, `glideR` | Portamento | 0–1 | 0.62 / 0 | no | |
| `freezeL`, `freezeR` | Freeze | 0–1 | 0 | no | |
| `reverseL`, `reverseR` | Reverse | 0–1 | 0 / 1 | no | |
| `pitchMinL`, `pitchMinR` | Pitch low | 0–127 | 64 | no | |
| `pitchMaxL`, `pitchMaxR` | Pitch high | 0–127 | 64 | no | |
| `trigL`, `trigR`, `trigBoth` | Bang | 0–1 (rising edge) | 0 | no | |
| `tl01`…`tl32`, `tr01`…`tr32` | Trajectory | 0–1 | 0 | no | |

Dry and wet 0–127 become 0–1.

**Shared panel.** Mirrored as in the original: *Left* and *Right* groups side by side,
each with trajectory step display (primary), Freeze, Reverse, Stutter time, Stutters,
Auto + Trigger every, Portamento, Pitch low/high, Dry, Wet; a centre strip with the
three bang buttons. Pad: X `sliceMsL` 10–1 000 ms, Y `countL` 1–32.

**Tests.**
- One trigger with count 3, 100 ms, pitch 64, glide 0: the wet output holds three
  identical copies of the input's last 100 ms.
- Reverse on: the copy is the captured audio time-reversed.
- Auto every 500 ms: bursts start 500 ms apart ± 1 sample.
- Freeze on: a second trigger replays the first capture although the input changed.

**Open questions.** The pitch scale's unit, and the four unpublished preset values.

---

### Convolver
*Pluggo 3.6.1, Cycling '74 (Stuck, Settel, Lippe), 2006 · VST (Max patch, encrypted;
embedded `convolver_pfft.mxt`) · params.tsv, presets.tsv, choices.txt, manual p. 42,
screenshot p042-0*

Real-time cross-synthesis: each block of a source signal is shaped by the magnitude
spectrum of a filter signal, so the source keeps its own content but takes on the
filter's spectral envelope. A three-way balance runs from source alone, through the
cross-synthesis, to filter alone.

**Original interface.** Custom view, 328×108, pale yellow. Title "Source-Filter
Convolution"; labels "Source Sound" and "Filter Sound"; under them two menus ("Left
Plug-in Input", ≈x8,y45, 130×14; "Right Plug-in Input", ≈x176,y45) with an "Equal"
button between (≈x141,y45; inferred: centres the balance); a "pb" mark; a wide yellow
"Balance" slider (≈x18,y63, 275×18); credit "Stuck, Settel, Lippe". Mono, stereo or bus
in; mono out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Source Sound | menu | Off, LeftIn, RightIn, PluggoBus1L … 4R | LeftIn | left |
| Filter Sound | menu | as above | RightIn | right |
| Equal | button | balance to centre (inferred) | — | between menus |
| Balance | slider | 0–255 (source … convolution … filter) | 127.5 | bottom |
| Presets | menu | 3: Convolution, Source Sound Only, Filter Sound Only | Convolution | host menu |

**Signal flow.** Both signals go through an FFT (in `convolver_pfft`); the source's
complex spectrum is multiplied by the filter's magnitude spectrum, inverse-transformed
and overlap-added. Balance crossfades source → product → filter across its range
(piecewise linear, inferred). FFT size and window are not recoverable.

**Granular relation.** None; it shares STFT machinery with the vocoder engine
(`vocoder.rs`). It is also the "ring modulate" option of the planned SoundHack
Convolution (magnitude only, no impulse phase), done live between two signals.

**Here.** New `CrossSynth` ShapeKind, on the same FFT as the planned Convolution.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `balance` | Balance | 0–2 (1 = cross-synthesis) | 1 | no | |
| `source` | Source | 0 left, 1 right, 2 mid | 0 | no | |
| `filter` | Filter | 0 left, 1 right, 2 same as source, 3 library sound | 1 | no | |
| `fftSize` | FFT size (not in original) | 256–8192, powers of two | 1024 | yes | |
| `filterBlur` | Smooth filter (not in original) | 0–1 | 0 | no | |

`filterBlur` smooths the filter's magnitudes across bins — toward a vocoder at 1. The
library sound for `filter` 3 is chosen the way the planned Convolution chooses its
impulse.

**Shared panel.** *Signals* (Source menu, Filter menu, Equal action), *Balance* (wide
slider, primary), *Analysis* (FFT size, Smooth). Display: the filter's magnitude
spectrum. Pad: X `balance` 0–2, Y `filterBlur` 0–1.

**Tests.**
- Balance 0: output equals the source, delayed by the slot's reported latency.
- Filter = white noise, source = a sine, balance 1: output is that sine (one dominant
  bin).
- Filter silent, balance 1: output silent.

**Open questions.** Where the filter sound comes from when the rack's file is mono.

---

### Vocoder 10-band
*Pluggo 3.6.1, Cycling '74 (Adam Schabtach), 2006 · VST (Max patch, encrypted; embedded
`osc_interface`, five `AS_vocElemPoly`, `lop1~`, `vocodeAbout.pict`) · params.tsv,
presets (23 values: 8 published + 15 synthesizer settings), choices.txt, manual
p. 234–237, screenshots p234-0, p236-0*

A classic channel vocoder: the input (modulator) is split into bands, each band's level
is followed, and those levels open the matching bands of a carrier. It has its own
three-oscillator-plus-noise synthesizer for the carrier, so the talking-synth effect
needs nothing else. Bands alternate left and right for a synthetic stereo image.

**Original interface.** Two views. *Parameters* (395×240): eight rows, strip "Vocoder by
Adam Schabtach". *Synthesizer* (≈196×205): title "Carrier Synthesizer"; three rows, each
a Waveshape menu, a Pitch number shown as a note name, a Detune number and a Pulse Width
number (columns ≈x10, x78, x115, x155); then "Osc. Volume", "Noise Volume" and a
"Monitor" check box. Mono (or bus) in, stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Modulator Level | slider | 0–2 | 0.8 | Parameters row 1 |
| Carrier Level | slider | 0–2 | 0.8 | row 2 |
| Output Level | slider | 0–2 | 0.8 | row 3 |
| Carrier Source | menu | Synthesizer, PluggoBus1L … 4R | Synthesizer | row 4 |
| Base Frequency | slider | 20–1000 Hz | 130 | row 5 |
| Frequency Spread | slider | 1–2 (ratio between bands) | 1.5 | row 6 |
| Filter Q | slider | 10–100 | 40 | row 7 |
| Tracking | slider | 10–500 | 200 | row 8 |
| Waveshape 1–3 | menu | Off, Sawtooth, Rectangle | Rectangle | Synthesizer rows 1–3 |
| Pitch 1–3 | number | MIDI 0–127 (manual C-2 … E6) | 48, 60, 55 | Synthesizer |
| Detune 1–3 | number | −10 to +10 % | 0 | Synthesizer |
| Pulse Width 1–3 | number | 1–99 % | 52, 50, 50 | Synthesizer |
| Osc. Volume | number | 0–1 | 0.5 | Synthesizer |
| Noise Volume | number | 0–1 | 0 | Synthesizer |
| Monitor | check box | hear the carrier alone | Off | Synthesizer |
| Presets | menu | 8: Default Values, C maj, C min, Low F octaves, High A octaves, Fifths, Oct. + flatted 5th, Just noise | Default Values | host menu |

The synthesizer settings are preset-only (stride 23); C maj stores pitches 48, 52, 55
and C min 48, 51, 55, which fixes the pitch scale as MIDI 0–127.

**Signal flow.** Modulator = input × Modulator Level → ten band-passes at Base ×
Spread^k (k = 0…9; 130 Hz to about 5 kHz by default) with Q → envelope followers (`lop1~`
one-pole smoothing; Tracking sets it, lower being faster per the manual). Carrier
(synth, or a bus) × Carrier Level → ten matching band-passes; each × its envelope; bands
summed alternately to left and right × Output Level. The synth: three oscillators
(saw or pulse with width, pitch, detune) × Osc. Volume plus white noise × Noise Volume.

**Here.** New `ChannelVocoder` ShapeKind. Its UI name must say "Channel vocoder": the
engine already has a Vocoder (the phase vocoder) and the two are unrelated. The carrier
bus becomes *the other channel* (left modulates, right carries).

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `bands` | Bands | 4–32 | 10 | no | |
| `modLevel` | Modulator | 0–2 | 0.8 | no | |
| `carLevel` | Carrier | 0–2 | 0.8 | no | |
| `outLevel` | Output | 0–2 | 0.8 | no | |
| `carrier` | Carrier source | 0 synth, 1 other channel | 0 | no | |
| `baseHz` | Base | 20–1000 | 130 | yes | Hz |
| `spread` | Spread | 1–2 | 1.5 | no | |
| `q` | Q | 10–100 | 40 | yes | |
| `tracking` | Tracking | 10–500 | 200 | yes | |
| `stereoAlt` | Alternate L/R (not in original) | 0–1 | 1 | no | |
| `wave1`…`wave3` | Wave | 0 off, 1 saw, 2 pulse | 2 | no | |
| `note1`…`note3` | Pitch | 0–127 | 48, 60, 55 | no | |
| `detune1`…`detune3` | Detune | −10 to 10 | 0 | no | % |
| `pw1`…`pw3` | Pulse width | 1–99 | 52, 50, 50 | no | % |
| `oscVol` | Osc volume | 0–1 | 0.5 | no | |
| `noiseVol` | Noise volume | 0–1 | 0 | no | |
| `monitor` | Monitor carrier | 0–1 | 0 | no | |

**Shared panel.** *Levels* (Modulator, Carrier, Output), *Bank* (Bands, Base —
primary — Spread, Q, Tracking, Alternate), *Carrier* (source menu, then the synthesizer
as three rows of wave / pitch / detune / width, as in the original, and Osc, Noise,
Monitor). Display: band levels as bars. Pad: X `baseHz` 50–500 Hz, Y `spread` 1.1–2 —
the manual's own sweeping suggestion.

**Tests.**
- Silent modulator: output falls below −80 dB within 5 × the tracking time.
- With 10 bands, base 130, spread 1.5, a noise carrier and a noise modulator, the output
  spectrum has peaks at 130 × 1.5^k.
- `stereoAlt` 1: band 2 (k = 1) appears only in the right channel.

---

### Vocoder 16-band
*Pluggo 3.6.1, Cycling '74 (Adam Schabtach), 2006 · VST (Max patch, encrypted) ·
params.tsv, presets (23 values), choices.txt, manual p. 234–237, screenshot p234-0
(shared)*

The same vocoder with sixteen bands: finer spectral resolution and a more intelligible
result, at more CPU. The manual's defaults (130 Hz, spread 1.292) tune the bands to
roughly those of a well-known European hardware vocoder.

**Original interface.** Identical to Vocoder 10-band in both views and every control.
The only differences are in the defaults and the band count:

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Frequency Spread | slider | 1–2 | 1.292 (10-band: 1.5) | Parameters row 6 |
| (all others) | as Vocoder 10-band | as 10-band | as 10-band | as 10-band |
| Presets | menu | 8, same names as the 10-band | Default Values | host menu |

**Signal flow.** As Vocoder 10-band with k = 0…15: 130 Hz to about 6.2 kHz at the
default spread.

**Here.** New, but the same `ChannelVocoder` ShapeKind as the 10-band: `bands` 16,
`spread` 1.292. Its presets are the 10-band presets with those two values changed. No
ParamSpec beyond the 10-band table.

**Shared panel.** As Vocoder 10-band. Pad: X `baseHz`, Y `spread`.

**Tests.**
- `bands` 16 with the 16-band defaults puts the top band at 130 × 1.292^15 ≈ 6.2 kHz
  (peak within one bin).
- Switching `bands` from 10 to 16 while playing does not click (bands fade in).

---

### Xformer
*Pluggo 3.6.1, Cycling '74, 2006 · VST (Max patch, encrypted; embedded LED, 7-segment,
button and `ratesync~` abstractions) · params.tsv (7), presets (76 values: 64 step
switches, tempo and sync, 7 published), choices.txt, manual p. 256–258, screenshot
p256-0*

A tempo-synced 16-step gate: per step and per channel, the signal passes or is muted,
and passed steps can be accented. Attack and decay round the gate's edges; a delay
slides the pattern against the beat. Different left and right patterns turn it into a
rhythmic auto-panner.

**Original interface.** Custom view, 414×231, styled as hardware: light-grey panel,
square LED buttons, red 7-segment readouts. Rows of sixteen buttons: "Gate left"
(≈x45–405,y10), "Gate right" (y40), a row of step-position lights (y70), "Accent left"
(y90), "Accent right" (y120); lit buttons are green or pink (inferred: pink = gate with
accent). Bottom: "Input Mix" and "Button Link" buttons (≈x50,y145 and y175); "Sync
Source" buttons host / Pluggo / UDT (≈x108,y142–178); 7-segment readouts with +/−
steppers: "Tempo" (120, ≈x188,y145), "Delay" (000, ≈x188,y175), "Cycles per Bar" (2,
≈x283,y145), "Attack" (06, ≈x283,y175), "Accent Level" (74, ≈x352,y145), "Decay" (04,
≈x352,y175); "XFORMER" logo bottom left, Cycling '74 logo bottom right. Mono or stereo
in, stereo out.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Gate left / right | 2 × 16 LED buttons | Off, On | all on | rows 1–2 |
| Step lights | display | current step | — | row 3 |
| Accent left / right | 2 × 16 LED buttons | Off, On | all off | rows 4–5 |
| Input Mix | button | Off, On (sum L+R to both) | Off | bottom left |
| Button Link | button | Off, On (edit both sides at once) | Off | bottom left |
| Sync Source | 3 buttons | Host, Pluggo, UDT | Host | bottom |
| Tempo | 7-segment + steppers | 10–240 BPM | 120 | bottom |
| Delay | 7-segment + steppers | 0–222 (manual 0–220; unit not stated) | 0 | bottom |
| Cycles per Bar | 7-segment + steppers | 1–9 | 1 | bottom |
| Attack | 7-segment + steppers | 0–99 | 0 | bottom |
| Accent Level | 7-segment + steppers | 0–99 | 0 | bottom |
| Decay | 7-segment + steppers | 0–99 | 0 | bottom |
| Presets | menu | 12: Xformer, Simple On/Off, Left & Right, Strum, dah dit dit, dit dit dah, Accent Pulse, Tremolo, Subtle Panning, Unsubtle Panning, Jingle Bells, No Effect | No Effect (see below) | host menu |

Default is the "No Effect" preset rather than preset 1, so a new slot is transparent;
the "Xformer" preset (cycles 2, accent 74, a syncopated pattern) is one click away.

**Signal flow.** A step clock divides one 4/4 bar at the tempo into 16 × Cycles per Bar
steps, shifted later by Delay. On each step and channel: gate off mutes, gate on passes,
gate + accent passes boosted by Accent Level. Attack and Decay shape each gate opening
and closing (0 = instant; the manual suggests 1–2 to remove clicks). Input Mix sums the
inputs first. The units of Attack, Decay, Delay and the accent boost are not stated
(inferred: milliseconds for the first three).

**Granular relation.** None. The planned Tremolo is the smooth relative; Xformer is its
stepped, patterned cousin.

**Here.** New `StepGate` ShapeKind.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `bpm` | Tempo | 10–240 | 120 | no | BPM |
| `cycles` | Cycles per bar | 1–9 | 1 | no | |
| `delay` | Delay | 0–222 | 0 | no | ms (inferred) |
| `attack` | Attack | 0–99 | 0 | no | ms (inferred) |
| `decay` | Decay | 0–99 | 0 | no | ms (inferred) |
| `accent` | Accent level | 0–99 | 0 | no | |
| `mixInputs` | Input mix | 0–1 | 0 | no | |
| `link` | Button link | 0–1 | 0 | no | |
| `gL01`…`gL16`, `gR01`…`gR16` | Gate | 0–1 | 1 | no | |
| `aL01`…`aL16`, `aR01`…`aR16` | Accent | 0–1 | 0 | no | |

`link` only changes how the panel edits; it is kept as a control because the original
published it and presets set it.

**Shared panel.** *Pattern* (the four switch rows with the step lights between gates and
accents, as in the original — primary), *Clock* (Tempo, Cycles per bar, Delay),
*Shape* (Attack, Decay, Accent level), *Routing* (Input mix, Link). Pad: X `decay` 0–99,
Y `accent` 0–99.

**Tests.**
- All gates on, no accents, attack and decay 0: output equals input.
- Alternate gates on and off at 120 BPM, one cycle: the output is muted for 125 ms of
  every 250 ms.
- Left gates all on, right all off: right output silent, left unchanged.
- `mixInputs` 1: left and right outputs are equal when the patterns are equal.

**Open questions.** The accent boost's unit (dB or a gain factor) and the time unit of
Delay, Attack and Decay.

---

## Batch-wide open questions

- **Tempo.** Five effects keep a `bpm` of their own. If documents get a tempo (the
  sequencer may already have one), each needs a `sync` switch to follow it; that is one
  shared decision, not five.
- **The encrypted patches.** Most of the "inferred" labels above would disappear with
  the patches in readable form. The cipher is a hex armour (two 16-letter alphabets,
  high and low nibble) over a position-keyed byte transform with no short period;
  identical plaintext headers give identical cipher prefixes across plug-ins, so it is
  deterministic from position 0 and a known-plaintext attack on the shared header is
  the way in, if it is worth the time.
- **The `table` field.** Waveshaper and Dynamical need it; the step tables could move to
  it later, at the cost of their automation. Decide before either is built.
