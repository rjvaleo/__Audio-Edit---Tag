# Pluggo: the oddly named effects, and the modulators

*22 October 2026. Spec — not built. Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md).*

*Pluggo 3.6.1, Cycling '74, 1999–2006 · Max/MSP patches in VST/AU/MAS shells, Mac
OS 9 / X. Batch of 18. Static sources only; no plug-in was run or loaded.*

Nine of these are effects with names that do not say what they do, and nine
are modulators — plug-ins that make no sound and instead move other plug-ins'
parameters. The effects are mostly new rack modules: there is nothing here yet
that drives a delay from a signal's own loudness (Average Injector), swirls a
stereo image with eight randomly drifting gains (Nebula), pans one input
round eight points on a circle (OneByEight), or granulates live input (Rye,
Wheat). Warpoon is a four-voice chorus, and Laverne is a synth, which belongs
with the sequencer rather than the rack. The modulators map onto automation,
not the rack. Three of them are already lane modulators with small gaps (LFO,
Step Sequencer, Randomizer). Breakpoints needs one addition to the LFO — a
drawn cycle. Mouse Mod is the Prism pad. Env Follower and Audio2Control need
the follower that `automation.rs` deliberately left out, and this batch says
how to build it without breaking the pure-function rule. KnaveStories needs
a chaos source. Key Triggers and M2M are live inputs, recorded through Latch,
not modulator kinds.

**Sources.** Only two of the eighteen patches decode to readable Max text:
Average Injector and Nebula. The other sixteen `mxfr` resources are
Max-encrypted (a 22-character alphabet after the `mx@c` header) and were not
decoded, so for those the parameter table (`params.tsv`), the stored programs
(`presets.tsv`), the menus (`choices.txt`), the manual and its screenshots are
everything. Several decoded preset tables do not line up with the
screenshots (Breakpoints, LFO, Randomizer, Step Sequencer, Wheat after its
first program); where they disagree the screenshot is used and the section
says so.

| Effect | Here | Shared-panel pad pair |
| --- | --- | --- |
| Average Injector | New — `AverageInjector` | X Avg time 0.1–500 ms / Y Delay mod −150–150 |
| KnaveStories | New — `Chaos` lane modulator | n/a (runs under a pad path) |
| Laverne | Adjust — the sequencer's voice, not the rack | n/a until the sequencer's controls are targets |
| M2M | New — MIDI input binding (recorded by Latch) | n/a (a hand on a controller, like the pad) |
| Nebula | New — `Nebula` | X Swirl activity 0–1 / Y Depth 0–127 |
| OneByEight | New — `OneByEight` | X Theta 0–1 / Y Radius 0–1 (polar) |
| Rye | New — `GrainDelay` | X Grain period 5–5000 ms / Y Speed −10–10 |
| Warpoon | New — `Warpoon` | X Rate scale 0–2 / Y Depth scale 0–2 |
| Wheat | New — `GrainFreeze` | X Grain size 1–500 ms / Y Pitch −3–5 |
| Audio2Control | New — `Follow` modulator, sample mode | n/a |
| Breakpoints | Adjust — `Lfo` gains a drawn cycle | n/a |
| Control2Audio | Adjust — "Render lane to audio" | n/a |
| Env Follower | New — `Follow` modulator, envelope mode | n/a |
| Key Triggers | Adjust — key-hold bindings; Step points on record | n/a |
| LFO | Adjust — `Lfo` gains a drawn cycle | n/a |
| Mouse Mod | Exists — the Prism pad under Latch | the pad itself |
| Randomizer | Adjust — `SampleHold` gains jitter, slew, distribution | n/a |
| Step Sequencer | Adjust — `Steps` gains glide and sustain | n/a |

## How a Pluggo modulator maps onto a lane

Every Pluggo modulator has the same destination row: **Mode** (Off, Set,
Offset, Scale), **Assign** (plug-in and parameter), **Invert**, a **Range**
bar (low, high, 0–1) and a **Value** readout. Up to three rows per modulator.
Here, a lane already is one destination, and the rules below cover the rest.
They are stated once and every section relies on them.

- **Set** is a lane whose curve is flat at the range's centre, carrying the
  modulator with `depth = (high − low) / 2`. **Offset** is the modulator added
  to whatever curve the lane has, which is what `Lane::value_at` does now.
  **Scale** (multiply) has no equivalent: lanes only add. If wanted, it is one
  lane field, `combine: add | multiply`, applied in `value_at`. Open question.
- **Invert** is a negative `depth`. `mod_from` already accepts −1..1.
- **Several destinations** are the same modulator copied into several lanes.
  Because modulators are pure functions of absolute time, copies stay in step
  exactly; editing one does not update the others. A shared modulator id
  would fix that. Open question.
- **A lane needs a point.** `curve_value` returns `None` for a lane with no
  points, so a modulator on an empty lane does nothing. The modulator editor
  must lay one point at the base value when it adds a modulator to an empty
  lane.
- **There is no modulator editor yet.** Lanes are created with
  `modulators: []` (`app.js` ~6586) and nothing in `ui/` edits them; the server
  parses and plays them. Each "Shared panel" below for a modulator is a
  specification for that editor, opened from the lane's row in the Automation
  dock.
- **Tempo sync** becomes Hz. The document keeps no tempo, so the editor offers
  Tempo (BPM) × note value × multiplier as a calculator and stores only
  `rate`. Pluggo's "Host" and "Plug" sync sources have nothing to follow here.
- **Control rate.** The runner resolves lanes every 8 ms (`TICK_MS`). Anything
  Pluggo did at audio rate, or with a "grain" or "resolution" finer than 8 ms,
  lands on that grid.

---

### Average Injector
*Pluggo 3.6.1, Cycling '74; patch by David Zicarelli, 1999 · VST/MAS · `params.tsv`, `presets.tsv`, decoded `patch.txt`, manual pp. 19–20, screenshot p019-0.*

A delay whose time and level are steered by the signal's own RMS, with the
steered copy subtracted from a plainly delayed copy. Loud passages push the
tap away and change its gain, so a horn line comes out phasey, nasal or
broken up, and short averaging times turn the modulation into grit. The
manual calls the combination arbitrary; it is closest to a flanger whose
sweep is the input's envelope.

**Original interface.** No custom view: the plug-in shows Pluggo's generic
parameter list (screenshot ~352×290: one row per parameter, name, slider,
value; an info strip at the bottom). Rows in parameter order:

| Control | Type | Range / unit | Default (Phasy Breakup) | Position / group |
| --- | --- | --- | --- | --- |
| Input Gain | slider | 0–1 | 0.48 | row 1 |
| Orig Delay | slider | 0–150 ms | 18 ms | row 2 |
| Delay Gain | slider | 0–1 | 0.27 | row 3 |
| Avg Delay | slider | 0–150 ms | 150 ms | row 4 |
| Mod Delay Base | slider | 0–150 ms | 7 ms | row 5 |
| Avg Time | slider | 0–500 ms in the patch; the manual and screen show 1–20 000 samples | 97 ms (screen: "3900 Samples") | row 6 |
| Avg Amp Mod | slider | −25 to 25 | 5 | row 7 |
| Avg Del Mod | slider | −150 to 150 (ms per unit RMS, inferred) | 8 | row 8 |
| Wet Level | slider | 0–1 | 0.5 | row 9 |
| Dry Level | slider | 0–1 | 0 | row 10 |
| Programs | menu | 16 | Phasy Breakup | host menu |

Programs: Phasy Breakup, Nasal Chorus, Mixexpressed Anxiety, Yeah Yeah, Rubber
Stadium, Watery Flange, Polite Twister, Chorus of Flappers, Some Short Echoes,
Punchy Zzzzz, Broken Flanger, Decaying Bub Chor, Unstable Friends, High School
Football, The Phasing Effect, "Bam! Pow! Zap! Check?". Every program sets Wet
0.5 and Dry 0.

**Signal flow.** From the decoded patch:
1. The two inputs are summed to mono. Dry = sum × Dry Level.
2. Wet path: sum × Input Gain into one 500 ms delay line.
3. Three taps read that line. Tap A at Orig Delay is the reference. Tap B at
   Avg Delay feeds an RMS averager whose window is Avg Time (converted from ms
   to samples, capped at 22 100 samples). Tap C's time is a signal:
   `Mod Delay Base + Avg Del Mod × rms`, in ms.
4. Tap C is multiplied by `Delay Gain + Avg Amp Mod × rms`.
5. Wet = (Tap A − scaled Tap C) × Wet Level. Output = Wet + Dry, the same mono
   signal on both outputs.
Every parameter change ramps over 20 ms. There is no feedback. Avg Delay lets
the modulation lead or lag the loudness that causes it.

**Here.** New `ShapeKind::AverageInjector`. Keep it mono-summed, as the
original is; a per-channel option is an open question. Tap C must clamp to
0–500 ms, since `Avg Del Mod` can drive it negative.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `inputGain` | Input gain | 0–1 | 0.48 | no | |
| `origDelayMs` | Original delay | 0–150 | 18 | no | ms |
| `delayGain` | Delay gain | 0–1 | 0.27 | no | |
| `avgDelayMs` | Average delay | 0–150 | 150 | no | ms |
| `modBaseMs` | Mod delay base | 0–150 | 7 | no | ms |
| `avgTimeMs` | Average time | 0.1–500 | 97 | yes | ms |
| `ampMod` | Amp mod | −25–25 | 5 | no | |
| `delMod` | Delay mod | −150–150 | 8 | no | ms |
| `wet` | Wet | 0–1 | 0.5 | no | |
| `dry` | Dry | 0–1 | 0 | no | |

**Shared panel.** Three groups in the original's row order. *Average*
(primary): Average time (dial, primary), Average delay. *Modulation*: Delay
mod, Amp mod, Mod delay base, Delay gain. *Levels*: Input gain, Original
delay, Wet, Dry. Display: a small meter of the RMS value (the patch has one
on the modulated tap). Prism pad: X `avgTimeMs` 0.1–500 ms (log), Y `delMod`
−150–150.

**Tests.**
- With `ampMod` 0, `delMod` 0, `delayGain` 1, `origDelayMs` = `modBaseMs`,
  the wet output is silent (A and C cancel).
- Silence in gives silence out, with no NaN, at `avgTimeMs` at its minimum.
- With `delMod` > 0, a louder steady sine moves tap C later: the measured
  lag between input and tap C grows with input level.
- `wet` 0, `dry` 1 returns the mono sum unchanged.

**Open questions.** The manual's sample range and the patch's ms range for
Avg Time disagree; the patch is followed. Should a stereo source keep its
width (run the effect per channel)?

---

### KnaveStories
*Pluggo 3.6.1, Cycling '74; Gregory Taylor · VST/MAS · `params.tsv`, `presets.tsv`, manual p. 95, screenshot p095-0. Patch encrypted.*

Five modulation outputs, X, Y, Z, C and E, taken from a chaotic solution of
a Navier–Stokes system, so they wander without repeating yet move in
relation to one another. It is a random source with memory and coupling,
which neither an LFO nor a sample-and-hold has.

**Original interface.** One strip, ~414×104. Left to right: a PluggoSync
column (Enable toggle, Source number 1–4); a vertical Rate slider; five
Modulation Parameter menus stacked; five Modulation Value Range bars stacked;
a display of five horizontal tracks labelled X Y Z C E, each with a moving
marker. Bottom row: Start/Stop toggle, Reinitialize button, "Reset all to
full MV Range" button.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| PluggoSync Enable (`PSE`) | toggle | off/on | off | left column |
| PluggoSync Source | number | 1–4 | 1 | left column |
| Rate | vertical slider | 0–1 | 1 | left of menus |
| Modulation Parameter ×5 | menu | any loaded plug-in's parameter | none | centre, one per output |
| Range low/high ×5 (`Xlo`…`Ehi`) | range bar | 0–127 (Y, C, E low limit 1) | full | centre right |
| Output on ×5 (`Xon`…`Eon`) | toggle | off/on | Y and C on | with each row |
| Value display | display | five tracks | — | right |
| Start/Stop (`start`) | toggle | off/on | on | bottom |
| Reinitialize | button | — | — | bottom |
| Reset all to full MV Range | button | — | — | bottom |

Programs: 2 — Default, "For Your Convenience" (X range 0–127, C 0–73, E 0–127).

**Signal flow.** No audio. The manual says the values come from a chaos
object implementing the Navier–Stokes equation, with five outputs. Five
coupled variables matches the Boldrighini–Franceschini five-mode truncation
of Navier–Stokes (inferred): five first-order equations, quadratic coupling
terms, linear damping on each mode and a forcing term (a Reynolds number) on
one. Each tick advances the solution and each enabled output is scaled into
its range and sent. Rate sets how fast it advances (mapping not recoverable).
Reinitialize returns to the starting state; Start/Stop pauses. PluggoSync
clocks the ticks instead of the internal rate.

**Here.** New lane modulator `Modulator::Chaos`. The pure-function rule
holds if the trajectory is a deterministic function of its settings: integrate
from a fixed initial state, on a fixed step, and cache the run per settings
(an `Arc<[f32; 5]>` table at the 8 ms tick, rebuilt when the settings change,
not saved). Each lane picks one variable, so five lanes with the same
settings share one cache and stay coupled — the point of the original.
Normalise each variable by its min and max over a long reference run computed
once, so low/high mean the same in every document. Reinitialize becomes
`startSeconds`: where along the trajectory the document's zero falls.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `output` | Output | 0–4 (X, Y, Z, C, E) | 1 (Y) | no | |
| `rate` | Rate | 0.01–10 | 1 | yes | × |
| `depth` | Depth | −1–1 | 0.5 | no | |
| `offset` | Offset | −1–1 | 0 | no | |
| `startSeconds` | Start at | 0–600 | 0 | no | s |

**Shared panel.** In the modulator editor: Output (menu, X…E), Rate (dial,
primary), Depth, Offset, Start at; a five-track display of all five variables
over the visible timeline with this lane's one highlighted, the original's
display turned on its side. Pad: not a slot control; a Chaos modulator under
a pad lane adds coupled drift to a recorded path.

**Tests.**
- Two evaluations of the same settings at the same time return the same value,
  including after evaluating other times in between (no hidden state leaks).
- Output values stay within −1..1 for a 10-minute run at the highest rate.
- Two lanes on outputs X and Y with the same settings, sampled over a minute,
  are correlated (|r| > 0.1) while X is not periodic (no autocorrelation peak
  above 0.95 after lag 0).
- Changing `startSeconds` by Δ shifts the curve by Δ.

**Open questions.** The original's Rate law and its Reynolds number are not
in any readable source; pick a chaotic regime and say so.

---

### Laverne
*Pluggo 3.6.1, Cycling '74; jhno · VST instrument / MAS · `params.tsv`, `presets.tsv`, `choices.txt`, manual pp. 96–99, screenshot p096-0. Patch encrypted.*

A small polyphonic subtractive synth played from MIDI: two oscillators, a
12 dB lowpass with key tracking, and ADSR envelopes for filter and amplitude.
It is in Pluggo as a demonstration of MIDI in a plug-in. Its name says
nothing, but its design is textbook.

**Original interface.** Generic parameter list (~352×362 for the first 13
rows; the list scrolls to 24).

| Control | Type | Range / unit | Default (shirl) | Position / group |
| --- | --- | --- | --- | --- |
| Output Level | slider | 0–100 % | 18 % | row 1 |
| Global Tune | slider | −100–100 cents | 0 | row 2 |
| Polyphony | slider | 1–8 voices | 5 | row 3 |
| Osc 1 Wave | slider-menu | sine, sawtooth, triangle, square | sawtooth | row 4 |
| Osc 1 Octave | slider | −5–5 | 0 | row 5 |
| Osc 1 Level | slider | 0–100 % | 100 % | row 6 |
| Osc 2 Wave | slider-menu | as Osc 1 | sawtooth | row 7 |
| Osc 2 Octave | slider | −5–5 | 0 | row 8 |
| Osc 2 Tune | slider | −1200–1200 cents | 15 cents | row 9 |
| Osc 2 Level | slider | 0–100 % | 100 % | row 10 |
| Filter Cutoff | slider | 10–20 000 Hz (manual: 10 000) | 1819 Hz | row 11 |
| Filter Resonance | slider | 0–1 | 0.53 | row 12 |
| Filter Tracking | slider | −100–100 % | 7 % | row 13 |
| Filt Velocity | slider | 0–100 % | 50 % | row 14 |
| Filt Env Amount | slider | 0–100 % | 100 % | row 15 |
| Filt Env Attack / Decay / Release | slider | 0–5000 ms | 0 / 102 / 139 ms | rows 16, 17, 19 |
| Filt Env Sustain | slider | 0–100 % | 66 % | row 18 |
| Amp Velocity | slider | 0–100 % | 33 % | row 20 |
| Amp Env Attack / Decay / Release | slider | 0–5000 ms | 8 / 123 / 299 ms | rows 21, 22, 24 |
| Amp Env Sustain | slider | 0–100 % | 39 % | row 23 |

Programs (8): shirl, forklift fun, empty bottle, heavy necking, cold
medication, milwaukee car horn, blown bottle, oh carmine.

**Signal flow.** Per voice: two oscillators (octave offsets, Osc 2 detuned in
cents) mixed by level → 12 dB/oct resonant lowpass whose cutoff is Cutoff,
plus filter envelope × amount, plus velocity × Filt Velocity, plus key
tracking → amplitude envelope × velocity scaling → sum of voices × Output.
Mono out. Voice allocation beyond the Polyphony count is not documented.

**Here.** Not a rack effect: the rack processes a file and has no notes. The
program already has a synth voice, the scale sequencer under **Seq**, with one
oscillator, a cutoff, an amplitude ADSR and three LFOs. Laverne is an
**Adjust** to that voice: a second oscillator and a filter envelope. The
sequencer is vendored whole from `rjvaleo/scale-sequencer`
(`docs/SEQUENCER.md`), so the change is made upstream and copied in.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `osc2Wave` | Osc 2 wave | sine, saw, triangle, square | saw | no | |
| `osc2Octave` | Osc 2 octave | −5–5 | 0 | no | oct |
| `osc2Cents` | Osc 2 tune | −1200–1200 | 15 | no | cents |
| `osc2Level` | Osc 2 level | 0–1 | 1 | no | |
| `filterEnvAmount` | Filter env amount | 0–1 | 1 | no | |
| `filterAttackMs` / `filterDecayMs` / `filterReleaseMs` | Filter A / D / R | 1–5000 | 1 / 102 / 139 | yes | ms |
| `filterSustain` | Filter S | 0–1 | 0.66 | no | |
| `keyTrack` | Key tracking | −1–1 | 0.07 | no | |

**Shared panel.** The sequencer's own panel; add an *Osc 2* group beside the
wave select and a *Filter env* group beside cutoff, as Laverne groups them.
Pad: none until the sequencer's controls are automation targets.

**Tests.** Osc 2 level 0 leaves the voice unchanged; with filter env amount 0
the cutoff does not move during a note; Osc 2 at +1200 cents reads one octave
above Osc 1 in a spectrum.

**Open questions.** Is a polyphonic note voice wanted at all, given the
sequencer is monophonic step-driven?

---

### M2M
*Pluggo 3.6.1, Cycling '74 · VST instrument / MAS · `presets.tsv` (unlabelled), manual pp. 112–114, screenshot p112-0. Compiled; no patch.*

MIDI to modulator: an incoming controller, note number, velocity, pressure or
program change becomes a 0–1 value sent to other plug-ins' parameters, with an
input window and an output window to magnify a narrow gesture.

**Original interface.** ~330×333, two identical source blocks stacked. Each
block: header row (MIDI Control Source menu, Select, Channel, Value), then
four horizontal bars — Input (draggable for testing), In Scale (range), Out
Scale (range), Output — each with a small full-range button on the right,
then three destination rows A, B, C (Mode, Assign).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| MIDI Control Source | menu | Note Number, Control Change, Velocity, Poly Key Pressure, … Program Change | block 1 Note Number, block 2 Control Change | block header |
| Select | number | Any, 0–127 | Any / 1 | header |
| Channel | number | Any, 1–16 | Any | header |
| Input | slider + number | 0–127 | — | bar 1 |
| In Scale | range bar + reset | 0–127 | full | bar 2 |
| Out Scale | range bar + reset | 0–1 | full | bar 3 |
| Output | display + number | 0–1 | — | bar 4 |
| Mode A/B/C | menu | Off, Set, Offset, Scale | Set/Off | destination rows |
| Assign A/B/C | menu | parameters | No Connection | destination rows |

The stored program holds 48 values in three runs of 16 with the same pattern,
suggesting three source blocks; the screenshot shows two (inferred).

**Signal flow.** A matching MIDI message's value is clipped to the In Scale
window, mapped to 0–1, mapped into the Out Scale window and sent to each
destination by its Mode. No smoothing is described.

**Here.** New, but not a modulator kind: a live controller, like the pad. The
browser's Web MIDI input (`navigator.requestMIDIAccess`, nothing in `ui/`
uses it today) feeds a binding table; each binding writes through
`/api/rack/param` (or the engine's stretch path) as a hand on a control does,
so Touch and Latch record it into lanes with no new server code. A binding:

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `source` | Source | cc, note, velocity, polyPressure, channelPressure, pitchBend, program | cc | no | |
| `select` | Select | −1 (any), 0–127 | −1 | no | |
| `channel` | Channel | 0 (any), 1–16 | 0 | no | |
| `inLow` / `inHigh` | In scale | 0–127 | 0 / 127 | no | |
| `outLow` / `outHigh` | Out scale | 0–1 | 0 / 1 | no | unit |
| `target` | Target | any automation target id | — | | |

**Shared panel.** A MIDI tab in the Automation dock: one block per binding in
the original's order (source row, Input bar, In Scale, Out Scale, Output
bar), and a "learn" button that fills Source/Select/Channel from the next
message. Out Scale is the same low/high idea as the pad's axis limits.

**Tests.** CC 7 at 64 with in 0–127, out 0–1 writes unit 0.504; with in
32–96 it writes 0.5 at 64 and clamps 20 to 0; a channel-2 message is ignored
by a channel-1 binding; under Latch, a stream of CC values leaves a lane whose
points follow it.

---

### Nebula
*Pluggo 3.6.1, Cycling '74; jhno · VST/MAS · `params.tsv`, `presets.tsv`, decoded `patch.txt` and `ui.txt`, manual p. 131, screenshot p131-0.*

Eight copies of the stereo input, some phase-inverted, mixed into the two
outputs at levels that drift at random. As the levels wander, the in-phase
and inverted copies cancel by different amounts, and the image swirls. Made
for pads and beds.

**Original interface.** Default view "A Pleasing Display", 353×157; a second
view lists the three parameters. The display is eight tall hatched sliders
(the arms' levels) in a row, which move on their own. In window coordinates
(view origin at patch 205,243): x = 0, 44, 88, 132, 176, 220, 264, 308; y 27;
each 45×108. The host strip above carries a meter (In/Out menu).

| Control | Type | Range / unit | Default (Slow Stir) | Position / group |
| --- | --- | --- | --- | --- |
| Output | slider (list view) | 0–2 | 1 | Parameters view |
| Nebula Depth | slider (list view) | 0–127 | 76 | Parameters view |
| Swirl Activity | slider (list view) | 0–1 | 0.61 | Parameters view |
| Arm levels ×8 | display (gain sliders) | 0–157 steps, 0.6 dB each, ~128 = unity (inferred) | random | display, 0,27 (45×108 each) |
| Views | menu | Parameters 1–3, A Pleasing Display, Nebula Info, Pluggo Info | Pleasing Display | host |
| Meter | meter + menu | In / Out | In | host strip |

Programs (8): Slow Stir, Fast Stir, Wax and Wane, Middle Ground, Lethargic,
Meteor Shower, Spiral, Just a Little Bit.

**Signal flow.** From the decoded patch:
1. A clock ticks every `11 + 500 × (1 − Swirl Activity)` ms (11–511 ms).
2. Each tick goes to the next of eight arms in turn, so each arm moves once
   every eight ticks. The arm draws a random level, places it in a window set
   by Depth (width Depth, floor `120 − 0.8 × Depth` gain steps; inferred from
   the abstraction's inlets), and glides there.
3. The eight arms, as wired: L→L, L→R inverted, R→L, R→R inverted, L→R,
   R→L inverted, L→R, R→L inverted. Left out = sum of the four arms that
   reach it, right likewise. Output × Output gain (20 ms ramp).
4. No feedback, no delay. Stereo in, stereo out.

**Here.** New `ShapeKind::Nebula`. Its randomness must not depend on where
playback started, or the export would differ from what was heard: draw each
arm's target from a hash of (seed, tick index from the document frame), as
`SampleHold` does, and glide from the previous tick's target.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `output` | Output | 0–2 | 1 | no | |
| `depth` | Nebula depth | 0–127 | 76 | no | |
| `activity` | Swirl activity | 0–1 | 0.61 | no | |
| `seed` | Seed | 0–9999 | 1 | no | |

**Shared panel.** One group: Swirl activity (primary dial), Nebula depth,
Output. Display: the eight arm levels as eight vertical bars, the original's
Pleasing Display. Prism pad: X `activity` 0–1, Y `depth` 0–127.

**Tests.**
- Silence in gives silence out.
- With a steady stereo input and activity > 0, the output's left/right
  correlation changes over ten seconds; with activity 0 (511 ms tick) it
  changes more slowly than at 1 (measured as variance of the correlation).
- Rendering from frame 0 and playing from frame N give the same samples
  after N (position-addressed randomness).

**Open questions.** As decoded, equal arm levels cancel both outputs to L − R,
so a mono source would vanish at Depth 0 — yet "Just a Little Bit" uses Depth
4. Either the gliding object treats its range and floor differently from the
reading above, or the original does nearly cancel. A listen to the original
settles the level law before the DSP is written.

---

### OneByEight
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, `presets.tsv`, `choices.txt`, manual pp. 134–136, screenshot p134-0. Patch encrypted.*

A one-in, eight-out panner on a circle. A point set by radius and angle
(by hand, by dragging, or by two LFOs) sends the input to eight outputs
spaced round the circle in proportion to its nearness, and each output is
routed to left, right or a PluggoBus. With alternating L/R routing it is an
auto-panner whose motion is drawn in polar coordinates.

**Original interface.** ~386×345, two regions. Top: a square framed polar
display (circle, crosshair, red dot) at top left; to its right a
volume bar and the number boxes Vol. Curve, S Curve, Smooth(ms), Rad. Pos.,
Theta(0–1), and LFO (radius) and LFO (theta) each with Freq(Hz) and On/Off,
Test Tone Freq(Hz) and On/Off. Bottom: "Output Levels", eight LED meters
labelled 0π … 7/4π, each with an Output Select menu beneath.

| Control | Type | Range / unit | Default (User Control) | Position / group |
| --- | --- | --- | --- | --- |
| Polar display | XY pad (polar) | r 0–1, θ 0–1 | centre | top left |
| Vol. | vertical bar | 0–1 | 0.762 | top, right of display |
| Vol. Curve | number | 0–10 (<1 log, 1 linear, >1 exp) | 1 | top right |
| S Curve | number | 0–100 (same reading) | 4 | top right |
| Smooth | number | 0–2000 ms | 20 ms | top right |
| Rad. Pos. | number | 0–1 | 0 | under display |
| Theta (0–1) | number | 0–1, CCW from 3 o'clock | 0 | under display |
| LFO (radius) Freq / On | number + toggle | 0–20 Hz | 0 / off | right column |
| LFO (theta) Freq / On | number + toggle | 0–20 Hz | 0 / off | right column |
| Test Tone Freq / On | number + toggle | 20–2000 Hz | 440 / on | right column |
| Output Levels ×8 | LED meter | — | — | bottom row, at 0, π/4 … 7π/4 |
| Output Select ×8 | menu | Off, Left, Right, Bus1L … Bus4R | L, R, Bus1L, Bus1R, Bus2L, Bus2R, Bus3L, Bus3R | under each meter |

Programs (8): User Control, Radar Alert, Slow Notch, Spirograph, Gentle
Shifts, Smooth Seizure, Scratchy Seizure, Glitches.

**Signal flow.** Stereo in summed to mono (or the test tone). The point
(r, θ) comes from the boxes or the two LFOs. Each output's gain is a function
of the point's distance to that output's position on the unit circle, shaped
by S Curve; at r = 0 all eight are equal (inferred from the manual). Gains are
smoothed over Smooth ms, scaled by Vol shaped by Vol. Curve, and each output
is added to its selected destination. The LFO shapes are not stated
(inferred: radius LFO a sine 0–1, theta LFO a ramp — continuous rotation).

**Here.** New `ShapeKind::OneByEight`. Destinations are Off, Left, Right or
Both; PluggoBus routing has no counterpart. The test tone is dropped — the
source is the file. Proposed gain law (inferred): `g_i = max(0, 1 − d_i/2)^S`,
normalised so the eight sum to one, where `d_i` is the distance from the
point to output *i*.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `volume` | Volume | 0–1 | 0.762 | no | |
| `volCurve` | Volume curve | 0.01–10 | 1 | yes | |
| `sCurve` | S curve | 0.01–100 | 4 | yes | |
| `smoothMs` | Smooth | 0–2000 | 20 | no | ms |
| `radius` | Radius | 0–1 | 0 | no | |
| `theta` | Theta | 0–1 | 0 | no | turn |
| `radiusLfo` | Radius LFO | 0/1 | 0 | no | |
| `radiusHz` | Radius rate | 0.001–20 | 0.04 | yes | Hz |
| `thetaLfo` | Theta LFO | 0/1 | 0 | no | |
| `thetaHz` | Theta rate | 0.001–20 | 0.07 | yes | Hz |
| `out1` … `out8` | Output 1 … 8 | 0 off, 1 L, 2 R, 3 both | L, R, L, R, L, R, L, R | no | |

**Shared panel.** *Position* (primary): the pad drawn polar, with Radius and
Theta numbers under it. *Motion*: Radius LFO on + rate, Theta LFO on + rate,
Smooth. *Shape*: Volume, Volume curve, S curve. *Outputs*: eight small meters
in a row, each with its L/R/Both/Off menu — the original's bottom row.
Prism pad: X `theta` 0–1, Y `radius` 0–1; the pad draws the circle and the
eight output points, as the original's display did.

**Tests.**
- r = 0: all eight gains equal, so with L/R alternating the output is centred
  (L and R RMS within 0.1 dB).
- r = 1, θ = 0, out1 = L: left carries at least 20 dB more than right.
- Theta LFO on at 1 Hz with L/R alternating: left RMS rises and falls with a
  period of 0.25 s (four L/R alternations per turn).
- All outputs Off gives silence.

**Open questions.** The real gain law and LFO shapes; the patch is encrypted
and the manual only says "polar coordinates".

---

### Rye
*Pluggo 3.6.1, Cycling '74; jhno — Pluggo Signature Series Granular · VST/MAS · `params.tsv`, `presets.tsv`, manual pp. 179–180, screenshot p179-0. Patch encrypted.*

A real-time granulator on the incoming signal: grains of set length at a set
period, played at any speed including backwards, a stereo trick using phase
reversal, and a long feedback delay that feeds the grains back into their own
input. Simple controls, strong results — reverse echoes, smeared shifts.

**Original interface.** Generic parameter list, ~352×267.

| Control | Type | Range / unit | Default (Low Reverse) | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–111 (manual 0–127) | 111 | row 1 |
| Dry Level | slider | 0–120 (manual 0–127) | 0 | row 2 |
| Grain Period | slider | 5–5000 ms | 329 ms | row 3 |
| Grain Duration | slider | 1–5000 ms | 403 ms | row 4 |
| Grain Crossfade | slider | 0–1000 ms | 101 ms | row 5 |
| Grain Pitch | slider | −10–10 (speed; negative = reverse) | −0.95 | row 6 |
| Stereo Factor | slider | −3–3 (1 = mono) | −0.82 | row 7 |
| Feedback Delay | slider | 0–5000 ms | 1274 ms | row 8 |
| Feedback Amount | slider | 0–7 | 0 | row 9 |

Programs (8): Low Reverse, Crystal Clone, Mangy Chorus, Slow Shifter, High
Slices, Reverse Echos, We Love Glenda, Disoriented.

**Signal flow.** Input plus the feedback return is written to a buffer. Every
Grain Period a grain of Grain Duration starts, reading at Grain Pitch speed
(negative reads backwards), with Grain Crossfade fades. The grain output goes
to a delay of Feedback Delay, scaled by Feedback Amount, and back into the
input. Stereo Factor: 1 is mono, above 1 widens, below 1 widens with one side
phase-reversed (inferred construction: two grain streams A and B, left
`A + k·B`, right `A − k·B`, `k = (s − 1)/2`). Feedback above 1 must be
limited or it runs away.

**Here.** New `ShapeKind::GrainDelay`. The program's granular engine reads the
whole file outside the rack; this works on the rack's live signal, so it is a
separate module. Put a soft clipper in the feedback path.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `periodMs` | Grain period | 5–5000 | 329 | yes | ms |
| `durationMs` | Grain duration | 1–5000 | 403 | yes | ms |
| `crossfadeMs` | Crossfade | 0–1000 | 101 | no | ms |
| `speed` | Grain speed | −10–10 | −0.95 | no | × |
| `stereo` | Stereo factor | −3–3 | −0.82 | no | |
| `fbDelayMs` | Feedback delay | 0–5000 | 1274 | no | ms |
| `feedback` | Feedback | 0–7 | 0 | no | |
| `wet` | Wet | 0–1 | 1 | no | |
| `dry` | Dry | 0–1 | 0 | no | |

**Shared panel.** *Grains* (primary): Period (primary dial), Duration,
Crossfade, Speed. *Space*: Stereo factor. *Feedback*: Delay, Amount.
*Levels*: Wet, Dry. Display: a grain timeline (grain onsets and lengths over
the last two seconds). Prism pad: X `periodMs` 5–5000 ms (log), Y `speed`
−10–10.

**Tests.**
- Speed 1, duration = period, crossfade 0, stereo 1, feedback 0: a sine
  passes at its own frequency (spectral peak within 1 %).
- Speed −1: a rising chirp comes out falling within each grain.
- Speed 2: a 440 Hz sine comes out at 880 Hz.
- Feedback 7 on noise stays below full scale after 30 s.

**Open questions.** The original's level scales (111, 120, 127) and the
stereo construction.

---

### Warpoon
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, `presets.tsv`, `choices.txt`, manual pp. 241–242, screenshot p241-0. Patch encrypted.*

An ambient chorus built from four stereo delay taps, each with its own base
time and its own slow modulator. With sine modulation it is a thick, moving
chorus. With triangle modulation each tap's delay slides at a constant rate,
which is a constant pitch shift, flipping above and below the source every
half cycle — clusters of pitches around the original.

**Original interface.** Generic parameter list, ~352×405, fifteen rows.

| Control | Type | Range / unit | Default (Moving Nasality) | Position / group |
| --- | --- | --- | --- | --- |
| Wet Level | slider | 0–2 | 1 | row 1 |
| Dry Level | slider | 0–1 | 0 | row 2 |
| Waveform | slider-menu | Sine, Triangle | Sine | row 3 |
| T1 Delay / Mod Freq / Mod Depth | sliders | 0–100 ms / 0–2 Hz / 0–100 | 12 / 0.2 / 5 | rows 4–6 |
| T2 … | sliders | as T1 | 12 / 0.07 / 6 | rows 7–9 |
| T3 … | sliders | as T1 | 12 / 0.06 / 8 | rows 10–12 |
| T4 … | sliders | as T1 | 12 / 0.08 / 6 | rows 13–15 |

Programs (16): Moving Nasality, Slow Trill, Dark Cluster, Enhancement, Alien
Torch Song, Stereo Subtractor, Empty Jazz Club, Jazz on the Titanic, Movie
Set, Harmonica 10, Another Cluster, Chorus of Laughter, Mod Cut Out,
Interference X4, Miller Triller, White Shag Carpeting.

**Signal flow.** Stereo in. Four taps read a stereo delay line; tap *n*'s time
is `delay_n + depth_n × wave(rate_n · t)`, clipped at 0 (the Mod Cut Out
program deliberately drives it below zero so the dry signal pokes through).
The taps are summed × Wet, plus input × Dry. Depth's unit is not stated; the
manual's comparison with delay time implies ms (inferred). Tap panning and
LFO starting phases are not stated.

**Here.** New `ShapeKind::Warpoon`. White chorus is one voice; giving it four
would change what its saved values mean. Two added macro controls scale all
four rates and depths together, so the pad has something to hold — they are
an addition, not in the original.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–2 | 1 | no | |
| `dry` | Dry | 0–1 | 0 | no | |
| `wave` | Waveform | 0 sine, 1 triangle | 0 | no | |
| `t1DelayMs` … `t4DelayMs` | Tap 1–4 delay | 0–100 | 12 | no | ms |
| `t1RateHz` … `t4RateHz` | Tap 1–4 rate | 0–2 | 0.2, 0.07, 0.06, 0.08 | no | Hz |
| `t1DepthMs` … `t4DepthMs` | Tap 1–4 depth | 0–100 | 5, 6, 8, 6 | no | ms |
| `rateScale` | Rate scale | 0–2 | 1 | no | × |
| `depthScale` | Depth scale | 0–2 | 1 | no | × |

**Shared panel.** *Mix* first: Wet, Dry, Waveform switch. Then four *Tap*
groups side by side, each Delay / Rate / Depth top to bottom — the original
lists them tap by tap. *Macro*: Rate scale (primary), Depth scale. Display:
four dots on a 0–100 ms line showing each tap's current delay. Prism pad:
X `rateScale` 0–2, Y `depthScale` 0–2.

**Tests.**
- Wet 0, dry 1: output equals input.
- Triangle, one tap with depth 10 ms at 1 Hz (others depth 0, wet on that tap
  only): a 1 kHz sine reads 1040 Hz and 960 Hz in alternate half-seconds
  (slope 4 × depth × rate = 40 ms/s, ±4 %).
- Depth above delay never reads a negative time (no NaN, no read past the
  write head).
- Depth scale 0 makes the output a static four-tap comb (stationary
  spectrum).

---

### Wheat
*Pluggo 3.6.1, Cycling '74; jhno — Pluggo Signature Series Granular · VST/MAS · `params.tsv`, `presets.tsv` (first program only decodes), manual pp. 252–253, screenshot p252-0. Patch encrypted.*

A granulator on a short loop that the input keeps recording into, with
Freeze to hold the loop and a drawn pitch envelope ("Mess") that bends each
grain. It goes further than Rye: random pitch and stereo per grain, a scan
rate through the loop, and pitch shapes that make the grains chirp.

**Original interface.** Custom view, ~272×260. Ten horizontal sliders,
labelled, top to bottom; three toggles at the right (freeze, mess, offset);
below, a function display of the pitch envelope with a tall vertical slider
and a narrow one on its left and a tall vertical slider on its right.

| Control | Type | Range / unit | Default (Tuna Salad) | Position / group |
| --- | --- | --- | --- | --- |
| wet level | h-slider | 0–512 (manual 0–1) | 512 | slider 1 |
| dry level | h-slider | 0–512 | 210 | slider 2 |
| speed | h-slider | 0–512 (grain rate) | 447 | slider 3 |
| window size | h-slider | 0–512 (loop, max 1024 ms) | 172 | slider 4 |
| grain size | h-slider | 0–500 ms | 176 ms | slider 5 |
| crossfade | h-slider | 0–500 ms | 185 ms | slider 6 |
| pitch | h-slider | −3–5 (speed) | −3 decoded; screen shows near max | slider 7 |
| random pitch | h-slider | 0–4 | 0.92 | slider 8 |
| scan | h-slider | 0–512 | 111 | slider 9 |
| random stereo | h-slider | 0–512 | 381 | slider 10 |
| freeze | toggle | off/on | off | right, top |
| mess | toggle | off/on | on | right, middle |
| offset | toggle | off/on | off | right, bottom |
| Pitch envelope | function display | drawn | rise then fall | bottom |
| ModSpeed / ModMin / ModMax / ModAmount | vertical sliders by the display (which is which: inferred) | 0–512 / 0–127 / 0–127 / 0–512 | 72 / 0 / 88 / 43 | beside display |

Programs (8): Tuna Salad, Out of Sync, Doodles, Distant, Distorto, Slouch,
Wild Chorus, End of the Rope. Only Tuna Salad decodes to sensible values; the
other seven read as a rising ramp across their fields, a mis-aligned decode.

**Signal flow.** Mono in. The input is recorded continuously into a loop of
Window Size (up to 1024 ms) unless Freeze is on. Grains of Grain Size, with
Crossfade, start at the Speed rate, read from a position that advances
through the loop at the Scan rate, at Pitch speed plus a random amount up to
Pitch Random, and are placed in the stereo field at random by the Stereo
amount. With Mess on, each grain's pitch also follows the drawn envelope,
read at ModSpeed and scaled between ModMin and ModMax by ModAmount; Offset
applies the amount as an offset (the manual says no more). Stereo out. The
0–512 scales are raw slider units; their mapping to rates is not recoverable.

**Here.** New `ShapeKind::GrainFreeze`. Shares a grain voice with
`GrainDelay` (Rye) but not its controls. Unmapped 0–512 controls become
normalised 0–1 here, with a mapping chosen at build time.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `wet` | Wet | 0–1 | 1 | no | |
| `dry` | Dry | 0–1 | 0.41 | no | |
| `grainRate` | Speed | 0–1 | 0.87 | no | |
| `windowMs` | Window | 10–1024 | 344 | yes | ms |
| `grainMs` | Grain size | 1–500 | 176 | yes | ms |
| `crossfadeMs` | Crossfade | 0–500 | 185 | no | ms |
| `pitch` | Pitch | −3–5 | 1 | no | × |
| `pitchRandom` | Random pitch | 0–4 | 0.92 | no | |
| `scan` | Scan | 0–1 | 0.22 | no | |
| `stereo` | Random stereo | 0–1 | 0.74 | no | |
| `freeze` | Freeze | 0/1 | 0 | no | |
| `mess` | Mess | 0/1 | 1 | no | |
| `modRate` | Mod speed | 0–1 | 0.14 | no | |
| `modMin` / `modMax` | Mod min / max | 0–1 | 0 / 0.69 | no | |
| `modAmount` | Mod amount | 0–1 | 0.08 | no | |
| `modOffset` | Offset | 0/1 | 0 | no | |

The pitch envelope is a drawn table (≤64 points) stored with the slot, like
the EQ's bands.

**Shared panel.** *Levels*: Wet, Dry. *Grains* (primary): Grain size
(primary), Speed, Crossfade, Window, Scan. *Pitch*: Pitch, Random pitch.
*Space*: Random stereo. Switches Freeze, Mess, Offset at the right, as in the
original. *Envelope*: the drawable display with Mod speed, min, max and
amount beside it. Prism pad: X `grainMs` 1–500 ms (log), Y `pitch` −3–5.

**Tests.**
- Freeze on, then silence in: output keeps sounding for at least five seconds.
- Freeze off, silence in: output decays to silence within window + grain time.
- Pitch 2, random 0, mess off: a 440 Hz sine comes out at 880 Hz.
- Mess off makes the envelope table irrelevant (two tables, same output).

**Open questions.** What the 0–512 controls mean in real units; whether the
decoded Pitch default (−3) or the screenshot (near +5) is the program's.

---

### Audio2Control
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, `choices.txt`, manual pp. 17–18, screenshot p017-0. Patch encrypted.*

Samples the raw audio value every so many milliseconds and uses it as a
modulation signal. Not an envelope: a jagged, signal-related random, and a
way to play back control data stored as audio (Control2Audio's partner).

**Original interface.** ~402×120. Top row: Audio Input Select menu; Sampling
Interval (ms) slider with number; a level bar under the menu; Input → Output
checkbox. Then three destination rows: Mode, Assign, Invert, Range bar,
Value.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Audio Input Select | menu | Off, LeftIn, RightIn, PluggoBus1L … 4R, Noise | Left In | top left |
| Sampling Interval | slider + number | 5–500 ms | 150 ms | top right |
| Input → Output | checkbox | off/on | off | top, under slider |
| Mode ×3 | menu | Off, Set, Offset, Scale | Set | destination rows |
| Assign ×3 | menu | parameters | — | destination rows |
| Invert ×3 | checkbox | off/on | off | destination rows |
| Range ×3 | range bar | 0–1 | full | destination rows |
| Value ×3 | number display | 0–1 | — | destination rows |

**Signal flow.** Every interval the chosen input's instantaneous sample is
taken and held, scaled into each destination's range (inverted if asked) and
sent. Noise samples white noise instead. Audio passes through only if Input →
Output is on. How a bipolar sample becomes 0–1 is not stated.

**Here.** New lane modulator `Modulator::Follow` in **sample** mode (shared
with Env Follower). The Noise source is `SampleHold` (exists). The follower
stays a pure function of time by reading the **document's own audio, pre-rack,
offline**: the detector runs once over the file when the modulator is added
or changed and caches a table at `intervalMs` (an `Arc<[f32]>` beside the
settings, not saved); `value(seconds)` is a table read. Drawing, playback and
export then agree, which is the rule `automation.rs` states. Reading
post-rack is left out on purpose: the rack's output depends on the lanes, so
a follower there would feed back on itself. A PluggoBus source becomes a
second library file.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `detect` | Detect | 0 envelope, 1 sample | 1 | no | |
| `source` | Channel | 0 left, 1 right, 2 mid, 3 side | 0 | no | |
| `file` | Source file | library path; empty = this document | empty | | |
| `intervalMs` | Interval | 1–500 | 150 | yes | ms |
| `attackMs` | Attack | 0.1–2000 | 50 | yes | ms |
| `releaseMs` | Decay | 0.1–2000 | 250 | yes | ms |
| `gain` | Input gain | 0–3 | 1 | no | × |
| `depth` | Depth | −1–1 | 1 | no | |
| `offset` | Offset | −1–1 | 0 | no | |

(Attack and Decay apply in envelope mode only.)

**Shared panel.** Modulator editor: Detect switch, Channel menu, Source file
picker; Interval (primary dial); Input gain; Depth, Offset. Display: the
cached table drawn over the lane, with the file's waveform faint behind it.
Pad: a Follow modulator under a pad path makes the path breathe with the
file.

**Tests.**
- Sample mode on a file that is a 0.5 DC level reads 0.5 × gain × depth at
  every interval.
- Interval 100 ms on a 1 Hz sine yields a held staircase of ten steps per
  cycle.
- Same file and settings give the same table twice; a different file length
  makes the lane refuse it (`Automation::matches`).

**Open questions.** Bipolar handling: map −1..1 straight to the modulator's
−1..1 (proposed), or rectify?

---

### Breakpoints
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, `choices.txt`, manual pp. 28–30, screenshot p028-0. Patch encrypted; decoded program misaligned, screenshot used.*

A twelve-point envelope you draw, played once per trigger or repeatedly,
applied to the plug-in's own audio and/or sent to two parameters elsewhere.
A drawn gate, a drawn tremolo, a drawn swell.

**Original interface.** ~450×233. Left column: Retrigger (ms) number and a
round trigger button; Trigger on Edit checkbox; Sync Trigger menu; a
horizontal duration slider with Duration (ms) number; heading "Audio Signal
Envelope" with Output Assign menu and Apply to Input checkbox. Right: the
envelope graph (12 points, joined by lines) with a purple progress slider
under it and a value slider on its right edge. Bottom, heading "Control
(Modulator) Envelope": two rows of Mode, Assign, Invert, Range, Grain (ms),
Value.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Envelope graph | breakpoint display | 12 points, x 0–duration, y 0–1 | rise-fall shape | right |
| Env Duration | slider + number | 100–5000 ms | 500 ms | left, middle |
| Trigger | button | 0/1 | — | left, top |
| Retrigger Interval | number | 0–500 ms | 300 ms | left, top |
| Trigger on Edit | checkbox | off/on | off | left |
| Sync Trigger | menu | Off, Internal, pluggoSync 1–4, Host | Off | left |
| Unit / Mult | menu / number | 1 … 64t / 0–1000 | — (Host only) | left, appears on Host |
| Output Assign | menu | Off, Out, PluggoBus 1L … 4R | Off | left, lower |
| Apply Env to Input | checkbox | off/on | off | left, lower |
| Progress / value | sliders | — | — | under / right of graph |
| Mode ×2 | menu | Off, Set, Offset, Scale | Off | bottom rows |
| Assign ×2 | menu | parameters | No Connection | bottom rows |
| Invert ×2 | checkbox | off/on | off | bottom rows |
| Range ×2 | range bar | 0–1 | full | bottom rows |
| Grain ×2 | number | 20–300 ms | 50 ms | bottom rows |
| Value ×2 | display | 0–1 | — | bottom rows |

**Signal flow.** A trigger (button, any non-zero Trigger value, the Internal
clock every Duration, a sync bus, or the host's beat) starts the envelope
unless one started within Retrigger Interval. The envelope runs at audio rate
over Duration. It can multiply the input, go to an output or bus, and is
sampled every Grain ms for each control destination.

**Here.** **Adjust** `Modulator::Lfo`: a `draw` shape whose cycle is a list
of points, each `(phase 0–1, value −1..1, curve)` using the lanes' own `Curve`
(Step, Linear, Smooth, Exponential, Bezier) — up to 128 points. Breakpoints
is then an Lfo with shape `draw`, `rate = 1000 / durationMs`. The same
addition serves the LFO plug-in's Draw mode. "Apply to input" is that lane on
a Gain slot's `db`. What does not carry: external triggers, Trigger on Edit
and the retrigger hold, because a modulator here is a function of time and
has no events; Internal sync is exactly the repeat, and a one-shot is a lane
curve drawn once with no modulator. Grain falls to the 8 ms tick.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `shape` | Shape | sine, triangle, square, ramp, **draw** | draw | no | |
| `rate` | Rate | 0.001–100 (= 1000 / duration) | 2 | yes | Hz |
| `depth` / `offset` / `phase` | as now | | 1 / 0 / 0 | | |
| `points` | Drawn cycle | ≤128 × (phase 0–1, value −1..1, curve) | 12 points | | |

**Shared panel.** Modulator editor for shape `draw`: the cycle graph large
(primary), points draggable, curve per segment from the lane editor's own
menu; Duration shown as ms beside Rate; Depth, Offset, Phase. Pad: n/a.

**Tests.**
- A drawn cycle of two points (0, −1) and (0.5, 1), Linear, at 1 Hz equals
  `triangle` within 1e-6 at 1000 sample times.
- A Step segment holds its value until the next point.
- Phase wraps: evaluation at t and t + 1/rate agree.
- On a gain lane at 10 Hz the gain moves in 8 ms steps; a short-envelope test
  documents that limit rather than hiding it.

**Open questions.** Breakpoints' "audio-rate" envelope on gain will zipper at
an 8 ms tick for durations near 100 ms; is a per-block interpolation of rack
writes wanted?

---

### Control2Audio
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, `choices.txt`, manual pp. 40–41, screenshot p040-0. Patch encrypted.*

The other half of Audio2Control: a 0–1 value, usually driven by another
modulator, written out as an audio signal — a control voltage you can record
on a track and edit with audio tools.

**Original interface.** Generic parameter list, ~352×175.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Zero to One Value | slider | 0–1 | 0.5 | row 1 |
| Scaling Factor | slider | 0–10 | 1 | row 2 |
| Offset | slider | −1–1 | −0.5 | row 3 |
| Ramp Time | slider | 0–150 ms | 10 ms | row 4 |
| Destination | slider-menu | Off, LeftOut, RightOut, PluggoBus1L … 4R | Off | row 5 |

**Signal flow.** Output sample = value × scale + offset, slewed over Ramp
Time (0 = stair-steps), to the chosen output or bus. No audio input.

**Here.** **Adjust**: the reason it existed — storing control as audio — is
what a lane already is. The useful remainder is a "Render lane to audio"
action in the Automation dock: write a lane's unit value at the document's
rate as a mono file in the library, scaled, offset and slewed. `Follow` in
sample mode reads such a file back, closing the loop.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `scale` | Scale | 0–10 | 1 | no | × |
| `offset` | Offset | −1–1 | 0 | no | |
| `rampMs` | Ramp | 0–150 | 10 | no | ms |

**Shared panel.** A small dialog from the lane's menu: Scale, Offset, Ramp,
file name; preview of the waveform. Pad: n/a.

**Tests.** A lane flat at 0.5 renders, with scale 1 and offset 0, to a file
of constant 0.5; ramp 0 reproduces a Step lane's edges sample-exact; reading
the rendered file back through `Follow` (sample mode, interval 8 ms)
reproduces the lane within 1/256.

---

### Env Follower
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, `presets.tsv`, manual pp. 58–59, screenshot p058-0. Patch encrypted.*

Tracks the loudness of its input with separate attack and decay times and
sends it as modulation: louder playing opens a filter, swells a send, pushes
a delay. The classic follower.

**Original interface.** ~447×154. Header row "Envelope Follower Settings"
with Input Level and Follower Level meters at the right. Four horizontal
sliders with numbers below them: Attack Time (ms), Decay Time (ms),
Resolution (ms), Input Gain. Under "Modulator Assignment", two destination
rows: Mode, Parameter, Invert, Range, Value.

| Control | Type | Range / unit | Default (Default Settings) | Position / group |
| --- | --- | --- | --- | --- |
| Input Level | meter | — | — | header right |
| Follower Level | meter | — | — | header far right |
| Attack Time | slider + number | 0–2000 ms | 50 ms | slider 1 |
| Decay Time | slider + number | 0–2000 ms | 250 ms | slider 2 |
| Resolution | slider + number | 1–500 ms | 8 ms | slider 3 |
| Input Gain | slider + number | 0–3 | 1.00 | slider 4 |
| Mode ×2 | menu | Off, Set, Offset, Scale | Set | rows |
| Parameter ×2 | menu | parameters | — | rows |
| Invert ×2 | checkbox | off/on | off | rows |
| Range ×2 | range bar | 0–1 | full | rows |
| Value ×2 | display | 0–1 | — | rows |

Programs (8): Default Settings, Low and Slow, Follow the Leader, Upper Mod,
Supple and Subtle, Feel Every Bump, Track Larger Changes, More Arbitrary
Settings.

**Signal flow.** Input × gain → rectify → a follower that rises with the
attack time and falls with the decay time → sampled every Resolution ms →
scaled into each destination's range, inverted if asked. Audio passes through.

**Here.** New `Modulator::Follow`, **envelope** mode — the same kind and the
same offline-table design as Audio2Control above, with Attack, Decay and
Interval (= Resolution, default 8 ms, which is also the runner's tick). The
code's own condition for adding a follower — a real detector whose every
control is read — is met: the detector is a one-pole attack/release peak
follower on the rectified signal, run over the file, and each setting
changes the table. ParamSpec table: see Audio2Control (`detect` = 0).

**Shared panel.** Modulator editor: Attack, Decay (primary pair), Interval,
Input gain, then Channel and Source file, then Depth and Offset; the
original's two meters become the drawn envelope over the waveform. Pad: n/a.

**Tests.**
- A 1 s burst of full-scale sine after silence: with attack 50 ms the value
  passes 0.63 of its peak between 40 and 60 ms after onset.
- After the burst, with decay 250 ms the value falls below 0.37 of peak
  between 200 and 300 ms after it ends.
- Attack 0.1 vs 2000 ms on the same file give visibly different tables (each
  control is read).
- Gain 2 doubles the plateau, clamped at 1.

---

### Key Triggers
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `presets.tsv` (unlabelled), manual pp. 93–94, screenshot p093-0. Compiled; no patch.*

The computer's modifier keys as switches: holding Shift, Caps Lock, Option,
Control or Command sets a parameter to one value and releasing sets it to
another. A hand-played toggle, or a trigger for Breakpoints.

**Original interface.** ~485×125, one row per key with a heading row: Key
label, Mode menu, Assign menu, a range bar marked Up Value / Down Value, Cur
Value display.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Key | label | Shift, Caps Lock, Option, Control, Command | — | column 1, rows 1–5 |
| Mode ×5 | menu | Off, Set Down/Up, Offset Down/Up, Scale Down/Up, Set Down Only, Set Up Only | Set Down/Up (screen) | column 2 |
| Assign ×5 | menu | parameters | No Connection | column 3 |
| Up / Down value ×5 | range bar | 0–1 each | stored 0.2 / 1 (inferred from the program's five-value groups) | column 4 |
| Cur Value ×5 | display | 0–1 | — | column 5 |

**Signal flow.** Key down sends the Down (high) value, key up the Up (low)
value, through the Mode. "Down Only" and "Up Only" act on one edge. Modifier
keys alone are not seen by the host, which is why they were safe to use.

**Here.** **Adjust**, in two places. (1) The interface: a key-hold binding on
any control — while the key is held the control sits at its Down value, on
release it returns to Up — sent through `/api/rack/param` like any move, so
Touch and Latch record it. (2) The recorder: `record_point` writes every
point `Curve::Linear` and thins to 50 ms, which turns a key's edge into a
50 ms ramp. It should take the curve, and a key binding writes `Step`.
Offset and Scale modes drop with the lane rules above.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `key` | Key | Shift, CapsLock, Alt, Control, Meta | — | | |
| `mode` | Mode | downUp, downOnly, upOnly | downUp | | |
| `target` | Target | automation target id | — | | |
| `up` | Up value | 0–1 | 0.2 | no | unit |
| `down` | Down value | 0–1 | 1 | no | unit |

**Shared panel.** A Keys tab in the Automation dock, five rows in the
original's order, each: key, mode, target, an up/down range bar, current
value. Pad: a held key can also snap a pad axis to its Down value.

**Tests.** Holding Shift under Latch for 300 ms writes Step points at the
press and release frames with values Down then Up; Down Only writes one
point; releasing the key returns the control exactly to Up (no ramp in the
lane).

**Open questions.** Which keys are free: Shift and Alt already modify drags
in the interface.

---

### LFO
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, `choices.txt`, manual pp. 100–102, screenshot p100-0. Patch encrypted; decoded program misaligned, screenshot used.*

A repeating waveform sent to other plug-ins' parameters: sine, square, saw up,
saw down, or one you draw. The modulator inside Swish and Warble, offered on
its own.

**Original interface.** ~254×174. A column of five waveform buttons at the
left (sine, square, saw up, saw down, pencil); a narrow vertical min/max
slider; the waveform display filling the right; a horizontal slider along
the top (inferred: sync multiplier). Under the display: a round retrigger
button, a down-arrow, φ phase number, and the sync source menu ("free").
Three destination rows below: Mode, Assign (no range or invert per row —
Min and Max are global).

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| LFO Waveform | 5 buttons | sine, square, saw-up, saw-down, draw | sine | left column |
| Waveform display | display / drawable in Draw | — | one sine cycle | right |
| LFO Min / Max | slider | 0–127 | 0 / 127 | narrow column |
| LFO Phase | number | 0–360° | 0 | under display |
| LFO Sync Source | menu | UDT (free), Host, Plug | free | under display |
| LFO Tempo | number | 1–300 BPM | — | (UDT) |
| LFO Sync Multiplier | slider | 0.01–75 | — | top |
| LFO Sync Note Value | menu | 1 … 1/64t | — | |
| Retrigger | button | — | — | under display |
| Mode ×3 | menu | Off, Set, Offset, Scale | set / offset / off | rows |
| Assign ×3 | menu | parameters | — | rows |

Programs: Default LFO, Draw Example.

**Signal flow.** Rate = one cycle per (note value × multiplier) at the tempo.
The waveform is scaled between Min and Max, starting at Phase on retrigger,
and sent to each row by its Mode.

**Here.** `Modulator::Lfo` exists: sine, square and ramp (saw up) are there,
saw down is ramp with negative depth, Min/Max become offset and depth by the
lane rules, Phase is `phase` (degrees ÷ 360). **Adjust**: the `draw` shape
with a points list, specified under Breakpoints — one addition for both.
Retrigger has no counterpart (absolute time); tempo is the editor's
calculator.

**Shared panel.** Modulator editor, the original's layout: shape buttons in a
column at the left, the cycle display at the right (drawable when `draw`),
Rate (primary) with the tempo calculator, Depth, Offset, Phase below. Pad: an
LFO under a looping pad path, as HYPERPRISM.md describes.

**Tests.** Existing `Lfo` tests stand; add: ramp with depth −0.5 equals
saw-down (`0.5 − p`) within 1e-6; a `draw` cycle sampled at 1000 phases is
continuous across the wrap when its first and last values match.

---

### Mouse Mod
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, `presets.tsv`, manual pp. 119–120, screenshot p119-0. Patch encrypted.*

The mouse position as modulation: two horizontal and two vertical gestures,
each gated by a modifier key so ordinary mouse use does not move anything,
with record and play switches that route the gesture through host automation.
It is the Hyperprism idea in modulator form.

**Original interface.** ~481×99, four rows (Horizontal 1, Vertical 1,
Horizontal 2, Vertical 2), columns: Gesture label, Gate menu, Mode menu,
Assign menu, Invert, Range bar, Value, Rec, Play.

| Control | Type | Range / unit | Default | Position / group |
| --- | --- | --- | --- | --- |
| Gate ×4 | menu | None, Shift Key, Caps Lock, Option Key, Control Key, Command Key | None | column 2 |
| Mode ×4 | menu | Off, Set, Offset, Scale | Set | column 3 |
| Assign ×4 | menu | parameters | — | column 4 |
| Invert ×4 | checkbox | off/on | off | column 5 |
| Range ×4 | range bar | 0–1 | full | column 6 |
| Value ×4 (`H1Value`…`V2Value`) | number; automatable | 0–1 | 0 | column 7 |
| Rec ×4 | checkbox | off/on | off | column 8 |
| Play ×4 | checkbox | off/on | off | column 9 |

Programs: Init, Program 2, Program 3.

**Signal flow.** Screen x and y, scaled into the range and inverted if asked,
sent while the gate key is held (or always). Rec writes the value into the
row's own parameter for the host to record; Play takes values from that
parameter instead of the mouse.

**Here.** **Exists**: the Prism pad. One pad is one H/V pair; the pad's axis
limits are the Range bars; REC on the pad (Latch) is Rec, and lane playback
is Play. The gate is the drag itself — the pad writes only while held. One
rule to confirm in the pad: limits entered high-to-low invert the axis, which
is Invert. A second pair is a second pad (an open question HYPERPRISM.md
already asks).

**Shared panel.** The Prism pad as planned. Pad pair: whatever two targets
the user assigns; the pad is the modulator.

**Tests.** Covered by the pad's planned tests; add one: an axis with low 0.8,
high 0.2 writes 0.8 at the left edge and 0.2 at the right.

---

### Randomizer
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, manual pp. 169–170, screenshot p169-0. Patch encrypted; decoded programs partly misaligned, screenshot used.*

New random values at a jittered interval, glided up and down at separate
rates, drawn from a distribution you sketch. A sample-and-hold with three
refinements, and a histogram showing what it has produced.

**Original interface.** ~365×162. A horizontal slider across the top; a
column of five number boxes with icons at the left (Rate 100, Rate
Randomness 50, Damp Up 20, Damp Down 6, Output Grain 50); a round button
(Straight Distribution); a vertical slider showing the latest value; the
distribution function display (drawable; the screen shows a rising curve);
the histogram of recent values at the right. Three destination rows.

| Control | Type | Range / unit | Default (screen) | Position / group |
| --- | --- | --- | --- | --- |
| Rate | number | 5–5000 ms | 100 | left column 1 |
| Rate Randomness | number | 0–5000 ms | 50 | left column 2 |
| Damp Up | number | 0–1000 ms (params: 5000) | 20 | left column 3 |
| Damp Down | number | 0–1000 ms (params: 200) | 6 | left column 4 |
| Output Grain | number | 0–1000 ms (params: 5000) | 50 | left column 5 |
| Straight Distribution | button | — | — | above display |
| Latest value | vertical slider | 0–1 | — | left of display |
| Distribution | drawable function | 0–1 over 0–1 | straight | centre |
| Histogram | display | recent values | — | right |
| Top slider | slider | not documented | — | top |
| Mode / Assign ×3 | menus | as other modulators | set, set, off | rows |

Programs (8): Randomizer, Lopsided Peaks, Fast and Jerky, A Few Spikes, Alien
Terrain, Just Off Center, Ramp Up, Ramp Down.

**Signal flow.** Each interval is Rate plus a random 0–Randomness. A value is
drawn through the drawn distribution, then the output glides to it over Damp
Up (rising) or Damp Down (falling), updated every Output Grain while gliding.

**Here.** **Adjust** `Modulator::SampleHold`. Jitter breaks `floor(t × rate)`
as the step index, so: cut time into fixed blocks (10 s); each block's event
times and values come from a hash of (seed, block), the first event at the
block start; the glide into a block starts from the previous block's last
value. That keeps evaluation O(events per block) and a pure function of
time. Output Grain is the 8 ms tick and drops.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `rate` | Rate | 0.01–100 (= 1000 / interval) | 10 | yes | Hz |
| `jitterMs` | Rate randomness | 0–5000 | 50 | no | ms |
| `riseMs` | Damp up | 0–1000 | 20 | no | ms |
| `fallMs` | Damp down | 0–1000 | 6 | no | ms |
| `distribution` | Distribution | ≤32 weights over 0–1 | flat | | |
| `depth` / `seed` | as now | | 0.5 / 1 | | |

**Shared panel.** Modulator editor: Rate (primary), Randomness, Damp up, Damp
down in the original's column; the distribution drawn large with a Straight
button; a histogram of the values in the visible timeline beside it. Pad:
under a pad path, adds wander.

**Tests.**
- Jitter 0, rise/fall 0 equals today's `SampleHold` output for the same seed
  and rate.
- With jitter > 0, intervals measured over 1000 events lie in [interval,
  interval + jitter].
- A distribution with all weight in the top bin yields values ≥ 0.97 of depth.
- Evaluating block 5 alone and after blocks 0–4 gives the same values.

---

### Step Sequencer
*Pluggo 3.6.1, Cycling '74 · VST/MAS · `params.tsv`, manual pp. 200–201, screenshot p200-0. Patch encrypted; decoded programs partly misaligned.*

An analogue-style control-voltage sequencer: up to 32 steps drawn as bars,
stepped at a tempo-derived rate, with a portamento (Attack) and a decay
within each step (Sustain), sent to other plug-ins' parameters.

**Original interface.** ~356×196. The step display (bars) fills the left,
with a horizontal slider above and below it and a thin vertical slider on its
left (inferred: Min, Max, Master/position). Right column: Steps number and
Loop Time (ms) display; Sync menu (UDT) and Tempo; Note value (1/4) and
Multiplier; a number marked ">0" (inferred: Delay); two knobs (Attack,
Sustain). Three destination rows under the display.

| Control | Type | Range / unit | Default (screen) | Position / group |
| --- | --- | --- | --- | --- |
| Step values | bar display | 32 bars, 0–1 | 11 drawn | left |
| Min / Max | sliders | 0–127 | — | above / below display (inferred) |
| Steps | number | 0–31 | 11 | right column, top |
| Loop Time | display | ms | 1514 | right column, top |
| Sync Source | menu | UDT, Host, Plug | UDT | right column |
| Tempo | number | 1–300 BPM | 120 | right column |
| Step Note Unit | menu | 1 … 1/64 | 1/4 | right column |
| Step Time Multiplier | number | 0.001–100 (params 0.01–75) | 0.275 | right column |
| Delay | number | 0–500 (unit not stated) | 0 | right column (inferred) |
| Attack | knob | 0–1 | — | right, lower |
| Sustain | knob | 0–1 | — | right, bottom |
| Reset | button | — | — | under Sync (Free mode) |
| Master, Grain | hidden | 0–1; 5–1000 | — | not on screen |
| Mode / Assign ×3 | menus | | off | rows |

Programs (8): 11 Steps, Madness, Down the Chute, Convergence, Mirror, Black
Sheep, Slow Skyline, Fast Skyline.

**Signal flow.** Step time = (60 000 / tempo) × 4 × note value × multiplier
ms; the sequence loops over Steps steps. Each step glides from the previous
value over Attack (a fraction of the step, inferred), then relaxes toward
Sustain × its value for the rest of the step (inferred from "causes a
decay"), scaled between Min and Max.

**Here.** `Modulator::Steps` exists (rate in Hz, up to 64 values).
**Adjust**: add glide and sustain.

| Key | Label | Range | Default | Log | Unit |
| --- | --- | --- | --- | --- | --- |
| `rate` | Rate | 0.01–100 (steps per second) | 2 | yes | Hz |
| `values` | Steps | 1–64 values, −1..1 | — | | |
| `glide` | Attack | 0–1 (fraction of a step) | 0 | no | |
| `sustain` | Sustain | 0–1 (1 = hold) | 1 | no | |

**Shared panel.** Modulator editor: the bar display large (primary), drawn by
dragging, step count beside it; Rate with the tempo calculator; Attack and
Sustain as the original's two knobs; Min/Max become Depth and Offset by the
lane rules. Pad: under a pad path, a stepped pattern.

**Tests.**
- `glide` 0 and `sustain` 1 equal today's `Steps` exactly.
- `glide` 0.5: halfway into a step the value is the mean of the previous and
  current step values.
- `sustain` 0: at the end of each step the value is 0.

**Open questions.** What Delay, Master and Grain did; the decoded program
values disagree with the screenshot.
