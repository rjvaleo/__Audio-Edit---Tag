// The Grain v12 page's four LFOs and Map.
//
// What moves is read back from the server's `/api/engine/lfos`, and the runner
// answers that with no sound card, as here. Keys are stood in for, as in the
// keys spec: a test must not open a device. What the numbers do to the sound is
// `core/crates/server/src/grain_lfos.rs` and its tests.

import { test, expect } from './test.mjs';

test.use({ viewport: { width: 1440, height: 900 } });

async function openPage(page, { flag = true } = {}) {
  const sent = [];
  await page.route(/\/api\/engine\/(note|transport)$/, async (route) => {
    const body = route.request().postData();
    sent.push({ path: new URL(route.request().url()).pathname, body: body ? JSON.parse(body) : null });
    return route.fulfill({ json: { ok: true, voice: sent.length } });
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async (on) => {
    localStorage.clear();
    if (on) setGrainUi('synth');
    const f = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(f.find((x) => /tone/.test(x.path)) || f[0]);
    setMode('edit');
    engine.path = state.selectedFile.path;
    engine.raw = !playsDocument();
  }, flag);
  await page.waitForFunction(() => state.rack && Object.keys(state.shapers).length > 0, null, { timeout: 20_000 });
  if (flag) await page.waitForFunction(() => document.querySelector('#gsEngTabs .gs-tab.on') && state.overview, null, { timeout: 20_000 });
  await page.waitForFunction(() => !!state.stretchDraft);
  // What earlier specs left on this sound is not this spec's to inherit.
  await page.evaluate(async () => {
    if (currentScale() || currentStep()) await pickScale('', 0);
    state.stretchDraft.algorithm = 'wsola';
    await resetEverything();
  });
  await page.waitForTimeout(200);
  return sent;
}

const heard = (page, id) => page.evaluate(async (id) => (await api('/api/engine/lfos')).heard[id], id);

async function pressBar(page, k, opts = {}) {
  await page.locator(`.gs-bc[data-k="${k}"] .gs-bw`).first().click({ position: { x: 40, y: 8 }, ...opts });
}

/// `LFO i` listens, then press the control.
async function mapBar(page, i, k, opts = {}) {
  await page.click(`#gsLmap${i}`);
  await pressBar(page, k, opts);
}

const chips = (page, i) => page.$$eval(`#gsLtg${i} .gs-tgc[data-t]`, (s) => s.map((x) => x.dataset.t));

async function setChain(page, kinds) {
  await page.evaluate(async (kinds) => {
    state.rack.slots = kinds.map((k) => defaultFxSlot(k));
    adoptRack(await postJSON('/api/rack', { p: state.selectedFile.path, sr: state.view.sampleRate || 48000, slots: state.rack.slots, master: state.rack.master, pads: {}, postRoll: {}, ranges: {} }));
    renderRack();
  }, kinds);
}

test('four live rows: a scope, seven shapes, Free or Each note, Hz or Tempo, Rate, Depth, Map', async ({ page }) => {
  await openPage(page);
  expect(await page.locator('#gsRMod.gs-inert').count()).toBe(0);
  await expect(page.locator('#gsRMod .gs-lfr')).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(page.locator(`#gsLsc${i}`)).toBeVisible();
    await expect(page.locator(`#gsLshp${i} span`)).toHaveCount(7);
    await expect(page.locator(`#gsLmode${i} span`)).toHaveCount(2);
    await expect(page.locator(`#gsLsync${i} span`)).toHaveCount(2);
    await expect(page.locator(`#gsLkr${i} b`)).toHaveText(/Hz|bar|\//);
    await expect(page.locator(`#gsLkd${i} b`)).toHaveText(/%/);
    await expect(page.locator(`#gsLmap${i}`)).toHaveText('MAP');
    await expect(page.locator(`#gsLtg${i} .gs-hint`)).toHaveText('Moves nothing yet');
  }
  // The header no longer says it is only drawn.
  await expect(page.locator('#gsPMod .gs-mh .gs-hint')).toHaveCount(0);
  // The running phase moves the scope's own dot along without anything mapped.
  const a = await page.evaluate(async () => (await api('/api/engine/lfos')).lfos[0].phase);
  await page.waitForTimeout(120);
  const b = await page.evaluate(async () => (await api('/api/engine/lfos')).lfos[0].phase);
  expect(b).toBeGreaterThan(a);
});

test('Map a stretch control: its ring is the LFO colour, it moves, the document does not', async ({ page }) => {
  await openPage(page);
  const before = await page.evaluate(() => ({ scan: gsRead('scan'), edit: JSON.stringify(state.edit) }));
  await mapBar(page, 1, 'scan');

  await expect(page.locator('#gsLmap1')).toHaveText('MAP');
  expect(await page.evaluate(() => document.body.classList.contains('gs-mapping'))).toBe(false);
  expect(await chips(page, 1)).toEqual(['stretch.grain.scan']);

  const col = await page.evaluate(() => GS_LCOL[1]);
  const el = page.locator('.gs-bc[data-k="scan"]').first();
  await expect(el).toHaveClass(/mapped/);
  const ring = await el.evaluate((b) => { const s = getComputedStyle(b.querySelector('.gs-bw')); return { mc: b.style.getPropertyValue('--mc'), shadow: s.boxShadow, bd: getComputedStyle(b.querySelector('.gs-bd')).display }; });
  expect(ring.mc).toBe(col);
  expect(ring.bd).toBe('block');
  expect(ring.shadow).not.toBe('none');

  // Heard moves, repeatedly, and the setting stays where the hand left it.
  let last = null, moved = 0;
  for (let i = 0; i < 12; i++) {
    const v = await heard(page, 'stretch.grain.scan');
    if (last != null && v !== last) moved++;
    last = v;
    await page.waitForTimeout(90);
  }
  expect(moved).toBeGreaterThan(3);
  expect(await page.evaluate(() => gsRead('scan'))).toBe(before.scan);
  // Heard, never stored: the page's document is byte for byte what it was.
  expect(await page.evaluate(() => JSON.stringify(state.edit))).toBe(before.edit);
  // The dot travels too, on its own.
  const left = () => el.evaluate((b) => b.querySelector('.gs-bd').style.left);
  const l0 = await left();
  await expect.poll(left, { timeout: 2000 }).not.toBe(l0);
});

test('Map a rack knob from the effects page header: it moves and its setting does not', async ({ page }) => {
  await openPage(page);
  await setChain(page, ['prism:echo']);
  await page.click('#gsFxStrip .gs-tile[data-ci="0"]');
  await expect(page.locator('#gsFxView')).toBeVisible();
  await page.waitForFunction(() => document.querySelector('#fxModuleRail .fxk, #fxModuleRail .lex-knob, #fxModuleRail .sh-cell'));

  const col = await page.evaluate(() => GS_LCOL[2]);
  await page.click('#gsLmapF2');
  await expect(page.locator('#gsLmapF2')).toHaveClass(/on/);
  const cell = page.locator('#fxModuleRail .fxk').first();
  const key = await cell.getAttribute('data-key');
  const base = await page.evaluate((k) => state.rack.slots[0].params[k], key);
  await cell.locator('svg.ui-ring').click();

  const id = await page.evaluate((k) => `fx.${state.rack.slots[0].id}.${k}`, key);
  await expect.poll(() => page.evaluate(() => GS.lfo[2].targets.length)).toBe(1);
  expect(await page.evaluate(() => GS.lfo[2].targets[0])).toBe(id);
  await expect(cell).toHaveClass(/gs-mapped/);
  expect(await cell.evaluate((c) => c.style.getPropertyValue('--mc'))).toBe(col);
  const shadow = await cell.evaluate((c) => getComputedStyle(c.querySelector('.ui-kn')).outlineStyle);
  expect(shadow).toBe('solid');

  // Move: and the slot's own value stays.
  await expect.poll(() => heard(page, id), { timeout: 3000 }).not.toBe(await heard(page, id));
  expect(await page.evaluate((k) => state.rack.slots[0].params[k], key)).toBe(base);
  await expect(cell.locator('.ui-live')).toBeVisible();

  // The server's rack is not written either.
  const stored = await page.evaluate(async () => (await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}&sr=48000`)).slots[0].params);
  expect(stored[key] ?? base).toBeCloseTo(base, 3);
});

test('Shift-click maps several without ending Map; clicking one again unmaps it; Esc ends', async ({ page }) => {
  await openPage(page);
  await page.click('#gsLmap0');
  await pressBar(page, 'overlap', { modifiers: ['Shift'] });
  await pressBar(page, 'panSpread', { modifiers: ['Shift'] });
  expect(await chips(page, 0)).toEqual(['stretch.grain.overlap', 'stretch.grain.panSpread']);
  await expect(page.locator('#gsLmap0')).toHaveText('CLICK A CONTROL');
  expect(await page.evaluate(() => document.body.classList.contains('gs-mapping'))).toBe(true);

  await pressBar(page, 'overlap', { modifiers: ['Shift'] });
  expect(await chips(page, 0)).toEqual(['stretch.grain.panSpread']);
  await expect(page.locator('.gs-bc[data-k="overlap"]').first()).not.toHaveClass(/mapped/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#gsLmap0')).toHaveText('MAP');
  expect(await page.evaluate(() => document.body.classList.contains('gs-mapping'))).toBe(false);

  // Pressing a mapped control without Shift unmaps and ends, once.
  await mapBar(page, 0, 'panSpread');
  expect(await chips(page, 0)).toEqual([]);
  await expect(page.locator('#gsLmap0')).toHaveText('MAP');

  // A press that maps a bar does not also move it.
  const v = await page.evaluate(() => gsRead('sizeJitter'));
  await mapBar(page, 3, 'sizeJitter');
  expect(await page.evaluate(() => gsRead('sizeJitter'))).toBe(v);
});

test('the × on a chip takes it off and it goes back to where the setting is', async ({ page }) => {
  await openPage(page);
  await mapBar(page, 0, 'panSpread');
  const id = 'stretch.grain.panSpread';
  await expect(page.locator(`#gsLtg0 .gs-tgc[data-t="${id}"]`)).toBeVisible();
  await expect.poll(() => heard(page, id), { timeout: 2000 }).toBeDefined();
  await page.click(`#gsLtg0 .gs-tgc[data-t="${id}"] i`);
  await expect(page.locator(`#gsLtg0 .gs-tgc[data-t="${id}"]`)).toHaveCount(0);
  await expect(page.locator('#gsLtg0 .gs-hint')).toHaveText('Moves nothing yet');
  await expect(page.locator('.gs-bc[data-k="panSpread"]').first()).not.toHaveClass(/mapped/);
  // No longer heard, so nothing to report.
  await expect.poll(() => heard(page, id), { timeout: 2000 }).toBeUndefined();
});

test('what cannot move live refuses, and says so in its tooltip', async ({ page }) => {
  await openPage(page);
  // On Hybrid, where the separation's controls are.
  await page.evaluate(() => { document.querySelector('#stretchEngine .seg-btn[data-alg="hybrid"]').click(); });
  await page.waitForFunction(() => GS.engine === 'hybrid' && document.querySelector('.gs-bc[data-k="timeSpan"]'));
  await expect.poll(() => page.evaluate(() => GS_L.got)).toBe(true);
  for (const [k, word] of [['timeSpan', 'Hold'], ['freqSpan', 'Spread'], ['fftSize', 'Resolution'], ['margin', 'Margin']]) {
    await expect(page.locator(`.gs-bc[data-k="${k}"]`).first()).toHaveAttribute('title', new RegExp(`Cannot be mapped.*${word}`));
  }
  await expect(page.locator('#gsSeedRow')).toHaveAttribute('title', /Cannot be mapped/);

  await page.click('#gsLmap0');
  const v = await page.evaluate(() => gsRead('timeSpan'));
  await pressBar(page, 'timeSpan');
  await pressBar(page, 'fftSize');
  await page.locator('.gs-bc[data-k="reverse"] .gs-tg').first().click();
  await page.locator('#gsSeedRow').click({ position: { x: 90, y: 10 } });

  expect(await chips(page, 0)).toEqual([]);
  // Refused, not fallen through: Map is still open and nothing changed.
  await expect(page.locator('#gsLmap0')).toHaveText('CLICK A CONTROL');
  expect(await page.evaluate(() => gsRead('timeSpan'))).toBe(v);
  expect(await page.evaluate(() => gsRead('reverse'))).toBe(0);
  await page.keyboard.press('Escape');

  // The server says no on its own as well.
  const r = await page.evaluate(() => postJSON('/api/engine/lfos', { p: state.selectedFile.path, lfos: [{ shape: 'sine', hz: 1, depth: 0.5, targets: [{ t: 'stretch.hybrid.fftSize' }, { t: 'stretch.grain.scan' }] }] }));
  expect(r.refused).toEqual(['stretch.hybrid.fftSize']);
});

test('saved per sound, with AMP; a second sound has its own; coming back restores it', async ({ page }) => {
  await openPage(page);
  await page.click('#gsLshp2 span[data-s="square"]');
  await mapBar(page, 2, 'layerSpread');
  await page.click('#gsLsync2 span[data-y="1"]');
  await page.click('#gsLmode2 span[data-m="trig"]');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(gsVoiceKey())).lfo[2]);
  expect(stored).toMatchObject({ shape: 'square', sync: true, mode: 'trig', targets: ['stretch.grain.layerSpread'] });
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(gsVoiceKey()))).includes('amp'))).toBe(true);

  const other = await page.evaluate(async () => {
    const f = (await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`));
    const was = state.selectedFile.path, o = f.find((x) => x.path !== was);
    await selectFile(o);
    return o.path;
  });
  await expect.poll(() => page.evaluate(() => GS.abFor)).toBe(other);
  await expect.poll(() => chips(page, 2)).toEqual([]);
  await expect(page.locator('#gsLshp2 span.on')).toHaveAttribute('data-s', 'tri');

  await page.evaluate(async () => {
    const f = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(f.find((x) => /tone/.test(x.path)) || f[0]);
  });
  await expect.poll(() => chips(page, 2)).toEqual(['stretch.grain.layerSpread']);
  await expect(page.locator('#gsLshp2 span.on')).toHaveAttribute('data-s', 'square');
  // The engine is told what the sound it now has wants.
  await expect.poll(() => heard(page, 'stretch.grain.layerSpread'), { timeout: 2000 }).toBeDefined();
});

test('A and B each keep their own LFOs; Randomize leaves them and Undo puts them back', async ({ page }) => {
  await openPage(page);
  await mapBar(page, 0, 'layerSpread');
  await page.click('#gsAB span[data-ab="B"]');
  await mapBar(page, 1, 'overlap');
  expect(await chips(page, 1)).toEqual(['stretch.grain.overlap']);
  await page.click('#gsAB span[data-ab="A"]');
  await expect.poll(() => chips(page, 0)).toEqual(['stretch.grain.layerSpread']);
  expect(await chips(page, 1)).toEqual([]);
  await page.click('#gsAB span[data-ab="B"]');
  await expect.poll(() => chips(page, 1)).toEqual(['stretch.grain.overlap']);

  // Randomize is the sound, not the LFOs; Undo is what it was, LFOs and all.
  await page.click('#gsAB span[data-ab="A"]');
  await expect.poll(() => chips(page, 0)).toEqual(['stretch.grain.layerSpread']);
  await page.evaluate(() => { GS.lfo[3].shape = 'up'; gsMarkLfo(); });
  await page.click('#gsRndBtn');
  expect(await chips(page, 0)).toEqual(['stretch.grain.layerSpread']);
  await page.click('#gsLshp3 span[data-s="down"]');
  await page.click('#gsRndUndo');
  await expect(page.locator('#gsLshp3 span.on')).toHaveAttribute('data-s', 'up');
});

test('Each note and Tempo reach the engine; a mapped control follows them', async ({ page }) => {
  const posts = [];
  await openPage(page);
  await page.route(/\/api\/engine\/lfos$/, async (route) => {
    if (route.request().method() === 'POST') posts.push(JSON.parse(route.request().postData()));
    return route.continue();
  });
  await page.click('#gsLmode1 span[data-m="trig"]');
  await page.click('#gsLsync1 span[data-y="1"]');
  await expect.poll(() => posts.length).toBeGreaterThan(1);
  const sent = posts[posts.length - 1].lfos[1];
  expect(sent.mode).toBe('trig');
  expect(sent.beats).toBeGreaterThan(0);
  expect(sent.hz).toBeUndefined();
  expect(posts[posts.length - 1].bpm).toBe(120);

  // A tempo the sequencer sends goes on to the engine, with no touch on the page.
  const before = posts.length;
  await page.evaluate(() => { seq.tempo = { bpm: 96, stepBeats: 0.25 }; });
  await expect.poll(() => posts.length, { timeout: 2000 }).toBeGreaterThan(before);
  expect(posts[posts.length - 1].bpm).toBe(96);

  // Rate's knob, back to Hz: a new number, the phase carried on server-side.
  await page.click('#gsLsync1 span[data-y="0"]');
  await page.locator('#gsLkr1').dispatchEvent('dblclick');
  await expect.poll(() => posts[posts.length - 1].lfos[1].hz).toBeCloseTo(0.02 * Math.pow(2000, 0.4), 4);
});

test('the Rate and Depth knobs read and drag, and a hand on a mapped control moves its base', async ({ page }) => {
  await openPage(page);
  await page.evaluate(() => { GS.lfo[0].shape = 'square'; GS.lfo[0].rate = 0.75; gsLfoChanged(); });
  await mapBar(page, 0, 'panSpread');
  const shown = await page.evaluate(() => { GS.lfo[0].depth = 0.25; gsLfoChanged(); return gsLfoRate(GS.lfo[0]); });
  await expect(page.locator('#gsLkd0 b')).toHaveText('25 %');
  await expect(page.locator('#gsLkr0 b')).toHaveText(shown);
  // Base 0, Depth 25 %: heard is 0 or a quarter, never anything else.
  const pan = 'stretch.grain.panSpread', seen = new Set();
  for (let i = 0; i < 25 && seen.size < 2; i++) { seen.add(await heard(page, pan)); await page.waitForTimeout(40); }
  expect([...seen].map((v) => Math.round(v * 1000) / 1000).sort()).toEqual([0, 0.25]);

  // The bar is moved by hand with the LFO on it: the base goes, the swing follows.
  await page.evaluate(() => { gsSetV('panSpread', 0.5); gsPostAll(); });
  await expect.poll(() => heard(page, pan), { timeout: 2000 }).toBeGreaterThan(0.4);
  const after = new Set();
  for (let i = 0; i < 25 && after.size < 2; i++) { after.add(await heard(page, pan)); await page.waitForTimeout(40); }
  expect([...after].map((v) => Math.round(v * 1000) / 1000).sort()).toEqual([0.25, 0.75]);
  expect(await page.evaluate(() => gsRead('panSpread'))).toBe(0.5);

  const box = await page.locator('#gsLkd0').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y - 20, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Math.round(GS.lfo[0].depth * 100))).toBeGreaterThan(25);
});

test('with the page switched off nothing is sent and nothing has changed', async ({ page }) => {
  const posts = [];
  await page.route(/\/api\/engine\/lfos$/, async (route) => {
    posts.push(route.request().method());
    return route.fulfill({ json: { ok: true, lfos: [], heard: {}, refuse: {} } });
  });
  await openPage(page, { flag: false });
  await page.waitForTimeout(300);
  expect(posts).toEqual([]);
  await expect(page.locator('#grainView .gs-app')).toHaveCount(0);
});

test('off the page the LFOs are taken off everything', async ({ page }) => {
  await openPage(page);
  await mapBar(page, 0, 'panSpread');
  await expect.poll(() => heard(page, 'stretch.grain.panSpread'), { timeout: 2000 }).toBeDefined();
  await page.evaluate(() => setMode('library'));
  await page.waitForTimeout(150);
  await expect.poll(() => heard(page, 'stretch.grain.panSpread'), { timeout: 2000 }).toBeUndefined();
});
