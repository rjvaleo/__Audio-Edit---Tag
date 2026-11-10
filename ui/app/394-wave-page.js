// ================================================================ Wave: the page
//
// The shell around the four views: the header (views, preset, A/B, what you
// hear, the master), the dock (wheels, keys, the morph puck, the macros), the
// fit, the frame loop, and coming and going. `setMode('synth')` calls
// `wvEnter` and leaving calls `wvLeave`; nothing here runs while the page is
// not on screen, and the telemetry stops with it. v7 adds the page's own
// tooltips and the keys' glide.

const WV_W = 1460;
const WV_H = 862;

/// The computer keys, in pitch order: A–K the whites, W–U the blacks, and on
/// past K as far as the row goes. The same letters the Edit page plays.
const WV_QWERTY = 'awsedftgyhujkolp;';

const WV_VIEWS = [
  ['play', 'Play', 'M1 8 C3 2,5 2,7 6 S11 11,15 4'],
  ['create', 'Create', 'M2 10 L9 3 L12 6 L5 13 Z'],
  ['matrix', 'Matrix', 'M2 3h12M2 6h12M2 9h12M5 1v10M10 1v10'],
  ['fx', 'FX', 'M2 9 C5 9,5 3,8 3 S11 9,14 9'],
];

function wvBuild() {
  const host = $('waveView');
  host.innerHTML = '';
  const app = wvH(`<div class="wv-app">
   <div class="wv-head">
    <div class="wv-tabs" id="wvViews" role="tablist">${WV_VIEWS.map(([k, n, d]) => `<div class="wv-tab" data-v="${k}" role="tab" title="${n}"><svg viewBox="0 0 16 12"><path d="${d}"/></svg>${n}</div>`).join('')}</div>
    <select class="wv-midi" id="wvMidiCh" title="MIDI channel: this instrument plays only what arrives on this channel. Grain has its own, on its page"></select>
    <div class="wv-preset wv-btn" id="wvPresetBtn" title="Presets: click for the shelf">
     <div class="wv-ib" data-step="-1" title="Previous preset"><svg viewBox="0 0 12 12"><path d="M8 2 L4 6 L8 10"/></svg></div>
     <span class="pn" id="wvPresetName"></span><span class="pt" id="wvPresetTags"></span>
     <div class="wv-ib" data-step="1" title="Next preset"><svg viewBox="0 0 12 12"><path d="M4 2 L8 6 L4 10"/></svg></div></div>
    <div class="wv-seg" id="wvAB" title="A / B: compare two versions of the patch"><span data-k="A">A</span><span data-k="B">B</span></div>
    <div class="wv-well" title="Output: what you hear"><canvas id="wvOutWave" data-w="340" data-h="30"></canvas></div>
    <span class="wv-sp"></span>
    <span class="wv-offline" id="wvOffline" hidden title="The synth engine did not answer; this is the page's own default patch"><i></i>engine not connected</span>
    <span class="wv-ro" id="wvVoicesRo">0 voices</span>
    <canvas id="wvMaster" class="wv-well" data-w="120" data-h="22" title="Master: what comes out. Drag across for the volume"></canvas>
   </div>
   <section class="wv-view" id="wvViewPlay"></section>
   <section class="wv-view" id="wvViewCreate"></section>
   <section class="wv-view" id="wvViewMatrix"></section>
   <section class="wv-view" id="wvViewFx" style="flex-direction:column"></section>
   <div class="wv-dock">
    <div class="wv-wheels"><canvas class="wv-well wv-wheel" id="wvBend" data-w="30" data-h="100" title="Pitch bend: drag up and down. Springs back when let go"></canvas><canvas class="wv-well wv-wheel" id="wvModw" data-w="30" data-h="100" title="Mod wheel: drag up and down. Stays where you leave it"></canvas></div>
    <div class="wv-kbinfo"><div class="wv-seg" id="wvOct"><span data-oct="-1" title="An octave down (Z)">−</span><span class="on wv-mono" id="wvOctRo"></span><span data-oct="1" title="An octave up (X)">+</span></div>
     <div class="wv-hint" title="Playing: drag across the keys to glide from note to note. Hold Shift while you drag and every key you cross keeps sounding, a strummed chord.">Keys: A–K, W–U<br>Drag to glide<br>⇧ drag holds</div><span class="wv-ro" id="wvVelRo">vel —</span></div>
    <div class="wv-keys"><canvas id="wvKeys" data-w="604" data-h="100" title="Keys: click to play, lower on a key is louder. Drag to glide; Shift-drag keeps every key you cross sounding"></canvas></div>
    <div class="wv-well" title="Morph: drag. Osc A's position across, Filter 1's brightness up"><canvas id="wvPuck" data-w="100" data-h="100"></canvas></div>
    <div class="wv-macrodock" id="wvMacros">${WV_MACRO_NAMES.map((n, i) => `<div class="wv-cell c">${wvKnobEl(`wvMac${i}`, 46, 1, `macro${i}`)}<div class="wv-lab"><span id="wvMacn${i}"></span><b id="wvMacr${i}"></b></div></div>`).join('')}</div>
   </div>
   <div class="wv-menu" id="wvMenu" hidden></div>
   <div class="wv-menu wv-shelf" id="wvShelf" hidden></div>
  </div>`);
  host.appendChild(app);
  wvBuildPlay($('wvViewPlay'));
  wvBuildCreate($('wvViewCreate'));
  wvBuildMatrix($('wvViewMatrix'));
  wvBuildFx($('wvViewFx'));
  for (const el of app.querySelectorAll('canvas[data-w][id]')) WVW[el.id] = wvCv(el);
  WV.built = true;
  wvWirePlay();
  wvWireCreate();
  wvWireFx();
  wvWirePage();
  wvDrawLibWave();
  wvShowView(WV.view);
  wvSyncAll();
  wvInitTips();
  new ResizeObserver(wvFit).observe(host);
  // The light on the knob caps follows the pointer, as it did in the mock-up.
  host.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    host.style.setProperty('--lx', (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
    host.style.setProperty('--ly', (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
  });
}

function wvWirePage() {
  document.querySelectorAll('#wvViews .wv-tab').forEach((t) => t.addEventListener('click', () => wvShowView(t.dataset.v)));
  $('wvPresetBtn').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) wvStepPreset(+step.dataset.step);
    else wvOpenShelf();
  });
  document.querySelectorAll('#wvAB span').forEach((s) => s.addEventListener('click', () => wvSwitchAB(s.dataset.k)));
  document.querySelectorAll('#wvOct [data-oct]').forEach((s) => s.addEventListener('click', () => wvShiftOct(+s.dataset.oct)));
  wvDrag(WVW.wvMaster.el, (dx) => wvLive('master', wvClamp(wvG('master') + dx / 110)));

  wvGlideKeys(WVW.wvKeys);
  wvDrag(WVW.wvModw.el, (dx, dy) => { WV.mw = wvClamp(WV.mw - dy / 90); wvSendControl({ mw: WV.mw }); });
  wvDrag(WVW.wvBend.el, (dx, dy) => { WV.bend = wvClamp(WV.bend - dy / 50, -1, 1); wvSendControl({ bend: WV.bend }); },
    null, () => { WV.bend = 0; wvSendControl({ bend: 0 }); });

  const pg = WVW.wvPuck;
  WV.trail = [];
  const setPuck = (e) => {
    const [x, y] = wvLocal(pg.el, e), px = wvClamp((x - 6) / (pg.w - 12)), py = wvClamp(1 - (y - 6) / (pg.h - 12));
    wvLive('osc0.pos', px);
    wvLive('filt0.cut', 0.2 + 0.7 * py);
    WV.trail.push([px, py, performance.now()]);
  };
  wvDrag(pg.el, (a, b, e) => setPuck(e), setPuck);
  for (let i = 0; i < 8; i++) wvV('wvMac' + i, 'macro' + i);
}

function wvShowView(v) {
  WV.view = v;
  document.querySelectorAll('#wvViews .wv-tab').forEach((x) => {
    x.classList.toggle('on', x.dataset.v === v);
    x.setAttribute('aria-selected', String(x.dataset.v === v));
  });
  const ids = { play: 'wvViewPlay', create: 'wvViewCreate', matrix: 'wvViewMatrix', fx: 'wvViewFx' };
  for (const [k, id] of Object.entries(ids)) document.getElementById(id).classList.toggle('on', k === v);
  if (v === 'matrix') wvRenderMatrix();
  if (v === 'create') wvSyncCreate();
  // Badges are fitted to their headers, which only have a width on screen.
  if (v === 'play') wvRenderBadges();
  wvCloseMenus();
}

/// Scale the page whole to fit the centre: the same page smaller, never a
/// cropped one. Measured against the centre, not the window.
function wvFit() {
  const host = $('waveView'), app = host && host.querySelector('.wv-app');
  if (!app) return;
  const cw = host.clientWidth, ch = host.clientHeight;
  if (!cw || !ch) return;
  const s = Math.min(cw / WV_W, ch / WV_H, 1.3);
  WV.scale = s;
  app.style.transform = `translate(${Math.floor((cw - WV_W * s) / 2)}px, 0px) scale(${s})`;
}

function wvSyncSoon() {
  if (!WV.built || WV.syncQueued) return;
  WV.syncQueued = true;
  queueMicrotask(() => { WV.syncQueued = false; wvSyncAll(); });
}

function wvSyncAll() {
  if (!WV.built) return;
  wvSyncPlay();
  wvSyncCreate();
  wvSyncFx();
  wvRenderMatrix();
  wvTxt('wvPresetName', WV.name);
  wvTxt('wvPresetTags', WV.tags);
  document.querySelectorAll('#wvAB span').forEach((x) => x.classList.toggle('on', x.dataset.k === WV.ab));
  wvTxt('wvOctRo', wvNoteName(WV.kbLo));
  for (let i = 0; i < 8; i++) wvTxt('wvMacn' + i, WV.macroNames[i]);
}

function wvShiftOct(by) {
  WV.kbLo = Math.max(12, Math.min(96, WV.kbLo + by * 12));
  wvTxt('wvOctRo', wvNoteName(WV.kbLo));
}

// ─────────────────────────────────────────────────────────── coming and going

function wvEnter() {
  if (!WV.built) wvBuild();
  gsWireMidiChannel($('wvMidiCh'), 'wave');
  gsMidiSend();
  WV.showing = true;
  wvFit();
  wvSyncCreate();
  if (WV.view === 'play') wvRenderBadges();
  // Every visit asks again, so an engine that has started since is found.
  wvConnect().then((ok) => { if (ok && WV.showing) wvPollStart(); });
  if (!WV.raf) WV.raf = requestAnimationFrame(wvFrame);
}

function wvLeave() {
  WV.showing = false;
  wvPollStop();
  wvReleaseAll();
  wvHideTip();
  wvCloseMenus();
  if (WV.raf) cancelAnimationFrame(WV.raf);
  WV.raf = 0;
}

/// Every note this page started, stopped. On leaving, and when the window
/// loses focus with a key down, which would otherwise never see its key-up.
function wvReleaseAll() {
  for (const n of [...WV.held.keys()]) wvNote(n, 0, false);
  WV.keyNotes.clear();
}
WV.keyNotes = new Map();
window.addEventListener('blur', () => { if (WV.showing) wvReleaseAll(); });

/// A key, from the app's one keydown dispatcher (`320-keyboard.js`). True when
/// it was this page's: a note, Z or X for the octave, ⌘Z in Create, or Escape
/// with a menu open.
function wvKeyDown(e) {
  if (state.mode !== 'synth') return false;
  if (e.key === 'Escape') {
    if (!wvCloseMenus()) return false;
    e.preventDefault();
    return true;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && WV.view === 'create') { e.preventDefault(); wvUndo(); return true; }
  if (mod || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'x') { e.preventDefault(); if (!e.repeat) wvShiftOct(k === 'z' ? -1 : 1); return true; }
  const i = WV_QWERTY.indexOf(k);
  if (i < 0) return false;
  e.preventDefault();
  if (!e.repeat && !WV.keyNotes.has(k)) {
    const n = WV.kbLo + 12 + i;
    WV.keyNotes.set(k, n);
    wvNote(n, 0.8, true);
    wvTxt('wvVelRo', 'vel ' + Math.round(0.8 * 127));
  }
  return true;
}

function wvKeyUp(e) {
  const k = e.key.toLowerCase(), n = WV.keyNotes.get(k);
  if (n == null) return;
  WV.keyNotes.delete(k);
  wvNote(n, 0, false);
}

// ─────────────────────────────────────────────────────────────── the frame

function wvFrame(ts) {
  if (!WV.showing) { WV.raf = 0; return; }
  const t = ts / 1000;
  if (WV.view === 'play') wvDrawPlay(t);
  else if (WV.view === 'create') wvDrawCreate(t);
  else if (WV.view === 'matrix') wvDrawMatrix(t);
  else if (WV.view === 'fx') wvDrawFx(t);
  wvDrawKeys();
  wvDrawPuck();
  wvDrawOut(t);
  wvDrawWheel(WVW.wvBend, WV.bend, true);
  wvDrawWheel(WVW.wvModw, WV.mw, false);
  wvDrawMaster();
  wvTipTick(ts);
  for (let i = 0; i < 8; i++) {
    wvDrawMacro(i);
    wvTxt('wvMacr' + i, String(Math.round(wvG('macro' + i) * 100)));
  }
  const n = wvVoices().length;
  wvTxt('wvVoicesRo', n + ' voice' + (n === 1 ? '' : 's'));
  WV.raf = requestAnimationFrame(wvFrame);
}

// ─────────────────────────────────────────────────────────────── the dock

const wvIsBlack = (n) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

function wvKeyLayout(g) {
  const lo = WV.kbLo, whites = [];
  for (let n = lo; n < lo + 37; n++) if (!wvIsBlack(n)) whites.push(n);
  const ww = g.w / whites.length, pos = {};
  whites.forEach((n, i) => { pos[n] = [i * ww, ww, false]; });
  for (let n = lo; n < lo + 37; n++) if (wvIsBlack(n)) pos[n] = [pos[n - 1][0] + ww * 0.68, ww * 0.64, true];
  return pos;
}

function wvKeyAt(g, x, y) {
  const L = wvKeyLayout(g);
  for (const n in L) { const [k, w, b] = L[n]; if (b && x >= k && x < k + w && y < g.h * 0.6) return +n; }
  for (const n in L) { const [k, w, b] = L[n]; if (!b && x >= k && x < k + w) return +n; }
  return null;
}

function wvDrawKeys() {
  const g = WVW.wvKeys, { c, w, h } = g, cl = wvCl(), L = wvKeyLayout(g);
  const on = new Set([...WV.held.keys(), ...wvVoices().filter((v) => wvStage(v) !== 'r').map((v) => +v.note)]);
  const hue = 205 - 175 * wvClamp(wvG('osc0.pos'));
  c.clearRect(0, 0, w, h);
  for (const n in L) {
    const [x, ww, b] = L[n];
    if (b) continue;
    const lit = on.has(+n), gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, lit ? `hsl(${hue},35%,30%)` : '#2b2e34');
    gr.addColorStop(1, lit ? `hsl(${hue},45%,22%)` : '#1d1f23');
    c.fillStyle = gr;
    c.beginPath(); c.roundRect(x + 1, 0, ww - 2, h - 1, [0, 0, 4, 4]); c.fill();
    c.fillStyle = 'rgba(255,255,255,.07)';
    c.fillRect(x + 1, 0, ww - 2, 1);
    c.fillStyle = 'rgba(0,0,0,.45)';
    c.fillRect(x + ww - 2, 0, 1, h - 1);
    if (lit) {
      c.fillStyle = `hsl(${hue},70%,62%)`;
      c.shadowBlur = 10;
      c.shadowColor = c.fillStyle;
      c.fillRect(x + 3, h - 9, ww - 6, 4);
      c.shadowBlur = 0;
    }
    if (+n % 12 === 0) {
      c.fillStyle = cl.t3;
      c.font = `9px ${cl.sans}`;
      c.fillText('C' + (Math.floor(+n / 12) - 1), x + 4, h - 12);
    }
  }
  for (const n in L) {
    const [x, ww, b] = L[n];
    if (!b) continue;
    const lit = on.has(+n), gr = c.createLinearGradient(0, 0, 0, h * 0.6);
    gr.addColorStop(0, lit ? '#2c3038' : '#131417');
    gr.addColorStop(1, lit ? '#1d2026' : '#060708');
    c.fillStyle = gr;
    c.shadowBlur = 4;
    c.shadowColor = 'rgba(0,0,0,.7)';
    c.beginPath(); c.roundRect(x, 0, ww, h * 0.6, [0, 0, 3, 3]); c.fill();
    c.shadowBlur = 0;
    if (lit) { c.fillStyle = `hsl(${hue},70%,62%)`; c.fillRect(x + 2, h * 0.6 - 7, ww - 4, 3); }
  }
}

function wvDrawWheel(g, v, bip) {
  const { c, w, h } = g, cl = wvCl(), rest = bip ? h / 2 : h - 6, y = bip ? h / 2 - v * (h / 2 - 8) : h - 6 - v * (h - 12);
  c.clearRect(0, 0, w, h);
  for (let yy = 6; yy < h - 4; yy += 4) { c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(6, yy, w - 12, 1); }
  const gr = c.createLinearGradient(0, rest, 0, y);
  gr.addColorStop(0, `color-mix(in srgb,${cl.acc} 10%,transparent)`);
  gr.addColorStop(1, `color-mix(in srgb,${cl.acc} 55%,transparent)`);
  c.fillStyle = gr;
  c.fillRect(5, Math.min(rest, y), w - 10, Math.abs(rest - y));
  c.fillStyle = cl.t;
  c.shadowBlur = 8;
  c.shadowColor = cl.acc;
  c.beginPath(); c.roundRect(4, y - 2, w - 8, 4, 2); c.fill();
  c.shadowBlur = 0;
  c.fillStyle = cl.t3;
  c.font = `9px ${cl.mono}`;
  c.textAlign = 'center';
  c.fillText(bip ? 'PB' : 'MOD', w / 2, 10);
  c.textAlign = 'left';
}

/// The morph puck: the table's frames across, brightness up, and the dot
/// where osc A's position and Filter 1's cutoff put it.
function wvDrawPuck() {
  const g = WVW.wvPuck, { c, w, h } = g, cl = wvCl(), T = wvTable(wvG('osc0.table'));
  c.clearRect(0, 0, w, h);
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const f = wvFrameAt(T, gx / 3), cw = (w - 12) / 4, ch = (h - 12) / 4, x0 = 6 + gx * cw, y0 = 6 + (3 - gy) * ch;
      c.strokeStyle = `rgba(${cl.bloom},${0.08 + 0.14 * gy / 3})`;
      c.lineWidth = 1;
      c.stroke(wvPath((u) => [x0 + 3 + u * (cw - 6), y0 + ch / 2 - wvRd(f, u) * ch * 0.3 * (0.5 + gy / 6)], 20));
    }
  }
  const now = performance.now();
  WV.trail = (WV.trail || []).filter((p) => now - p[2] < 1500);
  for (const p of WV.trail) {
    const a = 1 - (now - p[2]) / 1500;
    c.fillStyle = `color-mix(in srgb,${cl.acc} ${Math.round(a * 60)}%,transparent)`;
    c.beginPath(); c.arc(6 + p[0] * (w - 12), 6 + (1 - p[1]) * (h - 12), 2 * a + 0.5, 0, WV_TAU); c.fill();
  }
  wvDot(c, 6 + wvClamp(wvG('osc0.pos')) * (w - 12), 6 + (1 - wvClamp((wvG('filt0.cut') - 0.2) / 0.7)) * (h - 12), 4.5, cl.acc);
}

/// What you hear: the engine's output wave when it sends one, otherwise the
/// sounding oscillators' cycles summed and scaled by its output peak. Flat
/// when nothing sounds.
function wvDrawOut(t) {
  const g = WVW.wvOutWave, { c, w, h } = g, cl = wvCl(), T = WV.tele;
  c.clearRect(0, 0, w, h);
  const wave = T && Array.isArray(T.wave) && T.wave.length > 1 ? T.wave : null;
  const peak = T && Array.isArray(T.peak) ? Math.max(0, ...T.peak.map((x) => +x || 0)) : 0;
  if (!wave && (!wvVoices().length || peak <= 0)) {
    c.strokeStyle = `rgba(${cl.bloom},.15)`;
    c.beginPath(); c.moveTo(6, h / 2); c.lineTo(w - 6, h / 2); c.stroke();
    return;
  }
  if (wave) {
    wvTrace(c, wvPath((u) => [6 + u * (w - 12), h / 2 - wvClamp(wave[Math.min(wave.length - 1, Math.round(u * (wave.length - 1)))], -1, 1) * h * 0.42], Math.min(300, wave.length)), cl, 1.2, 0.6);
    return;
  }
  const ws = [0, 1, 2].filter((i) => wvG(`osc${i}.on`)).map((i) => [wvWaveFor(i), wvG(`osc${i}.level`) ** 2, Math.pow(2, Math.round((wvG(`osc${i}.pitch`) - 0.5) * 48) / 12)]);
  if (!ws.length) return;
  const ph = t * 3, norm = ws.reduce((a, x) => a + x[1], 0) || 1;
  wvTrace(c, wvPath((u) => {
    let y = 0;
    for (const [f, l, r] of ws) y += wvRd(f, (u * 4 + ph) * r) * l;
    return [6 + u * (w - 12), h / 2 - y / norm * wvClamp(peak) * h * 0.42];
  }, 300), cl, 1.2, 0.6);
}

/// The master: the engine's output peak as a row of cells, and the volume as
/// a bar across them.
function wvDrawMaster() {
  const g = WVW.wvMaster, { c, w, h } = g, cl = wvCl(), T = WV.tele;
  const lvl = T && Array.isArray(T.peak) ? wvClamp(Math.max(0, ...T.peak.map((x) => +x || 0))) : 0;
  c.clearRect(0, 0, w, h);
  for (let i = 0; i < 24; i++) {
    const on = i / 24 < lvl;
    c.fillStyle = on ? (i > 20 ? cl.acc : `rgba(${cl.bloom},.8)`) : 'rgba(255,255,255,.06)';
    c.fillRect(4 + i * 4.7, 6, 3, 10);
  }
  const x = 4 + wvClamp(wvG('master')) * (w - 8);
  c.fillStyle = cl.t;
  c.beginPath(); c.roundRect(x - 1.5, 2, 3, h - 4, 1.5); c.fill();
}

/// A macro's face: what it does, drawn, and a notch on the rim for every
/// route it drives.
function wvDrawMacro(i) {
  const k = WVW['wvMac' + i];
  if (!k) return;
  const { c, w, h } = k, cl = wvCl(), v = wvG('macro' + i), cx = w / 2, cy = h / 2, r = w * 0.26;
  c.clearRect(0, 0, w, h);
  const m = wvModOf('macro' + i);
  wvRing(k, v, { cl: wvClFor(m), inset: 4, mod: m.rng, live: m.live });
  c.save();
  c.strokeStyle = cl.wave;
  c.fillStyle = `rgba(${cl.bloom},.8)`;
  c.lineWidth = 1.3;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const L = cx - r;
  switch (i) {
    case 0: for (let q = 0; q < 6; q++) { const hh = r * 1.4 * (0.25 + 0.75 * Math.pow(1 - q / 6, 2 - 1.8 * v)); c.fillRect(L + q * r / 3 + 1, cy + r * 0.7 - hh, r / 5, hh); } break;
    case 1: c.stroke(wvPath((u) => [L + u * 2 * r, cy - Math.sin(u * WV_TAU * 2) * r * 0.7 * v], 40)); break;
    case 2: {
      const d = r * 0.2 + r * 0.75 * v;
      c.beginPath();
      c.moveTo(cx - d, cy - 4); c.lineTo(cx - d - 4, cy); c.lineTo(cx - d, cy + 4);
      c.moveTo(cx + d, cy - 4); c.lineTo(cx + d + 4, cy); c.lineTo(cx + d, cy + 4);
      c.moveTo(cx - d, cy); c.lineTo(cx + d, cy);
      c.stroke();
      break;
    }
    case 3: c.stroke(wvPath((u) => { let y = Math.sin(u * WV_TAU) * (1 + v * 4), g = 0; while (Math.abs(y) > 1 && g++ < 9) y = y > 1 ? 2 - y : -2 - y; return [L + u * 2 * r, cy - y * r * 0.7]; }, 60)); break;
    case 4: for (let q = 0; q < 5; q++) { const a = Math.pow(0.35 + 0.55 * v, q); c.globalAlpha = a; c.fillRect(L + q * r * 0.42, cy + r * 0.7 - r * 1.4 * a, 2, r * 1.4 * a); } break;
    case 5: { const f = wvFrameAt(wvTable(wvG('osc0.table')), v); c.stroke(wvPath((u) => [L + u * 2 * r, cy - wvRd(f, u) * r * 0.7], 50)); break; }
    case 6: c.stroke(wvPath((u) => [L + u * 2 * r, cy + r * 0.7 - Math.min(1, u / (0.05 + v * 0.9)) * r * 1.4], 40)); break;
    default: c.stroke(wvPath((u) => [L + u * 2 * r, cy + r * 0.2 - (1 / (1 + Math.exp(-(u - 0.6) * 12))) * r * 0.9 * v], 40));
  }
  c.restore();
  const n = WV.mods.filter((x) => x.src === 'macro' + i || x.via === 'macro' + i).length;
  for (let q = 0; q < n; q++) {
    const a = Math.PI * 0.75 + Math.PI * 1.5 * (q + 0.5) / n;
    c.fillStyle = cl.mod;
    c.beginPath(); c.arc(cx + Math.cos(a) * (w / 2 - 0.5), cy + Math.sin(a) * (w / 2 - 0.5), 1.3, 0, WV_TAU); c.fill();
  }
}

// ─────────────────────────────────────────────────────────── v7: the keys
//
// Dragging across the keys glides: each new key plays and the one before it
// stops. Hold Shift and every key crossed keeps sounding until the mouse comes
// up, a strummed chord. Lower on a key is louder, as for a click.

function wvGlideKeys(g) {
  g.el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    g.el.setPointerCapture(e.pointerId);
    const held = new Set();
    let cur = null;
    const go = (ev) => {
      const [x, y] = wvLocal(g.el, ev), n = wvKeyAt(g, x, y);
      if (n == null || n === cur) return;
      if (cur != null && !ev.shiftKey) { wvNote(cur, 0, false); held.delete(cur); }
      cur = n;
      if (held.has(n)) return;
      const vel = 0.4 + 0.6 * wvClamp(y / g.h);
      wvNote(n, vel, true);
      held.add(n);
      wvTxt('wvVelRo', 'vel ' + Math.round(vel * 127));
    };
    const up = () => {
      g.el.removeEventListener('pointermove', go);
      g.el.removeEventListener('pointerup', up);
      g.el.removeEventListener('pointercancel', up);
      for (const n of held) wvNote(n, 0, false);
      held.clear();
    };
    go(e);
    g.el.addEventListener('pointermove', go);
    g.el.addEventListener('pointerup', up);
    g.el.addEventListener('pointercancel', up);
  });
}

// ─────────────────────────────────────────────────────────── v7: tooltips
//
// Fast, and the page's own: a control's name, what it is set to, what is
// moving it, and how to play it. Every `title` on the page becomes one of
// these, so no browser tooltip is left. The tip hangs on #waveView, outside
// the scaled page, so it reads at full size however small the page is drawn.

const WV_TIP = { el: null, on: null, timer: 0, at: 0 };

const WV_TIP_NAME = { pos: 'Frame position', 'warp0.amt': 'Warp 1', 'warp1.amt': 'Warp 2', 'uni.det': 'Unison', 'fx.a': 'Effect', pitch: 'Pitch', phase: 'Start phase', pan: 'Pan', level: 'Level', cut: 'Cutoff and resonance', drive: 'Drive', key: 'Key tracking' };
const WV_TIP_HOW = {
  pos: 'Drag across: move through the table · up and down: tilt the view',
  'warp0.amt': 'Drag up and down: amount · click the glyph below to pick a warp',
  'warp1.amt': 'Drag up and down: amount · click the glyph below to pick a warp',
  'uni.det': 'Drag up and down: detune · Shift-drag: width · scroll: voices',
  'fx.a': 'Drag across: mix · up and down: its character · click the icon to pick the effect',
  pitch: 'Drag up and down: semitones · Shift-drag: fine',
  phase: 'Drag up and down: where each note starts · Alt-drag: random start',
  pan: 'Drag up and down: left to right',
  level: 'Click or drag across',
  cut: 'Drag across: cutoff · up and down: resonance',
  key: 'Drag up and down: how far the cutoff follows the note',
  glide: 'Drag across',
};
const wvPct = (v) => Math.round(v * 100) + ' %';

/// A destination's name, its value as you would say it, and how to drag it.
function wvTipParts(t) {
  const g = wvG;
  let m = /^(?:osc)(\d)\.(.+)$/.exec(t);
  if (m) {
    const k = `osc${m[1]}.`, f = m[2];
    let v = '';
    if (f === 'pos') { const T = wvTable(g(k + 'table')); v = `Frame ${Math.round(wvClamp(g(t)) * (T.length - 1)) + 1} of ${T.length} · ${g(k + 'table')}`; }
    else if (/^warp\d\.amt$/.test(f)) { const md = g(`${k}${f.slice(0, 5)}.mode`); v = md === 'off' ? 'None yet' : `${(WV_WARPS[md] || WV_WARPS.off).name} · ${wvPct(g(t))}`; }
    else if (f === 'uni.det') v = `${g(k + 'uni.n')} voices · ±${Math.round(g(t) * 60)} cents · width ${wvPct(g(k + 'uni.spr'))}`;
    else if (f === 'fx.a') v = `${(WV_OFX[g(k + 'fx.mode')] || WV_OFX.off).name} · mix ${wvPct(g(t))}`;
    else if (f === 'pitch') { const st = Math.round((g(t) - 0.5) * 48), c = Math.round((g(k + 'fine') - 0.5) * 200); v = `${st > 0 ? '+' : ''}${st} semitones${c ? ` ${c > 0 ? '+' : ''}${c} cents` : ''}`; }
    else if (f === 'phase') v = `${Math.round(g(t) * 360)}° · random ${wvPct(g(k + 'rand'))}`;
    else if (f === 'pan') { const pn = Math.round((g(t) - 0.5) * 200); v = pn ? (pn < 0 ? 'Left ' : 'Right ') + Math.abs(pn) : 'Centre'; }
    else if (f === 'level') v = `${wvDbTxt(g(t))} dB${g(k + 'on') ? '' : ' · switched off'}`;
    else v = wvPct(g(t));
    return [`Osc ${'ABC'[+m[1]]} · ${WV_TIP_NAME[f] || f}`, v, WV_TIP_HOW[f]];
  }
  m = /^(?:filt)(\d)\.(.+)$/.exec(t);
  if (m) {
    const k = `filt${m[1]}.`, f = m[2];
    const v = f === 'cut' ? `${wvFmtHz(wvCutHz(g(t)))} · Q ${(0.7 + g(k + 'res') * 9).toFixed(1)}` : wvPct(g(t));
    return [`Filter ${+m[1] + 1} · ${WV_TIP_NAME[f] || f}`, v, WV_TIP_HOW[f]];
  }
  if (t === 'sub.level') return ['Sub level', `${['Sine', 'Triangle', 'Square'][g('sub.shape')] || 'Sine'} · ${g('sub.oct')} octave${g('sub.oct') > 1 ? 's' : ''} down · ${wvDbTxt(g(t))} dB${g('sub.on') ? '' : ' · switched off'}`, WV_TIP_HOW.level];
  if (t === 'noise.level') return ['Noise level', `${['White', 'Pink', 'Brown'][g('noise.color')] || 'Pink'} · ${wvDbTxt(g(t))} dB${g('noise.on') ? '' : ' · switched off'}`, WV_TIP_HOW.level];
  if (t === 'voice.glide') return ['Glide', g(t) > 0.005 ? wvFmtMs(g(t) ** 2 * 2) : 'Off', WV_TIP_HOW.glide];
  m = /^(?:macro)(\d)$/.exec(t);
  if (m) return [`Macro · ${WV.macroNames[+m[1]]}`, wvPct(g(t)), null];
  m = /^(?:fx)(\d)\.k(\d)$/.exec(t);
  if (m) {
    const f = WV_FX_CHAIN[+m[1]], v = g(t);
    return [`${f.n} · ${f.kn[+m[2]]}`, f.n === 'EQ' ? `${((v - 0.5) * 30).toFixed(1)} dB` : wvPct(v), null];
  }
  return [wvDstName(t), '', null];
}

/// A route, as the tip draws it: a badge with how far the source moves it.
const wvTipBadge = (m) => `<span class="wv-badge" style="--c:${wvSrcColour(m.src)}">${wvSrcGlyph(m.src)}${wvEsc(wvSrcName(m.src))}<i>moves it ${m.amt > 0 ? '+' : ''}${Math.round(m.amt * 100)} %</i></span>`;

function wvFillTip(el) {
  const tip = WV_TIP.el;
  if (el.dataset.bs != null && !el.dataset.tip) {
    const m = WV.mods.find((x) => x.src === el.dataset.bs && x.dst === el.dataset.bt);
    const tab = wvSrcIndex(el.dataset.bs) >= 0;
    tip.innerHTML = `<b>${wvEsc(wvSrcName(el.dataset.bs))} → ${wvEsc(wvDstName(el.dataset.bt))}</b>`
      + (m ? `<div class="v">moves it by ${m.amt > 0 ? '+' : ''}${Math.round(m.amt * 100)} %</div>` : '')
      + `<div class="h">${tab ? `Click to open ${wvEsc(wvSrcName(el.dataset.bs))} in Modulate` : 'Change it in the Matrix'}</div>`;
    return;
  }
  const t = el.dataset.tgt;
  if (t) {
    const [nm, v, how] = wvTipParts(t), ms = WV.mods.filter((m) => m.dst === t);
    tip.innerHTML = `<b>${wvEsc(nm)}</b>${v ? `<div class="v">${wvEsc(v)}</div>` : ''}`
      + (ms.length ? `<div class="mv">${ms.map(wvTipBadge).join('')}</div>` : '')
      + `<div class="h">${wvEsc(how || 'Drag up and down')} · drop a source here to modulate it</div>`;
    return;
  }
  const [h, ...r] = (el.dataset.tip || '').split(': ');
  tip.innerHTML = `<b>${wvEsc(h)}</b>${r.length ? `<div class="h">${wvEsc(r.join(': '))}</div>` : ''}`;
}

function wvShowTip(el) {
  const host = $('waveView'), tip = WV_TIP.el;
  if (!tip || !WV.showing || !host.contains(el)) return;
  wvFillTip(el);
  tip.hidden = false;
  const hr = host.getBoundingClientRect(), r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let y = r.bottom - hr.top + 8;
  if (y + th > hr.height - 6) y = r.top - hr.top - th - 8;
  tip.style.left = Math.round(wvClamp(r.left - hr.left + r.width / 2 - tw / 2, 6, Math.max(6, hr.width - tw - 6))) + 'px';
  tip.style.top = Math.round(Math.max(6, y)) + 'px';
}

function wvHideTip() {
  clearTimeout(WV_TIP.timer);
  if (WV_TIP.el) WV_TIP.el.hidden = true;
}

/// Every `title` under `root` becomes a tip, and stops being a browser one.
function wvTipify(root) {
  root.querySelectorAll('[title]').forEach((e) => {
    e.dataset.tip = e.getAttribute('title');
    e.removeAttribute('title');
  });
}

function wvInitTips() {
  const host = $('waveView');
  WV_TIP.el = wvH('<div class="wv-tip" id="wvTip" hidden></div>');
  host.appendChild(WV_TIP.el);
  wvTipify(host);
  // Menus, matrix rows, targets and badges are built as they are needed.
  new MutationObserver(() => wvTipify(host)).observe(host, { subtree: true, childList: true });
  host.addEventListener('pointerover', (e) => {
    // Not while a button is down: that is a drag, and the tip is in the way.
    const el = e.buttons ? null : e.target.closest('[data-tip], canvas[data-tgt], .wv-badge[data-bs]');
    if (el === WV_TIP.on) return;
    wvHideTip();
    WV_TIP.on = el;
    if (el) WV_TIP.timer = setTimeout(() => wvShowTip(el), 250);
  });
  host.addEventListener('pointerleave', () => { WV_TIP.on = null; wvHideTip(); });
  host.addEventListener('pointerdown', () => wvHideTip(), true);
}

/// Keep a shown tip's value current while a control moves under it.
function wvTipTick(ts) {
  const tip = WV_TIP.el, el = WV_TIP.on;
  if (!tip || tip.hidden || !el || ts - WV_TIP.at < 150) return;
  WV_TIP.at = ts;
  if (!document.body.contains(el)) { wvHideTip(); return; }
  wvFillTip(el);
}
