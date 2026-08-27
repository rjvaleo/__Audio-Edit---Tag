# The four-dimensional solids

Written 27 Aug 2026, when they were built.

`grain-shapes.js` already carried three shapes called `simplex 5`, `simplex 7`
and `simplex 9`. Its own comment was honest about them:

> The vertices are spread by the golden spiral rather than by a projection of
> the real thing, because what carries here is the *chording*.

They read well and they are not simplexes. The sheet they came off —
`Reference Docs/Gran Shapes/Projections-of-three-dimensional-images-of-multidimensional-right-angle-simplexes.webp`
— is showing genuine projections. `ui/shapes-4d.js` builds those, and the old
three stay where they are: they are good-looking wireframes and nothing here
replaces them.

## A 4D solid is not a model

That is the whole difference, and everything else follows from it.

A tetrahedron has one shape and the room turns it. A tesseract's silhouette *in
three dimensions* depends on how it is turned in four — two of its cubes swap
places as it rotates through the `zw` plane, and no amount of turning it in
three will do that. So a polytope holds its vertices in R^n and hands out a 3D
model on demand, in the same `{ pos, idx }` a `grain-shapes.js` model carries,
so anything that can draw one can draw the other.

## Rotation happens in a plane, not about an axis

In three dimensions "about the z axis" is really "in the xy plane". The axis is
a convenient stand-in that exists only because the orthogonal complement of a
plane in R³ happens to be a line. In R⁴ that complement is another plane, so
there is no axis to name, and there are **six** planes rather than three:

| Plane | Also a rotation in 3D? |
|---|---|
| XY, XZ, YZ | Yes — these are the familiar three under different names |
| XW, YW, ZW | **No.** These are the ones that do something you cannot otherwise see |

The panel marks the second three with `·w`. Cinema 4D's coordinates manager has
three rotation fields — H, P, B — and calling these that to seem more familiar
would be naming them after something that is not there.

The test that makes this real: turning a tesseract through **XY** leaves the set
of radii in its shadow unchanged — it poses the solid without changing what it
casts. Turning it through **ZW** changes the shadow's *shape*, and at a quarter
turn the two cubes have exchanged completely and the radii come back.

## The catalogue

Vertex and edge counts are **stated** in `SHAPES_4D` and checked by the tests,
because a construction that quietly produces 119 vertices of something that is
not a 600-cell still draws, and still looks like a knot.

| Solid | Dim | Vertices | Edges | Note |
|---|---|---|---|---|
| 5-cell | 4 | 5 | 10 | The simplex of four dimensions |
| 8-cell · tesseract | 4 | 16 | 32 | The hypercube |
| 16-cell | 4 | 8 | 24 | The tesseract's dual |
| 24-cell | 4 | 24 | 96 | Self-dual, and with no analogue in any other dimension |
| 600-cell | 4 | 120 | 720 | Built through φ, which is why the edge band is a band |
| Simplex · 5D | 5 | 6 | 15 | |
| Simplex · 7D | 7 | 8 | 28 | |
| Simplex · 9D | 9 | 10 | 45 | Six perspective divisions to reach three |

**The 120-cell is not here, and is not faked.** It is the sixth regular
4-polytope, 600 vertices and 1200 edges, and building it properly means deriving
it as the 600-cell's dual. Listing an entry that draws something else under its
name is the thing this file exists to stop doing.

The simplexes are real now: the `n + 1` basis vectors of R^(n+1) are already a
regular simplex, but they sit in the hyperplane where the coordinates sum to
one — a slice of a space one dimension too big. An orthonormal basis is built
for that hyperplane by Gram-Schmidt and the vertices re-expressed in it, which
is the same solid written in the `n` dimensions it actually occupies.

## Projection

Perspective is the one worth having. A vertex further away in `w` is drawn
smaller, so the inner cube of a tesseract is the *far* one rather than a smaller
cube sitting inside a bigger one — and turning through `zw` then swings the two
through each other. Parallel projection drops `w` instead, and every cell comes
out the same size.

`Eye` is how far down the `w` axis you are standing. It is held clear of the
furthest vertex rather than allowed to divide by zero, so there is no setting of
it that produces a hole in the wireframe.

Anything above four dimensions comes down one at a time by the same rule, so a
9-simplex arrives through six perspective divisions. That is what the projection
sheets are showing, and it is why those look like knots rather than cages.

## The panel

In the Room, on the **4D** tab — a fifth tab beside Room, Sound, Shape and
Colour, because what is in it is a different kind of thing: Shape is the room's
own geometry, this is a catalogue of objects with an attribute manager.

Laid out the way a modelling application is, deliberately. Anyone who has used
Cinema 4D, Blender or Maya already knows this shape, and the convention is worth
borrowing exactly rather than approximately — half a convention is worse than
none, because it invites the muscle memory and then breaks it.

- **The viewport**, on top. Wireframe over black with lighter strokes, depth
  carried by the stroke rather than by a depth buffer — there is not one here,
  and a wireframe with every line the same weight is a flat tangle.
- **The object manager.** A list. Selecting is the only thing it does, and what
  is selected decides what the rest of the panel is about.
- **The attribute manager**, grouped the way a modeller expects: Object,
  Rotation, Projection, Turning.
- **Scrubbable numbers.** Dragging sideways on a value changes it; shift is
  fine; double-click puts it back. This is the interaction that makes a
  modelling package feel like one, and the one people miss first when it is
  absent. Pointer capture, because the pointer leaves a 60px field immediately.
- **A clock**, because a 4D solid at rest is a still picture of a shadow. Pick a
  plane and a rate; `zw` is the default, being the one worth watching.

The panel is built from `SHAPES_4D`, so adding a solid to that table is what puts
it on screen. Its state is validated on load like everything else here — a
stored shape the catalogue no longer offers falls back rather than leaving the
panel pointing at nothing.

## What is not done yet

- The 120-cell.
- These are not yet available to the grain cloud as grain shapes. `s4Model`
  already returns what `vis-gl` draws, so what is missing is the decision about
  *when* a grain's 4D orientation should move and what it should follow.
- Nothing films them yet — the export path is the visualiser's, and this is a
  panel-side canvas.
