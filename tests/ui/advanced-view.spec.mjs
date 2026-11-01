// The Advanced view: one pop-up for the selected sound, with its tag fields
// side by side. See `ui/app/255-advanced-view.js`.
//
// A value can be added, removed, put in order or dragged into another field;
// Apply writes the fields back as the comma lists they always were and saves
// them through Commit. Cancel and Escape leave the fields alone.

import { test, expect } from '@playwright/test';

async function openSound(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    setMode('overview');
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files.find((f) => /tone\.wav$/.test(f.path)));
  });
  // The measured words and the suggestion arrive with /api/similar.
  await page.waitForFunction(() => state.selectedFile && state.sonicWords[state.selectedFile.path],
    { timeout: 30_000 });
}

const col = (page, key) => page.locator(`#avModal .av-col[data-key="${key}"]`);
const words = (page, key) => col(page, key).locator('.av-item .av-w').allTextContents();

test('opens over the page with the sound\'s four fields', async ({ page }) => {
  await openSound(page);
  await page.click('#avOpen');
  await expect(page.locator('#avModal .av-box')).toBeVisible();
  await expect(page.locator('#avModal .av-col .av-t')).toHaveText(['What it is', "What it's like", 'Tags', 'Notes']);
  await expect(page.locator('#avModal .av-name')).toHaveText('tone.wav');
  const level1 = await page.inputValue('#editLevel1');
  expect((await words(page, 'is')).join(', ')).toBe(level1);
});

test('a value is added from its text field, and removed with ×', async ({ page }) => {
  await openSound(page);
  await page.click('#avOpen');
  await col(page, 'is').locator('.av-new').fill('Synth lead');
  await col(page, 'is').locator('.av-new').press('Enter');
  expect(await words(page, 'is')).toContain('Synth lead');
  // The same word twice is one word.
  await col(page, 'is').locator('.av-new').fill('synth lead');
  await col(page, 'is').locator('.av-new').press('Enter');
  expect((await words(page, 'is')).filter((w) => w.toLowerCase() === 'synth lead')).toHaveLength(1);
  await col(page, 'is').locator('.av-item', { hasText: 'Synth lead' }).locator('.av-x').click();
  expect(await words(page, 'is')).not.toContain('Synth lead');
});

test('a suggestion is one click away', async ({ page }) => {
  await openSound(page);
  await page.click('#avOpen');
  const chip = col(page, 'like').locator('.av-chip').first();
  const word = (await chip.textContent()).replace(/^\+ /, '');
  await chip.click();
  expect(await words(page, 'like')).toContain(word);
});

test('a value is dragged into order, and into another field', async ({ page }) => {
  await openSound(page);
  await page.click('#avOpen');
  for (const w of ['alpha', 'beta']) {
    await col(page, 'tags').locator('.av-new').fill(w);
    await col(page, 'tags').locator('.av-new').press('Enter');
  }
  const before = await words(page, 'tags');
  // beta, dropped on the first value, goes first.
  await col(page, 'tags').locator('.av-item', { hasText: 'beta' })
    .dragTo(col(page, 'tags').locator('.av-item').first(), { targetPosition: { x: 20, y: 4 } });
  const after = await words(page, 'tags');
  expect(after[0]).toBe('beta');
  expect(after.length).toBe(before.length);
  // alpha, dropped on What it's like, leaves Tags.
  await col(page, 'tags').locator('.av-item', { hasText: 'alpha' }).dragTo(col(page, 'like').locator('.av-list'));
  expect(await words(page, 'like')).toContain('alpha');
  expect(await words(page, 'tags')).not.toContain('alpha');
});

test('Cancel and Escape leave the fields as they were', async ({ page }) => {
  await openSound(page);
  const was = await page.inputValue('#editTags');
  await page.click('#avOpen');
  await col(page, 'tags').locator('.av-new').fill('not kept');
  await col(page, 'tags').locator('.av-new').press('Enter');
  await page.click('#avModal [data-av="cancel"]');
  await expect(page.locator('#avModal')).toBeHidden();
  expect(await page.inputValue('#editTags')).toBe(was);

  await page.click('#avOpen');
  await col(page, 'tags').locator('.av-new').fill('not kept either');
  await col(page, 'tags').locator('.av-new').press('Enter');
  await col(page, 'tags').locator('.av-new').press('Escape');
  await expect(page.locator('#avModal')).toBeHidden();
  expect(await page.inputValue('#editTags')).toBe(was);
});

test('Apply writes the fields and saves them', async ({ page }) => {
  await openSound(page);
  await page.click('#avOpen');
  await col(page, 'is').locator('.av-new').fill('Test tone');
  await col(page, 'is').locator('.av-new').press('Enter');
  await page.locator('#avModal .av-notes').fill('made for the test');
  const save = page.waitForResponse((r) => r.url().includes('/api/save') && r.request().method() === 'POST');
  await page.click('#avModal [data-av="apply"]');
  expect((await save).ok()).toBe(true);
  await expect(page.locator('#avModal')).toBeHidden();
  expect(await page.inputValue('#editLevel1')).toContain('Test tone');
  expect(await page.inputValue('#editNotes')).toBe('made for the test');
  expect(await page.evaluate(() => Object.keys(state.tagEdits).length)).toBe(0);

  // Saved, not only shown: the sound reads back with it.
  const saved = await page.evaluate(async () => {
    const r = await api(`/api/similar?p=${encodeURIComponent(state.selectedFile.path)}&limit=1`);
    return r.saved;
  });
  expect(saved.level1).toContain('Test tone');
  expect(saved.notes).toBe('made for the test');
});
