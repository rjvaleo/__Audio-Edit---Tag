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
//   - with no engine, the page draws its own default patch and says so.

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

/// A stand-in engine: the routes, answered, and every request kept.
async function mockEngine(page) {
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
      return route.fulfill({ json: {
        params: { 'osc0.table': 'Formant Sweep', 'osc0.pos': 0.4, 'osc0.warp0.mode': 'bend', 'osc0.warp0.amt': 0.3 },
        mods: [{ src: 'lfo0', dst: 'osc0.pos', amt: 0.2, curve: 'lin', via: null }],
        macroNames: ['Brightness', 'Movement', 'Width', 'Grit', 'Space', 'Morph', 'Attack', 'Air'],
        name: 'Test Patch', tags: ['Pad', 'Test'],
      } });
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
async function openWave(page) {
  await serveStylesheet(page);
  const engine = await mockEngine(page);
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
