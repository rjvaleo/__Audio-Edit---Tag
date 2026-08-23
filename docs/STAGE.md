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
| Grains | every grain about to sound, as a lit solid, in one of ten arrangements |
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
lamps are for modelling the solids. `GLOW` is the control that matters and it has
a pad of its own.

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

Forty-four sliders in a column is a list, and a list is not an instrument. Most
of what is in here is not one number anyway — where the camera stands, where the
key hangs, how wide against how deep — each is a single decision with two
components, and split across two sliders you make it by alternating between them
and watching a third thing to see whether you have arrived.

So: **pads** for the pairs, sliders only for what is genuinely one number,
grouped small enough to hold in your head. Up is more, which sounds too obvious
to write down and is the thing that makes a pad trustworthy.

Better than a pad is **the picture**. Drag it and the camera stands somewhere
else; shift-drag moves the key light; the wheel dollies. Drag left and the camera
goes right — the picture follows the hand, the way every map and every viewport
has ever worked.

Everything described in `ST_UI` that no group claims still gets a slider under
"Other", and a test checks that the number of controls placed equals the number
described, so adding a setting without touching the groups leaves it reachable
rather than stranded.

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

## The ten arrangements

`ST_LAYOUTS`. The grain views were ten drawings in a separate document on a
separate engine, and the only thing that actually differed between them was
*where a grain goes*. Written as that — a function from a grain to a place — all
ten are a few lines each.

Their test does not check that they draw. It fingerprints where the ink falls in
each and fails if any two are the same picture, because ten names over one
arrangement is what a menu of aliases looks like and the whole claim is that the
difference was only ever the placement.

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

**A grain's age is a subtraction from the playhead**, not an accumulator stepped
per frame. An accumulator ties how long a grain lives to how fast the machine
draws, and the film draws as fast as it can.
