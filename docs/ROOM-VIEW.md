# The room as a workspace

Written 20 Aug 2026, when it was built.

A third mode beside Browse and Edit. The room as big as the window will give
it, with every control it has in a column beside it.

---

## Why the overlay was not enough

`docs/ROOM-EDITOR.md` argues that the room is posed by dragging the room, and
that is still true — every camera gesture is a grab on the box. But the panel of
things that are *not* the camera kept growing: layers and their hierarchy, the
ring's four sliders, the cloud's two, fog, mist, fill, the data block, the frame
selector. That panel is laid over a canvas the size of a postcard in the dock,
and it has twice grown past the room cell and pushed its own buttons out through
the bottom edge — not clipped, but *outside*, over the dock beneath, where a
pointer aimed at them hits the dock instead.

Tightening the rhythm bought one row each time and was never going to buy the
next. The room needed somewhere to be that was not a corner of something else.

## It is built by moving, not by copying

The room, its control panel, the transport and the video button are the elements
the dock already owns. This view borrows them when it opens and hands them back
when it closes. There is no second canvas, no second panel and no second set of
handlers.

That is not tidiness, it is the one fault this program keeps shipping:

- The live room and the exported film each read their own background colour and
  drifted apart — `--sink` against `--bg`, so the file came out on a lighter
  ground than the thing that was posed.
- The theme editor rebuilt its swatches from scratch on every `input`,
  destroying the very `<input type="color">` the system's colour panel was
  attached to.

A control that exists once cannot disagree with itself. `roomAdopt` moves a
part; `roomReleaseAll` puts every part back.

### The next sibling is the part that matters

Remembering the parent is not enough. An element appended back to its old parent
has still moved — it lands at the end — and `#transportBar` returning *after*
the dock instead of before it is a different page. So each borrowed part records
its `nextSibling` as well, and goes home with `insertBefore`.

`appendChild` in that spot passes every test that checks parentage and fails the
one that checks position, which is why the test asks for the index among
siblings rather than the parent's id.

## What the mode changes

`docmode` is the class for *modes that give the whole width to the middle* —
Edit and Room. The library becomes a floating drawer in both, rather than a
docked column, and the tag rail is gone.

It exists because six rules in the stylesheet described that geometry and all
six were keyed on `body.editing`. Adding Room meant either a second selector on
each of them or one name for the idea. The drawer's geometry is one idea.

The tags side is hidden outright. Nothing in this view has anything to say about
folder tags.

## The frame selector shows the frame

`docs/ROOM-EDITOR.md` makes the case for the selector: *nobody can tune a
portrait composition by looking at a landscape one and imagining.* That is only
half true while the box on screen is still the shape of the dock — a camera
posed for 9:16 seen through a wide window is the same act of imagining, one step
removed.

So the stage is a viewport and the room is letterboxed inside it, centred, with
the dead space left plainly empty. What is inside the outline is what lands in
the file.

**`aspect-ratio` alone does not do this.** The cell is a flex item, and flex
resolves one axis from the container before the ratio gets a say — so the box
comes out right in whichever direction flex did not touch and overflows in the
other. Sizing the width against the container's own height settles both at once:

```css
width: min(100%, calc(100cqh * var(--rv-ratio)));
aspect-ratio: var(--rv-ratio);
```

The width is the smaller of what the stage has and what the height allows, and
the ratio derives the height back from it.

### `align-items: center` collapsed the whole room

Centring the stage row that way replaces the default `stretch`, so every child
sizes to its own content instead of to the stage. The master bus's height is
entirely inherited, so it went to nothing and took the room with it — all five
frames measured 0 px tall, including the unframed one.

The framed cell centres itself with `margin: auto` instead, which centres
without touching how anything is sized.

## The panel's labels are on their own line

In the dock a row is `TAG control` on one line. That works there because the
dock's rows carry one control each, and the ones that do not simply run off into
the room behind them.

Here the panel is 300 px and the busiest rows carry four things — FOG is a
switch, a menu, a slider and a swatch. A label competing for that width leaves
every control too small to aim at. Above the controls it costs a line of height,
which a scrolling column has, and buys the full width for the things you touch.

## Every control still has to take the pointer

`.room-edit` is `pointer-events: none` in the dock, because it lies over a
canvas that is itself a control. In this panel there is nothing underneath, so
it is an ordinary block that takes the pointer, and the per-control rules stay
harmlessly true.

**The reachability test asks the DOM what is in the panel** rather than working
from a written list of ids. A list somebody has to remember to extend has
already failed twice here: the whole fill row shipped unclickable, and then the
fog selector, both behind a green test.

### Two breaks that were not breaks

Proving a test can fail is the only thing that makes it evidence, and two
attempts at breaking this one did not:

- Setting `pointer-events: none` back on the panel container **changed
  nothing**, because the per-control rules set `auto` and a child's `auto` beats
  a parent's `none`. The controls were still reachable, so the test was right to
  pass.
- Asserting `body.contains(el)` is DOM containment, which is true of a control
  drawn a thousand pixels outside the panel. That is exactly how `Clear` and
  `Reset` once ended up over the dock.

What catches it is geometry: each control's box has to lie inside the panel's
box. Laid out 900 px wide in a 300 px panel, five controls are reported drawn
outside and the test fails.

## Where it lives

- `ui/index.html` — the rail button, and `#roomView` in `.centre`.
- `ui/app.js` — `roomAdopt`, `roomReleaseAll`, `enterRoomView`, `leaveRoomView`,
  the divider, and the third mode in `setMode`.
- `ui/app.css` — `.roomview` and everything under `.rv-`, which is mostly
  undoing the overlay geometry the borrowed parts wear in their other home.
- `tests/ui/room-view.spec.mjs`.

Embedded with `include_str!` in `core/crates/server/src/routes.rs`. **Rebuild
the binary after editing any of them** or the browser is served the old file.

## The sound the room is drawing

Added 20 Aug 2026, after it was reported as "stretch and grain aren't
functioning in the room designer, and I just exported a video and they didn't
work there either."

Both halves were one fault, and it was not that anything was broken.

This workspace hides the dock, and **every stretch and grain control lives in
it**. So they were not misbehaving — they were not on screen. A room whose sound
cannot be changed from inside it is a room that cannot be designed.

The export half follows from the first: the film is rendered from the
*document*, so a video made from here carried whatever the editor had last been
given. Nothing was ignoring the settings; there had been no way to set them.

They are borrowed like everything else here — `#grainControls` moves into a
**Sound** tab and goes home on the way out. Four tabs now: Room, Sound, Shape,
Colour.

### Present is not the same as usable

The check that would have caught this is the one already written for the room's
own panel: it walks what is in the tab and asks `elementFromPoint` whether a
real pointer would land on each control. The controls were in the DOM the whole
time, inside a hidden dock — a test that only asked whether they existed would
have passed throughout.

It is worth recording that the first run of that check reported **none** of the
forty-four reachable, and that was the test environment rather than the program:
the library tray leaves by a `transform` transition, and a hidden browser tab
freezes transitions at their first frame, so the drawer sat over the panel
forever. The same thing had already been diagnosed once in this file's history.
Finishing the animation before measuring is what makes the reading mean
anything.
