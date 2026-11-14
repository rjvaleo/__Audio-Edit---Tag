// ================================================================ Grain: the pictures
//
// What the engine panel shows under its controls, in whatever height they leave
// (`gsSizeEngine`): the spectrum at the head and the time map when there is room,
// then the engine's own close-up. Everything here is drawn from something real:
//
// - The samples: `/audio?dry=1`, decoded the way the Chop page does it. The dry
//   flag keeps an active rack out of them and puts them on the timeline the loop
//   and the cue are counted on.
// - What is sounding: the one `/api/engine/grains` poll (`startPolling`, which
//   hands each answer to `gsPicFeed`). `drain_events` has one consumer, so nothing
//   here may ask for it again.
//
// The transient marks use the mock-up's detector on those samples. The engine's
// own onset map (`fx::transient::onsets`) is not offered by any route.

/// Past this a sound is not decoded, for the memory it would take.
const GS_PCM_MAX_S = 600;
const GS_NFFT = 1024;
const GS_NB = 128;
/// Columns across the file for the loudest moment, which the spectra are read
/// against.
const GS_PCM_COLS = 812;
const GS_NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/// One held note's colour. Phase 7 gives each note its own.
const GS_HEAD_COL = 'hsl(200,70%,68%)';
const GS_SEP_COL = { tone: '#f0b060', hits: '#78e2ec', air: '#a88ce8' };

const GS_PIC = {
  // The samples and what was worked out from them, for the sound in `want`.
  want: '', serial: 0, pcm: null, note: '',
  // The last poll's word on the keys, when it came, and when the note began.
  keys: null, heard: 0, ons: null, t0: 0, wasPlaying: false, key: null, metersOn: false,
  // Poly's: one per note, as the last poll said.
  heads: [],
  // Grains that have sounded, each stamped with when, on this page's clock.
  ev: [],
  // The picture key, so a still page is not redrawn; how often each has drawn.
  drawKey: '', last: 0, drawn: { head: 0, map: 0, lens: 0 },
  // A frame's bands, kept while the head stays on the same sample.
  bands: new Float32Array(GS_NB), bandsAt: -1, bandsPcm: null, held: null,
  sep: null,
};

/// Anything that has to be drawn again, whatever the key says.
function gsPicDirty() { GS_PIC.drawKey = ''; }

// ─────────────────────────────────────────────────────────── the transform

const GS_FFT = (() => {
  const N = GS_NFFT, rev = new Uint16Array(N), cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  return { rev, cos, sin, win, re: new Float64Array(N), im: new Float64Array(N) };
})();

function gsFft(re, im) {
  const N = GS_NFFT, { rev, cos, sin } = GS_FFT;
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= N; size *= 2) {
    const half = size / 2, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0; k < half; k++) {
        const w = k * step, a = s + k, b = a + half;
        const tr = re[b] * cos[w] - im[b] * sin[w], ti = re[b] * sin[w] + im[b] * cos[w];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/// The power in each log band, 40 Hz to 20 kHz, of the frame centred on `at`.
function gsPower(pcm, at, out) {
  const { re, im, win } = GS_FFT, d = pcm.data, s0 = at - GS_NFFT / 2;
  for (let i = 0; i < GS_NFFT; i++) { re[i] = (d[s0 + i] || 0) * win[i]; im[i] = 0; }
  gsFft(re, im);
  for (let b = 0; b < GS_NB; b++) {
    let m = 0;
    for (let k = pcm.k0[b]; k < pcm.k1[b] && k < GS_NFFT / 2; k++) {
      const v = re[k] * re[k] + im[k] * im[k];
      if (v > m) m = v;
    }
    out[b] = m;
  }
}

/// The same as 0 to 1, against the loudest moment of the sound.
function gsBandsInto(pcm, at, out) {
  gsPower(pcm, at, out);
  for (let b = 0; b < GS_NB; b++) out[b] = wvClamp((10 * Math.log10(out[b] / pcm.top + 1e-12) + 78 + b / GS_NB * 22) / 80);
}

/// The bands under the head.
function gsHeadBands(pcm, head) {
  const at = Math.round(head * pcm.sr);
  if (GS_PIC.bandsAt !== at || GS_PIC.bandsPcm !== pcm) {
    GS_PIC.bandsAt = at;
    GS_PIC.bandsPcm = pcm;
    gsBandsInto(pcm, at, GS_PIC.bands);
  }
  return GS_PIC.bands;
}

// ─────────────────────────────────────────────────────────────── the samples

/// Work out what the pictures need from the samples: their peak, the loudest
/// moment, and the energy's rises, which is the mock-up's transient detector.
function gsAnalyse(data, sr) {
  const n = data.length, k0 = new Int32Array(GS_NB), k1 = new Int32Array(GS_NB);
  for (let b = 0; b < GS_NB; b++) {
    const f0 = 40 * Math.pow(500, b / GS_NB), f1 = 40 * Math.pow(500, (b + 1) / GS_NB);
    k0[b] = Math.max(1, Math.floor(f0 / sr * GS_NFFT));
    k1[b] = Math.max(k0[b] + 1, Math.ceil(f1 / sr * GS_NFFT));
  }
  const pcm = { data, sr, len: n / sr, k0, k1, peak: 0.001, top: 1e-12, on: [], med: 0.01 };
  for (let i = 0; i < n; i++) { const v = Math.abs(data[i]); if (v > pcm.peak) pcm.peak = v; }
  const col = new Float32Array(GS_NB);
  for (let c = 0; c < GS_PCM_COLS; c++) {
    gsPower(pcm, Math.floor((c + 0.5) / GS_PCM_COLS * n), col);
    for (let b = 0; b < GS_NB; b++) if (col[b] > pcm.top) pcm.top = col[b];
  }
  // Energy in 10 ms frames, and its rises.
  const hop = Math.max(1, Math.round(sr * 0.01)), F = Math.floor(n / hop), env = new Float32Array(F);
  for (let f = 0; f < F; f++) {
    let q = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) q += data[i] * data[i];
    env[f] = Math.sqrt(q / hop);
  }
  pcm.med = Float32Array.from(env).sort()[F >> 1] || 0.01;
  const fl = new Float32Array(F);
  let mf = 0;
  for (let f = 2; f < F; f++) { fl[f] = Math.max(0, Math.sqrt(env[f]) - Math.sqrt(env[f - 2])); if (fl[f] > mf) mf = fl[f]; }
  for (let f = 3; f < F - 1; f++) {
    if (!(fl[f] > fl[f - 1] && fl[f] >= fl[f + 1] && fl[f] > mf * 0.12)) continue;
    const last = pcm.on[pcm.on.length - 1], t = f * 0.01;
    if (last && t - last.t < 0.06) { if (fl[f] / mf > last.s) { last.t = t; last.s = fl[f] / mf; last.l = env[f]; } }
    else pcm.on.push({ t, s: fl[f] / mf, l: env[f] });
  }
  return pcm;
}

function gsPicTake(data, sr) {
  GS_PIC.pcm = gsAnalyse(data, sr);
  GS_PIC.note = '';
  GS_PIC.held = null;
  GS_PIC.sep = null;
  gsPicDirty();
}

/// Decode the open sound, once, and only while this page is on screen.
async function gsPcmLoad() {
  const file = state.selectedFile, f = gsFile();
  const want = file && f && state.overview ? `${file.path}|${f.frames}` : '';
  if (want === GS_PIC.want) return;
  GS_PIC.want = want;
  GS_PIC.pcm = null;
  GS_PIC.note = '';
  gsPicDirty();
  const serial = ++GS_PIC.serial;
  if (!want) return;
  if (f.len > GS_PCM_MAX_S) { GS_PIC.note = `Over ${GS_PCM_MAX_S / 60} minutes: not analysed`; return; }
  GS_PIC.note = 'Reading the sound…';
  const fail = () => { if (serial === GS_PIC.serial) { GS_PIC.note = 'Could not read the sound'; gsPicDirty(); } };
  let bytes;
  try {
    const r = await fetch(`/audio?p=${encodeURIComponent(file.path)}&dry=1`);
    if (!r.ok) throw new Error(String(r.status));
    bytes = await r.arrayBuffer();
  } catch { fail(); return; }
  // At the sound's own rate; `/audio` is always WAV, so the rate is at 24.
  let buf;
  try { buf = await new window.OfflineAudioContext(1, 1, new DataView(bytes).getUint32(24, true) || 44100).decodeAudioData(bytes); }
  catch { fail(); return; }
  if (serial !== GS_PIC.serial) return;
  const mono = new Float32Array(buf.length), ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / ch; }
  gsPicTake(mono, buf.sampleRate);
  // The same samples colour the overview, measured as the Edit page measures them (411).
  edTakeSound(file.path, buf.sampleRate, mono);
}

/// The transients to mark on the detail, and how their level is read against
/// Floor. From the samples once they are here; from the peaks until then.
function gsPicOnsets() {
  const p = GS_PIC.pcm;
  return p ? { on: p.on, med: p.med, k: 1.4 } : { on: GS_DET.on, med: GS_DET.med, k: 0.8 };
}

// ──────────────────────────────────────────────────────── what is sounding

function gsPollWanted() {
  return GS.showing && (GS_N.held.size > 0 || GS_N.midi.size > 0 || !!GS_PIC.keys?.sounding);
}

/// Each answer of the transport's poll, or null when one failed.
function gsPicFeed(r) {
  if (!GS.showing) { GS_PIC.keys = null; GS_PIC.ev.length = 0; return; }
  const now = performance.now(), k = r?.keys || null, was = !!GS_PIC.keys?.sounding;
  GS_PIC.keys = k;
  GS_PIC.heads = r?.heads || [];
  GS_PIC.heard = now;
  if (k && k.noteOns !== GS_PIC.ons) {
    // A legato note goes on from where the head is: the same time since the key.
    if (GS_PIC.ons != null && !(GS.voice.mode === 'legato' && was)) GS_PIC.t0 = now;
    GS_PIC.ons = k.noteOns;
  }
  const list = r?.grains;
  if (!list?.length) return;
  // The engine's clock jumps at a wrap and at every note; a grain's place in
  // this batch is all that is used of it.
  let newest = 0;
  for (const e of list) if (e.t > newest) newest = e.t;
  for (const e of list) {
    const back = wvClamp(newest - e.t, 0, 0.25);
    GS_PIC.ev.push({ at: now - back * 1000, src: e.src, size: e.size, semis: e.semis, voice: e.voice });
  }
  const old = now - 2000;
  let keep = 0;
  while (keep < GS_PIC.ev.length && GS_PIC.ev[keep].at < old) keep++;
  if (keep) GS_PIC.ev.splice(0, keep);
  if (GS_PIC.ev.length > 1500) GS_PIC.ev.splice(0, GS_PIC.ev.length - 1500);
}

/// Where a held note is reading, in seconds of the sound, or null when none is.
/// The engine says where it had got to; between polls it is carried forward,
/// and wrapped where the head wraps.
function gsNoteHead() {
  const k = GS_PIC.keys, f = gsFile();
  if (!k?.sounding || !f || GS.voice.mode === 'poly') return null;
  const on = k.head + Math.min(0.25, (performance.now() - GS_PIC.heard) / 1000) * (engine.deviceRate || 48000);
  let s = srcFromEngine(on) / f.sr;
  const sc = gsRead('scan');
  if (GS.engine !== 'pvsola') {
    if (Math.abs(sc) < 1e-3) return gsCue();
    if (sc !== 1) s = sc > 0 ? s * sc : f.len + s * sc;
  }
  const { a, b } = gsLoop(), L = b - a;
  return L > 0 ? a + (((s - a) % L) + L) % L : s;
}

/// Where every note is reading, in Poly: one per voice, oldest first.
const gsPolyHeads = () => (GS.showing ? GS_PIC.heads : null) || [];
const gsHeadLive = () => engine.playing || gsNoteHead() != null || gsPolyHeads().length > 0;
/// Whether the meters are reading sound: the transport, or a note on its own.
const gsMetersLive = () => !!engine.playing || gsPollWanted();
const gsKeyName = (n) => GS_NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

function gsNoteName(f) {
  const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m), c = Math.round((m - r) * 100);
  return gsKeyName(r) + (c ? (c > 0 ? ' +' : ' −') + Math.abs(c) + '¢' : '');
}

/// A voice's colour, by its key, as the mock-up has it.
const gsVoiceHue = (key) => 200 + ((key || 0) * 47) % 150;
const gsVoiceCol = (key, a = 1) => `hsla(${gsVoiceHue(key)},70%,68%,${a})`;

/// Each voice's key, stepping down a row when two are too close to read.
function gsHeadLabels(c, heads, y0, step) {
  let last = -1e9, row = 0;
  for (const h of heads.sort((p, q) => p.x - q.x)) {
    row = h.x - last < 34 ? row + 1 : 0;
    last = h.x;
    gsLbl(c, h.t, h.x + 4, y0 + row * step, h.col);
  }
}

/// One head per note, in that voice's colour, on the overview and the detail.
function gsDrawVoiceHeads(c, X, top, bot, labelY, step, cl, within) {
  const labels = [];
  for (const h of gsPolyHeads()) {
    if (within && !within(h.src)) continue;
    const x = X(h.src), al = Math.max(0.2, Math.min(1, h.env * 1.4)), col = gsVoiceCol(h.key, al);
    c.save();
    c.fillStyle = col;
    c.shadowBlur = 8;
    c.shadowColor = gsVoiceCol(h.key, 0.8);
    c.fillRect(x - 0.75, top, 1.5, bot - top);
    c.restore();
    labels.push({ x, t: gsKeyName(h.key), col });
  }
  c.font = `600 9px ${cl.mono}`;
  gsHeadLabels(c, labels, labelY, step);
}

/// A held note's head on the overview and the detail: its line and its key.
function gsDrawNoteHead(c, x, top, bot, labelY, cl) {
  c.save();
  c.fillStyle = GS_HEAD_COL;
  c.shadowBlur = 8;
  c.shadowColor = GS_HEAD_COL;
  c.fillRect(x - 0.75, top, 1.5, bot - top);
  c.restore();
  c.font = `600 9px ${cl.mono}`;
  if (GS_PIC.key != null) gsLbl(c, gsKeyName(GS_PIC.key), x + 4, labelY, GS_HEAD_COL);
}

function gsPicLabel(c, w, cl, left, right) {
  c.font = `9px ${cl.mono}`;
  c.fillStyle = cl.t3;
  c.fillText(left, 8, 12);
  if (right) { c.textAlign = 'right'; c.fillText(right, w - 8, 12); c.textAlign = 'left'; }
}

function gsPicNote(c, g, cl) {
  c.font = `9px ${cl.mono}`;
  c.fillStyle = cl.t3;
  c.fillText(GS_PIC.note || 'Open a sound', 8, g.h - 8);
}

// ──────────────────────────────────────────────────────────────── at the head

/// The spectrum under the newest note, before and after its pitch, on a piano,
/// naming the note in the sound and the note you hear.
function gsDrawHeadPic() {
  const g = GS_CV.gsHeadPic, pcm = GS_PIC.pcm;
  if (!g) return;
  const { c, w, h } = g, cl = gsCl(), hd = gsHead();
  GS_PIC.drawn.head++;
  c.clearRect(0, 0, w, h);
  c.font = `9px ${cl.mono}`;
  if (!pcm) { gsPicLabel(c, w, cl, 'AT THE HEAD'); gsPicNote(c, g, cl); return; }
  const sp = gsHeadBands(pcm, hd), NB = GS_NB, fr = (k) => 40 * Math.pow(500, k / (NB - 1));
  const f0 = 50, f1 = 9000, X = (f) => 8 + Math.log(f / f0) / Math.log(f1 / f0) * (w - 16), kb = 10, base = h - kb - 5, top = 20, H0 = base - top;
  for (let m = 31; m <= 110; m++) {
    const x = X(440 * Math.pow(2, (m - 69.5) / 12)), x2 = X(440 * Math.pow(2, (m - 68.5) / 12));
    if (x2 < 8 || x > w - 8) continue;
    c.fillStyle = gsIsBlack(m) ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.16)';
    c.fillRect(Math.max(8, x) + 0.5, h - kb - 3, Math.max(1, Math.min(w - 8, x2) - Math.max(8, x) - 1), kb);
    if (m % 12 === 0) { c.fillStyle = cl.t3; c.fillText('C' + (m / 12 - 1), x + 1, h - kb - 6); }
  }
  const k = GS_PIC.keys, stp = (k ? k.pitch : GS_N.bend * GS.voice.bendR) + gsRead('semitones'), pr = Math.pow(2, stp / 12);
  const sv = (i) => Math.pow(sp[i], 1.7);
  const pts = (mul) => {
    const p = new Path2D();
    let first = true;
    for (let i = 0; i < NB; i++) {
      const f = fr(i) * mul;
      if (f < f0 || f > f1) continue;
      const x = X(f), y = base - sv(i) * H0;
      if (first) { p.moveTo(x, base); first = false; }
      p.lineTo(x, y);
    }
    return p;
  };
  const p0 = pts(1), pf = new Path2D(p0);
  pf.lineTo(X(Math.min(f1, fr(NB - 1))), base);
  c.fillStyle = 'rgba(150,160,182,.16)'; c.fill(pf);
  c.strokeStyle = 'rgba(150,160,182,.55)'; c.lineWidth = 1; c.stroke(p0);
  wvTrace(c, pts(pr), cl, 1.3, 0.7);
  // The strongest partial between 60 Hz and 2 kHz.
  let bk = -1, bv = 0;
  for (let i = 2; i < NB - 2; i++) {
    const f = fr(i);
    if (f < 60 || f > 2000) continue;
    const q = sp[i] + 0.5 * (sp[i - 1] + sp[i + 1]);
    if (q > bv) { bv = q; bk = i; }
  }
  if (bk > 0) {
    const a = sp[bk - 1], b = sp[bk], d = sp[bk + 1], off = (a - d) / (2 * (a - 2 * b + d) || 1);
    const f = 40 * Math.pow(500, (bk + wvClamp(off, -0.5, 0.5)) / (NB - 1)), y = base - sv(bk) * H0;
    c.setLineDash([2, 3]);
    c.strokeStyle = 'rgba(150,160,182,.6)'; c.beginPath(); c.moveTo(X(f), y); c.lineTo(X(f), base); c.stroke();
    c.strokeStyle = cl.acc; c.beginPath(); c.moveTo(X(f * pr), y); c.lineTo(X(f * pr), base); c.stroke();
    c.setLineDash([]);
    wvDot(c, X(f), y, 2.5, 'rgba(190,198,214,.9)');
    wvDot(c, X(f * pr), y, 3, cl.acc);
    c.font = `600 9px ${cl.mono}`;
    const t1 = 'source ' + gsNoteName(f);
    c.fillStyle = cl.t2; c.fillText(t1, 8, 12);
    c.fillStyle = cl.acc; c.fillText('heard ' + gsNoteName(f * pr), 8 + c.measureText(t1).width + 14, 12);
    c.font = `9px ${cl.mono}`;
  }
  c.fillStyle = cl.t3;
  c.textAlign = 'right';
  c.fillText(`AT THE HEAD · ${hd.toFixed(2)} s · ${stp >= 0 ? '+' : '−'}${Math.abs(stp).toFixed(2)} st`, w - 8, 12);
  c.textAlign = 'left';
}

// ──────────────────────────────────────────────────────────────── the time map

/// How fast the read moves through the sound, seconds of it a second.
function gsReadSpeed() {
  return (GS.engine === 'pvsola' ? 1 : gsRead('scan')) / gsRead('ratio');
}

/// Read position against time since the key went down, with its wraps: the path
/// a note takes from Start, and the place the head has got to.
function gsDrawMapPic() {
  const g = GS_CV.gsMapPic, f = gsFile();
  if (!g) return;
  const { c, w, h } = g, cl = gsCl();
  GS_PIC.drawn.map++;
  c.clearRect(0, 0, w, h);
  c.font = `9px ${cl.mono}`;
  if (!f) { gsPicLabel(c, w, cl, 'TIME MAP'); return; }
  const { a, b } = gsLoop(), L = b - a, sp = gsReadSpeed(), per = Math.abs(sp) > 1e-4 ? L / Math.abs(sp) : Infinity;
  const span = Number.isFinite(per) ? wvClamp(per * 2.3, 2, 90) : 8, top = 16, bot = h - 14;
  const Y = (s) => bot - s / f.len * (bot - top), X = (t) => 8 + t / span * (w - 16), cue = gsCue();
  c.fillStyle = 'rgba(124,240,208,.06)';
  c.fillRect(8, Y(b), w - 16, Y(a) - Y(b));
  c.strokeStyle = 'rgba(124,240,208,.35)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(8, Y(a)); c.lineTo(w - 8, Y(a)); c.moveTo(8, Y(b)); c.lineTo(w - 8, Y(b)); c.stroke();
  c.strokeStyle = GS_START; c.setLineDash([2, 3]);
  c.beginPath(); c.moveTo(8, Y(cue)); c.lineTo(w - 8, Y(cue)); c.stroke();
  c.setLineDash([]);
  // A held note goes round the brackets whatever the loop light says; the
  // transport, with Run on, only with it lit.
  const loops = !GS.voice.run || state.loopOn, n = 400, modp = (x, m) => ((x % m) + m) % m;
  let hd = cue, py = Y(hd);
  c.strokeStyle = cl.t; c.lineWidth = 1.3;
  c.beginPath(); c.moveTo(X(0), py);
  for (let i = 1; i <= n; i++) {
    let nh = hd + sp * span / n, jump = false;
    if (loops) {
      if (nh > b) { nh = a + modp(nh - a, L); jump = true; }
      else if (nh < a && sp < 0) { nh = b - modp(a - nh, L); jump = true; }
    } else nh = wvClamp(nh, 0, f.len);
    hd = nh;
    const x = X(i / n * span), y = Y(hd);
    if (jump) {
      c.stroke();
      c.setLineDash([2, 2]); c.strokeStyle = 'rgba(255,255,255,.25)';
      c.beginPath(); c.moveTo(x, py); c.lineTo(x, y); c.stroke();
      c.setLineDash([]); c.strokeStyle = cl.t;
      c.beginPath(); c.moveTo(x, y);
    } else c.lineTo(x, y);
    py = y;
  }
  c.stroke();
  if (gsHeadLive()) wvDot(c, X(Math.min((performance.now() - GS_PIC.t0) / 1000, span)), Y(gsHead()), 3.2, gsNoteHead() != null ? GS_HEAD_COL : '#fff');
  c.fillStyle = cl.t3;
  c.fillText('TIME MAP', 8, 11);
  c.textAlign = 'right';
  c.fillText(Number.isFinite(per) ? 'wraps every ' + gsFmtS(per) : 'frozen', w - 8, 11);
  c.fillText(gsFmtS(span) + ' →', w - 8, h - 3);
  c.textAlign = 'left';
  c.fillText('key down', 8, h - 3);
}

// ──────────────────────────────────────────────────────── the engine's close-up

function gsLensLabel() {
  const e = GS.engine;
  if (e === 'granular') return gsHeadLive() ? 'GRAIN SCHEDULE · last 2 s' : 'GRAIN SCHEDULE · next 2 s';
  if (e === 'wsola') return 'SPLICE · close-up at the head';
  if (e === 'hybrid') return 'SEPARATION · tone, hits and air at the head';
  if (e === 'pvsola') return `FRAME · re-anchored every ${Math.round(gsRead('anchorFrames'))} frames`;
  return 'FRAME · the spectrum under the head';
}

/// The sound itself round the head, scaled to what is there.
function gsLensWave(pcm, head, span, wy, A, X) {
  const d = pcm.data, i0 = Math.floor((head - span / 2) * pcm.sr), N = Math.floor(span * pcm.sr);
  let lp = 0.001;
  for (let i = 0; i < N; i += 7) lp = Math.max(lp, Math.abs(d[i0 + i] || 0));
  return wvPath((u) => [X(u), wy - (d[i0 + Math.floor(u * N)] || 0) / lp * A], 600);
}

/// A splice's window, as the Window choice draws it.
function gsSpliceWin(u, shape) {
  if (shape === 1) return 1 - Math.abs(2 * u - 1);
  if (shape === 2) return u > 0 && u < 1 ? 1 : 0;
  return gsEnvShape(u, 0.5);
}

/// WSOLA: the two windows being joined, the search round the join, the hits.
function gsLensSplice(c, w, h, cl, pcm, head) {
  const span = 0.3, X = (u) => 8 + u * (w - 16);
  const pts = gsLensWave(pcm, head, span, h * 0.5, h * 0.36, X);
  c.strokeStyle = `rgba(${cl.bloom},.25)`;
  c.lineWidth = 1;
  c.stroke(pts);
  const win = gsRead('windowMs') / 1000, srch = gsRead('searchMs') / 1000, ww = win / span, ov = gsRead('overlap'), shape = gsRead('spliceShape');
  for (const [o, dim] of [[-ww * 0.5, true], [ww * 0.5 * (1 - 1 / ov), false]]) {
    const x0 = X(0.5 + o - ww / 2), x1 = X(0.5 + o + ww / 2);
    c.save();
    c.beginPath(); c.rect(x0, 0, x1 - x0, h); c.clip();
    wvTrace(c, pts, cl, dim ? 1 : 1.4, dim ? 0.3 : 0.8);
    c.restore();
    c.strokeStyle = dim ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.55)';
    c.lineWidth = 1;
    c.stroke(wvPath((u) => [x0 + u * (x1 - x0), h - 14 - gsSpliceWin(u, shape) * Math.min(24, h * 0.3)], 30));
  }
  const sx = Math.max(8, X(0.5) - srch / span * (w - 16)), ex = Math.min(w - 8, X(0.5) + srch / span * (w - 16)), col = '#cfa66c';
  c.strokeStyle = col; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(sx, 22); c.lineTo(ex, 22); c.moveTo(sx, 18); c.lineTo(sx, 26); c.moveTo(ex, 18); c.lineTo(ex, 26); c.stroke();
  const pick = ['best', 'worst', 'loud'][gsRead('splicePick')], tx = gsRead('searchMs') < 0.25 ? 'plain OLA' : `search ±${gsRead('searchMs').toFixed(1)} ms · pick ${pick}`;
  c.fillStyle = col;
  c.fillText(tx, wvClamp(sx, 190, w - 8 - c.measureText(tx).width), 16);
  const thr = 0.3 + (1 - gsRead('sensitivity')) * 0.6, t0 = head - span / 2;
  c.strokeStyle = 'rgba(240,170,150,.9)'; c.lineWidth = 1;
  for (const o of pcm.on) {
    const u = (o.t - t0) / span;
    if (u < 0 || u > 1 || o.s < thr) continue;
    c.beginPath(); c.moveTo(X(u), 28); c.lineTo(X(u), h - 6); c.stroke();
  }
}

/// Vocoder and PVSOLA: one analysis frame's spectrum under its waveform, with
/// Freeze, Blur, Gate and the peaks it locks to.
function gsLensFrame(c, w, h, cl, pcm, head) {
  const span = 0.6, X = (u) => 8 + u * (w - 16), NB = GS_NB;
  const pts = gsLensWave(pcm, head, span, h * 0.3, h * 0.2, X);
  c.strokeStyle = `rgba(${cl.bloom},.25)`;
  c.lineWidth = 1;
  c.stroke(pts);
  wvTrace(c, pts, cl, 0.9, 0.3);
  const cur = gsHeadBands(pcm, head), fz = gsRead('magFreeze'), bl = gsRead('magBlur'), gate = gsRead('magGate'), pw = Math.round(gsRead('peakWidth'));
  if (!GS_PIC.held || fz < 0.005) GS_PIC.held = Float32Array.from(cur);
  const sy = h - 8, sh = h * 0.55, bw = (w - 16) / NB, held = GS_PIC.held, blurR = Math.round(bl * 6);
  for (let b = 0; b < NB; b++) {
    let v = cur[b] * (1 - fz) + held[b] * fz;
    if (bl > 0) {
      let s = 0, n = 0;
      for (let j = -blurR; j <= blurR; j++) { s += cur[wvClamp(b + j, 0, NB - 1)]; n++; }
      v = v * (1 - bl) + s / n * bl;
    }
    v = Math.pow(v, 1.8);
    c.fillStyle = v < gate * 0.8 ? 'rgba(255,255,255,.08)' : `rgba(${cl.bloom},${(0.25 + 0.6 * v).toFixed(3)})`;
    c.fillRect(8 + b * bw, sy - v * sh, Math.max(1, bw - 1), v * sh);
  }
  if (gate > 0.005) {
    const gy = sy - gate * 0.8 * sh, col = '#79bfc3';
    c.strokeStyle = col; c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(8, gy); c.lineTo(w - 8, gy); c.stroke();
    c.setLineDash([]);
    c.fillStyle = col; c.fillText('gate', w - 34, gy - 3);
  }
  for (let b = 2; b < NB - 2; b++) {
    const v = cur[b];
    if (v > 0.8 && v >= cur[b - 1] && v >= cur[b + 1] && v >= cur[b - 2] && v >= cur[b + 2]) {
      c.fillStyle = 'rgba(169,155,224,.25)';
      c.fillRect(8 + (b - pw / 2) * bw, sy - sh - 4, pw * bw, sh + 4);
      wvDot(c, 8 + (b + 0.5) * bw, sy - v * sh - 4, 2, '#a99be0');
    }
  }
  if (GS.engine === 'pvsola') {
    // Where the anchors really fall in this stretch of the sound.
    const fn = gsRead('vocWindowMs') / 1000 / 2 * gsRead('anchorFrames'), t0 = head - span / 2;
    c.fillStyle = '#cfa66c';
    if (span / fn < 200) for (let s = Math.ceil(t0 / fn) * fn; s < t0 + span; s += fn) {
      const x = X((s - t0) / span);
      c.beginPath(); c.moveTo(x - 3, 18); c.lineTo(x + 3, 18); c.lineTo(x, 23); c.fill();
    }
  }
}

/// Hybrid's split of the sound round the head, as the engine's rule makes it:
/// smoothed along time is tone, smoothed along frequency is hits; whichever
/// out-shouts the other by Margin wins and the rest is air.
function gsSeparate(pcm, head) {
  const key = ['timeSpan', 'freqSpan', 'margin', 'fftSize', 'harmonicLevel', 'percussiveLevel', 'residualLevel'].map(gsRead).join('|');
  const old = GS_PIC.sep;
  if (old && old.pcm === pcm && old.key === key && Math.abs(old.head - head) < 0.06) return old;
  const span = 1.4, C = 170, NB = GS_NB, cols = new Float32Array(C * NB), hop = span / C;
  const start = head - span / 2;
  const frame = new Float32Array(NB);
  for (let c = 0; c < C; c++) {
    gsBandsInto(pcm, Math.round((start + (c + 0.5) * hop) * pcm.sr), frame);
    cols.set(frame, c * NB);
  }
  // Hold and Spread are in the engine's frames and bins; its hop is a quarter
  // of Resolution. Spread is on these log bands the way the mock-up had it.
  const hopE = gsRead('fftSize') / 4 / pcm.sr, kt = Math.max(1, Math.round(gsRead('timeSpan') / 2 * hopE / hop)), kf = Math.max(1, Math.round(gsRead('freqSpan') / 4)), mg = gsRead('margin');
  const pw = cols.map((v) => Math.pow(10, (v * 80 - 80) / 10));
  const L = ['harmonicLevel', 'percussiveLevel', 'residualLevel'].map((k) => Math.min(1.4, gsRead(k)));
  const lanes = [new Float32Array(C), new Float32Array(C), new Float32Array(C)];
  let top = 1e-6;
  for (let c = 0; c < C; c++) {
    for (let b = 0; b < NB; b++) {
      let hs = 0, hn = 0, ps = 0, pn = 0;
      for (let j = -kt; j <= kt; j++) { const q = c + j; if (q >= 0 && q < C) { hs += pw[q * NB + b]; hn++; } }
      for (let j = -kf; j <= kf; j++) { const q = b + j; if (q >= 0 && q < NB) { ps += pw[c * NB + q]; pn++; } }
      const h = hs / hn, p = ps / pn, cls = h > p * mg ? 0 : p > h * mg ? 1 : 2;
      lanes[cls][c] += Math.pow(cols[c * NB + b], 1.5) * L[cls];
    }
    for (let r = 0; r < 3; r++) if (lanes[r][c] > top) top = lanes[r][c];
  }
  GS_PIC.sep = { pcm, key, head, start, hop, C, lanes, top, span };
  return GS_PIC.sep;
}

/// Hybrid: tone, hits and air, a lane each, moving with the head.
function gsLensSeparation(c, w, h, cl, pcm, head) {
  const sep = gsSeparate(pcm, head), rows = [['TONE', GS_SEP_COL.tone, 'harmonicLevel'], ['HITS', GS_SEP_COL.hits, 'percussiveLevel'], ['AIR', GS_SEP_COL.air, 'residualLevel']];
  const top = 17, rh = (h - top - 3) / 3, narrow = rh < 11, lx = narrow ? 8 : 72, W = w - lx - 8, t0 = head - 0.6, X = (t) => lx + (t - t0) / 1.2 * W;
  c.save();
  c.beginPath(); c.rect(lx, top - 1, W, h - top + 1); c.clip();
  rows.forEach(([, col], r) => {
    const mid = top + r * rh + rh / 2, e = sep.lanes[r], A = rh * 0.46;
    const up = new Path2D();
    for (let i = 0; i < sep.C; i++) {
      const v = Math.sqrt(e[i] / sep.top) * A, x = X(sep.start + (i + 0.5) * sep.hop);
      if (i) up.lineTo(x, mid - v); else up.moveTo(x, mid - v);
    }
    for (let i = sep.C - 1; i >= 0; i--) up.lineTo(X(sep.start + (i + 0.5) * sep.hop), mid + Math.sqrt(e[i] / sep.top) * A);
    up.closePath();
    c.fillStyle = col; c.globalAlpha = 0.55; c.fill(up);
    c.globalAlpha = 1; c.strokeStyle = col; c.lineWidth = 0.8; c.stroke(up);
  });
  c.restore();
  c.fillStyle = 'rgba(255,255,255,.55)';
  c.fillRect(X(head) - 0.5, top - 1, 1, h - top + 1);
  // Lanes too thin to name are named along the top.
  let right = w - 8;
  (narrow ? [...rows].reverse() : rows).forEach(([n, col, k], r) => {
    const tx = `${n} ${gsLvl(gsRead(k))}`;
    c.fillStyle = col;
    if (!narrow) { c.fillText(tx, 8, top + r * rh + rh / 2 + 3); return; }
    right -= c.measureText(tx).width;
    c.fillText(tx, right, 12);
    right -= 12;
  });
}

/// Granular: where the grains read against time, each its own window. While it
/// sounds, the grains that did; while it is still, the engine's own plan.
function gsLensSchedule(c, w, h, cl) {
  const f = gsFile();
  if (!f) return;
  const live = gsHeadLive(), sc = gsReadSpeed(), sp = gsRead('positionJitterMs') / 1000;
  const { a, b } = gsLoop(), L0 = (b - a) || f.len;
  const ctr = gsReadWrap(gsHead() + gsRead('position') * f.len), half = Math.max(0.15, sp * 1.6 + Math.abs(sc) * 2.2);
  const Y = (s) => h / 2 + 4 - ((((s - ctr + L0 / 2) % L0) + L0) % L0 - L0 / 2) / half * (h / 2 - 18);
  // Past on the left and now on the right while it plays; now on the left and
  // what is coming on the right while it does not.
  const X = live ? (age) => w - 8 - age / 2 * (w - 16) : (dt) => 8 + dt / 2 * (w - 16), sgn = live ? -1 : 1;
  c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1;
  for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(8 + i * (w - 16) / 8, 18); c.lineTo(8 + i * (w - 16) / 8, h - 6); c.stroke(); }
  const far = ctr + sgn * 2 * sc, x0 = X(0), x1 = X(2);
  if (sp > 0) {
    c.fillStyle = 'rgba(124,240,208,.06)';
    c.beginPath(); c.moveTo(x0, Y(ctr + sp)); c.lineTo(x1, Y(far + sp)); c.lineTo(x1, Y(far - sp)); c.lineTo(x0, Y(ctr - sp)); c.fill();
  }
  c.strokeStyle = 'rgba(255,255,255,.18)'; c.setLineDash([3, 4]);
  c.beginPath(); c.moveTo(x0, Y(ctr)); c.lineTo(x1, Y(far)); c.stroke();
  c.setLineDash([]);
  const pk = 0.06 + 0.88 * gsRead('envelope'), base = gsRead('semitones');
  const bell = (x, y, size, hh, al) => {
    const bw = Math.max(3, size / 2 * (w - 16));
    c.strokeStyle = `rgba(${cl.bloom},${al.toFixed(2)})`;
    c.lineWidth = 1;
    c.stroke(wvPath((u) => [x - bw / 2 + u * bw, y - gsEnvShape(u, pk) * hh], 12));
  };
  let n = 0;
  if (live) {
    const now = performance.now();
    for (let i = GS_PIC.ev.length - 1; i >= 0 && n < 320; i--, n++) {
      const e = GS_PIC.ev[i], age = (now - e.at) / 1000;
      if (age > 2) break;
      // How far from the note a grain was thrown lifts it: the only size the
      // engine reports besides its length.
      bell(X(age), Y(e.src), e.size, 6 + Math.min(8, Math.abs(e.semis - base)), 0.2 + 0.65 * (1 - age / 2));
    }
  } else {
    const g = state.grains, sr = g?.sampleRate || f.sr;
    const at = engineFromSrc(gsCue() * f.sr) / (engine.deviceRate || 48000) * sr, span = 2 * sr;
    for (const ev of g?.grains || []) {
      if (ev[0] < at || ev[0] > at + span || n >= 260) continue;
      const dt = (ev[0] - at) / sr;
      bell(X(dt), Y(ev[1] / sr), ev[2] / sr, 5 + 7 * wvClamp((ev[4] || 0) * 4), 0.2 + 0.65 * (1 - dt / 2));
      n++;
    }
  }
  wvDot(c, x0, Y(ctr), 3, cl.acc);
  c.fillStyle = cl.t3;
  c.fillText(`±${Math.round(half * 1000)} ms round the head`, 8, h - 6);
  if (!n) c.fillText(live ? 'no grains are sounding' : 'nothing planned at Start', 8, h / 2 + 3);
}

function gsDrawLens() {
  const g = GS_CV.gsLens, pcm = GS_PIC.pcm;
  if (!g) return;
  const { c, w, h } = g, cl = gsCl(), e = GS.engine;
  GS_PIC.drawn.lens++;
  c.clearRect(0, 0, w, h);
  gsPicLabel(c, w, cl, gsLensLabel(), e === 'granular' ? 'read position ↑ · time →' : '');
  if (e === 'granular') { gsLensSchedule(c, w, h, cl); return; }
  if (!pcm) { gsPicNote(c, g, cl); return; }
  const head = gsHead();
  if (e === 'wsola') gsLensSplice(c, w, h, cl, pcm, head);
  else if (e === 'hybrid') gsLensSeparation(c, w, h, cl, pcm, head);
  else gsLensFrame(c, w, h, cl, pcm, head);
}

// ─────────────────────────────────────────────────────── before and after the chain

/// Before the chain, thin and grey, and after it, bright and filled, on one
/// scale. Stopped there is no after; before is then the loop itself.
function gsDrawFxWave(c, w, h, cl, m) {
  const read = (xy) => (xy && xy.length >= 8 ? (u) => { const n = xy.length / 2, i = Math.min(n - 1, Math.floor(u * n)); return xy[i * 2] + xy[i * 2 + 1]; } : null);
  let pre = read(m?.pre?.lissajous), peak = 0.05, label = 'LIVE';
  const post = read(m?.lissajous), pcm = GS_PIC.pcm;
  if (!post && pcm) {
    const { a, b } = gsLoop(), i0 = Math.floor(a * pcm.sr), N = Math.max(1, Math.floor((b - a) * pcm.sr));
    pre = (u) => (pcm.data[i0 + Math.floor(u * N)] || 0) / pcm.peak * 1.6;
    label = 'the loop';
  } else if (!post) label = '';
  const pts = 700, measure = (fn) => { for (let i = 0; i <= pts; i++) peak = Math.max(peak, Math.abs(fn(i / pts))); };
  if (pre) measure(pre);
  if (post) measure(post);
  const curve = (fn) => wvPath((u) => [8 + u * (w - 16), h / 2 - fn(u) / peak * h * 0.42], pts);
  c.fillStyle = 'rgba(255,255,255,.05)';
  c.fillRect(8, h / 2, w - 16, 1);
  if (pre) { c.strokeStyle = 'rgba(150,160,182,.45)'; c.lineWidth = 0.8; c.stroke(curve(pre)); }
  if (post) {
    const p = curve(post), f = new Path2D(p);
    f.lineTo(w - 8, h / 2); f.lineTo(8, h / 2);
    c.fillStyle = `rgba(${cl.bloom},.12)`; c.fill(f);
    wvTrace(c, p, cl, 1.2, 0.8);
  }
  c.font = `9px ${cl.mono}`;
  c.fillStyle = 'rgba(150,160,182,.8)'; c.fillText('before', 10, 11);
  if (post) { c.fillStyle = cl.t; c.fillText('after', 54, 11); }
  c.fillStyle = cl.t3; c.textAlign = 'right'; c.fillText(label, w - 8, 11); c.textAlign = 'left';
}

function gsDrawFxSpectrum(c, w, h, cl, m) {
  const X = (u) => 8 + u * (w - 16), Y = (v) => h - 4 - wvClamp(v) * (h - 10);
  const read = (b) => (b?.length ? (u) => (b[Math.min(b.length - 1, Math.floor(u * b.length))] + 84) / 84 : null);
  let before = read(m?.pre?.spectrum), label = 'LIVE';
  const after = read(m?.spectrum), pcm = GS_PIC.pcm;
  if (!after && pcm) {
    const sp = gsHeadBands(pcm, gsHead());
    before = (u) => sp[wvClamp(Math.round(Math.log(20 * Math.pow(1000, u) / 40) / Math.log(500) * (GS_NB - 1)), 0, GS_NB - 1)] * 0.85;
    label = 'at the head';
  } else if (!after) label = '';
  c.font = `9px ${cl.mono}`;
  for (const [f, tx] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
    const x = X(Math.log(f / 20) / Math.log(1000));
    c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x, 0, 1, h);
    c.fillStyle = cl.t3; c.fillText(tx, x + 3, h - 4);
  }
  if (before) { c.strokeStyle = `rgba(${cl.bloom},.28)`; c.lineWidth = 1; c.stroke(wvPath((u) => [X(u), Y(before(u))], 300)); }
  if (after) {
    const p = wvPath((u) => [X(u), Y(after(u))], 300);
    wvUnder(c, p, 8, w - 8, h, 0, cl, 0.14);
    wvTrace(c, p, cl, 1.2, 0.6);
  }
  c.fillStyle = cl.t3; c.textAlign = 'right'; c.fillText(label, w - 8, 11); c.textAlign = 'left';
}

// ──────────────────────────────────────────────────────────────── the frame

/// Every frame, on whichever view is in front.
/// A note has finished with the transport stopped. The poll is stopping, so what
/// it last painted is put back by hand, a moment after, as a pause does.
function gsMetersFall() {
  if (GS_PIC.metersOn && !engine.playing) {
    setTimeout(() => {
      if (gsMetersLive()) return;
      engine.spectrum = null;
      resetRackMeters();
      repaintVisualEqs();
    }, 120);
  }
  GS_PIC.metersOn = false;
}

function gsPicLeave() {
  GS_PIC.keys = null;
  GS_PIC.ev.length = 0;
  gsMetersFall();
}

function gsPicKeep() {
  gsPcmLoad();
  const newest = [...GS_N.held.keys(), ...GS_N.midi].pop();
  if (newest != null) GS_PIC.key = newest;
  // A transport start is a key going down, as far as the time map goes.
  if (engine.playing && !GS_PIC.wasPlaying) GS_PIC.t0 = performance.now();
  GS_PIC.wasPlaying = engine.playing;
  if (gsPollWanted() && !noAudio()) { startPolling(); GS_PIC.metersOn = true; }
  else gsMetersFall();
}

const GS_PIC_PARAMS = ['semitones', 'ratio', 'scan', 'position', 'positionJitterMs', 'windowMs', 'overlap', 'envelope', 'wrap', 'searchMs', 'splicePick', 'spliceShape', 'sensitivity', 'vocWindowMs', 'magFreeze', 'magBlur', 'magGate', 'peakWidth', 'anchorFrames', 'harmonicLevel', 'percussiveLevel', 'residualLevel', 'timeSpan', 'freqSpan', 'margin', 'fftSize'];

/// The pictures under the controls: only those on screen, only when something
/// they show has moved, and no more than thirty times a second.
function gsPicTick(now) {
  const row = $('gsHeadRow').style.display !== 'none', lens = $('gsLensWell').style.display !== 'none';
  if (!row && !lens) return;
  const live = gsHeadLive();
  if (live && now - GS_PIC.last < 30) return;
  const { a, b } = gsLoop();
  const key = [live ? now : 0, GS.engine, GS_PIC.pcm ? GS_PIC.serial : GS_PIC.note, gsCue(), a, b, state.loopOn, GS.voice.run, GS_N.bend, state.grains?.total].concat(GS_PIC_PARAMS.map(gsRead)).join('|');
  if (key === GS_PIC.drawKey) return;
  GS_PIC.drawKey = key;
  GS_PIC.last = now;
  if (row) { gsDrawHeadPic(); gsDrawMapPic(); }
  if (lens) gsDrawLens();
}
