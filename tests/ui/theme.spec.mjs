// The theme engine, ported from Emovis.
//
// The engine's arithmetic came over transpiled rather than retyped, so what
// needs testing here is not the maths — it is the half that did not exist in
// either program: the map from its 86 tokens onto this app's 22, and whether
// applying one actually changes what is on screen.

import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, {
    timeout: 15_000,
  });
}

test('the engine and its palettes are served and loaded', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => ({
    engine: typeof Theme?.deriveTheme === 'function',
    map: typeof Theme?.appTokens === 'function',
    palettes: (typeof THEME_PALETTES !== 'undefined' && THEME_PALETTES.length) || 0,
  }));
  expect(got.engine, 'the derivation engine did not load').toBe(true);
  expect(got.map, 'the token map did not load').toBe(true);
  expect(got.palettes, 'the palette library is empty').toBeGreaterThan(40);
});

test('every palette derives a complete set of this app’s tokens', async ({ page }) => {
  await ready(page);
  const report = await page.evaluate(() => {
    const wanted = ['--bg', '--surface', '--surface-2', '--surface-3', '--well',
      '--text', '--text-2', '--text-dim', '--text-dimmer',
      '--line', '--line-2', '--accent', '--good', '--warn', '--bad'];
    const bad = [];
    for (const p of THEME_PALETTES) {
      const { tokens } = Theme.appTokens(p.colors);
      const missing = wanted.filter((k) => !tokens[k]);
      if (missing.length) bad.push(`${p.name}: ${missing.join(',')}`);
    }
    return { count: THEME_PALETTES.length, bad };
  });
  expect(report.bad, 'palettes that did not derive a full theme').toEqual([]);
  expect(report.count).toBeGreaterThan(40);
});

/// The point of the whole exercise: choosing a palette has to change the pixels.
test('choosing a palette repaints the interface, and unchoosing restores it', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => showPane('left', 'theme'));
  await page.waitForTimeout(200);

  const read = () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      bg: cs.getPropertyValue('--bg').trim(),
      text: cs.getPropertyValue('--text').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
    };
  });

  const before = await read();
  expect(before.bg, 'the app should start on its own colours').toContain('oklch');

  await page.evaluate(() => {
    themeState.chosen = THEME_PALETTES[0].id;
    applyChosenTheme();
  });
  const themed = await read();
  expect(themed.bg, 'the background did not change').not.toBe(before.bg);
  expect(themed.text).not.toBe(before.text);
  expect(themed.accent).not.toBe(before.accent);

  await page.evaluate(() => { themeState.chosen = null; applyChosenTheme(); });
  const after = await read();
  expect(after, 'removing the theme did not restore the defaults').toEqual(before);
});

/// Good, warning and bad carry meaning. A palette may not repaint them into
/// each other, or a theme could make a clipping meter look safe.
test('status colours stay recognisable under every palette', async ({ page }) => {
  await ready(page);
  const bad = await page.evaluate(() => {
    const hue = (hex) => {
      const [r, g, b] = Theme.hexToRgb(hex);
      return Theme.rgbToHsl([r, g, b]).h;
    };
    const near = (a, b, within) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= within;
    const out = [];
    for (const p of THEME_PALETTES) {
      const t = Theme.appTokens(p.colors).tokens;
      // Green-ish, amber-ish, red-ish. Wide bands: the engine moves their pitch
      // to sit on each theme's surfaces, it just may not move their hue.
      if (!near(hue(t['--good']), 145, 40)) out.push(`${p.name} good=${t['--good']}`);
      if (!near(hue(t['--warn']), 42, 40)) out.push(`${p.name} warn=${t['--warn']}`);
      if (!near(hue(t['--bad']), 355, 40)) out.push(`${p.name} bad=${t['--bad']}`);
    }
    return out;
  });
  expect(bad, 'a palette moved a status colour off its meaning').toEqual([]);
});
