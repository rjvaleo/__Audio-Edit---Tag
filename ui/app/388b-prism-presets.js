// ================================================================ Prism: its presets
//
// The shared preset bar (`105-preset-bar.js`) in Prism's head row, for the
// process on the pad: Hyperprism's factory set for it, then yours. Storage stays
// on the server (`/api/pad/presets`, `padpresets.rs`); the lists and what is
// loaded are `prism-pad.js`'s. Init is the process's Default Settings. Loading
// one leaves the pad where it is, as Hyperprism did.

const prismPresetFrom = (at) => (at[0] === 'f' ? prismPresets.factory : at[0] === 'u' ? prismPresets.user : [])[+at.slice(1)];

const PRISM_PRESETS = {
  list: () => prismPresets.factory.map((p, i) => ({ name: p.name, factory: true, at: `f${i}` }))
    .concat(prismPresets.user.map((p, i) => ({ name: p.name, at: `u${i}` }))),
  refresh: prismLoadPresets,
  /// By position, not name: a preset of yours may share a factory one's name.
  current: () => prismPresetFrom(prismPresetAt)?.name || '',
  label: () => (prismPresetAt === 'default' ? 'Default Settings' : prismPresetFrom(prismPresetAt)?.name || ''),
  tag: () => (prismPresetAt[0] === 'f' ? '' : prismCurrent()?.label || ''),
  snapshot: () => { const src = prismCurrent(); return src ? { pad: prismSetup(), settings: prismSettingsNow(), post: prismDeck.rack.postRoll?.[src.id] ?? 0 } : null; },
  load: async (it) => { await prismPresetChosen(it.at); hsSetupChanged(); },
  save: prismPresetSave,
  saveAs: prismPresetSave,
  rename: prismPresetRename,
  remove: prismPresetDelete,
  init: async () => { await prismPresetChosen('default'); hsSetupChanged(); },
};

function prismPresetBar() {
  hs.pb = pbarMake({ id: 'prism', adapter: PRISM_PRESETS, title: 'Presets for this process' });
  $('prismPbHost').replaceWith(hs.pb.el);
}
