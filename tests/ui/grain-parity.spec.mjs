// The new Grain page against the tray it replaced, in the same build.
//
// The tray stays built, hidden, so the two can be held side by side. Every row
// it shows for an engine, with the cloud off and on, has to be on the page, and
// a value moved by the tray and the same value moved by the page have to reach
// `/api/edit` as the same request. A control added to the tray, or dropped from
// the page, fails here. See `grain-redesign/PARITY.md`.
//
// `/api/edit` is answered here for the matrix, so it costs nothing and leaves
// the document as it found it for the next spec.

import { test, expect } from './test.mjs';
import { pbSaveAs, pbPick, pbDelete, pbOpenList, pbName } from './preset-bar.helpers.mjs';

async function openPage(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    setGrainUi('synth');
    const f = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(f.find((x) => /tone/.test(x.path)) || f[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0 && document.querySelector('#gsEngTabs .gs-tab.on') && state.overview, null, { timeout: 20_000 });
  await page.waitForTimeout(250);
}

/// Answer `/api/edit` in the page and keep what was asked.
function holdEdits(page) {
  return page.evaluate(() => {
    if (window.__bodies) { window.__bodies.length = 0; return; }
    window.__bodies = [];
    const real = window.fetch;
    window.fetch = (u, o) => {
      if (String(u).endsWith('/api/edit') && o?.method === 'POST') {
        window.__bodies.push(JSON.parse(o.body));
        return Promise.resolve(new Response(JSON.stringify(state.edit), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return real(u, o);
    };
  });
}

/// The same request, numbers to a millionth of their size.
function sameBody(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > Math.max(1e-5, Math.abs(a) * 1e-6)) return `${path}: ${a} against ${b}`;
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const e = sameBody(a[k], b[k], `${path}.${k}`);
      if (e) return e;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`;
}

/// One engine, one way round of the cloud: every row the tray shows.
function compareAll(page, engine, cloud) {
  return page.evaluate(async ({ engine, cloud }) => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const clone = (x) => JSON.parse(JSON.stringify(x));
    document.querySelector(`#stretchEngine .seg-btn[data-alg="${engine}"]`).click();
    await tick();
    const cloudSwitch = () => [...document.querySelectorAll('#cloudMix .switch')].find((x) => /grain cloud/.test(x.textContent));
    if (cloudSwitch() && !!state.stretchDraft.cloud !== cloud) cloudSwitch().click();
    await tick();
    if (engine === 'wsola' && !state.stretchDraft.wsola.preserveTransients) {
      [...document.querySelectorAll('#extEngine .switch')].find((x) => /preserve/.test(x.textContent)).click();
      await tick();
    }
    await frames();
    // Written back into the objects the tray's rows hold, not replaced.
    const keep = () => ({ s: clone(state.stretchDraft), g: clone(state.grainDraft) });
    const put = (o) => {
      const d = state.stretchDraft;
      for (const k of ['vocoder', 'wsola', 'pvsola', 'hybrid']) Object.assign(d[k], o.s[k]);
      for (const k of ['ratio', 'semitones', 'windowMs', 'quality', 'algorithm', 'cloud', 'cloudMix']) d[k] = o.s[k];
      Object.assign(state.grainDraft, o.g);
    };
    const rows = [...document.querySelectorAll('#grainControls [data-glyph]')].filter((r) => !r.classList.contains('hidden') && !r.closest('.hidden'));
    const out = { engine, cloud, rows: rows.length, missing: [], diffs: [], unreachable: [] };
    const shown = new Set([...document.querySelectorAll('#grainView .gs-bc[data-k]')].filter((e) => e.getClientRects().length).map((e) => e.dataset.k));
    // The commit: a preview still waiting in its throttle can land after it.
    const last = () => [...window.__bodies].reverse().find((b) => b.quality !== 'draft');
    for (const row of rows) {
      const k = row.dataset.glyph;
      if (k === 'seed') continue;
      if (!shown.has(k)) { out.missing.push(k); continue; }
      const c = GS_C[k];
      const was = keep();
      window.__bodies.length = 0;
      const input = row.querySelector('input[type=range]'), sw = row.querySelector('.switch'), segs = [...row.querySelectorAll('.seg-btn')];
      // Pressed on the tray's own control, at a place away from its default.
      if (sw) sw.click();
      else if (segs.length) segs[segs.findIndex((b) => !b.classList.contains('active'))].click();
      else {
        const lo = +input.min, hi = +input.max, st = +input.step || 1;
        input.value = String(lo + Math.round((hi - lo) * 0.37 / st) * st);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await tick();
      const fromTray = clone(last());
      const v = gsRead(k);
      put(was);
      // The same value, by the page.
      window.__bodies.length = 0;
      GS.lastPreview = -1000;
      if (c.sw || c.seg) gsUser(k, v);
      else {
        gsSetV(k, v);
        // And the bar has to be able to land there.
        const back = gsFromN(c, gsToN(c, v)), st = typeof c.step === 'function' ? c.step() : (c.step || 0);
        if (Math.abs(back - v) > Math.max(st, Math.abs(v) * 0.01, c.odd ? 2 : 0)) out.unreachable.push(`${k}: ${v} comes back as ${back}`);
        gsCommit(c);
      }
      await tick();
      out.diffs.push([k, fromTray, clone(last())]);
      put(was);
      // The tray's own record of a switch or a choice goes back with it.
      if (sw) sw.click();
      await tick();
      put(was);
    }
    return out;
  }, { engine, cloud });
}

for (const engine of ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular']) {
  for (const cloud of engine === 'granular' ? [false] : [false, true]) {
    test(`${engine}, cloud ${cloud ? 'on' : 'off'}: every tray control is here and sends the same request`, async ({ page }) => {
      test.setTimeout(60_000);
      await openPage(page);
      await holdEdits(page);
      const r = await compareAll(page, engine, cloud);
      expect(r.rows, 'the tray built its rows').toBeGreaterThan(25);
      expect(r.missing, 'on the tray and not on the page').toEqual([]);
      expect(r.unreachable, 'where the bar cannot land').toEqual([]);
      for (const [k, a, b] of r.diffs) {
        expect(a, `${k}: the tray sent nothing`).toBeTruthy();
        expect(sameBody(a, b), k).toBeNull();
      }
    });
  }
}

test('a moving control previews by the same route as the tray', async ({ page }) => {
  await openPage(page);
  await holdEdits(page);
  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const out = [];
    const cases = [['windowMs', 'stretchRows'], ['positionJitterMs', 'grainRows']];
    for (const [k, where] of cases) {
      const input = state[where][k].querySelector('input');
      window.__bodies.length = 0;
      input.value = String(+input.min + (+input.max - +input.min) * 0.3);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(130);
      const a = clone(window.__bodies.at(-1));
      window.__bodies.length = 0;
      const c = GS_C[k];
      gsSetV(k, gsRead(k));
      gsSend(c, true);
      await wait(130);
      out.push([k, a, clone(window.__bodies.at(-1))]);
    }
    return out;
  });
  for (const [k, a, b] of result) {
    expect(a.quality, k).toBe('draft');
    expect(sameBody(a, b), k).toBeNull();
  }
});

test('everything round the controls is on the page too', async ({ page }) => {
  await openPage(page);
  for (const id of [
    'gsTuneBtn', 'gsKeysBtn', 'gsLength', 'gsCloudRo', 'gsCpPb', 'gsPb', 'gsAB', 'gsRndBtn',
    'gsCzOut', 'gsCzIn', 'gsCzFit', 'gsFollow', 'gsFollowMode',
    'gsLoadM', 'gsMaster', 'gsMeta', 'gsEngReset', 'gsReroll', 'gsSeedRo', 'gsLoopChip', 'gsRegChip', 'gsSndPick',
  ]) await expect(page.locator(`#${id}`), id).toBeVisible();
  // The transport is the Now Playing bar's, above the page (docs/EDIT-PAGE.md).
  for (const id of ['playBtn', 'stopBtn', 'loopBtn', 'recBtn', 'srcGrain', 'srcSeq', 'timeNow']) {
    await expect(page.locator(`#nowBar #${id}`), id).toBeVisible();
  }
  // The list keeps the tray's with sound and Manage… in its footer.
  await pbOpenList(page, 'gs');
  for (const id of ['gsPresetSound', 'gsPresetManage']) await expect(page.locator(`#${id}`), id).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pbar-pop')).toHaveCount(0);
  await expect(page.locator('#gsLength')).toHaveText(/\d+\.\d\ds → \d+\.\d\ds/);
  await expect(page.locator('#gsMeta')).toContainText('Hz');
});

test('Keys ⧉ is the Keys window, and it shows the octave the keys are on', async ({ page }) => {
  await openPage(page);
  await page.click('#gsKeysBtn');
  await expect(page.locator('#keyboardModal')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.locator('#kbOctave')).toHaveText('octave +1');
  await page.keyboard.press('z');
  await page.click('#gsKeysBtn');
  await expect(page.locator('#keyboardModal')).toBeHidden();
});

test('Reset is the tray\'s: the same request as its button', async ({ page }) => {
  await openPage(page);
  await holdEdits(page);
  const [a, b] = await page.evaluate(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    gsSetV('searchMs', 77); gsSetV('scan', 0.5);
    await resetExtended(); await tick();
    const one = JSON.parse(JSON.stringify(window.__bodies.at(-1)));
    gsSetV('searchMs', 77); gsSetV('scan', 0.5);
    $('gsEngReset').click(); await tick(); await tick();
    return [one, JSON.parse(JSON.stringify(window.__bodies.at(-1)))];
  });
  expect(sameBody(a, b)).toBeNull();
  expect(b.grain.scan, 'the tray resets the grain\'s extended controls as well').toBe(1);
  expect(b.wsola.searchMs).toBe(10);
});

test('Randomize is the tray\'s Random, and reports its seed', async ({ page }) => {
  await openPage(page);
  await holdEdits(page);
  const calls = await page.evaluate(async () => {
    const real = randomizeStretch;
    let n = 0;
    window.randomizeStretch = (...x) => { n++; return real(...x); };
    const engine = state.stretchDraft.algorithm, ratio = state.stretchDraft.ratio;
    $('gsRndBtn').click();
    await new Promise((r) => setTimeout(r, 50));
    window.randomizeStretch = real;
    return { n, sameEngine: engine === state.stretchDraft.algorithm, moved: ratio !== state.stretchDraft.ratio, edits: window.__bodies.length, toast: $('toast')?.textContent || '' };
  });
  expect(calls.n).toBe(1);
  expect(calls.sameEngine).toBe(true);
  expect(calls.moved, 'Stretch is thrown as well, as the tray\'s were').toBe(true);
  expect(calls.edits).toBeGreaterThan(0);
  expect(calls.toast).toMatch(/Randomised — seed \d+/);
  await expect(page.locator('#gsRndUndo')).toBeVisible();
});

async function barWell(page, k) {
  const box = await page.locator(`#grainView .gs-bc[data-k="${k}"] .gs-bw`).first().boundingBox();
  return box;
}

test('Overlap can be moved whatever Density is doing, as it could on the tray', async ({ page }) => {
  await openPage(page);
  await holdEdits(page);
  await page.evaluate(() => { gsSetV('densityHz', 100); gsApplyDims(); });
  await page.waitForTimeout(50);
  await expect(page.locator('#grainView .gs-bc[data-k="overlap"]').first()).not.toHaveClass(/dim/);
  const box = await barWell(page, 'overlap');
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => gsRead('overlap'))).toBeGreaterThan(4);
});

test('a touched bar takes the arrow keys, one step of the tray\'s at a time', async ({ page }) => {
  await openPage(page);
  await holdEdits(page);
  const box = await barWell(page, 'overlap');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.waitForTimeout(150);
  const a = await page.evaluate(() => gsRead('overlap'));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => gsRead('overlap'))).toBeCloseTo(a + 0.1, 3);
  await expect.poll(() => page.evaluate(() => window.__bodies.at(-1).quality)).toBe('standard');
});

test('a stroke begun between the bars paints each one it crosses', async ({ page }) => {
  await openPage(page);
  await holdEdits(page);
  const [a, b] = [await barWell(page, 'sizeJitter'), await barWell(page, 'sizeRange')];
  const before = await page.evaluate(() => [gsRead('sizeJitter'), gsRead('sizeRange')]);
  // From the panel's margin at the column's left, across the two bars.
  await page.mouse.move(a.x + 40, a.y - 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * 0.6, a.y + a.height / 2, { steps: 4 });
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => [gsRead('sizeJitter'), gsRead('sizeRange')]);
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).not.toBe(before[1]);
});

test('the detail answers a press, cloud or no cloud, as the pad did', async ({ page }) => {
  await openPage(page);
  await holdEdits(page);
  expect(await page.evaluate(() => gsCloudActive())).toBe(false);
  const box = await page.locator('#gsCloud').boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
  await page.waitForTimeout(200);
  const [spray, pj] = await page.evaluate(() => [gsRead('positionJitterMs'), gsRead('pitchJitterSemis')]);
  expect(spray).toBeGreaterThan(0);
  expect(pj).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__bodies.at(-1)?.quality)).toBe('standard');
});

test('⌥-drag scrubs and leaves Start alone; a region\'s strip selects it', async ({ page }) => {
  await openPage(page);
  await page.evaluate(() => {
    const f = gsFile();
    state.annotations = { markers: [{ frame: Math.round(f.frames * 0.2), label: 'mk' }], regions: [{ start: Math.round(f.frames * 0.4), end: Math.round(f.frames * 0.7), label: 'reg' }] };
    engine.path = state.selectedFile.path;
  });
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/engine/transport')) posts.push(r.postDataJSON()); });
  const box = await page.locator('#gsSrcPic').boundingBox();
  const s = await page.evaluate(() => GS.scale);
  const cue = await page.evaluate(() => state.cue);
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width * 0.5, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 30, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(120);
  expect(posts.filter((p) => p.seek != null).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => state.cue)).toBe(cue);
  expect(await page.evaluate(() => state.sel)).toBeNull();

  // The strip along the bottom of the wave.
  const y = box.y + (84 - 13 - 4) * s;
  await page.mouse.click(box.x + box.width * 0.55, y);
  await page.waitForTimeout(100);
  const sel = await page.evaluate(() => [state.sel?.start, state.sel?.end, Math.round(gsFile().frames * 0.4), Math.round(gsFile().frames * 0.7)]);
  expect(sel[0]).toBe(sel[2]);
  expect(sel[1]).toBe(sel[3]);
  await page.evaluate(() => { state.sel = null; state.annotations = { markers: [], regions: [] }; drawSelection(); applyLoop(); });
});

test('CLOUD presets are the tray\'s: saved, recalled and deleted from the page', async ({ page }) => {
  await openPage(page);
  const names = () => page.evaluate(() => [...$('gpPick').options].map((o) => o.value));
  await pbSaveAs(page, 'gsCp', 'parity cloud');
  await expect.poll(names).toContain('parity cloud');
  await expect.poll(() => pbName(page, 'gsCp')).toBe('parity cloud');
  await page.evaluate(() => gsSetV('scan', 0.5));
  await pbPick(page, 'gsCp', 'parity cloud');
  await expect.poll(() => page.evaluate(() => gsRead('scan'))).toBe(1);
  expect(await page.evaluate(() => $('gpPick').value)).toBe('parity cloud');
  await pbDelete(page, 'gsCp');
  await expect.poll(names).not.toContain('parity cloud');
});

test('the readings are the tray\'s words', async ({ page }) => {
  await openPage(page);
  const read = (k) => page.locator(`#grainView .gs-bc[data-k="${k}"] .gs-bv`).first();
  await holdEdits(page);
  await page.evaluate(() => { gsSetV('fbSmear', 0); gsSetV('fbDamp', 0); gsSetV('layerScatterMs', 1500); gsSetV('ratio', 0.5); gsSetV('scan', -0.5); });
  await expect(read('fbSmear')).toHaveText('clear');
  await expect(read('fbDamp')).toHaveText('bright');
  await expect(read('layerScatterMs')).toHaveText('1.50 s');
  await expect(read('ratio')).toHaveText('0.500×');
  await expect(read('scan')).toHaveText('-0.50×');
});

test('no bar\'s name and reading run into each other, at either end of its range', async ({ page }) => {
  test.setTimeout(45_000);
  await openPage(page);
  await holdEdits(page);
  const bad = await page.evaluate(async () => {
    const out = [];
    for (const e of ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular']) {
      document.querySelector(`#stretchEngine .seg-btn[data-alg="${e}"]`).click();
      gsApplyEngine();
      for (const el of document.querySelectorAll('#grainView .gs-bc[data-k]')) {
        const c = GS_C[el.dataset.k];
        if (c.sw || c.seg || !el.getClientRects().length) continue;
        const was = gsRead(c.k);
        for (const v of [c.min, c.max, (c.min + c.max) / 2.3]) {
          gsSetV(c.k, v);
          const w = el.querySelector('.gs-bw'), n = el.querySelector('.gs-bn'), b = el.querySelector('.gs-bv');
          if (n.getBoundingClientRect().right > b.getBoundingClientRect().left || w.scrollWidth > w.clientWidth) out.push(`${e} ${c.k} at ${v}: "${n.textContent}" "${b.textContent}"`);
        }
        gsSetV(c.k, was);
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('Follow keeps the head in a zoomed detail, scrolling or by the page', async ({ page }) => {
  await openPage(page);
  const r = await page.evaluate(() => {
    const realHead = gsHead, was = [engine.playing, state.follow.on, state.follow.mode];
    engine.playing = true;
    state.follow.on = true;
    window.gsHead = () => 0.7;
    const out = {};
    for (const mode of ['page', 'scroll']) {
      state.follow.mode = mode;
      GS.czA = 0; GS.czB = 0.2;
      gsFollowTick();
      out[mode] = GS.czA <= 0.7 && 0.7 < GS.czB;
    }
    window.gsHead = realHead;
    [engine.playing, state.follow.on, state.follow.mode] = was;
    GS.czA = GS.czB = 0;
    return out;
  });
  expect(r).toEqual({ page: true, scroll: true });
});
