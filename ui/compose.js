// ─── COMPOSE ──────────────────────────────────────────────────────────────────
//
// The workspace in which the whole piece is made at once — the granular player,
// the sequencer and the picture side by side, over one timeline. The plan is
// `docs/COMPOSE-PLAN.md`; what is built is written up in `docs/COMPOSE.md`.
//
// The file is in two parts: the compact panels, then the view that places them.
//
// The compact panels come first. They are the plan's fifth phase and
// were built first, so that the view places panels made for its cells rather
// than full panels squeezed into them:
//
//   - **the grain panel** — the engine, the cloud pad, eight macro knobs and
//     the CLOUD preset. Every control writes the same draft and calls the same
//     send the full panel does, and each panel keeps the other in step.
//   - **the sequencer** — its own compact layout, inside its own page, switched
//     on by `seq:compact` (see `ui/sequencer/style.css`). The host's side of it
//     is `seqCompact` in `app.js`, which also says it again when the frame
//     reloads.
//   - **the picture bar** — VIEW, LOOK and the camera's set views, over the
//     room.
//
// Loaded after `app.js`, whose state and functions every line here uses.

// ─── the grain panel ─────────────────────────────────────────────────────────

/// The eight macros: the controls most often automated, as knobs.
///
/// The ranges, steps, formats and defaults are the full panel's own, so a value
/// reads the same in both places and a double-click resets to the same number.
/// `stretch` marks the three that live on the stretch draft; the rest are the
/// grain draft's. The full names are in the titles — a knob has room for one
/// word.
const CG_MACROS = [
  { key: 'ratio', label: 'Stretch', title: 'Stretch — how much longer the result is than the source',
    min: 0.01, max: 100, step: 0.01, log: true, def: 1, stretch: true,
    fmt: (v) => (v >= 10 ? `${v.toFixed(0)}×` : v >= 1 ? `${v.toFixed(2)}×` : `${v.toFixed(3)}×`) },
  { key: 'semitones', label: 'Pitch', title: 'Pitch — the shift, in the tuning chosen in the full panel',
    min: -48, max: 48, step: () => scaleStep(), def: 0, stretch: true,
    fmt: (v) => scaleLabel(v) },
  { key: 'windowMs', label: 'Window', title: 'Window — the length of one piece the engine works with',
    min: 5, max: 2000, step: 1, log: true, def: 40, stretch: true,
    fmt: (v) => `${Math.round(v)} ms` },
  { key: 'position', label: 'Position', title: 'Position — where in the source the cloud reads from',
    min: -1, max: 1, step: 0.001, def: 0,
    fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'rateHz', label: 'Rate', title: 'Rate — grains per second, for the cloud alone',
    min: 0, max: 500, step: 1, def: 0,
    fmt: (v) => (v <= 0 ? 'off' : `${Math.round(v)}/s`) },
  { key: 'positionJitterMs', label: 'Scatter', title: 'Position jitter — how far each grain is thrown from where it should read',
    min: 0, max: 500, step: 1, def: 0,
    fmt: (v) => `${Math.round(v)} ms` },
  { key: 'pitchJitterSemis', label: 'Jitter', title: 'Pitch jitter — a fresh random shift for every grain',
    min: 0, max: 24, step: 0.1, def: 0,
    fmt: (v) => `±${v.toFixed(1)} st` },
  { key: 'pitchDriftSemis', label: 'Drift', title: 'Pitch drift — a slow wander shared by the whole cloud',
    min: 0, max: 24, step: 0.1, def: 0,
    fmt: (v) => `±${v.toFixed(1)} st` },
];

/// The engines, with a name short enough for a fifth of a cell.
const CG_ENGINES = [
  ['wsola', 'WSOLA'], ['vocoder', 'VOC'], ['pvsola', 'PVSOLA'], ['hybrid', 'HYB'], ['granular', 'GRAIN'],
];

/// What a macro is set to, from the draft the full panel edits.
function cgRead(m) {
  if (m.stretch) return state.stretchDraft?.[m.key] ?? state.edit?.stretch?.[m.key] ?? m.def;
  const g = state.grainDraft || state.edit?.stretch?.grain || {};
  return g[m.key] ?? GRAIN_DEFAULTS[m.key] ?? m.def;
}

/// Set a macro: the draft, the full panel's control for it, and the send.
///
/// The same two senders the full panel uses — `previewStretch`/`commitStretch`
/// for the stretch's own three, the grain send for the rest — so the server
/// sees exactly the message it would from the full panel, and a move made here
/// is recorded into its lane the same way.
function cgWrite(m, v, { commit }) {
  if (m.stretch) {
    if (!state.stretchDraft) return;
    state.stretchDraft[m.key] = v;
    state.stretchRows?.[m.key]?.sync(v);
    showStretchOut();
    if (commit) commitStretch(); else previewStretch();
    return;
  }
  if (!state.grainDraft) return;
  state.grainDraft[m.key] = v;
  state.grainRows?.[m.key]?.sync(v);
  drawCloudPads();
  if (commit) state.grainSend?.commit(); else state.grainSend?.preview();
}

function cgKnob(m) {
  const step = typeof m.step === 'function' ? m.step() : m.step;
  const el = knob(m.label, cgRead(m), m.min, m.max, step, m.fmt,
    (v) => cgWrite(m, v, { commit: false }),
    (v) => cgWrite(m, v, { commit: true }),
    !!m.log, m.def);
  el.dataset.macro = m.key;
  el.querySelector('svg')?.setAttribute('aria-label', m.title);
  el.title = `${m.title} — drag up or down, shift for fine, double-click to reset`;
  return el;
}

/// Build the compact grain panel into a cell.
function composeGrainMount(host) {
  if (!host || host.querySelector('.cg')) return;
  host.innerHTML = `
    <div class="cg">
      <div class="cg-head">
        <span class="cg-title">GRAIN</span>
        <span class="cg-out mono" id="cgOut"></span>
        <select class="mini cg-cloud" id="cgCloud"
          title="A cloud: the grain section on its own, recalled without changing the sound"></select>
      </div>
      <div class="seg cg-engine" id="cgEngine"></div>
      <div class="cg-pad-wrap">
        <canvas class="cloud-pad cg-pad" id="cgPad" data-read="cgPadRead"
          title="The cloud, where it reads from. Drag inside the box to move it; outside to spread it."></canvas>
        <span class="mono dim cg-pad-read" id="cgPadRead"></span>
      </div>
      <div class="cg-knobs" id="cgKnobs"></div>
      <div class="cg-empty hidden" id="cgEmpty">Open a sound — double-click one in the library</div>
    </div>`;

  // The engine. Pressed through the full panel's own button, so choosing an
  // engine here runs exactly what choosing it there runs — its rows rebuilt,
  // the document committed — rather than a second copy of that.
  const eng = $('cgEngine');
  for (const [alg, label] of CG_ENGINES) {
    const b = document.createElement('button');
    b.className = 'seg-btn';
    b.dataset.alg = alg;
    b.textContent = label;
    const full = () => document.querySelector(`#stretchEngine .seg-btn[data-alg="${alg}"]`);
    b.title = full()?.title || label;
    b.onclick = () => {
      const target = full();
      if (!target) { toast('Open a sound first'); return; }
      target.click();
      composeGrainSync();
    };
    eng.appendChild(b);
  }

  // The CLOUD preset, the same way: the full panel's picker does the recall.
  const cloud = $('cgCloud');
  cloud.onchange = () => {
    const gp = $('gpPick');
    if (!gp) return;
    gp.value = cloud.value;
    gp.dispatchEvent(new Event('change'));
  };
  paintSectionPicker(cloud, 'grain', $('gpPick')?.value || '');

  const pad = $('cgPad');
  wireCloudPad(pad);
  if (window.ResizeObserver) new ResizeObserver(() => drawCloudPad(pad)).observe(pad);

  cgBuiltFor = null;
  composeGrainSync();
}

/// What the knobs were last built for: the document, and the tuning's step,
/// since Pitch snaps to it.
let cgBuiltFor = null;

/// Bring the compact panel into step with the drafts.
///
/// Called by the full panel whenever it changes — `showStretchOut`,
/// `renderGrainParams`, `syncGrainSliders` and the pad all call it — and by the
/// compact panel after its own engine press. A knob being turned is left
/// alone: the answer to its own last move arrives a moment later, and pushing
/// that back into a knob still under the hand would drag it back to where it
/// was.
function composeGrainSync() {
  const box = $('cgKnobs');
  if (!box) return;
  const ready = !!(state.stretchDraft && state.edit?.stretch);
  $('cgEmpty')?.classList.toggle('hidden', ready);
  box.classList.toggle('hidden', !ready);
  $('cgEngine')?.classList.toggle('hidden', !ready);
  if (!ready) { cgBuiltFor = null; box.innerHTML = ''; return; }

  const key = `${state.selectedFile?.path || ''} ${scaleStep()}`;
  if (cgBuiltFor !== key) {
    cgBuiltFor = key;
    box.innerHTML = '';
    for (const m of CG_MACROS) box.appendChild(cgKnob(m));
  } else {
    for (const el of box.querySelectorAll('.knob')) {
      if (el.classList.contains('turning')) continue;
      const m = CG_MACROS.find((x) => x.key === el.dataset.macro);
      if (m) el.sync(cgRead(m));
    }
  }

  const alg = state.stretchDraft.algorithm;
  for (const b of $('cgEngine')?.querySelectorAll('.seg-btn') || []) {
    b.classList.toggle('active', b.dataset.alg === alg);
  }
  const out = $('cgOut');
  if (out) out.textContent = $('stretchOut')?.textContent || '';
  const cloud = $('cgCloud'), gp = $('gpPick');
  if (cloud && gp && document.activeElement !== cloud && cloud.value !== gp.value) cloud.value = gp.value;
}

// ─── the copies of the full panels' pickers ──────────────────────────────────
//
// The compact panels show the CLOUD, VIEW and LOOK pickers the full panels
// have. `app.js` repaints its own and calls these, so the ids the compact panels
// build are only ever looked up in the file that builds them.

/// A section's presets were repainted: repaint this view's copy.
function composePresetsPainted(kind, select) {
  if (kind === 'visual') paintSectionPicker($('cpLook'), 'visual', select);
  if (kind === 'grain') paintSectionPicker($('cgCloud'), 'grain', select);
}

/// The visuals menu was rebuilt: refill this view's copy of it.
function composeVisPickerBuilt() {
  const cp = $('cpVisual');
  if (cp) fillVisPicker(cp);
}

/// What is showing changed: say so in this view's copy.
function composeVisPickerPainted() {
  const cp = $('cpVisual');
  if (cp) paintVisPicker(cp);
}

// ─── the picture bar ─────────────────────────────────────────────────────────

/// Build the compact picture bar into a cell, with the room's place under it.
///
/// VIEW and LOOK are the stage bar's two pickers, filled from the same lists
/// and changed through the same calls. The camera buttons are the Room tab's
/// set views. `⤢` goes to the Visual workspace, where every control is.
function composePictureMount(host) {
  if (!host || host.querySelector('.cp')) return;
  host.innerHTML = `
    <div class="cp">
      <div class="cp-bar">
        <span class="re-tag">VIEW</span>
        <select class="field mini vis-pick-sel" id="cpVisual" title="Which visualiser is on the stage."></select>
        <span class="re-tag">LOOK</span>
        <select class="field mini sp-pick" id="cpLook"
          title="A look: everything the picture is, kept under a name. Saved in the Visual workspace."></select>
        <span class="cp-sep"></span>
        <button class="re-btn" data-cam="front" title="Level, from the front, at the same pivot and distance">Front</button>
        <button class="re-btn" data-cam="side" title="Level, from the side">Side</button>
        <button class="re-btn" data-cam="top" title="Straight down">Top</button>
        <button class="re-btn" data-cam="frame" title="The picked point, or the ring, filling the view — F does the same">Frame</button>
        <button class="re-btn cp-full" id="cpFull" title="The Visual workspace, with every control">⤢</button>
      </div>
      <div class="cp-room" id="cpRoom"></div>
    </div>`;

  fillVisPicker($('cpVisual'));
  $('cpVisual').onchange = (e) => setVisual(e.target.value);
  paintVisModulePicker();

  $('cpLook').onchange = (e) => {
    const vp = $('vpPick');
    if (!vp) return;
    vp.value = e.target.value;
    vp.dispatchEvent(new Event('change'));
  };
  paintVisualPresets($('vpPick')?.value || '');

  for (const b of host.querySelectorAll('[data-cam]')) {
    b.onclick = () => {
      const which = b.dataset.cam;
      if (which === 'frame') { roomFramePick(); return; }
      roomSetWorld(camView(roomWorldNow(), which));
      paintRoomNums();
      saveRoomCameras();
    };
  }
  $('cpFull').onclick = () => setMode('room');
}

// ─── the view ────────────────────────────────────────────────────────────────
//
// Three cells across the top — GRAIN, SEQ, the picture — the arrangement under
// them, and the transport at the foot. The compact panels are built into their
// cells once; what is shared with the other workspaces is **moved in, not
// copied**, and put back exactly where it came from when the view is left, the
// same contract the Visual workspace keeps with `roomAdopt`:
//
//   - the room (`#masterBus`), into the picture cell under its bar;
//   - the transport, and the two export buttons, into the foot;
//   - the PERFORMANCE panel, into the arrangement.
//
// **The sequencer's frame is the exception, and is not moved.** Taking an
// iframe out of the page and putting it back reloads it — its audio, its
// pattern, its take, gone. So its view stays where it is and is laid over the
// SEQ cell instead: fixed, at the cell's place and size, kept there by a watch
// that runs while the view is open. The sequencer lays itself out compact
// inside its own page (`seqCompact`).

const CV_PARTS = [
  ['masterBus', 'cpRoom'],
  ['transportBar', 'cvFoot'],
  ['exportBtn', 'cvFoot'],
  ['videoBtn', 'cvFoot'],
  ['perfPanel', 'cvArrange'],
];
const cvBorrowed = new Map();

function cvAdopt(id, hostId) {
  const el = $(id), host = $(hostId);
  if (!el || !host || el.parentNode === host) return;
  if (!cvBorrowed.has(id)) cvBorrowed.set(id, { parent: el.parentNode, next: el.nextSibling });
  host.appendChild(el);
}

function cvReleaseAll() {
  // In reverse, so an element whose home was next to another borrowed one is
  // put back after its neighbour is.
  for (const [id, home] of [...cvBorrowed].reverse()) {
    const el = $(id);
    if (el && home.parent) home.parent.insertBefore(el, home.next);
  }
  cvBorrowed.clear();
}

// ── sizes ──

const CV_SIZES_KEY = 'audiolab.compose.sizes.v1';
/// The top row's share of the view's height, and the first two cells' shares
/// of its width; the picture takes what is left.
const CV_DEFAULTS = { top: 0.56, c0: 0.3, c1: 0.34 };
const CV_MIN = { top: 0.22, topMax: 0.82, cell: 0.16 };
let cvSizes = { ...CV_DEFAULTS };
try {
  const v = JSON.parse(localStorage.getItem(CV_SIZES_KEY) || 'null');
  if (v && typeof v === 'object') {
    for (const k of Object.keys(CV_DEFAULTS)) if (Number.isFinite(v[k])) cvSizes[k] = v[k];
  }
} catch { /* private mode */ }

function cvSaveSizes() {
  try { localStorage.setItem(CV_SIZES_KEY, JSON.stringify(cvSizes)); } catch { /* private mode */ }
}

function cvApplySizes() {
  const view = $('composeView');
  if (!view) return;
  view.style.setProperty('--cv-top', `${(cvSizes.top * 100).toFixed(3)}%`);
  view.style.setProperty('--cv-c0', `${(cvSizes.c0 * 100).toFixed(3)}%`);
  view.style.setProperty('--cv-c1', `${(cvSizes.c1 * 100).toFixed(3)}%`);
  cvDockSeq();
}

/// Everything drawn at a size, drawn again at the new one.
function cvRedraw() {
  cvDockSeq();
  drawCloudPads();
  if ($('perfCanvas')?.offsetParent) perfDrawTimeline();
  applyRoomFrame();
}

function cvWireGrips() {
  const view = $('composeView');
  if (!view || view.dataset.wired) return;
  view.dataset.wired = '1';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // A drag with the lost-release guard every grip here has: a move with no
  // button down ends it.
  const grip = (el, apply, reset) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* the guard covers it */ }
      el.classList.add('dragging');
      const up = (ev) => {
        el.classList.remove('dragging');
        try { el.releasePointerCapture(ev.pointerId); } catch { /* gone */ }
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        cvSaveSizes();
        afterLayout(cvRedraw);
      };
      const move = (ev) => {
        if (ev.buttons === 0) { up(ev); return; }
        apply(ev);
        cvApplySizes();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => { reset(); cvApplySizes(); cvSaveSizes(); afterLayout(cvRedraw); });
  };
  grip($('cvSplit'), (ev) => {
    const r = view.getBoundingClientRect();
    cvSizes.top = clamp((ev.clientY - r.top) / Math.max(1, r.height), CV_MIN.top, CV_MIN.topMax);
  }, () => { cvSizes.top = CV_DEFAULTS.top; });
  for (const g of view.querySelectorAll('.cv-vgrip')) {
    grip(g, (ev) => {
      const r = $('cvTop').getBoundingClientRect();
      const x = (ev.clientX - r.left) / Math.max(1, r.width);
      if (g.dataset.grip === '0') cvSizes.c0 = clamp(x, CV_MIN.cell, 1 - cvSizes.c1 - CV_MIN.cell);
      else cvSizes.c1 = clamp(x - cvSizes.c0, CV_MIN.cell, 1 - cvSizes.c0 - CV_MIN.cell);
    }, () => { cvSizes.c0 = CV_DEFAULTS.c0; cvSizes.c1 = CV_DEFAULTS.c1; });
  }
}

// ── the sequencer's frame, over its cell ──

let cvWatchRaf = null;
let cvLastSeqRect = '';

function cvDockSeq() {
  const sv = $('seqView'), cell = $('cvSeq');
  if (!sv || !cell || !sv.classList.contains('seq-docked')) return;
  const r = cell.getBoundingClientRect();
  const key = `${r.left},${r.top},${r.width},${r.height}`;
  if (key === cvLastSeqRect) return;
  cvLastSeqRect = key;
  sv.style.left = `${r.left}px`;
  sv.style.top = `${r.top}px`;
  sv.style.width = `${r.width}px`;
  sv.style.height = `${r.height}px`;
}

/// Kept over its cell whatever moves the cell — a grip, the rail opening, the
/// window. One measurement a frame, and a write only when something changed.
function cvWatch() {
  cvWatchRaf = requestAnimationFrame(cvWatch);
  cvDockSeq();
}

// ── entering and leaving ──

function composeEnter() {
  composeGrainMount($('cvGrain'));
  composePictureMount($('cvPicture'));
  composeCompositionBar($('cvArrange'));
  cvWireGrips();
  cvApplySizes();
  for (const [id, host] of CV_PARTS) cvAdopt(id, host);
  $('composeView')?.classList.remove('hidden');
  $('transportBar')?.classList.remove('hidden');
  for (const id of ['exportBtn', 'videoBtn']) $(id)?.classList.remove('hidden');

  // The room: the camera's gestures and the beads, without the editor's panel,
  // which is the Visual workspace's.
  roomEdit.on = true;
  buildRoomLayers();
  buildRoomStreams();
  buildRoomChunks();
  buildRoomFrames();
  $('masterBus')?.classList.add('room-editing');
  setVisModule(roomEdit.module);
  paintVisModulePicker();

  // The sequencer: loaded if it never was, compact, over its cell.
  seqEnsureFrame();
  seqCompact(true);
  const sv = $('seqView');
  if (sv) { sv.classList.remove('hidden'); sv.classList.add('seq-docked'); }
  cvLastSeqRect = '';
  if (!cvWatchRaf) cvWatch();

  composeGrainSync();
  afterLayout(() => {
    cvRedraw();
    paintRoomNums();
    paintSolidPath();
    renderAutomation();
  });
}

function composeLeave() {
  if (cvWatchRaf) { cancelAnimationFrame(cvWatchRaf); cvWatchRaf = null; }
  const sv = $('seqView');
  if (sv) {
    sv.classList.remove('seq-docked');
    for (const k of ['left', 'top', 'width', 'height']) sv.style[k] = '';
  }
  cvLastSeqRect = '';
  seqCompact(false);
  $('composeView')?.classList.add('hidden');
  cvReleaseAll();
  roomEdit.on = false;
  if (typeof roomPick === 'function' && roomEdit.pick) roomPick(null);
  $('masterBus')?.classList.remove('room-editing');
  applyRoomFrame();
}

// ─── the composition ─────────────────────────────────────────────────────────
//
// Everything the view shows, kept under a name on the server
// (`data/compositions/<name>.json`) and put back as one thing: the sound, the
// engine's settings with its cloud and tuning, the rack, the sequencer's state
// and its take, the look, the grain's lanes and the picture's, the source
// switches, the film's frame and the view's own sizes. The section presets stay
// what they are; a composition gathers what each of them would keep.
// `docs/COMPOSE.md`, phase four.

async function compositionSnapshot() {
  const f = state.selectedFile;
  if (!f || !state.edit) throw new Error('Open a sound first');
  let rack = null;
  try { rack = await api(`/api/rack?p=${encodeURIComponent(f.path)}`); } catch { rack = null; }
  return {
    v: 1,
    saved: Date.now(),
    sound: { path: f.path, name: f.name || f.path.split('/').pop() },
    engine: { stretch: state.edit.stretch, rack },
    sequencer: await seqRequestState(),
    look: visualSnapshot(),
    lanes: {
      grain: { lanes: state.automation?.lanes || [], bypassed: !!state.automation?.bypassed },
      visual: visualLanes.lanes,
    },
    sources: { ...state.sources },
    frame: roomEdit.frame,
    sizes: { ...cvSizes },
  };
}

async function compositionList() {
  try { return (await api('/api/compositions')).names || []; } catch { return []; }
}

async function compositionSave(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('A composition needs a name');
  const composition = await compositionSnapshot();
  const r = await postJSON('/api/compositions', { name: clean, composition });
  await compositionPaint(clean, r.names);
  return clean;
}

async function compositionDelete(name) {
  const r = await postJSON('/api/compositions/delete', { name });
  await compositionPaint('', r.names);
}

/// Put a composition back, part by part, in the order that lets each land on
/// what the one before it set up: the sound first, then its engine, its rack and
/// its lanes, then the picture, the switches, the sequencer and the view.
async function compositionApply(c) {
  if (!c || typeof c !== 'object' || !c.sound?.path) throw new Error('That is not a composition');
  if (state.selectedFile?.path !== c.sound.path) {
    await selectFile(await resolveFile(c.sound.path));
  }
  const p = state.selectedFile.path;

  if (c.engine?.stretch) {
    await editOp({ op: 'stretch', ...c.engine.stretch });
    stretchBuiltFor = null;
    grainBuiltFor = null;
    renderStretch();
    renderGrainParams();
    syncStretchSliders();
  }
  if (c.engine?.rack) {
    await postJSON('/api/rack', { ...c.engine.rack, p, sr: state.view?.sampleRate || 48000 });
    loadRack();
  }
  if (c.lanes?.grain) {
    await postJSON('/api/automation', { p, lanes: c.lanes.grain.lanes || [], bypassed: !!c.lanes.grain.bypassed });
    await loadAutomation();
  }
  if (Array.isArray(c.lanes?.visual)) {
    visualLanes.path = p;
    visualLanes.lanes = c.lanes.visual;
    saveVisualLanes();
  }
  if (c.look) applyVisual(c.look);
  if (c.frame) {
    roomEdit.frame = c.frame;
    applyRoomFrame();
    paintRoomNums();
  }
  if (c.sources) {
    for (const k of ['grain', 'seq']) {
      if (typeof c.sources[k] === 'boolean' && sourceOn(k) !== c.sources[k]) setSource(k, c.sources[k]);
    }
  }
  if (c.sequencer) {
    seqEnsureFrame();
    await compositionSeqReady();
    seqPost({ type: 'seq:load', state: c.sequencer.state || null, take: c.sequencer.take || null });
  }
  if (c.sizes) {
    Object.assign(cvSizes, c.sizes);
    cvApplySizes();
    cvSaveSizes();
  }
  renderAutomation();
  afterLayout(cvRedraw);
}

/// The sequencer's frame, answering. A frame loaded for the first time takes a
/// moment.
function compositionSeqReady() {
  if (seq.ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const began = performance.now();
    const t = setInterval(() => {
      if (seq.ready || performance.now() - began > 8000) { clearInterval(t); resolve(seq.ready); }
    }, 100);
  });
}

async function compositionLoad(name) {
  const c = await api(`/api/compositions/get?name=${encodeURIComponent(name)}`);
  await compositionApply(c);
  await compositionPaint(name);
  return c;
}

/// The picker, refilled — from `names` when the answer to a save or a delete is
/// already in hand.
async function compositionPaint(select, names) {
  const sel = $('cvCompPick');
  if (!sel) return;
  const list = names || await compositionList();
  const keep = select === undefined ? sel.value : select;
  sel.innerHTML = '<option value="">— none —</option>';
  for (const n of list) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  }
  sel.value = list.includes(keep) ? keep : '';
}

/// The bar over the arrangement: which composition, and keeping, opening,
/// deleting and exporting one. First in its cell, so the timeline moved in after
/// it sits under it.
function composeCompositionBar(host) {
  if (!host || host.querySelector('.cv-comp')) return;
  const bar = document.createElement('div');
  bar.className = 'cv-comp';
  bar.innerHTML = `
    <span class="cv-comp-tag">COMPOSITION</span>
    <select class="preset-select cv-comp-pick" id="cvCompPick"
      title="Open a composition: the sound, the engine, the sequencer, the look and every lane, as they were kept"></select>
    <button class="btn" id="cvCompSave" title="Keep everything the view shows under a name">SAVE AS…</button>
    <button class="btn preset-del-btn" id="cvCompDelete" title="Delete this composition. The sound and its settings are left as they are.">DEL</button>
    <button class="btn" id="cvCompExport" title="The export dialog, where Composition exports the sound and the film together">EXPORT…</button>`;
  host.prepend(bar);
  $('cvCompPick').onchange = async (e) => {
    const name = e.target.value;
    if (!name) return;
    try {
      await compositionLoad(name);
      toast(`Composition: ${name}`);
    } catch (err) {
      toast(`Could not open “${name}”: ${err.message}`);
    }
  };
  $('cvCompSave').onclick = async () => {
    if (!state.selectedFile) { toast('Open a sound first'); return; }
    const suggested = $('cvCompPick').value || (state.selectedFile.name || 'Composition').replace(/\.[^.]+$/, '');
    const name = prompt('Save this composition as:', suggested);
    if (name === null) return;
    try {
      const kept = await compositionSave(name);
      toast(`Saved “${kept}”`);
    } catch (err) {
      toast(err.message);
    }
  };
  $('cvCompDelete').onclick = async () => {
    const name = $('cvCompPick').value;
    if (!name) { toast('Pick a composition first'); return; }
    if (!confirm(`Delete the composition “${name}”? The sound and its settings are left as they are.`)) return;
    try {
      await compositionDelete(name);
      toast(`Deleted “${name}”`);
    } catch (err) {
      toast(err.message);
    }
  };
  $('cvCompExport').onclick = () => {
    if (!state.selectedFile) { toast('Open a sound first'); return; }
    openExportLoop(exportLoopRange());
  };
  compositionPaint('');
}

// ─── one export ──────────────────────────────────────────────────────────────

/// The composition's folder: its name, or the sound's when none is chosen.
function compositionFolder() {
  const picked = $('cvCompPick')?.value;
  if (picked) return picked;
  return `${(state.selectedFile?.name || 'Untitled').replace(/\.[^.]+$/, '')} composition`;
}

/// The sound — with the sequencer as the dialog's switch says — and then the
/// film, into one folder beside the document named for the composition. The
/// dialog's range, repeats, tail and film size are used for both, so the two are
/// the same piece of the document. Resolves to where each went.
async function composeExportAll() {
  if (!state.selectedFile) { toast('Open a sound first'); return null; }
  const folder = compositionFolder();
  const range = exportRange;
  const repeats = Math.max(1, Math.min(512, +$('elRepeats').value || 1));
  const tail = $('elTail').classList.contains('on');
  $('elStatus').textContent = `the sound, into “${folder}”…`;
  const finished = exportFinished();
  await runExport(range, repeats, tail, { folder });
  const sound = await finished;
  if (!sound || sound.error || sound.cancelled || !sound.path) {
    $('elStatus').textContent = sound?.cancelled ? 'stopped' : `the sound failed — ${sound?.error || 'nothing was written'}`;
    return { sound, film: null };
  }
  $('elStatus').textContent = 'the film…';
  const p = state.selectedFile.path;
  const film = await runVideoExport({
    save: async (blob, file) => {
      const q = `p=${encodeURIComponent(p)}&folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`;
      const res = await fetch(`/api/export/film?${q}`, { method: 'POST', body: blob });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return (await res.json()).path;
    },
  });
  if (typeof film === 'string') toast(`Composition exported — the sound and the film, in “${folder}”`);
  return { sound, film: typeof film === 'string' ? film : null };
}

$('elAll')?.addEventListener('click', () => { composeExportAll(); });
