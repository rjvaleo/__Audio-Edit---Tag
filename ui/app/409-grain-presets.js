// ================================================================ Grain: its presets
//
// The page's two preset bars, both the shared one (`105-preset-bar.js`): the
// sound's, with A/B, Randomize and Undo; and CLOUD's small one, for the grain
// controls only. Storage stays where it was: the sound's presets on the server
// (`/api/presets`, `110-presets.js`), the clouds in the browser
// (`SectionPresets`, kind `grain`, `200-grain-view.js`). The tray's own
// `#presetPick` and `#gpPick` still say which one is loaded, so whatever else
// reads them still can.

const gsEngName = (a) => (GS_ENG.find((x) => x[0] === a) || ['', a || ''])[1];
const gsPresetTag = (p) => [p.note, gsEngName(p.stretch?.algorithm)].filter(Boolean).join(' · ');
const gsPresetOf = (name) => state.presets.find((p) => p.name === name);

/// Load one through the tray's own handler: it applies, rebuilds and says what it did.
async function gsApplyPreset(name) {
  const pick = $('presetPick');
  pick.value = name;
  await pick.onchange({ target: pick });
  GS.touched = true;
}

/// Keep these settings under `name` (over it, if it is there), with its note.
async function gsPresetPost(name) {
  if (!state.selectedFile) throw new Error('Open a sound first');
  const r = await postJSON('/api/presets', { name, note: gsPresetOf(name)?.note || '', p: state.selectedFile.path });
  state.presets = r.presets || [];
  renderPresets();
  $('presetPick').value = name;
  toast(`Saved “${name}”`);
}

const GS_PRESETS = {
  list: () => state.presets.map((p) => ({ name: p.name, tag: gsPresetTag(p) })),
  refresh: loadPresets,
  current: () => $('presetPick').value,
  tag: () => { const p = gsPresetOf($('presetPick').value); return p ? gsPresetTag(p) : gsEngName(GS.engine); },
  snapshot: () => (state.stretchDraft ? { s: state.stretchDraft, g: state.grainDraft, r: state.rack ? { slots: state.rack.slots, master: state.rack.master } : null } : null),
  load: (p) => gsApplyPreset(p.name),
  save: gsPresetPost,
  saveAs: gsPresetPost,
  /// The manager's rename, from the bar: the stored values go across as they are.
  rename: async (from, to) => {
    const p = gsPresetOf(from);
    const r = await postJSON('/api/presets/update', { name: from, to, note: p?.note || '', stretch: p?.stretch, rack: p?.rack });
    const was = $('presetPick').value;
    state.presets = r.presets || [];
    renderPresets();
    $('presetPick').value = was === from ? to : was;
    toast(`Renamed “${from}” to “${to}”`);
  },
  remove: async (name) => {
    const r = await postJSON('/api/presets/delete', { name });
    state.presets = r.presets || [];
    $('presetPick').value = '';
    renderPresets();
    toast(`Deleted “${name}”`);
  },
  /// Every engine's controls and the cloud back to where they start; the engine
  /// you are in, the seed and the rack stay.
  init: async () => {
    if (!state.selectedFile) throw new Error('Open a sound first');
    $('presetPick').value = '';
    GS.touched = true;
    await resetEverything();
    toast('Init: every engine back to its defaults');
  },
  listExtras: (foot) => {
    const sound = pbarH('<label title="With sound: loading a preset opens the sound it was made on"><input type="checkbox" id="gsPresetSound"> with sound</label>');
    const box = sound.querySelector('input');
    box.checked = !!$('presetWithSound')?.checked;
    box.onchange = () => { $('presetWithSound').checked = box.checked; };
    const manage = pbarButton('', 'Manage…', 'The preset manager: every stored value, and the note');
    manage.id = 'gsPresetManage';
    manage.onclick = () => { pbarClose(); $('presetManage').click(); };
    foot.append(sound, manage);
  },
};

/// CLOUD: the grain controls only, kept in the browser.
const GS_CLOUDS = {
  list: () => SectionPresets.list(localStorage, 'grain').map((p) => ({ name: p.name })),
  current: () => $('gpPick')?.value || '',
  snapshot: () => grainSnapshot(),
  load: async (p) => {
    const v = SectionPresets.get(localStorage, 'grain', p.name);
    if (!v) { paintGrainPresets(''); throw new Error('That cloud is gone'); }
    if (await applyGrain(v)) { paintGrainPresets(p.name); GS.touched = true; toast(`Cloud: ${p.name}`); }
  },
  saveAs: (name) => {
    if (!state.selectedFile) throw new Error('Open a sound first');
    const stored = SectionPresets.save(localStorage, 'grain', name, grainSnapshot());
    if (!stored) throw new Error('A cloud needs a name');
    paintGrainPresets(stored);
    toast(`Saved “${stored}”`);
  },
  rename: (from, to) => {
    const v = SectionPresets.get(localStorage, 'grain', from);
    if (!v || !SectionPresets.save(localStorage, 'grain', to, v)) throw new Error('Could not rename it');
    SectionPresets.remove(localStorage, 'grain', from);
    paintGrainPresets($('gpPick').value === from ? to : $('gpPick').value);
  },
  remove: (name) => {
    SectionPresets.remove(localStorage, 'grain', name);
    paintGrainPresets('');
    toast(`Deleted “${name}”`);
  },
  init: async () => {
    if (await applyGrain(GRAIN_DEFAULTS)) { paintGrainPresets(''); GS.touched = true; }
  },
};

const GS_DICE = '<svg class="pbar-i" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5H10.5V10.5H1.5Z"/><circle cx="4" cy="4" r=".7"/><circle cx="8" cy="4" r=".7"/><circle cx="6" cy="6" r=".7"/><circle cx="4" cy="8" r=".7"/><circle cx="8" cy="8" r=".7"/></svg>';

/// Both bars, in place of their hosts in the page's top row.
function gsPresetBars() {
  const rnd = pbarButton(GS_DICE, 'Randomize', 'Throw every control in the tray somewhere at random. The engine stays where it is, and the seed is reported so a good accident can be found again. ⇧-click: nudge each a little instead');
  const undo = pbarButton('', 'Undo', 'Undo the last randomize');
  rnd.id = 'gsRndBtn';
  undo.id = 'gsRndUndo';
  undo.insertAdjacentHTML('afterbegin', '<span class="pbar-u">↶</span>');
  undo.hidden = true;
  rnd.onclick = (e) => gsRandomize(e.shiftKey);
  undo.onclick = gsRandomizeUndo;
  GS.pb = pbarMake({ id: 'gs', adapter: GS_PRESETS, title: 'Presets', ab: { get: () => GS.ab, set: gsSwitchAB }, extras: [rnd, undo] });
  $('gsPbHost').replaceWith(GS.pb.el);
  GS.cpb = pbarMake({ id: 'gsCp', adapter: GS_CLOUDS, size: 'mini', title: 'Cloud presets: the grain controls only', nouns: ['cloud', 'clouds'] });
  $('gsCpHost').replaceWith(GS.cpb.el);
}
