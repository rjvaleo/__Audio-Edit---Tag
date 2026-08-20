# Editing the room by dragging the room

Written 18 Aug 2026, before the work, as the design being built to.

The master bus box has a shape and a camera, and both are currently five
constants at the top of `ui/vis-gl.js`. They were chosen for one frame shape — a
wide panel in a dock — and they are about to be asked to work at 16:9, 1:1, 4:5
and 9:16, because that is what the video export offers. See
`docs/VIDEO-EXPORT.md`.

Those numbers need to be found by looking, not by arithmetic. So: **you edit the
room by dragging the room.**

## Why not a panel of numbers

This has already been learned here once, in a different corner, and it is
written down because it did not stick.

`a17c3ce` replaced the first theme editor, which was three `<input
type="color">` in a panel. Its own commit message is the argument: *"Nobody
chooses a theme by typing `#0e1116` — that is a developer's idea of a colour
tool, and it was the wrong thing to build."* What replaced it was five strips
you drag, each painted along its length with what it does, so the choice is
visible before it is made.

Then `256249e` ported a theme studio in over the top of it, and what is on
screen today is a name field and five hex codes. The version that had to be
argued for was replaced by the version it was written to replace, and the result
is unusable.

A room is worse than a palette for this, not better. `VG_FLOOR_Y = -0.38` against
`VG_CEIL_Y = 0.62` is not a number anyone can picture; what it means is *how far
you are looking down*, and the only way to choose it is to look down and see. A
field with `-0.38` in it puts a spreadsheet between you and the room.

**So there are no inputs.** Every control is a grab on the thing it changes.

## Why not a miniature either

The theme editor's miniature was right for the theme editor and the reason is
specific: a theme repaints the whole interface, so a control that applies on
every pointer move makes the thing you are judging jump under your hand. The
miniature holds still while the real interface does not have to.

The room has nothing around it to disturb. It is one canvas, and it is already
the thing you want to look at. There is no interface to protect from the edit,
so the edit happens on the real box at its real size, live, and the miniature
would only be a smaller worse copy of what is already on screen.

## The gestures

| grab | changes |
|---|---|
| inside the room | swings the view |
| the horizon | the eye line — where you are looking from, up and down |
| the back wall, or scroll | depth, pulling the room longer or shorter |
| the ring | its height up the room, and its size |
| the floor's near edge | how much of the frame the floor takes |

The eye line is the one worth naming properly, because it is the camera angle
under another name. The room is drawn with an **off-axis frustum**: the camera
stays square to the frame and the frustum is shifted instead, which is what puts
the vanishing point above the middle so you can see the floor, while the front
face still lands exactly on the edges of the canvas. `VG_FLOOR_Y` and
`VG_CEIL_Y` are not two independent numbers — their asymmetry about zero *is*
the tilt. Dragging the horizon is dragging that asymmetry, which is why it is
one gesture and not two fields.

## The frame selector, which is the point

Dock · 16:9 · 1:1 · 4:5 · 9:16, switching the real box to that shape while you
work.

Without this the tool is not worth building. The room lives in a wide dock, the
frames that need designing are square and tall, and nobody can tune a portrait
composition by looking at a landscape one and imagining. The whole reason the
constants fail at 9:16 is that they were chosen while looking at 16:9.

Each frame keeps its own camera. That is what the video export reads when a size
is chosen, so picking Vertical in the export box gets the camera that was
designed for vertical rather than the wide one squeezed.

## Portrait is probably isometric, and that is a real break

At 9:16 the room is 0.562 world units wide against 1.0 tall, and the sky ring —
whose radius comes from the height and therefore does not shrink — takes 60% of
that width. The wide composition does not survive being narrowed; see
`docs/VIDEO-EXPORT.md` for the table.

An **isometric** arrangement answers it: no vanishing point pulling everything
to a centre, depth as a constant diagonal instead, so the box can run up and
back and spend the height a tall frame has going spare.

It has to be said plainly that this is the arrangement that was already tried
and rejected. From the commit that built the room: *"Tilt the camera and the
near rectangle rotates out of alignment and you get a box floating in a field of
nothing, which is exactly what the first attempt was."*

The rejection does not transfer, and the reason is precise: it failed in a
**wide** frame, where a floating box wastes the width and reads as lost. A tall
frame has height and nothing to spend it on, because the room's height is fixed
and only its width tracks the aspect. What was a waste at 16:9 is the way out
at 9:16.

Two things go with it, and both should be chosen rather than discovered:

- **"The panel is the box" stops being true.** Under isometric there is no front
  face parallel to the screen filling the frame, so the identity that the room's
  near edges *are* the panel's edges is gone.
- **The borderless canvas was a consequence of that identity** — `#visGl` has no
  border because a border would be "a frame drawn over the frame". An isometric
  box floating in a frame may well want the frame back.

## The numbers are an output

They still exist and they still matter: the point of the exercise is a set of
constants good enough to become the defaults in `vis-gl.js`.

So they are displayed, and they are copyable, and they are never typed. You drag
until it looks right and the tool tells you what you just made.

## One refactor first

`VG_DEPTH`, `VG_FLOOR_Y`, `VG_CEIL_Y`, `VG_LEAD` and the sky's two factors are
module constants read directly at every draw call. They have to become live
values before any of this can move.

That is a small change that touches a lot of lines, and it is worth doing on its
own, deliberately, rather than sprinkling globals through the file as each
gesture needs one. The shape it wants is a single camera object with the frame's
aspect as its key — which is also exactly what the per-frame cameras and the
video export need it to be, so the refactor is not scaffolding, it is the
structure.

## The hierarchy, and occlusion

Added 19 Aug 2026.

**The layer chips are a stack, highest at the top.** The list *is* the draw
order, and the draw order is what occlusion is: a layer only masks the ones
after it if it wrote depth before they were drawn, so the thing at the top is
the thing that gets to be seen. Drag a row by its grip to move it. A hierarchy
read left to right is a hierarchy nobody reads, which is why the row of chips
became a column of them.

**Each layer has its own occlusion switch**, off until asked for. On, the layer
stands in the way of everything below it instead of adding light to it; off, it
is additive as before — but it still *gets* occluded by whatever is above it.
With nothing occluding, the depth buffer is not enabled at all and the room is
the flat additive scene it has always been, which is what any caller that says
nothing about occlusion still gets.

**Grain solids occlude each other and not themselves.** Each grain writes a
small disc into the depth buffer at its own *back*, so every wire it owns is in
front of its mask — the shape stays open, the way a wireframe should — while
anything behind it is cut. Eight-sided rather than a quad, whose corners reach
forty per cent past the shape: a neighbour vanishing behind a corner of nothing
is exactly the artefact this is for. Every mask in the cloud is written before
any wire is drawn, so the order the grains happen to be in stops mattering.

**A grain's depth is its age, and age runs on the wall clock.** A schedule fed
to the room in one synchronous loop arrives as a flat sheet at the near face
with nothing behind anything, and occlusion then correctly hides nothing. That
cost an hour: the first test of the mask did exactly this and read the result as
the mask being broken. Anything checking occlusion has to let real time pass.

## The ring's size

A slider, kept out of the camera on purpose. The camera is the *pose* — what
dragging writes, what `reNums` prints and what gets pasted back into `vis-gl.js`
as a new default — and how big somebody likes the ring is not part of that. It
would otherwise ride along in every camera copied out.

## The data block's columns

**Every stream has a fixed place, whether or not it is switched on.** Packing
only the columns that were on meant turning one off pulled every column after it
to the left: switch off IDX and SRC lands where OUT was, so a number you had
been reading in one place became a different number in the same place. That is
the same fault as a field that reflows as its value changes, and the block is a
readout watched while it runs.

The price is that a stream is only shown where its own column falls on the wall,
and switching its neighbours off no longer buys it room. On a dock-sized wall
that is the first six of the eight; a taller frame fits more.

## The cloud's two sliders

`CLOUD` is how much of the grain cloud is drawn and `BURN` is how brightly it
burns. Both are about the picture, and neither touches the sound.

**`CLOUD` is not the engine's Density.** The cloud's rate has its own control in
front of the engine, in grains per second, and that one changes what you hear.
This one changes how many of the grains that *are* sounding get a shape in the
room, which at a few hundred a second is the difference between a cloud you can
see through and a fog. Both are honestly the density of a cloud; one you hear
and one you look at.

Thinning is a coin flipped once per grain, from the grain's own index. Not every
n-th grain: a schedule is periodic, and a regular rate sampled at a regular rate
beats, so the cloud would come out banded rather than thinner. Because the coin
is the grain's own number and not a running count, turning the slider down takes
grains out of the picture without rearranging the ones that stay — it thins in
place rather than redealing.

`BURN` rides on the alpha rather than on the weight, because the weight is what
picks the colour. Turned up on the weight, a grain would change hue on its way
to being brighter, and the hue is saying something about the sound.

### Counting a cloud in a test

A grain lives fourteen seconds and goes on flying after its schedule is taken
away, so **the cloud from one run is still in the air during the next**. Reading
the population to compare two densities gave the thinner setting the bigger
number. What a run did is the *difference* it made, so births are counted as a
delta. Brightness is applied where a grain is drawn rather than where it is
born, so that one is read off a single cloud drawn twice.

## What the hierarchy can and cannot do

Three things read as the control being ignored, and none of them is. They are
what geometric occlusion over additive blending actually means, and they are
pinned as tests in `tests/ui/room-hierarchy.spec.mjs`.

**Order alone buys you nothing.** Every pass in this room is additive, and
addition does not care what order it happens in — reversing the whole stack
gives the same picture. On a dark scene it is the same to the byte; on a bright
one it moves by a fraction of a per cent, because the addition saturates at 255
and saturating addition is not associative. That is a rounding artefact, not a
hierarchy. So the layer stack shows itself as inert until something occludes,
rather than letting rows be dragged around in hope.

**A layer masks with the geometry it actually has.** The terrain is a surface
and hides a great deal. The box is eight lines and hides almost nothing. Turning
occlusion on for a wireframe layer is not broken; there is simply very little
there to stand in the way.

**A layer at the bottom masks no other layer**, because nothing is drawn after
it — but it still occludes *itself*, which for the terrain means its near ridges
standing in front of its far ones. Easy to mistake for the hierarchy working
when it is not.

**The Data block is not in any of this.** It is type printed on the back wall
rather than geometry in the scene, so it has no place in the order and no
occlusion switch. It shipped with both for a few hours, and a switch that does
nothing is worse than a missing one.

## The ring: a border and a drive

**A dark border under each hoop.** The rings trail forty deep and additive
blending turns a stack of them into a wash; a dark ribbon laid down under each
line separates it from whatever it crosses. It is built by pushing the ring's own
points out and in along the radius — the ring is drawn round on screen and its
points are laid out by angle from its centre, so "along the radius" is already
perpendicular to the line, and none of it needs `gl.lineWidth`, which almost
every driver clamps to 1.

Black cannot be *added*, so this is the one pass in the room that multiplies the
destination down instead of adding to it. Not an opaque black either: the room is
drawn on glass with the page's own ground behind it, and a border that punched
through to nothing would be a border around a hole.

**`DRIVE` is how hard the sound pushes the ring out of round**, and the range
runs to eight because one was never enough — measured across the range the ring
goes from 109 px wide and perfectly circular to 352 px and ragged.

### `push` takes two arguments

`visGl.push(bands, pairs)` is positional, and `bands` is in decibels. Handing it
one object — `push({ spectrum, liss })` — makes `bands.length` undefined, so it
returns at the first line and pushes **nothing**, silently. The room then goes on
drawing whatever real history the app already had, which is near silence, and a
control that scales what the sound does to the ring correctly does nothing at
all. That mistake cost half an hour of hunting a renderer bug that was not there,
so the test helper writes the signature down.

## Every control has to take the pointer back

`.room-edit` is `pointer-events: none`, and it has to be: the room is posed by
dragging it, and the panel sits over the whole thing. So each control hands the
pointer back for itself, and **anything added without that line arrives dead on
screen while working perfectly from the console.**

The whole fill row shipped that way — the checkbox could not be checked and the
swatch could not be opened. The test that was meant to cover it dispatched
events straight at the elements, which is the one way of driving a control that
cannot tell whether the control can be reached. `the room editor's controls can
be clicked, not just dispatched at` clicks instead, and asks
`elementFromPoint` what a real pointer would land on. Without the rule it fails
with `<canvas id="visGl"> intercepts pointer events`, which is the fault said out
loud.

## Clear

Empties the room: the spectrum trail and every grain still in the air.

Not a reset. The camera, the layers, the hierarchy and every slider belong to
you and are not touched — `Reset` beside it is the one that puts a camera back.
This only empties what has been poured in.

It exists because everything in this room accumulates on purpose. The trail is
fifty-six frames deep and a grain lives fourteen seconds and goes on flying
after its schedule is taken away, so after a loud passage there is no way to
*see* the next quiet one for the better part of a minute. The floor's mesh cache
is keyed on the frame count, so that is dropped too, and the grain mark is set
back to nothing — the next schedule starts from wherever the playhead is rather
than pouring in everything between here and there, which is the same rule a seek
follows and for the same reason.

## The leading edge's band

`EDGE / thick` turns off the ribbon laid over the frame you are hearing now.

**The line under it is not optional and does not go with it.** The row loop
already draws that frame as a ridge like every other one, at the strongest alpha
of any of them; the band is laid over the top to give it body. So switching it
off takes the band away and leaves the ridge exactly where it was, rather than
leaving a gap at the front of the room where the newest frame should be. That is
what the test holds: the light drops and the bright pixels drop, and the number
of lit pixels barely moves — because the band is thin and almost every pixel it
lit was already lit by the line beneath it.

It is a ribbon rather than a fat line because `gl.lineWidth` is clamped to 1 by
almost every driver.

## How finely the ring is drawn

`FACETS`. It was a fixed 256 points, and at that number the ring is not merely
faceted — it is **undersampling the trace**, so the figure it draws is an alias
of the one in the sound. The beads along the leading hoop standing visibly apart
is what gives it away.

**What is stored and what is drawn are now two questions.** Every history frame
keeps the whole trace — a thousand-odd pairs, under half a megabyte across the
fifty-six of them — and how finely the ring is drawn is asked per frame against
that. Splitting the two is what lets the resolution be turned up while it is
being looked at, without the frames already in the trail being stuck at whatever
it was when they arrived. Past the stored count there is nothing left to resolve,
so the value is clamped rather than left to index off the end.

The beads shrink as the ring gets finer. A thousand seven-pixel sprites laid a
pixel apart would be one solid tube, which is the opposite of what asking for
more resolution was for.

### The panel outgrew the room

Adding that row was one row too many. `.room-edit` laid its children out with
`justify-content: space-between`, which spreads them over the height it has — and
when the panel wants more height than the room cell gives it, spreading pushes
the last of them out through the bottom edge. Not a clip: `Clear` and `Reset`
landed *outside* the canvas, over the dock beneath it, where a pointer aimed at
them hits the dock instead. The reachability test caught it by name — `a pointer
over #reClear lands on "dockStretch" instead`.

Stacked from the top, with the camera readout taking whatever is left, everything
stays inside.

## The back wall is tiled

One block of columns is narrower than the wall, and the schedule around the
playhead is shorter than the wall is tall, so printing one of each left most of
the wall empty.

**Repeated, not resized.** The type stays the size it is — small type printed on
a wall does not grow because the wall is big — and what fills the space is more
of it. Across by whole tiles and down by whole rows, so a tile is never cut in
half at an edge; what does not fit is not drawn. In the dock one tile is about
the whole width, and on the full screen there are four.

Down the wall the schedule starts again when it runs out, which is what a tile
is. The blocks and their alternating direction survive it, so the movement still
reads.

**A tile ends at its last switched-on column.** The empty places after that are
still reserved — nothing moves, which is the whole point of the fixed slots —
but they are not printed, or every tile would carry the width of the streams
that are off and the tiles would sit that far apart. Leading empties are kept,
because those are what hold the columns still.

## The mist

`MIST` — a switch, how much, and how long the drips are. Smoke dripping off the
grain shapes: what each one shed a moment ago, sagging as it falls behind.

A grain travelling away from you leaves what it shed *nearer the front*, where it
was — depth is time, so behind it in the room is earlier in its journey. Each
point is a pure function of the grain's own hash and how far back it sits, so
there is no particle system here and nothing to keep between frames. The same
discipline the grains follow, and for the same reason: a trail that had to be
remembered would have to be rebuilt after every seek and would drift from what
the export draws.

### Measurably present is not the same as visible

The first version drew at an alpha of 0.055, which after the shader's own depth
fade and weight curve lands near 0.03. The test measured it and found it — 466
faint pixels became 18,802 — and it was reported as **not working at all**. Both
were true: it was drawing, and on a black room it was invisible.

Two things came out of that, and the second is the one worth keeping:

- The mist is drawn strongly enough to see, and the amount control drives the
  density as well as the count, because "how much mist" plainly means both. At
  the settings it ships with it nearly quadruples the lit pixels in a grain
  cloud.
- **The test measures lit pixels, not faint ones, and it measures them through
  the object the interface actually builds.** The first check passed `mist`
  straight to `visGl.frame`, which proved the renderer drew something and proved
  nothing about whether the interface ever asked it to. Every one of this room's
  controls has now been wrong in one of those two ways at least once.

## Fog, after actually reading the references

Two links were sent with the request and the work was done without opening them:
the shader pasted alongside was implemented and the particle side was written
from memory. Both were then reported as wrong, and both were.

**Fog starts at the near plane, not at the eye.** Lettier: *"The fog's intensity
is `fogMin` before or at the start of the fog's `near` distance."* The first
version measured distance as `length(aPos)`, and the near plane of this room is a
whole unit from the eye — so `exp(-density × 1.0)` laid better than a third of
the fog's colour over the nearest thing in the picture, and the same again over
everything behind it. Everything came out tinted and nothing came out *further
away*, which is what "it is colouring the whole scene" meant.

Measured from where the fog starts, with a red fog on a blue room: the front of
the room takes 0.04 of the fog's colour and the back wall 0.71. Exponential
squared is twenty to one. Before the fix it was 0.48 against 0.67 — a ratio of
1.4, which is a wash.

**The particles are textureless and noise-attenuated.** MirzaBeig's description
is precisely that: *"textureless fog particles using a highly customizable shader
to attenuate noise values."* The first version drew soft gaussian discs, which is
a shape you can name — and a hundred of them is a hundred discs. Two octaves of
value noise now push the edge in and out and thin the body unevenly, seeded from
each sprite's own position so no two are alike and none of them boils frame to
frame.

### A shader that will not compile says nothing

`vgAttach` returns null and every caller finds no room at all, which surfaces
somewhere else entirely as "cannot read properties of null". A varying declared
in the vertex shader and not the fragment one cost ten minutes of looking in the
wrong place. It is a `console.error` now, and it says which half failed.

### The square was the field's own edge

Reported as "a strange square knock-out when the fog is on". Two guesses were
wrong before the right one, and the wrong ones are worth keeping because both
were plausible and both were checked.

**Not the sprite's corners.** A point sprite is a square and the circular cutoff
is the only thing hiding it, so warping the radius by noise looked like the
culprit — at 0.72 a corner pixel at 1.41 comes back as 1.01. That is a hair over
the cutoff rather than under it, so the corners were being cut all along. The
mask is taken from the unwarped radius now anyway, because relying on that
margin is relying on a coincidence.

**It was the field.** The motes were scattered through a slab a shade wider than
the room — ±1.15 of its half-width, ±0.62 of its height — and a slab has edges.
Near the front, where the frustum is widest and a mote is biggest, those edges
land *inside* the picture: a rectangle of air with clear air around it. The field
now reaches far enough out that its own edge is always off the frame at both ends
of the room, which costs a vertex per unseen mote and nothing else.

**And an edge detector that could not see any of it.** A scan for long straight
runs of high contrast reported zero with the fault deliberately in place, twice.
It only measured noise. It is not kept: a test that cannot fail is worse than no
test, because it is read as evidence.

### Nothing about a grain may come from where it sits in a list

The mist appeared as soft orbs that relocated part way through a render. Its
sideways wander was seeded from `i`, the index into `grainLive` — and that array
is compacted every frame as grains reach the wall (`grainLive[keep++] = p`), so a
grain's index shifts the moment anything ahead of it dies. Its mist jumped to
wherever the new index put it.

Exactly the fault that made grains change shape in mid-air, in a different
place. The seed is fixed at birth now, like the shape, the spin and the pace.

### Every control in the panel, found rather than listed

The fog's type selector could not be opened at all: `.room-edit` is
`pointer-events: none` and the rule handing it back named buttons, checkboxes and
swatches — not `select`. The reachability test had a hand-written list of ids and
`reFogType` was not on it, so it passed.

It asks the DOM what is in the panel now. A list somebody has to remember to
extend has already failed twice: the whole fill row, and then this.

