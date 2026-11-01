// No control is lost when a panel is redone.
//
// RJ, 30 Oct 2026: "make sure the new layouts have all of the controls that the
// old layouts had". Every redesign here — knobs over sliders, banks of knobs,
// segment rows, pads — keeps the old input and draws a new face for it, so the
// controls in each view are countable and must stay counted.
//
// `fixtures/controls-baseline.json` is the inventory taken after the design pass
// of 27 Oct 2026, which was itself checked against the build before it: the same
// number of controls in every view, the only differences five switches renamed
// from their stripped forms ("rvrs grns") to whole words. A control is keyed by
// its id, or by its label (the row's name, the button's words), so the same
// control moved into a knob or another row keeps its key.
//
// Adding a control is free. Losing one fails here, naming it and the view.
// Renaming one on purpose means updating the fixture in the same commit.

import { test, expect } from './test.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/controls-baseline.json'), 'utf8'));

/// The same keying as the inventory the fixture was taken with.
const KEYS = `(sel) => {
  const host = document.querySelector(sel);
  if (!host) return [];
  const words = (t) => (t || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const label = (el) => {
    if (el.id) return '#' + el.id;
    const param = el.closest('.param');
    const k = param && param.querySelector('.k');
    if (k && words(k.textContent)) return 'param:' + words(k.textContent);
    const row = el.closest('.re-row, .rp-row');
    const tag = row && row.querySelector('.re-tag');
    const own = words(el.dataset.name || '') || words(el.matches('button') ? el.textContent : '') || words(el.getAttribute('aria-label')) || words(el.title).slice(0, 40);
    if (tag && words(tag.textContent)) return 'row:' + words(tag.textContent) + (own ? '/' + own : '');
    return own || '(unlabelled)';
  };
  return [...host.querySelectorAll('input, select, button, textarea, canvas.cloud-pad, [role=slider]')]
    .filter((el) => !el.closest('.rk-pads, .rk-head'))
    .map((el) => el.tagName.toLowerCase() + (el.type ? ':' + el.type : '') + ' ' + label(el));
}`;

async function inventory(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && (state.folders || []).length, { timeout: 30_000 });
  await page.evaluate(async () => {
    const f = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(f.find((x) => /tone/.test(x.path)) || f[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, { timeout: 20_000 });
  await page.waitForTimeout(500);
  const out = {};
  const take = async (view, root) => { out[view] = await page.evaluate(`(${KEYS})(${JSON.stringify(root)})`); };

  for (const alg of ['granular', 'wsola', 'vocoder', 'pvsola', 'hybrid']) {
    await page.evaluate((a) => document.querySelector(`#stretchEngine .seg-btn[data-alg="${a}"]`)?.click(), alg);
    await page.waitForTimeout(500);
    await take(`grain/stretch/${alg}`, '#dockStretch');
  }
  for (const tab of ['effects', 'prism', 'visuals', 'automation', 'regions']) {
    await page.locator(`.dock-tab[data-dock="${tab}"]`).click();
    await page.waitForTimeout(400);
    await take(`grain/${tab}`, `#dock${tab[0].toUpperCase()}${tab.slice(1)}`);
  }
  await take('transport', '#transportBar');
  await take('edit-toolbar', '#editTools');
  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(600);
  for (const tab of ['controls', 'sound', 'geom', 'paint', 'dim4']) {
    await page.locator(`#roomAdmin .rv-tab[data-rvtab="${tab}"]`).click();
    await page.waitForTimeout(400);
    await take(`visual/${tab}`, '#roomAdmin');
  }
  await page.locator('#roomAdmin .rv-tab[data-rvtab="controls"]').click();
  for (const m of ['ridge', 'room3d', 'stage']) {
    await page.selectOption('#rgVisual', m);
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelectorAll('#roomAdmin .st-fold:not(.open)').forEach((f) => f.click()));
    await page.waitForTimeout(300);
    await take(`visual/module/${m}`, '#roomAdmin');
  }
  await take('visual/stage-bar', '#roomStageBar');
  return out;
}

test('every control the panels had is still there', async ({ page }) => {
  test.setTimeout(120_000);
  const now = await inventory(page);
  const lost = [];
  for (const [view, want] of Object.entries(BASELINE)) {
    const have = {};
    for (const k of now[view] || []) have[k] = (have[k] || 0) + 1;
    for (const [key, n] of Object.entries(want)) {
      if ((have[key] || 0) < n) lost.push(`${view}: ${key}${n > 1 ? ` (${have[key] || 0} of ${n})` : ''}`);
    }
  }
  expect(lost, `controls missing:\n${lost.join('\n')}`).toEqual([]);
});
