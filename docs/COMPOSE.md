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
`fillVisPicker` is that loop, moved out so both use it — and
`paintVisModulePicker` paints both. LOOK is painted with the stage bar's list
and recalls through its picker. The camera buttons are the Room tab's set
views. ⤢ goes to the Visual workspace.

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
than removing anything. The sequencer's lanes are drawn in its own colours.

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
opens with a click, and a sequencer lane opens a note rather than the editor
and survives Delete; the bars are four beats apart at the tempo and go with SEQ
off.
