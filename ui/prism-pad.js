// The Prism pad: Hyperprism's blue window.
//
// Hyperprism opened one square per process. Its top edge was one setting and
// its left another, each with a low and a high limit typed into the corners;
// dragging set both at once, and a record button kept the motion. Here the
// square drives the engine's Time & Pitch — the Pitch Time Changer, speed
// across and pitch up — or any slot in the rack, with the pair Hyperprism gave
// that process. See docs/HYPERPRISM.md.
//
// **The pad moves controls the way their sliders do.** Time & Pitch goes
// through `stretchDraft` and `previewStretch`, a slot through `liveParam`. So
// the recorder, the lanes and the export need nothing new: REC arms the same
// recorder REC PERF does, and a take is two ordinary lanes.
//
// The sources, their controls, ranges and default pairs come from
// `GET /api/pad`, and the pad's arithmetic is held to the lanes' by
// `the_pads_arithmetic_is_the_lanes` in `server/src/pad.rs`. The setup —
// which two controls, and their limits — is kept with the rack, under the
// slot's id or `stretch`.
//
// **Its panel is the Prism page's** (`app/385-hyperstretch.js`), HyperStretch
// and this pad merged (RJ, 5 Nov 2026). That panel has the elements this file
// fills by id — the source and axis menus, the limits, the settings, the
// presets, the post-roll, the PTC switch, Playback Speed and the faders — and
// moves the pad; this file is what the pad drives and how.
//
// Loaded after app.js's globals exist and before anything calls it; nothing
// runs at load.

const prismPad = {
  /// What `/api/pad` offered for the open file.
  sources: [],
  /// The id of the one on the pad.
  source: 'stretch',
  /// The current take for the pad's two controls: `[frame, xUnit, yUnit]`.
  path: [],
  };
window.prismPad = prismPad;


// ───────────────────────────── the Prism deck (`engine/src/decks.rs`)
//
// RJ, 6 Nov 2026: "make each like effect its own instance so that the
// hyperprism panel can have its own sound loaded, and it runs independently of
// the grain engine". The page plays a sound of its own on a deck of its own:
// its own transport, stretch, Pitch Time Changer, faders and chain. Its
// document is kept on the server under `prism:` and the sound's path, so the
// grain document of the same sound is never touched, and every live change
// names the Prism deck (`deck: 'prism'`).

const prismDeck = {
  path: '', frames: 0, rate: 48000,
  /// The chain, pads, post-roll and Pitch Time Changer, as `/api/rack` keeps them.
  rack: { slots: [], master: undefined, pads: {}, postRoll: {} },
  /// Time & Pitch: the granular engine at rest until the pad moves it.
  stretch: { ratio: 1, semitones: 0, windowMs: 46, cloudMix: 0.5, algorithm: 'granular' },
  playing: false, pos: 0, loop: false, wave: null, polled: 0,
};

/// The Prism deck's document.
function prismKey() {
  return `prism:${prismDeck.path}`;
}

/// Load a sound into the Prism deck, and its document with it.
async function prismDeckUse(path, { chosen = true } = {}) {
  if (!path) return;
  try {
    const r = await postJSON(`/api/prism/load?p=${encodeURIComponent(path)}`, {});
    prismDeck.frames = r.frames || 0;
    prismDeck.rate = r.sampleRate || 48000;
  } catch (e) { toast(e.message); return; }
  prismDeck.path = path;
  prismDeck.playing = false;
  prismDeck.pos = 0;
  // Only a sound picked in the panel is Prism's own. The open file is what it
  // falls back on, so the next file opened is the next one it plays.
  prismDeck.borrowed = !chosen;
  if (chosen) try { localStorage.setItem('prism.sound', path); } catch { /* private mode */ }
  try {
    const r = await api(`/api/rack?p=${encodeURIComponent(prismKey())}&sr=${prismDeck.rate}`);
    prismDeck.rack = { slots: [], pads: {}, postRoll: {}, ...r };
  } catch { prismDeck.rack = { slots: [], pads: {}, postRoll: {} }; }
  try {
    const kept = JSON.parse(localStorage.getItem(`prism.stretch:${path}`) || 'null');
    prismDeck.stretch = { ratio: 1, semitones: 0, windowMs: 46, cloudMix: 0.5, ...(kept || {}), algorithm: 'granular' };
  } catch { /* nothing kept */ }
  prismStretchSend();
  prismHpSend();
  prismDeckWave();
  prismDeckInfo(path);
  prismDeckShow();
  // SOURCE's colours, while the page is out to show them (`edSoundStale` reads
  // it again when the page comes back).
  if (prismOwnsBar()) edLoadSound(path);
  if (typeof hsOpen === 'function') await hsOpen();
}

/// What the library knows of Prism's sound, for SOURCE's line: its format,
/// rate, bits, channels and length, as its folder lists them.
async function prismDeckInfo(path) {
  prismDeck.info = null;
  try {
    const list = await api(`/api/files?folder=${encodeURIComponent(path.split('/')[0])}`);
    if (prismDeck.path === path) prismDeck.info = list.find((f) => f.path === path) || null;
  } catch { /* the line says less */ }
  prismDeckShow();
}

/// SOURCE's Edit: Prism's sound on the Edit page, opened as the document first
/// when another one is open.
async function prismEditSound() {
  if (!prismDeck.path) { toast('Choose a sound for Prism first'); return; }
  if (state.selectedFile?.path !== prismDeck.path) {
    if (!prismDeck.info) await prismDeckInfo(prismDeck.path);
    if (!prismDeck.info) { toast('That sound is not in the library'); return; }
    await selectFile(prismDeck.info);
  }
  document.querySelector('#leftRail .rl-item[data-page="wave"]')?.click();
}

/// Time & Pitch to the Prism deck, a few times a second at most while moving.
let prismStretchThrottle = null;
function prismStretchSend() {
  try { localStorage.setItem(`prism.stretch:${prismDeck.path}`, JSON.stringify(prismDeck.stretch)); } catch { /* full */ }
  prismStretchThrottle = prismStretchThrottle || throttled(() => {
    postJSON('/api/prism/stretch', { ...prismDeck.stretch }).catch(() => {});
  }, 60);
  prismStretchThrottle();
}

/// A slot's control, live on the Prism deck, newest value per control.
const prismLivePending = new Map();
let prismLiveTimer = 0;
function prismLiveParam(id, key, value) {
  prismLivePending.set(`${id}\u0000${key}`, { id, key, value });
  if (prismLiveTimer) return;
  prismLiveTimer = setTimeout(async () => {
    prismLiveTimer = 0;
    const batch = [...prismLivePending.values()];
    prismLivePending.clear();
    for (const w of batch) {
      try { await postJSON('/api/rack/param', { p: prismKey(), ...w }); } catch { /* the next commit says it */ }
    }
  }, 16);
}

/// The Prism document to the server. `structure` rebuilds the chain on the
/// deck; otherwise the deck is already where it should be.
async function prismPushRack({ structure = false } = {}) {
  const r = prismDeck.rack;
  try {
    const back = await postJSON('/api/rack', {
      p: prismKey(), sr: prismDeck.rate, slots: r.slots, master: r.master,
      pads: r.pads || {}, postRoll: r.postRoll || {}, keepLive: !structure,
    });
    if (back?.slots) prismDeck.rack = { ...prismDeck.rack, ...back };
  } catch (e) { toast(e.message); }
}

/// The deck's transport, faders included. Its play, stop and loop are the
/// Now Playing bar's on this page (`prismOwnsBar`); the takes start it too.
function prismDeckSend(body) {
  return postJSON('/api/engine/transport', { deck: 'prism', ...body }).catch(() => {});
}
function prismDeckPlay() {
  if (!prismDeck.path) { toast('Choose a sound for Prism first'); return; }
  prismDeck.playing = true;
  prismDeckSend({ play: true });
  prismDeckShow();
}
function prismDeckPause() {
  prismDeck.playing = false;
  prismDeckSend({ play: false });
  prismDeckShow();
}
function prismDeckStop() {
  prismDeck.playing = false;
  prismDeck.pos = 0;
  prismDeckSend({ play: false, seek: 0 });
  prismDeckShow();
}
function prismDeckLoop() {
  prismDeck.loop = !prismDeck.loop;
  prismDeckSend({ loop: { on: prismDeck.loop, a: 0, b: 0 } });
  prismDeckShow();
}

/// Where the deck is in its sound, 0 to 1. The position counts output frames;
/// the stretch spreads the sound over them.
function prismDeckAt() {
  if (!(prismDeck.frames > 0)) return 0;
  return (prismDeck.pos / (prismDeck.frames * (prismDeck.stretch.ratio || 1))) % 1;
}

/// Go to `u` (0 to 1) of the deck's sound: the bar's strip, clicked.
function prismDeckSeek(u) {
  if (!prismDeck.path || !(prismDeck.frames > 0)) return;
  const frame = Math.round(Math.max(0, Math.min(1, u)) * prismDeck.frames * (prismDeck.stretch.ratio || 1));
  prismDeck.pos = frame;
  prismDeckSend({ seek: frame });
  prismDeckShowWave();
  prismBarShow();
}

// ─────────────────────────── the Now Playing bar, on the Prism page
//
// RJ, 11 Nov 2026: one transport. On the Prism page the bar (`#nowBar`,
// `ui/app/410-now-bar.js`) is the Prism deck's: play/pause, stop and loop act on
// Prism's sound, the clock and the strip follow it, and the strip seeks it.
// GRAIN, SEQ and the tempo are the main sound's, so they step out
// (`ui/edit.css`). Off the page the bar is the main sound's, as before.

/// Is the bar Prism's? Only while the Prism page is out.
function prismOwnsBar() {
  return document.body.classList.contains('prismpage');
}

/// The bar's play button: play, or pause where it is.
function prismBarPlay() {
  if (prismDeck.playing) prismDeckPause(); else prismDeckPlay();
}

/// The bar, from the deck: the play and loop lights, the clock and the head.
function prismBarShow() {
  if (!prismOwnsBar() || typeof nbPaintPlay !== 'function') return;
  $('playBtn').classList.toggle('on', prismDeck.playing);
  nbPaintPlay();
  paintLoop();
  $('timeNow').textContent = fmtTime(prismDeck.pos / (prismDeck.rate || 48000));
  nbTick();
}

/// The sound's name on the bar, and how long it is.
function prismBarName() {
  $('nbName').textContent = prismDeck.path ? prismDeck.path.split('/').pop() : 'no sound';
  $('nbMeta').textContent = prismDeck.path && prismDeck.frames > 0 ? fmtDur(prismDeck.frames / (prismDeck.rate || 48000)) : '';
}

// The page coming or going hands the bar over, all of it at once.
(() => {
  let had = false;
  new MutationObserver(() => {
    const on = prismOwnsBar();
    if (on === had) return;
    had = on;
    if (typeof nbHandOver === 'function') nbHandOver();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();

/// Where the deck is, a few times a second while the page is out.
async function prismDeckPoll(now) {
  if (!prismDeck.path || now - prismDeck.polled < 150) return;
  prismDeck.polled = now;
  try {
    const r = await api('/api/prism/state');
    prismDeck.playing = !!r.playing;
    prismDeck.pos = r.position || 0;
    if (r.inFrames) prismDeck.frames = r.inFrames;
  } catch { /* the next one */ }
  prismDeckShowWave();
  prismBarShow();
}

async function prismDeckWave() {
  prismDeck.wave = null;
  const want = prismDeck.path;
  try {
    // Enough columns for SOURCE across a wide window, one a pixel or so.
    const w = await api(`/api/peaks?p=${encodeURIComponent(want)}&cols=1600`);
    if (prismDeck.path === want) prismDeck.wave = w;
  } catch { /* drawn empty */ }
  prismDeckShowWave();
  if (prismOwnsBar() && typeof nbDrawStrip === 'function') nbDrawStrip();
}

/// SOURCE and the Sound row's mini overview, from the deck's peaks.
function prismDeckShowWave() {
  prismDrawWave($('prismSrc'), 2);
  prismDrawWave($('prismWave'), 1);
}

/// Prism's sound across a canvas: its peaks in its own colours, low to high as
/// the Edit page, Grain and Chop colour theirs (`edColourAt`), once it has been
/// measured, and plain until then; the playhead over them, `head` px wide. The
/// sound is kept drawn beside the canvas, so a moving head redraws only itself.
function prismDrawWave(c, head) {
  if (!c) return;
  const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!w || !h) return;
  const p = prismDeck.wave, lit = !!edSound.an && edSound.path === prismDeck.path;
  const key = `${w}|${h}|${dpr}|${prismDeck.path}|${p?.columns}|${lit}|${typeof themeStamp === 'undefined' ? '' : themeStamp}`;
  let ink = c.prismInk;
  if (!ink || ink.key !== key) {
    const cv = ink?.cv || document.createElement('canvas');
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const chans = p?.channels || [], cols = chans[0]?.max?.length || 0;
    if (cols) {
      const css = getComputedStyle(document.documentElement);
      const len = prismDeck.frames / (prismDeck.rate || 48000);
      const at = (i) => { let m = 0; for (const ch of chans) m = Math.max(m, Math.abs(ch.max[i]), Math.abs(ch.min[i])); return m; };
      let pk = 0.001;
      for (let i = 0; i < cols; i++) pk = Math.max(pk, at(i));
      const mid = h / 2, A = mid - 1;
      g.fillStyle = `rgba(${css.getPropertyValue('--look-bloom').trim()},.3)`;
      for (let x = 0; x < w; x++) {
        const m = Math.max(0.5, at(Math.min(cols - 1, Math.floor(x / w * cols))) / pk * A);
        const k = lit && edColourAt((x + 0.5) / w * len * edSound.rate, true);
        if (k) g.fillStyle = `rgba(${k[0] | 0},${k[1] | 0},${k[2] | 0},.9)`;
        g.fillRect(x, mid - m, 1, m * 2);
      }
    }
    ink = c.prismInk = { key, cv };
  }
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(ink.cv, 0, 0);
  if (prismDeck.frames > 0) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = getComputedStyle(c).getPropertyValue('--look-text').trim();
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = head > 1 ? 6 : 0;
    g.fillRect(Math.round(prismDeckAt() * (w - head)), 0, head, h);
  }
}

/// Click or drag along SOURCE (or the mini overview) to go there, as the bar's
/// strip does on this page.
function prismDeckSeekWire(c) {
  if (!c) return;
  const go = (e) => {
    const r = c.getBoundingClientRect();
    if (r.width) prismDeckSeek((e.clientX - r.left) / r.width);
  };
  c.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    c.setPointerCapture(e.pointerId);
    go(e);
  });
  c.addEventListener('pointermove', (e) => { if (c.hasPointerCapture(e.pointerId)) go(e); });
  if (window.ResizeObserver) new ResizeObserver(() => prismDrawWave(c, c.id === 'prismSrc' ? 2 : 1)).observe(c);
}

/// The deck's strip: the sound's name, and the bar's lights.
function prismDeckShow() {
  // The picker shows the sound playing, borrowed or chosen, when its folder is the one listed.
  const pick = $('prismSoundFile');
  if (pick && prismDeck.path && pick.value !== prismDeck.path && [...pick.options].some((o) => o.value === prismDeck.path)) pick.value = prismDeck.path;
  const name = $('prismSoundName');
  if (name) name.textContent = prismDeck.path ? prismDeck.path.split('/').pop() : 'No sound — choose one';
  // The line under SOURCE, as the metastrip says it for the open sound.
  const meta = $('prismSoundMeta'), f = prismDeck.info;
  if (meta) {
    const len = f?.duration || (prismDeck.frames > 0 ? prismDeck.frames / (prismDeck.rate || 48000) : 0);
    meta.textContent = !prismDeck.path ? '' : [f?.format, f?.sampleRate && `${f.sampleRate} Hz`, f?.bits && `${f.bits}-bit`,
      f?.channels && `${f.channels} ch`, len && `${len.toFixed(2)} s`].filter(Boolean).join(' · ');
  }
  if (prismOwnsBar() && $('nbName')) prismBarName();
  prismBarShow();
  prismRenderChain();
}

/// The sound picker: a folder, then a sound in it.
async function prismSoundFill() {
  const folders = $('prismSoundFolder'), files = $('prismSoundFile');
  if (!folders || !files) return;
  if (!folders.options.length) {
    const cur = (prismDeck.path || state.selectedFile?.path || '').split('/')[0];
    for (const f of state.folders || []) folders.add(choiceOption(f.name, f.name, f.name === cur));
  }
  files.innerHTML = '';
  files.add(choiceOption('Choose a sound…', '', !prismDeck.path));
  try {
    const list = await api(`/api/files?folder=${encodeURIComponent(folders.value)}`);
    for (const f of list) files.add(choiceOption(f.filename || f.path.split('/').pop(), f.path, f.path === prismDeck.path));
  } catch { /* an empty list says it */ }
}

/// The Prism chain: its own effects, in order, apart from the FX tab's rack.
function prismRenderChain() {
  const box = $('prismChain'), add = $('prismChainAdd');
  if (!box) return;
  box.innerHTML = '';
  (prismDeck.rack.slots || []).forEach((slot, i) => {
    const row = document.createElement('div');
    row.className = 'prism-chain-slot';
    const label = state.shapers?.[slot.kind]?.label || slot.kind;
    row.innerHTML = '<span class="mono prism-chain-n"></span><span class="prism-chain-name"></span><button type="button" class="hs-btn">×</button>';
    row.children[0].textContent = `${i + 1} ·`;
    row.children[1].textContent = label;
    const rm = row.children[2];
    rm.setAttribute('aria-label', `Remove ${label}`);
    rm.onclick = () => prismChainRemove(slot.id);
    box.appendChild(row);
  });
  if (add && add.options.length <= 1 && typeof fxPickerCatalogue === 'function' && state.shapers) {
    add.innerHTML = '';
    add.add(choiceOption('+ add effect', '', true));
    for (const { group, items } of fxPickerCatalogue()) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const m of items) og.appendChild(choiceOption(m.label || m.kind, m.kind, false));
      add.appendChild(og);
    }
  }
}

async function prismChainAdd(kind) {
  if (!kind || !prismDeck.path) return;
  const slot = defaultFxSlot(kind);
  if (!slot) return;
  prismDeck.rack.slots = [...(prismDeck.rack.slots || []), slot];
  prismRenderChain();
  await prismPushRack({ structure: true });
  if (typeof hsOpen === 'function') await hsOpen();
}

async function prismChainRemove(id) {
  prismDeck.rack.slots = (prismDeck.rack.slots || []).filter((s) => s.id !== id);
  if (prismPad.source === id) prismPad.source = PRISM_STRETCH;
  prismRenderChain();
  await prismPushRack({ structure: true });
  if (typeof hsOpen === 'function') await hsOpen();
}

/// For the tests, and for anyone asking from the console.
window.prismDeck = {
  path: () => prismDeck.path,
  stretch: () => ({ ...prismDeck.stretch }),
  rack: () => JSON.parse(JSON.stringify(prismDeck.rack)),
  use: (p) => prismDeckUse(p),
};

/// What a chain slot's controls send through on the Prism page (`prismModuleControl`).
const PRISM_DECK_IO = { live: (id, key, v) => prismLiveParam(id, key, v), commit: () => prismPushRack() };

const PRISM_STRETCH = 'stretch';
/// Hyperprism's Pitch Time Changer, beside Time & Pitch. See `server/src/pad.rs`.
const PRISM_PTC = 'ptc';
/// Its window's starting values, for a rack that has never had it.
const PTC_DEFAULTS = { on: false, speed: 100, pitch: 100, feedback: 0, grain: 15, xfade: 100, smoothing: 50 };

/// The Pitch Time Changer the document keeps, filled in.
function prismPtc() {
  prismDeck.rack.pitchTime = { ...PTC_DEFAULTS, ...(prismDeck.rack.pitchTime || {}) };
  return prismDeck.rack.pitchTime;
}

/// Send what changed in the Pitch Time Changer, a few times a second at most
/// while dragging; the server keeps it, sends it to the engine and records it.
const prismPtcPending = {};
// Made on first use: this file loads before app.js, where `throttled` is.
let prismPtcThrottle = null;
function prismPtcSend() {
  prismPtcThrottle = prismPtcThrottle || throttled(() => {
    const body = { p: prismKey(), ...prismPtcPending };
    for (const k of Object.keys(prismPtcPending)) delete prismPtcPending[k];
    if (prismDeck.path) postJSON('/api/pitchtime', body).catch(() => {});
  }, 60);
  prismPtcThrottle();
}
function prismPtcSet(changes) {
  Object.assign(prismPtc(), changes);
  Object.assign(prismPtcPending, changes);
  prismPtcSend();
}

function prismCurrent() {
  return prismPad.sources.find((s) => s.id === prismPad.source) || prismPad.sources[0];
}

/// The setup in force: what the rack keeps for this source, or its default.
function prismSetup() {
  const src = prismCurrent();
  if (!src) return null;
  return prismDeck.rack.pads?.[src.id] || src.pad || src.default;
}

function prismControl(key) {
  return prismCurrent()?.controls.find((c) => c.key === key);
}

/// Somewhere between two values, at `t` of the way: along a logarithm for a
/// control that sweeps logarithmically. Either end may be the larger, which is
/// how Time & Pitch runs faster to the right.
function prismBetween(c, lo, hi, t) {
  const u = Math.max(0, Math.min(1, t));
  let v = c.log && lo > 0 && hi > 0 ? lo * Math.pow(hi / lo, u) : lo + (hi - lo) * u;
  if (c.step === 1) v = Math.round(v);
  return v;
}

/// The inverse: how far between two values one is.
function prismAlong(c, lo, hi, v) {
  if (!Number.isFinite(v) || lo === hi) return 0.5;
  const t = c.log && lo > 0 && hi > 0 && v > 0 ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo);
  return Math.max(0, Math.min(1, t));
}

/// The value a lane's unit stands for, across a control's whole range: what
/// `resolve` and the stretch table say, so a drawn take sits where it plays.
function prismUnitValue(c, u) {
  return prismBetween(c, c.min, c.max, u);
}

/// A control's value now, wherever its source keeps it.
function prismRead(key) {
  const src = prismCurrent();
  const c = prismControl(key);
  if (!src || !c) return undefined;
  if (src.id === PRISM_STRETCH) return prismDeck.stretch[key] ?? c.min;
  if (src.id === PRISM_PTC) return prismPtc()[key] ?? c.min;
  const slot = prismDeck.rack.slots?.find((s) => s.id === src.id);
  return slot?.params?.[key] ?? slot?.[key];
}

/// Move one control, the way its own slider would.
function prismWrite(key, v) {
  const src = prismCurrent();
  if (!src) return;
  if (src.id === PRISM_STRETCH) {
    prismDeck.stretch[key] = v;
    prismStretchSend();
    return;
  }
  if (src.id === PRISM_PTC) {
    // Playing the process is hearing it, as in Hyperprism: a move turns it on.
    prismPtcSet({ [key]: v, on: true });
    prismShowPtc();
    return;
  }
  const slot = prismDeck.rack.slots?.find((s) => s.id === src.id);
  if (!slot) return;
  // The compressor keeps its settings as fields; everything else in `params`.
  if (slot.kind === 'comp') slot[key] = v;
  else (slot.params = slot.params || {})[key] = v;
  prismLiveParam(slot.id, key, v);
}

/// A drag is over: commit it properly, as a released slider does.
function prismRelease() {
  const id = prismCurrent()?.id;
  if (id === PRISM_STRETCH) prismStretchSend();
  else if (id === PRISM_PTC) prismRenderSettings();
  else prismPushRack();
}

/// The Pitch Time Changer's switch: shown with its source, lit when on.
function prismShowPtc() {
  const b = $('prismPtcOn');
  if (!b) return;
  b.classList.toggle('hidden', prismCurrent()?.id !== PRISM_PTC);
  b.classList.toggle('on', !!prismPtc().on);
  b.setAttribute('aria-pressed', prismPtc().on ? 'true' : 'false');
}

/// Every setting of the process on the pad, in the Controls panel (RJ:
/// "Move all the extra setting to the Prism stand-alone"), as the app's shared
/// knobs with their pictures (`prismKnob`; the mock-up of 13 Nov 2026, as on
/// Grain and Chop; half-width bars in v7): the two on the pad first,
/// marked X and Y, then the rest in the effect's own groups ("Added (not in the
/// original)" among them). Each moves the value its own control elsewhere
/// moves: Time & Pitch's through the deck's stretch, the Pitch Time Changer's
/// through `/api/pitchtime`, a slot's through `prismLiveParam`. An LFO
/// (`387-prism-lfo.js`) shows on a knob as its reach round the ring and a dot
/// where the sound is.
const PRISM_STRETCH_DEFAULTS = { ratio: 1, semitones: 0, windowMs: 46, cloudMix: 0.5 };
function prismRenderSettings() {
  const box = $('prismSettings');
  if (!box) return;
  box.innerHTML = '';
  if (typeof prismLfo === 'object') prismLfo.rows.clear();
  const src = prismCurrent();
  if (!src) return;
  const p = prismSetup();
  const label = (text) => {
    const l = document.createElement('div');
    l.className = 'prism-group-label';
    l.textContent = text;
    box.appendChild(l);
  };
  let specs, read, write, commit, kind = '', groups;
  if (src.id === PRISM_STRETCH || src.id === PRISM_PTC) {
    const ptc = src.id === PRISM_PTC;
    specs = src.controls.map((c) => ({ ...c, default: ptc ? PTC_DEFAULTS[c.key] : PRISM_STRETCH_DEFAULTS[c.key], step: ptc ? 1 : c.step }));
    read = (k) => (ptc ? prismPtc()[k] ?? PTC_DEFAULTS[k] : prismRead(k));
    write = ptc ? (k, v) => prismPtcSet({ [k]: Math.round(v) }) : (k, v) => prismWrite(k, v);
    commit = ptc ? () => {} : () => prismStretchSend();
  } else {
    const slot = prismDeck.rack.slots?.find((s) => s.id === src.id);
    if (!slot) return;
    kind = slot.kind;
    const shaper = state.shapers?.[slot.kind];
    if (shaper?.params?.length && slot.kind !== 'comp') {
      slot.params = slot.params || {};
      for (const sp of shaper.params) if (slot.params[sp.key] === undefined) slot.params[sp.key] = sp.default;
      specs = shaper.params;
      groups = shaper.panel?.groups;
      read = (k) => slot.params[k];
      write = (k, v) => { slot.params[k] = v; prismLiveParam(slot.id, k, v); };
    } else {
      // No shaper to ask (the compressor, the built-ins): the source's controls.
      specs = src.controls;
      read = (k) => prismRead(k);
      write = (k, v) => prismWrite(k, v);
    }
    commit = () => prismPushRack();
  }
  const byKey = Object.fromEntries(specs.map((c) => [c.key, c]));
  const seen = new Set();
  const add = (keys) => {
    for (const k of keys) {
      if (!byKey[k] || seen.has(k)) continue;
      seen.add(k);
      const c = byKey[k];
      const row = prismKnob(c, read(k), {
        kind,
        onInput: (v) => {
          write(k, v);
          if (k === p?.x || k === p?.y) { if (typeof hsHandFromValues === 'function') hsHandFromValues(); if (typeof hsPaint === 'function') hsPaint(); }
        },
        onCommit: () => commit(),
      });
      row.dataset.src = src.id;
      const ax = k === p?.x ? 'X' : k === p?.y ? 'Y' : '';
      if (ax) {
        row.classList.add('prism-onpad');
        // In the style, not the text: the control's name stays its name.
        row.querySelectorAll(':scope > .k, .ui-kname').forEach((n) => { n.dataset.ax = ax; });
      }
      row.base = () => read(k);
      box.appendChild(row);
      if (typeof prismLfo === 'object') prismLfo.rows.set(`${src.id}\u0000${k}`, row);
    }
  };
  // The pad's two first, then the effect's own groups, then anything left.
  add([p?.x, p?.y].filter(Boolean));
  for (const g of groups?.length ? groups : []) {
    const rest = (g.keys || []).filter((k) => byKey[k] && !seen.has(k));
    if (!rest.length) continue;
    if (g.label && g.label !== 'Pad') label(g.label.replace('Added (not in the original)', 'Added · not in the original'));
    add(rest);
  }
  add(specs.map((c) => c.key));
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    // Mapping an LFO: a click on a control maps it rather than moving it.
    box.addEventListener('pointerdown', (e) => {
      if (typeof prismLfo !== 'object' || !prismLfo.mapping) return;
      const row = e.target.closest('.prism-bar');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      prismLfoToggle({ src: row.dataset.src, key: row.dataset.key });
    }, true);
  }
  if (typeof prismLfoMark === 'function') prismLfoMark();
}

/// The controls follow what moves their settings elsewhere (the pad, a take, a
/// preset), each frame the LFOs run, unless a hand is on them.
function prismSettingsFollow() {
  if (typeof prismFollowAll === 'function') prismFollowAll();
  if (typeof prismLfo !== 'object') return;
  for (const row of prismLfo.rows.values()) {
    if (row.classList.contains('plfo-on')) continue;
    const input = row.querySelector(':scope > input[type=range]');
    if (!input || input.classList.contains('gc-dragging') || document.activeElement === input || row.querySelector('.ui-knob.drag')) continue;
    const v = row.base?.();
    if (Number.isFinite(v) && Math.abs(v - (row.read ? row.read() : +input.value)) > 1e-6 * Math.max(1, Math.abs(v))) row.sync?.(v);
  }
}

/// Two numbers with their units, the way Hyperprism printed them on its edges.
function prismFormat(c, v) {
  if (!c || !Number.isFinite(v)) return '';
  if (c.choices) return c.choices[Math.round(v - c.min)] ?? String(Math.round(v));
  if (c.key === 'ratio') return `${v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)}×`;
  if (c.key === 'semitones') return `${v >= 0 ? '+' : ''}${v.toFixed(1)} st`;
  return fxValueFormat(c, v);
}

/// A menu entry: what it says, what it stands for, and whether it is chosen.
function choiceOption(label, value, selected) {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  o.selected = !!selected;
  return o;
}

/// The bar above the pad: the source, the two axes, and the limits.
function prismRenderBar() {
  const pick = $('prismSource'), xs = $('prismX'), ys = $('prismY');
  if (!pick) return;
  pick.innerHTML = '';
  for (const s of prismPad.sources) pick.add(choiceOption(s.label, s.id, s.id === prismPad.source));
  const src = prismCurrent();
  const p = prismSetup();
  for (const [sel, key] of [[xs, p?.x], [ys, p?.y]]) {
    sel.innerHTML = '';
    for (const c of src?.controls || []) sel.add(choiceOption(c.label, c.key, c.key === key));
  }
  const shown = (n) => String(+(+n).toPrecision(6));
  $('prismXLo').value = shown(p?.xLo); $('prismXHi').value = shown(p?.xHi);
  $('prismYLo').value = shown(p?.yLo); $('prismYHi').value = shown(p?.yHi);
  prismShowPtc();
  prismRenderSettings();
  if (typeof prismPickerRender === 'function') prismPickerRender();
}

// ───────────────────────────── Hyperprism's Playback Speed and its faders

/// The slider's rate: Hyperprism read its 0–255 slider as a 128th each.
function prismSpeedRate(v) {
  return v / 128;
}

/// The three faders as Hyperprism had them: 0–255 each, 128 at rest.
const prismHp = { speed: 128, l: 128, lr: 128, r: 128 };

/// A fader's dB: Hyperprism's own law, ±18 dB across 0–255.
function prismFaderDb(v) {
  return (36 * v) / 255 - 18;
}

function prismSideGains() {
  const g = (v) => Math.pow(10, prismFaderDb(v) / 20);
  return { gainL: g(prismHp.l), gainR: g(prismHp.r) };
}

let prismHpThrottle = null;
function prismHpSend() {
  prismHpThrottle = prismHpThrottle || throttled(() => {
    prismDeckSend({ speed: prismSpeedRate(prismHp.speed), ...prismSideGains() });
  }, 60);
  prismHpThrottle();
}

function prismShowHp() {
  const read = $('prismSpeedRead');
  if (read) read.textContent = `${Math.round(prismSpeedRate(prismHp.speed) * 100)} %`;
  for (const [id, key] of [['prismSpeed', 'speed'], ['prismFaderL', 'l'], ['prismFaderLR', 'lr'], ['prismFaderR', 'r']]) {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = String(prismHp[key]);
    const shown = key === 'speed' ? null : $(`${id}Read`);
    if (shown) {
      const db = prismFaderDb(prismHp[key]);
      // The unit once, in OUTPUT's head: unseen here, but still the reading's.
      shown.innerHTML = `${db < 0 ? '−' : '+'}${Math.abs(db).toFixed(1)}<span class="hs-unit"> dB</span>`;
      // The fader's well fills from its middle (`.hs-ffill`).
      el?.parentElement?.style.setProperty('--f', (prismHp[key] / 255).toFixed(4));
    }
  }
}

/// A fader moved. LR sets both sides to its own value, as the original's did.
function prismFaderSet(key, v) {
  prismHp[key] = v;
  if (key === 'lr') { prismHp.l = v; prismHp.r = v; }
  prismShowHp();
  prismHpSend();
}

// ──────────────────────────────── each process's presets and post-roll

/// What the presets of the source on the pad are kept under: its process.
function prismKind() {
  const src = prismCurrent();
  if (!src) return '';
  if (src.id === PRISM_STRETCH || src.id === PRISM_PTC) return src.id;
  const slot = prismDeck.rack.slots?.find((s) => s.id === src.id);
  return (slot?.kind || '').replace(/^prism:/, '');
}

const prismPresets = { factory: [], user: [] };
/// The preset loaded: `default`, `f<i>` (factory), `u<i>` (yours), or '' for none.
let prismPresetAt = '';

async function prismLoadPresets() {
  const kind = prismKind();
  try {
    const r = await api(`/api/pad/presets?kind=${encodeURIComponent(kind)}`);
    prismPresets.factory = r.factory || [];
    prismPresets.user = r.user || [];
  } catch { prismPresets.factory = []; prismPresets.user = []; }
  prismRenderPresets();
}

/// The preset bar reads the lists and `prismPresetAt`; the post-roll shows this
/// process's.
function prismRenderPresets(chosen) {
  prismPresetAt = chosen || '';
  const pr = $('prismPostRoll');
  if (pr) pr.value = String(prismDeck.rack.postRoll?.[prismCurrent()?.id] ?? 0);
}

/// The source's settings other than its two axes, as a preset keeps them.
function prismSettingsNow() {
  const src = prismCurrent();
  const p = prismSetup();
  if (!src) return {};
  if (src.id === PRISM_PTC) {
    const pt = prismPtc();
    return { feedback: pt.feedback, grain: pt.grain, xfade: pt.xfade, smoothing: pt.smoothing };
  }
  const out = {};
  for (const c of src.controls) {
    if (c.key === p?.x || c.key === p?.y) continue;
    const v = prismRead(c.key);
    if (Number.isFinite(v)) out[c.key] = v;
  }
  return out;
}

/// Load a preset: its window, its settings and its post-roll. Like
/// Hyperprism's, it leaves the pad where it is.
function prismApplyPreset(p) {
  const src = prismCurrent();
  if (!src) return;
  prismDeck.rack.postRoll = { ...(prismDeck.rack.postRoll || {}), [src.id]: Math.max(0, p.postRollMs || 0) };
  const settings = p.settings || {};
  if (src.id === PRISM_PTC) prismPtcSet(settings);
  else if (src.id !== PRISM_STRETCH) {
    const slot = prismDeck.rack.slots?.find((s) => s.id === src.id);
    for (const [k, v] of Object.entries(settings)) {
      if (!slot) break;
      if (slot.kind === 'comp') slot[k] = v; else (slot.params = slot.params || {})[k] = v;
      prismLiveParam(slot.id, k, v);
    }
  }
  // The window last: keeping it posts the rack, settings and post-roll with it.
  prismKeep({ x: p.x, xLo: p.xLo, xHi: p.xHi, y: p.y, yLo: p.yLo, yHi: p.yHi });
  prismRenderSettings();
}

/// The process's own defaults: its pad window, its settings and no post-roll.
function prismDefaultPreset() {
  const src = prismCurrent();
  const settings = {};
  if (src?.id === PRISM_PTC) Object.assign(settings, { feedback: 0, grain: 15, xfade: 100, smoothing: 50 });
  else {
    const slot = prismDeck.rack.slots?.find((s) => s.id === src?.id);
    for (const sp of state.shapers?.[slot?.kind]?.params || []) {
      if (sp.key !== src.default.x && sp.key !== src.default.y && Number.isFinite(sp.default)) settings[sp.key] = sp.default;
    }
  }
  return { ...src.default, settings, postRollMs: 0 };
}

async function prismPresetChosen(value) {
  if (value === 'default') prismApplyPreset(prismDefaultPreset());
  else if (value?.[0] === 'f') prismApplyPreset(prismPresets.factory[+value.slice(1)]);
  else if (value?.[0] === 'u') prismApplyPreset(prismPresets.user[+value.slice(1)]);
  prismRenderPresets(value);
}

/// Keep the pad's window, this process's settings and its post-roll as `name`.
async function prismPresetSave(name) {
  const src = prismCurrent();
  if (!src) throw new Error('No process on the pad');
  const preset = { ...prismSetup(), settings: prismSettingsNow(), postRollMs: prismDeck.rack.postRoll?.[src.id] ?? 0 };
  await postJSON('/api/pad/presets', { kind: prismKind(), name, preset });
  await prismLoadPresets();
  const i = prismPresets.user.findIndex((p) => p.name === name);
  prismRenderPresets(i >= 0 ? `u${i}` : undefined);
}

/// One of yours, renamed; still loaded if it was.
async function prismPresetRename(from, to) {
  const was = prismPresetAt;
  await postJSON('/api/pad/presets/rename', { kind: prismKind(), from, to });
  await prismLoadPresets();
  const i = prismPresets.user.findIndex((p) => p.name === to);
  if (was[0] === 'u' && i >= 0) prismRenderPresets(`u${i}`);
}

async function prismPresetDelete(name) {
  await postJSON('/api/pad/presets/delete', { kind: prismKind(), name });
  await prismLoadPresets();
}

function prismPostRollChanged(input) {
  const src = prismCurrent();
  if (!src) return;
  const ms = Math.max(0, Number(input.value) || 0);
  input.value = String(ms);
  prismDeck.rack.postRoll = { ...(prismDeck.rack.postRoll || {}), [src.id]: ms };
  prismPushRack();
}

/// Keep a changed setup with the rack, as the server will check it.
function prismKeep(next) {
  prismDeck.rack.pads = { ...(prismDeck.rack.pads || {}), [prismCurrent().id]: next };
  prismPushRack();
  prismRenderBar();
  prismLoadPath();
}

/// A different control on an axis starts with its whole range, or the
/// source's default limits if that control is the default.
function prismAxisChanged(axis, key) {
  const p = { ...prismSetup() };
  const c = prismControl(key);
  if (!c) return;
  const d = prismCurrent().default;
  const [lo, hi] = d[axis] === key ? [d[axis + 'Lo'], d[axis + 'Hi']] : [c.min, c.max];
  // The other axis cannot be the same control: they swap.
  const other = axis === 'x' ? 'y' : 'x';
  if (p[other] === key) {
    p[other] = p[axis]; p[other + 'Lo'] = p[axis + 'Lo']; p[other + 'Hi'] = p[axis + 'Hi'];
  }
  p[axis] = key; p[axis + 'Lo'] = lo; p[axis + 'Hi'] = hi;
  prismKeep(p);
}

function prismLimitChanged(field, input) {
  const p = { ...prismSetup() };
  const c = prismControl(field[0] === 'x' ? p.x : p.y);
  let v = +input.value;
  if (!c || !Number.isFinite(v)) { prismRenderBar(); return; }
  v = Math.max(c.min, Math.min(c.max, v));
  p[field] = v;
  // A sweep from somewhere to the same place is not a sweep.
  if (p.xLo === p.xHi || p.yLo === p.yHi) { prismRenderBar(); return; }
  prismKeep(p);
}

/// The lane names the pad's two controls record into.
function prismTargets() {
  const p = prismSetup();
  const src = prismCurrent();
  if (!p || !src) return null;
  const name = (key) => (src.id === PRISM_STRETCH ? `stretch.${key}` : `fx.${src.id}.${key}`);
  return [name(p.x), name(p.y)];
}

/// The take for the pad's two controls, drawn on the pad as a line.
async function prismLoadPath() {
  // The lanes are the grain document's: listed only when the Prism page plays
  // the grain deck (`HS_LANES_LISTED`), which it does not now.
  const f = HS_LANES_LISTED ? state.selectedFile : null;
  const t = prismTargets();
  prismPad.path = [];
  if (f && t) {
    try {
      const r = await api(`/api/automation/path?p=${encodeURIComponent(f.path)}`
        + `&x=${encodeURIComponent(t[0])}&y=${encodeURIComponent(t[1])}`);
      prismPad.path = r.points || [];
    } catch { /* no take is a fine answer */ }
  }
  prismShowLoop();
}

/// LOOP: both of the take's lanes wrap over its span, together.
async function prismToggleLoop() {
  const f = state.selectedFile;
  const t = prismTargets();
  if (!f || !t) return;
  const on = !$('prismLoop').classList.contains('on');
  try {
    await postJSON('/api/automation/loop', { p: f.path, x: t[0], y: t[1], on });
  } catch (e) { toast(on ? 'Nothing to loop yet — record a take on the pad first' : e.message); return; }
  await loadAutomation();
  prismShowLoop();
}

function prismShowLoop() {
  const b = $('prismLoop');
  if (!b) return;
  const t = prismTargets() || [];
  const lanes = (state.automation?.lanes || []).filter((l) => t.includes(l.target));
  b.classList.toggle('on', lanes.length === 2 && lanes.every((l) => Array.isArray(l.loop)));
}

/// REC: arm the recorder and roll the transport; again to stop the take.
async function prismToggleRecord() {
  if (state.captureArmed) {
    if (engine.playing) pausePlayback();
    else await endCapture();
  } else {
    await startCapture();
    if (state.captureArmed && !engine.playing) startPlayback();
  }
}
