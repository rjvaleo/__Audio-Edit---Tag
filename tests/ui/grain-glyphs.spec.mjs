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

test('the glyph is drawn in its group\'s colour, from the theme', async ({ page }) => {
  await openGrain(page);
  const colours = await page.evaluate(() => {
    const c = (key) => getComputedStyle(document.querySelector(`.gk-row[data-glyph="${key}"] > .gg`)).getPropertyValue('--gg').trim();
    return { time: c('ratio'), shape: c('densityHz'), pitch: c('pitchJitterSemis'), scan: c('scan') };
  });
  // Four groups, four colours.
  expect(new Set(Object.values(colours)).size).toBe(4);
  for (const v of Object.values(colours)) expect(v).not.toBe('');
});

test('the glyph is decoration: the slider keeps its name for a screen reader', async ({ page }) => {
  await openGrain(page);
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('#grainControls .gk-row > .gg')].every((g) => g.getAttribute('aria-hidden') === 'true'));
  expect(hidden).toBe(true);
});
