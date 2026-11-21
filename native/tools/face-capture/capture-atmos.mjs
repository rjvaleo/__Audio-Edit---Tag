// Capture MGL's Atmosphere page for the native app, in every theme.
//
//   node native/tools/face-capture/capture-atmos.mjs <out-folder> [theme-id ...]
//
// The Atmosphere page is the sequencer's frame with only Atmosphere showing
// (`body.only-atmos`, ui/sequencer/style.css) and the app's keyboard dock
// under it (ui/app/212-atmos-dock.js). Both are served from the checkout, as
// capture.mjs serves Wave, with no engine behind them, and opened at the
// page's own width (1500). The frame is made exactly as tall as what is on
// it, so the face is the page with nothing to spare.
//
// For each theme MGL's Theme page lists (and its default, `default`):
//   <out>/mgl-atmos-<id>.json.gz   { page, dock }: the frame's page and the
//                                  dock, each walked (walk.js), the dock
//                                  placed under the page
// and, for the default theme only:
//   <out>/atmos-reference.png      the two as Chromium draws them, at 2x
//   <out>/atmos-page.json          the page's own lists: its knobs, models,
//                                  LFO targets, scales (engine-app reads it)
//
// Each knob is marked with its colour (`--kc`, its family's) as `data-kc`;
// each control with what it sets (`data-k`, the page's key).

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
  console.error('usage: capture-atmos.mjs <out-folder> [theme-id ...]');
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

// What the page leaves out of the picture: its hidden parts, and the toast
// that says the server is not there (there is none behind it).
const SKIP = ['.at-hidden'];

// Mark what the native face needs to know of each control.
const mark = () => {
  const probe = document.createElement('i');
  document.body.append(probe);
  const rgb = (css) => { probe.style.color = ''; probe.style.color = css; return getComputedStyle(probe).color; };
  for (const k of document.querySelectorAll('.knob')) {
    k.dataset.kc = rgb(getComputedStyle(k).getPropertyValue('--kc').trim());
    k.dataset.track = rgb(getComputedStyle(k).getPropertyValue('--look-track').trim());
    const g = k.closest('.knob-group, .lfo-knob');
    const inp = g && g.querySelector('input[type=range]');
    if (inp) Object.assign(k.dataset, { k: inp.id.replace(/Slider$/, ''), min: inp.min, max: inp.max });
  }
  probe.remove();
  for (const s of document.querySelectorAll('select')) if (s.id) s.dataset.k = s.id.replace(/Select$/, '');
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

  // The page's height with nothing to spare: found once, in the default
  // theme, then kept for every theme so every theme is the same size.
  let height = 0;
  for (const t of list) {
    for (const scale of t.id === 'default' ? [2] : [1]) {
      const fit = async (h) => {
        const ctx = await browser.newContext({ viewport: { width: 168 + 1500, height: h + 208 }, deviceScaleFactor: scale });
        const tab = await ctx.newPage();
        await tab.goto(base + '/index.html', { waitUntil: 'load' });
        await tab.evaluate((chosen) => {
          localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
        }, t.id === 'default' ? null : t.id);
        await tab.goto(base + '/index.html', { waitUntil: 'load' });
        await tab.waitForTimeout(200);
        await tab.evaluate(() => setMode('atmos'));
        await tab.waitForTimeout(2500);
        const frame = tab.frames().find((f) => f.url().includes('/sequencer/'));
        const need = await frame.evaluate(() => {
          const page = document.querySelector('.page');
          const pad = parseFloat(getComputedStyle(page).paddingBottom) || 0;
          let bottom = 0;
          for (const el of page.querySelectorAll('.right-panel > *, .right-panel section.panel')) {
            const r = el.getBoundingClientRect();
            if (r.height > 0) bottom = Math.max(bottom, r.bottom);
          }
          return Math.ceil(bottom + pad);
        });
        return { ctx, tab, frame, need };
      };
      let got;
      if (!height) {
        // Twice: the oscillators' pictures are sized by the frame's height.
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
        const d = document.querySelector('#atmosDock').getBoundingClientRect();
        return { frame: [r.x, r.y, r.width, r.height], dock: [d.x, d.y, d.width, d.height] };
      });
      if (rect.frame[2] !== 1500 || Math.round(rect.frame[3]) !== height) throw new Error(`${t.id}: the frame is ${rect.frame}, not 1500 x ${height}`);
      await frame.evaluate(mark);
      await tab.evaluate(mark);
      await tab.evaluate(() => document.querySelectorAll('.toast, #toast, .toasts').forEach((e) => { e.style.visibility = 'hidden'; }));
      const page = await frame.evaluate(`(${walk})(".page", ${JSON.stringify(SKIP)})`);
      if (page.error) throw new Error(`${t.id} page: ${page.error}`);
      const dock = await tab.evaluate(`(${walk})("#atmosDock", [])`);
      if (dock.error) throw new Error(`${t.id} dock: ${dock.error}`);
      const face = { page, dock, size: [1500, height + rect.dock[3]], theme: t.id, captured: new Date().toISOString() };
      write(path.join(out, `mgl-atmos-${t.id}.json.gz`), face);
      if (t.id === 'default') {
        await tab.screenshot({ path: path.join(out, 'atmos-reference.png'), clip: { x: rect.frame[0], y: rect.frame[1], width: 1500, height: height + rect.dock[3] } });
        const data = await frame.evaluate(() => ({
          knobs: AT_KNOBS.map((k) => k.slice(0, 5)),
          models: AT_MODELS, modelDefault: AT_MODEL_DEFAULT,
          lfoTargets: AT_LFO_TARGETS, lfoScale: AT_LFO_SCALE,
          lfoShapes: [['sine', 'Sine'], ['triangle', 'Tri'], ['sawtooth', 'Saw'], ['square', 'Square']],
          symTune: [['degrees', 'Degrees'], ['fifths', 'Root + 5th'], ['root', 'Root']],
          scales: SCALES.map((s) => ({ name: s.name, cents: s.cents })),
          seq: { scale: selectedScaleIdx, root: rootMidi, octave: rootOctave },
        }));
        fs.writeFileSync(path.join(out, 'atmos-page.json'), JSON.stringify(data));
      }
      process.stdout.write(`  ${t.id}: ${page.nodes} + ${dock.nodes} boxes, 1500 x ${face.size[1]}\n`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
