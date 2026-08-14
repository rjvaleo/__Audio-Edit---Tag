# Witness

*A companion philosophy for the docked grain cloud*

Read [Precomputed Weather](PRECOMPUTED-WEATHER.md) first. That manifesto
describes the geometry: a granular cloud is a fixed object in several
dimensions, complete before the first frame draws, and animation is traversal
rather than creation. This one does not replace it. It adds the single
constraint that turns those views from an illustration of the engine into an
instrument that is part of it.

---

## The movement

The views in the standalone sheet are not lying, and it is worth being precise
about what was wrong with them, because the first version of this page got it
wrong in the other direction. That sheet is a faithful port of `fx::grain` —
the same splitmix64 over the same salts, so a seed there lands on the cloud the
engine would render. Its arithmetic is exact.

What it did not have was the *document*. Docked into the editor it answered to
its own sliders, so beside a waveform and a transport and a file that is
actually sounding it drew a cloud the engine *could* have made rather than the
one it was making. A perfect weather model of somewhere else.

**Witness** is the aesthetic position that a picture of a process must be made
of the same numbers as the process. Not similar numbers. Not numbers from a
model tuned until it matches. The same ones. Every dot on the screen is a grain
the speakers either played, are playing, or are about to play, pulled from the
one enumeration the renderer and the exporter also read. The picture cannot show
a grain that was not heard, and it cannot hide one that was, and that
impossibility is the whole of the aesthetic. Beauty here is a by-product of
refusing to invent.

This is a harder discipline than it sounds, and the difficulty is where the
craftsmanship lives. Invented data is *obliging*. It can be tuned until it looks
good — thinned where it clumps, spread where it thins, given a flattering
distribution. Real data has no interest in composing itself. A cloud parked on
one instant is a knot; a cloud at unity ratio is a diagonal thread; a cloud at a
hundred times is a sheet so flat it reads as a plane. The implementation must
find the framing that makes each of those legible **without touching the data**
— scale, camera, depth cue, falloff, painter's order — and that is a problem in
optics and staging rather than in generation. It is the work of someone who has
spent a long time discovering that the honest answer is almost never the first
framing they tried.

## Depth is the argument

Two axes can be drawn on a wall. The third has to be *earned* every frame, and a
point cloud that does not earn it is a scatter plot with wasted arithmetic.
Perspective alone is not enough; nor is size attenuation; nor is a slow
rotation. It takes all of them agreeing — near points larger, brighter and drawn
last, far points small and dim and drawn first, the whole volume turning slowly
enough to read as parallax rather than as spin. Get one of the three wrong and
the cloud collapses flat, and the failure is not subtle: it looks like a
mistake, because it is one.

The rotation must be meticulously judged. Too fast and the eye tracks motion
instead of structure. Too slow and the third dimension never resolves. Under the
hand it should feel weightless and stop dead when released, because a cloud with
momentum is a toy and this is an instrument. Every one of these is a number that
has to be found by looking, many times, at real material, and the difference
between a master implementation and a competent one is entirely in how many
times the author was willing to look again.

## What the axes owe

Across is the source. Up is pitch. Depth is time either side of now. That
assignment is not arbitrary and not free to change: it is the same triple the
engine itself computes for every grain, in the same order, so the picture is a
projection of the parameter space rather than a decoration derived from it.

But *across is distance from the read head*, not absolute position in the file.
This is the one concession, and it is a concession to optics rather than to
convenience: a cloud is a small cluster on the scale of a whole recording, and
an absolute axis renders it as a smudge against one edge — technically faithful
and practically blind. The absolute reading belongs on the waveform above, where
there is a whole file's width to spend on it. Here the volume is spent on the
cloud's own shape. A master implementation knows which fidelity each surface
owes and does not confuse the two.

## The seed is the soul

Nothing here accumulates. There is no particle system, no integration step, no
state carried from one frame to the next. Ask the algorithm for grain number
four hundred thousand and it answers immediately, without having computed the
three hundred and ninety-nine thousand before it, because every quantity in a
grain is a pure function of its index and one seed.

That is the quiet reference the whole thing is built around, and it is worth
stating plainly because it is what makes the picture possible at all. A running
generator would give the waveform, the playback and the exported file three
different clouds, and the visualiser would be reduced to showing something
plausible. A pure function gives all three the same one. Re-roll the seed and
the entire storm is replaced at once, every grain of it, without a single
parameter moving — and the picture, the sound and the file that gets written all
change together, in the same way, because underneath they were never three
things.
