# The open world

*Begun 7 September 2026, on the `open-world` branch. The plan is
[`OPEN-WORLD-PLAN.md`](OPEN-WORLD-PLAN.md); this is what has been built of it.
On 31 October 2026 `main` and `open-world` are the same commit.*

## Step one: the camera is a place you stand

The room's camera was a box: `floorY`, `ceilY`, `shiftX`, `depth`, and a
taper. Everything the room draws is still placed by that box in this step —
the terrain along its length, the ring between its floor and ceiling, the
data block on its far wall. What changed is what is *kept*.

**The world camera is the stored truth.** `VG_WORLD_DEFAULT` in
`vis-gl.js`: a `height` above the ground, a `pitch` and a `yaw` in degrees,
a `reach`, the `aspect` it was posed at, and — until the ground replaces the
box — the ring's two numbers and the taper, carried along unchanged.
`roomEdit.cams[frame]` holds world cameras; a drag on the room still
computes the box it always computed and then writes it through
`roomSetCam`, which turns it into a world camera at the aspect being posed.
The readout under the room prints the world camera, and what it copies is
the world camera.

**The box is derived, exactly.** `vgWorldFromBox` and `vgBoxFromWorld` are
inverses to nine places: the eye's height is the floor's depth below the
eye, the pitch is the angle to the middle of the near rectangle (the box's
tilt was its asymmetry), the yaw is the angle to the slid vanishing point.
That last one depends on the aspect the room was posed in, which is why a
world camera carries its aspect: the trip back is exact whatever the window
is doing now. `roomCamNow` hands the drawing code the box; `vgBoxOf` does
the same for anything that arrives from outside — the film's camera per
aspect, a look recalled from a preset, a test that writes a box straight
into `roomEdit.cams` — so a camera in either shape draws.

**A room posed on `main` opens here looking the same.** `main` wrote box
cameras under `roomCameras`. The branch reads them once, turns each into a
world camera at its frame's own aspect, and keeps the result under
`roomCamerasWorld`. The old key is not touched, so switching branches loses
nothing either way.

**The world's own view is in the file and checked, and not yet drawn with.**
`vgWorldView` builds a look-at from the eye along pitch and yaw and a
symmetric perspective of a stated field of view. `open-world.spec.mjs`
insists the ground ahead rises towards the horizon and never reaches it, a
post narrows with distance, a turn to the right moves what was ahead to the
left, and a pitch up sinks the ground. Step two puts it in the frame; the
picture moves then, and not before.

### Where it lives

- `ui/vis-gl.js` — `VG_WORLD_DEFAULT`, `vgIsWorld`, `vgWorldFromBox`,
  `vgBoxFromWorld`, `vgBoxOf`, `vgWorldView`.
- `ui/app.js` — `ROOM_CAMERAS_KEY`, `roomCamerasMigrate` and the load;
  `roomAspectNow`, `roomSetCam` (`roomSetWorld` since step three),
  `roomWorldNow`; `roomCamNow`,
  `roomCameraDrawn`, `roomFog` and the projection helpers read through
  `vgBoxOf`; the readout in `paintRoomNums`.
- `tests/ui/open-world.spec.mjs`.

## Step two: the ground, and the horizon

The box is gone. The room is drawn with the world's own view — a look-at
from the eye at `height`, along `pitch` and `yaw`, through a symmetric
perspective whose field of view is what the box's height gave — and the
picture moved for the first time: a tilt is now a pitched camera rather than
a shifted window, and a slid vanishing point is a turn.

**The ground is a grid.** `drawGrid` in `vis-gl.js`, first in the draw
order where the box was: lines across at half a unit from the near plane to
the horizon, lines along from as far left as the eye can see at the horizon
to as far right, every fourth one heavier, light grey, fogged and thinned
with distance so the horizon reads as far rather than as an edge. It is the
`grid` layer — **Ground** in the list, where **Box** was — and the `grid`
slot in the palette, whose own quantity is distance, nought at the near line
and one at the horizon. `VG_HORIZON` is eighty units; the layers' own reach
is still the box's depth, and the grid runs on past it.

**The layers still lay themselves along the old box**, derived from the
world camera: the ground is `y = 0`, the ceiling is where the box's was
above the floor, the reach is where the far wall was. The taper is gone;
the two names the layers still call answer the identity until each layer is
re-placed in the world in step three. The far cross-section is still where
the data block and the text card are printed, projected through the new
view and bounded, until they are boards.

**The back's four grips went with the back.** There is no far wall to widen
or raise. What remains is the depth grip, the ring's grip and the eye line.
The projection helpers in `app.js` — `roomProject`, `roomUnproject`,
`roomHalfW`, `roomBackWall` — are the renderer's own matrix in closed form
again, through `roomView`, and `roomUnproject` inverts the general matrix
rather than assuming a frustum, so a turned or pitched camera unprojects as
exactly as a straight one. `room-geometry.spec.mjs` now checks that and no
longer measures a back.

**A film's camera and a test's camera still pass through as boxes.** The
renderer reads a box camera as the world camera it maps to at the canvas's
own aspect, which is exactly what the helpers do, so the two agree.

### Where it lives, step two

- `ui/vis-gl.js` — `VG_HORIZON`, `VG_GRID_STEP`, `vgProjectPoint`,
  `vgUnprojectAtZ`; the frame builds its view from the world camera and
  derives the box; `drawGrid` in place of `drawRoom`; `VG_LAYER_ORDER`;
  `project` and `unprojectAtZ` on the general matrix.
- `ui/app.js` — `ROOM_LAYERS` (`grid`), `ROOM_HANDLES` without the back,
  `roomCameraDrawn` hands the world camera over, `roomView` and the four
  helpers on it.
- `ui/room-paint.js` — the `grid` slot, its label, weight and family.
- `tests/ui/open-world.spec.mjs`, `tests/ui/room-geometry.spec.mjs`,
  `tests/ui/room-hierarchy.spec.mjs` (`grid` for `room`).

## Step three: world sizes, one perspective

There is no taper. There never should have been a word for one. The camera
is a point with a direction and a field of view, everything else has a size
and a place in the world, and the picture is nothing but the projection:
close is big, far is small, and that is all.

**The camera lost the box's last habits.** `pitch`, `yaw` and `height` are
independent now — the box tied tilt to height, because its floor was pinned
to the frame's bottom edge — and the field of view is the camera's own
field, `fov`, rather than a number derived from the box's height. A drag on
the room pitches and turns the camera; the eye line grip raises and lowers
the eye; the depth grip sets the reach; the ring's grip and the sky zone
move the ring. What the readout prints is the camera: height, pitch, yaw,
field of view, reach, the ring.

**The layers stopped borrowing the camera's numbers for their own sizes.**
The terrain's width was the frame's width at the near plane — a window of
a different shape drew a different room. It is `geomWidth` now, in units,
on the Shape tab as **WIDTH**, and it does not care what the window is. The
height the layers measure against — the terrain's ridge, the cloud's
spread, the solid's path — is a unit of the world, `VG_WORLD_H`, not the
box's floor-to-ceiling. The ring has a place in the world: `ring.x`,
`ring.y`, `ring.z` in units, and a radius, `ring.size`.

**The taper is gone from the renderer** — `taperX`, `yTap`, `backW`,
`backH`, the closures every layer once placed itself through — and from
the world camera. A box camera still reads as the world camera it maps to,
and a world camera still gives back the box it would draw for anything
that asks for one in the old words, except that a world camera's pitch is
its own and does not survive that trip; nothing that draws reads it that
way any more.

### What still speaks the box

`roomCamNow` and `vgBoxFromWorld`, kept so that the film's per-frame
cameras, a look recalled from a preset and the older tests can hand over
or read a box, and the layers' depth, which still runs to the camera's
`reach` in units — the terrain's length, the trail's, the cloud's — rather
than to the sound's own span. Making depth a measure of seconds is the
next thing.

### Where it lives, step three

- `ui/vis-gl.js` — `VG_WORLD_DEFAULT` with `fov` and a placed `ring`,
  `VG_WORLD_H`, `VG_WORLD_W`, the frame's world sizes, the layers without
  the taper, `geomWidth`.
- `ui/app.js` — `geomWidth` in the room's settings, `roomSetWorld`, the
  grips and the room drag editing the world camera, `roomView` and the
  helpers in world `y`, the readout.
- `ui/room-paint.js` — the **WIDTH** row.
- `tests/ui/room-editor.spec.mjs`, `room-grips.spec.mjs`,
  `room-geometry.spec.mjs`, `open-world.spec.mjs` — in world terms.

## Step four: everything moves

A world you cannot move through, with things in it you cannot move, is a
room. Both are gone.

**Everything with a place has beads, and goes anywhere.** The ring, every
point of the solid's path, and the terrain's front edge are dragged where
they are: a bead in the air for across and up, a bead on the ground for
across and along — the same two beads, the same two planes, no mode.
Nothing is clamped to anything. The ring lost its zone across the top of
the picture and its grip; the path lost its fractions of a box for units;
the terrain gained a place (`geomAt`) and its length became its own
(`geomReach`, on the Shape tab as **REACH**) rather than the camera's. A
path or a camera kept from before this is brought up to date once, where
it is read.

**The camera moves too.** It has a place now — `x`, `z`, and `height` — as
well as a direction. On the picture: drag to tilt and pan, scroll to walk
along the way you look, shift and scroll to sidestep, the eye line grip to
rise. On the Room tab, the same as numbers: **PAN**, **TILT**, **HEIGHT**,
**SIDE**, **WALK**. The readout prints where you stand. The whole picture is
the camera; there is no sky zone.

**The grid is the world's, not the eye's.** Its lines are at multiples of
the spacing whatever the eye does, and it is laid out around wherever the
eye stands, so walking never finds an edge of it.

### Where it lives, step four

- `ui/vis-gl.js` — `v: 2` world cameras with `x` and `z`, `vgWorldUpgrade`,
  the eye in `vgWorldView`, `geomReach` and `geomAt`, the ring and the path
  absolute, the grid around the eye.
- `ui/app.js` — `roomBeads`, `paintRoomBeads`, `wireRoomBeads`;
  `roomProjectAt`, `roomUnprojectZ`, `roomGroundAt`; walking on the wheel;
  `syncCamRows` (and `ROOM_CAM_ROWS`, gone with the sliders in step five);
  the path in units and its migration;
  `geomReach` and `geomAt`.
- `ui/index.html` — the camera rows; `ui/room-paint.js` — **REACH**.
- `tests/ui/open-world.spec.mjs` — everything goes anywhere; the camera
  walks, sidesteps, pans, tilts and rises; the old records come up to date.

## Step five: the camera the way every 3D program has it

The first camera in the open world was a first-person one: drag to tilt and
pan, wheel to walk, shift and wheel to sidestep, a tab at the left edge for
the eye's height, and five sliders. Nobody who has used a 3D program could
find their way round it, because it is not what any of them do. They all do
the same thing, and now so does this.

**An eye and a pivot.** The camera looks at a point ahead of it, and the
gestures are about that point. The record is unchanged — the eye's place and
direction — with one field added, `focus`: how far ahead the pivot sits. It is
kept once a gesture has set it; until then it is the ring's distance along the
look, since the ring is what the room is about. `camPivot`, `camFocus`,
`camOrbit`, `camDolly`, `camTrack`, `camLook`, `camFly`, `camAim`, `camView`
are the whole vocabulary, in `ui/app.js` after `roomWorldNow`.

**The gestures**, shared by Maya, Blender, Unity and Unreal:

| | on the picture |
|---|---|
| orbit (tumble) | drag · alt+drag |
| track (pan) | shift+drag · middle-drag · alt+middle-drag · shift+wheel · sideways scroll |
| dolly (zoom) | wheel · pinch · ctrl+drag · alt+right-drag · ctrl+middle-drag |
| look (fly) | right-drag |
| fly | W A S D forward, sideways · Q E down, up |
| focus | double-click the ground: look there, and pivot there |
| frame | F, or the Frame button: the picked point, or the ring, at the pivot |
| home | Home: the frame's camera back to the source's |

Sideways, the world follows the hand: orbit right and it turns right under
you. Up and down is the camera's own: orbit down and you go down under the
pivot, looking up; up and you rise over it. Track keeps the point under the
hand under it; dolly right or up is in. Look turns the eye in place, down
looking up, as a flight stick does. The right button is
a gesture, so the menu it would open is suppressed while the editor is on —
which is also what stops the release being lost.

**The panel is a channel box, not sliders.** As Maya's: Translate X Y Z,
Rotate X Y, Focal Length (35 mm equivalent; 24 mm is this room's default
lens) and Center of Interest (the pivot's distance). Each is a typed number
that is also its own slider — drag across the field to scrub it, shift for
ten times the step, the arrow keys to step it, a click to type. Translate
carries the pivot with the eye, as moving a camera does; Rotate turns in
place; typing the center of interest is a dolly. Front, Side, Top and Frame
sit under them. The four sliders that were there first were a mistake: a
camera is posed on the picture, and a panel is for its numbers.

**A picked point has channels too** — Translate X Y Z in the same row style,
shown while something is picked and named for it — and **a view axis** sits
in the corner of the picture, X red, Y green, Z blue, turning with the
camera, as every 3D program draws one.

The eye-line tab is gone; the reach grip stays, since it is the terrain's
length and not the camera's.

**Objects have a gizmo.** Click a bead to pick it. Three arrows appear — X
red, Y green, Z blue — each a unit of the world along its axis scaled to a
hand's length on screen, so it points the way that axis goes from there
however the camera stands; an axis seen end-on is not offered. Pull an arrow
and the point moves along that axis alone. Drag the bead itself and it moves
freely in the plane facing the camera, staying under the hand; the terrain,
which lies on the ground, moves on it. Delete removes a picked waypoint,
Escape lets go, and a click on the bare room lets go too. The floor bead is
gone; the point's shadow on the ground is still drawn, but only to read its
height by. The waypoint list picks too, and shows what is picked.

**Sizes.** Orbit at 0.4° per pixel, look at 0.25°, a fly step at six
hundredths of the focus distance, so every step scales with the scene.

Tests: `open-world.spec.mjs` — orbits, tracks, dollies, looks and flies by
hand, wheel, key and slider (the pivot checked at every step); a picked point
moved along one axis by its arrow, and removed by Delete. `room-editor.spec.mjs`
— the two drag tests are orbits now. `room-geometry.spec.mjs` — one grip.
