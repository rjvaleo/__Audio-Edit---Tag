// Capture MGL's Browse page and its Library page for the native app.
//
//   LIB=http://127.0.0.1:<port> node native/tools/face-capture/capture-browse.mjs <out-folder> [theme-id ...]
//
// The pages are served from the checkout; every library route they ask
// (`/api/*`, `/audio`) goes to LIB: the library's routes answered by the
// app's own port of them (`native/engine-library`, its `serve` example), so
// the page is drawn from the very answers the modules get. Nothing else is
// behind them: no engine, no sound plays.
//
// Measured as RJ uses MGL: a 1668 x 1100 window with the rail 168 wide, so
// each page is the 1500 x 1100 to the right of the rail.
//
// BROWSE_EXPLORE=1: only pictures of each page, to look at.

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
const LIB = process.env.LIB;
if (!out || !LIB) {
  console.error('usage: LIB=http://127.0.0.1:<port> capture-browse.mjs <out-folder> [theme-id ...]');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

const ui = path.join(mgl, 'ui');
const joined = {};
for (const [folder, ext, file] of [['app', 'js', 'app.js'], ['app-css', 'css', 'app.css'], ['room-paint', 'js', 'room-paint.js'], ['vis-gl', 'js', 'vis-gl.js'], ['stage', 'js', 'stage.js']]) {
  const dir = path.join(ui, folder);
  joined['/' + file] = fs.readdirSync(dir).filter((f) => f.endsWith('.' + ext)).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const lib = new URL(LIB);
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let url = decodeURIComponent(u.pathname);
  if (url.startsWith('/api/') || url === '/audio') {
    const p = http.request({ host: lib.hostname, port: lib.port, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    p.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(p);
    return;
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
const SKIP = ['.toast', '#toast', '.toasts'];
const THEMES = [{ id: 'default' }, { id: 'studio-light' }, { id: 'layered-dark' }];

const browser = await chromium.launch();
try {
  const list = only.length ? THEMES.filter((t) => only.includes(t.id)) : THEMES;
  // The first theme is done twice: the library's first answers (its types'
  // files, the first sound's measures) come too late for the page's first
  // draw, so the first pass only warms them and the second replaces it.
  for (const t of [list[0], ...list]) {
    const scale = t.id === 'default' ? 2 : 1;
    const ctx = await browser.newContext({ viewport: { width: 1668, height: 1100 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    const tab = await ctx.newPage();
    tab.on('pageerror', (e) => process.stdout.write(`  [${t.id}] page error: ${e.message}\n`));
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.evaluate((chosen) => {
      localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
    }, t.id === 'default' ? null : t.id);
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.waitForTimeout(1500);
    const clip = { x: 168, y: 0, width: 1500, height: 1100 };
    if (process.env.BROWSE_EXPLORE) {
      await tab.evaluate(() => setMode('overview'));
      await tab.waitForTimeout(1500);
      await tab.screenshot({ path: path.join(out, `explore-browse-${t.id}.png`), clip });
      await tab.screenshot({ path: path.join(out, `explore-browse-full-${t.id}.png`) });
      await tab.evaluate(() => setMode('pclib'));
      await tab.waitForTimeout(3000);
      await tab.screenshot({ path: path.join(out, `explore-pclib-${t.id}.png`), clip });
      const boxes = await tab.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; };
        return { centre: r('.centre'), left: r('#leftPanel'), types: r('#browseTypes'), now: r('#nowBar'), lib: r('#libraryView .lb-page'), rail: r('#leftRail') };
      });
      process.stdout.write(`  ${t.id}: ${JSON.stringify(boxes)}\n`);
      await ctx.close();
      continue;
    }

    // ── Browse: the first folder open, its first sound picked, Drums the type ──
    await tab.evaluate(async () => {
      setMode('overview');
      if (!state.folders.length) state.folders = await api('/api/folders');
      const f = orderedFolders()[0];
      if (f && !state.openFolders[f.name]) await toggleFolder(f.name);
    });
    await tab.waitForTimeout(800);
    await tab.evaluate(async () => {
      const f = orderedFolders()[0];
      const file = (state.folderFiles[f.name] || []).filter(listed)[0];
      if (file) await selectFile(file);
      if (bt.types.length && bt.type !== 'Drums') btPick('Drums');
    });
    await tab.waitForTimeout(2500);
    await tab.evaluate((skip) => skip.forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })), SKIP);
    const walkOf = async (sel) => {
      const r = await tab.evaluate(`(${walk})(${JSON.stringify(sel)}, ${JSON.stringify(SKIP)})`);
      if (r.error) throw new Error(`${t.id} ${sel}: ${r.error}`);
      // Where its root sits in the module (the window less the rail).
      r.at = await tab.evaluate((s) => { const a = document.querySelector(s).getBoundingClientRect(); return [a.x - 168, a.y]; }, sel);
      delete r.vars;
      return r;
    };
    const face = { size: [1500, 1100], theme: t.id, captured: new Date().toISOString() };
    face.cl = await tab.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const o = {};
      for (const k of ['--wave', '--wave-2', '--look-text', '--look-text-2', '--look-text-3', '--look-accent', '--look-well', '--look-panel', '--look-panel-hi', '--look-line', '--f-attack', '--f-tone', '--m-wave', '--accent', '--good', '--warn', '--bad']) o[k] = cs.getPropertyValue(k).trim();
      return o;
    });
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'browse-reference.png'), clip });
    await tab.screenshot({ path: path.join(out, `browse-reference-${t.id}.png`), clip, scale: 'css' });
    face.page = await walkOf('.shell');
    face.nowbar = await walkOf('#nowBar');
    face.tree = await walkOf('#tree');
    // The other panes of the left panel, each as the rail's Library items show it.
    for (const pane of ['search', 'scan', 'import']) {
      await tab.evaluate((p) => showPane('left', p), pane);
      if (pane === 'search') {
        await tab.evaluate(() => { $('searchInput').value = 'kit'; $('searchInput').oninput(); });
      }
      await tab.waitForTimeout(400);
      face['pane_' + pane] = await walkOf('#leftPanel');
      if (pane === 'search') {
        await tab.evaluate(() => $('similarBtn').onclick());
        await tab.waitForTimeout(2500);
        face.pane_similar = await walkOf('#leftPanel');
      }
    }
    await tab.evaluate(() => showPane('left', 'browse'));
    // The folder picker, open on the library's folder.
    await tab.evaluate(() => openPicker(state.library));
    await tab.waitForTimeout(800);
    face.picker = await walkOf('#pickerModal');
    await tab.evaluate(() => $('pickerModal').classList.add('hidden'));
    // Advanced view, on the sound picked.
    await tab.evaluate(() => avOpen());
    await tab.waitForTimeout(400);
    face.advanced = await tab.evaluate(() => { const m = document.querySelector('.av-modal, #avModal, .modal:not(.hidden)'); return m ? (m.id ? '#' + m.id : '.' + [...m.classList].join('.')) : ''; });
    if (face.advanced) face.advanced = await walkOf(face.advanced);
    await tab.evaluate(() => { document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden')); document.querySelectorAll('.av-modal, #avModal').forEach((m) => m.remove()); });
    write(path.join(out, `mgl-browse-${t.id}.json.gz`), face);
    process.stdout.write(`  ${t.id}: browse ${face.page.nodes} boxes\n`);

    // ── the Library page: the first group, its first sound ──
    await tab.evaluate(() => setMode('pclib'));
    for (let i = 0; i < 60; i++) {
      if (await tab.evaluate(() => !LB.busy)) break;
      await tab.waitForTimeout(500);
    }
    await tab.waitForTimeout(3000);
    const lib = { size: [1500, 780], theme: t.id, captured: new Date().toISOString() };
    lib.cl = face.cl;
    const lclip = { x: 168, y: 0, width: 1500, height: 780 };
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'library-reference.png'), clip: lclip });
    await tab.screenshot({ path: path.join(out, `library-reference-${t.id}.png`), clip: lclip, scale: 'css' });
    lib.page = await walkOf('#libraryView');
    await tab.evaluate(() => { LB.kind = 'hit'; lbGroupsDraw(); });
    await tab.waitForTimeout(300);
    lib.hits = await walkOf('#libraryView');
    write(path.join(out, `mgl-library-${t.id}.json.gz`), lib);
    process.stdout.write(`  ${t.id}: library ${lib.page.nodes} boxes\n`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
