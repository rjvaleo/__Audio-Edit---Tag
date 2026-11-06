// The Prism page: HyperStretch and the rack pad merged into one panel.
//
// RJ, 5 Nov 2026: "Merge the HyperStretch and Rack Pad together, use all of
// the functionality from both, the look of the HyperStretch and the box size
// from Rack Pad", and "Move all the extra setting to the Prism stand-alone,
// don't tell me the rest of the settings are in the FX tab".
//
// What this pins:
//   - one panel on the page, no switch, and no second pad;
//   - the source picker drives any slot from the HyperStretch pad, and a take
//     on it in Loop mode moves the slot's two controls;
//   - the Settings bank has every control of the source but the two on the
//     pad, and moving one moves the value the FX tab moves;
//   - Loop and Lanes: where a take goes.
// The rest is in `hyperstretch.spec.mjs` (the pad and its takes) and
// `prism-pad.spec.mjs` (the sources, limits, lanes, presets and faders).

import { test, expect } from './test.mjs';

async function openPrism(page, slots = []) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.evaluate(async (slots) => {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('hyperstretch')) localStorage.removeItem(k); } catch {}
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await postJSON('/api/rack', { p: files[0].path, sr: 44100, slots });
    await postJSON('/api/automation', { p: files[0].path, bypassed: false, lanes: [] });
    await selectFile(files[0]);
    setMode('edit');
  }, slots);
  await page.locator('#leftRail .rl-item[data-page="prism"]').click();
  await page.waitForFunction(() => (window.prismPad?.sources || []).length > 0);
  await page.evaluate(() => window.hyperStretch.reset());
}

const DELAY = { id: 'm1', kind: 'prism:multi-delay', bypassed: false, params: {} };

test('the page is one panel: HyperStretch\'s pad, the rack pad\'s menus, no switch', async ({ page }) => {
  await openPrism(page);
  await expect(page.locator('#prismViews')).toHaveCount(0);
  await expect(page.locator('#dockPrism')).toHaveCount(0);
  await expect(page.locator('.hs-pad')).toHaveCount(1);
  await expect(page.locator('#dockHyper #prismSource')).toBeVisible();
  await expect(page.locator('#dockHyper #prismPreset')).toBeVisible();
  await expect(page.locator('#dockHyper #prismSpeed')).toBeVisible();
  for (const bank of ['Settings', 'Gestures', 'Motion', 'Output']) {
    await expect(page.locator(`#dockHyper .hs-bank[aria-label="${bank}"]`)).toBeVisible();
  }
});

test('a slot on the pad: grabbing it takes a Loop take of the slot\'s two controls', async ({ page }) => {
  await openPrism(page, [DELAY]);
  await page.locator('#prismSource').selectOption({ label: 'Multi Delay' });
  await expect(page.locator('#prismX')).toHaveValue('delay1Ms');
  await expect(page.locator('#hsXName')).not.toHaveText('');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = await page.locator('#hsPad').boundingBox();
  await page.mouse.move(b.x + 0.2 * b.width, b.y + 0.5 * b.height);
  await page.mouse.down();
  await page.mouse.move(b.x + 0.9 * b.width, b.y + 0.1 * b.height, { steps: 10 });
  await page.mouse.up();
  await page.locator('#hsStop').click();
  const take = await page.evaluate(() => window.hyperStretch.take(0));
  expect(take.pts.length).toBeGreaterThan(2);
  // The slot's two controls are where the pad left them, linear between the limits.
  const got = await page.evaluate(() => {
    const p = prismSetup();
    const slot = state.rack.slots.find((s) => s.id === 'm1');
    const h = window.hyperStretch.hand();
    return { x: slot.params[p.x], y: slot.params[p.y],
      wantX: p.xLo + h.x * (p.xHi - p.xLo), wantY: p.yLo + (1 - h.y) * (p.yHi - p.yLo) };
  });
  // Within a step: a stepped control lands on its steps.
  expect(Math.abs(got.x - got.wantX)).toBeLessThanOrEqual(1);
  expect(Math.abs(got.y - got.wantY)).toBeLessThanOrEqual(1);
  // Takes are kept per process: Time & Pitch's take A is its own.
  await page.locator('#prismSource').selectOption({ label: 'Time & Pitch' });
  expect(await page.evaluate(() => window.hyperStretch.take(0))).toBeNull();
});

test('Settings has every control of a slot but the two on the pad, and they move the FX tab\'s values', async ({ page }) => {
  await openPrism(page, [DELAY]);
  await page.locator('#prismSource').selectOption({ label: 'Multi Delay' });
  const want = await page.evaluate(() => {
    const p = prismSetup();
    const slot = state.rack.slots.find((s) => s.id === 'm1');
    return (state.shapers[slot.kind]?.params || []).filter((sp) => sp.key !== p.x && sp.key !== p.y).map((sp) => sp.label);
  });
  expect(want.length).toBeGreaterThan(0);
  const shown = await page.locator('#prismSettings .param .k').allTextContents();
  expect(shown.map((t) => t.trim()).sort()).toEqual([...want].sort());
  await expect(page.locator('#prismSettings')).not.toContainText(/FX tab/);
  // Turn the first knob: the slot's own value moves, and the rack keeps it.
  const moved = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('#prismSettings .param')].find((r) => r.querySelector(':scope > input[type=range]'));
    const input = row.querySelector(':scope > input[type=range]');
    const p = prismSetup();
    const slot = state.rack.slots.find((s) => s.id === 'm1');
    const sp = state.shapers[slot.kind].params.find((q) => q.label === row.querySelector('.k').textContent.trim() && q.key !== p.x && q.key !== p.y);
    const before = slot.params[sp.key];
    input.value = String(+input.min + (+input.max - +input.min) * (before > (+input.min + +input.max) / 2 ? 0.1 : 0.9));
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 500));
    const stored = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return { key: sp.key, before, now: slot.params[sp.key], stored: stored.slots.find((s) => s.id === 'm1').params[sp.key] };
  });
  expect(moved.now).not.toBeCloseTo(moved.before, 3);
  expect(moved.stored).toBeCloseTo(moved.now, 3);
});

test('Loop or Lanes: Lanes shows LOOP and sets the gestures aside, Loop brings them back', async ({ page }) => {
  await openPrism(page);
  await expect(page.locator('[data-hswhere="loop"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#prismLoop')).toBeHidden();
  await page.locator('[data-hswhere="lanes"]').click();
  await expect(page.locator('#prismLoop')).toBeVisible();
  await expect(page.locator('.hs-bank[aria-label="Gestures"]')).toHaveClass(/hs-off/);
  await expect(page.locator('#hsInfo')).toContainText('stretch.ratio / stretch.semitones');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // In Lanes the pad moves the controls without starting a Loop take.
  const b = await page.locator('#hsPad').boundingBox();
  await page.mouse.click(b.x + 0.75 * b.width, b.y + 0.5 * b.height);
  expect(await page.evaluate(() => window.hyperStretch.take(0))).toBeNull();
  const ratio = await page.evaluate(() => state.stretchDraft.ratio);
  expect(ratio).toBeCloseTo(4 + 0.75 * (0.25 - 4), 1);
  await page.locator('[data-hswhere="loop"]').click();
  await expect(page.locator('#prismLoop')).toBeHidden();
  await expect(page.locator('.hs-bank[aria-label="Gestures"]')).not.toHaveClass(/hs-off/);
});
