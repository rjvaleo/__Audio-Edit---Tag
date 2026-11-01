// The Edit page: the open sound with editing only, and every edit command as an
// icon along the top. See "the Edit page" in `ui/app.js`.
//
// Edit and Grain are two pages of the one `edit` mode, chosen from the rail.
// The icons run the same commands as the menus, dim when there is nothing for
// them to act on, and Copy / Paste / Delete are real edits on the document.

import { test, expect } from './test.mjs';

async function openEdit(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('kept')) return;
    try { localStorage.removeItem('editPage'); localStorage.removeItem('editToolbar'); } catch {}
  });
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
    // Exact positions: the tests count frames.
    setSnap('off');
  });
  await page.waitForFunction(() => !!state.edit, { timeout: 20_000 });
  await page.click('#leftRail .rl-item[data-page="wave"]');
  await page.waitForFunction(() => document.body.classList.contains('wavepage'));
}

const frames = (page) => page.evaluate(() => state.edit.frames);
const select = (page, start, end) =>
  page.evaluate(([a, b]) => { state.sel = { start: a, end: b }; drawSelection(); }, [start, end]);
const cmd = (page, id) => page.click(`#waveTools [data-cmd="${id}"]`);

test('Edit is its own page in the rail: no dock, the toolbar instead', async ({ page }) => {
  await openEdit(page);
  const got = await page.evaluate(() => ({
    lit: document.querySelector('#leftRail .rl-item.rl-on')?.dataset.page,
    dock: getComputedStyle(document.getElementById('dock')).display,
    tools: getComputedStyle(document.getElementById('waveTools')).display,
    presets: getComputedStyle(document.getElementById('presetBar')).display,
  }));
  expect(got).toEqual({ lit: 'wave', dock: 'none', tools: 'flex', presets: 'none' });
});

test('Grain is still Grain: its dock, and no edit icons', async ({ page }) => {
  await openEdit(page);
  await page.click('#leftRail .rl-item[data-page="grain"]');
  await page.waitForFunction(() => !document.body.classList.contains('wavepage'));
  const got = await page.evaluate(() => ({
    lit: document.querySelector('#leftRail .rl-item.rl-on')?.dataset.page,
    dock: getComputedStyle(document.getElementById('dock')).display,
    tools: getComputedStyle(document.getElementById('waveTools')).display,
  }));
  expect(got.lit).toBe('grain');
  expect(got.dock).not.toBe('none');
  expect(got.tools).toBe('none');
});

test('every icon is drawn, named, and says its key', async ({ page }) => {
  await openEdit(page);
  const bad = await page.$$eval('#waveTools .wt-btn', (bs) => bs
    .filter((b) => !b.querySelector('svg path, svg rect, svg circle') || !b.getAttribute('aria-label') || !b.title)
    .map((b) => b.dataset.cmd));
  expect(bad).toEqual([]);
  const n = await page.$$eval('#waveTools .wt-btn', (bs) => bs.length);
  expect(n).toBeGreaterThanOrEqual(35);
  expect(await page.getAttribute('#waveTools [data-cmd="copy"]', 'title')).toContain('⌘C');
});

test('the icons that need a selection are dimmed without one', async ({ page }) => {
  await openEdit(page);
  await page.evaluate(() => { state.sel = null; drawSelection(); });
  const off = await page.$$eval('#waveTools .wt-btn:disabled', (bs) => bs.map((b) => b.dataset.cmd));
  for (const id of ['cut', 'copy', 'delete', 'crop', 'fadeIn', 'fadeOut', 'reverse', 'silence', 'paste']) {
    expect(off, id).toContain(id);
  }
  await select(page, 1000, 2000);
  const on = await page.$$eval('#waveTools .wt-btn:not(:disabled)', (bs) => bs.map((b) => b.dataset.cmd));
  for (const id of ['cut', 'copy', 'delete', 'crop', 'fadeIn', 'fadeOut', 'reverse', 'silence']) {
    expect(on, id).toContain(id);
  }
});

test('copy then paste at the cursor lengthens the sound by the copy', async ({ page }) => {
  await openEdit(page);
  const was = await frames(page);
  await select(page, 1000, 3000);
  await cmd(page, 'copy');
  await page.waitForFunction(() => (state.edit.clipboard || 0) === 2000);
  expect(await frames(page)).toBe(was);
  await page.evaluate(() => { state.sel = null; drawSelection(); });
  await expect(page.locator('#waveTools [data-cmd="paste"]')).toBeEnabled();
  await cmd(page, 'paste');
  await page.waitForFunction((w) => state.edit.frames === w + 2000, was);
});

test('cut fills the clipboard, delete does not, and undo puts it back', async ({ page }) => {
  await openEdit(page);
  const was = await frames(page);
  await select(page, 0, 1000);
  await cmd(page, 'cut');
  await page.waitForFunction((w) => state.edit.frames === w - 1000, was);
  await select(page, 0, 500);
  await cmd(page, 'delete');
  await page.waitForFunction((w) => state.edit.frames === w - 1500, was);
  expect(await page.evaluate(() => state.edit.clipboard)).toBe(1000);
  await cmd(page, 'undo');
  await page.waitForFunction((w) => state.edit.frames === w - 1000, was);
  await cmd(page, 'undo');
  await page.waitForFunction((w) => state.edit.frames === w, was);
});

test('the structural icons each change the document', async ({ page }) => {
  await openEdit(page);
  for (const id of ['silence', 'fadeIn', 'fadeOut', 'reverse', 'crop']) {
    await page.evaluate(() => editOp({ op: 'revert' }));
    await select(page, 1000, 3000);
    const before = await page.evaluate(() => JSON.stringify(state.edit.clips));
    await cmd(page, id);
    await page.waitForFunction((b) => JSON.stringify(state.edit.clips) !== b, before);
  }
});

test('the fade curve and the snap are lit choices', async ({ page }) => {
  await openEdit(page);
  await cmd(page, 'curveLin');
  expect(await page.evaluate(() => state.fadeShape)).toBe('linear');
  await expect(page.locator('#waveTools [data-cmd="curveLin"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#waveTools [data-cmd="curveEq"]')).toHaveAttribute('aria-pressed', 'false');
  await cmd(page, 'snapZero');
  expect(await page.evaluate(() => state.snap)).toBe('zero');
  await expect(page.locator('#waveTools [data-cmd="snapZero"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the keys: ⌘C and ⌘V copy and paste, Delete deletes', async ({ page }) => {
  await openEdit(page);
  const was = await frames(page);
  await select(page, 0, 1000);
  await page.keyboard.press('Meta+c');
  await page.waitForFunction(() => (state.edit.clipboard || 0) === 1000);
  await page.evaluate(() => { state.sel = null; drawSelection(); });
  await page.keyboard.press('Meta+v');
  await page.waitForFunction((w) => state.edit.frames === w + 1000, was);
  await select(page, 0, 400);
  await page.keyboard.press('Delete');
  await page.waitForFunction((w) => state.edit.frames === w + 600, was);
});

test('the Edit menu has Copy, Paste and Delete', async ({ page }) => {
  await openEdit(page);
  const labels = await page.evaluate(() => MENUS.find((m) => m.title === 'Edit').items.map((i) => i.label));
  expect(labels).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Paste', 'Delete']));
});

test('the page is remembered', async ({ page }) => {
  await openEdit(page);
  expect(await page.evaluate(() => localStorage.getItem('editPage'))).toBe('wave');
});

// ── sections, words, and customizing ─────────────────────────────────────────

const ids = (page, sec) => page.$$eval(`#waveTools .wt-group[data-section="${sec}"] .wt-btn[data-cmd]`,
  (bs) => bs.map((b) => b.dataset.cmd));

test('the bar is in titled sections, and every icon has its word under it', async ({ page }) => {
  await openEdit(page);
  const titles = await page.$$eval('#waveTools .wt-group[data-section] .wt-title', (ts) => ts.map((t) => t.textContent));
  expect(titles).toEqual(['History', 'Clipboard', 'Silence', 'Fades', 'Level', 'Process',
    'Selection', 'Zoom', 'Markers', 'Snap', 'Export']);
  const wordless = await page.$$eval('#waveTools .wt-btn[data-cmd]', (bs) => bs
    .filter((b) => {
      const w = b.querySelector('.wt-word');
      if (!w || !w.textContent.trim()) return true;
      return w.getBoundingClientRect().top < b.querySelector('svg').getBoundingClientRect().bottom - 1;
    })
    .map((b) => b.dataset.cmd));
  expect(wordless, 'icons with no word under them').toEqual([]);
});

test('customizing: an icon dragged to another place stays there', async ({ page }) => {
  await openEdit(page);
  await page.click('#waveTools .wtEdit');
  await page.locator('#waveTools [data-cmd="copy"]').dragTo(page.locator('#waveTools [data-cmd="undo"]'));
  expect((await ids(page, 0))[0]).toBe('copy');
  expect(await ids(page, 1)).not.toContain('copy');
  await page.evaluate(() => sessionStorage.setItem('kept', '1'));
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('#waveTools .wt-btn'));
  expect((await ids(page, 0))[0]).toBe('copy');
});

test('customizing: a section dragged onto another goes before it', async ({ page }) => {
  await openEdit(page);
  await page.click('#waveTools .wtEdit');
  await page.locator('#waveTools .wt-group[data-section="3"] .wt-title')
    .dragTo(page.locator('#waveTools .wt-group[data-section="0"] .wt-title'));
  const titles = await page.$$eval('#waveTools .wt-group[data-section] .wt-title', (ts) => ts.map((t) => t.textContent));
  expect(titles.slice(0, 2)).toEqual(['Fades', 'History']);
});

test('customizing: a section is renamed in place', async ({ page }) => {
  await openEdit(page);
  await page.click('#waveTools .wtEdit');
  const t = page.locator('#waveTools .wt-group[data-section="0"] .wt-title');
  await t.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Oops');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => wtLayout.sections[0].title)).toBe('Oops');
});

test('customizing: hide an icon, then drag it back from Hidden; Reset restores all', async ({ page }) => {
  await openEdit(page);
  await page.click('#waveTools .wtEdit');
  await page.click('#waveTools .wt-group[data-section="1"] [data-cmd="crop"] .wt-x');
  expect(await ids(page, 1)).not.toContain('crop');
  await expect(page.locator('#waveTools .wt-custom [data-cmd="crop"]')).toBeVisible();
  await page.locator('#waveTools .wt-custom [data-cmd="crop"]').dragTo(page.locator('#waveTools [data-cmd="silence"]'));
  expect((await ids(page, 2))[0]).toBe('crop');
  await page.click('#waveTools .wtReset');
  expect(await ids(page, 1)).toEqual(['cut', 'copy', 'paste', 'delete', 'crop', 'duplicate']);
  await page.click('#waveTools .wtDone');
  await expect(page.locator('#waveTools .wtEdit')).toBeVisible();
});

test('customizing: a click picks an icon up rather than running it', async ({ page }) => {
  await openEdit(page);
  const was = await frames(page);
  await select(page, 0, 1000);
  await page.click('#waveTools .wtEdit');
  await page.click('#waveTools [data-cmd="cut"]', { position: { x: 20, y: 30 } });
  await page.waitForTimeout(400);
  expect(await frames(page)).toBe(was);
});
