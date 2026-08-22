# The card of type

A box of words in front of the visualiser, with the letters standing off it.
`ui/room-text.js` owns the whole of it; `docs/ROOM-VIEW.md` is the room it sits
in and `docs/ROOM-PAINT.md` is where its three colours come from.

## It is a hole, not a panel

The card is filled with **the background colour**, and that is the entire idea.
A translucent panel laid over the picture reads as a caption stuck to the glass.
A card filled with the ground reads as part of the picture: the lines behind
stop dead at its edge, the way the type on the sleeve does, and what is left is
negative space with letters standing in it.

So the card's colour defaults to whatever the module underneath is drawn on —
the ridgeline's Background slot, or the room's `--bg`. It has its own slot as
well, because a card a shade off the ground is a different and sometimes better
picture, and there is no reason to forbid it. CARD at 0 takes the fill away
entirely and leaves the letters standing on the picture itself.

## The letters are drawn, not styled

"In 3d" here is an extrusion, done the way it has always been done on a flat
canvas: the glyphs are drawn repeatedly along the lean and the face is drawn on
top of the pile. **One copy a pixel**, because stepping any coarser leaves the
sides striped, which at a distance reads as a bad screen rather than as depth.
Each copy is mixed further towards the card as it recedes, so the sides fall
away into it instead of ending on a hard edge in mid-air.

DEPTH is how far they stand off, as a share of their own size; LEAN is which way,
in degrees, measured the way a screen measures — 0 is to the right and 90 is
down. At DEPTH 0 the letters are flat, which is a legitimate thing to want, and
LEAN dims itself when there is nothing to lean.

## Solid, or a frame

STYLE picks between the two. Solid letters are filled and their sides are a
solid mass. **Wireframe ones are outlines all the way through**: the same glyph
stroked at intervals between the face and the back, so what stands off the card
is a cage with the picture showing between its bars. RUNGS is how many of those
intervals there are — two is a front and a back with nothing between them, and a
great many closes back up into something near solid — and STROKE is how thick
they are, as a share of the frame height so it survives being filmed at 4K.

The stroke is floored at one device pixel. Under that a canvas cannot draw a
thinner line and draws a fainter one instead, so the control reads as brightness
rather than as weight and the line shimmers as things move under it. The
ridgeline learned this the expensive way; see `docs/RIDGELINE.md`.

## One routine, two places

`rtDraw` draws the card, and **both the room and the film call it**. The data
block next door is not built this way: it is DOM on screen and a separate canvas
routine in the export, and keeping those two agreeing has cost this program real
money — the background colour alone got out of step twice. Here what is on
screen is what is filmed by construction rather than by vigilance.

On screen it draws onto a canvas of its own, laid over the module's and kept the
same size and pixel ratio. Its own canvas because one of the two modules is
WebGL and has no 2D context to set type with; reaching into the ridgeline's
context to draw over it would have made the card a feature of the ridgeline
rather than of the room.

In the film it is drawn onto the composited frame **after** the room, because it
is in front of everything. This is the opposite of the data block, which is
painted before the room so the terrain and the ring lie over it the way they
would lie over anything painted on the far wall.

## Fractions, not pixels

The box is stored as fractions of the frame and the type as a fraction of the
frame's height. A card placed in a docked window is therefore in the same place,
at the same size, when it is filmed at 4K. Pixels would mean a card that wanders
and shrinks the moment the shape changes, which is a fault the room's own
geometry had to be rescued from once already.

## Moving it

Dragged, not typed. The card is moved by its middle and sized by its eight
grips, which are drawn only while the admin panel is open and the card is on —
the rest of the time the overlay does not take the pointer at all, so the room
underneath stays draggable through it. Double-clicking the card opens a textarea
over it holding the real words; Enter makes a line, Escape abandons, clicking
away keeps.

**Dragging an edge holds the opposite one.** Dragging the west edge moves the
west edge and leaves the east where it is. Holding the centre instead makes the
card slide sideways while it grows, which feels greasy and is what the room's
geometry handles did before they were fixed.

There is a trap here worth naming, because it was live for an afternoon: the
grips were matched with `grip.includes('e')`, which reads well and is wrong —
`'move'` contains an `e`, so dragging the card by its middle also stretched it
eastwards. A grip is one of nine known things and is compared as one.

## The controls

| | |
| --- | --- |
| TEXT | the switch, and a button that opens the words for editing |
| STYLE | solid letters, or a wireframe drawn through |
| ALIGN | left, centred, right |
| SIZE | cap height, as a share of the frame height |
| DEPTH | how far the letters stand off, as a share of their size |
| LEAN | which way they stand off, in degrees |
| LEAD | between the lines |
| TRACK | between the letters |
| PAD | inside the card's edge |
| RUNGS | outlines between the face and the back; wireframe only |
| STROKE | how thick those outlines are; wireframe only |
| CARD | how solid the card is; 0 is no card at all |

And three colours in the palette, offered under both modules because the card
belongs to the room rather than to either visualiser: **Type**, **Type edge**,
and **Card**.

## What is tested

`tests/ui/room-text.spec.mjs`. The tests that matter are not that letters
appear — that is obvious on sight:

- **the card is a hole**, measured as ink inside it against ink beside it, on a
  picture that is busy everywhere. The card under test carries no type, because
  the question is whether the ground is opaque and words on it answer a
  different one. The first version sampled a margin the letters reached into and
  read their own ink as a leak.
- **the letters stand off**, and leaning them moves the ink without changing how
  much of it there is — which is what makes it depth rather than a bolder face.
- **the wireframe is hollow**, measured as less ink than the solid at the same
  size and depth. Both drawing something is not the difference between them.
- **dragging holds the opposite edge**, and moving changes where and not how big.
- **the card is in the same fractions** at 640×360 and at 4K.
- **the film draws it**, watched at the routine rather than at a canvas: the
  module's canvas is composited *under* the card and never sees it, so a probe
  reading that canvas would report the card missing however well it worked. The
  live room goes on drawing its own card while the film runs, so the film's
  calls are told apart by the size they are drawn at.
