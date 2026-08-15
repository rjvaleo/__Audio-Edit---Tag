# Presets: "with sound"

*What was asked for, before it was built.*

---

## What already worked

Presets persist between sessions and always have. They are written to
`data/PRESETS.json` on every save and read back at startup — checked by saving
one, killing the server and restarting: ratio, density, pan spread and two rack
slots all came back intact. A preset already stores the **whole** stretch
(time, pitch, window, engine, every engine's own parameters, the entire grain
cloud) and the **whole** rack (every module and all its settings).

The one thing it never stored is which sound it came from.

## The two behaviours

A checkbox inside the preset dropdown, **"with sound"**.

**Off — the default, and what a preset has always been.** Only *settings*
change, and only on modules that are already there. It does not add a module
and it does not remove one. Drop a preset with a reverb onto a rack that has no
reverb and no reverb appears; the modules you do have take the preset's values
for the controls they share.

This is a real change from what applying a preset used to do — it replaced the
rack wholesale — and it is the more useful of the two by a distance, because it
lets a preset be a *sound* you drop onto a chain you have already built rather
than a chain that evicts yours.

**On — a complete recall.** The sound file is loaded, the rack is replaced
outright with the preset's, and the stretch is applied. Everything is
overwritten. This is a snapshot of a working state rather than a portable
setting.

## What has to change

1. **`Preset` gains a `path`.** The library-relative path of the file it was
   captured from. Presets written before this have no path; with sound they
   simply refuse rather than guessing.
2. **Apply takes `withSound`.** Off merges settings into existing modules; on
   replaces the rack and loads the file.
3. **A merge that touches no structure.** Walk the preset's slots, find a slot
   of the same kind in the target rack, and write the parameters they share.
   Nothing is added, nothing is removed, nothing is reordered.
4. **The checkbox, in the dropdown.**

## Decided along the way

**A missing file is an error, not a guess.** A preset whose sound has been
moved or deleted says so and applies nothing. Falling back to "just the
settings then" would silently do a different thing from the one asked for.

**The master is part of the rack, not a module.** The existing apply already
learned this the hard way — a preset that is nothing but a maximiser setting
has no slots at all. Settings-only must therefore carry the master across even
though it is not in the slot list.

**Order does not matter for the merge.** Matching by kind and position among
slots of that kind, not by index, so a preset made on a chain with the EQ first
still finds the EQ in a chain that has it third.
