// The scale sequencer, in a frame, on the engine's transport.
//
// Three things have to hold: the sequencer is served whole from this binary
// and reachable from the rail; the engine's play and stop reach it through the
// frame; and its sound comes back as a feed the room can mix. The synth
// itself is its own program with its own repository — nothing here tests a
// knob.

import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
}

test('the sequencer is served from the binary, with the bridge and nothing missing', async ({ page, request }) => {
  const html = await request.get('/sequencer/');
  expect(html.status()).toBe(200);
  const text = await html.text();
  expect(text).toContain('SCALE SEQ');
  expect(text, 'the bridge is not in the vendored page').toContain('bridge.js');
  for (const f of ['app.js', 'performance.js', 'bridge.js', 'style.css', 'presets.json']) {
    const r = await request.get(`/sequencer/${f}`);
    expect(r.status(), `/sequencer/${f}`).toBe(200);
  }
  await ready(page);
});

test('Seq is a workspace on the rail, and the frame loads when it is entered', async ({ page }) => {
  await ready(page);
  const btn = page.locator('#leftRail [data-mode="seq"]');
  await expect(btn).toBeVisible();
  // Not loaded until asked for: a session that never opens the sequencer
  // never starts its audio context.
  expect(await page.evaluate(() => $('seqFrame').getAttribute('src'))).toBeNull();
  await btn.click();
  await expect(page.locator('#seqView')).toBeVisible();
  await expect(page.locator('#lane')).toBeHidden();
  // The transport is the document's, and Seq plays the document.
  await expect(page.locator('#transportBar')).toBeVisible();
  expect(await page.evaluate(() => $('modeLabel').textContent)).toBe('Seq');
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const frame = page.frames().find((f) => f.url().includes('/sequencer/'));
  expect(frame, 'the frame did not load').toBeTruthy();
  expect(await frame.evaluate(() => typeof togglePlay === 'function' && typeof isPlaying === 'boolean')).toBe(true);
});

test('the engine\'s play and stop reach the sequencer', async ({ page }) => {
  await ready(page);
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const frame = page.frames().find((f) => f.url().includes('/sequencer/'));
  expect(await frame.evaluate(() => isPlaying)).toBe(false);
  // Driven the way the transport drives it, without needing a sound card: the
  // message is what the transport sends, and the sequencer's answer is the
  // thing under test.
  await page.evaluate(() => seqSync(true));
  await page.waitForTimeout(300);
  expect(await frame.evaluate(() => isPlaying), 'play did not reach the frame').toBe(true);
  // And the feed comes back while it plays.
  await page.waitForFunction(() => seq.feed && seq.feed.playing === true, { timeout: 5_000 });
  const feed = await page.evaluate(() => ({
    bands: seq.feed.spectrum.length,
    pairs: seq.feed.lissajous.length / 2,
    top: Math.max(...seq.feed.spectrum),
  }));
  expect(feed.bands).toBeGreaterThan(8);
  expect(feed.pairs).toBeGreaterThan(64);
  expect(feed.top).toBeLessThanOrEqual(0);
  await page.evaluate(() => seqSync(false));
  await page.waitForTimeout(300);
  expect(await frame.evaluate(() => isPlaying), 'stop did not reach the frame').toBe(false);
});

test('the mix adds the two spectra as power and clips the figure at the rails', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    seq.feed = { playing: true, spectrum: [-20, -60, -96], lissajous: [0.8, -0.8, 0.1, 0.1], rms: 0.3, peak: 0.8, rate: 48000 };
    seq.feedAt = performance.now();
    const engine = { live: true, lo: 20, hi: 20000, spectrum: [-20, -20, -96], lissajous: [0.5, -0.5, 0.1, 0.1] };
    const mixed = seqMix(engine, 3);
    const alone = seqMix(null, 3);
    seq.feed = null;
    return { mixed, alone };
  });
  // Equal levels add to six decibels louder; a quiet voice adds nothing audible.
  expect(got.mixed.spectrum[0]).toBeCloseTo(-20 + 10 * Math.log10(2), 3);
  expect(got.mixed.spectrum[1]).toBeCloseTo(-20, 1);
  expect(got.mixed.lissajous[0], 'the figure clips at the rail').toBe(1);
  expect(got.mixed.lissajous[1]).toBe(-1);
  expect(got.mixed.lissajous[2]).toBeCloseTo(0.2, 6);
  // With the engine silent the sequencer's feed stands in whole.
  expect(got.alone.live).toBe(true);
  expect(got.alone.spectrum).toEqual([-20, -60, -96]);
  expect(got.alone.left.vu).toBe(0.3);
});

async function enterSeq(page) {
  await ready(page);
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  return page.frames().find((f) => f.url().includes('/sequencer/'));
}

test('play lands the sequencer on the engine\'s position, and a seek moves it', async ({ page }) => {
  const frame = await enterSeq(page);
  // 120 BPM, eighth notes, eight steps: a step is a quarter of a second.
  await frame.evaluate(() => { bpm = 120; stepBeats = 0.5; numSteps = 8; direction = 'fwd'; });
  // The engine says it is 3.6 s in. The step at 3.5 s is the fourteenth; the
  // next boundary is 3.75 s, a tenth and a half away, and the step that
  // sounds there is the fifteenth — step seven of eight.
  await page.evaluate(() => {
    playbackTime = () => 3.6;
    seqSync(true);
  });
  await page.waitForTimeout(300);
  // Read from what the locate decided, not from the step counter: the
  // scheduler moves that on within a tenth of a second of any locate.
  const got = await frame.evaluate(() => ({
    playing: isPlaying, last: seqBridge.last, predicted: +seqBridge.predicted().toFixed(2),
  }));
  expect(got.playing).toBe(true);
  expect(got.last.at).toBe(3.6);
  expect(got.last.step).toBe(7);
  expect(got.last.wait).toBeCloseTo(0.15, 5);
  expect(got.predicted).toBeGreaterThan(3.5);
  // A seek: the engine is now 10.0 s in. Step forty-one is the next; forty-one
  // mod eight is one.
  // The clock message the transport loop sends; the engine itself is not
  // playing in a test with no sound card, so it is posted as the loop would.
  await page.evaluate(() => seqPost({ type: 'seq:clock', playing: true, at: 10.0 }));
  await page.waitForTimeout(200);
  const after = await frame.evaluate(() => ({ last: seqBridge.last, predicted: +seqBridge.predicted().toFixed(1) }));
  expect(after.last.at).toBe(10.0);
  expect(after.last.step).toBe(1);
  expect(after.last.wait).toBeCloseTo(0.25, 5);
  expect(after.predicted).toBeCloseTo(10.2, 0);
  // A clock that is only a few milliseconds off is left alone.
  await page.evaluate(() => seqPost({ type: 'seq:clock', playing: true, at: 10.21 }));
  await page.waitForTimeout(50);
  const left = await frame.evaluate(() => seqBridge.last.at);
  expect(left, 'a clock a few milliseconds out re-laid the grid').toBe(10.0);
  await page.evaluate(() => seqSync(false));
  await page.waitForTimeout(200);
  expect(await frame.evaluate(() => isPlaying)).toBe(false);
});

test('the sequencer\'s own take replays with the engine\'s transport, from its position', async ({ page }) => {
  const frame = await enterSeq(page);
  await frame.evaluate(() => {
    // A take: the cutoff swept up over the first two seconds, and a switch
    // thrown at three.
    perfLoaded = {
      id: 'spec', name: 'spec take', created: 0, generated: false, duration: 12,
      wasPlaying: true, snapshot: getPresetState(),
      gestures: [
        { kind: 'slider', id: 'cutoffSlider', t0: 0.5, t1: 2.0, points: [[0.5, 20], [2.0, 90]], gen: false },
        { kind: 'discrete', type: 'select', id: 'waveSelect', t: 3.0, v: 'square', gen: false },
      ],
    };
  });
  // Play from five seconds in: both gestures are behind us and are applied at once.
  await page.evaluate(() => { playbackTime = () => 5.0; seqSync(true); });
  await page.waitForTimeout(300);
  const got = await frame.evaluate(() => ({
    replaying: !!perfReplay,
    head: perfReplay ? +perfReplay.playheadT.toFixed(1) : null,
    cutoff: +document.getElementById('cutoffSlider').value,
    wave: document.getElementById('waveSelect').value,
    btn: document.getElementById('perfPlayBtn').textContent.trim(),
  }));
  expect(got.replaying, 'the take did not start with the transport').toBe(true);
  expect(got.head).toBeGreaterThanOrEqual(5.0);
  expect(got.cutoff, 'a gesture already behind the position was not applied').toBe(90);
  expect(got.wave).toBe('square');
  expect(got.btn).toBe('⏸ PLAYING');
  await page.evaluate(() => seqSync(false));
  await page.waitForTimeout(200);
  expect(await frame.evaluate(() => !!perfReplay), 'the take did not stop with the transport').toBe(false);
});

test('the sequencer renders itself for a film: sound, spectrum and figure, and the page gets its context back', async ({ page }) => {
  const frame = await enterSeq(page);
  const got = await page.evaluate(async () => {
    // Through the same request the film makes.
    const r = await seqRenderForFilm({ at0: 0, seconds: 1.5, rate: 48000, fps: 30, bands: 32, lo: 20, hi: 20000, liss: 64 });
    if (!r) return { none: true };
    let loud = 0;
    for (let i = 0; i < r.left.length; i++) loud = Math.max(loud, Math.abs(r.left[i]), Math.abs(r.right[i]));
    let top = -200;
    for (let i = 0; i < r.spectra.length; i++) top = Math.max(top, r.spectra[i]);
    return {
      rate: r.rate, frames: r.frames, samples: r.left.length,
      spectra: r.spectra.length, liss: r.liss.length, lissN: r.lissN, bands: r.bands,
      loud, top,
    };
  });
  expect(got.none, 'the frame did not answer').toBeFalsy();
  expect(got.rate).toBe(48000);
  expect(got.frames).toBe(45);
  expect(got.samples).toBe(72000);
  expect(got.spectra).toBe(45 * 32);
  expect(got.liss).toBe(45 * 64 * 2);
  expect(got.loud, 'the render is silent — the pattern did not sound').toBeGreaterThan(0.01);
  expect(got.top, 'the spectrum is empty').toBeGreaterThan(-96);
  // The page has its own context back and can still play.
  const after = await frame.evaluate(() => ({
    ctx: audioCtx && audioCtx.constructor.name, playing: isPlaying, state: audioCtx.state,
  }));
  expect(after.ctx).toBe('AudioContext');
  expect(after.playing).toBe(false);
  expect(after.state).not.toBe('closed');
  await page.evaluate(() => seqSync(true));
  await page.waitForTimeout(200);
  expect(await frame.evaluate(() => isPlaying)).toBe(true);
  await page.evaluate(() => seqSync(false));
});

test('a film mixes the two spectra as power and the two figures as samples, per frame', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    const a = new Float32Array([-20, -40, -96]);
    seqMixSpectrum(a, new Float32Array([-20, -96, -20]));
    const l = new Float32Array([0.8, -0.8, 0.1]);
    seqMixLiss(l, new Float32Array([0.5, -0.5, 0.1]));
    return { a: [...a].map((v) => +v.toFixed(2)), l: [...l].map((v) => +v.toFixed(2)) };
  });
  expect(got.a[0]).toBeCloseTo(-16.99, 1);
  expect(got.a[1]).toBeCloseTo(-40, 1);
  expect(got.a[2]).toBeCloseTo(-20, 1);
  expect(got.l).toEqual([1, -1, 0.2]);
});

// The sequencer's recorder arms the same way: REC PERF waits, the engine's
// Play begins the take, its stop ends it.
test('the sequencer\'s REC PERF arms, and the engine\'s transport starts and ends the take', async ({ page }) => {
  const frame = await enterSeq(page);
  await frame.evaluate(() => { if (isPlaying) stopSeq(); perfToggleRec(); });
  const armed = await frame.evaluate(() => ({
    armed: perfArmed, rec: !!perfRec, playing: isPlaying,
    btn: document.getElementById('perfRecBtn').textContent.trim(),
  }));
  expect(armed.armed, 'REC PERF did not arm').toBe(true);
  expect(armed.rec, 'the take began before Play').toBe(false);
  expect(armed.playing, 'arming started the sequencer').toBe(false);
  expect(armed.btn).toBe('⏺ ARMED');
  await page.evaluate(() => { playbackTime = () => 0; seqSync(true); });
  await page.waitForTimeout(300);
  const taking = await frame.evaluate(() => ({ armed: perfArmed, rec: !!perfRec, playing: isPlaying, btn: document.getElementById('perfRecBtn').textContent.trim() }));
  expect(taking.playing).toBe(true);
  expect(taking.rec, 'the engine\'s Play did not begin the take').toBe(true);
  expect(taking.armed).toBe(false);
  expect(taking.btn).toBe('⏺ CAPTURING');
  await page.evaluate(() => seqSync(false));
  await page.waitForTimeout(300);
  const ended = await frame.evaluate(() => ({ rec: !!perfRec, playing: isPlaying, btn: document.getElementById('perfRecBtn').textContent.trim() }));
  expect(ended.playing).toBe(false);
  expect(ended.rec, 'the stop did not end the take').toBe(false);
  expect(ended.btn).toBe('⏺ REC PERF');
  // Armed and pressed again: disarmed, nothing kept.
  await frame.evaluate(() => { perfToggleRec(); perfToggleRec(); });
  expect(await frame.evaluate(() => perfArmed)).toBe(false);
});
