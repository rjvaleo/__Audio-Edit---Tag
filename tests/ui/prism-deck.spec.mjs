// The Prism deck: the Prism page plays a sound of its own, apart from the
// grain engine (RJ, 6 Nov 2026: "make each like effect its own instance so
// that the hyperprism panel can have its own sound loaded, and it runs
// independently of the grain engine"). See `engine/src/decks.rs`.
//
// What this pins:
//   - the page has its own sound picker, waveform and transport;
//   - choosing a sound loads it into the Prism deck, not the grain engine;
//   - the pad, the Pitch Time Changer, the chain and the faders all go to the
//     Prism deck and its own document (`prism:<sound>`), and the grain
//     document's stretch and rack are untouched.
//
// Loading a sound opens the audio device, which the scratch server must never
// do, so `/api/prism/load` and `/api/prism/state` are answered here.

import { test, expect } from './test.mjs';

async function openPrism(page) {
  const sent = [];
  await page.route('**/api/prism/load**', (route) => {
    const p = new URL(route.request().url()).searchParams.get('p');
    route.fulfill({ json: { path: p, frames: 96000, sampleRate: 48000 } });
  });
  await page.route('**/api/prism/state**', (route) => route.fulfill({ json: { path: '', playing: false, position: 0, inFrames: 96000, sampleRate: 48000 } }));
  page.on('request', (r) => {
    if (r.method() === 'POST') sent.push({ url: r.url(), body: r.postData() ? (() => { try { return JSON.parse(r.postData()); } catch { return null; } })() : null });
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  const files = await page.evaluate(async () => {
    try { for (const k of Object.keys(localStorage)) if (/^(hyperstretch|prism\.)/.test(k)) localStorage.removeItem(k); } catch {}
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await postJSON('/api/rack', { p: files[0].path, sr: 44100, slots: [] });
    await postJSON('/api/rack', { p: `prism:${files[1].path}`, sr: 44100, slots: [] });
    await selectFile(files[0]);
    setMode('edit');
    return files.map((f) => f.path);
  });
  await page.locator('#leftRail .rl-item[data-page="prism"]').click();
  await expect(page.locator('#hsPad')).toBeVisible();
  return { sent, files };
}

const posted = (sent, path) => sent.filter((s) => new URL(s.url).pathname === path);

test('the page has a sound, a waveform and a transport of its own', async ({ page }) => {
  await openPrism(page);
  for (const id of ['prismSoundFolder', 'prismSoundFile', 'prismWave', 'prismDeckPlay', 'prismDeckStop', 'prismDeckLoop']) {
    await expect(page.locator(`#dockHyper #${id}`)).toBeVisible();
  }
  await expect(page.locator('#prismSoundName')).toContainText('No sound');
});

test('choosing a sound loads it into the Prism deck, not the grain engine', async ({ page }) => {
  const { sent, files } = await openPrism(page);
  await page.locator('#prismSoundFile').selectOption(files[1]);
  await expect(page.locator('#prismSoundName')).toContainText(files[1].split('/').pop());
  const loads = sent.filter((s) => /\/api\/prism\/load/.test(s.url));
  expect(loads.length).toBe(1);
  expect(new URL(loads[0].url).searchParams.get('p')).toBe(files[1]);
  expect(sent.filter((s) => /\/api\/engine\/load/.test(s.url))).toHaveLength(0);
  expect(await page.evaluate(() => state.selectedFile.path)).toBe(files[0]);
  expect(await page.evaluate(() => window.prismDeck.path())).toBe(files[1]);
});

test('the pad moves the Prism deck\'s stretch and leaves the grain document\'s alone', async ({ page }) => {
  const { sent, files } = await openPrism(page);
  await page.locator('#prismSoundFile').selectOption(files[1]);
  const before = await page.evaluate(() => ({ ...state.stretchDraft }));
  const b = await page.locator('#hsPad').boundingBox();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.9, b.y + b.height * 0.1, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const pads = posted(sent, '/api/engine/pad');
  expect(pads.length).toBeGreaterThan(0);
  expect(pads.every((s) => s.body?.deck === 'prism')).toBe(true);
  expect(posted(sent, '/api/prism/stretch').length).toBeGreaterThan(0);
  const after = await page.evaluate(() => ({ ...state.stretchDraft }));
  expect(after.ratio).toBe(before.ratio);
  expect(after.semitones).toBe(before.semitones);
  const glides = posted(sent, '/api/engine/glide');
  expect(glides.every((s) => s.body?.deck === 'prism')).toBe(true);
  expect(await page.evaluate(() => window.prismDeck.stretch().ratio)).not.toBe(before.ratio);
});

test('the Pitch Time Changer and the faders go to the Prism deck', async ({ page }) => {
  const { sent, files } = await openPrism(page);
  await page.locator('#prismSoundFile').selectOption(files[1]);
  await page.locator('#prismSource').selectOption('ptc');
  await page.locator('#prismPtcOn').click();
  await page.waitForTimeout(200);
  const ptc = posted(sent, '/api/pitchtime');
  expect(ptc.length).toBeGreaterThan(0);
  expect(ptc.every((s) => s.body?.p === `prism:${files[1]}`)).toBe(true);
  await page.locator('#prismFaderZeroL').click();
  await page.waitForTimeout(200);
  const tr = posted(sent, '/api/engine/transport');
  expect(tr.length).toBeGreaterThan(0);
  expect(tr.every((s) => s.body?.deck === 'prism')).toBe(true);
});

test('the Prism chain is its own: an effect added there is not in the FX tab\'s rack', async ({ page }) => {
  const { sent, files } = await openPrism(page);
  await page.locator('#prismSoundFile').selectOption(files[1]);
  const kind = await page.evaluate(() => [...document.querySelectorAll('#prismChainAdd option')].map((o) => o.value).find((v) => v.startsWith('prism:')));
  await page.locator('#prismChainAdd').selectOption(kind);
  await expect(page.locator('#prismChain .prism-chain-slot')).toHaveCount(1);
  const racks = posted(sent, '/api/rack').filter((s) => s.body?.p === `prism:${files[1]}`);
  expect(racks.length).toBeGreaterThan(0);
  expect(racks.at(-1).body.slots.map((s) => s.kind)).toEqual([kind]);
  expect(await page.evaluate(() => state.rack.slots.length)).toBe(0);
  // And it is on the pad's menu, as a slot of the grain rack was.
  await expect(page.locator('#prismSource option')).toHaveCount(3);
  await page.locator('#prismChain .prism-chain-slot button[aria-label^="Remove"]').click();
  await expect(page.locator('#prismChain .prism-chain-slot')).toHaveCount(0);
});

test('play, stop and loop are the Prism deck\'s', async ({ page }) => {
  const { sent, files } = await openPrism(page);
  await page.locator('#prismSoundFile').selectOption(files[1]);
  await page.locator('#prismDeckPlay').click();
  await page.locator('#prismDeckLoop').click();
  await page.locator('#prismDeckStop').click();
  await page.waitForTimeout(200);
  const tr = posted(sent, '/api/engine/transport').map((s) => s.body);
  expect(tr.every((b) => b.deck === 'prism')).toBe(true);
  expect(tr.some((b) => b.play === true)).toBe(true);
  expect(tr.some((b) => b.loop && b.loop.on === true)).toBe(true);
  expect(tr.some((b) => b.play === false && b.seek === 0)).toBe(true);
  expect(await page.evaluate(() => engine.playing)).toBe(false);
});
