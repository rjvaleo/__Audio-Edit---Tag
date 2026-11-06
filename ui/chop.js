// Chop: Recycle Reborn, ReCycle's slice editing and Ratchet's grid, on the
// selected sound.
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
// **The slices are on the main waveform**, not a second one: an overlay on the
// lane, placed with the lane's own `framesToX`, so it zooms and scrolls with
// everything else there. This panel holds only the controls and the list.
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
// - the slices show on every page with the waveform, softened or not (the ◐
//   on the ruler), and go into the Region manager with To regions.

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

function chopPresets() {
  try { return JSON.parse(localStorage.getItem('chopPresets') || '[]'); } catch { return []; }
}

// ------------------------------------------------------------- the sound

const chopActive = () => typeof state !== 'undefined' && state.mode === 'edit'
  && !$('dockChop').classList.contains('hidden') && $('dockChop').getClientRects().length > 0;

/// The slices are shown on every page with the waveform, not only Chop's: on
/// the others they are a picture to work by, not something to edit, so the
/// lane's own selecting is untouched there. Only ever over the sound they were
/// cut from.
const chopShown = () => typeof state !== 'undefined' && state.mode === 'edit' && !!chop.mono
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
  chopTake(channels, buf.sampleRate, (file.name || file.path.split('/').pop()).replace(/\.[^.]+$/, ''));
}

/// Take a sound's samples: mixed to mono for finding the cuts, kept per
/// channel for writing them. A new sound starts with S and E at its ends and
/// no hand edits.
function chopTake(channels, rate, stem) {
  chopStop();
  const len = channels[0] ? channels[0].length : 0;
  const mono = new Float32Array(len);
  for (const d of channels) for (let i = 0; i < len; i++) mono[i] += d[i] / channels.length;
  Object.assign(chop, { channels, rate, stem, mono, len, rms: chopBuildRms(mono),
    region: { s: 0, e: len }, slices: [], current: -1, sel: new Set() });
  chopSay('');
  chopRecut({ keep: false });
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
  chopPaintLane();
  chopTable();
  chopStats();
  chopTailUI();
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

// ------------------------------------------------------------- the main waveform
//
// The overlay on the lane: a wash per slice with its number, an edge you can
// drag at every cut, S / E and the ▽ cuts on a ruler along the top, the grid
// as ticks along the bottom, the threshold in Silence mode, and a playhead
// while something rendered here is playing.

let chopLayer = null;
let chopSeen = '';   // the lane's place and size when it was last painted
const chopLaneKey = () => `${state.view.from}|${state.view.to}|${$('lane').clientWidth}|${$('lane').clientHeight}`;

function chopLaneFrame(clientX) {
  const r = $('lane').getBoundingClientRect();
  const f = xToFrames(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  return Math.max(0, Math.min(chop.len, f));
}

function chopPaintLane() {
  if (!chopLayer) return;
  const on = chopShown();
  chopLayer.classList.toggle('hidden', !on);
  chopLayer.classList.toggle('passive', !chopActive());
  chopLayer.classList.toggle('soft', chopSoft.on);
  chopLayer.style.setProperty('--chop-soft', String(chopSoft.alpha));
  document.body.classList.toggle('chopping', on && chopActive());
  if (!on) return;
  chopSeen = chopLaneKey();
  const pct = (f) => `${(framesToX(f) * 100).toFixed(3)}%`;
  const { s: S, e: E } = chop.region;
  const parts = [];
  parts.push(`<div class="chop-out" style="left:0;width:${pct(S)}"></div>`,
             `<div class="chop-out" style="left:${pct(E)};right:0"></div>`);

  // The threshold, where Silence mode makes its cut, on every channel.
  if (cp.mode === 'silence') {
    const amp = (Math.max(...chop.rms) || 0) * Math.pow(10, -cp.topDb / 20);
    const nch = state.peaks?.channels?.length || 1;
    const waveH = ($('waveCanvas').clientHeight || chopLayer.clientHeight) / chopLayer.clientHeight * 100;
    for (let c = 0; c < nch; c++) {
      const mid = ((c + 0.5) / nch) * waveH, half = (0.5 / nch) * waveH * 0.92;
      for (const y of [mid - amp * half, mid + amp * half]) parts.push(`<div class="chop-thr" style="top:${y.toFixed(2)}%"></div>`);
    }
  }

  // The grid, while cutting on it.
  if (cp.mode === 'grid') {
    const stepF = (chopStepBeats() * 60 / chopBpm()) * chop.rate;
    const { from, to } = state.view;
    if ((to - from) / stepF < 2000) {
      let t = '<div class="chop-ticks">';
      for (let k = 0; k < 100000; k++) {
        const at = S + chopGridAt(k, stepF);
        if (at >= E) break;
        if (at >= from && at <= to) t += `<i style="left:${pct(at)}"></i>`;
      }
      parts.push(t + '</div>');
    }
  }

  chop.slices.forEach((x, i) => {
    const col = CHOP_COLORS[i % CHOP_COLORS.length];
    if (x.e < state.view.from || x.s > state.view.to) return;
    const cls = ['chop-slice', i === chop.current && 'current', chop.sel.has(i) && 'picked', x.muted && 'muted', x.rev && 'rev'].filter(Boolean).join(' ');
    parts.push(`<div class="${cls}" data-i="${i}" style="left:${pct(x.s)};width:calc(${pct(x.e)} - ${pct(x.s)});color:${col}">`
      + `<i class="chop-wash"></i><span class="chop-tag" style="background:${col}">${i + 1}${x.rev ? ' ◄' : ''}</span>`
      + `<i class="chop-edge" data-i="${i}" data-side="s"></i>`
      + (chopContig() ? '' : `<i class="chop-edge end" data-i="${i}" data-side="e"></i>`)
      + '</div>');
  });

  // The ruler: bars when the tempo is known, ▽ at every cut, S and E.
  let ruler = '<div class="chop-ruler" title="Drag S or E to set what is chopped · drag between them to move it · double-click for the whole sound">';
  const bpm = chopBpm(), barF = (cp.sig * 60 / bpm) * chop.rate;
  const { from, to } = state.view;
  if ((to - from) / barF < 400) {
    for (let b = 0; S + b * barF < E; b++) {
      const at = S + b * barF;
      if (at >= from && at <= to) ruler += `<span class="chop-bar" style="left:${pct(at)}">${b + 1}</span>`;
    }
  }
  chop.slices.forEach((x, i) => {
    if (x.s < from || x.s > to) return;
    ruler += `<i class="chop-cut${x.locked ? ' locked' : ''}" data-i="${i}" style="left:${pct(x.s)};color:${CHOP_COLORS[i % CHOP_COLORS.length]}" title="Cut ${i + 1}${x.locked ? ' (locked)' : ''}: drag to move, drag off the ruler to delete"></i>`;
  });
  ruler += `<span class="chop-flag s" data-flag="s" style="left:${pct(S)}">S</span><span class="chop-flag e" data-flag="e" style="left:${pct(E)}">E</span>`;
  ruler += '</div>';
  parts.push(ruler);
  parts.push(`<button type="button" class="chop-soft${chopSoft.on ? ' on' : ''}" title="Soften the slices: see-through, so the waveform comes forward (${Math.round(chopSoft.alpha * 100)}%). The wheel over it sets how much">◐ ${chopSoft.on ? `${Math.round(chopSoft.alpha * 100)}%` : 'soften'}</button>`);
  if (chopActive()) parts.push('<div class="chop-hint">drag S / E — chop region · drag between = move · double-click = whole sound · drag ▽ = move a cut, off the ruler = delete</div>');
  parts.push('<div class="chop-ph hidden"></div><div class="chop-readout hidden"></div>');
  chopLayer.innerHTML = parts.join('');
  chopPaintPlay();
}

/// The playhead of what plays here, in the sound's frames.
function chopPaintPlay() {
  const ph = chopLayer?.querySelector('.chop-ph');
  if (!ph) return;
  const at = chopPlayhead();
  ph.classList.toggle('hidden', at < 0);
  if (at >= 0) ph.style.left = `${(framesToX(at) * 100).toFixed(3)}%`;
}

function chopReadout(x, text) {
  const el = chopLayer?.querySelector('.chop-readout');
  if (!el) return;
  el.classList.toggle('hidden', !text);
  el.textContent = text || '';
  el.style.left = `${(framesToX(x) * 100).toFixed(3)}%`;
}

function chopWireLane() {
  const lane = $('lane');
  chopLayer = document.createElement('div');
  chopLayer.className = 'chop-layer hidden';
  lane.append(chopLayer);

  // The pencil works anywhere on the lane, so it is caught before the lane's
  // own selecting sees the press.
  lane.addEventListener('mousedown', (e) => {
    if (!chopActive() || !chop.mono || chop.tool !== 'pencil' || e.button !== 0) return;
    if (e.target.closest('.chop-ruler')) return;
    e.stopPropagation();
    e.preventDefault();
    chopAddCut(chopLaneFrame(e.clientX));
  }, true);

  chopLayer.addEventListener('mousedown', (e) => {
    if (!chop.mono || e.button !== 0) return;
    if (e.target.closest('.chop-soft')) { e.stopPropagation(); e.preventDefault(); chopSetSoft({ on: !chopSoft.on }); return; }
    if (!chopActive()) return;
    const edge = e.target.closest('.chop-edge, .chop-cut');
    const flag = e.target.closest('.chop-flag');
    const slice = e.target.closest('.chop-slice');
    const ruler = e.target.closest('.chop-ruler');
    if (!edge && !flag && !slice && !ruler) return;
    e.stopPropagation();
    e.preventDefault();
    if (edge) return chopDragEdge(e, +edge.dataset.i, edge.dataset.side || 's', edge.classList.contains('chop-cut'));
    if (flag) return chopDragRegion(e, flag.dataset.flag);
    if (ruler) {
      const at = chopLaneFrame(e.clientX);
      if (at > chop.region.s && at < chop.region.e) chopDragRegion(e, 'both');
      return;
    }
    const i = +slice.dataset.i;
    if (chop.tool === 'audition') { chopPlay(i, { pick: false }); return; }
    if (chop.tool === 'lock') { chop.slices[i].locked = !chop.slices[i].locked; chopChanged(); return; }
    chopPick(i, { add: e.shiftKey });
    if (!e.shiftKey) chopPlay(i);
  });

  chopLayer.addEventListener('wheel', (e) => {
    if (!e.target.closest('.chop-soft')) return;
    e.preventDefault();
    chopSetSoft({ on: true, alpha: chopSoft.alpha - Math.sign(e.deltaY) * 0.05 });
  }, { passive: false });

  chopLayer.addEventListener('dblclick', (e) => {
    if (!chopActive() || !e.target.closest('.chop-ruler')) return;
    e.stopPropagation();
    chop.region = { s: 0, e: chop.len };
    chopRecut();
  });

  // Delete takes out the picked cut, on the Chop page only, and only when no
  // field has the keys.
  window.addEventListener('keydown', (e) => {
    if (!chopActive() || chop.current < 0 || !(e.key === 'Delete' || e.key === 'Backspace')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    chopDeleteCut(chop.current);
  }, true);

  // The lane moves (zoom, scroll, follow, a resize) without saying so to
  // anything outside it; looking once a frame is cheaper than every caller
  // remembering to.
  const watch = () => {
    requestAnimationFrame(watch);
    if (!chopShown()) {
      if (!chopLayer.classList.contains('hidden')) chopPaintLane();
      return;
    }
    if (chopLayer.classList.contains('passive') === chopActive()) chopPaintLane();
    if (chopLaneKey() !== chopSeen || chopLayer.classList.contains('hidden')) chopPaintLane();
    if (chop.playing) chopPaintPlay();
  };
  requestAnimationFrame(watch);
}

/// Drag a cut. Off the ruler, by more than its height, it goes when let go;
/// the lock tool locks it instead of dragging. ⌥ turns the zero-crossing snap off.
function chopDragEdge(e, i, side, fromRuler) {
  if (chop.tool === 'lock') { chop.slices[i].locked = !chop.slices[i].locked; chopChanged(); return; }
  const top = chopLayer.getBoundingClientRect().top;
  let away = false, moved = false;
  const move = (ev) => {
    moved = true;
    const raw = chopLaneFrame(ev.clientX);
    chopMoveEdge(i, side, ev.altKey ? raw : chopSnap(raw));
    away = fromRuler && (ev.clientY < top - 24 || ev.clientY > top + 48);
    chopPaintLane();
    const x = chop.slices[i];
    chopLayer.querySelector(`.chop-cut[data-i="${i}"]`)?.classList.toggle('going', away);
    chopReadout(side === 's' ? x.s : x.e, away ? 'let go to delete'
      : `${side === 's' ? 'start' : 'end'} ${((side === 's' ? x.s : x.e) / chop.rate).toFixed(3)} s · ${((x.e - x.s) / chop.rate * 1000).toFixed(0)} ms`);
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (away) { chopDeleteCut(i); return; }
    if (moved) chopChanged(); else chopPick(i);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/// Drag S, E, or the region between them; let go and it is cut again.
function chopDragRegion(e, which) {
  const g = chopMinGap();
  const start = chopLaneFrame(e.clientX);
  const r0 = { ...chop.region };
  const move = (ev) => {
    const at = chopLaneFrame(ev.clientX);
    if (which === 's') chop.region.s = Math.max(0, Math.min(chop.region.e - g, at));
    else if (which === 'e') chop.region.e = Math.min(chop.len, Math.max(chop.region.s + g, at));
    else {
      const d = Math.max(-r0.s, Math.min(chop.len - r0.e, at - start));
      chop.region = { s: r0.s + d, e: r0.e + d };
    }
    chopPaintLane();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (chop.region.s !== r0.s || chop.region.e !== r0.e) chopRecut();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ------------------------------------------------------------- the panel

function chopTable() {
  const list = $('chopList');
  list.replaceChildren();
  if (!chop.mono) return;
  const N = chop.mono.length;
  let peakAbs = 0;
  for (let i = 0; i < N; i += 64) if (Math.abs(chop.mono[i]) > peakAbs) peakAbs = Math.abs(chop.mono[i]);
  peakAbs = peakAbs || 1;

  chop.slices.forEach(({ s, e, muted, rev, locked }, i) => {
    let pk = 0;
    for (let j = s; j < e; j += Math.max(1, Math.floor((e - s) / 1000))) if (Math.abs(chop.mono[j]) > pk) pk = Math.abs(chop.mono[j]);
    const pkDb = 20 * Math.log10(pk / peakAbs + 1e-10);
    const row = document.createElement('div');
    row.className = 'chop-row' + (i === chop.current ? ' current' : '') + (chop.sel.has(i) ? ' picked' : '') + (muted ? ' muted' : '');
    row.dataset.i = i;
    const dot = document.createElement('i');
    dot.className = 'chop-dot';
    dot.style.background = CHOP_COLORS[i % CHOP_COLORS.length];
    const cell = (cls, text) => { const c = document.createElement('span'); c.className = cls; c.textContent = text; return c; };
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'chop-play';
    play.textContent = '▶';
    play.title = 'Play this slice';
    play.onclick = (ev) => { ev.stopPropagation(); chopPlay(i); };
    row.append(cell('chop-idx', String(i + 1)), dot,
      cell('chop-name', chopName(i)),
      cell('chop-flags', `${locked ? '🔒' : ''}${rev ? '◄' : ''}${muted ? 'M' : ''}`),
      cell('chop-num', `${(s / chop.rate).toFixed(3)}s`),
      cell('chop-num', `${((e - s) / chop.rate * 1000).toFixed(0)}ms`),
      cell('chop-num', `${pkDb.toFixed(1)}dB`),
      cell('tail-badge', ''), play);
    row.onclick = (ev) => chopPick(i, { add: ev.shiftKey });
    list.append(row);
  });
}

const chopName = (i) => `${chop.stem}_${String(i + 1).padStart(4, '0')}.wav`;

function chopStats() {
  if (!chop.mono) return;
  const dur = chop.len / chop.rate;
  const total = chop.slices.reduce((a, { s, e }) => a + (e - s), 0) / chop.rate;
  const avg = chop.slices.length ? total / chop.slices.length : 0;
  const set = (k, v) => { document.querySelector(`#dockChop .chop-stat[data-k="${k}"] b`).textContent = v; };
  set('clips', String(chop.slices.length));
  set('ratio', `${Math.round(total / dur * 100)}%`);
  set('avg', `${(avg * 1000).toFixed(0)} ms`);
  set('dur', `${dur.toFixed(2)} s`);
  $('chopWrite').disabled = !chop.slices.some((x) => !x.muted) || !chop.path;
  const moved = chop.slices.filter((x) => x.moved).length, locked = chop.slices.filter((x) => x.locked).length;
  $('chopEdited').textContent = [moved && `${moved} moved`, locked && `${locked} locked`].filter(Boolean).join(' · ');
  const bpm = chopPlayBpm();
  const step = chopStepBeats() * 60 / bpm;
  const divName = cp.div === 'bar' ? '1 bar' : `1/${cp.div}`;
  $('chopStatus').textContent = `${divName}${cp.feel === 'dot' ? ' dotted' : cp.feel === 'trip' ? ' triplet' : ''} · ${bpm.toFixed(1)} BPM`
    + (Math.abs(bpm - chopBpm()) > 0.05 ? ` (from ${chopBpm().toFixed(1)})` : '') + ` · chop every ${step.toFixed(3)} s`;
}

/// The tail's badge on every row, and its summary: what each slice will get.
function chopTailUI() {
  const on = cp.tail;
  const requestedMs = cp.tailMs;
  let eligible = 0, skipped = 0;
  document.querySelectorAll('#chopList .chop-row').forEach((row) => {
    const badge = row.querySelector('.tail-badge');
    const x = chop.slices[+row.dataset.i];
    const s = x.s, e = x.s + Math.max(1, Math.round((x.e - x.s) * cp.gate / 100));
    badge.title = '';
    if (!on) { badge.className = 'tail-badge'; badge.textContent = ''; return; }
    const p = chopGetTailParams(s, e, requestedMs, chop.rate);
    if (!p.viable) {
      badge.className = 'tail-badge skip';
      badge.textContent = 'too short';
      badge.title = p.reason;
      skipped++;
    } else if (p.clamped) {
      badge.className = 'tail-badge clamped';
      badge.textContent = `tail ↓${p.actualMs.toFixed(0)}ms`;
      badge.title = `requested ${requestedMs}ms clamped to ${p.actualMs.toFixed(0)}ms`;
      eligible++;
    } else {
      badge.className = 'tail-badge ok';
      badge.textContent = `tail ${p.actualMs.toFixed(0)}ms`;
      badge.title = `${p.numCycles} cycles · ~${(p.numCycles * p.actualMs / 1000).toFixed(2)}s`;
      eligible++;
    }
  });
  const parts = [];
  if (on && eligible) parts.push(`${eligible} eligible`);
  if (on && skipped) parts.push(`${skipped} too short`);
  const cyc = document.querySelector('#chopKnobs .chop-cycles');
  if (cyc) cyc.textContent = on ? parts.join(' · ') : `${Math.max(2, Math.min(8, Math.ceil(500 / requestedMs)))} cycles`;
}

function chopSay(text) {
  const el = document.querySelector('#dockChop .chop-said');
  if (el) el.textContent = text;
}

// ------------------------------------------------------------- the knobs

const chopFmt = {
  int: (v) => `${Math.round(v)}`,
  db: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  ms: (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`,
  pct: (v) => `${Math.round(v)}%`,
  hz: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`),
  st: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`,
  q: (v) => v.toFixed(2),
};

/// [key, label, min, max, step, format, log, shown when, title]
const CHOP_KNOBS = [
  ['Detect', [
    ['sens', 'Sens', 0, 100, 1, chopFmt.int, false, () => cp.mode === 'transient', 'Sensitivity: how small a hit still makes a cut'],
    ['topDb', 'Thresh', 15, 65, 1, (v) => `${Math.round(v)} dB`, false, () => cp.mode === 'silence', 'How far below the loudest moment counts as silence. Higher finds quieter sounds'],
    ['minDur', 'Min', 10, 400, 5, chopFmt.ms, false, () => cp.mode !== 'grid', 'Shorter than this, a sound is not a slice; the least room between two hits'],
    ['pad', 'Pad', 0, 50, 1, chopFmt.ms, false, () => cp.mode === 'silence', 'Room kept before and after each slice'],
  ]],
  ['Grid', [
    ['nudge', 'Nudge', -50, 50, 1, chopFmt.pct, false, () => cp.mode === 'grid', 'Shift the whole grid, by a share of a step'],
    ['shuffle', 'Shuffle', 50, 75, 1, chopFmt.pct, false, () => cp.mode === 'grid', 'MPC swing: every second grid line late. 50% straight, 66% a triplet feel'],
  ]],
  ['Slice', [
    ['gate', 'Gate', 5, 100, 1, chopFmt.pct, false, null, 'How much of each slice plays and is written'],
    ['smooth', 'Smooth', 0, 20, 0.5, chopFmt.ms, false, null, 'A fade in and out at each slice, so it does not click'],
    ['tailMs', 'Tail', 20, 200, 5, chopFmt.ms, false, null, 'A ReCycle-style ping-pong loop tail on each slice: its last moments, back and forth, fading out'],
  ]],
  ['Time', [
    ['bars', 'Bars', 1, 64, 1, chopFmt.int, false, null, 'How many bars S to E is: the tempo is worked out from it'],
    ['beats', 'Beats', 0, 15, 1, chopFmt.int, false, null, 'And how many beats more'],
    ['sig', 'Beats/bar', 2, 12, 1, (v) => `${Math.round(v)}/4`, false, null, 'Time signature'],
    ['tempo', 'Tempo', 0, 300, 0.5, (v) => (v > 0 ? `${v.toFixed(1)}` : 'orig'), false, null, 'The tempo Preview and Ratchet play at. All the way down is the sound\'s own'],
    ['pitch', 'Pitch', -24, 24, 0.1, chopFmt.st, false, null, 'Every slice up or down'],
    ['stretch', 'Stretch', 0, 100, 1, chopFmt.pct, false, null, 'Played slower, how much of the gap after each slice it fills by looping its end'],
  ]],
];

const CHOP_FX = {
  env: ['envOn', [
    ['attack', 'Attack', 0, 200, 0.5, chopFmt.ms, false, null, 'Each slice fades in over this'],
    ['decay', 'Decay', 10, 5000, 1, (v) => (v >= 5000 ? 'off' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`), true, null, 'Then dies away over this'],
  ]],
  trans: ['trOn', [
    ['trThresh', 'Thresh', -60, 0, 0.5, chopFmt.db, false, null, 'Below this, nothing is shaped'],
    ['trAmount', 'Amount', -100, 100, 1, chopFmt.pct, false, null, 'Up sharpens the hits, down softens them'],
    ['trAttack', 'Attack', 1, 100, 1, chopFmt.ms, true, null, 'How long a hit counts as a hit'],
    ['trRelease', 'Release', 10, 500, 1, chopFmt.ms, true, null, 'How long it takes to let go'],
    ['trGain', 'Gain', -24, 12, 0.5, chopFmt.db, false, null, 'Level after the shaping'],
  ]],
  eq: ['eqOn', [
    ['loCut', 'Lo cut', 15, 1000, 1, chopFmt.hz, true, null, 'Everything below goes'],
    ['lowF', 'Low', 30, 1000, 1, chopFmt.hz, true, null, 'Low band'],
    ['lowG', 'Gain', -18, 18, 0.5, chopFmt.db, false, null, 'Low band gain'],
    ['lowQ', 'Q', 0.3, 6, 0.01, chopFmt.q, true, null, 'Low band width'],
    ['highF', 'High', 1000, 16000, 10, chopFmt.hz, true, null, 'High band'],
    ['highG', 'Gain', -18, 18, 0.5, chopFmt.db, false, null, 'High band gain'],
    ['highQ', 'Q', 0.3, 6, 0.01, chopFmt.q, true, null, 'High band width'],
    ['hiCut', 'Hi cut', 2000, 20000, 10, chopFmt.hz, true, null, 'Everything above goes'],
  ]],
  filter: ['fltOn', [
    ['fltFreq', 'Freq', 30, 18000, 1, chopFmt.hz, true, null, 'The chop filter\'s frequency'],
    ['fltQ', 'Width', 0.3, 12, 0.01, chopFmt.q, true, null, 'Its resonance'],
    ['drive', 'Drive', 0, 100, 1, chopFmt.pct, false, null, 'Saturation after the filter'],
    ['gain', 'Gain', -24, 12, 0.5, chopFmt.db, false, null, 'Level after the drive'],
    ['mix', 'Mix', 0, 100, 1, chopFmt.pct, false, null, 'How much of it against the slice as it was'],
  ]],
};

const chopKnobEls = new Map();

function chopKnob([key, label, min, max, step, fmt, log, , title]) {
  const el = knob(label, cp[key], min, max, step, fmt,
    (v) => chopSetting(key, v, { live: true }),
    (v) => chopSetting(key, v),
    log, CHOP_DEF[key]);
  el.dataset.k = key;
  el.classList.add('chop-knob');
  el.title = `${title} — double-click to reset to ${fmt(CHOP_DEF[key])}`;
  chopKnobEls.set(key, el);
  return el;
}

function chopBuildKnobs() {
  const box = $('chopKnobs');
  box.replaceChildren();
  for (const [name, specs] of CHOP_KNOBS) {
    const g = document.createElement('div');
    g.className = 'chop-group';
    g.dataset.g = name.toLowerCase();
    const h = document.createElement('span');
    h.className = 'chop-gname';
    h.textContent = name;
    g.append(h);
    for (const spec of specs) {
      const k = chopKnob(spec);
      if (spec[7]) k.dataset.when = '1';
      g.append(k);
    }
    if (name === 'Slice') {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'chop-on chop-tail-on';
      t.title = 'The ping-pong tail on or off';
      t.textContent = 'Tail';
      t.onclick = () => chopSetting('tail', !cp.tail);
      const cyc = document.createElement('span');
      cyc.className = 'chop-cycles';
      g.append(t, cyc);
    }
    box.append(g);
  }
  chopBuildFx();
}

/// The processing every slice gets, each kind in line with the others under
/// its own heading and On (RJ, 5 Nov 2026: "display each one of those right in
/// line there … that title as the headline"). Its controls are the grain
/// tray's bars (`190-grain-tray.js`): a picture of what the control does, its
/// name and reading inside the bar, in the colour of what it does to the
/// sound (`GG_FACETS`); the pictures are the FX rack's (`FXP.PIC`).
const CHOP_FX_NAMES = { env: 'Envelope', trans: 'Transient', eq: 'EQ', filter: 'Filter' };

/// Each control's picture and colour.
const CHOP_FX_LOOK = {
  attack: ['attack', 'attack'], decay: ['release', 'attack'],
  trThresh: ['threshold', 'attack'], trAmount: ['depth', 'attack'], trAttack: ['attack', 'attack'],
  trRelease: ['release', 'attack'], trGain: ['level', 'level'],
  loCut: ['highpass', 'tone'], lowF: ['freq', 'tone'], lowG: ['level', 'level'], lowQ: ['q', 'tone'],
  highF: ['freq', 'tone'], highG: ['level', 'level'], highQ: ['q', 'tone'], hiCut: ['lowpass', 'tone'],
  fltFreq: ['lowpass', 'tone'], fltQ: ['q', 'tone'], drive: ['drive', 'tone'], gain: ['level', 'level'], mix: ['mix', 'level'],
};

/// The filter's frequency is drawn as the filter it is.
const chopFxPic = (key) => (key === 'fltFreq' ? { lp: 'lowpass', bp: 'freq', hp: 'highpass' }[cp.fltType] || 'lowpass' : CHOP_FX_LOOK[key][0]);

function chopBar([key, label, min, max, step, fmt, log, , title]) {
  let paint = () => {};
  const el = param(label, cp[key], min, max, step, fmt,
    (v) => { chopSetting(key, v, { live: true }); paint(); },
    (v) => chopSetting(key, v),
    log, CHOP_DEF[key]);
  const input = el.querySelector(':scope > input[type=range]');
  el.dataset.k = key;
  el.classList.add('gk-row', 'chop-fx-bar');
  el.title = `${title} — double-click to reset to ${fmt(CHOP_DEF[key])}`;
  el.style.setProperty('--fc', `var(--f-${CHOP_FX_LOOK[key][1]})`);
  el.insertAdjacentHTML('afterbegin', FXP.svg('', 'gg'));
  const glyph = el.firstElementChild;
  const p = { key, label, min, max, log };
  paint = () => {
    const v = el.read(), lo = +input.min, hi = +input.max;
    el.style.setProperty('--f', String(hi > lo ? (+input.value - lo) / (hi - lo) : 0));
    const n = log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
    glyph.innerHTML = FXP.noText(FXP.PIC[chopFxPic(key)](Math.min(1, Math.max(0, n)), v, p));
  };
  const sync = el.sync;
  el.sync = (v) => { sync(v); paint(); };
  gcRelative(input);
  glyph.addEventListener('dblclick', (e) => { e.preventDefault(); input.ondblclick?.(e); });
  chopKnobEls.set(key, el);
  paint();
  return el;
}

function chopBuildFx() {
  const box = $('chopFx');
  box.replaceChildren();
  for (const [fx, [onKey, specs]] of Object.entries(CHOP_FX)) {
    const sec = document.createElement('section');
    sec.className = 'chop-fxs';
    sec.dataset.fx = fx;
    const facets = new Set(specs.map(([k]) => CHOP_FX_LOOK[k][1]));
    const dots = GG_FACETS.filter(([id]) => facets.has(id)).map(([id]) => `<b style="background: var(--f-${id})"></b>`).join('');
    sec.innerHTML = `<div class="chop-fxs-head"><span class="chop-fxs-name">${CHOP_FX_NAMES[fx]}</span><span class="gc-dots">${dots}</span>`
      + '<span class="chop-grow"></span><button type="button" class="chop-on chop-fxs-on">Off</button></div><div class="chop-fxs-body"></div>';
    const on = sec.querySelector('.chop-fxs-on');
    on.title = `${CHOP_FX_NAMES[fx]} on or off`;
    on.onclick = () => chopSetting(onKey, !cp[onKey]);
    const body = sec.querySelector('.chop-fxs-body');
    if (fx === 'filter') {
      const pills = document.createElement('span');
      pills.className = 'chop-pills chop-flt-type';
      for (const [v, t] of [['lp', 'LP'], ['bp', 'BP'], ['hp', 'HP']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.v = v;
        b.textContent = t;
        b.onclick = () => chopSetting('fltType', v);
        pills.append(b);
      }
      body.append(pills);
    }
    for (const spec of specs) body.append(chopBar(spec));
    box.append(sec);
  }
  chopFxFit();
}

/// A bar whose name and reading do not fit side by side puts its reading under
/// its name, as in the grain tray (`gcWiden`).
function chopFxFit() {
  for (const row of document.querySelectorAll('#chopFx .chop-fx-bar')) {
    row.classList.remove('gc-stack');
    const k = row.querySelector(':scope > .k');
    if (k.scrollWidth > k.clientWidth) row.classList.add('gc-stack');
  }
}

/// Every pill and knob from `cp`, after A/B, a preset, Init or the dice.
function chopReflect() {
  for (const [id, key] of [['chopMode', 'mode'], ['chopDiv', 'div'], ['chopFeel', 'feel'], ['chopSync', 'sync'], ['chopTools', null]]) {
    const v = key ? cp[key] : chop.tool;
    $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  }
  for (const [fx, [onKey]] of Object.entries(CHOP_FX)) {
    const sec = document.querySelector(`#chopFx .chop-fxs[data-fx="${fx}"]`);
    if (!sec) continue;
    sec.classList.toggle('on', !!cp[onKey]);
    const b = sec.querySelector('.chop-fxs-on');
    b.textContent = cp[onKey] ? 'On' : 'Off';
    b.classList.toggle('on', !!cp[onKey]);
  }
  document.querySelectorAll('#chopFx .chop-flt-type button').forEach((b) => b.classList.toggle('on', b.dataset.v === cp.fltType));
  for (const [key, el] of chopKnobEls) if (el.isConnected) el.sync(cp[key]);
  for (const [, specs] of CHOP_KNOBS) for (const s of specs) {
    const el = chopKnobEls.get(s[0]);
    if (el) el.classList.toggle('hidden', !!s[7] && !s[7]());
  }
  document.querySelectorAll('#chopKnobs .chop-group').forEach((g) => {
    g.classList.toggle('hidden', ![...g.querySelectorAll('.chop-knob')].some((k) => !k.classList.contains('hidden')));
  });
  $('chopDiv').classList.toggle('dim', cp.mode !== 'grid');
  $('chopFeel').classList.toggle('dim', cp.mode !== 'grid');
  document.querySelector('#chopKnobs .chop-tail-on')?.classList.toggle('on', cp.tail);
  chopKnobEls.get('tailMs')?.classList.toggle('off', !cp.tail);
  $('chopA').classList.toggle('on', chopSlots.which === 'a');
  $('chopB').classList.toggle('on', chopSlots.which === 'b');
  $('chopOutMidi').classList.toggle('on', cp.outMidi);
  $('chopOutSfz').classList.toggle('on', cp.outSfz);
  $('chopRatchet').classList.toggle('on', chop.playing?.kind === 'ratchet');
  $('chopPreview').classList.toggle('on', chop.playing?.kind === 'preview');
}

let chopSaveTimer = null;
/// One setting changed. A setting the cut depends on cuts again; the rest only
/// change what the slices sound like, and the summaries.
function chopSetting(key, v, { live = false } = {}) {
  cp[key] = v;
  clearTimeout(chopSaveTimer);
  chopSaveTimer = setTimeout(chopSaveSettings, live ? 400 : 0);
  if (CHOP_RECUT.has(key)) chopRecut();
  else { chopStats(); chopTailUI(); chopPaintLane(); }
  if (!live) chopReflect();
  else if (key === 'mode') chopReflect();
}

/// All of `cp` at once, from a preset, Init or the dice.
function chopApply(values) {
  Object.assign(cp, { ...CHOP_DEF, ...values });
  chopSaveSettings();
  chopReflect();
  chopRecut();
}

/// The dice: new settings for the cutting and the sound, none of them silly.
function chopDice() {
  const r = (a, b) => a + Math.random() * (b - a);
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  chopApply({
    ...cp,
    sens: Math.round(r(35, 90)), div: pick(['4', '8', '8', '16', '16', '32']), feel: pick(['straight', 'straight', 'dot', 'trip']),
    nudge: 0, shuffle: Math.round(pick([50, 50, r(52, 66)])), gate: Math.round(pick([100, r(40, 100)])),
    smooth: Math.round(r(0, 6) * 2) / 2, pitch: pick([0, 0, -12, -5, 5, 7, 12]),
    fltOn: Math.random() < 0.5, fltType: pick(['lp', 'bp', 'hp']), fltFreq: Math.round(Math.exp(r(Math.log(200), Math.log(8000)))),
    fltQ: +r(0.5, 6).toFixed(2), drive: Math.round(pick([0, r(0, 60)])),
  });
}

function chopFillPresets(sel = '') {
  const s = $('chopPreset');
  s.replaceChildren(new Option('— preset —', ''));
  for (const p of chopPresets()) s.append(new Option(p.name, p.name));
  s.value = sel;
}

function chopStepPreset(d) {
  const list = chopPresets();
  if (!list.length) return;
  const i = list.findIndex((p) => p.name === $('chopPreset').value);
  const next = list[(i + d + list.length) % list.length] || list[0];
  $('chopPreset').value = next.name;
  chopApply(next.cp);
}

// ------------------------------------------------------------- the sound of a slice
//
// What Preview, Ratchet, an audition with processing on, and Write all hear:
// the slice, gated, with its tail, reversed, pitched, stretched, through the
// envelope, the transient shaper, the EQ and the chop filter, faded at its
// ends. With everything at its start it is the slice's own samples, untouched.

const chopHasSound = () => cp.gate < 100 || cp.smooth > 0 || cp.tail || cp.pitch !== 0
  || cp.envOn || cp.trOn || cp.eqOn || cp.fltOn;

/// Slice `i` as channels of samples. `slot` is the room it has in a Preview,
/// which Stretch fills.
function chopSliceAudio(i, { slot = 0 } = {}) {
  const x = chop.slices[i];
  return chopSound(x.s, x.e, { rev: x.rev, slot });
}

function chopSound(s, e0, { rev = false, slot = 0, tail = cp.tail, gate = cp.gate } = {}) {
  const { channels, rate } = chop;
  const e = s + Math.max(1, Math.round((e0 - s) * gate / 100));
  let chs = null;
  if (tail) {
    const p = chopGetTailParams(s, e, cp.tailMs, rate);
    if (p.viable) {
      const t = chopBuildPingPongTail(channels, s, e, cp.tailMs, rate);
      chs = channels.map((_, c) => {
        const out = new Float32Array(t.totalFrames);
        for (let f = 0; f < t.totalFrames; f++) out[f] = t.interleaved[f * t.ch + c];
        return out;
      });
    }
  }
  if (!chs) chs = channels.map((c) => c.slice(s, e));
  if (rev) chs.forEach((c) => c.reverse());
  if (cp.pitch) chs = chs.map((c) => chopResample(c, Math.pow(2, cp.pitch / 12)));
  if (slot && cp.stretch > 0 && chs[0].length < slot) {
    chs = chopStretch(chs, chs[0].length + Math.round((slot - chs[0].length) * cp.stretch / 100));
  }
  chopFx(chs, rate);
  if (cp.smooth > 0) chopFade(chs, Math.round(cp.smooth / 1000 * rate));
  return chs;
}

/// Varispeed, as a sampler does it: up an octave is twice as fast, half as long.
function chopResample(c, ratio) {
  const n = Math.max(1, Math.floor(c.length / ratio));
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const p = j * ratio, i = Math.floor(p), f = p - i;
    out[j] = (c[i] || 0) * (1 - f) + (c[i + 1] || 0) * f;
  }
  return out;
}

/// Longer, by going back and forth over the slice's last moments, then a short
/// fade so the join with the next slice does not click.
function chopStretch(chs, target) {
  const len = chs[0].length;
  const L = Math.max(8, Math.min(Math.floor(len / 4), Math.round(chop.rate * 0.05)));
  const from = len - L;
  return chs.map((c) => {
    const out = new Float32Array(target);
    out.set(c);
    for (let j = len, k = 0; j < target; j++, k++) {
      const cyc = Math.floor(k / L), at = k % L;
      out[j] = c[from + (cyc % 2 ? L - 1 - at : at)];
    }
    const fade = Math.min(Math.round(chop.rate * 0.005), target - len);
    for (let j = 0; j < fade; j++) out[target - 1 - j] *= j / fade;
    return out;
  });
}

function chopFade(chs, n) {
  const len = chs[0].length;
  n = Math.min(n, Math.floor(len / 2));
  for (const c of chs) for (let j = 0; j < n; j++) {
    const g = 0.5 - 0.5 * Math.cos(Math.PI * j / n);
    c[j] *= g;
    c[len - 1 - j] *= g;
  }
}

/// The RBJ cookbook's biquads: low-pass, high-pass, band-pass and peaking.
function chopBiquad(type, f, q, gainDb, sr) {
  const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), sn = Math.sin(w);
  const al = sn / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function chopRunBiquad(c, [k0, k1, k2, k3, k4]) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    const y = k0 * x + k1 * x1 + k2 * x2 - k3 * y1 - k4 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    c[i] = y;
  }
}

/// The processing rows, in ReCycle's order and then Ratchet's filter.
function chopFx(chs, sr) {
  const len = chs[0].length;
  if (cp.envOn) {
    const att = cp.attack / 1000 * sr, dec = cp.decay / 1000 * sr;
    for (let i = 0; i < len; i++) {
      const g = (att > 0 ? Math.min(1, i / att) : 1) * (cp.decay >= 5000 ? 1 : Math.exp(-3 * Math.max(0, i - att) / dec));
      for (const c of chs) c[i] *= g;
    }
  }
  if (cp.trOn) {
    const coef = (ms) => Math.exp(-1 / (Math.max(0.1, ms) / 1000 * sr));
    const aF = coef(1), aS = coef(cp.trAttack), r = coef(cp.trRelease);
    const thr = Math.pow(10, cp.trThresh / 20), out = Math.pow(10, cp.trGain / 20);
    let fast = 0, slow = 0;
    for (let i = 0; i < len; i++) {
      let lv = 0;
      for (const c of chs) lv = Math.max(lv, Math.abs(c[i]));
      fast = lv > fast ? aF * fast + (1 - aF) * lv : r * fast + (1 - r) * lv;
      slow = lv > slow ? aS * slow + (1 - aS) * lv : r * slow + (1 - r) * lv;
      let g = 1;
      if (fast > thr) g = Math.min(8, Math.max(0.1, Math.pow(fast / (slow + 1e-9), cp.trAmount / 100)));
      for (const c of chs) c[i] *= g * out;
    }
  }
  if (cp.eqOn) {
    const bands = [];
    if (cp.loCut > 16) bands.push(chopBiquad('hp', cp.loCut, 0.707, 0, sr));
    if (cp.lowG) bands.push(chopBiquad('peak', cp.lowF, cp.lowQ, cp.lowG, sr));
    if (cp.highG) bands.push(chopBiquad('peak', cp.highF, cp.highQ, cp.highG, sr));
    if (cp.hiCut < 19990) bands.push(chopBiquad('lp', cp.hiCut, 0.707, 0, sr));
    for (const c of chs) for (const k of bands) chopRunBiquad(c, k);
  }
  if (cp.fltOn) {
    const k = chopBiquad(cp.fltType, cp.fltFreq, cp.fltQ, 0, sr);
    const d = 1 + cp.drive / 10, norm = Math.tanh(d);
    const g = Math.pow(10, cp.gain / 20), wet = cp.mix / 100;
    for (const c of chs) {
      const dry = c.slice();
      chopRunBiquad(c, k);
      for (let i = 0; i < len; i++) {
        const y = cp.drive > 0 ? Math.tanh(c[i] * d) / norm : c[i];
        c[i] = (dry[i] * (1 - wet) + y * wet) * g;
      }
    }
  }
}

/// Every slice that is not muted, S to E, each where it falls at the play
/// tempo. `map` says, for each, where in the output it starts and how long it
/// sounds, so a playhead can be drawn on the sound.
function chopRenderPreview() {
  const { s: S, e: E } = chop.region;
  const k = chopBpm() / chopPlayBpm();
  const play = chop.slices.map((x, i) => ({ x, i })).filter(({ x }) => !x.muted && x.s >= S && x.s < E);
  const total = Math.max(1, Math.round((E - S) * k));
  const out = chop.channels.map(() => new Float32Array(total));
  const map = [];
  play.forEach(({ x, i }, n) => {
    const at = Math.round((x.s - S) * k);
    const next = n + 1 < play.length ? Math.round((play[n + 1].x.s - S) * k) : total;
    const slot = Math.max(1, next - at);
    const chs = chopSliceAudio(i, { slot });
    const len = Math.min(chs[0].length, slot, total - at);
    const fade = Math.min(len, Math.round(chop.rate * 0.004));
    chs.forEach((c, ch) => {
      const o = out[ch];
      for (let j = 0; j < len; j++) o[at + j] += c[j] * (chs[0].length > slot && j >= len - fade ? (len - j) / fade : 1);
    });
    map.push({ at, len, s: x.s, k });
  });
  return { chs: out, map };
}

/// Ratchet: the chop from S fires on every grid line at the play tempo, for
/// `bars` bars, round and round. Each fire is Gate of a step long at most.
function chopRenderRatchet() {
  const { s: S, e: E } = chop.region;
  const bpm = chopPlayBpm();
  const stepF = (chopStepBeats() * 60 / bpm) * chop.rate;
  const loop = Math.max(1, Math.round((Math.max(1, cp.bars) * cp.sig + cp.beats) * 60 / bpm * chop.rate));
  const src = chopSound(S, E, { tail: false, gate: 100 });
  const out = chop.channels.map(() => new Float32Array(loop));
  const map = [];
  const fade = Math.max(16, Math.round(Math.max(cp.smooth, 2) / 1000 * chop.rate));
  for (let k = 0; k < 100000; k++) {
    const at = Math.round(chopGridAt(k, stepF));
    if (at >= loop) break;
    if (at < 0) continue;
    const len = Math.min(src[0].length, Math.round(stepF * cp.gate / 100), loop - at);
    if (len <= 0) continue;
    src.forEach((c, ch) => {
      const o = out[ch];
      for (let j = 0; j < len; j++) {
        const g = Math.min(1, j / fade, (len - j) / fade);
        o[at + j] += c[j] * g;
      }
    });
    map.push({ at, len, s: S, k: 1 });
  }
  return { chs: out, map };
}

// ------------------------------------------------------------- listening

let chopCtx = null;

/// Play rendered samples through Web Audio: what the engine cannot play
/// because it only exists here.
function chopPlayRendered(chs, { kind, loop = false, map = [] }) {
  chopStop();
  if (!chs.length || !chs[0].length) return;
  try {
    chopCtx = chopCtx || new AudioContext();
    if (chopCtx.state === 'suspended') chopCtx.resume();
    const buf = chopCtx.createBuffer(chs.length, chs[0].length, chop.rate);
    chs.forEach((c, i) => buf.copyToChannel(c, i));
    const src = chopCtx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(chopCtx.destination);
    const t0 = chopCtx.currentTime + 0.02;
    src.start(t0);
    chop.playing = { kind, src, t0, len: chs[0].length, loop, map };
    src.onended = () => {
      if (chop.playing?.src !== src) return;
      chop.playing = null;
      chopPaintPlay();
      chopReflect();
    };
  } catch (e) {
    chopSay(`Cannot play: ${e.message}`);
  }
  chopReflect();
}

/// Play one slice. Plain, it plays through the engine, from the sound as it
/// is; with processing on, it is rendered and played here.
async function chopPlay(i, { pick = true } = {}) {
  if (pick) chopPick(i);
  const x = chop.slices[i];
  if (!x) return;
  if (chopHasSound() || x.rev) {
    const chs = chopSliceAudio(i);
    chopPlayRendered(chs, { kind: 'slice', map: [{ at: 0, len: chs[0].length, s: x.s, k: 1 }] });
    return;
  }
  chopStop();
  if (!chop.path || typeof engineLoad !== 'function') return;
  if (!(engine.path === chop.path && engine.raw) && !(await engineLoad({ path: chop.path }, { raw: true }))) return;
  seekSource(x.s);
  startPlayback();
  const stopAt = performance.now() + ((x.e - x.s) / chop.rate) * 1000;
  chop.playing = { kind: 'engine', s: x.s, e: x.e, stopAt, timer: setTimeout(chopStop, stopAt - performance.now()) };
}

function chopStop() {
  const p = chop.playing;
  if (!p) return;
  chop.playing = null;
  if (p.kind === 'engine') {
    clearTimeout(p.timer);
    if (engine.playing) pausePlayback();
  } else {
    try { p.src.stop(); } catch { /* already stopped */ }
  }
  chopPaintPlay();
  if (chopKnobEls.size) chopReflect();
}

/// Where what plays has got to, in the sound's frames, or -1.
function chopPlayhead() {
  const p = chop.playing;
  if (!p) return -1;
  if (p.kind === 'engine') {
    const left = Math.max(0, p.stopAt - performance.now());
    return p.e - (left / 1000) * chop.rate;
  }
  if (!chopCtx) return -1;
  let t = (chopCtx.currentTime - p.t0) * chop.rate;
  if (t < 0) return -1;
  if (p.loop) t %= p.len;
  for (const m of p.map) if (t >= m.at && t < m.at + m.len) return m.s + (t - m.at) / m.k;
  return -1;
}

// ------------------------------------------------------------- writing

function chopInterleave(chs) {
  const n = chs[0].length, ch = chs.length;
  const out = new Float32Array(n * ch);
  for (let f = 0; f < n; f++) for (let c = 0; c < ch; c++) out[f * ch + c] = chs[c][f];
  return out;
}

/// The WAV for slice `i`, with everything on. With nothing on, Recycle
/// Reborn's own encoders, so the bytes are the ones it wrote.
function chopSliceWav(i) {
  const x = chop.slices[i];
  if (!chopHasSound() && !x.rev) return chopEncodeWAV(chop.channels, x.s, x.e, chop.rate);
  if (cp.tail && !x.rev && !cp.pitch && !cp.envOn && !cp.trOn && !cp.eqOn && !cp.fltOn && !cp.smooth && cp.gate === 100) {
    const p = chopGetTailParams(x.s, x.e, cp.tailMs, chop.rate);
    if (!p.viable) return chopEncodeWAV(chop.channels, x.s, x.e, chop.rate);
    const { interleaved, totalFrames, ch, sr } = chopBuildPingPongTail(chop.channels, x.s, x.e, cp.tailMs, chop.rate);
    return chopEncodeWAVFromInterleaved(interleaved, totalFrames, ch, sr);
  }
  const chs = chopSliceAudio(i);
  return chopEncodeWAVFromInterleaved(chopInterleave(chs), chs[0].length, chs.length, chop.rate);
}

/// A type-0 MIDI file: a note a slice, from C1 (36), where each slice falls at
/// the sound's tempo, held until the next.
function chopMidi(written) {
  const PPQ = 480, bpm = chopBpm(), S = chop.region.s;
  const tick = (f) => Math.round(((f - S) / chop.rate) * (bpm / 60) * PPQ);
  const ev = [];
  written.forEach(({ i }, n) => {
    const x = chop.slices[i];
    const end = n + 1 < written.length ? chop.slices[written[n + 1].i].s : x.e;
    ev.push([tick(x.s), 0x90, 36 + n, 100], [Math.max(tick(x.s) + 1, tick(end)), 0x80, 36 + n, 0]);
  });
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const vlq = (v) => { const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); return b; };
  const us = Math.round(60000000 / bpm);
  const track = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255,
    0, 0xff, 0x58, 4, cp.sig, 2, 24, 8];
  let last = 0;
  for (const [t, st, note, vel] of ev) { track.push(...vlq(t - last), st, Math.min(127, note), vel); last = t; }
  track.push(0, 0xff, 0x2f, 0);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, PPQ >> 8, PPQ & 255];
  const tl = track.length;
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (tl >>> 24) & 255, (tl >> 16) & 255, (tl >> 8) & 255, tl & 255, ...track]);
}

/// An SFZ: each slice on a key from C1, one shot, as the files were written.
function chopSfz(written) {
  const lines = [`// ${chop.stem}: ${written.length} slices from MultiGrainLive's Chop, ${chopBpm().toFixed(2)} BPM`, '<control>', '<group> loop_mode=one_shot'];
  written.forEach(({ name }, n) => lines.push(`<region> sample=${name} key=${36 + n}`));
  return lines.join('\n') + '\n';
}

/// Every slice that is not muted, with everything on, beside the sound, and
/// the MIDI file and the SFZ if asked for.
async function chopWriteAll() {
  if (!chop.path || !chop.slices.length) return;
  const btn = $('chopWrite');
  btn.disabled = true;
  let done = 0, folder = '';
  const written = [];
  const send = async (name, type, body) => {
    const r = await fetch(`/api/chop/save?p=${encodeURIComponent(chop.path)}&name=${encodeURIComponent(name)}`,
      { method: 'POST', headers: { 'Content-Type': type }, body });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`);
    return r.json();
  };
  const todo = chop.slices.map((x, i) => ({ x, i })).filter(({ x }) => !x.muted);
  try {
    for (const { i } of todo) {
      chopSay(`Writing ${done + 1}/${todo.length}…`);
      await new Promise((r) => setTimeout(r, 0)); // yield so the window does not freeze
      const got = await send(chopName(i), 'audio/wav', chopSliceWav(i));
      folder = (got.path || '').split('/').slice(0, -1).join('/');
      written.push({ i, name: got.name || chopName(i) });
      done++;
    }
    const extra = [];
    if (cp.outMidi) { await send(`${chop.stem}.mid`, 'audio/midi', chopMidi(written)); extra.push('MIDI'); }
    if (cp.outSfz) { await send(`${chop.stem}.sfz`, 'text/plain', chopSfz(written)); extra.push('SFZ'); }
    chopSay(`Wrote ${done} slices${extra.length ? ` and the ${extra.join(' and ')}` : ''} to ${folder}`);
    if (typeof refreshLibrary === 'function') refreshLibrary();
  } catch (e) {
    chopSay(`Stopped after ${done}: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

/// The slices into the Region manager: one region a slice that is not muted,
/// named for the sound and its number, beside whatever regions are there.
/// One already there with the same ends is not added twice.
function chopToRegions() {
  const f = state.selectedFile;
  if (!f || !chop.mono || chop.path !== f.path) { chopSay('Chop the selected sound first'); return 0; }
  const regions = state.annotations.regions;
  const have = new Set(regions.map((r) => `${r.start}|${r.end}`));
  let added = 0;
  chop.slices.forEach((x, i) => {
    if (x.muted || have.has(`${x.s}|${x.e}`)) return;
    regions.push({ start: x.s, end: x.e, label: `${chop.stem} ${i + 1}` });
    added++;
  });
  regions.sort((a, b) => a.start - b.start);
  if (added) saveAnnotations();
  chopSay(added ? `${added} slices added to Regions` : 'Every slice is in Regions already');
  return added;
}

/// Capture: the newest take in Recordings, selected and chopped.
async function chopCapture() {
  try {
    const files = await api(`/api/files?folder=${encodeURIComponent('Recordings')}`);
    if (!files?.length) { chopSay('No takes in Recordings yet'); return; }
    const newest = [...files].sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')))[0];
    await selectFile(newest);
  } catch {
    chopSay('No takes in Recordings yet');
  }
}

// ------------------------------------------------------------- wiring

(() => {
  chopLoadSettings();
  chopBuildKnobs();
  const pills = (id, key) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) chopSetting(key, b.dataset.v);
  });
  pills('chopMode', 'mode');
  pills('chopDiv', 'div');
  pills('chopFeel', 'feel');
  pills('chopSync', 'sync');
  $('chopTools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    chop.tool = b.dataset.v;
    $('lane').classList.toggle('chop-pencil', chop.tool === 'pencil');
    chopReflect();
  });
  if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(chopFxFit)).observe($('chopFx'));
  $('chopRev').addEventListener('click', () => chopToggle('rev'));
  $('chopMute').addEventListener('click', () => chopToggle('muted'));
  $('chopPreview').addEventListener('click', () => {
    if (chop.playing?.kind === 'preview') { chopStop(); return; }
    if (!chop.mono) return;
    const { chs, map } = chopRenderPreview();
    chopPlayRendered(chs, { kind: 'preview', map });
  });
  $('chopRatchet').addEventListener('click', () => {
    if (chop.playing?.kind === 'ratchet') { chopStop(); return; }
    if (!chop.mono) return;
    const { chs, map } = chopRenderRatchet();
    chopPlayRendered(chs, { kind: 'ratchet', loop: true, map });
  });
  $('chopA').addEventListener('click', () => { chopSlots.which = 'a'; cp = chopSlots.a; chopSaveSettings(); chopReflect(); chopRecut(); });
  $('chopB').addEventListener('click', () => { chopSlots.which = 'b'; cp = chopSlots.b; chopSaveSettings(); chopReflect(); chopRecut(); });
  $('chopPreset').addEventListener('change', () => {
    const p = chopPresets().find((x) => x.name === $('chopPreset').value);
    if (p) chopApply(p.cp);
  });
  $('chopPrevPreset').addEventListener('click', () => chopStepPreset(-1));
  $('chopNextPreset').addEventListener('click', () => chopStepPreset(1));
  $('chopSave').addEventListener('click', () => {
    const name = prompt('Preset name:', $('chopPreset').value || `Chop ${chopPresets().length + 1}`);
    if (!name) return;
    const list = chopPresets().filter((p) => p.name !== name);
    list.push({ name, cp: { ...cp } });
    list.sort((a, b) => a.name.localeCompare(b.name));
    try { localStorage.setItem('chopPresets', JSON.stringify(list)); } catch { /* private mode */ }
    chopFillPresets(name);
  });
  $('chopInit').addEventListener('click', () => { $('chopPreset').value = ''; chopApply({}); });
  $('chopDice').addEventListener('click', chopDice);
  $('chopCapture').addEventListener('click', chopCapture);
  $('chopRedetect').addEventListener('click', () => chopRecut());
  $('chopToRegions').addEventListener('click', chopToRegions);
  $('chopOutMidi').addEventListener('click', () => chopSetting('outMidi', !cp.outMidi));
  $('chopOutSfz').addEventListener('click', () => chopSetting('outSfz', !cp.outSfz));
  $('chopWrite').addEventListener('click', chopWriteAll);
  chopFillPresets();
  chopWireLane();
  chopReflect();
})();

/// For the tests, and anything else that wants Recycle Reborn's arithmetic.
window.Chop = {
  buildRms: chopBuildRms,
  detectSegs: chopDetectSegs,
  getTailParams: chopGetTailParams,
  buildPingPongTail: chopBuildPingPongTail,
  /// Chop these samples as if they were the selected sound.
  loadSamples: (channels, rate, stem) => { chop.loading++; chopTake(channels, rate, stem); },
  /// Settings, as the knobs and pills set them.
  set: (values) => { for (const [k, v] of Object.entries(values)) chopSetting(k, v); },
  init: () => chopApply({}),
  get settings() { return { ...cp }; },
  get slices() { return chop.slices.map((x) => ({ ...x })); },
  get region() { return { ...chop.region }; },
  setRegion: (s, e) => { chop.region = { s, e }; chopRecut(); },
  addCut: chopAddCut,
  deleteCut: chopDeleteCut,
  moveEdge: (i, side, to) => { chopMoveEdge(i, side, to); chopChanged(); },
  pick: chopPick,
  toggle: chopToggle,
  bpm: chopBpm,
  playBpm: chopPlayBpm,
  sliceAudio: chopSliceAudio,
  renderPreview: chopRenderPreview,
  renderRatchet: chopRenderRatchet,
  midi: chopMidi,
  sfz: chopSfz,
  repaint: chopPaintLane,
  toRegions: chopToRegions,
  get soft() { return { ...chopSoft }; },
  stop: chopStop,
  get playing() { return chop.playing?.kind || ''; },
  get state() { return { path: chop.path, slices: chop.slices.length, current: chop.current }; },
};
