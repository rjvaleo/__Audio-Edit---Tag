// Capture Wave's other views, and the parts the page builds as it goes, for
// the native app, in every MGL theme.
//
//   node native/tools/face-capture/capture-wave.mjs <faces-folder> <reference-folder> [theme-id ...]
//
// The page is served from the checkout, as capture.mjs serves it, with no
// engine behind it. What the engine would have sent the page and does not
// change (the board's effects, its presets, the rack's catalogue) is given
// to it from given/ (read once from MGL with GETs: wave-fx.json, wave-boards.json,
// fx.json), so the FX view is the one MGL shows. For each theme:
//   <faces>/mgl-wave-<id>.json.gz   { views: {create, matrix, fx}, parts: {...} }
// every view walked whole (walk.js), header and dock included, at the page's
// own size (1900 x 1052); and the parts: the pieces the page makes from the
// patch (a pin, a row, a node, a menu...), each walked in a state that shows
// it, for the native face to draw where the patch puts them.
// For the default theme only, each view as Chromium draws it:
//   <reference>/wave-<view>.png (2x) and wave-<view>-1x.png
// GIVEN_ENGINE=<file> (from `idMLab --dump-wave`): the page is given the
// engine's default patch and tables, as it has them when its engine answers,
// and only the reference pictures are written, Play's too, as
// wave-<view>-engine.png: the native face against the page as MGL shows it.
// Nothing touches the live app on 8737.

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
const walk = fs.readFileSync(path.join(here, 'walk.js'), 'utf8');

const [faces, refs, ...only] = process.argv.slice(2);
if (!faces || !refs) {
  console.error('usage: capture-wave.mjs <faces-folder> <reference-folder> [theme-id ...]');
  process.exit(2);
}
fs.mkdirSync(faces, { recursive: true });
fs.mkdirSync(refs, { recursive: true });
const write = (file, value) => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(value), { level: 9 }));
const data = (f) => JSON.parse(fs.readFileSync(path.join(here, 'given', f), 'utf8'));
const engine = process.env.GIVEN_ENGINE ? JSON.parse(fs.readFileSync(process.env.GIVEN_ENGINE, 'utf8')) : null;
const given = { wavefx: data('wave-fx.json'), boards: data('wave-boards.json'), rack: data('fx.json') };

const ui = path.join(mgl, 'ui');
const joined = {};
for (const [folder, ext, file] of [['app', 'js', 'app.js'], ['app-css', 'css', 'app.css'], ['room-paint', 'js', 'room-paint.js'], ['vis-gl', 'js', 'vis-gl.js'], ['stage', 'js', 'stage.js']]) {
  const dir = path.join(ui, folder);
  joined['/' + file] = fs.readdirSync(dir).filter((f) => f.endsWith('.' + ext)).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url.startsWith('/api/') || url.startsWith('/audio')) { res.writeHead(404); return res.end(); }
  const file = url === '/' ? '/index.html' : url;
  const body = joined[file] ?? (() => {
    const p = path.join(ui, path.normalize(file));
    return p.startsWith(ui) && fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p) : null;
  })();
  if (body == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const ROOT = '#waveView .wv-app';
const SKIP = ['#wvOffline', '.wv-menu', '.wv-pmenu', '.wv-cmenu', '.wv-tip'];

// Mark each control with the key the page wires it to, as it wires it (the
// same marks capture.mjs and capture-themes.mjs make).
const markBindings = () => {
  const wrap = (name, mark) => {
    const f = window[name];
    if (typeof f !== 'function') return;
    window[name] = function (...a) { try { mark(...a); } catch { /* best effort */ } return f.apply(this, a); };
  };
  wrap('wvV', (id, key, sens = 150, lo = 0, hi = 1) => {
    const el = typeof WVW !== 'undefined' && WVW[id] && WVW[id].el;
    if (el) Object.assign(el.dataset, { bindV: key, bindSens: sens, bindLo: lo, bindHi: hi });
  });
  wrap('wvChoice', (root, sel, key, read) => {
    (root || document).querySelectorAll(sel).forEach((el) => { el.dataset.bindKey = key; el.dataset.bindValue = read ? read(el) : el.dataset.k; });
  });
  wrap('wvDrag', (el) => { if (el && el.dataset) el.dataset.bindDrag = el.dataset.bindDrag || '1'; });
};

// What the engine would have given the page, given before it builds.
const giveCatalogue = (g) => {
  WV_FXCAT.list = g.wavefx.filter((f) => f && f.kind);
  WV_FXCAT.by = Object.fromEntries(WV_FXCAT.list.map((f) => [f.kind, f]));
  WV_BOARDS.list = g.boards.filter((b) => b && Array.isArray(b.nodes));
  for (const s of g.rack.shapers || []) state.shapers[s.kind] = s;
  state.suites = g.rack.suites || [];
};

// The parts: each a state the page is put in, and what is walked there.
// `setup` runs in the page (after the view is shown), `sel` is walked.
// A row for every source, switched on and then off, each onto a target of
// its own (so every source's pin, on and off, and every source's row are
// captured in its own colour), each with itself as × source; and one onto the
// FX board (so its group's band and column show).
const MX_SOURCES = ['env1', 'env2', 'env3', 'lfo0', 'lfo1', 'lfo2', 'lfo3', 'vel', 'note', 'mw', 'at', 'rand', 'macro0', 'macro1', 'macro2', 'macro3', 'macro4', 'macro5', 'macro6', 'macro7'];
const MX_TARGETS = [0, 1, 2].flatMap((o) => ['pos', 'warp0.amt', 'warp1.amt', 'uni.det', 'uni.spr', 'fx.a', 'pitch', 'fine', 'phase', 'rand', 'pan', 'table', 'warp0.mode', 'warp1.mode', 'fx.mode'].map((k) => `osc${o}.${k}`));
const MX_ROWS = [
  ...MX_SOURCES.map((src, i) => ({ src, dst: MX_TARGETS[i], amt: 0.3, curve: 'lin', via: src, on: true })),
  ...MX_SOURCES.map((src, i) => ({ src, dst: MX_TARGETS[20 + i], amt: -0.3, curve: 'exp', via: null, on: false })),
  { src: 'lfo1', dst: 'board:n1:wet', amt: 0.3, curve: 'lin', via: null, on: true },
];
// The test board, every kind of node, laid out on the grid.
const BOARD = `window.wvSetPortsQuiet = (n, k) => { n.params[n.kind === 'split' ? 'outs' : 'ins'] = k; }; WV.board = wvInitBoard(); wvBoardSeq = 0; { const add = (k, x, y) => wvAddNode(k, [x, y], true);
  const e = add('fx:echo', 300, 40), sp = add('split', 520, 40), mx = add('mix', 740, 40), dw = add('drywet', 300, 260), gn = add('gain', 520, 260),
    pn = add('pan', 740, 260), cv = add('fx:convolution', 300, 440), d2 = add('fx:sh-decimate', 520, 440), d4 = add('fx:sh-phasor', 740, 440);
  d2.on = false;
  const s3 = add('split', 960, 40), m3 = add('mix', 960, 260), m4 = add('mix', 960, 440), iv = add('fx:invert', 1180, 40);
  wvSetPortsQuiet(s3, 3); wvSetPortsQuiet(m3, 3); wvSetPortsQuiet(m4, 4);
  WV.board.cables = [{ from: ['invoice', 'o'], to: [e.id, 'i'] }, { from: [e.id, 'o'], to: [sp.id, 'i'] }, { from: [sp.id, 'o0'], to: [mx.id, 'i0'] },
    { from: [sp.id, 'o1'], to: [mx.id, 'i1'] }, { from: [mx.id, 'o'], to: ['out', 'i'] }]; wvBoardGood = wvClone(WV.board); }`;
const wvSetPortsQuietDef = '';
const NO_RACK = 'window.__suites = state.suites; state.suites = []';
const RACK = 'state.suites = window.__suites || state.suites';
const SHOW_MENUS = () => document.querySelectorAll('.wv-menu, .wv-pmenu, .wv-cmenu').forEach((e) => { e.style.visibility = ''; });
const PARTS = [
  // The page's tile menu, open on osc A's tables (`wvTableMenu`).
  { name: 'menu', view: 'play', sel: '#wvMenu', setup: `(${SHOW_MENUS})(); wvTableMenu(document.querySelector('[data-pick="0"]'), 0)`, after: 'wvCloseMenus()' },
  // The Matrix's pins with rows in: one on, one switched off, one onto a
  // choice key, one onto the FX board (so its group's band and column show).
  { name: 'pins', view: 'matrix', sel: '#wvMxPins', setup: `WV.mods = ${JSON.stringify(MX_ROWS)}.map(wvModIn); WV.mx = 'pins'; wvRenderMatrix(); wvDrawMatrix(0)`, after: 'WV.mods = []; wvRenderMatrix()' },
  // The rows: the same, as rows, with the add row and the empty ones.
  { name: 'rows', view: 'matrix', sel: '#wvMxList', setup: `WV.mods = ${JSON.stringify(MX_ROWS)}.map(wvModIn); WV.mx = 'rows'; wvRenderMatrix(); wvDrawMatrix(0)`, after: 'WV.mx = "pins"; WV.mods = []; wvRenderMatrix()' },
  // The Matrix's header in Rows.
  { name: 'mxhead', view: 'matrix', sel: '#wvViewMatrix .wv-mxt > .wv-mh', setup: `WV.mx = 'rows'; wvRenderMatrix()`, after: 'WV.mx = "pins"; wvRenderMatrix()' },
  // The pickers: the sources (with × none), and the targets.
  { name: 'pickSrc', view: 'matrix', sel: '#wvPmenu', setup: `(${SHOW_MENUS})(); WV.mx = 'rows'; wvRenderMatrix(); wvOpenPicker(document.querySelector('#wvMxRows [data-pk="v"]'))`, after: 'wvCloseMenus(); WV.mx = "pins"; wvRenderMatrix()' },
  { name: 'pickTgt', view: 'matrix', sel: '#wvPmenu', setup: `(${SHOW_MENUS})(); WV.mx = 'rows'; wvRenderMatrix(); wvOpenPicker(document.querySelector('#wvMxRows [data-pk="t"]'))`, after: 'wvCloseMenus(); WV.mx = "pins"; wvRenderMatrix()' },
  // The FX board with a node of every kind (and one bypassed), patched:
  // Voice → Echo → Split → Mix → Out. Everything the board view draws is
  // walked from it: the world (nodes and cables), a selected node, a
  // selected cable, the main path, and every inspector (the page's own,
  // without the rack's faces, which come with the FX page).
  { name: 'world', view: 'fx', sel: '#wvWorld', setup: `${BOARD}; wvBoardSelect(null); wvRenderBoard()` },
  { name: 'worldSel', view: 'fx', sel: '#wvWorld', setup: `${BOARD}; WV_BOARD_VIEW.sel = { t: 'node', id: 'n1' }; wvRenderBoard(); document.querySelectorAll('#wvCables g[data-cab]')[0].classList.add('sel')` },
  { name: 'chain', view: 'fx', sel: '#wvFchain', setup: `${BOARD}; wvRenderBoard()` },
  { name: 'barCount', view: 'fx', sel: '#wvBcount', setup: `${BOARD}; wvRenderBoard()` },
  { name: 'inspBoard', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; WV.mods = [{ src: 'lfo1', dst: 'board:n1:wet', amt: 0.3, curve: 'lin', via: null, off: false }]; WV_BOARD_VIEW.sel = null; wvRenderBoard()`, after: 'WV.mods = []' },
  { name: 'inspFx', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; ${NO_RACK}; WV.mods = [{ src: 'lfo1', dst: 'board:n1:wet', amt: 0.3, curve: 'lin', via: null, off: false }]; wvBoardSelect({ t: 'node', id: 'n1' }); wvRenderInspector()`, after: `WV.mods = []; ${RACK}` },
  { name: 'inspFxOff', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; ${NO_RACK}; wvBoardSelect({ t: 'node', id: 'n8' }); wvRenderInspector()`, after: RACK },
  { name: 'inspSound', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; ${NO_RACK}; wvBoardSelect({ t: 'node', id: 'n7' }); wvRenderInspector()`, after: RACK },
  { name: 'inspIn', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; wvBoardSelect({ t: 'node', id: 'invoice' }); wvRenderInspector()` },
  { name: 'inspSend', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; wvBoardSelect({ t: 'node', id: 'inA' }); wvRenderInspector()` },
  { name: 'inspOut', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; wvBoardSelect({ t: 'node', id: 'out' }); wvRenderInspector()` },
  { name: 'inspSplit', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; wvBoardSelect({ t: 'node', id: 'n2' }); wvRenderInspector()` },
  { name: 'inspMix', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; wvBoardSelect({ t: 'node', id: 'n3' }); wvRenderInspector()` },
  { name: 'inspDrywet', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; wvBoardSelect({ t: 'node', id: 'n4' }); wvRenderInspector()` },
  { name: 'inspGain', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; wvBoardSelect({ t: 'node', id: 'n5' }); wvRenderInspector()` },
  { name: 'inspCable', view: 'fx', sel: '#wvFinsp', setup: `${BOARD}; wvBoardSelect({ t: 'cab', i: 0 }); wvRenderInspector()` },
  // The right-click menu: its first column, and a second open beside it.
  { name: 'cmenu', view: 'fx', sel: '#wvCmenu', setup: `(${SHOW_MENUS})(); ${BOARD}; wvRenderBoard(); { const r = document.querySelector('#wvFwell').getBoundingClientRect(); wvOpenCmenu({ clientX: r.left + 400, clientY: r.top + 200 }, 'ADD HERE', wvAddItems(() => {})); const it = document.querySelector('#wvCmenu .cm-it'); it.dispatchEvent(new MouseEvent('mouseenter')); }`, after: 'wvCloseMenus()' },
  { name: 'cmenuNode', view: 'fx', sel: '#wvCmenu', setup: `(${SHOW_MENUS})(); ${BOARD}; wvRenderBoard(); { const r = document.querySelector('[data-node="n1"]').getBoundingClientRect(); wvBoardMenu({ preventDefault() {}, target: document.querySelector('[data-node="n1"] .fh'), clientX: r.left + 20, clientY: r.top + 20 }); }`, after: 'wvCloseMenus()' },
  { name: 'note', view: 'fx', sel: '#wvFwell .wv-fstat', setup: `${BOARD}; wvRenderBoard(); wvBoardNote('Patched Voice → Echo'); document.querySelector('#wvFnote').style.transition = 'none'`, after: `document.querySelector('#wvFnote').classList.remove('on'); document.querySelector('#wvFhint').style.display = ''` },
  { name: 'noteBad', view: 'fx', sel: '#wvFwell .wv-fstat', setup: `${BOARD}; wvRenderBoard(); wvBoardNote('Refused: that would loop Echo back into itself', true); document.querySelector('#wvFnote').style.transition = 'none'`, after: `document.querySelector('#wvFnote').classList.remove('on'); document.querySelector('#wvFhint').style.display = ''` },
];

const browser = await chromium.launch();
try {
  const ctx0 = await browser.newContext({ viewport: { width: 2068, height: 1100 } });
  const t0 = await ctx0.newPage();
  await t0.goto(base + '/index.html', { waitUntil: 'load' });
  const themes = await t0.evaluate(() => allPalettes().map((p) => ({ id: p.id, name: p.name })));
  await ctx0.close();
  themes.unshift({ id: 'default', name: 'Graphite + Acrylic' });
  const list = only.length ? themes.filter((t) => only.includes(t.id)) : themes;

  for (const t of list) {
    const scales = t.id === 'default' ? [2, 1] : [1];
    let face = null;
    for (const scale of scales) {
      const ctx = await browser.newContext({ viewport: { width: 2068, height: 1100 }, deviceScaleFactor: scale });
      const tab = await ctx.newPage();
      tab.on('pageerror', (e) => console.error(`  ${t.id}: page error: ${e.message}`));
      await tab.goto(base + '/index.html', { waitUntil: 'load' });
      await tab.evaluate((chosen) => {
        localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
      }, t.id === 'default' ? null : t.id);
      await tab.goto(base + '/index.html', { waitUntil: 'load' });
      await tab.waitForTimeout(200);
      await tab.evaluate(markBindings);
      await tab.evaluate(giveCatalogue, given);
      if (engine) {
        await tab.evaluate((e) => {
          wvAdopt(e.patch);
          for (const [n, fr] of Object.entries(e.tables)) WV.tables[n] = fr.map((f) => Float32Array.from(f));
        }, engine);
      }
      await tab.evaluate(() => setMode('synth'));
      await tab.waitForTimeout(900);
      const hide = () => tab.evaluate((skip) => skip.forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })), SKIP);
      const views = {};
      for (const v of engine ? ['play', 'create', 'matrix', 'fx'] : ['create', 'matrix', 'fx']) {
        await tab.evaluate((v) => wvShowView(v), v);
        await tab.waitForTimeout(500);
        await hide();
        const size = await tab.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.width, r.height]; }, ROOT);
        if (size[0] !== 1900 || size[1] !== 1052) throw new Error(`${t.id} ${v}: the page is ${size}, not 1900 x 1052`);
        if (t.id === 'default') {
          const shot = await tab.locator(ROOT).screenshot({ animations: 'disabled' });
          fs.writeFileSync(path.join(refs, `wave-${v}${engine ? '-engine' : ''}${scale === 2 ? '' : '-1x'}.png`), shot);
        }
        if (scale === scales[0] && !engine) {
          const f = await tab.evaluate(`(${walk})(${JSON.stringify(ROOT)}, ${JSON.stringify(SKIP)})`);
          if (f.error) throw new Error(`${t.id} ${v}: ${f.error}`);
          views[v] = f;
        }
      }
      if (scale === scales[0] && !engine) {
        const parts = {};
        for (const p of PARTS) {
          await tab.evaluate((v) => wvShowView(v), p.view);
          await tab.waitForTimeout(150);
          await tab.evaluate(p.setup);
          await tab.waitForTimeout(250);
          const f = await tab.evaluate(`(${walk})(${JSON.stringify(p.sel)}, [])`);
          if (f.error) throw new Error(`${t.id} part ${p.name}: ${f.error}`);
          parts[p.name] = { tree: f.tree, root: (await tab.evaluate((sel) => { const a = document.querySelector('#waveView .wv-app').getBoundingClientRect(), r = document.querySelector(sel).getBoundingClientRect(); return [r.x - a.x, r.y - a.y, r.width, r.height]; }, p.sel)) };
          if (p.after) await tab.evaluate(p.after);
        }
        face = { views, parts, theme: t.id, captured: new Date().toISOString() };
        // The page's own tables for the board (theme-free), once.
        if (t.id === 'default') {
          const board = await tab.evaluate(() => ({ face: WV_FX_FACE, routing: WV_ROUTING, kindParams: WV_KIND_PARAMS, inputs: WV_INPUTS, abbr: WV_ABBR, catHue: WV_CAT_HUE, catOrder: WV_CAT_ORDER, grid: WV_GRID }));
          write(path.join(faces, 'wave-board-data.json.gz'), board);
        }
      }
      await ctx.close();
    }
    if (engine) { process.stdout.write(`  ${t.id}: references\n`); continue; }
    write(path.join(faces, `mgl-wave-${t.id}.json.gz`), face);
    process.stdout.write(`  ${t.id}: ${Object.entries(face.views).map(([k, v]) => `${k} ${v.nodes}`).join(', ')}, ${Object.keys(face.parts).length} parts\n`);
  }
} finally {
  await browser.close();
  server.close();
}
