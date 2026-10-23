# Pluggo: filters, ring modulation and pitch

*22 October 2026. Spec — not built. Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md).*

*Pluggo 3.6.1, Cycling '74 (manual © 2006) · Max/MSP patches inside VST plug-ins · 17 effects*

Seventeen Pluggo effects: eleven filters, three ring/shift effects, a Shepard-tone
generator and a two-loop varispeed delay. One is an adjustment to the existing
**Ring** (Ring Modulator); the other sixteen are new `ShapeKind`s, though several
share a core: HF Ring Mod is Ring's DSP with a wider table, Multi-Filter[S] is
Multi-Filter, Resonation and Resosweep share a resonator-plus-delay voice, and
Comber reuses the moving-delay core behind Flanger. The sources are uneven. Only five
patches decode to readable Max text (FilterTaps, HF Ring Mod, Resonation,
Resosweep, Spectral Filter). The other twelve are stored in an encoded form the
pack tool does not read, so their DSP comes from the manual, the parameter
tables, the presets and the screenshots, and is marked *inferred* where it goes
further than those.

| Effect | Here | Shared-panel pad pair (X / Y) |
| --- | --- | --- |
| Comber | New | `offsetMs` / `feedback` |
| FilterTaps | New | `pitchOffset` / `q` |
| Harmonic Filter | New | `freqMult` / `resonance` |
| Mangle Filter | New | `avgMs` / `factor` |
| Moving Filters | New | `f1Hz` / `f2Hz` |
| Multi-Filter | New | `cutoff1Hz` / `res1` |
| Multi-Filter[S] | New (same ShapeKind as Multi-Filter) | `cutoff1Hz` / `res1` |
| Phone Filter | New | `hiss` / `dropouts` |
| Resonation | New | `baseHz` / `ratio` |
| Resosweep | New | `rateScale` / `centreShift` |
| Spectral Filter | New | `shift` / `depth` |
| WasteBand | New | `splitHighL` / `midDriveL` |
| Frequency Shift | New | `shiftHz` / `flutterDepth` |
| HF Ring Mod | New (`RingHf`, Ring's DSP) | `hz` / `mix` |
| Ring Modulator | Adjust (Ring) | `hz` / `mix` |
| ShepardTones | New | `rate` / `pitch` |
| Speed Shifter | New | `speedL` / `speedR` |

### Notes that apply to the whole batch

- **Defaults** in the "Original interface" tables are the values of preset 1,
  the program each plug-in loads first (`initialpgm 1`), converted from the stored
  0–1 values linearly over the parameter's range. Every conversion checked against
  a screenshot matched.
- **Presets.** `presets.tsv` is wrong for any plug-in whose stored preset holds
  more values than it publishes as parameters. The rows were cut at the published
  count instead of the true stride. This affects Ring Modulator and HF Ring Mod
  (stride 7: two source menus come first), Harmonic Filter (stride 75), Moving
  Filters (36), Resonation (30), Resosweep (44, see that section) and Spectral
  Filter (254). The values here were re-read from the `Mpst` resource at the true
  stride (script in a re-read of the stored presets at their true stride). The preset names are right
  either way.
- **The generic view.** Eight of these effects have no custom interface. Pluggo then
  shows its standard window. A header holds a **View** menu (Parameters / Interface)
  and a **Meter** menu (In / Out) with a small LED level meter. Below it is one row
  per parameter, about 23 px tall: the name on the left, a horizontal slider from
  Min to Max in the middle, and the value with its unit on the right. A strip at the
  bottom shows the credit or the hovered parameter's hint. The window is about
  355 px wide, and its height depends on the number of rows. In the tables below,
  "Position" for these effects is the row number.
- **Custom-view positions** are given as `x,y (w×h)` from the decoded top-level
  patcher. Each window's view origin and size come from its `plugconfig`
  (`defaultview`, `setsize`). Subtracting the origin from a patcher coordinate gives
  the window coordinate.
- **Menus.** `ParamSpec` has no labelled-choice field. Menus here are integer
  ranges, and the label lists are given for the panel to draw. Adding a `choices`
  field to `ParamSpec` would serve every menu in this batch.

---

### Comber
*Pluggo 3.6.1, Cycling '74 (by jhno) · VST, stereo in/out · params.tsv, presets (Mpst), manual pp. 38–39, screenshot p038-0; patch encoded, not read*

Two comb filters, one per channel, whose delay times are each swept by their own
sine LFO. It is distinctive in three ways: feedforward and feedback are separate
bipolar controls; the two channels sweep at independent rates; and the sweep can
run from slow LFO speeds up into the audio range, where it stops sounding like a
sweep and starts sounding like FM.

**Original interface.** Generic view, nine rows, no custom panel (the screenshot shows the
standard slider window titled "Comber (by jhno)").

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–100 (manual: 0–1) | 50 | row 1 |
| Dry Level | slider | 0–100 | 0 | row 2 |
| Left Speed | slider | 0–1 | 0.03 | row 3 |
| Right Speed | slider | 0–1 | 0.04 | row 4 |
| Speed Range | slider | 0–1 (sets the top of both speed scales) | 0 | row 5 |
| Mod Amount | slider | 0–1 | 1 | row 6 |
| Mod Offset | slider | 0–1 (centre delay) | 0 | row 7 |
| Comb Feedforward | slider | −100 to 100 | 77 | row 8 |
| Comb Feedback | slider | −100 to 100 | 74 | row 9 |
| Presets | menu | 8: Big Comb, Space Delay, Fast Twitch, Subtle Combs, Vibrato, Whirlibirds, Lazy Combs, Set On Stun | Big Comb | host menu |

**Signal flow.** Each channel feeds its own comb. The comb adds its input
delayed by D, scaled by feedforward, and its own output delayed by D, scaled by
feedback. D is the Mod Offset plus Mod Amount times a sine LFO. The left LFO runs
at Left Speed and the right at Right Speed. Both speeds are fractions of a maximum
that Speed Range raises from sub-audio to audio rate. The output is wet × comb +
dry × input. The time ranges behind Mod Offset and Mod Amount are not in any
readable source. The *Space Delay* preset (offset 0.74) is described as an echo, so
the offset must reach at least tens of milliseconds (*inferred*).

**Here.** New `ShapeKind::Comber`, built on the moving-delay core that
`Flanger` uses (dattorro.rs), with a second LFO and a feedforward tap. Speed
Range is folded into a log sweep on each rate. The log sweep gives the same fine
control at LFO speeds that Speed Range was there to provide.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 0.5 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `rateLHz` | Left speed | 0.01–1000 | 0.3 | yes | Hz |
| `rateRHz` | Right speed | 0.01–1000 | 0.4 | yes | Hz |
| `depthMs` | Mod amount | 0–50 | 10 | no | ms |
| `offsetMs` | Mod offset | 0.05–500 | 0.05 | yes | ms |
| `feedforward` | Feedforward | −1 to 1 | 0.77 | no | |
| `feedback` | Feedback | −0.98 to 0.98 | 0.74 | no | |

**Shared panel.** *Mix*: Wet, Dry. *Modulation*: Left speed, Right speed (side
by side, as the original pairs them), Mod amount, Mod offset. *Comb*:
Feedforward, Feedback. Feedback is the primary control. Display: none needed. Pad: X `offsetMs`
(limits 0.5–200 ms), Y `feedback` (−0.95 to 0.95).

**Tests.** With depth 0, feedforward 1, feedback 0, wet 1, dry 0 and offset 1 ms, an
impulse returns as two impulses 1 ms apart. With feedback 0.9 and the rest unchanged,
the impulse response decays by 0.9 per 1 ms period. With depth > 0 and rates 1 Hz and
3 Hz, left and right differ, and a mono input gives a non-zero side signal.

**Open questions.** The real millisecond ranges of Mod Offset and Mod Amount, and
the Hz span of Speed Range, are needed to convert the eight presets.

---

### FilterTaps
*Pluggo 3.6.1, Cycling '74 · VST, mono in, stereo out · params.tsv, presets, patch.txt (decoded), ui.txt, manual pp. 66–67, screenshot p066-0*

A six-tap delay line where every tap has its own band-pass filter, gain and pan,
plus a seventh tap that feeds back into the line. Global controls scale all the
taps at once. Global Frequency transposes every filter together in semitones, so
the taps keep their tuning relative to each other. Negative pan values invert the
tap's polarity, which on short, close taps gives wide phasey stereo.

**Original interface.** Window 471×201, view origin (21,237). The window has three
coloured columns, each headed by part of a background picture. On the left are six
band rows (each an embedded `bdband2` strip of number boxes). On the right are a
Wet/Dry pair of vertical sliders and a swirl logo. Across the bottom is a row of
global number boxes. Reading order: band rows top to bottom, then globals left to right.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Band 1–6 Delay, relative | number | 1–5000 ms | 19, 106, 288, 34, 1, 7 | rows at 41,295 / 309 / 323 / 337 / 351 / 365 (325×16); x+0 in row |
| Band delay, absolute | display | relative × Global Delay, ms | — | x+59 in row |
| Band 1–6 Pitch | number | 0–127 MIDI note | 0, 8, 10, 15, 3, 0 | x+115 |
| Band frequency | display | Hz | — | x+174 |
| Band 1–6 Gain | number | 1–300 (manual 0–127) | 127 each | x+231 |
| Band 1–6 Pan/Phase | number | −127 to 127 (0 L, 64 C, 127 R; negative = inverted) | 0, 38, 47, 81, −74, −39 | x+276 |
| Wet Mix | vertical slider | 0–1 | 0.65 | 371,296 (23×69) |
| Dry Mix | vertical slider | 0–1 | 0 | 393,296 (24×69) |
| Global Delay Scale | number | 0–10 × | 10 | 42,415 (52) |
| Global Freq Scale | number | 0–100 (semitones added; see flow) | 80 | 157,415 (50) |
| Global Q | number | 0–1 | 0.39 | 220,415 (41) |
| Global Gain | number | −300 to 300 | 52 | 273,415 (40) |
| Feedback Time, relative | number | 1–5000 ms | 153 | 339,415 (51) |
| Feedback Time, absolute | display | ms | — | 389,415 (47) |
| Feedback Gain | number | 0–1 | 0 | 450,415 (33) |
| Logo | picture | — | — | 426,309 (53×54) |
| Presets | menu | 8: Silver Slime, Digestion Process, Fountain Plaza, Ancient Bowls, Treble Kiss, Mysterious Unraveller, Surfing Indonesia, The Three Bears | Silver Slime | host menu |

**Signal flow.** The input is written into a 5 s delay line. Each of six voices
reads one tap at band delay × Global Delay, clipped to 5 s, and smooths delay
changes. The tap goes through a resonant band-pass. Its centre is the MIDI-to-Hz
value of band pitch + Global Frequency. The patch adds the two, so Global Frequency
is a transposition in semitones, not a multiplier; the screenshot confirms this,
since note 0 with global 80 shows 830.6 Hz, which is note 80. The filter's
resonance comes from Global Q. The tap is scaled by (band gain + Global Gain) / 127
and placed with an equal-power pan from |Pan|. A negative Pan flips its polarity. A
seventh tap at Feedback Time × Global Delay, scaled by Feedback Gain, is written
back into the line. The output is wet × (sum of taps) + dry × input, in stereo.

**Here.** New `ShapeKind::FilterTaps`. The band keys repeat for n = 1…6.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 0.65 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `delayScale` | Delay scale | 0–10 | 1 | no | x |
| `pitchOffset` | Global pitch | 0–100 | 60 | no | st |
| `q` | Q | 0–1 | 0.39 | no | |
| `gainOffset` | Global gain | −300 to 300 | 0 | no | |
| `fbMs` | Feedback time | 1–5000 | 153 | yes | ms |
| `fbGain` | Feedback | 0–0.95 | 0 | no | |
| `band{n}DelayMs` | Band n delay | 1–5000 | 19, 106, 288, 34, 1, 7 | yes | ms |
| `band{n}Note` | Band n pitch | 0–127 | 0, 8, 10, 15, 3, 0 | no | note |
| `band{n}Gain` | Band n gain | 1–300 | 127 | no | |
| `band{n}Pan` | Band n pan/phase | −127 to 127 | 0, 38, 47, 81, −74, −39 | no | |

**Shared panel.** *Bands* first: a six-row grid laid out like the original. Each row
has delay (number), absolute delay (display), pitch (number), Hz (display), gain and
pan/phase. *Globals*: Delay scale, Global pitch (primary), Q, Global gain. *Feedback*:
time, gain. *Mix*: Wet, Dry, as two vertical sliders on the right. Pad: X `pitchOffset`
(40–90 st), Y `q` (0.05–1).

**Tests.** With one band at gain 127, the others at 1, delayScale 1 and band delay 100 ms,
an impulse emerges 100 ms late. Raising `pitchOffset` by 12 moves that tap's filter peak
up an octave. Pan 127 puts the tap only in the right channel, and pan −127 puts it there
inverted. With feedback 0.5 at 200 ms there is a second arrival at 300 ms (tap) + 200 ms
(feedback) about 6 dB down.

**Open questions.** How Global Q 0–1 maps onto the band-pass Q was not traced. A
proposal is 0.5–50, log. The 3.6.1 defaults differ from the manual: gain is 1–300, not 0–127.

---

### Harmonic Filter
*Pluggo 3.6.1, Cycling '74 (after jhno's CellSound) · VST, mono in, stereo out · params.tsv, presets (Mpst, stride 75), manual pp. 86–88, screenshot p086-0; patch encoded*

Twenty-five band-pass filters whose frequencies are moved by a cellular
automaton. On each update a cell drifts toward a harmonic of its neighbour's frequency,
so the bank keeps falling into, and wandering out of, harmonic chords. Anchored cells
hold still and keep the system in key. Randomise timers stir it, and a frequency
adder makes the whole bank creep up or down.

**Original interface.** About 435×280, custom panel (positions from the screenshot,
approximate). Along the top are an input-gain slider, an arrow and an output-gain
slider, with five mute boxes at the right. The main area is a large pink 25-bar
multislider (about 322×200), with one horizontal mark per filter giving its frequency.
Below it is a row of 25 anchor checkboxes. A right-hand column holds the CA settings,
and a bottom row the global ones.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Input Gain | h-slider | 0–199 | 120 | top left (~5,5, 145 wide) |
| Output Gain | h-slider | 0–199 | 120 | top centre (~180,5) |
| Mutes | 5 checkboxes | filters in groups of five | all on | top right, labelled "mutes" |
| Filter frequencies | multislider | 25 bars | per preset | ~3,28 (322×200) |
| Anchors | 25 checkboxes | fix a cell | off | row under multislider |
| Harmonic Limit | number | 1–23 | 5 | right column, 1st |
| Change Rate | number | 1–74 | 2 | right, 2nd |
| Damp Rate | number | 0–5 | 0.24 | right, 3rd |
| Diffusion Rate | number | 0–5 | 1.34 | right, 4th |
| Slew Rate | number | 0–500 | 292 | right, 5th |
| Base Frequency ("random base") | number | 0–200 | 90 | right, 6th |
| Cell Update + period | toggle + number | on/off; 5–60 000 ms | on, 270 | right, 7th–8th |
| Randomize Cell + period | toggle + number | on/off; 5–60 000 ms | on, 181 | right, 9th–10th |
| Randomize All + period | toggle + number + slider | on/off; 5–60 000 ms | on, 10 000 | right, 11th–12th |
| Resonance | number | 0–200 | 46 | bottom left |
| Stereo Scatter | toggle | off/on | on | bottom left, under resonance |
| Freq Mult | number | 0–8 | 1 | bottom centre |
| Freq Add | number | −200 to 200 | −38 | bottom centre |
| Mult Bug | toggle | off/on | on | bottom right |
| Change Bug | toggle | off/on | off | bottom right |
| Presets | menu | 8: Jumping Beans, Shave and a Haircut, Popcorn, Pantonal, At the Ballpark, Elevator Up, The Swarm, Moving Walkway | Jumping Beans | host menu |

The published names of the timer pairs do not match their types. "Cell Update
Switch" is the 5–60 000 period and "Cell Update Period" is the 0/1 switch. The
"Randomize All Period" value (181) appears beside "randomize cell" in the screenshot.
The screenshot shows the semantics, so the table follows it.

**Signal flow.** The input passes through input gain into 25 parallel resonant
band-passes, all sharing the Resonance setting. Without Stereo Scatter, each
filter is panned by its position from left to right. With it, each gets a random
pan. Their sum goes through output gain to a stereo out. Mutes switch filters off in
fives. The control side runs on timers:
- Every update period, each un-anchored cell picks a target near the nearest of
  its neighbour's first *Harmonic Limit* multiples.
- It moves toward the target at Change Rate, and no faster than the Slew Rate.
- Frequency Mult scales every cell and Frequency Add offsets every cell each period.
- Randomize Cell re-rolls one cell; Randomize All re-rolls every cell around Base
  Frequency.
- Diffusion and Damp act on a per-cell level that spreads to neighbours and decays
  (*inferred*: the manual says only that they act on "output volumes in the cell
  network").

**Here.** New `ShapeKind::HarmonicFilter`. The 25 cell frequencies, 25 anchors and 5
mutes are saved in the slot as state, the way a drawn curve is, not as automation
keys. The two "bug" switches are left out (see open questions).

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `inGain` | Input gain | 0–199 | 120 | no | |
| `outGain` | Output gain | 0–199 | 120 | no | |
| `resonance` | Resonance | 0–200 | 46 | no | |
| `scatter` | Stereo scatter | 0–1 | 1 | no | |
| `freqMult` | Freq mult | 0–8 | 1 | no | x |
| `freqAdd` | Freq add | −200 to 200 | 0 | no | Hz |
| `updateOn` | Cell update | 0–1 | 1 | no | |
| `updateMs` | Update period | 5–60 000 | 270 | yes | ms |
| `randCellOn` | Randomise cell | 0–1 | 1 | no | |
| `randCellMs` | Cell period | 5–60 000 | 181 | yes | ms |
| `randAllOn` | Randomise all | 0–1 | 1 | no | |
| `randAllMs` | All period | 5–60 000 | 10 000 | yes | ms |
| `randomBase` | Random base | 0–200 | 90 | no | |
| `slew` | Slew rate | 0–500 | 292 | no | |
| `diffusion` | Diffusion | 0–5 | 1.34 | no | |
| `damp` | Damp | 0–5 | 0.24 | no | |
| `changeRate` | Change rate | 1–74 | 2 | no | |
| `harmonicLimit` | Harmonic limit | 1–23 | 5 | no | |

**Shared panel.** Display first: the 25-cell frequency view, drawn and edited like the
original. Each cell is a draggable mark, and an anchor box sits under each column. *Gain*:
Input, Output, Resonance (primary), Scatter. *Automaton*: Harmonic limit, Change rate,
Slew, Diffusion, Damp. *Timers*: the three switch-and-period pairs, then Random base.
*Global*: Freq mult, Freq add. Mutes sit as five boxes above the display. Pad: X
`freqMult` (0.5–2), Y `resonance` (10–200).

**Tests.** With all timers off and freqMult 1, the cell frequencies do not change over 10 s.
With harmonic limit 1, update on, and one anchored cell at 440 Hz, its neighbour converges
to within 1 % of 440 Hz. An anchored cell never moves while randomise-all fires. With
scatter off, cell 1's output is louder in the left channel than in the right.

**Open questions.** What the two "bug" switches do: the manual itself does not say,
and the patch is encoded. Whether "harmonic" means integer multiples (×1, ×2, ×3…) or
octaves: the manual's own example lists 440, 880, 1760, 3520, 7040, which are octaves.
The units of Base Frequency (0–200) and of the gains (0–199). The exact CA update
rule.

---

### Mangle Filter
*Pluggo 3.6.1, Cycling '74 (by jhno) · VST, mono · params.tsv, presets, choices.txt, manual pp. 115–116, screenshot p115-0; patch encoded*

A delay whose time and gain follow the input's own running average level.
Louder input gives a longer delay, and the delay can change fast enough to tear the
sound. It is level-sensitive by design: well-tuned, it leaves quiet material alone
and mangles only the peaks.

**Original interface.** Generic view, nine rows; the screenshot is titled "Mangle Filter (by jhno)".

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–1 | 0.5 | row 1 |
| Dry Level | slider | 0–1 | 0 | row 2 |
| Averaging Delay | slider | 0–100 ms | 100 | row 3 |
| Delay Range | menu | x1, x10 | x10 | row 4 |
| Averaging Mode | menu | bipolar, absolute (*inferred* label), rms | rms | row 5 |
| Mult/Divide Factor | slider | 0–100 | 100 | row 6 |
| Scaling Mode | menu | multiply, divide | multiply | row 7 |
| Input Drive | slider | 0.1–42 | 4.32 | row 8 |
| Input Curve | slider | 2–8 | 2 | row 9 |
| Presets | menu | 8: Mangle, More Mangle, Hiss-N-Spit, Yet More Mangling, Retlif Elgnam, Mayday! Mayday!, Wash Behind Your Ears, Busted Speaker | Mangle | host menu |

The manual also lists a Filter Cutoff (20–20 000 Hz low-pass). The 3.6.1 build does
not publish it, and the screenshot does not show it.

**Signal flow** (*inferred* from the manual and parameter set). The input is
multiplied by Input Drive and bent by an exponential curve of steepness Input Curve.
Its running average over Averaging Delay × Range is then taken: signed (bipolar),
rectified (absolute) or RMS. The three modes match MSP's `average~`. That average is
multiplied or divided by Factor, and the result sets both the delay time and the gain
of a delay line carrying the driven input. Output = wet × delayed + dry × input. The
manual's own Wet/Dry descriptions are swapped relative to every preset, which use dry
0. This spec takes wet as the processed path.

**Here.** New `ShapeKind::Mangle`. The ×1/×10 range switch is folded into a log
sweep from 0.1 to 1000 ms.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 0.5 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `avgMs` | Averaging time | 0.1–1000 | 1000 | yes | ms |
| `mode` | Averaging | 0–2 (bipolar, absolute, rms) | 2 | no | |
| `factor` | Factor | 0–100 | 100 | no | |
| `divide` | Scaling | 0–1 (multiply, divide) | 0 | no | |
| `drive` | Input drive | 0.1–42 | 4.32 | yes | x |
| `curve` | Input curve | 2–8 | 2 | no | |

**Shared panel.** *Detector*: Averaging time (primary), Averaging mode menu, Factor,
Scaling switch. *Input*: Drive, Curve. *Mix*: Wet, Dry. Display: a small meter of the
running average, which shows why a setting does or does not bite. Pad: X `avgMs`
(1–1000), Y `factor` (0–100).

**Tests.** Silence in gives silence out. With factor 0 the delay is zero, and
wet 1, dry 0 returns the driven input sample-aligned. A −40 dBFS sine and a −6 dBFS
sine at the same settings give different output delays: the louder one is later.
Mode 0 on a symmetric sine averages near zero, so its delay stays near zero.

**Open questions.** The mapping from scaled average to milliseconds. Whether the
missing Filter Cutoff should be restored.

---

### Moving Filters
*Pluggo 3.6.1, Cycling '74 · VST, mono/stereo in, stereo out · params.tsv, presets (Mpst, stride 36), choices.txt, manual pp. 121–124, screenshot p121-0; patch encoded*

Two band-pass filters in parallel, each with its own centre, Q, gain and pan, and
four LFOs that can sweep either filter's frequency or pan. Every LFO offers sine,
square and ramp at once, so one LFO can drive two destinations with different
shapes. Negative modulation amounts invert the wave.

**Original interface.** Generic view, 20 rows (screenshot shows rows 1–16; LFO rows
below). Rows 1–8 are filter 1, rows 9–16 filter 2, rows 17–20 the LFOs.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| F1 Frequency | slider | 10–10 000 Hz | 2000 | row 1 |
| F1 Freq. Mod. Source | menu | LFO A Sine/Square/Ramp … LFO D Sine/Square/Ramp (12) | LFO A Sine | row 2 |
| F1 Freq. Mod. Amount | slider | −10 000 to 10 000 Hz | 1000 | row 3 |
| F1 Q | slider | 1–400 | 200 | row 4 |
| F1 Pan | menu | Far Left, Left, Middle, Right, Far Right (2nd and 4th labels *inferred*) | Middle | row 5 |
| F1 Pan Mod. Source | menu | as row 2 | LFO A Ramp | row 6 |
| F1 Pan Mod. Amount | slider | −100 to 100 % | 80 | row 7 |
| F1 Gain | slider | 0–5 | 2 | row 8 |
| F2 (same eight) | — | same | 200 Hz; LFO B Sine; 50 Hz; Q 100; Middle; LFO C Sine; 100 %; 2 | rows 9–16 |
| LFO A–D Freq. | slider | 0–50 Hz | 0.2, 1, 0.21, 0.8 | rows 17–20 |
| LFO tempo sync (×4) | — | Free/Host/Plug/UDT, multiplier, note value, tempo | not published | stored in presets only |
| Presets | menu | 9: Moving Filters, Fake Stereoizer, Insects, Bubbles, Murky, Pan Wah, Chasers, Pan via Filtering, Flatulent Destruction | Moving Filters | host menu |

**Signal flow.** The input (mono-summed, *inferred*) feeds two band-pass filters.
Each filter's centre is its base frequency plus the chosen LFO output times the
amount in Hz, clamped to the audible range (*inferred*). Each filter output is
scaled by its gain and panned to one of five positions plus the chosen LFO output
times the pan amount. The two are summed into stereo. The four LFOs run free. Their
tempo-sync settings, which the manual describes, are kept in presets but are not
published in 3.6.1.

**Here.** New `ShapeKind::MovingFilters`. The filter keys repeat for n = 1, 2.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `f{n}Hz` | Fn frequency | 10–10 000 | 2000 / 200 | yes | Hz |
| `f{n}FreqSrc` | Fn freq source | 0–11 (A sine … D ramp) | 0 / 3 | no | |
| `f{n}FreqAmt` | Fn freq amount | −10 000 to 10 000 | 1000 / 50 | no | Hz |
| `f{n}Q` | Fn Q | 1–400 | 200 / 100 | yes | |
| `f{n}Pan` | Fn pan | 0–4 (far L … far R) | 2 | no | |
| `f{n}PanSrc` | Fn pan source | 0–11 | 2 / 6 | no | |
| `f{n}PanAmt` | Fn pan amount | −100 to 100 | 80 / 100 | no | % |
| `f{n}Gain` | Fn gain | 0–5 | 2 | no | x |
| `lfoAHz`…`lfoDHz` | LFO A–D rate | 0.01–50 | 0.2, 1, 0.21, 0.8 | yes | Hz |

**Shared panel.** Two filter columns side by side, F1 left and F2 right, each in the
original's order: Frequency (primary), source menu, amount, Q, Pan, pan source,
pan amount, Gain. Below them is an *LFOs* row of four rate dials with a mini scope of
each LFO's three shapes. Display: a two-peak response curve that moves with the LFOs.
Pad: X `f1Hz` (100–8000), Y `f2Hz` (100–8000).

**Tests.** With both amounts 0, a white-noise input gives spectral peaks within ±5 % of
`f1Hz` and `f2Hz`. With F1 pan 0, F2 off (gain 0) and pan amount 0, the right channel is
silent. An LFO A sine at 1 Hz on F1 frequency with amount 500 Hz moves the peak by ±500 Hz
over a 1 s cycle. Amount −500 moves it in the opposite direction at the same moment.

**Open questions.** Whether to bring back tempo sync for the LFOs (the app has a
transport). The pan law for the five fixed positions.

---

### Multi-Filter
*Pluggo 3.6.1, Cycling '74 · VST, mono · params.tsv, presets, choices.txt, manual pp. 129–130, screenshot p129-0; patch encoded*

Two identical 12 dB/octave multimode filters in series, sharing one mode. Linked,
filter 2 follows filter 1 at a fixed distance in Hz. With zero separation this gives
one steep 24 dB/octave filter. With a separation it gives two peaks or two notches
that move together. Its panel is mostly a drawn response you drag.

**Original interface.** About 323×166, custom panel (encoded; positions from the
screenshot, approximate). In the top-left are six filter-type icons in a 2×3 grid,
showing low-pass, high-pass, two shelves, band-pass and notch shapes. Under them are
two vertical sliders. A large blue response display has two panes: filter 1 above,
filter 2 in a short strip below. Each pane draws its curve and has a red handle. Along
the bottom are a horizontal slider and an X checkbox.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Filter Type | icon buttons | Low Pass, High Pass, Low Shelf, High Shelf, Band Pass, Notch | Low Pass | ~3,3 (37×55) |
| Wet Level | vertical slider (*inferred* which is which) | 0–1 | 1 | ~5,62 (15×88) |
| Dry Level | vertical slider | 0–1 | 0 | ~23,62 (15×88) |
| Filter 1 Cutoff / Resonance | display handle | 20–20 000 Hz / 0–15 Q | 991 Hz / 1.72 | upper pane ~42,3 (278×115) |
| Filter 1 Gain | (no visible control; *inferred* drag or parameter only) | 0–2 | 1 | — |
| Filter 2 Cutoff / Resonance | display handle | 20–20 000 Hz / 0–15 | 4711 Hz / 1.72 | lower pane ~42,120 (278×28) |
| Filter 2 Gain | — | 0–2 | 1 | — |
| Separation | h-slider (*inferred*) | 0–10 000 Hz | 3720 | ~3,152 (292×10) |
| Link Filters | checkbox (*inferred*) | off/on | on | ~298,152 |
| Mute Filter 2 | (not visible) | off/on | off | — |
| Presets | menu | 8: Linked Low-Pass, Indie LPFs, Single Band-Pass, Double Band-Pass, Hi-Pass w/Separation, Double Notch, Single High Shelf, Single Low Shelf | Linked Low-Pass | host menu |

**Signal flow.** Input → filter 1 → filter 2 → wet. The output is wet × filtered + dry
× input. Both are 2-pole sections of the chosen type, with cutoff, Q (0–15) and a gain
of 0–2. For the shelves the gain sets the shelf level (*inferred* from the presets,
where a shelf gain of 0.07 is a deep cut). With Link on, filter 2 uses filter 1's Q and
gain, and its cutoff is filter 1's plus Separation, in Hz. Mute Filter 2 bypasses
filter 2, leaving the 12 dB slope.

**Here.** New `ShapeKind::MultiFilter`, built on `biquad.rs`, which already designs
the peaking and shelf sections. Low-pass, high-pass, band-pass and notch sections are
needed. Q is clamped to ≥ 0.1 inside the DSP so that 0 stays defined.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 1 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `type` | Type | 0–5 (LP, HP, low shelf, high shelf, BP, notch) | 0 | no | |
| `cutoff1Hz` | Cutoff 1 | 20–20 000 | 991 | yes | Hz |
| `res1` | Resonance 1 | 0–15 | 1.72 | no | Q |
| `gain1` | Gain 1 | 0–2 | 1 | no | x |
| `sepHz` | Separation | 0–10 000 | 3720 | no | Hz |
| `cutoff2Hz` | Cutoff 2 | 20–20 000 | 4711 | yes | Hz |
| `res2` | Resonance 2 | 0–15 | 1.72 | no | Q |
| `gain2` | Gain 2 | 0–2 | 1 | no | x |
| `link` | Link | 0–1 | 1 | no | |
| `mute2` | Mute filter 2 | 0–1 | 0 | no | |

**Shared panel.** The display is primary: the combined response with one handle per
filter. Dragging a handle sets cutoff (x) and resonance (y), as the original does. The
type icons sit left of it as a menu, and Wet/Dry as two vertical sliders. Below the
display: Separation, Link, Mute 2, and the two gains. When Link is on, filter 2's own
controls are greyed out. Pad: X `cutoff1Hz` (80–12 000), Y `res1` (0.5–12).

**Tests.** Low-pass at 1 kHz with link on and separation 0 attenuates 4 kHz by about
48 dB relative to 100 Hz. With mute2 on it is about 24 dB. With link on and separation
1000 Hz, changing `cutoff2Hz` has no effect. Band-pass at 2 kHz with res 10 passes 2 kHz
at least 20 dB above 500 Hz. Wet 0, dry 1 returns the input bit-exactly.

**Open questions.** Which of the two vertical sliders is wet. Whether the gain
controls appear anywhere on the original panel.

---

### Multi-Filter[S]
*Pluggo 3.6.1, Cycling '74 · VST · params.tsv, presets; patch encoded; not in the manual*

A second build of Multi-Filter. It has the same twelve parameters with the same ranges,
the same six type names and the same eight presets with identical values. Its encoded
patch is about a third the size of Multi-Filter's (113 KB against 345 KB of resource).
That fits a version without the drawn response panel, but this is *inferred*, and so
is any reading of "[S]".

**Original interface.** Not documented and not shown. *Inferred*: the generic view,
with twelve rows in the order of the Multi-Filter table above.

**Signal flow.** As Multi-Filter. No source shows a difference.

**Here.** The same `ShapeKind::MultiFilter`, with no new keys. If "[S]" turns out to mean
stereo, the shape already runs per channel.

**Shared panel.** As Multi-Filter. Pad: X `cutoff1Hz`, Y `res1`.

**Tests.** Loading any [S] preset produces the same key values as the same-named
Multi-Filter preset.

**Open questions.** What "[S]" stands for: stereo, sliders, or something else.

---

### Phone Filter
*Pluggo 3.6.1, Cycling '74 (by Adam Schabtach) · VST, mono · params.tsv, presets, manual p. 147, screenshot p147-0; patch encoded*

A telephone-line simulator: the bandwidth is narrowed, the sound slightly distorted
and its dynamics squashed, with optional line hiss and random cell-phone dropouts.

**Original interface.** Generic view, five rows; the strip reads "Telephone simulation filter by Adam Schabtach".

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Hiss | slider | 0–1 | 0.1 | row 1 |
| Dropouts | slider | 0–50 % (manual 0–100) | 0 | row 2 |
| Avg. Dropout Duration | slider | 1–1000 ms | 21 | row 3 |
| Direct Level | slider | −70 to 12 dB | −70 | row 4 |
| FX Level | slider | −70 to 12 dB | −0.3 | row 5 |
| Presets | menu | 5: Local Call, Long Distance, Overseas, Okay Cellular, Free with subscription | Local Call | host menu |

**Signal flow** (*inferred*: the manual says only "distorting slightly",
"limiting its bandwidth and dynamic range"). Input → band-pass at the classic
telephone band, about 300–3400 Hz → soft saturation → fast compressor → hiss added
at the Hiss level → a dropout gate → FX Level. The gate goes silent for a random
share of the time equal to Dropouts, with mean off-time Avg. Dropout Duration. The
output is that plus Direct Level × input.

**Here.** New `ShapeKind::Phone`. It reuses `biquad.rs` for the band, and the
PN-noise generator for the hiss.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `hiss` | Hiss | 0–1 | 0.1 | no | |
| `dropouts` | Dropouts | 0–50 | 0 | no | % |
| `dropMs` | Dropout length | 1–1000 | 21 | yes | ms |
| `directDb` | Direct | −70 to 12 | −70 | no | dB |
| `fxDb` | Phone level | −70 to 12 | −0.3 | no | dB |
| `seed` | Seed | 1–16 777 215 | 1 | no | |

`seed` is added so that dropouts render the same way every time, as PN noise does.

**Shared panel.** *Line*: Hiss (primary), Dropouts, Dropout length. *Mix*: Phone
level, Direct. Pad: X `hiss` (0–1), Y `dropouts` (0–50).

**Tests.** With hiss 0 and dropouts 0, a 100 Hz sine is at least 20 dB quieter than a
1 kHz sine of equal level, and so is an 8 kHz sine. With dropouts 25 % over 60 s the
fraction of silent 10 ms blocks is 20–30 %. The same seed gives identical output on two
renders.

**Open questions.** The real band edges, distortion and compression settings. Whether
the hiss sits inside the band or outside it.

---

### Resonation
*Pluggo 3.6.1, Cycling '74 (by Adam Schabtach) · VST, mono in, stereo out · params.tsv, presets (stride 30), patch.txt (decoded), ui.txt, manual pp. 171–173, screenshots p171-0, p172-0*

Twelve resonators tuned in a geometric series from a base frequency, each followed by
its own delay of up to 2 s. Their outputs alternate between left and right. Staggering
the delays turns a single hit into a rising or falling arpeggio of ringing pitches
(the *Up* and *Down* presets).

**Original interface.** Window 365×310, origin (0,0). On the left are two large
12-bar multisliders, Delay Times above and Output Levels below. Each has thin
one-bar sliders to its right: Maximum Delay beside the delays, and Gain Scaling and
Dry Level beside the levels. On the right is a column of three number boxes.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Delay Times | 12-bar multislider | 0–1 of Maximum Delay | 1, 1, 1 … (Down: falling) | 41,44 (205×105), label "Delay Times:" 41,30 |
| Maximum Delay | 1-bar slider | 0–2000 ms ("2 sec." label) | 1534 | 248,44 (13×105) |
| Output Levels | 12-bar multislider | 0–1 | per preset | 41,176 (205×105), label 41,162 |
| Gain Scaling | 1-bar slider | 0–8 (manual 0–4) | 4.66 | 248,176 (13×105) |
| Dry Level | 1-bar slider | −70 to 12 dB (not in manual) | −70 | 263,176 (13×105) |
| Base Freq. | number | 10–10 000 Hz | 440 | 295,117 (53), label 295,101 |
| Ratio | number | 1–2 | 1.29 | 295,165 (53), label 295,149 |
| Q | number | 1–100 | 40 | 295,214 (35), label 295,198 |
| Presets | menu | 8: Down, Up, Bipolar, Panning, Watery, Octaves, Chromatic Resonators, Froggy | Down | host menu |

The five globals also appear in the generic view (p171-0) as "1. Base Frequency" …
"5. Maximum Delay".

**Signal flow.** The input feeds twelve `reson~` band-passes in parallel. Filter
*i* (0–11) is tuned to base × ratio^i, clipped to 1–20 000 Hz, and all share one Q.
So ratio 1.0595 gives semitones and ratio 2 gives octaves. Each filter's output is
delayed by its Delay Time × Maximum Delay, then scaled by its Output Level × Gain
Scaling. The patch runs six voices with two filters each, one filter to each output,
so the filters alternate between left and right. The dry signal is added at Dry Level.

**Here.** New `ShapeKind::Resonation`. Its voice (resonator → delay → gain) is
shared with Resosweep. The per-filter values are keys, because the original
published them for automation.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `baseHz` | Base frequency | 10–10 000 | 440 | yes | Hz |
| `ratio` | Ratio | 1–2 | 1.29 | no | x |
| `q` | Q | 1–100 | 40 | yes | |
| `gainScale` | Gain scaling | 0–8 | 4.66 | no | x |
| `maxDelayMs` | Maximum delay | 0–2000 | 1534 | no | ms |
| `dryDb` | Dry | −70 to 12 | −70 | no | dB |
| `delay{1–12}` | Delay n | 0–1 | 1 | no | |
| `level{1–12}` | Level n | 0–1 | 1 | no | |

**Shared panel.** It mirrors the original. Two 12-bar displays that you can edit by
drawing come first: Delays, with the Maximum delay slider beside it, and Levels, with
Gain scaling and Dry beside it. A right-hand column holds Base frequency (primary),
Ratio and Q. A ratio readout in semitones helps, since 1.0595 is not obvious. Pad: X
`baseHz` (60–2000), Y `ratio` (1–2).

**Tests.** With ratio 2, base 100 and Q 50, white noise in gives peaks at 100, 200, 400
… 204 800 Hz, clipped at Nyquist. Filter 1 (100 Hz) appears only on the left and filter
2 (200 Hz) only on the right. With all delays 0 except filter 1 at 1.0 and max delay
500 ms, the 100 Hz ring starts 500 ms after an impulse. Dry −70 dB with every level 0
is silent.

---

### Resosweep
*Pluggo 3.6.1, Cycling '74 (David Zicarelli and Les Stuck, 1999) · VST, mono/stereo in, stereo out · params.tsv, patch.txt (decoded), ui.txt, choices (umenu), manual pp. 174–175, screenshot p174-0*

Six resonant band-passes, three per channel, each with its own sine LFO sweeping
its centre in semitones, and its own short output delay for placement in the stereo
image. Setting the LFOs out of step makes slowly evolving, vowel-like textures.

**Original interface.** Window 496×400, view origin (180,176). At the top is an
input menu. Below it are two columns, "left channel filters" (filters 1–3) and "right
channel filters" (4–6, *inferred* assignment). Each has three blocks of seven rows.
In each row there is a coloured horizontal slider, 89×15, and a number box. The labels
sit outside each column, and the unit comments (Hertz, samples) sit between them.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Input | menu | Mono (left), Stereo, Mono (right) | Stereo | 383,206 (100); label "input" 351,208 |
| Gain (×6) | slider + number | −128 to 127 display = −2 to 2 | per preset | row 1 of each block |
| Mod Freq | slider + number | 0–10 Hz (256 steps) | | row 2 |
| Mod Phase | slider + number | 0–1 | | row 3 |
| Mod Depth | slider + number | 0–36 half-steps (manual says ms) | | row 4 |
| Mod Center Freq | slider + number | 100–15 000 Hz | | row 5 |
| Q | slider + number | 0–30 (manual 1–30) | | row 6 |
| Delay | slider + number | 0–1024 samples | | row 7 |
| Left column | sliders 248,(251…551); numbers 355,y | blocks at y 251, 359, 467; rows 14 px apart | | filters 1–3 |
| Right column | numbers 450,y; sliders 500,y; labels 608,y | same rows | | filters 4–6 |
| Presets | menu | 16: This Isn't Acid Jazz, Noisy Neighbors, Magic Flute, Overloaded Wah, Retrouvailles, Attack by Sharpie, AM on Datsun 510, Kneeling at the Wall, Finis le sommeil, Nervous Laughter, Groan to Smile, Leaning Left, Hi-Q!, TV on in the other room, Knives in Wall, Empty Fullness | This Isn't Acid Jazz | host menu |

**Signal flow.** The input menu picks the source. Mono (left) sends the left input to
all six filters. Stereo sends left to filters 1–3 and right to 4–6. Mono (right) sends
the right input to all six. In each voice the input is scaled by Gain (negative inverts)
and passed through a `reson~` band-pass. Its centre is the Center Freq × 2^(sine ×
depth / 24). The sine runs at Mod Freq, offset by Mod Phase, so the centre swings
±depth/2 semitones (depth semitones peak to peak). The filter's Q is the voice's Q. The
filter output is delayed by 0–1024 samples. Filters 1–3 sum to the left output and
4–6 to the right.

**Here.** New `ShapeKind::Resosweep`, sharing Resonation's resonator voice. The keys
repeat for n = 1…6. Two global macros are added here (not in the original), so the
pad has something that moves the whole texture.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `input` | Input | 0–2 (mono L, stereo, mono R) | 1 | no | |
| `f{n}Gain` | Gain n | −2 to 2 | 1 | no | x |
| `f{n}RateHz` | Mod rate n | 0–10 | 0.2 × n | no | Hz |
| `f{n}Phase` | Mod phase n | 0–1 | (n−1)/6 | no | |
| `f{n}Depth` | Mod depth n | 0–36 | 12 | no | st |
| `f{n}CentreHz` | Centre n | 100–15 000 | 300 × 2^(n−1) | yes | Hz |
| `f{n}Q` | Q n | 0.5–30 | 8 | no | |
| `f{n}Delay` | Delay n | 0–1024 | 0 | no | smp |
| `rateScale` | Rate scale (added) | 0.25–4 | 1 | yes | x |
| `centreShift` | Centre shift (added) | −24 to 24 | 0 | no | st |

The Q minimum is raised from 0 to 0.5 so the filter stays defined.

**Shared panel.** Input menu at the top. Two columns of three filter cards in the
original's left/right arrangement, each card with the seven rows in the original
order and its colour coding. A response display above the cards shows the six
moving peaks, left in one colour and right in another. The macros sit in a header
strip. Pad: X `rateScale` (0.25–4), Y `centreShift` (−24 to 24).

**Tests.** With all depths 0 and input Stereo, a left-only noise input produces output
only on the left. Filter 1 at 1 kHz, depth 12 and rate 1 Hz sweeps its peak between
about 707 Hz and 1414 Hz over one second. A delay of 441 samples at 44.1 kHz shifts that
filter's impulse response by 10 ms. `centreShift` +12 doubles every peak frequency.

**Open questions.** The stored presets have 44 values (43 published plus one unused slot), but the published list
skips parameter 24 (between Mod Freq 4 and Mod Phase 4). Presets for filters 4–6 need
reading with that gap, or they come out shifted by one. Which column filters 1–3
occupy is *inferred*.

---

### Spectral Filter
*Pluggo 3.6.1, Cycling '74 (technique by Zack Settel and Cort Lippe) · VST, mono · patch.txt (decoded), ui.txt, plugconfig presets, manual p. 195, screenshot p195-0*

A drawn graphic EQ with 253 bands, applied in the frequency domain. You scribble a
curve across the display, and every FFT bin is scaled by the curve's value at that
bin. Isolated dots let single bins through, which gives the effect its eerie,
whistling character.

**Original interface.** Window 309×153, origin (1,0), with a tan background. A
multislider covers almost all of it, and a thin yellow vertical slider runs down the
right edge.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Filter curve | multislider, 253 bars, drawn | 0–127 per band | Niporto Kwah curve | 1,27 (296×126); hint "Spectral Filter - Draw Filter Here!" |
| Output Level | vertical slider | 0–2 | 1 | 297,27 (13×110) |
| Parameter-change menu | host menu | includes Randomize and Evolve (manual) | — | host |
| Presets | menu | 8: Niporto Kwah, Brick Wall, Low Pass, Bips, Really Low, Really High, Mid Heavy, Banshee | Niporto Kwah | host menu |

The 253 bands are published to the host as automatable parameters 2–254
(`plugmultiparam 2 253 0 127`).

**Signal flow.** The input goes through a 1024-point FFT with overlap 2. The 253 band
values, divided by 127, are written into a 512-entry gain table. Inside the FFT each
bin's real and imaginary parts are multiplied by that bin's gain, which scales
magnitude without touching phase. The inverse FFT and overlap-add follow, then a
smoothed Output Level. The bars fill table entries 0–252 one to one, so at 44.1 kHz
the drawn curve covers about 0–10.9 kHz. Whether bins 253–511 are zero (muted) or
held at a stored value is *not* clear from the patch.

**Here.** New `ShapeKind::SpectralFilter`. It shares the STFT framework planned for
Spectral Dynamics in HYPERPRISM.md. The 253-value curve is slot state with its own
automation route, if wanted. Two controls are added here so the pad has two axes.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `level` | Output level | 0–2 | 1 | no | x |
| `shift` | Curve shift (added) | −126 to 126 | 0 | no | bands |
| `depth` | Curve depth (added) | 0–1 (0 = flat, 1 = as drawn) | 1 | no | |

**Shared panel.** The draw display is primary and takes the panel's width. The
Output level slider runs down its right edge as in the original. Under it sit
Randomise and Evolve buttons, matching the original's menu commands, followed by
Shift and Depth. Pad: X `shift` (−64 to 64), Y `depth` (0–1).

**Tests.** A flat curve at 127 with level 1 reproduces the input within −60 dB error,
after aligning for the frame latency. A curve with one band at 127 and the rest at 0
passes a sine at that band's centre and attenuates a sine 20 bands away by at least
40 dB. `shift` +10 moves that passband up 10 bins.

**Open questions.** Should bins above band 253 be muted, as the table layout suggests,
or should the 253 bands stretch over the whole spectrum? Should individual bands be
automation targets (253 lanes)?

---

### WasteBand
*Pluggo 3.6.1, Cycling '74 · VST, stereo · params.tsv, presets, manual pp. 243–246, screenshot p243-0; patch encoded*

A three-band distortion with independent left and right channels. Each band of each
channel has its own overdrive and level, so you can mute a range, keep it clean, or
fuzz it alone. The left and right split points are independent too, which makes the
lopsided stereo presets possible. Drive is measured in "fuzzlets".

**Original interface.** Generic view, 16 rows. The screenshot shows *Lopsided Mirror
Fizz*, and the strip reads "Sets volume for lower frequency range (left channel)".

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| LowerUpperBound L | slider | 40–8000 Hz | 440 | row 1 |
| UpperLowerBound L | slider | 40–8000 Hz | 1760 | row 2 |
| LowerUpperBound R | slider | 40–8000 Hz | 440 | row 3 |
| UpperLowerBound R | slider | 40–8000 Hz | 1760 | row 4 |
| LowOverDrive L / LowVolume L | sliders | −100 to 100 fuzzlets / 0–100 % | 1 / 100 | rows 5–6 |
| LowOverDrive R / LowVolume R | sliders | same | 1 / 100 | rows 7–8 |
| MidOverDrive L / MidVolume L | sliders | same | 1 / 100 | rows 9–10 |
| MidOverDrive R / MidVolume R | sliders | same | 1 / 100 | rows 11–12 |
| HighOverDrive L / HighVolume L | sliders | same | 1 / 100 | rows 13–14 |
| HighOverDrive R / HighVolume R | sliders | same | 1 / 100 | rows 15–16 |
| Presets | menu | 8: Starting Point, Old Fuzzbottom, Narrow Band, L No Mid R No Ends, Crunchy Topping, Lopsided Mirror Fizz, Different Stripes, In Extremis | Starting Point | host menu |

**Signal flow** (*inferred*). In each channel, a crossover at LowerUpperBound and
UpperLowerBound splits the signal into low, mid and high. Each band is overdriven by
its fuzzlet amount, using a waveshaper whose pre-gain rises with |drive|. The manual
says negative values give a more extreme curve. Each band is then scaled by its
volume, and the three are summed. Volume 0 mutes the band. The manual's descriptions
cross-reference the wrong bound in places; the parameter names and the screenshot
show which bound does what.

**Here.** New `ShapeKind::WasteBand`. The crossover is a 4th-order Linkwitz–Riley,
chosen so that at drive 0 and volume 100 % the bands sum flat. A `link` switch is
added here, so one hand (or the pad) can move both channels. Presets whose two
channels differ load with link off.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `link` | Link L/R (added) | 0–1 | 1 | no | |
| `splitLowL` / `splitLowR` | Low/mid split L / R | 40–8000 | 440 | yes | Hz |
| `splitHighL` / `splitHighR` | Mid/high split L / R | 40–8000 | 1760 | yes | Hz |
| `lowDriveL` / `lowDriveR` | Low drive L / R | −100 to 100 | 1 | no | fz |
| `lowVolL` / `lowVolR` | Low level L / R | 0–100 | 100 | no | % |
| `midDriveL` / `midDriveR` | Mid drive L / R | −100 to 100 | 1 | no | fz |
| `midVolL` / `midVolR` | Mid level L / R | 0–100 | 100 | no | % |
| `highDriveL` / `highDriveR` | High drive L / R | −100 to 100 | 1 | no | fz |
| `highVolL` / `highVolR` | High level L / R | 0–100 | 100 | no | % |

**Shared panel.** A band display shows the two split points per channel as draggable
lines. Under it is a 3×2 grid: Low, Mid and High columns, with L and R rows, each cell
holding a Drive dial and a Level slider. Link sits at the top. Mid drive L is primary.
When Link is on the R row is greyed out and follows L. Pad: X `splitHighL` (200–8000),
Y `midDriveL` (−100 to 100).

**Tests.** With all drives 0 and all levels 100 %, white noise in comes out within
±0.5 dB of flat. Mid volume 0 on L attenuates a 1 kHz sine on L by at least 40 dB (splits
440/1760) and leaves R unchanged. With link on, moving `splitLowL` moves the R split.
Drive 100 on a band raises its odd harmonics above −30 dBc for a −6 dBFS sine.

**Open questions.** The fuzzlet curve, and what negative fuzzlets do exactly.

---

### Frequency Shift
*Pluggo 3.6.1, Cycling '74 · VST, mono · params.tsv, presets, manual p. 77, screenshot p077-0; patch encoded*

A single-sideband frequency shifter. Every component moves by the same number of
hertz, so harmonic sounds turn inharmonic and bell-like. A Fluctuation pair adds random
wandering to the shift, which at small values gives a warped-record warble.

**Original interface.** The generic view with its header visible: a View menu
(Parameters), a Meter menu (In) and an LED meter, then four rows.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| View / Meter | menus + LED meter | Parameters/Interface; In/Out | Parameters, In | header |
| Frequency Shift | slider | −1000 to 3000 Hz | 0 | row 1 |
| Fluctuation Rate | slider | 0–1 | 0 | row 2 |
| Fluctuation Depth | slider | 0–4 | 0 | row 3 |
| Gain | slider | −76 to 18 dB | 0 | row 4 |
| Presets | menu | 8: No Shift, Really High, Minor Shift, Warble, Ferris Wheel, Chaotic, Transgalactic Radio, Pepto Bismoid | No Shift | host menu |

**Signal flow** (*inferred*; the manual describes the result only). A Hilbert
transformer splits the input into two signals 90° apart. These are multiplied by the
cosine and sine of an oscillator at the shift frequency and combined, keeping one
sideband. Negative shifts move the spectrum down, folding through 0 Hz. A smoothed
random source adds a wandering offset to the shift frequency. Fluctuation Rate sets how
often it changes and Fluctuation Depth how far it moves. Gain follows.

**Here.** New `ShapeKind::FreqShift`, a Hilbert all-pass pair and a quadrature
oscillator, run per channel with a shared oscillator. The fluctuation keys keep the
original's scales, since their units are unknown. The proposed mapping is rate → a
noise rate of 0.1–30 Hz (log), and depth → a deviation of up to depth × 25 Hz.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `shiftHz` | Shift | −1000 to 3000 | 0 | no | Hz |
| `flutterRate` | Fluctuation rate | 0–1 | 0 | no | |
| `flutterDepth` | Fluctuation depth | 0–4 | 0 | no | |
| `gainDb` | Gain | −76 to 18 | 0 | no | dB |
| `seed` | Seed (added) | 1–16 777 215 | 1 | no | |

**Shared panel.** Shift is the primary control, a wide slider with 0 marked. Below it
are *Fluctuation* (Rate, Depth) and Gain. An input/output meter keeps the original's
header meter. Pad: X `shiftHz` (−500 to 1500), Y `flutterDepth` (0–4).

**Tests.** A 1 kHz sine shifted by +100 Hz peaks at 1100 Hz, with 900 Hz at least 30 dB
down. Shift 0 with depth 0 returns the input within the Hilbert pair's phase response:
magnitude within 0.1 dB from 50 Hz to 15 kHz. A 440 Hz + 880 Hz pair shifted +50 Hz
gives 490 and 930 Hz, no longer in a 2:1 ratio.

**Open questions.** The real units of Fluctuation Rate and Depth.

---

### HF Ring Mod
*Pluggo 3.6.1, Cycling '74 (by Adam Schabtach) · VST, mono + PluggoBus in, mono out · params.tsv, presets (stride 7), patch.txt (decoded), ui.txt, manual pp. 89–90, screenshot p089-0*

Ring Modulator with the oscillator taken up to 20 kHz and its FM up to 10 kHz.
Sum tones go ultrasonic and difference tones fold back below 0 Hz into the audible
range. The original was released as a second plug-in so that Ring Modulator's saved
settings kept their meaning. That reason applies here too.

**Original interface.** Window 355×280, origin (0,10). At the top are a coloured
"ring modulator" title picture and the red subtitle "HIGH FREQUENCY VERSION". Below
them are two source menus side by side with a PluggoBus logo, then three right-aligned
number boxes with labels, and two horizontal sliders.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Signal 1 Source | menu | Off, Left, Right, Oscillator, PluggoBus 1L, 1R, 2L, 2R, 3L, 3R, 4L, 4R | Left | 46,107 (100), label 46,88 |
| Signal 2 Source | menu | same | Oscillator | 157,107 (100), label 157,88 |
| Oscillator Frequency | number | 0–20 000 Hz | 800 | 174,146 (50), label 58,142 |
| FM Frequency | number | 0–10 000 Hz | 0 | 174,163 (50), label 93,164 |
| FM Depth | number | 0–10 000 Hz | 0 | 173,185 (50), label 114,185 |
| Mix | h-slider | 0–100 % ("Signal 1" … "Sig. 1 x 2") | 100 | 88,223 (127×15), label 54,225 |
| Output | h-slider | −70 to 18 dB, "0 dB" tick | 0 | 88,247 (127×15), label 43,248 |
| Title / logo pictures | pictures | — | — | 34,31; 21,72; 264,103 |
| Presets | menu | 8: 800Hz modulator, 4kHz Modulator, 16kHz Modulator, Tremulous Tremolo, Modulated Modulo, Left Times Right, Inharmonicity, Grade B Martians | 800Hz modulator | host menu |

**Signal flow.** Two 12-way selectors pick Signal 1 and Signal 2 from: silence, the
left input, the right input, the internal oscillator, or a PluggoBus channel. The
oscillator is a sine at Osc Freq + FM Depth × sine(FM Freq). The output is Signal 1
× (1 − mix) + (Signal 1 × Signal 2) × mix. Then comes output gain (dB to linear,
smoothed over 20 ms), sent mono to both outputs. There is no DC blocking: a DC offset
on an input lets the oscillator through, which makes it AM rather than pure ring
modulation.

**Here.** New `ShapeKind::RingHf`. It is the adjusted Ring DSP (see Ring Modulator)
with a wider table. A separate kind keeps every saved Ring lane's unit values
meaning what they meant.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `hz` | Frequency | 0.1–20 000 | 800 | yes | Hz |
| `mix` | Mix | 0–1 | 1 | no | |
| `sweep` | Sweep | −2000 to 2000 | 0 | no | Hz/s |
| `fmHz` | FM frequency | 0–10 000 | 0 | no | Hz |
| `fmDepthHz` | FM depth | 0–10 000 | 0 | no | Hz |
| `outDb` | Output | −70 to 18 | 0 | no | dB |
| `carrier` | Signal 2 | 0–1 (oscillator, other channel) | 0 | no | |

**Shared panel.** The same as Ring, which follows the original. *Sources*: Signal 2
menu (Signal 1 is always the channel itself). *Oscillator*: Frequency (primary), FM
frequency, FM depth, Sweep. *Output*: Mix, labelled "dry" … "ring" as the original's
"Signal 1" … "Sig. 1 x 2", then Output with a 0 dB tick. Pad: X `hz` (20–20 000), Y
`mix` (0–1), the pair HYPERPRISM.md gives Ring.

**Tests.** A 1 kHz sine at hz 15 kHz, mix 1 gives 14 kHz and 16 kHz components. At
44.1 kHz, the 16 kHz component stays below Nyquist and is present. With mix 0 the output
equals the input times the output gain. `carrier` 1 with L = 300 Hz and R = 500 Hz sines
gives 200 Hz and 800 Hz on both channels.

**Open questions.** PluggoBus sources have no equivalent. The app's
other-file-as-input idea (Spectral Dynamics in HYPERPRISM.md) could supply one later.

---

### Ring Modulator
*Pluggo 3.6.1, Cycling '74 · VST, mono + PluggoBus in, mono out · params.tsv, presets (stride 7), manual pp. 176–177, screenshot p176-0; patch encoded*

The original, lower-range ring modulator: two selectable signals multiplied, with an
internal sine oscillator up to 5 kHz that can be frequency-modulated up to 100 Hz. At
sub-audio settings it is a tremolo. It has no DC blocking, so an offset on the input
shows up as the oscillator's own tone.

**Original interface.** Custom panel, the same layout as HF Ring Mod without the
subtitle (from the screenshot; positions *inferred* from HF Ring Mod's decoded patch).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Signal 1 Source | menu | Off, Left, Right, Oscillator, PluggoBus 1L–4R | Left | ~46,107 |
| Signal 2 Source | menu | same | Oscillator | ~157,107 |
| Oscillator Frequency | number | 0–5000 Hz | 200 | ~174,146 |
| FM Frequency | number | 0–100 Hz | 0 | ~174,163 |
| FM Depth | number | 0–100 Hz | 0 | ~173,185 |
| Mix | h-slider | 0–100 % | 100 | ~88,223 |
| Output | h-slider | −70 to 18 dB | 0 | ~88,247 |
| Presets | menu | 8: 200Hz modulator, 1kHz Modulator, 4kHz Modulator, Tremulous Tremolo, Modulated Modulator, Left Times Right, Inharmonicity, Grade B Martians | 200Hz modulator | host menu |

**Signal flow.** As HF Ring Mod, with the narrower oscillator and FM ranges (the manual
gives the two as the same design).

**Here.** Adjust **Ring**. The existing `hz` (0.1–8000) covers 0–5000, and `mix`
covers Mix (÷100). Add four keys. Defaults leave existing documents unchanged.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `fmHz` | FM frequency | 0–100 | 0 | no | Hz |
| `fmDepthHz` | FM depth | 0–100 | 0 | no | Hz |
| `outDb` | Output | −70 to 18 | 0 | no | dB |
| `carrier` | Signal 2 | 0–1 (oscillator, other channel) | 0 | no | |

Mapping: Osc Freq → `hz`; Mix % / 100 → `mix`; FM Freq → `fmHz`; FM Depth →
`fmDepthHz`; Output → `outDb`. Signal 2 = Oscillator → `carrier` 0, and Signal 2 =
Right with Signal 1 = Left (*Left Times Right*) → `carrier` 1. `sweep` stays as Ring
has it. FM adds `fmDepthHz` × sin(2π·fmHz·t) to the oscillator frequency, before
`sweep`'s fold.

**Shared panel.** As HF Ring Mod. Pad: X `hz` (20–5000), Y `mix` (0–1).

**Tests.** With the new keys at their defaults, Ring's output is bit-identical to
today's for a fixed input. `fmDepthHz` 100 at `fmHz` 5 on `hz` 1000 makes the 1 kHz
sideband of a DC input wander between 900 and 1100 Hz. `outDb` −6 halves the
amplitude.

---

### ShepardTones
*Pluggo 3.6.1, Cycling '74 · VST, no audio input, mono out · params.tsv, presets, manual p. 184, screenshot p184-0; patch encoded*

A generator, not a processor: it makes a Shepard tone that seems to rise or fall
forever. Rate sets the speed and direction, and Pitch sets where the illusion is
centred. Interval and Dropoff shape the crossfade that hides each voice's wrap-around.

**Original interface.** Generic view, five rows.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Rate | slider | −20 to 20 (positive rises) | 10 | row 1 |
| Dropoff | slider | 0–127 | 10 | row 2 |
| Pitch | slider | 0–127 MIDI note | 60 | row 3 |
| Interval | slider | 0–127 (MIDI note numbers, per manual) | 60 | row 4 |
| Gain | slider | 0–0.5 (manual says 0–5) | 0.1 | row 5 |
| Presets | menu | 3: Gimme a Laser, Guarded Optimism, Your Shepard and Flock Here | Gimme a Laser | host menu |

**Signal flow** (*inferred*). Several sine voices are spaced Interval apart and all
glide at Rate. When one leaves the top of the range it wraps to the bottom, or the
reverse when falling. Each voice's amplitude follows a bell curve in pitch, centred on
Pitch, with its slope set by Dropoff, so voices fade out before they wrap. The manual
describes the crossfade as between two tones an Interval apart; a two-voice version is
the minimum case of the same scheme. The sum is scaled by Gain.

**Here.** New `ShapeKind::Shepard`, a rack generator like PN noise. Its tone is added
to the passing audio, and a dry control is added for that.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `rate` | Rate | −20 to 20 | 1 | no | |
| `dropoff` | Dropoff | 0–127 | 10 | no | |
| `pitch` | Pitch | 0–127 | 60 | no | note |
| `interval` | Interval | 1–127 | 12 | no | st |
| `gain` | Gain | 0–0.5 | 0.1 | no | |
| `dry` | Dry (added) | 0–1 | 1 | no | |

`interval` defaults to 12 here, not the presets' 60, because octave spacing is the
textbook Shepard tone. Presets load their own values.

**Shared panel.** *Tone*: Rate (primary, centre-zero), Pitch, Interval, Dropoff.
*Level*: Gain, Dry. Display: a spectrum sketch of the voices under their bell curve,
moving with Rate. Pad: X `rate` (−20 to 20), Y `pitch` (36–96).

**Tests.** Rate 0 produces a steady spectrum (centroid drift under 1 % over 10 s). With
rate > 0 the voices' instantaneous frequencies all rise, yet the spectral centroid after
one full wrap period is within 5 % of its start. Gain 0 with dry 1 is the input
unchanged.

**Open questions.** The unit of Rate (semitones per second, or something else); what
Interval 60 means if it is "a MIDI note number"; the number of voices.

---

### Speed Shifter
*Pluggo 3.6.1, Cycling '74 (by jhno) · VST, mono in, stereo out · params.tsv, presets, manual pp. 196–197, screenshot p196-0; patch encoded*

Two tape loops, one per output side, each with its own length and playback speed from
−400 % to +400 %. Negative speeds play backwards. Both loops feed back into the shared
input through a clipper. At matched, slightly-off speeds it doubles and detunes. At
odd speeds and lengths it smears into pitch-shifted, reversed clouds.

**Original interface.** Generic view, nine rows (screenshot: preset *Murky*, "Speed Shifter (by jhno)").

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–1 | 0.75 | row 1 |
| Dry Level | slider | 0–1 | 0 | row 2 |
| Left Speed | slider | −400 to 400 % | 50 | row 3 |
| Right Speed | slider | −400 to 400 % | 50 | row 4 |
| Left Length | slider | 0–2000 ms | 1011 | row 5 |
| Right Length | slider | 0–2000 ms | 1111 | row 6 |
| Left Feedback | slider | 0–100 % | 50 | row 7 |
| Right Feedback | slider | 0–100 % | 50 | row 8 |
| Feedback Clipping | slider | 0–100 % | 50 | row 9 |
| Presets | menu | 8: Murky, Crystalline, Reversal, Plodding, Tape Detune, A Steady Clip, Alien Squaredance, Murky 2 | Murky | host menu |

**Signal flow** (*inferred* in detail). The input plus the feedback signal is written
continuously into two circular buffers, the loops, of Left and Right Length. The
feedback signal is left loop × Left Feedback + right loop × Right Feedback, clipped at
Feedback Clipping. Each loop is read by a head moving at Speed / 100 samples per
sample, backwards when negative, wrapping at the loop length. The left head feeds the
left output and the right head the right. The output is wet × loops + dry × input.

**Here.** New `ShapeKind::SpeedShifter`. To avoid a click each time a read head crosses
the write head or the loop seam, two heads per loop are crossfaded over 5 ms. This is a
choice made here, not something the source shows. The length minimum is raised to 1 ms
so the log sweep works.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 0.75 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `speedL` | Left speed | −400 to 400 | 50 | no | % |
| `speedR` | Right speed | −400 to 400 | 50 | no | % |
| `lengthLMs` | Left length | 1–2000 | 1011 | yes | ms |
| `lengthRMs` | Right length | 1–2000 | 1111 | yes | ms |
| `fbL` | Left feedback | 0–1 | 0.5 | no | |
| `fbR` | Right feedback | 0–1 | 0.5 | no | |
| `clip` | Feedback clip | 0–1 | 0.5 | no | |

**Shared panel.** Two loop columns, Left and Right, as in the original's pairs. Each
holds Speed (primary, centre-zero with a 100 % detent), Length and Feedback. Below are
Feedback clip and a Wet/Dry pair. Display: two loop rings, each showing the read and
write heads moving. Pad: X `speedL` (−200 to 200), Y `speedR` (−200 to 200).

**Tests.** Speed 100 % with feedback 0 and loop length 500 ms returns the input delayed
by up to one loop length, at the same pitch. Speed 200 % on a 440 Hz sine gives 880 Hz.
Speed −100 % plays a ramp back reversed within each loop. Feedback 1 with clip 0.5
never produces a sample above 0.5 in the feedback path.

**Open questions.** Whether the original writes into the loops continuously (a delay)
or records once and repeats (a true loop), and whether it handles the seam at all.
