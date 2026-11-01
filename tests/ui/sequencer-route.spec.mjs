// The sequencer through the engine's output.
//
// Routed, the page does not play the sequencer: its master is tapped, every
// sample stamped with the engine output frame it belongs at, and posted to the
// engine, which adds it in on that frame. The engine's half is unit tested in
// `engine::seqbus` and `engine::transport`; this is the page's. What is checked:
//
//   - routed and playing, every note is stamped on the engine frame of its step,
//     in one unbroken run;
//   - round the engine's loop, the grid wraps where the engine will, and the
//     stamps go straight from the loop's end to its start;
//   - an engine that will not take the sound leaves the page playing the
//     sequencer, and the host told;
//   - a page that finds itself behind the engine is laid a lead ahead again —
//     at the second clock in a row that says so, not on one busy moment;
//   - the host is told the sound is going to the engine only once the engine
//     has taken some, and the end of the sound stops the sequencer;
//   - played and stopped again and again, the page sends the engine one stream,
//     not one for every Play — and an epoch is the wall clock's, so two windows
//     agree which spoke last;
//   - the host's Play starts the sequencer first and the engine a lead after it
//     says it is under way, holding the playhead meanwhile; a seek is a new
//     epoch for both;
//   - a poll that finds the engine not yet playing does not end that Play — on
//     the real device it did, and the engine was never started;
//   - routed, the room is drawn from the engine's feed as it is.
//
// Run with Chromium's fake audio output. Headless, a page's audio context
// otherwise says it is running and never renders a frame.

import { test, expect } from './test.mjs';

test.use({ launchOptions: { args: ['--disable-audio-output'] } });

async function enterSeq(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  return page.frames().find((f) => f.url().includes('/sequencer/'));
}

/// Short notes with silence between, a quarter of a second apart, so every
/// onset can be found. Resolves to the page's rate, which the engine is given
/// so the page is not rebuilt at another.
const TONE = () => {
  perfLoaded = null;
  bpm = 120; stepBeats = 0.5; numSteps = 8; direction = 'fwd'; waveType = 'sine';
  steps.forEach((s, i) => { s.degree = i; s.rest = false; });
  adsr = { a: 1, d: 25, s: 0, r: 5 };
  delayWet = 0;
  initAudio();
  delayWetGain.gain.value = 0;
  delayDryGain.gain.value = 1;
  lfos.forEach((l) => { l.depth = 0; if (l.gainNode) l.gainNode.gain.value = 0; });
  return audioCtx.sampleRate;
};

/// The runs the sender kept, laid end to end on engine frames: where each note
/// began, and where one run did not follow on from the last. Between notes the
/// sequencer is exactly silent, so a note begins at the first sample that is
/// not — found to the sample, where a louder threshold would wait for the attack
/// and the filter to rise to it.
const ONSETS = () => {
  const sent = seqBridge.routeSent();
  const rate = audioCtx.sampleRate;
  const onsets = [];
  const gaps = [];
  let quiet = rate;
  let loud = 0;
  let end = null;
  for (const s of sent) {
    const n = s.data.length / 2;
    if (end !== null && s.at !== end) gaps.push([end, s.at]);
    end = s.at + n;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(s.data[i * 2]);
      loud = Math.max(loud, v);
      if (v > 1e-6) {
        if (quiet > 0.04 * rate) onsets.push(s.at + i);
        quiet = 0;
      } else quiet++;
    }
  }
  return { runs: sent.length, onsets, gaps, loud, epochs: [...new Set(sent.map((s) => s.epoch))] };
};

test('routed and playing, every note is stamped on the engine frame of its step', async ({ page }) => {
  const frame = await enterSeq(page);
  const rate = await frame.evaluate(TONE);
  const step = Math.round(0.25 * rate);
  await page.evaluate((r) => {
    engine.device = true;
    engine.deviceRate = r;
    engine.position = Math.round(3.6 * r);
    seq.routeSink = true;
    // How much the page had sent at the moment the host was told it was routed.
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'seq:route' && e.data.on) {
        seq.routedAfterBatches = seqFrame().contentWindow.seqBridge.routeState().batches;
      }
    });
    seqSync(true, { preroll: true });
  }, rate);
  await page.waitForFunction(() => seq.routed === true, null, { timeout: 5_000 });
  expect(await frame.evaluate(() => seqBridge.routeState().on)).toBe(true);
  expect(await page.evaluate(() => seq.routedAfterBatches),
    'the host was told the sound was going to the engine before any of it had gone').toBeGreaterThan(0);
  await page.waitForTimeout(1_400);
  await page.evaluate(() => seqSync(false));
  await page.waitForTimeout(150);
  const got = await frame.evaluate(ONSETS);
  expect(got.loud, 'nothing was sent').toBeGreaterThan(0.01);
  expect(got.gaps, 'the stamps skipped or went back').toEqual([]);
  expect(got.epochs.length).toBe(1);
  expect(got.onsets.length, `onsets at ${got.onsets}`).toBeGreaterThanOrEqual(4);
  // The engine was at 3.6 s: the first step to sound is the one at 3.75 s.
  const first = Math.ceil((3.6 * rate) / step) * step;
  got.onsets.forEach((f, i) => {
    expect(Math.abs(f - (first + i * step)), `note ${i + 1} at frame ${f}, not ${first + i * step}`).toBeLessThanOrEqual(2);
  });
});

test('played and stopped again and again, the page sends the engine one stream, not one a Play', async ({ page }) => {
  const frame = await enterSeq(page);
  const rate = await frame.evaluate(TONE);
  await page.evaluate((r) => {
    engine.device = true;
    engine.deviceRate = r;
    engine.position = 0;
    seq.routeSink = true;
  }, rate);
  // Three plays and three stops, as a person trying it out would.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { seqSync(true, { preroll: true }); });
    await page.waitForFunction(() => seq.routed === true, null, { timeout: 5_000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => seqSync(false));
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => { seqSync(true, { preroll: true }); });
  await page.waitForFunction(() => seq.routed === true, null, { timeout: 5_000 });
  await frame.evaluate(() => seqBridge.routeSent());
  const t0 = Date.now();
  await page.waitForTimeout(1_000);
  const got = await frame.evaluate(() => {
    const runs = seqBridge.routeSent();
    let frames = 0;
    const overlaps = [];
    const seen = [];
    for (const s of runs) {
      const n = s.data.length / 2;
      frames += n;
      for (const [a, b] of seen) if (s.at < b && s.at + n > a) overlaps.push([s.at, a]);
      seen.push([s.at, s.at + n]);
    }
    return { frames, overlaps: overlaps.slice(0, 4) };
  });
  const seconds = (Date.now() - t0) / 1000;
  await page.evaluate(() => seqSync(false));
  expect(got.overlaps, 'the same frames were sent twice').toEqual([]);
  expect(got.frames / (seconds * rate), 'the page sent more than one stream\'s worth').toBeLessThan(1.4);
  expect(got.frames / (seconds * rate), 'the page sent too little').toBeGreaterThan(0.6);
  // Epochs on the wall clock, and still one more each time.
  const epochs = await page.evaluate(() => { const a = seqNextEpoch(); const b = seqNextEpoch(); return { a, b, now: Date.now() }; });
  expect(epochs.b).toBe(epochs.a + 1);
  expect(Math.abs(epochs.a - epochs.now)).toBeLessThan(5_000);
});

test('round the engine\'s loop the grid wraps where the engine will, and the stamps go straight back', async ({ page }) => {
  const frame = await enterSeq(page);
  const rate = await frame.evaluate(TONE);
  const step = Math.round(0.25 * rate);
  await page.evaluate((r) => {
    seq.epoch = 41;
    seqPost({
      type: 'seq:transport', playing: true, at: 3.6, loop: { a: 3.5, b: 4.5 },
      route: { rate: r, lead: 0.12, epoch: 41, sink: true },
    });
  }, rate);
  await page.waitForFunction(() => seq.routed === true, null, { timeout: 5_000 });
  await page.waitForTimeout(2_000);
  await page.evaluate(() => seqPost({ type: 'seq:transport', playing: false }));
  await page.waitForTimeout(150);
  const got = await frame.evaluate(ONSETS);
  const aF = Math.round(3.5 * rate);
  const bF = Math.round(4.5 * rate);
  // Once round in the first pass, and again each second after.
  expect(got.gaps.length, 'the stamps never went back round the loop').toBeGreaterThanOrEqual(1);
  for (const g of got.gaps) expect(g, 'the stamps did not go straight from the loop\'s end to its start').toEqual([bF, aF]);
  // Before the wrap the steps at 3.75, 4.0 and 4.25 s; after it, from 3.5 s on.
  const want = [15, 16, 17, 14, 15, 16].map((k) => k * step);
  expect(got.onsets.length, `onsets at ${got.onsets}`).toBeGreaterThanOrEqual(want.length);
  want.forEach((f, i) => {
    expect(Math.abs(got.onsets[i] - f), `note ${i + 1} at frame ${got.onsets[i]}, not ${f}`).toBeLessThanOrEqual(2);
  });
});

test('an engine that will not take the sound leaves the page playing the sequencer, and the host told', async ({ page }) => {
  const frame = await enterSeq(page);
  const rate = await frame.evaluate(TONE);
  await page.evaluate((r) => {
    engine.device = true;
    engine.deviceRate = r;
    engine.position = 0;
    seq.routeSink = false;
    // Somewhere that will not take it.
    seq.routeUrl = '/api/engine/seq-nowhere';
    seqSync(true, { preroll: true });
  }, rate);
  await frame.waitForFunction(() => seqBridge.routeState().epoch > 0, null, { timeout: 5_000 });
  await page.waitForTimeout(600);
  const got = await frame.evaluate(() => ({ on: seqBridge.routeState().on, playing: isPlaying }));
  expect(got.on, 'the page went on sending to an engine that refused it').toBe(false);
  expect(got.playing, 'the sequencer stopped instead of playing on').toBe(true);
  expect(await page.evaluate(() => seq.routed)).toBe(false);
  await page.evaluate(() => { seq.routeUrl = null; seqSync(false); });
});

test('a routed page that finds itself behind the engine is laid a lead ahead again, at the second clock that says so', async ({ page }) => {
  const frame = await enterSeq(page);
  const rate = await frame.evaluate(TONE);
  await page.evaluate((r) => {
    seq.epoch = 7;
    seqPost({ type: 'seq:transport', playing: true, at: 2, route: { rate: r, lead: 0.12, epoch: 7, sink: true } });
  }, rate);
  await page.waitForFunction(() => seq.routed === true, null, { timeout: 5_000 });
  // The engine is already at five seconds, so every block the page sends is late.
  // Once could be a page that was busy; twice in a row, it is laid again.
  await page.evaluate(() => seqPost({ type: 'seq:clock', playing: true, at: 5, epoch: 7, sentAt: performance.timeOrigin + performance.now() }));
  await page.waitForTimeout(60);
  expect(await frame.evaluate(() => seqBridge.last.at), 'one reading out of line laid the grid again').toBeLessThan(5);
  await page.evaluate(() => seqPost({ type: 'seq:clock', playing: true, at: 5.06, epoch: 7, sentAt: performance.timeOrigin + performance.now() }));
  await frame.waitForFunction(() => seqBridge.last && seqBridge.last.at > 5, null, { timeout: 2_000 });
  expect(await frame.evaluate(() => seqBridge.last.at)).toBeCloseTo(5.18, 1);
  expect(await frame.evaluate(() => seqBridge.routeState().jumps)).toBe(1);
  expect(await frame.evaluate(() => seqBridge.routeState().on), 'a late page stopped sending').toBe(true);
  await page.evaluate(() => seqPost({ type: 'seq:transport', playing: false }));
});

test('Play starts the sequencer first and the engine a lead later, and a seek is a new epoch for both', async ({ page }) => {
  await enterSeq(page);
  const got = await page.evaluate(async () => {
    engine.device = true;
    engine.deviceRate = 48000;
    engine.position = 96000;
    engine.latency = 0;
    seq.routeSink = true;
    const posts = [];
    enginePost = async (b) => { posts.push({ ...b, t: performance.now() }); return null; };
    for (const f of ['startTransportLoop', 'startPolling', 'startSwarm', 'stopSwarm', 'captureTransport', 'captureFollow']) {
      window[f] = () => {};
    }
    let routedAt = null;
    const watch = setInterval(() => { if (seq.routed && routedAt === null) routedAt = performance.now(); }, 1);
    const told = [];
    const realSeqPost = seqPost;
    seqPost = (m) => { told.push(m); return realSeqPost(m); };
    const t0 = performance.now();
    startPlayback();
    const transportAt = told.find((m) => m.type === 'seq:transport' && m.playing)?.at;
    const held = [enginePosition(true)];
    const rolled = engine.rolling;
    const early = posts.some((p) => p.play === true);
    await new Promise((r) => setTimeout(r, 60));
    held.push(enginePosition(true));
    for (let i = 0; i < 300 && !posts.some((p) => p.play === true); i++) await new Promise((r) => setTimeout(r, 5));
    clearInterval(watch);
    const play = posts.find((p) => p.play === true);
    const started = seq.epoch;
    seekSource(0);
    const seek = posts.find((p) => p.seek !== undefined);
    const afterSeek = seq.epoch;
    pausePlayback();
    seqPost = realSeqPost;
    return {
      held, rolled, early, started, afterSeek, transportAt,
      routedAt: routedAt === null ? null : routedAt - t0,
      play: play ? { epoch: play.seqEpoch, waited: play.t - routedAt } : null,
      seek: seek ? seek.seqEpoch : null,
      rolling: engine.rolling,
    };
  });
  expect(got.routedAt, 'the sequencer never said it was under way').not.toBeNull();
  expect(got.rolled).toBe(true);
  expect(got.early, 'the engine started before the sequencer').toBe(false);
  expect(got.held, 'the playhead ran on before the engine started').toEqual([96000, 96000]);
  expect(got.transportAt, 'the sequencer did not start exactly where the engine is').toBe(2);
  expect(got.play, 'the engine never started').not.toBeNull();
  expect(got.play.epoch, 'the engine was not given the epoch it starts under').toBe(got.started);
  expect(got.play.waited, 'the engine did not wait the lead').toBeGreaterThanOrEqual(105);
  expect(got.afterSeek).toBeGreaterThan(got.started);
  expect(got.seek, 'the seek did not carry its epoch to the engine').toBe(got.afterSeek);
  expect(got.rolling).toBe(false);
});

test('a poll that finds the engine not yet playing does not end the Play it is waiting for', async ({ page }) => {
  await enterSeq(page);
  const got = await page.evaluate(async () => {
    engine.device = true;
    engine.deviceRate = 48000;
    engine.position = 96000;
    engine.latency = 0;
    seq.routeSink = true;
    for (const f of ['startTransportLoop', 'startSwarm', 'stopSwarm', 'captureTransport', 'captureFollow', 'grainsFollowView']) {
      window[f] = () => {};
    }
    // The engine as the server reports it: stopped until it is told to play —
    // and every answer slow, so one asked for before it was told arrives after.
    const posts = [];
    let told = false;
    enginePost = async (b) => { posts.push(b); if (b.play === true) told = true; return null; };
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (!String(url).startsWith('/api/engine/grains')) return realFetch(url, opts);
      const playing = told;
      await new Promise((r) => setTimeout(r, 80));
      return new Response(JSON.stringify({
        playing, position: 96000, sampleRate: 48000, latency: 0, spectrum: [], waveform: [], rackLevels: [],
      }), { status: 200 });
    };
    try {
      startPlayback();
      for (let i = 0; i < 400 && !posts.some((p) => p.play === true); i++) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 400));
      return {
        started: posts.some((p) => p.play === true),
        playing: engine.playing,
        seeks: posts.filter((p) => p.seek !== undefined).length,
      };
    } finally {
      pausePlayback();
      window.fetch = realFetch;
    }
  });
  expect(got.started, 'the engine was never told to play').toBe(true);
  expect(got.playing, 'a poll from before the engine started ended the Play').toBe(true);
  expect(got.seeks, 'the transport dropped back to the cue').toBe(0);
});

test('the end of the sound stops the sequencer, as a stop does', async ({ page }) => {
  const frame = await enterSeq(page);
  await frame.evaluate(TONE);
  const got = await page.evaluate(async () => {
    engine.device = true;
    engine.deviceRate = 48000;
    engine.position = 0;
    engine.latency = 0;
    seq.routeSink = true;
    for (const f of ['startTransportLoop', 'startSwarm', 'stopSwarm', 'captureFollow', 'grainsFollowView']) {
      window[f] = () => {};
    }
    const posts = [];
    let told = false;
    let ended = false;
    enginePost = async (b) => { posts.push(b); if (b.play === true) told = true; return null; };
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (!String(url).startsWith('/api/engine/grains')) return realFetch(url, opts);
      return new Response(JSON.stringify({
        playing: told && !ended, position: 4800, sampleRate: 48000, latency: 0, spectrum: [], waveform: [], rackLevels: [],
      }), { status: 200 });
    };
    try {
      startPlayback();
      for (let i = 0; i < 400 && !posts.some((p) => p.play === true); i++) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 300));
      const playing = { host: engine.playing, page: seqFrame().contentWindow.eval('isPlaying') };
      // The engine reaches the end of the sound and stops itself.
      ended = true;
      await new Promise((r) => setTimeout(r, 400));
      return {
        playing,
        host: engine.playing,
        page: seqFrame().contentWindow.eval('isPlaying'),
        routed: seqFrame().contentWindow.seqBridge.routeState().on,
        cue: posts.some((p) => p.seek !== undefined),
      };
    } finally {
      window.fetch = realFetch;
    }
  });
  expect(got.playing, 'it never got going').toEqual({ host: true, page: true });
  expect(got.host).toBe(false);
  expect(got.page, 'the sequencer played on past the end of the sound').toBe(false);
  expect(got.routed, 'the page went on sending to the engine').toBe(false);
  expect(got.cue, 'the transport did not go back to the cue').toBe(true);
});

test('routed, the room is drawn from the engine\'s feed as it is', async ({ page }) => {
  await enterSeq(page);
  const got = await page.evaluate(() => {
    enginePost = async () => null;
    seq.feed = { playing: true, spectrum: [-20, -60, -96], lissajous: [0.8, -0.8], rms: 0.3, peak: 0.8, rate: 48000 };
    seq.feedAt = performance.now();
    const r = { live: true, lo: 20, hi: 20000, spectrum: [-20, -20, -96], lissajous: [0.5, -0.5] };
    seq.routed = true;
    const routed = masterFeed(r, 3) === r;
    setSource('grain', false);
    const routedGrainOff = masterFeed(r, 3) === r;
    seq.routed = false;
    const alone = masterFeed(r, 3).spectrum;
    setSource('grain', true);
    const both = masterFeed(r, 3).spectrum;
    seq.feed = null;
    return { routed, routedGrainOff, alone, both };
  });
  expect(got.routed, 'the sequencer was added to a feed it is already in').toBe(true);
  expect(got.routedGrainOff, 'GRAIN off left out a feed the sequencer is in').toBe(true);
  expect(got.alone).toEqual([-20, -60, -96]);
  expect(got.both[0]).toBeCloseTo(-20 + 10 * Math.log10(2), 3);
});
