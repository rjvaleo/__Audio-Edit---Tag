// Put capture-fx.mjs's captures into the app (native/app/faces/fx), slimmed:
// what the native face never reads is left out (tooltips, cursors), and each
// captured <svg>'s attributes that only restate the browser's defaults. The
// default theme is kept whole (mgl-fx-default.json.gz); every other theme is
// kept as what differs from it (mgl-fx-<id>.patch.json.gz: [path, value]
// pairs, a path's parts joined by "/"; a value {c: [...]} is the same string
// with these colours in place of its rgb()/rgba() ones, in order). Face.cpp
// puts a theme back together from the two.
//
//   node native/tools/face-capture/fx-slim.mjs <capture-folder>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = process.argv[2];
const to = path.resolve(here, '../../app/faces/fx');
fs.mkdirSync(to, { recursive: true });
const DEFAULTS = [' opacity="1"', ' fill-opacity="1"', ' stroke-opacity="1"', ' stroke-dasharray="none"', ' stroke-linejoin="miter"', ' stroke-linecap="butt"', ' role="slider"', ' tabindex="0"', ' aria-hidden="true"'];
const slimSvg = (s) => {
  for (const d of DEFAULTS) s = s.split(d).join('');
  return s.replace(/ aria-(label|valuetext)="[^"]*"/g, '');
};
const walk = (n) => {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach(walk); return; }
  delete n.title;
  delete n.cursor;
  if (typeof n.svg === 'string') n.svg = slimSvg(n.svg);
  for (const k of Object.keys(n)) if (typeof n[k] === 'object') walk(n[k]);
};
const COL = /rgba?\([^)]*\)/g;
const diff = (a, b, path, patch) => {
  const at = path.join('/');
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || a === null || b === null) { if (JSON.stringify(a) !== JSON.stringify(b)) patch.push([at, b]); return; }
  if (typeof b === 'object') {
    if (Array.isArray(b) && a.length !== b.length) { patch.push([at, b]); return; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) { patch.push([[...path, k].join('/'), null]); continue; }
      diff(a[k], b[k], [...path, k], patch);
    }
    return;
  }
  if (a === b) return;
  if (typeof b === 'string' && a.replace(COL, '#') === b.replace(COL, '#')) { patch.push([at, { c: b.match(COL) }]); return; }
  patch.push([at, b]);
};
const read = (f) => {
  const c = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(from, f))));
  // The Reverb window's bar is the same for every mode but its names: one is kept.
  for (const m of Object.values(c.reverbModes || {})) delete m.bar;
  walk(c);
  return c;
};
for (const f of fs.readdirSync(to).filter((f) => /^mgl-fx-.*\.json\.gz$/.test(f))) fs.unlinkSync(path.join(to, f));
const base = read('mgl-fx-default.json.gz');
let total = 0;
const put = (f, v) => { const out = zlib.gzipSync(JSON.stringify(v), { level: 9 }); fs.writeFileSync(path.join(to, f), out); total += out.length; };
put('mgl-fx-default.json.gz', base);
for (const f of fs.readdirSync(from).filter((f) => /^mgl-fx-.*\.json\.gz$/.test(f) && f !== 'mgl-fx-default.json.gz')) {
  const patch = [];
  diff(base, read(f), [], patch);
  put(f.replace('.json.gz', '.patch.json.gz'), patch);
}
for (const f of ['fx-reference.png', 'fx-reference-open.png', 'fx-reverb-reference.png']) if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
console.log(`${(total / 1e6).toFixed(1)} MB into ${to}`);
