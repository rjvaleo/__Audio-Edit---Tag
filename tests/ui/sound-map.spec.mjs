// The sound map. See `docs/SOUND-MAP.md`.
//
// Where a sound is placed is tested in Rust (`search/tests/map.rs`); what is
// tested here is the window around it: that it opens from the rail, draws the
// library, names a sound under the pointer, opens its card on a click, switches
// layout, finds by name, and gives the window back on Escape.

import { test, expect } from './test.mjs';

async function openMap(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof BABYLON !== 'undefined' && window.SoundMap, null, { timeout: 30_000 });
  await page.locator('#leftRail .rl-child', { hasText: 'Map' }).click();
  await page.waitForFunction(() => window.SoundMap.state.count >= 2, null, { timeout: 20_000 });
}

test('the map opens from the rail and places the library', async ({ page }) => {
  await openMap(page);
  await expect(page.locator('#soundMap')).toBeVisible();
  await expect(page.locator('.smap-status')).toHaveText(/2 sounds/);
  // The axes are named where the world puts them.
  await expect(page.locator('.smap-axis[data-axis="high"]')).toBeVisible();
});

test('a sound under the pointer is named, and a click opens its card', async ({ page }) => {
  await openMap(page);
  const at = await page.evaluate(() => window.SoundMap.screenOf(0));
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.smap-focus')).toContainText(at.name);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.smap-card h3')).toHaveText(at.name);
  await expect(page.locator('.smap-card .bars span').first()).toBeVisible();
});

test('L switches to the islands, where the axes have no names', async ({ page }) => {
  await openMap(page);
  await page.locator('#soundMap .smap-world').focus();
  await page.keyboard.press('l');
  await expect.poll(() => page.evaluate(() => window.SoundMap.state.layout)).toBe('islands');
  await expect(page.locator('.smap-axis[data-axis="high"]')).toBeHidden();
});

test('find lights the matches and counts them', async ({ page }) => {
  await openMap(page);
  await page.locator('.smap-find').fill('short');
  await expect(page.locator('.smap-found')).toHaveText('1 found');
  await page.locator('.smap-find').fill('');
  await expect(page.locator('.smap-found')).toHaveText('');
});

test('Escape closes the card, then the map', async ({ page }) => {
  await openMap(page);
  const at = await page.evaluate(() => window.SoundMap.screenOf(1));
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.smap-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.smap-card')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#soundMap')).toBeHidden();
});

test('every sound is drawn as its own waveform, not a ball', async ({ page }) => {
  await openMap(page);
  await expect.poll(() => page.evaluate(() => window.SoundMap.state.waves)).toBe(2);
});

test('the library fills the window, with no box round it', async ({ page }) => {
  await openMap(page);
  const got = await page.evaluate(() => ({
    frame: window.SoundMap.state.frame,
    span: window.SoundMap.span(),
    width: document.querySelector('#soundMap .smap-world').clientWidth,
  }));
  expect(got.frame).toBe(false);
  expect(got.span.width).toBeGreaterThanOrEqual(got.width * 0.9);
});

test('the sound under the pointer is shown large, with its name and its waveform', async ({ page }) => {
  await openMap(page);
  await expect(page.locator('.smap-focus')).toBeHidden();
  const at = await page.evaluate(() => window.SoundMap.screenOf(0));
  await page.mouse.move(at.x, at.y);
  const focus = page.locator('.smap-focus');
  await expect(focus).toBeVisible();
  await expect(focus).toContainText(at.name);
  const w = await focus.locator('canvas').evaluate((c) => c.clientWidth);
  expect(w).toBeGreaterThanOrEqual(160);
});

test('the wheel flies toward what the pointer is on', async ({ page }) => {
  await openMap(page);
  const at = await page.evaluate(() => window.SoundMap.screenOf(0));
  const d0 = await page.evaluate(() => window.SoundMap.distanceTo(0));
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -600);
  await expect.poll(() => page.evaluate(() => window.SoundMap.distanceTo(0))).toBeLessThan(d0 * 0.8);
  const now = await page.evaluate(() => window.SoundMap.screenOf(0));
  expect(Math.hypot(now.x - at.x, now.y - at.y)).toBeLessThan(40);
});

test('a click flies to the sound', async ({ page }) => {
  await openMap(page);
  const at = await page.evaluate(() => window.SoundMap.screenOf(0));
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.SoundMap.distanceTo(0))).toBeLessThan(16);
});

test('Tab hops from sound to sound, and Shift+Tab comes back', async ({ page }) => {
  await openMap(page);
  await page.locator('#soundMap .smap-world').focus();
  await page.keyboard.press('Tab');
  const a = await page.evaluate(() => window.SoundMap.state.selected);
  expect(a).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Tab');
  const b = await page.evaluate(() => window.SoundMap.state.selected);
  expect(b).toBeGreaterThanOrEqual(0);
  expect(b).not.toBe(a);
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => window.SoundMap.state.selected)).toBe(a);
  // The keys stayed the map's: focus did not wander off into the page.
  expect(await page.evaluate(() => !!document.activeElement.closest('#soundMap'))).toBe(true);
});

test('Home flies back to the whole library', async ({ page }) => {
  await openMap(page);
  const width = await page.evaluate(() => document.querySelector('#soundMap .smap-world').clientWidth);
  await page.locator('#soundMap .smap-world').focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.SoundMap.span().width)).toBeGreaterThan(width * 1.2);
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => window.SoundMap.span().width), { timeout: 5_000 })
    .toBeLessThan(width * 1.15);
});

test('T tours the library, a sound at a time, until pressed again', async ({ page }) => {
  await openMap(page);
  await page.locator('#soundMap .smap-world').focus();
  await page.keyboard.press('t');
  expect(await page.evaluate(() => window.SoundMap.state.tour)).toBe(true);
  const first = await page.evaluate(() => window.SoundMap.state.selected);
  await expect.poll(() => page.evaluate(() => window.SoundMap.state.selected), { timeout: 8_000 })
    .not.toBe(first);
  await page.keyboard.press('t');
  expect(await page.evaluate(() => window.SoundMap.state.tour)).toBe(false);
});
