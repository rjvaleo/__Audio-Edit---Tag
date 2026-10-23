# AmbientReverb, Aux Saturation and BizzareDelay

*22 October 2026. Spec — not built. Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md).*

Three Windows effects, read only as static files. **Ambient Reverb** is a
long-tail algorithmic reverb with separate early and late levels, a decay of up
to 100 s and a freeze. Nothing in the rack reaches that far, so it is a new
effect. **Aux Saturation** is a SynthEdit harmonic generator whose whole patch
is embedded as XML in the DLL. It makes odd harmonics with a soft clipper and
even harmonics by squaring, and it outputs only those harmonics. The rack has
no saturation, so it is new as well. **Bizzare Delay** is an iPlug delay with
two engines behind one switch: a tempo-synced tape-style "Vintage" delay and a
two-tap "Stereo" delay. Its parameter table, panel layout, value mappings and
factory preset came from its disassembly. Its two engines split onto Echo and the planned Multi Delay. Each needs
controls added. The rack has no tempo source, so the synced modes need a
`bpm` control on the effect.

| Effect | Here | Shared-panel pad pair (X / Y) |
| --- | --- | --- |
| Ambient Reverb | New — `ShapeKind::AmbientReverb` | `decayS` 0.1–100 s log / `size` 0–100 % |
| Aux Saturation | New — `ShapeKind::AuxSaturation` | `oddLevel` 0–1 / `evenLevel` 0–1 |
| Bizzare Delay | Adjust — Echo (Vintage engine) + planned Multi Delay (Stereo engine) | Vintage: `delayMs` 1–4000 log / `feedback`; Stereo: `delay1Ms` / `delay2Ms` |

---

### Ambient Reverb
*Ambient Reverb 4.3, Vasily Makarov / Stone Voices (Siberia), 2017–2018 · Windows VST 2.4, x64 · AmbientReverb.dll (strings, version resource, embedded PNGs `the images embedded in AmbientReverb.dll`), Readme_eng.txt*

An algorithmic stereo reverb built for ambient music. Its decay runs from
0.1 s to 100 s, and the freeze holds the tail indefinitely, so it can turn a
phrase into a sustained pad (the readme cites Frippertronics). Early
reflections and the late tail have separate levels. The tail has two-band
decay (bass ratio and crossover) and high damping, and a two-band parametric
EQ follows it. Version 4.0 replaced the algorithm. The class names
`TEarlyRefl` and `TDiff` show a dedicated early-reflection stage and a diffuser
network.

**Original interface.** Panel 773×491 px (`002.png`), in light blue with a
script "Ambient reverb 4.3" logo at the top left. Clicking the logo opens an
about box (`001.png`) with credits and a donate button. There is no numeric
value display on the face: every scale is printed around its dial. The
host-side formats are `%.0f/%.1f/%.2f`, `sec`, `kHz` and `-oo`, plus an
unexplained `Huge!`. The panel reads in three bands:
- **Top row:** Dry, Early and Late level dials, the Stone Voices mark, and small
  In and Out dials.
- **Middle row:** three boxed groups. *Pre-Delay* has Left and Right, *Decay*
  has one large dial and a Freeze toggle, and *Space* has Size and Wide.
- **Bottom row:** two groups. *Damping* has Bass Ratio, Crossover and Hi.
  *Parametric EQ* has Lo Band with its Freq and Hi Band with its Freq.
- **Right column:** a black meter bay with In L/R and Out L/R bars.

The knob filmstrips have 129 frames each: 96 px (`003`) for Decay, 72 px
(`005`) for the medium dials and 48 px (`004`) for In, Out and both Freq dials.
The Freeze toggle (`006`) is two frames of 56×59. The meter fill (`007`) is
10×257 and fades from green to yellow to red.

Dial centres were measured from each dial's shadow on the background bitmap.
The order of the 18 parameters is inferred from the DLL's string table. Every
default is unknown, because the presets are built in code rather than stored
as data.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Input Level ("In") | dial 48 px | unscaled on panel; dB (inferred) | unknown | centre 660,105 · top right |
| Output Level ("Out") | dial 48 px | unscaled; dB (inferred) | unknown | 709,105 · top right |
| Dry Level ("Dry") | dial 72 px | −∞ (−oo), −54, −40, −30, −24, −18 (top), −13, −9, −6, −3, 0 dB | unknown | 391,90 · top row |
| ER Level ("Early") | dial 72 px | same dB scale | unknown | 481,90 · top row |
| Late Level ("Late") | dial 72 px | same dB scale | unknown | 571,90 · top row |
| Predelay Left | dial 72 px | 0–200 (ms), linear, 100 at top | unknown | 95,229 · Pre-Delay box (38,152)–(233,308) |
| Predelay Right | dial 72 px | 0–200 (ms) | unknown | 185,229 · Pre-Delay |
| Decay Time | dial 96 px | 0.1, 0.3, 1, 3 (top), 10, 30, 100 sec — log | unknown | 309,221 · Decay box (240,152)–(417,298) |
| Decay Freeze | toggle, 2 frames | off / on | off (inferred) | beside the "Freeze" label at ~382,188; exact rect not in static data |
| Size | dial 72 px | 0–100, 50 at top | unknown | 481,229 · Space box (425,152)–(617,308) |
| Wide | dial 72 px | 0–200 (%), 100 at top | unknown | 571,229 · Space |
| Bass Ratio | dial 72 px | 0–3, 1.5 at top, linear | unknown | 95,403 · Damping box (38,310)–(323,462) |
| Crossover | dial 72 px | 50, 80, 125, 200, 312 (top), 500, 800, 1.2k, 2k Hz — log | unknown | 185,403 · Damping |
| High Damping ("Hi") | dial 72 px | 500, 800, 1.3k, 2k, 3.2k (top), 5k, 8k, 12k, 20k Hz — log | unknown | 276,403 · Damping |
| EQ Low Band Level ("Lo Band") | dial 72 px | −15 … 0 (top) … +15 dB | unknown (0 likely) | 389,403 · Parametric EQ box (332,310)–(617,462) |
| EQ Low Band Freq ("Freq") | dial 48 px | unscaled on the panel | unknown | 451,417 · EQ |
| EQ Hi Band Level ("Hi Band") | dial 72 px | −15 … +15 dB | unknown (0 likely) | 523,403 · EQ |
| EQ Hi Band Freq ("Freq") | dial 48 px | unscaled; `kHz` unit string | unknown | 585,417 · EQ |
| In meter L, R | bar meter 10×257 | 0, −3 … −36 in 3 dB steps, then −40, −45, −50, −60, −70, −∞ dB | — | bay (629,150) 100×314; bars ~x 645, 657, y 178 |
| Out meter L, R | bar meter 10×257 | same scale | — | bars ~x 695, 707, y 178 |
| Program menu | host programs | 16: Default, Cathedral, Station, Small Hall, Medium Hall, Large Hall, Stadium, Far Space, Long Ambience, Spring Reverb, Metal And Vacuum, Mellow, Garage, Input In A Cave, Dark Ambience, Deep Underground | Default | host only |

I/O is stereo: "Left input", "Right input", "Left output" and "Right output".

**Signal flow.** Read from the panel, the strings and the readme. The block
order is inferred.
1. Input gain, metered.
2. A separate predelay on each channel, 0–200 ms, which gives a stereo offset
   when Left and Right differ.
3. An early-reflection stage (`TEarlyRefl`): a fixed multi-tap pattern scaled
   by Size. An unreferenced table of 122 floats in `.rdata` is probably its tap
   data (inferred). Its output goes to Early.
4. A late tank of diffusers (`TDiff`) feeding a recirculating network, set
   for a decay time in seconds. Size scales the delay lengths.
5. Two-band decay in the loop. Below Crossover the decay time is multiplied by
   Bass Ratio (1 = flat, 0–3). A low-pass at Hi sits in the loop, so high
   frequencies die faster.
6. Freeze sets the loop gain to 1 and, by convention, mutes new input to the
   tank (inferred). That holds the tail indefinitely.
7. Wide scales the late signal's side component from 0 (mono) through 100 %
   (natural) to 200 % (exaggerated).
8. The two-band parametric EQ shapes the reverb. Whether it also touches the
   dry signal is not stated.
9. The sum Dry·x + Early·ER + Late·tail passes through the output gain and the
   output meter.

The readme stresses dense reflections without graininess, which implies
enough diffusion and modulation to avoid flutter (inferred).

**Here.** New: `ShapeKind::AmbientReverb`. The Schroeder, Moorer and Dattorro
Plate reverbs take `decay` as a 0–1 loop coefficient, have no early/late
split, cannot run a 100 s tail and have no two-band decay. Retargeting any of
them would change what their saved values mean. Levels use the rack's
wet/dry vocabulary in dB, with −96 standing for −∞. Every default below is
proposed, not read from the binary.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `inputDb` | Input | −24 – 12 | 0 | no | dB |
| `outputDb` | Output | −24 – 12 | 0 | no | dB |
| `dryDb` | Dry | −96 – 0 | 0 | no | dB |
| `earlyDb` | Early | −96 – 0 | −12 | no | dB |
| `lateDb` | Late | −96 – 0 | −6 | no | dB |
| `predelayLMs` | Pre-delay L | 0 – 200 | 20 | no | ms |
| `predelayRMs` | Pre-delay R | 0 – 200 | 30 | no | ms |
| `decayS` | Decay | 0.1 – 100 | 3 | yes | s |
| `freeze` | Freeze | 0 – 1 (switch) | 0 | no | |
| `size` | Size | 0 – 100 | 50 | no | % |
| `width` | Wide | 0 – 2 | 1 | no | |
| `bassRatio` | Bass ratio | 0 – 3 | 1 | no | × |
| `crossoverHz` | Crossover | 50 – 2000 | 500 | yes | Hz |
| `highDampHz` | Hi damping | 500 – 20000 | 8000 | yes | Hz |
| `eqLowDb` | Lo band | −15 – 15 | 0 | no | dB |
| `eqLowHz` | Lo freq | 40 – 1000 (inferred) | 200 | yes | Hz |
| `eqHighDb` | Hi band | −15 – 15 | 0 | no | dB |
| `eqHighHz` | Hi freq | 1000 – 16000 (inferred) | 5000 | yes | Hz |

`width` uses the rack's existing 0–2 convention, so the original's 100 % is 1.
The 16 program names ship as rack presets once their values have been chosen
by ear.

**Shared panel.**
- **Levels** (top row, as on the original): Dry, Early and Late dials, then
  Input and Output as small dials.
- **Pre-delay:** L and R dials.
- **Decay (primary):** a large Decay dial with the Freeze switch beside it.
- **Space:** Size and Wide.
- **Damping:** Bass ratio, Crossover and Hi.
- **EQ:** Lo band with its Freq, then Hi band with its Freq.
- **Displays:** an In/Out stereo meter pair on the right, 0 to −70 dB.
- **Prism pad:** X is `decayS` (0.1–100 s, log) and Y is `size` (0–100 %).

**Tests.**
- With `earlyDb` and `lateDb` at −96, the output equals input × dry gain × output gain to within 1e-6.
- With `predelayLMs` 0 and `predelayRMs` 200 on an impulse, the right channel's first non-zero sample comes 200 ms ± 1 sample after the left channel's.
- With `decayS` 2, the RT60 measured from an impulse is 2 s ± 20 %. With `freeze` 1 and the input stopped, tail energy across the next 10 s stays within 1 dB.
- With `bassRatio` 2 and `crossoverHz` 300, the decay time of a 100 Hz band is at least 1.5 times that of a 2 kHz band.

**Open questions.**
- The Input and Output dial ranges and both EQ Freq ranges are not printed on
  the panel or in the strings.
- What `Huge!` labels: likely Size or Decay at an extreme.
- Whether the EQ is on the wet path only.
- Every factory default and preset value is unknown. They are built in code,
  and recovering them would need a deeper disassembly of the x64 binary.

---

### Aux Saturation
*Aux Saturation 1.00, Yuri Semenov, 2021 · Windows VST2 and VST3 x64, built in SynthEdit 1.4 (B549) · embedded SynthEdit document in `Aux Saturation.dll` (DSP graph, GUI JSON, parameter table), skin txt files, De__background.png, Ov__L100.png, Ov__VS.png, De__Mute.png, vst2FactoryPresets/0000_.xmlpreset. The VST2 and VST3 folders hold the same skin files.*

A harmonic generator meant for an aux send. Each channel splits into two
paths. The odd path runs through a symmetric soft clipper, and the clean
signal is subtracted from the result, which leaves mostly the odd harmonics
the clipper added. The even path multiplies the signal by itself, which makes
the 2nd harmonic. Each path has its own level, mute, high cut and low cut.
There is **no dry path**: the plug-in outputs harmonics only, which is why it
is called "Aux". The whole patch runs 4× oversampled.

**Original interface.** Panel 452×308; the background art is 450×307, warm
grey stone with an engraved "AUX SATURATION" title. Read left to right:
- **Odd side (left edge):** a hi cut dial at the top and a lo cut dial below.
- **"odd" column:** the MUTE 1 button, then the tall vol-1 slider.
- **Centre column:** the "harmonics" heading and an "UpSampl" list box.
- **"even" column:** the MUTE 2 button, then the vol-2 slider.
- **Even side (right edge):** hi cut and lo cut dials.

Each dial is 100×100 (31-frame rotary filmstrip, black, from about 7 o'clock
to 5 o'clock) with a numeric text box under it. Each slider is a vertical
fader with an 84×120 frame, a chrome handle and an orange value box under it.
Each MUTE button is 60×25 with two frames: plain, then with a red bar. Panel
rects come from the GUI JSON and are container-relative.

| Control | Type | Range / unit | Default (factory preset) | Position x,y (w×h) / group |
| --- | --- | --- | --- | --- |
| HiCut (odd), param 0 | dial 100 px + value box | 100–20 000 Hz | 1000 | dial 2,70 (100×100); box 27,150 (50×27) · left, top |
| LoCut (odd), param 2 | dial + box | 20–16 000 Hz | 20 | dial 2,186; box 22,266 (56×27) · left, bottom |
| HiCut (even), param 1 | dial + box | 100–20 000 Hz | 7000 | dial 347,75; box 372,155 · right, top |
| LoCut (even), param 3 | dial + box | 20–16 000 Hz | 800 | dial 347,187; box 367,267 · right, bottom |
| Mute 1 (odd), param 4 | button, 2 frames | stored as 10 (sound on) → 0 (muted); range written 10→0 | 10 (on) | 102,82 (68×33 incl. padding) · under "odd" |
| Mute 2 (even), param 5 | button | 10 → 0 | 10 (on) | 268,82 (68×33) · under "even" |
| Vol 1 (odd), param 6 | vertical slider + box | 0–10 (SynthEdit default span); box shows ×10 (inferred 0–100) | 5 | slider 96,137 (84×120); box 113,256 (53×40) · "vol-1" |
| Vol 2 (even), param 7 | vertical slider + box | 0–10; box ×10 | 3 | slider 262,135 (84×120); box 278,256 (56×40) · "vol-2" |
| Oversampling/Rate | list box (host-connected, private) | Off, 2x, 4x, 8x, 16x, 32x | 4x | 191,133 (74×128) · centre, "UpSampl" |
| Oversampling Filter Poles | hidden (host-only) | 3, 5, 7, 9, FIR-Low, FIR-Med, FIR-Hi, FIR-Ultra | FIR-Low | — |
| Preset | host | one factory preset, "Preset 1" | — | — |

The dial and box fonts are bold Arial in a pale steel blue (#b8c7dd). The
plug-in reports latency compensation and is stereo in, stereo out.

**Signal flow.** Taken from the DSP graph. Values are in SynthEdit volts,
where 10 V is unity.

- **Odd path, per channel:**
  1. x is scaled by Mute 1.
  2. A symmetric soft clipper (dehaupt `DH_SoftDist 1.2J`) shapes it, with
     Shape fixed at 2 V and Limit fixed at 6 V.
  3. The result is scaled by 0.825 (8.25 V).
  4. The muted input, inverted, is added to it. Clipped minus clean leaves the
     added harmonics; how complete the cancellation is depends on the
     clipper's small-signal gain (inferred).
  5. A VCA sets the level. Its control is Vol 1 + 3 V, so the odd path keeps
     a fixed bias and is silenced only by its mute.
  6. A one-pole Butterworth low-pass sets the hi cut, then a one-pole
     high-pass sets the lo cut. Both have 6 dB/oct slopes.
- **Even path, per channel:**
  1. x is multiplied by itself (a Level Adj stage whose input and gain are
     both x). That gives DC plus the 2nd harmonic, and sum and difference
     tones on complex input. Its level grows with the square of the input
     level.
  2. A one-pole high-pass with its pitch pin at 0 V removes the DC; its corner
     is low (inferred).
  3. Mute 2 is applied.
  4. A VCA sets the level from Vol 2.
  5. A one-pole LP (hi cut) and a one-pole HP (lo cut) finish the path.
- **Output:** odd + even, per channel. L and R are processed independently,
  with no cross-feed.
- **Oversampling:** the whole graph sits in one container at 4× with the
  FIR-Low filter, and the host can change both.

Whether the VCAs respond linearly or exponentially is not stored in the
document.

**Here.** New: `ShapeKind::AuxSaturation`. The rack has no saturator.

The rack has no aux sends: an effect sits inline on one file. So this adds a
`dry` control, set to 1 by default. That reproduces what the original sounds
like on a send, summed back with the track. Setting `dry` to 0 gives the
original's harmonics-only output. Mutes become switches with 1 meaning muted,
the reverse of the original's stored 10/0.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `oddLevel` | Odd level | 0 – 1 | 0.5 | no | |
| `oddMute` | Odd mute | 0 – 1 (switch) | 0 | no | |
| `oddHiCutHz` | Odd hi cut | 100 – 20000 | 1000 | yes | Hz |
| `oddLoCutHz` | Odd lo cut | 20 – 16000 | 20 | yes | Hz |
| `evenLevel` | Even level | 0 – 1 | 0.3 | no | |
| `evenMute` | Even mute | 0 – 1 (switch) | 0 | no | |
| `evenHiCutHz` | Even hi cut | 100 – 20000 | 7000 | yes | Hz |
| `evenLoCutHz` | Even lo cut | 20 – 16000 | 800 | yes | Hz |
| `oversample` | Upsample | 0 – 5 (menu: Off, 2×, 4×, 8×, 16×, 32×) | 2 (4×) | no | |
| `dry` | Dry | 0 – 1 | 1 | no | |

The odd VCA gain is `0.3 + oddLevel`, keeping the original's fixed 3 V bias.
The even gain is `evenLevel`. The dry signal must be delayed by the
oversampler's latency, so the two stay aligned.

**Shared panel.**
- **Odd** (left, as on the original): Odd mute switch, Odd level as the
  primary slider, then Odd hi cut and Odd lo cut dials.
- **Centre:** the Upsample menu and the Dry dial.
- **Even** (right): Even mute, Even level, Even hi cut and Even lo cut,
  mirrored.
- **Displays:** none on the original. An optional small spectrum showing the
  added harmonics would help, but is not required.
- **Prism pad:** X is `oddLevel` and Y is `evenLevel`, both 0–1.

**Tests.**
- With a 1 kHz sine at −6 dBFS, `oddMute` 1 and `dry` 0, the 2 kHz component is the largest. The 1 kHz component is at least 40 dB below it, and DC is below −80 dBFS.
- With `evenMute` 1 and `dry` 0, the output has a 3 kHz component, and its 2 kHz component is at least 60 dB below that. The clipper is symmetric, so an even harmonic means a bug.
- With both mutes on and `dry` 1, the output equals the input delayed by the reported latency, within 1e-6.
- With `evenHiCutHz` at 1000 instead of 20000, an 8 kHz even-harmonic component drops by at least 15 dB (one pole over three octaves).

**Open questions.**
- The exact transfer curve of the `DH_SoftDist` Shape/Limit pair. The module
  is a separate .sem binary, and its curve is not described anywhere static.
- The VCA response law (linear or dB).
- Vol's true range. The patch-memory default span is 0–10, but no range is
  written.

---

### Bizzare Delay
*BizzareDelay, "1cl" (1st Creative Labs; panel credits www.1stcreativesolutions.co.uk, with "Bizzare Concept" and "Mainstage Productions" logos), March 2012 · Windows VST2, 32-bit, built on WDL-OL iPlug · BizzareDelay.dll (strings, iPlug constructor, OnParamChange and ProcessDoubleReplacing read by static disassembly), embedded PNGs `the nine images embedded in BizzareDelay.dll`*

Two delays in one window, chosen by a Stereo/Vintage switch:
- **Vintage:** a tempo-synced single delay with note values from 1/1 to 1/16,
  a fine-tune multiplier that snaps to triplet and straight, high and low cut,
  ping-pong, and two delay-time modulators labelled Flutter and LFO.
- **Stereo:** two taps with tempo-grid times (a number of units, at a chosen
  number of units per beat), each with its own LP, HP, pan, feedback and
  level.

Both engines take a mono sum of the input. Dry stays per channel.

**Original interface.** Panel 595×433 (`008.png`), split in two halves.

- **Top, brushed purple, "Stereo Delay":**
  - A left box holds the Units and Wet/Dry dials (38 px, `000`), the Bizzare
    and Mainstage logos, and black value boxes.
  - Channel 1 and Channel 2 columns each have three small dials (19 px,
    `001`) labelled LP Filter, HP Filter and Pan, plus three vertical faders
    labelled Delay, FBack and Level. Each fader has a 20×123 track (`006`) and
    a 19×13 handle (`005`).
  - A right strip holds the **Stereo/Vintage** switch (`007`, 32×93, two
    frames) and the vertical URL.
- **Bottom, orange, "Vintage Delay":**
  - A left box holds the Fine Tune, Feedback, Note and Mix dials (38 px,
    `002`), each with a value box to its right, and a small Smooth dial (19
    px, `003`).
  - A centre box holds High Cut and Low Cut.
  - A right box has two groups, Flutter (Rate, Amount) and LFO (Rate, Amount),
    with a Ping Pong button below (`004`, two 24×18 frames).

Knob filmstrips have 60 frames. Value boxes are iPlug text controls in
Verdana, filled by `%4.xf` formats. Six cover panels dim the inactive engine.
Stereo mode has three: (12,46)–(193,138), (201,14)–(362,202) and
(375,14)–(536,~202). Vintage mode has three: (7,265)–(237,~420),
(241,234)–(363,418) and (367,267)–(590,~420).

Every parameter is declared 0–100 "%" with a default of 50 and a step of 0.01.
The meaning below comes from the code that turns each value into DSP state and
display text. "Preset" is the one factory program, "Bizzare Delay" (3 program
slots; the other two are unnamed). Positions are the control's top-left;
value-box rects are L,T–R,B.

| # | Control (iPlug name) | Type | Range / unit (as displayed / as used) | Default · Preset | Position / group |
| --- | --- | --- | --- | --- | --- |
| 14 | Units (`units`) | dial 38 | 1–16 steps: ⌊v·15⌋+1 units per beat | 50 · 24.29 → 4 | 43,70; box 44,117–79,130 · Stereo, left |
| 15 | Wet/Dry (`wetdry1`) | dial 38 | 0–1 crossfade: below 0.5 wet = 2v and dry = 1; above 0.5 wet = 1 and dry = 1−2(v−0.5) | 50 · 47 | 123,70; box 124,117–159,130 · Stereo, left |
| 16 | Ch1 LP Filter (`LP1`) | dial 19 | 0–20 000 Hz shown (v·20000) | 50 · 100 | 218,30; box 209,57–244,70 · Channel 1 |
| 17 | Ch1 HP Filter (`HP1`) | dial 19 | 20 Hz–20 kHz shown, log (20·1000^v); the DSP uses 20000^v Hz | 50 · 38.61 (≈290 Hz) | 218,91; box 208,120–244,133 · Channel 1 |
| 18 | Ch1 Pan (`Pan1`) | dial 19 | −1 … +1 (2v−1) | 50 · 0 (hard left) | 218,154; box 208,183–245,196 · Channel 1 |
| 19 | Ch1 Delay (`Delay1`) | fader, len 123 | 1–16 units (⌊v·15⌋+1) | 50 · 16.36 → 3 | 268,52; box 265,~183–286,196 · Channel 1 |
| 20 | Ch1 FBack (`Feedback1`) | fader | 0–1 | 50 · 75 | 301,52; box 299–320 · Channel 1 |
| 21 | Ch1 Level (`Level1`) | fader | 0–1 | 50 · 47 | 335,52; box 333–354 · Channel 1 |
| 22–27 | Ch2 LP, HP, Pan, Delay, FBack, Level | as for Ch1 | as for Ch1 | 50 · LP 100, HP 38.61, Pan 100 (hard right), Delay 27.27 → 5, FBack 75, Level 47 | dials at x 392 (y 30/91/154); faders at x 442/475/509, y 52 · Channel 2 |
| 13 | Stereo/Vintage (`switch`) | 2-state switch | below 0.5 = Vintage, 0.5 and above = Stereo | 50 · 100 (Stereo) | 543,83 · right strip |
| 6 | Fine Tune (`2fine`) | dial 38 | shown 0–0.75 (v·0.75); used as factor f = 1.5v, snapped to 2/3 for v·1.5 in 0.6–0.7 and to 1 for 0.95–1.05 | 50 · 66.6 (f snaps to 1) | 14,289; box 65,304–100,317 · Vintage |
| 3 | Feedback (`2feedback`) | dial 38 | shown 0–100; used as 0–1.6 (v·1.6) | 50 · 15 | 135,289; box 184,303–219,316 · Vintage |
| 5 | Note (`2note`) | dial 38, 5 zones | divisor 1, 2, 4, 8, 16 (1/1 … 1/16 note), with zone edges at 0.2/0.4/0.6/0.8 | 50 · 65.66 → 8 | 14,353; box 65,366–100,379 · Vintage |
| 12 | Mix (`2mix`) | dial 38 | 0–1, same crossfade law as Wet/Dry | 50 · 50 | 136,353; box 184,366–219,379 · Vintage |
| 11 | Smooth (`2Smooth`) | dial 19, no box | per-sample one-pole on delay-time changes, coefficient 0.99–0.9995 (≈2–45 ms at 44.1 kHz) | 50 · 39.47 | 113,401 · Vintage |
| 0 | High Cut (`2hicut`) | dial 38 | shown 0–20 (kHz, v·20); low-pass | 50 · 100 | 283,260; box 284,305–319,318 · centre box |
| 1 | Low Cut (`2lowcut`) | dial 38 | shown 0–20 (v·20); high-pass at 20·1000^v Hz | 50 · 21.68 | 283,350; box 283,395–318,408 · centre box |
| 10 | Flutter Rate (`2Flt Rate`) | dial 38 | shown 0–1; internal rate (0.8+0.2v)·50 = 40–50 | 50 · 0 | 379,287; box 423,301–460,314 · Flutter |
| 9 | Flutter Amount (`2Flt Int`) | dial 38 | 0–1 | 50 · 0 | 379,353; box 425,366–460,379 · Flutter |
| 8 | LFO Rate (`2LFO rate`) | dial 38 | shown 0–1; internal rate (0.2+0.8v)·20 = 4–20 | 50 · 0 | 489,287; box 535,300–570,313 · LFO |
| 7 | LFO Amount (`2LFO intensity`) | dial 38 | 0–1 | 50 · 0 | 489,353; box 535,366–570,379 · LFO |
| 4 | Ping Pong (`2pong`) | 2-state button | off below 0.5, on from 0.5 | 50 · 100 (on) | 390,402 · bottom right |
| 2 | `2msDelay1` | none | declared but ignored by the code; no control | 50 | — |

Plug-in I/O is declared "1-1 2-2" (mono or stereo), and the unique ID is
`bzdl`.

**Signal flow.** A clean-room reading of the process routine.

- **Tempo:** read from the host on every block.
- **Input:** (L+R)/2 feeds whichever engine the switch selects. The output is
  each input channel × dry + that engine's wet channel × wet.
- **Vintage delay time:** (240 000 / BPM) / note × f ms. That is a whole note
  divided by the note value, times the fine factor. It updates only when the
  note is shorter than a half or BPM is above 60, which caps the buffer at
  roughly 4–6 s. A Smooth one-pole glides the time, so changes bend pitch like
  tape.
- **Vintage feedback path:** a high cut (Chamberlin-style 2·X(π·f/fs)
  coefficient) and a low cut sit in it (inferred placement). Feedback reaches
  1.6×. The loop ends in a bounded nonlinearity applied to 0.95·x, a CRT
  transcendental (tanh or sine; not settled), which keeps over-unity
  feedback finite.
- **Vintage modulation:** Flutter and LFO each drive a two-pole section tuned
  by their rate. Their Amount scales how far the delay time moves. Ping Pong
  alternates repeats between left and right.
- **Stereo delay times:** tap n is steps_n × 60 000 / (BPM × units) ms, so
  Units divides the beat and Delay counts divisions. The maximum is 16 beats.
  Times update only when BPM is above 50.
- **Stereo taps:** each has its own feedback loop (0–1), a one-pole LP and a
  one-pole HP (on the repeats, inferred), a pan position and an output level.

**Here.** Adjust. The engines are separate effects behind one switch, so each
maps onto the rack effect that already matches it. The rack has no transport
tempo, so each gains a `bpm` control and a `sync` switch. With `sync` off,
both keep their millisecond times.

*Vintage → Echo* (`delayMs`, `feedback`, `damping`, `wet`, `dry`,
`glideMs`):
- Mix maps onto `wet` and `dry` through the crossfade law above.
- Smooth maps onto `glideMs`, about 2–45 ms.
- High Cut maps onto `damping`, approximately: damping = 1 − (cutoff / 20 kHz).
- The original's feedback above 1 is left out until the loop nonlinearity is
  known.

Echo adds:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `sync` | Sync | 0 – 1 (switch: ms / note) | 0 | no | |
| `bpm` | Tempo | 40 – 240 | 120 | no | BPM |
| `note` | Note | 0 – 4 (menu: 1/1, 1/2, 1/4, 1/8, 1/16) | 2 | no | |
| `fine` | Fine | 0 – 1.5 (snaps to 2/3 and 1) | 1 | no | × |
| `lowCutHz` | Low cut | 20 – 20000 | 20 | yes | Hz |
| `pingPong` | Ping pong | 0 – 1 (switch) | 0 | no | |
| `flutterDepth` | Flutter | 0 – 1 | 0 | no | |
| `flutterRate` | Flutter rate | 40 – 50 (internal scale; Hz inferred) | 45 | no | Hz |
| `wowDepth` | LFO | 0 – 1 | 0 | no | |
| `wowRate` | LFO rate | 4 – 20 (internal scale; Hz inferred) | 12 | yes | Hz |

*Stereo → the planned Multi Delay.* Its planned keys (`delay1Ms`, `delay2Ms`,
`feedback`, `spread`, `wet`, `dry`) stay. Wet/Dry maps onto `wet` and `dry` by
the crossfade law. Per-tap controls are added. When `pan1` and `pan2` are set,
they take over from `spread`, and `feedback` becomes a master trim on the two
per-tap amounts.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `sync` | Sync | 0 – 1 (switch) | 0 | no | |
| `bpm` | Tempo | 40 – 240 | 120 | no | BPM |
| `units` | Units/beat | 1 – 16 (integer) | 4 | no | |
| `steps1` | Delay 1 steps | 1 – 16 (integer) | 3 | no | |
| `steps2` | Delay 2 steps | 1 – 16 (integer) | 5 | no | |
| `feedback1` | Feedback 1 | 0 – 0.95 | 0.3 | no | |
| `feedback2` | Feedback 2 | 0 – 0.95 | 0.3 | no | |
| `level1` | Level 1 | 0 – 1 | 1 | no | |
| `level2` | Level 2 | 0 – 1 | 1 | no | |
| `pan1` | Pan 1 | −1 – 1 | −1 | no | |
| `pan2` | Pan 2 | −1 – 1 | 1 | no | |
| `lp1Hz` / `lp2Hz` | LP 1 / LP 2 | 200 – 20000 | 20000 | yes | Hz |
| `hp1Hz` / `hp2Hz` | HP 1 / HP 2 | 20 – 20000 | 20 | yes | Hz |

A rack preset "Bizzare Delay (Stereo)" carries the factory values:
- Taps: 4 units per beat, delays of 3 and 5 units, panned hard left and right.
- Each tap: feedback 0.75, level 0.47, HP about 290 Hz, LP open.
- Wet/Dry at 0.47.

**Shared panel.** Each engine keeps the original's half-panel grouping.
- **Vintage** (Echo):
  - **Time:** Sync, then Note (or Delay, with sync off), Fine and Tempo. Note
    and Delay are the primary controls.
  - **Repeats:** Feedback, Mix (wet/dry) and Smooth (glide).
  - **Tone:** High cut (damping) and Low cut.
  - **Flutter:** Rate and Amount. **LFO:** Rate and Amount.
  - **Ping pong** switch.
  - **Display:** a numeric readout of the resolved delay in ms.
  - **Prism pad:** X is `delayMs` (1–4000 ms, log; with sync on, `fine`
    0–1.5) and Y is `feedback` (0–0.98).
- **Stereo** (Multi Delay):
  - **Global:** Sync, Tempo, Units and Wet/Dry.
  - **Channel 1 and Channel 2, side by side:** LP, HP and Pan dials, then
    Delay, FBack and Level as vertical sliders, as on the original.
  - **Display:** each tap's time in ms.
  - **Prism pad:** X is `delay1Ms` and Y is `delay2Ms` (1–2000 ms, log). With
    sync on, the pair is `steps1` / `steps2`.

**Tests.**
- Echo, `sync` 1, `bpm` 120, `note` 1/4, `fine` 1: an impulse's first repeat arrives at 500 ms ± 1 sample. With `fine` at 0.65, it snaps and arrives at 333.3 ms.
- Multi Delay, `sync` 1, `bpm` 120, `units` 4, `steps1` 3: tap 1 arrives at 375 ms. With `pan1` −1 it appears in the left channel only.
- Echo `pingPong` 1: successive repeats of a centred impulse alternate between the left and right channels.
- Echo with `flutterDepth` 0 and `wowDepth` 0: the repeat spacing of a click train stays constant to within 1 sample over 10 s. With `wowDepth` 1 it varies.

**Open questions.**
- What the feedback loop's nonlinearity is: the CRT routine called on 0.95·x
  could be tanh or sine. That decides whether Feedback above 1 is worth
  carrying over.
- Whether Flutter and LFO are sine oscillators or filtered noise. Both feed a
  two-pole section tuned by rate, and it is not settled whether that section
  rings by itself.
- The internal rate scales: LFO 4–20, Flutter 40–50. These are probably Hz,
  but the divisor the code uses may not be the sample rate.
- Exactly where High Cut, Low Cut and the per-tap LP and HP sit, inside the
  feedback loop or after it.
