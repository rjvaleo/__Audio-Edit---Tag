# Dattorro Effect Design - module inventory

Source inventory for Jon Dattorro's three-part *Effect Design* tutorial. The
page-marked extractions live in `Reference Docs/md/dattorro-effect-design-part-*.md`.
Section numbers below are the paper's own and are the stable references used by
the DSP implementation and control descriptions.

The papers mix complete effects, reusable DSP primitives, modulators, and
analysis of finite-precision implementations. The rack exposes the first three
as patchable modules. Fixed-point-only implementation details remain documented
but are not presented as audible controls in this floating-point application.

## Reverberation and diffusion - Part 1, section 1

| Module | Paper section | Exposed controls | Role |
|---|---|---|---|
| Dattorro plate | 1.1-1.3 | predelay, input bandwidth, input diffusion 1/2, decay, decay diffusion 1/2, damping, modulation rate/depth, wet, dry | Complete modulated plate reverberator, including the input diffuser, figure-eight tank, and stereo output taps |
| All-pass diffuser | 1.3.1, 1.3.3 | delay, coefficient | Reusable first-order lattice all-pass section |
| One-pole damping | 1.3.5 | cutoff/damping | Tank bandwidth and high-frequency decay control |
| Modulated delay | 1.3.7; Part 2 sections 4-5 | base delay, depth, rate, interpolation | The reusable moving-delay primitive inside the tank and modulation effects |

The plate's published delay lengths and tap points are implementation constants,
scaled from the paper's sample-rate basis. They are not editable controls: changing
them creates a different topology rather than adjusting the described effect.

## Musical filters - Part 1, sections 2-3

| Module | Paper section | Exposed controls | Role |
|---|---|---|---|
| Cut/notch filter | 2.2 | center frequency, half-power bandwidth | Second-order musical notch with the paper's bandwidth definition |
| Resonator | 2.3 | center frequency, half-power bandwidth, gain | Second-order peak filter |
| Regalia-Mitra parametric EQ | 2.4-2.4.3 | center frequency, bandwidth, boost/cut | One topology continuously spanning cut, flat, and boost |
| Chamberlin state-variable filter | 3 | cutoff, resonance, drive, output mix | Simultaneous low-pass, band-pass, high-pass, and notch responses; the output mix exposes each response without duplicating the state |

The Regalia lattice forms and Chamberlin truncation/overflow discussions describe
fixed-point realization choices. Rust uses `f32`, so saturation and double-width
accumulator controls would misrepresent the paper and are not exposed.

## Fractional delay and time modulation - Part 2, sections 4-6

| Module | Paper section | Exposed controls | Role |
|---|---|---|---|
| Linear fractional delay | 4.2-4.6 | delay | Two-tap interpolation, including its characteristic high-frequency loss |
| First-order all-pass fractional delay | 5 | delay | Magnitude-preserving fractional delay with coefficient warping |
| White chorus | 6-6.1 | nominal delay, depth, rate, feedback, wet, dry, stereo phase, interpolation | The complete published chorus architecture |
| Flanger | 4.1, 6 | delay, depth, rate, feedback, wet, dry | Chorus topology in the short-delay range |
| Vibrato | 4.4.2 | delay, depth, rate, interpolation | Sinusoidally moving delay with no dry path |
| Doppler | 4.1, 4.4 | distance/delay, velocity/rate, wet | One-way delay motion interpreted as source movement |
| Pitch change | 4.4.3, 6.2 | ratio, interpolation | Constant read-pointer rate; duration changes with pitch |
| Pitch shift/harmonizer | 4.1, 6.2 | semitones, window, crossfade, feedback, wet, dry | Windowed pitch change that preserves output duration |
| Detune | 4.1 | cents, spread, wet, dry | Small opposing pitch shifts |
| Doubler | 4.1, 6.1 | delay, variation, detune, wet, dry | Short independently varied second performance |
| Leslie/rotating speaker | 4.1 | rate, acceleration, depth, stereo width, horn/rotor balance | Coupled amplitude, delay/Doppler, and stereo modulation |
| Polyphase resampler | 4.3, 5.1, 6.2 | ratio, quality/interpolator | Reusable sample-rate/pitch conversion primitive |

Echo is also named in section 6, but it is the fixed-delay/feedback configuration
of the same delay module rather than a separate algorithm. It is offered as a
preset/module façade because musicians patch it as an effect.

## Oscillators and control sources - Part 3, section 7

| Module | Paper section | Exposed controls | Role |
|---|---|---|---|
| Direct-form sine oscillator | 7.1 | frequency, phase, amplitude | Two-pole direct recurrence |
| Coupled-form oscillator | 7.2 | frequency, phase, amplitude | Quadrature sine/cosine state |
| Modified coupled oscillator I | 7.2.1 | frequency, phase, amplitude | First modified recurrence |
| Modified coupled oscillator II | 7.2.2 | frequency, phase, amplitude | Second modified recurrence |
| Normalized waveguide oscillator | 7.4 | frequency, phase, amplitude | Hyperstable normalized quadrature form preferred for moving control signals |

All five deliberately remain selectable. The paper treats them as distinct useful
realizations rather than a quality ladder. Audio-rate output is permitted, and
each may instead connect to a control input.

## Noise and random sources - Part 3, section 8

| Module | Paper section | Exposed controls | Role |
|---|---|---|---|
| Single-bit maximal-length PN | 8.2-8.3 | clock rate, word length/tap set, seed, level | Bipolar deterministic pseudonoise bit sequence |
| Multibit PN | 8.4 | clock rate, word length/tap set, seed, level | Uniform-amplitude word sequence from the same register |
| Equalized multibit PN | 8.4.1-8.4.5 | clock rate, word length/tap set, seed, level, equalization | Corrects the multibit generator's exponential spectral coloration |

The exhaustive tap tables in appendixes 6.1 and 6.2 are data used by these
modules, not controls. Invalid all-zero seeds are rejected.

## Patch graph utilities

These are connective tissue required to reproduce the paper figures without
hiding topology inside a bespoke effect:

- audio input and output;
- control constant;
- sum/mix and multiply/VCA;
- wet/dry mixer;
- feedback-safe delay;
- stereo split, merge, pan, and mid/side;
- control-to-audio and audio-envelope-to-control adapters.

Graphs are directed and acyclic between modules. Recursion described by a paper
(the plate tank, feedback delay, oscillators, and filters) remains inside the
corresponding module, where a sample of delay makes it causal. This prevents a
zero-delay patch cycle from hanging the real-time callback.

## Current placement contract

For this pass, every paper effect is strictly **post-granulator**. It receives
the mixed output of the current granular/stretcher player and runs in the same
live rack used by playback and export. Pre-granulator placement is deliberately
not part of this implementation.

The later modular view is a separate graph architecture. It must support several
granular player nodes concurrently, explicit audio/control ports, fan-out and
mixing. That work must not inherit the present document's single-player
assumption merely to reuse this serial rack UI.

## Implementation status

The current post-granulator rack implements the plate, all-pass diffuser,
damping filter, notch, resonator, Regalia-Mitra EQ, Chamberlin filter, chorus,
flanger, vibrato, echo, Leslie, harmonizer, detune, doubler, and all three PN
noise variants. Each module exposes its parameters through the shared effect
schema, so playback, export, preset persistence, and the control panel use one
definition.

The five oscillator realizations remain to be added to this serial rack.
Constant pitch change and the polyphase resampler change
stream length; the audio/control adapters, sums, VCAs, fan-out, and feedback
connections require graph semantics. Those are intentionally reserved for the
multi-player node engine rather than being disguised as serial audio effects.
