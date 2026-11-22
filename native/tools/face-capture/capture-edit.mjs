// Capture MGL's Edit page for the native app, in every theme.
//
//   node native/tools/face-capture/capture-edit.mjs <out-folder> [theme-id ...]
//
// The Edit page (`body.wavepage`: ui/app/310-edit-page.js, 411-416, edit.css)
// is not a fixed size in MGL: it fills the window. It is captured as RJ uses
// it, in a 1668 x 1100 window with the rail 168 wide: the centre (1500 x 1052)
// and the Now Playing bar under it (1500 x 48), served from the checkout as
// capture.mjs serves Wave, with no engine behind it (every /api call fails).
//
// For each theme MGL's Theme page lists (and `default`):
//   <out>/mgl-edit-<id>.json.gz  {
//     size,           [1500, 1100]
//     empty, open,    the centre with no sound, and with one open and a range
//                     selected (the page's own drawing of each, its parts
//                     placed as the page places them)
//     nowbar,         the Now Playing bar, placed under the centre
//     bar: { empty, open, custom }   the tool bar down the right, laid out
//                     whole (it scrolls in the page), with nothing open, with
//                     a sound and a selection, and while customizing
//     knobs: { <cmd>: tree }         the ▾ settings of each command that has them
//     pie, cmdk, loupe, ask          the pie, ⌘K with its list, the loupe,
//                     and the dialog the menus ask in
//   }
// and, for the default theme only, <out>/edit-reference.png (the page with no
// sound, at 2x) and <out>/edit-reference-open.png (with the sound, at 2x).

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
if (!out) {
  console.error('usage: capture-edit.mjs <out-folder> [theme-id ...]');
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
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url.startsWith('/api/') || url.startsWith('/audio')) { res.writeHead(404); return res.end(); }
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

// Left out of every picture: the toasts (there is no server behind it).
const SKIP = ['.toast', '#toast', '.toasts'];

// A sound open, a range selected, as the page has them once a sound is read:
// the page's own state set and its own painters run, so what shows is what
// the page shows. The wave's canvases are left empty (the native face draws
// them); only the boxes round them are wanted.
const open = () => {
  const frames = 88200, sr = 44100, cols = 400;
  const ch = () => ({ min: new Array(cols).fill(-0.4), max: new Array(cols).fill(0.4), rms: new Array(cols).fill(0.2) });
  state.selectedFile = { path: 'kit/sound.wav', name: 'sound.wav', duration: 2, category: 'SAMPLE' };
  state.view.from = 0; state.view.to = frames; state.view.frames = frames; state.view.sampleRate = sr;
  state.peaks = { frames, from: 0, to: frames, columns: cols, sampleRate: sr, channels: [ch(), ch()] };
  state.overview = { frames, from: 0, to: frames, columns: cols, sampleRate: sr, channels: [ch(), ch()] };
  state.edit = { frames, baseFrames: frames, canUndo: true, canRedo: true, edited: true, clipboard: 0 };
  state.sel = { start: 22050, end: 55125 };
  state.cue = 22050;
  reflectEditState();
  drawSelection();
  drawCue();
  nbSetFile(state.selectedFile);
  wtSync();
  edPaintCounters();
  edPaintHands();
  $('laneEmpty').classList.add('hidden');
  // The playhead, shown where the cue is.
  const ph = $('playhead');
  if (ph) { ph.style.display = 'block'; ph.style.transform = $('cue').style.transform; }
};

// The bar laid out whole: in the page it scrolls; here it is let out to its
// full height to be walked, and put back.
const barWhole = (on) => {
  const b = $('waveTools');
  b.style.overflow = on ? 'visible' : '';
  b.style.height = on ? 'auto' : '';
  b.style.maxHeight = on ? 'none' : '';
  b.style.flex = on ? 'none' : '';
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
    const ctx = await browser.newContext({ viewport: { width: 1668, height: 1100 }, deviceScaleFactor: scale });
    const tab = await ctx.newPage();
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.evaluate((chosen) => {
      localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
      // The page as it starts for anyone: nothing kept from a session before.
      for (const k of ['editBar', 'editShow', 'editParams', 'mgl.pageOverview.h']) localStorage.removeItem(k);
    }, t.id === 'default' ? null : t.id);
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.waitForTimeout(300);
    await tab.evaluate(() => { setEditPage('wave', false); setMode('edit'); });
    await tab.waitForTimeout(1500);
    await tab.evaluate((skip) => skip.forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })), SKIP);
    const rect = await tab.evaluate(() => {
      const c = document.querySelector('.centre').getBoundingClientRect(), n = $('nowBar').getBoundingClientRect();
      return { centre: [c.x, c.y, c.width, c.height], now: [n.x, n.y, n.width, n.height] };
    });
    if (rect.centre[2] !== 1500 || rect.centre[3] !== 1052 || rect.now[1] !== 1052) throw new Error(`${t.id}: the page is ${JSON.stringify(rect)}`);
    const walkOf = async (sel, skip = SKIP) => {
      const r = await tab.evaluate(`(${walk})(${JSON.stringify(sel)}, ${JSON.stringify(skip)})`);
      if (r.error) throw new Error(`${t.id} ${sel}: ${r.error}`);
      return r;
    };
    const face = { size: [1500, 1100], theme: t.id, captured: new Date().toISOString(), bar: {}, knobs: {} };

    // ── no sound ──
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'edit-reference.png'), clip: { x: 168, y: 0, width: 1500, height: 1100 } });
    // EDIT_REFS=<folder>: every theme's picture too, at 1x, to check the face in each.
    if (process.env.EDIT_REFS) await tab.screenshot({ path: path.join(process.env.EDIT_REFS, `edit-reference-${t.id}.png`), clip: { x: 168, y: 0, width: 1500, height: 1100 } });
    face.empty = await walkOf('.centre');
    face.nowbar = await walkOf('#nowBar');
    await tab.evaluate(`(${barWhole})(true)`);
    face.bar.empty = await walkOf('#waveTools');
    await tab.evaluate(`(${barWhole})(false)`);

    // ── a sound open, a range selected ──
    await tab.evaluate(`(${open})()`);
    await tab.waitForTimeout(200);
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'edit-reference-open.png'), clip: { x: 168, y: 0, width: 1500, height: 1100 } });
    face.open = await walkOf('.centre');
    face.nowbarOpen = await walkOf('#nowBar');
    // Playing, with the loop on: the transport's lit switches.
    await tab.evaluate(() => { state.loopOn = true; paintLoop(); engine.playing = true; $('playBtn').classList.add('on'); nbPaintPlay(); });
    face.nowbarLit = await walkOf('#nowBar');
    await tab.evaluate(() => { state.loopOn = false; paintLoop(); engine.playing = false; $('playBtn').classList.remove('on'); nbPaintPlay(); });
    await tab.evaluate(`(${barWhole})(true)`);
    face.bar.open = await walkOf('#waveTools');
    await tab.evaluate(`(${barWhole})(false)`);

    // ── the ▾ settings, each command's ──
    for (const id of await tab.evaluate(() => Object.keys(ED_KNOBS))) {
      await tab.evaluate((id) => { const b = document.querySelector(`#waveTools .wt-more[data-more="${id}"]`); edKnobsOpen(id, b); }, id);
      await tab.waitForTimeout(50);
      face.knobs[id] = await walkOf('#edKnobs');
      await tab.evaluate(() => edKnobsClose());
    }

    // ── the pie, ⌘K, the loupe, a dialog ──
    await tab.evaluate(() => edPieOpen(700, 500));
    face.pie = await walkOf('#edPie');
    await tab.evaluate(() => edPieClose());
    await tab.evaluate(() => edKOpen());
    await tab.waitForTimeout(50);
    face.cmdk = await walkOf('#edK');
    await tab.evaluate(() => edKClose());
    await tab.evaluate(() => {
      const m = new Float32Array(88200);
      for (let i = 0; i < m.length; i++) m[i] = 0.5 * Math.sin(i / 20);
      edSound.mono = m;
      edLoupe(30000);
    });
    face.loupe = await walkOf('#edLoupe');
    await tab.evaluate(() => { edLoupe(null); edSound.mono = null; });
    await tab.evaluate(() => { setSelectionDialog(); });
    await tab.waitForTimeout(50);
    face.ask = await walkOf('#askModal');
    await tab.evaluate(() => $('askCancel').click());

    // ── customizing ──
    await tab.evaluate(() => { wtEditing = true; wtRender(); });
    await tab.evaluate(`(${barWhole})(true)`);
    face.bar.custom = await walkOf('#waveTools');
    await tab.evaluate(`(${barWhole})(false)`);
    await tab.evaluate(() => { wtEditing = false; wtRender(); });

    if (scale === 2) {
      // The page's own lists, for the face to read (engine-app needs none).
      const data = await tab.evaluate(() => ({
        groups: WT_GROUPS.map(([title, items]) => [title, items.map((it) => ({ id: it.id, name: it.name, key: it.key || '', need: it.need || '' }))]),
        words: WT_WORDS, svg: WT_SVG, order: ED_BAR_ORDER, hidden: ED_BAR_HIDDEN,
        knobs: Object.fromEntries(Object.entries(ED_KNOBS).map(([k, v]) => [k, v.map(([p, l, a, b, s, , log, title]) => [p, l, a, b, s, !!log, title])])),
        params: ED_PARAM_DEF, prefs: { rainbow: true, spec: true, level: true, hits: false, loud: false, snapHits: false },
        pie: ED_PIE,
      }));
      fs.writeFileSync(path.join(out, 'edit-page.json'), JSON.stringify(data));
    }
    write(path.join(out, `mgl-edit-${t.id}.json.gz`), face);
    process.stdout.write(`  ${t.id}: ${face.empty.nodes} + ${face.open.nodes} + ${face.nowbar.nodes} boxes, bar ${face.bar.open.size[1]} tall\n`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
