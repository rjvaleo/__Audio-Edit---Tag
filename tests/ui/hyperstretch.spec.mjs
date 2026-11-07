// HyperStretch: Hyperprism's XY pad, read from its code, on the granular
// engine's Stretch and Pitch. Opened from the rail as Prism, where it is merged
// with the rack pad (`prism-merged.spec.mjs`). See `docs/HYPERSTRETCH.md`.
//
// What this pins, each from the decompiled original unless said:
//   - the pad maps linearly: X low at the left, Y low at the bottom; it is
//     square and sized to the dock, as the rack pad's was (not the original's
//     461 × 241);
//   - grabbing the pad is the record button, and a take runs until Stop or Play;
//   - a path is a point per tick at most, played back stepped, looping at its
//     own length;
//   - Shift locks a drag horizontal, vertical or diagonal; arrows draw while
//     recording, Option ×10;
//   - a new limit rescales the path so its values stay;
//   - Smoothing is int(10^(0.04·(100 − s)))·0.0001, sent to the engine.

import { test, expect } from './test.mjs';

async function stubDeck(page) {
  await page.route('**/api/prism/load**', (route) => {
    const p = new URL(route.request().url()).searchParams.get('p');
    route.fulfill({ json: { path: p, frames: 96000, sampleRate: 48000 } });
  });
  await page.route('**/api/prism/state**', (route) => route.fulfill({ json: { playing: false, position: 0 } }));
}

async function ready(page) {
  await stubDeck(page);
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 15_000 });
}

async function openPrism(page) {
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
  });
  await page.locator('#leftRail .rl-item[data-page="prism"]').click();
  await page.waitForFunction(() => state.mode === 'edit' && Object.keys(state.grainRows || {}).length > 0, { timeout: 20_000 });
  await expect(page.locator('#hsPad')).toBeVisible();
  // Its own sound, on the Prism deck (`prism-deck.spec.mjs`).
  await page.evaluate(() => window.prismDeck.use(state.selectedFile.path));
  await page.evaluate(() => window.hyperStretch.reset());
}

/// A point on the pad, as fractions across and down, in page pixels.
async function at(page, fx, fy) {
  const b = await page.locator('#hsPad').boundingBox();
  return { x: b.x + fx * b.width, y: b.y + fy * b.height, b };
}

/// The Prism deck's Time & Pitch, which the pad moves.
const draft = (page) => page.evaluate(() => { const s = window.prismDeck.stretch(); return { ratio: s.ratio, semitones: s.semitones }; });

test.beforeEach(async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { try { for (const k of Object.keys(localStorage)) if (/^(hyperstretch|prism\.)/.test(k)) localStorage.removeItem(k); } catch {} });
});

test('Prism on the rail opens the open sound on its pad, square and sized to the dock', async ({ page }) => {
  await expect(page.locator('#leftRail .rl-item[data-page="prism"]')).toHaveCount(1);
  await openPrism(page);
  expect(await page.evaluate(() => document.body.classList.contains('prismpage'))).toBe(true);
  await expect(page.locator('.dock-tab[data-dock="hyper"]')).toHaveClass(/active/);
  const b = await page.locator('#hsPad').boundingBox();
  expect(Math.abs(b.width - b.height)).toBeLessThanOrEqual(1);
  expect(b.width).toBeGreaterThanOrEqual(140);
  expect(Math.round(b.width) - 2).toBe(await page.evaluate(() => window.hyperStretch.side()));
  await expect(page.locator('#hsChip')).toContainText('READY');
});

test('the pad maps linearly between its limits, X across and Y up', async ({ page }) => {
  await openPrism(page);
  const lims = await page.evaluate(() => window.hyperStretch.limits());
  expect(lims).toEqual({ xLo: 4, xHi: 0.25, yLo: -12, yHi: 12 });
  const p = await at(page, 0.5, 0.25);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  const fx = (p.x - p.b.x) / p.b.width, fy = (p.y - p.b.y) / p.b.height;
  const d = await draft(page);
  expect(d.ratio).toBeCloseTo(4 + fx * (0.25 - 4), 3);
  expect(d.semitones).toBeCloseTo(-12 + (1 - fy) * 24, 3);
  await page.mouse.up();
});

test('grabbing the pad records a take, which runs until Stop', async ({ page }) => {
  await openPrism(page);
  const a = await at(page, 0.2, 0.5), b = await at(page, 0.8, 0.3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await expect(page.locator('#hsChip')).toContainText('REC');
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  // Hyperprism keeps recording after the hand lets go: the take is open.
  await expect(page.locator('#hsChip')).toContainText('REC');
  await page.waitForTimeout(200);
  await page.locator('#hsStop').click();
  await expect(page.locator('#hsChip')).toContainText('READY');
  const take = await page.evaluate(() => window.hyperStretch.take(0));
  expect(take.pts.length).toBeGreaterThan(3);
  // At most one point per tick, on the tick grid.
  const ticks = take.pts.map((q) => Math.round(q.t / (1000 / 60.15)));
  expect(new Set(ticks).size).toBe(ticks.length);
  for (const q of take.pts) expect(Math.abs(q.t / (1000 / 60.15) - Math.round(q.t / (1000 / 60.15)))).toBeLessThan(1e-6);
  // The take lasts until Stop, past the last point.
  expect(take.dur).toBeGreaterThan(take.pts[take.pts.length - 1].t + 150);
  await expect(page.locator('.hs-slot[data-slot="0"]')).toContainText('s');
  expect((await page.locator('#hsPath').getAttribute('points')).split(' ').length).toBe(take.pts.length);
});

test('Play steps through the take and loops at its own length', async ({ page }) => {
  await openPrism(page);
  const a = await at(page, 0.1, 0.9), b = await at(page, 0.9, 0.1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
  await page.locator('#hsPlay').click();
  await expect(page.locator('#hsChip')).toContainText('PLAY');
  const take = await page.evaluate(() => window.hyperStretch.take(0));
  const values = new Set(await page.evaluate(() => window.hyperStretch.values(0).map((v) => v.ratio.toFixed(6))));
  const seen = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(take.dur / 6);
    seen.push((await draft(page)).ratio.toFixed(6));
  }
  // Stepped: every value played is one of the take's own points.
  for (const v of seen) expect(values.has(v)).toBe(true);
  // And it moves, and comes round again.
  expect(new Set(seen).size).toBeGreaterThan(2);
});

test('Shift locks the drag to the axis it starts along', async ({ page }) => {
  await openPrism(page);
  const a = await at(page, 0.3, 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  const b = await at(page, 0.7, 0.55), c = await at(page, 0.9, 0.2);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.move(c.x, c.y, { steps: 6 });
  await page.keyboard.up('Shift');
  await page.mouse.up();
  await page.locator('#hsStop').click();
  const take = await page.evaluate(() => window.hyperStretch.take(0));
  const ys = new Set(take.pts.map((q) => q.y.toFixed(6)));
  expect(ys.size).toBe(1);
  expect(take.pts[take.pts.length - 1].x).toBeGreaterThan(0.85);
});

test('arrow keys draw while recording, ten pixels with Option', async ({ page }) => {
  await openPrism(page);
  const a = await at(page, 0.5, 0.5);
  await page.mouse.click(a.x, a.y);
  const x0 = await page.evaluate(() => window.hyperStretch.hand().x);
  await page.locator('#hsPad').focus();
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Alt+ArrowRight'); await page.waitForTimeout(30); }
  await page.keyboard.press('ArrowUp');
  const h = await page.evaluate(() => window.hyperStretch.hand());
  const side = await page.evaluate(() => window.hyperStretch.side());
  expect((h.x - x0) * side).toBeCloseTo(30, 0);
  await page.locator('#hsStop').click();
  expect((await page.evaluate(() => window.hyperStretch.take(0))).pts.length).toBeGreaterThanOrEqual(4);
});

test('a new limit rescales the take so every point keeps its value', async ({ page }) => {
  await openPrism(page);
  const a = await at(page, 0.2, 0.7), b = await at(page, 0.6, 0.2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.locator('#hsStop').click();
  const before = await page.evaluate(() => window.hyperStretch.values(0));
  await page.locator('#prismXLo').fill('8');
  await page.locator('#prismXLo').press('Enter');
  await page.locator('#prismYHi').fill('24');
  await page.locator('#prismYHi').press('Enter');
  expect(await page.evaluate(() => window.hyperStretch.limits())).toEqual({ xLo: 8, xHi: 0.25, yLo: -12, yHi: 24 });
  const after = await page.evaluate(() => window.hyperStretch.values(0));
  after.forEach((v, i) => {
    expect(v.ratio).toBeCloseTo(before[i].ratio, 4);
    expect(v.semitones).toBeCloseTo(before[i].semitones, 4);
  });
});

test('Smoothing is Hyperprism’s curve, and goes to the Prism deck, which keeps it after leaving the page', async ({ page }) => {
  await openPrism(page);
  const sent = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/engine/glide')) sent.push(JSON.parse(r.postData())); });
  await page.locator('#hsGlide').fill('25');
  await expect(page.locator('#hsCoef')).toHaveText('0.1000');
  await page.locator('#hsGlide').fill('50');
  await expect(page.locator('#hsCoef')).toHaveText('0.0100');
  await expect(page.locator('#hsTau')).toContainText('1.1');
  await page.locator('#hsGlide').fill('0');
  await expect(page.locator('#hsTau')).toHaveText('instant');
  await page.locator('#hsGlide').fill('40');
  await expect.poll(() => sent.at(-1)?.smoothing).toBe(40);
  expect(sent.every((b) => b.deck === 'prism')).toBe(true);
  // The grain engine was never glided, so leaving has nothing to put back.
  const n = sent.length;
  await page.locator('#leftRail .rl-item[data-page="grain"]').click();
  await page.waitForTimeout(300);
  expect(sent.length).toBe(n);
  const r = await page.evaluate(() => postJSON('/api/engine/glide', { smoothing: 30 }));
  expect(r.ok).toBe(true);
});

test('hovering shows what a spot stands for before it is touched', async ({ page }) => {
  await openPrism(page);
  const a = await at(page, 0.5, 0.5);
  await page.mouse.move(a.x, a.y);
  await expect(page.locator('#hsRead')).toBeVisible();
  await expect(page.locator('#hsRead')).toContainText('×');
  await expect(page.locator('#hsRead')).toContainText('st');
  await expect(page.locator('#hsChip')).toContainText('READY');
});

test('the extras: loop on release, a drawn shape, the slots, rate and direction', async ({ page }) => {
  await openPrism(page);
  await page.locator('#hsLoopRelease').check();
  const a = await at(page, 0.3, 0.3), b = await at(page, 0.6, 0.6);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#hsChip')).toContainText('PLAY');
  await page.locator('.hs-slot[data-slot="1"]').click();
  await page.locator('[data-hsshape="circle"]').click();
  await expect(page.locator('#hsChip')).toContainText('PLAY · B');
  const take = await page.evaluate(() => window.hyperStretch.take(1));
  expect(take.dur).toBe(4000);
  await page.locator('[data-hsrate="2"]').click();
  await page.locator('[data-hsdir="pp"]').click();
  expect(await page.evaluate(() => window.hyperStretch.motion())).toEqual({ rate: 2, dir: 'pp' });
  // The takes are kept with the sound.
  await page.locator('#hsStop').click();
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('hyperstretch:')))).toBe(true);
});
