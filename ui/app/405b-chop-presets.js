// ═══════════════════════════════════════════════ Chop: its presets ══
//
// The shared preset bar (`105-preset-bar.js`) in Chop's top row, with A/B, and
// Dice and Take beside it. The presets stay in the browser, as they were
// (`localStorage.chopPresets`, `cp` only, sorted by name); A and B stay the two
// slots kept with them (`chopSlots`).

/// What a preset cuts by, for the tag: "Grid · 1/16", "Transient".
function chopPresetTag(v) {
  const c = { ...CHOP_DEF, ...v };
  if (c.mode !== 'grid') return c.mode[0].toUpperCase() + c.mode.slice(1);
  return `Grid · ${c.div === 'bar' ? '1 bar' : `1/${c.div}`}`;
}

function chopStorePresets(list) {
  list.sort((a, b) => a.name.localeCompare(b.name));
  try { localStorage.setItem('chopPresets', JSON.stringify(list)); } catch { /* private mode */ }
}

function chopKeepPreset(name) {
  chopStorePresets(chopPresets().filter((p) => p.name !== name).concat({ name, cp: { ...cp } }));
  chopPresetName = name;
}

const CHOP_PRESETS = {
  list: () => chopPresets().map((p) => ({ name: p.name, tag: chopPresetTag(p.cp) })),
  current: () => chopPresetName,
  tag: () => chopPresetTag(cp),
  snapshot: () => cp,
  load: (p) => {
    const got = chopPresets().find((x) => x.name === p.name);
    if (!got) throw new Error('That preset is gone');
    chopPresetName = got.name;
    chopApply(got.cp);
  },
  save: chopKeepPreset,
  saveAs: chopKeepPreset,
  rename: (from, to) => {
    chopStorePresets(chopPresets().map((p) => (p.name === from ? { ...p, name: to } : p)));
    if (chopPresetName === from) chopPresetName = to;
  },
  remove: (name) => {
    chopStorePresets(chopPresets().filter((p) => p.name !== name));
    if (chopPresetName === name) chopPresetName = '';
  },
  init: () => {
    chopPresetName = '';
    chopApply({});
    chopDetect();
  },
};

function chopSwitchAB(k) {
  chopSlots.which = k === 'B' ? 'b' : 'a';
  cp = chopSlots[chopSlots.which];
  chopSaveSettings();
  chopReflect();
  chopRecut();
}

function chopPresetBar() {
  const dice = pbarButton('M2 2H10V10H2Z', 'Dice', 'Roll the dice: new settings for the cutting and the sound');
  dice.querySelector('svg').insertAdjacentHTML('beforeend', '<circle cx="4.4" cy="4.4" r=".75"/><circle cx="7.6" cy="7.6" r=".75"/><circle cx="6" cy="6" r=".75"/>');
  const take = pbarButton('<svg class="pbar-i pbar-take" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4"/><circle cx="6" cy="6" r="1.6"/></svg>', 'Take', 'Capture: chop the newest take in Recordings');
  dice.id = 'chopDice';
  take.id = 'chopCapture';
  dice.addEventListener('click', chopDice);
  take.addEventListener('click', chopCapture);
  chopPb = pbarMake({ id: 'chop', adapter: CHOP_PRESETS, title: 'Chop presets', ab: { get: () => chopSlots.which.toUpperCase(), set: chopSwitchAB }, extras: [dice, take] });
  $('chopPbHost').replaceWith(chopPb.el);
}
