# Effect intake

*22 October 2026. Spec — not built.*

Every plug-in in `~/re-targets` that [HYPERPRISM.md](HYPERPRISM.md) does not
already cover now has a spec: 119 of them. Six already exist in the rack, 33
are changes to an effect that exists or is planned, 76 are new, and four have
no meaning in this program. The 76 new ones come to 51 new rack effects, six
instrument voices, two lane modulators, one MIDI binding and one visualiser
view, because several plug-ins share an effect. The specs are in
[`docs/effects/`](effects/), one file per family.

## The rule they follow

In the end every effect shares one interface, but each one's controls and
layout are taken from the original. So every spec does two things:

- It records the **original interface** as found: its layout, and every
  control's type, label, range, default and position, with its displays and
  presets.
- It specifies the **shared panel**: the same control vocabulary everywhere
  (dial, slider, switch, menu, number, XY pad, display), grouped the way the
  original grouped them, primary controls first, and a default
  [Prism pad](HYPERPRISM.md#the-pad) pair.

Each effect section also has its signal flow, its place in the rack with a
`ParamSpec` table, tests that can fail, and its open questions.

## Where it came from, and what could not be read

Nothing was run. Every source is a static file in `~/re-targets`.

- **Pluggo** keeps each plug-in's Max patch, published parameters, presets and
  menu choices in a resource file. Decoding those gave the ranges and preset
  values for all 109. The parameter IDs read backwards are the preset slots,
  so the preset tables are read by slot.
- **Only 12 of Pluggo's 109 patches could be read.** The other 97 are compiled
  code or protected: Cycling '74 encrypted them (`plugprot`), and that
  protection was left alone. For those plug-ins the signal flow comes from the
  manual, the parameter table, the presets and the screenshots, and anything
  beyond what those state is marked *inferred*.
- **The Pluggo manual** (`PlugInsReference.pdf`, 280 pages) has a screenshot of
  almost every plug-in. Those are the source for most of the Pluggo
  interfaces. Its contents page numbers run about two pages off.
- **SoundHack** plug-ins draw their interfaces in code. Freesound's manual has
  screenshots; the Delay Trio's has none, so its layouts are inferred from
  parameter order and labelled that way.
- **AmbientReverb and BizzareDelay** carry their panel art inside the DLL.
  **Aux Saturation** ships its SynthEdit panel art and layout files loose.

No code or manual prose was copied. Labels, ranges, preset names and on-screen
text are facts and appear as found.

## The specs

| File | Plug-ins | Exists | Adjust | New | n/a |
| --- | --- | --- | --- | --- | --- |
| [SoundHack](effects/soundhack.md) — Delay Trio, Freesound | 9 | — | 6 | 3 | — |
| [Windows](effects/windows.md) — AmbientReverb, Aux Saturation, BizzareDelay | 3 | — | 1 | 2 | — |
| [Pluggo: delays, reverbs, modulation](effects/pluggo-time.md) | 18 | 2 | 5 | 11 | — |
| [Pluggo: filters, ring, pitch](effects/pluggo-filters-pitch.md) | 17 | — | 1 | 16 | — |
| [Pluggo: distortion, dynamics, stereo, glitch](effects/pluggo-glitch-stereo.md) | 24 | 2 | 6 | 16 | — |
| [Pluggo: odd names and modulators](effects/pluggo-misc-modulators.md) | 18 | 1 | 7 | 10 | — |
| [Pluggo: instruments, analysis, utilities](effects/pluggo-instruments.md) | 30 | 1 | 7 | 18 | 4 |
| **Total** | **119** | **6** | **33** | **76** | **4** |

Each file opens with its own table: every plug-in, where it lands, and its
pad pair.

## What is new

### Rack effects (51)

| Family | New effects (plug-ins they serve) |
| --- | --- |
| Delay | `DelayPlus` (++delay), `FeedbackNetwork`, `LongDelay` (LongStereoDelay, Very Long Delay), `TapeEcho` (Space Echo), `TapNet`, `TappedDelay` |
| Reverb | `AmbientReverb`, `Chamberverb` |
| Modulation | `ChorusX2`, `StepFlanger` (Flange-o-tron), `Pendulum`, `Warpoon`, `AverageInjector` |
| Stereo | `Swirl`, `Nebula`, `OneByEight` (a one-in, eight-out panner; the program is stereo, so its spec says what eight outputs become) |
| Filter | `Comber`, `FilterTaps`, `Harmonic Filter`, `Mangle Filter`, `Moving Filters`, `Multi-Filter` (Multi-Filter, Multi-Filter[S]), `Phone Filter`, `Resonation`, `Resosweep`, `StepFilter` (Cyclotron), `Swish`, `WasteBand` |
| Spectral | `Spectral Filter`, `CrossSynth` (Convolver), `ChannelVocoder` (Vocoder 10-band, 16-band) |
| Pitch and frequency | `Frequency Shift`, `RingHf` (HF Ring Mod), `ShepardTones`, `Speed Shifter` |
| Distortion | `AuxSaturation`, `Chebyshev` (++chebyshev), `Fuzz` (PluggoFuzz), `Waveshaper` |
| Dynamics | `CurveDynamics` (Dynamical), `Limiter` (Limi), `StepGate` (Xformer) |
| Granular and glitch | `Bubbler` (++bubbler), `Fragulator`, `GrainToGo` (Granular-to-Go), `GrainDelay` (Rye), `GrainFreeze` (Wheat), `Raindrops`, `Shuffler`, `SquirrelParade`, `Stutterer` |

The granular ones sit closest to what this program is. Each spec says how it
relates to the five stretch engines and the grain controls, not only to the
rack. Cyclotron looked granular and is a stepped filter.

### Beyond the rack

- **Instrument voices (6 kinds, 17 plug-ins):** Additive, FM, Analog multi,
  Wave, Drum synth and Kit. They are sound sources, so they belong with the
  scale sequencer and Compose, not the rack.
- **Lane modulators (2):** `Follow` (Env Follower, Audio2Control) and `Chaos`
  (KnaveStories).
- **A MIDI binding** (M2M), recorded through Latch like the pad.
- **A visualiser view** (Light Organ).

### The four planned Hyperprism effects get more users

| Planned in HYPERPRISM.md | Also serves |
| --- | --- |
| Tremolo | Tremellow, Audio Rate Pan |
| Multi Delay | Sizzle Delays, BizzareDelay's stereo engine |
| Decimator | ++decimate, Degrader |
| Stereo Matrix | ++matrix, Center Channel |

## Decisions that cut across files

Each of these turned up in more than one file. They are infrastructure, and
they come before the effects that need them.

- **A tempo in the rack.** Eleven of the eighteen time effects sync to tempo,
  and so do BizzareDelay and several glitch effects. The rack has no tempo
  source. One `bpm` an effect can read, from the transport or the sequencer,
  serves all of them.
- **Table-valued parameters.** Waveshaper publishes a 256-point curve, and
  Breakpoints and LFO a drawn cycle. `ParamSpec` holds one number. These need
  a table field, saved with the slot and drawn in the shared panel.
- **A modulator editor.** The server already plays lane modulators, but
  nothing in `ui/` edits them. The modulator specs are, in effect, the spec
  for that editor. One rule to fix on the way: a lane with no points ignores
  its modulators (`curve_value` returns nothing), so adding a modulator to an
  empty lane has to lay down a point.
- **Scale as well as offset.** Pluggo's modulators can multiply a parameter;
  lanes only add. A `combine` field on the lane would cover it.
- **Where the instruments live.** Six voice kinds is a feature of its own.
  It needs its own plan, against [SEQUENCER.md](SEQUENCER.md) and
  [COMPOSE.md](COMPOSE.md), before any voice is built.
- **Listening to the originals.** Inferred signal flows are the weakest part
  of these specs. Where a file lists "listen to the original" as an open
  question, the answer has to come from running the plug-in on a machine that
  can, not from more reading. Nebula is the sharpest case: as decoded, a mono
  source at zero depth would cancel.

## Build order

1. **The infrastructure above**: tempo in the rack, table parameters, the
   modulator editor.
2. **The 33 adjustments**, which mostly add a few keys to existing effects and
   reuse their tests.
3. **The new rack effects**, family by family, granular first.
4. **The instrument voices**, after their own plan.

Each step follows the README: tests first, verified in the running app, and a
"Corrected during the build" note added to the spec it changes.
