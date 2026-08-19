# Grains emitted, not grains fitted

Written 18 Aug 2026, when it was worked out. Not built yet.

A grain is an event. It is spawned, it sounds for as long as it lasts, and it
ends — and none of that has to wait for the grain before it or make room for the
grain after it. **A set number of grains is emitted each second, and how big
they are has nothing to do with how many there are.** Stretch, pitch and window
shape the linear sound; grains live outside that, spawned on their own, like
shooting stars.

That is not what the program does today.

## What it does today

`fx::grain::plan` decides the hop two ways:

```rust
let hop = if g.density_hz > 0.0 {
    ((sr / g.density_hz) as usize).max(8)      // a fixed rate
} else {
    (base_size as f32 / overlap).max(8.0)      // derived from the window
};
```

`Grain::density_hz` defaults to `0.0`, so every document ever saved takes the
second branch, where the hop *is* the window divided by Overlap. Lengthen the
window and the hop lengthens with it: at 40 ms and 2× overlap the schedule lays
down fifty grains a second, and at 200 ms it lays down ten. The grains got
bigger and the cloud got thinner, which is the complaint and is exactly what the
arithmetic says will happen.

The first branch is already the behaviour we want, and there is already a
**Density** slider for it — 0 to 500, where 0 reads "auto". So the emission
model is half-built. What is wrong is which half is the default, and the fact
that the control presents itself as an override of the real rule rather than as
the rule.

## The part that is not a default flip

`BlockRenderer::render` accumulates every sounding grain into the block and
divides the result by the summed envelope:

```rust
out[f * channels + ch] += sample * win * pan;
self.norm[f] += win;
...
out[f * channels + ch] = out[f * channels + ch] / n * self.lift;
```

For one grain sounding alone that is `(s·w)/w = s`. **The envelope is divided
straight back out.** The grain plays flat, begins and ends at full amplitude,
and clicks at both ends.

This is invisible today, and it is invisible for a reason worth stating
plainly: `hop = size / overlap` *guarantees* that grains overlap, so `norm` is
always a sum of two or more Hann windows and sits near unity. The gain law is
safe only because of the coupling we are about to remove. Take the coupling out
and a low density, or a short window, leaves gaps — and every grain that finds
itself alone in a gap loses its shape.

So the gain law has to change in the same breath: divide by `norm.max(1.0)`.
Attenuate only where grains pile above unity; leave the sparse places their
envelopes and let the silence between them be silence. A dense cloud then
behaves exactly as it does now, and a sparse one becomes what it is supposed to
be — separate events with air around them.

This is the whole difference between the change working and the change sounding
broken, and it is one line.

## The voice pool assumed the coupling too

`MAX_VOICES` is 1024, and the comment that sets it reasons from "2000 grains a
second against a half-second window" — a thousand sounding at once, which fits.
That arithmetic only holds while the window is what sets the rate. Emitted
independently, the number sounding at once is `density × window × layers`: a
hundred a second, a two-second window and sixteen layers is 3200, and grains
start being dropped.

`BlockRenderer::overflows` already counts them, which is the right instinct —
it was built to be seen rather than to degrade quietly. What it now needs is
either a bigger pool or an honest statement that density, window and layers
spend one budget between them.

## What Overlap becomes

An observation rather than a control: `overlap = density × window`. The field
stays so that documents written before this still open, and the panel can go on
showing the number, because knowing how many grains cover a moment is genuinely
useful. It stops being a thing you set.

This matters for the obvious next idea, which is to make the density control say
*how many grains are playing* instead of how many are emitted. That number is
Overlap, and holding it fixed while the window grows is precisely what makes the
rate fall — the behaviour we are removing. Emission is the rate; concurrency is
the consequence. The instrument should let you set the first and watch the
second.

## The room already knows what to do with this

The master bus is a box seen in perspective — an off-axis frustum, the spectrum
along the floor, the Lissajous in the sky, the ladders at the right — and its
organising idea is that **depth is time**: what you hear now is at the front and
travels away from you. See `docs/MASTER-BUS.md` and `ui/vis-gl.js`.

That is the mapping grains have been waiting for. A grain is born at the near
face and recedes. Depth is its age, and it winks out when its life ends. So:

- **How far back a grain gets before it dies is its window.** How many are born
  each second is its density. The two quantities we have just made independent
  become two visually independent things — the *length* of a streak and the
  *number* of streaks — and you can see at a glance that changing one has not
  touched the other. A short window at high density is a blizzard of sparks near
  the front face; a long window at the same density is the same number of stars,
  each drawing a streak deep into the room.
- **Across is pan, up is pitch.** Both already exist per grain — `pan_spread`,
  and the pitch jitter and drift — so a detuned cloud rises and falls and a wide
  one spreads out.
- **The envelope is the brightness along the streak.** `Grain::envelope` already
  sharpens the attack or makes grains swell; that reads directly as whether a
  star flares at the front or glows at the back.
- **Overflow is drawn.** A grain the pool could not hold appears as a ghost, so
  the ceiling is something you see rather than something you infer.

The floor, the sky and the ladders do not move. Grains fly in the air between
them, which is empty space today.

## Order

1. **The gain law**, `norm.max(1.0)`. It has to land first or everything after it
   clicks. Tests in `engine/tests/render.rs` and across `fx/tests/` reach for
   density, overlap and window and will need reading before they are trusted.
2. **Density becomes the default.** A real rate rather than `0.0`, and the window
   stops touching the hop.
3. **The voice pool**, resized or restated as a budget.
4. **Overlap becomes derived**, shown and not set, old documents still opening.
5. **Grains in the room**, once the model underneath them is true.

## Undecided

- **What the default density should be.** Fifty a second is a cloud; twenty is
  sparse and legible.
- **Whether saved documents inherit it.** Changing the default retroactively
  means every session already on disk sounds different when it is reopened.
  Leaving them alone means the old coupling lives on in exactly the documents
  most likely to be reopened.
