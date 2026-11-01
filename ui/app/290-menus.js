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
      { label: 'Copy', key: '⌘C', on: hasSel, run: copyCmd },
      { label: 'Paste', key: '⌘V', on: canPaste, run: pasteCmd },
      { label: 'Delete', key: '⌫', on: hasSel, run: deleteCmd },
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
      // The buffer size and the grain cap were twelve rows here — seven and
      // five — which made a menu about playing a sound mostly configuration.
      // They are settings, they are in Settings, and this is a menu of things
      // you can do again.
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
      { label: 'Zoom in', key: '+', on: hasFile, run: click('zoomIn') },
      { label: 'Zoom out', key: '−', on: hasFile, run: click('zoomOut') },
      { label: 'Fit', on: hasFile, run: click('zoomFit') },
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

// ------------------------------------------------------------------ settings
//
// Twenty-one of the menu bar's seventy-eight rows were not commands at all.
// Seven buffer sizes and five grain-detail levels sat in the Audio menu among
// five actual transport commands, which made a menu about playing a sound 70%
// configuration; four more sat in View. They are here now, and the menus are
// back to being lists of things you can *do*.
//
// **Snap deliberately stays in Action as well.** It is read by every edit
// command and the toolbar already carries it for that reason — it is the one
// setting with a real claim to be near the work. It is repeated here rather
// than moved, and both surfaces write through the same `setSnap`.
//
// Two of these are not in `prefs` at all: the audio buffer and the grain cap
// live on the server, because the engine owns them. They are settings from
// where you are sitting, so they are in the settings panel, and their rows read
// and write the server rather than the store. Where a setting lives is an
// implementation detail; where it is *found* should not be.

/// What the panel draws, in the order it draws it.
///
/// Each row: what it is called, the sentence saying what you are trading, how
/// to read it now and what to do when it moves. Nothing else knows this list,
/// so adding a row here is the whole job of adding a setting.
const SETTINGS_PANEL = [
  {
    group: 'How edits land',
    rows: [
      { key: 'snap', label: 'Snap edits to',
        why: 'Where a cut, crop, fade or region edge is allowed to fall. Zero crossings avoid the click you get from cutting mid-wave; CD frames are multiples of 588 samples, for regions going to a Red Book disc. Also in the Action menu and on the toolbar.',
        type: 'select',
        options: [['zero', 'Zero crossings'], ['cd', 'CD frames'], ['off', 'Nowhere — exactly where I put it']],
        get: () => state.snap, set: (v) => setSnap(v) },
    ],
  },
  {
    group: 'What the library lists',
    rows: [
      { key: 'playAll', label: 'Show files with no audio header',
        why: 'Caches, sidecars and raw dumps, read as headerless PCM. Mostly noise, occasionally worth hearing. The folder counts follow it.',
        type: 'check', get: () => state.playAll, set: (v) => setPlayAll(v) },
    ],
  },
  {
    group: 'Watching it play',
    rows: [
      { key: 'followOn', label: 'Keep the playhead on screen',
        why: 'Off, and the lane stays where you left it while the sound plays past.',
        type: 'check', get: () => state.follow.on, set: (v) => setFollow({ on: v }) },
      { key: 'followMode', label: 'And do it by',
        why: 'Scrolling pins the playhead to the middle and slides the file past it. Paging leaves it alone until it reaches the edge, then turns the page.',
        type: 'select', options: [['scroll', 'Scrolling'], ['page', 'Paging']],
        // Dimmed rather than removed when following is off: a control that
        // vanishes teaches you nothing about why.
        off: () => !state.follow.on,
        get: () => state.follow.mode, set: (v) => setFollow({ mode: v }) },
    ],
  },
  {
    group: 'What things cost',
    rows: [
      { key: 'buffer', label: 'Audio buffer',
        why: 'How long the engine has to fill each block. Doubling it doubles the time it has and doubles the delay before a control you move is heard — so a bigger buffer cures dropouts and costs responsiveness.',
        type: 'select',
        options: BUFFER_SIZES.map((n) => [n === null ? '' : String(n),
          n === null ? 'The device’s own size' : `${n} frames`]),
        get: () => (state.bufferFrames == null ? '' : String(state.bufferFrames)),
        set: (v) => setBufferFrames(v === '' ? null : Number(v)) },
      { key: 'grainCap', label: 'Grain detail',
        why: 'How many grains a picture of the cloud is drawn from. The schedule is re-fetched every time you move a control, so this is spending rather than quality — the sound is identical either way.',
        type: 'select', options: GRAIN_CAPS.map((n) => [String(n), n.toLocaleString()]),
        get: () => String(state.grainCap ?? ''), set: (v) => setGrainCap(Number(v)) },
      { key: 'masterFft', label: 'Analyser resolution',
        why: 'The transform size behind the master bus spectrum. More bands, more arithmetic per frame — the band count on screen follows the pixels either way.',
        when: 'Applies to the next frame drawn.',
        type: 'select', options: [1024, 2048, 4096, 8192, 16384].map((n) => [String(n), `${n} bands`]),
        get: () => String(masterBus.fft),
        set: (v) => { masterBus.fft = setPref('masterFft', Number(v)); wireMasterRes(); } },
    ],
  },
  {
    group: 'The sequencer',
    rows: [
      { key: 'seqRoute', label: 'Play it through the engine',
        why: 'Its sound goes out of the engine’s device on the same frames as the grain, so the two line up to the sample, and are recorded, metered and drawn as one. It runs a tenth of a second ahead to do it, so a sequencer knob is heard that much after you turn it. Off, the browser plays it: no delay, and close rather than exact.',
        when: 'From the next Play.',
        type: 'check', get: () => prefs.seqRoute, set: (v) => setPref('seqRoute', v) },
    ],
  },
];

function buildSettingsPanel() {
  const box = $('settingsBody');
  if (!box) return;
  box.innerHTML = '';
  for (const section of SETTINGS_PANEL) {
    const head = document.createElement('div');
    head.className = 'set-group';
    head.textContent = section.group;
    box.appendChild(head);

    for (const row of section.rows) {
      const el = document.createElement('div');
      el.className = 'set-row';
      if (row.off?.()) el.classList.add('set-off');

      const label = document.createElement('span');
      label.className = 'set-label';
      label.textContent = row.label;
      if (row.when) {
        const when = document.createElement('span');
        when.className = 'set-when';
        when.textContent = row.when;
        label.appendChild(when);
      }
      el.appendChild(label);

      let control;
      if (row.type === 'check') {
        control = document.createElement('input');
        control.type = 'checkbox';
        control.checked = !!row.get();
        control.onchange = () => { row.set(control.checked); buildSettingsPanel(); };
      } else {
        control = document.createElement('select');
        control.className = 'field';
        for (const [value, text] of row.options) {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          control.appendChild(o);
        }
        control.value = String(row.get());
        control.disabled = !!row.off?.();
        control.onchange = () => { row.set(control.value); buildSettingsPanel(); };
      }
      control.id = `set-${row.key}`;
      el.appendChild(control);

      const why = document.createElement('span');
      why.className = 'set-why';
      why.textContent = row.why;
      el.appendChild(why);

      box.appendChild(el);
    }
  }
}

function openSettings() {
  buildSettingsPanel();
  $('settingsModal')?.classList.remove('hidden');
}

function closeSettings() {
  $('settingsModal')?.classList.add('hidden');
}

$('settingsOpen')?.addEventListener('click', openSettings);
$('settingsClose')?.addEventListener('click', closeSettings);
// The dark edge closes it, like every other overlay here.
$('settingsModal')?.addEventListener('click', (e) => {
  if (e.target === $('settingsModal')) closeSettings();
});
$('settingsReset')?.addEventListener('click', () => {
  for (const [key, spec] of Object.entries(Settings.SPEC)) setPref(key, spec.def, { save: false });
  Settings.persist(localStorage, prefs);
  // Back through the setters, so everything that watches a setting hears about
  // it — the store alone changes no pixels.
  setSnap(prefs.snap);
  setPlayAll(prefs.playAll);
  setFollow({ on: prefs.followOn, mode: prefs.followMode });
  setLaneSplit(prefs.laneSplit);
  setLeftPanelWidth(prefs.leftPanelWidth);
  masterBus.fft = prefs.masterFft;
  buildSettingsPanel();
  toast('Settings put back to their defaults');
});

/// The panel's half of the path: what is not a place.
///
/// **The coordinates are not here any more.** They were rows of typed X, Y and
/// Z, and `docs/ROOM-EDITOR.md` had already argued against exactly that before
/// they were written — *"A field with `-0.38` in it puts a spreadsheet between
/// you and the room."* The path is dragged in the room now, by
/// `paintSolidPath`. What is left here is the two things that are not a place:
/// adding a waypoint, and putting the whole path back.
function solidPathPanel() {
  const box = $('reSolidPath');
  if (!box) return;
  box.innerHTML = '';
  // Every point on the path, where it is, and a way to take a waypoint out
  // without finding its bead — the ends stay, because a path has two.
  const pts = Array.isArray(roomEdit.solidPath) ? roomEdit.solidPath : [];
  pts.forEach((pt, i) => {
    const end = i === 0 || i === pts.length - 1;
    const row = document.createElement('div');
    row.className = `re-wp${roomEdit.pick === `path:${i}` ? ' picked' : ''}`;
    row.dataset.key = `path:${i}`;
    row.onclick = () => roomPick(roomEdit.pick === `path:${i}` ? null : `path:${i}`);
    const name = document.createElement('span');
    name.className = 're-wp-name mono';
    name.textContent = i === 0 ? 'front' : end ? 'end' : String(i);
    const at = document.createElement('span');
    at.className = 're-wp-at mono';
    at.textContent = `${(+pt.x).toFixed(2)}  ${(+pt.y).toFixed(2)}  ${(+pt.z).toFixed(2)}`;
    row.append(name, at);
    if (!end) {
      const x = document.createElement('button');
      x.className = 're-btn re-wp-x';
      x.textContent = '×';
      x.title = 'Remove this waypoint';
      x.dataset.wp = String(i);
      x.onclick = (ev) => {
        ev.stopPropagation();
        roomEdit.solidPath.splice(i, 1);
        saveRoomData();
        roomPick(null);
      };
      row.appendChild(x);
    }
    box.appendChild(row);
  });
  const note = document.createElement('div');
  note.className = 'fx-note';
  note.textContent = roomEdit.on
    ? 'Click a point to pick it: drag it freely, or pull an arrow to move it along one axis. Delete removes a picked waypoint; so does × here.'
    : 'Open the room editor to drag the path. × removes a waypoint.';
  box.appendChild(note);
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
