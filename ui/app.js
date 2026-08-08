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
      const shown = files.filter(matchesFilter);
      if (!shown.length) {
        kids.innerHTML = '<div class="loading">no matches</div>';
      } else {
        for (const file of shown) kids.appendChild(fileRow(file));
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
    (audio.dataset.path === file.path && !audio.paused ? ' playing' : '');
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
  el.querySelector('.cat').textContent = file.category;
  el.querySelector('.dot').title =
    `${file.confidence} confidence — ${file.why || 'no reason recorded'}`;
  el.title = file.why || file.name;

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
  }
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

const audio = new Audio();
audio.volume = 0.85;
$('volume').oninput = (e) => { audio.volume = +e.target.value; };

const editedSuffix = () => (state.edit?.edited ? '&edited=1' : '');

/// Bumped whenever the document or rack changes. It rides along in the audio
/// URL so the browser treats each render as a new resource; without it a change
/// that leaves the length alone — a pitch shift, an EQ tweak — replays the
/// previously cached audio and looks broken.
state.audioRev = 0;
const audioURL = (file) =>
  `/audio?p=${encodeURIComponent(file.path)}${editedSuffix()}&r=${state.audioRev}`;

function playFile(file) {
  const url = audioURL(file);
  if (audio.dataset.path === file.path && audio.getAttribute('src') === url) {
    audio.paused ? audio.play() : audio.pause();
    return;
  }
  if (state.selectedFile?.path !== file.path) selectFile(file);
  audio.setAttribute('src', url);
  audio.dataset.path = file.path;
  applyLoop();
  audio.play().catch((e) => toast('Cannot play: ' + e.message));
}

function markPlaying() {
  document.querySelectorAll('.file-row').forEach((el) => {
    const on = el.dataset.path === audio.dataset.path && !audio.paused;
    el.classList.toggle('playing', on);
    const b = el.querySelector('.pb');
    if (b) { b.classList.toggle('on', on); b.textContent = on ? '❚❚' : '▶'; }
  });
}

audio.addEventListener('play', () => {
  $('playBtn').classList.add('on'); $('playBtn').textContent = '❚❚'; markPlaying();
});
audio.addEventListener('pause', () => {
  $('playBtn').classList.remove('on'); $('playBtn').textContent = '▶'; markPlaying();
});
audio.addEventListener('ended', () => { $('playhead').style.display = 'none'; markPlaying(); });
// -------------------------------------------------- the transport clock
//
// `timeupdate` fires about four times a second, which is far too coarse to
// position a playhead against a waveform. Reading `currentTime` every animation
// frame is better but still steps, because the element only advances it when a
// buffer is handed to the output.
//
// So: anchor on the element whenever it genuinely moves, and interpolate from
// the wall clock in between. The anchor keeps it honest — it can never drift,
// because every real update resets it.

const clock = { media: 0, wall: 0 };

function anchorClock() {
  const t = audio.currentTime;
  if (t !== clock.media) {
    clock.media = t;
    clock.wall = performance.now();
  }
}

/// Playback position, interpolated between the element's updates.
function playbackTime() {
  if (audio.paused || !clock.wall) return audio.currentTime;
  const elapsed = (performance.now() - clock.wall) / 1000;
  const est = clock.media + elapsed * (audio.playbackRate || 1);
  // Never run past what the element could plausibly have reached, and never
  // fall behind it either.
  const dur = audio.duration;
  return isFinite(dur) ? Math.min(est, dur) : est;
}

audio.addEventListener('timeupdate', anchorClock);
audio.addEventListener('seeked', () => { clock.media = -1; anchorClock(); });
audio.addEventListener('play', () => { clock.media = -1; anchorClock(); startTransportLoop(); });
audio.addEventListener('pause', () => {
  updatePlayhead(); updateOverviewPlayhead(); paintTime();
});

let transportRaf = null;
function startTransportLoop() {
  if (transportRaf) return;
  const tick = () => {
    if (audio.paused) { transportRaf = null; return; }
    transportRaf = requestAnimationFrame(tick);
    anchorClock();
    serviceLoop();
    paintTime();
    updatePlayhead();
    updateOverviewPlayhead();
  };
  tick();
}

function paintTime() {
  $('timeNow').textContent = fmtTime(playbackTime());
}

$('playBtn').onclick = () => {
  if (!audio.getAttribute('src')) { if (state.selectedFile) playFile(state.selectedFile); return; }
  if (audio.paused) {
    // Starting from a stop returns to the cue; resuming a pause carries on.
    if (Math.abs(audio.currentTime - outputTimeAt(state.cue || 0)) > 0.001 && audio.ended) {
      returnToCue();
    }
    audio.play();
  } else {
    audio.pause();
  }
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
  const t = outputTimeAt(state.cue || 0);
  if (isFinite(t)) audio.currentTime = Math.max(0, t);
}

$('stopBtn').onclick = () => { audio.pause(); returnToCue(); updatePlayhead(); paintTime(); };

// Reaching the end without looping drops back to the cue, ready to go again.
audio.addEventListener('ended', () => { if (!audio.loop) returnToCue(); });

// ------------------------------------------------------------ loop playback

// Loop is simply on or off. What it loops follows from whether anything is
// selected — a selection loops, otherwise the whole file — so the button never
// needs a mode and never goes stale when the selection changes.
state.loopOn = false;

function applyLoop() {
  const hasSel = !!state.sel && state.sel.end > state.sel.start;
  // Always off, even for a whole-file loop: the element's own wrap is
  // instantaneous and clicks. serviceLoop performs the wrap so it can fade
  // across the seam.
  audio.loop = false;
  if (state.loopOn) ensureAnalyser();
  const btn = $('loopBtn');
  btn.classList.toggle('on', state.loopOn);
  const what = hasSel ? 'selection' : 'whole file';
  btn.title = state.loopOn ? `Looping the ${what}` : 'Loop off';
  $('loopLabel').textContent = state.loopOn ? what : '';
}

$('loopBtn').onclick = () => { state.loopOn = !state.loopOn; applyLoop(); };
applyLoop();

// ------------------------------------------------------ loop crossfade
//
// Jumping the playhead mid-waveform lands on a discontinuity, heard as a click.
// There is one playback source, so this fades across the seam rather than
// overlapping two copies: level comes down over the last few milliseconds
// before the wrap and back up after it. Short enough not to read as a dip.
//
// The wrap itself also moves here from `timeupdate`, which fires about four
// times a second — far too coarse to loop tightly.
state.loopFadeMs = 14;

/// The loop's bounds in playback time, or null if nothing is being looped.
function loopBounds() {
  if (!state.loopOn) return null;
  if (state.sel && state.sel.end > state.sel.start) {
    const a = outputTimeAt(state.sel.start);
    const b = outputTimeAt(state.sel.end);
    return b - a > 0.02 ? { a, b } : null;
  }
  const d = audio.duration;
  return isFinite(d) && d > 0.02 ? { a: 0, b: d } : null;
}

let fadeScheduled = 0;

function setLoopGain(target, seconds) {
  if (!loopGain || !audioCtx) return;
  const now = audioCtx.currentTime;
  loopGain.gain.cancelScheduledValues(now);
  loopGain.gain.setValueAtTime(loopGain.gain.value, now);
  loopGain.gain.linearRampToValueAtTime(target, now + Math.max(0.001, seconds));
}

/// Run every frame: fade out approaching the loop end, wrap, fade back in.
function serviceLoop() {
  const fade = (state.loopFadeMs || 14) / 1000;
  const bounds = loopBounds();
  if (!bounds) {
    if (fadeScheduled) { setLoopGain(1, 0.01); fadeScheduled = 0; }
    return;
  }
  const t = playbackTime();

  if (t >= bounds.b - 0.002 || t < bounds.a - 0.05) {
    audio.currentTime = bounds.a;
    clock.media = -1;
    anchorClock();
    setLoopGain(1, fade);        // back up on the far side of the seam
    fadeScheduled = 0;
    if (audio.paused) audio.play().catch(() => {});
    return;
  }

  const toEnd = bounds.b - t;
  if (toEnd <= fade) {
    if (!fadeScheduled) { setLoopGain(0, toEnd); fadeScheduled = 1; }
  } else if (fadeScheduled) {
    setLoopGain(1, 0.01);
    fadeScheduled = 0;
  }
}

/// Start a selection loop from the beginning of the selection.
function playSelectionLoop() {
  if (!state.selectedFile) return;
  state.loopOn = true;
  applyLoop();
  playFile(state.selectedFile);
  if (state.sel) audio.currentTime = outputTimeAt(state.sel.start);
}

/// Time ratio between what is playing and the source the overview shows.
const timeRatio = () => {
  const r = state.edit?.stretch?.ratio;
  return r && isFinite(r) && r > 0 ? r : 1;
};

/// Playback position expressed as a frame in the source file.
const sourceFrameNow = () =>
  (playbackTime() * (state.view.sampleRate || 48000)) / timeRatio();

/// The playback time that lands on a given source frame.
const outputTimeAt = (srcFrame) =>
  (srcFrame * timeRatio()) / (state.view.sampleRate || 48000);

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
  // missing — a tab restored before its first load finished — is fetched.
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

async function loadPeaks() {
  const f = state.selectedFile;
  if (!f) return;
  const seq = ++peakSeq;
  // One column per *device* pixel. Asking in CSS pixels draws each column
  // across two device pixels on a retina display — half the detail the canvas
  // can actually show, which is why this strip looked coarser than the browser.
  // One column per *device* pixel; asking in CSS pixels halves the detail on
  // a retina display.
  const dpr = window.devicePixelRatio || 1;
  const cols = Math.max(200, Math.min(8192, Math.round(($('lane').clientWidth || 800) * dpr)));
  // Deliberately NOT the edited stream. The overview is the original file, so
  // it stays put while you work; the grain swarm shows what is being pulled
  // from it, and the playhead shows where in the source you are.
  let url = `/api/peaks?p=${encodeURIComponent(f.path)}&cols=${cols}`;
  if (state.view.to > state.view.from) {
    url += `&from=${Math.floor(state.view.from)}&to=${Math.ceil(state.view.to)}`;
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
  state.view = { from: peaks.from, to: peaks.to, frames: peaks.frames, sampleRate: peaks.sampleRate };
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
  const span = state.view.to - state.view.from;
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
    if (audio.dataset.path !== state.selectedFile.path) playFile(state.selectedFile);
    const t = outputTimeAt(frame);
    if (isFinite(t)) audio.currentTime = Math.max(0, Math.min(t, audio.duration || t));
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
    if (state.loopOn && state.sel) audio.currentTime = outputTimeAt(state.sel.start);
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
  $('selLabel').textContent = state.sel
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

  state.audioRev += 1;
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

/// Repoint the audio element at the edited or original stream, keeping position.
function reloadAudioSource() {
  const f = state.selectedFile;
  if (!f || audio.dataset.path !== f.path) return;
  const at = audio.currentTime;
  const wasPlaying = !audio.paused;
  audio.setAttribute('src', audioURL(f));
  // Repointing the source resets the element, so the loop flag has to be put
  // back or playback silently stops looping the moment a slider moves.
  applyLoop();
  audio.currentTime = Math.min(at, state.edit?.duration ?? at);
  if (wasPlaying) audio.play().catch(() => {});
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
    state.audioRev += 1;
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
function param(label, value, min, max, step, format, onChange, onCommit) {
  const el = document.createElement('div');
  el.className = 'param';
  el.innerHTML = `<div class="row"><span class="k"></span><span class="v"></span></div>
    <input type="range">`;
  el.querySelector('.k').textContent = label;
  const out = el.querySelector('.v');
  const input = el.querySelector('input');
  Object.assign(input, { min, max, step, value });
  out.textContent = format(value);

  // The readout is updated from the element itself, so a redraw elsewhere
  // cannot leave the number disagreeing with the handle.
  el.sync = (v) => { input.value = v; out.textContent = format(v); };

  input.oninput = () => {
    const v = +input.value;
    out.textContent = format(v);
    onChange(v);
  };
  // Fires on pointer release, which is when the change is worth committing
  // properly rather than previewing.
  if (onCommit) input.onchange = () => onCommit(+input.value);
  return el;
}

/// Time and pitch live on the document, so they are posted as an edit
/// operation rather than as part of the rack.
/// Which file the stretch sliders were built for.
///
/// The panel is built once and then left alone. Rebuilding it on every server
/// response destroyed the very slider under the pointer, so the first change
/// landed and no further drag did anything.
let stretchBuiltFor = null;
let stretchTimer = null;

function sendStretch({ live }) {
  const d = state.stretchDraft;
  editOp(
    { op: 'stretch', ratio: d.ratio, semitones: d.semitones,
      windowMs: d.windowMs, quality: live ? 'draft' : d.quality },
    { live },
  );
}

/// Continuous preview while dragging, at draft quality so it keeps up.
function previewStretch() {
  clearTimeout(stretchTimer);
  stretchTimer = setTimeout(() => sendStretch({ live: true }), 130);
}

/// Pointer released: commit properly, at the chosen quality, and repoint audio.
function commitStretch() {
  clearTimeout(stretchTimer);
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
  };


  const rows = {};
  rows.ratio = param('Stretch', st.ratio, 0.25, 4, 0.01, (v) => `${v.toFixed(2)}×`,
    (v) => { state.stretchDraft.ratio = v; showStretchOut(); previewStretch(); },
    () => commitStretch());
  rows.semitones = param('Pitch', st.semitones, -24, 24, 0.5,
    (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} st`,
    (v) => { state.stretchDraft.semitones = v; previewStretch(); },
    () => commitStretch());
  rows.windowMs = param('Window', st.windowMs, 5, 200, 1, (v) => `${Math.round(v)} ms`,
    (v) => { state.stretchDraft.windowMs = v; previewStretch(); },
    () => commitStretch());

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
             grain: state.grainDraft },
           { live });
  };
  let t;
  const preview = () => { clearTimeout(t); t = setTimeout(() => send({ live: true }), 130); };
  const commit = () => { clearTimeout(t); send({ live: false }); };

  // Grouped by what they do, so each panel stays short enough to read at once.
  const groups = [
    [shape, [
      ['Density', 'densityHz', 0, 200, 1, (v) => (v <= 0 ? 'from overlap' : `${Math.round(v)}/s`)],
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
  state.audioRev += 1;
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

$('stretchReset').onclick = async () => {
  clearTimeout(stretchTimer);
  state.stretchDraft = { ratio: 1, semitones: 0, windowMs: 40, quality: 'standard' };
  await editOp({ op: 'stretch', ratio: 1, semitones: 0, windowMs: 40, quality: 'standard' });
  syncStretchSliders();

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
  const frame = state.sel ? state.sel.start
    : Math.round(audio.currentTime * (state.view.sampleRate || 1));
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

let audioCtx = null;
let analyser = null;
let loopGain = null;
let visRaf = null;

function ensureAnalyser() {
  if (analyser) return true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  try {
    audioCtx = new Ctx();
    const src = audioCtx.createMediaElementSource(audio);
    loopGain = audioCtx.createGain();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    // Routing through the graph means we must reconnect to the speakers, or
    // playback goes silent the moment the analyser is attached.
    src.connect(loopGain);
    loopGain.connect(analyser);
    analyser.connect(audioCtx.destination);
    return true;
  } catch {
    analyser = null;
    return false;
  }
}

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

  if (!analyser || audio.paused) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(audio.paused ? 'press play to see the live spectrum' : 'analyser unavailable', 8, h / 2);
    return;
  }

  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);

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

audio.addEventListener('play', () => {
  // Browsers start the context suspended until a user gesture.
  if (ensureAnalyser() && audioCtx.state === 'suspended') audioCtx.resume();
});

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
  const cols = Math.max(200, Math.min(1200, Math.floor($('lane').clientWidth) || 800));
  let url = `/api/spectrogram?p=${encodeURIComponent(f.path)}&cols=${cols}&fft=${state.fftSize}`;
  if (state.view.to > state.view.from) {
    url += `&from=${Math.floor(state.view.from)}&to=${Math.ceil(state.view.to)}`;
  }
  try { state.spec = await api(url); }
  catch (e) { toast(e.message); return; }
  drawSpectrogram();
}

function drawSpectrogram() {
  const s = state.spec;
  const canvas = $('specCanvas');
  if (!s || !state.showSpec) return;

  canvas.width = s.columns;
  canvas.height = s.bins;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(s.columns, s.bins);
  const bin = atob(s.data);

  for (let c = 0; c < s.columns; c++) {
    for (let b = 0; b < s.bins; b++) {
      const v = bin.charCodeAt(c * s.bins + b) / 255;
      // Low frequencies at the bottom, which means flipping the row order.
      const y = s.bins - 1 - b;
      const i = (y * s.columns + c) * 4;
      const [r, g, bl] = specColour(v);
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = bl; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function specColour(v) {
  const lerp = (a, b, t) => a + (b - a) * t;
  const c1 = [10, 13, 20], c2 = [50, 120, 190], c3 = [190, 225, 255];
  if (v < 0.5) {
    const t = v / 0.5;
    return [lerp(c1[0], c2[0], t) | 0, lerp(c1[1], c2[1], t) | 0, lerp(c1[2], c2[2], t) | 0];
  }
  const t = (v - 0.5) / 0.5;
  return [lerp(c2[0], c3[0], t) | 0, lerp(c2[1], c3[1], t) | 0, lerp(c2[2], c3[2], t) | 0];
}

// ============================================================= tagging panel

function fillTagPanel(folder) {
  const e = state.tagEdits[folder.name] || {};
  $('editLevel1').value = e.level1 ?? folder.level1;
  $('editLevel2').value = e.level2 ?? folder.level2;
  $('editTags').value = e.tags ?? folder.tags;
  $('editNotes').value = e.notes ?? '';

  const fields = [
    ['Folder', folder.name],
    ['Files', `${folder.files} (${folder.audioFiles} audio)`],
    ['Size', fmtBytes(folder.bytes)],
    ['Duration', folder.minutes.toFixed(1) + ' min'],
    ['Confidence', folder.confidence],
    ['Categories', folder.categories],
    ['Formats', folder.formats],
  ];
  if (folder.instruments) fields.push(['Instruments', folder.instruments]);
  if (folder.machine) fields.push(['Machine', folder.machine]);

  const box = $('inspectFields');
  box.innerHTML = '';
  for (const [k, v] of fields) {
    const el = document.createElement('div');
    el.className = 'insp-field';
    el.innerHTML = `<span class="k"></span><span class="v"></span>`;
    el.querySelector('.k').textContent = k;
    el.querySelector('.v').textContent = v;
    box.appendChild(el);
  }
}

for (const [id, key] of [['editLevel1', 'level1'], ['editLevel2', 'level2'],
                         ['editTags', 'tags'], ['editNotes', 'notes']]) {
  $(id).onchange = (e) => {
    const name = state.selectedFolder;
    if (!name) return;
    (state.tagEdits[name] ??= {})[key] = e.target.value.trim();
    updateDirty();
  };
}

function updateDirty() {
  const n = Object.keys(state.tagEdits).length;
  $('dirtyLabel').textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : '';
}

$('discardBtn').onclick = () => {
  state.tagEdits = {};
  updateDirty();
  const f = state.folders.find((x) => x.name === state.selectedFolder);
  if (f) fillTagPanel(f);
  toast('Tag edits discarded');
};

$('commitBtn').onclick = async () => {
  if (!Object.keys(state.tagEdits).length) { toast('Nothing to commit'); return; }
  try {
    const r = await postJSON('/api/save', { folders: state.tagEdits });
    toast(`Committed — ${r.foldersWritten} _TAGS.txt written`);
    state.tagEdits = {};
    updateDirty();
  } catch (e) { toast('Commit failed: ' + e.message); }
};

// ==================================================================== search

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
  const set = visSetup(!audio.paused);
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
  if (audio.paused) {
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
audio.addEventListener('play', () => { if (!grainRaf) grainLoop(); });
audio.addEventListener('pause', () => {
  // Let it settle for a moment rather than freezing mid-flight.
  setTimeout(() => {
    if (audio.paused && grainRaf) { cancelAnimationFrame(grainRaf); grainRaf = null; }
    drawGrains();
  }, 600);
});

if (window.ResizeObserver) {
  const c = $('grainCanvas');
  if (c) new ResizeObserver(() => drawGrains()).observe(c);
}
