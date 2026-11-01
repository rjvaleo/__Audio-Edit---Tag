// ════════════════════════════════════════════════════════════ the Edit page ══
//
// Only editing: the waveform, the spectrogram and every command of the Edit,
// Action and DSP menus as a row of icons along the top. No dock, no presets —
// those are Grain's. Each icon runs the same command as its menu item, is dimmed
// when it has nothing to act on, and names itself and its key on hover.

function setEditPage(page, apply = true) {
  editPage = page === 'wave' ? 'wave' : 'grain';
  try { localStorage.setItem('editPage', editPage); } catch { /* private mode */ }
  if (apply && state.mode === 'edit') setMode('edit');
}

/// A function, not a `const`: the Edit menu, built further up, names it.
function canPaste() { return state.mode === 'edit' && (state.edit?.clipboard || 0) > 0; }

/// The range an edit acts on: the selection, or the cursor when there is none.
function selOrCue() {
  if (state.sel && state.sel.end > state.sel.start) return { start: state.sel.start, end: state.sel.end };
  const at = state.cue || 0;
  return { start: at, end: at };
}

async function copyCmd() {
  if (!needSel()) return;
  await editCmd({ op: 'copy', start: state.sel.start, end: state.sel.end });
  const sr = state.view.sampleRate || 44100;
  if (state.edit?.clipboard) toast(`Copied ${fmtTime(state.edit.clipboard / sr)}`);
}

async function pasteCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  if (!canPaste()) { toast('Copy or cut something in this sound first'); return; }
  await editCmd({ op: 'paste', ...selOrCue() });
}

async function deleteCmd() {
  if (!needSel()) return;
  await editCmd({ op: 'delete', start: state.sel.start, end: state.sel.end });
}

async function gainCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const whole = !(state.sel && state.sel.end > state.sel.start);
  const v = await ask('Gain', [
    { key: 'db', label: 'Gain (dB)', value: 0, min: -60, max: 24, step: 0.1 },
  ], { hint: whole ? 'The whole document, as there is no selection.' : 'The selection only.' });
  if (!v) return;
  const total = state.edit?.frames || state.view.frames || 0;
  const r = whole ? { start: 0, end: total } : { start: state.sel.start, end: state.sel.end };
  await editOp({ op: 'gain', db: v.db, ...r });
}

function setFadeShape(shape) {
  state.fadeShape = shape;
  const sel = $('fadeShape');
  if (sel) sel.value = shape;
  wtSync();
}

/// The icons, drawn on a 24-unit square in the line of the rail's and the
/// grain glyphs': one stroke, `currentColor`, so they light and dim with it.
const WT_SVG = {
  undo: '<path d="M8.5 6.5 4 11l4.5 4.5"/><path d="M4 11h10.5a5 5 0 0 1 0 10H11"/>',
  redo: '<path d="M15.5 6.5 20 11l-4.5 4.5"/><path d="M20 11H9.5a5 5 0 0 0 0 10H13"/>',
  revert: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v4.5H9"/>',
  cut: '<circle cx="6.5" cy="17.5" r="2.6"/><circle cx="17.5" cy="17.5" r="2.6"/><path d="M8.2 15.6 18 3.5M15.8 15.6 6 3.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.5"/><path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="1.5"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M7.5 14h2l1-3 2 6 1-3h3"/>',
  delete: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  crop: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
  duplicate: '<rect x="2.5" y="7" width="8.5" height="10" rx="1"/><rect x="13" y="7" width="8.5" height="10" rx="1"/><path d="M4.5 12h1l1-2.5 1.5 5 1-2.5h.5M15 12h1l1-2.5 1.5 5 1-2.5h.5"/>',
  silence: '<path d="M2.5 12h2l1-4.5 1.5 9 1-4.5h1"/><path d="M9 12h6"/><path d="M15 12h1l1-4.5 1.5 9 1-4.5h2"/><path d="M9 6.5v11M15 6.5v11" opacity=".45"/>',
  insertSilence: '<path d="M8 12h8"/><path d="M6 9 3 12l3 3M18 9l3 3-3 3"/><path d="M12 6v12" opacity=".45"/>',
  stripSilence: '<path d="M2.5 12h1l1-4.5 1.5 9 1-4.5h1"/><path d="M9.5 12h5" stroke-dasharray="1.2 1.8"/><path d="M15.5 12h1l1-4.5 1.5 9 1-4.5h1.5"/>',
  fadeIn: '<path d="M3 19 21 5v14z"/>',
  fadeOut: '<path d="M3 5l18 14H3z"/>',
  curveEq: '<path d="M3 19C3.5 10 11 5 21 5"/><path d="M3 19h18" opacity=".45"/>',
  curveLin: '<path d="M3 19 21 5"/><path d="M3 19h18" opacity=".45"/>',
  gain: '<path d="M12 3v18"/><rect x="7.5" y="9" width="9" height="5" rx="1"/><path d="M5 5h2M5 19h2M17 5h2M17 19h2" opacity=".45"/>',
  normalize: '<path d="M3 4h18M3 20h18" opacity=".45"/><path d="M3.5 12l2-7.5 2 15 2-11 2 7 2-11 2 15 2-7.5 2 3"/>',
  normalizeRms: '<path d="M3 4h18M3 20h18" opacity=".45"/><path d="M3 12h18"/><rect x="5" y="8" width="14" height="8" rx="1"/>',
  findPeak: '<path d="M3 16l2.5-2 2 3 2.5-11 2.5 12 2-5 2 2 2-1.5 2.5 1"/><circle cx="10" cy="4" r="1.4" fill="currentColor" stroke="none"/>',
  reverse: '<path d="M20 8H5.5M9 4.5 5.5 8 9 11.5"/><path d="M4 16h14.5M15 12.5l3.5 3.5-3.5 3.5"/>',
  repairClick: '<path d="M3 13c1.8-3 3.6 3 5.4 0"/><path d="M15.6 13c1.8-3 3.6 3 5.4 0"/><path d="M8.4 13 10 4l2 16 1.6-7" opacity=".45"/><path d="M8.4 13h7.2"/>',
  selectAll: '<rect x="3" y="5" width="18" height="14" rx="1" stroke-dasharray="2 2"/><path d="M5.5 12h2l1-3 2 6 1.5-4.5 1.5 3 1-1.5h3.5"/>',
  deselect: '<rect x="3" y="5" width="18" height="14" rx="1" stroke-dasharray="2 2"/><path d="M7 8.5l10 7M17 8.5l-10 7"/>',
  setSelection: '<path d="M8 5H5v14h3M16 5h3v14h-3"/><path d="M9.5 12h5M12 9.5v5"/>',
  goTo: '<path d="M3 12h13M12 8l4 4-4 4"/><path d="M20 5v14"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M8 10.5h5M10.5 8v5"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M8 10.5h5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fitSel: '<path d="M3 12h5M5.5 9.5 8 12l-2.5 2.5M21 12h-5M18.5 9.5 16 12l2.5 2.5"/><path d="M11 5v14M13 5v14" opacity=".45"/>',
  sample: '<path d="M3 12h18" opacity=".45"/><path d="M5 12V7M9 12v7M13 12V9M17 12v5"/><circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="19" r="1.2" fill="currentColor"/><circle cx="13" cy="9" r="1.2" fill="currentColor"/><circle cx="17" cy="17" r="1.2" fill="currentColor"/>',
  marker: '<path d="M7 21V3.5l11 4-11 4"/>',
  region: '<path d="M5 4v16M19 4v16"/><path d="M5 9h14v6H5z" fill="currentColor" fill-opacity=".25"/>',
  splitRegion: '<path d="M4 4v16M20 4v16M12 3v18"/><path d="M4 9h16v6H4z" fill="currentColor" fill-opacity=".2"/>',
  markersToRegions: '<path d="M4 15V4l5 2-5 2"/><path d="M12 13v7M21 13v7"/><path d="M12 15h9v3h-9z" fill="currentColor" fill-opacity=".25"/>',
  snapZero: '<path d="M3 12h18" opacity=".45"/><path d="M3 12c3-7.5 6-7.5 9 0s6 7.5 9 0"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  snapCd: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 6a6 6 0 0 1 6 6" opacity=".45"/>',
  snapOff: '<path d="M7 4v8a5 5 0 0 0 10 0V4"/><path d="M7 8h3M14 8h3"/><path d="M4 20 20 4"/>',
  export: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4 14v6h16v-6"/>',
  wtEdit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  wtAdd: '<rect x="3.5" y="5" width="17" height="14" rx="1.5" stroke-dasharray="2 2"/><path d="M12 9v6M9 12h6"/>',
  wtReset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v4.5H9"/>',
  wtDone: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

/// What each icon is. `need`: 'sel' wants a selection, 'file' an open sound;
/// `on` overrides that test; `lit` marks a choice that is the current one.
const WT_GROUPS = [
  ['History', [
    { id: 'undo', name: 'Undo', key: '⌘Z', on: () => !!state.edit?.canUndo, run: click('undoBtn') },
    { id: 'redo', name: 'Redo', key: '⇧⌘Z', on: () => !!state.edit?.canRedo, run: click('redoBtn') },
    { id: 'revert', name: 'Revert document', need: 'file', run: click('revertBtn') },
  ]],
  ['Clipboard', [
    { id: 'cut', name: 'Cut', key: '⌘X', need: 'sel', run: op('cut') },
    { id: 'copy', name: 'Copy', key: '⌘C', need: 'sel', run: copyCmd },
    { id: 'paste', name: 'Paste', key: '⌘V', on: canPaste, run: pasteCmd },
    { id: 'delete', name: 'Delete', key: '⌫', need: 'sel', run: deleteCmd },
    { id: 'crop', name: 'Crop', key: '⌘`', need: 'sel', run: op('crop') },
    { id: 'duplicate', name: 'Duplicate…', need: 'sel', run: duplicateCmd },
  ]],
  ['Silence', [
    { id: 'silence', name: 'Silence', need: 'sel', run: op('silence') },
    { id: 'insertSilence', name: 'Insert silence…', need: 'file', run: insertSilenceCmd },
    { id: 'stripSilence', name: 'Strip silence…', need: 'file', run: stripSilenceCmd },
  ]],
  ['Fades', [
    { id: 'fadeIn', name: 'Fade in', need: 'sel', run: op('fadeIn') },
    { id: 'fadeOut', name: 'Fade out', need: 'sel', run: op('fadeOut') },
    { id: 'curveEq', name: 'Fade curve: equal power', lit: () => state.fadeShape !== 'linear', run: () => setFadeShape('equalPower') },
    { id: 'curveLin', name: 'Fade curve: linear', lit: () => state.fadeShape === 'linear', run: () => setFadeShape('linear') },
  ]],
  ['Level', [
    { id: 'gain', name: 'Gain…', need: 'file', run: gainCmd },
    { id: 'normalize', name: 'Normalize…', need: 'file', run: normalizeCmd },
    { id: 'normalizeRms', name: 'Normalize (RMS)…', need: 'file', run: normalizeRmsCmd },
    { id: 'findPeak', name: 'Find peak', need: 'file', run: findPeakCmd },
  ]],
  ['Process', [
    { id: 'reverse', name: 'Reverse', need: 'sel', run: op('reverse') },
    { id: 'repairClick', name: 'Repair click…', need: 'sel', run: repairClickCmd },
  ]],
  ['Selection', [
    { id: 'selectAll', name: 'Select all', key: '⌘A', need: 'file', run: () => selectAll() },
    { id: 'deselect', name: 'Deselect', key: '⎋', need: 'sel', run: () => { state.sel = null; drawSelection(); } },
    { id: 'setSelection', name: 'Set selection…', need: 'file', run: setSelectionDialog },
    { id: 'goTo', name: 'Go to…', key: '⌘G', need: 'file', run: goTo },
  ]],
  ['Zoom', [
    { id: 'zoomIn', name: 'Zoom in', key: '+', need: 'file', run: click('zoomIn') },
    { id: 'zoomOut', name: 'Zoom out', key: '−', need: 'file', run: click('zoomOut') },
    { id: 'fit', name: 'Fit the whole sound', need: 'file', run: click('zoomFit') },
    { id: 'fitSel', name: 'Fit selection', key: '⇧⌘]', need: 'sel', run: fitSelection },
    { id: 'sample', name: 'Zoom at sample level', key: '⇧←', need: 'file', run: () => zoomToSample(false) },
  ]],
  ['Markers', [
    { id: 'marker', name: 'New marker', key: 'M', need: 'file', run: op('marker') },
    { id: 'region', name: 'New region', key: 'R', need: 'sel', run: op('region') },
    { id: 'splitRegion', name: 'New region split', need: 'file', run: splitRegionCmd },
    { id: 'markersToRegions', name: 'Markers to regions', need: 'file', run: markersToRegionsCmd },
  ]],
  ['Snap', [
    { id: 'snapZero', name: 'Snap to zero crossings', lit: () => state.snap === 'zero', run: () => setSnap('zero') },
    { id: 'snapCd', name: 'Snap to CD frames', lit: () => state.snap === 'cd', run: () => setSnap('cd') },
    { id: 'snapOff', name: 'Snap off', lit: () => state.snap === 'off', run: () => setSnap('off') },
  ]],
  ['Export', [
    { id: 'export', name: 'Export…', key: '⌘E', need: 'file', run: click('exportBtn') },
  ]],
];

/// The word under each icon: short, the command's own name where it fits.
const WT_WORDS = {
  undo: 'Undo', redo: 'Redo', revert: 'Revert',
  cut: 'Cut', copy: 'Copy', paste: 'Paste', delete: 'Delete', crop: 'Crop', duplicate: 'Duplicate',
  silence: 'Silence', insertSilence: 'Insert', stripSilence: 'Strip',
  fadeIn: 'Fade in', fadeOut: 'Fade out', curveEq: 'Smooth', curveLin: 'Linear',
  gain: 'Gain', normalize: 'Normalize', normalizeRms: 'RMS', findPeak: 'Peak',
  reverse: 'Reverse', repairClick: 'Declick',
  selectAll: 'All', deselect: 'None', setSelection: 'Set', goTo: 'Go to',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit', fitSel: 'Fit sel', sample: 'Samples',
  marker: 'Marker', region: 'Region', splitRegion: 'Split', markersToRegions: 'To regions',
  snapZero: 'Zero', snapCd: 'CD', snapOff: 'Off',
  export: 'Export',
};
const WT_CMDS = Object.fromEntries(WT_GROUPS.flatMap(([, items]) => items.map((it) => [it.id, it])));
const WT_STORE = 'editToolbar';

/// The bar as you arranged it: sections in order, each a title and the
/// commands in it. Anything not in a section is hidden. The default is
/// `WT_GROUPS`; a stored layout is checked against the commands that exist,
/// so a command added later turns up rather than being lost.
function wtDefault() {
  return WT_GROUPS.map(([title, items]) => ({ title, ids: items.map((it) => it.id) }));
}
function wtLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(WT_STORE) || 'null');
    if (!v || !Array.isArray(v.sections)) return { sections: wtDefault(), hidden: [] };
    const seen = new Set();
    const sections = v.sections.map((sec) => ({
      title: String(sec.title || '').slice(0, 40),
      ids: (sec.ids || []).filter((id) => WT_CMDS[id] && !seen.has(id) && seen.add(id)),
    }));
    const hidden = (v.hidden || []).filter((id) => WT_CMDS[id] && !seen.has(id) && seen.add(id));
    // New since it was saved: into the section it is in by default.
    for (const [title, items] of WT_GROUPS) {
      for (const it of items) {
        if (seen.has(it.id)) continue;
        let sec = sections.find((x) => x.title === title);
        if (!sec) sections.push(sec = { title, ids: [] });
        sec.ids.push(it.id);
      }
    }
    return { sections, hidden };
  } catch { return { sections: wtDefault(), hidden: [] }; }
}
let wtLayout = wtLoad();
let wtEditing = false;
function wtSave() {
  try { localStorage.setItem(WT_STORE, JSON.stringify(wtLayout)); } catch { /* private mode */ }
}

function wtIcon(id) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + WT_SVG[id] + '</svg>';
}

function wtButton(id) {
  const it = WT_CMDS[id];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wt-btn';
  b.dataset.cmd = id;
  b.title = it.key ? `${it.name}  ${it.key}` : it.name;
  b.setAttribute('aria-label', it.name);
  b.innerHTML = wtIcon(id) + `<span class="wt-word">${WT_WORDS[id] || it.name}</span>`;
  b.onclick = () => {
    if (wtEditing) return;
    if (!b.disabled) it.run();
  };
  if (wtEditing) {
    b.draggable = true;
    b.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/wt-cmd', id);
      e.dataTransfer.effectAllowed = 'move';
    });
    const x = document.createElement('span');
    x.className = 'wt-x';
    x.title = `Hide ${it.name}`;
    x.textContent = '×';
    x.onclick = (e) => { e.stopPropagation(); wtMove(id, 'hidden'); };
    b.appendChild(x);
  }
  return b;
}

/// Take `id` out of wherever it is and put it in `to` (a section index, or
/// 'hidden'), before `before` if given.
function wtMove(id, to, before = null) {
  for (const sec of wtLayout.sections) sec.ids = sec.ids.filter((x) => x !== id);
  wtLayout.hidden = wtLayout.hidden.filter((x) => x !== id);
  const list = to === 'hidden' ? wtLayout.hidden : wtLayout.sections[to].ids;
  const at = before ? list.indexOf(before) : -1;
  if (at >= 0) list.splice(at, 0, id); else list.push(id);
  wtSave();
  wtRender();
}

function wtMoveSection(from, to) {
  if (from === to || from < 0) return;
  const [sec] = wtLayout.sections.splice(from, 1);
  wtLayout.sections.splice(to > from ? to - 1 : to, 0, sec);
  wtSave();
  wtRender();
}

/// Where a dragged command lands: before the button under the pointer, or at
/// the end of the row.
function wtDropZone(el, to) {
  el.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].some((t) => t.startsWith('text/wt-'))) return;
    e.preventDefault();
    el.classList.add('wt-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('wt-over'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('wt-over');
    const id = e.dataTransfer.getData('text/wt-cmd');
    const sec = e.dataTransfer.getData('text/wt-sec');
    if (!id && sec === '') return;
    e.preventDefault();
    e.stopPropagation();
    if (id) {
      const over = e.target.closest('.wt-btn');
      wtMove(id, to, over && over.dataset.cmd !== id ? over.dataset.cmd : null);
    } else if (to !== 'hidden') {
      wtMoveSection(+sec, to);
    }
  });
}

function wtSection(sec, i) {
  const g = document.createElement('div');
  g.className = 'wt-group';
  g.dataset.section = String(i);
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', sec.title || 'Untitled');
  const head = document.createElement('div');
  head.className = 'wt-title';
  head.textContent = sec.title;
  const row = document.createElement('div');
  row.className = 'wt-row';
  for (const id of sec.ids) {
    row.appendChild(wtButton(id));
    // Export carries its bit depth beside it, as the old bar did.
    if (id === 'export') row.appendChild(wtBits());
  }
  if (wtEditing) {
    head.contentEditable = 'plaintext-only';
    head.spellcheck = false;
    head.title = 'Rename this section · drag to move it';
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); head.blur(); } });
    head.addEventListener('blur', () => {
      const t = head.textContent.trim().slice(0, 40);
      if (t !== sec.title) { sec.title = t; wtSave(); g.setAttribute('aria-label', t || 'Untitled'); }
    });
    g.draggable = true;
    g.addEventListener('dragstart', (e) => {
      if (e.target !== g) return;
      e.dataTransfer.setData('text/wt-sec', String(i));
      e.dataTransfer.effectAllowed = 'move';
    });
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'wt-secx';
    x.title = 'Remove this section; its commands go to Hidden';
    x.textContent = '×';
    x.onclick = () => {
      wtLayout.hidden.push(...sec.ids);
      wtLayout.sections.splice(i, 1);
      wtSave();
      wtRender();
    };
    g.appendChild(x);
    if (!sec.ids.length) row.classList.add('wt-empty');
    wtDropZone(g, i);
  }
  g.prepend(head);
  g.appendChild(row);
  return g;
}

function wtBits() {
  const bits = document.createElement('select');
  bits.className = 'mini';
  bits.id = 'wtBits';
  bits.title = 'Export bit depth';
  bits.innerHTML = $('exportBits')?.innerHTML || '';
  bits.value = $('exportBits')?.value || '24';
  bits.onchange = () => { $('exportBits').value = bits.value; $('exportBits').dispatchEvent(new Event('change')); };
  return bits;
}

/// The bar's own controls, at its end: Customize, and while customizing, the
/// hidden commands, a new section, Reset and Done.
function wtCustomize() {
  const g = document.createElement('div');
  g.className = 'wt-group wt-custom';
  const head = document.createElement('div');
  head.className = 'wt-title';
  head.textContent = wtEditing ? 'Hidden' : '';
  const row = document.createElement('div');
  row.className = 'wt-row';
  const tool = (cls, label, title, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `wt-btn ${cls}`;
    b.title = title;
    b.setAttribute('aria-label', label);
    b.innerHTML = wtIcon(cls) + `<span class="wt-word">${label}</span>`;
    b.onclick = run;
    return b;
  };
  if (wtEditing) {
    for (const id of wtLayout.hidden) {
      const b = wtButton(id);
      b.querySelector('.wt-x')?.remove();
      b.classList.add('wt-hidden');
      b.title = `${WT_CMDS[id].name} — drag it into a section`;
      row.appendChild(b);
    }
    if (!wtLayout.hidden.length) row.classList.add('wt-empty');
    wtDropZone(g, 'hidden');
    row.appendChild(tool('wtAdd', 'Section', 'Add an empty section at the end', () => {
      wtLayout.sections.push({ title: 'New section', ids: [] });
      wtSave();
      wtRender();
    }));
    row.appendChild(tool('wtReset', 'Reset', 'Put every command back where it started', () => {
      wtLayout = { sections: wtDefault(), hidden: [] };
      wtSave();
      wtRender();
    }));
    row.appendChild(tool('wtDone', 'Done', 'Stop customizing', () => { wtEditing = false; wtRender(); }));
  } else {
    row.appendChild(tool('wtEdit', 'Customize', 'Reorder, rename and hide the tools', () => { wtEditing = true; wtRender(); }));
  }
  g.append(head, row);
  return g;
}

function wtRender() {
  const bar = $('waveTools');
  if (!bar) return;
  bar.classList.toggle('wt-editing', wtEditing);
  bar.replaceChildren(...wtLayout.sections.map(wtSection), wtCustomize());
  wtSync();
}

function wtBuild() {
  if ($('waveTools')) return;
  const bar = document.createElement('div');
  bar.id = 'waveTools';
  bar.className = 'wave-tools';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Edit');
  $('editTools').before(bar);
  wtRender();
}

/// Dim what has nothing to act on, light the current choices.
function wtSync() {
  const bar = document.getElementById('waveTools');
  if (!bar) return;
  const file = !!state.selectedFile;
  const sel = file && !!state.sel && state.sel.end > state.sel.start;
  for (const b of bar.querySelectorAll('.wt-btn[data-cmd]')) {
    const it = WT_CMDS[b.dataset.cmd];
    if (!it) continue;
    const ok = it.on ? it.on() : it.need === 'sel' ? sel : it.need === 'file' ? file : true;
    // While customizing every button can be picked up.
    b.disabled = !wtEditing && !ok;
    if (it.lit) b.setAttribute('aria-pressed', String(!!it.lit()));
  }
  const bits = $('wtBits');
  if (bits && $('exportBits')) bits.value = $('exportBits').value;
}

wtBuild();

// ------------------------------------------------------------------- keys
//
// The shortcuts the menus advertise. Anything typed into a field belongs to the
// field, so the whole set stands down while one has focus.

