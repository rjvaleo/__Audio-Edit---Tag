// ============================================================ HyperStretch

/* Hyperprism's XY pad, read from Hyperprism-PPC 1.2.1's code, playing the
   granular engine's own Stretch and Pitch. Opened from the rail as Prism: the
   Grain dock with its HyperStretch panel out, as Chop is. See
   `docs/HYPERSTRETCH.md`.

   Exact to the original:
   - the pad is 461 × 241, and linear between the limits in its corners;
   - grabbing it is the record button, and a take runs until Stop or Play;
   - a take is at most a point per tick (1/60.15 s), played back stepped,
     looping at its own length;
   - Shift locks a drag horizontal, vertical or to a diagonal; arrows draw while
     recording, Option ×10;
   - a new limit rescales the takes so every point keeps its value;
   - the readout shows the values under the pointer, touched or not;
   - Smoothing is the engine's (`glide.rs`): the pad steps, the sound glides.

   New, and off unless chosen: four takes, a take's rate and direction, throw,
   loop on release, and drawn shapes. */

const HS_W = 461, HS_H = 241, HS_TICK = 1000 / 60.15;

/// What each axis can drive: the Time & Pitch controls, as the Prism pad's
/// Time & Pitch source has them, with Hyperprism's default window.
const HS_AXES = {
  ratio: { label: 'Stretch', lo: 4, hi: 0.25, fmt: (v) => `×${v.toFixed(2)}` },
  semitones: { label: 'Pitch', lo: -12, hi: 12, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} st` },
  windowMs: { label: 'Window', lo: 20, hi: 400, fmt: (v) => `${Math.round(v)} ms` },
  cloudMix: { label: 'Cloud', lo: 0, hi: 1, fmt: (v) => `${Math.round(v * 100)} %` },
};
/// The two the engine glides, sent straight to it as a take plays.
const HS_FAST = new Set(['ratio', 'semitones']);

const hs = {
  built: false, shown: false,
  axes: { x: 'ratio', y: 'semitones' },
  lim: { xLo: 4, xHi: 0.25, yLo: -12, yHi: 12 },
  hand: { x: 0.5, y: 0.5 },
  mode: 'ready',            // ready · rec · play · pause
  slot: 0, slots: [null, null, null, null],
  rec: null, recT0: 0, lastTick: -1,
  t0: 0, pauseAt: 0, rate: 1, dir: 'fwd',
  glide: 50, throwOn: false, loopOnRelease: false,
  down: false, hover: null, vel: { x: 0, y: 0 }, prev: null, anchor: null,
  raf: 0, last: 0, sent: null,
};

const hsClamp = (v) => Math.max(0, Math.min(1, v));

/// The one-pole coefficient Hyperprism's Smoothing (%) stands for.
function hsCoef(s) {
  return Math.floor(Math.pow(10, 0.04 * (100 - s)) + 1e-9) * 0.0001;
}

function hsValueX(x) { return hs.lim.xLo + x * (hs.lim.xHi - hs.lim.xLo); }
function hsValueY(y) { return hs.lim.yLo + (1 - y) * (hs.lim.yHi - hs.lim.yLo); }

// ------------------------------------------------------------- the panel

function hsBuild() {
  const host = $('dockHyper');
  if (!host || hs.built) return;
  hs.built = true;
  try {
    const kept = JSON.parse(localStorage.getItem('hyperstretch.settings') || '{}');
    for (const k of ['glide', 'throwOn', 'loopOnRelease', 'rate', 'dir']) if (k in kept) hs[k] = kept[k];
  } catch { /* first use */ }
  const options = (sel) => Object.entries(HS_AXES).map(([k, a]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${a.label}</option>`).join('');
  host.innerHTML = `
    <div class="hs-head">
      <span class="hs-title">HYPERSTRETCH</span>
      <label class="hs-lbl">X <select id="hsX" class="mini">${options(hs.axes.x)}</select></label>
      <label class="hs-lbl">Y <select id="hsY" class="mini">${options(hs.axes.y)}</select></label>
      <span class="hs-vsep"></span>
      <div class="hs-transport" role="group" aria-label="HyperStretch transport">
        <button type="button" class="hs-btn" id="hsRec" aria-label="Record" title="Record — or just grab the pad">●</button>
        <button type="button" class="hs-btn" id="hsPlay" aria-label="Play the take" title="Play the take, looping at its own length">▶</button>
        <button type="button" class="hs-btn" id="hsPause" aria-label="Pause" title="Pause the take">❚❚</button>
        <button type="button" class="hs-btn" id="hsStop" aria-label="Stop" title="Stop: ends a take">■</button>
        <button type="button" class="hs-btn" id="hsRewind" aria-label="Rewind" title="Back to the take's first point">⏮</button>
      </div>
      <span class="hs-chip mono" id="hsChip"></span>
      <span class="hs-fill"></span>
      <span class="hs-dim">engine now</span><span class="mono" id="hsNow"></span>
    </div>
    <div class="hs-body">
      <div class="hs-stage">
        <div class="hs-top"><input id="hsXLo" class="hs-lim mono" aria-label="X low limit"><span id="hsXName" class="hs-axis"></span><input id="hsXHi" class="hs-lim mono" aria-label="X high limit"></div>
        <div class="hs-mid">
          <div class="hs-left"><input id="hsYHi" class="hs-lim mono" aria-label="Y high limit"><span id="hsYName" class="hs-axis hs-vert"></span><input id="hsYLo" class="hs-lim mono" aria-label="Y low limit"></div>
          <button type="button" class="hs-pad" id="hsPad" aria-label="HyperStretch pad: grab to record, Shift to lock, arrows to draw while recording">
            <svg class="hs-svg" width="${HS_W}" height="${HS_H}" viewBox="0 0 ${HS_W} ${HS_H}" aria-hidden="true">
              <path class="hs-grid" d="M115.25 0V241M230.5 0V241M345.75 0V241M0 120.5H461"/>
              <polyline id="hsPath" class="hs-path" points=""/>
              <circle id="hsGhost" class="hs-ghost" r="9"/>
              <path id="hsCross" class="hs-cross" d=""/>
              <circle id="hsBall" class="hs-ball" r="4.5"/>
            </svg>
            <span class="hs-read mono hidden" id="hsRead"></span>
          </button>
        </div>
        <div class="hs-foot"><span class="mono" id="hsInfo"></span><span class="hs-fill"></span><span>Shift: lock H · V · 45°</span><span>←↑→↓ draw while recording, ⌥ ×10</span></div>
      </div>
      <div class="hs-banks">
        <section class="hs-bank" aria-label="Glide">
          <div class="hs-h">GLIDE <span>Hyperprism Smoothing</span></div>
          <label class="hs-row">Smoothing <input type="range" id="hsGlide" min="0" max="100" step="1"></label>
          <div class="hs-kv"><span>setting</span><span class="mono" id="hsGlideV"></span><span>coefficient</span><span class="mono" id="hsCoef"></span>
            <span>catch-up</span><span class="mono" id="hsTau"></span><span>step</span><span class="mono">512 samples</span></div>
          <div class="hs-dim">ball = your hand · ring = what the engine plays</div>
        </section>
        <section class="hs-bank" aria-label="Gestures">
          <div class="hs-h">GESTURES <span>each loops at its own length</span></div>
          <div class="hs-slots">${[0, 1, 2, 3].map((i) => `<button type="button" class="hs-slot" data-slot="${i}" aria-label="Take ${'ABCD'[i]}">
            <span class="hs-slot-top"><b>${'ABCD'[i]}</b><span class="mono hs-dim" data-len></span></span>
            <svg width="54" height="28" viewBox="0 0 ${HS_W} ${HS_H}" preserveAspectRatio="none" aria-hidden="true"><polyline data-thumb points=""/></svg></button>`).join('')}</div>
          <div class="hs-row">rate <span class="hs-seg">${[[0.5, '×½'], [1, '×1'], [2, '×2']].map(([v, l]) => `<button type="button" data-hsrate="${v}">${l}</button>`).join('')}</span>
            <span class="hs-seg">${[['fwd', '→', 'Forwards'], ['rev', '←', 'Backwards'], ['pp', '⇄', 'Back and forth']].map(([v, l, t]) => `<button type="button" data-hsdir="${v}" aria-label="${t}" title="${t}">${l}</button>`).join('')}</span></div>
        </section>
        <section class="hs-bank" aria-label="Motion">
          <div class="hs-h">MOTION</div>
          <label class="hs-row"><input type="checkbox" id="hsThrow"> Throw — let go mid-move and it keeps drifting</label>
          <label class="hs-row"><input type="checkbox" id="hsLoopRelease"> Loop on release (Hyperprism records until Stop)</label>
          <div class="hs-dim">draw a gesture into the take</div>
          <div class="hs-shapes">${[['circle', 'Circle'], ['eight', 'Figure 8'], ['liss', 'Lissajous'], ['drift', 'Drift']].map(([k, l]) => `<button type="button" class="hs-btn" data-hsshape="${k}">${l}</button>`).join('')}</div>
        </section>
      </div>
    </div>`;
  hsWire();
  hsLimitsOut();
  hsLoadTakes();
  hsPaint();
}

function hsWire() {
  const pad = $('hsPad');
  const frac = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: hsClamp((e.clientX - r.left) / r.width), y: hsClamp((e.clientY - r.top) / r.height) };
  };
  pad.addEventListener('pointerdown', (e) => {
    if (hs.mode === 'pause') return;
    e.preventDefault();
    pad.setPointerCapture?.(e.pointerId);
    pad.focus();
    const p = frac(e), t = performance.now();
    hs.anchor = null;
    hs.prev = { p, t };
    hs.down = true;
    hs.vel = { x: 0, y: 0 };
    // RequestRecord: the click is the value and the record button at once.
    if (hs.mode !== 'rec') hsStartRec(t);
    hsMoveTo(p, t);
  });
  pad.addEventListener('pointermove', (e) => {
    const raw = frac(e);
    hs.hover = raw;
    if (!hs.down) { hsPaint(); return; }
    const p = hsLock(raw, e.shiftKey), t = performance.now();
    const dt = Math.max(1, t - hs.prev.t);
    hs.vel = { x: (p.x - hs.prev.p.x) / dt, y: (p.y - hs.prev.p.y) / dt };
    hs.prev = { p, t };
    hsMoveTo(p, t);
  });
  const release = () => {
    if (!hs.down) return;
    hs.down = false;
    const t = performance.now();
    const thrown = hs.throwOn && t - hs.prev.t < 60 && Math.hypot(hs.vel.x, hs.vel.y) > 1e-5;
    if (!thrown) hs.vel = { x: 0, y: 0 };
    if (hs.loopOnRelease && hs.mode === 'rec' && !thrown) { hsStopRec(t); hsPlay(t); }
    hsCommit();
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('pointerleave', () => { if (!hs.down) { hs.hover = null; hsPaint(); } });
  pad.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    // NudgeCurrentPoint: only while recording, 1 px or 10 with Option.
    if (hs.mode !== 'rec') return;
    const step = e.altKey ? 10 : 1;
    hsMoveTo({ x: hsClamp(hs.hand.x + d[0] * step / HS_W), y: hsClamp(hs.hand.y + d[1] * step / HS_H) }, performance.now());
  });

  $('hsRec').onclick = () => { if (hs.mode !== 'rec') { hsStartRec(performance.now()); hsAddPoint(hs.hand, performance.now()); hsPaint(); } };
  $('hsPlay').onclick = () => {
    const t = performance.now();
    if (hs.mode === 'pause') { hs.t0 += t - hs.pauseAt; hs.mode = 'play'; hsPaint(); return; }
    if (hs.mode === 'rec') hsStopRec(t);
    hsPlay(t);
  };
  $('hsPause').onclick = () => {
    const t = performance.now();
    if (hs.mode === 'play') { hs.mode = 'pause'; hs.pauseAt = t; }
    else if (hs.mode === 'pause') { hs.t0 += t - hs.pauseAt; hs.mode = 'play'; }
    hsPaint();
  };
  $('hsStop').onclick = () => {
    const t = performance.now();
    if (hs.mode === 'rec') hsStopRec(t);
    hs.mode = 'ready';
    hs.vel = { x: 0, y: 0 };
    hsCommit();
    hsPaint();
  };
  $('hsRewind').onclick = () => {
    hs.t0 = performance.now();
    const take = hs.slots[hs.slot];
    if (take?.pts.length) hsMoveTo({ x: take.pts[0].x, y: take.pts[0].y }, hs.t0, { record: false });
  };

  for (const [id, field] of [['hsXLo', 'xLo'], ['hsXHi', 'xHi'], ['hsYLo', 'yLo'], ['hsYHi', 'yHi']]) {
    $(id).addEventListener('change', (e) => hsSetLimit(field, e.target.value));
  }
  $('hsX').onchange = (e) => hsSetAxis('x', e.target.value);
  $('hsY').onchange = (e) => hsSetAxis('y', e.target.value);
  $('hsGlide').addEventListener('input', (e) => { hs.glide = +e.target.value; hsKeep(); hsSendGlide(); hsPaint(); });
  $('hsThrow').onchange = (e) => { hs.throwOn = e.target.checked; hsKeep(); };
  $('hsLoopRelease').onchange = (e) => { hs.loopOnRelease = e.target.checked; hsKeep(); };
  $('dockHyper').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.slot != null) hsPickSlot(+b.dataset.slot);
    else if (b.dataset.hsrate) { hs.rate = +b.dataset.hsrate; hsKeep(); hsPaint(); }
    else if (b.dataset.hsdir) { hs.dir = b.dataset.hsdir; hsKeep(); hsPaint(); }
    else if (b.dataset.hsshape) hsShape(b.dataset.hsshape);
  });
}

function hsKeep() {
  try {
    localStorage.setItem('hyperstretch.settings', JSON.stringify({ glide: hs.glide, throwOn: hs.throwOn, loopOnRelease: hs.loopOnRelease, rate: hs.rate, dir: hs.dir }));
  } catch { /* private mode */ }
}

// ------------------------------------------------------------- moving

/// The pad is at `p`: both controls take its values, and a take in progress
/// gets a point.
function hsMoveTo(p, t, { record = true } = {}) {
  hs.hand = { x: p.x, y: p.y };
  if (record && hs.mode === 'rec') hsAddPoint(p, t);
  hsApply();
  hsPaint();
}

/// Both controls to where the pad is, the way their own sliders would move
/// them: the two the engine glides straight to it, the others by the panel's
/// live path.
function hsApply() {
  const d = state.stretchDraft;
  if (!d) return;
  const vals = { [hs.axes.x]: hsValueX(hs.hand.x), [hs.axes.y]: hsValueY(hs.hand.y) };
  let slow = false;
  for (const [k, v] of Object.entries(vals)) {
    d[k] = v;
    state.stretchRows?.[k]?.sync?.(v);
    if (!HS_FAST.has(k)) slow = true;
  }
  const fast = {};
  for (const k of Object.keys(vals)) if (HS_FAST.has(k)) fast[k] = vals[k];
  if (Object.keys(fast).length) hsSendFast(fast);
  if (slow) previewStretch();
}

/// At most one request in flight; the newest values win.
function hsSendFast(vals) {
  hs.pending = { ...(hs.pending || {}), ...vals };
  if (hs.inFlight) return;
  const go = () => {
    const body = hs.pending;
    hs.pending = null;
    if (!body) { hs.inFlight = false; return; }
    hs.inFlight = true;
    fetch('/api/engine/pad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .catch(() => {}).finally(go);
  };
  go();
}

/// What the pad has done, kept in the document, as a released slider is.
function hsCommit() {
  if (typeof commitStretch === 'function') commitStretch();
}

function hsSendGlide(v = hs.glide) {
  if (hs.sent === v) return;
  hs.sent = v;
  postJSON('/api/engine/glide', { smoothing: v }).catch(() => {});
}

/// TrackHotSpot's Shift lock, in pad pixels: anchored where Shift went down;
/// the first move decides horizontal, vertical or one of the diagonals.
function hsLock(p, shift) {
  if (!shift) { hs.anchor = null; return p; }
  if (!hs.anchor) hs.anchor = { x: hs.hand.x, y: hs.hand.y, mode: null };
  const a = hs.anchor, dh = (p.x - a.x) * HS_W, dv = (p.y - a.y) * HS_H;
  if (!a.mode && (Math.abs(dh) >= 1 || Math.abs(dv) >= 1)) {
    if (Math.abs(Math.abs(dh) - Math.abs(dv)) < 1) a.mode = Math.sign(dh) === Math.sign(dv) ? 'diag' : 'anti';
    else a.mode = Math.abs(dh) > Math.abs(dv) ? 'h' : 'v';
  }
  if (a.mode === 'h') return { x: p.x, y: a.y };
  if (a.mode === 'v') return { x: a.x, y: p.y };
  if (a.mode === 'diag') return { x: hsClamp(a.x + dv / HS_W), y: p.y };
  if (a.mode === 'anti') return { x: hsClamp(a.x - dv / HS_W), y: p.y };
  return p;
}

// ------------------------------------------------------------- takes

function hsStartRec(t) {
  hs.rec = [];
  hs.recT0 = t;
  hs.lastTick = -1;
  hs.mode = 'rec';
  hsSendGlide();
  // Hyperprism's Record lit Play too: the sound plays while you draw.
  if (typeof engine !== 'undefined' && !engine.playing && typeof startPlayback === 'function') {
    try { startPlayback(); } catch { /* no device: the take is still a take */ }
  }
}

/// AddPoint: at most one a tick, on the tick grid.
function hsAddPoint(p, t) {
  if (!hs.rec) return;
  const tick = Math.floor((t - hs.recT0) / HS_TICK);
  if (tick === hs.lastTick) return;
  hs.lastTick = tick;
  hs.rec.push({ x: p.x, y: p.y, t: tick * HS_TICK });
}

function hsStopRec(t) {
  if (!hs.rec) return;
  if (hs.rec.length) hs.slots[hs.slot] = { pts: hs.rec, dur: Math.max(HS_TICK, t - hs.recT0) };
  hs.rec = null;
  hs.mode = 'ready';
  hsSaveTakes();
}

function hsPlay(t) {
  const take = hs.slots[hs.slot];
  if (!take?.pts.length) { hs.mode = 'ready'; hsPaint(); return; }
  hs.mode = 'play';
  hs.t0 = t;
  hsSendGlide();
  if (typeof engine !== 'undefined' && !engine.playing && typeof startPlayback === 'function') {
    try { startPlayback(); } catch { /* no device */ }
  }
  hsPaint();
}

function hsPickSlot(i) {
  const t = performance.now();
  if (hs.mode === 'rec') hsStopRec(t);
  hs.slot = i;
  if (hs.mode === 'play' && !hs.slots[i]) hs.mode = 'ready';
  hsPaint();
}

function hsShape(kind) {
  const dur = 4000, n = Math.floor(dur / HS_TICK), pts = [];
  let rx = hs.hand.x, ry = hs.hand.y, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let x, y;
    if (kind === 'circle') { x = 0.5 + 0.35 * Math.cos(a); y = 0.5 + 0.38 * Math.sin(a); }
    else if (kind === 'eight') { x = 0.5 + 0.38 * Math.sin(a); y = 0.5 + 0.36 * Math.sin(2 * a); }
    else if (kind === 'liss') { x = 0.5 + 0.4 * Math.sin(3 * a); y = 0.5 + 0.4 * Math.sin(2 * a + 0.6); }
    else {
      vx = vx * 0.96 + (Math.random() - 0.5) * 0.004;
      vy = vy * 0.96 + (Math.random() - 0.5) * 0.004;
      rx = hsClamp(rx + vx); ry = hsClamp(ry + vy); x = rx; y = ry;
    }
    pts.push({ x: hsClamp(x), y: hsClamp(y), t: i * HS_TICK });
  }
  if (hs.mode === 'rec') hs.rec = null;
  hs.slots[hs.slot] = { pts, dur };
  hsSaveTakes();
  hsPlay(performance.now());
}

/// The takes belong to the sound, as Hyperprism's paths belonged to its file.
function hsKey() {
  return `hyperstretch:${state.selectedFile?.path || ''}`;
}

function hsSaveTakes() {
  try { localStorage.setItem(hsKey(), JSON.stringify({ lim: hs.lim, axes: hs.axes, slots: hs.slots })); } catch { /* full or private */ }
}

function hsLoadTakes() {
  hs.slots = [null, null, null, null];
  try {
    const kept = JSON.parse(localStorage.getItem(hsKey()) || 'null');
    if (kept?.slots) {
      hs.slots = kept.slots.slice(0, 4).concat([null, null, null, null]).slice(0, 4);
      if (kept.lim) hs.lim = kept.lim;
      if (kept.axes) hs.axes = kept.axes;
    }
  } catch { /* nothing kept */ }
  hsLimitsOut();
}

// ------------------------------------------------------------- limits

/// SetTopMin and friends: the takes are rescaled so every point keeps its value.
function hsRescale(next) {
  const o = hs.lim;
  const mx = (x) => (o.xLo - next.xLo + x * (o.xHi - o.xLo)) / (next.xHi - next.xLo);
  const my = (y) => 1 - (o.yLo - next.yLo + (1 - y) * (o.yHi - o.yLo)) / (next.yHi - next.yLo);
  hs.slots = hs.slots.map((s) => s && { dur: s.dur, pts: s.pts.map((q) => ({ x: mx(q.x), y: my(q.y), t: q.t })) });
  if (hs.rec) hs.rec = hs.rec.map((q) => ({ x: mx(q.x), y: my(q.y), t: q.t }));
  hs.hand = { x: mx(hs.hand.x), y: my(hs.hand.y) };
  hs.lim = next;
}

function hsSetLimit(field, text) {
  const v = parseFloat(text);
  const next = { ...hs.lim, [field]: v };
  if (!Number.isFinite(v) || next.xHi === next.xLo || next.yHi === next.yLo) { hsLimitsOut(); return; }
  hsRescale(next);
  hsSaveTakes();
  hsLimitsOut();
  hsPaint();
}

function hsSetAxis(axis, key) {
  if (!HS_AXES[key]) return;
  hs.axes[axis] = key;
  const a = HS_AXES[key];
  if (axis === 'x') { hs.lim.xLo = a.lo; hs.lim.xHi = a.hi; } else { hs.lim.yLo = a.lo; hs.lim.yHi = a.hi; }
  hsSaveTakes();
  hsLimitsOut();
  hsPaint();
}

function hsLimitsOut() {
  if (!hs.built) return;
  const put = (id, v) => { $(id).value = String(+v.toFixed(4)); };
  put('hsXLo', hs.lim.xLo); put('hsXHi', hs.lim.xHi); put('hsYLo', hs.lim.yLo); put('hsYHi', hs.lim.yHi);
  $('hsXName').textContent = HS_AXES[hs.axes.x].label;
  $('hsYName').textContent = HS_AXES[hs.axes.y].label;
  $('hsX').value = hs.axes.x;
  $('hsY').value = hs.axes.y;
}

// ------------------------------------------------------------- time

/// The take's clock, the throw, and the ring that shows what the engine is
/// playing. Runs only while the page is out.
function hsFrame(now) {
  hs.raf = 0;
  if (!hs.shown) return;
  const dt = Math.min(100, now - (hs.last || now));
  hs.last = now;
  if (hs.mode === 'play') {
    const take = hs.slots[hs.slot];
    if (take?.pts.length) {
      const e = (now - hs.t0) * hs.rate, d = take.dur;
      let u;
      if (hs.dir === 'pp') { const m = e % (2 * d); u = m < d ? m : 2 * d - m; }
      else { u = e % d; if (hs.dir === 'rev') u = d - u; }
      // SpendTime: the last point whose time has come. Stepped, never between.
      let lo = 0, hi = take.pts.length - 1, k = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (take.pts[mid].t <= u) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      const q = take.pts[k];
      if (q.x !== hs.hand.x || q.y !== hs.hand.y) hsMoveTo({ x: q.x, y: q.y }, now, { record: false });
    }
  } else if (hs.throwOn && !hs.down && hs.mode !== 'pause' && Math.abs(hs.vel.x) + Math.abs(hs.vel.y) > 2e-5) {
    let x = hs.hand.x + hs.vel.x * dt, y = hs.hand.y + hs.vel.y * dt, vx = hs.vel.x, vy = hs.vel.y;
    if (x < 0) { x = -x; vx = -vx; } if (x > 1) { x = 2 - x; vx = -vx; }
    if (y < 0) { y = -y; vy = -vy; } if (y > 1) { y = 2 - y; vy = -vy; }
    const f = Math.pow(0.9988, dt);
    hs.vel = { x: vx * f, y: vy * f };
    hsMoveTo({ x, y }, now);
  }
  // The ring: where Hyperprism's smoothing has the engine now.
  const k = 1 - Math.pow(1 - hsCoef(hs.glide), dt * 44.1 / 512);
  hs.ghost = hs.ghost || { ...hs.hand };
  hs.ghost.x += (hs.hand.x - hs.ghost.x) * k;
  hs.ghost.y += (hs.hand.y - hs.ghost.y) * k;
  hsPaintGhost();
  hs.raf = requestAnimationFrame(hsFrame);
}

// ------------------------------------------------------------- drawing

function hsPaintGhost() {
  const g = hs.ghost || hs.hand;
  const ring = $('hsGhost');
  if (!ring) return;
  ring.setAttribute('cx', (g.x * HS_W).toFixed(1));
  ring.setAttribute('cy', (g.y * HS_H).toFixed(1));
  $('hsNow').textContent = `${HS_AXES[hs.axes.x].fmt(hsValueX(g.x))}  ${HS_AXES[hs.axes.y].fmt(hsValueY(g.y))}`;
}

function hsPaint() {
  if (!hs.built) return;
  const L = 'ABCD'[hs.slot];
  const chips = { ready: 'READY · grab the pad to record', rec: `REC · ${L} · ${hs.loopOnRelease ? 'release to loop' : 'until ▶ or ■'}`, play: `PLAY · ${L}`, pause: `PAUSE · ${L}` };
  const chip = $('hsChip');
  chip.textContent = chips[hs.mode];
  chip.dataset.mode = hs.mode;
  $('dockHyper').dataset.mode = hs.mode;

  const hx = hs.hand.x * HS_W, hy = hs.hand.y * HS_H;
  $('hsBall').setAttribute('cx', hx.toFixed(1));
  $('hsBall').setAttribute('cy', hy.toFixed(1));
  $('hsCross').setAttribute('d', `M${(hx - 7).toFixed(1)} ${hy.toFixed(1)}H${(hx + 7).toFixed(1)}M${hx.toFixed(1)} ${(hy - 7).toFixed(1)}V${(hy + 7).toFixed(1)}`);

  const pts = hs.mode === 'rec' && hs.rec ? hs.rec : hs.slots[hs.slot]?.pts || [];
  $('hsPath').setAttribute('points', pts.map((q) => `${(q.x * HS_W).toFixed(1)},${(q.y * HS_H).toFixed(1)}`).join(' '));

  // The readout: under the hand while it moves, under the pointer while it hovers.
  const shown = hs.down || hs.mode === 'play' ? hs.hand : hs.hover;
  const read = $('hsRead');
  read.classList.toggle('hidden', !shown);
  if (shown) {
    const px = shown.x * HS_W, py = shown.y * HS_H;
    read.textContent = `${HS_AXES[hs.axes.x].fmt(hsValueX(shown.x))},  ${HS_AXES[hs.axes.y].fmt(hsValueY(shown.y))}`;
    read.style.left = `${Math.min(HS_W - 120, Math.max(2, px + 10))}px`;
    read.style.top = `${py - 22 < 6 ? py + 12 : py - 22}px`;
  }

  const take = hs.slots[hs.slot];
  $('hsInfo').textContent = hs.mode === 'rec' && hs.rec
    ? `Take ${L} · recording · ${hs.rec.length} points`
    : take ? `Take ${L} · ${(take.dur / 1000).toFixed(2)} s · ${take.pts.length} points · loops at its own length`
      : `Take ${L} empty · grab the pad to record into it`;

  document.querySelectorAll('#dockHyper .hs-slot').forEach((b) => {
    const i = +b.dataset.slot, s = hs.slots[i];
    b.classList.toggle('on', i === hs.slot);
    b.querySelector('[data-len]').textContent = s ? `${(s.dur / 1000).toFixed(1)} s` : '—';
    b.querySelector('[data-thumb]').setAttribute('points', s ? s.pts.filter((_, j) => j % 3 === 0).map((q) => `${(q.x * HS_W).toFixed(0)},${(q.y * HS_H).toFixed(0)}`).join(' ') : '');
  });
  document.querySelectorAll('#dockHyper [data-hsrate]').forEach((b) => b.classList.toggle('on', +b.dataset.hsrate === hs.rate));
  document.querySelectorAll('#dockHyper [data-hsdir]').forEach((b) => b.classList.toggle('on', b.dataset.hsdir === hs.dir));

  const a = hsCoef(hs.glide);
  $('hsGlide').value = hs.glide;
  $('hsGlideV').textContent = `${hs.glide} %`;
  $('hsCoef').textContent = a.toFixed(4);
  $('hsTau').textContent = a >= 1 ? 'instant' : `${((-1 / Math.log(1 - a)) * 512 / 44100).toFixed(2)} s to 63 %`;
  $('hsThrow').checked = hs.throwOn;
  $('hsLoopRelease').checked = hs.loopOnRelease;
  $('hsRec').classList.toggle('on', hs.mode === 'rec');
}

// ------------------------------------------------------------- the page

/// The Prism page is out, or not: the glide is HyperStretch's, so it is on
/// while the pad is and back to none when it goes.
function hyperStretchShown(on) {
  if (on && !hs.built) hsBuild();
  if (on === hs.shown) return;
  hs.shown = on;
  if (on) {
    hsLoadTakes();
    hsSendGlide();
    hs.last = 0;
    if (!hs.raf) hs.raf = requestAnimationFrame(hsFrame);
    hsPaint();
  } else {
    if (hs.mode === 'rec') hsStopRec(performance.now());
    if (hs.mode === 'play') hs.mode = 'ready';
    hsSendGlide(0);
  }
}

// The dock panel is shown and hidden by the dock's own tab code; this follows it.
(() => {
  const host = document.getElementById('dockHyper');
  if (!host) return;
  new MutationObserver(() => hyperStretchShown(!host.classList.contains('hidden') && !document.getElementById('dock')?.classList.contains('hidden')))
    .observe(host, { attributes: true, attributeFilter: ['class'] });
  const dock = document.getElementById('dock');
  if (dock) new MutationObserver(() => hyperStretchShown(!host.classList.contains('hidden') && !dock.classList.contains('hidden')))
    .observe(dock, { attributes: true, attributeFilter: ['class'] });
})();

/// For the tests, and for anyone asking from the console.
window.hyperStretch = {
  limits: () => ({ ...hs.lim }),
  hand: () => ({ ...hs.hand }),
  take: (i) => hs.slots[i] && { dur: hs.slots[i].dur, pts: hs.slots[i].pts.map((q) => ({ ...q })) },
  values: (i) => (hs.slots[i]?.pts || []).map((q) => ({ [hs.axes.x]: hsValueX(q.x), [hs.axes.y]: hsValueY(q.y) })),
  motion: () => ({ rate: hs.rate, dir: hs.dir }),
  reset: () => {
    hs.slots = [null, null, null, null]; hs.rec = null; hs.mode = 'ready'; hs.slot = 0;
    hs.lim = { xLo: 4, xHi: 0.25, yLo: -12, yHi: 12 }; hs.axes = { x: 'ratio', y: 'semitones' };
    hs.loopOnRelease = false; hs.throwOn = false; hs.rate = 1; hs.dir = 'fwd';
    hsLimitsOut(); hsPaint();
  },
};
