// Capture MGL's Grain page for the native app, in every theme.
//
//   node native/tools/face-capture/capture-grain.mjs <out-folder> [theme-id ...]
//
// The Grain page (ui/app/400-409-grain*, grain-glyphs.js, grain.css) is laid
// out at one fixed size, 1388 x 990 (`.gs-app`), under the document tabs. It
// is served from the checkout as capture.mjs serves Wave, with no engine
// behind it (every /api call fails), with a sound open as the page has one
// once the server has answered: the document's stretch at MGL's defaults.
//
// For each theme MGL's Theme page lists (and `default`):
//   <out>/mgl-grain-<id>.json.gz  {
//     size,                       [1388, 990]
//     engines: { <alg>: tree },   the page with each of the six engines chosen
//                                 (each has its own panel), the read head row
//                                 and the lens shown as the page sizes them
//     fx,                         the page with the effects view out
//     lit,                        the page with every switch on and every
//                                 choice on its last option (their lit looks)
//     menus: { tune, follow, preset, presetMenu, cloud }
//   }
// and, for the default theme only, <out>/grain-reference.png (the page with
// WSOLA chosen, at 2x), <out>/grain-reference-<alg>.png (each engine, 1x), and
// <out>/grain-page.json: the page's own tables (every control's range, steps
// and words; the sections; the engines; the LFOs' shapes and divisions; the
// tips), which the face reads.

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
  console.error('usage: capture-grain.mjs <out-folder> [theme-id ...]');
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
const ENGINES = ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular', 'soundhack'];

// A sound open, as the page has it once the server has answered: the
// document at MGL's defaults, its overview, the drafts built by the tray.
// MGL's factory rack as MGL's /api/rack answers it (recorded by the Grain
// references), so the strip shows its tiles and the effects view its cards.
const FACTORY_RACK = JSON.parse(fs.readFileSync(path.join(mgl, 'native/engine-app/tests/reference/grain/refs.json'), 'utf8')).presetsSaved.presets[0].rack;
const open = (rack) => {
  const frames = 96000, sr = 48000, cols = 400;
  const ch = () => ({ min: new Array(cols).fill(-0.4), max: new Array(cols).fill(0.4), rms: new Array(cols).fill(0.2) });
  state.selectedFile = { path: 'kit/sound.wav', name: 'sound.wav', duration: 2, sampleRate: sr, channels: 2, bits: 24, frames, format: 'wav', category: 'SAMPLE' };
  state.view.from = 0; state.view.to = frames; state.view.frames = frames; state.view.sampleRate = sr;
  state.overview = { frames, from: 0, to: frames, columns: cols, sampleRate: sr, channels: [ch(), ch()] };
  state.edit = {
    frames, baseFrames: frames, sourceFrames: frames, duration: 2, edited: false, canUndo: false, canRedo: false, clipboard: 0, clips: [],
    stretch: { ratio: 1, semitones: 0, scale: '', pitchStep: 0, windowMs: 40, quality: 'standard', algorithm: 'wsola', cloud: false, cloudMix: 0.5,
      vocoder: { ...VOCODER_DEFAULTS }, wsola: { ...WSOLA_DEFAULTS }, pvsola: { ...PVSOLA_DEFAULTS }, hybrid: { ...HYBRID_DEFAULTS }, soundhack: { ...SOUNDHACK_DEFAULTS },
      grain: { ...GRAIN_DEFAULTS, position: 0, seed: 1 }, active: false, granular: false },
  };
  state.sel = null;
  state.cue = 0;
  // MGL's factory rack, so the strip shows its tiles.
  state.rack = rack;
  try { gsFxBuildRow(); } catch {}
  stretchBuiltFor = null; grainBuiltFor = null;
  renderStretch();
  renderGrainParams();
};

// Mark what the face needs of each control: its glyph colour (`--gg`).
const mark = () => {
  const probe = document.createElement('i');
  document.body.append(probe);
  const rgb = (css) => { probe.style.color = ''; probe.style.color = css; return getComputedStyle(probe).color; };
  for (const el of document.querySelectorAll('#grainView .gs-bc')) el.dataset.gg = rgb(getComputedStyle(el).getPropertyValue('--gg').trim() || getComputedStyle(el).color);
  for (const el of document.querySelectorAll('#grainView .gs-tab')) el.dataset.gg = rgb(getComputedStyle(el.querySelector('svg.gg') || el).getPropertyValue('--gg').trim());
  probe.remove();
};

// The page's colours as its canvases read them (`gsCl`), each resolved to
// rgb() by the browser (a theme writes them as oklch, color-mix ...).
const colours = () => {
  const probe = document.createElement('i');
  document.body.append(probe);
  const rgb = (css) => { probe.style.color = ''; probe.style.color = css; return getComputedStyle(probe).color; };
  const s = getComputedStyle($('grainView')), v = (k) => s.getPropertyValue(k).trim();
  const cl = gsCl(), out = {};
  for (const k of ['wave', 'acc', 'on', 'track', 't', 't2', 't3']) out[k] = rgb(cl[k]);
  out.bloom = cl.bloom.includes('(') ? rgb(cl.bloom).replace(/rgba?\(|\)/g, '') : cl.bloom;
  out.bloom = rgb(`rgb(${cl.bloom})`).replace(/rgba?\(|\)/g, '');
  out.glow = cl.glow;
  for (const k of ['--gs-f-time', '--gs-f-pitch', '--gs-f-tone', '--gs-f-attack', '--gs-f-space', '--gs-f-level', '--gs-chassis', '--gs-panel', '--gs-well', '--gs-line', '--rec-lit', '--look-led-off', '--look-chip-ink', '--on-tile', '--on-tile-sel']) out[k] = rgb(v(k));
  out.onRgb = v('--on-rgb');
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
    const scale = t.id === 'default' ? 2 : 1;
    const ctx = await browser.newContext({ viewport: { width: 1668, height: 1100 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    const tab = await ctx.newPage();
    tab.on('pageerror', (e) => process.stdout.write(`  [${t.id}] page error: ${e.message}\n`));
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.evaluate((chosen) => {
      localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
      for (const k of Object.keys(localStorage)) if (k.startsWith('grain.voice:')) localStorage.removeItem(k);
    }, t.id === 'default' ? null : t.id);
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.waitForTimeout(300);
    await tab.evaluate(() => { prefs.grainUi = 'synth'; setEditPage('grain', false); setMode('edit'); });
    await tab.waitForTimeout(800);
    await tab.evaluate(`(${open})(${JSON.stringify(FACTORY_RACK)})`);
    await tab.waitForTimeout(600);
    await tab.evaluate((skip) => skip.forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })), SKIP);
    const rect = await tab.evaluate(() => { const r = document.querySelector('#grainView .gs-app').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    if (rect[2] !== 1388 || rect[3] !== 990) throw new Error(`${t.id}: the page is ${rect}`);
    const clip = { x: rect[0], y: rect[1], width: 1388, height: 990 };
    const walkOf = async (sel) => {
      await tab.evaluate(`(${mark})()`);
      const r = await tab.evaluate(`(${walk})(${JSON.stringify(sel)}, ${JSON.stringify(SKIP)})`);
      if (r.error) throw new Error(`${t.id} ${sel}: ${r.error}`);
      return r;
    };
    const face = { size: [1388, 990], theme: t.id, captured: new Date().toISOString(), engines: {}, menus: {} };
    face.cl = await tab.evaluate(`(${colours})()`);

    for (const e of ENGINES) {
      await tab.evaluate((e) => { state.stretchDraft.algorithm = e; gsApplyEngine(); }, e);
      await tab.waitForTimeout(250);
      if (scale === 2 && e === 'wsola') await tab.screenshot({ path: path.join(out, 'grain-reference.png'), clip });
      if (process.env.GRAIN_REFS) await tab.screenshot({ path: path.join(process.env.GRAIN_REFS, `grain-reference-${t.id}-${e}.png`), clip });
      face.engines[e] = await walkOf('#grainView .gs-app');
    }
    await tab.evaluate(() => { state.stretchDraft.algorithm = 'wsola'; gsApplyEngine(); });
    await tab.waitForTimeout(150);

    // Every switch on and every choice on its last option, for their lit looks.
    await tab.evaluate(() => {
      for (const k in GS_C) { const c = GS_C[k]; if (c.sw) gsSetV(k, 1); else if (c.seg) gsSetV(k, c.seg.length - 1); }
      state.stretchDraft.algorithm = 'hybrid'; gsApplyEngine();
      for (const k in GS_C) { const c = GS_C[k]; if (c.sw) gsSetV(k, 1); else if (c.seg) gsSetV(k, c.seg.length - 1); }
      GS.voice.mode = 'poly'; GS.voice.run = true; gsMarkVoice();
      state.rack.slots[1].bypassed = true; gsFxBuildRow();
      gsStartMap(0);
    });
    await tab.waitForTimeout(200);
    face.lit = await walkOf('#grainView .gs-app');
    await tab.evaluate(() => {
      for (const k in GS_C) { const c = GS_C[k]; if (c.sw || c.seg) gsSetV(k, c.d); }
      GS.voice.mode = 'mono'; GS.voice.run = false; gsMarkVoice();
      gsEndMap();
      state.rack.slots[1].bypassed = false; gsFxBuildRow();
      state.stretchDraft.algorithm = 'wsola'; gsApplyEngine();
    });

    // The effects view.
    await tab.evaluate(() => gsFxSetView('fx'));
    await tab.waitForTimeout(250);
    if (scale === 2) await tab.screenshot({ path: path.join(out, 'grain-reference-fx.png'), clip });
    face.fx = await walkOf('#grainView .gs-app');
    await tab.evaluate(() => gsFxSetView('eng'));
    await tab.waitForTimeout(150);

    // The menus, each as it opens, placed in the page.
    const menu = async (name, how, sel) => {
      await tab.evaluate(how);
      await tab.waitForTimeout(150);
      const r = await tab.evaluate((sel) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && !el.hidden; }, sel);
      if (r) face.menus[name] = await walkOf(sel);
      await tab.keyboard.press('Escape');
      await tab.evaluate(() => { try { gsCloseMenus(); pbarClose?.(); } catch {} });
      await tab.waitForTimeout(80);
    };
    await menu('tune', `gsTuneMenu($('gsTuneBtn'))`, '#gsMenu');
    await menu('scale', `gsTuneMenu($('gsKbScale'))`, '#gsMenu');

    if (scale === 2) {
      const data = await tab.evaluate(() => ({
        controls: Object.fromEntries(Object.entries(GS_C).map(([k, c]) => [k, {
          label: c.label, min: c.min, max: c.max, d: c.d, at: c.at, key: c.key, log: !!c.log, bip: !!c.bip, sw: !!c.sw,
          seg: c.seg || null, vals: c.vals || null, detent: c.detent ?? null, odd: !!c.odd, full: c.full || null,
          step: typeof c.step === 'function' ? 'scale' : (c.step ?? null), facet: gsFacet(k), group: GG_GROUP[k] || null,
          tip: GS_TIPS[k] || '', moves: GG_MOVES.has(k),
        }])),
        sections: GS_SECT, engineSections: GS_ENG_SECT, engines: GS_ENG,
        lfo: { colours: GS_LCOL, shapes: GS_SHAPES, divisions: GS_DIVS, beats: GS_DIVB, defaults: GS.lfo },
        voice: GS_VOICE_DEF, amp: GS_AMP_DEF, kb: GS_KB, tips: GS_TIPS, keysTip: GS_KEYS_TIP,
      }));
      fs.writeFileSync(path.join(out, 'grain-page.json'), JSON.stringify(data));
    }
    write(path.join(out, `mgl-grain-${t.id}.json.gz`), face);
    process.stdout.write(`  ${t.id}: ${Object.values(face.engines).map((x) => x.nodes).join('/')} boxes, fx ${face.fx.nodes}, menus ${Object.keys(face.menus).join(',')}\n`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
