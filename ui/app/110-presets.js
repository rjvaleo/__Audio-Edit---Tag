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

