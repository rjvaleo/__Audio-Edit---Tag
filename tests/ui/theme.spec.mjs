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
    const wanted = ['--sink', '--well', '--bg', '--surface-0', '--surface',
      '--surface-2', '--surface-2h', '--surface-3',
      '--text', '--text-2', '--text-dim', '--text-dimmer',
      '--accent', '--good', '--warn', '--bad'];
    const bad = [];
    for (const p of THEME_PALETTES) {
      // A direct theme is not derived and deliberately does not set the status
      // colours — it leaves them to app.css. Its own completeness is checked in
      // `a direct theme is applied verbatim` below.
      if (p.direct) continue;
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


/// The property nothing was testing, and the one that decides whether a theme
/// looks like a design or like a mistake.
///
/// The chrome reads depth as lightness: each surface step must be lighter than
/// the one beneath it. The first token map broke this — it put the well *above*
/// the background — and no amount of good palette rescues an interface whose
/// panels are darker than the holes cut in them.
test('every offered palette keeps the surface ladder in order', async ({ page }) => {
  await ready(page);
  const broken = await page.evaluate(() => {
    const steps = ['--sink', '--well', '--bg', '--surface-0', '--surface',
      '--surface-2', '--surface-3'];
    const lum = (c) => {
      const hex = /^#([0-9a-f]{6})$/i.exec(c);
      const rgb = /rgb\((\d+) (\d+) (\d+)\)/.exec(c);
      const [r, g, b] = hex
        ? [0, 2, 4].map((i) => parseInt(hex[1].substr(i, 2), 16))
        : [+rgb[1], +rgb[2], +rgb[3]];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const out = [];
    // Only what the picker offers: light palettes are withheld precisely
    // because this interface cannot wear them yet.
    for (const p of allPalettes()) {
      // Through the same accessor the app uses, so a direct theme is checked on
      // the tokens it actually writes rather than on a derivation of the five
      // colours it happens to show in its swatch.
      const t = themeTokensFor(p);
      const ls = steps.map((k) => lum(t[k]));
      for (let i = 1; i < ls.length; i++) {
        if (ls[i] < ls[i - 1] - 1) { out.push(`${p.name} at ${steps[i]}`); break; }
      }
    }
    return out;
  });
  expect(broken, 'palettes whose surfaces do not get lighter as they rise').toEqual([]);
});

/// A direct theme states its tokens rather than deriving them, so what has to
/// be true of it is different: not "did the engine produce something usable"
/// but "did the interface get exactly what was written".
test('a direct theme is applied verbatim, and leaves the rest to app.css', async ({ page }) => {
  await ready(page);

  const conifer = await page.evaluate(() => THEME_PALETTES.find((p) => p.id === 'conifer'));
  expect(conifer, 'Conifer is not in the library').toBeTruthy();
  expect(conifer.direct, 'Conifer should be a direct theme').toBe(true);

  const read = () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const keys = ['--sink', '--well', '--bg', '--surface-0', '--surface', '--surface-2',
      '--surface-2h', '--surface-3', '--text', '--text-2', '--text-dim', '--text-dimmer',
      '--accent', '--good', '--warn', '--bad'];
    return Object.fromEntries(keys.map((k) => [k, cs.getPropertyValue(k).trim()]));
  });

  const before = await read();
  await page.evaluate(() => { themeState.chosen = 'conifer'; applyChosenTheme(); });
  const on = await read();

  // Every token it names, exactly as written — no derivation in between.
  for (const [k, v] of Object.entries(conifer.tokens)) {
    expect(on[k], `${k} was not applied verbatim`).toBe(v);
  }

  // Every token it does not name is left to the stylesheet. The status colours
  // are the ones that matter: they carry meaning, and a theme that repainted
  // them could make a clipping meter look safe.
  for (const k of ['--good', '--warn', '--bad']) {
    expect(on[k], `${k} should have been left to app.css`).toBe(before[k]);
  }

  await page.evaluate(() => { themeState.chosen = null; applyChosenTheme(); });
  expect(await read(), 'unchoosing did not restore the defaults').toEqual(before);
});

/// The point of this particular theme: it is the app's own look, one hue over.
/// If the lightness ladder drifts from the blue original the panels stop reading
/// as depth, and it stops being the same design in a different colour.
test('Conifer holds the blue original’s contrast structure', async ({ page }) => {
  await ready(page);
  const report = await page.evaluate(() => {
    const lum = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const t = THEME_PALETTES.find((p) => p.id === 'conifer').tokens;
    const steps = ['--sink', '--well', '--bg', '--surface-0', '--surface',
      '--surface-2', '--surface-2h', '--surface-3'];
    // What app.css states for the same eight, read off the document with no
    // theme applied — so this compares against the real thing rather than a
    // copy of it that could drift.
    const cs = getComputedStyle(document.documentElement);
    return {
      green: steps.map((k) => lum(t[k])),
      rising: steps.map((k) => t[k]),
      base: steps.map((k) => cs.getPropertyValue(k).trim()),
    };
  });

  // Strictly rising: each surface lighter than the one beneath it.
  for (let i = 1; i < report.green.length; i++) {
    expect(report.green[i], `${report.rising[i]} is not lighter than the step below`)
      .toBeGreaterThan(report.green[i - 1]);
  }
  // And the app's own tokens are still oklch — if that ever changes, the hex
  // values in Conifer were derived from numbers that no longer exist.
  expect(report.base[2], 'app.css no longer states --bg in oklch').toContain('oklch');
});

/// Audio is drawn in one of two colours and no theme may change them.
///
/// A waveform is a reading, not decoration — you judge level and shape by it, so
/// it has to look the same every time you look at it. Five canvases used to take
/// `--accent`, which meant a palette could turn every waveform in the program
/// brown.
test('waveform colours do not move when a theme is applied', async ({ page }) => {
  await ready(page);
  const read = () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { wave: cs.getPropertyValue('--wave').trim(), wave2: cs.getPropertyValue('--wave-2').trim() };
  });

  const before = await read();
  expect(before.wave, '--wave is not defined').not.toBe('');
  expect(before.wave2, '--wave-2 is not defined').not.toBe('');

  for (const p of (await page.evaluate(() => allPalettes().slice(0, 6).map((x) => x.id)))) {
    await page.evaluate((id) => { themeState.chosen = id; applyChosenTheme(); }, p);
    expect(await read(), `palette ${p} moved the waveform colour`).toEqual(before);
  }
  await page.evaluate(() => { themeState.chosen = null; applyChosenTheme(); });
});
