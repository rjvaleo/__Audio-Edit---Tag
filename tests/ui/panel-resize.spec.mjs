// The left panel's width is yours to set.
//
// Driven with real mouse events rather than synthetic ones, because the bug this
// was written after was invisible to synthetic events *and* to reading the code:
// `wireLeftPanelResize` threw part-way through, after applying the width and
// before attaching its listeners, so the grip appeared, took a `col-resize`
// cursor, and did nothing. Everything looked wired. Nothing was.
//
// The throw was a temporal dead zone — `setLeftPanelWidth` calls `redrawLane`,
// which reads a `let` declared further down the file, and the initial call runs
// at top level before that declaration is reached. The console named it; no
// amount of staring at the function did.

import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
  // Whatever a previous run left behind.
  await page.evaluate(() => {
    try { localStorage.removeItem('audiolab.leftPanelWidth'); } catch { /* private mode */ }
    $('leftPanel').classList.remove('collapsed', 'drawer-closed');
    setLeftPanelWidth(330);
  });
  await page.waitForTimeout(400);
}

const width = (page) =>
  page.evaluate(() => Math.round($('leftPanel').getBoundingClientRect().width));

/// The whole point: a real drag moves it.
test('the left panel can be dragged wider and narrower', async ({ page }) => {
  await ready(page);
  expect(await width(page), 'the panel did not start at its default').toBe(330);

  const grip = page.locator('#leftGrip');
  const box = await grip.boundingBox();
  expect(box, 'no resize grip on the left panel').not.toBeNull();
  expect(box.height, 'the grip has no height to grab').toBeGreaterThan(100);

  // Drag the edge to x = 520. The resulting *width* is that minus the panel's
  // own left edge — it sits to the right of the icon rail, not at zero — so the
  // expectation is computed rather than guessed. Guessing it is what made the
  // first version of this fail at 458 against a hopeful 460.
  const panelLeft = await page.evaluate(
    () => Math.round($('leftPanel').getBoundingClientRect().left));
  const target = 520;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const wide = await width(page);
  const want = target - panelLeft;
  expect(
    Math.abs(wide - want),
    `dragged the edge to ${target}: expected about ${want}px of panel, got ${wide}`,
  ).toBeLessThan(15);

  // And back in.
  const box2 = await grip.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(260, box2.y + box2.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const narrow = await width(page);
  expect(narrow, `dragging left did not narrow the panel (still ${narrow})`).toBeLessThan(wide - 100);
});

/// It stops before the panel becomes useless in either direction.
test('the panel width is clamped at both ends', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => setLeftPanelWidth(10));
  await page.waitForTimeout(400);
  expect(await width(page), 'the panel can be dragged to nothing').toBeGreaterThanOrEqual(200);

  await page.evaluate(() => setLeftPanelWidth(5000));
  await page.waitForTimeout(400);
  const w = await width(page);
  expect(w, 'the panel can be dragged over the whole window').toBeLessThanOrEqual(720);
});

/// Double-click is "put it back", the same gesture as every other control here.
test('double-clicking the grip restores the default width', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => setLeftPanelWidth(560));
  await page.waitForTimeout(400);
  expect(await width(page)).toBeGreaterThan(500);

  await page.locator('#leftGrip').dblclick();
  await page.waitForTimeout(500);
  expect(await width(page), 'double-click did not restore the default').toBe(330);
});

/// The width outlives the window.
test('the width is remembered across a reload', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => setLeftPanelWidth(505));
  await page.waitForTimeout(400);

  await page.reload();
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(600);
  expect(await width(page), 'the panel forgot its width').toBe(505);
});

/// Collapsing still wins over a stored width.
///
/// This is why the width is a custom property and not an inline `style.width`:
/// an inline width beats `.panel.collapsed`, and the panel could never be shut
/// again once it had been dragged.
test('a resized panel can still be collapsed', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => setLeftPanelWidth(600));
  await page.waitForTimeout(400);
  expect(await width(page)).toBeGreaterThan(500);

  await page.evaluate(() => $('leftPanel').classList.add('collapsed'));
  await page.waitForTimeout(500);
  expect(await width(page), 'a dragged panel cannot be collapsed').toBe(0);

  await page.evaluate(() => $('leftPanel').classList.remove('collapsed'));
  await page.waitForTimeout(500);
  expect(await width(page), 'reopening lost the width').toBe(600);
});

/// And the page loads without the exception that made this inert.
test('the interface loads with no console error', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await ready(page);
  await page.waitForTimeout(600);
  expect(errors, `the page reported errors:\n  ${errors.join('\n  ')}`).toEqual([]);
});
