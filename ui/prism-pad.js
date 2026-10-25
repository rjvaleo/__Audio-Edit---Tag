// The Prism pad: Hyperprism's blue window.
//
// Hyperprism opened one square per process. Its top edge was one setting and
// its left another, each with a low and a high limit typed into the corners;
// dragging set both at once, and a record button kept the motion. Here the
// square drives the engine's Time & Pitch — the Pitch Time Changer, speed
// across and pitch up — or any slot in the rack, with the pair Hyperprism gave
// that process. See docs/HYPERPRISM.md.
//
// **The pad moves controls the way their sliders do.** Time & Pitch goes
// through `stretchDraft` and `previewStretch`, a slot through `liveParam`. So
// the recorder, the lanes and the export need nothing new: REC arms the same
// recorder REC PERF does, and a take is two ordinary lanes.
//
// The sources, their controls, ranges and default pairs come from
// `GET /api/pad`, and the pad's arithmetic is held to the lanes' by
// `the_pads_arithmetic_is_the_lanes` in `server/src/pad.rs`. The setup —
// which two controls, and their limits — is kept with the rack, under the
// slot's id or `stretch`.
//
// Loaded after app.js's globals exist and before anything calls it; nothing
// runs at load.

const prismPad = {
  /// What `/api/pad` offered for the open file.
  sources: [],
  /// The id of the one on the pad.
  source: 'stretch',
  /// The current take for the pad's two controls: `[frame, xUnit, yUnit]`.
  path: [],
  dragging: false,
  timer: null,
};
window.prismPad = prismPad;

const PRISM_STRETCH = 'stretch';
/// Hyperprism's Pitch Time Changer, beside Time & Pitch. See `server/src/pad.rs`.
const PRISM_PTC = 'ptc';
/// Its window's starting values, for a rack that has never had it.
const PTC_DEFAULTS = { on: false, speed: 100, pitch: 100, feedback: 0, grain: 15, xfade: 100, smoothing: 50 };

/// The Pitch Time Changer the document keeps, filled in.
function prismPtc() {
  if (!state.rack) return { ...PTC_DEFAULTS };
  state.rack.pitchTime = { ...PTC_DEFAULTS, ...(state.rack.pitchTime || {}) };
  return state.rack.pitchTime;
}

/// Send what changed in the Pitch Time Changer, a few times a second at most
/// while dragging; the server keeps it, sends it to the engine and records it.
const prismPtcPending = {};
// Made on first use: this file loads before app.js, where `throttled` is.
let prismPtcThrottle = null;
function prismPtcSend() {
  prismPtcThrottle = prismPtcThrottle || throttled(() => {
    const body = { p: state.selectedFile?.path, ...prismPtcPending };
    for (const k of Object.keys(prismPtcPending)) delete prismPtcPending[k];
    if (body.p) postJSON('/api/pitchtime', body).catch(() => {});
  }, 60);
  prismPtcThrottle();
}
function prismPtcSet(changes) {
  Object.assign(prismPtc(), changes);
  Object.assign(prismPtcPending, changes);
  prismPtcSend();
}

/// The pad tab was opened: fetch what it can drive, and draw it.
async function prismPadOpen() {
  const f = state.selectedFile;
  if (!f) return;
  try {
    const r = await api(`/api/pad?p=${encodeURIComponent(f.path)}`);
    prismPad.sources = r.sources || [];
  } catch { prismPad.sources = []; }
  if (!prismPad.sources.some((s) => s.id === prismPad.source)) prismPad.source = PRISM_STRETCH;
  prismRenderBar();
  prismPlace();
  prismShowHp();
  prismLoadPresets();
  await prismLoadPath();
  prismShowRecord();
  // While the tab is open and the transport runs, the dot follows the take.
  clearInterval(prismPad.timer);
  prismPad.timer = setInterval(prismFollow, 60);
}

function prismCurrent() {
  return prismPad.sources.find((s) => s.id === prismPad.source) || prismPad.sources[0];
}

/// The setup in force: what the rack keeps for this source, or its default.
function prismSetup() {
  const src = prismCurrent();
  if (!src) return null;
  return state.rack?.pads?.[src.id] || src.pad || src.default;
}

function prismControl(key) {
  return prismCurrent()?.controls.find((c) => c.key === key);
}

/// Somewhere between two values, at `t` of the way: along a logarithm for a
/// control that sweeps logarithmically. Either end may be the larger, which is
/// how Time & Pitch runs faster to the right.
function prismBetween(c, lo, hi, t) {
  const u = Math.max(0, Math.min(1, t));
  let v = c.log && lo > 0 && hi > 0 ? lo * Math.pow(hi / lo, u) : lo + (hi - lo) * u;
  if (c.step === 1) v = Math.round(v);
  return v;
}

/// The inverse: how far between two values one is.
function prismAlong(c, lo, hi, v) {
  if (!Number.isFinite(v) || lo === hi) return 0.5;
  const t = c.log && lo > 0 && hi > 0 && v > 0 ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo);
  return Math.max(0, Math.min(1, t));
}

/// The value a lane's unit stands for, across a control's whole range: what
/// `resolve` and the stretch table say, so a drawn take sits where it plays.
function prismUnitValue(c, u) {
  return prismBetween(c, c.min, c.max, u);
}

/// A control's value now, wherever its source keeps it.
function prismRead(key) {
  const src = prismCurrent();
  const c = prismControl(key);
  if (!src || !c) return undefined;
  if (src.id === PRISM_STRETCH) return state.stretchDraft?.[key] ?? c.min;
  if (src.id === PRISM_PTC) return prismPtc()[key] ?? c.min;
  const slot = state.rack?.slots.find((s) => s.id === src.id);
  return slot?.params?.[key] ?? slot?.[key];
}

/// Move one control, the way its own slider would.
function prismWrite(key, v) {
  const src = prismCurrent();
  if (!src) return;
  if (src.id === PRISM_STRETCH) {
    state.stretchDraft[key] = v;
    state.stretchRows?.[key]?.sync?.(v);
    return;
  }
  if (src.id === PRISM_PTC) {
    // Playing the process is hearing it, as in Hyperprism: a move turns it on.
    prismPtcSet({ [key]: v, on: true });
    prismShowPtc();
    return;
  }
  const slot = state.rack?.slots.find((s) => s.id === src.id);
  if (!slot) return;
  // The compressor keeps its settings as fields; everything else in `params`.
  if (slot.kind === 'comp') slot[key] = v;
  else (slot.params = slot.params || {})[key] = v;
  liveParam(slot.id, key, v);
}

/// What the pad was moved to, as two fractions across and up.
function prismMoveTo(across, up) {
  const p = prismSetup();
  const cx = prismControl(p?.x), cy = prismControl(p?.y);
  if (!cx || !cy) return;
  prismWrite(cx.key, prismBetween(cx, p.xLo, p.xHi, across));
  prismWrite(cy.key, prismBetween(cy, p.yLo, p.yHi, up));
  if (prismCurrent().id === PRISM_STRETCH) previewStretch();
  prismPlace();
}

/// A drag is over: commit it properly, as a released slider does.
function prismRelease() {
  const id = prismCurrent()?.id;
  if (id === PRISM_STRETCH) commitStretch();
  else if (id === PRISM_PTC) prismRenderSettings();
  else { commitRack(); renderRack(); }
}

/// The Pitch Time Changer's switch: shown with its source, lit when on.
function prismShowPtc() {
  const b = $('prismPtcOn');
  if (!b) return;
  b.classList.toggle('hidden', prismCurrent()?.id !== PRISM_PTC);
  b.classList.toggle('on', !!prismPtc().on);
  b.setAttribute('aria-pressed', prismPtc().on ? 'true' : 'false');
}

/// The process's additional settings under the pad: for the Pitch Time
/// Changer, its window's four sliders. Its two axes are on the pad.
function prismRenderSettings() {
  const box = $('prismSettings');
  if (!box) return;
  box.innerHTML = '';
  const src = prismCurrent();
  const extra = src?.id === PRISM_PTC ? src.controls.filter((c) => c.key !== 'speed' && c.key !== 'pitch') : [];
  box.classList.toggle('hidden', extra.length === 0);
  const pt = prismPtc();
  for (const c of extra) {
    const def = PTC_DEFAULTS[c.key];
    box.appendChild(param(c.label, pt[c.key] ?? def, c.min, c.max, 1, (v) => `${Math.round(v)} %`,
      (v) => prismPtcSet({ [c.key]: Math.round(v) }), () => {}, false, def));
  }
}

/// Two numbers with their units, the way Hyperprism printed them on its edges.
function prismFormat(c, v) {
  if (!c || !Number.isFinite(v)) return '';
  if (c.choices) return c.choices[Math.round(v - c.min)] ?? String(Math.round(v));
  if (c.key === 'ratio') return `${v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)}×`;
  if (c.key === 'semitones') return `${v >= 0 ? '+' : ''}${v.toFixed(1)} st`;
  return fxValueFormat(c, v);
}

/// A menu entry: what it says, what it stands for, and whether it is chosen.
function choiceOption(label, value, selected) {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  o.selected = !!selected;
  return o;
}

/// The bar above the pad: the source, the two axes, and the limits.
function prismRenderBar() {
  const pick = $('prismSource'), xs = $('prismX'), ys = $('prismY');
  if (!pick) return;
  pick.innerHTML = '';
  for (const s of prismPad.sources) pick.add(choiceOption(s.label, s.id, s.id === prismPad.source));
  const src = prismCurrent();
  const p = prismSetup();
  for (const [sel, key] of [[xs, p?.x], [ys, p?.y]]) {
    sel.innerHTML = '';
    for (const c of src?.controls || []) sel.add(choiceOption(c.label, c.key, c.key === key));
  }
  const shown = (n) => String(+(+n).toPrecision(6));
  $('prismXLo').value = shown(p?.xLo); $('prismXHi').value = shown(p?.xHi);
  $('prismYLo').value = shown(p?.yLo); $('prismYHi').value = shown(p?.yHi);
  prismShowPtc();
  prismRenderSettings();
}

// ───────────────────────────── Hyperprism's Playback Speed and its faders

/// The slider's rate: Hyperprism read its 0–255 slider as a 128th each.
function prismSpeedRate(v) {
  return v / 128;
}

/// The three faders as Hyperprism had them: 0–255 each, 128 at rest.
const prismHp = { speed: 128, l: 128, lr: 128, r: 128 };

/// A fader's dB: Hyperprism's own law, ±18 dB across 0–255.
function prismFaderDb(v) {
  return (36 * v) / 255 - 18;
}

function prismSideGains() {
  const g = (v) => Math.pow(10, prismFaderDb(v) / 20);
  return { gainL: g(prismHp.l), gainR: g(prismHp.r) };
}

let prismHpThrottle = null;
function prismHpSend() {
  prismHpThrottle = prismHpThrottle || throttled(() => {
    postJSON('/api/engine/transport', { speed: prismSpeedRate(prismHp.speed), ...prismSideGains() }).catch(() => {});
  }, 60);
  prismHpThrottle();
}

function prismShowHp() {
  const read = $('prismSpeedRead');
  if (read) read.textContent = `${Math.round(prismSpeedRate(prismHp.speed) * 100)} %`;
  for (const [id, key] of [['prismSpeed', 'speed'], ['prismFaderL', 'l'], ['prismFaderLR', 'lr'], ['prismFaderR', 'r']]) {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = String(prismHp[key]);
    const shown = key === 'speed' ? null : $(`${id}Read`);
    if (shown) {
      const db = prismFaderDb(prismHp[key]);
      shown.textContent = `${db < 0 ? '−' : '+'}${Math.abs(db).toFixed(1)} dB`;
    }
  }
}

/// A fader moved. LR sets both sides to its own value, as the original's did.
function prismFaderSet(key, v) {
  prismHp[key] = v;
  if (key === 'lr') { prismHp.l = v; prismHp.r = v; }
  prismShowHp();
  prismHpSend();
}

// ──────────────────────────────── each process's presets and post-roll

/// What the presets of the source on the pad are kept under: its process.
function prismKind() {
  const src = prismCurrent();
  if (!src) return '';
  if (src.id === PRISM_STRETCH || src.id === PRISM_PTC) return src.id;
  const slot = state.rack?.slots.find((s) => s.id === src.id);
  return (slot?.kind || '').replace(/^prism:/, '');
}

const prismPresets = { factory: [], user: [] };

async function prismLoadPresets() {
  const kind = prismKind();
  try {
    const r = await api(`/api/pad/presets?kind=${encodeURIComponent(kind)}`);
    prismPresets.factory = r.factory || [];
    prismPresets.user = r.user || [];
  } catch { prismPresets.factory = []; prismPresets.user = []; }
  prismRenderPresets();
}

function prismRenderPresets(chosen) {
  const sel = $('prismPreset');
  if (!sel) return;
  sel.innerHTML = '';
  sel.add(choiceOption('<Default Settings>', 'default', chosen === 'default'));
  prismPresets.factory.forEach((p, i) => sel.add(choiceOption(p.name, `f${i}`, chosen === `f${i}`)));
  prismPresets.user.forEach((p, i) => sel.add(choiceOption(p.name, `u${i}`, chosen === `u${i}`)));
  if (!chosen) sel.selectedIndex = -1;
  const pr = $('prismPostRoll');
  if (pr) pr.value = String(state.rack?.postRoll?.[prismCurrent()?.id] ?? 0);
}

/// The source's settings other than its two axes, as a preset keeps them.
function prismSettingsNow() {
  const src = prismCurrent();
  const p = prismSetup();
  if (!src) return {};
  if (src.id === PRISM_PTC) {
    const pt = prismPtc();
    return { feedback: pt.feedback, grain: pt.grain, xfade: pt.xfade, smoothing: pt.smoothing };
  }
  const out = {};
  for (const c of src.controls) {
    if (c.key === p?.x || c.key === p?.y) continue;
    const v = prismRead(c.key);
    if (Number.isFinite(v)) out[c.key] = v;
  }
  return out;
}

/// Load a preset: its window, its settings and its post-roll. Like
/// Hyperprism's, it leaves the pad where it is.
function prismApplyPreset(p) {
  const src = prismCurrent();
  if (!src || !state.rack) return;
  state.rack.postRoll = { ...(state.rack.postRoll || {}), [src.id]: Math.max(0, p.postRollMs || 0) };
  const settings = p.settings || {};
  if (src.id === PRISM_PTC) prismPtcSet(settings);
  else if (src.id !== PRISM_STRETCH) {
    const slot = state.rack.slots.find((s) => s.id === src.id);
    for (const [k, v] of Object.entries(settings)) {
      if (!slot) break;
      if (slot.kind === 'comp') slot[k] = v; else (slot.params = slot.params || {})[k] = v;
      liveParam(slot.id, k, v);
    }
  }
  // The window last: keeping it posts the rack, settings and post-roll with it.
  prismKeep({ x: p.x, xLo: p.xLo, xHi: p.xHi, y: p.y, yLo: p.yLo, yHi: p.yHi });
  prismRenderSettings();
}

/// The process's own defaults: its pad window, its settings and no post-roll.
function prismDefaultPreset() {
  const src = prismCurrent();
  const settings = {};
  if (src?.id === PRISM_PTC) Object.assign(settings, { feedback: 0, grain: 15, xfade: 100, smoothing: 50 });
  else {
    const slot = state.rack?.slots.find((s) => s.id === src?.id);
    for (const sp of state.shapers?.[slot?.kind]?.params || []) {
      if (sp.key !== src.default.x && sp.key !== src.default.y && Number.isFinite(sp.default)) settings[sp.key] = sp.default;
    }
  }
  return { ...src.default, settings, postRollMs: 0 };
}

async function prismPresetChosen(value) {
  if (value === 'default') prismApplyPreset(prismDefaultPreset());
  else if (value?.[0] === 'f') prismApplyPreset(prismPresets.factory[+value.slice(1)]);
  else if (value?.[0] === 'u') prismApplyPreset(prismPresets.user[+value.slice(1)]);
  prismRenderPresets(value);
}

async function prismPresetSave() {
  const name = $('prismPresetName')?.value.trim();
  if (!name) { toast('Name the preset first'); return; }
  const src = prismCurrent();
  const preset = { ...prismSetup(), settings: prismSettingsNow(), postRollMs: state.rack?.postRoll?.[src.id] ?? 0 };
  await postJSON('/api/pad/presets', { kind: prismKind(), name, preset });
  await prismLoadPresets();
  const i = prismPresets.user.findIndex((p) => p.name === name);
  prismRenderPresets(i >= 0 ? `u${i}` : undefined);
}

async function prismPresetRename() {
  const v = $('prismPreset')?.value;
  const to = $('prismPresetName')?.value.trim();
  if (v?.[0] !== 'u' || !to) { toast('Choose one of your presets and type its new name'); return; }
  await postJSON('/api/pad/presets/rename', { kind: prismKind(), from: prismPresets.user[+v.slice(1)].name, to });
  await prismLoadPresets();
}

async function prismPresetDelete() {
  const v = $('prismPreset')?.value;
  if (v?.[0] !== 'u') { toast('Only your own presets can be deleted'); return; }
  await postJSON('/api/pad/presets/delete', { kind: prismKind(), name: prismPresets.user[+v.slice(1)].name });
  await prismLoadPresets();
}

function prismPostRollChanged(input) {
  const src = prismCurrent();
  if (!src || !state.rack) return;
  const ms = Math.max(0, Number(input.value) || 0);
  input.value = String(ms);
  state.rack.postRoll = { ...(state.rack.postRoll || {}), [src.id]: ms };
  pushRack({ immediate: true });
}

/// Keep a changed setup with the rack, as the server will check it.
function prismKeep(next) {
  if (!state.rack) return;
  state.rack.pads = { ...(state.rack.pads || {}), [prismCurrent().id]: next };
  pushRack({ immediate: true });
  prismRenderBar();
  prismPlace();
  prismLoadPath();
}

/// A different control on an axis starts with its whole range, or the
/// source's default limits if that control is the default.
function prismAxisChanged(axis, key) {
  const p = { ...prismSetup() };
  const c = prismControl(key);
  if (!c) return;
  const d = prismCurrent().default;
  const [lo, hi] = d[axis] === key ? [d[axis + 'Lo'], d[axis + 'Hi']] : [c.min, c.max];
  // The other axis cannot be the same control: they swap.
  const other = axis === 'x' ? 'y' : 'x';
  if (p[other] === key) {
    p[other] = p[axis]; p[other + 'Lo'] = p[axis + 'Lo']; p[other + 'Hi'] = p[axis + 'Hi'];
  }
  p[axis] = key; p[axis + 'Lo'] = lo; p[axis + 'Hi'] = hi;
  prismKeep(p);
}

function prismLimitChanged(field, input) {
  const p = { ...prismSetup() };
  const c = prismControl(field[0] === 'x' ? p.x : p.y);
  let v = +input.value;
  if (!c || !Number.isFinite(v)) { prismRenderBar(); return; }
  v = Math.max(c.min, Math.min(c.max, v));
  p[field] = v;
  // A sweep from somewhere to the same place is not a sweep.
  if (p.xLo === p.xHi || p.yLo === p.yHi) { prismRenderBar(); return; }
  prismKeep(p);
}

/// The dot where the two controls are, and the readouts on the edges.
function prismPlace(values) {
  const pad = $('prismPad');
  const p = prismSetup();
  const cx = prismControl(p?.x), cy = prismControl(p?.y);
  if (!pad || !cx || !cy) return;
  const vx = values ? values[0] : prismRead(cx.key);
  const vy = values ? values[1] : prismRead(cy.key);
  const dot = pad.querySelector('.prism-pad-dot');
  dot.style.left = `${prismAlong(cx, p.xLo, p.xHi, vx) * 100}%`;
  dot.style.top = `${(1 - prismAlong(cy, p.yLo, p.yHi, vy)) * 100}%`;
  $('prismXRead').textContent = `${cx.label} ${prismFormat(cx, vx)}`;
  $('prismYRead').textContent = `${cy.label} ${prismFormat(cy, vy)}`;
}

/// The lane names the pad's two controls record into.
function prismTargets() {
  const p = prismSetup();
  const src = prismCurrent();
  if (!p || !src) return null;
  const name = (key) => (src.id === PRISM_STRETCH ? `stretch.${key}` : `fx.${src.id}.${key}`);
  return [name(p.x), name(p.y)];
}

/// The take for the pad's two controls, drawn on the pad as a line.
async function prismLoadPath() {
  const f = state.selectedFile;
  const t = prismTargets();
  prismPad.path = [];
  if (f && t) {
    try {
      const r = await api(`/api/automation/path?p=${encodeURIComponent(f.path)}`
        + `&x=${encodeURIComponent(t[0])}&y=${encodeURIComponent(t[1])}`);
      prismPad.path = r.points || [];
    } catch { /* no take is a fine answer */ }
  }
  prismDrawPath();
  prismShowLoop();
}

function prismDrawPath() {
  const line = document.querySelector('#prismPad .prism-path polyline');
  if (!line) return;
  const p = prismSetup();
  const cx = prismControl(p?.x), cy = prismControl(p?.y);
  if (!cx || !cy) { line.setAttribute('points', ''); return; }
  line.setAttribute('points', prismPad.path.map(([, ux, uy]) => {
    const x = prismAlong(cx, p.xLo, p.xHi, prismUnitValue(cx, ux));
    const y = 1 - prismAlong(cy, p.yLo, p.yHi, prismUnitValue(cy, uy));
    return `${x.toFixed(4)},${y.toFixed(4)}`;
  }).join(' '));
}

/// While the take plays back, the dot rides along it.
function prismFollow() {
  if ($('dockPrism')?.classList.contains('hidden')) { clearInterval(prismPad.timer); prismPad.timer = null; return; }
  if (prismPad.dragging || !engine.playing || prismPad.path.length < 2 || state.captureArmed) return;
  const frame = playbackTime() * (state.view.sampleRate || 48000);
  const lanes = state.automation?.lanes || [];
  const t = prismTargets();
  const span = lanes.find((l) => l.target === t?.[0])?.loop;
  let at = frame;
  if (Array.isArray(span) && span[1] > span[0] && at >= span[0]) at = span[0] + ((at - span[0]) % (span[1] - span[0]));
  const path = prismPad.path;
  let i = path.findIndex(([f]) => f >= at);
  if (i < 0) i = path.length - 1;
  const [f1, x1, y1] = path[i];
  const [f0, x0, y0] = path[Math.max(0, i - 1)];
  const k = f1 > f0 ? Math.max(0, Math.min(1, (at - f0) / (f1 - f0))) : 1;
  const p = prismSetup();
  const cx = prismControl(p.x), cy = prismControl(p.y);
  prismPlace([prismUnitValue(cx, x0 + (x1 - x0) * k), prismUnitValue(cy, y0 + (y1 - y0) * k)]);
}

/// LOOP: both of the take's lanes wrap over its span, together.
async function prismToggleLoop() {
  const f = state.selectedFile;
  const t = prismTargets();
  if (!f || !t) return;
  const on = !$('prismLoop').classList.contains('on');
  try {
    await postJSON('/api/automation/loop', { p: f.path, x: t[0], y: t[1], on });
  } catch (e) { toast(on ? 'Nothing to loop yet — record a take on the pad first' : e.message); return; }
  await loadAutomation();
  prismShowLoop();
}

function prismShowLoop() {
  const b = $('prismLoop');
  if (!b) return;
  const t = prismTargets() || [];
  const lanes = (state.automation?.lanes || []).filter((l) => t.includes(l.target));
  b.classList.toggle('on', lanes.length === 2 && lanes.every((l) => Array.isArray(l.loop)));
}

/// REC: arm the recorder and roll the transport; again to stop the take.
async function prismToggleRecord() {
  if (state.captureArmed) {
    if (engine.playing) pausePlayback();
    else await endCapture();
  } else {
    await startCapture();
    if (state.captureArmed && !engine.playing) startPlayback();
  }
  prismShowRecord();
}

function prismShowRecord() {
  const b = $('prismRec');
  if (!b) return;
  const taking = state.captureArmed && engine.playing;
  b.classList.toggle('armed', state.captureArmed && !taking);
  b.classList.toggle('recording', taking);
  b.textContent = taking ? '⏺ REC ●' : state.captureArmed ? '⏺ ARMED' : '⏺ REC';
  // A take just ended: draw it.
  if (!state.captureArmed && prismPad.wasArmed) prismLoadPath();
  prismPad.wasArmed = state.captureArmed;
}

// ------------------------------------------------------------------ wiring

// Wired at load, which is before app.js has run: so by id, not through `$`.
(() => {
  const byId = (id) => document.getElementById(id);
  const pad = byId('prismPad');
  if (!pad) return;
  const where = (event) => {
    const r = pad.getBoundingClientRect();
    return [(event.clientX - r.left) / r.width, 1 - (event.clientY - r.top) / r.height];
  };
  pad.onpointerdown = (event) => {
    event.preventDefault();
    pad.setPointerCapture?.(event.pointerId);
    prismPad.dragging = true;
    prismMoveTo(...where(event));
  };
  pad.onpointermove = (event) => { if (prismPad.dragging) prismMoveTo(...where(event)); };
  pad.onpointerup = pad.onpointercancel = () => {
    if (!prismPad.dragging) return;
    prismPad.dragging = false;
    prismRelease();
  };
  // Double-click centres the dot, as double-click resets every control here.
  pad.ondblclick = (event) => {
    event.preventDefault();
    prismMoveTo(0.5, 0.5);
    prismRelease();
  };
  byId('prismSource').onchange = (e) => {
    prismPad.source = e.target.value;
    prismRenderBar();
    prismPlace();
    prismLoadPath();
    prismLoadPresets();
  };
  byId('prismX').onchange = (e) => prismAxisChanged('x', e.target.value);
  byId('prismY').onchange = (e) => prismAxisChanged('y', e.target.value);
  for (const field of ['xLo', 'xHi', 'yLo', 'yHi']) {
    const input = byId(`prism${field[0].toUpperCase()}${field.slice(1)}`);
    input.onchange = () => prismLimitChanged(field, input);
  }
  // Square, the largest the dock leaves room for: its height less the limits
  // row under it, or its width less the limits beside it, whichever is less.
  const stage = pad.closest('.prism-stage');
  const fit = () => {
    const yAxis = stage.querySelector('.prism-y-axis');
    const below = stage.querySelector('.prism-x-axis').offsetHeight + 4;
    const side = Math.max(140, Math.floor(Math.min(stage.clientHeight - below,
      stage.clientWidth - yAxis.offsetWidth - 12)));
    stage.style.setProperty('--prism-side', `${side}px`);
  };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  byId('prismPtcOn').onclick = () => {
    prismPtcSet({ on: !prismPtc().on });
    prismShowPtc();
  };
  // Playback Speed and the faders: live, as Hyperprism's windows were.
  for (const [id, key] of [['prismSpeed', 'speed'], ['prismFaderL', 'l'], ['prismFaderLR', 'lr'], ['prismFaderR', 'r']]) {
    const el = byId(id);
    el.oninput = () => prismFaderSet(key, +el.value);
    // Double-click puts it back to the middle, as every control here does.
    el.ondblclick = () => prismFaderSet(key, 128);
  }
  for (const [id, key] of [['prismFaderZeroL', 'l'], ['prismFaderZeroLR', 'lr'], ['prismFaderZeroR', 'r']]) {
    byId(id).onclick = () => prismFaderSet(key, 128);
  }
  byId('prismPreset').onchange = (e) => prismPresetChosen(e.target.value);
  byId('prismPresetSave').onclick = () => prismPresetSave();
  byId('prismPresetRename').onclick = () => prismPresetRename();
  byId('prismPresetDelete').onclick = () => prismPresetDelete();
  byId('prismPostRoll').onchange = (e) => prismPostRollChanged(e.target);
  byId('prismRec').onclick = () => prismToggleRecord();
  byId('prismLoop').onclick = () => prismToggleLoop();
  // The transport's state reaches the button however it was changed.
  setInterval(() => { if (!byId('dockPrism')?.classList.contains('hidden')) prismShowRecord(); }, 250);
})();
