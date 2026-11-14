// ═══════════════════════════════════ the Edit page: the sound, measured ══
//
// The document as samples, for what the peaks cannot say: Rainbow's colours
// (the low, mid and high energy Chop measures), the hits a dragged edge can
// snap to, the loudest spots, the loupe on an edit point, and the peak and RMS
// of a selection. Read from `/audio?dry=1` (the edited clips, before the
// stretch and the rack) and decoded at the file's own rate, as Chop does.
// Measured in a worker with Chop's own `chopAnalyseCore`.
//
// Read again whenever the overview is, which is after every edit that changes
// the sound and whenever another sound opens. Only while the Edit page, Grain
// or Prism shows (Grain colours its overview with it, Prism its SOURCE): elsewhere
// it is marked stale and read when you come back. Prism measures its own sound,
// which need not be the one open; the next page to ask for another reads that.

let edSoundWorker = null;
let edSoundWant = 0;

/// The overview was reloaded: what was measured is out of date.
function edSoundStale() {
  edSoundWant++;
  if (document.body.classList.contains('prismpage')) edLoadSound(prismDeck.path);
  else if (document.body.classList.contains('wavepage') || GS.showing) edLoadSound();
}

/// Read and measure `path`: the open sound unless a page names its own.
async function edLoadSound(path = state.selectedFile?.path) {
  if (!path) { Object.assign(edSound, { path: '', mono: null, an: null, hits: [], loud: [] }); return; }
  if (edSound.serial === edSoundWant && edSound.path === path && edSound.mono) return;
  const serial = edSound.serial = edSoundWant;
  let bytes;
  try {
    const r = await fetch(`/audio?p=${encodeURIComponent(path)}&dry=1`);
    if (!r.ok) throw new Error(`${r.status}`);
    bytes = await r.arrayBuffer();
  } catch { return; }
  if (serial !== edSoundWant) return;
  const rate = new DataView(bytes).getUint32(24, true) || 44100;
  let buf;
  try { buf = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes); } catch { return; }
  if (serial !== edSoundWant) return;
  // Mono for measuring: the channels averaged.
  const n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
  Object.assign(edSound, { path, rate, mono, an: null, hits: [], loud: [] });
  edMeasure(mono, rate, serial);
  edSoundReady();
}

function edMeasure(mono, rate, serial) {
  const take = (an) => {
    if (serial !== edSoundWant || edSound.mono !== mono) return;
    edSound.an = an;
    edSound.hits = edFindHits(an);
    edSound.loud = edFindLoud(an);
    edSoundReady();
  };
  try {
    if (edSoundWorker) edSoundWorker.terminate();
    const body = `onmessage = (e) => { postMessage((${chopAnalyseCore.toString()})(e.data.m, e.data.sr)); };`;
    edSoundWorker = new Worker(URL.createObjectURL(new Blob([body], { type: 'text/javascript' })));
    edSoundWorker.onmessage = (e) => take(e.data);
    edSoundWorker.onerror = () => take(chopAnalyseCore(mono, rate));
    edSoundWorker.postMessage({ m: mono.slice(0), sr: rate });
  } catch {
    take(chopAnalyseCore(mono, rate));
  }
}

/// A hit: the energy of a frame well over the few before it, and loud enough to
/// matter. At most one every 50 ms, so a flam is one hit.
function edFindHits(an) {
  const { rms, HOP, F } = an;
  let top = 0;
  for (let f = 0; f < F; f++) top = Math.max(top, rms[f]);
  const out = [], gap = Math.max(1, Math.round(0.05 * (edSound.rate || 44100) / HOP));
  let last = -1e9;
  for (let f = 4; f < F; f++) {
    const before = (rms[f - 1] + rms[f - 2] + rms[f - 3] + rms[f - 4]) / 4;
    if (rms[f] > before * 1.8 && rms[f] > top * 0.06 && f - last >= gap) { out.push(f * HOP); last = f; }
  }
  return out;
}

/// The loudest stretches: a quarter of a second at a time, within 3 dB of the
/// loudest one. WaveLab marks these on the wave; so does this page.
function edFindLoud(an) {
  const { rms, HOP, F } = an, w = Math.max(1, Math.round(0.25 * (edSound.rate || 44100) / HOP)), win = [];
  for (let f = 0; f + w <= F; f += w) { let s = 0; for (let k = 0; k < w; k++) s += rms[f + k] ** 2; win.push({ at: (f + w / 2) * HOP, db: 10 * Math.log10(s / w + 1e-12) }); }
  const top = Math.max(-120, ...win.map((x) => x.db));
  return win.filter((x) => x.db > top - 3 && x.db > -40);
}

/// The colour of a stretch of the sound: Chop's Spectrum view, low violet, mid
/// green, high white. `null` until it has been measured.
function edColourAt(frame, always = false) {
  const an = edSound.an;
  if (!an || (!edPrefs.rainbow && !always)) return null;
  const f = Math.max(0, Math.min(an.F - 1, Math.floor(frame / an.HOP)));
  const l = an.low[f] ** 2, m = an.mid[f] ** 2, h = an.high[f] ** 2, t = l + m + h + 1e-9;
  return [(CHOP_LOW[0] * l + CHOP_MID[0] * m + CHOP_HIGH[0] * h) / t, (CHOP_LOW[1] * l + CHOP_MID[1] * m + CHOP_HIGH[1] * h) / t, (CHOP_LOW[2] * l + CHOP_MID[2] * m + CHOP_HIGH[2] * h) / t];
}

/// Peak and RMS of a range of the document, in dB, from its own samples.
function edLevels(a, b) {
  const m = edSound.mono;
  if (!m) return null;
  a = Math.max(0, a | 0); b = Math.min(m.length, b | 0);
  if (b <= a) return null;
  let pk = 0, sq = 0;
  const step = Math.max(1, Math.floor((b - a) / 400000));
  for (let i = a; i < b; i += step) { const v = Math.abs(m[i]); if (v > pk) pk = v; sq += v * v; }
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -120);
  return { peak: db(pk), rms: db(Math.sqrt(sq / Math.ceil((b - a) / step))) };
}

/// The nearest hit to a frame, within `reach` frames, or null.
function edNearestHit(frame, reach) {
  let best = null, bd = reach;
  for (const h of edSound.hits) { const d = Math.abs(h - frame); if (d < bd) { bd = d; best = h; } }
  return best;
}

/// The nearest zero crossing, within `reach` frames, or the frame itself.
function edNearestZero(frame, reach) {
  const m = edSound.mono;
  if (!m) return frame;
  for (let k = 0; k < reach; k++) {
    for (const j of [frame + k, frame - k]) {
      if (j > 0 && j < m.length && (m[j - 1] <= 0) !== (m[j] <= 0)) return Math.abs(m[j - 1]) < Math.abs(m[j]) ? j - 1 : j;
    }
  }
  return frame;
}
