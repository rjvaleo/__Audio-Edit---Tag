# The open world

*Begun 7 September 2026, on the `open-world` branch. The plan is
[`OPEN-WORLD-PLAN.md`](OPEN-WORLD-PLAN.md); this is what has been built of it.*

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

**A room posed on `main` opens here looking the same.** `main` writes box
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
  `roomAspectNow`, `roomSetCam`, `roomWorldNow`; `roomCamNow`,
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
