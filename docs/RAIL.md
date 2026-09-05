# The left rail

`ui/port/rail.js` and `rail.css` are the four buttons described below, and they
are what the page shows.

## What is wrong with it

Three kinds of button in one column, at two sizes, with no rule saying which is
which:

    ✎ Edit      icon + label     a workspace
    ▤ Browse    icon + label     a workspace
    ◈ Room      icon + label     a workspace
    ─────────────────────────────
    ≡           icon only        a panel inside Browse
    ⌕           icon only        Search
    ◴           icon only        Scan
    ⌂           icon only        Library folder
    ●           icon only        Record
    ◑ Theme     icon + label     neither, and adrift at the bottom

So the rail answers two different questions at once — *which workspace am I in*
and *which panel of the library is open* — and a reader has no way to tell which
question a given button belongs to. The separator is doing all of that work and
it cannot carry it.

## What it becomes

**Four buttons. One kind. Nothing else.**

| | | |
|---|---|---|
| 1 | **Grain** | the granular engine — where a sound is worked on |
| 2 | **Visual** | the room, and what it draws |
| 3 | **Theme** | how it all looks |
| 4 | **Browse** | every file, and everything to do with the library |

Everything currently below the separator — Library, Search, Scan, Library
folder, Record — moves **inside Browse**, as sections of it rather than as
siblings of the workspaces. They were always parts of the library; they were
never workspaces.

**Theme keeps its place but not its billing.** It is a fourth item rather than
a floating oddity at the bottom, and it sits above Browse — so the three you use
while working on a sound are together, and the library is the one below them.
It is not a much-used thing and the rail should not pretend otherwise; what it
should not be is *unfindable*, which is what a lone button under a separator
was.

## The tray opens and closes

- **Open:** icon and word.
- **Closed:** icon alone.
- **The icon does not move.** It sits in the same place in both states, and the
  words appear beside it. The rail grows to the right; nothing shifts under the
  hand that just clicked.

That last rule is the whole point. A rail whose icons jump when it opens is one
you have to re-read every time, and the reason to collapse it is to stop reading
it at all.

## Browse fills the frame

Today Browse has a tray down the right for tags. **It goes.** There are no tags
here, and a panel for a thing that does not exist is worse than an empty one —
it reads as broken rather than as absent.

What replaces it is nothing: Browse is the file list, full width, floor to
ceiling. **Double-click a file and it opens in Grain.** That is the whole interaction —
one list, one gesture, and you are looking at the sound.

## Grain draws something

Grain shows a visual, not a blank frame. One of the defaults, chosen and
configured under **Visual** — so the second tab is where you decide what the
first tab looks like.

## Search

**By name. That is all.** No tags, no "sounds like", no search by sound. Type
part of a filename and see the files whose names contain it.

## Where it lands, and what that costs

**Here. This is the edge build's rail.** The desktop keeps its own.

Worth writing down once, because it is the first deliberate divergence: until
now `ui/port/app.js` and `index.html` have been byte-for-byte the desktop's, and
that was the whole argument for calling this a port. After this they are not.

That is the right trade and the line is in the right place. What must not drift
is the **engine** — `fx`, `edit`, `audio-core` and the wire format. It is
vendored into `engine/vendor/`, byte for byte from a named desktop commit, and
`tools/sync-core.sh --check` keeps that honest. The interface is a different
matter: this build has no disk, no tags and no scan, so its rail differs. A rail
designed for what this is beats a copy of one designed for something else.

So the rule from here is: **the engine is shared and the interface is ours.**
A change to `ui/port/` is a change to this build alone. Anything that belongs to
both is written **in the desktop tree** and carried across with
`tools/sync-core.sh` — never edited inside `engine/vendor/`, which is a copy and
will be overwritten without warning the next time it is synced.

## Order of work

1. This document, agreed.
2. **The four buttons**, one component, one size, in `index.html` and
   `app.css`. Nothing moves yet.
3. **The tray's open and closed states**, with the icon pinned.
4. **Library panels move inside Browse.** This is the largest step and it is
   mostly moving markup, not writing it.
5. **The tag tray comes out**, and Browse's list takes the frame.
6. **Double-click opens Grain.**
7. **Search cut back to names.**
8. Re-copy into the port, and delete there what has no disk behind it.
