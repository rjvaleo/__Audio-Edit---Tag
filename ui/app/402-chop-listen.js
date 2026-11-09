// ═════════════════════════════════════════════ Chop: listening to it ══
//
// Everything the page knows about the sound itself: the tempo and the bars, and
// the measures behind the colour on the waveform. The measures are the
// library's own (`core/crates/search/src/lib.rs`, `pitch.rs`), taken on every
// 11 ms and on every slice instead of once for the file.

/// The measures of every frame. Pure, and written to run in a worker: it is
/// handed the samples and touches nothing else.
function chopAnalyseCore(m, sr) {
  const N = 2048, HOP = 512, half = N >> 1;
  const F = Math.max(1, Math.floor((m.length - N) / HOP) + 1);
  const mk = () => new Float32Array(F);
  const low = mk(), mid = mk(), high = mk(), cent = mk(), flat = mk(), zcr = mk(), rms = mk(), rise = mk(), hz = mk(), clar = mk();
  const re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(half + 1);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const bin = sr / N, k250 = Math.floor(250 / bin), k4k = Math.floor(4000 / bin);

  function fft() {
    for (let i = 1, j = 0; i < N; i++) {
      let b = N >> 1;
      for (; j & b; b >>= 1) j ^= b;
      j ^= b;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let l = 2; l <= N; l <<= 1) {
      const a = -2 * Math.PI / l, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += l) {
        let cr = 1, ci = 0;
        for (let j = 0; j < l >> 1; j++) {
          const k = i + j, n = k + (l >> 1);
          const xr = re[n] * cr - im[n] * ci, xi = re[n] * ci + im[n] * cr;
          re[n] = re[k] - xr; im[n] = im[k] - xi; re[k] += xr; im[k] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  let prevDb = 0, pre = 0;
  for (let f = 0; f < F; f++) {
    const p = f * HOP;
    for (let i = 0; i < N; i++) { re[i] = (m[p + i] || 0) * win[i]; im[i] = 0; }
    fft();
    let tot = 1e-9, cs = 0, lg = 0, lo = 0, hi = 0;
    for (let k = 0; k <= half; k++) {
      const v = Math.hypot(re[k], im[k]);
      mag[k] = v; tot += v; cs += k * bin * v; lg += Math.log(Math.max(v, 1e-9));
      if (k < k250) lo += v;
      if (k >= k4k) hi += v;
    }
    low[f] = lo / tot; high[f] = hi / tot; mid[f] = 1 - low[f] - high[f];
    cent[f] = cs / tot;
    // Geometric over arithmetic mean: 1 for noise, near 0 for a pure tone.
    flat[f] = Math.min(1, Math.exp(lg / (half + 1)) / (tot / (half + 1)));

    let z = 0, e = 0, ed = 0;
    const c0 = p + half - (HOP >> 1);
    for (let i = 0; i < HOP; i++) {
      const v = m[c0 + i] || 0, u = m[c0 + i - 1] || 0;
      if (i && (u < 0) !== (v < 0)) z++;
      e += v * v;
      const d = v - 0.97 * pre;
      pre = v;
      ed += d * d;
    }
    zcr[f] = z / (HOP - 1);
    rms[f] = Math.sqrt(e / HOP);
    const db = 10 * Math.log10(ed / HOP + 1e-10);
    rise[f] = f ? Math.max(0, db - prevDb) : 0;
    prevDb = db;
  }

  // Attack: the rise in energy, as Sens hears it, held so a hit shows and falls.
  const sorted = Float32Array.from(rise).sort();
  const r99 = sorted[Math.floor(F * 0.99)] || 1;
  for (let f = 0; f < F; f++) rise[f] = Math.min(1, rise[f] / r99);
  for (let f = 1; f < F; f++) rise[f] = Math.max(rise[f], rise[f - 1] * 0.8);

  // The note, by YIN as in `pitch.rs`, on 12 kHz: the first dip under .15. The
  // depth of the dip is the clarity. A long sound is sampled less often.
  const dec = Math.max(1, Math.round(sr / 12000)), rate = sr / dec, M = Math.floor(m.length / dec);
  const d = new Float32Array(M);
  for (let i = 0; i < M; i++) { let v = 0; for (let j = 0; j < dec; j++) v += m[i * dec + j]; d[i] = v / dec; }
  const W = 512, tMax = Math.min(W - 2, Math.floor(rate / 35)), tMin = Math.max(2, Math.floor(rate / 2000));
  const step = Math.max(2, Math.ceil(F / 1500));
  const delta = (at, t) => { let v = 0; for (let i = 0; i < W; i += 2) { const q = d[at + i] - d[at + i + t]; v += q * q; } return v; };
  for (let f = 0; f < F; f += step) {
    const at = Math.floor((f * HOP + half) / dec) - (W >> 1);
    let found = 0, clarity = 0;
    if (at >= 0 && at + W + tMax < M) {
      let sum = 0, min = 1;
      for (let t = 1; t <= tMax && !found; t++) {
        const v = delta(at, t);
        sum += v;
        let cm = sum > 0 ? v * t / sum : 1;
        if (t < tMin) continue;
        if (cm < min) min = cm;
        if (cm >= 0.15) continue;
        // Under the threshold: walk down to the bottom of this dip.
        let tt = t;
        while (tt < tMax) {
          const v2 = delta(at, tt + 1), nx = (sum + v2) > 0 ? v2 * (tt + 1) / (sum + v2) : 1;
          if (nx >= cm) break;
          cm = nx; sum += v2; tt++;
        }
        found = tt;
        clarity = 1 - cm;
      }
      if (!found) clarity = Math.max(0, 1 - min);
    }
    for (let k = f; k < Math.min(F, f + step); k++) { hz[k] = found ? rate / found : 0; clar[k] = clarity; }
  }

  // The two measures of the whole sound: does it repeat, and how busy is it.
  const hopE = Math.max(1, Math.floor(sr * 0.01)), E = new Float32Array(Math.floor(m.length / hopE));
  let mean = 0;
  for (let i = 0; i < E.length; i++) {
    let v = 0;
    for (let j = 0; j < hopE; j += 2) v += m[i * hopE + j] ** 2;
    E[i] = Math.sqrt(v / (hopE / 2));
    mean += E[i];
  }
  mean /= E.length || 1;
  let on = 0, armed = true;
  for (let i = 1; i < E.length; i++) {
    if (E[i] > E[i - 1] * 1.6 && E[i] > mean * 0.8 && armed) { on++; armed = false; }
    else if (E[i] < mean * 0.6) armed = true;
  }
  const C = E.map((v) => v - mean);
  let total = 0, pulse = 0;
  for (const v of C) total += v * v;
  for (let l = 6; l < Math.min(200, Math.floor(C.length / 2)); l++) {
    let a = 0;
    for (let i = 0; i + l < C.length; i++) a += C[i] * C[i + l];
    const s = a / (total * Math.max(0.1, (C.length - l) / C.length) + 1e-9);
    if (s > pulse) pulse = s;
  }
  return { F, HOP, N, low, mid, high, cent, flat, zcr, rms, rise, hz, clar, pulse: Math.min(1, pulse), hits: on / (m.length / sr) };
}

let chopWorker = null;
let chopAnalysing = Promise.resolve();

/// Measure the sound once, in a worker so a whole song does not stop the page.
/// The waveform is plain white until the answer comes.
function chopAnalyse() {
  const serial = ++chop.loading;
  chop.an = null;
  const mono = chop.mono.slice(0);
  chopAnalysing = new Promise((resolve) => {
    const take = (an) => { if (serial === chop.loading && chop.mono) { chop.an = an; chopChanged(); } resolve(); };
    try {
      if (chopWorker) chopWorker.terminate();
      const body = `onmessage = (e) => { postMessage((${chopAnalyseCore.toString()})(e.data.m, e.data.sr)); };`;
      chopWorker = new Worker(URL.createObjectURL(new Blob([body], { type: 'text/javascript' })));
      chopWorker.onmessage = (e) => take(e.data);
      chopWorker.onerror = () => take(chopAnalyseCore(mono, chop.rate));
      chopWorker.postMessage({ m: mono, sr: chop.rate });
    } catch {
      take(chopAnalyseCore(mono, chop.rate));
    }
  });
}

const CHOP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const chopNote = (hz) => {
  const m = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${CHOP_NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};
const chopMedian = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);

/// A slice, measured. Frames are weighted by how loud they are, so the tail
/// after a hit does not decide what the hit is.
function chopMeasure(x) {
  const an = chop.an;
  const clampF = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const a = clampF(Math.floor((x.s - an.N / 2) / an.HOP), 0, an.F - 1);
  const b = clampF(Math.ceil((x.e - an.N / 2) / an.HOP), a + 1, an.F);
  const g = { low: 0, mid: 0, high: 0, cent: 0, flat: 0, zcr: 0 };
  const notes = [], clarity = [];
  let w = 0;
  for (let f = a; f < b; f++) {
    const r = an.rms[f] ** 2 + 1e-12;
    w += r;
    for (const k in g) g[k] += an[k][f] * r;
    if (an.clar[f] > 0.7 && an.hz[f] > 0) notes.push(an.hz[f]);
    clarity.push(an.clar[f]);
  }
  for (const k in g) g[k] /= w;
  const m = chop.mono, st = Math.max(1, Math.floor((x.e - x.s) / 20000));
  let pk = 0, e = 0;
  for (let i = x.s; i < x.e; i += st) { const v = Math.abs(m[i]); if (v > pk) pk = v; e += v * v; }
  const rms = Math.sqrt(e / ((x.e - x.s) / st)) + 1e-9;
  const R = { ...g, db: 20 * Math.log10(rms), peakDb: 20 * Math.log10(pk + 1e-9), crest: 20 * Math.log10(pk / rms + 1e-9),
    dur: (x.e - x.s) / chop.rate * 1000, clarity: chopMedian(clarity), hz: notes.length >= Math.max(2, (b - a) * 0.35) ? chopMedian(notes) : 0 };
  R.kind = chopKindOf(R);
  return R;
}

/// Attack, as `attack()` in the library: from a tenth of the first event's
/// loudest to nine tenths of its top. Only ever wanted for the picked slice.
function chopAttackMs(x) {
  const m = chop.mono, hop = Math.max(1, Math.floor(chop.rate / 1000)), bins = [];
  for (let i = x.s; i < Math.min(x.e, x.s + chop.rate * 2); i += hop) {
    let v = 0;
    for (let j = 0; j < hop; j++) v = Math.max(v, Math.abs(m[i + j] || 0));
    bins.push(v);
  }
  const env = bins.map((_, i) => { let v = 0; for (let j = i; j < Math.min(bins.length, i + 30); j++) v = Math.max(v, bins[j]); return v; });
  let loud = 1e-9;
  for (const v of env) if (v > loud) loud = v;
  const start = Math.max(0, env.findIndex((v) => v >= loud * 0.1));
  let top = 0, end = env.length;
  for (let k = start; k < env.length; k++) {
    if (env[k] > top) top = env[k];
    else if (env[k] < top * 0.5) { end = k; break; }
  }
  for (let k = start; k < end; k++) if (env[k] >= top * 0.9) return k - start;
  return 0;
}

/// What a hit most likely is. An opinion from the measures, like the library's
/// own classifier: thresholds set from the measures of real loops, and it will
/// sometimes be wrong.
function chopKindOf(m) {
  if (m.db < -48) return 'Quiet';
  if (m.low > 0.55 && m.cent < 2000 && m.dur < 300) return 'Kick';
  if (m.low > 0.4 && m.hz && m.hz < 200 && m.clarity > 0.7 && (m.dur >= 150 || m.low > 0.6)) return 'Bass';
  if (m.low > 0.6) return 'Bass';
  if (m.high > 0.6 && m.cent > 6800) return 'Hat';
  if (m.low < 0.3 && m.high > 0.2 && (m.flat > 0.1 || m.zcr > 0.05)) return 'Snare';
  if (m.hz >= 200 && m.clarity > 0.72 && m.flat < 0.1) return 'Tone';
  return 'Perc';
}

function chopMeasureSlices() {
  if (chop.an) for (const x of chop.slices) x.m = chopMeasure(x);
}

// ─────────────────────────────────────────────── the tempo and the bars

/// How strongly the hits repeat at each lag: the rise in energy, correlated
/// with itself. At most a minute is read, from the middle of S to E.
function chopTempoCurve() {
  const { mono, rate } = chop, HOP = 256, most = Math.round(rate * 60);
  const S0 = chop.region.s, E0 = chop.region.e;
  const S = E0 - S0 > most ? S0 + Math.floor((E0 - S0 - most) / 2) : S0;
  const E = E0 - S0 > most ? S + most : E0;
  const n = Math.floor((E - S) / HOP);
  if (n < 64) return null;
  const db = new Float32Array(n);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    let acc = 0;
    const a = S + k * HOP;
    for (let j = a; j < a + HOP; j++) { const d = mono[j] - 0.97 * prev; prev = mono[j]; acc += d * d; }
    db[k] = 10 * Math.log10(acc / HOP + 1e-10);
  }
  const rise = new Float32Array(n);
  let m = 0;
  for (let k = 1; k < n; k++) { rise[k] = Math.max(0, db[k] - db[k - 1]); m += rise[k]; }
  m /= n;
  for (let k = 0; k < n; k++) rise[k] -= m;
  const hop = HOP / rate, maxLag = Math.min(n - 1, Math.ceil(5.2 / hop)), ac = new Float32Array(maxLag + 2);
  for (let l = 0; l <= maxLag; l++) {
    let v = 0;
    for (let k = 0; k + l < n; k++) v += rise[k] * rise[k + l];
    ac[l] = v / (n - l);
  }
  const at = (lag) => {
    if (lag >= maxLag) return 0;
    const i = Math.floor(lag), u = lag - i;
    return ac[i] * (1 - u) + ac[i + 1] * u;
  };
  // A tempo scores for hits at its beat and its multiples, and leans towards
  // 120, which is what settles half and double time.
  return (bpm) => {
    const beat = 60 / bpm / hop;
    let v = 0, w = 0;
    for (const [q, g] of [[1, 1], [2, 0.8], [4, 0.7], [0.5, 0.35], [8, 0.5]]) {
      const lag = beat * q;
      if (lag >= maxLag) continue;
      v += g * at(lag);
      w += g;
    }
    return (v / (w || 1)) / ac[0] * Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
  };
}

/// The tempo, and how many whole bars S to E is at the time signature. A loop
/// is nearly always whole bars, so a whole count wins when it scores nearly as
/// well as the best tempo; the tempo is then exactly what makes the bars even.
function chopFindTempo() {
  const T = chopTempoCurve();
  if (!T) return null;
  const sec = (chop.region.e - chop.region.s) / chop.rate;
  let free = 0, fs = -1e9;
  for (let b = 60; b <= 200; b += 0.25) { const v = T(b); if (v > fs) { fs = v; free = b; } }
  let bars = 0, bs = -1e9, whole = 0;
  for (let n = 1; n <= 999; n++) {
    const b = n * cp.sig * 60 / sec;
    if (b < 60) continue;
    if (b > 200) break;
    const v = T(b);
    if (v > bs) { bs = v; bars = n; whole = b; }
  }
  const sure = Math.max(0, Math.min(1, fs / 0.35));
  const total = Math.max(1, Math.round(sec * free / 60)), even = total * 60 / sec;
  const nb = Math.max(1, Math.floor(total / cp.sig)), rest = total < cp.sig ? 0 : total % cp.sig;
  if (bars > 0 && bs >= fs * 0.8) return { bpm: whole, heard: free, bars, beats: 0, whole: true, off: 0, sure };
  if (!rest && Math.abs(even - free) / free < 0.015) return { bpm: even, heard: free, bars: nb, beats: 0, whole: true, off: 0, sure };
  return { bpm: even, heard: free, bars: nb, beats: rest, whole: false, off: (total * 60 / free - sec) * 1000, sure };
}

/// What Detect last found, in words, for Time's header.
const chopTempoSaid = { text: '' };

function chopSetBars(bars, beats) {
  for (const slot of [chopSlots.a, chopSlots.b]) { slot.bars = bars; slot.beats = beats; }
  chopSaveSettings();
  chopRecut();
  chopReflect();
}

/// Find the tempo and count the bars. With no beat to find, Bars is left alone.
function chopDetect() {
  if (!chop.mono) return;
  const r = chopFindTempo();
  if (!r || r.sure < 0.12) { chopTempoSaid.text = 'no clear beat'; chopReflect(); return; }
  const count = `${r.bars} bar${r.bars === 1 ? '' : 's'}${r.beats ? ` + ${r.beats}` : ''}`;
  chopTempoSaid.text = (r.whole ? `${count}, loops even`
    : `heard ${r.heard.toFixed(1)} · ${Math.abs(r.off).toFixed(0)} ms ${r.off > 0 ? 'short of' : 'over'} ${count}`)
    + (r.sure < 0.35 ? ' (a guess)' : '');
  chopSetBars(r.bars, r.beats);
}

/// ½× and 2×: it heard half or double time.
function chopScaleBars(f) {
  const total = Math.max(1, Math.round((cp.bars * cp.sig + cp.beats) * f));
  const bars = Math.floor(total / cp.sig);
  chopTempoSaid.text = `${Math.max(1, bars)} bar${Math.max(1, bars) === 1 ? '' : 's'}${bars && total % cp.sig ? ` + ${total % cp.sig}` : ''}, by hand`;
  chopSetBars(Math.max(1, bars), bars ? total % cp.sig : 0);
}
