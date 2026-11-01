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

// G1–G5 are the knob-bank tray of the 27 Oct pass. The tray is the columns of
// slider rows it was before that pass (1 Nov 2026), so they are skipped, not
// deleted: they come back if the banks ever do.
test.skip('G1 · the view switch: All, Standard, Extended, All by default', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('gkView'); } catch {} });
  await openFile(page);
  await dockTab(page, 'stretch');
  const btns = await page.$$eval('#gkView .seg-btn', (bs) => bs.map((b) => [b.dataset.view, b.textContent.trim(), b.classList.contains('active')]));
  expect(btns).toEqual([['all', 'All', true], ['std', 'Standard', false], ['ext', 'Extended', false]]);
});

for (const alg of ENGINES) {
  test.skip(`G1 · All: the whole ${alg} tray is on screen without a scroll`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('gkView'); localStorage.removeItem('dockHeight'); } catch {} });
    await openFile(page);
    await engine(page, alg);
    const t = await page.evaluate(TRAY);
    expect(t.scroll, `${t.scroll - t.client} px under the fold`).toBeLessThanOrEqual(t.client + 1);
    expect(t.ext, 'All shows the extended side').toBeGreaterThan(0);
  });
}

test.skip('G1 · Standard and Extended each show only their side, and fit', async ({ page }) => {
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

test.skip('G1 · a page hides banks, never controls, and the choice is remembered', async ({ page }) => {
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

test.skip('G1 · the tray reads standard first, Time and pitch leading', async ({ page }) => {
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

test.skip('G2 · every control in the tray that is an amount is a knob a pointer reaches', async ({ page }) => {
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

test.skip('G3 · no switch in the tray has had its vowels taken out', async ({ page }) => {
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

test.skip('G4 · the cloud pad leads the tray and is drawn large', async ({ page }) => {
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

test.skip('G5 · the extended side\'s knobs are drawn in its own colour', async ({ page }) => {
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

test('4D-2 · Eye and Rate are knobs: the input kept, a face behind it, the input over the face', async ({ page }) => {
  await dim4(page);
  const knobs = await page.evaluate(() => ['Eye', 'Rate'].map((name) => {
    const input = document.querySelector(`#p4Panel input[type=range][data-p4k="${name}"]`);
    if (!input) return { name, why: 'no range input' };
    const wrap = input.closest('.rk-k');
    const face = wrap?.querySelector('.rk-face');
    if (!face) return { name, why: 'no knob face' };
    const f = face.getBoundingClientRect();
    return {
      name,
      label: wrap.querySelector('.rk-l')?.textContent,
      read: wrap.querySelector('.rk-v')?.value,
      drawn: !!face.querySelector('svg .rk-track'),
      reached: document.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2) === input,
    };
  }));
  expect(knobs).toEqual([
    { name: 'Eye', label: 'Eye', read: '2.50', drawn: true, reached: true },
    { name: 'Rate', label: 'Rate', read: '0.350', drawn: true, reached: true },
  ]);
  // Turned as a knob turns: up is more.
  const face = await page.locator('#p4Panel input[data-p4k="Eye"]').boundingBox();
  const cx = face.x + face.width / 2, cy = face.y + face.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 30, { steps: 5 });
  await page.mouse.up();
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

// ── the Grain view, Classic and Modern ──────────────────────────────────────
// A switch in the Grain view's tab strip. Classic is the view as it was and
// stays the default; Modern is the design-council pass over the Grain view
// only — nothing outside it changes either way.

async function grainUi(page, which) {
  await page.locator(`#grainUiSwitch [data-ui="${which}"]`).click();
  await page.waitForTimeout(200);
}

test('GM0 · the Grain view has a Classic/Modern switch, Classic by default, remembered', async ({ page }) => {
  await openFile(page);
  const sw = page.locator('#grainUiSwitch');
  await expect(sw).toBeVisible();
  await expect(sw.locator('[data-ui="classic"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.body.dataset.grainUi)).toBe('classic');
  await grainUi(page, 'modern');
  await expect(sw.locator('[data-ui="modern"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.body.dataset.grainUi)).toBe('modern');
  await openFile(page);
  expect(await page.evaluate(() => document.body.dataset.grainUi), 'not remembered').toBe('modern');
  // Only the Grain view: the Visual view's Sound tab borrows the grain tray,
  // and keeps its own look there.
  await roomTab(page, 'sound');
  const inRoom = await page.evaluate(() => ({
    switchShown: !!document.getElementById('grainUiSwitch').getBoundingClientRect().width,
    marks: [...document.querySelectorAll('#grainControls .rk-mark')].filter((m) => { const r = m.getBoundingClientRect(); return r.width || r.height; }).length,
  }));
  expect(inRoom).toEqual({ switchShown: false, marks: 0 });
});

// GM1 reads the marks on the tray's knobs, and the tray is slider rows again
// (see G1–G5 above).
test.skip('GM1 · Modern marks a knob\'s named point, and Envelope says its amount', async ({ page }) => {
  await openFile(page);
  const read = () => page.evaluate(() => {
    const row = state.grainRows.envelope;
    return {
      marks: ['envelope', 'layerSpread', 'panSpread', 'layerScatter']
        .filter((k) => { const m = state.grainRows[k]?.querySelector('.rk-mark'); const r = m?.getBoundingClientRect(); return r && (r.width || r.height); }).length,
      env: row.querySelector('.v').textContent.trim(),
    };
  });
  await page.evaluate(() => { const r = state.grainRows.envelope; r.sync(0.3); });
  const classic = await read();
  expect(classic.marks).toBe(0);
  expect(classic.env).toBe('percussive');
  await grainUi(page, 'modern');
  const modern = await read();
  expect(modern.marks).toBe(4);
  expect(modern.env).toMatch(/0\.30.*percussive/);
});

test('GM2 · Modern shows the preset controls only on the tabs a preset changes', async ({ page }) => {
  await openFile(page);
  const shownOn = async () => {
    const out = {};
    for (const tab of ['stretch', 'effects', 'prism', 'visuals', 'automation', 'regions']) {
      await dockTab(page, tab);
      out[tab] = await page.locator('#presetPick').isVisible();
    }
    return out;
  };
  const all = { stretch: true, effects: true, prism: true, visuals: true, automation: true, regions: true };
  expect(await shownOn()).toEqual(all);
  await grainUi(page, 'modern');
  expect(await shownOn()).toEqual({ ...all, prism: false, visuals: false, automation: false, regions: false });
  await dockTab(page, 'stretch');
  expect(await page.locator('label.preset-with-sound').innerText()).toMatch(/sound & chain/i);
});

test('GM3 · in Modern, Delete, DEL and Revert ask once before they act', async ({ page }) => {
  await openFile(page);
  // A listener after the button's own: it hears exactly the clicks that the
  // button's handler hears.
  const clicks = (id) => page.evaluate((i) => {
    const b = document.getElementById(i);
    window.__heard = window.__heard || {};
    window.__ear = window.__ear || {};
    window.__heard[i] = 0;
    if (window.__ear[i]) b.removeEventListener('click', window.__ear[i]);
    window.__ear[i] = () => { window.__heard[i]++; };
    b.addEventListener('click', window.__ear[i]);
    b.click();
    const once = { heard: window.__heard[i], armed: b.classList.contains('gm-armed'), text: b.textContent.trim() };
    b.click();
    return { once, twice: window.__heard[i] };
  }, id);
  await page.evaluate(() => { document.getElementById('revertBtn').disabled = false; document.getElementById('presetDelete').disabled = false; });
  expect((await clicks('revertBtn')).once.heard, 'classic changed').toBe(1);
  await grainUi(page, 'modern');
  await dockTab(page, 'automation');
  for (const id of ['presetDelete', 'perfLaneDel', 'revertBtn']) {
    await page.evaluate((i) => { document.getElementById(i).disabled = false; }, id);
    if (id === 'presetDelete') await dockTab(page, 'stretch');
    const r = await clicks(id);
    expect(r.once.heard, `${id} acted on the first click`).toBe(0);
    expect(r.once.armed, id).toBe(true);
    expect(r.once.text, id).toMatch(/\?$/);
    expect(r.twice, `${id} did not act on the second click`).toBe(1);
  }
});

test('GM4 · in Modern, Automation and Prism speak the dock\'s language', async ({ page }) => {
  await openFile(page);
  const look = async () => {
    await dockTab(page, 'automation');
    const perf = await page.evaluate(() => {
      const el = document.getElementById('automationSimplify');
      const b = getComputedStyle(el);
      const h = getComputedStyle(document.querySelector('.perf-header'));
      // What is drawn, after text-transform: the source says SIMPLIFY.
      return { caps: el.innerText === el.innerText.toUpperCase(), font: b.fontFamily, spacing: h.letterSpacing };
    });
    await dockTab(page, 'prism');
    const prism = await page.evaluate(() => getComputedStyle(document.querySelector('.prism-square')).backgroundImage);
    return { ...perf, radial: /radial/.test(prism) };
  };
  const classic = await look();
  expect(classic.caps).toBe(true);
  expect(classic.radial).toBe(true);
  await grainUi(page, 'modern');
  const modern = await look();
  expect(modern.caps).toBe(false);
  expect(modern.font).not.toMatch(/Share Tech Mono/);
  expect(modern.spacing).toBe('normal');
  expect(modern.radial).toBe(false);
});

test('GM5 · in Modern every control in the Grain view\'s bars is at least 24 px, and says what it is', async ({ page }) => {
  await openFile(page);
  await grainUi(page, 'modern');
  const small = await page.evaluate(() => {
    const out = [];
    const bars = '#leftPanel .panel-head, #tabBar, #editTools, #transportBar, #presetBar';
    for (const el of document.querySelectorAll(`:is(${bars}) :is(button, select, input[type=checkbox])`)) {
      const hit = el.type === 'checkbox' ? (el.closest('label') || el) : el;
      const r = hit.getBoundingClientRect();
      if (!r.width) continue;
      if (r.width < 24 || r.height < 24) out.push(`${el.id || el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  expect(small).toEqual([]);
  // The words Modern adds are drawn by CSS, so the buttons' markup is
  // Classic's: what is read is the generated word and the button's own.
  const words = await page.evaluate(() => {
    const said = (el) => getComputedStyle(el, '::before').content.replace(/^"|"$/g, '').replace(/^none$/, '') + el.innerText;
    return {
      tuning: said(document.querySelector('#grainControls .scale-btn')),
      keys: said(document.querySelector('#grainControls .popout-btn')),
      room: said(document.getElementById('roomEditOpen')),
    };
  });
  expect(words.tuning).toMatch(/tuning/i);
  expect(words.keys).toMatch(/play keys/i);
  expect(words.room).toMatch(/edit room/i);
});

test('GM6 · in Modern, Time & Pitch gives its width to the controls, the engine leading', async ({ page }) => {
  await openFile(page);
  const measure = () => page.evaluate(() => ({
    controls: document.getElementById('grainControls').getBoundingClientRect().width,
    scope: document.getElementById('masterBus').getBoundingClientRect().width,
    engineWord: document.querySelector('#grainControls .engine-pick')?.getAttribute('data-gm-label') || '',
  }));
  const classic = await measure();
  await grainUi(page, 'modern');
  const modern = await measure();
  expect(modern.controls).toBeGreaterThan(classic.controls + 150);
  expect(modern.scope).toBeLessThanOrEqual(420);
  expect(modern.engineWord).toBe('Engine');
});
