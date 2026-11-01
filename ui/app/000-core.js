'use strict';

/* The browser side. Talks to the Rust server over the endpoints in routes.rs;
   holds no audio itself beyond what the <audio> element streams.

   Three surfaces:
     left    the whole library — every file, with an overview, playable in place
     centre  the selected sound: big waveform and its stats; or the edit window
     right   tagging for the selected folder                                  */

const $ = (id) => document.getElementById(id);

/// The preferences, live.
///
/// `Settings` (in `settings.js`) is the pure half — the table of what a setting
/// is and what counts as a readable value. This is the one mutable copy the
/// interface reads and writes, loaded once here so that no call site has to
/// parse anything, and so a setting can be read during load without reaching
/// for `localStorage` again.
const prefs = Settings.load(localStorage);

/// Change one, write them all, and tell whoever is listening.
///
/// Everything that has to happen when a setting moves is registered rather than
/// called from here, because the settings panel, the menus and the controls on
/// the page can all set the same value and none of them should have to know
/// what the others need repainting.
const prefsListeners = new Set();

function setPref(key, value, { save = true } = {}) {
  if (!(key in Settings.SPEC)) return prefs[key];
  const next = Settings.SPEC[key].read(value);
  const changed = prefs[key] !== next;
  prefs[key] = next;
  if (save) Settings.persist(localStorage, prefs);
  if (changed) for (const fn of prefsListeners) fn(key, next);
  return next;
}

/// Called whenever any setting changes. `key` says which.
function onPrefChange(fn) {
  prefsListeners.add(fn);
}

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
  // Per sound: the measured words, and the classifier's suggestion, as
  // `/api/similar` last gave them. Read by the Advanced view.
  sonicWords: {},
  suggested: {},
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
  /// Filled from the store at load; the values here are only the shape.
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
/// The modes that are looking at the open **document** rather than at a file in
/// the library.
///
/// **Playback is a different thing in each.** In Browse a click is a question
/// about the file, so it plays bare — no edits, no stretch, no grain cloud, no
/// rack. In Edit and in Room the document is the point and it plays in full.
///
/// One name for it, taking the mode as an argument so `setMode` can ask about
/// the mode it is moving *to*. It exists because this was written out as
/// `state.mode !== 'edit'` in the play path, and adding a third mode quietly
/// turned that into "the room plays raw" — which is the granular engine not
/// running when you press play in the room.
/// Which page of the open document is out: 'grain', the granular engine and
/// its dock; 'wave', the Edit page — the waveform and the edit toolbar and
/// nothing else; or 'chop', the waveform and Chop. One mode, `edit`, every
/// way: the same document, the same transport. Remembered. Set by the rail
/// (`setEditPage`).
const EDIT_PAGES = ['grain', 'wave', 'chop'];
let editPage = (() => {
  try { const p = localStorage.getItem('editPage'); return EDIT_PAGES.includes(p) ? p : 'grain'; } catch { return 'grain'; }
})();

const playsDocument = (m = state.mode) => m === 'edit' || m === 'room' || m === 'seq' || m === 'compose';

/// The modes where the library is an overlay drawer rather than a docked
/// column. Both of them give the whole width to something else — the editor's
/// lane, the room — so the library arrives over the top and goes away again,
/// instead of squeezing what you came here to look at.
const drawerMode = () => playsDocument();

function openDrawer() {
  state.drawerOpen = true;
  $('leftPanel').classList.remove('collapsed', 'drawer-closed');
  $('scrim').classList.toggle('hidden', !drawerMode());
}

function closeDrawer() {
  state.drawerOpen = false;
  // **The input device is opened by `showPane` and has to be closed by whoever
  // shuts the panel.** Shutting the drawer is not going to another pane, so
  // `showPane` never runs and `recordPanelShown(false)` never fires — the
  // microphone stayed open and polling behind a closed drawer, for as long as
  // the panel had a Record pane. Every route out of it comes through here: the
  // rail, the ×, and the scrim.
  recordPanelShown(false);
  $('scrim').classList.add('hidden');
  if (drawerMode()) $('leftPanel').classList.add('drawer-closed');
  else $('leftPanel').classList.add('collapsed');
}

$('scrim').onclick = () => closeDrawer();
// The empty lane points at the library; with the library put away it opens it
// rather than pointing at nothing (C9, `docs/DESIGN-CRITIQUE.md`).
$('laneEmptyOpen').onclick = () => showPane('left', 'browse');
$('closeLeft').onclick = () => closeDrawer();
$('closeRight').onclick = () => $('rightPanel').classList.add('collapsed');

