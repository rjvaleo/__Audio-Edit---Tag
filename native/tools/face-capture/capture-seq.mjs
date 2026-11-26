// Capture MGL's Seq page for the native app, in the main 3 themes.
//
//   node native/tools/face-capture/capture-seq.mjs <out-folder> [theme-id ...]
//
// The Seq page is the sequencer's frame with no `only-*` class: the scale
// sequencer as it was built (ui/sequencer/style.css, "THE SEQ PAGE"): the
// header, the transport and presets, the scale library, the synth and its
// filter, three LFOs and the delay, the tuning, the steps, the performance
// and the 88 keys. It is served from the checkout, as capture-atmos.mjs
// serves Atmosphere, with no engine behind it, and opened at the page's own
// width (1500, RJ's window less the rail). The frame is made exactly as tall
// as what is on it.
//
// For each of the main 3 MGL themes (RJ, 25 Nov 2026: Default, Studio light,
// Layered dark), or those named:
//   <out>/mgl-seq-<id>.json.gz   { page }: the frame's page, walked (walk.js)
// and, for the default theme only:
//   <out>/seq-reference.png      the page as Chromium draws it, at 2x
//   <out>/seq-page.json          the page's own lists: its scales, its
//                                controls' ranges, the steps (engine-app
//                                reads it)
//
// Each knob is marked with its colour (`data-kc`), its track, and what it sets
// (`data-k`, the page's key, and its range); each select with its key.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mgl = path.resolve(here, '../../..');
// Playwright from this checkout, or from the main one (a worktree has none).
const require = createRequire(fs.existsSync(path.join(mgl, 'node_modules/playwright')) ? path.join(mgl, 'package.json') : '/Users/rjvaleo/Documents/MultiGrainLive/package.json');
const { chromium } = require('playwright');

const MAIN = ['default', 'studio-light', 'layered-dark'];
const [out, ...named] = process.argv.slice(2);
if (!out) {
  console.error('usage: capture-seq.mjs <out-folder> [theme-id ...]');
  process.exit(2);
}
const only = named.length ? named : MAIN;
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

// What the page hides on Seq is display:none and is not walked.
const SKIP = [];

const mark = () => {
  const probe = document.createElement('i');
  document.body.append(probe);
  const rgb = (css) => { probe.style.color = ''; probe.style.color = css; return getComputedStyle(probe).color; };
  for (const k of document.querySelectorAll('.knob')) {
    k.dataset.kc = rgb(getComputedStyle(k).getPropertyValue('--kc').trim());
    k.dataset.track = rgb(getComputedStyle(k).getPropertyValue('--look-track').trim());
    const g = k.closest('.knob-group, .lfo-knob');
    const inp = g && g.querySelector('input[type=range]');
    if (inp) Object.assign(k.dataset, { k: inp.id.replace(/Slider$/, ''), min: inp.min, max: inp.max, step: inp.step || '1' });
  }
  probe.remove();
  for (const s of document.querySelectorAll('select')) if (s.id) s.dataset.k = s.id.replace(/Select$/, '');
  document.querySelectorAll('.step').forEach((el, i) => { el.dataset.step = String(i); });
  document.querySelectorAll('.kb-key').forEach((el) => { if (el.id) el.dataset.key = el.id.replace(/^key-/, ''); });
  document.querySelectorAll('.scale-item').forEach((el, i) => { el.dataset.scale = String(i); });
};

const browser = await chromium.launch();
try {
  let height = 0;
  for (const id of only) {
    const scale = id === 'default' ? 2 : 1;
    const fit = async (h) => {
      const ctx = await browser.newContext({ viewport: { width: 168 + 1500, height: h + 88 }, deviceScaleFactor: scale });
      const tab = await ctx.newPage();
      await tab.goto(base + '/index.html', { waitUntil: 'load' });
      await tab.evaluate((chosen) => {
        localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
      }, id === 'default' ? null : id);
      await tab.goto(base + '/index.html', { waitUntil: 'load' });
      await tab.waitForTimeout(200);
      await tab.evaluate(() => setMode('seq'));
      await tab.waitForTimeout(2500);
      const frame = tab.frames().find((f) => f.url().includes('/sequencer/'));
      const need = await frame.evaluate(() => {
        const page = document.querySelector('.page');
        const pad = parseFloat(getComputedStyle(page).paddingBottom) || 0;
        let bottom = 0;
        for (const el of page.querySelectorAll(':scope > *, .right-panel > *, .right-panel section.panel')) {
          const r = el.getBoundingClientRect();
          if (r.height > 0) bottom = Math.max(bottom, r.bottom);
        }
        return Math.ceil(bottom + pad);
      });
      return { ctx, tab, frame, need };
    };
    let got;
    if (!height) {
      got = await fit(892);
      let h = got.need;
      await got.ctx.close();
      got = await fit(h);
      if (got.need !== h) { h = got.need; await got.ctx.close(); got = await fit(h); }
      height = h;
    } else got = await fit(height);
    const { ctx, tab, frame } = got;
    const rect = await tab.evaluate(() => {
      const f = document.querySelector('#seqView iframe') || document.querySelector('iframe');
      const r = f.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    });
    if (rect[2] !== 1500 || Math.round(rect[3]) !== height) throw new Error(`${id}: the frame is ${rect}, not 1500 x ${height}`);
    await frame.evaluate(mark);
    await tab.evaluate(() => document.querySelectorAll('.toast, #toast, .toasts').forEach((e) => { e.style.visibility = 'hidden'; }));
    const page = await frame.evaluate(`(${walk})(".page", ${JSON.stringify(SKIP)})`);
    if (page.error) throw new Error(`${id} page: ${page.error}`);
    // The page's picture, as it opens: before anything is staged on it.
    if (id === 'default') await tab.screenshot({ path: path.join(out, 'seq-reference.png'), clip: { x: rect[0], y: rect[1], width: 1500, height } });
    // The page's own lists, as it opens.
    if (id === 'default') {
      const data = await frame.evaluate(() => ({
        scales: SCALES.map((s) => ({ cat: s.cat, name: s.name, info: s.info, cents: s.cents })),
        knobs: [...document.querySelectorAll('input[type=range]')].map((i) => [i.id.replace(/Slider$/, ''), +i.min, +i.max, +(i.step || 1), +i.value]),
        selects: [...document.querySelectorAll('select')].filter((s) => s.id).map((s) => [s.id.replace(/Select$/, ''), [...s.options].map((o) => [o.value, o.textContent]), s.selectedIndex]),
        steps: steps.map((s) => [s.degree, s.rest]),
        seq: { scale: selectedScaleIdx, root: rootMidi, octave: rootOctave, numSteps },
      }));
      fs.writeFileSync(path.join(out, 'seq-page.json'), JSON.stringify(data));
    }
    // The parts the page makes as it plays, staged on the same page and walked
    // again, so the face has each look: step 1 picked (its buttons open), step
    // 2 resting, step 3 playing, step 10 (not played) resting; a key playing;
    // Play lit; the whole scale list (it scrolls); a two-row scale's chips.
    const parts = {};
    parts.grid = await frame.evaluate(`(() => {
      pickStep(0); steps[1].rest = true; steps[9].rest = true; renderStepGrid(); pickStep(0);
      document.getElementById('step-2').classList.add('playing-step');
      document.querySelectorAll('.step').forEach((el, i) => { el.dataset.step = String(i); });
      return (${walk})(".seq-panel", []);
    })()`);
    parts.keys = await frame.evaluate(`(() => {
      const k = document.getElementById('key-48'); if (k) k.classList.add('playing-key');
      document.querySelectorAll('.kb-key').forEach((el) => { el.dataset.key = el.id.replace(/^key-/, ''); });
      return (${walk})(".kb-strip", []);
    })()`);
    parts.play = await frame.evaluate(`(() => {
      const b = document.getElementById('playBtn'); b.textContent = '⏸ PAUSE'; b.classList.add('active');
      return (${walk})("#playBtn", []);
    })()`);
    parts.list = await frame.evaluate(`(() => {
      const l = document.getElementById('scaleList');
      const r = l.getBoundingClientRect();
      const st = l.getAttribute('style') || '';
      l.style.maxHeight = 'none'; l.style.height = 'auto'; l.style.overflow = 'visible';
      const w = (${walk})("#scaleList", []);
      l.setAttribute('style', st);
      w.view = [r.x, r.y, r.width, r.height];
      return w;
    })()`);
    parts.chips = await frame.evaluate(`(() => {
      const i = SCALES.findIndex((s) => s.cents.length > 12);
      selectScale(i);
      const w = (${walk})(".scale-display", []);
      w.scale = i;
      selectScale(0);
      return w;
    })()`);
    for (const [k, w] of Object.entries(parts)) if (w.error) throw new Error(`${id} ${k}: ${w.error}`);
    // Where each part's root sits on the page (its walk is relative to it).
    const roots = { grid: '.seq-panel', keys: '.kb-strip', play: '#playBtn', list: '#scaleList', chips: '.scale-display' };
    for (const [k, sel] of Object.entries(roots)) {
      parts[k].at = await frame.evaluate((sel) => {
        const p = document.querySelector('.page').getBoundingClientRect(), r = document.querySelector(sel).getBoundingClientRect();
        return [r.x - p.x, r.y - p.y];
      }, sel);
    }
    const page0 = await frame.evaluate(() => { const r = document.querySelector('.page').getBoundingClientRect(); return [r.x, r.y]; });
    write(path.join(out, `mgl-seq-${id}.json.gz`), { page, parts, origin: page0, size: [1500, height], theme: id, captured: new Date().toISOString() });
    process.stdout.write(`  ${id}: ${page.nodes} boxes, 1500 x ${height}\n`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
