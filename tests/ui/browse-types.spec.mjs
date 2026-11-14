// Browse's types, in place of the map (`ui/app/251-browse-types.js`).
//
// The counting and the paging are tested in Rust (`tests/routes/browse_types.rs`).
// What is tested here: Browse shows the types and not the map, Map is off the
// rail, a type lists its files, a click on one plays it and selects it, and the
// arrow keys step to the next.
//
// The scratch library is one folder, `kit`, of two sounds.

import { test, expect } from './test.mjs';

async function browse(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.folders?.length > 0, null, { timeout: 30_000 });
  await expect(page.locator('#browseTypes')).toBeVisible();
  await expect(page.locator('#btTypeList .bt-type').first()).toBeVisible();
}

test('Browse shows the types in place of the map, and Map is off the rail', async ({ page }) => {
  await browse(page);
  await expect(page.locator('#browseMap')).toBeHidden();
  await expect(page.locator('#leftRail .rl-child', { hasText: /^Map$/ })).toHaveCount(0);
  // Every listed file is in exactly one type.
  const counts = await page.locator('#btTypeList .bt-type .bt-n').allTextContents();
  const sum = counts.reduce((a, t) => a + Number(t.replace(/,/g, '')), 0);
  expect(sum).toBe(2);
  await expect(page.locator('#btTotal')).toHaveText('2 files');
});

test('a type lists its files, and a click plays one and selects it', async ({ page }) => {
  await browse(page);
  const first = page.locator('#btTypeList .bt-type').first();
  await first.click();
  await expect(first).toHaveClass(/on/);
  const n = Number((await first.locator('.bt-n').textContent()).replace(/,/g, ''));
  const rows = page.locator('#btFileList .file-row');
  await expect(rows).toHaveCount(n);
  await expect(page.locator('#btTypeName')).toHaveText(await first.locator('.bt-name').textContent());

  const path = await rows.first().getAttribute('data-path');
  await rows.first().click();
  await page.waitForFunction((p) => state.selectedFile?.path === p && engine.path === p, path, { timeout: 10_000 });
  await expect(rows.first()).toHaveClass(/selected/);
  await expect(page.locator('#titleFile')).toHaveText(path.split('/').pop());
});

test('find narrows the list, and the arrow keys step through it', async ({ page }) => {
  await browse(page);
  // The two scratch sounds fall in different types; put every category in one
  // type, first in the list, so there are two rows to step between.
  await page.evaluate(async () => {
    const r = await api('/api/types');
    BROWSE_TYPES.unshift({ name: 'Everything', cats: r.categories.map((c) => c.category) });
    await btLoadTypes({ force: true });
  });
  await page.locator('#btTypeList .bt-type', { hasText: 'Everything' }).click();

  const rows = page.locator('#btFileList .file-row');
  await expect(rows).toHaveCount(2);
  await rows.first().click();
  const p0 = await rows.nth(0).getAttribute('data-path');
  const p1 = await rows.nth(1).getAttribute('data-path');
  await page.waitForFunction((p) => engine.path === p, p0);
  await page.locator('#btFileList').press('ArrowDown');
  await page.waitForFunction((p) => state.selectedFile?.path === p && engine.path === p, p1, { timeout: 10_000 });

  await page.locator('#btFind').fill(p1.split('/').pop().replace(/\.wav$/, ''));
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#btCount')).toHaveText(/^1 of 2/);
});
