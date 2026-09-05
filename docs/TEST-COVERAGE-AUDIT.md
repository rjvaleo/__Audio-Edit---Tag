# What the tests actually cover

*An audit, 15 Aug 2026. Written after a day in which every bug found was in a
place with no tests, while the parts with heavy coverage behaved perfectly.*

**Re-measured at the end of that day: 934 tests, 19 of 44 routes, 10 browser
tests.** The numbers below are as re-counted; where the morning's figures
differed they are noted rather than quietly replaced.

> **Update, 5 Sep 2026: 1029 Rust tests and 241 browser tests**, and the audit's
> central claim has been tested from the outside for the first time. See
> [What CI changed](#what-ci-changed) at the end — the short version is that two
> long-standing bugs were found in one day by running the suite on a machine
> unlike this one, and that a test which cannot fail in any environment you have
> is not yet a test.

---

## The headline

**The tests are deep on arithmetic and absent on the program.** Less absent than
it was — see Progress — but the shape of the gap has not changed.

`fx` alone has 308 tests. Every filter, every stretcher, every shaper is pinned
frame by frame. Meanwhile:

- **19 of 44 routes have any test at all** (was 15 of 41 this morning).
- **The live path had none.** It now has route tests for `engine/state` and
  `rack/param`; `engine/load`, `engine/transport`, `engine/grains` and `capture`
  are still uncovered.
- **The interface had none.** It now has a static check and 28 Playwright spec files.
- **5 of the 11 invariants are not named by any test** (was 7). Invariants 1 and
  8 were named today.

That is not a small gap in an otherwise even picture. It is a program tested
thoroughly at the bottom and thinly at the top.

## The evidence, rather than the impression

Every bug found today, and where it lived:

| what broke | where | had tests? |
|---|---|---|
| A short loop stopped the machine | engine | no — added |
| Escape destroyed the selection | interface | no |
| Every slider rebuilt the rack | live path | no |
| Reverb tails cut dead on stop | engine | no — added |
| Density and Layers rebuilt per drag step | live path | no — added |
| The compressor panel fought its own display | interface | no — added |
| The maximiser had no interface for three days | interface | no — added |
| One fader had no reset default | interface | no — added |

Eight bugs. **Zero** in the parts with heavy coverage. Every one in the live
path or the interface.

The DSP is not over-tested — those tests are why the DSP is trustworthy. The
lesson is only that the coverage stops exactly where the program starts.

## Routes

**19 of 44.** What is tested is worth having: the clamps on everything the
stretch panel posts, tag editing, presets, export, peaks, markers, and — as of
today — `engine/state` and `rack/param`.

The 25 with nothing, grouped by how much it matters:

**The live path, still the highest-value gap.** `engine/load`,
`engine/transport`, `engine/grains`, `capture`, `audio/buffer`. Better than this
morning, when the whole group was empty, but the three that *change* engine
state are still the untested ones. This is the only part of the program with
state that outlives a request, which is exactly what makes it hard to get right
and easy to break from a distance.

**The library half.** `browse`, `files`, `folders`, `library`, `sounds`,
`thumbs`, `order`, `scan`, `scan/stop`, `similar`, `stats`, `space`. Browse is a
major section of the product and none of it is covered.

**Tagging.** `labels`, `usertag`, `usertags`.

**Grains.** `grains`, `grains/cap`.

**Odds.** `save`, `scales`, `presets/delete`.

`fx` — the shaper list the whole picker is built from — **is** covered now.

## Invariants

**Six of eleven are named now** — 1, 6, 8, 9, 10 and 11. The rest may well be
covered by tests that never say so, and a test that does not name the invariant
it protects is one nobody will recognise when they go to change it.

**Invariant 1 — the source file is never written — was the worst of these and is
fixed.** It is the promise the whole program rests on, and this morning there was
an export test but nothing asserting the source's bytes were identical
afterwards. There now is, plus a second test that exporting twice writes two
files rather than replacing one.

| | | named | where |
|---|---|---|---|
| 1 | The source file is never written | **yes** | bytes compared before and after an export |
| 2 | Grain randomness is a pure function of index and seed | **no** | |
| 3 | Offline, real-time and visualiser share one enumeration | **no** | the one most nearly broken, repeatedly |
| 4 | Effects must not change buffer length | **no** | |
| 5 | `output_frames()` equals what `process()` produces | **no** | |
| 6 | A windowed render matches the full render | yes | `editing.rs`, three tests |
| 7 | Edit operations address the pre-stretch timeline | **no** | |
| 8 | A saved session is refused if the file changed | **yes** | |
| 9 | Every control inert at its default | yes | `rack.rs`, `reverb.rs` |
| 10 | Nothing above the ceiling once the maximiser is on | yes | `maximizer_module.rs`, `master.rs` |
| 11 | What you hear is what you export | yes | structural — one implementation, asserted to 1e-6 |

**Invariant 3 is the one to name next**, on the evidence: it is the rule that
keeps being *nearly* broken. The block renderer once carried its own copy of the
grain envelope with a comment promising it matched.

## The interface

Until today: nothing. Now two layers.

**`tools/ui-check.mjs`** covers references that do not resolve and controls
without a reset, and found two dead functions on its first run — one of which
had removed the maximiser from the product entirely. What it cannot see is
written in its own KNOWN LIMITS, and the important one is that it does not *run*
anything. A control wired to the wrong value passes every static check.

**`tests/ui/*.spec.mjs`** closes that, and the gap turned out to be closeable in
a way it was not this morning: **the browser works.** I had been asserting for
hours that it did not, from stale context, without ever trying it. Ten specs now
drive the real page — the page loads with no console error, opening a sound
builds every panel, double-click returns a control to its default *in the DOM*,
every engine can be selected, and the theme panel actually lists themes.

That last one is not a hypothetical. The theme panel shipped broken three
separate times in one afternoon — the pane was never registered in `showPane`'s
map, then the button lost the class carrying its handler, then the list rendered
at zero height — and each time it was announced as working on the strength of
testing the engine in isolation. **A test that calls a function directly and
never opens the panel proves nothing about the panel.**

Two traps inside the harness, both of which cost real time:

- **`window.state` is undefined and always will be.** `state` is a `const` at
  classic-script top level, so it is a lexical global, not a property of
  `window`. Bare `state` works. This timed out all five specs on the first run.
- **`state.folders` holds folders, not files.** Handing one to `selectFile` gets
  as far as reading its sample rate before giving up.

## Progress

**1. Live-path route tests — done.** Seven, covering what the engine reports
holding nothing, a live parameter reaching the stored document, clamping, both
refusal paths, the master's amount being live while its ceiling is not, and
every module the picker offers being one that can actually be built.

None of them opens the audio device. A test that made sound would fight
whatever the machine is already playing and would fail on any box without an
output; what happens *inside* the callback is covered frame by frame in
`engine::transport`, which was built to run without a sound card for this
reason.

**2. Naming the invariants — started.** 1 and 8 now have tests that say so.
Invariant 1 is asserted on the source's bytes before and after an export, plus
a second test that exporting twice writes two files rather than replacing one.
Five still unnamed: 2, 3, 4, 5, 7.

**3. `ui-check.mjs` wired into `cargo test` — done.**
`server/tests/interface.rs` runs it, and fails loudly rather than skipping
silently when it finds something. A machine without node prints SKIPPED rather
than passing quietly, so "the tests are green" cannot come to mean different
things on different machines. Confirmed by adding a call to a function that
does not exist: the test fails and names the line.

**4. Interface behaviour tests through the browser — done.** Playwright, 10
specs, run against `tools/scratch-server.mjs` so they cannot touch a working
session. `workers: 1` and `fullyParallel: false` because the interface holds one
document and the server holds one engine; `retries: 0` because a failing
interface test is nearly always a real fault and retrying hides the difference.

**5. Browse — not started.** Still the largest untested section of the product.

## What to build, in order

The original list is done except the last item. What remains, re-ordered on
what the day actually showed:

**1. Browse.** A whole section of the product with no coverage — twelve routes
and the largest single gap left. Lower priority only because it has been stable,
which is an argument that gets weaker the longer it goes untouched.

**2. Name invariants 3, 2, 5, 4, 7 — in that order.** Three first, because it is
the one that keeps nearly breaking: assert the offline enumeration, the
real-time one and the visualiser's agree grain for grain, rather than trusting
that they call the same function.

**3. The three live routes that change state** — `engine/load`,
`engine/transport`, `engine/grains`. `engine/state` and `rack/param` are covered;
these are not, and they are the ones that mutate.

**4. Extend the browser specs past what is on screen.** They currently reach
only the panels the selected engine happens to build, so the count they assert
is a floor. Switch engines and re-run the sweep.

**5. The library half of the interface.** Browse has no specs at all, for the
same reason it has no route tests.

## The honest limit

Complete coverage is not the goal and is not reachable. What is reachable: **no
part of the program with zero coverage.** Today the live path and the interface
were at zero, and that is where every fault of the day was found.


---

## What CI changed

*Added 17 Aug 2026.*

`.github/workflows/ci.yml` now builds and runs everything on every push. Its
first two runs found two bugs that had been in the program for months, and both
were invisible here for the same reason: **the development machine is not a
representative machine.**

### A test that could not fail

`the_engine_reports_holding_nothing_rather_than_failing` asserts that
`/api/engine/state` answers 200. It was written months ago with a comment
stating plainly that nothing in that section opens the audio device, *because it
would fail on a box without an output*.

The route did open the device. On every machine the suite had ever run on there
was a sound card, so the assertion passed and the case it was written for was
never reached. CI has no sound card. See [`NO-AUDIO-DEVICE.md`](NO-AUDIO-DEVICE.md).

**The general form:** a test whose failure requires an environment you do not
have is not yet a test. It is a statement of intent. The value of CI is not that
it runs the tests again — it is that it runs them somewhere else.

### A test that passed on all-black

The theme engine spent an afternoon deriving `#000000` for **69 of 86 tokens**
on every one of the 47 derived palettes, because a `toHex` added to `app.js`
silently replaced the theme engine's own — `ui/*.js` are classic scripts sharing
one global scope, and the file that loads second wins.

**Seven of the eight theme tests passed throughout.** Two of them are the
lesson:

- *"every palette derives a complete set of tokens"* checked the tokens were
  **present**. Sixteen copies of black is a complete set.
- *"every palette keeps the surface ladder in order"* passes on seven identical
  blacks, because they are, technically, in order.

Both now require distinct colours and a ladder that climbs. This is the same
vacuity the audit already names above — asserting shape rather than substance —
found again, in tests written after the audit.

`tests/ui/globals.spec.mjs` catches the class by **name**, because a collision
breaks whichever file lost it, somewhere else entirely, and no behavioural test
of the theme engine can see the cause.

### The count

| | 15 Aug | 17 Aug | 5 Sep |
|---|---|---|---|
| Rust tests | 934 | 965 | **1029** |
| Browser tests | 10 | 24 | **241** |
| Spec files | 2 | 5 | **28** |

The 5 Sep re-count also found `cargo test` **red**, and red since whenever
`VIS_WAS_HIDDEN = new WeakSet()` was written: `tools/ui-check.mjs` had `Set` and
`Map` in its globals list but not `WeakSet`, so it reported a language builtin
as a dangling reference and `server/tests/interface.rs` failed with it. The
suite was reported as green throughout, here and in the README. Two lessons
already in this file — *a test that cannot fail is not a test yet*, and *verify
against the running thing* — have a third beside them now: **a number in a
document is not a measurement.** Every figure in this table was re-measured by
running the suites, not by reading the last document that quoted them.

New: `tests/ui/globals.spec.mjs` (global-scope collisions, the derived palettes
are real colours, applying a theme is instant), `tests/ui/no-audio.spec.mjs`
(the deviceless machine), `tests/ui/buttons.spec.mjs` (button geometry, measured
to the pixel), and `core/crates/edit/tests/export_loop.rs` (14 tests on loop
repeats, seams, and the tail).

### Still true

Everything in *The honest limit* below stands. Routes are still thin, most
invariants are still unnamed, and the tests are still deep on arithmetic and
thin on the program. CI does not change that shape — it changes how many
machines the existing tests are asked to be true on, which turned out to be
worth two bugs on day one.