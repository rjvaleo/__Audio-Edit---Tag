// The design pass of 27 Oct 2026, continued: Visual › Room · Air · fog and
// Visual › Colour. See `design-pass.spec.mjs` and `docs/DESIGN-CRITIQUE.md`.

import { test, expect } from './test.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ready, openFile, roomTab } from './design-pass.helpers.mjs';

// ── Visual › Room · Air · fog ───────────────────────────────────────────────
// `docs/DESIGN-CRITIQUE.md`, graph-first controls. Fog is drawn as what it
// does — how much of the room's colour it takes, against distance — and the
// drawing is the control: dragged up, it thickens.

/// The curve as drawn: its path, the type it was drawn for, and its reading.
const fogCurve = (page) => page.evaluate(() => {
  const g = document.querySelector('#roomEdit .rk-fog');
  const curve = g && g.querySelector('.rk-fog-curve');
  // Height fog at the ground is exponential fog; what it is, it is above the
  // ground, so the drawing is both lines.
  const high = g && g.querySelector('.rk-fog-high');
  return g && {
    d: (curve ? curve.getAttribute('d') : '') + (high?.getAttribute('d') || ''),
    type: g.dataset.type,
    read: g.querySelector('.rk-fog-read')?.textContent.trim(),
    w: g.querySelector('.rk-fog-graph')?.getBoundingClientRect().width || 0,
  };
});

test('F1 · fog is drawn as a curve, in the shape its type gives', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const shapes = {};
  for (const type of ['1', '2', '0', '3']) {
    await page.selectOption('#reFogType', type);
    const c = await fogCurve(page);
    expect(c, 'no fog curve in the Air group').toBeTruthy();
    expect(c.w).toBeGreaterThan(100);
    expect(c.type).toBe(type);
    shapes[type] = c.d;
  }
  expect(new Set(Object.values(shapes)).size).toBe(4);
  // The setting it drew is the one the room has.
  expect(await page.evaluate(() => roomEdit.fogType)).toBe(3);
});

test('F2 · dragging up on the fog curve thickens the fog, through its own input', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  await page.selectOption('#reFogType', '1');
  await page.evaluate(() => { const i = document.getElementById('reFogDensity'); i.value = '40'; i.dispatchEvent(new Event('input')); });
  const before = await page.evaluate(() => roomEdit.fogDensity);
  const drawn = await fogCurve(page);
  const graph = page.locator('#roomEdit .rk-fog-graph');
  await graph.scrollIntoViewIfNeeded();
  const box = await graph.boundingBox();
  // The pointer lands on the input itself, not on a picture of one.
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe('reFogDensity');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => roomEdit.fogDensity);
  expect(after).toBeGreaterThan(before);
  const now = await fogCurve(page);
  expect(now.d).not.toBe(drawn.d);
  expect(+now.read).toBeCloseTo(after, 2);
});

test('F3 · the fog curve redraws when a recalled look sets the fog', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  await page.selectOption('#reFogType', '1');
  const drawn = await fogCurve(page);
  await page.evaluate(() => {
    const look = visualSnapshot();
    look.room.fogDensity = 1.5;
    look.room.fogType = 2;
    applyVisual(look);
  });
  const now = await fogCurve(page);
  expect(now.type).toBe('2');
  expect(now.read).toBe('1.50');
  expect(now.d).not.toBe(drawn.d);
});

test('F4 · on the master bus the fog stays the slider it was', async ({ page }) => {
  await openFile(page);
  const overlay = await page.evaluate(() => {
    const i = document.getElementById('reFogDensity');
    const g = document.querySelector('#roomEdit .rk-fog-graph');
    return { inAdmin: !!i.closest('.rv-admin'), graph: g ? g.getBoundingClientRect().width : 0, opacity: getComputedStyle(i).opacity };
  });
  expect(overlay.inAdmin).toBe(false);
  expect(overlay.graph).toBe(0);
  expect(overlay.opacity).toBe('1');
});

// ── Visual › Colour ─────────────────────────────────────────────────────────
// The pass `docs/DESIGN-CRITIQUE.md` lists under "Not yet done". The tab given the instrument
// the rest of the column has: choices as rows of fixed places, amounts as
// knobs, and a ramp's range a span you drag on its own strip.

/// The Colour tab, on a fresh palette, with `key` open in `mode`.
async function paintTab(page, key, patch) {
  await ready(page);
  await roomTab(page, 'paint');
  await page.evaluate(([k, p]) => {
    localStorage.removeItem('roomPaintCurrent');
    localStorage.removeItem('roomPaintView');
    rpView = 'modern';
    rpPrev = null;
    roomPaint.scheme = rpDefaultScheme();
    if (p) rpSetSlot(k, p);
    rpTouch();
    rpOpen = k;
    rpApply();
    rpPanel();
  }, [key, patch || null]);
}

const RAMP = { mode: 'ramp', drive: 0, lo: 0.2, hi: 0.6, curve: 1,
  stops: [{ at: 0, c: '#2040ff' }, { at: 0.5, c: '#20e0a0' }, { at: 1, c: '#ffe040' }] };

/// A segment row: each place's word, its box, and whether it is lit.
const segIn = (name) => `(() => {
  const row = document.querySelector('#roomPaintBody .rp-edit .rp-seg[data-seg="${name}"]');
  if (!row) return null;
  return [...row.children].map((el) => {
    const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { word: el.textContent.trim(), button: el.tagName === 'BUTTON',
      lit: el.classList.contains('active'), x: Math.round(b.left), y: Math.round(b.top),
      w: Math.round(b.width), bg: cs.backgroundColor, edge: cs.borderTopColor };
  });
})()`;

/// Whether a computed colour is solid. `color-mix` computes to `color(srgb …)`
/// or `oklch(…)` with a `/ alpha`, the legacy syntax to `rgba(…, alpha)`.
const opaque = (c) => {
  const m = /\/\s*([\d.]+)\s*\)$/.exec(c) || /rgba\([^)]*,\s*([\d.]+)\)$/.exec(c);
  return m ? +m[1] >= 0.99 : c !== 'transparent';
};

test('P1 · a slot\'s mode is a row of fixed places, lit and never filled', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const ring = await page.evaluate(segIn('mode'));
  expect(ring, 'the mode is a segment row').not.toBeNull();
  expect(ring.map((p) => p.word)).toEqual(['Theme', 'Colour', 'Ramp']);
  expect(new Set(ring.map((p) => p.y)).size, 'on one line').toBe(1);
  expect(new Set(ring.map((p) => p.w)).size, 'the places are one width').toBe(1);
  const lit = ring.filter((p) => p.lit);
  expect(lit.map((p) => p.word)).toEqual(['Ramp']);
  expect(opaque(lit[0].bg), 'lit by a tint, not filled').toBe(false);
  expect(lit[0].edge, 'and an edge').not.toBe(ring.find((p) => !p.lit).edge);

  // The background is one colour by definition. Its Ramp place stays empty
  // rather than the row closing up, so Theme and Colour sit where they always do.
  await page.evaluate(() => { rpOpen = 'background'; rpPanel(); });
  const ground = await page.evaluate(segIn('mode'));
  expect(ground.length).toBe(3);
  expect(ground[2].button, 'the third place is empty').toBe(false);
  expect(ground.slice(0, 2).map((p) => [p.word, p.x, p.w]))
    .toEqual(ring.slice(0, 2).map((p) => [p.word, p.x, p.w]));
});

test('P2 · what a ramp is read against is a row of fixed places', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  expect(await page.locator('#roomPaintBody .rp-edit select').count(), 'no menu').toBe(0);
  const ring = await page.evaluate(segIn('drive'));
  expect(ring.map((p) => p.word)).toEqual(['Level', 'Depth', 'Distance', 'Height', 'Random', 'Stereo width']);
  expect(new Set(ring.map((p) => p.w)).size, 'the places are one width').toBe(1);
  expect(ring.filter((p) => p.lit).map((p) => p.word)).toEqual(['Level']);

  await page.locator('#roomPaintBody .rp-seg[data-seg="drive"] .re-btn', { hasText: 'Depth' }).click();
  expect(await page.evaluate(() => rpSlot('ring').drive)).toBe(1);
  const after = await page.evaluate(segIn('drive'));
  expect(after.filter((p) => p.lit).map((p) => p.word)).toEqual(['Depth']);
  expect(opaque(after.find((p) => p.lit).bg)).toBe(false);

  // Fog has nothing of its own: the sixth place is kept, and left empty.
  await page.evaluate((r) => { rpSetSlot('fog', r); rpOpen = 'fog'; rpPanel(); }, RAMP);
  const fog = await page.evaluate(segIn('drive'));
  expect(fog.length).toBe(6);
  expect(fog[5].button).toBe(false);
  // Fog is further down the list, so its places are compared within their row.
  const within = (row) => row.slice(0, 5).map((p) => [p.x, p.y - row[0].y]);
  expect(within(fog)).toEqual(within(ring));
});

test('P3 · every amount on the Colour tab is a slider a pointer reaches', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const sliders = await page.evaluate(() => [...document.querySelectorAll('#roomPaintBody input[type=range]')].map((i) => {
    const k = i.closest('.rk-k');
    if (!k) return { why: 'not one of the column\'s amounts', title: i.title };
    k.scrollIntoView({ block: 'center' });
    const r = i.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { word: k.querySelector('.rk-l').textContent, read: k.querySelector('.rk-v').textContent.trim(), reached: hit === i };
  }));
  // Three stops and the curve. The range is not a pair of sliders any more.
  expect(sliders.length).toBe(4);
  expect(sliders.filter((k) => k.why || !k.read || !k.reached)).toEqual([]);

  // The curve goes up when its slider is clicked to the right, and its reading follows.
  const curveBox = await page.locator('#roomPaintBody .rp-curve').boundingBox();
  await page.mouse.click(curveBox.x + curveBox.width * 0.9, curveBox.y + curveBox.height / 2);
  const curve = await page.evaluate(() => rpSlot('ring').curve);
  expect(curve).toBeGreaterThan(1);
  expect(+(await page.locator('#roomPaintBody .rk-k:has(.rp-curve) .rk-v').textContent())).toBeCloseTo(curve, 2);

  // A stop's slider moves that stop and only that one.
  const stop = await page.locator('#roomPaintBody .rp-stop').nth(1).locator('input[type=range]').boundingBox();
  await page.mouse.click(stop.x + stop.width * 0.2, stop.y + stop.height / 2);
  const at = await page.evaluate(() => rpSlot('ring').stops.map((s) => s.at));
  expect(at[0]).toBe(0);
  expect(at[1]).toBeLessThan(0.5);
  expect(at[2]).toBe(1);
});

test('P4 · a ramp\'s range is a span dragged on its own strip', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const strip = page.locator('#roomPaintBody .rp-span');
  await expect(strip).toHaveCount(1);
  const geo = async () => page.evaluate(() => {
    const s = document.querySelector('#roomPaintBody .rp-span').getBoundingClientRect();
    const w = document.querySelector('#roomPaintBody .rp-span-win').getBoundingClientRect();
    return { s: { x: s.left, w: s.width, y: s.top, h: s.height },
      lo: (w.left - s.left) / s.width, hi: (w.right - s.left) / s.width,
      slot: { lo: rpSlot('ring').lo, hi: rpSlot('ring').hi } };
  });
  let g = await geo();
  expect(g.lo, 'the span starts where the range does').toBeCloseTo(0.2, 1);
  expect(g.hi, 'and ends where it does').toBeCloseTo(0.6, 1);

  // Dragged by its middle, the whole window moves and keeps its width.
  const midY = g.s.y + g.s.h / 2;
  await page.mouse.move(g.s.x + g.s.w * 0.4, midY);
  await page.mouse.down();
  await page.mouse.move(g.s.x + g.s.w * 0.6, midY, { steps: 5 });
  await page.mouse.up();
  g = await geo();
  expect(g.slot.lo).toBeCloseTo(0.4, 1);
  expect(g.slot.hi).toBeCloseTo(0.8, 1);
  expect(g.slot.hi - g.slot.lo).toBeCloseTo(0.4, 2);
  expect(g.lo).toBeCloseTo(g.slot.lo, 1);

  // Dragged by an edge, only that end moves.
  await page.mouse.move(g.s.x + g.s.w * g.slot.hi - 1, midY);
  await page.mouse.down();
  await page.mouse.move(g.s.x + g.s.w * 0.95, midY, { steps: 5 });
  await page.mouse.up();
  const end = await geo();
  expect(end.slot.lo).toBeCloseTo(g.slot.lo, 2);
  expect(end.slot.hi).toBeGreaterThan(0.9);

  // Each end is a slider to the keyboard too.
  const lo = page.locator('#roomPaintBody .rp-span [role=slider]').first();
  await lo.focus();
  const before = await page.evaluate(() => rpSlot('ring').lo);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => rpSlot('ring').lo)).toBeCloseTo(before + 0.01, 3);
  expect(+(await lo.getAttribute('aria-valuenow'))).toBeCloseTo(before + 0.01, 2);

  // The strip is the ramp as the room reads it: below the window the first
  // colour, above it the last.
  const ends = await page.evaluate(() => {
    const bg = document.querySelector('#roomPaintBody .rp-span').style.background;
    return (bg.match(/rgb\([^)]*\)/g) || []);
  });
  expect(ends[0]).toBe('rgb(32, 64, 255)');
  expect(ends[ends.length - 1]).toBe('rgb(255, 224, 64)');
});

test('P5 · the Colour tab is dense, in fixed places, inside its column', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const got = await page.evaluate(() => {
    const body = document.getElementById('roomPaintBody');
    const col = document.getElementById('roomAdmin').getBoundingClientRect();
    // A row holding nothing but its tag is a line of blank space.
    const bare = [...body.querySelectorAll('.rp-row')]
      .filter((r) => r.children.length === 1 && r.firstElementChild.classList.contains('re-tag'))
      .map((r) => r.textContent.trim());
    const over = [...body.querySelectorAll('*')].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width && (b.right > col.right + 0.5 || b.left < col.left - 0.5);
    }).map((e) => e.className || e.tagName);
    const gens = [...body.querySelectorAll('.rp-gens .re-btn')].map((b) => b.getBoundingClientRect());
    return { bare, over, gensW: new Set(gens.map((b) => Math.round(b.width))).size,
      gensRows: new Set(gens.map((b) => Math.round(b.top))).size, gens: gens.length };
  });
  expect(got.bare).toEqual([]);
  expect(got.over).toEqual([]);
  expect(got.gens).toBe(6);
  expect(got.gensW, 'the generators are places of one width').toBe(1);
  expect(got.gensRows, 'two full lines, nothing left over').toBe(2);
});

test('P6 · a slot names what it is read against in its own word', async ({ page }) => {
  await paintTab(page, 'ring', { ...RAMP, drive: 5 });
  const mode = await page.evaluate(() => [...document.querySelectorAll('#roomPaintBody .rp-slot')]
    .find((s) => s.querySelector('.rp-slot-name').textContent === 'Ring')
    .querySelector('.rp-slot-mode').textContent);
  expect(mode).toBe('stereo width');
});

// ── Visual › Colour: classic and modern ─────────────────────────────────────
// A switch at the top of the tab. Classic is the tab as it was before this
// pass; Modern is the instrument above, with the council's fixes (K1–K9).

test('P7 · a switch at the top of the tab moves between classic and modern, and is remembered', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const view = page.locator('#roomPaintBody .rp-view');
  await expect(view.locator('.re-btn')).toHaveText(['Classic', 'Modern']);
  await expect(view.locator('.re-btn.active')).toHaveText('Modern');
  await expect(page.locator('#roomPaintBody .rp-span')).toHaveCount(1);

  await view.locator('.re-btn', { hasText: 'Classic' }).click();
  // Classic is the tab as it was: a menu for the drive, From and To as
  // sliders, and Back to theme.
  const classic = await page.evaluate(() => {
    const b = document.getElementById('roomPaintBody');
    return { menu: b.querySelectorAll('.rp-edit select.field').length,
      tags: [...b.querySelectorAll('.rp-edit .re-tag')].map((e) => e.textContent),
      span: b.querySelectorAll('.rp-span').length, knobs: b.querySelectorAll('.rk-k').length,
      reset: [...b.querySelectorAll('.re-btn')].some((e) => e.textContent === 'Back to theme') };
  });
  expect(classic).toEqual({ menu: 1, tags: expect.arrayContaining(['FROM', 'TO', 'CURVE']), span: 0, knobs: 0, reset: true });

  await page.reload();
  await page.waitForFunction(() => typeof rpPanel === 'function');
  await roomTab(page, 'paint');
  await expect(page.locator('#roomPaintBody .rp-view .re-btn.active')).toHaveText('Classic');

  await page.locator('#roomPaintBody .rp-view .re-btn', { hasText: 'Modern' }).click();
  await page.evaluate(() => { rpOpen = 'ring'; rpPanel(); });
  await expect(page.locator('#roomPaintBody .rp-span')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('roomPaintView'))).toBe('modern');
});

test('P8 · a generator can be undone, and a hand edit ends the undo', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const undo = page.locator('#roomPaintBody .rp-undo');
  await expect(undo).toHaveCount(0);
  await page.locator('#roomPaintBody .rp-gens .re-btn', { hasText: 'RGB' }).click();
  const first = await page.evaluate(() => JSON.stringify(roomPaint.scheme.slots));
  await page.locator('#roomPaintBody .rp-gens .re-btn', { hasText: 'Vibrant' }).click();
  await page.locator('#roomPaintBody .rp-undo').click();
  expect(await page.evaluate(() => JSON.stringify(roomPaint.scheme.slots)), 'back to the first roll').toBe(first);
  // Undo twice is a redo: two rolls to flip between.
  await page.locator('#roomPaintBody .rp-undo').click();
  expect(await page.evaluate(() => JSON.stringify(roomPaint.scheme.slots))).not.toBe(first);
  await page.evaluate(() => { rpSetSlot('ring', { mode: 'flat', colour: '#123456' }); rpPanel(); });
  await expect(undo).toHaveCount(0);
});

test('P9 · each end of the range prints its number under its own handle', async ({ page }) => {
  await paintTab(page, 'fog', { ...RAMP, lo: 0.05, hi: 0.27 });
  const at = async () => page.evaluate(() => {
    const c = (e) => { const r = e.getBoundingClientRect(); return { mid: r.left + r.width / 2, l: r.left, r: r.right }; };
    const [lo, hi] = [...document.querySelectorAll('#roomPaintBody .rp-span-read > span')].map(c);
    const [hlo, hhi] = [...document.querySelectorAll('#roomPaintBody .rp-span-end')].map(c);
    const s = c(document.querySelector('#roomPaintBody .rp-span'));
    return { lo, hi, hlo, hhi, s };
  });
  let g = await at();
  expect(Math.abs(g.hi.mid - g.hhi.mid), '0.27 under its handle').toBeLessThan(14);
  expect(g.lo.l).toBeGreaterThanOrEqual(g.s.l - 1);
  expect(g.lo.r, 'the two never print over each other').toBeLessThanOrEqual(g.hi.l);

  await page.evaluate(() => { rpSetSlot('fog', { lo: 0.5, hi: 0.51 }); rpPanel(); });
  g = await at();
  expect(g.lo.r).toBeLessThanOrEqual(g.hi.l);
  await page.evaluate(() => { rpSetSlot('fog', { lo: 0.6, hi: 1 }); rpPanel(); });
  g = await at();
  expect(Math.abs(g.lo.mid - g.hlo.mid)).toBeLessThan(14);
  expect(g.hi.r, 'and never past the strip').toBeLessThanOrEqual(g.s.r + 1);
});

test('P10 · the open slot is marked, and its editor reads as its own', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const heads = await page.evaluate(() => [...document.querySelectorAll('#roomPaintBody .rp-slot-head')].map((h) => ({
    name: h.querySelector('.rp-slot-name').textContent, open: h.getAttribute('aria-expanded'),
    bg: getComputedStyle(h).backgroundColor })));
  expect(heads.filter((h) => h.open === 'true').map((h) => h.name)).toEqual(['Ring']);
  expect(heads.every((h) => h.open === 'true' || h.open === 'false')).toBe(true);
  const ring = heads.find((h) => h.name === 'Ring'), other = heads.find((h) => h.name === 'Solid');
  expect(ring.bg, 'the open head is lit').not.toBe(other.bg);
  const edge = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#roomPaintBody .rp-edit'));
    return { w: parseFloat(cs.borderLeftWidth), style: cs.borderLeftStyle };
  });
  expect(edge.style).toBe('solid');
  expect(edge.w).toBeGreaterThanOrEqual(2);
});

test('P11 · one word per state, and Fog says what to do with its range', async ({ page }) => {
  await paintTab(page, 'grainCore', { mode: 'flat', colour: '#ff8800' });
  const word = await page.evaluate(() => [...document.querySelectorAll('#roomPaintBody .rp-slot')]
    .find((s) => s.querySelector('.rp-slot-name').textContent === 'Grain core')
    .querySelector('.rp-slot-mode').textContent);
  expect(word).toBe('colour');
  const hint = await page.evaluate(() => RP_SLOTS.find((s) => s.key === 'fog').hint);
  expect(hint).not.toMatch(/leave the range alone/);
  expect(hint).toMatch(/0\.05 to 0\.27/);
});

test('P12 · the head keeps to the control column, and Theme is a scheme in the menu', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const g = await page.evaluate(() => {
    const head = document.querySelector('#roomPaintBody .rp-head');
    const tagEdge = head.querySelector('.rp-name').getBoundingClientRect().left;
    const early = [...head.querySelectorAll('input, select, button')]
      .filter((e) => e.getBoundingClientRect().left < tagEdge - 1).map((e) => e.textContent || e.className);
    const reset = [...head.querySelectorAll('.re-btn')].some((e) => e.textContent === 'Back to theme');
    const options = [...head.querySelectorAll('select option')].map((o) => o.text);
    return { early, reset, options };
  });
  expect(g.early).toEqual([]);
  expect(g.reset).toBe(false);
  expect(g.options).toContain('Theme — as shipped');

  const before = await page.evaluate(() => JSON.stringify(roomPaint.scheme.slots));
  await page.locator('#roomPaintBody .rp-head select').selectOption({ label: 'Theme — as shipped' });
  expect(await page.evaluate(() => Object.keys(roomPaint.scheme.slots).length)).toBe(0);
  await page.locator('#roomPaintBody .rp-undo').click();
  expect(await page.evaluate(() => JSON.stringify(roomPaint.scheme.slots))).toBe(before);
});

test('P13 · no doubled rules and no trailing blank', async ({ page }) => {
  await paintTab(page, 'background');
  const g = await page.evaluate(() => {
    const body = document.getElementById('roomPaintBody');
    const mode = body.querySelector('.rp-edit .rp-row').getBoundingClientRect();
    const slots = [...body.querySelectorAll('.rp-slot')];
    const open = slots.findIndex((s) => s.querySelector('.rp-edit'));
    const next = slots[open + 1];
    const editBottom = slots[open].getBoundingClientRect().bottom;
    const ruled = (e) => parseFloat(getComputedStyle(e).borderBottomWidth) > 0;
    const headLast = body.querySelector('.rp-head > .rp-row:last-child');
    return { gap: editBottom - mode.bottom, next: !!next, modeRuled: ruled(body.querySelector('.rp-edit .rp-row:last-child')),
      headRuled: ruled(body.querySelector('.rp-head')) && ruled(headLast) };
  });
  expect(g.gap).toBeLessThanOrEqual(4);
  expect(g.modeRuled, 'the editor\'s last row does not rule over the slot\'s own rule').toBe(false);
  expect(g.headRuled, 'one rule between the head and the list').toBe(false);
});

test('P14 · the stop\'s remove and the range\'s ends are easy to hit', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  // 9 px left of the ×'s centre: outside its 13 px face, inside its target.
  const x = await page.locator('#roomPaintBody .rp-stop-del').nth(1).boundingBox();
  await page.mouse.click(x.x + x.width / 2 - 9, x.y + x.height / 2);
  expect(await page.evaluate(() => rpSlot('ring').stops.length)).toBe(2);

  const s = await page.locator('#roomPaintBody .rp-span').boundingBox();
  const hi = s.x + s.width * 0.6;
  await page.mouse.move(hi + 7, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width * 0.9, s.y + s.height / 2, { steps: 4 });
  await page.mouse.up();
  const r = await page.evaluate(() => ({ lo: rpSlot('ring').lo, hi: rpSlot('ring').hi }));
  expect(r.lo, 'grabbed 7 px out, the end moves and the window does not').toBeCloseTo(0.2, 2);
  expect(r.hi).toBeCloseTo(0.9, 1);
});

test('P15 · Fog starts its ramp on the band its weight actually reaches, 0.05–0.27', async ({ page }) => {
  await paintTab(page, 'fog');
  const pick = async () => {
    await page.locator('#roomPaintBody .rp-edit .re-btn', { hasText: 'Ramp' }).click();
    return page.evaluate(() => ({ lo: rpSlot('fog').lo, hi: rpSlot('fog').hi, ring: rpSlot('ring') }));
  };
  // Modern.
  let got = await pick();
  expect([got.lo, got.hi]).toEqual([0.05, 0.27]);
  // Classic, the same.
  await page.evaluate(() => { roomPaint.scheme = rpDefaultScheme(); rpTouch(); rpView = 'classic'; rpOpen = 'fog'; rpPanel(); });
  got = await pick();
  expect([got.lo, got.hi]).toEqual([0.05, 0.27]);
  // Only Fog: another slot still starts on the whole of its quantity.
  await page.evaluate(() => { rpOpen = 'ring'; rpPanel(); });
  await page.locator('#roomPaintBody .rp-edit .re-btn', { hasText: 'Ramp' }).click();
  expect(await page.evaluate(() => [rpSlot('ring').lo ?? 0, rpSlot('ring').hi ?? 1])).toEqual([0, 1]);
  // A range already set is kept: back to Theme and to Ramp again.
  await page.evaluate(() => { rpSetSlot('fog', { lo: 0.1, hi: 0.2 }); rpOpen = 'fog'; rpPanel(); });
  await page.locator('#roomPaintBody .rp-edit .re-btn', { hasText: 'Theme' }).click();
  await page.locator('#roomPaintBody .rp-edit .re-btn', { hasText: 'Ramp' }).click();
  expect(await page.evaluate(() => [rpSlot('fog').lo, rpSlot('fog').hi])).toEqual([0.1, 0.2]);
  // And every generator that reads Fog against its level gives it the band.
  const gen = await page.evaluate(() => ['mono', 'rgb', 'spectrum', 'vibrant', 'muted', 'bw']
    .map((k) => rpGenerate(k, 0).slots.fog).filter((f) => f.mode === 'ramp' && (f.drive | 0) === 0)
    .map((f) => [f.lo, f.hi]));
  expect(gen.length).toBeGreaterThan(0);
  expect(gen.every(([lo, hi]) => lo === 0.05 && hi === 0.27)).toBe(true);
});

test('P16 · each stop is a tick on the gradient, dragged where it sits, in step with its knob', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const geo = () => page.evaluate(() => {
    const bar = document.querySelector('#roomPaintBody .rp-stopbar');
    if (!bar) return null;
    const o = bar.getBoundingClientRect();
    // Inside the border, where the ticks are placed.
    const b = { left: o.left + bar.clientLeft, width: bar.clientWidth, top: o.top, height: o.height };
    // The browser rewrites a gradient into its own notation; the wanted one is
    // put through the same setter so the two are compared as written.
    const norm = document.createElement('i');
    norm.style.background = rpGradientCss('ring');
    return { bar: { x: b.left, w: b.width, y: b.top, h: b.height }, bg: bar.style.background, want: norm.style.background,
      ticks: [...bar.querySelectorAll('.rp-tick')].map((t) => {
        const r = t.getBoundingClientRect();
        return { at: (r.left + r.width / 2 - b.left) / b.width, cap: getComputedStyle(t.querySelector('i')).backgroundColor,
          role: t.getAttribute('role'), now: +t.getAttribute('aria-valuenow') };
      }),
      stops: rpSlot('ring').stops.map((s) => s.at),
      reads: [...document.querySelectorAll('#roomPaintBody .rp-stop .rk-v')].map((e) => e.textContent) };
  });
  let g = await geo();
  expect(g, 'the stops have a bar').not.toBeNull();
  expect(g.bg, 'the bar is the gradient').toBe(g.want);
  expect(g.ticks.map((t) => +t.at.toFixed(2))).toEqual([0, 0.5, 1]);
  expect(g.ticks.map((t) => t.cap)).toEqual(['rgb(32, 64, 255)', 'rgb(32, 224, 160)', 'rgb(255, 224, 64)']);
  expect(g.ticks.every((t) => t.role === 'slider')).toBe(true);

  // Dragged, the stop moves, and its knob's reading follows.
  const y = g.bar.y + g.bar.h / 2;
  await page.mouse.move(g.bar.x + g.bar.w * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(g.bar.x + g.bar.w * 0.25, y, { steps: 5 });
  await page.mouse.up();
  g = await geo();
  expect(g.stops[1]).toBeCloseTo(0.25, 1);
  expect(g.reads[1]).toBe(g.stops[1].toFixed(2));
  expect(g.ticks[1].at).toBeCloseTo(g.stops[1], 1);
  expect(g.bg).toBe(g.want);

  // Turned on its knob, the tick moves with it.
  await page.evaluate(() => {
    const k = document.querySelectorAll('#roomPaintBody .rp-stop input[type=range]')[1];
    k.value = '70'; k.dispatchEvent(new Event('input', { bubbles: true }));
  });
  g = await geo();
  expect(g.ticks[1].at).toBeCloseTo(0.7, 1);
  expect(g.ticks[1].now).toBeCloseTo(0.7, 2);

  // And to the keyboard it is a slider.
  await page.locator('#roomPaintBody .rp-tick').nth(1).focus();
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => rpSlot('ring').stops[1].at)).toBeCloseTo(0.69, 3);

  // Classic keeps its sliders and has no bar.
  await page.evaluate(() => { rpView = 'classic'; rpPanel(); });
  await expect(page.locator('#roomPaintBody .rp-stopbar')).toHaveCount(0);
});
