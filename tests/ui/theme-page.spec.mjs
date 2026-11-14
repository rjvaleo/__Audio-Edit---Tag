// The Theme page (13 Nov 2026, from the mock-up RJ approved).
//
// Theme was a pane in the library's column; it is a page of its own now, like
// Edit, Grain, Chop, Wave, Visual and Seq: the palettes as cards on the left, a
// sheet of today's parts in the middle, and the editor on the right. What is
// proved here is the page — that the rail opens it at full width in its three
// columns, that a card previews and Wear it wears, that a button across the
// top shows that page itself in the palette being edited, and that a Look
// chosen here is the Look the whole app wears. The editor's own
// behaviour is `theme-editor.spec.mjs`. See `docs/THEME-EDITOR.md`.

import { test, expect } from './test.mjs';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof tsRender === 'function', null, { timeout: 20_000 });
  // Whatever a previous test left behind — these share one browser.
  await page.evaluate(() => {
    themeState.mine = []; themeState.chosen = null; themeState.plain = false; tsSelected = null;
    saveTheme(); applyChosenTheme();
  });
  await page.click('#leftRail .rl-item[data-mode="theme"]');
  await page.waitForFunction(() => document.body.classList.contains('themepage'));
}

const bg = (page, sel) => page.evaluate((s) => getComputedStyle(s ? document.querySelector(s) : document.documentElement)
  .getPropertyValue('--bg').trim(), sel);

test('the rail opens Theme as a full page, in three columns', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(() => {
    const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right }; };
    const centre = document.querySelector('.centre').getBoundingClientRect();
    const left = $('leftPanel');
    return {
      mode: state.mode,
      lit: document.querySelector('#leftRail .rl-item.rl-on')?.dataset.mode,
      shown: !$('themeView').classList.contains('hidden'),
      // Nothing of the library column over or beside it: a page, not a pane.
      drawerShut: left.classList.contains('drawer-closed') || left.classList.contains('collapsed'),
      lane: $('lane').classList.contains('hidden'),
      view: box('#themeView'), centre: { w: centre.width },
      cols: ['.tp-pals', '.tp-view', '.tp-ed'].map(box),
      // The preview is made of the app's own parts.
      parts: ['.ui-knob', '.ui-bar', '.ui-seg', '.pbar', 'canvas'].map((s) => document.querySelectorAll(`#themeMini ${s}`).length),
      cards: document.querySelectorAll('#themeList .theme-card').length,
      // It opens on something: the editor is never an empty third of the page.
      editor: !$('tsEditor').classList.contains('hidden') && !!tsSelected,
      looks: [...document.querySelectorAll('#tpLooks [data-look]')].map((b) => b.dataset.look),
      // Folded away until asked for.
      tokensOpen: $('tpTokens').open,
    };
  });
  expect(got.mode).toBe('theme');
  expect(got.lit).toBe('theme');
  expect(got.shown).toBe(true);
  expect(got.drawerShut, 'the library column is still open beside the page').toBe(true);
  expect(got.lane).toBe(true);
  expect(got.view.w, 'the page does not take the whole middle').toBeGreaterThan(got.centre.w - 2);
  const [pals, view, ed] = got.cols;
  // Side by side, left to right, each a real column.
  expect(pals.right).toBeLessThanOrEqual(view.x);
  expect(view.right).toBeLessThanOrEqual(ed.x);
  for (const c of got.cols) expect(c.h).toBeGreaterThan(300);
  expect(view.w, 'the preview should be the widest column').toBeGreaterThan(Math.max(pals.w, ed.w));
  for (const n of got.parts) expect(n).toBeGreaterThan(0);
  expect(got.cards).toBeGreaterThan(10);
  expect(got.editor, 'the editor opened empty').toBe(true);
  expect(got.looks).toEqual(['AD', 'A', 'B', 'C', 'D']);
  expect(got.tokensOpen).toBe(false);

  // And it is left like any other page.
  await page.click('#leftRail .rl-item[data-mode="overview"]');
  expect(await page.evaluate(() => [state.mode, $('themeView').classList.contains('hidden')])).toEqual(['overview', true]);
});

test('a palette card previews, and Wear it puts it on', async ({ page }) => {
  await open(page);
  const pageBefore = await bg(page);
  const id = 'layered-dark';
  await page.click(`#themeList .theme-card[data-id="${id}"]`);
  // Open in the editor and painted in the preview; the page is left alone.
  expect(await page.evaluate(() => tsSelected)).toBe(id);
  await expect(page.locator(`#themeList .theme-card[data-id="${id}"]`)).toHaveClass(/editing/);
  expect(await bg(page, '#themeMini')).toBe('#161b22');
  expect(await bg(page)).toBe(pageBefore);
  expect(await page.evaluate(() => themeState.chosen)).toBeNull();

  await page.click('#tsApply');
  expect(await page.evaluate(() => themeState.chosen)).toBe(id);
  expect(await bg(page), 'Wear it did not put the palette on the page').toBe('#161b22');
  await expect(page.locator('#tsApply')).toHaveText('Wearing');
  await expect(page.locator(`#themeList .theme-card[data-id="${id}"]`)).toHaveClass(/chosen/);
  await expect(page.locator('#tpStatus')).toContainText('wearing Layered dark');

  // No theme takes it off again; a double-click on a card wears it at once.
  await page.click('#themeNone');
  expect(await page.evaluate(() => themeState.chosen)).toBeNull();
  expect(await bg(page)).toBe(pageBefore);
  await page.dblclick(`#themeList .theme-card[data-id="${id}"]`);
  expect(await page.evaluate(() => themeState.chosen)).toBe(id);
  await page.click('#themeNone');
});

test('every page is a button, and one shows that page itself in the open palette', async ({ page }) => {
  await open(page);
  // The rail's pages, in the rail's order, Theme apart.
  const rail = await page.evaluate(() => [...document.querySelectorAll('#leftRail .mode-btn')]
    .filter((b) => b.dataset.mode !== 'theme').map((b) => b.querySelector('.rl-lb').textContent.trim()));
  expect(rail).toEqual(expect.arrayContaining(['Edit', 'Grain', 'Prism', 'Chop', 'Wave', 'Visual', 'Seq', 'Browse']));
  expect(await page.locator('#tpPages .tp-pg').allTextContents()).toEqual(rail);

  const before = await bg(page);
  await page.click('#themeList .theme-card[data-id="layered-dark"]');
  await page.click('#tpPages .tp-pg[data-pg="synth:"]');
  await page.waitForFunction(() => document.body.classList.contains('synthpage'));
  // The page itself, in the palette, with the editor beside it; nothing worn.
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#161b22');
  const got = await page.evaluate(() => ({
    mode: state.mode,
    chosen: themeState.chosen,
    wave: !$('waveView').classList.contains('hidden'),
    dock: !$('tpDock').classList.contains('hidden'),
    editor: !!$('tpDock').querySelector('#tsEditor'),
    lit: document.querySelector('#tpLivePages .tp-pg.on')?.dataset.pg,
    // The editor holds what is worn — here nothing — while the page changes.
    dockBg: getComputedStyle($('tpDock')).getPropertyValue('--bg').trim(),
  }));
  expect(got.mode).toBe('synth');
  expect(got.chosen, 'previewing a page wore the palette').toBeNull();
  expect(got.wave).toBe(true);
  expect(got.dock).toBe(true);
  expect(got.editor, 'the editor did not come with the page').toBe(true);
  expect(got.lit).toBe('synth:');
  expect(got.dockBg).toBe(before);

  // Back to Theme: what is worn comes back, and the editor goes home.
  await page.click('#tpLiveBack');
  await page.waitForFunction(() => document.body.classList.contains('themepage'));
  expect(await bg(page)).toBe(before);
  expect(await page.evaluate(() => [
    $('tpDock').classList.contains('hidden'),
    !!document.querySelector('#themeView .tp-body #tsEditor'),
    document.body.classList.contains('tplive'),
  ])).toEqual([true, true, false]);
});

test('a Look chosen on the page is the Look the whole app wears', async ({ page }) => {
  await open(page);
  await page.click('#tpLooks [data-look="C"]');
  const got = await page.evaluate(() => ({
    look: document.documentElement.dataset.mglLook,
    stored: localStorage.getItem('mglLook'),
    chosen: themeState.chosen,
    open: tsSelected,
    tile: document.querySelector('#tpLooks [data-look="C"]').classList.contains('on'),
    chop: getComputedStyle(document.querySelector('.chop-app')).getPropertyValue('--ui').trim(),
  }));
  expect(got.look).toBe('C');
  expect(got.stored).toBe('C');
  expect(got.chosen).toBe('look-c');
  expect(got.open).toBe('look-c');
  expect(got.tile).toBe(true);
  expect(got.chop, 'Ceramic sets its own face').toContain('Space Grotesk');

  // And back, from the page, to the default.
  await page.click('#tpLooks [data-look="AD"]');
  expect(await page.evaluate(() => [document.documentElement.dataset.mglLook, themeState.chosen])).toEqual(['AD', 'look-ad']);
  await page.evaluate(() => { themeState.chosen = null; saveTheme(); applyChosenTheme(); });
});
