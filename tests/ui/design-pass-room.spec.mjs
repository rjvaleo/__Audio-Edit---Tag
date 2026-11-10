// The design pass of 27 Oct 2026, continued: Visual › 4D and the rest of
// Visual › Room. See `design-pass.spec.mjs` and `docs/DESIGN-CRITIQUE.md`.

import { test, expect } from './test.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFile, roomTab } from './design-pass.helpers.mjs';

// ── Visual › 4D ─────────────────────────────────────────────────────────────
// The lighter pass the critique promised the 4D tab ("Not yet done"): its
// choices as rows of fixed places, its two amounts as knobs, the six plane
// angles kept as scrub fields, and nothing left blank.

async function dim4(page) {
  await openFile(page);
  await roomTab(page, 'dim4');
  await page.evaluate(() => {
    p4.spinning = false; p4.spin = 'zw'; p4.mode = 'perspective'; p4.eye = 2.5; p4.rate = 0.35;
    p4BuildPanel(); p4Draw();
  });
}

/// The places of one segment row: where each is, and whether it is lit.
const p4Places = (name) => `[...document.querySelectorAll('#p4Panel .p4-seg[data-p4seg="${name}"] > .re-btn')]
  .map((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
    return { text: b.textContent.trim(), on: b.classList.contains('active'), x: Math.round(r.left), w: Math.round(r.width), top: Math.round(r.top),
      bg: cs.backgroundColor, edge: cs.borderTopColor }; })`;

test('4D-1 · projection and turning are rows of fixed places, lit and never filled', async ({ page }) => {
  await dim4(page);
  const proj = await page.evaluate(p4Places('projection'));
  const turn = await page.evaluate(p4Places('turning'));
  expect(proj.map((p) => p.text)).toEqual(['Perspective', 'Parallel']);
  expect(turn.map((p) => p.text.replace(/\s/g, ''))).toEqual(['Still', 'XY', 'XZ', 'YZ', 'XW·w', 'YW·w', 'ZW·w']);
  // No dropdown is left to choose the plane.
  expect(await page.locator('#p4Panel select').count()).toBe(0);
  for (const row of [proj, turn]) {
    // One line, every place the same width.
    expect(new Set(row.map((p) => p.top)).size).toBe(1);
    expect(Math.max(...row.map((p) => p.w)) - Math.min(...row.map((p) => p.w))).toBeLessThanOrEqual(1);
    expect(row.filter((p) => p.on).length).toBe(1);
    // Lit: a tint behind it, an edge that is not the resting one — never a fill.
    const on = row.find((p) => p.on), off = row.find((p) => !p.on);
    const alpha = (c) => { const m = c.match(/[\d.]+/g).map(Number); return m.length > 3 ? m[3] : 1; };
    expect(alpha(on.bg)).toBeLessThan(0.5);
    expect(on.edge).not.toBe(off.edge);
  }
  // Still is lit while the clock is stopped; a plane lights, and turns, when chosen.
  expect(turn.find((p) => p.on).text).toBe('Still');
  await page.locator('#p4Panel .p4-seg[data-p4seg="turning"] > .re-btn', { hasText: 'XW' }).click();
  expect(await page.evaluate(() => ({ spin: p4.spin, spinning: p4.spinning }))).toEqual({ spin: 'xw', spinning: true });
  await page.locator('#p4Panel .p4-seg[data-p4seg="projection"] > .re-btn', { hasText: 'Parallel' }).click();
  expect(await page.evaluate(() => p4.mode)).toBe('orthographic');
  // Fixed places: choosing moved nothing.
  const proj2 = await page.evaluate(p4Places('projection'));
  const turn2 = await page.evaluate(p4Places('turning'));
  expect(proj2.map((p) => [p.x, p.w])).toEqual(proj.map((p) => [p.x, p.w]));
  expect(turn2.map((p) => [p.x, p.w])).toEqual(turn.map((p) => [p.x, p.w]));
  expect(turn2.find((p) => p.on).text.replace(/\s/g, '')).toBe('XW·w');
});

test('4D-2 · Eye and Rate are sliders, each with its word and its reading', async ({ page }) => {
  await dim4(page);
  const sliders = await page.evaluate(() => ['Eye', 'Rate'].map((name) => {
    const input = document.querySelector(`#p4Panel input[type=range][data-p4k="${name}"]`);
    if (!input) return { name, why: 'no range input' };
    const wrap = input.closest('.rk-k');
    const r = input.getBoundingClientRect();
    return {
      name,
      label: wrap.querySelector('.rk-l')?.textContent,
      read: wrap.querySelector('.rk-v')?.value,
      wide: r.width >= 60,
      reached: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === input,
    };
  }));
  expect(sliders).toEqual([
    { name: 'Eye', label: 'Eye', read: '2.50', wide: true, reached: true },
    { name: 'Rate', label: 'Rate', read: '0.350', wide: true, reached: true },
  ]);
  // Clicked to the right is more.
  const box = await page.locator('#p4Panel input[data-p4k="Eye"]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
  const after = await page.evaluate(() => ({ eye: p4.eye,
    read: document.querySelector('#p4Panel input[data-p4k="Eye"]').closest('.rk-k').querySelector('.rk-v').value }));
  expect(after.eye).toBeGreaterThan(2.5);
  expect(after.read).toBe(after.eye.toFixed(2));
  // A double-click puts it back, as every control in this program does.
  await page.locator('#p4Panel input[data-p4k="Eye"]').dblclick();
  expect(await page.evaluate(() => p4.eye)).toBe(2.5);
  // The reading is a number field, as the field it replaced was: an exact value is typed in.
  for (const [name, typed, want] of [['Eye', '4.25', 4.25], ['Rate', '0.125', 0.125]]) {
    const field = page.locator(`#p4Panel .p4-knob-read[data-p4="${name}"]`);
    await field.fill(typed);
    await field.press('Enter');
    expect(await page.evaluate((n) => (n === 'Eye' ? p4.eye : p4.rate), name)).toBe(want);
    expect(+(await page.locator(`#p4Panel input[data-p4k="${name}"]`).inputValue())).toBe(want);
  }
});

test('4D-3 · the six plane angles stay scrub fields', async ({ page }) => {
  await dim4(page);
  const fields = await page.evaluate(() => [...document.querySelectorAll('#p4Panel .p4-num-in:not(.p4-knob-read)')]
    .map((i) => ({ name: i.dataset.p4, type: i.type, cursor: getComputedStyle(i).cursor })));
  expect(fields.map((f) => f.name)).toEqual(['XY', 'XZ', 'YZ', 'XW', 'YW', 'ZW']);
  expect(fields.every((f) => f.type === 'text' && f.cursor === 'ew-resize')).toBe(true);
});

test('4D-4 · the tab is dense: one width, no blank space, the notes kept, all of it on screen', async ({ page }) => {
  await dim4(page);
  const m = await page.evaluate(() => {
    const body = document.getElementById('room4dBody');
    const b = body.getBoundingClientRect();
    const cs = getComputedStyle(body);
    const left = b.left + parseFloat(cs.paddingLeft), right = b.right - parseFloat(cs.paddingRight);
    const kids = [body.querySelector('.p4-view'), ...document.getElementById('p4Panel').children]
      .filter((e) => e.getBoundingClientRect().height);
    const rects = kids.map((e) => ({ what: e.className || e.tagName, r: e.getBoundingClientRect() }));
    const gaps = [];
    for (let i = 1; i < rects.length; i++) {
      const g = Math.round(rects[i].r.top - rects[i - 1].r.bottom);
      if (g > 10) gaps.push(`${rects[i - 1].what} → ${rects[i].what}: ${g}px`);
    }
    return {
      // Every module of the tab spans the one width, edge to edge.
      ragged: rects.filter((x) => Math.abs(x.r.left - left) > 1 || Math.abs(x.r.right - right) > 1).map((x) => x.what),
      gaps,
      notes: [...document.querySelectorAll('#p4Panel .fx-note')].map((n) => n.textContent),
      // Nothing below the fold: the whole tab is on screen without scrolling.
      scrolls: body.scrollHeight > body.clientHeight + 1,
      bottom: Math.round(rects[rects.length - 1].r.bottom), floor: Math.round(b.bottom),
    };
  });
  expect(m.ragged).toEqual([]);
  expect(m.gaps).toEqual([]);
  // The explanations stay, on purpose (STATE.md §7).
  expect(m.notes.some((t) => /fourth dimension/.test(t))).toBe(true);
  expect(m.notes.some((t) => /w axis/.test(t))).toBe(true);
  expect(m.scrolls).toBe(false);
  expect(m.bottom).toBeLessThanOrEqual(m.floor);
  // …and nothing blank under it: what the controls leave over goes to the viewport.
  expect(m.floor - m.bottom).toBeLessThanOrEqual(12);
});

test('F5 · every fog type reads whole in its menu, and the curve says its value aloud', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const fit = await page.evaluate(() => {
    const sel = document.getElementById('reFogType');
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(sel).font}`;
    document.body.appendChild(probe);
    const widest = Math.max(...[...sel.options].map((o) => { probe.textContent = o.textContent; return probe.getBoundingClientRect().width; }));
    probe.remove();
    // The text, the menu's own padding and border either side, and its arrow.
    const cs = getComputedStyle(sel);
    const sides = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((n, k) => n + parseFloat(cs[k]), 0);
    return { need: Math.ceil(widest + sides) + 20, have: sel.getBoundingClientRect().width };
  });
  expect(fit.have).toBeGreaterThanOrEqual(fit.need);
  await page.selectOption('#reFogType', '1');
  await page.evaluate(() => { const i = document.getElementById('reFogDensity'); i.value = '75'; i.dispatchEvent(new Event('input')); });
  const a11y = await page.evaluate(() => {
    const i = document.getElementById('reFogDensity');
    return { name: i.getAttribute('aria-label'), value: i.getAttribute('aria-valuetext') };
  });
  expect(a11y.name).toBe('Fog density');
  expect(a11y.value).toBe('0.75');
});

test('F6 · on Linear the fog says its density does nothing', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const read = () => page.evaluate(() => ({
    colour: getComputedStyle(document.querySelector('#roomEdit .rk-fog-read')).color,
    spoken: document.getElementById('reFogDensity').getAttribute('aria-valuetext'),
  }));
  await page.selectOption('#reFogType', '1');
  const exp = await read();
  await page.selectOption('#reFogType', '0');
  const lin = await read();
  expect(lin.colour).not.toBe(exp.colour);
  expect(lin.spoken).toMatch(/not used/i);
  expect(exp.spoken).not.toMatch(/not used/i);
});

// ── Visual › Room · the camera, folded to what is used ──────────────────────

test('R1 · the camera\'s keys and pose are folded away until asked for', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const shown = () => page.evaluate(() => ({
    legend: document.querySelector('#roomEdit .re-legend').getBoundingClientRect().height,
    nums: document.getElementById('reNums').getBoundingClientRect().height,
    text: document.getElementById('reNums').textContent.length,
  }));
  const closed = await shown();
  expect(closed.legend).toBe(0);
  expect(closed.nums).toBe(0);
  // Still kept up to date while folded: it is what gets copied.
  expect(closed.text).toBeGreaterThan(10);
  const btn = page.locator('#rkKeys');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const open = await shown();
  expect(open.legend).toBeGreaterThan(10);
  expect(open.nums).toBeGreaterThan(10);
});

test('R2 · the channel box is two lines, in the pads\' own words', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const box = await page.evaluate(() => {
    const ids = ['reCamTx', 'reCamTy', 'reCamTz', 'reCamRx', 'reCamRy', 'reCamFocal', 'reCamCoi'];
    const rows = ids.map((id) => document.getElementById(id).closest('.re-row'));
    return {
      lines: new Set(rows.map((r) => Math.round(r.getBoundingClientRect().top))).size,
      words: rows.map((r) => r.querySelector('.re-tag').innerText.trim()),
    };
  });
  expect(box.lines).toBe(2);
  expect(box.words).toEqual(['MOVE X', 'MOVE Y', 'MOVE Z', 'TILT', 'TURN', 'FOCAL', 'CENTRE']);
});

test('R3 · a camera pad is moved from the keyboard', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const pad = page.locator('#roomEdit .rk-pad').first();
  await pad.focus();
  expect(await pad.evaluate((e) => e === document.activeElement && e.matches(':focus-visible') !== undefined)).toBe(true);
  const before = await page.evaluate(() => roomWorldNow().yaw);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const after = await page.evaluate(() => roomWorldNow().yaw);
  expect(after).toBeGreaterThan(before);
  expect(await pad.getAttribute('aria-label')).toMatch(/turn.*°/i);
  expect(+(await page.locator('#reCamRy').inputValue())).toBeCloseTo(after, 1);
});

// ── Visual › Room · Air · mist ──────────────────────────────────────────────

test('M1 · mist is drawn as its drips, and dragging up lengthens them', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const drawn = () => page.evaluate(() => {
    const g = document.querySelector('#roomEdit .rk-mist-graph');
    return g && { dots: g.querySelectorAll('circle').length, sig: g.querySelector('svg').innerHTML.length + ':' + [...g.querySelectorAll('circle')].map((c) => c.getAttribute('cy')).join(),
      read: document.querySelector('#roomEdit .rk-mist-read')?.textContent.trim() };
  });
  const first = await drawn();
  expect(first, 'no mist drawing in the Air group').toBeTruthy();
  const graph = page.locator('#roomEdit .rk-mist-graph');
  await graph.scrollIntoViewIfNeeded();
  const box = await graph.boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe('reMistLength');
  const before = await page.evaluate(() => roomEdit.mistLength);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => roomEdit.mistLength);
  expect(after).toBeGreaterThan(before);
  const longer = await drawn();
  expect(longer.sig).not.toBe(first.sig);
  expect(+longer.read).toBeCloseTo(after, 3);
  // The amount is its knob beside it, and the drawing counts it.
  await page.evaluate(() => { const i = document.getElementById('reMistAmount'); i.value = '100'; i.dispatchEvent(new Event('input')); });
  const more = await drawn();
  expect(more.dots).toBeGreaterThan(longer.dots);
  // A recalled look redraws it too.
  await page.evaluate(() => { const look = visualSnapshot(); look.room.mistLength = 0.004; applyVisual(look); });
  expect((await drawn()).read).toBe('0.004');
});

// ── Visual › Room · the rest of the review ─────────────────────────────────

/// Contrast of two colours as the browser resolves them, oklch and all.
const contrastFn = `(a, b) => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillRect(0, 0, 1, 1); cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}`;

test('U1 · Clear looks like what it does, and can be taken back', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const look = await page.evaluate(() => {
    const c = getComputedStyle(document.getElementById('reClear'));
    const r = getComputedStyle(document.getElementById('reReset'));
    return { clear: c.color + c.borderColor, reset: r.color + r.borderColor };
  });
  expect(look.clear).not.toBe(look.reset);
  await page.evaluate(() => { roomEdit.ringDrive = 3; });
  await page.locator('#reClear').click();
  expect(await page.evaluate(() => roomEdit.ringDrive)).not.toBe(3);
  const undo = page.locator('#rkUndoClear');
  await expect(undo).toBeVisible();
  await undo.click();
  expect(await page.evaluate(() => roomEdit.ringDrive)).toBe(3);
  await expect(undo).toBeHidden();
});

test('U2 · a stream that is off still looks like a switch, and says whether it is on', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const s = await page.evaluate(`(() => {
    const contrast = ${contrastFn};
    const btns = [...document.querySelectorAll('#reStreams .re-btn')];
    const off = btns.find((b) => !b.classList.contains('active'));
    let bg = off.parentElement; while (bg && /rgba\\(0, 0, 0, 0\\)|transparent/.test(getComputedStyle(bg).backgroundColor)) bg = bg.parentElement;
    return {
      edge: contrast(getComputedStyle(off).borderTopColor, getComputedStyle(bg).backgroundColor),
      pressed: btns.map((b) => b.getAttribute('aria-pressed') === String(b.classList.contains('active'))),
    };
  })()`);
  // WCAG 1.4.11: the edge that says "this is a control" at 3:1.
  expect(s.edge).toBeGreaterThanOrEqual(3);
  expect(s.pressed.every(Boolean)).toBe(true);
});

test('U3 · the switches, menus and swatches are drawn in the column\'s own hand', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const c = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 0;
    const boxes = [...document.querySelectorAll('#roomEdit .re-check input[type=checkbox]')].filter(vis);
    const menus = [...document.querySelectorAll('#roomEdit select')].filter(vis);
    const swatches = [...document.querySelectorAll('#roomEdit input[type=color]')].filter(vis);
    return {
      n: [boxes.length, menus.length, swatches.length],
      native: [...boxes, ...menus].filter((e) => getComputedStyle(e).appearance !== 'none').map((e) => e.id),
      plainSwatch: swatches.filter((e) => getComputedStyle(e).backgroundImage === 'none').map((e) => e.id),
    };
  });
  expect(c.n.every((n) => n > 0)).toBe(true);
  expect(c.native).toEqual([]);
  // A swatch carries a mark that says it opens a picker.
  expect(c.plainSwatch).toEqual([]);
  // …and on the master bus nothing changed.
  await page.evaluate(() => setMode('edit'));
  await page.waitForTimeout(300);
  const overlay = await page.evaluate(() => getComputedStyle(document.getElementById('reFog')).appearance);
  expect(overlay).not.toBe('none');
});

test('U4 · the block row names both of its settings', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const words = await page.evaluate(() => [...document.getElementById('reChunks').closest('.re-row').querySelectorAll('.rk-l')].map((e) => e.textContent.trim()));
  expect(words).toEqual(['Size', 'Opacity']);
});
