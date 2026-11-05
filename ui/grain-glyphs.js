// The grain controls' glyphs.
//
// A picture above each knob in the Grain tray, drawn from the knob's value, so
// a turn shows what it did before it is heard: more Density is more grains,
// Envelope leans the bell, Scan at nothing is a dot. Proposed and approved as
// `docs/design/grain-icons.html`, which is the same drawing code on a sheet.
//
// **One language.** A bell is one grain, everywhere. Across is time and up is
// pitch, in every glyph. What the control moves is drawn in its group's colour
// and the context in the dim text colour; dashed means the engine decides.
//
// **Decoration, for a screen reader.** The knob keeps its name and its reading;
// the glyph is `aria-hidden` and carries nothing they do not.
//
// Every glyph is a pure function of one value, on a 64 × 48 grid, returning
// SVG. Nothing here keeps state, so a reset, a preset or an undo redraws it the
// same way a drag does.

const GG_W = 64, GG_H = 48, GG_BASE = 40;

/// A stable scatter for the jitter glyphs: the same grains wobble the same way
/// on every redraw, so turning a knob changes how far, never which.
const ggRnd = (i, s = 7) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const ggLerp = (a, b, t) => a + (b - a) * t;
const ggClamp = (v, a, b) => Math.max(a, Math.min(b, v));
/// The jitter itself, for a glyph that moves: grain `i`'s offset at time `t`
/// seconds, in −0.5…0.5, gliding from one draw of the scatter to the next.
/// At `t` 0 it is the still picture's offset.
function ggJ(i, s, t) {
  const u = t * 3 + ggRnd(i, 99), k = Math.floor(u), f = u - k, e = f * f * (3 - 2 * f);
  const a = t ? ggRnd(i, s + k) : ggRnd(i, s), b = ggRnd(i, s + k + 1);
  return ggLerp(a, t ? b : a, e) - 0.5;
}
const ggLog = (v, a, b) => ggClamp(Math.log(Math.max(v, a) / a) / Math.log(b / a), 0, 1);

/// One grain: a Hann bell. `peak` leans it — 0.5 is the symmetric one.
function ggBell(cx, w, h, base = GG_BASE, peak = 0.5) {
  const n = 16; let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = t < peak ? 0.5 * t / peak : 0.5 + 0.5 * (t - peak) / (1 - peak);
    const y = base - h * 0.5 * (1 - Math.cos(2 * Math.PI * u));
    d += (i ? 'L' : 'M') + (cx - w / 2 + w * t).toFixed(2) + ' ' + y.toFixed(2);
  }
  return d;
}
const ggP = (d, cls = 'a', extra = '') => `<path d="${d}" class="${cls}" ${extra}/>`;
const ggL = (x1, y1, x2, y2, cls = 'f', extra = '') =>
  `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="${cls}" ${extra}/>`;
const ggC = (x, y, r, cls = 'a') => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" class="${cls}"/>`;
const ggGround = () => ggL(4, GG_BASE, 60, GG_BASE);
const ggDash = 'stroke-dasharray="2 3"';
function ggWave(x0, x1, y, amp, cycles, cls = 'a') {
  let d = '';
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    d += (i ? 'L' : 'M') + ggLerp(x0, x1, t).toFixed(2) + ' ' + (y - amp * Math.sin(t * cycles * 2 * Math.PI)).toFixed(2);
  }
  return ggP(d, cls);
}
function ggArrow(x1, y1, x2, y2, cls = 'a') {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 4;
  return ggL(x1, y1, x2, y2, cls)
    + ggP(`M${x2 - s * Math.cos(a - 0.5)} ${y2 - s * Math.sin(a - 0.5)}L${x2} ${y2}L${x2 - s * Math.cos(a + 0.5)} ${y2 - s * Math.sin(a + 0.5)}`, cls);
}
/// The source file, as a strip of level bars.
function ggSource(y = 14) {
  let s = '';
  for (let i = 0; i < 27; i++) { const x = 6 + i * 2, h = 1 + 5 * ggRnd(i, 3); s += ggL(x, y - h / 2, x, y + h / 2); }
  return s;
}

/// Which colour each glyph is drawn in: its group's, from the theme.
const GG_GROUP = {
  ratio: 'time', semitones: 'time', windowMs: 'time',
  position: 'shape', rateHz: 'shape', densityHz: 'shape', layers: 'shape', overlap: 'shape',
  sizeJitter: 'shape', positionJitterMs: 'shape',
  pitchJitterSemis: 'pitch', pitchDriftSemis: 'pitch', driftRateHz: 'pitch',
  scan: 'scan', envelope: 'scan', sizeRange: 'scan', layerSpread: 'scan', panSpread: 'scan',
  layerScatter: 'scan', layerScatterMs: 'scan',
  searchMs: 'shape', splicePick: 'shape', spliceShape: 'shape', stride: 'shape', seed: 'shape',
  // Each engine's own controls, beside Stretch, Pitch and Window.
  cloudMix: 'time', sensitivity: 'time', anchorFrames: 'time', vocWindowMs: 'time',
  harmonicLevel: 'time', percussiveLevel: 'time', residualLevel: 'time',
  // Their extended groups: the splice's colour for what joins and protects,
  // the pitch colour for what happens inside the spectrum.
  floor: 'shape', guardHops: 'shape', anchorSearchMs: 'shape', blend: 'shape',
  timeSpan: 'shape', freqSpan: 'shape', margin: 'shape', fftSize: 'shape',
  magFreeze: 'pitch', magBlur: 'pitch', magGate: 'pitch',
  freqTrust: 'pitch', phaseSpread: 'pitch', peakWidth: 'pitch', lockWidth: 'pitch',
};

/// The splice's choices, as the number its glyph is drawn from.
const GG_PICK = ['similar', 'different', 'loudest'];
const GG_SHAPE = ['hann', 'triangle', 'rect'];
/// One spliced segment under the window it is laid down with: 0 hann, 1 tri, 2 rect.
function ggSeg(cx, w, h, shape) {
  const x0 = cx - w / 2, x1 = cx + w / 2, top = GG_BASE - h;
  if (shape === 2) return `M${x0} ${GG_BASE}L${x0} ${top}L${x1} ${top}L${x1} ${GG_BASE}`;
  if (shape === 1) return `M${x0} ${GG_BASE}L${cx} ${top}L${x1} ${GG_BASE}`;
  return ggBell(cx, w, h);
}

/// The drawings, by control key, each from the control's own value and range.
const GG_DRAW = {
  ratio: (v) => {
    const w = ggLerp(4, 56, ggLog(v, 0.01, 100));
    return ggL(22, 12, 42, 12) + ggL(22, 9, 22, 15) + ggL(42, 9, 42, 15)
      + ggWave(32 - w / 2, 32 + w / 2, 32, 5, 3)
      + ggL(32 - w / 2, 26, 32 - w / 2, 38, 'a') + ggL(32 + w / 2, 26, 32 + w / 2, 38, 'a');
  },
  semitones: (v) => ggWave(6, 46, 26, 9, 2, 'f') + ggWave(6, 46, 26, 9, 2 * Math.pow(2, v / 24))
    + (Math.abs(v) > 0.05 ? ggArrow(55, 26, 55, 26 - v / 48 * 16) : ggC(55, 26, 1.6, 'af')),
  windowMs: (v) => {
    const w = ggLerp(6, 56, ggLog(v, 5, 2000));
    return ggGround() + ggP(ggBell(32, w, 26)) + ggL(32 - w / 2, 44, 32 + w / 2, 44);
  },
  position: (v) => {
    const x = ggLerp(6, 58, (ggClamp(v, -1, 1) + 1) / 2);
    return ggSource(16) + ggL(x, 6, x, 30, 'a') + ggP(`M${x - 3} 6L${x + 3} 6L${x} 10Z`, 'af')
      + ggGround() + ggP(ggBell(x, 12, 8));
  },
  rateHz: (v) => {
    if (v <= 0) return ggL(4, GG_BASE, 60, GG_BASE, 'f', ggDash);
    const n = Math.round(ggLerp(2, 24, ggClamp(v / 500, 0, 1)));
    let s = ggGround();
    for (let i = 0; i < n; i++) s += ggC(6 + 52 * (i + 0.5) / n, GG_BASE - 6, 1.6, 'af');
    return s + ggP(ggBell(6 + 52 * 0.5 / n, 6, 12));
  },
  densityHz: (v) => {
    if (v <= 0) return ggGround() + ggP(ggBell(22, 18, 20), 'f', ggDash) + ggP(ggBell(42, 18, 20), 'f', ggDash);
    const n = Math.round(ggLerp(2, 14, ggClamp(v / 500, 0, 1)));
    let s = ggGround();
    for (let i = 0; i < n; i++) s += ggP(ggBell(10 + 44 * i / Math.max(1, n - 1), 16, 22));
    return s;
  },
  layers: (v) => {
    const n = ggClamp(Math.round(v), 1, 8);
    let s = '';
    for (let i = 0; i < n; i++) s += ggP(ggBell(32, 30, 6, 40 - i * 4.4));
    return s + (v > 8 ? `<text x="50" y="8" class="t">+${Math.round(v) - 8}</text>` : '');
  },
  overlap: (v) => {
    const w = 24, hop = w / Math.max(1, v);
    let s = ggGround() + ggL(32, 8, 32, 44, 'f', 'stroke-dasharray="1 2"');
    for (let x = 4 + w / 2; x <= 60 - w / 2 + 0.01; x += hop) s += ggP(ggBell(x, w, 24), Math.abs(x - 32) < w / 2 ? 'a' : 'f');
    return s;
  },
  sizeJitter: (v, t = 0) => {
    let s = ggGround();
    for (let i = 0; i < 5; i++) {
      const k = 1 + ggClamp(v, 0, 1) * ggJ(i, 11, t) * 1.8;
      s += ggP(ggBell(8 + i * 12, 10 * k, 18 * k));
    }
    return s;
  },
  positionJitterMs: (v, t = 0) => {
    let s = ggGround();
    for (let i = 0; i < 5; i++) {
      const x0 = 8 + i * 12, x = x0 + ggJ(i, 5, t) * 28 * ggClamp(v / 500, 0, 1);
      s += ggL(x0, 42, x0, 46) + ggP(ggBell(ggClamp(x, 5, 59), 8, 18));
    }
    return s;
  },
  pitchJitterSemis: (v, t = 0) => {
    let s = ggL(4, 24, 60, 24, 'f', 'stroke-dasharray="1 2"');
    for (let i = 0; i < 9; i++) {
      const x = 6 + i * 6.5, y = 24 + ggJ(i, 9, t) * 36 * ggClamp(v / 24, 0, 1);
      s += ggL(x, y, x + 4, y, 'a');
    }
    return s;
  },
  pitchDriftSemis: (v, t = 0) => {
    const amp = ggClamp(v / 24, 0, 1) * 16, ph = t * 0.4;
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const u = i / 64;
      d += (i ? 'L' : 'M') + (4 + 56 * u).toFixed(2) + ' ' + (24 - amp * Math.sin((u + ph) * 2 * Math.PI)).toFixed(2);
    }
    let s = ggP(d, 'f');
    for (let i = 0; i < 9; i++) {
      const u = (i + 0.3) / 9, x = 4 + 56 * u, y = 24 - amp * Math.sin((u + ph) * 2 * Math.PI);
      s += ggL(x, y, x + 4, y, 'a');
    }
    return s;
  },
  // The drift's own speed: the wave slides past at the rate it is set to.
  driftRateHz: (v, t = 0) => {
    const cyc = ggLerp(0.5, 6, ggLog(v, 0.01, 10)), ph = t * ggClamp(v, 0, 4);
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const u = i / 64;
      d += (i ? 'L' : 'M') + (4 + 56 * u).toFixed(2) + ' ' + (24 - 10 * Math.sin((u * cyc + ph) * 2 * Math.PI)).toFixed(2);
    }
    return ggP(d) + ggL(4, 24, 60, 24, 'f', 'stroke-dasharray="1 2"');
  },
  scan: (v) => {
    if (Math.abs(v) < 0.005) return ggSource(14) + ggC(32, 32, 3, 'af') + ggC(32, 32, 7);
    const len = Math.min(Math.abs(v), 2) / 2 * 24, d = Math.sign(v);
    return ggSource(14) + ggArrow(32 - d * len, 32, 32 + d * len, 32);
  },
  envelope: (v) => ggGround() + ggP(ggBell(32, 48, 30, GG_BASE, ggLerp(0.06, 0.94, ggClamp(v, 0, 1)))),
  sizeRange: (v) => ggGround() + ggP(ggBell(32, Math.min(56, 7 * v), 26), 'a', 'stroke-dasharray="2 2"')
    + ggP(ggBell(32, 7, 26), 'f'),
  layerSpread: (v) => {
    let s = '';
    for (let i = 0; i < 5; i++) s += ggP(ggBell(14 + i * ggClamp(v, 0, 4) / 4 * 9, 14, 6, 40 - i * 7));
    return s;
  },
  panSpread: (v) => {
    let s = ggP('M18 40A14 14 0 0 1 46 40', 'f') + ggL(26, 40, 38, 40) + ggC(32, 40, 2, 'f');
    for (let i = 0; i < 7; i++) {
      const a = (ggRnd(i, 4) - 0.5) * 2 * ggClamp(v, 0, 1) * 1.3;
      s += ggC(32 + 26 * Math.sin(a), 40 - 26 * Math.cos(a), 2, 'af');
    }
    return s + '<text x="6" y="44" class="t">L</text><text x="54" y="44" class="t">R</text>';
  },
  layerScatter: (v) => {
    let s = ggL(32, 6, 32, 44, 'f', 'stroke-dasharray="1 2"');
    for (let i = 0; i < 6; i++) s += ggP(ggBell(32 + (ggRnd(i, 13) - 0.5) * 44 * ggClamp(v, 0, 1), 12, 5, 42 - i * 6.5));
    return s;
  },
  layerScatterMs: (v) => {
    const w = ggLerp(4, 54, ggLog(v, 1, 2000));
    let s = ggGround() + ggP(ggBell(32, 10, 20), 'f')
      + ggL(32 - w / 2, 14, 32 + w / 2, 14, 'a') + ggL(32 - w / 2, 11, 32 - w / 2, 17, 'a') + ggL(32 + w / 2, 11, 32 + w / 2, 17, 'a');
    for (let i = 0; i < 4; i++) s += ggC(32 + (ggRnd(i, 2) - 0.5) * w, 24, 1.6, 'af');
    return s;
  },
  // The splice (WSOLA): the segment laid down so far, the next one, and the
  // span either side of the ideal join the search may move it within.
  searchMs: (v) => {
    const base = ggGround() + ggP(ggBell(20, 28, 24), 'f');
    if (v <= 0) return base + ggP(ggBell(38, 28, 24), 'a', ggDash);
    const w = ggLerp(4, 40, ggLog(v, 0.5, 200));
    return base + ggP(ggBell(38, 28, 24))
      + ggL(38 - w / 2, 8, 38 + w / 2, 8, 'a') + ggL(38 - w / 2, 5, 38 - w / 2, 11, 'a') + ggL(38 + w / 2, 5, 38 + w / 2, 11, 'a');
  },
  // What the search goes looking for: the wave that continues it, the one that
  // fights it, or the loudest one near.
  splicePick: (v) => {
    const k = Math.round(v);
    const next = k === 2 ? ggWave(32, 60, 24, 14, 2) : ggWave(32, 60, 24, k === 1 ? -7 : 7, 2);
    return ggWave(4, 32, 24, 7, 2, 'f') + ggL(32, 8, 32, 40, 'f', 'stroke-dasharray="1 2"') + next;
  },
  spliceShape: (v) => {
    const k = Math.round(v);
    return ggGround() + ggP(ggSeg(20, 28, 24, k), 'f') + ggP(ggSeg(44, 28, 24, k));
  },
  // The steps the search takes across its span: the further apart, the
  // coarser the join it can land on.
  stride: (v) => {
    const gap = ggLerp(2.5, 24, ggLog(v, 1, 128));
    let s = ggGround() + ggP(ggBell(32, 30, 22), 'f') + ggL(8, 10, 56, 10, 'f');
    for (let x = 8; x <= 56.01; x += gap) s += ggL(x, 7, x, 13, 'a');
    return s;
  },
  // The cloud the seed deals: another number, the same grains somewhere else.
  seed: (v) => {
    let s = ggGround();
    for (let i = 0; i < 7; i++) {
      const x = 9 + i * 7.6 + (ggRnd(i, v % 9973) - 0.5) * 6, h = 8 + 22 * ggRnd(i + 7, v % 9973);
      s += ggP(ggBell(x, 8, h));
    }
    return s;
  },
};

/// A spectrum: bars across frequency, as heights 0–1, along a ground at 42.
const GG_SPEC = [0.25, 0.5, 0.95, 0.45, 0.2, 0.35, 0.75, 0.3, 0.15, 0.55, 0.85, 0.4, 0.2, 0.3];
function ggBars(heights, cls = 'a', x0 = 6, gap = 4) {
  let s = '';
  heights.forEach((h, i) => { const x = x0 + i * gap; s += ggL(x, 42, x, 42 - Math.max(0.5, h * 30), typeof cls === 'function' ? cls(h, i) : cls); });
  return s;
}
/// One partial and the bins either side of it, for the vocoder's phase controls.
const ggBins = (y0 = 8, y1 = 42) => { let s = ''; for (let x = 8; x <= 56; x += 8) s += ggL(x, y0, x, y1, 'f', 'stroke-dasharray="1 2"'); return s; };
/// A level, as a short meter at the right: 0–2, with 1 marked.
function ggLevel(v) {
  const h = ggClamp(v / 2, 0, 1) * 36;
  return ggL(58, 42, 58, 6, 'f') + ggL(55, 24, 61, 24, 'f') + (h > 0 ? ggL(58, 42, 58, 42 - h) : '');
}
/// An onset: a spike out of a low wave, at `x`, `h` tall.
const ggHit = (x, h, cls = 'a') => ggP(`M${x - 3} 40L${x} ${40 - h}L${x + 3} 40`, cls);

Object.assign(GG_DRAW, {
  // How much cloud over the engine: the engine's wave gives way to grains.
  cloudMix: (v) => {
    const t = ggClamp(v, 0, 1);
    let s = ggGround() + ggWave(4, 60, 26, 10 * (1 - t) + 0.5, 3, 'f');
    for (let i = 0; i < 6; i++) s += ggP(ggBell(8 + i * 9.6, 10, Math.max(1, 22 * t)));
    return s;
  },
  // The detector: hits rise out of the wave, and the eager line drops to meet more of them.
  sensitivity: (v) => {
    const line = ggLerp(8, 34, ggClamp(v, 0, 1));
    const hits = [[12, 30], [24, 12], [36, 22], [48, 8], [56, 18]];
    let s = ggGround() + ggL(4, 40 - line, 60, 40 - line, 'f', ggDash);
    for (const [x, h] of hits) s += ggHit(x, h, h >= line ? 'a' : 'f');
    return s;
  },
  // A hit has to clear the local average by this much: the threshold rises with it.
  floor: (v) => {
    const line = ggLerp(6, 34, ggClamp(v / 2, 0, 1));
    const hits = [[10, 14], [22, 30], [34, 10], [46, 24], [56, 34]];
    let s = ggGround() + ggWave(4, 60, 37, 1.5, 6, 'f') + ggL(4, 40 - line, 60, 40 - line, 'f', ggDash);
    for (const [x, h] of hits) s += ggHit(x, h, h > line ? 'a' : 'f');
    return s;
  },
  // What is held either side of a hit, at its own rate.
  guardHops: (v) => {
    const w = ggLerp(4, 54, ggLog(v, 1, 16));
    return ggGround() + ggHit(32, 30) + ggL(32 - w / 2, 6, 32 + w / 2, 6)
      + ggL(32 - w / 2, 3, 32 - w / 2, 9) + ggL(32 + w / 2, 3, 32 + w / 2, 9)
      + ggL(32 - w / 2, 12, 32 - w / 2, 40, 'f', 'stroke-dasharray="1 2"') + ggL(32 + w / 2, 12, 32 + w / 2, 40, 'f', 'stroke-dasharray="1 2"');
  },
  // How often the vocoder is put back on the waveform: a pin every so many frames.
  anchorFrames: (v) => {
    const every = Math.max(1, Math.round(v));
    let s = ggWave(4, 60, 24, 8, 3, 'f');
    for (let i = 0; i < 24; i++) {
      const x = 4 + i * (56 / 23);
      s += i % Math.min(every, 24) === 0 ? ggL(x, 8, x, 40) : ggL(x, 38, x, 42, 'f');
    }
    return s;
  },
  anchorSearchMs: (v) => GG_DRAW.searchMs(v),
  // The join back onto the waveform: a butt join, or a crossfade as wide as this.
  blend: (v) => {
    const w = ggLerp(0, 30, ggClamp(v, 0, 1));
    if (w < 1) return ggGround() + ggWave(4, 32, 26, 9, 1.5, 'f') + ggWave(32, 60, 26, 9, 1.5) + ggL(32, 10, 32, 42);
    return ggGround() + ggWave(4, 32 + w / 2, 26, 9, 1.5, 'f') + ggWave(32 - w / 2, 60, 26, 9, 1.5)
      + ggL(32 - w / 2, 40, 32 + w / 2, 10) + ggL(32 - w / 2, 10, 32 + w / 2, 40, 'f');
  },
  // The vocoder's frame: one transform, wider as it lengthens, and the bins it resolves.
  vocWindowMs: (v) => {
    const t = ggLog(v, 5, 500), w = ggLerp(10, 56, t), n = Math.round(ggLerp(3, 12, t));
    let s = ggP(`M${32 - w / 2} 22L${32 - w / 2} 8L${32 + w / 2} 8L${32 + w / 2} 22`, 'f');
    for (let i = 0; i < n; i++) { const x = 6 + 52 * (i + 0.5) / n; s += ggL(x, 42, x, 42 - (6 + 12 * GG_SPEC[i % GG_SPEC.length])); }
    return s;
  },
  // The three parts: tone runs along time, hits run across frequency, air is neither.
  harmonicLevel: (v) => {
    const k = ggClamp(v / 2, 0, 1);
    let s = ggLevel(v);
    for (const y of [12, 22, 32]) s += k > 0 ? ggL(6, y, 6 + 44 * Math.max(0.08, k), y) : ggL(6, y, 50, y, 'f', ggDash);
    return s;
  },
  percussiveLevel: (v) => {
    const k = ggClamp(v / 2, 0, 1);
    let s = ggLevel(v);
    for (const x of [12, 26, 40]) s += k > 0 ? ggL(x, 42, x, 42 - 34 * Math.max(0.08, k)) : ggL(x, 42, x, 8, 'f', ggDash);
    return s;
  },
  residualLevel: (v) => {
    const n = Math.round(ggClamp(v / 2, 0, 1) * 28);
    let s = ggLevel(v);
    for (let i = 0; i < 28; i++) {
      const x = 6 + ggRnd(i, 21) * 44, y = 8 + ggRnd(i, 22) * 32;
      s += i < n ? ggC(x, y, 1.3, 'af') : (i % 4 ? '' : ggC(x, y, 0.8, 'f'));
    }
    return s;
  },
  // How long a ridge along time must hold to count as a partial.
  timeSpan: (v) => {
    const w = ggLerp(6, 52, ggLog(v, 3, 101));
    return ggL(6, 30, 58, 30, 'f') + ggL(32 - w / 2, 30, 32 + w / 2, 30)
      + ggL(32 - w / 2, 14, 32 + w / 2, 14) + ggL(32 - w / 2, 11, 32 - w / 2, 17) + ggL(32 + w / 2, 11, 32 + w / 2, 17);
  },
  // How broad a ridge across frequency must be to count as a hit.
  freqSpan: (v) => {
    const h = ggLerp(4, 34, ggLog(v, 3, 101));
    return ggL(28, 6, 28, 44, 'f') + ggL(28, 25 + h / 2, 28, 25 - h / 2)
      + ggL(44, 25 - h / 2, 44, 25 + h / 2) + ggL(41, 25 - h / 2, 47, 25 - h / 2) + ggL(41, 25 + h / 2, 47, 25 + h / 2);
  },
  // How far one part must out-shout the other to keep a bin; what is left over is air.
  margin: (v) => {
    const k = ggClamp((v - 1) / 7, 0, 1);
    let s = ggGround() + ggL(16, 40, 16, 10) + ggL(48, 40, 48, 10 + 22 * k, 'f');
    const n = Math.round(k * 12);
    for (let i = 0; i < n; i++) s += ggC(24 + ggRnd(i, 31) * 16, 12 + ggRnd(i, 32) * 26, 1.2, 'af');
    return s;
  },
  // The separation's transform: finer bins as it grows.
  fftSize: (v) => {
    const n = Math.round(ggLerp(4, 28, ggLog(v, 256, 8192)));
    let s = ggGround();
    for (let i = 0; i < n; i++) { const x = 6 + 52 * (i + 0.5) / n; s += ggL(x, 40, x, 40 - (4 + 26 * GG_SPEC[i % GG_SPEC.length] * (0.5 + 0.5 * Math.sin(i / n * Math.PI)))); }
    return s;
  },
  // Three frames of the spectrum in a row; frozen, the later two stop following.
  magFreeze: (v) => {
    const t = ggClamp(v, 0, 1);
    let s = '';
    for (let f = 0; f < 3; f++) {
      const heights = GG_SPEC.slice(0, 5).map((h, i) => ggLerp(GG_SPEC[(i + f * 3) % GG_SPEC.length], h, f ? t : 1));
      s += ggBars(heights, f ? 'a' : 'f', 6 + f * 20, 3.2);
    }
    return s;
  },
  // Each frame's peaks smeared into their neighbours.
  magBlur: (v) => {
    const t = ggClamp(v, 0, 1);
    return ggGround() + ggP(ggBell(18, ggLerp(4, 26, t), ggLerp(30, 12, t))) + ggP(ggBell(44, ggLerp(4, 26, t), ggLerp(22, 10, t)))
      + ggL(18, 40, 18, 10, 'f', 'stroke-dasharray="1 2"') + ggL(44, 40, 44, 18, 'f', 'stroke-dasharray="1 2"');
  },
  // Bins below this share of the loudest are dropped.
  magGate: (v) => {
    const line = ggClamp(v, 0, 1);
    return ggBars(GG_SPEC, (h) => (h >= line ? 'a' : 'f')) + (line > 0 ? ggL(4, 42 - line * 30, 60, 42 - line * 30, 'f', ggDash) : '');
  },
  // Where the partial really is against the bin it falls in: believed, it sits at its own frequency.
  freqTrust: (v) => {
    const x = ggLerp(24, 29, ggClamp(v, 0, 1));
    return ggBins() + ggL(24, 42, 24, 14, 'f') + ggP(ggBell(x, 10, 28)) + ggC(x, 10, 1.6, 'af');
  },
  // How far a peak's correction reaches into the bins round it.
  phaseSpread: (v) => {
    const r = ggLerp(0, 24, ggClamp(v / 4, 0, 1));
    let s = ggBins() + ggL(32, 42, 32, 10);
    if (r > 1) s += ggArrow(32, 26, 32 - r, 26) + ggArrow(32, 26, 32 + r, 26);
    return s;
  },
  // How many bins either side of a maximum belong to it.
  peakWidth: (v) => {
    const n = ggClamp(Math.round(v), 1, 16), k = Math.min(n, 6);
    let s = ggGround();
    for (let i = -6; i <= 6; i++) {
      const x = 32 + i * 4.2, h = 32 * Math.exp(-(i * i) / 8);
      s += ggL(x, 40, x, 40 - Math.max(1, h), Math.abs(i) <= k ? 'a' : 'f');
    }
    return s + (n > 6 ? `<text x="50" y="8" class="t">${n}</text>` : '');
  },
  // How strongly a peak's phase is imposed on its bins: their hands turn to match its own.
  lockWidth: (v) => {
    const lock = ggClamp(v, 0, 1);
    let s = '';
    for (let i = -3; i <= 3; i++) {
      const x = 32 + i * 8, a = i ? (1 - lock) * (ggRnd(i + 3, 41) - 0.5) * 3 : 0;
      s += ggC(x, 26, 3.4, 'f') + ggL(x, 26, x + 7 * Math.sin(a + 0.6), 26 - 7 * Math.cos(a + 0.6), i ? 'a' : 'a');
    }
    return s + ggL(32, 40, 32, 34, 'f');
  },
});

/// Mark a row as having glyph `key`, drawn from `read()` where the row is not
/// a slider. The tray draws it (`gkGlyphRow`).
function ggTag(row, key, read) {
  row.dataset.glyph = key;
  if (read) row.read = read;
  return row;
}

/// Whether a control has a glyph.
function ggHas(key) { return Object.prototype.hasOwnProperty.call(GG_DRAW, key); }

/// The glyph element for a control: an empty SVG of the right group, to be
/// filled by `ggPaint`.
function ggMake(key) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('class', `gg gg-${GG_GROUP[key]}`);
  el.setAttribute('viewBox', `0 0 ${GG_W} ${GG_H}`);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/// Draw `key`'s glyph for value `v` into `el`.
function ggPaint(el, key, v) {
  el.innerHTML = Number.isFinite(v) ? GG_DRAW[key](v, GG_MOVES.has(key) ? ggNow() : 0) : '';
  if (GG_MOVES.has(key)) { el._gg = [key, v]; ggLive.add(el); ggRun(); }
}

// ── the glyphs that move ─────────────────────────────────────────────────────
//
// A jitter is a movement, so its picture moves: Size jitter's grains breathe
// by as much as they vary, Position jitter's slide about their places, Pitch
// jitter's dashes hop, and the drift glides at its own rate. At zero there is
// nothing to move and the picture is still. Redrawn a dozen times a second,
// only while the glyph is on screen, and never under reduced motion.

const GG_MOVES = new Set(['sizeJitter', 'positionJitterMs', 'pitchJitterSemis', 'pitchDriftSemis', 'driftRateHz']);
const ggLive = new Set();
let ggTimer = 0;
const ggNow = () => (ggStill() ? 0 : performance.now() / 1000);
const ggStill = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function ggRun() {
  if (ggTimer || ggStill()) return;
  ggTimer = setInterval(() => {
    const t = ggNow();
    for (const el of ggLive) {
      if (!el.isConnected) { ggLive.delete(el); continue; }
      if (!el.getClientRects().length) continue;
      const [key, v] = el._gg;
      el.innerHTML = GG_DRAW[key](v, t);
    }
    if (!ggLive.size) { clearInterval(ggTimer); ggTimer = 0; }
  }, 80);
}

// ── what each control does to the sound (RJ, 4 Nov 2026) ─────────────────────
//
// One of six, for the change you would hear first when you move it. The
// tray draws a control's picture and its bar in that colour (`--f-*`, set by
// the theme), and a key at the top of the tray names them.

const GG_FACETS = [['time', 'Time'], ['pitch', 'Pitch'], ['tone', 'Timbre'], ['attack', 'Attack'], ['space', 'Space'], ['level', 'Level']];
const GG_FACET = {};
for (const [facet, keys] of Object.entries({
  time: ['ratio', 'windowMs', 'position', 'positionJitterMs', 'rateHz', 'densityHz', 'overlap', 'sizeJitter', 'sizeRange', 'scan',
    'searchMs', 'stride', 'anchorFrames', 'anchorSearchMs', 'reverse', 'wrap', 'fbTimeMs'],
  pitch: ['semitones', 'pitchJitterSemis', 'pitchDriftSemis', 'driftRateHz', 'freqTrust', 'driftStep', 'fbShift'],
  tone: ['vocWindowMs', 'timeSpan', 'freqSpan', 'margin', 'fftSize', 'magFreeze', 'magBlur', 'magGate', 'phaseSpread', 'peakWidth',
    'lockWidth', 'splicePick', 'morphNoise', 'phaseLock', 'fbSmear', 'fbDamp'],
  attack: ['sensitivity', 'floor', 'guardHops', 'envelope', 'spliceShape', 'blend', 'preserveTransients'],
  space: ['layers', 'layerSpread', 'panSpread', 'layerScatter', 'layerScatterMs', 'seed', 'linkJitter', 'stereoLink', 'cloud', 'fbAmount', 'fbHold'],
  level: ['cloudMix', 'harmonicLevel', 'percussiveLevel', 'residualLevel'],
})) for (const k of keys) GG_FACET[k] = facet;

// The switches' pictures, drawn off (0) and on (1), so the picture says what
// turning it on does; and grain feedback's, each pass drawn after the last.
Object.assign(GG_DRAW, {
  driftStep: (v) => {
    let d = '';
    for (let i = 0; i <= 64; i++) { const u = i / 64; d += (i ? 'L' : 'M') + (4 + 56 * u).toFixed(2) + ' ' + (24 - 12 * Math.sin(u * 2 * Math.PI)).toFixed(2); }
    if (!v) return ggP(d);
    let st = '';
    for (let i = 0; i < 7; i++) {
      const u0 = i / 7, u1 = (i + 1) / 7, y = 24 - 12 * Math.sin((u0 + 0.5 / 7) * 2 * Math.PI);
      st += (i ? 'L' : 'M') + (4 + 56 * u0).toFixed(2) + ' ' + y.toFixed(2) + 'L' + (4 + 56 * u1).toFixed(2) + ' ' + y.toFixed(2);
    }
    return ggP(d, 'f') + ggP(st);
  },
  reverse: (v) => ggGround() + ggP(ggBell(32, 30, 22, GG_BASE, v ? 0.8 : 0.2)) + (v ? ggArrow(46, 10, 18, 10) : ggArrow(18, 10, 46, 10)),
  wrap: (v) => ggSource(30) + ggL(6, 22, 58, 22, 'f')
    + (v ? ggP('M50 22 C 62 22, 62 8, 32 8 C 4 8, 2 22, 14 22') + ggArrow(10, 22, 14, 22) : ggArrow(40, 22, 58, 22) + ggL(58, 16, 58, 28)),
  cloud: (v) => ggWave(4, 60, 30, 8, 3, v ? 'f' : 'a') + (v ? [0, 1, 2, 3, 4].map((i) => ggP(ggBell(10 + i * 11, 10, 14 + 6 * ggRnd(i, 2), 22))).join('') : ''),
  morphNoise: (v) => {
    let t = '';
    for (let i = 0; i < 22; i++) t += ggC(6 + ggRnd(i, v ? 50 : 51) * 52, 8 + ggRnd(i, v ? 52 : 53) * 30, 1.3, v ? 'af' : 'f');
    return t + (v ? ggArrow(14, 44, 50, 44) : '');
  },
  phaseLock: (v) => {
    let t = '';
    for (let i = -2; i <= 2; i++) {
      const x = 32 + i * 11, a = v ? 0.6 : 0.6 + (ggRnd(i + 2, 44) - 0.5) * 2.4;
      t += ggC(x, 24, 4.5, 'f') + ggL(x, 24, x + 8 * Math.sin(a), 24 - 8 * Math.cos(a), 'a');
    }
    return t;
  },
  stereoLink: (v) => ggWave(4, 60, 16, 6, 2) + ggWave(4, 60, 34, 6, 2, v ? 'a' : 'f')
    + (v ? ggL(32, 20, 32, 30, 'a', 'stroke-dasharray="2 2"') : '') + '<text x="0" y="12" class="t">L</text><text x="0" y="44" class="t">R</text>',
  linkJitter: (v) => [10, 24, 38].map((y, i) => {
    let d = '';
    for (let k = 0; k <= 10; k++) { const j = ggRnd(k + (v ? 0 : i * 13), 61) - 0.5; d += (k ? 'L' : 'M') + (6 + k * 5.2).toFixed(2) + ' ' + (y + j * 8).toFixed(2); }
    return ggP(d, v || i === 0 ? 'a' : 'f');
  }).join(''),
  preserveTransients: (v) => ggGround() + ggWave(4, 60, 37, 1.5, 6, 'f') + ggP('M29 40L32 10L35 40', v ? 'a' : 'f')
    + (v ? ggL(22, 6, 42, 6) + ggL(22, 3, 22, 9) + ggL(42, 3, 42, 9) : ''),
  fbAmount: (v) => {
    let t = ggGround();
    for (let k = 0; k < 5; k++) { const a = Math.pow(Math.max(v, 0.001), k); if (k && a < 0.04) break; t += ggP(ggBell(10 + k * 11, 9, 28 * a), k ? 'a' : 'f'); }
    return t;
  },
  fbTimeMs: (v) => {
    const w = ggLerp(6, 40, ggLog(v, 20, 2000));
    return ggGround() + ggP(ggBell(12, 10, 26), 'f') + ggP(ggBell(12 + w, 10, 16)) + ggL(12, 8, 12 + w, 8) + ggL(12, 5, 12, 11) + ggL(12 + w, 5, 12 + w, 11);
  },
  fbSmear: (v) => { let t = ggGround(); for (let k = 0; k < 4; k++) t += ggP(ggBell(12 + k * 13, 8 + k * 10 * v, 26 - k * 5), k ? 'a' : 'f'); return t; },
  fbDamp: (v) => {
    let t = '';
    const hh = [0.9, 0.6, 0.8, 0.5, 0.7, 0.4];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) {
      const x = 6 + k * 14 + i * 2, top = hh[i] * Math.pow(1 - 0.85 * v * i / 5, k);
      t += ggL(x, 42, x, 42 - 28 * top, k ? 'a' : 'f');
    }
    return t;
  },
  fbShift: (v) => {
    let t = '';
    for (let k = 0; k < 4; k++) { const y = 24 - k * v / 12 * 6; t += ggL(6 + k * 14, y, 16 + k * 14, y, k ? 'a' : 'f'); }
    return t + ggL(4, 24, 60, 24, 'f', 'stroke-dasharray="1 2"');
  },
  fbHold: (v) => { let t = ggGround(); for (let k = 0; k < 5; k++) t += ggP(ggBell(10 + k * 11, 9, v ? 22 : 22 * Math.pow(0.6, k)), k ? 'a' : 'f'); return t; },
});
for (const k of ['driftStep', 'reverse', 'wrap', 'cloud', 'morphNoise', 'phaseLock', 'stereoLink', 'linkJitter', 'preserveTransients',
  'fbAmount', 'fbTimeMs', 'fbSmear', 'fbDamp', 'fbShift', 'fbHold']) if (!GG_GROUP[k]) GG_GROUP[k] = 'shape';

/// The engines' pictures: what each does to the sound, in one look.
const GG_ENGINE = {
  wsola: () => ggGround() + ggP(ggBell(20, 26, 24), 'f') + ggP(ggBell(40, 26, 24)) + ggL(30, 8, 50, 8, 'a') + ggL(30, 5, 30, 11, 'a') + ggL(50, 5, 50, 11, 'a'),
  vocoder: () => [0, 1, 2].map((f) => [0.3, 0.8, 0.5, 0.95, 0.4].map((h, i) =>
    ggL(8 + f * 18 + i * 3, 42, 8 + f * 18 + i * 3, 42 - h * 26, f === 1 ? 'a' : 'f')).join('')).join(''),
  pvsola: () => [0, 1, 2].map((f) => [0.3, 0.8, 0.5, 0.95].map((h, i) => ggL(6 + f * 20 + i * 3, 40, 6 + f * 20 + i * 3, 40 - h * 22, 'f')).join('')).join('')
    + [18, 38, 58].map((x) => ggL(x, 8, x, 44, 'a') + ggP(`M${x - 3} 8L${x + 3} 8L${x} 12Z`, 'af')).join(''),
  hybrid: () => [12, 20, 28].map((y) => ggL(6, y, 34, y, 'a')).join('') + [42, 50].map((x) => ggL(x, 8, x, 40, 'a')).join('')
    + [0, 1, 2, 3, 4, 5].map((i) => ggC(8 + ggRnd(i, 71) * 50, 34 + ggRnd(i, 72) * 8, 1.2, 'af')).join(''),
  granular: () => ggGround() + [0, 1, 2, 3, 4, 5, 6].map((i) => ggP(ggBell(8 + i * 8 + (ggRnd(i, 81) - 0.5) * 4, 9, 10 + 20 * ggRnd(i, 82)))).join(''),
};

/// An engine's picture, as an element.
function ggEngine(alg) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('class', 'gg gg-engine');
  el.setAttribute('viewBox', `0 0 ${GG_W} ${GG_H}`);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = GG_ENGINE[alg] ? GG_ENGINE[alg]() : '';
  return el;
}
