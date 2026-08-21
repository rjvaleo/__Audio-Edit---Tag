'use strict';

/* The browser side. Talks to the Rust server over the endpoints in routes.rs;
   holds no audio itself beyond what the <audio> element streams.

   Three surfaces:
     left    the whole library — every file, with an overview, playable in place
     centre  the selected sound: big waveform and its stats; or the edit window
     right   tagging for the selected folder                                  */

const $ = (id) => document.getElementById(id);

const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({ error: 'bad response from server' }));
  if (!r.ok) throw new Error(body.error || `request failed (${r.status})`);
  return body;
};
const postJSON = (path, obj) =>
  api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });

const state = {
  library: '',
  folders: [],
  order: [],
  openFolders: {},
  folderFiles: {},
  /// What the classifier heard, by file path. Fetched per folder after the
  /// listing, because the first call has to put the library through the model
  /// and the file names should not wait on that.
  heard: {},
  /// Hand-applied tags by path, so a chip can be removed without refetching.
  userTags: {},
  thumbs: {},
  filter: '',

  selectedFolder: null,
  selectedFile: null,
  mode: 'overview',            // 'overview' | 'edit'

  peaks: null,
  /// A whole-file envelope for the automation lanes, at a fixed width.
  ///
  /// Deliberately not `peaks`: that one is the zoom window and moves under the
  /// pointer, while a lane always spans the entire document. Sharing it would
  /// make the breakpoints line up with a picture of somewhere else.
  laneWave: null,
  spec: null,
  stats: null,
  showSpec: false,
  fftSize: 1024,
  view: { from: 0, to: 0, frames: 0, sampleRate: 44100 },

  /// Whether the library lists files that have no audio header. Off, and the
  /// browser shows only what is genuinely a sound file; on, and everything the
  /// scan found is listed and openable, headerless data included.
  playAll: false,

  /// Keeping the playhead on screen while it plays. `scroll` slides the file
  /// past a playhead pinned to the middle; `page` leaves it alone until it runs
  /// off the edge and then turns the page. An app setting, not a per-document
  /// one — it is how you like to watch, not something about the sound.
  follow: { on: true, mode: 'scroll' },

  sel: null,                   // {start, end} in timeline frames
  edit: null,
  annotations: { markers: [], regions: [] },
  fadeShape: 'equalPower',
  exportBits: 24,

  tagEdits: {},

  /// Documents open in the editor. Each carries its own edit list, rack,
  /// markers, zoom and selection — opening a second sound must not disturb
  /// what you were part-way through on the first.
  tabs: [],
  activeTab: -1,
  drawerOpen: true,
};

/// Everything that belongs to a document rather than to the app.
const TAB_FIELDS = ['edit', 'rack', 'automation', 'annotations', 'view', 'sel', 'peaks', 'spec', 'stats'];

function blankTab(file) {
  return {
    file,
    edit: null,
    rack: null,
    automation: { lanes: [], bypassed: false, targets: [] },
    annotations: { markers: [], regions: [] },
    view: { from: 0, to: 0, frames: 0, sampleRate: file.sampleRate || 44100 },
    sel: null,
    peaks: null,
    spec: null,
    stats: null,
  };
}

function stashActiveTab() {
  const t = state.tabs[state.activeTab];
  if (!t) return;
  for (const k of TAB_FIELDS) t[k] = state[k];
}

function adoptTab(i) {
  const t = state.tabs[i];
  if (!t) return;
  state.activeTab = i;
  state.selectedFile = t.file;
  for (const k of TAB_FIELDS) state[k] = t[k];
}

// ------------------------------------------------------------------ helpers

const fmtBytes = (b) =>
  b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB'
  : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB'
  : (b / 1e3).toFixed(0) + ' KB';

const fmtDur = (s) =>
  s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  : s.toFixed(2) + 's';

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

const fmtDb = (v) =>
  (v === null || v === undefined || !isFinite(v) ? '−∞ dB' : v.toFixed(1) + ' dB');

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3600);
}

// ------------------------------------------------------------------- panels

function showPane(side, name) {
  const panes = side === 'left'
    ? { browse: 'paneBrowse', search: 'paneSearch', scan: 'paneScan',
        import: 'paneImport', record: 'paneRecord', theme: 'paneTheme' }
    : { inspect: 'paneInspect' };
  for (const [key, id] of Object.entries(panes)) $(id).classList.toggle('hidden', key !== name);
  const titles = { browse: 'Browse', search: 'Search', scan: 'Scan',
                   import: 'Library', record: 'Record', inspect: 'Tags',
                   theme: 'Theme' };
  // Opening the panel starts polling the input; leaving it stops, so nothing
  // is asking a device for levels that nobody is looking at.
  if (side === 'left') recordPanelShown(name === 'record');
  $(side === 'left' ? 'leftPanelTitle' : 'rightPanelTitle').textContent = titles[name];
  $('treeFilter').classList.toggle('hidden', name !== 'browse');
  document.querySelectorAll('#leftRail .rail-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.panel === name));
  $(side === 'left' ? 'leftPanel' : 'rightPanel').classList.remove('collapsed');
}

document.querySelectorAll('#leftRail .rail-btn').forEach((b) =>
  (b.onclick = () => {
    // Clicking the rail button for the pane already showing toggles the panel
    // shut, so the rail is both the way out and the way back in.
    const panel = $('leftPanel');
    const shut = panel.classList.contains('collapsed') || panel.classList.contains('drawer-closed');
    if (b.classList.contains('active') && !shut) { closeDrawer(); return; }
    showPane('left', b.dataset.panel);
    openDrawer();
  }));
/// The modes where the library is an overlay drawer rather than a docked
/// column. Both of them give the whole width to something else — the editor's
/// lane, the room — so the library arrives over the top and goes away again,
/// instead of squeezing what you came here to look at.
const drawerMode = () => state.mode === 'edit' || state.mode === 'room';

function openDrawer() {
  state.drawerOpen = true;
  $('leftPanel').classList.remove('collapsed', 'drawer-closed');
  $('scrim').classList.toggle('hidden', !drawerMode());
}

function closeDrawer() {
  state.drawerOpen = false;
  $('scrim').classList.add('hidden');
  if (drawerMode()) $('leftPanel').classList.add('drawer-closed');
  else $('leftPanel').classList.add('collapsed');
}

$('scrim').onclick = () => closeDrawer();
$('closeLeft').onclick = () => closeDrawer();
$('closeRight').onclick = () => $('rightPanel').classList.add('collapsed');

// ================================================================ the library
//
// A flat list of folders in the order they entered the library, each expanding
// to show its files. Every file row carries a waveform overview, what the
// classifier decided, and a play button — the list is meant to be auditioned
// from directly, not merely navigated.

function orderedFolders() {
  const byName = new Map(state.folders.map((f) => [f.name, f]));
  const out = [];
  for (const name of state.order) {
    if (byName.has(name)) { out.push(byName.get(name)); byName.delete(name); }
  }
  for (const f of state.folders) if (byName.has(f.name)) out.push(f);
  return out;
}

async function saveOrder() {
  state.order = orderedFolders().map((f) => f.name);
  try { await postJSON('/api/order', { order: state.order }); }
  catch (e) { toast('Could not save the order: ' + e.message); }
}

function matchesFilter(file) {
  if (!state.filter) return true;
  const hay = `${file.name} ${file.category} ${file.machine} ${file.instrument}`.toLowerCase();
  return state.filter.split(/\s+/).every((t) => hay.includes(t));
}

/// Whether the file announced itself as audio.
///
/// The probe reads a container or it does not; anything it cannot recognise
/// falls back to headerless PCM, which is why a peak cache, a text sidecar or a
/// stray binary all open and play as noise. That fallback is deliberate and
/// occasionally rewarding — SD2 files and raw dumps are real sounds with no
/// header — so it stays, and this only governs what the library puts in front
/// of you. `RAW-PCM`, `NON-AUDIO`, `UNREADABLE` and `EMPTY` all fail it.
const hasAudioHeader = (file) =>
  /^(WAV|AIFF|AIFC)/.test(file.format || '');

const listed = (file) => state.playAll || hasAudioHeader(file);

/// How many files a folder will actually put on screen.
///
/// It has to follow the same switch the list does. A badge reading 17 over a
/// list of 16 is the kind of small lie that makes you doubt the rest of it.
const folderCount = (f) =>
  state.playAll ? (f.files ?? f.audioFiles) : (f.headerFiles ?? f.audioFiles);

function setPlayAll(on) {
  state.playAll = on;
  $('playAll').checked = on;
  buildTree();
}

$('playAll').checked = state.playAll;
$('playAll').onchange = (e) => setPlayAll(e.target.checked);

function buildTree() {
  const tree = $('tree');
  tree.innerHTML = '';

  for (const f of orderedFolders()) {
    const open = !!state.openFolders[f.name];

    const row = document.createElement('div');
    row.className = 'folder-row' + (state.selectedFolder === f.name ? ' selected' : '');
    row.draggable = true;
    row.innerHTML = `
      <span class="grip" title="Drag to reorder">⋮⋮</span>
      <span class="twisty${open ? ' open' : ''}">▸</span>
      <span class="dot ${f.confidence}"></span>
      <span class="label"></span>
      <span class="count">${folderCount(f)}</span>`;
    row.querySelector('.label').textContent = f.name;
    row.querySelector('.dot').title = `${f.confidence} confidence`;
    row.title = `${f.level1} › ${f.level2} — ${f.categories}`;
    row.onclick = () => toggleFolder(f.name);
    wireDrag(row, f.name);
    tree.appendChild(row);

    if (!open) continue;

    const kids = document.createElement('div');
    kids.className = 'folder-files';
    const files = state.folderFiles[f.name];

    if (!files) {
      kids.innerHTML = '<div class="loading">loading…</div>';
    } else {
      const matching = files.filter(matchesFilter);
      const shown = matching.filter(listed);
      const hidden = matching.length - shown.length;
      if (!shown.length) {
        // Say which switch is doing it, rather than leaving an empty folder to
        // look like an empty folder.
        kids.innerHTML = hidden
          ? `<div class="loading">${hidden} without an audio header — turn on Play all files</div>`
          : '<div class="loading">no matches</div>';
      } else {
        for (const file of shown) kids.appendChild(fileRow(file));
        if (hidden) {
          const note = document.createElement('div');
          note.className = 'loading';
          note.textContent = `${hidden} more without an audio header`;
          kids.appendChild(note);
        }
      }
    }
    tree.appendChild(kids);
  }

  requestThumbs();
}

function fileRow(file) {
  const el = document.createElement('div');
  const isCur = state.selectedFile?.path === file.path;
  el.className = 'file-row' + (isCur ? ' selected' : '') +
    (engine.path === file.path && engine.playing ? ' playing' : '');
  el.dataset.path = file.path;
  el.innerHTML = `
    <button class="pb" title="Play">▶</button>
    <canvas class="thumb" width="54" height="24"></canvas>
    <div class="info">
      <div class="fname"></div>
      <div class="fmeta">
        <span>${fmtDur(file.duration)}</span>
        <span>·</span>
        <span class="cat"></span>
      </div>
    </div>
    <span class="dot ${file.confidence}"></span>`;

  el.querySelector('.fname').textContent = file.name;

  // What the sound *is*, in preference to the filename classifier's guess at a
  // category. The old value is kept when nothing has been heard yet, so the row
  // never goes blank while the model is still working through the library.
  const word = heardWord(file.path);
  const cat = el.querySelector('.cat');
  cat.textContent = word || file.category;
  cat.classList.toggle('heard', !!word);

  const heard = state.heard[file.path] || [];
  const borrowed = heard.length && heard[0].from;
  el.querySelector('.dot').title =
    `${file.confidence} confidence — ${file.why || 'no reason recorded'}`;
  el.title = heard.length
    ? heard.map((w) => `${w.label} ${w.score.toFixed(2)}`).join(', ') +
      (borrowed ? `\nheard in ${borrowed.split('/').pop()}, not this file` : '')
    : file.why || file.name;

  el.querySelector('.pb').onclick = (e) => { e.stopPropagation(); playFile(file); };
  el.onclick = () => {
    // In the editor a single click opens the sound as its own tab, because the
    // drawer is only ever open when you are reaching for the next thing.
    if (state.mode === 'edit') openInEditor(file);
    else selectFile(file);
  };
  el.ondblclick = () => openInEditor(file);

  drawThumb(el.querySelector('.thumb'), state.thumbs[file.path], isCur);
  return el;
}

function wireDrag(row, name) {
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', name);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drop-target');
    const moved = e.dataTransfer.getData('text/plain');
    if (!moved || moved === name) return;
    const names = orderedFolders().map((x) => x.name);
    names.splice(names.indexOf(moved), 1);
    names.splice(names.indexOf(name), 0, moved);
    state.order = names;
    buildTree();
    saveOrder();
  });
}

async function toggleFolder(name) {
  const wasOpen = !!state.openFolders[name];
  state.openFolders[name] = !wasOpen;
  state.selectedFolder = name;

  const folder = state.folders.find((f) => f.name === name);
  if (folder) fillTagPanel(folder);

  buildTree();
  if (!wasOpen && !state.folderFiles[name]) {
    try {
      state.folderFiles[name] = await api(`/api/files?folder=${encodeURIComponent(name)}`);
    } catch (e) {
      toast(e.message);
      state.folderFiles[name] = [];
    }
    buildTree();
    loadHeard(name);
  }
}

/// Ask what the classifier makes of a folder's sounds.
///
/// Deliberately not awaited by the caller: the first call for a library has to
/// run every file through the model, and the browser should be usable while
/// that happens. The rows fill in when it returns.
async function loadHeard(name) {
  let r;
  try {
    r = await api(`/api/labels?folder=${encodeURIComponent(name)}`);
  } catch {
    return;                       // no model, or no library — rows keep the old text
  }
  Object.assign(state.heard, r.files || {});
  buildTree();
}

/// The one word for a sound, for a list that has room for one word.
function heardWord(path) {
  const words = state.heard[path];
  return words && words.length ? words[0].label : '';
}

// --------------------------------------------------------------- thumbnails

/// Fetch overviews for the rows currently built, in one batch.
///
/// Batched and debounced because a folder of several hundred files would
/// otherwise fire hundreds of requests that queue behind the browser's
/// per-host connection limit.
let thumbTimer;
function requestThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    const wanted = [...document.querySelectorAll('.file-row')]
      .map((el) => el.dataset.path)
      .filter((p) => p && state.thumbs[p] === undefined)
      .slice(0, 300);
    if (!wanted.length) return;

    // Mark as in-flight so a redraw does not request them again.
    for (const p of wanted) state.thumbs[p] = null;

    let got;
    try { got = await postJSON('/api/thumbs', { paths: wanted, cols: 54 }); }
    catch { return; }

    for (const [path, b64] of Object.entries(got)) state.thumbs[path] = b64;
    for (const el of document.querySelectorAll('.file-row')) {
      const p = el.dataset.path;
      if (got[p]) drawThumb(el.querySelector('.thumb'), got[p], el.classList.contains('selected'));
    }
  }, 60);
}

/// The colour audio is drawn in, whatever the theme.
///
/// A waveform is a reading rather than decoration — you judge level and shape by
/// it — so it has to look the same every time. These five canvases used to take
/// the accent, which meant a palette could turn every waveform in the program
/// brown. `--wave` and `--wave-2` are outside the theme map on purpose.
///
/// `--wave` is green and is the one drawn; `--wave-2` is the blue alternative
/// and no call site passes `second` yet. Being outside the map is what protects
/// them — not being an unusual colour — so `--wave` matching Conifer's accent
/// exactly is the design rather than a clash, and is what the blue original did
/// too.
function waveInk(second = false) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(second ? '--wave-2' : '--wave').trim();
}

/// Any token, for the canvases — which cannot write `var(--x)` and have to be
/// handed a colour.
///
/// This is the seam every hardcoded hex in a canvas should come through. There
/// were 187 of those; the ones still left are why a theme reaches the chrome and
/// not the plots.
function ink(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/// Draw with a token at a fraction of its opacity.
///
/// The tokens are `oklch(...)` with no alpha channel, and pasting one into an
/// `rgba()` is what produced the hardcoded literals in the first place. Setting
/// `globalAlpha` instead keeps the colour a single source of truth and is what
/// `drawThumb` already did.
function withAlpha(c, a, draw) {
  const was = c.globalAlpha;
  c.globalAlpha = a;
  try { draw(); } finally { c.globalAlpha = was; }
}

function drawThumb(canvas, b64, selected) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!b64) return;

  const bin = atob(b64);
  const n = bin.length;
  const mid = canvas.height / 2;
  ctx.fillStyle = waveInk();
  ctx.globalAlpha = selected ? 0.95 : 0.55;

  const w = canvas.width / n;
  for (let i = 0; i < n; i++) {
    const amp = bin.charCodeAt(i) / 255;
    const h = Math.max(1, amp * (canvas.height - 2));
    ctx.fillRect(i * w, mid - h / 2, Math.max(w - 0.4, 0.6), h);
  }
  ctx.globalAlpha = 1;
}

$('treeFilter').oninput = (e) => {
  state.filter = e.target.value.toLowerCase().trim();
  buildTree();
};

// ==================================================================== audio
//
// Playback is the Rust engine's, not the browser's. There is no <audio>
// element: the engine owns the output device, renders the grains itself and
// reports where it has got to. That removes a whole category of problem the
// element used to create — a coarse media clock, cache-busted URLs to force a
// reload after every parameter change, autoplay policy, and a loop wrap driven
// from an animation frame.
//
// What is left is a thin client: post transport commands, poll for position.

const engine = {
  path: null,
  /// Whether what is loaded is the bare file or the document.
  ///
  /// The library auditions a sound; the editor plays a document. Both go
  /// through the same load, so the engine has to remember which it was given
  /// or pressing play in the editor would resume the audition.
  raw: false,
  playing: false,
  /// Engine output frames, at the device's rate. Authoritative.
  position: 0,
  deviceRate: 48000,
  /// performance.now() when `position` was last heard from.
  heard: 0,
  /// Whether this machine has an audio output at all.
  ///
  /// `null` until asked. The server opens the device lazily, so a box with no
  /// output answers every engine route with 503 — and the interface used to
  /// keep asking, which put a failed request in the console for every engine
  /// switch and every transport press. Browsing, editing, tagging and
  /// exporting all work perfectly well without a device; only playback does
  /// not. So it asks once and then stops asking.
  device: null,
  spectrum: null,
  /// The shape of the last output window, -127..127. What the compressor's
  /// display draws its signal from.
  waveform: null,
  gain: 0.85,
  /// Where the engine says it wraps, in engine output frames, or null.
  ///
  /// Reported rather than computed here: a loop end of zero means "the whole
  /// document" and only the callback knows how long that is under the current
  /// ratio. This side guessed once and playback ran past the end of a looping
  /// file.
  loop: null,
  /// How far ahead of the speaker the frame counter is.
  ///
  /// The counter counts frames *produced*; the device holds a buffer of them
  /// before any are heard. Drawing straight from it puts the playhead ahead of
  /// the sound. The backend reports this, so it is measured, not assumed.
  latency: 0,
};

$('volume').oninput = (e) => {
  engine.gain = +e.target.value;
  enginePost({ gain: engine.gain });
};

/// Is there anything to play through?
const noAudio = () => engine.device === false;

/// Ask once, at startup, and tell the interface.
///
/// `/api/engine/state` is the one engine route that answers without a device —
/// see `api_engine_state`. Everything else here is gated on what it says.
async function checkAudioDevice() {
  try {
    const r = await api('/api/engine/state');
    engine.device = r.device !== false;
    engine.deviceError = r.deviceError || '';
  } catch {
    // Unreachable is not the same as absent: leave it unknown and let the
    // calls try, rather than switching the transport off over one bad fetch.
    engine.device = null;
  }
  reflectAudioDevice();
}

/// Say so, once, in the transport bar — and take the controls out of service.
///
/// A transport that looks live and silently does nothing is worse than one that
/// says why.
function reflectAudioDevice() {
  const off = noAudio();
  const note = $('noAudio');
  if (note) {
    note.classList.toggle('hidden', !off);
    note.title = engine.deviceError || 'This machine has no audio output.';
  }
  for (const id of ['playBtn', 'stopBtn', 'loopBtn', 'recBtn']) {
    const b = $(id);
    if (!b) continue;
    b.disabled = off;
    if (off) b.title = 'No audio device on this machine';
  }
}

async function enginePost(body) {
  if (noAudio()) return null;
  try {
    return await postJSON('/api/engine/transport', body);
  } catch (e) {
    toast(e.message);
    return null;
  }
}

/// Load a file into the engine. Expensive — once per file, never per control.
async function engineLoad(file, { raw = false } = {}) {
  if (noAudio()) return false;
  try {
    const r = await api(
      `/api/engine/load?p=${encodeURIComponent(file.path)}${raw ? '&raw=1' : ''}`,
      { method: 'POST', body: '{}' },
    );
    engine.path = file.path;
    engine.raw = raw;
    engine.deviceRate = r.sampleRate || 48000;
    return true;
  } catch (e) {
    toast('Cannot play: ' + e.message);
    return false;
  }
}

// ------------------------------------------------------- frames and time
//
// Three frames of reference meet here. The file has its own sample rate; the
// device has another; and the engine counts *output* frames, which the stretch
// ratio separates from source frames. Everything below converts between them in
// one place so no call site has to remember which it is holding.

/// Time ratio between what is playing and the source the overview shows.
const timeRatio = () => {
  const r = state.edit?.stretch?.ratio;
  return r && isFinite(r) && r > 0 ? r : 1;
};

/// File sample rate over device sample rate.
const rateScale = () =>
  (state.view.sampleRate || 48000) / (engine.deviceRate || 48000);

/// Engine output frame to a frame in the source file.
const srcFromEngine = (p) => (p / timeRatio()) * rateScale();

/// A frame in the source file to an engine output frame.
const engineFromSrc = (f) => (f / rateScale()) * timeRatio();

/// Where the engine is now.
///
/// The engine's own count is sample accurate, but it is polled rather than
/// shared, so this carries it forward on the wall clock between polls. The
/// anchor is exact and cannot drift: every poll resets it.
/// Where the engine is now, in engine output frames.
///
/// The count is polled twenty times a second and carried forward on the wall
/// clock in between, so the playhead moves at the frame rate rather than in
/// twenty steps. Two corrections on top of that:
///
/// **The loop.** Carrying forward is monotonic, and a loop is not. Between one
/// poll and the next the playhead ran past the loop end and was dragged back
/// when the truth arrived — on a short loop that is most of the loop, drawn
/// outside it, flickering. So the carried-forward part wraps where the engine
/// says it wraps.
///
/// **The output latency.** The counter is frames produced, not frames heard.
/// Subtracting what the device reports puts the line on the sound rather than
/// a buffer ahead of it.
function enginePosition() {
  if (!engine.playing || !engine.heard) return Math.max(0, engine.position - engine.latency);
  const dt = (performance.now() - engine.heard) / 1000;
  let p = engine.position + dt * engine.deviceRate - engine.latency;

  const lp = engine.loop;
  if (lp && lp.b > lp.a) {
    const span = lp.b - lp.a;
    if (p >= lp.b) p = lp.a + ((p - lp.a) % span);
    // Latency can push the first moments of a loop back before its start,
    // which belongs at the far end of the previous pass rather than clamped.
    else if (p < lp.a) p = lp.b - ((lp.a - p) % span);
  }
  return Math.max(0, p);
}

function playbackTime() {
  return enginePosition() / (engine.deviceRate || 48000);
}

/// How far out the clock has to be before it is corrected in one step rather
/// than eased. A quarter of a second is far past anything the network can
/// account for, so what is left is a seek, a loop wrap or a start — real
/// discontinuities, which should look like discontinuities.
const CLOCK_SNAP_SECONDS = 0.25;
/// How much of the remaining error is taken out per poll. At twenty polls a
/// second this settles in about a fifth of a second, which is quick enough to
/// track drift and slow enough that no single correction is visible.
const CLOCK_GAIN = 0.12;

/// Take a position from the engine without lurching.
///
/// The poll used to write `engine.position = r.position` and stamp
/// `engine.heard = performance.now()`. That is a hard snap twenty times a
/// second: the value was true at some instant on the engine, but the stamp is
/// when the *reply arrived*, so the baseline moved by however much the round
/// trip varied that time. Between polls the playhead glides; at each poll it
/// jumps by the network's jitter.
///
/// Measured against a perfect clock sampled with a 2–18 ms arrival spread: a
/// tick that should advance 800 frames was out by up to 687 of them — 14.3 ms,
/// most of a frame — with an RMS error of 184. That is the stutter, and no
/// amount of drawing faster would have touched it.
///
/// So the error is not applied, it is *dissolved*: predict where we already
/// think we are, take a fraction of the difference, and carry on. Only a
/// genuine discontinuity is allowed to jump.
function lockClock(reported) {
  const now = performance.now();
  const rate = engine.deviceRate || 48000;
  if (!engine.playing || !engine.heard) {
    engine.position = reported;
    engine.heard = now;
    return;
  }
  const predicted = engine.position + ((now - engine.heard) / 1000) * rate;
  const error = reported - predicted;
  if (Math.abs(error) > CLOCK_SNAP_SECONDS * rate) {
    engine.position = reported;
    engine.heard = now;
    return;
  }
  // Re-base on our own prediction, nudged. The playhead never moves by the
  // correction; it moves by the clock, and the correction changes its slope by
  // a fraction of a per cent.
  engine.position = predicted + error * CLOCK_GAIN;
  engine.heard = now;
}

/// Playback position expressed as a frame in the source file.
const sourceFrameNow = () => srcFromEngine(enginePosition());

/// Ask the engine to put the playhead on a source frame.
function seekSource(srcFrame) {
  const p = Math.max(0, engineFromSrc(srcFrame));
  engine.position = p;
  engine.heard = performance.now();
  enginePost({ seek: p });
}

// ------------------------------------------------------------- transport

/// Audition a sound, or play a document.
///
/// In the library it is the sound itself — no edits, no stretch, no grain
/// cloud, no rack. Clicking a file there is a question about the file, and
/// answering it through whatever was last done to that file answers a
/// different question: a one-shot playing back thirty-six times longer than it
/// is, because of something set last week, tells you nothing about the sound.
///
/// In the editor the document is the point, so it plays in full.
async function playFile(file) {
  const raw = state.mode !== 'edit';
  // Same sound *and* the same kind of playback: otherwise it has to be
  // reloaded, or pressing play in the editor would resume the audition.
  if (engine.path === file.path && engine.raw === raw) {
    engine.playing ? pausePlayback() : startPlayback();
    return;
  }
  if (state.selectedFile?.path !== file.path) selectFile(file);
  if (!(await engineLoad(file, { raw }))) return;
  applyLoop();
  seekSource(state.cue || 0);
  startPlayback();
}

function startPlayback() {
  engine.playing = true;
  captureFollow(true);
  engine.heard = performance.now();
  reflectTransport();
  enginePost({ play: true });
  startTransportLoop();
  startPolling();
  startSwarm();
}

function pausePlayback() {
  engine.playing = false;
  // After the poll loop has stopped, not before: a request already in flight
  // lands with the last levels that were heard and paints them back on.
  setTimeout(resetRackMeters, 120);
  captureFollow(false);
  reflectTransport();
  enginePost({ play: false });
  updatePlayhead();
  updateOverviewPlayhead();
  paintTime();
  stopSwarm();
}

function reflectTransport() {
  const b = $('playBtn');
  b.classList.toggle('on', engine.playing);
  b.textContent = engine.playing ? '❚❚' : '▶';
  markPlaying();
  // One more pass so the lane playhead is cleared when playback ends; the poll
  // loop that normally draws it has already stopped by then.
  repaintAutomationLanes();
}

function markPlaying() {
  document.querySelectorAll('.file-row').forEach((el) => {
    const on = el.dataset.path === engine.path && engine.playing;
    el.classList.toggle('playing', on);
    const b = el.querySelector('.pb');
    if (b) { b.classList.toggle('on', on); b.textContent = on ? '❚❚' : '▶'; }
  });
}

// --------------------------------------------------------------- polling
//
// One request serves the playhead, the swarm and the spectrum, because all
// three describe the same instant and fetching them separately would let them
// disagree. Deliberately not on an animation frame: a hidden window stops
// painting, and the audio does not stop with it.

let pollTimer = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!engine.playing || noAudio()) { stopPolling(); return; }
    try {
      const r = await api('/api/engine/grains');
      engine.deviceRate = r.sampleRate || engine.deviceRate;
      lockClock(r.position);
      engine.loop = r.loop || null;
      engine.latency = r.latency || 0;
      engine.spectrum = r.spectrum && r.spectrum.length ? r.spectrum : engine.spectrum;
      engine.waveform = r.waveform && r.waveform.length ? r.waveform : engine.waveform;
      // The rail's meters and its visual editors are driven from the same poll
      // as the playhead, so everything on screen describes one instant.
      // All three draw into the effects rail, so none of them is worth doing
      // while another dock is open. The meters are the expensive one: a needle
      // per stage, redrawn on every poll, whether or not the rail is on screen.
      engine.rackLevels = r.rackLevels || [];
      engine.load = r.load || null;
      // Grains the voice pool had no room for. Counted in the callback and
      // surfaced rather than degrading quietly.
      engine.overflows = r.overflows ?? engine.overflows ?? 0;
      paintLoad();
      // The schedule is windowed now, and the swarm reads it around the
      // playhead — so playing out of the covered range would empty it. Cheap:
      // this returns immediately unless the playhead is near the edge.
      grainsFollowView();
      if (!$('dockEffects')?.classList.contains('hidden')) {
        paintRackMeters(r.rackLevels || []);
        repaintVisualEqs();
        repaintVisualCompressors();
      }
      repaintVisualChamberlins();
      repaintAutomationLanes();
      if (!r.playing && engine.playing) {
        // The engine stopped itself at the end of the document. Drop back to
        // the cue so pressing play again auditions the same moment.
        engine.playing = false;
        captureFollow(false);
        reflectTransport();
        stopSwarm();
        resetRackMeters();
        returnToCue();
        paintTime();
        updatePlayhead();
        updateOverviewPlayhead();
      }
    } catch { /* a dropped poll is a stale playhead, not a failure */ }
  }, 50);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

let transportRaf = null;
function startTransportLoop() {
  if (transportRaf) return;
  const tick = () => {
    if (!engine.playing) { transportRaf = null; return; }
    transportRaf = requestAnimationFrame(tick);
    paintTime();
    followPlayhead();
    updatePlayhead();
    updateOverviewPlayhead();
  };
  tick();
}

function paintTime() {
  $('timeNow').textContent = fmtTime(playbackTime());
}

/// Stop the transport if it is playing something other than `file`.
///
/// The transport belongs to the sound on screen. Choosing a different one
/// while the old was still playing left it playing underneath the new picture,
/// with the playhead running against a timeline it did not belong to — and the
/// capture button would then have kept the wrong sound entirely.
///
/// The guard is on the *path*, not on whether anything is playing, because
/// `playFile` selects before it loads: the sound being started is never the one
/// stopped here.
function releaseEngineFor(file) {
  if (engine.playing && engine.path && file && engine.path !== file.path) {
    pausePlayback();
  }
}

/// Play means play *what is selected*, not whatever the engine is holding.
///
/// Selecting a sound deliberately does not load it — loading folds the whole
/// document into a buffer and hands it over, which is far too much to do on
/// every click in the library — so after picking a second sound the engine is
/// still holding the first. This used to ask only whether the engine had
/// *anything* loaded, which is false exactly once: the first play after
/// launch. Every play after that resumed the previous sound while the screen
/// showed the new one.
///
/// `playFile` already knows both cases: same path, toggle; different path,
/// load it and start from the cue.
$('playBtn').onclick = async () => {
  if (state.selectedFile) { await playFile(state.selectedFile); return; }
  if (!engine.path) return;
  engine.playing ? pausePlayback() : startPlayback();
};

// The cue: where playback starts from and returns to. Set by clicking the
// waveform, and kept until it is moved or cleared, so repeated auditions of the
// same moment do not mean re-finding it every time.
state.cue = 0;

function setCue(srcFrame) {
  state.cue = Math.max(0, srcFrame || 0);
  drawCue();
}

function drawCue() {
  updateOverviewCue();
  const el = $('cue');
  if (!el) return;
  const { from, to } = state.view;
  if (!state.peaks || to <= from || state.cue == null) { el.style.display = 'none'; return; }
  if (state.cue < from || state.cue > to) { el.style.display = 'none'; return; }
  const w = $('lane').clientWidth || 0;
  el.style.display = 'block';
  el.style.transform = `translateX(${(((state.cue - from) / (to - from)) * w).toFixed(2)}px)`;
}

function returnToCue() {
  seekSource(state.cue || 0);
}

$('stopBtn').onclick = () => {
  pausePlayback();
  returnToCue();
  updatePlayhead();
  paintTime();
};

/// Double-click for the top of the file, rather than for the cue.
///
/// Stop returns to the cue, which is right — it is where you said playback
/// starts from — but it leaves no way back to the beginning except moving the
/// cue there, and then you have lost the cue.
///
/// So the cue is deliberately not touched by this. The comment on `state.cue`
/// is the reason: the point of a cue is that auditioning the same moment over
/// and over does not mean re-finding it, and a transport gesture that quietly
/// threw it away would cost more than it saved. This is a return to zero, not
/// a re-cue.
///
/// The pair of clicks underneath arrive first and each returns to the cue, so
/// the seek to zero lands last and wins.
$('stopBtn').ondblclick = () => {
  pausePlayback();
  seekSource(0);
  updatePlayhead();
  paintTime();
};

// ------------------------------------------------------------ loop playback

// Loop is simply on or off. What it loops follows from whether anything is
// selected — a selection loops, otherwise the whole file — so the button never
// needs a mode and never goes stale when the selection changes.
//
// The wrap itself happens in the audio callback, which fades across the seam on
// an exact frame. The browser cannot do that and never could.
state.loopOn = false;

function applyLoop() {
  const hasSel = !!state.sel && state.sel.end > state.sel.start;
  // Zero means "the whole document". The engine knows how long that is under
  // the current ratio; this side would have to recompute it on every stretch
  // change and would eventually be wrong.
  enginePost({
    loop: {
      on: !!state.loopOn,
      a: hasSel ? Math.max(0, Math.round(engineFromSrc(state.sel.start))) : 0,
      b: hasSel ? Math.max(0, Math.round(engineFromSrc(state.sel.end))) : 0,
    },
  });

  const btn = $('loopBtn');
  btn.classList.toggle('on', state.loopOn);
  const what = hasSel ? 'selection' : 'whole file';
  btn.title = state.loopOn ? `Looping the ${what}` : 'Loop off';
  $('loopLabel').textContent = state.loopOn ? what : '';
}

$('loopBtn').onclick = () => { state.loopOn = !state.loopOn; applyLoop(); };

/// Start a selection loop from the beginning of the selection.
async function playSelectionLoop() {
  if (!state.selectedFile) return;
  state.loopOn = true;
  if (state.sel) setCue(state.sel.start);
  await playFile(state.selectedFile);
  applyLoop();
}

/// The playback position on the whole-file overview.
///
/// Drawn against the file's full length, not the zoomed range, so it still
/// tells you where you are once playback has run outside the window.
function updateOverviewPlayhead() {
  const el = $('ovPlayhead');
  if (!el) return;
  const total = state.view.frames || state.overview?.frames || 0;
  const w = $('overview')?.clientWidth || 0;
  if (!state.peaks || !total || !w) { el.style.display = 'none'; return; }
  const frame = sourceFrameNow();
  if (!isFinite(frame)) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.transform =
    `translateX(${(Math.max(0, Math.min(1, frame / total)) * w).toFixed(2)}px)`;
}

function updateOverviewCue() {
  const el = $('ovCue');
  if (!el) return;
  const total = state.view.frames || state.overview?.frames || 0;
  const w = $('overview')?.clientWidth || 0;
  if (!state.peaks || !total || !w || state.cue == null) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.transform =
    `translateX(${(Math.max(0, Math.min(1, state.cue / total)) * w).toFixed(2)}px)`;
}


/// The grains, drawn on the sound they read from.
///
/// Two layers, because they answer two different questions. The faint one is
/// every grain in the schedule at the place in the file it reads from — the
/// shape of what the cloud is going to do to this sound, standing still. The
/// bright one is the handful sounding at this instant, struck and fading, so
/// the playhead crossing the file *does* something visible rather than sliding
/// over a picture.
///
/// It sits on the source timeline, which is the lane's axis and not the
/// schedule's. On a stretched document that means the same few marks are struck
/// again and again as the head crawls through them, and that is the honest
/// picture: at eight times the cloud really is re-reading one stretch of file
/// over and over.
///
/// Above the waveform and below the selection: it describes the sound, it is
/// not something you grab.
/// How many schedule marks the waveform layer will draw.
///
/// Raised from 2,000. The server now spends its cap inside the visible window
/// rather than across the whole document, so at any zoom there are thousands of
/// real grains on screen to draw — and the old cap threw three quarters of them
/// away again on this side. Canvas strokes a single path for all of them, so
/// this is one draw call whatever the number.
/// Where on the lane the grain marks are struck from, as a fraction of its
/// height.
///
/// It was `h / 2` — the middle of the *layer*, which spans the whole lane. With
/// the spectrogram splitting that lane the waveform only has the top of it, so
/// the marks were struck from a line well below the sound they describe. The
/// default now follows the split, and the grip overrides it.
const GRAIN_CENTRE_STORE = 'audiolab.grainCentre';

function grainCentreDefault() {
  const lane = $('lane');
  if (lane && lane.classList.contains('split')) return laneSplit() / 200;
  return 0.5;
}

function grainCentre() {
  const v = Number(localStorage.getItem(GRAIN_CENTRE_STORE));
  return Number.isFinite(v) && v > 0.02 && v < 0.98 ? v : grainCentreDefault();
}

function setGrainCentre(frac, { save = true } = {}) {
  const v = Math.min(0.98, Math.max(0.02, frac));
  if (save) {
    try { localStorage.setItem(GRAIN_CENTRE_STORE, String(v)); } catch { /* private mode */ }
  } else {
    setGrainCentre.live = v;
  }
  placeGrainCentre(v);
  drawGrainLayer();
  return v;
}

function placeGrainCentre(frac) {
  const grip = $('grainCentre');
  if (grip) grip.style.top = `${(frac * 100).toFixed(3)}%`;
}

/// While dragging, the live value; otherwise what is stored.
function grainCentreNow() {
  const grip = $('grainCentre');
  if (grip?.classList.contains('dragging') && setGrainCentre.live !== undefined) {
    return setGrainCentre.live;
  }
  return grainCentre();
}

const GRAIN_LAYER_CAP = 12000;

/// How long a struck grain stays lit, in seconds of output.
const SIZZLE_SECONDS = 0.28;

function drawGrainLayer() {
  const el = $('grainLayer');
  if (!el) return;
  const g = state.grains;
  const { from, to, sampleRate } = state.view;
  if (!g?.grains?.length || !state.peaks || !sampleRate || to <= from) {
    el.classList.add('hidden');
    $('grainCentre')?.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  $('grainCentre')?.classList.remove('hidden');

  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  // Both dimensions, not just the width.
  //
  // Testing the width alone meant a change in *height* never re-sized the
  // backing store: make the window taller and the element went to 663 CSS px
  // while its canvas stayed 766 device px tall — everything drawn into it
  // squashed by a factor of 1.7, at a size nothing on screen had. The width is
  // the one that usually changes, which is exactly why this survived.
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
  }
  const c = el.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const mid = h * grainCentreNow();
  const sr = g.sampleRate || sampleRate;
  const playFrame = playbackTime() * sr;
  const span = to - from;
  const x = (frame) => ((frame - from) / span) * w;
  const base = state.edit?.stretch?.semitones ?? 0;

  // Thinned to what is *in view*, not to the whole schedule.
  //
  // Striding the whole file and then dropping whatever fell off the edges meant
  // zooming in showed the same handful of marks further apart — the picture got
  // bigger and no more detailed, which is backwards. Zooming in is asking to
  // see more, so the closer the window gets the more of the real schedule
  // appears in it.
  const all = g.grains;
  const inView = [];
  for (const ev of all) {
    if (ev[1] >= from && ev[1] <= to) inView.push(ev);
  }
  const stride = Math.max(1, Math.ceil(inView.length / GRAIN_LAYER_CAP));

  // ── the layer ───────────────────────────────────────────────────────────
  // Marks grow with the zoom. Far out, each grain is a fraction of a pixel and
  // wants to be a faint tick; far in, one grain may be tens of pixels wide, and
  // a five-pixel tick says nothing about its length. So the mark is drawn at the
  // grain's real duration once that is worth seeing, and the opacity rises as
  // they thin out — which is what "more visible as you zoom in" has to mean if
  // the density stays honest.
  const pxPerFrame = w / Math.max(1, to - from);
  const spread = inView.length ? (to - from) / inView.length : 0;
  const apart = spread * pxPerFrame;
  const ink = Math.min(0.55, 0.13 + apart * 0.06);
  const tall = Math.min(h * 0.42, 5 + apart * 1.5);

  c.lineWidth = 1;
  c.strokeStyle = waveInk(true);
  c.globalAlpha = ink;
  c.beginPath();
  for (let i = 0; i < inView.length; i += stride) {
    const px = x(inView[i][1]);
    // Short ticks off the centre line rather than full-height bars: the
    // waveform underneath is the thing being read, and a picket fence over it
    // hides exactly what the marks are about.
    c.moveTo(px, mid - tall);
    c.lineTo(px, mid + tall);
  }
  c.stroke();
  c.globalAlpha = 1;

  // ── the sizzle ──────────────────────────────────────────────────────────
  //
  // Every grain that has been struck within the last fraction of a second,
  // brightest at the moment it starts. Drawn from the schedule rather than
  // remembered, so it is a pure function of where the playhead is — scrub
  // backwards and the same grains light in the same places.
  // Struck from the densest copy that covers the playhead. The view's schedule
  // is thinned to fit the cap across the whole window; the swarm's is eight
  // seconds wide and so arrives whole. Ticks stay on the view copy — they are a
  // picture of the *whole* range and want its spread, not the playhead's.
  const sparks = (swarmFor && state.swarm?.grains?.length
    && playFrame >= swarmFor[0] && playFrame <= swarmFor[1])
    ? state.swarm.grains
    : all;

  let lit = 0;
  for (const [outFrame, srcFrame, size, pitch, rms, bright] of sparks) {
    const since = (playFrame - outFrame) / sr;
    if (since < 0 || since > SIZZLE_SECONDS) continue;
    const px = x(srcFrame);
    if (px < -4 || px > w + 4) continue;
    lit++;

    const t = 1 - since / SIZZLE_SECONDS;
    const heat = t * t;
    const lvl = Math.min(1, (rms || 0) * 7 + 0.15);
    const half = (6 + lvl * (h * 0.42)) * (0.45 + heat * 0.55);
    const warm = (pitch - base) >= 0;

    // The spark: a bright core with a short bloom, which is what makes it read
    // as struck rather than merely coloured in.
    const grd = c.createLinearGradient(px, mid - half, px, mid + half);
    const core = warm
      ? `rgba(255, ${190 - Math.min(70, (pitch - base) * 6) | 0}, 130,`
      : `rgba(150, 205, 255,`;
    grd.addColorStop(0, `${core} 0)`);
    grd.addColorStop(0.5, `${core} ${(0.28 + heat * 0.62).toFixed(3)})`);
    grd.addColorStop(1, `${core} 0)`);
    c.strokeStyle = grd;
    c.lineWidth = 1 + heat * 1.6 + (bright || 0) * 2;
    c.beginPath();
    c.moveTo(px, mid - half);
    c.lineTo(px, mid + half);
    c.stroke();
  }

  // Only when it actually dropped some, and only where it cannot be mistaken
  // for part of the sound.
  if (stride > 1) {
    c.fillStyle = 'rgba(220,228,235,.35)';
    c.font = '9px ui-monospace, monospace';
    c.fillText(`1 grain in ${stride} shown · zoom in for more`, 6, h - 6);
  }
}

/// How much of the file the cloud is reading, drawn on the file.
///
/// A playhead is a line because ordinary playback reads one sample at a time.
/// A grain cloud reads a whole region at once — a spray of two hundred
/// milliseconds is two hundred milliseconds wide, and layer scatter can put
/// parts of it seconds away — so a line was saying something untrue about it.
///
/// Measured from the grains that are actually sounding rather than worked out
/// from the controls. Spray, scatter, layer count and the grain length all end
/// up in the answer without any of them having to be named here, and it cannot
/// disagree with what is being heard because it *is* what is being heard.
function updateReadBand() {
  const el = $('readBand');
  if (!el) return;
  const g = state.grains;
  const { from, to, sampleRate } = state.view;
  const lane = $('lane');
  if (!g?.grains?.length || !state.peaks || !sampleRate || to <= from || !lane) {
    el.style.display = 'none';
    return;
  }
  const sr = g.sampleRate || sampleRate;
  const playFrame = playbackTime() * sr;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [outFrame, srcFrame, size] of g.grains) {
    if (outFrame > playFrame || outFrame + size < playFrame) continue;
    // The whole span the grain reads, not just where it starts.
    if (srcFrame < lo) lo = srcFrame;
    if (srcFrame + size > hi) hi = srcFrame + size;
  }
  if (!isFinite(lo) || hi <= lo) { el.style.display = 'none'; return; }

  const w = lane.clientWidth || 0;
  const px = (f) => ((f - from) / (to - from)) * w;
  const a = px(lo);
  const b = px(hi);
  if (b < 0 || a > w) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.transform = `translateX(${Math.max(0, a).toFixed(2)}px)`;
  el.style.width = `${Math.max(1, Math.min(w, b) - Math.max(0, a)).toFixed(2)}px`;
}

function updatePlayhead() {
  // The playhead first, before anything that walks the grain schedule.
  //
  // This used to run after `updateReadBand` and `drawGrainLayer`, so the one
  // element that has to move every single frame was placed only once two full
  // passes over eight thousand grains and a canvas repaint had finished. Any
  // frame those overran was a frame the playhead did not move in.
  const ph = $('playhead');
  const { from, to, sampleRate } = state.view;
  if (!state.peaks || !sampleRate || to <= from) {
    ph.style.display = 'none';
    updateReadBand(); drawGrainLayer();
    return;
  }
  // The overview is the source, so the playhead has to be mapped back through
  // the stretch rather than plotted straight from the clock.
  const frame = sourceFrameNow();
  if (frame < from || frame > to) {
    ph.style.display = 'none';
    updateReadBand(); drawGrainLayer();
    return;
  }
  ph.style.display = 'block';
  // A transform rather than `left`: moving it every frame via a layout property
  // forces a reflow of the whole lane sixty times a second.
  const lane = $('lane');
  const x = ((frame - from) / (to - from)) * (lane.clientWidth || 0);
  ph.style.transform = `translateX(${x.toFixed(2)}px)`;
  // Now the rest, which may take as long as it likes.
  updateReadBand();
  drawGrainLayer();
}

// ============================================================ centre column

function setMode(mode) {
  // Which modes play the *document* rather than a library file. Edit and Room
  // are both looking at the open sound — the room is drawn from the same
  // playback the editor drives, which is what makes the picture and the
  // waveform the same thing seen twice.
  const docMode = mode === 'edit' || mode === 'room';

  // Crossing between the library and the editor changes what playback *is* —
  // the sound over there, the document over here — so anything running belongs
  // to the side it was started on. Same rule as choosing a different sound.
  //
  // Edit and Room are the same side, so moving between those two leaves the
  // transport alone: walking over to the room to look at what you are hearing
  // must not stop it.
  if (engine.playing && engine.raw !== !docMode) pausePlayback();

  const wasRoom = state.mode === 'room';
  state.mode = mode;
  const editing = mode === 'edit';
  const room = mode === 'room';

  // Borrowed elements go home before anything is measured or toggled. Leaving
  // this until later would have the mode's own show/hide rules applied to
  // elements still sitting inside a hidden view.
  if (wasRoom && !room) leaveRoomView();

  // The spectrogram is not an option in edit mode, it is what edit mode is for.
  state.showSpec = editing;
  $('specOn').checked = editing;
  $('lane').classList.toggle('split', editing);
  if (editing) {
    loadSpectrogram();
    startVisualiser();
  } else {
    stopVisualiser();
  }
  $('editTools').classList.toggle('hidden', !editing);
  // The transport belongs to the editor now. Browse has no open document to
  // transport, and the user asked for it gone there. The room has one and
  // shows it, moved down beside the export button — see `enterRoomView`.
  $('transportBar').classList.toggle('hidden', !docMode);
  $('ruler').classList.toggle('hidden', !editing);
  $('regions').classList.toggle('hidden', !editing);
  $('presetBar').classList.toggle('hidden', !editing);
  $('dock').classList.toggle('hidden', !editing);
  // The library's readout, which is Browse's own middle. Every other mode has
  // something else to put there.
  $('statsView').classList.toggle('hidden', mode !== 'overview');
  $('tabBar').classList.toggle('hidden', !editing);
  // The lane is the sound as a document — the thing you cut. The room is the
  // sound as a picture, and it takes the whole middle; the overview strip along
  // the top is what stays, because that is the one that says *where you are*.
  $('lane').classList.toggle('hidden', room);
  document.querySelectorAll('#leftRail .mode-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  $('modeLabel').textContent = editing ? 'Edit' : room ? 'Room' : 'Browse';
  document.body.classList.toggle('editing', editing);
  document.body.classList.toggle('roomview', room);
  // The modes that give the whole width to the middle, so the library becomes
  // a floating drawer rather than a docked column. Its own class rather than
  // `.editing, .roomview` repeated down the stylesheet: the drawer's geometry
  // is one idea and it should have one name, or the next mode to want it will
  // be a third selector added to six rules.
  document.body.classList.toggle('docmode', docMode);

  // After the toggles, so the parts it borrows are in the state this mode gave
  // them before they are moved.
  if (room) enterRoomView();

  // Edit has nothing to say about folder tags, and the rail's Browse tools
  // only make sense in Browse — but the library button still opens the drawer.
  for (const p of ['search', 'scan', 'import']) {
    const btn = document.querySelector(`#leftRail [data-panel="${p}"]`);
    if (btn) btn.classList.toggle('hidden', editing);
  }
  if (editing && !$('paneBrowse').classList.contains('hidden') === false) {
    showPane('left', 'browse');
  }

  const panel = $('leftPanel');
  if (docMode) {
    // Docked column becomes an overlay drawer, shut by default: the editor and
    // the room each get the whole width until you go looking for something.
    panel.classList.remove('collapsed');
    panel.classList.add('drawer-closed');
    state.drawerOpen = false;
    $('scrim').classList.add('hidden');
    // Entering with a file previewed makes it the first document. The room
    // wants this as much as the editor does: it is drawn from the document's
    // own playback, so arriving with nothing open is arriving at a test card
    // and a space bar that does nothing.
    if (state.selectedFile && !state.tabs.length) {
      state.tabs.push(blankTab(state.selectedFile));
      state.activeTab = 0;
      stashActiveTab();
    }
    renderTabs();
  } else {
    panel.classList.remove('drawer-closed', 'collapsed');
    state.drawerOpen = true;
    $('scrim').classList.add('hidden');
  }

  // The lane changes size between modes, so the canvas has to be re-measured
  // once the layout has settled.
  afterLayout(() => {
    layoutWaveBuffer();
    drawWave();
    if (state.showSpec) drawSpectrogram();
    drawSelection();
    drawMarkers();
  });
}

/// Run after the browser has applied pending layout changes.
///
/// A plain requestAnimationFrame is not enough on its own: a background or
/// non-painting tab never fires it, so anything scheduled that way would be
/// dropped. The timeout is the guarantee; the frame is the fast path.
function afterLayout(fn) {
  let done = false;
  const run = () => { if (!done) { done = true; fn(); } };
  requestAnimationFrame(run);
  setTimeout(run, 60);
}
document.querySelectorAll('#leftRail .mode-btn').forEach((b) => {
  b.onclick = () => {
    if (b.dataset.mode === 'edit' && !state.selectedFile && !state.tabs.length) {
      toast('Open a sound first — double-click one in the library');
      return;
    }
    setMode(b.dataset.mode);
  };
});

// Panels close with their ×; the rails are how they come back.
$('tagsToggle').onclick = () => {
  const closed = $('rightPanel').classList.toggle('collapsed');
  $('tagsToggle').classList.toggle('active', !closed);
};

/// Open a sound in the editor as its own document, alongside whatever is
/// already there. An already-open file is brought forward rather than reloaded.
async function openInEditor(file) {
  const existing = state.tabs.findIndex((t) => t.file.path === file.path);
  if (existing >= 0) {
    await switchTab(existing);
  } else {
    stashActiveTab();
    state.tabs.push(blankTab(file));
    adoptTab(state.tabs.length - 1);
    renderTabs();
    await selectFile(file, { keepTab: true });
  }
  setMode('edit');
  closeDrawer();
}

async function switchTab(i) {
  if (i === state.activeTab || !state.tabs[i]) return;
  // Same rule as picking one in the library: this one does not go through
  // `selectFile`, so it needs the transport released here as well.
  releaseEngineFor(state.tabs[i].file);
  stashActiveTab();
  adoptTab(i);
  renderTabs();
  buildTree();

  const f = state.selectedFile;
  $('titleFile').textContent = f.name;
  $('rateLabel').textContent = f.sampleRate
    ? `${(f.sampleRate / 1000).toFixed(1)} kHz · ${f.bits}-bit · ${f.channels}ch`
    : '—';
  renderMetaStrip(f);
  reflectEditState();
  renderRack();
  stretchBuiltFor = null; // different document, different sliders
  grainBuiltFor = null;
  renderStretch();
  renderGrainParams();
  drawSelection();
  drawMarkers();
  updateZoomLabel();

  // Peaks are kept per tab, so a return to a document is instant. Anything
  // missing — a tab restored before its first load finished — is fetched. The
  // canvas carries the last document's geometry until it is re-placed.
  layoutWaveBuffer();
  if (state.peaks) { drawWave(); } else { await loadPeaks(); }
  if (state.showSpec) { state.spec ? drawSpectrogram() : loadSpectrogram(); }
  if (!state.stats) loadStats();
}

function closeTab(i) {
  const wasActive = i === state.activeTab;
  state.tabs.splice(i, 1);
  if (!state.tabs.length) {
    state.activeTab = -1;
    renderTabs();
    setMode('overview');
    return;
  }
  if (wasActive) {
    state.activeTab = -1; // force switchTab to do the work
    adoptTab(Math.min(i, state.tabs.length - 1));
    state.activeTab = -1;
    switchTab(Math.min(i, state.tabs.length - 1));
  } else if (i < state.activeTab) {
    state.activeTab -= 1;
  }
  renderTabs();
}

function updateModeAvailability() {
  const btn = document.querySelector('#leftRail [data-mode="edit"]');
  if (btn) btn.disabled = !state.tabs.length && !state.selectedFile;
}

function renderTabs() {
  updateModeAvailability();
  const bar = $('tabBar');
  bar.innerHTML = '';
  state.tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === state.activeTab ? ' active' : '');
    const dirty = t.edit?.edited || t.rack?.active;
    el.innerHTML = `${dirty ? '<span class="dirty-dot"></span>' : ''}
      <span class="nm"></span><button class="close">×</button>`;
    el.querySelector('.nm').textContent = t.file.name;
    el.title = t.file.path;
    el.onclick = () => switchTab(i);
    el.querySelector('.close').onclick = (e) => { e.stopPropagation(); closeTab(i); };
    bar.appendChild(el);
  });

  const add = document.createElement('button');
  add.className = 'newtab';
  add.title = 'Open another sound';
  add.textContent = '+';
  add.onclick = () => openDrawer();
  bar.appendChild(add);
}

async function selectFile(file, { keepTab = false } = {}) {
  releaseEngineFor(file);
  state.selectedFile = file;
  state.sel = null;
  state.cue = 0;
  state.spec = null;
  state.view = { from: 0, to: 0, frames: 0, sampleRate: file.sampleRate || 44100 };
  if (!keepTab && state.mode === 'edit' && state.activeTab >= 0) {
    // Called outside the tab machinery while the editor is open; keep the
    // active tab pointing at what is actually on screen.
    state.tabs[state.activeTab].file = file;
    renderTabs();
  }

  $('titleFile').textContent = file.name;
  $('rateLabel').textContent = file.sampleRate
    ? `${(file.sampleRate / 1000).toFixed(1)} kHz · ${file.bits}-bit · ${file.channels}ch`
    : '—';

  buildTree();
  renderMetaStrip(file);
  drawSelection();
  updateModeAvailability();

  // The tag panel was only ever filled when a folder was clicked, so picking a
  // different sound left it showing whatever was last selected — and crossing
  // into another folder left it showing the wrong one entirely.
  const folderName = file.path.includes('/') ? file.path.split('/')[0] : state.selectedFolder;
  const folder = state.folders.find((f) => f.name === folderName);
  if (folder) {
    state.selectedFolder = folderName;
    fillTagPanel(folder);
  }
  showSonicTags(file);

  try { state.edit = await api(`/api/edit?p=${encodeURIComponent(file.path)}`); }
  catch { state.edit = null; }
  reflectEditState();
  renderStretch();

  await loadPeaks();
  loadStats();
  loadAnnotations();
  loadRack();
  loadAutomation();
  loadOverview();
  renderGrainParams();
  loadGrains();
  if (state.showSpec) loadSpectrogram();
}

// -------------------------------------------------------------------- peaks

let peakSeq = 0;

// ------------------------------------------------- following the playhead
//
// Following moves `state.view` — the range the lane shows — and everything
// drawn on top of the lane already reads from it, so the playhead, cue,
// selection and markers come along for free. What does not come for free is
// the picture: the peaks are a server response, and asking for a new one on
// every animation frame would be a request every 16ms for a strip that has
// barely moved. So the fetched range is deliberately wider than the lane, and
// the canvases holding it are slid sideways underneath. A new request is only
// needed once the lane walks off the end of what was fetched.

/// How much extra to fetch, in multiples of the visible span. Biased forward:
/// playback only ever moves one way, so a buffer kept behind the lane is a
/// buffer mostly wasted. A little is kept anyway, for a seek back or a page.
const FOLLOW_BEHIND = 0.35;
const FOLLOW_AHEAD = 1.9;

/// Refetch with this much of the lead still in hand, so the new picture has
/// time to arrive before the old one runs out.
const FOLLOW_MARGIN = 0.3;

/// The peaks endpoint will not return more than this many columns.
const PEAK_COLUMN_CAP = 8192;

/// Columns worth asking for across the lane itself: one per device pixel.
/// Asking in CSS pixels draws each column across two device pixels on a retina
/// display — half the detail the canvas can actually show.
const lanePixels = () => Math.max(200, Math.min(PEAK_COLUMN_CAP,
  Math.round(($('lane').clientWidth || 800) * (window.devicePixelRatio || 1))));

/// Whether the lane should be chasing the playhead right now. Fitted to the
/// whole file there is nothing to chase: the playhead cannot leave.
const following = () =>
  state.follow.on && engine.playing && state.mode === 'edit'
  && state.view.frames > 0 && state.view.to - state.view.from < state.view.frames;

/// How far the buffer reaches either side of the lane, in spans.
///
/// Trimmed to whatever the column budget allows. The alternative — asking for
/// the full buffer and letting the endpoint clamp the columns — spends the
/// extra width out of the detail instead, which is the one thing the buffer
/// must not cost.
function followShape() {
  const room = Math.max(0, PEAK_COLUMN_CAP / lanePixels() - 1);
  const fit = Math.min(1, room / (FOLLOW_BEHIND + FOLLOW_AHEAD));
  return { behind: FOLLOW_BEHIND * fit, ahead: FOLLOW_AHEAD * fit };
}

/// The frame range to ask the server for: the visible window, widened while
/// following. Null means the whole file, which is what "fit" is.
function peakWindow() {
  const { from, to, frames } = state.view;
  const span = to - from;
  if (!frames || span <= 0 || span >= frames) return null;
  if (!following()) return { from, to };
  const sh = followShape();
  return {
    from: Math.max(0, from - Math.round(span * sh.behind)),
    to: Math.min(frames, to + Math.round(span * sh.ahead)),
  };
}

/// Put each canvas where its own data belongs.
///
/// The lane shows `state.view`. A canvas holds whatever range its last response
// ────────────────────────────────────────────── the waveform/spectrum split ──
//
// The boundary between the two canvases, dragged. One custom property on the
// lane drives both heights and the handle's position, so there is no arithmetic
// in three places to fall out of step — the same reason the stylesheet owns the
// rest of this geometry and the drawing code does not touch it.

const SPLIT_STORE = 'audiolab.laneSplit';
const SPLIT_DEFAULT = 64;
/// Far enough from either end that neither canvas can be dragged to nothing.
/// A pane you can lose by accident and cannot get back is worse than one that
/// stops short.
const SPLIT_MIN = 25;
const SPLIT_MAX = 88;

function laneSplit() {
  const v = Number(localStorage.getItem(SPLIT_STORE));
  return Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT;
}

function setLaneSplit(pct, { save = true } = {}) {
  const v = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct));
  const lane = $('lane');
  if (lane) lane.style.setProperty('--split', `${v.toFixed(2)}%`);
  if (save) {
    // Kept in the browser like the theme: how tall you like the spectrogram is
    // a property of the screen you are looking at, not of the library.
    try { localStorage.setItem(SPLIT_STORE, String(v)); } catch { /* private mode */ }
  }
  // The canvases are stretched by CSS rather than redrawn, so nothing has to be
  // re-rendered — but the waveform's buffer is positioned in pixels.
  layoutWaveBuffer();
  // Unless it has been placed by hand, the grain centre is the waveform's
  // centre — so it moves when the waveform's share of the lane does.
  placeGrainCentre(grainCentre());
  drawGrainLayer();
}

function wireLaneSplit() {
  const handle = $('laneSplit');
  const lane = $('lane');
  if (!handle || !lane) return;
  setLaneSplit(laneSplit(), { save: false });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing-lane');

    const move = (ev) => {
      const r = lane.getBoundingClientRect();
      if (r.height <= 0) return;
      setLaneSplit(((ev.clientY - r.top) / r.height) * 100, { save: false });
    };
    const up = (ev) => {
      handle.releasePointerCapture(e.pointerId);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-lane');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const r = lane.getBoundingClientRect();
      if (r.height > 0) setLaneSplit(((ev.clientY - r.top) / r.height) * 100);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  // Same gesture as every other control here: double-click is "put it back".
  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    setLaneSplit(SPLIT_DEFAULT);
  });
}

wireLaneSplit();

// ------------------------------------------------- the left panel's width
//
// The library list is the one panel whose right width depends on what is in it
// — long file names, deep folders — so it is the one worth being able to drag.

const LEFT_W_STORE = 'audiolab.leftPanelWidth';
const LEFT_W_DEFAULT = 330;
/// Narrow enough to be a sliver, not so narrow the filter box collapses; wide
/// enough to read a long path, not so wide the editor has nowhere to go.
const LEFT_W_MIN = 200;
const LEFT_W_MAX = 720;

function leftPanelWidth() {
  const v = Number(localStorage.getItem(LEFT_W_STORE));
  return Number.isFinite(v) && v >= LEFT_W_MIN && v <= LEFT_W_MAX ? v : LEFT_W_DEFAULT;
}

function setLeftPanelWidth(px, { save = true, redraw = true } = {}) {
  const v = Math.round(Math.min(LEFT_W_MAX, Math.max(LEFT_W_MIN, px)));
  const panel = $('leftPanel');
  if (panel) panel.style.setProperty('--left-w', `${v}px`);
  if (save) {
    // Kept in the browser like the lane split and the theme: how wide you like
    // a panel is a property of the screen, not of the library.
    try { localStorage.setItem(LEFT_W_STORE, String(v)); } catch { /* private mode */ }
  }
  // The lane's canvases are sized in pixels off their own width, so the
  // waveform has to be re-placed after the space either side of it changes.
  //
  // Not on the first application. `redrawLane` reads `resizeTimer`, which is a
  // `let` declared further down this file — calling it from top-level setup is
  // inside its temporal dead zone and throws `Cannot access 'resizeTimer'
  // before initialization`. That exception aborted the rest of `wireLeftPanelResize`
  // *after* the width was applied and *before* the listeners were attached, so
  // the grip appeared, took a cursor, and did nothing at all.
  if (redraw) redrawLane();
}

function wireLeftPanelResize() {
  const grip = $('leftGrip');
  const panel = $('leftPanel');
  if (!grip || !panel) return;
  setLeftPanelWidth(leftPanelWidth(), { save: false, redraw: false });

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    document.body.classList.add('resizing-panel');

    // From the panel's own left edge, so the width follows the pointer exactly
    // rather than drifting by wherever inside the grip the drag started.
    const left = panel.getBoundingClientRect().left;
    const move = (ev) => setLeftPanelWidth(ev.clientX - left, { save: false });
    const up = (ev) => {
      grip.releasePointerCapture(e.pointerId);
      grip.classList.remove('dragging');
      document.body.classList.remove('resizing-panel');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setLeftPanelWidth(ev.clientX - left);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  // Same gesture as every other control here: double-click is "put it back".
  grip.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setLeftPanelWidth(LEFT_W_DEFAULT);
  });
}

/// The grain centre grip: same gesture as the lane split, including
/// double-click to put it back.
function wireGrainCentre() {
  const grip = $('grainCentre');
  const lane = $('lane');
  if (!grip || !lane) return;
  placeGrainCentre(grainCentre());

  // The lane starts a selection on `mousedown`, which is a separate event from
  // `pointerdown` — stopping one does not stop the other, and without this a
  // drag on the grip also swept a selection across the file underneath it.
  for (const ev of ['mousedown', 'click', 'dblclick']) {
    grip.addEventListener(ev, (e) => e.stopPropagation());
  }

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');

    const frac = (ev) => {
      const r = lane.getBoundingClientRect();
      return r.height > 0 ? (ev.clientY - r.top) / r.height : null;
    };
    const move = (ev) => {
      const f = frac(ev);
      if (f !== null) setGrainCentre(f, { save: false });
    };
    const up = (ev) => {
      grip.releasePointerCapture(e.pointerId);
      grip.classList.remove('dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      const f = frac(ev);
      setGrainCentre(f === null ? grainCentre() : f);
      setGrainCentre.live = undefined;
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  grip.addEventListener('dblclick', (e) => {
    e.preventDefault();
    try { localStorage.removeItem(GRAIN_CENTRE_STORE); } catch { /* private mode */ }
    setGrainCentre.live = undefined;
    placeGrainCentre(grainCentreDefault());
    drawGrainLayer();
  });
}
wireGrainCentre();

/// covered, which may be wider and may be a window behind — the peaks and the
/// spectrogram are separate requests and need not agree. So each is sized and
/// offset from its own range, and the lane, which already clips, hides the
/// rest. Nothing else on the lane needs any part of this.
function layoutWaveBuffer() {
  const span = state.view.to - state.view.from;
  const laneW = $('lane').clientWidth || 0;
  placeCanvas($('waveCanvas'), state.peaks, span, laneW);
  placeCanvas($('specCanvas'), state.spec, span, laneW);
}

function placeCanvas(canvas, data, span, laneW) {
  if (!canvas) return;
  // Nothing to offset: hand the geometry back to the stylesheet rather than
  // pinning a pixel width that a resize would then have to catch up with.
  if (!data || !laneW || span <= 0 || !(data.to > data.from)
      || (data.from === state.view.from && data.to === state.view.to)) {
    canvas.style.width = '';
    canvas.style.transform = '';
    return;
  }
  const px = laneW / span;
  canvas.style.width = `${((data.to - data.from) * px).toFixed(2)}px`;
  canvas.style.transform = `translateX(${((data.from - state.view.from) * px).toFixed(2)}px)`;
}

/// Move the window so the playhead stays on screen. Called every frame while
/// playing; most of those frames it does nothing.
function followPlayhead() {
  if (!following()) return;
  const { from, to, frames } = state.view;
  const span = to - from;
  const f = sourceFrameNow();
  if (!isFinite(f)) return;

  let a;
  if (state.follow.mode === 'page') {
    if (f >= from && f < to) return;
    // Start the new page a little before the playhead, so the moment it is on
    // is not pressed against the very edge of the lane.
    a = f - span * 0.06;
  } else {
    a = f - span / 2;
  }
  a = Math.max(0, Math.min(frames - span, Math.round(a)));

  if (a !== from) {
    state.view.from = a;
    state.view.to = a + span;
    layoutWaveBuffer();
    drawSelection();
    drawCue();
    drawOverviewWindow();
    // Rebuilding the ruler and the region strip every frame is only worth it if
    // there is something in them.
    if (state.annotations.markers.length || state.annotations.regions.length) drawMarkers();
  }

  // Checked even when the window did not move, because it may not have been
  // widened yet: pressing play with the lane already where the playhead is
  // leaves nothing to scroll and a buffer that is only as wide as the lane.
  const p = state.peaks;
  const sh = followShape();
  const needFrom = Math.max(0, a - span * sh.behind * FOLLOW_MARGIN);
  const needTo = Math.min(frames, a + span + span * sh.ahead * FOLLOW_MARGIN);
  if (!p || p.from > needFrom || p.to < needTo) refetchWindow();
}

let refetchTimer = null;
function refetchWindow() {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => {
    refetchTimer = null;
    loadPeaks();
    if (state.showSpec) loadSpectrogram();
  }, 60);
}

function setFollow(change) {
  Object.assign(state.follow, change);
  reflectFollow();
  if (state.follow.on) {
    followPlayhead();
  } else {
    // Drop the widened buffer, so the strip goes back to being exactly the lane.
    loadPeaks();
    if (state.showSpec) loadSpectrogram();
  }
}

function reflectFollow() {
  $('followBtn')?.classList.toggle('on', state.follow.on);
  const sel = $('followMode');
  if (sel) { sel.value = state.follow.mode; sel.disabled = !state.follow.on; }
}

$('followBtn').onclick = () => setFollow({ on: !state.follow.on });
$('followMode').onchange = (e) => setFollow({ mode: e.target.value });
reflectFollow();

async function loadPeaks() {
  const f = state.selectedFile;
  if (!f) return;
  const seq = ++peakSeq;
  const lanePx = lanePixels();
  // While following, the window is wider than the lane. Scale the columns with
  // it so the extra picture comes at the same detail rather than a coarser one.
  const win = peakWindow();
  const span = state.view.to - state.view.from;
  const cols = win && span > 0
    ? Math.max(200, Math.min(PEAK_COLUMN_CAP, Math.round(lanePx * ((win.to - win.from) / span))))
    : lanePx;
  // Whether what we are about to fetch covers more than the lane shows. Read
  // now, because in scroll mode the visible window moves during the await.
  const padded = !!win && (win.from !== state.view.from || win.to !== state.view.to);

  // Deliberately NOT the edited stream. The overview is the original file, so
  // it stays put while you work; the grain swarm shows what is being pulled
  // from it, and the playhead shows where in the source you are.
  let url = `/api/peaks?p=${encodeURIComponent(f.path)}&cols=${cols}`;
  if (win) {
    url += `&from=${Math.floor(win.from)}&to=${Math.ceil(win.to)}`;
  }

  let peaks;
  try { peaks = await api(url); }
  catch (e) {
    if (seq === peakSeq) { state.peaks = null; toast(e.message); }
    return;
  }
  // Three quick zoom clicks launch three fetches; without this check the
  // slowest response wins and the view snaps back to an earlier zoom.
  if (seq !== peakSeq) return;

  state.peaks = peaks;
  state.view.frames = peaks.frames;
  state.view.sampleRate = peaks.sampleRate;
  // An unpadded response *is* the visible window, clamping and all, so take it.
  // A padded one covers more than the lane shows, and the visible window stays
  // where following put it.
  if (!padded) { state.view.from = peaks.from; state.view.to = peaks.to; }
  layoutWaveBuffer();
  updateZoomLabel();
  drawWave();
  drawMarkers();
  drawSelection();
  drawCue();
  drawOverviewWindow();
}

function updateZoomLabel() {
  const { from, to, frames } = state.view;
  const span = to - from;
  const el = $('zoomLabel');
  if (!frames || span >= frames) { el.textContent = 'fit'; return; }
  // Say so when every column is one sample, because that is the point at which
  // the picture stops being a summary and starts being the data.
  const cols = Math.round(($('lane').clientWidth || 800) * (window.devicePixelRatio || 1));
  el.textContent = span <= cols
    ? `${span} smp`
    : `${(frames / span).toFixed(1)}×`;
}

/// One sample per column: stems from the zero line, a dot on each sample, and
/// a line joining them.
///
/// `x` is `(i / span) * w` — the same mapping the playhead uses — so a sample
/// and the playhead sitting on that sample land on the same pixel. The dot is
/// the truth here; the joining line is only there to make the shape readable
/// and is deliberately faint, because nothing was measured between two samples.
function drawSamples(ctx, values, span, w, mid, half, accent) {
  const n = Math.min(values.length, span);
  const xAt = (i) => (i / span) * w;
  const yAt = (i) => mid - values[i] * half;
  const gap = w / span;

  // Stems read as a sample view rather than a line chart, but they turn into a
  // solid block once the samples are closer together than a few pixels.
  if (gap >= 4) {
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xAt(i);
      ctx.moveTo(x, mid);
      ctx.lineTo(x, yAt(i));
    }
    ctx.stroke();
  }

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xAt(i);
    const y = yAt(i);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  const r = Math.min(3, Math.max(1, gap / 3));
  if (gap >= 3) {
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(i), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWave() {
  const canvas = $('waveCanvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  // A draw can land while the lane has no box yet — switching modes resizes it,
  // and a tab that is not being painted reports zero for everything. Bail here
  // and let the ResizeObserver below redraw once it genuinely has a size;
  // polling on a timer would spin forever against a hidden tab.
  if (!w || !h) return;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const p = state.peaks;
  $('laneEmpty').classList.toggle('hidden', !!p);
  if (!p || !p.channels.length) return;

  const nch = p.channels.length;
  const laneH = h / nch;
  const accent = waveInk();

  // Zoomed in far enough that the server ran out of frames to summarise: it
  // clamps the column count to the frame count, so every column now holds
  // exactly one sample and min === max. An envelope of a single sample is a
  // zero-height rectangle that says nothing, so switch to drawing the samples
  // themselves — stem, dot and the line between them.
  // The canvas covers the range the *peaks* describe, which while following is
  // wider than the lane, so the span in play here is theirs and not the view's.
  const span = p.to - p.from;
  const sampleMode = span > 0 && p.columns >= span;

  for (let ch = 0; ch < nch; ch++) {
    const { min, max, rms } = p.channels[ch];
    const top = ch * laneH;
    const mid = top + laneH / 2;
    const half = (laneH / 2) * 0.92;
    const colW = w / p.columns;

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

    if (sampleMode) {
      drawSamples(ctx, max, span, w, mid, half, accent);
    } else {
      // Min/max envelope, then the RMS body inside it — the reason the server
      // sends three numbers per column rather than one.
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.34;
      for (let i = 0; i < p.columns; i++) {
        const y1 = mid - max[i] * half;
        const y2 = mid - min[i] * half;
        ctx.fillRect(i * colW, y1, Math.max(colW - 0.3, 0.6), Math.max(y2 - y1, 1));
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < p.columns; i++) {
        const r = rms[i] * half;
        ctx.fillRect(i * colW, mid - r, Math.max(colW - 0.3, 0.6), Math.max(r * 2, 1));
      }
    }

    if (ch > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(w, top); ctx.stroke();
    }
  }
}

// --------------------------------------------------------------------- zoom

function zoom(factor) {
  const { from, to, frames } = state.view;
  if (!frames) return;
  const centre = (from + to) / 2;
  let span = (to - from) / factor;
  // Eight samples across the lane is the floor. Below that there is nothing
  // left to look at, and the peak endpoint would be summarising fewer frames
  // than it has columns to put them in.
  span = Math.max(8, Math.min(span, frames));
  const b = Math.min(frames, Math.round(centre + span / 2));
  const a = Math.max(0, b - Math.round(span));
  state.view.from = a;
  state.view.to = b;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
}
$('zoomIn').onclick = () => zoom(2);
$('zoomOut').onclick = () => zoom(0.5);
$('zoomFit').onclick = () => {
  state.view.from = 0; state.view.to = 0;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
};

// ------------------------------------------------------------- overview
//
// The whole file, drawn once, with the zoomed window marked on top. Zooming
// into a long sample otherwise leaves no way to tell where you are or to move
// somewhere else without zooming back out.

state.overview = null;

async function loadOverview() {
  const f = state.selectedFile;
  if (!f) { state.overview = null; drawOverview(); return; }
  try {
    // Deliberately coarse and deliberately the whole file: this is a map, not
    // a working view, and it must never change as you zoom.
    state.overview = await api(
      `/api/peaks?p=${encodeURIComponent(f.path)}&cols=1400`);
  } catch { state.overview = null; }
  drawOverview();
}

function drawOverview() {
  const canvas = $('overviewCanvas');
  if (!canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const p = state.overview;
  if (!p || !p.channels.length) return;

  const accent = waveInk();
  const mid = h / 2;
  const half = mid * 0.9;
  const colW = w / p.columns;
  const { min, max } = p.channels[0];

  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < p.columns; i++) {
    const y1 = mid - max[i] * half;
    const y2 = mid - min[i] * half;
    ctx.fillRect(i * colW, y1, Math.max(colW, 0.7), Math.max(y2 - y1, 1));
  }
  ctx.globalAlpha = 1;

  drawOverviewWindow();
  updateOverviewPlayhead();
  updateOverviewCue();
}

function drawOverviewWindow() {
  const el = $('ovWindow');
  const p = state.overview;
  if (!el || !p) return;
  const total = state.view.frames || p.frames || 0;
  const { from, to } = state.view;
  const zoomed = total > 0 && to > from && (to - from) < total * 0.999;
  el.classList.toggle('full', !zoomed);
  if (!zoomed) return;
  const wpx = $('overview').clientWidth || 1;
  el.style.left = `${(from / total) * wpx}px`;
  el.style.width = `${Math.max(2, ((to - from) / total) * wpx)}px`;
}

/// Drag the overview to move the zoomed window.
(function wireOverview() {
  const ov = $('overview');
  if (!ov) return;
  let panning = false;

  const centreOn = (e) => {
    const p = state.overview;
    if (!p) return;
    const total = state.view.frames || p.frames || 0;
    const span = state.view.to - state.view.from;
    if (!total || span <= 0 || span >= total) return;
    const r = ov.getBoundingClientRect();
    if (!r.width) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const centre = frac * total;
    let a = Math.max(0, Math.round(centre - span / 2));
    const b = Math.min(total, a + span);
    a = Math.max(0, b - span);
    state.view.from = a;
    state.view.to = b;
    drawOverviewWindow();
    loadPeaks();
    if (state.showSpec) loadSpectrogram();
  };

  ov.addEventListener('mousedown', (e) => { panning = true; centreOn(e); });
  window.addEventListener('mousemove', (e) => { if (panning) centreOn(e); });
  window.addEventListener('mouseup', () => { panning = false; });
})();

let resizeTimer;
function redrawLane() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // The canvases are sized in pixels off the lane's width while following, so
    // they have to be re-placed before anything is drawn into them.
    layoutWaveBuffer();
    drawWave();
    if (state.showSpec) drawSpectrogram();
    drawSelection();
    drawMarkers();
    drawCue();
    drawOverview();
    // The grain layer is part of this lane and was not in this list, so a
    // resize left its marks at the pixel positions of the *old* width while
    // everything under them moved.
    drawGrainLayer();
  }, 60);
}
window.addEventListener('resize', redrawLane);

// Fires when the lane first gains a size, which a draw scheduled on a timer
// can easily miss.
if (window.ResizeObserver) {
  new ResizeObserver(redrawLane).observe($('lane'));
}

// ---------------------------------------------------------------- selection

const framesToX = (frame) => {
  const { from, to } = state.view;
  return to > from ? (frame - from) / (to - from) : 0;
};
const xToFrames = (frac) => {
  const { from, to } = state.view;
  return Math.round(from + frac * (to - from));
};

(function wireSelection() {
  const lane = $('lane');
  let dragging = false;
  let anchor = 0;

  const posFrom = (e) => {
    const r = lane.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  // One gesture does both: pressing moves the playhead, dragging from there
  // selects — and the playhead follows the drag, so you hear where you are.
  const seekToSource = (frac) => {
    if (!state.selectedFile) return;
    const frame = xToFrames(frac);
    if (engine.path !== state.selectedFile.path) { playFile(state.selectedFile); return; }
    seekSource(frame);
  };

  // Click positions the playhead. Dragging from there selects. Holding option
  // scrubs instead, so you can run over the file and hear it without
  // destroying a selection you already made.
  let scrubbing = false;

  lane.addEventListener('mousedown', (e) => {
    if (!state.peaks) return;
    dragging = true;
    scrubbing = e.altKey;
    anchor = xToFrames(posFrom(e));
    if (scrubbing) { seekToSource(posFrom(e)); return; }
    state.sel = null;
    drawSelection();
    applyLoop();
    setCue(anchor);
    seekToSource(posFrom(e));
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const frac = posFrom(e);
    if (scrubbing || e.altKey) { seekToSource(frac); return; }
    const now = xToFrames(frac);
    // A drag of a pixel or two is a click, not a selection.
    if (Math.abs(now - anchor) < (state.view.to - state.view.from) / 500) return;
    state.sel = { start: Math.min(anchor, now), end: Math.max(anchor, now) };
    setCue(state.sel.start);
    drawSelection();
    applyLoop();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    if (scrubbing) { scrubbing = false; return; }
    updateSelLabel();
    applyLoop();
    // Looping a fresh selection should start from its beginning rather than
    // wherever the drag happened to end.
    if (state.loopOn && state.sel) seekSource(state.sel.start);
  });
})();

function drawSelection() {
  const el = $('selection');
  if (!state.sel) { el.classList.add('hidden'); updateSelLabel(); return; }
  const a = framesToX(state.sel.start);
  const b = framesToX(state.sel.end);
  el.classList.remove('hidden');
  el.style.left = (a * 100) + '%';
  el.style.width = ((b - a) * 100) + '%';
  updateSelLabel();
}

function updateSelLabel() {
  const sr = state.view.sampleRate || 1;
  const el = $('selLabel');
  if (!el) return;
  el.textContent = state.sel
    ? `${fmtTime(state.sel.start / sr)} → ${fmtTime(state.sel.end / sr)} (${((state.sel.end - state.sel.start) / sr).toFixed(3)}s)`
    : 'click · drag · ⌥scrub';
}

// ================================================================ metastrip

function renderMetaStrip(f) {
  // Provenance: measured from the file's own header, versus inferred by the
  // classifier from its name. An inferred value is never shown as if it were read.
  const items = [
    ['format', f.format, 'measured'],
    ['rate', f.sampleRate ? f.sampleRate + ' Hz' : '—', 'measured'],
    ['depth', f.bits ? f.bits + '-bit' : '—', 'measured'],
    ['ch', f.channels || '—', 'measured'],
    ['duration', fmtDur(f.duration), f.format === 'RAW-PCM' ? 'guessed' : 'measured'],
    ['category', f.category, f.confidence === 'high' ? 'inferred' : 'guessed'],
  ];
  if (f.machine) items.push(['machine', f.machine, 'inferred']);
  if (f.instrument) items.push(['instrument', f.instrument, 'inferred']);
  if (f.bpm) items.push(['bpm', f.bpm, 'inferred']);

  const strip = $('metaStrip');
  strip.innerHTML = '';
  for (const [k, v, prov] of items) {
    const el = document.createElement('div');
    el.className = 'meta-item';
    el.innerHTML = `<div class="prov ${prov}"></div><span class="k"></span><span class="v"></span>`;
    el.querySelector('.k').textContent = k;
    el.querySelector('.v').textContent = v;
    el.title = {
      measured: 'read from the file header',
      inferred: 'inferred from the filename',
      guessed: 'assumed — treat as a suggestion',
    }[prov];
    strip.appendChild(el);
  }

  // The selection sits with the rest of the file's facts rather than off in the
  // toolbar: it is a measurement of this sound, and it belongs next to the
  // others. Appended last, so it reads as "…category sample, and you have this
  // much of it selected".
  const sel = document.createElement('div');
  sel.className = 'meta-item sel';
  sel.innerHTML = `<div class="prov measured"></div><span class="k">selection</span><span class="v" id="selLabel"></span>`;
  sel.title = 'the range currently selected';
  strip.appendChild(sel);
  updateSelLabel();
}

// ======================================================= overview: the stats

async function loadStats() {
  const f = state.selectedFile;
  if (!f) return;
  let s;
  try { s = await api(`/api/stats?p=${encodeURIComponent(f.path)}`); }
  catch { return; }
  state.stats = s;
  renderStats(f, s);
  renderMeters(s);
}

function renderStats(f, s) {
  const cards = [
    [fmtDur(f.duration), 'duration'],
    [fmtDb(s.peakDbfs), 'peak'],
    [fmtDb(s.rmsDbfs), 'rms'],
    [(s.sampleRate / 1000).toFixed(1) + ' kHz', 'sample rate'],
    [s.bits + '-bit', 'bit depth'],
    [s.channels === 1 ? 'mono' : s.channels === 2 ? 'stereo' : s.channels + ' ch', 'channels'],
    [fmtBytes(f.bytes), 'size'],
    [s.frames.toLocaleString(), 'frames'],
  ];
  if (s.correlation !== null && s.correlation !== undefined) {
    cards.push([s.correlation.toFixed(3), 'correlation']);
  }
  if (s.dualMono) cards.push(['yes', 'dual mono']);
  if (s.clipped > 0) cards.push([s.clipped.toLocaleString(), 'clipped']);

  const grid = $('statsGrid');
  grid.innerHTML = '';
  const card = (v, l, wide) => {
    const el = document.createElement('div');
    el.className = 'stat-card' + (wide ? ' wide' : '');
    el.innerHTML = `<div class="v"></div><div class="l"></div>`;
    el.querySelector('.v').textContent = v;
    el.querySelector('.l').textContent = l;
    grid.appendChild(el);
  };
  for (const [v, l] of cards) card(v, l, false);
  card(f.format, 'format', true);
  card(f.category, 'category', true);

  // Say why it was classified that way, rather than presenting it as fact.
  $('whyBox').innerHTML = f.why
    ? `<b>Why “${f.category}”:</b> ${f.why}. Confidence is <b>${f.confidence}</b>.`
    : `<b>${f.category}</b> — no reason recorded.`;
}

function renderMeters(s) {
  // dBFS mapped onto a 60 dB window, which is where useful detail lives.
  const pct = (db) =>
    (db === null || !isFinite(db) ? 0 : Math.max(0, Math.min(100, (db + 60) / 60 * 100)));
  $('meters').innerHTML = '';
  for (const [k, v] of [['Peak', s.peakDbfs], ['RMS', s.rmsDbfs]]) {
    const el = document.createElement('div');
    el.className = 'meter-row';
    el.innerHTML = `<span class="k">${k}</span>
      <div class="bar"><div class="fill" style="width:${pct(v)}%"></div></div>
      <span class="v">${fmtDb(v)}</span>`;
    $('meters').appendChild(el);
  }

  const c = s.correlation;
  $('stereo').innerHTML = (c === null || c === undefined)
    ? `<div class="stat-row"><span class="k">Mono</span><span class="v">single channel</span></div>`
    : `<div class="stat-row"><span class="k">Correlation</span><span class="v">${c.toFixed(3)}</span></div>
       <div class="stat-row"><span class="k">Dual mono</span><span class="v">${s.dualMono ? 'yes' : 'no'}</span></div>`;
  if (s.clipped > 0) {
    $('stereo').innerHTML +=
      `<div class="stat-row"><span class="k">Clipped</span><span class="v">${s.clipped} samples</span></div>`;
  }
}

// =================================================================== editing

/// Apply a document operation.
///
/// `live` is for continuous controls: it refreshes the document and the
/// waveform but does not refit the zoom or restart playback, so dragging a
/// slider does not stutter the audio or throw away where you were looking.
/// Operations that change what the source timeline contains, as opposed to
/// how it is played back. Only these invalidate a selection or the overview.
const STRUCTURAL = ['cut', 'crop', 'duplicate', 'insertSilence', 'reverse', 'silence',
                    'fadeIn', 'fadeOut', 'gain', 'normalize', 'normalizeRms',
                    'stripSilence', 'repairClick', 'split', 'undo', 'redo', 'revert'];

async function editOp(body, { live = false } = {}) {
  if (!state.selectedFile) return;
  try { state.edit = await postJSON('/api/edit', { p: state.selectedFile.path, ...body }); }
  catch (e) { toast(e.message); return; }

  reflectEditState();
  renderStretch();
  renderGrainParams();
  loadGrains();
  pushGrainParams();
  renderTabs();

  if (live) {
    // Dragging: the numbers are already right, and the picture catches up when
    // the pointer is released.
    setBusy(true);
    return;
  }

  // Only operations that remove or reorder material invalidate a selection.
  // Clearing it on every change also broke selection looping, since the
  // selection is what defines the loop.
  if (STRUCTURAL.includes(body.op)) {
    state.sel = null;
    applyLoop();
  } else if (state.sel) {
    const max = state.edit?.frames ?? 0;
    state.sel = { start: Math.min(state.sel.start, max), end: Math.min(state.sel.end, max) };
    if (state.sel.end - state.sel.start < 2) state.sel = null;
  }
  drawSelection();

  // The overview is of the source and does not change when a value does, so
  // it is left alone — redrawing it was what made the playhead jump about.
  // Structural edits do change the source mapping, so those still refit.
  if (STRUCTURAL.includes(body.op)) {
    state.view.from = 0;
    state.view.to = 0;
    await loadPeaks();
    if (state.showSpec) loadSpectrogram();
  }
  reloadAudioSource();
  setBusy(false);
}

/// Say plainly that the waveform is behind the controls, rather than letting it
/// look wrong.
function setBusy(on) {
  const el = $('stretchOut');
  if (el) el.classList.toggle('pending', on);
}

function reflectEditState() {
  const e = state.edit;
  $('undoBtn').disabled = !e?.canUndo;
  $('redoBtn').disabled = !e?.canRedo;
  // An effect rack with no edits is still worth exporting, so the button is
  // only gated on having a file open.
  $('editedFlag').classList.toggle('hidden', !e?.edited && !state.rack?.active);
  $('exportBtn').disabled = !state.selectedFile;
}

/// Nothing to repoint any more.
///
/// The engine holds the audio. Performance controls reach it as parameters and
/// change the sound where it stands; structural edits are folded into its
/// source by the server. Either way playback is never torn down and rebuilt,
/// which is what the old element required and what made a pitch change look
/// like a bug.
function reloadAudioSource() {
  applyLoop();
}

const NEEDS_SELECTION = ['cut', 'crop', 'silence', 'fadeIn', 'fadeOut', 'reverse', 'region'];

document.querySelectorAll('#editTools [data-op]').forEach((b) => {
  b.onclick = () => {
    const op = b.dataset.op;
    if (NEEDS_SELECTION.includes(op) && !state.sel) { toast('Select a range first'); return; }
    if (op === 'marker') return addMarker();
    if (op === 'region') return addRegion();

    const body = { op, start: state.sel.start, end: state.sel.end };
    if (op === 'fadeIn' || op === 'fadeOut') {
      body.frames = state.sel.end - state.sel.start;
      body.shape = state.fadeShape;
    }
    // Through `editCmd` rather than `editOp`, so the snap setting reaches the
    // toolbar buttons and not only the menu items. One command, one path.
    editCmd(body);
  };
});

$('fadeShape').onchange = (e) => { state.fadeShape = e.target.value; };
$('exportBits').onchange = (e) => { state.exportBits = +e.target.value; };

$('undoBtn').onclick = async () => { await editOp({ op: 'undo' }); syncStretchSliders(); };
$('redoBtn').onclick = async () => { await editOp({ op: 'redo' }); syncStretchSliders(); };
$('revertBtn').onclick = async () => { await editOp({ op: 'revert' }); syncStretchSliders(); };

/// Export lands beside the original, as an AIFF named for what was done to it.
///
/// The path is long and mostly the library, so the toast says the name — which
/// is the part that changed and the part you will look for.
/// What the transport is looping, in **source** frames, or `null`.
///
/// The same rule the transport uses: the selection if there is one, the whole
/// document if there is not — see `applyLoop`. Source frames rather than the
/// engine frames `applyLoop` sends, because the export is at the document's own
/// sample rate and the server maps them through the stretch itself.
function exportLoopRange() {
  if (!state.loopOn) return null;
  const sel = state.sel;
  if (sel && sel.end > sel.start) return { from: sel.start, to: sel.end };
  const frames = state.edit?.baseFrames || state.view?.frames || 0;
  return frames > 0 ? { from: 0, to: frames } : null;
}

/// Start it, then watch. `range` null is the whole-file export.
///
/// The request returns as soon as the render has a thread of its own, so what
/// comes back says only that it started — the outcome arrives through
/// `/api/export`, which is also where the progress comes from. A four-minute
/// file takes twenty-five seconds and the old call simply blocked for all of
/// it with nothing on screen.
async function runExport(range, repeats, tail) {
  if (!state.selectedFile) return;
  const body = { p: state.selectedFile.path, bits: state.exportBits };
  if (range) {
    body.from = Math.round(range.from);
    body.to = Math.round(range.to);
    body.repeats = repeats;
    body.tail = !!tail;
  }
  try {
    await postJSON('/api/export', body);
  } catch (e) {
    toast('Export failed: ' + e.message);
    return;
  }
  showExportProgress(true);
  pollExport();
}

// ----------------------------------------------------------- the export bar

/// What the server calls each phase, in words.
///
/// Named here rather than sent as prose so the server keeps saying one word and
/// the interface decides how to put it — the same split the rest of the app
/// uses for its labels.
const EXPORT_PHASES = {
  starting: 'Starting',
  reading: 'Reading',
  stretching: 'Stretching',
  effects: 'Effects',
  tail: 'Tail',
  writing: 'Writing',
  stopping: 'Stopping',
  done: 'Done',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

function showExportProgress(on) {
  $('exportProgress').classList.toggle('hidden', !on);
  $('exportBtn').disabled = on || !state.selectedFile;
  if (on) {
    $('epFill').style.width = '0%';
    $('epPct').textContent = '0%';
    $('epPhase').textContent = 'Starting';
  }
}

let exportSerial = null;

async function pollExport() {
  let s;
  try { s = await api('/api/export'); } catch { showExportProgress(false); return; }

  const pct = Math.round((s.fraction || 0) * 100);
  $('epFill').style.width = pct + '%';
  $('epPct').textContent = pct + '%';
  $('epPhase').textContent = EXPORT_PHASES[s.phase] || s.phase || 'Exporting';

  if (s.running) { setTimeout(pollExport, 250); return; }

  showExportProgress(false);
  // `serial` is bumped once per finished run, so a poll landing after a result
  // has already been reported does not report it twice.
  if (s.serial === exportSerial) return;
  exportSerial = s.serial;

  if (s.error) { toast('Export failed: ' + s.error); return; }
  if (s.cancelled || s.phase === 'cancelled') { toast('Export stopped — nothing written'); return; }
  if (s.path) {
    const name = s.path.split('/').pop();
    const secs = state.view?.sampleRate ? (s.frames / state.view.sampleRate) : 0;
    toast(`Exported ${secs.toFixed(2)}s, ${state.exportBits}-bit AIFF beside the original — ${name}`);
  }
}

$('epStop').onclick = () => {
  $('epStop').disabled = true;
  api('/api/export/stop', { method: 'POST' })
    .catch(() => {})
    .finally(() => { $('epStop').disabled = false; });
};

// An export left running when the page was reloaded is still running, and the
// bar is the only way to find out. Picked up rather than lost.
(async () => {
  try {
    const s = await api('/api/export');
    exportSerial = s.serial;
    if (s.running) { showExportProgress(true); pollExport(); }
  } catch { /* server not up yet; the next export starts its own poll */ }
})();

// ------------------------------------------------------------- the loop box

let exportRange = null;

function exportSeconds(range, repeats) {
  const sr = state.view?.sampleRate || 48000;
  const ratio = state.edit?.stretch?.ratio ?? 1;
  return ((range.to - range.from) / sr) * ratio * repeats;
}

function paintExportLoop() {
  if (!exportRange) return;
  const repeats = Math.max(1, Math.min(512, +$('elRepeats').value || 1));
  const sr = state.view?.sampleRate || 48000;
  const ratio = state.edit?.stretch?.ratio ?? 1;
  const one = ((exportRange.to - exportRange.from) / sr) * ratio;
  $('elRange').textContent = `${one.toFixed(2)}s loop`;
  $('elLength').textContent =
    `${exportSeconds(exportRange, repeats).toFixed(2)}s of audio${
      $('elTail').classList.contains('on') ? ', plus the tail' : ''}`;
}

function openExportLoop(range) {
  exportRange = range;
  buildVideoPickers();
  paintVideoScope();
  $('exportLoop').classList.remove('hidden');
  paintExportLoop();
  $('elRepeats').focus();
  $('elRepeats').select();
}

function closeExportLoop() {
  $('exportLoop').classList.add('hidden');
  exportRange = null;
}

$('exportBtn').onclick = () => {
  if (!state.selectedFile) return;
  // Loop off is the export that was always here — no box, no questions.
  const range = exportLoopRange();
  if (!range) { runExport(null); return; }
  openExportLoop(range);
};

/// The video's own way in.
///
/// `exportBtn` only opens this box when the loop is on — with it off, the audio
/// export is the one that was always here, no box and no questions, and that is
/// worth keeping. But it left the video unreachable in exactly the case where
/// somebody has no loop set and wants to film the whole thing. So the video has
/// a button of its own, and it always opens the box.
$('videoBtn').onclick = () => {
  if (!state.selectedFile) return;
  const why = videoExportSupport();
  if (why) { toast(why); return; }
  openExportLoop(exportLoopRange());
};

$('elClose').onclick = closeExportLoop;
$('elRepeats').oninput = paintExportLoop;
$('elRepeats').onkeydown = (e) => {
  // Tier 1 owns the key while a field has focus, so Enter has to be handled
  // here or it does nothing at all.
  if (e.key === 'Enter') { e.preventDefault(); $('elGo').click(); }
};
$('elTail').onclick = () => {
  $('elTail').classList.toggle('on');
  paintExportLoop();
};
$('elWhole').onclick = () => { closeExportLoop(); runExport(null); };

// ── the video ───────────────────────────────────────────────────────────────
//
// The same box, with a second destination on it. Everything the video needs
// about *what* to render — the loop, the repeats, the tail — is already on this
// dialog and already means the same thing; only the size and the rate are new.
// See `docs/VIDEO-EXPORT.md`.

/// What the video is filming: the selection, or the whole file.
///
/// Its own choice rather than being read off the loop, because the two are
/// different questions. The loop decides what the *audio* export renders; a
/// video of the whole file is a perfectly ordinary thing to want while a loop
/// happens to be set, and a video of the selection is what you want most of the
/// time whether or not the loop is currently on.
let videoScope = 'selection';

function paintVideoScope() {
  const range = exportRange;
  // Nothing selected means there is nothing to choose between.
  if (!range) videoScope = 'whole';
  $('elScopeSel').classList.toggle('on', videoScope === 'selection');
  $('elScopeAll').classList.toggle('on', videoScope === 'whole');
  $('elScopeSel').disabled = !range;
  const note = $('elScopeNote');
  if (!note) return;
  if (!range) {
    note.textContent = 'No selection — the whole file, once.';
  } else if (videoScope === 'selection') {
    const secs = (range.to - range.from) / (state.view?.sampleRate || 44100);
    note.textContent = `${secs.toFixed(2)}s, repeated as set above.`;
  } else {
    note.textContent = 'The whole file, once, ignoring the loop.';
  }
}

$('elScopeSel').onclick = () => {
  if (!exportRange) return;
  videoScope = 'selection';
  paintVideoScope();
};
$('elScopeAll').onclick = () => { videoScope = 'whole'; paintVideoScope(); };

function buildVideoPickers() {
  const size = $('elVideoSize');
  const fps = $('elVideoFps');
  if (!size || size.children.length) return;
  for (const s of VIDEO_SIZES) {
    const o = document.createElement('option');
    o.value = s.key;
    o.textContent = `${s.label} · ${s.w}×${s.h}`;
    size.appendChild(o);
  }
  size.value = localStorage.getItem('videoSize') || 'hd';
  size.onchange = () => { try { localStorage.setItem('videoSize', size.value); } catch {} };
  for (const r of VIDEO_RATES) {
    const o = document.createElement('option');
    o.value = String(r);
    o.textContent = `${r} fps`;
    fps.appendChild(o);
  }
  fps.value = localStorage.getItem('videoFps') || '30';
  fps.onchange = () => { try { localStorage.setItem('videoFps', fps.value); } catch {} };
}

let videoRun = null;

/// A duration, said the way somebody waiting would say it.
function videoWhen(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.round(seconds - m * 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function runVideoExport() {
  if (videoRun) {
    videoRun.abort();
    return;
  }
  const why = videoExportSupport();
  if (why) { toast(why); return; }
  if (!state.selectedFile) return;
  const size = VIDEO_SIZES.find((s) => s.key === $('elVideoSize').value) || VIDEO_SIZES[1];
  const fps = +$('elVideoFps').value || 30;
  // The selection looped, or the whole file once. `repeats: 0` is how the
  // server is told there is no loop plan, which is the same thing the audio
  // export's "Whole file instead" says.
  const filming = videoScope === 'selection' && exportRange ? exportRange : null;
  const repeats = filming
    ? Math.max(1, Math.min(512, +$('elRepeats').value || 1))
    : 0;
  const tail = $('elTail').classList.contains('on');

  const ctrl = new AbortController();
  videoRun = ctrl;
  $('elVideo').textContent = 'Stop';

  // The same bar the audio export uses, rather than a second way of saying the
  // same thing in a different corner.
  $('exportProgress').classList.remove('hidden');
  $('epFill').style.width = '0%';
  $('epPct').textContent = '0%';
  $('epPhase').textContent = 'Filming';

  // **What is left, not just what is done.** A percentage on its own says
  // nothing about whether to wait or go and do something else, and the useful
  // part of filming is that it is a known number of frames at a rate that
  // settles within a second or two. So the count and the time are shown, and
  // the time is measured over the *recent* rate rather than the whole run —
  // the first few frames include compiling shaders and warming an encoder, and
  // an average that never forgets them reads high for minutes.
  const began = performance.now();
  let mark = began;
  let markDone = 0;
  let rate = 0;
  const say = (text, f, done, total) => {
    const pct = Math.max(0, Math.min(100, Math.round((f || 0) * 100)));
    $('epFill').style.width = pct + '%';
    $('epPct').textContent = pct + '%';
    $('epPhase').textContent = text;
    let line = text;
    if (total) {
      const now = performance.now();
      if (now - mark > 400) {
        const inst = (done - markDone) / ((now - mark) / 1000);
        rate = rate ? rate * 0.7 + inst * 0.3 : inst;
        mark = now;
        markDone = done;
      }
      line = `${text} · ${done.toLocaleString()} of ${total.toLocaleString()}`;
      if (rate > 0.01) {
        const left = (total - done) / rate;
        line += ` · ${videoWhen(left)} left · ${rate.toFixed(0)}/s`;
      }
    } else {
      line = `${text} · ${pct}%`;
    }
    $('elStatus').textContent = line;
  };
  try {
    // The loop's range in *output* frames, so a repeat plays the same grains
    // again rather than running off the end of the document.
    //
    // The schedule itself is fetched in windows as the film walks, the same way
    // the live room fetches its swarm — see `videoExport`. One request for the
    // whole document spends the cap across the entire file and leaves any given
    // moment nearly empty.
    const grainsAt = (from, to) => api(
      `/api/grains?p=${encodeURIComponent(state.selectedFile.path)}&from=${from}&to=${to}`,
    ).catch(() => null);
    const ratio = state.edit?.baseFrames
      ? (state.edit.frames || state.view?.frames || state.edit.baseFrames) / state.edit.baseFrames
      : 1;
    const loopOut = filming
      ? { from: Math.round(filming.from * ratio), to: Math.round(filming.to * ratio) }
      : null;
    const blob = await videoExport({
      path: state.selectedFile.path,
      from: filming ? filming.from : 0,
      to: filming ? filming.to : 0,
      repeats,
      tail,
      size,
      fps,
      // The room as it is posed right now, at the frame being filmed. The
      // camera is the pose; the aspect comes from the canvas, which is why a
      // wide room in a tall frame is a narrower room and not a squashed one.
      // The camera posed for **the shape being filmed**, which is not
      // necessarily the shape on screen. See `roomCameraForAspect`.
      camera: roomCameraForAspect(size.w / size.h),
      layers: roomLayers(),
      occlude: roomOcclude(),
      order: roomOrder(),
      room: {
        cold: vgRgb('--wave-2', '#4a9fd8'),
        hot: vgRgb('--wave', '#5fd47a'),
        core: vgRgb('--accent', '#7fd0ff'),
        // The same palette the live room is drawn with. Handed over rather than
        // rebuilt: the film and the room disagreeing about a colour is the
        // fault this program has already shipped once, over the background.
        paint: rpForRenderer(),
        geom: roomGeom(),
        ringDrive: roomEdit.ringDrive,
        ringEdge: roomEdit.ringEdge,
        ringPoints: roomEdit.ringPoints,
        leadThick: roomEdit.leadThick,
        grainDensity: roomEdit.grainDensity,
        grainBright: roomEdit.grainBright,
        grainFill: {
          on: roomEdit.grainFill,
          bg: roomEdit.grainFillBg,
          rgb: vgHexRgb(roomEdit.grainFillColour),
        },
        mist: {
          on: roomEdit.mist,
          amount: roomEdit.mistAmount,
          length: roomEdit.mistLength,
        },
        fog: roomFog(),
      },
      // What the room is drawn *on*. It clears to transparent and the page
      // shows through, so an offscreen canvas has nothing behind it at all.
      // ── the schedule printed on the back wall ──
      //
      // The live block is HTML *behind* the canvas — the room is drawn on glass
      // over it — so filming only the canvas left it out of the file entirely.
      // A layer you can switch on in the view was simply absent from the export.
      //
      // What crosses over is the settings; the lines themselves are built per
      // frame by `roomDataBlock`, the same function the live block uses, from
      // that frame's own schedule.
      data: {
        on: roomLayerOn('data'),
        chunk: roomEdit.chunk,
        opacity: roomEdit.opacity,
        colour: roomDataColour(),
        // No engine offline, so no load and no drop count — those are
        // properties of playback rather than of the sound. See `roomDataHead`.
        head: roomDataHead(false),
        ch: roomChPx($('roomData')),
        line: ROOM_LINE,
        font: getComputedStyle(document.documentElement)
          .getPropertyValue('--mono').trim() || 'monospace',
        fontPx: 7,
        // **How much bigger the film is than the room on screen.**
        //
        // The type does not scale with the *room* — small type printed on a
        // wall does not grow because the wall is big, which is why the live
        // block is a fixed 7px however the panel is sized. But a film is the
        // same composition at a different resolution, and 7px in a 1080-tall
        // frame is half the size it is in a 762-tall panel. Scaling by the
        // frame's height is what makes the film look like the view rather than
        // like the view with the readout shrunk.
        scale: ($('visGl')?.clientHeight || size.h) > 0
          ? size.h / ($('visGl').clientHeight || size.h) : 1,
      },
      // **The ground, from one place.** The live room sits on `--sink` (the
      // room cell's own background) and this used to read `--bg`, which is a
      // different token and a visibly different black — so the file came out on
      // a lighter ground than the thing that had been posed. Both now ask the
      // palette, and the palette falls back to the cell's own colour.
      background: roomGroundColour(),
      fetchSchedule: grainsAt,
      // The same few seconds either side the live room asks for.
      padSeconds: GRAIN_PLAYHEAD_PAD,
      loopOut,
      signal: ctrl.signal,
      onStage: say,
    });
    const name = (state.selectedFile.name || 'room').replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name} — room ${size.w}x${size.h} ${fps}fps.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    $('elStatus').textContent = `saved · ${(blob.size / 1e6).toFixed(1)} MB`;
    toast('video saved');
  } catch (e) {
    if (String(e.message) === 'cancelled') {
      $('elStatus').textContent = 'stopped';
    } else {
      $('elStatus').textContent = `failed — ${e.message}`;
      toast('video export failed: ' + e.message);
    }
  } finally {
    videoRun = null;
    $('elVideo').textContent = 'Export video';
    $('exportProgress').classList.add('hidden');
  }
}

$('elVideo').onclick = () => {
  if (videoRun) { videoRun.abort(); postJSON('/api/video/stop', {}).catch(() => {}); return; }
  runVideoExport();
};
$('elGo').onclick = () => {
  const range = exportRange;
  const repeats = Math.max(1, Math.min(512, +$('elRepeats').value || 1));
  const tail = $('elTail').classList.contains('on');
  closeExportLoop();
  runExport(range, repeats, tail);
};

// -------------------------------------------------------------- effects dock

document.querySelectorAll('.dock-tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.dock-tab').forEach((x) => x.classList.toggle('active', x === t));
    const panes = { effects: 'dockEffects', stretch: 'dockStretch',
                    visuals: 'dockVisuals', automation: 'dockAutomation',
                    regions: 'dockRegions' };
    for (const [k, id] of Object.entries(panes)) $(id).classList.toggle('hidden', k !== t.dataset.dock);
    // Everything in these panels is skipped while its panel is hidden, so a
    // panel being opened is showing whatever was on it when it was last
    // closed. Paint it once here; the polls take it from there.
    if (t.dataset.dock === 'effects') {
      paintRackMeters(engine.rackLevels || []);
      repaintVisualEqs();
      repaintVisualCompressors();
    } else if (t.dataset.dock === 'stretch') {
      drawGrains();
    }
  };
});

// ------------------------------------------------------------- dock height
//
// The panel holds more controls than a fixed height can show, and scrolling a
// wall of sliders means losing sight of the ones you are not touching. So it
// is dragged from its top edge, and remembered.
//
// Set as `flex` rather than a height because the stylesheet sizes it with the
// `flex` shorthand — which writes flex-basis too, so setting basis alone would
// be overruled by it on the next class change.

const DOCK_MIN = 150;
/// Leave enough of the waveform to still be a waveform.
const LANE_MIN = 170;

function dockLimits() {
  const dock = $('dock');
  const top = dock?.parentElement?.getBoundingClientRect().top ?? 0;
  return { min: DOCK_MIN, max: Math.max(DOCK_MIN, window.innerHeight - top - LANE_MIN) };
}

function setDockHeight(px, remember = true) {
  const dock = $('dock');
  if (!dock) return;
  const { min, max } = dockLimits();
  const h = Math.round(Math.max(min, Math.min(max, px)));
  dock.style.flex = `0 0 ${h}px`;
  if (remember) {
    try { localStorage.setItem('dockHeight', String(h)); } catch { /* private mode */ }
  }
  // The canvases in here size themselves from their box, and their observers
  // only fire once the layout has settled.
  requestAnimationFrame(() => {
    drawGrains();
    drawWave();
  });
}

/// Back to whatever the stylesheet says, by dropping the override.
function resetDockHeight() {
  const dock = $('dock');
  if (!dock) return;
  dock.style.flex = '';
  try { localStorage.removeItem('dockHeight'); } catch { /* private mode */ }
  requestAnimationFrame(() => { drawGrains(); drawWave(); });
}

(() => {
  const grip = $('dockResize');
  const dock = $('dock');
  if (!grip || !dock) return;

  const stored = (() => {
    try { return parseInt(localStorage.getItem('dockHeight') || '', 10); }
    catch { return NaN; }
  })();
  if (Number.isFinite(stored)) setDockHeight(stored, false);

  let from = null;
  grip.onpointerdown = (e) => {
    from = { y: e.clientY, h: dock.getBoundingClientRect().height };
    document.body.classList.add('dock-sizing');
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  grip.onpointermove = (e) => {
    if (!from) return;
    // Upward is taller: the panel grows into the space above it.
    setDockHeight(from.h + (from.y - e.clientY));
  };
  const done = (e) => {
    if (!from) return;
    from = null;
    document.body.classList.remove('dock-sizing');
    try { grip.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
  };
  grip.onpointerup = done;
  grip.onpointercancel = done;
  grip.ondblclick = resetDockHeight;

  // A window that has shrunk can leave the dock taller than there is room for.
  window.addEventListener('resize', () => {
    const now = dock.getBoundingClientRect().height;
    const { min, max } = dockLimits();
    if (now > max || now < min) setDockHeight(now);
  });
})();

// ================================================================ effect rack
//
// The rack is server-side: the browser edits a spec, posts it, and every
// subsequent render — waveform, playback, export — goes through it. Nothing is
// applied here, so removing an effect restores the original exactly.

state.rack = null;
state.rackSelected = 0;

const SLOT_META = {
  gain: { icon: 'G', name: 'Gain' },
  eq:   { icon: 'EQ', name: 'Parametric EQ' },
  comp: { icon: 'C', name: 'Compressor' },
};

// What shapers exist and what each one has, straight from the engine.
//
// Not written out here as well. Every shaper module is drawn from this, so an
// effect gains a control by declaring one in `fx::shape` and nothing in the
// interface needs touching — the same reason the rack has one slot kind for
// all of them rather than nine.
state.shapers = {};

async function loadShapers() {
  if (Object.keys(state.shapers).length) return;
  try {
    const r = await api('/api/fx');
    for (const s of r.shapers || []) state.shapers[s.kind] = s;
  } catch { /* the chain still works; only the shapers go missing */ }
  renderFxPicker();
}

function defaultFxSlot(kind) {
  const id = `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  if (kind === 'gain') return { id, kind, bypassed: false, db: 0 };
  if (kind === 'eq') return { id, kind, bypassed: false, bands: defaultEqBands() };
  if (kind === 'comp') return { id, kind, bypassed: false,
    thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 100, kneeDb: 6, makeupDb: 0 };
  const spec = state.shapers[kind];
  if (!spec) return null;
  const params = {};
  for (const p of spec.params) params[p.key] = p.default;
  return { id, kind, bypassed: false, params };
}

/// What a rack control was born with, for double-click reset.
///
/// Read from the same factory that creates a new module rather than from a
/// second table, so a reset can never disagree with what adding one gives you.
/// That is the whole reason `param` refuses to guess: a control that resets to
/// something which was never anybody's default is worse than one that plainly
/// does nothing.
function fxBorn(kind, key) {
  const s = defaultFxSlot(kind);
  return s ? s[key] : undefined;
}

/// The same, for one band of the EQ.
function eqBorn(index, key) {
  return defaultEqBands()[index]?.[key];
}

/// The three-band strip's own defaults, which are a different shape from the
/// band list: `slot.low` / `.mid` / `.high` rather than `slot.bands[i]`.
///
/// Mirrors `fx::eq::EqSettings::default()`. Two tables for one thing is exactly
/// what `fxBorn` avoids elsewhere by reading the factory — there is no factory
/// for this shape on the client, so the comment has to carry the promise
/// instead.
const EQ_STRIP_DEFAULTS = {
  low: { freq: 100, q: 0.7, gainDb: 0 },
  mid: { freq: 1000, q: 1, gainDb: 0 },
  high: { freq: 8000, q: 0.7, gainDb: 0 },
};

/// The same, for a shaper — whose defaults are declared by the server with the
/// rest of its parameter spec, so this is the only place they live.
function shaperBorn(kind, key) {
  return state.shapers?.[kind]?.params?.find((p) => p.key === key)?.default;
}

function addFxModule(kind) {
  if (!kind || !state.rack) return;
  const slot = defaultFxSlot(kind);
  if (!slot) return;
  state.rack.slots.push(slot);
  state.rackSelected = state.rack.slots.length - 1;
  $('fxPicker')?.classList.add('hidden');
  pushRack({ immediate: true });
  renderRack();
}

function renderFxPicker() {
  const box = $('fxPickerGroups');
  if (!box) return;
  box.innerHTML = '';
  const groupFor = (kind) => {
    if (['gain', 'eq', 'comp', 'gate', 'dattorro_notch', 'dattorro_resonator',
      'regalia_mitra', 'chamberlin', 'damping_filter', 'dc'].includes(kind)) return 'EQ & Compression';
    if (['dattorro_plate', 'allpass_diffuser', 'dattorro_echo', 'schroeder_reverb', 'moorer_reverb'].includes(kind)) return 'Reverb & Delay';
    if (['white_chorus', 'dattorro_flanger', 'dattorro_vibrato', 'leslie', 'phaser'].includes(kind)) return 'Chorus & Phasing';
    if (['harmonizer', 'detune', 'doubler', 'doppler', 'boomerang'].includes(kind)) return 'Pitch & Motion';
    if (['pn_noise', 'pn_noise_eq', 'single_bit_pn', 'ring'].includes(kind)) return 'Noise & Generators';
    return 'Utility & Shaping';
  };
  const catalogue = [
    { kind: 'eq', label: 'Parametric EQ' },
    { kind: 'comp', label: 'Compressor' },
    ...Object.values(state.shapers).filter((s) =>
      !['dc', 'gate', 'invert', 'swap', 'width', 'fit', 'dattorro_notch',
        'dattorro_resonator', 'regalia_mitra', 'damping_filter'].includes(s.kind)),
  ];
  const groups = new Map();
  for (const module of catalogue) {
    const category = groupFor(module.kind);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(module);
  }
  for (const [category, shapers] of groups) {
    const group = document.createElement('section');
    group.className = 'fx-picker-group';
    const heading = document.createElement('h3');
    heading.textContent = category;
    group.appendChild(heading);
    for (const shaper of shapers) {
      const button = document.createElement('button');
      button.className = 'fx-picker-item';
      button.textContent = shaper.label;
      button.onclick = () => addFxModule(shaper.kind);
      group.appendChild(button);
    }
    box.appendChild(group);
  }
}

$('fxAdd').onclick = () => $('fxPicker')?.classList.toggle('hidden');
$('fxPickerClose').onclick = () => $('fxPicker')?.classList.add('hidden');

async function loadRack() {
  await loadShapers();
  const f = state.selectedFile;
  if (!f) return;
  try {
    state.rack = await api(
      `/api/rack?p=${encodeURIComponent(f.path)}&sr=${state.view.sampleRate || 48000}`);
  } catch { state.rack = null; }
  renderRack();
}

/// Post the spec, then refresh everything that depends on it.
let rackTimer;

/// Move one control while the hand is still on it.
///
/// **Deliberately not the whole spec.** Posting the rack rebuilds every effect
/// in the chain from nothing — delay lines cleared, filters restarted, reverb
/// tails cut — and doing that thirty times a second while dragging is why the
/// effects did not sound connected to the control. `/api/rack/param` moves the
/// one number, on the effect that is already running.
///
/// Coalesced per control rather than globally: dragging the EQ's frequency must
/// not swallow the Q that moved in the same gesture.
const pendingLive = new Map();
let liveTimer = null;

function liveParam(slotId, key, value) {
  if (!slotId) return;
  pendingLive.set(`${slotId}\u0000${key}`, { id: slotId, key, value });
  if (liveTimer) return;
  liveTimer = setTimeout(async () => {
    liveTimer = null;
    const f = state.selectedFile;
    const batch = [...pendingLive.values()];
    pendingLive.clear();
    if (!f) return;
    for (const w of batch) {
      try {
        await postJSON('/api/rack/param', { p: f.path, id: w.id, key: w.key, value: w.value });
      } catch { /* the release commit reports a persistent failure */ }
    }
  }, 16);
}

/// Kept for the paths that still have no id to write against.
/// What a released control does.
///
/// The engine already has the value — `liveParam` sent it — so this is only
/// about everything *else* that has to agree: the waveform, the peaks, the
/// spectrogram and the saved session. Deliberately does not rebuild the live
/// rack, because there is nothing to rebuild it for and doing so would cut
/// every tail in the chain at the moment you let go of a slider.
async function commitRack() {
  const f = state.selectedFile;
  if (!f || !state.rack) return;
  try {
    // Adopted rather than assigned: a panel is holding these slot objects and
    // is about to be written to again. See `adoptRack`.
    const restructured = adoptRack(await postJSON('/api/rack', {
      p: f.path,
      sr: state.view.sampleRate || 48000,
      slots: state.rack.slots,
      master: state.rack.master,
      // The engine is already where it needs to be; asking for a rebuild here
      // is what used to cut the reverb tail every time a control was released.
      keepLive: true,
    }));
    if (restructured) renderRack();
  } catch (e) { toast(e.message); return; }
  renderTabs();
  refreshAutomationTargets();
  // No peaks, no spectrogram. The waveform is the material now, and the rack
  // does not change the material — it is processing, and processing shows up in
  // the meters and in the speakers. Re-fetching the picture on every control
  // release was the single most expensive thing an effect could do.
}

/// Take the server's canonical rack without breaking what is holding the old one.
///
/// Every module panel captures its `slot` object when it is built — the
/// compressor's sliders write to it, its canvas draws from it. Replacing
/// `state.rack` wholesale with the reply orphaned that reference: from the
/// first commit onward the panel was writing to an object nothing else could
/// see, while anything that repainted read the fresh one. The two then
/// disagreed, and the next commit posted the *fresh* slot's values — undoing
/// the move that had just been made. Which is exactly what "the display and the
/// sliders fight each other, and any move puts them to one value" is.
///
/// The master panel already knew this and worked around it with a getter; the
/// module panels never did. Fixing it here fixes all of them at once, and means
/// a panel may go on holding its slot.
///
/// Structure changing — a module added, removed or reordered — genuinely needs
/// new objects, and the panels are rebuilt for it.
function adoptRack(fresh) {
  const cur = state.rack;
  const sameShape =
    cur &&
    Array.isArray(cur.slots) &&
    Array.isArray(fresh?.slots) &&
    cur.slots.length === fresh.slots.length &&
    cur.slots.every((s, i) => s.id === fresh.slots[i].id && s.kind === fresh.slots[i].kind);

  if (!sameShape) {
    state.rack = fresh;
    return true;
  }
  // Same modules in the same order: fill the objects that already exist rather
  // than swapping them, so identity survives. The reply is canonical — the
  // server has clamped and stored it — so writing it back over the local copy
  // is right, it just must not be a *different* copy.
  for (let i = 0; i < fresh.slots.length; i++) Object.assign(cur.slots[i], fresh.slots[i]);
  if (fresh.master) Object.assign(cur.master, fresh.master);
  if (fresh.slotIds) cur.slotIds = fresh.slotIds;
  return false;
}

function pushRack({ immediate = false } = {}) {
  clearTimeout(rackTimer);
  const send = async () => {
    const f = state.selectedFile;
    if (!f || !state.rack) return;
    try {
      adoptRack(await postJSON('/api/rack', {
        p: f.path,
        sr: state.view.sampleRate || 48000,
        slots: state.rack.slots,
        master: state.rack.master,
      }));
    } catch (e) { toast(e.message); return; }
    renderRack();
    renderTabs();
    // The waveform is dry, so adding or removing a module does not change it
    // either. The automation lanes are redrawn because their *targets* move
    // with the rack's structure, which is a different thing from its sound.
    repaintAutomationLanes();
    reloadAudioSource();
  };
  // Dragging a slider fires continuously; debounce so we render once per gesture.
  if (immediate) send(); else rackTimer = setTimeout(send, 220);
}

function slotSummary(slot) {
  if (slot.kind === 'gain') return `${slot.db >= 0 ? '+' : ''}${slot.db.toFixed(1)} dB`;
  if (slot.kind === 'eq') {
    const on = ['low', 'mid', 'high'].filter((b) => Math.abs(slot[b].gainDb) > 0.05).length;
    const hp = slot.highPassHz > 20 ? ` · HP ${Math.round(slot.highPassHz)}Hz` : '';
    return `${on} band${on === 1 ? '' : 's'}${hp}`;
  }
  if (slot.kind === 'comp') {
    return `${slot.ratio.toFixed(1)}:1 · ${slot.thresholdDb.toFixed(0)} dB`;
  }
  // A shaper, summarised from whatever it declares. This used to fall through
  // to the compressor's fields and throw on the first shaper added, which
  // aborted the whole chain redraw partway — so the slot appeared to vanish
  // rather than to be drawn wrongly.
  const spec = state.shapers[slot.kind];
  if (!spec || !spec.params.length) return '—';
  return spec.params
    .slice(0, 2)
    .map((p) => {
      const v = (slot.params || {})[p.key];
      if (v === undefined) return p.label;
      // A percentage only where the range really is nought to one. The gate's
      // threshold tops out at 0 dB, which is not a full scale of anything.
      const pct = p.min >= 0 && p.max <= 1.001;
      return `${p.label} ${pct ? Math.round(v * 100) + '%' : Math.round(v)}`;
    })
    .join(' · ');
}

// The channel strip's defaults and its build cache went with the strip. The
// maximiser is a module now, so its defaults are declared once in
// `MAXIMIZER_SPECS` and reach the interface with every other module's — there
// is no second copy here to drift from them.
//
// `spec.master` still exists and is still posted, because documents saved
// before this carry it and the engine still honours it.

function renderRack() {
  const rail = $('fxModuleRail');
  if (!rail) return;
  rail.innerHTML = '';
  renderVuMeter($('fxInputMeter'), 'IN');
  renderVuMeter($('fxOutputMeter'), 'OUT');
  if (!state.rack) return;

  state.rack.slots.forEach((slot, i) => {
    const shaper = state.shapers[slot.kind];
    const meta = SLOT_META[slot.kind]
      || (shaper ? { icon: shaper.label.slice(0, 2).toUpperCase(), name: shaper.label } : null)
      || { icon: '?', name: slot.kind };
    const el = document.createElement('section');
    el.className = 'fx-module' + (slot.bypassed ? ' off' : '');
    if (slot.kind === 'eq') el.classList.add('eq-visual');
    if (slot.kind === 'comp') el.classList.add('comp-visual');
    if (slot.kind === 'dattorro_filter_bank') el.classList.add('filter-bank-visual');
    if (slot.kind === 'chamberlin') el.classList.add('chamberlin-visual');
    el.dataset.kind = slot.kind;
    el.dataset.slot = i;
    el.innerHTML = `<header class="fx-module-head">
      <h2></h2>
      <div class="fx-module-actions"><button class="ghost fx-power"></button>
      <button class="ghost danger fx-remove">Remove</button></div>
      </header><div class="fx-module-signal">
        <div class="fx-vu fx-vu-in" aria-label="${meta.name} input meter"></div>
        <div class="fx-module-controls"></div>
        <div class="fx-vu fx-vu-out" aria-label="${meta.name} output meter"></div>
      </div>`;
    el.querySelector('h2').textContent = meta.name;
    const head = el.querySelector('.fx-module-head');
    head.draggable = true;
    head.ondragstart = (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(i));
      el.classList.add('dragging');
    };
    head.ondragend = () => el.classList.remove('dragging');
    el.ondragover = (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; };
    el.ondrop = (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData('text/plain'));
      if (Number.isInteger(from)) moveFxModule(from, i);
    };
    const power = el.querySelector('.fx-power');
    power.textContent = slot.bypassed ? 'Off' : 'On';
    power.onclick = () => {
      slot.bypassed = !slot.bypassed;
      pushRack({ immediate: true });
    };
    el.querySelector('.fx-remove')?.addEventListener('click', () => {
      state.rack.slots.splice(i, 1);
      pushRack({ immediate: true });
      renderRack();
    });
    renderVuMeter(el.querySelector('.fx-vu-in'), 'IN');
    renderVuMeter(el.querySelector('.fx-vu-out'), 'OUT');
    renderFxModuleControls(el.querySelector('.fx-module-controls'), slot, shaper, i);
    rail.appendChild(el);
  });
}

function moveFxModule(from, to) {
  if (!state.rack || from === to || from < 0 || to < 0 || from >= state.rack.slots.length) return;
  const [slot] = state.rack.slots.splice(from, 1);
  state.rack.slots.splice(to, 0, slot);
  const selections=state.rack.slots.map((_,i)=>eqBandSelections.get(i));
  const [selection]=selections.splice(from,1);selections.splice(to,0,selection);
  eqBandSelections.clear();selections.forEach((value,i)=>{if(value!==undefined)eqBandSelections.set(i,value);});
  state.rackSelected = to;
  pushRack({ immediate: true });
  renderRack();
}

function renderVuMeter(box, label) {
  if (!box) return;
  box.innerHTML = `<span class="vu-label">${label}</span><span class="vu-well">
    <i class="vu-bar vu-left"></i><i class="vu-bar vu-right"></i></span>`;
}

function paintRackMeters(levels) {
  if (!levels.length) return;
  const height = (v) => `${Math.max(0, Math.min(100, (20 * Math.log10(Math.max(v, 1e-4)) + 60) / 60 * 100))}%`;
  const paint = (box, pair) => {
    if (!box || !pair) return;
    box.querySelector('.vu-left')?.style.setProperty('--vu', height(pair[0]));
    box.querySelector('.vu-right')?.style.setProperty('--vu', height(pair[1]));
  };
  paint($('fxInputMeter'), levels[0]);
  const modules = [...document.querySelectorAll('.fx-module')];
  modules.forEach((module, i) => {
    paint(module.querySelector('.fx-vu-in'), levels[i]);
    paint(module.querySelector('.fx-vu-out'), levels[i + 1]);
    if (module.dataset.kind === 'comp') recordCompressorLevel(+module.dataset.slot, levels[i]);
  });
  paint($('fxOutputMeter'), levels[modules.length]);
}

const compressorLevels = new Map();
function recordCompressorLevel(slotIndex, input) {
  const slot=state.rack?.slots[slotIndex]; if(!slot||!input)return;
  const peak=Math.max(input[0]||0,input[1]||0,1e-5),db=20*Math.log10(peak);
  const over=Math.max(0,db-slot.thresholdDb),reduction=over*(1-1/Math.max(1,slot.ratio));
  compressorLevels.set(slotIndex,{db:Math.max(-60,Math.min(0,db)),reduction:Math.min(30,reduction)});
}

function resetRackMeters() {
  document.querySelectorAll('.vu-bar').forEach((bar) => bar.style.setProperty('--vu', '0%'));
  // The compressor draws the last window it was given; without this it keeps
  // showing the moment playback stopped.
  engine.waveform = null;
  compressorLevels.clear();
  repaintVisualCompressors();
}

function fxValueFormat(p, v) {
  if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz`
    : `${v < 10 ? v.toFixed(2) : Math.round(v)} Hz`;
  if (p.unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
  if (p.unit === 'dB') return `${v.toFixed(1)} dB`;
  if (p.unit) return `${v.toFixed(2)} ${p.unit}`;
  return p.min >= 0 && p.max <= 1.001 ? `${Math.round(v * 100)}%` : v.toFixed(2);
}

function automationUnit(value,min,max,log=false){
  return Math.max(0,Math.min(1,log&&min>0?Math.log(value/min)/Math.log(max/min):(value-min)/(max-min)));
}

function renderFxModuleControls(box, slot, shaper, slotIndex) {
  // `key` names the one control this row writes, so the value can be moved on
  // the effect that is already running. Without one there is nothing to address
  // and the whole rack has to be posted instead — which *rebuilds the chain*,
  // clearing every delay line and reverb tail in it. That is fine for a control
  // that has no key and no other way to be sent, and ruinous for one that has
  // already sent itself: the linked Dry / Wet writes both of its values through
  // `liveParam` inside `set`, and was then having the rack rebuilt under it
  // thirty times a second — which is exactly what "the reverb cuts out" is.
  //
  // `sent` says the row has taken care of it.
  const add = (label, value, min, max, step, format, set, log = false, key = null,
               def = undefined, sent = false) => {
    box.appendChild(param(label, value, min, max, step, format,
      (v) => {
        set(v);
        if (key) liveParam(slot.id, key, v);
        else if (!sent) {
          // Deliberately does nothing but complain. This used to call
          // `pushRackLive`, which posted the whole rack every 32ms — thirty
          // rebuilds a second, each one clearing every delay line and reverb
          // tail in the chain. A control that cannot name its parameter should
          // be visibly broken, not quietly destructive.
          console.error(`rack control "${label}" has no key and did not send its own — it will not reach the engine`);
        }
      },
      () => { commitRack(); }, log, def));
  };
  if (shaper) {
    if (slot.kind === 'dattorro_filter_bank') { renderDattorroFilterBank(box, slot, shaper); return; }
    if (slot.kind === 'chamberlin') { renderVisualChamberlin(box, slot, shaper); return; }
    slot.params = slot.params || {};
    const fitRows = [];
    if (!shaper.params.length) {
      const note = document.createElement('p');
      note.className = 'engine-note';
      note.textContent = 'No controls';
      box.appendChild(note);
    }
    const wetSpec=shaper.params.find(p=>p.key==='wet'),drySpec=shaper.params.find(p=>p.key==='dry');
    if(wetSpec&&drySpec){
      if(slot.params.wet===undefined)slot.params.wet=wetSpec.default;
      if(slot.params.dry===undefined)slot.params.dry=drySpec.default;
      const linkedPosition=()=>slot.params.wet>=.999?1-slot.params.dry/2:slot.params.wet/2;
      add('Dry / Wet',linkedPosition(),0,1,.001,v=>{const wet=Math.min(1,v*2),dry=Math.min(1,(1-v)*2);return `D ${Math.round(dry*100)} · W ${Math.round(wet*100)}`;},v=>{
        slot.params.wet=Math.min(1,v*2);slot.params.dry=Math.min(1,(1-v)*2);
        // One control, two writes: the linked position is an interface idea and
        // the effect only knows wet and dry.
        liveParam(slot.id,'wet',slot.params.wet);
        liveParam(slot.id,'dry',slot.params.dry);
      }, false, null, undefined, true);
    }
    for (const p of shaper.params) {
      if(p.key==='wet'||p.key==='dry')continue;
      if (slot.params[p.key] === undefined) slot.params[p.key] = p.default;
      if (slot.kind === 'utility' && ['invert', 'swap', 'ampFit'].includes(p.key)) {
        const toggle = check(p.label, p.label, slot.params[p.key] >= .5, (on) => {
          slot.params[p.key] = on ? 1 : 0;
          fitRows.forEach((row) => row.classList.toggle('inactive', slot.params.ampFit < .5));
          pushRack({ immediate: true });
          
        });
        box.appendChild(toggle);
        continue;
      }
      add(p.label, slot.params[p.key], p.min, p.max, (p.max - p.min) / 400,
        (v) => fxValueFormat(p, v), (v) => { slot.params[p.key] = v; }, p.log, p.key,
        p.default);
      if (slot.kind === 'utility' && ['grainMs', 'amount', 'floorDb'].includes(p.key)) {
        const row = box.lastElementChild; fitRows.push(row);
        row.classList.toggle('inactive', slot.params.ampFit < .5);
      }
    }
    return;
  }
  if (slot.kind === 'eq') { renderVisualEq(box, slot, slotIndex); return; }
  if (slot.kind === 'gain') {
    // Addressed by key like every other control, so moving it does not take
    // the rest of the chain's delay lines and tails with it.
    add('Level', slot.db, -24, 24, 0.1, (v) => `${v.toFixed(1)} dB`, (v) => { slot.db = v; },
        false, 'db', 0);
  } else if (slot.kind === 'comp') {
    renderVisualCompressor(box, slot);
  }
}

function renderDattorroFilterBank(box,slot,shaper){
  slot.params=slot.params||{};for(const p of shaper.params)if(slot.params[p.key]===undefined)slot.params[p.key]=p.default;
  box.classList.add('visual-filter-bank-controls');const graph=document.createElement('div');graph.className='filter-bank-graph';graph.innerHTML='<canvas class="filter-bank-canvas"></canvas><div class="filter-bank-readout"></div><div class="filter-bank-tabs"></div><div class="filter-bank-selected-controls"></div>';box.appendChild(graph);const canvas=graph.querySelector('canvas'),readout=graph.querySelector('.filter-bank-readout'),tabs=graph.querySelector('.filter-bank-tabs'),controlsBox=graph.querySelector('.filter-bank-selected-controls');
  const filters=[
    {name:'Notch',color:'#e35b52',on:'notchOn',hz:'notchHz',q:'notchQ',amp:'notchAmp'},
    {name:'Resonator',color:'#dc9d46',on:'resonatorOn',hz:'resonatorHz',q:'resonatorQ',amp:'resonatorAmp'},
    {name:'Regalia–Mitra',color:'#62d374',on:'regaliaOn',hz:'regaliaHz',q:'regaliaQ',amp:'regaliaAmp'},
    {name:'Damping',color:'#62aeda',on:'dampingOn',hz:'dampingHz',q:'dampingQ',amp:'dampingAmp'}];let selected=0;
  const curve=(f,hz)=>{const p=slot.params,q=p[f.q],amp=p[f.amp];if(f.name==='Notch')return-24*amp*Math.exp(-Math.pow(Math.log(hz/p[f.hz])*q,2)*5);if(f.name==='Resonator')return 14*amp*Math.exp(-Math.pow(Math.log(hz/p[f.hz])*q,2));if(f.name==='Damping')return 20*amp*Math.log10(1/Math.sqrt(1+Math.pow(hz/p[f.hz],2*Math.max(.2,q))));return 12*amp*Math.exp(-Math.pow(Math.log(hz/p[f.hz])*q,2));};
  const draw=()=>{const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;const d=devicePixelRatio||1;canvas.width=w*d;canvas.height=h*d;const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);const xf=hz=>Math.log(hz/20)/Math.log(1000)*w,yf=db=>h/2-db/48*h;c.fillStyle='#090b0d';c.fillRect(0,0,w,h);c.strokeStyle='rgba(255,255,255,.1)';for(const hz of [20,100,1000,10000,20000]){const x=xf(hz);c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}c.beginPath();c.moveTo(0,yf(0));c.lineTo(w,yf(0));c.stroke();filters.forEach((f,i)=>{if(slot.params[f.on]<.5)return;const pts=[];for(let x=0;x<=w;x+=2){const hz=20*Math.pow(1000,x/w);pts.push([x,yf(curve(f,hz))]);}c.beginPath();c.moveTo(0,yf(0));pts.forEach(([x,y])=>c.lineTo(x,y));c.lineTo(w,yf(0));c.closePath();c.globalAlpha=.22;c.fillStyle=f.color;c.fill();c.globalAlpha=1;c.beginPath();pts.forEach(([x,y],j)=>j?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=f.color;c.stroke();const x=xf(slot.params[f.hz]),y=yf(curve(f,slot.params[f.hz]));c.beginPath();c.arc(x,y,i===selected?9:7,0,Math.PI*2);c.fillStyle=i===selected?'#f4f7f9':f.color;c.fill();c.fillStyle='#20252a';c.textAlign='center';c.textBaseline='middle';c.font='bold 9px sans-serif';c.fillText(String(i+1),x,y);});};
  const controls=()=>{tabs.innerHTML='';filters.forEach((f,i)=>{const b=document.createElement('button');b.className='filter-bank-tab'+(i===selected?' selected':'')+(slot.params[f.on]<.5?' off':'');b.style.setProperty('--filter-color',f.color);b.textContent=f.name;b.onclick=()=>{selected=i;controls();};tabs.appendChild(b);});controlsBox.innerHTML='';const f=filters[selected],toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=slot.params[f.on]>=.5?'On':'Off';toggle.onclick=()=>{slot.params[f.on]=slot.params[f.on]>=.5?0:1;controls();pushRack({immediate:true});};controlsBox.appendChild(toggle);const add=(label,key,min,max,unit='',log=false)=>{let last=slot.params[key];controlsBox.appendChild(param(label,slot.params[key],min,max,(max-min)/400,v=>fxValueFormat({unit,min,max},v),v=>{last=v;slot.params[key]=v;draw();read();liveParam(slot.id,key,v);},()=>{commitRack();},log,shaperBorn(slot.kind,key)));};add('Frequency',f.hz,20,20000,'Hz',true);add('Q',f.q,.2,18);add('Amplitude',f.amp,0,1);read();draw();function read(){readout.textContent=`${f.name.toUpperCase()} · ${fxValueFormat({unit:'Hz'},slot.params[f.hz])} · Q ${slot.params[f.q].toFixed(2)} · AMP ${Math.round(slot.params[f.amp]*100)}% · ${slot.params[f.on]>=.5?'ON':'OFF'}`;}};
  const pick=e=>{const r=canvas.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top,xf=hz=>Math.log(hz/20)/Math.log(1000)*r.width,yf=db=>r.height/2-db/48*r.height;return filters.map((f,i)=>[i,Math.hypot(px-xf(slot.params[f.hz]),py-yf(curve(f,slot.params[f.hz])))]).sort((a,b)=>a[1]-b[1])[0][0];};let dragging=false;canvas.onpointerdown=e=>{selected=pick(e);dragging=true;canvas.setPointerCapture(e.pointerId);controls();};canvas.onpointermove=e=>{if(!dragging)return;const r=canvas.getBoundingClientRect(),f=filters[selected];slot.params[f.hz]=20*Math.pow(1000,Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));slot.params[f.q]=Math.max(.2,Math.min(18,(1-(e.clientY-r.top)/r.height)*18));draw();liveParam(slot.id,f.hz,slot.params[f.hz]);liveParam(slot.id,f.q,slot.params[f.q]);};canvas.onpointerup=e=>{const f=filters[selected];dragging=false;try{canvas.releasePointerCapture(e.pointerId);}catch{}controls();pushRack({immediate:true});};controls();
  requestAnimationFrame(draw);new ResizeObserver(draw).observe(canvas);
}

const CHAMBERLIN_COLORS={low:'#62aeda',band:'#62d374',high:'#dc9d46',notch:'#aa78d0'};
function drawVisualChamberlin(canvas,p){
  const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;const d=devicePixelRatio||1;canvas.width=w*d;canvas.height=h*d;
  const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);const xf=hz=>Math.log(hz/20)/Math.log(1000)*w,yf=db=>h/2-db/36*h;
  c.fillStyle='#090b0d';c.fillRect(0,0,w,h);c.strokeStyle='rgba(255,255,255,.1)';for(const hz of [20,100,1000,10000,20000]){const x=xf(hz);c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}c.beginPath();c.moveTo(0,yf(0));c.lineTo(w,yf(0));c.stroke();
  if(engine.spectrum?.length){const bins=engine.spectrum,nyquist=(engine.deviceRate||48000)/2;c.beginPath();c.moveTo(0,h);for(let i=1;i<bins.length;i++){const hz=i/(bins.length-1)*nyquist;if(hz>=20&&hz<=20000)c.lineTo(xf(hz),h-bins[i]/255*h*.9);}c.lineTo(w,h);c.closePath();c.fillStyle='rgba(52,137,202,.18)';c.fill();}
  const filters=['low','band','high','notch'];for(const [index,key] of filters.entries()){const freq=p[key+'Freq'],q=p[key+'Q'],amp=p[key+'Amp'];if(amp<=.001)continue;const response=hz=>key==='low'?-10*Math.log10(1+Math.pow(hz/freq,4)):key==='high'?-10*Math.log10(1+Math.pow(freq/hz,4)):key==='band'?-18*Math.pow(Math.log(hz/freq)*q,2):-18*Math.exp(-Math.pow(Math.log(hz/freq)*q,2)*4);const pts=[];for(let x=0;x<=w;x+=2){const hz=20*Math.pow(1000,x/w);pts.push([x,yf(response(hz)*amp)]);}c.beginPath();c.moveTo(0,yf(0));pts.forEach(([x,y])=>c.lineTo(x,y));c.lineTo(w,yf(0));c.closePath();c.globalAlpha=.2;c.fillStyle=CHAMBERLIN_COLORS[key];c.fill();c.globalAlpha=1;c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=CHAMBERLIN_COLORS[key];c.stroke();const nx=xf(freq),ny=h*(.84-Math.min(1,q/10)*.66);c.beginPath();c.arc(nx,ny,8,0,Math.PI*2);c.fillStyle=CHAMBERLIN_COLORS[key];c.fill();c.fillStyle='#20252a';c.textAlign='center';c.textBaseline='middle';c.font='bold 9px sans-serif';c.fillText(String(index+1),nx,ny);}
  c.textAlign='right';c.textBaseline='alphabetic';c.fillStyle='rgba(93,184,245,.7)';c.font='8px ui-monospace';c.fillText('POST FILTER',w-4,10);
}
function repaintVisualChamberlins(){document.querySelectorAll('.fx-module.chamberlin-visual').forEach(module=>{const slot=state.rack?.slots[+module.dataset.slot],canvas=module.querySelector('.chamberlin-graph canvas');if(slot&&canvas)drawVisualChamberlin(canvas,slot.params);});}
function renderVisualChamberlin(box,slot,shaper){
  slot.params=slot.params||{};for(const p of shaper.params)if(slot.params[p.key]===undefined)slot.params[p.key]=p.default;box.classList.add('visual-chamberlin-controls');
  const graph=document.createElement('div');graph.className='chamberlin-graph';graph.innerHTML='<canvas></canvas><div class="chamberlin-readout"></div><div class="chamberlin-sliders"></div>';box.appendChild(graph);const canvas=graph.querySelector('canvas'),readout=graph.querySelector('.chamberlin-readout'),stack=graph.querySelector('.chamberlin-sliders');
  let selected='low';const redraw=()=>{readout.textContent=`${selected.toUpperCase()} · ${fxValueFormat({unit:'Hz'},slot.params[selected+'Freq'])} · Q ${slot.params[selected+'Q'].toFixed(2)} · AMP ${Math.round(slot.params[selected+'Amp']*100)}%`;drawVisualChamberlin(canvas,slot.params);};
  let selectedRows=[];const controls=()=>{stack.innerHTML='';const tabs=document.createElement('div');tabs.className='filter-bank-tabs';for(const [key,label] of [['low','Low pass'],['band','Band pass'],['high','High pass'],['notch','Notch']]){const button=document.createElement('button');button.className='filter-bank-tab'+(key===selected?' selected':'')+(slot.params[key+'On']<.5?' off':'');button.style.setProperty('--filter-color',CHAMBERLIN_COLORS[key]);button.textContent=label;button.onclick=()=>{selected=key;controls();};tabs.appendChild(button);}stack.appendChild(tabs);const toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=slot.params[selected+'On']>=.5?'On':'Off';toggle.onclick=()=>{const key=selected+'On';slot.params[key]=slot.params[key]>=.5?0:1;controls();pushRack({immediate:true});};stack.appendChild(toggle);const add=(label,key,min,max,unit='',log=false)=>{let last=slot.params[key];const row=param(label,slot.params[key],min,max,(max-min)/400,v=>fxValueFormat({unit,min,max},v),v=>{last=v;slot.params[key]=v;redraw();liveParam(slot.id,key,v);},()=>{commitRack();},log,shaperBorn(slot.kind,key));stack.appendChild(row);return row;};selectedRows=[add('Frequency',selected+'Freq',20,18000,'Hz',true),add('Q',selected+'Q',.2,10),add('Amplitude',selected+'Amp',0,1)];add('Drive','drive',.25,8,'x',true);redraw();};
  const pick=(e)=>{const r=canvas.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top,xf=hz=>Math.log(hz/20)/Math.log(1000)*r.width;return ['low','band','high','notch'].map(key=>[key,Math.hypot(px-xf(slot.params[key+'Freq']),py-r.height*(.84-Math.min(1,slot.params[key+'Q']/10)*.66))]).sort((a,b)=>a[1]-b[1])[0][0];};let dragging=false;canvas.onpointerdown=e=>{selected=pick(e);dragging=true;canvas.setPointerCapture(e.pointerId);controls();};canvas.onpointermove=e=>{if(!dragging)return;const r=canvas.getBoundingClientRect(),freq=selected+'Freq',q=selected+'Q';slot.params[freq]=20*Math.pow(1000,Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));slot.params[q]=Math.max(.2,Math.min(10,(1-(e.clientY-r.top)/r.height)*10));selectedRows[0].sync(slot.params[freq]);selectedRows[1].sync(slot.params[q]);redraw();liveParam(slot.id,freq,slot.params[freq]);liveParam(slot.id,q,slot.params[q]);};canvas.onpointerup=e=>{const freq=selected+'Freq',q=selected+'Q';dragging=false;try{canvas.releasePointerCapture(e.pointerId);}catch{}pushRack({immediate:true});};controls();requestAnimationFrame(redraw);new ResizeObserver(redraw).observe(canvas);
}

function drawVisualCompressor(canvas, slot, slotIndex) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const level=compressorLevels.get(slotIndex)||{db:-60,reduction:0};
  const samples=engine.waveform||[];
  const signalTop=h*.28, signalBottom=h*.94;
  const signalY=(db)=>signalBottom-(Math.max(-60,Math.min(0,db))+60)/60*(signalBottom-signalTop);
  ctx.fillStyle = '#090b0d'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.11)'; ctx.lineWidth = 1;
  for (const db of [-60, -40, -20, 0]) {
    const y=signalY(db);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.38)';ctx.font='8px ui-monospace';ctx.textAlign='left';ctx.fillText(`${db}`,3,y-2);
  }
  if(samples.length){
    const mid=(signalTop+signalBottom)/2,amp=(signalBottom-signalTop)*.46;
    ctx.beginPath();samples.forEach((sample,i)=>{const x=i/(samples.length-1)*w,y=mid-sample/127*amp;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.lineTo(w,mid);ctx.lineTo(0,mid);ctx.closePath();ctx.fillStyle='rgba(174,181,188,.24)';ctx.fill();
    ctx.beginPath();samples.forEach((sample,i)=>{const x=i/(samples.length-1)*w,y=mid-sample/127*amp;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle='rgba(190,197,203,.78)';ctx.lineWidth=1.15;ctx.stroke();
  }
  const reductionY=6+level.reduction/30*(signalTop-12);ctx.beginPath();ctx.moveTo(0,reductionY);ctx.lineTo(w,reductionY);ctx.strokeStyle='#e6c83f';ctx.lineWidth=2;ctx.stroke();
  const kneeTop=signalY(slot.thresholdDb+slot.kneeDb/2),kneeBottom=signalY(slot.thresholdDb-slot.kneeDb/2);
  if(slot.kneeDb>0){ctx.fillStyle='rgba(73,174,232,.13)';ctx.fillRect(0,kneeTop,w,kneeBottom-kneeTop);ctx.setLineDash([3,3]);ctx.strokeStyle='rgba(73,174,232,.42)';ctx.beginPath();ctx.moveTo(0,kneeTop);ctx.lineTo(w,kneeTop);ctx.moveTo(0,kneeBottom);ctx.lineTo(w,kneeBottom);ctx.stroke();ctx.setLineDash([]);}
  const thresholdY=signalY(slot.thresholdDb);ctx.beginPath();ctx.moveTo(0,thresholdY);ctx.lineTo(w,thresholdY);ctx.strokeStyle='#49aee8';ctx.lineWidth=1.5;ctx.stroke();
  ctx.font='8px ui-monospace';ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.fillStyle='#e6c83f';ctx.fillText('GAIN REDUCTION',4,10);
  ctx.textAlign='right';ctx.fillStyle='#49aee8';ctx.fillText(`THRESH ${slot.thresholdDb.toFixed(1)} dB`,w-4,thresholdY-3);
  if(slot.kneeDb>0)ctx.fillText(`KNEE ${slot.kneeDb.toFixed(1)} dB`,w-4,kneeTop+10);
  ctx.fillStyle='rgba(190,197,203,.65)';ctx.fillText('LIVE SIGNAL',w-4,h-4);
}

function repaintVisualCompressors() {
  document.querySelectorAll('.fx-module.comp-visual').forEach((module) => {
    const slot=state.rack?.slots[+module.dataset.slot],canvas=module.querySelector('.comp-graph canvas');
    if(slot&&canvas)drawVisualCompressor(canvas,slot,+module.dataset.slot);
  });
}

function renderVisualCompressor(box, slot) {
  box.classList.add('visual-comp-controls');
  const graph=document.createElement('div');graph.className='comp-graph';graph.innerHTML='<canvas></canvas><div class="comp-slider-stack"></div>';
  box.appendChild(graph);const canvas=graph.querySelector('canvas'),stack=graph.querySelector('.comp-slider-stack');
  const slotIndex=state.rack.slots.indexOf(slot);
  const redraw=()=>drawVisualCompressor(canvas,slot,slotIndex);
  const add=(label,key,value,min,max,step,format,set,log=false)=>{let last=value;const target=`fx.${slot.id}.${key}`;const row=param(label,value,min,max,step,format,
    v=>{last=v;set(v);redraw();liveParam(slot.id,key,v);},()=>{commitRack();},log,fxBorn(slot.kind,key));stack.appendChild(row);return row;};
  const thresholdRow=add('Threshold','thresholdDb',slot.thresholdDb,-60,0,.5,v=>`${v.toFixed(1)} dB`,v=>{slot.thresholdDb=v;});
  add('Ratio','ratio',slot.ratio,1,20,.1,v=>`${v.toFixed(1)}:1`,v=>{slot.ratio=v;});
  add('Attack','attackMs',slot.attackMs,.05,500,.1,v=>`${v.toFixed(1)} ms`,v=>{slot.attackMs=v;},true);
  add('Release','releaseMs',slot.releaseMs,5,3000,1,v=>`${Math.round(v)} ms`,v=>{slot.releaseMs=v;},true);
  const kneeRow=add('Knee','kneeDb',slot.kneeDb,0,24,.5,v=>`${v.toFixed(1)} dB`,v=>{slot.kneeDb=v;});
  add('Makeup','makeupDb',slot.makeupDb,-24,24,.1,v=>`${v.toFixed(1)} dB`,v=>{slot.makeupDb=v;});
  let dragging=false;
  canvas.addEventListener('pointerdown',e=>{dragging=true;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;const r=canvas.getBoundingClientRect();const top=r.height*.28,bottom=r.height*.94;slot.thresholdDb=Math.max(-60,Math.min(0,-60+(bottom-(e.clientY-r.top))/(bottom-top)*60));slot.kneeDb=Math.max(0,Math.min(24,(e.clientX-r.left)/r.width*24));thresholdRow.sync(slot.thresholdDb);kneeRow.sync(slot.kneeDb);redraw();liveParam(slot.id,'thresholdDb',slot.thresholdDb);liveParam(slot.id,'kneeDb',slot.kneeDb);});
  canvas.addEventListener('pointerup',e=>{dragging=false;try{canvas.releasePointerCapture(e.pointerId);}catch{}pushRack({immediate:true});});
  requestAnimationFrame(redraw);new ResizeObserver(redraw).observe(canvas);
}

function defaultEqBands() {
  return [
    {type:'highpass',enabled:false,freq:30,q:.71,gainDb:0},
    {type:'lowshelf',enabled:true,freq:100,q:.7,gainDb:0},
    {type:'bell',enabled:true,freq:250,q:1,gainDb:0},
    {type:'bell',enabled:false,freq:500,q:1,gainDb:0},
    {type:'bell',enabled:false,freq:2000,q:1,gainDb:0},
    {type:'bell',enabled:false,freq:4000,q:1,gainDb:0},
    {type:'highshelf',enabled:true,freq:10000,q:.7,gainDb:0},
    {type:'lowpass',enabled:false,freq:18000,q:.71,gainDb:0},
  ];
}

const EQ_TYPES = [
  ['highpass','╱','High-pass'], ['lowshelf','⌞','Low shelf'], ['bell','⌒','Bell'],
  ['notch','∨','Notch'], ['highshelf','⌝','High shelf'], ['lowpass','╲','Low-pass'],
];
const EQ_COLORS=['#e35b52','#dc9d46','#b5d34b','#62d374','#52cbb0','#62aeda','#aa78d0','#7b8188'];

function drawVisualEq(canvas, slot, selected) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const xFor = (hz) => Math.log(hz / 20) / Math.log(1000) * w;
  const hzFor = (x) => 20 * Math.pow(1000, Math.max(0, Math.min(1, x / w)));
  const yFor = (db) => h / 2 - db / 36 * h;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#090b0d'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
  for (const hz of [20, 100, 1000, 10000, 20000]) { const x=xFor(hz); ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke(); }
  for (const db of [-12, 0, 12]) { const y=yFor(db);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke(); }
  if (engine.spectrum?.length) {
    const bins = engine.spectrum, nyquist = (engine.deviceRate || 48000) / 2;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 1; i < bins.length; i++) {
      const hz = i / (bins.length - 1) * nyquist;
      if (hz < 20 || hz > 20000) continue;
      ctx.lineTo(xFor(hz), h - bins[i] / 255 * h * .92);
    }
    ctx.lineTo(w, h); ctx.closePath();
    ctx.fillStyle = 'rgba(52,137,202,.26)'; ctx.fill();
    ctx.strokeStyle = 'rgba(93,184,245,.72)'; ctx.lineWidth = 1; ctx.stroke();
  }
  const bands=slot.bands||defaultEqBands();
  const bandResponse = (b,hz) => {if(!b.enabled)return 0;
    if(b.type==='highpass')return 20*Math.log10(1/Math.sqrt(1+Math.pow(b.freq/hz,4)));
    if(b.type==='lowpass')return 20*Math.log10(1/Math.sqrt(1+Math.pow(hz/b.freq,4)));
    if(b.type==='notch')return b.gainDb*Math.exp(-Math.pow(Math.log(hz/b.freq)*b.q,2)*5);
    if(b.type==='lowshelf')return b.gainDb/(1+Math.pow(hz/b.freq,2*Math.max(.2,b.q)));
    if(b.type==='highshelf')return b.gainDb/(1+Math.pow(b.freq/hz,2*Math.max(.2,b.q)));
    return b.gainDb*Math.exp(-Math.pow(Math.log(hz/b.freq)*b.q,2));};
  const response = (hz) => bands.reduce((sum,b)=>sum+bandResponse(b,hz),0);
  bands.forEach((band,i)=>{if(!band.enabled)return;const bp=[];for(let x=0;x<=w;x+=2)bp.push([x,yFor(bandResponse(band,hzFor(x)))]);ctx.beginPath();ctx.moveTo(0,yFor(0));bp.forEach(([x,y])=>ctx.lineTo(x,y));ctx.lineTo(w,yFor(0));ctx.closePath();ctx.globalAlpha=.18;ctx.fillStyle=EQ_COLORS[i];ctx.fill();ctx.globalAlpha=1;});
  const points=[]; for(let x=0;x<=w;x+=2) points.push([x,yFor(response(hzFor(x)))]);
  ctx.beginPath();ctx.moveTo(0,h);for(const [x,y] of points)ctx.lineTo(x,y);ctx.lineTo(w,h);ctx.closePath();
  ctx.fillStyle='rgba(94,190,52,.25)';ctx.fill(); ctx.beginPath();
  points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle='#78dd42';ctx.lineWidth=1.8;ctx.stroke();
  bands.forEach((b,i)=>{const x=xFor(b.freq),y=yFor(['highpass','lowpass','notch'].includes(b.type)?0:b.gainDb);ctx.beginPath();ctx.arc(x,y,i===selected?9:7,0,Math.PI*2);ctx.fillStyle=!b.enabled?'#454a50':i===selected?'#f4f7f9':EQ_COLORS[i];ctx.fill();ctx.fillStyle='#20252a';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);});
  ctx.fillStyle='rgba(255,255,255,.45)';ctx.font='8px ui-monospace';ctx.textAlign='left';ctx.fillText('20',3,h-4);ctx.fillText('100',xFor(100)+2,h-4);ctx.fillText('1k',xFor(1000)+2,h-4);ctx.fillText('10k',xFor(10000)+2,h-4);
  ctx.textAlign='right';ctx.fillStyle='rgba(93,184,245,.7)';ctx.fillText('POST FILTER',w-4,10);
}

function repaintVisualEqs() {
  document.querySelectorAll('.fx-module.eq-visual').forEach((module) => {
    const slot = state.rack?.slots[+module.dataset.slot];
    const canvas = module.querySelector('.eq-graph canvas');
    if (slot && canvas) drawVisualEq(canvas, slot, +(module.querySelector('.eq-graph')?.dataset.selected || 2));
  });
}

const eqBandSelections = new Map();
function renderVisualEq(box, slot, slotIndex) {
  slot.bands=slot.bands||defaultEqBands();
  box.classList.add('visual-eq-controls');
  const graph = document.createElement('div'); graph.className='eq-graph';
  graph.innerHTML='<canvas></canvas><div class="eq-selected"></div><div class="eq-slider-stack"></div>';
  box.appendChild(graph); const canvas=graph.querySelector('canvas'); const stack=graph.querySelector('.eq-slider-stack');
  let selected=eqBandSelections.get(slotIndex) ?? 2;
  const current=()=>slot.bands[selected];
  const redraw=()=>{graph.dataset.selected=selected;const b=current();graph.querySelector('.eq-selected').textContent=`BAND ${selected+1} · ${b.type.toUpperCase()} · ${b.enabled?'ON':'OFF'} · ${fxValueFormat({unit:'Hz'},b.freq)} · ${b.gainDb.toFixed(1)} dB · Q ${b.q.toFixed(2)}`;drawVisualEq(canvas,slot,selected);};
  const controls=()=>{
    stack.innerHTML=''; const band=current();
    const toolbar=document.createElement('div');toolbar.className='eq-band-toolbar';
    const enabled=document.createElement('button');enabled.className='ghost';enabled.textContent=band.enabled?'On':'Off';enabled.onclick=()=>{band.enabled=!band.enabled;controls();pushRack({immediate:true});};
    const shapes=document.createElement('div');shapes.className='eq-shape-icons';for(const [value,icon,label] of EQ_TYPES){const button=document.createElement('button');button.type='button';button.className='eq-shape-icon'+(band.type===value?' selected':'');button.textContent=icon;button.title=label;button.setAttribute('aria-label',label);button.onclick=()=>{band.type=value;if(value==='notch'&&Math.abs(band.gainDb)<.01)band.gainDb=-12;controls();pushRack({immediate:true});};shapes.appendChild(button);}toolbar.append(enabled,shapes);stack.appendChild(toolbar);
    const target=k=>`fx.${slot.id}.band.${selected}.${k}`;
    stack.appendChild(param('Frequency',band.freq,20,20000,1,v=>fxValueFormat({unit:'Hz'},v),v=>{band.freq=v;redraw();liveParam(slot.id,`band.${selected}.freq`,v);},()=>{commitRack();},true, eqBorn(selected, 'freq')));
    if(!['highpass','lowpass'].includes(band.type))stack.appendChild(param('Q',band.q,.05,18,.05,v=>v.toFixed(2),v=>{band.q=v;redraw();liveParam(slot.id,`band.${selected}.q`,v);},()=>{commitRack();}, false, eqBorn(selected, 'q')));
    if(!['highpass','lowpass'].includes(band.type))stack.appendChild(param('Gain',band.gainDb,-24,24,.1,v=>`${v.toFixed(1)} dB`,v=>{band.gainDb=v;redraw();liveParam(slot.id,`band.${selected}.gainDb`,v);},()=>{commitRack();}, false, eqBorn(selected, 'gainDb')));
    redraw();
  };
  const pick=(x,y)=>{const rect=canvas.getBoundingClientRect(),px=x-rect.left,py=y-rect.top,xFor=hz=>Math.log(hz/20)/Math.log(1000)*rect.width,yFor=db=>rect.height/2-db/36*rect.height;return slot.bands.map((b,i)=>[i,Math.hypot(px-xFor(b.freq),py-yFor(['highpass','lowpass','notch'].includes(b.type)?0:b.gainDb))]).sort((a,b)=>a[1]-b[1])[0][0];};
  let dragging=false;
  canvas.addEventListener('pointerdown',e=>{selected=pick(e.clientX,e.clientY);eqBandSelections.set(slotIndex,selected);dragging=true;canvas.setPointerCapture(e.pointerId);controls();});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;const r=canvas.getBoundingClientRect(),band=current(),base=`fx.${slot.id}.band.${selected}`;band.freq=20*Math.pow(1000,Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));if(!['highpass','lowpass'].includes(band.type))band.gainDb=Math.max(-24,Math.min(24,(r.height/2-(e.clientY-r.top))/r.height*36));redraw();liveParam(slot.id,`${'band.'}${selected}.freq`,band.freq);if(!['highpass','lowpass'].includes(band.type))liveParam(slot.id,`${'band.'}${selected}.gainDb`,band.gainDb);});
  canvas.addEventListener('pointerup',e=>{const band=current(),base=`fx.${slot.id}.band.${selected}`;dragging=false;try{canvas.releasePointerCapture(e.pointerId);}catch{}controls();pushRack({immediate:true});});
  controls(); requestAnimationFrame(redraw);
  new ResizeObserver(redraw).observe(canvas);
}

/// One labelled slider bound to a field on the selected slot.
/// A labelled slider.
///
/// `log` puts the control on a logarithmic curve. That is not decoration: the
/// stretch runs from a hundredth to a hundred times, and on a linear slider 1×
/// would sit at one percent of the travel, with everything musically useful
/// crushed against the left stop. On a log curve 1× sits in the middle and each
/// doubling takes the same distance.
function param(label, value, min, max, step, format, onChange, onCommit, log, def) {
  const el = document.createElement('div');
  el.className = 'param';
  // Name, control, reading — one line, three columns, and the columns are the
  // same width everywhere so a panel reads down as a table rather than as a
  // stack of separately-sized things.
  el.innerHTML = `<span class="k"></span><input type="range"><span class="v"></span>`;
  const name = el.querySelector('.k');
  name.textContent = label;
  // The column is narrower than the longest label, so the full name stays
  // reachable rather than being lost to the ellipsis.
  name.title = label;
  const out = el.querySelector('.v');
  const input = el.querySelector('input');

  // Position 0..1000 on the element, mapped to the real value.
  const TICKS = 1000;
  const toPos = (v) =>
    log ? (Math.log(Math.max(v, min) / min) / Math.log(max / min)) * TICKS
        : v;
  const toVal = (p) =>
    log ? min * Math.pow(max / min, p / TICKS)
        : p;

  if (log) Object.assign(input, { min: 0, max: TICKS, step: 1, value: toPos(value) });
  else Object.assign(input, { min, max, step, value });
  out.textContent = format(value);

  // The readout is updated from the element itself, so a redraw elsewhere
  // cannot leave the number disagreeing with the handle.
  const show = (v) => {
    const t = format(v);
    out.textContent = t;
    // Same reason as the label: the reading has a column, and some of these
    // say a word rather than a number.
    out.title = t;
  };
  el.sync = (v) => { input.value = toPos(v); show(v); };

  input.oninput = () => {
    const v = toVal(+input.value);
    show(v);
    onChange(v);
  };
  // Fires on pointer release, which is when the change is worth committing
  // properly rather than previewing.
  if (onCommit) input.onchange = () => onCommit(toVal(+input.value));

  // Double-click puts it back where it started.
  //
  // Only when a default was given. A control that quietly did nothing on a
  // double-click would be worse than one that plainly has no default, and
  // guessing — the midpoint, or zero, or whatever it happened to be built
  // with — would put values in that were never the default of anything.
  if (def === undefined || def === null || !Number.isFinite(def)) {
    // Not an error — `check` and the switches have no meaningful default, and a
    // control that resets to something which was never anybody's default is
    // worse than one that plainly does nothing. But a *slider* without one is
    // almost always an oversight, and the only reason `position` went years
    // without a reset is that this said nothing at all.
    console.warn(`control "${label}" has no default — double-click will not reset it`);
  }
  if (def !== undefined && def !== null && Number.isFinite(def)) {
    el.title = `${label} — double-click to reset to ${format(def)}`;
    const reset = (e) => {
      e.preventDefault();
      el.sync(def);
      onChange(def);
      if (onCommit) onCommit(def);
    };
    input.ondblclick = reset;
    // The label too: the slider is a thin target, and the row is what reads as
    // "this parameter".
    name.ondblclick = reset;
    out.ondblclick = reset;
  }
  return el;
}


/// A knob, for the effect rack.
///
/// Same contract as `param` — value in, format, change, commit, and a `sync`
/// so Reset and Undo can push a value back — so the two are interchangeable at
/// the call site and nothing else has to know which it got.
///
/// A rack is a row of little modules rather than a column of long sliders:
/// eight of these fit where three sliders did, and an effect with a handful of
/// controls reads as one object instead of a list. Dragged vertically, which is
/// how a knob has worked since knobs were physical, with shift for fine.
function knob(label, value, min, max, step, format, onChange, onCommit, log, def) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.innerHTML = `
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <circle class="bezel" cx="22" cy="22" r="13"></circle>
      <circle class="cap" cx="22" cy="22" r="10.5"></circle>
      <path class="track" d=""></path>
      <path class="arc" d=""></path>
      <line class="ptr" x1="22" y1="22" x2="22" y2="8"></line>
    </svg>
    <span class="k"></span><span class="v"></span>`;
  const name = el.querySelector('.k');
  name.textContent = label;
  name.title = label;
  const out = el.querySelector('.v');
  const arc = el.querySelector('.arc');
  const ptr = el.querySelector('.ptr');

  // 270 degrees, starting at seven o'clock — the range a knob has room for
  // without the ends meeting.
  const A0 = Math.PI * 0.75;
  const SWEEP = Math.PI * 1.5;
  const R = 15;
  const at = (t) => {
    const a = A0 + SWEEP * t;
    return [22 - R * Math.cos(a - Math.PI / 2), 22 - R * Math.sin(a - Math.PI / 2)];
  };
  const path = (from, to) => {
    const [x0, y0] = at(from);
    const [x1, y1] = at(to);
    const big = SWEEP * (to - from) > Math.PI ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  el.querySelector('.track').setAttribute('d', path(0, 1));

  // The same log mapping `param` uses, so a control that needed one as a
  // slider still gets one as a knob.
  const toPos = (v) => (log ? Math.log(Math.max(v, min) / min) / Math.log(max / min)
                            : (v - min) / (max - min));
  const toVal = (t) => (log ? min * Math.pow(max / min, t) : min + t * (max - min));

  let pos = Math.min(1, Math.max(0, toPos(value)));
  const paint = () => {
    const v = toVal(pos);
    arc.setAttribute('d', pos <= 0.001 ? '' : path(0, pos));
    const [px, py] = at(pos);
    ptr.setAttribute('x2', (22 + (px - 22) * 0.72).toFixed(2));
    ptr.setAttribute('y2', (22 + (py - 22) * 0.72).toFixed(2));
    const t = format(v);
    out.textContent = t;
    out.title = t;
  };
  const quantise = (v) => (step > 0 ? Math.round(v / step) * step : v);
  paint();

  el.sync = (v) => { pos = Math.min(1, Math.max(0, toPos(v))); paint(); };

  // Vertical drag. A full turn is 160 pixels, which is far enough to be
  // controllable and short enough to cross without letting go.
  let dragging = false;
  let lastY = 0;
  const svg = el.querySelector('svg');
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastY = e.clientY;
    svg.setPointerCapture(e.pointerId);
    el.classList.add('turning');
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const fine = e.shiftKey ? 0.2 : 1;
    pos = Math.min(1, Math.max(0, pos + ((lastY - e.clientY) / 160) * fine));
    lastY = e.clientY;
    paint();
    onChange(quantise(toVal(pos)));
  });
  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('turning');
    try { svg.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    if (onCommit) onCommit(quantise(toVal(pos)));
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const fine = e.shiftKey ? 0.2 : 1;
    pos = Math.min(1, Math.max(0, pos - Math.sign(e.deltaY) * 0.03 * fine));
    paint();
    onChange(quantise(toVal(pos)));
    if (onCommit) onCommit(quantise(toVal(pos)));
  }, { passive: false });

  // Double-click puts it back where it started — the same contract as `param`,
  // since the two are interchangeable at the call site and a control should not
  // behave differently for being round.
  if (def !== undefined && def !== null && Number.isFinite(def)) {
    el.title = `${label} — double-click to reset to ${format(def)}`;
    el.ondblclick = (e) => {
      e.preventDefault();
      el.sync(def);
      onChange(def);
      if (onCommit) onCommit(def);
    };
  }

  return el;
}

/// A switch: a button with its own name in it, coloured to say which way it is.
///
/// Built like `Reset all`, because it is the same kind of thing — a button you
/// press. The words are *in* it rather than in the name column beside it, and
/// the state is the colour: outlined and dim when off, filled with the accent
/// when on.
///
/// Two earlier versions got this wrong in opposite directions. A moulded rocker
/// was a small painting of a physical switch that matched nothing else here and
/// read as an indicator rather than a control. Replacing it with a name in the
/// column and a little `on`/`off` box was worse — two things to look at for one
/// bit, and the eye has to pair them up. One button, its own word, one colour.
/// Make a label fit a small button, in the order the eye loses least.
///
/// Anything parenthesised goes first, then anything after a dash — both are
/// qualifiers rather than the name. Only if it is still too long do the vowels
/// come out, and never the first letter of a word: "preserve transients" reads
/// as "prsrv trnsnts" but "rsrv rnsnts" reads as nothing.
const LABEL_MAX = 11;

/// Number words become numbers — on the button only, never in the tooltip.
/// Cardinals and ordinals both, because "fifth" is as long as "five" and half
/// as common in a label.
const NUMBER_WORDS = [
  ['first', '1st'], ['second', '2nd'], ['third', '3rd'], ['fourth', '4th'],
  ['fifth', '5th'], ['sixth', '6th'], ['seventh', '7th'], ['eighth', '8th'],
  ['ninth', '9th'], ['tenth', '10th'], ['eleventh', '11th'], ['twelfth', '12th'],
  ['sixteenth', '16th'],
  ['zero', '0'], ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'],
  ['five', '5'], ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'],
  ['ten', '10'], ['eleven', '11'], ['twelve', '12'], ['sixteen', '16'],
];

function digits(t) {
  let out = t;
  for (const [word, num] of NUMBER_WORDS) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), num);
  }
  return out;
}

function fitLabel(text) {
  // Ordered by what the eye loses least: qualifiers, then long number words,
  // then vowels.
  //
  // **Never truncated and never ellipsised.** A cut word is unreadable and a
  // trailing "…" says only that something is missing; "trnsnts" is still the
  // word. Dropping vowels is the last step and it is where this stops — if the
  // result is still wide, the button is wide.
  let t = String(text).replace(/\s*\([^)]*\)/g, '').replace(/\s*[-–—].*$/, '').trim();
  t = digits(t);
  if (t.length <= LABEL_MAX) return t;
  return t.replace(/\B[aeiou]/gi, '');
}

function check(label, title, value, onChange) {
  const el = document.createElement('div');
  el.className = 'param toggle';
  el.innerHTML = `<button class="tiny switch" role="switch"></button>`;
  const b = el.querySelector('.switch');
  const short = fitLabel(label);
  b.textContent = short;
  // The full name always survives in the tooltip, so shortening never loses it.
  b.title = short === label ? (title || label) : `${label} — ${title || ''}`.replace(/ — $/, '');
  el.title = b.title;

  let on = !!value;
  const paint = () => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  };
  paint();
  b.onclick = () => { on = !on; paint(); onChange(on); };
  // Same contract as `param` and `seg`, so Reset can push a value in.
  el.sync = (v) => { on = !!v; paint(); };
  return el;
}

/// A named choice between a few values.
function seg(label, options, value, onChange) {
  const el = document.createElement('div');
  el.className = 'param seg-param';
  // One line, and the same first column as a slider, so a choice sits in the
  // table rather than interrupting it. The bar takes the slider and reading
  // columns between them.
  el.innerHTML = `<span class="k"></span><div class="seg"></div>`;
  const name = el.querySelector('.k');
  name.textContent = label;
  name.title = label;
  const bar = el.querySelector('.seg');
  for (const [val, text, hint] of options) {
    const b = document.createElement('button');
    b.className = 'seg-btn' + (val === value ? ' active' : '');
    b.textContent = text;
    if (hint) b.title = hint;
    b._val = val;
    b.onclick = () => {
      for (const x of bar.children) x.classList.toggle('active', x === b);
      onChange(val);
    };
    bar.appendChild(b);
  }
  // Same contract as `param`, so Reset and Undo can push a value in without
  // knowing which kind of control they are holding.
  el.sync = (v) => {
    for (const b of bar.children) b.classList.toggle('active', b._val === v);
  };
  return el;
}

/// Two switches on one line, for the pairs that only mean anything together.
/// Attach an explanation to a control.
///
/// Set on the whole row rather than the label, so hovering the name, the
/// slider or the reading all say the same thing — and it replaces the
/// label-only title `param` and `knob` put on the name for clipping, which
/// would otherwise be the one that wins where it matters least.
///
/// Every control in the stretch tray has one. They are not decoration: half of
/// these were constants inside an algorithm until recently, and a slider whose
/// name is the only thing telling you what it does is a slider you turn at
/// random.
function tip(el, text) {
  el.title = text;
  // The name and the reading carry it outright: `param` and `knob` put the
  // bare label on the name so a clipped one stays readable, and that would
  // otherwise win over this in the one place a hover is most likely to land.
  for (const k of el.querySelectorAll('.k, .v, input')) k.title = text;
  // A segment that explains itself keeps its own words. Those are about the
  // one choice; this is about the row, and the specific of the two is the more
  // useful thing to be told.
  for (const k of el.querySelectorAll('.seg-btn, .switch')) {
    if (!k.title) k.title = text;
  }
  return el;
}

function pair(a, b) {
  const el = document.createElement('div');
  el.className = 'param-pair';
  el.append(a, b);
  return el;
}

/// A named group inside the Extended column.
///
/// Not a disclosure. These were folded when they lived among the everyday
/// sliders and the reason to hide them was that they are next to Stretch; in
/// their own column that reason is gone, and a control you have to go looking
/// for is a control you forget exists.
function wild(heading, title) {
  const el = document.createElement('div');
  el.className = 'wild';
  el.innerHTML = '<div class="wild-head"></div><div class="wild-body"></div>';
  const head = el.querySelector('.wild-head');
  head.textContent = heading;
  if (title) {
    head.title = title;
    // On the group as well as its heading. A control inside carries its own,
    // and the innermost title is the one a browser shows, so the two do not
    // fight — this only fills the space between them.
    el.title = title;
  }
  el.body = el.querySelector('.wild-body');
  el.add = (...kids) => { for (const k of kids) el.body.appendChild(k); return el; };
  return el;
}

/// Re-read the folder listing and whatever folder is open.
///
/// Called after anything this app does that puts a file in the library, so the
/// browser is never describing a directory that no longer matches the disk.
async function refreshLibrary() {
  try {
    state.folders = await api('/api/folders');
    const open = Object.keys(state.openFolders).filter((n) => state.openFolders[n]);
    for (const name of open) {
      state.folderFiles[name] = await api(`/api/files?folder=${encodeURIComponent(name)}`);
    }
    buildTree();
    for (const name of open) loadHeard(name);
  } catch { /* a failed refresh is a stale list, not a broken app */ }
}

// ------------------------------------------------------------------- capture
//
// Keeps what comes out of the speakers, rather than re-rendering the document.
// Those can differ — the engine is what you were listening to — and when they
// do, the recording is the honest one.
//
// Arming before playback and stopping when playback stops is the whole gesture:
// press record, press play, and when the sound ends the file is already written
// beside the original.

const capture = { armed: false, running: false };

async function setCapture(on) {
  try {
    const r = await postJSON('/api/capture', { on });
    if (on) {
      capture.running = true;
      return;
    }
    capture.running = false;
    if (!r.frames) { toast('Nothing captured'); return; }
    // The library has a file in it that was not there a moment ago.
    await refreshLibrary();
    const where = r.elsewhere ? ' (library not writable — saved to the app folder)' : '';
    const cut = r.truncated ? ' — hit the ten minute limit' : '';
    toast(`Captured ${r.seconds.toFixed(1)}s → ${r.name}${where}${cut}`);
  } catch (e) {
    capture.running = false;
    toast('Capture failed: ' + e.message);
  }
}

function reflectCapture() {
  const b = $('recBtn'), l = $('recLabel');
  if (!b) return;
  b.classList.toggle('on', capture.running);
  b.classList.toggle('armed', capture.armed && !capture.running);
  b.title = capture.running ? 'Recording — stops and saves when playback stops'
          : capture.armed ? 'Armed — starts when playback starts'
          : 'Capture what is playing';
  if (l) l.textContent = capture.running ? 'REC' : (capture.armed ? 'armed' : '');
}

const recBtn = $('recBtn');
if (recBtn) recBtn.onclick = async () => {
  if (capture.running) {
    // Stop now, without waiting for the sound to end.
    await setCapture(false);
    capture.armed = false;
  } else if (capture.armed) {
    capture.armed = false;
  } else {
    capture.armed = true;
    // Pressed while already playing: start keeping it immediately.
    if (engine.playing) await setCapture(true);
  }
  reflectCapture();
};

/// Called from the engine poll. Starts on play, finishes on stop.
function captureFollow(playing) {
  if (!capture.armed) return;
  if (playing && !capture.running) { setCapture(true).then(reflectCapture); }
  else if (!playing && capture.running) {
    capture.armed = false;
    setCapture(false).then(reflectCapture);
  }
}

// ------------------------------------------------------------ painting values
//
// A bank of sliders is a row of faders, and the thing you want to do with a row
// of faders is sweep a hand across it. Drag within one bar and it behaves
// exactly as it always did — the native control handles it. Carry the stroke
// off that bar and onto its neighbours and each one takes the value where the
// stroke crosses it, so a contour can be drawn across a whole panel in one
// gesture.
//
// The painted rows are driven through the same input/change events a pointer
// would produce, so everything downstream — the draft preview, the throttle,
// the commit on release — is reached by exactly the path it already trusts.

function paintValueAt(row, clientX) {
  const input = row.querySelector('input[type=range]');
  if (!input) return;
  const r = input.getBoundingClientRect();
  if (r.width <= 0) return;

  const min = +input.min, max = +input.max;
  const step = +input.step || 1;
  const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  const raw = min + t * (max - min);
  const snapped = Math.round(raw / step) * step;

  const next = String(Math.min(max, Math.max(min, snapped)));
  if (next === input.value) return;
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function enablePainting(scope) {
  if (!scope || scope.dataset.painting) return;
  scope.dataset.painting = '1';

  let painting = false;
  const touched = new Set();

  /// The bar under a point, by geometry rather than by hit-testing.
  ///
  /// `elementFromPoint` would be the obvious tool and is the wrong one: it
  /// answers about whatever is painted on top, so a tooltip, an overlay or a
  /// slider's own thumb can shadow a row and the stroke skips it.
  ///
  /// Both axes are tested, not just the vertical one, because the panels sit
  /// side by side — matching on height alone would set the bar in the next
  /// column along at the same time.
  const rowAt = (x, y) => {
    for (const row of scope.querySelectorAll('.param')) {
      const r = row.getBoundingClientRect();
      if (r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return row;
      }
    }
    return null;
  };

  const mark = (x, y) => {
    const row = rowAt(x, y);
    if (!row) return;
    // Set once, where the stroke crosses. An intersection is a point, so a bar
    // takes its value at the moment the line enters it and keeps it even if the
    // hand wanders on the way out.
    if (touched.has(row)) return;
    row.classList.add('painting');
    touched.add(row);
    paintValueAt(row, x);
  };

  scope.addEventListener('pointerdown', (e) => {
    // Pressing on a control is that control's own drag, and stealing it would
    // fight the gesture already under way. A stroke begins on the background
    // between them.
    if (e.target.closest('input, button, select, textarea, a, label')) {
      painting = false;
      return;
    }
    painting = true;
    touched.clear();
    mark(e.clientX, e.clientY);
  });

  // On the window, so the stroke survives the pointer leaving the panel.
  window.addEventListener('pointermove', (e) => {
    if (!painting || !e.buttons) return;
    mark(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', () => {
    if (!painting) return;
    painting = false;
    for (const row of touched) {
      row.classList.remove('painting');
      // Release, so each draft becomes a proper commit at full quality.
      row.querySelector('input[type=range]')
         ?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    touched.clear();
  });
}

/// Fire at most every `ms`, but fire *during* the gesture, not after it.
///
/// Both preview paths used a trailing debounce — clearTimeout on every input
/// event, then send once the events stop. Which means that while a slider is
/// actually moving the timer is reset on every pixel and never fires at all,
/// and the change only lands when the pointer pauses or is released. The whole
/// point of a preview is that it happens while you are still dragging.
function throttled(fn, ms) {
  let last = 0, timer = null;
  return () => {
    const now = performance.now();
    const wait = Math.max(0, ms - (now - last));
    clearTimeout(timer);
    if (wait === 0) { last = now; fn(); }
    else timer = setTimeout(() => { last = performance.now(); fn(); }, wait);
  };
}

/// Time and pitch live on the document, so they are posted as an edit
/// operation rather than as part of the rack.
/// Which file the stretch sliders were built for.
///
/// The panel is built once and then left alone. Rebuilding it on every server
/// response destroyed the very slider under the pointer, so the first change
/// landed and no further drag did anything.
let stretchBuiltFor = null;

function sendStretch({ live }) {
  const d = state.stretchDraft;
  editOp(
    { op: 'stretch', ratio: d.ratio, semitones: d.semitones,
      windowMs: d.windowMs, quality: live ? 'draft' : d.quality,
      algorithm: d.algorithm, vocoder: d.vocoder, wsola: d.wsola,
      pvsola: d.pvsola, hybrid: d.hybrid,
      cloud: d.cloud, cloudMix: d.cloudMix },
    { live },
  );
}

// The engines' own defaults, mirroring `VocoderParams`, `WsolaParams` and
// `Grain` in the fx crate. Kept here so a document saved before a control
// existed still opens with that control at the value the engine assumes, rather
// than at undefined — which a slider reads as NaN and posts back as a reset.
const VOCODER_DEFAULTS = {
  windowMs: 46, phaseLock: true,
  freqTrust: 1, phaseSpread: 1, peakWidth: 2, lockWidth: 1,
  magFreeze: 0, magBlur: 0, magGate: 0, stereoLink: false,
};
const WSOLA_DEFAULTS = {
  preserveTransients: false, sensitivity: 0.5,
  searchMs: 10, splice: 'similar', stride: 4, shape: 'hann',
  guardHops: 3, floor: 1,
};
// Which engines the audio callback can actually run. Mirrors
// `engine::stretcher::is_live`; the rest are rendered on export and
// approximated live, which the panel says out loud.
const LIVE_ENGINES = ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular'];
const PVSOLA_DEFAULTS = { anchorFrames: 6, searchMs: 10, blend: 0.5 };
const HYBRID_DEFAULTS = {
  fftSize: 2048, timeSpan: 17, freqSpan: 17, margin: 2, morphNoise: true,
  harmonicLevel: 1, percussiveLevel: 1, residualLevel: 1,
};
const GRAIN_DEFAULTS = {
  rateHz: 0, densityHz: 0, overlap: 2, sizeJitter: 0, positionJitterMs: 0,
  pitchJitterSemis: 0, pitchDriftSemis: 0, driftRateHz: 0.5, layers: 1,
  scan: 1, reverse: false, envelope: 0.5, sizeRange: 1, wrap: false,
  layerSpread: 1, linkJitter: false, driftStep: false, panSpread: 0,
  // Zero is the sweep's own beginning, matching `Grain::default` in `fx`. It
  // was missing, so Position was the one fader in its group with no
  // double-click reset — silently, because `param` only attaches the handler
  // when it is given a default and says nothing when it is not.
  position: 0,
  layerScatter: 0, layerScatterMs: 120,
};

/// Continuous preview while dragging, at draft quality so it keeps up.
const previewStretch = throttled(() => sendStretch({ live: true }), 90);

/// Pointer released: commit properly, at the chosen quality, and repoint audio.
function commitStretch() {
  sendStretch({ live: false });
}

function renderStretch() {
  const box = $('stretchParams');
  if (!box) return;
  const st = state.edit?.stretch;
  const path = state.selectedFile?.path || null;

  if (!st) { box.innerHTML = ''; stretchBuiltFor = null; return; }

  // Already built for this document: refresh the derived readout only.
  if (stretchBuiltFor === path) { showStretchOut(); return; }

  stretchBuiltFor = path;
  box.innerHTML = '';
  // Take the tier from the document, not from whatever the last file used.
  state.stretchDraft = {
    ratio: st.ratio, semitones: st.semitones,
    windowMs: st.windowMs, quality: st.quality || 'standard',
    algorithm: st.algorithm || 'wsola',
    vocoder: { ...VOCODER_DEFAULTS, ...(st.vocoder || {}) },
    wsola: { ...WSOLA_DEFAULTS, ...(st.wsola || {}) },
    pvsola: { ...PVSOLA_DEFAULTS, ...(st.pvsola || {}) },
    hybrid: { ...HYBRID_DEFAULTS, ...(st.hybrid || {}) },
    // A document written before the cloud could be layered has neither field.
    // Off is what it sounds like, so off is what it opens as.
    cloud: !!st.cloud,
    cloudMix: st.cloudMix ?? 0.5,
  };

  // Which engine does the stretching. Not a quality ladder — they fail in
  // different directions, so this is a choice about the material rather than
  // about how hard to work.
  const eng = document.createElement('div');
  eng.className = 'engine-pick';
  eng.innerHTML = `
    <div class="seg" id="stretchEngine">
      <button class="seg-btn" data-alg="wsola" title="WSOLA — time domain. Keeps transients intact: drums, percussion, one-shots.">WSOLA</button>
      <button class="seg-btn" data-alg="vocoder" title="Frequency domain. Holds chords and sustained tone together - pads, strings.">Vocoder</button>
      <button class="seg-btn" data-alg="pvsola" title="The vocoder, re-anchored to the waveform every few frames. Holds tone together without the phasiness - the one-knob default for pitched material.">PVSOLA</button>
      <button class="seg-btn" data-alg="hybrid" title="Splits the sound into tone, hits and air, and stretches each its own way. The slow one, and the only one that will not repeat noise.">Hybrid</button>
      <button class="seg-btn" data-alg="granular" title="A cloud of grains. Not trying to be transparent - this is the one you hear.">Granular</button>
    </div>`;
  // No reset button on this row any more.
  //
  // It was the sixth thing on a row that already lost its engine labels the
  // moment a second button joined it, and it spent all of its time being a
  // button you did not want next to five you did. Double-clicking an engine
  // tab does the same job — see the tabs' `ondblclick` below — which costs the
  // row nothing and puts the gesture on the thing it resets.
  box.appendChild(eng);

  // The order under the picker is fixed, and it is the same on every engine:
  //
  //   1. the button row
  //   2. Stretch, Pitch, Window — always, always these three
  //   3. whatever sliders this engine has of its own
  //
  // They used to come third, after the engine's own controls, so the first
  // slider under the buttons was `Re-anchor` on PVSOLA, `Analysis window` on
  // the vocoder and `Tone` on the hybrid. Three separate containers rather than
  // one, so the order cannot depend on what happens to be appended when.
  const switchHost = document.createElement('div');
  switchHost.className = 'engine-switch-host';
  eng.after(switchHost);

  const coreHost = document.createElement('div');
  coreHost.className = 'stretch-core';
  switchHost.after(coreHost);

  // Each engine gets its own controls. They mean different things by a
  // "window" — a splice for WSOLA, an analysis frame for the vocoder, a grain
  // for the cloud — so one shared slider was three half-explained ones.
  const own = document.createElement('div');
  own.className = 'engine-params';
  coreHost.after(own);

  const reflectEngine = () => {
    const alg = state.stretchDraft.algorithm;
    for (const b of eng.querySelectorAll('.seg-btn')) {
      b.classList.toggle('active', b.dataset.alg === alg);
    }
    own.innerHTML = '';
    // One row at the top of the engine's own controls: whatever switches it
    // has on the left, the tuning on the right. Built for every engine, so the
    // scale is in the same place whichever one is picked — pitch applies to
    // all of them, and only WSOLA has a transient switch to sit beside.
    const switches = document.createElement('div');
    switches.className = 'engine-switches';
    // The tuning goes on first and the engine's own switches are prepended in
    // front of it, so it sits at the right-hand end of the row whether or not
    // this engine has anything to put beside it.
    // Four fixed slots, and WSOLA is the master.
    //
    // 1 the engine's own switch · 2 the grain cloud · 3 the tuning · 4 Keys.
    // An engine with nothing for slot 1 leaves it empty rather than sliding the
    // rest left, so no button ever moves when you change engine — which is the
    // whole point of a row of controls you learn the position of.
    const scale = scaleButton();
    scale.dataset.slot = '3';
    switches.appendChild(scale);
    const keys = keysButton();
    keys.dataset.slot = '4';
    switches.appendChild(keys);
    // Its own host, above the three core sliders — `own` is cleared and rebuilt
    // per engine and sits below them.
    switchHost.innerHTML = '';
    switchHost.appendChild(switches);

    // The grain cloud, layered over whichever engine is running.
    //
    // The picker chooses one of five, and choosing one used to silence the
    // other four — including the cloud, which is not really the same kind of
    // thing. The other four are trying to move a recording through time
    // without being noticed; the cloud is an instrument. So it can now run
    // beside them on the same source. Nothing to offer when the cloud already
    // *is* the engine.
    if (alg !== 'granular') {
      const d = state.stretchDraft;
      const cloudRow = check('grain cloud',
        'Run the grain cloud over this engine, reading the same source at the same stretch',
        d.cloud,
        (on) => { d.cloud = on; reflectEngine(); commitStretch(); });
      cloudRow.dataset.slot = '2';
      switches.prepend(cloudRow);
      if (d.cloud) {
        own.appendChild(tip(param('Cloud', d.cloudMix, 0, 1, 0.01,
          (x) => `${Math.round(x * 100)}%`,
          (x) => { d.cloudMix = x; previewStretch(); }, () => commitStretch(), false, 0.5),
          'How much cloud against the engine underneath. Equal power, so the middle is not a dip — the two are decorrelated and a straight crossfade would sag there.'));
      }
    }
    // The engine's standard controls stay under the picker. Everything that
    // used to be a constant in the algorithm goes to the Extended column
    // instead: those values are constants because that is where the algorithm
    // works, so they belong together and away from the everyday sliders.
    const ext = $('extEngine');
    ext.innerHTML = '';
    // The vocoder's standard pair and its two extended groups.
    //
    // Written once and called from three engines, because PVSOLA and Hybrid
    // both *run* the vocoder — a control that reaches the audio but has no
    // control on the panel is the same bug as one that does nothing, and
    // harder to notice. `what` names whose vocoder it is, since inside the
    // hybrid it is only shaping one third of the sound.
    const vocoderControls = (what) => {
      const v = state.stretchDraft.vocoder;
      own.appendChild(tip(param('Analysis window', v.windowMs, 5, 500, 1,
        (x) => `${Math.round(x)} ms`,
        (x) => { v.windowMs = x; previewStretch(); }, () => commitStretch(), true, VOCODER_DEFAULTS.windowMs),
        "The length of one transform, rounded to a power of two. Long resolves partials that sit close together and smears transients; short does the opposite. This is the vocoder's own window and means something different from the one above."));
      const phaseRow = check('phase lock',
        'Holds each partial together instead of letting it dissolve into neighbouring bins',
        v.phaseLock, (on) => { v.phaseLock = on; commitStretch(); });
      const alg = state.stretchDraft.algorithm;
      if (alg === 'pvsola' || alg === 'vocoder') {
        // Neither has a switch of its own, so slot 1 on the row is empty and
        // this sits there — beside the grain cloud rather than loose among the
        // sliders. Slot 1 packs from the left and the grain cloud follows it,
        // so the tuning and Keys keep the two places they always have.
        //
        // Hybrid keeps it in the panel: it already has `remake noise` on the
        // row, and two of its own switches plus the cloud, the tuning and Keys
        // is five buttons where the row holds four.
        phaseRow.dataset.slot = '1';
        engineSwitches().prepend(phaseRow);
      } else {
        own.appendChild(phaseRow);
      }

      ext.appendChild(wild('Spectrum',
        `The vocoder normally copies magnitudes through untouched and rewrites only phase. These do not.${what}`).add(
        tip(param('Freeze', v.magFreeze, 0, 1, 0.01,
          (x) => (x >= 0.999 ? 'held' : `${Math.round(x * 100)}%`),
          (x) => { v.magFreeze = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.magFreeze),
        'Hold the magnitude spectrum where it is instead of following the source. At 100% the sound stops changing timbre and only its phase keeps moving.'),
        tip(param('Blur', v.magBlur, 0, 1, 0.01, (x) => `${Math.round(x * 100)}%`,
          (x) => { v.magBlur = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.magBlur),
        "Smear each frame's magnitudes into neighbouring bins. Softens the edges between partials and turns a pitched sound toward noise."),
        tip(param('Gate', v.magGate, 0, 1, 0.01,
          (x) => (x <= 0 ? 'off' : `${Math.round(x * 100)}%`),
          (x) => { v.magGate = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.magGate),
        "Drop every bin below this share of the frame's loudest. Thins the sound to its strongest partials, and at high settings leaves a sparse, bell-like residue."),
      ));

      ext.appendChild(wild('Phase',
        `How the frequency estimate is believed and how far a peak imposes its phase on its neighbours.${what}`).add(
        tip(param('Freq trust', v.freqTrust, 0, 4, 0.01,
          (x) => (x <= 0.001 ? 'to bins' : `${x.toFixed(2)}×`),
          (x) => { v.freqTrust = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.freqTrust),
        "How far the frequency measured from the phase difference is believed over the bin's nominal centre. At zero every partial is forced onto its bin, which detunes the sound into a metallic grid."),
        tip(param('Phase spread', v.phaseSpread, 0, 4, 0.01, (x) => `${x.toFixed(2)}×`,
          (x) => { v.phaseSpread = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.phaseSpread),
        "How far a peak's phase correction reaches into the bins around it. This is what stops a partial dissolving into its neighbours as the stretch gets long."),
        tip(param('Peak width', v.peakWidth, 1, 16, 1, (x) => `${Math.round(x)} bin`,
          (x) => { v.peakWidth = Math.round(x); previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.peakWidth),
        'How many bins either side of a maximum count as belonging to it. Wider claims more of the spectrum for each peak, which holds thick tone together and blurs closely spaced partials.'),
        tip(param('Lock width', v.lockWidth, 0, 4, 0.01, (x) => `${x.toFixed(2)}×`,
          (x) => { v.lockWidth = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.lockWidth),
        'How strongly a peak imposes its phase on the bins it owns. Zero leaves each bin to itself, which is the classic phase vocoder and the classic phasiness.'),
        check('link stereo',
          'Move both channels by one shared correction, so the image survives the stretch instead of drifting apart',
          v.stereoLink, (on) => { v.stereoLink = on; commitStretch(); }),
      ));
    };

    // WSOLA's splice group, and its transient group when the detector is on.
    //
    // `forced` is for the hybrid, which turns transient preservation on and
    // keeps it on — an attack surviving at its original rate is the whole
    // reason that part was separated out. So there is no switch to show, but
    // the detector and its two constants are live and need reaching.
    const wsolaControls = ({ forced = false, what = '' } = {}) => {
      const w = state.stretchDraft.wsola;
      const detecting = forced || w.preserveTransients;
      if (!forced) {
        const ptRow = check('preserve transients',
          'Hold drum hits at their original rate so they are not laid down twice',
          w.preserveTransients,
          (on) => { w.preserveTransients = on; reflectEngine(); commitStretch(); });
        ptRow.dataset.slot = '1';
        engineSwitches().prepend(ptRow);
      }
      if (detecting) {
        own.appendChild(tip(param('Detector', w.sensitivity, 0, 1, 0.01,
          (x) => `${Math.round(x * 100)}%`,
          (x) => { w.sensitivity = x; previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.sensitivity),
        'How eager the onset detector is. Higher finds more hits to protect, including ones that are not really hits; lower protects only the clearest attacks.'));
      }

      ext.appendChild(wild('Splice',
        `How far the similarity search looks, what it goes looking for, and what the result is laid down under.${what}`).add(
        tip(param('Search', w.searchMs, 0, 200, 0.5,
          (x) => (x <= 0 ? 'plain OLA' : `${x.toFixed(1)} ms`),
          (x) => { w.searchMs = x; previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.searchMs),
        'How far either side of the ideal splice point the similarity search may look for a better join. At zero there is no search at all and this becomes plain overlap-add, which is where the flanging comes from.'),
        tip(seg('Pick', [
          ['similar', 'best', 'The segment that best continues what came before. What WSOLA is for.'],
          ['different', 'worst', 'The least similar segment the search can find, every time.'],
          ['loudest', 'loud', 'Un-normalised, so the search walks toward whatever is loudest nearby.'],
        ], w.splice, (x) => { w.splice = x; commitStretch(); }),
        'What the similarity search goes looking for. Only the first is trying to be transparent; the other two are the engine used as an instrument.'),
        tip(seg('Window', [
          ['hann', 'hann', 'Sums flat at 50% overlap, which is why it is the default.'],
          ['triangle', 'tri', 'Sums flat too, with a corner on every splice.'],
          ['rect', 'rect', 'No envelope. Every splice is a step, so the seams become a rhythm.'],
        ], w.shape, (x) => { w.shape = x; commitStretch(); }),
        'The envelope each spliced segment is laid down under. Hann and triangle both sum flat at the usual overlap; rect does not, which is the point of it.'),
        tip(param('Stride', w.stride, 1, 128, 1, (x) => `${Math.round(x)} fr`,
          (x) => { w.stride = Math.round(x); previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.stride),
        'How many frames the similarity search steps by as it looks. Bigger is cheaper and coarser - the join lands near the best place rather than on it.'),
      ));

      // Only reachable once the detector is running, so it appears with it.
      if (detecting) {
        ext.appendChild(wild('Transients',
          'What the detector counts as a hit, and how much either side of one is held at its original rate.').add(
          tip(param('Floor', w.floor, 0, 2, 0.01,
            (x) => (x <= 0 ? 'none' : `${x.toFixed(2)}×`),
            (x) => { w.floor = x; previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.floor),
        'How far above the local average a peak has to rise before it counts as a hit. Low finds hits everywhere, which protects so much of the sound that the stretch stops happening.'),
          tip(param('Guard', w.guardHops, 1, 16, 0.1, (x) => `${x.toFixed(1)} hop`,
            (x) => { w.guardHops = x; previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.guardHops),
        'How many hops either side of a detected hit are held at the original rate, so the attack is not laid down twice or cut in half.'),
        ));
      }
    };

    // Three of the five do not run in the audio callback yet, so playback
    // approximates them with the grain cloud while export uses the real engine.
    // A control that quietly does something else is worse than one that says so.
    if (!LIVE_ENGINES.includes(alg)) {
      const note = document.createElement('p');
      note.className = 'engine-note';
      note.textContent = 'Rendered on export — playback approximates this with the grain cloud.';
      own.appendChild(note);
    }

    if (alg === 'vocoder') vocoderControls('');
    if (alg === 'wsola') wsolaControls();

    if (alg === 'pvsola') {
      const p = state.stretchDraft.pvsola;
      // One knob, and it really is the only one that matters: how long the
      // vocoder is allowed to run on its own guesses before being put back on
      // the ground. Everything else about this engine is the vocoder's, and
      // the vocoder's own panel is shown below it for that reason.
      own.appendChild(tip(param('Re-anchor', p.anchorFrames, 1, 64, 1,
        (x) => `${Math.round(x)} fr`,
        (x) => { p.anchorFrames = Math.round(x); previewStretch(); },
        () => commitStretch(), false, PVSOLA_DEFAULTS.anchorFrames),
        'How many analysis frames the vocoder is allowed to run on its own guesses before being spliced back onto the real waveform. Short kills phasiness and costs splices; long is the plain vocoder again.'));

      ext.appendChild(wild('Anchor',
        'How the splice back to the waveform is found and how it is joined. Both off is a hard cut every few frames, which you can hear as a rhythm.').add(
        tip(param('Search', p.searchMs, 0, 200, 0.5,
          (x) => (x <= 0 ? 'no search' : `${x.toFixed(1)} ms`),
          (x) => { p.searchMs = x; previewStretch(); }, () => commitStretch(), false, PVSOLA_DEFAULTS.searchMs),
        'How far the anchor search looks for the best place to splice back onto the waveform. At zero it joins wherever it lands, which you hear as a click every few frames.'),
        tip(param('Blend', p.blend, 0, 1, 0.01,
          (x) => (x <= 0 ? 'butt join' : `${Math.round(x * 100)}%`),
          (x) => { p.blend = x; previewStretch(); }, () => commitStretch(), false, PVSOLA_DEFAULTS.blend),
        'How much of the anchor is crossfaded rather than butt-joined. The fade is linear here, not equal power, because the search has just spent its whole effort making both sides correlated.'),
      ));

      // The vocoder is what is actually running between anchors, so all of its
      // controls are live here and all of them are shown. Not copies — the
      // same settings, reached from a second place.
      //
      // WSOLA's are deliberately absent: this engine finds its splice with its
      // own search, so the WSOLA panel's search, pick, window and stride do
      // not reach it. Showing them would be worse than not having them.
      vocoderControls(' Between anchors, this engine is the vocoder, so these are live here too.');
    }

    if (alg === 'hybrid') {
      const h = state.stretchDraft.hybrid;
      // The three levels are the reason to be in this engine rather than the
      // vocoder: nothing else here will turn a sound's air down without
      // touching its tone.
      own.appendChild(tip(param('Tone', h.harmonicLevel, 0, 2, 0.01,
        (x) => (x <= 0 ? 'out' : `${x.toFixed(2)}×`),
        (x) => { h.harmonicLevel = x; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.harmonicLevel),
        "The level of the harmonic part - the ridges that run along time. This is the reason to be in this engine: nothing else here will turn a sound's air down without touching its tone."));
      own.appendChild(tip(param('Hits', h.percussiveLevel, 0, 2, 0.01,
        (x) => (x <= 0 ? 'out' : `${x.toFixed(2)}×`),
        (x) => { h.percussiveLevel = x; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.percussiveLevel),
        'The level of the percussive part - the ridges that run across frequency. Attacks, clicks and transients, stretched by WSOLA with preservation held on.'));
      own.appendChild(tip(param('Air', h.residualLevel, 0, 2, 0.01,
        (x) => (x <= 0 ? 'out' : `${x.toFixed(2)}×`),
        (x) => { h.residualLevel = x; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.residualLevel),
        'The level of the residual - everything that is neither a partial nor a hit. Breath, hiss, room. This is the part Margin decides the existence of.'));
      own.appendChild(check('remake noise',
        'Rebuild the air as fresh noise shaped like the old, instead of stretching it. Off, it repeats at long ratios like every other engine here does',
        h.morphNoise, (on) => { h.morphNoise = on; commitStretch(); }));

      ext.appendChild(wild('Separation',
        'How the sound is cut into three. A partial is a ridge along time and a hit is a ridge across frequency; these decide how long and how broad each has to be to count.').add(
        tip(param('Hold', h.timeSpan, 3, 101, 2, (x) => `${Math.round(x) | 1} fr`,
          (x) => { h.timeSpan = Math.round(x) | 1; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.timeSpan),
        'How many frames long a ridge has to hold steady before it counts as a partial. Longer is stricter and sends more of the sound to the other two parts.'),
        tip(param('Spread', h.freqSpan, 3, 101, 2, (x) => `${Math.round(x) | 1} bin`,
          (x) => { h.freqSpan = Math.round(x) | 1; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.freqSpan),
        'How many bins wide a ridge has to be before it counts as a hit. Wider is stricter about what an attack is.'),
        tip(param('Margin', h.margin, 1, 8, 0.05,
          (x) => (x <= 1.001 ? 'no air' : `${x.toFixed(2)}×`),
          (x) => { h.margin = x; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.margin),
        'How much louder one part has to be than the other before it may claim a bin outright. At 1x nothing is left over and there is no Air at all - which is why the noise remaker then has nothing to work on.'),
        tip(param('Resolution', h.fftSize, 256, 8192, 256, (x) => `${Math.round(x)}`,
          (x) => { h.fftSize = Math.round(x); previewStretch(); }, () => commitStretch(), true, HYBRID_DEFAULTS.fftSize),
        'The transform size the separation runs at. Bigger tells partials apart more finely and blurs the timing of hits; the separation is a property of the sound, not of the stretch.'),
      ));

      // This engine runs both of the others, so both of their control sets are
      // live and both are shown — the vocoder shapes the tone, WSOLA shapes
      // the hits. The transient detector has no switch here because the hybrid
      // keeps it on: an attack surviving at its own rate is the whole reason
      // that part was separated out in the first place.
      vocoderControls(' Here they shape the tone, which is the part the vocoder is given.');
      wsolaControls({
        forced: true,
        what: ' Here they shape the hits, which is the part WSOLA is given.',
      });
    }

    // Grain shape and Pitch movement drive every engine now — a window is a
    // splice for WSOLA and an analysis frame for the vocoder, but all three
    // have a rate, a length, a place they read from and a speed they read at.
    for (const id of ['grainShape', 'grainPitch']) {
      $(id)?.classList.remove('hidden');
    }
    // Scan, Shape and Randomness reach all three engines: a window is a splice
    // for WSOLA and a frame for the vocoder, but each has a read pointer, a
    // direction, an envelope and a place in the field.
    $('extGrain')?.classList.remove('hidden');
    // Granular has no engine-specific extended groups, so this wrapper is empty
    // — and an empty flex child still takes the gap either side of it, which
    // showed as a band of nothing above the first heading.
    ext.classList.toggle('hidden', !ext.children.length);
    placeExtendedReset();
  };
  for (const b of eng.querySelectorAll('.seg-btn')) {
    b.onclick = () => {
      state.stretchDraft.algorithm = b.dataset.alg;
      reflectEngine();
      commitStretch();
    };
    // Double-click resets everything, standard and extended, which is what the
    // button that used to sit at the end of this row did.
    //
    // The engine you land on is where you were already going: the first click
    // selects, and reset deliberately does not move you somewhere else — see
    // `resetEverything`. So double-clicking the tab you are on resets in place,
    // and double-clicking another one arrives there with the controls fresh.
    //
    // Undoable like any other edit, because it goes through `editOp`.
    b.ondblclick = () => { resetEverything(); };
  }
  reflectEngine();


  const rows = {};
  rows.ratio = tip(param('Stretch', st.ratio, 0.01, 100, 0.01,
    (v) => (v >= 10 ? `${v.toFixed(0)}×` : v >= 1 ? `${v.toFixed(2)}×` : `${v.toFixed(3)}×`),
    (v) => { state.stretchDraft.ratio = v; showStretchOut(); previewStretch();  },
    () => {commitStretch();}, true, 1),
        'How much longer the result is than the source. 1x is untouched, 0.5x is half the length, 100x is the point of a granular stretcher. Logarithmic, so the everyday range is not squeezed into the first tenth of the slider.');
  // The step is the finest the *scale* offers, so dragging cannot land
  // between two degrees and then be snapped back on release. With no scale
  // chosen it stays where it has always been: half a semitone.
  rows.semitones = tip(param('Pitch', st.semitones, -48, 48, scaleStep(),
    (v) => scaleLabel(v),
    (v) => { state.stretchDraft.semitones = v; previewStretch();  },
    () => {commitStretch();}, false, 0),
        'Shifts the pitch without changing the length. The engine is driven at ratio x pitch and the result read back that much faster, and the two length changes cancel. Twelve semitones is an octave. The tuning it snaps to is chosen on the row above.');
  // Log too: 40 ms is the everyday setting and second-long grains are the
  // extreme, so a linear control would bunch the useful range at one end.
  rows.windowMs = tip(param('Window', st.windowMs, 5, 2000, 1, (v) => `${Math.round(v)} ms`,
    (v) => { state.stretchDraft.windowMs = v; previewStretch();  },
    () => {commitStretch();}, true, 40),
        'The length of one piece the engine works with - a splice for WSOLA, a grain for the cloud. Short follows transients and roughens tone; long holds tone together and smears attacks.');

  // Into the core host, which sits directly under the button row — not appended
  // to the end of the panel, which is what put them below the engine's own
  // sliders.
  const core = box.querySelector('.stretch-core') || box;
  core.innerHTML = '';
  for (const el of Object.values(rows)) core.appendChild(el);
  state.stretchRows = rows;
  showStretchOut();
}

/// The granular controls. Separate from the stretch sliders because they only
/// matter once one of them is engaged, but built the same way.
function renderGrainParams() {
  if (!$('grainShape')) return;
  const g = state.edit?.stretch?.grain;
  const path = state.selectedFile?.path || null;
  if (!g) { grainBuiltFor = null; return; }
  // Keyed on the engine as well as the file: the sixth engine adds two rows of
  // its own, so switching to or from it has to rebuild the panel. Keying on the
  // file alone meant they only appeared after opening a different sound.
  const alg = state.edit?.stretch?.algorithm || '';
  const key = `${path}\u0000${alg}`;
  if (grainBuiltFor === key) return;

  grainBuiltFor = key;
  const shape = $('grainShape');
  const pitchBox = $('grainPitch');
  shape.innerHTML = ''; pitchBox.innerHTML = '';
  // The seed has no control of its own. It stays part of the document and is
  // carried through untouched by this spread, so the engine keeps using it.
  state.grainDraft = { ...g };

  const send = ({ live }) => {
    editOp({ op: 'stretch',
             ratio: state.stretchDraft.ratio,
             semitones: state.stretchDraft.semitones,
             windowMs: state.stretchDraft.windowMs,
             quality: live ? 'draft' : state.stretchDraft.quality,
             algorithm: state.stretchDraft.algorithm,
             vocoder: state.stretchDraft.vocoder,
             wsola: state.stretchDraft.wsola,
             pvsola: state.stretchDraft.pvsola,
             hybrid: state.stretchDraft.hybrid,
             grain: state.grainDraft },
           { live });
  };
  const preview = throttled(() => send({ live: true }), 90);
  const commit = () => send({ live: false });
  // Reachable from the cloud pad, which moves these same values by dragging.
  state.grainSend = { preview, commit };

  // Grouped by what they do, so each panel stays short enough to read at once.
  const groups = [
    [shape, 'Grain shape',
     'How often something is laid down, how long it is, how many of them, and how much any of that varies. Every engine answers these — a window is a splice for WSOLA and an analysis frame for the vocoder.', [
      ['Position', 'position', -1, 1, 0.001, (v) => `${(v * 100).toFixed(1)}%`,
       'Where in the source the cloud reads from, as a fraction of the file. Measured from where the sweep begins — the start going forwards, the end going backwards — so zero is the ordinary sweep. Turn Scan down to nothing and this is the whole instrument: the read head parks wherever you put it and the cloud is made from that one place. Automate it and the head skips around under its own hand.'],
      ['Rate', 'rateHz', 0, 500, 1, (v) => (v <= 0 ? 'off' : `${Math.round(v)}/s`),
       'Grains per second, for the cloud alone — how often a grain is thrown, with nothing to do with how long it lasts. A grain is an event: it is spawned, it sounds for as long as it sounds, and it ends, and none of that waits on the one before it. So the same number are laid down every second whether they are five milliseconds long or two. Off, the old rule applies and the rate comes from the window instead, which is why lengthening a grain used to thin the cloud. This control is the cloud’s own and does not touch WSOLA, the vocoder, PVSOLA or the hybrid — Density does, and reaching into them is what it costs.'],
      ['Density', 'densityHz', 0, 500, 1, (v) => (v <= 0 ? 'auto' : `${Math.round(v)}/s`),
       'How often a window is laid down, in windows per second. Read by every engine, so it is the *window* engines’ control as much as the cloud’s; for the cloud alone use Rate above. On “auto” the rate comes from the window length divided by Overlap instead, which is what keeps the sound even as the window changes.'],
      ['Layers', 'layers', 1, 16, 1, (v) => `${Math.round(v)}×`,
       'How many copies of the whole engine run at once, each reading its own place in the source. Level is compensated by the square root of the count, which is exact once Scatter or the jitters have decorrelated them.'],
      ['Overlap', 'overlap', 1, 8, 0.1, (v) => `${v.toFixed(1)}×`,
       'How many windows cover any one moment. Only read while Density is on “auto”. More overlap is smoother and more expensive; at 1x the windows are laid end to end.'],
      ['Size jitter', 'sizeJitter', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`,
       'How much each window’s length varies around Window. Size range sets how far the variation may reach.'],
      ['Position jitter', 'positionJitterMs', 0, 500, 1, (v) => `${Math.round(v)} ms`,
       'How far each window may be thrown from the instant it should have read. This is what turns a line of windows into a cloud.'],
    ]],
    [pitchBox, 'Pitch movement',
     'Pitch that changes while the sound plays, as against the fixed shift on the Pitch slider. Jitter is per grain; drift is shared by the whole cloud.', [
      ['Pitch jitter', 'pitchJitterSemis', 0, 24, 0.1, (v) => `±${v.toFixed(1)} st`,
       'A fresh random shift for every grain, up to this far either way. Small amounts thicken; large amounts scatter the sound across the keyboard.'],
      ['Pitch drift', 'pitchDriftSemis', 0, 24, 0.1, (v) => `±${v.toFixed(1)} st`,
       'A slow wander in pitch shared by the whole cloud, up to this far either way. Vibrato at the small end, seasickness at the large.'],
      ['Drift rate', 'driftRateHz', 0.01, 10, 0.01, (v) => `${v.toFixed(2)} Hz`,
       'How fast that wander moves, in cycles per second. “Step the drift” turns the glide into jumps.'],
    ]],
  ];

  state.grainRows = {};
  for (const [target, heading, blurb, rows] of groups) {
    const group = wild(heading, blurb);
    for (const [label, key, min, max, step, fmt, hint] of rows) {
      const el = tip(param(label, g[key], min, max, step, fmt,
        (v) => { state.grainDraft[key] = v; preview();  },
        () => {commit();}, false, GRAIN_DEFAULTS[key]), hint);
      state.grainRows[key] = el;
      group.add(el);
    }
    target.appendChild(group);
  }

  /// `detent` is a value the control snaps to when it comes close.
  ///
  /// For a control whose middle means something. Envelope's 0.5 is the only
  /// value that gives a pure Hann — every other setting warps the shape — so
  /// "symmetric" is not one label of three, it is *the* shape the other two are
  /// departures from.
  ///
  /// **The band is sized in pixels, not in steps**, because these sliders are
  /// 56 px wide. At a step of 0.01 that is half a pixel per step: exactly one
  /// position out of a hundred and one gave a Hann, and no hand can land on it.
  /// A first attempt at this snapped within two steps and was still barely more
  /// than a pixel — measurably better and still unusable. Six per cent of the
  /// range is about three and a half pixels either side, which is a target.
  const DETENT_FRAC = 0.06;
  const gp = (label, key, min, max, step, fmt, log, detent) => {
    const band = (max - min) * DETENT_FRAC;
    const snap = (v) =>
      (detent !== undefined && Math.abs(v - detent) <= band ? detent : v);
    const el = param(label, state.grainDraft[key], min, max, step, fmt,
      (v) => {
        const s = snap(v);
        // Move the handle too when it snapped, or the reading and the control
        // disagree — which is the fault this whole panel was audited for.
        if (s !== v) el.sync(s);
        state.grainDraft[key] = s;
        preview();
      },
      (v) => { state.grainDraft[key] = snap(v); commit(); }, log,
      GRAIN_DEFAULTS[key]);
    state.grainRows[key] = el;
    return el;
  };
  const gc = (label, key, title) => {
    const el = check(label, title, state.grainDraft[key],
      (on) => { state.grainDraft[key] = on; commit(); });
    state.grainRows[key] = el;
    return el;
  };

  // The extended grain controls join the engines' in the one column, rather
  // than hiding at the bottom of two different panels.
  const extGrain = $('extGrain');
  extGrain.innerHTML = '';

  // The read pointer's relationship to the ratio, which is what makes a stretch
  // a stretch. Severing it is the difference between a granular stretcher and a
  // granular instrument.
  extGrain.appendChild(wild('Scan',
    'Where in the source the cloud reads from, and which way each grain runs.').add(
    tip(gp('Scan', 'scan', -2, 2, 0.01,
      (v) => (Math.abs(v) < 0.005 ? 'frozen' : `${v.toFixed(2)}×`)),
        'How fast the read pointer moves through the source relative to the output. 1x is an ordinary stretch, 0 freezes on one instant, and negative runs the source backwards under a forward-moving cloud. Severing this from the ratio is the difference between a stretcher and an instrument.'),
    pair(
      gc('reverse grains', 'reverse',
        'Each grain reads its own span backwards. The cloud still moves forward.'),
      gc('wrap positions', 'wrap',
        'A grain pushed past the end of the file reappears at the beginning instead of piling up against it.'),
    ),
  ));

  extGrain.appendChild(wild('Shape',
    'The grain envelope, how far sizes may reach, and where the layers sit.').add(
    tip(gp('Envelope', 'envelope', 0, 1, 0.01,
      (v) => (Math.abs(v - 0.5) < 0.005 ? 'symmetric' : v < 0.5 ? 'percussive' : 'swelling'),
      false, 0.5),
        'The shape each window is laid down under. Symmetric is a bell; percussive is a sharp attack and a long tail; swelling is the reverse.'),
    tip(gp('Size range', 'sizeRange', 1, 8, 0.05, (v) => `${v.toFixed(2)}×`),
        'How far Size jitter is allowed to reach, as a multiple of the window. Inert until there is some jitter to reach with.'),
    tip(gp('Layer spread', 'layerSpread', 0, 4, 0.01,
      (v) => (v <= 0.005 ? 'stacked' : `${v.toFixed(2)}×`)),
        'How far each layer is delayed behind the one before, as a share of a hop. It is also what keeps sixteen layers from all transforming on the same block.'),
    tip(gp('Pan spread', 'panSpread', 0, 1, 0.01, (v) => (v <= 0 ? 'centred' : `${Math.round(v * 100)}%`)),
        'How far apart the grains are placed across the stereo field. At zero everything is centred.'),
  ));

  // Layers on their own are a delay line, not a cloud: without this every
  // layer reads the same instant and is laid down a fixed offset later, and
  // regular delays make regular notches. These two throw each layer somewhere
  // else in the source so the layers are different audio rather than copies.
  extGrain.appendChild(wild('Layer scatter',
    'How far each layer is thrown from the others. At zero they all read the same instant and comb; turned up they read their own places and sum like a crowd. Reaches every engine.').add(
    tip(gp('Scatter', 'layerScatter', 0, 1, 0.01,
      (v) => (v <= 0 ? 'stacked' : `${Math.round(v * 100)}%`)),
        'How far each layer is thrown from the others. At zero every layer reads the same instant and the stack is a delay line, which combs - sixteen layers made the sound thinner, not fuller. Turned up they read their own places and sum like a crowd. Layer zero never moves.'),
    // Log, because the useful range is tens of milliseconds — a chorus — and
    // the far end is a second, which is a wash. Linear would bunch everything
    // worth reaching into the first tenth of the slider.
    tip(gp('Range', 'layerScatterMs', 1, 2000, 1,
      (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`), true),
        'How far a thrown layer may land from where it would otherwise have read. Tens of milliseconds is a chorus; a second is a wash. Logarithmic, because everything worth reaching is at the bottom of the range.'),
  ));

  // The seed used to have no control at all. It is the one value here that
  // changes everything at once without changing any setting.
  const seedRow = document.createElement('div');
  seedRow.className = 'param seed-row';
  seedRow.innerHTML = `<span class="k">Seed</span>
    <button class="ghost">Re-roll</button>
    <span class="v"></span>`;
  tip(seedRow,
    'The number every random choice here is drawn from. Each jitter is a pure function of the grain index and this seed, never a running generator — which is what makes the picture, the playback and the exported file the same sound. Re-roll re-deals the whole cloud without moving a single slider.');
  seedRow.querySelector('button').title =
    'Draw a new seed. Every jitter changes at once; no setting does.';
  const showSeed = () => {
    seedRow.querySelector('.v').textContent = state.grainDraft.seed;
  };
  seedRow.querySelector('button').onclick = () => {
    // Every jitter is a pure function of the grain index and this number, so
    // one new number re-deals the whole cloud without moving a single slider.
    state.grainDraft.seed = (state.grainDraft.seed * 1664525 + 1013904223) % 2147483647;
    showSeed();
    commit();
  };
  showSeed();
  seedRow.sync = showSeed;
  state.grainRows.seed = seedRow;

  extGrain.appendChild(wild('Randomness',
    'Where the per-grain variation comes from, and whether the streams move together.').add(
    pair(
      gc('link jitter', 'linkJitter',
        'Size, position and pitch draw from one stream instead of three, so they vary together.'),
      gc('step the drift', 'driftStep',
        'Drift jumps between values instead of gliding through them.'),
    ),
    seedRow,
  ));

  // This rebuild replaced whatever the reset was sitting on.
  placeExtendedReset();
  // The pad draws the source behind the cloud, and that envelope is fetched
  // once per file by the same call the automation lanes use.
  loadLaneWave();
  wireCloudPad();
  drawCloudPad();
}

let grainBuiltFor = null;

function syncGrainSliders() {
  const g = state.edit?.stretch?.grain;
  if (!g || !state.grainRows) return;
  state.grainDraft = { ...g };
  for (const [k, el] of Object.entries(state.grainRows)) el.sync(g[k]);
  drawCloudPad();
}

/// Push values into the sliders — used by Reset and Undo, which change the
/// document without the pointer having touched anything.
function syncStretchSliders() {
  const st = state.edit?.stretch;
  if (!st || !state.stretchRows) return;
  state.stretchDraft = { ...state.stretchDraft, ratio: st.ratio,
                         semitones: st.semitones, windowMs: st.windowMs };
  state.stretchRows.ratio.sync(st.ratio);
  state.stretchRows.semitones.sync(st.semitones);
  state.stretchRows.windowMs.sync(st.windowMs);
  if (st.quality) state.stretchDraft.quality = st.quality;

  syncGrainSliders();
  showStretchOut();
}

function showStretchOut() {
  const el = $('stretchOut');
  if (!el || !state.edit) return;
  const sr = state.view.sampleRate || 48000;
  const d = state.stretchDraft || {};
  const base = state.edit.baseFrames / sr;
  const out = (state.edit.baseFrames * (d.ratio ?? 1)) / sr;
  const semis = d.semitones ?? 0;
  const pitch = Math.abs(semis) < 0.05
    ? ''
    : ` · pitch ${semis > 0 ? '+' : ''}${semis.toFixed(1)} st`;
  el.textContent = `${base.toFixed(2)}s → ${out.toFixed(2)}s${pitch}`;
  el.title = 'Source length, then the length this will render to, and the pitch shift if there is one. '
    + 'The length follows the Stretch slider alone — pitch does not change it. '
    + 'It dims while the waveform is still catching up with the controls.';
  paintLoad();
}

/// What the engine is costing, beside the controls that cost it.
///
/// Window, layers and density are each monotonic in block cost and they
/// multiply, and no one control knows what the others are set to — so three
/// sliders that each look affordable land somewhere unplayable, with nothing on
/// screen saying so until the sound breaks up. A 300-render sweep put the
/// median randomised hybrid at three times real time. See
/// `docs/GLITCH-SWEEP.md`.
///
/// Measured in the callback, not predicted from the controls: a model would
/// need refitting every time the DSP changed and would still be guessing about
/// this machine.
function paintLoad() {
  const el = $('engineLoad');
  if (!el) return;
  const l = engine.load;
  if (!l || !engine.playing) { el.textContent = ''; el.className = 'mono dim engine-load'; return; }

  // The worst block, not the average. A mean of 40% with a spike to 150% is a
  // click every few seconds, and the mean is what hides it.
  const pct = Math.round(l.worst * 100);
  // What the governor has done, if anything. A program that quietly plays fewer
  // layers than the control says is lying about its own settings, so this is
  // said out loud rather than left to be noticed.
  const asked = state.grainDraft?.layers ?? 1;
  const thinned = asked > 1 && l.layersRunning > 0 && l.layersRunning < asked;
  el.textContent = thinned ? `load ${pct}% · ${l.layersRunning}/${asked} layers` : `load ${pct}%`;
  el.className = 'mono engine-load'
    + (thinned || l.worst >= 1 ? ' over' : l.worst >= 0.75 ? ' near' : ' dim');
  el.title = `The worst block since this was last reset, as a share of the time that block had to play for.\n`
    + `Now ${Math.round(l.now * 100)}% · average ${Math.round(l.mean * 100)}% · worst ${pct}%`
    + (l.late ? `\n${l.late} block${l.late === 1 ? '' : 's'} missed the deadline — that is what a dropout is.` : '')
    + (thinned
      ? `\n\nRunning ${l.layersRunning} of the ${asked} layers asked for: the engine could not make `
        + 'blocks fast enough, and a thinner cloud is better than a dropout. It takes them back on '
        + 'its own once there is room, or immediately if you open another sound.'
      : '')
    + '\nClick to forget the worst; it only means anything next to a change you just made.';
  el.onclick = async () => {
    if (!noAudio()) {
      try { await postJSON('/api/engine/load/reset', {}); } catch { /* not playing */ }
    }
  };
}

// ----------------------------------------------------------- automation
//
// A lane is a curve over the document's timeline, stored as unit values. The
// range belongs to the effect, so this side never converts to hertz or dB and
// never needs to know a control's limits — which is the only reason the picture
// and the sound cannot drift apart.
//
// **`saveAutomation` deliberately does not adopt the server's reply.** It used
// to: `state.automation = await postJSON(…)`. That swapped the whole object,
// and every handler `renderAutomation` had wired closes over the lane it was
// built with — so after the first save those handlers were mutating orphans.
// The first edit after a render stuck and every one after it was silently
// discarded: the target menu would read "Pitch" while the lane, and the engine,
// stayed on "Stretch". Nothing in the reply is worth that.

state.automation = { lanes: [], bypassed: false, targets: [] };

let automationTimer = null;
let automationUndo = [];
let automationRedo = [];

const newLaneId = () => `lane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/// Arm the recorder.
///
/// The server does the writing, not this file. It is the only side that knows
/// how a control's real value becomes a lane value — that mapping is searched
/// rather than inverted, and having a second copy of it here is exactly how
/// a recorded take would come to sit somewhere other than where the control
/// was. See `automation::unit_for`.
async function setAutomationRecord(mode) {
  try {
    await postJSON('/api/automation/record', { mode });
  } catch (e) {
    toast('Recording could not be armed: ' + e.message);
    return;
  }
  state.automationRecord = mode;
  const el = $('automationRecord');
  if (el) el.value = mode;
  // A take lands on the server, so the lanes here are behind until refetched.
  // While armed, keep them fresh so the curve appears as it is drawn.
  clearInterval(recordPoll);
  if (mode !== 'off') {
    recordPoll = setInterval(async () => {
      if (!engine.playing) return;
      await loadAutomation();
      renderAutomation();
    }, 400);
  }
}
let recordPoll = null;

function automationCheckpoint() {
  automationUndo.push(JSON.stringify({ lanes: state.automation.lanes, bypassed: state.automation.bypassed }));
  if (automationUndo.length > 100) automationUndo.shift();
  automationRedo = [];
}

async function loadAutomation() {
  if (!state.selectedFile) return;
  try {
    state.automation = await api(`/api/automation?p=${encodeURIComponent(state.selectedFile.path)}`);
  } catch {
    state.automation = { lanes: [], bypassed: false, targets: [] };
  }
  automationUndo = [];
  automationRedo = [];
  renderAutomation();
}

function saveAutomation() {
  clearTimeout(automationTimer);
  automationTimer = setTimeout(async () => {
    if (!state.selectedFile) return;
    try {
      await postJSON('/api/automation', {
        p: state.selectedFile.path,
        lanes: state.automation.lanes,
        bypassed: state.automation.bypassed,
      });
    } catch (e) {
      toast('Automation could not be saved: ' + e.message);
    }
  }, 120);
}

/// What the menu offers, straight from the server.
///
/// Not assembled here from `state.rack`: the list the menu shows and the list
/// playback can resolve have to be the same list, and there is only one of them.
const automationTargets = () => state.automation.targets || [];

/// Re-read the menu after the rack changes, without disturbing the lanes.
///
/// Only `targets` is taken from the reply. Adopting the whole response would
/// throw away edits made since the last save, and would re-orphan every handler
/// `renderAutomation` has wired — the bug this file is careful about.
async function refreshAutomationTargets() {
  if (!state.selectedFile) return;
  try {
    const r = await api(`/api/automation?p=${encodeURIComponent(state.selectedFile.path)}`);
    state.automation.targets = r.targets || [];
    renderAutomation();
  } catch { /* the menu is stale until the next open; the lanes are unharmed */ }
}

function automationNote() {
  const el = $('automationNote');
  if (!el) return;
  const lanes = state.automation.lanes || [];
  const live = lanes.filter((l) => l.enabled !== false && (l.points || []).length).length;
  if (state.automation.stale) {
    el.textContent = 'the file changed — the old lanes were dropped';
  } else if (state.automation.bypassed && lanes.length) {
    el.textContent = 'bypassed';
  } else {
    el.textContent = lanes.length ? `${live} live` : 'no lanes yet';
  }
}

function renderAutomation() {
  const box = $('automationLanes');
  if (!box) return;
  loadLaneWave();
  $('automationBypass').checked = !!state.automation.bypassed;
  box.innerHTML = '';
  const targets = automationTargets();

  for (const lane of state.automation.lanes || []) {
    const row = document.createElement('article');
    row.className = 'automation-lane';

    const controls = document.createElement('div');
    controls.className = 'automation-lane-controls';

    const top = document.createElement('div');
    top.className = 'row';
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = lane.enabled !== false;
    on.title = 'Whether this lane is in the signal path';
    on.onchange = () => { automationCheckpoint(); lane.enabled = on.checked; saveAutomation(); automationNote(); };

    const pick = document.createElement('select');
    pick.title = 'Which control this lane moves';
    for (const [value, label] of targets) {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      pick.appendChild(o);
    }
    // A lane naming something that no longer exists keeps its curve and says
    // so, rather than being silently repointed at whatever is first in the list.
    if (!targets.some(([v]) => v === lane.target)) {
      const o = document.createElement('option');
      o.value = lane.target; o.textContent = `Missing — ${lane.target}`;
      pick.appendChild(o);
    }
    pick.value = lane.target;
    pick.onchange = () => {
      automationCheckpoint();
      lane.target = pick.value;
      lane.label = pick.selectedOptions[0]?.textContent || pick.value;
      saveAutomation();
      automationNote();
    };

    const del = document.createElement('button');
    del.className = 'ghost danger';
    del.textContent = '×';
    del.title = 'Delete this lane';
    del.onclick = () => {
      automationCheckpoint();
      state.automation.lanes = state.automation.lanes.filter((x) => x !== lane);
      saveAutomation();
      renderAutomation();
    };
    top.append(on, pick, del);
    controls.appendChild(top);

    const tools = document.createElement('div');
    tools.className = 'row';
    const curve = document.createElement('select');
    curve.title = 'How the curve travels between breakpoints';
    for (const c of ['step', 'linear', 'smooth', 'exponential', 'bezier']) {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      curve.appendChild(o);
    }
    curve.value = lane.points?.[0]?.curve || 'linear';
    curve.onchange = () => {
      automationCheckpoint();
      for (const p of lane.points || []) p.curve = curve.value;
      saveAutomation();
      drawLane(canvas, lane);
    };
    tools.appendChild(curve);
    controls.appendChild(tools);

    const canvas = document.createElement('canvas');
    canvas.className = 'automation-canvas';
    canvas.width = 1200;
    canvas.height = 110;
    wireLane(canvas, lane);

    row.append(controls, canvas);
    box.appendChild(row);
    drawLane(canvas, lane);
  }
  automationNote();
}

/// The document's length, which is what a lane's frames are measured against.
const laneFrames = () => state.edit?.frames || state.view?.frames || 1;

function snapLaneFrame(frame) {
  const frames = laneFrames();
  const candidates = [];
  if (state.sel) candidates.push(state.sel.start, state.sel.end);
  for (const m of state.annotations?.markers || []) candidates.push(m.frame);
  for (const r of state.annotations?.regions || []) candidates.push(r.start, r.end);
  let best = frame;
  let near = frames * 0.006;
  for (const x of candidates) {
    if (Math.abs(x - frame) < near) { best = x; near = Math.abs(x - frame); }
  }
  return Math.round(Math.max(0, Math.min(frames, best)));
}

function wireLane(canvas, lane) {
  let drag = null;
  const nearest = (e) => {
    const r = canvas.getBoundingClientRect();
    const frames = laneFrames();
    let best = null;
    let d = 12;
    for (const p of lane.points || []) {
      const n = Math.hypot(
        e.clientX - r.left - (p.frame / frames) * r.width,
        e.clientY - r.top - (1 - p.value) * r.height,
      );
      if (n < d) { best = p; d = n; }
    }
    return best;
  };

  canvas.onpointerdown = (e) => {
    automationCheckpoint();
    canvas.setPointerCapture(e.pointerId);
    lane.points ||= [];
    drag = nearest(e);
    if (!drag) {
      drag = { frame: 0, value: 0, curve: 'linear', tension: 0 };
      lane.points.push(drag);
    }
    canvas.onpointermove(e);
  };

  canvas.onpointermove = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!drag) {
      const p = nearest(e);
      const sr = state.view?.sampleRate || 44100;
      canvas.title = p
        ? `${fmtTime(p.frame / sr)} · ${Math.round(p.value * 100)}% · ${p.curve}`
        : 'Click to add a breakpoint · drag one to move it · double-click to remove';
      return;
    }
    drag.frame = snapLaneFrame(((e.clientX - r.left) / r.width) * laneFrames());
    drag.value = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    lane.points.sort((a, b) => a.frame - b.frame);
    drawLane(canvas, lane);
  };

  canvas.onpointerup = () => {
    if (!drag) return;
    drag = null;
    // Deliberately not simplified here. A release used to run the simplifier,
    // which reduces a smooth drag to its two end points — so the breakpoints
    // you had just drawn vanished the instant you let go. Simplify is a button.
    saveAutomation();
    automationNote();
  };

  canvas.ondblclick = (e) => {
    const p = nearest(e);
    if (!p) return;
    automationCheckpoint();
    lane.points = lane.points.filter((x) => x !== p);
    saveAutomation();
    drawLane(canvas, lane);
  };
}

const curveT = (t, p) => {
  if (p.curve === 'step') return 0;
  if (p.curve === 'smooth') return t * t * (3 - 2 * t);
  if (p.curve === 'exponential') return Math.pow(t, Math.pow(2, Math.max(-2, Math.min(2, p.tension || 0))));
  if (p.curve === 'bezier') {
    const k = Math.max(0.05, Math.min(0.95, 0.5 + Math.max(-1, Math.min(1, p.tension || 0)) * 0.45));
    return t < k ? 0.5 * Math.pow(t / k, 2) : 1 - 0.5 * Math.pow((1 - t) / (1 - k), 2);
  }
  return t;
};

/// Fetch the whole-file envelope the lanes are drawn over.
///
/// Once per file, at a fixed column count — the lanes never zoom, so there is
/// nothing to refetch for. Failure is silent: a lane with no picture behind it
/// is the lane as it was, and a toast for a decoration would be noise.
const LANE_WAVE_COLUMNS = 900;
let laneWaveFor = null;
async function loadLaneWave() {
  const f = state.selectedFile;
  if (!f) { state.laneWave = null; laneWaveFor = null; return; }
  if (laneWaveFor === f.path) return;
  laneWaveFor = f.path;
  try {
    const w = await api(`/api/peaks?p=${encodeURIComponent(f.path)}&cols=${LANE_WAVE_COLUMNS}`);
    // The file may have been changed out during the await.
    if (laneWaveFor !== f.path) return;
    state.laneWave = w;
  } catch { state.laneWave = null; }
  repaintAutomationLanes();
}

/// The sound itself, behind the curve.
///
/// Breakpoints are placed against what is being heard, and doing that from a
/// clock reading alone means counting seconds against a waveform in another
/// part of the window. Drawn dim and mono — it is a reference, and it must not
/// compete with the line the lane is actually for.
function drawLaneWave(c, w, h, frames) {
  const p = state.laneWave;
  if (!p || !p.channels?.length) return;
  const cols = p.channels[0].max?.length || 0;
  if (!cols) return;

  // Drawn across the whole lane rather than at the source's own scale. The lane
  // counts output frames, and the output *is* the source spread over them — at
  // eight times, a source-scaled envelope would huddle into the first eighth of
  // a lane whose audio runs the full width.
  //
  // The alternative was to ask the server for the edited timeline, which is
  // exact. It also renders the whole stretched document through the rack — four
  // minutes of audio for a thirty-second file at eight times — and would go
  // stale on every move of the ratio. This is cheap, never stale, and right for
  // everything except a document with material cut out of it.
  const mid = h / 2;
  const half = h / 2 * 0.86;

  // This is audio, so it takes `--wave` like every other waveform in the
  // program. It was a hardcoded blue, which is why it stayed blue when the
  // waveform colour changed and the lanes did not.
  c.fillStyle = waveInk();
  withAlpha(c, 0.13, () => {
    c.beginPath();
    c.moveTo(0, mid);
    for (let i = 0; i < cols; i++) {
      let hi = 0;
      for (const ch of p.channels) hi = Math.max(hi, Math.abs(ch.max[i]), Math.abs(ch.min[i]));
      c.lineTo((i / (cols - 1)) * w, mid - hi * half);
    }
    for (let i = cols - 1; i >= 0; i--) {
      let hi = 0;
      for (const ch of p.channels) hi = Math.max(hi, Math.abs(ch.max[i]), Math.abs(ch.min[i]));
      c.lineTo((i / (cols - 1)) * w, mid + hi * half);
    }
    c.closePath();
    c.fill();
  });
}

function drawLane(canvas, lane) {
  const c = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const frames = laneFrames();
  const sr = state.view?.sampleRate || 44100;
  c.clearRect(0, 0, w, h);

  drawLaneWave(c, w, h, frames);

  c.strokeStyle = '#22303d';
  c.fillStyle = 'rgba(220,228,235,.45)';
  c.font = '9px ui-monospace';
  for (let i = 0; i <= 8; i++) {
    const x = (i * w) / 8;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
    if (i < 8) c.fillText(fmtTime((frames * i) / 8 / sr), x + 3, 10);
  }
  for (const m of state.annotations?.markers || []) {
    const x = (m.frame / frames) * w;
    c.strokeStyle = 'rgba(244,190,73,.45)';
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }

  const p = (lane.points || []).slice().sort((a, b) => a.frame - b.frame);
  const dim = lane.enabled === false || state.automation.bypassed;
  c.strokeStyle = dim ? '#3d5162' : '#52a8ff';
  c.fillStyle = c.strokeStyle;
  c.lineWidth = 2;

  if (p.length) {
    c.beginPath();
    // A lane holds its end values, so the line is drawn flat out to both edges
    // rather than stopping where the drawing stopped. The curve goes on meaning
    // something past its last breakpoint, and it should look like it.
    c.moveTo(0, (1 - p[0].value) * h);
    c.lineTo((p[0].frame / frames) * w, (1 - p[0].value) * h);
    for (let i = 0; i < p.length - 1; i++) {
      for (let n = 1; n <= 24; n++) {
        const t = n / 24;
        const k = curveT(t, p[i]);
        c.lineTo(
          ((p[i].frame + (p[i + 1].frame - p[i].frame) * t) / frames) * w,
          (1 - (p[i].value + (p[i + 1].value - p[i].value) * k)) * h,
        );
      }
    }
    const last = p[p.length - 1];
    c.lineTo((last.frame / frames) * w, (1 - last.value) * h);
    c.lineTo(w, (1 - last.value) * h);
    c.stroke();

    for (const [i, v] of p.entries()) {
      const x = (v.frame / frames) * w;
      const y = (1 - v.value) * h;
      c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#071018';
      c.font = 'bold 8px ui-monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(i + 1), x, y);
      c.fillStyle = c.strokeStyle;
      c.textAlign = 'start';
      c.textBaseline = 'alphabetic';
    }
  }

  if (engine.playing) {
    const x = (sourceFrameNow() / frames) * w;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
}

function repaintAutomationLanes() {
  const rows = document.querySelectorAll('.automation-lane');
  if (!rows.length) return;
  rows.forEach((row, i) => {
    const lane = state.automation.lanes?.[i];
    const canvas = row.querySelector('.automation-canvas');
    if (lane && canvas) drawLane(canvas, lane);
  });
}

/// Drop breakpoints the curve does not need, within `tol` of full scale.
function simplifyLane(lane, tol = 0.012) {
  const p = lane.points || [];
  if (p.length < 3) return;
  const keep = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = keep[keep.length - 1];
    const b = p[i + 1];
    const x = (p[i].frame - a.frame) / Math.max(1, b.frame - a.frame);
    if (Math.abs(p[i].value - (a.value + (b.value - a.value) * x)) > tol) keep.push(p[i]);
  }
  keep.push(p[p.length - 1]);
  lane.points = keep;
}

$('automationAdd').onclick = () => {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const targets = automationTargets();
  if (!targets.length) { toast('Nothing to automate yet'); return; }
  automationCheckpoint();
  const [target, label] = targets[0];
  state.automation.lanes.push({
    id: newLaneId(), target, label, enabled: true, trim: 0, loop: null,
    // Two points, not one: a lane with a single breakpoint is a constant, and
    // looks identical whatever you do to it until you add a second.
    points: [{ frame: 0, value: 0.5, curve: 'linear', tension: 0 },
             { frame: laneFrames(), value: 0.5, curve: 'linear', tension: 0 }],
    modulators: [],
  });
  saveAutomation();
  renderAutomation();
};

$('automationBypass').onchange = (e) => {
  automationCheckpoint();
  state.automation.bypassed = e.target.checked;
  saveAutomation();
  renderAutomation();
};

$('automationRecord').onchange = (e) => setAutomationRecord(e.target.value);

$('automationSimplify').onclick = () => {
  automationCheckpoint();
  for (const l of state.automation.lanes) simplifyLane(l);
  saveAutomation();
  renderAutomation();
};

$('automationInvert').onclick = () => {
  automationCheckpoint();
  for (const l of state.automation.lanes) for (const p of l.points || []) p.value = 1 - p.value;
  saveAutomation();
  renderAutomation();
};

$('automationLoop').onclick = () => {
  if (!state.sel) { toast('Make a selection first'); return; }
  automationCheckpoint();
  for (const l of state.automation.lanes) l.loop = [state.sel.start, state.sel.end];
  saveAutomation();
  toast('Lanes now loop over the selection');
};

$('automationUndo').onclick = () => {
  const s = automationUndo.pop();
  if (!s) return;
  automationRedo.push(JSON.stringify({ lanes: state.automation.lanes, bypassed: state.automation.bypassed }));
  Object.assign(state.automation, JSON.parse(s));
  saveAutomation();
  renderAutomation();
};

$('automationRedo').onclick = () => {
  const s = automationRedo.pop();
  if (!s) return;
  automationUndo.push(JSON.stringify({ lanes: state.automation.lanes, bypassed: state.automation.bypassed }));
  Object.assign(state.automation, JSON.parse(s));
  saveAutomation();
  renderAutomation();
};

// ---------------------------------------------------------------- tuning
//
// The pitch control moves in semitones, and in half-semitone steps when left
// alone — a grid, not a tuning. A scale replaces that grid with real intervals
// in true cents, so a maqam's neutral third lands at 355 and not at 300 or 400
// because that is what a piano has.
//
// The scale is quantising the *shift*, not an absolute pitch. This transposes
// a recording rather than playing notes, so there is no key to be in: what a
// scale usefully says here is which intervals you may move by.

state.scales = null;          // the library, once fetched
state.scaleMenuOpen = false;

async function loadScales() {
  if (state.scales) return state.scales;
  try { state.scales = (await api('/api/scales')).groups || []; }
  catch { state.scales = []; }
  return state.scales;
}

const currentScale = () => state.edit?.stretch?.scale || '';
/// The grid when no scale is chosen. Zero is free.
const currentStep = () => {
  const v = state.edit?.stretch?.pitchStep;
  return v === undefined || v === null ? 0 : v;
};

/// The finest step the chosen scale offers, in semitones.
///
/// So the slider itself moves between degrees rather than sliding freely and
/// being pulled back on release, which feels like the control fighting you.
function scaleStep() {
  const name = currentScale();
  // No scale: the plain grid, and zero means the slider is continuous. The
  // finest a range input will take is what limits "free" in practice.
  if (!name) return currentStep() > 0 ? currentStep() : 0.001;
  for (const g of state.scales || []) {
    for (const s of g.scales) {
      if (s.name !== name) continue;
      let finest = s.span;
      for (let i = 1; i < s.cents.length; i++) finest = Math.min(finest, s.cents[i] - s.cents[i - 1]);
      finest = Math.min(finest, s.span - s.cents[s.cents.length - 1]);
      return Math.max(0.01, finest / 100);
    }
  }
  return 0.5;
}

/// Semitones, and the degree it lands on when a scale is chosen.
function scaleLabel(v) {
  const sign = v >= 0 ? '+' : '';
  const name = currentScale();
  // Free shows the extra decimals, because hiding them would make a continuous
  // control look like it was still snapping.
  if (!name) return currentStep() > 0
    ? `${sign}${v.toFixed(1)} st`
    : `${sign}${v.toFixed(2)} st · ${sign}${Math.round(v * 100)}¢`;
  const cents = Math.round(v * 100);
  return `${sign}${v.toFixed(2)} st · ${sign}${cents}¢`;
}

/// The row the engine's switches and the tuning share.
const engineSwitches = () => document.querySelector('.engine-switches');

/// The Keys window, opened from beside the tuning it follows.
function keysButton() {
  const b = document.createElement('button');
  // Its own kind. Everything else on this row sets a value; this opens a
  // window, and a button that opens a window should not look like a button that
  // changes a setting.
  b.className = 'popout-btn';
  b.innerHTML = 'Keys <i class="popout-mark">⧉</i>';
  b.title = 'Play the pitch from the computer keyboard. A is the tonic, the row '
    + 'above plays the notes between, Z and X shift an octave and latch. '
    + 'The notes follow whichever tuning is chosen.';
  // A toggle: it is a panel you leave up, so the way you put it away is the
  // same button you got it with.
  b.onclick = (e) => { e.stopPropagation(); (keyboardOpen() ? closeKeyboard : openKeyboard)(); };
  return b;
}

function scaleButton() {
  const b = document.createElement('button');
  b.className = 'scale-btn' + (currentScale() ? ' on' : '');
  // A caret, because this opens a menu. Keys carries a window mark instead:
  // one says "a list is coming", the other says "a window is coming", and they
  // are not the same promise.
  const name = fitLabel(currentScale() || (currentStep() > 0 ? `${currentStep()} st grid` : 'free'));
  b.innerHTML = `<span class="scale-name"></span><i class="menu-caret">▾</i>`;
  b.querySelector('.scale-name').textContent = name;
  b.title = currentScale()
    ? `${currentScale()} — snap the pitch shift to a tuning`
    : 'Snap the pitch shift to a tuning';
  b.onclick = (e) => { e.stopPropagation(); openScaleMenu(b); };
  return b;
}

/// The scale menu: every scale, grouped, with a filter across all of them.
///
/// It used to open with the categories collapsed. That is a tidy list and a
/// dishonest one — eighty-one scales showed as seven rows, and the library
/// looked like it held seven things. Grouping is worth having; hiding is not.
/// So the groups are headings you can fold rather than doors you must open,
/// everything is showing when it opens, and the count is on the front of it.
async function openScaleMenu(anchor) {
  const groups = await loadScales();
  const total = groups.reduce((n, g) => n + g.scales.length, 0);
  const pop = $('menuPop');
  pop.innerHTML = '';
  pop.classList.remove('hidden');
  pop.classList.add('scale-pop');

  const head = document.createElement('div');
  head.className = 'scale-head';
  const count = document.createElement('span');
  count.className = 'scale-count';
  count.textContent = `${total} scales`;
  const filter = document.createElement('input');
  filter.className = 'filter-box';
  filter.placeholder = 'filter…';
  head.append(count, filter);
  pop.appendChild(head);

  const list = document.createElement('div');
  list.className = 'scale-cats';
  pop.appendChild(list);

  // The two answers that are not a scale. Free is the raw slider value; the
  // grid is what this control has always done.
  const plain = [
    ['Free — no quantising', 'the default \u2014 the slider\u2019s own value, unrounded', 0],
    ['Semitone grid', 'twelve to the octave', 1],
    ['Half-semitone grid', 'twenty-four to the octave', 0.5],
  ];
  for (const [label, info, step] of plain) {
    const item = document.createElement('button');
    const on = !currentScale() && currentStep() === step;
    item.className = 'scale-item' + (on ? ' selected' : '');
    const n = document.createElement('span'); n.className = 'sc-name'; n.textContent = label;
    const i = document.createElement('span'); i.className = 'sc-info'; i.textContent = info;
    item.append(n, i);
    item.dataset.name = label.toLowerCase();
    item.dataset.info = info.toLowerCase();
    item.onclick = () => pickScale('', step);
    list.appendChild(item);
  }

  for (const g of groups) {
    const cat = document.createElement('div');
    cat.className = 'scale-cat';
    const title = document.createElement('button');
    title.className = 'scale-cat-head';
    const body = document.createElement('div');
    body.className = 'scale-cat-body';
    const mark = () => { title.textContent = `${body.classList.contains('hidden') ? '▸' : '▾'} ${g.category}  (${g.scales.length})`; };

    for (const sc of g.scales) {
      const item = document.createElement('button');
      item.className = 'scale-item' + (sc.name === currentScale() ? ' selected' : '');
      const n = document.createElement('span'); n.className = 'sc-name'; n.textContent = sc.name;
      const i = document.createElement('span'); i.className = 'sc-info';
      i.textContent = `${sc.degrees} degrees · ${sc.info}`;
      item.append(n, i);
      item.dataset.name = sc.name.toLowerCase();
      item.dataset.info = (sc.info || '').toLowerCase();
      item.onclick = () => pickScale(sc.name);
      body.appendChild(item);
    }
    // Folding is a choice, not the starting state.
    title.onclick = () => { body.classList.toggle('hidden'); mark(); };
    mark();
    cat.append(title, body);
    list.appendChild(cat);
  }

  // The filter reaches across every category at once, which is the only way to
  // find one scale among eighty-one without knowing which family it is in.
  filter.oninput = () => {
    const q = filter.value.trim().toLowerCase();
    for (const cat of list.querySelectorAll('.scale-cat')) {
      let shown = 0;
      for (const item of cat.querySelectorAll('.scale-item')) {
        const hit = !q || item.dataset.name.includes(q) || item.dataset.info.includes(q);
        item.classList.toggle('hidden', !hit);
        if (hit) shown++;
      }
      cat.classList.toggle('hidden', shown === 0);
      if (q) cat.querySelector('.scale-cat-body').classList.remove('hidden');
    }
    count.textContent = q
      ? `${list.querySelectorAll('.scale-item:not(.hidden)').length} shown`
      : `${total} scales`;
  };
  filter.onkeydown = (e) => e.stopPropagation();

  // Placed after it is in the document, so its real height is known. Below the
  // button when there is room and above it when there is not — the pitch row
  // sits low in the panel, and a menu that runs off the bottom of the window
  // is a menu you cannot use.
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(6, Math.min(window.innerWidth - 340, r.left))}px`;
  pop.style.top = '0px';
  const h = pop.offsetHeight;
  const below = window.innerHeight - r.bottom - 8;
  pop.style.top = h <= below
    ? `${r.bottom + 4}px`
    : `${Math.max(6, Math.min(r.top - h - 4, window.innerHeight - h - 6))}px`;
  list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });

  state.scaleMenuOpen = true;
  setTimeout(() => document.addEventListener('pointerdown', closeScaleMenu, { once: true }), 0);
}

function closeScaleMenu(e) {
  if (!state.scaleMenuOpen) return;
  // A click inside the menu is not a click away from it — typing in the filter
  // or folding a category has to leave it open.
  if (e && $('menuPop').contains(e.target)) {
    document.addEventListener('pointerdown', closeScaleMenu, { once: true });
    return;
  }
  state.scaleMenuOpen = false;
  const pop = $('menuPop');
  pop.classList.add('hidden');
  pop.classList.remove('scale-pop');
}

async function pickScale(name, step) {
  closeScaleMenu();
  if (!state.selectedFile) return;
  // Posted with the current pitch, so choosing a scale snaps what is already
  // set rather than waiting for the next time the slider is touched.
  state.stretchDraft.scale = name;
  await editOp({ op: 'stretch',
                 ratio: state.stretchDraft.ratio,
                 semitones: state.stretchDraft.semitones,
                 windowMs: state.stretchDraft.windowMs,
                 quality: state.stretchDraft.quality,
                 algorithm: state.stretchDraft.algorithm,
                 vocoder: state.stretchDraft.vocoder,
                 wsola: state.stretchDraft.wsola,
                 pvsola: state.stretchDraft.pvsola,
                 hybrid: state.stretchDraft.hybrid,
                 grain: state.grainDraft,
                 scale: name,
                 ...(step === undefined ? {} : { pitchStep: step }) },
               { live: false });
  stretchBuiltFor = null;
  renderStretch();
}

// ------------------------------------------------------------- recording
//
// The one place audio enters this program from outside. Everything else reads
// a file; this makes one, and it is the only feature that can lose something
// that never existed anywhere else. So the panel is deliberately explicit
// about state — armed is not recording, and a take that dropped a block says
// so rather than being quietly shorter than the performance was.

const rec = { armed: false, recording: false, timer: null, seconds: 0 };

async function recordState() {
  try { return await api('/api/record'); } catch { return null; }
}

async function recordPost(body) {
  try { return await postJSON('/api/record', body); }
  catch (e) { toast(e.message); return null; }
}

function recordPanelShown(on) {
  clearInterval(rec.timer);
  rec.timer = null;
  if (!on) return;
  refreshRecord();
  // Fast enough that a level meter is useful, slow enough to be free.
  rec.timer = setInterval(refreshRecord, 100);
}

async function refreshRecord() {
  const st = await recordState();
  if (!st) return;
  rec.armed = !!st.armed;
  rec.recording = !!st.recording;

  const devices = st.devices || null;
  if (devices) {
    const sel = $('recDevice');
    const current = sel.value;
    if (sel.options.length !== devices.length
        || [...sel.options].some((o, i) => o.value !== devices[i])) {
      sel.innerHTML = '';
      for (const d of devices) {
        const o = document.createElement('option');
        o.value = d; o.textContent = d;
        sel.appendChild(o);
      }
      if (devices.includes(current)) sel.value = current;
    }
  }
  drawRecordPanel(st);
}

function drawRecordPanel(st) {
  $('recDevice').disabled = rec.armed;
  $('recArm').textContent = rec.armed ? 'Disarm' : 'Arm';
  $('recArm').disabled = rec.recording;
  $('recStart').classList.toggle('hidden', !rec.armed || rec.recording);
  $('recStop').classList.toggle('hidden', !rec.recording);
  $('recNameRow').classList.toggle('hidden', !rec.armed);

  // A peak meter in dB, because a linear one spends most of its travel in the
  // top 6 dB and tells you nothing about where you actually are.
  const height = (v) => `${Math.max(0, Math.min(100, (20 * Math.log10(Math.max(v || 0, 1e-4)) + 60) / 60 * 100))}%`;
  $('recBarL').style.setProperty('--rec', height(st.left));
  $('recBarR').style.setProperty('--rec', height(st.right));
  const hot = Math.max(st.left || 0, st.right || 0) >= 0.99;
  $('recMeter').classList.toggle('hot', hot);

  const out = $('recReadout');
  if (!rec.armed) { out.textContent = 'not armed'; out.classList.remove('warn'); return; }
  const secs = st.seconds || 0;
  const left = Math.max(0, (st.maxSeconds || 0) - secs);
  const bits = [
    rec.recording ? `● ${fmtTime(secs)}` : 'armed',
    `${st.channels || 0} ch · ${Math.round((st.sampleRate || 0) / 100) / 10} kHz`,
  ];
  if (rec.recording) bits.push(`${fmtTime(left)} left`);
  // Never smoothed over: a take with a hole in it cannot be done again, and
  // finding out afterwards is the worst way to find out.
  if (st.overruns > 0) bits.push(`${st.overruns} dropped`);
  out.textContent = bits.join('  ·  ');
  out.classList.toggle('warn', st.overruns > 0 || hot);
}

$('recArm').onclick = async () => {
  if (rec.armed) { await recordPost({ action: 'disarm' }); await refreshRecord(); return; }
  const device = $('recDevice').value || undefined;
  const st = await recordPost({ action: 'arm', device });
  if (st) await refreshRecord();
};

$('recStart').onclick = async () => {
  if (await recordPost({ action: 'start' })) await refreshRecord();
};

$('recStop').onclick = async () => {
  const name = $('recName').value.trim();
  const done = await recordPost({ action: 'stop', ...(name ? { name } : {}) });
  await refreshRecord();
  if (!done) return;
  $('recName').value = '';
  const where = done.outside
    ? 'outside the library — choose a library folder to keep takes with everything else'
    : done.rel;
  toast(`Recorded ${fmtTime(done.seconds)} → ${where}`
        + (done.overruns > 0 ? ` (${done.overruns} blocks dropped)` : ''));
  // The take is a real file now, so the browser has to be told it exists.
  // A full scan, because that is the only thing that reads a folder that was
  // not there before — `Recordings` will not exist until the first take.
  if (!done.outside) $('rescanBtn')?.click();
};

// -------------------------------------------------------------- presets
//
// A preset is settings only — no audio, no edits. Applying one lands on the
// undo stack like any other change, so it can simply be undone.

state.presets = [];

async function loadPresets() {
  try {
    const r = await api('/api/presets');
    state.presets = r.presets || [];
  } catch { state.presets = []; }
  renderPresets();
}

/// The file a preset names, as the interface's own idea of a file.
///
/// Taken from the folder listings when they have it, because those carry the
/// duration and the tags and everything else that has been learned about it.
/// Built from the path when they do not — a preset can name a sound in a folder
/// that has never been opened, and refusing to recall it for want of a listing
/// would be absurd.
function fileFromPath(path) {
  for (const files of Object.values(state.folderFiles || {})) {
    const hit = files?.find?.((f) => f.path === path);
    if (hit) return hit;
  }
  const cut = path.lastIndexOf('/');
  return {
    path,
    name: cut >= 0 ? path.slice(cut + 1) : path,
    folder: cut >= 0 ? path.slice(0, cut) : '',
  };
}

/// The real record for a path, fetching its folder if it is not loaded yet.
///
/// `fileFromPath` searches only the folders already open and otherwise invents a
/// stub carrying nothing but a path and a name. That is enough to *play* a
/// sound — the engine is loaded by path — and not nearly enough to *draw* one:
/// `selectFile` takes the sample rate from the record, so a stub gives a view of
/// zero frames, no peaks are ever fetched, and `updatePlayhead` hides the
/// playhead because there are no peaks.
///
/// Which is exactly what recalling a preset with its sound did when the sound
/// lived in a folder that had not been expanded: the audio played and the lane
/// stayed empty, showing whatever the last file had left on the canvas.
async function resolveFile(path) {
  const known = fileFromPath(path);
  if (known.sampleRate) return known;
  const cut = path.lastIndexOf('/');
  const folder = cut >= 0 ? path.slice(0, cut) : '';
  try {
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    state.folderFiles = state.folderFiles || {};
    state.folderFiles[folder] = files;
    const hit = files.find((f) => f.path === path);
    if (hit) return hit;
  } catch { /* the stub below still plays, which beats refusing to open it */ }
  return known;
}

function renderPresets() {
  const sel = $('presetPick');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— none —</option>';
  for (const p of state.presets) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = current;
}

$('presetPick').onchange = async (e) => {
  const name = e.target.value;
  if (!name || !state.selectedFile) return;
  // With sound the preset brings its own file and replaces the whole chain;
  // without it only settings move, onto modules that are already there. See
  // `docs/PRESETS-WITH-SOUND.md`.
  const withSound = !!$('presetWithSound')?.checked;
  let applied;
  try {
    applied = await postJSON('/api/presets/apply',
      { name, p: state.selectedFile.path, withSound });
  } catch (err) { toast(err.message); return; }
  state.edit = applied;

  // With sound the file that is now open is the preset's, not the one that was
  // open when it was chosen, so the rest of the interface has to be told.
  if (withSound && applied.path && applied.path !== state.selectedFile.path) {
    // Resolved, not invented — a stub opens a sound that plays and cannot be
    // drawn. See `resolveFile`.
    await openInEditor(await resolveFile(applied.path));
  }

  // The sliders now disagree with the document, so rebuild them from it.
  stretchBuiltFor = null;
  grainBuiltFor = null;
  reflectEditState();
  renderStretch();
  renderGrainParams();
  loadRack();
  loadGrains();
  renderTabs();
  reloadAudioSource();
  const note = state.presets.find((p) => p.name === name)?.note;
  toast(`Applied “${name}”${withSound ? ' with its sound' : ''}${note ? ' — ' + note : ''}`);
};

$('presetSave').onclick = async () => {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const suggested = $('presetPick').value || `Preset ${state.presets.length + 1}`;
  const name = prompt('Save these settings as:', suggested);
  if (name === null || !name.trim()) return;
  // No note asked for here. Saving a preset is one decision — the name — and a
  // second dialog for a field that is nearly always left blank turns a quick
  // capture into a form. The note still exists and is still edited in the
  // preset manager, which is where a preset is looked *at* rather than made.
  try {
    const r = await postJSON('/api/presets', { name: name.trim(), note: '', p: state.selectedFile.path });
    state.presets = r.presets || [];
    renderPresets();
    $('presetPick').value = name.trim();
    toast(`Saved “${name.trim()}”`);
  } catch (e) { toast('Could not save: ' + e.message); }
};

$('presetDelete').onclick = async () => {
  const name = $('presetPick').value;
  if (!name) { toast('Pick a preset first'); return; }
  if (!confirm(`Delete the preset “${name}”? The sound itself is untouched.`)) return;
  try {
    const r = await postJSON('/api/presets/delete', { name });
    state.presets = r.presets || [];
    $('presetPick').value = '';
    renderPresets();
    toast(`Deleted “${name}”`);
  } catch (e) { toast('Could not delete: ' + e.message); }
};

// ------------------------------------------------- the preset manager
//
// A preset stores every engine's settings at once, not just the engine that
// happened to be selected when it was saved — so most of what is in one is
// invisible from the panels. This is the only place the whole of it can be
// seen, and the only place it can be changed without loading a sound, applying
// it, editing it and saving it back over itself.
//
// The rows are generated from a schema rather than written out, because there
// are about fifty of them and a hand-written list is a list that goes stale the
// next time a control is added. The schema says what kind each value is and
// nothing about its range: the server clamps every one of these on the way in,
// in the same single place the document uses, and a second set of bounds here
// would be a second thing to get wrong.

const PM_ENUMS = {
  algorithm: ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular'],
  quality: ['draft', 'standard', 'best'],
  splice: ['similar', 'different', 'loudest'],
  shape: ['hann', 'triangle', 'rect'],
};

/// Every value a preset stores, grouped the way the panels group them.
///
/// `path` is where it lives in the preset's JSON. Kinds are inferred from the
/// stored value except where an enum is named, which is the one thing a value
/// cannot tell you about itself.
const PM_SCHEMA = [
  ['Time & pitch', [
    ['stretch.ratio', 'Stretch'],
    ['stretch.semitones', 'Pitch'],
    ['stretch.windowMs', 'Window'],
    ['stretch.algorithm', 'Engine', 'algorithm'],
    ['stretch.quality', 'Quality', 'quality'],
  ]],
  ['WSOLA', [
    ['stretch.wsola.preserveTransients', 'Preserve transients'],
    ['stretch.wsola.sensitivity', 'Detector'],
    ['stretch.wsola.searchMs', 'Search'],
    ['stretch.wsola.splice', 'Pick', 'splice'],
    ['stretch.wsola.shape', 'Window', 'shape'],
    ['stretch.wsola.stride', 'Stride'],
    ['stretch.wsola.floor', 'Floor'],
    ['stretch.wsola.guardHops', 'Guard'],
  ]],
  ['Vocoder', [
    ['stretch.vocoder.windowMs', 'Analysis window'],
    ['stretch.vocoder.phaseLock', 'Phase lock'],
    ['stretch.vocoder.magFreeze', 'Freeze'],
    ['stretch.vocoder.magBlur', 'Blur'],
    ['stretch.vocoder.magGate', 'Gate'],
    ['stretch.vocoder.freqTrust', 'Freq trust'],
    ['stretch.vocoder.phaseSpread', 'Phase spread'],
    ['stretch.vocoder.peakWidth', 'Peak width'],
    ['stretch.vocoder.lockWidth', 'Lock width'],
    ['stretch.vocoder.stereoLink', 'Link stereo'],
  ]],
  ['PVSOLA', [
    ['stretch.pvsola.anchorFrames', 'Re-anchor'],
    ['stretch.pvsola.searchMs', 'Search'],
    ['stretch.pvsola.blend', 'Blend'],
  ]],
  ['Hybrid', [
    ['stretch.hybrid.harmonicLevel', 'Tone'],
    ['stretch.hybrid.percussiveLevel', 'Hits'],
    ['stretch.hybrid.residualLevel', 'Air'],
    ['stretch.hybrid.morphNoise', 'Remake noise'],
    ['stretch.hybrid.timeSpan', 'Hold'],
    ['stretch.hybrid.freqSpan', 'Spread'],
    ['stretch.hybrid.margin', 'Margin'],
    ['stretch.hybrid.fftSize', 'Resolution'],
  ]],
  ['Grain shape', [
    ['stretch.grain.rateHz', 'Rate'],
    ['stretch.grain.densityHz', 'Density'],
    ['stretch.grain.layers', 'Layers'],
    ['stretch.grain.overlap', 'Overlap'],
    ['stretch.grain.sizeJitter', 'Size jitter'],
    ['stretch.grain.positionJitterMs', 'Position jitter'],
    ['stretch.grain.seed', 'Seed'],
  ]],
  ['Pitch movement', [
    ['stretch.grain.pitchJitterSemis', 'Pitch jitter'],
    ['stretch.grain.pitchDriftSemis', 'Pitch drift'],
    ['stretch.grain.driftRateHz', 'Drift rate'],
    ['stretch.grain.driftStep', 'Step the drift'],
    ['stretch.grain.linkJitter', 'Link jitter'],
  ]],
  ['Scan & shape', [
    ['stretch.grain.scan', 'Scan'],
    ['stretch.grain.reverse', 'Reverse grains'],
    ['stretch.grain.wrap', 'Wrap positions'],
    ['stretch.grain.envelope', 'Envelope'],
    ['stretch.grain.sizeRange', 'Size range'],
    ['stretch.grain.layerSpread', 'Layer spread'],
    ['stretch.grain.layerScatter', 'Layer scatter'],
    ['stretch.grain.layerScatterMs', 'Scatter range'],
    ['stretch.grain.panSpread', 'Pan spread'],
  ]],
  ['Maximiser', [
    ['rack.master.on', 'On'],
    ['rack.master.amount', 'Amount'],
    ['rack.master.autoLevel', 'Auto level'],
    ['rack.master.autoComp', 'Auto compression'],
    ['rack.master.ceilingDb', 'Ceiling'],
  ]],
];

const pmState = { name: null, draft: null, clean: null };

const pmGet = (obj, path) =>
  path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);

function pmSet(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
}

const pmDirty = () =>
  pmState.draft && JSON.stringify(pmState.draft) !== JSON.stringify(pmState.clean);

function openPresetManager() {
  $('presetManager').classList.remove('hidden');
  // Always from the server, because another window — or the Save as button a
  // moment ago — may have changed them since this page last looked.
  loadPresets().then(() => {
    const first = $('presetPick').value || state.presets[0]?.name || null;
    pmSelect(first);
  });
}

function closePresetManager() {
  if (pmDirty() && !confirm('Close without saving the changes to this preset?')) return;
  $('presetManager').classList.add('hidden');
  pmState.name = null; pmState.draft = null; pmState.clean = null;
}

/// Selecting a different preset asks before throwing away unsaved edits.
///
/// `force` skips that, and is not a convenience: after saving, the draft still
/// differs from the *old* clean copy, so the guard would fire on the way back
/// to the preset just saved and leave the panel showing what was typed rather
/// than what the server actually stored.
function pmSelect(name, force = false) {
  if (!force && pmDirty() && name !== pmState.name
      && !confirm(`Discard the unsaved changes to “${pmState.name}”?`)) return;
  const found = state.presets.find((p) => p.name === name) || null;
  pmState.name = found?.name ?? null;
  // Two deep copies: one to edit, one to compare against and to revert to.
  pmState.clean = found ? JSON.parse(JSON.stringify(found)) : null;
  pmState.draft = found ? JSON.parse(JSON.stringify(found)) : null;
  renderPresetManager();
}

function renderPresetManager() {
  const list = $('pmList');
  const detail = $('pmDetail');
  if (!list) return;

  $('pmCount').textContent =
    `${state.presets.length} ${state.presets.length === 1 ? 'preset' : 'presets'}`;

  list.innerHTML = '';
  for (const p of state.presets) {
    const b = document.createElement('button');
    b.className = 'pm-item'
      + (p.name === pmState.name ? ' active' : '')
      + (p.name === pmState.name && pmDirty() ? ' dirty' : '');
    b.innerHTML = `<span class="nm"></span><span class="nt"></span>`;
    b.querySelector('.nm').textContent = p.name;
    b.querySelector('.nt').textContent = p.note || '—';
    b.onclick = () => pmSelect(p.name);
    list.appendChild(b);
  }

  const dirty = pmDirty();
  $('pmStatus').textContent = !pmState.draft ? ''
    : dirty ? 'unsaved changes' : 'no changes';
  $('pmStatus').classList.toggle('dirty', !!dirty);
  for (const id of ['pmSave', 'pmRevert', 'pmDelete', 'pmDuplicate']) {
    $(id).disabled = !pmState.draft;
  }
  $('pmSave').disabled = !dirty;
  $('pmRevert').disabled = !dirty;

  if (!pmState.draft) {
    detail.innerHTML = `<div class="pm-empty">${
      state.presets.length ? 'Pick a preset on the left.'
                           : 'No presets yet — use <b>Save as…</b> to make one.'}</div>`;
    return;
  }

  detail.innerHTML = '';
  const ident = document.createElement('div');
  ident.className = 'pm-ident';
  ident.innerHTML = `
    <div class="f"><label>Name</label><input id="pmName" type="text"></div>
    <div class="f"><label>Note</label><input id="pmNote" type="text" placeholder="what it is for"></div>`;
  detail.appendChild(ident);
  const nameEl = $('pmName');
  const noteEl = $('pmNote');
  nameEl.value = pmState.draft.name || '';
  noteEl.value = pmState.draft.note || '';
  nameEl.oninput = () => { pmState.draft.name = nameEl.value; pmTouch(); };
  noteEl.oninput = () => { pmState.draft.note = noteEl.value; pmTouch(); };

  const groups = document.createElement('div');
  groups.className = 'pm-groups';
  for (const [title, rows] of PM_SCHEMA) {
    const g = document.createElement('div');
    g.className = 'pm-group';
    const h = document.createElement('h3');
    h.textContent = title;
    g.appendChild(h);
    for (const [path, label, enumName] of rows) g.appendChild(pmRow(path, label, enumName));
    groups.appendChild(g);
  }
  detail.appendChild(groups);
}

/// One row: a name and whatever control the stored value calls for.
function pmRow(path, label, enumName) {
  const row = document.createElement('div');
  row.className = 'pm-row';
  const l = document.createElement('label');
  l.textContent = label;
  l.title = path;
  row.appendChild(l);

  const value = pmGet(pmState.draft, path);
  const was = pmGet(pmState.clean, path);
  let el;

  if (enumName) {
    el = document.createElement('select');
    for (const opt of PM_ENUMS[enumName]) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      el.appendChild(o);
    }
    el.value = value ?? PM_ENUMS[enumName][0];
    el.onchange = () => { pmSet(pmState.draft, path, el.value); pmMark(el, path); pmTouch(); };
  } else if (typeof value === 'boolean' || typeof was === 'boolean') {
    el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = !!value;
    el.onchange = () => { pmSet(pmState.draft, path, el.checked); pmMark(el, path); pmTouch(); };
  } else {
    el = document.createElement('input');
    el.type = 'number';
    el.step = 'any';
    // A preset written before a control existed simply has no value for it.
    // Showing an empty box rather than a zero is the honest thing: zero is a
    // real setting and would be a lie about what is stored.
    el.value = value ?? '';
    el.placeholder = 'default';
    el.oninput = () => {
      const n = parseFloat(el.value);
      pmSet(pmState.draft, path, el.value === '' || Number.isNaN(n) ? undefined : n);
      pmMark(el, path);
      pmTouch();
    };
  }
  row.appendChild(el);
  pmMark(el, path);
  return row;
}

/// Mark a control that no longer matches what is stored, so an edit is visible
/// before it is saved rather than after.
function pmMark(el, path) {
  const now = pmGet(pmState.draft, path);
  const was = pmGet(pmState.clean, path);
  el.classList.toggle('changed', JSON.stringify(now) !== JSON.stringify(was));
}

/// Repaint only what an edit can change — not the rows, because rebuilding
/// them would take the focus out of the box being typed into.
function pmTouch() {
  const dirty = pmDirty();
  $('pmStatus').textContent = dirty ? 'unsaved changes' : 'no changes';
  $('pmStatus').classList.toggle('dirty', dirty);
  $('pmSave').disabled = !dirty;
  $('pmRevert').disabled = !dirty;
  const item = [...$('pmList').children].find((b) => b.classList.contains('active'));
  if (item) item.classList.toggle('dirty', dirty);
}

$('stretchRandom').onclick = () => {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const r = randomizeStretch();
  toast(`Randomised — seed ${r.seed}`);
};

$('presetManage').onclick = openPresetManager;
$('pmClose').onclick = closePresetManager;
$('presetManager').onclick = (e) => { if (e.target === $('presetManager')) closePresetManager(); };
$('pmRevert').onclick = () => {
  pmState.draft = JSON.parse(JSON.stringify(pmState.clean));
  renderPresetManager();
};

$('pmSave').onclick = async () => {
  if (!pmState.draft) return;
  const to = (pmState.draft.name || '').trim();
  if (!to) { toast('A preset needs a name'); return; }
  try {
    const r = await postJSON('/api/presets/update', {
      name: pmState.name,
      to,
      note: pmState.draft.note || '',
      stretch: pmState.draft.stretch,
      rack: pmState.draft.rack,
    });
    state.presets = r.presets || [];
    // Read back what the server actually stored rather than trusting the
    // draft: every value went through the same clamps the document uses, so
    // what is on screen now is what a sound would really get, and a value that
    // was pulled into range says so instead of lying until the next reload.
    renderPresets();
    pmSelect(to, true);
    toast(`Saved “${to}”`);
  } catch (e) { toast('Could not save: ' + e.message); }
};

$('pmDuplicate').onclick = async () => {
  if (!pmState.draft) return;
  let name = `${pmState.name} copy`;
  let n = 2;
  while (state.presets.some((p) => p.name === name)) name = `${pmState.name} copy ${n++}`;
  name = prompt('Name for the copy:', name);
  if (name === null || !name.trim()) return;
  try {
    // Made from the draft, so a copy can be taken of edits without committing
    // them to the original.
    const r = await postJSON('/api/presets/duplicate', {
      name: name.trim(),
      note: pmState.draft.note || '',
      stretch: pmState.draft.stretch,
      rack: pmState.draft.rack,
    });
    state.presets = r.presets || [];
    renderPresets();
    // The copy holds the draft, so moving to it is not losing anything.
    pmSelect(name.trim(), true);
    toast(`Made “${name.trim()}”`);
  } catch (e) { toast('Could not duplicate: ' + e.message); }
};

$('pmDelete').onclick = async () => {
  if (!pmState.name) return;
  if (!confirm(`Delete the preset “${pmState.name}”? No sound is touched.`)) return;
  try {
    const r = await postJSON('/api/presets/delete', { name: pmState.name });
    state.presets = r.presets || [];
    if ($('presetPick').value === pmState.name) $('presetPick').value = '';
    renderPresets();
    pmSelect(state.presets[0]?.name ?? null, true);
    toast('Deleted');
  } catch (e) { toast('Could not delete: ' + e.message); }
};

/// One reset for all three panels.
///
/// Time, grain shape and pitch movement are three faces of one setting — they
/// are a single `stretch` operation on the document — so resetting one and
/// leaving the others is a state the engine cannot really be in. These are the
/// engine's own defaults, from `Grain::default`; the seed is deliberately not
/// among them, because it names a cloud rather than shaping one and throwing it
/// away would lose the sound you were working on.
// Which fields belong to the Extended column. The line is where it is because
// everything on this list used to be a constant inside an algorithm; the
// standard column is the set of controls the app has always had.
const EXTENDED_FIELDS = {
  vocoder: ['freqTrust', 'phaseSpread', 'peakWidth', 'lockWidth',
            'magFreeze', 'magBlur', 'magGate', 'stereoLink'],
  wsola: ['searchMs', 'splice', 'stride', 'shape', 'guardHops', 'floor'],
  pvsola: ['searchMs', 'blend'],
  hybrid: ['fftSize', 'timeSpan', 'freqSpan', 'margin'],
  grain: ['scan', 'reverse', 'envelope', 'sizeRange', 'wrap', 'layerSpread',
          'layerScatter', 'layerScatterMs',
          'linkJitter', 'driftStep', 'panSpread'],
};

/// Put the extended controls back where the engines assume them, and leave
/// everything else exactly as it is — including the seed, which has no default
/// worth restoring: one is not a more correct random draw than any other.
async function resetExtended() {
  for (const k of EXTENDED_FIELDS.vocoder) state.stretchDraft.vocoder[k] = VOCODER_DEFAULTS[k];
  for (const k of EXTENDED_FIELDS.wsola) state.stretchDraft.wsola[k] = WSOLA_DEFAULTS[k];
  for (const k of EXTENDED_FIELDS.pvsola) state.stretchDraft.pvsola[k] = PVSOLA_DEFAULTS[k];
  for (const k of EXTENDED_FIELDS.hybrid) state.stretchDraft.hybrid[k] = HYBRID_DEFAULTS[k];
  const grain = { ...state.grainDraft };
  for (const k of EXTENDED_FIELDS.grain) grain[k] = GRAIN_DEFAULTS[k];
  state.grainDraft = grain;
  await editOp({ op: 'stretch', ...state.stretchDraft, grain });
  // The extended column is built once and left alone, like the engine panels,
  // so its controls cannot be pushed back the way a plain slider can.
  stretchBuiltFor = null;
  grainBuiltFor = null;
  renderStretch();
  renderGrainParams();
}

// ─────────────────────────────────────────────────────────── the randomiser ──
//
// Throw every control in the stretch tray somewhere at random, commit, and say
// what it did. Built to find glitches: a cloud has too many interacting
// parameters to reason about one at a time, and the combinations that break it
// are exactly the ones nobody would think to try.
//
// **It drives the real controls rather than the drafts.** Every range, choice
// and switch in the tray is set through the same `input`/`change` events a hand
// would produce, which means it can only ever produce values the interface
// itself allows — no separate table of ranges to drift out of step with the
// controls, which is gotcha 7 waiting to happen. It also means what it exercises
// is the path a user exercises.
//
// The engine picker is deliberately excluded. Which engine you are in is where
// you are, not a setting — the same reason Reset all leaves it alone — and a
// sweep wants to hold it fixed and vary everything else.

/// mulberry32. Small, fast, and good enough for choosing slider positions.
///
/// Seeded on purpose: a randomiser that cannot be replayed is useless for
/// finding a fault, because the interesting run is always the one you have just
/// lost. Every roll records its seed and the same seed gives the same tray.
function rngFrom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// The containers a roll reaches, and the one it must not.
const RANDOM_BOXES = ['stretchParams', 'grainShape', 'grainPitch', 'extEngine', 'extGrain'];

/// Set every control in the tray at random. Returns what it rolled.
///
/// `seed` is optional; without one it picks a seed and tells you what it picked,
/// so an interesting accident is still reproducible afterwards.
function randomizeStretch({ seed = null, commit = true } = {}) {
  const used = seed === null ? (Math.random() * 0xffffffff) >>> 0 : seed >>> 0;
  const rnd = rngFrom(used);
  const rolled = {};

  for (const boxId of RANDOM_BOXES) {
    const box = $(boxId);
    if (!box) continue;

    // Sliders and knobs. A log control's element is 0..1000 ticks, so a uniform
    // roll over the element is uniform in log space — which is the right
    // distribution for a control that was given a log sweep in the first place.
    const ranges = [...box.querySelectorAll('input[type=range]')];
    for (const input of ranges) {
      const min = Number(input.min);
      const max = Number(input.max);
      const step = Number(input.step) || 1;
      const steps = Math.max(1, Math.round((max - min) / step));
      input.value = String(min + Math.round(rnd() * steps) * step);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Three-way choices — but never the engine picker.
    for (const bar of box.querySelectorAll('.seg')) {
      if (bar.id === 'stretchEngine') continue;
      const btns = [...bar.querySelectorAll('.seg-btn')];
      if (!btns.length) continue;
      btns[Math.floor(rnd() * btns.length)].click();
    }

    // Switches. Clicked only when the roll disagrees with where it already is,
    // because the handler toggles rather than sets.
    for (const b of box.querySelectorAll('.switch')) {
      const want = rnd() < 0.5;
      if (b.classList.contains('on') !== want) b.click();
    }

    // One commit per box rather than one per control: `change` is what posts,
    // and forty posts where five will do turns a sweep into a wait.
    if (commit && ranges.length) {
      ranges[ranges.length - 1].dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // What actually landed, read back from the drafts rather than from what was
  // rolled — those are two different things whenever a value is clamped, and
  // the one worth recording is the one the engine got.
  rolled.seed = used;
  rolled.algorithm = state.stretchDraft?.algorithm || null;
  rolled.stretch = JSON.parse(JSON.stringify(state.stretchDraft || {}));
  rolled.grain = JSON.parse(JSON.stringify(state.grainDraft || {}));
  return rolled;
}

async function resetEverything() {
  state.stretchDraft = { ratio: 1, semitones: 0, windowMs: 40, quality: 'standard',
                         // Which engine you are working in is not a setting to
                         // be undone — it is where you are. Reset puts the
                         // controls back; it does not move you somewhere else.
                         algorithm: state.stretchDraft?.algorithm || 'wsola',
                         vocoder: { ...VOCODER_DEFAULTS },
                         wsola: { ...WSOLA_DEFAULTS },
                         pvsola: { ...PVSOLA_DEFAULTS },
                         hybrid: { ...HYBRID_DEFAULTS },
                         cloud: false, cloudMix: 0.5 };
  const grain = {
    ...GRAIN_DEFAULTS,
    seed: state.grainDraft?.seed ?? state.edit?.stretch?.grain?.seed ?? 1,
  };
  state.grainDraft = { ...grain };
  await editOp({ op: 'stretch', ...state.stretchDraft, grain });
  // The per-engine panels are built once and then left alone, so their controls
  // cannot be pushed back to a default the way a slider can — rebuild them.
  stretchBuiltFor = null;
  grainBuiltFor = null;
  renderStretch();
  renderGrainParams();
  syncStretchSliders();
  syncGrainSliders();
}

/// The Extended column's reset, on the first line it has.
///
/// The column has no heading of its own, so the button rides on the heading of
/// whichever group comes first — which changes with the engine, hence moving it
/// rather than building it in. Held outside the DOM between rebuilds so the
/// `innerHTML` that clears the column does not take the handler with it.
let extResetBtn = null;
function placeExtendedReset() {
  const panel = $('extPanel');
  if (!panel) return;
  if (!extResetBtn) {
    extResetBtn = resetButton(
      // This one clears the extended column only. Everything, standard and
      // extended, is a double-click on an engine tab — a gesture rather than a
      // button, so the two do not have to compete for the same strip of room.
      'extReset', 'Reset',
      'Reset only the extended controls — the standard ones are left alone',
      resetExtended,
    );
  }
  // Not `offsetParent`, which needs layout and is unreliable mid-rebuild.
  const heads = [...panel.querySelectorAll('.wild-head')];
  const first = heads.find((h) => !h.closest('.hidden')) || heads[0];
  if (first) first.appendChild(extResetBtn);
}

/// A reset button, built where it belongs rather than declared in the markup.
///
/// The panels these sit in are rebuilt wholesale, so a button placed once in
/// the HTML would be destroyed by the first rebuild and take its handler with
/// it. Keeping the id means the menu can still press it.
function resetButton(id, label, title, run) {
  const b = document.createElement('button');
  b.className = 'tiny';
  b.id = id;
  b.textContent = label;
  b.title = title;
  b.onclick = run;
  return b;
}

/// Draw the EQ response the server computed, so the picture and the filter
/// cannot disagree.
function drawEqCurve(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const RANGE = 20; // dB shown top to bottom
  const y = (db) => h / 2 - (db / RANGE) * h;

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (const db of [-12, -6, 0, 6, 12]) {
    ctx.globalAlpha = db === 0 ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(0, y(db)); ctx.lineTo(w, y(db)); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const curve = state.rack?.curve;
  if (!curve || !curve.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('EQ switched out', 8, h / 2 - 4);
    return;
  }

  const accent = waveInk();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  curve.forEach(([, db], i) => {
    const x = (i / (curve.length - 1)) * w;
    i === 0 ? ctx.moveTo(x, y(db)) : ctx.lineTo(x, y(db));
  });
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('20 Hz', 4, h - 4);
  ctx.fillText('20 kHz', w - 40, h - 4);
}

// =================================================================== markers

async function loadAnnotations() {
  const f = state.selectedFile;
  if (!f) return;
  try { state.annotations = await api(`/api/markers?p=${encodeURIComponent(f.path)}`); }
  catch { state.annotations = { markers: [], regions: [] }; }
  drawMarkers();
}

async function saveAnnotations() {
  const f = state.selectedFile;
  if (!f) return;
  try {
    state.annotations = await postJSON('/api/markers', { p: f.path, ...state.annotations });
    drawMarkers();
  } catch (e) { toast('Could not save markers: ' + e.message); }
}

function addMarker() {
  const frame = state.sel ? state.sel.start : Math.round(sourceFrameNow());
  const label = prompt('Marker name:', `m${state.annotations.markers.length + 1}`);
  if (label === null) return;
  state.annotations.markers.push({ frame, label });
  saveAnnotations();
}

function addRegion() {
  const label = prompt('Region name:', `r${state.annotations.regions.length + 1}`);
  if (label === null) return;
  state.annotations.regions.push({ start: state.sel.start, end: state.sel.end, label });
  saveAnnotations();
}

function drawMarkers() {
  const ruler = $('ruler');
  ruler.innerHTML = '';
  ruler.classList.toggle('bare', !state.annotations.markers.length);
  for (const m of state.annotations.markers) {
    const x = framesToX(m.frame);
    if (x < 0 || x > 1) continue;
    const el = document.createElement('div');
    el.className = 'marker';
    el.style.left = (x * 100) + '%';
    el.innerHTML = `<div class="flag"></div><div class="stem"></div><div class="name"></div>`;
    el.querySelector('.name').textContent = m.label;
    ruler.appendChild(el);
  }

  const strip = $('regions');
  strip.innerHTML = '';
  // A strip with nothing in it took a row of the window to say so. It gets its
  // height back the moment there is a region to put in it.
  strip.classList.toggle('bare', !state.annotations.regions.length);
  for (const r of state.annotations.regions) {
    const a = framesToX(r.start);
    const b = framesToX(r.end);
    if (b < 0 || a > 1) continue;
    const el = document.createElement('div');
    el.className = 'region';
    el.style.left = (Math.max(0, a) * 100) + '%';
    el.style.width = (Math.max(0, Math.min(1, b) - Math.max(0, a)) * 100) + '%';
    el.innerHTML = '<span></span>';
    el.querySelector('span').textContent = r.label;
    el.onclick = () => { state.sel = { start: r.start, end: r.end }; drawSelection(); };
    strip.appendChild(el);
  }

  const list = $('regionList');
  list.innerHTML = '';
  const sr = state.view.sampleRate || 1;
  state.annotations.regions.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'region-item';
    el.innerHTML = `<span class="rname"></span>
      <span class="rtime">${fmtTime(r.start / sr)} → ${fmtTime(r.end / sr)}</span>
      <button class="ghost">Remove</button>`;
    el.querySelector('.rname').textContent = r.label;
    el.onclick = () => { state.sel = { start: r.start, end: r.end }; drawSelection(); };
    el.querySelector('button').onclick = (e) => {
      e.stopPropagation();
      state.annotations.regions.splice(i, 1);
      saveAnnotations();
    };
    list.appendChild(el);
  });
  if (!state.annotations.regions.length) {
    list.innerHTML = '<div class="empty">No regions yet. Select a range and press Region.</div>';
  }
}

// =============================================================== spectrogram

$('specOn').onchange = (e) => {
  state.showSpec = e.target.checked;
  $('lane').classList.toggle('split', state.showSpec);
  // Fetching must not be gated on requestAnimationFrame: a tab that is not
  // painting never fires it, and the spectrogram would silently never load.
  if (state.showSpec) loadSpectrogram();
  afterLayout(drawWave);
};

// ------------------------------------------------------- live visualiser
//
// A real-time analyser on the playing audio, as opposed to the pre-computed
// spectrogram of the whole file. Only runs in edit mode and only while
// something is playing.

// The spectrum is measured by the engine, on the audio it actually put out —
// grains, rack and all. There is no browser-side signal to analyse any more,
// and this is the more truthful measurement: it is the output, not a tap on an
// element that was only ever an approximation of it.
let visRaf = null;

function startVisualiser() {
  if (visRaf) return;
  const canvas = $('visCanvas');
  if (!canvas) return;
  const tick = () => {
    visRaf = requestAnimationFrame(tick);
    // It lives in the Visuals dock, and a spectrum nobody can see is an FFT
    // read and a full canvas repaint sixty times a second for nothing.
    if ($('dockVisuals')?.classList.contains('hidden')) return;
    drawVisualiser(canvas);
  };
  tick();
}

function stopVisualiser() {
  if (visRaf) { cancelAnimationFrame(visRaf); visRaf = null; }
}

function drawVisualiser(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const bins = engine.spectrum;
  if (!engine.playing || !bins || !bins.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('press play to see the live spectrum', 8, h / 2);
    return;
  }

  // Log-spaced bars: linear bins put almost everything in the bottom eighth.
  const bars = 64;
  const accent = waveInk();
  ctx.fillStyle = accent;
  const bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const lo = Math.floor(Math.pow(bins.length, i / bars));
    const hi = Math.max(lo + 1, Math.floor(Math.pow(bins.length, (i + 1) / bars)));
    let peak = 0;
    for (let j = lo; j < hi && j < bins.length; j++) if (bins[j] > peak) peak = bins[j];
    const bh = (peak / 255) * (h - 2);
    ctx.globalAlpha = 0.35 + 0.65 * (peak / 255);
    ctx.fillRect(i * bw, h - bh, Math.max(bw - 1, 1), bh);
  }
  ctx.globalAlpha = 1;
}

document.querySelectorAll('[data-fft]').forEach((b) => {
  b.onclick = () => {
    state.fftSize = +b.dataset.fft;
    document.querySelectorAll('[data-fft]').forEach((x) => x.classList.toggle('active', x === b));
    if (state.showSpec) loadSpectrogram();
  };
});

// ───────────────────────────────────────────────────────────── the room editor
//
// The room's shape and camera are numbers nobody can picture. `floorY` at -0.38
// against `ceilY` at 0.62 is not a quantity, it is *how far you are looking
// down*, and the only way to choose it is to look down and see. So there is
// nothing to type here: you drag the room and the room moves. The numbers are
// an output, shown so a result worth keeping can become the default in
// `vis-gl.js`. See `docs/ROOM-EDITOR.md`.

/// The frame shapes the video export offers, plus the dock's own.
///
/// Each keeps its own camera, because the constants that suit a wide panel do
/// not survive being narrowed — at 9:16 the room is a third of the width it was
/// designed for and the sky ring, whose radius comes from the height and so
/// does not shrink with it, takes 60% of what is left.
const ROOM_FRAMES = [
  { key: 'dock', label: 'Dock', ratio: 0 },
  { key: '16x9', label: '16:9', ratio: 16 / 9 },
  { key: '1x1', label: '1:1', ratio: 1 },
  { key: '4x5', label: '4:5', ratio: 4 / 5 },
  { key: '9x16', label: '9:16', ratio: 9 / 16 },
];

/// What the source ships. Kept here as well as in `vis-gl.js` so a drag has
/// something to start from and Reset has something to go back to.
const ROOM_CAM_DEFAULT = {
  depth: 1.9, floorY: -0.38, ceilY: 0.62, shiftX: 0, skyAt: 0.72, ring: 0.17,
};

/// What the room draws. Each part is its own decision.
///
/// The box was one picture with four things always in it. Turned on and off
/// separately they are a set: terrain alone is a landscape, the ring alone is a
/// scope hanging in the dark, the wireframe alone is the room empty. The
/// renderer defaults to all of them, so anything that does not pass this — the
/// grain views, a test — draws what it always drew.
const ROOM_LAYERS = [
  { key: 'room', label: 'Box', hint: 'The wireframe: the four runs back and the far wall.' },
  { key: 'floor', label: 'Terrain', hint: 'The spectrum along the floor, receding as it ages.' },
  { key: 'lead', label: 'Edge', hint: 'The frame you are hearing now, drawn with weight along the near edge.' },
  { key: 'sky', label: 'Ring', hint: 'The Lissajous hanging in the sky, pushed out of round by the sound.' },
  { key: 'skin', label: 'Skin', hint: 'The surface between the rings, so the trail is a tube rather than a stack of hoops. Stands on its own — the hoops can be off.' },
  { key: 'grains', label: 'Grains', hint: 'Every grain in the schedule, as a streak: depth is when it sounds, its length is how long for, across is pan and up is pitch.' },
  // Not drawn in the room. It is HTML printed on the back wall, which is why it
  // has neither a place in the hierarchy nor an occlusion switch: it is not in
  // the scene the depth buffer describes, and offering it either control would
  // be offering a control that does nothing.
  { key: 'data', label: 'Data', gl: false, hint: 'The schedule itself, printed on the back wall. Not drawn in the room — it is type on the wall, so it neither occludes nor takes a place in the hierarchy.' },
];

/// The layers the renderer actually draws. `data` is the one that is not.
const ROOM_GL_LAYERS = ROOM_LAYERS.filter((l) => l.gl !== false);

/// How many rows travel together before a blank line, and which way each block
/// runs. Alternating blocks read in opposite directions, so neighbouring groups
/// slide against each other and the movement is visible — a single column all
/// going one way at this size reads as a static texture.
const ROOM_CHUNKS = [2, 4, 8];

const roomEdit = {
  on: false, frame: 'dock', cams: {}, drag: null, layers: {},
  chunk: 4,
  opacity: 0.7,
  /// Highest first. Kept as a list rather than as a rank on each layer because
  /// the thing being edited is an order, and an order is a list.
  order: ROOM_GL_LAYERS.map((l) => l.key),
  /// Which layers stand in the way of the ones below them.
  occlude: {},
  /// How big the ring is, as a multiple of the camera's own `ring`. The camera
  /// holds the pose; this is the size, and they are two different questions —
  /// posing the room should not resize what is in it.
  ringScale: 1,
  /// How much of the cloud is drawn, and how hot it burns.
  ///
  /// **Both are about the picture and neither is about the sound.** The cloud's
  /// rate has its own control in front of the engine — `Density`, in grains per
  /// second — and that one changes what you hear. This one changes how many of
  /// the grains that *are* sounding get a shape in the room, which at a few
  /// hundred a second is the difference between a cloud you can see through and
  /// a fog. Naming them both density is unfortunate and unavoidable: they are
  /// both the density of a cloud, one you hear and one you look at.
  grainDensity: 1,
  grainBright: 1,
  /// How hard the sound pushes the ring out of round. One is what it always was.
  ringDrive: 1,
  /// How thick the dark border under the ring's lines is, as a fraction of the
  /// ring's radius.
  ringEdge: 0.035,
  /// How finely the ring is drawn. What is *stored* is the whole trace either
  /// way, so this can be moved while looking at it.
  ringPoints: 1024,
  /// The thick band over the frame being heard now. The ridge line under it is
  /// drawn either way — see `drawLead`.
  leadThick: true,
  /// Filling the grain shapes in.
  ///
  /// `bg` is not a colour. The room is drawn on glass with the page's own
  /// ground behind it, so filling with "the background" means taking the light
  /// out of what is behind the shape rather than painting anything over it —
  /// a different pass, which is why it is a state and not a swatch value.
  /// Smoke dripping off the shapes: whether, how much, and how long the drips
  /// are as a fraction of a grain's whole journey.
  /// Distance fog. Its own thing entirely from the mist: the mist is particles
  /// shed by grains, and this is what the air does to everything behind it.
  fog: false,
  fogType: 1,
  fogDensity: 0.5,
  fogColour: '#7f8fa6',
  mist: false,
  mistAmount: 0.5,
  mistLength: 0.06,
  grainFill: false,
  grainFillBg: true,
  grainFillColour: '#1b2b3a',
  /// The room's own shape, as against the camera's pose.
  ///
  /// **These are not the camera and they are kept apart from it on purpose.**
  /// The camera is where you stand — what dragging writes, what `reNums` prints
  /// and what gets pasted back into `vis-gl.js` as a new default. This is what
  /// the room *is*: how wide the floor is resolved, how far back the trail runs
  /// before it reaches the wall, how tall the terrain stands. A camera copied
  /// out should not carry somebody's floor resolution with it, the same
  /// argument that keeps the ring's size out of it.
  ///
  /// Null means the shape the renderer ships with.
  geomBands: 280,
  geomHistory: 56,
  geomRidge: 0.62,
  /// How many seconds of sound the room's depth stands for, and how big a
  /// grain is drawn. Both are the scale of the box rather than a pose in it.
  geomSpan: 14,
  geomBody: 0.032,
};

/// The layers, in the order they are drawn — highest in the hierarchy first.
///
/// Anything that is not in the stored list is appended in the order
/// `ROOM_LAYERS` gives, so a layer added to the program later turns up at the
/// bottom rather than not at all.
function roomOrder() {
  const out = [];
  for (const k of roomEdit.order || []) {
    if (ROOM_GL_LAYERS.some((l) => l.key === k) && !out.includes(k)) out.push(k);
  }
  for (const l of ROOM_GL_LAYERS) if (!out.includes(l.key)) out.push(l.key);
  return out;
}

/// Whether anything in the room is standing in anything else's way.
///
/// **The hierarchy does nothing until something does.** Everything in this room
/// is drawn with additive blending, and addition does not care what order it
/// happens in — with nothing occluding, reversing the whole stack gives a
/// picture identical to the last pixel. It is only when a layer writes depth
/// that being drawn earlier means anything at all, and the list says so rather
/// than letting somebody drag rows around expecting a change they cannot get.
function roomHierarchyLive() {
  return ROOM_GL_LAYERS.some((l) => roomLayerOn(l.key) && roomOccludeOn(l.key));
}

/// Off unless somebody has turned it on. Occlusion changes what the room looks
/// like fundamentally, so it is asked for rather than assumed.
function roomOccludeOn(key) {
  return roomEdit.occlude[key] === true;
}

function roomOcclude() {
  const out = {};
  for (const l of ROOM_GL_LAYERS) out[l.key] = roomOccludeOn(l.key);
  return out;
}

try {
  const v = JSON.parse(localStorage.getItem('roomData') || '{}');
  if (ROOM_CHUNKS.includes(v.chunk)) roomEdit.chunk = v.chunk;
  if (typeof v.opacity === 'number') roomEdit.opacity = Math.max(0.05, Math.min(1, v.opacity));
  if (typeof v.ringScale === 'number') {
    roomEdit.ringScale = Math.max(0.15, Math.min(3, v.ringScale));
  }
  if (typeof v.grainDensity === 'number') {
    roomEdit.grainDensity = Math.max(0.04, Math.min(1, v.grainDensity));
  }
  if (typeof v.grainBright === 'number') {
    roomEdit.grainBright = Math.max(0.15, Math.min(3, v.grainBright));
  }
  if (typeof v.ringDrive === 'number') {
    roomEdit.ringDrive = Math.max(0, Math.min(8, v.ringDrive));
  }
  if (typeof v.ringEdge === 'number') {
    roomEdit.ringEdge = Math.max(0, Math.min(0.25, v.ringEdge));
  }
  if (typeof v.ringPoints === 'number') {
    roomEdit.ringPoints = Math.max(48, Math.min(2048, Math.round(v.ringPoints)));
  }
  if (typeof v.leadThick === 'boolean') roomEdit.leadThick = v.leadThick;
  // The room's own shape. Clamped to the same range the renderer clamps to, so
  // a stored value can never ask for a room it will not draw.
  if (typeof v.geomBands === 'number') {
    roomEdit.geomBands = Math.max(8, Math.min(2048, Math.round(v.geomBands)));
  }
  if (typeof v.geomHistory === 'number') {
    roomEdit.geomHistory = Math.max(2, Math.min(240, Math.round(v.geomHistory)));
  }
  if (typeof v.geomRidge === 'number') {
    roomEdit.geomRidge = Math.max(0.02, Math.min(1.6, v.geomRidge));
  }
  if (typeof v.geomSpan === 'number') {
    roomEdit.geomSpan = Math.max(0.5, Math.min(90, v.geomSpan));
  }
  if (typeof v.geomBody === 'number') {
    roomEdit.geomBody = Math.max(0.002, Math.min(0.3, v.geomBody));
  }
  if (typeof v.fog === 'boolean') roomEdit.fog = v.fog;
  if (typeof v.fogType === 'number') roomEdit.fogType = Math.max(0, Math.min(3, v.fogType | 0));
  if (typeof v.fogDensity === 'number') {
    roomEdit.fogDensity = Math.max(0, Math.min(2, v.fogDensity));
  }
  if (typeof v.fogColour === 'string' && /^#[0-9a-f]{6}$/i.test(v.fogColour)) {
    roomEdit.fogColour = v.fogColour;
  }
  if (typeof v.mist === 'boolean') roomEdit.mist = v.mist;
  if (typeof v.mistAmount === 'number') {
    roomEdit.mistAmount = Math.max(0.06, Math.min(1, v.mistAmount));
  }
  if (typeof v.mistLength === 'number') {
    roomEdit.mistLength = Math.max(0.004, Math.min(0.6, v.mistLength));
  }
  if (typeof v.grainFill === 'boolean') roomEdit.grainFill = v.grainFill;
  if (typeof v.grainFillBg === 'boolean') roomEdit.grainFillBg = v.grainFillBg;
  if (typeof v.grainFillColour === 'string' && /^#[0-9a-f]{6}$/i.test(v.grainFillColour)) {
    roomEdit.grainFillColour = v.grainFillColour;
  }
} catch {}

function saveRoomData() {
  try {
    localStorage.setItem('roomData', JSON.stringify({
      chunk: roomEdit.chunk, opacity: roomEdit.opacity, ringScale: roomEdit.ringScale,
      geomBands: roomEdit.geomBands, geomHistory: roomEdit.geomHistory,
      geomRidge: roomEdit.geomRidge,
      geomSpan: roomEdit.geomSpan, geomBody: roomEdit.geomBody,
      grainDensity: roomEdit.grainDensity, grainBright: roomEdit.grainBright,
      ringDrive: roomEdit.ringDrive, ringEdge: roomEdit.ringEdge,
      leadThick: roomEdit.leadThick, ringPoints: roomEdit.ringPoints,
      mist: roomEdit.mist, mistAmount: roomEdit.mistAmount,
      mistLength: roomEdit.mistLength,
      fog: roomEdit.fog, fogType: roomEdit.fogType,
      fogDensity: roomEdit.fogDensity, fogColour: roomEdit.fogColour,
      grainFill: roomEdit.grainFill, grainFillBg: roomEdit.grainFillBg,
      grainFillColour: roomEdit.grainFillColour,
    }));
  } catch {}
}

try {
  roomEdit.layers = JSON.parse(localStorage.getItem('roomLayers') || '{}') || {};
} catch { roomEdit.layers = {}; }

try {
  const v = JSON.parse(localStorage.getItem('roomHierarchy') || 'null');
  if (v && Array.isArray(v.order)) roomEdit.order = v.order;
  if (v && v.occlude && typeof v.occlude === 'object') roomEdit.occlude = v.occlude;
} catch {}

function saveRoomHierarchy() {
  try {
    localStorage.setItem('roomHierarchy',
      JSON.stringify({ order: roomOrder(), occlude: roomEdit.occlude }));
  } catch {}
}

try {
  roomEdit.streams = JSON.parse(localStorage.getItem('roomStreams') || 'null');
} catch { roomEdit.streams = null; }

/// On unless somebody has turned it off.
function roomLayerOn(key) {
  return roomEdit.layers[key] !== false;
}

function roomLayers() {
  const out = {};
  for (const l of ROOM_LAYERS) out[l.key] = roomLayerOn(l.key);
  return out;
}

function saveRoomLayers() {
  try { localStorage.setItem('roomLayers', JSON.stringify(roomEdit.layers)); } catch {}
}

try {
  roomEdit.cams = JSON.parse(localStorage.getItem('roomCameras') || '{}') || {};
} catch { roomEdit.cams = {}; }

/// What to draw with. Null is "whatever the source says", which is what every
/// frame is until somebody poses it.
function roomCamera() {
  return roomEdit.cams[roomEdit.frame] || null;
}

/// The room's shape, as the renderer wants it.
///
/// One accessor for both callers. The live room and the film reading their
/// geometry from two places is the fault this program shipped over the
/// background colour, and there is no reason to leave a second one.
function roomGeom() {
  return {
    bands: roomEdit.geomBands,
    history: roomEdit.geomHistory,
    ridge: roomEdit.geomRidge,
    span: roomEdit.geomSpan,
    body: roomEdit.geomBody,
  };
}

/// The air, as the renderer wants it.
///
/// The near and far are the room's own front and back rather than numbers
/// anybody types: linear fog that ran out somewhere other than the back wall
/// would be a control about the fog rather than about the room.
function roomFog() {
  const cam = vgCamera(roomCamera());
  return {
    on: roomEdit.fog,
    type: roomEdit.fogType,
    rgb: vgHexRgb(roomEdit.fogColour),
    density: roomEdit.fogDensity,
    near: 1,
    far: 1 + cam.depth,
    height: cam.floorY,
  };
}

/// `#rrggbb` as the three floats the shaders want.
/// The ground the room is drawn on.
///
/// One answer, asked by both the live room and the film. They read two
/// different tokens before this — `--sink` for the cell on screen and `--bg`
/// for the export — which are a visibly different black, so an exported file
/// came out on a lighter ground than the room it was posed in.
function roomGroundColour() {
  const bg = rpSlot('background');
  if (bg.mode === 'flat' && bg.colour) return bg.colour;
  const cell = document.querySelector('#masterBus .mb-cell-3d');
  const v = cell ? getComputedStyle(cell).backgroundColor : '';
  return cssHex(v) || v || '#07090c';
}

/// Put the palette's two non-geometry slots on the page.
///
/// The data block and the ground are type and a background rather than marks in
/// the scene, so they are CSS and not shader work — but they are in the same
/// palette, because from the outside they are two more things in the room that
/// have a colour.
function applyRoomPaintCss() {
  const cell = document.querySelector('#masterBus .mb-cell-3d');
  const bg = rpSlot('background');
  if (cell) cell.style.background = bg.mode === 'flat' && bg.colour ? bg.colour : '';
  const data = $('roomData');
  const d = rpSlot('data');
  // The block fades down the wall in five steps, each a `color-mix` against
  // `--wave-2`. Overriding that one token inside the block keeps every step and
  // changes what they are steps *of*.
  if (data) data.style.setProperty('--wave-2', d.mode === 'flat' && d.colour ? d.colour : '');
}

function vgHexRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/// Which posed frame a given shape is, by its aspect.
///
/// The export box offers nine sizes and the room keeps five cameras, and the
/// two are matched by shape rather than by name: 720p, HD, 1440p and 4K are all
/// 16:9 and all want the camera posed for 16:9.
function roomFrameForAspect(aspect) {
  let best = null, bestGap = Infinity;
  for (const f of ROOM_FRAMES) {
    if (f.ratio <= 0) continue;
    const gap = Math.abs(f.ratio - aspect);
    if (gap < bestGap) { bestGap = gap; best = f; }
  }
  // Nothing close enough to be that shape falls back to the dock's own camera,
  // which is what an unrecognised size should get.
  return best && bestGap < 0.06 ? best.key : null;
}

/// The camera to film a given shape with.
///
/// **The shape being exported, not the one on screen.** `docs/ROOM-EDITOR.md`
/// says what this is for: *"picking Vertical in the export box gets the camera
/// that was designed for vertical rather than the wide one squeezed"* — and the
/// export read `roomEdit.frame` instead, which is whatever the view happened to
/// be showing. Posing the room for 9:16 and then exporting HD filmed the
/// portrait camera into a landscape frame.
///
/// A frame nobody has posed falls back to the one being looked at rather than
/// to the shipped default. The rule is *use the camera meant for this shape*,
/// and when there is no such camera the one in front of you is a better guess
/// than a constant — it is at least a pose somebody chose.
function roomCameraForAspect(aspect) {
  const key = roomFrameForAspect(aspect);
  const posed = key && roomEdit.cams[key];
  return roomCameraDrawn(posed ? key : undefined);
}

/// The camera as the renderer should use it, with the ring's own size applied.
///
/// Kept apart from `roomCamera` on purpose. That one is the *pose* — it is what
/// the dragging writes, what `reNums` prints and what gets pasted back into
/// `vis-gl.js` as a new default. The ring's size is a preference about what is
/// in the room rather than about where the room is, and folding it into the
/// pose would mean every camera copied out carried somebody's slider position
/// with it.
function roomCameraDrawn(frameKey) {
  const c = frameKey ? (roomEdit.cams[frameKey] || null) : roomCamera();
  const k = roomEdit.ringScale;
  if (k === 1) return c;
  // `vgCamera` fills in whatever is missing, so this works on a posed camera,
  // on a partial one, and on no camera at all.
  const base = vgCamera(c);
  return { ...base, ring: base.ring * k };
}

function saveRoomCameras() {
  try { localStorage.setItem('roomCameras', JSON.stringify(roomEdit.cams)); } catch {}
}

/// The camera being edited, filled in, so a drag has something to add to even
/// on a frame nobody has touched.
function roomCamNow() {
  return { ...ROOM_CAM_DEFAULT, ...(roomEdit.cams[roomEdit.frame] || {}) };
}

function roomFrame() {
  return ROOM_FRAMES.find((f) => f.key === roomEdit.frame) || ROOM_FRAMES[0];
}

/// Letterbox the room into the shape being designed for.
///
/// Width from height, so the box keeps the panel's height and gives back the
/// width it does not need. A tall frame inside a wide dock is a tall strip in
/// the middle of it — which is exactly what it will be in the file, which is
/// the whole reason for looking at it this way rather than imagining it.
function applyRoomFrame() {
  const cell = document.querySelector('#masterBus .mb-cell-3d');
  if (!cell) return;
  const f = roomFrame();
  const framed = roomEdit.on && f.ratio > 0;
  cell.classList.toggle('re-framed', framed);
  cell.style.aspectRatio = framed ? String(f.ratio) : '';
  // The ratio as a bare number as well, for the full view's fit. `aspect-ratio`
  // on its own does not letterbox inside a flex parent — the flex sizing wins
  // in one direction and the box overflows in the other — so the stage works
  // the width out itself against the height it actually has. See `.rv-room`.
  cell.style.setProperty('--rv-ratio', framed ? String(f.ratio) : '');
}

function paintRoomNums() {
  const el = $('reNums');
  if (!el) return;
  const c = roomCamNow();
  const n = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
  el.textContent =
    `depth ${n(c.depth)}  floorY ${n(c.floorY)}  ceilY ${n(c.ceilY)}  `
    + `shiftX ${n(c.shiftX)}  skyAt ${n(c.skyAt)}  ring ${n(c.ring)}`;
  el.dataset.copy = JSON.stringify({
    depth: +n(c.depth), floorY: +n(c.floorY), ceilY: +n(c.ceilY),
    shiftX: +n(c.shiftX), skyAt: +n(c.skyAt), ring: +n(c.ring),
  });
  for (const b of document.querySelectorAll('#reFrames .re-btn')) {
    b.classList.toggle('active', b.dataset.frame === roomEdit.frame);
  }
  for (const b of document.querySelectorAll('#reLayers .re-layer-name')) {
    b.classList.toggle('active', roomLayerOn(b.dataset.layer));
  }
  const fillBgBtn = $('reGrainFillBg');
  if (fillBgBtn) fillBgBtn.classList.toggle('active', !!roomEdit.grainFillBg);
  const fillBox = $('reGrainFill');
  if (fillBox) fillBox.checked = !!roomEdit.grainFill;
  const thickBox = $('reLeadThick');
  if (thickBox) thickBox.checked = !!roomEdit.leadThick;
  const mistBox = $('reMist');
  if (mistBox) mistBox.checked = !!roomEdit.mist;
  const fogBox = $('reFog');
  if (fogBox) fogBox.checked = !!roomEdit.fog;
  for (const b of document.querySelectorAll('#reLayers .re-occ')) {
    b.classList.toggle('active', roomOccludeOn(b.dataset.occlude));
  }
  for (const b of document.querySelectorAll('#reStreams .re-btn')) {
    b.classList.toggle('active', roomStreamOn(b.dataset.stream));
  }
  for (const b of document.querySelectorAll('#reChunks .re-btn')) {
    b.classList.toggle('active', +b.dataset.chunk === roomEdit.chunk);
  }
}

/// The layer stack: one row each, highest at the top.
///
/// Stacked rather than laid in a line because the list *is* the hierarchy — the
/// order decides who is drawn first and therefore who is seen — and a hierarchy
/// read left to right is a hierarchy nobody reads. Top to bottom is how every
/// other stack of layers is written down.
///
/// Rebuilt whenever the order changes, unlike the other chip rows, which are
/// built once and only ever have their `active` class flipped.
function buildRoomLayers() {
  const box = $('reLayers');
  if (!box) return;
  box.innerHTML = '';
  // The drawn layers in hierarchy order, then the ones that are not in the
  // room at all. Listing only `roomOrder()` dropped the Data block off the
  // stack entirely — it is still a layer you turn on and off, it just has no
  // place in an order it is not part of.
  const listed = [
    ...roomOrder(),
    ...ROOM_LAYERS.filter((l) => l.gl === false).map((l) => l.key),
  ];
  for (const key of listed) {
    const l = ROOM_LAYERS.find((x) => x.key === key);
    if (!l) continue;
    const drawn = l.gl !== false;
    const row = document.createElement('div');
    row.className = drawn ? 're-layer' : 're-layer re-layer-off-stage';
    row.dataset.layer = l.key;
    row.draggable = drawn;

    // The grip is the whole row, but only this says so. Nothing to grip on a
    // layer that is not in the room's draw order.
    const grip = document.createElement('span');
    grip.className = 're-grip';
    grip.textContent = drawn ? '⠿' : '';
    if (drawn) {
      grip.title = 'Drag to move this layer up or down the hierarchy. Higher is '
        + 'drawn first, so with occlusion on it is the one you see. Everything '
        + 'here is drawn additively, so until something occludes, the order '
        + 'makes no difference at all.';
    }
    row.appendChild(grip);

    const b = document.createElement('button');
    b.className = 're-btn re-layer-name';
    b.dataset.layer = l.key;
    b.textContent = l.label;
    b.title = l.hint;
    b.onclick = () => {
      roomEdit.layers[l.key] = !roomLayerOn(l.key);
      saveRoomLayers();
      paintRoomNums();
      paintRoomData();
    };
    row.appendChild(b);

    // Its own switch, per layer, because "does this hide things" is a different
    // question from "is this drawn" and the answer differs by layer: a terrain
    // that masks the sky is a landscape, and a wireframe box that masks
    // everything inside it is an empty box.
    //
    // Only for the layers the renderer draws. The Data block is type printed on
    // the back wall rather than geometry in the scene, so it has nothing to
    // occlude with and nothing to be occluded by — and a switch that does
    // nothing is worse than a missing one.
    if (drawn) {
      const o = document.createElement('button');
      o.className = 're-btn re-occ';
      o.dataset.occlude = l.key;
      o.textContent = '◑';
      o.title = `Occlusion for ${l.label}: stand in the way of every layer below `
        + 'this one, instead of adding light to it. It masks with the geometry it '
        + 'actually has, so a surface hides a great deal and a few wireframe '
        + 'lines hide very little.';
      o.onclick = () => {
        roomEdit.occlude[l.key] = !roomOccludeOn(l.key);
        saveRoomHierarchy();
        buildRoomLayers();
      };
      row.appendChild(o);
    }
    box.appendChild(row);
  }
  // Said out loud rather than left to be discovered: with nothing occluding,
  // dragging these around changes nothing, because additive blending does not
  // care what order it happens in.
  const live = roomHierarchyLive();
  box.classList.toggle('re-flat', !live);
  const tag = box.parentElement?.querySelector('.re-tag');
  if (tag) {
    tag.title = live
      ? 'Highest first. A layer with occlusion on is drawn before the ones below '
        + 'it, so it is the one you see where they meet.'
      : 'Nothing is occluding, so this order does nothing yet — the room is drawn '
        + 'additively and addition does not care what order it happens in. Turn '
        + 'on occlusion for a layer and its place in this list starts to matter.';
  }
  wireRoomLayerDrag(box);
  paintRoomNums();
}

/// Dragging a layer up or down the stack.
///
/// The native drag events rather than pointer maths, because the room's own
/// pointer handling is a camera drag and the two would fight over the same
/// gestures. This is a list being reordered, which is what these events are
/// for.
function wireRoomLayerDrag(box) {
  let from = null;
  box.ondragstart = (e) => {
    const row = e.target.closest?.('.re-layer');
    if (!row) return;
    from = row.dataset.layer;
    row.classList.add('re-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox will not start a drag without something on the transfer.
    try { e.dataTransfer.setData('text/plain', from); } catch {}
  };
  box.ondragend = () => {
    from = null;
    for (const r of box.querySelectorAll('.re-layer')) {
      r.classList.remove('re-dragging', 're-over');
    }
  };
  box.ondragover = (e) => {
    if (!from) return;
    e.preventDefault();
    const row = e.target.closest?.('.re-layer');
    for (const r of box.querySelectorAll('.re-layer')) r.classList.toggle('re-over', r === row);
  };
  box.ondrop = (e) => {
    if (!from) return;
    e.preventDefault();
    const row = e.target.closest?.('.re-layer');
    if (!row || row.dataset.layer === from) return;
    const order = roomOrder().filter((k) => k !== from);
    order.splice(order.indexOf(row.dataset.layer), 0, from);
    roomEdit.order = order;
    saveRoomHierarchy();
    buildRoomLayers();
  };
}

function buildRoomChunks() {
  const box = $('reChunks');
  if (!box || box.children.length) return;
  for (const n of ROOM_CHUNKS) {
    const b = document.createElement('button');
    b.className = 're-btn';
    b.dataset.chunk = String(n);
    b.textContent = String(n);
    b.title = `Rows travel in blocks of ${n}, every other block running the other way.`;
    b.onclick = () => { roomEdit.chunk = n; saveRoomData(); paintRoomNums(); paintRoomData(); };
    box.appendChild(b);
  }
  const ring = $('reRing');
  if (ring) {
    ring.value = String(Math.round(roomEdit.ringScale * 100));
    ring.oninput = () => {
      roomEdit.ringScale = Math.max(0.15, Math.min(3, ring.value / 100));
      paintRoomNums();
    };
    ring.onchange = saveRoomData;
  }
  const edge = $('reRingEdge');
  if (edge) {
    edge.value = String(Math.round(roomEdit.ringEdge * 1000));
    edge.oninput = () => {
      roomEdit.ringEdge = Math.max(0, Math.min(0.25, edge.value / 1000));
    };
    edge.onchange = saveRoomData;
  }
  const pts = $('reRingPoints');
  if (pts) {
    pts.value = String(Math.round(roomEdit.ringPoints));
    pts.oninput = () => {
      roomEdit.ringPoints = Math.max(48, Math.min(2048, Math.round(pts.value)));
    };
    pts.onchange = saveRoomData;
  }
  const thick = $('reLeadThick');
  if (thick) {
    thick.checked = !!roomEdit.leadThick;
    thick.onchange = () => {
      roomEdit.leadThick = thick.checked;
      saveRoomData();
      paintRoomNums();
    };
  }
  const fog = $('reFog');
  if (fog) {
    fog.checked = !!roomEdit.fog;
    fog.onchange = () => { roomEdit.fog = fog.checked; saveRoomData(); paintRoomNums(); };
  }
  const fogType = $('reFogType');
  if (fogType) {
    fogType.value = String(roomEdit.fogType);
    fogType.onchange = () => {
      roomEdit.fogType = Math.max(0, Math.min(3, +fogType.value | 0));
      saveRoomData();
    };
  }
  const fogDen = $('reFogDensity');
  if (fogDen) {
    fogDen.value = String(Math.round(roomEdit.fogDensity * 100));
    fogDen.oninput = () => {
      roomEdit.fogDensity = Math.max(0, Math.min(2, fogDen.value / 100));
    };
    fogDen.onchange = saveRoomData;
  }
  const fogCol = $('reFogColour');
  if (fogCol) {
    fogCol.value = roomEdit.fogColour;
    fogCol.oninput = () => { roomEdit.fogColour = fogCol.value; };
    fogCol.onchange = saveRoomData;
  }
  const mist = $('reMist');
  if (mist) {
    mist.checked = !!roomEdit.mist;
    mist.onchange = () => {
      roomEdit.mist = mist.checked;
      saveRoomData();
      paintRoomNums();
    };
  }
  const mistAmt = $('reMistAmount');
  if (mistAmt) {
    mistAmt.value = String(Math.round(roomEdit.mistAmount * 100));
    mistAmt.oninput = () => {
      roomEdit.mistAmount = Math.max(0.06, Math.min(1, mistAmt.value / 100));
    };
    mistAmt.onchange = saveRoomData;
  }
  const mistLen = $('reMistLength');
  if (mistLen) {
    mistLen.value = String(Math.round(roomEdit.mistLength * 1000));
    mistLen.oninput = () => {
      roomEdit.mistLength = Math.max(0.004, Math.min(0.6, mistLen.value / 1000));
    };
    mistLen.onchange = saveRoomData;
  }
  const fill = $('reGrainFill');
  if (fill) {
    fill.checked = !!roomEdit.grainFill;
    fill.onchange = () => {
      roomEdit.grainFill = fill.checked;
      saveRoomData();
      paintRoomNums();
    };
  }
  const fillBg = $('reGrainFillBg');
  if (fillBg) {
    fillBg.onclick = () => {
      roomEdit.grainFillBg = !roomEdit.grainFillBg;
      saveRoomData();
      paintRoomNums();
    };
  }
  const fillCol = $('reGrainFillColour');
  if (fillCol) {
    fillCol.value = roomEdit.grainFillColour;
    fillCol.oninput = () => {
      roomEdit.grainFillColour = fillCol.value;
      // Picking a colour is asking for that colour, so it stops filling with
      // the background — otherwise the swatch would sit there doing nothing.
      roomEdit.grainFillBg = false;
      paintRoomNums();
    };
    fillCol.onchange = saveRoomData;
  }
  const drive = $('reRingDrive');
  if (drive) {
    drive.value = String(Math.round(roomEdit.ringDrive * 100));
    drive.oninput = () => {
      roomEdit.ringDrive = Math.max(0, Math.min(8, drive.value / 100));
    };
    drive.onchange = saveRoomData;
  }
  const dens = $('reGrainDensity');
  if (dens) {
    dens.value = String(Math.round(roomEdit.grainDensity * 100));
    dens.oninput = () => {
      roomEdit.grainDensity = Math.max(0.04, Math.min(1, dens.value / 100));
    };
    dens.onchange = saveRoomData;
  }
  const bright = $('reGrainBright');
  if (bright) {
    bright.value = String(Math.round(roomEdit.grainBright * 100));
    bright.oninput = () => {
      roomEdit.grainBright = Math.max(0.15, Math.min(3, bright.value / 100));
    };
    bright.onchange = saveRoomData;
  }
  const slider = $('reOpacity');
  if (slider) {
    slider.value = String(Math.round(roomEdit.opacity * 100));
    slider.oninput = () => {
      roomEdit.opacity = Math.max(0.05, Math.min(1, slider.value / 100));
      paintRoomData();
    };
    slider.onchange = saveRoomData;
  }
}

function buildRoomFrames() {
  const box = $('reFrames');
  if (!box || box.children.length) return;
  for (const f of ROOM_FRAMES) {
    const b = document.createElement('button');
    b.className = 're-btn';
    b.dataset.frame = f.key;
    b.textContent = f.label;
    b.title = f.ratio > 0
      ? `Pose the room for a ${f.label} frame. Its camera is kept separately.`
      : "The dock's own shape.";
    b.onclick = () => {
      roomEdit.frame = f.key;
      applyRoomFrame();
      paintRoomNums();
    };
    box.appendChild(b);
  }
}

function toggleRoomEdit() {
  roomEdit.on = !roomEdit.on;
  buildRoomLayers();
  buildRoomStreams();
  buildRoomChunks();
  buildRoomFrames();
  $('masterBus')?.classList.toggle('room-editing', roomEdit.on);
  $('roomEdit')?.classList.toggle('hidden', !roomEdit.on);
  $('roomEditOpen')?.classList.toggle('on', roomEdit.on);
  applyRoomFrame();
  paintRoomNums();
  // Straight away, rather than on the next meter poll — which does not come at
  // all when nothing is playing, so opening the editor on a stopped transport
  // showed an empty corner.
  paintRoomData();
}

// ───────────────────────────────────────────────────── the room, at full size ──
//
// A third workspace beside Browse and Edit: the room as big as the window will
// give it, with every control it has laid out beside it instead of floating in
// the corner of a canvas the size of a postcard.
//
// **Built by moving, not by copying.** The room, its controls, the transport
// and the video button are the elements the dock already owns. This view
// borrows them and hands them back. There is no second canvas, no second panel
// and no second set of handlers, so there is nothing here that can fall out of
// step with the dock's version of the same thing.
//
// That is not tidiness. This program has shipped that exact fault twice: the
// live room and the exported film kept their own background colour and drifted
// (`--sink` against `--bg`), and the theme editor rebuilt its swatches from
// scratch under the colour panel that was using them. A control that exists
// once cannot disagree with itself.

/// Where a borrowed element came from, so it can be put back exactly.
///
/// The parent on its own is not enough. An element appended back to its old
/// parent has still moved — it lands at the end — and `#transportBar` returning
/// *after* the dock instead of before it is a different page. The next sibling
/// is what actually pins the place.
const roomBorrowed = new Map();

function roomAdopt(id, hostId) {
  const el = $(id), host = $(hostId);
  if (!el || !host || el.parentNode === host) return;
  if (!roomBorrowed.has(id)) {
    roomBorrowed.set(id, { parent: el.parentNode, next: el.nextSibling });
  }
  host.appendChild(el);
}

function roomReleaseAll() {
  for (const [id, home] of roomBorrowed) {
    const el = $(id);
    if (el && home.parent) home.parent.insertBefore(el, home.next);
  }
  roomBorrowed.clear();
}

/// What the full view borrows, and where each piece goes.
///
/// The frame selector is taken out of the control list and put over the room:
/// the frame shape is a question about the picture being composed, so it
/// belongs above the picture rather than at the bottom of a column of settings.
const ROOM_VIEW_PARTS = [
  ['masterBus', 'roomStageRoom'],
  ['roomEdit', 'roomAdminBody'],
  ['reFrameRow', 'roomStageBar'],
  ['transportBar', 'roomFoot'],
  ['videoBtn', 'roomFoot'],
];

function enterRoomView() {
  // The controls are the whole point of this view, so they are open here
  // whether or not the dock's overlay had been opened. Leaving `roomEdit.on`
  // false would give a full-screen room and an empty panel beside it.
  roomEdit.on = true;
  buildRoomLayers();
  buildRoomStreams();
  buildRoomChunks();
  buildRoomFrames();
  $('roomEdit')?.classList.remove('hidden');
  $('masterBus')?.classList.add('room-editing');
  $('roomEditOpen')?.classList.add('on');

  for (const [id, host] of ROOM_VIEW_PARTS) roomAdopt(id, host);
  // The transport is hidden by mode and this is a mode that wants it.
  $('transportBar')?.classList.remove('hidden');
  $('videoBtn')?.classList.remove('hidden');
  $('roomView')?.classList.remove('hidden');

  setRoomAdminWidth(roomAdminWidth(), { save: false });
  rgPanel();
  rpPanel();
  applyRoomPaintCss();
  applyRoomFrame();
  paintRoomNums();
  paintRoomData();
}

/// The two tabs. The controls and the palette are both long enough to need the
/// whole column, and stacking them puts everything below the fold behind a
/// scroll past something unrelated.
function wireRoomTabs() {
  for (const b of document.querySelectorAll('#roomAdmin .rv-tab')) {
    b.onclick = () => {
      const want = b.dataset.rvtab;
      for (const o of document.querySelectorAll('#roomAdmin .rv-tab')) {
        o.classList.toggle('active', o === b);
      }
      $('roomAdminBody')?.classList.toggle('hidden', want !== 'controls');
      $('roomGeomBody')?.classList.toggle('hidden', want !== 'geom');
      $('roomPaintBody')?.classList.toggle('hidden', want !== 'paint');
      if (want === 'paint') rpPanel();
      if (want === 'geom') rgPanel();
    };
  }
}
wireRoomTabs();

// What was being used last time. Before the first frame, so the room is never
// drawn once in the theme's colours and then again in the palette's.
rpRestore();

function leaveRoomView() {
  $('roomView')?.classList.add('hidden');
  roomReleaseAll();
  // Put the overlay back to shut. It was forced open on the way in, and a
  // panel that opens itself over the dock's room because you visited another
  // workspace is a setting changed behind your back.
  roomEdit.on = false;
  $('roomEdit')?.classList.add('hidden');
  $('masterBus')?.classList.remove('room-editing');
  $('roomEditOpen')?.classList.remove('on');
  applyRoomFrame();
}

const ROOM_ADMIN_STORE = 'roomAdminW';
const ROOM_ADMIN_MIN = 210;
const ROOM_ADMIN_MAX = 620;

function roomAdminWidth() {
  const n = parseInt(localStorage.getItem(ROOM_ADMIN_STORE) || '', 10);
  return Number.isFinite(n) ? n : 300;
}

function setRoomAdminWidth(px, { save = true } = {}) {
  const v = Math.round(Math.min(ROOM_ADMIN_MAX, Math.max(ROOM_ADMIN_MIN, px)));
  $('roomAdmin')?.style.setProperty('--rv-admin-w', `${v}px`);
  if (save) {
    try { localStorage.setItem(ROOM_ADMIN_STORE, String(v)); } catch { /* private mode */ }
  }
}

function wireRoomGrip() {
  const grip = $('roomGrip'), panel = $('roomAdmin');
  if (!grip || !panel) return;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    document.body.classList.add('resizing-panel');
    // Measured from the panel's own left edge, so the width tracks the pointer
    // exactly instead of drifting by wherever inside the grip the drag began.
    const left = panel.getBoundingClientRect().left;
    const move = (ev) => setRoomAdminWidth(ev.clientX - left, { save: false });
    const up = (ev) => {
      grip.releasePointerCapture(e.pointerId);
      grip.classList.remove('dragging');
      document.body.classList.remove('resizing-panel');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setRoomAdminWidth(ev.clientX - left);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => setRoomAdminWidth(300));
}
wireRoomGrip();

/// Which part of the room a drag has hold of.
///
/// Two zones rather than two modifier keys: a modifier is a thing you have to
/// be told and a zone is a thing you find. The ring hangs `skyAt` of the way up
/// the room, so it sits `1 - skyAt` of the way down the canvas — the top third
/// contains it at every setting it is usable at.
function roomZoneAt(y, h) {
  return y < h * 0.34 ? 'sky' : 'camera';
}

(function wireRoomDrag() {
  const gl = $('visGl');
  if (!gl) return;

  gl.addEventListener('pointerdown', (e) => {
    if (!roomEdit.on) return;
    const r = gl.getBoundingClientRect();
    roomEdit.drag = {
      zone: roomZoneAt(e.clientY - r.top, r.height),
      x: e.clientX, y: e.clientY, w: r.width, h: r.height,
      cam: roomCamNow(),
    };
    gl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  gl.addEventListener('pointermove', (e) => {
    const d = roomEdit.drag;
    if (!d) return;
    const dx = (e.clientX - d.x) / Math.max(1, d.w);
    const dy = (e.clientY - d.y) / Math.max(1, d.h);
    const c = { ...d.cam };

    if (d.zone === 'sky') {
      // The ring: how far up the room it hangs, and how big across it is.
      c.skyAt = Math.max(0.05, Math.min(0.98, d.cam.skyAt - dy));
      c.ring = Math.max(0.02, Math.min(0.6, d.cam.ring + dx * 0.5));
    } else {
      // The camera.
      //
      // The room's height is held and its *asymmetry about zero* moves, because
      // that asymmetry is the tilt. `floorY` and `ceilY` are not two
      // independent numbers, and offering them as two would be two controls for
      // one thing — which is the mistake a panel of fields makes by its nature.
      //
      // The horizon goes where the hand goes. Drag down and the horizon comes
      // down with it, which shows less floor — the opposite convention, where
      // dragging down tilts the camera down and reveals *more* floor, is how an
      // orbit control behaves, and this is not an orbit control. Nothing here
      // is a camera you fly; it is a room you take hold of.
      //
      // The floor's near edge is pinned to the bottom of the frame by
      // construction — it sits at `floorY`, which is the frustum's bottom — so
      // what a vertical drag changes is how high the horizon sits above it, and
      // that is the whole of the tilt.
      const h = d.cam.ceilY - d.cam.floorY;
      const eye = Math.max(0.02, Math.min(0.98, (-d.cam.floorY) / h - dy));
      c.floorY = -eye * h;
      c.ceilY = (1 - eye) * h;
      // Sideways is the same off-axis trick and the same rule: the vanishing
      // point follows the hand. Shifting the frustum right swings the view
      // right, which moves the vanishing point *left* in the frame, so the sign
      // is against the drag.
      c.shiftX = Math.max(-1, Math.min(1, d.cam.shiftX - dx * 2));
    }
    roomEdit.cams[roomEdit.frame] = c;
    paintRoomNums();
  });

  const end = (e) => {
    if (!roomEdit.drag) return;
    roomEdit.drag = null;
    try { gl.releasePointerCapture(e.pointerId); } catch {}
    saveRoomCameras();
  };
  gl.addEventListener('pointerup', end);
  gl.addEventListener('pointercancel', end);

  // Depth is a scroll because it is the one dimension not on the screen to be
  // grabbed. Exponential, so the room lengthens by the same proportion per
  // notch wherever it already is.
  gl.addEventListener('wheel', (e) => {
    if (!roomEdit.on) return;
    e.preventDefault();
    const c = roomCamNow();
    c.depth = Math.max(0.2, Math.min(12, c.depth * Math.exp(-e.deltaY * 0.0015)));
    roomEdit.cams[roomEdit.frame] = c;
    paintRoomNums();
    saveRoomCameras();
  }, { passive: false });
})();

/// The streams a grain carries.
///
/// Every one of these is a real number the schedule is working to — the same
/// array `api_grains` sends the swarm and the braid, read column by column
/// rather than plotted. Nothing here is invented for the look of it.
const ROOM_STREAMS = [
  { key: 'idx', label: 'IDX', w: 6, get: (g) => g[7], fmt: (v) => String(Math.round(v)) },
  { key: 'out', label: 'OUT', w: 8, get: (g, sr) => g[0] / sr, fmt: (v) => v.toFixed(3) },
  { key: 'src', label: 'SRC', w: 8, get: (g, sr) => g[1] / sr, fmt: (v) => v.toFixed(3) },
  { key: 'size', label: 'SIZE', w: 7, get: (g, sr) => (g[2] / sr) * 1000, fmt: (v) => v.toFixed(1) },
  { key: 'pitch', label: 'PIT', w: 7, get: (g) => g[3], fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { key: 'rms', label: 'RMS', w: 7, get: (g) => g[4], fmt: (v) => v.toFixed(4) },
  { key: 'brt', label: 'BRT', w: 7, get: (g) => g[5], fmt: (v) => v.toFixed(4) },
  { key: 'pan', label: 'PAN', w: 7, get: (g) => g[6], fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
];

/// One line of the grain block, in pixels. Matches `.room-data` in the
/// stylesheet, and has to: the fitting counts whole lines against the wall's
/// height, so a disagreement here spills text past the bottom of the room.
const ROOM_LINE = 9;

/// The width of one character, measured once.
///
/// The layout is counted in characters — every column is a character width and
/// the fitting decides in whole columns — so the number has to come from the
/// face actually in use rather than from an assumption about it.
function roomChPx(el) {
  if (roomChPx.v) return roomChPx.v;
  const probe = document.createElement('span');
  probe.className = 'room-data';
  probe.style.cssText = 'position:absolute;visibility:hidden;width:auto;height:auto;';
  probe.textContent = '0'.repeat(40);
  (el.parentElement || document.body).appendChild(probe);
  const w = probe.offsetWidth / 40;
  probe.remove();
  roomChPx.v = w > 0 ? w : 5.1;
  return roomChPx.v;
}

/// Where the room's back wall lands on screen, in canvas pixels.
///
/// The same projection the renderer uses, done once in JavaScript so the data
/// can be *printed on the wall* rather than floated in front of it. The room is
/// a box with parallel walls, so the far rectangle has the same world extent as
/// the near one and differs only by its depth — which under the frustum makes
/// it `1 / (1 + depth)` of the size, offset by whatever `shiftX` has done to
/// the vanishing point.
///
/// Derived rather than measured, because there is nothing to measure: the wall
/// is drawn by the GPU and never exists as an element.
function roomBackWall(w, h, cam) {
  // A hidden panel measures zero, and a zero width makes the aspect zero, which
  // makes the frustum's half-width zero, which divides. Everything downstream
  // then becomes NaN and lands in a style attribute, where it is silent.
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0, w: 1, h: 1, k: 1 };
  // The camera it is being drawn with, which offline is not the one on screen —
  // the film is shot with the camera posed for its own shape. See
  // `roomCameraForAspect`.
  const c = cam ? vgCamera(cam) : roomCamNow();
  const yb = c.floorY, yt = c.ceilY;
  const hh = yt - yb;
  const aspect = w / h;
  const halfW = hh * 0.5 * aspect;
  const sx = c.shiftX * halfW;
  const k = 1 / (1 + c.depth);

  // Frustum: x_ndc = x/(halfW(1+depth)) - sx/halfW, and likewise up.
  const xNdc = (x) => x / (halfW * (1 + c.depth)) - sx / halfW;
  const yNdc = (y) => (2 * y) / (hh * (1 + c.depth)) - (yb + yt) / hh;

  const x0 = (xNdc(-halfW) + 1) / 2 * w;
  const x1 = (xNdc(halfW) + 1) / 2 * w;
  const yTop = (1 - yNdc(yt)) / 2 * h;
  const yBot = (1 - yNdc(yb)) / 2 * h;
  return { x: x0, y: yTop, w: Math.max(1, x1 - x0), h: Math.max(1, yBot - yTop), k };
}

/// One cell, exactly `w` characters wide, whatever it was handed.
///
/// Short values are padded and long ones are cut. Nothing is allowed to widen
/// its column: a single grain with an unusual number in it would otherwise
/// shove every column after it sideways for one frame and back again the next,
/// which reads as the whole block twitching.
function fitCell(v, w) {
  const t = String(v);
  if (t.length > w) return t.slice(0, w).replace(/\.$/, ' ');
  return t.padStart(w);
}

/// Which columns are up. A few by default: all eight at once is a wall.
const ROOM_STREAM_DEFAULT = ['idx', 'src', 'size', 'pitch', 'rms'];

function roomStreamOn(key) {
  const set = roomEdit.streams;
  return set ? set[key] === true : ROOM_STREAM_DEFAULT.includes(key);
}

function saveRoomStreams() {
  try { localStorage.setItem('roomStreams', JSON.stringify(roomEdit.streams || {})); } catch {}
}

/// The grain block: the schedule itself, running past.
///
/// Not a summary. The rows are grains — the ones nearest the playhead, in the
/// order they are laid down — so what you are reading is the same list the
/// cloud is drawing and the engine is working through, arriving as fast as the
/// playhead crosses it.
///
/// One aggregate line at the top, because rate, load and the drop counter are
/// the three things you want without having to add anything up. The drop
/// counter especially: it is the pool being full and grains being thrown away,
/// which is audible and which nothing else on screen says.
/// The grain block's lines, worked out and handed back rather than written.
///
/// **One builder, two destinations.** The live block is HTML behind the canvas
/// and the filmed one is type drawn into the export's own 2D context, and they
/// have to be the same wall of numbers — the film is meant to be what the room
/// looks like. Two builders would be two things to keep in step, which is the
/// fault this program has shipped over the background colour and over five
/// draw calls' worth of palette.
///
/// Everything that differs between the two is an argument: the wall it is
/// printed on, how wide a character is there, the schedule, where the playhead
/// is, and the header — which offline has no engine to ask about load or drops.
function roomDataBlock({ wall, ch, line: lineH, sched, position, chunk, head }) {
  const sr = sched?.sampleRate || 44100;
  const all = sched?.grains || [];
  const lines = Math.max(0, Math.floor(wall.h / (lineH || ROOM_LINE)) - 2);
  const rows = Math.max(0, Math.min(64, lines));

  // ── every stream has a home ──
  //
  // **A column's place is fixed, whether or not it is switched on.** Packing
  // only the columns that were on meant turning one off pulled every column
  // after it to the left — switch off IDX and SRC lands where OUT was, so a
  // number you had been reading in one place is now a different number in the
  // same place. The block is a readout you watch while it runs, and a readout
  // whose columns move under you cannot be watched.
  const room = Math.max(0, Math.floor(wall.w / ch));
  const slots = [];
  let at = 0;
  for (const c of ROOM_STREAMS) {
    // Whole columns only. A column that does not fit is left out rather than
    // clipped down the middle of its numbers, which would read as damage.
    if (at + c.w <= room) slots.push({ c, on: roomStreamOn(c.key) });
    at += c.w + 1;
  }
  const cols = slots;

  // ── the wall is tiled, not stretched ──
  //
  // One block of columns is narrower than the back wall and the schedule around
  // the playhead is shorter than the wall is tall, so printing one of each left
  // the wall mostly empty. **Repeated instead of resized**: the type stays the
  // size it is — it is small type printed on a wall, and type on a wall does not
  // grow because the wall is big — and what fills the space is more of it.
  //
  // A tile ends at its last *switched-on* column. The empty places after that
  // are still reserved — nothing moves — but they are not printed, or every
  // tile would carry the width of the streams that are off and the tiles would
  // sit that far apart. Leading empties are kept, because those hold the
  // columns still.
  let lastOn = -1;
  for (let i = 0; i < cols.length; i++) if (cols[i].on) lastOn = i;
  const tileCols = lastOn >= 0 ? cols.slice(0, lastOn + 1) : [];
  const tileChars = tileCols.length
    ? tileCols.reduce((w, s2) => w + s2.c.w, 0) + (tileCols.length - 1)
    : 0;
  // A gap between tiles, or two of them read as one row of columns.
  const TILE_GAP = 3;
  const across = tileChars > 0
    ? Math.max(1, Math.floor((room + TILE_GAP) / (tileChars + TILE_GAP)))
    : 1;

  // Around the playhead, so it runs with the sound instead of sitting still at
  // the top of the file.
  let first = 0;
  for (let i = 0; i < all.length; i++) { if (all[i][0] >= position) { first = i; break; } }
  const window = all.slice(Math.max(0, first - 1), Math.max(0, first - 1) + rows);

  const line = (cells) => cells.join(' ');
  /// One tile of a row, with the switched-off streams standing empty in their
  /// own places.
  const slotLine = (cell) => line(tileCols.map((s) => (s.on ? cell(s.c) : ' '.repeat(s.c.w))));
  /// That tile, repeated across the wall.
  const tiled = (text) => {
    if (across <= 1) return text;
    const out2 = [];
    for (let t = 0; t < across; t++) out2.push(text);
    return out2.join(' '.repeat(TILE_GAP));
  };

  const out = [];
  // Trimmed to the wall like everything else. Clipping alone would leave it
  // cut through the middle of a number, which reads as a fault rather than as
  // a wall that ran out.
  out.push({ kind: 'head', text: head.slice(0, room) });
  if (cols.some((s2) => s2.on)) {
    out.push({ kind: 'hdr', text: tiled(slotLine((c) => fitCell(c.label, c.w))) });
    // Always `rows` lines, padded with blanks. Rendering only the grains in
    // range let the block grow and shrink under the sound, which moves
    // everything else in the corner with it.
    //
    // Laid down in blocks of `chunk` with a blank line between, and every other
    // block reversed. Reversing is what makes the movement readable: the
    // schedule runs one way, so a single column of it slides uniformly and at
    // this size that looks like nothing moving at all. Against a neighbour
    // going the other way it is obvious.
    const blank = tiled(line(tileCols.map((s2) => ' '.repeat(s2.c.w))));
    let printed = 0;
    let block = 0;
    while (printed < rows) {
      const take = Math.min(chunk, rows - printed);
      const slice = [];
      for (let i = 0; i < take; i++) {
        // Down the wall the same way: when the schedule around the playhead
        // runs out, it starts again rather than leaving the rest of the wall
        // blank. A grain repeated further down is the same grain, which is the
        // whole idea of a tile.
        const row = window.length ? window[(printed + i) % window.length] : null;
        slice.push(row
          ? tiled(slotLine((c) => fitCell(c.fmt(c.get(row, sr)), c.w)))
          : blank);
      }
      if (block % 2 === 1) slice.reverse();
      for (const text of slice) out.push({ kind: 'row', text });
      printed += take;
      block++;
      // One blank line between blocks, and never one left hanging at the end.
      if (printed < rows) { out.push({ kind: 'gap', text: blank }); printed++; }
    }
  }
  return out;
}

/// The header line: what the engine is doing, rather than what the schedule is.
///
/// `live` false is the filmed one, which has no running engine to ask — the
/// document's own settings are still true, and the load and the drop count are
/// a property of playback rather than of the sound, so they are left out.
function roomDataHead(live) {
  const st = state.stretchDraft || {};
  const g = state.grainDraft || {};
  const l = live ? (engine.load || null) : null;
  const win = st.windowMs || 0;
  const auto = !(g.densityHz > 0);
  const rate = auto ? (win > 0 ? (1000 / win) * (g.overlap || 1) : 0) : g.densityHz;
  const drops = live ? Math.round(engine.overflows || 0) : 0;
  const asked = Math.max(1, Math.round(g.layers || 1));
  const running = l && l.layersRunning > 0 ? Math.round(l.layersRunning) : asked;

  // Every field its own width, so the header is the same length whatever the
  // numbers are. A readout that reflows as the values change is one you cannot
  // read while it runs — the eye goes back to finding the column instead of
  // reading it.
  return [
    fitCell(`${rate ? rate.toFixed(0) : '—'}/s`, 6),
    fitCell(`${win.toFixed(0)}ms`, 6),
    fitCell(`L${running}/${asked}`, 6),
    fitCell(`${l ? Math.round(l.now * 100) : 0}%`, 4),
    fitCell(`D${drops}`, 5),
  ].join(' ');
}

/// How far down the wall a line has faded, nought to one.
///
/// The stylesheet says this in five `color-mix` steps against `--wave-2`, and
/// the filmed block has to say the same thing in numbers. Kept here rather than
/// in either caller so the two cannot drift — a wall that faded differently on
/// film would be the same fault as a background that did.
function roomDataAlpha(kind, childIndex) {
  if (kind === 'gap') return 0;
  if (kind === 'head') return 1;
  if (kind === 'hdr') return 0.45;
  // `nth-child` counts every child, the header and the column names included.
  const n = childIndex + 1;
  if (n >= 22) return 0.26;
  if (n >= 15) return 0.38;
  if (n >= 9) return 0.52;
  return 0.70;
}

/// What the block is printed in.
///
/// The palette owns it — `data` is one of its slots — and falls back to the
/// token the stylesheet uses. Resolved to a hex here because the film has to
/// draw it into a 2D context, where `color-mix` and custom properties mean
/// nothing.
function roomDataColour() {
  const d = rpSlot('data');
  if (d.mode === 'flat' && d.colour) return d.colour;
  return rpToken('--wave-2', '#4a9fd8');
}

function paintRoomData() {
  const el = $('roomData');
  if (!el) return;
  const show = roomLayerOn('data');
  el.classList.toggle('hidden', !show);
  if (!show) return;

  const l = engine.load || null;
  const drops = Math.round(engine.overflows || 0);

  // How many rows fit, rather than a number picked once and wrong at every
  // other size. The room is the same box in a dock and on a wall.
  const cell = el.parentElement?.getBoundingClientRect();
  // On the back wall, so it recedes with the room instead of sitting on the
  // glass in front of it.
  const wall = roomBackWall(cell?.width || 300, cell?.height || 150);
  const ch = roomChPx(el);

  const block = roomDataBlock({
    wall,
    ch,
    line: ROOM_LINE,
    sched: state.grains,
    position: engine.position || 0,
    chunk: roomEdit.chunk,
    head: roomDataHead(true),
  });

  const cls = { head: 'rd-head', hdr: 'rd-hdr', row: 'rd-row', gap: 'rd-row rd-gap' };
  el.innerHTML = block.map((b) => `<div class="${cls[b.kind]}">${b.text}</div>`).join('');
  // The block *is* the wall: its box is the wall's box, and anything that does
  // not fit is clipped rather than allowed over the edge. No transform — a
  // scaled block was the previous attempt and it made the type grow and shrink
  // with the room, which is not what printing on a wall looks like.
  el.style.left = `${Math.round(wall.x)}px`;
  el.style.top = `${Math.round(wall.y)}px`;
  el.style.width = `${Math.round(wall.w)}px`;
  el.style.height = `${Math.round(wall.h)}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = '';
  el.style.opacity = String(roomEdit.opacity);
  el.classList.toggle('rd-hot', !!(l && l.worst >= 1) || drops > 0);
}

function buildRoomStreams() {
  const box = $('reStreams');
  if (!box || box.children.length) return;
  for (const c of ROOM_STREAMS) {
    const b = document.createElement('button');
    b.className = 're-btn';
    b.dataset.stream = c.key;
    b.textContent = c.label;
    b.title = `Show the ${c.label} column in the grain block.`;
    b.onclick = () => {
      if (!roomEdit.streams) {
        roomEdit.streams = {};
        for (const d of ROOM_STREAMS) roomEdit.streams[d.key] = ROOM_STREAM_DEFAULT.includes(d.key);
      }
      roomEdit.streams[c.key] = !roomStreamOn(c.key);
      saveRoomStreams();
      paintRoomNums();
      paintRoomData();
    };
    box.appendChild(b);
  }
}

$('roomEditOpen')?.addEventListener('click', toggleRoomEdit);

$('reClear')?.addEventListener('click', () => {
  // The room only. Nothing here is a setting, so there is nothing to save and
  // nothing to put back — the trail and the cloud simply start again.
  visGl?.clear?.();
  paintRoomNums();
});

$('reReset')?.addEventListener('click', () => {
  delete roomEdit.cams[roomEdit.frame];
  saveRoomCameras();
  paintRoomNums();
});

$('reNums')?.addEventListener('click', (e) => {
  navigator.clipboard?.writeText(e.currentTarget.dataset.copy || '').then(
    () => toast('camera copied — paste it into VG_CAMERA in vis-gl.js'),
    () => toast('could not reach the clipboard'),
  );
});

// ─────────────────────────────────────────────────── the box, filling the screen
//
// The panel goes fullscreen, not the canvas.
//
// A fullscreen element is positioned as though it were fixed, and an element
// with `position: fixed` has no `offsetParent` — which is precisely what
// `visGlTick` tests to decide whether anybody is looking at the scene. Take the
// canvas fullscreen and the renderer concludes it is hidden and stops drawing,
// at the exact moment it fills the screen. Taking `#masterBus` instead leaves
// the canvas an ordinary absolute child of a positioned cell, and brings the
// meters along with it, which is what you want at that size anyway: the room
// gets the whole screen bar a narrow column and the numbers stay readable.
//
// Nothing needs resizing by hand. `visGlTick` already reconciles the canvas's
// backing store with its client size on every frame, so the box refills the
// screen on the first frame after the change and again on the way out.
function masterIsFullscreen() {
  return !!document.fullscreenElement && document.fullscreenElement === $('masterBus');
}

async function toggleMasterFullscreen() {
  const el = $('masterBus');
  if (!el) return;
  try {
    if (masterIsFullscreen()) await document.exitFullscreen();
    else if (document.fullscreenElement) {
      // Something else is already filling the screen. Hand it over rather than
      // failing: a request while another element holds it is rejected.
      await document.exitFullscreen();
      await el.requestFullscreen();
    } else await el.requestFullscreen();
  } catch (e) {
    // Refused — an embedded view without the permission, or a gesture the
    // browser will not accept. A toast rather than the box's own corner: that
    // corner is `#mbPeakHz`, which the meter tick rewrites on every update, so
    // a message left there is gone before it can be read.
    toast(`full screen refused — ${e.name}`);
  }
}

// Double-click the room itself. Not the meter column beside it, which is a
// column of numbers and has nothing to gain from the whole screen.
$('masterBus')?.querySelector('.mb-cell-3d')?.addEventListener('dblclick', toggleMasterFullscreen);

async function loadSpectrogram() {
  const f = state.selectedFile;
  if (!f || !state.showSpec) return;
  // Scaled up for the wider following window, but not the whole way. Every
  // column is an FFT on the server and a column of pixels the browser fills one
  // at a time, and following refetches often enough that the full count lands
  // as a hitch. A slightly coarser strip while playing is the better trade —
  // stop, and the next fetch is at full detail again.
  const lane = Math.max(200, Math.min(1200, Math.floor($('lane').clientWidth) || 800));
  const win = peakWindow();
  const span = state.view.to - state.view.from;
  const cols = win && span > 0
    ? Math.min(1600, Math.round(lane * Math.sqrt((win.to - win.from) / span)))
    : lane;
  let url = `/api/spectrogram?p=${encodeURIComponent(f.path)}&cols=${cols}&fft=${state.fftSize}`;
  if (win) {
    url += `&from=${Math.floor(win.from)}&to=${Math.ceil(win.to)}`;
  }
  try { state.spec = await api(url); }
  catch (e) { toast(e.message); return; }
  layoutWaveBuffer();
  drawSpectrogram();
}

function drawSpectrogram() {
  const s = state.spec;
  const canvas = $('specCanvas');
  if (!s || !state.showSpec) return;

  const cols = s.columns;
  const bins = s.bins;
  canvas.width = cols;
  canvas.height = bins;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, bins);
  const out = img.data;

  // A typed array and a lookup table, rather than charCodeAt through a closure
  // and a freshly allocated triple for every pixel. This is close to a million
  // pixels and following the playhead redraws it while the sound is playing, so
  // what happens here is the difference between a scroll and a stutter.
  const raw = atob(s.data);
  const lvl = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) lvl[i] = raw.charCodeAt(i);
  const lut = specRamp();

  const rows = logRows(bins, s.maxHz || 22050);
  const grid = logGrid(lvl, cols, bins, rows);

  for (let c = 0; c < cols; c++) {
    const here = c * bins;
    const left = c > 0 ? here - bins : -1;
    const right = c < cols - 1 ? here + bins : -1;
    for (let b = 0; b < bins; b++) {
      // Relief. Treating the level as a height field and lighting it from the
      // upper left turns a flat wash into something with surfaces: a rising
      // partial catches the light on its leading edge and shades on its
      // trailing one, so a sweep reads as a ridge rather than a smear. The
      // gradient is the plain central difference — cheap, and enough. Off the
      // edge of the picture reads as silence.
      const dx = ((right < 0 ? 0 : grid[right + b]) - (left < 0 ? 0 : grid[left + b])) / 255;
      const dy = ((b < bins - 1 ? grid[here + b + 1] : 0)
                - (b > 0 ? grid[here + b - 1] : 0)) / 255;
      const shade = 1 + (dx - dy) * 1.15 * SPEC_RELIEF;

      // Low frequencies at the bottom, which means flipping the row order.
      const i = ((bins - 1 - b) * cols + c) * 4;
      const k = grid[here + b] * 3;
      const r = lut[k] * shade;
      const g = lut[k + 1] * shade;
      const bl = lut[k + 2] * shade;
      out[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
      out[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      out[i + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
      out[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/// The lowest frequency the picture bothers with.
///
/// Below this is rumble and DC, and stretching an octave nobody is listening to
/// across a third of the height would waste the room the change is meant to buy.
const SPEC_FLOOR_HZ = 30;

/// Which analysis bins each display row covers, on a log frequency axis.
///
/// **The axis was linear, and that was the bug.** An FFT's bins are evenly
/// spaced in hertz, so on a 44.1 kHz file 513 bins reach 22 kHz and everything
/// musical is crushed into the bottom of the picture. Measured on a real file:
/// half the energy sat below bin 4 — 172 Hz — ninety per cent below bin 10, and
/// **nine of the ten deciles of height were exactly zero.** The spectrogram was
/// drawing correctly and had nothing to show in 97% of its rows, which is why
/// making the strip taller made it look more broken rather than less.
///
/// Hearing is roughly logarithmic, so the rows are too: each one covers a fixed
/// musical interval rather than a fixed number of hertz, and an octave at the
/// bottom gets the same room as an octave at the top.
///
/// Cached on the two numbers it depends on, because it is the same table for
/// every column of every redraw and this runs while the sound is playing.
let logRowCache = null;
function logRows(bins, maxHz) {
  if (logRowCache && logRowCache.bins === bins && logRowCache.maxHz === maxHz) {
    return logRowCache.rows;
  }
  const lo = new Int32Array(bins);
  const hi = new Int32Array(bins);
  const fmin = Math.min(SPEC_FLOOR_HZ, maxHz / 2);
  const span = Math.log(maxHz / fmin);
  for (let r = 0; r < bins; r++) {
    // r counts up from the bottom of the picture, which is the low end.
    const f0 = fmin * Math.exp(span * (r / bins));
    const f1 = fmin * Math.exp(span * ((r + 1) / bins));
    let a = Math.floor((f0 / maxHz) * (bins - 1));
    let b = Math.ceil((f1 / maxHz) * (bins - 1));
    a = Math.max(0, Math.min(bins - 1, a));
    b = Math.max(a, Math.min(bins - 1, b));
    lo[r] = a;
    hi[r] = b;
  }
  const rows = { lo, hi };
  logRowCache = { bins, maxHz, rows };
  return rows;
}

/// The levels, remapped onto those rows.
///
/// The **loudest** bin in a row's span rather than the average: near the top one
/// row covers dozens of bins, and averaging a partial with the silence either
/// side of it is how a harmonic disappears from the picture at exactly the
/// frequencies the log axis was meant to reveal.
function logGrid(lvl, cols, bins, rows) {
  const { lo, hi } = rows;
  const grid = new Uint8Array(cols * bins);
  for (let c = 0; c < cols; c++) {
    const here = c * bins;
    for (let r = 0; r < bins; r++) {
      let m = 0;
      const end = hi[r];
      for (let b = lo[r]; b <= end; b++) {
        const v = lvl[here + b];
        if (v > m) m = v;
      }
      grid[here + r] = m;
    }
  }
  return grid;
}

/// The colour ramp as its 256 stops, so a pixel costs three array reads. The
/// levels arrive as bytes, so this loses nothing.
let specRampCache = null;
function specRamp() {
  if (specRampCache) return specRampCache;
  specRampCache = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = specColour(i / 255);
    specRampCache[i * 3] = r;
    specRampCache[i * 3 + 1] = g;
    specRampCache[i * 3 + 2] = b;
  }
  return specRampCache;
}

/// How hard the light rakes across the spectrogram.
const SPEC_RELIEF = 2.6;

/// Level to colour, across the whole spectrum rather than one hue of it.
///
/// A single-hue ramp spends its entire range on brightness, and the eye is poor
/// at ranking brightness — two partials twelve decibels apart look like the same
/// blue, slightly dimmer. Running through hue as well as value gives every step
/// its own name: near-black, indigo, magenta, orange, and white at the top. The
/// stops are spaced so the perceived change is roughly even, which a plain
/// rainbow is not — it bunches in the greens and lies about where the energy is.
const SPEC_STOPS = [
  [0.00, [4, 5, 14]],
  [0.16, [28, 16, 68]],
  [0.34, [88, 24, 118]],
  [0.52, [156, 38, 106]],
  [0.68, [214, 76, 66]],
  [0.83, [244, 148, 38]],
  [0.94, [252, 210, 96]],
  [1.00, [255, 250, 226]],
];

function specColour(v) {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  for (let i = 1; i < SPEC_STOPS.length; i++) {
    const [p1, c1] = SPEC_STOPS[i - 1];
    const [p2, c2] = SPEC_STOPS[i];
    if (t <= p2) {
      const k = p2 === p1 ? 0 : (t - p1) / (p2 - p1);
      return [
        (c1[0] + (c2[0] - c1[0]) * k) | 0,
        (c1[1] + (c2[1] - c1[1]) * k) | 0,
        (c1[2] + (c2[2] - c1[2]) * k) | 0,
      ];
    }
  }
  return SPEC_STOPS[SPEC_STOPS.length - 1][1];
}

// ============================================================= tagging panel

/// What the selected sound itself sounds like, as opposed to what its folder
/// was labelled. Measured from the audio, so it is right even when the name and
/// the folder are not.
let sonicSeq = 0;
async function showSonicTags(file) {
  const box = $('sonicTags');
  if (!box) return;
  const seq = ++sonicSeq;
  box.textContent = '…';
  let r;
  try {
    r = await api(`/api/similar?p=${encodeURIComponent(file.path)}&limit=1`);
  } catch {
    if (seq === sonicSeq) box.textContent = '';
    return;
  }
  // A slower earlier request must not overwrite a newer selection.
  if (seq !== sonicSeq) return;
  const tags = r.tags || [];
  box.innerHTML = tags.length
    ? tags.map((t) => `<span class="sonic-tag">${t}</span>`).join('')
    : '<span class="dim">not measured</span>';

  showHeard(file, r.heard || []);
  fillFileTags(file, r.suggest, r.saved || null);
  showUserTags(file, r.yourTags);
}

// ---------------------------------------------------------- tags of your own

/// Tags you invented, and the ones the system thinks belong here.
///
/// Applied tags are removable chips. Below them are the learned suggestions —
/// dashed, because they are proposals rather than facts — each naming the sound
/// it was inferred from. Clicking one accepts it, which makes this sound an
/// example too, so the next suggestion is better informed.
function showUserTags(file, data) {
  const mine = data?.mine || [];
  const learned = data?.learned || [];
  state.userTags[file.path] = mine;

  const box = $('yourTags');
  box.innerHTML = '';
  if (!mine.length) {
    box.innerHTML = '<span class="dim">none yet</span>';
  }
  for (const tag of mine) {
    const el = document.createElement('span');
    el.className = 'sonic-tag user-tag';
    el.innerHTML = `<span></span><button class="x" title="Remove">×</button>`;
    el.querySelector('span').textContent = tag;
    el.querySelector('.x').onclick = () =>
      setUserTags(file, mine.filter((t) => t !== tag));
    box.appendChild(el);
  }

  const sug = $('learnedTags');
  sug.innerHTML = '';
  for (const s of learned) {
    const el = document.createElement('button');
    el.className = 'sonic-tag user-tag learned';
    el.textContent = '+ ' + s.tag;
    const pct = Math.round(s.score * 100);
    const also = s.support > 1 ? `, and ${s.support - 1} other${s.support > 2 ? 's' : ''}` : '';
    el.title = `${pct}% like ${s.like.split('/').pop()}${also} — click to apply`;
    el.onclick = () => setUserTags(file, [...state.userTags[file.path], s.tag]);
    sug.appendChild(el);
  }

  // Offer words already in use rather than letting three spellings of one idea
  // pile up.
  $('userTagVocab').innerHTML = (data?.vocabulary || [])
    .map((v) => `<option value="${v.replace(/"/g, '&quot;')}">`)
    .join('');
}

async function setUserTags(file, tags) {
  let r;
  try {
    r = await postJSON('/api/usertags', { path: file.path, tags });
  } catch (e) {
    toast('Could not save tag: ' + e.message);
    return;
  }
  showUserTags(file, r);
}

$('addUserTag').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  const file = state.selectedFile;
  const tag = e.target.value.trim();
  if (!file || !tag) return;
  e.target.value = '';
  setUserTags(file, [...(state.userTags[file.path] || []), tag]);
};

/// What the classifier named the sound, as opposed to what it is like.
///
/// A label the model was unsure of is shown faded rather than hidden: a weak
/// guess is still information, and pretending to be certain about it would be
/// worse than showing the number. A borrowed label says whose it is.
function showHeard(file, words) {
  const box = $('heardTags');
  if (!box) return;
  state.heard[file.path] = words;

  if (!words.length) {
    box.innerHTML = '<span class="dim">nothing recognised</span>';
    return;
  }
  // The store keeps more than this; four is what a panel can show without
  // becoming a wall of chips. The rest are in /api/sounds.
  box.innerHTML = words
    .slice(0, 4)
    .map((w) => {
      const faint = w.score < 0.15 ? ' faint' : '';
      const title = w.from
        ? `${(w.score * 100).toFixed(0)}% — heard in ${w.from.split('/').pop()}, not this file`
        : `${(w.score * 100).toFixed(0)}% sure`;
      return `<span class="sonic-tag heard-tag${faint}" title="${title}">${w.label}</span>`;
    })
    .join('');

  const from = words[0].from;
  if (from) {
    box.innerHTML +=
      `<span class="dim borrowed">like ${from.split('/').pop()}</span>`;
  }
}

/// The tag fields describe the selected sound, not the folder it sits in.
///
/// A folder's fields are still editable when no sound is selected — that is
/// what the panel used to be and there is no reason to take it away — but the
/// moment you click a file the fields follow the file.
function fillTagPanel(folder) {
  if (state.selectedFile) return;
  const e = state.tagEdits[folder.name] || {};
  $('editLevel1').value = e.level1 ?? folder.level1;
  $('editLevel2').value = e.level2 ?? folder.level2;
  $('editTags').value = e.tags ?? folder.tags;
  $('editNotes').value = e.notes ?? '';
}

/// Fill the fields for one sound.
///
/// Precedence is edited, then saved, then suggested. The distinction between
/// the last two matters: a suggestion is what the classifier would say, and
/// once someone has saved something — even an empty string — that is a
/// decision, and overwriting it with a fresh guess would undo their work every
/// time they clicked the file.
function fillFileTags(file, suggest, saved) {
  const e = state.tagEdits[file.path] || {};
  const pick = (k) => e[k] ?? saved?.[k] ?? suggest?.[k] ?? '';
  $('editLevel1').value = pick('level1');
  $('editLevel2').value = pick('level2');
  $('editTags').value = pick('tags');
  $('editNotes').value = pick('notes');

  // Say where the values came from, so nobody has to guess whether they are
  // looking at their own work or the machine's.
  $('tagSource').textContent = Object.keys(e).length
    ? 'edited, not yet committed'
    : saved ? 'saved earlier' : 'suggested from the audio and the filename';
}

for (const [id, key] of [['editLevel1', 'level1'], ['editLevel2', 'level2'],
                         ['editTags', 'tags'], ['editNotes', 'notes']]) {
  $(id).onchange = (e) => {
    // Whichever the panel is currently describing.
    const name = state.selectedFile?.path || state.selectedFolder;
    if (!name) return;
    (state.tagEdits[name] ??= {})[key] = e.target.value.trim();
    updateDirty();
    if (state.selectedFile) $('tagSource').textContent = 'edited, not yet committed';
  };
}

function updateDirty() {
  const n = Object.keys(state.tagEdits).length;
  $('dirtyLabel').textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : '';
}

$('discardBtn').onclick = () => {
  state.tagEdits = {};
  updateDirty();
  if (state.selectedFile) selectFile(state.selectedFile);
  else {
    const f = state.folders.find((x) => x.name === state.selectedFolder);
    if (f) fillTagPanel(f);
  }
  toast('Tag edits discarded');
};

$('commitBtn').onclick = async () => {
  const edits = state.tagEdits;
  if (!Object.keys(edits).length) { toast('Nothing to commit'); return; }

  // A key with a slash in it is a file; anything else is a folder name.
  const folders = {}, files = {};
  for (const [k, v] of Object.entries(edits)) {
    (k.includes('/') ? files : folders)[k] = v;
  }
  try {
    const r = await postJSON('/api/save', { folders, files });
    toast(`Committed — ${r.foldersWritten} _TAGS.txt written`);
    state.tagEdits = {};
    updateDirty();
  } catch (e) { toast('Commit failed: ' + e.message); }
};

// ==================================================================== search

/// Rank the library by acoustic similarity to whatever is selected.
///
/// The first run measures every file, which takes a moment; after that the
/// fingerprints live beside the index and it is instant.
$('similarBtn').onclick = async () => {
  const f = state.selectedFile;
  const box = $('searchResults');
  if (!f) { box.innerHTML = '<div class="dim">Select a sound first.</div>'; return; }

  box.innerHTML = '<div class="dim">Listening to the library…</div>';
  let r;
  try {
    r = await api(`/api/similar?p=${encodeURIComponent(f.path)}&limit=40`);
  } catch (e) {
    box.innerHTML = `<div class="dim">${e.message}</div>`;
    return;
  }

  if (!r.results.length) { box.innerHTML = '<div class="dim">Nothing to compare against.</div>'; return; }
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'dim';
  head.textContent = `Like ${f.name} · ${r.indexed} sounds measured`;
  box.appendChild(head);

  for (const hit of r.results) {
    const row = document.createElement('div');
    row.className = 'result';
    row.innerHTML =
      `<span class="mono">${(hit.score * 100).toFixed(0)}%</span> ` +
      `<span>${hit.name}</span> ` +
      `<span class="dim">${hit.category} · ${hit.seconds.toFixed(2)}s · unlike in ${hit.differs}</span>`;
    row.onclick = () => {
      const file = { path: hit.path, name: hit.name };
      selectFile(file);
    };
    box.appendChild(row);
  }
};

$('searchInput').oninput = () => {
  const q = $('searchInput').value.toLowerCase().trim();
  const box = $('searchResults');
  box.innerHTML = '';
  if (!q) return;
  const terms = q.split(/\s+/);
  const hits = state.folders.filter((f) => {
    const hay = `${f.name} ${f.tags} ${f.machine} ${f.categories} ${f.instruments}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  }).slice(0, 60);

  for (const f of hits) {
    const el = document.createElement('div');
    el.className = 'result';
    el.innerHTML = `<div class="name"></div><div class="sub">${folderCount(f)} files · ${f.level1} › ${f.level2}</div>`;
    el.querySelector('.name').textContent = f.name;
    el.onclick = () => { showPane('left', 'browse'); toggleFolder(f.name); };
    box.appendChild(el);
  }
  if (!hits.length) box.innerHTML = '<div class="empty">No matches</div>';
};

// ====================================================================== scan

$('startScan').onclick = async () => {
  try {
    await api('/api/scan', { method: 'POST' });
    $('scanProgress').classList.remove('hidden');
    $('stopScan').classList.remove('hidden');
    $('startScan').disabled = true;
    pollScan();
  } catch (e) { toast(e.message); }
};
$('stopScan').onclick = () => api('/api/scan/stop', { method: 'POST' }).catch(() => {});

async function pollScan() {
  let s;
  try { s = await api('/api/scan'); } catch { return; }
  $('scanFill').style.width = (s.total ? s.done / s.total * 100 : 0) + '%';
  $('scanCurrent').textContent = s.current || (s.running ? 'scanning…' : 'done');
  $('scanCount').textContent = `${s.done}/${s.total}`;

  if (s.running) { setTimeout(pollScan, 400); return; }
  $('startScan').disabled = false;
  $('stopScan').classList.add('hidden');
  state.folderFiles = {};
  state.thumbs = {};
  state.openFolders = {};
  await refresh();
  toast('Scan complete');
}

// ============================================================= folder picker

let pickerPath = '';

async function openPicker(startPath) {
  $('pickerModal').classList.remove('hidden');
  await loadPicker(startPath || '');
}
$('pickLibrary').onclick = () => openPicker(state.library);
$('rescanLibrary').onclick = () => { showPane('left', 'scan'); $('startScan').click(); };
$('pickerClose').onclick = () => $('pickerModal').classList.add('hidden');

async function loadPicker(path) {
  let d;
  try { d = await api(`/api/browse?path=${encodeURIComponent(path)}`); }
  catch (e) { toast(e.message); return; }

  pickerPath = d.path;
  $('pickerPath').textContent = d.path;
  $('pickerUp').disabled = !d.parent;
  $('pickerUp').onclick = () => loadPicker(d.parent);

  const places = $('pickerPlaces');
  places.innerHTML = '';
  for (const p of d.places) {
    const el = document.createElement('div');
    el.className = 'picker-item';
    el.textContent = p.name;
    el.onclick = () => loadPicker(p.path);
    places.appendChild(el);
  }

  const list = $('pickerList');
  list.innerHTML = '';
  if (!d.dirs.length) list.innerHTML = '<div class="empty">No sub-folders here.</div>';
  for (const dir of d.dirs) {
    const el = document.createElement('div');
    el.className = 'picker-item';
    el.textContent = dir.name;
    el.onclick = () => loadPicker(dir.path);
    list.appendChild(el);
  }
}

$('pickerChoose').onclick = async () => {
  try {
    await postJSON('/api/library', { path: pickerPath });
    $('pickerModal').classList.add('hidden');
    toast('Library set — run a scan to index it');
    state.folderFiles = {}; state.thumbs = {}; state.openFolders = {};
    await refresh();
    showPane('left', 'scan');
  } catch (e) { toast(e.message); }
};

// =================================================================== startup

async function refresh() {
  const s = await api('/api/state');
  state.library = s.library;
  $('libraryLabel').textContent = s.library || '';
  $('libraryPath').textContent = s.library || 'none chosen';

  const totals = `
    <div class="stat-row"><span class="k">Files indexed</span><span class="v">${s.files.toLocaleString()}</span></div>
    <div class="stat-row"><span class="k">Folders</span><span class="v">${s.folders.toLocaleString()}</span></div>`;
  $('scanTotals').innerHTML = totals;
  $('libraryStats').innerHTML = totals;

  if (s.indexed) {
    state.folders = await api('/api/folders');
    try { state.order = await api('/api/order'); } catch { state.order = []; }
    // Open the first folder so the panel is never an empty box on arrival.
    if (!Object.keys(state.openFolders).length && state.folders.length) {
      await toggleFolder(orderedFolders()[0].name);
    } else {
      buildTree();
    }
  }
  return s;
}

(async function init() {
  setMode('overview');
  updateModeAvailability();
  try {
    loadPresets();
    const s = await refresh();
    if (!s.library) {
      showPane('left', 'import');
      toast('Choose your audio library folder to begin');
    } else if (!s.indexed) {
      showPane('left', 'scan');
    }
  } catch (e) {
    toast('Cannot reach the server: ' + e.message);
  }
})();

// ======================================================= grain visualiser
//
// The whole grain stream, drawn as it is heard: output time across, source
// position up. A clean stretch is a straight diagonal — each moment of output
// reads steadily through the source. Position jitter scatters it vertically,
// pitch jitter colours it, density changes how thickly it is packed.
//
// The events come from the same enumeration the renderer uses, so this is not
// an impression of the process; it is the process.

state.grains = null;

/// The output-frame range the last request covered, so a redraw at the same
/// zoom does not re-ask.
let grainsFor = null;

/// Which file the grains in hand belong to, and when the last ask failed.
///
/// A dropped request is not "there are no grains". It used to be treated as one
/// — the catch cleared `state.grains`, and `grainsFollowView` will not ask again
/// when there is nothing in hand — so a single failed fetch stopped the picture
/// for good while the sound carried on, and the only way back was an action that
/// called `loadGrains` itself. Reselecting a view from the menu is one, which is
/// why that appeared to fix it.
let grainsPath = null;
let grainsFailedAt = 0;

/// Which request the state in hand belongs to.
///
/// `loadGrains` is async and is called from six places — selecting a file, an
/// edit, a zoom, a scroll, the playback poll, the failure retry. Nothing stopped
/// two of them being in flight at once, and nothing said which answer was the
/// current one, so **the response that happened to land last won** whether or
/// not it was the one asked for last.
///
/// Both failures were reproduced before this was written:
///
/// - Ask for the whole document, then zoom in and ask again. If the first
///   request is the slower one it lands second, and `state.grains` and
///   `grainsFor` end up describing four minutes of file while the view is on a
///   fraction of a second. The picture is a handful of marks — the "zoomed in
///   and saw three grains" symptom, by a different route.
/// - Switch sounds while a request is in flight and the *previous* file's
///   grains are drawn on the new file's waveform.
///
/// A ticket per request fixes both: a response that is not the newest is
/// dropped entirely rather than written and then corrected. Nothing partial is
/// ever stored, so `state.grains`, `grainsFor` and `grainsPath` always describe
/// one single response.
let grainsSeq = 0;
/// The swarm has its own counter, and that is not a detail.
///
/// Sharing one counter meant `loadSwarmGrains` — which `loadGrains` awaits —
/// bumped the number its caller was holding, so every view fetch declared
/// itself superseded by its own child and returned before drawing anything.
/// The redraw would have stopped completely. Caught by reading it back rather
/// than by running it, which is luck; the test below is not luck.
let swarmSeq = 0;

/// Is this response still wanted at all — same file, still selected?
const stillWanted = (f) => state.selectedFile?.path === f.path;
const GRAIN_RETRY_MS = 1200;

/// How far either side of the playhead the swarm's schedule has to reach.
///
/// Four seconds rather than the swarm's own 1.4, so playing on does not need a
/// new request every second.
const GRAIN_PLAYHEAD_PAD = 4;

/// **Two pictures read the schedule and they want different ranges.**
///
/// The waveform layer wants the grains in the *view*; the swarm wants the ones
/// around the *playhead*, 1.4 seconds either side. Windowing to the view alone
/// — which is what made zooming work — empties the swarm whenever the playhead
/// is elsewhere.
///
/// The union of the two is not the answer either, and the measurement says so:
/// zoomed into the last tenth of a file with the playhead at the start, the
/// union is the whole document, the cap spreads over all of it, and the swarm
/// gets sixteen grains. A contiguous window cannot serve two disjoint regions.
///
/// So they are two requests, and only when they are actually apart. Following
/// the playhead — the usual case — the second is skipped entirely.
function viewWindow() {
  const v = state.view || {};
  const ratio = state.edit?.stretch?.ratio ?? 1;
  const from = Math.max(0, Math.floor((v.from ?? 0) * ratio));
  const to = Math.ceil((v.to ?? 0) * ratio);
  return to > from ? [from, to] : null;
}

function playheadWindow() {
  const sr = state.grains?.sampleRate || state.view?.sampleRate || 48000;
  const head = playbackTime() * sr;
  if (!Number.isFinite(head) || head <= 0) return null;
  const pad = GRAIN_PLAYHEAD_PAD * sr;
  return [Math.max(0, Math.floor(head - pad)), Math.ceil(head + pad)];
}

/// Is the playhead's horizon already inside what the view fetched?
function covers(win, want) {
  return !!win && !!want && want[0] >= win[0] && want[1] <= win[1];
}

/// Whether the view's schedule is too thinned to strike sparks from.
///
/// The cap is spent across whatever window was asked for, so zoomed out on a
/// long stretch it is spread very thin: measured at ratio 19.4, density 91,
/// three layers, the reply held 7,983 grains of a real 2,913,063 — one in 365.
/// The ticks survive that (they are a density picture and thinning is honest),
/// but the sizzle does not: at any moment 91 × 3 × 0.28 s ≈ 76 grains should be
/// lit, and one in 365 of them is *nought point two*. What you see is a spark
/// appearing alone, twice a second, which reads exactly like a redraw running
/// at two frames a second. It is not — the layer draws in under a millisecond.
/// There is simply almost nothing in the frame.
///
/// So when the view copy is thin, the sparks come from the playhead's own copy,
/// which is eight seconds wide and therefore never thinned at all.
function viewIsThin() {
  const g = state.grains;
  if (!g || !g.total || !g.grains) return false;
  return g.total > g.grains.length * 2;
}

/// The playhead's own schedule, when the view is looking somewhere else.
/// `null` means the view's copy already covers it and the swarm should use that.
let swarmFor = null;

async function loadGrains() {
  const f = state.selectedFile;
  if (!f) {
    state.grains = null; state.swarm = null;
    grainsFor = null; swarmFor = null;
    grainsPath = null; grainsFailedAt = 0;
    drawGrains();
    return;
  }

  // Ask for the range on screen, in *output* frames — the view is in source
  // frames, and the schedule is laid out along the output.
  //
  // This is what makes zooming show more rather than less. The cap is a few
  // thousand grains and it used to be spread over the whole document, so a
  // window holding a thousandth of the file held a handful of them: zoomed all
  // the way in on a cloud of three million, you saw three.
  const win = viewWindow();
  const q = win ? `&from=${win[0]}&to=${win[1]}` : '';
  const seq = ++grainsSeq;
  try {
    const got = await api(`/api/grains?p=${encodeURIComponent(f.path)}${q}`);
    // Superseded while it was in the air. Drop it whole — writing it and
    // letting something later notice is what put the wrong window on screen.
    if (seq !== grainsSeq || !stillWanted(f)) return;
    state.grains = got;
    grainsFor = win;
    grainsPath = f.path;
    grainsFailedAt = 0;
  } catch {
    if (seq !== grainsSeq || !stillWanted(f)) return;
    // Keep the picture if it belongs to this file — a stale schedule is closer
    // to the truth than a blank lane, and it is replaced the moment the retry
    // lands. Grains from a *different* file would be a lie, so those do go.
    if (grainsPath !== f.path) { state.grains = null; grainsPath = null; }
    grainsFor = null;
    grainsFailedAt = performance.now();
  }
  await loadSwarmGrains();
  if (seq !== grainsSeq || !stillWanted(f)) return;
  drawGrains();
  // The lane's own layer too. It is otherwise only drawn from `updatePlayhead`,
  // which does not run with the transport stopped — so a schedule that arrived
  // while stopped stayed invisible until you pressed play.
  drawGrainLayer();
}

/// A second request, only when the playhead is outside the view.
async function loadSwarmGrains() {
  const f = state.selectedFile;
  const want = playheadWindow();
  // `covers` alone was the test, and it is not enough: a range can *contain*
  // the playhead while holding one grain in 365 of it. Density counts too.
  if (!f || !want || (covers(grainsFor, want) && !viewIsThin())) {
    state.swarm = null;
    swarmFor = null;
    return;
  }
  // The swarm's own ticket, on the same counter — a swarm fetch that outlives
  // the view fetch that triggered it must not write either.
  const seq = ++swarmSeq;
  try {
    const got = await api(
      `/api/grains?p=${encodeURIComponent(f.path)}&from=${want[0]}&to=${want[1]}`,
    );
    if (seq !== swarmSeq || !stillWanted(f)) return;
    state.swarm = got;
    swarmFor = want;
  } catch {
    if (seq !== swarmSeq || !stillWanted(f)) return;
    state.swarm = null;
    swarmFor = null;
  }
}

/// Re-fetch when the view or the playhead has moved outside what is covered.
///
/// Throttled: zooming, scrolling and playback all fire continuously, and each
/// of these is a schedule walk on the server.
let grainsViewTimer = null;
/// The view the grain layer was last drawn for.
///
/// `grainsFollowView` is called from the playback poll twenty times a second as
/// well as on every zoom and scroll. Redrawing unconditionally there added
/// twenty full redraws a second on top of the sixty the transport loop already
/// does — for a picture that had not moved. The redraw is needed when the
/// *view* moves, which is what this remembers.
let grainDrawnFor = null;

function grainsFollowView() {
  // Re-place what is already in hand, when the view has actually moved.
  //
  // This function used to redraw *only* when it decided to re-fetch. The marks
  // are drawn at pixel positions derived from `state.view`, so any zoom or
  // scroll moves the waveform out from under them — and if the schedule in hand
  // still covered the new view, nothing ever corrected it. Measured: scroll by
  // 15% of the span and the canvas came back byte-identical.
  //
  // Even when a fetch *is* warranted it is debounced by 120 ms, so there was a
  // window on every single view change where the marks were simply in the wrong
  // places. Drawing first closes both cases: the picture is always right for
  // the data in hand, and a fetch only ever improves the data.
  const now = `${state.view?.from}:${state.view?.to}`;
  if (now !== grainDrawnFor) {
    grainDrawnFor = now;
    drawGrainLayer();
  }
  if (!state.selectedFile) return;

  // The last ask failed: try again, on a timer of its own so a server that is
  // genuinely down is asked once a second rather than eight times.
  if (grainsFailedAt) {
    if (performance.now() - grainsFailedAt < GRAIN_RETRY_MS) return;
    grainsFailedAt = 0;
    loadGrains();
    return;
  }
  const win = viewWindow();
  const head = playheadWindow();

  // Nothing in hand at all: ask for it.
  //
  // This used to `return`, which left the poll able to *refresh* a schedule but
  // never to fetch a first one. So any way the schedule came to be missing — a
  // request superseded by a newer one, a race while switching sounds, a reply
  // that failed — was permanent: the marks and the read band stayed away until
  // something else happened to call `loadGrains`, which is why moving any grain
  // control made them all appear at once.
  //
  // The document has to be a granular one for there to be anything to ask for,
  // and the debounce below keeps this to one request rather than twenty a
  // second while it is in flight.
  if (!state.grains?.grains?.length) {
    // `grain` hangs off `stretch`, not off the document. Testing
    // `state.edit.grain` would have been false on every document there is, so
    // this branch would have returned early every time and fetched nothing —
    // the same silence it was written to end.
    if (!win || !state.edit?.stretch) return;
    clearTimeout(grainsViewTimer);
    grainsViewTimer = setTimeout(() => loadGrains(), 120);
    return;
  }

  // Stale two ways, and the second is the one that matters.
  //
  // Outside what was fetched is obvious. But **zooming in stays inside it** —
  // and that is precisely when a new request is needed, because the grains held
  // were sampled across a range far wider than what is now on screen. Testing
  // only for "outside" meant zooming changed nothing at all: the view narrowed
  // to sixty frames while the schedule in hand still covered sixty-one million,
  // and the picture went empty rather than dense.
  //
  // So: re-ask when the covered range is more than twice the view. Twice rather
  // than any narrowing, or every scroll would re-ask.
  const outside = win && !(grainsFor
    && win[0] >= grainsFor[0] - 1 && win[1] <= grainsFor[1] + 1);
  const tooCoarse = win && grainsFor
    && (grainsFor[1] - grainsFor[0]) > (win[1] - win[0]) * 2;
  const viewStale = !!(outside || tooCoarse);
  // The swarm is stale if its horizon is in neither copy. A margin, so playing
  // forward inside the pad does not re-ask every frame.
  const sr = state.grains?.sampleRate || 48000;
  const margin = 1.5 * sr;
  const near = head ? [head[0] + margin, head[1] - margin] : null;
  const swarmStale = !!head && !covers(swarmFor, near)
    && !(covers(grainsFor, near) && !viewIsThin());
  if (!viewStale && !swarmStale) return;

  clearTimeout(grainsViewTimer);
  grainsViewTimer = setTimeout(() => {
    if (viewStale) loadGrains();
    else loadSwarmGrains().then(() => { drawGrains(); drawGrainLayer(); });
  }, 120);
}

/// Warm and bright for sharp, brilliant grains; cool and deep for flat, dark.
function grainColour(pitchOffset, brightness, alpha) {
  const p = Math.max(-1, Math.min(1, pitchOffset / 9));
  const br = Math.max(0, Math.min(1, brightness * 4));
  const t = Math.max(-1, Math.min(1, p * 0.55 + (br - 0.4) * 1.4));
  const hue = t >= 0 ? 30 - t * 10 : 250 + t * 30;
  const chroma = 0.10 + Math.abs(t) * 0.16;
  const light = 66 + Math.abs(t) * 14;
  return `oklch(${light}% ${chroma} ${hue} / ${alpha})`;
}

function visSetup(fade) {
  const canvas = $('grainCanvas');
  if (!canvas) return null;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  // Both dimensions — see `drawGrainLayer`, where testing only the width left
  // the backing store the wrong height after a vertical resize.
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (fade) {
    // A translucent wash instead of a clear leaves trails, which is what makes
    // a swarm read as moving rather than as a scatter of static dots.
    ctx.fillStyle = 'rgba(7,9,14,0.40)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
  return { ctx, w, h };
}


// --------------------------------------------------------------- cloud pad

/// The grain cloud, drawn where it actually is.
///
/// The swarm above it is a picture of the *sound* — grains orbiting the
/// playhead, flying in and receding. It reads well and it is honest about
/// level, pitch and brightness, but the positions in it are invented: nothing
/// in that orbit tells you which part of the file a grain came from.
///
/// This is the other picture, and the one the controls are actually about.
/// Across is the source, start to end, with its waveform behind. Up and down
/// is pitch offset. Every dot is a real grain from the same enumeration the
/// renderer and the exporter use, sitting at the frame it reads from.
///
/// It is also the control. The box is the read head: where it sits, how far
/// grains are thrown from it, and how far their pitch scatters. Drag the box
/// to move the head, drag outside it to spread it. Three sliders under one
/// hand, which is what those three numbers actually are — a place and a size.
const CLOUD_PITCH_FLOOR = 4;

function cloudPadGeometry(canvas) {
  const st = state.edit?.stretch;
  if (!st) return null;
  const g = state.grainDraft || st.grain;
  if (!g) return null;
  const base = state.edit?.baseFrames || state.view?.frames || 0;
  if (!base) return null;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;

  const scan = g.scan ?? 1;
  const pos = g.position ?? 0;
  // Where the head is at this instant: its home, plus wherever it has been
  // moved to, plus however far the sweep has carried it. The same three terms
  // `event_at` adds up, so the box sits where the grains are coming from.
  //
  // The sweep is the *output* frame over the ratio, and `sourceFrameNow` is
  // already that — it is the engine's position mapped back through the stretch.
  // Dividing by the ratio again was dividing twice: at eight times the head
  // crawled at an eighth speed and reached an eighth of the way across the file
  // by the time the sound had finished, which is exactly how it looked.
  const home = scan < 0 ? base : 0;
  const sweep = sourceFrameNow() * scan;
  const head = home + pos * base + sweep;

  const sr = state.grains?.sampleRate || state.view?.sampleRate || 48000;
  const sprayFrames = ((g.positionJitterMs || 0) / 1000) * sr;
  // A quarter more than the scatter actually reaches, so the box sits *inside*
  // the plot with air around it. Scaled exactly to the scatter, the box filled
  // the full height whenever there was no drift and read as a stripe rather
  // than as something you could take hold of.
  const semis = Math.max(CLOUD_PITCH_FLOOR,
                         ((g.pitchJitterSemis || 0) + (g.pitchDriftSemis || 0)) * 1.25);

  return {
    w, h, base, sr, g, st, head, home, sweep, semis,
    x: (frame) => (frame / base) * w,
    y: (offset) => h / 2 - (offset / semis) * (h / 2 - 8),
    halfW: (sprayFrames / base) * w,
    halfH: ((g.pitchJitterSemis || 0) / semis) * (h / 2 - 8),
  };
}

function drawCloudPad() {
  const canvas = $('cloudPad');
  if (!canvas || canvas.offsetParent === null) return;
  const geo = cloudPadGeometry(canvas);
  const dpr = window.devicePixelRatio || 1;
  if (!geo) return;
  const { w, h } = geo;
  // Both dimensions — see `drawGrainLayer`, where testing only the width left
  // the backing store the wrong height after a vertical resize.
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  // The source underneath, so a position means something. Same envelope the
  // automation lanes use — one fetch, already in hand.
  drawLaneWave(c, w, h, geo.base);

  // The pitch centre line.
  c.strokeStyle = 'rgba(255,255,255,.07)';
  c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();

  // The head and its spread. This is a pointer rather than a reading — it says
  // where you are about to read from — so it takes `--accent` and moves with the
  // theme, unlike the waveform under it.
  const bx = geo.x(geo.head);
  const acc = ink('--accent');
  c.fillStyle = acc;
  withAlpha(c, 0.09, () => {
    c.fillRect(bx - geo.halfW, h / 2 - geo.halfH, geo.halfW * 2, geo.halfH * 2);
  });
  c.strokeStyle = acc;
  c.lineWidth = 1;
  withAlpha(c, 0.7, () => {
    c.strokeRect(bx - geo.halfW, h / 2 - geo.halfH, geo.halfW * 2, geo.halfH * 2);
  });
  withAlpha(c, 0.9, () => {
    c.beginPath(); c.moveTo(bx, 0); c.lineTo(bx, h); c.stroke();
  });

  // The grains themselves, from the renderer's own enumeration.
  const g = state.grains;
  const readout = $('cloudPadRead');
  if (!g || !g.grains?.length) {
    if (readout) readout.textContent = 'no cloud — raise Density or Layers';
    return;
  }
  const baseSemis = geo.st.semitones ?? 0;
  const now = playbackTime();
  const playFrame = now * geo.sr;

  // A grain is not a point, it is a span: it starts at `srcFrame` and reads
  // forward through `size × rate` frames. Drawn at its start, a cloud of long
  // grains looks as though the end of the file is never touched — and worse,
  // the engine refuses to start a grain that would read off the end, so every
  // one that wants to is clamped to the last legal position and they pile into
  // a wall there. That wall is real, and it was being drawn as the edge of the
  // picture. Plotted at the middle of what each grain actually reads, the cloud
  // covers the file the way the sound does.
  const readMid = (srcFrame, size, pitchSemis) =>
    srcFrame + (size * Math.pow(2, pitchSemis / 12)) / 2;

  for (const [outFrame, srcFrame, size, pitch, , bright] of g.grains) {
    const dt = (outFrame - playFrame) / geo.sr;
    // Everything is drawn, but what is sounding now is drawn brightest — the
    // cloud is a shape you are moving through, not only a shape.
    const near = Math.max(0, 1 - Math.abs(dt) / 2.5);
    const alpha = 0.08 + near * near * 0.72;
    // Dots, not discs. This strip is a hundred and thirty pixels tall and
    // holds a whole file across, so a five-pixel circle covers a tenth of a
    // second of source and a sixth of the pitch range — at that scale a grain
    // was not a grain, it was a blob, and a hundred of them were one blob.
    // A point says where it is and nothing it has no room to say; length and
    // brightness are legible in the panel on the right, which has the space.
    const r = 0.6 + Math.min(1.1, (size / geo.sr) * 8);
    c.fillStyle = grainColour(pitch - baseSemis, bright, alpha);
    c.beginPath();
    c.arc(geo.x(readMid(srcFrame, size, pitch)), geo.y(pitch - baseSemis), r, 0, Math.PI * 2);
    c.fill();
  }
  if (readout) {
    const secs = (geo.head / geo.sr).toFixed(2);
    readout.textContent = `${g.total.toLocaleString()} grains · head ${secs}s`;
  }
}

/// Move the head, or spread it — whichever the gesture is.
///
/// Inside the box moves it; outside spreads it. No corner handles and no modes:
/// a handle a few pixels wide is a thing to miss, and the distinction between
/// "grab the thing" and "grab the air around it" is one nobody has to be told.
function wireCloudPad() {
  const canvas = $('cloudPad');
  if (!canvas || canvas._wired) return;
  canvas._wired = true;

  let mode = null;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const apply = (e) => {
    const geo = cloudPadGeometry(canvas);
    if (!geo) return;
    const { px, py } = at(e);
    const d = state.grainDraft;
    if (!d) return;

    if (mode === 'move') {
      // Solve `event_at` backwards for the offset: the frame under the pointer
      // is home + position*base + sweep, and everything but position is known.
      const frame = (px / geo.w) * geo.base;
      d.position = Math.max(-1, Math.min(1, (frame - geo.home - geo.sweep) / geo.base));
      state.grainRows?.position?.sync(d.position);
    } else {
      const bx = geo.x(geo.head);
      const spray = Math.abs(px - bx) / geo.w * geo.base / geo.sr * 1000;
      d.positionJitterMs = Math.max(0, Math.min(500, spray));
      const semis = Math.abs(py - geo.h / 2) / (geo.h / 2 - 8) * geo.semis;
      d.pitchJitterSemis = Math.max(0, Math.min(24, semis));
      state.grainRows?.positionJitterMs?.sync(d.positionJitterMs);
      state.grainRows?.pitchJitterSemis?.sync(d.pitchJitterSemis);
    }
    drawCloudPad();
    state.grainSend?.preview();
  };

  canvas.onpointerdown = (e) => {
    const geo = cloudPadGeometry(canvas);
    if (!geo) return;
    const { px, py } = at(e);
    const bx = geo.x(geo.head);
    const inside = Math.abs(px - bx) <= Math.max(geo.halfW, 5)
                && Math.abs(py - geo.h / 2) <= Math.max(geo.halfH, 5);
    mode = inside ? 'move' : 'spread';
    canvas.setPointerCapture(e.pointerId);
    apply(e);
  };
  canvas.onpointermove = (e) => { if (mode) apply(e); };
  canvas.onpointerup = (e) => {
    if (!mode) return;
    mode = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    // The release is what writes it into the document and reloads the cloud.
    state.grainSend?.commit();
  };
}

function drawGrains() {
  // Drawn whether or not the swarm is: the pad is a control as well as a
  // picture, and a control that goes blank when the transport stops is no use.
  drawCloudPad();

  // Only the view that is showing does any work. The swarm was redrawing its
  // whole canvas every frame while a 3D view was up and it was not even on
  // screen — a full clear, a pass over every grain in the window and a
  // gradient per grain, sixty times a second, for nothing.
  if (grainView !== 0) return;

  const set = visSetup(engine.playing);
  if (!set) return;
  const { ctx, w, h } = set;
  const g = state.grains;
  const label = $('grainCount');

  if (!g || !g.grains.length) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Engage a grain control to see the swarm', 12, h / 2);
    if (label) label.textContent = '';
    return;
  }
  if (label) {
    const shown = g.shown < g.total ? ` · showing ${g.shown.toLocaleString()}` : '';
    label.textContent = `${g.total.toLocaleString()} grains${shown}`;
  }

  // The swarm draws around the playhead, so it takes the playhead's copy of the
  // schedule when the view is looking somewhere else — see `loadSwarmGrains`.
  const sg = (state.swarm?.grains?.length ? state.swarm : g);

  // Levels in the stream are small absolute numbers; normalising against the
  // loudest grain is what makes size vary visibly across the swarm.
  if (sg._peak === undefined) {
    sg._peak = sg.grains.reduce((m, r) => Math.max(m, r[4] || 0), 0) || 1;
  }
  drawGrainSwarm(ctx, w, h, sg);
}

/// The swarm: grains as a cloud orbiting the playhead.
///
/// Depth is time from the playhead, so grains fly in, cluster while sounding,
/// then recede. Height is pitch offset. Size is level, normalised against the
/// loudest grain. Colour is brightness and pitch together. Every value comes
/// from the grain stream the renderer uses.
function drawGrainSwarm(ctx, w, h, g) {
  const sr = g.sampleRate || 48000;
  const base = state.edit?.stretch?.semitones ?? 0;
  const now = playbackTime();
  const playFrame = now * sr;
  const cx = w / 2;
  const cy = h / 2;

  const SPAN = 1.4;                    // seconds either side of the playhead
  const FOCAL = 300;
  const R = Math.min(w, h) * 0.46;     // orbit scaled to the box, not fixed px

  const visible = [];
  for (const [outFrame, srcFrame, size, pitch, rms, bright] of g.grains) {
    const dt = (outFrame - playFrame) / sr;
    if (dt < -SPAN || dt > SPAN) continue;
    const z = dt * 230 + 120;
    if (z <= 14) continue;

    const sounding = dt <= 0 && dt + size / sr >= 0;
    const seedish = ((outFrame * 2654435761) % 997) / 997;
    const phase = seedish * Math.PI * 2 + now * (0.8 + seedish * 1.8);

    const spread = 0.35 + Math.min(1, Math.abs(pitch - base) / 9) * 0.65;
    const wob = sounding ? 1 + 0.16 * Math.sin(now * 11 + seedish * 7) : 1;
    const radius = R * spread * (0.45 + seedish * 0.55) * wob;
    const scale = FOCAL / (FOCAL + z);

    const px = cx + Math.cos(phase) * radius * scale;
    const py = cy - ((pitch - base) / 10) * h * 0.30
                  + Math.sin(phase * 1.27) * radius * 0.42 * scale;

    const level = Math.sqrt(Math.max(0, rms) / g._peak);
    const r = Math.max(1.0, (1.8 + level * 13) * scale * (sounding ? 1.5 : 1));
    // Additive blending accumulates: with dozens of overlapping grains a high
    // per-grain alpha saturates the whole cloud to flat white. Keep each one
    // faint and let the density do the work.
    const alpha = Math.max(0.05, (1 - Math.abs(dt) / SPAN) ** 1.6) * (sounding ? 0.42 : 0.16);
    visible.push({ px, py, r, alpha, pitch, bright, sounding, z });
  }

  visible.sort((a, b) => b.z - a.z);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const v of visible) {
    const col = grainColour(v.pitch - base, v.bright, v.alpha);
    ctx.shadowBlur = v.sounding ? 8 : 4;
    ctx.shadowColor = col;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(v.px, v.py, v.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText(`${visible.length} in flight`, 10, h - 10);
  if (!engine.playing) {
    ctx.fillStyle = 'rgba(255,255,255,0.40)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('press play — the swarm follows the playhead', 10, 18);
  }
}

// Animate only while something is playing, so an idle editor costs nothing.
let grainRaf = null;
function grainLoop() {
  grainRaf = requestAnimationFrame(grainLoop);
  if (state.mode !== 'edit' || !state.grains) return;
  // Nothing to draw into when the stretch panel is not the one showing. The
  // pad and the swarm both live in it, so with another dock open this loop was
  // painting two canvases nobody could see.
  if ($('dockStretch')?.classList.contains('hidden')) return;
  drawGrains();
}
/// The swarm animates only while the engine is playing, so an idle editor
/// costs nothing.
///
/// The grains it draws come from the schedule endpoint, which is the same
/// enumeration the engine renders from — so the picture still cannot show a
/// grain the speakers did not play. What the engine supplies here is the
/// playhead they orbit.
function startSwarm() {
  if (!grainRaf) grainLoop();
}

function stopSwarm() {
  // Let it settle for a moment rather than freezing mid-flight.
  setTimeout(() => {
    if (!engine.playing && grainRaf) { cancelAnimationFrame(grainRaf); grainRaf = null; }
    drawGrains();
  }, 600);
}

enablePainting($('dock'));

if (window.ResizeObserver) {
  const c = $('grainCanvas');
  if (c) new ResizeObserver(() => drawGrains()).observe(c);
  // The pad needs its own. It is redrawn from `drawGrains`, and that loop is
  // cancelled a moment after playback stops — so resizing the window while
  // stopped left the canvas at its old backing size with the browser scaling
  // the stale bitmap to fit. Which is why it came out squashed, with the end
  // of the file looking folded over.
  const pad = $('cloudPad');
  if (pad) new ResizeObserver(() => drawCloudPad()).observe(pad);
}

// ------------------------------------------------------- which view of the grains
//
// Six ways to look at one schedule: the original 2D swarm, and the five 3D
// views. The 3D ones live in an iframe rather than being ported in here — they
// are a p5 sketch with their own render loop, and running that inside the app's
// loop would mean two animation clocks fighting over one canvas. Being a
// separate document also means the same file is the standalone viewer, so there
// is one implementation to keep honest rather than two.

/// 0 is the 2D swarm; 1..5 index the 3D views.
let grainView = 0;

/// Send the document's time, pitch and grain settings to the views.
///
/// They were already drawing the engine's arithmetic faithfully; what they had
/// no way of knowing was which document. Everything else about them is left
/// exactly as it was.
function pushGrainParams() {
  const st = state.edit?.stretch;
  if (!st) return;
  const g = st.grain || {};
  const sr = state.view?.sampleRate || 48000;
  // Without a real length there is nothing to send. Posting a zero here made
  // the page rebuild its whole schedule over a one-frame source, which is a
  // handful of grains in a corner — every view empty, and nothing about it
  // looking like a length problem.
  const seconds = (state.edit?.baseFrames || 0) / sr;
  if (!(seconds > 0.001)) return;
  const msg = {
    type: 'grainParams',
    params: {
      ratio: st.ratio,
      semitones: st.semitones,
      windowMs: st.windowMs,
      rateHz: g.rateHz,
      densityHz: g.densityHz,
      overlap: g.overlap,
      sizeJitter: g.sizeJitter,
      positionJitterMs: g.positionJitterMs,
      pitchJitterSemis: g.pitchJitterSemis,
      pitchDriftSemis: g.pitchDriftSemis,
      driftRateHz: g.driftRateHz,
      panSpread: g.panSpread,
      seed: g.seed,
      // So the geometry is laid out over the real file's length rather than
      // the two seconds the page assumes when it is standing on its own.
      sourceSeconds: seconds,
    },
  };
  $('grainFrame')?.contentWindow?.postMessage(msg, location.origin);
  pop.frame?.contentWindow?.postMessage(msg, location.origin);
}

function setGrainView(v) {
  grainView = v;
  for (const b of document.querySelectorAll('.vis-tab')) {
    b.classList.toggle('active', +b.dataset.vis === v);
  }
  const frame = $('grainFrame'), canvas = $('grainCanvas'), legend = document.querySelector('.vis-legend');
  const is3d = v > 0;

  canvas.classList.toggle('hidden', is3d);
  legend.classList.toggle('hidden', is3d);
  frame.classList.toggle('hidden', !is3d);

  // The frame keeps its engine connection open and polls for it. Hidden, that
  // is a request every eighth of a second for a picture nobody is looking at.
  frame.contentWindow?.postMessage(
    { type: 'grainAwake', awake: is3d }, location.origin);

  if (!is3d) {
    // Coming back to the swarm from a 3D view: the loop skipped it while it was
    // hidden, so it holds whatever was on it when you left. Paint it once.
    drawGrains();
    return;
  }
  if (!frame.src) {
    frame.src = `/grains3d?embed=1&view=${v - 1}`;
    // A document's settings cannot be posted at a frame that has not loaded.
    frame.onload = () => pushGrainParams();
  } else {
    // Already loaded — switch views in place so the camera and the engine
    // connection survive. Reloading the src would restart both.
    frame.contentWindow?.postMessage({ type: 'grainView', view: v - 1 }, location.origin);
  }
}

// Which suite the 3D views are showing. V1 tours the cloud as an object; V2
// sits inside the moment and lets time come past. Same five slots either way,
// so the tabs only need relabelling.
let grainSuite = 1;
const SUITE_NAMES = {
  1: ['Shear', 'Braid', 'Swarm 3D', 'Shells', 'Lattice'],
  2: ['Tunnel', 'Mandala', 'Rorschach', 'Vortex', 'Ripple']
};

function setGrainSuite(n) {
  grainSuite = n === 2 ? 2 : 1;
  $('visSuite').textContent = 'V' + grainSuite;
  $('visSuite').classList.toggle('active', grainSuite === 2);

  const names = SUITE_NAMES[grainSuite];
  for (const b of document.querySelectorAll('.vis-tab')) {
    const i = +b.dataset.vis;
    if (i >= 1) b.textContent = names[i - 1];
  }
  for (const b of document.querySelectorAll('.vis-pop-tab')) {
    b.textContent = names[+b.dataset.view];
  }

  const post = { type: 'grainSuite', suite: grainSuite };
  $('grainFrame').contentWindow?.postMessage(post, location.origin);
  pop.frame?.contentWindow?.postMessage(post, location.origin);
}

for (const b of document.querySelectorAll('.vis-tab')) {
  if (b.id === 'visSuite') continue;
  b.onclick = () => setGrainView(+b.dataset.vis);
}
// Apply the starting view rather than assuming the markup already matches it.
// It did not: `grainView` opened on the composite while the markup still had
// the 2D swarm showing, so the default view was never the one on screen.
setGrainView(grainView);
const visSuiteBtn = $('visSuite');
if (visSuiteBtn) visSuiteBtn.onclick = () => setGrainSuite(grainSuite === 1 ? 2 : 1);
// A floating panel rather than a new tab. The whole point of watching the
// grains is to watch them *while* moving a slider, and a separate window puts
// the controls behind the thing you are looking at.
const pop = {
  el: null, frame: null,
  x: 0, y: 0, w: 1060, h: 680,
  mode: null, ox: 0, oy: 0
};

const fence = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ───────────────────────────────────────────────────── the grain views window
//
// The views were half the stretch tray, drawing every frame beside the controls
// you were trying to read. They are a window now, opened from Window ▸ Grains.
//
// `#grainVis` is moved into the window rather than rebuilt: the picker, the 2D
// canvas, the 3D iframe and the legend are the same nodes `drawGrains` and
// `visSetup` already hold references to, so nothing needed rewiring and the 2D
// swarm keeps working exactly as it did.

const visWindowOpen = () => !$('visWindow').classList.contains('hidden');

function openVisWindow() {
  const win = $('visWindow');
  const body = $('visWindowBody');
  const vis = $('grainVis');
  if (!win || !body || !vis) return;
  if (vis.parentElement !== body) body.appendChild(vis);
  vis.classList.remove('hidden');
  win.classList.remove('hidden');
  // The canvas measures zero inside a hidden panel, and one sized from that
  // stays a sliver however big the window gets. Draw after it is visible.
  requestAnimationFrame(() => drawGrains());
}

function closeVisWindow() {
  const win = $('visWindow');
  if (!win) return;
  win.classList.add('hidden');
  $('grainVis')?.classList.add('hidden');
}

function toggleVisWindow() {
  (visWindowOpen() ? closeVisWindow : openVisWindow)();
}

function openVisPop() {
  if (!pop.el) buildVisPop();
  // Visible *before* the document loads. An iframe created inside a
  // display:none panel measures zero, and a canvas sized from that stays a
  // sliver in the corner no matter how big the panel gets afterwards.
  pop.el.classList.remove('hidden');
  // embed=1, not the standalone page. The standalone one carries a 320px
  // sidebar and caps the canvas, so the visual stays the same size however big
  // the panel is dragged — which is the opposite of the point of a resizable
  // panel. Embedded, the view *is* the box.
  if (!pop.frame.src) {
    pop.frame.src = `/grains3d?embed=1&view=${Math.max(0, grainView - 1)}`;
    pop.frame.onload = () => pushGrainParams();
  }
}

function closeVisPop() {
  pop.el?.classList.add('hidden');
}

function buildVisPop() {
  const el = document.createElement('div');
  el.className = 'vis-pop hidden';
  // The sidebar lives in the app, so the panel only needs the view names.
  const names = ['Shear', 'Braid', 'Swarm', 'Shells', 'Lattice'];
  el.innerHTML = `
    <div class="vis-pop-head">
      <span class="vis-pop-title">Grains</span>
      ${names.map((n, i) => `<button class="vis-pop-tab" data-view="${i}">${n}</button>`).join('')}
      <span class="vis-pop-hint">drag to move · corner to resize</span>
      <button class="vis-pop-btn" data-act="max" title="Fill the window">&#9723;</button>
      <button class="vis-pop-btn" data-act="close" title="Close">&times;</button>
    </div>
    <iframe title="Grain views"></iframe>
    <div class="vis-pop-grip" title="Resize"></div>`;
  document.body.appendChild(el);

  for (const b of el.querySelectorAll('.vis-pop-tab')) {
    b.onclick = () => {
      for (const o of el.querySelectorAll('.vis-pop-tab')) o.classList.remove('active');
      b.classList.add('active');
      pop.frame.contentWindow?.postMessage(
        { type: 'grainView', view: +b.dataset.view }, location.origin);
    };
  }

  pop.el = el;
  pop.frame = el.querySelector('iframe');
  pop.x = Math.max(20, (window.innerWidth - pop.w) / 2);
  pop.y = Math.max(20, (window.innerHeight - pop.h) / 2);
  place();

  el.querySelector('[data-act="close"]').onclick = closeVisPop;
  el.querySelector('[data-act="max"]').onclick = () => {
    pop.x = 20; pop.y = 20;
    pop.w = window.innerWidth - 40; pop.h = window.innerHeight - 40;
    place();
  };

  // Dragging and resizing both run on the document, not the panel, so the
  // pointer can outrun the element without the gesture being dropped. The
  // iframe stops taking events mid-gesture for the same reason: it would
  // otherwise swallow every move that crossed it.
  el.querySelector('.vis-pop-head').addEventListener('mousedown', (e) => {
    if (e.target.closest('.vis-pop-btn')) return;
    pop.mode = 'move'; pop.ox = e.clientX - pop.x; pop.oy = e.clientY - pop.y;
    pop.frame.style.pointerEvents = 'none';
    e.preventDefault();
  });
  el.querySelector('.vis-pop-grip').addEventListener('mousedown', (e) => {
    pop.mode = 'size'; pop.ox = e.clientX - pop.w; pop.oy = e.clientY - pop.h;
    pop.frame.style.pointerEvents = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!pop.mode) return;
    if (pop.mode === 'move') {
      pop.x = fence(e.clientX - pop.ox, -pop.w + 120, window.innerWidth - 120);
      pop.y = fence(e.clientY - pop.oy, 0, window.innerHeight - 40);
    } else {
      pop.w = fence(e.clientX - pop.ox, 420, window.innerWidth);
      pop.h = fence(e.clientY - pop.oy, 300, window.innerHeight);
    }
    place();
  });

  document.addEventListener('mouseup', () => {
    if (!pop.mode) return;
    pop.mode = null;
    pop.frame.style.pointerEvents = '';
  });
}

function place() {
  const s = pop.el.style;
  s.left = pop.x + 'px'; s.top = pop.y + 'px';
  s.width = pop.w + 'px'; s.height = pop.h + 'px';
}

const visOpen = $('visOpen');
if (visOpen) visOpen.onclick = openVisPop;

const rescanBtn = $('rescanBtn');
if (rescanBtn) rescanBtn.onclick = async () => {
  rescanBtn.disabled = true;
  try {
    await postJSON('/api/scan', {});
    // The scan runs on its own thread; wait for it to finish before reading.
    for (let i = 0; i < 600; i++) {
      const s = await api('/api/scan');
      if (!s.running) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await refreshLibrary();
    toast('Library re-read');
  } catch (e) {
    toast('Re-scan failed: ' + e.message);
  } finally {
    rescanBtn.disabled = false;
  }
};

// ==================================================================== menus
//
// One registry, three ways in: the menu bar, a right-click on the waveform, and
// the toolbar buttons that were always there. A menu item does not reimplement
// a command — it presses the same control the toolbar does, so there is one
// implementation and the two cannot drift.
//
// `on` decides whether an item is available. Greyed out with a reason beats
// hidden: a command that vanishes teaches nothing, one that is dimmed tells you
// what you are missing.

const click = (id) => () => $(id)?.click();
const hasSel = () => !!state.sel;
const hasFile = () => !!state.selectedFile;
const editing = () => state.mode === 'edit';

/// A menu item that shows its state rather than a shortcut: the key slot on the
/// right carries a check mark when the setting is on.
const tick = (is) => () => (is() ? '✓' : '');

/// What the device can be asked for, in frames per callback.
///
/// `null` is whatever the device offers, which is where this has always been.
/// The rest double: each step is twice the time to render a block and twice
/// the delay before you hear a control move.
const BUFFER_SIZES = [null, 128, 256, 512, 1024, 2048, 4096];

/// How many grains may be sent for a picture.
///
/// The schedule is refetched while a control is being dragged, so this is what
/// each of those moves costs. Nothing draws more than a couple of thousand
/// marks; a denser sample only makes a thinned cloud look less sampled.
const GRAIN_CAPS = [2000, 4000, 8000, 16000, 32000];

async function setGrainCap(cap) {
  try {
    const r = await postJSON('/api/grains/cap', { cap });
    state.grainCap = r.cap;
    toast(`Grain detail: ${r.cap.toLocaleString()} shown at most`);
    loadGrains();
  } catch (e) {
    toast('Could not change the grain detail: ' + e.message);
  }
}

async function loadGrainCap() {
  try { state.grainCap = (await api('/api/grains/cap')).cap; }
  catch { /* the menu simply shows nothing ticked */ }
}
loadGrainCap();

/// Ask the device for a new block size.
///
/// This closes the device and opens it again — a stream's block length is fixed
/// when it is built — so the document that was loaded is loaded again on the
/// other side.
async function setBufferFrames(frames) {
  try {
    const r = await postJSON('/api/audio/buffer', { frames });
    state.bufferFrames = r.frames ?? null;
    const got = r.running ?? null;
    toast(got == null
      ? 'Audio buffer: the device\u2019s own size'
      : `Audio buffer: ${got} frames${r.sampleRate ? ` at ${r.sampleRate} Hz` : ''}`);
  } catch (e) {
    toast('Could not change the buffer size: ' + e.message);
  }
}

async function loadBufferFrames() {
  try {
    const r = await api('/api/audio/buffer');
    state.bufferFrames = r.frames ?? null;
  } catch { /* the menu simply shows nothing ticked */ }
}
loadBufferFrames();

const MENUS = [
  {
    title: 'File',
    items: [
      { label: 'Choose library…', run: click('pickLibrary') },
      { label: 'Re-scan library', key: '⇧⌘R', run: click('rescanBtn') },
      { sep: true },
      { label: 'Open in editor', key: '⏎', on: hasFile,
        run: () => openInEditor(state.selectedFile) },
      { label: 'Close document', key: '⌘W', on: () => editing() && state.tabs?.length,
        run: () => closeTab(state.activeTab) },
      { sep: true },
      { label: 'Export…', key: '⌘E', on: () => editing() && hasFile(), run: click('exportBtn') },
      { label: 'Save tags', key: '⌘S', run: click('commitBtn') },
    ],
  },
  {
    title: 'Edit',
    items: [
      { label: 'Undo', key: '⌘Z', on: () => !$('undoBtn')?.disabled, run: click('undoBtn') },
      { label: 'Redo', key: '⇧⌘Z', on: () => !$('redoBtn')?.disabled, run: click('redoBtn') },
      { sep: true },
      { label: 'Cut', key: '⌘X', on: hasSel, run: op('cut') },
      { label: 'Silence', on: hasSel, run: op('silence') },
      { sep: true },
      { label: 'Fade in', on: hasSel, run: op('fadeIn') },
      { label: 'Fade out', on: hasSel, run: op('fadeOut') },
      { label: 'Reverse', on: hasSel, run: op('reverse') },
      { sep: true },
      { label: 'Add marker', key: 'M', on: hasFile, run: op('marker') },
      { label: 'Add region', key: 'R', on: hasSel, run: op('region') },
      { sep: true },
      { label: 'Select all', key: '⌘A', on: hasFile, run: () => selectAll() },
      { label: 'Deselect', key: '⎋', on: hasSel, run: () => { state.sel = null; drawSelection(); } },
      { sep: true },
      { label: 'Revert document', on: editing, run: click('revertBtn') },
    ],
  },
  {
    title: 'Audio',
    items: [
      { label: 'Play / pause', key: '␣', on: hasFile, run: click('playBtn') },
      { label: 'Stop', on: hasFile, run: click('stopBtn') },
      { label: 'Loop', on: hasFile, run: click('loopBtn') },
      { sep: true },
      { label: 'Capture what is playing', on: () => editing() && hasFile(), run: click('recBtn') },
      { sep: true },
      // The cure for a callback that cannot finish in time. Doubling the block
      // doubles the time it has and doubles the delay before a moved control
      // is heard, which is the trade — hence a choice, not a constant.
      ...BUFFER_SIZES.map((n) => ({
        label: n == null ? 'Buffer: device default' : `Buffer: ${n} frames`,
        key: tick(() => (state.bufferFrames ?? null) === n),
        run: () => setBufferFrames(n),
      })),
      { sep: true },
      // What a picture of the cloud costs. The schedule is refetched on every
      // move of a control, so this is spending, not quality.
      ...GRAIN_CAPS.map((n) => ({
        label: `Grain detail: ${n.toLocaleString()}`,
        key: tick(() => state.grainCap === n),
        run: () => setGrainCap(n),
      })),
      { sep: true },
      { label: 'Reset time, pitch and grains', on: editing, run: resetEverything },
    ],
  },
  {
    // Its own menu, because this is where windows live and there will be more
    // of them: the views today, the keyboard beside them.
    title: 'Window',
    items: [
      { label: 'Grains', on: () => editing(), run: toggleVisWindow },
      { label: 'Master bus full screen', key: tick(() => masterIsFullscreen()),
        on: () => editing(), run: toggleMasterFullscreen },
      { label: 'Edit the room', key: tick(() => roomEdit.on),
        on: () => editing(), run: toggleRoomEdit },
      { label: 'Keys', on: () => editing() && hasFile(),
        run: () => (keyboardOpen() ? closeKeyboard() : openKeyboard()) },
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Browse', on: () => state.mode !== 'overview', run: () => setMode('overview') },
      { label: 'Edit', on: () => state.mode !== 'edit', run: () => setMode('edit') },
      { sep: true },
      { label: 'Play all files', key: tick(() => state.playAll), run: click('playAll') },
      { sep: true },
      { label: 'Zoom in', key: '+', on: hasFile, run: click('zoomIn') },
      { label: 'Zoom out', key: '−', on: hasFile, run: click('zoomOut') },
      { label: 'Fit', on: hasFile, run: click('zoomFit') },
      { sep: true },
      { label: 'Follow playhead', key: tick(() => state.follow.on),
        on: hasFile, run: () => setFollow({ on: !state.follow.on }) },
      { label: 'Follow by scrolling', key: tick(() => state.follow.mode === 'scroll'),
        on: () => hasFile() && state.follow.on, run: () => setFollow({ mode: 'scroll' }) },
      { label: 'Follow by paging', key: tick(() => state.follow.mode === 'page'),
        on: () => hasFile() && state.follow.on, run: () => setFollow({ mode: 'page' }) },
      { sep: true },
      { label: 'Grain views in a panel', on: editing, run: () => openVisPop() },
    ],
  },
];

/// Run one of the edit operations, by pressing the button that owns it.
function op(name) {
  return () => document.querySelector(`#editTools [data-op="${name}"]`)?.click();
}

function selectAll() {
  const frames = state.edit?.frames || state.view.frames || 0;
  if (!frames) return;
  state.sel = { start: 0, end: frames };
  drawSelection();
}

let openMenu = null;

function closeMenus() {
  $('menuPop')?.classList.add('hidden');
  document.querySelectorAll('.menu-title.open').forEach((b) => b.classList.remove('open'));
  openMenu = null;
}

/// Draw a list of items into the shared popup at a point on screen.
function showMenu(items, x, y, heading) {
  const pop = $('menuPop');
  pop.innerHTML = '';
  if (heading) {
    const h = document.createElement('div');
    h.className = 'menu-head';
    h.textContent = heading;
    pop.appendChild(h);
  }
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'menu-sep';
      pop.appendChild(s);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'menu-row';
    // The key slot may be a function, for items that report a setting rather
    // than a shortcut and so have to be read at the moment the menu opens.
    const key = typeof it.key === 'function' ? it.key() : it.key;
    b.innerHTML = `<span></span>${key ? `<span class="sk">${key}</span>` : ''}`;
    b.firstChild.textContent = it.label;
    b.disabled = it.on ? !it.on() : false;
    b.onclick = () => { closeMenus(); it.run(); };
    pop.appendChild(b);
  }
  pop.classList.remove('hidden');

  // Keep it on screen: a menu opened near the right edge should turn back on
  // itself rather than disappear off the side.
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
  pop.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
}

function buildMenuBar() {
  const bar = $('menuBar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const m of MENUS) {
    const b = document.createElement('button');
    b.className = 'menu-title';
    b.textContent = m.title;
    b.onclick = (e) => {
      e.stopPropagation();
      if (openMenu === m.title) { closeMenus(); return; }
      closeMenus();
      b.classList.add('open');
      openMenu = m.title;
      const r = b.getBoundingClientRect();
      showMenu(m.items, r.left, r.bottom + 2);
    };
    // Sliding along an open menu bar should follow, as menu bars do.
    b.onmouseenter = () => { if (openMenu && openMenu !== m.title) b.click(); };
    bar.appendChild(b);
  }
}

buildMenuBar();

// Right-click, or ctrl-click, anywhere on the sound.
for (const id of ['lane', 'overview', 'regions']) {
  const el = $(id);
  if (!el) continue;
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const edit = MENUS.find((m) => m.title === 'Edit');
    showMenu(edit.items, e.clientX, e.clientY, state.sel ? 'Selection' : 'No selection');
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#menuPop') && !e.target.closest('.menu-title')) closeMenus();
});
// ==================================================== the Peak edit commands
//
// Peak's Edit, Action and DSP menus, less the parts that are its own furniture
// (sampler transfer, CD burning, plug-in hosting) and less the ones a
// nondestructive clip list cannot honestly do.
//
// Every one of them is here rather than on the toolbar, for the same reason
// Peak has them in menus: they are the commands you reach for occasionally and
// want to be able to *find*, not the five you press all day. The toolbar keeps
// those five, plus Crop, plus the snap control — which is not a command at all
// but a setting every command reads.

// ------------------------------------------------------------- ask dialog

/// Ask for a few values and hand them back, or `null` if the user backed out.
///
/// `fields` is a list of `{key, label, type, value, min, max, step, options}`.
/// This exists because ten of the commands below need a number first and each
/// one having its own dialog is ten pieces of markup that can drift apart.
function ask(title, fields, { hint = '', note = '', okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    const box = $('askModal');
    $('askTitle').textContent = title;
    $('askNote').textContent = note;
    $('askOk').textContent = okLabel;

    const body = $('askBody');
    body.innerHTML = '';
    if (hint) {
      const p = document.createElement('p');
      p.className = 'ask-hint';
      p.textContent = hint;
      body.appendChild(p);
    }

    const inputs = {};
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'ask-row';
      const lab = document.createElement('label');
      lab.textContent = f.label;
      row.appendChild(lab);

      let el;
      if (f.type === 'select') {
        el = document.createElement('select');
        for (const [v, t] of f.options) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          el.appendChild(o);
        }
        el.value = f.value ?? f.options[0][0];
      } else if (f.type === 'check') {
        el = document.createElement('input');
        el.type = 'checkbox';
        el.checked = !!f.value;
      } else {
        el = document.createElement('input');
        el.type = f.type === 'text' ? 'text' : 'number';
        if (f.min !== undefined) el.min = f.min;
        if (f.max !== undefined) el.max = f.max;
        if (f.step !== undefined) el.step = f.step;
        el.value = f.value ?? '';
      }
      inputs[f.key] = { el, f };
      row.appendChild(el);
      body.appendChild(row);
    }

    const read = () => {
      const out = {};
      for (const [k, { el, f }] of Object.entries(inputs)) {
        if (f.type === 'check') out[k] = el.checked;
        else if (f.type === 'text' || f.type === 'select') out[k] = el.value;
        else out[k] = Number(el.value);
      }
      return out;
    };

    const close = (value) => {
      box.classList.add('hidden');
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    // Enter accepts and Escape cancels, which is what every other dialog on
    // the machine does. Captured, or the global Escape handler that closes
    // menus swallows it first.
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(read()); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
    };
    document.addEventListener('keydown', onKey, true);

    $('askOk').onclick = () => close(read());
    $('askCancel').onclick = () => close(null);
    $('askClose').onclick = () => close(null);

    box.classList.remove('hidden');
    const first = Object.values(inputs)[0]?.el;
    if (first) { first.focus(); first.select?.(); }
  });
}

// ------------------------------------------------------------------- snap

/// Where edits land. Kept across sessions, because it is a way of working
/// rather than a property of a sound — and on by default, as Peak's Auto Snap
/// is, because the alternative is that every cut can click.
state.snap = localStorage.getItem('audiolab.snap') || 'zero';

const snapSel = $('snapUnit');
if (snapSel) {
  snapSel.value = state.snap;
  snapSel.onchange = (e) => {
    state.snap = e.target.value;
    localStorage.setItem('audiolab.snap', state.snap);
  };
}

/// The ops whose position is a place in the waveform, and so worth snapping.
///
/// A gain or a stretch has a range but no edge that can click, and snapping one
/// would move the boundary of a level change for no reason at all.
const SNAPPABLE = ['cut', 'crop', 'silence', 'fadeIn', 'fadeOut', 'reverse',
                   'duplicate', 'insertSilence', 'split'];

// ------------------------------------------------------- selection and zoom

function selFrames() {
  return state.sel ? state.sel.end - state.sel.start : 0;
}

function needSel() {
  if (!state.selectedFile) { toast('Open a sound first'); return false; }
  if (!state.sel || selFrames() < 1) { toast('Select a range first'); return false; }
  return true;
}

/// Peak's Set Selection: type the numbers instead of dragging them.
async function setSelectionDialog() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const sr = state.view.sampleRate || 44100;
  const total = state.edit?.frames || state.view.frames || 0;
  const cur = state.sel || { start: 0, end: total };
  const v = await ask('Set selection', [
    { key: 'units', label: 'Units', type: 'select', value: 'seconds',
      options: [['seconds', 'seconds'], ['ms', 'milliseconds'], ['samples', 'samples']] },
    { key: 'start', label: 'Start', value: +(cur.start / sr).toFixed(6), step: 'any', min: 0 },
    { key: 'end', label: 'End', value: +(cur.end / sr).toFixed(6), step: 'any', min: 0 },
  ], { hint: 'Start and end are read in the units chosen above. Change the units before typing.' });
  if (!v) return;

  const scale = v.units === 'samples' ? 1 : v.units === 'ms' ? sr / 1000 : sr;
  const a = Math.max(0, Math.min(total, Math.round(v.start * scale)));
  const b = Math.max(0, Math.min(total, Math.round(v.end * scale)));
  if (b <= a) { toast('The end must come after the start'); return; }
  state.sel = { start: a, end: b };
  drawSelection();
  setCue(a);
}

/// Peak's Fit Selection: zoom so the selection fills the lane.
function fitSelection() {
  if (!needSel()) return;
  const frames = state.view.frames || state.edit?.frames || 0;
  if (!frames) return;
  // A little air either side, so the edges of the selection are visible rather
  // than sitting exactly on the bezel.
  const pad = Math.max(1, Math.round(selFrames() * 0.02));
  state.view.from = Math.max(0, state.sel.start - pad);
  state.view.to = Math.min(frames, state.sel.end + pad);
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
}

/// Peak's Zoom at Sample Level: as far in as the display goes, on the cursor.
///
/// `end` puts the view on the end of the selection instead of the start, which
/// is Peak's second shortcut for the same command and is what you want when you
/// are checking the far edge of a loop.
function zoomToSample(end = false) {
  const frames = state.view.frames || state.edit?.frames || 0;
  if (!frames) return;
  const at = state.sel ? (end ? state.sel.end : state.sel.start) : (state.cue || 0);
  // The lane's own floor, the same one `zoom()` clamps to.
  const span = 8;
  const from = Math.max(0, Math.min(frames - span, Math.round(at - span / 2)));
  state.view.from = from;
  state.view.to = from + span;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
}

/// Peak's Go To: jump to a marker, a region, or a time you type.
async function goTo() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const sr = state.view.sampleRate || 44100;
  const a = state.annotations || { markers: [], regions: [] };
  const places = [
    ['0', 'Start of file'],
    ...(state.sel ? [['sel-start', 'Start of selection'], ['sel-end', 'End of selection']] : []),
    ...a.markers.map((m, i) => [`m${i}`, `Marker: ${m.label || '(unnamed)'} — ${fmtTime(m.frame / sr)}`]),
    ...a.regions.map((r, i) => [`r${i}`, `Region: ${r.label || '(unnamed)'} — ${fmtTime(r.start / sr)}`]),
    ['time', 'A time I will type…'],
  ];
  const v = await ask('Go to', [
    { key: 'where', label: 'Location', type: 'select', options: places },
    { key: 'seconds', label: 'Time (seconds)', value: 0, step: 'any', min: 0 },
  ], { hint: 'The time field is only read when “A time I will type” is chosen.' });
  if (!v) return;

  let frame = 0;
  if (v.where === 'time') frame = Math.round(v.seconds * sr);
  else if (v.where === 'sel-start') frame = state.sel?.start ?? 0;
  else if (v.where === 'sel-end') frame = state.sel?.end ?? 0;
  else if (v.where.startsWith('m')) frame = a.markers[+v.where.slice(1)]?.frame ?? 0;
  else if (v.where.startsWith('r')) {
    const r = a.regions[+v.where.slice(1)];
    if (r) { state.sel = { start: r.start, end: r.end }; drawSelection(); }
    frame = r?.start ?? 0;
  }
  setCue(frame);
  centreOn(frame);
}

/// Bring a frame into view without changing how far in you are zoomed.
function centreOn(frame) {
  const { from, to, frames } = state.view;
  if (!frames) return;
  const span = to - from;
  if (!span || span >= frames) return;
  if (frame >= from && frame < to) return; // already on screen
  const a = Math.max(0, Math.min(frames - span, Math.round(frame - span / 2)));
  state.view.from = a;
  state.view.to = a + span;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
}

// ---------------------------------------------------------- the operations

/// Post an edit operation, with the snap setting attached where it applies.
///
/// The server answers with where the edit actually went. Snap is the one
/// setting in the program that quietly changes what a command does to something
/// other than what the screen showed, so when it moves an edge it says so —
/// once, with the distance, rather than leaving you to wonder why the cut is
/// not quite where the highlight was.
async function editCmd(body) {
  const snapped = SNAPPABLE.includes(body.op) && state.snap !== 'off';
  if (snapped) body.snap = state.snap;
  const asked = { start: body.start ?? 0, end: body.end ?? 0 };
  await editOp(body);

  const s = state.edit?.snapped;
  if (!s) return null;
  const moved = Math.abs(s.start - asked.start) + Math.abs(s.end - asked.end);
  if (moved > 0) {
    toast(`Snapped to ${s.unit === 'zero' ? 'zero crossings' : s.unit.toUpperCase()} — moved ${moved} sample${moved === 1 ? '' : 's'}`);
  }
  return s;
}

async function duplicateCmd() {
  if (!needSel()) return;
  const v = await ask('Duplicate', [
    { key: 'count', label: 'Extra copies', value: 3, min: 1, max: 128, step: 1 },
  ], { hint: 'The copies go straight after the selection and push everything else along — one bar of drums into four.' });
  if (!v) return;
  await editCmd({ op: 'duplicate', start: state.sel.start, end: state.sel.end, count: v.count });
}

async function insertSilenceCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const at = state.sel ? state.sel.start : (state.cue || 0);
  const v = await ask('Insert silence', [
    { key: 'ms', label: 'Length (ms)', value: 500, min: 1, max: 600000, step: 1 },
  ], { hint: 'Everything after the insertion point moves later in time. This is not the same as Silence, which overwrites.',
       note: `at ${fmtTime(at / (state.view.sampleRate || 44100))}` });
  if (!v) return;
  await editCmd({ op: 'insertSilence', start: at, end: at, ms: v.ms });
}

async function normalizeCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const v = await ask('Normalize', [
    { key: 'db', label: 'Peak level (dB)', value: -0.3, min: -60, max: 0, step: 0.1 },
  ], { hint: 'The whole document is scaled so its loudest sample lands here.' });
  if (!v) return;
  await editOp({ op: 'normalize', db: v.db });
  toast(`Normalized to ${v.db} dB`);
}

async function normalizeRmsCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const v = await ask('Normalize (RMS)', [
    { key: 'db', label: 'Average level (dB)', value: -12, min: -60, max: 0, step: 0.1 },
    { key: 'ceilingDb', label: 'Ceiling (dB)', value: -0.3, min: -60, max: 0, step: 0.1 },
  ], { hint: 'Sets the average rather than the peak. Where the ceiling gets in the way it wins, and the result comes out quieter than asked — nothing is clipped to reach a number.' });
  if (!v) return;
  const r = await postJSON('/api/measure', { p: state.selectedFile.path, start: 0, end: 0 })
    .catch(() => null);
  await editOp({ op: 'normalizeRms', db: v.db, ceilingDb: v.ceilingDb });
  const after = await postJSON('/api/measure', { p: state.selectedFile.path, start: 0, end: 0 })
    .catch(() => null);
  if (r && after) {
    // Both measurements are of the rendered output, rack and all — the same
    // rule peak normalising follows, because normalising against a level that
    // ignored a rack boost would clip the export. The consequence is that an
    // auto-levelling maximiser will pull the result away from the target, and
    // a number that quietly misses by three decibels reads as a broken
    // command unless it says why.
    const miss = Math.abs(after.rmsDb - v.db);
    const levelling = miss > 1 && state.rack?.master?.on && state.rack?.master?.autoLevel;
    toast(`RMS ${r.rmsDb.toFixed(1)} → ${after.rmsDb.toFixed(1)} dB, peak ${after.peakDb.toFixed(1)} dB`
      + (levelling ? ' — the maximiser is levelling the output, so the target is its call, not this one\u2019s' : ''));
  }
}

/// Peak's Find Peak: a measurement that moves the insertion point.
async function findPeakCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const range = state.sel ? { start: state.sel.start, end: state.sel.end } : { start: 0, end: 0 };
  let r;
  try { r = await postJSON('/api/measure', { p: state.selectedFile.path, ...range }); }
  catch (e) { toast(e.message); return; }
  if (r.peakFrame === undefined) { toast('Nothing to measure'); return; }
  setCue(r.peakFrame);
  centreOn(r.peakFrame);
  const sr = state.view.sampleRate || 44100;
  toast(`Peak ${r.peakDb.toFixed(2)} dB at ${fmtTime(r.peakFrame / sr)}${state.sel ? ' in the selection' : ''}`);
}

async function stripSilenceCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const v = await ask('Strip silence', [
    { key: 'thresholdDb', label: 'Threshold (dB)', value: -40, min: -90, max: 0, step: 1 },
    { key: 'minMs', label: 'Shortest gap (ms)', value: 100, min: 1, max: 60000, step: 1 },
    { key: 'padMs', label: 'Leave either side (ms)', value: 10, min: 0, max: 5000, step: 1 },
    { key: 'mode', label: 'What to do', type: 'select', value: 'remove',
      options: [['remove', 'remove it and close the gap'], ['silence', 'flatten it, keep the timing']] },
  ], { hint: 'Level is judged over a short window, so a loud waveform passing through zero is not mistaken for silence. Find Peak on a quiet passage is a good way to choose the threshold.' });
  if (!v) return;
  const before = state.edit?.frames || 0;
  await editOp({ op: 'stripSilence', start: state.sel?.start ?? 0, end: state.sel?.end ?? 0, ...v });
  const after = state.edit?.frames || 0;
  const sr = state.view.sampleRate || 44100;
  toast(v.mode === 'remove'
    ? (before === after ? 'No silence found at that threshold' : `Removed ${((before - after) / sr).toFixed(2)}s`)
    : 'Quiet passages flattened');
}

async function repairClickCmd() {
  if (!needSel()) return;
  const v = await ask('Repair click', [
    { key: 'widthMs', label: 'Width to remove (ms)', value: 1, min: 0.05, max: 50, step: 0.05 },
  ], { hint: 'The worst discontinuity in the selection is taken out and the join is ramped so it cannot step. Peak redraws the damaged samples instead; a clip list has no way to write one, so this removes them — a fraction of a millisecond, and inaudible.' });
  if (!v) return;
  const before = state.edit?.frames || 0;
  await editOp({ op: 'repairClick', start: state.sel.start, end: state.sel.end, widthMs: v.widthMs });
  const gone = before - (state.edit?.frames || 0);
  toast(gone > 0 ? `Repaired — ${gone} samples removed` : 'No click found in the selection');
}

// ----------------------------------------------- markers and regions, Peak's

async function annot(body) {
  if (!state.selectedFile) { toast('Open a sound first'); return null; }
  try {
    state.annotations = await postJSON('/api/annot', { p: state.selectedFile.path, ...body });
  } catch (e) { toast(e.message); return null; }
  drawMarkers();
  return state.annotations;
}

async function markersToRegionsCmd() {
  const each = false;
  const r = await annot({
    op: 'markersToRegions',
    start: state.sel?.start ?? 0,
    end: state.sel?.end ?? 0,
    each,
  });
  if (r) toast(`${r.regions.length} region${r.regions.length === 1 ? '' : 's'}`);
}

async function splitRegionCmd() {
  const pos = state.sel ? state.sel.start : (state.cue || 0);
  const was = state.annotations?.regions?.length ?? 0;
  const r = await annot({ op: 'splitRegion', pos });
  if (!r) return;
  // A split at frame zero, or at the very end, has nothing on both sides of it
  // and does nothing. Saying "Split" anyway is worse than saying nothing.
  toast(r.regions.length > was
    ? 'Split'
    : 'Nothing to split at the cursor — put it inside a region, or somewhere other than the very start');
}

async function nudgeCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const sr = state.view.sampleRate || 44100;
  const v = await ask('Nudge markers', [
    { key: 'seconds', label: 'By (seconds)', value: 0.1, step: 'any' },
  ], { hint: 'Positive moves later, negative earlier. Markers and regions inside the selection move; the rest stay. With no selection, everything moves.' });
  if (!v) return;
  await annot({
    op: 'nudge',
    start: state.sel?.start ?? 0,
    end: state.sel?.end ?? 0,
    frames: Math.round(v.seconds * sr),
  });
}

async function renameCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const v = await ask('Rename markers and regions', [
    { key: 'to', label: 'Rename to', type: 'text', value: 'Hit #' },
    { key: 'startAt', label: 'Start at', type: 'text', value: '1' },
    { key: 'contains', label: 'Only those containing', type: 'text', value: '' },
    { key: 'markers', label: 'Markers', type: 'check', value: true },
    { key: 'regions', label: 'Regions', type: 'check', value: false },
  ], { hint: '# becomes a number or a letter counting up from “Start at”. Zeros after it set the width: “Event #000” from 10 gives Event 010, Event 011. They are numbered in timeline order.' });
  if (!v) return;
  const body = {
    op: 'rename',
    start: state.sel?.start ?? 0,
    end: state.sel?.end ?? 0,
    to: v.to,
    startAt: v.startAt,
    markers: v.markers,
    regions: v.regions,
  };
  if (v.contains) body.contains = v.contains;
  await annot(body);
}

async function deleteMarkersCmd() {
  const r = await annot({
    op: 'deleteMarkers',
    start: state.sel?.start ?? 0,
    end: state.sel?.end ?? 0,
  });
  if (r) toast('Markers deleted');
}

// ------------------------------------------------------------ into the menus
//
// Appended rather than written into MENUS above, so the two new menus sit where
// Peak has them — after Edit — without disturbing the four that were there.

MENUS.splice(2, 0,
  {
    title: 'Action',
    items: [
      { label: 'Set selection…', on: hasFile, run: setSelectionDialog },
      { label: 'Select all', key: '⌘A', on: hasFile, run: () => selectAll() },
      { sep: true },
      { label: 'Fit selection', key: '⇧⌘]', on: hasSel, run: fitSelection },
      { label: 'Zoom at sample level', key: '⇧←', on: hasFile, run: () => zoomToSample(false) },
      { label: 'Zoom at sample level (end)', key: '⇧→', on: hasSel, run: () => zoomToSample(true) },
      { label: 'Zoom out all the way', on: hasFile, run: click('zoomFit') },
      { sep: true },
      { label: 'Snap to zero crossings', key: tick(() => state.snap === 'zero'),
        run: () => setSnap('zero') },
      { label: 'Snap to CD frames', key: tick(() => state.snap === 'cd'), run: () => setSnap('cd') },
      { label: 'Snap off', key: tick(() => state.snap === 'off'), run: () => setSnap('off') },
      { sep: true },
      { label: 'New marker', key: 'M', on: hasFile, run: op('marker') },
      { label: 'New region', key: 'R', on: hasSel, run: op('region') },
      { label: 'New region split', on: hasFile, run: splitRegionCmd },
      { label: 'Markers to regions', on: hasFile, run: markersToRegionsCmd },
      { sep: true },
      { label: 'Nudge markers…', on: hasFile, run: nudgeCmd },
      { label: 'Rename…', on: hasFile, run: renameCmd },
      { label: 'Delete markers in selection', on: hasSel, run: deleteMarkersCmd },
      { sep: true },
      { label: 'Go to…', key: '⌘G', on: hasFile, run: goTo },
    ],
  },
  {
    title: 'DSP',
    items: [
      { label: 'Normalize…', on: hasFile, run: normalizeCmd },
      { label: 'Normalize (RMS)…', on: hasFile, run: normalizeRmsCmd },
      { label: 'Find peak', on: hasFile, run: findPeakCmd },
      { sep: true },
      { label: 'Fade in', on: hasSel, run: op('fadeIn') },
      { label: 'Fade out', on: hasSel, run: op('fadeOut') },
      { label: 'Reverse', on: hasSel, run: op('reverse') },
      { sep: true },
      { label: 'Strip silence…', on: hasFile, run: stripSilenceCmd },
      { label: 'Repair click…', on: hasSel, run: repairClickCmd },
      { sep: true },
      // The live ones. They are rack effects here rather than commands you
      // apply and wait for, so the menu says where they are rather than
      // pretending to be a second way of running them.
      { label: 'Live shapers are in the Effects tray', on: () => false, run: () => {} },
    ],
  },
);

function setSnap(unit) {
  state.snap = unit;
  localStorage.setItem('audiolab.snap', unit);
  const sel = $('snapUnit');
  if (sel) sel.value = unit;
  toast(unit === 'off' ? 'Snap off' : `Snapping to ${unit === 'zero' ? 'zero crossings' : unit.toUpperCase()}`);
}

// The Edit menu gains the three commands that belong to it rather than to
// Action or DSP, next to the ones they are variants of.
(() => {
  const edit = MENUS.find((m) => m.title === 'Edit');
  const at = edit.items.findIndex((i) => i.label === 'Silence');
  edit.items.splice(at, 0,
    { label: 'Crop', key: '⌘`', on: hasSel, run: op('crop') },
    { label: 'Duplicate…', on: hasSel, run: duplicateCmd },
    { label: 'Insert silence…', on: hasFile, run: insertSilenceCmd },
  );
  buildMenuBar();
})();

// ------------------------------------------------------------------- keys
//
// The shortcuts the menus advertise. Anything typed into a field belongs to the
// field, so the whole set stands down while one has focus.

// ============================================================== the keyboard
//
// One listener. There were six, and they did not know about each other: a
// single Escape ran four of them, so dismissing the preset manager also wiped
// the selection and sent the cue to zero. Nothing called `stopPropagation`,
// no two agreed on what counted as a text field, and only one of them knew a
// dialog could be open at all.
//
// Three tiers, in order. A key never falls past the tier that claims it:
//
//   1. focus is in a text field  — the field owns every key
//   2. an overlay is open        — Escape closes the topmost, space still
//                                  plays, nothing else is interpreted
//   3. otherwise                 — the shortcuts
//
// Space stays live in tier 2 on purpose. The transport answers the space bar
// everywhere, because that is the one binding a user should never have to
// think about. The ask dialog is the single exception and it enforces that
// itself: while it is up it holds a handler on the capture phase, so Enter and
// Escape reach it before this listener exists as far as the event is
// concerned.

/// A key belongs to the field being typed into, and to nothing else.
///
/// `SELECT` is in here because a dropdown takes arrow keys and type-ahead, and
/// it was the gap that let space start playback with a menu focused. Two of
/// the old handlers guarded it and three did not.
function inTextField(t) {
  if (!t) return false;
  if (t.isContentEditable) return true;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/// What Escape should close, most transient first, or null if nothing is open.
///
/// A menu is drawn over everything and is the cheapest thing to dismiss, so it
/// is tested before the panels it may be covering. Returning null is what puts
/// a keypress through to tier 3, which is why "deselect" can safely live down
/// there — it now only fires when the screen really is clear.
function topOverlay() {
  if (openMenu || !$('menuPop').classList.contains('hidden')) return closeMenus;
  if (!$('pickerModal').classList.contains('hidden')) {
    return () => $('pickerModal').classList.add('hidden');
  }
  if (!$('exportLoop').classList.contains('hidden')) return closeExportLoop;
  if (!$('presetManager').classList.contains('hidden')) return closePresetManager;
  // The note keyboard is a floating panel rather than a shadowbox, but it is
  // still a window, and Escape closes the front one. So is the grain views
  // window, which was opened after this list was written and left out of it.
  if (keyboardOpen()) return closeKeyboard;
  if (visWindowOpen()) return closeVisWindow;
  if (pop.el && !pop.el.classList.contains('hidden')) return closeVisPop;
  return null;
}


// ─────────────────────────────────────────────────────────── the note keyboard
//
// Play the pitch from the computer keyboard.
//
// The letters are the layout every tracker and DAW has used for thirty years:
// `A` is the tonic, the row above carries the notes between, and the two rows
// interlock exactly the way a piano's whites and blacks do. `Z` and `X` move an
// octave and latch, so three presses of `X` is three octaves up.
//
// **What each key plays comes from the tuning, not from twelve semitones.** The
// scale menu offers eighty-one of them and many are not twelve-tone — so the
// keys are bound to scale *degrees* in order, and an octave is the scale's own
// span rather than 1200 cents by assumption. On plain 12-TET that reproduces a
// piano exactly; on a seven-degree scale the eighth key is the tonic again, a
// span up; on a 22-degree scale the row simply keeps going.

/// The letters, in pitch order. Two rows interlocking as whites and blacks.
const NOTE_KEYS = [
  ['a', 0], ['w', 1], ['s', 2], ['e', 3], ['d', 4], ['f', 5], ['t', 6],
  ['g', 7], ['y', 8], ['h', 9], ['u', 10], ['j', 11], ['k', 12],
  ['o', 13], ['l', 14], ['p', 15], [';', 16], ["'", 17],
];

/// Which of those sit on the upper row — the ones a piano draws black.
const UPPER_ROW = new Set(['w', 'e', 't', 'y', 'u', 'o', 'p']);

const keyboardState = { octave: 0, held: null };

/// The degrees of the chosen tuning, in cents, and the span that repeats.
///
/// With no scale the grid is the answer: a pitch step if one is set, and plain
/// semitones otherwise. That is what "free" already means everywhere else.
function scaleDegrees() {
  const name = currentScale();
  if (name) {
    for (const g of state.scales || []) {
      for (const s of g.scales) {
        if (s.name === name) return { cents: s.cents.slice(), span: s.span || 1200 };
      }
    }
  }
  const step = currentStep() > 0 ? currentStep() : 1;
  const n = Math.max(1, Math.round(12 / step));
  return { cents: Array.from({ length: n }, (_, i) => i * step * 100), span: 1200 };
}

/// The pitch a key plays, in semitones.
///
/// `i` counts degrees from the tonic and may run past the end of the scale, at
/// which point it wraps and climbs a span — which is what makes the row keep
/// working whatever the degree count is.
function noteSemitones(i) {
  const { cents, span } = scaleDegrees();
  const n = cents.length || 1;
  const up = Math.floor(i / n);
  const c = cents[((i % n) + n) % n];
  const semis = (up * span + c) / 100 + keyboardState.octave * (span / 100);
  return Math.max(-48, Math.min(48, semis));
}

/// Play one. Sets the pitch exactly as the slider does, so everything that
/// watches it — the readout, automation, the engine — sees one kind of change.
function playNote(i) {
  // The draft is built by the stretch panel, and the keys work whether that
  // panel has been opened or not — so there may not be one yet.
  if (!state.stretchDraft) return;
  const v = noteSemitones(i);
  state.stretchDraft.semitones = v;
  state.stretchRows?.semitones?.sync?.(v);
  previewStretch();
  commitStretch();
  keyboardState.held = i;
  paintKeyboard();
}

function shiftOctave(by) {
  const { span } = scaleDegrees();
  const perOct = span / 100;
  // Latching, and bounded by what the pitch control can actually reach — three
  // presses of X is three octaves, and a fourth past the end is not a silent
  // no-op that looks like a missed keystroke.
  const limit = Math.max(1, Math.floor(48 / Math.max(1, perOct)));
  keyboardState.octave = Math.max(-limit, Math.min(limit, keyboardState.octave + by));
  if (keyboardState.held !== null) playNote(keyboardState.held);
  else paintKeyboard();
}

const keyboardOpen = () => !$('keyboardModal').classList.contains('hidden');

/// The keys, drawn as a piano.
///
/// The lower row is the whites and the upper row the blacks, which is not a
/// decoration — it is the same relationship the two rows have under your hand.
/// `W` sits between `A` and `S` on the keyboard and `C#` sits between `C` and
/// `D` on a piano, so a black drawn straddling the seam it plays is showing you
/// the layout you are already touching. That correspondence is the whole reason
/// this letter arrangement has outlasted every program that used it.
///
/// The whites are one unbroken row — a piano has no gaps in them. What varies
/// is where a black sits *over* the seam between two of them: there is one after
/// the first, second, fourth, fifth, sixth, eighth and ninth, and none after the
/// third or seventh. Those two bare seams are E to F and B to C, they are why
/// the pattern repeats every seven, and they are why the letters work out.
///
/// Keyed by which white a black follows.
const WHITE_AFTER = { w: 0, e: 1, t: 3, y: 4, u: 5, o: 7, p: 8 };

/// One white key, in pixels. The keyboard is this times eleven and the panel is
/// only as wide as that.
const KEY_WIDTH = 26;

function paintKeyboard() {
  const box = $('kbPiano');
  if (!box) return;
  const { cents, span } = scaleDegrees();
  box.innerHTML = '';

  const whites = NOTE_KEYS.filter(([k]) => !UPPER_ROW.has(k));
  const blacks = NOTE_KEYS.filter(([k]) => UPPER_ROW.has(k));
  // Sized from the key, not from the panel. Stretching eleven whites across a
  // 680px window made each one sixty pixels wide against eighty-four tall,
  // which is not a piano key — a real one is roughly one to six. At 26 by 84
  // the proportion reads right and the panel is only as wide as the keyboard.
  const unit = KEY_WIDTH;
  const span_px = whites.length * unit;
  box.style.width = `${span_px}px`;
  // The window is the width of the keyboard, full stop. Letting it size to its
  // contents meant a long scale name set the width and the keyboard sat in a
  // wide empty box.
  const card = document.querySelector('.kb-card');
  if (card) card.style.width = `${span_px + 14}px`;

  const label = (key, i) => {
    const semis = noteSemitones(i);
    return {
      semis,
      html: `<span class="kb-letter">${key.toUpperCase()}</span>`
        + `<span class="kb-semis">${semis >= 0 ? '+' : ''}${semis.toFixed(2)}</span>`,
      title: `${key.toUpperCase()} — degree ${(i % (cents.length || 1)) + 1} of ${cents.length}`
        + `, ${semis >= 0 ? '+' : ''}${semis.toFixed(2)} semitones`,
    };
  };

  whites.forEach(([key], n) => {
    const i = NOTE_KEYS.findIndex(([k]) => k === key);
    const l = label(key, i);
    const b = document.createElement('button');
    b.className = 'kb-key white' + (keyboardState.held === i ? ' on' : '');
    b.style.left = `${n * unit}px`;
    b.style.width = `${unit}px`;
    b.innerHTML = l.html;
    b.title = l.title;
    b.onclick = () => playNote(i);
    box.appendChild(b);
  });

  blacks.forEach(([key]) => {
    const after = WHITE_AFTER[key];
    if (after === undefined) return;
    const i = NOTE_KEYS.findIndex(([k]) => k === key);
    const l = label(key, i);
    const b = document.createElement('button');
    b.className = 'kb-key black' + (keyboardState.held === i ? ' on' : '');
    // Straddling the seam between two whites, and a shade left of centre —
    // which is where the upper row actually sits above the home row.
    b.style.left = `${(after + 1) * unit - unit * 0.34}px`;
    b.style.width = `${unit * 0.62}px`;
    b.innerHTML = l.html;
    b.title = l.title;
    b.onclick = () => playNote(i);
    box.appendChild(b);
  });

  const oct = $('kbOctave');
  if (oct) {
    oct.textContent = keyboardState.octave === 0
      ? 'octave 0'
      : `octave ${keyboardState.octave > 0 ? '+' : ''}${keyboardState.octave}`;
    oct.classList.toggle('on', keyboardState.octave !== 0);
  }
  const now = $('kbNow');
  if (now) {
    now.textContent = keyboardState.held === null
      ? ''
      : `${noteSemitones(keyboardState.held).toFixed(2)} st`;
  }
  const sc = $('kbScale');
  if (sc) {
    // Same rules as a button: no parentheses, no qualifier after a dash, and
    // the words collapse rather than the panel growing to hold them. This line
    // was stretching the window past the keyboard it is describing.
    sc.textContent = currentScale()
      ? `${fitLabel(currentScale())} · ${cents.length} deg`
      : `${cents.length} steps / oct`;
  }
}

/// The hints, taking turns on one line.
///
/// Shown side by side they forced the panel to more than twice the keyboard's
/// width for text you read once. One at a time they cost a single line and can
/// say more than they did — and a slow fade is legible in a way a hard swap is
/// not, because the eye is drawn to the change rather than startled by it.
const KB_HINTS = [
  '<b>A</b> is the tonic',
  '<b>Z</b> / <b>X</b> shift an octave, and latch',
];

let kbHintAt = 0;
let kbHintTimer = null;

function showHint() {
  const el = $('kbHint');
  if (!el) return;
  el.innerHTML = KB_HINTS[kbHintAt % KB_HINTS.length];
  el.classList.remove('out');
}

function cycleHint() {
  const el = $('kbHint');
  if (!el) return;
  el.classList.add('out');
  // Half a second is the fade in the stylesheet; swapping at the end of it is
  // what makes this a cross-fade rather than a flicker.
  setTimeout(() => {
    kbHintAt += 1;
    showHint();
  }, 450);
}

/// Advance it now, and start the ten seconds again from here — a click that
/// only queued the next one behind an old timer would sometimes change twice.
function nudgeHint() {
  cycleHint();
  if (kbHintTimer) {
    clearInterval(kbHintTimer);
    kbHintTimer = setInterval(cycleHint, 10_000);
  }
}

function openKeyboard() {
  $('keyboardModal').classList.remove('hidden');
  paintKeyboard();
  showHint();
  // Only while it is open. A timer left running against a hidden panel is a
  // wakeup every ten seconds for nothing.
  clearInterval(kbHintTimer);
  kbHintTimer = setInterval(cycleHint, 10_000);
}

function closeKeyboard() {
  $('keyboardModal').classList.add('hidden');
  keyboardState.held = null;
  clearInterval(kbHintTimer);
  kbHintTimer = null;
}

$('visWindowClose').onclick = closeVisWindow;
$('kbClose').onclick = closeKeyboard;
$('kbHint').onclick = nudgeHint;

/// Draggable by its header, because a floating panel that cannot be moved is a
/// panel sitting on top of whatever you wanted to look at.
(() => {
  const panel = $('keyboardModal');
  const head = $('kbDrag');
  if (!panel || !head) return;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    head.classList.add('dragging');
    const box = panel.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (ev) => {
      // Placed from the top-left once dragged, so the centring transform has to
      // go — otherwise it fights the pointer by half the panel's width.
      panel.style.transform = 'none';
      panel.style.bottom = 'auto';
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - box.width, ev.clientX - dx))}px`;
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
    };
    const up = () => {
      head.classList.remove('dragging');
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
})();

/// Handle a keystroke as a note. Returns true if it was one.
///
/// **Live whenever a sound is open in Edit**, not only while the window is
/// showing — the window is the picture of the layout, not a mode you have to be
/// in to play. There is one app-wide binding besides these (space, for the
/// transport) and none of these letters is it, so the keyboard was free to take.
///
/// Modifiers are always let through: `⌘Z` is undo and must stay undo.
function noteKeys(e) {
  if (state.mode !== 'edit' || !state.selectedFile) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); shiftOctave(-1); return true; }
  if (k === 'x') { e.preventDefault(); shiftOctave(1); return true; }
  const at = NOTE_KEYS.findIndex(([n]) => n === k);
  if (at < 0) return false;
  e.preventDefault();
  if (!e.repeat) playNote(at);
  return true;
}

document.addEventListener('keydown', (e) => {
  // 1 — the field owns it.
  if (inTextField(e.target)) return;

  // The ask dialog has the event already; reacting here as well is how Enter
  // used to confirm a dialog and change section in the same keystroke.
  if (!$('askModal').classList.contains('hidden')) return;

  // The note keyboard. Before the overlay tier so the Keys window can stay open
  // while you play, and after the text-field guard so typing a name is typing a
  // name. Escape is never a note.
  if (e.key !== 'Escape' && noteKeys(e)) return;

  // 2 — something is open. Escape closes exactly one thing, and stops.
  const dismiss = topOverlay();
  if (dismiss) {
    if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
    if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
    return;
  }

  // 3 — the shortcuts.
  const mod = e.metaKey || e.ctrlKey;

  if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }

  else if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); $('undoBtn').click(); }
  else if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); $('redoBtn').click(); }

  else if (mod && e.key === '`') { e.preventDefault(); op('crop')(); }
  else if (mod && !e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); goTo(); }
  else if (mod && e.shiftKey && e.key === ']') { e.preventDefault(); fitSelection(); }

  else if (!mod && e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); zoomToSample(false); }
  else if (!mod && e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); zoomToSample(true); }

  // Scoped to Edit, and given a `preventDefault` it never had. A bare letter
  // with a consequence has no business firing while you are browsing.
  else if (!mod && e.key === 'm' && state.mode === 'edit') { e.preventDefault(); addMarker(); }

  else if (!mod && e.key === 'Enter' && state.selectedFile) {
    e.preventDefault();
    setMode(state.mode === 'edit' ? 'overview' : 'edit');
  }

  // Nothing is open, so Escape means deselect. This is the branch that used to
  // fire underneath every dialog on the page.
  else if (e.key === 'Escape') {
    state.sel = null; setCue(0); drawSelection(); applyLoop();
  }
});


// ==================================================================== theme
//
// A palette gives colour and direction. Everything else — the surface ladder,
// the four text steps, the borders — is derived, which is what lets a palette
// nobody designed for this program still produce a usable interface: the steps
// are ours and only the colour is theirs.
//
// The engine is a port and lives in `theme-derive.js`; the palettes in
// `theme-palettes.js`. What is here is the manager, in this app's own idiom
// rather than the React one it arrived in.

const THEME_STORE = 'audiolab.theme';

const themeState = {
  /// Palettes the user added. The shipped 47 are read-only and live in
  /// `THEME_PALETTES` — previewable and duplicable, never edited away.
  mine: [],
  chosen: null,
  plain: false,
};

/// The palettes this interface can actually wear.
///
/// The chrome assumes depth reads as *lighter* — a raised surface is a lighter
/// one — which is a dark-theme assumption baked into every panel. Give it a
/// light palette and the ladder walks toward white and the whole interface goes
/// flat: all 27 light palettes in the library break it, all 20 dark ones hold.
///
/// So light palettes are withheld rather than offered and disappointing. They
/// are not gone: when the chrome learns to invert its ladder they are already
/// here, and the engine already reports which direction a palette wants.
/// The shipped list, derived once.
///
/// Deciding whether a palette is dark means deriving it, and there are 47 that
/// need it. The answer depends only on `p.colors`, which is a constant — so
/// doing it per call was 47 derivations to answer a question whose answer never
/// changes, on every theme click and twice at startup.
///
/// That was survivable while a derivation was microseconds. It stopped being
/// survivable the day one cost 54ms and the whole call took 2.7 seconds. The
/// underlying bug is fixed, but the work was always wasted; see
/// `tests/ui/globals.spec.mjs`.
let shippedPalettes = null;

function allPalettes() {
  if (!shippedPalettes) {
    shippedPalettes = THEME_PALETTES
      .filter((p) => (p.direct || !p.colors ? p.dark : Theme.deriveTheme(p.colors).mode === 'dark'))
      .map((p) => ({ ...p, readOnly: true }));
  }
  // `mine` is not cached: it is what the Add button changes.
  return [...shippedPalettes, ...themeState.mine];
}

/// What a palette actually writes onto the document.
///
/// Two kinds live in one list. Most give colours and the engine derives sixty
/// tokens from them; a `direct` theme states its tokens outright and they are
/// used verbatim, because derivation cannot be argued with and a theme somebody
/// designed for this interface should not have to be.
///
/// Anything a direct theme omits is left to `app.css` — `Theme.apply` clears the
/// whole map before writing, so the status colours come back on their own.
function themeTokensFor(p) {
  if (!p) return null;
  return p.direct ? p.tokens : Theme.appTokens(p.colors, { plain: themeState.plain }).tokens;
}

/// Kept in the browser rather than in `data/`.
///
/// A theme is a property of the machine you are looking at, not of the library —
/// the same library opened on two screens should be allowed to look different on
/// each. It is also the one setting where losing it costs nothing.
function loadTheme() {
  try {
    const v = JSON.parse(localStorage.getItem(THEME_STORE) || '{}');
    themeState.mine = Array.isArray(v.mine) ? v.mine : [];
    themeState.chosen = v.chosen || null;
    themeState.plain = !!v.plain;
  } catch { /* a corrupt entry is no theme, not a broken app */ }
}

function saveTheme() {
  try {
    localStorage.setItem(THEME_STORE, JSON.stringify({
      mine: themeState.mine, chosen: themeState.chosen, plain: themeState.plain,
    }));
  } catch { /* private browsing, a full quota — neither is worth a toast */ }
}

function applyChosenTheme() {
  const p = allPalettes().find((x) => x.id === themeState.chosen);
  Theme.apply(p ? themeTokensFor(p) : null);
  // The waveform travels with the theme. `applyWaveColour` is defined below
  // this, but this only ever runs from a handler or after load, never during
  // it, so the ordering is safe — unlike reaching for it at declaration time.
  if (typeof applyWaveColour === 'function') applyWaveColour({ save: false });
}

/// The studio's own state, declared here rather than beside the rest of the
/// studio because `renderThemeList` reads it and runs during load.
///
/// `let` and `const` hoist into a dead zone: until the declaration executes,
/// even `typeof` on the name throws. Declaring these after their first reader
/// therefore did not merely leave them undefined — it threw during load and
/// took the rest of `app.js` with it, which is the same failure as the palette
/// that had no `colors`. Load order is a real dependency and this file is one
/// long script.
///
/// `tsSelected` is the palette open in the editor. `themeState.chosen` is the
/// one the application is wearing. They are different, and you edit one while
/// wearing another.
let tsSelected = null;
let tsFilterText = '';
let tsShowTokens = false;

function renderThemeList() {
  const box = $('themeList');
  if (!box) return;
  box.innerHTML = '';
  const q = tsFilterText.trim().toLowerCase();
  const shown = q
    ? allPalettes().filter((p) => p.name.toLowerCase().includes(q))
    : allPalettes();
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'ts-empty';
    empty.textContent = q ? 'No palettes match that filter.' : 'No palettes yet.';
    box.appendChild(empty);
    return;
  }
  for (const p of shown) {
    const row = document.createElement('div');
    // Two different states, and conflating them was the old behaviour's fault:
    // `chosen` is the palette the application is *wearing*, `tsSelected` is the
    // one open in the editor. You edit one while wearing another.
    row.className = 'theme-row'
      + (p.id === themeState.chosen ? ' chosen' : '')
      + (p.id === tsSelected ? ' editing' : '');
    // A theme saved from the editor states its tokens outright and has no five
    // colours behind it. Assuming every palette carries `colors` threw here at
    // load, which aborted the rest of `app.js` — so the meters, the room and
    // everything after simply never came into being.
    const chips = p.colors
      || (p.tokens ? ['--accent', '--surface-2', '--surface', '--bg', '--sink']
        .map((k) => p.tokens[k]).filter(Boolean) : []);
    row.title = `${p.name} — ${chips.join(' ')}`;

    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    for (const c of chips.slice(0, 6)) {
      const chip = document.createElement('i');
      chip.style.background = c;
      swatch.appendChild(chip);
    }

    const name = document.createElement('span');
    name.className = 'theme-name';
    name.textContent = p.name;
    for (const [when, text] of [[p.id === themeState.chosen, ' · applied'],
      [p.readOnly, ' · built in']]) {
      if (!when) continue;
      const note = document.createElement('i');
      note.className = 'theme-inline-note';
      note.textContent = text;
      name.appendChild(note);
    }

    row.append(swatch, name);
    if (!p.readOnly) {
      const del = document.createElement('button');
      del.className = 'theme-del';
      del.textContent = '×';
      del.title = 'Remove this palette';
      del.onclick = (e) => {
        e.stopPropagation();
        themeState.mine = themeState.mine.filter((x) => x.id !== p.id);
        if (themeState.chosen === p.id) themeState.chosen = null;
        saveTheme(); applyChosenTheme(); renderThemeList();
      };
      row.appendChild(del);
    }

    row.onclick = () => {
      // Clicking the chosen one takes it off, so there is always a way back to
      // the interface's own colours without hunting for a button.
      // Click a theme to *see* it. The studio this came from is an admin
      // screen with the application elsewhere, so there it made sense to open a
      // palette without wearing it. Here the panel sits inside the thing being
      // themed — the whole point of clicking one is to look at the app in it.
      // It opens in the editor at the same time.
      tsSelected = p.id;
      themeState.chosen = themeState.chosen === p.id ? null : p.id;
      saveTheme();
      applyChosenTheme();
      tsRender();
      renderThemeList();
    };
    box.appendChild(row);
  }
}

// ------------------------------------------------------------ waveform colour

/// Four neon colours for the waveform, and anything else you name.
///
/// Deliberately *not* part of the palette engine. A theme derives sixty tokens
/// from a handful of colours so the chrome holds contrast; the waveform is not
/// chrome — it is the thing being looked at, and it wants to be the loudest
/// colour on the screen rather than a consequence of the surfaces behind it.
/// `Theme.apply` only clears the tokens in its own map, so this one survives
/// every palette change and every "No theme".
///
/// The chroma is past what sRGB can show on purpose: it clamps to the edge of
/// the gamut, which is exactly as neon as the display goes.
const WAVE_COLOURS = {
  blue:   'oklch(70% 0.24 250)',
  green:  'oklch(82% 0.28 145)',
  red:    'oklch(64% 0.29 27)',
  purple: 'oklch(60% 0.32 310)',
};
const WAVE_STORE = 'audiolab.waveColour';

/// What is stored: one of the four names, a `#hex`, or nothing for the default.
///
/// A palette carries its own now, so this is the *worn* palette's waveform,
/// then the standing choice in local storage, which is what a fresh install and
/// a "No theme" both fall back to.
///
/// **Not the palette open in the editor.** Preferring that meant clicking a
/// palette to look at it repainted the real waveform — which breaks the rule
/// the rest of the studio keeps, that selecting opens a palette and only Apply
/// wears it. What the editor is holding belongs to the preview; see
/// `waveShown`.
///
/// Deliberately not written with `tsPalette`, which is a `const` declared in the
/// studio block far below: calling it from here at load time would reach into
/// its dead zone and throw. `allPalettes` and `themeState` are declared above.
function waveChoice() {
  const worn = themeState.chosen
    ? allPalettes().find((p) => p.id === themeState.chosen)?.wave
    : null;
  if (worn) return worn;
  try { return localStorage.getItem(WAVE_STORE) || null; } catch { return null; }
}

/// What the *editor* is showing — the open palette's waveform when there is
/// one, otherwise whatever the page is wearing. This drives the swatches and
/// the miniature, and never the page.
function waveShown() {
  const open = tsSelected ? allPalettes().find((p) => p.id === tsSelected) : null;
  return open?.wave ?? waveChoice();
}

/// Whether the waveform controls are editing a palette rather than the standing
/// default — true when an editable palette is open in the studio.
function waveEditsPalette() {
  const p = tsSelected ? allPalettes().find((x) => x.id === tsSelected) : null;
  return !!p && !p.readOnly;
}

function waveColourValue(choice) {
  if (!choice) return null;
  return WAVE_COLOURS[choice] || (/^#[0-9a-f]{3,8}$/i.test(choice) ? choice : null);
}

/// `--wave` inline on `:root`, which beats the stylesheet without touching it —
/// the same trick `Theme.apply` uses, and removing it is how the default comes
/// back rather than a copy of the default that could drift.
function applyWaveColour({ save = true, redraw = true } = {}) {
  const choice = applyWaveColour.live ?? waveChoice();
  const value = waveColourValue(choice);
  const root = document.documentElement;
  if (value) root.style.setProperty('--wave', value);
  else root.style.removeProperty('--wave');
  if (save && applyWaveColour.live === undefined) renderWaveColours();
  if (redraw) {
    // Everywhere the waveform is drawn, not just the lane: the overview, the
    // browse rows and the automation lanes all take `--wave`.
    drawWave(); drawOverview(); drawGrainLayer();
    // The browse rows hold their waveform in a canvas each, drawn once when the
    // row was built — so they are repainted from the thumbnails already in hand
    // rather than re-fetched.
    for (const row of document.querySelectorAll('.file-row')) {
      const path = row.dataset.path;
      const thumb = row.querySelector('.thumb');
      if (thumb && path && state.thumbs?.[path]) {
        drawThumb(thumb, state.thumbs[path], row.classList.contains('selected'));
      }
    }
  }
}

function setWaveColour(choice) {
  // Onto the palette when one is open, so a theme carries the sound's colour
  // with it. Onto local storage otherwise, which is the standing default.
  if (waveEditsPalette()) {
    const p = allPalettes().find((x) => x.id === tsSelected);
    const i = themeState.mine.findIndex((x) => x.id === p.id);
    if (i >= 0) {
      if (choice) themeState.mine[i] = { ...themeState.mine[i], wave: choice };
      else { const { wave, ...rest } = themeState.mine[i]; themeState.mine[i] = rest; }
      saveTheme();
      renderThemeList();
    }
  } else {
    try {
      if (choice) localStorage.setItem(WAVE_STORE, choice);
      else localStorage.removeItem(WAVE_STORE);
    } catch { /* private mode — it still applies for this session */ }
  }
  applyWaveColour.live = undefined;
  applyWaveColour();
}

function renderWaveColours() {
  const box = $('waveColours');
  if (!box) return;
  // What the editor is holding, not what the page is wearing.
  const choice = waveShown();
  for (const b of box.querySelectorAll('[data-wave]')) {
    b.classList.toggle('active', b.dataset.wave === choice);
    b.style.setProperty('--chip', WAVE_COLOURS[b.dataset.wave]);
  }
  // The swatch starts from what is on screen, whichever way it got there — so
  // reaching for your own colour is a nudge from the current one rather than
  // from whatever the picker happened to hold last. A named colour is `oklch`
  // and the native swatch only speaks hex, so it goes through the browser.
  const own = $('waveOwn');
  if (own) {
    const shown = waveColourValue(choice) || getComputedStyle(document.documentElement)
      .getPropertyValue('--wave').trim();
    const hex = cssHex(shown);
    if (hex) own.value = hex;
  }
}

/// Any CSS colour to `#rrggbb`, by painting one pixel of it and reading it back.
///
/// Not through `getComputedStyle`: a modern browser keeps `oklch()` as `oklch()`
/// there, so scraping numbers out of it read the lightness and chroma as if they
/// were red and green — `oklch(0.7 0.24 250)` came back `#0100fa` and purple came
/// back black. A pixel is the colour after gamut clamping, which is the colour
/// actually on screen and the right thing for the swatch to start from.
///
/// **Named `cssHex`, not `toHex`.** `ui/theme-derive.js` and this file are both
/// classic scripts and share one global scope, and this one loads second — so a
/// `function toHex` here silently replaced the engine's own `toHex(r, g, b)`.
/// Every `hsl()` in the theme engine then handed three numbers to a
/// one-argument function, which returned black: 69 of a derived theme's 86
/// tokens came out `#000000`, and each one built a canvas to do it. See
/// `tests/ui/globals.spec.mjs`, which now fails if the two files declare the
/// same name.
function cssHex(colour) {
  if (!colour) return null;
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour.toLowerCase();
  try {
    const cv = document.createElement('canvas');
    cv.width = 1; cv.height = 1;
    const c = cv.getContext('2d');
    c.fillStyle = '#000';
    c.fillStyle = colour;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

function wireWaveColour() {
  const box = $('waveColours');
  if (!box) return;
  applyWaveColour({ redraw: false });
  renderWaveColours();

  for (const b of box.querySelectorAll('[data-wave]')) {
    b.onclick = () => {
      // Clicking the chosen one takes it off, the same gesture the palette list
      // uses to get back to the interface's own colours.
      setWaveColour(waveChoice() === b.dataset.wave ? null : b.dataset.wave);
    };
  }

  const own = $('waveOwn');
  if (own) {
    // Live while dragging in the picker, committed on change — so you can see
    // the waveform take the colour before deciding.
    own.addEventListener('input', () => {
      applyWaveColour.live = own.value;
      applyWaveColour({ save: false });
    });
    own.addEventListener('change', () => setWaveColour(own.value));
  }
  const reset = $('waveReset');
  if (reset) reset.onclick = () => setWaveColour(null);
}

function wireTheme() {
  if (!$('themeList')) return;
  loadTheme();
  applyChosenTheme();
  renderThemeList();

  $('themeNone').onclick = () => {
    themeState.chosen = null;
    saveTheme(); applyChosenTheme(); renderThemeList();
  };
  $('themePlain').onclick = () => {
    themeState.plain = !themeState.plain;
    $('themePlain').classList.toggle('on', themeState.plain);
    saveTheme(); applyChosenTheme();
  };
  $('themeAdd').onclick = () => {
    const raw = $('themeColors').value || '';
    const colors = raw.split(/[\s,]+/).filter(Boolean)
      .map((c) => (c.startsWith('#') ? c : `#${c}`))
      .filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
    if (colors.length < 2) { toast('Two colours at least'); return; }
    const taken = allPalettes().map((p) => p.id);
    let id = `mine-${colors.length}-${Date.now().toString(36)}`;
    while (taken.includes(id)) id += 'x';
    themeState.mine.push({ id, name: `Mine ${themeState.mine.length + 1}`, colors });
    themeState.chosen = id;
    $('themeColors').value = '';
    saveTheme(); applyChosenTheme(); renderThemeList();
  };
}

wireTheme();
wireWaveColour();
checkAudioDevice();
wireLeftPanelResize();

// ─────────────────────────────────────────────────────────── the master bus ──
//
// Three panels reading one tap. The audio callback copies L and R into a ring
// and does nothing else with them; the transform, the correlation and the
// 300 ms integration all happen on the server, and this draws the answers.
// See `docs/MASTER-BUS.md`.

/// The data arrives at this rate, so there is nothing to be gained by drawing
/// faster. A sixty-hertz loop over a twenty-hertz feed redraws the same numbers
/// three times and costs three times as much to do it.
const MB_POLL_MS = 50;
/// The bottom of the meter scale, in dBFS.
const MB_METER_FLOOR = -60;
/// The bottom of the spectrum.
const MB_SPEC_FLOOR = -96;
/// How long a peak stays where it landed, and how fast it falls after that.
const MB_HOLD_MS = 1400;
const MB_HOLD_FALL_DB = 18;
/// How much of the goniometer trace is drawn bright. The newest samples read as
/// the live edge; the rest is the short tail that makes the shape legible.
const MB_GONIO_HEAD = 160;

const MB_FFT_STORE = 'audiolab.masterFft';

const masterBus = {
  /// The analyser's transform size. Frequency resolution, and the only part of
  /// the detail worth choosing by hand — the band count follows the pixels.
  fft: (() => {
    const v = Number(localStorage.getItem(MB_FFT_STORE));
    return [1024, 2048, 4096, 8192, 16384].includes(v) ? v : 4096;
  })(),
  /// The last reply, or null when there is nothing playing to report on.
  data: null,
  /// Peak hold per channel: the value, and when it was set.
  hold: { l: MB_METER_FLOOR, r: MB_METER_FLOOR, lAt: 0, rAt: 0 },
  /// The spectrum's own hold, one value per band.
  specHold: null,
  timer: null,
};

/// A proper minus sign, matching every other number in the interface.
function mbDb(v, places = 1) {
  if (!Number.isFinite(v) || v <= -119) return '−∞';
  return v.toFixed(places).replace('-', '−');
}

function mbSigned(v, places = 1) {
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(places);
}

const MB_NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/// The nearest equal-tempered note to a frequency, A440.
///
/// On a spectrum analyser this is the difference between "there is energy at
/// 87 Hz" and "that is an F2" — which is the one a musician can act on.
function noteName(hz) {
  if (!(hz > 0)) return '';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  if (midi < 12 || midi > 127) return '';
  return `${MB_NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/// A token, read from the document so a theme actually reaches these panels.
function mbInk(name, fallback = '#8a949c') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/// Size a canvas to its element and hand back a context ready to draw in CSS
/// pixels, or `null` when it has no size worth drawing into.
///
/// **Both dimensions.** Testing only the width is what left the grain layer's
/// backing store at the old height after a window resize, drawing everything
/// squashed at a size nothing on screen had.
function mbFit(el) {
  if (!el) return null;
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  const wantW = Math.round(w * dpr), wantH = Math.round(h * dpr);
  if (el.width !== wantW || el.height !== wantH) { el.width = wantW; el.height = wantH; }
  const c = el.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return { c, w, h };
}

/// Whether anything would be seen if it were drawn.
///
/// `offsetParent` is null whenever the element or any ancestor is display:none,
/// which covers the dock being shut and another dock tab being chosen without
/// having to know about either.
///
/// And it is null for a fullscreen element too, which is the one state where
/// this read exactly the wrong answer. A fullscreen element is positioned as
/// though it were fixed, and a fixed element has no `offsetParent` — so the
/// panel filling the screen looked identical to the panel being closed, the
/// poll that feeds the room stopped, and what you got was a still picture of
/// the last frame before it went up. The most visible the thing ever gets was
/// the one case counted as hidden.
function mbVisible() {
  const el = $('masterBus');
  if (!el) return false;
  if (document.fullscreenElement === el) return el.clientWidth > 0;
  return el.offsetParent !== null && el.clientWidth > 0;
}

/// dBFS to a fraction of the meter's width.
const mbX = (db) => Math.max(0, Math.min(1, (db - MB_METER_FLOOR) / (0 - MB_METER_FLOOR)));

function mbUpdateHold(now) {
  const d = masterBus.data;
  for (const [side, key, at] of [['left', 'l', 'lAt'], ['right', 'r', 'rAt']]) {
    const db = d ? d[side].peakDb : -120;
    const h = masterBus.hold;
    if (db >= h[key]) { h[key] = db; h[at] = now; continue; }
    const idle = now - h[at];
    if (idle > MB_HOLD_MS) {
      h[key] = Math.max(db, h[key] - MB_HOLD_FALL_DB * (idle - MB_HOLD_MS) / 1000);
      h[at] = now - MB_HOLD_MS;
    }
  }
}

/// The level ladders.
///
/// Two-tone, the way a mastering meter is: a solid body that is 300 ms of RMS —
/// loudness, which is what you mix by — with a dimmer extension above it
/// reaching the peak. One bar tells you both, and the gap between them is the
/// crest factor, read at a glance.
///
/// The scale runs down **both** sides. On a meter this narrow a single column
/// of numbers is always on the wrong side of one of the two bars.
function drawMasterVu() {
  const f = mbFit($('mbVu'));
  if (!f) return;
  const { c, w, h } = f;
  const d = masterBus.data;

  const good = mbInk('--good', '#4fbf7a');
  const warn = mbInk('--warn', '#e0a23c');
  const bad = mbInk('--bad', '#e05c4a');
  const dim = mbInk('--text-dim', '#78838c');
  const line = mbInk('--line-2', '#2a3138');

  const refDb = d?.vuRef ?? -18;
  const kneeDb = d?.knee ? 20 * Math.log10(d.knee) : -3;

  const barW = 20, gap = 4, foot = 10, top = 4;
  const plotH = h - foot - top;
  const mid = w / 2;
  const xs = [mid - barW - gap / 2, mid + gap / 2];
  const yOf = (db) => top + (1 - mbX(db)) * plotH;

  c.font = '8px ui-monospace, monospace';
  c.lineWidth = 1;
  c.textBaseline = 'middle';
  for (const t of [0, -6, -12, -18, -24, -30, -36, -48, -60]) {
    const y = Math.round(yOf(t)) + 0.5;
    c.strokeStyle = line;
    c.globalAlpha = t === refDb ? 0.9 : 0.3;
    c.beginPath(); c.moveTo(xs[0], y); c.lineTo(xs[1] + barW, y); c.stroke();
    c.globalAlpha = 1;
    // Named, because "0 VU = −18 dBFS" is a choice and the meter should say
    // which one was made rather than leave it to be assumed.
    c.fillStyle = t === refDb ? warn : dim;
    c.textAlign = 'right'; c.fillText(t === refDb ? '0VU' : String(t), xs[0] - 3, y);
    c.textAlign = 'left'; c.fillText(String(t), xs[1] + barW + 3, y);
  }

  for (const [i, side] of ['left', 'right'].entries()) {
    const x = xs[i];
    c.fillStyle = 'rgba(255,255,255,.04)';
    c.fillRect(x, top, barW, plotH);
    if (!d) continue;

    const zone = (db) => (db >= kneeDb ? bad : db >= refDb ? warn : good);

    // The peak extension first, dim, so the solid body paints over its foot.
    //
    // Shaded by the level at each height rather than by the peak: colouring the
    // whole extension red because its tip is red paints eleven decibels of
    // perfectly good signal as an alarm.
    const pk = d[side].peakDb;
    if (pk > MB_METER_FLOOR) {
      c.globalAlpha = 0.3;
      for (const [lo2, hi2, colour] of [
        [MB_METER_FLOOR, refDb, good], [refDb, kneeDb, warn], [kneeDb, 0, bad],
      ]) {
        const yB = yOf(lo2), yT = Math.max(yOf(hi2), yOf(pk));
        if (yB <= yT) continue;
        c.fillStyle = colour;
        c.fillRect(x, yT, barW, yB - yT);
      }
      c.globalAlpha = 1;
    }
    // Then the body, in the three zones it actually crosses.
    const vuDb = d[side].vuDb;
    const endY = yOf(vuDb);
    for (const [lo, hi, colour] of [
      [MB_METER_FLOOR, refDb, good], [refDb, kneeDb, warn], [kneeDb, 0, bad],
    ]) {
      const yB = yOf(lo), yT = Math.max(yOf(hi), endY);
      if (yB <= yT) continue;
      c.fillStyle = colour;
      c.fillRect(x, yT, barW, yB - yT);
    }
    // And the hold, riding on top of both.
    const held = masterBus.hold[i ? 'r' : 'l'];
    if (held > MB_METER_FLOOR) {
      c.fillStyle = zone(held);
      c.fillRect(x, Math.round(yOf(held)) - 1, barW, 2);
    }
  }

  c.fillStyle = dim;
  c.textAlign = 'center'; c.textBaseline = 'top';
  c.fillText('L', xs[0] + barW / 2, top + plotH + 2);
  c.fillText('R', xs[1] + barW / 2, top + plotH + 2);
}

/// What the numbers say. The part that was actually asked for.
function paintMasterReads() {
  const d = masterBus.data;
  const kneeDb = d?.knee ? 20 * Math.log10(d.knee) : -3;

  for (const [side, key] of [['left', 'L'], ['right', 'R']]) {
    const ch = d?.[side];
    const hold = masterBus.hold[key === 'L' ? 'l' : 'r'];
    const vu = $(`mb${key}vu`), rms = $(`mb${key}rms`);
    const pk = $(`mb${key}pk`), hd = $(`mb${key}hold`);
    if (!vu) continue;
    // Silence is −∞, not −102.0. The units are a difference from the
    // reference, so at the floor the arithmetic gives a real number and it is a
    // meaningless one — printing it makes silence look like a measurement.
    vu.textContent = ch ? (ch.vuDb <= -119 ? '−∞' : mbSigned(ch.vuUnits)) : '—';
    rms.textContent = ch ? mbDb(ch.vuDb) : '—';
    pk.textContent = ch ? mbDb(ch.peakDb) : '—';
    hd.textContent = d && hold > MB_METER_FLOOR ? mbDb(hold) : '—';
    for (const [el, v] of [[pk, ch?.peakDb], [hd, hold]]) {
      el.classList.toggle('over', !!d && v >= -0.2);
      el.classList.toggle('hot', !!d && v < -0.2 && v >= kneeDb);
    }
  }

  // Sustained negative correlation is the state where every other meter looks
  // fine and the mono fold-down does not, so it is the one worth colouring.
  const corr = $('mbCorrBig');
  if (corr) {
    corr.textContent = d ? mbSigned(d.correlation, 2) : '—';
    corr.classList.toggle('over', !!d && d.correlation < 0);
    corr.classList.toggle('good', !!d && d.correlation > 0.5);
    corr.classList.toggle('hot', !!d && d.correlation >= 0 && d.correlation <= 0.5);
  }
  const word = $('mbCorrWord');
  if (word) {
    // One short word, always.
    //
    // "out of phase" wrapped to two lines in a column this narrow, which made
    // the row taller and shoved every reading below it down the panel — the
    // whole block jumped every time the correlation crossed zero. The state it
    // names is the one you most want to watch steadily, so it is the one that
    // must not make the meter move.
    word.textContent = !d ? ''
      : d.correlation > 0.9 ? 'mono'
      : d.correlation < 0 ? 'phase'
      : d.correlation < 0.4 ? 'wide' : 'stereo';
    word.classList.toggle('warn', !!d && d.correlation < 0);
  }

  // Where the energy actually is. This used to be drawn onto the flat spectrum;
  // the room has no room for a label, so it is computed here and shown in the
  // corner instead.
  const note = $('mbPeakHz');
  if (note) {
    const bands = d?.spectrum;
    if (!bands || !bands.length) note.textContent = '';
    else {
      let top = 0;
      for (let i = 1; i < bands.length; i++) if (bands[i] > bands[top]) top = i;
      if (bands[top] <= MB_SPEC_FLOOR + 6) note.textContent = '';
      else {
        const hz = d.lo * Math.pow(d.hi / d.lo, (top + 0.5) / bands.length);
        const name = noteName(hz);
        note.textContent =
          `${hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`}`
          + `${name ? ` · ${name}` : ''} · ${mbDb(bands[top])} dB`;
      }
    }
  }

  const st = $('mbState');
  if (st) {
    if (!d) st.textContent = 'idle';
    // How much of the last hundred milliseconds the output stage is rounding
    // off. The ceiling working is not a fault, but it should be visible rather
    // than only audible.
    else if (d.overKnee > 0.0005) st.textContent = `ceiling ${(d.overKnee * 100).toFixed(0)}%`;
    else st.textContent = `${(d.rate / 1000).toFixed(1)} kHz · ${(d.fft || 4096) / 1024}k`;
  }
}

async function mbTick() {
  if (!mbVisible()) return;
  // No sound card, no master bus. Without this the meters ask the engine
  // twenty times a second forever on a machine that has none — which is the
  // exact fault `tests/ui/no-audio.spec.mjs` was written for, arriving by a new
  // route. See `docs/NO-AUDIO-DEVICE.md`.
  if (noAudio()) { masterBus.data = null; return; }
  try {
    // One band per pixel of the display about to be drawn into: as much detail
    // as can be seen and not a number more. The transform size is the knob —
    // that is frequency resolution, and it is the one worth choosing.
    const el = $('visGl');
    const want = Math.max(64, Math.min(2048, Math.round(el?.clientWidth || 256)));
    const r = await api(`/api/engine/master?fft=${masterBus.fft}&bands=${want}`);
    masterBus.data = r && r.live ? r : null;
  } catch {
    // A meter that cannot reach the server shows nothing rather than the last
    // thing it saw. Freezing on a stale reading is the one behaviour a meter is
    // not allowed to have.
    masterBus.data = null;
  }
  if (!mbVisible()) return;
  mbUpdateHold(performance.now());
  drawMasterVu();
  paintMasterReads();
  // The room only moves when there is something new to move it, so the
  // waterfall is pushed at the poll's rate and drawn at the display's.
  paintRoomData();
  if (visGl && masterBus.data?.spectrum) {
    visGl.push(masterBus.data.spectrum, masterBus.data.lissajous);
  } else if (visGl && roomEdit.on) {
    // Something to pose against.
    //
    // The room is fed by the meter, so with nothing playing there is nothing in
    // it — which is right for a meter and useless for a camera. Turning the
    // editor on with the transport stopped gave a black rectangle and invisible
    // things to drag.
    //
    // So while the room is being posed it is given a **still test pattern**: a
    // fixed spectrum shape and a fixed figure, pushed at the poll's rate so the
    // terrain fills and then holds. Steady is the point — a camera is judged
    // against something that is not moving, and a signal that jumps under the
    // hand is the same fault the theme editor's miniature was built to avoid.
    visGl.push(...roomTestCard());
  }
}

/// A fixed room to aim at: a few humps across the spectrum and a lopsided
/// figure, so floor, depth and ring all have something in them. Deterministic,
/// so the picture is the same every time the editor is opened and two poses can
/// actually be compared.
function roomTestCard() {
  if (!roomTestCard.made) {
    const bands = new Float32Array(256);
    for (let i = 0; i < bands.length; i++) {
      const f = i / (bands.length - 1);
      // Three humps and a slope, in dB, over the meter's own range.
      const hump = (at, w) => Math.exp(-((f - at) ** 2) / (2 * w * w));
      const v = 0.92 * hump(0.08, 0.05) + 0.66 * hump(0.32, 0.09) + 0.44 * hump(0.7, 0.14);
      bands[i] = -96 + 96 * Math.max(0.04, v * (1 - 0.45 * f));
    }
    const liss = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const t = (i / 256) * Math.PI * 2;
      // Not a circle: a wide-ish image, so the ring is visibly pushed out of
      // round the way real material pushes it.
      liss[i * 2] = 0.62 * Math.sin(t * 3);
      liss[i * 2 + 1] = 0.62 * Math.sin(t * 2);
    }
    roomTestCard.made = [bands, liss];
  }
  return roomTestCard.made;
}

function wireMasterRes() {
  for (const b of document.querySelectorAll('.mb-res-btn')) {
    b.classList.toggle('active', +b.dataset.fft === masterBus.fft);
    b.onclick = () => {
      masterBus.fft = +b.dataset.fft;
      try { localStorage.setItem(MB_FFT_STORE, String(masterBus.fft)); } catch { /* private mode */ }
      for (const o of document.querySelectorAll('.mb-res-btn')) {
        o.classList.toggle('active', o === b);
      }
      // The hold is in the old resolution's bands and would be compared against
      // the new ones index by index, which draws a hold that never happened.
      masterBus.specHold = null;
    };
  }
}

function startMasterBus() {
  if (masterBus.timer) return;
  wireMasterRes();
  masterBus.timer = setInterval(mbTick, MB_POLL_MS);
  // The panels are drawn once so they are not blank before the first reply
  // lands, and again whenever the tray is resized under them.
  const redraw = () => { if (mbVisible()) drawMasterVu(); };
  if (window.ResizeObserver) new ResizeObserver(redraw).observe($('masterBus'));
  redraw();
}
startMasterBus();

// ───────────────────────────────────────────────────────────────── the box ──
//
// The master bus as a room in perspective: the spectrum along the floor
// travelling backwards as the sound plays, the Lissajous in the sky with time
// as its third axis, the ladders standing at the right end. Rendered by
// `vis-gl.js`, which is ours — see `docs/VISUALISER.md`.

let visGl = null;
let visGlRaf = null;

/// A theme token as a WebGL colour.
function vgRgb(token, fallback) {
  const hex = cssHex(mbInk(token, fallback)) || fallback;
  return new Float32Array([
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]);
}

function visGlTick() {
  visGlRaf = requestAnimationFrame(visGlTick);
  const el = $('visGl');
  // A scene nobody is looking at is a full GPU frame for nothing.
  if (!el || el.offsetParent === null) return;

  if (!visGl) {
    visGl = vgAttach(el);
    if (!visGl) {
      // No WebGL. Say so once rather than leave a dead black rectangle.
      const note = $('mbPeakHz');
      if (note) note.textContent = 'no WebGL on this display';
      cancelAnimationFrame(visGlRaf);
      visGlRaf = null;
      return;
    }
  }

  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  // Capped at 2×. Nine times the fill at 3× buys nothing on a glow.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
  }

  visGl.frame({
    cold: vgRgb('--wave-2', '#4a9fd8'),
    hot: vgRgb('--wave', '#5fd47a'),
    core: vgRgb('--accent', '#7fd0ff'),
    // The palette. Null while nothing has been said about colour, and the
    // three above are then the whole of it — which is the room as it shipped.
    paint: rpForRenderer(),
    geom: roomGeom(),
    cam: roomCameraDrawn(),
    layers: roomLayers(),
    occlude: roomOcclude(),
    order: roomOrder(),
    grainDensity: roomEdit.grainDensity,
    grainBright: roomEdit.grainBright,
    ringDrive: roomEdit.ringDrive,
    ringEdge: roomEdit.ringEdge,
    leadThick: roomEdit.leadThick,
    ringPoints: roomEdit.ringPoints,
    grainFill: {
      on: roomEdit.grainFill,
      bg: roomEdit.grainFillBg,
      rgb: vgHexRgb(roomEdit.grainFillColour),
    },
    mist: {
      on: roomEdit.mist,
      amount: roomEdit.mistAmount,
      length: roomEdit.mistLength,
    },
    fog: roomFog(),
    // The schedule itself, so the room draws the grains that exist rather than
    // a model of how many there ought to be.
    //
    // **The swarm's window first, and the view's only as a fallback.**
    //
    // `state.grains` covers the *visible waveform*, which has nothing to do
    // with where the playhead is: press play without follow on and the head
    // walks straight out of the fetched range, so the room empties, and it
    // fills again when something scrolls the view and triggers a refetch. That
    // reads as the picture looping — blanking at the end and starting over —
    // and it is really the room being handed a schedule for somewhere else.
    //
    // `state.swarm` is the same schedule fetched *around the playhead*, which
    // is the window this room is built on: depth is time from now, so the
    // grains it wants are the ones near now. It is null whenever the view's
    // range already covers the playhead densely enough, and then the view's own
    // copy is the right answer anyway.
    grains: (state.swarm?.grains?.length ? state.swarm : state.grains)?.grains || null,
    grainRate: (state.swarm?.grains?.length ? state.swarm : state.grains)?.sampleRate || 44100,
    srcFrames: (state.swarm?.grains?.length ? state.swarm : state.grains)?.srcFrames || 0,
    position: engine.position || 0,
    // The playhead counts in engine frames at the *device* rate; the schedule
    // counts in output frames at the document's. A file at 44.1k on a device at
    // 48k would drift apart steadily if both were divided by the same number.
    positionRate: engine.deviceRate || state.grains?.sampleRate || 44100,
    pollMs: MB_POLL_MS,
  });
}

function startVisGl() {
  if (visGlRaf) return;
  visGlRaf = requestAnimationFrame(visGlTick);
}
startVisGl();

// ────────────────────────────────────────────────────────── the theme editor ──
//
// A miniature of the interface, three pickers, and every change on screen as
// you make it. See `docs/THEME-EDITOR.md`.
//
// The ladder is not invented. The palette that ships is already a good theme,
// so the spacing between its surfaces and its text steps is *measured* from the
// stylesheet and reproduced — what the pickers choose is where the ladder sits
// and what colour it is, never how far apart its rungs are.

// ────────────────────────────────────────────────────────────── theme studio ──
//
// Ported from Emovis' `lib/theme-studio`, which was written to be lifted: it
// depends on React and nothing else there, and on nothing at all here. The
// derivation engine came across long ago as `theme-derive.js`; this is the
// editor that was supposed to come with it.
//
// A palette is a name and a handful of brand colours. The engine turns those
// into sixty-odd tokens, and the preview is painted entirely from them — which
// is what makes this an editor rather than a form. See `docs/THEME-EDITOR.md`.

/// `#abc` → `#aabbcc`; anything unparseable → null.
function tsNormalizeHex(input) {
  const v = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) {
    return `#${v.split('').map((c) => c + c).join('')}`.toLowerCase();
  }
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
}

function tsPaletteId(name, taken = []) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 48) || 'palette';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const TS_NEW_COLORS = ['#2e5496', '#7fa1d6', '#e8e4dc', '#3a3a3c'];

const tsPalette = () => allPalettes().find((p) => p.id === tsSelected) || null;

/// The tokens for a palette, and which way round it came out.
function tsDerive(p) {
  if (!p) return null;
  try {
    if (p.direct) return { tokens: p.tokens || {}, mode: p.dark ? 'dark' : 'light' };
    if (!p.colors?.length) return null;
    return Theme.appTokens(p.colors, { plain: themeState.plain });
  } catch { return null; }
}

function tsError(message) {
  const el = $('tsError');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

/// Replace the edited palette in the user's own list.
function tsUpdate(next) {
  const i = themeState.mine.findIndex((p) => p.id === next.id);
  if (i < 0) return;
  themeState.mine[i] = next;
  saveTheme();
  tsError(null);
  tsRender();
  renderThemeList();
  // If the application is wearing the palette being edited, it follows along.
  if (themeState.chosen === next.id) applyChosenTheme();
}

function tsSetColor(index, raw) {
  const p = tsPalette();
  if (!p || p.readOnly) return;
  const hex = tsNormalizeHex(raw);
  // A half-typed "#2e5" must not wipe the colour — the field keeps what was
  // typed and the palette keeps its last readable value.
  if (!hex) return;
  const colors = [...p.colors];
  colors[index] = hex;
  tsUpdate({ ...p, colors });
}

/// The swatch row: a colour well and its hex, per colour.
///
/// Both, deliberately. The well is how a colour is *chosen* and the hex is how
/// one is *carried* — brand colours arrive as codes, from a style guide or a
/// designer, and a picker with no way to paste one is a toy.
function tsRenderSwatches(p) {
  const box = $('tsSwatches');
  if (!box) return;
  const label = $('tsColoursLabel');
  if (label) label.textContent = `Colours · ${p.colors.length}`;

  // ── in place, when the shape has not changed ──
  //
  // **A colour well cannot be rebuilt while it is being used.** Moving one
  // fires `input` for every step of the drag, each of which came back through
  // here and did `innerHTML = ''` — so the very `<input type="color">` the
  // system's colour panel was attached to was destroyed under it, over and
  // over. The panel stays open, pointing at an element no longer in the
  // document, and nothing you do in it reaches the palette. The hex field lost
  // its caret to the same thing on every keystroke.
  //
  // `tsRender` already knows this about the name field, which it will not write
  // into while it has focus. The swatches never learned it.
  //
  // So: rebuild only when the number of colours changes, and never write into
  // an element somebody is using.
  const shape = `${p.colors.length}|${!!p.readOnly}`;
  const cells = [...box.querySelectorAll('.ts-swatch')];
  if (box.dataset.shape === shape && cells.length === p.colors.length) {
    p.colors.forEach((colour, index) => {
      const [well, hex] = cells[index].querySelectorAll('input');
      if (well && document.activeElement !== well) well.value = colour;
      if (hex && document.activeElement !== hex) hex.value = colour;
    });
    return;
  }
  box.dataset.shape = shape;
  box.innerHTML = '';

  p.colors.forEach((colour, index) => {
    const cell = document.createElement('div');
    cell.className = 'ts-swatch';

    const well = document.createElement('input');
    well.type = 'color';
    well.value = colour;
    well.disabled = !!p.readOnly;
    well.setAttribute('aria-label', `Colour ${index + 1}`);
    well.oninput = () => tsSetColor(index, well.value);

    const hex = document.createElement('input');
    hex.type = 'text';
    hex.value = colour;
    hex.spellcheck = false;
    hex.disabled = !!p.readOnly;
    hex.setAttribute('aria-label', `Colour ${index + 1} hex`);
    hex.oninput = () => tsSetColor(index, hex.value);
    hex.onblur = () => { hex.value = (tsPalette()?.colors || [])[index] || colour; };

    cell.append(well, hex);
    if (!p.readOnly && p.colors.length > 2) {
      const x = document.createElement('button');
      x.className = 'ts-x';
      x.textContent = '×';
      x.title = 'Remove this colour';
      x.onclick = () => tsUpdate({ ...p, colors: p.colors.filter((_, i) => i !== index) });
      cell.appendChild(x);
    }
    box.appendChild(cell);
  });

  if (!p.readOnly) {
    const add = document.createElement('button');
    add.className = 'ghost ts-add';
    add.textContent = '+ Colour';
    add.onclick = () => tsUpdate({ ...p, colors: [...p.colors, '#888888'] });
    box.appendChild(add);
  }
}

/// Every derived token, with a chip. Shown on request because sixty rows is a
/// reference, not a control — but when a theme looks wrong this is where the
/// reason is.
function tsRenderTokens(derived) {
  const box = $('tsTokens');
  if (!box) return;
  box.classList.toggle('hidden', !tsShowTokens);
  const btn = $('tsTokensBtn');
  const entries = Object.entries(derived?.tokens || {});
  if (btn) btn.textContent = tsShowTokens ? 'Hide tokens' : `Show ${entries.length} tokens`;
  if (!tsShowTokens) return;
  box.innerHTML = '';
  for (const [k, v] of entries) {
    const row = document.createElement('div');
    const chip = document.createElement('i');
    // Some tokens are "R G B" triplets, because that side interpolated them
    // into `rgb()` with an alpha.
    chip.style.background = /^\d/.test(v) ? `rgb(${v})` : v;
    const name = document.createElement('b');
    name.textContent = k;
    const val = document.createElement('span');
    val.textContent = v;
    row.append(chip, name, val);
    box.appendChild(row);
  }
}

function tsRender() {
  const p = tsPalette();
  const editor = $('tsEditor');
  const title = $('tsEditing');
  const mode = $('tsMode');
  if (!editor) return;

  editor.classList.toggle('hidden', !p);
  if (!p) {
    if (title) title.textContent = 'Select a palette, or make one';
    mode?.classList.add('hidden');
    return;
  }

  const derived = tsDerive(p);
  if (title) {
    title.textContent = `${p.readOnly ? 'Viewing' : 'Editing'} · ${p.name}`;
  }
  if (mode) {
    mode.textContent = derived?.mode || '';
    mode.classList.toggle('hidden', !derived?.mode);
  }
  const nameField = $('tsName');
  if (nameField && document.activeElement !== nameField) {
    nameField.value = p.name;
    nameField.disabled = !!p.readOnly;
  }
  $('tsDelete')?.classList.toggle('hidden', !!p.readOnly);

  tsRenderSwatches(p);
  renderWaveColours();
  // The preview is this application's own chrome. Emovis previewed a board of
  // lanes and status pills; the parts that show whether a theme works are
  // whatever the host is actually made of.
  // The miniature wears the palette's own waveform colour, so what the sound
  // looks like against those surfaces is visible before applying anything.
  const mini = $('themeMini');
  Theme.applyTo(mini, derived?.tokens || null);
  const wave = waveColourValue(waveShown());
  if (mini) {
    if (wave) mini.style.setProperty('--wave', wave);
    else mini.style.removeProperty('--wave');
  }
  tsRenderTokens(derived);
}

function tsImportJson(text) {
  try {
    const doc = JSON.parse(text);
    const list = Array.isArray(doc) ? doc : [doc];
    const taken = allPalettes().map((p) => p.id);
    const clean = list
      .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.colors))
      .map((p) => ({
        id: tsPaletteId(p.id || p.name, taken),
        name: p.name,
        colors: p.colors.map((c) => tsNormalizeHex(c)).filter(Boolean),
        note: p.note || 'Imported',
      }))
      .filter((p) => p.colors.length >= 2);
    if (!clean.length) throw new Error('No palettes with at least two readable hex values.');
    themeState.mine.push(...clean);
    tsSelected = clean[0].id;
    saveTheme();
    renderThemeList();
    tsRender();
    tsError(null);
  } catch (e) {
    tsError(e instanceof Error ? e.message : String(e));
  }
}

function tsWire() {
  if (!$('tsEditor')) return;

  // Open on something.
  //
  // The original selects the first palette on mount; that line did not come
  // across, so the editor sat hidden behind "select a palette, or make one" and
  // read as missing. Preferring the palette being worn is the better default
  // still — you almost always want to look at the one you are wearing.
  if (!tsSelected) {
    tsSelected = themeState.chosen || allPalettes()[0]?.id || null;
  }

  $('tsFilter')?.addEventListener('input', (e) => {
    tsFilterText = e.target.value;
    renderThemeList();
  });

  $('tsNew')?.addEventListener('click', () => {
    const palette = {
      id: tsPaletteId('new palette', allPalettes().map((p) => p.id)),
      name: 'New palette',
      colors: [...TS_NEW_COLORS],
      note: 'Made here',
    };
    themeState.mine.push(palette);
    tsSelected = palette.id;
    saveTheme();
    renderThemeList();
    tsRender();
  });

  $('tsName')?.addEventListener('input', (e) => {
    const p = tsPalette();
    if (p && !p.readOnly) tsUpdate({ ...p, name: e.target.value });
  });

  $('tsDuplicate')?.addEventListener('click', () => {
    const p = tsPalette();
    if (!p) return;
    const copy = {
      id: tsPaletteId(`${p.name} copy`, allPalettes().map((x) => x.id)),
      name: `${p.name} copy`,
      // A built-in states its tokens outright; a copy of one has to carry them,
      // because there are no five colours behind it to derive them from again.
      ...(p.direct ? { direct: true, tokens: { ...p.tokens }, dark: p.dark } : {}),
      colors: [...(p.colors || [])],
      note: `Duplicated from ${p.name}`,
    };
    themeState.mine.push(copy);
    tsSelected = copy.id;
    saveTheme();
    renderThemeList();
    tsRender();
  });

  $('tsDelete')?.addEventListener('click', () => {
    const p = tsPalette();
    if (!p || p.readOnly) return;
    themeState.mine = themeState.mine.filter((x) => x.id !== p.id);
    if (themeState.chosen === p.id) { themeState.chosen = null; applyChosenTheme(); }
    tsSelected = themeState.mine[0]?.id || null;
    saveTheme();
    renderThemeList();
    tsRender();
  });

  $('tsApply')?.addEventListener('click', () => {
    const p = tsPalette();
    if (!p) return;
    themeState.chosen = p.id;
    saveTheme();
    applyChosenTheme();
    renderThemeList();
  });

  $('tsTokensBtn')?.addEventListener('click', () => {
    tsShowTokens = !tsShowTokens;
    tsRenderTokens(tsDerive(tsPalette()));
  });

  $('tsCopy')?.addEventListener('click', () => {
    const mine = themeState.mine.map(({ id, name, colors, note }) => ({ id, name, colors, note }));
    navigator.clipboard?.writeText(JSON.stringify(mine, null, 2))
      .then(() => toast(`${mine.length} palette${mine.length === 1 ? '' : 's'} copied`))
      .catch(() => tsError('The clipboard refused. Copy from the tokens list instead.'));
  });

  $('tsImport')?.addEventListener('click', () => {
    const text = prompt('Paste palette JSON — one object or an array of { name, colors }');
    if (text) tsImportJson(text);
  });

  tsRender();
}
tsWire();
