// ============================================================ built-in effect faces
//
// The FX channel's own effects — the EQ, the compressor, the gain, every shaper
// and the prism effects that are this program's — each drawn as a face rather
// than as a list of sliders: a live display of what it is doing at the top,
// then its controls in their sections, packed so every row runs the module's
// full width. Approved as a mock-up on 1 Nov 2026, after the CleanRoom
// references (Audio Damage, Ableton's Compressor, Logic's Channel EQ,
// FabFilter Pro-L) and a pass of the design council.
//
// **The control a setting gets is chosen per setting.** Mostly a knob: its
// ring is the value and its cap is a picture of what the value does. A level
// you ride (wet, dry, gain) is a fader; a switch is a lit tile with its
// picture; a technical setting — an all-pass coefficient, a noise clock — is a
// slider in an Engine row, read and moved with its neighbours. A threshold or
// a ceiling is an arrow on the meter it is measured against.
//
// **The display is the pad.** Where an effect declares a Prism pad pair, the
// display takes it: drag in it and those two knobs follow.
//
// **Advanced** sets each knob's own range (its start, its end, its curve) and
// saves it with the rack (`RackSpec::ranges`). Inside the effect's own limits:
// those are the engine's, and it clamps to them.
//
// Everything that draws is a pure function of the values, in `FXP`; nothing
// there keeps state, so a reset, a preset or an undo redraws as a drag does.

/// The pictures and the displays, kept in a closure so their one-letter
/// helpers stay out of the app's global scope.
const FXP = (() => {
  // ───────────────────────────── drawing kit (64 × 48, ground at 40) ──
  const B = 40, N = (v) => (Math.round(v * 100) / 100).toString();
  const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (i, s = 7) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  const L = (x1, y1, x2, y2, c = 'f', e = '') => `<line x1="${N(x1)}" y1="${N(y1)}" x2="${N(x2)}" y2="${N(y2)}" class="${c}" ${e}/>`;
  const P = (d, c = 'a', e = '') => `<path d="${d}" class="${c}" ${e}/>`;
  const C = (x, y, r, c = 'a') => `<circle cx="${N(x)}" cy="${N(y)}" r="${N(Math.max(.2, r))}" class="${c}"/>`;
  const R = (x, y, w, h, c = 'a') => `<rect x="${N(x)}" y="${N(y)}" width="${N(Math.max(0, w))}" height="${N(Math.max(0, h))}" class="${c}"/>`;
  const T = (x, y, s, c = 't', a = 'start') => `<text x="${N(x)}" y="${N(y)}" class="${c}" text-anchor="${a}">${s}</text>`;
  const G = () => L(4, B, 60, B);
  const dash = 'stroke-dasharray="2 3"';
  function bell(cx, w, h, base = B, peak = .5) {
    let d = ''; for (let i = 0; i <= 16; i++) { const t = i / 16, u = t < peak ? .5 * t / peak : .5 + .5 * (t - peak) / (1 - peak);
      d += (i ? 'L' : 'M') + N(cx - w / 2 + w * t) + ' ' + N(base - h * .5 * (1 - Math.cos(2 * Math.PI * u))); } return d;
  }
  function wave(x0, x1, y, amp, cyc, c = 'a', ph = 0, fn = Math.sin) {
    let d = ''; for (let i = 0; i <= 64; i++) { const t = i / 64; d += (i ? 'L' : 'M') + N(lerp(x0, x1, t)) + ' ' + N(y - amp * fn((t * cyc + ph) * 2 * Math.PI)); } return P(d, c);
  }
  function arrow(x1, y1, x2, y2, c = 'a') { const a = Math.atan2(y2 - y1, x2 - x1), s = 4;
    return L(x1, y1, x2, y2, c) + P(`M${N(x2 - s * Math.cos(a - .5))} ${N(y2 - s * Math.sin(a - .5))}L${N(x2)} ${N(y2)}L${N(x2 - s * Math.cos(a + .5))} ${N(y2 - s * Math.sin(a + .5))}`, c); }
  function imp(x, h, c = 'a') { return L(x, B, x, B - h, c); }
  function tail(x0, len, h, c = 'a') { let d = `M${N(x0)} ${N(B - h)}`; for (let i = 1; i <= 20; i++) { const t = i / 20; d += `L${N(x0 + len * t)} ${N(B - h * Math.exp(-4 * t))}`; } return P(d, c); }
  function strip(y = 12) { let s = ''; for (let i = 0; i < 27; i++) { const x = 6 + i * 2, h = 1 + 5 * rnd(i, 3); s += L(x, y - h / 2, x, y + h / 2); } return s; }
  function spectrum(fn, c = 'a') { let d = ''; for (let i = 0; i <= 40; i++) { const t = i / 40; d += (i ? 'L' : 'M') + N(4 + 56 * t) + ' ' + N(B - 30 * cl(fn(t))); } return P(d, c); }
  function bars(n, fn, c = 'a', x0 = 6, x1 = 58) { let s = ''; for (let i = 0; i < n; i++) { const x = lerp(x0, x1, n > 1 ? i / (n - 1) : .5); s += L(x, B, x, B - 30 * cl(fn(i, n))); } return s; }
  const svg = (inner, cls = 'pic') => `<svg class="${cls}" viewBox="0 0 64 48" aria-hidden="true">${inner}</svg>`;

  // ───────────────────────────── pictures, by what the control does ──
  // Each takes n (the value across its range, 0…1, log where the control is),
  // v (the value itself) and p (the control). Named for the job, so one picture
  // serves every control that does that job, in every surface.
  const PIC = {
    // time and delay
    delay: (n) => G() + imp(8, 26, 'f') + imp(lerp(12, 58, n), 20) + L(8, 8, lerp(12, 58, n), 8, 'a') + L(8, 5, 8, 11, 'a'),
    predelay: (n) => { const x = lerp(8, 34, n); return G() + imp(6, 26, 'f') + L(6, 8, x, 8, 'a') + tail(x, 58 - x, 22); },
    feedback: (n) => { let s = G() + imp(6, 28, 'f'); for (let i = 1; i < 6; i++) s += imp(6 + i * 10, 28 * Math.pow(n, i)); return s; },
    taps: (n, v) => { const k = cl(Math.round(v) || 1, 1, 12); let s = G(); for (let i = 0; i < k; i++) s += imp(8 + i * 48 / Math.max(1, k - 1 || 1), 26 - i * 1.5); return s; },
    // level and mix
    level: (n) => R(26, B - 32, 12, 32, 'f') + R(26, B - 32 * n, 12, 32 * n, 'af') + L(22, B - 32 * .8, 42, B - 32 * .8, 'f') + T(46, B - 32 * .8 + 3, '0'),
    mix: (n) => R(14, B - 30 * (1 - n), 12, 30 * (1 - n), 'ff') + R(38, B - 30 * n, 12, 30 * n, 'af') + G() + T(20, 47, 'dry', 't', 'middle') + T(44, 47, 'wet', 'ta', 'middle'),
    // modulation
    rate: (n) => wave(4, 60, 22, 11, lerp(.5, 8, n)) + L(4, 22, 60, 22, 'f', 'stroke-dasharray="1 2"'),
    depth: (n) => wave(4, 60, 22, 14, 2, 'f', 0) + wave(4, 60, 22, 14 * n, 2),
    // frequency
    freq: (n) => G() + spectrum((t) => .15 + .8 * Math.exp(-Math.pow((t - n) * 9, 2))) + L(4 + 56 * n, B, 4 + 56 * n, B + 4, 'a'),
    lowpass: (n) => G() + spectrum((t) => t < n ? .85 : .85 * Math.exp(-(t - n) * 14)) + L(4 + 56 * n, 6, 4 + 56 * n, B, 'f', dash),
    highpass: (n) => G() + spectrum((t) => t > n ? .85 : .85 * Math.exp(-(n - t) * 14)) + L(4 + 56 * n, 6, 4 + 56 * n, B, 'f', dash),
    q: (n) => G() + spectrum((t) => .1 + .85 * Math.exp(-Math.pow((t - .5) * lerp(3, 26, n), 2))),
    xover: (n) => G() + spectrum((t) => t < n ? .8 : .35, 'a') + L(4 + 56 * n, 4, 4 + 56 * n, B, 'a') + T(8, 9, 'lo') + T(56, 9, 'hi', 't', 'end'),
    // dynamics
    threshold: (n) => { const y = lerp(36, 8, n), x = lerp(8, 52, n); return L(6, 42, 58, 6) + P(`M6 42L${N(x)} ${N(y + 4)}L58 ${N(y)}`) + L(4, y + 4, 60, y + 4, 'f', dash); },
    ratio: (n, v) => { const r = Math.max(1, v || 1), k = 26; return L(6, 42, 58, 6) + P(`M6 42L${k} 22L58 ${N(22 - 32 / r * .6)}`) + T(58, 46, `${(v || 1).toFixed(1)}:1`, 't', 'end'); },
    attack: (n) => { const x = lerp(8, 50, n); return G() + P(`M6 ${B}L${N(x)} 10L58 10`) + L(6, 44, x, 44, 'a'); },
    release: (n) => { const x = lerp(14, 58, n); return G() + P(`M6 10L10 10Q${N((10 + x) / 2)} 10 ${N(x)} ${B}`) + L(10, 44, x, 44, 'a'); },
    knee: (n) => { const r = lerp(1, 18, n); return L(6, 42, 58, 6) + P(`M6 42L${N(28 - r)} ${N(22 + r * .6)}Q28 22 ${N(28 + r)} ${N(22 - r * .25)}L58 14`); },
    gate: (n) => { const y = lerp(36, 10, n); let s = L(4, y, 60, y, 'f', dash); for (let i = 0; i < 13; i++) { const h = 6 + 26 * rnd(i, 4), x = 6 + i * 4.3; s += L(x, B, x, B - h, B - h < y ? 'a' : 'f'); } return s; },
    // space
    tail: (n) => G() + imp(6, 28, 'f') + tail(6, lerp(8, 54, n), 26),
    size: (n) => { const w = lerp(14, 50, n), h = lerp(10, 30, n), x = 32 - w / 2, y = B - h; let s = R(x, y, w, h); for (let i = 0; i < 4; i++) s += L(32, B - 4, x + w * rnd(i, 2), y + h * rnd(i, 5) * .5, 'f'); return s + C(32, B - 4, 2, 'af'); },
    diffusion: (n) => { let s = G(); const k = Math.round(lerp(4, 40, n)); for (let i = 0; i < k; i++) s += C(6 + 52 * rnd(i, 3), 8 + 30 * rnd(i, 9), .9, 'af'); return s; },
    damping: (n) => G() + tail(6, 52, 24, 'f') + tail(6, lerp(52, 12, n), 24) + T(58, 9, 'hi', 't', 'end'),
    bassRt: (n) => G() + tail(6, 34, 24, 'f') + tail(6, lerp(10, 56, n / 1), 24) + T(58, 9, 'lo', 'ta', 'end'),
    tapSlope: (n, v) => { const sl = (v || 0) / 10; let s = ''; for (let i = 0; i < 12; i++) { const t = i / 11, trend = 1 - t, h = 30 * cl(trend * (1 + sl * (t - .5) * 1.4) + (sl < 0 ? .1 * (i % 3 === 0) : 0), .05, 1); s += L(6 + i * 4.6, B, 6 + i * 4.6, B - h, 'a'); } return P(`M4 ${B}L4 10L60 ${B}Z`, 'ff') + s; },
    shape: (n) => G() + P(bell(lerp(14, 40, n), lerp(16, 40, n), 28, B, cl(n, .1, .9))) + T(6, 9, 'early'),
    spread: (n) => G() + P(bell(24, lerp(10, 50, n), 24, B, .2)) + L(24 - lerp(10, 50, n) / 2, 44, 24 + lerp(10, 50, n) / 2, 44, 'a'),
    wander: (n) => { let s = ''; for (let k = 0; k < 3; k++) s += wave(4, 60, 14 + k * 11, 4 * n, 2 + k, k ? 'f' : 'a', rnd(k, 2)); return s; },
    spin: (n) => { let s = C(32, 24, 14, 'f'); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + n * 3; s += C(32 + 14 * Math.cos(a), 24 + 14 * Math.sin(a), 1.6, 'af'); } return s + arrow(32, 24, 32 + 12 * Math.cos(n * 6), 24 + 12 * Math.sin(n * 6)); },
    // stereo
    pan: (n) => { const a = (n - .5) * 2.4; return P('M10 40A22 22 0 0 1 54 40', 'f') + C(32 + 22 * Math.sin(a), 40 - 22 * Math.cos(a), 3, 'af') + T(4, 44, 'L') + T(60, 44, 'R', 't', 'end'); },
    width: (n) => { const d = lerp(1, 22, n); return P('M10 40A22 22 0 0 1 54 40', 'f') + C(32 - d, 40 - Math.sqrt(484 - d * d), 2.6, 'af') + C(32 + d, 40 - Math.sqrt(484 - d * d), 2.6, 'af') + L(32 - d, 30, 32 + d, 30, 'a'); },
    // pitch and shaping
    pitch: (n, v, p) => { const st = p && /ct|cent/i.test(p.unit) ? v / 100 : (v || 0); return wave(4, 46, 24, 9, 2, 'f') + wave(4, 46, 24, 9, 2 * Math.pow(2, cl(st, -24, 24) / 12)) + (Math.abs(st) > .01 ? arrow(55, 24, 55, 24 - cl(st / 12, -1, 1) * 14) : C(55, 24, 1.6, 'af')); },
    bits: (n, v) => { const lv = Math.pow(2, Math.round(lerp(1, 6, n))); let d = ''; for (let i = 0; i <= 48; i++) { const t = i / 48, y = Math.round(Math.sin(t * 2 * Math.PI) * lv / 2) / (lv / 2); d += (i ? 'L' : 'M') + N(6 + 52 * t) + ' ' + N(24 - 14 * y); } return wave(6, 58, 24, 14, 1, 'f') + P(d); },
    srate: (n) => { const st = Math.round(lerp(24, 3, n)); let d = ''; for (let i = 0; i < st; i++) { const t0 = i / st, y = 24 - 14 * Math.sin(t0 * 2 * Math.PI); d += (i ? 'L' : 'M') + N(6 + 52 * t0) + ' ' + N(y) + 'L' + N(6 + 52 * (i + 1) / st) + ' ' + N(y); } return wave(6, 58, 24, 14, 1, 'f') + P(d); },
    drive: (n) => { const k = lerp(1, 8, n); let d = ''; for (let i = 0; i <= 48; i++) { const t = i / 48, y = Math.tanh(k * Math.sin(t * 2 * Math.PI)) / Math.tanh(k); d += (i ? 'L' : 'M') + N(6 + 52 * t) + ' ' + N(24 - 14 * y); } return wave(6, 58, 24, 14, 1, 'f') + P(d); },
    harmonic: (n, v, p) => { const k = +((p?.key || '').match(/\d+/) || [3])[0]; return bars(8, (i) => i === 0 ? .7 : i === k - 1 ? .7 * n : .06, 'a'); },
    polarity: (n) => wave(4, 60, 24, 12, 1.5, 'f') + wave(4, 60, 24, n > .5 ? -12 : 12, 1.5),
    count: (n, v) => { const k = cl(Math.round(v) || 1, 1, 16); let s = ''; for (let i = 0; i < k; i++) s += P(bell(32 + (i - (k - 1) / 2) * lerp(6, 3, k / 16), 22, 22 - i * .4, B), i ? 'f' : 'a'); return s + T(60, 9, k, 'ta', 'end'); },
    scatter: (n, v) => { let s = G(); for (let i = 0; i < 9; i++) s += C(6 + 52 * rnd(i, (v | 0) % 997 + 1), 10 + 26 * rnd(i + 9, (v | 0) % 997 + 1), 1.8, 'af'); return s; },
    frames: (n) => { let s = ''; const k = Math.round(lerp(2, 16, n)); for (let i = 0; i < k; i++) s += R(6 + i * 52 / k, 12, 52 / k - 1.5, 26, i === 0 ? 'a' : 'f'); return s; },
    interval: (n, v, p) => { const iv = { root: 0, m2: 1, M2: 2, m3: 3, M3: 4, '4th': 5, '5th': 7, m6: 8, M6: 9, m7: 10, M7: 11, octave: 12, just: 7 }[p?.label] ?? { root: 0, octave: 12, just: 7 }[(p?.label || '').toLowerCase()] ?? 7; let s = ''; for (let i = 0; i < 13; i++) { const on = i === 0 || i === iv; s += R(4 + i * 4.4, 10, 4, 28, on && n > .5 ? 'af' : on ? 'a' : 'f'); } return s; },
    freeze: (n) => { let s = ''; for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) { const held = n > .5 && i > 3, a = rnd((held ? 3 : i) * 7 + j, 2); if (a > .4) s += R(5 + i * 6, 6 + j * 6, 5, 5, held ? 'af' : 'ff'); } return s + (n > .5 ? L(28, 4, 28, 44, 'a') : ''); },
    swap: (n) => n > .5 ? arrow(8, 14, 56, 34) + arrow(8, 34, 56, 14) + T(4, 10, 'L') + T(4, 44, 'R') : arrow(8, 14, 56, 14) + arrow(8, 34, 56, 34) + T(4, 10, 'L') + T(4, 44, 'R'),
    link: (n) => wave(4, 60, 16, 6, 2) + wave(4, 60, 34, 6, 2, 'a', n > .5 ? 0 : .35) + (n > .5 ? L(32, 16, 32, 34, 'a', 'stroke-dasharray="2 2"') : ''),
    smooth: (n) => { const st = 6; let d = ''; for (let i = 0; i < st; i++) { const y = 34 - 24 * (i / (st - 1)); d += (i ? 'L' : 'M') + N(6 + i * 9) + ' ' + N(y) + 'L' + N(6 + (i + 1) * 9) + ' ' + N(y); } let c = 'M6 34'; for (let i = 1; i <= 30; i++) { const t = i / 30, k = lerp(.02, .9, n); c += 'L' + N(6 + 54 * t) + ' ' + N(34 - 24 * Math.min(1, Math.max(0, (t - k * .3) / Math.max(.05, 1 - k * .3)) ** lerp(1, .5, n))); } return P(d, 'f') + P(c); },
    taplevel: (n, v, p) => { const k = +((p?.label || '').match(/\d/) || [1])[0]; let s = G() + imp(8, 28, 'f'); for (let i = 1; i <= 3; i++) s += imp(8 + i * 15, i === k ? 28 * n : 12, i === k ? 'a' : 'f'); return s; },
    xy: (n, v, p) => { const isX = /x|right/i.test(p?.label || ''); const pos = (n - .5) * 44; const sx = 32 + (isX ? pos : 0), sy = 24 - (isX ? 0 : pos * .45); return L(6, 24, 58, 24, 'f', 'stroke-dasharray="1 2"') + L(32, 4, 32, 44, 'f', 'stroke-dasharray="1 2"') + P('M28 40L32 32L36 40Z', 'f') + C(sx, sy, 3.2, 'af') + C(sx, sy, 7, 'a'); },
    grain: (n) => G() + P(bell(32, lerp(6, 56, n), 26)) + L(32 - lerp(6, 56, n) / 2, 44, 32 + lerp(6, 56, n) / 2, 44, 'a'),
    xfade: (n) => { const o = lerp(2, 24, n); return G() + P(bell(22, 28, 26), 'f') + P(bell(22 + 28 - o, 28, 26)) + L(22 + 14 - o, 44, 22 + 14, 44, 'a'); },
    flip: (n) => { const w = lerp(8, 26, n); let s = G(); for (let i = 0; i < 3; i++) { const x = 6 + i * (w + 3); if (x + w > 60) break; s += P(bell(x + w / 2, w, 24, B, i % 2 ? .85 : .15), i % 2 ? 'a' : 'f'); } return s + arrow(6 + w + 3 + w, 8, 6 + w + 3, 8); },
    lfoShape: (n) => { const k = Math.round(n * 3); const fn = [Math.sin, (x) => 2 / Math.PI * Math.asin(Math.sin(x)), (x) => ((x / Math.PI) % 2) - 1, (x) => Math.sign(Math.sin(x))][k]; return wave(4, 60, 24, 12, 2, 'a', 0, fn); },
    phase: (n) => wave(4, 60, 24, 12, 1.5, 'f') + wave(4, 60, 24, 12, 1.5, 'a', n),
    twoHeads: (n) => G() + imp(8, 28, 'f') + imp(30, 20) + (n > .5 ? imp(48, 20) : imp(48, 20, 'f')) + T(60, 9, n > .5 ? '2' : '1', 'ta', 'end'),
    fbInvert: (n) => { let s = L(4, 24, 60, 24, 'f'); for (let i = 0; i < 6; i++) { const h = 18 * Math.pow(.7, i) * (n > .5 && i % 2 ? -1 : 1); s += L(8 + i * 10, 24, 8 + i * 10, 24 - h, i ? 'a' : 'f'); } return s; },
    generic: (n) => { const a0 = Math.PI * .75, a = a0 + n * Math.PI * 1.5, r = 15; return P(`M${N(32 + r * Math.cos(a0))} ${N(26 + r * Math.sin(a0))}A${r} ${r} 0 1 1 ${N(32 + r * Math.cos(a0 + Math.PI * 1.5))} ${N(26 + r * Math.sin(a0 + Math.PI * 1.5))}`, 'f') + P(`M${N(32 + r * Math.cos(a0))} ${N(26 + r * Math.sin(a0))}A${r} ${r} 0 ${n > 2 / 3 ? 1 : 0} 1 ${N(32 + r * Math.cos(a))} ${N(26 + r * Math.sin(a))}`) + L(32, 26, 32 + r * Math.cos(a), 26 + r * Math.sin(a), 'a'); },
  };

  /// Which picture a control gets, read from its key, label and unit, most
  /// specific first. A miss falls back to `generic`, flagged in the mock-up.
  const RULES = [
    [/smooth|speed ch/i, 'smooth'], [/bright/i, 'lowpass'], [/\batt\./i, 'taplevel'], [/\b[xy] \((right|ahead)/i, 'xy'], [/x-?fade/i, 'xfade'], [/grain size/i, 'grain'], [/compression/i, 'ratio'], [/balance/i, 'pan'],
    [/freeze/i, 'freeze'], [/^swap$/i, 'swap'], [/link/i, 'link'],
    [/tap ?slope/i, 'tapSlope'], [/^shape$/i, 'shape'], [/bass ?rt/i, 'bassRt'], [/xov|cross/i, 'xover'],
    [/spin/i, 'spin'], [/wander/i, 'wander'], [/pre ?delay|predelay/i, 'predelay'], [/diffus/i, 'diffusion'],
    [/hi ?cut|roll ?off|damp|hfdamp|low ?pass|lp(f)?\b|tone/i, 'lowpass'], [/lo ?cut|high ?pass|hp(f)?\b/i, 'highpass'],
    [/reverb ?time|decay|\brt\b|rt60|tail/i, 'tail'], [/size|room/i, 'size'],
    [/f(ee)?d?b(ac)?k|regen|recirc|\bfb\b|eko ?fb/i, 'feedback'], [/taps?$|voices|stages|order|count|poles|layers/i, 'count'],
    [/\bmix\b|wet|dry|blend|balance|dry\/wet/i, 'mix'], [/threshold|thresh/i, 'threshold'], [/ratio/i, 'ratio'],
    [/attack/i, 'attack'], [/release|recovery/i, 'release'], [/knee/i, 'knee'], [/gate|floor/i, 'gate'],
    [/\bcp ?\d|cheb/i, 'harmonic'], [/bits?\b|bit ?depth|^depth$/i, 'bits'], [/sample ?rate|downsamp|decim|srate|averag/i, 'srate'],
    [/drive|satur|distort|fold/i, 'drive'], [/pitch|shift|semi|transpose|detune|cents|harmon/i, 'pitch'],
    [/polarity|invert|flip/i, 'polarity'], [/\bpan\b|position|azim|angle/i, 'pan'], [/width|stereo|spread|separ/i, 'width'],
    [/rate|speed|lfo|freq ?mod|tempo|bpm/i, 'rate'], [/depth|amount|intens|mod\b|sweep|swing|excurs/i, 'depth'],
    [/delay|dly|time|length|ms\b/i, 'delay'], [/freq|cutoff|centre|center|\bhz\b|band|f0|fc/i, 'freq'],
    [/\bq\b|reso|bandwidth|\bbw\b|slope|width/i, 'q'], [/gain|level|\bdb\b|makeup|output|input|trim|volume|amp/i, 'level'],
    [/seed|random|chaos|jitter|noise/i, 'scatter'],
  ];
  function picFor(p) {
    const LBL = [[/two heads/i, 'twoHeads'], [/feedback ?[−-]/i, 'fbInvert'], [/^lfo ?(speed|freq|rate)/i, 'rate'], [/^lfo ?depth/i, 'depth'], [/^lfo ?shape/i, 'lfoShape'], [/^lfo ?phase/i, 'phase'], [/^pitch$/i, 'pitch'],
      [/flip length/i, 'flip'], [/overlap/i, 'xfade'], [/g(rain)? ?reversal/i, 'flip'], [/start vari|oct vari|time vari/i, 'scatter'], [/^density$/i, 'diffusion'],
      [/^response$|^window$/i, 'grain'], [/^bands$/i, 'count'], [/^shape$/i, 'shape'], [/^spread$/i, 'spread'], [/^depth$/i, 'bits'], [/^averaging$/i, 'smooth']];
    for (const [re, k] of LBL) if (re.test(p.label || '')) { if (k === 'bits' && !/decim|bit/i.test(p.key + (p.unit || '')) && p.max !== 32 && p.max !== 24) break; return k; }
    if (/^(root|m2|m3|m6|m7|4th|5th|octave|just)$/i.test(p.label)) return 'interval';
    const s = `${p.key} ${p.label}`, u = p.unit || '';
    for (const [re, k] of RULES) if (re.test(s)) {
      if (k === 'rate' && u === 'Hz' && p.max > 200) return 'freq';
      if (k === 'delay' && u === 's') return 'tail';
      return k;
    }
    if (u === 'ms') return 'delay';
    if (u === 'dB') return 'level';
    if (u === 'Hz') return p.max > 200 ? 'freq' : 'rate';
    if (u === '%') return 'depth';
    if (u === 'st' || u === 'ct') return 'pitch';
    if (u === 'm') return 'size';
    if (u === 's') return 'tail';
    if (u === 'bits') return 'bits';
    if (u === '°') return 'pan';
    return 'generic';
  }
  const norm = (p, v) => p.log && p.min > 0 ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / ((p.max - p.min) || 1);
  const unnorm = (p, n) => p.log && p.min > 0 ? p.min * Math.pow(p.max / p.min, n) : p.min + (p.max - p.min) * n;
  function fmt(p, v) {
    const u = p.unit || '', a = Math.abs(v);
    let s = p.step >= 1 ? String(Math.round(v)) : a >= 1000 ? (v / 1000).toFixed(2) + 'k' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
    return u === ':1' ? s + ':1' : u ? `${s} ${u}` : s;
  }


  // The display at the head of each built-in effect: what the effect does to
  // the sound, drawn from every one of its settings, 400 × 110.
  const HW = 400, HH = 70;
  const hx = (t) => 10 + t * (HW - 20), hy = (a) => HH - 14 - a * (HH - 28);
  const hgrid = () => [1, 2, 3].map((i) => `<line x1="10" x2="${HW - 10}" y1="${hy(i / 4)}" y2="${hy(i / 4)}" class="hg"/>`).join('');
  const hpath = (pts, cls = 'hc') => `<path d="${pts.map(([x, y], i) => (i ? 'L' : 'M') + N(x) + ' ' + N(y)).join('')}" class="${cls}"/>`;
  const hcurve = (fn, fill = true) => { const pts = []; for (let i = 0; i <= 160; i++) { const t = i / 160; pts.push([hx(t), hy(cl(fn(t)))]); } return (fill ? `<path d="${pts.map(([x, y], i) => (i ? 'L' : 'M') + N(x) + ' ' + N(y)).join('')}L${hx(1)} ${hy(0)}L${hx(0)} ${hy(0)}Z" class="hf"/>` : '') + hpath(pts); };
  const ht = (x, y, s, a = 'start', c = 'ht') => `<text x="${N(x)}" y="${N(y)}" class="${c}" text-anchor="${a}">${s}</text>`;
  const hfreqAxis = () => ['20', '100', '1k', '10k'].map((l, i) => ht(hx(i / 3) + 2, HH - 2, l)).join('');
  const flog = (hz) => cl(Math.log(Math.max(20, hz) / 20) / Math.log(1000));
  const himp = (t, a, cls = 'hc') => `<line x1="${N(hx(t))}" x2="${N(hx(t))}" y1="${hy(0)}" y2="${N(hy(a))}" class="${cls}"/>`;
  const hsig = (fn, n = 400, cls = 'hc') => { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([hx(t), HH / 2 - 38 * cl(fn(t), -1, 1)]); } return hpath(pts, cls); };
  const src = (t) => Math.sin(t * 2 * Math.PI * 9) * (.35 + .55 * Math.exp(-((t * 3) % 1) * 4));
  const bit = (v) => (v > .5);

  /// A modulated delay line: the delay time across the screen, swinging with
  /// its LFO, and the feedback's echoes laid under it.
  function heroModDelay(v, name) {
    const d = v.delayMs ?? v.delay ?? 5, dep = v.depthMs ?? v.depth ?? 2, r = v.rateHz ?? v.rate ?? .5, fb = v.feedback ?? 0;
    const span = 40, base = cl(d / span), sw = cl(dep / span);
    let s = hgrid() + ht(12, 12, `${name} · delay ${d.toFixed(1)} ms ± ${dep.toFixed(1)}`) + ht(HW - 12, 12, `${r.toFixed(2)} Hz`, 'end');
    s += `<rect x="10" y="${hy(base + sw)}" width="${HW - 20}" height="${N(hy(base - sw) - hy(base + sw))}" class="hband"/>`;
    s += hcurve((t) => base + sw * Math.sin(t * 2 * Math.PI * cl(r, .05, 8) * 2), false);
    s += hcurve((t) => base + sw * Math.sin(t * 2 * Math.PI * cl(r, .05, 8) * 2 + (v.stereo ?? .25) * 2 * Math.PI), false).replace('class="hc"', 'class="hd"');
    for (let k = 1; k < 6; k++) s += himp(.05 + k * .03, .25 * Math.pow(Math.abs(fb), k), 'hd');
    return s + ht(12, HH - 2, 'L solid · R dashed');
  }
  /// A reverb's impulse: the predelay, then a decay whose length is the decay
  /// setting, dense where diffusion is high, and endless when frozen.
  function heroReverb(v, name) {
    const dec = v.decay ?? .7, pd = (v.predelayMs ?? 0) / 500, dif = v.diffusion ?? .6, size = v.size ?? .5, frz = bit(v.freeze ?? 0);
    const air = v.damping ?? 0;
    const len = frz ? 2 : lerp(.08, .95, dec), x0 = .02 + cl(pd) * .3;
    let s = hgrid() + himp(.02, .95);
    s += `<line x1="${hx(.02)}" x2="${hx(x0)}" y1="${hy(.98)}" y2="${hy(.98)}" class="hd"/>` + ht(hx(.02) + 3, 12, 'predelay');
    const k = Math.round(lerp(14, 140, dif) * lerp(1.4, .7, size));
    for (let i = 0; i < k; i++) { const t = i / k, x = x0 + t * Math.min(len, 1 - x0); if (x > .99) break; s += himp(x, (frz ? .7 : .85 * Math.exp(-3 * t / Math.min(1, len) * .9)) * (.6 + .4 * rnd(i, 3)) * (1 - air * t * .6), 'hc thin'); }
    return s + ht(HW - 12, 12, frz ? 'FROZEN · ∞' : `decay ${dec.toFixed(2)}`, 'end') + ht(HW - 12, HH - 2, `size ${size.toFixed(2)} · diffusion ${dif.toFixed(2)}`, 'end');
  }
  function heroNoise(v, kind) {
    const clk = v.clockHz ?? 8000, lvl = v.level ?? .5;
    const top = flog(clk / 2);
    let s = hgrid() + hfreqAxis();
    if (kind === 'pn_noise_eq') s += hcurve((t) => lvl * (.9 - .5 * t) * (t < top ? 1 : Math.exp(-(t - top) * 20)));
    else if (kind === 'single_bit_pn') s += hcurve((t) => lvl * (t < top ? .8 * Math.abs(Math.sin(t * 40)) ** .3 : .05));
    else s += hcurve((t) => lvl * (t < top ? .8 : Math.exp(-(t - top) * 20) * .8));
    s += `<line x1="${hx(top)}" x2="${hx(top)}" y1="${hy(0)}" y2="${hy(1)}" class="hd"/>` + ht(hx(top) + 3, 14, `clock ${fmtHz(clk)} → content to ${fmtHz(clk / 2)}`);
    return s;
  }
  const fmtHz = (hz) => (hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : Math.round(hz)) + ' Hz';
  function heroFilterSet(v, bands) {
    // bands: [{on, f, q, a, type}]
    let s = hgrid() + hfreqAxis();
    const resp = (t) => { let g = 0, any = false; for (const b of bands) { if (!b.on) continue; any = true; const x = flog(b.f), w = lerp(.25, .02, cl(b.q / 10)); const d = t - x;
      g += b.a * (b.type === 'low' ? (d < 0 ? 1 : Math.exp(-d / w)) : b.type === 'high' ? (d > 0 ? 1 : Math.exp(d / w)) : b.type === 'notch' ? 1 - Math.exp(-(d * d) / (w * w * .4)) : Math.exp(-(d * d) / (w * w))); }
      return any ? cl(g * .7) : .02; };
    s += hcurve(resp);
    for (const b of bands) if (b.on) s += `<circle cx="${hx(flog(b.f))}" cy="${hy(cl(resp(flog(b.f))))}" r="4" class="hdot"/>` + ht(hx(flog(b.f)), hy(cl(resp(flog(b.f)))) - 8, b.name, 'middle');
    return s;
  }
  const HERO = {
    ring: (v) => { const f = v.hz ?? 440, mix = v.mix ?? 1, src0 = 1000; let s = hgrid() + hfreqAxis();
      s += himp(flog(src0), .7 * (1 - mix * .9), 'hd') + ht(hx(flog(src0)), hy(.75) - 4, 'input', 'middle');
      s += himp(flog(src0 + f), .7 * mix) + himp(flog(Math.abs(src0 - f) || 20), .7 * mix) + ht(hx(flog(src0 + f)), hy(.75) - 16, 'sum', 'middle') + ht(hx(flog(Math.abs(src0 - f) || 20)), hy(.75) + 8, 'difference', 'end');
      return s + ht(HW - 12, 12, `carrier ${fmtHz(f)}${(v.sweep ?? 0) ? ' · sweeping' : ''}`, 'end'); },
    rappify: (v) => { const c = v.hz ?? 1200, a = v.amount ?? .5, sp = v.speed ?? 2; let s = hgrid() + hfreqAxis();
      for (let k = -2; k <= 2; k++) { const x = flog(c) + k * .06 * a; s += hcurve((t) => .1 + .75 * Math.exp(-Math.pow((t - x) * 14, 2)), false).replace('class="hc"', `class="${k ? 'hd' : 'hc'}"`); }
      return s + ht(12, 12, `band at ${fmtHz(c)}, wobbling ${sp.toFixed(1)}× a second`); },
    boomerang: (v) => { const th = (v.throwMs ?? 300) / 2000, mix = v.mix ?? .5; return hgrid() + hsig((t) => src(t) * (1 - mix * .5), 300, 'hd') + hsig((t) => (t > th ? src(1 - (t - th)) * mix : 0)) + `<line x1="${hx(0)}" x2="${hx(th)}" y1="14" y2="14" class="hc"/>` + ht(hx(th) + 4, 17, `thrown back ${(th * 2000).toFixed(0)} ms, reversed`); },
    maximizer: (v) => { const amt = v.amount ?? .5, ceil = Math.pow(10, (v.ceilingDb ?? -1) / 20), g = 1 + amt * 3; let s = hsig((t) => src(t), 300, 'hd') + hsig((t) => Math.tanh(src(t) * g / ceil) * ceil);
      return s + `<line x1="10" x2="${HW - 10}" y1="${HH / 2 - 38 * ceil}" y2="${HH / 2 - 38 * ceil}" class="hr"/>` + ht(HW - 12, HH / 2 - 38 * ceil - 3, `ceiling ${(v.ceilingDb ?? -1).toFixed(1)} dB`, 'end') + ht(12, 12, `+${(20 * Math.log10(g)).toFixed(1)} dB pushed in`); },
    chamberlin: (v) => heroFilterSet(v, ['low', 'band', 'high', 'notch'].map((t) => ({ name: t, type: t, on: bit(v[t + 'On'] ?? 0), f: v[t + 'Freq'] ?? 1000, q: v[t + 'Q'] ?? 1, a: v[t + 'Amp'] ?? 1 }))),
    dattorro_filter_bank: (v) => heroFilterSet(v, [['notch', 'notch'], ['resonator', 'band'], ['regalia', 'band'], ['damping', 'low']].map(([k, t]) => ({ name: k, type: t, on: bit(v[k + 'On'] ?? 0), f: v[k + 'Hz'] ?? 1000, q: v[k + 'Q'] ?? 1, a: v[k + 'Amp'] ?? 1 }))),
    white_chorus: (v) => heroModDelay(v, 'chorus'), dattorro_flanger: (v) => heroModDelay(v, 'flanger'), dattorro_vibrato: (v) => heroModDelay(v, 'vibrato'),
    pn_noise: (v) => heroNoise(v, 'pn_noise'), pn_noise_eq: (v) => heroNoise(v, 'pn_noise_eq'), single_bit_pn: (v) => heroNoise(v, 'single_bit_pn'),
    dattorro_plate: (v) => heroReverb({ ...v, size: .6 }, 'plate'), schroeder_reverb: (v) => heroReverb(v, 'schroeder'), moorer_reverb: (v) => heroReverb(v, 'moorer'),
    allpass_diffuser: (v) => { const d = (v.delayMs ?? 10) / 100, c = v.coefficient ?? .5; let s = hgrid() + himp(.03, .9, 'hd'); for (let i = 1; i < 30; i++) { const x = .03 + i * d * .5; if (x > .98) break; s += himp(x, .85 * Math.pow(Math.abs(c), i * .6) * (i % 2 ? 1 : .7)); } return s + ht(HW - 12, 12, `one click, smeared · coefficient ${c.toFixed(2)}`, 'end'); },
    leslie: (v) => { const r = v.rateHz ?? 6, w = v.width ?? 1; const cx = HW / 2, cy = HH / 2; let s = `<circle cx="${cx}" cy="${cy}" r="40" class="hd" fill="none"/>`;
      for (let i = 0; i < 2; i++) { const a = i * Math.PI + r * .4; s += `<line x1="${cx}" y1="${cy}" x2="${N(cx + 38 * Math.cos(a))}" y2="${N(cy + 38 * Math.sin(a))}" class="hc"/><circle cx="${N(cx + 38 * Math.cos(a))}" cy="${N(cy + 38 * Math.sin(a))}" r="6" class="hdot"/>`; }
      s += `<circle cx="${cx - 110 * w}" cy="${cy}" r="5" class="hdot"/><circle cx="${cx + 110 * w}" cy="${cy}" r="5" class="hdot"/>` + ht(cx - 110 * w, cy + 20, 'L mic', 'middle') + ht(cx + 110 * w, cy + 20, 'R mic', 'middle');
      return s + ht(12, 12, `horn spinning ${r.toFixed(1)} times a second`) + ht(HW - 12, 12, `doppler ${(v.depthMs ?? 0).toFixed(2)} ms`, 'end'); },
    harmonizer: (v) => { const st = v.semitones ?? 7; return hgrid() + hsig((t) => Math.sin(t * 2 * Math.PI * 6) * .8, 300, 'hd') + hsig((t) => Math.sin(t * 2 * Math.PI * 6 * Math.pow(2, st / 12)) * .8 * (v.wet ?? .5) * 1.6) + ht(12, 12, `${st >= 0 ? '+' : ''}${st.toFixed(1)} semitones · window ${(v.windowMs ?? 50).toFixed(0)} ms`); },
    detune: (v) => { const ct = v.cents ?? 10; return hgrid() + hsig((t) => (Math.sin(t * 2 * Math.PI * 12) + Math.sin(t * 2 * Math.PI * 12 * Math.pow(2, ct / 1200 * 30))) * .45) + hsig((t) => Math.cos(t * Math.PI * ct / 1200 * 30 * 12) * .9, 200, 'hd') + ht(12, 12, `two copies ${ct.toFixed(0)} cents apart, beating`); },
    doubler: (v) => { const d = (v.delayMs ?? 20) / 100, va = (v.variationMs ?? 5) / 100; return hgrid() + hsig(src, 300, 'hd') + hsig((t) => src(t - d - va * Math.sin(t * 8)) * (v.wet ?? .5) * 1.6) + `<rect x="${hx(d - va)}" y="8" width="${N(hx(d + va) - hx(d - va))}" height="10" class="hband"/>` + ht(hx(d + va) + 4, 16, `second take ${(d * 100).toFixed(0)} ± ${(va * 100).toFixed(0)} ms late`); },
    doppler: (v) => { const dist = (v.distanceMs ?? 20) / 100, vel = v.velocityMps ?? 20; let s = `<line x1="10" x2="${HW - 10}" y1="30" y2="30" class="hd"/>` + `<circle cx="${HW / 2}" cy="${N(30 + 60 * cl(dist))}" r="6" class="hdot"/>` + ht(HW / 2 + 10, N(34 + 60 * cl(dist)), 'you');
      s += hcurve((t) => .55 + .35 * Math.atan((.5 - t) * vel / 10 / Math.max(.05, dist)) / (Math.PI / 2), false); return s + ht(12, 12, `passing at ${vel.toFixed(0)} m/s — pitch falls as it goes by`); },
    utility: (v) => { const g = v.gainDb ?? 0, w = v.width ?? 1, inv = bit(v.invert ?? 0), sw = bit(v.swap ?? 0); const cx = HW / 2; let s = `<path d="M${cx - 90} ${HH - 14}A90 90 0 0 1 ${cx + 90} ${HH - 14}" class="hd" fill="none"/>`;
      const d = 80 * cl(w / 2); for (const [k, sg] of [['L', -1], ['R', 1]]) { const x = cx + sg * d * (sw ? -1 : 1); s += `<circle cx="${N(x)}" cy="${N(HH - 14 - Math.sqrt(Math.max(0, 8100 - (x - cx) ** 2)))}" r="7" class="hdot"/>` + ht(x, HH - 14 - Math.sqrt(Math.max(0, 8100 - (x - cx) ** 2)) + 3, k, 'middle', 'htd'); }
      return s + ht(12, 12, `${g >= 0 ? '+' : ''}${g.toFixed(1)} dB`) + ht(HW - 12, 12, `${inv ? 'polarity flipped · ' : ''}${sw ? 'L↔R swapped · ' : ''}width ${w.toFixed(2)}×`, 'end'); },
    phaser: (v) => { const n = Math.round(v.notches ?? 4), c = v.centreHz ?? 1000, sp = v.spread ?? 1, dep = v.depth ?? 1, wid = v.resonance ?? .5, sweep = v.sweep ?? 1; let s = hgrid() + hfreqAxis();
      s += `<rect x="${hx(flog(c) - sweep * .05)}" y="${hy(1)}" width="${N(hx(flog(c) + sweep * .05) - hx(flog(c) - sweep * .05))}" height="${N(hy(0) - hy(1))}" class="hband"/>`;
      s += hcurve((t) => { let g = .8; for (let i = 0; i < n; i++) { const x = flog(c) + (i - (n - 1) / 2) * .08 * sp; g -= dep * .75 * Math.exp(-Math.pow((t - x) / (.008 + .03 * wid), 2)); } return g; });
      return s + ht(12, 12, `${n} notches around ${fmtHz(c)}, sweeping ${sweep.toFixed(1)} oct at ${(v.rateHz ?? .5).toFixed(2)} Hz`); },
    'prism:echo': (v) => { const d = (v.delayMs ?? 300) / 2000, fb = v.feedback ?? .4; let s = hgrid() + himp(.02, .9, 'hd'); for (let k = 1; k < 12; k++) { const x = .02 + k * d; if (x > .99) break; s += himp(x, .85 * Math.pow(Math.abs(fb), k - 1) * (v.wet ?? .5) * 1.4); } return s + ht(12, 12, `echo every ${(d * 2000).toFixed(0)} ms, each ${(Math.abs(fb) * 100).toFixed(0)}% of the last`); },
  };

  const single = (fn) => hgrid() + hfreqAxis() + hcurve(fn);
  Object.assign(HERO, {
    width: (v) => HERO.utility({ width: v.width ?? 1, gainDb: 0 }),
    gain: (v) => { const g = v.db ?? 0, k = Math.pow(10, g / 20); return hsig((t) => src(t), 300, 'hd') + hsig((t) => cl(src(t) * k, -1.2, 1.2)) + ht(12, 12, `${g >= 0 ? '+' : ''}${g.toFixed(1)} dB`); },
    dc: (v) => { const x = flog(v.hz ?? 5); return single((t) => t < x ? .75 * Math.exp(-(x - t) * 18) : .75) + `<line x1="${hx(x)}" x2="${hx(x)}" y1="${hy(0)}" y2="${hy(1)}" class="hd"/>` + ht(hx(x) + 4, 14, `below ${fmtHz(v.hz ?? 5)} removed`); },
    invert: () => hsig((t) => src(t), 300, 'hd') + hsig((t) => -src(t)) + ht(12, 12, 'polarity flipped'),
    swap: () => HERO.utility({ swap: 1, width: 1 }),
    fit: (v) => { const a = v.amount ?? .7; return hsig((t) => src(t) * (.3 + .7 * Math.abs(Math.sin(t * 5))), 300, 'hd') + hsig((t) => src(t) * lerp(.3 + .7 * Math.abs(Math.sin(t * 5)), .8, a)) + ht(12, 12, `loudness evened ${(a * 100).toFixed(0)}% over ${(v.grainMs ?? 30).toFixed(0)} ms grains`); },
    gate: (v) => '',
    notch: (v) => { const x = flog(v.frequency ?? 1000), bw = (v.bandwidth ?? 200) / (v.frequency ?? 1000); return single((t) => .75 - .7 * (v.mix ?? 1) * Math.exp(-Math.pow((t - x) / (.01 + bw * .08), 2))); },
    resonator: (v) => { const x = flog(v.frequency ?? 1000), bw = (v.bandwidth ?? 200) / (v.frequency ?? 1000); return single((t) => .12 + .78 * (v.mix ?? 1) * Math.exp(-Math.pow((t - x) / (.01 + bw * .08), 2))); },
    regalia: (v) => { const x = flog(v.frequency ?? 1000), bw = (v.bandwidth ?? 200) / (v.frequency ?? 1000), g = (v.gainDb ?? 6) / 24; return single((t) => .5 + .45 * g * (v.mix ?? 1) * Math.exp(-Math.pow((t - x) / (.01 + bw * .08), 2))) + `<line x1="10" x2="${HW - 10}" y1="${hy(.5)}" y2="${hy(.5)}" class="hd"/>`; },
    damping: (v) => { const x = flog(v.cutoffHz ?? 6000); return single((t) => t < x ? .75 : .75 * Math.exp(-(t - x) * 6)) + `<line x1="${hx(x)}" x2="${hx(x)}" y1="${hy(0)}" y2="${hy(1)}" class="hd"/>`; },
  });

  /// A knob: the value as the ring, the picture in the cap.
  const noText = (s) => s.replace(/<text[\s\S]*?<\/text>/g, '');
  function ring(u, bipolar, pic) {
    const a0 = Math.PI * .75, span = Math.PI * 1.5, r = 26, c = 30;
    const pt = (a) => `${N(c + r * Math.cos(a))} ${N(c + r * Math.sin(a))}`;
    const arc = (from, to, cls) => to - from < .001 ? '' : `<path d="M${pt(from)}A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${pt(to)}" class="${cls}"/>`;
    const a = a0 + u * span, mid = a0 + span / 2;
    return arc(a0, a0 + span, 'fxk-track') + (bipolar ? arc(Math.min(mid, a), Math.max(mid, a), 'fxk-arc') : arc(a0, a, 'fxk-arc'))
      + `<circle cx="${N(c + r * Math.cos(a))}" cy="${N(c + r * Math.sin(a))}" r="3.4" class="fxk-tip"/><circle cx="${c}" cy="${c}" r="20" class="fxk-cap"/>`
      + `<svg x="12" y="17" width="36" height="27" viewBox="0 0 64 48" class="pic" overflow="visible">${noText(pic)}</svg>`;
  }
  /// A display: the 400 × 70 drawing, scaled to the module.
  const display = (inner, fill = false) => `<svg class="fx-disp" viewBox="0 0 ${HW} ${HH}" ${fill ? 'preserveAspectRatio="none" ' : ''}aria-hidden="true">${inner}</svg>`;
  /// The pad's crosshair over a display, and what its two axes are.
  const padMark = (u, w, xl, yl) => {
    const X = 10 + u * (HW - 20), Y = HH - 6 - w * (HH - 12);
    return `<line x1="${N(X)}" x2="${N(X)}" y1="0" y2="${HH}" class="fx-pad-l"/><line y1="${N(Y)}" y2="${N(Y)}" x1="0" x2="${HW}" class="fx-pad-l"/><circle cx="${N(X)}" cy="${N(Y)}" r="5" class="fx-pad-dot"/>`
      + `<text x="${HW - 6}" y="${HH - 3}" class="ht fx-pad-ax" text-anchor="end">${xl} →</text>`;
  };
  /// RBJ cookbook magnitude in dB, for one EQ band — the filters the engine
  /// runs (`fx::eq`). Type: 0 HP, 1 LS, 2 bell, 3 notch, 4 HS, 5 LP.
  function rbjDb(type, f0, q, g, f, fs = 48000) {
    const w0 = 2 * Math.PI * Math.min(f0, fs * .49) / fs, cw = Math.cos(w0), sw = Math.sin(w0), A = Math.pow(10, g / 40), al = sw / (2 * Math.max(.05, q));
    let b0, b1, b2, a0, a1, a2;
    if (type === 0) { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 5) { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 2) { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    else if (type === 3) { b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else {
      const s2 = 2 * Math.sqrt(A) * al, lo = type === 1 ? 1 : -1;
      b0 = A * ((A + 1) - lo * (A - 1) * cw + s2); b1 = 2 * lo * A * ((A - 1) - lo * (A + 1) * cw); b2 = A * ((A + 1) - lo * (A - 1) * cw - s2);
      a0 = (A + 1) + lo * (A - 1) * cw + s2; a1 = -2 * lo * ((A - 1) + lo * (A + 1) * cw); a2 = (A + 1) + lo * (A - 1) * cw - s2;
    }
    const w = 2 * Math.PI * Math.min(f, fs * .49) / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-12);
  }
  /// Which display an effect draws, by kind: the shaper's name, and its prism twin's.
  const HERO_ALIAS = { flanger: 'dattorro_flanger', vibrato: 'dattorro_vibrato', echo: 'prism:echo', dattorro_notch: 'notch',
    dattorro_resonator: 'resonator', regalia_mitra: 'regalia', damping_filter: 'damping', all_pass_diffuser: 'allpass_diffuser' };
  const heroFor = (kind) => { const k = kind.replace(/^prism:/, '').replace(/-/g, '_'); return HERO_ALIAS[k] || k; };
  return { PIC, picFor, svg, noText, ring, display, padMark, rbjDb, HERO, heroFor, HW, HH };
})();

// ───────────────────────────────────────────────────────── which, and how wide

/// Every module in the rack is this wide, so the rail stacks them in clean
/// columns down and across (`.fx-module-rail` wraps by column).
const FX_FACE_W = 348;

/// An effect that is MultiGrainLive's own gets a face: the three original
/// modules, every shaper, and the prism effects whose source is this program.
/// Hyperprism, SoundHack and Lexicon keep the panels drawn from their originals
/// (`renderPrismControls`), with a picture added to each control.
function fxIsBuiltin(kind) {
  if (kind === 'eq' || kind === 'comp' || kind === 'gain') return true;
  const s = state.shapers[kind];
  if (!s) return false;
  if (!kind.startsWith('prism:')) return true;
  return /^MultiGrainLive/.test(s.source || '');
}

/// Each effect in its family's colour: the knob rings, the display, the
/// pictures and the module's top edge.
function fxFamilyColour(kind) {
  if (kind === 'eq') return '#ff8a3d';
  if (kind === 'comp') return '#ffb547';
  if (/^(prism:)?(gain|utility|width|dc|invert|swap|fit)$/.test(kind)) return '#c9d3dd';
  if (/pn[_-]noise|single[_-]bit/.test(kind)) return '#7bd88f';
  const cat = state.shapers[kind]?.category || state.shapers[fxTwin(kind)]?.category;
  return { dynamics: '#ffb547', filter: '#ff8a3d', delay: '#19b4ff', modulation: '#b07cff', reverb: '#2fd4c2',
    pitch: '#ff5fa2', granular: '#ff5fa2', spectral: '#7bd88f' }[cat]
    || (/reverb|plate|diffuser/.test(kind) ? '#2fd4c2' : /chorus|flanger|vibrato|leslie|phaser|ring/.test(kind) ? '#b07cff'
      : /harmon|detune|doubler|doppler|boomerang/.test(kind) ? '#ff5fa2' : /notch|resonator|regalia|chamberlin|filter|damping|rappify/.test(kind) ? '#ff8a3d'
        : /gate|maxim/.test(kind) ? '#ffb547' : '#19b4ff');
}

/// The prism effect a shaper is the twin of: the same controls, with the
/// panel layout and Prism pad the shaper does not carry.
function fxTwin(kind) {
  return { eq: 'prism:eq', comp: 'prism:compressor', gain: 'prism:gain', dattorro_flanger: 'prism:flanger',
    dattorro_vibrato: 'prism:vibrato', regalia_mitra: 'prism:regalia' }[kind] || 'prism:' + kind.replace(/_/g, '-');
}

function fxPanelOf(kind, keys) {
  const own = state.shapers[kind]?.panel;
  const twin = state.shapers[fxTwin(kind)]?.panel;
  for (const panel of [own, twin]) {
    if (!panel) continue;
    // A twin's layout only if every key it names is one this slot has.
    const named = (panel.groups || []).flatMap((g) => g.keys);
    if (!named.length || named.every((k) => keys.has(k))) return panel;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── the model

/// What a face reads and writes: one shape for the shapers' `params`, the
/// compressor's fields on the slot, and the gain's `db`, so every control
/// below is written once.
function fxModel(slot) {
  let specs, get, put;
  if (slot.kind === 'comp') {
    specs = (state.shapers['prism:compressor']?.params || [
      { key: 'thresholdDb', label: 'Threshold', min: -60, max: 0, default: -18, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, unit: ':1' },
      { key: 'attackMs', label: 'Attack', min: .05, max: 500, default: 10, unit: 'ms', log: true },
      { key: 'releaseMs', label: 'Release', min: 5, max: 3000, default: 120, unit: 'ms', log: true },
      { key: 'kneeDb', label: 'Knee', min: 0, max: 24, default: 6, unit: 'dB' },
      { key: 'makeupDb', label: 'Makeup', min: -24, max: 24, default: 0, unit: 'dB' },
    ]);
    get = (k) => slot[k]; put = (k, v) => { slot[k] = v; };
  } else if (slot.kind === 'gain') {
    specs = [{ key: 'db', label: 'Level', min: -24, max: 24, default: 0, unit: 'dB' }];
    get = () => slot.db; put = (k, v) => { slot.db = v; };
  } else {
    slot.params = slot.params || {};
    specs = state.shapers[slot.kind]?.params || [];
    for (const p of specs) if (slot.params[p.key] === undefined) slot.params[p.key] = p.default;
    get = (k) => slot.params[k]; put = (k, v) => { slot.params[k] = v; };
  }
  const byKey = Object.fromEntries(specs.map((p) => [p.key, p]));
  return {
    slot, specs, byKey, get,
    // Moved on the effect that is already running, and kept for the release.
    set(k, v) { put(k, v); liveParam(slot.id, k, v); },
    commit() { commitRack(); },
    values() { return Object.fromEntries(specs.map((p) => [p.key, get(p.key)])); },
  };
}

const fxIsSwitch = (p) => !!p.toggle || (p.min === 0 && p.max === 1 && p.step === 1)
  || /On$|enabled$/.test(p.key) || ['invert', 'swap', 'freeze', 'ampFit', 'autoLevel', 'autoComp', 'allpass'].includes(p.key);
const fxIsLog = (p) => !!p.log || (p.unit === 'Hz' && p.max / Math.max(p.min, 1e-9) > 50) || (p.unit === 'ms' && p.min > 0 && p.max / p.min > 50);

/// A knob's own range: the Advanced page's, or the effect's.
function fxRange(m, p) {
  return state.rack?.ranges?.[m.slot.id]?.[p.key] || { min: p.min, max: p.max, log: fxIsLog(p) };
}
const fxUnit = (r, v) => Math.max(0, Math.min(1, r.log && r.min > 0 ? Math.log(v / r.min) / Math.log(r.max / r.min) : (v - r.min) / ((r.max - r.min) || 1)));
const fxFromUnit = (r, u) => r.log && r.min > 0 ? r.min * Math.pow(r.max / r.min, u) : r.min + (r.max - r.min) * u;
/// Whatever the knob's range says, the effect's own limits hold.
const fxClamp = (p, v) => { const c = Math.max(p.min, Math.min(p.max, v)); return p.step === 1 ? Math.round(c) : c; };
const fxFormat = (p, v) => p.choices ? (p.choices[Math.round(v - p.min)] ?? String(Math.round(v)))
  : p.unit === ':1' ? `${v.toFixed(1)}:1` : p.step === 1 && !p.unit ? String(Math.round(v)) : fxValueFormat(p, v);

/// A label without its section's name: under LOW, "Low frequency" is "Frequency".
const FX_SHORT = { amplitude: 'Level', 'air absorption': 'Air', 'stereo spread': 'Spread', 'stereo phase': 'Phase',
  'all-pass interp': 'Interp', 'speed of sound': 'Sound speed', 'auto compression': 'Auto comp', 'stereo width': 'Width' };
function fxShort(label, group) {
  let l = label;
  const g = (group || '').toLowerCase().replace(/s$/, '').split(/[\s-]/)[0];
  if (g && l.toLowerCase().startsWith(g + ' ')) l = l.slice(g.length + 1);
  l = FX_SHORT[l.toLowerCase()] || l;
  return l.charAt(0).toUpperCase() + l.slice(1);
}

// ────────────────────────────────────────────────────────────── the controls

/// A knob: the ring is the value, the cap is the picture of what the value
/// does, the reading and the name under it. Drag up or down (Shift for fine),
/// double-click for its default, arrows to nudge.
function fxKnob(m, p, onMove = () => {}, label = p.label) {
  const el = document.createElement('div');
  el.className = 'fxk';
  el.innerHTML = '<svg class="fxk-ring" viewBox="0 0 60 60" role="slider" tabindex="0"></svg><span class="fxk-v"></span><span class="fxk-l"></span>';
  el.querySelector('.fxk-l').textContent = label;
  el.title = `${p.label} — drag up or down, double-click to reset`;
  const ring = el.querySelector('.fxk-ring');
  ring.setAttribute('aria-label', p.label);
  const pk = FXP.picFor(p);
  const paint = () => {
    const v = m.get(p.key), r = fxRange(m, p), u = fxUnit(r, v);
    ring.innerHTML = FXP.ring(u, r.min < 0 && r.max > 0, FXP.PIC[pk](u, v, p));
    ring.setAttribute('aria-valuetext', fxFormat(p, v));
    el.querySelector('.fxk-v').textContent = fxFormat(p, v);
  };
  const to = (u) => { m.set(p.key, fxClamp(p, fxFromUnit(fxRange(m, p), Math.max(0, Math.min(1, u))))); paint(); onMove(); };
  let y0 = 0, u0 = 0;
  ring.addEventListener('pointerdown', (e) => { y0 = e.clientY; u0 = fxUnit(fxRange(m, p), m.get(p.key)); ring.setPointerCapture(e.pointerId); e.preventDefault(); });
  ring.addEventListener('pointermove', (e) => { if (ring.hasPointerCapture(e.pointerId)) to(u0 + (y0 - e.clientY) / (e.shiftKey ? 600 : 160)); });
  ring.addEventListener('pointerup', (e) => { if (ring.hasPointerCapture(e.pointerId)) { ring.releasePointerCapture(e.pointerId); m.commit(); } });
  ring.addEventListener('dblclick', () => { m.set(p.key, p.default ?? p.min); paint(); onMove(); m.commit(); });
  ring.addEventListener('keydown', (e) => {
    const d = { ArrowUp: .01, ArrowRight: .01, ArrowDown: -.01, ArrowLeft: -.01 }[e.key];
    if (!d) return;
    e.preventDefault();
    to(fxUnit(fxRange(m, p), m.get(p.key)) + d * (e.shiftKey ? .2 : 1));
    m.commit();
  });
  el.sync = paint;
  paint();
  return el;
}

/// A level you ride like a desk channel: a short fader.
function fxFader(m, p, onMove = () => {}, label = p.label) {
  const el = document.createElement('div');
  el.className = 'fxf';
  el.innerHTML = '<svg class="fxf-track" viewBox="0 0 24 64" role="slider" tabindex="0"></svg><span class="fxk-v"></span><span class="fxk-l"></span>';
  el.querySelector('.fxk-l').textContent = label;
  el.title = `${p.label} — drag, double-click to reset`;
  const track = el.querySelector('.fxf-track');
  track.setAttribute('aria-label', p.label);
  const paint = () => {
    const v = m.get(p.key), u = fxUnit(fxRange(m, p), v), y = 58 - u * 52;
    track.innerHTML = `<rect x="10" y="4" width="4" height="56" rx="2" class="fxf-bg"/><rect x="10" y="${y.toFixed(1)}" width="4" height="${(60 - y).toFixed(1)}" rx="2" class="fxf-fill"/>`
      + `<rect x="3" y="${(y - 4).toFixed(1)}" width="18" height="8" rx="2" class="fxf-cap"/><line x1="5" x2="19" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="fxf-line"/>`;
    track.setAttribute('aria-valuetext', fxFormat(p, v));
    el.querySelector('.fxk-v').textContent = fxFormat(p, v);
  };
  const at = (e) => { const b = track.getBoundingClientRect(); m.set(p.key, fxClamp(p, fxFromUnit(fxRange(m, p), Math.max(0, Math.min(1, (b.bottom - 4 - e.clientY) / (b.height - 8)))))); paint(); onMove(); };
  track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); at(e); e.preventDefault(); });
  track.addEventListener('pointermove', (e) => { if (track.hasPointerCapture(e.pointerId)) at(e); });
  track.addEventListener('pointerup', (e) => { if (track.hasPointerCapture(e.pointerId)) { track.releasePointerCapture(e.pointerId); m.commit(); } });
  track.addEventListener('dblclick', () => { m.set(p.key, p.default ?? p.min); paint(); onMove(); m.commit(); });
  track.addEventListener('keydown', (e) => {
    const d = { ArrowUp: .02, ArrowDown: -.02 }[e.key];
    if (!d) return;
    e.preventDefault();
    m.set(p.key, fxClamp(p, fxFromUnit(fxRange(m, p), Math.max(0, Math.min(1, fxUnit(fxRange(m, p), m.get(p.key)) + d)))));
    paint(); onMove(); m.commit();
  });
  el.sync = paint;
  paint();
  return el;
}

/// A technical setting, one of a set read and moved together: a slider row.
function fxSlider(m, p, onMove = () => {}, label = p.label) {
  const el = document.createElement('div');
  el.className = 'fxs';
  el.innerHTML = '<span class="fxs-pic"></span><span class="fxs-l"></span><input type="range" min="0" max="1000"><span class="fxs-v"></span>';
  el.querySelector('.fxs-l').textContent = label;
  const input = el.querySelector('input');
  input.setAttribute('aria-label', p.label);
  const pk = FXP.picFor(p);
  const paint = () => {
    const v = m.get(p.key), u = fxUnit(fxRange(m, p), v);
    input.value = Math.round(u * 1000);
    input.style.setProperty('--fill', `${u * 100}%`);
    el.querySelector('.fxs-v').textContent = fxFormat(p, v);
    el.querySelector('.fxs-pic').innerHTML = FXP.svg(FXP.noText(FXP.PIC[pk](u, v, p)));
  };
  input.addEventListener('input', () => { m.set(p.key, fxClamp(p, fxFromUnit(fxRange(m, p), input.value / 1000))); paint(); onMove(); });
  input.addEventListener('change', () => m.commit());
  input.addEventListener('dblclick', () => { m.set(p.key, p.default ?? p.min); paint(); onMove(); m.commit(); });
  el.sync = paint;
  paint();
  return el;
}

/// A switch: a tile with its picture on it, lit when on.
function fxTile(m, p, onMove = () => {}, label = p.label) {
  const el = document.createElement('div');
  el.className = 'fxt';
  el.innerHTML = '<button type="button" class="fxt-b"></button><span class="fxk-l"></span>';
  el.querySelector('.fxk-l').textContent = label;
  const b = el.querySelector('button');
  const pk = FXP.picFor(p);
  const on = () => m.get(p.key) >= (p.min + p.max) / 2;
  const paint = () => {
    b.classList.toggle('on', on());
    b.setAttribute('aria-pressed', on());
    b.setAttribute('aria-label', p.label);
    b.innerHTML = FXP.svg(FXP.noText(FXP.PIC[pk](on() ? 1 : 0, on() ? 1 : 0, p))) + `<i>${on() ? 'on' : 'off'}</i>`;
  };
  b.onclick = () => { m.set(p.key, on() ? p.min : p.max); paint(); onMove(); m.commit(); };
  el.sync = paint;
  paint();
  return el;
}

/// The control a setting is drawn as. A knob, unless it is a level you ride
/// (a fader), a switch (a tile), or a technical setting (a slider row).
const FX_FADERS = new Set(['wet', 'dry', 'db']);
const FX_TECH = new Set(['inputDiffusion1', 'inputDiffusion2', 'decayDiffusion1', 'decayDiffusion2', 'modDepth', 'coefficient', 'clockHz', 'level', 'seed', 'baseMs']);
function fxIsTech(m, key) {
  // Bandwidth is technical in the plate (a coefficient) and musical in a
  // filter (in Hz).
  if (key === 'bandwidth') return m.byKey[key]?.unit !== 'Hz';
  return FX_TECH.has(key);
}
function fxControl(m, p, onMove, label) {
  if (fxIsSwitch(p)) return fxTile(m, p, onMove, label);
  if (FX_FADERS.has(p.key) || (p.key === 'gainDb' && /utility/.test(m.slot.kind))) return fxFader(m, p, onMove, label);
  return fxKnob(m, p, onMove, label);
}

// ──────────────────────────────────────────────────────────── the generic face

/// Display, then the controls in their sections, packed into rows that each
/// run the module's full width.
function fxDeckFace(box, m, el) {
  const panel = fxPanelOf(m.slot.kind, new Set(m.specs.map((p) => p.key)));
  const groups = panel?.groups?.length ? panel.groups : [{ label: '', keys: m.specs.map((p) => p.key) }];
  const pad = panel?.pad && m.byKey[panel.pad.x] && m.byKey[panel.pad.y] ? panel.pad : null;
  const heroKey = FXP.heroFor(m.slot.kind);
  const controls = {};
  const hw = document.createElement('div');
  hw.className = 'fx-face-display';
  const hero = () => {
    const draw = FXP.HERO[heroKey];
    if (!draw) { hw.hidden = true; return; }
    const v = m.values();
    let inner = draw(v);
    if (pad) {
      const px = m.byKey[pad.x], py = m.byKey[pad.y];
      inner += FXP.padMark(automationUnit(v[pad.x], pad.xMin, pad.xMax, fxIsLog(px)), automationUnit(v[pad.y], pad.yMin, pad.yMax, fxIsLog(py)), px.label, py.label);
    }
    hw.innerHTML = FXP.display(inner);
  };
  // The display is the effect's pad too: drag in it and its two main controls
  // follow, as the Prism pad does.
  if (pad) {
    const px = m.byKey[pad.x], py = m.byKey[pad.y];
    hw.classList.add('is-pad');
    hw.title = `Drag: ${px.label} across, ${py.label} up`;
    const drag = (e) => {
      const b = hw.getBoundingClientRect();
      m.set(px.key, fxClamp(px, unitValue((e.clientX - b.left) / b.width, pad.xMin, pad.xMax, fxIsLog(px))));
      m.set(py.key, fxClamp(py, unitValue(1 - (e.clientY - b.top) / b.height, pad.yMin, pad.yMax, fxIsLog(py))));
      controls[px.key]?.sync(); controls[py.key]?.sync();
      hero();
    };
    hw.addEventListener('pointerdown', (e) => { hw.setPointerCapture(e.pointerId); drag(e); });
    hw.addEventListener('pointermove', (e) => { if (hw.hasPointerCapture(e.pointerId)) drag(e); });
    hw.addEventListener('pointerup', (e) => { if (hw.hasPointerCapture(e.pointerId)) { hw.releasePointerCapture(e.pointerId); m.commit(); } });
  }
  const deck = document.createElement('div');
  deck.className = 'fx-deck';
  const secs = [], techRows = [];
  for (const g of groups) {
    const keys = g.keys.filter((k) => m.byKey[k]);
    if (!keys.length) continue;
    const sec = document.createElement('div');
    sec.className = 'fx-sect';
    sec.innerHTML = `${g.label ? '<b><span></span></b>' : ''}<div></div>`;
    if (g.label) sec.querySelector('b span').textContent = g.label;
    // A section's own switch is the lit square in its title.
    const onKey = g.label && keys.find((k) => /On$/.test(k));
    if (onKey) {
      const led = document.createElement('button');
      led.type = 'button';
      led.className = 'fx-led';
      led.setAttribute('aria-label', `${g.label} on`);
      const paint = () => { const on = m.get(onKey) >= .5; led.classList.toggle('on', on); led.setAttribute('aria-pressed', on); sec.classList.toggle('off', !on); };
      led.onclick = () => { m.set(onKey, m.get(onKey) >= .5 ? 0 : 1); paint(); hero(); m.commit(); };
      sec.querySelector('b').prepend(led);
      paint();
    }
    const tech = keys.some((k) => fxIsTech(m, k)) && keys.every((k) => fxIsTech(m, k) || fxIsSwitch(m.byKey[k]));
    if (tech) sec.classList.add('tech');
    for (const key of keys) {
      if (key === onKey) continue;
      const p = m.byKey[key], label = fxShort(p.label, g.label);
      if (tech && !fxIsSwitch(p)) { const c = fxSlider(m, p, hero, label); controls[key] = c; sec.querySelector('div').appendChild(c); continue; }
      if (fxIsTech(m, key) && !fxIsSwitch(p)) { const c = fxSlider(m, p, hero, label); controls[key] = c; techRows.push(c); continue; }
      const c = fxControl(m, p, hero, label);
      controls[key] = c;
      sec.querySelector('div').appendChild(c);
    }
    if (sec.querySelector('div').children.length) secs.push(sec);
  }
  // Rows of up to seven controls, faders counting for less than a knob, each
  // row stretched to the module's full width so none has an empty end.
  const weight = (sec) => [...sec.querySelector('div').children].reduce((a, c) => a + (c.classList.contains('fxf') ? .7 : 1), 0);
  const musical = secs.filter((s) => !s.classList.contains('tech'));
  let row = null, used = 0;
  for (const sec of musical) {
    const w = weight(sec);
    sec.style.setProperty('--n', w);
    if (!row || used + w > 7.5) { row = document.createElement('div'); row.className = 'fx-row'; deck.appendChild(row); used = 0; }
    row.appendChild(sec);
    used += w;
  }
  // A last row of one control joins the row above rather than standing alone.
  const rows = [...deck.children];
  if (rows.length > 1 && [...rows.at(-1).children].reduce((a, s) => a + weight(s), 0) <= 1.2) {
    [...rows.at(-1).children].forEach((s) => rows.at(-2).appendChild(s));
    rows.at(-1).remove();
  }
  for (const s of secs.filter((x) => x.classList.contains('tech'))) deck.appendChild(s);
  if (techRows.length) {
    const sec = document.createElement('div');
    sec.className = 'fx-sect tech';
    sec.innerHTML = '<b><span>Engine</span></b><div></div>';
    techRows.forEach((t) => sec.querySelector('div').appendChild(t));
    deck.appendChild(sec);
  }
  // A last row of one or two controls sits beside the engine sliders.
  const techs = [...deck.querySelectorAll(':scope > .fx-sect.tech')];
  const lastRow = [...deck.querySelectorAll(':scope > .fx-row')].at(-1);
  if (techs.length && lastRow && [...lastRow.children].reduce((a, s) => a + weight(s), 0) <= 2.2) {
    const wrap = document.createElement('div');
    wrap.className = 'fx-twrap';
    const col = document.createElement('div');
    col.className = 'fx-tcol';
    techs.forEach((t) => col.appendChild(t));
    wrap.append(col, lastRow);
    deck.appendChild(wrap);
  }
  box.append(hw, deck);
  // Three controls or fewer sit beside the display, not under it.
  const total = musical.reduce((a, s) => a + weight(s), 0);
  if (total > 0 && total <= 3.2 && !techs.length && FXP.HERO[heroKey]) {
    box.classList.add('fx-side');
    box.style.setProperty('--side', `${Math.max(64, Math.round(total * 52 + 8))}px`);
  }
  if (!m.specs.length) deck.remove();
  hero();
  return { controls, hero };
}

// ────────────────────────────────────────────────────────────── live readings

/// What each face drawn from the meters needs, by slot: its input's peak.
const fxInputDb = new Map();
const fxLive = new Map();

/// Called with the rack's meters, every frame they arrive.
function fxFaceLevels(slotIndex, input) {
  if (!input) return;
  const peak = Math.max(input[0] || 0, input[1] || 0, 1e-5);
  fxInputDb.set(slotIndex, Math.max(-72, Math.min(0, 20 * Math.log10(peak))));
}

function fxFaceLiveRepaint() {
  for (const [module, paint] of fxLive) {
    if (!module.isConnected) { fxLive.delete(module); continue; }
    paint();
  }
}

// ─────────────────────────────────────────────────────── compressor and gate

/// An arrow on a meter is a control like any other: named, focusable, and
/// nudged with the arrow keys a tenth of a dB at a time (a whole one with Shift).
function fxCaretControl(caret, p, get, set, commit) {
  caret.setAttribute('role', 'slider');
  caret.setAttribute('aria-label', p.label);
  caret.tabIndex = 0;
  const say = () => caret.setAttribute('aria-valuetext', fxFormat(p, get()));
  caret.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    set(get() + d * (e.shiftKey ? 1 : .1));
    say();
    commit();
  });
  caret.addEventListener('pointerup', say);
  say();
}

/// The transfer curve between the meters, the threshold as the arrow on the
/// input meter (Pro Tools' Dynamics III, IA-LA1), and the times and levels in
/// one row under it.
function fxDynamicsFace(box, m, el, slotIndex, gate) {
  const key = (re) => m.specs.find((p) => re.test(p.key))?.key;
  const kTh = key(/threshold/i), kRatio = key(/ratio/i), kKnee = key(/knee/i), kMake = key(/makeup/i), kDepth = key(/depth|range|floor/i);
  const lo = -72;
  box.classList.add('fx-dyn');
  box.innerHTML = `<div class="fx-dyn-mid"><div class="fx-mtr in"><span>IN</span><i></i><em></em></div><div class="fx-dyn-curve"></div>
    <div class="fx-mtr gr"><span>GR</span><i></i><em></em></div><div class="fx-mtr out"><span>OUT</span><i></i><em></em></div></div><div class="fx-dyn-row"></div>`;
  const out = (i) => {
    const th = m.get(kTh);
    if (gate) return i >= th ? i : i - (kDepth ? m.get(kDepth) : 1) * Math.min(60, (th - i) * 3);
    const r = m.get(kRatio), k = kKnee ? m.get(kKnee) : 0, d = i - th;
    const o = 2 * d < -k ? i : 2 * Math.abs(d) <= k ? i + (1 / r - 1) * Math.pow(d + k / 2, 2) / (2 * Math.max(k, .01)) : th + d / r;
    return o + (kMake ? m.get(kMake) : 0);
  };
  const W = 260, H = 112, x = (db) => (db - lo) / -lo * W, y = (db) => H - (db - lo) / -lo * H;
  const curve = box.querySelector('.fx-dyn-curve');
  const meter = (sel, unit, text) => { const mt = box.querySelector(sel); mt.querySelector('i').style.setProperty('--h', `${Math.max(0, Math.min(1, unit)) * 100}%`); mt.querySelector('em').textContent = text; };
  const paint = () => {
    const level = fxInputDb.get(slotIndex) ?? lo;
    let s = '';
    for (const g of [-60, -48, -36, -24, -12]) s += `<line x1="${x(g)}" x2="${x(g)}" y1="0" y2="${H}" class="fx-grid"/><line y1="${y(g)}" y2="${y(g)}" x1="0" x2="${W}" class="fx-grid"/>`;
    s += `<line x1="0" y1="${H}" x2="${W}" y2="0" class="fx-dim"/>`;
    let d = '';
    for (let i = 0; i <= 96; i++) { const db = lo + -lo * i / 96; d += `${i ? 'L' : 'M'}${x(db).toFixed(1)} ${Math.max(0, Math.min(H, y(out(db)))).toFixed(1)}`; }
    s += `<path d="${d}L${W} ${H}L0 ${H}Z" class="fx-fill"/><path d="${d}" class="fx-line"/>`;
    s += `<line x1="${x(m.get(kTh))}" x2="${x(m.get(kTh))}" y1="0" y2="${H}" class="fx-thr"/>`;
    if (level > lo) s += `<circle cx="${x(level)}" cy="${Math.max(0, Math.min(H, y(out(level))))}" r="4.5" class="fx-dot"/>`;
    curve.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Transfer curve: drag across for the threshold">${s}</svg>`;
    // Nothing playing is nothing reduced.
    const gr = level > lo ? Math.max(0, level + (gate || !kMake ? 0 : m.get(kMake)) - out(level)) : 0;
    meter('.in', (level - lo) / -lo, level > lo ? level.toFixed(0) : '−∞');
    meter('.gr', gr / 24, gr > .05 ? `−${gr.toFixed(1)}` : '0');
    meter('.out', (out(level) - lo) / -lo, level > lo ? out(level).toFixed(0) : '−∞');
    const caret = box.querySelector('.fx-mtr.in i .fx-caret');
    if (caret) caret.style.top = `${(1 - (m.get(kTh) - lo) / -lo) * 100}%`;
  };
  // The threshold: the arrow on IN, or a drag across the curve.
  const pTh = m.byKey[kTh];
  const setTh = (db) => { m.set(kTh, fxClamp(pTh, db)); paint(); };
  const caret = document.createElement('b');
  caret.className = 'fx-caret';
  caret.title = 'Threshold — drag';
  fxCaretControl(caret, pTh, () => m.get(kTh), (v) => setTh(v), () => m.commit());
  box.querySelector('.fx-mtr.in i').appendChild(caret);
  const meterBox = box.querySelector('.fx-mtr.in i');
  caret.addEventListener('pointerdown', (e) => { caret.setPointerCapture(e.pointerId); e.preventDefault(); });
  caret.addEventListener('pointermove', (e) => { if (!caret.hasPointerCapture(e.pointerId)) return; const b = meterBox.getBoundingClientRect(); setTh(lo + (1 - (e.clientY - b.top) / b.height) * -lo); });
  caret.addEventListener('pointerup', (e) => { if (caret.hasPointerCapture(e.pointerId)) { caret.releasePointerCapture(e.pointerId); m.commit(); } });
  curve.addEventListener('pointerdown', (e) => { curve.setPointerCapture(e.pointerId); const b = curve.getBoundingClientRect(); setTh(lo + (e.clientX - b.left) / b.width * -lo); });
  curve.addEventListener('pointermove', (e) => { if (!curve.hasPointerCapture(e.pointerId)) return; const b = curve.getBoundingClientRect(); setTh(lo + (e.clientX - b.left) / b.width * -lo); });
  curve.addEventListener('pointerup', (e) => { if (curve.hasPointerCapture(e.pointerId)) { curve.releasePointerCapture(e.pointerId); m.commit(); } });
  const row = box.querySelector('.fx-dyn-row');
  for (const p of m.specs) if (p.key !== kTh) row.appendChild(fxControl(m, p, paint, fxShort(p.label, '')));
  fxLive.set(el, paint);
  paint();
}

// ──────────────────────────────────────────────────────────────── maximizer

/// Pro-L's arrangement: the drive pushes the sound in, the ceiling is the red
/// arrow on the output meter.
function fxMaximizerFace(box, m, el, slotIndex) {
  const lo = -48;
  box.classList.add('fx-dyn');
  box.innerHTML = `<div class="fx-dyn-mid"><div class="fx-mtr in"><span>IN</span><i></i><em></em></div><div class="fx-dyn-curve"></div>
    <div class="fx-mtr gr"><span>GR</span><i></i><em></em></div><div class="fx-mtr out"><span>OUT</span><i></i><em></em></div></div><div class="fx-dyn-row"></div>`;
  const pCeil = m.byKey.ceilingDb;
  const meter = (sel, unit, text) => { const mt = box.querySelector(sel); mt.querySelector('i').style.setProperty('--h', `${Math.max(0, Math.min(1, unit)) * 100}%`); mt.querySelector('em').textContent = text; };
  const paint = () => {
    const v = m.values(), drive = 20 * Math.log10(1 + (v.amount ?? 0) * 3), level = fxInputDb.get(slotIndex) ?? lo;
    box.querySelector('.fx-dyn-curve').innerHTML = FXP.display(FXP.HERO.maximizer(v), true);
    const outPk = Math.min(v.ceilingDb, level + drive), gr = Math.max(0, level + drive - v.ceilingDb);
    meter('.in', (level - lo) / -lo, level > lo ? level.toFixed(0) : '−∞');
    meter('.gr', gr / 18, gr > .05 ? `−${gr.toFixed(1)}` : '0');
    meter('.out', (outPk - lo) / -lo, level > lo ? outPk.toFixed(1) : '−∞');
    caret.style.top = `${(1 - (v.ceilingDb - lo) / -lo) * 100}%`;
  };
  const om = box.querySelector('.fx-mtr.out i');
  const caret = document.createElement('b');
  caret.className = 'fx-caret ceil';
  caret.title = 'Ceiling — drag';
  fxCaretControl(caret, pCeil, () => m.get('ceilingDb'), (v) => { m.set('ceilingDb', fxClamp(pCeil, v)); controls.ceilingDb?.sync(); paint(); }, () => m.commit());
  om.appendChild(caret);
  caret.addEventListener('pointerdown', (e) => { caret.setPointerCapture(e.pointerId); e.preventDefault(); });
  caret.addEventListener('pointermove', (e) => { if (!caret.hasPointerCapture(e.pointerId)) return; const b = om.getBoundingClientRect(); m.set('ceilingDb', fxClamp(pCeil, lo + (1 - (e.clientY - b.top) / b.height) * -lo)); controls.ceilingDb?.sync(); paint(); });
  caret.addEventListener('pointerup', (e) => { if (caret.hasPointerCapture(e.pointerId)) { caret.releasePointerCapture(e.pointerId); m.commit(); } });
  const row = box.querySelector('.fx-dyn-row'), controls = {};
  for (const p of m.specs) { const c = fxControl(m, p, paint, p.key === 'amount' ? 'Drive' : fxShort(p.label, '')); controls[p.key] = c; row.appendChild(c); }
  fxLive.set(el, paint);
  paint();
}

// ────────────────────────────────────────────────────────────────────── EQ

const FX_EQ_TYPES = ['highpass', 'lowshelf', 'bell', 'notch', 'highshelf', 'lowpass'];
const FX_EQ_SHORT = ['HP', 'LS', 'Bell', 'Notch', 'HS', 'LP'];
const FX_EQ_ICON = ['M2 12Q8 12 10 4L26 4', 'M2 10L10 10Q14 4 18 4L26 4', 'M2 10Q9 10 14 3Q19 10 26 10', 'M2 4L10 4Q14 13 18 4L26 4', 'M2 4L10 4Q14 10 18 10L26 10', 'M2 4L18 4Q20 12 26 12'];
const FX_EQ_COLOURS = ['#ff5a6e', '#ffa047', '#f5d547', '#4fd67a', '#3fc4ff', '#5a8bff', '#b07cff', '#ff6fd1'];

/// The EQ's eight bands, as one shape for the original (`slot.bands`) and the
/// prism twin (`band.<n>.<key>` params, the type a number).
function fxEqBands(slot) {
  if (slot.kind === 'eq') {
    slot.bands = slot.bands || defaultEqBands();
    return {
      bands: () => slot.bands,
      set(i, k, v) { slot.bands[i][k] = v; if (k === 'type' || k === 'enabled') pushRack({ immediate: true }); else liveParam(slot.id, `band.${i}.${k}`, v); },
    };
  }
  slot.params = slot.params || {};
  for (const p of state.shapers[slot.kind]?.params || []) if (slot.params[p.key] === undefined) slot.params[p.key] = p.default;
  const P = slot.params;
  // Read fresh each time, so a band is always what the params say now.
  const band = (i) => ({
    type: FX_EQ_TYPES[Math.round(P[`band.${i}.mode`] ?? 2)],
    enabled: (P[`band.${i}.enabled`] ?? 1) >= .5,
    freq: P[`band.${i}.freq`],
    q: P[`band.${i}.q`] ?? .71,
    gainDb: P[`band.${i}.gainDb`] ?? 0,
  });
  return {
    bands: () => [...Array(8)].map((_, i) => band(i)),
    set(i, k, v) {
      const key = k === 'type' ? 'mode' : k, value = k === 'type' ? FX_EQ_TYPES.indexOf(v) : k === 'enabled' ? (v ? 1 : 0) : v;
      if (P[`band.${i}.${key}`] === undefined && key !== 'mode' && key !== 'enabled') return;
      P[`band.${i}.${key}`] = value;
      liveParam(slot.id, `band.${i}.${key}`, value);
      if (k === 'type' || k === 'enabled') commitRack();
    },
  };
}

/// Every band its own coloured layer over the live analyser, the sum on top;
/// drag a numbered node for frequency and gain, scroll on it for Q.
function fxEqFace(box, slot, el, slotIndex) {
  const eq = fxEqBands(slot);
  let sel = eqBandSelections.get(slotIndex) ?? 2;
  const W = 340, H = 150, fmin = 20, fmax = 20000, gmax = 18, fs = engine.deviceRate || 48000;
  const xOf = (f) => (W - 4) * Math.log(f / fmin) / Math.log(fmax / fmin) + 2, fOf = (x) => fmin * Math.pow(fmax / fmin, (x - 2) / (W - 4));
  const yOf = (g) => H / 2 - g / gmax * (H / 2 - 10), gOf = (y) => (H / 2 - y) / (H / 2 - 10) * gmax;
  const kind = (b) => FX_EQ_TYPES.indexOf(b.type);
  const passOrNotch = (b) => ['highpass', 'lowpass', 'notch'].includes(b.type);
  box.classList.add('fx-eq');
  box.innerHTML = '<div class="fx-eq-types"></div><div class="fx-eq-disp"></div><div class="fx-eq-read"></div><div class="fx-eq-sel"></div>';
  const disp = box.querySelector('.fx-eq-disp');
  const freqs = [...Array(161)].map((_, i) => fmin * Math.pow(fmax / fmin, i / 160));
  const paintCurve = () => {
    const bands = eq.bands();
    const total = (f) => bands.reduce((a, b) => a + (b.enabled ? FXP.rbjDb(kind(b), b.freq, b.q, b.gainDb, f, fs) : 0), 0);
    let s = '';
    for (const g of [-12, -6, 0, 6, 12]) s += `<line x1="0" x2="${W}" y1="${yOf(g)}" y2="${yOf(g)}" class="fx-grid"/>`;
    for (const f of [100, 1000, 10000]) s += `<line y1="0" y2="${H}" x1="${xOf(f)}" x2="${xOf(f)}" class="fx-grid"/><text x="${xOf(f) + 2}" y="${H - 3}" class="fx-tx">${f >= 1000 ? f / 1000 + 'k' : f}</text>`;
    // The analyser, live, behind everything.
    if (engine.spectrum?.length) {
      const bins = engine.spectrum, nyq = fs / 2;
      let d = `M0 ${H}`;
      for (let i = 1; i < bins.length; i++) { const hz = i / (bins.length - 1) * nyq; if (hz >= fmin && hz <= fmax) d += `L${xOf(hz).toFixed(1)} ${(H - bins[i] / 255 * H * .9).toFixed(1)}`; }
      s += `<path d="${d}L${W} ${H}Z" class="fx-spec"/>`;
    }
    bands.forEach((b, i) => {
      if (!b.enabled) return;
      const d = freqs.map((f, k) => `${k ? 'L' : 'M'}${xOf(f).toFixed(1)} ${Math.max(1, Math.min(H - 1, yOf(FXP.rbjDb(kind(b), b.freq, b.q, b.gainDb, f, fs)))).toFixed(1)}`).join('');
      s += `<path d="${d}L${W} ${yOf(0)}L0 ${yOf(0)}Z" fill="${FX_EQ_COLOURS[i]}" opacity="${i === sel ? .26 : .1}"/><path d="${d}" fill="none" stroke="${FX_EQ_COLOURS[i]}" stroke-width="${i === sel ? 1.5 : 1}" opacity=".85"/>`;
    });
    s += `<path d="${freqs.map((f, k) => `${k ? 'L' : 'M'}${xOf(f).toFixed(1)} ${Math.max(1, Math.min(H - 1, yOf(total(f)))).toFixed(1)}`).join('')}" class="fx-sum"/>`;
    bands.forEach((b, i) => {
      const x = xOf(Math.max(fmin, Math.min(fmax, b.freq))), y = passOrNotch(b) ? yOf(0) : yOf(b.gainDb);
      s += `<g data-b="${i}" class="fx-node${b.enabled ? '' : ' off'}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === sel ? 7.5 : 6}" fill="${FX_EQ_COLOURS[i]}" stroke="${i === sel ? '#fff' : '#04060a'}" stroke-width="1.4"/><text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${i + 1}</text></g>`;
    });
    disp.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-label="EQ curve: drag a numbered node to move its band, scroll on it for Q">${s}</svg>`;
  };
  const paintStrips = () => {
    const types = box.querySelector('.fx-eq-types'), read = box.querySelector('.fx-eq-read');
    types.innerHTML = ''; read.innerHTML = '';
    eq.bands().forEach((b, i) => {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = (b.enabled ? 'on' : '') + (i === sel ? ' sel' : '');
      t.style.setProperty('--bc', FX_EQ_COLOURS[i]);
      t.innerHTML = `<svg viewBox="0 0 28 14"><path d="${FX_EQ_ICON[kind(b)]}"/></svg>${i + 1}`;
      t.title = `Band ${i + 1}, ${FX_EQ_SHORT[kind(b)]}: click to select, double-click to switch on or off`;
      t.onclick = () => select(i);
      t.ondblclick = () => { eq.set(i, 'enabled', !b.enabled); paintAll(); };
      types.appendChild(t);
      const r = document.createElement('div');
      r.className = (b.enabled ? 'on' : '') + (i === sel ? ' sel' : '');
      r.style.setProperty('--bc', FX_EQ_COLOURS[i]);
      const hz = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(b.freq >= 10000 ? 0 : 1)}k` : `${Math.round(b.freq)}`;
      r.innerHTML = `${hz}<br>${b.type === 'highpass' || b.type === 'lowpass' ? '12/oct' : b.type === 'notch' ? 'notch' : `${b.gainDb > 0 ? '+' : ''}${b.gainDb.toFixed(1)}`}`;
      r.onclick = () => select(i);
      read.appendChild(r);
    });
  };
  // The selected band's own knobs and type.
  const bandModel = () => ({
    slot, specs: [], byKey: {},
    get: (k) => eq.bands()[sel][k],
    set: (k, v) => eq.set(sel, k, v),
    commit: () => { if (slot.kind === 'eq') commitRack(); else commitRack(); },
    values: () => ({}),
  });
  const paintSel = () => {
    const box2 = box.querySelector('.fx-eq-sel'), b = eq.bands()[sel], bm = bandModel();
    box2.innerHTML = '';
    box2.style.setProperty('--accent', FX_EQ_COLOURS[sel]);
    const specs = [
      { key: 'freq', label: 'Frequency', min: 20, max: 20000, default: eqBorn(sel, 'freq') ?? 1000, unit: 'Hz', log: true },
      ...(passOrNotch(b) && b.type !== 'notch' ? [] : [{ key: 'gainDb', label: 'Gain', min: -24, max: 24, default: 0, unit: 'dB' }]),
      { key: 'q', label: b.type === 'highpass' || b.type === 'lowpass' ? 'Resonance' : 'Q', min: .05, max: 18, default: .71, log: true },
    ];
    for (const p of specs) {
      bm.byKey[p.key] = p;
      box2.appendChild(fxKnob({ ...bm, slot: { id: `${slot.id}#band` } }, p, () => { paintCurve(); paintStrips(); }));
    }
    // The band's own switch, as plain as the type buttons beside it.
    const power = document.createElement('button');
    power.type = 'button';
    power.className = 'fx-eq-on' + (b.enabled ? ' on' : '');
    power.textContent = b.enabled ? 'On' : 'Off';
    power.title = `Band ${sel + 1} on or off`;
    power.onclick = () => { eq.set(sel, 'enabled', !b.enabled); paintAll(); };
    box2.appendChild(power);
    const modes = document.createElement('div');
    modes.className = 'fx-eq-modes';
    FX_EQ_SHORT.forEach((t, k) => {
      const mb = document.createElement('button');
      mb.type = 'button';
      mb.textContent = t;
      if (k === kind(b)) mb.className = 'on';
      mb.onclick = () => { eq.set(sel, 'type', FX_EQ_TYPES[k]); paintAll(); };
      modes.appendChild(mb);
    });
    box2.appendChild(modes);
  };
  const paintAll = () => { paintCurve(); paintStrips(); paintSel(); };
  const select = (i) => { sel = i; eqBandSelections.set(slotIndex, i); paintAll(); };
  let dragging = false;
  disp.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-b]');
    if (!g) return;
    select(+g.dataset.b);
    dragging = true;
    disp.setPointerCapture(e.pointerId);
  });
  disp.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = disp.getBoundingClientRect(), b = eq.bands()[sel];
    eq.set(sel, 'freq', Math.max(20, Math.min(20000, fOf((e.clientX - r.left) / r.width * W))));
    if (!passOrNotch(b)) eq.set(sel, 'gainDb', Math.max(-24, Math.min(24, gOf((e.clientY - r.top) / r.height * H))));
    paintCurve(); paintStrips();
  });
  disp.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; disp.releasePointerCapture(e.pointerId); paintSel(); commitRack(); });
  disp.addEventListener('wheel', (e) => {
    const g = e.target.closest('[data-b]');
    if (!g) return;
    e.preventDefault();
    const i = +g.dataset.b;
    eq.set(i, 'q', Math.max(.05, Math.min(18, eq.bands()[i].q * (e.deltaY < 0 ? 1.1 : .9))));
    if (i !== sel) select(i); else paintAll();
    clearTimeout(disp.qTimer);
    disp.qTimer = setTimeout(commitRack, 300);
  }, { passive: false });
  // The analyser moves with the sound; the rest only when something is moved.
  fxLive.set(el, () => { if (!dragging) paintCurve(); });
  paintAll();
}

// ─────────────────────────────────────────────────────────── Advanced ranges

/// Each knob's own range: where its travel starts and ends, and its curve —
/// so a delay's knob can sweep 20 to 80 ms instead of 1 ms to 2 s. Inside the
/// effect's own limits: those are the engine's, and it clamps to them.
function fxAdvanced(box, m, back) {
  const knobs = m.specs.filter((p) => !fxIsSwitch(p) && !p.choices);
  box.innerHTML = '';
  box.classList.add('fx-adv');
  box.innerHTML = '<div class="fx-adv-head"><span></span><span>knob</span><span>sweeps</span><span>from</span><span>to</span><span>curve</span></div>';
  const ranges = () => ((state.rack.ranges ||= {})[m.slot.id] ||= {});
  const save = () => { if (!Object.keys(ranges()).length) delete state.rack.ranges[m.slot.id]; commitRack(); };
  for (const p of knobs) {
    const row = document.createElement('div');
    row.className = 'fx-adv-row';
    row.innerHTML = '<span class="fxs-pic"></span><span class="k"></span><div class="fx-rbar"><i class="fac"></i><i class="you"></i></div><input type="number" step="any"><input type="number" step="any"><div class="fx-curve"><button type="button">lin</button><button type="button">log</button></div>';
    row.querySelector('.fxs-pic').innerHTML = FXP.svg(FXP.noText(FXP.PIC[FXP.picFor(p)](.6, p.min + (p.max - p.min) * .6, p)));
    row.querySelector('.k').textContent = p.label + (p.unit && p.unit !== ':1' ? ` (${p.unit})` : '');
    const [lo, hi] = row.querySelectorAll('input');
    lo.setAttribute('aria-label', `${p.label}: start of the knob`); hi.setAttribute('aria-label', `${p.label}: end of the knob`);
    lo.min = hi.min = p.min; lo.max = hi.max = p.max;
    const cur = () => fxRange(m, p);
    const show = () => {
      const r = cur(), span = p.max - p.min || 1;
      lo.value = +r.min.toPrecision(5); hi.value = +r.max.toPrecision(5);
      Object.assign(row.querySelector('.fac').style, { left: '0%', width: '100%' });
      Object.assign(row.querySelector('.you').style, { left: `${(r.min - p.min) / span * 100}%`, width: `${Math.max(0, r.max - r.min) / span * 100}%` });
      row.querySelectorAll('.fx-curve button').forEach((b, i) => b.classList.toggle('on', !!r.log === !!i));
      row.classList.toggle('own', !!state.rack.ranges?.[m.slot.id]?.[p.key]);
    };
    const put = (patch) => {
      const r = { ...cur(), ...patch };
      r.min = Math.max(p.min, Math.min(p.max, r.min)); r.max = Math.max(p.min, Math.min(p.max, r.max));
      if (r.max <= r.min) { show(); return; }
      if (r.log && r.min <= 0) r.log = false;
      const factory = r.min === p.min && r.max === p.max && r.log === fxIsLog(p);
      if (factory) delete ranges()[p.key]; else ranges()[p.key] = r;
      show(); save();
    };
    lo.onchange = () => lo.value !== '' && put({ min: +lo.value });
    hi.onchange = () => hi.value !== '' && put({ max: +hi.value });
    row.querySelectorAll('.fx-curve button').forEach((b, i) => { b.onclick = () => put({ log: !!i }); });
    show();
    box.appendChild(row);
  }
  const foot = document.createElement('div');
  foot.className = 'fx-adv-foot';
  foot.innerHTML = `<span>Grey is the effect's whole range; the outline is what the knob sweeps. Saved with the rack.</span><button class="ghost" type="button">Factory ranges</button>`;
  foot.querySelector('button').onclick = () => { if (state.rack.ranges) delete state.rack.ranges[m.slot.id]; commitRack(); fxAdvanced(box, m, back); };
  box.appendChild(foot);
}

// ──────────────────────────────────────────────────────────────── the entry

/// Draw a built-in effect's face into its module. `renderRack` has made the
/// module and its header; this fills the controls and dresses the header.
function renderFxFace(box, slot, slotIndex, el) {
  el.classList.add('fx-face');
  // The header's power is a lit square and its Remove is ×.
  const remove = el.querySelector('.fx-remove');
  if (remove) { remove.textContent = '×'; remove.title = 'Remove'; remove.setAttribute('aria-label', 'Remove'); }
  el.querySelector('.fx-power')?.setAttribute('aria-label', slot.bypassed ? 'Off — switch on' : 'On — switch off');
  el.style.setProperty('--accent', fxFamilyColour(slot.kind));
  box.classList.add('fx-face-body');
  const isEq = slot.kind === 'eq' || slot.kind === 'prism:eq';
  const isComp = slot.kind === 'comp' || slot.kind === 'prism:compressor';
  const isGate = /^(prism:)?gate$/.test(slot.kind);
  const isMax = /^(prism:)?maximizer$/.test(slot.kind);
  const draw = () => {
    box.innerHTML = '';
    box.className = 'fx-module-controls fx-face-body';
    box.style.removeProperty('--side');
    fxLive.delete(el);
    if (isEq) { fxEqFace(box, slot, el, slotIndex); return; }
    const m = fxModel(slot);
    if (isComp || isGate) { fxDynamicsFace(box, m, el, slotIndex, isGate); return; }
    if (isMax) { fxMaximizerFace(box, m, el, slotIndex); return; }
    fxDeckFace(box, m, el);
  };
  draw();
  // Advanced, for every effect but the EQ and the compressor: their knobs are
  // the ones every other effect is measured against.
  if (isEq || isComp) return;
  const m = fxModel(slot);
  if (!m.specs.some((p) => !fxIsSwitch(p) && !p.choices)) return;
  // One switch: lit, the module shows its knobs' ranges; dark, its knobs.
  const adv = document.createElement('button');
  adv.type = 'button';
  adv.className = 'fx-adv-btn';
  adv.textContent = 'Advanced';
  adv.title = "Each knob's own range";
  adv.setAttribute('aria-pressed', 'false');
  adv.onclick = () => {
    const on = !adv.classList.contains('on');
    adv.classList.toggle('on', on);
    adv.setAttribute('aria-pressed', String(on));
    if (!on) { draw(); return; }
    fxLive.delete(el);
    box.style.removeProperty('--side');
    box.className = 'fx-module-controls fx-face-body';
    fxAdvanced(box, fxModel(slot));
  };
  el.querySelector('.fx-module-actions')?.prepend(adv);
}

/// A picture on each control of the Hyperprism, SoundHack and Lexicon panels:
/// their own layout, with what each value does drawn beside it.
function fxDecorateRow(row, p, read) {
  if (!row || row.querySelector(':scope > .fx-pic')) return;
  const pic = document.createElement('span');
  pic.className = 'fx-pic';
  row.prepend(pic);
  row.classList.add('fx-pic-row');
  const pk = FXP.picFor(p);
  // Without its small print: at this size it cannot be read, and it would
  // become part of the row's text.
  const paint = () => { const v = read(), u = automationUnit(v, p.min, p.max, fxIsLog(p)); pic.innerHTML = FXP.svg(FXP.noText(FXP.PIC[pk](u, v, p))); };
  const sync = row.sync;
  row.sync = (...a) => { sync?.(...a); paint(); };
  row.addEventListener('input', paint);
  row.addEventListener('click', () => requestAnimationFrame(paint));
  paint();
}
