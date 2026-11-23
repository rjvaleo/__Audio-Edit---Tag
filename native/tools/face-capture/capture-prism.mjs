// Capture MGL's Prism page for the native app, in every theme.
//
//   PRISM_DATA=<folder> node native/tools/face-capture/capture-prism.mjs <out-folder> [theme-id ...]
//
// The Prism page (`body.prismpage`, the dock tab `hyper`, `#dockHyper`:
// ui/app/385-388b, ui/prism-pad.js, 080-fx-faces-visual.css) fills the window
// in MGL. It is captured as RJ uses it, in a 1668 x 1100 window with the rail
// 168 wide: the page (1500 x 1052) and the Now Playing bar under it (1500 x
// 48), as capture-edit.mjs measures Edit. It is served from the checkout with
// no engine behind it; the few routes the page asks of a sound being open are
// answered here from MGL's own answers kept in PRISM_DATA (fx.json: /api/fx;
// pad.json: /api/pad for a Prism document with MGL's factory rack; rack.json:
// /api/rack for it), and a sound of two seconds at 48 kHz, two channels,
// steady (its peaks flat), which the native snapshot plays too.
//
// For each theme MGL's Theme page lists (and `default`):
//   <out>/mgl-prism-<id>.json.gz  {
//     size,        [1500, 1100]
//     page,        the page with the sound open, Time & Pitch on the pad
//     nowbar,      the Now Playing bar (under the page, at y 1052)
//     lit,         the page with every switch and seg on (their lit looks),
//                  a take recorded, Map on, the LFO on pulse
//     nowbarLit,   the bar playing, looping
//     echo,        the page with Hyperprism Echo on the pad (its groups)
//     ptc,         the page with the Pitch Time Changer on the pad (its switch)
//     menus: { pick, x, y, chainAdd, presets }   the menus, open
//     cl,          the page's colours, resolved
//   }
// and, for the default theme only, <out>/prism-reference.png (the page at
// 2x). PRISM_REFS=<folder>: every theme's picture at 1x as well.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mgl = path.resolve(here, '../../..');
const require = createRequire(path.join(mgl, 'package.json'));
const { chromium } = require('playwright');

const [out, ...only] = process.argv.slice(2);
const dataDir = process.env.PRISM_DATA;
if (!out || !dataDir) {
  console.error('usage: PRISM_DATA=<folder> capture-prism.mjs <out-folder> [theme-id ...]');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const readData = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const FX = readData('fx.json'), PAD = readData('pad.json'), RACK = readData('rack.json');

// The sound: two seconds at 48 kHz, two channels, steady.
const SOUND = { path: 'kit/sound.wav', filename: 'sound.wav', format: 'wav', sampleRate: 48000, bits: 24, channels: 2, duration: 2, frames: 96000, category: 'SAMPLE' };
const peaks = (cols) => ({ columns: cols, frames: SOUND.frames, sampleRate: SOUND.sampleRate,
  channels: [0, 1].map(() => ({ min: new Array(cols).fill(-0.4), max: new Array(cols).fill(0.4) })) });

const ui = path.join(mgl, 'ui');
const joined = {};
for (const [folder, ext, file] of [['app', 'js', 'app.js'], ['app-css', 'css', 'app.css'], ['room-paint', 'js', 'room-paint.js'], ['vis-gl', 'js', 'vis-gl.js'], ['stage', 'js', 'stage.js']]) {
  const dir = path.join(ui, folder);
  joined['/' + file] = fs.readdirSync(dir).filter((f) => f.endsWith('.' + ext)).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}
// The routes a sound being open on the Prism page asks for.
const api = (url, q) => {
  if (url === '/api/fx') return FX;
  if (url === '/api/pad' && (q.get('p') || '').startsWith('prism:')) return PAD;
  if (url === '/api/rack' && (q.get('p') || '').startsWith('prism:')) return RACK;
  if (url === '/api/pad/presets') return { factory: [], user: [] };
  if (url === '/api/prism/load') return { frames: SOUND.frames, sampleRate: SOUND.sampleRate };
  if (url === '/api/prism/state') return { playing: false, position: 0, inFrames: SOUND.frames };
  if (url === '/api/peaks' && q.get('p') === SOUND.path) return peaks(+q.get('cols') || 1600);
  if (url === '/api/files') return q.get('folder') === 'kit' ? [SOUND] : [];
  if (['/api/engine/transport', '/api/prism/stretch', '/api/engine/glide', '/api/engine/pad', '/api/pitchtime', '/api/rack/param'].includes(url)) return {};
  return null;
};
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let url = decodeURIComponent(u.pathname);
  if (url.startsWith('/api/') || url.startsWith('/audio')) {
    const a = api(url, u.searchParams);
    if (a == null) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(a));
  }
  if (url.endsWith('/')) url += 'index.html';
  const body = joined[url] ?? (() => {
    const p = path.join(ui, path.normalize(url));
    return p.startsWith(ui) && fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p) : null;
  })();
  if (body == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(url)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const walk = fs.readFileSync(path.join(here, 'walk.js'), 'utf8');
const write = (file, data) => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(data), { level: 9 }));

// Left out of every picture: the toasts, the tooltips.
const SKIP = ['.toast', '#toast', '.toasts'];

// The page's colours as the face draws with them, each resolved to rgb().
const colours = () => {
  const probe = document.createElement('i');
  $('dockHyper').append(probe);
  // Read back from a painted pixel, so oklch() and color-mix() come out as rgb().
  const px = document.createElement('canvas');
  px.width = px.height = 1;
  const pc = px.getContext('2d', { willReadFrequently: true });
  const rgb = (css) => {
    probe.style.color = ''; probe.style.color = css;
    pc.clearRect(0, 0, 1, 1); pc.fillStyle = getComputedStyle(probe).color; pc.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pc.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
  };
  const out = {};
  for (const k of ['--look-text', '--look-text-2', '--look-text-3', '--look-accent', '--look-bad', '--look-well', '--look-panel', '--look-panel-hi', '--look-line',
    '--on', '--white', '--prism-pad-path', '--prism-pad-hi', '--prism-pad-lo', '--f-time', '--f-pitch', '--f-tone', '--f-attack', '--f-space', '--f-level',
    '--plfo1', '--plfo2', '--plfo3', '--plfo4', '--look-wave', '--look-mod', '--look-arc', '--look-track', '--text-dimmer', '--nb-wave']) out[k] = rgb(`var(${k})`);
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['--look-bloom', '--white-rgb', '--black-rgb', '--look-glow']) out[k] = cs.getPropertyValue(k).trim();
  // The knob's parts as drawn (the ring's track and arc, the live dot, the cap).
  const kn = document.querySelector('#prismSettings .ui-kn');
  if (kn) {
    const q = (s) => kn.querySelector(s);
    const st = (el, p) => (el ? getComputedStyle(el).getPropertyValue(p) : '');
    out.knob = { tr: st(q('.ui-tr'), 'stroke'), ar: st(q('.ui-ar'), 'stroke'), arFilter: st(q('.ui-ar'), 'filter'), live: st(q('.ui-live'), 'fill'),
      ptr: st(q('.ui-ptr'), 'stroke'), ptrW: st(q('.ui-ptr'), 'stroke-width'), dn: st(q('.ui-dn'), 'stroke'), md: st(q('.ui-md'), 'stroke'), mdW: st(q('.ui-md'), 'stroke-width') };
  }
  probe.remove();
  return out;
};

// Mark the parts the face needs to find: each knob row's key and its axis,
// the pictures' colours.
const mark = () => {
  const probe = document.createElement('i');
  document.body.append(probe);
  const px = document.createElement('canvas');
  px.width = px.height = 1;
  const pc = px.getContext('2d', { willReadFrequently: true });
  const rgb = (css) => {
    probe.style.color = ''; probe.style.color = css;
    pc.clearRect(0, 0, 1, 1); pc.fillStyle = getComputedStyle(probe).color; pc.fillRect(0, 0, 1, 1);
    const [r, g, b] = pc.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  for (const el of document.querySelectorAll('#dockHyper .prism-bar')) {
    el.dataset.fc = rgb(getComputedStyle(el).getPropertyValue('--fc').trim() || 'currentColor');
    const k = el.querySelector('.ui-knob');
    if (k) el.dataset.gg = rgb(getComputedStyle(k).getPropertyValue('--gg').trim() || 'currentColor');
  }
  probe.remove();
};

const browser = await chromium.launch();
try {
  const ctx0 = await browser.newContext({ viewport: { width: 1668, height: 1100 } });
  const t0 = await ctx0.newPage();
  await t0.goto(base + '/index.html', { waitUntil: 'load' });
  const themes = await t0.evaluate(() => allPalettes().map((p) => ({ id: p.id, name: p.name })));
  await ctx0.close();
  themes.unshift({ id: 'default', name: 'Graphite + Acrylic' });
  const list = only.length ? themes.filter((t) => only.includes(t.id)) : themes;

  for (const t of list) {
    const scale = t.id === 'default' ? 2 : 1;
    const ctx = await browser.newContext({ viewport: { width: 1668, height: 1100 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    const tab = await ctx.newPage();
    tab.on('pageerror', (e) => process.stdout.write(`  [${t.id}] page error: ${e.message}\n`));
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.evaluate((chosen) => {
      localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
      for (const k of Object.keys(localStorage)) if (/^(prism|hyperstretch|mgl\.prism)/.test(k)) localStorage.removeItem(k);
    }, t.id === 'default' ? null : t.id);
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.waitForTimeout(300);
    // The sound chosen as the page's picker chooses it, its folder listed.
    await tab.evaluate(async (snd) => {
      state.folders = [{ name: 'kit' }];
      await loadShapers();
      try { localStorage.setItem('prism.sound', snd.path); } catch {}
      setEditPage('prism', false);
      setMode('edit');
    }, SOUND);
    await tab.waitForTimeout(1500);
    await tab.evaluate((skip) => skip.forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })), SKIP);
    const rect = await tab.evaluate(() => {
      const c = document.querySelector('.centre').getBoundingClientRect(), n = $('nowBar').getBoundingClientRect(), d = $('dockHyper').getBoundingClientRect();
      return { centre: [c.x, c.y, c.width, c.height], now: [n.x, n.y, n.width, n.height], dock: [d.x, d.y, d.width, d.height] };
    });
    process.stdout.write(`  ${t.id}: ${JSON.stringify(rect)}\n`);
    if (process.env.PRISM_EXPLORE) {
      await tab.screenshot({ path: path.join(out, `explore-${t.id}.png`), clip: { x: 168, y: 0, width: 1500, height: 1100 } });
      await ctx.close();
      continue;
    }
    if (rect.centre[2] !== 1500 || rect.centre[3] !== 1052 || rect.now[1] !== 1052) throw new Error(`${t.id}: the page is ${JSON.stringify(rect)}`);
    // Still: the LFOs at their start (phase 0, as the module's are before its
    // first frame), the ring on the hand.
    const still = () => {
      prismLfoStop();
      for (const l of prismLfo.lfos) { l.phase = 0; l.held = 0.5; }
      prismLfoPaint();
      hs.ghost = { ...hs.hand };
      hsPaintGhost();
      hsPaint();
    };
    await tab.evaluate(`(${still})()`);
    await tab.waitForTimeout(100);
    const walkOf = async (sel, rel = '.centre') => {
      await tab.evaluate(`(${mark})()`);
      const r = await tab.evaluate(`(${walk})(${JSON.stringify(sel)}, ${JSON.stringify(SKIP)})`);
      if (r.error) throw new Error(`${t.id} ${sel}: ${r.error}`);
      // Where its root sits on the page.
      r.at = await tab.evaluate(([s, rl]) => { const a = document.querySelector(s).getBoundingClientRect(), b = document.querySelector(rl).getBoundingClientRect(); return [a.x - b.x, a.y - b.y]; }, [sel, rel]);
      delete r.vars;
      return r;
    };
    const clip = { x: 168, y: 0, width: 1500, height: 1100 };
    const face = { size: [1500, 1100], theme: t.id, captured: new Date().toISOString(), menus: {} };
    face.cl = await tab.evaluate(`(${colours})()`);

    // ── the page: the sound open, Time & Pitch on the pad ──
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'prism-reference.png'), clip });
    if (process.env.PRISM_REFS) await tab.screenshot({ path: path.join(process.env.PRISM_REFS, `prism-reference-${t.id}.png`), clip });
    face.page = await walkOf('.centre');
    face.nowbar = await walkOf('#nowBar', '#nowBar');

    // ── the Process menu, open ──
    await tab.evaluate(() => { prismPick.open = true; prismPickerRender(); });
    await tab.waitForTimeout(80);
    face.menus.pick = await walkOf('#prismPickMenu');
    await tab.evaluate(() => { prismPick.open = false; prismPickerRender(); });

    // ── lit: a take recording (and two kept), every switch on, Map on and a
    // control mapped, the LFO on pulse, the bar playing with its loop off ──
    await tab.evaluate(() => {
      hsShape('circle');
      hs.mode = 'ready';
      const pts = [];
      for (let i = 0; i < 90; i++) pts.push({ x: 0.2 + 0.6 * i / 90, y: 0.5 + 0.3 * Math.sin(i / 9), t: i * HS_TICK });
      hs.slots[1] = { pts, dur: 1500 };
      hs.rec = pts.slice(0, 60);
      hs.recT0 = performance.now();
      hs.mode = 'rec';
      hs.rate = 2; hs.dir = 'pp'; hs.throwOn = true; hs.loopOnRelease = true;
      prismLfo.sel = 1;
      prismLfo.lfos[1].shape = 'pulse';
      prismLfo.lfos[1].targets = [{ src: 'stretch', key: 'windowMs' }];
      prismLfo.mapping = true;
      prismLfoRender();
      prismLfoPaint();
      // The deck's poll would read the (absent) engine's "not playing" back.
      prismDeck.polled = 1e15;
      prismDeck.playing = true;
      prismDeck.loop = false;
      prismBarShow();
      hsPaint();
    });
    await tab.waitForTimeout(120);
    if (process.env.PRISM_REFS) await tab.screenshot({ path: path.join(process.env.PRISM_REFS, `prism-reference-lit-${t.id}.png`), clip });
    face.lit = await walkOf('.centre');
    face.nowbarLit = await walkOf('#nowBar', '#nowBar');
    await tab.evaluate(() => {
      hs.rec = null; hs.mode = 'ready'; hs.slots = [null, null, null, null];
      hs.rate = 1; hs.dir = 'fwd'; hs.throwOn = false; hs.loopOnRelease = false;
      prismLfo.sel = 0; prismLfo.lfos[1].shape = 'triangle'; prismLfo.lfos[1].targets = []; prismLfo.mapping = false;
      prismLfoRender(); prismLfoPaint();
      prismDeck.playing = false; prismDeck.loop = true; prismDeck.polled = 0; prismBarShow();
      hsPaint();
    });

    // ── Hyperprism Echo on the pad: its groups, its picture on the button ──
    await tab.evaluate((fx) => {
      const sh = state.shapers['prism:hp-echo'];
      const slot = { id: 'fx-echo', kind: sh.kind, bypassed: false, params: Object.fromEntries(sh.params.map((p) => [p.key, p.default])) };
      prismDeck.rack.slots.push(slot);
      const pad = sh.panel.pad;
      const d = { x: pad.x, xLo: pad.xMin, xHi: pad.xMax, y: pad.y, yLo: pad.yMin, yHi: pad.yMax };
      prismPad.sources.push({ id: slot.id, label: sh.label, controls: sh.params.map(({ key, label, min, max, log, unit, step }) => ({ key, label, min, max, log, unit, ...(step ? { step } : {}) })), default: d, pad: d });
      hsSetSource(slot.id);
      prismRenderChain();
      hsPaint();
    });
    await tab.waitForTimeout(150);
    if (process.env.PRISM_REFS) await tab.screenshot({ path: path.join(process.env.PRISM_REFS, `prism-reference-echo-${t.id}.png`), clip });
    face.echo = await walkOf('.centre');

    // ── the Pitch Time Changer on the pad, switched on ──
    await tab.evaluate(() => { hsSetSource('ptc'); prismPtcSet({ on: true }); prismShowPtc(); hsPaint(); });
    await tab.waitForTimeout(120);
    face.ptc = await walkOf('.prism-ctl');
    face.ptcHead = await walkOf('.hs-head');

    write(path.join(out, `mgl-prism-${t.id}.json.gz`), face);
    process.stdout.write(`  ${t.id}: ${face.page.nodes} + ${face.lit.nodes} + ${face.echo.nodes} boxes, menu ${face.menus.pick.nodes}\n`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
