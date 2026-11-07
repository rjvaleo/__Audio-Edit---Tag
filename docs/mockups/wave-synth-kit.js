// Wave mock-up kit: tables, warps, spectra, and controls that draw what they do.
const dpr = Math.min(2, devicePixelRatio || 1), NP = 256, TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

// ── tables ───────────────────────────────────────────────────────────────
function additive(nf, ampFn) {
  const T = [];
  for (let f = 0; f < nf; f++) {
    const t = f / (nf - 1), a = new Float32Array(NP);
    for (let k = 1; k <= 48; k++) {
      const amp = ampFn(k, t); if (!amp) continue;
      for (let i = 0; i < NP; i++) a[i] += amp * Math.sin(TAU * k * i / NP);
    }
    norm(a); T.push(a);
  }
  return T;
}
function norm(a) { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); if (m) for (let i = 0; i < a.length; i++) a[i] /= m; return a; }
const TABLES = {
  'Formant Sweep': additive(64, (k, t) => {
    const saw = 1 / k, sq = k % 2 ? 1 / k : 0, form = Math.exp(-(((k - (3 + t * 16)) / 2.4) ** 2)) / Math.sqrt(k) + (k === 1 ? .35 : 0);
    if (t < 1 / 3) { const u = t * 3; return (k === 1 ? 1 : 0) * (1 - u) + saw * u; }
    if (t < 2 / 3) { const u = (t - 1 / 3) * 3; return saw * (1 - u) + sq * u; }
    const u = (t - 2 / 3) * 3; return sq * (1 - u) + form * u;
  }),
  'Glass Organ': additive(64, (k, t) => [1, 2, 3, 4, 6, 8, 12, 16].includes(k) ? Math.pow(.62 + t * .3, Math.log2(k) * 2) * (1 + .4 * Math.sin(k * t * 5)) : 0),
  'Vowel Ah–Oo': additive(64, (k, t) => { const f1 = 7 - t * 4, f2 = 12 - t * 6; return (Math.exp(-(((k - f1) / 1.6) ** 2)) + .6 * Math.exp(-(((k - f2) / 2) ** 2))) / Math.sqrt(k) + (k === 1 ? .2 : 0); }),
  'Hollow Pulse': additive(64, (k, t) => { const w = .5 - t * .44; return Math.sin(Math.PI * k * w) / k; }),
  'Grit Saw': additive(64, (k, t) => (1 / k) * (1 + t * 1.5 * ((k * 7919) % 13) / 13 - t * .3)),
};
const TABLE_NAMES = Object.keys(TABLES);

function frameAt(T, p) { p = clamp(p) * (T.length - 1); const i = Math.floor(p), j = Math.min(T.length - 1, i + 1), u = p - i, o = new Float32Array(NP); for (let n = 0; n < NP; n++) o[n] = T[i][n] * (1 - u) + T[j][n] * u; return o; }
function rd(a, x) { x = ((x % 1) + 1) % 1; const p = x * a.length, i = Math.floor(p), u = p - i; return a[i] * (1 - u) + a[(i + 1) % a.length] * u; }

// ── warps ────────────────────────────────────────────────────────────────
const WARPS = {
  off:   { name: 'Off',    g: 'M2 7 H16' },
  bend:  { name: 'Bend',   g: 'M2 12 C9 12,9 2,16 2' },
  sync:  { name: 'Sync',   g: 'M2 12 L7 3 L7 12 L12 3 L12 12 L16 6' },
  pwm:   { name: 'PWM',    g: 'M2 3 H6 V12 H16' },
  fold:  { name: 'Fold',   g: 'M2 12 L5 3 L8 9 L11 3 L14 9 L16 3' },
  mirror:{ name: 'Mirror', g: 'M2 12 L9 3 L16 12' },
  asym:  { name: 'Asym',   g: 'M2 12 C4 2,6 2,8 7 L16 9' },
  quant: { name: 'Quant', g: 'M2 12 H5 V9 H8 V6 H11 V3 H16' },
  fm:    { name: 'FM ← B', g: 'M2 7 C3 1,4 1,5 7 S6 13,7 7 S9 1,10 7 S13 13,16 7' },
};
function warp(a, mode, w, mod) {
  if (mode === 'off' || w <= 0) return a;
  const o = new Float32Array(NP);
  for (let n = 0; n < NP; n++) {
    let x = n / NP, y;
    switch (mode) {
      case 'bend': { const e = 1 + w * 4; x = x < .5 ? .5 * Math.pow(2 * x, e) : 1 - .5 * Math.pow(2 * (1 - x), e); y = rd(a, x); break; }
      case 'sync': y = rd(a, x * (1 + w * 6)); break;
      case 'pwm': { const c = .5 - w * .45; x = x < c ? x / c * .5 : .5 + (x - c) / (1 - c) * .5; y = rd(a, x); break; }
      case 'fold': { y = rd(a, x) * (1 + w * 4); let g = 0; while (Math.abs(y) > 1 && g++ < 20) y = y > 1 ? 2 - y : -2 - y; break; }
      case 'mirror': { const m = .5 + (1 - w) * .5; y = x < m ? rd(a, x / m * .5) : rd(a, .5 - (x - m) / (1 - m) * .5); break; }
      case 'asym': { const c = .5 + w * .4; x = x < c ? x / c * .5 : .5 + (x - c) / (1 - c) * .5; y = rd(a, x); break; }
      case 'quant': { const s = Math.round(2 + (1 - w) * 30); y = Math.round(rd(a, x) * s) / s; break; }
      case 'fm': { const b = mod || a; y = rd(a, x + w * .35 * rd(b, x * 2)); break; }
      default: y = rd(a, x);
    }
    o[n] = y;
  }
  return o;
}
// complex harmonics 1..K (re, im), for spectra and for Web Audio PeriodicWave
const TRIG = []; for (let k = 1; k <= 64; k++) { const c = new Float32Array(NP), s = new Float32Array(NP); for (let n = 0; n < NP; n++) { c[n] = Math.cos(TAU * k * n / NP); s[n] = Math.sin(TAU * k * n / NP); } TRIG.push([c, s]); }
function spectrum(a, K = 48) { const re = new Float32Array(K), im = new Float32Array(K); for (let k = 0; k < K; k++) { const [c, s] = TRIG[k]; let r = 0, i = 0; for (let n = 0; n < NP; n++) { r += a[n] * c[n]; i += a[n] * s[n]; } re[k] = r * 2 / NP; im[k] = i * 2 / NP; } return { re, im }; }
function mags(sp) { return Array.from(sp.re, (r, k) => Math.hypot(r, sp.im[k])); }
function fromSpectrum(re, im) { const a = new Float32Array(NP); for (let k = 0; k < re.length; k++) { const [c, s] = TRIG[k]; for (let n = 0; n < NP; n++) a[n] += re[k] * c[n] + im[k] * s[n]; } return a; }

// ── canvas + pointer helpers ──────────────────────────────────────────────
function cv(el) { const w = +el.dataset.w, h = +el.dataset.h; el.style.width = w + 'px'; el.style.height = h + 'px'; el.width = w * dpr; el.height = h * dpr; const c = el.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return { el, c, w, h }; }
function drag(el, move, down, up) {
  el.addEventListener('pointerdown', e => {
    if (e.button) return; e.preventDefault(); el.setPointerCapture(e.pointerId); let lx = e.clientX, ly = e.clientY; down?.(e);
    const mv = ev => { move?.(ev.clientX - lx, ev.clientY - ly, ev); lx = ev.clientX; ly = ev.clientY; };
    const u = ev => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', u); up?.(ev); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', u);
  });
}
function local(el, e) { const r = el.getBoundingClientRect(), sx = (el.offsetWidth || r.width) / r.width, sy = (el.offsetHeight || r.height) / r.height; return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy]; }
function path(fn, n) { const p = new Path2D(); for (let i = 0; i <= n; i++) { const [x, y] = fn(i / n); i ? p.lineTo(x, y) : p.moveTo(x, y); } return p; }
function css(el) { const s = getComputedStyle(el), v = k => s.getPropertyValue(k).trim(); return { wave: v('--wave'), bloom: v('--bloom'), acc: v('--acc'), mod: v('--mod'), arc: v('--arc'), track: v('--track'), t: v('--t'), t2: v('--t2'), t3: v('--t3'), glow: +v('--glow') || 1, ribbon: v('--ribbon') === '1', ticks: v('--ticks') === '1' }; }
function trace(c, p, cl, lw = 1.6, g = 1) {
  c.lineJoin = 'round'; c.lineCap = 'round'; const glow = cl.glow * g;
  if (glow > 0) { c.strokeStyle = `rgba(${cl.bloom},${.16 * glow})`; c.lineWidth = lw * 3.6; c.shadowBlur = 10 * glow; c.shadowColor = `rgba(${cl.bloom},${.4 * Math.min(1, glow)})`; c.stroke(p); c.shadowBlur = 0; }
  c.strokeStyle = cl.wave; c.lineWidth = lw; c.stroke(p);
}
function under(c, p, x0, x1, base, top, cl, a = .2) { const f = new Path2D(p); f.lineTo(x1, base); f.lineTo(x0, base); f.closePath(); const g = c.createLinearGradient(0, top, 0, base); g.addColorStop(0, `rgba(${cl.bloom},${a})`); g.addColorStop(1, `rgba(${cl.bloom},0)`); c.fillStyle = g; c.fill(f); }
function dot(c, x, y, r, col) { c.fillStyle = col; c.shadowBlur = 9; c.shadowColor = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.shadowBlur = 0; }

// ring: track, single-pass value arc, mod arc and live dot, pointer
function ring(g, v, o) {
  const { c, w, h } = g, cx = w / 2, cy = h / 2, r = w / 2 - (o.inset || 5), a0 = Math.PI * .75, sw = Math.PI * 1.5, cl = o.cl, ang = x => a0 + sw * clamp(x);
  if (cl.ticks) {
    const n = w > 80 ? 33 : w > 50 ? 21 : 15;
    for (let i = 0; i < n; i++) { const x = i / (n - 1), a = ang(x), on = o.bip ? (x - .5) * (v - .5) >= 0 && Math.abs(x - .5) <= Math.abs(v - .5) + 1e-3 : x <= v + 1e-3; c.fillStyle = on ? cl.arc : cl.track; c.beginPath(); c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, w > 80 ? 1.8 : 1.3, 0, TAU); c.fill(); }
  } else {
    c.lineCap = 'round'; c.strokeStyle = cl.track; c.lineWidth = w > 60 ? 3 : 2.4; c.beginPath(); c.arc(cx, cy, r, a0, a0 + sw); c.stroke();
    const s = o.bip ? .5 : 0; c.strokeStyle = cl.arc; c.shadowBlur = 6 * cl.glow; c.shadowColor = cl.arc; c.beginPath(); c.arc(cx, cy, r, ang(Math.min(s, v)), ang(Math.max(s, v)) + 1e-4); c.stroke(); c.shadowBlur = 0;
  }
  if (o.mod) { const m0 = clamp(v + Math.min(0, o.mod)), m1 = clamp(v + Math.max(0, o.mod)); c.strokeStyle = cl.mod; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r + 3.5, ang(m0), ang(m1) + 1e-4); c.stroke(); if (o.live != null) { const a = ang(o.live); dot(c, cx + Math.cos(a) * (r + 3.5), cy + Math.sin(a) * (r + 3.5), 2.4, cl.acc); } }
  if (o.pointer) { const a = ang(v), ri = r * .2, ro = r * .62; c.strokeStyle = cl.t; c.lineWidth = 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri); c.lineTo(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro); c.stroke(); }
}
