# The menus

Seven menus across the top — **File**, **Edit**, **Action**, **DSP**, **Audio**,
**Window**, **View** — plus a right-click anywhere on the waveform, the overview
or the region strip, which opens the Edit menu at the pointer.

Action and DSP are named after Peak's own, because that is where the commands
came from and where anyone who has used Peak will look for them.

A menu item never reimplements a command. It presses the same control the
toolbar does, so there is one implementation of each operation and the two
cannot drift apart.

**Greyed out beats hidden.** An item that cannot run right now is dimmed rather
than removed: a command that vanishes teaches you nothing, one that is dimmed
tells you what you are missing. Each entry below says what it needs.

**A menu holds commands, not settings.** Twenty-one of these seventy-eight rows
used to be neither — seven buffer sizes and five grain-detail levels in Audio,
four follow-and-listing switches in View. They are in **⚙ Settings** at the
right of the bar now, and the menus are back to sixty-two rows of things you
can do. The one exception is snap, which stays in Action *as well*: every edit
command reads it, which is also why the toolbar carries it.

Dimming and settings answer different questions, and both are right. A dimmed
item is unavailable *right now* and its dimness is the explanation. A setting
is a standing preference, and its home is the panel.

---

## File

| Item | Shortcut | Needs | What it does |
|---|---|---|---|
| Choose library… | | | Points the app at a different folder of audio. Remembered between runs. |
| Re-scan library | `⇧⌘R` | | Re-reads the library from disk. For sounds added from outside the app. |
| Open in editor | `⏎` | a selected file | Opens the selected sound as its own document tab. |
| Close document | `⌘W` | an open document | Closes the current tab. Its edits stay in the session. |
| Export… | `⌘E` | an open document | Renders the document — edits, effects, stretch, channel — to a **new** file. The only thing in the app that writes audio. |
| Save tags | `⌘S` | | Commits the tag panel to the sidecar store. |

## Edit

Also the right-click menu. Its heading says *Selection* or *No selection*, so
the state the items depend on is visible before you read them.

| Item | Shortcut | Needs | What it does |
|---|---|---|---|
| Undo | `⌘Z` | something to undo | Steps back one edit. |
| Redo | `⇧⌘Z` | something to redo | Steps forward again. |
| Cut | `⌘X` | a selection | Removes the range and closes the gap. |
| Crop | `` ⌘` `` | a selection | Removes everything *except* the range. |
| Duplicate… | | a selection | Lays down more copies of the range straight after it, pushing the rest along. One bar of drums into four. |
| Insert silence… | | a file | Makes the document longer at the insertion point. Not the same as Silence, which overwrites. |
| Silence | | a selection | Keeps the length, zeroes the range. |
| Fade in | | a selection | Fades up across the range, in the shape the toolbar's fade selector says. |
| Fade out | | a selection | Fades down across the range. |
| Reverse | | a selection | Reverses the range in place. |
| Add marker | `M` | a file | Drops a marker at the playhead. |
| Add region | `R` | a selection | Names the range and adds it to the region strip and list. |
| Select all | `⌘A` | a file | Selects the whole document. |
| Deselect | `⎋` | a selection | Clears it. |
| Revert document | | an open document | Throws away every edit and returns to the file as it is on disk. |

Edits address the **pre-stretch** timeline. Cutting a second removes a second
of source, whatever the stretch ratio is doing to the output length.

Every edit that has an edge — cut, crop, silence, the fades, reverse, duplicate,
insert silence — is placed by the **snap** setting in the Action menu, and says
so afterwards if it had to move the edge to get there.

## Action

Selection, zoom, snap, markers and regions. Nothing here changes audio.

| Item | Shortcut | Needs | What it does |
|---|---|---|---|
| Set selection… | | a file | Types the selection in, in seconds, milliseconds or samples, instead of dragging it. |
| Select all | `⌘A` | a file | The whole document. |
| Fit selection | `⇧⌘]` | a selection | Zooms so the selection fills the lane. |
| Zoom at sample level | `⇧←` | a file | As far in as the display goes, on the start of the selection or the cue. |
| Zoom at sample level (end) | `⇧→` | a selection | The same, on the *end* of the selection — for checking the far edge of a loop. |
| Zoom out all the way | | a file | The whole file. |
| **Snap to zero crossings** | ✓ when on | | Where edits land. On by default, as Peak's Auto Snap is. |
| **Snap to CD frames** | ✓ when on | | Multiples of 588 samples, for regions destined for a Red Book CD. |
| **Snap off** | ✓ when on | | Edits land exactly where the pointer was. |
| New marker | `M` | a file | Drops a marker at the playhead. |
| New region | `R` | a selection | Names the range. |
| New region split | | a file | Splits the region under the cursor in two, or the document if there is no region. |
| Markers to regions | | a file | Turns the markers in the selection into the regions between them. Three markers make two regions, named after the first two. |
| Nudge markers… | | a file | Moves every marker and region in the selection by a number of seconds, positive or negative. |
| Rename… | | a file | Renames a run of them. `#` counts up from a start value; zeros after it set the width, so `Event #000` from 10 gives `Event 010`, `Event 011`. Numbered in timeline order. |
| Delete markers in selection | | a selection | The audio stays; the notes about it go. |
| Go to… | `⌘G` | a file | Jumps to a marker, a region, either end of the selection, or a time you type. |

The toolbar carries the snap setting too, as a single picker, because it is
read by every command and is worth being able to see without opening a menu.

## DSP

| Item | Needs | What it does |
|---|---|---|
| Normalize… | a file | Scales the whole document so its loudest sample lands on the level you give. |
| Normalize (RMS)… | a file | Sets the *average* level instead. Where the ceiling gets in the way the ceiling wins and the result comes out quieter — nothing is distorted to reach a number. |
| Find peak | a file | Puts the cue on the loudest sample in the selection, or the file, and says how loud it is. Changes nothing, so it makes no undo entry. |
| Fade in / Fade out / Reverse | a selection | The same commands as the Edit menu and the toolbar. |
| Strip silence… | a file | Finds runs quieter than a threshold and either removes them or flattens them. Level is judged over a short window, so a loud waveform passing through zero is not mistaken for silence. |
| Repair click… | a selection | Takes out the worst discontinuity in the selection and ramps the join. Peak redraws the damaged samples; a clip list cannot write one, so this removes them — a fraction of a millisecond, and inaudible. |

The **live shapers** — invert, swap, width, DC offset, ring modulate, rappify,
reverse boomerang, amplitude fit, gate — are not here. They are rack effects
that run under your fingers while the sound plays, in the FX tab, rather than
things you apply and wait for. The menu says so rather than offering a second
way to run them.

## Audio

| Item | Shortcut | Needs | What it does |
|---|---|---|---|
| Play / pause | `␣` | a file | Starts or pauses the engine. |
| Stop | | a file | Stops and returns to the cue. |
| Loop | | a file | Loops the selection, or the whole document if there is none. |
| Capture what is playing | | an open document | Arms the recorder. What comes out of the channel is captured until playback stops, then written as a new file beside the original, named for the file, the module that processed it and the time. It never overwrites. |
| Reset time, pitch and grains | | an open document | Puts every stretch control back — both the standard and the extended side — while staying on the engine you are working in. Leaves the grain seed alone. |

The **audio buffer** and the **grain detail** were twelve rows here, which made
a menu about playing a sound seventy per cent configuration. Both are in ⚙
Settings, under *What things cost* — where the sentence explaining what each one
trades fits beside it.

## Window

The panels that are not part of the editor's own layout. Both are floating, both
are closed by default, and **Escape closes the front one**.

| Item | Shortcut | Needs | What it does |
|---|---|---|---|
| Grains | | an open document | Opens the grain views — the 2D swarm and both 3D suites, with the picker and the legend. They used to take half the stretch tray and redraw beside the controls whether or not anyone was looking; as a window they cost nothing until opened. The panel holds the *same* elements, moved, not copies. |
| Keys | | an open document | The note keyboard. Plays the pitch from the computer keyboard, bound to whatever tuning is selected. |

## View

| Item | Shows | What it does |
|---|---|---|
| Browse | | Switches to the library. |
| Edit | | Switches to the editor. |
| Zoom in | `+` | Halves the visible window. |
| Zoom out | `−` | Doubles it. |
| Fit | | The whole file. |
| Grain views in a panel | | Opens the visualiser as a movable, resizable pop-over over the app. |

**Play all files** and the three **follow** rows were here. They are settings —
how you like to watch, and what the library lists — and they are in ⚙ Settings
now. Neither survived a reload while it lived in this menu, which is most of the
argument: a preference that forgets itself every session is not a preference.

This menu still lists two of the rail's three modes. Room is missing from it,
and that is a defect rather than a decision.

---

## ⚙ Settings

At the right of the menu bar, and a modal rather than a rail row: settings decide
what the rail and the menus contain, so a control that can switch itself off from
under you is a trap — and a modal leaves the thing you are configuring on screen
behind it.

Everything in it is kept **in this browser**, said on the panel rather than
implied. It is built entirely from `SETTINGS_PANEL` in `app.js`, so adding a row
to that table is the whole job of adding a setting; there is no second list.

| Group | Rows |
|---|---|
| How edits land | Snap — also in Action, and on the toolbar |
| What the library lists | Files with no audio header |
| Watching it play | Keep the playhead on screen; and do it by scrolling or paging |
| What things cost | Audio buffer, grain detail, analyser resolution |

Every row carries the sentence saying what it trades, because every one of these
is a trade and the reasoning used to live only in a source comment. A row whose
effect is deferred says when it lands — a switch that appears to do nothing is
indistinguishable from a broken one.

Two of them are not per-browser at all: the buffer and the grain cap live on the
server, because the engine owns them. Where a setting is *kept* is an
implementation detail; where it is *found* should not be.

## What is not in a menu

Some things are only where they act, deliberately:

- **The engine picker** (WSOLA / Vocoder / PVSOLA / Hybrid / Granular) and every stretch control
  — Time & Pitch tab.
- **The effect chain and the channel maximiser** — FX tab.
- **Reset** for the extended controls only — on the first heading of the
  Extended column, distinct from Audio → Reset time, pitch and grains, which
  resets both sides.
- **Document presets** — the row under the transport.
- **Visualiser presets** — the sixteen slots on the picture itself.
