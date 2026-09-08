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

**⏺ REC PERF** on the Automation tab — the sequencer's button, on the
sequencer's panel. It arms the recorder in Latch and rolls
the transport; every control that moves while it plays is written into a lane
of its own, and a control keeps laying its value down after the hand comes
off, which is what a performance is. Stopping the transport ends the take, as
does pressing the button again. The lanes appear on the timeline as they are
drawn, because the tab refetches them while armed.

Record's own three-way switch is still there. Touch and Latch do what they
did; REC PERF is Latch with the transport, in one press.

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

## The panel is the sequencer's

The Automation tab is the scale sequencer's PERFORMANCE panel, carried over
rather than imitated. `ui/perf-panel.js` is `performance.js` from
`rjvaleo/scale-sequencer` — the same constants (a 92-pixel gutter, an
18-pixel ruler, 34-pixel lanes that compress to 14 when the panel is
resized, a 22-pixel STRUCT lane), the same drawing (section tints for INTRO,
BUILD, PEAK and OUTRO along the ruler; lanes in the colour of the module
they move; the selected lane in a dashed box; a glowing head, red while
writing), the same header (`PERFORMANCE — <take>`, with the take's length and
lane count on the right), the same transport row (`⏺ REC PERF`, `▶ PLAY
PERF`, `⏹`, the lanes menu and DEL), the same resize grip and collapse, the
same status row with the position display in Teko. The stylesheet rules are
the sequencer's, scoped to the tab under its own palette, and the two faces
are the two the sequencer loads. When the two programs become one
arrangement, this is the timeline they will share.

What differs is only what the data is: a lane has breakpoints in document
frames where a gesture has points in seconds, so the ruler counts seconds —
the document keeps no tempo — and the STRUCT lane carries what the document
has that is discrete: its markers, its regions, the selection. Click a lane
on the timeline, or pick it from the lanes menu, and its editor opens
underneath with the breakpoints drawn large, in the lane's own colour, at the
screen's resolution. The editor's canvas used to be a fixed 1200 by 110
stretched to whatever width the tab had, which is what made it soft.

The faces come from Google Fonts, exactly as the sequencer takes them; offline
both fall back to the system monospace, and the panel is the same panel in a
different face.

## Where it lives

- `core/crates/server/src/automation.rs` — `Range`, `STRETCH_TARGETS`,
  `stretch_value`, `stretch_unit`, `stretch_field`, `apply_stretch`;
  `switches_and_counts_are_steps_not_sweeps` and the extended
  `every_offered_target_actually_resolves`.
- `core/crates/server/src/routes.rs` — `record_stretch_moves` goes through
  `stretch_unit`; `record_unit` is the shared write, `record_move` the rack's
  searching front to it.
- `ui/perf-panel.js` — the sequencer's panel: `perfDrawTimeline`,
  `perfLaneColor`, `perfLaneLabel`, header, status, position, resize, collapse.
- `ui/app.js` — `startCapture`, `endCapture`, `perfFillLaneSelect`;
  `renderAutomation` and `repaintAutomationLanes` draw through the panel.
- `ui/index.html` — the panel's markup under `#dockAutomation`;
  `ui/app.css` — the `.perf-*` rules and the palette on `.automation-body`.
- `tests/ui/automation-capture.spec.mjs`.

## The record mode is the server's, and the page asks

Record mode (off, touch, latch) is held in the server's memory. A reload does
not clear it, and the page used to come up saying Off regardless. Arm, reload,
and every control moved on every file from then on was written into a
`rec-` lane, until the server itself was restarted — which is how lanes turn up
on files nobody meant to capture.

Now `syncAutomationRecord` asks `/api/automation/record` when a file opens and
shows what it is told; if the recorder was left armed the status line says so.
And `pagehide` sends a beacon setting the mode to off, because a recording is
something you are doing, and you are not doing it once the page is gone. One
consequence: closing one window disarms a capture running in another.
