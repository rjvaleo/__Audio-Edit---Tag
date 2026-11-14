// The Grain v12 page, behind `prefs.grainUi`: a second face on the same drafts.
//
// Phase 1's promise: every control the tray has is on this page for its engines,
// and each one really moves the draft the tray reads. So the table below says
// where each value lives by naming the draft itself, written out here rather
// than read from the page's own table: a control wired to the wrong place fails.

import { test, expect } from './test.mjs';
import { pbSaveAs, pbName, pbLit, pbPick, pbStep, pbRename, pbDelete } from './preset-bar.helpers.mjs';

/// Where each control's value lives.
const AT = {
  ratio: 'ratio', semitones: 'semitones', windowMs: 'windowMs', cloud: 'cloud', cloudMix: 'cloudMix',
  rateHz: 'g.rateHz', densityHz: 'g.densityHz', overlap: 'g.overlap', envelope: 'g.envelope', sizeJitter: 'g.sizeJitter',
  sizeRange: 'g.sizeRange', position: 'g.position', scan: 'g.scan', positionJitterMs: 'g.positionJitterMs',
  pitchJitterSemis: 'g.pitchJitterSemis', pitchDriftSemis: 'g.pitchDriftSemis', driftRateHz: 'g.driftRateHz',
  layers: 'g.layers', layerSpread: 'g.layerSpread', layerScatter: 'g.layerScatter', layerScatterMs: 'g.layerScatterMs',
  panSpread: 'g.panSpread', fbAmount: 'g.fbAmount', fbTimeMs: 'g.fbTimeMs', fbSmear: 'g.fbSmear', fbDamp: 'g.fbDamp',
  fbShift: 'g.fbShift', reverse: 'g.reverse', wrap: 'g.wrap', driftStep: 'g.driftStep', fbHold: 'g.fbHold', linkJitter: 'g.linkJitter',
  searchMs: 'wsola.searchMs', stride: 'wsola.stride', splicePick: 'wsola.splice', spliceShape: 'wsola.shape',
  preserveTransients: 'wsola.preserveTransients', sensitivity: 'wsola.sensitivity', floor: 'wsola.floor', guardHops: 'wsola.guardHops',
  anchorFrames: 'pvsola.anchorFrames', anchorSearchMs: 'pvsola.searchMs', blend: 'pvsola.blend',
  timeSpan: 'hybrid.timeSpan', freqSpan: 'hybrid.freqSpan', margin: 'hybrid.margin', fftSize: 'hybrid.fftSize',
  harmonicLevel: 'hybrid.harmonicLevel', percussiveLevel: 'hybrid.percussiveLevel', residualLevel: 'hybrid.residualLevel', morphNoise: 'hybrid.morphNoise',
  vocWindowMs: 'vocoder.windowMs', magFreeze: 'vocoder.magFreeze', magBlur: 'vocoder.magBlur', magGate: 'vocoder.magGate',
  freqTrust: 'vocoder.freqTrust', phaseSpread: 'vocoder.phaseSpread', peakWidth: 'vocoder.peakWidth', lockWidth: 'vocoder.lockWidth',
  phaseLock: 'vocoder.phaseLock', stereoLink: 'vocoder.stereoLink',
};

const SHARED = [
  // Overlap leads: moving Density or Rate dims it.
  'overlap', 'ratio', 'semitones', 'windowMs', 'pitchJitterSemis', 'pitchDriftSemis', 'driftRateHz', 'driftStep', 'linkJitter',
  'position', 'positionJitterMs', 'rateHz', 'densityHz', 'envelope', 'sizeJitter', 'sizeRange', 'scan', 'reverse', 'wrap',
  'layers', 'layerSpread', 'layerScatter', 'layerScatterMs', 'panSpread', 'fbAmount', 'fbTimeMs', 'fbSmear', 'fbDamp', 'fbShift', 'fbHold',
];
const CLOUD = ['cloud', 'cloudMix'];
const SPLICE = ['searchMs', 'stride', 'splicePick', 'spliceShape'];
const TRANS = ['sensitivity', 'floor', 'guardHops'];
const VOC = ['vocWindowMs', 'magFreeze', 'magBlur', 'magGate', 'freqTrust', 'phaseSpread', 'peakWidth', 'lockWidth', 'phaseLock', 'stereoLink'];
const ENGINES = {
  wsola: [...CLOUD, ...SPLICE, 'preserveTransients', ...TRANS],
  vocoder: [...CLOUD, ...VOC],
  pvsola: [...CLOUD, 'anchorFrames', 'anchorSearchMs', 'blend', ...VOC],
  hybrid: [...CLOUD, 'harmonicLevel', 'percussiveLevel', 'residualLevel', 'morphNoise', 'timeSpan', 'freqSpan', 'margin', 'fftSize', ...VOC, ...SPLICE, ...TRANS],
  granular: [],
};

async function openPage(page, { flag = true } = {}) {
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async (on) => {
    if (on) setGrainUi('synth');
    const f = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(f.find((x) => /tone/.test(x.path)) || f[0]);
    setMode('edit');
  }, flag);
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, null, { timeout: 20_000 });
  if (flag) await page.waitForFunction(() => document.querySelector('#gsEngTabs .gs-tab.on') && state.overview, null, { timeout: 20_000 });
  await page.waitForTimeout(250);
}

const draft = (page, k) => page.evaluate(([path]) => {
  const parts = path.split('.'), key = parts.pop();
  const home = parts[0] === 'g' ? state.grainDraft : parts.length ? state.stretchDraft[parts[0]] : state.stretchDraft;
  return home[key];
}, [AT[k]]);

async function pickEngine(page, e) {
  await page.click(`#gsEngTabs .gs-tab[data-e="${e}"]`);
  await page.waitForFunction((x) => state.stretchDraft.algorithm === x && state.edit.stretch.algorithm === x, e);
  await page.waitForTimeout(150);
}

/// Click a bar a fraction of the way along.
async function clickBar(page, k, frac) {
  const box = await page.locator(`#grainView .gs-bc[data-k="${k}"] .gs-bw`).boundingBox();
  await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
}

test('the page shows only with the flag on, and the old tray stays built under it', async ({ page }) => {
  await openPage(page, { flag: false });
  expect(await page.evaluate(() => [document.body.classList.contains('grainpage'), $('grainView').classList.contains('hidden'), !!document.querySelector('#grainView .gs-app')])).toEqual([false, true, false]);
  expect(await page.locator('#lane').isVisible()).toBe(true);

  await page.evaluate(() => setGrainUi('synth'));
  await page.waitForFunction(() => document.querySelector('#gsEngTabs .gs-tab.on'));
  expect(await page.evaluate(() => [
    document.body.classList.contains('grainpage'),
    $('grainView').classList.contains('hidden'),
    Object.keys(state.grainRows).length > 20,
    !!$('grainControls'),
  ])).toEqual([true, false, true, true]);
  for (const id of ['lane', 'overview', 'transportBar', 'presetBar', 'dock']) expect(await page.locator('#' + id).isVisible(), id).toBe(false);
  expect(await page.locator('#tabBar').isVisible()).toBe(true);

  await page.evaluate(() => setGrainUi('classic'));
  await page.waitForFunction(() => !document.body.classList.contains('grainpage'));
  expect(await page.locator('#lane').isVisible()).toBe(true);
  expect(await page.locator('#grainView').isVisible()).toBe(false);
});

test('Settings has the switch', async ({ page }) => {
  await openPage(page, { flag: false });
  await page.evaluate(() => openSettings());
  await page.selectOption('#set-grainUi', 'synth');
  await page.waitForFunction(() => document.body.classList.contains('grainpage'));
  await page.evaluate(() => closeSettings());
  expect(await page.evaluate(() => prefs.grainUi)).toBe('synth');
});

for (const [engine, own] of Object.entries(ENGINES)) {
  test(`${engine}: every control is there, and each moves its draft and reaches the document`, async ({ page }) => {
    test.setTimeout(90_000);
    await openPage(page);
    await pickEngine(page, engine);
    await page.evaluate(() => resetEverything());
    await page.waitForTimeout(200);

    // The two switches that open other controls go last, having been left on.
    const gates = ['cloud', 'preserveTransients'];
    const keys = [...SHARED, ...own.filter((k) => !gates.includes(k)), ...own.filter((k) => gates.includes(k))];
    const shown = await page.evaluate(() => [...document.querySelectorAll('#grainView .gs-bc[data-k]')].map((e) => e.dataset.k));
    expect(new Set(shown)).toEqual(new Set(keys));

    // Position, Rate and the transient controls answer only with their switches on.
    if (engine !== 'granular') await page.click('#grainView .gs-bc[data-k="cloud"] .gs-tg');
    if (engine === 'wsola') await page.click('#grainView .gs-bc[data-k="preserveTransients"] .gs-tg');
    await page.waitForTimeout(150);

    for (const k of keys) {
      const kind = await page.evaluate((key) => (GS_C[key].sw ? 'sw' : GS_C[key].seg ? 'seg' : 'bar'), k);
      if (kind === 'sw') {
        const was = await draft(page, k);
        await page.click(`#grainView .gs-bc[data-k="${k}"] .gs-tg`);
        expect(await draft(page, k), `${k} toggles`).toBe(!was);
      } else if (kind === 'seg') {
        const was = await draft(page, k);
        await page.click(`#grainView .gs-bc[data-k="${k}"] .gs-seg span:nth-child(2)`);
        expect(await draft(page, k), `${k} chooses`).not.toBe(was);
      } else {
        await clickBar(page, k, 0.25);
        const a = await draft(page, k);
        await clickBar(page, k, 0.75);
        const b = await draft(page, k);
        expect(b, `${k} moves its draft`).not.toBe(a);
        expect(Number.isFinite(b), `${k} stays a number`).toBe(true);
      }
    }
    await page.waitForTimeout(500);

    // What the page drew is in the document, not only in the draft.
    const stale = await page.evaluate((at) => {
      const st = state.edit.stretch, bad = [];
      for (const path of Object.values(at)) {
        const parts = path.split('.'), key = parts.pop();
        const d = parts[0] === 'g' ? state.grainDraft : parts.length ? state.stretchDraft[parts[0]] : state.stretchDraft;
        const e = parts[0] === 'g' ? st.grain : parts.length ? st[parts[0]] : st;
        if (typeof d[key] === 'number' ? Math.abs(d[key] - e[key]) > Math.abs(d[key]) * 0.02 + 0.02 : d[key] !== e[key]) bad.push(`${path}: ${d[key]} vs ${e[key]}`);
      }
      return bad;
    }, AT);
    expect(stale).toEqual([]);
  });

  test(`${engine}: nothing overflows and no name runs into its value`, async ({ page }) => {
    await openPage(page);
    await pickEngine(page, engine);
    await page.waitForTimeout(150);
    const got = await page.evaluate(() => {
      const over = [];
      for (const id of ['gsEngPanel', 'gsShared', 'gsPSrc']) { const el = $(id); if (el.scrollHeight > el.clientHeight + 1) over.push(`${id} ${el.scrollHeight}>${el.clientHeight}`); }
      const app = document.querySelector('.gs-app');
      if (app.scrollHeight > GS_H || app.scrollWidth > GS_W) over.push(`app ${app.scrollWidth}x${app.scrollHeight}`);
      for (const el of document.querySelectorAll('#grainView .gs-bw')) {
        const n = el.querySelector('.gs-bn'), v = el.querySelector('.gs-bv');
        if (n && v && n.getBoundingClientRect().right > v.getBoundingClientRect().left + 0.5) over.push(`${n.textContent} meets ${v.textContent}`);
      }
      return over;
    });
    expect(got).toEqual([]);
  });
}

test('the engine tabs change the engine, and the tray goes with them', async ({ page }) => {
  await openPage(page);
  for (const e of ['vocoder', 'pvsola', 'hybrid', 'granular', 'wsola']) {
    await pickEngine(page, e);
    expect(await page.evaluate(() => [$('gsEngName').textContent, document.querySelector('#stretchEngine .seg-btn.active').dataset.alg])).toEqual([e.toUpperCase(), e]);
    expect(await page.locator('#grainView .gs-tab.on').getAttribute('data-e')).toBe(e);
  }
});

test('a bar: a drag follows, Shift is finer, a double-click on it or its picture puts it back', async ({ page }) => {
  await openPage(page);
  const bar = page.locator('#grainView .gs-bc[data-k="fbSmear"]');
  const box = await bar.locator('.gs-bw').boundingBox(), y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 });
  expect(await draft(page, 'fbSmear')).toBeCloseTo(0.6, 1);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const a = await draft(page, 'fbSmear');
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
  const b = await draft(page, 'fbSmear');
  expect(b - a).toBeGreaterThan(0.01);
  expect(b - a).toBeLessThan(0.08);
  await bar.locator('svg.gg').dblclick();
  await page.waitForTimeout(250);
  expect(await draft(page, 'fbSmear')).toBeCloseTo(0.3, 3);
  await clickBar(page, 'fbSmear', 0.8);
  await bar.locator('.gs-bw').dblclick();
  await page.waitForTimeout(250);
  expect(await draft(page, 'fbSmear')).toBeCloseTo(0.3, 3);
});

test('Reset is this engine only, as one edit', async ({ page }) => {
  await openPage(page);
  await pickEngine(page, 'wsola');
  await clickBar(page, 'searchMs', 0.8);
  await clickBar(page, 'layers', 0.8);
  await page.waitForTimeout(300);
  const layers = await draft(page, 'layers');
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/edit')) posts++; });
  await page.click('#gsEngReset');
  await page.waitForTimeout(300);
  expect(posts).toBe(1);
  expect(await draft(page, 'searchMs')).toBe(10);
  expect(await draft(page, 'layers')).toBe(layers);
});

test('the Tuning menu has every scale, with the dock selector opening the same one', async ({ page }) => {
  await openPage(page);
  const total = await page.evaluate(async () => (await api('/api/scales')).groups.reduce((n, g) => n + g.scales.length, 0));
  expect(total).toBeGreaterThanOrEqual(81);
  await page.click('#gsTuneBtn');
  await page.waitForSelector('#gsMenu .gs-tt');
  expect(await page.locator('#gsMenu .gs-tt[data-scale]').count()).toBe(total);
  expect(await page.locator('#gsMenu .gs-tt[data-step]').count()).toBe(3);
  expect(await page.locator('#gsMenu svg').count()).toBe(total + 3);
  await page.fill('#gsTFilter', 'maqam');
  const shown = await page.locator('#gsMenu .gs-tt:visible').count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(total);
  await page.fill('#gsTFilter', '');

  // Into the page, and inside it.
  const box = await page.locator('#gsMenu').boundingBox(), app = await page.locator('.gs-app').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(app.x);
  expect(box.y + box.height).toBeLessThanOrEqual(app.y + app.height + 1);

  const name = await page.evaluate(() => state.scales[0].scales[1].name);
  await page.click(`#gsMenu .gs-tt[data-scale="${name}"]`);
  await page.waitForFunction((n) => state.edit.stretch.scale === n, name);
  await page.waitForTimeout(200);
  expect(await page.locator('#gsTuneBtn').textContent()).toContain(name);
  expect(await page.locator('#gsKbScale').textContent()).toContain(name);
  expect(await page.locator('#gsMenu').isVisible()).toBe(false);

  // The same menu from the dock, and Free puts it back.
  await page.click('#gsKbScale');
  await page.waitForSelector('#gsMenu .gs-tt.on');
  expect(await page.locator('#gsMenu .gs-tt.on').getAttribute('data-scale')).toBe(name);
  await page.click('#gsMenu .gs-tt[data-step="0"]');
  await page.waitForFunction(() => !state.edit.stretch.scale);
  await page.waitForTimeout(200);
  expect(await page.locator('#gsTuneBtn').textContent()).toContain('Tuning: free');
  expect(await page.locator('#gsKbScale').textContent()).toContain('chromatic');
});

test('a semitone grid snaps Pitch', async ({ page }) => {
  await openPage(page);
  await page.click('#gsTuneBtn');
  await page.waitForSelector('#gsMenu .gs-tt');
  await page.click('#gsMenu .gs-tt[data-step="1"]');
  await page.waitForFunction(() => state.edit.stretch.pitchStep === 1);
  await page.waitForTimeout(150);
  await clickBar(page, 'semitones', 0.62);
  const v = await draft(page, 'semitones');
  expect(v).toBe(Math.round(v));
});

test('presets: the bar saves, applies, steps, renames and deletes through /api/presets', async ({ page }) => {
  await openPage(page);
  const stamp = `p${Date.now()}`;
  await clickBar(page, 'windowMs', 0.7);
  await page.waitForTimeout(300);
  const saved = await draft(page, 'windowMs');

  await pbSaveAs(page, 'gs', stamp);
  await page.waitForFunction((n) => state.presets.some((p) => p.name === n), stamp);
  await expect.poll(() => pbName(page, 'gs')).toBe(stamp);

  // Edited: the light comes on, and Save keeps it under the same name.
  await clickBar(page, 'windowMs', 0.2);
  await page.waitForTimeout(300);
  expect(await draft(page, 'windowMs')).not.toBe(saved);
  await expect.poll(() => pbLit(page, 'gs')).toBe(true);

  await pbPick(page, 'gs', stamp);
  await page.waitForFunction((v) => Math.abs(state.stretchDraft.windowMs - v) < 0.01, saved);
  expect(await pbName(page, 'gs')).toBe(stamp);
  await expect.poll(() => pbLit(page, 'gs')).toBe(false);

  // The arrows walk the list.
  const second = `${stamp}b`;
  await page.evaluate(async (n) => {
    state.presets = (await postJSON('/api/presets', { name: n, note: '', p: state.selectedFile.path })).presets;
    renderPresets();
  }, second);
  const names = await page.evaluate(() => state.presets.map((p) => p.name));
  const from = await pbName(page, 'gs');
  await pbStep(page, 'gs', 1);
  await expect.poll(() => pbName(page, 'gs')).toBe(names[(names.indexOf(from) + 1) % names.length]);

  // Rename, on the bar: the stored values go across.
  await pbPick(page, 'gs', stamp);
  await expect.poll(() => pbName(page, 'gs')).toBe(stamp);
  await pbRename(page, 'gs', `${stamp}r`);
  await page.waitForFunction((n) => state.presets.some((p) => p.name === n) && $('presetPick').value === n, `${stamp}r`);

  for (const n of [`${stamp}r`, second]) {
    await pbPick(page, 'gs', n);
    await expect.poll(() => pbName(page, 'gs')).toBe(n);
    await pbDelete(page, 'gs');
    await page.waitForFunction((x) => !state.presets.some((p) => p.name === x), n);
  }
});

test('A/B keeps the drafts, the rack and AMP apart', async ({ page }) => {
  await openPage(page);
  await page.waitForFunction(() => state.rack?.master);
  await clickBar(page, 'ratio', 0.3);
  await clickBar(page, 'fbTimeMs', 0.3);
  await page.waitForTimeout(300);
  const a = { ratio: await draft(page, 'ratio'), time: await draft(page, 'fbTimeMs'), amount: await page.evaluate(() => state.rack.master.amount) };

  await page.click('#gsAB [data-ab="B"]');
  await page.waitForTimeout(150);
  // B begins as A.
  expect(await draft(page, 'ratio')).toBe(a.ratio);
  await clickBar(page, 'ratio', 0.8);
  await clickBar(page, 'fbTimeMs', 0.8);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    GS.amp.a = 0.9;
    state.rack.master.amount = (state.rack.master.amount || 0) > 0.5 ? 0.1 : 0.9;
    pushRack({ immediate: true });
  });
  await page.waitForTimeout(250);
  const b = { ratio: await draft(page, 'ratio'), amount: await page.evaluate(() => state.rack.master.amount) };
  expect(b.ratio).not.toBe(a.ratio);

  await page.click('#gsAB [data-ab="A"]');
  await page.waitForFunction((v) => Math.abs(state.edit.stretch.ratio - v) < v * 0.001, a.ratio);
  await page.waitForTimeout(300);
  expect(await draft(page, 'ratio')).toBeCloseTo(a.ratio, 2);
  expect(await draft(page, 'fbTimeMs')).toBeCloseTo(a.time, 1);
  expect(await page.evaluate(() => [GS.amp.a, state.rack.master.amount])).toEqual([0.16, a.amount]);

  await page.click('#gsAB [data-ab="B"]');
  await page.waitForFunction((v) => Math.abs(state.edit.stretch.ratio - v) < v * 0.001, b.ratio);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => [GS.amp.a, state.rack.master.amount])).toEqual([0.9, b.amount]);
});

test('Randomize is the tray\'s Random and its Undo puts back exactly what was there', async ({ page }) => {
  await openPage(page);
  await pickEngine(page, 'vocoder');
  await clickBar(page, 'semitones', 0.6);
  await page.waitForTimeout(300);
  const snap = () => page.evaluate(() => JSON.stringify([state.stretchDraft, state.grainDraft]));
  const before = await snap();
  expect(await page.locator('#gsRndUndo').isVisible()).toBe(false);

  const edits = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/edit')) edits.push(r.postDataJSON()); });
  await page.click('#gsRndBtn');
  await page.waitForTimeout(500);
  expect(edits.length, 'one commit per box of the tray').toBeGreaterThan(0);
  expect(edits[0].op).toBe('stretch');
  edits.length = 0;
  expect(await snap()).not.toBe(before);
  expect(await page.evaluate(() => state.stretchDraft.algorithm), 'the engine stays').toBe('vocoder');
  expect(await page.locator('#gsRndUndo').isVisible()).toBe(true);

  await page.click('#gsRndUndo');
  await page.waitForTimeout(500);
  expect(edits.length).toBe(1);
  const after = JSON.parse(await snap()), was = JSON.parse(before);
  for (const k of ['ratio', 'windowMs', 'semitones']) expect(after[0][k]).toBeCloseTo(was[0][k], 2);
  for (const k of Object.keys(was[1])) if (typeof was[1][k] === 'number') expect(after[1][k], k).toBeCloseTo(was[1][k], 2);
  for (const k of Object.keys(was[0].vocoder)) if (typeof was[0].vocoder[k] === 'number') expect(after[0].vocoder[k], k).toBeCloseTo(was[0].vocoder[k], 2);
  expect(await page.locator('#gsRndUndo').isVisible()).toBe(false);
});

test('the overview moves the loop and Start; the detail shows between the brackets and zooms', async ({ page }) => {
  await openPage(page);
  // The whole file is the overview every page shares (416), above the page.
  const box = await page.locator('#poCanvas').boundingBox();
  const y = box.y + box.height * 0.6, at = (u) => box.x + box.width * u;

  // A drag across makes a loop.
  await page.mouse.move(at(0.3), y);
  await page.mouse.down();
  await page.mouse.move(at(0.5), y, { steps: 4 });
  await page.mouse.move(at(0.6), y, { steps: 4 });
  await page.mouse.up();
  const frames = await page.evaluate(() => state.overview.frames);
  let sel = await page.evaluate(() => state.sel);
  expect(sel.start / frames).toBeGreaterThan(0.27);
  expect(sel.end / frames).toBeLessThan(0.63);
  expect(await page.evaluate(() => state.cue)).toBe(sel.start);

  // A bracket moves one end.
  const X = (s) => box.x + 6 + s / frames * (box.width - 12);
  await page.mouse.move(X(sel.end), y);
  await page.mouse.down();
  await page.mouse.move(at(0.8), y, { steps: 5 });
  await page.mouse.up();
  const sel2 = await page.evaluate(() => state.sel);
  expect(sel2.start).toBe(sel.start);
  expect(sel2.end).toBeGreaterThan(sel.end);

  // A click moves Start and leaves the loop.
  await page.mouse.click(at(0.5), y);
  const cue = await page.evaluate(() => state.cue);
  expect(cue / frames).toBeGreaterThan(0.45);
  expect(cue / frames).toBeLessThan(0.55);
  expect(await page.evaluate(() => state.sel)).toEqual(sel2);

  // The detail asks the server for the loop.
  await page.waitForFunction(() => GS_DET.got === GS_DET.want && GS_DET.p);
  const got = await page.evaluate(() => [GS_DET.p.from - state.sel.start, GS_DET.p.to - state.sel.end]);
  expect(Math.abs(got[0])).toBeLessThanOrEqual(1);
  expect(Math.abs(got[1])).toBeLessThanOrEqual(1);

  // Its zoom stays inside the brackets.
  await page.click('#gsCzIn');
  // Written on the next frame, so it is waited for rather than read at once.
  await expect(page.locator('#gsCzRo')).toHaveText(/×/);
  const [ca, cb, a, b] = await page.evaluate(() => { const L = gsLoop(); return [...gsCloudView(), L.a, L.b]; });
  expect(ca).toBeGreaterThanOrEqual(a - 1e-6);
  expect(cb).toBeLessThanOrEqual(b + 1e-6);
  expect(cb - ca).toBeLessThan((b - a) * 0.6);
  await page.click('#gsCzFit');
  // The reading is drawn by the frame loop, on the next frame.
  await expect(page.locator('#gsCzRo')).toHaveText('loop');
});

test('dragging in the detail moves Position, and beside the box Spray and Pitch jitter', async ({ page }) => {
  await openPage(page);
  await pickEngine(page, 'granular');
  await page.waitForFunction(() => GS_DET.got === GS_DET.want && GS_DET.p);
  const box = await page.locator('#gsCloud').boundingBox(), y = box.y + box.height * 0.5;
  const head = await page.evaluate(() => { const g = gsCloudGeo(); return g.X(gsReadWrap(gsHead() + gsRead('position') * gsFile().len)) / g.w; });
  const hx = box.x + box.width * head;
  await page.mouse.move(hx, y);
  await page.mouse.down();
  await page.mouse.move(hx + 80, y, { steps: 4 });
  await page.mouse.up();
  expect(await draft(page, 'position')).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(await draft(page, 'positionJitterMs')).toBeGreaterThan(0);
  expect(await draft(page, 'pitchJitterSemis')).toBeGreaterThan(0);
});

test('the Now Playing bar\'s transport drives the page', async ({ page }) => {
  await openPage(page);
  const was = await page.evaluate(() => state.loopOn);
  await page.click('#nowBar #loopBtn');
  expect(await page.evaluate(() => state.loopOn)).toBe(!was);
  await page.waitForTimeout(60);
  expect(await page.locator('#gsLoopChip').evaluate((e) => e.classList.contains('on'))).toBe(!was);
  await page.click('#gsLoopChip');
  expect(await page.evaluate(() => state.loopOn)).toBe(was);
  const grain = await page.evaluate(() => $('srcGrain').classList.contains('on'));
  await page.click('#nowBar #srcGrain');
  expect(await page.evaluate(() => $('srcGrain').classList.contains('on'))).toBe(!grain);
});

test('a source switched off says so in the Now Playing bar, at the same width', async ({ page }) => {
  await openPage(page);
  const chip = page.locator('#nowBar #srcGrain');
  if (!(await page.evaluate(() => $('srcGrain').classList.contains('on')))) await chip.click();
  await expect(chip).toHaveClass(/\bon\b/);
  const width = await chip.evaluate((e) => e.getBoundingClientRect().width);
  const colourOn = await chip.evaluate((e) => getComputedStyle(e).color);
  await chip.click();
  await expect(chip).not.toHaveClass(/\bon\b/);
  expect(await chip.getAttribute('title')).toContain('silent');
  expect(await chip.evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe('line-through');
  expect(await chip.evaluate((e) => getComputedStyle(e).color)).not.toBe(colourOn);
  expect(await chip.evaluate((e) => e.getBoundingClientRect().width)).toBe(width);
  await chip.click();
  await expect(chip).toHaveClass(/\bon\b/);
  expect(await chip.getAttribute('title')).toContain('plays');
});

test('Automation, Visuals and Regions still open, from the rail under Grain', async ({ page }) => {
  await openPage(page);
  const sub = page.locator('#leftRail .rl-sub[data-for="grain"]');
  await expect(sub).toBeVisible();
  for (const [p, panel] of [['automation', 'dockAutomation'], ['visuals', 'dockVisuals'], ['regions', 'dockRegions']]) {
    await sub.locator(`[data-subpage="${p}"]`).click();
    await page.waitForFunction(() => document.body.classList.contains('grainsub'));
    await expect(page.locator('#' + panel)).toBeVisible();
    await expect(page.locator('#grainView')).toBeHidden();
    expect(await page.evaluate(() => document.querySelector('.dock-tab.active').dataset.dock)).toBe(p);
    await expect(sub.locator(`[data-subpage="${p}"]`)).toHaveClass(/active/);
  }
  await page.locator('#leftRail .rl-item[data-page="grain"]').click();
  await page.waitForFunction(() => document.body.classList.contains('grainpage'));
  await expect(page.locator('#grainView')).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('.dock-tab.active').dataset.dock)).toBe('stretch');
});

test('with the flag off, Grain has no sub-items and its dock tabs stay where they are put', async ({ page }) => {
  await openPage(page, { flag: false });
  await expect(page.locator('#leftRail .rl-sub[data-for="grain"]')).toBeHidden();
  await page.locator('.dock-tab[data-dock="automation"]').click();
  await page.evaluate(() => setMode('edit'));
  expect(await page.evaluate(() => document.querySelector('.dock-tab.active').dataset.dock)).toBe('automation');
});

test('the rest of the tray hears what this page changed, once the page is left', async ({ page }) => {
  await openPage(page);
  await pickEngine(page, 'wsola');
  await clickBar(page, 'searchMs', 0.9);
  await page.waitForTimeout(400);
  const v = await draft(page, 'searchMs');
  await page.locator('#leftRail .rl-item[data-mode="room"]').click();
  await page.waitForFunction(() => !document.body.classList.contains('grainpage'));
  expect(await page.evaluate(() => state.stretchDraft.wsola.searchMs)).toBeCloseTo(v, 1);
  expect(await page.evaluate(() => state.edit.stretch.wsola.searchMs)).toBeCloseTo(v, 1);
});

test('the page draws no error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openPage(page);
  for (const e of ['vocoder', 'pvsola', 'hybrid', 'granular', 'wsola']) await pickEngine(page, e);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => !!GS.failed)).toBe(false);
});

test('the app starts with the new page already chosen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const key = 'audiolab.settings.v1';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...saved, grainUi: 'synth' }));
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && (state.folders || []).length > 0, null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
