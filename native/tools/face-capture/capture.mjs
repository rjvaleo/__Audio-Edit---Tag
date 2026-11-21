// Capture an MGL page's look for the native app.
//
//   node native/tools/face-capture/capture.mjs wave <out-folder>
//
// The page is served from the checkout (ui/, its parts joined as the server's
// build.rs joins them), with no engine behind it: every /api call fails, so
// the page shows its own default patch, the look as designed. It is opened in
// Playwright's Chromium at the page's own size (its minimum: below that it
// scales, above it stretches), its wiring calls wrapped so each control is
// marked with the key it sets, and walked (walk.js). Writes:
//   <out>/face.json      the look, for app/Source/Face.cpp
//   <out>/reference.png  the page as Chromium draws it, at 2x
//   <out>/reference-1x.png at 1x, for comparing with the native face
// Nothing touches the live app on 8737.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mgl = path.resolve(here, '../../..');
const require = createRequire(path.join(mgl, 'package.json'));
const { chromium } = require('playwright');

const PAGES = {
  wave: {
    mode: 'synth',
    root: '#waveView .wv-app',
    size: [1900, 1052],
    // the rail is 168 wide; the transport bar under the page 48 high
    viewport: [168 + 1900, 1052 + 48],
    skip: ['#wvOffline', '.wv-menu', '.wv-pmenu', '.wv-cmenu'],
  },
};

const [name, out] = process.argv.slice(2);
const page = PAGES[name];
if (!page || !out) {
  console.error(`usage: capture.mjs <${Object.keys(PAGES).join('|')}> <out-folder>`);
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

// ── the page's files, joined as build.rs joins them ─────────────────────
const ui = path.join(mgl, 'ui');
const joined = {};
for (const [folder, ext, file] of [['app', 'js', 'app.js'], ['app-css', 'css', 'app.css'], ['room-paint', 'js', 'room-paint.js'], ['vis-gl', 'js', 'vis-gl.js'], ['stage', 'js', 'stage.js']]) {
  const dir = path.join(ui, folder);
  joined['/' + file] = fs.readdirSync(dir).filter((f) => f.endsWith('.' + ext)).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
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

const browser = await chromium.launch();
try {
  for (const scale of [2, 1]) {
    const ctx = await browser.newContext({ viewport: { width: page.viewport[0], height: page.viewport[1] }, deviceScaleFactor: scale });
    const tab = await ctx.newPage();
    await tab.goto(base + '/index.html', { waitUntil: 'load' });
    await tab.waitForTimeout(300);
    // Mark each control with the key the page wires it to, as it wires it.
    await tab.evaluate(() => {
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
        (root || document).querySelectorAll(sel).forEach((el) => {
          el.dataset.bindKey = key;
          el.dataset.bindValue = read ? read(el) : el.dataset.k;
        });
      });
      wrap('wvDrag', (el) => { if (el && el.dataset) el.dataset.bindDrag = el.dataset.bindDrag || '1'; });
    });
    await tab.evaluate((mode) => setMode(mode), page.mode);
    await tab.waitForTimeout(1500);
    const rect = await tab.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.width, r.height]; }, page.root);
    if (rect[0] !== page.size[0] || rect[1] !== page.size[1]) throw new Error(`the page is ${rect} here, not ${page.size}`);
    await tab.evaluate((skip) => skip.forEach((s) => document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; })), page.skip);
    const shot = await tab.locator(page.root).screenshot({ animations: 'disabled' });
    fs.writeFileSync(path.join(out, scale === 2 ? 'reference.png' : 'reference-1x.png'), shot);
    if (scale === 2) {
      const walk = fs.readFileSync(path.join(here, 'walk.js'), 'utf8');
      const face = await tab.evaluate(`(${walk})(${JSON.stringify(page.root)}, ${JSON.stringify(page.skip)})`);
      if (face.error) throw new Error(face.error);
      face.page = name;
      face.captured = new Date().toISOString();
      fs.writeFileSync(path.join(out, 'face.json'), JSON.stringify(face));
      console.log(`${name}: ${face.nodes} boxes, ${face.size.join(' x ')}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
