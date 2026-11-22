// The Grain glyphs' references: every glyph MGL's `ui/grain-glyphs.js` draws,
// over a grid of each control's values, as the JS writes it, for
// `glyph-test.cpp` to check the native port (`native/app/Source/GrainGlyphs.cpp`)
// against string for string.
//
//   node native/tools/face-capture/glyph-refs.mjs [out.json] [steps]
//
// No browser: the glyph file is run in a `vm` context (it draws with nothing
// but Math), and the controls' ranges are the tray's own `gsDef` lines from
// `ui/app/400-grain-kit.js`, run beside it.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = process.argv[2] || path.join(here, 'glyph-refs.json');
/// Steps across each range (40 unless given: a bigger number is a stress run).
const STEPS = Number(process.argv[3]) || 40;

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'ui/grain-glyphs.js'), 'utf8'), ctx, { filename: 'grain-glyphs.js' });

// The tray's controls: from `const GS_C = {};` to the last `gsDef` line.
const kit = fs.readFileSync(path.join(root, 'ui/app/400-grain-kit.js'), 'utf8').split('\n');
const a = kit.findIndex((l) => l.startsWith('const GS_C = {};'));
let b = a;
for (let i = a; i < kit.length; i++) if (/^gs(Def|Sw)\(/.test(kit[i])) b = i;
vm.runInContext(kit.slice(a, b + 1).join('\n'), ctx, { filename: '400-grain-kit.js' });

const G = vm.runInContext(
  '({ GG_DRAW, GG_ENGINE, GG_MOVES: [...GG_MOVES], GG_FACET, GG_GROUP, GG_PICK, GG_SHAPE, GG_FACETS, GS_C })', ctx);

const keys = Object.keys(G.GG_DRAW);
const engines = Object.keys(G.GG_ENGINE);
const moving = new Set(G.GG_MOVES);
const TS = [0, 0.37, 1.9, 12.25];

/// A value as the C++ reads it back: JS's own shortest digits, with -0 kept.
const num = (v) => (Object.is(v, -0) ? '-0' : String(v));

/// The values to draw `key` at: the range across in STEPS steps and its ends, the
/// same snapped to the control's step and to two places, the default, a log
/// sweep for a log control, and a few beyond either end.
function grid(key) {
  const c = G.GS_C[key];
  const vs = [];
  if (key === 'seed') {
    // The seed is a whole number drawn by the tray; its glyph reads v % 9973.
    for (let i = 0; i <= STEPS; i++) vs.push(i, i * 997 + 13, Math.round(i * 2147483647 / STEPS));
    vs.push(1, 9972, 9973, 9974, 19946, -1, -9973, -12345, 0.5, 4294967295, 1e15 + 3);
    return [...new Set(vs.map(num))].map(Number);
  }
  if (!c) throw new Error(`no range for ${key}`);
  const { min, max, d } = c;
  const span = max - min;
  const step = typeof c.step === 'number' ? c.step : 0;
  for (let i = 0; i <= STEPS; i++) {
    const v = min + span * i / STEPS;
    vs.push(v, Number(v.toFixed(2)));
    if (step) vs.push(Math.round(v / step) * step);
    if (c.log && min > 0) vs.push(min * Math.pow(max / min, i / STEPS));
  }
  vs.push(min, max, d, -0, 0, min - span * 0.25, max + span * 0.25, min - 1, max + 1, min - 0.001, max + 0.001);
  if (c.sw || c.seg) vs.push(0, 1, 2, 0.5, 0.49, 0.5000001, 1.5, 2.5, -0.5, -1, 3);
  // Values a tray step lands on for a 0–1 control, where ties are likeliest.
  if (min === 0 && max <= 4) for (let i = 0; i <= 100; i++) vs.push(i / 100 * max);
  const seen = new Set();
  return vs.filter((v) => Number.isFinite(v) && !seen.has(num(v)) && seen.add(num(v)));
}

const cases = [];
for (const key of keys) {
  for (const v of grid(key)) {
    for (const t of moving.has(key) ? TS : [0]) {
      const svg = moving.has(key) ? G.GG_DRAW[key](v, t) : G.GG_DRAW[key](v);
      cases.push({ key, v: num(v), t: num(t), svg });
    }
  }
}
const engine = engines.map((alg) => ({ alg, svg: G.GG_ENGINE[alg]() }));

const facet = {}, group = {};
for (const k of [...keys, 'nothing']) { facet[k] = G.GG_FACET[k] ?? 'time'; group[k] = G.GG_GROUP[k] ?? ''; }

fs.writeFileSync(out, JSON.stringify({
  node: process.version, keys, engines, moves: G.GG_MOVES, pick: G.GG_PICK, shape: G.GG_SHAPE, facets: G.GG_FACETS,
  facet, group, cases, engine,
}));
console.log(`${cases.length} glyphs over ${keys.length} keys, ${engine.length} engines -> ${out}`);
