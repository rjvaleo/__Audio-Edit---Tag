// ================================================================ Wave: its presets
//
// The page's two preset bars, both the shared one (`105-preset-bar.js`): the
// patch's, in the header, with A/B; and the FX board's, on the FX view, with
// Duplicate. Storage stays on the engine, through the routes it already had:
// `/api/wave/presets` for patches (remove means unlist; the file stays) and
// `/api/wave/boards` for boards (the factory four first). The eight patches
// the mock-up offered are the patch list's factory set.

/// A request to the engine that says why it failed.
async function wvAsk(path, method, body) {
  if (!WV.connected) throw new Error('The synth engine is not connected');
  const r = await wvBoardFetch(path, method, body);
  if (!r.ok) throw new Error((r.json && r.json.error) || 'The synth engine did not answer');
  return r.json;
}

const wvTagList = (t) => String(t || '').split('·').map((x) => x.trim()).filter(Boolean);

// ─────────────────────────────────────────────────────────────── patches

const WV_PATCHES = {
  list: () => WV_PRESETS_OFFLINE.map((p) => ({ name: p.name, tag: wvPresetTags(p), factory: true, p }))
    .concat((WV.presets || []).map((p) => ({ name: p.name, tag: wvPresetTags(p), p }))),
  refresh: wvLoadPresets,
  current: () => (WV_PATCHES.list().some((p) => p.name === WV.name) ? WV.name : ''),
  label: () => WV.name,
  tag: () => WV.tags,
  snapshot: () => wvPatchBody(),
  load: (it) => wvApplyPreset(it.p),
  save: (name) => WV_PATCHES.saveAs(name),
  saveAs: async (name) => {
    await wvAsk('/api/wave/presets', 'POST', { name, tags: wvTagList(WV.tags), patch: wvPatchBody() });
    WV.name = name;
    await wvPost('/api/wave/patch', wvPatchBody());
    await wvLoadPresets();
    wvSyncAll();
  },
  /// The stored patch under its new name, then the old one unlisted.
  rename: async (from, to) => {
    const held = (WV.presets || []).find((p) => p.name === from);
    if (!held) throw new Error('That patch is gone');
    await wvAsk('/api/wave/presets', 'POST', { name: to, tags: held.tags, patch: { ...held.patch, name: to } });
    await wvAsk('/api/wave/presets', 'POST', { name: from, remove: true });
    if (WV.name === from) { WV.name = to; await wvPost('/api/wave/patch', wvPatchBody()); }
    await wvLoadPresets();
    wvSyncAll();
  },
  remove: async (name) => {
    await wvAsk('/api/wave/presets', 'POST', { name, remove: true });
    await wvLoadPresets();
    wvSyncAll();
  },
  /// The engine's own default patch, on an empty board.
  init: async () => {
    WV.board = wvInitBoard();
    const j = await wvAsk('/api/wave/patch', 'POST', { name: 'Init', board: wvBoardOut() });
    wvAdopt(j);
    WV.tags = '';
    Object.assign(WV_BOARDS, { at: -1, fresh: true, dirty: false });
    await Promise.all([0, 1, 2].map((i) => wvFetchTable(wvG(`osc${i}.table`))));
    if (WV.built) wvRenderBoard();
    wvSyncAll();
  },
};

// ─────────────────────────────────────────────────────────────── boards

const wvBoardAt = () => (WV_BOARDS.fresh ? -1 : WV_BOARDS.at);

const WV_BOARD_PRESETS = {
  list: () => WV_BOARDS.list.map((b, i) => ({ name: b.name, tag: `${(b.nodes || []).filter((n) => !wvIsIO(n)).length} nodes`, factory: !wvBoardRemovable(i) })),
  current: () => WV_BOARDS.list[wvBoardAt()]?.name || '',
  label: () => WV.board?.name || '',
  tag: () => (WV_BOARDS.fresh ? 'new' : wvBoardAt() >= 0 ? `${wvBoardAt() + 1} / ${WV_BOARDS.list.length}` : ''),
  dirty: () => WV_BOARDS.dirty,
  load: (it) => wvLoadBoard(WV_BOARDS.list.findIndex((b) => b.name === it.name)),
  save: (name) => wvSaveBoard(name),
  saveAs: (name) => wvSaveBoard(name),
  /// The stored board under its new name, then the old one unlisted.
  rename: async (from, to) => {
    const held = WV_BOARDS.list.find((b) => b.name === from);
    if (!held) throw new Error('That board is gone');
    await wvAsk('/api/wave/boards', 'POST', { name: to, board: { name: to, nodes: held.nodes, cables: held.cables }, mods: held.mods || [] });
    await wvAsk(`/api/wave/boards?name=${encodeURIComponent(from)}`, 'DELETE');
    const l = await wvBoardFetch('/api/wave/boards');
    if (l.ok && Array.isArray(l.json)) WV_BOARDS.list = l.json.filter((b) => b && Array.isArray(b.nodes));
    if (WV.board.name === from) {
      WV.board.name = to;
      await wvBoardFetch('/api/wave/board', 'POST', wvBoardOut());
    }
    WV_BOARDS.at = WV_BOARDS.list.findIndex((b) => b.name === WV.board.name);
    wvRenderBar();
    wvBoardNote(`Renamed “${from}” to “${to}”`);
  },
  remove: () => wvRemoveBoard(),
  init: () => wvInitBoardNow(),
};

/// Both bars, in place of their hosts: the patch's in the header, the board's
/// on the FX view.
function wvPresetBars() {
  WV.pb = pbarMake({ id: 'wv', adapter: WV_PATCHES, title: 'Patches', nouns: ['patch', 'patches'], ab: { get: () => WV.ab, set: wvSwitchAB },
    deleteNote: 'It comes off the list; the engine keeps its file. The patch playing stays as it is.' });
  $('wvPbHost').replaceWith(WV.pb.el);
  const dup = pbarButton(PBAR_ICON.dup, 'Duplicate', 'Duplicate: save a copy of this board straight away');
  dup.id = 'wvBdup';
  dup.addEventListener('click', async () => { await wvSaveBoard(wvUniqBoard(WV.board.name + ' copy')); WV.bpb.settle(); });
  WV.bpb = pbarMake({ id: 'wvB', adapter: WV_BOARD_PRESETS, title: 'Boards', nouns: ['board', 'boards'], extras: [dup],
    deleteNote: 'It comes off the list; the engine keeps its file. The board stays here until you load another.' });
  $('wvBpbHost').replaceWith(WV.bpb.el);
}
