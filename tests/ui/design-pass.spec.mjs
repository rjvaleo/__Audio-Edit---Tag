// The design pass of 27 Oct 2026, held in place. See `docs/DESIGN-CRITIQUE.md`.
//
// Each test is one item of that critique, named by its change ID, so a failure
// here says which decision has been undone. They measure the page as it is
// drawn — positions, computed styles, roles — rather than the source, except
// where the fault can only be seen in the source (a canvas font that one
// browser can draw and another cannot).

import { test, expect } from './test.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UI, SCALE, ready, openFile, dockTab, roomTab, sizesOnScreen } from './design-pass.helpers.mjs';

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
  for (const f of ['app.css', 'rail.css', 'wave.css']) {
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

/// The amounts of a panel in the Visual column, which are sliders again
/// (`RK_SLIDERS`): each shows its slider at a usable width, its reading, and is
/// the thing under the pointer where it is drawn. The knob face is not shown.
const slidersIn = (root) => `(() => {
  const out = [];
  for (const k of document.querySelectorAll(${JSON.stringify(root)} + ' .rk-k')) {
    const input = k.querySelector('input[type=range]');
    if (!input.getBoundingClientRect().width) continue;
    k.scrollIntoView({ block: 'center' });
    const r = input.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out.push({ id: input.id || k.querySelector('.rk-l').textContent,
      read: k.querySelector('.rk-v').textContent.trim(), reached: hit === input,
      wide: r.width >= 60, face: getComputedStyle(k.querySelector('.rk-face')).display !== 'none' });
  }
  return out;
})()`;

test('C2 · an amount in the Visual column is a slider that shows its reading', async ({ page }) => {
  await openFile(page);
  const sliders = [];
  await roomTab(page, 'controls');
  sliders.push(...await page.evaluate(slidersIn('#roomEdit')));
  await roomTab(page, 'geom');
  sliders.push(...await page.evaluate(slidersIn('#roomGeomBody')));
  expect(sliders.length).toBeGreaterThan(18);
  expect(sliders.filter((k) => !k.read || !k.reached || !k.wide || k.face)).toEqual([]);
});

test('C2 · a slider moves right when it is clicked to the right, and the setting follows', async ({ page }) => {
  await openFile(page);
  await roomTab(page, 'controls');
  const slider = page.locator('#reRing');
  await slider.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => roomEdit.ringScale);
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
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

test('C3 · the Prism pad is square, as large as the dock leaves, its banks hard against it', async ({ page }) => {
  // HyperStretch and the rack pad merged (5 Nov 2026): the rack pad's square
  // box, sized to the dock, with HyperStretch's banks beside it.
  const measure = () => page.evaluate(() => {
    const pad = document.getElementById('hsPad').getBoundingClientRect();
    const banks = document.querySelector('#dockHyper .hs-banks').getBoundingClientRect();
    const dock = document.getElementById('dockHyper').getBoundingClientRect();
    return { w: Math.round(pad.width), h: Math.round(pad.height), gap: Math.round(banks.left - pad.right),
      inDock: banks.right <= dock.right + 1 && pad.bottom <= dock.bottom + 1 };
  });
  await openFile(page);
  await dockTab(page, 'prism');
  await page.waitForTimeout(300);
  const wide = await measure();
  expect(Math.abs(wide.w - wide.h)).toBeLessThanOrEqual(1);
  expect(wide.w).toBeGreaterThanOrEqual(140);
  expect(wide.gap).toBeGreaterThanOrEqual(0);
  expect(wide.gap).toBeLessThanOrEqual(24);
  expect(wide.inDock).toBe(true);
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.waitForTimeout(400);
  const narrow = await measure();
  expect(Math.abs(narrow.w - narrow.h)).toBeLessThanOrEqual(1);
  expect(narrow.inDock).toBe(true);
});

test('C3 · a process\'s settings are bars with their pictures beside the pad, all of them', async ({ page }) => {
  // The v7 Prism page (RJ, 6 Nov 2026): every setting a half-width bar with
  // the picture of what it does, the pad's two first; knobs before that.
  const measure = () => page.evaluate(() => {
    const bars = [...document.querySelectorAll('#prismSettings .param')].map((row) => {
      const pic = row.querySelector(':scope > svg.gg')?.getBoundingClientRect();
      const input = row.querySelector(':scope > input[type=range]').getBoundingClientRect();
      return {
        label: row.querySelector('.k')?.textContent.trim(),
        bar: row.classList.contains('prism-bar'),
        pic: pic ? Math.round(pic.width) : 0,
        beside: !!pic && pic.right <= input.left + 1 && Math.abs((input.top + input.bottom) / 2 - (pic.top + pic.bottom) / 2) <= 3,
      };
    });
    return { bars, text: document.getElementById('prismSettings').textContent };
  });
  await openFile(page);
  await dockTab(page, 'prism');
  await page.waitForFunction(() => (window.prismPad?.sources || []).length > 0);
  // Time & Pitch: its four, the pad's two first, and its glide.
  const tp = await measure();
  expect(tp.bars.map((k) => k.label)).toEqual(['Stretch', 'Pitch', 'Window', 'Cloud over engine']);
  await expect(page.locator('#hsGlide')).toBeVisible();
  expect(tp.text).not.toMatch(/tab/i);
  // The Pitch Time Changer has six: bars, each picture beside its bar.
  await page.locator('#prismSource').selectOption({ label: 'Pitch Time Changer' });
  await page.waitForTimeout(300);
  const ptc = await measure();
  expect(ptc.bars).toHaveLength(6);
  for (const k of ptc.bars) {
    expect(k.bar).toBe(true);
    expect(k.pic).toBeGreaterThanOrEqual(20);
    expect(k.beside).toBe(true);
  }
  await expect(page.locator('#hsGlide')).toBeHidden();
  // A click far along a bar sets what its slider set: the Pitch Time Changer's value.
  const before = await page.evaluate(() => prismPtc().feedback);
  const row = page.locator('#prismSettings .param').filter({ hasText: 'Feedback' }).locator('input[type=range]');
  const b = await row.boundingBox();
  await page.mouse.click(b.x + b.width * 0.8, b.y + b.height / 2);
  expect(await page.evaluate(() => prismPtc().feedback)).toBeGreaterThan(before);
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
