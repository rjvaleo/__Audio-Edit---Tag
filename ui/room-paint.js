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
  { key: 'box', label: 'Box', row: 0, own: null,
    hint: 'The wireframe: the four runs back and the far wall. Its weight is depth — 0.02 at the front, 0.16 at the wall — so a ramp on it runs along the room.' },
  { key: 'terrainMesh', label: 'Terrain surface', row: 1, own: 'freq',
    hint: 'The solid floor between the ridges.' },
  { key: 'terrainRidge', label: 'Terrain ridges', row: 2, own: 'freq',
    hint: 'The lines over it. Locked to the surface until now, which is why the two read as one thing.' },
  { key: 'lead', label: 'Edge band', row: 3, own: 'freq',
    hint: 'The thick ribbon over the frame you are hearing now.' },
  { key: 'ring', label: 'Ring', row: 4, own: 'width',
    hint: 'The Lissajous hoops hanging in the sky.' },
  { key: 'skin', label: 'Skin', row: 5, own: 'width',
    hint: 'The surface between the hoops.' },
  { key: 'grainBloom', label: 'Grain bloom', row: 6, own: 'pan',
    hint: 'The soft wash around each grain.' },
  { key: 'grainWire', label: 'Grain wires', row: 7, own: 'pan',
    hint: 'The tumbling solid itself.' },
  { key: 'grainCore', label: 'Grain core', row: 8, own: 'pan',
    hint: 'The burning point at its centre.' },
  { key: 'grainFill', label: 'Grain fill', row: 9, own: 'pan',
    hint: 'The skin inside the solid. Only drawn with FILL on and not filling with the background.' },
  { key: 'mist', label: 'Mist', row: 10, own: 'pan',
    hint: 'The smoke dripping off the grains.' },
  { key: 'fog', label: 'Fog', row: 11, own: null,
    hint: 'The air itself. Its weight only ever runs 0.05 to 0.27, so leave the range alone or most of the ramp is never reached.' },
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
  const own = (typeof roomEdit !== 'undefined' && roomEdit.module === 'ridge')
    ? RP_RIDGE_SLOTS : RP_SLOTS;
  // The card is drawn over both modules, so its colours are on offer under both
  // — appended rather than merged in, so the module's own slots stay together
  // at the top of the list where they were.
  return typeof RT_SLOTS === 'undefined' ? own : own.concat(RT_SLOTS);
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
    case 'box': return [cold, cold];
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

/// The slots that carry the room's light, and roughly how bright each should
/// sit relative to the others. The cloud burns hottest, the box is furniture.
const RP_WEIGHT = {
  box: 0.30, terrainMesh: 0.42, terrainRidge: 0.72, lead: 0.86,
  ring: 0.78, skin: 0.40, grainBloom: 0.50, grainWire: 0.72,
  grainCore: 1.00, grainFill: 0.26, mist: 0.44, fog: 0.34, data: 0.55,
};

function rpRamp(key, drive, a, b, extra) {
  return { mode: 'ramp', drive, lo: 0, hi: 1, curve: 1,
    stops: [{ at: 0, c: a }, { at: 1, c: b }], ...(extra || {}) };
}

function rpGenerate(kind, hue0) {
  const h0 = hue0 == null ? Math.floor(Math.random() * 360) : hue0;
  const slots = {};
  const lit = (k) => RP_WEIGHT[k] ?? 0.5;

  for (const s of RP_SLOTS) {
    if (s.key === 'background') continue;
    const w = lit(s.key);
    let lo, hi, drive = 0;

    if (kind === 'mono') {
      lo = hsl(h0, 0.55, 0.10 + w * 0.16);
      hi = hsl(h0, 0.62, 0.42 + w * 0.34);
    } else if (kind === 'rgb') {
      // Three primaries, one per family: the floor, the sky, the cloud. What
      // makes this legible is that the families are told apart by hue rather
      // than by brightness, so all three can be loud at once.
      const fam = s.key.startsWith('terrain') || s.key === 'lead' || s.key === 'box' ? 0
        : s.key === 'ring' || s.key === 'skin' ? 1 : 2;
      const h = [0, 122, 218][fam];
      lo = hsl(h, 0.85, 0.14 + w * 0.10);
      hi = hsl(h, 0.92, 0.48 + w * 0.30);
    } else if (kind === 'spectrum') {
      // The floor and the leading edge read against **frequency**, so the
      // spectrum comes out as a spectrum — the thing this room could always
      // have shown and never did, because the only quantity on offer was level.
      const own = s.own === 'freq';
      if (own) drive = 5;
      const h = own ? h0 : (h0 + RP_SLOTS.indexOf(s) * 29) % 360;
      lo = hsl(h, 0.9, 0.22);
      hi = hsl((h + (own ? 300 : 40)) % 360, 0.9, 0.6);
    } else if (kind === 'vibrant') {
      const h = (h0 + RP_SLOTS.indexOf(s) * 47) % 360;
      lo = hsl(h, 0.95, 0.18 + w * 0.10);
      hi = hsl((h + 34) % 360, 1.0, 0.52 + w * 0.26);
    } else if (kind === 'muted') {
      const h = (h0 + RP_SLOTS.indexOf(s) * 13) % 360;
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
  slots.background = {
    mode: 'flat',
    colour: kind === 'bw' ? '#000000'
      : kind === 'muted' ? hsl(h0, 0.10, 0.07)
        : hsl(h0, 0.35, 0.055),
  };
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
  host.appendChild(rpHeadRow());
  for (const s of rpSlots()) host.appendChild(rpSlotRow(s));
}

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

function rpSlotRow(s) {
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

  if (rpOpen === s.key) wrap.appendChild(rpSlotEditor(s));
  return wrap;
}

function rpSlotEditor(s) {
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
    box.appendChild(rpStopsEditor(s));
    box.appendChild(rpDriveRow(s));
    box.appendChild(rpRangeRow(s));
  }
  return box;
}

function rpStopsEditor(s) {
  const box = rpEl('div', 'rp-stops');
  const stops = rpStops(s.key);
  const tag = rpEl('div', 'rp-row');
  tag.appendChild(rpEl('span', 're-tag', 'STOPS'));
  const add = rpEl('button', 're-btn', '+');
  add.title = 'Another colour in the gradient, dropped in the largest gap.';
  add.onclick = () => {
    const sorted = [...stops].sort((a, b) => a.at - b.at);
    // Into the widest gap rather than at the end: a stop added at 1.0 lands on
    // top of the one already there and appears to do nothing.
    let bestAt = 0.5, best = -1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].at - sorted[i].at;
      if (gap > best) { best = gap; bestAt = (sorted[i].at + sorted[i + 1].at) / 2; }
    }
    rpSetSlot(s.key, { stops: [...sorted, { at: bestAt, c: '#ffffff' }] });
    rpApply(); rpPanel();
  };
  tag.appendChild(add);
  box.appendChild(tag);

  const sorted = [...stops].sort((a, b) => a.at - b.at);
  sorted.forEach((st, i) => {
    const row = rpEl('div', 'rp-row rp-stop');
    const well = rpEl('input', 're-colour');
    well.type = 'color';
    well.value = st.c;
    well.oninput = () => {
      const next = sorted.map((x, j) => (j === i ? { ...x, c: well.value } : x));
      rpSetSlot(s.key, { stops: next });
      rpApply();
      const strip = box.closest('.rp-slot')?.querySelector('.rp-strip');
      if (strip) strip.style.background = rpGradientCss(s.key);
    };
    row.appendChild(well);

    const at = rpEl('input', 're-slider');
    at.type = 'range'; at.min = '0'; at.max = '100'; at.step = '1';
    at.value = String(Math.round(st.at * 100));
    at.title = 'Where in the gradient this colour sits.';
    at.oninput = () => {
      const next = sorted.map((x, j) => (j === i ? { ...x, at: +at.value / 100 } : x));
      rpSetSlot(s.key, { stops: next });
      rpApply();
      const strip = box.closest('.rp-slot')?.querySelector('.rp-strip');
      if (strip) strip.style.background = rpGradientCss(s.key);
    };
    row.appendChild(at);

    if (sorted.length > 2) {
      const del = rpEl('button', 're-btn', '−');
      del.title = 'Take this colour out. Two is the fewest a gradient can have.';
      del.onclick = () => {
        rpSetSlot(s.key, { stops: sorted.filter((_, j) => j !== i) });
        rpApply(); rpPanel();
      };
      row.appendChild(del);
    }
    box.appendChild(row);
  });
  return box;
}

function rpDriveRow(s) {
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

function rpRangeRow(s) {
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
];

const RG_DEFAULTS = {
  geomBands: 280, geomHistory: 56, geomRidge: 0.62, geomSpan: 14, geomBody: 0.032,
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
