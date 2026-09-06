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
