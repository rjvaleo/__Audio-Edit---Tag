// The Wave page's Matrix view (v8, mock-up F): every envelope and LFO as a
// tile, and the patch matrix as pins or as rows. See `docs/WAVE-SYNTH.md`.
//
// These talk to the real routes on the scratch server, whose output is muted;
// no notes are played. Each test starts with no mod rows.
//
// What this pins:
//   - a click in a hole puts a pin in, a drag sets its amount, a double-click
//     pulls it, and the engine has each change;
//   - the columns page a group at a time, and a band brings its group up;
//   - the rows are the same connections: a row's switch keeps it on the page
//     and off the engine, and its pickers change its source and target;
//   - every column is a target the engine takes;
//   - the Matrix's tiles edit the same keys as Play's.

import { test, expect } from './test.mjs';

async function openMatrix(page) {
  expect((await page.request.post('/api/wave/mods', { data: { mods: [] } })).ok()).toBe(true);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.locator('#leftRail .rl-item[data-mode="synth"]').click();
  await page.waitForFunction(() => WV.connected, null, { timeout: 8_000 });
  await page.locator('#wvViews [data-v="matrix"]').click();
  await page.waitForTimeout(200);
  return errors;
}
const engineMods = async (page) => (await (await page.request.get('/api/wave/patch')).json()).mods;
const hole = (page, s, t) => page.locator(`#wvMxPins .wv-hole[data-s="${s}"][data-t="${t}"]`);

test('a click puts a pin in, a drag sets its amount, a double-click pulls it', async ({ page }) => {
  const errors = await openMatrix(page);
  await expect(page.locator('#wvMxPins .wv-rh')).toHaveCount(20);
  const h = hole(page, 'lfo1', 'osc0.pos');
  await h.click();
  await expect(h).toHaveClass(/\bpin\b/);
  await expect(h.locator('b')).toHaveText('+25');
  await expect(page.locator('#wvMxCount')).toHaveText('1 of 64');
  await page.waitForTimeout(150);
  expect(await engineMods(page)).toEqual([expect.objectContaining({ src: 'lfo1', dst: 'osc0.pos', amt: 0.25 })]);

  const b = await h.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 16, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await engineMods(page);
  expect(after[0].amt).toBeGreaterThan(0.25);
  await expect(h.locator('b')).toHaveText('+' + Math.round(after[0].amt * 100));
  // Play's LFO 2 tile says what it moves now.
  expect(await page.evaluate(() => WV.mods.length)).toBe(1);

  await h.dblclick();
  await expect(h).not.toHaveClass(/\bpin\b/);
  await page.waitForTimeout(150);
  expect(await engineMods(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('the columns page a group at a time, and a band brings its group up', async ({ page }) => {
  await openMatrix(page);
  const el = page.locator('#wvMxPins');
  expect(await el.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await page.locator('#wvPgNav [data-pg="1"]').click();
  await page.waitForTimeout(700);
  const x1 = await el.evaluate((e) => e.scrollLeft);
  expect(x1).toBeGreaterThan(0);
  await page.locator('#wvPgNav [data-pg="-1"]').click();
  await page.waitForTimeout(700);
  expect(await el.evaluate((e) => e.scrollLeft)).toBeLessThan(x1);
  await page.locator('#wvMxPins .wv-pband', { hasText: 'MACROS' }).click();
  await page.waitForTimeout(700);
  const seen = await page.evaluate(() => {
    const box = $('wvMxPins').getBoundingClientRect(), b = [...document.querySelectorAll('.wv-pband')].find((x) => x.textContent === 'MACROS').getBoundingClientRect();
    return b.left >= box.left && b.right <= box.right + 1;
  });
  expect(seen).toBe(true);
});

test('the rows are the same connections; a row switched off stays here and leaves the engine', async ({ page }) => {
  const errors = await openMatrix(page);
  await hole(page, 'env1', 'filt0.cut').click();
  await hole(page, 'macro2', 'osc1.pan').click();
  await page.locator('#wvMxMode [data-m="rows"]').click();
  const rows = page.locator('#wvMxRows .wv-mxr:not(.add):not(.empty)');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.wv-pk.t')).toContainText('F1 Cutoff');
  await expect(rows.nth(1).locator('.wv-pk.s')).toContainText('M3');

  // Off: still a row here, gone from the engine; on again, back.
  await rows.nth(0).locator('.wv-pwr').click();
  await expect(rows.nth(0)).toHaveClass(/\boff\b/);
  await page.waitForTimeout(150);
  expect((await engineMods(page)).map((m) => m.src)).toEqual(['macro2']);
  await rows.nth(0).locator('.wv-pwr').click();
  await page.waitForTimeout(150);
  expect((await engineMods(page)).map((m) => m.src)).toEqual(['env1', 'macro2']);

  // A new target from the picker, grouped as the pins' bands are.
  await rows.nth(1).locator('.wv-pk.t').click();
  await expect(page.locator('#wvPmenu .wv-pmg b').first()).toHaveText('OSC A');
  await page.locator('#wvPmenu [data-v="lfo0.rate"]').click();
  await page.waitForTimeout(150);
  expect((await engineMods(page))[1]).toMatchObject({ src: 'macro2', dst: 'lfo0.rate' });

  // A row made in the empty slot: a source, then a target.
  await page.locator('#wvMxRows .wv-mxr.add .wv-pk.s').click();
  await page.locator('#wvPmenu .wv-pill[data-v="lfo3"]').click();
  await page.locator('#wvMxRows .wv-mxr.add .wv-pk.t').click();
  await page.locator('#wvPmenu [data-v="env2.d"]').click();
  await page.waitForTimeout(150);
  expect((await engineMods(page)).at(-1)).toMatchObject({ src: 'lfo3', dst: 'env2.d', amt: 0.3 });
  await expect(rows).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('every column of the pins is a target the engine takes', async ({ page }) => {
  await openMatrix(page);
  const keys = await page.evaluate(() => wvTargetGroups().flatMap((g) => g.ks.map((k) => k[0])));
  expect(keys.length).toBeGreaterThan(80);
  const r = await page.request.post('/api/wave/mods', { data: { mods: keys.slice(0, 64).map((dst) => ({ src: 'lfo0', dst, amt: 0.1 })) } });
  expect(r.ok(), await r.text()).toBe(true);
  const r2 = await page.request.post('/api/wave/mods', { data: { mods: keys.slice(64).map((dst) => ({ src: 'lfo0', dst, amt: 0.1 })) } });
  expect(r2.ok(), await r2.text()).toBe(true);
  await page.request.post('/api/wave/mods', { data: { mods: [] } });
});

test('the Matrix\'s tiles edit the same keys as Play\'s', async ({ page }) => {
  await openMatrix(page);
  await expect(page.locator('#wvViewMatrix .wv-tile')).toHaveCount(8);
  const before = await page.evaluate(() => WV.p['env2.a']);
  const r = await page.locator('#wvViewMatrix .wv-rd[data-tgt="env2.a"]').boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2 - 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => WV.p['env2.a']);
  expect(after).toBeGreaterThan(before);
  const patch = await (await page.request.get('/api/wave/patch')).json();
  expect(patch.params['env2.a']).toBeCloseTo(after, 4);
  // Play shows ENV 3 in its slot when it is picked, with the same value.
  await page.locator('#wvViews [data-v="play"]').click();
  await page.locator('#wvViewPlay [data-slotpick="env"][data-s="env2"]').first().click();
  await expect(page.locator('#wvViewPlay .wv-tile[data-tile="env2"]')).toBeVisible();
  await expect(page.locator('#wvViewPlay .wv-tile[data-tile="env1"]')).toBeHidden();
  await expect(page.locator('#wvViewPlay .wv-rd[data-tgt="env2.a"] b')).toHaveText(await page.locator('#wvViewMatrix .wv-rd[data-tgt="env2.a"] b').textContent());
});
