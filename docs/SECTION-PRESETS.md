# Presets for one section at a time

*6 September 2026.*

The preset on the preset row is the document's. It holds every engine's
settings at once, lives on the server in `PRESETS.json`, and can bring back the
sound it was made on. That is the right thing for "the whole of what I was
doing", and the wrong thing for "that room I had", because the room is not in
it at all, and for "that cloud", because a cloud recalled through it drags five
other engines along.

So there are two more, each for one section and nothing else:

| | Where | What it holds | What it never touches |
|---|---|---|---|
| **A look** | The stage bar of the Room view, beside VIEW | Everything the room is | The sound |
| **A cloud** | Over the grain controls, in the dock's Time & Pitch and the Room view's Sound tab | The grain section | The sound, the seed, the rest of the engine |

Each is one line: a picker, **Save as…**, **Delete**. Pick one to put it back.
There is no manager; the thing to look at is the room, or the cloud, and it is
already on screen.

## A look

Everything `roomEdit` keeps, as one object:

- **the room's own settings** — chunking, opacity, the ring's size, drive, edge
  and resolution, the leading band, fog, mist, grain fill, the cloud's density
  and brightness, the room's shape (`geom*`), and the solid: which one, its
  spin, swell, eye, size and its whole path;
- **the layers** — every on/off, the hierarchy's order, every occlusion switch;
- **the data block's columns**;
- **the cameras**, one per frame;
- **the palette** — the scheme by value, not by name, so a look survives the
  scheme it was made with being deleted or repainted;
- **which module is on the stage**, and each module's own settings (`ridge`,
  `room3d`, `stage`, `text`) — so a look made on the ridgeline puts the
  ridgeline back.

It is read back through the same `readRoomData` that reads what the browser
kept, which is what makes a look as safe as a reload: every number is clamped
to the range the renderer draws, a shape the catalogue no longer offers falls
back, and a look written before a control existed leaves that control where it
is.

The theme is not in it. The theme is the program's, not the room's; it has its
own panel and its own palettes, and a look that changed the colour of the
menus would be a look that reached outside the room.

### Putting it back

`applyVisual` sets the state, writes every store the room reads at load
(`roomData`, `roomLayers`, `roomHierarchy`, `roomStreams`, `roomCamerasWorld`,
the palette), and then walks the same list `enterRoomView` walks so every control
catches up: the module is re-selected, the layer stack is rebuilt in the new
order, every slider is pushed (`syncRoomSliders` — they are built once and
never re-read `roomEdit` on their own), the two module renderers that hold a
copy of their settings are handed the new ones, and every panel is repainted.

## A cloud

The grain section: every key in `GRAIN_DEFAULTS` — rate, density, layers,
overlap, the jitters, position, scan, reverse, wrap, envelope, size range, the
layer spread and scatter, pan spread.

**Not the seed.** The seed has no control of its own and stays with the
document; a preset that carried one would replay the same accident into every
sound it was recalled on, which is the opposite of what a seed is for.

**Not the window.** Size jitter is read against Window, and Window is the
engine's — it is in the Time & pitch group and every engine answers to it. A
cloud that set it would be reaching into the stretch. If the window matters to
a cloud, the document preset is the one that holds both.

A cloud is put back through `editOp`, like a slider, so it lands on the undo
stack and the server clamps it where it clamps everything else. A stored value
of the wrong kind — a string where a number goes — is left at its default
rather than sent. The panel is rebuilt afterwards the way Reset rebuilds it,
because it is built once per file and engine and would not otherwise notice.

## Where they are kept

In the browser, beside the rest of the room's state, under
`audiolab.presets.visual.v1` and `audiolab.presets.grain.v1`. The room's
layers, cameras, palette and schemes have always lived there, and a look kept
on the server while the room it describes lived in the browser would be two
places for one thing. The cost is the same one the palette's schemes already
pay: a look does not follow you to another machine. If that turns out to
matter, the store is one object with five functions and can be pointed at the
server without the interface knowing.

`ui/section-presets.js` is pure — no DOM, no network, storage passed in — in
the manner of `settings.js`. It keeps named copies of whatever it is handed
and hands them back as copies. What a preset *contains* is `app.js`'s
business (`visualSnapshot`, `applyVisual`, `grainSnapshot`, `applyGrain`).
Anything unreadable in storage is dropped on the way in, so nothing past that
line has to ask, and unreadable storage is an empty list rather than a throw.

## Random

There is one randomiser, and it is for the sound. **Random** on the preset row
throws every control in the stretch tray somewhere at random — the standard
and extended groups, the grain section included — and reports its seed so a
good accident can be found again. It drives the real controls rather than a
table of ranges, so it can only produce what the tray allows. The engine
picker is left alone. `docs/GLITCH-SWEEP.md` is what it was built for.

The room has no randomiser. The nearest thing is the Colour tab's generators
(Monochrome, RGB, Spectrum, Vibrant, Muted, Black & white), each of which
paints every object at once and gives a different answer every click. Nothing
rolls the layers, the hierarchy, the solid or the room's shape.

## One refactor first

The room's stored settings were read in a bare `try` block at load and
written by hand in `saveRoomData`. The reader is now `readRoomData(v)` and
the writer `roomDataSnapshot()`; the load block and `saveRoomData` call them.
A look is a `roomDataSnapshot()` read back by `readRoomData`, so there is one
list of what the room keeps, and adding a control to the room adds it to a
look without a second table to forget.

## Where it lives

- `ui/section-presets.js` — the store.
- `ui/app.js` — `readRoomData`, `roomDataSnapshot`, and the section-preset
  block after `rpRestore()`: `visualSnapshot`, `applyVisual`,
  `refreshVisualPanels`, `syncRoomSliders`, `grainSnapshot`, `applyGrain`, the
  two pickers.
- `ui/index.html` — `#visualPresetRow` on the stage bar; `#grainPresetRow`
  over `#grainShape`.
- `ui/app.css` — `.sp-row`, `.grain-preset-row`.
- `core/crates/server/src/routes.rs` — `SECTION_PRESETS_JS`, its route, and
  its place in `ui_build_id`.
- `tests/ui/section-presets.spec.mjs` — the store against a plain map; a look
  put back reaching the room, its storage, its sliders and its layer stack; a
  cloud put back reaching the document with the seed and the ratio untouched.

Embedded with `include_str!`. **Rebuild the binary after editing any of
them** or the browser is served the old file.
