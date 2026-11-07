// ============================================================ Prism pictures
//
// One picture beside every control on the Prism page, drawn from the control's
// value, in the grain glyphs' language: a 64 × 48 grid, what the control moves
// in its colour (`a`), the context dim (`f`); a bell is a sound event, across is
// time. Approved as the Prism mock-up (RJ, 6 Nov 2026). Also one picture per
// process for the Process menu.
//
// Every drawing is a pure function of the value, so a drag, a reset, a preset
// and an LFO all redraw it the same way. Kept in a closure, as `FXP` is, so its
// one-letter helpers stay out of the app's global scope.

const PRISM_PIC = (() => {
  const B = 40;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const P = (d, c = 'a', x = '') => `<path d="${d}" class="${c}" ${x}/>`;
  const L = (x1, y1, x2, y2, c = 'f', x = '') => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${c}" ${x}/>`;
  const C = (x, y, r, c = 'a') => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" class="${c}"/>`;
  const ground = () => L(4, B, 60, B);
  const dash = 'stroke-dasharray="2 3"';
  function bell(cx, w, h, base = B) {
    let d = '';
    for (let i = 0; i <= 16; i++) { const t = i / 16; d += (i ? 'L' : 'M') + (cx - w / 2 + w * t).toFixed(1) + ' ' + (base - h * 0.5 * (1 - Math.cos(2 * Math.PI * t))).toFixed(1); }
    return d;
  }
  function wave(x0, x1, y, amp, cyc, c = 'a', ph = 0, shape = 0) {
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const t = i / 64, u = t * cyc + ph;
      const s = shape === 1 ? 1 - 4 * Math.abs(((u + 0.25) % 1) - 0.5) : shape === 2 ? (u % 1 < 0.5 ? 1 : -1) : Math.sin(u * 2 * Math.PI);
      d += (i ? 'L' : 'M') + lerp(x0, x1, t).toFixed(1) + ' ' + (y - amp * s).toFixed(1);
    }
    return P(d, c);
  }
  function arrow(x1, y1, x2, y2, c = 'a') {
    const a = Math.atan2(y2 - y1, x2 - x1), s = 4;
    return L(x1, y1, x2, y2, c) + P(`M${x2 - s * Math.cos(a - 0.5)} ${y2 - s * Math.sin(a - 0.5)}L${x2} ${y2}L${x2 - s * Math.cos(a + 0.5)} ${y2 - s * Math.sin(a + 0.5)}`, c);
  }
  const logN = (v, a, b) => cl(Math.log(Math.max(v, a) / a) / Math.log(b / a), 0, 1);
  /// A filter's response across the spectrum (log, 20 Hz–20 kHz): kind lp/hp/bp/br.
  function response(kind, fc, q, c = 'a') {
    let d = '';
    for (let i = 0; i <= 48; i++) {
      const x = 6 + i, f = i / 48, r = (f - fc) * 6;
      const peak = q * 0.12 * Math.exp(-r * r * (2 + q));
      let g;
      if (kind === 'lp') g = (f <= fc ? 1 : Math.max(0, 1 - (f - fc) * 4)) + peak;
      else if (kind === 'hp') g = (f >= fc ? 1 : Math.max(0, 1 - (fc - f) * 4)) + peak;
      else if (kind === 'bp') g = Math.exp(-r * r * (0.4 + q * 0.6));
      else g = 1 - Math.exp(-r * r * (0.4 + q * 0.6));
      d += (i ? 'L' : 'M') + (x + 2).toFixed(1) + ' ' + (B - 4 - cl(g, 0, 1.4) * 26).toFixed(1);
    }
    return ground() + P(d, c);
  }
  const FILTER = { 'prism:hp-low-pass': 'lp', 'prism:hp-high-pass': 'hp', 'prism:hp-band-pass': 'bp', 'prism:hp-band-reject': 'br' };

  /// key → (value, normalised, control, process kind) → svg body
  const HP_DRAW = {
    // ── time & pitch (the grain tray's own)
    ratio: (v) => { let s = ground(); const n = Math.round(cl(6 / v, 2, 12)); for (let i = 0; i < n; i++) s += P(bell(8 + i * (48 / Math.max(1, n - 1)), 9, 16)); return s; },
    semitones: (v) => wave(6, 58, 24, 9, 2, 'f') + wave(6, 58, 24, 9, 2 * Math.pow(2, v / 12)),
    pitch: (v) => wave(6, 58, 24, 9, 2, 'f') + wave(6, 58, 24, 9, 2 * v / 100),
    pitchScale: (v) => wave(6, 58, 24, 9, 2, 'f') + wave(6, 58, 24, 9, 2 * Math.max(0.1, v)),
    windowMs: (v, n) => ground() + P(bell(32, lerp(8, 54, n), 28)),
    cloudMix: (v, n) => ground() + P(bell(32, 40, 26), 'f') + [0, 1, 2, 3, 4].map((i) => P(bell(10 + i * 11, 10, 22 * n))).join(''),
    speed: (v) => { const n = logN(v, 25, 400); return ground() + [0, 1, 2].map((i) => P(bell(14 + i * lerp(22, 8, n), 10, 18), 'f')).join('') + arrow(10, 12, lerp(22, 56, n), 12); },
    grain: (v, n) => ground() + P(bell(22, 10, 20), 'f') + P(bell(40, lerp(6, 40, n), 26)),
    xfade: (v, n) => ground() + P(bell(22, 26, 24), 'f') + P(bell(22 + lerp(26, 6, n), 26, 24)),
    // ── smoothing: a step, and how the sound glides to it
    smoothing: (v, n) => { const k = lerp(0.2, 14, n); let d = ''; for (let i = 0; i <= 40; i++) { const t = i / 40, y = t < 0.2 ? 0 : 1 - Math.exp(-(t - 0.2) * 40 / (k + 0.5)); d += (i ? 'L' : 'M') + (8 + t * 48).toFixed(1) + ' ' + (36 - y * 24).toFixed(1); } return P('M8 36L17.6 36L17.6 12L56 12', 'f', dash) + P(d); },
    smoothingStep: (v) => { const n = logN(v, 1, 2048), w = lerp(2, 16, n); let d = 'M6 36', y = 36; for (let x = 6; x < 58; x += w) { y = 36 - 24 * ((x - 6) / 52); d += `L${(x).toFixed(1)} ${y.toFixed(1)}L${Math.min(58, x + w).toFixed(1)} ${y.toFixed(1)}`; } return L(6, 36, 58, 12, 'f', dash) + P(d); },
    // ── level
    outputDb: (v) => { const g = Math.pow(10, v / 20); return L(4, 24, 60, 24) + wave(6, 58, 24, 7, 3, 'f') + wave(6, 58, 24, cl(7 * g, 0.5, 18), 3); },
    gainDb: (v) => { const g = Math.pow(10, v / 20); return L(4, 24, 60, 24) + wave(6, 58, 24, 14, 3, 'f') + wave(6, 58, 24, cl(14 * g, 0.3, 16), 3); },
    volumeDb: (v) => HP_DRAW.gainDb(v),
    mix: (v, n) => wave(6, 58, 16, 7 * (1 - n) + 0.5, 3, 'f') + wave(6, 58, 34, 7 * n + 0.5, 5),
    att1Db: (v) => ground() + P(bell(12, 10, 26), 'f') + P(bell(30, 10, 26 * Math.pow(10, -v / 20))),
    att2Db: (v) => ground() + P(bell(12, 10, 26), 'f') + P(bell(40, 10, 26 * Math.pow(10, -v / 20))),
    att3Db: (v) => ground() + P(bell(12, 10, 26), 'f') + P(bell(52, 10, 26 * Math.pow(10, -v / 20))),
    // ── delays
    delayMs: (v, n) => ground() + P(bell(10, 9, 26), 'f') + P(bell(lerp(14, 56, Math.sqrt(n)), 9, 20)) + arrow(10, 8, lerp(14, 56, Math.sqrt(n)), 8, 'f'),
    delay1Ms: (v, n) => ground() + P(bell(10, 9, 26), 'f') + P(bell(lerp(14, 56, n), 9, 20)),
    delay2Ms: (v, n) => ground() + P(bell(10, 9, 26), 'f') + P(bell(lerp(14, 56, n), 9, 14)),
    feedback: (v, n) => { let s = ground() + P(bell(8, 7, 26), 'f'); for (let i = 1; i <= 6; i++) { const h = 26 * Math.pow(n, i); if (h > 0.6) s += P(bell(8 + i * 8.5, 7, h)); } return s; },
    crossfade: (v) => { const n = logN(v, 64, 32768), w = lerp(4, 40, n); return P(`M6 12L${32 - w / 2} 12L${32 + w / 2} 36L58 36`, 'f') + P(`M6 36L${32 - w / 2} 36L${32 + w / 2} 12L58 12`); },
    leftTapMs: (v, n) => L(6, 16, 58, 16) + ground() + C(lerp(8, 56, n), 16, 3),
    rightTapMs: (v, n) => L(6, 16, 58, 16) + ground() + C(lerp(8, 56, n), B, 3),
    lookAhead: (v) => { const n = logN(v, 128, 2048); return ground() + P(bell(40, 12, 26), 'f') + arrow(40, 8, lerp(36, 8, n), 8); },
    followMs: (v, n) => wave(6, 58, 24, 10, 2, 'f') + P(`M6 24C${lerp(10, 40, n)} 24 ${lerp(16, 50, n)} 14 58 14`),
    // ── modulation
    rateHz: (v, n) => L(4, 24, 60, 24) + wave(6, 58, 24, 9, lerp(0.5, 6, n)),
    depth: (v, n) => L(4, 24, 60, 24) + L(6, 24 - 14, 58, 24 - 14, 'f', dash) + L(6, 24 + 14, 58, 24 + 14, 'f', dash) + wave(6, 58, 24, 14 * n + 0.3, 2.5),
    lfoShape: (v) => L(4, 24, 60, 24) + wave(6, 58, 24, 11, 2, 'a', 0, Math.round(v)),
    stereoPhaseDeg: (v) => wave(6, 58, 16, 6, 2, 'f') + wave(6, 58, 34, 6, 2, 'a', v / 360),
    startPhaseDeg: (v) => { const a = v / 180 * Math.PI; return C(32, 24, 14, 'f') + L(32, 24, 32 + 14 * Math.cos(a), 24 - 14 * Math.sin(a), 'a') + C(32 + 14 * Math.cos(a), 24 - 14 * Math.sin(a), 2.5, 'af'); },
    baseHz: (v) => { const n = logN(v, 20, 10000); let d = ''; for (let i = 0; i <= 48; i++) { const f = i / 48, r = (f - n) * 10; d += (i ? 'L' : 'M') + (8 + i) + ' ' + (B - 4 - 26 * (1 - 0.8 * Math.exp(-r * r))).toFixed(1); } return ground() + P(d); },
    stages: (v) => { const k = Math.round(v / 2); let d = ''; for (let i = 0; i <= 48; i++) { const f = i / 48; d += (i ? 'L' : 'M') + (8 + i) + ' ' + (B - 4 - 26 * (1 - 0.85 * Math.pow(Math.abs(Math.cos(f * k * Math.PI)), 6))).toFixed(1); } return ground() + P(d); },
    notchDepth: (v, n) => { let d = ''; for (let i = 0; i <= 48; i++) { const f = i / 48, r = (f - 0.5) * 9; d += (i ? 'L' : 'M') + (8 + i) + ' ' + (B - 4 - 26 * (1 - n * Math.exp(-r * r))).toFixed(1); } return ground() + P(d); },
    // ── filters
    freqHz: (v, n, c, kind) => response(FILTER[kind] || 'lp', logN(v, 20, 20000), 1.5),
    q: (v, n, c, kind) => response(FILTER[kind] || 'lp', 0.5, v),
    lowCutHz: (v) => response('hp', logN(v, 20, 20000) * 0.7, 0.5),
    lowCutQ: (v) => response('hp', 0.35, v * 2),
    brightness: (v, n) => ground() + P(`M8 14L56 ${lerp(38, 14, n).toFixed(1)}`) + L(8, 14, 56, 14, 'f', dash),
    rate: (v, n) => { const k = Math.round(lerp(3, 26, n)); let d = ''; for (let i = 0; i < k; i++) { const x0 = 6 + i * 52 / k, x1 = 6 + (i + 1) * 52 / k, y = 24 - 12 * Math.sin((i + 0.5) / k * 4 * Math.PI); d += (i ? 'L' : 'M') + x0.toFixed(1) + ' ' + y.toFixed(1) + 'L' + x1.toFixed(1) + ' ' + y.toFixed(1); } return wave(6, 58, 24, 12, 2, 'f') + P(d); },
    bits: (v) => { const lv = Math.pow(2, Math.round(v)) / 2; let d = ''; for (let i = 0; i <= 64; i++) { const t = i / 64, y = Math.round(Math.sin(t * 4 * Math.PI) * Math.min(lv, 6)) / Math.min(lv, 6); d += (i ? 'L' : 'M') + (6 + t * 52).toFixed(1) + ' ' + (24 - 12 * y).toFixed(1); } return wave(6, 58, 24, 12, 2, 'f') + P(d); },
    // ── reverb
    diffusion: (v, n) => { let s = ground(); const k = Math.round(lerp(2, 18, n / 1.5)); for (let i = 0; i < k; i++) { const x = 8 + i * (48 / k) + 3 * Math.sin(i * 7.1); s += L(x, B, x, B - 24 * Math.exp(-i / (k * 0.6)), 'a'); } return s; },
    size: (v, n) => { const w = lerp(16, 52, n), h = lerp(10, 30, n); return `<rect x="${32 - w / 2}" y="${B - h}" width="${w}" height="${h}" class="a"/>` + C(32, B - 4, 2, 'af'); },
    // ── space
    level: (v) => { const w = cl(v / 100, 0, 3) * 8; return L(32, 8, 32, B, 'f', dash) + C(32 - w, 24, 4) + C(32 + w, 24, 4); },
    xM: (v) => L(6, 24, 58, 24, 'f') + C(32, 40, 3, 'f') + C(32 + v / 100 * 24, 24, 3.5, 'af'),
    yM: (v) => L(32, 6, 32, 42, 'f') + C(32, 40, 3, 'f') + C(32, 24 - v / 100 * 16, 3.5, 'af'),
    balance: (v) => L(8, 24, 56, 24, 'f') + `<text x="4" y="28" class="t">L</text><text x="56" y="28" class="t">R</text>` + C(32 + v / 100 * 22, 24, 4, 'af'),
    position: (v, n) => L(8, 24, 56, 24, 'f') + `<text x="4" y="28" class="t">L</text><text x="56" y="28" class="t">R</text>` + C(lerp(10, 54, n), 24, 4, 'af'),
    panLaw: (v) => { const k = Math.round(v); let d = '', e = ''; for (let i = 0; i <= 32; i++) { const t = i / 32, g = k === 0 ? Math.cos(t * Math.PI / 2) : k === 1 ? Math.min(1, 2 * (1 - t)) : 1 - t; const h = k === 0 ? Math.sin(t * Math.PI / 2) : k === 1 ? Math.min(1, 2 * t) : t; d += (i ? 'L' : 'M') + (8 + t * 48) + ' ' + (B - 30 * g).toFixed(1); e += (i ? 'L' : 'M') + (8 + t * 48) + ' ' + (B - 30 * h).toFixed(1); } return ground() + P(d) + P(e, 'f'); },
    leftGain: (v, n) => L(8, B, 56, B) + `<rect x="14" y="${B - 30 * n}" width="12" height="${30 * n}" class="af"/><rect x="38" y="10" width="12" height="30" class="f"/>`,
    rightGain: (v, n) => L(8, B, 56, B) + `<rect x="14" y="10" width="12" height="30" class="f"/><rect x="38" y="${B - 30 * n}" width="12" height="${30 * n}" class="af"/>`,
    sideVolume: (v) => { const s = cl(v / 400, -1, 1); return L(6, 24, 58, 24, 'f') + `<text x="10" y="44" class="t">M</text><text x="42" y="44" class="t">S</text><rect x="10" y="12" width="10" height="12" class="f"/><rect x="40" y="${s > 0 ? 24 - 14 * s : 24}" width="10" height="${Math.abs(14 * s)}" class="af"/>`; },
    sideGain: (v) => { const s = cl(v / 90, -1, 1); return L(6, 24, 58, 24, 'f') + `<text x="10" y="44" class="t">M</text><text x="42" y="44" class="t">S</text><rect x="10" y="12" width="10" height="12" class="f"/><rect x="40" y="${s > 0 ? 24 - 14 * s : 24}" width="10" height="${Math.abs(14 * s)}" class="af"/>`; },
    midGain: (v) => { const s = cl(v / 400, -1, 1); return L(6, 24, 58, 24, 'f') + `<text x="10" y="44" class="t">M</text><text x="42" y="44" class="t">S</text><rect x="10" y="${s > 0 ? 24 - 14 * s : 24}" width="10" height="${Math.abs(14 * s)}" class="af"/><rect x="40" y="16" width="10" height="8" class="f"/>`; },
    input: (v) => v ? P('M6 14L30 24L58 24') + P('M6 34L30 24', 'a') : P('M6 14L58 14') + P('M6 34L58 34', 'f'),
    mono: (v) => HP_DRAW.input(v),
    output: (v) => v ? L(6, 24, 58, 24, 'f') + arrow(6, 14, 50, 34) + `<text x="52" y="44" class="t">R</text>` : L(6, 24, 58, 24, 'f') + arrow(6, 34, 50, 14) + `<text x="52" y="12" class="t">L</text>`,
    // ── dynamics
    attackMs: (v) => { const n = logN(v + 1, 1, 1001); return ground() + P(`M6 ${B}L${lerp(8, 34, n).toFixed(1)} 10L44 10L58 ${B}`) + P('M6 40L6 10L44 10', 'f', dash); },
    releaseMs: (v) => { const n = logN(v + 1, 1, 1001); return ground() + P(`M6 ${B}L10 10L30 10C${lerp(32, 58, n)} 10 ${lerp(34, 58, n)} ${B} 58 ${B}`); },
    thresholdDb: (v) => { const y = 24 - 14 * Math.pow(10, v / 20); return wave(6, 58, 24, 14, 3, 'f') + L(4, y, 60, y, 'a', 'stroke-dasharray="4 2"') + L(4, 48 - y, 60, 48 - y, 'a', 'stroke-dasharray="4 2"'); },
    compressionDb: (v) => { const k = cl(1 + (-v) / 12, 1, 9), th = 24; let d = ''; for (let i = 0; i <= 40; i++) { const x = i / 40 * 40, y = x < th ? x : th + (x - th) / k; d += (i ? 'L' : 'M') + (12 + x).toFixed(1) + ' ' + (44 - y).toFixed(1); } return L(12, 44, 52, 4, 'f', dash) + P(d); },
  };

  /// Which colour: what the control does to the sound (the app's facets).
  const HP_FACET = {
    time: ['ratio', 'windowMs', 'speed', 'grain', 'xfade', 'delayMs', 'delay1Ms', 'delay2Ms', 'feedback', 'crossfade', 'leftTapMs', 'rightTapMs', 'smoothing', 'smoothingStep', 'rateHz', 'startPhaseDeg', 'followMs', 'lookAhead'],
    pitch: ['semitones', 'pitch', 'pitchScale', 'depth', 'lfoShape'],
    tone: ['freqHz', 'q', 'lowCutHz', 'lowCutQ', 'brightness', 'baseHz', 'stages', 'notchDepth', 'rate', 'bits', 'diffusion'],
    attack: ['attackMs', 'releaseMs', 'thresholdDb', 'compressionDb'],
    space: ['size', 'level', 'xM', 'yM', 'balance', 'position', 'panLaw', 'stereoPhaseDeg', 'sideVolume', 'sideGain', 'midGain', 'input', 'mono', 'output', 'leftGain', 'rightGain'],
    level: ['outputDb', 'gainDb', 'volumeDb', 'mix', 'att1Db', 'att2Db', 'att3Db', 'cloudMix'],
  };
  const facetOf = (k) => Object.keys(HP_FACET).find((f) => HP_FACET[f].includes(k)) || 'level';
  function hpGlyph(c, v, kind) {
    const f = HP_DRAW[c.key];
    const n = (v - c.min) / ((c.max - c.min) || 1);
    return `<svg class="gg" viewBox="0 0 64 48" aria-hidden="true">${f ? f(v, cl(n, 0, 1), c, kind) : ''}</svg>`;
  }

  /// One picture per process, for the Process menu: what it does, at a glance.
  const PROC_ICON = {
    'stretch': () => HP_DRAW.ratio(2),
    'ptc': () => ground() + [0, 1, 2].map((i) => P(bell(12 + i * 13, 9, 18), 'f')).join('') + arrow(8, 10, 56, 10),
    'prism:hp-low-pass': () => response('lp', 0.45, 1.5),
    'prism:hp-high-pass': () => response('hp', 0.55, 1.5),
    'prism:hp-band-pass': () => response('bp', 0.5, 2),
    'prism:hp-band-reject': () => response('br', 0.5, 2),
    'prism:hp-comb-filter': () => HP_DRAW.stages(8),
    'prism:hp-single-delay': () => HP_DRAW.delay1Ms(0, 0.6),
    'prism:hp-echo': () => HP_DRAW.feedback(0, 0.75),
    'prism:hp-echotranz': () => ground() + P(bell(8, 7, 26), 'f') + [1, 2, 3, 4].map((i) => P(bell(8 + i * 11, 7, 26 * Math.pow(0.7, i)), 'a', `transform="translate(0 ${i * -2})"`)).join(''),
    'prism:hp-multi-delay': () => ground() + P(bell(8, 7, 26), 'f') + P(bell(26, 7, 20)) + P(bell(40, 7, 14)) + P(bell(54, 7, 9)),
    'prism:hp-medium-room': () => HP_DRAW.size(0, 0.45),
    'prism:hp-hall': () => HP_DRAW.size(0, 1),
    'prism:hp-chorus': () => wave(6, 58, 22, 8, 2, 'f') + wave(6, 58, 26, 8, 2.2),
    'prism:hp-flanger': () => HP_DRAW.stages(6) + arrow(14, 6, 50, 6, 'f'),
    'prism:hp-ring-modulator': () => { let d = ''; for (let i = 0; i <= 64; i++) { const t = i / 64; d += (i ? 'L' : 'M') + (6 + t * 52).toFixed(1) + ' ' + (24 - 14 * Math.sin(t * 12 * Math.PI) * Math.sin(t * 2 * Math.PI)).toFixed(1); } return L(4, 24, 60, 24) + P(d); },
    'prism:hp-vibrato': () => { let d = ''; for (let i = 0; i <= 80; i++) { const t = i / 80, ph = t * 5 + 0.6 * Math.sin(t * 2 * Math.PI * 2); d += (i ? 'L' : 'M') + (6 + t * 52).toFixed(1) + ' ' + (24 - 10 * Math.sin(ph * 2 * Math.PI)).toFixed(1); } return P(d); },
    'prism:hp-tremolo': () => { let d = ''; for (let i = 0; i <= 80; i++) { const t = i / 80; d += (i ? 'L' : 'M') + (6 + t * 52).toFixed(1) + ' ' + (24 - 14 * (0.55 + 0.45 * Math.sin(t * 4 * Math.PI)) * Math.sin(t * 16 * Math.PI)).toFixed(1); } return L(4, 24, 60, 24) + P(d); },
    'prism:hp-frequency-modulator': () => { let d = ''; for (let i = 0; i <= 80; i++) { const t = i / 80, ph = t * 4 + 0.25 * Math.sin(t * 2 * Math.PI * 6); d += (i ? 'L' : 'M') + (6 + t * 52).toFixed(1) + ' ' + (24 - 12 * Math.sin(ph * 2 * Math.PI)).toFixed(1); } return P(d); },
    'prism:hp-phaser': () => HP_DRAW.stages(4),
    'prism:hp-pitch-shifter': () => HP_DRAW.semitones(7),
    'prism:hp-more-stereo': () => HP_DRAW.level(250),
    'prism:hp-doppler': () => L(6, 30, 58, 30, 'f') + C(32, 42, 3, 'f') + arrow(10, 22, 54, 22) + C(30, 22, 3.5, 'af'),
    'prism:hp-pan': () => HP_DRAW.balance(-50),
    'prism:hp-auto-pan': () => L(8, 24, 56, 24, 'f') + `<text x="4" y="28" class="t">L</text><text x="56" y="28" class="t">R</text>` + P('M14 24C20 10 44 10 50 24', 'a') + C(50, 24, 3.5, 'af'),
    'prism:hp-stereo-dynamics': () => HP_DRAW.rightGain(0, 0.5),
    'prism:hp-quasi-stereo': () => HP_DRAW.input(0) .replace('class="f"', 'class="a"'),
    'prism:hp-ms-matrix': () => HP_DRAW.sideVolume(200),
    'prism:hp-hyper-stereo': () => HP_DRAW.level(300),
    'prism:hp-noise-gate': () => HP_DRAW.thresholdDb(-12),
    'prism:hp-compressor': () => HP_DRAW.compressionDb(-48),
    'prism:hp-sonic-decimator': () => HP_DRAW.bits(3),
  };
  function procIcon(proc) {
    const f = PROC_ICON[proc.kind];
    return `<svg class="gg pic" viewBox="0 0 64 48" aria-hidden="true">${f ? f() : ''}</svg>`;
  }

  // The LFOs' own controls (`387-prism-lfo.js`).
  HP_DRAW.lfoRate = (v) => L(4, 24, 60, 24) + wave(6, 58, 24, 9, Math.max(0.5, Math.min(8, v)));
  HP_DRAW.lfoDepth = (v, n) => L(4, 24, 60, 24) + L(6, 10, 58, 10, 'f', dash) + L(6, 38, 58, 38, 'f', dash) + wave(6, 58, 24, 14 * n + 0.3, 2);
  HP_DRAW.lfoPw = (v) => { const w = v / 100 * 26; return P(`M6 36L6 12L${6 + w} 12L${6 + w} 36L32 36L32 12L${32 + w} 12L${32 + w} 36L58 36`); };
  // The Takes bank's own: Hyperprism's 0–255 Playback Speed, and Post-roll.
  HP_DRAW.pbSpeed = (v) => HP_DRAW.speed(v / 128 * 100);
  HP_DRAW.postRoll = (v, n) => ground() + P(bell(14, 12, 26), 'f') + P(`M20 ${B - 14}C${(26 + 30 * n).toFixed(1)} ${B - 6} ${(30 + 30 * n).toFixed(1)} ${B} ${(32 + 26 * n).toFixed(1)} ${B}`);
  HP_FACET.time.push('lfoRate', 'lfoDepth', 'lfoPw', 'pbSpeed', 'postRoll');

  return { HP_DRAW, PROC_ICON, HP_FACET, facetOf, hpGlyph, procIcon, L, P, wave, dash };
})();
