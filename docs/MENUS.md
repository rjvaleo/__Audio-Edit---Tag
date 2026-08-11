# The menus

Four menus across the top — **File**, **Edit**, **Audio**, **View** — plus a
right-click anywhere on the waveform, the overview or the region strip, which
opens the Edit menu at the pointer.

A menu item never reimplements a command. It presses the same control the
toolbar does, so there is one implementation of each operation and the two
cannot drift apart.

**Greyed out beats hidden.** An item that cannot run right now is dimmed rather
than removed: a command that vanishes teaches you nothing, one that is dimmed
tells you what you are missing. Each entry below says what it needs.

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

## Audio

| Item | Shortcut | Needs | What it does |
|---|---|---|---|
| Play / pause | `␣` | a file | Starts or pauses the engine. |
| Stop | | a file | Stops and returns to the cue. |
| Loop | | a file | Loops the selection, or the whole document if there is none. |
| Capture what is playing | | an open document | Arms the recorder. What comes out of the channel is captured until playback stops, then written as a new file beside the original, named for the file, the module that processed it and the time. It never overwrites. |
| Reset time, pitch and grains | | an open document | Puts every stretch control back — both the standard and the extended side — while staying on the engine you are working in. Leaves the grain seed alone. |

## View

| Item | Shows | What it does |
|---|---|---|
| Browse | | Switches to the library. |
| Edit | | Switches to the editor. |
| **Play all files** | ✓ when on | Whether the browser lists files with no audio header — peak caches, sidecars, raw dumps. Off by default. The folder counts follow it. |
| Zoom in | `+` | Halves the visible window. |
| Zoom out | `−` | Doubles it. |
| Fit | | The whole file. |
| **Follow playhead** | ✓ when on | Whether the lane keeps the playhead on screen while playing. |
| Follow by scrolling | ✓ when chosen | The playhead is pinned to the middle and the file slides past it. |
| Follow by paging | ✓ when chosen | The playhead runs across, and the view turns the page when it reaches the edge. |
| Grain views in a panel | | Opens the visualiser as a movable, resizable pop-over over the app. |

The three items that show a ✓ are settings rather than commands — the check
mark in the shortcut column is their current state, read at the moment the menu
opens. The two follow-mode items dim when Follow playhead is off.

---

## What is not in a menu

Some things are only where they act, deliberately:

- **The engine picker** (WSOLA / Vocoder / Granular) and every stretch control
  — Time & Pitch tab.
- **The effect chain and the channel maximiser** — FX tab.
- **Reset** for the extended controls only — on the first heading of the
  Extended column, distinct from Audio → Reset time, pitch and grains, which
  resets both sides.
- **Document presets** — the row under the transport.
- **Visualiser presets** — the sixteen slots on the picture itself.
