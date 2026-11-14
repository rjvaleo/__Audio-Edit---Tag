// The Edit page: the open sound with editing only, and every edit command as an
// icon in WaveLab-style tabs along the top. See `docs/EDIT-PAGE.md`.
//
// Edit and Grain are two pages of the one `edit` mode, chosen from the rail.
// The icons run the same commands as the menus, dim when there is nothing for
// them to act on, and Copy / Paste / Delete are real edits on the document.
// A command lives in one tab; `cmd` opens that tab before clicking it.

import { test, expect } from './test.mjs';

async function openEdit(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('kept')) return;
    try { for (const k of ['editPage', 'editToolbar', 'editBar', 'editTab', 'editShow', 'editParams']) localStorage.removeItem(k); } catch {}
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
/// Every button on the bar, as one list.
const everyButton = (page, sel) => page.$$eval(`#waveTools ${sel}`, (bs) => bs.map((b) => ({
  id: b.dataset.cmd, svg: !!b.querySelector('svg path, svg rect, svg circle'), label: b.getAttribute('aria-label'), title: b.title,
})));

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
    side: getComputedStyle(document.getElementById('edSide')).display,
  }));
  expect(got.lit).toBe('grain');
  expect(got.dock).not.toBe('none');
  expect(got.tools).toBe('none');
  // The bar down the right is the Edit page's only (RJ, 14 Nov 2026).
  expect(got.side).toBe('none');
});

test('Chop is its own page in the rail: the dock with only Chop, and Grain gets its tab back', async ({ page }) => {
  await openEdit(page);
  await page.click('#leftRail .rl-item[data-page="grain"]');
  await page.click('.dock-tab[data-dock="effects"]');
  await page.click('#leftRail .rl-item[data-page="chop"]');
  await page.waitForFunction(() => document.body.classList.contains('choppage'));
  const got = await page.evaluate(() => ({
    lit: document.querySelector('#leftRail .rl-item.rl-on')?.dataset.page,
    dock: getComputedStyle(document.getElementById('dock')).display,
    chop: !document.getElementById('dockChop').classList.contains('hidden'),
    tools: getComputedStyle(document.getElementById('waveTools')).display,
    presets: getComputedStyle(document.getElementById('presetBar')).display,
    remembered: localStorage.getItem('editPage'),
  }));
  expect(got).toEqual({ lit: 'chop', dock: 'flex', chop: true, tools: 'none', presets: 'none', remembered: 'chop' });

  await page.click('#leftRail .rl-item[data-page="grain"]');
  await page.waitForFunction(() => !document.body.classList.contains('choppage'));
  expect(await page.evaluate(() => document.querySelector('.dock-tab.active')?.dataset.dock)).toBe('effects');
});

test('every icon is drawn, named, and says its key', async ({ page }) => {
  await openEdit(page);
  const all = await everyButton(page, '.wt-btn[data-cmd]');
  expect(all.filter((b) => !b.svg || !b.label || !b.title).map((b) => b.id)).toEqual([]);
  expect(all.length).toBeGreaterThanOrEqual(44);
  expect(all.find((b) => b.id === 'copy').title).toContain('⌘C');
});

test('the icons that need a selection are dimmed without one', async ({ page }) => {
  await openEdit(page);
  await page.evaluate(() => { state.sel = null; drawSelection(); });
  const off = (await everyButton(page, '.wt-btn:disabled')).map((b) => b.id);
  for (const id of ['cut', 'copy', 'delete', 'crop', 'fadeIn', 'fadeOut', 'reverse', 'silence', 'paste']) {
    expect(off, id).toContain(id);
  }
  await select(page, 1000, 2000);
  const on = (await everyButton(page, '.wt-btn:not(:disabled)')).map((b) => b.id);
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

test('Insert clipboard puts the copy in at the selection and replaces nothing', async ({ page }) => {
  await openEdit(page);
  // The earlier tests' edits stay on the server's document; this one reads
  // source positions, so it starts from the sound as it is on disk.
  await page.evaluate(() => editOp({ op: 'revert' }));
  const was = await frames(page);
  await select(page, 500, 1500);
  await cmd(page, 'copy');
  await page.waitForFunction(() => (state.edit.clipboard || 0) === 1000);
  await select(page, 2500, 3000);
  await cmd(page, 'insertClip');
  // Paste would have swapped the selected 500 for the 1000; Insert adds them.
  await page.waitForFunction((w) => state.edit.frames === w + 1000, was);
  const laid = await page.evaluate(() => {
    let at = 0;
    for (const c of state.edit.clips) { if (at === 2500) return { srcStart: c.srcStart, len: c.len }; at += c.len; }
    return null;
  });
  expect(laid).toEqual({ srcStart: 500, len: 1000 });
});

test('⇧⌘V inserts the clipboard at the selection; ⌘V replaces it', async ({ page }) => {
  await openEdit(page);
  const was = await frames(page);
  await select(page, 0, 1000);
  await page.keyboard.press('Meta+c');
  await page.waitForFunction(() => (state.edit.clipboard || 0) === 1000);
  await select(page, 2000, 2400);
  await page.keyboard.press('Meta+Shift+v');
  await page.waitForFunction((w) => state.edit.frames === w + 1000, was);
  await select(page, 2000, 2400);
  await page.keyboard.press('Meta+v');
  await page.waitForFunction((w) => state.edit.frames === w + 1600, was);
});

test('an insert is in the picture too: the waveform and the overview grow with the sound', async ({ page }) => {
  await openEdit(page);
  await page.evaluate(() => editOp({ op: 'revert' }));
  const was = await frames(page);
  await select(page, 0, 1000);
  await page.keyboard.press('Meta+c');
  await page.waitForFunction(() => (state.edit.clipboard || 0) === 1000);
  await select(page, 2000, 2400);
  await page.keyboard.press('Meta+Shift+v');
  await page.waitForFunction((w) => state.edit.frames === w + 1000, was);
  await page.waitForFunction((w) => state.peaks?.frames === w + 1000 && state.overview?.frames === w + 1000, was);
  // Undo takes it out of the picture again.
  await cmd(page, 'undo');
  await page.waitForFunction((w) => state.peaks?.frames === w && state.overview?.frames === w, was);
});

test('the Edit menu has Insert clipboard, next to Paste', async ({ page }) => {
  await openEdit(page);
  const labels = await page.evaluate(() => MENUS.find((m) => m.title === 'Edit').items.map((i) => i.label));
  expect(labels[labels.indexOf('Paste') + 1]).toBe('Insert clipboard');
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

test('the keys still work after a slider or checkbox was the last thing touched', async ({ page }) => {
  await openEdit(page);
  const was = await frames(page);
  // A slider keeps focus after a drag; it is not a text field, so ⌘X ⌘C ⌘V
  // and Delete are still the sound's. A typing field keeps them, as before.
  const focusA = (type) => page.evaluate((t) => {
    const el = document.createElement('input');
    el.type = t;
    el.id = 'probeInput';
    document.getElementById('probeInput')?.remove();
    document.body.appendChild(el);
    el.focus();
  }, type);
  await focusA('range');
  await select(page, 0, 1000);
  await page.keyboard.press('Meta+c');
  await page.waitForFunction(() => (state.edit.clipboard || 0) === 1000);
  await focusA('checkbox');
  await page.evaluate(() => { state.sel = null; drawSelection(); });
  await page.keyboard.press('Meta+v');
  await page.waitForFunction((w) => state.edit.frames === w + 1000, was);
  await focusA('range');
  await select(page, 0, 400);
  await page.keyboard.press('Meta+x');
  await page.waitForFunction((w) => state.edit.frames === w + 600, was);
  await focusA('text');
  await select(page, 0, 100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  expect(await frames(page)).toBe(was + 600);
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

const secAt = (page, title) => page.evaluate((t) => wtLayout.sections.findIndex((s) => s.title === t), title);
const ids = (page, sec) => page.$$eval(`#waveTools .wt-group[data-section="${sec}"] .wt-btn[data-cmd]`,
  (bs) => bs.map((b) => b.dataset.cmd));
const titles = (page) => page.$$eval('#waveTools .wt-group[data-section] .wt-title', (ts) => ts.map((t) => t.textContent));

test('one bar down the right, no tabs: every section under its title, the meters at its foot, the words only while customizing', async ({ page }) => {
  await openEdit(page);
  expect(await page.locator('#edTabs, .ed-tab').count()).toBe(0);
  expect(await titles(page)).toEqual(['History', 'Clipboard', 'Silence', 'Fades', 'Level', 'Process', 'Repair', 'Measure', 'Markers', 'Zoom', 'Snap', 'Display', 'Show', 'Export']);
  // The Selection commands start hidden: their keys and the menus do them.
  expect(await page.evaluate(() => wtLayout.hidden)).toEqual(['selectAll', 'deselect', 'setSelection', 'goTo']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  const at = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const side = r('edSide'), lane = r('lane'), centre = document.querySelector('.centre').getBoundingClientRect();
    return {
      inSide: document.getElementById('waveTools').parentElement.id, meters: document.getElementById('edMeters').parentElement.id,
      metersLast: document.getElementById('edSide').lastElementChild.id,
      right: side.left >= lane.right, top: side.top - centre.top, bottom: centre.bottom - side.bottom,
      metersFoot: Math.abs(side.bottom - r('edMeters').bottom) < 1.5, metersShown: r('edMeters').width > 0,
      lane: lane.width, width: side.width,
      // The file tabs and ⌘K stay along the top; the tools are not there.
      topTools: document.querySelectorAll('#editTools .wt-btn').length,
    };
  });
  expect(at).toMatchObject({ inSide: 'edSide', meters: 'edSide', metersLast: 'edMeters', right: true, metersFoot: true, metersShown: true, topTools: 0 });
  // The whole height of the centre, bar a margin.
  expect(at.top).toBeLessThanOrEqual(12);
  expect(at.bottom).toBeLessThanOrEqual(12);
  expect(at.width).toBeGreaterThanOrEqual(180);
  expect(at.width).toBeLessThanOrEqual(240);
  // It must not squeeze the wave.
  expect(at.lane).toBeGreaterThan(600);
  // Small icons in a grid: several to a row.
  const box = await page.locator('#waveTools [data-cmd="cut"]').boundingBox();
  expect(box.height).toBeLessThanOrEqual(32);
  const clip = await secAt(page, 'Clipboard');
  const rows = await page.$$eval(`#waveTools .wt-group[data-section="${clip}"] .wt-btn[data-cmd]`, (bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size);
  expect(rows).toBe(2);
  expect(await page.isVisible('#waveTools .wt-title')).toBe(true);
  expect(await page.isVisible('#waveTools [data-cmd="cut"] .wt-word')).toBe(false);
  await page.click('#waveTools .wtEdit');
  const wordless = await page.$$eval('#waveTools .wt-group[data-section] .wt-btn[data-cmd]', (bs) => bs
    .filter((b) => {
      const w = b.querySelector('.wt-word');
      if (!w || !w.textContent.trim()) return true;
      return w.getBoundingClientRect().top < b.querySelector('svg').getBoundingClientRect().bottom - 1;
    })
    .map((b) => b.dataset.cmd));
  expect(wordless, 'icons with no word under them while customizing').toEqual([]);
  expect(await page.isVisible('#waveTools .wt-title')).toBe(true);
});

test('a command\'s settings sit behind its ▾, and its tooltip says what it will run with', async ({ page }) => {
  await openEdit(page);
  expect(await page.locator('#waveTools .knob').count()).toBe(0);
  const mores = await page.$$eval('#waveTools .wt-more', (bs) => bs.map((b) => b.dataset.more));
  expect(mores.sort()).toEqual(['duplicate', 'gain', 'insertSilence', 'normalize', 'normalizeRms', 'repairClick', 'stripSilence']);
  await page.click('#waveTools .wt-more[data-more="stripSilence"]');
  await expect(page.locator('#edKnobs')).toBeVisible();
  expect(await page.$$eval('#edKnobs .knob', (ks) => ks.map((k) => k.dataset.k))).toEqual(['thr', 'minMs', 'padMs']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#edKnobs')).toBeHidden();
  await page.evaluate(() => { edParams.gainDb = -6; wtSync(); });
  expect(await page.getAttribute('#waveTools [data-cmd="gain"]', 'title')).toContain('Gain -6.0 dB');
});

test('customizing: an icon dragged to another place stays there', async ({ page }) => {
  await openEdit(page);
  const hist = await secAt(page, 'History'), clip = await secAt(page, 'Clipboard');
  await page.click('#waveTools .wtEdit');
  await page.locator('#waveTools [data-cmd="copy"]').dragTo(page.locator('#waveTools [data-cmd="undo"]'));
  expect((await ids(page, hist))[0]).toBe('copy');
  expect(await ids(page, clip)).not.toContain('copy');
  await page.evaluate(() => sessionStorage.setItem('kept', '1'));
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('#waveTools .wt-btn'));
  expect((await ids(page, hist))[0]).toBe('copy');
});

test('customizing: a section dragged onto another goes before it', async ({ page }) => {
  await openEdit(page);
  const hist = await secAt(page, 'History'), sel = await secAt(page, 'Zoom');
  await page.click('#waveTools .wtEdit');
  await page.locator(`#waveTools .wt-group[data-section="${sel}"] .wt-title`)
    .dragTo(page.locator(`#waveTools .wt-group[data-section="${hist}"] .wt-title`));
  const titles = await page.$$eval('#waveTools .wt-group[data-section] .wt-title', (ts) => ts.map((t) => t.textContent));
  expect(titles.slice(0, 2)).toEqual(['Zoom', 'History']);
});

test('customizing: a section is renamed in place', async ({ page }) => {
  await openEdit(page);
  const hist = await secAt(page, 'History');
  await page.click('#waveTools .wtEdit');
  const t = page.locator(`#waveTools .wt-group[data-section="${hist}"] .wt-title`);
  await t.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Oops');
  await page.keyboard.press('Enter');
  expect(await page.evaluate((i) => wtLayout.sections[i].title, hist)).toBe('Oops');
});

test('customizing: hide an icon, then drag it back from Hidden; Reset restores all', async ({ page }) => {
  await openEdit(page);
  const hist = await secAt(page, 'History'), clip = await secAt(page, 'Clipboard');
  await page.click('#waveTools .wtEdit');
  await page.click(`#waveTools .wt-group[data-section="${clip}"] [data-cmd="crop"] .wt-x`);
  expect(await ids(page, clip)).not.toContain('crop');
  await expect(page.locator('#waveTools .wt-custom [data-cmd="crop"]')).toBeVisible();
  await page.locator('#waveTools .wt-custom [data-cmd="crop"]').dragTo(page.locator('#waveTools [data-cmd="undo"]'));
  expect((await ids(page, hist))[0]).toBe('crop');
  await page.click('#waveTools .wtReset');
  expect(await ids(page, clip)).toEqual(['cut', 'copy', 'paste', 'insertClip', 'delete', 'crop', 'duplicate']);
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
