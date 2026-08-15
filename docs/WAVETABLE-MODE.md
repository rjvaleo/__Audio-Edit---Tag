# Wavetable mode

*A design. Nothing here is built. It is what should happen below the point
where a loop stops being a loop.*

---

## The idea

Shorten a loop far enough and it stops being a loop. At 1,000 frames it is a
47 Hz pulse you can count; at 200 it is a 240 Hz tone you can sing. Nothing
about the mechanism changed — only the rate — but everything about what the ear
does with it did.

The machine should follow the ear. Above the boundary, wrap and crossfade
through the stretcher, as now. Below it, stop wrapping entirely and read the
loop region through a **phase accumulator**: a wavetable oscillator whose pitch
is set by the loop's length.

## The crossover is not an arbitrary number

Around 20–50 Hz, hearing switches from counting events to hearing pitch. At
48 kHz that is a loop of roughly 1,000 to 2,400 frames.

Which is, almost exactly, where the guard that has just been removed sat —
`LOOP_FADE_FRAMES * 2`, or 1,024 frames, 47 Hz. That threshold was chosen for a
completely unrelated reason (the crossfade needed room) and it landed on the
pitch/rhythm boundary by accident. The bug was not that the number was wrong. It
was that crossing it **stopped the machine** instead of **changing the
instrument**.

*Proposal:* the boundary lives around **1,024 frames**, kept as one constant
with both meanings written down, since it is now load-bearing for a musical
reason rather than a technical one.

## What the table is

Not the raw source. **The loop region, rendered once through whatever the engine
is currently doing.**

Everything gets baked in — the stretch ratio, the grain size and density, the
jitter, the pitch shift, the chosen algorithm. Whatever that region sounded like
becomes the waveform, and then that waveform is played as a tone.

Two things fall out of this, and they are the reason to prefer it over reading
the source directly:

1. **It is free at audio rate.** Oscillating is an interpolated read from a
   buffer. No WSOLA, no FFT, no `seek` per wrap — which is precisely the cost
   cliff that makes the wrapping path unusable down here.
2. **The granular character survives into the tone.** A cloud with heavy size
   jitter bakes into a waveform with that texture in it. The instrument at the
   bottom of the range is made of the instrument at the top.

## When it re-bakes

The crux of the whole design, because it decides whether this feels alive or
dead.

Rendered once and frozen, every control stops responding and the mode feels
broken. Re-rendered per block, the cost cliff comes straight back.

*Proposal:* **re-bake on parameter change, debounced — never per block.** Move a
control, and a moment later the table is new. That is exactly how a wavetable
synth behaves, and it is how this program already moves expensive things onto
the audio thread: `pending_rack`, `pending_map`, `pending_parts`, `pending_bank`
are all *built off the callback and adopted by it*. A baked table is one more
`pending_`, and it needs no new machinery.

The debounce is audible design, not an implementation detail: too short and
dragging a slider stutters as tables swap; too long and the instrument feels
unresponsive. It wants finding by ear.

## What sets the pitch

The loop's length. Rate is `sample_rate / (b - a)`, so shortening the loop
raises the pitch — the loop markers become a tuning control.

The existing pitch control then transposes on top, by resampling the table.
Those two multiply rather than fight: loop length is the fundamental, semitones
is the transposition.

## What collapses, stated honestly

Because a control that quietly stops meaning anything is worse than one that
says so.

| | below the crossover |
|---|---|
| **Time stretch ratio** | No longer stretches time — there is no time to stretch, only a table and a rate. It still changes *what gets baked*, so it is not inert, but it does something else. |
| **Grain size, density, jitter** | Baked into the waveform. They shape the tone rather than the rhythm. |
| **Position / scan** | The read head is parked. It selects *which* material becomes the table and then stops moving. |
| **The playhead** | There is no position, only a phase from 0 to 1. The transport's frame counter has nothing to count. |
| **Time-based automation** | Lanes addressing output frames have no frames to address. |

This wants showing in the interface rather than hiding: the controls that have
changed meaning should say so when the crossover is passed. It is the same
discipline as the "Not built yet" labelling — do not let a control look live
when it is not doing what its label claims.

## Making the boundary inaudible

A hard switch while sweeping the loop length would be a jump, and sweeping the
loop length is obviously going to be one of the pleasures here.

But it does not have to be. At exactly the crossover, the two paths are doing
nearly the same thing — the oscillator reads a table baked from the same region
the wrapping path is looping. **If the table is baked from that material, the
two agree at the boundary and the switch is free.**

That is worth building to deliberately, and it is testable in the way this
program already tests things: render a block either side of the crossover and
assert they match within a tolerance. It is the same shape as the invariant that
a windowed render must match a full render.

If they cannot be made to agree, a crossfade over a band — say 900 to 1,150
frames — is the fallback, at the cost of running both paths through the band.

## What this does to the invariants

**Invariant 2 survives untouched.** The table is baked by the same enumeration,
and grain randomness stays a pure function of index and seed. Bake the same
region twice and get the same table.

**Invariant 11 is the one that needs work.** *What you hear is what you export.*
The offline renderer must grow the same mode, or an export of a short loop will
be the wrapping path's output while the speakers were playing the oscillator.
This is not optional and it is not small — it is the real cost of the feature.

**Invariant 3 needs the visualiser told.** The picture is drawn from live
grains, and below the crossover there are none — there is a fixed table and a
phase. A grain cloud drawn there would be showing something that is not
sounding, which is the one thing [WITNESS.md](../visualiser/WITNESS.md) says the
picture may never do.

Which suggests what the picture *should* become: **the wavetable itself.** A
single cycle, turning, with the phase running around it. That is a better
picture than a cloud for this material, and it is a strong candidate for the
first thing built on the native pipeline.

## Open questions

1. **Is the crossover automatic, or a switch?** Automatic follows the ear and
   needs no explanation. A switch is predictable and never surprises. My
   instinct is automatic with an override, but this is a feel decision.
2. **What is the debounce?** Only findable by ear.
3. **Does the table interpolate, and how?** Linear is cheap and dull; cubic or
   sinc costs more and sounds better on a short table. A 200-frame table
   transposed up an octave is asking a lot of linear interpolation.
4. **One table, or a set?** A real wavetable synth sweeps *between* tables. The
   loop region could be sliced into several and swept — which would be a much
   bigger instrument, and is exactly the sort of thing that should wait until
   the simple version is making sound.
5. **Does the rack still run?** It should — the effects are downstream of the
   engine and have no opinion about where their input came from. Worth
   confirming rather than assuming.
