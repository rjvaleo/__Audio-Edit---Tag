// The shared preset bar (`ui/app/105-preset-bar.js`, `106-preset-bar-pop.js`), on
// its own: one bar made on the page with an adapter that keeps its presets in a
// plain list, so what each control does can be read straight back.
//
// What this pins: the arrows step and wrap; the list opens, searches, groups
// Factory before Yours and loads by click or by key; A/B; Save is lit only when
// edited; every ⋯ item with its keys; Delete asks, and Cancel keeps it; a
// factory preset can't be renamed or deleted, and Save on one asks for a name.

import { test, expect } from './test.mjs';
import { bar, pbName, pbLit, pbStep, pbOpenList, pbPick, pbMenu, pbSaveAs, pbRename, pop } from './preset-bar.helpers.mjs';

/// A bar on the page, `#specPb`, over `window.T`: its list, what is loaded, the
/// settings (`T.v`), A/B and every call the bar made.
async function mount(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof pbarMake === 'function' && typeof state !== 'undefined');
  await page.evaluate(() => {
    window.T = {
      list: [{ name: 'Glass', tag: 'Pad', factory: true }, { name: 'Iron', tag: 'Bass', factory: true }, { name: 'Mine', tag: 'Lead' }, { name: 'Yours too' }],
      cur: '', v: 0, ab: 'A', calls: [],
    };
    const a = {
      list: () => T.list,
      current: () => T.cur,
      snapshot: () => T.v,
      load: (p) => { T.calls.push(['load', p.name]); T.cur = p.name; T.v = T.list.indexOf(p) * 10; },
      save: (n) => { T.calls.push(['save', n]); },
      saveAs: (n) => { T.calls.push(['saveAs', n]); if (!T.list.some((p) => p.name === n)) T.list.push({ name: n }); T.cur = n; },
      rename: (from, to) => { T.calls.push(['rename', from, to]); T.list.find((p) => p.name === from).name = to; if (T.cur === from) T.cur = to; },
      remove: (n) => { T.calls.push(['remove', n]); T.list = T.list.filter((p) => p.name !== n); if (T.cur === n) T.cur = ''; },
      init: () => { T.calls.push(['init']); T.cur = ''; T.v = -1; },
    };
    const x = pbarButton('', 'Extra', 'The page\'s own');
    x.id = 'specExtra';
    const b = pbarMake({ id: 'spec', adapter: a, title: 'Spec', ab: { get: () => T.ab, set: (k) => { T.ab = k; } }, extras: [x] });
    const host = document.createElement('div');
    host.id = 'specHost';
    host.setAttribute('style', 'position:fixed;left:40px;top:300px;z-index:8000');
    host.appendChild(b.el);
    document.body.appendChild(host);
    window.SPEC = b;
  });
}
const T = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.T)));

test('the arrows step through Factory then Yours, and wrap', async ({ page }) => {
  await mount(page);
  expect(await pbName(page, 'spec')).toBe('No preset');
  await pbStep(page, 'spec', 1);
  expect(await pbName(page, 'spec')).toBe('Glass');
  await expect(bar(page, 'spec').locator('[data-pb="tag"]')).toContainText('Factory');
  await pbStep(page, 'spec', -1);
  expect(await pbName(page, 'spec')).toBe('Yours too');
  await pbStep(page, 'spec', 1);
  expect(await pbName(page, 'spec')).toBe('Glass');
  await expect(page.locator('#specExtra')).toBeVisible();
});

test('the list: searched, Factory before Yours, loaded by a click or by the keys', async ({ page }) => {
  await mount(page);
  await pbOpenList(page, 'spec');
  await expect(pop(page).locator('.pbar-grp')).toHaveText([/Factory\s*2/, /Yours\s*2/]);
  await expect(pop(page).locator('.pbar-rn')).toHaveText(['Glass', 'Iron', 'Mine', 'Yours too']);
  await expect(pop(page).locator('.pbar-search input')).toBeFocused();
  await page.keyboard.type('ron');
  await expect(pop(page).locator('.pbar-rn')).toHaveText(['Iron']);
  await page.keyboard.press('Enter');
  await expect(pop(page)).toHaveCount(0);
  expect(await pbName(page, 'spec')).toBe('Iron');
  // ↓ from the loaded one, then ⏎.
  await pbOpenList(page, 'spec');
  await expect(pop(page).locator('.pbar-row.cur .pbar-rn')).toHaveText('Iron');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect(await pbName(page, 'spec')).toBe('Mine');
  // A click, and Esc closes without loading.
  await pbPick(page, 'spec', 'Yours too');
  expect(await pbName(page, 'spec')).toBe('Yours too');
  await pbOpenList(page, 'spec');
  await page.keyboard.press('Escape');
  await expect(pop(page)).toHaveCount(0);
  expect((await T(page)).calls.filter((c) => c[0] === 'load').map((c) => c[1])).toEqual(['Iron', 'Mine', 'Yours too']);
});

test('A/B switches through the page, and shows which', async ({ page }) => {
  await mount(page);
  await expect(page.locator('#specAB [data-ab="A"]')).toHaveClass(/\bon\b/);
  await page.locator('#specAB [data-ab="B"]').click();
  expect((await T(page)).ab).toBe('B');
  await expect(page.locator('#specAB [data-ab="B"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#specAB [data-ab="A"]')).not.toHaveClass(/\bon\b/);
});

test('Save is lit when the preset has been edited, and saves over it', async ({ page }) => {
  await mount(page);
  await pbPick(page, 'spec', 'Mine');
  await page.waitForTimeout(600);
  expect(await pbLit(page, 'spec')).toBe(false);
  await expect(bar(page, 'spec').locator('[data-pb="dirty"]')).toBeHidden();
  await page.evaluate(() => { T.v = 99; });
  await expect.poll(() => pbLit(page, 'spec')).toBe(true);
  await expect(bar(page, 'spec').locator('[data-pb="dirty"]')).toBeVisible();
  await bar(page, 'spec').locator('[data-pb="save"]').click();
  expect((await T(page)).calls.at(-1)).toEqual(['save', 'Mine']);
  await expect.poll(() => pbLit(page, 'spec')).toBe(false);
});

test('a factory preset: Save asks for a name, Rename and Delete are off', async ({ page }) => {
  await mount(page);
  await pbPick(page, 'spec', 'Glass');
  await bar(page, 'spec').locator('[data-pb="more"]').click();
  await expect(pop(page).locator('[data-mi="rename"]')).toHaveClass(/\bdis\b/);
  await expect(pop(page).locator('[data-mi="delete"]')).toHaveClass(/\bdis\b/);
  // A click on one does nothing: the menu stays.
  await pop(page).locator('[data-mi="delete"]').click({ force: true });
  await expect(page.locator('.pbar-pop.pbar-menu')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // F2 does nothing on one.
  await page.keyboard.press('F2');
  await expect(pop(page)).toHaveCount(0);
  await bar(page, 'spec').locator('[data-pb="save"]').click();
  const field = pop(page).locator('.pbar-field');
  await expect(field).toBeFocused();
  // Its own name is refused: a factory preset is never saved over.
  await field.fill('Glass');
  await expect(pop(page).locator('[data-a="ok"]')).toBeDisabled();
  await expect(pop(page).locator('.pbar-note')).toContainText('factory');
  await field.fill('Glass, mine');
  await field.press('Enter');
  expect((await T(page)).calls.at(-1)).toEqual(['saveAs', 'Glass, mine']);
  expect(await pbName(page, 'spec')).toBe('Glass, mine');
});

test('the ⋯ menu: Save as, Rename, Init and Delete, each with its keys shown', async ({ page }) => {
  await mount(page);
  await pbPick(page, 'spec', 'Mine');
  await bar(page, 'spec').locator('[data-pb="more"]').click();
  await expect(pop(page).locator('.pbar-mi .pbar-ml')).toHaveText(['Save as…', 'Rename…', 'Init', 'Delete…']);
  await expect(pop(page).locator('.pbar-mi .pbar-mk')).toHaveText(['⇧⌘S', 'F2', '', '⌫']);
  await expect(pop(page).locator('.pbar-mi.danger')).toHaveText(/Delete/);
  await expect(pop(page).locator('.pbar-msep')).toHaveCount(1);
  await page.keyboard.press('Escape');

  await pbSaveAs(page, 'spec', 'Copy of mine');
  expect((await T(page)).calls.at(-1)).toEqual(['saveAs', 'Copy of mine']);
  expect(await pbName(page, 'spec')).toBe('Copy of mine');

  // Rename: a name that is taken is refused; Esc leaves it alone.
  await pbMenu(page, 'spec', 'rename');
  await pop(page).locator('.pbar-field').fill('Mine');
  await expect(pop(page).locator('[data-a="ok"]')).toBeDisabled();
  await expect(pop(page).locator('.pbar-note')).toHaveText('That name is taken');
  await page.keyboard.press('Escape');
  await pbRename(page, 'spec', 'Renamed');
  expect((await T(page)).calls.at(-1)).toEqual(['rename', 'Copy of mine', 'Renamed']);
  expect(await pbName(page, 'spec')).toBe('Renamed');

  // The keys, in the menu: F2 renames.
  await bar(page, 'spec').locator('[data-pb="more"]').click();
  await page.keyboard.press('F2');
  await expect(pop(page).locator('.pbar-field')).toHaveValue('Renamed');
  await page.keyboard.press('Escape');
  // And on the page: F2, and ⇧⌘S for Save as.
  await page.evaluate(() => { PBAR.last = SPEC; document.activeElement?.blur(); });
  await page.keyboard.press('F2');
  await expect(pop(page).locator('.pbar-askh')).toHaveText('Rename “Renamed”');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+S');
  await expect(pop(page).locator('.pbar-askh')).toHaveText('Save these settings as');
  await page.keyboard.press('Escape');

  await pbMenu(page, 'spec', 'init');
  expect((await T(page)).calls.at(-1)).toEqual(['init']);
  expect(await pbName(page, 'spec')).toBe('No preset');
});

test('Delete always asks first: Cancel keeps it, Delete takes it', async ({ page }) => {
  await mount(page);
  await pbPick(page, 'spec', 'Mine');
  await pbMenu(page, 'spec', 'delete');
  await expect(pop(page).locator('.pbar-askh')).toHaveText('Delete “Mine”?');
  await pop(page).locator('[data-a="no"]').click();
  expect((await T(page)).list.map((p) => p.name)).toContain('Mine');
  // ⌫ in the menu is Delete…, which still asks.
  await bar(page, 'spec').locator('[data-pb="more"]').click();
  await page.keyboard.press('Backspace');
  await expect(pop(page).locator('.pbar-askh')).toHaveText('Delete “Mine”?');
  await pop(page).locator('[data-a="ok"]').click();
  expect((await T(page)).calls.at(-1)).toEqual(['remove', 'Mine']);
  expect((await T(page)).list.map((p) => p.name)).not.toContain('Mine');
  expect(await pbName(page, 'spec')).toBe('No preset');
  // Nothing loaded: nothing to delete or rename.
  await bar(page, 'spec').locator('[data-pb="more"]').click();
  await expect(pop(page).locator('[data-mi="delete"]')).toHaveClass(/\bdis\b/);
  await expect(pop(page).locator('[data-mi="rename"]')).toHaveClass(/\bdis\b/);
});

test('a failure is said, and the bar carries on', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { SPEC.a.load = () => { throw new Error('Spec: that one is gone'); }; });
  await pbStep(page, 'spec', 1);
  await expect(page.locator('#toast')).toContainText('Spec: that one is gone');
  expect(await pbName(page, 'spec')).toBe('No preset');
});
