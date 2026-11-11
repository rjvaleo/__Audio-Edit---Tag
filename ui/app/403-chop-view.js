// ═══════════════════════════════════════════════ Chop: seeing the sound ══
//
// The overview of the whole sound, the detail with its slices, and the pictures
// under it. The waveform is coloured by what `402-chop-listen.js` measured; the
// Colour row says which measure. The Look decides the rest (`406-chop-page.js`).

/// What the detail shows, in frames. The page's own, not the lane's.
const chopView = { a: 0, b: 1, follow: true, mode: 'scroll' };
const chopXOf = (f) => (f - chopView.a) / (chopView.b - chopView.a);
const chopFrameOf = (u) => chopView.a + u * (chopView.b - chopView.a);
let chopWasPlaying = false;

function chopZoom(factor, at) {
  const L = Math.max(256, Math.min(chop.len, (chopView.b - chopView.a) * factor));
  const a = Math.max(0, Math.min(chop.len - L, at - (at - chopView.a) * L / (chopView.b - chopView.a)));
  chopView.a = a;
  chopView.b = a + L;
  chopPaintLane();
}

function chopFit0() { chopView.a = 0; chopView.b = chop.len; chopPaintLane(); }

/// Keep the playhead on screen, while Follow is on.
function chopFollow(at) {
  if (!chopView.follow || at < 0) return;
  const L = chopView.b - chopView.a;
  if (L >= chop.len || (at >= chopView.a && at <= chopView.b - L * 0.05 && chopView.mode === 'page')) return;
  const a = chopView.mode === 'page'
    ? (at < chopView.a || at > chopView.b - L * 0.05 ? at : chopView.a)
    : at - L / 2;
  chopView.a = Math.max(0, Math.min(chop.len - L, a));
  chopView.b = chopView.a + L;
  chopPaintLane();
}

// ─────────────────────────────────────────────────── what the colours are

const CHOP_KIND = { Kick: [120, 104, 255], Bass: [190, 120, 255], Snare: [255, 84, 140], Hat: [125, 235, 255], Perc: [84, 226, 160], Tone: [214, 240, 90], Quiet: [110, 118, 128] };
const chopRgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const chopKindColour = (x) => (x.m ? chopRgb(CHOP_KIND[x.m.kind]) : 'var(--t2)');
const chopMix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const chopRamp = (st, v) => {
  v = Math.max(0, Math.min(1, v)) * (st.length - 1);
  const i = Math.min(st.length - 2, Math.floor(v));
  return chopMix(st[i], st[i + 1], v - i);
};
const CHOP_BRIGHT = [[70, 50, 190], [40, 130, 240], [50, 225, 215], [230, 255, 245]];
const CHOP_NOISE = [[255, 70, 190], [150, 110, 255], [90, 200, 240], [235, 250, 255]];
const CHOP_ATTACK = [[50, 58, 92], [80, 110, 200], [120, 225, 255], [255, 255, 255]];
const CHOP_LEVEL = [[44, 46, 96], [80, 90, 200], [100, 205, 225], [245, 255, 250]];
const CHOP_LOW = [132, 104, 255], CHOP_MID = [32, 236, 168], CHOP_HIGH = [255, 255, 255], CHOP_NO_NOTE = [96, 102, 112];
/// A colour for each note. The hues run from yellow-green round to red, leaving
/// out orange, which means "on".
const chopNoteColour = (m) => {
  const h = 70 + (((m % 12) + 12) % 12) * 24, s = 0.85, l = 0.62, a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
};
const CHOP_VIEWS = [
  ['spectrum', 'Spectrum', 'Where the energy sits: low, mid and high', [CHOP_LOW, CHOP_MID, CHOP_HIGH]],
  ['bright', 'Bright', 'How bright: the spectrum’s centre', CHOP_BRIGHT],
  ['noise', 'Noise', 'Tone or noise: how flat the spectrum is', CHOP_NOISE],
  ['pitch', 'Pitch', 'The note, when there is one', [chopNoteColour(60), chopNoteColour(63), chopNoteColour(66), chopNoteColour(69)]],
  ['attack', 'Attack', 'The hits: how sharply the energy rises', CHOP_ATTACK],
  ['level', 'Level', 'Loudness', CHOP_LEVEL],
  ['kind', 'Kind', 'What each slice most likely is', [CHOP_KIND.Kick, CHOP_KIND.Snare, CHOP_KIND.Hat, CHOP_KIND.Perc]],
  ['white', 'White', 'No colour', [[255, 255, 255], [255, 255, 255]]],
];
let chopColour = 'spectrum';
try { const v = localStorage.getItem('chopColour'); if (CHOP_VIEWS.some(([k]) => k === v)) chopColour = v; } catch { /* private mode */ }

function chopFrameColour(an, f) {
  switch (chopColour) {
    case 'spectrum': {
      const l = an.low[f] ** 2, m = an.mid[f] ** 2, h = an.high[f] ** 2, t = l + m + h + 1e-9;
      return [(CHOP_LOW[0] * l + CHOP_MID[0] * m + CHOP_HIGH[0] * h) / t, (CHOP_LOW[1] * l + CHOP_MID[1] * m + CHOP_HIGH[1] * h) / t, (CHOP_LOW[2] * l + CHOP_MID[2] * m + CHOP_HIGH[2] * h) / t];
    }
    case 'bright': return chopRamp(CHOP_BRIGHT, Math.log(Math.max(an.cent[f], 150) / 150) / Math.log(60));
    case 'noise': return chopRamp(CHOP_NOISE, an.flat[f] / 0.55);
    case 'pitch': {
      if (!an.hz[f] || an.clar[f] < 0.55) return CHOP_NO_NOTE;
      return chopMix(CHOP_NO_NOTE, chopNoteColour(Math.round(69 + 12 * Math.log2(an.hz[f] / 440))), Math.min(1, (an.clar[f] - 0.55) / 0.3));
    }
    case 'attack': return chopRamp(CHOP_ATTACK, Math.pow(an.rise[f], 0.7));
    case 'level': return chopRamp(CHOP_LEVEL, (20 * Math.log10(an.rms[f] + 1e-9) + 48) / 42);
    default: return [255, 255, 255];
  }
}

function chopSizeCanvas(c) {
  const w = +c.dataset.w, h = +c.dataset.h, r = Math.min(2, devicePixelRatio || 1);
  if (c.width !== w * r) { c.style.width = `${w}px`; c.style.height = `${h}px`; c.width = w * r; c.height = h * r; }
  const g = c.getContext('2d');
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  return { c: g, w, h };
}

/// The look's colours, for what is drawn on a canvas. Read again when the theme
/// changes (`chopRestyle`).
const chopTok = { wave: '#fff', bloom: '205,225,255', t: '#e8eaee', t2: '#b9bec6', t3: '#858b94', glow: 1, ui: 'sans-serif' };
function chopReadLook() {
  const b = getComputedStyle(document.querySelector('.chop-app')), v = (k) => b.getPropertyValue(k).trim();
  Object.assign(chopTok, { wave: v('--wave'), bloom: v('--bloom'), t: v('--t'), t2: v('--t2'), t3: v('--t3'), glow: +v('--glow') || 1, ui: v('--ui') });
}
const chopGlow = (a) => `rgba(${chopTok.bloom},${(a * Math.min(1, chopTok.glow)).toFixed(2)})`;

function chopPeaks(w, a0, b0) {
  const per = (b0 - a0) / w, st = Math.max(1, Math.floor(per / 40));
  const mx = new Float32Array(w), mn = new Float32Array(w), m = chop.mono;
  for (let x = 0; x < w; x++) {
    let hi = 0, lo = 0;
    const s = Math.floor(a0 + x * per), e = Math.max(s + 1, Math.floor(a0 + (x + 1) * per));
    for (let j = s; j < e; j += st) { const v = m[j] || 0; if (v > hi) hi = v; if (v < lo) lo = v; }
    mx[x] = hi; mn[x] = lo;
  }
  return { mx, mn };
}

/// The plain trace, in the Look's colour: a glowing outline over a faint fill.
function chopPlainWave(c, { mx, mn }, w, mid, A, alpha) {
  const top = new Path2D(), bot = new Path2D();
  top.moveTo(0, mid); bot.moveTo(0, mid);
  for (let x = 0; x < w; x++) { top.lineTo(x + 0.5, mid - mx[x] * A - 0.4); bot.lineTo(x + 0.5, mid - mn[x] * A + 0.4); }
  const body = new Path2D(top);
  for (let x = w - 1; x >= 0; x--) body.lineTo(x + 0.5, mid - mn[x] * A + 0.4);
  body.closePath();
  c.fillStyle = chopTok.wave; c.globalAlpha = alpha * 0.3; c.fill(body);
  c.globalAlpha = alpha; c.strokeStyle = chopTok.wave; c.lineWidth = 1.1; c.lineJoin = 'round';
  c.stroke(top); c.stroke(bot);
  c.globalAlpha = 1;
}

/// Each column of the waveform in the colour of what is there. The colour of a
/// column is the average of its frames, by how loud they are; Pitch and Attack
/// take the frame that decides instead, because an average of notes is nothing.
function chopColumns(c, peaks, w, mid, A, a0, b0, alpha) {
  const an = chop.an;
  if (chopColour === 'white' || !an) { chopPlainWave(c, peaks, w, mid, A, alpha); return; }
  const per = (b0 - a0) / w, { mx, mn } = peaks, sl = chop.slices;
  let si = 0;
  for (let x = 0; x < w; x++) {
    const f0 = a0 + x * per, f1 = f0 + per;
    let col;
    if (chopColour === 'kind') {
      const at = (f0 + f1) / 2;
      while (si < sl.length - 1 && sl[si].e <= at) si++;
      const q = sl[si];
      col = q && at >= q.s && at < q.e && q.m ? CHOP_KIND[q.m.kind] : [70, 74, 82];
    } else {
      const i0 = Math.max(0, Math.min(an.F - 1, Math.floor((f0 - an.N / 2) / an.HOP)));
      const i1 = Math.max(i0 + 1, Math.min(an.F, Math.ceil((f1 - an.N / 2) / an.HOP)));
      if (chopColour === 'pitch' || chopColour === 'attack') {
        const src = chopColour === 'pitch' ? an.rms : an.rise;
        let b = i0, v = -1;
        for (let f = i0; f < i1; f++) if (src[f] > v) { v = src[f]; b = f; }
        col = chopFrameColour(an, b);
      } else {
        const st = Math.max(1, Math.floor((i1 - i0) / 8));
        let r = 0, g = 0, bl = 0, wt = 1e-12;
        for (let f = i0; f < i1; f += st) {
          const q = chopFrameColour(an, f), e = an.rms[f] ** 2 + 1e-12;
          r += q[0] * e; g += q[1] * e; bl += q[2] * e; wt += e;
        }
        col = [r / wt, g / wt, bl / wt];
      }
    }
    const top = mid - mx[x] * A, bot = mid - mn[x] * A;
    c.fillStyle = chopRgb(col);
    c.globalAlpha = alpha * 0.8;
    c.fillRect(x, top, 1, Math.max(1, bot - top));
    c.globalAlpha = alpha;
    c.fillRect(x, top - 0.6, 1, 1.5);
    c.fillRect(x, bot - 0.9, 1, 1.5);
  }
  c.globalAlpha = 1;
}

function chopDrawWave() {
  const { c, w, h } = chopSizeCanvas($('chopWave')), ruler = 18, H = h - ruler, mid = ruler + H / 2, A = H * 0.47;
  c.shadowBlur = chopColour === 'white' ? 7 * chopTok.glow : 0;
  c.shadowColor = chopGlow(0.5);
  chopColumns(c, chopPeaks(w, chopView.a, chopView.b), w, mid, A, chopView.a, chopView.b, 0.95);
  c.shadowBlur = 0;
  c.fillStyle = 'rgba(255,255,255,.08)';
  c.fillRect(0, mid, w, 1);
}

function chopDrawOverview() {
  const { c, w, h } = chopSizeCanvas($('chopOverview')), fx = (f) => f / chop.len * w;
  chopColumns(c, chopPeaks(w, 0, chop.len), w, h / 2, h * 0.42, 0, chop.len, 0.85);
  c.fillStyle = 'rgba(255,255,255,.35)';
  let last = -9;
  for (const s of chop.slices) { const l = fx(s.s); if (l - last >= 3) { c.fillRect(l, h - 4, 1, 4); last = l; } }
  const { s: S, e: E } = chop.region;
  c.fillStyle = 'rgba(0,0,0,.62)'; c.fillRect(0, 0, fx(S), h); c.fillRect(fx(E), 0, w - fx(E), h);
  c.strokeStyle = chopTok.wave; c.lineWidth = 1;
  c.strokeRect(fx(chopView.a) + 0.5, 1.5, Math.max(4, fx(chopView.b) - fx(chopView.a) - 1), h - 3);
  c.fillStyle = chopTok.wave; c.fillRect(fx(S) - 1, 0, 2, h); c.fillRect(fx(E) - 1, 0, 2, h);
}

/// What you hear: the rendered sound around the playhead. The engine's own
/// playing has no buffer here, so the line stays flat for it.
function chopDrawOut() {
  const { c, w, h } = chopSizeCanvas($('chopOut')), mid = h / 2, p = chop.playing;
  c.beginPath(); c.moveTo(4, mid);
  if (p?.src?.buffer && chopCtx) {
    const d = p.src.buffer.getChannelData(0), at = Math.floor((chopCtx.currentTime - p.t0) * chop.rate);
    for (let x = 4; x <= w - 4; x++) {
      const j = at + Math.floor((x - 4) / (w - 8) * 1600);
      c.lineTo(x, mid - (d[p.loop ? ((j % d.length) + d.length) % d.length : j] || 0) * h * 0.46);
    }
  } else c.lineTo(w - 4, mid);
  c.strokeStyle = p ? '#ffb547' : 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; c.stroke();
}

function chopLegend() {
  const box = $('chopLegend');
  const g = (st, a, b) => `<span class="lgw">${a}</span><i class="lgr" style="background:linear-gradient(90deg,${st.map(chopRgb).join(',')})"></i><span class="lgw">${b}</span>`;
  const d = (c, t) => `<span class="lgw"><i class="lgd" style="background:${chopRgb(c)}"></i>${t}</span>`;
  const q = chopColour;
  box.innerHTML = q === 'spectrum' ? d(CHOP_LOW, 'Low, under 250 Hz') + d(CHOP_MID, 'Mid') + d(CHOP_HIGH, 'High, over 4 kHz')
    : q === 'bright' ? g(CHOP_BRIGHT, '150 Hz', '9 kHz')
    : q === 'noise' ? g(CHOP_NOISE, 'tone', 'noise')
    : q === 'attack' ? g(CHOP_ATTACK, 'sustain', 'hit')
    : q === 'level' ? g(CHOP_LEVEL, '−48 dB', '−6 dB')
    : q === 'pitch' ? CHOP_NOTES.map((n, i) => d(chopNoteColour(60 + i), n)).join('') + d(CHOP_NO_NOTE, 'none')
    : q === 'kind' ? Object.keys(CHOP_KIND).map((k) => d(CHOP_KIND[k], `${k} ${chop.slices.filter((x) => x.m?.kind === k).length}`)).join('')
    : '<span class="lgw">The plain trace, in the Look’s colour</span>';
  document.querySelectorAll('#chopColour button').forEach((b) => b.classList.toggle('on', b.dataset.v === q));
}

// ------------------------------------------------------------- the main waveform
//
// The overlay on the detail: a wash per slice with its number, an edge you can
// drag at every cut, S / E and the ▽ cuts on a ruler along the top, the grid as
// ticks along the bottom, the threshold in Silence mode, and the playhead.

let chopLayer = null;
const CHOP_MIN_PX = 4;    // the closest two drawn cuts may sit on the lane
const CHOP_TAG_PX = 7;    // the narrowest slice that shows its number
function chopLaneFrame(clientX) {
  const r = $('chopLane').getBoundingClientRect();
  const f = chopFrameOf(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  return Math.max(0, Math.min(chop.len, f));
}

function chopPaintLane() {
  if (!chopLayer) return;
  const on = chopShown();
  chopLayer.classList.toggle('hidden', !on);
  chopLayer.classList.toggle('soft', chopSoft.on);
  chopLayer.style.setProperty('--chop-soft', String(chopSoft.alpha));
  document.body.classList.toggle('chopping', on);
  if (!on) return;
  chopDrawWave();
  chopDrawOverview();
  const pct = (f) => `${(chopXOf(f) * 100).toFixed(3)}%`;
  const { s: S, e: E } = chop.region;
  const parts = [];
  parts.push(`<div class="chop-out" style="left:0;width:${pct(S)}"></div>`,
             `<div class="chop-out" style="left:${pct(E)};right:0"></div>`);

  // The threshold, where Silence mode makes its cut.
  if (cp.mode === 'silence') {
    const amp = (Math.max(...chop.rms) || 0) * Math.pow(10, -cp.topDb / 20);
    for (const y of [50 - amp * 47, 50 + amp * 47]) parts.push(`<div class="chop-thr" style="top:${y.toFixed(2)}%"></div>`);
  }

  // The grid, while cutting on it.
  if (cp.mode === 'grid') {
    const stepF = (chopStepBeats() * 60 / chopBpm()) * chop.rate;
    const { a: from, b: to } = chopView;
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

  // Zoomed out on many slices they would be several to a pixel and bury the
  // waveform, so a slice is drawn only CHOP_MIN_PX clear of the last one drawn
  // (the current and picked ones always). Numbers sit on two staggered rows, so
  // nearly every slice can carry one. The hairlines fade further when packed.
  const laneW = $('chopLane').clientWidth || 1;
  const px = (f) => chopXOf(f) * laneW;
  const shown = chop.slices.filter((x) => x.e >= chopView.a && x.s <= chopView.b).length;
  $('chopLane').style.setProperty('--chop-dense', Math.max(0.25, Math.min(1, (laneW / Math.max(1, shown)) / 12)).toFixed(2));
  let lastPx = -Infinity;
  const lastTag = [-Infinity, -Infinity];
  chop.slices.forEach((x, i) => {
    if (x.e < chopView.a || x.s > chopView.b) return;
    const keep = i === chop.current || chop.sel.has(i);
    const at = px(x.s);
    if (!keep && at - lastPx < CHOP_MIN_PX) return;
    lastPx = at;
    const col = chopKindColour(x);
    const cls = ['chop-slice', i % 2 ? 'odd' : '', i === chop.current && 'current', chop.sel.has(i) && 'picked', x.muted && 'muted', x.rev && 'rev'].filter(Boolean).join(' ');
    const row = i % 2, text = `${i + 1}${x.rev ? '◄' : ''}`, tagW = text.length * 6 + 6;
    let tag = '';
    if (px(x.e) - at >= CHOP_TAG_PX && at >= lastTag[row] + 2) {
      lastTag[row] = at + tagW;
      tag = `<span class="chop-tag${row ? ' low' : ''}" style="background:${x.muted ? '' : keep ? 'var(--acc)' : col}">${text}</span>`;
    }
    parts.push(`<div class="${cls}" data-i="${i}" style="left:${pct(x.s)};width:calc(${pct(x.e)} - ${pct(x.s)});color:${col}">`
      + `<i class="chop-wash"></i>${tag}`
      + `<i class="chop-edge" data-i="${i}" data-side="s"></i>`
      + (chopContig() ? '' : `<i class="chop-edge end" data-i="${i}" data-side="e"></i>`)
      + '</div>');
  });

  // The ruler: bars when the tempo is known, ▽ at every cut, S and E.
  let ruler = '<div class="chop-ruler" title="Drag S or E to set what is chopped · drag between them to move it · double-click for the whole sound">';
  const bpm = chopBpm(), barF = (cp.sig * 60 / bpm) * chop.rate;
  const { a: from, b: to } = chopView;
  if ((to - from) / barF < 400) {
    for (let b = 0; S + b * barF < E; b++) {
      const at = S + b * barF;
      if (at >= from && at <= to) ruler += `<span class="chop-bar" style="left:${pct(at)}">${b + 1}</span>`;
    }
  }
  let lastCut = -Infinity;
  chop.slices.forEach((x, i) => {
    if (x.s < from || x.s > to) return;
    const at = px(x.s), keep = i === chop.current || chop.sel.has(i);
    if (!keep && at - lastCut < CHOP_MIN_PX) return;
    lastCut = at;
    ruler += `<i class="chop-cut${x.locked ? ' locked' : ''}" data-i="${i}" style="left:${pct(x.s)};color:${keep ? 'var(--acc)' : chopKindColour(x)}" title="Cut ${i + 1}${x.locked ? ' (locked)' : ''}: drag to move, drag off the ruler to delete"></i>`;
  });
  ruler += `<span class="chop-flag s" data-flag="s" style="left:${pct(S)}">S</span><span class="chop-flag e" data-flag="e" style="left:${pct(E)}">E</span>`;
  ruler += '</div>';
  parts.push(ruler);
  parts.push('<div class="chop-ph hidden"></div><div class="chop-readout hidden"></div>');
  chopLayer.innerHTML = parts.join('');
  $('chopZoomRo').textContent = `${((chopView.b - chopView.a) / chop.rate).toFixed(2)} s shown`;
  chopPaintPlay();
}

/// The playhead of what plays here, in the sound's frames.
function chopPaintPlay() {
  const ph = chopLayer?.querySelector('.chop-ph');
  if (!ph) return;
  const at = chopPlayhead();
  ph.classList.toggle('hidden', at < 0);
  if (at >= 0) ph.style.left = `${(chopXOf(at) * 100).toFixed(3)}%`;
  const ov = $('chopOverHead');
  ov.classList.toggle('hidden', at < 0);
  if (at >= 0) ov.style.left = `${(at / chop.len * 100).toFixed(3)}%`;
}

function chopReadout(x, text) {
  const el = chopLayer?.querySelector('.chop-readout');
  if (!el) return;
  el.classList.toggle('hidden', !text);
  el.textContent = text || '';
  el.style.left = `${(chopXOf(x) * 100).toFixed(3)}%`;
}

function chopWireLane() {
  const lane = $('chopLane');
  chopLayer = document.createElement('div');
  chopLayer.className = 'chop-layer hidden';
  lane.append(chopLayer);

  // The pencil works anywhere on the lane, so it is caught before anything
  // else sees the press.
  lane.addEventListener('mousedown', (e) => {
    if (!chopActive() || !chop.mono || chop.tool !== 'pencil' || e.button !== 0) return;
    if (e.target.closest('.chop-ruler')) return;
    e.stopPropagation();
    e.preventDefault();
    chopAddCut(chopLaneFrame(e.clientX));
  }, true);

  chopLayer.addEventListener('mousedown', (e) => {
    if (!chop.mono || e.button !== 0 || !chopActive()) return;
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

  const soft = $('chopSoft');
  soft.addEventListener('click', () => chopSetSoft({ on: !chopSoft.on }));
  soft.addEventListener('wheel', (e) => {
    e.preventDefault();
    chopSetSoft({ on: true, alpha: chopSoft.alpha - Math.sign(e.deltaY) * 0.05 });
  }, { passive: false });

  chopLayer.addEventListener('dblclick', (e) => {
    if (!chopActive() || !e.target.closest('.chop-ruler')) return;
    e.stopPropagation();
    chop.region = { s: 0, e: chop.len };
    chopRecut();
  });

  // The wheel zooms at the pointer; sideways, or with shift, it moves along.
  lane.addEventListener('wheel', (e) => {
    if (!chop.mono) return;
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      const L = chopView.b - chopView.a, d = (e.deltaX || e.deltaY) / lane.clientWidth * L;
      chopView.a = Math.max(0, Math.min(chop.len - L, chopView.a + d));
      chopView.b = chopView.a + L;
      chopPaintLane();
    } else chopZoom(Math.exp(e.deltaY * 0.002), chopLaneFrame(e.clientX));
  }, { passive: false });

  // Delete takes out the picked cut, on the Chop page only, and only when no
  // field has the keys.
  window.addEventListener('keydown', (e) => {
    if (!chopActive() || chop.current < 0 || !(e.key === 'Delete' || e.key === 'Backspace')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    chopDeleteCut(chop.current);
  }, true);

  // The playhead moves without saying so; looking once a frame is cheaper than
  // every caller remembering to.
  const watch = () => {
    requestAnimationFrame(watch);
    if (!chopShown()) return;
    const at = chopPlayhead();
    if (at >= 0 || chopWasPlaying) {
      chopFollow(at);
      chopPaintPlay();
      chopDrawOut();
    }
    chopWasPlaying = at >= 0;
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