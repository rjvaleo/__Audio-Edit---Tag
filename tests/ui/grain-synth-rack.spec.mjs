// The Grain v12 page's effects: the rack in the tab row and the effects page.
//
// The promise of Phase 2: nothing here is a second chain. So every persistence
// test reads the chain back from the server, `/api/rack`, and the "every control
// is there" test takes its list from the engine, not from the page.

import { test, expect } from './test.mjs';

test.use({ viewport: { width: 1440, height: 900 } });

async function openPage(page, { flag = true } = {}) {
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async (on) => {
    if (on) setGrainUi('synth');
    const f = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(f.find((x) => /tone/.test(x.path)) || f[0]);
    setMode('edit');
  }, flag);
  await page.waitForFunction(() => state.rack && Object.keys(state.shapers).length > 0, null, { timeout: 20_000 });
  if (flag) await page.waitForFunction(() => document.querySelector('#gsFxStrip .gs-lab2') && state.overview, null, { timeout: 20_000 });
  await page.waitForTimeout(200);
}

/// The chain, as the real rack would be left by adding these one by one.
async function setChain(page, kinds) {
  await page.evaluate(async (kinds) => {
    state.rack.slots = kinds.map((k) => defaultFxSlot(k));
    const f = state.selectedFile;
    adoptRack(await postJSON('/api/rack', { p: f.path, sr: state.view.sampleRate || 48000, slots: state.rack.slots, master: state.rack.master, pads: {}, postRoll: {}, ranges: {} }));
    renderRack();
  }, kinds);
  await expect(page.locator('#gsFxStrip .gs-tile[data-ci]')).toHaveCount(kinds.length);
}

/// What the server has, not what the page thinks it has.
const stored = (page) => page.evaluate(async () => {
  const f = state.selectedFile;
  return (await api(`/api/rack?p=${encodeURIComponent(f.path)}&sr=${state.view.sampleRate || 48000}`)).slots;
});

const tiles = (page) => page.$$eval('#gsFxStrip .gs-tile[data-ci]', (ts) => ts.map((t) => t.dataset.kind));

test('the tiles are the chain, in order, each with its icon, light and name', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['eq', 'comp', 'dattorro_plate', 'prism:echo']);
  expect(await tiles(page)).toEqual(['eq', 'comp', 'dattorro_plate', 'prism:echo']);
  const look = await page.evaluate(() => ({
    names: [...document.querySelectorAll('#gsFxStrip .gs-tile[data-ci] b')].map((b) => b.textContent),
    icons: [...document.querySelectorAll('#gsFxStrip .gs-tile[data-ci] svg.gs-fxi path')].map((p) => p.getAttribute('d')),
    lights: document.querySelectorAll('#gsFxStrip .gs-tile[data-ci] .gs-led').length,
    tips: [...document.querySelectorAll('#gsFxStrip .gs-tile[data-ci]')].map((t) => t.title),
    arrows: document.querySelectorAll('#gsFxStrip .gs-ar').length,
    plus: !!document.querySelector('#gsFxPlus'),
    out: !!document.querySelector('#gsHead .gs-outl'),
    playing: document.querySelector('#gsHead').classList.contains('live'),
  }));
  expect(look.names).toEqual(['EQ', 'Comp', 'Plate', 'Echo']);
  expect(new Set(look.icons).size).toBe(4);
  expect(look.lights).toBe(4);
  expect(look.tips[2]).toContain('Dattorro plate');
  expect(look.arrows).toBe(3);
  expect(look.plus && look.out).toBe(true);
  // Nothing is sounding, so the line must not be moving.
  expect(look.playing).toBe(false);
  await expect(page.locator('#gsFxTrace')).toBeVisible();
});

test('a light bypasses in place and persists through /api/rack; the page does not change', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['eq', 'comp']);
  await page.click('#gsFxStrip .gs-tile[data-ci="1"] .gs-led');
  await page.waitForFunction(() => document.querySelector('#gsFxStrip .gs-tile[data-ci="1"]').classList.contains('off'));
  expect(await page.isVisible('#gsFxView')).toBe(false);
  await expect.poll(async () => (await stored(page))[1].bypassed).toBe(true);
  await page.click('#gsFxStrip .gs-tile[data-ci="1"] .gs-led');
  await expect.poll(async () => (await stored(page))[1].bypassed).toBe(false);
});

test('＋ opens the real add menu, and what it adds persists at the end of the chain', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['eq']);
  await page.click('#gsFxPlus');
  await expect(page.locator('#gsFxView')).toBeVisible();
  await expect(page.locator('#fxPicker')).toBeVisible();
  await page.click('#fxPicker .fx-picker-cat[data-group="Reverb & Delay"]');
  await page.click('#fxPicker .fx-picker-item[data-kind="dattorro_plate"]');
  await expect(page.locator('#gsFxStrip .gs-tile[data-ci]')).toHaveCount(2);
  await expect.poll(async () => (await stored(page)).map((s) => s.kind)).toEqual(['eq', 'dattorro_plate']);
  expect(await tiles(page)).toEqual(['eq', 'dattorro_plate']);
});

test('dragging a module by its title reorders the chain, and the server keeps the order', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['eq', 'comp', 'prism:echo']);
  await page.click('#gsFxLab');
  const a = await page.locator('#fxModuleRail > .fx-module[data-slot="0"] .fx-module-head').boundingBox();
  const b = await page.locator('#fxModuleRail > .fx-module[data-slot="2"] .fx-module-head').boundingBox();
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 80, a.y + 8, { steps: 4 });
  await page.mouse.move(b.x + 30, b.y + 8, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).map((s) => s.kind)).toEqual(['comp', 'prism:echo', 'eq']);
  expect(await tiles(page)).toEqual(['comp', 'prism:echo', 'eq']);
});

test('the FX label opens the page and takes you back; an engine tab goes back too', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['eq']);
  await expect(page.locator('#gsFxView')).toBeHidden();
  await page.click('#gsFxLab');
  await expect(page.locator('#gsFxView')).toBeVisible();
  await expect(page.locator('#gsEngPanel')).toBeHidden();
  await page.click('#gsFxLab');
  await expect(page.locator('#gsFxView')).toBeHidden();
  await expect(page.locator('#gsEngPanel')).toBeVisible();
  await page.click('#gsFxLab');
  await page.click('#gsEngTabs .gs-tab[data-e="vocoder"]');
  await expect(page.locator('#gsFxView')).toBeHidden();
  await page.waitForFunction(() => state.stretchDraft.algorithm === 'vocoder');
});

test('a tile opens the page on that effect, scrolled into view and marked', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['eq', 'comp', 'dattorro_plate', 'prism:echo', 'prism:lxp-hall', 'dattorro_flanger', 'prism:hp-chorus', 'prism:sh-bubbler']);
  await page.click('#gsFxStrip .gs-tile[data-ci="7"]');
  await expect(page.locator('#gsFxView')).toBeVisible();
  await expect(page.locator('#fxModuleRail > .fx-module[data-slot="7"]')).toHaveClass(/gs-front/);
  await expect(page.locator('#gsFxStrip .gs-tile[data-ci="7"]')).toHaveClass(/sel/);
  // Smooth, so give it time to arrive; then it is inside the row's window.
  await expect.poll(() => page.evaluate(() => {
    const vp = document.querySelector('#gsFxRow .fx-module-viewport').getBoundingClientRect();
    const m = document.querySelector('#fxModuleRail > .fx-module[data-slot="7"]').getBoundingClientRect();
    return m.left >= vp.left - 1 && m.right <= vp.right + 1;
  }), { timeout: 4000 }).toBe(true);
  const other = await page.locator('#fxModuleRail > .fx-module[data-slot="1"]').getAttribute('class');
  expect(other).not.toContain('gs-front');
});

/// Every control the engine lists is on screen, inside its module, not behind
/// a tab or a scroll. Labels come from the shaper's own spec.
const auditModule = (page, kind) => page.evaluate((kind) => {
  const m = document.querySelector(`#fxModuleRail > .fx-module[data-kind="${kind}"]`);
  const box = m.getBoundingClientRect(), body = m.querySelector('.fx-module-controls');
  const inside = (e) => { if (!e.getClientRects().length) return false; const r = e.getBoundingClientRect(); return r.left >= box.left - .5 && r.right <= box.right + .5 && r.top >= box.top - .5 && r.bottom <= box.bottom + .5; };
  const got = new Set();
  // Soft Row is the Lexicon's second view of controls that are on their pages too.
  const skip = (e) => e.closest('.lex-page') && e.closest('.lex-page') === m.querySelector('.lex-page');
  m.querySelectorAll('[aria-label]').forEach((e) => { if (inside(e) && !skip(e)) got.add(e.getAttribute('aria-label')); });
  m.querySelectorAll('.seg-param > .k, .param:not(.sh-cell):not(.lex-knob) > .k').forEach((e) => { if (inside(e) && !skip(e)) got.add(e.textContent); });
  m.querySelectorAll('.lex-knob .k, .sh-cell .k').forEach((e) => { if (inside(e)) got.add(e.textContent); });
  const spec = state.shapers[kind]?.params?.map((p) => p.label) || [];
  return { spec, got: [...got], over: body.scrollHeight - body.clientHeight, w: m.offsetWidth, h: m.offsetHeight };
}, kind);

test('every parameter is visible: Plate, Echo, Compressor, LXP Hall 25 of 25, the EQ', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['dattorro_plate', 'prism:echo', 'comp', 'prism:lxp-hall', 'eq']);
  await page.click('#gsFxLab');
  await page.waitForTimeout(200);
  for (const kind of ['dattorro_plate', 'prism:echo', 'prism:lxp-hall']) {
    const a = await auditModule(page, kind);
    expect(a.h, `${kind} height`).toBe(400);
    expect(a.over, `${kind} scrolls`).toBeLessThanOrEqual(0);
    const want = new Set(a.spec);
    const missing = [...want].filter((l) => !a.got.includes(l));
    expect(missing, `${kind} controls missing`).toEqual([]);
    expect(want.size, `${kind} spec`).toBe({ dattorro_plate: 13, 'prism:echo': 6, 'prism:lxp-hall': 25 }[kind]);
  }
  // The Compressor's face: its five knobs, and Threshold as the caret on the meter.
  const comp = await page.evaluate(() => {
    const m = document.querySelector('#fxModuleRail > .fx-module[data-kind="comp"]');
    return { knobs: [...m.querySelectorAll('.fxk .ui-ring')].map((e) => e.getAttribute('aria-label')), thr: !!m.querySelector('.fx-caret, .fxd-caret') || /THR/.test(m.textContent), h: m.offsetHeight };
  });
  expect(comp.knobs).toEqual(['Ratio', 'Attack', 'Release', 'Knee', 'Makeup']);
  expect(comp.thr).toBe(true);
  expect(comp.h).toBe(400);
  // The EQ: eight bands, the type buttons, On, and three knobs for the chosen band.
  const eq = await page.evaluate(() => {
    const m = document.querySelector('#fxModuleRail > .fx-module[data-kind="eq"]');
    return { knobs: m.querySelectorAll('.fxk .ui-ring').length, types: m.querySelectorAll('.seg-btn, .fx-eq-type, button').length, h: m.offsetHeight, text: m.textContent };
  });
  expect(eq.knobs).toBe(3);
  expect(eq.h).toBe(400);
  expect(eq.text).toMatch(/Bell/);
  expect(eq.text).toMatch(/Frequency/);
});

test('a knob on the page moves the running effect and the saved chain, through the rack’s own routes', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['dattorro_plate']);
  await page.click('#gsFxLab');
  await page.waitForTimeout(150);
  const ring = page.locator('#fxModuleRail .fxk .ui-ring[aria-label="Decay"]');
  const box = await ring.boundingBox();
  const before = await page.evaluate(() => state.rack.slots[0].params.decay);
  const live = page.waitForRequest((r) => r.url().includes('/api/rack/param') && r.method() === 'POST');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 4 });
  await live;
  await page.mouse.up();
  const after = await page.evaluate(() => state.rack.slots[0].params.decay);
  expect(after).toBeGreaterThan(before);
  await expect.poll(async () => (await stored(page))[0].params.decay).toBeCloseTo(after, 3);
});

test('the row never overflows at 1440 wide with up to 8 effects: arrows go first, then names from the last tile', async ({ page }) => {
  await openPage(page);
  const lots = ['eq', 'comp', 'dattorro_plate', 'prism:echo', 'prism:lxp-hall', 'dattorro_flanger', 'phaser', 'prism:sh-bubbler'];
  for (let n = 1; n <= 8; n++) {
    await setChain(page, lots.slice(0, n));
    await page.waitForTimeout(40);
    const s = await page.evaluate(() => {
      const head = document.querySelector('#gsHead'), strip = document.querySelector('#gsFxStrip');
      const out = document.querySelector('#gsHead .gs-outl').getBoundingClientRect(), box = head.getBoundingClientRect();
      const tiles = [...strip.querySelectorAll('.gs-tile[data-ci]')];
      return { over: head.scrollWidth - head.clientWidth, outInside: out.right <= box.right, denser: strip.classList.contains('denser'),
        nameless: tiles.map((t) => t.classList.contains('nm0')), tips: tiles.every((t) => t.title.length > 0) };
    });
    expect(s.over, `${n} effects`).toBeLessThanOrEqual(0);
    expect(s.outInside, `${n} effects: OUT stays on the row`).toBe(true);
    expect(s.tips).toBe(true);
    // Names go from the last tile back, never from the middle.
    const firstGone = s.nameless.indexOf(true);
    if (firstGone >= 0) { expect(s.denser).toBe(true); expect(s.nameless.slice(firstGone).every(Boolean)).toBe(true); }
  }
});

// Phase 5 (11 Nov 2026): an effect's own knobs are the shared knob, which
// carries its picture beside it, so the corner picture is only on the suites'
// knobs (the Lexicon's here) that keep their own faces.
test('reverb knobs carry a 12 × 10 picture in their corner; no module changes size by a pixel', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['eq', 'comp', 'dattorro_plate', 'prism:echo', 'prism:lxp-hall']);
  await page.click('#gsFxLab');
  await page.waitForTimeout(250);
  const measure = () => page.$$eval('#fxModuleRail > .fx-module', (ms) => ms.map((m) => [m.getBoundingClientRect().width, m.getBoundingClientRect().height, m.offsetWidth, m.offsetHeight]));
  const withIcons = await measure();
  const info = await page.evaluate(() => {
    const ms = [...document.querySelectorAll('#fxModuleRail > .fx-module')];
    const of = (k) => ms.filter((m) => m.dataset.kind === k)[0];
    const size = (e) => { const r = e.getBoundingClientRect(), s = GS.scale; return [r.width / s, r.height / s].map((x) => Math.round(x)); };
    const first = [...of('prism:lxp-hall').querySelectorAll('.fki')].find((e) => e.getClientRects().length);
    const cell = first.closest('.lex-knob');
    const pictured = (k) => [...of(k).querySelectorAll('.fxk')].filter((c) => c.querySelector('.ui-pic.side')).length;
    return {
      eq: of('eq').querySelectorAll('.fki').length, comp: of('comp').querySelectorAll('.fki').length,
      plate: of('dattorro_plate').querySelectorAll('.fki').length, echo: of('prism:echo').querySelectorAll('.fki').length,
      platePics: pictured('dattorro_plate'), echoPics: pictured('prism:echo'),
      hall: of('prism:lxp-hall').querySelectorAll('.fki').length,
      size: size(first), ringFirst: cell.querySelector('svg').classList.contains('lex-ring'), after: first.previousElementSibling === cell.querySelector('.lex-ring'),
    };
  });
  expect(info.eq).toBe(0);
  expect(info.comp).toBe(0);
  expect(info.plate).toBe(0);
  expect(info.echo).toBe(0);
  expect(info.platePics).toBeGreaterThanOrEqual(13);
  expect(info.echoPics).toBeGreaterThanOrEqual(6);
  expect(info.hall).toBeGreaterThanOrEqual(20);
  expect(info.size).toEqual([12, 10]);
  expect(info.ringFirst).toBe(true);
  expect(info.after).toBe(true);
  await page.evaluate(() => document.querySelectorAll('#fxModuleRail .fki').forEach((e) => e.remove()));
  const without = await measure();
  expect(withIcons).toEqual(without);
});

test('the dock names the effect in front, and Bubbler’s tuning writes its keys and leaves Grain’s alone', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['eq', 'prism:sh-bubbler']);
  const dock = () => page.locator('#gsKbScale');
  await expect(dock()).toContainText('Grain');
  await page.click('#gsFxStrip .gs-tile[data-ci="1"]');
  await expect(dock()).toContainText('Bubbler');
  const scaleBefore = await page.evaluate(() => currentScale());
  await page.click('#gsKbScale');
  await page.waitForSelector('#gsMenu .gs-tt[data-scale]');
  // A scale whose degrees, rounded to semitones, are easy to state: Ionian (Major).
  await page.fill('#gsTFilter', 'Ionian');
  await page.click('#gsMenu .gs-tt[data-scale="Ionian (Major)"]');
  await expect(dock()).toContainText('Bubbler');
  await expect(dock()).toContainText('Ionian (Major)');
  const want = { key0: 1, key1: 0, key2: 1, key3: 0, key4: 1, key5: 1, key6: 0, key7: 1, key8: 0, key9: 1, key10: 0, key11: 1 };
  await expect.poll(async () => (await stored(page))[1].params).toMatchObject(want);
  expect(await page.evaluate(() => currentScale())).toBe(scaleBefore);
  // Another panel in front: the dock is Grain's again, and Grain's is unchanged.
  await page.click('#gsFxStrip .gs-tile[data-ci="0"]');
  await expect(dock()).toContainText('Grain');
  await page.click('#gsFxStrip .gs-tile[data-ci="1"]');
  await expect(dock()).toContainText('Ionian (Major)');
  // Back to the engine: Grain's again.
  await page.click('#gsFxBack');
  await expect(dock()).toContainText('Grain');
  await expect(page.locator('#gsTuneBtn')).not.toContainText('Ionian');
});

test('the real rack goes home when the page is left, and is unchanged there', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['dattorro_plate']);
  await page.click('#gsFxLab');
  expect(await page.evaluate(() => document.querySelector('#dockEffects').parentNode.id)).toBe('gsFxRow');
  expect(await page.locator('#fxModuleRail .fx-module .fxk .ui-ring').count()).toBeGreaterThanOrEqual(13);
  await page.evaluate(() => setMode('overview'));
  const home = await page.evaluate(() => ({ parent: document.querySelector('#dockEffects').parentNode.classList.contains('dock-panes'), flat: document.querySelectorAll('#fxModuleRail .gs-flat').length, front: document.querySelectorAll('#fxModuleRail .gs-front').length, icons: document.querySelectorAll('#fxModuleRail .fki').length, card: !!document.querySelector('#gsFxAddCard') }));
  expect(home).toEqual({ parent: true, flat: 0, front: 0, icons: 0, card: false });
});

test('with the flag off, the old rack is where it was and is not dressed', async ({ page }) => {
  await openPage(page, { flag: false });
  expect(await page.evaluate(() => document.querySelector('#dockEffects').parentNode.classList.contains('dock-panes'))).toBe(true);
  expect(await page.evaluate(() => !!document.querySelector('#gsFxStrip .gs-tile'))).toBe(false);
  await page.evaluate(async () => {
    state.rack.slots = [defaultFxSlot('prism:hp-chorus'), defaultFxSlot('dattorro_plate')];
    renderRack();
  });
  const face = await page.evaluate(() => ({ sliders: document.querySelectorAll('#fxModuleRail .fx-module[data-kind="prism:hp-chorus"] input[type="range"]').length, fxs: document.querySelectorAll('#fxModuleRail .fx-module[data-kind="dattorro_plate"] .fxs').length, flat: document.querySelectorAll('#fxModuleRail .gs-flat').length }));
  expect(face.sliders).toBeGreaterThanOrEqual(7);
  expect(face.fxs).toBeGreaterThan(0);
  expect(face.flat).toBe(0);
});

test('the page draws no error, opening and leaving the effects', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openPage(page);
  await setChain(page, ['eq', 'dattorro_plate']);
  await page.click('#gsFxLab');
  await page.waitForTimeout(300);
  await page.click('#gsFxLab');
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
});
