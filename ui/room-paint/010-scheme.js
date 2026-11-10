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

