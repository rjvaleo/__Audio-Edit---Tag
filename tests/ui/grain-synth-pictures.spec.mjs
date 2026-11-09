// The Grain v12 page's pictures: at the head, the time map, each engine's
// close-up, the marks on the detail, before and after the chain.
//
// A test must not open a sound card, so what the engine says while something is
// sounding is answered here, on the real routes the page polls. The samples are
// real: `/audio?dry=1`, decoded by the page.

import { test, expect } from './test.mjs';

test.use({ viewport: { width: 1440, height: 900 } });

const ENGINES = ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular'];

async function openPage(page, { flag = true } = {}) {
  await page.route(/\/api\/engine\/(note|voice|transport)$/, (r) => r.fulfill({ json: { ok: true, voice: 1 } }));
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
  if (flag) await page.waitForFunction(() => document.querySelector('#gsEngTabs .gs-tab.on') && state.overview && GS_PIC.pcm, null, { timeout: 20_000 });
  else await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, null, { timeout: 20_000 });
}

async function pick(page, e) {
  await page.click(`#gsEngTabs .gs-tab[data-e="${e}"]`);
  await page.waitForFunction((x) => GS.engine === x, e);
  await page.waitForTimeout(250);
}

/// How much of a canvas has anything on it, 0 to 1.
const ink = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i), d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
  let n = 0;
  for (let k = 3; k < d.length; k += 4) if (d[k]) n++;
  return n / (d.length / 4);
}, id);

const drawn = (page) => page.evaluate(() => ({ ...GS_PIC.drawn }));
const errors = (page) => {
  const list = [];
  page.on('pageerror', (e) => list.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) list.push(m.text()); });
  return list;
};

/// The engine, sounding: a held note whose head runs, and real-shaped grains.
async function soundingEngine(page) {
  const s = { head: 4800, sounding: true, ons: 1, asked: 0, heads: [] };
  await page.route(/\/api\/engine\/grains$/, (r) => {
    s.asked++;
    s.head += 2400;
    const t = s.head / 48000;
    r.fulfill({ json: {
      position: 0, ratio: 1, sampleRate: 48000, playing: false, latency: 0, grains: s.sounding ? [
        { t: t - 0.03, src: 0.2, size: 0.04, rate: 1, semis: 0 }, { t, src: 0.25, size: 0.04, rate: 1, semis: 12 },
      ] : [], spectrum: s.sounding ? [200, 180, 120] : [], waveform: s.sounding ? [90, -90, 40] : [],
      rackLevels: s.sounding ? [[0.5, 0.5], [0.4, 0.4], [0.3, 0.3]] : [[0, 0], [0, 0], [0, 0]], rackTelemetry: [],
      load: { now: 0.5, mean: 0.5, worst: 0.7, late: 0, layerCap: 64, shedding: false, layersRunning: 2 },
      keys: { head: s.head, sounding: s.sounding, noteOns: s.ons, pitch: 12 },
      heads: s.heads,
    } });
  });
  return s;
}

function master(withPre) {
  const lis = Array.from({ length: 400 }, (_, i) => Math.sin(i / 9) * 0.3);
  const chan = { rmsDb: -12, peakDb: -6, vuDb: -12, truePeakDb: -6 };
  const body = { live: true, rate: 48000, frames: 4096, left: chan, right: chan, correlation: 1, spectrum: Array.from({ length: 64 }, (_, i) => -20 - i / 2), lissajous: lis };
  return withPre ? { ...body, pre: { spectrum: Array.from({ length: 64 }, (_, i) => -30 - i / 3), lissajous: lis.map((v) => v * 0.5) } } : body;
}

test('each engine shows its own pictures, in what the controls leave', async ({ page }) => {
  const errs = errors(page);
  await openPage(page);
  for (const e of ENGINES) {
    await pick(page, e);
    const got = await page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect(), panel = box(gsEngPanel), well = box(gsLensWell), sects = box(gsESects);
      return {
        row: gsHeadRow.style.display !== 'none', lens: gsLensWell.style.display !== 'none', h: GS_CV.gsLens.h,
        over: gsEngPanel.scrollHeight - gsEngPanel.clientHeight,
        inside: well.bottom <= panel.bottom + 0.5 && well.right <= panel.right + 0.5,
        below: well.top >= sects.bottom - 0.5,
        label: gsLensLabel(),
      };
    });
    expect(got.lens, `${e} lost its close-up`).toBe(true);
    expect(got.over, `${e} overflows`).toBe(0);
    expect(got.inside, `${e}'s close-up leaves the panel`).toBe(true);
    expect(got.below, `${e}'s close-up sits on its controls`).toBe(true);
    expect(got.row, `${e} at-the-head row`).toBe(e === 'granular');
    expect(got.h).toBeGreaterThanOrEqual(e === 'hybrid' ? 38 : 120);
    expect(got.label).toMatch({ wsola: /SPLICE/, vocoder: /FRAME/, pvsola: /re-anchored/, hybrid: /SEPARATION/, granular: /GRAIN SCHEDULE/ }[e]);
    expect(await ink(page, 'gsLens'), `${e}'s close-up is blank`).toBeGreaterThan(0.01);
    if (e === 'granular') {
      expect(await ink(page, 'gsHeadPic')).toBeGreaterThan(0.01);
      expect(await ink(page, 'gsMapPic')).toBeGreaterThan(0.01);
    }
  }
  expect(errs).toEqual([]);
});

test('the samples are asked for once, dry, and match the file', async ({ page }) => {
  const asked = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/audio') asked.push(r.url()); });
  await openPage(page);
  for (const e of ENGINES) await pick(page, e);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('dry=1');
  const got = await page.evaluate(() => ({ n: GS_PIC.pcm.data.length, frames: gsFile().frames, sr: GS_PIC.pcm.sr, fr: gsFile().sr, peak: GS_PIC.pcm.peak }));
  expect(got.n).toBe(got.frames);
  expect(got.sr).toBe(got.fr);
  expect(got.peak).toBeGreaterThan(0.2);
});

test('the marks on the detail come from the samples', async ({ page }) => {
  await openPage(page);
  await pick(page, 'wsola');
  const got = await page.evaluate(() => {
    // Quiet noise with three real clicks, at the sound's own length.
    const f = gsFile(), d = new Float32Array(f.frames);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() - 0.5) * 0.004;
    for (const at of [0.2, 0.5, 0.8]) for (let i = 0; i < 400; i++) d[Math.floor(at * f.sr) + i] = 0.8 * (1 - i / 400);
    gsPicTake(d, f.sr);
    const src = gsPicOnsets();
    return { n: src.on.filter((o) => o.s > 0.5).length, at: src.on.filter((o) => o.s > 0.5).map((o) => +o.t.toFixed(2)), k: src.k };
  });
  expect(got.n).toBe(3);
  expect(got.k).toBe(1.4);
  for (const [i, want] of [0.2, 0.5, 0.8].entries()) expect(Math.abs(got.at[i] - want)).toBeLessThan(0.03);
});

test('a held note on a stopped transport keeps the one poll going, and its head draws', async ({ page }) => {
  const errs = errors(page);
  const s = await soundingEngine(page);
  await openPage(page);
  await pick(page, 'granular');
  await page.evaluate(() => { gsNoteOn(60, 0.8); });
  await page.waitForFunction(() => GS_PIC.keys?.sounding && GS_PIC.ev.length > 0, null, { timeout: 5000 });
  const before = await drawn(page), asked = s.asked;
  await page.waitForTimeout(1000);
  const after = await drawn(page);
  // Twenty polls a second, from the one timer: a second reader would double it.
  expect(s.asked - asked).toBeLessThanOrEqual(24);
  expect(s.asked - asked).toBeGreaterThan(5);
  expect(after.lens - before.lens, 'the schedule stopped drawing').toBeGreaterThan(10);
  expect(after.head - before.head).toBeGreaterThan(10);
  expect(after.map - before.map).toBeGreaterThan(10);
  const live = await page.evaluate(() => {
    const { a, b } = gsLoop(), h = gsNoteHead();
    return { h, a, b, playing: engine.playing, label: gsLensLabel(), key: GS_PIC.key };
  });
  expect(live.playing).toBe(false);
  expect(live.h).toBeGreaterThanOrEqual(live.a);
  expect(live.h).toBeLessThanOrEqual(live.b);
  expect(live.label).toContain('last 2 s');
  expect(live.key).toBe(60);
  expect(await ink(page, 'gsLens')).toBeGreaterThan(0.005);
  // Let go: while AMP is open it still draws; when the engine says silent the
  // poll stops, and the picture goes still.
  await page.evaluate(() => { gsNoteOff(60); });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => pollTimer != null)).toBe(true);
  s.sounding = false;
  await page.waitForFunction(() => pollTimer == null, null, { timeout: 3000 });
  await page.waitForTimeout(100);
  const still = await drawn(page);
  await page.waitForTimeout(300);
  expect(await drawn(page)).toEqual(still);
  expect(errs).toEqual([]);
});

test('a still page does not redraw, and a closed drawing stops its work', async ({ page }) => {
  const errs = errors(page);
  await openPage(page);
  await pick(page, 'granular');
  await page.waitForTimeout(200);
  const a = await drawn(page);
  await page.waitForTimeout(400);
  expect(await drawn(page), 'still, and redrawing').toEqual(a);
  // A control that shows in the picture draws it once more.
  await page.evaluate(() => gsSetV('scan', 0.5));
  await page.waitForTimeout(150);
  expect((await drawn(page)).lens).toBeGreaterThan(a.lens);
  // WSOLA has no room for the row: nothing draws it.
  await pick(page, 'wsola');
  const b = await drawn(page);
  await page.evaluate(() => gsSetV('semitones', 3));
  await page.waitForTimeout(150);
  const c = await drawn(page);
  expect(c.head).toBe(b.head);
  expect(c.map).toBe(b.map);
  // Behind the effects page nothing here draws.
  await page.evaluate(() => gsFxSetView('fx'));
  await page.waitForTimeout(100);
  const d = await drawn(page);
  await page.evaluate(() => gsSetV('semitones', 5));
  await page.waitForTimeout(250);
  expect(await drawn(page)).toEqual(d);
  await page.evaluate(() => gsFxSetView('eng'));
  // Off the page: no drawing, no poll, no wish for one.
  await page.evaluate(() => setMode('library'));
  await page.waitForTimeout(100);
  const e = await drawn(page);
  await page.waitForTimeout(250);
  expect(await drawn(page)).toEqual(e);
  expect(await page.evaluate(() => [gsPollWanted(), pollTimer == null])).toEqual([false, true]);
  expect(errs).toEqual([]);
});

test('an engine chosen behind the effects page has its pictures on the way back', async ({ page }) => {
  await openPage(page);
  await pick(page, 'granular');
  await page.evaluate(() => { gsFxSetView('fx'); state.stretchDraft.algorithm = 'vocoder'; });
  await page.waitForFunction(() => GS.engine === 'vocoder');
  await page.waitForTimeout(100);
  await page.evaluate(() => gsFxSetView('eng'));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => [gsLensWell.style.display !== 'none', gsHeadRow.style.display === 'none'])).toEqual([true, true]);
  expect(await ink(page, 'gsLens')).toBeGreaterThan(0.01);
});

test('the effects page draws before and after, and asks for before only while open', async ({ page }) => {
  const errs = errors(page);
  const urls = [];
  await soundingEngine(page);
  await page.route(/\/api\/engine\/master/, (r) => {
    urls.push(r.request().url());
    r.fulfill({ json: master(r.request().url().includes('pre=1')) });
  });
  await openPage(page);
  await page.evaluate(() => { gsNoteOn(60, 0.8); });
  await page.waitForFunction(() => !!GS.master, null, { timeout: 5000 });
  expect(urls.some((u) => u.includes('pre=1')), 'asked for the ring with the page shut').toBe(false);
  await page.evaluate(() => gsFxSetView('fx'));
  await page.waitForFunction(() => !!GS.master?.pre, null, { timeout: 5000 });
  expect(urls.some((u) => u.includes('pre=1'))).toBe(true);
  await page.waitForTimeout(100);
  expect(await ink(page, 'gsFxOut')).toBeGreaterThan(0.02);
  expect(await ink(page, 'gsFxSpec')).toBeGreaterThan(0.02);
  await page.evaluate(() => gsFxSetView('eng'));
  await page.evaluate(() => { gsNoteOff(60); });
  expect(errs).toEqual([]);
});

test('with the transport stopped, a held note moves every meter, and they fall after it', async ({ page }) => {
  const errs = errors(page);
  const s = await soundingEngine(page);
  await page.route(/\/api\/engine\/master/, (r) => r.fulfill({ json: s.sounding ? master(r.request().url().includes('pre=1')) : { live: false } }));
  await openPage(page);
  await page.evaluate(() => { gsSetV('layers', 3); });
  // How much light a canvas is giving off.
  const lit = (id) => page.evaluate((i) => {
    const el = document.getElementById(i), d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let k = 0; k < d.length; k += 4) n += (d[k] + d[k + 1] + d[k + 2]) * d[k + 3] / 255;
    return n;
  }, id);
  await page.waitForTimeout(150);
  const rest = { load: await lit('gsLoadM'), vu: await lit('gsMaster'), out: await lit('gsOutWave') };
  await page.evaluate(() => { gsNoteOn(60, 0.8); });
  await page.waitForFunction(() => !!GS.master && !!engine.load, null, { timeout: 5000 });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => engine.playing)).toBe(false);
  await expect(page.locator('#gsHead')).toHaveClass(/live/);
  await expect(page.locator('#gsVoicesRo')).toHaveText('2/3 layers · 1 voice');
  expect(await lit('gsLoadM'), 'the load meter is flat').toBeGreaterThan(rest.load * 1.5);
  expect(await lit('gsMaster'), 'the VU meter is flat').toBeGreaterThan(rest.vu * 1.5);
  expect(await lit('gsOutWave'), 'the OUT wave is flat').toBeGreaterThan(rest.out * 1.5);
  const eng = await page.evaluate(() => ({ s: engine.spectrum, w: engine.waveform }));
  expect(eng).toEqual({ s: [200, 180, 120], w: [90, -90, 40] });
  await page.evaluate(() => gsFxSetView('fx'));
  await page.waitForTimeout(250);
  const vu = () => page.evaluate(() => {
    const el = document.querySelector('#gsFxRow .fx-module .fx-vu-in .vu-left');
    return el ? parseFloat(el.style.getPropertyValue('--vu')) : null;
  });
  expect(await vu(), 'the effect meters are flat').toBeGreaterThan(0);
  expect(await lit('gsFxMeters')).toBeGreaterThan(0);
  expect(await page.evaluate(() => !!GS.master?.pre)).toBe(true);
  await page.evaluate(() => { gsNoteOff(60); });
  s.sounding = false;
  await page.waitForFunction(() => pollTimer == null, null, { timeout: 3000 });
  await page.waitForTimeout(300);
  await expect(page.locator('#gsHead')).not.toHaveClass(/live/);
  await expect(page.locator('#gsVoicesRo')).toHaveText('3 layers · 0 voices');
  expect(await page.evaluate(() => [GS.master, engine.spectrum, engine.waveform])).toEqual([null, null, null]);
  expect(await vu()).toBe(0);
  await page.evaluate(() => gsFxSetView('eng'));
  await page.waitForTimeout(150);
  expect(await lit('gsLoadM')).toBeLessThan(rest.load * 1.2);
  expect(await lit('gsMaster')).toBeLessThan(rest.vu * 1.2);
  expect(errs).toEqual([]);
});

test('stopped, the effects page shows the loop as before and no after', async ({ page }) => {
  await openPage(page);
  await page.evaluate(() => gsFxSetView('fx'));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => GS.master)).toBeNull();
  expect(await ink(page, 'gsFxOut')).toBeGreaterThan(0.01);
});

test('in Poly each note draws its own head, in its colour, and the labels step down', async ({ page }) => {
  const errs = errors(page);
  const s = await soundingEngine(page);
  await openPage(page);
  s.heads = [
    { key: 60, voice: 5, src: 0.2, env: 0.9 },
    { key: 67, voice: 6, src: 0.205, env: 0.7 },
    { key: 72, voice: 7, src: 0.6, env: 0.4 },
  ];
  await page.evaluate(() => {
    GS.voice.mode = 'poly';
    gsMarkVoice();
    window.__labels = [];
    const was = gsLbl;
    gsLbl = (c, tx, x, y, col, ...rest) => {
      if (/^[A-G]#?\d$/.test(tx)) window.__labels.push([tx, Math.round(x), Math.round(y), col]);
      return was(c, tx, x, y, col, ...rest);
    };
    gsNoteOn(60, 0.8);
  });
  await page.waitForFunction(() => GS_PIC.heads.length === 3, null, { timeout: 5000 });
  await expect(page.locator('#gsVoicesRo')).toContainText('3 voices');
  await page.waitForFunction(() => window.__labels.length >= 3, null, { timeout: 5000 });
  const got = await page.evaluate(() => {
    const seen = {};
    for (const [t, x, y, col] of window.__labels) (seen[t] ||= []).push({ x, y, col });
    return seen;
  });
  expect(Object.keys(got).sort()).toEqual(['C4', 'C5', 'G4']);
  // Each in its own colour, as the mock-up draws them.
  expect(got.C4[0].col).toContain('hsla(');
  expect(got.C4[0].col).not.toEqual(got.G4[0].col);
  // Two close together: the second steps down a row.
  const [a, b] = [got.C4[0], got.G4[0]];
  expect(Math.abs(a.x - b.x)).toBeLessThan(34);
  expect(a.y).not.toBe(b.y);
  expect(got.C5[0].y).toBe(Math.min(a.y, b.y));
  await page.evaluate(() => { gsNoteOff(60); });
  s.heads = [];
  s.sounding = false;
  await page.waitForFunction(() => GS_PIC.heads.length === 0, null, { timeout: 5000 });
  await expect(page.locator('#gsVoicesRo')).toContainText('0 voices');
  expect(errs).toEqual([]);
});

test('with the switch off, none of it runs', async ({ page }) => {
  const asked = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/audio') asked.push(r.url()); });
  await openPage(page, { flag: false });
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => ({ showing: GS.showing, wanted: gsPollWanted(), pcm: GS_PIC.pcm, want: GS_PIC.want, drawn: GS_PIC.drawn }));
  expect(got).toEqual({ showing: false, wanted: false, pcm: null, want: '', drawn: { head: 0, map: 0, lens: 0 } });
  expect(asked.filter((u) => u.includes('dry=1'))).toEqual([]);
});
