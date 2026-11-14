// SoundHack's version choice on the Stretch panel.
//
// One control, and it has three things to get right: it is there only when
// SoundHack is the engine, it sits with the engine's own controls as a
// two-way choice like WSOLA's Pick, and a click reaches the document. And the
// sixth engine tile has to fit the row the other five are on.

import { test, expect } from './test.mjs';

async function openStretchPanel(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, null, { timeout: 20_000 });
  await page.evaluate(() => showPane('right', 'stretch'));
  await page.waitForTimeout(500);
}

async function choose(page, alg) {
  await page.evaluate((a) => document.querySelector(`#stretchEngine .seg-btn[data-alg="${a}"]`).click(), alg);
  await page.waitForFunction((a) => state.edit?.stretch?.algorithm === a, alg);
  await page.waitForTimeout(200);
}

const row = (page) => page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const ver = document.querySelector('.engine-params [data-glyph="shVersion"]');
  const pick = (alg) => box(document.querySelector(`#stretchEngine .seg-btn[data-alg="${alg}"]`));
  return {
    ver: box(ver),
    halves: ver ? [...ver.querySelectorAll('.seg-btn')].map((b) => [b.textContent, b.classList.contains('active'), box(b)]) : [],
    fits: ver ? [...ver.querySelectorAll('.seg-btn')].every((b) => b.scrollWidth <= b.clientWidth) : null,
    window: box(state.stretchRows?.windowMs),
    tiles: ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular', 'soundhack'].map(pick),
  };
});

test('the version choice is SoundHack\'s alone, under the core sliders, in halves', async ({ page }) => {
  await openStretchPanel(page);
  for (const alg of ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular']) {
    await choose(page, alg);
    expect((await row(page)).ver, `${alg} shows the SoundHack choice`).toBeNull();
  }
  await choose(page, 'soundhack');
  const r = await row(page);
  expect(r.ver).not.toBeNull();
  // Below Window, the last of the three core sliders, as every engine's own
  // controls are; two buttons of one size on one line, labels whole.
  expect(r.ver.y).toBeGreaterThan(r.window.y);
  expect(r.halves.map(([t, on]) => [t, on])).toEqual([['0.888', false], ['0.896', true]]);
  const [a, b] = r.halves.map(([, , x]) => x);
  expect(a.y).toBe(b.y);
  expect(a.h).toBe(b.h);
  expect(Math.abs(a.w - b.w)).toBeLessThanOrEqual(1);
  expect(r.fits, 'a version label is cut off').toBe(true);
  // Six engine tiles, one row. "SoundHack" is the longest name and is not
  // shortened, so its tile is allowed the two pixels wider it needs.
  const ys = new Set(r.tiles.map((t) => t.y)), ws = r.tiles.map((t) => t.w);
  expect(ys.size, 'the engine tiles wrapped onto a second row').toBe(1);
  expect(Math.max(...ws) - Math.min(...ws)).toBeLessThanOrEqual(3);
  const named = await page.evaluate(() => [...document.querySelectorAll('#stretchEngine .seg-btn span')].every((s) => s.scrollWidth <= s.clientWidth + 1));
  expect(named, 'an engine name is cut off').toBe(true);
});

test('a click on the choice reaches the document, and survives a change of engine', async ({ page }) => {
  await openStretchPanel(page);
  await choose(page, 'soundhack');
  await page.click('.engine-params [data-glyph="shVersion"] .seg-btn:has-text("0.888")');
  await page.waitForFunction(() => state.edit?.stretch?.soundhack?.version === '0.888');

  await choose(page, 'vocoder');
  await choose(page, 'soundhack');
  expect(await page.evaluate(() => state.edit.stretch.soundhack.version)).toBe('0.888');
  expect((await row(page)).halves.map(([t, on]) => [t, on])).toEqual([['0.888', true], ['0.896', false]]);

  await page.click('.engine-params [data-glyph="shVersion"] .seg-btn:has-text("0.896")');
  await page.waitForFunction(() => state.edit?.stretch?.soundhack?.version === '0.896');
});
