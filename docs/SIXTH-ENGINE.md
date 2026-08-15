# The sixth engine

> ## Built 15 Aug 2026. Pulled the same day. **There are five engines.**
>
> `Algorithm::Feedback` existed for about six hours: the grain cloud reading the
> machine's own output through a ring buffer on `Core`, written after the rack
> and before the fader, audio-thread only and lock-free. It worked, it was
> tested, and it exported what it played. The user tried it and said *"the
> feedback engine is useless too — pull it"*, so it is gone (`c2a4e54`) — the
> variant, `ringMix`, `ringReachMs`, `engine/src/ring.rs`, the picker button and
> its controls.
>
> **This document is kept as the record, not as a plan.** Everything below
> describes what was built and why it was built that way. Three things outlived
> it and are still in the program: the WSOLA splice-search bound, the tail decay
> on the paused branch, and the test harnesses written to prove the ring worked.
>
> The **wavetable half was never built**, and its argument does not depend on any
> of this — a grain exactly one loop long, repeated with no gap, *is* a wavetable
> oscillator. If that is ever built it will not be built on a ring. See
> [WAVETABLE-MODE.md](WAVETABLE-MODE.md).

*A design, written before any of it existed. It replaces the framing in
[WAVETABLE-MODE.md](WAVETABLE-MODE.md) and
[OUTPUT-SAMPLED-GRAINS.md](OUTPUT-SAMPLED-GRAINS.md) — those describe two
features, and this describes the one engine they turn out to be.*

---

## Which of the five it grows from

| | domain | cost | verdict |
|---|---|---|---|
| WSOLA | time | correlation search | Tempting — it is already recursive, each splice chosen from the previous. But its search assumes coherent material, and a recirculating ring is *self-similar*, so correlation would keep finding spurious matches. Transient preservation is also beside the point here. |
| Phase vocoder | frequency | FFT per hop | Expensive inside a feedback loop, and it goes watery on noise. Feedback makes noise. |
| PVSOLA | both | ~2.5× vocoder | Too expensive to run recursively. |
| Hybrid | both | ~5× vocoder | Far too expensive. |
| **Granular** | time | cheapest of the five | **This one.** |

Four reasons, and then the one that decides it.

1. Grains are already **independent reads** — changing where a grain reads from
   is a change of pointer, not of algorithm.
2. It is the only one **not trying to be transparent**. Its documented job is
   texture at extreme ratios, which is the right posture for an engine whose
   whole character is recursion.
3. It is the **cheapest per output frame**, which matters when the output is fed
   back into the input.
4. Its randomness is already a **pure function of index and seed**, so the
   schedule stays pure even when content goes recursive. That is the property
   that lets the visualiser keep working — see below.

## The decisive one: the wavetable is not a second mechanism

**A grain exactly one loop long, repeated with no gap, is a wavetable
oscillator.** Same read, same envelope, same machinery — only the length and the
spacing have changed.

So the sixth engine does not need a wavetable mode bolted onto a granular mode.
It needs the granular engine it already has, with the two controls pushed to
their limits.

## The whole engine on two controls

**Source mix** — how much of each grain comes from the file and how much from
the ring of recent output. **Grain length against the loop** — many grains per
loop, or one grain that *is* the loop.

|  | many short grains | one grain = the loop |
|---|---|---|
| **from the file** | the granular engine as it is today | plain looped playback |
| **from the ring** | recirculating cloud — freeze, shimmer, regeneration | **wavetable** |

Four corners, two knobs, one engine. Everything in the two earlier documents
lives somewhere on that square, and the interesting territory is between the
corners rather than at them.

---

# How the picture follows

Five surfaces draw this today. Each one means something different once the
source can be the ring, and the honest handling differs for each.

| surface | from the file | from the ring | wavetable |
|---|---|---|---|
| **Large overview** (whole file) | the file, read region travelling | the file, with the region the ring was *filled from* — the read head is parked | the region that became the table, frozen |
| **Main lane waveform** | the file at zoom | unchanged — still the file | unchanged; the table is shown elsewhere |
| **Grain layer** over the lane | grains at their source positions | **grains sourced from the ring cannot be drawn at file positions** — see below | one grain, spanning the loop |
| **Cloud pad** in the stretch panel | the read band and cloud | same, plus the ring's fill | replaced by the waveshape view |
| **Swarm**, 3D and 2D | the cloud at the playhead | unchanged in kind — the schedule is still pure | degenerate: one repeating grain is not a cloud |

## Three views, not eleven

The panel drops from ten views to **two — Swarm 3D and Swarm 2D — plus the
waveshape view for wavetable.** Shear, Braid, Shells, Lattice and the whole V2
suite go.

That is partly taste, and the rest is forced by this engine.

**The object views cannot survive a ring.** Shear is *output time against source
time* — the stretch drawn as a slope. Braid winds source time into a helix.
Shells maps an octave to a shell. Every one of them has **source position** as a
structural axis, and once a grain reads from the ring there is no source
position for it to have. They would not degrade; they would be drawing an axis
that no longer exists.

**The moment views do survive**, because they are about *now* rather than about
the file. Swarm shows the grains within a horizon of the playhead, and that
question stays meaningful whatever the grains are reading. This was already the
better view before the sixth engine existed — the rewrite from a closed object
to a moment is what made it good — and the engine now makes it the only kind
that can be honest.

So the cut follows the same rule as everything else here: **keep what can still
tell the truth.**

Two dimensionalities of one view is deliberate rather than redundant. 2D is
cheap, legible and reads at a glance while editing; 3D is the one to look at.
Same data, same enumeration, different spend.

**And it makes the port affordable.** Each surviving view is rewritten by hand
in WGSL. Two and a waveshape is a fortnight; ten was the largest single line
item in the roadmap.

## The thing WITNESS will not allow

In ring mode a grain's source position refers to **the ring, not the file**.
Drawing it on the main waveform at a file position would be showing a grain
reading material it never read — precisely the lie
[WITNESS.md](../visualiser/WITNESS.md) exists to forbid.

Two ways out. Relabel the axis, which is honest and dull. Or **draw
ring-sourced grains differently from file-sourced ones** — a different colour or
mark — so a cloud at 40% mix visibly *is* forty per cent one thing and sixty per
cent the other.

The second is better, and not only for honesty: the source mix becomes something
you can see as well as hear, which is exactly the argument the goniometer
document made about controls that can be *watched* changing.

## The isometric waveshape view

The new one, and it earns its place well beyond this engine.

A waveform is always, locally, a waveshape. Take successive short windows of the
audio, stack them receding into depth, and highlight the one currently sounding:
that is a legitimate view of *any* material, in any engine. It is also exactly
what a wavetable synth shows — except that here the slices are real successive
windows of real audio rather than a synthesised table.

Which makes it the honest version of a familiar picture, and WITNESS-compliant by
construction: every slice is audio that was or will be played.

**In wavetable mode it becomes the main view**, because there the table *is* one
of those slices, held. The playhead stops being a position along a file and
becomes **a line across the waveshape** — the phase, running around one cycle,
with the neighbouring slices visible behind and ahead as the material the table
would become if the read head moved.

**Where it goes:** the stretch panel, where `cloudPad` sits now. That surface is
about the cloud, and in wavetable mode there is no cloud — so it is the natural
place for the view that replaces it.

## Grains on the main waveform, in p5

`drawGrainLayer()` already overlays grains on the lane. Moving it to p5 puts it
in the same visual language as the panel views, which is worth having for its
own sake and is the prerequisite for drawing ring-sourced grains distinctly.

The one caution: this is the surface the eye reads while *editing*, so it wants
to stay legible rather than becoming a tenth visualiser. Small marks, honest
positions, no atmosphere.

---

## What it needs that the other five do not

**The ring is transport state, not stretcher state.** It is written after the
channel maximiser — so invariant 10's clamp bounds any runaway for free — and
read by the engine. None of the other five needs access to anything the
transport owns, so this is the one genuinely new piece of plumbing and the place
to start.

## Open questions

1. **Does the source mix live per grain or per engine?** Per grain is more
   interesting and costs nothing, since each grain already resolves its own read
   independently.
2. **Do the two controls stay independent, or is there a single "collapse" macro
   that moves both?** The square has interesting corners, but a one-knob path
   from cloud to tone is the thing that would get played.
3. **Does the isometric view replace `cloudPad`, or sit beside it?** Replacing is
   cleaner; sitting beside means both are visible during the collapse, which is
   when you most want to see what is happening.
4. **How are ring-sourced grains marked?** Colour is the obvious answer and the
   palette is already carrying pitch.
*(The handover question is settled — see below.)*

## The collapse is one number, and it drives both

Neither a hard switch nor two separately chosen views: **Swarm and the waveshape
view crossfade**, and the thing that drives the fade is the same thing that
drives the sound.

The collapse already exists as a value. Grain length against the loop is one of
the two controls, and it runs from *many grains per loop* to *one grain that is
the loop*. Normalised, that is a scalar from cloud to tone. It is **derived, not
a new control** — nothing extra to invent or to expose.

That scalar drives:

- **the audio**, if the boundary turns out to need a crossfade band at all
  (see [WAVETABLE-MODE.md](WAVETABLE-MODE.md) — the hope is the two paths can be
  made to agree at the crossover and the switch is free)
- **the picture**, always

And if the audio does need a band, **it is the same crossfade**. One value, one
transition, heard and seen together. A visual fade that ran on its own timing
would be showing a collapse that was not happening yet — the same class of lie
as drawing a grain where it did not read.

## It is one scene, not two panels

The important implementation note, because the obvious reading is wrong.

This is **not** one canvas fading out while another fades in. Both views live in
the same volume, and the crossfade is an alpha blend of two draws in a single
scene: the cloud **thins** as the waveshape **condenses** in the same space.

That is a far better picture than a dissolve between panels, and it is the thing
already asked for in another form early on — grains decaying like radioactive
particles, leaving a trail of smoke and an after-image. The collapse is exactly
that: a cloud losing its members while a single shape resolves out of where they
were.
