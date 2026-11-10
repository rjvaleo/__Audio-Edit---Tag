// The 3D visualiser. WebGL, written here, no dependency.
//
// A room seen in perspective:
//
//   · the **spectrum along the floor**, the newest frame at the front and older
//     ones receding into the distance — depth is time,
//   · the **Lissajous in the sky**, given a third axis so the stereo trace is
//     an object hanging in the space rather than a flat figure,
//   · the **VU ladders standing at the right**.
//
// See `docs/VISUALISER.md`. WebGL 1 only — no extensions, no vertex texture
// fetch (which WebGL 1 is allowed to refuse), nothing that needs asking.
//
// One global scope: every name in here starts `vg`.

/// The room's shape and the camera looking into it, in one value.
///
/// These were six constants read straight out of the module at every draw call,
/// which was fine while there was one frame shape to draw for. There are five
/// now — the video export offers 16:9, 1:1, 4:5 and 9:16, and the numbers that
/// suit a wide dock do not suit a tall frame — so the camera is a value that
/// can be handed in per frame and edited while you look at it. See
/// `docs/ROOM-EDITOR.md`.
///
/// * `depth` — how far the room runs back, as a multiple of the distance to its
///   front face. This sets how strongly it converges: the back face draws at
///   `1 / (1 + depth)` of the front one.
/// * `floorY`, `ceilY` — where the floor sits below the eye and the ceiling
///   above it, at the front face. **Their asymmetry about zero is the camera
///   angle.** The frustum is shifted rather than the camera tilted, which is
///   what puts the vanishing point above the middle so the floor is visible at
///   all, while the front face still lands exactly on the canvas edges.
/// * `shiftX` — the same trick sideways. Zero is the vanishing point centred.
/// * `skyAt`, `ring` — where the Lissajous hangs up the room, and how big it
///   is, both as fractions of the room's height. Taken from the height and
///   never the width, which is what keeps it round at any aspect.
/// * `lead` — how thick the floor's leading edge is drawn, in world units.
const VG_CAMERA = {
  depth: 1.9,
  floorY: -0.38,
  ceilY: 0.62,
  shiftX: 0,
  skyAt: 0.72,
  ring: 0.17,
  lead: 0.012,
};

/// A camera with anything missing filled in from the default, so a stored one
/// from before a field existed still draws.
function vgCamera(c) {
  return c ? { ...VG_CAMERA, ...c } : VG_CAMERA;
}

// ── the world camera ────────────────────────────────────────────────────────
//
// The room's camera is a box: a floor and a ceiling at the near plane, a
// vanishing point slid sideways, a far wall. The open world's camera is a
// place you stand: a height above the ground, a pitch, a yaw, a reach. This
// is the second, and the mapping between the two, exact both ways, so that a
// stored world camera draws the very box it was made from until the box goes.
// See `docs/OPEN-WORLD-PLAN.md`, step one, and `docs/OPEN-WORLD.md`.
//
// Angles are degrees, because the readout prints them and a person reads
// them. The box's tilt is the frustum's asymmetry, so its pitch is the angle
// to the middle of the near rectangle; its yaw is the angle to the slid
// vanishing point, which depends on the aspect the room was posed in — so a
// world camera carries the aspect it was made at, and the trip back is exact
// whatever the window is doing now. Until the ground replaces the box, the
// ring's place and the taper come along unchanged.

const VG_WORLD_DEFAULT = {
  /// The shape of this record. Two: the eye has a place, the ring's depth is
  /// absolute, and the layers' reach belongs to the geometry.
  v: 2,
  /// Where the eye stands: across, and along. `height` is up.
  x: 0,
  z: 0,
  /// The eye above the ground.
  height: 0.38,
  /// Up is positive. Degrees.
  pitch: 6.843,
  /// Right is positive. Degrees.
  yaw: 0,
  /// How much it sees, top to bottom. Degrees. The box's height was one unit
  /// at one unit's distance, which is this.
  fov: 53.13,
  /// The aspect the camera was posed at, which a box camera's sideways slide
  /// is measured against on the way in.
  aspect: 16 / 9,
  /// Where the ring hangs, in units — across, up from the ground, and along
  /// (negative is away from where the eye starts) — and its radius.
  ring: { x: 0, y: 0.72, z: -1, size: 0.17 },
};

/// The layers' own height unit: what the box's floor-to-ceiling was. The
/// terrain's ridges, the cloud's spread and the solid's path are fractions of
/// it, and it is a size in the world, not a property of the camera.
const VG_WORLD_H = 1;
/// The terrain's width, in units, when nothing says otherwise: the box's
/// floor at sixteen by nine.
const VG_WORLD_W = 1.78;
/// The terrain's length, in units, when nothing says otherwise: the box's
/// depth.
const VG_WORLD_REACH = 1.9;
/// Where the terrain's front edge lies when nothing says otherwise: one unit
/// ahead of where the eye starts, which is where the box's near face was.
const VG_WORLD_AT = { x: 0, z: -1 };


const VG_DEG = 180 / Math.PI;

// ── the solid: one shape, any dimension, every control ─────────────────────
//
// Both catalogues come through here. A four-dimensional (or higher) solid
// carries a `w` and turns in every plane it has; a grain shape is lifted
// into four as a prism, so it does too. **Every control reaches every
// shape.** The
// sound's turn — `zw`, `xw` — used to touch only the four-dimensional ones,
// and the eye only their projection, so the grain shapes sat there ignoring
// TURN and EYE. Now a three-dimensional shape takes the sound's turn in the
// planes it has, and the eye is a perspective along its own depth — close
// in, its near side swells and its far side shrinks, which is the same
// nesting the tesseract shows — and its depth stands in for `w`, so it is
// coloured through the same way.

const VG_SOLID_CACHE = new Map();

/// A shape by key, from either catalogue: `{ shape, is4d }`, or null.
function vgSolidShape(key) {
  if (typeof Shapes4D !== 'undefined' && Shapes4D.entry(key)) {
    return { shape: Shapes4D.shape(key), is4d: true };
  }
  if (typeof GRAIN_SHAPES === 'undefined') return null;
  const g = GRAIN_SHAPES.find((m) => m.name === key);
  if (!g) return null;
  let built = VG_SOLID_CACHE.get(key);
  if (!built) {
    // **Lifted into four dimensions as a prism.** Two copies of the shape,
    // one at w = -1 and one at w = +1, every vertex joined to its twin — the
    // same construction that makes a tesseract out of a cube. So a turn
    // through ZW swings the two copies through each other and the shape
    // turns inside out, which a three-dimensional wireframe never could.
    // The height in w is the shape's own radius, so the prism is as deep as
    // it is wide, as the tesseract is.
    const n = g.verts;
    let r = 0;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]));
    const h = r > 0 ? r : 1;
    const verts = [];
    for (const w of [-h, h]) {
      for (let i = 0; i < n; i++) verts.push([g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2], w]);
    }
    const edges = [];
    for (let i = 0; i < g.lines; i++) {
      const a = g.idx[i * 2], b = g.idx[i * 2 + 1];
      edges.push([a, b], [a + n, b + n]);
    }
    for (let i = 0; i < n; i++) edges.push([i, i + n]);
    // Unit radius, as the catalogue's solids are, so SIZE means the same.
    const far = Math.hypot(h, h) || 1;
    built = { dim: 4, verts: verts.map((v) => v.map((x) => x / far)), edges, prism: true };
    VG_SOLID_CACHE.set(key, built);
  }
  return { shape: built, is4d: true };
}

/// The angles for a shape of `dim` dimensions from the solid's four drives:
/// the clock's slow turn, and the sound's. Every plane past the fourth axis
/// is driven from the same two numbers at its own rate, so a 9-simplex turns
/// in all twenty-one of its planes and no two of them together.
function vgSolidAngles(dim, clock, zw, xw) {
  const a = { xy: clock, yz: clock * 0.37, zw, xw };
  for (let d = 4; d < dim; d++) {
    a[`x${d}`] = zw * (0.53 + 0.11 * d);
    a[`y${d}`] = xw * (0.71 + 0.07 * d);
    a[`z${d}`] = clock * (0.19 + 0.05 * d);
  }
  return a;
}

/// A shape as it stands: turned by `ang`, seen from `eye`. `turned` keeps a
/// fourth number per vertex for the colour — `w`, or depth for a
/// three-dimensional shape — and `flat` is three-dimensional.
function vgSolidPose(shape, is4d, ang, eye) {
  if (is4d) {
    const t = Shapes4D.rotate(shape.verts, ang);
    return { turned: t, flat: Shapes4D.project(t, { eye }) };
  }
  // Three planes: the clock's two, and the sound's turn about the vertical
  // — plus the sound's second drive folded into the spin, so TURN is seen.
  const xy = (ang.xy || 0) + (ang.xw || 0), yz = ang.yz || 0, xz = ang.zw || 0;
  const c1 = Math.cos(xy), s1 = Math.sin(xy);
  const c2 = Math.cos(yz), s2 = Math.sin(yz);
  const c3 = Math.cos(xz), s3 = Math.sin(xz);
  const turned = shape.verts.map((p) => {
    const x1 = p[0] * c1 - p[1] * s1, y1 = p[0] * s1 + p[1] * c1;
    const y2 = y1 * c2 - p[2] * s2, z2 = y1 * s2 + p[2] * c2;
    const x3 = x1 * c3 + z2 * s3, z3 = -x1 * s3 + z2 * c3;
    return [x3, y2, z3, z3];
  });
  // Perspective along the shape's own depth, held clear of its far vertex
  // the way the four-dimensional projection holds clear of `w`.
  let far = 0;
  for (const v of turned) far = Math.max(far, v[2]);
  const e = Math.max(eye, far + 0.05);
  const flat = turned.map((v) => { const k = e / (e - v[2]); return [v[0] * k, v[1] * k, v[2] * k]; });
  return { turned, flat };
}

/// Whether a stored camera is a world one. A box camera has a floor.
function vgIsWorld(c) {
  return !!c && typeof c === 'object' && !('floorY' in c) && ('height' in c || 'pitch' in c);
}

/// A box camera as a world camera, posed at `aspect`.
function vgWorldFromBox(b, aspect) {
  const c = vgCamera(b);
  const a = aspect > 0 ? aspect : VG_WORLD_DEFAULT.aspect;
  const hh = c.ceilY - c.floorY;
  const halfW = hh * 0.5 * a;
  return {
    v: 2,
    x: 0,
    z: 0,
    height: -c.floorY,
    pitch: Math.atan((c.floorY + c.ceilY) / 2) * VG_DEG,
    yaw: Math.atan(c.shiftX * halfW) * VG_DEG,
    fov: 2 * Math.atan(hh / 2) * VG_DEG,
    // The box's depth is the layers' reach; carried on the camera only so a
    // box camera arriving alone can still say how long its room was.
    reach: c.depth,
    aspect: a,
    ring: { x: 0, y: c.skyAt * VG_WORLD_H, z: -1, size: c.ring * VG_WORLD_H },
  };
}

/// A world camera from before the eye could move: the ring's depth was
/// behind the near plane and the reach rode on the camera. Brought up to
/// date, once, wherever one is read.
function vgWorldUpgrade(w) {
  if (!w || typeof w !== 'object') return w;
  if (w.v >= 2) return w;
  const ring = w.ring || VG_WORLD_DEFAULT.ring;
  return {
    ...w,
    v: 2,
    x: Number.isFinite(w.x) ? w.x : 0,
    z: Number.isFinite(w.z) ? w.z : 0,
    ring: { x: Number.isFinite(ring.x) ? ring.x : 0, y: ring.y, z: -1 - (Number.isFinite(ring.z) ? ring.z : 0), size: ring.size },
  };
}

/// A world camera as the box it draws. The exact inverse of the above.
function vgBoxFromWorld(w) {
  const d = VG_WORLD_DEFAULT;
  const height = Number.isFinite(w?.height) ? w.height : d.height;
  const yaw = Number.isFinite(w?.yaw) ? w.yaw : d.yaw;
  const fov = Number.isFinite(w?.fov) ? w.fov : d.fov;
  const a = w?.aspect > 0 ? w.aspect : d.aspect;
  // The box has no pitch of its own: its floor is pinned to the bottom of
  // the frame, so the eye's height *is* the tilt. A world camera's pitch is
  // its own and does not survive this trip; nothing that draws reads it
  // from here any more.
  const floorY = -height;
  const hh = 2 * Math.tan(fov / 2 / VG_DEG);
  const ceilY = floorY + hh;
  const halfW = hh * 0.5 * a;
  const shiftX = halfW > 0 ? Math.tan(yaw / VG_DEG) / halfW : 0;
  const ring = w?.ring || d.ring;
  return {
    depth: Number.isFinite(w?.reach) ? w.reach : VG_WORLD_REACH,
    floorY,
    ceilY,
    shiftX: Math.max(-1, Math.min(1, shiftX)),
    skyAt: (Number.isFinite(ring.y) ? ring.y : d.ring.y) / VG_WORLD_H,
    ring: (Number.isFinite(ring.size) ? ring.size : d.ring.size) / VG_WORLD_H,
  };
}

/// Whatever shape a camera arrives in, the box it draws. A box camera passes
/// through; a world camera is turned back; nothing is the default.
function vgBoxOf(c) {
  if (!c) return null;
  return vgIsWorld(c) ? vgBoxFromWorld(c) : c;
}

/// How far the world is drawn — the ground grid, the fog — beyond the layers'
/// own reach. Far enough that the grid meets its horizon rather than ending.
const VG_HORIZON = 80;
/// The ground grid's spacing, in world units (the near plane is one unit from
/// the eye, and the box's height was one).
const VG_GRID_STEP = 0.5;

/// A world point through a matrix, to normalised device coordinates. `w` is
/// the clip depth; behind the eye it is not positive.
function vgProjectPoint(m, x, y, z) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return { x: cx / cw, y: cy / cw, w: cw };
}

/// The world point at a given `z` that lands at `(ndcX, ndcY)`. Two linear
/// equations in `x` and `y`; a general matrix, so a turned or pitched camera
/// unprojects as exactly as a straight one.
function vgUnprojectAtZ(m, ndcX, ndcY, z) {
  const a = m[0] - ndcX * m[3], b = m[4] - ndcX * m[7];
  const c = m[1] - ndcY * m[3], d = m[5] - ndcY * m[7];
  const e = ndcX * (m[11] * z + m[15]) - (m[8] * z + m[12]);
  const f = ndcY * (m[11] * z + m[15]) - (m[9] * z + m[13]);
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return { x: 0, y: 0, z };
  return { x: (e * d - b * f) / det, y: (a * f - c * e) / det, z };
}

/// The world's own view: a look-at from the eye along pitch and yaw, and a
/// symmetric perspective of `fov` degrees. What the room draws with, since the
/// ground replaced the box.
function vgWorldView(w, aspect, near, far) {
  const d = VG_WORLD_DEFAULT;
  const height = Number.isFinite(w?.height) ? w.height : d.height;
  const pitch = (Number.isFinite(w?.pitch) ? w.pitch : d.pitch) / VG_DEG;
  const yaw = (Number.isFinite(w?.yaw) ? w.yaw : d.yaw) / VG_DEG;
  const fov = (Number.isFinite(w?.fov) ? w.fov : 2 * Math.atan(0.5) * VG_DEG) / VG_DEG;
  const eye = [Number.isFinite(w?.x) ? w.x : 0, height, Number.isFinite(w?.z) ? w.z : 0];
  const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const at = [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]];
  const view = vgLookAt(eye, at, [0, 1, 0]);
  const t = Math.tan(fov / 2) * near;
  const proj = vgFrustum(-t * aspect, t * aspect, -t, t, near, far);
  return { eye, dir, view, proj, mvp: vgMul(proj, view) };
}

/// Frames kept for the trail. About three seconds at the poll's rate, which is
/// long enough to see a phrase move away from you.
const VG_HISTORY = 56;
/// Pairs kept from one Lissajous figure.
///
/// **What is stored, not what is drawn.** These were the same number for a long
/// time — a quarter of the thousand-odd pairs the trace arrives with, on the
/// grounds that at the size this draws it is the same picture for a quarter of
/// the memory. It is not the same picture: at 256 the ring is visibly faceted
/// and the beads along the leading hoop stand apart from each other.
///
/// So the whole trace is kept and how finely it is *drawn* is a separate
/// question, asked per frame. Splitting the two is what lets the resolution be
/// turned up while it is being looked at, without the frames already in the
/// trail being stuck at whatever it was when they arrived.
///
/// Fifty-six frames of this is under half a megabyte.
const VG_LISS_POINTS = 1024;

/// The palette atlas: 256 samples across, one row per paintable thing.
///
/// Both powers of two, which is what lets the texture take a LINEAR filter
/// without mipmaps on WebGL 1. 256 is where a gradient stops banding at the
/// sizes anything here is drawn at; sixteen rows is thirteen things and three
/// spare, at a cost of three kilobytes.
const VG_RAMP_W = 256;
const VG_RAMP_ROWS = 16;

/// How finely the ring is drawn, unless the caller says otherwise.
const VG_RING_POINTS = 1024;
/// Below this a ring is visibly a polygon.
const VG_RING_POINTS_MIN = 48;
/// And above this there is no more to be had on any screen this will run on.
///
/// **Not capped by the trace.** The ring is interpolated between the samples
/// rather than snapped to them, so asking for four points between every pair of
/// samples gives four real points on a smooth curve — not the same sample drawn
/// four times. The number of pairs the analyser hands over stopped being the
/// ceiling on how smooth this can look.
const VG_RING_POINTS_MAX = 2048;

/// How many grain streaks may be drawn at once.
///
/// The schedule can hold far more than this — a long file at sixteen layers is
/// millions — and nothing is served by drawing them: past a few thousand the
/// room is a solid wash and the cost is real. The cap is on what is *drawn*,
/// not on what is read, so the ones nearest the playhead are the ones that get
/// in.
const VG_GRAIN_CAP = 6000;

/// How long the grains persist along the depth axis, in seconds.
///
/// **Not the floor's trail.** The terrain holds `VG_HISTORY` frames at the
/// poll's rate, which is 2.8 seconds, and while the grains shared that number
/// the room drew about a hundred of them out of four thousand in hand — the
/// depth window was the limit, not the cap, and the picture was thinner than
/// the waveform's own grain layer for no reason anybody could see.
///
/// The floor's length is set by what a spectrum trail is worth keeping. A
/// grain's is set by how much of the schedule is worth having in the air at
/// once, which is a different question with a much longer answer: they are
/// discrete marks that stay legible stacked deep, where a spectrum ridge just
/// becomes fog.
const VG_GRAIN_SPAN_S = 14;

/// How far a grain's own speed may sit either side of the cloud's.
///
/// Every grain crossed in one frame used to be given the same age and the same
/// speed, so a frame's worth of them travelled as a rigid sheet — and a stack
/// of sheets sliding back in step reads as a lattice rather than as a cloud.
/// The waveform's grain layer has no such structure, and the difference is not
/// the number of grains: it is that nothing in it is in step with anything
/// else. A grain drawn from this range keeps its own pace for its whole
/// journey, so a group born together comes apart on the way to the wall.
const VG_GRAIN_SPREAD = 0.34;

/// How far a grain wanders across and up over a whole journey, in fractions of
/// the room.
///
/// Dispersion is a thing that *happens*, not a thing set at birth: a scatter
/// laid down once and then translated backwards is the same picture at every
/// depth. Drifting against age means the near field stays as tight as the
/// schedule really is and the far field opens out, which is what gives the box
/// its depth without a single extra grain being drawn.
const VG_GRAIN_DRIFT = 0.13;

/// The depth a grain may be born ahead of or behind its frame, in fractions of
/// the room.
///
/// Small — it exists to break the plane, not to move a grain off the moment it
/// sounded. Without it the birth frame is visible as a flat rank however much
/// the grains scatter across the face of the room.
const VG_GRAIN_BORN_JITTER = 0.018;

/// How much brighter a grain is at the instant it is born, and how fast that
/// falls away.
///
/// The waveform layer draws the schedule faintly and the grains sounding *now*
/// as struck sparks, and that pairing is most of why it reads as alive. Here
/// the near face already is now, so the flash needs no separate pass: a grain
/// arrives hot and cools as it travels, which colours the room by age.
const VG_GRAIN_FLASH = 1.25;
const VG_GRAIN_FLASH_FALL = 9.0;

/// A grain's radius, as a fraction of the room's height at full level.
///
/// A grain was a dot with a stick behind it, and both of those are marks rather
/// than things: a dot has no size to read and a stick pointing away from you is
/// foreshortened to nearly nothing, because a grain's own length is a few
/// hundredths of a second against a room fourteen seconds deep. So a grain is a
/// solid — one of the shapes in `grain-shapes.js` — and this is how big it is.
///
/// Its depth is still its duration, and still small. It is no longer the only
/// thing there is to see.
const VG_GRAIN_BODY = 0.032;

/// How fast a grain turns, in turns per journey, at the quickest.
///
/// They tumble because a field of solids all facing the same way is a pattern,
/// and because a wireframe that never turns is a flat drawing of a solid rather
/// than a solid — the turning is the whole of the depth cue at this size. The
/// rate is per grain and the phase is per grain, so no two are in step.
const VG_GRAIN_SPIN = 1.6;

/// The most line-vertices the cloud will put on screen in one frame.
///
/// The shapes run from six edges to ninety, so the cost of a cloud is not the
/// number of grains in it — it is the wire. This is the budget, and grains are
/// added until it is gone: at a few hundred grains nothing is ever refused, and
/// a room holding thousands spends it on the ones nearest the front.
const VG_GRAIN_LINE_CAP = 48000;

/// The layers, highest in the hierarchy first.
///
/// **This is a draw order, and a draw order is what occlusion is.** The depth
/// buffer decides what is in front geometrically, but a layer only *masks* the
/// ones after it if it wrote depth before they were drawn — so the thing at the
/// top of this list is the thing that gets to be seen. Moving a layer up the
/// list is the whole of what "higher up the hierarchy" means here.
///
/// The interface stacks its chips in this order, top to bottom, so the list on
/// screen and the list here are the same list read the same way.
const VG_LAYER_ORDER = ['grid', 'solid', 'sky', 'skin', 'grains', 'lead', 'floor'];

/// The most mask vertices the grain cloud will write in one frame.
///
/// A mask is eight triangles a grain, which is more geometry than the six-edge
/// solids carry and less than the ninety-edge ones. Past this the grains still
/// draw, they just stop hiding each other — the cloud losing its depth is a
/// better failure than the cloud losing its frame rate.
const VG_GRAIN_MASK_CAP = 36000;

/// How many sides the mask standing in for a grain has.
///
/// The grain is a solid of unit radius, so what should stand in its way is the
/// disc it covers. Eight sides is close enough to a disc at the size a grain is
/// drawn, and a quad — the obvious cheap answer — is not: its corners reach out
/// forty per cent further than the shape does, and a neighbour disappearing
/// behind a corner of nothing is exactly the artefact this is meant to avoid.
const VG_GRAIN_MASK_SIDES = 8;

/// The most fill vertices the grain cloud will lay down in one frame.
///
/// A skin is a good deal more geometry than a wireframe — a truncated
/// icosahedron is ninety edges and a hundred and sixteen triangles — so the
/// fill gets a budget of its own rather than eating the wire's. Past it the
/// grains still draw and still occlude; they just stop being filled, which is
/// the right thing to lose first.
const VG_GRAIN_FILL_CAP = 60000;

/// The most mist points one grain may shed.
///
/// The mist is a *trail*, not a simulation. Each point is worked out from the
/// grain's own hash and how far back along its journey it sits, so there is no
/// particle system here and nothing to keep between frames — the same
/// discipline the grains themselves follow. A trail that had to be remembered
/// would have to be rebuilt after every seek, and would drift from the picture
/// the export draws.
const VG_MIST_PER_GRAIN = 16;

/// And the most it will lay down across the whole cloud in one frame.
const VG_MIST_CAP = 120000;

/// How many billboards the fog volume is made of at full density.
///
/// **Fog on geometry is not fog in the air.** Shading a fragment by its
/// distance tints the things that are *there* — it cannot put anything between
/// them, because in empty space there is no fragment to shade. That is the half
/// of fog a distance function can do, and on a room that is mostly empty space
/// it is nearly nothing: measured, tinting alone moved the far half of the
/// picture by two per cent.
///
/// The other half is this. A field of large, soft, slowly drifting billboards
/// spread through the room's depth, at the fog's own colour — which is what
/// every engine that has convincing fog actually draws, whatever the shader
/// does on top.
///
/// The count is high because the field reaches well past the frame on every
/// side: fog with a visible edge is not fog, so most of these are never seen
/// and the ones in frame are what make it dense enough to read as air.
const VG_FOG_MOTES = 1400;

// The leading edge's thickness is `camera.lead`. It is geometry rather than
// `gl.lineWidth`, which almost every driver clamps to 1 and is therefore not a
// way to make anything thicker.
/// Points across the floor. Independent of how many bands the server sends —
/// the floor is resampled to this, so changing the analyser's resolution does
/// not rebuild the mesh.
const VG_FLOOR_BANDS = 280;

/// How tall the terrain stands, as a fraction of the room's height.
///
/// A full-height ridge would reach the ceiling on a loud band and there would be
/// nothing above it for the ring to hang in, so the floor is given most of the
/// room and not all of it.
const VG_RIDGE = 0.62;

// ── matrices ────────────────────────────────────────────────────────────────
//
// Column-major, the way WebGL wants them. Four functions is the whole of the
// linear algebra this needs; a matrix library would be a dependency for less
// code than its own import line.

function vgIdentity() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

function vgMul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/// An off-axis frustum, given the rectangle it should see at the near plane.
///
/// Not a symmetric `perspective` with a tilted camera, and the difference is
/// the whole look: the panel **is** the box, so the box's front face has to
/// land exactly on the edges of the canvas. Tilt the camera and it no longer
/// does — the near rectangle rotates out of alignment and you get a box
/// floating in a field of nothing, which is what the first attempt was.
///
/// Keeping the camera square to the room and shifting the frustum instead puts
/// the vanishing point wherever you like — above the middle, so the floor is
/// seen from above — while the near face still fills the frame.
function vgFrustum(l, r, b, t, n, f) {
  const o = new Float32Array(16);
  o[0] = (2 * n) / (r - l);
  o[5] = (2 * n) / (t - b);
  o[8] = (r + l) / (r - l);
  o[9] = (t + b) / (t - b);
  o[10] = -(f + n) / (f - n);
  o[11] = -1;
  o[14] = -(2 * f * n) / (f - n);
  return o;
}

function vgLookAt(eye, at, up) {
  const z = vgNorm([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
  const x = vgNorm(vgCross(up, z));
  const y = vgCross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1,
  ]);
}

const vgCross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
function vgNorm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ── shaders ─────────────────────────────────────────────────────────────────

/// Everything in the room is drawn by this one pair.
///
/// Position, plus a "weight" that means whatever the layer wants it to mean —
/// height for the floor, age for the trace, level for the ladders. It picks the
/// colour and the brightness, and the depth fade is applied on top of both so
/// the far end of the room recedes rather than crowding the near end.
const VG_VS = `
attribute vec3 aPos;
attribute float aW;
// A second quantity per vertex, for colour to be driven by.
//
// aW already means something different in every layer — a level in a
// frequency bin on the floor, an amplitude on the ring, a grain's own loudness
// in the cloud — and it is the weight the *drawing* uses, so it is not free to
// be repurposed. This one carries whatever else that layer knows and would
// otherwise throw away: the band's frequency, the ring's stereo width, a
// grain's pan or length.
//
// Nought when nothing supplies it, set as a constant attribute rather than
// left undefined — an unbound attribute array reads whatever was in the slot
// last, which is the previous layer's data in the shape of this one's.
attribute float aW2;
uniform mat4 uMVP;
uniform float uPointSize;
varying float vW;
varying float vW2;
varying float vDepth;
varying float vDist;
varying float vHeight;
varying float vSeed;
void main() {
  vW = aW;
  vW2 = aW2;
  // A number of its own for each sprite, so a field of them is not the same
  // puff drawn a hundred times. Taken from where it is, which is stable frame
  // to frame — a random here would boil.
  vSeed = fract(dot(aPos, vec3(12.9898, 78.233, 37.719)) * 0.1031);
  vec4 p = uMVP * vec4(aPos, 1.0);
  // **How far this is from the eye, in world units.**
  //
  // The camera sits at the origin looking down −Z, so the distance is simply
  // the length of the position. Fog is a function of that and of nothing else,
  // which is why it is computed here rather than from \`gl_Position.z\` — that
  // has already been through the projection and is curved.
  vDist = length(aPos);
  vHeight = aPos.y;
  // Nought at the front of the room, one at the back.
  //
  // **This used to be \`clamp(-aPos.z, 0.0, 1.0)\`, and the room starts at
  // −1.** So the clamp pinned it at one for every vertex in the scene and the
  // depth cue never varied: the whole room was flat-dimmed by a constant and
  // nothing ever receded. The near plane is one unit away, so the depth has to
  // be measured from there.
  vDepth = clamp(-aPos.z - 1.0, 0.0, 8.0);
  gl_Position = p;
  gl_PointSize = uPointSize / max(0.35, p.w) ;
}`;

const VG_FS = `
precision mediump float;
varying float vW;
varying float vW2;
varying float vDepth;
varying float vDist;
varying float vHeight;
varying float vSeed;
uniform vec3 uCold;
uniform vec3 uHot;
// The palette, as an atlas: one row of 256 samples per paintable thing in the
// room. A texture rather than an array of stop colours because the number of
// stops is then the interface's business and not the shader's, and because one
// texture bound once is cheaper than re-uploading uniforms at every draw call.
uniform sampler2D uRamp;
uniform float uRampV;    // which row, already at its centre
uniform int uRampOn;     // 0 keeps the two-colour path this room shipped with
uniform int uDrive;      // which quantity the ramp is read against
uniform vec2 uRange;     // the part of that quantity the ramp is spent on
uniform float uCurve;    // and how it is spent across it
uniform float uAlpha;
uniform float uRound;   // 1 for point sprites, 0 for lines and triangles
uniform float uSoft;    // 1 for the smoke sprites, 0 for everything else
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogHeight;
uniform int uFogType;   // 0 linear, 1 exp, 2 exp squared, 3 height, 4 off

/// How much of this fragment survives the fog. One is clear, nought is gone.
///
/// The four the reference gives, and they are genuinely different pictures: the
/// exponentials thicken smoothly with distance and never quite reach nothing,
/// linear runs out at a stated place, and the height one lets the floor of the
/// room hold mist while the ring above it stays clear.
float fogSurvives() {
  if (uFogType == 4) return 1.0;
  // **Measured from where the fog starts, not from the eye.**
  //
  // "The fog's intensity is fogMin before or at the start of the fog's near
  // distance" — and the near plane of this room is a whole unit from the eye,
  // so measuring from the eye meant exp(-density * 1.0) at the very front:
  // better than a third of the fog's colour laid over the nearest thing in the
  // picture, and the same again over everything behind it. That is not depth,
  // that is a tint on the whole scene, and it was reported as exactly that.
  float d = max(0.0, vDist - uFogNear);
  if (uFogType == 0) {
    return 1.0 - clamp(d / max(1e-4, uFogFar - uFogNear), 0.0, 1.0);
  }
  if (uFogType == 1) {
    return exp(-uFogDensity * d);
  }
  if (uFogType == 2) {
    float e = uFogDensity * d;
    return exp(-e * e);
  }
  // Height. Thicker low down, which is what ground mist is.
  float h = exp(-(vHeight - uFogHeight) * 2.2);
  return exp(-uFogDensity * d * h);
}

/// Value noise, and two octaves of it.
///
/// **Textureless.** The reference builds its fog by attenuating noise rather
/// than by drawing a picture of a cloud, which is what keeps it from tiling and
/// what lets one sprite be a different shape from the next without a single
/// byte of texture memory. Two octaves is enough at the size these are drawn:
/// one is a smooth blob and three is a cost nobody can see.
float fogHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float fogNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fogHash(i);
  float b = fogHash(i + vec2(1.0, 0.0));
  float c = fogHash(i + vec2(0.0, 1.0));
  float d = fogHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fogFbm(vec2 p) {
  return fogNoise(p) * 0.65 + fogNoise(p * 2.17 + 4.3) * 0.35;
}

void main() {
  float a = uAlpha;
  if (uRound > 0.5) {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (uSoft > 0.5) {
      // **Smoke, not a disc.** A linear falloff gives a sprite with a visible
      // rim, and a hundred of them overlapping reads as a hundred circles. A
      // gaussian core taken to nothing before the edge is what makes them pile
      // up into something continuous.
      //
      // And the noise is what stops them being *circles*. The edge is pushed in
      // and out by it and the body is thinned unevenly, so no two of them are
      // the same shape and none of them is a shape you can name.
      // **The corners have to go, whatever the noise does.**
      //
      // A point sprite is a square and the circular cutoff is the only thing
      // hiding that. Warping the radius by noise pushed the cutoff outward —
      // at 0.72 a corner pixel at 1.41 comes back as 1.01 and survives — so the
      // sprite's actual square edge appeared, and a field of them read as a
      // grid of bright squares knocked into the picture. The mask is taken from
      // the *unwarped* radius and the noise only shapes what is inside it.
      float hard = smoothstep(1.0, 0.72, d);
      float n = fogFbm(uv * 3.4 + vSeed * 31.7);
      float dn = d * mix(0.72, 1.28, n);
      a *= exp(-dn * dn * 3.2) * hard;
      a *= mix(0.45, 1.25, fogFbm(uv * 6.1 + vSeed * 11.3 + 9.0));
    } else {
      a *= smoothstep(1.0, 0.0, d);
    }
  }

  // ── the colour ──
  //
  // Two paths, and the first is the room exactly as it was: a mix between two
  // colours read against the weight. Anything the palette has not been given an
  // opinion about still takes it, so a scheme with nothing set is the picture
  // this room has always drawn, to the byte.
  float wv = clamp(vW, 0.0, 1.0);
  vec3 col;
  if (uRampOn == 1) {
    // **What the ramp is read against is a choice.** The weight means something
    // different in every layer and it is not always the interesting thing about
    // a vertex — a spectrum coloured by frequency says something the same
    // spectrum coloured by loudness does not.
    float d0 = wv;
    if (uDrive == 1) d0 = clamp(vDepth * 0.125, 0.0, 1.0);
    else if (uDrive == 2) d0 = clamp((vDist - 1.0) * 0.25, 0.0, 1.0);
    else if (uDrive == 3) d0 = clamp(vHeight + 0.5, 0.0, 1.0);
    else if (uDrive == 4) d0 = vSeed;
    else if (uDrive == 5) d0 = clamp(vW2, 0.0, 1.0);
    // The window of that quantity the ramp is spent across. Without it a fog
    // whose depth only ever reaches a quarter would only ever show the first
    // quarter of its own gradient, which is how the fog read as flat however
    // its two ends were set.
    float t = clamp((d0 - uRange.x) / max(1e-4, uRange.y - uRange.x), 0.0, 1.0);
    col = texture2D(uRamp, vec2(pow(t, uCurve), uRampV)).rgb;
    // The burn stays on the weight whatever the ramp is read against: it is the
    // top of the gradient bleeding at loud, and loudness is what makes a thing
    // burn regardless of what is choosing its hue.
    col += texture2D(uRamp, vec2(1.0, uRampV)).rgb * pow(wv, 3.0) * 0.55;
  } else {
    col = mix(uCold, uHot, wv);
    // Lifted at the top end so a loud band burns rather than merely brightens.
    col += uHot * pow(wv, 3.0) * 0.55;
  }

  // ── fog, on an additive scene ──
  //
  // **A thing in fog is not recoloured, it is lost in it.** The first version
  // mixed each fragment toward the fog's colour, which on a scene that adds
  // light does not obscure anything — it repaints it. Every line in the room
  // came out the fog's hue at the fog's brightness, near ones included, and
  // what that looks like is a coloured film laid over the picture. It was
  // reported as exactly that, twice.
  //
  // The haze is already on the canvas by the time any of this is drawn, so what
  // a distant fragment has to do is *give way to it*: contribute less of itself
  // the more air is in front of it, and let what is behind show through. On an
  // additive pass that is simply its own alpha, and it is the whole of the
  // effect — a far ridge dissolves into the fog instead of turning its colour.
  float f = clamp(fogSurvives(), 0.0, 1.0);
  a *= mix(0.04, 1.0, f);

  // A little of the hue as well, for the case where the volume is switched off
  // and there is no haze behind for the fragment to give way to.
  col = mix(uFogColor, col, mix(0.45, 1.0, f));

  // And the plain depth cue, so the back of the room settles rather than
  // staying as loud as the front even with no fog at all.
  float far = 1.0 - clamp(vDepth * 0.5, 0.0, 0.55);
  gl_FragColor = vec4(col, a * far * (0.42 + vW * 0.78));
}`;

