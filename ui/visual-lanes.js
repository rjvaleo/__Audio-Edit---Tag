// ─── VISUAL LANES — the picture's automation ─────────────────────────────────
//
// The grain has lanes on the server and the sequencer has its take. This gives
// the picture the same: lanes that move the camera, the ring, the solid, the
// air and the layers over the document's time, recorded by the same REC PERF,
// drawn on the same timeline, and read by the film frame by frame.
// `docs/COMPOSE.md`, phase three.
//
// **A lane is the grain's shape.** `{ id, target, label, enabled, points:
// [{ frame, value, curve, tension }] }`, frames in output frames at the file's
// rate and values from nought to one — so the timeline draws it and the lane
// editor edits it with the code the grain's lanes already use. Only the target
// namespace (`visual.…`) and the store differ: these are kept per document on
// the server in `VISUAL-AUTOMATION.json`, beside the grain's.
//
// **Recording listens rather than intercepts.** The picture has many hands on
// it — sliders, the channel box, the camera's gestures, the beads, the wheel,
// the keys — and routing every one of them through a setter would be a rewrite
// of each. Instead, once a frame while the transport runs, every target is read
// and compared with what it was: a value that moved, and was not moved by a
// lane, is the hand. The server records the grain's controls the same way,
// comparing the panel before and after.
//
// **The hand wins.** A target the hand has just moved is left alone by its lane
// for a moment (`VIS_HAND_HOLD_MS`); while recording in latch it is left alone
// until the transport stops, and its value is written throughout.
//
// Loaded after `app.js`, whose state and functions it uses.

/// How long a lane waits after the hand has moved its target.
const VIS_HAND_HOLD_MS = 400;

// ─── the targets ─────────────────────────────────────────────────────────────

/// A continuous value on a range, logarithmic where the control is, rounded
/// where the control counts whole numbers.
function visRangeTarget(key, label, short, get, set, range, opt = {}) {
  return { key, label, short, get, set, range, log: !!opt.log, int: !!opt.int, paint: opt.paint || 'room' };
}

/// One of the camera's channel box attributes, read and written through the
/// channel box's own functions, so a lane moves the camera exactly as typing
/// into the channel does.
function visCameraTarget(key, label, short, channel, lo, hi, log) {
  const ch = () => ROOM_CAM_CHANNELS.find(([id]) => id === channel);
  return visRangeTarget(`camera.${key}`, `Camera — ${label}`, short,
    () => { const c = ch(); return c ? c[1](roomWorldNow()) : 0; },
    (v) => { const c = ch(); if (!c) return; const w = roomWorldNow(); c[2](w, v); roomSetWorld(w); },
    () => [lo, hi], { log, paint: 'camera' });
}

/// A slider on the Room tab: its range is the slider's own, in its own units.
function visSliderTarget(id, key, k, label, short, opt = {}) {
  return visRangeTarget(`room.${key}`, label, short,
    () => +roomEdit[key] || 0,
    (v) => { roomEdit[key] = opt.int ? Math.round(v) : v; },
    () => { const el = $(id); return el ? [+el.min / k, +el.max / k] : [0, 1]; }, opt);
}

/// On or off.
function visSwitchTarget(key, label, short, get, set, paint) {
  return visRangeTarget(key, label, short, () => (get() ? 1 : 0), (v) => set(v >= 0.5), () => [0, 1], { int: true, paint });
}

/// Every value in the picture a lane can move.
const VIS_TARGETS = [
  visCameraTarget('x', 'Translate X', 'CAM X', 'reCamTx', -20, 20),
  visCameraTarget('height', 'Translate Y', 'CAM Y', 'reCamTy', 0, 10),
  visCameraTarget('z', 'Translate Z', 'CAM Z', 'reCamTz', -20, 20),
  visCameraTarget('pitch', 'Rotate X', 'CAM TILT', 'reCamRx', -89, 89),
  visCameraTarget('yaw', 'Rotate Y', 'CAM TURN', 'reCamRy', -180, 180),
  visCameraTarget('focal', 'Focal length', 'CAM FOCAL', 'reCamFocal', 4, 600, true),
  visCameraTarget('coi', 'Center of interest', 'CAM COI', 'reCamCoi', 0.05, 20, true),
  visSliderTarget('reRing', 'ringScale', 100, 'Ring — Size', 'RING SIZE'),
  visSliderTarget('reRingDrive', 'ringDrive', 100, 'Ring — Drive', 'RING DRIVE'),
  visSliderTarget('reRingEdge', 'ringEdge', 1000, 'Ring — Stroke', 'RING STROKE'),
  visSliderTarget('reRingPoints', 'ringPoints', 1, 'Ring — Smooth', 'RING SMOOTH', { int: true }),
  visSliderTarget('reSolidSpin', 'solidSpin', 100, 'Solid — Turn', 'SOLID TURN'),
  visSliderTarget('reSolidSwell', 'solidSwell', 100, 'Solid — Swell', 'SOLID SWELL'),
  visSliderTarget('reSolidEye', 'solidEye', 100, 'Solid — Eye', 'SOLID EYE'),
  visSliderTarget('reSolidSize', 'solidSize', 100, 'Solid — Size', 'SOLID SIZE'),
  visRangeTarget('room.solidShape', 'Solid — Shape', 'SOLID SHAPE',
    () => Math.max(0, visShapes().indexOf(roomEdit.solidShape)),
    (v) => { const all = visShapes(); const s = all[Math.round(v)]; if (s) roomEdit.solidShape = s; },
    () => [0, Math.max(0, visShapes().length - 1)], { int: true }),
  visSliderTarget('reGrainDensity', 'grainDensity', 100, 'Grains — Cloud', 'CLOUD'),
  visSliderTarget('reGrainBright', 'grainBright', 100, 'Grains — Burn', 'BURN'),
  visSwitchTarget('room.fog', 'Fog — On', 'FOG', () => roomEdit.fog, (on) => { roomEdit.fog = on; }, 'room'),
  visSliderTarget('reFogDensity', 'fogDensity', 100, 'Fog — Density', 'FOG DENSITY'),
  visSwitchTarget('room.mist', 'Mist — On', 'MIST', () => roomEdit.mist, (on) => { roomEdit.mist = on; }, 'room'),
  visSliderTarget('reMistAmount', 'mistAmount', 100, 'Mist — Amount', 'MIST AMOUNT'),
  visSliderTarget('reMistLength', 'mistLength', 1000, 'Mist — Length', 'MIST LENGTH'),
  visSliderTarget('reOpacity', 'opacity', 100, 'Data — Opacity', 'DATA OPACITY'),
  ...ROOM_LAYERS.map((l) => visSwitchTarget(`layer.${l.key}`, `Layer — ${l.label}`, `LAYER ${l.label.toUpperCase()}`,
    () => roomLayerOn(l.key), (on) => { roomEdit.layers[l.key] = on; }, 'layers')),
];

/// The keys of `roomEdit` the targets write — what the film puts back after it
/// borrows the room for a frame.
const VIS_ROOM_KEYS = ['ringScale', 'ringDrive', 'ringEdge', 'ringPoints', 'solidSpin', 'solidSwell',
  'solidEye', 'solidSize', 'solidShape', 'grainDensity', 'grainBright', 'fog', 'fogDensity', 'mist',
  'mistAmount', 'mistLength', 'opacity'];

/// Every solid, in the order the menu lists them.
function visShapes() {
  const sel = $('reSolidShape');
  return sel && sel.options.length ? [...sel.options].map((o) => o.value) : [roomEdit.solidShape];
}

function visTarget(target) {
  const key = String(target || '').replace(/^visual\./, '');
  return VIS_TARGETS.find((t) => t.key === key) || null;
}

function visToUnit(t, v) {
  const [lo, hi] = t.range();
  if (!(hi > lo)) return 0;
  if (t.log && lo > 0) return Math.max(0, Math.min(1, Math.log(Math.max(lo, v) / lo) / Math.log(hi / lo)));
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

function visFromUnit(t, u) {
  const [lo, hi] = t.range();
  const k = Math.max(0, Math.min(1, u));
  const v = t.log && lo > 0 ? lo * Math.pow(hi / lo, k) : lo + (hi - lo) * k;
  return t.int ? Math.round(v) : v;
}

/// The menu's list of what a visual lane can move.
function visualTargetOptions() {
  return VIS_TARGETS.map((t) => [`visual.${t.key}`, t.label]);
}

/// The short name a lane goes by on the timeline, where there is room for
/// fourteen characters.
function visualLaneShort(lane) {
  return visTarget(lane.target)?.short || perfLaneLabel(lane);
}

// ─── the lanes, per document ─────────────────────────────────────────────────

const visualLanes = { path: null, lanes: [] };

function visualTimelineLanes() {
  return visualLanes.lanes;
}

/// The value a lane has at an output frame: held flat before its first point
/// and after its last, and between two points on the first one's curve — the
/// rule the grain's lanes play by.
function visLaneValueAt(lane, frame) {
  const pts = lane.points;
  if (!pts || !pts.length) return null;
  if (frame <= pts[0].frame) return pts[0].value;
  const end = pts[pts.length - 1];
  if (frame >= end.frame) return end.value;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].frame <= frame) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const t = b.frame > a.frame ? (frame - a.frame) / (b.frame - a.frame) : 1;
  return a.value + (b.value - a.value) * curveT(t, a);
}

async function loadVisualLanes() {
  const f = state.selectedFile;
  visualLanes.path = f ? f.path : null;
  visualLanes.lanes = [];
  if (f) {
    try {
      const r = await api(`/api/visual-automation?p=${encodeURIComponent(f.path)}`);
      if (visualLanes.path !== f.path) return;
      visualLanes.lanes = (Array.isArray(r.lanes) ? r.lanes : [])
        .filter((l) => l && typeof l.target === 'string' && Array.isArray(l.points))
        .map((l) => ({ ...l, points: l.points.slice().sort((a, b) => a.frame - b.frame) }));
    } catch { /* nothing stored for this document yet */ }
  }
  if (typeof perfBumpLanes === 'function') perfBumpLanes();
  if ($('perfCanvas')) { perfFillLaneSelect(); perfUpdateHeader(); perfDrawTimeline(); }
}

let visSaveTimer = null;
function saveVisualLanes() {
  if (typeof perfBumpLanes === 'function') perfBumpLanes();
  clearTimeout(visSaveTimer);
  visSaveTimer = setTimeout(async () => {
    if (!visualLanes.path) return;
    try {
      await postJSON('/api/visual-automation', { p: visualLanes.path, lanes: visualLanes.lanes });
    } catch (e) {
      toast('Visual lanes could not be saved: ' + e.message);
    }
  }, 150);
}

// ─── recording and replay ────────────────────────────────────────────────────

const vis = {
  take: 0,
  lastSeen: {}, lastApplied: {}, touchedAt: {}, latched: {},
  takeStart: {}, lastPoint: {},
  dirty: false, lastSync: 0,
};

/// The transport started: every target's value is where the hand left it.
function visualLanesStart() {
  vis.take = Date.now();
  vis.lastApplied = {};
  vis.touchedAt = {};
  vis.latched = {};
  vis.takeStart = {};
  vis.lastPoint = {};
  vis.lastSeen = {};
  for (const t of VIS_TARGETS) vis.lastSeen[t.key] = visToUnit(t, t.get());
}

/// The transport stopped: a take is kept.
function visualLanesStop() {
  vis.latched = {};
  if (!vis.dirty) return;
  vis.dirty = false;
  for (const lane of visualLanes.lanes) {
    for (const p of lane.points) delete p.take;
  }
  saveVisualLanes();
  if ($('perfCanvas')) { perfFillLaneSelect(); perfUpdateHeader(); perfDrawTimeline(); }
}

/// Write the hand's value into its lane, over whatever this take has covered.
function visWritePoint(t, frame, unit) {
  const target = `visual.${t.key}`;
  let lane = visualLanes.lanes.find((l) => l.target === target);
  if (!lane) {
    lane = { id: `vis:${t.key}`, target, label: t.label, enabled: true, trim: 0, loop: null, modulators: [], points: [] };
    visualLanes.lanes.push(lane);
  }
  const last = vis.lastPoint[t.key];
  // Thinned: a point within thirty milliseconds of the last says nothing new
  // unless the value moved with it.
  if (last && Math.abs(frame - last.frame) < 0.03 * perfRate() && Math.abs(unit - last.value) < 0.002) return;
  if (vis.takeStart[t.key] === undefined) vis.takeStart[t.key] = frame;
  const from = Math.min(vis.takeStart[t.key], frame);
  lane.points = lane.points.filter((p) => p.take === vis.take || p.frame < from || p.frame > frame);
  const p = { frame: Math.round(frame), value: unit, curve: 'linear', tension: 0, take: vis.take };
  lane.points.push(p);
  lane.points.sort((a, b) => a.frame - b.frame);
  vis.lastPoint[t.key] = p;
  vis.dirty = true;
}

/// Once a frame while the transport runs: hear the hand, then play the lanes.
function visualLanesTick() {
  if (!visualLanes.path || visualLanes.path !== state.selectedFile?.path) return;
  const now = performance.now();
  const frame = playbackTime() * perfRate();
  const mode = state.automationRecord;
  const recording = !!engine.playing && !!mode && mode !== 'off';
  const bypassed = !!state.automation?.bypassed;
  const paint = { camera: false, room: false, layers: false };

  for (const t of VIS_TARGETS) {
    const unit = visToUnit(t, t.get());
    const applied = vis.lastApplied[t.key];
    const seen = vis.lastSeen[t.key];
    const ref = applied !== undefined ? applied : seen;
    const moved = ref !== undefined && Math.abs(unit - ref) > 1e-4;
    vis.lastSeen[t.key] = unit;
    if (moved) {
      vis.touchedAt[t.key] = now;
      delete vis.lastApplied[t.key];
      if (recording && mode === 'latch') vis.latched[t.key] = true;
    }
    const handOn = now - (vis.touchedAt[t.key] ?? -1e9) < VIS_HAND_HOLD_MS || !!vis.latched[t.key];
    if (recording && (moved || handOn)) {
      visWritePoint(t, frame, unit);
      continue;
    }
    if (handOn || bypassed) continue;
    const lane = visualLanes.lanes.find((l) => l.target === `visual.${t.key}`);
    if (!lane || lane.enabled === false || !lane.points?.length) continue;
    const u = visLaneValueAt(lane, frame);
    if (u === null || (applied !== undefined && Math.abs(applied - u) < 1e-6)) continue;
    t.set(visFromUnit(t, u));
    const took = visToUnit(t, t.get());
    vis.lastApplied[t.key] = took;
    vis.lastSeen[t.key] = took;
    paint[t.paint] = true;
  }

  if (paint.camera || paint.room) paintRoomNums();
  if (paint.layers) buildRoomLayers();
  if ((paint.room || paint.layers) && now - vis.lastSync > 120) {
    vis.lastSync = now;
    syncRoomSliders();
  }
}

// ─── the film ────────────────────────────────────────────────────────────────

/// What the film draws at `seconds` of the document's output time: the
/// camera, the layers and the room's own values as the lanes have them there.
///
/// The live room is borrowed for the length of one call — every lane written
/// into it, the film's settings read out through the same functions the export
/// uses, and everything put back — so what is filmed is what the room would be,
/// and the room on screen is left as it was. Nothing is painted in between, so
/// nothing flickers.
function visualFilmFrame(seconds, aspect) {
  const lanes = visualLanes.lanes.filter((l) => l.enabled !== false && l.points?.length);
  if (!lanes.length || state.automation?.bypassed) return null;
  const keep = {
    cams: JSON.parse(JSON.stringify(roomEdit.cams || {})),
    layers: { ...roomEdit.layers },
    frame: roomEdit.frame,
    keys: Object.fromEntries(VIS_ROOM_KEYS.map((k) => [k, roomEdit[k]])),
  };
  try {
    // Camera lanes move the camera the film is shot with.
    const shot = typeof roomFrameForAspect === 'function' ? roomFrameForAspect(aspect) : null;
    if (shot) roomEdit.frame = shot;
    const frame = seconds * perfRate();
    for (const lane of lanes) {
      const t = visTarget(lane.target);
      if (!t) continue;
      const u = visLaneValueAt(lane, frame);
      if (u !== null) t.set(visFromUnit(t, u));
    }
    return {
      cam: roomCameraForAspect(aspect),
      layers: { ...roomLayers(), grid: false },
      room: {
        ringDrive: roomEdit.ringDrive, ringEdge: roomEdit.ringEdge, ringPoints: roomEdit.ringPoints,
        solidShape: roomEdit.solidShape, solidSpin: roomEdit.solidSpin, solidSwell: roomEdit.solidSwell,
        solidEye: roomEdit.solidEye, solidSize: roomEdit.solidSize,
        grainDensity: roomEdit.grainDensity, grainBright: roomEdit.grainBright,
        mist: { on: roomEdit.mist, amount: roomEdit.mistAmount, length: roomEdit.mistLength },
        fog: roomFog(),
      },
    };
  } finally {
    roomEdit.cams = keep.cams;
    roomEdit.layers = keep.layers;
    roomEdit.frame = keep.frame;
    Object.assign(roomEdit, keep.keys);
  }
}
