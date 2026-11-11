// The look reaches every page (consistency pass, phase 1, 11 Nov 2026).
//
// Grain, Wave and Chop are drawn in one look, `--look-*` in
// `ui/app-css/015-tokens.css`, which their own names (`--gs-*`, `--wv-*`,
// Chop's `--chassis` …) are aliases of. So a theme that changes the look
// changes all three; before, choosing Studio light left them dark. And Chop's
// five Looks are themes now, chosen on the Theme page or from the Now Playing
// bar, rather than a switch of Chop's own.

import { test, expect } from './test.mjs';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, null, { timeout: 20_000 });
}

/// What the three pages' own frames are painted with: their ground, their
/// text, and their "on".
const surfaces = (page) => page.evaluate(() => {
  const read = (el, on) => {
    const s = getComputedStyle(el);
    return { ground: s.backgroundImage, text: s.color, on: s.getPropertyValue(on).trim() };
  };
  return {
    grain: read($('grainView'), '--gs-on'),
    wave: read($('waveView'), '--wv-acc'),
    chop: read(document.querySelector('.chop-app'), '--acc'),
  };
});

const wear = (page, id) => page.evaluate((x) => { themeState.chosen = x; saveTheme(); applyChosenTheme(); }, id);

test('the default theme is the look as Wave set it, with orange for on', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    const w = getComputedStyle($('waveView')), g = getComputedStyle($('grainView'));
    return { panel: w.getPropertyValue('--wv-panel').trim(), acc: w.getPropertyValue('--wv-acc').trim(),
      grain: g.getPropertyValue('--gs-panel').trim(), on: g.getPropertyValue('--gs-on').trim() };
  });
  expect(got).toEqual({ panel: '#1b1d21', acc: '#7cf0d0', grain: '#1b1d21', on: '#ffb547' });
});

test('a light theme changes Grain\'s, Wave\'s and Chop\'s surfaces, text and on', async ({ page }) => {
  await ready(page);
  const before = await surfaces(page);
  await wear(page, 'studio-light');
  const light = await surfaces(page);
  for (const k of ['grain', 'wave', 'chop']) {
    expect(light[k].ground, `${k}: its ground did not change`).not.toBe(before[k].ground);
    expect(light[k].text, `${k}: its text did not change`).not.toBe(before[k].text);
    // One accent for "on" per theme: Studio light's blue.
    expect(light[k].on, `${k}: "on" is not the theme's accent`).toBe('#2452c2');
  }
  await wear(page, null);
  expect(await surfaces(page), 'taking the theme off did not give the look back').toEqual(before);
});

test('Chop\'s Looks are on the Theme page, and its own switch is gone', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#chopLook')).toHaveCount(0);
  const names = await page.evaluate(() => allPalettes().filter((p) => p.look).map((p) => `${p.look} ${p.name}`));
  expect(names).toEqual(['AD Graphite + Acrylic', 'A Graphite', 'B Glass', 'C Ceramic', 'D Acrylic']);
  await page.evaluate(() => showPane('left', 'theme'));
  await expect(page.locator('#themeList .theme-row', { hasText: 'Ceramic' })).toHaveCount(1);
});

test('whoever had picked a Look gets its theme, once', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { localStorage.removeItem('audiolab.theme'); localStorage.setItem('mglLook', 'C'); });
  await page.reload();
  await page.waitForFunction(() => typeof themeState !== 'undefined');
  const got = await page.evaluate(() => ({
    chosen: themeState.chosen, look: document.documentElement.dataset.mglLook,
    ui: getComputedStyle(document.querySelector('.chop-app')).getPropertyValue('--ui').trim(),
  }));
  expect(got.chosen).toBe('look-c');
  expect(got.look).toBe('C');
  expect(got.ui, 'Ceramic sets its own face').toContain('Space Grotesk');
  // Once: taking the theme off afterwards is not undone at the next load.
  await wear(page, null);
  await page.reload();
  await page.waitForFunction(() => typeof themeState !== 'undefined');
  expect(await page.evaluate(() => [themeState.chosen, document.documentElement.dataset.mglLook])).toEqual([null, 'AD']);
});

test('a Look from the Now Playing bar is its theme', async ({ page }) => {
  await ready(page);
  await page.click('#nbLook button[data-s="B"]');
  expect(await page.evaluate(() => [themeState.chosen, document.documentElement.dataset.mglLook,
    getComputedStyle($('waveView')).getPropertyValue('--wv-chassis').trim()])).toEqual(['look-b', 'B', '#0a0c10']);
  await page.click('#nbLook button[data-s="AD"]');
  await wear(page, null);
});
