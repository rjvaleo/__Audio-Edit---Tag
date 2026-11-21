// Capture every theme and kit, from idMLab and from MGL themselves.
//
//   node native/tools/face-capture/capture-themes.mjs <idmlab-dist> <out-folder>
//
// idMLab (built from its master, as capture-canvas.mjs takes it): its theme
// menu, read as it lists them (built in, then the palettes, each with its
// swatch); then for each theme, chosen from that menu as a hand would, the
// canvas's parts (the bar, the status line, a module's frame, the Add module
// panel, the board's and cables' colours, the accents), and for each of the
// six kits, chosen from its Kit picker, the jacks. Written to
// <out>/idmlab/<n>.json, one a theme, and <out>/idmlab-themes.json.
//
// MGL (served from the checkout, as capture.mjs serves it): for each theme
// its Theme page lists, Wave's whole face, written to <out>/mgl/<id>.json, and
// the list to <out>/mgl-themes.json. The default theme is `default`.
//
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

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error('usage: capture-themes.mjs <idmlab-dist> <out-folder>');
  process.exit(2);
}
for (const d of ['idmlab', 'mgl']) fs.mkdirSync(path.join(out, d), { recursive: true });
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const write = (file, value) => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(value), { level: 9 }));

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve(lookup) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const body = lookup(p);
    if (body == null) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}
const fromFolder = (root) => (p) => {
  const f = path.join(root, p);
  return f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f) : null;
};

const browser = await chromium.launch();
try {
  // ── idMLab ──────────────────────────────────────────────────────────────
  if (!only.length || only.includes('idmlab')) {
    const server = await serve(fromFolder(dist));
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const tab = await ctx.newPage();
    await tab.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await tab.waitForTimeout(1500);
    await tab.getByRole('button', { name: 'View', exact: true }).click();
    await tab.getByText('Actual Size', { exact: true }).click();
    // An Audio Output, for its audio socket and its frame.
    const vp = await tab.locator('.mm-canvas-viewport').boundingBox();
    await tab.mouse.dblclick(vp.x + vp.width - 120, vp.y + vp.height - 120);
    await tab.keyboard.type('Audio Output');
    await tab.locator('.mm-module-menu button', { hasText: 'Audio Output' }).first().click();
    await tab.waitForTimeout(500);
    const grab = (sel) => tab.evaluate(`(${walk})(${JSON.stringify(sel)}, [])`);

    // The themes, as the menu lists them.
    await tab.locator('.mm-theme > button').click();
    await tab.waitForTimeout(300);
    const menu = await grab('.mm-theme-menu');
    const themes = await tab.evaluate(() => {
      const rows = [];
      for (const group of document.querySelectorAll('.mm-theme-menu__list > div')) {
        const label = group.querySelector(':scope > b')?.textContent || '';
        for (const b of group.querySelectorAll('button')) {
          rows.push({
            group: label,
            label: b.querySelector('span:not(.mm-theme-swatch)')?.textContent || '',
            blurb: b.querySelector('small')?.textContent || '',
            swatch: [...b.querySelectorAll('.mm-theme-swatch i')].map((i) => getComputedStyle(i).backgroundColor),
          });
        }
      }
      return rows;
    });
    await tab.keyboard.press('Escape');
    write(path.join(out, 'idmlab-theme-menu.json.gz'), menu);
    fs.writeFileSync(path.join(out, 'idmlab-themes.json'), JSON.stringify(themes, null, 1));
    console.log(`idMLab: ${themes.length} themes`);

    const kits = await tab.evaluate(() => [...document.querySelectorAll('.mm-kit-picker select option')].map((o) => ({ value: o.value, label: o.textContent })));
    for (let n = 0; n < themes.length; n++) {
      const t = themes[n];
      await tab.locator('.mm-theme > button').click();
      await tab.locator('.mm-theme-menu__list button', { hasText: t.label }).filter({ has: tab.locator('span', { hasText: new RegExp(`^${t.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first().click();
      await tab.waitForTimeout(250);
      const part = { theme: t };
      part.bar = await grab('.mm-project-bar');
      part.status = await grab('.mm-status-bar');
      await tab.evaluate(() => {
        for (const n of document.querySelectorAll('.mm-node')) if (n.dataset.moduleType === 'm.audio-output') n.dataset.captureAs = 'audio';
      });
      part.nodeAudio = await grab('[data-capture-as="audio"]');
      await tab.mouse.dblclick(vp.x + 60, vp.y + vp.height - 60);
      await tab.waitForTimeout(200);
      part.menu = await grab('.mm-module-menu');
      await tab.keyboard.press('Escape');
      await tab.mouse.click(vp.x + 30, vp.y + vp.height - 30);
      part.style = await tab.evaluate(() => {
        const vs = getComputedStyle(document.querySelector('.mm-canvas-viewport'));
        const path = document.querySelector('.mm-cables path');
        const pick = (cs, keys) => cs ? Object.fromEntries(keys.map((k) => [k, cs.getPropertyValue(k)])) : null;
        const probe = (cls) => {
          const svg = document.querySelector('.mm-cables');
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('class', cls);
          p.setAttribute('d', 'M0 0 L10 10');
          svg.append(p);
          const v = pick(getComputedStyle(p), ['stroke', 'stroke-width', 'opacity', 'filter', 'stroke-dasharray']);
          p.remove();
          return v;
        };
        return {
          viewport: pick(vs, ['background-color', 'background-image', 'background-size']),
          cable: pick(path ? getComputedStyle(path) : null, ['stroke', 'stroke-width', 'opacity', 'filter']),
          selected: probe('is-selected'),
          dragging: probe('mm-cable-dragging'),
          accents: Object.fromEntries([...document.querySelectorAll('.mm-node')].map((n) => [n.dataset.moduleType, getComputedStyle(n).getPropertyValue('--mm-accent').trim()])),
          header: document.querySelector('.mm-project-bar').getBoundingClientRect().height,
          status: document.querySelector('.mm-status-bar').getBoundingClientRect().height,
        };
      });
      // Each kit's jacks: an audio input, and a note input and output.
      part.jacks = {};
      for (const k of kits) {
        await tab.locator('.mm-kit-picker select').selectOption(k.value);
        await tab.waitForTimeout(120);
        part.jacks[k.value] = await tab.evaluate(async (walkSrc) => {
          const walkFn = eval(walkSrc);
          const one = (sel) => {
            const port = document.querySelector(sel);
            if (!port) return null;
            port.dataset.captureJack = '1';
            const v = walkFn('[data-capture-jack="1"]', []);
            delete port.dataset.captureJack;
            return v;
          };
          return {
            audioIn: one('.mm-node[data-module-type="m.audio-output"] .mm-port--audio'),
            noteIn: one('.mm-node[data-module-type="m.note-density"] .mm-node__ports--input .mm-port--note-event'),
            noteOut: one('.mm-node[data-module-type="m.note-density"] .mm-node__ports--output .mm-port--note-event'),
          };
        }, walk);
      }
      part.kits = kits;
      write(path.join(out, 'idmlab', `${n}.json.gz`), part);
      process.stdout.write(`  ${n} ${t.label}\n`);
    }
    await tab.locator('.mm-kit-picker select').selectOption('thinRing');
    await ctx.close();
    server.close();
  }

  // ── MGL ─────────────────────────────────────────────────────────────────
  if (!only.length || only.includes('mgl')) {
    const ui = path.join(mgl, 'ui');
    const joined = {};
    for (const [folder, ext, file] of [['app', 'js', 'app.js'], ['app-css', 'css', 'app.css'], ['room-paint', 'js', 'room-paint.js'], ['vis-gl', 'js', 'vis-gl.js'], ['stage', 'js', 'stage.js']]) {
      const dir = path.join(ui, folder);
      joined['/' + file] = fs.readdirSync(dir).filter((f) => f.endsWith('.' + ext)).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    }
    const server = await serve((p) => (p.startsWith('/api/') || p.startsWith('/audio') ? null : joined[p] ?? fromFolder(ui)(p)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const ctx = await browser.newContext({ viewport: { width: 2068, height: 1100 }, deviceScaleFactor: 1 });
    const tab = await ctx.newPage();
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    const list = await tab.evaluate(() => allPalettes().map((p) => ({ id: p.id, name: p.name, look: p.look || null, colors: p.colors || null })));
    list.unshift({ id: 'default', name: 'Graphite + Acrylic', look: 'AD', colors: null });
    fs.writeFileSync(path.join(out, 'mgl-themes.json'), JSON.stringify(list, null, 1));
    console.log(`MGL: ${list.length} themes`);
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
    for (const t of list) {
      await tab.evaluate((chosen) => {
        localStorage.setItem('audiolab.theme', JSON.stringify({ mine: [], chosen, plain: false, looks: true }));
      }, t.id === 'default' ? null : t.id);
      await tab.goto(base + '/index.html', { waitUntil: 'load' });
      await tab.waitForTimeout(200);
      await tab.evaluate(markBindings);
      await tab.evaluate(() => setMode('synth'));
      await tab.waitForTimeout(900);
      await tab.evaluate(() => ['#wvOffline', '.wv-menu', '.wv-pmenu', '.wv-cmenu'].forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })));
      const face = await tab.evaluate(`(${walk})("#waveView .wv-app", ${JSON.stringify(['#wvOffline', '.wv-menu', '.wv-pmenu', '.wv-cmenu'])})`);
      if (face.error) throw new Error(face.error);
      face.page = 'wave';
      face.theme = t.id;
      write(path.join(out, 'mgl', `${t.id}.json.gz`), face);
      process.stdout.write(`  ${t.id}\n`);
    }
    await ctx.close();
    server.close();
  }
} finally {
  await browser.close();
}
