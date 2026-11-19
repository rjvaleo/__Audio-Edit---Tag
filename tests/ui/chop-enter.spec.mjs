// Going into Chop from another page (RJ, 18 Nov 2026). Two faults he found on
// 8737:
//
// - "even if on another page we only had a little bit of the sound selected,
//   when we come here, we want to select the whole sound on the top so that the
//   whole thing gets chopped". Entering Chop makes the loop the whole sound.
// - "I'm seeing the edit markers and they're lining up top and bottom, but I
//   don't see the waveform on the bottom for the chop". Chop's detail draws the
//   sound under its cuts, however the page was reached.
//
// Both go in by the rail's own Chop button, the way RJ does.

import { test, expect } from './test.mjs';

/// Open the library's first sound on the Grain page, with only part of it
/// looped, then go to Chop by the rail.
async function partThenChop(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    setEditPage('grain', false);
    setMode('edit');
    await selectFile(files[0]);
  });
  // The document open, too: a selection set before it is clamped to its
  // length, nothing, and dropped when it arrives (`060-editing.js`).
  await page.waitForFunction(() => gsFile() != null && state.edit?.frames > 0, null, { timeout: 20_000 });
  // The scratch library's sounds are short (a tenth of a second), and a loop is
  // at least 50 ms, so "part" is anything short of the whole.
  await page.evaluate(() => { const f = gsFile(); gsSetLoop(f.len * 0.2, f.len * 0.3); });
  const part = await page.evaluate(() => { const { a, b } = gsLoop(); return a > 0 && b - a < gsFile().len * 0.9; });
  expect(part).toBe(true);
  await page.locator('#leftRail [data-page="chop"]').first().click();
  await expect(page.locator('#dockChop')).toBeVisible();
  await page.waitForFunction(() => window.Chop.state.slices > 0, null, { timeout: 20_000 });
  await page.evaluate(() => window.Chop.analysed());
}

/// How much of the detail's canvas is lit: the share of its columns with a
/// pixel brighter than the well behind it, along the middle third.
const lit = (page) => page.evaluate(() => {
  const cv = document.getElementById('chopWave');
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  const d = g.getImageData(0, Math.floor(h / 3), w, Math.floor(h / 3)).data, rows = Math.floor(h / 3);
  let cols = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < rows; y++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] > 40 && d[i] + d[i + 1] + d[i + 2] > 120) { cols++; break; }
    }
  }
  return cols / w;
});

/// What decides the drawing, for a failure to say.
const why = (page) => page.evaluate(() => ({
  shown: chopShown(), active: chopActive(), path: chop.path, sel: state.selectedFile?.path,
  len: chop.len, view: { ...chopView }, colour: chopColour, an: !!chop.an, tok: { ...chopTok },
  canvas: (() => { const c = document.getElementById('chopWave'), r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cssW: r.width, cssH: r.height, vis: getComputedStyle(c).visibility, disp: getComputedStyle(c).display, op: getComputedStyle(c).opacity }; })(),
  peak: (() => { let m = 0; for (let i = 0; i < chop.mono.length; i += 97) m = Math.max(m, Math.abs(chop.mono[i])); return m; })(),
}));

test('going into Chop makes the loop the whole sound, whatever another page had', async ({ page }) => {
  await partThenChop(page);
  const loop = await page.evaluate(() => { const { a, b } = gsLoop(); return { a, b, len: gsFile().len }; });
  expect(loop.a).toBe(0);
  expect(loop.b).toBeCloseTo(loop.len, 3);
  // And what Chop cuts is the whole sound too.
  const r = await page.evaluate(() => ({ ...window.Chop.region, len: chop.len }));
  expect(r.s).toBe(0);
  expect(r.e).toBe(r.len);
});

test('Chop\'s detail draws the sound under its cuts, reached by the rail', async ({ page }) => {
  await partThenChop(page);
  const got = await lit(page);
  expect(got, JSON.stringify(await why(page))).toBeGreaterThan(0.5);
  // Coming back from another page, it is drawn again.
  await page.locator('#leftRail [data-page="grain"]').first().click();
  await page.locator('#leftRail [data-page="chop"]').first().click();
  await page.waitForFunction(() => document.body.classList.contains('choppage'));
  expect(await lit(page), JSON.stringify(await why(page))).toBeGreaterThan(0.5);
});
