// ─────────────────────────────────────── the Grain view: Classic and Modern ──
//
// The design-council pass over the Grain view, behind a switch in its tab
// strip. Classic is the view as it was. Modern is drawn by one block at the
// end of `app.css`, scoped to `body.editing[data-grain-ui="modern"]`, so it
// reaches nothing outside the Grain view — the Visual view's Sound tab, which
// borrows the grain tray, keeps its own look. Nothing here moves an element;
// the words Modern adds are spans Classic does not show.

/// The knobs whose named point is marked: the value each has a word for.
/// A function rather than a `const`: `gkAdopt` asks for it from code that runs
/// before this part of the file has (STATE.md §10, the temporal dead zone).
function gmMarks() {
  return { envelope: 0.5, layerSpread: 0, panSpread: 0, layerScatter: 0 };
}

function grainUiModern() {
  return document.body.dataset.grainUi === 'modern' && document.body.classList.contains('editing');
}

/// A word only Modern shows, and the word Classic had in its place.
function gmWords(classic, modern) {
  const was = document.createElement('span');
  was.className = 'gm-classic';
  was.textContent = classic;
  const now = document.createElement('span');
  now.className = 'gm-word';
  now.textContent = modern;
  return [was, now];
}

/// Delete, DEL and Revert ask once in Modern: the first click arms the button
/// and says so, the second within three seconds acts. In capture, so the
/// button's own handler never hears the first.
function gmArm(btn) {
  if (!btn || btn.dataset.gmArm) return;
  btn.dataset.gmArm = '1';
  let timer = 0, text = '';
  const disarm = () => {
    clearTimeout(timer);
    if (!btn.classList.contains('gm-armed')) return;
    btn.classList.remove('gm-armed');
    btn.textContent = text;
  };
  btn.addEventListener('click', (e) => {
    if (!grainUiModern()) return;
    if (btn.classList.contains('gm-armed')) { disarm(); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    text = btn.textContent;
    btn.textContent = `${text.trim()}?`;
    btn.classList.add('gm-armed');
    timer = setTimeout(disarm, 3000);
  }, true);
  btn.addEventListener('blur', disarm);
}

function setGrainUi(v) {
  const ui = setPref('grainUi', v);
  document.body.dataset.grainUi = ui;
  for (const b of document.querySelectorAll('#grainUiSwitch button')) {
    b.setAttribute('aria-pressed', String(b.dataset.ui === ui));
  }
  // Readings that are worded differently in Modern, told to write again.
  const env = state.grainRows?.envelope;
  const input = env?.querySelector(':scope > input[type=range]');
  if (env?.sync && input) env.sync(+input.value);
  gkPack();
}

function grainUiBuild() {
  const bar = $('presetBar');
  if (!bar || $('grainUiSwitch')) return;
  // The preset's own controls, named so Modern can show them only on the tabs
  // a preset changes: Time & Pitch and FX (a preset is the stretch and the rack).
  const first = bar.querySelector(':scope > .vsep');
  for (let el = first; el; el = el.nextElementSibling) el.classList.add('gm-preset');
  const withSound = bar.querySelector('label.preset-with-sound');
  if (withSound) {
    const text = [...withSound.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const words = text && gmWords(text.textContent, ' + sound & chain');
    if (words) text.replaceWith(...words);
  }
  bar.dataset.tab = document.querySelector('.dock-tab.active')?.dataset.dock || 'stretch';

  const sw = document.createElement('div');
  sw.id = 'grainUiSwitch';
  sw.className = 'gm-switch';
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', 'Grain view style');
  sw.title = 'Classic is the Grain view as it was; Modern is the redesign. Only this view changes.';
  for (const [ui, word] of [['classic', 'Classic'], ['modern', 'Modern']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.ui = ui;
    b.textContent = word;
    b.onclick = () => setGrainUi(ui);
    sw.appendChild(b);
  }
  bar.appendChild(sw);

  // Tuning, Play keys and Edit room are named in CSS (`::before`), not in the
  // buttons' markup: the switches row is measured by its first word
  // (`buttons.spec`), and a word Classic hides would be that word.
  for (const id of ['presetDelete', 'perfLaneDel', 'revertBtn']) gmArm($(id));
  setGrainUi(prefs.grainUi);
}
grainUiBuild();

/// The other panels of the Visual column — Shape, Ridgeline, Surfaces, Stage,
/// the type card — build their rows the same way: a tag, a slider and a
/// reading. Every such row becomes a knob cell, with the panel's own reading
/// under it and the tag in sentence case as its word. They are rebuilt often
/// (a module chosen, a look recalled), so they are watched rather than done
/// once.
const RK_PANELS = '#roomGeomBody, #ridgeEdit, #room3dEdit, #stageEdit, #textEdit';
function rkAdopt() {
  for (const panel of document.querySelectorAll(`#roomAdmin :is(${RK_PANELS})`)) {
    for (const row of panel.querySelectorAll('.re-row, .rp-row')) {
      const tag = row.querySelector(':scope > .re-tag');
      const sl = row.querySelectorAll(':scope > input.re-slider');
      if (!tag || sl.length !== 1 || sl[0].dataset.rk) continue;
      const read = row.querySelector(':scope > .rg-read');
      if (row.children.length !== (read ? 3 : 2)) continue;
      const words = tag.textContent.trim().toLowerCase();
      rkKnob(sl[0], words.charAt(0).toUpperCase() + words.slice(1), read);
      row.classList.add('rk-cell');
      row.parentElement.classList.add('rk-grid');
    }
  }
}
{
  const admin = $('roomAdmin');
  let queued = false;
  if (admin) {
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      // Not a frame: the automation browser never draws one (STATE.md §7).
      setTimeout(() => { queued = false; rkAdopt(); }, 0);
    }).observe(admin, { childList: true, subtree: true });
  }
  rkAdopt();
}

/// Put a look back: state, storage, renderer and every panel, in that order.
function applyVisual(v) {
  if (!v || typeof v !== 'object') return false;
  readRoomData(v.room);
  if (v.layers && typeof v.layers === 'object') {
    roomEdit.layers = {};
    for (const l of ROOM_LAYERS) {
      if (typeof v.layers[l.key] === 'boolean') roomEdit.layers[l.key] = v.layers[l.key];
    }
  }
  if (Array.isArray(v.order)) roomEdit.order = v.order.filter((k) => typeof k === 'string');
  if (v.occlude && typeof v.occlude === 'object') roomEdit.occlude = { ...v.occlude };
  if (v.streams === null || (v.streams && typeof v.streams === 'object')) {
    roomEdit.streams = v.streams ? { ...v.streams } : null;
  }
  if (v.cams && typeof v.cams === 'object') roomEdit.cams = JSON.parse(JSON.stringify(v.cams));
  if (v.paint && v.paint.slots && typeof v.paint.slots === 'object') {
    roomPaint.scheme = {
      name: typeof v.paint.name === 'string' ? v.paint.name : '',
      slots: JSON.parse(JSON.stringify(v.paint.slots)),
    };
    rpTouch();
  }
  saveRoomData();
  saveRoomLayers();
  saveRoomHierarchy();
  saveRoomStreams();
  saveRoomCameras();
  rpApply();
  refreshVisualPanels();
  return true;
}

/// Every panel that shows a room value, told the values changed.
///
/// The same list `enterRoomView` walks, because it is the same job: the room's
/// state has been set from somewhere other than its controls, and the controls
/// have to catch up. The two module renderers that hold a copy of their
/// settings are handed the new ones; the room itself reads `roomEdit` every
/// frame and needs no telling.
function refreshVisualPanels() {
  setVisModule(roomEdit.module);
  buildRoomLayers();
  syncRoomSliders();
  const r3 = visLive.room3d;
  if (r3 && r3.configure) r3.configure(room3dSettings());
  const st = visLive.stage;
  if (st && st.configure) st.configure(stageSettings());
  paintRoom3dPanel();
  paintStagePanel();
  paintRoomTextPanel();
  paintRidgePanel();
  rgPanel();
  rpPanel();
  applyRoomFrame();
  paintRoomNums();
  paintRoomData();
  paintSolidPath();
  solidPathPanel();
}

/// A picker rebuilt from the store: the blank first, then every name.
function paintSectionPicker(sel, kind, select) {
  if (!sel) return;
  const keep = select === undefined ? sel.value : select;
  sel.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— none —';
  sel.appendChild(blank);
  for (const p of SectionPresets.list(localStorage, kind)) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
}

function paintVisualPresets(select) {
  paintSectionPicker($('vpPick'), 'visual', select);
  // The Compose picture bar keeps a copy of this list, and repaints it itself.
  if (typeof composePresetsPainted === 'function') composePresetsPainted('visual', select);
}
function paintGrainPresets(select) {
  paintSectionPicker($('gpPick'), 'grain', select);
  // The compact grain panel keeps a copy of this list, and repaints it itself.
  if (typeof composePresetsPainted === 'function') composePresetsPainted('grain', select);
}

$('vpPick')?.addEventListener('change', () => {
  const name = $('vpPick').value;
  if (!name) return;
  const v = SectionPresets.get(localStorage, 'visual', name);
  if (!v) { toast('That look is gone'); paintVisualPresets(''); return; }
  applyVisual(v);
  toast(`Look: ${name}`);
});
$('vpSave')?.addEventListener('click', () => {
  const suggested = $('vpPick').value
    || `Look ${SectionPresets.list(localStorage, 'visual').length + 1}`;
  const name = prompt('Save this look as:', suggested);
  if (name === null) return;
  const stored = SectionPresets.save(localStorage, 'visual', name, visualSnapshot());
  if (!stored) { toast('A look needs a name'); return; }
  paintVisualPresets(stored);
  toast(`Saved “${stored}”`);
});
$('vpDelete')?.addEventListener('click', () => {
  const name = $('vpPick').value;
  if (!name) { toast('Pick a look first'); return; }
  if (!confirm(`Delete the look “${name}”? The room is left as it is.`)) return;
  SectionPresets.remove(localStorage, 'visual', name);
  paintVisualPresets('');
  toast(`Deleted “${name}”`);
});
paintVisualPresets('');

// ── the cloud ──

/// The grain section and nothing else. The seed stays with the document — it
/// has no control of its own, and a preset that carried one would replay the
/// same accident into every sound it was recalled on.
function grainSnapshot() {
  const out = {};
  const g = state.grainDraft || state.edit?.stretch?.grain || {};
  for (const k of Object.keys(GRAIN_DEFAULTS)) if (g[k] !== undefined) out[k] = g[k];
  return out;
}

/// Put a cloud back, over the defaults, with the document's own seed.
///
/// Through `editOp` like every other change, so it lands on the undo stack and
/// the server clamps it the way it clamps a slider. A value of the wrong kind
/// — a string where a number goes — is left at its default rather than sent.
async function applyGrain(v) {
  if (!state.selectedFile) { toast('Open a sound first'); return false; }
  if (!v || typeof v !== 'object') return false;
  const grain = {
    ...GRAIN_DEFAULTS,
    seed: state.grainDraft?.seed ?? state.edit?.stretch?.grain?.seed ?? 1,
  };
  for (const k of Object.keys(GRAIN_DEFAULTS)) {
    if (typeof v[k] === typeof GRAIN_DEFAULTS[k]) grain[k] = v[k];
  }
  state.grainDraft = { ...grain };
  await editOp({ op: 'stretch', ...state.stretchDraft, grain });
  // The panel is built once per file and engine; a recalled cloud is neither,
  // so it is rebuilt the way Reset rebuilds it.
  grainBuiltFor = null;
  renderGrainParams();
  syncGrainSliders();
  return true;
}

$('gpPick')?.addEventListener('change', async () => {
  const name = $('gpPick').value;
  if (!name) return;
  const v = SectionPresets.get(localStorage, 'grain', name);
  if (!v) { toast('That cloud is gone'); paintGrainPresets(''); return; }
  if (await applyGrain(v)) toast(`Cloud: ${name}`);
});
$('gpSave')?.addEventListener('click', () => {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const suggested = $('gpPick').value
    || `Cloud ${SectionPresets.list(localStorage, 'grain').length + 1}`;
  const name = prompt('Save this cloud as:', suggested);
  if (name === null) return;
  const stored = SectionPresets.save(localStorage, 'grain', name, grainSnapshot());
  if (!stored) { toast('A cloud needs a name'); return; }
  paintGrainPresets(stored);
  toast(`Saved “${stored}”`);
});
$('gpDelete')?.addEventListener('click', () => {
  const name = $('gpPick').value;
  if (!name) { toast('Pick a cloud first'); return; }
  if (!confirm(`Delete the cloud “${name}”? The sound is left as it is.`)) return;
  SectionPresets.remove(localStorage, 'grain', name);
  paintGrainPresets('');
  toast(`Deleted “${name}”`);
});
paintGrainPresets('');

