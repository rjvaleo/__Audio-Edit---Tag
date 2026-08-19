// The playhead must move at one speed.
//
// Reported as "it stutters, it slows down, it's janky" — repeatedly, and for a
// long time before it was measured rather than explained away.
//
// It is not a drawing problem. The position is extrapolated from a wall clock
// between polls, which is right; what was wrong is what happened *at* each poll:
//
//     engine.position = r.position;
//     engine.heard = performance.now();
//
// A hard snap, twenty times a second. `r.position` was true at some instant on
// the engine, but the stamp is when the reply *arrived* — so the baseline moved
// by however much the round trip varied. Between polls the playhead glided; at
// every poll it lurched by the network's jitter.
//
// Measured against a perfect clock sampled with a 2–18 ms arrival spread, over
// 779 frames of steady state: a tick that should advance 800 frames ran between
// 77 and 1470 of them, and 230 ticks — nearly a third — were off by more than a
// millisecond.
//
// `lockClock` dissolves the error instead of applying it: predict where we
// already are, take a fraction of the difference, and only jump for a real
// discontinuity. Same simulated network: 742 to 855 frames, ten ticks over a
// millisecond.

import { test, expect } from '@playwright/test';

/// Drive the clock by hand and count how evenly the playhead advances.
///
/// `performance.now` is replaced per read so the whole run happens in
/// simulated time. Real time would make this a test of the machine's load.
const RUN = `(mode) => {
  const RATE = 48000, POLL = 50, WARMUP = 120;
  engine.deviceRate = RATE; engine.latency = 0; engine.loop = null;
  engine.playing = true; engine.position = 0; engine.heard = null;
  const t0 = performance.now();
  const truth = (n) => (n - t0) / 1000 * RATE;
  let lastPoll = -1e9, prev = null;
  const deltas = [];
  // A fixed pseudo-random sequence, so a run is comparable with any other.
  let seed = 999;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let f = 0; f < 900; f++) {
    const now = t0 + f * (1000 / 60);
    const real = performance.now;
    performance.now = () => now;
    if (now - lastPoll >= POLL) {
      lastPoll = now;
      // The engine's answer was true a round trip ago; the reply lands now.
      const reported = truth(now - (2 + rnd() * 16));
      if (mode === 'snap') { engine.position = reported; engine.heard = now; }
      else lockClock(reported);
    }
    const pos = enginePosition();
    performance.now = real;
    if (prev !== null && f > WARMUP) deltas.push(pos - prev);
    prev = pos;
  }
  const ideal = RATE / 60;
  const err = deltas.map((d) => d - ideal);
  return {
    ticks: deltas.length,
    worstMs: Math.max(...err.map(Math.abs)) / RATE * 1000,
    slowest: Math.min(...deltas),
    fastest: Math.max(...deltas),
    overOneMs: err.filter((e) => Math.abs(e) / RATE * 1000 > 1).length,
    backwards: deltas.filter((d) => d < 0).length,
  };
}`;

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof enginePosition === 'function', { timeout: 20_000 });
}

test('the playhead advances at one speed under a jittery poll', async ({ page }) => {
  await ready(page);
  const out = await page.evaluate(`(${RUN})('lock')`);

  // A 60 fps tick should advance 800 frames at 48 kHz. What matters is not that
  // it is exact — it cannot be, the engine is the authority — but that no
  // single tick is far enough out to be seen.
  expect(out.worstMs, 'a frame moved by more than two milliseconds of audio')
    .toBeLessThan(2);
  expect(out.slowest, 'the playhead almost stopped for a frame').toBeGreaterThan(600);
  expect(out.fastest, 'the playhead lurched forward in one frame').toBeLessThan(1000);
  // A playhead that goes backwards reads as a skip, and there is never a reason
  // for one outside a seek or a loop wrap.
  expect(out.backwards, 'the playhead ran backwards').toBe(0);
  // A handful of frames may sit over a millisecond; a third of them may not.
  expect(out.overOneMs / out.ticks, 'too many frames are visibly out')
    .toBeLessThan(0.05);
});

/// The proof that the correction is what does it, not the machine being quick.
test('snapping to every poll is measurably worse than locking to it', async ({ page }) => {
  await ready(page);
  const snap = await page.evaluate(`(${RUN})('snap')`);
  const lock = await page.evaluate(`(${RUN})('lock')`);

  expect(lock.worstMs).toBeLessThan(snap.worstMs / 4);
  expect(lock.overOneMs).toBeLessThan(snap.overOneMs / 4);
  // The old behaviour's range, for the record: it should be wild.
  expect(snap.fastest - snap.slowest).toBeGreaterThan(500);
  expect(lock.fastest - lock.slowest).toBeLessThan(250);
});

/// A real discontinuity must still be instant.
test('a seek or a loop wrap still moves at once', async ({ page }) => {
  await ready(page);
  const out = await page.evaluate(() => {
    const RATE = 48000;
    engine.deviceRate = RATE; engine.latency = 0; engine.loop = null;
    engine.playing = true;
    engine.position = 0; engine.heard = performance.now();
    // Somewhere else entirely — a seek, not drift.
    lockClock(RATE * 30);
    const after = engine.position;
    return { after, jumped: Math.abs(after - RATE * 30) < RATE * 0.01 };
  });
  // Eased, a thirty-second jump would take minutes to arrive. Only small errors
  // are dissolved; a real move is a real move.
  expect(out.jumped, 'a seek was eased instead of taken').toBe(true);
});
