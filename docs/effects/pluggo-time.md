# Pluggo: delays, reverbs and modulation

*22 October 2026. Spec — not built. Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md).*

*Batch C1 · Pluggo 3.6.1, Cycling '74 (reference guide © 2006) · Mac VST plug-ins, each a Max/MSP patch inside the pluggo shell · 18 effects*

These eighteen are Pluggo's delay, reverb and modulation plug-ins. Most of them
are simple and only a few have a custom panel. Pluggo shows every other plug-in
as its **generic view**, a list of rows that each hold a name, a horizontal
slider and a value, in parameter order. For those, the parameter list is the
original interface. Three things about the sources shape this batch. First, only
three patches are readable text: Feedback Network, Chamberverb and Jet. The
other fifteen are stored encoded (every one begins with the same scrambled
`max v2` header). They were not decoded, so the DSP for those fifteen comes from
the manual and the parameter list and is labelled as such. Second,
`presets.tsv` only lines up for the first preset of each plug-in. A preset
stores one value for every `pp` slot, unpublished ones included (tempo, sync
mode, note value, multisliders), but the table splits rows at the published
count. Reading by slot recovers it: a parameter's id string reversed is its slot
(`1000`→1, `3100`→13, `1030`→301). The defaults below come from the first preset
decoded that way and checked against the manual screenshots. Third, eleven of
the eighteen offer tempo sync (Free / Host / Plug / UDT, plus note value and
multiplier). The rack has no tempo source, so every spec below uses
milliseconds or hertz, and sync is one open question for the whole batch, not
one per effect. Of the eighteen, 2 map onto existing effects, 5 extend an
existing or planned effect, and 11 are new. Two of the new ones, Long Stereo
Delay and Very Long Delay, share one ShapeKind.

| Effect | Here | Shared-panel pad pair (X / Y) |
| --- | --- | --- |
| Feedback Network | New `FeedbackNetwork` | `delayScale` / `fbGain` |
| LongStereoDelay | New `LongDelay` | `delayMs` / `feedback` |
| Sizzle Delays | Adjust planned Multi Delay | `delay1Ms` / `delay2Ms` |
| Space Echo | New `TapeEcho` | `delayMs` / `feedback` |
| TapNet | New `TapNet` | `timeScale` / `fbScale` |
| Tapped Delay | New `TappedDelay` | `delayMs` / `feedback` |
| Very Long Delay | New `LongDelay` (shared with LongStereoDelay) | `delayMs` / `feedback` |
| Chamberverb | New `Chamberverb` | `cutoffHz` / `reverb` |
| Rough Reverb | Exists — Schroeder reverb | `wet` / `decay` |
| Chorus x2 | New `ChorusX2` | `crossoverHz` / `hiDepthMs` |
| Flange-o-tron | New `StepFlanger` | `stepMs` / `glideMs` |
| Jet | Adjust Flanger | `rateHz` / `depthMs` |
| Phase Shifter | Exists — Phaser | `rateHz` / `depth` |
| Swirl | New `Swirl` | `delayRMs` / `rateRHz` |
| Swish | New `Swish` | `lfo1Hz` / `q1` |
| Tremellow | Adjust planned Tremolo | `rateHz` / `depth` |
| Vibrato Cauldron | Adjust All-pass diffuser | `modRateHz` / `modDepthMs` |
| Warble | Adjust Vibrato (mod-delay family) | `rateHz` / `depthMs` |

**Batch-wide decisions.**

- **Tempo sync.** Wherever an original had a sync mode, it is listed under
  *Original interface*. It is left out of the ParamSpec tables (see the open
  question at the end).
- **Randomize buttons are seeds.** Feedback Network, TapNet and Tapped Delay
  each have a button that scrambles values. Here a button is a `seed` control,
  which works the way the PN noise `seed` already does. Clicking it advances the
  seed by one, and the values follow from the seed. That keeps renders
  reproducible and lets automation record a randomization as a single step.
- **Shared LFO shape.** Jet and Warble both need an LFO shape. It is added once,
  to the mod-delay family (`MOD_DELAY_SPECS`, `FLANGER_SPECS`, `VIBRATO_SPECS`).
  It goes at the end of each table, so existing slots keep their order, and its
  default is sine, which is what the family plays today
  (`dattorro.rs` ≈ line 640: `phase.sin()`).
- **Plans not yet built.** Changes to the planned effects (Multi Delay, Tremolo)
  amend HYPERPRISM.md. Nothing that ships changes meaning.

---

### Feedback Network
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 60–62, img p060-0; params/presets/choices; ui.txt; patch.txt (readable)*

Five feedback units, each a random delay feeding a bandpass filter and a
clipper, all patched into each other at random levels. You do not set the
network directly. You press Randomize, or let it re-randomize on a timer. An
auto-feedback rider keeps the whole system hovering just at self-oscillation.
It is a generative noise and drone machine more than a delay.

**Original interface.** A custom panel about 391×229, drawn on the background
picture `fb.pict` at 169,106. All the controls are thin vertical sliders 96–112
px tall, in a single row from y 162, and read left to right in five
colour-coded groups: input-level randomizer (grey/teal), five unit input gains
(striped teal), the feedback group (blue), filter and delay scaling
(orange/red), network randomize (pink), and output (peach). Each group has
small icon labels underneath. There is no text on the panel. The labels below
come from the patch's `hint` objects.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Smooth Auto-Randomize | toggle | off/on | on | 207,149 (13×13) · in-levels |
| Randomize In Levels Rate | slider | 0–127 (period = ((127−x)/2)² + 50 ms) | 89 | 207,162 (13×96) · in-levels |
| Randomize In Levels on/off | toggle | off/on | on | 207,274 · in-levels |
| Input 1–5 Level | gain slider ×5 | 0–157 steps; manual −76 to +18 dB | 124, 120, 126, 142, 150 | 230/243/256/269/282,162 (13×90) · inputs |
| In Levels Min / Max | range slider | 0–127 each | 70 / 110 | 295,162 (13×112) · inputs |
| Feedback Output | slider | 0–127 (gain x/127) | 0 | 318,162 · feedback |
| Feedback Gain | slider | 0–127 (gain x/25) | 0 | 331,162 · feedback |
| Auto-Feedback Rate | slider | 0–127 | 92 | 344,162 · feedback |
| Auto-Feedback on/off | toggle | off/on | on | 344,274 · feedback |
| Feedback Sensitivity | slider | 0–127 | 58 | 361,162 · feedback |
| Feedback Clipping | slider | 0–127 (threshold (127−x)/25 + 0.1) | 97 | 374,162 · feedback |
| Frequency Scaling | slider | 0–127 (×x/42) | 42 | 398,162 · filter |
| Global Q | slider | 0–127 (Q = (x/10)²) | 21 | 411,162 · filter |
| Delay Scaling | slider | 0–127 (×x/42) | 42 | 435,162 · delay |
| System Randomize Trigger | big round button | bang | — | 459,133 (29×29) · randomize |
| Auto-Randomize Rate | wide slider | 0–127 (period (127−x)² ms, inferred) | 26 | 459,162 (29×96) · randomize |
| Auto-Randomize on/off | wide toggle | off/on | on | 459,274 (29×29) · randomize |
| Wet Level | slider | 0–1 | 0.49 | 498,162 · output |
| Dry Level | slider | 0–1 | 0 | 511,162 · output |
| Presets | menu | 8: Auto-Feedback, Self-Oscillating, Bad Craziness, Low and Slow, Splatterpuss, Metal Machine, Your Little Brother, Scattered Waves | Auto-Feedback | host |

The gain-curve formulas come from the `expr` objects that sit next to each
slider's `pp`. The pairings are by position and have not been traced wire by
wire.

**Signal flow.** Stereo in, mixed to mono at half gain (inferred from the
`*~ 0.5` beside `adc~`). Each of the five units takes the input times its own
input level, plus whatever the other units send it. Inside a unit, a delay line
up to 1 s long is read at a random time (0–1000 ms × delay scale). That feeds a
two-pole resonant bandpass with a random centre, 2^(r/100+5) Hz for r in 0–700,
so 32 Hz to about 4 kHz, times the frequency scale, at the global Q. Then comes
a hard clip at ±threshold. The unit's output goes two ways: to the main output,
and to every unit's input bus at a random gain (0–1) times Feedback Gain. The
five outputs are spread across left and right with fixed weights of 1, ⅔, ⅓ and
0, then scaled by Feedback Output and Wet, and the dry signal is added.

Randomize re-rolls every delay time, centre frequency and send gain. With
Smooth on, the change ramps instead of jumping. Auto-Randomize fires
Randomize on a timer. Randomize In Levels moves the five input levels at random
within the Min–Max window. Auto-Feedback measures the output level against
Sensitivity and nudges the gain up in small steps until it crosses, then backs
it off. Rate sets how often it checks.

One quirk in the decoded patch: in every unit, the fifth send goes to bus 4 a
second time, and nothing ever sends to bus 5. Unit 5 therefore hears only its
direct input and never any feedback.

**Here.** New `FeedbackNetwork`. The 0–127 sliders become their real meanings.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 0.5 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `freqScale` | Frequency scale | 0–3 | 1 | no | x |
| `q` | Q | 0.5–160 | 4.4 | yes | |
| `delayScale` | Delay scale | 0–3 | 1 | no | x |
| `fbOutput` | Feedback output | 0–1 | 0 | no | |
| `fbGain` | Feedback gain | 0–5 | 0 | no | x |
| `autoFeedback` | Auto-feedback | 0/1 | 1 | no | |
| `autoFbRate` | Auto-feedback rate | 0–1 | 0.72 | no | |
| `sensitivity` | Sensitivity | 0–1 | 0.46 | no | |
| `clip` | Clip threshold | 0.1–5.2 | 1.3 | yes | |
| `seed` | Randomize | 1–16777215 | 1 | no | |
| `autoRandom` | Auto-randomize | 0/1 | 1 | no | |
| `autoRandomS` | Randomize every | 0.05–16 | 10 | yes | s |
| `smooth` | Smooth | 0/1 | 1 | no | |
| `inRandom` | Randomize inputs | 0/1 | 1 | no | |
| `inRandomS` | Input change every | 0.05–4 | 0.6 | yes | s |
| `inMinDb` / `inMaxDb` | Input min / max | −76 to 18 | −20 / 0 | no | dB |
| `in1Db` … `in5Db` | Input 1–5 | −76 to 18 | −6 | no | dB |

**Shared panel.** The groups follow the original, left to right. Inputs: five
slim sliders, with a range slider for Min/Max beside them and the
Randomize-inputs switch and rate. Feedback: output, gain (the primary control),
auto-feedback switch and rate, sensitivity, clip. Network: frequency scale, Q,
delay scale. Randomize: a large button that advances `seed`, with the auto
switch and rate. Output: wet, dry. Each unit's input slider gets a level meter;
the original drew none. Prism pad: X `delayScale` 0.25–2, Y `fbGain` 0–3.

**Tests.** With `fbGain` = 0 and `fbOutput` = 0, the output equals `dry` times
the input. The same `seed` gives the same delay times and centre frequencies,
bit for bit, across two renders. With `autoFeedback` on and a silent input, the
output level settles within 6 dB of the sensitivity target, not at zero and not
in runaway. The clip threshold bounds every unit's output.

**Open questions.** Keep the bus-5 quirk, which is part of the original sound,
or wire unit 5 correctly? The original's network timer and input-level timer
run on wall-clock metros. Here they must run off a deterministic clock (sample
time plus seed), or a render will not match playback.

### LongStereoDelay
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 108–111, img p108-0; params/presets/choices; patch encoded (not read)*

A long delay, up to 60 s, with a lot of tone shaping in the feedback loop: a
lowpass, a clipper, vibrato on the delay time, and an optional resonant bandpass
with its own gain and clip. Its parameters are the same as Very Long Delay's,
but it runs two independent lines, one per channel, and a single set of
controls drives both.

**Original interface.** Generic view, 16 rows plus a Tempo/Mode row, in this
order. Values shown are the first preset, *Important Announcement*.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| InputGain | slider | 0–1 | 1 | row 1 |
| MaxDelay | slider | 100–60000 ms (buffer size) | 5910 | row 2 |
| DelayTime | slider | 100–60000 ms | 2430 | row 3 |
| Feedback | slider | 0–100 % | 93 | row 4 |
| CutoffFrequency | slider | 10–20000 Hz | 7489 | row 5 |
| ModFreq | slider | 0–50 Hz | 0.85 | row 6 |
| ModDepth | slider | 0–4 (no unit given) | 0.97 | row 7 |
| ClipLevel | slider | 0–1 | 0.25 | row 8 |
| UseReson | switch | Off/On | On | row 9 |
| ResonIGain | slider | 0–2 | 2 | row 10 |
| ResonCF | slider | 10–18000 Hz | 674 | row 11 |
| ResonQ | slider | 0–500 | 7 | row 12 |
| ResonOGain | slider | 0–4 | 0.4 | row 13 |
| ResonOClip | slider | 0–1 | 0.25 | row 14 |
| DirectLevel | slider | 0–1 | 0 | row 15 |
| DirectDelayLev | slider | 0–1 | 0 | row 16 |
| Tempo/Mode | slider + menu | 1–300 BPM; Free/Host/Plug/UDT; plus Delay Time Mult 0–10 and Delay Time Units 1…64t | Free | row 17 |
| Presets | menu | 21: Important Announcement, One Second Echoes, 1.5 Sec Buildup, Background Cloud, Wah Wah Echoes, Groovy Clipping, All .74! … | | host |

**Signal flow** *(manual and parameters; patch not read)*. The input, times
InputGain, goes into a delay line whose length is set by MaxDelay. The read time
is DelayTime, with a sine vibrato of ModFreq and ModDepth on top. The delayed
signal is lowpassed at Cutoff, then clipped at ClipLevel, and fed back by
Feedback %. When UseReson is on, a resonant bandpass with input gain, centre, Q,
output gain and output clip sits in the loop as well. The manual says that if
either reson gain is 0 the loop goes silent, which puts the bandpass in series
in the loop rather than beside it (inferred). The output is the processed loop
signal, plus DirectLevel of the dry input, plus DirectDelayLev of the raw
delayed signal. The two channels are independent lines with identical settings.
Every preset has DirectLevel at 0, so it is built as a send effect.

**Here.** New `LongDelay`. One ShapeKind serves both this and Very Long Delay.
Every rack effect already runs a line per channel, which is this plug-in's
stereo behaviour; Very Long Delay is the same effect on a mono file. It is not
Echo with a wider range: stretching Echo's `delayMs` to 60 s would change what
every saved Echo lane means, because lanes store units (0–1) and `resolve` maps
them through the range. MaxDelay is not carried over. The buffer is sized to the
range's maximum at the first `prepare`, and the original's pause on reallocation
goes with it.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `inputGain` | Input | 0–1 | 1 | no | |
| `delayMs` | Delay | 1–60000 | 1000 | yes | ms |
| `feedback` | Feedback | 0–1 | 0.5 | no | |
| `lowpassHz` | Lowpass | 10–20000 | 20000 | yes | Hz |
| `modHz` | Vibrato rate | 0–50 | 0 | no | Hz |
| `modDepth` | Vibrato depth | 0–4 | 0 | no | ms |
| `clip` | Clip | 0–1 | 1 | no | |
| `reson` | Bandpass | 0/1 | 0 | no | |
| `resonInGain` | Bandpass in | 0–2 | 1 | no | |
| `resonHz` | Bandpass centre | 10–18000 | 674 | yes | Hz |
| `resonQ` | Bandpass Q | 0.5–500 | 7 | yes | |
| `resonOutGain` | Bandpass out | 0–4 | 0.4 | no | |
| `resonClip` | Bandpass clip | 0–1 | 1 | no | |
| `dry` | Direct | 0–1 | 0 | no | |
| `delayDirect` | Raw delay | 0–1 | 0 | no | |
| `glideMs` | Glide | 0–4000 | 220 | no | ms |

`glideMs` is not in the original. It is Echo's travelling read pointer, needed
so that a moving `delayMs` does not click. At 0 it jumps, as the original did.

**Shared panel.** Delay group: `delayMs` (primary, a large dial with a
seconds/ms readout), `feedback`, `inputGain`, `glideMs`. Tone group: `lowpassHz`,
`clip`, vibrato rate and depth. Bandpass group, shown dimmed while the switch is
off: switch, in, centre, Q, out, clip. Output group: `dry`, `delayDirect`. No
display. Prism pad: X `delayMs` 100–3000 ms, Y `feedback` 0–0.98.

**Tests.** An impulse comes back at `delayMs` within one sample, at 1000 ms and
at 45 000 ms. With `reson` on and `resonInGain` = 0, the second repeat is
silent. With `clip` = 0.25 and `feedback` = 0.93, no sample of the loop goes
past ±0.25. Left and right stay independent: an impulse on the left only never
shows up on the right.

**Open questions.** ModDepth's unit is not documented. Milliseconds is
inferred.

### Sizzle Delays
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual p. 189, img p189-0 (matches the first preset); params/presets; patch encoded (not read)*

Two short delays fed back crosswise, left into right and right into left, with a
highpass in each feedback path. The repeats get thinner and brighter every time
round. With short times and high feedback it works as an exciter. The manual
mentions clipping inside the loop.

**Original interface.** Generic view, 8 rows. Defaults are the first preset,
*Sizzle*.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–2 | 2 | row 1 |
| Dry Level | slider | 0–1 | 0.9 | row 2 |
| Left -> Right Delay | slider | 1–1000 ms | 150 | row 3 |
| Right -> Left Delay | slider | 1–1000 ms | 195 | row 4 |
| Left HPF Cutoff | slider | 20–20000 Hz | 15130 | row 5 |
| Right HPF Cutoff | slider | 20–20000 Hz | 15130 | row 6 |
| Left Feedback | slider | 0–1 | 0.69 | row 7 |
| Right Feedback | slider | 0–1 | 0.69 | row 8 |
| Presets | menu | 8: Sizzle, Subtle Exciter, High Delays, Bouncing Sizzles, Rhythmic Insects, Verbish, Electrified, Soaking Wet | | host |

**Signal flow** *(manual; patch not read)*. Stereo in. Each channel feeds its
own delay. The left delay's output is highpassed and scaled by Left Feedback,
then fed into the right delay, and the right does the same into the left. The
loop clips (the level is not exposed). The output is the delay outputs times
Wet, plus Dry. Whether the clipper sits before or after the highpass is not
documented.

**Here.** Adjust the **planned Multi Delay** (HYPERPRISM.md), which is not built
yet: two taps, panned apart. Sizzle needs four things the plan lacks:
cross-feedback, a highpass in each loop, separate feedback per tap, and a loop
clipper. Add these, and widen `wet` to 0–2:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `feedback1` | Feedback 1 | 0–0.98 | 0.3 | no | |
| `feedback2` | Feedback 2 | 0–0.98 | 0.3 | no | |
| `cross` | Cross-feed | 0–1 | 0 | no | |
| `lowCut1Hz` | Low cut 1 | 20–20000 | 20 | yes | Hz |
| `lowCut2Hz` | Low cut 2 | 20–20000 | 20 | yes | Hz |
| `saturate` | Loop clip | 0/1 | 0 | no | |
| `wet` | Wet | 0–2 | 0.5 | no | |

`feedback1` and `feedback2` replace the plan's single `feedback`. At `cross` = 0
each tap feeds itself, which is the plan's behaviour. At 1, tap 1 feeds tap 2
and tap 2 feeds tap 1, which is Sizzle's. A Sizzle preset sets `cross` 1,
`spread` 1 and `saturate` 1. The plan's 1–2000 ms already covers Sizzle's
1–1000 ms.

**Shared panel.** Taps group, in two columns (1 = left, 2 = right): delay, low
cut, feedback. Then `cross`, `spread` and `saturate`. Output: `wet`, `dry`. Keep
the plan's pad pair, X `delay1Ms` / Y `delay2Ms`, both 1–1000 ms.

**Tests.** With `cross` = 1 and an impulse on the left only, the first repeat
appears on the right at `delay1Ms` and the second on the left at `delay1Ms` +
`delay2Ms`. With `lowCut1Hz` = 5 kHz, a 200 Hz sine dies away by at least 30 dB
per pass. With `saturate` on, the loop never goes past ±1 at feedback 0.98.

### Space Echo
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 193–194, img p193-0; params/presets/choices; patch encoded (not read)*

A tape echo modelled loosely on the Roland RE-201: a delay with saturation in
the feedback, a band-limited output, a reverb beside it, and tape-speed effects.
Warble is a randomly wandering speed. Inertia is how slowly the speed follows a
new setting. Both can be pushed far beyond what a working machine does.

**Original interface.** A custom panel of about 264×119. Reading left to
right: a column of three yellow-striped vertical sliders between two dark
level bars; three large knobs in the middle, each with a number box under it;
two horizontal pink sliders below the knobs; a bottom row with tempo, sync menu,
note menu and multiplier; and on the right a column of four pink vertical
sliders. Icons stand in for labels. The defaults are the *Default* preset.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Input / output level | bar meters ×2 | — | — | left edge and right of yellow sliders (↑ and ↓ icons) |
| Dry Mix | vertical slider | 0–157 (gain steps) | 0 | left column (│ icon) |
| Echo Mix | vertical slider | 0–157 | 130 | left column (dotted icon) |
| Reverb Mix | vertical slider | 0–157 | 105 | left column (dense-lines icon) |
| Tape Speed ("Time") | knob + number | 0–1; box shows the delay, e.g. "500." ms | 0.25 | centre, knob 1 (dots icon) |
| Feedback | knob + number | 0–1; box shows 1.4237 (meaning not documented) | 0.47 | centre, knob 2 (loop icon) |
| Clip | knob + number | 0–1; box shows 1.2542 (meaning not documented) | 0.63 | centre, knob 3 (squiggle icon) |
| Lowpass | slider | 0–127 | 41 | inferred: right column (curve icon) |
| Highpass | slider | 0–127 | 12 | inferred: horizontal slider |
| Reverb (decay) | slider | 0–127 | 36 | inferred: right column (dense-lines icon) |
| Warble Speed | slider | 0–127 | 43 | inferred: right column (wavy icon) |
| Warble Amount | slider | 0–127 | 15 | inferred: right column (stacked-wave icon) |
| Inertia | slider | 0–127 | 43 | inferred: horizontal slider |
| Sync Source | menu | UDT / Host / Plug | UDT | bottom row |
| Tempo | number | 1–300 BPM | 120 (screenshot) | bottom row |
| Sync Note Value | menu | 1 … 1/64t | 1/4 | bottom row |
| Sync Multiplier | number | 0.01–75 | 1 | bottom row |
| Presets | menu | 8: Default, All Over the Place, Quick Echoes, Bass Spasm, EchoFlecks, Dirty Heads, Don't Break the Tape, Long Decay | | host |

The panel has twelve continuous controls and twelve continuous parameters, so
the count matches. Which icon belongs to which of the last six, though, is a
reading of the icons. The panel does not label them.

**Signal flow** *(manual; patch not read)*. Mono in, mono out. The base delay
comes from tempo × note value × multiplier, and the Time/tape-speed control
then changes the actual delay by changing the virtual tape speed. Warble adds a
smoothed random wander to that speed at Warble Speed and Warble Amount. Inertia
slews the speed toward its target, so every change bends the pitch of the
repeats, as on tape. The feedback path clips, with Clip setting how hard. The
echo output goes through a lowpass and a highpass. A reverb with its own decay
runs in parallel. Dry, echo and reverb each have their own level on a gain~
scale.

**Here.** New `TapeEcho`. It reuses Echo's delay with the travelling read
pointer (Echo's `glideMs` is tape inertia) and the Schroeder core for the
reverb. A rack chain of Echo → Schroeder would put the reverb after the echo,
not beside it.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `delayMs` | Delay | 10–2000 | 500 | yes | ms |
| `feedback` | Feedback | 0–1.1 | 0.47 | no | |
| `drive` | Saturation | 0–1 | 0.63 | no | |
| `inertiaMs` | Inertia | 0–4000 | 400 | no | ms |
| `warbleHz` | Warble rate | 0.05–20 | 2 | yes | Hz |
| `warble` | Warble depth | 0–1 | 0.12 | no | |
| `lowpassHz` | Lowpass | 500–20000 | 4000 | yes | Hz |
| `highpassHz` | Highpass | 20–2000 | 80 | yes | Hz |
| `reverbDecay` | Reverb decay | 0–0.98 | 0.6 | no | |
| `dryDb` | Dry | −70 to 6 | 0 | no | dB |
| `echoDb` | Echo | −70 to 6 | −3 | no | dB |
| `reverbDb` | Reverb | −70 to 6 | −8 | no | dB |

Feedback runs a little past 1 because the saturator holds runaway repeats in
check, as tape does. That is inferred from the Clip control and the "Don't
Break the Tape" preset.

**Shared panel.** Laid out like the original. Mix column: dry, echo, reverb,
with input and output meters. Tape group of three dials: delay (primary, ms
readout), feedback, saturation. Below them: inertia. Colour column: lowpass,
highpass, warble rate, warble depth, reverb decay. Displays: the two meters.
Prism pad: X `delayMs` 50–1000 ms, Y `feedback` 0–1.

**Tests.** With `warble` = 0 and `inertiaMs` = 0, an impulse repeats at exactly
`delayMs`. Moving `delayMs` from 300 to 600 with `inertiaMs` = 1000 makes the
repeat spacing glide over about a second with no step. With `feedback` = 1.1
and `drive` = 1, the output stays bounded below 0 dBFS. With `reverbDb` = −70,
the output is the dry plus the echo only.

**Open questions.** How does Time (tape speed) combine with the sync-derived
time? Does it scale it or replace it? The two number boxes under Feedback and
Clip (1.4237, 1.2542) are undocumented.

### TapNet
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 211–218, img p211-0 (global), p213-0 (details), p214–p216 (generic); params/presets/choices; patch encoded (not read)*

Four delay taps in which every tap feeds back into every tap, itself included,
through a 4×4 matrix of feedback amounts. Each tap also has its own sine
modulator for chorus and pitch effects. Two Randomize buttons scramble the
times and the matrix. In tempo modes the times are drawn from note values, so a
randomization stays in time.

**Original interface.** Three views. *Global* (385×411): the title at the top,
then two large round buttons labelled TIME and FEEDBACK joined by
"RANDOMIZE", a SCALE knob under each (with number boxes 1. and 0.3517), the
sync menu (UDT) and tempo (119.9999) labelled TEMPO, and a wide bar along the
bottom (unlabelled; inferred to be wet/dry or a meter). *Details* (385×411):
four node circles at the corners. Each shows its delay in ms and its note
value, with three stacked number boxes (mod amount, speed, duck). Arrows
between the nodes carry the 16 feedback percentages, with self-loops at the
corners. A small link toggle sits at the top centre. *Eggslider*: the generic
list, over three pages. Defaults are the first preset, *tempo patter*.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–1 (manual −70 to +18 dB) | 1 | generic row 1 |
| Dry Level | slider | 0–1 (manual −70 to +18 dB) | 0 | generic row 2 |
| Delay Time Scale | knob | 0–5 × | 1 | global, left SCALE |
| Feedback Scale | knob | 0–1 | 0.3517 | global, right SCALE |
| Random Delays | big button | bang | — | global, TIME |
| Random Feedback | big button | bang | — | global, FEEDBACK |
| Link Delays 1/2 | toggle | off/on (set automatically in host sync) | off | details, top centre |
| Global Tempo / sync | number + menu | 1–300 BPM; Free/Host/Plug/UDT | 120, UDT | global, centre |
| Delay 1–4 Time | number (+ note menu in sync) | 1–2000 ms (manual: 0–1000); mult 0–1; note 1…64t | 1/8t, 1/2t, 16., 1/2t | details, node circles |
| Delay 1–4 Mod Amount | number | ±1000 "units" (manual ±100 ms) | 0 | details, top box per node |
| Delay 1–4 Mod Speed | number | 0–500 Hz | 0 | details, middle box |
| Delay 1–4 Mod Duck | number | 0–100 (manual 3–100 %) | 3 | details, bottom box |
| Feedback i->j (16) | number on arrow | 0–100 % | 1→1 76, 1→2 36, 1→3 61, 1→4 14, 2→1 61, 2→2 47, 2→3 50, 2→4 95, 3→1 16, 3→2 20, 3→3 6, 3→4 79, 4→1 5, 4→2 34, 4→3 12, 4→4 98 | details, arrows |
| Presets | menu | 32: tempo patter, metal insects, moving chorus, pitch scrunch, just 4 delays, indra's net, net of jewels … | | host |

The published list labels all four times "Delay 1 Time". That is a bug in the
original's names; they are delays 1–4.

**Signal flow** *(manual; patch not read)*. Left input goes into delay 1 and
right into delay 2. Delays 3 and 4 get signal only through the matrix. Each
delay's read time is its base time × Time Scale, plus a sine of Mod Speed and
Mod Amount (vibrato and chorus; at high speeds it shades into FM-like pitch
effects). Every delay's output is sent to every delay's input at feedback i→j ×
Feedback Scale. Outputs 1 and 3 go to the left, 2 and 4 to the right, times
Wet, plus Dry. Random Delays draws new times (or new note values, in sync
modes, so the taps stay in proportion). Random Feedback draws a new matrix. The
manual itself does not know what Mod Duck does.

**Here.** New `TapNet`. The planned Multi Delay is two taps with one feedback,
and a 4×4 matrix is a different engine, so this does not extend it. It can
share Multi Delay's delay-line code.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 1 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `timeScale` | Time scale | 0.05–5 | 1 | yes | x |
| `fbScale` | Feedback scale | 0–1 | 0.35 | no | |
| `timeSeed` | Randomize time | 1–16777215 | 1 | no | |
| `fbSeed` | Randomize feedback | 1–16777215 | 1 | no | |
| `link12` | Link 1/2 | 0/1 | 0 | no | |
| `delay1Ms` … `delay4Ms` | Delay 1–4 | 1–2000 | 333, 1333, 188, 1333 | yes | ms |
| `mod1Ms` … `mod4Ms` | Mod amount 1–4 | −100 to 100 | 0 | no | ms |
| `mod1Hz` … `mod4Hz` | Mod speed 1–4 | 0–500 | 0 | no | Hz |
| `duck1` … `duck4` | Mod duck 1–4 | 0–1 | 0.03 | no | |
| `fb11` … `fb44` | Feedback i→j (16) | 0–1 | as above / 100 | no | |

`timeSeed` and `fbSeed` write new values into the delay and matrix controls,
as one undoable step. The values are stored as values, so a document does not
depend on the random generator staying the same.

**Shared panel.** Global group: two large Randomize buttons (time and
feedback), each with its scale dial under it (`timeScale` is primary), and wet
and dry. A **network display**: the details view redrawn, four nodes at the
corners with their delay readouts, and 16 arrows whose thickness shows the
feedback amounts. Dragging an arrow edits it. Node groups (×4): delay, mod
amount, mod speed, duck. Matrix group: the 16 feedback values as a 4×4 grid of
small sliders, rows = from, columns = to. Prism pad: X `timeScale` 0.25–2, Y
`fbScale` 0–1.

**Tests.** With the matrix all 0, an impulse on the left appears once at
`delay1Ms` on the left and nowhere else. With only `fb12` = 1 and `fbScale` =
0.5, it comes back on the right at `delay1Ms` + `delay2Ms`, at −6 dB. The same
`timeSeed` gives the same four times. With `fbScale` = 1 and every self-loop at
1, the output stays bounded, because a hard limit in the loop stops runaway.

**Open questions.** What does Mod Duck do? The manual does not know and the
patch is encoded. Here it is treated as reducing the modulation depth while the
tap is loud (inferred). Should the loop limiter be a soft clip, which colours
the sound, or a hard ceiling? The original's behaviour at runaway is not
documented.

### Tapped Delay
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 219–222, img p219-0 (generic), p221-0 (delay view); params/presets; patch encoded (not read)*

A delay line with sixteen equally spaced taps. Each tap has its own level and
stereo position, and the last tap feeds back to the start. Two bar graphs, one
for levels and one for pans, turn the taps into a rhythm. Randomize buttons
re-roll either graph.

**Original interface.** The generic view has four rows plus Tempo/Sync. The
custom *Delay view* (420×218) is the real panel. At the top left is a 16-bar
multislider headed "Delay Tap Levels", with a "*" randomize button, a thin
vertical Feedback slider at its right edge, and tap numbers 2–16 along the
bottom. Under it are a large number box "250" msec, a "÷1" divisor box, and a
"sync time (max: 1000)" checkbox with a readout. In the middle is a 16-row
horizontal multislider headed "Stereo Positions", with "center" and "*"
buttons. At the right are dry and wet vertical sliders with a "0 dB" button.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Delay Tap Levels | multislider, 16 bars | 0–100 % each | preset | delay view, top left |
| Randomize levels | button "*" | — | — | above the level bars |
| Feedback | thin vertical slider | 0–99 % | 0 | right edge of level bars |
| Delay time | number | 1–1000 ms (tap spacing) | 250 (screenshot), 1000 (first preset) | below the level bars |
| Delay-time divisor | number | 1–8 | 1 (screenshot) | beside delay time |
| PluggoSync | checkbox + readout | off/on | off | below |
| Stereo Positions | multislider, 16 rows | left–right | preset | delay view, centre |
| Center / Randomize pans | buttons | — | — | under stereo positions |
| Dry | vertical slider | −70 to +18 dB | 0 dB | right |
| Wet (Delay Level) | vertical slider | −70 to +18 dB | 0 dB | right |
| 0 dB | button | sets dry and wet to unity | — | beside wet |
| Tempo/Sync | slider + menu | Free/Host/Plug/UDT; mult 0–1; units 1…64t | Free | generic only |
| Presets | menu | 10: 120BPM Eighths, 120BPM 16ths, 120BPM 32nds, Hump, Swell, Fade, Expand & Contract, Ping Pong, Ringy, Comb | | host |

**Signal flow** *(manual; patch not read)*. Mono in, stereo out. The tap
spacing is delay ÷ divisor. Tap k reads at k × spacing, for k = 1…16, so the
longest tap is 16 s. Each tap is scaled by its level and panned by its
position, and the taps are summed per side and scaled by Wet. The sixteenth tap
feeds back to the input by Feedback. Dry is added. The PluggoSync box replaces
the delay time with PluggoSync's interval.

**Here.** New `TappedDelay`. The 16 levels and 16 pans are plain keys, so
automation and the pad can reach each one.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `delayMs` | Delay | 1–1000 | 250 | yes | ms |
| `divisor` | Divide by | 1–8 | 1 | no | |
| `feedback` | Feedback | 0–0.99 | 0 | no | |
| `dryDb` | Dry | −70 to 18 | 0 | no | dB |
| `wetDb` | Wet | −70 to 18 | 0 | no | dB |
| `level1` … `level16` | Tap 1–16 level | 0–1 | 1 | no | |
| `pan1` … `pan16` | Tap 1–16 pan | −1 to 1 | 0 | no | |
| `seed` | Randomize | 1–16777215 | 1 | no | |

**Shared panel.** The original's two graphs come first. Tap levels are 16
vertical bars, with randomize ("*") above them and `feedback` as a thin slider
at the right edge. Pans are 16 horizontal bars, with *center* and randomize
under them. This needs a **bar-group** control: a run of same-range sliders
drawn as one multislider and stored as separate keys. Timing group: `delayMs`
(primary), `divisor`. Output: dry, wet, and a 0 dB button. Prism pad: X
`delayMs` 50–1000 ms, Y `feedback` 0–0.95.

**Tests.** With only `level4` = 1, `delayMs` = 100 and `divisor` = 2, an
impulse comes back once, at 200 ms. With `pan4` = −1 it is on the left only.
With `feedback` = 0.5 and only tap 16 on, the repeats come every 16 × spacing
and fall by 6 dB each time. Center sets all 16 pans to 0.

**Open questions.** The shared control vocabulary has no multislider. Is
"bar group" added to it, or drawn as 16 sliders? Several other Pluggo plug-ins
(Flange-o-tron here) would use it too.

### Very Long Delay
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 226–229, img p226-0; params/presets/choices; patch encoded (not read)*

The mono version of LongStereoDelay. It has one delay line, the same sixteen
controls, and a 30 s maximum instead of 60 s. Everything about its interface
and DSP is as described for LongStereoDelay, apart from the range and the line
count. The manual suggests modulating ResonCF on the *Background Cloud* preset
to move the ambience while leaving the foreground alone.

**Original interface.** Generic view, the same 17 rows as LongStereoDelay.
MaxDelay and DelayTime run 100–30000 ms. In *Important Announcement*, MaxDelay
is 3000 ms and DelayTime is 1263 ms; the other rows match LongStereoDelay's.
Presets: the same 21 names, re-timed for a 3000 ms buffer.

**Signal flow.** As LongStereoDelay, with a single line, mono in and mono out.

**Here.** New `LongDelay`, shared with LongStereoDelay; see the ParamSpec there.
On a mono file the slot runs one line. A Very Long Delay preset keeps
`delayMs` at 30 000 ms or less.

**Shared panel.** As LongStereoDelay. Prism pad: X `delayMs` 100–3000 ms, Y
`feedback` 0–0.98.

**Tests.** As LongStereoDelay. Also: the original *Background Cloud* values
load without clipping, and moving
`resonHz` changes the tail and not the dry signal.

### Chamberverb
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 33–35, img p033-0; params/presets/choices; ui.txt (Info view); patch.txt (readable)*

A reverb built only from all-pass filters: Hal Chamberlin's network from
*Musical Applications of Microprocessors*, with an output lowpass, chorus on one
stereo pair, and a "Punch" switch added. Three all-passes in series diffuse the
input, then two parallel pairs of slightly detuned all-passes split it into
left and right. It sounds sparse, metallic and a little old.

**Original interface.** The generic view has 16 rows, with the slider thumbs
coloured by group: gains gold, series stages violet, the first stereo pair
teal, modulation pink, and the second pair violet. An *Info* view draws the
network as a diagram, with each stage's delay and gain in number boxes; these
are the `allpass~` objects and flonums in ui.txt. Defaults are the *Original*
preset (Chamberlin's values).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Direct Gain | slider | 0–1 | 0.66 | row 1 · mix |
| Reverb Gain | slider | 0–1 | 0.19 | row 2 · mix |
| AP1 Delay / Feedback | sliders | 1–200 ms / 0–0.9 | 49.6 / 0.75 | rows 3–4 · series |
| AP2 Delay / Feedback | sliders | 1–200 ms / 0–0.9 | 34.65 / 0.72 | rows 5–6 · series |
| AP3 Delay / Feedback | sliders | 1–200 ms / 0–0.9 | 24.18 / 0.691 | rows 7–8 · series |
| AP4/5 Base Delay / Feedback | sliders | 1–200 ms / 0–0.9 | 17.84 / 0.64 | rows 9–10 · pair A |
| AP4/5 Mod Freq / Depth | sliders | 0–5 Hz / 0–10 | 0 / 0 | rows 11–12 · pair A |
| AP6/7 Delay / Feedback | sliders | 0–200 ms / 0–0.9 | 10.82 / 0.662 | rows 13–14 · pair B |
| Filter Cutoff | slider | 100–20000 Hz | 20000 | row 15 · output |
| Punch | switch | Off/On | Off | row 16 · output |
| Info diagram | display | network with live values | — | Info view |
| Presets | menu | 16: Original, Windy Chorus, Gated Rumble, Talking Drum Chorus, Down the Drain, Rubber Room, Likable Vibrato, Air of Tension, Frayed Silk, Fiasco 16 … | | host |

**Signal flow** *(from the patch)*. Mono in, stereo out. The input runs
through AP1 → AP2 → AP3 in series. AP2 is a separate abstraction whose feedback
sign Punch flips: with Punch on, the inversion is dropped and the low end
builds up. The series output splits. The left side goes AP4 → AP6, the right
side AP5 → AP7, each pair a few hundredths of a millisecond apart. The Info
diagram's stock values are 18.01/17.85 ms and 10.82/10.98 ms; the manual
describes the offsets as 0.15 and 0.14 ms. AP4 and AP5 are built from
`tapin~`/`tapout~`, so their delay can move. A `cycle~` at Mod Freq varies it by
Mod Depth, which gives a chorus inside the reverb. Each side then goes through a
`biquad~` lowpass at Filter Cutoff and is scaled by Reverb Gain. Direct Gain
adds the dry input to both sides; it does not change what feeds the reverb.
Delays and feedbacks are smoothed with `line~`.

**Here.** New `Chamberverb`. The existing All-pass diffuser is one stage with no
stereo split and no modulation. Schroeder is combs plus all-passes, which is a
different structure.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `direct` | Direct | 0–1 | 0.66 | no | |
| `reverb` | Reverb | 0–1 | 0.19 | no | |
| `ap1Ms` / `ap1G` | AP1 delay / gain | 1–200 / 0–0.9 | 49.6 / 0.75 | yes / no | ms / |
| `ap2Ms` / `ap2G` | AP2 delay / gain | 1–200 / 0–0.9 | 34.65 / 0.72 | yes / no | ms / |
| `ap3Ms` / `ap3G` | AP3 delay / gain | 1–200 / 0–0.9 | 24.18 / 0.691 | yes / no | ms / |
| `ap45Ms` / `ap45G` | Pair A delay / gain | 1–200 / 0–0.9 | 17.84 / 0.64 | yes / no | ms / |
| `modHz` | Pair A mod rate | 0–5 | 0 | no | Hz |
| `modDepth` | Pair A mod depth | 0–10 | 0 | no | ms |
| `ap67Ms` / `ap67G` | Pair B delay / gain | 1–200 / 0–0.9 | 10.82 / 0.662 | yes / no | ms / |
| `cutoffHz` | Lowpass | 100–20000 | 20000 | yes | Hz |
| `punch` | Punch | 0/1 | 0 | no | |

The pair offsets stay fixed at +0.16 ms on one side, the Info diagram's
values.

**Shared panel.** Mix group: direct, reverb. Output group: cutoff, punch.
Series group: three delay/gain pairs. Stereo group: pair A (delay, gain, mod
rate, mod depth) and pair B (delay, gain). A **network display** redraws the
Info diagram, with each stage's delay and gain beside its box. Following the
manual's insight, `cutoffHz` and `reverb` come first and are primary. Prism
pad: X `cutoffHz` 1–20 kHz, Y `reverb` 0–0.6.

**Tests.** With every gain at 0, the output is the input times (`direct` +
`reverb`) on both sides, because an all-pass with gain 0 is a pure delay. With
`reverb` = 0, the output is exactly the direct signal. At the Original preset,
an impulse response has the same energy spectrum within ±1 dB at every
frequency, since all-passes are flat, until `cutoffHz` drops below 20 kHz. The
left and right impulse responses differ (correlation below 0.9).

### Rough Reverb
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual p. 178, img p178-0; params/presets; patch encoded (not read)*

A plain three-control reverb that is meant to sound grainy rather than lush.
The two channels are fully independent. Its one character control is "Reverb
Time", 1 ms to 20 s. The manual describes it as the delay time inside the
reverberator.

**Original interface.** Generic view, 3 rows. Defaults are the *Default*
preset.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–1 | 0.12 | row 1 |
| Dry Level | slider | 0–1 | 1 | row 2 |
| Reverb Time | slider | 1–20000 ms | 3000 | row 3 |
| Presets | menu | 8: Default, 5 Seconds, 10 Seconds, 20 Seconds, Dusty, Brillo, Rattling, Waxless | | host |

**Signal flow** *(manual; patch not read)*. Stereo in, stereo out, one
reverberator per channel. The preset names (*5 Seconds* = 5000 ms, *20
Seconds* = 20 000 ms) read Reverb Time as decay time. The algorithm is not
documented.

**Here.** Exists, as the Schroeder reverb. `wet` → `wet` and `dry` → `dry`.
Reverb Time becomes `decay` through the usual relation, g = 10^(−3 · L / RT),
where L is the longest comb loop at the slot's `size`. `diffusion` is set low
(0.3) for the roughness and `spread` is 0, so the channels stay independent.
Those two settings are inferred from "rough" and "independent". Ship this as a
Schroeder preset set named after the eight originals.

**Shared panel.** Schroeder's existing panel. The pad pair stays as
HYPERPRISM gives it for Medium Room Reverb: X `wet` 0–1, Y `decay` 0.5–0.9995.

**Tests.** The *5 Seconds* preset's impulse response falls 60 dB in 5 s
(±15 %). With `spread` = 0, an impulse on the left only produces nothing on the
right.

**Open questions.** If Reverb Time really is a raw delay length (1 ms to 20 s),
as "delay time inside the reverberator" says, this is not a Schroeder at all.
It would be a feedback delay network with very long loops, and it becomes New.
Only the encoded patch would settle that.

### Chorus x2
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 36–37, img p036-0…3; params/presets/choices; patch encoded (not read)*

A two-band chorus. A crossover splits the input into high and low bands, and
each band gets its own modulated delay with rate, depth, randomness, feedback
and level. A polarity switch per band inverts the right side for width.
Delays up to 500 ms take it from chorus into doubling and slapback.

**Original interface.** Generic view, 16 rows: crossover first, then the high
band's seven rows, the low band's seven, and dry. Defaults are the first
preset, *Bass Chorus*.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Crossover Frequency | slider | 50–5000 Hz | 1950 | row 1 |
| Hi Band Delay | slider | 0–500 ms | 36 | row 2 · high |
| Hi Band Mod Rate | slider | 0–10 Hz | 0.8 | row 3 · high |
| Hi Band Mod Depth | slider | 0–10 ms | 5 | row 4 · high |
| Hi Band Mod Randomness | slider | 0–1 | 0.64 | row 5 · high |
| Hi Band Mod Polarity | menu | Parallel / Inverted | Parallel | row 6 · high |
| Hi Band Feedback | slider | −99 to 99 % | 15 | row 7 · high |
| Hi Band Level | slider | 0–1 | 1 | row 8 · high |
| Lo Band Delay … Level | 7 rows as above | same | 24, 1 Hz, 4.9, 0.67, Inverted, 5 %, 0 | rows 9–15 · low |
| Dry Level | slider | 0–1 | 0.99 | row 16 |
| Presets | menu | 10: Bass Chorus, Double Highs, Insectile, Dark Murk, Delays x2, Double-wide Chorus, Thin Delay, Whispers in my Head, Voices in my Head, Make It Stop | | host |

**Signal flow** *(manual; patch not read)*. Stereo in, stereo out. A crossover
at Crossover Frequency splits the signal. In each band a delay is swept by an
LFO at Rate and Depth, with Randomness mixing in a random component (inferred:
the rate or shape wanders). The band has its own feedback of ±99 %. The band's
delayed signal goes to both outputs, and with Polarity on Inverted the right
copy is negated, so the two sides cancel the dry differently and the image
widens. The output is the sum of each band times its level, plus Dry. Mono
compatibility drops when Inverted is on.

**Here.** New `ChorusX2`: two of the mod-delay cores (`MOD_DELAY_SPECS`'s
engine) behind a crossover. Linkwitz–Riley, 4th order, is inferred, so that the
bands sum flat.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `crossoverHz` | Crossover | 50–5000 | 1950 | yes | Hz |
| `hiDelayMs` / `loDelayMs` | Delay | 0.1–500 | 36 / 24 | yes | ms |
| `hiRateHz` / `loRateHz` | Rate | 0.01–10 | 0.8 / 1 | yes | Hz |
| `hiDepthMs` / `loDepthMs` | Depth | 0–10 | 5 / 4.9 | no | ms |
| `hiRandom` / `loRandom` | Randomness | 0–1 | 0.64 / 0.67 | no | |
| `hiInvert` / `loInvert` | Invert right | 0/1 | 0 / 1 | no | |
| `hiFeedback` / `loFeedback` | Feedback | −0.98 to 0.98 | 0.15 / 0.05 | no | |
| `hiLevel` / `loLevel` | Level | 0–1 | 1 / 0 | no | |
| `dry` | Dry | 0–1 | 0.99 | no | |

The randomness is a seeded noise source, so that renders repeat.

**Shared panel.** A crossover dial at the top (primary), with a small display
of the two-band split. Then two identical columns, High and Low, each with
delay, rate, depth, randomness, feedback (a bipolar dial with its centre
detent, as the manual describes), invert, and level. Dry at the bottom.
Prism pad: X `crossoverHz` 100–5000 Hz, Y `hiDepthMs` 0–10 ms.

**Tests.** With both depths at 0, both feedbacks at 0, both delays equal and
both levels at 1, the bands sum to the input delayed (flat within 0.5 dB). With
`hiLevel` = 0, nothing above about 2 × the crossover appears in the wet signal.
With `hiInvert` = 1, the high band's right channel is the negated left. Two
renders with the same settings are bit-identical.

### Flange-o-tron
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 68–70, img p068-0; params/presets/choices; patch encoded (not read)*

A flanger with no LFO. Two 16-step sequencers drive it instead, one for delay
time and one for feedback, and Glide smooths the steps. With glide it is a
shapeable sweep. Without glide it jumps between combs in rhythm, and raising
feedback on chosen steps accents chosen beats.

**Original interface.** A custom panel of 396×385 with magenta labels. At the
top is the **delay** multislider: 16 magenta bars, with a thin slider at its
right edge (inferred to be the min/max delay range). Under it is a row of 16
step lights (the current step lit red) and a row of 16 checkboxes; the checked
box marks the last step and sets # of Steps. Then the **feedback** multislider:
16 green bars. Along the bottom: a *sync* menu (UDT), a *reset* button with a
Bar Reset toggle, a *note* menu (1/4), a tempo box (120.), and three knobs:
*tempo*, *glide* and *volume*. The title "flange-o-tron / sequenced flanger"
runs down the right side.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Delay steps | multislider, 16 bars | min–max delay | hump (rises to step 8, falls) | top |
| Min. / Max. Delay Time | slider (range) | 0–20 ms each | decoded 6 / 0 (see note) | right edge of delay bars (inferred) |
| Step lights | display, 16 | current step | — | between the graphs |
| # of Steps | 16 checkboxes | 1–16 | 16 | between the graphs |
| Feedback steps | multislider, 16 bars | 0–max (range not documented) | ≈ 0.47 on every step | middle |
| Sync | menu | Host / PluggoSync / UDT (manual also lists Free) | UDT (screenshot) | bottom left |
| Bar Reset | button + toggle | off/on | off | bottom left |
| Note value | menu | 1/1 … 1/32 (manual elsewhere: to 1/64t) | 1/4 | bottom left |
| Tempo | number + knob | 10–240 BPM | 120 | bottom |
| Glide | knob | 0–500 ms | 449 | bottom |
| Volume (Gain) | knob | −12 to +12 dB | decoded −9 | bottom |
| Presets | menu | 9: Basic Flanger, Stepped Flanging, Down, Up, Ringy Steps, Kinda Goofy, Kinda Queasy, Mechanismo, Swell Flange | | host |

Note: this preset record holds 48 values, the two 16-step tables among them, and
the slot order was inferred from the shapes. Glide, # of Steps and the two
step shapes match the screenshot. The decoded min/max (6 ms and 0 ms) and gain
(−9 dB) could not be checked against anything.

**Signal flow** *(manual; patch not read)*. Mono in, mono out. A step clock
runs at tempo × note value and advances through # of Steps steps, resetting at
the bar when Bar Reset is on. Each step sets a target delay, a position between
Min and Max Delay, and a target feedback. Both move to their targets over Glide
ms. The delay with feedback is a flanger. The manual implies the classic
equal mix of dry and delayed. Gain is applied at the output.

**Here.** New `StepFlanger`, using the Flanger's delay core. Sequencing
`delayMs` and `feedback` with two automation *Steps* modulators would get
close, but Steps has no glide, and the steps would live in the document's
lanes, not in the effect.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `steps` | Steps | 1–16 | 16 | no | |
| `stepMs` | Step length | 10–2000 | 500 | yes | ms |
| `glideMs` | Glide | 0–500 | 450 | no | ms |
| `minMs` | Min delay | 0.05–20 | 0.5 | yes | ms |
| `maxMs` | Max delay | 0.05–20 | 6 | yes | ms |
| `gainDb` | Volume | −12 to 12 | 0 | no | dB |
| `d1` … `d16` | Delay step 1–16 | 0–1 | hump: 0.02 → 0.98 → 0.09 | no | |
| `f1` … `f16` | Feedback step 1–16 | −0.98 to 0.98 | 0.45 | no | |
| `mix` | Mix | 0–1 | 0.5 | no | |

`mix` is not in the original, which mixed at a fixed 50/50 (inferred); the
default keeps that. Feedback is made bipolar to match the rack's Flanger. The
original's polarity is not documented.

**Shared panel.** As the original: the delay bar group (primary) with a
min/max range slider beside it, the row of step lights with a step-count
selector, then the feedback bar group. Bottom row: step length, glide, volume,
mix. Displays: the step lights. Prism pad: X `stepMs` 60–1000 ms, Y `glideMs`
0–500 ms.

**Tests.** With `glideMs` = 0, every step's delay equal and feedback 0, the
output is a fixed comb whose first notch is at 1/(2·delay). With `steps` = 4,
the sequence repeats every 4 × `stepMs`. With `glideMs` = 200, the delay ramps
between steps with no discontinuity in the read position. With `d1`…`d16` all
0, the delay sits at `minMs`.

**Open questions.** It is not certain that the thin slider beside the delay bars
is the min/max range. The feedback steps' range is not documented.

### Jet
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 91–92, img p091-0; params/presets/choices; ui.txt; patch.txt (readable)*

A stomp-box-style flanger with a five-shape LFO, bipolar regeneration, and a
"vintage" EQ in the delay path that copies the frequency response of the
analog delay chip in one well-known hardware flanger. Width at 0 makes it a
static comb tuned by the Manual knob.

**Original interface.** A custom panel of about 420×169: slate blue, white
lowercase labels along the top, Jet / Cycling '74 at the bottom over a
rainbow rule. Six knobs in a row, left to right.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| shape | stepped wave knob, 5 positions | Square, Triangle, Sine, Sawtooth, Ramp | Sine | 10,53 (60×50) |
| speed | knob | 0.01–10 Hz (labels .01 / 10) | 0.31 | 81,57 (40×40) |
| width | knob | 0–100 % | 65 | 147,57 (40×40) |
| manual | knob | 0–1 (manual: 0.5–5 ms) | 0.51 | 226,57 (40×40) |
| regen | knob, bipolar | −99 to +99 % (labels − / +) | 42 | 291,57 (40×40) |
| mix | knob | dry → delay | 0.51 | 352,57 (40×40) |
| Presets | menu | 8: Basic Flanging, Sweep Up, Sweep Down, Flutter, Two-step, Deep Flange, Hollow, 2Much | | host |

**Signal flow** *(from the patch)*. Mono in, stereo out (the same signal on
both sides). The LFO (`phasor~`, with `cycle~` and shaping for the other
waves) picks one of five shapes. It is scaled by width around a centre set by
manual, clipped to ±1, and mapped between a minimum and maximum delay time:
0.01 ms and 4.5 ms in the message boxes, the delay line itself capped at 10 ms.
The delay is a `comb~` with feedback = regen (±0.99). Its delayed path runs
through the *vintageEQ*: a 300 Hz one-pole highpass, then lowpasses at 11 kHz
and 4 kHz, built as `biquad~` sections whose coefficients are worked out from
`dspstate~`. Mix crossfades the dry and delayed signals linearly, so the
centre of the knob gives the deepest notches. Every control is smoothed with
`line~`.

**Here.** Adjust the Flanger. The keys map like this: manual → `delayMs` (0.5 +
4.5 × manual), width → `depthMs` (width × 2.25 ms, inferred from the 4.5 ms
span), speed → `rateHz`, regen → `feedback` (÷100, clamped to ±0.98), mix →
`wet` = mix and `dry` = 1 − mix. Two keys are added at the end of
`FLANGER_SPECS`. The shape key is shared with the rest of the mod-delay family
(see Warble).

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `shape` | LFO shape | 0–4 (sine, triangle, square, ramp up, ramp down) | 0 | no | |
| `vintage` | Vintage tone | 0/1 | 0 | no | |

Both defaults reproduce the Flanger as it is now. `vintage` = 1 puts the 300 Hz
highpass and the 11 kHz and 4 kHz lowpasses in the delayed path. Jet's
"Sawtooth" and "Ramp" are the two ramp directions; which one rises is not
labelled, and ramp up is inferred for Sawtooth.

**Shared panel.** Six dials in the original's order: shape (a stepped dial
with wave icons), rate, depth, delay ("manual", primary), feedback (bipolar,
centre detent), mix. `stereo` and `allpass` go in a collapsed *More* group,
since Jet had neither. Prism pad: the Flanger pair HYPERPRISM already gives,
X `rateHz` / Y `depthMs`.

**Tests.** With `vintage` = 0 and `shape` = 0, the output matches the current
Flanger bit for bit. With `vintage` = 1, `depthMs` = 0 and `feedback` = 0, the
delayed path is 3 dB down near 300 Hz and more than 6 dB down at 10 kHz. With
`shape` = 2 (square), the delay time takes only two values, apart from the
smoothing ramps.

### Phase Shifter
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 144–146, img p144-0; params/presets; patch encoded (not read)*

A stomp-box phaser: a chain of all-pass filters swept by an LFO and mixed with
the dry signal. Unlike the pedals, it lets you set the stage count (1–8), the
centre, the Q, and how far apart the stages sit.

**Original interface.** Generic view, 7 rows plus Tempo/Sync. Defaults are the
*Basic Phaser* preset, matching the screenshot.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Input Gain | slider | −30 to +12 dB | −0.18 dB | row 1 |
| Frequency | slider | 20–15000 Hz | 1020 | row 2 |
| Q | slider | 1–10 | 1.9 | row 3 |
| # of Stages | slider | 1–8 | 5 | row 4 |
| Freq. Spread | slider | 0–12 (displays 1.0 at 0, so a ratio, inferred) | 0 (1.0) | row 5 |
| Mod. Freq. | slider | 0–10 Hz (with mult 0–25 and note value in sync) | 1 | row 6 |
| Mod. Depth | slider | 0–100 % | 30 | row 7 |
| Tempo/Sync | slider + menu | 1–300 BPM; Free/Host/Plug/UDT | Free | row 8 |
| Presets | menu | 8: Basic Phaser, Faster, Wider, Really Slow, Lite, Diffuse, Rudeness, Set Phasers on Stun | | host |

**Signal flow** *(manual; patch not read)*. Mono in, mono out. The input,
after Input Gain, runs through N all-pass stages. Each is tuned around
Frequency, with Spread setting the ratio between neighbouring stages and Q
setting how fast the phase turns. One LFO sweeps all the stage frequencies by
Depth %. The all-pass output is mixed with the dry signal, presumably at equal
level, as a classic phaser does. There is no feedback control.

**Here.** Exists: the Phaser. Frequency → `centreHz` (the Phaser's range,
40–8000 Hz, covers every preset; the original reached 20 Hz–15 kHz). Q →
`resonance` through the pole radius r = exp(−π·f/(Q·fs)). # of Stages →
`notches`; the Phaser's sections are second-order, so one section stands in
for one stage, which is denser than the original by up to 2× (inferred).
Spread → `spread` (ratio, clamped to 1–3). Mod. Freq. → `rateHz`. Mod. Depth →
`sweep`, with 100 % = 2 octaves (inferred). Input Gain → a Gain slot ahead of
it. Dry/wet: `wet` 1, `dry` 1, `depth` 1, `feedback` 0. These mappings become
eight Phaser presets named after the originals.

**Shared panel.** The Phaser's existing panel. The pad keeps its HYPERPRISM
pair, X `rateHz` / Y `depth`.

**Tests.** The *Basic Phaser* preset (centre 1020 Hz, 5 notches, 1 Hz) puts its
lowest notch within a third of an octave of where the original's screenshot
settings would. With `sweep` = 0, the notches do not move.

**Open questions.** Pluggo's stages may be first-order all-passes, which would
make 5 stages about 2–3 notches. The patch is encoded, so this cannot be
checked.

### Swirl
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 206–207, img p206-0; params/presets; patch encoded (not read)*

Mono to stereo, using delay alone: two slowly modulated short delays, one per
side. The tiny, wandering time difference between the ears makes the sound
move around the head. There is deliberately no dry control, because mixing in
the original collapses the image.

**Original interface.** Generic view, 9 rows. Defaults are the first preset,
*Pretty Slow*.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Input Gain | slider | 0–1 | 0.9 | row 1 |
| Left Delay | slider | 0–210 ms | 57 | row 2 · left |
| L Mod Freq | slider | 0–1 Hz | 0.1 | row 3 · left |
| L Mod Depth | slider | 0–4 | 4 | row 4 · left |
| L Feedback | slider | 0–0.9 | 0.2 | row 5 · left |
| Right Delay | slider | 0–210 ms | 57 | row 6 · right |
| R Mod Freq | slider | 0–1 Hz | 0.06 | row 7 · right |
| R Mod Depth | slider | 0–4 | 4 | row 8 · right |
| R Feedback | slider | 0–0.9 | 0.15 | row 9 · right |
| Presets | menu | 16: Pretty Slow, Very Slow, Leisurely, Medium Edge, Sad Vibrato, Walking Around, Strolling, Drunken, Travelling, Snorkeling, Flange?, Plastic 24, So useless … | | host |

**Signal flow** *(manual; patch not read)*. Mono in, times Input Gain, feeds
two delays. Each has its own base time, sine modulation (rate and depth) and
feedback. The right side's feedback is phase-inverted and the left's is not.
Left delay → left out, right delay → right out, with no dry path. Movement
comes from a small difference in base time plus slow modulation. Per the
manual, about 4.5 ms of difference doubles the swirl rate of *Travelling*, and
much more than that pins the image to one side.

**Here.** New `Swirl`. The mod-delay family has one delay, rate and depth for
every channel, with only a phase offset. Swirl needs every setting per side.
It reuses the mod-delay engine, one instance per side.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `inputGain` | Input | 0–1 | 0.9 | no | |
| `delayLMs` / `delayRMs` | Delay L / R | 0.1–210 | 57 / 57 | yes | ms |
| `rateLHz` / `rateRHz` | Rate L / R | 0–1 | 0.1 / 0.06 | no | Hz |
| `depthLMs` / `depthRMs` | Depth L / R | 0–4 | 4 / 4 | no | ms |
| `feedbackL` / `feedbackR` | Feedback L / R | 0–0.9 | 0.2 / 0.15 | no | |

The right loop's inversion is fixed, as in the original.

**Shared panel.** Two columns, Left and Right: delay (primary), rate, depth,
feedback. Input gain above them. A small **position display** traces the
inter-channel delay difference over time, which shows where the sound
"is". Prism pad: X `delayRMs` 0.1–20 ms, Y `rateRHz` 0–1 Hz.

**Tests.** With both depths at 0 and equal delays, left and right outputs are
identical except for the right loop's inverted feedback. With feedback at 0,
they are identical outright. With `delayRMs` − `delayLMs` = 1 ms, the right
channel lags by 1 ms (cross-correlation peak). There is no dry: with all
delays at 0.1 ms and no feedback, the output is the input delayed by
0.1 ms × `inputGain`.

**Open questions.** On a stereo file, does Swirl sum the input to mono first,
as the original's mono input implies, or run each side's own channel? Summing
is closer to the original. The unit of Mod Depth is not documented; ms is
inferred.

### Swish
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 208–210, img p208-0…3; params/presets/choices; patch encoded (not read)*

Four multimode filters and two drawable LFOs. Each filter can follow LFO 1,
LFO 2 or neither, so the sweeps are layered and sometimes rhythmic. The LFO
can be one of four classic shapes or a wave you draw.

**Original interface.** The custom panel is about 513×288, drawn in four
strips. At the top, two identical **LFO modules** side by side. Each has a
horizontal slider across the top, five shape buttons (sine, square, saw up,
saw down, pencil = draw), a pink vertical range slider for min/max, and a large
drawable waveform display. Under each module is a row with two round buttons,
an arrow, a phase number (0), a tempo box (120.00), a sync menu (UDT), a note
menu (1) and a multiplier (1.00). Below the LFOs, four **filter modules** in a
2×2 grid. Each has a purple frequency-response display on its outer side, a
2×3 grid of filter-mode icons, an "lfo:1" / "lfo:2" assignment button, and
three knobs: *freq*, *q*, *gain*. The dry and level controls are not in the
cropped screenshot.

| Control | Type | Range / unit | Default (*Swish*) | Position / group |
| --- | --- | --- | --- | --- |
| Dry Level | slider | 0–1 | 0 | not visible in screenshot |
| Filter 1–4 Level | slider ×4 | 0–1 | 1 | not visible |
| Q (all) / Gain (all) | sliders | 0–1 each; scales the four filters (manual; not published to the host) | — | not visible |
| Filter n Frequency | knob ×4 | 20–15000 Hz (manual 20–20000) | 20 (the LFO does the sweeping) | filter module, *freq* |
| Filter n Q | knob ×4 | 0–5 | 2.48 | filter module, *q* |
| Filter n Gain | knob ×4 | 0–2 | 1 | filter module, *gain* |
| Filter n Mode | icon grid ×4 | lowpass, highpass, low shelf, high shelf, bandpass, notch | 1: LP, 2: BP, 3: HP, 4: notch | filter module |
| Filter n Switch | button ×4 | Off / LFO 1 / LFO 2 | LFO 1, 2, 2, 1 | filter module, *lfo:n* |
| LFO n Waveform | 5 buttons ×2 | sine, square, saw-up, saw-down, draw | sine | LFO module, left |
| LFO n Min / Max | range slider ×2 | 0–127 | LFO 1: 12–127; LFO 2: 0–94 | LFO module, pink |
| LFO n Phase | number ×2 | 0–360° | 0 | LFO module, bottom row |
| LFO n drawn wave | display ×2 | drawable | sine | LFO module, centre |
| LFO n Sync | menu + tempo + note + mult ×2 | UDT/Host/Plug; 1–300 BPM; 1…1/64t; 0.01–75 | UDT, 120, 1, 1.00 | LFO module, bottom row |
| Presets | menu | 8: Swish, Stirred Scoops, Active Bands, Pulsing Bands, Bass Phases, Transformer Rhythms, Bass Gates, Ebb And Flow | | host |

**Signal flow** *(manual; patch not read)*. Stereo in, stereo out. Four
filters run in parallel on the input (inferred from "Filter Level sets the
output level of each filter"). Each has a mode, a frequency, a Q and an
internal gain, and the global Q and Gain scale all four. An assigned LFO
replaces or offsets the filter's frequency, sweeping between Min and Max over
0–127, inferred to be a log-frequency scale. LFO rate comes from tempo × note
× multiplier. Phase sets the start point when the LFO restarts. The filter
outputs times their levels are summed, plus Dry.

**Here.** New `Swish`. The EQ's band modes cover five of the six filter modes
(it has no bandpass), and lane LFO modulators could sweep EQ frequencies.
But the assignment buttons, the drawn waves and the per-module layout belong in
the effect. The filters use `biquad.rs`.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `dry` | Dry | 0–1 | 0 | no | |
| `qScale` / `gainScale` | Q (all) / Gain (all) | 0–1 | 1 / 1 | no | |
| `level1` … `level4` | Level 1–4 | 0–1 | 1 | no | |
| `freq1Hz` … `freq4Hz` | Freq 1–4 | 20–20000 | 500 | yes | Hz |
| `q1` … `q4` | Q 1–4 | 0.1–5 | 2.5 | yes | |
| `gain1` … `gain4` | Gain 1–4 | 0–2 | 1 | no | |
| `mode1` … `mode4` | Mode 1–4 | 0–5 (LP, HP, low shelf, high shelf, BP, notch) | 0, 4, 1, 5 | no | |
| `lfoSel1` … `lfoSel4` | LFO 1–4 | 0–2 (off, LFO 1, LFO 2) | 1, 2, 2, 1 | no | |
| `lfo1Shape` / `lfo2Shape` | LFO shape | 0–4 (sine, square, saw up, saw down, drawn) | 0 | no | |
| `lfo1Hz` / `lfo2Hz` | LFO rate | 0.01–20 | 0.5 / 0.3 | yes | Hz |
| `lfo1Min` / `lfo2Min` | LFO low | 20–20000 | 60 / 20 | yes | Hz |
| `lfo1Max` / `lfo2Max` | LFO high | 20–20000 | 15000 / 3000 | yes | Hz |
| `lfo1Phase` / `lfo2Phase` | LFO phase | 0–360 | 0 | no | ° |

The 0–127 min/max are given in Hz here. The converted defaults are inferred
from a log mapping of 20 Hz–15 kHz.

**Shared panel.** As the original. Two LFO modules on top, each with shape
buttons, a **wave display** that can be drawn on when the shape is *drawn*, a
low/high range slider, rate (primary) and phase. Then four filter modules in a
2×2 grid, each with a **response display**, a mode selector, an LFO selector,
and freq, Q and gain dials. Mix row: dry, four levels, Q (all), Gain (all).
Prism pad: X `lfo1Hz` 0.05–10 Hz, Y `q1` 0.3–5.

**Tests.** With `dry` = 1, every level at 0 and the LFOs on, the output equals
the input. A filter on LFO 1 with a square shape spends half of each cycle at
`lfo1Min` and half at `lfo1Max` (measured by tracking its centroid). Mode 4
(BP) at 1 kHz passes 1 kHz at `gain` and attenuates 100 Hz by more than 20 dB.
With `lfoSel` = 0, `freq` holds still.

**Open questions.** How a drawn wave is stored: a fixed table of 64 or 128
points, either as hidden keys or as a blob in the slot spec. A blob would be
the first non-scalar control in the rack. With an LFO assigned, does the
filter's own Freq still count (as an offset), or does the LFO replace it?

### Tremellow
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 223–225, img p223-0; params/presets; patch encoded (not read)*

An auto-panner whose rate runs from slow sweeps up to 10 kHz, so it also does
AM and ring-mod tones. The waveform morphs from sine to square, and a second
sine can modulate the panning rate itself.

**Original interface.** Generic view, 10 rows plus Tempo/Sync. Defaults are the
*Tremellow* preset, matching the screenshot.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–1 | 1 | row 1 |
| Dry Level | slider | 0–1 | 0 | row 2 |
| Waveform | slider | 0–1 (sine → square) | 0 | row 3 |
| Mod Frequency | slider | 0–1 (× Mod Freq Range) | 0.13 | row 4 |
| Mod Freq Range | slider | 0–1 | 0 | row 5 |
| Mod Amount | slider | 0–1 (× Mod Amt Range) | 0.37 | row 6 |
| Mod Amt Range | slider | 0–1 | 0 | row 7 |
| Coarse Frequency | slider | 0–10000 Hz (note + mult in sync modes) | 9.73 | row 8 |
| Fine Frequency | slider | 0–50 Hz, added to coarse | 0 | row 9 |
| Phase | slider | 0–360° | 0 | row 10 |
| Tempo/Sync | slider + menu | Free/Host/Plug/UDT | Free | row 11 |
| Presets | menu | 8: Tremellow, Rhodes, Amplitude Modulation, AM 2, AM 3, Trmello Cauldron, Sweeper, Very Simple | | host |

**Signal flow** *(manual; patch not read)*. Mono in, stereo out. An LFO at
coarse + fine Hz, with a shape morphing from sine to square, pans the input
between left and right (inferred: equal and opposite gains). A second sine at
Mod Frequency × Range modulates that LFO's rate by Mod Amount × Range, so the
panning speeds up and slows down. Phase offsets the LFO, which only matters
when synced. Output = panned × Wet + input × Dry. At audio rates the panner
becomes amplitude modulation, which the presets *Amplitude Modulation* and
*AM 2/3* use.

**Here.** Adjust the **planned Tremolo** (HYPERPRISM.md), which is not built
yet. Tremellow is that Tremolo with `stereo` = 1 (Auto-Pan), with four
changes: the rate range runs up to audio, the rate itself can be modulated,
there is a phase, and the waveform morphs. Wet/dry maps onto the plan's
`depth`: depth = wet / (wet + dry), inferred. Changes to the plan's table:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `rateHz` | Rate | 0.05–10000 (was 0.05–20) | 4 | yes | Hz |
| `modHz` | Rate wobble | 0–20 | 0 | yes | Hz |
| `modDepth` | Wobble depth | 0–1 | 0 | no | |
| `phaseDeg` | Phase | 0–360 | 0 | no | ° |

Tremellow's waveform (sine → square, 0–1) maps onto the plan's `shape` as
0–1 → 0–2 when the plan's morph goes straight from sine to square. If the plan
morphs through triangle, the midpoints will differ (see open questions). Fine
Frequency is folded into the log `rateHz`. Mod Freq Range and Mod Amt Range
were range-setters for the original's sliders; here the dials' log scaling
does that job.

**Shared panel.** As the plan, plus a *Wobble* group (rate, depth) and
`phaseDeg`. Rate is primary. The dial shows Hz, and in the audio range it adds
the note name. A **wave display** shows one cycle of the current shape. The pad
keeps the plan's pair, X `rateHz` (window 0.1–20 Hz by default) / Y `depth`.

**Tests.** With `stereo` = 1 and `rateHz` = 1, left and right gains are in
antiphase, and their sum is constant within 0.5 dB for a sine shape and
equal-power law. With `rateHz` = 440 and `depth` = 1, a DC input becomes a
440 Hz tone. With `modDepth` = 0, the cycle length is exactly 1/`rateHz`.

**Open questions.** The plan's `shape` runs sine → triangle → square, while
Tremellow's runs sine → square directly. Should the plan's morph go
sine → square for the first half, so that Tremellow's presets land exactly?
Does the original pan with an equal-power or a linear law? Not documented.

### Vibrato Cauldron
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 230–231, img p230-0; params/presets; patch encoded (not read)*

Two all-pass filters whose delay times wander under a smoothed random signal.
A noise source is sampled and held, then run through a very low, resonant
lowpass. The pitch wobbles in a bubbling, irregular way rather than as a
regular vibrato. Long delays and high feedback push it towards blurry
ambience.

**Original interface.** Generic view, 9 rows. Defaults are the first preset,
*Twitchy*, matching the screenshot.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Rate | slider | 0–300 Hz (sample-and-hold rate) | 7 | row 1 |
| Mod Cutoff Freq | slider | 0–4 Hz | 1 | row 2 |
| Mod Resonance | slider | 0–199 | 178 | row 3 |
| Mod Depth | slider | 0–50 ms | 3 | row 4 |
| Feedback | slider | 0–0.99 | 0.61 | row 5 |
| Delay | slider | 0–90 ms | 0 | row 6 |
| LGain | slider | 0–1 | 0.9 | row 7 |
| RGain | slider | 0–1 | 0.9 | row 8 |
| Direct Gain | slider | 0–1 | 0 | row 9 |
| Presets | menu | 24: Twitchy, Funky Pings, Bubbling Over, Something is Wrong, Vocal Smoke, Heavy Seas, Repetitive Ocean, Kitten Vibrato, Log in Throat, Tweezerverb, Plucked Ambience … | | host |

**Signal flow** *(manual; patch not read)*. Mono in, stereo out. A noise
source is sampled at Rate, giving steps, and smoothed by a resonant lowpass at
Mod Cutoff and Mod Resonance; more resonance gives more smoothing, according to
the manual. That signal times Mod Depth moves the delay of two all-pass filters
(base Delay, coefficient Feedback), one per output. The two sides differ
slightly: the manual's *Repetitive Ocean* note shows that each side sees a
different delay at times, so either the noise or the offset is per side
(inferred). The outputs are scaled by LGain and RGain, and Direct is added.

**Here.** Adjust the All-pass diffuser [`delayMs`, `coefficient`, `wet`,
`dry`]. Delay → `delayMs` (0.1–100 covers 0–90). Feedback → `coefficient`.
Direct → `dry`. LGain/RGain → `wet` and a new `balance`. Add a random
modulator, inert by default:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `modRateHz` | Random rate | 0–300 | 0 | no | Hz |
| `modSmoothHz` | Smoothing | 0.05–4 | 1 | yes | Hz |
| `modResonance` | Smoothing resonance | 0–1 | 0.9 | no | |
| `modDepthMs` | Random depth | 0–50 | 0 | no | ms |
| `seed` | Seed | 1–16777215 | 1 | no | |
| `balance` | Balance | −1 to 1 | 0 | no | |

Each channel draws its own noise stream from `seed` + its channel index. That
gives the subtle stereo the manual describes. It is a pure function of sample
time, as the automation modulators are, so a render repeats. Mod Resonance
0–199 rescales to 0–1.

**Shared panel.** All-pass group: delay, coefficient. Random group: rate
(primary), smoothing, resonance, depth, seed. Output: wet, balance, dry. A
small **modulation trace** display shows the last two seconds of the smoothed
random signal. Prism pad: X `modRateHz` 0–30 Hz, Y `modDepthMs` 0–10 ms.

**Tests.** With `modDepthMs` = 0, the output matches today's diffuser bit for
bit. With `modRateHz` = 7 and `modSmoothHz` = 0.1, the modulation signal's
spectrum has less than −40 dB above 2 Hz. The same `seed` gives the same
output twice. With depth > 0, left and right differ.

### Warble
*Pluggo 3.6.1, Cycling '74 · Mac VST · manual pp. 238–240, img p238-0; params/presets/choices; patch encoded (not read)*

A variable-speed playback effect. An LFO, which can be drawn, bends the
playback speed, from a light vibrato through record scratching to chaos. Lag
smooths the speed changes, like portamento. The LFO can be retriggered by hand.

**Original interface.** A custom panel of about 283×151, the same LFO module
as Swish. A horizontal slider runs along the top. Below it, five shape buttons
(sine, square, saw up, saw down, pencil), a vertical range slider (min/max),
and the drawable waveform display. On the right is a tall vertical slider.
Then a row with two round buttons, an arrow, phase (0), tempo (120.), sync
(UDT), note (1/4) and multiplier (4.79). At the bottom, two long horizontal
pink sliders. Defaults are the *Slow Warble* preset.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–1 | 1 | inferred: bottom slider 1 |
| Dry Level | slider | 0–1 | 0 | inferred: bottom slider 2 |
| Warble Range | slider | 0–1 | 0.115 | inferred: tall right slider |
| LFO Speed | slider | 0–1 (unlabelled scale; sync sets the rate) | 0.2 | inferred: top slider |
| LFO Waveform | 5 buttons | sine, square, saw-up, saw-down, draw | sine | module, left |
| LFO Min / Max | range slider | 0–127 | 19 / 111 | module, pink |
| LFO Phase | number | 0–360° | 0 | bottom row |
| LFO Sync | menu + tempo + note + mult | UDT/Host/Plug; 1–300; 1…1/64t; 0.01–75 | UDT, 120, 1/4, 4.79 | bottom row |
| LFO Master | switch | 0/1 (not documented) | 0 | not identified |
| Lag | slider | 0–511 | 203 | not identified |
| Retrigger | round button | bang | — | bottom row |
| Drawn wave | display | drawable | sine | module, centre |
| Presets | menu | 8: Slow Warble, 1 Step Forward..., Auto-Scratch, Technics Power-Down, Robot Scratch, VerFas Scratch, That Cut-In-And-Out Effect, Off In The Weeds | | host |

**Signal flow** *(manual; patch not read)*. Mono in, mono out. Changing the
playback speed in real time is a modulated delay: the read pointer runs ahead
of or behind the write. The LFO output, between Min and Max, times Warble Range
sets the speed deviation. The delay is the running integral of that speed,
inferred, since this is what makes *Technics Power-Down* possible. Lag averages
the speed over 0–511 (unit not given; ms or samples inferred). Retrigger
restarts the LFO at Phase. Output = warbled × Wet + input × Dry.

**Here.** Adjust the Vibrato. Warble Range → `depthMs`. LFO speed → `rateHz`.
Min/Max → the swing window (`delayMs` centre, `depthMs` half-span). Wet/dry
carry over. The mod-delay family (White chorus, Flanger, Vibrato) gains three
keys, appended so existing slots keep their order:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `shape` | LFO shape | 0–4 (sine, triangle, square, ramp up, ramp down) | 0 | no | |
| `lagMs` | Lag | 0–500 | 0 | no | ms |
| `phaseDeg` | LFO phase | 0–360 | 0 | no | ° |

Jet uses the same `shape`. Warble's order (sine, square, saw-up, saw-down)
maps to 0, 2, 3, 4. Lag is a one-pole on the delay time, which bends the pitch
smoothly instead of jumping.

**Shared panel.** As the original: shape buttons, a **wave display**, a range
slider for the swing window, rate (primary), depth, lag, phase, and a
*Retrigger* button that resets the LFO phase. Wet and dry below. Prism pad:
the Vibrato pair from HYPERPRISM, X `rateHz` / Y `depthMs`.

**Tests.** With `shape` = 0, `lagMs` = 0 and `phaseDeg` = 0, the output
matches today's Vibrato bit for bit. With `shape` = 2 (square) and `lagMs` = 0,
the pitch alternates between two values; with `lagMs` = 100, the change between
them takes about 100 ms. Retrigger with `phaseDeg` = 90 starts the delay at its
maximum.

**Open questions.** *Technics Power-Down* (a slowdown to a stop) implies that
speed, not delay, is modulated. Can the mod-delay core do that within a 100 ms
delay range, or does Warble need a longer buffer and a ramping pointer like
Echo's? The drawn wave raises the same storage question as Swish. Lag's unit
and LFO Master's meaning are not documented.

---

## Open questions for the whole batch

- **Tempo sync.** Eleven of these sync to host or PluggoSync tempo. The rack
  has no tempo. Is there a document tempo that effects could read, so that a
  `sync` switch and a note value could sit beside any ms or Hz control? Or is
  sync left to automation?
- **Drawn waveforms.** Swish and Warble need a user-drawn LFO table. The rack
  stores only scalars today.
- **Bar groups.** Tapped Delay and Flange-o-tron (and TapNet's matrix) need a
  multislider-style control in the shared vocabulary.
- **Encoded patches.** Fifteen of the eighteen patches were not read. Wherever
  a section says "inferred", reading the patch would settle it, if decoding it
  is in bounds.
