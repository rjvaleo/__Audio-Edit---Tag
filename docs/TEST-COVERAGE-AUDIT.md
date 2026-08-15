# What the tests actually cover

*An audit, 15 Aug 2026. Written after a day in which every bug found was in a
place with no tests, while the parts with 947 tests behaved perfectly.*

---

## The headline

**The tests are deep on arithmetic and absent on the program.**

`fx` alone has 305 tests. Every filter, every stretcher, every shaper is pinned
frame by frame. Meanwhile:

- **15 of 41 routes have any test at all.**
- **The entire live path — load, transport, parameter, state — has none.**
- **The interface had none until today.**
- **7 of the 11 invariants are not named by any test**, including the first and
  most important one.

That is not a small gap in an otherwise even picture. It is a program tested
thoroughly at the bottom and not at all at the top.

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

15 of 41. What is tested is worth having: the clamps on everything the stretch
panel posts, tag editing, presets, export, peaks, markers. What is not:

**The live path — the highest-value gap.** Nothing exercises `engine/load`,
`engine/transport`, `engine/state`, `engine/grains`, `rack/param` or `capture`.
This is where three of today's bugs lived, and it is the only part of the
program with *state that outlives a request* — which is exactly what makes it
hard to get right and easy to break from a distance.

**The library half.** `browse`, `files`, `folders`, `library`, `sounds`,
`thumbs`, `order`, `scan`, `scan/stop`, `similar`, `stats`, `space`. Browse is a
major section of the product and none of it is covered.

**Tagging.** `labels`, `usertag`, `usertags`.

**Odds.** `fx` — the shaper list, which the whole picker is built from and which
I leaned on this afternoon without a test to say it was right. `save`, `scales`,
`presets/delete`.

## Invariants

Only 6, 9, 10 and 11 are named anywhere. The rest may well be covered by tests
that never say so — and a test that does not name the invariant it protects is
one nobody will recognise when they go to change it.

**Invariant 1 — the source file is never written — has no test that names it.**
It is the promise the whole program rests on. There is an export test, but
nothing asserts the source's bytes are identical afterwards.

| | | named |
|---|---|---|
| 1 | The source file is never written | **no** |
| 2 | Grain randomness is a pure function of index and seed | **no** |
| 3 | Offline, real-time and visualiser share one enumeration | **no** |
| 4 | Effects must not change buffer length | **no** |
| 5 | `output_frames()` equals what `process()` produces | **no** |
| 6 | A windowed render matches the full render | yes |
| 7 | Edit operations address the pre-stretch timeline | **no** |
| 8 | A saved session is refused if the file changed | **no** |
| 9 | Every control inert at its default | yes |
| 10 | Nothing above the ceiling once the maximiser is on | yes |
| 11 | What you hear is what you export | yes |

## The interface

Until today: nothing. `tools/ui-check.mjs` now covers references that do not
resolve and controls without a reset, and found two dead functions on its first
run — one of which had removed the maximiser from the product entirely.

What it still cannot see is written in its own KNOWN LIMITS, and the important
one is that **nothing runs the interface**. A control wired to the wrong value
passes every check.

That gap is now closeable in a way it was not this morning: **the browser
works.** I had been asserting for hours that it did not, from stale context,
without ever trying it. It drives the real page at `127.0.0.1:8737` — reads the
DOM, runs script, reports console errors. Every "does this actually work"
question I have answered by reading code today could have been answered by
looking.

## What to build, in order

**1. Live-path route tests.** Load a file, play, move a parameter, read the
state back. Assert the engine holds what was posted. This is where the bugs
live and where there is nothing at all.

**2. Name the invariants.** Seven tests, each asserting the thing the invariant
promises and saying which one it is. Start with the first: export a file, then
compare the source's bytes before and after.

**3. Wire `ui-check.mjs` into `cargo test`.** It passes clean now, so it can go
in without being permanently red. A check nobody runs is not a check.

**4. Interface behaviour tests, through the browser.** Double-click a control
and assert it returns to its default *in the DOM* rather than in the source.
Open each panel and assert no console errors — which would have caught both
panel-blanking bugs immediately.

**5. Browse.** A whole section of the product with no coverage. Lower priority
only because it has been stable.

## The honest limit

Complete coverage is not the goal and is not reachable. What is reachable: **no
part of the program with zero coverage.** Today the live path and the interface
were at zero, and that is where every fault of the day was found.
