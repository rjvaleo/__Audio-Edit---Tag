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
        import: 'paneImport', record: 'paneRecord' }
    : { inspect: 'paneInspect' };
  for (const [key, id] of Object.entries(panes)) $(id).classList.toggle('hidden', key !== name);
  const titles = { browse: 'Browse', search: 'Search', scan: 'Scan',
                   import: 'Library', record: 'Record', inspect: 'Tags' };
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

async function enginePost(body) {
  try {
    return await postJSON('/api/engine/transport', body);
  } catch (e) {
    toast(e.message);
    return null;
  }
}

/// Load a file into the engine. Expensive — once per file, never per control.
async function engineLoad(file, { raw = false } = {}) {
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
    if (!engine.playing) { stopPolling(); return; }
    try {
      const r = await api('/api/engine/grains');
      engine.position = r.position;
      engine.heard = performance.now();
      engine.deviceRate = r.sampleRate || engine.deviceRate;
      engine.loop = r.loop || null;
      engine.latency = r.latency || 0;
      engine.spectrum = r.spectrum && r.spectrum.length ? r.spectrum : engine.spectrum;
      engine.waveform = r.waveform && r.waveform.length ? r.waveform : engine.waveform;
      // The rail's meters and its visual editors are driven from the same poll
      // as the playhead, so everything on screen describes one instant.
      paintRackMeters(r.rackLevels || []);
      repaintVisualEqs();
      repaintVisualCompressors();
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
  updateReadBand();
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
  // Crossing between the library and the editor changes what playback *is* —
  // the sound over there, the document over here — so anything running belongs
  // to the side it was started on. Same rule as choosing a different sound.
  if (engine.playing && engine.raw !== (mode !== 'edit')) pausePlayback();

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
  $('presetBar').classList.toggle('hidden', !editing);
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
$('exportBtn').onclick = async () => {
  if (!state.selectedFile) return;
  try {
    const r = await postJSON('/api/export', { p: state.selectedFile.path, bits: state.exportBits });
    const name = (r.path || '').split('/').pop();
    toast(`Exported ${state.exportBits}-bit AIFF beside the original — ${name}`);
  } catch (e) { toast('Export failed: ' + e.message); }
};

// -------------------------------------------------------------- effects dock

document.querySelectorAll('.dock-tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.dock-tab').forEach((x) => x.classList.toggle('active', x === t));
    const panes = { effects: 'dockEffects', stretch: 'dockStretch',
                    visuals: 'dockVisuals', automation: 'dockAutomation',
                    regions: 'dockRegions' };
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
const pushRackLive = throttled(async () => {
  const f = state.selectedFile;
  if (!f || !state.rack) return;
  try {
    await postJSON('/api/rack', {
      p: f.path,
      sr: state.view.sampleRate || 48000,
      slots: state.rack.slots,
      master: state.rack.master,
    });
  } catch { /* the release commit reports a persistent failure */ }
}, 32);

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
    state.rack = await postJSON('/api/rack', {
      p: f.path,
      sr: state.view.sampleRate || 48000,
      slots: state.rack.slots,
      master: state.rack.master,
      // The engine is already where it needs to be; asking for a rebuild here
      // is what used to cut the reverb tail every time a control was released.
      keepLive: true,
    });
  } catch (e) { toast(e.message); return; }
  renderTabs();
  refreshAutomationTargets();
  await loadPeaks();
  if (state.showSpec) loadSpectrogram();
}

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
        master: state.rack.master,
      });
    } catch (e) { toast(e.message); return; }
    renderRack();
    renderTabs();
    // The waveform must show what will be heard, so it is re-fetched too.
    await loadPeaks();
    await loadAutomationWaveform();
    repaintAutomationLanes();
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

/// Defaults for the channel compressor, mirroring `MasterSettings`. A document
/// saved before it existed opens with the controls where the engine assumes
/// them rather than at undefined.
const MASTER_DEFAULTS = {
  on: false, amount: 0.5, autoLevel: true, autoComp: true, ceilingDb: -0.3,
};

/// Which file the channel strip was built for. Same reason as the stretch
/// panel: rebuilding it under the pointer kills the drag.
let masterBuiltFor = null;

/// The channel's compressor: one knob, and two decisions about what the knob
/// is allowed to work out for itself.
function renderMaster() {
  const box = $('masterStrip');
  if (!box) return;
  const path = state.selectedFile?.path || null;
  if (!state.rack) { box.innerHTML = ''; masterBuiltFor = null; return; }
  state.rack.master = { ...MASTER_DEFAULTS, ...(state.rack.master || {}) };
  if (masterBuiltFor === path) { reflectMaster(); return; }
  masterBuiltFor = path;
  box.innerHTML = '';

  // Read through a getter rather than captured once. `pushRack` replaces
  // `state.rack` wholesale with the server's reply, so a reference taken at
  // build time is orphaned from the first push onward — the control would go
  // on writing to an object nothing else could see, and `reflectMaster` would
  // paint it straight back from the live one. Which is exactly what the
  // maximizer switch was doing: dead from the second render on.
  const m = () => state.rack.master;
  const set = (k, v) => { m()[k] = v; };
  const shown = m();
  const send = throttled(() => pushRack(), 120);
  const commit = () => pushRack({ immediate: true });

  state.masterRows = {};
  const row = (el, key) => { state.masterRows[key] = el; box.appendChild(el); return el; };

  row(check('maximizer', 'Compress and hold the channel under its ceiling', shown.on,
    (on) => { set('on', on); reflectMaster(); commit(); }), 'on');

  row(param('Amount', shown.amount, 0, 1, 0.01,
    (v) => (v <= 0 ? 'none' : v >= 0.999 ? 'maximize' : `${Math.round(v * 100)}%`),
    (v) => { set('amount', v); send();  },
    () => {commit();}), 'amount');

  row(check('auto level',
    'Walk the output up to the ceiling as it plays, rather than leaving the gain where it was',
    shown.autoLevel, (on) => { set('autoLevel', on); commit(); }), 'autoLevel');

  row(check('auto compression',
    'Take the threshold from the material, so the same setting squeezes a quiet file like a loud one',
    shown.autoComp, (on) => { set('autoComp', on); commit(); }), 'autoComp');

  row(param('Ceiling', shown.ceilingDb, -24, 0, 0.1, (v) => `${v.toFixed(1)} dB`,
    (v) => { set('ceilingDb', v); send(); }, () => commit()), 'ceilingDb');

  reflectMaster();
}

/// Everything but the switch is only reachable once it is on.
function reflectMaster() {
  const m = state.rack?.master;
  if (!m || !state.masterRows) return;
  for (const [k, el] of Object.entries(state.masterRows)) {
    el.sync?.(m[k]);
    if (k !== 'on') el.classList.toggle('inactive', !m.on);
  }
}

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
  const add = (label, value, min, max, step, format, set, log = false, key = null) => {
    box.appendChild(param(label, value, min, max, step, format,
      (v) => { set(v); if (key) liveParam(slot.id, key, v); else pushRackLive(); },
      () => { commitRack(); }, log));
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
      });
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
        (v) => fxValueFormat(p, v), (v) => { slot.params[p.key] = v; }, p.log, p.key);
      if (slot.kind === 'utility' && ['grainMs', 'amount', 'floorDb'].includes(p.key)) {
        const row = box.lastElementChild; fitRows.push(row);
        row.classList.toggle('inactive', slot.params.ampFit < .5);
      }
    }
    return;
  }
  if (slot.kind === 'eq') { renderVisualEq(box, slot, slotIndex); return; }
  if (slot.kind === 'gain') {
    add('Level', slot.db, -24, 24, 0.1, (v) => `${v.toFixed(1)} dB`, (v) => { slot.db = v; });
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
  const controls=()=>{tabs.innerHTML='';filters.forEach((f,i)=>{const b=document.createElement('button');b.className='filter-bank-tab'+(i===selected?' selected':'')+(slot.params[f.on]<.5?' off':'');b.style.setProperty('--filter-color',f.color);b.textContent=f.name;b.onclick=()=>{selected=i;controls();};tabs.appendChild(b);});controlsBox.innerHTML='';const f=filters[selected],toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=slot.params[f.on]>=.5?'On':'Off';toggle.onclick=()=>{slot.params[f.on]=slot.params[f.on]>=.5?0:1;controls();pushRack({immediate:true});};controlsBox.appendChild(toggle);const add=(label,key,min,max,unit='',log=false)=>{let last=slot.params[key];controlsBox.appendChild(param(label,slot.params[key],min,max,(max-min)/400,v=>fxValueFormat({unit,min,max},v),v=>{last=v;slot.params[key]=v;draw();read();liveParam(slot.id,key,v);},()=>{commitRack();},log));};add('Frequency',f.hz,20,20000,'Hz',true);add('Q',f.q,.2,18);add('Amplitude',f.amp,0,1);read();draw();function read(){readout.textContent=`${f.name.toUpperCase()} · ${fxValueFormat({unit:'Hz'},slot.params[f.hz])} · Q ${slot.params[f.q].toFixed(2)} · AMP ${Math.round(slot.params[f.amp]*100)}% · ${slot.params[f.on]>=.5?'ON':'OFF'}`;}};
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
  let selectedRows=[];const controls=()=>{stack.innerHTML='';const tabs=document.createElement('div');tabs.className='filter-bank-tabs';for(const [key,label] of [['low','Low pass'],['band','Band pass'],['high','High pass'],['notch','Notch']]){const button=document.createElement('button');button.className='filter-bank-tab'+(key===selected?' selected':'')+(slot.params[key+'On']<.5?' off':'');button.style.setProperty('--filter-color',CHAMBERLIN_COLORS[key]);button.textContent=label;button.onclick=()=>{selected=key;controls();};tabs.appendChild(button);}stack.appendChild(tabs);const toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=slot.params[selected+'On']>=.5?'On':'Off';toggle.onclick=()=>{const key=selected+'On';slot.params[key]=slot.params[key]>=.5?0:1;controls();pushRack({immediate:true});};stack.appendChild(toggle);const add=(label,key,min,max,unit='',log=false)=>{let last=slot.params[key];const row=param(label,slot.params[key],min,max,(max-min)/400,v=>fxValueFormat({unit,min,max},v),v=>{last=v;slot.params[key]=v;redraw();liveParam(slot.id,key,v);},()=>{commitRack();},log);stack.appendChild(row);return row;};selectedRows=[add('Frequency',selected+'Freq',20,18000,'Hz',true),add('Q',selected+'Q',.2,10),add('Amplitude',selected+'Amp',0,1)];add('Drive','drive',.25,8,'x',true);redraw();};
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
    v=>{last=v;set(v);redraw();liveParam(slot.id,key,v);},()=>{commitRack();},log);stack.appendChild(row);return row;};
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
    stack.appendChild(param('Frequency',band.freq,20,20000,1,v=>fxValueFormat({unit:'Hz'},v),v=>{band.freq=v;redraw();liveParam(slot.id,`band.${selected}.freq`,v);},()=>{commitRack();},true));
    if(!['highpass','lowpass'].includes(band.type))stack.appendChild(param('Q',band.q,.05,18,.05,v=>v.toFixed(2),v=>{band.q=v;redraw();liveParam(slot.id,`band.${selected}.q`,v);},()=>{commitRack();}));
    if(!['highpass','lowpass'].includes(band.type))stack.appendChild(param('Gain',band.gainDb,-24,24,.1,v=>`${v.toFixed(1)} dB`,v=>{band.gainDb=v;redraw();liveParam(slot.id,`band.${selected}.gainDb`,v);},()=>{commitRack();}));
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
function param(label, value, min, max, step, format, onChange, onCommit, log) {
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
function knob(label, value, min, max, step, format, onChange, onCommit, log) {
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

  return el;
}

/// A switch: the name in the name column, a rocker in the control column.
///
/// It was a button with its own name written on it, which made it the one
/// control in the panel that did not line up with the others. The name belongs
/// where every other name is; the switch belongs where every other control is.
///
/// A rocker rather than a tick box because a rocker says which way it is set
/// from across the room — one end pressed in, the other proud, and the recess
/// it uncovers lit.
function check(label, title, value, onChange) {
  const el = document.createElement('div');
  el.className = 'param toggle';
  el.innerHTML = `<span class="k"></span>
    <button class="rocker" role="switch"><span class="plate"></span></button>`;
  const name = el.querySelector('.k');
  name.textContent = label;
  name.title = title || label;
  const b = el.querySelector('.rocker');
  b.title = title || label;
  el.title = title || label;

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
  for (const k of el.querySelectorAll('.seg-btn, .rocker')) {
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
  densityHz: 0, overlap: 2, sizeJitter: 0, positionJitterMs: 0,
  pitchJitterSemis: 0, pitchDriftSemis: 0, driftRateHz: 0.5, layers: 1,
  scan: 1, reverse: false, envelope: 0.5, sizeRange: 1, wrap: false,
  layerSpread: 1, linkJitter: false, driftStep: false, panSpread: 0,
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
      <button class="seg-btn" data-alg="wsola" title="Time domain. Keeps transients intact - drums, percussion, one-shots.">WSOLA</button>
      <button class="seg-btn" data-alg="vocoder" title="Frequency domain. Holds chords and sustained tone together - pads, strings.">Vocoder</button>
      <button class="seg-btn" data-alg="pvsola" title="The vocoder, re-anchored to the waveform every few frames. Holds tone together without the phasiness - the one-knob default for pitched material.">PVSOLA</button>
      <button class="seg-btn" data-alg="hybrid" title="Splits the sound into tone, hits and air, and stretches each its own way. The slow one, and the only one that will not repeat noise.">Hybrid</button>
      <button class="seg-btn" data-alg="granular" title="A cloud of grains. Not trying to be transparent - this is the one you hear.">Granular</button>
    </div>`;
  // The panel has no heading any more, so its reset rides on the engine row —
  // the one line that is always there whichever engine is chosen.
  eng.appendChild(resetButton(
    'stretchReset', 'Reset all',
    'Reset every control on both sides, standard and extended',
    resetEverything,
  ));
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
    // One row at the top of the engine's own controls: whatever switches it
    // has on the left, the tuning on the right. Built for every engine, so the
    // scale is in the same place whichever one is picked — pitch applies to
    // all of them, and only WSOLA has a transient switch to sit beside.
    const switches = document.createElement('div');
    switches.className = 'engine-switches';
    // The tuning goes on first and the engine's own switches are prepended in
    // front of it, so it sits at the right-hand end of the row whether or not
    // this engine has anything to put beside it.
    switches.appendChild(scaleButton());
    own.appendChild(switches);

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
      switches.prepend(check('grain cloud',
        'Run the grain cloud over this engine, reading the same source at the same stretch',
        d.cloud,
        (on) => { d.cloud = on; reflectEngine(); commitStretch(); }));
      if (d.cloud) {
        own.appendChild(tip(param('Cloud', d.cloudMix, 0, 1, 0.01,
          (x) => `${Math.round(x * 100)}%`,
          (x) => { d.cloudMix = x; previewStretch(); }, () => commitStretch()),
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
        (x) => { v.windowMs = x; previewStretch(); }, () => commitStretch(), true),
        "The length of one transform, rounded to a power of two. Long resolves partials that sit close together and smears transients; short does the opposite. This is the vocoder's own window and means something different from the one above."));
      own.appendChild(check('phase lock',
        'Holds each partial together instead of letting it dissolve into neighbouring bins',
        v.phaseLock, (on) => { v.phaseLock = on; commitStretch(); }));

      ext.appendChild(wild('Spectrum',
        `The vocoder normally copies magnitudes through untouched and rewrites only phase. These do not.${what}`).add(
        tip(param('Freeze', v.magFreeze, 0, 1, 0.01,
          (x) => (x >= 0.999 ? 'held' : `${Math.round(x * 100)}%`),
          (x) => { v.magFreeze = x; previewStretch(); }, () => commitStretch()),
        'Hold the magnitude spectrum where it is instead of following the source. At 100% the sound stops changing timbre and only its phase keeps moving.'),
        tip(param('Blur', v.magBlur, 0, 1, 0.01, (x) => `${Math.round(x * 100)}%`,
          (x) => { v.magBlur = x; previewStretch(); }, () => commitStretch()),
        "Smear each frame's magnitudes into neighbouring bins. Softens the edges between partials and turns a pitched sound toward noise."),
        tip(param('Gate', v.magGate, 0, 1, 0.01,
          (x) => (x <= 0 ? 'off' : `${Math.round(x * 100)}%`),
          (x) => { v.magGate = x; previewStretch(); }, () => commitStretch()),
        "Drop every bin below this share of the frame's loudest. Thins the sound to its strongest partials, and at high settings leaves a sparse, bell-like residue."),
      ));

      ext.appendChild(wild('Phase',
        `How the frequency estimate is believed and how far a peak imposes its phase on its neighbours.${what}`).add(
        tip(param('Freq trust', v.freqTrust, 0, 4, 0.01,
          (x) => (x <= 0.001 ? 'to bins' : `${x.toFixed(2)}×`),
          (x) => { v.freqTrust = x; previewStretch(); }, () => commitStretch()),
        "How far the frequency measured from the phase difference is believed over the bin's nominal centre. At zero every partial is forced onto its bin, which detunes the sound into a metallic grid."),
        tip(param('Phase spread', v.phaseSpread, 0, 4, 0.01, (x) => `${x.toFixed(2)}×`,
          (x) => { v.phaseSpread = x; previewStretch(); }, () => commitStretch()),
        "How far a peak's phase correction reaches into the bins around it. This is what stops a partial dissolving into its neighbours as the stretch gets long."),
        tip(param('Peak width', v.peakWidth, 1, 16, 1, (x) => `${Math.round(x)} bin`,
          (x) => { v.peakWidth = Math.round(x); previewStretch(); }, () => commitStretch()),
        'How many bins either side of a maximum count as belonging to it. Wider claims more of the spectrum for each peak, which holds thick tone together and blurs closely spaced partials.'),
        tip(param('Lock width', v.lockWidth, 0, 4, 0.01, (x) => `${x.toFixed(2)}×`,
          (x) => { v.lockWidth = x; previewStretch(); }, () => commitStretch()),
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
        engineSwitches().prepend(check('preserve transients',
          'Hold drum hits at their original rate so they are not laid down twice',
          w.preserveTransients,
          (on) => { w.preserveTransients = on; reflectEngine(); commitStretch(); }));
      }
      if (detecting) {
        own.appendChild(tip(param('Detector', w.sensitivity, 0, 1, 0.01,
          (x) => `${Math.round(x * 100)}%`,
          (x) => { w.sensitivity = x; previewStretch(); }, () => commitStretch()),
        'How eager the onset detector is. Higher finds more hits to protect, including ones that are not really hits; lower protects only the clearest attacks.'));
      }

      ext.appendChild(wild('Splice',
        `How far the similarity search looks, what it goes looking for, and what the result is laid down under.${what}`).add(
        tip(param('Search', w.searchMs, 0, 200, 0.5,
          (x) => (x <= 0 ? 'plain OLA' : `${x.toFixed(1)} ms`),
          (x) => { w.searchMs = x; previewStretch(); }, () => commitStretch()),
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
          (x) => { w.stride = Math.round(x); previewStretch(); }, () => commitStretch()),
        'How many frames the similarity search steps by as it looks. Bigger is cheaper and coarser - the join lands near the best place rather than on it.'),
      ));

      // Only reachable once the detector is running, so it appears with it.
      if (detecting) {
        ext.appendChild(wild('Transients',
          'What the detector counts as a hit, and how much either side of one is held at its original rate.').add(
          tip(param('Floor', w.floor, 0, 2, 0.01,
            (x) => (x <= 0 ? 'none' : `${x.toFixed(2)}×`),
            (x) => { w.floor = x; previewStretch(); }, () => commitStretch()),
        'How far above the local average a peak has to rise before it counts as a hit. Low finds hits everywhere, which protects so much of the sound that the stretch stops happening.'),
          tip(param('Guard', w.guardHops, 1, 16, 0.1, (x) => `${x.toFixed(1)} hop`,
            (x) => { w.guardHops = x; previewStretch(); }, () => commitStretch()),
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
        () => commitStretch()),
        'How many analysis frames the vocoder is allowed to run on its own guesses before being spliced back onto the real waveform. Short kills phasiness and costs splices; long is the plain vocoder again.'));

      ext.appendChild(wild('Anchor',
        'How the splice back to the waveform is found and how it is joined. Both off is a hard cut every few frames, which you can hear as a rhythm.').add(
        tip(param('Search', p.searchMs, 0, 200, 0.5,
          (x) => (x <= 0 ? 'no search' : `${x.toFixed(1)} ms`),
          (x) => { p.searchMs = x; previewStretch(); }, () => commitStretch()),
        'How far the anchor search looks for the best place to splice back onto the waveform. At zero it joins wherever it lands, which you hear as a click every few frames.'),
        tip(param('Blend', p.blend, 0, 1, 0.01,
          (x) => (x <= 0 ? 'butt join' : `${Math.round(x * 100)}%`),
          (x) => { p.blend = x; previewStretch(); }, () => commitStretch()),
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
        (x) => { h.harmonicLevel = x; previewStretch(); }, () => commitStretch()),
        "The level of the harmonic part - the ridges that run along time. This is the reason to be in this engine: nothing else here will turn a sound's air down without touching its tone."));
      own.appendChild(tip(param('Hits', h.percussiveLevel, 0, 2, 0.01,
        (x) => (x <= 0 ? 'out' : `${x.toFixed(2)}×`),
        (x) => { h.percussiveLevel = x; previewStretch(); }, () => commitStretch()),
        'The level of the percussive part - the ridges that run across frequency. Attacks, clicks and transients, stretched by WSOLA with preservation held on.'));
      own.appendChild(tip(param('Air', h.residualLevel, 0, 2, 0.01,
        (x) => (x <= 0 ? 'out' : `${x.toFixed(2)}×`),
        (x) => { h.residualLevel = x; previewStretch(); }, () => commitStretch()),
        'The level of the residual - everything that is neither a partial nor a hit. Breath, hiss, room. This is the part Margin decides the existence of.'));
      own.appendChild(check('remake noise',
        'Rebuild the air as fresh noise shaped like the old, instead of stretching it. Off, it repeats at long ratios like every other engine here does',
        h.morphNoise, (on) => { h.morphNoise = on; commitStretch(); }));

      ext.appendChild(wild('Separation',
        'How the sound is cut into three. A partial is a ridge along time and a hit is a ridge across frequency; these decide how long and how broad each has to be to count.').add(
        tip(param('Hold', h.timeSpan, 3, 101, 2, (x) => `${Math.round(x) | 1} fr`,
          (x) => { h.timeSpan = Math.round(x) | 1; previewStretch(); }, () => commitStretch()),
        'How many frames long a ridge has to hold steady before it counts as a partial. Longer is stricter and sends more of the sound to the other two parts.'),
        tip(param('Spread', h.freqSpan, 3, 101, 2, (x) => `${Math.round(x) | 1} bin`,
          (x) => { h.freqSpan = Math.round(x) | 1; previewStretch(); }, () => commitStretch()),
        'How many bins wide a ridge has to be before it counts as a hit. Wider is stricter about what an attack is.'),
        tip(param('Margin', h.margin, 1, 8, 0.05,
          (x) => (x <= 1.001 ? 'no air' : `${x.toFixed(2)}×`),
          (x) => { h.margin = x; previewStretch(); }, () => commitStretch()),
        'How much louder one part has to be than the other before it may claim a bin outright. At 1x nothing is left over and there is no Air at all - which is why the noise remaker then has nothing to work on.'),
        tip(param('Resolution', h.fftSize, 256, 8192, 256, (x) => `${Math.round(x)}`,
          (x) => { h.fftSize = Math.round(x); previewStretch(); }, () => commitStretch(), true),
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
  }
  reflectEngine();


  const rows = {};
  rows.ratio = tip(param('Stretch', st.ratio, 0.01, 100, 0.01,
    (v) => (v >= 10 ? `${v.toFixed(0)}×` : v >= 1 ? `${v.toFixed(2)}×` : `${v.toFixed(3)}×`),
    (v) => { state.stretchDraft.ratio = v; showStretchOut(); previewStretch();  },
    () => {commitStretch();}, true),
        'How much longer the result is than the source. 1x is untouched, 0.5x is half the length, 100x is the point of a granular stretcher. Logarithmic, so the everyday range is not squeezed into the first tenth of the slider.');
  // The step is the finest the *scale* offers, so dragging cannot land
  // between two degrees and then be snapped back on release. With no scale
  // chosen it stays where it has always been: half a semitone.
  rows.semitones = tip(param('Pitch', st.semitones, -48, 48, scaleStep(),
    (v) => scaleLabel(v),
    (v) => { state.stretchDraft.semitones = v; previewStretch();  },
    () => {commitStretch();} ),
        'Shifts the pitch without changing the length. The engine is driven at ratio x pitch and the result read back that much faster, and the two length changes cancel. Twelve semitones is an octave. The tuning it snaps to is chosen on the row above.');
  // Log too: 40 ms is the everyday setting and second-long grains are the
  // extreme, so a linear control would bunch the useful range at one end.
  rows.windowMs = tip(param('Window', st.windowMs, 5, 2000, 1, (v) => `${Math.round(v)} ms`,
    (v) => { state.stretchDraft.windowMs = v; previewStretch();  },
    () => {commitStretch();}, true),
        'The length of one piece the engine works with - a splice for WSOLA, a grain for the cloud. Short follows transients and roughens tone; long holds tone together and smears attacks.');

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
      ['Density', 'densityHz', 0, 500, 1, (v) => (v <= 0 ? 'auto' : `${Math.round(v)}/s`),
       'How often a window is laid down, in windows per second. On “auto” the rate comes from the window length divided by Overlap instead, which is what keeps the sound even as the window changes.'],
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
        () => {commit();}), hint);
      state.grainRows[key] = el;
      group.add(el);
    }
    target.appendChild(group);
  }

  const gp = (label, key, min, max, step, fmt, log) => {
    const el = param(label, state.grainDraft[key], min, max, step, fmt,
      (v) => { state.grainDraft[key] = v; preview(); }, () => commit(), log);
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
      (v) => (Math.abs(v - 0.5) < 0.005 ? 'symmetric' : v < 0.5 ? 'percussive' : 'swelling')),
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

  c.fillStyle = 'rgba(82,168,255,.13)';
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

function scaleButton() {
  const b = document.createElement('button');
  b.className = 'scale-btn' + (currentScale() ? ' on' : '');
  b.textContent = currentScale() || (currentStep() > 0 ? `${currentStep()} st grid` : 'free');
  b.title = 'Snap the pitch shift to a tuning';
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

$('presetManage').onclick = openPresetManager;
$('pmClose').onclick = closePresetManager;
$('presetManager').onclick = (e) => { if (e.target === $('presetManager')) closePresetManager(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('presetManager').classList.contains('hidden')) closePresetManager();
});

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

function renderRackParams() {
  const box = $('rackParams');
  box.innerHTML = '';
  const slot = state.rack?.slots[state.rackSelected];
  if (!slot) return;

  const shaper = state.shapers[slot.kind];
  const meta = SLOT_META[slot.kind] || { name: shaper ? shaper.label : slot.kind };
  const head = document.createElement('div');
  head.className = 'param-head';
  head.innerHTML = `<span class="t"></span>
    <button class="ghost">${slot.bypassed ? 'Switch in' : 'Switch out'}</button>`
    + (shaper ? '<button class="ghost danger" id="rackDrop">Remove</button>' : '');
  head.querySelector('.t').textContent = meta.name;
  head.querySelector('button').onclick = () => {
    slot.bypassed = !slot.bypassed;
    pushRack({ immediate: true });
  };
  box.appendChild(head);
  // Only a shaper can be taken out. The first three are the chain itself —
  // switching one out is what removing it means.
  if (shaper) {
    $('rackDrop').onclick = () => {
      state.rack.slots.splice(state.rackSelected, 1);
      state.rackSelected = Math.max(0, state.rackSelected - 1);
      pushRack({ immediate: true });
      renderRack();
    };
  }

  const grid = document.createElement('div');
  grid.className = 'knob-grid';
  const db1 = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
  const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`);

  // Every shaper, from its own description. Nothing here knows what any of
  // them do — which is the point: the next one added draws itself.
  if (shaper) {
    if (!shaper.params.length) {
      const none = document.createElement('p');
      none.className = 'engine-note';
      none.textContent = 'Nothing to set — switch it in or out.';
      grid.appendChild(none);
    }
    slot.params = slot.params || {};
    for (const p of shaper.params) {
      if (slot.params[p.key] === undefined) slot.params[p.key] = p.default;
      const fmt = (v) => {
        if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`;
        if (p.unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
        if (p.unit === 'dB') return `${v.toFixed(1)} dB`;
        if (p.unit) return `${v.toFixed(2)}${p.unit}`;
        return p.min >= 0 && p.max <= 1.001 ? `${Math.round(v * 100)}%` : v.toFixed(2);
      };
      const step = (p.max - p.min) / 400;
      // The log flag is the ninth argument, after the commit callback these
      // do not need — pushRack already throttles.
      grid.appendChild(knob(p.label, slot.params[p.key], p.min, p.max, step, fmt,
        (v) => { slot.params[p.key] = v; pushRack(); }, undefined, p.log));
    }
  }

  if (slot.kind === 'gain') {
    grid.appendChild(knob('Level', slot.db, -24, 24, 0.1, db1, (v) => { slot.db = v; pushRack(); }));
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
      grid.appendChild(knob('Gain', b.gainDb, -18, 18, 0.1, db1, (v) => { b.gainDb = v; pushRack(); }));
      grid.appendChild(knob('Freq', b.freq, 20, 18000, 1, hz, (v) => { b.freq = v; pushRack(); }));
      grid.appendChild(knob('Q', b.q, 0.2, 8, 0.05, (v) => v.toFixed(2), (v) => { b.q = v; pushRack(); }));
    }
    const h = document.createElement('div');
    h.className = 'band-head';
    h.textContent = 'High-pass';
    grid.appendChild(h);
    grid.appendChild(knob('Cutoff', slot.highPassHz, 0, 400, 1,
      (v) => (v <= 20 ? 'off' : hz(v)), (v) => { slot.highPassHz = v; pushRack(); }));
  }

  if (slot.kind === 'comp') {
    grid.appendChild(knob('Threshold', slot.thresholdDb, -60, 0, 0.5,
      (v) => `${v.toFixed(1)} dB`, (v) => { slot.thresholdDb = v; pushRack(); }));
    grid.appendChild(knob('Ratio', slot.ratio, 1, 20, 0.1,
      (v) => `${v.toFixed(1)}:1`, (v) => { slot.ratio = v; pushRack(); }));
    grid.appendChild(knob('Attack', slot.attackMs, 0.1, 200, 0.1,
      (v) => `${v.toFixed(1)} ms`, (v) => { slot.attackMs = v; pushRack(); }));
    grid.appendChild(knob('Release', slot.releaseMs, 5, 1000, 1,
      (v) => `${Math.round(v)} ms`, (v) => { slot.releaseMs = v; pushRack(); }));
    grid.appendChild(knob('Knee', slot.kneeDb, 0, 24, 0.5,
      (v) => `${v.toFixed(1)} dB`, (v) => { slot.kneeDb = v; pushRack(); }));
    grid.appendChild(knob('Makeup', slot.makeupDb, -12, 24, 0.1, db1,
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
  const ratio = st.ratio || 1;
  // Where the head is at this instant: its home, plus wherever it has been
  // moved to, plus however far the sweep has carried it. The same three terms
  // `event_at` adds up, so the box sits where the grains are coming from.
  const home = scan < 0 ? base : 0;
  const sweep = (sourceFrameNow() / ratio) * scan;
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
  if (canvas.width !== Math.round(w * dpr)) {
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

  // The head and its spread.
  const bx = geo.x(geo.head);
  c.fillStyle = 'rgba(82,168,255,.09)';
  c.fillRect(bx - geo.halfW, h / 2 - geo.halfH, geo.halfW * 2, geo.halfH * 2);
  c.strokeStyle = 'rgba(140,200,255,.7)';
  c.strokeRect(bx - geo.halfW, h / 2 - geo.halfH, geo.halfW * 2, geo.halfH * 2);
  c.strokeStyle = 'rgba(82,168,255,.9)';
  c.beginPath(); c.moveTo(bx, 0); c.lineTo(bx, h); c.stroke();

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
  for (const [outFrame, srcFrame, size, pitch, , bright] of g.grains) {
    const dt = (outFrame - playFrame) / geo.sr;
    // Everything is drawn, but what is sounding now is drawn brightest — the
    // cloud is a shape you are moving through, not only a shape.
    const near = Math.max(0, 1 - Math.abs(dt) / 2.5);
    const alpha = 0.05 + near * near * 0.6;
    const r = 1 + Math.min(4, (size / geo.sr) * 26);
    c.fillStyle = grainColour(pitch - baseSemis, bright, alpha);
    c.beginPath();
    c.arc(geo.x(srcFrame), geo.y(pitch - baseSemis), r, 0, Math.PI * 2);
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
  // The pad is a control as well as a picture, so it is drawn whether or not
  // anything is playing; a control that goes blank when the transport stops is
  // no use.
  drawCloudPad();
  // The cloud draws itself, on its own loop. All this does is hand it the
  // instant — one owner for the data, so there is nothing to synchronise
  // between two animation clocks.
  startCloudGl();
  feedCloud();

  const empty = $('grainEmpty');
  if (empty) empty.classList.toggle('hidden', !!state.grains?.grains?.length);
}

/// The grain cloud, in three dimensions, on the GPU.
///
/// See `visualiser/WITNESS.md`. The short of it: every dot is a grain the
/// speakers played, are playing, or are about to play, out of the one
/// enumeration the renderer and the exporter also read. The five views in the
/// standalone sheet run their own scheduler and produce a cloud that behaves
/// *like* this engine without being it — fine as a study, wrong docked beside a
/// file that is actually sounding.
///
/// Across is the source, up is pitch, depth is time either side of now: the
/// same triple the engine computes per grain, in the same order, so this is a
/// projection of the parameter space rather than a decoration derived from it.
///
/// p5 in instance mode, on its own canvas and its own loop. The app's 2D
/// visuals share one requestAnimationFrame and a WEBGL sketch will not join
/// that politely. p5 itself is served from the binary — nothing here reaches
/// the net, which is the rule the whole program is built to keep.
const CLOUD_AHEAD = 0.35;    // seconds of scheduled-but-unheard, in front
const CLOUD_BEHIND = 1.6;    // seconds of history, behind

/// What the sketch reads. Written by the app, never by the sketch: one owner,
/// so there is nothing to synchronise across two animation clocks.
const cloudFeed = {
  grains: null, sr: 48000, srcFrames: 0, baseSemis: 0, now: 0,
  semiSpan: 4, centre: 0, span: 1, turn: 0, headRate: 0, overlap: 2,
};

/// The camera, and nothing else.
///
/// A viewing angle is a control value, like a slider position — it is where the
/// hand left it. That is not the same as simulation state, and it is the only
/// thing here that persists between frames.
const cloudCam = { yaw: 0.5, pitch: -0.22, drag: null };

/// How long the motion takes to come back to where it started.
///
/// Every turning term below is a whole number of turns per this, so there is no
/// seam: the picture at eight seconds is the picture at zero. Nothing is
/// integrated to achieve it — the angle is read off the clock.
const LOOP_SECONDS = 8;
const TRAIL = 3;
const TRAIL_STEP = 0.09;      // seconds between one ghost and the next
const DECAY_PER_SECOND = 1.5; // a fixed fraction lost per second, never zero

/// Colour and radius, shared by every view so they cannot disagree about what
/// a grain looks like — only about where it goes.
function grainLook(ev, dt, live, f) {
  const [, , size, pitch, , bright] = ev;
  const t = Math.max(-1, Math.min(1,
    (pitch - f.baseSemis) / 9 * 0.55 + (Math.min(1, bright * 4) - 0.4) * 1.4));
  const warm = t >= 0;
  return [
    [warm ? 235 : 105, warm ? 175 - t * 40 : 150, warm ? 120 : 235],
    2.0 + Math.min(9, (size / f.sr) * 42) * (live ? 1.4 : 1),
  ];
}

/// Where one grain sits, in whichever view is showing.
///
/// Ported from the standalone sheet, which is a faithful port of `fx::grain`
/// in its own right — the same hash over the same salts. What it never had was
/// the *document*: docked in the panel it answered to its own sliders, so it
/// drew a cloud the engine could have made rather than the one it was making.
/// These take the enumeration the server sends, so every control reaches them
/// because the grains themselves already went through it.
///
/// `back` is how far into the past to evaluate, which is what draws the trail.
/// Nothing is remembered between frames; a ghost is this same function asked
/// about a moment that has gone.
///
/// Every quantity used here is one a grain actually has. The angular sector is
/// the grain's real stereo placement, and the surface it rides is the level it
/// is actually reading — no display-only randomness anywhere.
function placeGrain(view, ev, dt, back, geo, out) {
  const [outFrame, srcFrame, size, pitch, rms, bright, pan, index] = ev;
  const { R, HEIGHT, SPAN, f, phase } = geo;

  const age = Math.max(0, -dt) + back;
  const w = Math.max(-1, Math.min(1, (dt - back) / CLOUD_BEHIND));
  const v = Math.max(0, Math.min(1, srcFrame / f.srcFrames));
  const pn = Math.max(-1, Math.min(1, (pitch - f.baseSemis) / f.semiSpan));
  const rate = Math.pow(2, (pitch - f.baseSemis) / 12);
  const c = (Math.max(-1, Math.min(1, pan || 0)) + 1) / 2;
  const amp = Math.min(1, rms * 6);
  const lift = amp * HEIGHT * 0.55;
  // Where the head was `back` ago, so a grain's distance from it grows as it
  // ages — the drift that turns a scatter into weather.
  const centreThen = f.centre - f.headRate * back;
  const dev = Math.max(-1.6, Math.min(1.6, (srcFrame - centreThen) / Math.max(1, f.span)));
  const strands = Math.max(1, Math.round(f.overlap));
  const u = ((outFrame / f.sr) % LOOP_SECONDS) / LOOP_SECONDS;

  switch (view) {
    case 'shear':
      // Output time across, source time into the screen: the ratio is the
      // slope. Push it high and the diagonal flattens into a sheet.
      out.x = w * SPAN * 0.7;
      out.z = (v - 0.5) * SPAN * 0.7;
      out.y = -pn * HEIGHT - lift * 0.4;
      break;

    case 'braid': {
      // A closed torus knot rather than an open helix. The helix had two ends,
      // and ends are where a loop looks choppy; wound onto a torus with a whole
      // number of twists it joins itself and there is nowhere for a seam to be.
      const major = u * Math.PI * 2 + phase;
      const minor = (index % strands) / strands * Math.PI * 2 + major * BRAID_TWIST;
      const rMin = R * (0.16 + 0.14 * (Math.log2(Math.max(rate, 0.002)) + 4) / 8);
      const rMaj = R * 0.62;
      out.x = (rMaj + rMin * Math.cos(minor)) * Math.cos(major);
      out.z = (rMaj + rMin * Math.cos(minor)) * Math.sin(major);
      out.y = rMin * Math.sin(minor) - pn * HEIGHT * 0.25;
      break;
    }

    case 'swarm': {
      const th = Math.acos(Math.max(-1, Math.min(1, pn)));
      const ph = c * Math.PI * 2 + phase;
      const rr = R * (0.34 + 0.62 * v) + amp * R * 0.26;
      out.x = rr * Math.sin(th) * Math.cos(ph);
      out.z = rr * Math.sin(th) * Math.sin(ph);
      out.y = rr * Math.cos(th) * 0.55 - pn * HEIGHT * 0.5;
      break;
    }

    case 'shells': {
      const rr = R * (0.22 + 0.78 * (pn + 1) / 2);
      const th = u * Math.PI * 2 * 3 + phase;
      out.x = Math.cos(th) * rr;
      out.z = Math.sin(th) * rr;
      out.y = (v - 0.5) * HEIGHT * 1.6;
      break;
    }

    case 'lattice': {
      // The grid a cloud would be on if nothing varied, pushed off it by the
      // deviations a grain actually has. At every jitter zero it is a crystal.
      const k = 18;
      const n = index % (k * k);
      const cell = SPAN * 1.5 / k;
      out.x = ((n % k) - k / 2) * cell + dev * R * 0.4;
      out.z = (Math.floor(n / k) - k / 2) * cell + (c - 0.5) * cell * 2;
      out.y = -pn * HEIGHT * 0.8 - lift * 0.3;
      break;
    }

    case 'tunnel': {
      const th = c * Math.PI * 2 + phase;
      const r = R * (0.30 + 0.55 * amp) + (1 - Math.abs(w)) * R * 0.18;
      out.x = Math.cos(th) * r;
      out.y = Math.sin(th) * r;
      // The past is compressed hard, so what has sounded sits behind the eye.
      out.z = -(w > 0 ? w : w * 0.28) * R * 4.5;
      break;
    }

    case 'mandala': {
      // A whole turn, not half of one: `phase * 0.5` left the mandala a
      // half-turn out at the loop point, which is the seam this is all for.
      const th = c * Math.PI * 2 + phase;
      const rad = R * (0.06 + 0.94 * Math.abs(w));
      out.x = Math.cos(th) * rad;
      out.y = Math.sin(th) * rad;
      out.z = lift - pn * HEIGHT * 0.3;
      break;
    }

    case 'vortex': {
      const th = (dt - back) * 2.1 + c * Math.PI * 2 + phase;
      const rad = R * (0.10 + 0.90 * Math.abs(w));
      out.x = Math.cos(th) * rad;
      out.y = Math.sin(th) * rad;
      out.z = lift * 1.6 - pn * HEIGHT * 0.25;
      break;
    }

    case 'ripple':
      out.x = w * SPAN * 0.72;
      out.z = (c - 0.5) * SPAN * 0.55;
      // Whole cycles per loop, so the standing wave stands still at the seam.
      out.y = -lift * 1.3
            + Math.sin(u * Math.PI * 2 * RIPPLE_WAVES + phase) * HEIGHT * 0.22;
      break;

    default:
      // Cloud: the spread around the head. Across the stereo field, up the
      // pitch, deep the distance from where the head is reading.
      out.x = Math.max(-1, Math.min(1, pan || 0)) * R * 0.95;
      out.y = -pn * R * 0.8;
      out.z = dev * R * 0.9;
      break;
  }
}

/// Whole numbers, so both close. A fractional twist leaves the braid's two ends
/// meeting at an angle, which is precisely the seam this is meant not to have.
const BRAID_TWIST = 3;
const RIPPLE_WAVES = 4;

/// The p5 instance, once it exists. Built on first draw rather than at load,
/// because the panel has no size until the editor is open.
let cloudSketch = null;

/// How fast the cloud turns, in turns per second of playback.
const CLOUD_SPIN = 0.035;

/// Hand the sketch this instant, worked out from the parameters.
///
/// Nothing here is stepped forward. Every quantity is a function of the moment
/// asked for, in the same way every quantity in a grain is a function of its
/// index — ask for the same instant twice and you get the same answer, whether
/// or not anything was drawn in between. That is the rule the engine lives by
/// and there is no reason for its picture to live by a different one.
///
/// The framing in particular used to be measured off the grains in view and
/// eased toward, which is a low-pass filter with memory: it needed the easing
/// precisely because it was sampling. Derived instead from the controls — the
/// same three terms `event_at` adds up, plus the reach of the spray, the layer
/// scatter and the grain itself — it is exact, it needs no smoothing, and it
/// cannot jitter on a grain that happens to land at an edge.
function feedCloud() {
  const g = state.grains;
  const st = state.edit?.stretch;
  const gr = state.grainDraft || st?.grain || {};
  const sr = g?.sampleRate || state.view?.sampleRate || 48000;
  const base = state.edit?.baseFrames || state.view?.frames || 0;
  const now = playbackTime();

  cloudFeed.grains = g?.grains?.length ? g.grains : null;
  cloudFeed.sr = sr;
  cloudFeed.srcFrames = base;
  cloudFeed.baseSemis = st?.semitones ?? 0;
  cloudFeed.now = now;
  cloudFeed.semiSpan = Math.max(4,
    ((gr.pitchJitterSemis || 0) + (gr.pitchDriftSemis || 0)) * 1.25);

  // Where the read head is at this instant, and how far the cloud reaches
  // around it. Both closed form; see above.
  const scan = gr.scan ?? 1;
  const ratio = st?.ratio || 1;
  const home = scan < 0 ? base : 0;
  cloudFeed.centre = home + (gr.position ?? 0) * base + (sourceFrameNow() / ratio) * scan;
  const spray = ((gr.positionJitterMs || 0) / 1000) * sr;
  const scatter = ((gr.layerScatter || 0) * (gr.layerScatterMs || 0) / 1000) * sr;
  const grainLen = ((st?.windowMs || 40) / 1000) * sr;
  // A floor of a twentieth of a second, so a cloud parked on one instant is a
  // tight knot rather than its own jitter magnified to fill the screen.
  cloudFeed.span = Math.max(spray + scatter + grainLen, sr * 0.05);
  // How fast the read head travels through the source, in frames per second of
  // playback. This is what lets a grain's position be evaluated at moments
  // that have already passed — the head has moved on, so a grain laid down a
  // moment ago is now behind it, and by exactly this much per second.
  cloudFeed.headRate = (sr / ratio) * scan;
  // How many windows cover any one moment. The braid separates grains sounding
  // together into strands, and this is how many there are — which is why the
  // strand count *is* the overlap rather than a number chosen to look right.
  cloudFeed.overlap = Math.max(1, Math.min(16, gr.overlap || 2));

  // The turn is a function of the moment too, so the cloud holds still when the
  // transport does. Traversal of a fixed structure — when nothing is being
  // traversed, nothing moves, and the hand can still look around it.
  cloudFeed.turn = now * CLOUD_SPIN * Math.PI * 2;

  const label = $('grainCount');
  if (label && g) {
    const shown = g.shown < g.total ? ` · showing ${g.shown.toLocaleString()}` : '';
    label.textContent = `${g.total.toLocaleString()} grains${shown}`;
  }
}

function startCloudGl() {
  const holder = $('grainGl');
  if (!holder || cloudSketch || typeof p5 === 'undefined') return;

  cloudSketch = new p5((s) => {
    // Spheres, not points. p5's WEBGL point size is a fixed number of pixels
    // and is *not* scaled by distance, so a cloud of them draws every grain the
    // same size however far away it is — the depth cue is simply absent and the
    // result reads as dots in a row. A sphere is geometry: perspective shrinks
    // it, the depth buffer lets the near ones cover the far ones, and a light
    // shades it so it reads as a ball rather than a disc. Three depth cues for
    // the price of dropping a batching trick.
    //
    // The cost is a draw call each, so the number drawn is capped and the
    // geometry is coarse. At this size on screen nobody can count the facets.
    const DETAIL_X = 7;
    const DETAIL_Y = 5;
    // Each grain costs a draw call, and each ghost behind it costs another, so
    // the two caps trade against each other. Fewer grains with tails reads as a
    // cloud; more grains without them reads as a scatter.
    const MAX_GRAINS = 260;

    s.setup = () => {
      const c = s.createCanvas(holder.clientWidth || 300, holder.clientHeight || 200, s.WEBGL);
      c.parent(holder);
      s.setAttributes('antialias', true);
      s.noStroke();
    };

    s.windowResized = () => {
      s.resizeCanvas(holder.clientWidth || 300, holder.clientHeight || 200);
    };

    s.draw = () => {
      s.clear();
      const f = cloudFeed;
      if (!f.grains || !f.srcFrames) return;

      s.ambientLight(58, 64, 78);
      s.directionalLight(255, 250, 240, -0.4, -0.7, -0.6);
      s.pointLight(90, 130, 210, 0, -260, 320);
      s.rotateX(cloudCam.pitch);
      s.rotateY(cloudCam.yaw + f.turn);

      const R = Math.min(s.width, s.height) * 0.34;
      const geo = {
        R,
        HEIGHT: R * 0.9,
        SPAN: R * 1.9,
        f,
        // Every spin below is a whole number of turns per LOOP_SECONDS, so the
        // motion closes on itself and there is no seam where it restarts.
        phase: ((f.now % LOOP_SECONDS) / LOOP_SECONDS) * Math.PI * 2,
      };

      const playFrame = f.now * f.sr;
      const near = [];
      for (const ev of f.grains) {
        const dt = (ev[0] - playFrame) / f.sr;
        if (dt > CLOUD_AHEAD || dt < -CLOUD_BEHIND) continue;
        near.push([ev, dt]);
      }
      if (!near.length) return;
      near.sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
      if (near.length > MAX_GRAINS) near.length = MAX_GRAINS;

      const at = { x: 0, y: 0, z: 0 };
      for (const [ev, dt] of near) {
        const size = ev[2];
        const live = dt <= 0 && dt + size / f.sr >= 0;
        const age = Math.max(0, -dt);
        const [col, r0] = grainLook(ev, dt, live, f);

        const ghosts = age > 0.02 ? TRAIL : 0;
        for (let k = ghosts; k >= 0; k--) {
          const back = k * TRAIL_STEP;
          if (age + back > CLOUD_BEHIND) continue;
          // Radioactive in the one sense that matters: a fixed fraction lost
          // per unit of time, so the tail thins away instead of stopping.
          const decay = Math.exp(-(age + back) * DECAY_PER_SECOND);
          const fade = dt > 0 ? 0.3 : decay;
          if (fade < 0.02) continue;
          const smoke = k === 0 ? 1 : 0.45 / k;

          placeGrain(grainView, ev, dt, back, geo, at);
          s.push();
          s.translate(at.x, at.y, at.z);
          const c = [col[0] * fade * smoke, col[1] * fade * smoke, col[2] * fade * smoke];
          if (live && k === 0) s.emissiveMaterial(c[0], c[1], c[2]);
          else s.ambientMaterial(c[0], c[1], c[2]);
          s.sphere(r0 * (k === 0 ? 1 : 0.55 / Math.sqrt(k)), DETAIL_X, DETAIL_Y);
          s.pop();
        }
      }
    };
  });

  // Turned by hand. Deliberately not p5's `orbitControl`, which carries
  // momentum: a cloud that keeps drifting after the hand comes off is a toy,
  // and this is meant to answer questions.
  holder.onpointerdown = (e) => {
    cloudCam.drag = { x: e.clientX, y: e.clientY };
    holder.classList.add('dragging');
    holder.setPointerCapture(e.pointerId);
  };
  holder.onpointermove = (e) => {
    if (!cloudCam.drag) return;
    cloudCam.yaw += (e.clientX - cloudCam.drag.x) * 0.008;
    cloudCam.pitch = Math.max(-1.2, Math.min(1.2,
      cloudCam.pitch + (e.clientY - cloudCam.drag.y) * 0.006));
    cloudCam.drag = { x: e.clientX, y: e.clientY };
  };
  holder.onpointerup = (e) => {
    cloudCam.drag = null;
    holder.classList.remove('dragging');
    try { holder.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
  };

  if (window.ResizeObserver) {
    new ResizeObserver(() => cloudSketch?.windowResized?.()).observe(holder);
  }
}

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
  const c = $('grainGl');
  if (c) new ResizeObserver(() => drawGrains()).observe(c);
}

// ------------------------------------------------------- which view of the grains
//
// Two ways to look at one schedule, both drawn here from the real enumeration.
// The five views from the standalone sheet used to be embedded in an iframe;
// they ran their own scheduler, so they answered to their own sliders and not
// to the document's, and docking them made them a weather map of a country
// that does not exist. The sheet is still served at `/grains3d` as its own
// thing — this panel is now about the file that is actually sounding.

/// Which way the sketch draws. See `drawCloud` and `drawBraid`.
let grainView = 'cloud';

function setGrainView(v) {
  grainView = v;
  for (const b of document.querySelectorAll('.vis-tab')) {
    b.classList.toggle('active', b.dataset.vis === v);
  }
}

for (const b of document.querySelectorAll('.vis-tab')) {
  b.onclick = () => setGrainView(b.dataset.vis);
}

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

/// Ask the device for a new block size.
///
/// This closes the device and opens it again — a stream's block length is fixed
/// when it is built — so it is a visible event rather than a quiet one, and the
/// document that was loaded is loaded again on the other side.
async function setBufferFrames(frames) {
  try {
    const r = await postJSON('/api/audio/buffer', { frames });
    state.bufferFrames = r.frames ?? null;
    // What the device actually gave us, which a backend is free to refuse.
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
      // The cure for a callback that cannot finish in time. Sixteen grain
      // layers under a hybrid stretch is a great deal of arithmetic for one
      // block, and a device default of 512 frames at 48 kHz is about ten
      // milliseconds to do it in. Doubling the block doubles the time and
      // doubles the latency, which is the trade — hence a choice rather than a
      // number somebody picked once.
      ...BUFFER_SIZES.map((n) => ({
        label: n == null ? 'Buffer: device default' : `Buffer: ${n} frames`,
        key: tick(() => (state.bufferFrames ?? null) === n),
        run: () => setBufferFrames(n),
      })),
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

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (!$('askModal').classList.contains('hidden')) return;

  if (e.key === '`' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); op('crop')(); }
  else if (e.key.toLowerCase() === 'g' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); goTo(); }
  else if (e.key === ']' && e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fitSelection(); }
  else if (e.key === 'ArrowLeft' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault(); zoomToSample(false);
  } else if (e.key === 'ArrowRight' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault(); zoomToSample(true);
  }
});
