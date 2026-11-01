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
  state.playAll = setPref('playAll', !!on);
  $('playAll').checked = state.playAll;
  buildTree();
}

state.playAll = prefs.playAll;
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
    <button class="pb" title="Play" aria-label="Play">▶</button>
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

