# What breaks when you throw the controls at random

*300 trials, 15 August 2026. Five engines × two sources × thirty randomisations.
The randomiser, the harness and the analysis are all in the repo, so every number
here can be reproduced and every failure replayed from its seed.*

```
node tools/glitch-sweep.mjs      # 300 trials → docs/glitch-sweep/trials.jsonl
node tools/glitch-report.mjs     # what failed, and which control predicts it
```

---

## How it works, and what it can and cannot see

**The randomiser drives the real controls.** `randomizeStretch()` sets every
range, choice and rocker in the stretch tray through the same `input`/`change`
events a hand produces. It therefore cannot produce a value the interface would
not allow, and there is no second table of ranges to drift out of step with the
controls — which is gotcha 7 waiting to happen. The engine picker is excluded:
which engine you are in is where you are, not a setting.

Every roll is **seeded**, so the interesting run is never the one you have just
lost. The `Random` button beside `Reset all` reports its seed in a toast.

**The measurement is the offline render.** Invariant 11 is structural here — the
offline renderers are loops over the same streaming engines the callback drives,
one implementation rather than two, asserted to 1e-6. So a discontinuity in the
rendered file is one you would have heard. Rendering is also deterministic and
needs no sound card, which is what makes 300 trials possible at all.

**What that cannot see is timing**, and timing turns out to be the main finding.
`renderRatio` — wall-clock render time over output duration — is the proxy. It is
*not* the real-time budget: it includes an HTTP round trip and renders whole
files rather than blocks, so it overstates cost on very short outputs. It is
comparable *between engines and between settings*, which is all the ranking
below needs. `fx/tests/pv_cost.rs` remains the honest per-block measure.

### Honest limits

- **Two sources, both mono, both short** — a 1.0 s tonal chop and a 0.22 s
  snare. Stereo is untested, and `stereo_link` cannot be exercised by material
  that has one channel.
- **Uniform sampling is not how anyone uses this.** It deliberately
  over-samples absurd corners. The percentages below are *rates under random
  settings*, not "how often a user sees a glitch".
- **The rack is untouched.** Only the stretch tray is rolled, so the maximiser
  sits at its default, which is **off**. Clipping is therefore not an invariant
  breach — invariant 10 only binds once the maximiser is on — but it is still
  audible, and nothing in the program catches it.
- Cost bands by `ratio` are confounded: a ratio below 1 makes a short output, and
  the fixed per-request cost then dominates. The `too-slow` verdict guards
  against this by ignoring outputs under 0.5 s; the raw banding does not.

---

## What happened

| engine | trials | clean | click | clip | dropout | silence | dc | at-ceiling | too-slow | timeout |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| WSOLA | 60 | 43 | 6 | 1 | 1 | 0 | 3 | 4 | 4 | 2 |
| Vocoder | 60 | 33 | 5 | 0 | 0 | 4 | 1 | 2 | 8 | 9 |
| PVSOLA | 60 | 34 | 6 | 1 | 4 | 1 | 0 | 2 | 7 | 8 |
| Hybrid | 60 | 33 | 1 | 0 | 0 | 0 | 0 | 1 | 11 | 16 |
| Granular | 60 | 38 | 10 | 0 | 1 | 1 | 0 | 6 | 2 | 4 |

Tonal material failed 39% of the time, transient 40% — **the material barely
matters**, which is itself worth knowing. What matters is the settings.

**Invariant 5 held in all 300 trials.** Not one render disagreed with the
engine's own `outFrames` by more than 1%. The length prediction is sound, and
that is the one thing this sweep tried hardest to break and could not.

---

## The ten biggest wins

Ranked by how many trials the fault touches and how clearly a cause is
identified. **Nothing here is fixed** — this is the plan, not the work.

### 1. Cost has no governor, and three controls multiply

The single biggest finding. Median `renderRatio` by control, across all engines:

| window | | layers | | density |
|---|---|---|---|---|
| 0–50 ms | 0.23 | 1–4 | 0.19 | 0–100 Hz | 0.40 |
| 50–200 | 0.50 | 5–8 | 0.58 | 100–250 | 0.50 |
| 200–600 | **0.97** | 9–12 | 0.62 | 250–400 | 0.52 |
| 600–2100 | 0.88 | 13–16 | 0.66 | 400–600 | **1.06** |

Each is monotonic, and they **multiply**: cost is roughly window × layers ×
density, and no one control knows what the others are set to. A user who raises
three sliders that each look affordable lands somewhere unplayable.

**Plan:** one predicted-cost function over (engine, window, layers, density,
overlap), used in two places — the panel shows a cost meter, and the live path
refuses to adopt a configuration it knows it cannot make in time, falling back
rather than dropping out. This subsumes wins 2 and 3.

### 2. The hybrid collapses under layers

| hybrid layers | median renderRatio |
|---|---|
| 1–4 | 0.22 |
| 5–8 | **3.39** |
| 9–12 | 1.85 |
| 13–16 | **5.19** |

**30 of 44 hybrid trials could not run in real time**; its median is 3.06×. The
hybrid is already three engines on three separated sources, and `layered()`
wraps the whole engine — so N layers is 3N engines.

**Plan:** the separation is ratio-independent and already computed once. Share it
across layers instead of re-deriving per layer, and cap the hybrid's layer count
to what the cost function allows. Note the memory says PVSOLA and Hybrid are
deliberately *not* wrapped in `layered()` — this measurement says something is
scaling with layers anyway, and finding out what is step one.

### 3. Extreme compression produces silence

All six silence cases are at **ratio ≤ 0.21**, four of them the vocoder. The
output is the right *length* — 2,010 to 4,396 frames — and entirely below 1e-4.
So the plan is right and the fill is empty.

**Plan:** reproduce at ratio 0.04 with the recorded seeds, and find where the
read pointer or the overlap-add normalisation collapses when the output is much
shorter than the input. Suspect the normalisation floor, which is derived from
window and hop and has been wrong at extremes before.

### 4. The percussive envelope clicks

A clean monotonic gradient, which is what a real mechanism looks like:

| envelope | click rate |
|---|---|
| 0.0–0.2 (percussive) | **17%** |
| 0.2–0.4 | 13% |
| 0.4–0.6 | 10% |
| 0.6–0.8 | 8% |
| 0.8–1.0 (swelling) | 6% |

**Plan:** check whether `env_at` actually reaches zero at both grain edges at the
percussive end. A window that starts at a non-zero value leaves a step at every
grain, which is exactly a click. If so this is a small fix with a large payoff,
and it must be made in `fx::grain` so the offline renderer, the block renderer
and the visualiser all get it (invariant 3).

### 5. Long window plus long stretch clicks

Clicking trials sit at median window **160 ms** and ratio **5.2**; clean ones at
**69 ms** and **0.28**. The worst single case is 231× the signal's own 99.9th
percentile step — an unmistakable bang.

**Plan:** the twelve worst are recorded with seeds. Replay them and find whether
the splice search is running out of room at long windows, which is the same
family as the search bound already fixed on 15 Aug.

### 6. Output level is unpredictable over a 100:1 range

Peak across 261 rendered trials: minimum 0.007, maximum 1.000. **39 came out
inaudibly quiet** (peak < 0.05) and **17 pinned at full scale**. Median peak by
engine sits between 0.13 and 0.23 — so the *typical* result is 15 dB below where
it should be, and the tails are 40 dB apart.

The layer compensation is not the cause and is working: median peak is flat from
1 to 16 layers.

**Plan:** decide what the contract is. Either the stretch stage holds output RMS
near the input's, or it does not and the maximiser becomes the answer — but the
maximiser is off by default, so today there is no answer.

### 7. Nothing prevents clipping

15 trials pinned at the ceiling and 2 clipped outright, the worst a run of 58
consecutive samples at full scale. This is *not* an invariant breach — invariant
10 binds only once the maximiser is on, and it defaults to off — but it is
audible, and the program neither prevents it nor says it happened.

**Plan:** a clip indicator that latches, at minimum. Whether the maximiser should
default to on is a product decision, not a bug fix.

### 8. Render timeouts at high ratio

39 of 300 exceeded 15 s, dominated by ratio (r = +0.60) and by the hybrid (16 of
60). Some of this is honest cost — a 50× stretch is a lot of audio. Some is not:
one PVSOLA trial hit `renderRatio` 95.

**Plan:** separate the two by measuring cost per output second rather than per
render. Anything superlinear in ratio is a bug; anything linear is a price, and
the price should be shown as a progress bar rather than a stall.

### 9. PVSOLA drops out at high ratio

4 of 60, correlating hard with ratio (r = +0.78) and inversely with size jitter
(−0.60). PVSOLA re-anchors every few frames and discards a run-up at each anchor;
at long ratios the run-up is where the material is.

**Plan:** check whether the discarded run-up is still measured in output frames.
There is a test pinning exactly this, and a regression here would mean it stopped
covering the case.

### 10. DC offset at high layer counts

4 trials with |DC| > 0.05, correlating with layers (+0.73) and inversely with the
vocoder's `magGate` (−0.73). Small, but DC offset eats headroom and is inaudible
until it clips something downstream.

**Plan:** cheapest of the ten — a DC blocker on the stretch output, or find why
summed layers do not cancel.

---

## Two things that are not on the list, and why

**Reverse grains click *less*** — 7% against 15% with reverse off. Counter to
expectation, unexplained, and worth understanding before anything is built on
it.

**Wrap barely moves the needle** — 9% clicking with it on, 12% off. That is a
weak argument in favour of defaulting it on, which is what the user asked for
and which is blocked on the PVSOLA speed bug in
[the outstanding notes](../docs/ROADMAP.md). Weak, but pointing the same way.

---

## What to do first

**Win 1 is the one to build**, because 2, 8 and part of 9 are the same fault seen
from different angles: cost is emergent from several controls and nothing in the
program knows the total. A cost function used by both the panel and the live path
turns four findings into one piece of work.

Then **4** — small, isolated, and a clean gradient says the mechanism is real.

Then **3** — a genuine bug with six recorded reproductions.
