# The room built out of ridgelines

The stacked lines of the sleeve laid on the five surfaces of a room in
perspective — floor, ceiling, both walls, and the back wall — with one stream of
sound driving all of them. `ui/room3d.js` owns it. `docs/RIDGELINE.md` is the
flat version it is made of, and `docs/ROOM-VIEW.md` is the workspace it appears
in.

## A third module, not a replacement

`vis-gl.js` and `ridge.js` are untouched by this and keep working exactly as they
did. This is another entry in `VIS_MODULES` answering the same four-method
contract — `configure`, `clear`, `push`, `frame` — and it was built that way on
purpose: the two visualisers that work are not put on the table to build a third.

Adding it proved the contract is real rather than a coincidence of there being
two. The only places that needed changing were the ones that said "ridge or else
the room", and each of those was a two-module assumption written before there
was a reason to doubt it.

## Why an engine at all

One reason, and the whole feature turns on it: **the depth buffer**.

The flat stack hides the lines behind by filling under each one and drawing
near-to-far. That is a painter's algorithm and it works because the stack is flat
and the order is known in advance. Lay that stack on five surfaces facing five
directions and there is no single order to draw them in — the ceiling's near rows
are the floor's far ones, and a wall's rows cross both. Sorting that by hand, per
surface, per camera angle, is the entire problem.

A depth buffer does it for nothing. Each ridge is a solid ribbon standing off its
surface, the surfaces are drawn in any order, and what is in front is in front.
That is what an engine buys here, and it is why the flat stack never needed one.

The test for it is not that the room draws. It is that **standing the rows up
takes ink away**: relief that did not occlude could only ever add.

## A surface is four vectors

`o` is a corner, `u` runs across the ridgeline, `v` is the way the rows travel,
and `n` is the way a peak stands off. One mesh builder serves all five, because
a surface is only ever this much information.

| | across `u` | rows travel `v` | relief `n` |
| --- | --- | --- | --- |
| floor | width | into the room | up |
| ceiling | width | into the room | down |
| left wall | height | into the room | inward |
| right wall | height | into the room | inward |
| back wall | width | **upward** | toward you |

**The back wall is the odd one and is the point.** On the other four `v` is
depth, so rows are born at your feet and run away into the room. On the back wall
there is no depth left to run into, so `v` is up: rows are born at the bottom and
climb. That is the sleeve itself, in place, at the end of the room.

## Relief has to be small

The surfaces face each other. A peak on the floor grows towards the ceiling's and
a wall's grows towards the far wall's, so past about a third of the half-width
they meet in the middle and the room stops reading as a room — it becomes a
symmetrical knot with no inside. The default is a fifth, which shows relief on
every surface and leaves air in the middle.

The camera has the matching trap. The mouth of the room is two units across; at a
vertical field of 0.85 the eye has to stand about two back for that opening to
fit the frame. Closer and you are not looking into a room, you are inside one,
with the near edges of five surfaces sweeping past the lens. And with LIFT at
nought the camera is dead centre and the picture is mirror-symmetric in both
axes, which reads as a kaleidoscope rather than a room.

## The slide is a translation

Between one row arriving and the next, the whole stack travels one row-step along
its own surface. That is done by **moving the mesh**, not by rewriting every
vertex: the rows sit at fixed places in the buffer and the mesh is offset along
`v` by a fraction of a step. Rewriting sixty thousand vertices sixty times a
second is how an engine is made slower than the hand-written thing it replaced.

It works because `v` lies in the surface's own plane, so sliding along it keeps
every vertex on the surface.

## Determinism, which is what makes it safe to film

The film draws as fast as the machine manages and hands the renderer a clock. If
the same inputs and the same clock do not give the same frame, the export stops
matching the room and there is no way to tell by looking.

So nothing here reads a wall clock, nothing animates on its own, and `scene.render`
is called from `frame` rather than from a render loop of the engine's. This was
the one real risk in using an engine at all, and it is the one the tests watch
hardest.

It was also live for an afternoon. `clear` reset the rows but not the clock
bookkeeping, so `lastPushAt` carried over from the run before: the same rows
pushed the same way came out mid-slide the first time and flat the second.
`clear` now resets the clock too — starting again means starting again.

There is a trap in testing this, worth naming because the first version fell in
it. The slide is clamped at one push-interval, which is fifty milliseconds. Pick
two instants a second apart to prove the clock is read and both saturate, the
pictures match, and the test reports the clock ignored when it is being read
perfectly well. Both instants have to be inside one interval.

## Two lists of modules

`VIS_MODULE_KEYS` is a plain list of keys declared early; `VIS_MODULES` is the
real thing with canvases and attach functions and is declared much later.

They are two lists because they have to be. Stored settings are read at load,
which is before `VIS_MODULES` exists — and a `const` touched before its
declaration **throws** rather than coming back undefined, so reaching for it there
takes the whole script down.

Two lists that must agree is exactly the arrangement that quietly stops agreeing,
so a test keeps them in step. Without it, a module missing from the early list is
remembered, stored, and silently dropped on the way back in: the app opens on the
room every time with nothing on screen to say why. That happened, and it is
indistinguishable from the module being broken.

## The controls

| | |
| --- | --- |
| FACES | which of the five surfaces carry a ridgeline |
| DEPTH | how far the room runs back |
| ROWS / POINTS | how many rows a surface holds, and samples per row |
| RELIEF | how far a peak stands off its surface |
| SPAN | how much of a surface the lines run across |
| WINDOW | how hard the sound is pulled to the middle of each row |
| SMOOTH / GAIN | across the samples, and how hard the sound drives it |
| SILENCE | below this is drawn flat, and the auto-gain may not reach below it |
| EYE / LIFT / AIM / LENS | where the camera stands, what it looks at, and how wide |

Colours come from the same three slots the flat stack uses — Line, Fill,
Background — because they are the same picture flat and in a room.

## What is tested

`tests/ui/room3d.spec.mjs`:

- **all five surfaces are drawn, and each can be taken away.** Measured as ink
  over the whole frame with each surface switched off, not as ink in a box where
  a surface is expected — the first version sampled five rectangles, which really
  tested where the camera points, and a working room reported its floor missing
  the moment the eye moved. With every surface off the frame is empty, which is
  what says the five numbers are not all measuring the same thing.
- **the rows hide what is behind them**, as ink falling when relief is raised.
- **the same pushes and the same clock give the same frame**, twice, and a
  different instant gives a different one.
- **the film draws it at the film's size, on the film's clock**, and that clock
  advances.
