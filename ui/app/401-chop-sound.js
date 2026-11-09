// ═══════════════════════════════════════ Chop: the sound of a slice ══
//
// What Preview, Ratchet, an audition and Write all hear, and how each gets out.

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
  // Capped: Bars counts a whole song now, and a Ratchet loop is rendered whole.
  const loop = Math.max(1, Math.round((Math.min(64, Math.max(1, cp.bars)) * cp.sig + cp.beats) * 60 / bpm * chop.rate));
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
  // The app's own Play, playing this sound.
  if (!p) return typeof engine !== 'undefined' && engine.playing && engine.path === chop.path ? sourceFrameNow() : -1;
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
