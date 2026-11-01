# The Visual column's controls, drawn

Written 31 Oct 2026, when it was built. `ui/control-pictures.js`,
`tests/ui/control-pictures.spec.mjs`.

The Visual workspace's column held about a hundred and fifty knobs, and every one
of them was a word and a number: *Swell 0.60*, *Window 7.20*, *Key side −0.35*.
You could not tell what a knob did without turning it and looking at the room.
Now each one has a small drawing above it of the part of the room it moves,
drawn from its value, so a turn shows what it did before the room is looked at.

---

## One language

The grain glyphs' (`grain-glyphs.js`), so the Grain tray and the Visual column
read the same way:

- **What the control moves is in colour; the context around it is dim.** A ring
  knob draws the ring in colour and the ground under it in the dim text colour.
- **The colour is the one the palette gives that part.** The ring's knobs are
  drawn in the ring's colour, the terrain's in the terrain's. Paint the ring red
  in the Colour tab and the Ring knobs turn red. A palette change repaints every
  picture (`applyRoomPaintCss` → `cpRepaint`).
- **Across, up and away mean the same everywhere.** Width is across, height is
  up, depth recedes.
- **Dashed is a limit the engine holds** — the grain cap, the silence line.

## Knobs that shape one thing draw it together

Where several knobs shape one object, each knob draws the **whole object from
all of their values**, and puts its own part of it in colour:

| Object | Knobs |
|---|---|
| The ring | Size, Drive, Smooth, Stroke (and the stage's Ring, Drive, High, Rows, Fine) |
| The solid | Turn, Swell, Eye, Size |
| The stacked lines | Rows, Points, Height, Span, Weight, Window, Silence, Smooth, Gain (Ridgeline, Surfaces, the stage's terrain) |
| The camera | Eye, Lift, Aim, Lens · Orbit, Tilt, Distance, Lens |
| The lamps | Key, Key side, Key high, Key at, Fill, Rim, Ambient, Drive, Shadow |
| The room box | Width, Height, Depth, Taper, Grid, Grid fade |
| The grains | Cloud, Size, Drift, Glow, Cap |
| The air | Fog, Mist, Mist size, Drift |
| The tone | Exposure, Contrast |

So turning Drive pushes the ring out of round in the picture above Size as well.
Each picture is a pure function of its group's values on a 64 × 48 grid; nothing
is kept but the list of live pictures, so a reset, a recalled look or an undo
redraws exactly as a drag does.

**Knobs whose range spans decades are drawn by ratio**, not by position
(`CP_LOG`). The room's width sits at four hundredths of its knob; drawn
linearly, its picture was a speck.

## Where things are

- **Room › Layers** and **Colour**: a small room beside each layer and each
  palette slot, with that part lit in its colour — the ground grid, the terrain,
  the edge band, the ring, the solid, the grains and their bloom, cores and
  fill, the mist, the fog, the data block, the background; the stage's eight and
  the ridgeline's three have theirs.
- **Colour › Generate**: each button shows a strip of the palette it makes,
  generated at one fixed hue so the strip is the same each time the panel is
  drawn. Pressing it still makes a new one at a random hue.
- **4D**: every solid in the catalogue has a thumbnail with every edge; every
  rotation plane has a dial showing its angle (the second axis dashed for a
  plane that reaches into *w*); Perspective and Parallel are drawn as a cube
  inside a smaller cube and two the same size.

## What is not drawn here

- **Fog and Mist** were drawings before this (`rkFog`, `rkMist`) and stay theirs.
- **The camera pads** are already pictures of the camera.
- **The Sound tab** is the Grain tray moved in, and its knobs carry the grain
  glyphs (`grain-glyphs.js`), not these.

## Screen readers

Every picture is `aria-hidden`. The knob keeps its name and its reading; the
picture carries nothing they do not.
