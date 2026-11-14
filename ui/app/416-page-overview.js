// ================================================================ The overview, on every page
//
// One strip under the Now Playing bar, the whole width of the centre: the open
// file in the sound's colours, its loop brackets, the green Start flag, the
// heads and the playhead. The same element on every page and in the same place,
// so going from page to page changes everything under it and nothing in it (RJ,
// 14 Nov 2026: "the waveform overview should not change, but everything under
// it … should"). Shown on every page but Browse and Theme (`PO_MODES`, set by
// `poSync` from `setMode`).
//
// It is Grain's overview made shared (it was `gsDrawOverview`, 401), with every
// gesture it had: a bracket moves an end of the loop, a drag across makes a new
// loop, a click or the flag moves Start, ⌥ scrubs, a region's strip selects it.
// The Edit page's `#overview` and Chop's own stand down for it, and each lends
// it its part:
//
// - where the lane is showing, the lane's zoomed window is a box on it, and
//   dragging inside the box pans the lane, as Edit's overview did;
// - on Chop, Chop's cuts are lines across it, the box is Chop's detail, and a
//   double-click fits the detail to the whole sound, as Chop's overview did.
//
// It has its own zoom (the wheel round the pointer, ⇧-wheel or a sideways wheel
// to pan, and −, + and Fit at its right end), and its own height, dragged at the
// grip along its bottom and kept. The same grip is on Prism's SOURCE well.
//
// Its frame loop runs while it shows, on every page, and draws only when
// something it shows has changed, as Grain's `gsTick` does.

const PO = {
  on: false, raf: 0, failed: false, key: '',
  el: null, well: null, cv: null, c: null, w: 0, h: 0,
  // The zoom, in seconds of the sound. Equal means the whole file.
  za: 0, zb: 0, path: null,
  // What the drawing depends on that a string cannot say: when one of these is
  // a new object, `serial` moves on.
  seen: [], serial: 0, pk: 1, pkFor: null,
  // The sound's colours, asked for once per sound and per reading of it.
  colFor: '',
  // Zoomed in, the overview's 1400 columns run out: the part in view is read
  // at the strip's own width, as Grain's detail reads its own.
  det: { want: '', got: '', p: null, a: 0, b: 0, ov: null, seq: 0, timer: 0 },
};

/// The strip's height, and Prism's SOURCE well's: dragged at the grip, kept.
const PO_H = { min: 48, max: 240 };
const PO_HKEY = 'mgl.pageOverview.h';
const PO_HDEF = 72;
/// The modes it shows in: Edit, Grain, Prism and Chop (all `edit`), the room,
/// Compose, Wave (`synth`), Seq and Atmosphere (`atmos`, which shows Seq's
/// frame). Not Browse (`overview`) or Theme.
const PO_MODES = ['edit', 'room', 'compose', 'synth', 'seq', 'atmos'];
/// The shortest stretch the zoom goes down to, in seconds.
const PO_MINSPAN = 0.01;

/// The strip's colours, from its own tokens (the shared look's, `--look-*`),
/// read once a theme. The names Grain's drawing helpers ask for.
let poColourCache = null;
function poCl() {
  if (poColourCache?.stamp === themeStamp) return poColourCache;
  const s = getComputedStyle(PO.el), v = (k) => s.getPropertyValue(k).trim();
  poColourCache = {
    wave: v('--po-wave') || '#fff', bloom: v('--po-bloom') || '205,225,255', acc: v('--po-acc') || '#7cf0d0',
    on: v('--po-on') || '#ffb547', t: v('--po-t') || '#e8eaee', t2: v('--po-t2') || '#b9bec6', t3: v('--po-t3') || '#858b94',
    mono: v('--mono') || 'monospace', sans: v('--sans') || 'sans-serif',
    stamp: themeStamp,
  };
  return poColourCache;
}

const poDirty = () => { PO.key = ''; };

// ──────────────────────────────────────────────────────────── showing and sizing

/// Called by `setMode` after its toggles, so a page that fits itself to the
/// centre measures the centre with the strip in it.
function poSync() {
  const want = PO_MODES.includes(state.mode);
  PO.el.classList.toggle('hidden', !want);
  PO.on = want;
  poDirty();
  if (want && !PO.raf) PO.raf = requestAnimationFrame(poFrame);
}

function poSize() {
  const w = PO.well.clientWidth, h = PO.well.clientHeight, dpr = wvDpr();
  if (!w || !h) return;
  PO.w = w; PO.h = h;
  PO.cv.width = Math.round(w * dpr);
  PO.cv.height = Math.round(h * dpr);
  PO.c.setTransform(dpr, 0, 0, dpr, 0, 0);
  poDirty();
}

/// A grip along a well's bottom edge: drag it for the well's height, which is
/// kept under `key`; double-click puts it back to `def`.
function poGrip(grip, key, def, set) {
  const clampH = (h) => Math.round(wvClamp(h, PO_H.min, PO_H.max));
  let h = def;
  try { const got = +localStorage.getItem(key); if (got) h = clampH(got); } catch { /* private mode */ }
  set(h);
  const keep = () => { try { localStorage.setItem(key, String(h)); } catch { /* private mode */ } };
  let y0 = 0, h0 = 0;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    y0 = e.clientY; h0 = h;
    grip.classList.add('on');
    grip.onpointermove = (ev) => { h = clampH(h0 + ev.clientY - y0); set(h); };
  });
  const up = () => { if (!grip.onpointermove) return; grip.onpointermove = null; grip.classList.remove('on'); keep(); };
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
  grip.addEventListener('dblclick', (e) => { e.stopPropagation(); h = def; set(h); keep(); });
}

// ──────────────────────────────────────────────────────────────────── the zoom

/// What the strip shows, in seconds: the whole file, or the part zoomed to.
function poView() {
  const f = gsFile();
  if (!f) return [0, 1];
  if (!(PO.zb > PO.za)) return [0, f.len];
  const L = Math.min(PO.zb - PO.za, f.len), a = wvClamp(PO.za, 0, f.len - L);
  return [a, a + L];
}

const poZoomed = () => PO.zb > PO.za;

function poZoom(k, at) {
  const f = gsFile();
  if (!f) return;
  const [va, vb] = poView();
  at = at ?? (va + vb) / 2;
  const L = Math.max(PO_MINSPAN, (vb - va) * k);
  if (L >= f.len * 0.999) { PO.za = PO.zb = 0; poDirty(); return; }
  let a = at - (at - va) / (vb - va) * L, b = a + L;
  if (a < 0) { b -= a; a = 0; }
  if (b > f.len) { a -= b - f.len; b = f.len; }
  PO.za = a; PO.zb = b;
  poDirty();
}

function poPan(ds) {
  if (!poZoomed()) return;
  PO.za += ds; PO.zb += ds;
  [PO.za, PO.zb] = poView();
  poDirty();
}

/// Where + zooms in round: the head while it plays, Start while it does not.
function poAnchor() {
  const h = poHead();
  return h ?? gsCue();
}

function poZoomRo() {
  const f = gsFile(), [va, vb] = poView();
  const s = !f ? '' : poZoomed() ? `${(f.len / (vb - va)).toFixed(f.len / (vb - va) < 10 ? 1 : 0)}×` : 'whole';
  if (PO.ro.textContent !== s) PO.ro.textContent = s;
}

// ────────────────────────────────────────────────── what each page lends it

/// Chop's part, while the Chop page shows and has the open sound cut.
const poChop = () => document.body.classList.contains('choppage') && typeof chopShown === 'function' && chopShown() && chop.len > 0;

/// The detail a page shows under it, as a box to drag, in seconds: the lane's
/// zoomed window wherever the lane shows, or Chop's detail on Chop. Null when
/// that page is showing the whole sound.
function poBox() {
  const f = gsFile();
  if (!f) return null;
  if (poChop()) {
    if (chopView.b - chopView.a >= chop.len * 0.999) return null;
    return { kind: 'chop', a: chopView.a / chop.rate, b: chopView.b / chop.rate };
  }
  const lane = $('lane');
  if (!lane || lane.classList.contains('hidden') || !lane.getClientRects().length) return null;
  const total = state.view.frames || state.overview?.frames || 0, { from, to } = state.view;
  if (!(total > 0 && to > from && to - from < total * 0.999)) return null;
  return { kind: 'edit', a: from / f.sr, b: to / f.sr };
}

/// Move the page's detail so it starts at `a` seconds, its length kept.
function poBoxTo(kind, a) {
  const f = gsFile();
  if (!f) return;
  if (kind === 'chop') {
    const L = chopView.b - chopView.a;
    chopView.a = Math.round(wvClamp(a * chop.rate, 0, chop.len - L));
    chopView.b = chopView.a + L;
    chopPaintLane();
    return;
  }
  // The lane's own route, as its overview took it (`wireOverview`, 040).
  const total = state.view.frames || state.overview?.frames || 0, span = state.view.to - state.view.from;
  if (!total || span <= 0 || span >= total) return;
  const from = Math.round(wvClamp(a * f.sr, 0, total - span));
  if (from === state.view.from) return;
  state.view.from = from;
  state.view.to = from + span;
  drawOverviewWindow();
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
}

/// Where the transport's head is, in seconds, or null while nothing plays. On
/// Grain, a held note's head and each Poly voice's are the page's own.
function poHead() {
  const f = gsFile();
  if (!f) return null;
  if (GS.showing && (gsNoteHead() != null || gsPolyHeads().length)) return gsHead();
  if (!engine.playing) return null;
  const h = gsScanned(sourceFrameNow() / f.sr);
  return Number.isFinite(h) ? h : null;
}

/// Ask for the sound's colours (411) on a page that has not: the Edit page asks
/// on its own, Grain hands over the samples it reads, and Prism measures its own
/// sound, so those three are left to it.
function poColours() {
  const path = state.selectedFile?.path, b = document.body.classList;
  if (!path || GS.showing || b.contains('prismpage') || b.contains('wavepage')) return;
  const want = `${path}|${edSoundWant}`;
  if (PO.colFor === want || (edSound.path === path && edSound.serial === edSoundWant && edSound.mono)) return;
  PO.colFor = want;
  edLoadSound(path);
}

// ─────────────────────────────────────────────────────── reading the peaks

/// The loudest of the peaks `p` between two times, in seconds.
function poPeakIn(p, f, t0, t1) {
  const from = p.from || 0, to = p.to || f.frames, n = p.columns, k = n / Math.max(1, to - from), ch = p.channels[0];
  const i0 = Math.max(0, Math.floor((t0 * f.sr - from) * k)), i1 = Math.min(n, Math.max(i0 + 1, Math.ceil((t1 * f.sr - from) * k)));
  let m = 0;
  for (let i = i0; i < i1; i++) { const v = Math.max(Math.abs(ch.min[i]), Math.abs(ch.max[i])); if (v > m) m = v; }
  return m;
}

/// The part in view, at the strip's width, a moment after the view stops
/// moving, so a wheel turned or a drag is not a fetch a frame.
function poDetailWant() {
  const f = gsFile(), sound = state.selectedFile, d = PO.det;
  if (!f || !sound || !poZoomed()) return;
  const [a, b] = poView(), cols = Math.max(200, Math.round(PO.w - 12));
  const want = `${sound.path}|${a.toFixed(4)}|${b.toFixed(4)}|${f.frames}|${cols}`;
  if (want === d.want) return;
  d.want = want;
  clearTimeout(d.timer);
  d.timer = setTimeout(async () => {
    const seq = ++d.seq, ov = state.overview;
    let p;
    try { p = await api(`/api/peaks?p=${encodeURIComponent(sound.path)}&cols=${cols}&clips=1&from=${Math.floor(a * f.sr)}&to=${Math.ceil(b * f.sr)}`); } catch { return; }
    if (seq !== d.seq || state.selectedFile?.path !== sound.path || state.overview !== ov || !p?.channels?.length) return;
    Object.assign(d, { p, a, b, ov, got: want });
    poDirty();
  }, 120);
}

// ──────────────────────────────────────────────────────────────────── the drawing

function poDraw() {
  const { c, w, h } = PO, f = gsFile(), cl = poCl(), p = state.overview;
  if (!c || !w || !h) return;
  c.clearRect(0, 0, w, h);
  c.font = `11px ${cl.sans}`;
  poZoomRo();
  if (!p || !f || !p.channels?.length) {
    c.fillStyle = cl.t3;
    c.fillText(state.selectedFile ? 'Reading the sound…' : 'Open a sound', 16, Math.min(24, h / 2 + 4));
    return;
  }
  const [va, vb] = poView(), W = w - 12, X = (s) => 6 + (s - va) / (vb - va) * W;
  const { a, b } = gsLoop(), bot = h - 13, mid = (bot + 4) / 2, A = (bot - 8) / 2;
  if (PO.pkFor !== p) {
    let pk = 0.001;
    const ch = p.channels[0];
    for (let i = 0; i < p.columns; i++) pk = Math.max(pk, Math.abs(ch.min[i]), Math.abs(ch.max[i]));
    PO.pk = pk; PO.pkFor = p;
  }
  c.save();
  c.beginPath(); c.rect(4, 0, w - 8, h); c.clip();
  // The file, filled, so its loud and quiet parts read at a glance; in the
  // sound's own colours, low to high as on the Edit page and Chop, once it has
  // been measured, and plain until then.
  const lit = edSound.an && edSound.path === state.selectedFile?.path, d = PO.det;
  const det = poZoomed() && d.p && d.ov === p ? d : null;
  c.fillStyle = `rgba(${cl.bloom},.3)`;
  for (let x = 0; x < W; x++) {
    const t0 = va + (vb - va) * x / W, t1 = va + (vb - va) * (x + 1) / W;
    const src = det && t0 >= det.a && t1 <= det.b ? det.p : p, m = Math.min(1, poPeakIn(src, f, t0, t1) / PO.pk) * A;
    const k = lit && edColourAt((t0 + t1) / 2 * edSound.rate, true);
    if (k) c.fillStyle = `rgba(${k[0] | 0},${k[1] | 0},${k[2] | 0},.9)`;
    c.fillRect(6 + x, mid - m, 1, m * 2);
  }
  // The time, on steps that fit the part in view.
  c.font = `9px ${cl.mono}`;
  const span = vb - va, st = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300].find((s) => span / s <= 12) || 600;
  const dp = st < 0.1 ? 2 : st < 1 ? 1 : 0;
  for (let s = Math.ceil(va / st) * st; s < vb; s += st) {
    const x = X(s);
    if (x > w - 84) break;
    c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(x, 4, 1, bot - 4);
    c.fillStyle = cl.t3; c.fillText(s.toFixed(dp) + ' s', x + 3, h - 3);
  }
  c.textAlign = 'right';
  c.fillText(poZoomed() ? `${va.toFixed(2)}–${vb.toFixed(2)} of ${f.len.toFixed(1)} s` : f.len.toFixed(1) + ' s', w - 8, h - 3);
  c.textAlign = 'left';
  gsDrawAnnotations(c, X, 4, bot, cl);
  // The loop: outside dimmed, the brackets to drag.
  const ra = X(a), rb = X(b);
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(4, 0, Math.max(0, ra - 4), h); c.fillRect(rb, 0, Math.max(0, w - 4 - rb), h);
  c.fillStyle = 'rgba(124,240,208,.05)'; c.fillRect(ra, 0, rb - ra, bot);
  // Chop's cuts, across the whole height, over the dimming so they read.
  if (poChop()) {
    c.save();
    c.strokeStyle = cl.wave; c.globalAlpha = 0.75; c.lineWidth = 1;
    c.beginPath();
    let last = -9;
    const cut = (fr) => { const x = Math.round(X(fr / chop.rate)) + 0.5; if (x - last >= 2 && x > 3 && x < w - 3) { c.moveTo(x, 0); c.lineTo(x, h); last = x; } };
    for (const s of chop.slices) cut(s.s);
    if (chop.slices.length) cut(chop.slices[chop.slices.length - 1].e);
    c.stroke();
    c.restore();
  }
  // The page's detail, as a box to drag.
  const box = poBox();
  if (box) {
    const x0 = X(box.a), x1 = Math.max(x0 + 3, X(box.b));
    c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x0, 4, x1 - x0, bot - 4);
    c.save(); c.strokeStyle = cl.t; c.globalAlpha = 0.7; c.lineWidth = 1;
    c.strokeRect(x0 + 0.5, 4.5, x1 - x0 - 1, bot - 5);
    c.restore();
  }
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
  if (h >= 56) gsLbl(c, 'START ' + cue.toFixed(2), sx + 12, 30, GS_START);
  // The heads: Grain's voices and held note while Grain shows, the transport's
  // everywhere, and Chop's own while it plays a slice.
  if (GS.showing) gsDrawVoiceHeads(c, X, 4, bot, bot - 16, 12, cl);
  if (GS.showing && gsNoteHead() != null) gsDrawNoteHead(c, X(gsHead()), 4, bot, bot - 16, cl);
  else if (engine.playing) {
    const hd = poHead();
    if (hd != null) {
      const hx = X(hd);
      c.fillStyle = cl.t; c.fillRect(hx - 0.75, 4, 1.5, bot - 4);
      gsLbl(c, 'HEAD', hx + 4, bot - 4, cl.t);
    }
  }
  const ch = poChop() ? chopPlayhead() : -1;
  if (ch >= 0) { c.fillStyle = cl.wave; c.fillRect(X(ch / chop.rate) - 0.75, 0, 1.5, h); }
  c.restore();
  // Zoomed: which part of the file is in view, along the top.
  if (poZoomed()) {
    c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(6, 0, W, 3);
    c.fillStyle = cl.acc; c.fillRect(6 + va / f.len * W, 0, Math.max(3, span / f.len * W), 3);
  }
}

// ─────────────────────────────────────────────────────────────── the frame loop

/// What a page lends the strip, as a string: Chop's cuts are moved in place,
/// so they are summed rather than compared.
function poChopKey() {
  if (!poChop()) return '';
  let s = 0;
  for (const x of chop.slices) s += x.s + x.e * 1e-3;
  return `${chop.slices.length}|${s}|${chopView.a}|${chopView.b}|${chopPlayhead()}`;
}

function poTick(now) {
  const path = state.selectedFile?.path || null;
  // The zoom belongs to the sound it was set on.
  if (PO.path !== path) { PO.path = path; PO.za = PO.zb = 0; PO.det.want = PO.det.got = ''; PO.det.p = null; }
  poColours();
  if (!PO.w) poSize();
  const seen = [state.overview, state.annotations, edSound.an, edSound.path, path];
  if (seen.some((v, i) => v !== PO.seen[i])) { PO.seen = seen; PO.serial++; }
  poDetailWant();
  const live = engine.playing || (GS.showing && gsHeadLive()) || (poChop() && chopPlayhead() >= 0);
  const box = poBox(), sel = state.sel ? `${state.sel.start}|${state.sel.end}` : '';
  const key = [PO.w, PO.h, themeStamp, PO.serial, sel, state.cue, state.loopOn, PO.za, PO.zb, PO.det.got,
    box ? `${box.a}|${box.b}` : '', poChopKey(), live ? now : 0].join('|');
  if (key === PO.key) return;
  PO.key = key;
  poDraw();
}

function poFrame(now) {
  PO.raf = 0;
  if (!PO.on) return;
  PO.raf = requestAnimationFrame(poFrame);
  try { poTick(now); } catch (e) { if (!PO.failed) { PO.failed = true; console.error('[overview]', e); } }
}

// ─────────────────────────────────────────────────────────────── the gestures

/// A bracket, the Start flag, or a drag across for a new loop; a click moves
/// Start; inside the page's box, a drag pans that page's detail.
function poWire() {
  const el = PO.cv;
  const W = () => PO.w - 12;
  // Unclamped: the time under a point, even past the file's ends.
  const at = (x) => { const [va, vb] = poView(); return va + (x - 6) / W() * (vb - va); };
  const toS = (x) => { const f = gsFile(); return f ? wvClamp(at(x), 0, f.len) : 0; };
  const X = (s) => { const [va, vb] = poView(); return 6 + (s - va) / (vb - va) * W(); };
  // Prism plays its own sound on the transport, so the open file is not
  // seeked from here while it shows; its loop and Start still are set.
  const seeks = () => !document.body.classList.contains('prismpage');
  const scrub = (s) => { const f = gsFile(); if (f && seeks()) gsSeekTo(Math.round(s * f.sr)); };
  // What a press here would take hold of, for the cursor and the press alike.
  const grab = (x, y) => {
    const f = gsFile();
    if (!f) return { sm: null };
    const ends = gsLoop(), bot = PO.h - 13, r = gsRegionAt(x, y, X, bot);
    const nearEnd = Math.abs(x - X(ends.a)) < 6 || Math.abs(x - X(ends.b)) < 6;
    if (r && !nearEnd) return { sm: 'region', r };
    if (Math.abs(x - X(ends.a)) < 6) return { sm: 'a' };
    if (Math.abs(x - X(ends.b)) < 6) return { sm: 'b' };
    if (Math.abs(x - X(gsCue())) < 6) return { sm: 'cue' };
    const box = poBox();
    if (box && x >= X(box.a) && x <= X(box.b)) return { sm: 'pan', box };
    return { sm: 'sel' };
  };
  let sm = null, s0 = 0, moved = 0, ends = null, box = null;
  gsDrag(el, (dx, dy, e) => {
    const x = wvLocal(el, e)[0], s = toS(x), { a, b } = ends;
    moved += Math.abs(dx);
    // Option runs over the file to hear it, and leaves the loop and Start alone.
    if (sm === 'scrub' || (sm && sm !== 'pan' && e.altKey)) scrub(s);
    else if (sm === 'a') gsSetLoop(Math.min(s, b - 0.05), b);
    else if (sm === 'b') gsSetLoop(a, Math.max(s, a + 0.05));
    else if (sm === 'cue') gsMoveCue(s);
    else if (sm === 'sel' && moved > 3) { gsSetLoop(Math.min(s0, s), Math.max(s0, s)); gsMoveCue(Math.min(s0, s)); }
    else if (sm === 'pan' && moved > 3) poBoxTo(box.kind, box.a + at(x) - s0);
    poDirty();
  }, (e) => {
    const f = gsFile();
    ends = gsLoop();
    moved = 0;
    sm = null;
    if (!f) return;
    const [x, y] = wvLocal(el, e);
    s0 = toS(x);
    if (e.altKey) { sm = 'scrub'; scrub(s0); return; }
    const g = grab(x, y);
    if (g.sm === 'region') { state.sel = { start: g.r.start, end: g.r.end }; drawSelection(); applyLoop(); poDirty(); return; }
    sm = g.sm;
    // The box is moved by how far the pointer goes, not to where it is, so
    // taking hold of it does not make it jump.
    if (sm === 'pan') { box = g.box; s0 = at(x); }
  }, () => {
    // A click, in the box or out of it, moves Start.
    if ((sm === 'sel' || sm === 'pan') && moved <= 3) { gsMoveCue(wvClamp(s0, 0, gsFile()?.len || 0)); if (seeks()) seekSource(state.cue); }
    else if (sm && sm !== 'scrub' && sm !== 'pan' && state.loopOn && state.sel && seeks()) seekSource(state.sel.start);
    sm = null;
    poDirty();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const [x, y] = wvLocal(el, e), g = grab(x, y).sm;
    el.style.cursor = g === 'a' || g === 'b' || g === 'cue' ? 'ew-resize' : g === 'pan' ? 'grab' : g === 'region' ? 'pointer' : 'default';
  });
  el.addEventListener('wheel', (e) => {
    if (!gsFile()) return;
    e.preventDefault();
    const [va, vb] = poView();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) poPan((e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) / W() * (vb - va));
    else poZoom(Math.exp(wvClamp(e.deltaY, -60, 60) * 0.006), at(wvLocal(el, e)[0]));
  }, { passive: false });
  // On Chop, the whole sound in Chop's detail, as its own overview did; on any
  // other page, the whole file here.
  el.addEventListener('dblclick', () => {
    if (poChop()) chopFit0();
    else { PO.za = PO.zb = 0; }
    poDirty();
  });
  $('poZoomIn').onclick = () => poZoom(0.5, poAnchor());
  $('poZoomOut').onclick = () => poZoom(2);
  $('poZoomFit').onclick = () => { PO.za = PO.zb = 0; poDirty(); };
}

(() => {
  PO.el = $('pageOv');
  PO.well = $('poWell');
  PO.cv = $('poCanvas');
  PO.ro = $('poZoomRo');
  if (!PO.el || !PO.cv) return;
  PO.c = PO.cv.getContext('2d');
  poGrip($('poGrip'), PO_HKEY, PO_HDEF, (h) => { PO.well.style.height = `${h}px`; });
  new ResizeObserver(poSize).observe(PO.well);
  poWire();
})();
