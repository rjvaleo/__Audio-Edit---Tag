// The room's palette: what every drawn thing is coloured with, and what that
// colour is read against.
//
// See `docs/ROOM-PAINT.md`.
//
// The room shipped with three colours — `--wave-2`, `--wave` and `--accent` —
// driving fifteen of its eighteen draw calls, and two of those three are the
// same colour in the palette that ships. So the grain wires, the grain bloom
// and all three mist passes were a gradient between a colour and itself, and
// the ring, the skin, the terrain and the leading edge were four objects
// painted identically. This is what takes them apart.
//
// **Nothing here is a colour on its own.** Every mark in this room already has
// a number behind it — how loud that band is, how far back that grain has
// travelled, how wide the stereo image is at that point of the ring — and the
// old two-colour mix was a ramp read against one of them. So a slot is not a
// swatch: it is a ramp, a choice of what to read it against, and the window of
// that quantity to spend it across.

// ───────────────────────────────────────────────────────────── what is drawn ──

/// Every paintable thing, in the order the panel lists them.
///
/// `row` is its line in the ramp atlas — see `VG_RAMP_ROWS` in `vis-gl.js`.
/// The two with no row are not drawn in the scene: the data block is type on
/// the back wall and the background is the ground the glass sits on, so both
/// are CSS rather than geometry.
///
/// `own` names the quantity that layer offers beyond the ones every layer has.
/// Loudness, height, depth, distance and a per-mark random are varyings already
/// and cost nothing; this is the one thing each layer knows that would
/// otherwise be thrown away.
const RP_SLOTS = [
  { key: 'grid', label: 'Ground', row: 0, own: 'distance',
    hint: 'The grid on the ground, running to the horizon. Light grey until painted; its own quantity is distance, nought at the near line and one at the horizon, so a ramp on it runs away from you.' },
  { key: 'terrainMesh', label: 'Terrain surface', row: 1, own: 'freq',
    hint: 'The solid floor between the ridges.' },
  { key: 'terrainRidge', label: 'Terrain ridges', row: 2, own: 'freq',
    hint: 'The lines over it. Locked to the surface until now, which is why the two read as one thing.' },
  { key: 'lead', label: 'Edge band', row: 3, own: 'freq',
    hint: 'The thick ribbon over the frame you are hearing now.' },
  { key: 'ring', label: 'Ring', row: 4, own: 'width',
    hint: 'The Lissajous hoops hanging in the sky.' },
  { key: 'polytope', label: 'Solid', row: 5, own: 'depth4',
    hint: 'The four-dimensional solid hanging with the ring. Its own quantity is depth in the fourth dimension, before the projection — so an edge on the far side of w can be coloured differently from one on the near side, which is the one thing about this shape nothing else in the room knows.' },
  { key: 'skin', label: 'Skin', row: 6, own: 'width',
    hint: 'The surface between the hoops.' },
  { key: 'grainBloom', label: 'Grain bloom', row: 7, own: 'pan',
    hint: 'The soft wash around each grain.' },
  { key: 'grainWire', label: 'Grain wires', row: 8, own: 'pan',
    hint: 'The tumbling solid itself.' },
  { key: 'grainCore', label: 'Grain core', row: 9, own: 'pan',
    hint: 'The burning point at its centre.' },
  { key: 'grainFill', label: 'Grain fill', row: 10, own: 'pan',
    hint: 'The skin inside the solid. Only drawn with FILL on and not filling with the background.' },
  { key: 'mist', label: 'Mist', row: 11, own: 'pan',
    hint: 'The smoke dripping off the grains.' },
  // `range` is where a new ramp's window starts when it is read against level:
  // the band the fog's weight actually reaches, so the whole gradient is spent.
  { key: 'fog', label: 'Fog', row: 12, own: null, range: [0.05, 0.27],
    hint: 'The air itself. Its weight only ever runs 0.05 to 0.27, so a ramp read against level starts its range there; widen it and most of the ramp is never reached.' },
  { key: 'data', label: 'Data block', row: -1, own: null, css: true,
    hint: 'The schedule printed on the back wall. Type, not geometry — one colour, faded down the wall.' },
  { key: 'background', label: 'Background', row: -1, own: null, css: true, flat: true,
    hint: 'The ground the room is drawn on. One colour: the room adds light to it.' },
];

/// The ridgeline's slots.
///
/// Three, because that is what the picture has: a stroke, the fill under it that
/// hides what is behind, and the ground. The fill is normally the ground and is
/// its own slot anyway — a fill a shade off the ground is a different and
/// sometimes better picture, and there is no reason to forbid it.
const RP_RIDGE_SLOTS = [
  { key: 'ridgeLine', label: 'Line', row: -1, own: null, css: true, flat: true,
    hint: 'The stroke. White on black is the sleeve.' },
  { key: 'ridgeFill', label: 'Fill', row: -1, own: null, css: true, flat: true,
    hint: 'Under each line, hiding the lines behind it. Normally the background — that is what makes the stack read as depth rather than as a hairball.' },
  { key: 'ridgeBackground', label: 'Background', row: -1, own: null, css: true, flat: true,
    hint: 'The ground it is drawn on.' },
];

/// The slots the palette is showing: whichever module is on screen.
///
/// `RP_SLOTS` was never specific to the room except by being the only list, so
/// this is the whole of what "per-module colours" costs.
function rpSlots() {
  const on = (typeof roomEdit !== 'undefined') ? roomEdit.module : undefined;
  // **The stage has its own eight.** It is not the room and it is not the flat
  // stack, and offering it either one's slots is offering controls that paint
  // nothing — which is what it did: a scheme applied while the stage was up
  // changed the room's colours and left the stage exactly as it was.
  // **The card's three are only on offer while the card is.** The stage has type
  // of its own — `stageType` — and appending the card's slots put two rows
  // called "Type" in one list, colouring two different things. The card's panel
  // is not in the admin any more either, so these were three colours for
  // something nothing was drawing. See `ROOM_TEXT_IN_ADMIN`.
  const card = (typeof RT_SLOTS !== 'undefined'
    && (typeof ROOM_TEXT_IN_ADMIN === 'undefined' || ROOM_TEXT_IN_ADMIN)) ? RT_SLOTS : [];
  if (on === 'stage' && typeof ST_SLOTS !== 'undefined') return ST_SLOTS.concat(card);
  // The stacked-line modules share three slots — line, fill, ground — because
  // they are the same picture flat and in a room. Only the room proper has the
  // fourteen.
  const own = (on !== undefined && on !== 'room') ? RP_RIDGE_SLOTS : RP_SLOTS;
  // The card is drawn over both modules, so its colours are on offer under both
  // — appended rather than merged in, so the module's own slots stay together
  // at the top of the list where they were.
  return own.concat(card);
}

const RP_BY_KEY = Object.fromEntries(
  RP_SLOTS.concat(RP_RIDGE_SLOTS).map((s) => [s.key, s]));

/// What a ramp can be read against. The index is what the shader switches on.
///
/// The first five are varyings the room already carried; only `own` needed a
/// new attribute, and it means something different in each layer, which is why
/// its label is looked up per slot.
const RP_DRIVES = [
  { key: 'level', label: 'Level', hint: 'How loud this mark is. What the room has always used.' },
  { key: 'depth', label: 'Depth', hint: 'How far back — which in this room is how long ago.' },
  { key: 'dist', label: 'Distance', hint: 'How far from the eye, which is not quite depth once the room is wide.' },
  { key: 'height', label: 'Height', hint: 'How high up the room. For a grain that is its pitch.' },
  { key: 'random', label: 'Random', hint: 'A number of its own per mark, steady frame to frame.' },
  { key: 'own', label: 'Own', hint: 'The quantity this layer alone knows.' },
];

const RP_OWN_LABEL = {
  distance: 'Distance',
  depth4: 'Depth in w',
  freq: 'Frequency',
  width: 'Stereo width',
  pan: 'Pan',
};

/// What a slot's `own` drive is called, for the menu.
function rpOwnLabel(key) {
  const s = RP_BY_KEY[key];
  return s && s.own ? RP_OWN_LABEL[s.own] : null;
}

// ─────────────────────────────────────────────────────────────── the scheme ──

/// A slot with nothing said about it.
///
/// **`inherit` is not a colour, it is an absence.** A slot on inherit is left
/// out of what the renderer is handed, and the renderer then takes the same
/// two-colour path it always did. That is what makes a fresh scheme identical
/// to the room as it shipped rather than merely similar to it — there is no
/// reconstruction of the old behaviour that could be a shade off.
function rpBlank() {
  return { mode: 'inherit' };
}

function rpDefaultScheme(name) {
  return { name: name || 'Theme', slots: {} };
}

/// The scheme in use. Starts empty, which is the theme's own colours.
const roomPaint = {
  scheme: rpDefaultScheme(),
  /// Bumped whenever anything changes, so the renderer knows to re-upload the
  /// atlas rather than comparing three kilobytes every frame.
  version: 0,
  atlas: null,
  slots: null,
};

/// The scheme before the last generator, load or reset, for one step of Undo
/// in the modern view. Any edit by hand ends it: an Undo that jumped back over
/// your own changes would be a second way to lose them.
let rpPrev = null;

function rpTouch() {
  roomPaint.version++;
  roomPaint.atlas = null;
  roomPaint.slots = null;
}

function rpSlot(key) {
  return roomPaint.scheme.slots[key] || rpBlank();
}

function rpSetSlot(key, patch) {
  const cur = roomPaint.scheme.slots[key] || rpBlank();
  roomPaint.scheme.slots[key] = { ...cur, ...patch };
  rpPrev = null;
  rpTouch();
}

/// A slot's stops, filled in from the theme when it has none of its own.
///
/// Turning a slot from inherit to ramp has to start it somewhere, and starting
/// it at the colours it was already being drawn with means the first thing that
/// happens on switching is nothing. A slot that jumped to an arbitrary gradient
/// the moment it was touched would make every edit begin by undoing a surprise.
function rpStops(key) {
  const s = rpSlot(key);
  if (s.stops && s.stops.length >= 2) return s.stops;
  const [a, b] = rpInheritedPair(key);
  return [{ at: 0, c: a }, { at: 1, c: b }];
}

/// The two colours the room would draw this slot with today.
function rpInheritedPair(key) {
  const cold = rpToken('--wave-2', '#4a9fd8');
  const hot = rpToken('--wave', '#5fd47a');
  const core = rpToken('--accent', '#7fd0ff');
  switch (key) {
    case 'grid': return ['#9ea9b3', '#9ea9b3'];
    case 'terrainMesh': case 'terrainRidge': case 'lead': return [cold, hot];
    case 'ring': case 'skin': case 'grainCore': return [core, hot];
    case 'grainBloom': case 'grainWire': case 'mist': return [cold, core];
    case 'grainFill': return ['#1b2b3a', '#1b2b3a'];
    case 'fog': return ['#7f8fa6', '#7f8fa6'];
    case 'data': return [cold, cold];
    case 'background': return [rpToken('--sink', '#07090c'), rpToken('--sink', '#07090c')];
    case 'ridgeLine': return [rpToken('--text', '#ffffff'), rpToken('--text', '#ffffff')];
    case 'ridgeFill': case 'ridgeBackground':
      return [rpToken('--sink', '#07090c'), rpToken('--sink', '#07090c')];
    default: return [cold, hot];
  }
}

function rpToken(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v ? (cssHex(v) || fallback) : fallback;
  } catch { return fallback; }
}

// ──────────────────────────────────────────────────────────────── the atlas ──

const RP_RAMP_W = 256;
const RP_RAMP_ROWS = 16;

function rpHexRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/// Paint one slot's row of the atlas.
///
/// Interpolated in plain sRGB, which is what a CSS `linear-gradient` does — so
/// the strip the panel shows and the ramp the room reads are the same gradient
/// rather than two things that ought to agree. A perceptual space would give
/// smoother midpoints and a preview that quietly lied.
function rpFillRow(px, row, stops) {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  const base = row * RP_RAMP_W * 4;
  for (let x = 0; x < RP_RAMP_W; x++) {
    const t = x / (RP_RAMP_W - 1);
    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1].at < t) i++;
    const a = sorted[i];
    const b = sorted[Math.min(sorted.length - 1, i + 1)];
    const span = Math.max(1e-6, b.at - a.at);
    const k = Math.max(0, Math.min(1, (t - a.at) / span));
    const ca = rpHexRgb(a.c), cb = rpHexRgb(b.c);
    const o = base + x * 4;
    px[o] = Math.round(ca[0] + (cb[0] - ca[0]) * k);
    px[o + 1] = Math.round(ca[1] + (cb[1] - ca[1]) * k);
    px[o + 2] = Math.round(ca[2] + (cb[2] - ca[2]) * k);
    px[o + 3] = 255;
  }
}

/// What the renderer is handed. Built once per change, not per frame.
function rpForRenderer() {
  if (roomPaint.atlas && roomPaint.slots) {
    return { version: roomPaint.version, atlas: roomPaint.atlas, slots: roomPaint.slots };
  }
  const px = new Uint8Array(RP_RAMP_W * RP_RAMP_ROWS * 4);
  const slots = {};
  for (const s of RP_SLOTS) {
    if (s.row < 0) continue;
    const cfg = rpSlot(s.key);
    if (cfg.mode !== 'ramp' && cfg.mode !== 'flat') continue;
    const stops = cfg.mode === 'flat'
      // A flat colour is a ramp that does not move. Kept as one so there is a
      // single path through the shader rather than a second uniform saying
      // which of two ways to read the row.
      ? [{ at: 0, c: cfg.colour || '#ffffff' }, { at: 1, c: cfg.colour || '#ffffff' }]
      : rpStops(s.key);
    rpFillRow(px, s.row, stops);
    slots[s.key] = {
      v: (s.row + 0.5) / RP_RAMP_ROWS,
      drive: cfg.mode === 'flat' ? 0 : (cfg.drive | 0),
      lo: cfg.mode === 'flat' ? 0 : (cfg.lo ?? 0),
      hi: cfg.mode === 'flat' ? 1 : (cfg.hi ?? 1),
      curve: cfg.mode === 'flat' ? 1 : (cfg.curve ?? 1),
    };
  }
  roomPaint.atlas = px;
  roomPaint.slots = Object.keys(slots).length ? slots : null;
  return { version: roomPaint.version, atlas: px, slots: roomPaint.slots };
}

/// The strip the panel draws, as a CSS gradient. Same stops, same order, same
/// interpolation as the row above.
function rpGradientCss(key) {
  const cfg = rpSlot(key);
  if (cfg.mode === 'flat') return cfg.colour || '#ffffff';
  const stops = rpStops(key);
  const parts = [...stops].sort((a, b) => a.at - b.at)
    .map((s) => `${s.c} ${(s.at * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

// ──────────────────────────────────────────────────────────── the generators ──

/// A whole scheme at once, from one idea.
///
/// **Every one of these is additive.** The room adds light to its ground, which
/// is why they all put dark grounds under bright marks: a pale ground cannot be
/// drawn on by a pass that can only make things brighter. See the note in
/// `docs/ROOM-PAINT.md` about what a light scheme would actually take.
const RP_GENERATORS = [
  { key: 'mono', label: 'Monochrome' },
  { key: 'rgb', label: 'RGB' },
  { key: 'spectrum', label: 'Spectrum' },
  { key: 'vibrant', label: 'Vibrant' },
  { key: 'muted', label: 'Muted' },
  { key: 'bw', label: 'Black & white' },
];

/// The slots that carry the light, and roughly how bright each should sit
/// relative to the others. In the room the cloud burns hottest and the box is
/// furniture; on the stage the sound is loudest and everything else supports it,
/// which is the balance `docs/STAGE.md` arrived at by soloing each object.
const RP_WEIGHT = {
  polytope: 0.70,
  grid: 0.30, terrainMesh: 0.42, terrainRidge: 0.72, lead: 0.86,
  ring: 0.78, skin: 0.40, grainBloom: 0.50, grainWire: 0.72,
  grainCore: 1.00, grainFill: 0.26, mist: 0.44, fog: 0.34, data: 0.55,
  // The stage. Terrain 7.6, sleeve 6.8, type 6.1, ring 4.5, grains 4.4, mist
  // atmospheric — measured, not guessed. Without these every stage slot fell to
  // the default half and a monochrome scheme came out as eight identical
  // swatches.
  stageTerrain: 1.00, stageSleeve: 0.88, stageType: 0.78, stageRing: 0.58,
  stageGrains: 0.56, stageMist: 0.34, stageWalls: 0.28, stageGround: 0.05,
};

/// Which family a slot belongs to, for the schemes that tell them apart by hue.
///
/// 0 the ground and what stands on it, 1 the space around it, 2 what is in the
/// air. Named rather than sniffed out of the key, because sniffing is what the
/// first version did — `s.key.startsWith('terrain')` and friends — and every
/// stage slot fell through every test to family 2.
const RP_FAMILY = {
  polytope: 1,
  grid: 0, terrainMesh: 0, terrainRidge: 0, lead: 0,
  ring: 1, skin: 1,
  grainBloom: 2, grainWire: 2, grainCore: 2, grainFill: 2, mist: 2, fog: 2, data: 2,
  stageTerrain: 0, stageWalls: 0, stageGround: 0,
  stageRing: 1, stageSleeve: 1,
  stageGrains: 2, stageMist: 2, stageType: 2,
};

/// Where a new ramp's window starts. The whole of the quantity, except where a
/// slot says its level only ever reaches part of it (`range`, the fog).
function rpStartRange(key, drive) {
  const r = (drive | 0) === 0 && RP_BY_KEY[key] && RP_BY_KEY[key].range;
  return r ? { lo: r[0], hi: r[1] } : { lo: 0, hi: 1 };
}

function rpRamp(key, drive, a, b, extra) {
  return { mode: 'ramp', drive, ...rpStartRange(key, drive), curve: 1,
    stops: [{ at: 0, c: a }, { at: 1, c: b }], ...(extra || {}) };
}

function rpGenerate(kind, hue0) {
  const h0 = hue0 == null ? Math.floor(Math.random() * 360) : hue0;
  const slots = {};
  const lit = (k) => RP_WEIGHT[k] ?? 0.5;

  // **Whatever the panel is actually showing.** This walked `RP_SLOTS` — the
  // room's fourteen — whichever module was up, so pressing a scheme while the
  // stage was on screen wrote colours for slots the stage does not have and left
  // every slot it does have untouched. Every swatch stayed on "theme" and every
  // one of them drew the same gradient, because `RP_SLOTS.indexOf` is −1 for a
  // stage slot and −1 is the same number for all of them.
  const here = (typeof rpSlots === 'function') ? rpSlots() : RP_SLOTS;

  for (const s of here) {
    // **The ground is not given a colour with the rest.** Every scheme here is
    // additive — the picture adds light to whatever it is drawn on — so a pale
    // ground is a ground that cannot be drawn on, and the room has always
    // special-cased it below. The stage's ground is the same thing under a
    // different name, and left in the loop it came out mid-lightness and washed
    // the whole scene to pale cyan.
    if (s.key === 'background' || s.key === 'stageGround') continue;
    const w = lit(s.key);
    // Its place in *this* list, which is what spreads the hues apart.
    const at = here.indexOf(s);
    let lo, hi, drive = 0;

    if (kind === 'mono') {
      lo = hsl(h0, 0.55, 0.10 + w * 0.16);
      hi = hsl(h0, 0.62, 0.42 + w * 0.34);
    } else if (kind === 'rgb') {
      // Three primaries, one per family: the floor, the sky, the cloud. What
      // makes this legible is that the families are told apart by hue rather
      // than by brightness, so all three can be loud at once.
      const h = [0, 122, 218][RP_FAMILY[s.key] ?? 2];
      lo = hsl(h, 0.85, 0.14 + w * 0.10);
      hi = hsl(h, 0.92, 0.48 + w * 0.30);
    } else if (kind === 'spectrum') {
      // The floor and the leading edge read against **frequency**, so the
      // spectrum comes out as a spectrum — the thing this room could always
      // have shown and never did, because the only quantity on offer was level.
      const own = s.own === 'freq';
      if (own) drive = 5;
      const h = own ? h0 : (h0 + at * 29) % 360;
      lo = hsl(h, 0.9, 0.22);
      hi = hsl((h + (own ? 300 : 40)) % 360, 0.9, 0.6);
    } else if (kind === 'vibrant') {
      const h = (h0 + at * 47) % 360;
      lo = hsl(h, 0.95, 0.18 + w * 0.10);
      hi = hsl((h + 34) % 360, 1.0, 0.52 + w * 0.26);
    } else if (kind === 'muted') {
      const h = (h0 + at * 13) % 360;
      lo = hsl(h, 0.16, 0.16 + w * 0.10);
      hi = hsl(h, 0.24, 0.44 + w * 0.20);
    } else { // bw
      lo = hsl(0, 0, 0.10 + w * 0.14);
      hi = hsl(0, 0, 0.55 + w * 0.42);
    }

    slots[s.key] = s.css
      ? { mode: 'flat', colour: hi }
      : rpRamp(s.key, drive, lo, hi);
  }

  // The ground. Dark in every scheme, because every scheme is additive.
  const ground = {
    mode: 'flat',
    colour: kind === 'bw' ? '#000000'
      : kind === 'muted' ? hsl(h0, 0.10, 0.07)
        : hsl(h0, 0.35, 0.055),
  };
  slots.background = ground;
  // The stage calls it something else and needs it just as dark.
  if (here.some((s) => s.key === 'stageGround')) slots.stageGround = { ...ground };
  return { name: RP_GENERATORS.find((g) => g.key === kind)?.label || kind, slots };
}

// ─────────────────────────────────────────────────────────────────── storage ──

const RP_STORE = 'roomPaintSchemes';
const RP_CURRENT = 'roomPaintCurrent';

function rpSaved() {
  try { return JSON.parse(localStorage.getItem(RP_STORE) || '{}') || {}; }
  catch { return {}; }
}

function rpWriteSaved(all) {
  try { localStorage.setItem(RP_STORE, JSON.stringify(all)); } catch { /* private mode */ }
}

function rpSave(name) {
  const n = (name || '').trim();
  if (!n) return false;
  const all = rpSaved();
  all[n] = { name: n, slots: JSON.parse(JSON.stringify(roomPaint.scheme.slots)) };
  rpWriteSaved(all);
  roomPaint.scheme.name = n;
  rpRemember();
  return true;
}

function rpLoad(name) {
  const s = rpSaved()[name];
  if (!s) return false;
  roomPaint.scheme = { name: s.name || name, slots: s.slots || {} };
  rpTouch();
  rpRemember();
  return true;
}

function rpDelete(name) {
  const all = rpSaved();
  if (!all[name]) return false;
  delete all[name];
  rpWriteSaved(all);
  return true;
}

/// The scheme in use, kept across reloads like every other preference here.
function rpRemember() {
  try { localStorage.setItem(RP_CURRENT, JSON.stringify(roomPaint.scheme)); }
  catch { /* private mode */ }
}

function rpRestore() {
  try {
    const s = JSON.parse(localStorage.getItem(RP_CURRENT) || 'null');
    if (s && s.slots) roomPaint.scheme = { name: s.name || 'Theme', slots: s.slots };
  } catch { /* nothing kept */ }
  rpTouch();
}

// ─────────────────────────────────────────────────────────────── the panel ──
//
// A row per paintable thing, showing the gradient it is actually drawn with.
// Clicking one opens its editor underneath.
//
// **The strip is the control's own answer, not a legend.** `rpGradientCss`
// builds it from the same stops in the same order and the same interpolation as
// the row uploaded to the shader, so a strip that looks wrong means the room
// looks wrong. A hand-drawn preview would be a second implementation of the
// ramp, and this file exists because a second implementation of a colour is how
// the room ended up with four things painted identically.

/// Which slot's editor is open. One at a time: fourteen open editors is a wall.
let rpOpen = null;

function rpPanel() {
  const host = document.getElementById('roomPaintBody');
  if (!host) return;
  // Rebuilt wholesale only when the *shape* changes. A colour well that is
  // rebuilt while it is being dragged loses the system colour panel attached to
  // it — the fault `docs/THEME-EDITOR.md` records, where the value arrived
  // correctly the whole time and the element it arrived through was destroyed
  // sixty times a second.
  if (document.activeElement && host.contains(document.activeElement)
      && document.activeElement.type === 'color') return;

  host.innerHTML = '';
  const modern = rpView !== 'classic';
  host.classList.toggle('rp-modern', modern);
  host.appendChild(rpViewRow());
  host.appendChild(modern ? rpHeadRow() : rpHeadRowClassic());
  for (const s of rpSlots()) host.appendChild(modern ? rpSlotRow(s) : rpSlotRowClassic(s));
}

// ──────────────────────────────────────────────────────── classic or modern ──
//
// **Two views of one palette.** Classic is the tab as it was before the design
// pass — sliders, a menu, a button to go back to the theme — kept whole below
// (`…Classic`). Modern is the instrument: rows of fixed places, knobs, the
// range dragged on its strip, Undo. They read and write the same scheme, so
// switching changes how the controls look and nothing about the room. Which one
// is a per-viewer convenience, kept in the browser.

const RP_VIEW_KEY = 'roomPaintView';
let rpView = (() => {
  try { return localStorage.getItem(RP_VIEW_KEY) === 'classic' ? 'classic' : 'modern'; }
  catch { return 'modern'; }
})();

function rpViewRow() {
  const row = rpEl('div', 'rp-row rp-view-row');
  row.appendChild(rpEl('span', 're-tag', 'VIEW'));
  const seg = rpEl('div', 'rp-view');
  for (const [key, label, title] of [
    ['classic', 'Classic', 'The palette as it was: sliders, a menu for what a ramp is read against.'],
    ['modern', 'Modern', 'The palette as an instrument: fixed places, knobs, the range dragged on its strip, Undo.'],
  ]) {
    const b = rpEl('button', 're-btn' + (rpView === key ? ' active' : ''), label);
    b.title = title;
    b.setAttribute('aria-pressed', rpView === key ? 'true' : 'false');
    b.onclick = () => {
      rpView = key;
      try { localStorage.setItem(RP_VIEW_KEY, key); } catch { /* private mode */ }
      rpPanel();
    };
    seg.appendChild(b);
  }
  row.appendChild(seg);
  return row;
}

/// Replace the whole scheme, keeping the one before for Undo.
function rpReplace(scheme) {
  const before = JSON.parse(JSON.stringify(roomPaint.scheme));
  roomPaint.scheme = scheme;
  rpTouch(); rpRemember(); rpApply();
  rpPrev = before;
  rpPanel();
}

/// What a load menu entry for the theme carries. Not a name anyone can save
/// under: it has a character no text field types.
const RP_THEME_ENTRY = '\u0000theme';

function rpEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function rpHeadRow() {
  const box = rpEl('div', 'rp-head');

  // ── the scheme ──
  const nameRow = rpEl('div', 'rp-row');
  nameRow.appendChild(rpEl('span', 're-tag', 'SCHEME'));
  const name = rpEl('input', 'field rp-name');
  name.value = roomPaint.scheme.name || '';
  name.placeholder = 'name…';
  name.oninput = () => { roomPaint.scheme.name = name.value; };
  nameRow.appendChild(name);
  box.appendChild(nameRow);

  // Under the name, in the control column: the scheme's own line.
  const btns = rpEl('div', 'rp-row rp-btns rp-under');
  const save = rpEl('button', 're-btn', 'Save');
  save.title = 'Keep this palette under its name. Saving over a name replaces it.';
  save.onclick = () => {
    if (rpSave(name.value)) { toast(`Saved “${name.value.trim()}”`); rpPanel(); }
    else toast('Give it a name first');
  };
  btns.appendChild(save);

  const load = rpEl('select', 'field rp-load');
  const saved = rpSaved();
  const names = Object.keys(saved).sort();
  load.appendChild(new Option('Load…', ''));
  // The theme is a scheme like any other — the one with nothing in it — so it
  // is first in the menu rather than a button of its own.
  const theme = new Option('Theme — as shipped', RP_THEME_ENTRY);
  theme.title = 'Drop every override. The room goes back to the three colours the theme gives it.';
  load.appendChild(theme);
  for (const n of names) load.appendChild(new Option(n, n));
  load.onchange = () => {
    if (load.value === RP_THEME_ENTRY) { rpReplace(rpDefaultScheme()); return; }
    const s = load.value && rpSaved()[load.value];
    if (s) rpReplace({ name: s.name || load.value, slots: s.slots || {} });
  };
  btns.appendChild(load);

  const del = rpEl('button', 're-btn', 'Delete');
  del.title = 'Remove the palette currently named above from the saved list.';
  del.onclick = () => {
    const n = (name.value || '').trim();
    if (n && rpDelete(n)) { toast(`Deleted “${n}”`); rpPanel(); }
  };
  btns.appendChild(del);
  // Undo, in a place of its own that stays when there is nothing to undo, so
  // the line never shifts. A second Undo is a redo: two rolls to flip between.
  if (rpPrev) {
    const undo = rpEl('button', 're-btn rp-undo', 'Undo');
    undo.title = 'Put back the palette from before the last generator, load or reset. Again to flip back.';
    undo.onclick = () => rpReplace(rpPrev);
    btns.appendChild(undo);
  } else {
    btns.appendChild(rpEl('span', 'rp-undo-gap'));
  }
  box.appendChild(btns);

  // ── the generators ──
  // On the tag's own line, in six fixed places: two full lines of three, where
  // they used to wrap to whatever the words left over.
  const genRow = rpEl('div', 'rp-row');
  genRow.appendChild(rpEl('span', 're-tag', 'GENERATE'));
  const gens = rpEl('div', 'rp-gens');
  for (const g of RP_GENERATORS) {
    const b = rpEl('button', 're-btn', g.label);
    b.title = `Paint every object at once. Click again for another ${g.label.toLowerCase()}.`;
    b.onclick = () => rpReplace(rpGenerate(g.key));
    gens.appendChild(b);
  }
  genRow.appendChild(gens);
  box.appendChild(genRow);
  return box;
}

function rpSlotRow(s) {
  const wrap = rpEl('div', 'rp-slot');
  const open = rpOpen === s.key;
  // The open row is lit like a chosen place, so the editor under it is plainly
  // its own.
  const head = rpEl('button', 'rp-slot-head' + (open ? ' open' : ''));
  head.title = s.hint || '';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const cfg = rpSlot(s.key);

  head.appendChild(rpEl('span', 'rp-chev', open ? '\u25BE' : '\u25B8'));
  const strip = rpEl('span', 'rp-strip');
  strip.style.background = rpGradientCss(s.key);
  head.appendChild(strip);
  head.appendChild(rpEl('span', 'rp-slot-name', s.label));
  // What it is set to, in a word — so a scheme can be read down the list
  // without opening fourteen editors.
  // The same word as the button that set it.
  const mode = cfg.mode === 'inherit' ? 'theme' : cfg.mode === 'flat' ? 'colour'
    : rpDriveLabel(s, cfg.drive | 0).toLowerCase();
  head.appendChild(rpEl('span', 'rp-slot-mode', mode));
  head.onclick = () => { rpOpen = rpOpen === s.key ? null : s.key; rpPanel(); };
  wrap.appendChild(head);

  if (rpOpen === s.key) wrap.appendChild(rpSlotEditor(s));
  return wrap;
}

/// What a drive is called for this slot. `Own` is the one quantity the layer
/// alone knows, so it goes by that quantity's name.
function rpDriveLabel(s, i) {
  const d = RP_DRIVES[i] || RP_DRIVES[0];
  return d.key === 'own' ? (RP_OWN_LABEL[s.own] || d.label) : d.label;
}

/// A row of fixed places: one per choice, lit by a tint and an edge when on.
///
/// `places` is `[label, on, title, pick]`, or `null` for a place this slot does
/// not have. **An absent choice keeps its place, empty.** The row never closes
/// up, so a word is where it was on every slot and the hand learns it once —
/// the rule the engine row and the Data layer's missing switch already follow.
function rpSeg(name, places) {
  const row = rpEl('div', 'rp-seg');
  row.dataset.seg = name;
  for (const p of places) {
    if (!p) { row.appendChild(rpEl('span', 'rp-seg-gap')); continue; }
    const [label, on, title, pick] = p;
    const b = rpEl('button', 're-btn' + (on ? ' active' : ''), label);
    b.title = title || '';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.onclick = pick;
    row.appendChild(b);
  }
  return row;
}

/// A knob over a range input, as the rest of the Visual column draws them
/// (`rkKnob` in `app.js`). The input stays: the face is drawn behind it and it
/// is laid over the face, so a pointer or the keyboard on the knob is on it.
/// `read` is the reading under the face, kept up to date here.
function rpKnob(input, label, read) {
  const cell = rpEl('span', 'rp-knob');
  cell.appendChild(input);
  if (typeof rkKnob === 'function') rkKnob(input, label, read);
  return cell;
}

function rpSlotEditor(s) {
  const box = rpEl('div', 'rp-edit');
  const cfg = rpSlot(s.key);

  // ── the mode ──
  const modes = rpEl('div', 'rp-row');
  modes.appendChild(rpEl('span', 're-tag', 'PAINT'));
  // The background is one colour by definition: the room adds light to it, and
  // a ground that varied per fragment is not a ground. Its Ramp place is kept,
  // empty.
  const pick = (key) => () => {
    const patch = { mode: key };
    // Starting from what it is already drawn with, so switching mode changes
    // nothing until something else is moved.
    if (key === 'flat' && !cfg.colour) patch.colour = rpInheritedPair(s.key)[1];
    if (key === 'ramp' && !cfg.stops) patch.stops = rpStops(s.key);
    // A ramp's first window, unless it already has one of its own.
    if (key === 'ramp' && cfg.lo == null && cfg.hi == null) Object.assign(patch, rpStartRange(s.key, cfg.drive));
    rpSetSlot(s.key, patch); rpApply(); rpPanel();
  };
  modes.appendChild(rpSeg('mode', [
    ['Theme', cfg.mode === 'inherit',
      'Leave it to the theme. Nothing about this object is sent to the renderer at all, so it draws exactly as it always has.',
      pick('inherit')],
    ['Colour', cfg.mode === 'flat', 'One colour, whatever the sound is doing.', pick('flat')],
    s.flat ? null
      : ['Ramp', cfg.mode === 'ramp', 'A gradient, read against a quantity of your choosing.', pick('ramp')],
  ]));
  box.appendChild(modes);

  if (cfg.mode === 'flat') {
    const row = rpEl('div', 'rp-row');
    row.appendChild(rpEl('span', 're-tag', 'COLOUR'));
    const well = rpEl('input', 're-colour');
    well.type = 'color';
    well.value = cfg.colour || rpInheritedPair(s.key)[1];
    // Updated in place, never rebuilt: see the note at the top of `rpPanel`.
    well.oninput = () => {
      rpSetSlot(s.key, { colour: well.value });
      rpApply();
      const strip = box.parentElement.querySelector('.rp-strip');
      if (strip) strip.style.background = well.value;
    };
    row.appendChild(well);
    box.appendChild(row);
  }

  if (cfg.mode === 'ramp') {
    box.appendChild(rpStopsEditor(s));
    box.appendChild(rpDriveRow(s));
    box.appendChild(rpRangeRow(s));
  }
  return box;
}

function rpStopsEditor(s) {
  const box = rpEl('div', 'rp-row rp-stops');
  // **One list, shared by every control in the editor, and written in place.**
  // Each handler used to rebuild the stops from a copy taken when the editor
  // opened, so the second stop you touched put the first one back to what it
  // was — the well still showed the colour you picked, the strip and the room
  // did not. Sorted once, here: the cells are built in this order and each
  // handler addresses its own cell by index, so the order must not move under
  // them while the editor is open. A stop turned past its neighbour is sorted
  // on the next rebuild.
  const live = [...rpStops(s.key)].sort((a, b) => a.at - b.at);
  const push = () => {
    rpSetSlot(s.key, { stops: live.map((x) => ({ ...x })) });
    rpApply();
    const slot = box.closest('.rp-slot');
    const strip = slot?.querySelector('.rp-strip');
    if (strip) strip.style.background = rpGradientCss(s.key);
    bar.style.background = rpGradientCss(s.key);
    slot?.querySelector('.rp-span')?.rpRedraw?.();
  };

  box.appendChild(rpEl('span', 're-tag', 'STOPS'));

  // ── the gradient, with a tick where each stop sits ──
  // The direct way to move a stop: along the line it is a point on. The knob
  // under each colour stays as the exact one, and the two follow each other.
  const bar = rpEl('div', 'rp-stopbar');
  bar.style.background = rpGradientCss(s.key);
  const ticks = [], knobs = [], reads = [];
  /// Move stop `i` to `v`, from whichever control moved it.
  const setAt = (i, v, from) => {
    v = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
    live[i] = { ...live[i], at: v };
    if (from !== 'knob' && knobs[i]) knobs[i].value = String(Math.round(v * 100));
    if (reads[i]) reads[i].textContent = v.toFixed(2);
    const tk = ticks[i];
    tk.style.left = `${v * 100}%`;
    tk.setAttribute('aria-valuenow', v.toFixed(2));
    push();
  };
  live.forEach((st, i) => {
    const tk = rpEl('span', 'rp-tick');
    tk.appendChild(rpEl('i'));
    tk.querySelector('i').style.background = st.c;
    tk.style.left = `${st.at * 100}%`;
    tk.tabIndex = 0;
    tk.title = 'Where this colour sits. Drag along the gradient; arrow keys, shift for coarse.';
    tk.setAttribute('role', 'slider');
    tk.setAttribute('aria-label', `Stop ${i + 1}: where it sits`);
    tk.setAttribute('aria-valuemin', '0');
    tk.setAttribute('aria-valuemax', '1');
    tk.setAttribute('aria-valuenow', st.at.toFixed(2));
    tk.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      tk.focus({ preventScroll: true });
      try { tk.setPointerCapture(e.pointerId); } catch { /* released below */ }
      // Inside the border, where the ticks are placed.
      const x0 = bar.getBoundingClientRect().left + bar.clientLeft, w = bar.clientWidth;
      const move = (ev) => setAt(i, (ev.clientX - x0) / w, 'tick');
      const up = () => {
        tk.removeEventListener('pointermove', move);
        tk.removeEventListener('pointerup', up);
        tk.removeEventListener('pointercancel', up);
      };
      tk.addEventListener('pointermove', move);
      tk.addEventListener('pointerup', up);
      tk.addEventListener('pointercancel', up);
    });
    tk.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      const cur = live[i].at;
      const to = { ArrowRight: cur + step, ArrowUp: cur + step, ArrowLeft: cur - step, ArrowDown: cur - step,
        Home: 0, End: 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setAt(i, to, 'tick');
    });
    ticks.push(tk);
    bar.appendChild(tk);
  });
  box.appendChild(bar);
  // A cell a stop: its colour on top, where it sits in the gradient as a knob
  // under it, and a way to take it out in the corner.
  const grid = rpEl('div', 'rp-stop-grid');
  live.forEach((st, i) => {
    const cell = rpEl('div', 'rp-stop');
    const well = rpEl('input', 're-colour');
    well.type = 'color';
    well.value = st.c;
    well.title = 'This colour.';
    well.oninput = () => {
      live[i] = { ...live[i], c: well.value };
      ticks[i].querySelector('i').style.background = well.value;
      push();
    };
    cell.appendChild(well);

    const at = rpEl('input', 're-slider');
    at.type = 'range'; at.min = '0'; at.max = '100'; at.step = '1';
    at.value = String(Math.round(st.at * 100));
    at.title = 'Where in the gradient this colour sits. Drag up or down; shift for fine.';
    at.setAttribute('aria-label', `Stop ${i + 1}: where it sits`);
    const read = rpEl('b', null, st.at.toFixed(2));
    at.oninput = () => setAt(i, +at.value / 100, 'knob');
    knobs.push(at);
    reads.push(read);
    cell.appendChild(rpKnob(at, `Stop ${i + 1}`, read));

    if (live.length > 2) {
      const del = rpEl('button', 're-btn rp-stop-del', '×');
      del.title = 'Take this colour out. Two is the fewest a gradient can have.';
      del.setAttribute('aria-label', `Remove stop ${i + 1}`);
      del.onclick = () => {
        live.splice(i, 1);
        push(); rpPanel();
      };
      cell.appendChild(del);
    }
    grid.appendChild(cell);
  });

  const add = rpEl('button', 're-btn rp-add', '+');
  add.title = 'Another colour in the gradient, dropped in the largest gap.';
  add.setAttribute('aria-label', 'Add a stop');
  add.onclick = () => {
    // Into the widest gap rather than at the end: a stop added at 1.0 lands on
    // top of the one already there and appears to do nothing.
    let bestAt = 0.5, best = -1;
    for (let i = 0; i < live.length - 1; i++) {
      const gap = live[i + 1].at - live[i].at;
      if (gap > best) { best = gap; bestAt = (live[i].at + live[i + 1].at) / 2; }
    }
    live.push({ at: bestAt, c: '#ffffff' });
    push(); rpPanel();
  };
  grid.appendChild(add);
  box.appendChild(grid);
  return box;
}

function rpDriveRow(s) {
  const cfg = rpSlot(s.key);
  const row = rpEl('div', 'rp-row');
  row.appendChild(rpEl('span', 're-tag', 'READ AGAINST'));
  row.appendChild(rpSeg('drive', RP_DRIVES.map((d, i) => {
    // A layer with nothing of its own to offer does not get the choice. The
    // attribute is nought there, so the ramp would collapse to its first colour
    // and read as the control being broken.
    if (d.key === 'own' && !s.own) return null;
    return [rpDriveLabel(s, i), (cfg.drive | 0) === i, d.hint,
      () => { rpSetSlot(s.key, { drive: i }); rpApply(); rpPanel(); }];
  })));
  return row;
}

/// The ramp as the room reads it, across the whole of the quantity: the first
/// colour below the window, the gradient spent across it through the curve,
/// the last colour above it. The same row the atlas holds, sampled through the
/// shader's own arithmetic (`pow(clamp((d - lo) / (hi - lo)), curve)`).
function rpSpanCss(key) {
  const cfg = rpSlot(key);
  const row = new Uint8Array(RP_RAMP_W * 4);
  rpFillRow(row, 0, rpStops(key));
  const lo = cfg.lo ?? 0, hi = cfg.hi ?? 1, curve = cfg.curve ?? 1;
  const n = 48, parts = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    const t = Math.max(0, Math.min(1, (x - lo) / Math.max(1e-4, hi - lo)));
    const o = Math.round(Math.pow(t, curve) * (RP_RAMP_W - 1)) * 4;
    parts.push(`rgb(${row[o]}, ${row[o + 1]}, ${row[o + 2]}) ${(x * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/// The smallest window a range can close to. The two ends cannot cross: a
/// window turned inside out is a hard step in the shader, not a reversed ramp.
const RP_SPAN_GAP = 0.01;

/// Each end's number under its own handle, pushed apart where they would
/// touch and kept within the strip. Measured, so it waits for a layout: a
/// row built and not yet in the page is placed on the next turn.
function rpPlaceReads(read, span, lo, hi) {
  const [a, b] = read.children;
  a.textContent = lo.toFixed(2);
  b.textContent = hi.toFixed(2);
  const W = span.clientWidth;
  if (!W) { setTimeout(() => span.isConnected && span.clientWidth && rpPlaceReads(read, span, lo, hi), 0); return; }
  const wa = a.offsetWidth, wb = b.offsetWidth, gap = 4;
  let xa = lo * W - wa / 2, xb = hi * W - wb / 2;
  const over = xa + wa + gap - xb;
  if (over > 0) { xa -= over / 2; xb += over / 2; }
  if (xa < 0) { xb += -xa; xa = 0; }
  if (xb + wb > W) { xa -= xb + wb - W; xb = W - wb; }
  xa = Math.max(0, xa);
  a.style.left = `${xa}px`;
  b.style.left = `${xb}px`;
}

function rpRangeRow(s) {
  const cfg = rpSlot(s.key);
  const row = rpEl('div', 'rp-row rp-range');
  row.appendChild(rpEl('span', 're-tag', 'RANGE'));

  // ── the window, drawn on the strip ──
  const col = rpEl('div', 'rp-span-col');
  const span = rpEl('div', 'rp-span');
  span.title = 'The window of the quantity the gradient is spent across. Drag the window to move it, '
    + 'an edge to move that end. Below it everything takes the first colour, above it the last.';
  const win = rpEl('div', 'rp-span-win');
  const ends = ['lo', 'hi'].map((key) => {
    const h = rpEl('span', `rp-span-end rp-span-${key}`);
    h.tabIndex = 0;
    h.setAttribute('role', 'slider');
    h.setAttribute('aria-label', key === 'lo' ? 'Where the gradient starts' : 'Where the gradient ends');
    h.setAttribute('aria-valuemin', '0');
    h.setAttribute('aria-valuemax', '1');
    h.dataset.end = key;
    win.appendChild(h);
    return h;
  });
  span.appendChild(win);
  const read = rpEl('div', 'rp-span-read');
  read.append(rpEl('span'), rpEl('span'));
  col.append(span, read);
  row.appendChild(col);

  const now = () => { const c = rpSlot(s.key); return { lo: c.lo ?? 0, hi: c.hi ?? 1 }; };
  const draw = () => {
    const { lo, hi } = now();
    win.style.left = `${lo * 100}%`;
    win.style.width = `${(hi - lo) * 100}%`;
    ends[0].setAttribute('aria-valuenow', lo.toFixed(2));
    ends[1].setAttribute('aria-valuenow', hi.toFixed(2));
    span.style.background = rpSpanCss(s.key);
    rpPlaceReads(read, span, lo, hi);
  };
  span.rpRedraw = draw;
  const r2 = (v) => Math.round(v * 100) / 100;
  const set = (lo, hi) => {
    rpSetSlot(s.key, { lo: r2(lo), hi: r2(hi) });
    rpApply();
    draw();
  };
  // One end moved, held clear of the other.
  const setEnd = (key, v) => {
    const { lo, hi } = now();
    if (key === 'lo') set(Math.max(0, Math.min(v, hi - RP_SPAN_GAP)), hi);
    else set(lo, Math.min(1, Math.max(v, lo + RP_SPAN_GAP)));
  };

  span.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const b = span.getBoundingClientRect();
    const at = (ev) => Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width));
    const x0 = at(e), { lo, hi } = now();
    // An edge within a few pixels is that edge; inside the window is the
    // window; outside it, the nearer end jumps to the pointer and follows it.
    const near = 8 / b.width;
    const dLo = Math.abs(x0 - lo), dHi = Math.abs(x0 - hi);
    let grab;
    if (Math.min(dLo, dHi) <= near) grab = dHi < dLo || (dHi === dLo && x0 > hi) ? 'hi' : 'lo';
    else if (x0 > lo && x0 < hi) grab = 'move';
    else { grab = x0 < lo ? 'lo' : 'hi'; setEnd(grab, x0); }
    if (grab !== 'move') ends[grab === 'lo' ? 0 : 1].focus({ preventScroll: true });
    try { span.setPointerCapture(e.pointerId); } catch { /* released below */ }
    const move = (ev) => {
      if (grab !== 'move') { setEnd(grab, at(ev)); return; }
      const w = hi - lo;
      const nlo = Math.max(0, Math.min(1 - w, lo + at(ev) - x0));
      set(nlo, nlo + w);
    };
    const up = () => {
      span.removeEventListener('pointermove', move);
      span.removeEventListener('pointerup', up);
      span.removeEventListener('pointercancel', up);
    };
    span.addEventListener('pointermove', move);
    span.addEventListener('pointerup', up);
    span.addEventListener('pointercancel', up);
  });
  for (const h of ends) {
    h.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      const cur = now()[h.dataset.end];
      const to = { ArrowRight: cur + step, ArrowUp: cur + step, ArrowLeft: cur - step, ArrowDown: cur - step,
        Home: 0, End: 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setEnd(h.dataset.end, to);
    });
  }

  // ── the curve, a knob beside the window it shapes ──
  const curve = rpEl('input', 're-slider rp-curve');
  curve.type = 'range'; curve.min = '20'; curve.max = '400'; curve.step = '1';
  curve.value = String(Math.round((cfg.curve ?? 1) * 100));
  curve.title = 'How the gradient is spent across that range. Below 1 '
    + 'favours the top end, above it favours the bottom. Level is '
    + 'perceptual, so a straight ramp spends most of itself on quiet.';
  curve.setAttribute('aria-label', 'Curve');
  const curveRead = rpEl('b', null, (+curve.value / 100).toFixed(2));
  curve.oninput = () => {
    rpSetSlot(s.key, { curve: +curve.value / 100 });
    curveRead.textContent = (+curve.value / 100).toFixed(2);
    rpApply();
    draw();
  };
  row.appendChild(rpKnob(curve, 'Curve', curveRead));
  draw();
  return row;
}

// ───────────────────────────────────────────────────────── the classic view ──
//
// The tab as it was before the design pass, unchanged but for the names. Picked
// with the VIEW switch at the top of the tab; see `rpViewRow`.

function rpHeadRowClassic() {
  const box = rpEl('div', 'rp-head');

  // ── the scheme ──
  const nameRow = rpEl('div', 'rp-row');
  nameRow.appendChild(rpEl('span', 're-tag', 'SCHEME'));
  const name = rpEl('input', 'field rp-name');
  name.value = roomPaint.scheme.name || '';
  name.placeholder = 'name…';
  name.oninput = () => { roomPaint.scheme.name = name.value; };
  nameRow.appendChild(name);
  box.appendChild(nameRow);

  const btns = rpEl('div', 'rp-row rp-btns');
  const save = rpEl('button', 're-btn', 'Save');
  save.title = 'Keep this palette under its name. Saving over a name replaces it.';
  save.onclick = () => {
    if (rpSave(name.value)) { toast(`Saved “${name.value.trim()}”`); rpPanel(); }
    else toast('Give it a name first');
  };
  btns.appendChild(save);

  const load = rpEl('select', 'field rp-load');
  const saved = rpSaved();
  const names = Object.keys(saved).sort();
  load.appendChild(new Option(names.length ? 'Load…' : 'nothing saved', ''));
  for (const n of names) load.appendChild(new Option(n, n));
  load.onchange = () => {
    if (load.value && rpLoad(load.value)) { rpApply(); rpPanel(); }
  };
  btns.appendChild(load);

  const del = rpEl('button', 're-btn', 'Delete');
  del.title = 'Remove the palette currently named above from the saved list.';
  del.onclick = () => {
    const n = (name.value || '').trim();
    if (n && rpDelete(n)) { toast(`Deleted “${n}”`); rpPanel(); }
  };
  btns.appendChild(del);
  box.appendChild(btns);

  // ── the generators ──
  const genTag = rpEl('div', 'rp-row');
  genTag.appendChild(rpEl('span', 're-tag', 'GENERATE'));
  box.appendChild(genTag);

  const gens = rpEl('div', 'rp-row rp-gens');
  for (const g of RP_GENERATORS) {
    const b = rpEl('button', 're-btn', g.label);
    b.title = `Paint every object at once. Click again for another ${g.label.toLowerCase()}.`;
    b.onclick = () => {
      roomPaint.scheme = rpGenerate(g.key);
      rpTouch(); rpRemember(); rpApply(); rpPanel();
    };
    gens.appendChild(b);
  }
  box.appendChild(gens);

  const foot = rpEl('div', 'rp-row rp-btns');
  const reset = rpEl('button', 're-btn', 'Back to theme');
  reset.title = 'Drop every override. The room goes back to the three colours the theme gives it.';
  reset.onclick = () => {
    roomPaint.scheme = rpDefaultScheme();
    rpTouch(); rpRemember(); rpApply(); rpPanel();
  };
  foot.appendChild(reset);
  box.appendChild(foot);
  return box;
}

function rpSlotRowClassic(s) {
  const wrap = rpEl('div', 'rp-slot');
  const head = rpEl('button', 'rp-slot-head');
  head.title = s.hint || '';
  const cfg = rpSlot(s.key);

  const strip = rpEl('span', 'rp-strip');
  strip.style.background = rpGradientCss(s.key);
  head.appendChild(strip);
  head.appendChild(rpEl('span', 'rp-slot-name', s.label));
  // What it is set to, in a word — so a scheme can be read down the list
  // without opening fourteen editors.
  const mode = cfg.mode === 'inherit' ? 'theme' : cfg.mode === 'flat' ? 'flat'
    : (RP_DRIVES[cfg.drive | 0] || RP_DRIVES[0]).label.toLowerCase();
  head.appendChild(rpEl('span', 'rp-slot-mode', mode));
  head.onclick = () => { rpOpen = rpOpen === s.key ? null : s.key; rpPanel(); };
  wrap.appendChild(head);

  if (rpOpen === s.key) wrap.appendChild(rpSlotEditorClassic(s));
  return wrap;
}

function rpSlotEditorClassic(s) {
  const box = rpEl('div', 'rp-edit');
  const cfg = rpSlot(s.key);

  // ── the mode ──
  const modes = rpEl('div', 'rp-row');
  // The background is one colour by definition: the room adds light to it, and
  // a ground that varied per fragment is not a ground.
  const choices = s.flat
    ? [['inherit', 'Theme'], ['flat', 'Colour']]
    : [['inherit', 'Theme'], ['flat', 'Colour'], ['ramp', 'Ramp']];
  for (const [key, label] of choices) {
    const b = rpEl('button', 're-btn' + (cfg.mode === key ? ' active' : ''), label);
    b.title = key === 'inherit'
      ? 'Leave it to the theme. Nothing about this object is sent to the renderer at all, so it draws exactly as it always has.'
      : key === 'flat' ? 'One colour, whatever the sound is doing.'
        : 'A gradient, read against a quantity of your choosing.';
    b.onclick = () => {
      const patch = { mode: key };
      // Starting from what it is already drawn with, so switching mode changes
      // nothing until something else is moved.
      if (key === 'flat' && !cfg.colour) patch.colour = rpInheritedPair(s.key)[1];
      if (key === 'ramp' && !cfg.stops) patch.stops = rpStops(s.key);
      if (key === 'ramp' && cfg.lo == null && cfg.hi == null) Object.assign(patch, rpStartRange(s.key, cfg.drive));
      rpSetSlot(s.key, patch); rpApply(); rpPanel();
    };
    modes.appendChild(b);
  }
  box.appendChild(modes);

  if (cfg.mode === 'flat') {
    const row = rpEl('div', 'rp-row');
    row.appendChild(rpEl('span', 're-tag', 'COLOUR'));
    const well = rpEl('input', 're-colour');
    well.type = 'color';
    well.value = cfg.colour || rpInheritedPair(s.key)[1];
    // Updated in place, never rebuilt: see the note at the top of `rpPanel`.
    well.oninput = () => {
      rpSetSlot(s.key, { colour: well.value });
      rpApply();
      const strip = box.parentElement.querySelector('.rp-strip');
      if (strip) strip.style.background = well.value;
    };
    row.appendChild(well);
    box.appendChild(row);
  }

  if (cfg.mode === 'ramp') {
    box.appendChild(rpStopsEditorClassic(s));
    box.appendChild(rpDriveRowClassic(s));
    box.appendChild(rpRangeRowClassic(s));
  }
  return box;
}

function rpStopsEditorClassic(s) {
  const box = rpEl('div', 'rp-stops');
  // **One list, shared by every control in the editor, and written in place.**
  // Each handler used to rebuild the stops from a copy taken when the editor
  // opened, so the second stop you touched put the first one back to what it
  // was — the well still showed the colour you picked, the strip and the room
  // did not. Sorted once, here: the rows are built in this order and each
  // handler addresses its own row by index, so the order must not move under
  // them while the editor is open. A stop dragged past its neighbour is sorted
  // on the next rebuild.
  const live = [...rpStops(s.key)].sort((a, b) => a.at - b.at);
  const push = () => {
    rpSetSlot(s.key, { stops: live.map((x) => ({ ...x })) });
    rpApply();
    const strip = box.closest('.rp-slot')?.querySelector('.rp-strip');
    if (strip) strip.style.background = rpGradientCss(s.key);
  };

  const tag = rpEl('div', 'rp-row');
  tag.appendChild(rpEl('span', 're-tag', 'STOPS'));
  const add = rpEl('button', 're-btn', '+');
  add.title = 'Another colour in the gradient, dropped in the largest gap.';
  add.onclick = () => {
    // Into the widest gap rather than at the end: a stop added at 1.0 lands on
    // top of the one already there and appears to do nothing.
    let bestAt = 0.5, best = -1;
    for (let i = 0; i < live.length - 1; i++) {
      const gap = live[i + 1].at - live[i].at;
      if (gap > best) { best = gap; bestAt = (live[i].at + live[i + 1].at) / 2; }
    }
    live.push({ at: bestAt, c: '#ffffff' });
    push(); rpPanel();
  };
  tag.appendChild(add);
  box.appendChild(tag);

  live.forEach((st, i) => {
    const row = rpEl('div', 'rp-row rp-stop');
    const well = rpEl('input', 're-colour');
    well.type = 'color';
    well.value = st.c;
    well.oninput = () => { live[i] = { ...live[i], c: well.value }; push(); };
    row.appendChild(well);

    const at = rpEl('input', 're-slider');
    at.type = 'range'; at.min = '0'; at.max = '100'; at.step = '1';
    at.value = String(Math.round(st.at * 100));
    at.title = 'Where in the gradient this colour sits.';
    at.oninput = () => { live[i] = { ...live[i], at: +at.value / 100 }; push(); };
    row.appendChild(at);

    if (live.length > 2) {
      const del = rpEl('button', 're-btn', '−');
      del.title = 'Take this colour out. Two is the fewest a gradient can have.';
      del.onclick = () => {
        live.splice(i, 1);
        push(); rpPanel();
      };
      row.appendChild(del);
    }
    box.appendChild(row);
  });
  return box;
}

function rpDriveRowClassic(s) {
  const cfg = rpSlot(s.key);
  const row = rpEl('div', 'rp-row');
  row.appendChild(rpEl('span', 're-tag', 'READ AGAINST'));
  const sel = rpEl('select', 'field');
  RP_DRIVES.forEach((d, i) => {
    // A layer with nothing of its own to offer does not get the option. The
    // attribute is nought there, so the ramp would collapse to its first colour
    // and read as the control being broken.
    if (d.key === 'own' && !s.own) return;
    const label = d.key === 'own' ? rpOwnLabel(s.key) : d.label;
    const o = new Option(label, String(i));
    o.title = d.hint;
    sel.appendChild(o);
  });
  sel.value = String(cfg.drive | 0);
  sel.onchange = () => { rpSetSlot(s.key, { drive: +sel.value }); rpApply(); rpPanel(); };
  row.appendChild(sel);
  return row;
}

function rpRangeRowClassic(s) {
  const cfg = rpSlot(s.key);
  const box = rpEl('div', 'rp-range');
  const mk = (label, key, def, hint) => {
    const row = rpEl('div', 'rp-row');
    row.appendChild(rpEl('span', 're-tag', label));
    const sl = rpEl('input', 're-slider');
    sl.type = 'range'; sl.min = '0'; sl.max = '100'; sl.step = '1';
    sl.value = String(Math.round((cfg[key] ?? def) * 100));
    sl.title = hint;
    sl.oninput = () => { rpSetSlot(s.key, { [key]: +sl.value / 100 }); rpApply(); };
    row.appendChild(sl);
    return row;
  };
  box.appendChild(mk('FROM', 'lo', 0,
    'Where the gradient starts. Anything below this takes the first colour.'));
  box.appendChild(mk('TO', 'hi', 1,
    'Where it ends. Bring this down and the whole gradient is spent on the quiet part.'));

  const row = rpEl('div', 'rp-row');
  row.appendChild(rpEl('span', 're-tag', 'CURVE'));
  const sl = rpEl('input', 're-slider');
  sl.type = 'range'; sl.min = '20'; sl.max = '400'; sl.step = '1';
  sl.value = String(Math.round((cfg.curve ?? 1) * 100));
  sl.title = 'How the gradient is spent across that range. Left of the middle '
    + 'favours the top end, right of it favours the bottom. Level is '
    + 'perceptual, so a straight ramp spends most of itself on quiet.';
  sl.oninput = () => { rpSetSlot(s.key, { curve: +sl.value / 100 }); rpApply(); };
  row.appendChild(sl);
  box.appendChild(row);
  return box;
}

/// Everything a change has to reach. The renderer picks the atlas up on its own
/// next frame; the two CSS slots have to be written to the page.
function rpApply() {
  rpRemember();
  if (typeof applyRoomPaintCss === 'function') applyRoomPaintCss();
}

// ────────────────────────────────────────────────────── the room's own shape ──
//
// **The shape, not the pose.** Where you stand in the room is dragged on the
// room itself and always has been — `docs/ROOM-EDITOR.md` makes the argument at
// length, and it is a good one: `floorY = -0.38` against `ceilY = 0.62` is not
// a number anybody can picture, and a field with it in puts a spreadsheet
// between you and the box. Nothing in here is a camera field.
//
// What is in here is the geometry that had no control of any kind: how finely
// the floor is resolved, how far back the trail runs before it reaches the
// wall, how tall the terrain stands, how many seconds of sound the depth stands
// for, and how big a grain is drawn. Every one was a constant in `vis-gl.js`.

const RG_ROWS = [
  { key: 'geomBands', tag: 'FLOOR', min: 8, max: 1024, step: 1, round: true,
    unit: ' bands',
    hint: 'How finely the spectrum is resolved across the floor. **Changing it '
      + 'empties the trail** — every frame already in the air is a row of the '
      + 'old width, and a surface built from a mix of the two would be read off '
      + 'the end of the short ones.' },
  { key: 'geomHistory', tag: 'TRAIL', min: 2, max: 240, step: 1, round: true,
    unit: ' frames',
    hint: 'How far back the terrain runs before it reaches the wall, in frames '
      + 'of spectrum. At the meter’s rate the default is about three '
      + 'seconds of sound standing in the room at once.' },
  { key: 'geomRidge', tag: 'RIDGE', min: 0.02, max: 1.6, step: 0.01,
    hint: 'How tall the terrain stands, as a fraction of the room’s height. '
      + 'Full height leaves nothing above it for the ring to hang in.' },
  { key: 'geomSpan', tag: 'SPAN', min: 0.5, max: 90, step: 0.5, unit: ' s',
    hint: 'How many seconds of sound the room’s depth stands for. Depth is '
      + 'time here, so this is the scale of that axis: shorter and the cloud '
      + 'crosses the room quickly, longer and it hangs.' },
  { key: 'geomBody', tag: 'GRAIN', min: 0.002, max: 0.3, step: 0.001,
    hint: 'How big a grain is drawn, against the room’s height rather than '
      + 'the frame’s width — a grain that swelled when the panel was '
      + 'widened would be describing the panel and not the sound.' },
  { key: 'geomWidth', tag: 'WIDTH', min: 0.2, max: 40, step: 0.05, unit: ' u',
    hint: 'How wide the terrain is, in the world\'s units. A size in the world, not a '
      + 'property of the camera: stand closer and it is bigger, further and it is '
      + 'smaller, and that is all.' },
  { key: 'geomReach', tag: 'REACH', min: 0.2, max: 40, step: 0.05, unit: ' u',
    hint: 'How long the terrain is, in the world\'s units — how far back the trail '
      + 'and the cloud run from its front edge. The front edge itself is dragged on '
      + 'the picture, by its bead on the ground.' },
];

const RG_DEFAULTS = {
  geomBands: 280, geomHistory: 56, geomRidge: 0.62, geomSpan: 14, geomBody: 0.032,
  geomWidth: 1.78, geomReach: 1.9,
};

function rgFormat(row, v) {
  const n = row.round ? String(Math.round(v)) : v.toFixed(row.step < 0.01 ? 3 : 2);
  return n + (row.unit || '');
}

function rgPanel() {
  const host = document.getElementById('roomGeomBody');
  if (!host) return;
  // Not while a slider is being dragged: rebuilding the element under the
  // pointer drops the drag, which is the same fault the palette's colour wells
  // had and the theme editor's before them.
  if (document.activeElement && host.contains(document.activeElement)) return;

  host.innerHTML = '';
  const note = rpEl('div', 'rg-note');
  note.textContent = 'Where you stand is dragged on the room itself. This is '
    + 'what the room is.';
  host.appendChild(note);

  for (const row of RG_ROWS) {
    const box = rpEl('div', 'rp-row');
    const tag = rpEl('span', 're-tag', row.tag);
    tag.title = row.hint.replace(/\*\*/g, '');
    box.appendChild(tag);

    const sl = rpEl('input', 're-slider');
    sl.type = 'range';
    // Sliders count in whole steps, so a value that is a fraction is scaled up
    // and back down rather than handed over as a decimal the control rounds.
    const k = row.round ? 1 : 1000;
    sl.min = String(Math.round(row.min * k));
    sl.max = String(Math.round(row.max * k));
    sl.step = String(Math.max(1, Math.round(row.step * k)));
    sl.value = String(Math.round((roomEdit[row.key] ?? RG_DEFAULTS[row.key]) * k));
    sl.title = row.hint.replace(/\*\*/g, '');
    const read = rpEl('span', 'rg-read', rgFormat(row, roomEdit[row.key]));
    sl.oninput = () => {
      roomEdit[row.key] = +sl.value / k;
      read.textContent = rgFormat(row, roomEdit[row.key]);
      // In place. The room picks it up on its own next frame.
      saveRoomData();
    };
    box.appendChild(sl);
    box.appendChild(read);
    host.appendChild(box);
  }

  const foot = rpEl('div', 'rp-row rp-btns');
  const reset = rpEl('button', 're-btn', 'Back to default');
  reset.title = 'Put the room back to the shape it ships with. The camera is '
    + 'not touched — Reset beside the room is the one that does that.';
  reset.onclick = () => {
    Object.assign(roomEdit, RG_DEFAULTS);
    saveRoomData();
    rgPanel();
  };
  foot.appendChild(reset);
  host.appendChild(foot);
}
