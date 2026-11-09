// ================================================================ Grain: the views
//
// The three pictures of the sound. The overview is the whole file: its loop
// brackets and its green Start flag are where you choose the part of the sound.
// The detail under it shows only what lies between those brackets, with the
// engine's own marks on it and its own zoom. The trace tops the right panel.
//
// All three are drawn from the server's peaks (`/api/peaks`, `clips=1`, the
// timeline the selection and the cue are counted on). The overview and the trace
// use `state.overview`, which the app keeps anyway; the detail fetches its own,
// at its own width, for the range it is showing.

/// What the detail is showing and what has been fetched for it.
const GS_DET = { want: '', got: '', seq: 0, timer: 0, a: 0, b: 0, p: null, cen: null, on: [], med: 0.01, staticKey: '', cv: null, rg: null };

// ──────────────────────────────────────────────────────────── the detail's zoom

/// The detail's range: the loop, or the part of it that has been zoomed to.
function gsCloudView() {
  const { a, b } = gsLoop();
  if (!(GS.czB > GS.czA)) return [a, b];
  const L = Math.min(GS.czB - GS.czA, b - a), x = wvClamp(GS.czA, a, b - L);
  return [x, x + L];
}

function gsZoomCloud(f, at) {
  const [ca, cb] = gsCloudView(), { a, b } = gsLoop();
  at = at ?? (ca + cb) / 2;
  let na = at - (at - ca) * f, nb = at + (cb - at) * f;
  if (nb - na >= b - a - 1e-6) { GS.czA = GS.czB = 0; return; }
  if (nb - na < 0.03) return;
  if (na < a) { nb += a - na; na = a; }
  if (nb > b) { na -= nb - b; nb = b; }
  GS.czA = na; GS.czB = nb;
}

function gsZoomRo() {
  const [ca, cb] = gsCloudView(), { a, b } = gsLoop();
  gsTxt('gsCzRo', GS.czB > GS.czA ? `${((b - a) / (cb - ca)).toFixed(1)}×` : 'loop');
}

// ──────────────────────────────────────────────────────── fetching the detail

/// Ask for the detail's peaks and spectrum when its range has changed, a moment
/// after it stops changing, so dragging a bracket is not a fetch per pixel.
function gsDetailWant() {
  const f = gsFile(), sound = state.selectedFile;
  if (!f || !sound) return;
  const [a, b] = gsCloudView();
  const want = `${sound.path}|${a.toFixed(4)}|${b.toFixed(4)}|${f.frames}`;
  if (want === GS_DET.want) return;
  GS_DET.want = want;
  clearTimeout(GS_DET.timer);
  GS_DET.timer = setTimeout(() => gsDetailFetch(want, sound.path, a, b, f), 120);
}

async function gsDetailFetch(want, path, a, b, f) {
  const seq = ++GS_DET.seq, g = GS_CV.gsCloud;
  const cols = Math.max(200, (g ? g.w : 686) - 12);
  const from = Math.floor(a * f.sr), to = Math.ceil(b * f.sr), range = `&from=${from}&to=${to}`, p = encodeURIComponent(path);
  let peaks = null, spec = null;
  try { peaks = await api(`/api/peaks?p=${p}&cols=${cols}&clips=1${range}`); } catch { return; }
  // Only ever colour: a sound with no spectrum still draws.
  try { spec = await api(`/api/spectrogram?p=${p}&cols=${Math.min(320, cols)}&fft=2048${range}`); } catch { spec = null; }
  if (seq !== GS_DET.seq) return;
  GS_DET.p = peaks;
  GS_DET.a = a; GS_DET.b = b;
  GS_DET.got = want;
  GS_DET.cen = spec ? gsCentroid(spec) : null;
  gsOnsets(peaks, f);
  GS_DET.staticKey = '';
}

/// How bright the sound is along the view, 0 to 1 of the view's own range, so
/// the ribbon's hue reads whatever the material is.
function gsCentroid(s) {
  const raw = atob(s.data), { columns: C, bins: B } = s;
  if (!C || !B || raw.length < C * B) return null;
  const o = new Float32Array(C);
  for (let x = 0; x < C; x++) {
    let sum = 0, m = 0;
    for (let k = 1; k < B; k++) {
      const p = Math.pow(10, (raw.charCodeAt(x * B + k) / 255 * 80 - 80) / 10);
      sum += p * Math.log2(k + 1) / Math.log2(B);
      m += p;
    }
    o[x] = m ? sum / m : 0;
  }
  const sm = new Float32Array(C);
  let lo = 1, hi = 0;
  for (let x = 0; x < C; x++) {
    let t = 0, n = 0;
    for (let j = -8; j <= 8; j++) { const q = o[x + j]; if (q != null) { t += q; n++; } }
    sm[x] = t / n;
    lo = Math.min(lo, sm[x]); hi = Math.max(hi, sm[x]);
  }
  for (let x = 0; x < C; x++) sm[x] = hi > lo ? (sm[x] - lo) / (hi - lo) : 0.5;
  return sm;
}

/// The energy's rises, for the transient marks: the mock-up's detector, on the
/// peaks' RMS rather than on PCM. A picture of where hits are, not the engine's
/// own onset map, which lives on the server.
function gsOnsets(p, f) {
  const env = p.channels[0]?.rms || [], n = env.length, hop = (p.to - p.from) / Math.max(1, n) / f.sr;
  const sorted = [...env].sort((a, b) => a - b);
  GS_DET.med = sorted[n >> 1] || 0.01;
  GS_DET.on = [];
  if (n < 6) return;
  const fl = new Float32Array(n);
  let mf = 0;
  for (let i = 2; i < n; i++) { fl[i] = Math.max(0, Math.sqrt(env[i]) - Math.sqrt(env[i - 2])); if (fl[i] > mf) mf = fl[i]; }
  for (let i = 3; i < n - 1; i++) {
    if (!(fl[i] > fl[i - 1] && fl[i] >= fl[i + 1] && fl[i] > mf * 0.12)) continue;
    const t = p.from / f.sr + i * hop, s = fl[i] / mf, last = GS_DET.on[GS_DET.on.length - 1];
    if (last && t - last.t < 0.06) { if (s > last.s) { last.t = t; last.s = s; last.l = env[i]; } }
    else GS_DET.on.push({ t, s, l: env[i] });
  }
}

/// The outline of the sound over a range, `W` columns, each 0 to 1. From the
/// detail's own peaks once they cover the range; from the overview until then,
/// so a bracket being dragged still shows what is between it.
function gsRidge(a, b, W, useDetail) {
  const f = gsFile();
  const p = useDetail && GS_DET.p && Math.abs(GS_DET.a - a) < 0.002 && Math.abs(GS_DET.b - b) < 0.002 ? GS_DET.p : state.overview;
  const o = new Float32Array(W);
  if (!p || !f || !p.columns) return o;
  const ch = p.channels[0], t0 = p.from / f.sr, dt = (p.to - p.from) / p.columns / f.sr;
  for (let x = 0; x < W; x++) {
    const s0 = (a + (b - a) * x / W - t0) / dt, s1 = (a + (b - a) * (x + 1) / W - t0) / dt;
    const i0 = Math.max(0, Math.floor(s0)), i1 = Math.min(p.columns, Math.max(i0 + 1, Math.ceil(s1)));
    let m = 0, q = 0, n = 0;
    for (let i = i0; i < i1; i++) {
      m = Math.max(m, Math.abs(ch.min[i]), Math.abs(ch.max[i]));
      q += (ch.rms ? ch.rms[i] : 0) ** 2; n++;
    }
    o[x] = m * 0.55 + (n ? Math.sqrt(q / n) : 0) * 0.9;
  }
  let pk = 0;
  for (let x = 0; x < W; x++) pk = Math.max(pk, o[x]);
  if (pk > 0) for (let x = 0; x < W; x++) o[x] /= pk;
  return o;
}

// ──────────────────────────────────────────────────────────────── the overview

function gsDrawOverview() {
  const g = GS_CV.gsSrcPic, f = gsFile();
  if (!g) return;
  const { c, w, h } = g, cl = gsCl(), p = state.overview;
  c.clearRect(0, 0, w, h);
  c.font = `11px ${cl.sans}`;
  if (!p || !f) { c.fillStyle = cl.t3; c.fillText('Open a sound', 16, 24); return; }
  const X = (s) => 6 + s / f.len * (w - 12), { a, b } = gsLoop(), bot = h - 13, mid = (bot + 4) / 2, A = (bot - 8) / 2;
  c.save();
  c.beginPath(); c.rect(4, 0, w - 8, h); c.clip();
  // The whole file, filled, so its loud and quiet parts read at a glance.
  const ch = p.channels[0];
  let pk = 0.001;
  for (let i = 0; i < p.columns; i++) pk = Math.max(pk, Math.abs(ch.min[i]), Math.abs(ch.max[i]));
  c.fillStyle = `rgba(${cl.bloom},.3)`;
  for (let x = 0; x < w - 12; x++) {
    const i = Math.floor(x / (w - 12) * p.columns), m = Math.max(Math.abs(ch.min[i]), Math.abs(ch.max[i])) / pk * A;
    c.fillRect(6 + x, mid - m, 1, m * 2);
  }
  c.font = `9px ${cl.mono}`;
  const st = [0.5, 1, 2, 5, 10, 30, 60, 120, 300].find((s) => f.len / s <= 12) || 600;
  for (let s = 0; s < f.len; s += st) {
    const x = X(s);
    if (x > w - 44) break;
    c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(x, 4, 1, bot - 4);
    c.fillStyle = cl.t3; c.fillText(s.toFixed(st < 1 ? 1 : 0) + ' s', x + 3, h - 3);
  }
  c.textAlign = 'right'; c.fillText(f.len.toFixed(1) + ' s', w - 8, h - 3); c.textAlign = 'left';
  gsDrawAnnotations(c, X, 4, bot, cl);
  // The loop: outside dimmed, the brackets to drag.
  const ra = X(a), rb = X(b);
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(4, 0, Math.max(0, ra - 4), h); c.fillRect(rb, 0, Math.max(0, w - 4 - rb), h);
  c.fillStyle = 'rgba(124,240,208,.05)'; c.fillRect(ra, 0, rb - ra, bot);
  c.strokeStyle = cl.acc; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(ra, 4); c.lineTo(ra, bot); c.moveTo(rb, 4); c.lineTo(rb, bot); c.stroke();
  for (const x of [ra, rb]) {
    c.fillStyle = cl.acc; c.beginPath(); c.roundRect(x - 4, 4, 8, 16, 3); c.fill();
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x - 1.5, 7, 1, 10); c.fillRect(x + 0.5, 7, 1, 10);
  }
  c.font = `600 10px ${cl.mono}`;
  gsLbl(c, `${gsRegLabel().toUpperCase()} · LOOP ${(b - a).toFixed(2)} S`, Math.min(Math.max(ra + 9, 10), w - 240), 15, cl.acc);
  // Start.
  const cue = gsCue(), sx = X(cue);
  c.strokeStyle = GS_START; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(sx, 22); c.lineTo(sx, bot); c.stroke();
  c.fillStyle = GS_START; c.beginPath(); c.moveTo(sx, 22); c.lineTo(sx + 9, 26.5); c.lineTo(sx, 31); c.fill();
  c.font = `600 9px ${cl.mono}`;
  gsLbl(c, 'START ' + cue.toFixed(2), sx + 12, 30, GS_START);
  if (gsNoteHead() != null) gsDrawNoteHead(c, X(gsHead()), 4, bot, bot - 16, cl);
  else if (engine.playing) {
    const hx = X(gsHead());
    c.fillStyle = cl.t; c.fillRect(hx - 0.75, 4, 1.5, bot - 4);
    gsLbl(c, 'HEAD', hx + 4, bot - 4, cl.t);
  }
  c.restore();
}

/// A bracket, the Start flag, or a drag across for a new loop; a click moves
/// Start.
function gsWireOverview() {
  const g = GS_CV.gsSrcPic, el = g.el;
  const toS = (x) => { const f = gsFile(); return f ? wvClamp((x - 6) / (g.w - 12) * f.len, 0, f.len) : 0; };
  let sm = null, s0 = 0, moved = 0, ends = null;
  const scrub = (s) => { const f = gsFile(); if (f) gsSeekTo(Math.round(s * f.sr)); };
  gsDrag(el, (dx, dy, e) => {
    const s = toS(wvLocal(el, e)[0]), { a, b } = ends;
    moved += Math.abs(dx);
    // Option runs over the file to hear it, and leaves the loop and Start alone.
    if (sm === 'scrub' || (sm && e.altKey)) scrub(s);
    else if (sm === 'a') gsSetLoop(Math.min(s, b - 0.05), b);
    else if (sm === 'b') gsSetLoop(a, Math.max(s, a + 0.05));
    else if (sm === 'cue') gsMoveCue(s);
    else if (sm === 'sel' && moved > 3) { gsSetLoop(Math.min(s0, s), Math.max(s0, s)); gsMoveCue(Math.min(s0, s)); }
  }, (e) => {
    const f = gsFile();
    if (!f) { sm = null; ends = { a: 0, b: 1 }; return; }
    const x = wvLocal(el, e)[0], X = (s) => 6 + s / f.len * (g.w - 12);
    ends = gsLoop();
    moved = 0;
    s0 = toS(x);
    if (e.altKey) { sm = 'scrub'; scrub(s0); return; }
    const bot = g.h - 13, r = gsRegionAt(x, wvLocal(el, e)[1], X, bot);
    if (r && Math.abs(x - X(ends.a)) >= 6 && Math.abs(x - X(ends.b)) >= 6) { sm = null; state.sel = { start: r.start, end: r.end }; drawSelection(); applyLoop(); return; }
    sm = Math.abs(x - X(ends.a)) < 6 ? 'a' : Math.abs(x - X(ends.b)) < 6 ? 'b' : Math.abs(x - X(gsCue())) < 6 ? 'cue' : 'sel';
  }, () => {
    if (sm === 'sel' && moved <= 3) { gsMoveCue(s0); seekSource(state.cue); }
    else if (sm && sm !== 'scrub' && state.loopOn && state.sel) seekSource(state.sel.start);
    sm = null;
  });
}

function gsMoveCue(s) {
  const f = gsFile();
  if (f) setCue(Math.round(s * f.sr));
}

// ────────────────────────────────────────────────────────────────── the trace

const GS_TR = { key: '', r: null };

/// The thin white trace on top of the engine: the whole file's outline, the
/// loop lit.
function gsDrawTrace() {
  const g = GS_CV.gsTrace, f = gsFile();
  if (!g) return;
  const { c, w, h } = g, cl = gsCl();
  c.clearRect(0, 0, w, h);
  if (!f || !state.overview) return;
  const key = `${f.frames}|${state.selectedFile?.path}|${w}`;
  if (GS_TR.key !== key || !GS_TR.r) { GS_TR.key = key; GS_TR.r = gsRidge(0, f.len, w - 12, false); }
  const R = GS_TR.r, wc = h / 2, A0 = h / 2 - 5, ry = (u) => R[Math.min(R.length - 1, Math.floor(u * R.length))];
  const X = (s) => 6 + s / f.len * (w - 12), { a, b } = gsLoop();
  const top = wvPath((u) => [6 + u * (w - 12), wc - ry(u) * A0], R.length);
  const bot = wvPath((u) => [6 + u * (w - 12), wc + ry(u) * A0], R.length);
  c.strokeStyle = `rgba(${cl.bloom},.25)`; c.lineWidth = 1; c.stroke(bot);
  wvUnder(c, top, 6, w - 6, wc, 6, cl, 0.18);
  wvTrace(c, top, cl, 1.1, 0.6);
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, 0, X(a), h); c.fillRect(X(b), 0, w - X(b), h);
  c.fillStyle = cl.acc; c.fillRect(X(a) - 0.5, 2, 1, h - 4); c.fillRect(X(b) - 0.5, 2, 1, h - 4);
  if (gsHeadLive()) { c.fillStyle = cl.t; c.fillRect(X(gsHead()) - 0.75, 2, 1.5, h - 4); }
}

function gsDrawMini() {
  const g = GS_CV.gsSndMini, p = state.overview;
  if (!g || !p) return;
  const { c, w, h } = g, ch = p.channels[0];
  let pk = 0.001;
  for (let i = 0; i < p.columns; i++) pk = Math.max(pk, Math.abs(ch.min[i]), Math.abs(ch.max[i]));
  c.clearRect(0, 0, w, h);
  c.strokeStyle = gsCl().wave; c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x < w; x++) {
    const i = Math.floor(x / w * p.columns), m = Math.max(Math.abs(ch.min[i]), Math.abs(ch.max[i])) / pk * (h / 2 - 1);
    c.moveTo(x + 0.5, h / 2 - m); c.lineTo(x + 0.5, h / 2 + m);
  }
  c.stroke();
}

// ───────────────────────────────────────────────────────────────── the detail

const gsEnvShape = (u, p) => (u < p ? 0.5 - 0.5 * Math.cos(Math.PI * u / p) : 0.5 + 0.5 * Math.cos(Math.PI * (u - p) / (1 - p)));

function gsCloudGeo() {
  const g = GS_CV.gsCloud, { w, h } = g, [a, b] = gsCloudView();
  return { w, h, a, b, X: (s) => 6 + (s - a) / (b - a) * (w - 12), yc: h * 0.6, A: h * 0.27, K: (h * 0.4 - 16) / 12 };
}

function gsReadWrap(rp) {
  const f = gsFile(), { a, b } = gsLoop(), modp = (x, m) => ((x % m) + m) % m;
  if (gsRead('wrap')) return state.loopOn ? a + modp(rp - a, b - a) : modp(rp, f ? f.len : 1);
  return state.loopOn ? wvClamp(rp, a, b) : wvClamp(rp, 0, f ? f.len : 1);
}

/// The sound itself, which only changes with its range: an envelope mirrored
/// about its centre, its hue following its brightness along time.
function gsRenderCloudStatic(key) {
  const g = GS_CV.gsCloud, { w, h } = g, cl = gsCl(), dpr = wvDpr();
  GS_DET.staticKey = key;
  const cvx = GS_DET.cv || (GS_DET.cv = document.createElement('canvas'));
  cvx.width = w * dpr; cvx.height = h * dpr;
  const c = cvx.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { a, b, yc, A } = gsCloudGeo(), W = w - 12, rg = gsRidge(a, b, W, true);
  const E = (x) => rg[wvClamp(Math.floor(x), 0, W - 1)];
  GS_DET.rg = rg;
  c.strokeStyle = 'rgba(255,255,255,.03)'; c.lineWidth = 1;
  c.font = `9px ${cl.mono}`; c.fillStyle = cl.t3;
  const st = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find((s) => (b - a) / s <= 8) || 120;
  for (let s = Math.ceil(a / st) * st; s < b; s += st) {
    const x = 6 + (s - a) / (b - a) * W;
    c.beginPath(); c.moveTo(x, 8); c.lineTo(x, h - 14); c.stroke();
    // Every second line is named, and never one too near the end to fit.
    if (Math.abs(s / (st * 2) - Math.round(s / (st * 2))) < 0.01 && x < w - 40) c.fillText(s.toFixed(st * 2 < 1 ? 2 : 0) + ' s', x + 3, h - 4);
  }
  // Depth: the envelope again behind, up and to the right.
  for (let k = 4; k >= 1; k--) {
    const p = wvPath((u) => [6 + u * W + k * 6, yc - k * 7 - E(u * W) * A * (1 - 0.06 * k)], Math.floor(W / 2));
    c.strokeStyle = `hsla(${205 - 28 * k},60%,72%,${(0.04 + 0.025 * (4 - k)).toFixed(3)})`;
    c.stroke(p);
  }
  const cen = GS_DET.cen;
  for (let x = 0; x < W; x++) {
    const e = Math.max(0.012, rg[x]), v = cen ? cen[Math.min(cen.length - 1, Math.floor(x / W * cen.length))] : 0.5;
    const hue = 205 - 175 * v, top = yc - e * A, bot = yc + e * A * 0.92, gr = c.createLinearGradient(0, top, 0, bot);
    gr.addColorStop(0, `hsla(${hue},82%,66%,.6)`);
    gr.addColorStop(0.42, `hsla(${hue},75%,46%,.16)`);
    gr.addColorStop(0.58, `hsla(${hue},75%,46%,.16)`);
    gr.addColorStop(1, `hsla(${hue},82%,62%,.4)`);
    c.fillStyle = gr;
    c.fillRect(6 + x, top, 1.1, bot - top);
  }
  const top = wvPath((u) => [6 + u * W, yc - E(u * W) * A], W), bot = wvPath((u) => [6 + u * W, yc + E(u * W) * A * 0.92], W);
  c.strokeStyle = `rgba(${cl.bloom},.22)`; c.stroke(bot);
  wvTrace(c, top, cl, 1.2, 0.8);
  c.fillStyle = 'rgba(255,255,255,.08)';
  c.fillRect(6, yc - 0.5, W, 1);
}

/// The next moments of the real schedule, each grain a bell at the place it
/// reads, as wide as it is and as high as it is loud. Faint while stopped.
function gsDrawGrains(c, geo, cl) {
  const g = state.grains;
  if (!g?.grains?.length) return;
  const { a, b, X, yc, A, K, h } = geo, sr = g.sampleRate || state.view.sampleRate || 44100;
  // The schedule runs along the output; a stopped transport may be parked
  // anywhere, so while stopped it is read from where Start is.
  const at = engine.playing ? playbackTime() : engineFromSrc(gsHead() * (gsFile()?.sr || sr)) / (engine.deviceRate || 48000);
  const now = at * sr, span = 0.6 * sr, base = gsRead('semitones');
  const pk = 0.06 + 0.88 * gsRead('envelope'), cloud = gsCloudActive();
  c.lineWidth = 1; c.lineJoin = 'round';
  let drawn = 0;
  for (const ev of g.grains) {
    if (ev[0] < now || ev[0] > now + span) continue;
    const s = ev[1] / sr, life = ev[2] / sr;
    if (s < a || s > b) continue;
    // With no cloud these are the engine's own windows: lower, quieter, tan.
    const u = (ev[0] - now) / span, al = (gsHeadLive() ? 0.9 : 0.35) * (1 - u * 0.8) * (cloud ? 1 : 0.35);
    const x = X(s), w2 = Math.max(5, X(s + life / 2) - X(s - life / 2));
    const y = wvClamp(yc - wvClamp(ev[3] - base, -13, 13) * K, 10, h - 16), hh = (12 + A * 1.7 * wvClamp((ev[4] || 0) * 4)) * (cloud ? 1 : 0.6);
    const p = new Path2D();
    p.moveTo(x - w2 / 2, y);
    for (let k = 1; k <= 14; k++) { const q = k / 14; p.lineTo(x - w2 / 2 + q * w2, y - gsEnvShape(q, pk) * hh); }
    c.fillStyle = cloud ? `rgba(${cl.bloom},${(al * 0.12).toFixed(3)})` : `rgba(207,166,108,${(al * 0.1).toFixed(3)})`; c.fill(p);
    c.strokeStyle = cloud ? `rgba(255,255,255,${Math.min(1, al * 0.8).toFixed(3)})` : `rgba(226,190,140,${(al * 0.6).toFixed(3)})`; c.stroke(p);
    if (++drawn >= 140) break;
  }
}

function gsDrawCloud() {
  const g = GS_CV.gsCloud, f = gsFile();
  if (!g) return;
  const { c, w, h } = g, cl = gsCl();
  c.clearRect(0, 0, w, h);
  if (!f || !state.overview) return;
  gsDetailWant();
  const staticKey = `${GS_DET.want}|${GS_DET.got}|${w}|${h}`;
  if (GS_DET.staticKey !== staticKey) gsRenderCloudStatic(staticKey);
  c.drawImage(GS_DET.cv, 0, 0, w, h);
  const geo = gsCloudGeo(), { a, b, X, yc, A, K } = geo, act = gsCloudActive(), W = w - 12;
  // Pitch: faint ticks at the right edge only.
  c.font = `9px ${cl.mono}`;
  for (const s of [12, 6, 0, -6, -12]) {
    const y = yc - s * K;
    c.fillStyle = s ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.34)';
    c.fillRect(w - (s % 12 ? 9 : 13), y - 0.5, s % 12 ? 5 : 9, 1);
    if (s % 12 === 0) {
      c.fillStyle = cl.t3; c.textAlign = 'right';
      c.fillText(s ? (s > 0 ? '+12' : '−12') : '0 st', w - 16, y + 3);
      c.textAlign = 'left';
    }
  }
  const hp = gsReadWrap(gsHead() + (act ? gsRead('position') * f.len : 0)), hx = X(hp);
  const sp = act ? gsRead('positionJitterMs') / 1000 : 0, ww = gsRead('windowMs') / 1000;
  if (sp > 0.0005) {
    const x0 = X(hp - sp), x1 = X(hp + sp), gr = c.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, 'rgba(124,240,208,0)'); gr.addColorStop(0.5, 'rgba(124,240,208,.05)'); gr.addColorStop(1, 'rgba(124,240,208,0)');
    c.fillStyle = gr; c.fillRect(x0, 6, x1 - x0, h - 20);
    c.strokeStyle = 'rgba(124,240,208,.2)';
    c.setLineDash([2, 5]);
    c.beginPath(); c.moveTo(x0, 10); c.lineTo(x0, h - 16); c.moveTo(x1, 10); c.lineTo(x1, h - 16); c.stroke();
    c.setLineDash([]);
  }
  // The read head: Position, the Window its width.
  const bw = Math.max(6, X(hp + ww / 2) - X(hp - ww / 2)), bx = hx - bw / 2;
  c.fillStyle = 'rgba(255,255,255,.03)';
  c.strokeStyle = act ? 'rgba(255,255,255,.26)' : 'rgba(255,255,255,.13)';
  c.lineWidth = 1;
  c.beginPath(); c.roundRect(bx, 8, bw, h - 24, 3); c.fill(); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.55)';
  c.beginPath(); c.roundRect(hx - 6, 5, 12, 4, 2); c.fill();
  if (GS_DET.rg) {
    const rg = GS_DET.rg;
    c.save();
    c.beginPath(); c.rect(bx, 0, bw, h); c.clip();
    const p = wvPath((u) => { const x = bx + u * bw; return [x, yc - rg[wvClamp(Math.floor(x - 6), 0, W - 1)] * A]; }, Math.max(4, Math.ceil(bw)));
    c.strokeStyle = cl.acc; c.lineWidth = 1.8; c.shadowBlur = 10; c.shadowColor = cl.acc;
    c.stroke(p);
    c.restore();
  }
  gsDrawGrains(c, geo, cl);
  c.fillStyle = cl.t2;
  c.fillText(gsFms(ww * 1000), Math.min(bx + bw + 4, w - 60), h - 18);
  gsDrawMarks(c, geo, cl);
  if (gsNoteHead() != null) {
    const nh = gsHead();
    if (nh >= a && nh <= b) gsDrawNoteHead(c, X(nh), 18, h - 18, 30, cl);
  }
  c.font = `9px ${cl.mono}`;
  gsZoomRo();
  const gr = state.grains;
  gsTxt('gsCloudRo', gr?.grains?.length ? `${gr.total.toLocaleString()} grains · head ${hp.toFixed(2)}s` : 'no cloud — raise Density or Layers');
}

/// What the engine does to the loop, drawn on it: transients, frames, anchors.
function gsDrawMarks(c, geo, cl) {
  const { a, b, X, h, w } = geo, e = GS.engine;
  c.save();
  c.beginPath(); c.rect(6, 0, w - 12, h); c.clip();
  c.font = `9px ${cl.mono}`;
  if (e === 'wsola' || e === 'hybrid') {
    const pres = e === 'hybrid' || !!gsRead('preserveTransients');
    const src = gsPicOnsets(), thr = 0.3 + (1 - gsRead('sensitivity')) * 0.6, flv = gsRead('floor') * src.med * src.k;
    const gd = gsRead('guardHops') * (gsRead('windowMs') / 1000) / Math.max(1, gsRead('overlap'));
    let n = 0, top = 0;
    for (const o of src.on) {
      if (o.s < thr || o.t < a || o.t > b) continue;
      const ok = o.l >= flv, x = X(o.t);
      if (ok) n++;
      if (o.l > top) top = o.l;
      if (pres && ok) { c.fillStyle = 'rgba(216,143,126,.07)'; c.fillRect(X(o.t - gd), 10, X(o.t + gd) - X(o.t - gd), h - 26); }
      c.strokeStyle = ok ? (pres ? 'rgba(240,170,150,.8)' : 'rgba(240,170,150,.35)') : 'rgba(255,255,255,.1)';
      c.setLineDash(pres ? [] : [2, 3]);
      c.beginPath(); c.moveTo(x, 12); c.lineTo(x, h - 16); c.stroke();
      c.setLineDash([]);
    }
    if (flv > 0 && top > 0) {
      // Floor: a hit below this line is not kept. Read against the loudest hit
      // in view.
      const y = geo.yc - wvClamp(flv / top) * geo.A;
      c.strokeStyle = 'rgba(232,164,147,.45)'; c.lineWidth = 1;
      c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(6, y); c.lineTo(w - 6, y); c.stroke();
      c.setLineDash([]);
      gsLbl(c, 'floor', w - 92, y - 3, '#e8a493');
    }
    gsLbl(c, `${n} transient${n === 1 ? '' : 's'}${pres ? ' kept' : ''}`, 10, h - 20, '#e8a493');
  }
  if (e === 'vocoder' || e === 'pvsola' || e === 'hybrid') {
    const fr = gsRead('vocWindowMs') / 1000 / 2;
    c.fillStyle = `rgba(${cl.bloom},.55)`;
    if ((b - a) / fr < 600) for (let s = Math.ceil(a / fr) * fr; s < b; s += fr) c.fillRect(X(s) - 0.5, h - 16, 1, 5);
    const anchors = gsRead('anchorFrames');
    if (e === 'pvsola') {
      const fn = fr * anchors;
      c.fillStyle = 'rgba(207,166,108,.9)';
      if ((b - a) / fn < 600) for (let s = Math.ceil(a / fn) * fn; s < b; s += fn) {
        const x = X(s);
        c.beginPath(); c.moveTo(x - 3, h - 23); c.lineTo(x + 3, h - 23); c.lineTo(x, h - 18); c.fill();
      }
    }
    gsLbl(c, e === 'pvsola' ? `frame ${Math.round(fr * 1000)} ms · anchor every ${Math.round(fr * anchors * 1000)} ms` : `frame every ${Math.round(fr * 1000)} ms`, e === 'hybrid' ? 150 : 10, h - 20, cl.t2);
  }
  const cue = gsCue();
  if (cue >= a && cue <= b) {
    const sx = X(cue);
    c.strokeStyle = 'rgba(143,227,136,.5)';
    c.setLineDash([2, 3]);
    c.beginPath(); c.moveTo(sx, 12); c.lineTo(sx, h - 16); c.stroke();
    c.setLineDash([]);
    c.fillStyle = GS_START;
    c.beginPath(); c.moveTo(sx, 10); c.lineTo(sx + 8, 14); c.lineTo(sx, 18); c.fill();
  }
  const sc = gsRead('scan'), r = gsRead('ratio'), L = gsLoop(), per = Math.abs(sc) > 1e-3 ? (L.b - L.a) * r / Math.abs(sc) : Infinity;
  gsLbl(c, `Stretch ${r.toFixed(2)}× · Scan ${sc.toFixed(2)}× → ${Number.isFinite(per) ? 'a pass lasts ' + gsFmtS(per) : 'frozen at Start'}`, 10, 16, cl.t2);
  if (GS.czB > GS.czA) gsLbl(c, `${L.a.toFixed(2)}–${L.b.toFixed(2)} s`, w - 60, 16, cl.acc, 'rgba(5,6,9,.78)', 'right');
  c.restore();
}

/// Inside the box moves Position; beside it, across is Spray and up and down is
/// Pitch jitter. The wheel zooms into the loop at the pointer; double-click is
/// the whole loop again.
function gsWireDetail() {
  const g = GS_CV.gsCloud, el = g.el;
  let mode = null, touched = false;
  const hp = () => {
    const f = gsFile();
    return gsReadWrap(gsHead() + (gsCloudActive() && f ? gsRead('position') * f.len : 0));
  };
  // The pointer's place, at once and on every move: the head goes under it, or
  // the spread reaches it. The tray's cloud pad.
  const apply = (e) => {
    const f = gsFile();
    if (!f || !mode) return;
    const { X, yc, K, a, b, w } = gsCloudGeo(), [x, y] = wvLocal(el, e);
    touched = true;
    if (mode === 'pos') {
      gsSetV('position', (a + (x - 6) / (w - 12) * (b - a) - gsHead()) / f.len);
      gsSend(GS_C.position, true);
    } else {
      gsSetV('positionJitterMs', Math.abs(x - X(hp())) / (w - 12) * (b - a) * 1000);
      gsSetV('pitchJitterSemis', Math.abs(y - yc) / K);
      gsSend(GS_C.positionJitterMs, true);
    }
  };
  gsDrag(el, (dx, dy, e) => apply(e), (e) => {
    const f = gsFile();
    if (!f) { mode = null; return; }
    const { X } = gsCloudGeo(), [x] = wvLocal(el, e), w2 = gsRead('windowMs') / 2000;
    const bw = Math.max(6, X(hp() + w2) - X(hp() - w2));
    mode = Math.abs(x - X(hp())) <= bw / 2 + 5 ? 'pos' : 'spray';
    touched = false;
    apply(e);
  }, () => {
    if (mode && touched) gsCommit(GS_C.positionJitterMs);
    mode = null;
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x] = wvLocal(el, e), [ca, cb] = gsCloudView(), W = g.w - 12;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (GS.czB > GS.czA) {
        const d = (e.shiftKey ? e.deltaY : e.deltaX) / W * (cb - ca);
        GS.czA += d; GS.czB += d;
        [GS.czA, GS.czB] = gsCloudView();
      }
    } else gsZoomCloud(Math.exp(wvClamp(e.deltaY, -60, 60) * 0.006), ca + (x - 6) / W * (cb - ca));
  }, { passive: false });
  el.addEventListener('dblclick', () => { GS.czA = GS.czB = 0; });
}
