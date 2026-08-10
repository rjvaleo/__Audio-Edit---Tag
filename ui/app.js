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
const TAB_FIELDS = ['edit', 'rack', 'annotations', 'view', 'sel', 'peaks', 'spec', 'stats'];

function blankTab(file) {
  return {
    file,
    edit: null,
    rack: null,
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
    ? { browse: 'paneBrowse', search: 'paneSearch', scan: 'paneScan', import: 'paneImport' }
    : { inspect: 'paneInspect' };
  for (const [key, id] of Object.entries(panes)) $(id).classList.toggle('hidden', key !== name);
  const titles = { browse: 'Browse', search: 'Search', scan: 'Scan', import: 'Library', inspect: 'Tags' };
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
function openDrawer() {
  state.drawerOpen = true;
  $('leftPanel').classList.remove('collapsed', 'drawer-closed');
  $('scrim').classList.toggle('hidden', state.mode !== 'edit');
}

function closeDrawer() {
  state.drawerOpen = false;
  $('scrim').classList.add('hidden');
  if (state.mode === 'edit') $('leftPanel').classList.add('drawer-closed');
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
      <span class="count">${f.audioFiles}</span>`;
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

function drawThumb(canvas, b64, selected) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!b64) return;

  const bin = atob(b64);
  const n = bin.length;
  const mid = canvas.height / 2;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
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
  playing: false,
  /// Engine output frames, at the device's rate. Authoritative.
  position: 0,
  deviceRate: 48000,
  /// performance.now() when `position` was last heard from.
  heard: 0,
  spectrum: null,
  gain: 0.85,
};

$('volume').oninput = (e) => {
  engine.gain = +e.target.value;
  enginePost({ gain: engine.gain });
};

async function enginePost(body) {
  try {
    return await postJSON('/api/engine/transport', body);
  } catch (e) {
    toast(e.message);
    return null;
  }
}

/// Load a file into the engine. Expensive — once per file, never per control.
async function engineLoad(file) {
  try {
    const r = await api(`/api/engine/load?p=${encodeURIComponent(file.path)}`, { method: 'POST', body: '{}' });
    engine.path = file.path;
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
function enginePosition() {
  if (!engine.playing || !engine.heard) return engine.position;
  const dt = (performance.now() - engine.heard) / 1000;
  return engine.position + dt * engine.deviceRate;
}

function playbackTime() {
  return enginePosition() / (engine.deviceRate || 48000);
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

async function playFile(file) {
  if (engine.path === file.path) {
    engine.playing ? pausePlayback() : startPlayback();
    return;
  }
  if (state.selectedFile?.path !== file.path) selectFile(file);
  if (!(await engineLoad(file))) return;
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
    if (!engine.playing) { stopPolling(); return; }
    try {
      const r = await api('/api/engine/grains');
      engine.position = r.position;
      engine.heard = performance.now();
      engine.deviceRate = r.sampleRate || engine.deviceRate;
      engine.spectrum = r.spectrum && r.spectrum.length ? r.spectrum : engine.spectrum;
      if (!r.playing && engine.playing) {
        // The engine stopped itself at the end of the document. Drop back to
        // the cue so pressing play again auditions the same moment.
        engine.playing = false;
        captureFollow(false);
        reflectTransport();
        stopSwarm();
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

$('playBtn').onclick = async () => {
  if (!engine.path) {
    if (state.selectedFile) await playFile(state.selectedFile);
    return;
  }
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

function updatePlayhead() {
  const ph = $('playhead');
  const { from, to, sampleRate } = state.view;
  if (!state.peaks || !sampleRate || to <= from) { ph.style.display = 'none'; return; }
  // The overview is the source, so the playhead has to be mapped back through
  // the stretch rather than plotted straight from the clock.
  const frame = sourceFrameNow();
  if (frame < from || frame > to) { ph.style.display = 'none'; return; }
  ph.style.display = 'block';
  // A transform rather than `left`: moving it every frame via a layout property
  // forces a reflow of the whole lane sixty times a second.
  const lane = $('lane');
  const x = ((frame - from) / (to - from)) * (lane.clientWidth || 0);
  ph.style.transform = `translateX(${x.toFixed(2)}px)`;
}

// ============================================================ centre column

function setMode(mode) {
  state.mode = mode;
  const editing = mode === 'edit';

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
  // transport, and the user asked for it gone there.
  $('transportBar').classList.toggle('hidden', !editing);
  $('ruler').classList.toggle('hidden', !editing);
  $('regions').classList.toggle('hidden', !editing);
  $('dock').classList.toggle('hidden', !editing);
  $('statsView').classList.toggle('hidden', editing);
  $('tabBar').classList.toggle('hidden', !editing);
  document.querySelectorAll('#leftRail .mode-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  $('modeLabel').textContent = editing ? 'Edit' : 'Browse';
  document.body.classList.toggle('editing', editing);

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
  if (editing) {
    // Docked column becomes an overlay drawer, shut by default: the editor
    // gets the whole width until you go looking for something.
    panel.classList.remove('collapsed');
    panel.classList.add('drawer-closed');
    state.drawerOpen = false;
    $('scrim').classList.add('hidden');
    // Entering edit mode with a file previewed makes it the first document.
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
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

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
}
$('zoomIn').onclick = () => zoom(2);
$('zoomOut').onclick = () => zoom(0.5);
$('zoomFit').onclick = () => {
  state.view.from = 0; state.view.to = 0;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
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

  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim();
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
const STRUCTURAL = ['cut', 'reverse', 'silence', 'fadeIn', 'fadeOut', 'gain',
                    'normalize', 'split', 'undo', 'redo', 'revert'];

async function editOp(body, { live = false } = {}) {
  if (!state.selectedFile) return;
  try { state.edit = await postJSON('/api/edit', { p: state.selectedFile.path, ...body }); }
  catch (e) { toast(e.message); return; }

  reflectEditState();
  renderStretch();
  renderGrainParams();
  loadGrains();
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

const NEEDS_SELECTION = ['cut', 'silence', 'fadeIn', 'fadeOut', 'reverse', 'region'];

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
    editOp(body);
  };
});

$('fadeShape').onchange = (e) => { state.fadeShape = e.target.value; };
$('exportBits').onchange = (e) => { state.exportBits = +e.target.value; };

$('undoBtn').onclick = async () => { await editOp({ op: 'undo' }); syncStretchSliders(); };
$('redoBtn').onclick = async () => { await editOp({ op: 'redo' }); syncStretchSliders(); };
$('revertBtn').onclick = async () => { await editOp({ op: 'revert' }); syncStretchSliders(); };

$('exportBtn').onclick = async () => {
  if (!state.selectedFile) return;
  try {
    const r = await postJSON('/api/export', { p: state.selectedFile.path, bits: state.exportBits });
    toast(`Exported ${state.exportBits}-bit to ${r.path}`);
  } catch (e) { toast('Export failed: ' + e.message); }
};

// -------------------------------------------------------------- effects dock

document.querySelectorAll('.dock-tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.dock-tab').forEach((x) => x.classList.toggle('active', x === t));
    const panes = { effects: 'dockEffects', stretch: 'dockStretch',
                    visuals: 'dockVisuals', regions: 'dockRegions' };
    for (const [k, id] of Object.entries(panes)) $(id).classList.toggle('hidden', k !== t.dataset.dock);
  };
});

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

async function loadRack() {
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
function pushRack({ immediate = false } = {}) {
  clearTimeout(rackTimer);
  const send = async () => {
    const f = state.selectedFile;
    if (!f || !state.rack) return;
    try {
      state.rack = await postJSON('/api/rack', {
        p: f.path,
        sr: state.view.sampleRate || 48000,
        slots: state.rack.slots,
      });
    } catch (e) { toast(e.message); return; }
    renderRack();
    renderTabs();
    // The waveform must show what will be heard, so it is re-fetched too.
    await loadPeaks();
    if (state.showSpec) loadSpectrogram();
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
  return `${slot.ratio.toFixed(1)}:1 · ${slot.thresholdDb.toFixed(0)} dB`;
}

function renderRack() {
  const list = $('rackList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.rack) return;

  state.rack.slots.forEach((slot, i) => {
    const meta = SLOT_META[slot.kind] || { icon: '?', name: slot.kind };
    const el = document.createElement('div');
    el.className = 'rack-slot' + (i === state.rackSelected ? ' selected' : '') +
      (slot.bypassed ? ' off' : '');
    el.innerHTML = `<div class="icon">${meta.icon}</div>
      <div class="meta"><div class="nm"></div><div class="sm"></div></div>
      <button class="power${slot.bypassed ? '' : ' on'}" title="Switch in or out"></button>`;
    el.querySelector('.nm').textContent = meta.name;
    el.querySelector('.sm').textContent = slotSummary(slot);
    el.onclick = () => { state.rackSelected = i; renderRack(); };
    el.querySelector('.power').onclick = (e) => {
      e.stopPropagation();
      slot.bypassed = !slot.bypassed;
      pushRack({ immediate: true });
    };
    list.appendChild(el);
  });

  renderRackParams();
}

/// One labelled slider bound to a field on the selected slot.
/// A labelled slider.
///
/// `log` puts the control on a logarithmic curve. That is not decoration: the
/// stretch runs from a hundredth to a hundred times, and on a linear slider 1×
/// would sit at one percent of the travel, with everything musically useful
/// crushed against the left stop. On a log curve 1× sits in the middle and each
/// doubling takes the same distance.
function param(label, value, min, max, step, format, onChange, onCommit, log) {
  const el = document.createElement('div');
  el.className = 'param';
  el.innerHTML = `<div class="row"><span class="k"></span><span class="v"></span></div>
    <input type="range">`;
  el.querySelector('.k').textContent = label;
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
  el.sync = (v) => { input.value = toPos(v); out.textContent = format(v); };

  input.oninput = () => {
    const v = toVal(+input.value);
    out.textContent = format(v);
    onChange(v);
  };
  // Fires on pointer release, which is when the change is worth committing
  // properly rather than previewing.
  if (onCommit) input.onchange = () => onCommit(toVal(+input.value));
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
      algorithm: d.algorithm, vocoder: d.vocoder, wsola: d.wsola },
    { live },
  );
}

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
    vocoder: { ...(st.vocoder || { windowMs: 46, overlap: 4, phaseLock: true }) },
    wsola: { ...(st.wsola || { preserveTransients: false, sensitivity: 0.5 }) },
  };

  // Which engine does the stretching. Not a quality ladder — the two fail in
  // opposite directions, so this is a choice about the material rather than
  // about how hard to work.
  const eng = document.createElement('div');
  eng.className = 'engine-pick';
  eng.innerHTML = `
    <div class="seg" id="stretchEngine">
      <button class="seg-btn" data-alg="wsola" title="Time domain. Keeps transients intact - drums, percussion, one-shots.">WSOLA</button>
      <button class="seg-btn" data-alg="vocoder" title="Frequency domain. Holds chords and sustained tone together - pads, strings.">Vocoder</button>
      <button class="seg-btn" data-alg="granular" title="A cloud of grains. Not trying to be transparent - this is the one you hear.">Granular</button>
    </div>`;
  box.appendChild(eng);

  // Each engine gets its own controls. They mean different things by a
  // "window" — a splice for WSOLA, an analysis frame for the vocoder, a grain
  // for the cloud — so one shared slider was three half-explained ones.
  const own = document.createElement('div');
  own.className = 'engine-params';
  eng.after ? eng.after(own) : box.appendChild(own);

  const reflectEngine = () => {
    const alg = state.stretchDraft.algorithm;
    for (const b of eng.querySelectorAll('.seg-btn')) {
      b.classList.toggle('active', b.dataset.alg === alg);
    }
    own.innerHTML = '';
    if (alg === 'vocoder') {
      const v = state.stretchDraft.vocoder;
      own.appendChild(param('Analysis window', v.windowMs, 5, 500, 1,
        (x) => `${Math.round(x)} ms`,
        (x) => { v.windowMs = x; previewStretch(); }, () => commitStretch(), true));
      own.appendChild(param('Overlap', v.overlap, 2, 8, 1,
        (x) => `${Math.round(x)}×`,
        (x) => { v.overlap = Math.round(x); previewStretch(); }, () => commitStretch()));
      const lock = document.createElement('label');
      lock.className = 'check';
      lock.title = 'Holds each partial together instead of letting it dissolve into neighbouring bins';
      lock.innerHTML = `<input type="checkbox"${v.phaseLock ? ' checked' : ''}> phase lock`;
      lock.querySelector('input').onchange = (e) => {
        v.phaseLock = e.target.checked;
        commitStretch();
      };
      own.appendChild(lock);
    }
    if (alg === 'wsola') {
      const w = state.stretchDraft.wsola;
      const keep = document.createElement('label');
      keep.className = 'check';
      keep.title = 'Hold drum hits at their original rate so they are not laid down twice';
      keep.innerHTML = `<input type="checkbox"${w.preserveTransients ? ' checked' : ''}> preserve transients`;
      keep.querySelector('input').onchange = (e) => {
        w.preserveTransients = e.target.checked;
        reflectEngine();
        commitStretch();
      };
      own.appendChild(keep);
      if (w.preserveTransients) {
        own.appendChild(param('Detector', w.sensitivity, 0, 1, 0.01,
          (x) => `${Math.round(x * 100)}%`,
          (x) => { w.sensitivity = x; previewStretch(); }, () => commitStretch()));
      }
    }
    // Granular's controls are the Grain shape panel, so it needs nothing here.
    const grainOn = alg === 'granular';
    for (const id of ['grainShape', 'grainPitch']) {
      const panel = $(id)?.closest('.cpanel');
      if (panel) {
        panel.style.opacity = grainOn ? 1 : 0.4;
        panel.title = grainOn ? '' : 'Select the Granular engine to use these';
      }
    }
  };
  for (const b of eng.querySelectorAll('.seg-btn')) {
    b.onclick = () => {
      state.stretchDraft.algorithm = b.dataset.alg;
      reflectEngine();
      commitStretch();
    };
  }
  reflectEngine();


  const rows = {};
  rows.ratio = param('Stretch', st.ratio, 0.01, 100, 0.01,
    (v) => (v >= 10 ? `${v.toFixed(0)}×` : v >= 1 ? `${v.toFixed(2)}×` : `${v.toFixed(3)}×`),
    (v) => { state.stretchDraft.ratio = v; showStretchOut(); previewStretch(); },
    () => commitStretch(), true);
  rows.semitones = param('Pitch', st.semitones, -48, 48, 0.5,
    (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} st`,
    (v) => { state.stretchDraft.semitones = v; previewStretch(); },
    () => commitStretch());
  // Log too: 40 ms is the everyday setting and second-long grains are the
  // extreme, so a linear control would bunch the useful range at one end.
  rows.windowMs = param('Window', st.windowMs, 5, 2000, 1, (v) => `${Math.round(v)} ms`,
    (v) => { state.stretchDraft.windowMs = v; previewStretch(); },
    () => commitStretch(), true);

  for (const el of Object.values(rows)) box.appendChild(el);
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
  if (grainBuiltFor === path) return;

  grainBuiltFor = path;
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
             grain: state.grainDraft },
           { live });
  };
  const preview = throttled(() => send({ live: true }), 90);
  const commit = () => send({ live: false });

  // Grouped by what they do, so each panel stays short enough to read at once.
  const groups = [
    [shape, [
      ['Density', 'densityHz', 0, 500, 1, (v) => (v <= 0 ? 'from overlap' : `${Math.round(v)}/s`)],
      ['Layers', 'layers', 1, 16, 1, (v) => `${Math.round(v)}×`],
      ['Overlap', 'overlap', 1, 8, 0.1, (v) => `${v.toFixed(1)}×`],
      ['Size jitter', 'sizeJitter', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
      ['Position jitter', 'positionJitterMs', 0, 500, 1, (v) => `${Math.round(v)} ms`],
    ]],
    [pitchBox, [
      ['Pitch jitter', 'pitchJitterSemis', 0, 24, 0.1, (v) => `±${v.toFixed(1)} st`],
      ['Pitch drift', 'pitchDriftSemis', 0, 24, 0.1, (v) => `±${v.toFixed(1)} st`],
      ['Drift rate', 'driftRateHz', 0.01, 10, 0.01, (v) => `${v.toFixed(2)} Hz`],
    ]],
  ];

  state.grainRows = {};
  for (const [target, rows] of groups) {
    for (const [label, key, min, max, step, fmt] of rows) {
      const el = param(label, g[key], min, max, step, fmt,
        (v) => { state.grainDraft[key] = v; preview(); },
        () => commit());
      state.grainRows[key] = el;
      target.appendChild(el);
    }
  }
}

let grainBuiltFor = null;

function syncGrainSliders() {
  const g = state.edit?.stretch?.grain;
  if (!g || !state.grainRows) return;
  state.grainDraft = { ...g };
  for (const [k, el] of Object.entries(state.grainRows)) el.sync(g[k]);
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
}

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
  try {
    state.edit = await postJSON('/api/presets/apply', { name, p: state.selectedFile.path });
  } catch (err) { toast(err.message); return; }

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
  toast(`Applied “${name}”${note ? ' — ' + note : ''}`);
};

$('presetSave').onclick = async () => {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const suggested = $('presetPick').value || `Preset ${state.presets.length + 1}`;
  const name = prompt('Save these settings as:', suggested);
  if (name === null || !name.trim()) return;
  const note = prompt('A note about it (optional):', '') || '';
  try {
    const r = await postJSON('/api/presets', { name: name.trim(), note, p: state.selectedFile.path });
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

/// One reset for all three panels.
///
/// Time, grain shape and pitch movement are three faces of one setting — they
/// are a single `stretch` operation on the document — so resetting one and
/// leaving the others is a state the engine cannot really be in. These are the
/// engine's own defaults, from `Grain::default`; the seed is deliberately not
/// among them, because it names a cloud rather than shaping one and throwing it
/// away would lose the sound you were working on.
$('stretchReset').onclick = async () => {
  state.stretchDraft = { ratio: 1, semitones: 0, windowMs: 40, quality: 'standard',
                         algorithm: 'wsola',
                         vocoder: { windowMs: 46, overlap: 4, phaseLock: true },
                         wsola: { preserveTransients: false, sensitivity: 0.5 } };
  const grain = {
    densityHz: 0, overlap: 2, sizeJitter: 0, positionJitterMs: 0,
    pitchJitterSemis: 0, pitchDriftSemis: 0, driftRateHz: 0.5,
    seed: state.grainDraft?.seed ?? state.edit?.stretch?.grain?.seed ?? 1,
  };
  state.grainDraft = { ...grain };
  await editOp({ op: 'stretch', ...state.stretchDraft, grain });
  syncStretchSliders();
  syncGrainSliders();
};

function renderRackParams() {
  const box = $('rackParams');
  box.innerHTML = '';
  const slot = state.rack?.slots[state.rackSelected];
  if (!slot) return;

  const meta = SLOT_META[slot.kind];
  const head = document.createElement('div');
  head.className = 'param-head';
  head.innerHTML = `<span class="t"></span>
    <button class="ghost">${slot.bypassed ? 'Switch in' : 'Switch out'}</button>`;
  head.querySelector('.t').textContent = meta.name;
  head.querySelector('button').onclick = () => {
    slot.bypassed = !slot.bypassed;
    pushRack({ immediate: true });
  };
  box.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'param-grid';
  const db1 = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
  const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`);

  if (slot.kind === 'gain') {
    grid.appendChild(param('Level', slot.db, -24, 24, 0.1, db1, (v) => { slot.db = v; pushRack(); }));
  }

  if (slot.kind === 'eq') {
    const curve = document.createElement('canvas');
    curve.className = 'eqcurve';
    box.appendChild(curve);
    requestAnimationFrame(() => drawEqCurve(curve));

    for (const [key, label] of [['low', 'Low shelf'], ['mid', 'Mid peak'], ['high', 'High shelf']]) {
      const h = document.createElement('div');
      h.className = 'band-head';
      h.textContent = label;
      grid.appendChild(h);
      const b = slot[key];
      grid.appendChild(param('Gain', b.gainDb, -18, 18, 0.1, db1, (v) => { b.gainDb = v; pushRack(); }));
      grid.appendChild(param('Freq', b.freq, 20, 18000, 1, hz, (v) => { b.freq = v; pushRack(); }));
      grid.appendChild(param('Q', b.q, 0.2, 8, 0.05, (v) => v.toFixed(2), (v) => { b.q = v; pushRack(); }));
    }
    const h = document.createElement('div');
    h.className = 'band-head';
    h.textContent = 'High-pass';
    grid.appendChild(h);
    grid.appendChild(param('Cutoff', slot.highPassHz, 0, 400, 1,
      (v) => (v <= 20 ? 'off' : hz(v)), (v) => { slot.highPassHz = v; pushRack(); }));
  }

  if (slot.kind === 'comp') {
    grid.appendChild(param('Threshold', slot.thresholdDb, -60, 0, 0.5,
      (v) => `${v.toFixed(1)} dB`, (v) => { slot.thresholdDb = v; pushRack(); }));
    grid.appendChild(param('Ratio', slot.ratio, 1, 20, 0.1,
      (v) => `${v.toFixed(1)}:1`, (v) => { slot.ratio = v; pushRack(); }));
    grid.appendChild(param('Attack', slot.attackMs, 0.1, 200, 0.1,
      (v) => `${v.toFixed(1)} ms`, (v) => { slot.attackMs = v; pushRack(); }));
    grid.appendChild(param('Release', slot.releaseMs, 5, 1000, 1,
      (v) => `${Math.round(v)} ms`, (v) => { slot.releaseMs = v; pushRack(); }));
    grid.appendChild(param('Knee', slot.kneeDb, 0, 24, 0.5,
      (v) => `${v.toFixed(1)} dB`, (v) => { slot.kneeDb = v; pushRack(); }));
    grid.appendChild(param('Makeup', slot.makeupDb, -12, 24, 0.1, db1,
      (v) => { slot.makeupDb = v; pushRack(); }));
  }

  box.appendChild(grid);
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

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
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
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
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
      const dx = ((right < 0 ? 0 : lvl[right + b]) - (left < 0 ? 0 : lvl[left + b])) / 255;
      const dy = ((b < bins - 1 ? lvl[here + b + 1] : 0)
                - (b > 0 ? lvl[here + b - 1] : 0)) / 255;
      const shade = 1 + (dx - dy) * 1.15 * SPEC_RELIEF;

      // Low frequencies at the bottom, which means flipping the row order.
      const i = ((bins - 1 - b) * cols + c) * 4;
      const k = lvl[here + b] * 3;
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
    el.innerHTML = `<div class="name"></div><div class="sub">${f.audioFiles} files · ${f.level1} › ${f.level2}</div>`;
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

document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
  else if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); $('undoBtn').click(); }
  else if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); $('redoBtn').click(); }
  else if (e.key === 'm' && state.mode === 'edit') addMarker();
  else if (e.key === 'Escape') {
    state.sel = null; setCue(0); drawSelection(); applyLoop();
  }
  else if (e.key === 'Enter' && state.selectedFile) setMode(state.mode === 'edit' ? 'overview' : 'edit');
});

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

async function loadGrains() {
  const f = state.selectedFile;
  if (!f) { state.grains = null; drawGrains(); return; }
  try {
    state.grains = await api(`/api/grains?p=${encodeURIComponent(f.path)}`);
  } catch { state.grains = null; }
  drawGrains();
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
  if (canvas.width !== Math.round(w * dpr)) {
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

function drawGrains() {
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

  // Levels in the stream are small absolute numbers; normalising against the
  // loudest grain is what makes size vary visibly across the swarm.
  if (g._peak === undefined) {
    g._peak = g.grains.reduce((m, r) => Math.max(m, r[4] || 0), 0) || 1;
  }
  drawGrainSwarm(ctx, w, h, g);
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
  if (state.mode === 'edit' && state.grains) drawGrains();
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

  if (!is3d) return;
  if (!frame.src) {
    frame.src = `/grains3d?embed=1&view=${v - 1}`;
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
  if (!pop.frame.src) pop.frame.src = `/grains3d?embed=1&view=${Math.max(0, grainView - 1)}`;
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pop.el && !pop.el.classList.contains('hidden')) closeVisPop();
});

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
      { label: 'Reset time, pitch and grains', on: editing, run: click('stretchReset') },
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
