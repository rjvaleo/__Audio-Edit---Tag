# Compose — the plan

Written 14 Sep 2026, on the `open-world` branch. A plan, not a build: what
the Compose view is, what has to exist for it, and the order to build it in.
Nothing here is done unless the checklist at the end says so.

Read with `docs/INFORMATION-ARCHITECTURE.md`, which inventories what is
there today, and whose third option — *one arrangement* — this is.

---

## 1. What it is

One view in which the whole composition is made at once: the sequencer, the
granular player and the visualiser side by side, and every automation lane
underneath them on one timeline.

```
┌ rail ┬──────────────────────────────────────────────────────────────────┐
│      │  GRAIN  (compact)    │  SEQ  (compact)      │  the picture        │
│      │  engine · cloud pad  │  grid · scale · rate │  VIEW · LOOK · cam  │
│      │  six macros          │  four voices         │  (the room, small)  │
│      ├──────────────────────┴──────────────────────┴─────────────────────┤
│      │  THE ARRANGEMENT                                                  │
│      │  ruler ── seconds, and bars at the sequencer's tempo              │
│      │  sound        ▁▂▃▅▇▅▃▂▁  the waveform, the loop, the film's cut   │
│      │  grain lanes  ────╱╲────────── stretch · pitch · density …        │
│      │  seq lanes    ──╱───╲──────── cutoff · rate · scale …             │
│      │  visual lanes ───────╱──╲──── camera · ring · fog · solid …       │
│      ├───────────────────────────────────────────────────────────────────┤
│      │  ▶ ■ ⟲ ●  GRAIN SEQ   00:00.000   REC PERF (armed)   Export       │
└──────┴──────────────────────────────────────────────────────────────────┘
```

Three things it has to be, in order of how hard they are:

1. **A layout.** The three instruments visible together, each smaller than
   its own workspace, sharing one transport.
2. **One timeline.** Every lane from every instrument drawn on one ruler in
   one time base, recorded by one arm, replayed by one Play.
3. **A composition.** The whole thing saved and reopened as one thing, and
   exported as one thing — sound and film together.

The visual side gets what the other two already have: automation.

---

## 2. What already exists, and is reused

Built in the last fortnight, and each a precondition:

| have | used for |
|---|---|
| the shared clock — the sequencer runs on the engine's output time (`playbackTime()`, `seq:transport`, `seq:clock`) | one time base for the timeline |
| GRAIN and SEQ source switches on the transport | which instruments sound, draw, export |
| REC PERF that arms and lets Play start the take, on both instruments | one arm for the whole arrangement |
| the granular automation: server lanes, `STRETCH_TARGETS`, touch / latch, the PERFORMANCE panel port in `ui/perf-panel.js` | the grain group of lanes, and the timeline's drawing code |
| the sequencer's own recorder and its take (`perfLoaded`, `takePlayAt`) | the seq group of lanes |
| the sequencer's offline render and the stem route | the composition's sound export |
| the film with the sequencer in it | the composition's film export |
| section presets: LOOK (visual), CLOUD (grain), engine presets, paint schemes | what a composition file gathers up |
| the open-world camera with a channel box (typed attributes) | visual targets with a value each |
| the element-moving machinery (`enterRoomView` moves `grainControls`, `masterBus`, the transport) | the first, cheap layout |

---

## 3. The layout — phase one

**A sixth workspace.** `mode = 'compose'` on the rail, between Visual and
Seq. The centre becomes a grid: three cells across the top, the arrangement
across the bottom, the transport under it. The top row's height is dragged,
like the dock's is.

**Each cell is the instrument, compact.** Two ways to get there; the plan
takes the first and keeps the second for phase five.

- *Move the existing elements in and set a density class.* `grainControls`
  goes into the GRAIN cell as it goes into the Sound tab today; `masterBus`
  into the picture cell as it goes into the room stage; the sequencer's
  iframe into the SEQ cell. A `.compose` class on the body tightens the
  rows: smaller type, sliders as the channel-box numbers, groups collapsed to
  their heads. Leaving the view moves everything back. Cheap, and it uses the
  machinery the IA document calls a fault — deliberately, for now, because
  it gets the view in front of you in days rather than weeks.
- *Purpose-built compact panels.* A grain panel of the engine picker, the
  cloud pad and six macros; a sequencer compact mode; a picture with only
  VIEW and LOOK. Phase five, once the view has been used and it is known
  what the compact cells actually need.

**The sequencer, small.** It is an iframe with its own layout. First cut: a
`seq:compact` message that hides its header, preset bar and status rows and
lets its grid fill the cell; failing that, a CSS transform scale on the
frame. Its own PERFORMANCE panel is hidden here, since the arrangement is
where its lanes are shown.

**The picture, small.** The room as the master bus draws it in the Grain
workspace, with VIEW and LOOK on a bar above it. The room's editor opens as
the overlay does there. The camera's gestures work at any size.

**The arrangement cell** is the PERFORMANCE panel from the Automation dock
tab, moved, made full width, with the lane groups of phase two.

Deliverable: the view, the three instruments in it, the existing grain
timeline under them, one transport. Tests: entering and leaving moves every
element and moves it back; the transport in the view is the transport; the
sequencer syncs from it; the picture draws.

---

## 4. One timeline — phase two

**Time base.** Output seconds of the engine, from the document's start.
The sequencer is already on it. The ruler shows seconds, and bars at the
sequencer's tempo when SEQ is on. The loop and the film's cut are marked on
the sound row.

**Three groups of lanes** on one canvas, `ui/perf-panel.js` extended:

| group | where the lanes live | drawn from |
|---|---|---|
| grain | the server, `data/AUTOMATION.json`, per document | `state.automation.lanes`, as today |
| seq | the sequencer's take, in its page | a `seq:take` message the bridge posts whenever the take changes, carrying gestures as `{ target, points[{t, v}] }` in output seconds |
| visual | the page, per document (phase three) | `visualAutomation.lanes` |

Each group in its module's colour, as the sequencer's panel already does.
The lane picker is grouped. Collapsing a group is one click. The open lane's
breakpoints are drawn large beneath, as today.

**One arm.** REC PERF on the arrangement arms all three recorders (the
server's latch, the sequencer's `perfArmed`, the visual recorder). Play
starts every take at the playhead; a stop ends them all. The sequencer's own
REC button still works alone in its workspace.

**Editing.** Grain lanes are edited here as they are in the dock today.
Seq lanes are shown and seeked here, and edited in the sequencer's own panel
until the bridge grows a `seq:takeEdit` message — a later step, not this
phase. Visual lanes are edited here from the day they exist.

Deliverable: the three groups on one ruler, one arm, one Play. Tests: a
take from the bridge is drawn where its time says; arming here arms both
recorders; the ruler's bars follow the tempo.

---

## 5. Visual automation — phase three

The visual side has values but no lanes. This gives it lanes the way the
grain side has them, kept in the page, since the visual state is the page's.

**A choke point.** Today the camera's channel box, the sliders, the gestures
and the beads each write `roomEdit` or the camera directly. They go through
one function: `visualSet(target, value)`. Recording hangs off it; nothing
else changes.

**Targets.** A table like the server's `STRETCH_TARGETS`: key, label, range,
kind. Continuous: the camera's seven channels (translate, rotate, focal
length, centre of interest), the ring's size and drive, the solid's turn,
swell, eye and size, fog density, mist amount and length, grain density and
brightness, block opacity, each waypoint's x, y and z, the terrain's place
and reach. Stepped: every layer's switch, the solid's shape, the visualiser
module. A stepped lane holds its value between points.

**Recording and replay.** Same modes as the server: off, touch, latch. While
armed and playing, every `visualSet` writes a point at the playhead. Each
frame during playback, every lane with points is evaluated at
`playbackTime()` and applied through the same `visualSet`, with a flag so it
does not record itself. Touch gives way to the hand; latch holds after it.

**Storage.** Per document, on the server beside the grain lanes:
`data/VISUAL-AUTOMATION.json`, `GET/POST /api/visual-automation?p=`, so a
document carries its picture's movement wherever it goes, and the film can
read it.

**The film.** `runVideoExport` hands the film a snapshot of the room today.
It hands it a function of time instead: the snapshot, with every visual lane
evaluated at the frame's own time. The camera can move in the film without
anyone touching it.

Deliverable: visual lanes recorded, drawn, replayed, and in the film.
Tests: a channel typed while armed and playing lands as a point; Play moves
the camera along its lane; a stepped lane switches a layer at its time; a
film frame at `t` carries the camera the lane says.

---

## 6. The composition — phase four

**One file.** Everything the view shows, saved under a name:

```
composition
  sound        the document (path, edit list revision)
  engine       the engine preset, with sound
  cloud        the grain section preset
  sequencer    its saved state (pattern, scale, voices) and its take
  look         the visual section preset
  lanes        grain · seq · visual
  sources      GRAIN · SEQ
  frame        the film's shape and camera
```

`data/compositions/<name>.json`, listed in a picker on the arrangement's
bar. Loading one loads the document, applies every preset, posts the
sequencer its state, and sets the lanes. The section presets stay as they
are; a composition gathers them.

**One export.** The export dialog gains a Composition button: the sound with
the stem, and the film with the sequencer, from one range, into one folder
named for the composition. The stem's rendering after the export and the
film's rendering are the same render, done once.

Deliverable: save, load, export as one thing. Tests: a saved composition
reopened is the same in every field; an export writes both files.

---

## 7. Compact panels proper — phase five

After the view has been lived in. The moved elements are replaced by panels
built for the cells: a grain panel with the engine, the cloud pad and six
macro knobs bound to the lanes people actually automate; the sequencer's
compact mode built inside it rather than hidden into it; a picture bar of
VIEW, LOOK and the camera views. This is also where the IA document's fixes
land: one home for the room's controls, one name per thing, one preset
picker with a scope.

---

## 8. Decisions taken, and questions still open

Taken:

- Compose is a workspace on the rail, not a mode of Visual.
- The time base is the engine's output seconds. Bars are a ruler, not a
  clock.
- Visual lanes live in the page and on the server per document, not in the
  server's engine automation.
- The first layout moves existing elements; purpose-built panels come last.

Open:

- The sequencer's lanes edited in the host, or only shown there. Shown
  first; edited when the bridge has a take-edit message.
- A gesture on the picture during replay: does the hand win for the touch
  and the lane resume after (touch), or does the hand's value hold (latch)?
  Both, as the server does; default touch.
- Two audio outputs — the server's device and the page's Web Audio — are
  aligned by the bridge's relocate threshold today. A composition of the two
  at sample accuracy would need the sequencer rendered through the server,
  which is a different sequencer. Not in this plan.
- The loop: the sequencer runs straight through a looped export today. A
  composition's loop should wrap the sequencer too. Phase four.

---

## 9. Order and size

| phase | builds | size |
|---|---|---|
| 1 | the view, elements moved, one transport | days |
| 2 | one timeline, three groups, one arm | a week |
| 3 | visual automation and the film reading it | a week |
| 4 | the composition file and one export | days |
| 5 | compact panels proper | as long as it takes |

Each phase is a commit that leaves the app working, tests green, and a note
in `docs/COMPOSE.md`, as the open-world work was done.

## Checklist

- [x] phase one — the view *(14 Sep 2026)*
- [x] phase two — one timeline *(14 Sep 2026)*
- [ ] phase three — visual automation
- [ ] phase four — the composition
- [x] phase five — compact panels *(built first, 14 Sep 2026 — see `docs/COMPOSE.md`)*
