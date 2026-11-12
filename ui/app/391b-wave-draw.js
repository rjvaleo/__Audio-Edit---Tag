// ─────────────────────────────────────────────────────────────── drawing

/// The voices the engine says are sounding.
const wvVoices = () => (WV.tele && Array.isArray(WV.tele.voices) ? WV.tele.voices : []);

/// An oscillator's frame position now: the engine's, if it has said.
function wvPosNow(i) {
  const T = WV.tele;
  if (T && Array.isArray(T.pos) && typeof T.pos[i] === 'number') return wvClamp(T.pos[i]);
  return wvClamp(wvLiveOr(`osc${i}.pos`));
}

/// The cycle an oscillator is playing: its frame, warped twice, and — unless
/// `dry` — through its own effect. FM on A and C takes B; on B it takes A.
function wvWaveFor(i, dry) {
  const k = `osc${i}.`;
  let f = wvFrameAt(wvTable(wvG(k + 'table')), wvPosNow(i));
  const o = i === 1 ? 0 : 1;
  const B = wvFrameAt(wvTable(wvG(`osc${o}.table`)), wvPosNow(o));
  for (const j of [0, 1]) f = wvWarp(f, wvG(`${k}warp${j}.mode`), wvClamp(wvLiveOr(`${k}warp${j}.amt`)), B);
  return dry ? f : wvOfxShape(f, wvG(k + 'fx.mode'), wvLiveOr(k + 'fx.a'), wvG(k + 'fx.b'));
}

function wvDraw3D(g, T, p, warp0, t, opt = {}, voices) {
  const { c, w, h } = g, cl = wvCl();
  c.clearRect(0, 0, w, h);
  const n = Math.min(T.length, opt.n || 28), depth = opt.depth || 0.26, rise = opt.rise || 0.5, cf = p * (n - 1);
  const sx = w * (0.98 - depth) - 12, amp = h * 0.15;
  for (let i = n - 1; i >= 0; i--) {
    const d = i / (n - 1);
    const a = wvWarp(T[Math.round(d * (T.length - 1))], warp0[0], warp0[1]);
    const x0 = 8 + d * w * depth, y0 = h * 0.78 - d * h * rise;
    const pts = wvPath((u) => [x0 + u * sx, y0 - wvRd(a, u) * amp], 70);
    const hue = 205 - 175 * d;
    const f = new Path2D(pts);
    f.lineTo(x0 + sx, y0); f.lineTo(x0, y0); f.closePath();
    c.fillStyle = `hsla(${hue},70%,55%,${Math.abs(i - cf) < 1 ? 0.22 : 0.05})`;
    c.fill(f);
    c.strokeStyle = `hsla(${hue},80%,72%,${0.2 + 0.45 * (1 - d)})`;
    c.lineWidth = 1;
    c.stroke(pts);
  }
  const a = wvWarp(wvFrameAt(T, p), warp0[0], warp0[1]);
  const x0 = 8 + p * w * depth, y0 = h * 0.78 - p * h * rise;
  const pts = wvPath((u) => [x0 + u * sx, y0 - wvRd(a, u) * amp], 160);
  if (opt.floor) {
    const yb = h * 0.8;
    c.save();
    c.globalAlpha = 0.18;
    c.strokeStyle = `rgba(${cl.bloom},1)`;
    c.lineWidth = 1.2;
    c.stroke(wvPath((u) => { const y = y0 - wvRd(a, u) * amp; return [x0 + u * sx, yb + Math.max(0, yb - y) * 0.32]; }, 120));
    c.restore();
    const fg = c.createLinearGradient(0, yb, 0, h);
    fg.addColorStop(0, `rgba(${cl.bloom},.05)`);
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fg;
    c.fillRect(0, yb, w, h - yb);
  }
  wvUnder(c, pts, x0, x0 + sx, y0, y0 - amp, cl, 0.2);
  wvTrace(c, pts, cl, 1.6);
  wvDot(c, x0 - 4, y0, 2.6, cl.acc);
  // A dot for every voice the engine has sounding, running round the cycle at
  // its own pitch.
  if (voices) {
    for (const v of voices) {
      const ph = (t * Math.pow(2, ((+v.note || 60) - 60) / 12) * 0.7) % 1;
      c.globalAlpha = wvStage(v) === 'r' ? 0.4 : 1;
      wvDot(c, x0 + ph * sx, y0 - wvRd(a, ph) * amp, 2.8, cl.acc);
      c.globalAlpha = 1;
    }
  }
}

const wvSpecCache = new Map();
function wvSpecOf(T, name, warp0, i) {
  const key = `${name}|${warp0[0]}|${warp0[1].toFixed(2)}|${i}`;
  let v = wvSpecCache.get(key);
  if (!v) {
    v = wvMags(wvSpectrum(wvWarp(T[i], warp0[0], warp0[1]), 40));
    wvSpecCache.set(key, v);
    if (wvSpecCache.size > 3000) wvSpecCache.clear();
  }
  return v;
}

/// Each frame's spectrum as a ridge through its harmonic peaks, low harmonics
/// left, in the same perspective as the waves.
function wvDrawSpec3D(g, T, name, p, warp0, opt = {}) {
  const { c, w, h } = g, cl = wvCl();
  c.clearRect(0, 0, w, h);
  const n = 26, depth = opt.depth || 0.26, rise = opt.rise || 0.5, K = 40;
  const db = (v) => wvClamp((20 * Math.log10(Math.max(v, 1e-5)) + 54) / 54);
  const ridge = (m, x0, y0, sx, hh) => wvPath((u) => {
    const kf = Math.pow(K, u) - 1, k0 = Math.floor(kf), k1 = Math.min(K - 1, k0 + 1), f = kf - k0;
    return [x0 + u * sx, y0 - (db(m[k0]) * (1 - f) + db(m[k1]) * f) * hh];
  }, 90);
  const sx = w * (0.98 - depth) - 12, hh = h * 0.34;
  for (let r = n - 1; r >= 0; r--) {
    const d = r / (n - 1), fi = Math.round(d * (T.length - 1)), m = wvSpecOf(T, name, warp0, fi);
    const x0 = 8 + d * w * depth, y0 = h * 0.8 - d * h * rise, hue = 205 - 175 * d;
    const pts = ridge(m, x0, y0, sx, hh), f = new Path2D(pts);
    f.lineTo(x0 + sx, y0); f.lineTo(x0, y0); f.closePath();
    c.fillStyle = `hsla(${hue},70%,55%,.05)`;
    c.fill(f);
    c.strokeStyle = `hsla(${hue},80%,72%,${0.2 + 0.45 * (1 - d)})`;
    c.lineWidth = 1;
    c.stroke(pts);
  }
  const fi = Math.round(p * (T.length - 1)), m = wvSpecOf(T, name, warp0, fi);
  const x0 = 8 + p * w * depth, y0 = h * 0.8 - p * h * rise, pts = ridge(m, x0, y0, sx, hh);
  wvUnder(c, pts, x0, x0 + sx, y0, y0 - hh, cl, 0.2);
  wvTrace(c, pts, cl, 1.6);
  wvDot(c, x0 - 4, y0, 2.6, cl.acc);
  c.font = `9px ${cl.mono}`;
  c.fillStyle = cl.t3;
  c.fillText('SPECTRUM', 8, 13);
  c.textAlign = 'right';
  c.fillText('low → high', w - 8, 13);
  c.textAlign = 'left';
}

function wvDrawStrip(g, T, p, m, n = 24) {
  const { c, w, h } = g, cl = wvClFor(m), rng = m ? m.rng : 0;
  c.clearRect(0, 0, w, h);
  const pad = 6, cw = (w - pad * 2) / n;
  for (let i = 0; i < n; i++) {
    const f = T[Math.round(i / (n - 1) * (T.length - 1))], x = pad + i * cw, on = Math.abs(i / (n - 1) - p) < 0.5 / (n - 1);
    c.strokeStyle = on ? cl.wave : `rgba(${cl.bloom},.3)`;
    c.lineWidth = on ? 1.3 : 1;
    c.stroke(wvPath((u) => [x + 2 + u * (cw - 4), h / 2 + 2 - wvRd(f, u) * (h * 0.3)], 18));
  }
  if (rng) {
    const a = pad + wvClamp(p - rng) * (w - pad * 2), b = pad + wvClamp(p + rng) * (w - pad * 2);
    c.strokeStyle = cl.mod;
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(a, 5); c.lineTo(a, 2); c.lineTo(b, 2); c.lineTo(b, 5); c.stroke();
  }
  const x = pad + p * (w - pad * 2);
  c.fillStyle = cl.acc;
  c.shadowBlur = 8;
  c.shadowColor = cl.acc;
  c.fillRect(x - 1, 3, 2, h - 6);
  c.shadowBlur = 0;
}

/// A warp knob's face: the ring, and the warped wave over the plain one. An
/// empty slot is a dashed circle and a plus.
function wvDrawFace(g, v, wave, ghost, o = {}) {
  const { c, w, h } = g, cl = wvCl(), cx = w / 2, cy = h / 2;
  c.clearRect(0, 0, w, h);
  g.el.parentNode.classList.toggle('ui-blank', !!o.empty);
  if (o.empty) {
    c.setLineDash([3, 4]);
    c.strokeStyle = cl.t3;
    c.lineWidth = 1.2;
    c.beginPath(); c.arc(cx, cy, w / 2 - 6, 0, WV_TAU); c.stroke();
    c.setLineDash([]);
    c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(cx - 7, cy); c.lineTo(cx + 7, cy); c.moveTo(cx, cy - 7); c.lineTo(cx, cy + 7); c.stroke();
    return;
  }
  wvKnobRing(g, v, { rng: o.mod, live: o.live, col: o.col });
  const r = w * 0.31;
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, WV_TAU); c.clip();
  if (ghost) {
    c.strokeStyle = `rgba(${cl.bloom},.18)`;
    c.lineWidth = 1;
    c.stroke(wvPath((u) => [cx - r * 0.8 + u * r * 1.6, cy - wvRd(ghost, u) * r * 0.45], 70));
  }
  wvTrace(c, wvPath((u) => [cx - r * 0.8 + u * r * 1.6, cy - wvRd(wave, u) * r * 0.45], 110), cl, 1.4, 0.8);
  c.restore();
}

/// A plain knob, with its modulation when it has any.
function wvDrawKnob(id, key, bip) {
  const k = WVW[id];
  if (!k) return;
  const { c, w, h } = k;
  const v = wvG(key);
  c.clearRect(0, 0, w, h);
  wvKnobRing(k, v, wvModOf(key), { bip, pointer: 1 });
}

function wvDrawUniFace(g, cur, n, det, spr) {
  const { c, w, h } = g, cl = wvCl(), cx = w / 2, cy = h / 2, r = w * 0.3;
  c.clearRect(0, 0, w, h);
  wvKnobRing(g, det, wvModOf(g.el.dataset.tgt));
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, WV_TAU); c.clip();
  for (let i = 0; i < n; i++) {
    const off = n > 1 ? i / (n - 1) * 2 - 1 : 0, y = cy - off * det * r * 0.9;
    const side = n > 1 ? (i % 2 ? 1 : -1) * Math.abs(off) : 0;
    const x0 = cx - r * 0.85 + side * spr * r * 0.35, len = r * 1.7, hue = 205 - 175 * (off + 1) / 2;
    const p = wvPath((q) => [x0 + q * len, y - wvRd(cur, q * 2) * r * 0.16], 50);
    if (off === 0 || n === 1) wvTrace(c, p, cl, 1.1, 0.5);
    else { c.strokeStyle = `hsla(${hue},70%,70%,.7)`; c.lineWidth = 1; c.stroke(p); }
  }
  c.restore();
  c.font = `600 9px ${cl.mono}`;
  c.fillStyle = cl.t2;
  c.textAlign = 'center';
  c.fillText(String(n), cx, h - 3);
  c.textAlign = 'left';
}

/// The glide's bar: its curve, drawn as far as the glide goes. (The sub and the
/// noise draw on the MIX row now.)
function wvDrawHBar(g, v) {
  const { c, w, h } = g, cl = wvCl(), x = 6 + (w - 12) * v;
  c.clearRect(0, 0, w, h);
  c.save();
  c.beginPath(); c.rect(6, 3, x - 6, h - 6); c.clip();
  const p = new Path2D();
  for (let i = 0; i <= 60; i++) {
    const xx = 6 + i / 60 * (w - 12), u = i / 60, yy = h - 5 - (h - 10) * (1 - Math.exp(-u * 5 / (v * 3 + 0.05)));
    if (i) p.lineTo(xx, yy); else p.moveTo(xx, yy);
  }
  wvTrace(c, p, cl, 1.1, 0.6);
  c.restore();
  c.strokeStyle = cl.track;
  c.lineWidth = 1;
  c.beginPath(); c.moveTo(x, 3); c.lineTo(w - 6, 3); c.stroke();
  c.fillStyle = cl.t;
  c.beginPath(); c.roundRect(x - 2, 2, 4, h - 4, 2); c.fill();
  const m = wvModOf(g.el.dataset.tgt || '');
  if (m.rng) {
    c.fillStyle = m.col || cl.mod;
    c.fillRect(6 + (w - 12) * wvClamp(v - m.rng), h - 3, (w - 12) * (wvClamp(v + m.rng) - wvClamp(v - m.rng)), 2);
    if (m.live != null) wvDot(c, 6 + (w - 12) * wvClamp(m.live), h - 2, 2, cl.acc);
  }
}

/// The pitch ruler: a tick per semitone, octaves long and numbered, sliding
/// under a fixed centre line as the pitch and the fine offset move.
function wvDrawRuler(g, semi, cents, m) {
  const { c, w, h } = g, cl = wvCl(), step = 6, off = semi + cents / 100, X = (v) => w / 2 + (v - off) * step;
  c.clearRect(0, 0, w, h);
  for (let k = -14; k <= 14; k++) {
    const v = semi + k, x = X(v);
    if (x < 4 || x > w - 4) continue;
    const pc = ((v % 12) + 12) % 12, oct = pc === 0, blk = [1, 3, 6, 8, 10].includes(pc), hh = oct ? h - 14 : blk ? 6 : 10;
    c.fillStyle = oct ? cl.t2 : blk ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.26)';
    c.fillRect(x - 0.5, h - 4 - hh, 1, hh);
    if (oct) {
      c.font = `9px ${cl.mono}`;
      c.fillStyle = cl.t3;
      c.fillText((v > 0 ? '+' : '') + v / 12, x + 3, 10);
    }
  }
  if (m && m.rng) {
    c.fillStyle = m.col || cl.mod;
    c.globalAlpha = 0.6;
    c.fillRect(w / 2 - m.rng * 48 * step, h - 3, m.rng * 96 * step, 2);
    c.globalAlpha = 1;
  }
  c.fillStyle = cl.acc;
  c.shadowBlur = 8;
  c.shadowColor = cl.acc;
  c.fillRect(w / 2 - 1, 3, 2, h - 6);
  c.shadowBlur = 0;
}

const wvCutHz = (v) => 20 * Math.pow(1000, v);
const wvFmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz');
const wvFmtMs = (s) => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s');

/// A filter's lens: its response over the harmonics of the wave going in.
function wvDrawLens(g, cur, i) {
  const { c, w, h } = g, cl = wvCl(), f = `filt${i}.`;
  c.clearRect(0, 0, w, h);
  const fx = (fr) => 6 + (Math.log10(fr) - Math.log10(20)) / 3 * (w - 12);
  const cut = wvClamp(wvLiveOr(f + 'cut')), fc = wvCutHz(cut), Q = 0.7 + wvG(f + 'res') * 9, type = wvG(f + 'type');
  const Hm = (fr) => {
    const x = fr / fc;
    switch (type) {
      case 'hp': return x * x / Math.sqrt((1 - x * x) ** 2 + (x / Q) ** 2);
      case 'bp': return (x / Q) / Math.sqrt((1 - x * x) ** 2 + (x / Q) ** 2) * Q * 0.6;
      case 'notch': return Math.abs(1 - x * x) / Math.sqrt((1 - x * x) ** 2 + (x / Q) ** 2);
      case 'comb': return 0.55 + 0.45 * Math.cos(WV_TAU * fr / fc);
      case 'form': return 0.2 + Math.exp(-((Math.log2(fr / fc) / 0.25) ** 2)) + 0.7 * Math.exp(-((Math.log2(fr / (fc * 2.3)) / 0.25) ** 2));
      default: return 1 / Math.sqrt((1 - x * x) ** 2 + (x / Q) ** 2);
    }
  };
  const dbY = (db) => h * 0.58 - db * 1.4;
  c.strokeStyle = 'rgba(255,255,255,.05)';
  for (const fr of [100, 1000, 10000]) { c.beginPath(); c.moveTo(fx(fr), 3); c.lineTo(fx(fr), h - 3); c.stroke(); }
  const m = wvMags(wvSpectrum(cur));
  for (let k = 0; k < 48; k++) {
    const fr = 110 * (k + 1);
    if (fr > 20000) break;
    const a = m[k];
    if (a < 0.003) continue;
    const db = 20 * Math.log10(a), x = fx(fr);
    const hh = wvClamp((db + 48) / 48) * h * 0.55, fh = wvClamp((db + 20 * Math.log10(Hm(fr)) + 48) / 48) * h * 0.55;
    c.fillStyle = `rgba(${cl.bloom},.12)`;
    c.fillRect(x - 1, h - 3 - hh, 2, hh);
    c.fillStyle = `rgba(${cl.bloom},.7)`;
    c.fillRect(x - 1, h - 3 - fh, 2, fh);
  }
  const mc = wvModOf(f + 'cut'), r = mc.rng;
  if (r) {
    const base = wvG(f + 'cut');
    c.fillStyle = `color-mix(in srgb,${mc.col || cl.mod} 14%,transparent)`;
    c.fillRect(fx(wvCutHz(wvClamp(base - r))), 3, fx(wvCutHz(wvClamp(base + r))) - fx(wvCutHz(wvClamp(base - r))), h - 6);
  }
  const pts = wvPath((u) => { const fr = 20 * Math.pow(1000, u); return [fx(fr), wvClamp(dbY(20 * Math.log10(Hm(fr) + 1e-6)), 3, h - 3)]; }, 140);
  wvUnder(c, pts, 6, w - 6, h, 0, cl, 0.14);
  wvTrace(c, pts, cl, 1.5);
  wvDot(c, fx(fc), wvClamp(dbY(20 * Math.log10(Hm(fc) + 1e-6)), 5, h - 5), 3.5, cl.acc);
  c.font = `10px ${cl.mono}`;
  c.fillStyle = cl.t2;
  c.textAlign = 'right';
  c.fillText(`${wvFmtHz(fc)} · Q ${Q.toFixed(1)}`, w - 8, 14);
  c.textAlign = 'left';
}

function wvEnvPts(g, E) {
  const { w, h } = g, x0 = 8, W = w - 16, top = 8, bot = h - 8;
  const ta = Math.sqrt(E.a) * 0.22 * W, td = Math.sqrt(E.d) * 0.26 * W, hold = 0.16 * W, tr = Math.sqrt(E.r) * 0.36 * W, sy = bot - (bot - top) * E.s;
  return { o: [x0, bot], a: [x0 + ta, top], d: [x0 + ta + td, sy], s: [x0 + ta + td + hold, sy], r: [x0 + ta + td + hold + tr, bot] };
}

/// A voice's stage as one letter, whatever form the engine sends it in.
function wvStage(v) {
  if (typeof v.stage === 'number') return ['a', 'd', 's', 'r'][v.stage] || 's';
  return String(v.stage || 's').toLowerCase()[0];
}

/// Where a voice sits on a drawn envelope, from the engine's stage and level.
function wvEnvDot(P, E, v) {
  const lvl = wvClamp(+v.env || 0), st = wvStage(v), lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  if (st === 'a') return lerp(P.o, P.a, lvl);
  if (st === 'd') return lerp(P.a, P.d, E.s < 1 ? wvClamp((1 - lvl) / (1 - E.s)) : 1);
  if (st === 'r') return lerp(P.s, P.r, E.s > 0 ? wvClamp(1 - lvl / E.s) : 1);
  return [(P.d[0] + P.s[0]) / 2, P.s[1]];
}

function wvDrawEnv(g, E, voices, C) {
  const { c, w, h } = g, cl = C || wvCl(), P = wvEnvPts(g, E);
  c.clearRect(0, 0, w, h);
  const p = new Path2D();
  p.moveTo(...P.o);
  p.quadraticCurveTo(P.o[0] + (P.a[0] - P.o[0]) * 0.35, P.a[1] + (P.o[1] - P.a[1]) * 0.25, ...P.a);
  p.quadraticCurveTo(P.a[0] + (P.d[0] - P.a[0]) * 0.15, P.d[1], ...P.d);
  p.lineTo(...P.s);
  p.quadraticCurveTo(P.s[0] + (P.r[0] - P.s[0]) * 0.15, P.r[1], ...P.r);
  wvUnder(c, p, P.o[0], P.r[0], h, 0, cl, 0.18);
  wvTrace(c, p, cl, 1.5);
  for (const k of ['a', 'd', 'r']) { c.fillStyle = cl.t; c.beginPath(); c.arc(...P[k], 3, 0, WV_TAU); c.fill(); }
  for (const v of voices) { const d = wvEnvDot(P, E, v); wvDot(c, d[0], d[1], 3, cl.acc); }
  return P;
}

/// The LFO editor: its shape, the points when it is Drawn, and the engine's
/// phase on it.
function wvDrawLfo(g, L, C) {
  const { c, w, h } = g, cl = C || wvCl(), pts = wvG(`lfo${L}.points`), drawn = wvLfoShape(L) === 'drawn';
  const px = (q) => 8 + q[0] * (w - 16), py = (q) => 8 + (1 - q[1]) * (h - 16);
  c.clearRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,.05)';
  for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(8 + i * (w - 16) / 8, 6); c.lineTo(8 + i * (w - 16) / 8, h - 6); c.stroke(); }
  c.beginPath(); c.moveTo(8, h / 2); c.lineTo(w - 8, h / 2); c.stroke();
  const p = wvPath((u) => [8 + u * (w - 16), py([0, wvLfoVal(L, u)])], 160);
  wvUnder(c, p, 8, w - 8, h, 0, cl, 0.16);
  wvTrace(c, p, cl, 1.5);
  if (drawn) for (const q of pts) { c.fillStyle = cl.t; c.beginPath(); c.arc(px(q), py(q), 3, 0, WV_TAU); c.fill(); }
  const ph = wvLfoPhase(L);
  if (ph != null) {
    c.strokeStyle = `color-mix(in srgb,${cl.acc} 50%,transparent)`;
    c.beginPath(); c.moveTo(8 + ph * (w - 16), 6); c.lineTo(8 + ph * (w - 16), h - 6); c.stroke();
    wvDot(c, 8 + ph * (w - 16), py([0, wvLfoVal(L, ph)]), 3.4, cl.acc);
  }
}

function wvLfoPhase(L) {
  const T = WV.tele;
  if (!T || !Array.isArray(T.lfo) || typeof T.lfo[L] !== 'number') return null;
  return ((T.lfo[L] % 1) + 1) % 1;
}

const wvNoteName = (n) => ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

function wvDrawPlay(t) {
  const cl = wvCl(), vs = wvVoices(), curs = [];
  for (let i = 0; i < 3; i++) {
    const k = `osc${i}.`, name = wvG(k + 'table'), T = wvTable(name), p = wvPosNow(i);
    const cur = wvWaveFor(i), warp0 = [wvG(k + 'warp0.mode'), wvClamp(wvLiveOr(k + 'warp0.amt'))], tilt = WV.tilt[i];
    const opt = { rise: 0.3 + 0.38 * tilt, depth: 0.18 + 0.14 * tilt, floor: 1 };
    if (WV.face[i] === 's') wvDrawSpec3D(WVW['wvW3d' + i], T, name, p, warp0, opt);
    else wvDrawW3d(i, T, p, warp0, t, opt, wvG(k + 'on') ? vs : null);
    curs.push(cur);
    wvDrawStrip(WVW['wvSt' + i], T, p, wvModOf(k + 'pos'));
    const o = i === 1 ? 0 : 1, B = wvFrameAt(wvTable(wvG(`osc${o}.table`)), wvPosNow(o));
    [0, 1].forEach((j) => {
      const key = `${k}warp${j}.amt`, m = wvModOf(key), f = wvFrameAt(T, p), mode = wvG(`${k}warp${j}.mode`);
      const amt = wvClamp(m.live != null ? m.live : wvG(key));
      wvDrawFace(WVW[`wvWp${i}${j}`], wvG(key), wvWarp(f, mode, amt, B), f, { col: m.col, mod: m.rng, live: m.live, empty: mode === 'off' });
      wvTxt(`wvWv${i}${j}`, mode === 'off' ? '—' : Math.round(wvG(key) * 100) + ' %');
    });
    wvDrawUniFace(WVW['wvUn' + i], cur, wvG(k + 'uni.n'), wvG(k + 'uni.det'), wvG(k + 'uni.spr'));
    wvTxt('wvUr' + i, `${wvG(k + 'uni.n')} v · ${Math.round(wvG(k + 'uni.det') * 60)} ct`);
    wvDrawOfx(WVW['wvOfx' + i], i, t);
    const semi = Math.round((wvG(k + 'pitch') - 0.5) * 48), cents = Math.round((wvG(k + 'fine') - 0.5) * 200);
    wvDrawRuler(WVW['wvPt' + i], semi, cents, wvModOf(k + 'pitch'));
    wvTxt('wvPtr' + i, (semi >= 0 ? '+' : '−') + Math.abs(semi) + (cents ? ` ${cents > 0 ? '+' : '−'}${Math.abs(cents)}c` : ' st'));
    {
      const g = WVW['wvPh' + i], { c, w, h } = g, ph = wvG(k + 'phase'), m = wvModOf(k + 'phase');
      c.clearRect(0, 0, w, h);
      wvKnobRing(g, ph, m);
      const cx = w / 2, cy = h / 2, r = w * 0.27;
      wvTrace(c, wvPath((u) => { const a = u * WV_TAU - Math.PI / 2 + ph * WV_TAU, rr = r * 0.6 + wvRd(cur, u) * r * 0.32; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; }, 70), cl, 1, 0.5);
      const a = -Math.PI / 2 + ph * WV_TAU;
      c.strokeStyle = cl.acc;
      c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3); c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.stroke();
      wvTxt('wvPhr' + i, Math.round(ph * 360) + '°');
    }
    wvDrawKnob('wvPn' + i, k + 'pan', 1);
    const pn = Math.round((wvG(k + 'pan') - 0.5) * 200);
    wvTxt('wvPnr' + i, pn === 0 ? 'C' : (pn < 0 ? 'L' : 'R') + Math.abs(pn));
    wvTxt('wvFr' + i, `${String(Math.round(p * (T.length - 1)) + 1).padStart(2, '0')} / ${T.length}`);
    const pk = WVW['wvPk' + i];
    pk.c.clearRect(0, 0, pk.w, pk.h);
    pk.c.strokeStyle = cl.wave;
    pk.c.lineWidth = 1.2;
    pk.c.stroke(wvPath((u) => [1 + u * (pk.w - 2), pk.h / 2 - wvRd(wvFrameAt(T, u), (u * 3) % 1) * (pk.h * 0.4)], 60));
  }
  const mix = curs[0];
  wvDrawMix(t, curs);
  wvDrawHBar(WVW.wvGlide, wvG('voice.glide'));
  wvTxt('wvGlRo', wvG('voice.glide') > 0.005 ? wvFmtMs(wvG('voice.glide') ** 2 * 2) : 'Off');
  const kHz = (f) => (f >= 10000 ? Math.round(f / 1000) + ' kHz' : wvFmtHz(f));
  [0, 1].forEach((i) => {
    const f = `filt${i}.`;
    wvDrawLens(WVW['wvLens' + i], mix, i);
    wvDrawKnob('wvCu' + i, f + 'cut', 0);
    wvTxt('wvCur' + i, kHz(wvCutHz(wvG(f + 'cut'))));
    wvDrawKnob('wvRs' + i, f + 'res', 0);
    wvTxt('wvRsr' + i, 'Q ' + (0.7 + wvG(f + 'res') * 9).toFixed(1));
    wvDrawKnob('wvDr' + i, f + 'drive', 0);
    wvTxt('wvDrr' + i, Math.round(wvG(f + 'drive') * 100) + ' %');
    wvDrawKnob('wvKy' + i, f + 'key', 0);
    wvTxt('wvKyr' + i, Math.round(wvG(f + 'key') * 100) + ' %');
  });
  wvDrawTiles(t, 'p');
}

function wvDrawW3d(i, T, p, warp0, t, opt, voices) {
  wvDraw3D(WVW['wvW3d' + i], T, p, warp0, t, opt, voices);
}

/// An oscillator's effect screen: what it does to this wave, in its own hue.
function wvDrawOfx(g, i, t) {
  const { c, w, h } = g, cl = wvCl(), k = `osc${i}.`, K = WV_OFX[wvG(k + 'fx.mode')] ? wvG(k + 'fx.mode') : 'off';
  const dry = wvWaveFor(i, true), a = wvClamp(wvLiveOr(k + 'fx.a')), b = wvG(k + 'fx.b');
  c.clearRect(0, 0, w, h);
  const bg = c.createRadialGradient(w * 0.25, h * 0.1, 4, w * 0.5, h * 0.5, w * 0.8);
  bg.addColorStop(0, wvFxCol(K, 45, 0.22));
  bg.addColorStop(1, wvFxCol(K, 30, 0));
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const X = (u) => 8 + u * (w - 16), Y = (v, s = 1) => h / 2 + 4 - v * h * 0.3 * s;
  const ghost = () => { c.strokeStyle = `rgba(${cl.bloom},.16)`; c.lineWidth = 1; c.stroke(wvPath((u) => [X(u), Y(wvRd(dry, u * 2))], 120)); };
  let rd = '';
  switch (K) {
    case 'chorus': {
      ghost();
      for (let v = 0; v < 3; v++) {
        const off = Math.sin(t * (0.4 + b * 3) + v * 2.1) * a * 0.06;
        c.globalAlpha = v ? 0.55 : 1;
        wvFxTrace(c, wvPath((u) => [X(u), Y(wvRd(dry, u * 2 + off), 0.9) + (v - 1) * a * 6], 120), K, 1.1);
        c.globalAlpha = 1;
      }
      rd = `${(0.1 + b * 4).toFixed(1)} Hz · ${Math.round(a * 100)} %`;
      break;
    }
    case 'delay': {
      const tm = 0.12 + b * 0.3, fb = 0.25 + a * 0.6;
      for (let r = 0; r < 5; r++) {
        const amp = Math.pow(fb, r);
        c.globalAlpha = amp;
        wvFxTrace(c, wvPath((u) => [X(r * tm + u * tm * 0.85), Y(wvRd(dry, u * 2), amp)], 40), K, 1.1);
        c.globalAlpha = 1;
      }
      rd = `${Math.round(60 + b * 440)} ms · ${Math.round(fb * 100)} %`;
      break;
    }
    case 'phaser': {
      ghost();
      const ph = t * (0.3 + b * 2);
      wvFxTrace(c, wvPath((u) => [X(u), Y(wvRd(dry, u * 2) * (1 - a * 0.6) + wvRd(dry, u * 2 + 0.12 * Math.sin(ph)) * a * 0.6)], 140), K, 1.4);
      rd = `${(0.1 + b * 2).toFixed(1)} Hz · ${Math.round(a * 100)} %`;
      break;
    }
    case 'off': {
      wvFxTrace(c, wvPath((u) => [X(u), Y(wvRd(dry, u * 2))], 120), K, 1.2);
      rd = '—';
      break;
    }
    default: {
      ghost();
      const wet = wvOfxShape(dry, K, a, b), p = wvPath((u) => [X(u), Y(wvRd(wet, u * 2))], K === 'crush' ? 400 : 160);
      const f = new Path2D(p);
      f.lineTo(w - 8, h / 2 + 4); f.lineTo(8, h / 2 + 4); f.closePath();
      const gr = c.createLinearGradient(0, 8, 0, h / 2 + 4);
      gr.addColorStop(0, wvFxCol(K, 60, 0.17));
      gr.addColorStop(1, wvFxCol(K, 60, 0));
      c.fillStyle = gr;
      c.fill(f);
      wvFxTrace(c, p, K, 1.4);
      rd = K === 'crush' ? `${Math.round(2 + (1 - b) * 6)} bit · ${Math.round(a * 100)} %`
        : K === 'drive' ? `×${(1 + b * 10).toFixed(1)} · ${Math.round(a * 100)} %`
          : K === 'ring' ? `×${1 + Math.round(b * 7)} · ${Math.round(a * 100)} %`
            : `${(2 + b * 10).toFixed(1)} · ${Math.round(a * 100)} %`;
    }
  }
  c.font = `9px ${cl.mono}`;
  c.fillStyle = cl.t3;
  c.fillText('mix →', 8, h - 6);
  c.textAlign = 'right';
  c.fillText((K === 'crush' ? 'grit' : K === 'delay' ? 'time' : K === 'drive' ? 'drive' : K === 'ring' || K === 'comb' ? 'tune' : 'rate') + ' ↕', w - 8, 13);
  c.textAlign = 'left';
  // The badge: the effect's glyph in its corner.
  c.fillStyle = 'rgba(0,0,0,.6)';
  c.strokeStyle = wvFxCol(K, 60, 0.5);
  c.lineWidth = 1;
  c.beginPath(); c.roundRect(4, 4, 32, 24, 6); c.fill(); c.stroke();
  wvFxIcon(c, K, 9, 7, 1.25, wvFxCol(K, 76));
  wvTxt('wvOfr' + i, rd);
  const nm = document.getElementById('wvOfn' + i);
  nm.style.color = wvFxCol(K, 76);
  (nm.closest('.wv-fxl') || nm.parentElement).style.setProperty('--fxc', wvFxCol(K, 72));
}

function wvFxIcon(c, k, x, y, sc, col) {
  const p = new Path2D((WV_OFX[k] || WV_OFX.off).g);
  c.save();
  c.translate(x, y);
  c.scale(sc, sc);
  c.strokeStyle = col;
  c.lineWidth = 1.7 / sc * 1.1;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.shadowBlur = 8;
  c.shadowColor = col;
  c.stroke(p);
  c.restore();
}

function wvFxTrace(c, p, k, lw = 1.5) {
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = wvFxCol(k, 60, 0.22);
  c.lineWidth = lw * 3.6;
  c.shadowBlur = 10;
  c.shadowColor = wvFxCol(k, 60, 0.5);
  c.stroke(p);
  c.shadowBlur = 0;
  c.strokeStyle = wvFxCol(k, 80);
  c.lineWidth = lw;
  c.stroke(p);
}
