# The stage

One scene, with everything in it. `ui/stage.js` owns it; `docs/PORT-PLAN.md` is
why it exists and what is still to move into it.

## What it is

Not another visualiser beside the others — the space they are all being rebuilt
into. Nine objects share one coordinate system, one camera, one depth buffer and
one palette, which means they can occlude each other, light each other, and be
balanced against each other. That is the whole difference from fourteen separate
drawings, and it is the reason a named visualiser here is an **arrangement**
rather than a program.

| | |
| --- | --- |
| Terrain | the sound along the floor, receding as it ages |
| Sleeve | the stacked lines on the surfaces — the sleeve, on any of five faces |
| Grains | every grain about to sound — a lit solid on the stage itself, or additive strokes in one of the ten views |
| Ring | the Lissajous with depth as time: hoops of light converging on a vanishing point |
| Type | words standing in the space, passed in front of and behind |
| Mist | particles drifting through the light |
| Fog | the air itself |
| Key · Fill · Rim | three lamps |
| Walls | the room, off by default — see below |

## The sound is the light source

This is the whole look, and the first pass threw it away.

Lamps were pointed *at* the sound, which turns the signal into a lit grey object
in a lit grey room — and then the walls, the largest thing in shot, are what the
eye reads first. Measured, correct, and rudimentary.

Every renderer this program has had glows because it is additive lines on true
black: nothing in the frame is not signal. So here the signal **emits** and the
lamps are for modelling the solids.

**Two glows, named for what emits.** `LINE GLOW`, under Look, is every line the
sound is drawn as — the terrain's ridge, the ring, the sleeve — and the mist and
the type that stand in the same light. `GRAIN GLOW`, under Grains, is one grain's
own light. They were both called GLOW, which is the same fault as two pads
sharing an axis: one panel, one word, two different things. A third, `INK`, is in each view's own
editor: it multiplies GRAIN GLOW for whichever of the ten is showing, so Mandala
can be hot and Lattice cool without either touching the other. `BLOOM` is none of
them — it is the spill, and it happens to the whole frame after everything in it
has been drawn.

| | | |
| --- | --- | --- |
| `LINE GLOW` | Look | every line the sound is drawn as, plus the mist and the type |
| `GRAIN GLOW` | Grains | one grain's own light |
| `INK` | the view's editor | this view's strokes, on top of GRAIN GLOW |
| `BLOOM` | Look | the spill, over the finished frame |

**A filled surface made emissive is a white slab.** That was the first attempt at
the above: the terrain lit from inside came out as a featureless ramp, brighter
than the room and with no form in it. The old renderers are not surfaces — they
are *lines*, with a fill behind whose only job is to stop you seeing the lines
further back. The fill is the background colour and is meant to be invisible.

So: the fill takes the ground's colour and emits nothing; the line over it carries
the glow. What this buys over the flat version is that the fill is a real solid in
a depth buffer, so it hides what is behind it **from any angle** rather than only
from one.

## It is not a room

The box was only ever a way of getting depth into a flat picture, and with real
perspective and real fog the depth is already there. The walls are off by default,
the ruling with them, and the camera stands *in* the space rather than back from
it — a stack in the middle third of the frame with black all round is a photograph
of a visualiser rather than the visualiser.

They stay available, because a bounded space is a different and sometimes useful
picture. But open is the default and the shape everything else was tuned against.

## Detail: the preview is a proxy

A video editor cuts at a lower resolution than it delivers at. The row and sample
counts here are the **full** numbers — 120 rows at 320 samples, chosen for a 4K
render where every one of them shows — and `DETAIL` scales how many actually get
built for the window you are watching in.

Fewer of the same lines, which is what a proxy is. It touches nothing you can see
the shape of — camera, light, glow and geometry are identical either way — or the
preview would be lying about the framing rather than merely being coarser.

One function decides how many of anything gets built. Scaled at each use site the
terrain and the sleeve would drift apart the first time either was edited, and a
preview whose objects disagree about their own detail is worse than one that is
simply coarse. **The export overrides it to one**, and its test checks every
`configure` the film makes rather than the first: a film shot at the preview's
detail is a 4K picture of a proxy.

## The controls

**An audit, and what it found.** Fifty-eight numbers and twenty-one switches,
reached through seventeen two-axis pads, under headings like "Sound" and "Look".
Three faults, all of them the same fault — the panel was organised by *kind of
parameter* rather than by *what it belongs to*:

| | |
| --- | --- |
| The same number under two names | `lift` was half of STANDPOINT and half of VIEW. `bloomAmount` was half of GLOW and half of BLOOM. Moving one moved the other and neither pad said so. |
| Things filed away from their object | The type's position lived in the Sleeve group. Which object a control belonged to — the one fact you navigate by — was the thing the headings did not say. |
| `detail` stranded | Described but in no group, so it fell through to a heading called "Other". |
| The camera was five numbers and could not turn | `swing`, `lift`, `eye`, `aim`, `fov` across three pads. See below. |

**A pad is two numbers with their names taken off.** They went in because
forty-four sliders in a column is a list rather than an instrument, which was
true; the answer was wrong. A pad hides both labels, both values and both ranges
to save one row, and you cannot dial a number you cannot read — nor tell, when
two pads share an axis, that you are moving the same thing twice. They are gone
from the panel. `stagePad` is still in the source and nothing calls it.

What is there instead: **one section per object, named after the switch that
turns that object on, in the same order as the switches.** Every control is a
labelled slider with its value showing. One section is open at a time — fifty
numbers are only a list when they are all on screen at once; eight or nine is a
set you can read — and turning an object on opens its section, so the two halves
of the panel stay in step.

A test checks that nothing is offered twice, that every described control has
exactly one control, and that every section names a switch that exists.

## Where you are standing

**The camera belongs to the picture, not to the panel.** Every 3D application
has settled on the same thing: [Maya](https://cycookery.com/article/how-to-pan-and-orbit-in-maya)
tumbles on alt-drag, pans on middle-drag and dollies on right-drag;
[Blender](https://docs.blender.org/manual/en/latest/editors/3dview/navigate/navigation.html)
orbits on middle-drag, pans on shift and dollies on the wheel. Not one of them
asks you to find a slider.

What was here was a **dolly rig**: the camera slid on a plane at a fixed depth
and aimed down the room's axis. That is a rig for looking *at a room*, and it is
why the ten views could not be turned over — you could shuffle sideways and
squint at a thing but never get round the far side of it, which is most of what
those views are for.

Now it is an orbit: a target, a distance, and two angles round it.

| | |
| --- | --- |
| drag | orbit. Drag left and the subject turns left — the picture follows the hand. |
| shift-drag | pan. Slides the *target*, so you can look at a corner of something rather than always its middle. In the camera's own plane, or turning the view makes a sideways drag also push into the screen. |
| alt-drag | the key light. It was on shift, and moved when the camera took the modifier every other program uses. |
| wheel | dolly, proportional — a fixed step crawls far out and jumps through the subject close in. |
| double-click | frame it again. |

**Each of the ten opens from its own place.** A tunnel is looked down, a lattice
across from above, and a fold is only a fold seen square on; one opening camera
for all of them showed most of them edge-on, which reads as a broken projection
rather than as a good picture badly framed. `open` in `ST_LAYOUTS`, and it is
where double-click puts you back.

The four numbers above the sections — ORBIT, TILT, DISTANCE, LENS — are a readout
you can also dial, because a drag cannot hit an exact framing and cannot tell you
what it hit. The old `eye`, `swing`, `lift` and `aim` are described and unlisted,
not deleted: a saved scene may still carry them, and taking four keys out of
`ST_ADMIN_HIDDEN` puts the old rig back.

## Solo

Nine objects means judging any of them through the other eight, and every balance
decision made that way is really a decision about the pile. Shift-click an
object's switch to isolate it.

It is a **filter, not an edit** — turning the other eight off to look at one
means turning eight back on afterwards and hoping you remembered which. And it is
not saved: solo is a way of working, not a look, and a session that opened soloed
would look broken.

Using it found three things the pile was hiding, all of which are in the tests
now:

- The grains are lit solids, and when the lamps came down to modelling strength
  they went too. Soloed, the brightest grain read **63 of 255** — findable rather
  than visible — while the scene looked fine because five other things were in
  it.
- The mist read nothing at all.
- The type would not respond to its own brightness: three different multipliers,
  an identical measured mean. An `emissiveTexture` **is** the emission — a white
  glyph sheet emits white and `emissiveColor` does not scale it. The shape comes
  from the alpha now and the brightness from the colour.

Where the balance lands: terrain 7.6, sleeve 6.8, type 6.1, ring 4.5, grains 4.4,
mist atmospheric. The sound loudest, everything else supporting it.

## The ten views

`ST_LAYOUTS`. Ten placements — a function from a grain to a place — each a few
lines.

**They are the ten grain views now, and the theory that said placement was
enough was wrong.** The first version claimed the only thing separating those
views was where a grain goes. Side by side it did not survive a glance: the p5
Mandala is a dense radial weave and the arrangement was a scatter of dots in the
same positions. What placement leaves out is the stroke, the accumulation and the
density, and those are most of the picture.

All ten carry them now. Every projection is transcribed from
`visualiser/grain-views.html` in the units it was written in — `R` 300, `SPAN`
520, `HEIGHT` 260 — with **one** scale into room units at the end, so the two can
be read side by side and any difference is a mistake rather than a decision. Ten
projections each doing their own conversion is ten chances to get it subtly
wrong, and the first attempt managed exactly that in all ten.

Two kinds, and the difference decides almost everything:

| | | |
| --- | --- | --- |
| **The object** | Shear, Braid, Shells, Lattice | the whole schedule laid out as one thing. No fold — folding it would fold the object. Thinned across all of it, never cut off at the buffer's cap. |
| **The moment** | Swarm, Tunnel, Mandala, Rorschach, Vortex, Ripple | a window either side of the playhead, so the present is the origin by construction. Folded, because the symmetry is a property of the looking. |

`fit` is the only per-view number here that is not the original's. It says how
far a view reaches as a multiple of `R` — the Lattice is a grid of `SPAN × 1.7`
across and the Mandala is a disc of `R`, and framed identically one is a speck
and the other runs off every edge. It exists because the original fits a camera
to each view and this one stands in a room you can walk around.

Their test fingerprints where the ink falls and fails if any two are the same
picture, and a second one checks all ten are actually drawn as strokes rather
than quietly falling back to the placement-only sketch.

## The look belongs to the view

**Ten views is ten things to look at, not one thing seen ten ways.** Braid wants
long trails and Shear wants none; one set of controls for all ten means every
switch of view is followed by a re-dial. So `ST_LOOKS` gives each its own
palette, fold count, glow, trail and colour source — `VIEW_DEFAULTS` from the
original, unchanged — and the editor writes to whichever is showing. Switch away
and back and it is as you left it.

The split is between the look and the sound. Glow, trails, folds, the palette and
what the colour is *of* describe a picture and are per view. Ratio, window,
density and the jitters describe the sound, and there is only one sound.

**What the colour is of** is measured across the range the cloud actually uses,
not the range it could have. Against the engine's ±48 semitones a couple of
semitones of jitter — which is a lot to listen to — spans a fiftieth of the
palette and the whole thing comes out monochrome.

`ST_SEED_PADS` is the other half: six looks in a sixteen-pad library, on disk,
shared across the views. A look worth keeping is usually worth dropping onto a
different view, which is the whole reason to keep one — so the library is shared
while what it lands on is not. Click recalls, shift-click saves what is showing,
alt-click clears.

`speed` and `orbit` did not come across. Both drive the original's own clock and
camera; here the playhead is the clock and the camera is yours.

## The cloud drawn as strokes

**A grain is a tick, not a dot**, and this is the single largest difference
between an arrangement and the view it is named after. A dot carries a position
and nothing else; a stroke carries how long the grain lasts in its length and
what rate it reads at in its tilt — two more facts about the sound, in the mark,
at no cost in clutter. Billboarded, so both read from any angle.

**Additive, on black, with no lighting and no depth writing.** The density is the
accumulation: overlapping strokes sum, and where the cloud piles up the picture
goes white without anything being told to be brighter. Lit solids cannot do this
— a solid in front of a solid is one solid — which is why the same grains drawn
as objects came out countable.

**The moment, not the object.** A ported view reads a window of the schedule
either side of the playhead rather than remembering grains as they are born, so
the grains that have *not sounded yet* are in the picture too. The birth-and-age
cloud has no future in it, and for a view whose whole claim is the present
blooming outward in both directions that is half the picture missing.

**The kaleidoscope is where the density comes from.** The cloud is placed once
and written *k* times under a rotation and an alternating flip — the symmetry is
a property of the looking rather than of the sound. Flipped then turned, in that
order: turning first and flipping the result puts each pair of folds on top of
one another, and twelve of them read as six.

## Traps met along the way

**A thin-instance mesh whose bounding info is never refreshed** reads `null` for
both min and max, culls wrong, and draws its base shape at the origin at full
size — one enormous grain filling the room.

**A per-instance colour buffer needs the material to read vertex colours.** Set up
wrong the whole mesh silently stops drawing, and the picture is identical to two
decimal places with the object on and off. That is the shape of a thing not being
drawn, not a thing too dim.

**Babylon compiles a material's shader asynchronously.** A probe that renders a
hundred frames in one synchronous turn never lets it finish: `isReady` stays false
and the mesh is skipped. A probe that hurries is a probe that lies.

**The app's own render loop calls `frame` with the playhead at nought** whenever
nothing is playing. Interleaved with frames driven from a test, every grain dies
the instant it is born — four thousand born, four thousand dead, never one alive,
with the cloud working perfectly the whole time. Any test that drives this
directly must stop `visGlRaf` first.

**A hidden page does not animate.** `requestAnimationFrame` does not fire while
`document.hidden` is true, so a preview pane that is not the fronted tab draws
nothing at all — no frames, no pixels, and a screenshot showing whatever was last
composited. Every symptom of a dead renderer, from a renderer that is perfectly
alive and correctly not wasting work on a page nobody is looking at. Check
`document.hidden` before concluding anything from a pane.

**Replacing the first match of a line that appears in two functions.** The stroke
path and the solid path are near-identical for a dozen lines each, and a density
change meant for one landed in the other — leaving a `const` referenced above its
own declaration in the function that did not get it. Neither behaved as written
and neither said so.

**Listing `world0`..`world3` in a `ShaderMaterial`'s attributes.** Babylon adds
them itself for a mesh with thin instances; listing them as well puts each name
in the effect twice, and the duplicate takes the attribute location the first was
bound to. The material compiles, `isReady` is true, the mesh is walked, its
`render` is called without throwing — and nothing is drawn. Every check green and
no picture.

**A stroke width is a number of pixels, not a size in the room.** The old
renderers set these with `strokeWeight`. Carried across as world units they came
out at two millimetres in a four-metre room, which is under a pixel — and
measured against the canvas *buffer* height rather than its CSS height they are
half that again on any retina display.

**A hidden pane does not composite at all.** Not merely no `requestAnimationFrame`
— no frames, so a screenshot returns whatever was last on screen, and `readPixels`
on a context without `preserveDrawingBuffer` returns a stale buffer that does not
change however many times the scene is rendered. Both lie, and both lie
*consistently*, which is what makes them convincing. To actually see what the
renderer made: render, then `toDataURL` the canvas in the same synchronous turn,
and put the result in an `<img>`.

**A grain's age is a subtraction from the playhead**, not an accumulator stepped
per frame. An accumulator ties how long a grain lives to how fast the machine
draws, and the film draws as fast as it can.
