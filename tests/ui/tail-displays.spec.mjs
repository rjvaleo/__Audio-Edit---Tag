// After a stop, a reverb's tail goes on being heard; the meters, the spectrum
// and the effects' pictures must go on with it, not freeze on the stop. The
// engine says when anything is still leaving the bus (`sounding` in
// `/api/engine/grains`); the page keeps asking for as long as it is.
// RJ, 18 Nov 2026: "you'll stop seeing the visual and the parametric and the
// compressor and out in the spectrum, but you still hear the reverb".
import { test, expect } from '@playwright/test';

/// Stand in for the engine's poll: playing or not, sounding or not, and a
/// spectrum that changes with every answer, so a frozen display shows.
async function fakeEngine(page) {
  const engine = { playing: true, sounding: true, asked: 0 };
  await page.route('**/api/engine/grains', (route) => {
    engine.asked += 1;
    const spectrum = Array.from({ length: 64 }, (_, i) => (i * 7 + engine.asked * 13) % 255);
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ playing: engine.playing, sounding: engine.sounding, position: 0, ratio: 1, sampleRate: 48000, latency: 0,
        grains: [], spectrum, waveform: [], rackLevels: [], load: null, overflows: 0 }),
    });
  });
  return engine;
}

async function asked(page, engine, ms) {
  const before = engine.asked;
  await page.waitForTimeout(ms);
  return engine.asked - before;
}

test('after a stop, the page goes on asking for the sound while a tail is still sounding', async ({ page }) => {
  const engine = await fakeEngine(page);
  await page.goto('/');
  await page.waitForFunction(() => typeof startPolling === 'function' && typeof pausePlayback === 'function', null, { timeout: 20_000 });
  await page.evaluate(() => { engine.playing = true; startPolling(); });
  expect(await asked(page, engine, 500), 'it asks while playing').toBeGreaterThan(3);

  // The stop: the transport is off, the tail rings on.
  engine.playing = false;
  await page.evaluate(() => pausePlayback());
  expect(await asked(page, engine, 600), 'it went on asking while the tail sounded').toBeGreaterThan(3);
  const spectrumNow = await page.evaluate(() => [...engine.spectrum].join());
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => [...engine.spectrum].join()), 'the spectrum kept moving with the tail').not.toBe(spectrumNow);

  // The tail has died away: the page stops asking.
  engine.sounding = false;
  await page.waitForTimeout(300);
  expect(await asked(page, engine, 500), 'it stopped asking once nothing was sounding').toBe(0);
});

test('the output meter runs on through a tail and stops after it', async ({ page }) => {
  const engine = await fakeEngine(page);
  let master = 0;
  await page.route('**/api/engine/master**', (route) => {
    master += 1;
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ left: { vuDb: -12 }, right: { vuDb: -12 } }) });
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof nbMeterRun === 'function' && typeof pausePlayback === 'function', null, { timeout: 20_000 });
  await page.evaluate(() => { engine.playing = true; startPolling(); nbMeterRun(); });
  await page.waitForTimeout(300);
  engine.playing = false;
  await page.evaluate(() => pausePlayback());
  const during = master;
  await page.waitForTimeout(500);
  expect(master - during, 'the meter went on reading the tail').toBeGreaterThan(2);
  engine.sounding = false;
  await page.waitForTimeout(400);
  const after = master;
  await page.waitForTimeout(400);
  expect(master - after, 'the meter stopped once nothing was sounding').toBe(0);
});
