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
