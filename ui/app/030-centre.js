// ============================================================ centre column

function setMode(mode) {
  // Which modes play the *document* rather than a library file. Edit and Room
  // are both looking at the open sound — the room is drawn from the same
  // playback the editor drives, which is what makes the picture and the
  // waveform the same thing seen twice.
  const docMode = playsDocument(mode);

  // Crossing between the library and the editor changes what playback *is* —
  // the sound over there, the document over here — so anything running belongs
  // to the side it was started on. Same rule as choosing a different sound.
  //
  // Edit and Room are the same side, so moving between those two leaves the
  // transport alone: walking over to the room to look at what you are hearing
  // must not stop it.
  if (engine.playing && engine.raw !== !docMode) pausePlayback();

  const wasRoom = state.mode === 'room';
  const wasCompose = state.mode === 'compose';
  state.mode = mode;
  const editing = mode === 'edit';
  const room = mode === 'room';
  const seq = mode === 'seq';
  const compose = mode === 'compose';

  // Borrowed elements go home before anything is measured or toggled. Leaving
  // this until later would have the mode's own show/hide rules applied to
  // elements still sitting inside a hidden view.
  if (wasRoom && !room) leaveRoomView();
  if (wasCompose && !compose) composeLeave();

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
  $('lane').classList.toggle('hidden', room || seq || compose);
  // Compose lays the same frame over its SEQ cell — see `composeEnter`.
  $('seqView')?.classList.toggle('hidden', !(seq || compose));
  if (seq || compose) seqEnsureFrame();
  document.querySelectorAll('#leftRail .mode-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  $('modeLabel').textContent = editing ? 'Edit' : room ? 'Room' : seq ? 'Seq' : compose ? 'Compose' : 'Browse';
  document.body.classList.toggle('editing', editing);
  // Edit and Grain are the same document, one mode; the page says which
  // furniture is out (`body.wavepage`, the Edit page's toolbar).
  document.body.classList.toggle('wavepage', editing && editPage === 'wave');
  document.body.classList.toggle('choppage', editing && editPage === 'chop');
  chopPageSync(editing);
  document.body.classList.toggle('roomview', room);
  document.body.classList.toggle('seqview', seq);
  document.body.classList.toggle('composeview', compose);
  // The modes that give the whole width to the middle, so the library becomes
  // a floating drawer rather than a docked column. Its own class rather than
  // `.editing, .roomview` repeated down the stylesheet: the drawer's geometry
  // is one idea and it should have one name, or the next mode to want it will
  // be a third selector added to six rules.
  document.body.classList.toggle('docmode', docMode);

  // After the toggles, so the parts it borrows are in the state this mode gave
  // them before they are moved.
  if (room) enterRoomView();
  if (compose) composeEnter();

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
    if (b.dataset.page) setEditPage(b.dataset.page, false);
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
      <span class="nm"></span><button class="close" aria-label="Close this sound">×</button>`;
    el.querySelector('.nm').textContent = t.file.name;
    el.title = t.file.path;
    el.onclick = () => switchTab(i);
    el.querySelector('.close').onclick = (e) => { e.stopPropagation(); closeTab(i); };
    bar.appendChild(el);
  });

  const add = document.createElement('button');
  add.className = 'newtab';
  add.title = 'Open another sound';
  add.setAttribute('aria-label', 'Open another sound');   // C7
  add.textContent = '+';
  add.onclick = () => openDrawer();
  bar.appendChild(add);
}

async function selectFile(file, { keepTab = false } = {}) {
  releaseEngineFor(file);
  state.selectedFile = file;
  if (typeof chopSelected === 'function') chopSelected(file);
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
  syncAutomationRecord();
  if (typeof loadVisualLanes === 'function') loadVisualLanes();
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
