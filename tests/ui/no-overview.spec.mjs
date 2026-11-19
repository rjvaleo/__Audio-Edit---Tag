// The overview strip under the Now Playing bar, page by page (RJ, 18 Nov 2026):
// "grain does not need the overview, move all functionality into the source
// window"; "do not need on prism"; "don't need on chop"; "don't need on
// visual"; "don't need on sequence". It stays on Edit and FX (and Compose and
// Draw, `draw.spec.mjs`). See `PO_NOT_ON` in `ui/app/416-page-overview.js`.

import { test, expect } from './test.mjs';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    // The Grain v12 page, as RJ has it: its SOURCE is what stands the strip down.
    setGrainUi('synth');
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(files.find((x) => /tone/.test(x.path)) || files[0]);
  });
}

/// Go there by the rail, as RJ does.
const go = (page, sel) => page.locator(`#leftRail ${sel}`).first().click();
const shown = (page) => page.evaluate(() => { const el = document.getElementById('pageOv'); return !el.classList.contains('hidden') && el.getClientRects().length > 0; });

test('the overview is not on Grain, Prism, Chop, Visual or Seq, and stays on Edit and FX', async ({ page }) => {
  await open(page);
  for (const [sel, want] of [
    ['[data-page="wave"]', true], ['[data-page="grain"]', false], ['[data-page="prism"]', false],
    ['[data-page="fx"]', true], ['[data-page="chop"]', false], ['[data-mode="room"]', false],
    ['[data-mode="seq"]', false], ['[data-page="wave"]', true],
  ]) {
    await go(page, sel);
    await expect.poll(() => shown(page), { message: sel }).toBe(want);
  }
});

test('Chop has its own overview again, with the sound on it', async ({ page }) => {
  await open(page);
  await go(page, '[data-page="chop"]');
  await page.waitForFunction(() => window.Chop.state.slices > 0, null, { timeout: 20_000 });
  await expect(page.locator('#chopOverview')).toBeVisible();
  const ink = await page.evaluate(() => {
    const cv = document.getElementById('chopOverview'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return n / (cv.width * cv.height);
  });
  expect(ink).toBeGreaterThan(0.2);
});
