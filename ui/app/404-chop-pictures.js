// ═══════════════════════════════════════════════ Chop: the pictures ══
//
// What a setting does, drawn: the picked slice as it will come out, where
// Preview and Ratchet land, and the curve of each processing module.

function chopDrawPictures() {
  chopDrawSlice();
  chopDrawPass();
  chopDrawEnv();
  chopDrawTransient();
  chopDrawEq();
  chopDrawFilter();
}

/// The slice's source, dim, and over it the real render: Gate's cut, Smooth's
/// fades, the Tail, Rev, Pitch, the Envelope and the filters. Square-rooted, so
/// a quiet tail can be seen.
function chopDrawSlice() {
  const { c, w, h } = chopSizeCanvas($('chopSlicePic'));
  const i = chop.current >= 0 ? chop.current : 0, x = chop.slices[i];
  if (!x) { $('chopPickRo').textContent = ''; $('chopPickAn').textContent = ''; return; }
  const out = chopSliceAudio(i)[0], inL = x.e - x.s, L = Math.max(out.length, inL);
  const T = 18, B = 15, mid = T + (h - T - B) / 2, A = (h - T - B) / 2 - 2, W = w - 12;
  const env = (arr) => {
    const M = Math.max(1, Math.floor(arr.length / L * W)), hi = new Float32Array(M), per = arr.length / M;
    for (let k = 0; k < M; k++) {
      let m = 0;
      for (let j = Math.floor(k * per); j < (k + 1) * per; j += Math.max(1, Math.floor(per / 16))) m = Math.max(m, Math.abs(arr[j] || 0));
      hi[k] = m;
    }
    return hi;
  };
  const src = env(chop.mono.subarray(x.s, x.e)), o = env(out);
  let pk = 0.001;
  for (const v of src) pk = Math.max(pk, v);
  for (const v of o) pk = Math.max(pk, v);
  const sc = (v) => Math.sqrt(v / pk) * A;
  c.fillStyle = 'rgba(255,255,255,.13)';
  src.forEach((v, k) => { const hh = sc(v); c.fillRect(6 + k, mid - hh, 1, hh * 2); });
  const g = x.s + Math.max(1, Math.round(inL * cp.gate / 100));
  const tp = cp.tail ? chopGetTailParams(x.s, g, cp.tailMs, chop.rate) : null;
  const split = tp?.viable ? Math.min(o.length, Math.floor(tp.sliceLen / L * W)) : o.length;
  const edge = (from, to, col) => {
    c.strokeStyle = col; c.lineWidth = 1;
    for (const sg of [-1, 1]) {
      c.beginPath();
      for (let k = from; k < to; k++) { const y = mid + sg * sc(o[k]); if (k === from) c.moveTo(6 + k + 0.5, y); else c.lineTo(6 + k + 0.5, y); }
      c.stroke();
    }
    c.fillStyle = col; c.globalAlpha = 0.28;
    for (let k = from; k < to; k++) { const hh = sc(o[k]); c.fillRect(6 + k, mid - hh, 1, hh * 2); }
    c.globalAlpha = 1;
  };
  c.shadowBlur = 5 * chopTok.glow; c.shadowColor = chopGlow(0.45);
  edge(0, split, chopTok.wave);
  c.shadowBlur = 0;
  if (split < o.length) edge(split, o.length, '#ffb547');
  if (cp.gate < 100) {
    const gx = 6 + (inL * cp.gate / 100) / L * W;
    c.strokeStyle = '#ffb547'; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(gx, T); c.lineTo(gx, h); c.stroke();
    c.setLineDash([]);
  }
  const m = x.m, pc = (v) => `${Math.round(v * 100)}%`, fq = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
  $('chopPickAn').textContent = m
    ? `${m.kind} · lo ${pc(m.low)} · hi ${pc(m.high)} · bright ${fq(m.cent)} · noise ${pc(m.flat)} · ${m.hz ? chopNote(m.hz) : 'no pitch'} · attack ${chopAttackMs(x)} ms · crest ${m.crest.toFixed(0)} dB`
    : '';
  $('chopPickRo').textContent = `${i + 1} · ${(inL / chop.rate * 1000).toFixed(0)} ms in → ${(out.length / chop.rate * 1000).toFixed(0)} ms out`
    + `${tp?.viable ? ` · tail ${tp.actualMs.toFixed(0)} ms × ${tp.numCycles}` : ''}${x.rev ? ' · reversed' : ''}`;
}

/// Where each slice lands in Preview at the play tempo, and where Ratchet fires
/// on the grid, with Nudge and Shuffle showing.
function chopDrawPass() {
  const { c, w, h } = chopSizeCanvas($('chopPassPic'));
  if (!chop.mono) return;
  const T = 20, { s: S, e: E } = chop.region, bpm = chopPlayBpm(), k = chopBpm() / bpm, tot = (E - S) * k;
  const L0 = 54, W = w - L0 - 8, lane = (h - T - 6) / 2, sx = (f) => L0 + f / tot * W;
  const play = chop.slices.map((x, i) => ({ x, i })).filter(({ x }) => !x.muted && x.s >= S && x.s < E);
  c.font = "9px 'JetBrains Mono',monospace"; c.textBaseline = 'middle'; c.fillStyle = chopTok.t3;
  c.fillText('Preview', 8, T + lane / 2);
  c.fillText('Ratchet', 8, T + lane * 1.5 + 2);
  const on = chop.playing?.kind;
  play.forEach(({ x, i }, n) => {
    const at = (x.s - S) * k, next = n + 1 < play.length ? (play[n + 1].x.s - S) * k : tot;
    const len = Math.min((x.e - x.s) * cp.gate / 100, Math.max(1, next - at));
    c.fillStyle = i === chop.current || on === 'preview' ? '#ffb547' : (i % 2 ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.78)');
    c.fillRect(sx(at), T, Math.max(1.5, len / tot * W - 1), lane - 2);
  });
  const stepF = (chopStepBeats() * 60 / bpm) * chop.rate;
  const loop = (Math.min(64, Math.max(1, cp.bars)) * cp.sig + cp.beats) * 60 / bpm * chop.rate, y2 = T + lane + 2, rx = (f) => L0 + f / loop * W;
  let fires = 0;
  for (let q = 0; q < 100000; q++) {
    const at = Math.round(chopGridAt(q, stepF));
    if (at >= loop) break;
    if (at < 0) continue;
    fires++;
    const len = Math.min(E - S, Math.round(stepF * cp.gate / 100));
    c.fillStyle = on === 'ratchet' ? '#ffb547' : 'rgba(255,255,255,.5)';
    c.fillRect(rx(at), y2, Math.max(1.5, len / loop * W - 1), lane - 2);
  }
  $('chopPassRo').textContent = `${play.length} slices · ${fires} fires on ${cp.div === 'bar' ? '1 bar' : `1/${cp.div}`}`;
}

/// A white curve on a faint grid, for the processing modules.
function chopCurve(id, fn, { under, label } = {}) {
  const { c, w, h } = chopSizeCanvas($(id));
  c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1;
  for (const y of [0.25, 0.5, 0.75]) { c.beginPath(); c.moveTo(0, h * y); c.lineTo(w, h * y); c.stroke(); }
  under?.(c, w, h);
  c.beginPath();
  for (let x = 4; x <= w - 4; x++) { const y = fn((x - 4) / (w - 8), h); if (x === 4) c.moveTo(x, y); else c.lineTo(x, y); }
  c.strokeStyle = chopTok.wave; c.shadowBlur = 7 * chopTok.glow; c.shadowColor = chopGlow(0.5); c.lineWidth = 1.5;
  c.stroke();
  c.shadowBlur = 0;
  if (label) {
    c.font = "9px 'JetBrains Mono',monospace"; c.fillStyle = chopTok.t3; c.textAlign = 'right'; c.textBaseline = 'alphabetic';
    c.fillText(label, w - 6, 12);
    c.textAlign = 'left';
  }
}

function chopDrawEnv() {
  const att = cp.attack, dec = cp.decay, span = Math.max(600, Math.min(1500, att + (dec >= 5000 ? 500 : dec * 1.2)));
  chopCurve('chopPicEnv', (u, h) => {
    const ms = u * span, g = (att > 0 ? Math.min(1, ms / att) : 1) * (dec >= 5000 ? 1 : Math.exp(-3 * Math.max(0, ms - att) / dec));
    return h - 8 - g * (h - 20);
  }, { label: `${span.toFixed(0)} ms` });
}

/// A hit through the shaper: the hit as it was, faint, and as it comes out.
function chopDrawTransient() {
  const sr = 2000, N = 700, co = (ms) => Math.exp(-1 / (Math.max(0.1, ms) / 1000 * sr));
  const aF = co(1), aS = co(cp.trAttack), r = co(cp.trRelease), thr = Math.pow(10, cp.trThresh / 20), out = Math.pow(10, cp.trGain / 20);
  let fast = 0, slow = 0, pk = 0;
  const base = [], shaped = [];
  for (let i = 0; i < N; i++) {
    const lv = i < 20 ? 0 : 0.8 * Math.exp(-(i - 20) / 90);
    fast = lv > fast ? aF * fast + (1 - aF) * lv : r * fast + (1 - r) * lv;
    slow = lv > slow ? aS * slow + (1 - aS) * lv : r * slow + (1 - r) * lv;
    const q = fast > thr ? Math.min(8, Math.max(0.1, Math.pow(fast / (slow + 1e-9), cp.trAmount / 100))) : 1;
    base.push(lv); shaped.push(lv * q * out);
    pk = Math.max(pk, lv * q * out, lv);
  }
  chopCurve('chopPicTr', (u, h) => h - 8 - shaped[Math.floor(u * (N - 1))] / pk * (h - 22), { under: (c, w, h) => {
    const y = (v) => h - 8 - v / pk * (h - 22);
    c.beginPath();
    for (let x = 4; x <= w - 4; x++) { const v = y(base[Math.floor((x - 4) / (w - 8) * (N - 1))]); if (x === 4) c.moveTo(x, v); else c.lineTo(x, v); }
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.stroke();
    const ty = y(thr);
    c.setLineDash([3, 3]); c.beginPath(); c.moveTo(0, ty); c.lineTo(w, ty); c.stroke(); c.setLineDash([]);
  } });
}

function chopMag(k, f, sr) {
  const w = 2 * Math.PI * f / sr, cs = Math.cos(w), sn = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = k[0] + k[1] * cs + k[2] * c2, ni = -(k[1] * sn + k[2] * s2), dr = 1 + k[3] * cs + k[4] * c2, di = -(k[3] * sn + k[4] * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di + 1e-20));
}
const chopFreqAt = (u) => 20 * Math.pow(1000, u);
function chopFreqGrid(c, w, h) {
  for (const f of [100, 1000, 10000]) {
    const x = 4 + Math.log(f / 20) / Math.log(1000) * (w - 8);
    c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(x, 0, 1, h);
    c.font = "9px 'JetBrains Mono',monospace"; c.fillStyle = chopTok.t3;
    c.fillText(f >= 1000 ? `${f / 1000}k` : f, f >= 10000 ? x - 19 : x + 3, h - 4);
  }
}

function chopDrawEq() {
  const sr = 48000, bands = [];
  if (cp.loCut > 16) bands.push(chopBiquad('hp', cp.loCut, 0.707, 0, sr));
  bands.push(chopBiquad('peak', cp.lowF, cp.lowQ, cp.lowG, sr));
  bands.push(chopBiquad('peak', cp.highF, cp.highQ, cp.highG, sr));
  if (cp.hiCut < 19990) bands.push(chopBiquad('lp', cp.hiCut, 0.707, 0, sr));
  chopCurve('chopPicEq', (u, h) => {
    let db = 0;
    for (const k of bands) db += 20 * Math.log10(chopMag(k, chopFreqAt(u), sr) + 1e-9);
    return Math.max(2, Math.min(h - 2, h / 2 - db * (h / 44)));
  }, { under: chopFreqGrid });
}

function chopDrawFilter() {
  const sr = 48000, k = chopBiquad(cp.fltType, cp.fltFreq, cp.fltQ, 0, sr), m = cp.mix / 100, g = Math.pow(10, cp.gain / 20);
  chopCurve('chopPicFlt', (u, h) => {
    const db = 20 * Math.log10((chopMag(k, chopFreqAt(u), sr) * m + (1 - m)) * g + 1e-9);
    return Math.max(2, Math.min(h - 2, h * 0.32 - db * (h / 44)));
  }, { under: chopFreqGrid, label: cp.drive > 0 ? `drive ${Math.round(cp.drive)}%` : '' });
}
