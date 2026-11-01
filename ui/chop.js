// Chop: Recycle Reborn in the dock.
//
// Recycle Reborn (github.com/rjvaleo/Recycle-Reborn, RJ's) finds the sounds in
// a file by the silences between them, draws them as coloured slices on the
// waveform, plays each one, gives each an optional ReCycle-style ping-pong loop
// tail, and writes them out as 16-bit WAVs. This is that, as a panel working on
// the selected sound.
//
// **Carried over line for line:** `buildRms`, `detectSegs`, `getTailParams`,
// `buildPingPongTail` and the WAV encoder. The only change is that what they
// read from globals in the original (the sample rate, the file's length, its
// channels) they are now handed. `tests/ui/chop.spec.mjs` pins them to the
// original's own output on the same signal.
//
// **What is this app's instead:**
// - the sound is the selected one, fetched from `/audio` (which hands back WAV
//   for every format, so the original's AIFF parser has no work to do here);
// - a slice plays through the engine, the way everything in this app plays,
//   not through a Web Audio context of the panel's own;
// - Write slices puts them beside the sound, in `<name> slices/`, through
//   `/api/chop/save`, rather than downloading a ZIP. They are in the library at
//   once: in Browse, on the sound map, ready to play.

const CHOP_COLORS = ['#00e5ff', '#ff2d6b', '#00ff99', '#ffaa00', '#c084fc', '#f97316', '#38bdf8', '#a3e635', '#fb7185', '#fde047', '#67e8f9', '#d946ef', '#4ade80', '#fb923c'];
const CHOP_FRAME = 512;

const chop = {
  path: '',            // the library path of the sound being chopped
  stem: 'sample',      // its name without the extension, for the slices' names
  rate: 1,
  channels: [],        // Float32Array per channel
  mono: null,
  rms: null,
  segs: [],
  current: -1,         // the slice picked or playing
  playing: null,       // { s, e, stopAt } while a slice plays
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

function chopEncodeWAVWithTail(startSample, endSample) {
  const { channels, rate } = chop;
  if (!$('chopTail').checked) return chopEncodeWAV(channels, startSample, endSample, rate);
  const requestedMs = parseInt($('chopTailMs').value);
  const p = chopGetTailParams(startSample, endSample, requestedMs, rate);
  if (!p.viable) return chopEncodeWAV(channels, startSample, endSample, rate); // slice too short — clean export
  const { interleaved, totalFrames, ch, sr } = chopBuildPingPongTail(channels, startSample, endSample, requestedMs, rate);
  return chopEncodeWAVFromInterleaved(interleaved, totalFrames, ch, sr);
}

// ------------------------------------------------------------- the sound

/// Called when a sound is selected, and when the panel is opened. Only does
/// the work while the panel is showing: decoding a long file nobody is
/// chopping is wasted.
function chopSelected(file) {
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
/// channel for writing them.
function chopTake(channels, rate, stem) {
  chopStop();
  const len = channels[0] ? channels[0].length : 0;
  const mono = new Float32Array(len);
  for (const d of channels) for (let i = 0; i < len; i++) mono[i] += d[i] / channels.length;
  Object.assign(chop, { channels, rate, stem, mono, rms: chopBuildRms(mono), current: -1 });
  chopSay('');
  chopRender();
}

// ------------------------------------------------------------- drawing

function chopRender() {
  if (!chop.mono) return;
  const topDb = +$('chopTopDb').value;
  const minDur = +$('chopMinDur').value;
  const pad = +$('chopPad').value;
  $('chopTopDbV').textContent = `${topDb} dB`;
  $('chopMinDurV').textContent = `${minDur} ms`;
  $('chopPadV').textContent = `${pad} ms`;
  chop.segs = chopDetectSegs(chop.rms, topDb, minDur, pad, chop.rate, chop.mono.length);
  if (chop.current >= chop.segs.length) chop.current = -1;
  chopDraw();
  chopTable();
  chopStats();
  chopTailUI();
}

function chopDraw() {
  const canvas = document.querySelector('#dockChop canvas.chop-wave');
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || 140;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!chop.mono) return;

  const N = chop.mono.length;
  let peakAbs = 0;
  for (let i = 0; i < N; i++) if (Math.abs(chop.mono[i]) > peakAbs) peakAbs = Math.abs(chop.mono[i]);
  peakAbs = peakAbs || 1;

  // The slices: a wash of their colour, a line at each start, a number.
  chop.segs.forEach(([s, e], i) => {
    const x0 = (s / N) * W, x1 = (e / N) * W;
    const col = CHOP_COLORS[i % CHOP_COLORS.length];
    g.fillStyle = col + (i === chop.current ? '40' : '1a');
    g.fillRect(x0, 0, x1 - x0, H);
    g.strokeStyle = col + 'bb';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, H); g.stroke();
    g.strokeStyle = col + '55';
    g.beginPath(); g.moveTo(x1, 0); g.lineTo(x1, H); g.stroke();
    if (x1 - x0 > 14) {
      g.fillStyle = col + 'dd';
      g.font = `500 ${Math.min(11, Math.max(8, (x1 - x0) * 0.2))}px ui-monospace, monospace`;
      g.textAlign = 'center';
      g.fillText(i + 1, (x0 + x1) / 2, 12);
    }
  });

  // The threshold, where the cut is made.
  const topDb = +$('chopTopDb').value;
  const peakRms = Math.max(...chop.rms) || 1;
  const thN = (peakRms * Math.pow(10, -topDb / 20)) / peakAbs;
  const ty = H / 2 - thN * (H / 2) * 0.9;
  withAlpha(g, 0.35, () => {
    g.strokeStyle = ink('--text-dim');
    g.lineWidth = 0.8;
    g.setLineDash([3, 5]);
    g.beginPath(); g.moveTo(0, ty); g.lineTo(W, ty); g.stroke();
    g.beginPath(); g.moveTo(0, H - ty); g.lineTo(W, H - ty); g.stroke();
    g.setLineDash([]);
  });

  // The waveform, in the colour audio is drawn in everywhere else.
  const step = Math.max(1, Math.floor(N / (W * 2)));
  g.strokeStyle = waveInk();
  g.lineWidth = 0.9;
  g.beginPath();
  for (let px = 0; px < W; px++) {
    const si = Math.floor((px / W) * N);
    let mn = 0, mx = 0;
    for (let j = si; j < si + step && j < N; j++) {
      if (chop.mono[j] < mn) mn = chop.mono[j];
      if (chop.mono[j] > mx) mx = chop.mono[j];
    }
    g.moveTo(px, H / 2 - (mx / peakAbs) * (H / 2) * 0.9);
    g.lineTo(px, H / 2 - (mn / peakAbs) * (H / 2) * 0.9);
  }
  g.stroke();

  // The playhead, while a slice plays.
  const at = chopPlayhead();
  if (at >= 0) {
    g.fillStyle = ink('--text');
    g.fillRect((at / N) * W - 1, 0, 2, H);
  }
}

function chopTable() {
  const list = $('chopList');
  list.replaceChildren();
  const N = chop.mono.length;
  let peakAbs = 0;
  for (let i = 0; i < N; i += 64) if (Math.abs(chop.mono[i]) > peakAbs) peakAbs = Math.abs(chop.mono[i]);
  peakAbs = peakAbs || 1;

  chop.segs.forEach(([s, e], i) => {
    let pk = 0;
    for (let j = s; j < e; j += Math.max(1, Math.floor((e - s) / 1000))) if (Math.abs(chop.mono[j]) > pk) pk = Math.abs(chop.mono[j]);
    const pkDb = 20 * Math.log10(pk / peakAbs + 1e-10);
    const row = document.createElement('div');
    row.className = 'chop-row' + (i === chop.current ? ' current' : '');
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
      cell('chop-num', `${(s / chop.rate).toFixed(3)}s`),
      cell('chop-num', `${((e - s) / chop.rate * 1000).toFixed(0)}ms`),
      cell('chop-num', `${pkDb.toFixed(1)}dB`),
      cell('tail-badge', ''), play);
    row.onclick = () => chopPick(i);
    list.append(row);
  });
}

const chopName = (i) => `${chop.stem}_${String(i + 1).padStart(4, '0')}.wav`;

function chopStats() {
  const dur = chop.mono.length / chop.rate;
  const total = chop.segs.reduce((a, [s, e]) => a + (e - s), 0) / chop.rate;
  const avg = chop.segs.length ? total / chop.segs.length : 0;
  const set = (k, v) => { document.querySelector(`#dockChop .chop-stat[data-k="${k}"] b`).textContent = v; };
  set('clips', String(chop.segs.length));
  set('ratio', `${Math.round(total / dur * 100)}%`);
  set('avg', `${(avg * 1000).toFixed(0)} ms`);
  set('dur', `${dur.toFixed(2)} s`);
  $('chopWrite').disabled = !chop.segs.length || !chop.path;
}

/// The tail's badge on every row, and its summary: what each slice will get.
function chopTailUI() {
  const on = $('chopTail').checked;
  const requestedMs = parseInt($('chopTailMs').value);
  $('chopTailMsV').textContent = `${requestedMs} ms`;
  $('chopTailMs').disabled = !on;
  let eligible = 0, skipped = 0;
  document.querySelectorAll('#chopList .chop-row').forEach((row) => {
    const badge = row.querySelector('.tail-badge');
    const [s, e] = chop.segs[+row.dataset.i];
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
  $('chopTailCycles').textContent = on ? parts.join(' · ') : `${Math.max(2, Math.min(8, Math.ceil(500 / requestedMs)))} cycles`;
}

function chopSay(text) {
  const el = document.querySelector('#dockChop .chop-said');
  if (el) el.textContent = text;
}

// ------------------------------------------------------------- listening

function chopPick(i) {
  chop.current = i;
  document.querySelectorAll('#chopList .chop-row').forEach((r) => r.classList.toggle('current', +r.dataset.i === i));
  const row = document.querySelector(`#chopList .chop-row[data-i="${i}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
  chopDraw();
}

/// Play one slice through the engine: the sound as it is, from the slice's
/// start, stopped at its end.
async function chopPlay(i) {
  chopPick(i);
  const [s, e] = chop.segs[i];
  chopStop();
  if (!chop.path || typeof engineLoad !== 'function') return;
  if (!(engine.path === chop.path && engine.raw) && !(await engineLoad({ path: chop.path }, { raw: true }))) return;
  seekSource(s);
  startPlayback();
  const stopAt = performance.now() + ((e - s) / chop.rate) * 1000;
  chop.playing = { s, e, stopAt, timer: setTimeout(chopStop, stopAt - performance.now()) };
  const tick = () => {
    if (!chop.playing) { chopDraw(); return; }
    chopDraw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function chopStop() {
  if (!chop.playing) return;
  clearTimeout(chop.playing.timer);
  chop.playing = null;
  if (engine.playing) pausePlayback();
}

/// Where the playing slice has got to, in the sound's samples, or -1.
function chopPlayhead() {
  const p = chop.playing;
  if (!p) return -1;
  const left = Math.max(0, p.stopAt - performance.now());
  return p.e - (left / 1000) * chop.rate;
}

// ------------------------------------------------------------- writing

/// Every slice, with its tail if the tail is on, beside the sound.
async function chopWriteAll() {
  if (!chop.path || !chop.segs.length) return;
  const btn = $('chopWrite');
  btn.disabled = true;
  let done = 0, folder = '';
  try {
    for (let i = 0; i < chop.segs.length; i++) {
      chopSay(`Writing ${i + 1}/${chop.segs.length}…`);
      const [s, e] = chop.segs[i];
      await new Promise((r) => setTimeout(r, 0)); // yield so the window does not freeze
      const r = await fetch(`/api/chop/save?p=${encodeURIComponent(chop.path)}&name=${encodeURIComponent(chopName(i))}`,
        { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: chopEncodeWAVWithTail(s, e) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`);
      const got = await r.json();
      folder = (got.path || '').split('/').slice(0, -1).join('/');
      done++;
    }
    chopSay(`Wrote ${done} slices to ${folder}`);
    if (typeof refreshLibrary === 'function') refreshLibrary();
  } catch (e) {
    chopSay(`Stopped after ${done}: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------- wiring

(() => {
  for (const id of ['chopTopDb', 'chopMinDur', 'chopPad']) $(id).addEventListener('input', chopRender);
  $('chopTail').addEventListener('change', chopTailUI);
  $('chopTailMs').addEventListener('input', chopTailUI);
  $('chopWrite').addEventListener('click', chopWriteAll);
  const canvas = document.querySelector('#dockChop canvas.chop-wave');
  const at = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sample = Math.floor(((e.clientX - rect.left) / rect.width) * (chop.mono ? chop.mono.length : 0));
    return chop.segs.findIndex(([s, end]) => sample >= s && sample <= end);
  };
  canvas.addEventListener('click', (e) => {
    if (!chop.mono) return;
    const i = at(e);
    if (i >= 0) chopPlay(i);
  });
  canvas.addEventListener('mousemove', (e) => { canvas.style.cursor = chop.mono && at(e) >= 0 ? 'pointer' : 'default'; });
  window.addEventListener('resize', () => {
    if (chop.mono && !$('dockChop').classList.contains('hidden')) requestAnimationFrame(chopDraw);
  });
})();

/// For the tests, and anything else that wants Recycle Reborn's arithmetic.
window.Chop = {
  buildRms: chopBuildRms,
  detectSegs: chopDetectSegs,
  getTailParams: chopGetTailParams,
  buildPingPongTail: chopBuildPingPongTail,
  /// Chop these samples as if they were the selected sound.
  loadSamples: (channels, rate, stem) => { chop.loading++; chopTake(channels, rate, stem); },
  get state() { return { path: chop.path, slices: chop.segs.length, current: chop.current }; },
};
