# The grain shapes

Written 19 Aug 2026, when they were built.

A grain in the room used to be a dot with a short stick behind it. It is a solid
now — one of thirty-four, tumbling, drawn as wire. This is where they came from,
how they are built and how one is chosen.

---

## Where they came from

Seven reference sheets, in `Gran Shapes/`. Everything named on them is in the
catalogue:

| Sheet | What is on it |
|---|---|
| `3-d-shapes-list-of-geometric-shapes-3d-info.gif` | tetrahedron, square pyramid, hexagonal pyramid, cube, cuboid, triangular prism, octahedron, pentagonal prism, hexagonal prism, dodecahedron, sphere, ellipsoid, icosahedron, cone, cylinder |
| `3D-Shapes-Summary.jpg` | the same, and torus, hemisphere, rectangular pyramid |
| `Banner-02.webp` | the same, and pentagonal pyramid |
| `images (1).jpeg` | the same, and frustum of a cone |
| `image-30.png` | the Platonic five |
| `Projections-of-…-right-angle-simplexes.webp` | simplex wireframes, n = 7 … 21 |
| `images.jpeg` | uniform polyhedra: Toe, Tid, Ti, Tigid, Tiggy, Quith, Quit Sissid, Quit Gissid, Co, Oho, Cho, Id |

## Why they are wire and not solid

The shader has one light and it is the signal. There is no lamp in this scene,
no depth buffer, and everything else in the box — the room, the floor, the
rings — is edges over black with additive blending. A shaded face under that is
a flat bright patch with no form in it, and twenty of them stacked is a white
blob.

Edges stay legible at eight pixels and forty deep, which is the size and the
density a grain is actually drawn at. It also happens to be what the simplex
sheet shows, which is nothing but chords.

## Built, not stored

Every model is constructed from its definition when the page loads, not kept as
a table of numbers — the same reason the grain jitters are pure functions rather
than a recorded stream. A definition can be read and checked; six hundred floats
can only be trusted. The whole catalogue costs about forty milliseconds, once.

**The Platonic and Archimedean solids are given as coordinates and nothing
else.** Every uniform polyhedron is equal-edged, and that edge length is the
*shortest* distance between any two of its vertices — so the wireframe falls out
of the vertices with no face list to mistype. `gsNearEdges` is that rule.

**The Archimedean solids are cut, at a depth that is searched for.** Truncation
is one operation: move a fraction `t` along every edge away from every vertex.
Below a half it leaves a stub of each original edge; at exactly a half the two
cuts meet and it is rectification, which is where the cuboctahedron and the
icosidodecahedron come from. The depth that makes a solid Archimedean is the one
where the two kinds of edge are the same length, and it differs per solid — a
third for the octahedron, a shade under three tenths for the cube. It is a short
ternary search rather than a table of five constants, because a table is five
chances to write the wrong number and the search says out loud what makes the
answer right.

**The star half of the uniform sheet is built by spiking.** Quith, Quit Sissid,
Quit Gissid, Tiggy and Tigid are star forms, and what a star form *is* at the
size a grain is drawn is a solid with a spike on each face. They are built that
way and named that way — `spiked dodecahedron`, not `great stellated
dodecahedron`. An honest spiked solid is better to have in the catalogue than
something claiming an identity it misses by a few degrees.

**The simplexes are the golden spiral, fully chorded.** What carries from those
sheets is the chording — a dense knot of lines through a spherical shell, unlike
anything else here — not the particular projection.

**They are not simplexes, and the real ones now exist beside them.**
`ui/shapes-4d.js` builds genuine regular simplexes in five, seven and nine
dimensions, projected the way the sheets actually show, along with the five
regular 4-polytopes — see [`SHAPES-4D.md`](SHAPES-4D.md). Nothing here is
replaced: these three are good wireframes at eight pixels and forty deep, which
is what this catalogue is for, and a real 9-simplex projection is a different
picture rather than a better one.

### Three things that were wrong first, and how they read

Each of these produced a *plausible* picture, which is why they are worth
writing down: none of them looked wrong on screen.

- **The truncation search was reading a solid it had already flattened.** The
  skew it minimised was measured through `gsNearEdges`, whose band drops any
  edge more than 12% longer than the shortest — so at every depth except the
  right one, one of the two edge classes was invisible and the skew came back a
  perfect 1.0. A truncated dodecahedron came out with sixty vertices and thirty
  edges, three quarters of it missing, and nothing complained. `gsTruncateAt`
  hands its edges back now rather than having them recovered.

- **The face finder counted planes through the middle.** Spiking needs faces,
  and the first version walked a vertex's neighbours looking for rings. On the
  octahedron it found twenty-nine "faces" for a solid with eight: every flat
  quadrilateral cut through the middle is a ring, and none of them is a face. A
  face is a plane the whole solid sits on one side of, and `gsHullFaces` tests
  exactly that.

- **Grains changed shape in mid-air.** The tier a grain draws from was worked
  out afresh every frame from how bright and how near it was — and both of those
  fall as it travels. The tier is the *modulus* (`GRAIN_SHAPES[hash % cut]`),
  not a ceiling, so a tier change does not simplify a solid, it names a
  different one. A grain left the front of the room a pentagonal pyramid, became
  a truncated cube, then a pentagonal prism, and reached the back wall an
  octahedron. 1991 hashes in 2000 name a different solid at a different tier, so
  this was very nearly every grain in the room.

The check that catches the first two is Euler's: `V − E + F = 2`. A truncated
icosahedron has to be 60 vertices and 90 edges, and when it is, it draws as a
football.

The third took three attempts to write a test for, and the two failures are
worth more than the fix:

1. The first test asked `grainShapeFor` the same question twice **at the same
   tier** and confirmed it got the same answer. It could not have failed.
2. The second read the model **stored on the grain**, which is the one thing the
   fault never touched — the shape was chosen correctly at birth and then
   ignored at the draw. Putting the fault back on purpose left it green.
3. The third watched for **under a second of a fourteen-second journey**. A
   grain that young is as bright and as near as it was at birth, so the tier had
   not moved yet. Green again, with the fault still in.

What works is reading what the draw loop actually drew (`p.drawn`, via
`visGl.grainShapeNames()`) across three and a half seconds — a quarter of the
journey, over which the quiet grains cross two tiers. **Every one of those three
tests passed against known-broken code**, which is the only reason it is worth
writing down: a green test that has never been shown to fail is a green light
wired to nothing.

## Which shape a grain gets

Deterministic, from the grain's own index — the same discipline as every other
choice made about a grain in this program. The picture, the playback and the
exported file are three separate evaluations of one schedule, and a running
generator would give each of them a different answer. Same grain, same solid, in
the same attitude, every time.

**How intricate a shape it gets is how loud it is.** A grain drawn at eight
pixels cannot show the difference between a dodecahedron and an icosahedron, and
drawing thirty edges to prove it costs the same as thirty edges that could be
seen. The catalogue is sorted by edge count and cut into four tiers, and a
grain's tier comes from its level — **which it knows when it is born and never
revises**. Loud earns the intricate ones.

Its level, and not how near or how bright it is now. Those change as it
travels, and a tier that changes is a grain that changes shape; see the third
fault above.

That is also what keeps the cost honest without a cliff in it. A room holding
thousands of grains is a room of small ones, and small means cheap. Above that
there is a flat budget — `VG_GRAIN_LINE_CAP`, forty-eight thousand line
vertices — and grains are given wire until it is gone.

## Where it lives

- `ui/grain-shapes.js` — the catalogue and its constructors. Shares the global
  scope, like the other interface modules.
- `ui/vis-gl.js` — `VG_GRAIN_BODY`, `VG_GRAIN_SPIN`, `VG_GRAIN_LINE_CAP`, and
  the drawing, inside the grain layer.
- `tests/ui/grain-shapes.spec.mjs` — that every model is closed, unit and
  Euler-correct, and that the room really draws them.

Loaded before `vis-gl.js` in `ui/index.html`, embedded with `include_str!` in
`core/crates/server/src/routes.rs`, and served at `/grain-shapes.js`. **Rebuild
the binary after editing it** or the browser is served the old file.

## Filling them in

Off by default. On, each shape is drawn with a skin under its wires — and the
wires are drawn *after*, so **a filled grain still shows its own far side**. A
solid that hides its own back edges is a lump, and the tumbling is only legible
because you can see through it: the fill gives a grain a body, it does not close
it. That is the assertion the test makes.

Two ways to fill, and they are a state rather than one setting with a swatch:

- **The background.** Not a colour to paint. The room is drawn on glass with the
  page's own ground behind it, so filling with the background means taking the
  light already there back out — the same darkening pass the ring's border uses,
  because black cannot be added in a scene where everything adds.
- **A colour**, picked in the room editor. Painted on the faces flat, since
  nothing here is lit and a shaded face would be a lie about a light that does
  not exist. Picking a colour switches off the background fill, because a swatch
  that sits there doing nothing is worse than no swatch.

### The skins

Convex solids work theirs out from their own vertices — a face is a plane the
whole solid sits on one side of, which `gsHullFaces` already found for the
spikes. The ones that cannot say so:

- **The spiked solids** are not convex, and a hull would shrink-wrap the spikes
  back into the shape they grew from. Each spike states its own triangles.
- **The torus** has a hole, and a hull does not. Its own quads, or the fill would
  be a disc.
- **The simplexes have no skin at all.** A simplex is a graph rather than a
  surface — every pair of its vertices is joined and none of that is a face — so
  a filled one would be a ball with a lattice drawn on it.

A face arrives as an unordered set of coplanar vertices and is put in order
around its own centroid before being fanned. Fanning an unordered ring gives a
bow tie: the triangles cross, the winding alternates, and the solid has holes in
it that move as it turns.

