# The unified visualiser

Written 17 Aug 2026, when it was designed.

One surface that composites everything the engine knows into a single image,
with the individual views still reachable behind a picker. Small in the right of
the Time & Pitch tray; poppable into a floating window.

## Why it is not fullscreen

Asked for and ruled out in the same breath: **the granular controls have to stay
workable while it runs.** The visuals are a readout of what the controls are
doing, so a mode that covers them turns the instrument into a screensaver. The
window is movable and resizable and can be dragged to a second screen, which is
the part fullscreen was actually wanted for.

The pop-out mechanism already exists — `buildVisPop` *moves* `#grainVis` into
`#visWindow` wholesale rather than rebuilding it, so the picker, the canvas and
the legend stay the same elements the code already drives. The composite joins
that arrangement rather than inventing a second one.

## WebGL, written here

No p5, no three.js, no new dependency. Two reasons, and the second is the one
that decides it:

1. **Ceiling.** The composite draws every grain in the window as a point sprite
   — tens of thousands — plus a spectrum field and a goniometer core, at 60 fps.
   2D canvas runs out long before that; a `fillRect` per grain is a draw call
   per grain.
2. **Provenance.** The visuals are the product, not decoration around it. The
   licensing rule says we do not read copyleft source in any area where we write
   our own, and the rendering of these views is exactly such an area. Writing
   the GL keeps the whole visual path ours.

WebGL 1, unsigned-byte textures, no float-texture extension — it runs anywhere
the rest of the interface does.

## What is composited

Four layers into one image, additively blended so they bloom where they overlap
rather than occluding each other.

| Layer | Driven by | Where it comes from |
|---|---|---|
| Spectrum field | the band spectrum | `/api/engine/master` |
| Grain particles | the schedule, struck by the playhead | `state.grains` |
| Goniometer core | the L/R pairs | `/api/engine/master` |
| Level bloom | 300 ms VU and correlation | `/api/engine/master` |

Every one of these already exists. **The composite needs no new server work** —
the master bus tap feeds three of the four layers, and the grain schedule feeds
the fourth.

### Twenty hertz of data, sixty hertz of picture

The master bus polls at 20 Hz, which is the right rate for numbers and the wrong
one for motion. The scene keeps the previous frame's values and interpolates
towards the new ones, so the picture moves at the display's rate off a feed that
does not. Free, and the difference between "dynamic" and "steppy".

## The picker

The composite is the default. The six grain views — Swarm 2D, Shear, Braid,
Swarm 3D, Shells, Lattice — stay exactly where they are behind the same picker,
so nothing that works today stops working.

## Resolution

The spectrum's detail is a parameter, not a constant: `/api/engine/master` takes
`fft` up to 16,384 (the scope ring is the ceiling) and `bands` up to 2,048. The
interface asks for one band per pixel of the display it is about to draw into,
so more window is more detail, and the transform size is picked in the panel.
