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
