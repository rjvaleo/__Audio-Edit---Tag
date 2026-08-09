# Precomputed Weather

*An algorithmic philosophy for the granular engine*

---

## The movement

Weather is the standing example of a system too complex to predict — turbulent,
sensitive, alive. And yet a granular cloud, which looks and sounds exactly like
weather, is not unpredictable at all. Every grain in it is a pure function of its
own index. Give the algorithm a number and it will tell you, without reading a
sample or advancing a clock, precisely where that grain begins, how long it
lasts, which part of the source it reaches into, and how far out of tune it will
be. The storm is fully specified before it starts.

**Precomputed Weather** is the aesthetic of that contradiction: chaos that is
already written down. It rejects the usual generative posture in which the
artwork accumulates — where particles are stepped forward, state is mutated, and
the image is the residue of a simulation that had to be *run* to be known. Here
nothing accumulates. There is no state. The cloud is a fixed object in a space of
several dimensions, and animation is not creation but *traversal*: a cursor
sweeping through a structure that was complete before the first frame drew. What
looks like emergence is really revelation. The work does not become; it is
uncovered.

## The geometry nobody draws

Granulation happens in two times at once, and almost every visualiser collapses
them into one and loses the plot. There is the time at which a grain *sounds*,
and the time it *reaches back into*. These are different axes, and the ratio
between them — the stretch — is not a number but a **slope**. At unity the cloud
lies along a clean diagonal. Pull the ratio to a hundred and the diagonal
flattens into a sheet: output time races on while source time barely crawls,
which is the exact geometric statement of what extreme time-stretching *is*.
Position jitter is the thickness of that sheet. Pitch is the third axis, and
under drift the whole structure shears slowly like a deck of cards.

This plane is the philosophy's central image and it must be drawn with the
precision of someone who has spent years thinking about it. A meticulously
crafted implementation will make the stretch ratio legible *as shape* — a viewer
who has never read a line of the engine should be able to drag a slider and watch
geometry state the algorithm's meaning without a word of explanation. Anything
less is decoration.

## Brightness is not a metaphor

Every grain carries an amplitude envelope — it fades in, peaks, fades out. A
lazy visualiser assigns brightness by taste. A master-level one evaluates the
actual window function at the cursor's position and uses *that* as luminance, so
what glows on screen is not a symbol of the sound but a direct readout of it.
Grains ignite as the cursor enters them and go dark as it leaves. Where overlap
is high they pile into a continuous glow; where density is sparse they flicker as
discrete events. The image cannot disagree with the audio because it is computed
from the same equation.

This is the discipline the whole work depends on. Every quantity on screen must
trace back to something the engine actually computes — grain index, hop, source
frame, read rate, envelope phase — and never to a decorative variable invented
because it looked good. The product of deep computational expertise is not
complexity; it is the refusal to add anything that isn't earned.

## Five windows onto one object

Because the cloud is a fixed structure rather than a process, it can be looked at
from more than one side without contradiction — the same grains, the same
indices, re-projected. One view should state the shear geometry plainly. One
should wind time into a helix so that *overlap* resolves into countable strands.
One should let the cloud breathe as a free swarm, the form most people mean when
they say granular. One should sort grains onto concentric shells by pitch, so
that drift becomes a slow physical rotation you can watch rather than a parameter
you set. And one should begin as a perfect crystal — the bare hop lattice,
untouched — and let the jitter parameters melt it, so that the passage from order
to chaos is a single continuous gesture under the hand.

Five projections, one truth. Switching between them must feel like walking around
a sculpture, never like loading a different program. That coherence is only
achievable through painstaking optimisation of a single shared schedule, computed
once and reprojected — and it is the clearest evidence of an implementation built
by someone at the absolute top of their field.

## Determinism as the quiet subject

The deepest constraint is also the most beautiful one: identical seed, identical
weather, forever. Not approximately — bit for bit, on any machine, in any year.
The randomness here is not sampled from a stream that must be replayed in order;
it is *addressed*, like memory. Grain nine million can be evaluated without
computing the eight million before it. This is why the future can be drawn as
confidently as the past, why the cursor can be dragged backwards, and why the
cloud ahead of the playhead is already there, waiting, rendered as solidly as the
part behind it.

Let that be felt rather than announced. The palette should stay restrained and
the motion unhurried; the seed control should feel less like a randomiser than
like coordinates into an atlas of clouds that all exist simultaneously and always
did. Every easing curve, every falloff, every colour ramp must be tuned through
countless iterations until the whole thing reads as inevitable — the mark of a
meticulously crafted algorithm, refined with care by a practitioner who
understands that in this movement the artist's job is not to invent the weather
but to find the window.
