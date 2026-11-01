// The Visual column's pictures: every control drawn as what it does.
//
// `ui/control-pictures.js`. A knob was a word and a number; now each one has a
// small drawing of the part of the room it moves, drawn from its value, in the
// colour the palette gives that part. Knobs that shape one thing — the ring's
// four, the lamp's three, the box's four — draw the same object, so moving one
// shows up in its neighbours. The palette's slots show where in the room each
// colour lands, the generators show the palette they make, and the 4D tab shows
// each solid and each plane's angle.

import { test, expect } from '@playwright/test';

async function openVisual(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof setMode === 'function' && typeof cpKnob === 'function',
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    localStorage.removeItem('roomPaintCurrent');
    roomPaint.scheme = rpDefaultScheme();
    rpTouch();
    setMode('room');
  });
  await page.waitForSelector('#roomAdmin', { state: 'visible', timeout: 20_000 });
}

const tab = (page, key) => page.click(`#roomAdmin .rv-tab[data-rvtab="${key}"]`);

/// Every knob in `host` with no picture, or an empty one, by its panel and word. On screen
/// or not: the stage opens one group at a time. Mist's amount is counted in the
/// mist's own drawing, which was a picture before this.
async function bare(page, host = '#roomAdmin') {
  return page.evaluate((h) => [...document.querySelectorAll(`${h} .rk-k`)]
    .filter((k) => !k.closest('.rk-mist') && !k.querySelector(':scope > svg.pic')?.innerHTML.trim())
    .map((k) => `${k.closest('[id]')?.id}: ${k.querySelector('.rk-l')?.textContent || '?'}`), host);
}

test('every knob in the Room tab has a picture, on every view', async ({ page }) => {
  await openVisual(page);
  for (const mod of ['room', 'ridge', 'room3d', 'stage']) {
    await page.evaluate((m) => { setVisModule(m); rkAdopt(); }, mod);
    await page.waitForTimeout(150);
    expect(await bare(page, '#roomAdminBody'), `knobs with no picture on ${mod}`).toEqual([]);
  }
});

test('every knob in the Shape and 4D tabs has a picture', async ({ page }) => {
  await openVisual(page);
  await tab(page, 'geom');
  await page.waitForTimeout(100);
  expect(await bare(page, '#roomGeomBody'), 'Shape').toEqual([]);
  await tab(page, 'dim4');
  await page.waitForTimeout(100);
  expect(await bare(page, '#p4Panel'), '4D').toEqual([]);
});

test('a picture is drawn from the value, and the same value draws the same picture', async ({ page }) => {
  await openVisual(page);
  const read = () => page.evaluate(() => document.querySelector('#reRing').closest('.rk-k').querySelector('svg.pic').innerHTML);
  const set = (v) => page.evaluate((x) => { const i = $('reRing'); i.value = String(x); i.dispatchEvent(new Event('input')); }, v);
  await set(40);
  const small = await read();
  await set(260);
  const big = await read();
  expect(big).not.toBe(small);
  await set(40);
  expect(await read()).toBe(small);
});

test('knobs that shape one thing draw it together', async ({ page }) => {
  await openVisual(page);
  // Drive pushes the ring out of round, and the Size knob's ring shows it.
  const size = () => page.evaluate(() => $('reRing').closest('.rk-k').querySelector('svg.pic').innerHTML);
  const before = await size();
  await page.evaluate(() => { const i = $('reRingDrive'); i.value = '700'; i.dispatchEvent(new Event('input')); });
  expect(await size()).not.toBe(before);
});

test('a picture takes the colour its part is painted', async ({ page }) => {
  await openVisual(page);
  const ink = () => page.evaluate(() => {
    const p = $('reRing').closest('.rk-k').querySelector('svg.pic .a');
    return getComputedStyle(p).stroke;
  });
  await page.evaluate(() => { rpSetSlot('ring', { mode: 'flat', colour: '#ff0000' }); rpApply(); });
  expect(await ink()).toBe('rgb(255, 0, 0)');
  await page.evaluate(() => { rpSetSlot('ring', { mode: 'flat', colour: '#00ff00' }); rpApply(); });
  expect(await ink()).toBe('rgb(0, 255, 0)');
});

test('pictures are decoration to a screen reader', async ({ page }) => {
  await openVisual(page);
  const loud = await page.evaluate(() => [...document.querySelectorAll('#roomAdmin svg.pic')]
    .filter((s) => s.getAttribute('aria-hidden') !== 'true').length);
  expect(loud).toBe(0);
});

test('every layer says which part of the room it is', async ({ page }) => {
  await openVisual(page);
  const missing = await page.evaluate(() => [...document.querySelectorAll('#reLayers .re-layer-name')]
    .filter((b) => !b.querySelector('svg.pic-where .lit'))
    .map((b) => b.textContent.trim()));
  expect(missing).toEqual([]);
});

test('every colour slot shows where in the room it lands', async ({ page }) => {
  await openVisual(page);
  await tab(page, 'paint');
  await page.waitForTimeout(100);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#roomPaintBody .rp-slot-head')]
    .map((h) => ({ name: h.querySelector('.rp-slot-name')?.textContent, lit: !!h.querySelector('svg.pic-where .lit') })));
  expect(rows.length).toBeGreaterThan(10);
  expect(rows.filter((r) => !r.lit).map((r) => r.name)).toEqual([]);
});

test('each generator shows the palette it makes', async ({ page }) => {
  await openVisual(page);
  await tab(page, 'paint');
  await page.waitForTimeout(100);
  const strips = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#roomPaintBody .rp-gens .re-btn')]
    .map((b) => [b.textContent.trim(), [...b.querySelectorAll('.pic-swatch')].map((s) => getComputedStyle(s).backgroundColor)])));
  expect(Object.keys(strips).length).toBe(6);
  for (const [name, c] of Object.entries(strips)) expect(c.length, name).toBeGreaterThanOrEqual(5);
  // Black and white has no hue; Spectrum has many.
  const hues = (cs) => new Set(cs.map((c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return r === g && g === b ? 'grey' : c; })).size;
  expect(hues(strips['Black & white'])).toBe(1);
  expect(hues(strips.Spectrum)).toBeGreaterThan(3);
});

test('each solid in the 4D catalogue is drawn, with every edge', async ({ page }) => {
  await openVisual(page);
  await tab(page, 'dim4');
  await page.waitForTimeout(100);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#p4Panel .p4-obj')].map((r, i) => ({
    want: Shapes4D.CATALOGUE[i].edges,
    got: r.querySelectorAll('svg.pic-solid line').length,
  })));
  expect(rows.length).toBe(8);
  for (const r of rows) expect(r.got).toBe(r.want);
});

test('each rotation plane shows its angle as a dial', async ({ page }) => {
  await openVisual(page);
  await tab(page, 'dim4');
  await page.evaluate(() => { p4.spinning = false; p4.angles.xy = 0; p4BuildPanel(); });
  const dial = () => page.evaluate(() => document.querySelector('.p4-num-in[data-p4="XY"]').closest('.p4-num').querySelector('svg.pic-dial').innerHTML);
  const zero = await dial();
  await page.evaluate(() => { p4.angles.xy = Math.PI / 2; p4SyncFields(); });
  expect(await dial()).not.toBe(zero);
  const dials = await page.evaluate(() => document.querySelectorAll('#p4Panel svg.pic-dial').length);
  expect(dials).toBe(6);
});

test('perspective and parallel are drawn as what they do', async ({ page }) => {
  await openVisual(page);
  await tab(page, 'dim4');
  const n = await page.evaluate(() => document.querySelectorAll('#p4Panel [data-p4seg="projection"] .re-btn svg.pic').length);
  expect(n).toBe(2);
});

test('a pointer on a knob face still turns the knob, picture or not', async ({ page }) => {
  await openVisual(page);
  const missed = [];
  for (const [tabKey, mod] of [['controls', 'room'], ['controls', 'ridge'], ['controls', 'room3d'], ['controls', 'stage'], ['geom', null], ['dim4', null]]) {
    await tab(page, tabKey);
    if (mod) await page.evaluate((m) => { setVisModule(m); rkAdopt(); }, mod);
    await page.waitForTimeout(150);
    const faces = await page.locator('#roomAdmin .rk-k:has(> svg.pic) > .rk-face').all();
    for (const face of faces) {
      if (!await face.isVisible()) continue;
      await face.scrollIntoViewIfNeeded();
      const hit = await face.evaluate((f) => {
        const r = f.getBoundingClientRect();
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const input = f.parentElement.querySelector(':scope > input[type=range]');
        return at === input ? null : `${f.closest('[id]')?.id}: ${f.parentElement.querySelector('.rk-l')?.textContent}`;
      });
      if (hit) missed.push(hit);
    }
  }
  expect(missed, 'knob faces a pointer does not reach').toEqual([]);
});
