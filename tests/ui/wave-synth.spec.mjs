// The Wave page: the wavetable synth's front end. See `docs/WAVE-SYNTH.md`.
//
// The page talks only through `/api/wave/*`, and the engine behind those routes
// opens the audio device, which the scratch server must never do — so every
// one of them is answered here, and what the page sends is recorded.
//
// What this pins:
//   - the rail opens the page, and all four views draw without a console error;
//   - a drag is sent live while it moves and once more, stored, when let go;
//   - the effect menu offers eight effects, each drawn with its icon;
//   - a computer key plays a note, and letting it go stops it;
//   - drawing a frame and processing it sends the table;
//   - nothing on the page is clipped or overflows, at two window sizes;
//   - leaving the page stops the telemetry;
//   - with no engine, the page draws its own default patch and says so;
//   - v7: the MIX row replaces the level faders and the Sub / Noise row, and its
//     power buttons are the oscillators' own;
//   - v7: each module's badges name what moves it, in the source's colour, with
//     no routes at all as well as with some;
//   - v7: the Shape row sets an LFO's shape and Hz / Sync, with the tempo beside
//     it, and dragging a standard shape makes it Drawn;
//   - v7: dragging across the keys glides, and Shift-drag holds what it crosses;
//   - v7: every control has the page's own tooltip, and no `title` is left.

import { test, expect } from './test.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UI = join(dirname(fileURLToPath(import.meta.url)), '../../ui');

/// `/wave.css` is served from the binary once `routes.rs` lists it. Until a
/// build does, it is served here from the file, so the page under test is the
/// page as written.
async function serveStylesheet(page) {
  await page.route('**/wave.css', async (route) => {
    const r = await route.fetch().catch(() => null);
    if (r && r.ok()) return route.fulfill({ response: r });
    return route.fulfill({ contentType: 'text/css', body: readFileSync(join(UI, 'wave.css'), 'utf8') });
  });
}

const sine = (k) => Array.from({ length: 256 }, (_, n) => Math.sin((2 * Math.PI * n * k) / 256));

/// The patch the stand-in engine answers with. `mods` can be replaced per test.
const PATCH = {
  params: {
    'osc0.table': 'Formant Sweep', 'osc0.pos': 0.4, 'osc0.warp0.mode': 'bend', 'osc0.warp0.amt': 0.3,
    'lfo0.shape': 'sine', 'lfo0.sync': 0, 'lfo0.rate': 0.42, tempo: 120,
  },
  mods: [{ src: 'lfo0', dst: 'osc0.pos', amt: 0.2, curve: 'lin', via: null }],
  macroNames: ['Brightness', 'Movement', 'Width', 'Grit', 'Space', 'Morph', 'Attack', 'Air'],
  name: 'Test Patch', tags: ['Pad', 'Test'],
};

/// A stand-in engine: the routes, answered, and every request kept.
async function mockEngine(page, patch = {}) {
  const sent = [];
  const counts = { state: 0 };
  await page.route(/\/api\/wave\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    sent.push({ path, method: req.method(), body, at: Date.now() });
    if (path === '/api/wave/patch' && req.method() === 'GET') {
      return route.fulfill({ json: { ...PATCH, ...patch } });
    }
    if (path === '/api/wave/table' && req.method() === 'GET') {
      const name = url.searchParams.get('name');
      return route.fulfill({ json: { name, frames: Array.from({ length: 8 }, (_, f) => sine(1 + f)) } });
    }
    if (path === '/api/wave/table' && req.method() === 'POST') {
      return route.fulfill({ json: { name: body?.name, frames: body?.frames || [] } });
    }
    if (path === '/api/wave/tables') {
      return route.fulfill({ json: [{ name: 'Formant Sweep', frames: 8 }, { name: 'Glass Organ', frames: 64 }] });
    }
    if (path === '/api/wave/presets') return route.fulfill({ json: [] });
    if (path === '/api/wave/state') {
      counts.state++;
      return route.fulfill({ json: {
        voices: [{ note: 60, vel: 0.8, env: 0.7, stage: 's' }],
        pos: [0.45, 0.2, 0.6], lfo: [0.25, 0.5, 0, 0.75],
        mod: { 'osc0.pos': 0.45 }, peak: [0.4, 0.38],
      } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return { sent, counts };
}

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
}

/// Open the page from the rail and wait until it has the engine's patch.
async function openWave(page, patch) {
  await serveStylesheet(page);
  const engine = await mockEngine(page, patch);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.locator('#leftRail .rl-item[data-mode="synth"]').click();
  await expect(page.locator('#waveView')).toBeVisible();
  await page.waitForFunction(() => WV.connected && WV.name === 'Test Patch', null, { timeout: 5_000 });
  return { ...engine, errors };
}

const posted = (sent, path) => sent.filter((s) => s.method === 'POST' && s.path === path);

/// Drag from the middle of an element by (dx, dy), in steps.
async function dragBy(page, sel, dx, dy) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test('the rail opens Wave, and every view draws with no console error', async ({ page }) => {
  const { errors } = await openWave(page);
  expect(await page.evaluate(() => [state.mode, document.body.classList.contains('synthpage')])).toEqual(['synth', true]);
  await expect(page.locator('#lane')).toBeHidden();
  await expect(page.locator('#dock')).toBeHidden();
  await expect(page.locator('#transportBar')).toBeHidden();
  await expect(page.locator('#wvOffline')).toBeHidden();
  await expect(page.locator('#wvPresetName')).toHaveText('Test Patch');
  for (const v of ['play', 'create', 'matrix', 'fx']) {
    await page.locator(`#wvViews [data-v="${v}"]`).click();
    await page.waitForTimeout(250);
    const drawn = await page.evaluate((view) => {
      const id = { play: 'wvViewPlay', create: 'wvViewCreate', matrix: 'wvViewMatrix', fx: 'wvViewFx' }[view];
      const sec = document.getElementById(id);
      const canvases = [...sec.querySelectorAll('canvas')].filter((c) => c.getBoundingClientRect().width);
      // A canvas drawn on has pixels that are not transparent.
      const inked = canvases.filter((c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 16) if (d[i]) return true;
        return false;
      });
      return { shown: getComputedStyle(sec).display !== 'none', canvases: canvases.length, inked: inked.length };
    }, v);
    expect(drawn.shown, v).toBe(true);
    expect(drawn.canvases, v).toBeGreaterThan(0);
    expect(drawn.inked, `${v}: ${drawn.canvases - drawn.inked} canvases are blank`).toBe(drawn.canvases);
  }
  expect(errors).toEqual([]);
});

test('dragging a warp knob sends it live, then once more to keep', async ({ page }) => {
  const { sent } = await openWave(page);
  await dragBy(page, '#wvWp00', 0, -40);
  await page.waitForTimeout(200);
  const moves = posted(sent, '/api/wave/param').filter((s) => s.body?.key === 'osc0.warp0.amt');
  const live = moves.filter((s) => s.body.live === true);
  const kept = moves.filter((s) => s.body.live === undefined);
  expect(live.length).toBeGreaterThan(0);
  expect(kept).toHaveLength(1);
  expect(moves.indexOf(kept[0])).toBe(moves.length - 1);
  expect(kept[0].body.value).toBeGreaterThan(0.3);
  expect(kept[0].body.value).toBeCloseTo(await page.evaluate(() => WV.p['osc0.warp0.amt']), 6);
});

test('the effect menu offers eight effects, each with its icon, and choosing one sends it', async ({ page }) => {
  const { sent } = await openWave(page);
  await page.locator('[data-ofx="0"]').click();
  const tiles = page.locator('#wvMenu .wv-wt');
  await expect(tiles).toHaveCount(8);
  const tilesRead = await page.evaluate(() => [...document.querySelectorAll('#wvMenu .wv-wt')].map((t) => {
    const c = t.querySelector('canvas');
    const dpr = c.width / 88;
    // The icon sits at the tile's left, before the wave.
    const d = c.getContext('2d').getImageData(0, 10 * dpr, 22 * dpr, 20 * dpr).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) ink++;
    return { fx: t.dataset.fx, name: t.textContent.trim(), ink };
  }));
  expect(tilesRead.map((t) => t.fx)).toEqual(['off', 'chorus', 'crush', 'drive', 'delay', 'phaser', 'ring', 'comb']);
  for (const t of tilesRead) expect(t.ink, `${t.name} has no icon`).toBeGreaterThan(10);
  await page.locator('#wvMenu .wv-wt[data-fx="ring"]').click();
  await expect(page.locator('#wvMenu')).toBeHidden();
  const choice = posted(sent, '/api/wave/param').filter((s) => s.body?.key === 'osc0.fx.mode');
  expect(choice.at(-1).body).toEqual({ key: 'osc0.fx.mode', value: 'ring' });
  await expect(page.locator('#wvOfn0')).toHaveText('Ring');
});

test('a computer key plays a note, and letting it go stops it', async ({ page }) => {
  const { sent } = await openWave(page);
  await page.keyboard.down('a');
  await page.waitForTimeout(100);
  await page.keyboard.up('a');
  await page.waitForTimeout(150);
  const notes = posted(sent, '/api/wave/note').map((s) => s.body);
  expect(notes).toHaveLength(2);
  expect(notes[0]).toMatchObject({ note: 60, on: true });
  expect(notes[0].vel).toBeGreaterThan(0);
  expect(notes[1]).toMatchObject({ note: 60, on: false });
  // W is the black key above A.
  await page.keyboard.press('w');
  await page.waitForTimeout(150);
  expect(posted(sent, '/api/wave/note').slice(2).map((s) => [s.body.note, s.body.on])).toEqual([[61, true], [61, false]]);
});

test('Create: drawing on the frame and processing it sends the table', async ({ page }) => {
  const { sent } = await openWave(page);
  await page.locator('#wvViews [data-v="create"]').click();
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => Array.from(wvEditFrames()[WV_ED.frame]));
  await dragBy(page, '#wvCWave', 120, -60);
  await page.waitForTimeout(150);
  const drawn = await page.evaluate(() => Array.from(wvEditFrames()[WV_ED.frame]));
  expect(drawn).not.toEqual(before);
  const n = posted(sent, '/api/wave/table').length;
  await page.locator('#wvOps [data-op="flip"]').click();
  await page.waitForTimeout(200);
  const tables = posted(sent, '/api/wave/table');
  expect(tables.length).toBeGreaterThan(n);
  const last = tables.at(-1).body;
  expect(last.name).toBe('Formant Sweep');
  expect(last.frames).toHaveLength(8);
  expect(last.frames.every((f) => f.length === 256)).toBe(true);
  // Flipped: the frame sent is the drawn one, upside down.
  const at = await page.evaluate(() => WV_ED.frame);
  expect(last.frames[at][10]).toBeCloseTo(-drawn[10], 3);
});

/// Everything on the page inside the centre, and inside its own panel; no text
/// box holding more than it shows.
const clipped = `(() => {
  const host = document.getElementById('waveView').getBoundingClientRect();
  const out = [];
  for (const el of document.querySelectorAll('#waveView .wv-app *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[hidden]')) continue;
    const name = el.id || String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || el.tagName;
    if (r.left < host.left - 1 || r.right > host.right + 1 || r.top < host.top - 1 || r.bottom > host.bottom + 1) out.push('off the centre: ' + name);
    const panel = el.parentElement.closest('.wv-panel, .wv-well, .wv-seg, .wv-btn');
    if (panel) {
      const p = panel.getBoundingClientRect();
      if (r.left < p.left - 1.5 || r.right > p.right + 1.5 || r.top < p.top - 1.5 || r.bottom > p.bottom + 1.5) out.push('out of its box: ' + name);
    }
    if (el.id !== 'wvMxRows' && el.clientWidth && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') out.push('overflowing: ' + name);
    if (el.id !== 'wvMxRows' && el.clientHeight && el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).display !== 'inline') out.push('overflowing down: ' + name);
  }
  return out;
})()`;

test('nothing inside the page is clipped or overflows, at two window sizes', async ({ page }) => {
  await openWave(page);
  for (const size of [{ width: 1600, height: 1000 }, { width: 1180, height: 760 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    for (const v of ['play', 'create', 'matrix', 'fx']) {
      await page.locator(`#wvViews [data-v="${v}"]`).click();
      await page.waitForTimeout(150);
      expect(await page.evaluate(clipped), `${v} at ${size.width}×${size.height}`).toEqual([]);
    }
    // The page is scaled, not cropped: its whole fixed size is inside the centre.
    const fit = await page.evaluate(() => {
      const h = $('waveView').getBoundingClientRect(), a = document.querySelector('#waveView .wv-app').getBoundingClientRect();
      return { inside: a.left >= h.left - 1 && a.right <= h.right + 1 && a.top >= h.top - 1 && a.bottom <= h.bottom + 1, scale: WV.scale };
    });
    expect(fit.inside, `${size.width}×${size.height}`).toBe(true);
    expect(fit.scale).toBeGreaterThan(0.5);
  }
});

test('every word on the page is set at a step of the app\'s type scale', async ({ page }) => {
  await openWave(page);
  const SCALE = [9, 10, 11, 13, 16];
  const off = [];
  for (const v of ['play', 'create', 'matrix', 'fx']) {
    await page.locator(`#wvViews [data-v="${v}"]`).click();
    await page.waitForTimeout(150);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('#waveView *')].flatMap((el) => {
      if (el.closest('svg, canvas, [hidden]')) return [];
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (!/[A-Za-z0-9]/.test(own) || !el.getBoundingClientRect().width) return [];
      return [{ size: parseFloat(getComputedStyle(el).fontSize), what: (el.id || el.className) + ': ' + own.slice(0, 20) }];
    }));
    for (const s of sizes) if (!SCALE.includes(s.size)) off.push(`${v} ${s.size}px ${s.what}`);
  }
  expect([...new Set(off)]).toEqual([]);
});

test('leaving the page stops the telemetry', async ({ page }) => {
  const { counts } = await openWave(page);
  await page.waitForTimeout(500);
  expect(counts.state, 'the page did not poll while showing').toBeGreaterThan(4);
  await page.locator('#leftRail .rl-item[data-mode="overview"]').click();
  await expect(page.locator('#waveView')).toBeHidden();
  await page.waitForTimeout(100);
  const after = counts.state;
  await page.waitForTimeout(700);
  expect(counts.state - after).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => [WV.showing, WV.tele])).toEqual([false, null]);
});

test('with no engine the page draws its own patch and says it is not connected', async ({ page }) => {
  await serveStylesheet(page);
  await page.route(/\/api\/wave\//, (route) => route.fulfill({ status: 404, json: { error: 'not found' } }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.locator('#leftRail .rl-item[data-mode="synth"]').click();
  await expect(page.locator('#wvOffline')).toBeVisible();
  await expect(page.locator('#wvPresetName')).toHaveText('Night Glass Pad');
  await expect(page.locator('#wvPkName0')).toHaveText('Formant Sweep');
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

// ───────────────────────────────────────────────────────────────────── v7

const params = (sent, key) => posted(sent, '/api/wave/param').filter((s) => s.body?.key === key).map((s) => s.body);

test('v7: the MIX row has five strips with power and level; the faders and the old Sub / Noise row are gone', async ({ page }) => {
  const { sent, errors } = await openWave(page);
  // Gone: the level faders beside each oscillator, and the Sub / Noise row.
  for (const sel of ['#wvLv0', '#wvLv1', '#wvLv2', '#wvSubLv', '#wvNoiseLv', '.wv-subrow', '[data-sub]', '[data-noise]']) {
    await expect(page.locator(`#waveView ${sel}`), sel).toHaveCount(0);
  }
  const strips = page.locator('#waveView .wv-mix .wv-strip');
  await expect(strips).toHaveCount(5);
  expect(await strips.locator('.wv-nm').allTextContents()).toEqual(['OSC A', 'OSC B', 'OSC C', 'SUB', 'NOISE']);
  expect(await page.locator('#waveView .wv-mix canvas[data-tgt]').evaluateAll((cs) => cs.map((c) => c.dataset.tgt)))
    .toEqual(['osc0.level', 'osc1.level', 'osc2.level', 'sub.level', 'noise.level']);
  await expect(page.locator('#waveView .wv-mix [data-subshape] .wv-g')).toHaveCount(3);
  await expect(page.locator('#waveView .wv-mix [data-suboct] span')).toHaveText(['−2', '−1']);
  await expect(page.locator('#waveView .wv-mix [data-ncol] span')).toHaveText(['W', 'P', 'B']);
  await expect(page.locator('#waveView .wv-mix [data-ncol] .wv-nd')).toHaveCount(3);

  // A click on a bar is its level: the middle of the Sub's bar, before its
  // 40 px readout, is 0.5. It goes live, then once more to keep.
  const b = await page.locator('#wvMixL3').boundingBox();
  await page.mouse.click(b.x + b.width * ((6 + 0.5 * (214 - 40 - 12)) / 214), b.y + b.height / 2);
  await page.waitForTimeout(150);
  const sub = params(sent, 'sub.level');
  expect(sub.some((x) => x.live === true)).toBe(true);
  expect(sub.at(-1).live).toBeUndefined();
  expect(sub.at(-1).value).toBeCloseTo(0.5, 1);

  // The strip's power and the oscillator's own are one switch.
  await page.locator('[data-mixon="0"]').click();
  await page.waitForTimeout(100);
  expect(params(sent, 'osc0.on').at(-1)).toEqual({ key: 'osc0.on', value: 0 });
  await expect(page.locator('[data-oscled="0"]')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('[data-strip="0"]')).toHaveClass(/\boff\b/);
  await page.locator('[data-oscled="0"]').click();
  await page.waitForTimeout(100);
  expect(params(sent, 'osc0.on').at(-1)).toEqual({ key: 'osc0.on', value: 1 });
  await expect(page.locator('[data-mixon="0"]')).toHaveClass(/\bon\b/);

  await page.locator('[data-ncol] span[data-k="2"]').click();
  await page.locator('[data-subshape] .wv-g[data-k="2"]').click();
  await page.locator('[data-suboct] span[data-k="2"]').click();
  await page.waitForTimeout(100);
  expect(params(sent, 'noise.color').at(-1).value).toBe(2);
  expect(params(sent, 'sub.shape').at(-1).value).toBe(2);
  expect(params(sent, 'sub.oct').at(-1).value).toBe(2);
  expect(errors).toEqual([]);
});

test('v7: badges name what moves each module, in the source\'s colour, and lead to it', async ({ page }) => {
  const mods = [
    { src: 'lfo0', dst: 'osc0.pos', amt: 0.2, curve: 'lin', via: null },
    { src: 'lfo2', dst: 'osc1.pan', amt: 0.3, curve: 'lin', via: null },
    { src: 'env1', dst: 'filt0.cut', amt: 0.25, curve: 'exp', via: null },
  ];
  const { sent, errors } = await openWave(page, { mods });
  await expect(page.locator('#wvMoved0 .wv-badge')).toHaveCount(1);
  await expect(page.locator('#wvMoved0 .wv-badge')).toHaveText('LFO 1→ Position');
  await expect(page.locator('#wvMoved1 .wv-badge')).toHaveText('LFO 3→ Pan');
  await expect(page.locator('#wvMoved2 .wv-badge')).toHaveCount(0);
  await expect(page.locator('#wvMovedF .wv-badge')).toHaveText('ENV 2→ F1 Cutoff');
  // Each in its source's colour, the same as its tab's.
  expect(await page.locator('#wvMoved0 .wv-badge').evaluate((b) => getComputedStyle(b).color)).toBe('rgb(92, 200, 230)');
  expect(await page.locator('#wvMovedF .wv-badge').evaluate((b) => getComputedStyle(b).color)).toBe('rgb(240, 166, 64)');
  expect(await page.locator('#wvSrcTabs [data-src="3"]').evaluate((t) => t.style.getPropertyValue('--c'))).toBe('#5cc8e6');

  // Hover lights the source's tab and rings the control; leaving puts both back.
  await page.locator('#wvMovedF .wv-badge').hover();
  await expect(page.locator('#wvSrcTabs [data-src="0"]')).toHaveClass(/wv-hl/);
  await expect(page.locator('#waveView canvas[data-tgt="filt0.cut"]')).toHaveClass(/wv-hl/);
  await page.mouse.move(5, 5);
  await expect(page.locator('#waveView .wv-hl')).toHaveCount(0);
  // A click opens that source in Modulate.
  await page.locator('#wvMovedF .wv-badge').click();
  expect(await page.evaluate(() => WV.sel)).toBe(0);
  await expect(page.locator('#wvSrcTabs [data-src="0"]')).toHaveClass(/\bon\b/);

  // A new route is a new badge: LFO 2 dragged onto osc C's table.
  const tab = await page.locator('#wvSrcTabs [data-src="4"]').boundingBox();
  const to = await page.locator('#wvW3d2').boundingBox();
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(posted(sent, '/api/wave/mods').at(-1).body.mods.some((m) => m.src === 'lfo1' && m.dst === 'osc2.pos')).toBe(true);
  await expect(page.locator('#wvMoved2 .wv-badge')).toHaveText('LFO 2→ Position');

  // And none: with no routes there are no badges, and nothing breaks.
  await page.evaluate(() => { WV.mods = []; wvRenderTargets(); });
  await expect(page.locator('#waveView .wv-moved .wv-badge')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('v7: with no routes at all, the page opens with no badges and no error', async ({ page }) => {
  const { errors } = await openWave(page, { mods: [] });
  await expect(page.locator('#waveView .wv-moved .wv-badge')).toHaveCount(0);
  await expect(page.locator('#wvSrcTargets')).toContainText('No targets yet');
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});

test('v7: the Shape row sets an LFO\'s shape, Hz or Sync with its tempo, and an envelope dims it', async ({ page }) => {
  const { sent } = await openWave(page);
  const shapes = page.locator('#wvShapes [data-shape]');
  expect(await shapes.evaluateAll((g) => g.map((x) => x.dataset.shape)))
    .toEqual(['sine', 'tri', 'up', 'down', 'square', 'steps', 'smooth', 'drawn']);
  // LFO 1 is chosen, and a sine.
  await expect(page.locator('#wvShapes .wv-g.on')).toHaveAttribute('data-shape', 'sine');
  await expect(page.locator('#wvSrcRateRo')).toHaveText('0.49 Hz');
  await expect(page.locator('#wvTempoRo')).toBeHidden();

  await page.locator('#wvShapes [data-shape="square"]').click();
  await page.waitForTimeout(100);
  expect(params(sent, 'lfo0.shape').at(-1)).toEqual({ key: 'lfo0.shape', value: 'square' });
  await expect(page.locator('#wvShapes .wv-g.on')).toHaveAttribute('data-shape', 'square');

  // Sync: the rate is a note length, and the tempo shows beside it.
  await page.locator('#wvRateMode [data-k="1"]').click();
  await page.waitForTimeout(100);
  expect(params(sent, 'lfo0.sync').at(-1)).toEqual({ key: 'lfo0.sync', value: 1 });
  await expect(page.locator('#wvTempoRo')).toBeVisible();
  await expect(page.locator('#wvTempoRo')).toHaveText('120 BPM');
  await expect(page.locator('#wvSrcRateRo')).toHaveText('1 bar');
  await dragBy(page, '#wvTempoRo', 0, -40);
  await page.waitForTimeout(150);
  const tempo = params(sent, 'tempo');
  expect(tempo.some((x) => x.live === true)).toBe(true);
  expect(tempo.at(-1).live).toBeUndefined();
  expect(Number.isInteger(tempo.at(-1).value)).toBe(true);
  expect(tempo.at(-1).value).toBeGreaterThan(120);
  expect(tempo.at(-1).value).toBeLessThanOrEqual(300);

  // An envelope has no shape to pick.
  await page.locator('#wvSrcTabs [data-src="0"]').click();
  await expect(page.locator('#wvShapes')).toHaveClass(/\benv\b/);
  await expect(page.locator('#wvShpLab')).toHaveText('Envelope · drag its points');
});

test('v7: dragging a standard shape in the editor makes it Drawn, points first', async ({ page }) => {
  const { sent } = await openWave(page);
  await dragBy(page, '#wvSrcEd', 10, -20);
  await page.waitForTimeout(150);
  const all = posted(sent, '/api/wave/param').map((s) => s.body);
  const pts = all.findIndex((b) => b.key === 'lfo0.points' && !b.live);
  const shape = all.findIndex((b) => b.key === 'lfo0.shape' && b.value === 'drawn');
  expect(pts, 'the sampled points were not sent').toBeGreaterThanOrEqual(0);
  expect(shape, 'the shape did not become drawn').toBeGreaterThan(pts);
  // Sampled from the sine: nine points, from 0 to 1.
  expect(all[pts].value).toHaveLength(9);
  expect(all[pts].value[0][0]).toBe(0);
  expect(all[pts].value.at(-1)[0]).toBe(1);
  expect(all[pts].value[2][1]).toBeCloseTo(1, 3);
  // Then the drag moves one of them, live and then kept.
  expect(all.slice(shape).some((b) => b.key === 'lfo0.points' && b.live === true)).toBe(true);
  expect(all.at(-1).key).toBe('lfo0.points');
  await expect(page.locator('#wvShapes .wv-g.on')).toHaveAttribute('data-shape', 'drawn');
});

test('v7: dragging across the keys glides; Shift-drag holds every key it crosses', async ({ page }) => {
  const { sent } = await openWave(page);
  await expect(page.locator('#waveView .wv-kbinfo .wv-hint')).toContainText('Drag to glide');
  const k = await page.locator('#wvKeys').boundingBox();
  const y = k.y + k.height * 0.85;   // the white keys' lower half
  const notes = () => posted(sent, '/api/wave/note').map((s) => s.body);

  await page.mouse.move(k.x + k.width * 0.05, y);
  await page.mouse.down();
  await page.mouse.move(k.x + k.width * 0.3, y, { steps: 12 });
  const during = notes();
  await page.mouse.up();
  await page.waitForTimeout(100);
  const glide = notes();
  const ons = glide.filter((n) => n.on), offs = glide.filter((n) => !n.on);
  expect(ons.length, 'the drag crossed no keys').toBeGreaterThan(2);
  // Never two at once: each new key starts only once the last one has stopped,
  // and while the button is down exactly one is sounding.
  const sounding = new Set();
  for (const n of during) {
    if (n.on) sounding.add(n.note); else sounding.delete(n.note);
    expect(sounding.size).toBeLessThanOrEqual(1);
  }
  expect(sounding.size).toBe(1);
  expect(offs.length).toBe(ons.length);

  // Shift: nothing stops until the mouse comes up, then everything does.
  const before = notes().length;
  await page.keyboard.down('Shift');
  await page.mouse.move(k.x + k.width * 0.05, y);
  await page.mouse.down();
  await page.mouse.move(k.x + k.width * 0.3, y, { steps: 12 });
  const held = notes().slice(before);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
  const after = notes().slice(before);
  expect(held.length).toBeGreaterThan(2);
  expect(held.every((n) => n.on)).toBe(true);
  expect(new Set(held.map((n) => n.note)).size).toBe(held.length);
  expect(after.filter((n) => !n.on).map((n) => n.note).sort()).toEqual(held.map((n) => n.note).sort());
});

test('v7: every control has the page\'s own tooltip, and no browser tooltip is left', async ({ page }) => {
  await openWave(page);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.querySelectorAll('#waveView [title]').length)).toBe(0);
  // A control with a target: its name, its value, what moves it, how to drag it.
  await page.locator('#wvW3d0').hover();
  const tip = page.locator('#wvTip');
  await expect(tip).toBeVisible({ timeout: 1000 });
  await expect(tip.locator('b')).toHaveText('Osc A · Frame position');
  await expect(tip.locator('.v')).toContainText('Formant Sweep');
  await expect(tip.locator('.wv-badge')).toContainText('LFO 1');
  await expect(tip.locator('.h')).toContainText('drop a source here');
  // Any other button: its name in bold, and the rest as the hint.
  await page.locator('#wvFroute [data-k="split"]').hover();
  await expect(tip.locator('b')).toHaveText('Split');
  await expect(tip.locator('.h')).toHaveText('A goes to Filter 1, B to Filter 2');
  // A press hides it.
  await page.mouse.down();
  await expect(tip).toBeHidden();
  await page.mouse.up();
});
