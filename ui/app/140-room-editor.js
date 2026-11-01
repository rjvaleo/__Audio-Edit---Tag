// ───────────────────────────────────────────────────────────── the room editor
//
// The room's shape and camera are numbers nobody can picture. `floorY` at -0.38
// against `ceilY` at 0.62 is not a quantity, it is *how far you are looking
// down*, and the only way to choose it is to look down and see. So there is
// nothing to type here: you drag the room and the room moves. The numbers are
// an output, shown so a result worth keeping can become the default in
// `vis-gl.js`. See `docs/ROOM-EDITOR.md`.

/// The frame shapes the video export offers, plus the dock's own.
///
/// Each keeps its own camera, because the constants that suit a wide panel do
/// not survive being narrowed — at 9:16 the room is a third of the width it was
/// designed for and the sky ring, whose radius comes from the height and so
/// does not shrink with it, takes 60% of what is left.
const ROOM_FRAMES = [
  { key: 'dock', label: 'Dock', ratio: 0 },
  { key: '16x9', label: '16:9', ratio: 16 / 9 },
  { key: '1x1', label: '1:1', ratio: 1 },
  { key: '4x5', label: '4:5', ratio: 4 / 5 },
  { key: '9x16', label: '9:16', ratio: 9 / 16 },
];

/// What the source ships. Kept here as well as in `vis-gl.js` so a drag has
/// something to start from and Reset has something to go back to.
const ROOM_CAM_DEFAULT = {
  depth: 1.9, floorY: -0.38, ceilY: 0.62, shiftX: 0, skyAt: 0.72, ring: 0.17,
  // How wide and how tall the far rectangle is against the near one, before the
  // perspective divide. One is the straight prism this room always was.
  backW: 1, backH: 1,
};

/// What the room draws. Each part is its own decision.
///
/// The box was one picture with four things always in it. Turned on and off
/// separately they are a set: terrain alone is a landscape, the ring alone is a
/// scope hanging in the dark, the wireframe alone is the room empty. The
/// renderer defaults to all of them, so anything that does not pass this — the
/// grain views, a test — draws what it always drew.
const ROOM_LAYERS = [
  { key: 'grid', label: 'Ground', hint: 'The grid on the ground, running to the horizon. Light grey, heavier every fourth line, so distance can be counted.' },
  { key: 'floor', label: 'Terrain', hint: 'The spectrum along the floor, receding as it ages.' },
  { key: 'lead', label: 'Edge', hint: 'The frame you are hearing now, drawn with weight along the near edge.' },
  { key: 'sky', label: 'Ring', hint: 'The Lissajous hanging in the sky, pushed out of round by the sound.' },
  { key: 'skin', label: 'Skin', hint: 'The surface between the rings, so the trail is a tube rather than a stack of hoops. Stands on its own — the hoops can be off.' },
  { key: 'grains', label: 'Grains', hint: 'Every grain in the schedule, as a streak: depth is when it sounds, its length is how long for, across is pan and up is pitch.' },
  { key: 'solid', label: 'Solid', off: true, hint: 'A four-dimensional solid hanging with the ring, turned through the fourth dimension by the sound — loud passages pass its cells through each other, which no amount of turning in three dimensions can do. The spectrum pushes its vertices out, so it breathes as well as turns. Off by default.' },
  // Not drawn in the room. It is HTML printed on the back wall, which is why it
  // has neither a place in the hierarchy nor an occlusion switch: it is not in
  // the scene the depth buffer describes, and offering it either control would
  // be offering a control that does nothing.
  { key: 'data', label: 'Data', gl: false, hint: 'The schedule itself, printed on the back wall. Not drawn in the room — it is type on the wall, so it neither occludes nor takes a place in the hierarchy.' },
];

/// The layers the renderer actually draws. `data` is the one that is not.
const ROOM_GL_LAYERS = ROOM_LAYERS.filter((l) => l.gl !== false);

/// The visual modules, by key.
///
/// **A plain list, and here rather than beside `VIS_MODULES`.** The stored
/// settings are read at load, which is before `VIS_MODULES` exists — and a
/// `const` referenced before its declaration does not come back undefined, it
/// throws, so reaching for it there takes the whole script down. `VIS_MODULES`
/// carries the canvases and the attach functions and cannot move up here
/// because those are defined later still.
///
/// The two are kept in step by a test rather than by hope.
const VIS_MODULE_KEYS = ['room', 'ridge', 'room3d', 'stage'];

/// How many rows travel together before a blank line, and which way each block
/// runs. Alternating blocks read in opposite directions, so neighbouring groups
/// slide against each other and the movement is visible — a single column all
/// going one way at this size reads as a static texture.
const ROOM_CHUNKS = [2, 4, 8];

const roomEdit = {
  on: false, frame: 'dock', cams: {}, drag: null, pick: null, hover: false, layers: {},
  chunk: 4,
  opacity: 0.7,
  /// Highest first. Kept as a list rather than as a rank on each layer because
  /// the thing being edited is an order, and an order is a list.
  order: ROOM_GL_LAYERS.map((l) => l.key),
  /// Which layers stand in the way of the ones below them.
  occlude: {},
  /// How big the ring is, as a multiple of the camera's own `ring`. The camera
  /// holds the pose; this is the size, and they are two different questions —
  /// posing the room should not resize what is in it.
  ringScale: 1,
  /// How much of the cloud is drawn, and how hot it burns.
  ///
  /// **Both are about the picture and neither is about the sound.** The cloud's
  /// rate has its own control in front of the engine — `Density`, in grains per
  /// second — and that one changes what you hear. This one changes how many of
  /// the grains that *are* sounding get a shape in the room, which at a few
  /// hundred a second is the difference between a cloud you can see through and
  /// a fog. Naming them both density is unfortunate and unavoidable: they are
  /// both the density of a cloud, one you hear and one you look at.
  grainDensity: 1,
  grainBright: 1,
  /// How hard the sound pushes the ring out of round. One is what it always was.
  /// The four-dimensional solid: which one, how hard the sound turns it
  /// through the fourth dimension, how far the spectrum swells it, and where
  /// the eye stands on the w axis.
  solidShape: 'cell8',
  solidSpin: 1,
  solidSwell: 0.6,
  solidEye: 2.5,
  /// Its own place in the room. The ring is at 0.72; this is deliberately
  /// elsewhere, because they are two different things.
  solidSize: 0.3,
  /// The path the trail travels, front first. `x` runs -1 at the left wall to 1
  /// at the right, `y` 0 on the floor to 1 at the ceiling, `z` 0 at the near
  /// face to 1 at the back wall. Two points is a straight run; anything between
  /// them is a waypoint the shape passes through.
  solidPath: [{ x: 0, y: 0.42, z: -1.152 }, { x: 0, y: 0.42, z: -2.9 }],
  ringDrive: 1,
  /// How thick the dark border under the ring's lines is, as a fraction of the
  /// ring's radius.
  ringEdge: 0.035,
  /// How finely the ring is drawn. What is *stored* is the whole trace either
  /// way, so this can be moved while looking at it.
  ringPoints: 1024,
  /// The thick band over the frame being heard now. The ridge line under it is
  /// drawn either way — see `drawLead`.
  leadThick: true,
  /// Filling the grain shapes in.
  ///
  /// `bg` is not a colour. The room is drawn on glass with the page's own
  /// ground behind it, so filling with "the background" means taking the light
  /// out of what is behind the shape rather than painting anything over it —
  /// a different pass, which is why it is a state and not a swatch value.
  /// Smoke dripping off the shapes: whether, how much, and how long the drips
  /// are as a fraction of a grain's whole journey.
  /// Distance fog. Its own thing entirely from the mist: the mist is particles
  /// shed by grains, and this is what the air does to everything behind it.
  fog: false,
  fogType: 1,
  fogDensity: 0.5,
  fogColour: '#7f8fa6',
  mist: false,
  mistAmount: 0.5,
  mistLength: 0.06,
  grainFill: false,
  grainFillBg: true,
  grainFillColour: '#1b2b3a',
  /// The room's own shape, as against the camera's pose.
  ///
  /// **These are not the camera and they are kept apart from it on purpose.**
  /// The camera is where you stand — what dragging writes, what `reNums` prints
  /// and what gets pasted back into `vis-gl.js` as a new default. This is what
  /// the room *is*: how wide the floor is resolved, how far back the trail runs
  /// before it reaches the wall, how tall the terrain stands. A camera copied
  /// out should not carry somebody's floor resolution with it, the same
  /// argument that keeps the ring's size out of it.
  ///
  /// Null means the shape the renderer ships with.
  geomBands: 280,
  geomHistory: 56,
  geomRidge: 0.62,
  /// How many seconds of sound the room's depth stands for, and how big a
  /// grain is drawn. Both are the scale of the box rather than a pose in it.
  geomSpan: 14,
  geomBody: 0.032,
  /// How wide the terrain is, in the world's units. A size, not a property of
  /// the camera: the box's floor was as wide as the frame, and a window of a
  /// different shape drew a different room. This does not.
  geomWidth: 1.78,
  /// How long the terrain is, in units, and where its front edge lies. The
  /// cloud, the mist and the motes ride on it; the ring and the solid have
  /// places of their own.
  geomReach: 1.9,
  geomAt: { x: 0, z: -1 },
  /// Which visualiser is on screen. See `VIS_MODULES`.
  module: 'room',
  /// The ridgeline's own settings. Its defaults live in `ridge.js` beside the
  /// renderer that reads them; this is only what has been changed from them.
  ridge: {},
};

/// **The room as shipped.** Every setting's default, copied before anything
/// saved is read, so Clear has something to put back.
const ROOM_EDIT_FACTORY = JSON.parse(JSON.stringify(roomEdit));

/// Clear: the whole room back to its defaults — every setting, every camera,
/// the paint, the path and its waypoints — and the trail emptied with it.
/// The editor stays open on the frame it was on; that is where you are, not a
/// setting. Keys that only exist because a saved scene put them there are
/// dropped, so their defaults come from their own tables again.
function roomClear() {
  const keep = { on: roomEdit.on, frame: roomEdit.frame, drag: null };
  for (const k of Object.keys(roomEdit)) if (!(k in ROOM_EDIT_FACTORY)) delete roomEdit[k];
  Object.assign(roomEdit, JSON.parse(JSON.stringify(ROOM_EDIT_FACTORY)), keep);
  roomPaint.scheme = rpDefaultScheme();
  rpTouch();
  rpRemember();
  saveRoomData();
  saveRoomLayers();
  saveRoomHierarchy();
  saveRoomStreams();
  saveRoomCameras();
  rpApply();
  refreshVisualPanels();
  visGl?.clear?.();
  paintRoomNums();
  toast('Room cleared — every setting back to default');
}

/// The layers, in the order they are drawn — highest in the hierarchy first.
///
/// Anything that is not in the stored list is appended in the order
/// `ROOM_LAYERS` gives, so a layer added to the program later turns up at the
/// bottom rather than not at all.
function roomOrder() {
  const out = [];
  for (const k of roomEdit.order || []) {
    if (ROOM_GL_LAYERS.some((l) => l.key === k) && !out.includes(k)) out.push(k);
  }
  for (const l of ROOM_GL_LAYERS) if (!out.includes(l.key)) out.push(l.key);
  return out;
}

/// Whether anything in the room is standing in anything else's way.
///
/// **The hierarchy does nothing until something does.** Everything in this room
/// is drawn with additive blending, and addition does not care what order it
/// happens in — with nothing occluding, reversing the whole stack gives a
/// picture identical to the last pixel. It is only when a layer writes depth
/// that being drawn earlier means anything at all, and the list says so rather
/// than letting somebody drag rows around expecting a change they cannot get.
function roomHierarchyLive() {
  return ROOM_GL_LAYERS.some((l) => roomLayerOn(l.key) && roomOccludeOn(l.key));
}

/// Off unless somebody has turned it on. Occlusion changes what the room looks
/// like fundamentally, so it is asked for rather than assumed.
function roomOccludeOn(key) {
  return roomEdit.occlude[key] === true;
}

function roomOcclude() {
  const out = {};
  for (const l of ROOM_GL_LAYERS) out[l.key] = roomOccludeOn(l.key);
  return out;
}

/// Take a stored room in, field by field, each one checked and clamped.
///
/// One reader for both places a room comes from: what this browser kept, and a
/// look recalled from a section preset. A room written before a control
/// existed simply leaves that control where it is.
function readRoomData(v) {
  if (!v || typeof v !== 'object') return;
  if (ROOM_CHUNKS.includes(v.chunk)) roomEdit.chunk = v.chunk;
  if (typeof v.opacity === 'number') roomEdit.opacity = Math.max(0.05, Math.min(1, v.opacity));
  if (typeof v.ringScale === 'number') {
    roomEdit.ringScale = Math.max(0.15, Math.min(3, v.ringScale));
  }
  if (typeof v.grainDensity === 'number') {
    roomEdit.grainDensity = Math.max(0.04, Math.min(1, v.grainDensity));
  }
  if (typeof v.grainBright === 'number') {
    roomEdit.grainBright = Math.max(0.15, Math.min(3, v.grainBright));
  }
  // Validated like everything else here: a stored shape the catalogue no longer
  // offers falls back rather than leaving the layer drawing nothing.
  if (typeof v.solidShape === 'string'
      && ((typeof Shapes4D !== 'undefined' && Shapes4D.entry(v.solidShape))
        || (typeof GRAIN_SHAPES !== 'undefined'
          && GRAIN_SHAPES.some((m) => m.name === v.solidShape)))) {
    roomEdit.solidShape = v.solidShape;
  }
  if (typeof v.solidSpin === 'number') roomEdit.solidSpin = Math.max(0, Math.min(8, v.solidSpin));
  if (typeof v.solidSwell === 'number') roomEdit.solidSwell = Math.max(0, Math.min(2, v.solidSwell));
  if (typeof v.solidEye === 'number') roomEdit.solidEye = Math.max(1.4, Math.min(8, v.solidEye));
  if (typeof v.solidSize === 'number') roomEdit.solidSize = Math.max(0.04, Math.min(0.9, v.solidSize));
  // A path needs at least a front and an end. Anything shorter, or carrying a
  // number that is not one, falls back to the straight run rather than leaving
  // the layer with a path it cannot walk.
  // The path, in units, anywhere at all. A path from before the world —
  // fractions of the box — is laid where the box would have put it, once.
  if (Array.isArray(v.solidPath) && v.solidPath.length >= 2) {
    const units = v.solidPathUnits === true;
    const pts = v.solidPath
      .filter((q) => q && Number.isFinite(+q.x) && Number.isFinite(+q.y) && Number.isFinite(+q.z))
      .map((q) => (units ? { x: +q.x, y: +q.y, z: +q.z } : {
        x: +q.x * roomEdit.geomWidth / 2,
        y: +q.y * VG_WORLD_H,
        z: roomEdit.geomAt.z - +q.z * roomEdit.geomReach,
      }));
    if (pts.length >= 2) roomEdit.solidPath = pts;
  }
  if (typeof v.ringDrive === 'number') {
    roomEdit.ringDrive = Math.max(0, Math.min(8, v.ringDrive));
  }
  if (typeof v.ringEdge === 'number') {
    roomEdit.ringEdge = Math.max(0, Math.min(0.25, v.ringEdge));
  }
  if (typeof v.ringPoints === 'number') {
    roomEdit.ringPoints = Math.max(48, Math.min(2048, Math.round(v.ringPoints)));
  }
  if (typeof v.leadThick === 'boolean') roomEdit.leadThick = v.leadThick;
  // The card of type. Taken whole rather than field by field: `rtSettings`
  // merges it over the defaults, so a card saved before a control existed opens
  // with that control at its default instead of undefined.
  if (v.text && typeof v.text === 'object') roomEdit.text = v.text;
  if (v.room3d && typeof v.room3d === 'object') roomEdit.room3d = v.room3d;
  if (v.stage && typeof v.stage === 'object') roomEdit.stage = v.stage;
  // The room's own shape. Clamped to the same range the renderer clamps to, so
  // a stored value can never ask for a room it will not draw.
  if (typeof v.geomBands === 'number') {
    roomEdit.geomBands = Math.max(8, Math.min(2048, Math.round(v.geomBands)));
  }
  if (typeof v.geomHistory === 'number') {
    roomEdit.geomHistory = Math.max(2, Math.min(240, Math.round(v.geomHistory)));
  }
  if (typeof v.geomRidge === 'number') {
    roomEdit.geomRidge = Math.max(0.02, Math.min(1.6, v.geomRidge));
  }
  if (typeof v.geomSpan === 'number') {
    roomEdit.geomSpan = Math.max(0.5, Math.min(90, v.geomSpan));
  }
  if (typeof v.geomBody === 'number') {
    roomEdit.geomBody = Math.max(0.002, Math.min(0.3, v.geomBody));
  }
  if (typeof v.geomWidth === 'number') {
    roomEdit.geomWidth = Math.max(0.2, Math.min(40, v.geomWidth));
  }
  if (typeof v.geomReach === 'number') {
    roomEdit.geomReach = Math.max(0.2, Math.min(40, v.geomReach));
  }
  if (v.geomAt && Number.isFinite(v.geomAt.x) && Number.isFinite(v.geomAt.z)) {
    roomEdit.geomAt = { x: v.geomAt.x, z: v.geomAt.z };
  }
  // Any module there is. This said `'ridge' || 'room'`, so a third module was
  // remembered, stored, and then silently dropped on the way back in — the app
  // opened on the room every time with nothing on screen to say why.
  if (VIS_MODULE_KEYS.includes(v.module)) roomEdit.module = v.module;
  // The visual, which may be a grain view and so is not one of the module keys.
  // Left as it is found and checked against the registry when it is read — the
  // registry is not loaded yet here, and reaching for it would throw.
  if (typeof v.visual === 'string') roomEdit.visual = v.visual;
  if (v.ridge && typeof v.ridge === 'object') roomEdit.ridge = { ...v.ridge };
  if (typeof v.fog === 'boolean') roomEdit.fog = v.fog;
  if (typeof v.fogType === 'number') roomEdit.fogType = Math.max(0, Math.min(3, v.fogType | 0));
  if (typeof v.fogDensity === 'number') {
    roomEdit.fogDensity = Math.max(0, Math.min(2, v.fogDensity));
  }
  if (typeof v.fogColour === 'string' && /^#[0-9a-f]{6}$/i.test(v.fogColour)) {
    roomEdit.fogColour = v.fogColour;
  }
  if (typeof v.mist === 'boolean') roomEdit.mist = v.mist;
  if (typeof v.mistAmount === 'number') {
    roomEdit.mistAmount = Math.max(0.06, Math.min(1, v.mistAmount));
  }
  if (typeof v.mistLength === 'number') {
    roomEdit.mistLength = Math.max(0.004, Math.min(0.6, v.mistLength));
  }
  if (typeof v.grainFill === 'boolean') roomEdit.grainFill = v.grainFill;
  if (typeof v.grainFillBg === 'boolean') roomEdit.grainFillBg = v.grainFillBg;
  if (typeof v.grainFillColour === 'string' && /^#[0-9a-f]{6}$/i.test(v.grainFillColour)) {
    roomEdit.grainFillColour = v.grainFillColour;
  }
}

// The cameras, one per frame shape, as world cameras.
//
// `roomCameras` holds what `main` wrote: box cameras. Read here once, turned
// into world cameras with the frame's own aspect, and kept under a key of
// this branch's own — so the old key stays as it was for `main`, and a room
// posed there opens here looking the same. See `docs/OPEN-WORLD.md`.
const ROOM_CAMERAS_KEY = 'roomCamerasWorld';
function roomCamerasMigrate(boxes) {
  const out = {};
  for (const [key, cam] of Object.entries(boxes || {})) {
    if (!cam || typeof cam !== 'object') continue;
    if (vgIsWorld(cam)) {
      // A camera from before the eye could move carried the reach; it is the
      // terrain's now, and the first one seen decides it.
      if (!(cam.v >= 2) && Number.isFinite(cam.reach) && !roomEdit.geomReachSet) {
        roomEdit.geomReach = cam.reach;
        roomEdit.geomReachSet = true;
      }
      out[key] = vgWorldUpgrade(cam);
      continue;
    }
    const frame = ROOM_FRAMES.find((f) => f.key === key);
    out[key] = vgWorldFromBox(cam, frame && frame.ratio > 0 ? frame.ratio : VG_WORLD_DEFAULT.aspect);
  }
  return out;
}
try {
  const kept = JSON.parse(localStorage.getItem(ROOM_CAMERAS_KEY) || 'null');
  if (kept && typeof kept === 'object') {
    roomEdit.cams = roomCamerasMigrate(kept);
  } else {
    roomEdit.cams = roomCamerasMigrate(JSON.parse(localStorage.getItem('roomCameras') || '{}') || {});
    if (Object.keys(roomEdit.cams).length) {
      try { localStorage.setItem(ROOM_CAMERAS_KEY, JSON.stringify(roomEdit.cams)); } catch {}
    }
  }
} catch { roomEdit.cams = {}; }

// The cameras first, above: a camera from before the eye could move carried
// the terrain's reach, and a path from before the world is laid along that
// reach — so the reach has to be known before the path is read.
try { readRoomData(JSON.parse(localStorage.getItem('roomData') || '{}')); } catch {}

/// The room as it is stored: every setting `readRoomData` reads back.
function roomDataSnapshot() {
  return {
    chunk: roomEdit.chunk, opacity: roomEdit.opacity, ringScale: roomEdit.ringScale,
    geomBands: roomEdit.geomBands, geomHistory: roomEdit.geomHistory,
    geomRidge: roomEdit.geomRidge,
    geomSpan: roomEdit.geomSpan, geomBody: roomEdit.geomBody,
    geomWidth: roomEdit.geomWidth, geomReach: roomEdit.geomReach, geomAt: roomEdit.geomAt,
    solidPathUnits: true,
    module: roomEdit.module, ridge: roomEdit.ridge, text: roomEdit.text,
    room3d: roomEdit.room3d,
    stage: roomEdit.stage ? { ...roomEdit.stage, solo: null } : roomEdit.stage,
    visual: roomEdit.visual,
    grainDensity: roomEdit.grainDensity, grainBright: roomEdit.grainBright,
    ringDrive: roomEdit.ringDrive, ringEdge: roomEdit.ringEdge,
    solidShape: roomEdit.solidShape, solidSpin: roomEdit.solidSpin,
    solidSwell: roomEdit.solidSwell, solidEye: roomEdit.solidEye,
    solidSize: roomEdit.solidSize, solidPath: roomEdit.solidPath,
    leadThick: roomEdit.leadThick, ringPoints: roomEdit.ringPoints,
    mist: roomEdit.mist, mistAmount: roomEdit.mistAmount,
    mistLength: roomEdit.mistLength,
    fog: roomEdit.fog, fogType: roomEdit.fogType,
    fogDensity: roomEdit.fogDensity, fogColour: roomEdit.fogColour,
    grainFill: roomEdit.grainFill, grainFillBg: roomEdit.grainFillBg,
    grainFillColour: roomEdit.grainFillColour,
  };
}

function saveRoomData() {
  try { localStorage.setItem('roomData', JSON.stringify(roomDataSnapshot())); } catch {}
}

try {
  roomEdit.layers = JSON.parse(localStorage.getItem('roomLayers') || '{}') || {};
} catch { roomEdit.layers = {}; }

try {
  const v = JSON.parse(localStorage.getItem('roomHierarchy') || 'null');
  if (v && Array.isArray(v.order)) roomEdit.order = v.order;
  if (v && v.occlude && typeof v.occlude === 'object') roomEdit.occlude = v.occlude;
} catch {}

function saveRoomHierarchy() {
  try {
    localStorage.setItem('roomHierarchy',
      JSON.stringify({ order: roomOrder(), occlude: roomEdit.occlude }));
  } catch {}
}

try {
  roomEdit.streams = JSON.parse(localStorage.getItem('roomStreams') || 'null');
} catch { roomEdit.streams = null; }

/// On unless somebody has turned it off.
/// Whether a layer is drawn. Absent means on, which is what makes every layer
/// this room shipped with keep drawing — except one that says otherwise.
///
/// **A layer added later cannot default to on.** The room is a picture people
/// have already arranged; one that gains an object because the program was
/// updated is a picture that changed by itself. `off: true` in `ROOM_LAYERS` is
/// how a new layer says "somebody has to ask for me", and the solid is the
/// first to use it.
function roomLayerOn(key) {
  const stored = roomEdit.layers[key];
  if (typeof stored === 'boolean') return stored;
  const spec = ROOM_LAYERS.find((l) => l.key === key);
  return !(spec && spec.off);
}

function roomLayers() {
  const out = {};
  for (const l of ROOM_LAYERS) out[l.key] = roomLayerOn(l.key);
  return out;
}

function saveRoomLayers() {
  try { localStorage.setItem('roomLayers', JSON.stringify(roomEdit.layers)); } catch {}
}


/// The aspect the room is being posed at right now: the frame's, or the
/// cell's when the frame is the dock's own.
function roomAspectNow() {
  const f = roomFrame();
  if (f && f.ratio > 0) return f.ratio;
  const gl = $('visGl');
  const w = gl?.clientWidth || 0, h = gl?.clientHeight || 0;
  return w > 0 && h > 0 ? w / h : VG_WORLD_DEFAULT.aspect;
}

/// Keep a world camera for the frame being posed.
function roomSetWorld(wc) {
  roomEdit.cams[roomEdit.frame] = { ...wc, v: 2, aspect: roomAspectNow() };
}

/// What to draw with. Null is "whatever the source says", which is what every
/// frame is until somebody poses it.
function roomCamera() {
  return roomEdit.cams[roomEdit.frame] || null;
}

/// The room's shape, as the renderer wants it.
///
/// One accessor for both callers. The live room and the film reading their
/// geometry from two places is the fault this program shipped over the
/// background colour, and there is no reason to leave a second one.
function roomGeom() {
  return {
    bands: roomEdit.geomBands,
    history: roomEdit.geomHistory,
    ridge: roomEdit.geomRidge,
    span: roomEdit.geomSpan,
    body: roomEdit.geomBody,
    width: roomEdit.geomWidth,
    reach: roomEdit.geomReach,
    at: roomEdit.geomAt,
  };
}

/// The air, as the renderer wants it.
///
/// The near and far are the room's own front and back rather than numbers
/// anybody types: linear fog that ran out somewhere other than the back wall
/// would be a control about the fog rather than about the room.
function roomFog() {
  const cam = roomWorldNow();
  return {
    on: roomEdit.fog,
    type: roomEdit.fogType,
    rgb: vgHexRgb(roomEdit.fogColour),
    density: roomEdit.fogDensity,
    near: 1,
    far: 1 + roomEdit.geomReach,
    // Height fog rises from the ground, and the ground is nought.
    height: 0,
  };
}

/// `#rrggbb` as the three floats the shaders want.
/// The ground the room is drawn on.
///
/// One answer, asked by both the live room and the film. They read two
/// different tokens before this — `--sink` for the cell on screen and `--bg`
/// for the export — which are a visibly different black, so an exported file
/// came out on a lighter ground than the room it was posed in.
function roomGroundColour() {
  const bg = rpSlot('background');
  if (bg.mode === 'flat' && bg.colour) return bg.colour;
  const cell = document.querySelector('#masterBus .mb-cell-3d');
  const v = cell ? getComputedStyle(cell).backgroundColor : '';
  return cssHex(v) || v || '#07090c';
}

/// Put the palette's two non-geometry slots on the page.
///
/// The data block and the ground are type and a background rather than marks in
/// the scene, so they are CSS and not shader work — but they are in the same
/// palette, because from the outside they are two more things in the room that
/// have a colour.
function applyRoomPaintCss() {
  const cell = document.querySelector('#masterBus .mb-cell-3d');
  const bg = rpSlot('background');
  if (cell) cell.style.background = bg.mode === 'flat' && bg.colour ? bg.colour : '';
  const data = $('roomData');
  const d = rpSlot('data');
  // The block fades down the wall in five steps, each a `color-mix` against
  // `--wave-2`. Overriding that one token inside the block keeps every step and
  // changes what they are steps *of*.
  if (data) data.style.setProperty('--wave-2', d.mode === 'flat' && d.colour ? d.colour : '');
  // Every control's picture is drawn in the colour of the part it moves.
  if (typeof cpRepaint === 'function') cpRepaint();
}

function vgHexRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/// Which posed frame a given shape is, by its aspect.
///
/// The export box offers nine sizes and the room keeps five cameras, and the
/// two are matched by shape rather than by name: 720p, HD, 1440p and 4K are all
/// 16:9 and all want the camera posed for 16:9.
function roomFrameForAspect(aspect) {
  let best = null, bestGap = Infinity;
  for (const f of ROOM_FRAMES) {
    if (f.ratio <= 0) continue;
    const gap = Math.abs(f.ratio - aspect);
    if (gap < bestGap) { bestGap = gap; best = f; }
  }
  // Nothing close enough to be that shape falls back to the dock's own camera,
  // which is what an unrecognised size should get.
  return best && bestGap < 0.06 ? best.key : null;
}

/// The camera to film a given shape with.
///
/// **The shape being exported, not the one on screen.** `docs/ROOM-EDITOR.md`
/// says what this is for: *"picking Vertical in the export box gets the camera
/// that was designed for vertical rather than the wide one squeezed"* — and the
/// export read `roomEdit.frame` instead, which is whatever the view happened to
/// be showing. Posing the room for 9:16 and then exporting HD filmed the
/// portrait camera into a landscape frame.
///
/// A frame nobody has posed falls back to the one being looked at rather than
/// to the shipped default. The rule is *use the camera meant for this shape*,
/// and when there is no such camera the one in front of you is a better guess
/// than a constant — it is at least a pose somebody chose.
function roomCameraForAspect(aspect) {
  const key = roomFrameForAspect(aspect);
  const posed = key && roomEdit.cams[key];
  return roomCameraDrawn(posed ? key : undefined);
}

/// The camera as the renderer should use it, with the ring's own size applied.
///
/// Kept apart from `roomCamera` on purpose. That one is the *pose* — it is what
/// the dragging writes, what `reNums` prints and what gets pasted back into
/// `vis-gl.js` as a new default. The ring's size is a preference about what is
/// in the room rather than about where the room is, and folding it into the
/// pose would mean every camera copied out carried somebody's slider position
/// with it.
function roomCameraDrawn(frameKey) {
  // The world camera, as kept; the renderer builds its view from it and
  // derives the box its layers still lay themselves along. A box camera —
  // a film's, a test's — passes through, and the renderer reads it as the
  // world camera it maps to.
  const raw = frameKey ? (roomEdit.cams[frameKey] || null) : roomCamera();
  const k = roomEdit.ringScale;
  // Nothing posed: the renderer's own default, scaled if the ring is.
  if (!raw) return k === 1 ? null : { ...VG_CAMERA, ring: VG_CAMERA.ring * k };
  if (vgIsWorld(raw)) {
    const wc = { ...VG_WORLD_DEFAULT, ...raw };
    return k === 1 ? wc : { ...wc, ring: { ...wc.ring, size: wc.ring.size * k } };
  }
  if (k === 1) return raw;
  const base = vgCamera(raw);
  return { ...base, ring: base.ring * k };
}

function saveRoomCameras() {
  try { localStorage.setItem(ROOM_CAMERAS_KEY, JSON.stringify(roomEdit.cams)); } catch {}
}

/// The camera being edited, as the world camera it is.
function roomWorldNow() {
  const c = roomEdit.cams[roomEdit.frame];
  if (vgIsWorld(c)) return { ...VG_WORLD_DEFAULT, ...vgWorldUpgrade(c) };
  return vgWorldFromBox(c || ROOM_CAM_DEFAULT, roomAspectNow());
}

