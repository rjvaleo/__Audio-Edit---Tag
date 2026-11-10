// The design pass of 27 Oct 2026, continued: the granular engine's tray and the
// Grain view, Classic and Modern. See `design-pass.spec.mjs` and `docs/DESIGN-CRITIQUE.md`.

import { test, expect } from './test.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFile, dockTab, roomTab } from './design-pass.helpers.mjs';

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

// ── the Grain view, Classic and Modern ──────────────────────────────────────
// A switch in the Grain view's tab strip. Classic is the view as it was and
// stays the default; Modern is the design-council pass over the Grain view
// only — nothing outside it changes either way.

async function grainUi(page, which) {
  // The switch is the Grain page's; Prism is a page of its own.
  if (await page.evaluate(() => document.body.classList.contains('prismpage'))) {
    await page.locator('#leftRail .rl-item[data-page="grain"]').click();
  }
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
  // Prism is a page of its own, with the dock's presets hidden as on Chop.
  const all = { stretch: true, effects: true, prism: false, visuals: true, automation: true, regions: true };
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
    // The Prism pad is HyperStretch's blue window in either look (merged with
    // the rack pad, 5 Nov 2026: "the look of the HyperStretch").
    const prism = await page.evaluate(() => getComputedStyle(document.getElementById('hsPad')).backgroundColor);
    return { ...perf, pad: prism };
  };
  const classic = await look();
  expect(classic.caps).toBe(true);
  await grainUi(page, 'modern');
  const modern = await look();
  expect(modern.caps).toBe(false);
  expect(modern.font).not.toMatch(/Share Tech Mono/);
  expect(modern.spacing).toBe('normal');
  expect(modern.pad).toBe(classic.pad);
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
