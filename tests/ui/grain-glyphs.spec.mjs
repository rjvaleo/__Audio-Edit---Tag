// The grain controls' glyphs. See `docs/design/grain-icons.html` and
// `ui/grain-glyphs.js`.
//
// Every knob in the Grain tray that has a picture shows it above the knob, and
// the picture is of the value, not of the control: turn the knob and the
// drawing changes. Nothing else about the knob may move — it is still the same
// range input, read by presets, Random, automation and the resets.

import { test, expect } from './test.mjs';

/// Every key with a glyph. Stretch, Pitch and Window are Time and pitch's; the
/// rest are `state.grainRows`.
const KEYS = [
  'ratio', 'semitones', 'windowMs',
  'position', 'rateHz', 'densityHz', 'layers', 'overlap', 'sizeJitter', 'positionJitterMs',
  'pitchJitterSemis', 'pitchDriftSemis', 'driftRateHz',
  'scan', 'envelope', 'sizeRange', 'layerSpread', 'panSpread', 'layerScatter', 'layerScatterMs',
];

async function openGrain(page) {
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
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, { timeout: 20_000 });
  await page.locator('.dock-tab[data-dock="stretch"]').click();
  await page.waitForTimeout(300);
}

test('every grain control carries a glyph at the front of its slider row', async ({ page }) => {
  await openGrain(page);
  const got = await page.evaluate((keys) => keys.map((key) => {
    const row = document.querySelector(`#grainControls .gk-row[data-glyph="${key}"]`);
    const g = row?.querySelector(':scope > .gg');
    const input = row?.querySelector(':scope > input[type=range]');
    if (!g || !input) return { key, ok: false };
    const a = g.getBoundingClientRect(), b = input.getBoundingClientRect();
    return { key, ok: true, before: a.right <= b.left + 1, drawn: g.querySelectorAll('path, line, circle').length };
  }), KEYS);
  for (const r of got) {
    expect(r.ok, `${r.key} has a glyph`).toBe(true);
    expect(r.before, `${r.key}'s glyph sits before its slider`).toBe(true);
    expect(r.drawn, `${r.key}'s glyph draws something`).toBeGreaterThan(0);
  }
});

test('the glyph is a picture of the value: moving the slider redraws it', async ({ page }) => {
  await openGrain(page);
  const changed = await page.evaluate((keys) => keys.filter((key) => {
    const row = document.querySelector(`#grainControls .gk-row[data-glyph="${key}"]`);
    const input = row.querySelector(':scope > input[type=range]');
    const g = row.querySelector(':scope > .gg');
    const before = g.innerHTML;
    const was = input.value;
    // From one end to the other, as a drag would: the value, then the event.
    input.value = +input.value === +input.min ? input.max : input.min;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const after = g.innerHTML;
    input.value = was;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return before === after;
  }), KEYS);
  expect(changed, 'glyphs that did not change with their slider').toEqual([]);
});

test('a value pushed in from outside — reset, preset, undo — redraws the glyph too', async ({ page }) => {
  await openGrain(page);
  const same = await page.evaluate(() => {
    const row = state.grainRows.densityHz;
    const g = row.querySelector(':scope > .gg');
    const before = g.innerHTML;
    row.sync(400);
    const after = g.innerHTML;
    row.sync(0);
    return before === after;
  });
  expect(same).toBe(false);
});

test('each picture is drawn in the colour of what it changes, and every heading in one colour', async ({ page }) => {
  await openGrain(page);
  const got = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const wrong = [];
    for (const g of document.querySelectorAll('#grainControls .gk-row > .gg')) {
      const key = g.parentElement.dataset.glyph;
      const want = css.getPropertyValue(`--f-${GG_FACET[key] || 'time'}`).trim();
      const has = getComputedStyle(g).getPropertyValue('--gg').trim();
      if (!want || has !== want) wrong.push(`${key}: ${has} not ${want}`);
    }
    const heads = [...document.querySelectorAll('#grainControls .wild-head')].filter((h) => h.getClientRects().length).map((h) => getComputedStyle(h).color);
    return { wrong, heads: new Set(heads).size };
  });
  expect(got.wrong).toEqual([]);
  expect(got.heads).toBe(1);
});

test('the glyph is decoration: the slider keeps its name for a screen reader', async ({ page }) => {
  await openGrain(page);
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('#grainControls .gk-row > .gg')].every((g) => g.getAttribute('aria-hidden') === 'true'));
  expect(hidden).toBe(true);
});

test('the splice and the seed have pictures too, and a choice redraws its own', async ({ page }) => {
  await openGrain(page);
  const keys = ['searchMs', 'splicePick', 'spliceShape', 'stride', 'seed'];
  const drawn = await page.evaluate((keys) => keys.map((key) =>
    document.querySelector(`#grainControls .gk-row[data-glyph="${key}"] > .gg`)?.querySelectorAll('path, line, circle').length || 0), keys);
  drawn.forEach((n, i) => expect(n, `${keys[i]} draws something`).toBeGreaterThan(0));

  const shape = page.locator('#grainControls .gk-row[data-glyph="spliceShape"]');
  const before = await shape.locator('.gg').innerHTML();
  await shape.locator('.seg-btn', { hasText: 'rect' }).click();
  await expect.poll(() => shape.locator('.gg').innerHTML()).not.toBe(before);
  await shape.locator('.seg-btn', { hasText: 'hann' }).click();
  await expect.poll(() => shape.locator('.gg').innerHTML()).toBe(before);
});

test('a jitter moves in its picture, and at zero it is still', async ({ page }) => {
  await openGrain(page);
  const frames = (key) => page.evaluate(async (key) => {
    const g = state.grainRows[key].querySelector(':scope > .gg');
    const seen = new Set();
    for (let i = 0; i < 5; i++) { seen.add(g.innerHTML); await new Promise((r) => setTimeout(r, 120)); }
    return seen.size;
  }, key);
  const set = (key, at) => page.evaluate(([key, at]) => {
    const input = state.grainRows[key].querySelector(':scope > input[type=range]');
    input.value = +input.min + (+input.max - +input.min) * at;
  }, [key, at]);
  for (const key of ['sizeJitter', 'positionJitterMs', 'pitchJitterSemis', 'pitchDriftSemis']) {
    await set(key, 0.6);
    expect(await frames(key), `${key} moves`).toBeGreaterThan(1);
    await set(key, 0);
    expect(await frames(key), `${key} is still at zero`).toBe(1);
  }
});

test('every engine\'s own sliders have pictures, with the grain cloud and the transient detector on', async ({ page }) => {
  await openGrain(page);
  const host = page.locator('#grainControls');
  const bare = async () => page.evaluate(() => [...document.querySelectorAll('#grainControls .param, #extEngine .param')]
    .filter((r) => r.offsetParent && r.querySelector(':scope > input[type=range]') && !r.querySelector(':scope > .gg'))
    .map((r) => r.textContent.trim().slice(0, 24)));
  const on = async (label) => {
    const sw = host.locator(`.switch[data-name="${label}"]`);
    if (!(await sw.count())) return;
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  };
  for (const alg of ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular']) {
    await host.locator(`.seg-btn[data-alg="${alg}"]`).click();
    await page.waitForTimeout(200);
    await on('grain cloud');
    await on('preserve transients');
    await page.waitForTimeout(200);
    expect(await bare(), `${alg}: sliders without a picture`).toEqual([]);
    // The two switches really did bring their sliders out, pictured.
    if (alg !== 'granular') await expect(page.locator('.gk-row[data-glyph="cloudMix"] > .gg')).toHaveCount(1);
    if (alg === 'wsola' || alg === 'hybrid') await expect(page.locator('.gk-row[data-glyph="sensitivity"] > .gg')).toHaveCount(1);
  }
});

test('the colour key is in Help, not across the tray', async ({ page }) => {
  await openGrain(page);
  await expect(page.locator('#grainControls .gc-key')).toHaveCount(0);
  // Help, in the top bar.
  await page.locator('header.menubar .menu-title', { hasText: 'Help' }).click();
  await page.locator('#menuPop', { hasText: 'What the colours mean' }).getByText('What the colours mean').click();
  await expect(page.locator('#colourKey')).toBeVisible();
  await expect(page.locator('#colourKeyList .ck-name')).toHaveText(['Time', 'Pitch', 'Timbre', 'Attack', 'Space', 'Level']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#colourKey')).toBeHidden();
});

test('a bar keeps its width whatever its value', async ({ page }) => {
  await openGrain(page);
  const widths = () => page.evaluate(() => [...document.querySelectorAll('#grainControls .gk-row')]
    .filter((r) => r.getClientRects().length).map((r) => Math.round(r.getBoundingClientRect().width)));
  const before = await widths();
  await page.evaluate(() => {
    for (const key of ['positionJitterMs', 'densityHz', 'rateHz', 'overlap']) {
      const input = state.grainRows[key].querySelector('input[type=range]');
      input.value = input.max;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(300);
  expect(await widths()).toEqual(before);
});


test('Settings, Analytics and Help are the top bar\'s, and the rail has no foot', async ({ page }) => {
  await openGrain(page);
  const bar = page.locator('header.menubar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.menu-title', { hasText: 'Help' })).toBeVisible();
  await expect(page.locator('#leftRail .rl-foot')).toBeHidden();
  await page.locator('#settingsOpen').click();
  await expect(page.locator('#settingsModal')).toBeVisible();
});

test('a click on a bar sets it there, and a double-click on its picture puts it back', async ({ page }) => {
  await openGrain(page);
  const row = page.locator('.gk-row[data-glyph="overlap"]');
  const input = row.locator('input[type=range]');
  const box = await input.boundingBox();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  const set = Number(await input.inputValue());
  expect(set).toBeGreaterThan(6);
  await row.locator('svg.gg').click();
  expect(Number(await input.inputValue())).toBe(set);
  await row.locator('svg.gg').dblclick();
  await expect(input).toHaveValue('2');
});
