# Capturing a performance

*6 September 2026.*

The scale sequencer records a performance the right way: press REC, play, move
whatever you move, and every control you touched has a lane of its own when
you stop. This program already had the machinery for that — the server has
written moves into lanes since August, and it creates the lane if the control
has none — but only eight controls were on the list, and there was no one
button that meant *record everything*. Now there is, and the list is every
engine control that can be changed while the engine runs.

## Capture

**⏺ Capture** on the Automation tab. It arms the recorder in Latch and rolls
the transport; every control that moves while it plays is written into a lane
of its own, and a control keeps laying its value down after the hand comes
off, which is what a performance is. Stopping the transport ends the take, as
does pressing the button again. The lanes appear on the timeline as they are
drawn, because the tab refetches them while armed.

Record's own three-way switch is still there. Touch and Latch do what they
did; Capture is Latch with the transport, in one press.

## What records

Forty-eight of the document's controls, up from eight. One table in
`automation.rs` — `STRETCH_TARGETS` — names each one, labels it for the menu,
and gives its range: the same range `persist::stretch_from_json` clamps to,
so a lane can never ask for a value the document would refuse.

| Group | Controls |
|---|---|
| Time & Pitch | Stretch, Pitch, Window, Cloud over engine |
| Grains | Read position, Rate, Density, Layers, Overlap, Size jitter, Position jitter |
| Pitch movement | Pitch jitter, Pitch drift, Drift rate, Step the drift, Link jitter |
| Scan & shape | Scan, Reverse grains, Wrap positions, Envelope, Size range, Layer spread, Layer scatter, Scatter range, Pan spread |
| WSOLA | Detector, Search, Stride, Guard, Floor |
| Vocoder | Analysis window, Phase lock, Freq trust, Phase spread, Peak width, Lock width, Freeze, Blur, Gate, Link stereo |
| PVSOLA | Re-anchor, Search, Blend |
| Hybrid | Margin, Remake noise, Tone, Hits, Air |

The rack's controls — every effect's, and the maximiser's — were already on
the list and still are.

### Switches and counts are steps

A switch records as nought or one and plays back as off below a half, on
from it; a count — layers, stride, peak width, re-anchor — rounds. The old
recorder found a lane value by bisecting the forward map, which is right for
a smooth range and wrong for a step: a search on a flat run lands on the edge
of it, where a rounding error decides which side the take plays back on. The
table knows its own inverse, so the document's controls no longer go through
the search; only the rack's do, whose ranges are all smooth.

### The read position runs the whole way

`stretch.grain.position` used to map a lane to 0–1 of the file. The control
runs −1 to 1, and a take that swept the read head backwards was clamped to
the start. The lane now covers the control's range. Any lane recorded before
this on that one target — there were none in the working data — would play
back shifted.

## What does not record, and why

The runner writes lanes straight into the audio thread's parameters a hundred
and twenty times a second with nothing rebuilt in between. Controls whose
change *is* a rebuild are left off the table on purpose, because a lane on one
would stall playback every tick:

- **the engine and its quality** — where you are, not a setting; Reset makes
  the same argument;
- **the hybrid's FFT size, time span and frequency span**, which separate the
  whole file again (`live::separate_soon`);
- **WSOLA's transient preservation**, which runs an onset detector over the
  whole file (`live::map_for`);
- **the WSOLA splice and window choices and the tuning scale** — choices,
  with no order a line could run along;
- **the seed**, which is the document's.

They can be set by hand before a take and stay put through it.

## The timeline

The Automation tab draws the take the way the sequencer does: one canvas,
every lane stacked, each in the colour of the module it moves — grains cyan,
the engines green, the document orange, the rack pink — its name in a gutter
on the left, a ruler along the top, and a glowing head where the transport is,
red while it is writing. Click a lane and its editor opens underneath, with
the breakpoints, the curve menu and the target menu exactly as before. One
editor at a time: fourteen open editors is a wall.

## Where it lives

- `core/crates/server/src/automation.rs` — `Range`, `STRETCH_TARGETS`,
  `stretch_value`, `stretch_unit`, `stretch_field`, `apply_stretch`;
  `switches_and_counts_are_steps_not_sweeps` and the extended
  `every_offered_target_actually_resolves`.
- `core/crates/server/src/routes.rs` — `record_stretch_moves` goes through
  `stretch_unit`; `record_unit` is the shared write, `record_move` the rack's
  searching front to it.
- `ui/app.js` — `startCapture`, `endCapture`, `drawAutomationTimeline`,
  `laneColour`; `renderAutomation` and `repaintAutomationLanes`.
- `ui/index.html` — `#automationCapture`; `ui/app.css` — `.automation-timeline`,
  `.automation-capture`.
- `tests/ui/automation-capture.spec.mjs`.
