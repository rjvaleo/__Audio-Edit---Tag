// The sound map. See `docs/SOUND-MAP.md`.
//
// Where a sound is placed is tested in Rust (`search/tests/map.rs`); what is
// tested here is the window around it: that it opens from the rail, draws the
// library, names a sound under the pointer, opens its card on a click, switches
// layout, finds by name, and gives the window back on Escape.

import { test, expect } from '@playwright/test';

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
  await expect(page.locator('.smap-tip')).toContainText(at.name);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.smap-card h3')).toHaveText(at.name);
  await expect(page.locator('.smap-card .bars span').first()).toBeVisible();
});

test('L switches to the islands, where the axes have no names', async ({ page }) => {
  await openMap(page);
  await page.locator('#soundMap canvas').focus();
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
