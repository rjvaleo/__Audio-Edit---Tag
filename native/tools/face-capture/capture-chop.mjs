// Capture MGL's Chop page for the native app, in every theme.
//
//   node native/tools/face-capture/capture-chop.mjs <out-folder> [theme-id ...]
//
// The Chop page (ui/app/400-406-chop*, 405b, chop.css, `#dockChop`) is laid
// out at one fixed size, 1432 x 1000 (`.chop-app`). It is served from the
// checkout as capture.mjs serves Wave, with no engine behind it (every /api
// call fails), with the reference break open (native/engine-mgl/tests/
// reference/chop/break.f32, 2 s at 48 kHz, two channels: the sound Chop's
// port is proven on), measured, and slice 3 picked: the page as it is once a
// sound has been chosen.
//
// For each theme MGL's Theme page lists (and `default`):
//   <out>/mgl-chop-<id>.json.gz  {
//     size,          [1432, 1000]
//     page,          the page with the break open, slice 3 picked
//     empty,         the page with no sound
//     lit,           Grid, every switch and toggle on (Preview, Ratchet, Soft,
//                    the Tail, every module, + MIDI, + SFZ), Follow off, a slice
//                    current, two picked, one muted, one reversed, a cut
//                    locked, the tail badges of all three kinds, the BPM bad,
//                    the edits and the said line shown
//     legends: { <view>: tree }   the legend in each Colour view, placed in the page
//     cl,            the page's colours as its canvases read them (chopTok),
//                    and the CSS colours the face draws with, resolved to rgb
//     pics,          how the pictures' strokes are drawn (.ui-pic and svg.gg's
//                    .a .f .af .ff), read from the page
//   }
// and, for the default theme only, <out>/chop-reference.png (the page, 2x),
// chop-reference-empty.png and chop-reference-lit.png (1x), and
// <out>/chop-page.json: the page's own tables (every knob's range, step, log,
// default, words and facet; the processing modules' layout and pictures; the
// Colour views; the kinds; CHOP_DEF; the hint), which the face reads.
// CHOP_REFS=<folder> also writes every theme's page at 1x there.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mgl = path.resolve(here, '../../..');
const require = createRequire(process.env.MGL_NODE_MODULES ? path.join(process.env.MGL_NODE_MODULES, 'x.js') : path.join(mgl, 'package.json'));
const { chromium } = require('playwright');

const [out, ...only] = process.argv.slice(2);
if (!out) {
  console.error('usage: capture-chop.mjs <out-folder> [theme-id ...]');
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

// The reference break, as two channels of floats.
const raw = fs.readFileSync(path.join(mgl, 'native/engine-mgl/tests/reference/chop/break.f32'));
const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const BREAK = [[], []];
for (let i = 0; i < all.length; i++) BREAK[i & 1].push(all[i]);

// Left out of every picture: the toasts (there is no server behind it), and
// the Now bar's and the rail's own (not the page's).
const SKIP = ['.toast', '#toast', '.toasts'];
const VIEWS = ['spectrum', 'bright', 'noise', 'pitch', 'attack', 'level', 'kind', 'white'];

// The break open, as the page has it once the sound is chosen and read.
const open = async (chs) => {
  state.selectedFile = { path: 'kit/break.wav', name: 'break.wav', duration: 2, sampleRate: 48000, channels: 2, bits: 32, frames: 96000, format: 'wav', category: 'LOOP' };
  chop.path = 'kit/break.wav';
  window.Chop.loadSamples(chs.map((c) => Float32Array.from(c)), 48000, 'break');
  await window.Chop.analysed;
  chop.path = 'kit/break.wav';
  chopStats();
  chopPick(2);
  chopDrawPictures();
};

// The page's colours as its canvases read them, and the CSS ones the face
// draws with, each resolved to rgb() by the browser.
const colours = () => {
  const probe = document.createElement('i');
  document.body.append(probe);
  const rgb = (css) => { probe.style.color = ''; probe.style.color = css; return getComputedStyle(probe).color; };
  const app = document.querySelector('.chop-app');
  const s = getComputedStyle(app), v = (k) => s.getPropertyValue(k).trim();
  chopReadLook();
  const out = {};
  for (const k of ['wave', 't', 't2', 't3', 'acc']) out[k] = rgb(chopTok[k]);
  out.bloom = rgb(`rgb(${chopTok.bloom})`).replace(/rgba?\(|\)/g, '');
  out.glow = chopTok.glow;
  for (const k of ['--chassis', '--panel', '--panel-hi', '--well', '--line', '--track', '--arc', '--mod', '--f-time', '--f-pitch', '--f-tone', '--f-attack', '--f-space', '--f-level', '--chop-bad', '--black', '--white', '--look-accent', '--look-wave-ink', '--look-scroll']) out[k] = rgb(v(k));
  for (const k of ['--on-rgb', '--white-rgb', '--black-rgb', '--look-well-rgb']) out[k] = v(k);
  out.look = document.documentElement.dataset.mglLook || '';
  probe.remove();
  return out;
};

// How the pictures' marks are drawn, from the page's own elements.
const pics = () => {
  const one = (el) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    return { stroke: c.stroke, fill: c.fill, width: c.strokeWidth, opacity: c.opacity, display: c.display };
  };
  const out = {};
  const knob = document.querySelector('#chopKnobs .chop-knob .ui-pic');
  const bar = document.querySelector('#chopFx .chop-fx-bar > svg.gg');
  for (const [name, host] of [['knob', knob], ['bar', bar]]) {
    if (!host) continue;
    out[name] = {};
    for (const cls of ['a', 'f', 'af', 'ff']) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', cls);
      p.setAttribute('d', 'M0 0L1 1');
      host.append(p);
      out[name][cls] = one(p);
      p.remove();
    }
  }
  return out;
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
      for (const k of ['chopSettings', 'chopPresets', 'chopColour', 'chopSoft']) localStorage.removeItem(k);
    }, t.id === 'default' ? null : t.id);
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.waitForTimeout(300);
    await tab.evaluate(() => { setEditPage('chop', false); setMode('edit'); });
    await tab.waitForTimeout(800);
    await tab.evaluate((skip) => skip.forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })), SKIP);
    const rect = await tab.evaluate(() => {
      const app = document.querySelector('#dockChop .chop-app');
      app.style.transform = 'none';
      const r = app.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    });
    if (rect[2] !== 1432 || rect[3] !== 1000) throw new Error(`${t.id}: the page is ${rect}`);
    const clip = { x: rect[0], y: rect[1], width: 1432, height: 1000 };
    const walkOf = async (sel) => {
      const r = await tab.evaluate(`(${walk})(${JSON.stringify(sel)}, ${JSON.stringify(SKIP)})`);
      if (r.error) throw new Error(`${t.id} ${sel}: ${r.error}`);
      return r;
    };
    const shot = async (name) => { await tab.screenshot({ path: name, clip }); };
    const face = { size: [1432, 1000], theme: t.id, captured: new Date().toISOString(), legends: {} };

    // No sound yet.
    await tab.waitForTimeout(200);
    if (scale === 2) await shot(path.join(out, 'chop-reference-empty.png'));
    face.empty = await walkOf('#dockChop .chop-app');

    // The break, read and measured, slice 3 picked.
    await tab.evaluate(`(${open})(${JSON.stringify(BREAK)})`);
    await tab.waitForTimeout(400);
    // The page keeps the transform it fits itself with; the capture is 1:1.
    await tab.evaluate(() => { document.querySelector('#dockChop .chop-app').style.transform = 'none'; });
    face.cl = await tab.evaluate(`(${colours})()`);
    face.pics = await tab.evaluate(`(${pics})()`);
    if (scale === 2) await shot(path.join(out, 'chop-reference.png'));
    if (process.env.CHOP_REFS) await shot(path.join(process.env.CHOP_REFS, `chop-reference-${t.id}.png`));
    face.page = await walkOf('#dockChop .chop-app');

    // The legend in each Colour view.
    for (const v of VIEWS) {
      await tab.evaluate((v) => window.Chop.setColour(v), v);
      await tab.waitForTimeout(60);
      face.legends[v] = await walkOf('#chopLegend');
    }
    await tab.evaluate(() => window.Chop.setColour('spectrum'));

    // Everything lit.
    await tab.evaluate(() => {
      chopSetting('mode', 'grid');
      chopSetting('div', '16');
      chopSetting('tail', true);
      chopSetting('tailMs', 200);
      for (const k of ['envOn', 'trOn', 'eqOn', 'fltOn', 'outMidi', 'outSfz']) chopSetting(k, true);
      chopSetting('fltType', 'hp');
      chopSetting('sync', 'lock');
      chop.slices[1].locked = true; chop.slices[3].muted = true; chop.slices[4].rev = true; chop.slices[5].moved = true;
      chopChanged();
      chopPick(2); chopPick(6, { add: true }); chopPick(7, { add: true });
      chop.tool = 'lock';
      chopView.follow = false; $('chopFollow').classList.remove('on');
      document.querySelectorAll('#chopFollowMode button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'page'));
      chopSoft.on = true;
      chopTempoSaid.text = '2 bars, loops even';
      chopReflect();
      chopSay('Wrote 8 slices and the MIDI and SFZ to kit/break slices');
      $('chopPreview').classList.add('on');
      $('chopRatchet').classList.add('on');
      $('chopBpmBox').classList.add('bad');
      $('chopBpmNote').textContent = 'check Bars and Beats';
      chopPaintLane();
      document.querySelector('#chopLayer, .chop-layer .chop-ph')?.classList.remove('hidden');
      const ph = document.querySelector('.chop-layer .chop-ph');
      if (ph) { ph.classList.remove('hidden'); ph.style.left = '40%'; }
      const ro = document.querySelector('.chop-layer .chop-readout');
      if (ro) { ro.classList.remove('hidden'); ro.textContent = 'start 0.500 s · 125 ms'; ro.style.left = '30%'; }
      $('chopOverHead').classList.remove('hidden');
      $('chopOverHead').style.left = '40%';
      document.querySelector('#chopLayer .chop-cut')?.classList.add('going');
    });
    await tab.waitForTimeout(300);
    await tab.evaluate(() => { document.querySelector('#dockChop .chop-app').style.transform = 'none'; });
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'chop-reference-lit.png'), clip, scale: 'css' });
    face.lit = await walkOf('#dockChop .chop-app');

    if (scale === 2) {
      const data = await tab.evaluate(() => {
        const facet = (k) => CHOP_FACET[k] || null;
        const knob = (s) => ({ key: s[0], label: s[1], min: s[2], max: s[3], step: s[4], log: !!s[6], when: s[7] ? String(s[7]) : null, title: s[8], def: CHOP_DEF[s[0]], facet: facet(s[0]),
          words: [s[2], s[3], CHOP_DEF[s[0]]].map((v) => s[5](v)) });
        return {
          knobs: CHOP_KNOBS.map(([g, specs]) => [g, specs.map(knob)]),
          fx: Object.fromEntries(Object.entries(CHOP_FX).map(([fx, [on, specs]]) => [fx, { on, specs: specs.map(knob), layout: CHOP_FX_LAYOUT[fx], name: CHOP_FX_NAMES[fx] }])),
          fxLook: CHOP_FX_LOOK,
          def: CHOP_DEF,
          recut: [...CHOP_RECUT],
          views: CHOP_VIEWS.map(([v, n, t, st]) => ({ v, name: n, title: t, stops: st })),
          kinds: CHOP_KIND,
          hint: CHOP_HINT,
          colors: CHOP_COLORS,
        };
      });
      fs.writeFileSync(path.join(out, 'chop-page.json'), JSON.stringify(data));
    }
    write(path.join(out, `mgl-chop-${t.id}.json.gz`), face);
    process.stdout.write(`  ${t.id}: page ${face.page.nodes}, empty ${face.empty.nodes}, lit ${face.lit.nodes} boxes, look ${face.cl.look}\n`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
