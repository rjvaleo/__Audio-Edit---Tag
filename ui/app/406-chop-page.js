// ═══════════════════════════════════════════════ Chop: the page ══
//
// Wiring, the transport and file tabs it borrows, the Looks, and fitting it to
// the window. Fixed at 1432×1000 and scaled whole, as Wave is: the same page
// smaller, never a cropped one.

const CHOP_W = 1432, CHOP_H = 1000;

/// The file tabs and the transport are the app's own, moved in while this page
/// is showing and put back after: one set of controls, not a second one.
const CHOP_BORROW = [['tabBar', 'chopTabs'], ['playBtn', 'chopTransport'], ['stopBtn', 'chopTransport'], ['loopBtn', 'chopTransport'],
  ['recBtn', 'chopTransport'], ['srcGrain', 'chopTransport'], ['srcSeq', 'chopTransport'], ['timeNow', 'chopClock'], ['volume', 'chopLevel']];
const chopHomes = new Map();
function chopBorrow(on) {
  if (on) {
    for (const [id, host] of CHOP_BORROW) {
      const el = $(id);
      if (!el || chopHomes.has(id)) continue;
      chopHomes.set(id, { parent: el.parentNode, next: el.nextSibling });
      $(host).append(el);
    }
  } else {
    for (const [id] of [...CHOP_BORROW].reverse()) {
      const home = chopHomes.get(id);
      if (!home) continue;
      home.parent.insertBefore($(id), home.next);
      chopHomes.delete(id);
    }
  }
}

/// Scale the page whole to fit the centre, set against its left edge, beside
/// the rail (RJ, 9 Nov 2026).
function chopFit() {
  const host = $('dockChop'), app = host.querySelector('.chop-app');
  const cw = host.clientWidth, ch = host.clientHeight;
  if (!cw || !ch) return;
  const s = Math.min(cw / CHOP_W, ch / CHOP_H, 1.3);
  app.style.transform = `scale(${s})`;
}

// ───────────────────────────────────────────────────────────── the Looks

/// Grain's five. One setting for the whole app: Grain reads this same key.
const CHOP_LOOKS = [['AD', 'Graphite + Acrylic', 'linear-gradient(135deg,#262a30 50%,#d7e2ff 50%)', 'Graphite panels, a white trace and an acrylic edge'],
  ['A', 'Graphite', '#3a3f47', 'Graphite panels and a soft green-white trace'],
  ['B', 'Glass', 'linear-gradient(135deg,#3c8caa,#825aaa)', 'See-through panels over slow colour'],
  ['C', 'Ceramic', '#e8dcc8', 'Warm matte panels, round buttons, dotted knobs'],
  ['D', 'Acrylic', 'conic-gradient(#3b4060,#2c5d5f,#5e4c3d,#4a3b5e,#3b4060)', 'Dark panels with a coloured edge']];

function chopSetLook(k) {
  document.querySelector('.chop-app').dataset.look = k;
  document.querySelectorAll('#chopLook button').forEach((b) => b.classList.toggle('on', b.dataset.s === k));
  try { localStorage.setItem('mglLook', k); } catch { /* private mode */ }
  chopReadLook();
  if (chop.mono) { chopReflect(); chopPaintLane(); }
  chopDrawOut();
}

(() => {
  chopLoadSettings();
  chopBuildKnobs();
  $('chopLook').innerHTML = CHOP_LOOKS.map(([k, n, bg, t]) => `<button type="button" data-s="${k}" title="${t}"><i style="background:${bg}"></i>${n}</button>`).join('');
  $('chopLook').addEventListener('click', (e) => { const b = e.target.closest('button[data-s]'); if (b) chopSetLook(b.dataset.s); });
  $('chopColour').innerHTML = CHOP_VIEWS.map(([v, n, t, st]) => `<button type="button" data-v="${v}" title="${t}"><i class="vs" style="background:linear-gradient(90deg,${st.map(chopRgb).join(',')})"></i>${n}</button>`).join('');
  $('chopColour').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    chopColour = b.dataset.v;
    try { localStorage.setItem('chopColour', chopColour); } catch { /* private mode */ }
    chopLegend();
    chopPaintLane();
  });
  $('chopZoomIn').onclick = () => chopZoom(0.6, (chopView.a + chopView.b) / 2);
  $('chopZoomOut').onclick = () => chopZoom(1 / 0.6, (chopView.a + chopView.b) / 2);
  $('chopZoomFit').onclick = chopFit0;
  $('chopFollow').onclick = () => { chopView.follow = !chopView.follow; $('chopFollow').classList.toggle('on', chopView.follow); };
  $('chopFollowMode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    chopView.mode = b.dataset.v;
    document.querySelectorAll('#chopFollowMode button').forEach((x) => x.classList.toggle('on', x === b));
  });
  // Drag the white window on the overview; double-click for the whole sound.
  const over = $('chopOverview');
  const overTo = (e) => {
    const r = over.getBoundingClientRect(), L = chopView.b - chopView.a;
    chopView.a = Math.max(0, Math.min(chop.len - L, (e.clientX - r.left) / r.width * chop.len - L / 2));
    chopView.b = chopView.a + L;
    chopPaintLane();
  };
  over.addEventListener('pointerdown', (e) => { if (!chop.mono || e.button) return; over.setPointerCapture(e.pointerId); overTo(e); over.onpointermove = overTo; });
  over.addEventListener('pointerup', () => { over.onpointermove = null; });
  over.addEventListener('dblclick', () => { if (chop.mono) chopFit0(); });
  new ResizeObserver(chopFit).observe($('dockChop'));
  new MutationObserver(() => {
    const here = document.body.classList.contains('choppage');
    chopBorrow(here);
    if (here) { chopFit(); chopPaintLane(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const pills = (id, key) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) chopSetting(key, b.dataset.v);
  });
  pills('chopMode', 'mode');
  pills('chopDiv', 'div');
  pills('chopFeel', 'feel');
  pills('chopSync', 'sync');
  $('chopTools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    chop.tool = b.dataset.v;
    $('chopLane').classList.toggle('chop-pencil', chop.tool === 'pencil');
    chopReflect();
  });
  $('chopRev').addEventListener('click', () => chopToggle('rev'));
  $('chopMute').addEventListener('click', () => chopToggle('muted'));
  $('chopPreview').addEventListener('click', () => {
    if (chop.playing?.kind === 'preview') { chopStop(); return; }
    if (!chop.mono) return;
    const { chs, map } = chopRenderPreview();
    chopPlayRendered(chs, { kind: 'preview', map });
  });
  $('chopRatchet').addEventListener('click', () => {
    if (chop.playing?.kind === 'ratchet') { chopStop(); return; }
    if (!chop.mono) return;
    const { chs, map } = chopRenderRatchet();
    chopPlayRendered(chs, { kind: 'ratchet', loop: true, map });
  });
  $('chopA').addEventListener('click', () => { chopSlots.which = 'a'; cp = chopSlots.a; chopSaveSettings(); chopReflect(); chopRecut(); });
  $('chopB').addEventListener('click', () => { chopSlots.which = 'b'; cp = chopSlots.b; chopSaveSettings(); chopReflect(); chopRecut(); });
  $('chopPreset').addEventListener('change', () => {
    const p = chopPresets().find((x) => x.name === $('chopPreset').value);
    if (p) chopApply(p.cp);
  });
  $('chopPrevPreset').addEventListener('click', () => chopStepPreset(-1));
  $('chopNextPreset').addEventListener('click', () => chopStepPreset(1));
  $('chopSave').addEventListener('click', () => {
    const name = prompt('Preset name:', $('chopPreset').value || `Chop ${chopPresets().length + 1}`);
    if (!name) return;
    const list = chopPresets().filter((p) => p.name !== name);
    list.push({ name, cp: { ...cp } });
    list.sort((a, b) => a.name.localeCompare(b.name));
    try { localStorage.setItem('chopPresets', JSON.stringify(list)); } catch { /* private mode */ }
    chopFillPresets(name);
  });
  $('chopInit').addEventListener('click', () => { $('chopPreset').value = ''; chopApply({}); chopDetect(); });
  $('chopDice').addEventListener('click', chopDice);
  $('chopCapture').addEventListener('click', chopCapture);
  $('chopRedetect').addEventListener('click', () => chopRecut());
  $('chopToRegions').addEventListener('click', chopToRegions);
  $('chopOutMidi').addEventListener('click', () => chopSetting('outMidi', !cp.outMidi));
  $('chopOutSfz').addEventListener('click', () => chopSetting('outSfz', !cp.outSfz));
  $('chopWrite').addEventListener('click', chopWriteAll);
  chopFillPresets();
  chopWireLane();
  let look = 'AD';
  try { look = localStorage.getItem('mglLook') || 'AD'; } catch { /* private mode */ }
  chopSetLook(look);
  chopSay('');
  chopReflect();
})();

/// For the tests, and anything else that wants Recycle Reborn's arithmetic.
window.Chop = {
  buildRms: chopBuildRms,
  detectSegs: chopDetectSegs,
  getTailParams: chopGetTailParams,
  buildPingPongTail: chopBuildPingPongTail,
  /// Chop these samples as if they were the selected sound.
  loadSamples: (channels, rate, stem) => { chop.loading++; chopTake(channels, rate, stem); },
  /// Settings, as the knobs and pills set them.
  set: (values) => { for (const [k, v] of Object.entries(values)) chopSetting(k, v); },
  init: () => chopApply({}),
  setRegion: (s, e) => { chop.region = { s, e }; chopRecut(); },
  addCut: chopAddCut,
  deleteCut: chopDeleteCut,
  moveEdge: (i, side, to) => { chopMoveEdge(i, side, to); chopChanged(); },
  pick: chopPick,
  toggle: chopToggle,
  bpm: chopBpm,
  playBpm: chopPlayBpm,
  sliceAudio: chopSliceAudio,
  renderPreview: chopRenderPreview,
  renderRatchet: chopRenderRatchet,
  midi: chopMidi,
  sfz: chopSfz,
  repaint: chopPaintLane,
  detect: chopDetect,
  findTempo: chopFindTempo,
  /// Resolves once the sound has been measured.
  analysed: () => chopAnalysing,
  setLook: chopSetLook,
  setColour: (v) => { chopColour = v; chopLegend(); chopPaintLane(); },
  toRegions: chopToRegions,
  stop: chopStop,
};

// Read as properties, so a test can say `Chop.slices`.
for (const [name, read] of Object.entries({
  settings: () => ({ ...cp }),
  slices: () => chop.slices.map((x) => ({ ...x })),
  region: () => ({ ...chop.region }),
  kinds: () => chop.slices.map((x) => x.m?.kind || ''),
  look: () => document.querySelector('.chop-app').dataset.look,
  view: () => ({ ...chopView }),
  soft: () => ({ ...chopSoft }),
  playing: () => chop.playing?.kind || '',
  state: () => ({ path: chop.path, slices: chop.slices.length, current: chop.current }),
})) Object.defineProperty(window.Chop, name, { get: read });
