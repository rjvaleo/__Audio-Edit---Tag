# Information architecture

Written 14 Sep 2026, on the `open-world` branch, as an inventory to redesign
the navigation from. It records what is there, where it is reached from, and
where the same thing is reached from more than one place. It proposes nothing
until the last section, and that section is options, not decisions.

The Visual section is inventoried to the row, because that is the part being
redone. The rest of the app is inventoried to the panel, so the Visual section
can be seen in its place.

---

## 1. The frame

Everything sits in one window with five fixed regions and a set of overlays.

```
┌ menu bar ──────────────────────────────────────────────────── gear ┐
│ File  Edit  Action  DSP  Audio  Window  View                        │
├──┬──────────────┬──────────────────────────────────────┬───────┬──┤
│  │              │                                      │       │  │
│ r│  left panel  │            centre                    │ right │r │
│ a│  (one pane   │  (what the workspace is)             │ panel │a │
│ i│   at a time) │                                      │ Tags  │i │
│ l│              │                                      │       │l │
│  │              ├──────────────────────────────────────┤       │  │
│  │              │  transport bar                       │       │  │
└──┴──────────────┴──────────────────────────────────────┴───────┴──┘
   overlays: modals, floating windows, the visuals menu, toasts
```

### 1.1 Menu bar (`ui/app.js`, `MENUS`; `docs/MENUS.md`)

| menu | items |
|---|---|
| File | Choose library, Re-scan library, Open in editor, Close document, Export, Save tags |
| Edit | Undo, Redo, Cut, Silence, Fade in, Fade out, Reverse, Add marker, Add region, Select all, Deselect, Revert document |
| Action | Set selection, Select all, Fit selection, Zoom at sample level (start/end), Zoom out all the way, Snap to zero crossings / CD frames / off, New marker, New region, New region split, Markers to regions, Nudge markers, Rename, Delete markers in selection, Go to |
| DSP | Normalize, Normalize (RMS), Find peak, Fade in, Fade out, Reverse, Strip silence, Repair click, Crop, Duplicate, Insert silence |
| Audio | Play / pause, Stop, Loop, Capture what is playing, Reset time, pitch and grains |
| Window | Grains (floating), Master bus full screen, Edit the room, Keys |
| View | Browse, Edit, Zoom in, Zoom out, Fit, Grain views in a panel |
| ⚙ (right end) | Settings modal: how edits land (snap), what the library lists (play all), watching it play (follow on/mode), the shape of the window (lane split, panel widths), what is drawn (grain centre, master FFT). "Put everything back". |

Every menu item presses a control that exists somewhere else. The menus are a
second route, never the only one.

### 1.2 Left rail (`ui/rail.js`; `docs/RAIL.md`)

Five workspaces, one library group, and Record at the foot.

| button | what it switches | kind |
|---|---|---|
| Grain | `mode = 'edit'` — the centre becomes the editor | workspace |
| Visual | `mode = 'room'` — the centre becomes the room view | workspace |
| Seq | `mode = 'seq'` — the centre becomes the sequencer frame | workspace |
| Theme | opens the Theme pane in the left panel; the centre is untouched | panel |
| Browse | `mode = 'overview'` and opens the library group: All sounds, Search, Scan, Folder | workspace + panel group |
| Record | opens the Record pane in the left panel | panel |

Two of the six do not change the centre. That is the first fault line: the
rail mixes "where am I" with "what is open on the left".

### 1.3 Left panel — one pane at a time

| pane | contents |
|---|---|
| Browse | filter box, play-all, the library tree |
| Search | text search, "Sounds like the selected file", results |
| Record | input device, meter, Arm / Record / Stop & keep, take name |
| Scan | totals, Scan library / Stop, progress |
| Theme | the theme editor: miniature, name, swatches, waveform colour, Apply / Duplicate / Delete, tokens, copy / import JSON; the palette list with filter and + New; No theme / Plain surfaces; "Your own" colour list |
| Folder | library path, Choose folder, Re-scan, library stats |

### 1.4 Right panel — Tags

Level 1, Level 2, Tags, Notes; your tags; learned; heard as; sounds like;
Discard / Commit. Toggled by the single button on the right rail.

### 1.5 Transport bar

File name, mode label, Play, Stop, Loop, Record (capture), time, zoom out /
label / in / fit, follow toggle and mode, the meta strip, volume. In the Visual
workspace the whole bar is moved into the room's foot.

### 1.6 Overlays

| overlay | opened from |
|---|---|
| Grains window (floating; every grain view and control) | Window › Grains; the pop-out button on the grain views |
| Keys (floating piano) | Window › Keys |
| Presets manager (engine presets) | preset bar › Manage |
| Export loop dialog (repeats, tail, sequencer, range, video size and fps; Export / Export video / Whole file instead) | Export button or File › Export while the loop is on |
| Folder picker | File › Choose library; Folder pane |
| Ask dialog (one number for a command) | any menu command needing a value |
| Settings | the gear |
| Visuals menu admin (order and hide the visuals) | the gear on the edit toolbar, or in the room's foot |
| Toasts | everywhere |

---

## 2. The workspaces (what the centre is)

### 2.1 Browse (`mode = 'overview'`)

The stats view for the selected sound: a grid of numbers and the "why" box.
The left panel holds the library.

### 2.2 Grain (`mode = 'edit'`) — the editor

Top to bottom:

1. **Edit toolbar** — document tabs; Cut, Crop, Silence, Fade in, Fade out,
   Reverse, fade shape; snap unit; Marker, Region; edited flag, Undo, Redo,
   Revert; export bit depth, Export, Video; the visuals-menu gear.
2. **Export progress row** — only while an export runs.
3. **Overview** — the whole file with the zoom window, cue and playhead.
4. **Ruler and lane** — waveform, spectrogram, grain marks, the grain centre
   line, selection, cue, read band, playhead, the lane split.
5. **Regions strip.**
6. **Preset bar** — the five dock tabs on the left (Time & Pitch, Effects,
   Visuals, Automation, Regions), then the engine preset picker, "with sound",
   Save as, Manage, Delete, Random.
7. **The dock** — one tab at a time, resizable:

| dock tab | contents |
|---|---|
| Time & Pitch | left: the engine picker (granular, WSOLA, vocoder, PVSOLA, hybrid) and every stretch and grain control (`stretchParams`, readout, engine load, the cloud pad, the **CLOUD** section-preset row, grain shape, grain pitch; the extended panel). Right: the **grain views** (Swarm 2D, Shear, Braid, Swarm 3D, Shells, Lattice; suite V1/V2; pop-out) and, beneath them, the **master bus** — the room in miniature with its resolution buttons, the VU, the readouts and the "edit the room" button. |
| Effects | the rack: input meter, module rail, output meter, + (the picker: Utility & Shaping, Reverb & Delay, Chorus & Phasing, Pitch & Motion, Noise & Generators — about thirty modules) |
| Visuals | Spectrogram (show, FFT), Live spectrum, Levels, Stereo field |
| Automation | the PERFORMANCE panel: REC PERF, PLAY PERF, stop; + LANE, lane picker, DEL; record mode, BYPASS; SIMPLIFY, LOOP SEL, INVERT, UNDO, REDO; the timeline; the open lane's breakpoints; status and position |
| Regions | the region list |

### 2.3 Visual (`mode = 'room'`) — the room view

The subject of this document. Inventoried in §3.

### 2.4 Seq (`mode = 'seq'`)

The scale sequencer in an iframe, synced to the transport. Its own interface,
its own panels, its own presets. Nothing of it is reachable from anywhere
else in this app except the export dialog's Sequencer switch.

### 2.5 Theme — not a workspace

A pane in the left panel. The centre stays on whatever it was.

---

## 3. The Visual section, to the row

### 3.1 Layout

```
┌ admin column (5 tabs) ┬ stage ───────────────────────────────────────┐
│ Room │ Sound │ Shape  │ bar:  VIEW [Room|Ridgeline|Surfaces|Stage]   │
│ Colour │ 4D           │       LOOK [picker] Save as  Delete           │
│                       │       FRAME [Dock 16:9 1:1 4:5 9:16]         │
│ (the tab's rows)      ├──────────────────────────────────────────────┤
│                       │                                              │
│                       │           the picture (#visGl et al.)        │
│                       │   grips · beads · gizmo · view axis          │
│                       │   data block · edit-the-room button          │
│                       │   resolution 1k…16k                          │
│                       ├──────────────────────────────────────────────┤
│                       │ foot: transport bar · Video · visuals gear   │
└───────────────────────┴──────────────────────────────────────────────┘
```

Three things are **moved** into this view rather than built for it: the grain
controls (into the Sound tab), the master bus element (into the stage), and
the transport bar with the Video button and the visuals gear (into the foot).
Leaving the view moves them back. This is why the same control can be found
in two places in the app: it is one element with two homes.

### 3.2 The stage bar

| control | what it is | also reachable from |
|---|---|---|
| VIEW | which visualiser module draws: **Room**, **Ridgeline**, **Surfaces**, **Stage** | the visuals menu (gear) — which lists these four *and* every grain view *and* every stage arrangement, about twenty-five entries in three groups, with order and hiding |
| LOOK | a named preset of everything in the Visual section (room data, layers, order, occlusion, streams, cameras, paint); picker, Save as, Delete | nowhere else (`docs/SECTION-PRESETS.md`) |
| FRAME | the film's shape: Dock, 16:9, 1:1, 4:5, 9:16; each keeps its own camera | the Room tab (the row is moved here in room view) |

### 3.3 The picture's own controls (no panel)

| control | gesture |
|---|---|
| camera | drag orbit · shift/middle-drag track · wheel/ctrl-drag dolly · right-drag look · WASD QE fly · double-click focus · F frame · Home reset |
| objects | click a bead to pick · drag it free · pull an axis arrow · Delete removes · Escape lets go |
| reach grip | the terrain's length |
| view axis | bottom-left, read only |
| edit-the-room button | toggles the overlay/editor on and off |
| data block | the grain telemetry printed in the corner (a layer) |
| resolution | 1k 2k 4k 8k 16k FFT for the master bus |

### 3.4 Tab: Room (`#roomEdit`, moved into the admin column)

Everything about the **Room** module, in one column, in this order:

| row | control | notes |
|---|---|---|
| LAYERS | Ground, Terrain, Edge, Ring, Skin, Grains, Solid, Data — on/off, drag to reorder, occlusion toggles | the module's layer stack |
| STREAMS | IDX OUT SRC SIZE PIT RMS BRT PAN | which columns the Data layer prints |
| RING | size | the ring |
| DRIVE | how hard the sound pushes the ring | the ring |
| TRANSLATE X / Y / Z | the camera's channel box | camera |
| ROTATE X / Y | | camera |
| FOCAL LENGTH | | camera |
| CENTER OF INT | | camera |
| VIEW | Front, Side, Top, Frame | camera |
| *(picked point)* X / Y / Z | shown while a bead is picked | objects |
| *(legend)* | the gestures, in a note | |
| SOLID | the shape picker: five 4D solids, three higher simplexes, the grain shapes as prisms | solid |
| TURN · SWELL · EYE · SIZE | the solid's four controls | solid |
| PATH | + Waypoint, Straight; the waypoint list with × | solid |
| SMOOTH | ring points | ring |
| STROKE | ring edge | ring |
| CLOUD | grain density | grains |
| EDGE | thick | edge band |
| FOG | on, type, density, colour | air |
| MIST | on, amount, length | air |
| FILL | on, background, colour | grains |
| BURN | grain brightness | grains |
| BLOCK | chunk size, opacity | data |
| FRAME | (moved to the stage bar in room view) | film |
| Clear · Reset | the whole room back to default · this frame's camera back | |
| readout | height, pitch, yaw, fov, focus, at, ring; click to copy | camera |

Twenty-six rows across seven different subjects, in an order that is the
order they were added. The ring's rows are in three places (RING, DRIVE, then
SMOOTH and STROKE after the solid). The camera sits between the ring and the
solid. The grains' rows are CLOUD, FILL and BURN, separated by EDGE, FOG and
MIST.

**The other modules' panels live in the same slot but are not tabs.** Choosing
Ridgeline, Surfaces or Stage on the VIEW row swaps `#roomEdit` for that
module's own panel:

| module | its panel's rows |
|---|---|
| Ridgeline (`#ridgeEdit`) | mode (Driven, Pulsar, Synth, Waveform), ROWS, POINTS, SPAN, HEIGHT, WEIGHT, SMOOTH, WINDOW, SILENCE, GAIN |
| Surfaces (`#room3dEdit`) | ROWS, POINTS, SPAN, DEPTH, LIFT, RELIEF, EYE, LENS, AIM, SMOOTH, WINDOW, SILENCE, GAIN |
| Stage (`#stageEdit`) | about sixty rows: the arrangement (Swarm, Shear, Braid, Shells, Lattice, Tunnel, Mandala, Rorschach, Vortex, Ripple, Terrain, Grains), then room, light, air, grains, ring, type, look — EYE, LENS, AIM, ORBIT, TILT, KEY, KEY AT/HIGH/SIDE, AMBIENT, RIM, SHADOW, EXPOSURE, CONTRAST, VIGNETTE, BLOOM, FOG, MIST, GRID, GRAIN SIZE/GLOW/DRIFT/CAP, RING and its ROWS/FINE/HIGH/DRIVE, TYPE and its AT/HIGH/DEPTH/LEAN/ACROSS, SLEEVE, TAPER, WIRE, LINE GLOW, DETAIL … |
| the text card (`#textEdit`) | CARD, TYPE, SIZE, TRACK, LEAD, STROKE, LEAN, PAD, RUNGS, DEPTH — shown in the Room panel or its own, by a build flag |

So the Room tab's label is wrong three times out of four: with Stage chosen
it is the Stage tab.

### 3.5 Tab: Sound

The **grain controls, borrowed** from the Grain workspace's Time & Pitch dock:
the engine picker and every stretch and grain control, the cloud pad, the
CLOUD preset row, grain shape and pitch. Identical element; edits here are
edits there.

### 3.6 Tab: Shape (`rgPanel`, `docs/ROOM-PAINT.md`)

The room's own geometry, as against the camera: FLOOR (bands), TRAIL
(history), RIDGE, SPAN, GRAIN (body), WIDTH, REACH. Seven sliders. Only the
Room module reads them.

### 3.7 Tab: Colour (`rpPanel`, `docs/ROOM-PAINT.md`)

The room's paint: a scheme name and list (save, load, delete); the
generators (a row of buttons that make a scheme); then one slot per painted
thing — Ground, Terrain surface, Terrain ridges, Edge band, Ring, Solid,
Skin, Grain bloom, Grain wires, Grain core, Grain fill, Mist, Fog, Data
block, Background — each a mode (inherit, flat, ramp), a colour or a ramp
with stops, what the ramp is read against (Level, Depth, Distance, Height,
Random, Own), and the range and curve. Only the Room module reads them; the
other three modules carry their own colour rows inside their panels.

This is a second colour system beside **Theme** (the app's palette, in the
left panel). Theme colours the interface and the waveform; Colour paints the
room. The Stage module has a third, its own light and look rows.

### 3.8 Tab: 4D (`panel-4d.js`, `docs/SHAPES-4D.md`)

A preview canvas and an attribute manager for the four-dimensional solids:
the shape (a list), the six planes' angles (scrub fields), the projection
mode and which plane spins (rows of fixed places, the latter with Still),
and the eye and the rate (knobs). It is a study of the solid on its own, black background,
no sound. The solid the Room draws is chosen on the Room tab's SOLID row,
separately.

### 3.9 The foot

The transport bar, moved; the Video (export) button, moved; the visuals-menu
gear, moved.

### 3.10 The master bus, in the other workspace

In the Grain workspace the same room is drawn small in the Time & Pitch
dock's right-hand tray, with the VU, the readouts, the resolution buttons and
the edit-the-room button. Pressing that button opens the **same** `#roomEdit`
overlay *on top of the small picture*, laid out in wrapping columns, with the
camera rows hidden. Window › "Master bus full screen" blows the small one up
without going to the Visual workspace. Window › "Edit the room" opens the
overlay.

So the room is reachable four ways: the Visual rail button, the edit button on
the master bus, and two Window menu items — and it edits the same state each
way, but with a different panel layout each way.

---

## 4. Where the same thing is in more than one place

| thing | places |
|---|---|
| the room picture | Visual stage · master bus cell in the Grain dock · Master bus full screen · the film |
| the room's controls (`#roomEdit`) | Visual › Room tab · overlay over the master bus (wrapped columns, no camera rows) |
| the grain controls | Grain › Time & Pitch · Visual › Sound |
| the transport | transport bar · room foot · Audio menu · PLAY PERF in Automation |
| the visualiser choice | VIEW on the stage bar · the visuals menu (gear) · the grain-view tabs (for the grain views) |
| the visuals gear | edit toolbar · room foot |
| film shape | FRAME on the stage bar · FRAME row in the Room overlay |
| presets | engine presets bar (Grain) · CLOUD section presets (grain rows) · LOOK section presets (Visual) · paint schemes (Colour tab) · themes (Theme pane) · the sequencer's own |
| colour | Theme pane (app) · Colour tab (room) · Stage panel's light and look rows · Ridgeline / Surfaces colour rows |
| the solid's shape | Room tab SOLID row · 4D tab shape picker (a separate choice) |
| spectrum and meters | Visuals dock tab · master bus VU and readouts · the room's Data layer |
| recording | Record pane (input takes) · transport Record (capture what is playing) · REC PERF (automation) |
| export | Export button · Video button · File › Export · the export dialog's Export video |

---

## 5. Names that do not agree

| the same idea | called |
|---|---|
| the Visual workspace | Visual (rail) · Room (mode key `room`, the module, the tab) · the room view · the master bus |
| the ground grid | Ground (layer) · grid (key) · Ground (paint slot) |
| the ring | Ring (layer) · sky (key) · Skin (the ring's trail, layer) · skin (key) |
| the terrain | Terrain (layer) · floor (key) · Terrain surface / ridges (paint) · FLOOR (Shape row) |
| the data block | Data (layer) · BLOCK (row) · STREAMS (row) · Data block (paint) · grain telemetry |
| a section preset | LOOK (Visual) · CLOUD (grain) · preset (engine) · scheme (paint) · palette / theme (Theme) |
| the visualiser modules | VIEW (stage bar) · visuals (the gear) · Visuals (a dock tab that is spectrogram and meters, not these) |
| the grain views | Grains (Window menu) · grain views · Swarm 2D … (vis tabs) · arrangements (Stage's copies of them) |

---

## 6. Depth: how many steps to a control

| control | steps |
|---|---|
| the ring's size | Visual › Room tab › RING (2) — or Grain › master bus › edit › RING (3) |
| the solid's shape | Visual › Room tab › scroll past the camera › SOLID (2, with a scroll) |
| the terrain's colour | Visual › Colour tab › Terrain surface › mode › colour (4) |
| the Stage's key light | Visual › VIEW Stage › (Room tab now shows Stage) › scroll to KEY (3, with a long scroll) |
| the camera | on the picture (1) · Room tab channel box (2) |
| a grain view's controls | Grain › Time & Pitch › pop-out window (3) · Window › Grains (2) |
| the sequencer | Seq (1) — and then its own interface |
| the film's shape | Visual › stage bar › FRAME (2) |

The Visual section is two levels deep at best and its longest column is
sixty rows. The subject of a row is only known by reading its tag.

---

## 7. Options for the redesign

Not decisions. Each is a different answer to "what is the unit of
navigation?"

**A. By object.** The picture is a scene of things — camera, ground, terrain,
ring, solid, grains, air, data, type — and picking a thing shows its channels,
as the picked point does now. The Room tab dissolves into per-object panels;
Colour and Shape fold into the object they belong to (the terrain's colour is
on the terrain). Modules become scenes with different things in them. Closest
to Maya's outliner and channel box. Fits the direction the camera and gizmo
have already taken.

**B. By module.** Each visualiser is its own workspace with its own panel and
its own presets, and the rail (or a tab strip under the rail) lists them:
Room, Ridgeline, Surfaces, Stage, Grains. Nothing is shared but the transport.
Simplest to build from what exists; keeps the sixty-row Stage panel as it is.

**C. One arrangement.** The user's stated end state ("ultimately this will all
be in one arrange interface"): a timeline across the bottom with the sound,
the automation lanes, the sequencer and the film's cuts, and the picture above
it. The Visual section becomes the viewport of an arrangement, the Grain
section its instrument panel, Seq a track. The panels in §3 become inspectors
for whatever is selected in the arrangement. Largest change; makes the
sequencer, the performance and the film one thing.

Whichever is chosen, four things are worth fixing in any of them:

1. The rail should only hold workspaces. Theme and Record are panes.
2. One name per thing (§5), used in the layer list, the paint slot, the row
   tag and the key.
3. One home for the room's controls, laid out once, with the master bus
   opening *that* rather than a re-wrapped copy.
4. Presets of one kind, scoped: a look, a cloud, an engine, a scheme are all
   "a saved section", and could be one picker with a scope.

---

## Appendix — element map

| region | ids |
|---|---|
| frame | `menuBar` `settingsOpen` `leftRail` `leftPanel` `rightPanel` `rightRail` `transportBar` |
| left panes | `paneBrowse` `paneSearch` `paneRecord` `paneScan` `paneTheme` `paneImport` |
| Grain | `editTools` `overview` `lane` `regions` `presetBar` `dock` (`dockStretch` `dockEffects` `dockVisuals` `dockAutomation` `dockRegions`) `grainVis` `visPick` `masterBus` |
| Visual | `roomView` `roomAdmin` (`roomAdminBody` `roomSoundBody` `roomGeomBody` `roomPaintBody` `room4dBody`) `roomStage` `roomStageBar` (`rgModules` `visualPresetRow` `reFrameRow`) `roomStageRoom` `roomFoot` |
| the picture | `visGl` `visRidge` `visRoom3d` `visStage` `roomHandles` `roomData` `roomEditOpen` `mbRes` |
| module panels | `roomEdit` `ridgeEdit` `room3dEdit` `stageEdit` `textEdit` |
| Seq | `seqView` `seqFrame` |
| overlays | `visWindow` `keyboardModal` `presetManager` `exportLoop` `pickerModal` `askModal` `settingsModal` `visMenuAdmin` `toast` |

Related: `docs/RAIL.md`, `docs/MENUS.md`, `docs/ROOM-VIEW.md`,
`docs/ROOM-EDITOR.md`, `docs/ROOM-PAINT.md`, `docs/VISUALISER.md`,
`docs/STAGE.md`, `docs/RIDGELINE.md`, `docs/ROOM-3D.md`,
`docs/SECTION-PRESETS.md`, `docs/OPEN-WORLD.md`, `docs/SEQUENCER.md`.
