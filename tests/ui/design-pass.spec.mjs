// The design pass of 27 Oct 2026, held in place. See `docs/DESIGN-CRITIQUE.md`.
//
// Each test is one item of that critique, named by its change ID, so a failure
// here says which decision has been undone. They measure the page as it is
// drawn — positions, computed styles, roles — rather than the source, except
// where the fault can only be seen in the source (a canvas font that one
// browser can draw and another cannot).

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '../../ui');

/// The type scale, in px. `--fs-xs` … `--fs-xl` in `app.css`.
const SCALE = [9, 10, 11, 13, 16];

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
}

async function openFile(page) {
  await ready(page);
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, { timeout: 20_000 });
  await page.waitForTimeout(400);
}

async function dockTab(page, name) {
  await page.locator(`.dock-tab[data-dock="${name}"]`).click();
  await page.waitForTimeout(300);
}

async function roomTab(page, name) {
  await page.evaluate(() => setMode('room'));
  await page.locator(`#roomAdmin .rv-tab[data-rvtab="${name}"]`).click();
  await page.waitForTimeout(300);
}

/// Every visible element that prints words of its own, with its size. Glyphs
/// (▶ ⟲ ×) are icons and are sized as icons; the room's data block is part of
/// the picture, printed on the wall, and keeps its own size.
const sizesOnScreen = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.room-data, .theme-mini, svg, canvas')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!/[A-Za-z0-9]/.test(own)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    out.push({ size: parseFloat(cs.fontSize), what: (el.id || el.className || el.tagName) + ': ' + own.slice(0, 24) });
  }
  return out;
})()`;

test('C1 · every word on screen is set at a step of the type scale', async ({ page }) => {
  await openFile(page);
  const off = [];
  for (const tab of ['stretch', 'effects', 'prism', 'visuals', 'automation', 'regions']) {
    await dockTab(page, tab);
    for (const s of await page.evaluate(sizesOnScreen)) if (!SCALE.includes(s.size)) off.push(`grain/${tab} ${s.size}px ${s.what}`);
  }
  for (const tab of ['controls', 'sound', 'geom', 'paint', 'dim4']) {
    await roomTab(page, tab);
    for (const s of await page.evaluate(sizesOnScreen)) if (!SCALE.includes(s.size)) off.push(`visual/${tab} ${s.size}px ${s.what}`);
  }
  expect([...new Set(off)]).toEqual([]);
});

test('C1 · the stylesheets name no size between the steps', async () => {
  const bad = [];
  for (const f of ['app.css', 'rail.css']) {
    const css = readFileSync(join(UI, f), 'utf8');
    for (const m of css.matchAll(/font(?:-size)?:[^;{}]*?(\d+(?:\.\d+)?)px/g)) {
      const px = +m[1];
      if (!Number.isInteger(px)) bad.push(`${f}: ${m[0]}`);
    }
  }
  expect(bad).toEqual([]);
});

test('C1 · a canvas label never names only a family the browser may not have', async () => {
  // `ui-monospace` is Safari's. Alone, Chromium falls back to its default — a
  // serif — which is how the EQ's axis came to be printed in Times.
  const bad = [];
  for (const f of readdirSync(UI).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(UI, f), 'utf8');
    for (const m of src.matchAll(/\.font\s*=\s*(['"`])(.*?)\1/g)) {
      const families = m[2].replace(/^.*?(?:\d+(?:\.\d+)?|\})px(?:\/\S+)?\s*/, '');
      // A family chosen at run time — the type card's face — is the user's.
      if (families.includes('${')) continue;
      const generic = /\b(monospace|sans-serif|serif|system-ui)\s*$/.test(families);
      if (!generic) bad.push(`${f}: ${m[2]}`);
    }
  }
  expect(bad).toEqual([]);
});

/// The knobs of a panel in the Visual column: each has a face, a reading, and
/// the input itself under the pointer where the face is drawn.
const knobsIn = (root) => `(() => {
  const out = [];
  for (const k of document.querySelectorAll(${JSON.stringify(root)} + ' .rk-k')) {
    const input = k.querySelector('input[type=range]');
    const face = k.querySelector('.rk-face').getBoundingClientRect();
    if (!face.width) continue;
    k.scrollIntoView({ block: 'center' });
    const f = k.querySelector('.rk-face').getBoundingClientRect();
    const hit = document.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2);
    out.push({ id: input.id || k.querySelector('.rk-l').textContent,
      read: k.querySelector('.rk-v').textContent.trim(), reached: hit === input });
  }
  return out;
})()`;

test('C2 · an amount in the Visual column is a knob that shows its reading', async ({ page }) => {
  await openFile(page);
  const knobs = [];
  await roomTab(page, 'controls');
  knobs.push(...await page.evaluate(knobsIn('#roomEdit')));
  await roomTab(page, 'geom');
  knobs.push(...await page.evaluate(knobsIn('#roomGeomBody')));
  expect(knobs.length).toBeGreaterThan(18);
  expect(knobs.filter((k) => !k.read || !k.reached)).toEqual([]);
});

test('C2 · a knob turns up when it is dragged up, and the setting follows', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const knob = page.locator('#reRing');
  await knob.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => roomEdit.ringScale);
  const box = await page.locator('#roomEdit .rk-k:has(#reRing) .rk-face').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => roomEdit.ringScale);
  expect(after).toBeGreaterThan(before);
  const read = await page.locator('#roomEdit .rk-k:has(#reRing) .rk-v').textContent();
  expect(+read).toBeCloseTo(after, 2);
});

test('C2 · the camera pads move the camera, and the channel box follows', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const pad = page.locator('#roomEdit .rk-pad').first();
  const box = await pad.boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.5);
  const yaw = await page.evaluate(() => roomWorldNow().yaw);
  expect(yaw).toBeCloseTo(90, 0);
  expect(+(await page.locator('#reCamRy').inputValue())).toBeCloseTo(90, 0);
});

test('C3 · the Prism pad sits hard against a fixed-width control column', async ({ page }) => {
  const measure = () => page.evaluate(() => {
    const cols = ['.prism-bar', '.prism-hp'].flatMap((s) => [...document.querySelectorAll(`#dockPrism ${s}`)]);
    const right = Math.max(...cols.map((e) => e.getBoundingClientRect().right));
    const left = Math.min(...cols.map((e) => e.getBoundingClientRect().left));
    const pad = document.getElementById('prismPad').getBoundingClientRect();
    const yAxis = document.querySelector('#dockPrism .prism-y-axis').getBoundingClientRect();
    return { colW: Math.round(right - left), gap: Math.round(Math.min(pad.left, yAxis.left) - right), padSide: Math.round(pad.width) };
  });
  await openFile(page);
  await dockTab(page, 'prism');
  const wide = await measure();
  expect(wide.gap).toBeGreaterThanOrEqual(0);
  expect(wide.gap).toBeLessThanOrEqual(24);
  expect(wide.padSide).toBeGreaterThanOrEqual(140);
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.waitForTimeout(300);
  const narrow = await measure();
  expect(narrow.colW).toBe(wide.colW);
});

test('C4 · keyboard focus is visible on every kind of control', async ({ page }) => {
  await openFile(page);
  for (const sel of ['#playBtn', '.dock-tab[data-dock="effects"]', '#leftRail .mode-btn', '#presetPick', '#dockStretch input[type=range]']) {
    const ring = await page.evaluate((s) => {
      const el = document.querySelector(s);
      el.focus();
      const cs = getComputedStyle(el);
      return { visible: el.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    }, sel);
    expect(ring.visible, sel).toBe(true);
    expect(ring.style, sel).not.toBe('none');
    expect(ring.width, sel).toBeGreaterThanOrEqual(1);
  }
});

test('C5 · the dock and Visual tabs are tabs to anything that reads the page', async ({ page }) => {
  await openFile(page);
  const read = (strip, tab) => page.evaluate(([s, t]) => ({
    list: document.querySelector(s).getAttribute('role'),
    roles: [...document.querySelectorAll(t)].map((e) => e.getAttribute('role')),
    selected: [...document.querySelectorAll(t)].filter((e) => e.getAttribute('aria-selected') === 'true').map((e) => e.textContent.trim()),
  }), [strip, tab]);

  await dockTab(page, 'effects');
  const dock = await read('.dock-rail', '.dock-tab');
  expect(dock.list).toBe('tablist');
  expect(new Set(dock.roles)).toEqual(new Set(['tab']));
  expect(dock.selected).toHaveLength(1);
  expect(dock.selected[0]).toContain('FX');

  await roomTab(page, 'paint');
  const room = await read('#roomAdmin .rv-admin-head', '#roomAdmin .rv-tab');
  expect(room.list).toBe('tablist');
  expect(new Set(room.roles)).toEqual(new Set(['tab']));
  expect(room.selected).toEqual(['Colour']);
});

test('C6 · the transport\'s words fit their buttons, and the meta strip ends cleanly', async ({ page }) => {
  await openFile(page);
  for (const id of ['srcGrain', 'srcSeq']) {
    const fit = await page.evaluate((i) => {
      const b = document.getElementById(i);
      return b.scrollWidth <= b.clientWidth;
    }, id);
    expect(fit, id).toBe(true);
  }
  // In the Grain bar it shows, and where it is fuller than its box it fades
  // out at its end instead of being cut through a word by the volume.
  const grain = await page.evaluate(() => {
    const m = document.getElementById('metaStrip');
    return { over: m.scrollWidth > m.clientWidth + 1, marked: m.classList.contains('overflowing') };
  });
  expect(grain.marked).toBe(grain.over);

  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(300);
  // In the Visual foot the bar shares its line with Video and the visuals
  // menu, and the strip was cut mid-word into the volume. It is left out there;
  // wherever it is shown, it fits.
  const strip = await page.evaluate(() => {
    const m = document.getElementById('metaStrip');
    return { shown: !!m.getBoundingClientRect().width, fits: m.scrollWidth <= m.clientWidth + 1 };
  });
  expect(!strip.shown || strip.fits).toBe(true);
});

test('C7 · a button that shows only a glyph says what it does', async ({ page }) => {
  await openFile(page);
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return !/[A-Za-z0-9]/.test(b.textContent) && !(b.getAttribute('aria-label') || '').trim();
  }).map((b) => b.id || b.className));
  expect(unnamed).toEqual([]);
});

test('C8 · the automation timeline is drawn at its own width when its tab opens', async ({ page }) => {
  await openFile(page);
  await dockTab(page, 'automation');
  const c = await page.evaluate(() => {
    const el = document.getElementById('perfCanvas');
    return { backing: el.width, css: el.clientWidth, dpr: devicePixelRatio || 1 };
  });
  expect(Math.abs(c.backing - Math.round(c.css * c.dpr))).toBeLessThanOrEqual(2);
});

test('C9 · Browse with the library put away offers to open it', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => setMode('overview'));
  await page.locator('#leftRail [data-mode="overview"]').first().click();
  await expect(page.locator('#leftPanel')).toHaveClass(/collapsed/);
  const open = page.locator('#laneEmpty button');
  await expect(open).toBeVisible();
  await open.click();
  await expect(page.locator('#leftPanel')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#laneEmpty button')).toBeHidden();
});

test('C10 · nothing in the Visual column hangs off its edge or prints over its heading', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'sound');
  const sound = await page.evaluate(() => {
    const col = document.getElementById('roomAdmin').getBoundingClientRect();
    return [...document.querySelectorAll('#roomSoundBody .engine-switches > *')]
      .filter((e) => e.getBoundingClientRect().width)
      .map((e) => ({ what: e.textContent.trim(), over: Math.round(e.getBoundingClientRect().right - col.right) }))
      .filter((e) => e.over > 0);
  });
  expect(sound).toEqual([]);
  // …and its four fixed places do not print over one another.
  const overlaps = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#roomSoundBody .engine-switches > [data-slot]')]
      .map((e) => e.getBoundingClientRect()).filter((b) => b.width);
    let n = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      if (r[i].left < r[j].right - 0.5 && r[j].left < r[i].right - 0.5
        && r[i].top < r[j].bottom - 0.5 && r[j].top < r[i].bottom - 0.5) n++;
    }
    return n;
  });
  expect(overlaps).toBe(0);

  await roomTab(page, 'dim4');
  const dim4 = await page.evaluate(() => {
    const host = document.getElementById('room4dBody');
    const tags = [...host.querySelectorAll(':scope .re-tag')];
    const list = host.querySelector('.p4-objects').getBoundingClientRect();
    const object = tags.find((t) => t.textContent.trim() === 'OBJECT').getBoundingClientRect();
    const planes = tags.find((t) => /SIX PLANES/.test(t.textContent));
    return { listBottom: list.bottom, objectTop: object.top, planesH: planes.getBoundingClientRect().height };
  });
  expect(dim4.listBottom).toBeLessThanOrEqual(dim4.objectTop);
  expect(dim4.planesH).toBeLessThanOrEqual(14);
});

test('C12 · the interface honours reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  // The library panel slides open and shut — the interface's own motion, as
  // against the pictures, which are what the program makes.
  const t = await page.evaluate(() => getComputedStyle(document.getElementById('leftPanel')).transitionDuration);
  expect(t.split(',').every((d) => parseFloat(d) <= 0.01)).toBe(true);
});

// ── the granular engine's tray ──────────────────────────────────────────────
// `docs/DESIGN-CRITIQUE.md`, "The granular engine". Knob banks across the dock,
// the cloud pad first, every word whole.

async function engine(page, alg) {
  await dockTab(page, 'stretch');
  await page.evaluate((a) => document.querySelector(`#stretchEngine .seg-btn[data-alg="${a}"]`).click(), alg);
  await page.waitForTimeout(500);
}

test('G1 · the whole granular tray is on screen without a scroll', async ({ page }) => {
  await openFile(page);
  await engine(page, 'granular');
  const box = await page.evaluate(() => {
    const g = document.getElementById('grainControls');
    return { scroll: g.scrollHeight, client: g.clientHeight };
  });
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
});

test('G2 · every control in the tray that is an amount is a knob a pointer reaches', async ({ page }) => {
  await openFile(page);
  for (const alg of ['granular', 'wsola']) {
    await engine(page, alg);
    const knobs = await page.evaluate(() => [...document.querySelectorAll('#grainControls input[type=range]')]
      .filter((i) => i.closest('.param').getBoundingClientRect().width)
      .map((i) => {
        const row = i.closest('.param');
        const face = row.querySelector(':scope > .rk-face');
        if (!face) return { name: row.querySelector('.k')?.textContent, why: 'no knob face' };
        // WSOLA's last bank is below the dock's fold; scrolled to, like a hand would.
        face.scrollIntoView({ block: 'center' });
        const f = face.getBoundingClientRect();
        const hit = document.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2);
        return { name: row.querySelector('.k')?.textContent, read: row.querySelector('.v')?.textContent.trim(), reached: hit === i };
      }));
    expect(knobs.length, alg).toBeGreaterThan(12);
    expect(knobs.filter((k) => k.why || !k.read || !k.reached), alg).toEqual([]);
  }
});

test('G3 · no switch in the tray has had its vowels taken out', async ({ page }) => {
  await openFile(page);
  const bad = [];
  for (const alg of ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular']) {
    await engine(page, alg);
    bad.push(...await page.evaluate(() => [...document.querySelectorAll('#grainControls button')]
      .map((b) => b.textContent.trim())
      .filter((t) => /\b[a-z]*[bcdfghjklmnpqrstvwxz]{4,}[a-z]*\b/i.test(t.replace(/\b(WSOLA|PVSOLA)\b/g, '')))));
  }
  expect([...new Set(bad)]).toEqual([]);
});

test('G4 · the cloud pad leads the tray and is drawn large', async ({ page }) => {
  await openFile(page);
  await engine(page, 'granular');
  const g = await page.evaluate(() => {
    const pad = document.getElementById('cloudPad').getBoundingClientRect();
    const first = [...document.querySelectorAll('#grainControls .rk-face')]
      .map((f) => f.getBoundingClientRect()).filter((r) => r.width)
      .reduce((m, r) => Math.min(m, r.left), Infinity);
    return { w: pad.width, h: pad.height, left: pad.left, knobsFrom: first };
  });
  expect(g.w).toBeGreaterThanOrEqual(220);
  expect(g.h).toBeGreaterThanOrEqual(120);
  expect(g.left).toBeLessThan(g.knobsFrom);
});

test('G5 · the extended side\'s knobs are drawn in its own colour', async ({ page }) => {
  await openFile(page);
  await engine(page, 'granular');
  const c = await page.evaluate(() => {
    const arc = (sel) => { const a = document.querySelector(`${sel} .rk-arc`); return a && getComputedStyle(a).stroke; };
    return { std: arc('#grainShape'), ext: arc('#extGrain') };
  });
  expect(c.std).toBeTruthy();
  expect(c.ext).toBeTruthy();
  expect(c.ext).not.toBe(c.std);
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

test('P3 · every amount on the Colour tab is a knob a pointer reaches', async ({ page }) => {
  await paintTab(page, 'ring', RAMP);
  const knobs = await page.evaluate(() => [...document.querySelectorAll('#roomPaintBody input[type=range]')].map((i) => {
    const k = i.closest('.rk-k');
    if (!k) return { why: 'not a knob', title: i.title };
    k.scrollIntoView({ block: 'center' });
    const f = k.querySelector('.rk-face').getBoundingClientRect();
    const hit = document.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2);
    return { word: k.querySelector('.rk-l').textContent, read: k.querySelector('.rk-v').textContent.trim(), reached: hit === i };
  }));
  // Three stops and the curve. The range is not a pair of sliders any more.
  expect(knobs.length).toBe(4);
  expect(knobs.filter((k) => k.why || !k.read || !k.reached)).toEqual([]);

  // The curve turns up when it is dragged up, and its reading follows.
  const face = await page.locator('#roomPaintBody .rk-k:has(.rp-curve) .rk-face').boundingBox();
  await page.mouse.move(face.x + face.width / 2, face.y + face.height / 2);
  await page.mouse.down();
  await page.mouse.move(face.x + face.width / 2, face.y + face.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  const curve = await page.evaluate(() => rpSlot('ring').curve);
  expect(curve).toBeGreaterThan(1);
  expect(+(await page.locator('#roomPaintBody .rk-k:has(.rp-curve) .rk-v').textContent())).toBeCloseTo(curve, 2);

  // A stop's knob moves that stop and only that one.
  const stop = await page.locator('#roomPaintBody .rp-stop').nth(1).locator('.rk-face').boundingBox();
  await page.mouse.move(stop.x + stop.width / 2, stop.y + stop.height / 2);
  await page.mouse.down();
  await page.mouse.move(stop.x + stop.width / 2, stop.y + stop.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
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
