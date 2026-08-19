# Grains emitted, not grains fitted

Written 18 Aug 2026, when it was worked out. Not built yet.

This is about the sound.

A grain is an event. It is spawned, it sounds for as long as it lasts, and it
ends — and none of that waits on the grain before it or makes room for the grain
after it. **A set number of grains is emitted each second, and how big they are
has nothing to do with how many there are.** Stretch, pitch and window shape the
linear sound; grains live outside that, spawned on their own, like shooting
stars.

That is not what you hear today.

## What you hear today

`fx::grain::plan` decides the hop two ways:

```rust
let hop = if g.density_hz > 0.0 {
    ((sr / g.density_hz) as usize).max(8)      // a fixed rate
} else {
    (base_size as f32 / overlap).max(8.0)      // derived from the window
};
```

`Grain::density_hz` defaults to `0.0`, so every document ever saved takes the
second branch, where the hop *is* the window divided by Overlap. At 40 ms and
2× overlap the schedule lays down fifty grains a second; at 200 ms it lays down
ten. The grains got longer and the cloud got thinner. That is the complaint, and
it is exactly what the arithmetic says will happen.

The first branch is already the behaviour we want, and there is already a
**Density** slider in front of it — 0 to 500, where 0 reads "auto". So the
emission model is half-built.

## The cloud needs a rate of its own

**The cloud is the granular engine — the thing that emits the grains you hear.**
This whole document is about sound. Where the room and the streaks come into it
they are a readout, and they are the last section.

The cloud's rate should be a control the cloud owns, and there is no such
control today. There is one field, `density_hz`, and every engine reads it:

```rust
Algorithm::Wsola   => hop_frames(&sp.grain, win, sr)
Algorithm::Vocoder | Hybrid => hop_frames(&sp.grain, fft_size, sr)
Algorithm::Granular => sp.plan().hop
```

and `stretch::hop_frames` reads the same `density_hz` field. For a window engine
the hop is not an emission rate at all — it is how far a *transform* advances,
and shortening it multiplies the work.

That has already been paid for once. The comment above the floor in
`hop_frames` records it: density at 91 Hz against an 8192-point window asks for
**15.5× overlap** where a phase vocoder normally runs at 4×, and on the
"Breaking Again" preset it measured **102.3% of the real-time budget with 101 of
200 blocks over** — not a spike, simply unplayable. The same preset at density 0
costs 13.8% and never misses. A floor of `win / 8` was put in to stop it.

So making density the default would reach straight into four engines that do not
want it:

| window | hop now (2×) | hop at 50/s | floored | resulting overlap |
|---|---|---|---|---|
| 40 ms | 960 | 960 | 960 | 2.0× |
| 100 ms | 2400 | 960 | 960 | 5.0× |
| 200 ms | 4800 | 960 | 1200 | 8.0× |
| 500 ms | 12000 | 960 | 3000 | 8.0× |
| 1000 ms | 24000 | 960 | 6000 | 8.0× |

At the default 40 ms window nothing moves. Past 100 ms the window engines go
from 2× overlap to the floor's 8× — four times the transform work — for a
setting that was only ever meant to describe grains.

**So the cloud gets a rate of its own**, and `density_hz` is left meaning what
it means to the window engines. One field is carrying two unrelated ideas: for
WSOLA and the vocoder it is a quality-and-cost knob on a transform, and for the
cloud it is how often something is thrown into the air.

To be plain about which way this cuts, because the finding is easy to read
backwards: it is not an argument for the cloud having less say over its own
rate. It is the reason the cloud cannot get that say by borrowing a field that
is already spoken for. The cloud ends up with more control, not less — a rate
that is its own, that the window no longer touches, and that no other engine
can be broken by.

## The gain law is safe only because of the coupling

`BlockRenderer::render` accumulates every sounding grain and divides the block by
the summed envelope:

```rust
out[f * channels + ch] += sample * win * pan;
self.norm[f] += win;
...
out[f * channels + ch] = out[f * channels + ch] / n * self.lift;
```

For one grain sounding alone that is `(s·w)/w = s`. **The envelope is divided
straight back out.** The grain plays flat, begins and ends at full amplitude,
and clicks at both ends.

You have never heard this, and the reason is the coupling itself: `hop = size /
overlap` *guarantees* grains overlap, so `norm` is always a sum of two or more
Hann windows and sits near unity. Take the coupling out and a low rate, or a
short window, leaves gaps — and every grain that finds itself alone in a gap
loses its shape and clicks.

Divide by `norm.max(1.0)` instead. Attenuate only where grains pile above unity;
leave the sparse places their envelopes, and let the silence between them be
silence.

What that does to loudness is worth saying out loud, because it is a real change
in how the instrument behaves:

- **Sparse** — below unity overlap, grains simply sum. Adding density adds
  level, the way adding stars adds light. Correct, and what the model implies.
- **Dense** — above unity, the division takes over and level holds steady while
  the texture thickens. Which is what it does today.

The knee is at exactly one grain covering each moment, which is also the point
where the cloud stops being able to reconstruct a signal and starts being a
scatter of events. The gain law and the aesthetic change hands in the same
place.

## At the ceiling, it drops the wrong grain

```rust
fn push(&mut self, event: GrainEvent, shape: Shape) {
    if self.live == MAX_VOICES {
        self.overflows += 1;
        return;
    }
```

When the pool is full the **new** grain is thrown away and the old ones are left
to finish. For a stretcher that is defensible. For an emitter it is backwards:
the newest grain is the one carrying the material you are listening for, and at
the ceiling the cloud would stop taking in anything new and slowly play out
what it already had — a smear that gets staler the harder you push it.

An instrument steals the oldest voice instead. That keeps the cloud current and
makes the ceiling sound like a limit on *how many at once* rather than a limit
on *how new*.

`MAX_VOICES` is 1024, and the comment sizing it reasons from "2000 grains a
second against a half-second window" — a thousand at once, which fits. That
arithmetic assumes the coupling too. Emitted freely, the number sounding at once
is `rate × window × layers`: a hundred a second, a two-second window, sixteen
layers is 3200.

## What the cloud becomes

Granular stops being a stretcher that happens to sound grainy and becomes an
emitter that can also stretch. Once the rate is free of the window, nothing
guarantees the grains cover the output, so a sparse setting will not reconstruct
the source — it will scatter pieces of it. That is the point, and it is also a
capability the engine did not have: at any density below unity overlap the
result is not a stretch of the sound, it is a sound made *of* the sound.

The read pointer is untouched. Scan, Position, the jitters and wrap all still
place each grain in the source exactly as they do now; there are simply more or
fewer grains sampling the same trajectory.

## Overlap becomes an observation

`overlap = rate × window`. The field stays so old documents open, and the panel
can go on showing the number, because how many grains cover a moment is worth
knowing. It stops being a thing you set.

This is also the answer to the obvious next idea — making the control read *how
many grains are playing* rather than how many are emitted. That number **is**
Overlap, and holding it fixed while the window grows is precisely what makes the
rate fall: the behaviour being removed. Emission is the rate; concurrency is the
consequence. Set the first, watch the second.

## The room, briefly

The master bus box maps **depth to time** — what you hear now is at the front and
travels away. A grain born at the near face and receding makes the two newly
independent quantities visible as two independent things: **how far back it gets
before it dies is its window; how many are born a second is the rate.** Across is
pan, up is pitch, the envelope is the brightness along the streak, and a grain
the pool could not hold is a ghost. The floor, sky and ladders do not move.

Detail in `docs/MASTER-BUS.md` and `ui/vis-gl.js`. It is a readout of the change,
not the change.

## Order

1. **A grain rate of its own**, separate from `density_hz`, so the cloud can be
   changed without touching WSOLA, the vocoder, PVSOLA or the hybrid.
2. **The gain law**, `norm.max(1.0)`. It has to land with the rate or the sparse
   settings click. Tests across `engine/tests/render.rs` and `fx/tests/` reach
   for density, overlap and window and need reading before they are trusted.
3. **Voice stealing** — oldest rather than newest, and a pool sized for
   `rate × window × layers`.
4. **Overlap becomes derived**, shown and not set.
5. **The room**, once the model underneath it is true.

## Undecided

- **What the default rate should be.** Fifty a second is a cloud; twenty is
  sparse and legible.
- **Whether saved documents inherit it.** Changing it retroactively means every
  session on disk sounds different when reopened; leaving them means the old
  coupling survives in exactly the documents most likely to be opened.
