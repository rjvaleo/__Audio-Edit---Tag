// ═══════════════════════════════════════════════ Chop: the controls ══
//
// The slice list, the counts, Detect's neighbours Grid, Slice and Time, the
// processing, and the settings behind them all.

// ------------------------------------------------------------- the panel

const CHOP_ROW_FLAG = { lock: 'M3 6H9V10.5H3ZM4 6V4A2 2 0 0 1 8 4V6', rev: 'M9 3L3 6L9 9Z', mute: 'M2 5H4L7 2.5V9.5L4 7H2Z' };

/// One row a slice: number, its picture, what it is, flags, start, length, peak,
/// tail and ▶. The file name is the stem and the number, so the stem goes once
/// in the panel's header and no name is ever cut off.
function chopTable() {
  const list = $('chopList');
  list.replaceChildren();
  if (!chop.mono) return;
  $('chopPattern').textContent = `${chop.stem}_####.wav`;
  const N = chop.mono.length;
  let peakAbs = 0;
  for (let i = 0; i < N; i += 64) if (Math.abs(chop.mono[i]) > peakAbs) peakAbs = Math.abs(chop.mono[i]);
  peakAbs = peakAbs || 1;

  chop.slices.forEach((x, i) => {
    const { s, e, muted, rev, locked } = x;
    const W = 28, per = (e - s) / W, col = chopKindColour(x);
    let d = '', pk = 0;
    for (let c = 0; c < W; c++) {
      let m = 0;
      const a0 = Math.floor(s + c * per);
      for (let j = a0; j < a0 + per; j += Math.max(1, Math.floor(per / 24))) m = Math.max(m, Math.abs(chop.mono[j]));
      pk = Math.max(pk, m);
      const h = Math.max(0.4, m / peakAbs * 7);
      d += `M${c * 2 + 1} ${(8 - h).toFixed(1)}V${(8 + h).toFixed(1)}`;
    }
    const pkDb = 20 * Math.log10(pk / peakAbs + 1e-10);
    const row = document.createElement('div');
    row.className = 'chop-row' + (i === chop.current ? ' current' : '') + (chop.sel.has(i) ? ' picked' : '') + (muted ? ' muted' : '');
    row.dataset.i = i;
    row.title = chopName(i);
    const flag = (name, on) => `<svg viewBox="0 0 12 12" class="${on ? 'on' : ''}"><path d="${CHOP_ROW_FLAG[name]}"/></svg>`;
    row.innerHTML = `<span class="chop-idx" style="color:${col}">${i + 1}</span>`
      + `<svg class="chop-mini" viewBox="0 0 58 16" preserveAspectRatio="none"><path d="${d}" stroke="${col}" stroke-width="1.2" fill="none" opacity=".9"/></svg>`
      + `<span class="chop-kind" style="color:${col}">${x.m?.kind || ''}</span>`
      + `<span class="chop-flags">${flag('lock', locked)}${flag('rev', rev)}${flag('mute', muted)}</span>`
      + `<span class="chop-num">${(s / chop.rate).toFixed(3)}</span>`
      + `<span class="chop-num">${((e - s) / chop.rate * 1000).toFixed(0)} ms</span>`
      + `<span class="chop-num">${pkDb.toFixed(1)}</span>`
      + '<span class="tail-badge"></span>';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'chop-play';
    play.textContent = '▶';
    play.title = 'Play this slice';
    play.onclick = (ev) => { ev.stopPropagation(); chopPlay(i); };
    row.append(play);
    row.onclick = (ev) => { chopPick(i, { add: ev.shiftKey }); chopDrawPictures(); };
    list.append(row);
  });
}

const chopName = (i) => `${chop.stem}_${String(i + 1).padStart(4, '0')}.wav`;

function chopStats() {
  if (!chop.mono) return;
  const dur = chop.len / chop.rate;
  const total = chop.slices.reduce((a, { s, e }) => a + (e - s), 0) / chop.rate;
  const avg = chop.slices.length ? total / chop.slices.length : 0;
  const set = (k, v) => { document.querySelector(`#dockChop .chop-stat[data-k="${k}"] b`).textContent = v; };
  set('clips', String(chop.slices.length));
  set('ratio', `${Math.round(total / dur * 100)}%`);
  set('avg', `${(avg * 1000).toFixed(0)} ms`);
  set('dur', `${dur.toFixed(2)} s`);
  set('pulse', chop.an ? `${Math.round(chop.an.pulse * 100)}%` : '–');
  set('hits', chop.an ? chop.an.hits.toFixed(1) : '–');
  $('chopWrite').disabled = !chop.slices.some((x) => !x.muted) || !chop.path;
  const moved = chop.slices.filter((x) => x.moved).length, locked = chop.slices.filter((x) => x.locked).length;
  $('chopEdited').textContent = [moved && `${moved} moved`, locked && `${locked} locked`].filter(Boolean).join(' · ');
  chopPaintTempo();
  chopFileInfo();
}

/// What is known about the file: what it is, and what the library's listener
/// hears in it, kept per folder in `state.heard`.
function chopFileInfo() {
  const f = state.selectedFile;
  if (!f) return;
  $('chopMeta').textContent = [f.format, f.sampleRate && `${f.sampleRate} Hz`, f.bits && `${f.bits}-bit`, f.channels && `${f.channels} ch`, `${(chop.len / chop.rate).toFixed(2)} s`].filter(Boolean).join(' · ');
  $('chopHeard').textContent = (state.heard[f.path] || []).slice(0, 2).map((w) => w.label).join(' · ');
}

/// Everything worked out from the tempo: Listen's status and the BPM in Time.
function chopPaintTempo() {
  const bpm = chopPlayBpm(), own = chopBpm(), step = chopStepBeats() * 60 / bpm;
  const divName = cp.div === 'bar' ? '1 bar' : `1/${cp.div}`;
  $('chopStatus').textContent = `${divName}${cp.feel === 'dot' ? ' dotted' : cp.feel === 'trip' ? ' triplet' : ''} · plays at ${bpm.toFixed(1)} BPM`
    + (Math.abs(bpm - own) > 0.05 ? ` (from ${own.toFixed(1)})` : '');
  $('chopStatus2').textContent = `chop every ${step.toFixed(3)} s`;
  // Under 30 or over 300, S to E is not really that many bars.
  const bad = own < 30 || own > 300;
  $('chopBpm').textContent = own.toFixed(1);
  $('chopBpmBox').classList.toggle('bad', bad);
  $('chopBpmNote').textContent = bad ? 'check Bars and Beats' : 'BPM of the sound';
  $('chopTempoSaid').textContent = chopTempoSaid.text;
}

/// The tail's badge on every row, and its summary: what each slice will get.
function chopTailUI() {
  const on = cp.tail;
  const requestedMs = cp.tailMs;
  let eligible = 0, skipped = 0;
  document.querySelectorAll('#chopList .chop-row').forEach((row) => {
    const badge = row.querySelector('.tail-badge');
    const x = chop.slices[+row.dataset.i];
    const s = x.s, e = x.s + Math.max(1, Math.round((x.e - x.s) * cp.gate / 100));
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
      badge.textContent = `↓${p.actualMs.toFixed(0)} ms`;
      badge.title = `requested ${requestedMs}ms clamped to ${p.actualMs.toFixed(0)}ms`;
      eligible++;
    } else {
      badge.className = 'tail-badge ok';
      badge.textContent = `${p.actualMs.toFixed(0)} ms`;
      badge.title = `${p.numCycles} cycles · ~${(p.numCycles * p.actualMs / 1000).toFixed(2)}s`;
      eligible++;
    }
  });
  const parts = [];
  if (on && eligible) parts.push(`${eligible} ok`);
  if (on && skipped) parts.push(`${skipped} short`);
  const cyc = $('chopCycles');
  if (cyc) cyc.textContent = on ? parts.join(' · ') : `${Math.max(2, Math.min(8, Math.ceil(500 / requestedMs)))} cycles`;
}

const CHOP_HINT = 'Drag S or E: what is chopped · between: move · double-click ruler: whole sound · drag ▽: move · off ruler: delete';
function chopSay(text) {
  const el = document.querySelector('#dockChop .chop-said');
  if (!el) return;
  el.textContent = text || CHOP_HINT;
  el.classList.toggle('hint', !text);
}

// ------------------------------------------------------------- the knobs

const chopFmt = {
  int: (v) => `${Math.round(v)}`,
  db: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  ms: (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`,
  pct: (v) => `${Math.round(v)}%`,
  hz: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`),
  st: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`,
  q: (v) => v.toFixed(2),
};

/// [key, label, min, max, step, format, log, shown when, title]
const CHOP_KNOBS = [
  ['Detect', [
    ['sens', 'Sens', 0, 100, 1, chopFmt.int, false, () => cp.mode === 'transient', 'Sensitivity: how small a hit still makes a cut'],
    ['topDb', 'Thresh', 15, 65, 1, (v) => `${Math.round(v)} dB`, false, () => cp.mode === 'silence', 'How far below the loudest moment counts as silence. Higher finds quieter sounds'],
    ['minDur', 'Min', 10, 400, 5, chopFmt.ms, false, () => cp.mode !== 'grid', 'Shorter than this, a sound is not a slice; the least room between two hits'],
    ['pad', 'Pad', 0, 50, 1, chopFmt.ms, false, () => cp.mode === 'silence', 'Room kept before and after each slice'],
  ]],
  ['Grid', [
    ['nudge', 'Nudge', -50, 50, 1, chopFmt.pct, false, () => cp.mode === 'grid', 'Shift the whole grid, by a share of a step'],
    ['shuffle', 'Shuffle', 50, 75, 1, chopFmt.pct, false, () => cp.mode === 'grid', 'MPC swing: every second grid line late. 50% straight, 66% a triplet feel'],
  ]],
  ['Slice', [
    ['gate', 'Gate', 5, 100, 1, chopFmt.pct, false, null, 'How much of each slice plays and is written'],
    ['smooth', 'Smooth', 0, 20, 0.5, chopFmt.ms, false, null, 'A fade in and out at each slice, so it does not click'],
    ['tailMs', 'Tail', 20, 200, 5, chopFmt.ms, false, null, 'A ReCycle-style ping-pong loop tail on each slice: its last moments, back and forth, fading out'],
  ]],
  ['Time', [
    ['bars', 'Bars', 1, 999, 1, chopFmt.int, true, null, 'How many bars S to E is: the tempo is worked out from it'],
    ['beats', 'Beats', 0, 15, 1, chopFmt.int, false, null, 'And how many beats more'],
    ['sig', 'Beats/bar', 2, 12, 1, (v) => `${Math.round(v)}/4`, false, null, 'Time signature'],
    ['tempo', 'Tempo', 0, 300, 0.5, (v) => (v > 0 ? `${v.toFixed(1)}` : 'orig'), false, null, 'The tempo Preview and Ratchet play at. All the way down is the sound\'s own'],
    ['pitch', 'Pitch', -24, 24, 0.1, chopFmt.st, false, null, 'Every slice up or down'],
    ['stretch', 'Stretch', 0, 100, 1, chopFmt.pct, false, null, 'Played slower, how much of the gap after each slice it fills by looping its end'],
  ]],
];

const CHOP_FX = {
  env: ['envOn', [
    ['attack', 'Attack', 0, 200, 0.5, chopFmt.ms, false, null, 'Each slice fades in over this'],
    ['decay', 'Decay', 10, 5000, 1, (v) => (v >= 5000 ? 'off' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`), true, null, 'Then dies away over this'],
  ]],
  trans: ['trOn', [
    ['trThresh', 'Thresh', -60, 0, 0.5, chopFmt.db, false, null, 'Below this, nothing is shaped'],
    ['trAmount', 'Amount', -100, 100, 1, chopFmt.pct, false, null, 'Up sharpens the hits, down softens them'],
    ['trAttack', 'Attack', 1, 100, 1, chopFmt.ms, true, null, 'How long a hit counts as a hit'],
    ['trRelease', 'Release', 10, 500, 1, chopFmt.ms, true, null, 'How long it takes to let go'],
    ['trGain', 'Gain', -24, 12, 0.5, chopFmt.db, false, null, 'Level after the shaping'],
  ]],
  eq: ['eqOn', [
    ['loCut', 'Lo cut', 15, 1000, 1, chopFmt.hz, true, null, 'Everything below goes'],
    ['lowF', 'Low', 30, 1000, 1, chopFmt.hz, true, null, 'Low band'],
    ['lowG', 'Gain', -18, 18, 0.5, chopFmt.db, false, null, 'Low band gain'],
    ['lowQ', 'Q', 0.3, 6, 0.01, chopFmt.q, true, null, 'Low band width'],
    ['highF', 'High', 1000, 16000, 10, chopFmt.hz, true, null, 'High band'],
    ['highG', 'Gain', -18, 18, 0.5, chopFmt.db, false, null, 'High band gain'],
    ['highQ', 'Q', 0.3, 6, 0.01, chopFmt.q, true, null, 'High band width'],
    ['hiCut', 'Hi cut', 2000, 20000, 10, chopFmt.hz, true, null, 'Everything above goes'],
  ]],
  filter: ['fltOn', [
    ['fltFreq', 'Freq', 30, 18000, 1, chopFmt.hz, true, null, 'The chop filter\'s frequency'],
    ['fltQ', 'Width', 0.3, 12, 0.01, chopFmt.q, true, null, 'Its resonance'],
    ['drive', 'Drive', 0, 100, 1, chopFmt.pct, false, null, 'Saturation after the filter'],
    ['gain', 'Gain', -24, 12, 0.5, chopFmt.db, false, null, 'Level after the drive'],
    ['mix', 'Mix', 0, 100, 1, chopFmt.pct, false, null, 'How much of it against the slice as it was'],
  ]],
};

const chopKnobEls = new Map();

// The pictures on the knobs: what the control does, drawn from its value.
const chopA = (d) => `<path class="a" d="${d}"/>`, chopF = (d) => `<path class="f" d="${d}"/>`;
const chopR1 = (x) => x.toFixed(1);
const CHOP_GLYPH = {
  sens: (n) => chopF('M1 14H3L4 3 6 14H8L9 8 11 14H13L14 6 16 14H18L19 10 21 14') + chopA(`M1 ${chopR1(2 + n * 11)}H21`),
  topDb: (n) => chopF('M1 8C3 2 6 2 8 8S9 8 10 8 12 2 15 2 19 8 21 8M1 8C3 14 6 14 8 8M10 8C12 14 15 14 21 8') + chopA(`M1 ${chopR1(2 + (1 - n) * 5)}H21M1 ${chopR1(14 - (1 - n) * 5)}H21`),
  minDur: (n) => { const w = 3 + n * 8; return chopA(`M${chopR1(11 - w)} 3V13M${chopR1(11 + w)} 3V13`) + chopF(`M${chopR1(11 - w)} 8H${chopR1(11 + w)}`); },
  pad: (n) => { const w = 3 + n * 6; return chopF('M8 8C9 3 13 3 14 8S9 13 8 8') + chopA(`M${chopR1(7 - w)} 3V13M${chopR1(15 + w)} 3V13`); },
  nudge: (n) => { let d = ''; for (let i = 0; i < 4; i++) d += `M${chopR1(3 + i * 5 + (n - 0.5) * 5)} 3V13`; return chopF('M1 14H21') + chopA(d); },
  shuffle: (n) => { let d = ''; for (let i = 0; i < 5; i++) d += `M${chopR1(2 + i * 4.5 + (i % 2 ? n * 4 : 0))} 3V13`; return chopA(d); },
  gate: (n) => chopA(`M2 13V4H${chopR1(2 + 18 * n)}V13`) + chopF(`M${chopR1(2 + 18 * n)} 13H20`),
  smooth: (n) => chopA(`M2 13L${chopR1(2 + n * 8)} 4H${chopR1(20 - n * 8)}L20 13`),
  tailMs: (n) => { let d = 'M2 8'; for (let i = 0; i < 6; i++) d += `L${4 + i * 3} ${chopR1(8 + (2 + n * 4) * (1 - i / 6) * (i % 2 ? 1 : -1))}`; return chopA(d); },
  bars: (n) => { const k = 1 + Math.round(n * 7), w = 20 / k; let d = ''; for (let i = 0; i <= k; i++) d += `M${chopR1(1 + i * w)} 3V13`; return chopA(d); },
  beats: (n) => { let d = ''; const k = Math.round(n * 15); for (let i = 0; i < 16; i++) { const p = `M${chopR1(2 + (i % 4) * 5.4)} ${chopR1(2 + (i >> 2) * 3.8)}h.1`; d += i < k ? chopA(p) : chopF(p); } return d; },
  sig: (n, v) => { let d = ''; const k = Math.round(v); for (let i = 0; i < k; i++) d += `M${chopR1(2 + i * (18 / Math.max(1, k - 1)))} ${i ? 7 : 3}V13`; return chopA(d); },
  tempo: (n) => { const t = -0.9 + n * 1.8; return chopF('M6 14L9 2H13L16 14Z') + chopA(`M11 14L${chopR1(11 + Math.sin(t) * 9)} ${chopR1(14 - Math.cos(t) * 11)}`); },
  pitch: (n) => { const y = 14 - n * 12; return chopF('M1 8H21') + chopA(`M2 8C8 8 8 ${chopR1(y)} 13 ${chopR1(y)}H20`); },
  stretch: (n) => chopA('M2 8H8') + chopA(`M8 8${[0, 1, 2, 3].map((i) => `L${chopR1(8 + (i + 1) * (n * 3 + 0.4))} ${i % 2 ? 5 : 11}`).join('')}`) + chopF('M2 13H20'),
};
const CHOP_FACET = { bars: 'time', beats: 'time', sig: 'time', tempo: 'time', stretch: 'time', minDur: 'time', pad: 'time', nudge: 'time', shuffle: 'time', gate: 'time', smooth: 'time', tailMs: 'time', pitch: 'pitch', sens: 'attack', topDb: 'attack' };

/// One of Detect, Grid, Slice or Time's knobs, with its picture.
function chopKnob([key, label, min, max, step, fmt, log, , title]) {
  const norm = (v) => Math.min(1, Math.max(0, log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)));
  let paint = () => {};
  const el = knob(label, cp[key], min, max, step, fmt,
    (v) => { chopSetting(key, v, { live: true }); paint(v); },
    (v) => chopSetting(key, v),
    log, CHOP_DEF[key]);
  el.dataset.k = key;
  el.classList.add('chop-knob');
  el.title = `${title} — double-click to reset to ${fmt(CHOP_DEF[key])}`;
  el.style.setProperty('--gg', `var(--f-${CHOP_FACET[key]})`);
  el.insertAdjacentHTML('afterbegin', '<svg class="gl" viewBox="0 0 22 16"></svg>');
  const glyph = el.firstElementChild;
  paint = (v) => { glyph.innerHTML = CHOP_GLYPH[key](norm(v), v); };
  const sync = el.sync;
  el.sync = (v) => { sync(v); paint(v); };
  paint(cp[key]);
  chopKnobEls.set(key, el);
  return el;
}

const CHOP_PWR = '<svg viewBox="0 0 12 12"><path d="M6 2V6M3.3 3.4a4 4 0 1 0 5.4 0"/></svg>';

function chopGroup(name, g, width, head, body) {
  const m = document.createElement('div');
  m.className = 'chop-group chop-mod';
  m.dataset.g = g;
  m.style.width = `${width}px`;
  m.innerHTML = `<div class="chop-mh"><b class="chop-gname">${name}</b>${head}</div>`;
  body.forEach((n) => m.append(n));
  return m;
}

function chopBuildKnobs() {
  const box = $('chopKnobs');
  box.replaceChildren();
  const spec = (k) => CHOP_KNOBS.flatMap(([, s]) => s).find((s) => s[0] === k);
  const grid = (keys, cols) => {
    const g = document.createElement('div');
    g.className = 'chop-kgrid';
    g.style.setProperty('--c', cols);
    for (const k of keys) {
      const s = spec(k), el = chopKnob(s);
      if (s[7]) el.dataset.when = '1';
      g.append(el);
    }
    return g;
  };
  const detect = chopGroup('DETECT', 'detect', 260, '<span class="chop-grow"></span>', [grid(['sens', 'topDb', 'minDur', 'pad'], 4)]);
  const redo = $('chopRedetect');
  detect.querySelector('.chop-mh').append(redo);
  const slice = chopGroup('SLICE', 'slice', 200, '<span class="chop-grow"></span>', [grid(['gate', 'smooth', 'tailMs'], 3)]);
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'chop-pwr chop-on chop-tail-on';
  t.title = 'The ping-pong tail on or off';
  t.innerHTML = `${CHOP_PWR}<span>Tail</span>`;
  t.onclick = () => chopSetting('tail', !cp.tail);
  const cyc = document.createElement('span');
  cyc.className = 'chop-cycles';
  cyc.id = 'chopCycles';
  slice.querySelector('.chop-mh').append(t, cyc);
  const time = chopGroup('TIME', 'time', 476, '<span class="chop-said-t" id="chopTempoSaid"></span><span class="chop-grow"></span>', []);
  const left = grid(['bars', 'beats', 'sig'], 3), right = grid(['tempo', 'pitch', 'stretch'], 3);
  const bpm = document.createElement('div');
  bpm.className = 'chop-well chop-bpm';
  bpm.id = 'chopBpmBox';
  bpm.title = 'S to E is this many bars and beats, so this is its tempo';
  bpm.innerHTML = '<b id="chopBpm">120.0</b><span id="chopBpmNote">BPM of the sound</span>';
  const row = document.createElement('div');
  row.className = 'chop-time-row';
  row.append(left, bpm, right);
  time.append(row);
  const button = (id, cls, label, title, on) => {
    const b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = cls; b.title = title; b.innerHTML = label; b.onclick = on;
    return b;
  };
  time.querySelector('.chop-mh').append(
    button('chopDetect', 'chop-btn', '<svg viewBox="0 0 12 12"><path d="M1 9L3 3 5 9 7 5 9 9 11 6"/></svg>Detect', 'Find the tempo and count the bars from S to E. Sets Bars and Beats. Runs by itself when a sound opens', chopDetect),
    button('chopHalf', 'chop-btn', '½×', 'It heard double time: half as many beats', () => chopScaleBars(0.5)),
    button('chopDouble', 'chop-btn', '2×', 'It heard half time: twice as many beats', () => chopScaleBars(2)));
  box.append(detect, chopGroup('GRID', 'grid', 140, '', [grid(['nudge', 'shuffle'], 2)]), slice, time);
  chopBuildFx();
}

/// The processing every slice gets, each kind in line with the others under its
/// own heading and On (RJ, 5 Nov 2026: "display each one of those right in
/// line there … that title as the headline"). Knobs, each over its slider, and
/// the slider's own picture of what the control does (`FXP.PIC`).
const CHOP_FX_NAMES = { env: 'Envelope', trans: 'Transient', eq: 'EQ', filter: 'Filter' };
const CHOP_FX_LOOK = {
  attack: ['attack', 'attack'], decay: ['release', 'attack'],
  trThresh: ['threshold', 'attack'], trAmount: ['depth', 'attack'], trAttack: ['attack', 'attack'],
  trRelease: ['release', 'attack'], trGain: ['level', 'level'],
  loCut: ['highpass', 'tone'], lowF: ['freq', 'tone'], lowG: ['level', 'level'], lowQ: ['q', 'tone'],
  highF: ['freq', 'tone'], highG: ['level', 'level'], highQ: ['q', 'tone'], hiCut: ['lowpass', 'tone'],
  fltFreq: ['lowpass', 'tone'], fltQ: ['q', 'tone'], drive: ['drive', 'tone'], gain: ['level', 'level'], mix: ['mix', 'level'],
};
/// Which knobs each module has, in the order they read, and its size.
const CHOP_FX_LAYOUT = {
  env: { keys: ['attack', 'decay'], cols: 1, width: 300, pic: 'chopPicEnv' },
  trans: { keys: ['trThresh', 'trAmount', 'trGain', 'trAttack', 'trRelease'], cols: 3, width: 336, pic: 'chopPicTr' },
  eq: { keys: ['loCut', 'lowF', 'lowG', 'lowQ', 'hiCut', 'highF', 'highG', 'highQ'], cols: 4, width: 396, pic: 'chopPicEq' },
  filter: { keys: ['fltFreq', 'fltQ', 'mix', 'drive', 'gain'], cols: 3, width: 352, pic: 'chopPicFlt' },
};

/// The filter's frequency is drawn as the filter it is.
const chopFxPic = (key) => (key === 'fltFreq' ? { lp: 'lowpass', bp: 'freq', hp: 'highpass' }[cp.fltType] || 'lowpass' : CHOP_FX_LOOK[key][0]);

/// A `param`, so the control stays what it was (keyboard, reset, its slider for
/// anything that reads one), under a knob that drives that slider.
function chopBar([key, label, min, max, step, fmt, log, , title]) {
  let paint = () => {};
  const el = param(label, cp[key], min, max, step, fmt,
    (v) => { chopSetting(key, v, { live: true }); paint(); },
    (v) => chopSetting(key, v),
    log, CHOP_DEF[key]);
  const input = el.querySelector(':scope > input[type=range]');
  el.dataset.k = key;
  el.classList.add('gk-row', 'chop-fx-bar');
  el.title = `${title} — double-click to reset to ${fmt(CHOP_DEF[key])}`;
  el.style.setProperty('--fc', `var(--f-${CHOP_FX_LOOK[key][1]})`);
  el.insertAdjacentHTML('afterbegin', FXP.svg('', 'gg'));
  const glyph = el.firstElementChild;
  const p = { key, label, min, max, log };
  paint = () => {
    const v = el.read();
    const n = log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
    glyph.innerHTML = FXP.noText(FXP.PIC[chopFxPic(key)](Math.min(1, Math.max(0, n)), v, p));
  };
  const face = knob(label, cp[key], min, max, step, fmt,
    (v) => { sync(v); input.dispatchEvent(new Event('input', { bubbles: true })); },
    (v) => { sync(v); input.dispatchEvent(new Event('change', { bubbles: true })); },
    log, CHOP_DEF[key]);
  face.classList.add('chop-face');
  const sync = el.sync;
  el.sync = (v) => { sync(v); face.sync(v); paint(); };
  el.append(face);
  chopKnobEls.set(key, el);
  paint();
  return el;
}

function chopBuildFx() {
  const box = $('chopFx');
  box.replaceChildren();
  for (const [fx, [onKey, specs]] of Object.entries(CHOP_FX)) {
    const { keys, cols, width, pic } = CHOP_FX_LAYOUT[fx];
    const sec = document.createElement('section');
    sec.className = 'chop-fxs chop-mod';
    sec.dataset.fx = fx;
    sec.style.width = `${width}px`;
    sec.innerHTML = `<div class="chop-fxs-head chop-mh"><button type="button" class="chop-pwr chop-on chop-fxs-on" title="${CHOP_FX_NAMES[fx]} on or off">${CHOP_PWR}<span class="sr">Off</span></button>`
      + `<b class="chop-fxs-name chop-gname">${CHOP_FX_NAMES[fx]}</b><span class="chop-grow"></span></div>`
      + `<div class="chop-fxs-row"><div class="chop-fxs-body chop-kgrid" style="--c:${cols}"></div><div class="chop-well chop-pic"><canvas id="${pic}" data-w="${{ env: 214, trans: 130, eq: 130, filter: 146 }[fx]}" data-h="118"></canvas></div></div>`;
    sec.querySelector('.chop-fxs-on').onclick = () => chopSetting(onKey, !cp[onKey]);
    const body = sec.querySelector('.chop-fxs-body');
    if (fx === 'filter') {
      const pills = document.createElement('span');
      pills.className = 'chop-pills chop-seg sm chop-flt-type';
      pills.title = 'Low-pass, band-pass or high-pass';
      for (const [v, t] of [['lp', 'LP'], ['bp', 'BP'], ['hp', 'HP']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.v = v;
        b.textContent = t;
        b.onclick = () => chopSetting('fltType', v);
        pills.append(b);
      }
      sec.querySelector('.chop-mh').append(pills);
    }
    const bySpec = new Map(specs.map((s) => [s[0], s]));
    for (const k of keys) body.append(chopBar(bySpec.get(k)));
    box.append(sec);
  }
}

/// Every pill and knob from `cp`, after A/B, a preset, Init or the dice.
function chopReflect() {
  for (const [id, key] of [['chopMode', 'mode'], ['chopDiv', 'div'], ['chopFeel', 'feel'], ['chopSync', 'sync'], ['chopTools', null]]) {
    const v = key ? cp[key] : chop.tool;
    $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  }
  for (const [fx, [onKey]] of Object.entries(CHOP_FX)) {
    const sec = document.querySelector(`#chopFx .chop-fxs[data-fx="${fx}"]`);
    if (!sec) continue;
    sec.classList.toggle('on', !!cp[onKey]);
    sec.classList.toggle('off', !cp[onKey]);
    const b = sec.querySelector('.chop-fxs-on');
    b.querySelector('.sr').textContent = cp[onKey] ? 'On' : 'Off';
    b.classList.toggle('on', !!cp[onKey]);
  }
  document.querySelectorAll('#chopFx .chop-flt-type button').forEach((b) => b.classList.toggle('on', b.dataset.v === cp.fltType));
  for (const [key, el] of chopKnobEls) if (el.isConnected) el.sync(cp[key]);
  // Nothing hides: a knob that makes no cuts in this mode dims, and still works.
  for (const [, specs] of CHOP_KNOBS) for (const s of specs) chopKnobEls.get(s[0])?.classList.toggle('dim', !!s[7] && !s[7]());
  $('chopDiv').classList.toggle('dim', cp.mode !== 'grid');
  $('chopFeel').classList.toggle('dim', cp.mode !== 'grid');
  document.querySelector('#chopKnobs .chop-tail-on')?.classList.toggle('on', cp.tail);
  chopKnobEls.get('tailMs')?.classList.toggle('dim', !cp.tail);
  chopPb?.mark();
  $('chopOutMidi').classList.toggle('on', cp.outMidi);
  $('chopOutSfz').classList.toggle('on', cp.outSfz);
  $('chopRatchet').classList.toggle('on', chop.playing?.kind === 'ratchet');
  $('chopPreview').classList.toggle('on', chop.playing?.kind === 'preview');
  $('chopSoft').classList.toggle('on', chopSoft.on);
  $('chopSoft').textContent = `◐ ${chopSoft.on ? `${Math.round(chopSoft.alpha * 100)}%` : 'soften'}`;
  if (chop.mono) { chopPaintTempo(); chopDrawPictures(); }
}

let chopSaveTimer = null;
/// One setting changed. A setting the cut depends on cuts again; the rest only
/// change what the slices sound like, and the summaries.
function chopSetting(key, v, { live = false } = {}) {
  cp[key] = v;
  clearTimeout(chopSaveTimer);
  chopSaveTimer = setTimeout(chopSaveSettings, live ? 400 : 0);
  if (CHOP_RECUT.has(key)) chopRecut();
  else { chopStats(); chopTailUI(); chopPaintLane(); chopDrawPictures(); }
  if (!live) chopReflect();
  else if (key === 'mode') chopReflect();
}

/// All of `cp` at once, from a preset, Init or the dice.
function chopApply(values) {
  Object.assign(cp, { ...CHOP_DEF, ...values });
  chopSaveSettings();
  chopReflect();
  chopRecut();
}

/// The dice: new settings for the cutting and the sound, none of them silly.
function chopDice() {
  const r = (a, b) => a + Math.random() * (b - a);
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  chopApply({
    ...cp,
    sens: Math.round(r(35, 90)), div: pick(['4', '8', '8', '16', '16', '32']), feel: pick(['straight', 'straight', 'dot', 'trip']),
    nudge: 0, shuffle: Math.round(pick([50, 50, r(52, 66)])), gate: Math.round(pick([100, r(40, 100)])),
    smooth: Math.round(r(0, 6) * 2) / 2, pitch: pick([0, 0, -12, -5, 5, 7, 12]),
    fltOn: Math.random() < 0.5, fltType: pick(['lp', 'bp', 'hp']), fltFreq: Math.round(Math.exp(r(Math.log(200), Math.log(8000)))),
    fltQ: +r(0.5, 6).toFixed(2), drive: Math.round(pick([0, r(0, 60)])),
  });
}
