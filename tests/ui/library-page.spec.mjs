// The Library page (RJ, 16 Nov 2026: "after clone, let's do library … bring in
// the library that's running on the PC controller server"; built 18 Nov).
//
// The PC's own sounds, by the words that made them. The PC is not reached
// here: its index, a sound's audio and the copy into `Made/PC/` are answered
// by the test, so what is proved is the page: the list, the tiles, the detail,
// what is asked of the server, and that it is one fixed size.

import { test, expect } from './test.mjs';

const ROWS = [
  { file: 'sounds/2026-11-14/analog-snare-1.flac', kind: 'sounds', time: '2026-11-14T22:00:14.443Z', prompt: 'analog snare with long tail', seed: 1, model: 'stable-audio-open-small', seconds: 2, type: 'hit' },
  { file: 'sounds/2026-11-14/analog-snare-2.flac', kind: 'sounds', time: '2026-11-14T22:00:20.000Z', prompt: 'analog snare with long tail', seed: 2, model: 'stable-audio-open-small', seconds: 2, type: 'hit' },
  { file: 'sounds/2026-11-16/field-22068.flac', kind: 'sounds', time: '2026-11-16T21:04:25.551Z', prompt: 'Random Field Recording', seed: 22068, model: 'stable-audio-open-small', seconds: 8, type: 'loop' },
  { file: 'sounds/2026-11-15/dub-chord-7.flac', kind: 'sounds', time: '2026-11-15T10:00:00.000Z', prompt: 'dub chord stab', seed: 7, model: 'tangoflux', seconds: 4, type: 'hit' },
];

/// A short mono 16-bit WAV: a decaying tone, so the picture has a shape.
function wav() {
  const rate = 8000, n = 4000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i * 0.3) * Math.exp(-i / 900) * 30000), 44 + i * 2);
  return b;
}

async function open(page, { rows = ROWS, fail = false } = {}) {
  const asked = { audio: [], fetch: [] };
  await page.route('**/api/pc/library', (route) => (fail ? route.fulfill({ status: 502, body: 'the PC is off' }) : route.fulfill({ json: rows })));
  await page.route('**/api/pc/audio**', (route) => {
    asked.audio.push(new URL(route.request().url()).searchParams.get('file'));
    route.fulfill({ contentType: 'audio/wav', body: wav() });
  });
  await page.setViewportSize({ width: 1720, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.locator('#leftRail .rl-item[data-mode="pclib"]').click();
  await expect(page.locator('#libraryView')).toBeVisible();
  return asked;
}

test('Library is on the rail after Clone, and lists the PC\'s sounds by their words', async ({ page }) => {
  await open(page);
  const rail = await page.locator('#leftRail .rl-item').evaluateAll((els) => els.map((e) => e.dataset.mode + (e.dataset.page ? ':' + e.dataset.page : '')));
  expect(rail.indexOf('pclib')).toBe(rail.indexOf('clone') + 1);
  await expect(page.locator('#modeLabel')).toHaveText('Library');
  // Your own library's drawer is shut: the page has the whole width.
  await expect(page.locator('#leftPanel')).toHaveClass(/drawer-closed/);
  await expect(page.locator('#lbSync')).toHaveText(/CONNECTED/);
  await expect(page.locator('#lbCount')).toHaveText('4 SOUNDS');
  // Three prompts, in order of their words; the first is open, with its two sounds.
  await expect(page.locator('.lb-grp')).toHaveCount(3);
  await expect(page.locator('.lb-grp span').first()).toHaveText('analog snare with long tail');
  await expect(page.locator('.lb-grp.on')).toHaveCount(1);
  await expect(page.locator('.lb-tile')).toHaveCount(2);
  await expect(page.locator('#lbGMeta')).toHaveText('2 sounds');
  // The detail is the first sound's.
  await expect(page.locator('#lbDPrompt')).toHaveText('analog snare with long tail');
  await expect(page.locator('#lbDSeed')).toHaveText('1');
  await expect(page.locator('#lbDModel')).toHaveText('Stable Audio Open Small');
  await expect(page.locator('#lbDFile')).toHaveText('analog-snare-1.flac');
  await expect(page.locator('#lbDPill .lb-pill')).toHaveText('HIT');
});

test('Hits and Loops, Newest and the search narrow and order the prompts', async ({ page }) => {
  await open(page);
  await page.locator('#lbKind [data-k="loop"]').click();
  await expect(page.locator('.lb-grp')).toHaveCount(1);
  await expect(page.locator('.lb-grp span')).toHaveText('Random Field Recording');
  await expect(page.locator('#lbCount')).toHaveText('1 SOUNDS');
  await page.locator('#lbKind [data-k=""]').click();
  await page.locator('#lbOrder [data-k="new"]').click();
  await expect(page.locator('.lb-grp span').first()).toHaveText('Random Field Recording');
  await page.locator('#lbQ').fill('dub');
  await expect(page.locator('.lb-grp')).toHaveCount(1);
  await expect(page.locator('.lb-tile')).toHaveCount(1);
  await expect(page.locator('#lbDModel')).toHaveText('TangoFlux');
  await page.locator('#lbQ').fill('nothing like this');
  await expect(page.locator('.lb-empty')).toHaveText('Nothing matches.');
  await expect(page.locator('#lbDetail')).toHaveClass(/none/);
});

test('a sound\'s picture is drawn from the sound, and Play asks the PC for it', async ({ page }) => {
  const asked = await open(page);
  // Both tiles' sounds were read for their pictures, once each.
  await expect.poll(() => asked.audio.filter((f) => f === 'sounds/2026-11-14/analog-snare-1.flac').length).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => LB.peaks.get('sounds/2026-11-14/analog-snare-2.flac') instanceof Float32Array)).toBe(true);
  // Drawn: the canvas is not blank, and louder at its start than its end (a decaying tone).
  const ink = await page.evaluate(() => {
    const cv = document.querySelector('#lbDWave'), g = cv.getContext('2d');
    const col = (x0, x1) => { const d = g.getImageData(x0, 0, x1 - x0, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
    return { start: col(0, 60), end: col(cv.width - 60, cv.width) };
  });
  expect(ink.start).toBeGreaterThan(ink.end * 2);
  // Play: the page's own player on that sound; again stops it.
  await page.evaluate(() => { window.__plays = []; HTMLMediaElement.prototype.play = function () { window.__plays.push(this.src); return Promise.resolve(); }; });
  await page.locator('.lb-tile').nth(1).locator('.lb-play').click();
  await expect(page.locator('.lb-tile').nth(1)).toHaveClass(/\bon\b/);
  await expect(page.locator('.lb-tile').nth(1).locator('.lb-play')).toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => decodeURIComponent(window.__plays[0]))).toContain('/api/pc/audio?file=sounds/2026-11-14/analog-snare-2.flac');
  await expect(page.locator('#lbDSeed')).toHaveText('2');
  await page.locator('#lbDPlay').click();
  await expect(page.locator('.lb-play.on')).toHaveCount(0);
  expect(await page.evaluate(() => LB.playing)).toBe(null);
  // Leaving the page stops whatever was sounding.
  await page.locator('.lb-tile').first().locator('.lb-play').click();
  await page.locator('#leftRail .rl-item[data-mode="theme"]').click();
  expect(await page.evaluate(() => LB.playing)).toBe(null);
});

test('Copy and Open bring the sound into Made/PC; Open goes to the page asked for', async ({ page, request }) => {
  const sent = [];
  // A real sound of the scratch library stands in for the copy the server would make.
  const folders = await (await request.get('/api/folders')).json();
  const files = await (await request.get(`/api/files?folder=${encodeURIComponent(folders[0].name)}`)).json();
  await page.route('**/api/pc/fetch', (route) => { sent.push(JSON.parse(route.request().postData())); route.fulfill({ json: { p: files[0].path } }); });
  await open(page);
  await page.locator('#lbActs [data-act="copy"]').click();
  await expect(page.locator('#toast')).toHaveText(/Copied into your library/);
  expect(sent).toEqual([{ file: 'sounds/2026-11-14/analog-snare-1.flac' }]);
  await expect(page.locator('#libraryView')).toBeVisible();
  await page.locator('#lbActs [data-act="chop"]').click();
  await expect(page.locator('body')).toHaveClass(/choppage/);
  expect(await page.evaluate(() => state.selectedFile.path)).toBe(files[0].path);
  expect(sent.length).toBe(2);
  await expect(page.locator('#libraryView')).toBeHidden();
});

test('with the PC off the page says so, and Refresh asks again', async ({ page }) => {
  await open(page, { fail: true });
  await expect(page.locator('#lbSync')).toHaveText(/DID NOT ANSWER/);
  await expect(page.locator('.lb-empty')).toHaveText(/could not be read/);
  await page.unroute('**/api/pc/library');
  await page.route('**/api/pc/library', (route) => route.fulfill({ json: ROWS }));
  await page.locator('#lbRefresh').click();
  await expect(page.locator('#lbSync')).toHaveText(/CONNECTED/);
  await expect(page.locator('.lb-grp')).toHaveCount(3);
});

test('one fixed size: the same at any window, nothing clipped, type on the scale', async ({ page }) => {
  await open(page);
  const measure = () => page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    const over = [...document.querySelectorAll('#libraryView .lb-head, #libraryView .lb-ph, #libraryView .lb-r, #libraryView .lb-acts, #libraryView .lb-facts, #libraryView .lb-row')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className);
    const sizes = [...new Set([...document.querySelectorAll('#libraryView *')].filter((e) => e.childElementCount === 0 && e.textContent.trim()).map((e) => getComputedStyle(e).fontSize))];
    return { page: r('.lb-page'), cols: [...document.querySelectorAll('.lb-col')].map((c) => Math.round(c.getBoundingClientRect().width)), tile: r('.lb-tile'), over, sizes };
  });
  const big = await measure();
  expect(big.page).toEqual([1496, 760]);
  expect(big.cols).toEqual([360, 720, 400]);
  expect(big.tile).toEqual([228, 100]);
  expect(big.over).toEqual([]);
  for (const s of big.sizes) expect(['9px', '10px', '11px', '13px', '16px'], s).toContain(s);
  await page.setViewportSize({ width: 1100, height: 640 });
  const small = await measure();
  expect(small.page).toEqual(big.page);
  expect(small.cols).toEqual(big.cols);
  // The page scrolls to the rest.
  expect(await page.evaluate(() => { const v = document.querySelector('#libraryView'); return v.scrollWidth > v.clientWidth; })).toBe(true);
});
