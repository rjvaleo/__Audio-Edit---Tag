# Compose

What is built of `docs/COMPOSE-PLAN.md`, in the order it was built. The plan's
fifth phase came first, at the owner's direction, so the view places panels
made for its cells rather than full panels squeezed into them; then the view,
then the timeline, visual automation and the composition file.

The code is `ui/compose.js`, loaded after `app.js`.

---

## Phase five, built first: the compact panels

Three panels, each the size of a cell and each tested on its own in a host of
that size (`tests/ui/compose-panels.spec.mjs`) before any view placed them.

### The grain panel — `composeGrainMount(host)`

The engine, the cloud pad, eight macro knobs and the CLOUD preset.

**The macros** are the controls the recorded lanes show people actually move:
Stretch, Pitch, Window, Position, Rate, Scatter (position jitter), Jitter
(pitch jitter) and Drift (pitch drift). Their ranges, steps, formats and
defaults are the full panel's own (`CG_MACROS`), so a value reads the same in
both places and a double-click resets to the same number. They are the app's
`knob()`, so they turn the way every knob here does: drag up or down, shift for
fine, the wheel, double-click to reset.

**One draft, two panels.** A knob writes `state.stretchDraft` or
`state.grainDraft` and calls the same sender the full panel calls —
`previewStretch`/`commitStretch`, or the grain send — so the server gets the
message it would get from the full panel and records the move into its lane
the same way. The knob then pushes the value into the full panel's control;
the full panel tells the compact panel through `composeGrainSync`, which
`showStretchOut`, `renderGrainParams`, `syncGrainSliders` and the pad call. A
knob under the hand is skipped, because the answer to its own last move arrives
a moment later and would drag it back.

**The engine and the CLOUD preset press the full panel's own controls** — its
engine button, its CLOUD picker — so choosing one here runs exactly what
choosing it there runs, rather than a second copy.

**More than one cloud pad.** `drawCloudPad` and `wireCloudPad` take the canvas
now (the Time & Pitch pad by default), each pad names its own readout with
`data-read`, `drawCloudPads` draws every one on screen, and the grain loop runs
while any pad is visible rather than only the Time & Pitch one.

### The sequencer — its own compact layout

Built inside the sequencer's page, not hidden into it. `body.compact` in
`ui/sequencer/style.css` keeps the tempo, steps, direction, step length, the
voice with its filter, and the step grid in eight columns; it hides the header,
its own play and stop (the host's transport runs it), the presets and capture,
the scale library column, the envelopes, the LFOs, the effects row, the
performance panel, the keyboard and the status bar. The scale library becomes
a menu in the transport row (`#compactScale`), filled by `renderScaleList` and
kept in step by `selectScale`. The two rows it hides by name gained classes,
`synth-voice` and `synth-lfo`.

The host switches it with `seqCompact(on)`, which posts `seq:compact` and
remembers it; a frame that reloads comes back in its full layout, so the
`seq:ready` handler says compact again.

### The picture bar — `composePictureMount(host)`

VIEW, LOOK, Front, Side, Top, Frame and ⤢, over a place for the room
(`#cpRoom`). VIEW is filled from the same menu as the stage bar's picker —
`fillVisPicker` is that loop, moved out so both use it. LOOK is painted from the
stage bar's list and recalls through its picker, and the grain panel's CLOUD the
same way. `app.js` repaints its own pickers and then calls
`composePresetsPainted`, `composeVisPickerBuilt` and `composeVisPickerPainted`,
so the ids the compact panels build are looked up only in `compose.js`, which
builds them. They were first painted from `app.js` directly; the interface check,
which requires every id `app.js` looks up to be in `index.html` or made by
`app.js`, caught it. The camera buttons are the Room tab's set views. ⤢ goes to
the Visual workspace.

---

## Phase one: the view

A sixth workspace on the rail, **Compose**, between Visual and Seq.

```
┌ GRAIN ──────────┬ SEQ ───────────────┬ picture ────────────┐
│ compact panel   │ the sequencer,     │ VIEW · LOOK · camera │
│                 │ compact, laid over │ the room             │
│                 │ this cell          │                      │
├─────────────────┴────────────────────┴──────────────────────┤
│ the arrangement — the PERFORMANCE panel, full width          │
├──────────────────────────────────────────────────────────────┤
│ transport · GRAIN · SEQ · Export · Video                     │
└──────────────────────────────────────────────────────────────┘
```

**Moved in, not copied.** The room (`#masterBus`) goes into the picture cell,
the transport and both export buttons into the foot, and the PERFORMANCE panel
(`#perfPanel`) into the arrangement. Each is put back exactly where it came
from when the view is left — `CV_PARTS`, `cvAdopt`, `cvReleaseAll` — the same
contract the Visual workspace keeps with `roomAdopt`. The arrangement carries
the `automation-body` class, since the panel's colours are scoped to it.

**The sequencer's frame is laid over its cell, not moved.** Taking an iframe
out of the page and putting it back reloads it, and a reload loses its audio,
its pattern and its take. So `#seqView` stays where it is in the page, is
shown, and is fixed over `#cvSeq` at the cell's rectangle. A watch that runs
only while the view is open keeps it there whatever moves the cell — a grip,
the rail opening, the window (`cvDockSeq`, `cvWatch`: one measurement a frame,
a write only on a change). Leaving takes the position off and puts the
sequencer back in its full layout; the Seq workspace shows it as it always
has. The frame sits under the scrim and every overlay.

**The room in its cell** answers the camera and shows its beads —
`roomEdit.on` is set, and the bead painter admits Compose as well as the
Visual workspace — without the Room tab's editor panel, the meter column, the
resolution buttons or the peak readout, which belong to the other workspaces.
⤢ on its bar goes to the Visual workspace.

**Sizes.** Three grips: two between the cells, one under the top row. Dragged
with the usual lost-release guard, remembered in `audiolab.compose.sizes.v1`,
reset with a double-click. The frame, the pad, the timeline and the room are
redrawn at the new size.

**The timeline's playhead moves while playing** now, fifteen times a second,
wherever the timeline is on screen — the dock's Automation tab or the
arrangement. It used to be redrawn only when the lanes changed. Fifteen rather
than sixty because a recorded take can hold thousands of breakpoints.

Tests: `tests/ui/compose-view.spec.mjs` — the workspace is on the rail with the
three panels, the room, the transport, the exports and the timeline in it;
everything moved in goes home exactly, through Edit and through the Visual
workspace; the sequencer is laid over its cell, compact, and is the same page
after leaving for the Seq workspace and coming back; the grips resize the cells,
the frame follows, the sizes survive a reload and reset; the small picture
dollies on the wheel, shows its beads, and the timeline spans the arrangement.

---

## Phase two: one timeline

The grain's lanes and the sequencer's take on one ruler, with one arm for both
recorders. `ui/perf-panel.js` draws it; the sequencer's side is in
`ui/sequencer/performance.js` and `bridge.js`.

**One time base: the engine's output seconds.** A grain lane's frames are
output frames at the file's rate (the server records them through
`engine_to_document`), and the sequencer runs on the engine's output time, so
both land on the ruler where they sound. The timeline's playhead now reads
`playbackTime()`. It read the source frame before, which is a different clock
whenever the sound is stretched — at four times the head crawled across a
quarter of the ruler while the lanes ran the whole way.

**A take knows where it began.** `perfRecBegin(at)` notes `startAt`, the
engine's position when the take began — handed over by the bridge's `playAt`
when the engine's Play starts an armed take, or the bridge's own reckoning of
the engine when a take begins some other way. The bridge replays relative to
it (`takePlayAt`): at `at` on the engine the take is `at − startAt` in, waiting
while that is negative and fast-forwarding from it. Before this every take
replayed as though it had begun at nought, so one recorded from the middle of
a document played somewhere else.

**The take reaches the host as lanes.** Three times a second the bridge builds
`seq:take` (`takeMessage`) and posts it when it has changed: one lane per
control a gesture moved — the value it started the take at, then each gesture,
held at its last value until the next — in engine seconds, with values put on
nought to one by the control's own range; the scale changes, step edits and
switches as STRUCT labels; and the tempo. The host keeps it in `seq.take` and
`seq.tempo`. A take deleted in the sequencer leaves the host's timeline.

**Groups.** GRAIN, SEQ and a place for VISUAL (phase three). A group's heading
is drawn only when more than one group has lanes, so the Grain workspace's
timeline is as it was; a click on a heading folds the group, kept in
`audiolab.perfGroups`. The lanes menu is grouped the same way. A sequencer lane
can be chosen and is outlined on the timeline, but it is edited in Seq, where
it was recorded: the editor shows a note instead, and Delete says so rather
than removing anything. *(Until 14 Sep 2026: a sequencer lane now opens in the
editor here — see "the sequencer's lanes, edited here" below.)* The sequencer's lanes are drawn in its own colours.

**One arm.** REC PERF arms the sequencer's recorder with the grain's while SEQ
is on and the sequencer is loaded (`seqArm`, `seq:arm`); the engine's Play
begins both takes, a stop ends both, and disarming before Play disarms both.

**The ruler.** While the sequencer is playing a part, its bars are ticked along
the ruler's foot at four beats to a bar, numbered every few as room allows
(`perfBars`). In the Compose arrangement a SOUND row sits under the ruler — the
document's envelope across its own length, and the loop marked while looping
is on. A take running past the document's end lengthens the ruler.

**Sampled curves are cached** (`perfGrainPath`), per lane, until an edit —
`saveAutomation` bumps the version — since a recorded take holds thousands of
breakpoints and the playhead redraws the timeline while playing.

Tests: `tests/ui/compose-timeline.spec.mjs` — a take notes where the engine was
when it began, replays half a second in at half a second past it, and waits
before it; the take arrives as a SEQ lane in engine seconds with its scale
change and tempo, grouped beside a grain lane, in the menu and the header, and
leaves when deleted; REC PERF arms and disarms the sequencer's recorder, and
leaves it alone with SEQ off; the playhead is output time; a group folds and
opens with a click, and a sequencer lane opens in the editor and Delete removes
it from its take; the bars are four beats apart at the tempo and go with SEQ
off.

---

## Phase three: visual automation

The picture gets what the grain and the sequencer already had: lanes that move
it over the document's time, recorded by the same REC PERF, drawn on the same
timeline, and read by the film. `ui/visual-lanes.js`.

**A visual lane is the grain's lane shape** — `{ id, target, label, enabled,
points: [{ frame, value, curve, tension }] }`, frames in output frames at the
file's rate, values nought to one — with a `visual.` target and an id beginning
`vis:`. Being the same shape is what lets the timeline sample and draw it and
the lane editor edit it with the code the grain's lanes use; `laneSave` sends an
edit to the store the lane came from, and undo keeps both kinds of lane.

**The targets** (`VIS_TARGETS`): the camera's seven channel-box attributes,
written through the channel box's own functions so a lane moves the camera
exactly as typing into it does; the ring's size, drive, stroke and smoothness;
the solid's turn, swell, eye, size and shape; the cloud and its burn; fog and
mist, on and by amount; the data block's opacity; and every layer's switch. A
slider's range is the slider's own. A switch, and the solid's shape, are
stepped: rounded to a whole value.

**Recording listens rather than intercepts.** The picture has many hands on it —
sliders, the channel box, the camera's gestures, the beads, the wheel, the
keys — and routing every one through a setter would rewrite each of them. So
once a frame while the transport runs (`visualLanesTick`, from the transport's
tick) every target is read and compared with what it was last: a value that
moved, and was not moved by a lane, is the hand. The server records the grain's
controls the same way, comparing the panel before and after. While REC PERF is
armed and playing, the hand's value is written into its lane — thinned to a
point every thirty milliseconds unless the value moved, and over whatever this
take has covered — and in latch it is written until the transport stops. The
take is saved when it stops.

**The hand wins.** A target the hand has just moved is left alone by its lane
for four hundred milliseconds (`VIS_HAND_HOLD_MS`), and in latch until the
transport stops. Bypass stops the picture's lanes with the grain's.

**Kept per document on the server**, beside the grain's lanes, in
`VISUAL-AUTOMATION.json`: `GET` and `POST /api/visual-automation?p=`. The store
(`DocJsonStore` in `docs.rs`) keeps the JSON as the page sends it, drops a record
with no lanes, and has a unit test. The lanes are loaded when a document opens.

**The film reads them at every frame's own time.** `runVideoExport` hands the
export `visual`, and for each frame `video-export.js` asks it for the camera, the
layers and the room's own values at that frame's place in the document.
`visualFilmFrame` borrows the live room for the length of one call — writes
every lane in, reads the film's settings out through the same functions the
export uses, and puts everything back — so what is filmed is what the room
would be, and the room on screen is left as it was. Nothing is painted in
between. Camera lanes move the camera posed for the film's shape.

**On the timeline** they are the VISUAL group, in their own colour, under short
names (CAM TURN, RING SIZE, LAYER GROUND …), in the lanes menu under VISUAL, and
Delete removes one from its own store.

Tests: `tests/ui/visual-lanes.spec.mjs` — a camera move while armed and playing
is written in output time and nothing else is, is saved, and comes back after a
reload; a lane replays the camera, a stepped lane switches a layer, the hand
takes the camera from its lane and the lane takes it back; the film is handed
the lane's camera at a frame and the room on screen is unchanged, and the export
hands the film that function; visual lanes are their own group, open in the
editor with the picture's targets, and Delete removes one without touching the
grain's. `docs.rs` — the store round-trips and drops an empty record.

---

## Phase four: the composition

Everything the view shows, kept under a name and put back as one thing; and
one export that writes the sound and the film of it into one folder.
`ui/compose.js` on the page, `core/crates/server/src/compose.rs` on the server.

**What a composition keeps** (`compositionSnapshot`): the sound's path; the
engine's settings as the server holds them — the stretch with its grain cloud,
its tuning and every engine's own values — and the rack; the sequencer's state
and its take, asked of the frame with `seq:state-get`; the look
(`visualSnapshot`); the grain's lanes with their bypass, and the picture's
lanes; the GRAIN and SEQ switches; the film's frame; and the view's own sizes.
The section presets stay what they are — a composition gathers what each of
them would keep.

**Kept on the server**, one file per composition in `data/compositions/`,
named for it: `GET /api/compositions` lists them by the name they were saved
under, `GET /api/compositions/get?name=` reads one, `POST /api/compositions`
keeps one, `POST /api/compositions/delete` deletes one. The name is kept inside
the file, because the file name is the name made safe (`docs::safe_name`): a
slash becomes a hyphen and leading dots go, so no name climbs out of the folder
or hides in it.

**Opening one** (`compositionApply`) puts the parts back in the order that lets
each land on what the one before set up: the sound, if it is not the one open;
its stretch through `/api/edit` and its rack through `/api/rack`, with the
panels rebuilt; the grain's lanes through `/api/automation`; the picture's
lanes; the look; the frame; the switches; the sequencer's state and take, posted
as `seq:load` once the frame answers — the take made the loaded one and put at
the head of its list of takes; and the view's sizes.

**The bar** sits over the arrangement: COMPOSITION, a picker that opens one,
SAVE AS…, DEL, and EXPORT…, which opens the export dialog.

**One export.** The export dialog has a **Composition** button. It exports the
sound — with the sequencer as the dialog's switch says — into a folder beside
the document named for the composition (or for the sound, when none is picked),
waits for it to finish, stem and all, and then makes the film with the same
range, repeats and tail and saves it into the same folder. Three changes let it:
`/api/export` takes a `folder`; `runExport` can be waited on (`exportFinished`,
settled on every way an export can end); and `runVideoExport` takes `save`, so
the film goes to `POST /api/export/film` — which writes it beside the document,
in the folder — instead of downloading.

**A fault found on the way.** The server capped every request body at eight
megabytes and cut a longer one short without saying so. The sequencer's stem is
floats, twenty-three megabytes a minute in stereo, so a sound export of more
than about twenty seconds had only its first twenty seconds of sequencer summed
in. The cap is per route now (`http::body_cap`): the stem and the film may carry
up to two gigabytes, everything else keeps eight megabytes, and a body over its
cap is refused rather than cut.

Tests: `tests/ui/compose-file.spec.mjs` — a composition keeps the engine, both
kinds of lane, the look, the switches, the frame and the sequencer's state and
take, and opening it after all of them were changed puts every one back;
compositions are listed by the names they were saved under, in order, and a name
full of `../` is kept under its own name inside the folder; one export puts the
sound and the film side by side in the composition's folder. Unit tests:
`compose.rs` — a composition is kept, listed, read back and deleted, and a name
cannot climb out; `docs.rs` — a safe name keeps its words and loses its way out;
`http.rs` — a settings body over its cap is refused, and a stem or a film may
carry more than eight megabytes.

## After the phases: the sequencer round the loop

*14 Sep 2026.* A looped export tiles the loop — the server renders the
selection, repeats it as many times as asked, and lets the rack ring out after.
The sequencer's part ran straight on through all of it, so after the first pass
it was playing a different part of its pattern from the sound it was summed
into. It goes round the loop now, in the sound's export and in the film.

**The server's loop, handed over.** The loop the render went round is reported
where the render's progress is: `GET /api/export` carries `sampleRate` and
`loop: { from, frames, repeats }` in output frames, and `GET /api/video` carries
the same `loop` for the film's sound. `exportAddStem` and `videoExport` lay the
sequencer on exactly those numbers rather than working them out again. The film
used to map the selection through a rounded float ratio where the sound divided
exactly, so one could come out a frame longer than the other — a frame a repeat,
a sequencer drifting off its loop over a few hundred repeats. Both use
`routes::loop_plan` now.

**Round the loop in the render** (`renderFilm` in `bridge.js`). With a `loop` of
`{ span, repeats }`, each pass lays the same steps again at the same places in
it — the first boundary after the loop's start, then every step to its end —
and nothing new is played in the tail, where the take holds where the loop
ended, the rule the server keeps for its own lanes. At every pass the take is put
back where it stood at the loop's start and throws its switches again as the
pass reaches them.

**Three faults fixed in the same render.**

- **A take was read from zero.** The live replay learned in phase two that a
  take began at `startAt`; the render did not, so a take recorded ten seconds
  in moved its knobs ten seconds early in every film and export. The take is
  read through `takeValuesAt(take, at)` now, on the engine's clock, and the
  render starts from the take's snapshot, as the engine's Play does.
- **Notes could start a quantum late.** The render stops for a film frame on a
  render quantum's edge, which can fall just past the frame's own time; a note
  due on that edge was scheduled after its moment had rendered and started at
  the next edge, up to 2.7 ms late — and whether it did came down to how a float
  rounded. Notes are laid two quanta ahead of the frame that reaches them.
- **A take in a sound export stepped once a second.** The stem was rendered at
  one frame a second, and a knob is set once a frame. It is thirty while a take
  is loaded.

**Live, the take comes round too.** A jump back — a seek, or the loop wrapping
— used to move the take's clock back and leave every switch it had already
thrown thrown, and a take that had run out before the loop came round stayed
stopped. A jump back now starts the take again from there, and a take the
transport started is started again by a jump even after it ran out.

**One render for the sound and the film.** The plan said the stem after the
export and the film's sequencer were the same render, done once; they were done
twice. While a composition is exported (`seqShared`), the sound asks for the
sequencer in the film's shape — its frame rate, bands and figure — long enough
for the film's outro, and the film is handed that render.

Tests: `tests/ui/sequencer-loop.spec.mjs` — a looped render puts all twelve
notes of three passes where they belong, every pass the same to the sample and
nothing new in the tail, where a straight render moves on; a take is read from
where it began; the sound's export lays the sequencer on the server's loop; a
composition's export renders the sequencer once; live, a jump back puts the take
back and a take that ran out comes round again. Unit tests: `routes.rs` — a
selection maps to output frames by exact division, and a loop is reported
clamped to the document.

## After the phases: the sequencer's lanes, edited here

*14 Sep 2026.* Phase two showed the sequencer's lanes on the timeline and left
them to be edited in Seq, until the bridge had a message for it. It has one now,
and a sequencer lane opens in the same editor as the grain's and the picture's.

**In the editor's shape.** `seqEditLane` turns a lane of the take — points of
`[output seconds, 0..1]`, as `takeMessage` sends them — into breakpoints in
output frames at the file's rate, joined by straight lines, since a take moves
in straight lines between its points; the curve menu is fixed at linear and the
on switch is hidden, because a take has no switch per lane. The editor spans
the take as well as the sound (`laneSpanFrames`), since a take can run past the
sound's end, as the timeline above already allowed.

**Every edit goes back to the take.** `laneSave` sends a sequencer lane as
`seq:take-edit` (`seqLaneSave`), and draws the change at once rather than when
the take comes back. In the frame, `takeEdit` makes the lane the control's
gesture again: its points in the take's own time and the control's own units,
and the first of them the value the take finds the control at. A point before
the take began moves the take's start back, one after it ended moves its end
on, and the take is kept in the sequencer's list and sent back to the host.
Nothing is edited while a take is being recorded.

- **Moved onto another control** from the lane's menu — the sequencer's
  controls, named as the take names them — the lane's moves go with it.
- **Deleted**, from the × or DEL, the control's gestures are removed from the
  take.
- **+ LANE**, with a sequencer lane open, adds the sequencer's first control
  that has none, flat across the take at where the take found it.
- **Undo** keeps the take's lanes with the grain's and the picture's; undone,
  they are sent back whole (`lanes`), and only when they differ.

**The lane is drawn as the take plays it.** A control a take moves stays where
the take found it until its first gesture, then moves. The lane used to be drawn
as a slope from the take's start into that gesture; it is held flat and stepped
now, and the grain's bypass no longer dims a sequencer lane, since a take plays
regardless of it.

Tests: `tests/ui/compose-timeline.spec.mjs` — a sequencer lane opens in the
editor on its own control, with straight lines only, and Delete removes it from
the take; a lane's last point dragged in the editor reaches the take in the
take's own time and the control's own units and is kept in the sequencer's list,
with the take's start, its first value and its scale change left where they
were; + LANE adds the first free control flat at its value; the lane moved onto
another control takes its moves with it; and an undo puts it back, with the
dragged point still where it was put.

## After the phases: one output

*14 Sep 2026.* The plan left the two audio outputs aligned by the bridge's
relocate threshold, and said that sample accuracy would need the sequencer
rendered through the server — a different sequencer. It did not need one. The
page's own sequencer is handed to the engine instead: tapped at its master,
every sample stamped with the engine output frame it belongs at, posted, and
added in by the engine's callback on exactly that frame. The grain and the
sequencer leave through one device together, and the engine's recorder, meters
and room have both voices in them.

The sequencer runs a lead ahead of the engine (120 ms) so that its sound is
waiting; Play starts it first and the engine after, and a sequencer knob moved
by hand is heard that much later. Every Play and seek is an epoch both sides
know, so sound from before a seek never lands after it. Round a loop the
sequencer wraps on its own, on the frame the engine will. It is a setting — *The
sequencer · Play it through the engine* — on by default, and when the engine
cannot take the sound the page plays the sequencer as before.

The whole account is in `docs/SEQUENCER.md`, "one output".
