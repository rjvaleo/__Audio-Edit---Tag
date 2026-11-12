// ============================================================ Prism

/* The Prism page: Hyperprism's XY pad, read from Hyperprism-PPC 1.2.1's code.
   HyperStretch and the rack pad merged (RJ, 5 Nov 2026): every function of
   both, HyperStretch's look, the rack pad's square box sized to the dock. See
   `docs/HYPERSTRETCH.md` and `docs/HYPERPRISM.md`.

   What the pad drives comes from the rack pad (`ui/prism-pad.js`): Time &
   Pitch, Hyperprism's Pitch Time Changer, or any rack slot, with that
   process's pair on the axes and its window kept with the rack. The panel uses
   the rack pad's element ids for the parts the two share, so its source and
   axis menus, limits, presets, post-roll, PTC switch, Playback Speed and
   faders are drawn and wired by the same functions.

   Exact to the original:
   - linear between the limits in its corners (the rack pad swept log controls
     logarithmically; Hyperprism did not);
   - grabbing it is the record button, and a take runs until Stop or Play;
   - a take is at most a point per tick (1/60.15 s), played back stepped,
     looping at its own length;
   - Shift locks a drag horizontal, vertical or to a diagonal; arrows draw while
     recording, Option ×10;
   - a new limit rescales the takes so every point keeps its value;
   - the readout shows the values under the pointer, touched or not;
   - Smoothing is the engine's (`glide.rs`): the pad steps, the sound glides.

   Not the original: the pad is square (Hyperprism's was 461 × 241), as large
   as the dock leaves room for, as the rack pad's was.

   Where a take goes:
   - **Loop**, HyperStretch's: four takes (A–D) in the browser, stepped, each
     looping at its own length, with rate, direction, throw, loop on release
     and drawn shapes. Live only.
   - **Lanes**, the rack pad's: ● arms the recorder and plays, and the pad's
     two controls become two automation lanes in the document, which LOOP
     wraps together and the export plays. */

const HS_TICK = 1000 / 60.15;
/// What the banks beside the pad need, at the least; the pad gives way first.
const HS_BANKS_MIN = 724;
/// The two the engine glides, sent straight to it as a Loop take plays.
const HS_FAST = new Set(['ratio', 'semitones']);

const hs = {
  built: false, shown: false, side: 220,
  axes: { x: 'ratio', y: 'semitones' },
  lim: { xLo: 4, xHi: 0.25, yLo: -12, yHi: 12 },
  hand: { x: 0.5, y: 0.5 },
  where: 'loop',            // loop · lanes
  mode: 'ready',            // ready · rec · play · pause
  slot: 0, slots: [null, null, null, null],
  rec: null, recT0: 0, lastTick: -1,
  t0: 0, pauseAt: 0, rate: 1, dir: 'fwd',
  glide: 50, throwOn: false, loopOnRelease: false,
  down: false, hover: null, vel: { x: 0, y: 0 }, prev: null, anchor: null,
  raf: 0, last: 0, sent: null, wasArmed: false, seenPath: null,
};

const hsClamp = (v) => Math.max(0, Math.min(1, v));

/// The one-pole coefficient Hyperprism's Smoothing (%) stands for.
function hsCoef(s) {
  return Math.floor(Math.pow(10, 0.04 * (100 - s)) + 1e-9) * 0.0001;
}

function hsControl(axis) {
  return typeof prismControl === 'function' ? prismControl(hs.axes[axis]) : null;
}

/// Linear between the limits, as `CProcessController::ListenToMessage` has it;
/// a stepped control lands on its steps.
function hsValue(axis, f) {
  const c = hsControl(axis);
  const v = axis === 'x' ? hs.lim.xLo + f * (hs.lim.xHi - hs.lim.xLo) : hs.lim.yLo + (1 - f) * (hs.lim.yHi - hs.lim.yLo);
  return c?.step === 1 ? Math.round(v) : v;
}
function hsValueX(x) { return hsValue('x', x); }
function hsValueY(y) { return hsValue('y', y); }

/// Where on the pad a value sits: the inverse.
function hsFrac(axis, v) {
  const [lo, hi] = axis === 'x' ? [hs.lim.xLo, hs.lim.xHi] : [hs.lim.yLo, hs.lim.yHi];
  if (!Number.isFinite(v) || lo === hi) return 0.5;
  const t = (v - lo) / (hi - lo);
  return axis === 'x' ? t : 1 - t;
}

function hsFmt(axis, v) {
  const c = hsControl(axis);
  return c ? prismFormat(c, v) : (Number.isFinite(v) ? v.toFixed(2) : '');
}

const hsSource = () => (typeof prismCurrent === 'function' ? prismCurrent() : null);
/// **Unlisted** (6 Nov 2026): the rack pad's Lanes are the grain document's
/// automation, and the Prism page now plays its own deck (`engine/src/decks.rs`),
/// which has no lanes yet. Lanes and LOOP are kept, not deleted; `true` lists
/// them again.
const HS_LANES_LISTED = false;
const hsLanes = () => HS_LANES_LISTED && hs.where === 'lanes';

// ------------------------------------------------------------- the panel

function hsBuild() {
  const host = $('dockHyper');
  if (!host || hs.built) return;
  hs.built = true;
  try {
    const kept = JSON.parse(localStorage.getItem('hyperstretch.settings') || '{}');
    for (const k of ['glide', 'throwOn', 'loopOnRelease', 'rate', 'dir', 'where']) if (k in kept) hs[k] = kept[k];
  } catch { /* first use */ }
  const fader = (id, label, aria) => `<div class="hs-fader">
      <input type="range" id="${id}" min="0" max="255" step="1" value="128" aria-label="${aria}" title="${aria}, −18 to +18 dB · double-click for the middle">
      <span class="mono" id="${id}Read"></span>
      <button type="button" class="hs-btn" id="prismFaderZero${id.slice(10)}" title="${aria} back to the middle">${label} 0</button></div>`;
  host.innerHTML = `
    <div class="hs-head">
      <span class="hs-title">PRISM</span>
      <div class="ppick" id="prismPick">
        <button type="button" class="ppick-btn" id="prismPickBtn" aria-haspopup="listbox" aria-expanded="false" title="The process on the pad: all of Hyperprism's, Time & Pitch and the Pitch Time Changer"></button>
        <div class="ppick-menu" id="prismPickMenu" role="listbox" aria-label="Processes" hidden></div>
        <select id="prismSource" class="ppick-mirror" tabindex="-1" aria-hidden="true"></select>
      </div>
      <label class="hs-lbl">X <select id="prismX" class="mini" aria-label="Across the pad"></select></label>
      <label class="hs-lbl">Y <select id="prismY" class="mini" aria-label="Up the pad"></select></label>
      <span class="hs-vsep"></span>
      <div class="hs-transport" role="group" aria-label="Prism transport">
        <button type="button" class="hs-btn" id="hsRec" aria-label="Record" title="Record — or just grab the pad">●</button>
        <button type="button" class="hs-btn" id="hsPlay" aria-label="Play the take" title="Play the take">▶</button>
        <button type="button" class="hs-btn" id="hsPause" aria-label="Pause" title="Pause">❚❚</button>
        <button type="button" class="hs-btn" id="hsStop" aria-label="Stop" title="Stop: ends a take">■</button>
        <button type="button" class="hs-btn" id="hsRewind" aria-label="Rewind" title="Back to the start">⏮</button>
      </div>
      <span class="hs-chip mono" id="hsChip"></span>
      <span class="hs-seg${HS_LANES_LISTED ? '' : ' hidden'}" role="group" aria-label="Where a take goes">
        <button type="button" data-hswhere="loop" title="Hyperprism's take: stepped, looping at its own length, live">Loop</button>
        <button type="button" data-hswhere="lanes" title="The rack pad's take: two automation lanes in the document, in the export">Lanes</button>
      </span>
      <button type="button" class="hs-btn${HS_LANES_LISTED ? '' : ' hidden'}" id="prismLoop" title="Loop the take: both of its lanes wrap over its span, together">⟲ LOOP</button>
      <span class="hs-fill"></span>
      <div id="prismPbHost"></div>
    </div>
    <div class="hs-deck" role="group" aria-label="Prism's own sound">
      <span class="hs-dim">SOUND</span>
      <select id="prismSoundFolder" class="mini" aria-label="Folder"></select>
      <select id="prismSoundFile" class="mini" aria-label="Prism's sound"></select>
      <span class="mono hs-deck-name" id="prismSoundName"></span>
      <canvas id="prismWave" class="hs-wave" aria-label="Prism's sound and where it is playing"></canvas>
      <span class="hs-dim">CHAIN</span>
      <span id="prismChain" class="hs-chain"></span>
      <select id="prismChainAdd" class="mini" aria-label="Add an effect to Prism's chain"><option value="">+ add effect</option></select>
    </div>
    <div class="hs-body">
      <div class="hs-stage">
        <div class="hs-top"><input id="prismXLo" type="number" step="any" class="hs-lim mono" aria-label="X low limit" title="Left end of the sweep"><span id="hsXName" class="hs-axis"></span><input id="prismXHi" type="number" step="any" class="hs-lim mono" aria-label="X high limit" title="Right end of the sweep"></div>
        <div class="hs-mid">
          <div class="hs-left"><input id="prismYHi" type="number" step="any" class="hs-lim mono" aria-label="Y high limit" title="Top of the sweep"><span id="hsYName" class="hs-axis hs-vert"></span><input id="prismYLo" type="number" step="any" class="hs-lim mono" aria-label="Y low limit" title="Bottom of the sweep"></div>
          <button type="button" class="hs-pad" id="hsPad" aria-label="Prism pad: grab to record, Shift to lock, arrows to draw while recording, double-click to centre"
            title="Grab to record · Shift locks H, V or 45° · ←↑→↓ draw while recording, ⌥ ×10 · double-click to centre">
            <svg class="hs-svg" id="hsSvg" aria-hidden="true">
              <path id="hsGrid" class="hs-grid" d=""/>
              <polyline id="hsPath" class="hs-path" points=""/>
              <circle id="hsGhost" class="hs-ghost" r="9"/>
              <path id="hsCross" class="hs-cross" d=""/>
              <circle id="hsBall" class="hs-ball" r="4.5"/>
            </svg>
            <span class="hs-read mono hidden" id="hsRead"></span>
          </button>
        </div>
        <div class="hs-foot"><span class="mono" id="hsInfo"></span></div>
        <div class="hs-foot"><span class="hs-dim">engine now</span><span class="mono" id="hsNow"></span></div>
      </div>
      <div class="hs-banks">
        <section class="hs-bank prism-ctl" aria-label="Controls">
          <div class="hs-h">CONTROLS <span id="hsSetSub"></span>
            <button type="button" class="hs-btn hidden" id="prismPtcOn" title="Hyperprism's Pitch Time Changer: on or off. Moving its pad turns it on.">PTC</button>
            <span class="hs-fill"></span><span class="hs-dim">double-click a picture to reset</span></div>
          <div class="prism-settings prism-bars" id="prismSettings"></div>
          <div class="plfo" id="prismLfos"></div>
        </section>
        <section class="hs-bank prism-takes" aria-label="Takes">
          <div class="hs-h">TAKES <span id="hsGestSub"></span></div>
          <div class="hs-slots">${[0, 1, 2, 3].map((i) => `<button type="button" class="hs-slot" data-slot="${i}" aria-label="Take ${'ABCD'[i]}">
            <span class="hs-slot-top"><b>${'ABCD'[i]}</b><span class="mono hs-dim" data-len></span></span>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline data-thumb points=""/></svg></button>`).join('')}</div>
          <div class="hs-row prism-rateplay"><span class="hs-seg" aria-label="Rate">${[[0.5, '×½'], [1, '×1'], [2, '×2']].map(([v, l]) => `<button type="button" data-hsrate="${v}">${l}</button>`).join('')}</span>
            <span class="hs-seg" aria-label="Direction">${[['fwd', '→', 'Forwards'], ['rev', '←', 'Backwards'], ['pp', '⇄', 'Back and forth']].map(([v, l, t]) => `<button type="button" data-hsdir="${v}" aria-label="${t}" title="${t}">${l}</button>`).join('')}</span></div>
          <div class="prism-bars prism-takebars" id="prismTakeBars"></div>
          <div class="hs-kv prism-glide-kv" id="hsGlideBox" title="Glide is Hyperprism's Smoothing: the pad steps, the sound glides"><span>coefficient</span><span class="mono" id="hsCoef"></span><span>catch-up</span><span class="mono" id="hsTau"></span><span class="hidden mono" id="hsGlideV"></span></div>
          <div class="prism-motion" aria-label="Motion">
            <label class="hs-tog" title="Let go while moving and the point keeps going"><input type="checkbox" id="hsThrow"> Throw</label>
            <label class="hs-tog" title="A take plays as soon as you let go"><input type="checkbox" id="hsLoopRelease"> Loop on release</label>
            ${[['circle', 'Circle'], ['eight', 'Figure 8'], ['liss', 'Lissajous'], ['drift', 'Drift']].map(([k, l]) => `<button type="button" class="hs-btn" data-hsshape="${k}" title="Draw a ${l.toLowerCase()} into the take">${l}</button>`).join('')}
          </div>
        </section>
        <section class="hs-bank prism-out" aria-label="Output">
          <div class="hs-h">OUTPUT</div>
          <div class="hs-faders">${fader('prismFaderL', 'L', 'Left fader')}${fader('prismFaderLR', 'LR', 'Both faders')}${fader('prismFaderR', 'R', 'Right fader')}</div>
        </section>
      </div>
    </div>`;
  prismTakeBarsBuild();
  prismPickerWire();
  hsWire();
  hsFit();
  hsPaint();
}

/// Glide, Playback speed and Post-roll as bars with their pictures, on the
/// elements the rest of the panel already drives by id.
function prismTakeBarsBuild() {
  const box = $('prismTakeBars');
  if (!box) return;
  const glide = prismBar({ key: 'smoothing', label: 'Glide', min: 0, max: 100, step: 1, default: 50, unit: '%' }, hs.glide,
    { facet: 'time', format: (v) => `${Math.round(v)} %` });
  glide.querySelector(':scope > input').id = 'hsGlide';
  const speed = prismBar({ key: 'pbSpeed', label: 'Playback speed', min: 0, max: 255, step: 1, default: 128 }, prismHp.speed,
    { facet: 'time', format: (v) => `${Math.round(prismSpeedRate(v) * 100)} %` });
  speed.querySelector(':scope > input').id = 'prismSpeed';
  speed.querySelector(':scope > .v').id = 'prismSpeedRead';
  speed.title = "Hyperprism's Playback Speed: tape speed before the chain, pitch and time together · double-click the picture for 100 %";
  const post = prismBar({ key: 'postRoll', label: 'Post-roll', min: 0, max: 10000, step: 10, default: 0, unit: 'ms' },
    prismDeck.rack?.postRoll?.[prismPad.source] || 0, { facet: 'time', format: (v) => `${Math.round(v)} ms` });
  post.querySelector(':scope > input').id = 'prismPostRoll';
  post.title = 'How long this process runs on silence past the end, so its tail is heard';
  box.append(glide, speed, post);
  prismFollow(glide, () => hs.glide);
  prismFollow(speed, () => prismHp.speed);
  prismFollow(post, () => prismDeck.rack?.postRoll?.[prismPad.source] || 0);
}

/// Square, the largest the dock leaves room for beside the banks, as the rack
/// pad's was: its height less the limits and the lines under it, or its width
/// less the Y limits and the banks, whichever is less.
function hsFit() {
  const host = $('dockHyper');
  const body = host?.querySelector('.hs-body');
  if (!body || !body.clientHeight) return;
  // Padding, the top limits, the two lines under the pad, the gaps, the border.
  const h = body.clientHeight - 16 - 21 - 2 * 16 - 9 - 2;
  const w = body.clientWidth - 16 - 41 - 2 - 10 - HS_BANKS_MIN;
  const side = Math.max(140, Math.floor(Math.min(h, w)));
  if (side === hs.side && host.style.getPropertyValue('--hs-side')) return;
  hs.side = side;
  host.style.setProperty('--hs-side', `${side}px`);
  const svg = $('hsSvg');
  svg.setAttribute('width', side);
  svg.setAttribute('height', side);
  svg.setAttribute('viewBox', `0 0 ${side} ${side}`);
  const q = (k) => (side * k / 4).toFixed(2);
  $('hsGrid').setAttribute('d', `M${q(1)} 0V${side}M${q(2)} 0V${side}M${q(3)} 0V${side}M0 ${q(2)}H${side}`);
  hs.pathCache = null;
  hs.lanesCache = null;
  hsPaint();
}

function hsWire() {
  const pad = $('hsPad');
  const frac = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: hsClamp((e.clientX - r.left) / r.width), y: hsClamp((e.clientY - r.top) / r.height) };
  };
  pad.addEventListener('pointerdown', (e) => {
    if (hs.mode === 'pause' || e.button > 0) return;
    e.preventDefault();
    pad.setPointerCapture?.(e.pointerId);
    // Without scrolling: the panel must not move under the hand.
    pad.focus({ preventScroll: true });
    const p = frac(e), t = performance.now();
    hs.anchor = null;
    hs.prev = { p, t };
    hs.down = true;
    hs.vel = { x: 0, y: 0 };
    // RequestRecord: the click is the value and the record button at once.
    // In Lanes the recorder is ●'s, as the rack pad's REC was.
    if (!hsLanes() && hs.mode !== 'rec') hsStartRec(t);
    hsMoveTo(p, t);
  });
  pad.addEventListener('pointermove', (e) => {
    const raw = frac(e);
    hs.hover = raw;
    if (!hs.down) { hsPaintSoon(); return; }
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
    const thrown = !hsLanes() && hs.throwOn && t - hs.prev.t < 60 && Math.hypot(hs.vel.x, hs.vel.y) > 1e-5;
    if (!thrown) hs.vel = { x: 0, y: 0 };
    if (hs.loopOnRelease && hs.mode === 'rec' && !thrown) { hsStopRec(t); hsPlay(t); }
    hsCommit();
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('pointerleave', () => { if (!hs.down) { hs.hover = null; hsPaint(); } });
  // Double-click centres the point, as double-click resets every control here.
  pad.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (hs.mode === 'rec') hsStopRec(performance.now());
    if (hs.mode === 'play') hs.mode = 'ready';
    hsMoveTo({ x: 0.5, y: 0.5 }, performance.now(), { record: false });
    hsCommit();
    hsPaint();
  });
  pad.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    // NudgeCurrentPoint: only while recording, 1 px or 10 with Option.
    if (!hsRecording()) return;
    const step = (e.altKey ? 10 : 1) / hs.side;
    hsMoveTo({ x: hsClamp(hs.hand.x + d[0] * step), y: hsClamp(hs.hand.y + d[1] * step) }, performance.now());
  });

  $('hsRec').onclick = () => {
    if (hsLanes()) { prismToggleRecord().then(hsPaint); return; }
    if (hs.mode !== 'rec') { hsStartRec(performance.now()); hsAddPoint(hs.hand, performance.now()); hsPaint(); }
  };
  $('hsPlay').onclick = () => {
    if (hsLanes()) { if (!engine.playing) startPlayback(); hsPaint(); return; }
    const t = performance.now();
    if (hs.mode === 'pause') { hs.t0 += t - hs.pauseAt; hs.mode = 'play'; hsPaint(); return; }
    if (hs.mode === 'rec') hsStopRec(t);
    hsPlay(t);
  };
  $('hsPause').onclick = () => {
    if (hsLanes()) { if (engine.playing) pausePlayback(); hsPaint(); return; }
    const t = performance.now();
    if (hs.mode === 'play') { hs.mode = 'pause'; hs.pauseAt = t; }
    else if (hs.mode === 'pause') { hs.t0 += t - hs.pauseAt; hs.mode = 'play'; }
    hsPaint();
  };
  $('hsStop').onclick = async () => {
    if (hsLanes()) {
      // A stop ends an armed take (`captureTransport`); armed and not yet
      // playing, it disarms.
      if (engine.playing) pausePlayback();
      else if (state.captureArmed) await endCapture();
      hsPaint();
      return;
    }
    const t = performance.now();
    if (hs.mode === 'rec') hsStopRec(t);
    hs.mode = 'ready';
    hs.vel = { x: 0, y: 0 };
    hsCommit();
    hsPaint();
  };
  $('hsRewind').onclick = () => {
    if (hsLanes()) { seekSource(0); return; }
    hs.t0 = performance.now();
    const take = hs.slots[hs.slot];
    if (take?.pts.length) hsMoveTo({ x: take.pts[0].x, y: take.pts[0].y }, hs.t0, { record: false });
  };

  // The rack pad's parts, wired as it wired them, with the takes kept in step.
  $('prismSource').onchange = (e) => hsSetSource(e.target.value);
  $('prismX').onchange = (e) => { prismAxisChanged('x', e.target.value); hsSetupChanged(); };
  $('prismY').onchange = (e) => { prismAxisChanged('y', e.target.value); hsSetupChanged(); };
  for (const field of ['xLo', 'xHi', 'yLo', 'yHi']) {
    const input = $(`prism${field[0].toUpperCase()}${field.slice(1)}`);
    input.addEventListener('change', () => { prismLimitChanged(field, input); hsSetupChanged(); });
  }
  $('prismPtcOn').onclick = () => {
    prismPtcSet({ on: !prismPtc().on });
    prismShowPtc();
  };
  for (const [id, key] of [['prismSpeed', 'speed'], ['prismFaderL', 'l'], ['prismFaderLR', 'lr'], ['prismFaderR', 'r']]) {
    const el = $(id);
    // The speed is a bar (`prismBar`), whose own handler draws it: beside it.
    if (key === 'speed') el.addEventListener('input', () => prismFaderSet(key, +el.value));
    else el.oninput = () => prismFaderSet(key, +el.value);
    el.addEventListener('dblclick', () => prismFaderSet(key, 128));
  }
  for (const [id, key] of [['prismFaderZeroL', 'l'], ['prismFaderZeroLR', 'lr'], ['prismFaderZeroR', 'r']]) {
    $(id).onclick = () => prismFaderSet(key, 128);
  }
  prismPresetBar();
  $('prismPostRoll').onchange = (e) => prismPostRollChanged(e.target);
  $('prismLoop').onclick = () => prismToggleLoop().then(hsPaint);
  $('prismSoundFolder').onchange = () => prismSoundFill();
  $('prismSoundFile').onchange = (e) => { if (e.target.value) prismDeckUse(e.target.value); };
  $('prismChainAdd').onchange = (e) => { const k = e.target.value; e.target.value = ''; prismChainAdd(k); };

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
    else if (b.dataset.hswhere) hsSetWhere(b.dataset.hswhere);
  });
  if (window.ResizeObserver) new ResizeObserver(hsFit).observe($('dockHyper').querySelector('.hs-body'));
}

function hsKeep() {
  try {
    localStorage.setItem('hyperstretch.settings', JSON.stringify({ glide: hs.glide, throwOn: hs.throwOn, loopOnRelease: hs.loopOnRelease, rate: hs.rate, dir: hs.dir, where: hs.where }));
  } catch { /* private mode */ }
}

/// Loop or Lanes. A Loop take in progress ends; the lanes' take is drawn.
function hsSetWhere(where) {
  if (where === hs.where) return;
  const t = performance.now();
  if (hs.mode === 'rec') hsStopRec(t);
  hs.mode = 'ready';
  hs.vel = { x: 0, y: 0 };
  hs.where = where;
  hsKeep();
  if (where === 'lanes') prismLoadPath().then(hsPaint);
  hsPaint();
}

// ------------------------------------------------------------- the source

/// The panel is out: fetch what the pad can drive, as the rack pad's tab did.
async function hsOpen() {
  try {
    const r = await api(`/api/pad?p=${encodeURIComponent(prismKey())}`);
    prismPad.sources = r.sources || [];
  } catch { prismPad.sources = []; }
  if (!prismPad.sources.some((s) => s.id === prismPad.source)) prismPad.source = PRISM_STRETCH;
  // The LFOs are kept per sound: load this one's before the bars ask for rings.
  prismLfoLoad();
  prismRenderBar();
  prismLfoRender();
  prismLfoStart();
  prismShowHp();
  prismLoadPresets();
  hsLoadTakes();
  await prismLoadPath();
  hsPaint();
}

function hsSetSource(id) {
  if (hs.mode === 'rec') hsStopRec(performance.now());
  if (hs.mode === 'play') hs.mode = 'ready';
  hsSaveTakes();
  prismPad.source = id;
  prismRenderBar();
  prismLoadPresets();
  hsLoadTakes();
  prismLoadPath().then(hsPaint);
  hsPaint();
}

/// The axes or their limits changed (`prismKeep` has kept them with the rack):
/// with the same two controls the takes are rescaled so every point keeps its
/// value, as `SetTopMin` and friends did; with others they keep their shape.
function hsSetupChanged() {
  const p = typeof prismSetup === 'function' ? prismSetup() : null;
  if (!p) return;
  const next = { xLo: p.xLo, xHi: p.xHi, yLo: p.yLo, yHi: p.yHi };
  const same = p.x === hs.axes.x && p.y === hs.axes.y;
  hs.axes = { x: p.x, y: p.y };
  if (same && next.xHi !== next.xLo && next.yHi !== next.yLo) hsRescale(next);
  else { hs.lim = next; hsHandFromValues(); }
  hs.lanesCache = null;
  hsSaveTakes();
  hsPaint();
}

/// The point where the two controls are now.
function hsHandFromValues() {
  if (typeof prismRead !== 'function' || !hsSource()) return;
  hs.hand = { x: hsClamp(hsFrac('x', prismRead(hs.axes.x))), y: hsClamp(hsFrac('y', prismRead(hs.axes.y))) };
}

// ------------------------------------------------------------- moving

/// The pad is at `p`: both controls take its values, and a take in progress
/// gets a point.
function hsMoveTo(p, t, { record = true } = {}) {
  hs.hand = { x: p.x, y: p.y };
  if (record && hs.mode === 'rec') hsAddPoint(p, t);
  hsApply();
  hsPaintSoon();
}

/// One paint a frame, however many moves the pointer sends in it.
function hsPaintSoon() {
  if (hs.paintQueued) return;
  hs.paintQueued = true;
  requestAnimationFrame(() => { hs.paintQueued = false; hsPaint(); });
}

/// The path's points as an attribute, grown by what was added rather than
/// rebuilt from the whole take on every move.
function hsPathPoints(pts) {
  const S = hs.side;
  const c = hs.pathCache;
  if (!c || c.pts !== pts || c.n > pts.length) hs.pathCache = { pts, n: 0, text: '' };
  const k = hs.pathCache;
  for (; k.n < pts.length; k.n++) {
    const q = pts[k.n];
    k.text += `${k.n ? ' ' : ''}${(q.x * S).toFixed(1)},${(q.y * S).toFixed(1)}`;
  }
  return k.text;
}

/// The lanes' take for the two controls, from their units to the pad.
function hsLanesPoints() {
  const path = prismPad.path || [];
  const c = hs.lanesCache;
  if (c && c.path === path) return c.text;
  const cx = hsControl('x'), cy = hsControl('y'), S = hs.side;
  const text = cx && cy ? path.map(([, ux, uy]) =>
    `${(hsFrac('x', prismUnitValue(cx, ux)) * S).toFixed(1)},${(hsFrac('y', prismUnitValue(cy, uy)) * S).toFixed(1)}`).join(' ') : '';
  hs.lanesCache = { path, text };
  return text;
}

/// Both controls to where the pad is, the way their own controls move them.
/// Time & Pitch's Stretch and Pitch go straight to the engine in Loop, which
/// glides them; in Lanes, and for its other two, by the live path the
/// recorder hears. The Pitch Time Changer and a slot through `prismWrite`.
function hsApply() {
  const src = hsSource();
  if (!src) return;
  const vals = { [hs.axes.x]: hsValueX(hs.hand.x), [hs.axes.y]: hsValueY(hs.hand.y) };
  if (src.id !== PRISM_STRETCH) {
    for (const [k, v] of Object.entries(vals)) prismWrite(k, v);
    return;
  }
  const d = prismDeck.stretch;
  let slow = false;
  const fast = {};
  for (const [k, v] of Object.entries(vals)) {
    d[k] = v;
    if (HS_FAST.has(k) && !hsLanes()) fast[k] = v; else slow = true;
  }
  if (Object.keys(fast).length) hsSendFast(fast);
  if (slow) prismStretchSend();
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
    fetch('/api/engine/pad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck: 'prism', ...body }) })
      .catch(() => {}).finally(go);
  };
  go();
}

/// What the pad has done, kept in the document, as a released control is.
function hsCommit() {
  if (hsSource() && typeof prismRelease === 'function') prismRelease();
}

function hsSendGlide(v = hs.glide) {
  if (hs.sent === v) return;
  hs.sent = v;
  postJSON('/api/engine/glide', { deck: 'prism', smoothing: v }).catch(() => {});
}

/// TrackHotSpot's Shift lock, in pad pixels: anchored where Shift went down;
/// the first move decides horizontal, vertical or one of the diagonals.
function hsLock(p, shift) {
  if (!shift) { hs.anchor = null; return p; }
  const S = hs.side;
  if (!hs.anchor) hs.anchor = { x: hs.hand.x, y: hs.hand.y, mode: null };
  const a = hs.anchor, dh = (p.x - a.x) * S, dv = (p.y - a.y) * S;
  if (!a.mode && (Math.abs(dh) >= 1 || Math.abs(dv) >= 1)) {
    if (Math.abs(Math.abs(dh) - Math.abs(dv)) < 1) a.mode = Math.sign(dh) === Math.sign(dv) ? 'diag' : 'anti';
    else a.mode = Math.abs(dh) > Math.abs(dv) ? 'h' : 'v';
  }
  if (a.mode === 'h') return { x: p.x, y: a.y };
  if (a.mode === 'v') return { x: a.x, y: p.y };
  if (a.mode === 'diag') return { x: hsClamp(a.x + dv / S), y: p.y };
  if (a.mode === 'anti') return { x: hsClamp(a.x - dv / S), y: p.y };
  return p;
}

/// Taking, either way: a Loop take, or the armed recorder rolling.
function hsRecording() {
  return hsLanes() ? !!(state.captureArmed && engine.playing) : hs.mode === 'rec';
}

// ------------------------------------------------------------- takes

function hsStartRec(t) {
  hs.rec = [];
  hs.recT0 = t;
  hs.lastTick = -1;
  hs.mode = 'rec';
  hsSendGlide();
  // Hyperprism's Record lit Play too: the sound plays while you draw.
  if (prismDeck.path && !prismDeck.playing) prismDeckPlay();
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
  if (prismDeck.path && !prismDeck.playing) prismDeckPlay();
  hsPaint();
}

function hsPickSlot(i) {
  if (hsLanes()) return;
  const t = performance.now();
  if (hs.mode === 'rec') hsStopRec(t);
  hs.slot = i;
  if (hs.mode === 'play' && !hs.slots[i]) hs.mode = 'ready';
  hsPaint();
}

function hsShape(kind) {
  if (hsLanes()) return;
  const dur = 4000, n = Math.floor(dur / HS_TICK), pts = [];
  let rx = hs.hand.x, ry = hs.hand.y, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let x, y;
    if (kind === 'circle') { x = 0.5 + 0.38 * Math.cos(a); y = 0.5 + 0.38 * Math.sin(a); }
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

/// The takes belong to the sound and the process, as Hyperprism's paths
/// belonged to its file and its window. Time & Pitch keeps HyperStretch's key.
function hsKey() {
  const src = prismPad?.source || PRISM_STRETCH;
  return `hyperstretch:${prismDeck.path}${src === PRISM_STRETCH ? '' : `:${src}`}`;
}

function hsSaveTakes() {
  try { localStorage.setItem(hsKey(), JSON.stringify({ lim: hs.lim, axes: hs.axes, slots: hs.slots })); } catch { /* full or private */ }
}

/// This source's takes, rescaled to its window if that has moved since.
function hsLoadTakes() {
  hs.slots = [null, null, null, null];
  hs.axes = { x: null, y: null };
  try {
    const kept = JSON.parse(localStorage.getItem(hsKey()) || 'null');
    if (kept?.slots) {
      hs.slots = kept.slots.slice(0, 4).concat([null, null, null, null]).slice(0, 4);
      if (kept.lim) hs.lim = kept.lim;
      if (kept.axes) hs.axes = kept.axes;
    }
  } catch { /* nothing kept */ }
  hsSetupChanged();
  hsHandFromValues();
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
  hs.pathCache = null;
}

// ------------------------------------------------------------- time

/// The take's clock, the throw, the lanes' take as it plays, and the ring that
/// shows what the engine is playing. Runs only while the page is out.
function hsFrame(now) {
  hs.raf = 0;
  if (!hs.shown) return;
  const dt = Math.min(100, now - (hs.last || now));
  hs.last = now;
  if (hsLanes()) hsFollowLanes();
  else if (hs.mode === 'play') {
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
  // A lanes' take just ended, or a new one arrived: draw it.
  prismDeckPoll(now);
  // A lanes' take just ended, or a new one arrived: draw it.
  if (hs.wasArmed && !state.captureArmed) prismLoadPath();
  hs.wasArmed = !!state.captureArmed;
  if (prismPad.path !== hs.seenPath || (hsLanes() && hs.armedShown !== hsArmedState())) { hs.seenPath = prismPad.path; hsPaint(); }
  // The ring: where Hyperprism's smoothing has the engine now.
  const k = 1 - Math.pow(1 - hsCoef(hs.glide), dt * 44.1 / 512);
  hs.ghost = hs.ghost || { ...hs.hand };
  hs.ghost.x += (hs.hand.x - hs.ghost.x) * k;
  hs.ghost.y += (hs.hand.y - hs.ghost.y) * k;
  hsPaintGhost();
  hs.raf = requestAnimationFrame(hsFrame);
}

/// While the lanes' take plays back, the point rides along it, as the rack
/// pad's dot did. The engine plays the lanes; this only shows where.
function hsFollowLanes() {
  const path = prismPad.path || [];
  if (hs.down || !engine.playing || path.length < 2 || state.captureArmed) return;
  const frame = playbackTime() * (state.view.sampleRate || 48000);
  const t = prismTargets();
  const span = (state.automation?.lanes || []).find((l) => l.target === t?.[0])?.loop;
  let at = frame;
  if (Array.isArray(span) && span[1] > span[0] && at >= span[0]) at = span[0] + ((at - span[0]) % (span[1] - span[0]));
  let i = path.findIndex(([f]) => f >= at);
  if (i < 0) i = path.length - 1;
  const [f1, x1, y1] = path[i];
  const [f0, x0, y0] = path[Math.max(0, i - 1)];
  const k = f1 > f0 ? Math.max(0, Math.min(1, (at - f0) / (f1 - f0))) : 1;
  const cx = hsControl('x'), cy = hsControl('y');
  if (!cx || !cy) return;
  const x = hsClamp(hsFrac('x', prismUnitValue(cx, x0 + (x1 - x0) * k)));
  const y = hsClamp(hsFrac('y', prismUnitValue(cy, y0 + (y1 - y0) * k)));
  if (x !== hs.hand.x || y !== hs.hand.y) { hs.hand = { x, y }; hsPaintSoon(); }
}

function hsArmedState() {
  return `${!!state.captureArmed}${typeof engine !== 'undefined' && !!engine.playing}`;
}

// ------------------------------------------------------------- drawing

function hsPaintGhost() {
  const g = hs.ghost || hs.hand;
  const ring = $('hsGhost');
  if (!ring) return;
  ring.setAttribute('cx', (g.x * hs.side).toFixed(1));
  ring.setAttribute('cy', (g.y * hs.side).toFixed(1));
  $('hsNow').textContent = `${hsFmt('x', hsValueX(g.x))}  ${hsFmt('y', hsValueY(g.y))}`;
}

/// The chip: what the panel is doing, in Loop or in Lanes.
function hsChipText() {
  const L = 'ABCD'[hs.slot];
  if (hsLanes()) {
    hs.armedShown = hsArmedState();
    if (state.captureArmed && engine.playing) return ['rec', 'REC → lanes · ■ ends the take'];
    if (state.captureArmed) return ['rec', 'ARMED · ▶ starts the take'];
    if (engine.playing) return ['play', `PLAY · lanes${$('prismLoop')?.classList.contains('on') ? ' · LOOP' : ''}`];
    return ['ready', 'READY · ● arms the lanes'];
  }
  return [hs.mode, { ready: 'READY · grab the pad to record', rec: `REC · ${L} · ${hs.loopOnRelease ? 'release to loop' : 'until ▶ or ■'}`, play: `PLAY · ${L}`, pause: `PAUSE · ${L}` }[hs.mode]];
}

function hsPaint() {
  if (!hs.built) return;
  const S = hs.side, lanes = hsLanes();
  const [mode, text] = hsChipText();
  const chip = $('hsChip');
  chip.textContent = text;
  chip.dataset.mode = mode;
  $('dockHyper').dataset.mode = mode;
  $('dockHyper').dataset.where = hs.where;
  document.querySelectorAll('#dockHyper [data-hswhere]').forEach((b) => {
    b.classList.toggle('on', b.dataset.hswhere === hs.where);
    b.setAttribute('aria-pressed', String(b.dataset.hswhere === hs.where));
  });
  // Always there, so the header never re-wraps and resizes the pad: a Lanes control.
  $('prismLoop').disabled = !lanes;

  const cx = hsControl('x'), cy = hsControl('y');
  $('hsXName').textContent = cx?.label || '';
  $('hsYName').textContent = cy?.label || '';

  const hx = hs.hand.x * S, hy = hs.hand.y * S;
  $('hsBall').setAttribute('cx', hx.toFixed(1));
  $('hsBall').setAttribute('cy', hy.toFixed(1));
  $('hsCross').setAttribute('d', `M${(hx - 7).toFixed(1)} ${hy.toFixed(1)}H${(hx + 7).toFixed(1)}M${hx.toFixed(1)} ${(hy - 7).toFixed(1)}V${(hy + 7).toFixed(1)}`);

  const pts = hs.mode === 'rec' && hs.rec ? hs.rec : hs.slots[hs.slot]?.pts || [];
  $('hsPath').setAttribute('points', lanes ? hsLanesPoints() : hsPathPoints(pts));

  // The readout: under the hand while it moves, under the pointer while it hovers.
  const shown = hs.down || (!lanes && hs.mode === 'play') ? hs.hand : hs.hover;
  const read = $('hsRead');
  read.classList.toggle('hidden', !shown);
  if (shown) {
    const px = shown.x * S, py = shown.y * S;
    read.textContent = `${hsFmt('x', hsValueX(shown.x))},  ${hsFmt('y', hsValueY(shown.y))}`;
    read.style.left = `${Math.min(S - 120, Math.max(2, px + 10))}px`;
    read.style.top = `${py - 22 < 6 ? py + 12 : py - 22}px`;
  }

  const take = hs.slots[hs.slot];
  const L = 'ABCD'[hs.slot];
  const targets = typeof prismTargets === 'function' && hsSource() ? prismTargets() : null;
  $('hsInfo').textContent = lanes
    ? `Lanes: ${targets ? targets.join(' / ') : 'the two controls'} · ${(prismPad.path || []).length} points · LOOP wraps both · exported`
    : hs.mode === 'rec' && hs.rec ? `Take ${L} · recording · ${hs.rec.length} points`
      : take ? `Take ${L} · ${(take.dur / 1000).toFixed(2)} s · ${take.pts.length} points · loops at its own length`
        : `Take ${L} empty · grab the pad to record into it`;
  $('hsGestSub').textContent = lanes ? 'Loop only: the lanes hold one take' : 'each loops at its own length';
  $('dockHyper').querySelector('[aria-label="Takes"]').classList.toggle('hs-off', lanes);

  document.querySelectorAll('#dockHyper .hs-slot').forEach((b) => {
    const i = +b.dataset.slot, s = hs.slots[i];
    b.classList.toggle('on', i === hs.slot);
    b.querySelector('[data-len]').textContent = s ? `${(s.dur / 1000).toFixed(1)} s` : '—';
    b.querySelector('[data-thumb]').setAttribute('points', s ? s.pts.filter((_, j) => j % 3 === 0).map((q) => `${(q.x * 100).toFixed(0)},${(q.y * 100).toFixed(0)}`).join(' ') : '');
  });
  document.querySelectorAll('#dockHyper [data-hsrate]').forEach((b) => b.classList.toggle('on', +b.dataset.hsrate === hs.rate));
  document.querySelectorAll('#dockHyper [data-hsdir]').forEach((b) => b.classList.toggle('on', b.dataset.hsdir === hs.dir));

  // Settings: the glide is Time & Pitch's, by the engine; the other sources
  // keep their own smoothing among their settings.
  const src = hsSource();
  const tp = !src || src.id === PRISM_STRETCH;
  $('hsGlideBox').classList.toggle('hidden', !tp);
  // Glide is the engine's glide of Time & Pitch: nothing to hear on another process.
  $('hsGlide').closest('.prism-bar')?.classList.toggle('hidden', !tp);
  $('hsSetSub').textContent = tp ? 'glide, window and cloud' : src.id === PRISM_PTC ? "the process's whole window" : 'every control of the slot';
  const a = hsCoef(hs.glide);
  $('hsGlide').value = hs.glide;
  $('hsGlideV').textContent = `${hs.glide} %`;
  $('hsCoef').textContent = a.toFixed(4);
  $('hsTau').textContent = a >= 1 ? 'instant' : `${((-1 / Math.log(1 - a)) * 512 / 44100).toFixed(2)} s to 63 %`;
  $('hsThrow').checked = hs.throwOn;
  $('hsLoopRelease').checked = hs.loopOnRelease;
  $('hsRec').classList.toggle('on', mode === 'rec');
}

// ------------------------------------------------------------- the page

/// The Prism page is out, or not: the glide is the pad's, so it is on while
/// the pad is and back to none when it goes.
function hyperStretchShown(on) {
  if (on && !hs.built) hsBuild();
  if (on === hs.shown) return;
  hs.shown = on;
  if (on) {
    prismSoundFill();
    prismDeckShow();
    const open = state.selectedFile?.path;
    if (!prismDeck.path || (prismDeck.borrowed && open && open !== prismDeck.path)) {
      let last = '';
      try { last = localStorage.getItem('prism.sound') || ''; } catch { /* private mode */ }
      // Nothing chosen yet: the file that is open, so the Process menu and
      // every effect's controls are there without a second trip to a picker.
      if (last) prismDeckUse(last);
      else if (open) prismDeckUse(open, { chosen: false });
      else hsOpen();
    } else hsOpen();
    hsSendGlide();
    hs.last = 0;
    if (!hs.raf) hs.raf = requestAnimationFrame(hsFrame);
    requestAnimationFrame(hsFit);
    hsPaint();
  } else {
    if (hs.mode === 'rec') hsStopRec(performance.now());
    if (hs.mode === 'play') hs.mode = 'ready';
  }
}

// The dock panel is shown and hidden by the dock's own tab code; this follows it.
(() => {
  const host = document.getElementById('dockHyper');
  if (!host) return;
  const dock = document.getElementById('dock');
  const follow = () => hyperStretchShown(!host.classList.contains('hidden') && !dock?.classList.contains('hidden'));
  new MutationObserver(follow).observe(host, { attributes: true, attributeFilter: ['class'] });
  if (dock) new MutationObserver(follow).observe(dock, { attributes: true, attributeFilter: ['class'] });
})();

/// For the tests, and for anyone asking from the console.
window.hyperStretch = {
  limits: () => ({ ...hs.lim }),
  hand: () => ({ ...hs.hand }),
  side: () => hs.side,
  where: () => hs.where,
  take: (i) => hs.slots[i] && { dur: hs.slots[i].dur, pts: hs.slots[i].pts.map((q) => ({ ...q })) },
  values: (i) => (hs.slots[i]?.pts || []).map((q) => ({ [hs.axes.x]: hsValueX(q.x), [hs.axes.y]: hsValueY(q.y) })),
  motion: () => ({ rate: hs.rate, dir: hs.dir }),
  /// Time & Pitch with its own window, in Loop, and nothing taken.
  reset: () => {
    hs.slots = [null, null, null, null]; hs.rec = null; hs.mode = 'ready'; hs.slot = 0;
    hs.loopOnRelease = false; hs.throwOn = false; hs.rate = 1; hs.dir = 'fwd'; hs.where = 'loop';
    if (prismDeck.rack.pads?.[PRISM_STRETCH]) { delete prismDeck.rack.pads[PRISM_STRETCH]; prismPushRack(); }
    if (prismPad.source !== PRISM_STRETCH && prismPad.sources.length) { prismPad.source = PRISM_STRETCH; prismRenderBar(); }
    hs.axes = { x: null, y: null };
    hsSetupChanged();
    hsSaveTakes();
    hsPaint();
  },
};
