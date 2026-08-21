# Every control in the interface

Mouse, keyboard and gesture, in one place. Menu items are in
[MENUS.md](MENUS.md); this page is everything you can do by pointing at
something.

Two workspaces: **Browse** (the library) and **Edit** (one open document).
`Enter` swaps between them. Almost everything below only exists in Edit.

---

## The waveform lane

The big view in the middle of Edit. One gesture does several jobs depending on
how you use it.

| Gesture | What it does |
|---|---|
| **Click** | Puts the cue there and moves the playhead to it. Clears any selection. |
| **Drag** | Selects a range. The cue follows the start, so the selection is ready to loop. A drag of a pixel or two is treated as a click, not a one-sample selection. |
| **⌥ Alt-drag** | **Scrubs** — drags the playhead across the file so you hear where you are, without touching the selection you already made. |
| **⌥ Alt held mid-drag** | Switches an in-progress selection drag to scrubbing. |
| **Right-click / Ctrl-click** | Opens the **Edit** menu at the pointer, headed *Selection* or *No selection* so you can see which operations will be available. |
| **Release after a drag** | If Loop is on, playback jumps to the start of the new selection rather than staying where the drag ended. |

**The grain centre grip.** When a grain schedule is on screen, a short tab sits
at the left edge of the lane on the line the grain marks are struck from. Drag
it up or down and the marks and the sparks follow; **double-click puts it back**.
"Back" is the waveform's centre, derived from where the spectrogram divider sits
— not a fixed halfway. It used to be `h * 0.5` of the whole lane, which with the
spectrogram splitting that lane put the marks 61 px below the sound they
describe. Where you put it is remembered.

It is a short tab rather than a full-width band on purpose: the rest of that
line has to stay available for selecting. It also swallows `mousedown`, because
the lane starts selections on that event and stopping `pointerdown` does not
stop it — without the guard, dragging the grip also swept a selection.

The lane is sample accurate when zoomed in far enough. Past the point where
there are more pixels than samples it stops drawing a min/max envelope and
draws the samples themselves — stems, dots and a faint joining line — and the
zoom readout changes to `n smp` to tell you that is what you are looking at.

## The overview strip

The whole file, above the lane, with the zoomed window marked on it.

| Gesture | What it does |
|---|---|
| **Click** | Moves the zoomed window so it is centred there. |
| **Drag** | Pans the zoomed window continuously. |
| **Right-click** | The Edit menu, same as the lane. |

## The ruler and region strip

| Gesture | What it does |
|---|---|
| **Click a region** | Selects that range in the lane. |
| **Right-click** | The Edit menu. |
| **Remove** (region list, Regions tab) | Deletes that region. |

The region strip collapses to nothing when there are no regions, rather than
holding a row of the window open to say so.

---

## The library browser

**Auditioning plays the sound itself** — no edits, no stretch, no grain cloud,
no effects, whatever has been done to that file elsewhere. Clicking a file here
is a question about the file, and a one-shot playing back thirty-six times
longer than it is because of something set last week does not answer it. The
editor is where the document plays in full. Crossing between the two while
something is playing stops it, because what is running belongs to the side it
was started on.

**A sound opens at its defaults**, every time. Settings are not carried over
from a previous run; presets are the deliberate way to put them back.


| Gesture | What it does |
|---|---|
| **Click a folder** | Expands or collapses it. |
| **Drag a folder** | Reorders the library. The order is saved. |
| **Click a file** | In Browse, selects it. In Edit, opens it as its own tab. |
| **Double-click a file** | Opens it in the editor. |
| **Click the ▶ on a row** | Auditions that file without changing what is selected. |
| **Hover a row** | The tooltip gives what was heard in it and the confidence reason. |

**Play all files** — the checkbox at the top of the browser, mirrored in the
View menu. Off, only files that announced themselves as audio are listed; on,
everything the scan found. A folder hiding some says how many at the end of its
list, and the folder count follows the switch.

---

## Sliders, knobs and switches

**Every control in the stretch tray says what it does.** Hover the name, the
slider or the reading and the same explanation appears; hover the space around
a group and you get the group's. Half of these were constants inside an
algorithm until recently, and a slider whose name is the only thing telling you
what it does is a slider you turn at random. The engine picker, the segmented
choices and the switches carry their own words per option, which are more
specific than the row's and win where the two overlap.


Four kinds of control, one contract. Every one of them can be pushed back to a
value by Reset or Undo without knowing which kind it is.

### Sliders — the stretch tray

| Gesture | What it does |
|---|---|
| **Drag** | Changes the value, previewing continuously as you move rather than on release. |
| **Release** | Commits at full quality and re-points the audio. |
| **Stroke across several** | Press *outside* any control, drag across a column of them, release. Each bar takes the value at the point the line crossed it. Both axes are tested, so a stroke down one column does not set the panel next to it. |

### Knobs — the effect rack

| Gesture | What it does |
|---|---|
| **Drag up / down** | Turns it. A full turn is 160 pixels. |
| **⇧ Shift-drag** | Fine, at a fifth the rate. |
| **Wheel** | Nudges it, and commits immediately. |

### Switches — rockers

Click to throw. The name sits to the left, right-aligned against it. One end is
pressed in and the other proud; the recess it uncovers is dull red at rest and
green with a glow when thrown.

### Three-way choices

A row of buttons — click the one you want. *Pick* (best / worst / loud) and
*Window* (hann / tri / rect) in the WSOLA extended group.

### The engine picker

Five buttons on the top row of the Time & Pitch panel. Which one is chosen
decides what the standard column below it and the Extended column beside it
contain, because the five mean different things by every setting they share.

| Engine | Standard | Extended groups |
|---|---|---|
| **WSOLA** | preserve transients, detector | Splice, Transients |
| **Vocoder** | analysis window, phase lock | Spectrum, Phase |
| **PVSOLA** | re-anchor, analysis window, phase lock | Anchor, Spectrum, Phase |
| **Hybrid** | tone, hits, air, remake noise, analysis window, phase lock, detector | Separation, Spectrum, Phase, Splice, Transients |
| **Granular** | *(the grain panels below)* | *(the grain extended groups)* |

| Group | Holds |
|---|---|
| **Splice** | search, pick, window, stride |
| **Transients** | floor, guard |
| **Spectrum** | freeze, blur, gate |
| **Phase** | freq trust, phase spread, peak width, lock width, link stereo |
| **Anchor** | search, blend |
| **Separation** | hold, spread, margin, resolution |

**The last two engines run the first three, so they show the first three's
controls too.** These are the same settings reached from a second place, not
copies of them: in the hybrid, *Spectrum* and *Phase* shape the tone, because
that is the part the vocoder is given, and *Splice* and *Transients* shape the
hits. The hybrid holds transient preservation on and so has no switch for it —
an attack surviving at its own rate is the reason that part was separated out.

PVSOLA shows the vocoder's groups and deliberately **not** WSOLA's: it finds
its splice with its own search, so WSOLA's would be decoration. There is a test
asserting both halves of that — that everything shown reaches the audio, and
that what is not shown does not.

Grain shape, pitch movement, scan, shape and randomness reach **all five** —
every one of them lays something down repeatedly, so every one has a rate, a
length, a place it reads from and a speed it reads at.

*Reset all*, right-aligned on the engine row, puts every control back, standard
and extended, and leaves you on the engine you are on. *Reset* at the head of
the Extended column puts back only what is in that column.

---

## The preset manager

**Manage…** on the preset row, or the `×` on the picker beside it. A preset
holds *every* engine's settings, not only the engine that was selected when it
was saved, so most of what is in one cannot be seen from the panels at all —
this is the only place the whole of it shows.

| Gesture | What it does |
|---|---|
| **Click a preset** | Selects it. Asks first if the one you are on has unsaved edits. |
| **Type in any value** | Edits the draft. Changed boxes turn amber and the footer says so; nothing is written until you save. |
| **Save changes** | Writes it, then shows back what the server actually stored — so a value pulled into range says so instead of waiting until the next reload. |
| **Revert** | Throws the draft away and reloads the stored values. |
| **Duplicate** | A copy of the *draft*, so you can branch off edits without committing them to the original. |
| **Delete** | Removes the preset. No sound is touched. |
| **Esc**, **Close**, or click outside | Closes, asking first if there are unsaved edits. |

Renaming is just editing the Name box. A rename onto a name already in use is
refused rather than swallowing the other preset.

An empty box means *no value stored* — which a preset written before that
control existed will have. It is left empty rather than shown as zero, because
zero is a real setting and would be a lie about what is in the file.

---

## The grain visualiser

Ten views in two suites, at `/grains3d`, in an in-page pop-over
(**View → Grain views in a panel**), or in their own window (**Window ▸
Grains**).

The window is where they live now. They used to occupy half the stretch tray and
redraw beside the controls whether or not anyone was looking — which cost real
frame time for nothing. Closed by default; the panel holds the *same* canvas,
picker and 3D frame, moved rather than copied, so nothing had to be rewired.

| Gesture | What it does |
|---|---|
| **Drag on the canvas** | Orbits the camera. |
| **Wheel on the canvas** | Zooms toward or away from the playhead. |
| **Click the transport bar** | Seeks. |
| **`1`–`5`** | Switches view within the current suite. |
| **`V`** | Swaps suite — V1 the object, V2 the moment. |
| **`C`** | Close on the playhead, or stand back and see the whole cloud. |
| **`F`** | Fullscreen. |
| **`Space`** | Play / pause. |

Every view keeps its own look and its own camera. At the start of a session
every one opens zoomed in on the playhead; after that each remembers where you
left it.

### The preset slots

One ruled rectangle in the bottom-right of the picture, eight across and two
down. A cell shows `×` if it holds a look; the name is in its tooltip.

| Gesture | What it does |
|---|---|
| **Click** | Recalls that look into whichever view is showing. |
| **Double-click** | Stores the look you are looking at into that slot. |
| **Press and hold** | Erases it. The cell drains as you hold, so you can see what is about to happen and let go. |

Six start filled — Swarm, Trails, Kaleid, Ink, Ember, Still.

### The pop-over

| Gesture | What it does |
|---|---|
| **Drag the title bar** | Moves it. |
| **Drag the corner** | Resizes it; the picture grows and shrinks with the box. |
| **`Esc`** | Closes it. |

---

## Keyboard

Shortcuts are ignored while the cursor is in a text field, so typing a tag
never triggers one.

| Key | What it does |
|---|---|
| `Space` | Play / pause |
| `Enter` | Swap between Browse and Edit |
| `M` | Add a marker at the playhead (Edit only) |
| `Esc` | Closes the front window first — a menu, a dialog, the Keys panel, the Grains window — and only clears the selection and returns the cue when nothing is open |
| `A` … `'` | **The note keyboard**, when Keys is open. The home row is the white notes from C; the row above holds the black ones, which is why a QWERTY keyboard fits a piano at all |
| `Z` / `X` | Down / up an octave. It latches, so repeated presses keep going |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⇧⌘Z` / `Ctrl+Shift+Z` | Redo |
| `` ⌘` `` | Crop to the selection |
| `⌘G` | Go to — a marker, a region, an end of the selection, or a time you type |
| `⇧⌘]` | Fit the selection to the lane |
| `⇧←` / `⇧→` | Zoom to sample level, on the start or the end of the selection |

The menu bar lists more shortcuts against their items — `⌘E` export, `⌘S` save
tags, `⌘W` close document, `⌘A` select all, `⌘X` cut, `R` region, `⇧⌘R`
re-scan. Those are printed in the menus as the reference; the handlers above are
the ones bound globally.

---

## The edit toolbar

Along the top of Edit, above the overview.

| Control | What it does |
|---|---|
| Cut · Crop · Silence · Fade in · Fade out · Reverse | The frequent edits, on the selection. Everything else Peak has is in the Action and DSP menus. |
| Fade curve | `equal power` or `linear`. Equal power for crossfades, linear for de-clicking a splice. |
| **snap** | Where an edit lands: `zero` (the nearest zero crossing), `off`, or a fixed grid — `CD` 588 samples, `PS2` 28, `Xbox` 64. **On by default**, because a cut that does not start and end at the centre line is a click. Kept across sessions: it is a way of working, not a property of a sound. When it has to move an edge to get there, it says so and by how much. |
| Marker · Region | Names the playhead or the selection. |
| Undo · Redo · Revert | Revert throws away every edit and returns to the file as it is on disk. |
| Bit depth · **Export** | Renders to a new **AIFF beside the original**, named `<sound> <engine> <ratio> <pitch> <window>.aiff`, with every setting written into the file. The only thing here that writes audio, and it never writes over anything. |

**With the loop on, Export asks first.** A box with two questions — how many
repeats, and whether to keep the tail — plus *Whole file instead*, which skips
the loop entirely. Enter exports, Escape closes. Loop off opens nothing and
behaves exactly as it always did. The name gains ` loop 4x` or ` loop 4x tail`
so a looped export is never mistaken for a whole-file one.

**While it runs**, a bar appears in its own row under the toolbar — the phase
(*Reading*, *Stretching*, *Effects*, *Tail*, *Writing*), a percentage, and
**Stop**, which discards the part-written file. Its own row so that nothing on
the toolbar moves because an export started. A reload mid-export picks the bar
back up rather than losing it, and a second export while one is running is
refused rather than interleaved.

## The transport row

Under the waveform, in Edit only. Browse has no open document to transport.

| Control | What it does |
|---|---|
| ▶ / ❚❚ | Play / pause — **the sound on screen**, loading it first if the engine is still holding the last one. In the editor this is the whole document: edits, stretch, grains and rack. |
| ■ | Stop, and return to the cue |
| **no audio device** | On a machine with no output, a note appears here and these four controls go out of service. Everything else — browsing, editing, tagging, exporting — still works. See [`NO-AUDIO-DEVICE.md`](NO-AUDIO-DEVICE.md). |
| | *Choosing a different sound, in the library or by switching tabs, stops the transport. It belongs to what is on screen.* |
| ⟲ | Loop — the selection if there is one, otherwise the whole document |
| ● | **Capture** — records what is playing; on stop it saves a new file beside the original, named for the file, the module and the time |
| Clock | Position, to the millisecond |
| − / + / ⤢ | Zoom out, in, fit |
| ⇥ | **Follow playhead** on/off |
| scroll / page | How it follows — scroll pins the playhead centre, page turns when it reaches the edge |
| Volume | Output level |

## The preset row

Directly under the transport: the dock's own tabs (**Time & Pitch**, **FX**,
**Visuals**, **Regions**), a rule, then the document preset controls —
a dropdown, **Save as…** and **Delete**.

## Layers, and the governor

Added 20 Aug 2026.

**The ceiling is sixty-four.** It was sixteen — and sixteen was also written out
by hand in eight other places: two clamps in `fx::grain`, two in `fx::stretch`,
one in each of the server's two persistence paths, and four assertions across
three test files. Raising it meant finding all of them, and missing one would
have been a layer the live engine ran and the offline renderer refused, which is
inaudible until an export comes back different from what was auditioned.

`fx::grain::MAX_LAYERS` is the only place the number is written now, and
`every_path_agrees_on_the_ceiling` asks the two paths the same question rather
than trusting that it was changed everywhere.

### The engine plays what it is asked for

There is a governor in `engine::transport` that sheds layers when audio blocks
miss their deadline. It is **off by default**.

What it looks like from outside is the program quietly overriding a setting:
`load 29% · 5/12 layers`, with no note of when it might give them back — and it
climbs home at four hundred easy blocks per layer, so "when" is the better part
of half a minute. A tool that changes your numbers without being asked is worse
than one that struggles audibly, because the struggle is information and the
silence is not.

On, it does what it always did, and a thinner cloud is genuinely better than
holes in the sound. **Shift-click the load readout** to switch it. That is where
the switch is because that is where the problem appears — the moment you want it
off is the moment you are looking at "5 of 12", and a switch you have to go
looking for is one you do not know exists.

The flag lives on the audio thread's shared state, which is rebuilt whenever a
sound is opened, so the interface re-sends it on every load. Without that it
would lapse on the next file and the layers would start disappearing again with
nothing having been changed.
