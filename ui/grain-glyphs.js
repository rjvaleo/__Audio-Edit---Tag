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
};

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
  sizeJitter: (v) => {
    let s = ggGround();
    for (let i = 0; i < 5; i++) s += ggP(ggBell(8 + i * 12, 10 * (1 + v * (ggRnd(i, 11) - 0.5) * 1.6), 20));
    return s;
  },
  positionJitterMs: (v) => {
    let s = ggGround();
    for (let i = 0; i < 5; i++) {
      const x0 = 8 + i * 12, x = x0 + (ggRnd(i, 5) - 0.5) * 28 * ggClamp(v / 500, 0, 1);
      s += ggL(x0, 42, x0, 46) + ggP(ggBell(ggClamp(x, 5, 59), 8, 18));
    }
    return s;
  },
  pitchJitterSemis: (v) => {
    let s = ggL(4, 24, 60, 24, 'f', 'stroke-dasharray="1 2"');
    for (let i = 0; i < 9; i++) {
      const x = 6 + i * 6.5, y = 24 + (ggRnd(i, 9) - 0.5) * 36 * ggClamp(v / 24, 0, 1);
      s += ggL(x, y, x + 4, y, 'a');
    }
    return s;
  },
  pitchDriftSemis: (v) => {
    const amp = ggClamp(v / 24, 0, 1) * 16;
    let s = ggWave(4, 60, 24, amp, 1, 'f');
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.3) / 9, x = 4 + 56 * t, y = 24 - amp * Math.sin(t * 2 * Math.PI);
      s += ggL(x, y, x + 4, y, 'a');
    }
    return s;
  },
  driftRateHz: (v) => ggWave(4, 60, 24, 10, ggLerp(0.5, 6, ggLog(v, 0.01, 10)))
    + ggL(4, 24, 60, 24, 'f', 'stroke-dasharray="1 2"'),
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
};

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
  el.innerHTML = Number.isFinite(v) ? GG_DRAW[key](v) : '';
}
