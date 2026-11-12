// ═══════════════════════════════════════════════ Chop: the cuts ══
//
// Recycle Reborn, ReCycle's slice editing and Ratchet's grid, on the selected
// sound. This file finds the cuts and edits them; `401-chop-sound.js` is what a
// slice sounds like; `402-chop-listen.js` measures the sound; `403-chop-view.js`
// draws it; `405-chop-panel.js` is the controls; `406-chop-page.js` wires the
// page. The design is in `docs/CHOP.md`.
//
//
// Recycle Reborn (github.com/rjvaleo/Recycle-Reborn, RJ's) finds the sounds in
// a file by the silences between them, plays each one, gives each an optional
// ReCycle-style ping-pong loop tail, and writes them out as 16-bit WAVs. Around
// that sit the two things RJ asked for from ReCycle and Ratchet:
//
// - **ReCycle:** a cut at every hit (Sensitivity), each slice running to the
//   next; cuts drawn as ▽ on a ruler over the main waveform, dragged, deleted
//   (drag off the ruler), locked (a locked cut survives cutting again) and
//   added with the pencil; slices muted; Preview of the slices at a tempo with
//   pitch and stretch; the Envelope, Transient and EQ rows.
// - **Ratchet:** a cut on every grid line (1 bar to 1/32, straight, dotted,
//   triplet) with Nudge and Shuffle; an S / E region dragged on the ruler; Gate,
//   Smooth, Rev; the chop filter with drive; the chop firing on every grid line
//   (Ratchet); A / B, presets, Init and the dice.
//
// **Carried over line for line:** `buildRms`, `detectSegs`, `getTailParams`,
// `buildPingPongTail` and the WAV encoder. The only change is that what they
// read from globals in the original (the sample rate, the file's length, its
// channels) they are now handed. `tests/ui/chop.spec.mjs` pins them to the
// original's own output on the same signal. With every setting at its start,
// a written slice is byte for byte what Recycle Reborn wrote.
//
// **What is this app's instead:**
// - the sound is the selected one, fetched from `/audio` (which hands back WAV
//   for every format, so the original's AIFF parser has no work to do here);
// - a plain slice plays through the engine, the way everything in this app
//   plays. What the engine cannot play — a slice with processing on, Preview,
//   Ratchet — is rendered here and played through Web Audio, with its own
//   playhead drawn on the lane;
// - Write slices puts them beside the sound, in `<name> slices/`, through
//   `/api/chop/save`, rather than downloading a ZIP, with a MIDI file and an
//   SFZ beside them if asked. They are in the library at once.
// - the Envelope, Transient, EQ and Filter rows are ours: textbook filters and
//   envelopes, not a decoding of ReCycle's or Ratchet's DSP (RJ agreed, 4 Nov
//   2026).
// - the slices go into the Region manager with To Regions.

const CHOP_COLORS = ['#00e5ff', '#ff2d6b', '#00ff99', '#ffaa00', '#c084fc', '#f97316', '#38bdf8', '#a3e635', '#fb7185', '#fde047', '#67e8f9', '#d946ef', '#4ade80', '#fb923c'];
const CHOP_FRAME = 512;

const chop = {
  path: '',            // the library path of the sound being chopped
  stem: 'sample',      // its name without the extension, for the slices' names
  rate: 1,
  len: 0,
  channels: [],        // Float32Array per channel
  mono: null,
  rms: null,
  region: { s: 0, e: 0 },  // S and E: what is cut, previewed and written
  slices: [],          // { s, e, locked, moved, muted, rev }
  current: -1,         // the slice picked or playing
  sel: new Set(),      // every slice picked (shift-click adds)
  tool: 'pointer',
  playing: null,       // engine: { kind, s, e, stopAt, timer }; web: { kind, src, t0, len, loop, at }
  loading: 0,          // serial, so a slow load cannot land over a newer one
};

// ------------------------------------------------- Recycle Reborn's own code

function chopBuildRms(data) {
  const frames = [];
  for (let i = 0; i < data.length; i += CHOP_FRAME) {
    let s = 0;
    const end = Math.min(i + CHOP_FRAME, data.length);
    for (let j = i; j < end; j++) s += data[j] * data[j];
    frames.push(Math.sqrt(s / (end - i)));
  }
  return frames;
}

function chopDetectSegs(rms, topDb, minDurMs, padMs, sampleRate, length) {
  const FRAME = CHOP_FRAME;
  const peak = Math.max(...rms) || 1e-10;
  const thresh = peak * Math.pow(10, -topDb / 20);
  const padF = Math.round((padMs / 1000) * sampleRate / FRAME);
  const minF = Math.round((minDurMs / 1000) * sampleRate / FRAME);
  const active = rms.map(v => v >= thresh);
  const raw = [];
  let in_ = false, st = 0;
  for (let i = 0; i < active.length; i++) {
    if (active[i] && !in_) { in_ = true; st = i; }
    if (!active[i] && in_) {
      in_ = false;
      const s = Math.max(0, st - padF), e = Math.min(active.length - 1, i + padF);
      if ((e - s) >= minF) raw.push([s * FRAME, e * FRAME]);
    }
  }
  if (in_) {
    const s = Math.max(0, st - padF), e = active.length - 1;
    if ((e - s) >= minF) raw.push([s * FRAME, Math.min(e * FRAME, length - 1)]);
  }
  const merged = [];
  for (const seg of raw) {
    if (merged.length && seg[0] <= merged[merged.length-1][1])
      merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], seg[1]);
    else merged.push([...seg]);
  }
  return merged;
}

// Single source of truth for tail viability.
//
// Rules:
//   1. Tail region ≤ 28% of slice (loopStart must be ≥ 2.5× tailLen away from start)
//   2. Tail region ≥ MIN_TAIL_SAMPLES (absolute floor — too short = audible stuttering)
//   3. Crossfade region ≤ ¼ of tail region (prevents xfade overrunning the loop)
//
// If the requested tail is too long for the slice, it is auto-clamped to the
// largest viable value. If even the minimum won't fit, it is not viable.
function chopGetTailParams(startSample, endSample, requestedTailMs, sr) {
  const sliceLen   = endSample - startSample;
  const sliceDurMs = sliceLen / sr * 1000;

  // Rule 1: tail must leave at least 2.5× its own length as body before the loop
  // → maxTailLen = sliceLen / 3.5  (body = 2.5 parts, tail = 1 part)
  const MIN_TAIL_SAMPLES = Math.ceil(sr * 0.010); // 10 ms absolute floor
  const maxTailLen       = Math.floor(sliceLen / 3.5);

  if (maxTailLen < MIN_TAIL_SAMPLES) {
    return { viable: false, reason: `slice too short (${sliceDurMs.toFixed(0)}ms — need ≥${(MIN_TAIL_SAMPLES * 3.5 / sr * 1000).toFixed(0)}ms)` };
  }

  const requestedLen = Math.floor(requestedTailMs / 1000 * sr);
  const tailLen      = Math.min(requestedLen, maxTailLen);
  const clamped      = tailLen < requestedLen;
  const actualMs     = tailLen / sr * 1000;

  // Rule 3: xfade ≤ ¼ tailLen, also ≤ 128 samples (3ms @ 44.1k) — audibly transparent
  const xfLen    = Math.min(128, Math.floor(tailLen / 4));
  const loopStart = sliceLen - tailLen;

  // Auto cycles: enough ping-pong to cover ~500ms of tail, clamped 2–8
  const numCycles   = Math.max(2, Math.min(8, Math.ceil(500 / actualMs)));
  const totalFrames = sliceLen + numCycles * tailLen;

  return { viable: true, tailLen, actualMs, requestedTailMs, clamped, loopStart, numCycles, xfLen, totalFrames, sliceLen };
}

function chopBuildPingPongTail(channels, startSample, endSample, requestedTailMs, sr) {
  const ch  = channels.length;
  const p   = chopGetTailParams(startSample, endSample, requestedTailMs, sr);

  if (!p.viable) throw new Error(`tail not viable: ${p.reason}`);

  const { tailLen, loopStart, numCycles, xfLen, totalFrames, sliceLen } = p;

  const outChannels = [];
  for (let c = 0; c < ch; c++) {
    const src = channels[c];
    const out = new Float32Array(totalFrames);

    // 1. copy full slice body
    for (let i = 0; i < sliceLen; i++) out[i] = src[startSample + i];

    // 2. cosine crossfade at the loop join point — blends the natural slice
    //    end toward the loop-start value so the first ping-pong cycle starts
    //    with no discontinuity.
    for (let i = 0; i < xfLen; i++) {
      const t         = i / xfLen;
      const fade      = 0.5 - 0.5 * Math.cos(Math.PI * t); // cosine 0→1
      const joinIdx   = loopStart + i;
      const loopVal   = src[startSample + loopStart];
      out[joinIdx]    = out[joinIdx] * (1 - fade) + loopVal * fade;
    }

    // 3. ping-pong cycles — each cycle reads the loop region forward or
    //    reversed, with a global cosine amplitude taper from 1 → 0.
    for (let cycle = 0; cycle < numCycles; cycle++) {
      const forward      = cycle % 2 === 0;
      const cycleOffset  = sliceLen + cycle * tailLen;

      for (let i = 0; i < tailLen; i++) {
        const srcI       = forward ? loopStart + i : loopStart + (tailLen - 1 - i);
        const globalProg = (cycle * tailLen + i) / (numCycles * tailLen); // 0→1
        const amp        = Math.cos(globalProg * Math.PI / 2);             // 1→0
        out[cycleOffset + i] = src[startSample + srcI] * amp;
      }
    }

    outChannels.push(out);
  }

  // interleave channels
  const interleaved = new Float32Array(totalFrames * ch);
  for (let f = 0; f < totalFrames; f++)
    for (let c = 0; c < ch; c++)
      interleaved[f * ch + c] = outChannels[c][f];

  return { interleaved, totalFrames, ch, sr, params: p };
}

function chopWriteString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function chopEncodeWAVFromInterleaved(interleaved, numFrames, ch, sr) {
  const blockAlign = ch * 2;
  const dataBytes  = numFrames * blockAlign;
  const buf        = new ArrayBuffer(44 + dataBytes);
  const view       = new DataView(buf);

  chopWriteString(view, 0,  'RIFF');
  view.setUint32(4,  36 + dataBytes,  true);
  chopWriteString(view, 8,  'WAVE');
  chopWriteString(view, 12, 'fmt ');
  view.setUint32(16, 16,              true);
  view.setUint16(20, 1,               true); // PCM
  view.setUint16(22, ch,              true);
  view.setUint32(24, sr,              true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign,      true);
  view.setUint16(34, 16,              true); // bps
  chopWriteString(view, 36, 'data');
  view.setUint32(40, dataBytes,       true);

  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
    offset += 2;
  }
  return buf;
}

function chopEncodeWAV(channels, startSample, endSample, sr) {
  // plain slice, no tail
  const ch        = channels.length;
  const numFrames = endSample - startSample;
  const interleaved = new Float32Array(numFrames * ch);
  for (let f = 0; f < numFrames; f++)
    for (let c = 0; c < ch; c++)
      interleaved[f * ch + c] = channels[c][startSample + f];
  return chopEncodeWAVFromInterleaved(interleaved, numFrames, ch, sr);
}

/// The dock tab calls this when it opens the panel.
function chopDraw() { chopPaintLane(); }

// ------------------------------------------------------------- settings
//
// Everything a knob or a pill sets. Two slots, A and B, so two settings can be
// flipped between and compared, as Ratchet does; the one in use is `cp`. Kept
// in the browser between sessions, with the named presets beside them.

const CHOP_DEF = Object.freeze({
  mode: 'transient', sens: 60, topDb: 40, minDur: 40, pad: 12,
  div: '8', feel: 'straight', nudge: 0, shuffle: 50,
  gate: 100, smooth: 0, tail: false, tailMs: 80,
  bars: 1, beats: 0, sig: 4, tempo: 0, pitch: 0, stretch: 0, sync: 'free',
  envOn: false, attack: 0, decay: 5000,
  trOn: false, trThresh: -30, trAmount: 0, trAttack: 20, trRelease: 100, trGain: 0,
  eqOn: false, loCut: 15, lowF: 100, lowG: 0, lowQ: 1, highF: 2500, highG: 0, highQ: 1, hiCut: 20000,
  fltOn: false, fltType: 'lp', fltFreq: 1000, fltQ: 0.7, drive: 0, gain: 0, mix: 100,
  outMidi: false, outSfz: false,
});

/// What moving it means: the cut found again, or only the sound of the slices.
const CHOP_RECUT = new Set(['mode', 'sens', 'topDb', 'minDur', 'pad', 'div', 'feel', 'nudge', 'shuffle', 'bars', 'beats', 'sig']);

const chopSlots = { a: { ...CHOP_DEF }, b: { ...CHOP_DEF }, which: 'a' };
let cp = chopSlots.a;

function chopLoadSettings() {
  try {
    const got = JSON.parse(localStorage.getItem('chopSettings') || 'null');
    if (got && got.a && got.b) {
      chopSlots.a = { ...CHOP_DEF, ...got.a };
      chopSlots.b = { ...CHOP_DEF, ...got.b };
      chopSlots.which = got.which === 'b' ? 'b' : 'a';
    }
  } catch { /* private mode, or nothing kept yet */ }
  cp = chopSlots[chopSlots.which];
}

function chopSaveSettings() {
  try { localStorage.setItem('chopSettings', JSON.stringify(chopSlots)); } catch { /* private mode */ }
}

/// The preset bar (`405b-chop-presets.js`), and the preset it has loaded.
let chopPb = null;
let chopPresetName = '';

function chopPresets() {
  try { return JSON.parse(localStorage.getItem('chopPresets') || '[]'); } catch { return []; }
}

// ------------------------------------------------------------- the sound

const chopActive = () => typeof state !== 'undefined' && state.mode === 'edit'
  && !$('dockChop').classList.contains('hidden') && $('dockChop').getClientRects().length > 0;

/// The slices are shown on the Chop page only, and only over the sound they
/// were cut from.
const chopShown = () => chopActive() && !!chop.mono
  && (!state.selectedFile || !chop.path || chop.path === state.selectedFile.path);

/// Softened: the whole overlay see-through, so the waveform comes forward. The
/// switch is on the ruler; its wheel sets how see-through. Kept between sessions.
const chopSoft = { on: false, alpha: 0.3 };
try {
  const got = JSON.parse(localStorage.getItem('chopSoft') || 'null');
  if (got) { chopSoft.on = !!got.on; chopSoft.alpha = Math.min(0.9, Math.max(0.05, +got.alpha || 0.3)); }
} catch { /* private mode */ }
function chopSetSoft(change) {
  Object.assign(chopSoft, change);
  chopSoft.alpha = Math.min(0.9, Math.max(0.05, chopSoft.alpha));
  try { localStorage.setItem('chopSoft', JSON.stringify(chopSoft)); } catch { /* private mode */ }
  chopPaintLane();
}

/// Called when a sound is selected, and when the panel is opened. Only does
/// the work while the panel is showing: decoding a long file nobody is
/// chopping is wasted.
function chopSelected(file) {
  chopPaintLane();
  if (!file || $('dockChop').classList.contains('hidden')) return;
  if (file.path === chop.path && chop.mono) return;
  chopLoad(file);
}

async function chopLoad(file) {
  const serial = ++chop.loading;
  chopSay(`Reading ${file.name || file.path}…`);
  let bytes;
  try {
    const r = await fetch(`/audio?p=${encodeURIComponent(file.path)}`);
    if (!r.ok) throw new Error(`${r.status}`);
    bytes = await r.arrayBuffer();
  } catch (e) {
    if (serial === chop.loading) chopSay('Could not read the sound');
    return;
  }
  // Decoded at the file's own rate, so the slices are its samples rather
  // than a resampling of them. `/audio` is always WAV, so the rate is at 24.
  const rate = new DataView(bytes).getUint32(24, true) || 44100;
  let buf;
  try {
    buf = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes);
  } catch (e) {
    if (serial === chop.loading) chopSay('Could not decode the sound');
    return;
  }
  if (serial !== chop.loading) return;
  const channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  chop.path = file.path;
  chopTake(channels, buf.sampleRate, (file.name || file.path.split('/').pop()).replace(/\.[^.]+$/, ''), { detect: true });
}

/// Take a sound's samples: mixed to mono for finding the cuts, kept per
/// channel for writing them. A new sound starts with S and E at its ends and
/// no hand edits.
function chopTake(channels, rate, stem, { detect = false } = {}) {
  chopStop();
  const len = channels[0] ? channels[0].length : 0;
  const mono = new Float32Array(len);
  for (const d of channels) for (let i = 0; i < len; i++) mono[i] += d[i] / channels.length;
  Object.assign(chop, { channels, rate, stem, mono, len, rms: chopBuildRms(mono),
    region: { s: 0, e: len }, slices: [], current: -1, sel: new Set(), an: null });
  chopView.a = 0;
  chopView.b = len;
  chopTempoSaid.text = '';
  chopSay('');
  chopRecut({ keep: false });
  chopAnalyse();
  if (detect) chopDetect();
}

// ------------------------------------------------------------- finding the cuts

/// The tempo the sound is at: S to E is `bars` bars and `beats` beats of
/// `sig`/4, as ReCycle asks for it.
function chopBpm() {
  const beats = cp.bars * cp.sig + cp.beats;
  const sec = (chop.region.e - chop.region.s) / chop.rate;
  return beats > 0 && sec > 0 ? (beats * 60) / sec : 120;
}

/// The tempo it plays at: the knob's, the sequencer's when locked, or its own.
function chopPlayBpm() {
  if (cp.sync === 'lock' && typeof seq !== 'undefined' && typeof seq.tempo === 'number' && seq.tempo > 0) return seq.tempo;
  return cp.tempo > 0 ? cp.tempo : chopBpm();
}

/// One grid step, in quarter-note beats.
function chopStepBeats() {
  const base = cp.div === 'bar' ? cp.sig : 4 / +cp.div;
  return base * (cp.feel === 'dot' ? 1.5 : cp.feel === 'trip' ? 2 / 3 : 1);
}

/// Where grid line `k` falls, in frames from S, at `bpm`: nudged, and every
/// second one swung late the way an MPC does it (50% straight, 66% a triplet).
function chopGridAt(k, stepF) {
  return (k + cp.nudge / 100) * stepF + (k % 2 ? ((cp.shuffle - 50) / 50) * stepF : 0);
}

function chopGridCuts() {
  const { s: S, e: E } = chop.region;
  const stepF = (chopStepBeats() * 60 / chopBpm()) * chop.rate;
  const cuts = [S];
  for (let k = 0; k < 100000; k++) {
    const at = Math.round(S + chopGridAt(k, stepF));
    if (at >= E) break;
    if (at > S) cuts.push(at);
  }
  return cuts;
}

/// A cut at every hit: the energy, pre-emphasised so a hit stands out from
/// the ring before it, jumping well above where it has been sitting. Higher
/// Sensitivity needs a smaller jump and hears quieter hits. Min length is the
/// least room between two cuts.
function chopOnsets() {
  const { mono, rate } = chop;
  const { s: S, e: E } = chop.region;
  const HOP = 256;
  const n = Math.floor((E - S) / HOP);
  if (n < 2) return [S];
  const db = new Float32Array(n);
  let prev = S > 0 ? mono[S - 1] : 0, peak = -240;
  for (let k = 0; k < n; k++) {
    let acc = 0;
    const a = S + k * HOP;
    for (let j = a; j < a + HOP; j++) { const d = mono[j] - 0.97 * prev; prev = mono[j]; acc += d * d; }
    db[k] = 10 * Math.log10(acc / HOP + 1e-12);
    if (db[k] > peak) peak = db[k];
  }
  const rise = 18 - 0.165 * cp.sens;
  const floor = peak - (24 + 0.36 * cp.sens);
  const gap = Math.max(1, Math.round((cp.minDur / 1000) * rate / HOP));
  const out = [];
  let last = -1e9;
  for (let k = 1; k < n; k++) {
    let base = 0, m = 0;
    for (let j = Math.max(0, k - 6); j < k; j++) { base += db[j]; m++; }
    base /= m;
    if (db[k] - base < rise || db[k] < floor || k - last < gap) continue;
    last = k;
    out.push(chopSnap(S + k * HOP, HOP));
  }
  // The start of the region is a cut too, if there is a sound before the first hit.
  if (!out.length) return [S];
  if (out[0] - S >= gap * HOP) {
    let loud = false;
    for (let k = 0; k < Math.floor((out[0] - S) / HOP); k++) if (db[k] >= floor) { loud = true; break; }
    if (loud) out.unshift(S);
  }
  return out;
}

/// The zero crossing nearest `at`, looking no further than `reach` frames back
/// (and a little forward), so a cut does not click.
function chopSnap(at, reach = Math.round(chop.rate * 0.002)) {
  const m = chop.mono;
  for (let d = 0; d <= reach; d++) {
    for (const i of [at - d, at + Math.min(d, 32)]) {
      if (i > 0 && i < m.length && (m[i - 1] <= 0) !== (m[i] <= 0)) return i;
    }
  }
  return at;
}

/// Cut the sound again from the settings. Locked and hand-moved cuts stay, and
/// a slice keeps its mute and reverse when one starts where it started.
function chopRecut({ keep = true } = {}) {
  if (!chop.mono) return;
  const { s: S, e: E } = chop.region;
  const old = chop.slices;
  const kept = keep ? old.filter((x) => (x.locked || x.moved) && x.s >= S && x.s < E) : [];
  const flags = new Map(old.map((x) => [x.s, x]));
  let slices;
  if (cp.mode === 'silence') {
    const segs = chopDetectSegs(chop.rms, cp.topDb, cp.minDur, cp.pad, chop.rate, chop.len)
      .map(([s, e]) => [Math.max(s, S), Math.min(e, E)])
      .filter(([s, e]) => e > s && !kept.some((k) => s < k.e && e > k.s));
    slices = [...segs.map(([s, e]) => ({ s, e })), ...kept.map((k) => ({ ...k, e: Math.min(k.e, E) }))]
      .sort((a, b) => a.s - b.s);
  } else {
    const near = Math.round(chop.rate * 0.01);
    const keptAt = new Map(kept.map((k) => [k.s, k]));
    let cuts = (cp.mode === 'grid' ? chopGridCuts() : chopOnsets())
      .filter((c) => ![...keptAt.keys()].some((k) => Math.abs(k - c) < near));
    cuts = [...new Set([...cuts, ...keptAt.keys()])].sort((a, b) => a - b);
    slices = cuts.map((c, i) => {
      const k = keptAt.get(c);
      return { s: c, e: i + 1 < cuts.length ? cuts[i + 1] : E, locked: !!k?.locked, moved: !!k?.moved };
    });
  }
  for (const x of slices) {
    const f = flags.get(x.s);
    if (f) { x.muted = !!f.muted; x.rev = !!f.rev; }
  }
  chop.slices = slices;
  chop.sel = new Set([...chop.sel].filter((i) => i < slices.length));
  if (chop.current >= slices.length) chop.current = -1;
  chopChanged();
}

/// Everything that shows the slices, after they changed.
function chopChanged() {
  chopMeasureSlices();
  chopPaintLane();
  chopTable();
  chopStats();
  chopTailUI();
  chopLegend();
  chopDrawPictures();
}

// ------------------------------------------------------------- editing

const chopContig = () => cp.mode !== 'silence';
const chopMinGap = () => Math.max(16, Math.round(chop.rate * 0.005));

/// Move one edge: the start or end of slice `i`. Between two slices that
/// touch, the edge is both, so the slice before follows.
function chopMoveEdge(i, side, to) {
  const x = chop.slices[i];
  if (!x) return;
  const g = chopMinGap();
  const { s: S, e: E } = chop.region;
  if (side === 's') {
    const lo = i > 0 ? chop.slices[i - 1].s + g : S;
    const hi = x.e - g;
    x.s = Math.max(lo, Math.min(hi, to));
    if (i > 0 && (chopContig() || chop.slices[i - 1].e > x.s)) chop.slices[i - 1].e = x.s;
  } else {
    const lo = x.s + g;
    const hi = i + 1 < chop.slices.length ? (chopContig() ? chop.slices[i + 1].e - g : chop.slices[i + 1].s) : E;
    x.e = Math.max(lo, Math.min(hi, to));
    if (chopContig() && i + 1 < chop.slices.length) chop.slices[i + 1].s = x.e;
  }
  x.moved = true;
  if (chopContig() && side === 'e' && chop.slices[i + 1]) chop.slices[i + 1].moved = true;
}

/// Take out the cut at the start of slice `i`. Between slices that touch, the
/// slice joins the one before; otherwise it goes.
function chopDeleteCut(i) {
  if (!chop.slices[i]) return;
  if (chopContig() && i > 0) chop.slices[i - 1].e = chop.slices[i].e;
  chop.slices.splice(i, 1);
  chop.sel = new Set();
  chop.current = -1;
  chopChanged();
}

/// The pencil: a new cut at `at`. Inside a slice it splits it; in a gap
/// between silences it starts a slice that runs to the next one, or 100 ms.
function chopAddCut(at) {
  const { s: S, e: E } = chop.region;
  if (at <= S || at >= E) return;
  at = chopSnap(at);
  const g = chopMinGap();
  const i = chop.slices.findIndex((x) => at > x.s && at < x.e);
  if (i >= 0) {
    const x = chop.slices[i];
    if (at - x.s < g || x.e - at < g) return;
    chop.slices.splice(i + 1, 0, { s: at, e: x.e, moved: true, muted: x.muted, rev: x.rev });
    x.e = at;
  } else {
    if (chopContig() && !chop.slices.length) chop.slices.push({ s: S, e: E });
    const next = chop.slices.find((x) => x.s > at);
    const e = next ? next.s : Math.min(E, at + Math.round(chop.rate * 0.1));
    if (e - at < g) return;
    chop.slices.push({ s: at, e, moved: true });
    chop.slices.sort((a, b) => a.s - b.s);
    if (chopContig()) chop.slices.forEach((x, j) => { if (j > 0) chop.slices[j - 1].e = x.s; });
  }
  chopChanged();
}

function chopPick(i, { add = false } = {}) {
  if (add) {
    if (chop.sel.has(i)) chop.sel.delete(i); else chop.sel.add(i);
  } else {
    chop.sel = new Set(i >= 0 ? [i] : []);
  }
  chop.current = i;
  document.querySelectorAll('#chopList .chop-row').forEach((r) => {
    r.classList.toggle('current', +r.dataset.i === i);
    r.classList.toggle('picked', chop.sel.has(+r.dataset.i));
  });
  const row = document.querySelector(`#chopList .chop-row[data-i="${i}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
  chopPaintLane();
  chopDrawPictures();
}

/// The slices picked, or the one under the cursor when none are.
const chopPicked = () => (chop.sel.size ? [...chop.sel] : chop.current >= 0 ? [chop.current] : []);

function chopToggle(flag) {
  const which = chopPicked();
  if (!which.length) { chopSay('Pick a slice first (shift-click for more)'); return; }
  const on = !which.every((i) => chop.slices[i]?.[flag]);
  for (const i of which) if (chop.slices[i]) chop.slices[i][flag] = on;
  chopChanged();
}
