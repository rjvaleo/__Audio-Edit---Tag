# Hyperprism and SoundHack

*22 October 2026. Plan — not built.*

Hyperprism played every effect from one control: drag through a square and
two of the effect's settings follow your hand, and the drag can be recorded,
looped and edited as a path. This program already has the hard half of that —
a rack whose every control can be moved live, and an automation recorder that
turns a move into a lane — so the work is a pad that drives two controls at
once, a way to see the recorded path on it, and four effects the rack does
not have yet. SoundHack is the second half of the plan: its spectral
processes are what this program has least of.

## Where this comes from

Both programs are in `~/re-targets`:

- **Hyperprism-PPC 1.2.1** and 1.05, Arboretum Systems, 1996. Classic Mac,
  PowerPC.
- **SoundHack 0.896**, Tom Erbe, 2007. Mac OS X, PowerPC and Intel. Its
  manual, `SndHckDoc.pdf`, is beside it.

Everything below was read from the programs' interface resources and preset
files: menus, window and dialog layouts, control labels and ranges, and the
saved presets. No code was taken from either binary. The DSP here is written
fresh from what each process does, the way the rest of the rack was.

## The pad

### What Hyperprism did

Each process opened a controller window around one square, the *blue window*.
Its top edge was one setting and its left edge another, each with its own low
and high limit typed into the corners. Dragging set both at once. A record
button captured the motion, and Play, Pause, Stop and Loop replayed it. A
*path edit table* listed the recorded points for editing by number, and the
whole thing — limits, settings, path — saved as a preset. The preset file has
180 of them across 26 processes, and the longest is a 62 KB path on the Pitch
Time Changer.

### What it is here

A **Prism** tab on the Effects dock, in a new `ui/prism-pad.js`. It works on
one rack slot at a time:

1. **Pick a slot.** The pad lists the slots of the current file's rack.
2. **Pick the axes.** X and Y each choose one of that slot's controls. Each
   effect has a default pair from the process table below, so most of the time
   this step is already done.
3. **Set the limits.** Each axis has a low and a high, inside the control's
   own range. The pad maps its position into that window, so a small square
   can sweep a narrow, useful part of a wide control.
4. **Drag.** Each move sends both controls through `/api/rack/param`, the
   same path every rack control takes (`routes.rs` `api_rack_param`). Nothing
   about the effect needs to know a pad exists.

Positions are units, 0–1, like every automation lane. The pad's x becomes
`low + x × (high − low)` in unit space, and `automation::resolve` turns the
unit into the control's real value. That keeps the log sweep a control
declares (`ParamSpec::log`) without the pad computing it a second time.

Double-click centres the pad's dot, as double-click resets every control
here. The pad shows the two real values with their units at the edges, the
way Hyperprism printed them.

### Engine controls on the pad

Hyperprism's Pitch Time Changer put speed on one axis and pitch on the other.
Here those are the engine's Stretch and Pitch, which are document controls,
not rack controls. They are already automation targets (`STRETCH_TARGETS` in
`automation.rs`). So the pad accepts an engine pair as well as a rack slot:
one entry, **Time & Pitch**, at the top of the slot list.

## Recording a path

The recorder already does what Hyperprism's record button did; the pad only
has to use it.

- **REC on the pad** arms the recorder in Latch for the pad's two controls and
  rolls the transport, like REC PERF does for everything
  ([AUTOMATION-CAPTURE.md](AUTOMATION-CAPTURE.md)). Each drag lays points into
  `fx.<slot id>.<x key>` and `fx.<slot id>.<y key>`, which `rack_controls`
  already plays. The two lanes are named after the slot id, not its position,
  so the path follows the module when it is moved along the rack.
- **LOOP** sets both lanes' `loop_range` to the take's first and last frame.
  `Lane::value_at` already wraps a curve inside its loop range, and the
  modulators keep running on absolute time, so an LFO added under a looping
  path does not restart each pass.
- **Play, Pause and Stop** are the transport's.
- **The path on the pad.** While playing, a dot shows where the two lanes are
  now, and a fading trail shows the take. The pad needs both lanes as one list
  of points. A small new route, `GET /api/automation/path?slot=…&x=…&y=…`,
  returns `[frame, x, y]` at the union of the two lanes' points, evaluated
  with `curve_value`, so the pad never re-implements the curves.
- **Editing.** The path edit table is the Automation dock, which already edits
  lanes point by point. The pad adds one gesture: dragging a point of the
  drawn path moves the matching points of both lanes together.

### Saving

A pad setup — slot, axes, limits — is a preference of that slot, stored in the
rack spec beside its controls. Whether the recorded path belongs in an effect
preset, as it did in Hyperprism, or stays in the document's automation is an
open question below.

## The processes

Hyperprism 1.2.1 has 26 processes. Fourteen are here already and only need a
default pad pair. Four need a preset, a small change or an answer. Four new
effects cover the last eight processes between them.

| Hyperprism | X axis (Hyperprism's range) | Y axis | Here | Work |
| --- | --- | --- | --- | --- |
| Low Pass | Frequency, to 20 000 Hz | (unlabelled; resonance) | Chamberlin `lowFreq` / `lowQ` | Pair |
| High Pass | Frequency, to 20 000 Hz | (unlabelled; resonance) | Chamberlin `highFreq` / `highQ` | Pair |
| Band Pass | Frequency, to 2 000 Hz | (unlabelled; width) | Chamberlin `bandFreq` / `bandQ` | Pair |
| Band Reject | Frequency, to 2 000 Hz | (unlabelled; width) | Dattorro Notch | Pair |
| Phaser | Frequency | Depth | Phaser `rateHz` / `depth` | Pair |
| Flanger | Frequency | Depth, to 100 samples | Flanger `rateHz` / `depthMs` | Pair |
| Chorus | Frequency | Depth, to 100 samples | White chorus `rateHz` / `depthMs` | Pair |
| Ring Modulator | Frequency, to 4 000 Hz | Depth % | Ring `hz` / `mix` | Pair |
| Vibrato | Frequency | Depth % | Vibrato `rateHz` / `depthMs` | Pair |
| Echo | Delay, to 2 000 ms | Feedback % | Echo `delayMs` / `feedback` | Pair |
| Medium Room Reverb | Mix % | Feedback % | Schroeder `wet` / `decay` | Pair |
| Hall Reverb | Mix % | Feedback % | Moorer `wet` / `decay` | Pair |
| Noise Gate | Attack, to 1 000 ms | Threshold, to −96 dB | Gate `attackMs` / `thresholdDb` | Pair |
| Compressor | Volume dB | Compression dB | Compressor threshold / ratio | Pair |
| Single Delay | Delay, to 2 000 ms | Mix % | Echo, feedback 0 | Preset |
| Pitch Time Changer | Speed, to 200 % | Pitch % | Engine Stretch / Pitch | Pad accepts engine targets |
| Quasi Stereo | Depth % | Low cut, to 6 000 Hz | Doubler `delayMs` / `wet` | Add a low cut, or use Stereo Matrix |
| EchoTranz | Delay, to 2 000 ms | Feedback % | Echo | Open question |
| Pan | Balance, −100 to 100 % | Gain, to −96 dB | Stereo Matrix | New |
| Stereo Dynamics | Right−Left gain % | Right+Left gain % | Stereo Matrix | New |
| More Stereo | Stereo level, to 300 % | Low cut, to 6 000 Hz | Stereo Matrix | New |
| MS Matrix | Stereo position, −90° to 90° | Side volume, to 150 % | Stereo Matrix | New |
| Tremolo | Frequency | Depth % | Tremolo | New |
| Auto-Pan | Frequency | Depth % | Tremolo, stereo phase 180° | New |
| Multi Delay | Delay 1, to 1 000 ms | Delay 2 | Multi Delay | New |
| Sonic Decimator | Sample rate % | Bit depth | Decimator | New |

Hyperprism left the second axis of its four filters unlabelled in 1.2.1, so
resonance and width are this plan's reading, not something the resources say.

The older 1.05 also had a Comb Filter, Frequency Shifter, Ring Shifter,
Frequency Modulator, Doppler, Pitch Shifter, Envelope Follower and several
pans. Comb is the Flanger with no sweep, Doppler and Pitch Shifter are here
already, and the rest stay out of this plan.

### The four new effects

Each is a `ShapeKind` with a `ParamSpec` table, wired through `specs()` and
`make()` in `fx/src/shape.rs`. That is all a new effect needs: the UI draws its
controls from `GET /api/fx`, and the document, presets and automation pick it
up from the spec table.

**Tremolo.** A gain LFO. One effect covers two processes, because Auto-Pan is
a tremolo whose right channel runs half a cycle behind its left.

| Key | Label | Range | Default |
| --- | --- | --- | --- |
| `rateHz` | Rate | 0.05–20 Hz, log | 4 |
| `depth` | Depth | 0–1 | 0.5 |
| `shape` | Shape | sine → triangle → square, 0–2 | 0 |
| `stereo` | Stereo phase | 0–1 (1 = 180°, Auto-Pan) | 0 |

**Multi Delay.** Two taps with their own times, a shared feedback path, and
the taps panned apart so the pair is audible as two.

| Key | Label | Range | Default |
| --- | --- | --- | --- |
| `delay1Ms` | Delay 1 | 1–2 000 ms, log | 250 |
| `delay2Ms` | Delay 2 | 1–2 000 ms, log | 375 |
| `feedback` | Feedback | 0–0.95 | 0.3 |
| `spread` | Spread | 0–1 | 0.5 |
| `wet` | Wet | 0–1 | 0.5 |
| `dry` | Dry | 0–1 | 1 |

**Decimator.** Sample-rate reduction by hold, and bit-depth reduction by
rounding, with no anti-alias filter: the aliasing is the sound.

| Key | Label | Range | Default |
| --- | --- | --- | --- |
| `rate` | Sample rate | 1–100 %, log | 100 |
| `bits` | Bit depth | 1–24 | 24 |
| `mix` | Mix | 0–1 | 1 |

**Stereo Matrix.** One effect for the four stereo processes, all of which are
gains and a rotation on mid and side.

| Key | Label | Range | Default |
| --- | --- | --- | --- |
| `pan` | Pan | −1 to 1 | 0 |
| `gainDb` | Gain | −96 to 12 dB | 0 |
| `midGain` | Mid | 0–2 | 1 |
| `sideGain` | Side | 0–3 | 1 |
| `rotate` | Position | −90° to 90° | 0 |
| `monoBelowHz` | Mono below | 20–6 000 Hz, log | 20 |

Width already sets a mid/side balance with one control. It stays as it is,
because changing what an existing effect's saved values mean would change
every document that uses it.

## SoundHack

SoundHack is a file processor: open a sound, choose a process, set a dialog,
and it writes a new file. Most of its processes are spectral, and that is
where this program is thinnest. Its *Edit Function* dialog — draw a curve and
a setting follows it over the length of the file — is what automation lanes
already are here.

| SoundHack | What it does | Here | Work |
| --- | --- | --- | --- |
| Phase Vocoder | Time and pitch scale; band spacing; resynthesis gating | Vocoder engine, with Gate | Covered |
| Varispeed | Speed and pitch changed together, along a curve | Stretch and Pitch on the pad, or one lane each | Covered |
| Gain Change, Normalize | Peak and RMS analysis, gain, DC offset | Gain, Amp fit, DC | Covered |
| Spectral Analysis | Spectrum and sonogram views | Visualiser band spectrum | A sonogram view; out of this plan |
| Spectral Dynamics | Gate, duck, expand or compress each band; thresholds can come from a second file | — | New rack effect |
| Convolution | Convolve with an impulse file; ring-modulate and brighten options; a moving window | — | New rack effect |
| Mutation | Morph one sound toward another by the mutation functions USIM, ISIM, IUIM, UUIM and LCM, with an index Ω that can follow a curve | — | New offline process |
| Spectral Extractor | Split a sound into its stable partials and its transients, as two files | — | New offline process |
| Binaural Filter | Place a sound at an angle and height around the head, moving if the angle follows a curve | — | New; needs head-related transfer functions |

### Spectral Dynamics

An STFT, a gain per band from that band's level against its threshold, and an
inverse. The dialog's settings are the parameter list: threshold, ratio,
gate/duck/expand/compress, lowest and highest band, attack and decay, above or
below threshold, threshold relative to peak, smoothed amplitude, and
third-octave band grouping. The second-file threshold is the one setting a
rack effect cannot hold. It becomes a sound from the library, as the
Convolution impulse does.

### Convolution

The impulse comes from the library. A uniformly partitioned FFT convolver
keeps latency at one partition. *Ring modulate* multiplies the input by the
impulse in time — the manual's "ring modulation (or convolution in
frequency)" — and *brighten* is a +6 dB per octave high-pass on the impulse.
The full dialog, and every other SoundHack process, is in
[effects/soundhack-app.md](effects/soundhack-app.md). *Moving* steps the impulse window along the impulse file over time, and
needs an offline render rather than the rack, so it comes second.

### Mutation and Spectral Extractor

These two take a whole file, or two, and write a new one. They belong with
the program's other renders, not the rack, and come after the rack effects.

### Binaural

This needs a set of head-related transfer functions. The program's licensing
policy ([LICENSING-POLICY.md](LICENSING-POLICY.md)) decides which set can
ship, so the data choice comes before any code.

## Build order

1. **The pad**, on the fourteen pairs that exist. This is the feature;
   everything after it is more processes for it to play.
2. **The four new effects**, one at a time, each with its own tests.
3. **Path drawing and editing** on the pad, with the new path route.
4. **Spectral Dynamics** and **Convolution** as rack effects.
5. **Mutation** and **Spectral Extractor** as renders.
6. **Binaural**, once the transfer-function data is settled.

## Tests

Tests come first and must be able to fail, as the README requires.

- **Each new effect** gets Rust tests in `fx`. Tremolo at depth 0 is
  unchanged audio, and at depth 1 it reaches silence once a cycle. Auto-Pan's
  channels are in antiphase. Multi Delay's two taps arrive at their two
  times. The Decimator at 100 % and 24 bits is unchanged, and at 1 bit its
  output has two values. Stereo Matrix's rotate by 90° swaps mid and side.
- **The pad mapping** gets a unit test: a position inside the limits produces
  the unit value the formula gives, through `resolve`, for a log and a linear
  control.
- **Recording**: a Rust test that two writes through the pad's controls under
  Latch leave two lanes whose points share their frames. A loop range on both
  makes `value_at` wrap identically.
- **The path route** returns the union of both lanes' points with values from
  `curve_value`.
- **A Playwright spec**, `tests/ui/prism-pad.spec.mjs`, against the running
  app: pick a slot, drag, see both controls move in the rack; record, stop,
  see two lanes on the Automation dock; loop, see the dot move along the path.
- **`npm run check`** must pass: the new `ui/prism-pad.js` needs its three
  registrations (README: "Adding a file to `ui/` is three edits") and a default for every
  double-click reset.

## Open questions

- **Does the recorded path belong in an effect preset?** Hyperprism saved it
  there. Here a path is automation, which belongs to the document. A preset
  that carried lanes would change what a preset is.
- **What did EchoTranz do?** The resources name it and give it Echo's two
  axes, but not what made it different. If it transposes each repeat, it is a
  `transpose` control on Echo, with a pitch shifter in the feedback path.
- **Do the pad's limits belong on the slot or on the pad?** On the slot, they
  travel with the effect into presets. On the pad, they are a view setting.
- **One pad or several?** Hyperprism opened one controller window per
  process, side by side. One pad per selected slot is simpler; several pads
  are closer to the original.

## Corrected during the build

*22–23 October 2026. The pad, recording, the path and all four new effects
are built, and SoundHack's Spectral Dynamics and Convolution as rack effects;
the rest of SoundHack is in [effects/soundhack-app.md](effects/soundhack-app.md),
with its build order.*

- **The four new effects live in `prism-fx`**, the crate shared with idMLab,
  not in `fx/src/shape.rs` as *The four new effects* above planned. They reach
  the rack as `prism:tremolo`, `prism:decimator`, `prism:multi-delay` and
  `prism:stereo-matrix`, with the panels and pad pairs their descriptors carry.
- **Multi Delay** feeds its line the input's mid, and feeds back the average of
  the two taps, so each tap's repeats return through the other too. A moved time
  glides over a quarter-second time constant, which bends the pitch like tape.
- **Stereo Matrix** runs low cut, mid and side gains, rotation, then pan and
  gain, in that order. Its low cut at 20 Hz, the lowest setting, is out of the
  chain rather than merely low, so the effect is transparent at its defaults.

- **The pad is the Prism tab on the dock**, beside FX, in `ui/prism-pad.js`.
  `GET /api/pad` lists what it can drive — Time & Pitch first, then each slot
  with two or more controls (`server/src/pad.rs`) — with every control's range
  and a default pair. The EQ and the gain are not sources: the EQ draws its own
  curve, and the gain has one control.
- **Time & Pitch carries four controls**: Stretch, Pitch, Window and Cloud over
  engine. The default is Hyperprism's Pitch Time Changer: Stretch from 4× on the
  left to 0.25× on the right, so speed rises across the pad, and Pitch an octave
  each way up the pad. The grain controls are not on it yet.
- **Limits are values, not units.** The plan put them in unit space. Values are
  what Hyperprism typed into its corners, and what a person reads; the pad
  sweeps between them, logarithmically where the control does. A low above its
  high is allowed, which is how Stretch runs downwards. `the_pads_arithmetic_is_the_lanes`
  holds the pad's arithmetic to `resolve` and the stretch table for every
  control of every source.
- **Default pairs for the shapers** live on `ShapeKind::pad()`; for prism
  effects, in their descriptor's panel; for the compressor, in `pad.rs`. The
  three Hyperprism filters that map onto the Chamberlin share its one default
  (low pass); the others are a different pair chosen on the pad.
- **The open questions, as built.** The path stays in the document's automation,
  not in a preset. The limits are kept with the slot: the rack spec has a
  `pads` map, by slot id or `stretch`, checked against the source on the way in
  and dropped when its slot goes. There is one pad, on the source picked.
- **REC** arms the same recorder as REC PERF and rolls the transport; pressing it
  again stops the take. A drag goes through `previewStretch` or `liveParam`
  exactly as the sliders do, so nothing about recording is new. The two lanes'
  points need not share frames — the two controls are written separately — so
  `GET /api/automation/path` returns both lanes at the union of their frames.
- **LOOP** is `POST /api/automation/loop`, which sets both lanes' `loop_range`
  to the take's span, or clears it.
- **Not built:** dragging a point of the drawn path to move both lanes' points.
  The Automation dock edits them point by point meanwhile.
- **A prism effect's own panel has a small pad too**, from its descriptor's pair,
  inside its rack module. The Prism tab is the full one.
- **Checked in a browser, not by ear.** The UI tests run on the scratch server,
  which has no audio device, so recording is tested in Rust and the pad's
  feel is still to be judged on a real session.
