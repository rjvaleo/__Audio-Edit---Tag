// The sound map: Browse › Map, in 3D. See `ui/library-graph.js`.
//
// Where each sound sits and what the groups are called is tested in Rust
// (`search/tests/soundmap.rs`). What is tested here is the window round it:
// that Map opens it with every sound a node, the three views can each be
// picked and the choice is kept, the panel names and draws the sound under
// the pointer, a click opens its card, find lights the matches, Escape steps
// back one thing at a time, and a sound opens in the editor from its card.
//
// The scratch library is one folder, `kit`, of two sounds: too few to make a
// group, so going into one is left to the Rust tests and to looking.

import { test, expect } from './test.mjs';

async function openMap(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.LibraryGraph && window.ForceGraph3D, null, { timeout: 30_000 });
  await page.evaluate(() => { for (const k of ['mapView', 'mapTint3', 'mapHoverPlays']) localStorage.removeItem(k); });
  await page.reload();
  await page.waitForFunction(() => window.LibraryGraph, null, { timeout: 30_000 });
  await page.locator('#leftRail .rl-item[data-mode="overview"]').click();
  await page.locator('#leftRail .rl-child', { hasText: 'Map' }).click();
  // The two sounds are listened to while the map is open, then placed.
  await page.waitForFunction(() => window.LibraryGraph.state.shown >= 2, null, { timeout: 45_000 });
}

/// A sound's place on screen once the camera has stopped moving.
async function node(page, i) {
  let last = null;
  for (let n = 0; n < 60; n++) {
    const at = await page.evaluate((k) => window.LibraryGraph.screenOf(k), i);
    if (at && last && Math.abs(at.x - last.x) < 0.5 && Math.abs(at.y - last.y) < 0.5) return at;
    last = at;
    await page.waitForTimeout(80);
  }
  return last;
}

test('Map opens the 3D sound map with every sound a node', async ({ page }) => {
  await openMap(page);
  await expect(page.locator('#libraryGraph')).toBeVisible();
  await expect(page.locator('#libraryGraph .lg-scene canvas')).toBeVisible();
  const s = await page.evaluate(() => window.LibraryGraph.state);
  expect(s.count).toBe(2);
  expect(s.shown).toBe(2);
  expect(s.view).toBe('cloud');
  await expect(page.locator('.lg-status')).toHaveText(/2 of 2 sounds placed/);
});

test('each view can be picked from the strip or with 1, 2 and 3, and is kept', async ({ page }) => {
  await openMap(page);
  await page.locator('.lg-views [data-view="stars"]').click();
  await expect.poll(() => page.evaluate(() => window.LibraryGraph.state.view)).toBe('stars');
  await expect(page.locator('.lg-views [data-view="stars"]')).toHaveClass(/on/);
  await page.locator('#libraryGraph').focus();
  await page.keyboard.press('3');
  await expect.poll(() => page.evaluate(() => window.LibraryGraph.state.view)).toBe('tags');
  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => window.LibraryGraph.state.view)).toBe('cloud');
  await page.keyboard.press('2');
  await page.locator('.lg-close').click();
  await page.locator('#leftRail .rl-child', { hasText: 'Map' }).click();
  await expect.poll(() => page.evaluate(() => window.LibraryGraph.state.view)).toBe('stars');
  // Every sound is still there, whichever view.
  await expect.poll(() => page.evaluate(() => window.LibraryGraph.state.shown)).toBe(2);
});

test('the panel shows the sound under the pointer, and a click opens its card', async ({ page }) => {
  await openMap(page);
  const at = await node(page, 0);
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.lg-panel')).toBeVisible();
  await expect(page.locator('.lg-pname')).toHaveText(at.name);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.lg-card h3')).toHaveText(at.name);
  await expect(page.locator('.lg-card .lg-where')).toHaveText('kit');
  expect(await page.evaluate(() => window.LibraryGraph.state.selected)).toBe(0);
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
  const at = await node(page, 1);
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
  const at = await node(page, 0);
  await page.mouse.click(at.x, at.y);
  await page.locator('.lg-card [data-do="edit"]').click();
  await expect(page.locator('#libraryGraph')).toBeHidden();
  await expect.poll(() => page.evaluate(() => state.mode)).toBe('edit');
  expect(await page.evaluate(() => state.selectedFile.name)).toBe(at.name);
});

test('Fly-through in the strip opens the older 3D world in place of the map', async ({ page }) => {
  await openMap(page);
  await page.locator('.lg-3d').click();
  await expect(page.locator('#libraryGraph')).toBeHidden();
  await expect(page.locator('#soundMap')).toBeVisible();
});
