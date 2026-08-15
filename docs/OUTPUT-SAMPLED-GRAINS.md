# Grains sampled from the output

*A design. Nothing here is built. It is the same idea as
[WAVETABLE-MODE.md](WAVETABLE-MODE.md) at a different time scale, and together
they make one instrument rather than two features.*

---

## The idea

Today a grain reads from the decoded source file. The proposal is that it can
read instead from **what just came out of the machine** — a ring of recent
output, so each grain is a short capture of the played-back audio, recirculated.

Output feeds grains feeds output. That is a feedback loop, and everything
interesting and everything dangerous about this follows from that one fact.

## It is not a mode, it is a mix

The control is **how much of a grain comes from the file and how much from the
ring**, per grain, continuously variable. Which gives one axis with the whole
family on it:

| mix | what it is |
|---|---|
| **0** | file granulation — exactly what the machine does today |
| **between** | the file continuously feeding a recirculating cloud |
| **1**, ring still being written | pure feedback: the machine sustains itself on its own output |
| **1**, ring frozen | the wavetable case — a fixed buffer, read forever |

That last row is the connection. **Wavetable mode is this design with the mix at
1 and the writing stopped.** Two things that were conceived separately turn out
to be the same mechanism at two ends of one control, which is a strong argument
that the mechanism is the right one.

## What it breaks — less than it first appears

The obvious worry is invariant 2: *grain randomness is a pure function of grain
index and seed, never a running generator*, because the waveform, the playback
and the export are three separate renders that must agree.

**The distinction that saves it: scheduling stays pure, only content becomes
recursive.**

- **When each grain starts, how long it is, its pitch, its pan, its envelope** —
  all still pure functions of index and seed. Nothing about the schedule depends
  on history.
- **What a grain contains** now depends on what came before it.

The visualiser draws the *schedule*. So invariant 3 — one enumeration shared by
the offline renderer, the real-time renderer and the picture — survives intact,
and the cloud can still be drawn ahead of the sound. What can no longer be
computed out of order is the audio, not the picture.

**Invariant 6 is the one that genuinely goes.** A windowed render can no longer
match a full render, because grain N depends on grains 1..N-1. But there is
already a precedent and already a category for it: stretch renders whole,
because WSOLA picks each splice from the previous one. This joins that
category rather than inventing a new problem.

**Invariant 11 survives.** *What you hear is what you export* holds as long as
the export starts from the same state and runs the same path. Deterministic
recursion is still deterministic — run it from silence at t=0 and it produces
the same audio every time.

## Causality: a grain can only read the past

A grain cannot sample audio that has not been produced yet. So there is a
minimum reach — at least a block, realistically at least the grain's own length.

That constraint is worth turning into a control rather than hiding, because it
is the most musical parameter in the design:

- **Short reach** — tight recirculation. Shimmer, freeze, self-oscillation.
- **Long reach** — granular echo, material returning transformed much later.

The ring's length is the maximum, and a few seconds is plenty.

## Where the ring is tapped

This decides what is inside the feedback loop, and it is the difference between
a curiosity and an instrument.

**Pre-rack** — the engine's own output. Effects stay outside the loop, so
nothing compounds.

**Post-rack** — the effects are *inside* the loop, and each pass through is
processed again. **This is where the good sound is.** A pitch shift in the loop
is what makes each pass rise an octave, which is shimmer. A filter in the loop
is what makes repeats darken. Compounding is the point, not a side effect.

*Proposal: tap post-rack, and specifically **after the channel maximiser**.*
Invariant 10 already guarantees that nothing gets past the final clamp above the
ceiling, so tapping there means the existing safety does the work of bounding a
runaway loop for free — rather than adding a second limiter to protect a
feedback path from itself.

## It can run away, and that is not a bug to be eliminated

Feedback at unity with any gain in the chain builds without limit. The maximiser
bounds the amplitude, but bounded is not the same as pleasant, and a resonant
filter in the loop will still find a frequency and scream.

The honest position is the one already taken elsewhere in this program: let it
be capable of that, clamp the output so it cannot damage anything, and do not
pretend the control is safe when it is not. Self-oscillation is a feature of
every instrument that has ever had a feedback path.

## What it gives you

- **Freeze** — mix to 1, stop writing the ring, and a moment sustains forever.
- **Regeneration** — a granular reverb that is made of the material rather than
  applied to it.
- **Shimmer** — pitch shift inside the loop, each pass an octave up.
- **Nested time scales** — the ring already contains grains, so sampling it
  gives grain-clusters as source material. Grains of grains, and then grains of
  those. This is the one that has no equivalent in file granulation at all.

## Consequences to design around

**Seeking becomes ill-defined at high mix.** Jump the playhead and the ring
still holds material from where you were, so the sound does not jump with you —
it bleeds across. That may be desirable, but it needs deciding rather than
discovering: clear the ring on seek, or let it smear.

**The ring is preallocated and never grows.** The same discipline as `Capture`,
which already reserves its space before recording starts because the callback
may not allocate. A few seconds of stereo at 48 kHz is a megabyte or so.

**Two renders of the same document no longer agree unless both start from
silence.** Which means the offline export must run from the beginning rather
than from the export range — the same thing stretch already does.

## Open questions

1. **Is the mix per grain, or one global blend?** Per grain is far more
   interesting — a cloud where some grains are file and some are feedback, with
   the proportion drifting — and it costs nothing extra, since each grain
   already reads its own source independently.
2. **Does the ring survive a file change?** Loading a new sound while a cloud
   recirculates the old one is either a bug or the best feature in the program.
3. **Does reach get its own jitter?** Everything else in the grain cloud does.
4. **Is the tap point selectable**, or is post-maximiser simply the answer?
5. **What happens at mix 1 with the ring empty** — at startup, or after a seek
   that cleared it? Silence that never recovers is a trap; some minimum bleed
   from the file would prevent it, at the cost of "pure feedback" not being
   quite pure.
