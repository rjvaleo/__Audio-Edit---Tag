# The room's palette

Written 20 Aug 2026, when it was built.

Every drawn thing in the room, what it is coloured with, and what that colour is
read against.

---

## What was actually there

Worth writing down, because the room did not look like a thing with five
colours in it:

| | |
|---|---|
| Drawable objects | 9, plus the data block and the ground |
| Draw sites | 18 |
| Colours driving them | **5** |
| Sites driven by three shared tokens | **15 of 18** |

The three were `--wave-2` (cold), `--wave` (hot) and `--accent` (core). Only the
fog and the grain fill had a colour of their own.

**And two of the three were the same colour.** `--accent` and `--wave-2` are
both `oklch(70% 0.16 230)` in the shipped palette, which means:

- Grain wires, grain bloom and all three mist passes were drawn `cold → core` —
  **a gradient between a colour and itself**. Five draw sites ramping between
  two identical ends.
- Terrain surface, terrain ridges, the leading edge, the ring, the skin and the
  grain core all came out as the same blue-to-green ramp. Six objects that read
  as distinct, painted identically.

The panel shows this on opening: three of the fourteen strips are flat and six
are the same gradient.

## A slot is not a swatch

The old `mix(uCold, uHot, vW)` was already a **mapping**: a ramp read against
the weight. So a colour manager that only replaced the two ends would leave the
interesting half of it locked.

Each slot is therefore three things:

- a **ramp** — any number of stops,
- what it is **read against**, and
- the **window** of that quantity to spend the ramp across, and the curve of the
  spending.

A new ramp's window is the whole of its quantity, 0 to 1, with one exception:
**Fog read against Level starts on 0.05–0.27**, because the fog's weight never
leaves that band and a window of 0 to 1 spends most of the gradient on values
it never has. The band is the slot's own (`range` on its `RP_SLOTS` entry),
applies when a ramp is made — switching to Ramp, or a generator — and never
replaces a window already set.

### What can drive a ramp

Five were already varyings and cost nothing:

| Drive | What it is |
|---|---|
| Level | how loud this mark is — what the room always used |
| Depth | how far back, which in this room is how long ago |
| Distance | how far from the eye, which is not quite depth once the room is wide |
| Height | how high up. For a grain that is its pitch |
| Random | a number of its own per mark, steady frame to frame |

The sixth needed a new attribute, and it means something different in each
layer — because what each layer was throwing away is different:

| Layer | Its own |
|---|---|
| Terrain, leading edge | **frequency** — which band this is |
| Ring, skin | **stereo width** — `side` was computed to place the point and discarded |
| Grains, mist, fill | **pan** |

One attribute rather than five. Everything else a mark could be coloured by is
already a varying, so the only thing missing was one per layer, and no layer
wants two at once. Five attributes would be four more buffers uploaded every
frame carrying numbers nothing asks for.

**A layer with nothing of its own is not offered the option.** The attribute is
nought there, so the ramp would collapse to its first colour and read as the
control being broken.

## Inherit is an absence, not a colour

A slot nobody has touched is **left out of what the renderer is handed**, and
the shader then takes the same two-colour branch it always took.

That is the difference between the default being *identical* and being *close*.
Reconstructing the old behaviour — filling every row with the theme's pair and
sending it — would look right and be a shade off forever, in a way no screenshot
would ever reveal. `rpForRenderer()` returns `slots: null` until something is
actually set, and the test asserts on that rather than on pixels.

## The ramps are a texture

One 256 × 16 RGBA texture, a row per paintable thing. Both dimensions are powers
of two, which is what lets it take a `LINEAR` filter without mipmaps on WebGL 1.

A texture rather than an array of stop colours in the shader because the number
of stops is then the interface's business, and because one texture bound once is
cheaper than re-uploading stop uniforms at eighteen draw calls a frame. It is
re-uploaded only when the palette changes, which is why `roomPaint.version`
exists — comparing three kilobytes every frame to discover nothing happened is
the thing the counter avoids.

**The strip in the panel is built from the same stops in the same order with the
same interpolation** — plain sRGB, which is also what a CSS `linear-gradient`
does. A perceptual space would give smoother midpoints and a preview that
quietly lied. This file exists because a second implementation of a colour is
how the room ended up with six objects painted identically; the preview is not
allowed to become another one.

## The background came from two places

The live room sat on `--sink` (the room cell's own background) and the video
export read `--bg`. Different tokens, `oklch(8%)` against `oklch(11%)` — so an
exported file came out on a visibly lighter ground than the room that had been
posed.

Both now ask `roomGroundColour()`, and the palette owns the answer.

## Every generator is dark, and that is not a style choice

`Monochrome`, `RGB`, `Spectrum`, `Vibrant`, `Muted`, `Black & white` — and all
six put bright marks on a dark ground.

**The room adds light.** Every pass is `blendFunc(SRC_ALPHA, ONE)`, which is
correct for light and means a mark can only ever make the ground *brighter*. On
a pale ground there is nowhere to go: black adds nothing, and a dark blue line
over near-white is near-white.

So there is no white-background scheme, and it is not an oversight. A light room
would need the marks drawn subtractively — `blendFunc(ZERO, ONE_MINUS_SRC_COLOR)`
against a pale ground, which is how ink on paper actually behaves. The machinery
is half there: the ring's border and the background-mode grain fill already
multiply the destination down, because black could not be added. Generalising
that into a mode would mean re-tuning every alpha in the room, all of which were
chosen for addition.

`Spectrum` is the one to look at first: it sets the floor and the leading edge
to read against **frequency**, which turns the terrain into a spectrogram —
something the room could always have shown and never did, because the only
quantity on offer was level.

## Testing a drive means holding everything else still

The floor probe pushes **a flat spectrum** — every band at the same level — so
`Level` is constant across the whole floor. Any colour that varies left to right
can then only have come from the drive being asked for.

With a shaped spectrum the test would pass on a renderer that ignored the drive
entirely, which is why there is a second test using the same three colours, the
same floor and the same signal with the drive set to `Level`, asserting the
floor comes out *one* colour. One of the pair fails if the drive is ignored;
the other fails if it is over-applied.

Two things had to be got right for the probe to measure anything at all, and
both produced a confident wrong answer first:

- **The terrain layer was switched off.** The first run sampled thirteen lit
  pixels of empty room and reported the drive as not working.
- **The floor clipped to white.** Fifty-six rows blended additively at a normal
  level sum well past 255, so every channel saturates and the hue — the only
  thing being measured — is gone. The probe runs at −46 dB.

Setting only `terrainRidge` also fails, quietly: the surface underneath is most
of the lit area and it was still inheriting, so its blue sat over the answer.

## A stop that would not stick  *(6 Sep 2026)*

Reported on the Solid's ramp: pick a colour for one stop, then for the other,
and the first goes back to what it was — in the strip and in the room, while
its well still shows the colour you picked. Every control in the stops editor
rebuilt the list from a copy taken when the editor opened, so each edit was
made against the list as it was *before the last one*. Adding or removing a
stop did the same, and threw away every colour picked since the panel was
built.

The editor keeps one list now, written in place by every handler and pushed
whole. It is sorted once, when the editor is built, because each row addresses
its stop by index and the order must not move under it; a stop dragged past
its neighbour is sorted on the next rebuild. `editing one stop does not put the
other back` in `tests/ui/room-paint.spec.mjs` is the case.

## The panel: Classic and Modern  *(31 Oct 2026)*

A **VIEW** switch at the top of the Colour tab chooses between two panels over
the same palette. Switching changes the controls and nothing about the room.
The choice is kept in the browser (`roomPaintView`); Modern is the default.

**Classic** is the panel as it was before the design pass, kept whole as the
`…Classic` functions: a row of buttons for the mode, a slider per stop, a menu
for what the ramp is read against, From, To and Curve as sliders, and *Back to
theme*.

**Modern** gives the tab what the rest of the Visual column has
(`docs/DESIGN-CRITIQUE.md`, "The UI queue", §2):

- **Choices are rows of fixed places**, lit by a tint and an edge: the mode
  (Theme · Colour · Ramp) and what the ramp is read against (six places, the
  sixth named for the layer's own quantity — Stereo width, Pan, Frequency,
  Depth in w). **A choice a slot does not have keeps its place, empty** — the
  background's Ramp, Fog's own — so every word is where it is on every slot.
- **The stops sit on the gradient.** A bar shows the ramp with a tick where
  each stop is, capped in its colour; drag a tick along it, or use the arrow
  keys. Under the bar each stop is a cell: its colour, a knob for where it
  sits (built as `rkKnob` builds them, the range input laid over a drawn
  face), and × to take it out. The tick and the knob follow each other. The
  last place adds a stop, in the widest gap.
- **The window is drawn on the ramp it shapes.** The strip is the ramp as the
  room reads it across the whole quantity — the first colour below the
  window, the gradient through the curve across it, the last colour above —
  sampled through the shader's own arithmetic (`rpSpanCss`). Drag the window
  to move it, an edge to move that end; each end is a keyboard slider and
  prints its number under itself. The two ends stay at least 0.01 apart: an
  inverted window is a hard step in the shader, not a reversed ramp. Curve is
  a knob beside it, and the strip shows what it does.
- **Undo.** A generator, a load, or *Theme — as shipped* (first in the load
  menu, in place of the button) keeps the scheme from before it. Undo puts it
  back; a second Undo flips again. Any edit by hand ends it (`rpPrev`, cleared
  in `rpSetSlot`).
- **The list** names what each slot is set to in the word on its button —
  theme, colour, or the quantity a ramp reads — and marks the open slot, its
  editor hanging off an accent rule.

Its CSS is one block at the end of `ui/app.css`, scoped to
`#roomPaintBody.rp-modern`, so Classic draws by the rules it always had.

## Where it lives

- `ui/room-paint.js` — the slots, the scheme, the atlas, the generators, storage
  and the panel, in both views.
- `ui/app.css` — "Visual › Colour as an instrument", the Modern view's block.
- `ui/vis-gl.js` — `aW2`, the ramp uniforms, the atlas texture, and `slot` on
  `draw`.
- `ui/app.js` — `roomGroundColour`, `applyRoomPaintCss`, and `paint:` on both
  frame callers.
- `tests/ui/room-paint.spec.mjs`, and P1–P16 in `tests/ui/design-pass.spec.mjs`
  for the Modern panel and the switch.

Embedded with `include_str!` in `core/crates/server/src/routes.rs`. **Rebuild
the binary after editing any of them** or the browser is served the old file.
