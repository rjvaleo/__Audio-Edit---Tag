// The box, filling the screen.
//
// Two things are worth holding here and neither is visible from the source.
//
// The first is that the *panel* goes fullscreen and not the canvas. A fullscreen
// element is positioned as though it were fixed, and a fixed element has no
// `offsetParent` — which is exactly what `visGlTick` reads to decide whether
// anyone is looking at the scene. Fullscreen the canvas and the renderer
// concludes it is hidden and stops drawing at the moment it fills the screen.
// Nothing in the code says that; a test that watches the canvas keep growing
// does.
//
// The second is that the canvas actually resizes. Nothing calls a resize
// handler — `visGlTick` reconciles the backing store with the client size every
// frame — so the proof is that the backing store is bigger afterwards.

import { test, expect } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForSelector('#masterBus .mb-cell-3d', { state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(600);
}

const readBox = () => {
  const gl = document.getElementById('visGl');
  return {
    full: !!document.fullscreenElement && document.fullscreenElement.id === 'masterBus',
    backingW: gl.width,
    backingH: gl.height,
    clientW: gl.clientWidth,
    clientH: gl.clientHeight,
    // The renderer's own liveness test. Null here and it stops drawing.
    hasOffsetParent: gl.offsetParent !== null,
    sideW: Math.round(document.querySelector('#masterBus .mb-side').getBoundingClientRect().width),
  };
};

test('double-clicking the room takes the panel full screen and back', async ({ page }) => {
  await openEditor(page);

  const before = await page.evaluate(readBox);
  expect(before.full, 'started out full screen').toBe(false);
  expect(before.hasOffsetParent, 'the canvas was already considered hidden').toBe(true);

  await page.dblclick('#masterBus .mb-cell-3d');
  await page.waitForTimeout(700);

  const during = await page.evaluate(readBox);
  expect(during.full, 'the panel did not go full screen').toBe(true);
  // The canvas is still an ordinary child of a positioned cell, which is the
  // whole reason the panel is the thing that goes fullscreen.
  expect(during.hasOffsetParent, 'the canvas lost its offsetParent, so it will stop drawing')
    .toBe(true);
  expect(during.clientW, 'the box did not get wider').toBeGreaterThan(before.clientW);
  expect(during.backingW, 'the backing store did not follow the box')
    .toBeGreaterThan(before.backingW);
  // The meter column is given room to be read at that size.
  expect(during.sideW, 'the meter column did not widen').toBeGreaterThan(before.sideW);

  // Double-click again to come back. Escape works too, but that is the
  // browser's own handling of fullscreen rather than anything this code does —
  // headless does not provide it, and a test that asserted it would be testing
  // the harness.
  await page.dblclick('#masterBus .mb-cell-3d');
  await page.waitForTimeout(700);

  const after = await page.evaluate(readBox);
  expect(after.full, 'a second double-click did not leave full screen').toBe(false);
  expect(after.clientW, 'the box did not return to its docked width')
    .toBeLessThan(during.clientW);
  expect(after.hasOffsetParent, 'the canvas came back hidden').toBe(true);
});

test('the menu item toggles the same thing', async ({ page }) => {
  await openEditor(page);

  await page.evaluate(() => toggleMasterFullscreen());
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => masterIsFullscreen()),
    'the menu action did not go full screen').toBe(true);

  await page.evaluate(() => toggleMasterFullscreen());
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => masterIsFullscreen()),
    'the menu action did not come back').toBe(false);
});
