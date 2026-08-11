# Time stretching: the theories, and which of them we can build

A map of what the ingested papers actually describe, what each one is good and
bad at, and an honest estimate of what it would cost to add to this codebase.
Written against the papers in this folder, not from memory — each entry says
where to read it.

## Where we are now

**Everything on this roadmap is built.** Five engines exist, all in
`core/crates/fx`, chosen from one picker in the Time & Pitch panel:

| | File | Family | Candidate |
|---|---|---|---|
| **WSOLA** | `stretch.rs` | Time domain, overlap-add with a similarity search | 3 |
| **Phase vocoder** | `vocoder.rs` | Frequency domain, identity phase locking | 1, 2 |
| **PVSOLA** | `pvsola.rs` | Both — the vocoder, re-anchored by a splice | 6 |
| **Hybrid** | `hybrid.rs` | Both — separate, stretch each part its own way | 4, 5 |
| **Granular** | `grain.rs` | Time domain, deterministic grain schedule | — |

The last two rest on `decompose.rs` (median-filter separation into sines,
transients and noise) and `noise.rs` (spectral-envelope morphing onto fresh
noise). Candidates 7 to 10 below remain unbuilt.

What the estimates below got wrong is worth keeping. The costs were roughly
right, but the *order* of difficulty was not: the hard part of PVSOLA turned out
to be neither the vocoder nor the splice search but two details neither the
paper nor the estimate mentions — that the splice must not be cut from the
vocoder's overlap-add ramp-up, and that the cross-fade has to be linear rather
than equal-power because the search has just made both sides correlated. Both
were found by measuring, after a first version that was measurably *worse* than
the plain vocoder it was meant to improve on.

The other thing the estimates missed: a spectral measure cannot see phasiness at
all. Phasiness does not move energy to new frequencies, it moves partials out of
the phase relationship that gave the waveform its shape, and a magnitude
spectrum is blind to that by construction. The first test written for PVSOLA
measured spectral purity, reported a regression, and was measuring nothing.

## The two families

Nearly everything in these papers is one of two ideas, or a marriage of them.

**Time domain — cut and reassemble.** OLA, SOLA, WSOLA, TD-PSOLA, granular. Cut
the signal into windows, lay them down at a different spacing, and do something
clever about where you cut so the pieces still line up. Cheap, transient-safe,
phase-coherent by construction. Fails on dense polyphony: there is no single
"best" splice point when many pitches are present, so it smears.

**Frequency domain — analyse and resynthesise.** Phase vocoder and its
descendants. Take the STFT, advance the phase by what the frequency implies
rather than by what the hop implies, resynthesise. Excellent on sustained,
polyphonic, tonal material. Fails on transients (smeared) and on noise (the
famous "phasiness" — a watery, chorused quality), because forcing phase
coherence on a noise component is exactly the wrong thing to do to it.

Everything below is an attempt to keep one family's strength while borrowing the
other's.

---

## The candidates

### 1. Phase vocoder — the missing half

*Driedger thesis, "Phase Vocoder" chapter: STFT, phase propagation, artifacts.*

The canonical frequency-domain method, and the obvious gap in this app: we have
no frequency-domain stretcher at all. Estimate each bin's true frequency from
the phase difference between consecutive frames, then propagate phase at the
synthesis hop instead of copying it.

- **Good at** sustained, polyphonic, tonal material — strings, pads, chords.
  Exactly where WSOLA smears.
- **Bad at** transients (smeared across the window) and noise (phasiness).
- **Cost: low.** `audio_core::fft` already exists, with Hann windows and a
  tested radix-2 transform. This is a few hundred lines: STFT, phase
  accumulation, overlap-add resynthesis.
- **Verdict: build first.** Biggest quality gain per line of code, and every
  method below except the pure time-domain ones needs it as a foundation.

### 2. Phase locking — the cheap fix for phasiness

*Driedger, "Phase Propagation" and "Modifications for a simple implementation".*

A refinement of the above, not a separate engine. Rather than advancing every
bin independently, find spectral peaks and lock the bins around each peak to
their peak's phase, so a partial stays one coherent object instead of dissolving
into neighbouring bins.

- **Cost: very low** once the vocoder exists — peak-picking plus a region map.
- **Verdict: build with the vocoder.** Identity phase locking is perhaps thirty
  extra lines and removes most of the watery quality the plain vocoder has.

### 3. Transient-preserving WSOLA

*Driedger, "Transient Preserving WSOLA": anchor points, transient detection,
preservation, and — read this — its limitations.*

Detect transients, then pin them as anchor points so they pass through
unstretched while the material between them absorbs the stretch.

- **Good at** drums and percussive music at moderate ratios.
- **Cost: low–moderate.** We already have onset detection in
  `core/crates/search/src/lib.rs` (`rhythm()` counts onsets for the `density`
  dimension). That detector is built for description rather than for sample
  accuracy, so it would need sharpening, but the approach is proven here.
- **Verdict: strong second.** It directly improves the engine we already ship,
  and the thesis is candid about where it breaks, which is worth reading before
  committing.

### 4. Hybrid — split the signal, stretch each part properly

*Driedger's conclusion, and the premise of the noise-morphing paper.*

The insight that makes everything else make sense: no single method suits all
three components of a sound. Separate into **sines + transients + noise**,
stretch each with the method that suits it — vocoder for sines, splice for
transients, something else for noise — and sum.

- **Cost: moderate–high.** Needs a decomposition (median filtering across time
  and frequency is the standard cheap approach, and is genuinely simple), plus
  all three stretchers.
- **Verdict: the destination.** Not the next step, but the thing the next three
  steps are for.

### 5. Noise morphing

*`noise-morphing-for-time-stretching.md` — Moliner, Fierro, Wright, Hämäläinen,
Välimäki, 2023.*

The newest idea here and the one aimed squarely at what the others get wrong.
Sines and transients have good solutions; the *residual* never has. Rather than
stretching the noise, it time-interpolates the noise's spectral magnitude
envelope and imposes that on fresh white noise.

- **Good at** exactly the failure this app hits hardest — extreme ratios, where
  everything turns to metallic warble. Their listening test beats the
  state of the art at every stretch factor tested.
- **Cost: moderate**, but only *after* a decomposition exists. The morphing
  itself is simple; the paper stresses simplicity and efficiency as selling
  points.
- **Verdict: the most interesting thing in the folder** for a tool whose stretch
  range goes to 100×. Depends on #4.

### 6. PVSOLA

*`improved-pvsola-stretching.md` — DAFx-12.*

Phase vocoder with a periodic time-domain correction: every so often, stop
trusting the propagated phase and re-anchor with a WSOLA-style splice. The
enhanced version in this paper adds sinusoidal/noisy bin classification for
polyphonic material, and cuts latency toward real time.

- **Good at** being a single engine that is decent everywhere, rather than two
  engines with a switch between them.
- **Cost: moderate.** Needs the vocoder *and* WSOLA — we would have both.
- **Verdict: a good "one knob" default** once #1 lands. Note the real-time claim:
  our engine is real-time, so latency is a hard requirement, not a nicety.

### 7. Sinusoidal modelling / waveform preserving

*`waveform-preserving-stretch-sinusoidal.md` — Di Federico.*

Model the sound as tracked partials, stretch the model, resynthesise. This
paper's specific contribution is *relative phase delay* — describing each
partial's phase against the fundamental's rather than absolutely — so the
waveform shape survives the stretch.

- **Good at** quasi-harmonic single sources: voice, a solo instrument.
- **Bad at** anything inharmonic or noisy, and at polyphony.
- **Cost: high.** Partial tracking with birth/death of tracks is a substantial
  piece of machinery.
- **Verdict: later, if at all.** Narrow applicability for a sample library.

### 8. Instantaneous frequency distribution + partial tracking

*`stretching-via-instantaneous-frequency.md` — Lazzarini, Timoney, Lysaght.*

An alternative to the phase vocoder's frequency estimate: derive instantaneous
frequency from the IFD rather than from phase differences, then track partials.
Includes C++ for a working stretcher.

- **Cost: moderate–high**, and overlaps heavily with #7.
- **Verdict: a refinement to fold into the vocoder's frequency estimation if it
  proves weak**, rather than a module of its own.

### 9. TD-PSOLA and rhythm-aware SOLA

*`rhythmic-constant-pitch-stretching.md` — Trevorrow.*

Compares SOLA, TD-PSOLA and the phase vocoder, and proposes enhancements aimed
at one specific failure: **doubled and skipped rhythmic transients**, which is
what makes naive stretching of drums sound wrong.

- **Cost: low–moderate.** TD-PSOLA proper needs pitch-mark detection, but the
  rhythmic enhancements to SOLA are cheap and target a problem we have.
- **Verdict: read before building #3** — it is the same problem from another
  angle, and the fix may be cheaper than full transient preservation.

### 10. Artifact perception — not an algorithm

*`artifact-perception-in-time-stretching.md` — KTH.*

What listeners actually notice, and at which ratios. Not something to implement:
something to read before deciding what is worth implementing, and to steal a
listening-test design from. The thesis has its own listening test chapter too.

---

## How they'd plug in

The document already carries a stretch spec; the engine already reads it live.
Adding an algorithm choice means:

1. `fx::stretch::Quality` becomes, or is joined by, an `Algorithm` enum —
   `Wsola | PhaseVocoder | Pvsola | Hybrid` — with `Granular` already effectively
   a separate path.
2. Each algorithm is its own module in `fx/` behind one function with the shape
   `process(&self, input, channels, sample_rate) -> Vec<f32>`, which is what
   `stretch.rs` already exposes.
3. The real-time path is the constraint that decides the design. `engine/` calls
   the granular scheduler per block; a frequency-domain method needs a fixed
   analysis hop and some latency. Anything landing in the live engine must
   declare its latency, and the transport has to account for it.
4. The UI needs one control — an algorithm picker beside the quality tier.

**Suggested order:** phase vocoder with phase locking (1 + 2) → transient
preservation for WSOLA (3, reading 9 first) → decomposition (4) → noise
morphing (5). PVSOLA (6) whenever a single good default is wanted more than a
set of specialists.

Two honest caveats. Everything past step 2 is weeks rather than days, and the
real-time constraint is what makes it hard — offline versions of all of these
are considerably easier than ones that run in an audio callback without
allocating. And the granular engine already covers the extreme end well; these
methods are about the 1×–10× range where it is the wrong tool.

### What actually happened

Both caveats held, and the second decided the design. **Only the granular
engine runs in the audio callback.** The other four are offline renders folded
into the engine's source before playback starts, which is what the app was
already doing for WSOLA and the vocoder — so the two new engines cost nothing
new architecturally and are simply the slow end of an existing arrangement.
Measured on five seconds of stereo at 16×: vocoder 1.7 s, PVSOLA 4.6 s, hybrid
4.4 s, all linear in both length and ratio.

The plug-in list above is accurate except for point 4. One picker was not
enough: the five engines mean different things by every setting they share, so
each has its own standard column and its own extended column, and the shared
grain controls sit underneath reaching all five.
