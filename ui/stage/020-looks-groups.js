/// ═══════════════════════════════════════════════════════════════════════════
/// THE LOOK
///
/// **Ten views is ten things to look at, not one thing seen ten ways.** Braid
/// wants long trails and Shear wants none, and having them fight over one set of
/// controls means every switch is followed by a re-dial. So the look belongs to
/// the view, exactly as it does in `visualiser/grain-views.html`.
///
/// The split is between the look and the sound. Glow, trails, folds, what the
/// colour is *of*, and the palette describe a picture and are per view. Ratio,
/// window, density and the jitters describe the sound, and there is only one
/// sound.
/// ═══════════════════════════════════════════════════════════════════════════

/// What each view looks like before anyone has touched it.
///
/// These are `VIEW_DEFAULTS` from the original, unchanged. `speed` and `orbit`
/// are not here: both drive the original's own clock and camera, and on the
/// stage the playhead is the clock and the camera is yours.
const ST_LOOKS = {
  shear:     { glow: 1.0, trail: 0.15, mirror: 4,  colourBy: 'pitch',    palette: ['#4a6fa5', '#8fb339', '#d97757'] },
  braid:     { glow: 1.3, trail: 0.70, mirror: 4,  colourBy: 'rate',     palette: ['#2f5d8a', '#6fa8a0', '#f0a04b'] },
  swarm:     { glow: 1.5, trail: 0.45, mirror: 6,  colourBy: 'pitch',    palette: ['#6a9bcc', '#788c5d', '#d97757'] },
  shells:    { glow: 1.4, trail: 0.55, mirror: 6,  colourBy: 'pitch',    palette: ['#7b5ea7', '#4ea1a1', '#ffcb69'] },
  lattice:   { glow: 0.8, trail: 0.12, mirror: 4,  colourBy: 'size',     palette: ['#33475b', '#9db4c0', '#e08e45'] },
  tunnel:    { glow: 1.4, trail: 0.75, mirror: 1,  colourBy: 'time',     palette: ['#12263a', '#2a9d8f', '#e9c46a'] },
  mandala:   { glow: 1.6, trail: 0.65, mirror: 12, colourBy: 'pitch',    palette: ['#b388eb', '#8093f1', '#f7aef8'] },
  rorschach: { glow: 1.2, trail: 0.50, mirror: 2,  colourBy: 'position', palette: ['#1b1b1e', '#8d99ae', '#ef233c'] },
  vortex:    { glow: 1.5, trail: 0.80, mirror: 6,  colourBy: 'rate',     palette: ['#03071e', '#dc2f02', '#ffba08'] },
  ripple:    { glow: 1.0, trail: 0.35, mirror: 2,  colourBy: 'source',   palette: ['#14213d', '#4cc9f0', '#f72585'] },
};

/// The six looks the pad grid starts with.
///
/// `SEED_PADS` from the original. Not locked — a pad is a pad — but there so the
/// grid is worth pressing before anything has been saved to it. A look is worth
/// dropping onto whichever view you are in, which is the whole reason to keep
/// one, so the library is shared and what it lands on is per view.
const ST_SEED_PADS = [
  { name: 'Swarm',  glow: 1.4, trail: 0.30, mirror: 6,  colourBy: 'pitch',  palette: ['#6a9bcc', '#788c5d', '#d97757'] },
  { name: 'Trails', glow: 1.1, trail: 0.90, mirror: 4,  colourBy: 'time',   palette: ['#3d5a80', '#98c1d9', '#ee6c4d'] },
  { name: 'Kaleid', glow: 1.6, trail: 0.72, mirror: 12, colourBy: 'rate',   palette: ['#b388eb', '#8093f1', '#f7aef8'] },
  { name: 'Ink',    glow: 0.5, trail: 0.55, mirror: 2,  colourBy: 'size',   palette: ['#2b2b2b', '#8a8a8a', '#f2f2f2'] },
  { name: 'Ember',  glow: 1.8, trail: 0.80, mirror: 8,  colourBy: 'pitch',  palette: ['#4a1c00', '#c1440e', '#ffd166'] },
  { name: 'Still',  glow: 0.8, trail: 0.15, mirror: 1,  colourBy: 'source', palette: ['#6a9bcc', '#788c5d', '#d97757'] },
];

const ST_PAD_COUNT = 16;
const ST_LOOK_KEYS = ['glow', 'trail', 'mirror', 'colourBy', 'palette'];

/// What the colour is *of*.
///
/// **Measured across the cloud, not against the theoretical range.** Against the
/// engine's ±48 semitones a couple of semitones of jitter — which is a lot to
/// listen to — spans a fiftieth of the palette and the whole thing comes out
/// monochrome. What matters visually is how big a deviation is against the rest
/// of *this* cloud, so the range is measured and a cloud with no variation at
/// all falls to the middle rather than dividing by zero.
const ST_COLOUR_BY = {
  pitch:    { label: 'Pitch',    of: (g) => g.semis },
  rate:     { label: 'Rate',     of: (g) => Math.log2(Math.max(g.rate, 1e-6)) },
  position: { label: 'Position', of: (g) => g.dev },
  size:     { label: 'Size',     of: (g) => g.dur },
  source:   { label: 'Source',   of: (g) => g.v },
  time:     { label: 'Time',     of: (g) => g.u },
};

/// The pad library, on disk.
///
/// **One library, not one per view.** A look is worth dropping onto whichever
/// view you are in — that is the whole reason to keep one — so the pads are
/// shared and what they land on is per view. Recalling into Braid changes Braid
/// and leaves Shear as you left it.
///
/// In `localStorage` because a saved look is a decision, and decisions outlive
/// the window.
const ST_PAD_STORE = 'audiolab.stage.pads.v1';

function stReadPads() {
  try {
    const saved = JSON.parse(localStorage.getItem(ST_PAD_STORE));
    if (Array.isArray(saved) && saved.length === ST_PAD_COUNT) return saved;
  } catch { /* blocked or full */ }
  const pads = new Array(ST_PAD_COUNT).fill(null);
  ST_SEED_PADS.forEach((v, i) => { pads[i] = { ...v, palette: v.palette.slice() }; });
  return pads;
}

function stWritePads(pads) {
  try { localStorage.setItem(ST_PAD_STORE, JSON.stringify(pads)); } catch { /* blocked */ }
}

/// The look a view is wearing: its own default, with anything edited over it.
function stLook(cfg, key) {
  const base = ST_LOOKS[key] || ST_LOOKS.mandala;
  const edit = ((cfg && cfg.looks) || {})[key] || {};
  const out = { ...base, ...edit };
  out.palette = (edit.palette || base.palette).slice();
  return out;
}

function stLayout(key) {
  return ST_LAYOUTS.find((l) => l.key === key) || ST_LAYOUTS[0];
}

/// How many colours a cloud is spread across.
const ST_CBINS = 14;

/// Fourteen colours across the three the view is built from.
///
/// The middle colour is the midpoint rather than a third of the way along, so
/// the ramp reads as two joined gradients — which is what makes a palette of
/// three sit in a picture as a range instead of as three stripes.
function stRamp(hexes, n) {
  const at = (h) => stRgb(h, [1, 1, 1]);
  const a = at(hexes[0]), b = at(hexes[1]), d = at(hexes[2]);
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(t < 0.5 ? mix(a, b, t * 2) : mix(b, d, (t - 0.5) * 2));
  }
  return out;
}

/// How long a grain's stroke is, from how long it sounds for.
///
/// Absolute and log-scaled rather than relative to the window asked for. Measured
/// against its own window every grain draws the same tick and the size slider
/// does nothing at all; measured against the engine's whole range a five
/// millisecond grain is a speck and a two second one is a streak.
function stTickScale(seconds) {
  const lo = Math.log(0.004), hi = Math.log(2.2);
  const s = Math.max(0.004, Math.min(2.2, seconds));
  return 0.22 + ((Math.log(s) - lo) / (hi - lo)) * 2.9;
}

/// A grain's own amplitude envelope, at this instant, plus its afterimage.
///
/// The Hann window the renderer actually applies to that grain — so what glows
/// is a readout of the audio and the picture cannot disagree with the sound. The
/// tail is the one honest embellishment: the grain has finished and is making no
/// sound, and the decay is there so the eye can see where the playhead has been.
function stEnergy(dt, dur, trail) {
  const d = Math.max(dur, 1e-9);
  const phase = dt / d;
  if (phase < 0) return 0;
  if (phase <= 1) return 0.5 - 0.5 * Math.cos(Math.PI * 2 * phase);
  if (trail <= 0) return 0;
  const tail = Math.max(d * 5 * trail, 0.05);
  const k = (dt - d) / tail;
  return k >= 1 ? 0 : (1 - k) * (1 - k) * 0.55 * trail;
}

/// Whether an object draws, given what is soloed.
///
/// **Solo does not change the switches.** Turning the other eight off to look at
/// one would mean turning eight back on afterwards and hoping you remembered
/// which — so this is a filter over the answer rather than an edit to the state.
/// Let go of solo and the scene is exactly as it was.
function stShows(cfg, key) {
  if (!cfg[key]) return false;
  if (!cfg.solo) return true;
  if (cfg.solo === key) return true;
  // A soloed sleeve keeps its faces, or soloing it shows nothing at all.
  if (cfg.solo === 'sleeveOn' && key.startsWith('sleeve')) return true;
  return false;
}

/// How many of a thing to actually build, after the preview's scaling.
///
/// **One place decides it.** Scaled at each use site instead, the terrain and
/// the sleeve would drift apart the first time one of them was edited, and a
/// preview whose objects disagree about how detailed they are is worse than one
/// that is simply coarse.
function stDetail(cfg, n, lo, hi) {
  const d = Math.max(0.05, Math.min(1, cfg.detail === undefined ? 1 : cfg.detail));
  return Math.max(lo, Math.min(hi, Math.round(n * d)));
}

/// Everything that can be switched on or off, in the order the panel shows it.
///
/// **The admin is built from this.** The room's controls were written out by
/// hand, one row per thing, which is why adding a layer meant editing a panel —
/// and why the panel and the renderer could disagree about what existed.
/// Settings the admin does not list.
///
/// **Not deleted — unlisted.** The type object is still built, still lit, still
/// filmed, still tested and still switchable from a saved scene; it is only
/// absent from the panel. Taking an entry out of `ST_OBJECTS`, `ST_GROUPS` or
/// `ST_UI` instead would take the thing itself with it, and the point of these
/// three lists is that they describe what exists rather than deciding it.
///
/// Empty this set and every control comes back where it was.
const ST_ADMIN_HIDDEN = new Set([
  'typeOn', 'typeSize', 'typeDepth', 'typeLean', 'typeAt', 'typeHigh', 'typeSwing',
  // The dolly rig the orbit replaced. See the camera block.
  'eye', 'lift', 'swing', 'aim',
]);

/// Whether a setting is offered in the admin.
function stInAdmin(key) {
  return !ST_ADMIN_HIDDEN.has(key);
}

const ST_OBJECTS = [
  // ── things in the room ──
  { key: 'shell', group: 'Things', label: 'Walls', hint: 'The room itself: five surfaces for the light to land on.' },
  { key: 'terrainOn', group: 'Things', label: 'Terrain', hint: 'The sound along the floor, receding as it ages.' },
  { key: 'cloudOn', group: 'Things', label: 'Grains', hint: 'Every grain about to sound, as a lit solid travelling down the room.' },
  { key: 'typeOn', group: 'Things', label: 'Type', hint: 'Words standing in the space as geometry — the sound passes in front of them and behind them.' },
  { key: 'ringOn', group: 'Things', label: 'Ring', hint: 'The Lissajous hung in the room, every frame of it joined into a tube with depth as time.' },
  { key: 'sleeveOn', group: 'Things', label: 'Sleeve', hint: 'The stacked lines on the room’s own surfaces — the sleeve, lit.' },

  // ── which surfaces the sleeve is on ──
  { key: 'sleeveFloor', group: 'Sleeve faces', label: 'Floor', hint: 'Off by default: the terrain already has the floor, and two pictures of the same sound on one plane fight.' },
  { key: 'sleeveCeiling', group: 'Sleeve faces', label: 'Ceiling', hint: 'Stacked lines overhead, hanging down.' },
  { key: 'sleeveLeft', group: 'Sleeve faces', label: 'Left', hint: 'Up the left wall, running away into the room.' },
  { key: 'sleeveRight', group: 'Sleeve faces', label: 'Right', hint: 'Up the right wall.' },
  { key: 'sleeveBack', group: 'Sleeve faces', label: 'Back', hint: 'The sleeve itself, at the end of the room: rows born at the bottom and climbing.' },

  // ── the air ──
  { key: 'mistOn', group: 'Air', label: 'Mist', hint: 'Particles in the air, drifting through the light.' },
  { key: 'fogOn', group: 'Air', label: 'Fog', hint: 'The air itself. Thick enough and the back of the room is gone rather than dim.' },

  // ── the lamps ──
  { key: 'keyOn', group: 'Lamps', label: 'Key', hint: 'The lamp that makes the form.' },
  { key: 'fillOn', group: 'Lamps', label: 'Fill', hint: 'Stops the shadow side going to black.' },
  { key: 'rimOn', group: 'Lamps', label: 'Rim', hint: 'From behind, to find the edges.' },

  // ── how it is drawn ──
  //
  // These had no switch at all, which meant the only way to see what any of them
  // was doing was to drag its slider to nothing and back — and `fxaa` has no
  // slider, so there was no way at all.
  { key: 'grid', group: 'Look', label: 'Grid', hint: 'The ruling on the walls. It is what gives the room a size — a plain surface in perspective could be a metre away or a mile.' },
  { key: 'wire', group: 'Look', label: 'Wire', hint: 'The bright line along the terrain’s ridges, over the lit surface.' },
  { key: 'shadows', group: 'Look', label: 'Shadows', hint: 'The key light casting. A thing with no shadow is a thing not standing anywhere.' },
  { key: 'bloom', group: 'Look', label: 'Bloom', hint: 'Bright things spilling. The old renderer got this free from additive blending; a lit one has to ask.' },
  { key: 'fxaa', group: 'Look', label: 'Smooth', hint: 'Anti-aliasing. Off, every edge in here is a staircase, and a room is nothing but edges.' },
];

/// The controls, in groups, with the pairs that are really one gesture given a
/// pad instead of two sliders.
///
/// **A slider is the wrong shape for most of this.** Where the camera stands is
/// one decision with two numbers in it, and split across two sliders you make it
/// by alternating between them and watching a third thing — the picture — to see
/// whether you have arrived. On a pad it is one movement, and the thing you are
/// steering is under your hand rather than beside it.
///
/// So: pads for the pairs, sliders only for what is genuinely one number, and
/// the whole lot in groups small enough to hold in your head. Forty-four sliders
/// in a column is a list, and a list is not an instrument.
/// The controls, grouped by the thing they belong to.
///
/// **An audit, acted on.** What was here was fifty-eight numbers and twenty-one
/// switches under headings like "Sound" and "Look", reached through seventeen
/// two-axis pads. Three faults, all of them the same fault:
///
///   - **The same number appeared twice under two names.** `lift` was half of
///     STANDPOINT and half of VIEW; `bloomAmount` was half of GLOW and half of
///     BLOOM. Moving one moved the other and neither pad said so.
///   - **Things were filed by parameter rather than by object.** The type's
///     position lived in the Sleeve group. Which object a control belonged to —
///     the one fact you actually navigate by — was the one thing the headings did
///     not say.
///   - **A pad is two numbers with their names taken off.** They were put in
///     because forty-four sliders in a column is a list rather than an
///     instrument, which was true; the answer was wrong. A pad hides both labels,
///     both values and both ranges to save one row, and you cannot dial a number
///     you cannot read.
///
/// So: one section per object, named after the switch that turns that object on,
/// in the same order as the switches. Every control is a labelled slider with its
/// value showing. One section open at a time, because forty-four sliders are only
/// a list when they are all on screen at once.
///
/// The camera is not in here at all. It belongs to the picture — drag to orbit,
/// shift-drag to slide, wheel to pull in — which is where every 3D application
/// has put it since Maya, and the numbers for it are a readout pinned above these
/// rather than a group among them. See `wireStageDrag`.
const ST_GROUPS = [
  {
    key: 'terrain', label: 'Terrain', owner: 'terrainOn',
    hint: 'The sound along the floor, receding as it ages.',
    sliders: ['relief', 'gain', 'span', 'window', 'smooth', 'floorLevel', 'rows', 'points'],
  },
  {
    key: 'grains', label: 'Grains', owner: 'cloudOn',
    hint: 'Every grain about to sound.',
    sliders: ['cloudShape', 'cloudDensity', 'cloudSize', 'cloudDrift', 'cloudGlow', 'cloudCap'],
  },
  {
    key: 'ring', label: 'Ring', owner: 'ringOn',
    hint: 'The Lissajous hung in the room, with depth as time.',
    sliders: ['ringSize', 'ringDrive', 'ringHigh', 'ringRows', 'ringPoints'],
  },
  {
    key: 'sleeve', label: 'Sleeve', owner: 'sleeveOn',
    hint: 'The stacked lines on the room’s own surfaces.',
    sliders: ['sleeveSpan', 'sleeveRelief'],
  },
  {
    key: 'air', label: 'Air', owner: 'fogOn',
    hint: 'The air itself, and what is floating in it.',
    sliders: ['fogDensity', 'mist', 'mistSize', 'mistDrift'],
  },
  {
    key: 'lamps', label: 'Lamps', owner: 'keyOn',
    hint: 'Three lamps. The sound gives off its own light; these are for modelling the solids.',
    sliders: ['key', 'keySide', 'keyHigh', 'keyAt', 'fill', 'rim', 'ambient', 'drive', 'shadowSoft'],
  },
  {
    key: 'room', label: 'Room', owner: 'shell',
    hint: 'The box. Off by default — it was only ever a way of getting depth into a flat picture — but its size is what everything else is scaled against.',
    sliders: ['width', 'height', 'depth', 'taper', 'gridSize', 'gridFade'],
  },
  {
    key: 'look', label: 'Look', owner: null,
    hint: 'How the whole frame is exposed and developed, after everything in it has been drawn.',
    sliders: ['glow', 'bloomAmount', 'bloomThreshold', 'exposure', 'contrast', 'vignette',
      'wireWidth', 'detail'],
  },
];

/// The settings that are a choice from a list rather than a number.
///
/// A slider over thirty-eight named solids is a slider you cannot aim: the
/// values have no order, the readout is a number nobody can read as a shape, and
/// there is no way to get back to the one you liked. So the panel builds these
/// as a menu, and `ST_UI` says which by carrying a `pick`.
const ST_PICKS = {
  cloudShape: () => [
    { value: 'auto', label: 'Every shape' },
    { value: 'tiered', label: 'By how loud it is' },
    ...(typeof GRAIN_SHAPES === 'undefined' ? []
      : GRAIN_SHAPES.map((m) => ({ value: m.name, label: m.name }))),
  ],
};

/// The camera's own numbers, pinned above the groups.
///
/// Not a group: it is not a thing in the room, it is where you are standing to
/// look at the room, and every 3D application treats that as a property of the
/// viewport rather than of the scene.
const ST_CAM_UI = ['orbit', 'tilt', 'dist', 'fov'];

/// The sliders.
const ST_UI = [
  { key: 'depth', tag: 'DEPTH', min: 2, max: 14, step: 0.1, hint: 'How far the room runs back.' },
  { key: 'width', tag: 'WIDTH', min: 1, max: 6, step: 0.05, hint: 'How wide it is.' },
  { key: 'height', tag: 'HEIGHT', min: 1, max: 6, step: 0.05, hint: 'How tall it is.' },
  { key: 'taper', tag: 'TAPER', min: 0.2, max: 1, step: 0.01,
    hint: 'How far the back draws in. At one it is a box; under one it is a funnel, which is perspective before the camera has any.' },
  // ── the camera ──
  //
  // **These are readouts as much as controls.** Turning a view over is a thing
  // you do to the picture, not to a slider: drag orbits, shift-drag slides the
  // point it turns around, the wheel pulls in. The numbers are here so a framing
  // can be dialled exactly and read back, which a drag cannot do.
  { key: 'orbit', tag: 'ORBIT', min: -3.15, max: 3.15, step: 0.01, hint: 'Round the subject. Drag the picture sideways to do the same thing.' },
  { key: 'tilt', tag: 'TILT', min: -1.45, max: 1.45, step: 0.01, hint: 'Above it or below it. Drag the picture up and down.' },
  { key: 'dist', tag: 'DISTANCE', min: 0.2, max: 20, step: 0.05, hint: 'How far back from what it is looking at. The wheel does this.' },
  { key: 'fov', tag: 'LENS', min: 0.3, max: 1.6, step: 0.01, hint: 'The field of view. Wide and close is the inside of a thing; narrow and far is a diagram of it.' },

  // **The old rig, described and unlisted.** `eye`, `swing`, `lift` and `aim`
  // slid the camera on a plane and aimed it down the room's axis, which is a rig
  // for looking at a room rather than at a thing standing in one. Nothing reads
  // them now. They stay described so that a saved scene carrying them is still
  // legible, and so putting them back is a matter of taking four keys out of
  // `ST_ADMIN_HIDDEN`.
  { key: 'eye', tag: 'EYE', min: 0.2, max: 8, step: 0.05, hint: 'How far back the camera stands. Replaced by DISTANCE.' },
  { key: 'lift', tag: 'LIFT', min: -1.5, max: 1.5, step: 0.01, hint: 'How high it stands. Replaced by TILT.' },
  { key: 'swing', tag: 'SWING', min: -3, max: 3, step: 0.01, hint: 'How far across the space it stands. Replaced by ORBIT.' },
  { key: 'aim', tag: 'AIM', min: 0, max: 1, step: 0.01, hint: 'How far down the room it looks. Replaced by the target, which shift-drag moves.' },
  { key: 'ambient', tag: 'AMBIENT', min: 0, max: 1, step: 0.01, hint: 'The light that comes from nowhere. Too much and nothing has form.' },
  { key: 'key', tag: 'KEY', min: 0, max: 4, step: 0.02, hint: 'The main lamp.' },
  { key: 'keySide', tag: 'KEY SIDE', min: -1, max: 1, step: 0.01, hint: 'Which side it stands.' },
  { key: 'keyHigh', tag: 'KEY HIGH', min: -1, max: 1, step: 0.01, hint: 'How high it hangs.' },
  { key: 'keyAt', tag: 'KEY AT', min: 0, max: 1, step: 0.01, hint: 'How far down the room it hangs.' },
  { key: 'fill', tag: 'FILL', min: 0, max: 2, step: 0.02, hint: 'The soft one opposite the key.' },
  { key: 'rim', tag: 'RIM', min: 0, max: 4, step: 0.02, hint: 'The one behind.' },
  { key: 'drive', tag: 'DRIVE', min: 0, max: 3, step: 0.02, hint: 'How hard the sound moves the key light.' },
  { key: 'fogDensity', tag: 'FOG', min: 0, max: 0.6, step: 0.005, hint: 'How thick the air is.' },
  { key: 'mist', tag: 'MIST', min: 0, max: 6000, step: 50, round: true, hint: 'How many particles are in it.' },
  { key: 'mistSize', tag: 'MIST SIZE', min: 0.005, max: 0.3, step: 0.005, hint: 'How big each one is.' },
  { key: 'mistDrift', tag: 'DRIFT', min: 0, max: 0.5, step: 0.005, hint: 'How fast they move.' },
  { key: 'relief', tag: 'RELIEF', min: 0.02, max: 2, step: 0.01, hint: 'How high the terrain stands.' },
  { key: 'rows', tag: 'ROWS', min: 8, max: 320, step: 1, round: true, hint: 'How many rows of it. The line quality is most of what this looks like.' },
  { key: 'points', tag: 'POINTS', min: 32, max: 1024, step: 8, round: true, hint: 'Samples along a row. Below about sixty the peaks go faceted; a 4K render will show it.' },
  { key: 'span', tag: 'SPAN', min: 0.3, max: 1, step: 0.01, hint: 'How much of the floor it crosses.' },
  { key: 'window', tag: 'WINDOW', min: 0, max: 1, step: 0.01, hint: 'How hard the sound is pulled to the middle.' },
  { key: 'smooth', tag: 'SMOOTH', min: 0, max: 8, step: 1, round: true, hint: 'Across the samples of a row.' },
  { key: 'gain', tag: 'GAIN', min: 0.1, max: 4, step: 0.05, hint: 'How hard the sound drives it.' },
  { key: 'floorLevel', tag: 'SILENCE', min: 0, max: 0.05, step: 0.001, hint: 'Below this is drawn flat.' },
  { key: 'cloudDensity', tag: 'CLOUD', min: 0, max: 1, step: 0.01,
    hint: 'How much of the schedule is drawn. A cloud you can see through is worth more than one you cannot.' },
  { key: 'cloudSize', tag: 'GRAIN SIZE', min: 0.005, max: 0.3, step: 0.005, hint: 'How big each grain is.' },
  { key: 'cloudDrift', tag: 'GRAIN DRIFT', min: 0, max: 1, step: 0.01, hint: 'How far a grain wanders as it travels.' },
  // Not a number, so not a slider — see `ST_PICKS`.
  { key: 'cloudShape', tag: 'SHAPE', pick: 'cloudShape',
    hint: 'Which solid a grain is drawn as. On “every shape” each one gets one from the whole catalogue by its own number. On “by how loud it is” the intricate solids are kept for the loud grains, which is what the old room does. Or name one and the whole cloud is that.' },
  { key: 'cloudGlow', tag: 'GRAIN GLOW', min: 0, max: 1.5, step: 0.01, hint: 'How much light one grain gives off of its own, before the lamps touch it. Only the cloud — everything else the sound is drawn as is LINE GLOW, under Look.' },
  { key: 'cloudCap', tag: 'GRAIN CAP', min: 100, max: 6000, step: 100, round: true, hint: 'The most that will ever be in the room at once.' },
  { key: 'ringSize', tag: 'RING', min: 0.05, max: 1.5, step: 0.01, hint: 'How wide the tube is.' },
  { key: 'ringDrive', tag: 'RING DRIVE', min: 0, max: 4, step: 0.02, hint: 'How hard the sound pushes it out of round.' },
  { key: 'ringHigh', tag: 'RING HIGH', min: -1, max: 1, step: 0.01, hint: 'How high it hangs.' },
  { key: 'ringRows', tag: 'RING ROWS', min: 8, max: 400, step: 1, round: true, hint: 'How far back it goes, in frames of sound.' },
  { key: 'ringPoints', tag: 'RING FINE', min: 16, max: 512, step: 8, round: true, hint: 'How finely each hoop is drawn.' },
  { key: 'sleeveRelief', tag: 'SLEEVE', min: 0.02, max: 1, step: 0.01,
    hint: 'How far the stacked lines stand off the walls. The surfaces face each other, so past about a third they meet in the middle.' },
  { key: 'sleeveSpan', tag: 'SLEEVE SPAN', min: 0.3, max: 1, step: 0.01, hint: 'How much of each surface they run across.' },
  { key: 'gridSize', tag: 'GRID', min: 2, max: 80, step: 1, round: true,
    hint: 'How fine the ruling on the walls is. It is what gives the room a size — a plain surface in perspective could be a metre away or a mile.' },
  { key: 'gridFade', tag: 'GRID FADE', min: 0, max: 1, step: 0.01, hint: 'How strongly the ruling shows.' },
  { key: 'wireWidth', tag: 'WIRE', min: 0.2, max: 4, step: 0.1,
    hint: 'The bright line along the terrain’s ridges, over the lit surface. The old room was only ever this line; here it is the highlight on a solid.' },
  { key: 'shadowSoft', tag: 'SHADOW', min: 0, max: 64, step: 1, round: true, hint: 'How soft the key light’s shadows are. At nought they are hard.' },
  { key: 'bloomAmount', tag: 'BLOOM', min: 0, max: 2, step: 0.02, hint: 'How far the bright parts spill into what is next to them. This happens to the whole frame after everything in it is drawn, so it is downstream of both glows rather than a third one.' },
  { key: 'bloomThreshold', tag: 'BLOOM AT', min: 0, max: 1, step: 0.01, hint: 'How bright a thing has to be before it spills.' },
  { key: 'contrast', tag: 'CONTRAST', min: 0.5, max: 3, step: 0.01, hint: 'How far apart the lit and the unlit are.' },
  { key: 'exposure', tag: 'EXPOSURE', min: 0.2, max: 3, step: 0.01, hint: 'How much light reaches the film.' },
  { key: 'vignette', tag: 'VIGNETTE', min: 0, max: 1.5, step: 0.01, hint: 'How far the corners fall off.' },
  { key: 'typeSize', tag: 'TYPE', min: 0.05, max: 3, step: 0.01, hint: 'How big the letters are, in room units.' },
  { key: 'typeDepth', tag: 'TYPE DEPTH', min: 0, max: 2, step: 0.01, hint: 'How far they stand off themselves. Nought is flat lettering facing you.' },
  { key: 'typeLean', tag: 'TYPE LEAN', min: 0, max: 360, step: 1, round: true, hint: 'Which way they stand off, in degrees.' },
  { key: 'typeAt', tag: 'TYPE AT', min: 0, max: 1, step: 0.01, hint: 'How far into the space they stand. Deep enough and the sound passes in front of them.' },
  { key: 'typeHigh', tag: 'TYPE HIGH', min: -2, max: 2, step: 0.01, hint: 'How high they hang.' },
  { key: 'typeSwing', tag: 'TYPE ACROSS', min: -3, max: 3, step: 0.01, hint: 'How far across.' },
  { key: 'detail', tag: 'DETAIL', min: 0.15, max: 1, step: 0.05,
    hint: 'How much of the full row and sample count the preview draws. The film always draws all of it — this is the proxy you watch while you work, and it changes nothing you can see the shape of.' },
  // **Two glows, and they were both called GLOW.** One panel offering the same
  // word twice is the fault the sections were rebuilt to remove, and these are
  // not the same thing: this one is every line the sound is drawn as, and
  // `cloudGlow` is a single grain's own light. The keys are untouched — a saved
  // scene still reads — only the names on the panel change.
  { key: 'glow', tag: 'LINE GLOW', min: 0, max: 3, step: 0.02,
    hint: 'How much light the drawn line gives off of its own — the terrain’s ridge, the ring, the sleeve, and the mist and the type that stand in the same light. This is the look: at nought the signal is a grey surface with a lamp on it, and up it is a glowing line the way the old renderers draw it. The grains have their own, under Grains.' },
];

function stRgb(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function stColor(hex, fallback) {
  const c = stRgb(hex, fallback);
  return new BABYLON.Color3(c[0], c[1], c[2]);
}

