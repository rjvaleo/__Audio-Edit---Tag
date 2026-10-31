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

test('C3 · a process\'s extra settings are a bank of knobs to the right of the pad', async ({ page }) => {
  const measure = () => page.evaluate(() => {
    const box = document.getElementById('prismSettings').getBoundingClientRect();
    const pad = document.getElementById('prismPad').getBoundingClientRect();
    const dock = document.getElementById('dockPrism').getBoundingClientRect();
    const knobs = [...document.querySelectorAll('#prismSettings .param')].map((row) => {
      const face = row.querySelector(':scope > .rk-face')?.getBoundingClientRect();
      const input = row.querySelector(':scope > input[type=range]').getBoundingClientRect();
      return {
        knob: row.classList.contains('gk-k'),
        face: face ? Math.round(face.width) : 0,
        over: !!face && Math.abs((input.left + input.right) / 2 - (face.left + face.right) / 2) <= 2
          && Math.abs((input.top + input.bottom) / 2 - (face.top + face.bottom) / 2) <= 3,
      };
    });
    return {
      shown: box.width > 0 && box.height > 0,
      gap: Math.round(box.left - pad.right), top: Math.round(box.top - pad.top),
      width: Math.round(box.width), inDock: box.right <= dock.right + 1,
      note: document.querySelector('#prismSettings .prism-settings-note')?.textContent.trim() || '',
      knobs,
    };
  });
  await openFile(page);
  await dockTab(page, 'prism');
  await page.waitForFunction(() => (window.prismPad?.sources || []).length > 0);
  // Time & Pitch keeps its other settings on its own tab: a note says so,
  // where the knobs would be, and nothing reads as missing.
  const none = await measure();
  expect(none.shown).toBe(true);
  expect(none.knobs).toHaveLength(0);
  expect(none.note).toMatch(/Time & Pitch tab/);
  expect(none.gap).toBeGreaterThanOrEqual(0);
  expect(none.gap).toBeLessThanOrEqual(24);
  // The Pitch Time Changer has four: knobs, each face under its input.
  await page.locator('#prismSource').selectOption({ label: 'Pitch Time Changer' });
  await page.waitForTimeout(300);
  const wide = await measure();
  expect(wide.note).toBe('');
  expect(wide.knobs).toHaveLength(4);
  for (const k of wide.knobs) {
    expect(k.knob).toBe(true);
    expect(k.face).toBeGreaterThanOrEqual(20);
    expect(k.over).toBe(true);
  }
  // Hard against the pad, level with its top, inside the dock.
  expect(wide.gap).toBeGreaterThanOrEqual(0);
  expect(wide.gap).toBeLessThanOrEqual(24);
  expect(Math.abs(wide.top)).toBeLessThanOrEqual(24);
  expect(wide.inDock).toBe(true);
  // One width, whatever the process and whatever the window.
  expect(wide.width).toBe(none.width);
  // A knob turned up sets what its slider set: the Pitch Time Changer's value.
  const before = await page.evaluate(() => prismPtc().feedback);
  const face = await page.locator('#prismSettings .param').first().locator('input[type=range]').boundingBox();
  await page.mouse.move(face.x + face.width / 2, face.y + face.height / 2);
  await page.mouse.down();
  await page.mouse.move(face.x + face.width / 2, face.y + face.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => prismPtc().feedback)).toBeGreaterThan(before);
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.waitForTimeout(300);
  const narrow = await measure();
  expect(narrow.width).toBe(wide.width);
  expect(narrow.inDock).toBe(true);
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

/// Both views (`docs/DESIGN-CRITIQUE.md`, "Both views, as an option"): All
/// shows every bank and the dock grows to them; Standard and Extended page.
const ENGINES = ['granular', 'wsola', 'vocoder', 'pvsola', 'hybrid'];

async function view(page, which) {
  await page.locator(`#gkView .seg-btn[data-view="${which}"]`).click();
  await page.waitForTimeout(300);
}

/// What the tray shows: whether it scrolls, and which sides' banks are visible.
const TRAY = () => {
  const g = document.getElementById('grainControls');
  const banks = [...g.querySelectorAll(':is(.stretch-core, .engine-params:not(:empty), .wild)')]
    .filter((b) => b.getBoundingClientRect().width > 0);
  return {
    scroll: g.scrollHeight, client: g.clientHeight,
    std: banks.filter((b) => !b.closest('#extPanel')).length,
    ext: banks.filter((b) => b.closest('#extPanel')).length,
    picker: document.getElementById('stretchEngine').getBoundingClientRect().width > 0,
  };
};

test('G1 · the view switch: All, Standard, Extended, All by default', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('gkView'); } catch {} });
  await openFile(page);
  await dockTab(page, 'stretch');
  const btns = await page.$$eval('#gkView .seg-btn', (bs) => bs.map((b) => [b.dataset.view, b.textContent.trim(), b.classList.contains('active')]));
  expect(btns).toEqual([['all', 'All', true], ['std', 'Standard', false], ['ext', 'Extended', false]]);
});

for (const alg of ENGINES) {
  test(`G1 · All: the whole ${alg} tray is on screen without a scroll`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('gkView'); localStorage.removeItem('dockHeight'); } catch {} });
    await openFile(page);
    await engine(page, alg);
    const t = await page.evaluate(TRAY);
    expect(t.scroll, `${t.scroll - t.client} px under the fold`).toBeLessThanOrEqual(t.client + 1);
    expect(t.ext, 'All shows the extended side').toBeGreaterThan(0);
  });
}

test('G1 · Standard and Extended each show only their side, and fit', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('gkView'); localStorage.removeItem('dockHeight'); } catch {} });
  await openFile(page);
  for (const alg of ENGINES) {
    await engine(page, alg);
    await view(page, 'std');
    let t = await page.evaluate(TRAY);
    expect([t.std > 0, t.ext, t.picker], `${alg} Standard`).toEqual([true, 0, true]);
    expect(t.scroll, `${alg} Standard scrolls`).toBeLessThanOrEqual(t.client + 1);
    await view(page, 'ext');
    t = await page.evaluate(TRAY);
    expect([t.std, t.ext > 0, t.picker], `${alg} Extended`).toEqual([0, true, true]);
    expect(t.scroll, `${alg} Extended scrolls`).toBeLessThanOrEqual(t.client + 1);
    await view(page, 'all');
  }
});

test('G1 · a page hides banks, never controls, and the choice is remembered', async ({ page }) => {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.removeItem('gkView'); sessionStorage.setItem('seeded', '1'); } } catch {} });
  await openFile(page);
  await engine(page, 'hybrid');
  const count = () => page.evaluate(() => document.querySelectorAll('#grainControls input, #grainControls select, #grainControls button').length);
  const all = await count();
  await view(page, 'ext');
  expect(await count()).toBe(all);
  await page.reload();
  await openFile(page);
  await dockTab(page, 'stretch');
  expect(await page.$eval('#gkView .seg-btn.active', (b) => b.dataset.view)).toBe('ext');
});

test('G1 · the tray reads standard first, Time and pitch leading', async ({ page }) => {
  await openFile(page);
  for (const alg of ['granular', 'wsola', 'vocoder', 'pvsola', 'hybrid']) {
    await engine(page, alg);
    const order = await page.evaluate(() => {
      const banks = [...document.querySelectorAll('#grainControls :is(.stretch-core, .engine-params:not(:empty), .wild)')]
        .filter((b) => b.getBoundingClientRect().width)
        .map((b) => ({ ext: !!b.closest('#extPanel'), core: b.matches('.stretch-core'),
          top: Math.round(b.getBoundingClientRect().top), left: Math.round(b.getBoundingClientRect().left) }))
        .sort((a, b) => a.top - b.top || a.left - b.left);
      return { first: banks[0], lastStd: banks.map((b) => b.ext).lastIndexOf(false), firstExt: banks.findIndex((b) => b.ext) };
    });
    expect(order.first.core, `${alg}: Time and pitch is not first`).toBe(true);
    expect(order.lastStd, `${alg}: a standard bank comes after an extended one`).toBeLessThan(order.firstExt);
  }
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
