// Capture idMLab's canvas, the ComfyUI-style one, for the native app.
//
//   node native/tools/face-capture/capture-canvas.mjs <idmlab-dist> <out-folder>
//
// <idmlab-dist> is idMLab built from its master (`npx vite build --outDir ...`
// in ~/Documents/GitHub/M Clone; the repository's own dist/ is left alone).
// It is served as it is and opened in Playwright's Chromium in its default
// theme (Dark, kit Thin Ring). Walked with walk.js, each part on its own:
//   bar.json      the top bar (.mm-project-bar)
//   status.json   the status line (.mm-status-bar)
//   node-notes.json, node-audio.json   a module's frame: its header and its
//                 sockets, one with note sockets, one with an audio socket
//   menu.json     the Add module panel, open, as double-clicking the board opens it
//   style.json    the board (its colour and dot grid) and the cables (stroke,
//                 width, glow; selected; being dragged), from the stylesheet
//   canvas.png    the whole window, for comparing
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mgl = path.resolve(here, '../../..');
const require = createRequire(path.join(mgl, 'package.json'));
const { chromium } = require('playwright');

const [root, out] = process.argv.slice(2);
if (!root || !out) {
  console.error('usage: capture-canvas.mjs <idmlab-dist> <out-folder>');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));

const walk = fs.readFileSync(path.join(here, 'walk.js'), 'utf8');
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const tab = await ctx.newPage();
  await tab.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await tab.waitForTimeout(2000);
  const grab = async (selector, file) => {
    const face = await tab.evaluate(`(${walk})(${JSON.stringify(selector)}, [])`);
    if (face.error) throw new Error(`${file}: ${face.error}`);
    fs.writeFileSync(path.join(out, file), JSON.stringify(face));
    console.log(`${file}: ${face.nodes} boxes, ${face.size.join(' x ')}`);
  };
  // At Actual Size, from its own View menu, so every size is the page's own.
  await tab.getByRole('button', { name: 'View', exact: true }).click();
  await tab.getByText('Actual Size', { exact: true }).click();
  await tab.waitForTimeout(500);
  await tab.screenshot({ path: path.join(out, 'canvas.png') });
  await grab('.mm-project-bar', 'bar.json');
  await grab('.mm-status-bar', 'status.json');

  // A module with note sockets on both sides, then one with an audio socket.
  const mark = async (test, name) => {
    const ok = await tab.evaluate(({ test, name }) => {
      for (const n of document.querySelectorAll('.mm-node')) {
        const kinds = [...n.querySelectorAll('.mm-port')].map((p) => [...p.classList].find((c) => c.startsWith('mm-port--') && c !== 'mm-port--')).join(' ');
        if (new RegExp(test).test(kinds)) { n.dataset.captureAs = name; return true; }
      }
      return false;
    }, { test, name });
    return ok;
  };
  if (await mark('note-event.*note-event', 'notes')) await grab('[data-capture-as="notes"]', 'node-notes.json');
  // Add an Audio Output from the Add module panel, as a hand would.
  const vp = await tab.locator('.mm-canvas-viewport').boundingBox();
  await tab.mouse.dblclick(vp.x + vp.width - 120, vp.y + vp.height - 120);
  await tab.waitForTimeout(400);
  await grab('.mm-module-menu', 'menu.json');
  await tab.keyboard.type('Audio Output');
  await tab.waitForTimeout(300);
  await tab.locator('.mm-module-menu button', { hasText: 'Audio Output' }).first().click();
  await tab.waitForTimeout(800);
  if (await mark('audio', 'audio')) await grab('[data-capture-as="audio"]', 'node-audio.json');

  // The board and the cables, as the stylesheet draws them.
  const style = await tab.evaluate(() => {
    const vp = document.querySelector('.mm-canvas-viewport');
    const vs = getComputedStyle(vp);
    const path = document.querySelector('.mm-cables path');
    const ps = path ? getComputedStyle(path) : null;
    const pick = (cs, keys) => cs ? Object.fromEntries(keys.map((k) => [k, cs.getPropertyValue(k)])) : null;
    const probe = (cls) => {
      const svg = document.querySelector('.mm-cables');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', cls);
      p.setAttribute('d', 'M0 0 L10 10');
      svg.append(p);
      const v = pick(getComputedStyle(p), ['stroke', 'stroke-width', 'stroke-opacity', 'opacity', 'filter', 'stroke-dasharray', 'stroke-linecap']);
      p.remove();
      return v;
    };
    const body = getComputedStyle(document.body);
    return {
      viewport: pick(vs, ['background-color', 'background-image', 'background-size']),
      body: pick(body, ['background-color', 'color', 'font-family']),
      cable: pick(ps, ['stroke', 'stroke-width', 'stroke-opacity', 'opacity', 'filter', 'stroke-linecap', 'fill']),
      selected: probe('is-selected'),
      dragging: probe('mm-cable-dragging'),
      accents: Object.fromEntries([...document.querySelectorAll('.mm-node')].map((n) => [n.dataset.moduleType, getComputedStyle(n).getPropertyValue('--mm-accent').trim()])),
      header: document.querySelector('.mm-project-bar').getBoundingClientRect().height,
      status: document.querySelector('.mm-status-bar').getBoundingClientRect().height,
    };
  });
  fs.writeFileSync(path.join(out, 'style.json'), JSON.stringify(style, null, 1));
  console.log('style.json', JSON.stringify(style).slice(0, 400));
} finally {
  await browser.close();
  server.close();
}
