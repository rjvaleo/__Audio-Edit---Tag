// Capture MGL's FX page and every effect's card for the native app, in every theme.
//
//   node native/tools/face-capture/capture-fx.mjs <out-folder> [theme-id ...]
//
// The FX page (`ui/app/425-fx-page.js`, `057-fx.css`) is the Grain page's
// effects view on its own (`404-grain-rack.js`): the rack borrowed with its
// cards, OUT, SPECTRUM, the faders and meters, and a Sources panel on top; the
// grain engine's tabs and the dock put away. It is served from the checkout as
// capture-grain.mjs serves Grain, with no engine behind it, except `/api/fx`
// (the effects catalogue), answered with MGL's own answer
// (`given/fx.json`, recorded from MGL's `/api/fx`).
//
// For each theme MGL's Theme page lists (and `default`):
//   <out>/mgl-fx-<id>.json.gz  {
//     size,                    [1388, H]: the page as it is laid out
//     page,                    the FX page with MGL's factory rack (EQ, Comp)
//     pageOpen,                the same with a sound open and the PC's list
//     nowbar,                  MGL's Now bar (the shell's), which the page sits over
//     cards: { <kind>: { tree, rect } }
//                              each effect's card as the page draws it, alone
//                              in the rack
//     cardOff,                 the EQ's card switched off (the header's look)
//     picker: { top, <suite>: tree }   the Add menu, and each module in it
//     reverb,                  the Reverb window, on a reverb's card
//     cl                       the page's colours, resolved
//   }
// and, for the default theme only, <out>/fx-reference.png (the page, 2x),
// <out>/fx-card-<kind>.png (each card, 1x, for compare.py), and
// <out>/fx-page.json: every card's kind, label, suite and mode, its size and
// its controls (what the face reads).

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
  console.error('usage: capture-fx.mjs <out-folder> [theme-id ...]');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

const ui = path.join(mgl, 'ui');
const joined = {};
for (const [folder, ext, file] of [['app', 'js', 'app.js'], ['app-css', 'css', 'app.css'], ['room-paint', 'js', 'room-paint.js'], ['vis-gl', 'js', 'vis-gl.js'], ['stage', 'js', 'stage.js']]) {
  const dir = path.join(ui, folder);
  joined['/' + file] = fs.readdirSync(dir).filter((f) => f.endsWith('.' + ext)).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}
const FX_JSON = fs.readFileSync(path.join(here, 'given/fx.json'), 'utf8');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/api/fx') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(FX_JSON); }
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

const SKIP = ['.toast', '#toast', '.toasts', '#nowBar'];
// The picker's thumbnails are cards drawn small: the face stamps the card's own capture there.
const THUMBS = [...SKIP, '.fx-picker-thumb > *'];
const FACTORY_RACK = JSON.parse(fs.readFileSync(path.join(mgl, 'native/engine-app/tests/reference/grain/refs.json'), 'utf8')).presetsSaved.presets[0].rack;
// What the PC's list shows when it has been read (MGL's `/api/pc/library`
// shape); the face draws the real list over it.
const PC_LIST = [
  { file: 'Made/PC/rain-on-a-tin-roof.wav', prompt: 'rain on a tin roof, close', label: '', model: 'stable-audio-open-small', source: 'PC', seconds: 11.9, time: Date.UTC(2026, 10, 20, 14, 5) },
  { file: 'Made/PC/warm-pad.wav', prompt: 'a warm analogue pad in C minor', label: 'pad', model: 'tangoflux', source: 'PC', seconds: 10, time: Date.UTC(2026, 10, 19, 9, 41) },
  { file: 'Made/PC/break.wav', prompt: 'dusty breakbeat at 92 bpm', label: '', model: 'ace-step-1.5', source: 'MGL', seconds: 30, time: Date.UTC(2026, 10, 18, 22, 10) },
];

// A sound open, as capture-grain.mjs opens one (the document at its defaults).
const open = (rack, named) => {
  const frames = 96000, sr = 48000, cols = 400;
  const ch = () => ({ min: new Array(cols).fill(-0.4), max: new Array(cols).fill(0.4), rms: new Array(cols).fill(0.2) });
  if (named) {
    state.selectedFile = { path: 'kit/sound.wav', name: 'sound.wav', duration: 2, sampleRate: sr, channels: 2, bits: 24, frames, format: 'wav', category: 'SAMPLE' };
    state.view.from = 0; state.view.to = frames; state.view.frames = frames; state.view.sampleRate = sr;
    state.overview = { frames, from: 0, to: frames, columns: cols, sampleRate: sr, channels: [ch(), ch()] };
  }
  state.rack = rack;
  try { gsFxBuildRow(); } catch {}
  renderRack();
  document.querySelectorAll('#gsFxAddCard').forEach((e) => e.remove());
  try { gsFxDress(); gsFxAddCard(); } catch {}
};

// Every card the rack can hold: every mode of every module the picker offers
// (listed or not: all of prism-fx's 101 effects), and the three built-ins.
const kindsOf = () => {
  const out = [{ kind: 'eq', label: 'Parametric EQ' }, { kind: 'comp', label: 'Compressor' }, { kind: 'gain', label: 'Gain' }];
  const suites = (window.__fxCatalogue?.suites || state.suites);
  for (const s of suites.filter((x) => x.offered)) {
    for (const f of s.families) for (const m of f.modes) out.push({ kind: m.kind, label: m.label, suite: s.id, suiteLabel: s.label, family: f.label, mode: m.id, rev: m.rev });
  }
  return out;
};

// One card alone in the rack, as `addFxModule` makes it.
const lone = (k) => {
  const slot = defaultFxSlot(k.kind);
  slot.id = 'fx-card';
  if (k.mode) Object.assign(slot, { suite: k.suite, mode: k.mode, rev: k.rev });
  state.rack = { ...state.rack, slots: [slot] };
  renderRack();
  gsFxDress();
  document.querySelectorAll('#gsFxAddCard').forEach((e) => e.remove());
  gsFxAddCard();
  return slot;
};

// Mark what the face needs of each control: what it is, its key, its range.
const mark = () => {
  for (const card of document.querySelectorAll('#fxModuleRail > .fx-module')) {
    const slot = state.rack.slots[+card.dataset.slot];
    const sh = state.shapers[slot.kind];
    for (const el of card.querySelectorAll('.ui-knob[data-key]')) el.dataset.ctl = 'knob';
    for (const el of card.querySelectorAll('.fxt')) el.dataset.ctl = 'tile';
    for (const el of card.querySelectorAll('.fxf')) el.dataset.ctl = 'fader';
    for (const el of card.querySelectorAll('.fxs')) el.dataset.ctl = 'slider';
    for (const el of card.querySelectorAll('.gs-fxfoot .gs-bc')) el.dataset.ctl = 'foot';
    for (const el of card.querySelectorAll('.fx-face-display')) el.dataset.ctl = 'display';
    for (const el of card.querySelectorAll('.fx-led')) el.dataset.ctl = 'led';
    for (const el of card.querySelectorAll('.param')) el.dataset.ctl = el.dataset.ctl || 'param';
    void sh;
  }
};

const colours = () => {
  const probe = document.createElement('i');
  document.body.append(probe);
  const rgb = (css) => { probe.style.color = ''; probe.style.color = css; return getComputedStyle(probe).color; };
  const cl = gsCl(), out = {};
  for (const k of ['wave', 'acc', 'on', 'track', 't', 't2', 't3']) out[k] = rgb(cl[k]);
  out.bloom = rgb(`rgb(${cl.bloom})`).replace(/rgba?\(|\)/g, '');
  out.glow = cl.glow;
  out.mono = cl.mono;
  const s = getComputedStyle($('grainView')), v = (k) => s.getPropertyValue(k).trim();
  for (const k of ['--gs-f-level', '--gs-well', '--gs-line', '--gs-on', '--gs-t', '--gs-t2', '--gs-t3']) out[k] = rgb(v(k));
  probe.remove();
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
    const t1 = Date.now();
    const scale = t.id === 'default' ? 2 : 1;
    const ctx = await browser.newContext({ viewport: { width: 1668, height: 1100 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    const tab = await ctx.newPage();
    tab.on('pageerror', (e) => process.stdout.write(`  [${t.id}] page error: ${e.message}\n`));
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.evaluate((chosen) => {
      localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
    }, t.id === 'default' ? null : t.id);
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.waitForTimeout(300);
    await tab.evaluate(async () => { prefs.grainUi = 'synth'; await loadShapers(); setEditPage('fx', false); setMode('edit'); });
    await tab.waitForTimeout(800);
    await tab.evaluate(`(${open})(${JSON.stringify(FACTORY_RACK)}, false)`);
    await tab.evaluate(() => { FX.list = []; FX.err = ''; FX.busy = ''; fxDrawPc(); fxShowOpen(); });
    await tab.waitForTimeout(500);
    await tab.evaluate((skip) => skip.forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })), SKIP);
    const rect = await tab.evaluate(() => { const r = document.querySelector('#grainView .gs-app').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    const clip = { x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
    const walkOf = async (sel, skip = SKIP) => {
      await tab.evaluate(`(${mark})()`);
      const r = await tab.evaluate(`(${walk})(${JSON.stringify(sel)}, ${JSON.stringify(skip)})`);
      if (r.error) throw new Error(`${t.id} ${sel}: ${r.error}`);
      return r;
    };
    const face = { size: [rect[2], rect[3]], theme: t.id, captured: new Date().toISOString(), cards: {}, picker: {} };
    face.cl = await tab.evaluate(`(${colours})()`);
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'fx-reference.png'), clip });
    // FX_SHOTS=1: every theme's page as a picture too (1x), to hold the app against.
    else if (process.env.FX_SHOTS) await tab.screenshot({ path: path.join(out, `fx-reference-${t.id}.png`), clip });
    face.page = await walkOf('#grainView .gs-app');
    await tab.evaluate(`(${open})(${JSON.stringify(FACTORY_RACK)}, true)`);
    await tab.evaluate((l) => { FX.list = l; fxDrawPc(); fxShowOpen(); }, PC_LIST);
    await tab.waitForTimeout(200);
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'fx-reference-open.png'), clip });
    face.pageOpen = await walkOf('#grainView .gs-app');
    // The Now bar: MGL's page sits over it; the module puts it under the page.
    face.nowbar = await walkOf('#nowBar', ['.toast', '#toast', '.toasts']);
    if (scale === 2) {
      const b = await tab.evaluate(() => { const r = $('nowBar').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      face.nowbarRect = [b.x, b.y, b.width, b.height];
    }

    // The Add menu, and each module in it.
    await tab.evaluate(() => gsFxPicker());
    await tab.waitForTimeout(150);
    face.picker.top = await walkOf('#fxPicker', THUMBS);
    const groups = await tab.evaluate(() => fxPickerCatalogue().map((g) => g.group));
    for (const g of groups) {
      await tab.evaluate((g) => renderFxPicker(g), g);
      await tab.waitForTimeout(60);
      face.picker[g] = await walkOf('#fxPicker', THUMBS);
    }
    await tab.evaluate(() => closeFxPicker());

    // Every card alone.
    await tab.evaluate((j) => { window.__fxCatalogue = JSON.parse(j); }, FX_JSON);
    const kinds = await tab.evaluate(`(${kindsOf})()`);
    const data = [];
    for (const k of kinds) {
      const slot = await tab.evaluate(`(${lone})(${JSON.stringify(k)})`);
      await tab.waitForTimeout(40);
      const r = await tab.evaluate(() => { const c = document.querySelector('#fxModuleRail > .fx-module'), a = document.querySelector('#grainView .gs-app').getBoundingClientRect(), b = c.getBoundingClientRect(); return [b.x - a.x, b.y - a.y, b.width, b.height]; });
      const tree = await walkOf('#fxModuleRail > .fx-module');
      if (scale === 2) await tab.screenshot({ path: path.join(out, `fx-card-${k.kind.replace(/[^a-z0-9-]/gi, '_')}.png`), clip: { x: rect[0] + r[0], y: rect[1] + r[1], width: r[2], height: r[3] }, scale: 'css' });
      face.cards[k.kind] = { rect: r, tree };
      // Every switch flipped (tiles, LEDs, choices one on): the lit look.
      const flipped = await tab.evaluate(() => {
        const slot = state.rack.slots[0], m = fxModel(slot);
        let n = 0;
        for (const p of m.specs) if (fxIsSwitch(p)) { const v = m.get(p.key); slot.params ? (slot.params[p.key] = v >= .5 ? 0 : 1) : (slot[p.key] = v >= .5 ? 0 : 1); n++; }
        if (n) { renderRack(); gsFxDress(); document.querySelectorAll('#gsFxAddCard').forEach((e) => e.remove()); }
        return n;
      });
      if (flipped) {
        await tab.waitForTimeout(20);
        face.cards[k.kind].lit = await walkOf('#fxModuleRail > .fx-module');
        await tab.evaluate(`(${lone})(${JSON.stringify(k)})`);
      }
      // A Hyperprism, SoundHack or Lexicon mode in MGL's own face.
      const alt = await tab.evaluate(() => { const slot = state.rack.slots[0]; if (!fxFaceStyle(slot)) return false; slot.face = 'mgl'; renderRack(); gsFxDress(); document.querySelectorAll('#gsFxAddCard').forEach((e) => e.remove()); return true; });
      if (alt) {
        await tab.waitForTimeout(20);
        const rr = await tab.evaluate(() => { const c = document.querySelector('#fxModuleRail > .fx-module'), a = document.querySelector('#grainView .gs-app').getBoundingClientRect(), b = c.getBoundingClientRect(); return [b.x - a.x, b.y - a.y, b.width, b.height]; });
        face.cards[k.kind].mgl = { rect: rr, tree: await walkOf('#fxModuleRail > .fx-module') };
        await tab.evaluate(`(${lone})(${JSON.stringify(k)})`);
      }
      // Advanced: each knob's own range.
      const adv = await tab.evaluate(() => { const b = document.querySelector('#fxModuleRail > .fx-module .fx-adv-btn'); if (!b) return false; b.click(); return true; });
      if (adv) {
        await tab.waitForTimeout(30);
        face.cards[k.kind].adv = await walkOf('#fxModuleRail > .fx-module');
        await tab.evaluate(`(${lone})(${JSON.stringify(k)})`);
      }
      // Switched off: the header's look (the body is drawn faded, as the CSS fades it).
      if (k.kind === 'eq') {
        await tab.evaluate(() => { state.rack.slots[0].bypassed = true; renderRack(); gsFxDress(); });
        await tab.waitForTimeout(20);
        face.cardOff = await walkOf('#fxModuleRail > .fx-module');
      }
      if (scale === 2) {
        const controls = await tab.evaluate((slot) => {
          const m = fxModel(slot);
          return { slot, specs: m.specs };
        }, slot);
        data.push({ ...k, rect: r, ...controls });
      }
    }
    // The Reverb window, on the first reverb.
    const rv = kinds.find((k) => k.suite === 'reverb');
    if (rv) {
      await tab.evaluate(`(${lone})(${JSON.stringify(rv)})`);
      await tab.evaluate(() => reverbOpen('fx-card'));
      await tab.waitForTimeout(300);
      const sel = await tab.evaluate(() => (RV.el ? (RV.el.id ? '#' + RV.el.id : '.rv-win') : null));
      if (sel) {
        face.reverb = await walkOf(sel);
        if (scale === 2) {
          const b = await tab.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, sel);
          await tab.screenshot({ path: path.join(out, 'fx-reverb-reference.png'), clip: b });
        }
      }
      face.reverbModes = {};
      for (const m of kinds.filter((x) => x.suite === 'reverb')) {
        await tab.evaluate(() => reverbClose());
        await tab.evaluate(`(${lone})(${JSON.stringify(m)})`);
        await tab.evaluate(() => reverbOpen('fx-card'));
        await tab.waitForTimeout(80);
        face.reverbModes[m.mode] = { band: await walkOf('#reverbWindow .rv-band'), bar: await walkOf('#reverbWindow .rv-bar') };
      }
      // A Reverb with Place on (the section lit).
      await tab.evaluate(() => { const s = state.rack.slots[0]; rvPlace(s).on = 1; rvRender(); });
      await tab.waitForTimeout(60);
      face.reverbPlaceOn = await walkOf('#reverbWindow .rv-band');
      await tab.evaluate(() => reverbClose());
    }
    // A mode menu open (the card's Mode drop), on the first reverb.
    if (rv) {
      await tab.evaluate(`(${lone})(${JSON.stringify(rv)})`);
      const opened = await tab.evaluate(() => { const b = document.querySelector('#fxModuleRail > .fx-module .fx-mode-drop .ui-dd'); if (!b) return false; b.click(); return true; });
      if (opened) {
        await tab.waitForTimeout(120);
        const sel = await tab.evaluate(() => { const m = document.querySelector('.ui-menu, .ui-dd-menu, [class*="ui-dm"]'); return m ? (m.id ? '#' + m.id : '.' + [...m.classList].join('.')) : null; });
        if (sel) face.modeMenu = await walkOf(sel);
        await tab.keyboard.press('Escape');
      }
    }
    if (scale === 2) fs.writeFileSync(path.join(out, 'fx-page.json'), JSON.stringify({ kinds: data, catalogue: JSON.parse(FX_JSON) }));
    write(path.join(out, `mgl-fx-${t.id}.json.gz`), face);
    process.stdout.write(`  ${t.id}: page ${face.page.nodes} boxes, ${Object.keys(face.cards).length} cards, picker ${Object.keys(face.picker).length}, reverb ${face.reverb ? face.reverb.nodes : 'none'} (${((Date.now() - t1) / 1000).toFixed(0)} s)\n`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
