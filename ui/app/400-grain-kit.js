// ================================================================ Grain: the kit
//
// The Grain v12 page: still `mode: 'edit', page: 'grain'`, because it plays the
// open document, with a new face when `prefs.grainUi` is `synth`. The look is
// mock-up v12 (`grain-redesign/grain-v12.html`), which RJ approved on 8 Nov 2026.
//
// **A second face on the same drafts.** The tray in the dock stays built,
// hidden: the Visual page borrows it and a lot of the app reads its rows. This
// page reads and writes `state.stretchDraft` and `state.grainDraft`, and sends
// them by the tray's own routes (`previewStretch`, `commitStretch`,
// `state.grainSend`). There is no second copy of a value anywhere.
//
// This part is the table every control is built from, in the mock-up's names
// (which are the glyphs' names too), and the small things the other parts share.
// The canvas helpers are Wave's (`wvCv`, `wvPath`, `wvTrace`, `wvUnder`, `wvDot`),
// which load first.
//
// Every top-level name starts `gs` or `GS`: the parts share one global scope.

/// The page is laid out at this one size and scaled whole (`gsFit`).
const GS_W = 1388;
const GS_H = 900;

const GS = {
  built: false, showing: false, raf: 0, scale: 1,
  engine: '',
  // A and B: whatever was on screen when you left that side. Reset per sound.
  ab: 'A', abs: { A: null, B: null }, abFor: null,
  rndPrev: null,
  // Set once anything here has written a draft, so the hidden tray is rebuilt
  // on the way out (`gsLeave`) and only then.
  touched: false,
  lastPreview: 0,
  // The detail's zoom, in seconds inside the loop. Equal means the whole loop.
  czA: 0, czB: 0,
  // What the output stage is doing, polled while the page shows and plays.
  master: null, vol: 0.85,
  // AMP and the LFOs: the page's copy of what is sent, kept per A and B and
  // per sound. A target is the name the server moves it by.
  amp: { a: 0.16, d: 0.4, s: 0.78, r: 0.5 },
  lfo: [
    { shape: 'sine', rate: 0.33, sync: false, mode: 'free', depth: 0.45, targets: [] },
    { shape: 'smooth', rate: 0.26, sync: false, mode: 'free', depth: 0.4, targets: [] },
    { shape: 'tri', rate: 0.45, sync: false, mode: 'free', depth: 0.5, targets: [] },
    { shape: 'steps', rate: 0.5, sync: true, mode: 'trig', depth: 0.3, targets: [] },
  ],
  mode: 'mono',
};

function gsOn() { return prefs.grainUi === 'synth'; }

// ───────────────────────────────────────────────────────────── the five engines

const GS_ENG = [
  ['wsola', 'WSOLA', 'Splices the sound with a similarity search; keeps hits. Drums, one-shots.'],
  ['vocoder', 'Vocoder', 'A phase vocoder with phase locking; holds chords and pads, smears hits.'],
  ['pvsola', 'PVSOLA', 'The vocoder, re-anchored to the waveform every few frames, so it does not go phasey.'],
  ['hybrid', 'Hybrid', 'Splits tone, hits and air, stretches each its own way and remakes the air. The slowest.'],
  ['granular', 'Granular', 'A deterministic grain cloud: the one engine not trying to be transparent.'],
];

const gsCloudActive = () => {
  const d = state.stretchDraft;
  return !!d && (d.algorithm === 'granular' || !!d.cloud);
};

// ───────────────────────────────────────────────────────────────── the controls
//
// `at` says which draft the value lives in: s the stretch itself, g the grain,
// w, v, p, h the engines' own. `key` is its name there when that differs from
// the control's own, which is the glyph's. The ranges, sweeps and steps are the
// tray's.

const GS_C = {};
function gsDef(k, label, min, max, d, at, o = {}) {
  GS_C[k] = { k, label, min, max, d, at, key: k, fmt: (v) => v.toFixed(2), ...o };
}

const gsFx2 = (v) => v.toFixed(2) + '×';
const gsFms = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ms';
const gsFpc = (v) => Math.round(v * 100) + '%';
const gsFst = (v) => '±' + v.toFixed(1) + ' st';
const gsLvl = (v) => (v <= 0 ? 'out' : gsFx2(v));

// Time and pitch
//
// The ranges, the sweeps, the steps and the words are the tray's, row for row
// (`renderStretch` and `renderGrainParams`): a control here moves what the tray's
// did, by the amount the tray's did, and says so in the same words.
const gsFs = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms');
const gsFhz = (v, off) => (v <= 0 ? off : Math.round(v) + '/s');
gsDef('ratio', 'Stretch', 0.01, 100, 1, 's', { log: 1, fmt: (v) => (v >= 10 ? v.toFixed(0) + '×' : v >= 1 ? gsFx2(v) : v.toFixed(3) + '×') });
gsDef('semitones', 'Pitch', -48, 48, 0, 's', { bip: 1, step: () => scaleStep(), fmt: (v) => scaleLabel(v) });
gsDef('windowMs', 'Window', 5, 2000, 40, 's', { log: 1, fmt: (v) => Math.round(v) + ' ms' });
// Grains
gsDef('rateHz', 'Rate', 0, 500, 0, 'g', { step: 1, fmt: (v) => gsFhz(v, 'off') });
gsDef('densityHz', 'Density', 0, 500, 0, 'g', { step: 1, fmt: (v) => gsFhz(v, 'auto') });
gsDef('overlap', 'Overlap', 1, 8, 2, 'g', { step: 0.1, fmt: (v) => v.toFixed(1) + '×' });
gsDef('envelope', 'Envelope', 0, 1, 0.5, 'g', { step: 0.01, detent: 0.5, fmt: (v) => { const w = Math.abs(v - 0.5) < 0.005 ? 'symmetric' : v < 0.5 ? 'percussive' : 'swelling'; return w === 'symmetric' ? w : v.toFixed(2) + ' ' + w; } });
gsDef('sizeJitter', 'Size jitter', 0, 1, 0, 'g', { step: 0.01, fmt: gsFpc });
gsDef('sizeRange', 'Size range', 1, 8, 1, 'g', { step: 0.05, fmt: gsFx2 });
gsDef('position', 'Position', -1, 1, 0, 'g', { bip: 1, step: 0.001, fmt: (v) => (v * 100).toFixed(1) + '%' });
gsDef('scan', 'Scan', -2, 2, 1, 'g', { bip: 1, step: 0.01, fmt: (v) => (Math.abs(v) < 0.005 ? 'frozen' : v.toFixed(2) + '×') });
gsDef('positionJitterMs', 'Position jitter', 0, 500, 0, 'g', { step: 1, fmt: (v) => Math.round(v) + ' ms' });
// Pitch movement
gsDef('pitchJitterSemis', 'Pitch jitter', 0, 24, 0, 'g', { step: 0.1, fmt: gsFst });
gsDef('pitchDriftSemis', 'Pitch drift', 0, 24, 0, 'g', { step: 0.1, fmt: gsFst });
gsDef('driftRateHz', 'Drift rate', 0.01, 10, 0.5, 'g', { step: 0.01, fmt: (v) => v.toFixed(2) + ' Hz' });
// Layers
gsDef('layers', 'Layers', 1, 64, 1, 'g', { step: 1, fmt: (v) => Math.round(v) + '×' });
gsDef('layerSpread', 'Layer spread', 0, 4, 1, 'g', { step: 0.01, fmt: (v) => (v <= 0.005 ? 'stacked' : gsFx2(v)) });
gsDef('layerScatter', 'Scatter', 0, 1, 0, 'g', { step: 0.01, fmt: (v) => (v <= 0 ? 'stacked' : gsFpc(v)) });
gsDef('layerScatterMs', 'Range', 1, 2000, 120, 'g', { log: 1, fmt: gsFs });
gsDef('panSpread', 'Pan spread', 0, 1, 0, 'g', { step: 0.01, fmt: (v) => (v <= 0 ? 'centred' : gsFpc(v)) });
// Feedback
gsDef('fbAmount', 'Feedback', 0, 0.95, 0, 'g', { step: 0.01, fmt: (v) => (v <= 0 ? 'off' : gsFpc(v)) });
gsDef('fbTimeMs', 'Time', 20, 2000, 250, 'g', { log: 1, fmt: gsFs });
gsDef('fbSmear', 'Smear', 0, 1, 0.3, 'g', { step: 0.01, fmt: (v) => (v <= 0 ? 'clear' : gsFpc(v)) });
gsDef('fbDamp', 'Damp', 0, 1, 0.4, 'g', { step: 0.01, fmt: (v) => (v <= 0 ? 'bright' : gsFpc(v)) });
gsDef('fbShift', 'Shift', -12, 12, 0, 'g', { bip: 1, step: () => scaleStep(), fmt: (v) => (Math.abs(v) < 0.005 ? 'none' : (v > 0 ? '+' : '') + v.toFixed(2) + ' st') });
// The cloud, and Hybrid's three parts
gsDef('cloudMix', 'Cloud', 0, 1, 0.5, 's', { step: 0.01, fmt: gsFpc });
gsDef('harmonicLevel', 'Tone', 0, 2, 1, 'h', { step: 0.01, fmt: gsLvl });
gsDef('percussiveLevel', 'Hits', 0, 2, 1, 'h', { step: 0.01, fmt: gsLvl });
gsDef('residualLevel', 'Air', 0, 2, 1, 'h', { step: 0.01, fmt: gsLvl });
// The engines' own sections
gsDef('searchMs', 'Search', 0, 200, 10, 'w', { step: 0.5, fmt: (v) => (v <= 0 ? 'plain OLA' : v.toFixed(1) + ' ms') });
gsDef('stride', 'Stride', 1, 128, 4, 'w', { step: 1, fmt: (v) => Math.round(v) + ' fr' });
gsDef('sensitivity', 'Detector', 0, 1, 0.5, 'w', { step: 0.01, fmt: gsFpc });
gsDef('floor', 'Floor', 0, 2, 1, 'w', { step: 0.01, fmt: (v) => (v <= 0 ? 'none' : gsFx2(v)) });
gsDef('guardHops', 'Guard', 1, 16, 3, 'w', { step: 0.1, fmt: (v) => v.toFixed(1) + ' hop' });
gsDef('anchorFrames', 'Re-anchor', 1, 64, 6, 'p', { step: 1, fmt: (v) => Math.round(v) + ' fr' });
gsDef('anchorSearchMs', 'Search', 0, 200, 10, 'p', { key: 'searchMs', step: 0.5, fmt: (v) => (v <= 0 ? 'no search' : v.toFixed(1) + ' ms') });
gsDef('blend', 'Blend', 0, 1, 0.5, 'p', { step: 0.01, fmt: (v) => (v <= 0 ? 'butt join' : gsFpc(v)) });
gsDef('timeSpan', 'Hold', 3, 101, 17, 'h', { odd: 1, fmt: (v) => Math.round(v) + ' fr' });
gsDef('freqSpan', 'Spread', 3, 101, 17, 'h', { odd: 1, fmt: (v) => Math.round(v) + ' bin' });
gsDef('margin', 'Margin', 1, 8, 2, 'h', { step: 0.05, fmt: (v) => (v <= 1.001 ? 'no air' : gsFx2(v)) });
gsDef('fftSize', 'Resolution', 256, 8192, 2048, 'h', { log: 1, step: 1, fmt: (v) => String(Math.round(v)) });
gsDef('vocWindowMs', 'Analysis window', 5, 500, 46, 'v', { key: 'windowMs', log: 1, fmt: (v) => Math.round(v) + ' ms' });
gsDef('magFreeze', 'Freeze', 0, 1, 0, 'v', { step: 0.01, fmt: (v) => (v >= 0.999 ? 'held' : gsFpc(v)) });
gsDef('magBlur', 'Blur', 0, 1, 0, 'v', { step: 0.01, fmt: gsFpc });
gsDef('magGate', 'Gate', 0, 1, 0, 'v', { step: 0.01, fmt: (v) => (v <= 0 ? 'off' : gsFpc(v)) });
gsDef('freqTrust', 'Freq trust', 0, 4, 1, 'v', { step: 0.01, fmt: (v) => (v <= 0.001 ? 'to bins' : gsFx2(v)) });
gsDef('phaseSpread', 'Phase spread', 0, 4, 1, 'v', { step: 0.01, fmt: gsFx2 });
gsDef('peakWidth', 'Peak width', 1, 16, 2, 'v', { step: 1, fmt: (v) => Math.round(v) + ' bin' });
gsDef('lockWidth', 'Lock width', 0, 4, 1, 'v', { step: 0.01, fmt: gsFx2 });
// Switches
const gsSw = (k, label, d, at) => gsDef(k, label, 0, 1, d, at, { sw: 1 });
gsSw('reverse', 'reverse grains', 0, 'g');
gsSw('wrap', 'wrap positions', 0, 'g');
gsSw('driftStep', 'step the drift', 0, 'g');
gsSw('fbHold', 'hold the loop', 0, 'g');
gsSw('linkJitter', 'link jitter', 0, 'g');
gsSw('cloud', 'grain cloud', 0, 's');
gsSw('morphNoise', 'remake noise', 1, 'h');
gsSw('preserveTransients', 'preserve transients', 0, 'w');
gsSw('phaseLock', 'phase lock', 1, 'v');
gsSw('stereoLink', 'link stereo', 0, 'v');
// Choices: the words on the buttons, and what the draft calls them.
gsDef('splicePick', 'Pick', 0, 2, 0, 'w', { key: 'splice', seg: ['best', 'worst', 'loud'], vals: GG_PICK });
gsDef('spliceShape', 'Window', 0, 2, 0, 'w', { key: 'shape', seg: ['hann', 'tri', 'rect'], vals: GG_SHAPE, full: 'Splice window' });

/// Each engine's own sections, in the order the mock-up files them.
const GS_SECT = {
  splice: ['SPLICE', ['searchMs', 'stride', 'splicePick', 'spliceShape']],
  trans: ['TRANSIENTS', ['preserveTransients', 'sensitivity', 'floor', 'guardHops']],
  htrans: ['TRANSIENTS', ['sensitivity', 'floor', 'guardHops']],
  anchor: ['ANCHOR', ['anchorFrames', 'anchorSearchMs', 'blend']],
  sep: ['SEPARATION', ['timeSpan', 'freqSpan', 'margin', 'fftSize']],
  spec: ['SPECTRUM', ['vocWindowMs', 'magFreeze', 'magBlur', 'magGate']],
  phase: ['PHASE', ['freqTrust', 'phaseSpread', 'peakWidth', 'lockWidth', 'phaseLock', 'stereoLink']],
};
const GS_ENG_SECT = {
  wsola: ['splice', 'trans'],
  vocoder: ['spec', 'phase'],
  pvsola: ['anchor', 'spec', 'phase'],
  hybrid: ['sep', 'spec', 'phase', 'splice', 'htrans'],
  granular: [],
};

// ─────────────────────────────────────────────────────────── a value's two ends

function gsToN(c, v) {
  let n;
  if (c.log) n = Math.log(Math.max(v, c.min) / c.min) / Math.log(c.max / c.min);
  else n = (v - c.min) / (c.max - c.min);
  return wvClamp(n);
}

function gsFromN(c, n) {
  n = wvClamp(n);
  // A log bar is the tray's thousand ticks.
  if (c.log) n = Math.round(n * 1000) / 1000;
  let v = c.log ? c.min * Math.pow(c.max / c.min, n) : c.min + n * (c.max - c.min);
  const step = typeof c.step === 'function' ? c.step() : c.step;
  if (step) v = Math.round(v / step) * step;
  if (c.odd) v = Math.round((v - 1) / 2) * 2 + 1;
  return wvClamp(+v.toFixed(6), c.min, c.max);
}

/// The object a control's value lives in, looked up every time: the tray
/// replaces these objects whenever it rebuilds, so a reference kept here would
/// go on writing to one nothing reads.
function gsHome(c) {
  const d = state.stretchDraft;
  if (!d) return null;
  if (c.at === 's') return d;
  if (c.at === 'g') return state.grainDraft || null;
  return d[{ w: 'wsola', v: 'vocoder', p: 'pvsola', h: 'hybrid' }[c.at]] || null;
}

/// A control's value as the bar shows it: a number, 0 or 1 for a switch, an
/// index for a choice.
function gsRead(k) {
  const c = GS_C[k], home = gsHome(c);
  if (!home) return c.d;
  const v = home[c.key];
  if (c.sw) return v ? 1 : 0;
  if (c.seg) return Math.max(0, c.vals.indexOf(v));
  return Number.isFinite(v) ? v : c.d;
}

function gsWrite(k, v) {
  const c = GS_C[k], home = gsHome(c);
  if (!home) return;
  home[c.key] = c.sw ? !!v : c.seg ? c.vals[v] : v;
  GS.touched = true;
  // The tray's own row, where it has one that can be told.
  if (c.at === 's') state.stretchRows?.[k]?.sync?.(v);
  if (c.at === 'g') state.grainRows?.[k]?.sync?.(c.sw ? !!v : v);
}

/// Send a control's draft by the route the tray uses for it.
function gsSend(c, live) {
  if (live) GS.lastPreview = performance.now();
  if (c.at === 'g') { if (live) state.grainSend?.preview(); else state.grainSend?.commit(); }
  else if (live) previewStretch();
  else commitStretch();
}

/// Commit on release, after any preview still waiting in the tray's throttle:
/// a preview landing after the commit would leave the document at draft quality.
function gsCommit(c) {
  const wait = Math.max(0, 95 - (performance.now() - GS.lastPreview));
  if (wait) setTimeout(() => gsSend(c, false), wait);
  else gsSend(c, false);
}

/// Everything in one edit: a randomize, an A/B swap, a reset. One undo step.
async function gsPostAll(extra = {}) {
  const d = state.stretchDraft;
  if (!d || !state.grainDraft) return;
  GS.touched = true;
  await editOp({
    op: 'stretch', ratio: d.ratio, semitones: d.semitones, windowMs: d.windowMs, quality: d.quality,
    algorithm: d.algorithm, vocoder: d.vocoder, wsola: d.wsola, pvsola: d.pvsola, hybrid: d.hybrid,
    cloud: d.cloud, cloudMix: d.cloudMix, grain: state.grainDraft, ...extra,
  });
}

/// Rebuild the tray from the document, as a preset does, now that the page has
/// changed things it cannot reach row by row.
function gsRebuildTray() {
  stretchBuiltFor = null;
  grainBuiltFor = null;
  renderStretch();
  renderGrainParams();
  GS.touched = false;
}

// ──────────────────────────────────────────────────────────── small shared things

const GS_CV = {};
function gsCvs(root) {
  root.querySelectorAll('canvas[data-w][id]').forEach((el) => { if (GS_CV[el.id]?.el !== el) GS_CV[el.id] = wvCv(el); });
}

function gsSetH(id, h) {
  const el = document.getElementById(id);
  if (!el) return;
  h = Math.max(20, Math.round(h));
  if (+el.dataset.h !== h || !GS_CV[id]) { el.dataset.h = h; GS_CV[id] = wvCv(el); }
}

function gsTxt(id, s) {
  const el = document.getElementById(id);
  if (el && el.textContent !== s) el.textContent = s;
}

const gsSvgG = (inner, cls = 'gg') => `<svg class="${cls}" viewBox="0 0 64 48" aria-hidden="true">${inner}</svg>`;
const gsFmtS = (s) => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s');
const gsFacet = (k) => GG_FACET[k] || 'time';
const GS_PWR = '<svg viewBox="0 0 14 14"><path d="M7 1.5 V6.5 M3.9 3.7 A4.6 4.6 0 1 0 10.1 3.7"/></svg>';
const GS_START = '#8fe388';

/// The page's colours, read once from its own tokens on `#grainView`. The same
/// names Wave's drawing helpers ask for.
let gsColourCache = null;
function gsCl() {
  if (gsColourCache) return gsColourCache;
  const s = getComputedStyle($('grainView')), v = (k) => s.getPropertyValue(k).trim();
  gsColourCache = {
    wave: v('--gs-wave') || '#fff', bloom: v('--gs-bloom') || '205,225,255', acc: v('--gs-acc') || '#7cf0d0',
    on: v('--gs-on') || '#ffb547', track: v('--gs-track') || '#2a2e34',
    t: v('--gs-t') || '#e8eaee', t2: v('--gs-t2') || '#b9bec6', t3: v('--gs-t3') || '#858b94',
    glow: +v('--gs-glow') || 1.1,
    mono: v('--mono') || 'monospace', sans: v('--sans') || 'sans-serif',
  };
  return gsColourCache;
}

/// A label on a dark chip, so it reads over the wave.
function gsLbl(c, tx, x, y, col, bg = 'rgba(5,6,9,.78)', al = 'left') {
  const tw = c.measureText(tx).width, x0 = al === 'right' ? x - tw : x;
  c.fillStyle = bg;
  c.fillRect(x0 - 4, y - 9, tw + 8, 12);
  c.fillStyle = col;
  c.fillText(tx, x0, y);
}

/// Drag with pointer capture: the Wave page's, without its commit.
function gsDrag(el, move, down, up) {
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
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', u);
    el.addEventListener('pointercancel', u);
  });
}

// ──────────────────────────────────────────────────────────────── where the sound is

/// The open sound's length and rate, from the overview peaks.
function gsFile() {
  const o = state.overview;
  const sr = o?.sampleRate || state.view.sampleRate || 0;
  const frames = o?.frames || state.view.frames || 0;
  if (!sr || !frames) return null;
  return { sr, frames, len: frames / sr };
}

/// The loop in seconds: the selection, or the whole sound, as the transport has it.
function gsLoop() {
  const f = gsFile(), s = state.sel;
  if (!f) return { a: 0, b: 1 };
  if (s && s.end > s.start) return { a: s.start / f.sr, b: s.end / f.sr };
  return { a: 0, b: f.len };
}

const gsCue = () => { const f = gsFile(); return f ? (state.cue || 0) / f.sr : 0; };

/// Where a stretch-only position really reads, with Run on: Scan moves it, and
/// a negative Scan sweeps back from the end (`engine::brackets`).
function gsScanned(t) {
  const f = gsFile(), sc = gsRead('scan');
  if (!f || !GS.voice?.run || sc === 1 || Math.abs(sc) < 1e-3 || GS.engine === 'pvsola') return t;
  return sc > 0 ? t * sc : f.len + t * sc;
}

function gsHead() {
  const f = gsFile();
  if (!f) return 0;
  const note = gsNoteHead();
  if (note != null) return note;
  // In Poly, what the pictures follow is the note played last.
  const voices = gsPolyHeads();
  if (voices.length) return voices[voices.length - 1].src;
  if (!engine.playing) return gsCue();
  const h = gsScanned(sourceFrameNow() / f.sr);
  return Number.isFinite(h) ? h : gsCue();
}

/// Move the loop, by the route the lane's own drag takes.
function gsSetLoop(a, b) {
  const f = gsFile();
  if (!f) return;
  const lo = wvClamp(Math.min(a, b), 0, f.len), hi = wvClamp(Math.max(a, b), 0, f.len);
  state.sel = { start: Math.round(lo * f.sr), end: Math.round(Math.max(hi, Math.min(f.len, lo + 0.05)) * f.sr) };
  if ((state.cue || 0) < state.sel.start || (state.cue || 0) >= state.sel.end) setCue(state.sel.start);
  drawSelection();
  applyLoop();
}

function gsRegLabel() {
  const f = gsFile(), { a, b } = gsLoop();
  if (!f) return '';
  const near = (x, y) => Math.abs(x / f.sr - y) < 0.01;
  const r = (state.annotations?.regions || []).find((g) => near(g.start, a) && near(g.end, b));
  const whole = !(state.sel && state.sel.end > state.sel.start);
  return `${r ? r.label : whole ? 'Whole file' : 'Selection'} · ${a.toFixed(2)}–${b.toFixed(2)} s`;
}
