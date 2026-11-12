// ================================================================ Wave: the kit
//
// The wavetable synth page, `mode: 'synth'`. See `docs/WAVE-SYNTH.md`; the look
// is mock-up v7 (`docs/mockups/wave-synth-v7.html`, built on v6), which RJ
// approved with "Build it". This part is the mock-up's kit (`wave-synth-kit.js`) ported: the
// tables, the warps, the spectra, and the canvas helpers every control draws
// with. Then the patch, and the only conversation the page has with the engine,
// which is the `/api/wave/*` routes.
//
// **No sound is made here.** The mock-up played a few Web Audio voices so it
// could be heard; the page plays nothing and asks the engine for everything it
// draws as live — voices, LFO phases, the modulated value of every control.
//
// Every top-level name starts `wv` or `WV`: the parts share one global scope
// with the rest of the app, which already has `path`, `clamp`, `ring`, `drag`.

const WV_NP = 256;
const WV_TAU = Math.PI * 2;
const wvClamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const wvDpr = () => Math.min(2, window.devicePixelRatio || 1);

// ───────────────────────────────────────────────────────────────── tables
//
// The five built-in tables, by the same additive recipes the engine renders at
// 2048 samples. Here they are 256 points, which is what `/api/wave/table` sends
// for drawing — so the page looks right before the engine answers, and when it
// never does.

function wvNorm(a) {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (m) for (let i = 0; i < a.length; i++) a[i] /= m;
  return a;
}

function wvAdditive(nf, ampFn) {
  const T = [];
  for (let f = 0; f < nf; f++) {
    const t = f / (nf - 1);
    const a = new Float32Array(WV_NP);
    for (let k = 1; k <= 48; k++) {
      const amp = ampFn(k, t);
      if (!amp) continue;
      for (let i = 0; i < WV_NP; i++) a[i] += amp * Math.sin(WV_TAU * k * i / WV_NP);
    }
    wvNorm(a);
    T.push(a);
  }
  return T;
}

const WV_RECIPES = {
  'Formant Sweep': (k, t) => {
    const saw = 1 / k;
    const sq = k % 2 ? 1 / k : 0;
    const form = Math.exp(-(((k - (3 + t * 16)) / 2.4) ** 2)) / Math.sqrt(k) + (k === 1 ? 0.35 : 0);
    if (t < 1 / 3) { const u = t * 3; return (k === 1 ? 1 : 0) * (1 - u) + saw * u; }
    if (t < 2 / 3) { const u = (t - 1 / 3) * 3; return saw * (1 - u) + sq * u; }
    const u = (t - 2 / 3) * 3;
    return sq * (1 - u) + form * u;
  },
  'Glass Organ': (k, t) => ([1, 2, 3, 4, 6, 8, 12, 16].includes(k)
    ? Math.pow(0.62 + t * 0.3, Math.log2(k) * 2) * (1 + 0.4 * Math.sin(k * t * 5)) : 0),
  'Vowel Ah–Oo': (k, t) => {
    const f1 = 7 - t * 4, f2 = 12 - t * 6;
    return (Math.exp(-(((k - f1) / 1.6) ** 2)) + 0.6 * Math.exp(-(((k - f2) / 2) ** 2))) / Math.sqrt(k)
      + (k === 1 ? 0.2 : 0);
  },
  'Hollow Pulse': (k, t) => { const w = 0.5 - t * 0.44; return Math.sin(Math.PI * k * w) / k; },
  'Grit Saw': (k, t) => (1 / k) * (1 + t * 1.5 * ((k * 7919) % 13) / 13 - t * 0.3),
};
const WV_TABLE_NAMES = Object.keys(WV_RECIPES);

/// Built once each, on first use. A table the engine has never heard of and
/// the page cannot make is a plain sine, so a drawing never has nothing to draw.
const wvBuiltCache = {};
function wvBuiltinTable(name) {
  if (wvBuiltCache[name]) return wvBuiltCache[name];
  const recipe = WV_RECIPES[name];
  const T = recipe ? wvAdditive(64, recipe) : wvAdditive(2, (k) => (k === 1 ? 1 : 0));
  wvBuiltCache[name] = T;
  return T;
}

function wvFrameAt(T, p) {
  p = wvClamp(p) * (T.length - 1);
  const i = Math.floor(p), j = Math.min(T.length - 1, i + 1), u = p - i;
  const o = new Float32Array(WV_NP);
  for (let n = 0; n < WV_NP; n++) o[n] = T[i][n] * (1 - u) + T[j][n] * u;
  return o;
}

/// Read a cycle at phase `x`, wrapping, with linear interpolation.
function wvRd(a, x) {
  x = ((x % 1) + 1) % 1;
  const p = x * a.length, i = Math.floor(p), u = p - i;
  return a[i] * (1 - u) + a[(i + 1) % a.length] * u;
}

// ───────────────────────────────────────────────────────────────── warps
//
// Each mode with its glyph. `wvWarp` is the engine's mapping exactly
// (`docs/WAVE-SYNTH.md`, `oscN.warpJ.amt`), so the face of a warp knob is the
// wave the engine is playing.

const WV_WARPS = {
  off: { name: 'Off', g: 'M2 7 H16' },
  bend: { name: 'Bend', g: 'M2 12 C9 12,9 2,16 2' },
  sync: { name: 'Sync', g: 'M2 12 L7 3 L7 12 L12 3 L12 12 L16 6' },
  pwm: { name: 'PWM', g: 'M2 3 H6 V12 H16' },
  fold: { name: 'Fold', g: 'M2 12 L5 3 L8 9 L11 3 L14 9 L16 3' },
  mirror: { name: 'Mirror', g: 'M2 12 L9 3 L16 12' },
  asym: { name: 'Asym', g: 'M2 12 C4 2,6 2,8 7 L16 9' },
  quant: { name: 'Quant', g: 'M2 12 H5 V9 H8 V6 H11 V3 H16' },
  fm: { name: 'FM ← B', g: 'M2 7 C3 1,4 1,5 7 S6 13,7 7 S9 1,10 7 S13 13,16 7' },
};

function wvWarp(a, mode, w, mod) {
  if (mode === 'off' || !WV_WARPS[mode] || w <= 0) return a;
  const o = new Float32Array(WV_NP);
  for (let n = 0; n < WV_NP; n++) {
    let x = n / WV_NP, y;
    switch (mode) {
      case 'bend': {
        const e = 1 + w * 4;
        x = x < 0.5 ? 0.5 * Math.pow(2 * x, e) : 1 - 0.5 * Math.pow(2 * (1 - x), e);
        y = wvRd(a, x);
        break;
      }
      case 'sync': y = wvRd(a, x * (1 + w * 6)); break;
      case 'pwm': {
        const c = 0.5 - w * 0.45;
        x = x < c ? x / c * 0.5 : 0.5 + (x - c) / (1 - c) * 0.5;
        y = wvRd(a, x);
        break;
      }
      case 'fold': {
        y = wvRd(a, x) * (1 + w * 4);
        let g = 0;
        while (Math.abs(y) > 1 && g++ < 20) y = y > 1 ? 2 - y : -2 - y;
        break;
      }
      case 'mirror': {
        const m = 0.5 + (1 - w) * 0.5;
        y = x < m ? wvRd(a, x / m * 0.5) : wvRd(a, 0.5 - (x - m) / (1 - m) * 0.5);
        break;
      }
      case 'asym': {
        const c = 0.5 + w * 0.4;
        x = x < c ? x / c * 0.5 : 0.5 + (x - c) / (1 - c) * 0.5;
        y = wvRd(a, x);
        break;
      }
      case 'quant': { const s = Math.round(2 + (1 - w) * 30); y = Math.round(wvRd(a, x) * s) / s; break; }
      case 'fm': { const b = mod || a; y = wvRd(a, x + w * 0.35 * wvRd(b, x * 2)); break; }
      default: y = wvRd(a, x);
    }
    o[n] = y;
  }
  return o;
}

// ──────────────────────────────────────────────── the oscillator's own effect
//
// Eight, each with a glyph and a hue. The ones that only reshape the cycle are
// baked into the wave drawn; chorus, delay and phaser move in time and are
// drawn as such on the effect's own screen.

const WV_OFX = {
  off: { name: 'None', hue: 220, sat: 0, g: 'M2 7 H16' },
  chorus: { name: 'Chorus', hue: 175, g: 'M2 5 C5 1,7 1,9 5 S13 9,16 5 M2 10 C5 6,7 6,9 10 S13 14,16 10' },
  crush: { name: 'Crush', hue: 38, g: 'M2 12 V9 H5 V5 H8 V3 H11 V6 H14 V10 H16' },
  drive: { name: 'Drive', hue: 12, g: 'M2 12 C4 12,5 3,8 3 H11 C13 3,13 12,16 12' },
  delay: { name: 'Delay', hue: 265, g: 'M3 3 V11 M7 4.5 V9.5 M11 5.5 V8.5 M15 6.3 V7.7' },
  phaser: { name: 'Phaser', hue: 205, g: 'M2 7 C4 2,6 12,8 7 S12 2,16 7' },
  ring: { name: 'Ring', hue: 320, g: 'M2 7 C3 2,4 2,5 7 S7 12,8 7 S10 2,11 7 S13 12,14 7 S15 2,16 7' },
  comb: { name: 'Comb', hue: 125, g: 'M2 4 L4 12 L6 4 L8 12 L10 4 L12 12 L14 4 L16 12' },
};
const wvFxCol = (k, l = 68, a = 1) => `hsla(${(WV_OFX[k] || WV_OFX.off).hue},${(WV_OFX[k] || WV_OFX.off).sat ?? 62}%,${l}%,${a})`;

function wvOfxShape(f, m, a, b) {
  if (!m || m === 'off') return f;
  const o = new Float32Array(WV_NP);
  switch (m) {
    case 'crush': {
      const bits = Math.round(2 + (1 - b) * 6), q = Math.pow(2, bits - 1), hold = 1 + Math.round(b * 14);
      for (let n = 0; n < WV_NP; n++) o[n] = f[n] * (1 - a) + Math.round(f[n - n % hold] * q) / q * a;
      return o;
    }
    case 'drive': {
      const d = 1 + b * 10;
      for (let n = 0; n < WV_NP; n++) o[n] = f[n] * (1 - a) + Math.tanh(f[n] * d) / Math.tanh(d) * a;
      return o;
    }
    case 'ring': {
      const r = 1 + Math.round(b * 7);
      for (let n = 0; n < WV_NP; n++) o[n] = f[n] * (1 - a) + f[n] * Math.sin(WV_TAU * r * n / WV_NP) * a;
      return o;
    }
    case 'comb': {
      const sp = wvSpectrum(f, 48), d = 2 + b * 10;
      for (let k = 0; k < 48; k++) {
        const g = 1 - a * 0.9 * (0.5 + 0.5 * Math.cos(WV_TAU * (k + 1) / d));
        sp.re[k] *= g; sp.im[k] *= g;
      }
      return wvNorm(wvFromSpectrum(sp.re, sp.im));
    }
    default: return f;
  }
}

// ──────────────────────────────────────────────────────────────── spectra

const WV_TRIG = [];
for (let k = 1; k <= 64; k++) {
  const c = new Float32Array(WV_NP), s = new Float32Array(WV_NP);
  for (let n = 0; n < WV_NP; n++) { c[n] = Math.cos(WV_TAU * k * n / WV_NP); s[n] = Math.sin(WV_TAU * k * n / WV_NP); }
  WV_TRIG.push([c, s]);
}

function wvSpectrum(a, K = 48) {
  const re = new Float32Array(K), im = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    const [c, s] = WV_TRIG[k];
    let r = 0, i = 0;
    for (let n = 0; n < WV_NP; n++) { r += a[n] * c[n]; i += a[n] * s[n]; }
    re[k] = r * 2 / WV_NP; im[k] = i * 2 / WV_NP;
  }
  return { re, im };
}
const wvMags = (sp) => Array.from(sp.re, (r, k) => Math.hypot(r, sp.im[k]));
function wvFromSpectrum(re, im) {
  const a = new Float32Array(WV_NP);
  for (let k = 0; k < re.length; k++) {
    const [c, s] = WV_TRIG[k];
    for (let n = 0; n < WV_NP; n++) a[n] += re[k] * c[n] + im[k] * s[n];
  }
  return a;
}

/// An LFO's drawn shape at `x`: the points cosine-eased, as the engine reads it.
function wvLfoAt(pts, x) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b[0]) {
      if (b[0] === a[0]) return b[1];
      const u = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
  }
  return pts[pts.length - 1][1];
}

// ───────────────────────────────────────────────────────────── v7: LFO shapes
//
// The engine's shapes (`docs/WAVE-SYNTH.md`, v7), each 0..1 at phase `u`. The
// random ones are drawn with a fixed seed, as the mock-up draws them: the
// engine draws new levels every cycle, which no still picture can show.

const WV_LFO_SHAPES = [
  ['sine', 'Sine: smooth up and down', 'M1 7 C3 0,6 0,8 7 S13 14,15 7'],
  ['tri', 'Triangle: straight up, straight down', 'M1 7 L4.5 1 L11.5 13 L15 7'],
  ['up', 'Saw up: rises, then drops', 'M1 13 L14 1 V13'],
  ['down', 'Saw down: drops, then jumps back', 'M1 1 L14 13 V1'],
  ['square', 'Square: flips between two values', 'M1 2 H8 V12 H15'],
  ['steps', 'Random steps: a new value every step', 'M1 9 H4 V3 H7 V11 H10 V5 H13 V8 H15'],
  ['smooth', 'Smooth random: wanders', 'M1 9 C3 9,3 3,5 3 S7 11,9 11 S12 5,15 6'],
  ['drawn', 'Drawn: your own shape. Drag the points, double-click to add one', 'M1 10 L4 4 L8 8 L11 2 L15 9'],
];

const wvRnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/// A shape's value at phase `u` of cycle `cyc`; `drawn` reads the points.
function wvShapeAt(shape, pts, u, cyc = 0) {
  if (u !== 1) u = ((u % 1) + 1) % 1;
  switch (shape) {
    case 'sine': return 0.5 + 0.5 * Math.sin(u * WV_TAU);
    case 'tri': return u < 0.25 ? 0.5 + 2 * u : u < 0.75 ? 1.5 - 2 * u : 2 * u - 1.5;
    case 'up': return u;
    case 'down': return 1 - u;
    case 'square': return u < 0.5 ? 1 : 0;
    case 'steps': return wvRnd(cyc * 8 + Math.floor(u * 8));
    case 'smooth': {
      const k = u * 4, i = Math.floor(k), f = k - i, a = wvRnd(cyc * 4 + i), b = wvRnd(cyc * 4 + i + 1);
      return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * f));
    }
    default: return wvLfoAt(pts && pts.length > 1 ? pts : [[0, 0.5], [1, 0.5]], u);
  }
}

const wvLfoShape = (L) => wvG(`lfo${L}.shape`) || 'drawn';
const wvLfoVal = (L, u, cyc = 0) => wvShapeAt(wvLfoShape(L), wvG(`lfo${L}.points`), u, cyc);

/// Rate: `0.02 · 2000^v` Hz free, or a note length at `tempo` when synced.
const WV_DIVS = ['8 bars', '4 bars', '2 bars', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32'];
const WV_DIV_BEATS = [32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125];
const wvTempo = () => wvClamp(+wvG('tempo') || 120, 30, 300);
const wvDivAt = (v) => Math.round(wvClamp(v) * (WV_DIVS.length - 1));
const wvLfoHz = (L) => (wvG(`lfo${L}.sync`)
  ? wvTempo() / 60 / WV_DIV_BEATS[wvDivAt(wvG(`lfo${L}.rate`))]
  : 0.02 * Math.pow(2000, wvClamp(wvG(`lfo${L}.rate`) ?? 0.4)));
function wvLfoRateTxt(L) {
  if (wvG(`lfo${L}.sync`)) return WV_DIVS[wvDivAt(wvG(`lfo${L}.rate`))];
  const h = wvLfoHz(L);
  return h < 1 ? h.toFixed(2) + ' Hz' : h < 10 ? h.toFixed(1) + ' Hz' : Math.round(h) + ' Hz';
}

/// A standard shape as drawn points, so dragging it starts from what you see.
/// A square keeps its edges sharp; the rest are sampled at nine points.
function wvShapePoints(L) {
  if (wvLfoShape(L) === 'square') return [[0, 1], [0.49, 1], [0.5, 0], [0.99, 0], [1, 1]];
  return [...Array(9)].map((_, i) => [i / 8, Math.round(wvLfoVal(L, i / 8, 0) * 1e4) / 1e4]);
}

const WV_CURVES = { lin: 'Linear', exp: 'Exp', log: 'Log', s: 'S' };
function wvCurveAt(k, x) {
  return k === 'exp' ? x * x * x : k === 'log' ? 1 - Math.pow(1 - x, 3) : k === 's' ? x * x * (3 - 2 * x) : x;
}

// ─────────────────────────────────────────────────── canvas and pointer helpers

/// An element from markup. The page's parts are built as strings, the way the
/// mock-up was, because a module is easier to read as the markup it is.
function wvH(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

/// A canvas sized from its `data-w` and `data-h`, at the screen's density.
function wvCv(el) {
  const w = +el.dataset.w, h = +el.dataset.h, dpr = wvDpr();
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.width = w * dpr;
  el.height = h * dpr;
  const c = el.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { el, c, w, h };
}

/// Drag with pointer capture. `move(dx, dy, e)` is in screen pixels, so a drag
/// feels the same whatever the page's scale. When the drag ends, every value it
/// touched is sent once more without `live`, which is what stores it.
function wvDrag(el, move, down, up) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    if (down) down(e);
    const mv = (ev) => {
      if (move) move(ev.clientX - lx, ev.clientY - ly, ev);
      lx = ev.clientX; ly = ev.clientY;
    };
    const u = (ev) => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', u);
      el.removeEventListener('pointercancel', u);
      if (up) up(ev);
      wvCommitTouched();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', u);
    el.addEventListener('pointercancel', u);
  });
}

/// The pointer in the element's own unscaled pixels. The page is drawn at a
/// fixed size and scaled to fit, so a screen pixel is not a page pixel.
function wvLocal(el, e) {
  const r = el.getBoundingClientRect();
  const sx = (el.offsetWidth || r.width) / r.width, sy = (el.offsetHeight || r.height) / r.height;
  return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
}

function wvPath(fn, n) {
  const p = new Path2D();
  for (let i = 0; i <= n; i++) {
    const [x, y] = fn(i / n);
    if (i) p.lineTo(x, y); else p.moveTo(x, y);
  }
  return p;
}

/// The page's colours, read once from its own tokens on `#waveView`, and again
/// after a theme is put on (`themeStamp`).
let wvColourCache = null;
function wvCl() {
  if (wvColourCache?.stamp === themeStamp) return wvColourCache;
  const el = $('waveView');
  const s = getComputedStyle(el);
  const v = (k) => s.getPropertyValue(k).trim();
  wvColourCache = {
    wave: v('--wv-wave') || '#fff', bloom: v('--wv-bloom') || '205,225,255', acc: v('--wv-acc') || '#7cf0d0',
    mod: v('--wv-mod') || '#8aa0c8', arc: v('--wv-arc') || '#d3d7de', track: v('--wv-track') || '#2a2e34',
    t: v('--wv-t') || '#e8eaee', t2: v('--wv-t2') || '#b9bec6', t3: v('--wv-t3') || '#858b94',
    glow: +v('--wv-glow') || 1.1,
    // The app's own faces, ending in a generic family so a canvas never falls
    // back to a serif.
    mono: v('--mono') || 'monospace', sans: v('--sans') || 'sans-serif',
    stamp: themeStamp,
  };
  return wvColourCache;
}

function wvTrace(c, p, cl, lw = 1.6, g = 1) {
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const glow = cl.glow * g;
  if (glow > 0) {
    c.strokeStyle = `rgba(${cl.bloom},${0.16 * glow})`;
    c.lineWidth = lw * 3.6;
    c.shadowBlur = 10 * glow;
    c.shadowColor = `rgba(${cl.bloom},${0.4 * Math.min(1, glow)})`;
    c.stroke(p);
    c.shadowBlur = 0;
  }
  c.strokeStyle = cl.wave;
  c.lineWidth = lw;
  c.stroke(p);
}

function wvUnder(c, p, x0, x1, base, top, cl, a = 0.2) {
  const f = new Path2D(p);
  f.lineTo(x1, base);
  f.lineTo(x0, base);
  f.closePath();
  const g = c.createLinearGradient(0, top, 0, base);
  g.addColorStop(0, `rgba(${cl.bloom},${a})`);
  g.addColorStop(1, `rgba(${cl.bloom},0)`);
  c.fillStyle = g;
  c.fill(f);
}

function wvDot(c, x, y, r, col) {
  c.fillStyle = col;
  c.shadowBlur = 9;
  c.shadowColor = col;
  c.beginPath();
  c.arc(x, y, r, 0, WV_TAU);
  c.fill();
  c.shadowBlur = 0;
}

/// A knob's ring is the shared knob's now: `wvKnobRing` (`391-wave-play.js`),
/// which paints `uiKnobPaint`'s.

// ──────────────────────────────────────────────────────────────── the patch
//
// One flat map of normalised values, under the keys the engine uses
// (`docs/WAVE-SYNTH.md`). The page draws from these raw values and never from
// units; the engine maps them to units. This is the mock-up's own state, so
// with no engine the page is the mock-up.

function wvDefaultPatch() {
  const p = {};
  const osc = [
    { on: 1, table: 'Formant Sweep', pos: 0.34, w: [['bend', 0.3], ['off', 0]], n: 5, det: 0.35, spr: 0.7, pitch: 0.5, level: 0.82, route: 'F1', fx: ['chorus', 0.45, 0.4] },
    { on: 1, table: 'Vowel Ah–Oo', pos: 0.2, w: [['sync', 0.15], ['fm', 0.25]], n: 3, det: 0.2, spr: 0.5, pitch: 0.5 + 12 / 48, level: 0.6, route: 'F1', fx: ['crush', 0.75, 0.6] },
    { on: 0, table: 'Glass Organ', pos: 0.6, w: [['fold', 0.2], ['off', 0]], n: 1, det: 0, spr: 0, pitch: 0.5, level: 0.4, route: 'F2', fx: ['delay', 0.35, 0.5] },
  ];
  osc.forEach((o, i) => {
    const k = `osc${i}.`;
    Object.assign(p, {
      [k + 'on']: o.on, [k + 'table']: o.table, [k + 'pos']: o.pos,
      [k + 'warp0.mode']: o.w[0][0], [k + 'warp0.amt']: o.w[0][1],
      [k + 'warp1.mode']: o.w[1][0], [k + 'warp1.amt']: o.w[1][1],
      [k + 'uni.n']: o.n, [k + 'uni.det']: o.det, [k + 'uni.spr']: o.spr,
      [k + 'fx.mode']: o.fx[0], [k + 'fx.a']: o.fx[1], [k + 'fx.b']: o.fx[2],
      [k + 'pitch']: o.pitch, [k + 'fine']: 0.5, [k + 'phase']: 0, [k + 'rand']: 0.25,
      [k + 'pan']: 0.5, [k + 'level']: o.level, [k + 'route']: o.route,
    });
  });
  Object.assign(p, {
    // v7 Init: a triangle sub, which carries on small speakers.
    'sub.on': 1, 'sub.shape': 1, 'sub.oct': 1, 'sub.level': 0.28,
    'noise.on': 0, 'noise.color': 1, 'noise.level': 0.12,
    'filt0.type': 'lp', 'filt0.cut': 0.55, 'filt0.res': 0.35, 'filt0.drive': 0.2, 'filt0.key': 0.5,
    'filt1.type': 'bp', 'filt1.cut': 0.7, 'filt1.res': 0.5, 'filt1.drive': 0, 'filt1.key': 0.3,
    'filt.route': 'serial',
    'amp.a': 0.06, 'amp.d': 0.3, 'amp.s': 0.6, 'amp.r': 0.45,
    'voice.mode': 'poly', 'voice.glide': 0.2, 'voice.bend': 2, 'voice.mpe': 0,
    master: 0.8, tempo: 120,
  });
  [[0.15, 0.4, 0.3, 0.5], [0.02, 0.2, 0, 0.2], [0.4, 0.5, 0.7, 0.7]].forEach((e, m) => {
    ['a', 'd', 's', 'r'].forEach((s, j) => { p[`env${m + 1}.${s}`] = e[j]; });
  });
  // v7: each LFO has a shape, and a rate on the `0.02 · 2000^v` Hz law.
  [
    [0.42, 'sine', [[0, 0.5], [0.25, 1], [0.5, 0.5], [0.75, 0], [1, 0.5]]],
    [0.3, 'drawn', [[0, 0], [0.1, 1], [0.5, 0.4], [1, 0]]],
    [0.55, 'square', [[0, 1], [0.5, 1], [0.5, 0], [1, 0]]],
    [0.25, 'smooth', [[0, 0.5], [0.2, 0.9], [0.4, 0.2], [0.6, 0.7], [0.8, 0.1], [1, 0.5]]],
  ].forEach(([rate, shape, pts], l) => {
    Object.assign(p, { [`lfo${l}.rate`]: rate, [`lfo${l}.mode`]: 'free', [`lfo${l}.points`]: pts,
      [`lfo${l}.smooth`]: 0, [`lfo${l}.rise`]: 0, [`lfo${l}.shape`]: shape, [`lfo${l}.sync`]: 0 });
  });
  [0.5, 0.35, 0.6, 0.2, 0.4, 0.5, 0.3, 0.25].forEach((v, i) => { p['macro' + i] = v; });
  // The FX view's chain: Drive, Chorus, Delay, Reverb, EQ, three settings each.
  WV_FX_CHAIN.forEach((f, i) => {
    p[`fx${i}.on`] = f.on;
    f.k.forEach((v, j) => { p[`fx${i}.k${j}`] = v; });
  });
  return p;
}

const WV_FX_CHAIN = [
  // The engine's defaults (`FX_ON_DEFAULTS`, `FX_DEFAULTS` in wave/src/patch.rs):
  // drive out, the rest in lightly, EQ flat.
  { n: 'Drive', on: 0, k: [0.45, 0.3, 0.7], kn: ['Drive', 'Tone', 'Mix'] },
  { n: 'Chorus', on: 1, k: [0.35, 0.5, 0.25], kn: ['Rate', 'Depth', 'Mix'] },
  { n: 'Delay', on: 1, k: [0.4, 0.35, 0.15], kn: ['Time', 'Feedback', 'Mix'] },
  { n: 'Reverb', on: 1, k: [0.45, 0.45, 0.2], kn: ['Size', 'Damp', 'Mix'] },
  { n: 'EQ', on: 1, k: [0.5, 0.5, 0.5], kn: ['Low', 'Mid', 'High'] },
];

/// v7: Init moves nothing. Every route is one the player made, as in the
/// engine's own Init (`Patch::default`).
const WV_DEFAULT_MODS = [];

const WV_MACRO_NAMES = ['Brightness', 'Movement', 'Width', 'Grit', 'Space', 'Morph', 'Attack', 'Air'];

/// v8: every modulation source the engine has, in the matrix's order: ENV 2–4,
/// LFO 1–4, the playing hand, then the macros. The engine's keys are
/// `env1..3`, `lfo0..3`, `vel note mw at rand` and `macro0..7`. `g0` starts a
/// group, which the pins and the strips set a little apart.
const WV_SOURCES = [
  ...[1, 2, 3].map((m) => ({ key: `env${m}`, label: `ENV ${m + 1}`, kind: 'env' })),
  ...[0, 1, 2, 3].map((l) => ({ key: `lfo${l}`, label: `LFO ${l + 1}`, kind: 'lfo', g0: l === 0 })),
  ...[['vel', 'VEL'], ['note', 'NOTE'], ['mw', 'MW'], ['at', 'AT'], ['rand', 'RAND']].map(([key, label], i) => ({ key, label, kind: 'perf', g0: !i })),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ key: `macro${i}`, label: `M${i + 1}`, kind: 'macro', g0: !i })),
];
/// v7: one colour per source, shared by its tab, its badges and the arc it
/// draws on every control it moves. v8 adds the amp envelope's, the playing
/// hand's steel blues and the macros' bone, like the dock's knobs.
const WV_SRC_COL = {
  env1: '#f0a640', env2: '#ec7f5c', env3: '#d9c487', lfo0: '#5cc8e6', lfo1: '#a48cf2', lfo2: '#ee72a8', lfo3: '#9bd36c',
  amp: '#e8ecf2', vel: '#8fa6e8', note: '#a9b8d6', mw: '#7f96c8', at: '#b4a6d8', rand: '#c9cfdc',
  macro0: '#e6d8b8', macro1: '#e6d8b8', macro2: '#e6d8b8', macro3: '#e6d8b8', macro4: '#e6d8b8', macro5: '#e6d8b8', macro6: '#e6d8b8', macro7: '#e6d8b8',
};
const WV_VIA = [null, 'mw', 'vel', 'at', 'note', 'rand', 'macro0', 'macro1'];
const WV_SRC_NAMES = { mw: 'Mod wheel', vel: 'Velocity', at: 'Aftertouch', note: 'Note', rand: 'Random', env1: 'ENV 2', env2: 'ENV 3', env3: 'ENV 4', lfo0: 'LFO 1', lfo1: 'LFO 2', lfo2: 'LFO 3', lfo3: 'LFO 4' };

const WV = {
  p: wvDefaultPatch(),
  mods: WV_DEFAULT_MODS.map((m) => ({ ...m })),
  macroNames: WV_MACRO_NAMES.slice(),
  name: 'Night Glass Pad',
  tags: 'Pad · Warm',
  tables: {},              // name -> frames from the engine, 256 points each
  view: 'play',
  showing: false,
  built: false,
  connected: false,
  tele: null,              // the last `/api/wave/state`
  held: new Map(),         // note -> velocity, keys down on this page
  kbLo: 48,
  bend: 0,
  mw: 0,
  slot: { env: 'env1', lfo: 'lfo1' }, // v8: which envelope and LFO the Play slots show
  mx: 'pins',              // v8: the Matrix as pins or as rows
  board: null,             // v8: the FX board, as the engine stores it
  tilt: [0.5, 0.5, 0.5],   // how far each oscillator's table leans back
  face: ['w', 'w', 'w'],   // waves or spectrum
  ab: 'A',
  abSlots: { A: null, B: null },
  presets: null,
};

const wvG = (k) => WV.p[k];
function wvSrcName(src) {
  if (!src) return '—';
  if (/^macro\d$/.test(src)) return WV.macroNames[+src.slice(5)] || src;
  return WV_SRC_NAMES[src] || src;
}

/// A destination's name as a person reads it: `B Warp 1`, `F1 Cutoff`,
/// `Echo · Delay`. v8: the names are the Matrix's own (`wvTargetName`).
function wvDstName(t) {
  return wvTargetName(t);
}

/// How far the matrix can move a destination either way, and where it is now.
/// The range is the sum of the amounts aimed at it; the live value is the
/// engine's, from telemetry, and absent when there is none.
/// `col` is the colour of the first source aimed at it that has one, which is
/// the colour its arc, bracket or band is drawn in. v8: a row switched off in
/// the Matrix moves nothing.
function wvModOf(dst) {
  let rng = 0, col = null;
  for (const m of WV.mods) {
    if (m.dst !== dst || m.off) continue;
    rng += Math.abs(m.amt);
    col = col || WV_SRC_COL[m.src] || null;
  }
  const live = WV.tele && WV.tele.mod && typeof WV.tele.mod[dst] === 'number' ? WV.tele.mod[dst] : null;
  return { rng, live, col };
}

/// v8b: a choice key's option now: the engine's, stepped by its rows, while
/// `mod` in `/api/wave/state` names it; otherwise the stored one.
const wvChoiceNow = (k) => { const v = WV.tele && WV.tele.mod && WV.tele.mod[k]; return typeof v === 'string' ? v : wvG(k); };

/// The page's colours with the modulation drawn in that source's colour.
const wvClFor = (m) => (m && m.col ? { ...wvCl(), mod: m.col } : wvCl());

/// The value a control is at for drawing: the engine's modulated value when it
/// has one, otherwise the stored one.
const wvLiveOr = (k) => { const m = wvModOf(k); return m.live != null ? m.live : wvG(k); };

/// A source's signal now, −1..1 for an LFO and 0..1 for the rest, from the
/// engine's telemetry. With no engine there is no signal, and nothing moves.
function wvSrcVal(src) {
  const T = WV.tele;
  if (!T) return 0;
  let m = /^(?:lfo)(\d)$/.exec(src);
  if (m) {
    // The engine's own output when it sends it; otherwise its shape at the phase.
    const out = Array.isArray(T.lfoValue) ? T.lfoValue[+m[1]] : null;
    if (typeof out === 'number') return wvClamp(out, -1, 1);
    const ph = Array.isArray(T.lfo) ? T.lfo[+m[1]] : null;
    return typeof ph === 'number' ? wvLfoVal(+m[1], ((ph % 1) + 1) % 1) * 2 - 1 : 0;
  }
  m = /^(?:macro)(\d)$/.exec(src);
  if (m) return wvG(src);
  if (src === 'mw') return WV.mw;
  const vs = Array.isArray(T.voices) ? T.voices : [];
  // v8: the playing hand, from the newest voice, as the engine reads it for
  // what every voice shares.
  const last = vs[vs.length - 1];
  if (src === 'vel') return last ? wvClamp(+last.vel || 0) : 0;
  if (src === 'note') return last ? wvClamp(((+last.note || 60) - 36) / 60) : 0;
  if (src === 'at') return typeof T.at === 'number' ? wvClamp(T.at) : 0;
  if (src === 'rand') return typeof T.rand === 'number' ? wvClamp(T.rand) : 0;
  // The envelopes are per voice; the loudest voice stands for them.
  return vs.reduce((a, v) => Math.max(a, +v.env || 0), 0);
}

// ─────────────────────────────────────────────────────────── the engine's routes
//
// Moves go out as `live` while a control is being dragged — heard, not stored —
// at most about sixty a second for each key, and once more without `live` when
// it is let go. A key that is still waiting to go out live when the commit is
// sent is dropped, so the stored value is always the last word.

const wvLiveTimers = new Map();
const wvLiveLast = new Map();
const wvTouched = new Set();

async function wvPost(path, body) {
  if (!WV.connected) return null;
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    return await r.json().catch(() => ({}));
  } catch { return null; }
}

/// While dragging: the value moves now, and reaches the engine throttled.
function wvLive(key, value) {
  WV.p[key] = value;
  wvTouched.add(key);
  if (!WV.connected) return;
  const since = performance.now() - (wvLiveLast.get(key) || 0);
  if (since >= 16 && !wvLiveTimers.has(key)) {
    wvLiveLast.set(key, performance.now());
    wvPost('/api/wave/param', { key, value, live: true });
    return;
  }
  if (wvLiveTimers.has(key)) return;
  wvLiveTimers.set(key, setTimeout(() => {
    wvLiveTimers.delete(key);
    wvLiveLast.set(key, performance.now());
    wvPost('/api/wave/param', { key, value: WV.p[key], live: true });
  }, Math.max(0, 16 - since)));
}

/// Stored: a click, a choice, or the end of a drag.
function wvCommit(key, value) {
  if (value !== undefined) WV.p[key] = value;
  wvTouched.delete(key);
  clearTimeout(wvLiveTimers.get(key));
  wvLiveTimers.delete(key);
  wvPost('/api/wave/param', { key, value: WV.p[key] });
  wvSyncSoon();
}

function wvCommitTouched() {
  for (const k of [...wvTouched]) wvCommit(k);
  if (WV.modsDirty) { WV.modsDirty = false; wvSendMods(); }
}

/// The rows as the engine takes them. v8b: every row, a row switched off in
/// the Matrix with `on: false`, so it is kept, saved and listed, and moves
/// nothing.
const wvModsOut = () => WV.mods.map(({ src, dst, amt, curve, via, off }) => ({ src, dst, amt, curve: curve || 'lin', via: via ?? null, on: !off }));
/// A row from the engine: `on: false` is the page's `off`.
const wvModIn = ({ on, ...m }) => ({ curve: 'lin', via: null, ...m, off: on === false });

function wvSendMods() {
  wvPost('/api/wave/mods', { mods: wvModsOut() });
}

/// The wheels: a bend springs back to the middle, the mod wheel stays put.
const wvControlLast = { at: 0, timer: null };
function wvSendControl(body) {
  if (!WV.connected) return;
  clearTimeout(wvControlLast.timer);
  const since = performance.now() - wvControlLast.at;
  if (since >= 16) { wvControlLast.at = performance.now(); wvPost('/api/wave/control', body); return; }
  wvControlLast.timer = setTimeout(() => { wvControlLast.at = performance.now(); wvPost('/api/wave/control', body); }, 16 - since);
}

function wvNote(note, vel, on) {
  if (on) WV.held.set(note, vel); else WV.held.delete(note);
  wvPost('/api/wave/note', { note, vel, on });
}

/// Adopt a patch from the engine, over the defaults, so a key it does not send
/// keeps the mock-up's value rather than drawing nothing.
function wvAdopt(patch) {
  if (!patch || typeof patch !== 'object') return;
  if (patch.params && typeof patch.params === 'object') Object.assign(WV.p, patch.params);
  if (Array.isArray(patch.mods)) WV.mods = patch.mods.map(wvModIn);
  if (Array.isArray(patch.macroNames)) WV.macroNames = WV_MACRO_NAMES.map((n, i) => patch.macroNames[i] || n);
  if (typeof patch.name === 'string' && patch.name) WV.name = patch.name;
  if (patch.tags != null) WV.tags = Array.isArray(patch.tags) ? patch.tags.join(' · ') : String(patch.tags);
  // v8: the patch carries its board.
  if (patch.board && Array.isArray(patch.board.nodes)) wvBoardAdopt(patch.board);
}

/// The whole patch, as `POST /api/wave/patch` takes it. v8: with its board,
/// which the engine would otherwise rebuild from the old chain's keys.
const wvPatchBody = () => ({ params: { ...WV.p }, mods: wvModsOut(), macroNames: WV.macroNames, name: WV.name, tags: WV.tags, ...(WV.board ? { board: wvBoardOut() } : {}) });

/// A table's frames: the engine's if it has sent them, the built-in otherwise.
function wvTable(name) {
  return WV.tables[name] || wvBuiltinTable(name);
}

async function wvFetchTable(name) {
  if (!WV.connected || !name) return;
  try {
    const r = await fetch(`/api/wave/table?name=${encodeURIComponent(name)}`);
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.frames) && j.frames.length) {
      WV.tables[name] = j.frames.map((f) => (f.length === WV_NP ? Float32Array.from(f) : wvResample(f)));
      wvSpecCache.clear();
    }
  } catch { /* drawn from the built-in */ }
}

/// Any frame length to the 256 points the page draws with.
function wvResample(f) {
  const o = new Float32Array(WV_NP);
  for (let n = 0; n < WV_NP; n++) {
    const p = n / WV_NP * f.length, i = Math.floor(p), u = p - i;
    o[n] = (f[i] || 0) * (1 - u) + (f[(i + 1) % f.length] || 0) * u;
  }
  return o;
}

/// Open: the patch, then the oscillators' tables. Anything but a good answer
/// leaves the mock-up's state in place and says so, quietly, in the header.
async function wvConnect() {
  let ok = false;
  try {
    const r = await fetch('/api/wave/patch');
    if (r.ok) {
      const j = await r.json();
      wvAdopt(j);
      ok = true;
    }
  } catch { /* not connected */ }
  WV.connected = ok;
  const note = $('wvOffline');
  if (note) note.hidden = ok;
  if (ok) await Promise.all([...[0, 1, 2].map((i) => wvFetchTable(wvG(`osc${i}.table`))), wvBoardConnect()]);
  if (WV.built) wvSyncAll();
  return ok;
}

// ─────────────────────────────────────────────────────────────── telemetry
//
// About thirty times a second, and only while the page is on screen. One
// request in flight at a time, so a slow answer is skipped rather than queued.

const wvPoll = { timer: null, busy: false, retry: null };

function wvPollStart() {
  wvPollStop();
  wvPoll.timer = setInterval(async () => {
    if (!WV.showing || !WV.connected || wvPoll.busy || document.hidden) return;
    wvPoll.busy = true;
    try {
      const r = await fetch('/api/wave/state');
      // Read first, then kept only if the page is still showing: a reply
      // that lands after leaving is dropped.
      const j = r.ok ? await r.json() : null;
      if (j && WV.showing) WV.tele = j;
    } catch { /* the next one */ }
    wvPoll.busy = false;
  }, 33);
}

function wvPollStop() {
  clearInterval(wvPoll.timer);
  wvPoll.timer = null;
  WV.tele = null;
}
