// Analytics: how the app is used, recorded on this machine and shown in
// View › Analytics. See `docs/ANALYTICS.md`.
//
// What this pins: a drag is one event, not hundreds; pages, dock tabs,
// clicks, shortcuts, effects and edits are all recorded; the pointer is kept as
// a coarse grid per page; batches reach the server's file; the tab draws real
// data, including the controls never touched and a date filter; recording
// costs next to nothing; and no request goes anywhere but this machine.

import { test, expect } from './test.mjs';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0 && window.analytics,
    { timeout: 15_000 },
  );
}

async function openFirstSound(page) {
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, { timeout: 20_000 });
}

/// Send what the page is holding and read back what this page's session
/// stored. A page closed by the previous test may still be sending its last
/// batch, so other sessions are left out unless asked for.
async function stored(page, { all = false } = {}) {
  return page.evaluate(async (all) => {
    await analytics.flush();
    const r = await fetch('/api/analytics?from=0');
    const body = await r.json();
    if (!all) body.events = body.events.filter((e) => e.s === analytics.state.session);
    return body;
  }, all);
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/analytics/clear');
});

test('the server stores a batch by time, reads a range back and clears it', async ({ request }) => {
  const t = Date.now();
  const put = await request.post('/api/analytics', { data: [{ t, k: 'mode', m: 'edit' }, { t: t - 86_400_000 * 40, k: 'old' }, { k: 'no time' }] });
  expect((await put.json()).kept).toBe(2);
  const recent = await (await request.get(`/api/analytics?from=${t - 1000}&to=${t + 1}`)).json();
  expect(recent.events.map((e) => e.k)).toEqual(['mode']);
  const all = await (await request.get('/api/analytics')).json();
  expect(all.events.length).toBe(2);
  await request.post('/api/analytics/catalogue', { data: { controls: [{ c: 'x', ck: 'knob' }] } });
  expect((await (await request.get('/api/analytics')).json()).catalogue.x.ck).toBe('knob');
  await request.post('/api/analytics/clear');
  const gone = await (await request.get('/api/analytics')).json();
  expect(gone.events).toEqual([]);
  expect(gone.catalogue).toEqual({});
});

test('a slider drag is one event with where it started, ended and reached', async ({ page }) => {
  await ready(page);
  await openFirstSound(page);
  const slider = page.locator('#dockStretch input[type="range"]:visible').first();
  const box = await slider.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  for (const f of [0.6, 0.9, 0.7, 0.2, 0.3]) {
    await page.mouse.move(box.x + box.width * f, y, { steps: 4 });
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  const { events } = await stored(page);
  const ctl = events.filter((e) => e.k === 'ctl');
  expect(ctl.length).toBe(1);
  const e = ctl[0];
  expect(e.ck).toBe('slider');
  expect(e.m).toBe('edit');
  expect(e.p).not.toBe('page');
  expect(e.n).toBeGreaterThan(1);
  expect(e.max).toBeGreaterThan(e.min);
  expect(e.min).toBeLessThanOrEqual(e.to);
  expect(typeof e.lo).toBe('number');
});

test('pages, dock tabs, clicks and shortcuts are recorded with time spent', async ({ page }) => {
  await ready(page);
  await openFirstSound(page);
  await page.waitForTimeout(150);
  await page.locator('.dock-tab[data-dock="effects"]').click();
  await page.locator('body').press('Meta+Shift+K');
  await page.locator('#zoomIn').click();
  await page.evaluate(() => setMode('overview'));
  const { events } = await stored(page);
  const mode = events.filter((e) => e.k === 'mode');
  expect(mode.map((e) => `${e.d.from}>${e.m}`)).toContain('overview>edit');
  expect(mode.find((e) => e.m === 'overview').d.dwell).toBeGreaterThan(100);
  const dock = events.find((e) => e.k === 'dock');
  expect(dock.l).toBe('effects');
  expect(dock.d.from).toBe('stretch');
  expect(events.find((e) => e.k === 'key' && e.l === 'Cmd-Shift-K')).toBeTruthy();
  const click = events.find((e) => e.k === 'click' && e.c === 'zoomIn');
  expect(click.p).toBe('transportBar');
  expect(click.dk).toBe('effects');
});

test('effects added and removed, edits and failures are recorded from the requests', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const p = 'kit/tone.wav';
    await postJSON('/api/rack', { p, sr: 44100, slots: [] });
    await postJSON('/api/rack', { p, sr: 44100, slots: [{ id: 'a', kind: 'gain', bypassed: false, db: 0 }] });
    await postJSON('/api/rack', { p, sr: 44100, slots: [] });
    await fetch('/api/edit', { method: 'POST', body: JSON.stringify({ op: 'nonsense-op' }) });
    await postJSON('/api/rack', { p, sr: 44100, slots: [] });
  });
  const { events } = await stored(page);
  expect(events.find((e) => e.k === 'fx.add')?.d.fx).toBe('gain');
  expect(events.find((e) => e.k === 'fx.remove')?.d.fx).toBe('gain');
  expect(events.find((e) => e.k === 'edit')?.d.op).toBe('nonsense-op');
  expect(events.find((e) => e.k === 'error')?.d.path).toBe('/api/edit');
});

test('the pointer is kept as a coarse grid per page, clicks apart', async ({ page }) => {
  await ready(page);
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(200 + i * 5, 300);
    await page.waitForTimeout(280);
  }
  await page.mouse.click(800, 500);
  const { events } = await stored(page);
  const m = events.filter((e) => e.k === 'mouse' && e.m === 'overview');
  expect(m.length).toBe(1);
  const d = m[0].d;
  expect(d.gw * d.gh).toBeGreaterThan(1000);
  const samples = d.move.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
  expect(samples).toBeGreaterThanOrEqual(4);
  expect(samples).toBeLessThanOrEqual(10);
  const cell = Math.floor(500 / 1000 * d.gh) * d.gw + Math.floor(800 / 1600 * d.gw);
  expect(d.click).toEqual([cell, 1]);
});

test('controls on screen go into the catalogue', async ({ page }) => {
  await ready(page);
  await openFirstSound(page);
  await page.evaluate(() => analytics.catalogue());
  await expect.poll(async () => Object.keys((await stored(page)).catalogue).length).toBeGreaterThan(30);
  const cat = (await stored(page)).catalogue;
  expect(cat.playBtn?.ck).toBe('button');
});

test('paused, nothing is recorded', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => { await analytics.flush(); anSetRecording(false); });
  await page.evaluate(() => analytics.track('click', { c: 'should-not-be-kept' }));
  await page.mouse.click(300, 300);
  const { events } = await stored(page);
  expect(events.find((e) => e.c === 'should-not-be-kept')).toBeFalsy();
  expect(events.filter((e) => e.k === 'mouse')).toEqual([]);
  await page.evaluate(() => anSetRecording(true));
});

test('recording is cheap: a thousand events cost well under a frame', async ({ page }) => {
  await ready(page);
  const ms = await page.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) analytics.track('click', { c: `bench-${i % 7}`, p: 'page' });
    const dt = performance.now() - t0;
    analytics.state.queue.length = 0;
    return dt;
  });
  expect(ms).toBeLessThan(16);
  // The pointer listener only stores a position: a burst of moves is free.
  const moves = await page.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) document.dispatchEvent(new PointerEvent('pointermove', { clientX: i % 900, clientY: 200 }));
    return performance.now() - t0;
  });
  expect(moves).toBeLessThan(100);
});

test('nothing is sent anywhere but this machine', async ({ page }) => {
  // The one thing fetched from outside is older than analytics: the display
  // fonts `app.css` imports from Google. A plain GET for a font file, carrying
  // nothing of ours, and allowed here by name only — anything else off this
  // machine, and anything at all sent with a body, fails.
  const FONTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
  const away = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (['127.0.0.1', 'localhost'].includes(u.hostname) || ['data:', 'blob:'].includes(u.protocol)) return;
    if (FONTS.includes(u.hostname) && r.method() === 'GET' && !r.postData()) return;
    away.push(`${r.method()} ${r.url()}`);
  });
  await ready(page);
  await openFirstSound(page);
  await page.mouse.move(300, 300);
  await page.locator('.dock-tab[data-dock="effects"]').click();
  await page.evaluate(() => { openAnalytics(); });
  await page.waitForSelector('#analyticsView:not(.hidden) .an-kpi');
  await stored(page);
  expect(away).toEqual([]);
});

test('the tab draws real data: controls, never touched, paths, sessions, date range, mouse', async ({ page, request }) => {
  await ready(page);
  const now = Date.now();
  const old = now - 10 * 86_400_000, recent = now - 5 * 60_000;
  const ev = [
    { t: old, s: 's-old', k: 'session', m: 'overview' },
    { t: old + 30_000, s: 's-old', k: 'mode', m: 'edit', d: { from: 'overview' } },
    { t: old + 60_000, s: 's-old', k: 'ctl', m: 'edit', dk: 'stretch', c: 'seedSlider', ck: 'slider', p: 'grainControls', l: 'Seeded slider', from: 10, to: 40, min: 5, max: 60, lo: 0, hi: 100 },
    { t: recent, s: 's-new', k: 'session', m: 'overview' },
    { t: recent + 10_000, s: 's-new', k: 'mode', m: 'edit', d: { from: 'overview' } },
    { t: recent + 20_000, s: 's-new', k: 'ctl', m: 'edit', dk: 'stretch', c: 'seedSlider', ck: 'slider', p: 'grainControls', l: 'Seeded slider', from: 40, to: 70, min: 40, max: 80, lo: 0, hi: 100 },
    { t: recent + 25_000, s: 's-new', k: 'click', m: 'edit', dk: 'stretch', c: 'seedButton', ck: 'button', p: 'transportBar', l: 'Seeded button' },
    { t: recent + 30_000, s: 's-new', k: 'mode', m: 'room', d: { from: 'edit' } },
    { t: recent + 31_000, s: 's-new', k: 'mouse', m: 'overview', d: { gw: 96, gh: 60, w: 1600, h: 1000, move: [1000, 12, 1001, 3], click: [1000, 2] } },
  ];
  await request.post('/api/analytics', { data: ev });
  await request.post('/api/analytics/catalogue', { data: { controls: [{ c: 'neverKnob', ck: 'knob', p: 'grainControls', l: 'Never knob' }, { c: 'seedSlider', ck: 'slider', p: 'grainControls', l: 'Seeded slider' }] } });

  // Opened the way a person opens it.
  // View › Analytics, in the top bar.
  await page.locator('header.menubar .menu-title', { hasText: 'View' }).click();
  await page.locator('#menuPop').getByText('Analytics', { exact: true }).click();
  const view = page.locator('#analyticsView');
  await expect(view).toBeVisible();
  await view.locator('[data-anrange="all"]').click();

  const rows = view.locator('#anCtlRows');
  await expect(rows).toContainText('Seeded slider');
  const seed = rows.locator('.an-row', { hasText: 'Seeded slider' });
  await expect(seed).toContainText('2');
  await expect(seed).toContainText('5–80');
  await seed.click();
  await expect(rows.locator('.an-detail')).toBeVisible();
  await view.locator('[data-anctl="never"]').click();
  await expect(rows).toContainText('Never knob');
  await expect(rows).not.toContainText('Seeded slider');

  await expect(view.locator('#anPaths')).toContainText('Browse → Edit');
  await expect(view.locator('#anPaths')).toContainText('Edit → Room');
  await expect(view.locator('#anPages')).toContainText('Edit');
  await expect(view.locator('#anSeqs')).toContainText('→ Edit');
  await expect(view.locator('#anKpis')).toContainText('CONTROLS TOUCHED');

  const all = await view.locator('.an-srow').count();
  expect(all).toBeGreaterThanOrEqual(2);
  await view.locator('.an-srow').last().click();
  await expect(view.locator('#anLog')).toBeVisible();
  await view.locator('[data-anrange="today"]').click();
  await expect(view.locator('.an-srow')).toHaveCount(all - 1);

  await view.locator('[data-antab="mouse"]').click();
  // The fifteen seeded, plus whatever this page's own pointer added meanwhile.
  await expect(view.locator('#anMouseNote')).toContainText('samples');
  const samples = Number((await view.locator('#anMouseNote').textContent()).match(/([\d,]+) samples/)[1].replace(/,/g, ''));
  expect(samples).toBeGreaterThanOrEqual(15);
  const lit = await page.evaluate(() => {
    const c = document.getElementById('anMouseCanvas');
    const ctx = c.getContext('2d');
    const x = Math.floor((1000 % 96 + 0.5) / 96 * c.width), y = Math.floor((Math.floor(1000 / 96) + 0.5) / 60 * c.height);
    return ctx.getImageData(x, y, 1, 1).data[0];
  });
  expect(lit).toBeGreaterThan(40);

  // Leaving puts the page back as it was.
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  const { events } = await stored(page);
  const modes = events.filter((e) => e.k === 'mode').map((e) => e.m);
  expect(modes).toEqual(['analytics', 'overview']);
});

// ----------------------------------------------------------- performance

test('the sampler writes rows of CPU and memory, and times an export', async ({ page, request }) => {
  await ready(page);
  await request.post('/api/analytics/perf/sample');
  let perf = await (await request.get('/api/analytics/perf')).json();
  const row = perf.perf[perf.perf.length - 1];
  expect(row.k).toBe('perf');
  expect(row.act).toBe('quiet');
  expect(typeof row.cpu).toBe('number');
  expect(row.rss).toBeGreaterThan(1);
  // An export, however short, is one timed row.
  await page.evaluate(async () => {
    await postJSON('/api/export', { p: 'kit/tone.wav', bits: 16 });
    for (let i = 0; i < 100 && (await api('/api/export')).running; i++) await new Promise((r) => setTimeout(r, 50));
  });
  await expect.poll(async () => (await (await request.get('/api/analytics/perf')).json()).exports.length, { timeout: 5000 }).toBe(1);
  perf = await (await request.get('/api/analytics/perf')).json();
  const x = perf.exports[0];
  expect(x.kind).toBe('mix');
  expect(x.ok).toBe(true);
  expect(x.file).toContain('tone');
  expect(x.file).not.toContain('/private');
});

test('a long frame in the interface is recorded with where it happened', async ({ page }) => {
  await ready(page);
  const supported = await page.evaluate(() => (PerformanceObserver.supportedEntryTypes || []).some((t) => t === 'long-animation-frame' || t === 'longtask'));
  test.skip(!supported, 'this browser reports no long frames');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => {
    const t = performance.now();
    while (performance.now() - t < 140) { /* hold the frame */ }
    setTimeout(done, 300);
  })));
  await expect.poll(async () => (await stored(page)).events.filter((e) => e.k === 'lof').length).toBeGreaterThan(0);
  // The longest: on a busy machine the app's own start-up can leave a shorter
  // long frame ahead of the one held here.
  const e = (await stored(page)).events.filter((x) => x.k === 'lof').sort((a, b) => b.ms - a.ms)[0];
  expect(e.ms).toBeGreaterThanOrEqual(100);
  expect(e.m).toBe('overview');
});

test('retention: settings stick, a purge rolls old days into summaries, and the tab still counts them', async ({ page, request }) => {
  await ready(page);
  const old = Date.now() - 20 * 86_400_000;
  await request.post('/api/analytics', { data: [
    { t: old, s: 's-gone', k: 'session', m: 'edit' },
    { t: old + 5_000, s: 's-gone', k: 'ctl', m: 'edit', dk: 'stretch', c: 'purgedSlider', ck: 'slider', p: 'grainControls', l: 'Purged slider', min: 1, max: 4, to: 2, lo: 0, hi: 10 },
    { t: old + 9_000, s: 's-gone', k: 'click', m: 'edit', c: 'purgedButton', ck: 'button', p: 'transportBar', l: 'Purged button' },
  ] });
  const st = await (await request.post('/api/analytics/retention', { data: { events: 7, capMB: 1 } })).json();
  expect(st.retention.events).toBe(7);
  expect(st.retention.capMB).toBe(5);   // clamped: never below 5 MB
  const report = await (await request.post('/api/analytics/purge')).json();
  expect(report.summarised).toBeGreaterThanOrEqual(1);
  const after = await (await request.get('/api/analytics')).json();
  expect(after.events.find((e) => e.s === 's-gone')).toBeFalsy();
  const day = after.daily.find((d) => d.controls?.purgedSlider);
  expect(day.controls.purgedSlider.n).toBe(1);
  expect(day.controls.purgedSlider.max).toBe(4);

  await page.evaluate(() => openAnalytics());
  const view = page.locator('#analyticsView');
  await view.locator('[data-anrange="30d"]').click();
  await expect(view.locator('#anCtlRows')).toContainText('Purged slider');
  await expect(view.locator('#anCtlRows .an-row', { hasText: 'Purged slider' })).toContainText('1–4');

  // The Storage page shows it and changes it.
  await view.locator('[data-antab="storage"]').click();
  await expect(view.locator('#anStoreTotal')).toContainText('of a 5.0 MB cap');
  await expect(view.locator('#anStoreLast')).toContainText('days summarised');
  await view.locator('select[data-ret="events"]').selectOption('90');
  await expect.poll(async () => (await (await request.get('/api/analytics/storage')).json()).retention.events).toBe(90);
  await request.post('/api/analytics/retention', { data: { capMB: 100 } });
});

test('the Performance page draws the sampler rows, the exports and the frames', async ({ page, request }) => {
  await ready(page);
  await request.post('/api/analytics/perf/sample');
  await page.evaluate(async () => {
    await postJSON('/api/export', { p: 'kit/tone.wav', bits: 16 });
    for (let i = 0; i < 100 && (await api('/api/export')).running; i++) await new Promise((r) => setTimeout(r, 50));
  });
  await expect.poll(async () => (await (await request.get('/api/analytics/perf')).json()).exports.length, { timeout: 5000 }).toBeGreaterThan(0);
  await page.evaluate(() => openAnalytics());
  const view = page.locator('#analyticsView');
  await view.locator('[data-antab="perf"]').click();
  await expect(view.locator('#anPerf')).toBeVisible();
  await expect(view.locator('#anPerfKpis')).toContainText('SERVER CPU');
  await expect(view.locator('#anPerfKpis')).toContainText('MB');
  await expect(view.locator('#anExports')).toContainText('mix');
  await expect(view.locator('#anExports')).toContainText('tone');
  await expect(view.locator('#anDoing i').first()).toBeAttached();
});

// ----------------------------------------------------------- what it costs

test('measured: one scan of the controls on screen, and a heavy month summarised', async ({ page }, info) => {
  await ready(page);
  await openFirstSound(page);
  const scan = await page.evaluate(() => {
    analytics.state.catalogued.clear();
    const t = performance.now();
    analytics.catalogue();
    return performance.now() - t;
  });
  // A month of heavy use: 150,000 events over 60 sessions.
  const sum = await page.evaluate(() => {
    const ev = [], t0 = Date.now() - 30 * 86_400_000, kinds = ['ctl', 'click', 'key', 'menu', 'dock', 'mode'];
    for (let i = 0; i < 150_000; i++) {
      const k = kinds[i % kinds.length];
      ev.push({ t: t0 + i * 1500, s: `s${Math.floor(i / 2500)}`, k, m: i % 7 ? 'edit' : 'room', dk: 'stretch', c: `c${i % 300}`, ck: 'slider', p: 'grainControls', l: `C ${i % 300}`, min: 1, max: 9, to: 5, d: k === 'mode' ? { from: 'overview' } : undefined });
    }
    const t = performance.now();
    anSummarise(ev, {}, {});
    return performance.now() - t;
  });
  info.annotations.push({ type: 'measured', description: `control scan ${scan.toFixed(1)} ms; 150k events summarised in ${sum.toFixed(0)} ms` });
  console.log(`measured: control scan ${scan.toFixed(1)} ms; 150k events summarised in ${sum.toFixed(0)} ms`);
  expect(scan).toBeLessThan(50);
  expect(sum).toBeLessThan(2000);
});
