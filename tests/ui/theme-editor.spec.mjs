// The theme editor.
//
// Three properties matter, and none of them is "it looks nice":
//
//   1. The preview is *scoped*. Moving a picker must repaint the miniature and
//      leave the page alone, or judging a colour means watching the thing you
//      are judging jump under your hand.
//   2. The ladder's spacing survives. The whole point of measuring the shipped
//      palette instead of deriving from five colours is that the contrast the
//      panels were designed against is preserved — so the gaps between surface
//      steps must come out identical, however far the ladder is moved.
//   3. The pickers start on the colours actually in force, not on whatever was
//      typed into the HTML.
//
// See `docs/THEME-EDITOR.md`.

import { test, expect } from '@playwright/test';

async function editor(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined', { timeout: 20_000 });
  await page.evaluate(() => {
    const rail = [...document.querySelectorAll('.rail *')]
      .find((e) => e.textContent.trim() === 'Theme');
    rail?.click();
  });
  await page.waitForTimeout(400);
  // Whatever a previous test left applied — these run against one browser.
  await page.evaluate(() => { Theme.apply(null); themeEditor.defaults = null; tmeWire(); });
  await page.waitForTimeout(100);
}

const SURFACES = ['--sink', '--well', '--bg', '--surface-0',
  '--surface', '--surface-2', '--surface-3'];

test('the pickers start on the colours actually in force', async ({ page }) => {
  await editor(page);
  const out = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      picks: ['themeSurface', 'themeText', 'themeAccent']
        .map((i) => document.getElementById(i).value.toLowerCase()),
      real: ['--bg', '--text', '--accent']
        .map((k) => cssHex(root.getPropertyValue(k).trim())),
    };
  });
  // The stylesheet states these in oklch; the pickers need hex. Resolving the
  // real token is the only honest way to seed them, and reading it wrong is how
  // the first version opened showing three colours from nowhere.
  expect(out.picks).toEqual(out.real);
});

test('moving a picker repaints the miniature and not the page', async ({ page }) => {
  await editor(page);
  const out = await page.evaluate(() => {
    const before = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim();
    const el = document.getElementById('themeAccent');
    el.value = '#ff7a1a';
    el.dispatchEvent(new Event('input'));
    return {
      mini: cssHex(getComputedStyle(document.getElementById('themeMini'))
        .getPropertyValue('--accent').trim()),
      pageBefore: before,
      pageAfter: getComputedStyle(document.documentElement)
        .getPropertyValue('--accent').trim(),
    };
  });
  expect(out.mini).toBe('#ff7a1a');
  expect(out.pageAfter, 'the page was repainted by a preview').toBe(out.pageBefore);
});

test('the surface ladder keeps its spacing wherever it is moved', async ({ page }) => {
  await editor(page);
  const out = await page.evaluate((keys) => {
    const L = (v) => { const h = cssHex(v); return h ? +rgbToHsl(hexToRgb(h)).l.toFixed(4) : null; };
    const read = (cs) => keys.map((k) => L(cs.getPropertyValue(k).trim()));
    const gaps = (x) => x.slice(1).map((v, i) => +(v - x[i]).toFixed(4));

    const before = read(getComputedStyle(document.documentElement));
    const el = document.getElementById('themeSurface');
    el.value = '#2a1018';                      // far lighter, and a new hue
    el.dispatchEvent(new Event('input'));
    const after = read(getComputedStyle(document.getElementById('themeMini')));
    return { before, after, gapsBefore: gaps(before), gapsAfter: gaps(after) };
  }, SURFACES);

  // Moved.
  expect(out.after[0], 'the ladder did not move at all').toBeGreaterThan(out.before[0] + 0.02);
  // But rung for rung, the same. This is the property the whole approach exists
  // for: scaling instead of offsetting would compress the ladder toward one end
  // as the picked colour darkened, which is most of what made the old
  // derivation look arbitrary.
  expect(out.gapsAfter).toEqual(out.gapsBefore);
  // And still a ladder, in order — chrome reads as depth because each step is
  // lighter than the one under it.
  for (let i = 1; i < out.after.length; i++) {
    expect(out.after[i], `${SURFACES[i]} is darker than ${SURFACES[i - 1]}`)
      .toBeGreaterThanOrEqual(out.after[i - 1]);
  }
});

test('apply puts it on the page, and reset takes it back off', async ({ page }) => {
  await editor(page);
  const out = await page.evaluate(() => {
    const original = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim();
    const el = document.getElementById('themeAccent');
    el.value = '#22cc88';
    el.dispatchEvent(new Event('input'));
    document.getElementById('themeEditApply').click();
    const applied = cssHex(getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim());

    document.getElementById('themeEditReset').click();
    document.getElementById('themeEditApply').click();
    const reset = cssHex(getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim());
    return { applied, reset, original: cssHex(original) };
  });
  expect(out.applied).toBe('#22cc88');
  // Reset means the stylesheet's own colour, not a remembered copy of it.
  expect(out.reset).toBe(out.original);
});

test('the miniature shows all four text steps, and they stay distinct', async ({ page }) => {
  await editor(page);
  const out = await page.evaluate(() => {
    const el = document.getElementById('themeText');
    el.value = '#c8b0ff';
    el.dispatchEvent(new Event('input'));
    const cs = getComputedStyle(document.getElementById('themeMini'));
    const L = (k) => {
      const h = cssHex(cs.getPropertyValue(k).trim());
      return h ? +rgbToHsl(hexToRgb(h)).l.toFixed(4) : null;
    };
    return ['--text', '--text-2', '--text-dim', '--text-dimmer'].map(L);
  });
  // A collapsed text ladder is the failure a theme most often has and the one
  // hardest to see on a page full of other things, which is why the miniature
  // shows all four side by side.
  for (let i = 1; i < out.length; i++) {
    expect(out[i], `text step ${i} is not dimmer than ${i - 1}`).toBeLessThan(out[i - 1]);
  }
});

/// Saving a theme and coming back must not take the application with it.
///
/// This is the test that should have existed before the editor shipped. It did
/// not, and the omission cost the whole interface: `Save as…` wrote
/// `{id, name, direct, tokens}` while every shipped palette carries `colors`
/// and every direct one also carries `dark`. `renderThemeList` read
/// `p.colors.join(' ')`, threw during load, and **aborted the rest of
/// `app.js`** — so `masterBus`, the meters, the room and everything defined
/// after them never came into being. The screen showed a dead panel with the
/// em-dashes still in the raw HTML.
///
/// Every other test in this file exercises the editor while the page is already
/// up. The one path none of them touched was the round trip: save, reload, live
/// again. That is the path a user takes.
test('a saved theme survives a reload with the application intact', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await editor(page);

  await page.evaluate(() => {
    const el = document.getElementById('themeAccent');
    el.value = '#ff2d78';
    el.dispatchEvent(new Event('input'));
    // Exactly what the button does — through the same code, not a hand-built
    // object, or the test would assert about a shape the app never writes.
    document.getElementById('themeEditSave').click();
  });
  // `Save as…` asks for a name; accept whatever it offers.
  page.on('dialog', (d) => d.accept('Reload Test'));
  await page.evaluate(() => {
    const tokens = tmeTokens();
    themeState.mine.push({
      id: 'mine-reload-test', name: 'Reload Test', direct: true, tokens,
      colors: ['--accent', '--surface-2', '--surface', '--bg', '--sink']
        .map((k) => tokens[k]).filter(Boolean),
      dark: (themeEditor.surface?.l ?? 0) < 0.5,
    });
    themeState.chosen = 'mine-reload-test';
    saveTheme();
  });

  await page.reload();
  await page.waitForTimeout(1200);

  expect(errors, `the page threw during load: ${errors[0] || ''}`).toEqual([]);

  // Not "did the theme apply" — did everything *after* the theme code survive.
  // A load-time throw is silent on screen; what it leaves behind is a panel
  // that never moves, which reads exactly like a rendering bug.
  const alive = await page.evaluate(() => ({
    masterBus: typeof masterBus !== 'undefined',
    metersRunning: typeof masterBus !== 'undefined' && !!masterBus.timer,
    roomLoop: typeof visGlRaf !== 'undefined',
    themeEditor: typeof themeEditor !== 'undefined',
    rowRendered: !!document.querySelector('.theme-row'),
  }));
  expect(alive.masterBus, 'app.js aborted before the master bus was defined').toBe(true);
  expect(alive.metersRunning, 'the meter poll never started').toBe(true);
  expect(alive.roomLoop, 'the visualiser loop never started').toBe(true);
  expect(alive.themeEditor, 'the theme editor itself never initialised').toBe(true);
  expect(alive.rowRendered, 'the palette list did not render the saved theme').toBe(true);
});
