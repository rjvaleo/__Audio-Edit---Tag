# The transport, and where recordings go

*A design. Nothing here is built. It settles the open question in
[DATA-DIRECTORY.md](DATA-DIRECTORY.md) and raises a larger one about projects.*

---

## The transport belongs to the program, not to a section

Granular, Edit and Browse each take over the screen. So anything that must
survive a section change cannot live inside a section — it is **chrome**, drawn
above all three and owned by none.

That is a short list, and it is worth naming explicitly because everything else
follows from it:

- **Transport** — play, stop, loop, time
- **The current file** — what is loaded and sounding
- **Master level**

Everything else is a section's business. The dock, the effect rail, the
inspector, the library tree — those come and go with their section.

## Record belongs to Edit

Not to the chrome, and certainly not where it is now — a *drawer panel*
(`paneRecord`) sitting beside Library and Search as though recording were a way
of looking at things.

**Record is part of Edit**, and the reason is the workflow: recording makes new
material and editing shapes it. Record → edit → export is one continuous act,
and putting the recorder anywhere else splits it. Edit becomes the section where
audio *comes into existence and gets worked*, which also gives the new section a
clear identity rather than being "the one for trimming".

The consequence to accept knowingly: arming a take means being in Edit. That is
a mode, and it is the right one — you are about to create material, which is
what Edit is for.

## The keyboard: a live bug, not a tidy-up

There are **six** `keydown` listeners on `document` in [app.js](../ui/app.js) —
five permanent (5499, 6542, 7211, 7499, 8029) and one the ask dialog installs
and removes. They do not coordinate. Nothing stops propagation except one
branch of one of them, so a single keypress runs every handler that matches.

### The faults, concretely

**1. Escape fans out to four handlers at once.** Press Escape with the preset
manager open and 5499 closes it — *and* 6542 runs `state.sel = null; setCue(0)`,
so **your selection is destroyed and the cue jumps to zero.** Same for the
visualiser pop-out. Dismissing a dialog silently discards editing work, which is
the worst thing on this list.

**2. Escape is not scoped to what is open.** Four handlers each decide for
themselves; none of them stops. Escape should close exactly one thing — the
topmost — and stop.

**3. The text-field guard is different in every handler.**

| listener | guards |
|---|---|
| 5499 | nothing |
| 6542 | `INPUT`, `TEXTAREA` |
| 7211 | nothing |
| 7499 | nothing |
| 8029 | `INPUT`, `TEXTAREA`, `SELECT`, and `askModal` |

`SELECT` is guarded in one place and not the other, so with a dropdown focused
spacebar plays, `m` drops a marker and Enter changes section.

**4. Only one handler knows about modals.** 8029 checks `askModal`; 6542 — the
one with spacebar — does not. Playback can be started from behind an open
dialog.

**5. Bare letters, no modifier, no `preventDefault`.** `m` adds a marker and
`Enter` switches section, from anywhere outside a text field. Stray keystrokes
have consequences.

**6. The ask dialog stops propagation on Escape but not on Enter.** Escape is
correctly contained; Enter confirms the dialog *and* falls through to 6542.

**7. The local patch that proves the point.**
[app.js:4922](../ui/app.js:4922) puts a `stopPropagation` on the tree filter
input, because typing a space in it was triggering playback. That is the
symptom being treated one input at a time.

### The fix: one dispatcher, three tiers

```
keydown
  ├─ 1. focus is in a text-entry field?   → hand it back, do nothing
  ├─ 2. a modal or overlay is open?       → its keys only.
  │                                          Escape closes the topmost. Stop.
  └─ 3. otherwise                         → global and section shortcuts
```

With three rules that hold everywhere: **anything handled calls
`preventDefault`; anything consumed stops; bare letters need a modifier or a
section scope.**

That one dispatcher replaces every local patch, and it is what makes spacebar
work identically in Granular, Edit and Browse when they each take over the
screen.

### Two behaviour decisions inside this

- **What should Escape do when nothing is open?** Today it clears the selection
  and zeroes the cue. That is defensible as "deselect" — but it is currently
  also firing when something *is* open, which is fault 1, and the two need
  separating before it can be judged.
- **Should bare `m` keep adding a marker?** It is a fast, useful key and it is
  also an accident waiting to happen. Scoping it to Edit is probably enough.

## Where recordings go

### The three modes

The record destination is a setting with three values:

| mode | resolves to |
|---|---|
| **Last used** | the folder in the library most recently recorded into |
| **Record folder** | a folder designated once, in the library |
| **Project folder** | the current project's folder |

### On arming

```
arm record
  └─ resolve the destination from the current mode
       ├─ resolves to a real folder  →  arm, show the destination
       └─ does not resolve           →  open the folder picker,
                                        remember the choice for that mode,
                                        then arm
```

The important property: **arming never silently guesses.** If the mode cannot
resolve, the picker opens and the user chooses. What it must never do is quietly
put the take somewhere they will not find, which is what the fallback does
today.

### The fallback that exists now, and what becomes of it

[record.rs](../core/crates/server/src/record.rs) currently writes to
`<library>/Recordings/`, hard-coded, or to `data_dir/Recordings` when no library
is set — and its own header defends that choice well:

> refusing to record because nothing has been configured would lose the take,
> which is worse than putting it somewhere findable

That reasoning still holds and the fallback should stay, but it becomes a **last
resort** rather than a routine path, because the picker now catches the
unconfigured case before the take exists. When it does fire, it should say so
rather than returning a quiet boolean nobody surfaces.

## Capture and record are two different things

Stated plainly, and this is the definition to build to:

> **A capture puts the currently playing sound to disk. A recording selects an
> input and saves it to disk.**

The line is which side of the audio device the audio comes from. A recording is
*external* — it needs an input selection, a device, a level, an arm. A capture is
*internal* — it takes what is already sounding, so it needs none of that, and it
already knows where the audio came from.

`record.rs` and `capture.rs` already honour this, and `record.rs` says so in its
header:

> A capture keeps what came *out* of the engine and belongs beside the file it
> came from. A recording has no original — it is the first time this audio has
> existed anywhere — so it goes into a folder of its own.

**So the three-mode destination setting applies to recordings only.** A capture
goes beside its source, because it *has* a source and that is the most useful
place for it. One setting covering both would lose a distinction the code
already gets right.

It also explains the interface asymmetry: the recorder needs a device picker,
an arm and input metering; capture needs a button.

## What this settles for the data directory

Cleanly: **`exports/` and `Captures/` never live in the app data directory.**
App data holds app state — config, index, fingerprints, labels, tags, sessions,
presets, automation, markers, folder order — and nothing the user would go
looking for in a file browser. User-created audio goes to a library folder, a
record folder, or a project folder, all of which the user chose.

The `data_dir` paths in `record.rs` and `capture.rs` survive only as the
last-resort fallback described above.

## The larger thing hiding in here: what is a project?

**There is no project in this program today.** There are sessions
(`SESSIONS.json`) — saved edit state keyed to a file — but no project, and no
project folder. "The project folder, which you can also set" introduces a
concept that does not exist yet.

That is a bigger addition than the setting makes it look, and it deserves its
own conversation rather than being decided as a side effect of a record
destination. The questions it opens:

- Is a project a **folder on disk**, or a **document** that points at one?
- What lives in it — exports, captures, the session, the rack, presets?
- Is there one project open at a time, and does opening one change the library?
- Does the plugin have a project, or does the host's session take that role?
  (In a DAW, the host already owns "the project", and competing with it is how
  plugins become annoying.)

*Recommendation:* build the three-mode setting with **Last used** and **Record
folder** working, and **Project folder** present but inert until the project
concept is designed. That is honest about what exists — the same discipline as
the "Not built yet" labelling elsewhere — and it does not block the transport
work on a much larger design.

## Open

- **Do exports use the same three modes as recordings?** They are the same class
  of thing — user-created audio — so probably yes, but they may want their own
  setting rather than sharing one.
- **Browse wants rethinking.** Flagged, not yet specified. Its own conversation.
