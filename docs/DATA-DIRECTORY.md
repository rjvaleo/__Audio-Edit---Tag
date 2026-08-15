# Moving the data directory

*A design. Nothing here is built. The most expensive item in the document to
defer, and the one with the most ways to go quietly wrong.*

---

## Why

`data/` is written **beside the executable**. Inside a signed `.app` that
location is read-only, and every updater replaces the bundle wholesale. Ship as
it stands and the first update after the first sale deletes every customer's
index, presets, sessions and tags.

## What moves

Twelve things, all joined off one `data_dir` in
[state.rs](../core/crates/server/src/state.rs), plus `Captures` from
`capture.rs` and `record.rs`. The code surface is genuinely small — the risk is
entirely in the data, not the plumbing.

```
config.json        AUDIO-INDEX.tsv    FINGERPRINTS.tsv   LABELS.tsv
USER-TAGS.tsv      TAG-OVERRIDES.json SESSIONS.json      PRESETS.json
AUTOMATION.json    MARKERS.json       FOLDER-ORDER.json
exports/           Captures/
```

## Decision 1 — these are two different kinds of thing

The list above is not homogeneous, and treating it as one directory is the
mistake that is easy to make here.

**App state** — config, index, fingerprints, labels, user tags, tag overrides,
sessions, presets, automation, markers, folder order. Private, machine-local,
meaningless to the user in a file browser. Belongs in the per-user app data
directory.

**User content** — `exports/` and `Captures/`. These are **audio files the user
made**. Burying them in `~/Library/Application Support` means they cannot find
their own work, and it is the kind of thing that reads as contempt.

*Recommendation:* app state goes to the OS data directory; exports and captures
default somewhere the user would look — beside the library, or `~/Music/<Name>/`
— and are configurable. `capture.rs` already has a notion of falling back, so
the shape exists.

## Decision 2 — which directory

| | path |
|---|---|
| macOS | `~/Library/Application Support/<Name>/` |
| Windows | `%LOCALAPPDATA%\<Name>\` |
| Linux | `$XDG_DATA_HOME/<name>/`, else `~/.local/share/<name>/` |

**Not `~/Library/Caches`, and not roaming `%APPDATA%`.** The index and
fingerprints for 75,000 files are large and *technically* regenerable — which
tempts you to call them a cache. Do not: macOS purges Caches under disk
pressure, and rebuilding means re-walking the library and re-running inference,
which is tens of minutes. On Windows, roaming `%APPDATA%` synchronises on every
login in a domain environment, so tens of megabytes of index would be copied
across the network repeatedly.

## Decision 3 — the migration, which is where the danger is

There is real data in `data/` right now — a working index, presets, sessions.
The move must carry it, and must not be able to destroy it.

*Recommendation:*

1. On startup, resolve the new location.
2. If it is **empty** and a legacy location has data, **copy** — never move.
3. Write a marker file recording that migration ran and from where.
4. Leave the old directory untouched.

Copy rather than move so a crash mid-migration loses nothing and the next launch
simply retries. The cost is duplicated disk for a while, which is worth it. A
half-completed `move` is the failure that cannot be recovered from.

## Decision 4 — the name problem, and why it is not one

The directory is named after the product, and the product name is not settled
(stage zero). Doing this first appears to mean doing it twice.

*Recommendation:* write the migration to check a **list** of legacy locations
and copy from the first that has data. A later rename then costs one entry added
to that list, and the machinery is already built and tested. The dependency
disappears — this does not need to wait for marketing.

## Decision 5 — the override stays

`AUDIOLAB_DATA` wins over everything. It is what makes tests hermetic and lets a
dev build run against a scratch directory, and it costs nothing to keep.

## Decision 6 — no portable mode

Tempting, since beside-the-executable is what happens today. But a signed bundle
is read-only, so portable mode would work only for unsigned dev builds —
exactly the configuration that least needs it. Beside-the-executable stays as a
*legacy source to migrate from*, not as a supported mode.

## What this needs before it is built

- A decision on **the product name**, or acceptance that the legacy-list
  approach makes a later rename cheap (recommended).
- A decision on **where exports and captures default to**.
- Tests: migration runs once, is idempotent, refuses to overwrite a populated
  destination, survives a partial copy, and honours `AUDIOLAB_DATA` over
  everything else.
