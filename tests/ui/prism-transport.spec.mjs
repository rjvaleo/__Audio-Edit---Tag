// One transport (RJ, 11 Nov 2026): on the Prism page the Now Playing bar drives
// the Prism deck, and leaving the page hands it back to the main sound.
//
// What this pins:
//   - on Prism, the bar's play, stop, loop and strip go to the Prism deck
//     (`deck: 'prism'`), never to the main sound;
//   - the bar's clock, head and name follow the Prism deck;
//   - GRAIN, SEQ and the tempo, the main sound's, are out of the bar there;
//   - on Grain afterwards, the same buttons act on the main sound again.
//
// Nothing here reaches the engine: the transport, the loads and the Prism
// deck's state are answered here, so the scratch server never opens a device.

import { test, expect } from './test.mjs';

async function open(page) {
  const sent = [];
  const deck = { playing: false, position: 0 };
  await page.route('**/api/prism/load**', (route) => {
    const p = new URL(route.request().url()).searchParams.get('p');
    route.fulfill({ json: { path: p, frames: 96000, sampleRate: 48000 } });
  });
  await page.route('**/api/prism/state**', (route) => route.fulfill({ json: { path: '', ...deck, inFrames: 96000, sampleRate: 48000 } }));
  // The Prism deck, as far as its state says: what the bar told it.
  await page.route('**/api/engine/transport', (route) => {
    let b = null;
    try { b = JSON.parse(route.request().postData()); } catch { /* not JSON */ }
    if (b?.deck === 'prism') {
      if (typeof b.play === 'boolean') deck.playing = b.play;
      if (typeof b.seek === 'number') deck.position = b.seek;
    }
    route.fulfill({ json: {} });
  });
  await page.route('**/api/engine/load**', (route) => route.fulfill({ json: { sampleRate: 48000, frames: 44100 } }));
  page.on('request', (r) => {
    if (r.method() !== 'POST' || new URL(r.url()).pathname !== '/api/engine/transport') return;
    try { sent.push(JSON.parse(r.postData())); } catch { /* not JSON */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  const files = await page.evaluate(async () => {
    try { for (const k of Object.keys(localStorage)) if (/^(hyperstretch|prism\.)/.test(k)) localStorage.removeItem(k); } catch {}
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await postJSON('/api/rack', { p: `prism:${files[1].path}`, sr: 44100, slots: [] });
    await selectFile(files[0]);
    setMode('edit');
    return files.map((f) => f.path);
  });
  await page.locator('#leftRail .rl-item[data-page="prism"]').click();
  await expect(page.locator('#hsPad')).toBeVisible();
  await page.locator('#prismSoundFile').selectOption(files[1]);
  await expect(page.locator('#nbName')).toHaveText(files[1].split('/').pop());
  return { sent, deck, files };
}

/// Click the bar's strip at `u` of its width.
async function stripAt(page, u) {
  const b = await page.locator('#nbStrip').boundingBox();
  await page.mouse.click(b.x + b.width * u, b.y + b.height / 2);
}

test('on Prism the bar plays, stops, loops and seeks the Prism deck', async ({ page }) => {
  const { sent, deck } = await open(page);
  sent.length = 0;

  await page.locator('#nowBar #playBtn').click();
  await expect(page.locator('#playBtn')).toHaveAttribute('aria-label', 'Pause');
  await page.locator('#nowBar #loopBtn').click();
  await expect(page.locator('#loopBtn')).toHaveClass(/\bon\b/);
  await stripAt(page, 0.25);
  await page.locator('#nowBar #playBtn').click();
  await expect(page.locator('#playBtn')).toHaveAttribute('aria-label', 'Play');
  await page.locator('#nowBar #stopBtn').click();
  await page.waitForTimeout(200);

  expect(sent.length).toBeGreaterThan(0);
  expect(sent.every((b) => b.deck === 'prism'), JSON.stringify(sent)).toBe(true);
  expect(sent.some((b) => b.play === true)).toBe(true);
  expect(sent.some((b) => b.loop?.on === true)).toBe(true);
  // A quarter of the way through the sound, in the deck's output frames.
  const seek = sent.find((b) => b.seek > 0);
  expect(Math.abs(seek.seek - 24000)).toBeLessThan(1200);
  // Pause stays where it is; stop goes back to the start.
  expect(sent.some((b) => b.play === false && b.seek === undefined)).toBe(true);
  expect(sent.at(-1)).toMatchObject({ play: false, seek: 0 });
  expect(await page.evaluate(() => engine.playing)).toBe(false);
  expect(await page.evaluate(() => state.loopOn)).toBe(false);

  // The clock and the head follow the deck.
  deck.playing = true; deck.position = 48000;
  await expect(page.locator('#timeNow')).toHaveText(/00:01\.000/);
  await expect(page.locator('#playBtn')).toHaveAttribute('aria-label', 'Pause');
  expect(await page.locator('#nbHead').evaluate((e) => e.style.left)).toBe('50%');
  deck.playing = false;

  // The main sound's GRAIN, SEQ and tempo are out of the bar here.
  await expect(page.locator('#srcGrain')).toBeHidden();
  await expect(page.locator('#srcSeq')).toBeHidden();
  await expect(page.locator('#nbBpm')).toBeHidden();
});

test('on Grain, after Prism, the bar is the main sound\'s again', async ({ page }) => {
  const { sent, files } = await open(page);
  // Leave Prism with its deck looping, so the hand-back has something to undo.
  await page.locator('#nowBar #loopBtn').click();
  await page.locator('#leftRail .rl-item[data-page="grain"]').click();
  await expect(page.locator('body')).not.toHaveClass(/prismpage/);
  await expect(page.locator('#nbName')).toHaveText(files[0].split('/').pop());
  await expect(page.locator('#loopBtn')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#srcGrain')).toBeVisible();
  await expect(page.locator('#nbBpm')).toBeVisible();
  sent.length = 0;

  await page.locator('#nowBar #loopBtn').click();
  await expect(page.locator('#loopBtn')).toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => state.loopOn)).toBe(true);
  const cue = await page.evaluate(() => state.cue);
  await stripAt(page, 0.5);
  expect(await page.evaluate(() => state.cue)).not.toBe(cue);
  await page.locator('#nowBar #playBtn').click();
  // The engine may stop itself at once: the scratch server is playing nothing.
  await expect.poll(() => sent.some((b) => b.play === true)).toBe(true);
  await page.locator('#nowBar #stopBtn').click();
  await page.waitForTimeout(200);

  expect(sent.length).toBeGreaterThan(0);
  expect(sent.some((b) => b.deck === 'prism'), JSON.stringify(sent)).toBe(false);
  expect(sent.some((b) => b.loop?.on === true)).toBe(true);
  expect(sent.some((b) => b.play === true)).toBe(true);
  expect(sent.some((b) => b.play === false)).toBe(true);
  expect(await page.evaluate(() => engine.playing)).toBe(false);
  // The Prism deck was left as it was.
  expect(await page.evaluate(() => prismDeck.loop)).toBe(true);
});
