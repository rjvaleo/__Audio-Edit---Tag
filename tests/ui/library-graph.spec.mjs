// The sound map: Browse › Map. See `ui/library-graph.js`.
//
// Where each sound lands, and what the clusters are called, is tested in Rust
// (`search/tests/soundmap.rs`). What is tested here is the window round it:
// that Map opens it with every sound a dot, a dot under the pointer is named
// and a click opens its card, the colour and hover choices stick, find lights
// the matches, Escape steps back one thing at a time, and a sound opens in
// the editor from its card.
//
// The scratch library is one folder, `kit`, of two sounds.

import { test, expect } from './test.mjs';

async function openMap(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.LibraryGraph, null, { timeout: 30_000 });
  await page.evaluate(() => { localStorage.removeItem('mapTint'); localStorage.removeItem('mapHoverPlays'); });
  await page.locator('#leftRail .rl-child', { hasText: 'Map' }).click();
  await page.waitForFunction(() => window.LibraryGraph.state.dots >= 2, null, { timeout: 20_000 });
}

/// A dot's place once it has stopped being nudged.
async function dot(page, i) {
  let last = null;
  for (let n = 0; n < 40; n++) {
    const at = await page.evaluate((k) => window.LibraryGraph.screenOf(k), i);
    if (last && Math.abs(at.x - last.x) < 0.5 && Math.abs(at.y - last.y) < 0.5) return at;
    last = at;
    await page.waitForTimeout(50);
  }
  return last;
}

test('Map opens the sound map with every sound a dot', async ({ page }) => {
  await openMap(page);
  await expect(page.locator('#libraryGraph')).toBeVisible();
  await expect(page.locator('.lg-status')).toHaveText(/^2 sounds/);
  const s = await page.evaluate(() => window.LibraryGraph.state);
  expect(s.count).toBe(2);
  expect(s.dots).toBe(2);
  expect(s.tint).toBe('cluster');
  expect(s.hoverPlays).toBe(true);
  // No folders, no labels: nothing on the map but the sounds.
  await expect(page.locator('.lg-views')).toHaveCount(0);
});

test('a dot under the pointer is named, and a click opens its card', async ({ page }) => {
  await openMap(page);
  const at = await dot(page, 0);
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.lg-now')).toContainText(at.name);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.lg-card h3')).toHaveText(at.name);
  await expect(page.locator('.lg-card .lg-where')).toHaveText('kit');
  await expect(page.locator('.lg-card [data-do="edit"]')).toBeVisible();
  expect(await page.evaluate(() => window.LibraryGraph.state.selected)).toBe(0);
});

test('the colour and hover choices are kept', async ({ page }) => {
  await openMap(page);
  await page.locator('.lg-tints [data-tint="family"]').click();
  await page.locator('.lg-plays [data-plays="off"]').click();
  await expect(page.locator('.lg-key')).toContainText(/Not heard|Percussion|Other|Instrument|Music|Machine|Nature|Voice/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#libraryGraph')).toBeHidden();
  await page.locator('#leftRail .rl-child', { hasText: 'Map' }).click();
  const s = await page.evaluate(() => window.LibraryGraph.state);
  expect(s.tint).toBe('family');
  expect(s.hoverPlays).toBe(false);
  await expect(page.locator('.lg-tints [data-tint="family"]')).toHaveClass(/on/);
});

test('find lights the matches and counts them; Enter goes to the first', async ({ page }) => {
  await openMap(page);
  await page.locator('.lg-find').fill('tone.wav');
  await expect(page.locator('.lg-found')).toHaveText('1 found');
  await page.locator('.lg-find').fill('kit');
  await expect(page.locator('.lg-found')).toHaveText('2 found');
  await page.locator('.lg-find').fill('short.wav');
  await page.locator('.lg-find').press('Enter');
  await expect(page.locator('.lg-card h3')).toHaveText('short.wav');
});

test('Escape steps back: the search, the card, then the map', async ({ page }) => {
  await openMap(page);
  const at = await dot(page, 1);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.lg-card')).toBeVisible();
  await page.locator('.lg-find').fill('tone');
  await page.locator('#libraryGraph').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lg-found')).toHaveText('');
  await expect(page.locator('.lg-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lg-card')).toBeHidden();
  // Whatever is playing stops before the map closes.
  for (let n = 0; n < 2 && await page.locator('#libraryGraph').isVisible(); n++) await page.keyboard.press('Escape');
  await expect(page.locator('#libraryGraph')).toBeHidden();
});

test('Edit on the card opens the sound in the editor', async ({ page }) => {
  await openMap(page);
  const at = await dot(page, 0);
  await page.mouse.click(at.x, at.y);
  await page.locator('.lg-card [data-do="edit"]').click();
  await expect(page.locator('#libraryGraph')).toBeHidden();
  await expect.poll(() => page.evaluate(() => state.mode)).toBe('edit');
  expect(await page.evaluate(() => state.selectedFile.name)).toBe(at.name);
});

test('3D in the strip opens the world map in place of the sound map', async ({ page }) => {
  await openMap(page);
  await page.locator('.lg-3d').click();
  await expect(page.locator('#libraryGraph')).toBeHidden();
  await expect(page.locator('#soundMap')).toBeVisible();
});
