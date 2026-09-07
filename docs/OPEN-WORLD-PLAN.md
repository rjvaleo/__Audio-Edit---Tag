# The open world: from a room to a horizon

*7 September 2026. A plan, on the `open-world` branch. `main` keeps the room.*

The visualiser is a room: a box whose four edges run back to a far wall,
narrowing with perspective. Everything in it is placed *by the box* — the
floor is the box's floor, the ring hangs at a height between its floor and
its ceiling, a grain's depth is a fraction of the way to the far wall, the
data block is printed on the wall itself. The box is the coordinate system.

The ask is to take the box away and keep the perspective: an open space,
ground running to a horizon, a light grey grid on the ground so the ground
can be seen, and things placed *in the world* rather than in the box. Then,
in phase two, more than one thing to place and more than one camera to look
from. This document is the plan for phase one in full and the shape of phase
two, and it names every part of the program the first phase touches.

---

## Phase one: the open world

### What the room is, precisely

The whole scene is a frustum. `vgFrustum(-halfW + sx, halfW + sx, yb, yt,
near, far)` in `vis-gl.js`, where:

| Camera field | What it is now |
|---|---|
| `floorY`, `ceilY` | the near rectangle's bottom and top — the *floor* and the *ceiling* of the box, and the tilt is the asymmetry between them |
| `shiftX` | the near rectangle slid sideways — the vanishing point moved |
| `depth` | how far the far wall is, as a multiple of the near distance |
| `backW`, `backH` | how much the far rectangle is wider or taller than the near one, before the perspective divide — a taper |
| `skyAt`, `ring` | where the ring hangs *between floor and ceiling*, and how big |

Every layer places itself with three closures the renderer builds from those
fields: `zAt(t)` for depth as a fraction of the box's length, `taperX(t)` for
width at that depth, `yTap(y, t)` for height at that depth. The box has an
end, and everything is measured against that end.

`roomProject` and `roomUnproject` in `app.js` are the same frustum in
closed form, for the grips and the path beads; `roomBackWall` is the far
rectangle on screen, for the data block and the text card.

### What the world is instead

A ground plane at `y = 0` running to infinity, a camera above it, and a
horizon where the plane meets the sky. Perspective narrows on its own: a
plane seen from above converges to its horizon without any box to converge
inside. Distance is real distance, in metres or in seconds; nothing is a
fraction of a length that has an end.

| World field | What it is | Replaces |
|---|---|---|
| `eye` — `{ x, y, z }` | where the camera stands; `y` is height above the ground | `floorY` (height is the same idea, said plainly) |
| `look` — `{ yaw, pitch }` | which way it faces; pitch is the tilt | `ceilY` against `floorY` (the tilt), `shiftX` (the yaw) |
| `fov` | how wide it sees | `halfW`, which was the near rectangle's width |
| `reach` | how far the ground grid and the fog are drawn — the world's own far plane, not a wall | `depth` |
| `ring` — `{ x, y, z, size }` | where the ring hangs, in the world | `skyAt`, `ring` |
| `solid` — `{ path }` | the solid's path, in world units | `solidPath` in box fractions |

`backW` and `backH` go. They were a taper on a box, and there is no box.

The projection becomes an ordinary look-at with an ordinary perspective
matrix: `vgLookAt` and `vgFrustum` are already in the file; only the
symmetric case is needed. `roomProject` becomes the same matrix in closed
form again, but on a world point rather than a box fraction, and
`roomUnproject` becomes a ray from the eye through the pixel, intersected
with a plane — the ground for the floor beads, a vertical plane through the
point for the air beads.

### The ground grid

A new layer, `grid`, drawn first: lines on `y = 0` at a fixed world spacing,
running to `reach` in `z` and across the width the camera sees, in the
theme's line colour at low weight — *light grey* against the dark ground,
lighter with distance so the horizon reads as far rather than as an edge.
Every fourth line heavier, so distance can be counted. It is what says where
the ground is once the box is gone, which is the whole reason for it.

It takes a slot in the palette (`RP_SLOTS`: `grid`, own quantity *distance*)
so it can be painted like everything else, and it takes the Box's place in
`ROOM_LAYERS` — the Box was the wireframe of the container, and the grid is
the wireframe of the ground.

### What each layer does in the world

- **Terrain** (`drawFloor`): the spectrum's rows still run back with age,
  but at real depth — row *r* at `z = age(r) × span` — and across the width
  the camera sees at that depth rather than `halfW × taperX`. Its height is
  above the ground, so `ridgeY` measures up from `y = 0`. The trail no longer
  has to reach a wall; it fades into the fog at `reach`.
- **Edge** (`drawLead`): the near row, at `z = 0` in front of the eye. Unchanged
  in kind.
- **Ring** and **Skin** (`drawRings`): at `ring.{x,y,z}`, sized by
  `ring.size`. The trail of hoops runs back from there along `z`.
- **Grains** (`drawGrains`): depth is time, and is; `zAt(age)` becomes
  `age × span` in world units. Spread and drift are world distances.
- **Solid** (`drawSolid`): the path's points are world points. `solidPath`
  loses its `0..1` fractions for `{x, y, z}` in metres, with the migration
  below.
- **Mist** and **Fog**: fog's `near`/`far` are in world units and default to
  `reach`; height fog is off the ground, which now means something.
- **Data** (`paintRoomData`): the block was type on the far wall. With no
  wall it is a *board* — a rectangle standing in the world at a chosen
  place, projected as the wall was. Its default place is where the wall was.
- **Text card** (`room-text.js`): the same, a board in the world.

### The camera, and the grips

The camera stops being *a room you take hold of* and becomes *a place you
stand*. That changes the gestures, and `docs/ROOM-EDITOR.md`'s argument still
holds: you pose by dragging the picture, not by typing numbers.

| Gesture now | Gesture in the world |
|---|---|
| lower room, up/down — tilt | up/down — **pitch** (same feel) |
| lower room, sideways — slide the frustum | sideways — **yaw** (turn, rather than slide; the honest gesture once there is a world to turn in) |
| scroll — depth | scroll — **walk** forward and back along the look direction |
| sky zone — ring height and size | **drag the ring itself**, as the solid's beads are dragged: an air bead for across and up, a floor bead for across and back |
| back width / back height grips | **gone** — there is no back |
| depth grip | **gone** — replaced by walking |
| eye line tab | **height**: drag the horizon up and down to raise or lower the eye |
| ring grip | stays, as the ring's air bead |

`ROOM_HANDLES` shrinks to the horizon tab and gains the ring's two beads.
`roomZoneAt` collapses to one zone: the whole picture is the camera. The zone
word says `CAMERA — up/down: pitch · left/right: turn`.

### Frames and cameras per frame

`ROOM_FRAMES` (dock, 16:9, 1:1, 4:5, 9:16) and `roomEdit.cams[frame]` stay:
a camera per shape being filmed is still right. Their contents change from
box fields to world fields. `roomCameraForAspect` is unchanged in purpose.

### Persistence, and the migration

`roomCameras` in storage holds box cameras. On the branch they are read
through a migration, once: a box camera becomes a world camera that shows
roughly the same picture (`eye.y = -floorY`, `pitch` from the
`floorY`/`ceilY` asymmetry, `yaw` from `shiftX`, `reach` from `depth`, the
ring placed where `skyAt` put it), and the migrated form is written back
under a new key so the old key stays for `main`. The same for `solidPath`
in `roomData` (`x` across, `y` up, `z` back become metres against the world
the box was) and for the section-preset **look**, which carries cameras and
a path by value — `readRoomData` and `applyVisual` both go through the
migration, so an old look still recalls.

`ROOM_CAM_DEFAULT` becomes `WORLD_CAM_DEFAULT`. The test card
(`roomTestCard`) is unchanged; it is a spectrum, not a place.

### The film

`video-export.js` shoots with the same renderer and `roomCameraForAspect`,
so it follows the renderer for nothing extra. `roomBackWall` is used for
the data block's place in the film, and becomes the board's projection. The
sequencer's part of the film does not touch geometry.

### What does *not* change

- The other modules — **Ridgeline**, **Room 3D** (Babylon), **Stage** — are
  their own scenes with their own cameras and are untouched. The module
  picker, `VIS_MODULES` and the registry are untouched.
- The palette's ramps, drives and atlas: a slot is added, none is changed.
- The layer hierarchy and occlusion: the list gains `grid` and loses `room`;
  the mechanism is the same.
- The grain views, the 4D catalogue, the solid's trail and its shapes.
- The automation, the sequencer, the presets' store.

### Every file phase one touches

| File | What changes |
|---|---|
| `ui/vis-gl.js` | `VG_CAMERA` → world fields; the frustum → look-at + perspective; `zAt`/`taperX`/`yTap` → world placement; `drawRoom` → `drawGrid`; `drawFloor`, `drawRings`, `drawGrains`, `drawSolid`, `drawLead`, mist and fog re-placed; `VG_LAYER_ORDER`; `project`/`unprojectAtZ`/`extents` on the new matrix |
| `ui/app.js` | `ROOM_CAM_DEFAULT` → world; `ROOM_LAYERS` (`room` → `grid`); `roomProject`/`roomUnproject`/`roomHalfW`/`roomBackWall`/`clampBack`; `ROOM_HANDLES` and `wireRoomHandles`; `wireRoomDrag`, `roomZoneAt`, `ROOM_ZONE_TIPS`; `paintRoomNums` (the readout prints world fields); `paintSolidPath` and `wireSolidPath` (world beads); `paintRoomData` (a board); the camera migration on load; `readRoomData` and `roomDataSnapshot` (path in metres); `visualSnapshot`/`applyVisual`; the two frame builders that hand geometry to the renderer; `roomTestCard` unchanged |
| `ui/room-paint.js` | `RP_SLOTS`: `box` → `grid` (own: distance); `RP_WEIGHT`, `RP_FAMILY`; `RG_ROWS`: `geomHistory`/`geomSpan` keep their meaning, a `reach` row joins them |
| `ui/room-text.js` | the card's place: a board in the world, projected by the new `roomProject` |
| `ui/index.html` | the room panel's rows: RING becomes the ring's beads; the DEPTH readout wording; the layer list is built from `ROOM_LAYERS` |
| `ui/app.css` | `.rh-*` for the grips that remain; the board's CSS |
| `ui/video-export.js` | nothing in kind; `roomBackWall` → the board's projection |
| `ui/section-presets.js` | nothing; the migration lives in `app.js` |
| `docs/ROOM-EDITOR.md`, `ROOM-PAINT.md`, `ROOM-TEXT.md`, `ROOM-VIEW.md`, `VIDEO-EXPORT.md`, `SECTION-PRESETS.md`, `SHAPES-4D.md`, `STATE.md`, `README.md` | the box's vocabulary → the world's; a new `docs/OPEN-WORLD.md` for what was built |

### Every test phase one touches

| Spec | Why |
|---|---|
| `room-editor.spec.mjs` | drags tilt and slide the frustum, the sky zone moves the ring, the data tiles the back wall — every one is a box assertion and is rewritten for pitch, yaw, the ring's beads and the board |
| `room-geometry.spec.mjs` | measures the box's shape on screen |
| `room-grips.spec.mjs` | the grips that remain, the zone word's new text |
| `room-hierarchy.spec.mjs` | `room` → `grid` in the layer list; occlusion unchanged |
| `room-shape.spec.mjs` | the trail's depth and the terrain's height, now in world units; `reach` |
| `room-paint.spec.mjs` | the slot count (15 → 15: one out, one in) and the grid's ramp reaching the pixels |
| `room-text.spec.mjs` | the card as a board |
| `room-view.spec.mjs` | the frame shapes and the camera per frame — the assertions on `floorY` become assertions on `pitch` and `eye.y` |
| `section-presets.spec.mjs` | a look with a box camera still recalls, migrated |
| `video-export.spec.mjs` | the film's camera per aspect; the board in the film |
| `sequencer.spec.mjs`, `automation-capture.spec.mjs`, `shapes-4d.spec.mjs`, `grain-shapes.spec.mjs` | untouched, and run to prove it |

### Order of work

1. **The projection.** World camera fields, the look-at matrix, `project`
   and `unprojectAtZ` in the renderer, `roomProject`/`roomUnproject` in the
   app, and the migration from box cameras. Nothing drawn yet moves; the
   test card still shows. *One commit.*
2. **The ground.** `drawGrid`, the `grid` layer and palette slot, `reach`.
   The box is gone from this commit on. *One commit.*
3. **The layers, one at a time.** Terrain, edge, ring and skin, grains,
   solid, mist and fog — each re-placed in the world and each with its spec
   green before the next. *One commit each.*
4. **The boards.** The data block and the text card standing in the world.
5. **The gestures.** Pitch, yaw, walk, height; the ring's beads; the zone
   word; the grips that go. `room-editor` and `room-grips` rewritten.
6. **The film**, checked against a room posed for each aspect.
7. **The docs.**

Each step leaves the app working. The branch can be looked at after any of
them.

### The risks, named

- **The film and the room drifting apart.** This program has shipped that
  twice (`docs/ROOM-VIEW.md`). Both draw through one renderer and one
  `roomCameraForAspect`; the projection helpers in `app.js` are the only
  second copy of the matrix and are pinned to the renderer's `project` by a
  test today (`room-geometry`). That test is the first one rewritten.
- **Old rooms.** A camera or a look saved by `main` opens on the branch. The
  migration is tested against the shipped default and against a posed room.
- **Depth as time.** A grain's depth is when it sounds; the terrain's is its
  age. In the box those were fractions of the box; in the world they are
  seconds along `z`, and `geomSpan` (seconds of sound the depth stands for)
  becomes the scale. `reach` should default to `span`, so the world is as
  long as the sound it shows.

---

## Phase two: objects and cameras

Phase one leaves one camera per frame shape and a fixed set of things —
terrain, ring, solid, boards — each with a place of its own. Phase two makes
the place a property of an *object* and the camera a *choice*.

### Objects

A scene list: `roomEdit.objects = [{ id, kind, at: {x,y,z}, turn, size,
layer, paint }]`. The things phase one places — the ring, the solid, the
data board, the text board — become the first objects of their kinds, with
the same fields they had, so nothing is lost; the terrain and the grains
stay the world's own. Every object has an air bead and a floor bead and is
moved the way the path's points are moved today — the same gesture, learned
once. The layer list becomes the object list: on and off, order, occlusion,
paint, per object.

### Cameras

A camera list: `roomEdit.cameras = [{ id, name, eye, look, fov }]`, and
which one is *live*. The per-frame cameras of phase one become named
cameras with a frame shape attached. A camera is posed by standing in it
and dragging the picture, as now; it is chosen from a row on the stage bar
(the way the frame is chosen today) and in the film dialog. Cameras are
objects too — a camera you are not looking through is drawn in the world as
a small frustum, and can be moved by its beads like anything else.

### What phase two touches beyond phase one

`ROOM_LAYERS` → an object registry; `buildRoomLayers` → the object list;
the frames row → the camera row; `roomCameraForAspect` → the chosen
camera; the section-preset **look** carries objects and cameras; the film
dialog gains a camera picker; `docs/OPEN-WORLD.md` grows the object model.

### The machines

You said the sound's creation should be visible in the world — a machine
you can see the sound come from. That is an object whose place is where its
sound is placed in the mix, and whose drawing is driven by its own engine
feed rather than the master bus. It needs one thing phase one does not
provide: a feed *per source* rather than one master feed. The sequencer
already sends its own; the engine's would need `/api/engine/master` to
answer per rack slot or per voice. That is the first server-side piece of
any of this, and it belongs after the world and the cameras exist to put a
machine in.

---

## Where this is

The `open-world` branch, from `main` at the sequencer-in-the-film commit.
`main` keeps the room exactly as it is. **Steps one and two are built** —
see [`OPEN-WORLD.md`](OPEN-WORLD.md). Steps three onward are not.
