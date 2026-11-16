// ================================================== the Reverb window
//
// The Reverb module's own window (SUITE-PLAN P4, Network Face 3, RJ 16 Nov):
// one fixed 1280 × 640 plugin window over the app, opened from a Reverb
// module's Open. Every Reverb mode wears it, the Hyperprism and Lexicon-style
// ones too.
//
// - The bar: Family and Mode, the class badge, the original it comes from,
//   On and ×.
// - Every Reverb mode's network along the top: the mode picker.
// - The mode's network beside the room in 3D. Both move with the sound: the
//   glow is the module's output level, a hit on its input lights the direct
//   sound, each wall's reflection and the spreading tail.
// - One band of the mode's own controls (the app's knobs and faders, with
//   their pictures), then Place: where the sound sits (prism-fx `place`,
//   ours, around the exact mode; off, the mode is exactly as measured).
//
// The network is drawn from the mode's own structure (`rvNet`), the room from
// Place's own geometry (`rvRoomWorld`, the same as prism-fx's).

const RV_SHAPES = ['Room', 'Hall', 'Cathedral', 'Dome', 'Chamber', 'Plate'];

const rvR01 = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
function rvSeries(n, r, base) { return Array.from({ length: n }, (_, k) => base * Math.pow(r, k)); }
function rvSmLens(v, n, pow) {
  const r = 1 - Math.pow(0.007071 * v.spacing, 3);
  const base = 0.3 + 0.7 * Math.sqrt(rvR01(v.delayMs, 0, 2000));
  return rvSeries(n, Math.pow(r, pow), base);
}
function rvNet(m, v) {
  const lr = (n) => Array.from({ length: n }, (_, k) => (k % 2 ? 'R' : 'L'));
  const rl = (n) => Array.from({ length: n }, (_, k) => (k % 2 ? 'L' : 'R'));
  const dens = v.density !== undefined ? v.density / 100 : 0.6;
  const AP = (n, k = 1) => ({ t: 'ap', n, k });
  const MX = (n, kind, stages) => ({ t: 'mix', n, kind, stages });
  switch (m.id) {
    case 'sm-gemini': return { cols: [{ t: 'in', n: 16, map: lr(16) }, { t: 'delay', n: 16, len: rvSmLens(v, 16, 1), w: 3 }, MX(16, 'butterfly', 4), { t: 'out', n: 16, map: lr(16) }], fb: [[2, 1, '√f']], dens };
    case 'sm-hydra': return { cols: [{ t: 'in', n: 8, map: lr(8) }, { t: 'delay', n: 8, len: rvSmLens(v, 16, 1).filter((_, i) => i % 2 === 0), w: 3 }, MX(8, 'butterfly', 3), AP(8), MX(8, 'butterfly', 3), { t: 'out', n: 8, map: ['L', 'R'] }], fb: [[4, 1, '√f']], dens };
    case 'sm-centaurus': return { cols: [{ t: 'in', n: 4, map: ['L', 'R', 'L', 'R'] }, AP(4), MX(4, 'butterfly', 2), AP(4), MX(4, 'butterfly', 2), AP(4), MX(4, 'butterfly', 2), AP(4), MX(4, 'butterfly', 2), { t: 'out', n: 4, map: ['L', 'R'] }], fb: [], dens, note: '−g⁴ direct' };
    case 'sm-sagittarius': { const c = [{ t: 'in', n: 2, map: ['L', 'R'] }]; for (let i = 0; i < 8; i++) c.push(AP(2), MX(2, 'rot')); c.push({ t: 'out', n: 2, map: ['L', 'R'] }); return { cols: c, fb: [], dens, note: '−g⁸ direct' }; }
    case 'sm-great-annihilator': return { cols: [{ t: 'in', n: 4, map: ['L', 'R', 'L', 'R'] }, { t: 'delay', n: 4, len: rvSmLens(v, 16, 4).slice(0, 4), w: 2.4 }, MX(4, 'butterfly', 2), AP(4), MX(4, 'butterfly', 2), AP(4), MX(4, 'butterfly', 2), AP(4), MX(4, 'butterfly', 2), { t: 'out', n: 4, map: ['L', 'R'] }], fb: [[8, 1, 'f']], dens };
    case 'sm-andromeda': { const c = [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'delay', n: 2, len: rvSmLens(v, 2, 1), w: 2.4 }, MX(2, 'rot')]; for (let i = 0; i < 7; i++) c.push(AP(2), MX(2, 'rot')); c.push({ t: 'out', n: 2, map: ['L', 'R'] }); return { cols: c, fb: [[c.length - 2, 1, 'g']], dens }; }
    case 'sm-lyra': return { cols: [{ t: 'in', n: 4, map: lr(4) }, { t: 'delay', n: 4, len: rvSmLens(v, 4, 4), w: 4 }, MX(4, 'butterfly', 2), { t: 'out', n: 4, map: lr(4) }], fb: [[2, 1, '√f']], dens };
    case 'sm-capricorn': return { cols: [{ t: 'in', n: 8, map: lr(8) }, { t: 'delay', n: 8, len: rvSmLens(v, 8, 2), w: 4 }, MX(8, 'butterfly', 3), { t: 'out', n: 8, map: lr(8) }], fb: [[2, 1, '√f']], dens };
    case 'sm-triangulum': { const c = [{ t: 'in', n: 2, map: ['L', 'R'] }]; for (let i = 0; i < 7; i++) c.push(AP(2), MX(2, 'rot')); c.push({ t: 'delay', n: 2, len: rvSmLens(v, 16, 1).slice(14), w: 2 }, { t: 'filter', n: 2 }, { t: 'out', n: 2, map: ['L', 'R'] }); return { cols: c, fb: [[c.length - 2, 1, 'f · L↔R', true]], dens }; }
    case 'sm-lmc': return { cols: [{ t: 'in', n: 4, map: ['L', 'R', 'L', 'R'] }, AP(4), MX(4, 'butterfly', 2), AP(4), MX(4, 'butterfly', 2), AP(4), MX(4, 'butterfly', 2), { t: 'delay', n: 4, len: rvSmLens(v, 16, 1).filter((_, i) => i % 4 === 3), w: 2.2 }, { t: 'filter', n: 4 }, MX(4, 'householder'), { t: 'out', n: 4, map: ['L', 'R'] }], fb: [[9, 1, 'f']], dens };
    case 'sm-cirrus-major': return { cols: [{ t: 'in', n: 8, map: rl(8) }, { t: 'filter', n: 8 }, { t: 'delay', n: 8, len: rvSmLens(v, 16, 1).filter((_, i) => i % 2 === 0), w: 3 }, AP(8), MX(8, 'butterfly', 3), MX(8, 'perm'), { t: 'out', n: 8, map: ['L', 'R'] }], fb: [[5, 1, '√f · π']], dens };
    case 'sm-cirrus-minor': return { cols: [{ t: 'in', n: 8, map: rl(8) }, { t: 'delay', n: 8, len: rvSmLens(v, 8, 2), w: 3.4 }, { t: 'filter', n: 8 }, MX(8, 'butterfly', 3), MX(8, 'perm'), { t: 'out', n: 8, map: ['L', 'R'] }], fb: [[4, 1, '√f · π']], dens };
    case 'freeverb': { const L = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]; const len = [...L, ...L.map((x) => x + 23)].map((x) => (x / 1640) * (0.55 + 0.45 * v.roomSize)); return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'sum', n: 1 }, { t: 'split', n: 16 }, { t: 'delay', n: 16, len, comb: true, w: 3.2 }, { t: 'sum', n: 2 }, AP(2, 4), MX(2, 'rot'), { t: 'out', n: 2, map: ['L', 'R'] }], fb: [], dens: 1 - v.width * 0.6 }; }
    case 'jcrev': { const C = [0.0297, 0.0371, 0.0411, 0.0437]; const len = [...C, ...C].map((x) => x / 0.0437); return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'split', n: 8, pairs: true }, { t: 'delay', n: 8, len, comb: true, w: 3.4 }, { t: 'sum', n: 2 }, AP(2, 2), { t: 'out', n: 2, map: ['L', 'R'] }], fb: [], dens: 0 }; }
    case 'ambient-fdn': { const TN = [0.153129, 0.210389, 0.127837, 0.256891, 0.174713, 0.192303, 0.125, 0.219991]; const sf = v.size / 100 * 0.95 + 0.05; return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'taps', n: 2 }, { t: 'split', n: 8 }, { t: 'delay', n: 8, len: TN.map((t) => (t / 0.256891) * (0.3 + 0.7 * sf)), w: 3 }, AP(8), MX(8, 'hadamard'), { t: 'filter', n: 8 }, { t: 'out', n: 8, map: ['L', 'R'] }], fb: [[6, 3, 'g·shelf·LP']], dens: 1 }; }
    case 'schroeder-reverb': { const C = [29.7, 37.1, 41.1, 43.7]; const len = [...C, ...C.map((x) => x * (1 + v.spread))].map((x) => (x / 52) * Math.min(1, 0.35 + 0.08 * v.size)); return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'delay', n: 2, len: [0.15, 0.15], w: 0.8 }, { t: 'split', n: 8, pairs: true }, { t: 'delay', n: 8, len, comb: true, w: 3 }, { t: 'sum', n: 2 }, AP(2, 2), { t: 'out', n: 2, map: ['L', 'R'] }], fb: [], dens: 0 }; }
    case 'moorer-reverb': { const C = [50, 56, 61, 68, 72, 78]; const len = [...C, ...C].map((x) => (x / 80) * Math.min(1, 0.35 + 0.08 * v.size)); return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'taps', n: 2 }, { t: 'split', n: 12, pairs: true }, { t: 'delay', n: 12, len, comb: true, w: 3 }, { t: 'filter', n: 12 }, { t: 'sum', n: 2 }, AP(2, 1), { t: 'out', n: 2, map: ['L', 'R'] }], fb: [], dens: 0 }; }
    case 'dattorro-plate': return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'sum', n: 1 }, { t: 'filter', n: 1 }, AP(1, 4), { t: 'split', n: 2 }, AP(2, 1), { t: 'delay', n: 2, len: [0.85, 0.72], w: 1.6 }, { t: 'filter', n: 2 }, AP(2, 1), { t: 'delay', n: 2, len: [0.7, 0.6], w: 1.4 }, { t: 'out', n: 2, map: ['L', 'R'] }], fb: [[9, 5, 'decay · ×', true]], dens: 0 };
    case 'hp-hall': case 'hp-medium-room': return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, AP(2, 3), { t: 'split', n: 4, pairs: true }, { t: 'delay', n: 4, len: m.id === 'hp-hall' ? [0.95, 0.82, 0.88, 0.75] : [0.6, 0.5, 0.55, 0.45], w: 2.6 }, MX(4, 'butterfly', 2), { t: 'filter', n: 4 }, { t: 'out', n: 4, map: ['L', 'R'] }], fb: [[5, 3, 'feedback']], dens: (v.diffusion ?? 100) / 200 };
    case 'lxp-chamber': case 'lxp-hall': case 'lxp-plate': case 'lxp-room': { const s = rvR01(v.sizeM, 3, 60); return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'taps', n: 2 }, AP(2, 2), { t: 'split', n: 4, pairs: true }, { t: 'delay', n: 4, len: [0.9, 0.78, 0.84, 0.7].map((x) => x * (0.35 + 0.65 * s)), w: 2.6 }, MX(4, 'hadamard'), { t: 'filter', n: 4 }, { t: 'out', n: 4, map: ['L', 'R'] }], fb: [[6, 4, 'RT · bass · hi-cut']], dens: (v.diffusion ?? 60) / 100 }; }
    case 'convolution': return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'ir', n: 2, w: 6 }, { t: 'out', n: 2, map: ['L', 'R'] }], fb: [], dens: 0 };
    case 'allpass-diffuser': return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, AP(2, 1), { t: 'out', n: 2, map: ['L', 'R'] }], fb: [], dens: 0 };
  }
  return { cols: [{ t: 'in', n: 2, map: ['L', 'R'] }, { t: 'out', n: 2, map: ['L', 'R'] }], fb: [], dens: 0 };
}

/// Seconds to −60 dB, from whatever the mode's decay control is.
const rvCss = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let RV_COL = {};
function rvReadColours() {
  RV_COL = {
    accent: rvCss('--rv-rgb'), ice: rvCss('--rv-ice-rgb'), onRgb: rvCss('--rv-on-rgb'), off: rvCss('--rv-off-rgb'), well: rvCss('--well'), white: rvCss('--white-rgb'),
    dim: `rgba(${rvCss('--white-rgb')},0.16)`, dimmer: `rgba(${rvCss('--white-rgb')},0.09)`, text: rvCss('--text-dim'), on: rvCss('--on'),
  };
}

function rvLanesY(n, top, bot) {
  if (n === 1) return [(top + bot) / 2];
  return Array.from({ length: n }, (_, i) => top + (bot - top) * (i / (n - 1)));
}

/// Draw `spec` into a 2D context of w × h. `e` is the glow (0..1), `t` the time.
function rvDrawNet(ctx, w, h, spec, opt) {
  const { e = 0.35, t = 0, ice = false, mod = 0, rate = 0.5, small = false, freezeHold = false } = opt;
  const rgb = ice ? RV_COL.ice : RV_COL.accent;
  ctx.clearRect(0, 0, w, h);
  const padX = small ? 10 : 16, top = small ? 8 : 30, bot = h - (small ? 12 : 26);
  const weights = spec.cols.map((c) => c.w ?? ({ in: 0.5, out: 0.5, mix: 0.9, ap: 0.8 + 0.25 * ((c.k || 1) - 1), filter: 0.7, sum: 0.7, split: 0.7, taps: 0.8, delay: 2, ir: 6 }[c.t] ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = w - 2 * padX;
  let x = padX;
  const cols = spec.cols.map((c, i) => { const cw = span * weights[i] / total; const col = { ...c, x0: x, x1: x + cw, ys: rvLanesY(c.n, top, bot) }; x += cw; return col; });
  const wob = (k) => mod * Math.sin(2 * Math.PI * rate * t + (k * Math.PI) / 8) * (small ? 0.8 : 2.2);
  const lineCol = (a) => `rgba(${rgb},${a})`;
  ctx.lineCap = 'round';
  // links between columns
  for (let i = 0; i + 1 < cols.length; i++) {
    const a = cols[i], b = cols[i + 1];
    ctx.strokeStyle = lineCol(0.18 + 0.5 * e);
    ctx.lineWidth = small ? 0.7 : 1;
    const from = a.ys, to = b.ys;
    if (from.length === to.length) {
      from.forEach((y, k) => { if (a.t === 'mix' || b.t === 'mix') return; ctx.beginPath(); ctx.moveTo(a.x1, y + wob(k)); ctx.lineTo(b.x0, to[k] + wob(k)); ctx.stroke(); });
    } else {
      // join or fan: each source lane to its share of the targets
      from.forEach((y, k) => {
        const targets = to.length > from.length ? to.filter((_, j) => (b.pairs ? Math.floor(j / (to.length / from.length)) === k : j % from.length === k)) : [to[Math.floor(k * to.length / from.length)]];
        targets.forEach((ty) => { ctx.beginPath(); ctx.moveTo(a.x1, y); ctx.bezierCurveTo((a.x1 + b.x0) / 2, y, (a.x1 + b.x0) / 2, ty, b.x0, ty); ctx.stroke(); });
      });
    }
  }
  // columns
  for (const c of cols) {
    const cw = c.x1 - c.x0, cx = (c.x0 + c.x1) / 2;
    if (c.t === 'in' || c.t === 'out') {
      const ends = c.t === 'in' ? c.ys : rvLanesY(2, top + (bot - top) * 0.25, bot - (bot - top) * 0.25);
      if (c.t === 'out') {
        c.ys.forEach((y, k) => { const who = c.map[k]; if (!who) return; const ty = who === 'L' ? ends[0] : ends[1]; ctx.strokeStyle = lineCol(0.25 + 0.6 * e); ctx.lineWidth = small ? 0.7 : 1; ctx.beginPath(); ctx.moveTo(c.x0, y + wob(k)); ctx.bezierCurveTo(cx, y, cx, ty, c.x1, ty); ctx.stroke(); });
        ['L', 'R'].forEach((s, k) => { ctx.fillStyle = lineCol(0.5 + 0.5 * e); ctx.beginPath(); ctx.arc(c.x1, ends[k], small ? 1.8 : 2.6, 0, 7); ctx.fill(); if (!small) { ctx.fillStyle = RV_COL.text; ctx.font = '9px JetBrains Mono, monospace'; ctx.fillText(s, c.x1 + 4, ends[k] + 3); } });
      } else {
        const src = rvLanesY(2, top + (bot - top) * 0.25, bot - (bot - top) * 0.25);
        c.ys.forEach((y, k) => { const s = c.map[k] === 'L' ? src[0] : src[1]; ctx.strokeStyle = lineCol(0.22 + 0.5 * e); ctx.lineWidth = small ? 0.7 : 1; ctx.beginPath(); ctx.moveTo(c.x0, s); ctx.bezierCurveTo(cx, s, cx, y, c.x1, y + wob(k)); ctx.stroke(); });
        ['L', 'R'].forEach((s, k) => { ctx.fillStyle = lineCol(0.85); ctx.beginPath(); ctx.arc(c.x0, src[k], small ? 1.8 : 2.6, 0, 7); ctx.fill(); if (!small) { ctx.fillStyle = RV_COL.text; ctx.font = '9px JetBrains Mono, monospace'; ctx.fillText(s, c.x0 - 10, src[k] + 3); } });
      }
    } else if (c.t === 'delay') {
      const bh = Math.max(1.4, Math.min(small ? 2 : 4, (bot - top) / c.n * 0.42));
      c.ys.forEach((y0, k) => {
        const y = y0 + wob(k), L = Math.max(0.04, Math.min(1, c.len[k] ?? 0.5)) * cw;
        ctx.fillStyle = RV_COL.dimmer; ctx.fillRect(c.x0, y - bh / 2, cw, bh);
        ctx.fillStyle = lineCol(0.25 + 0.6 * e); ctx.fillRect(c.x0, y - bh / 2, L, bh);
        // the pulse: along the bar at this line's own speed
        if (e > 0.02) { const ph = ((t * 0.9) / Math.max(0.15, c.len[k]) + k * 0.37) % 1; ctx.fillStyle = `rgba(${rgb},${Math.min(1, 0.4 + e)})`; ctx.beginPath(); ctx.arc(c.x0 + ph * L, y, bh * 0.9, 0, 7); ctx.fill(); }
        if (c.comb) { ctx.strokeStyle = lineCol(0.15 + 0.4 * e); ctx.lineWidth = small ? 0.6 : 0.8; ctx.beginPath(); ctx.moveTo(c.x0 + L, y); ctx.quadraticCurveTo(c.x0 + L + 4, y - bh * 2.2, c.x0 + L / 2, y - bh * 1.6); ctx.stroke(); }
        ctx.strokeStyle = lineCol(0.18 + 0.4 * e); ctx.lineWidth = small ? 0.6 : 0.8; ctx.beginPath(); ctx.moveTo(c.x0 + L, y); ctx.lineTo(c.x1, y); ctx.stroke();
      });
    } else if (c.t === 'ap') {
      const k = c.k || 1, rr = Math.max(1.6, Math.min(small ? 2.6 : 5, (bot - top) / c.n * 0.38, cw / (k * 2.6)));
      c.ys.forEach((y0, lane) => {
        const y = y0 + wob(lane);
        ctx.strokeStyle = lineCol(0.2 + 0.4 * e); ctx.lineWidth = small ? 0.6 : 0.8; ctx.beginPath(); ctx.moveTo(c.x0, y); ctx.lineTo(c.x1, y); ctx.stroke();
        for (let j = 0; j < k; j++) { const rx = c.x0 + cw * (j + 0.5) / k; ctx.fillStyle = RV_COL.well; ctx.beginPath(); ctx.arc(rx, y, rr, 0, 7); ctx.fill(); ctx.strokeStyle = lineCol(0.45 + 0.55 * e); ctx.lineWidth = small ? 0.8 : 1.2; ctx.stroke(); }
      });
    } else if (c.t === 'mix') {
      const a = 0.06 + 0.8 * spec.dens * (0.4 + 0.6 * e);
      ctx.lineWidth = small ? 0.6 : 0.8;
      if (c.kind === 'butterfly' || c.kind === 'rot') {
        const stages = c.kind === 'rot' ? 1 : c.stages; const sw = cw / stages;
        for (let s = 0; s < stages; s++) {
          const stride = 1 << s, xa = c.x0 + s * sw, xb = xa + sw;
          c.ys.forEach((y, j) => {
            const p = j ^ stride; const yp = c.ys[p] ?? y;
            ctx.strokeStyle = lineCol(0.18 + 0.5 * e * (1 - spec.dens * 0.6)); ctx.beginPath(); ctx.moveTo(xa, y + wob(j)); ctx.lineTo(xb, y + wob(j)); ctx.stroke();
            if (p < c.ys.length) { ctx.strokeStyle = lineCol(a); ctx.beginPath(); ctx.moveTo(xa, y + wob(j)); ctx.lineTo(xb, yp + wob(p)); ctx.stroke(); }
          });
        }
      } else if (c.kind === 'hadamard') {
        c.ys.forEach((y, j) => c.ys.forEach((y2) => { ctx.strokeStyle = lineCol(a * 0.55); ctx.beginPath(); ctx.moveTo(c.x0, y + wob(j)); ctx.lineTo(c.x1, y2); ctx.stroke(); }));
      } else if (c.kind === 'householder') {
        const my = (top + bot) / 2;
        c.ys.forEach((y, j) => { ctx.strokeStyle = lineCol(0.2 + 0.5 * e); ctx.beginPath(); ctx.moveTo(c.x0, y + wob(j)); ctx.lineTo(c.x1, y + wob(j)); ctx.stroke(); ctx.strokeStyle = lineCol(a); ctx.beginPath(); ctx.moveTo(c.x0, y); ctx.lineTo(cx, my); ctx.lineTo(c.x1, y); ctx.stroke(); });
        ctx.fillStyle = lineCol(0.6 + 0.4 * e); ctx.beginPath(); ctx.arc(cx, my, small ? 1.6 : 2.4, 0, 7); ctx.fill();
      } else if (c.kind === 'perm') {
        const PI = [7, 6, 1, 0, 3, 2, 5, 4];
        c.ys.forEach((y, j) => { const to = c.ys[PI[j] ?? j]; ctx.strokeStyle = lineCol(0.22 + 0.55 * e); ctx.beginPath(); ctx.moveTo(c.x0, y + wob(j)); ctx.bezierCurveTo(cx, y, cx, to, c.x1, to); ctx.stroke(); });
      }
    } else if (c.t === 'filter') {
      c.ys.forEach((y0, k) => {
        const y = y0 + wob(k), fw = Math.min(cw * 0.7, small ? 7 : 12), fh = Math.min(small ? 3 : 5, (bot - top) / c.n * 0.4);
        ctx.strokeStyle = lineCol(0.2 + 0.4 * e); ctx.lineWidth = small ? 0.6 : 0.8; ctx.beginPath(); ctx.moveTo(c.x0, y); ctx.lineTo(cx - fw / 2, y); ctx.moveTo(cx + fw / 2, y); ctx.lineTo(c.x1, y); ctx.stroke();
        ctx.strokeStyle = `rgba(${RV_COL.on ? RV_COL.onRgb : rgb},${0.55 + 0.4 * e})`; ctx.lineWidth = small ? 0.8 : 1.1; ctx.beginPath(); ctx.moveTo(cx - fw / 2, y + fh / 2); ctx.quadraticCurveTo(cx - fw / 4, y - fh, cx, y - fh / 2); ctx.quadraticCurveTo(cx + fw / 4, y, cx + fw / 2, y + fh / 2); ctx.stroke();
      });
    } else if (c.t === 'sum' || c.t === 'split') {
      c.ys.forEach((y) => { ctx.strokeStyle = lineCol(0.2 + 0.4 * e); ctx.lineWidth = small ? 0.6 : 0.8; ctx.beginPath(); ctx.moveTo(c.x0, y); ctx.lineTo(c.x1, y); ctx.stroke(); });
      if (c.t === 'sum') c.ys.forEach((y) => { ctx.fillStyle = lineCol(0.5 + 0.5 * e); ctx.beginPath(); ctx.arc(cx, y, small ? 1.5 : 2.2, 0, 7); ctx.fill(); });
    } else if (c.t === 'taps') {
      c.ys.forEach((y) => { ctx.strokeStyle = lineCol(0.2 + 0.4 * e); ctx.lineWidth = small ? 0.6 : 0.8; ctx.beginPath(); ctx.moveTo(c.x0, y); ctx.lineTo(c.x1, y); ctx.stroke(); });
      const n = small ? 9 : 18, ty = top - (small ? 3 : 9);
      for (let i = 0; i < n; i++) { const tx = c.x0 + cw * (0.08 + 0.84 * Math.pow(i / (n - 1), 0.8)); const th = (small ? 4 : 9) * (1 - i / n) * (0.4 + 0.6 * e); ctx.strokeStyle = lineCol(0.35 + 0.5 * e); ctx.beginPath(); ctx.moveTo(tx, ty + (small ? 5 : 11)); ctx.lineTo(tx, ty + (small ? 5 : 11) - th); ctx.stroke(); }
    } else if (c.t === 'ir') {
      c.ys.forEach((y, k) => { ctx.strokeStyle = lineCol(0.3 + 0.5 * e); ctx.lineWidth = small ? 0.6 : 0.8; ctx.beginPath(); for (let i = 0; i <= 120; i++) { const u = i / 120, env = Math.exp(-u * 4), n = Math.sin(i * 12.9898 + k * 7) * 43758.5453 % 1; const yy = y - env * n * (small ? 6 : 14); if (i === 0) ctx.moveTo(c.x0 + u * cw, yy); else ctx.lineTo(c.x0 + u * cw, yy); } ctx.stroke(); });
    }
  }
  // feedback arcs, under the lanes
  for (const [from, to, label, crossed] of spec.fb) {
    const a = cols[from], b = cols[to]; if (!a || !b) continue;
    const y = bot + (small ? 6 : 14), x1 = a.x1, x0 = b.x0;
    ctx.setLineDash(small ? [2, 2] : [3, 3]);
    ctx.strokeStyle = lineCol(0.25 + 0.65 * e); ctx.lineWidth = small ? 0.8 : 1.2;
    ctx.beginPath(); ctx.moveTo(x1, bot); ctx.quadraticCurveTo(x1 + 6, y, (x0 + x1) / 2, y); ctx.quadraticCurveTo(x0 - 6, y, x0, bot); ctx.stroke();
    ctx.setLineDash([]);
    if (crossed && !small) { ctx.strokeStyle = lineCol(0.35 + 0.5 * e); ctx.beginPath(); ctx.moveTo((x0 + x1) / 2 - 4, y - 4); ctx.lineTo((x0 + x1) / 2 + 4, y + 4); ctx.moveTo((x0 + x1) / 2 + 4, y - 4); ctx.lineTo((x0 + x1) / 2 - 4, y + 4); ctx.stroke(); }
    if (!small) { ctx.fillStyle = `rgba(${rgb},0.9)`; ctx.font = '9px JetBrains Mono, monospace'; const tw = ctx.measureText(label).width; ctx.fillText(label, (x0 + x1) / 2 - tw / 2, y + 10); }
  }
  if (spec.note && !small) { ctx.fillStyle = RV_COL.text; ctx.font = '9px JetBrains Mono, monospace'; ctx.fillText(spec.note, w - padX - ctx.measureText(spec.note).width, h - 4); }
  if (ice && !small) { ctx.fillStyle = `rgba(${RV_COL.ice},0.06)`; ctx.fillRect(0, 0, w, h); }
}

function rvPlan(shape) {
  switch (RV_SHAPES[shape]) {
    case 'Room': return { pts: [[-0.5, 0], [0.5, 0], [0.5, 1.15], [-0.5, 1.15]], ceil: 0.32 };
    case 'Hall': return { pts: [[-0.36, 0], [0.36, 0], [0.36, 1.7], [-0.36, 1.7]], ceil: 0.55 };
    case 'Cathedral': return { pts: [[-0.2, 0], [0.2, 0], [0.2, 0.75], [0.55, 0.75], [0.55, 1.05], [0.2, 1.05], [0.2, 1.75], [-0.2, 1.75], [-0.2, 1.05], [-0.55, 1.05], [-0.55, 0.75], [-0.2, 0.75]], ceil: 1.0 };
    case 'Dome': return { pts: Array.from({ length: 28 }, (_, i) => { const a = (i / 28) * 2 * Math.PI; return [0.55 * Math.cos(a), 0.6 + 0.6 * Math.sin(a)]; }), ceil: 0.85 };
    case 'Chamber': return { pts: [[-0.42, 0], [0.38, 0], [0.55, 0.45], [0.32, 1.05], [-0.3, 1.12], [-0.55, 0.5]], ceil: 0.42 };
    default: return { pts: [[-0.75, 0.42], [0.75, 0.42], [0.75, 0.72], [-0.75, 0.72]], ceil: 0.06, plate: true };
  }
}
function rvMirror(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  const fx = a[0] + t * dx, fy = a[1] + t * dy;
  return [2 * fx - p[0], 2 * fy - p[1]];
}
function rvCross(p, q, a, b) {
  const r = [q[0] - p[0], q[1] - p[1]], s2 = [b[0] - a[0], b[1] - a[1]];
  const d = r[0] * s2[1] - r[1] * s2[0]; if (Math.abs(d) < 1e-9) return null;
  const t = ((a[0] - p[0]) * s2[1] - (a[1] - p[1]) * s2[0]) / d, u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / d;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? [p[0] + t * r[0], p[1] + t * r[1]] : null;
}
const RV3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], rvCross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; } };
const RV_CAM = { yaw: -0.38, pitch: 0.5 };
let RV_ROOM = null;
function rvInside(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
/// Where everything is, in room units: x across, y away from you, z up.
function rvRoomWorld(v) {
  const P = rvPlan(Math.round(v.roomShape));
  const depth = Math.max(...P.pts.map((q) => q[1])), wide = Math.max(...P.pts.map((q) => Math.abs(q[0]))) * 2;
  const H = P.plate ? 0.5 : 0.2 + 0.75 * P.ceil;
  const listen = P.plate ? [0, 0.15, 0.25] : [0, depth * 0.1, Math.min(0.13, H * 0.4)];
  const d01 = 0.12 + 0.78 * v.placeDist / 100;
  const src = P.plate
    ? [v.placePos / 100 * 0.6, 0.57, 0.25]
    : [v.placePos / 100 * wide * 0.36, listen[1] + d01 * (depth - listen[1]) * 0.92, 0.03 + 0.9 * H * v.placeHeight / 100];
  return { P, depth, wide, H, listen, src };
}
function rvCamera(w, h, W) {
  const target = [0, W.depth * 0.48, W.H * 0.3];
  const R = 1.55 * Math.max(W.depth, W.wide, W.H * 1.4);
  const cp = Math.cos(RV_CAM.pitch);
  const pos = RV3.add(target, [R * Math.sin(RV_CAM.yaw) * cp, -R * Math.cos(RV_CAM.yaw) * cp, R * Math.sin(RV_CAM.pitch)]);
  const f = RV3.norm(RV3.sub(target, pos)), r = RV3.norm(RV3.rvCross(f, [0, 0, 1])), u = RV3.rvCross(r, f);
  // Frame the room: project its corners at unit scale, then fit them to the view.
  const C = { pos, f, r, u, F: 1, cx: 0, cy: 0 };
  const corners = [];
  for (const q of W.P.pts) for (const z of [0, W.H]) corners.push([q[0], q[1], z]);
  corners.push(W.listen);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of corners) { const q = rvProj(C, p); if (!q) continue; x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const F = Math.min((w - 40) / Math.max(1e-6, x1 - x0), (h - 52) / Math.max(1e-6, y1 - y0));
  return { pos, f, r, u, F, cx: w / 2 - F * (x0 + x1) / 2, cy: h / 2 + 4 - F * (y0 + y1) / 2 };
}
function rvProj(C, p) {
  const d = RV3.sub(p, C.pos), z = RV3.dot(d, C.f);
  if (z < 0.05) return null;
  return [C.cx + (C.F * RV3.dot(d, C.r)) / z, C.cy - (C.F * RV3.dot(d, C.u)) / z, z];
}
function rvDrawRoom(ctx, w, h, v, e, since, t) {
  ctx.clearRect(0, 0, w, h);
  const on = v.placeOn >= 0.5, ice = v.freeze >= 0.5;
  const rgb = !on ? RV_COL.off : ice ? RV_COL.ice : RV_COL.accent;
  const col = (a) => `rgba(${rgb},${a})`;
  const W = rvRoomWorld(v), C = rvCamera(w, h, W);
  RV_ROOM = { W, C };
  const { P, H } = W;
  const poly = P.pts;
  const line = (a, b, style, lw = 1) => { const A = rvProj(C, a), B = rvProj(C, b); if (!A || !B) return; ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); };
  const path3 = (pts) => { ctx.beginPath(); let started = false; for (const p of pts) { const q = rvProj(C, p); if (!q) continue; if (!started) { ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]); } };
  const floorZ = P.plate ? W.H * 0.5 : 0;
  // the floor, lit by the decay, with its 5 m grid
  path3(poly.map((q) => [q[0], q[1], floorZ])); ctx.closePath();
  ctx.fillStyle = col(0.04 + 0.2 * e); ctx.fill();
  ctx.save(); ctx.clip();
  const across = v.roomSizeM * (P.plate ? 0.25 : 1), step = W.wide / Math.max(1, across / 5);
  for (let x = -W.wide; x <= W.wide; x += step) line([x, -0.2, floorZ], [x, W.depth + 0.2, floorZ], col(0.08));
  for (let y = 0; y <= W.depth + 0.2; y += step) line([-W.wide, y, floorZ], [W.wide, y, floorZ], col(0.08));
  ctx.restore();
  const edge = col(on ? 0.65 : 0.3);
  if (!P.plate) {
    // walls: their glow, their edges, and the ceiling's outline
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      path3([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], H], [a[0], a[1], H]]); ctx.closePath();
      ctx.fillStyle = col(0.015 + 0.06 * e); ctx.fill();
      line([a[0], a[1], 0], [a[0], a[1], H], col(on ? 0.35 : 0.2));
    }
    path3([...poly.map((q) => [q[0], q[1], 0]), [poly[0][0], poly[0][1], 0]]); ctx.strokeStyle = edge; ctx.lineWidth = 1.3; ctx.stroke();
    path3([...poly.map((q) => [q[0], q[1], H]), [poly[0][0], poly[0][1], H]]); ctx.strokeStyle = col(on ? 0.3 : 0.15); ctx.lineWidth = 1; ctx.stroke();
  } else {
    path3([...poly.map((q) => [q[0], q[1], floorZ]), [poly[0][0], poly[0][1], floorZ]]); ctx.strokeStyle = edge; ctx.lineWidth = 1.3; ctx.stroke();
    for (let k = 0; k < 11; k++) { const x = -0.72 + k * 0.144; const a = e * (0.5 + 0.5 * Math.sin(t * 9 + k)); line([x, 0.44, floorZ], [x, 0.7, floorZ], col(0.1 + 0.7 * a), 1.2); }
  }
  const S = W.src, L = W.listen, speed = 0.9;
  const okIn = (p) => (P.plate ? true : rvInside(poly, p[0], p[1]) && p[2] >= 0 && p[2] <= H);
  // the tail: a sphere spreading from the sound
  for (let k = 0; k < 3; k++) {
    const r = since * speed - k * 0.12; if (r <= 0) continue;
    const a = Math.max(0, e * (1 - k * 0.25)) * Math.max(0, 1 - r / (Math.max(W.depth, W.wide) * 1.6));
    if (a < 0.01) continue;
    ctx.strokeStyle = col(0.06 + 0.6 * a); ctx.lineWidth = 1;
    for (const ring of [0, 1, 2]) {
      ctx.beginPath(); let pen = false;
      for (let i = 0; i <= 64; i++) {
        const th = (i / 64) * Math.PI * 2;
        const p = ring === 0 ? [S[0] + r * Math.cos(th), S[1] + r * Math.sin(th), S[2]] : ring === 1 ? [S[0] + r * Math.cos(th), S[1], S[2] + r * Math.sin(th)] : [S[0], S[1] + r * Math.cos(th), S[2] + r * Math.sin(th)];
        const q = okIn(p) ? rvProj(C, p) : null;
        if (!q) { pen = false; continue; }
        if (!pen) { ctx.moveTo(q[0], q[1]); pen = true; } else ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
    }
  }
  // first reflections from every wall, the floor and the ceiling, lit as they arrive
  const flash = (d) => { const x = since - d; return x < 0 ? 0 : Math.exp(-x * 6); };
  const ray = (hit) => {
    const dl = Math.hypot(...RV3.sub(S, hit)) + Math.hypot(...RV3.sub(hit, L)), f = flash(dl / speed);
    line(S, hit, col(0.08 + 0.85 * f), 1); line(hit, L, col(0.08 + 0.85 * f), 1);
    const q = rvProj(C, hit); if (q) { ctx.fillStyle = col(0.25 + 0.75 * f); ctx.beginPath(); ctx.arc(q[0], q[1], 2.2, 0, 7); ctx.fill(); }
  };
  if (!P.plate) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const m2 = rvMirror([S[0], S[1]], a, b), img = [m2[0], m2[1], S[2]];
      const c2 = rvCross([L[0], L[1]], [img[0], img[1]], a, b); if (!c2) continue;
      const tt = Math.hypot(c2[0] - L[0], c2[1] - L[1]) / Math.hypot(img[0] - L[0], img[1] - L[1]);
      const z = L[2] + tt * (img[2] - L[2]); if (z < 0 || z > H) continue;
      ray([c2[0], c2[1], z]);
    }
    for (const plane of [0, H]) {
      const img = [S[0], S[1], 2 * plane - S[2]], tt = (plane - L[2]) / (img[2] - L[2]);
      const hit = RV3.add(L, RV3.mul(RV3.sub(img, L), tt));
      if (rvInside(poly, hit[0], hit[1])) ray(hit);
    }
  }
  // the direct sound
  line(S, L, `rgba(${RV_COL.white},${0.15 + 0.8 * flash(Math.hypot(...RV3.sub(S, L)) / speed)})`, 1.4);
  // you, and the width of the wet around you
  const spread = (v.placeSpread / 200) * Math.PI * 0.95, aim = Math.PI / 2 - (v.placePos / 100) * 0.6;
  path3(Array.from({ length: 25 }, (_, i) => { const a = aim - spread / 2 + (spread * i) / 24; return [L[0] + 0.09 * Math.cos(a), L[1] + 0.09 * Math.sin(a), L[2]]; }));
  ctx.strokeStyle = col(0.3 + 0.7 * e); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
  const Lq = rvProj(C, L);
  if (Lq) { ctx.fillStyle = rvCss('--text'); ctx.beginPath(); ctx.arc(Lq[0], Lq[1], Math.max(3, 9 / Lq[2] * 0.4), 0, 7); ctx.fill(); const nose = rvProj(C, [L[0], L[1] + 0.05, L[2]]); if (nose) line(L, [L[0], L[1] + 0.05, L[2]], rvCss('--text'), 2); }
  // the sound: its drop line and shadow, then itself
  line(S, [S[0], S[1], floorZ], `rgba(${RV_COL.onRgb},.45)`, 1);
  const sh = rvProj(C, [S[0], S[1], floorZ]); if (sh) { ctx.fillStyle = `rgba(${RV_COL.onRgb},.18)`; ctx.beginPath(); ctx.ellipse(sh[0], sh[1], 8, 3, 0, 0, 7); ctx.fill(); }
  const Sq = rvProj(C, S);
  if (Sq) { const rr = Math.max(4, 14 / Sq[2] * 0.45) * (1 + 0.5 * flash(0)); ctx.fillStyle = rvCss('--on'); ctx.beginPath(); ctx.arc(Sq[0], Sq[1], rr, 0, 7); ctx.fill(); RV_ROOM.Sq = [Sq[0], Sq[1], rr]; }
  const metres = Math.round(v.roomSizeM * (0.15 + 0.85 * v.placeDist / 100) * 0.7);
  return on ? `${RV_SHAPES[Math.round(v.roomShape)]} · ${Math.round(v.roomSizeM)} m · the sound ${metres} m away, ${Math.round(v.placeHeight)}% up` : 'Place off: the mode exactly as measured';
}

// ───────────────────────────────────────────── the window's state
const RV = { id: null, el: null, raf: 0, e: 0.05, pingAt: -99, inPeak: 0, t0: performance.now() / 1000, controls: {} };
const rvNow = () => performance.now() / 1000 - RV.t0;
/// Place's controls, as the window shows them (fx::PLACE_KEYS without "place.").
const RV_PLACE = [
  { key: 'on', label: 'Place', min: 0, max: 1, default: 0, toggle: true },
  { key: 'shape', label: 'Shape', min: 0, max: 5, default: 1, step: 1, choices: RV_SHAPES },
  { key: 'sizeM', label: 'Room size', min: 3, max: 80, default: 24, unit: 'm', log: true },
  { key: 'pos', label: 'Position', min: -100, max: 100, default: -25 },
  { key: 'dist', label: 'Distance', min: 0, max: 100, default: 40, unit: '%' },
  { key: 'height', label: 'Height', min: 0, max: 100, default: 35, unit: '%' },
  { key: 'spread', label: 'Spread', min: 0, max: 200, default: 100, unit: '%' },
];
/// The pads the effects do not declare themselves (RJ's mock-up).
const RV_NEW_PADS = {
  'ambient-fdn': { x: 'size', y: 'decayS' }, 'schroeder-reverb': { x: 'size', y: 'decay' },
  'moorer-reverb': { x: 'size', y: 'decay' }, 'dattorro-plate': { x: 'damping', y: 'decay' },
};
const RV_FADERS = /^(wet|dry|mix|level|gainDb|outputDb|inputDb|dryDb|erDb|lateDb)$/;
const RV_ROLES = ['time', 'space', 'tone', 'motion', 'output', 'engine'];
function rvRoleOf(p) {
  if (p.role) return p.role === 'stereo' ? 'space' : p.role;
  const k = p.key;
  if (RV_FADERS.test(k) || (/Level$|Db$/.test(k) && !/eq/i.test(k))) return 'output';
  if (/smoothing|Step$|inputDiffusion|decayDiffusion|tapSlope|window/.test(k)) return 'engine';
  if (/mod|spin|wander/i.test(k)) return 'motion';
  if (/damp|bandwidth|bright|cut|Cut|bass|Bass|xov|Xov|crossover|eq|hiCut|HiCut|ringModulate|brighten/i.test(k)) return 'tone';
  if (/diffusion|spread|width|wide|shape|density|spacing|size/i.test(k)) return 'space';
  return 'time';
}

function rvSlot() { return state.rack?.slots.find((s) => s.id === RV.id) || null; }
function rvSlotIndex() { return state.rack ? state.rack.slots.findIndex((s) => s.id === RV.id) : -1; }
function rvIsReverb(slot) { return fxSlotMode(slot)?.suite.id === 'reverb'; }
/// The slot's Place, as the window edits it (numbers throughout).
function rvPlace(slot) {
  if (!slot.place) slot.place = Object.fromEntries(RV_PLACE.map((p) => [p.key, p.default]));
  if (typeof slot.place.on === 'boolean') slot.place.on = slot.place.on ? 1 : 0;
  return slot.place;
}
/// Place as a face model, so the app's own controls drive it: each move goes
/// to the running effect (`place.<key>`), a release saves the rack.
///
/// Each read and write finds the slot's Place again: a save replaces the
/// slot's \`place\` with the server's copy, and a model holding the old object
/// would go on writing where the drawing no longer looks.
function rvPlaceModel(slot) {
  const pl = () => rvPlace(rvSlot() || slot);
  return {
    slot, specs: RV_PLACE, byKey: Object.fromEntries(RV_PLACE.map((p) => [p.key, p])), get: (k) => pl()[k],
    set(k, v) { pl()[k] = v; liveParam(slot.id, `place.${k}`, v); },
    commit() { commitRack(); },
    values() { return { ...pl() }; },
  };
}
function rvPad(at) {
  const shaper = state.shapers[at.mode.kind];
  const p = shaper?.panel?.pad || RV_NEW_PADS[at.mode.id];
  const keys = new Set((shaper?.params || []).map((q) => q.key));
  return p && keys.has(p.x) && keys.has(p.y) ? p : null;
}
/// A mode's network as a small picture, for the dropdowns: drawn once.
const RV_PICS = new Map();
function rvPicUrl(m) {
  if (RV_PICS.has(m.id)) return RV_PICS.get(m.id);
  const cv = document.createElement('canvas');
  cv.width = 192; cv.height = 72;
  const ctx = cv.getContext('2d');
  ctx.scale(3, 3);
  const v = Object.fromEntries((state.shapers[m.kind]?.params || []).map((p) => [p.key, p.default]));
  rvDrawNet(ctx, 64, 24, rvNet(m, v), { e: 0.6, t: 0.6, small: true });
  const url = cv.toDataURL();
  RV_PICS.set(m.id, url);
  return url;
}
function rvFit(cv) {
  const r = cv.getBoundingClientRect();
  const z = r.width / Math.max(1, cv.offsetWidth);
  const w = cv.offsetWidth, h = cv.offsetHeight;
  const dpr = Math.min(3, (window.devicePixelRatio || 1) * z * 1.4);
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr)); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
  return { ctx, w, h };
}

// ───────────────────────────────────────────── opening and closing
function reverbOpen(id) {
  RV.id = id;
  if (!RV.el) rvBuild();
  RV.el.hidden = false;
  rvReadColours();
  rvPlaceWindow();
  rvRender();
  if (!RV.raf) RV.raf = requestAnimationFrame(rvFrame);
}
function reverbClose() {
  if (RV.el) RV.el.hidden = true;
  RV.id = null;
  if (RV.raf) cancelAnimationFrame(RV.raf);
  RV.raf = 0;
}
/// After the rack is drawn again: follow the slot, or close if it went.
function rvAfterRack() {
  if (!RV.id || !RV.el || RV.el.hidden) return;
  const slot = rvSlot();
  if (!slot || !rvIsReverb(slot)) { reverbClose(); return; }
  rvRender();
}
/// One fixed size; on a screen smaller than it, the whole window is scaled down.
function rvPlaceWindow() {
  const k = Math.min(1, (innerWidth - 24) / 1280, (innerHeight - 24) / 640);
  RV.el.style.setProperty('--rv-scale', k);
  if (!RV.el.dataset.moved) {
    RV.el.style.left = `${Math.max(12, (innerWidth - 1280 * k) / 2)}px`;
    RV.el.style.top = `${Math.max(12, (innerHeight - 640 * k) / 2)}px`;
  }
}

function rvBuild() {
  const el = document.createElement('section');
  el.className = 'rv-win';
  el.id = 'reverbWindow';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Reverb');
  el.hidden = true;
  el.innerHTML = `<div class="rv-bar"><b class="rv-title">Reverb</b><span class="rv-modes"></span><span class="rv-badge"></span><span class="rv-src"></span><button class="rv-pwr" type="button"></button><button class="rv-x" type="button" aria-label="Close">×</button></div>
    <div class="rv-views"><div class="rv-disp rv-net"><canvas></canvas><span class="rv-cap"></span><span class="rv-cap r"></span></div><div class="rv-disp rv-room"><canvas></canvas><span class="rv-cap">the room</span><span class="rv-cap r">drag the sound · drag to turn · double-click to reset</span><span class="rv-cap b"></span></div><div class="rv-meters"><i class="rv-vu"><b></b></i><i class="rv-vu"><b></b></i></div></div>
    <div class="rv-band"></div>`;
  document.body.appendChild(el);
  RV.el = el;
  el.querySelector('.rv-x').onclick = reverbClose;
  el.querySelector('.rv-pwr').onclick = () => {
    const s = rvSlot(); if (!s) return;
    s.bypassed = !s.bypassed;
    pushRack({ immediate: true });
    rvPaintPower();
  };
  // Moved by its bar, like any window.
  const bar = el.querySelector('.rv-bar');
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, select, .ui-dd, .ui-ddw')) return;
    bar.setPointerCapture(e.pointerId);
    const x0 = e.clientX - el.offsetLeft, y0 = e.clientY - el.offsetTop;
    const mv = (ev) => { el.style.left = `${ev.clientX - x0}px`; el.style.top = `${Math.max(0, ev.clientY - y0)}px`; el.dataset.moved = '1'; };
    const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
  });
  // Escape closes the window, unless a dropdown in it is open (that closes first).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden || (typeof UI_MENU !== 'undefined' && UI_MENU)) return;
    e.preventDefault();
    e.stopPropagation();
    reverbClose();
  }, true);
  window.addEventListener('resize', () => { if (!el.hidden) rvPlaceWindow(); });
  // The network is the mode's pad, where it has one.
  const net = el.querySelector('.rv-net');
  net.addEventListener('pointerdown', (e) => {
    const slot = rvSlot(), at = slot && fxSlotMode(slot), pad = at && rvPad(at);
    if (!pad) return;
    net.setPointerCapture(e.pointerId);
    const m = fxModel(slot);
    const set = (ev) => {
      const r = net.getBoundingClientRect();
      const px = m.byKey[pad.x], py = m.byKey[pad.y];
      m.set(pad.x, fxClamp(px, unitValue(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), px.min, px.max, fxIsLog(px))));
      m.set(pad.y, fxClamp(py, unitValue(Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height)), py.min, py.max, fxIsLog(py))));
      RV.controls[pad.x]?.sync?.(); RV.controls[pad.y]?.sync?.();
    };
    set(e);
    const up = () => { net.removeEventListener('pointermove', set); net.removeEventListener('pointerup', up); m.commit(); };
    net.addEventListener('pointermove', set); net.addEventListener('pointerup', up);
  });
  // The room is Place's pad: drag the sound, Shift-drag it up and down,
  // drag anywhere else to turn the room.
  const room = el.querySelector('.rv-room');
  room.addEventListener('pointerdown', (e) => {
    if (!RV_ROOM) return;
    const slot = rvSlot(); if (!slot) return;
    room.setPointerCapture(e.pointerId);
    const pm = rvPlaceModel(slot);
    const r = room.getBoundingClientRect(), z = r.width / room.offsetWidth;
    const x0 = (e.clientX - r.left) / z, y0 = (e.clientY - r.top) / z;
    const S = RV_ROOM.Sq, onSound = S && Math.hypot(x0 - S[0], y0 - S[1]) < S[2] + 10;
    const mode = onSound ? (e.shiftKey ? 'height' : 'sound') : 'turn';
    let lx = e.clientX, ly = e.clientY;
    const clamp = (a, lo, hi) => Math.max(lo, Math.min(hi, a));
    const move = (ev) => {
      const dx = (ev.clientX - lx) / z, dy = (ev.clientY - ly) / z; lx = ev.clientX; ly = ev.clientY;
      if (mode === 'turn') { RV_CAM.yaw -= dx * 0.008; RV_CAM.pitch = clamp(RV_CAM.pitch + dy * 0.006, 0.08, 1.35); return; }
      if (mode === 'height') { pm.set('height', clamp(pm.get('height') - dy * 0.6, 0, 100)); RV.controls['place.height']?.sync?.(); return; }
      const { W, C } = RV_ROOM, sx = (ev.clientX - r.left) / z, sy = (ev.clientY - r.top) / z;
      const d = RV3.add(RV3.add(C.f, RV3.mul(C.r, (sx - C.cx) / C.F)), RV3.mul(C.u, -(sy - C.cy) / C.F));
      if (Math.abs(d[2]) < 1e-4) return;
      const tt = (W.src[2] - C.pos[2]) / d[2]; if (tt <= 0) return;
      const p = RV3.add(C.pos, RV3.mul(d, tt));
      pm.set('pos', clamp(p[0] / (W.wide * 0.36) * 100, -100, 100));
      pm.set('dist', clamp(((p[1] - W.listen[1]) / ((W.depth - W.listen[1]) * 0.92) - 0.12) / 0.78 * 100, 0, 100));
      RV.controls['place.pos']?.sync?.(); RV.controls['place.dist']?.sync?.();
    };
    const up = () => { room.removeEventListener('pointermove', move); room.removeEventListener('pointerup', up); if (mode !== 'turn') pm.commit(); };
    room.addEventListener('pointermove', move); room.addEventListener('pointerup', up);
  });
  room.addEventListener('dblclick', () => { RV_CAM.yaw = -0.38; RV_CAM.pitch = 0.5; });
}

function rvPaintPower() {
  const s = rvSlot(), b = RV.el.querySelector('.rv-pwr');
  const on = s && !s.bypassed;
  b.classList.toggle('on', !!on);
  b.setAttribute('aria-pressed', String(!!on));
  b.setAttribute('aria-label', on ? 'On — switch off' : 'Off — switch on');
}

// ───────────────────────────────────────────── drawing the window's parts
function rvRender() {
  const slot = rvSlot(), at = slot && fxSlotMode(slot), index = rvSlotIndex();
  if (!slot || !at) { reverbClose(); return; }
  const el = RV.el;
  // Family and Mode
  const modes = el.querySelector('.rv-modes'); modes.innerHTML = '';
  const fams = at.suite.families.filter((f) => f.modes.some((m) => m.listed || m.id === at.mode.id));
  const listed = (f) => f.modes.filter((m) => m.listed || m.id === at.mode.id);
  const fam = document.createElement('select'); fam.setAttribute('aria-label', 'Reverb family');
  for (const f of fams) { const o = document.createElement('option'); o.value = f.label; o.textContent = f.label; fam.appendChild(o); }
  fam.value = at.family.label;
  fam.onchange = () => { const f = fams.find((x) => x.label === fam.value); if (f) fxSwitchMode(rvSlotIndex(), listed(f)[0], at.suite.id); };
  const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Reverb mode');
  for (const m of listed(at.family)) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; mode.appendChild(o); }
  mode.value = at.mode.id;
  mode.onchange = () => { const m = at.suite.families.flatMap((f) => f.modes).find((x) => x.id === mode.value); if (m) fxSwitchMode(rvSlotIndex(), m, at.suite.id); };
  modes.append(fam, mode);
  // Each choice shows its network, so its size is seen before it is picked.
  const pic = (m, inMenu) => (m ? `<img class="rv-ddpic${inMenu ? ' big' : ''}" src="${rvPicUrl(m)}" alt="">` : '');
  const byMode = (id) => at.suite.families.flatMap((f) => f.modes).find((x) => x.id === id);
  uiDrop(fam, { h: 24, w: 170, cls: 'rv-fam', pic: (v, inMenu) => pic(listed(fams.find((f) => f.label === v) || at.family)[0], inMenu) });
  uiDrop(mode, { h: 24, w: 260, cls: 'rv-mode', pic: (v, inMenu) => pic(byMode(v), inMenu) });
  const badge = el.querySelector('.rv-badge'); badge.innerHTML = ''; badge.appendChild(fxClassBadge(at.mode));
  el.querySelector('.rv-src').textContent = at.mode.source;
  rvPaintPower();
  el.querySelector('.rv-net').classList.toggle('pad', !!rvPad(at));
  rvBand(slot);
  void index;
}

/// The mode's own controls by what they do, then Place.
function rvBand(slot) {
  const band = RV.el.querySelector('.rv-band'); band.innerHTML = '';
  RV.controls = {};
  const m = fxModel(slot);
  const groups = {};
  for (const p of m.specs) (groups[rvRoleOf(p)] ||= []).push(p);
  for (const role of RV_ROLES.filter((r) => r !== 'engine' && groups[r])) {
    const sect = document.createElement('div'); sect.className = 'rv-sect';
    sect.innerHTML = '<b></b><div></div>'; sect.querySelector('b').textContent = role;
    for (const p of groups[role]) {
      const c = fxControl(m, p, () => {}, fxShort(p.label, role));
      RV.controls[p.key] = c;
      sect.querySelector('div').appendChild(c);
    }
    sect.style.setProperty('--n', groups[role].reduce((a, p) => a + (RV_FADERS.test(p.key) ? 0.8 : 1), 0));
    band.appendChild(sect);
  }
  // Place: ours, around the mode
  const pm = rvPlaceModel(slot);
  const sect = document.createElement('div'); sect.className = 'rv-sect ours';
  sect.title = 'Our own stage around the mode; off, the mode is exactly as measured';
  sect.innerHTML = '<b><span class="rv-led" role="button" tabindex="0" aria-label="Place on"></span>Place <small>ours</small></b><div></div>';
  const led = sect.querySelector('.rv-led');
  const paint = () => { const on = pm.get('on') >= 0.5; led.classList.toggle('on', on); led.setAttribute('aria-pressed', String(on)); sect.classList.toggle('off', !on); };
  const flip = () => { pm.set('on', pm.get('on') >= 0.5 ? 0 : 1); paint(); pm.commit(); };
  led.onclick = flip;
  led.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  for (const p of RV_PLACE.filter((q) => q.key !== 'on')) {
    const c = fxControl(pm, p, () => {}, p.label);
    RV.controls[`place.${p.key}`] = c;
    sect.querySelector('div').appendChild(c);
  }
  sect.style.setProperty('--n', RV_PLACE.length - 1);
  paint();
  band.appendChild(sect);
  if (groups.engine) {
    const eng = document.createElement('div'); eng.className = 'rv-sect rv-engine';
    eng.innerHTML = '<b>Engine</b><div></div>';
    for (const p of groups.engine) { const c = fxSlider(m, p, () => {}, p.label); RV.controls[p.key] = c; eng.querySelector('div').appendChild(c); }
    eng.style.setProperty('--n', 4);
    band.appendChild(eng);
  }
}

/// What the mode's other controls do, drawn over its network: its tone (the
/// cuts, damping, brightness) as a response curve, its width at the outputs,
/// and its mix as the dry path beside the network and the network's own glow.
function rvOverlay(ctx, w, h, v, e) {
  const has = (k) => v[k] !== undefined;
  const col = (a) => `rgba(${RV_COL.accent},${a})`;
  // tone: a high-pass at the low cut, a low-pass at the high cut
  let lo = has('lowCutHz') ? v.lowCutHz : has('crossoverHz') && has('bassRatio') ? null : null;
  let hi = has('highCutHz') ? v.highCutHz : has('rtHiCutHz') ? v.rtHiCutHz : has('rolloffHz') ? v.rolloffHz : has('highDampHz') ? v.highDampHz : null;
  if (hi === null && has('damping')) hi = 20000 * Math.pow(0.05, Math.min(1, v.damping > 1 ? v.damping / 100 : v.damping));
  if (hi === null && has('brightness')) hi = 1500 + 18500 * (v.brightness / 100);
  if (lo !== null || hi !== null) {
    const bw = 132, bh = 34, x0 = w - bw - 10, y0 = h - bh - 18;
    ctx.fillStyle = `rgba(${RV_COL.white},0.03)`; ctx.fillRect(x0, y0, bw, bh);
    ctx.strokeStyle = col(0.35 + 0.6 * e); ctx.lineWidth = 1.4; ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const f = 20 * Math.pow(1000, i / 60);
      let g = 1;
      if (lo) g *= 1 / Math.sqrt(1 + Math.pow(lo / f, 2));
      if (hi) g *= 1 / Math.sqrt(1 + Math.pow(f / hi, 2));
      const y = y0 + bh - 3 - (bh - 6) * Math.max(0, 1 + Math.log10(Math.max(g, 1e-3)) / 2);
      if (i) ctx.lineTo(x0 + (bw * i) / 60, y); else ctx.moveTo(x0, y);
    }
    ctx.stroke();
    ctx.fillStyle = RV_COL.text; ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`tone${lo ? ` · lo ${lo < 1000 ? Math.round(lo) : (lo / 1000).toFixed(1) + 'k'}` : ''}${hi ? ` · hi ${hi < 1000 ? Math.round(hi) : (hi / 1000).toFixed(1) + 'k'}` : ''}`, x0, y0 - 3);
  }
  // width: the spread of the outputs, as an arc at the right
  let width = null;
  if (has('width')) width = v.width >= -1.001 && v.width <= 1.001 && !has('mix') ? v.width : (v.width + 100) / 200;
  else if (has('wide')) width = v.wide / 200;
  else if (has('spread')) width = v.spread > 1.001 ? v.spread / 100 : v.spread * 4;
  if (width !== null) {
    const cx = w - 12, cy = h / 2, r = Math.min(46, h * 0.22), span = Math.max(0.04, Math.min(1, width)) * Math.PI * 0.9;
    ctx.strokeStyle = col(0.3 + 0.6 * e); ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI - span / 2, Math.PI + span / 2); ctx.stroke(); ctx.lineCap = 'butt';
  }
  // mix: the dry path beside the network, as bright as the dry is
  let dry = null;
  if (has('mix')) dry = Math.cos((v.mix > 1.001 ? v.mix / 100 : v.mix) * Math.PI / 2);
  else if (has('dry')) dry = v.dry > 1.001 ? v.dry / 2 : Math.min(1, v.dry);
  else if (has('dryDb')) dry = v.dryDb < -90 ? 0 : Math.pow(10, v.dryDb / 20);
  if (dry !== null) {
    ctx.strokeStyle = `rgba(${RV_COL.white},${0.08 + 0.55 * dry})`; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(18, 10); ctx.lineTo(w - 18, 10); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = RV_COL.text; ctx.font = '9px JetBrains Mono, monospace'; ctx.fillText(`dry ${Math.round(dry * 100)}%`, w / 2 - 18, 21);
  }
}

/// Each frame: the network and the room, moved by the module's own sound.
function rvFrame() {
  RV.raf = 0;
  const slot = rvSlot();
  if (!RV.el || RV.el.hidden || !slot) return;
  const at = fxSlotMode(slot), i = rvSlotIndex();
  // The engine's own levels, every poll, whichever page or dock is showing
  // (the rail's meters are painted only while the Effects dock is open).
  const levels = (typeof engine !== 'undefined' && engine.rackLevels?.length) ? engine.rackLevels : REVERB_LEVELS;
  const pin = levels[i] || [0, 0], pout = levels[i + 1] || [0, 0];
  const peakIn = Math.max(pin[0] || 0, pin[1] || 0), peakOut = Math.max(pout[0] || 0, pout[1] || 0);
  const t = rvNow();
  // A hit on the way in — a rise of 3 dB over the recent level, no closer
  // than 90 ms to the last — starts the direct sound, the reflections and the
  // tail again, so they fire on every beat of what is playing.
  if (peakIn > 0.01 && peakIn > RV.inPeak * 1.41 && t - RV.pingAt > 0.09) RV.pingAt = t;
  RV.inPeak += (peakIn - RV.inPeak) * (peakIn > RV.inPeak ? 0.5 : 0.06);
  const target = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(peakOut, 1e-4)) + 60) / 60));
  RV.e += (target - RV.e) * 0.12;
  const e = Math.max(0.06, RV.e), moving = RV.e > 0.03;
  const v = { ...(slot.params || {}) };
  const net = RV.el.querySelector('.rv-net');
  const n = rvFit(net.querySelector('canvas'));
  rvDrawNet(n.ctx, n.w, n.h, rvNet(at.mode, v), { e, t: moving ? t : 0, ice: v.freeze >= 0.5, mod: moving ? (v.modDepth !== undefined ? Math.sqrt(v.modDepth / 100) : v.spinHz !== undefined ? 0.4 : 0.15) : 0, rate: v.modRateHz ?? v.spinHz ?? 0.5 });
  rvOverlay(n.ctx, n.w, n.h, v, e);
  const pad = rvPad(at), [cl, cr] = net.querySelectorAll('.rv-cap');
  if (pad) {
    const m = fxModel(slot), px = m.byKey[pad.x], py = m.byKey[pad.y];
    cl.textContent = `${px.label} ${fxFormat(px, v[pad.x])} →`; cr.textContent = `↑ ${py.label} ${fxFormat(py, v[pad.y])}`;
    const x = automationUnit(v[pad.x], px.min, px.max, fxIsLog(px)) * n.w, y = (1 - automationUnit(v[pad.y], py.min, py.max, fxIsLog(py))) * n.h;
    n.ctx.strokeStyle = `rgba(${RV_COL.white},.2)`; n.ctx.lineWidth = 0.6; n.ctx.setLineDash([2, 3]);
    n.ctx.beginPath(); n.ctx.moveTo(x, 0); n.ctx.lineTo(x, n.h); n.ctx.moveTo(0, y); n.ctx.lineTo(n.w, y); n.ctx.stroke(); n.ctx.setLineDash([]);
    n.ctx.fillStyle = RV_COL.on; n.ctx.beginPath(); n.ctx.arc(x, y, 3.5, 0, 7); n.ctx.fill();
  } else { cl.textContent = at.mode.label; cr.textContent = ''; }
  const pl = rvPlace(slot);
  const pv = { placeOn: pl.on, roomShape: pl.shape, roomSizeM: pl.sizeM, placePos: pl.pos, placeDist: pl.dist, placeHeight: pl.height, placeSpread: pl.spread, freeze: v.freeze };
  const room = RV.el.querySelector('.rv-room');
  const r = rvFit(room.querySelector('canvas'));
  room.querySelector('.rv-cap.b').textContent = rvDrawRoom(r.ctx, r.w, r.h, pv, e, t - RV.pingAt, t);
  const [vin, vout] = RV.el.querySelectorAll('.rv-vu b');
  vin.style.height = `${Math.min(100, peakIn * 100)}%`;
  vout.style.height = `${Math.min(100, peakOut * 100)}%`;
  RV.raf = requestAnimationFrame(rvFrame);
}
