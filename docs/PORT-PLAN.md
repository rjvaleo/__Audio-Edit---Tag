# One engine, one interface

Porting every visualiser to Babylon and putting them all behind a single admin
interface in the Room workspace.

## What there is now

Fourteen visualisers, three engines, two documents, and two places to control
them from.

| | what | where it runs | controls | films |
| --- | --- | --- | --- | --- |
| Swarm 2D | the original grain swarm | 2D canvas, `app.js` | grain panel | no |
| V1 ×5 | Shear, Braid, Swarm 3D, Shells, Lattice | **p5.js, in an iframe** | its own popout | no |
| V2 ×5 | Tunnel, Mandala, Rorschach, Vortex, Ripple | **p5.js, in an iframe** | its own popout | no |
| Room | the master bus as a box | WebGL1, `vis-gl.js` | Room admin | yes |
| Ridgeline | the flat stack | 2D canvas, `ridge.js` | Room admin | yes |
| Surfaces | the stack on five walls | Babylon, `room3d.js` | Room admin | yes |

Three facts shape everything below.

**The ten grain views are in another document.** `visualiser/grain-views.html` is
2823 lines of p5, loaded in an `<iframe>`, which polls the engine for itself and
takes its parameters over `postMessage`. It cannot share a palette, cannot be
filmed, and cannot be driven by the Room's controls, because it is not in the
same page.

**Only the three bus visualisers film.** The eleven grain views have no export at
all — there is no encoder in that document.

**The Room is the biggest single thing here.** 2184 lines, 33 raw shader calls,
seven palette slots of its own, plus terrain, ring, skin, grain cloud, fog, mist
and the data block printed on the back wall.

## The order, and why it is this order

Every phase leaves the app working. Nothing is deleted until the thing replacing
it is better, and "better" means measured, not asserted.

That is not caution for its own sake. The rule for this work is *same or better,
only upgrades* — so the way to sequence it is that at no point is a working
visualiser off the air waiting for its replacement.

### Phase 0 — one registry, one interface

Before any renderer moves, describe all fourteen in one place: family, engine,
canvas, controls, palette slots, whether it films. The Room's admin column reads
that registry and nothing else, so a visualiser's controls come from its own
description rather than from a panel written by hand for it.

The existing renderers stay exactly as they are behind adapters. This phase adds
a way to *reach* everything from one place; it changes nothing about how anything
draws. It is the refactor, and it is the only phase that touches every file.

**Done when** all fourteen are pickable from the Room, each shows its own
controls, and every existing test still passes.

### Phase 1 — dissolve the iframe *(the views are in; the document is not out)*

The ten grain views come in-process onto Babylon: one scene, one camera rig, and
a builder per view. They stop polling for themselves and are fed by the same push
the bus visualisers get.

This is the phase with the most to gain. Those ten views pick up the palette, the
unified controls, and — for the first time — **the export**. It also takes p5 and
its 954 KB out of the binary.

**Done when** all ten draw in-process, film, and the iframe and p5 are gone.

**Where it got to.** All ten draw in-process and all ten film, which is the half
that matters — and it took ten functions rather than a port of 2823 lines,
because the only thing that ever differed between those views was *where a grain
goes*. Written as a function from a grain to a place, they are arrangements of
the one scene. In ten scenes they would have been ten programs.

**The document is still there, and deliberately.** `grain-views.html` and p5 are
still served and still reachable from the editor's own grain tabs. Deleting them
is a deletion of 2823 lines of carefully made work in favour of ten short
functions written this evening — and the person whose work it is has said, of
the older visualisers, that the originals were the best. That is a judgement to
be asked for, not assumed. The 954KB stays until it is.

The arrangements are additions. Nothing was taken away to make room for them.

### Phase 2 — Swarm 2D

The smallest port and the one that proves the grain data path in Babylon end to
end. Worth doing after Phase 1 rather than before: by then the grain scene rig
exists and this is one more builder on it.

### Phase 3 — the Room

The big one. Terrain, ring, skin, the grain cloud, fog, mist, and the data block,
plus the ramp-atlas palette that colours all of them.

What it buys is real and specific:

- **Line thickness.** WebGL1 clamps `gl.lineWidth` to 1 on nearly every driver,
  which is why the room's wires cannot be made heavier and why WEIGHT on the flat
  stack behaves the way it does.
- **Glow that is a glow**, rather than additive blending standing in for one.
- **Depth-buffered occlusion.** The room's `occlude` controls exist because it has
  to sort by hand. On an engine that is free — the same thing that made Surfaces
  possible at all.

The current room keeps running until the new one matches it feature for feature,
slot for slot, with the export producing the same picture.

### Phase 4 — the Ridgeline

**Probably not.** It is a flat stack with painter's-algorithm hidden-line removal
and an engine buys it nothing. It is listed here so the decision is recorded
rather than forgotten. If it moves, it moves last and only to retire `ridge.js`.

### Phase 5 — retire

`vis-gl.js`, `grain-views.html`, `p5.min.js`, and the postMessage bridge come out
once nothing calls them — and only once someone has looked at what replaces each
and said it is better. "Nothing calls it" is a fact about the code; "it is no
longer worth having" is a judgement about the work, and the second one is not
mine to make.

### What the stage has, as of the rebuild so far

Nine objects in one scene, every one with a switch and a solo: walls, terrain,
grains, ring, sleeve, type, mist, fog, and three lamps. Real lighting, real
exponential fog, a particle system, shadows, ACES tone mapping and bloom.

Controls: fourteen pads for the pairs that are one gesture, sliders for what is
genuinely one number, all of it generated from a description rather than written
out by hand — and the picture itself is draggable, which is better than either.

DETAIL is the preview's proxy; the film always draws all of it.

## What this is not

It is not one sitting. Phase 0 is a day's work on its own; Phase 3 is more. The
honest shape is one phase at a time, each landing green, each verified in the
browser and not only in a test.

The failure mode to avoid is the one that already happened once: a change that
looks right in a headless probe, ships, and blanks the visualiser. Every phase
here ends with all fourteen drawing from a cold load, no panel over the picture,
and the export producing a file that plays.
