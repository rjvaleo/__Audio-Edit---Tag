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
const VG_LAYER_ORDER = ['room', 'sky', 'skin', 'grains', 'lead', 'floor'];

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
uniform mat4 uMVP;
uniform float uPointSize;
varying float vW;
varying float vDepth;
varying float vDist;
varying float vHeight;
varying float vSeed;
void main() {
  vW = aW;
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
varying float vDepth;
varying float vDist;
varying float vHeight;
varying float vSeed;
uniform vec3 uCold;
uniform vec3 uHot;
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

  vec3 col = mix(uCold, uHot, clamp(vW, 0.0, 1.0));
  // Lifted at the top end so a loud band burns rather than merely brightens.
  col += uHot * pow(clamp(vW, 0.0, 1.0), 3.0) * 0.55;

  // **Fog is a mix toward its own colour, not a fade to black.** Distance does
  // not make a thing dimmer, it makes it more like the air in front of it —
  // which is why a foggy day is bright and flat rather than dark. Over an
  // additive scene that means the far end of the room takes the fog's hue and
  // loses its own, which is the depth cue this room never had: the old one
  // clamped its depth to a constant and dimmed everything equally.
  float f = clamp(fogSurvives(), 0.0, 1.0);
  col = mix(uFogColor, col, f);

  // And a little of the old attenuation, so the back of the room settles rather
  // than staying as loud as the front.
  float far = 1.0 - clamp(vDepth * 0.5, 0.0, 0.55);
  gl_FragColor = vec4(col, a * far * (0.42 + vW * 0.78));
}`;

/// Attach the scene to a canvas. `null` when WebGL is unavailable, which is a
/// fallback and not an error — the caller shows the flat meters instead.
function vgAttach(canvas) {
  let gl;
  try {
    gl = canvas.getContext('webgl', { alpha: true, antialias: true })
      || canvas.getContext('experimental-webgl');
  } catch { return null; }
  if (!gl) return null;

  let prog;
  try {
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VG_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, VG_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    prog = {
      p,
      aPos: gl.getAttribLocation(p, 'aPos'),
      aW: gl.getAttribLocation(p, 'aW'),
      uMVP: gl.getUniformLocation(p, 'uMVP'),
      uCold: gl.getUniformLocation(p, 'uCold'),
      uHot: gl.getUniformLocation(p, 'uHot'),
      uAlpha: gl.getUniformLocation(p, 'uAlpha'),
      uRound: gl.getUniformLocation(p, 'uRound'),
      uSoft: gl.getUniformLocation(p, 'uSoft'),
      uPointSize: gl.getUniformLocation(p, 'uPointSize'),
      uFogColor: gl.getUniformLocation(p, 'uFogColor'),
      uFogDensity: gl.getUniformLocation(p, 'uFogDensity'),
      uFogNear: gl.getUniformLocation(p, 'uFogNear'),
      uFogFar: gl.getUniformLocation(p, 'uFogFar'),
      uFogHeight: gl.getUniformLocation(p, 'uFogHeight'),
      uFogType: gl.getUniformLocation(p, 'uFogType'),
    };
  } catch (e) {
    // **Loud, because the failure is otherwise silent.** A shader that will not
    // compile leaves `vgAttach` returning null, and every caller then finds no
    // room at all — which surfaces somewhere else entirely as "cannot read
    // properties of null". The message here is the only thing that says why.
    console.error('visualiser: the room would not compile —', e.message);
    return null;
  }

  const posBuf = gl.createBuffer();
  const wBuf = gl.createBuffer();
  // The landscape gets buffers of its own. It is thirty thousand vertices and
  // it only changes when a frame is pushed — rebuilding it sixty times a second
  // to draw the same thing twenty times would be the whole cost of the scene.
  const meshPosBuf = gl.createBuffer();
  const meshWBuf = gl.createBuffer();
  let meshRows = 0;
  let meshKey = '';
  let pushes = 0;

  /// The waterfall, oldest row first so the newest is drawn last and on top.
  /// A plain array of rows rather than a ring, because it is rebuilt into one
  /// vertex buffer anyway and 56 shifts of a typed array is nothing.
  const history = [];

  // Reused every frame. Sized on first use and never grown again.
  let floorPos = null, floorW = null;
  let leadPos = null, leadW = null;
  let skyPos = null, skyW = null;
  let grainPos = null, grainW = null;
  // The bodies. A wireframe solid a grain, so they cannot share the buffer the
  // wash and the core are drawn from.
  let grainLinePos = null, grainLineW = null;
  // What stands in the way. Its own buffer: it is written in the same pass the
  // lines are built in but has to be *drawn* before any of them.
  let grainMaskPos = null, grainMaskW = null;
  // The skins. Their own buffer, drawn under the wires.
  let grainFillPos = null, grainFillW = null;
  // What drips off them.
  let mistPos = null, mistW = null;
  // The air itself.
  let fogPos = null, fogW = null;
  // The grains in the air. Each is on its own journey once it is in here.
  const grainLive = [];
  let grainClock = 0;
  let grainSeen = null;
  let skyPrev = null, skyPrevW = null, skyBand = null, skyBandW = null;

  /// Whether the next round sprite is smoke. Set around a draw rather than
  /// threaded through it: the signature is long enough, and this is a property
  /// of one pass rather than of every one.
  let drawSoft = false;

  const draw = (mode, pos, wts, count, alpha, round, cold, hot, size) => {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, wBuf);
    gl.bufferData(gl.ARRAY_BUFFER, wts, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(prog.aW);
    gl.vertexAttribPointer(prog.aW, 1, gl.FLOAT, false, 0, 0);
    gl.uniform1f(prog.uAlpha, alpha);
    gl.uniform1f(prog.uRound, round ? 1 : 0);
    gl.uniform1f(prog.uSoft, drawSoft ? 1 : 0);
    gl.uniform1f(prog.uPointSize, size || 1);
    gl.uniform3fv(prog.uCold, cold);
    gl.uniform3fv(prog.uHot, hot);
    gl.drawArrays(mode, 0, count);
  };

  /// Geometry that takes light *out* of what is already there.
  ///
  /// Everything else in this room adds, and black adds nothing — so a black
  /// outline cannot be drawn the way every other mark here is drawn. This
  /// multiplies the destination by one minus the alpha instead, which darkens
  /// what is behind it towards black without painting an opaque hole: the room
  /// is drawn on glass with the page's own ground behind it, and a border that
  /// punched through to nothing would be a border around a hole.
  const drawDark = (mode, pos, wts, count, alpha) => {
    if (!count) return;
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    draw(mode, pos, wts, count, alpha, false, [0, 0, 0], [0, 0, 0], 1);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  };

  /// Geometry that is drawn only into the depth buffer.
  ///
  /// Nothing in this room is lit, so a filled face is never *seen* as a face —
  /// there is no shading to make one read as a surface, and painted at any
  /// brightness it is a flat patch. What a face is good for here is standing in
  /// the way: with the colour write switched off it puts nothing on screen and
  /// everything drawn behind it afterwards is rejected. That is the whole of
  /// occlusion in this scene.
  const drawDepth = (mode, pos, wts, count) => {
    if (!count) return;
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, wBuf);
    gl.bufferData(gl.ARRAY_BUFFER, wts, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(prog.aW);
    gl.vertexAttribPointer(prog.aW, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(mode, 0, count);
    gl.colorMask(true, true, true, true);
  };

  return {
    /// Empty the room.
    ///
    /// Everything in here accumulates on purpose. The trail is fifty-six frames
    /// of spectrum on their way to the back wall, and a grain lives fourteen
    /// seconds and goes on flying after its schedule is taken away — which is
    /// the whole idea of the place, and also means that after a loud passage
    /// there is no way to *see* the next quiet one for a quarter of a minute.
    /// This is the way to start again from nothing.
    ///
    /// Not a reset: the camera, the layers and every setting are the caller's
    /// and are not touched. This empties what has been poured in.
    clear() {
      history.length = 0;
      grainLive.length = 0;
      // The next schedule starts from wherever the playhead is rather than
      // pouring in everything between here and there — the same rule a seek
      // follows, and for the same reason. Those grains were never heard.
      grainSeen = null;
      grainClock = 0;
      // The floor's mesh is cached against the frame count and the row count,
      // and both are about to be wrong.
      meshKey = '';
      meshRows = 0;
      pushes = 0;
    },

    /// The solids the grains in the air were last actually drawn as.
    ///
    /// A seam for `tests/ui/grain-shapes.spec.mjs`, and the only way to see the
    /// fault it guards against: a grain that changes shape mid-flight looks
    /// entirely normal in a still, and the pixel count cannot tell a solid
    /// swapped for another from the same solid a foot further away. Names can.
    ///
    /// **What was drawn, not what was chosen.** The first version of this read
    /// the model stored on the grain, which is the very thing the fault did not
    /// touch — the shape was picked correctly at birth and then ignored at the
    /// draw. Reintroducing the fault on purpose left the test green, which is
    /// how that was found. `p.drawn` is written by the draw loop itself, so
    /// there is nowhere for the two to disagree unseen.
    grainShapeNames: () => grainLive.map((p) => p.drawn && p.drawn.name),

    /// Push one frame onto the trail — a spectrum for the floor and a Lissajous
    /// for the sky. Called at the poll's rate, not the display's: the room only
    /// moves when there is something new to move it.
    push(bands, pairs) {
      if (!bands || !bands.length) return;
      let liss = null;
      if (pairs && pairs.length >= 4) {
        const n = pairs.length / 2;
        liss = new Float32Array(VG_LISS_POINTS * 2);
        for (let i = 0; i < VG_LISS_POINTS; i++) {
          const k = Math.floor(i / VG_LISS_POINTS * n);
          liss[i * 2] = pairs[k * 2];
          liss[i * 2 + 1] = pairs[k * 2 + 1];
        }
      }
      const row = new Float32Array(VG_FLOOR_BANDS);
      for (let i = 0; i < VG_FLOOR_BANDS; i++) {
        // Resampled by taking the loudest source band in range. An analyser
        // that averages a tone away is not an analyser, and that is as true of
        // the floor as of the flat one.
        const a = Math.floor(i / VG_FLOOR_BANDS * bands.length);
        const b = Math.max(a + 1, Math.floor((i + 1) / VG_FLOOR_BANDS * bands.length));
        let m = -Infinity;
        for (let k = a; k < b && k < bands.length; k++) if (bands[k] > m) m = bands[k];
        row[i] = Math.max(0, Math.min(1, (m + 96) / 96));
      }
      history.push({ row, liss });
      while (history.length > VG_HISTORY) history.shift();
      pushes++;
    },

    frame(f) {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      // The caller owns the camera, because which camera is right depends on
      // the frame being drawn for and this file has no opinion about that.
      const cam = vgCamera(f && f.cam);
      // And owns which parts are drawn. Everything, unless told otherwise —
      // a caller that says nothing gets the room it has always had.
      const on = { room: true, floor: true, lead: true, sky: true, skin: true, grains: true, ...(f && f.layers) };
      // Which layers stand in the way of the ones after them, and what order
      // "after" means. Occlusion is off for everything unless asked for, so a
      // caller that says nothing — the grain views, a test — gets the flat
      // additive scene this has always drawn.
      const occ = { ...(f && f.occlude) };
      const order = [];
      for (const k of (f && Array.isArray(f.order) ? f.order : VG_LAYER_ORDER)) {
        if (VG_LAYER_ORDER.includes(k) && !order.includes(k)) order.push(k);
      }
      for (const k of VG_LAYER_ORDER) if (!order.includes(k)) order.push(k);
      const occluding = order.some((k) => on[k] && occ[k]);
      gl.viewport(0, 0, w, h);

      // ── the fog ──
      //
      // Off unless asked for, so every caller that says nothing about it — the
      // grain views, a test, an export that predates this — draws the room it
      // has always drawn.
      const fog = (f && f.fog) || null;
      gl.useProgram(prog.p);
      gl.uniform1i(prog.uFogType, fog && fog.on ? (fog.type | 0) : 4);
      gl.uniform3fv(prog.uFogColor, (fog && fog.rgb) || [0.5, 0.6, 0.7]);
      gl.uniform1f(prog.uFogDensity, fog && typeof fog.density === 'number'
        ? fog.density : 0.15);
      gl.uniform1f(prog.uFogNear, fog && typeof fog.near === 'number' ? fog.near : 1.0);
      gl.uniform1f(prog.uFogFar, fog && typeof fog.far === 'number' ? fog.far : 4.0);
      gl.uniform1f(prog.uFogHeight, fog && typeof fog.height === 'number'
        ? fog.height : 0.0);
      // The depth buffer is only turned on when something is going to use it.
      // With it off this is the scene it always was: everything additive, in
      // the order the list happens to be in, nothing hidden by anything.
      gl.depthMask(true);
      if (occluding) {
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
      } else {
        gl.disable(gl.DEPTH_TEST);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // The room. The eye sits at the origin looking down −Z; the front face is
      // one unit away and is exactly what the canvas shows, so the box's near
      // edges *are* the edges of the panel.
      const aspect = w / h;
      const near = 1.0;
      const yb = cam.floorY, yt = cam.ceilY;
      const halfW = (yt - yb) * 0.5 * aspect;
      const far = near * (1 + cam.depth);
      // Sideways off-axis, the same way the vertical one works: the camera does
      // not turn, the frustum slides, so the front face stays square to the
      // frame however far the vanishing point moves.
      const sx = cam.shiftX * halfW;
      const mvp = vgFrustum(-halfW + sx, halfW + sx, yb, yt, near, far + 1);
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.uMVP, false, mvp);

      // Depth runs 0 at the front to 1 at the back, which is what the shaders
      // fade against.
      const zAt = (t) => -(near + t * (far - near));

      // ── the room ──
      //
      // Only the four runs back and the far rectangle. The near rectangle is
      // the canvas border and drawing it would be a line painted on the bezel.
      const drawRoom = () => {
        const fr = [[-halfW, yb], [halfW, yb], [halfW, yt], [-halfW, yt]];
        const pos = new Float32Array(8 * 3 * 2);
        const wts = new Float32Array(8 * 2);
        let v = 0;
        const put = (x, y, z, weight) => {
          pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
          wts[v] = weight; v++;
        };
        // Full size, at the back. The projection is what shrinks it.
        //
        // These corners used to be pre-multiplied by `near / far` as well,
        // which applied the perspective twice: the wall drew at the square of
        // the convergence, so it sat far beyond where the floor actually ends
        // and the terrain appeared to stop short of the room in a hard edge. It
        // was not stopping short — the wall was in the wrong place.
        for (let i = 0; i < 4; i++) {
          const [x0, y0] = fr[i];
          const [x1, y1] = fr[(i + 1) % 4];
          put(x0, y0, zAt(1), 0.16);
          put(x1, y1, zAt(1), 0.16);
          // and the corner run from the canvas edge back to it
          put(x0, y0, zAt(0), 0.02);
          put(x0, y0, zAt(1), 0.16);
        }
        draw(gl.LINES, pos, wts, v, 0.85, false, f.cold, f.cold, 1);
      };

      // ── the landscape ──
      //
      // The floor is a surface, not a set of wires: every pair of neighbouring
      // frames is joined into a strip, so what you are looking at is terrain
      // with the newest ridge at the near edge and everything before it running
      // away to the back wall.
      const rows = history.length;
      const ridgeY = (v) => yb + v * (yt - yb) * 0.62;
      const xAt = (i) => ((i / (VG_FLOOR_BANDS - 1)) * 2 - 1) * halfW;
      // Against the room's full depth, not against however many frames happen to
      // be in hand. Dividing by `rows` made a half-filled trail span the whole
      // room and then crawl backwards as it filled — the trail should *grow*
      // into the room from the near edge and reach the back wall when it is
      // full, which is what a fixed step per frame gives.
      const ageOf = (r) => (rows - 1 - r) / Math.max(1, VG_HISTORY - 1);

      const drawFloor = () => {
        if (rows <= 1) return;
        const key = `${pushes}|${rows}|${halfW.toFixed(4)}`;
        if (key !== meshKey) {
          meshKey = key;
          meshRows = rows - 1;
          const per = VG_FLOOR_BANDS * 2;
          const pos = new Float32Array(meshRows * per * 3);
          const wts = new Float32Array(meshRows * per);
          let v = 0;
          for (let r = 0; r < meshRows; r++) {
            const a = history[r].row, b = history[r + 1].row;
            const za = zAt(ageOf(r)), zbb = zAt(ageOf(r + 1));
            for (let i = 0; i < VG_FLOOR_BANDS; i++) {
              const x = xAt(i);
              pos[v * 3] = x; pos[v * 3 + 1] = ridgeY(a[i]); pos[v * 3 + 2] = za;
              wts[v] = a[i]; v++;
              pos[v * 3] = x; pos[v * 3 + 1] = ridgeY(b[i]); pos[v * 3 + 2] = zbb;
              wts[v] = b[i]; v++;
            }
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, meshPosBuf);
          gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, meshWBuf);
          gl.bufferData(gl.ARRAY_BUFFER, wts, gl.DYNAMIC_DRAW);
        }
        // One upload, many draws: a strip per pair, so the near ones are laid
        // over the far ones without a depth buffer.
        gl.bindBuffer(gl.ARRAY_BUFFER, meshPosBuf);
        gl.enableVertexAttribArray(prog.aPos);
        gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, meshWBuf);
        gl.enableVertexAttribArray(prog.aW);
        gl.vertexAttribPointer(prog.aW, 1, gl.FLOAT, false, 0, 0);
        gl.uniform1f(prog.uRound, 0);
        gl.uniform1f(prog.uPointSize, 1);
        gl.uniform3fv(prog.uCold, f.cold);
        gl.uniform3fv(prog.uHot, f.hot);
        const per = VG_FLOOR_BANDS * 2;
        for (let r = 0; r < meshRows; r++) {
          gl.uniform1f(prog.uAlpha, 0.20 + (1 - ageOf(r)) * 0.26);
          gl.drawArrays(gl.TRIANGLE_STRIP, r * per, per);
        }
      };

      // The wire over it, so the ridges keep their edge. It is the frame you are
      // hearing *now*, so it is its own layer: the terrain can be turned off and
      // this still says where the sound is.
      const drawLead = () => {
        if (!rows) return;
        if (!floorPos || floorPos.length !== VG_FLOOR_BANDS * 3) {
          floorPos = new Float32Array(VG_FLOOR_BANDS * 3);
          floorW = new Float32Array(VG_FLOOR_BANDS);
        }
        for (let r = 0; r < rows; r++) {
          const row = history[r].row;
          const age = ageOf(r);
          const z = zAt(age);
          for (let i = 0; i < VG_FLOOR_BANDS; i++) {
            floorPos[i * 3] = xAt(i);
            floorPos[i * 3 + 1] = ridgeY(row[i]);
            floorPos[i * 3 + 2] = z;
            floorW[i] = row[i];
          }
          draw(gl.LINE_STRIP, floorPos, floorW, VG_FLOOR_BANDS,
            0.34 + (1 - age) * 0.5, false, f.cold, f.hot, 1);
        }

        // ── the leading edge ──
        //
        // The frame you are hearing *now*, drawn with weight. As a ribbon, not
        // a fat line: `gl.lineWidth` is clamped to 1 by almost every driver and
        // is therefore not a way to make anything thicker.
        //
        // **Optional, and the line under it is not.** The loop above has already
        // drawn this frame as a ridge like every other one, at the strongest
        // alpha of any of them — the ribbon is laid over the top of that to give
        // it body. So turning it off takes the band away and leaves the line
        // exactly where it was, rather than leaving a gap at the front of the
        // room where the newest frame should be.
        if (f && f.leadThick === false) return;
        const now = history[rows - 1].row;
        const z = zAt(0);
        const n2 = VG_FLOOR_BANDS * 2;
        if (!leadPos || leadPos.length !== n2 * 3) {
          leadPos = new Float32Array(n2 * 3);
          leadW = new Float32Array(n2);
        }
        for (let i = 0; i < VG_FLOOR_BANDS; i++) {
          const x = xAt(i), y = ridgeY(now[i]);
          leadPos[i * 6] = x; leadPos[i * 6 + 1] = y - cam.lead; leadPos[i * 6 + 2] = z;
          leadPos[i * 6 + 3] = x; leadPos[i * 6 + 4] = y + cam.lead; leadPos[i * 6 + 5] = z;
          leadW[i * 2] = now[i]; leadW[i * 2 + 1] = now[i];
        }
        draw(gl.TRIANGLE_STRIP, leadPos, leadW, n2, 1.0, false, f.cold, f.hot, 1);
      };

      // ── the grains ──
      //
      // Every grain the schedule holds, drawn as the streak it actually is.
      //
      // The room already means something along every axis, so the grains take
      // those meanings rather than inventing new ones: **depth is time**, which
      // is the whole idea of this box, so a grain is born at the near face and
      // travels away from you exactly as the floor does. Across is where it
      // sits in the stereo field and up is what it was pitched by.
      //
      // A streak's *length* is the grain's own duration, because a grain is not
      // a dot — it sounds for as long as it sounds, and in a room where depth
      // is time that length is visible rather than inferred. Two clouds with
      // the same number of grains and different windows look different here,
      // which is the thing that was hard to see anywhere else.
      //
      // Read from `f.grains`, which is the schedule the renderer is working
      // through — not a model of it. Whatever rule decides how often a grain is
      // laid down, this draws what was actually laid down.
      // ── the grains ──
      //
      // **They spawn, and then they are on their own.**
      //
      // Every other traveller in this room works that way already: a spectrum
      // frame is pushed once and then walks to the back wall on its own, and it
      // keeps walking after the sound has stopped. The grains did not — they
      // were worked out fresh every frame from where the playhead is, which
      // welds them to it: stop the transport and they freeze, seek and they
      // jump, and none of that is what a thing travelling through a room does.
      //
      // So a grain is spawned when it sounds, given a place in the room, and
      // from then on it ages against the wall clock like everything else here.
      // Its journey is its own. The schedule decides when one is born and
      // nothing after that.
      const drawGrains = (masking) => {
        // Filling the shapes in, and with what.
        //
        // **The wires are drawn after the fill, so a filled grain still shows
        // its own far side.** That is the whole character of these — a solid
        // that hides its own back edges is a lump, and the tumbling is only
        // legible because you can see through it. The fill gives it a body; it
        // does not close it.
        // ── the mist ──
        //
        // A grain travelling away from you leaves what it shed behind it, which
        // in a room where depth is time means *nearer the front* — where it was
        // a moment ago. And what it shed falls, because that is what makes it
        // read as something dripping off rather than a motion blur.
        const mist = (f && f.mist) || null;
        const misting = !!(mist && mist.on);
        // How many points a grain sheds, and how far back the last of them sits
        // as a fraction of the whole journey.
        const mistDensity = misting
          ? Math.max(0.06, Math.min(1, typeof mist.amount === 'number' ? mist.amount : 0.5))
          : 0;
        const mistCount = misting
          ? Math.max(2, Math.round(VG_MIST_PER_GRAIN * mistDensity))
          : 0;
        // Guarded like the count above it. A caller that says nothing about
        // mist — the grain views, a test, the first frame of an export — hands
        // over no object at all, and reading a field off it is how a layer that
        // is switched *off* takes the whole room down with it.
        const mistLen = Math.max(0.004, Math.min(0.6,
          mist && typeof mist.length === 'number' ? mist.length : 0.06));

        const fill = (f && f.grainFill) || null;
        const filling = !!(fill && fill.on);
        // The room is drawn on glass with the page's own ground behind it, so
        // "the background colour" is not a colour to paint — it is the light
        // already there, taken away. That is a different pass from painting a
        // colour on, which is why the two are not one setting with a swatch.
        const fillBg = filling && fill.bg !== false;
        const fillRgb = (fill && fill.rgb) || [0, 0, 0];
        // How much of the cloud is drawn, and how hot. Both are about the
        // picture: the schedule arrives whole and is not touched here.
        const density = Math.max(0.02, Math.min(1,
          f && typeof f.grainDensity === 'number' ? f.grainDensity : 1));
        const bright = Math.max(0.05, Math.min(3,
          f && typeof f.grainBright === 'number' ? f.grainBright : 1));
        const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const dt = grainClock ? Math.min(0.25, (nowMs - grainClock) / 1000) : 0;
        grainClock = nowMs;

        // Age everyone, and bury whoever has reached the wall.
        if (dt > 0) {
          const step = dt / VG_GRAIN_SPAN_S;
          let keep = 0;
          for (let i = 0; i < grainLive.length; i++) {
            const p = grainLive[i];
            // At its own pace, which is what pulls a frame's worth of them
            // apart rather than sliding them back as one sheet.
            p.age += step * p.vel;
            if (p.age <= 1) grainLive[keep++] = p;
          }
          grainLive.length = keep;
        }

        // Birth: every grain the playhead has crossed since the last frame.
        if (f.grains && f.grains.length) {
          const sr = f.grainRate || 44100;
          const now = (f.position || 0) / (f.positionRate || sr);
          // A seek, a restart, or the first frame. Do not pour the whole file
          // into the room to catch up — the grains between then and now were
          // never heard, so they were never born.
          if (grainSeen === null || now < grainSeen || now - grainSeen > 1.0) {
            grainSeen = now;
          }
          if (now > grainSeen) {
            const pitchSpan = 12;                     // semitones to the ceiling
            for (let i = 0; i < f.grains.length; i++) {
              const e = f.grains[i];
              const t0 = e[0] / sr;
              if (t0 <= grainSeen || t0 > now) continue;
              if (grainLive.length >= VG_GRAIN_CAP) break;

              // Scattered across the room, stable per grain: the hash is of the
              // grain's own index, which is the same key every jitter the
              // engine gives it is already a pure function of. So a grain keeps
              // its place for its whole journey.
              const h = (e[7] | 0) * 2654435761 >>> 0;
              const hx = ((h & 0xffff) / 0x8000) - 1;
              const hy = (((h >>> 16) & 0xffff) / 0x8000) - 1;
              // A second and third draw from the same key. Separate hashes
              // rather than more slices of the first, because reusing bits
              // would tie a grain's pace to where it sits and lay the fast
              // ones down one side of the room.
              const h2 = (((e[7] | 0) ^ 0x9e3779b9) * 2246822519) >>> 0;
              // Whether this grain is drawn at all.
              //
              // **Its own coin, flipped once.** Thinning by taking every n-th
              // grain would sample the schedule at a fixed interval, and a
              // schedule is periodic — a regular rate against a regular rate
              // beats, so the cloud would come out banded rather than thinner.
              // A hash of the grain's own index has no period to beat against.
              //
              // And because it is the grain's own number rather than a running
              // count, turning the slider down removes grains from the cloud
              // without rearranging the ones that stay: the picture thins in
              // place instead of being redealt.
              const h5 = (((e[7] | 0) * 0x27d4eb2d) >>> 0) / 0x100000000;
              if (h5 >= density) continue;
              const h3 = (((e[7] | 0) * 2654435761) ^ 0x85ebca6b) >>> 0;
              const h4 = (((e[7] | 0) + 0x7ed55d16) * 3266489917) >>> 0;
              const hv = (h2 & 0x3ff) / 0x3ff;
              const hdx = (((h2 >>> 10) & 0x7ff) / 0x400) - 1;
              const hdy = (((h2 >>> 21) & 0x3ff) / 0x200) - 1;
              const hb = (h3 & 0xffff) / 0x10000;
              const pitchFrac = Math.max(-1, Math.min(1, (e[3] || 0) / pitchSpan));
              // Its own pace, held for the whole journey.
              const vel = 1 + (hv * 2 - 1) * VG_GRAIN_SPREAD;
              const level = Math.min(1, Math.sqrt(Math.max(0, e[4] || 0)) * 2.2);
              grainLive.push({
                // Not quite on the frame it was born in — see
                // `VG_GRAIN_BORN_JITTER`. Never behind the near face, which
                // would be a grain drawn before it sounded.
                age: hb * VG_GRAIN_BORN_JITTER,
                vel,
                // Held as fractions of the room rather than as world units, so
                // a grain already travelling keeps its place when the camera
                // moves under it.
                fx: hx * 0.86 + (e[6] || 0) * 0.14,
                fy: Math.max(-0.48, Math.min(0.48, hy * 0.34 + pitchFrac * 0.22)),
                // Where it is heading, per unit of the journey.
                dx: hdx * VG_GRAIN_DRIFT,
                dy: hdy * VG_GRAIN_DRIFT * 0.7,
                // How much of the room's depth this grain's own length covers.
                // Its pace is in here too: a grain travelling faster crosses
                // more of the room in the time it sounds for, so it draws the
                // longer streak, which is the same arithmetic as the floor's.
                life: Math.max(0.004, (e[2] / sr) / VG_GRAIN_SPAN_S) * vel,
                w: level,
                // Which solid it is, where it started turning and how fast.
                // Drawn from the grain's own index like everything else here,
                // so the same grain is the same shape in the same attitude
                // every time the schedule is looked at.
                //
                // **Resolved here and kept, not looked up while it flies.** How
                // intricate a solid a grain gets is decided by how loud it is,
                // which it knows at birth and never revises. Deciding it from
                // how near or how bright it is *now* meant deciding it afresh
                // every frame from numbers that fall as it travels, and the
                // tier is the modulus rather than a ceiling — so a grain did not
                // lose detail on its way to the wall, it turned into a different
                // solid three times. See `grainShapeFor`.
                shape: grainShapeFor(h3 >>> 16, grainDetailFor(level)),
                phase: ((h4 & 0xffff) / 0x10000) * Math.PI * 2,
                spin: (0.35 + ((h4 >>> 16) & 0xffff) / 0x10000)
                  * VG_GRAIN_SPIN * Math.PI * 2 * (h4 & 1 ? 1 : -1),
              });
            }
            grainSeen = now;
          }
        }

        if (grainLive.length) {
          if (!grainPos || grainPos.length !== VG_GRAIN_CAP * 3) {
            grainPos = new Float32Array(VG_GRAIN_CAP * 3);
            grainW = new Float32Array(VG_GRAIN_CAP);
            grainLinePos = new Float32Array(VG_GRAIN_LINE_CAP * 3);
            grainLineW = new Float32Array(VG_GRAIN_LINE_CAP);
            grainMaskPos = new Float32Array(VG_GRAIN_MASK_CAP * 3);
            grainMaskW = new Float32Array(VG_GRAIN_MASK_CAP);
            grainFillPos = new Float32Array(VG_GRAIN_FILL_CAP * 3);
            grainFillW = new Float32Array(VG_GRAIN_FILL_CAP);
            mistPos = new Float32Array(VG_MIST_CAP * 3);
            mistW = new Float32Array(VG_MIST_CAP);
          }
          // A grain is a solid standing in the room, so its size is measured
          // against the room's height and not against the frustum's width — a
          // grain that swelled every time the panel was widened would be
          // describing the panel and not the sound.
          const rad = (yt - yb) * VG_GRAIN_BODY;
          let n = 0, ln = 0, mn = 0, fn = 0, sn = 0;
          for (let i = 0; i < grainLive.length && n < VG_GRAIN_CAP; i++) {
            const p = grainLive[i];
            const a0 = Math.max(0, p.age);
            if (a0 >= 1) continue;
            // Where it has wandered to by now.
            //
            // Held inside the room. A cloud that opens out has to stop at the
            // walls or the marks that reach them carry on past the picture, and
            // a grain outside the box it is travelling through says nothing
            // about the sound.
            const fx = Math.max(-0.98, Math.min(0.98, p.fx + p.dx * a0));
            const fy = Math.max(-0.49, Math.min(0.49, p.fy + p.dy * a0));
            const x = fx * halfW;
            const y = yb + (yt - yb) * (0.5 + fy);
            const z = zAt(a0);
            // Hot when it lands, cooling as it goes.
            const lit = Math.min(1, p.w * (1 + VG_GRAIN_FLASH
              * Math.exp(-a0 * VG_GRAIN_FLASH_FALL)));

            grainPos[n * 3] = x; grainPos[n * 3 + 1] = y; grainPos[n * 3 + 2] = z;
            grainW[n] = lit;
            n++;

            if (ln >= VG_GRAIN_LINE_CAP - 256) continue;

            // ── the solid ──
            //
            // Chosen when it was born and carried since. Nothing here may
            // reconsider it: a grain that is dimmer and further away than it was
            // a second ago is the same grain, and a room where that means a
            // different solid is a room where nothing keeps its identity.
            const shape = p.shape;
            p.drawn = shape;

            // Turning, at its own rate and from its own start. A wireframe that
            // never turns is a flat drawing of a solid rather than a solid, and
            // the turning is the whole of the depth cue at this size.
            const t = p.phase + a0 * p.spin;
            const cy = Math.cos(t), sy = Math.sin(t);
            const cp = Math.cos(t * 0.77 + p.phase), sp = Math.sin(t * 0.77 + p.phase);
            const cr = Math.cos(t * 0.53), sr = Math.sin(t * 0.53);
            // Z about the vertical, then X, then the roll. Written out rather
            // than multiplied at runtime: this is nine numbers per grain and
            // there may be thousands of them in a frame.
            const m00 = cr * cy - sr * sp * sy, m01 = -sr * cp, m02 = cr * sy + sr * sp * cy;
            const m10 = sr * cy + cr * sp * sy, m11 = cr * cp, m12 = sr * sy - cr * sp * cy;
            const m20 = -cp * sy, m21 = sp, m22 = cp * cy;

            const size = rad * (0.4 + lit * 0.8);

            // ── what it stands in the way of ──
            //
            // **Behind itself.** A disc at the grain's own depth would cut it in
            // half: its front wires would pass and its back ones would be
            // rejected by its own mask, and a wireframe that hides its own far
            // side is a solid — which is not what these are. Put the disc at the
            // *back* of the grain instead and every wire it owns is in front of
            // it, so the shape stays open while everything behind it is gone.
            //
            // Flat, and facing the eye. The camera does not turn, so a disc in
            // the x/y plane is square to it at every depth, and the silhouette
            // of a unit solid seen from anywhere is a circle of its radius.
            if (masking && mn < VG_GRAIN_MASK_CAP - VG_GRAIN_MASK_SIDES * 3) {
              const zb = z - size;
              for (let k = 0; k < VG_GRAIN_MASK_SIDES; k++) {
                const a = (k / VG_GRAIN_MASK_SIDES) * Math.PI * 2;
                const b = ((k + 1) / VG_GRAIN_MASK_SIDES) * Math.PI * 2;
                const put = (px, py) => {
                  grainMaskPos[mn * 3] = px;
                  grainMaskPos[mn * 3 + 1] = py;
                  grainMaskPos[mn * 3 + 2] = zb;
                  grainMaskW[mn] = 0;
                  mn++;
                };
                put(x, y);
                put(x + Math.cos(a) * size, y + Math.sin(a) * size);
                put(x + Math.cos(b) * size, y + Math.sin(b) * size);
              }
            }

            // ── the skin ──
            const tri = shape.tri;
            if (filling && tri.length
              && fn < VG_GRAIN_FILL_CAP - tri.length) {
              for (let e = 0; e < tri.length; e++) {
                const v = tri[e] * 3;
                const vx = shape.pos[v] * size;
                const vy = shape.pos[v + 1] * size;
                const vz = shape.pos[v + 2] * size;
                grainFillPos[fn * 3] = x + m00 * vx + m01 * vy + m02 * vz;
                grainFillPos[fn * 3 + 1] = y + m10 * vx + m11 * vy + m12 * vz;
                grainFillPos[fn * 3 + 2] = z + m20 * vx + m21 * vy + m22 * vz;
                grainFillW[fn] = lit;
                fn++;
              }
            }

            // ── what drips off it ──
            if (misting && sn < VG_MIST_CAP - mistCount) {
              // Its own wander, so two grains side by side do not shed the same
              // shape. Drawn from bits of the hash nothing else is using.
              const mh = ((p.shape.lines * 2654435761) ^ (i * 40503)) >>> 0;
              for (let k = 1; k <= mistCount; k++) {
                const lag = (k / mistCount) * mistLen;
                const back = a0 - lag;
                // Before it was born there is nothing to have shed.
                if (back <= 0) break;
                // Where the grain was then, and how far what it left has
                // fallen since. The fall accelerates, which is the whole of
                // what makes it read as a drip rather than a tail.
                const t2 = k / mistCount;
                const fxk = p.fx + p.dx * back;
                const fyk = p.fy + p.dy * back - mistLen * t2 * t2 * 2.4;
                // A little sideways wander so the trail is smoke and not wire.
                const wob = Math.sin(t2 * 9.0 + (mh & 0xff) * 0.0246) * mistLen * 0.35;
                mistPos[sn * 3] = Math.max(-1.02, Math.min(1.02, fxk + wob)) * halfW;
                mistPos[sn * 3 + 1] = yb + (yt - yb) * (0.5 + Math.max(-0.55,
                  Math.min(0.55, fyk)));
                mistPos[sn * 3 + 2] = zAt(back);
                // Thinning as it falls, so it fades out rather than stopping —
                // but not to nothing at the top. A trail that starts at half
                // weight and ends at zero is faint along its whole length, and
                // faint over a black room is not there at all.
                mistW[sn] = lit * (1 - t2 * 0.75);
                sn++;
              }
            }

            const pos = shape.pos, idx = shape.idx;
            for (let e = 0; e < idx.length; e++) {
              const v = idx[e] * 3;
              const vx = pos[v] * size, vy = pos[v + 1] * size, vz = pos[v + 2] * size;
              grainLinePos[ln * 3] = x + m00 * vx + m01 * vy + m02 * vz;
              grainLinePos[ln * 3 + 1] = y + m10 * vx + m11 * vy + m12 * vz;
              grainLinePos[ln * 3 + 2] = z + m20 * vx + m21 * vy + m22 * vz;
              grainLineW[ln] = lit;
              ln++;
            }
          }
          if (n) {
            // Every mask, before any wire. The depth buffer decides what is in
            // front of what, but only among things it has been told about — so
            // a grain drawn early cannot be hidden by a nearer one that has not
            // been written yet. Writing the whole cloud's masks first is what
            // makes the order they happen to be in stop mattering.
            if (mn) {
              drawDepth(gl.TRIANGLES, grainMaskPos, grainMaskW, mn);
              // The wires themselves add no depth. If they did, a grain would
              // be masked by its neighbours' *lines* — a hairline here and
              // there rather than a shape — and the cloud would come out
              // stippled instead of layered.
              gl.depthMask(false);
            }
            // The wash, the solids, then the cores — which is how the
            // waveform's own grain layer reads: a soft glow that gathers where
            // grains are dense, a definite mark for each one, and a hotter
            // point at its heart.
            // Brightness rides on the alpha rather than on the weight, because
            // the weight is what picks the colour — a grain turned up would
            // otherwise change hue on its way to being brighter, and the hue is
            // saying something about the sound.
            const a = (v) => Math.min(1, v * bright);
            // Under everything the grain itself draws, and soft: a big round
            // sprite at a low alpha, which over an additive scene is what smoke
            // looks like. Drawn before the solids so a grain always sits on top
            // of its own mist rather than inside it.
            if (sn) {
              // Smoke, not discs. See `uSoft`.
              drawSoft = true;
              // **Strong enough to see.** The first version was drawn at an
              // alpha of 0.055, which after the shader's own depth fade and
              // weight curve lands near 0.03 — measurably present, and on a
              // black room invisible. It was reported as not working at all,
              // and from outside that is exactly what it looked like.
              //
              // The amount control drives the density as well as the count,
              // because "how much mist" plainly means both.
              const thick = 0.16 + mistDensity * 0.5;
              draw(gl.POINTS, mistPos, mistW, sn, a(thick), true,
                f.cold, f.core, 12);
              draw(gl.POINTS, mistPos, mistW, sn, a(thick * 0.55), true,
                f.cold, f.core, 30);
              // A third, very large and very faint, which is what turns a run
              // of sprites into a body of smoke rather than a string of puffs.
              draw(gl.POINTS, mistPos, mistW, sn, a(thick * 0.22), true,
                f.cold, f.core, 64);
              drawSoft = false;
            }
            // The skins first, so every wire lands on top of them — including
            // the far ones, which is what keeps a filled grain readable as a
            // solid you can see into rather than a lump.
            if (fn) {
              if (fillBg) drawDark(gl.TRIANGLES, grainFillPos, grainFillW, fn, 0.88);
              else draw(gl.TRIANGLES, grainFillPos, grainFillW, fn, a(0.5), false,
                fillRgb, fillRgb, 1);
            }
            draw(gl.POINTS, grainPos, grainW, n, a(0.07), true, f.cold, f.core, 11);
            if (ln) draw(gl.LINES, grainLinePos, grainLineW, ln, a(0.5), false, f.cold, f.core, 1);
            draw(gl.POINTS, grainPos, grainW, n, a(0.3), true, f.core, f.hot, 2);
          }
        }
      };

      // ── the sky ──
      //
      // A ring pushed out of round by the sound. Angle is position around the
      // circle and radius is what the signal is doing there, so a quiet passage
      // is a clean circle and a loud one is a ragged crown — and because the
      // two channels displace it differently, a wide image wobbles where a mono
      // one only breathes.
      //
      // It trails the way the floor does: one ring per frame of history, the
      // newest at the near edge and the rest on their way to the back wall.
      //
      // Drawn round on screen at every depth because the frustum's width is
      // derived from its height times the aspect, so one world unit is the same
      // number of pixels across as it is up.
      // The skin stands on its own, the way the terrain does against the edge.
      // Both are built from the same rings, so the geometry is shared — but
      // which of them is *drawn* is two decisions, and a surface with no hoops
      // on it is a perfectly good thing to want.
      const drawRings = (wantSkin, wantSky) => {
        // How many points the ring is drawn with. Clamped to what is stored:
        // past that there is nothing left to resolve and the extra points are
        // the same sample twice.
        const pts = Math.max(VG_RING_POINTS_MIN, Math.min(VG_RING_POINTS_MAX,
          Math.round(f && f.ringPoints ? f.ringPoints : VG_RING_POINTS)));
        // How hard the sound pushes the ring out of round.
        //
        // The range runs well past one on purpose. At the original fixed
        // amounts a quiet passage is a circle with a tremble in it, and the
        // whole point of the shape is what the sound does to it — so this goes
        // far enough to turn a breath into a crown, and far enough down to hold
        // the ring still while something else is being looked at.
        const drive = Math.max(0, Math.min(8,
          f && typeof f.ringDrive === 'number' ? f.ringDrive : 1));
        // How wide the dark outline under each hoop is, as a fraction of the
        // ring's radius. Zero is none.
        const edge = Math.max(0, Math.min(0.4,
          f && typeof f.ringEdge === 'number' ? f.ringEdge : 0.035));
        const skyY = yb + (yt - yb) * cam.skyAt;
        const r0 = (yt - yb) * cam.ring;
        const N = pts + 1;
        // Allocated once at the largest the ring can be, so moving the
        // resolution does not throw away four buffers and build four more on
        // every frame the slider is being dragged through.
        const cap = VG_RING_POINTS_MAX + 1;
        if (!skyPos || skyPos.length !== cap * 3) {
          skyPos = new Float32Array(cap * 3);
          skyW = new Float32Array(cap);
          skyPrev = new Float32Array(cap * 3);
          skyPrevW = new Float32Array(cap);
          // Two rings interleaved: A0 B0 A1 B1 … which a triangle strip reads
          // as the band between them.
          skyBand = new Float32Array(cap * 2 * 3);
          skyBandW = new Float32Array(cap * 2);
        }

        /// One ring, into the buffers given. False when that frame has no
        /// figure to build one from.
        const ringInto = (r, pos, wts) => {
          const liss = history[r].liss;
          if (!liss) return false;
          const z = zAt(ageOf(r));
          for (let i = 0; i < N; i++) {
            const k = i % pts;                   // closed, so the
            const th = (k / pts) * Math.PI * 2;  // last point is the first
            // Periodic by construction.
            //
            // Reading the window straight round meant the radius came from its
            // last sample on one side of the seam and its first on the other —
            // two unrelated numbers, so the ring closed with a visible kink.
            // Closing the *line* does not help; the discontinuity is in the
            // shape.
            //
            // So the angle does not index the window linearly. It sweeps
            // forward and back along a raised cosine, which returns to sample
            // zero at the seam with its slope already at zero — continuous in
            // both value and rate, and with no flat spot, which a cross-fade
            // into the head would have left.
            const u = k / pts;
            // Into the *stored* trace, whose length has nothing to do with how
            // many points are being drawn — and at a fractional place in it, not
            // a rounded one.
            //
            // **Rounding was the nodes.** Snapping to the nearest sample makes
            // the radius a staircase: every point between two samples takes one
            // of their two values, so the ring is a run of short arcs at fixed
            // radii with a corner at each change. At 256 points those corners
            // are the facets, and the beads sat on them. Interpolating between
            // the samples instead gives a curve with no corners in it at any
            // resolution, which is what makes asking for more points worth
            // anything.
            const t = (1 - Math.cos(u * Math.PI * 2)) * 0.5 * (VG_LISS_POINTS - 1);
            const i1 = Math.floor(t), fr = t - i1;
            const sample = (o) => {
              const q = Math.max(0, Math.min(VG_LISS_POINTS - 1, i1 + o));
              return q * 2;
            };
            const a0 = sample(-1), b0 = sample(0), c0 = sample(1), d0 = sample(2);
            // Catmull-Rom: through every sample, smooth in value and in slope,
            // and needing nothing but the four around the point being asked for.
            const spline = (a, b, c, d) => 0.5 * (2 * b
              + (-a + c) * fr
              + (2 * a - 5 * b + 4 * c - d) * fr * fr
              + (-a + 3 * b - 3 * c + d) * fr * fr * fr);
            const l = spline(liss[a0], liss[b0], liss[c0], liss[d0]);
            const rr = spline(liss[a0 + 1], liss[b0 + 1], liss[c0 + 1], liss[d0 + 1]);
            const mid = (l + rr) * 0.5, side = (l - rr) * 0.5;
            const rad = r0 * (1 + (mid * 0.85 + side * 0.55) * drive);
            pos[i * 3] = Math.cos(th) * rad;
            pos[i * 3 + 1] = skyY + Math.sin(th) * rad;
            pos[i * 3 + 2] = z;
            wts[i] = Math.min(1, 0.25 + Math.abs(mid) * 1.6);
          }
          return true;
        };

        // The floor runs all the way to the wall; the ring does not. Every
        // older ring is smaller by the same perspective, so a trail carried to
        // the back converges on a point and reads as a hard cone with a spike
        // at its tip. Easing it out over the last third leaves the shape
        // hanging in the air with nothing to snag on.
        const easeAt = (age) => 1 - Math.pow(Math.max(0, age - 0.34) / 0.66, 1.6);

        // ── the skin ──
        //
        // The rings were a stack of separate loops, which reads as a stack of
        // separate loops. Joined between neighbours the same way the floor
        // joins its ridges, the trail becomes a surface — a tube the sound is
        // pushing out of round, with the light running along it instead of
        // sitting on each hoop.
        //
        // Built one band at a time rather than as one mesh, because unlike the
        // floor each band carries its own fade and the ring's easing runs out
        // before the back wall.
        let havePrev = false;
        for (let r = 0; wantSkin && r < rows; r++) {
          const ok = ringInto(r, skyPos, skyW);
          if (ok && havePrev) {
            for (let i = 0; i < N; i++) {
              skyBand[i * 6] = skyPrev[i * 3];
              skyBand[i * 6 + 1] = skyPrev[i * 3 + 1];
              skyBand[i * 6 + 2] = skyPrev[i * 3 + 2];
              skyBand[i * 6 + 3] = skyPos[i * 3];
              skyBand[i * 6 + 4] = skyPos[i * 3 + 1];
              skyBand[i * 6 + 5] = skyPos[i * 3 + 2];
              skyBandW[i * 2] = skyPrevW[i];
              skyBandW[i * 2 + 1] = skyW[i];
            }
            const age = ageOf(r);
            // Well under the lines' own alpha. A skin at full strength buries
            // the hoops it is made of, and the hoops are the reading — this is
            // the body between them, not a replacement for them.
            const a = 0.16 * (1 - age * 0.7) * Math.max(0, easeAt(age));
            if (a > 0.002) {
              draw(gl.TRIANGLE_STRIP, skyBand, skyBandW, N * 2, a, false,
                f.core, f.hot, 1);
            }
          }
          if (ok) {
            skyPrev.set(skyPos);
            skyPrevW.set(skyW);
            havePrev = true;
          }
        }

        // ── the hoops ──
        for (let r = 0; wantSky && r < rows; r++) {
          if (!ringInto(r, skyPos, skyW)) continue;
          const age = ageOf(r);
          const lead = r === rows - 1;

          // ── the outline ──
          //
          // A dark ribbon laid down first, a little wider than the line that
          // goes on top of it, so each hoop is separated from whatever it is
          // crossing instead of summing with it. The rings trail forty deep and
          // additive blending turns a stack of them into a wash — this is what
          // keeps the near ones reading as in front of the far ones.
          //
          // Built by pushing the ring's own points out and in along the radius.
          // The ring is drawn round on screen at every depth and its points are
          // laid out by angle from its centre, so "along the radius" is exactly
          // perpendicular to the line — no screen-space maths needed, and none
          // of `lineWidth`, which almost every driver clamps to 1.
          if (edge > 0) {
            const w = r0 * edge;
            for (let i = 0; i < N; i++) {
              const px = skyPos[i * 3], py = skyPos[i * 3 + 1] - skyY;
              const d = Math.hypot(px, py) || 1;
              const ux = px / d, uy = py / d;
              skyBand[i * 6] = px - ux * w;
              skyBand[i * 6 + 1] = skyY + py - uy * w;
              skyBand[i * 6 + 2] = skyPos[i * 3 + 2];
              skyBand[i * 6 + 3] = px + ux * w;
              skyBand[i * 6 + 4] = skyY + py + uy * w;
              skyBand[i * 6 + 5] = skyPos[i * 3 + 2];
              skyBandW[i * 2] = 1;
              skyBandW[i * 2 + 1] = 1;
            }
            const dark = (lead ? 0.9 : 0.62) * Math.max(0, easeAt(age));
            if (dark > 0.004) drawDark(gl.TRIANGLE_STRIP, skyBand, skyBandW, N * 2, dark);
          }
          // **No beads.** The leading ring used to carry a point sprite at
          // every vertex, to give the frame being heard now the weight the
          // floor's leading ridge has. On a curve they are nodes: they mark
          // where the samples happen to fall, which is an artefact of the
          // analyser's block size and says nothing whatever about the sound.
          // The line is drawn at full alpha instead, which is the same emphasis
          // without the dots.
          draw(gl.LINE_STRIP, skyPos, skyW, N,
            lead ? 1.0 : (0.28 + (1 - age) * 0.5) * Math.max(0, easeAt(age)),
            false, f.core, f.hot, 1);
        }
      };

      // ── the air ──
      //
      // Drawn before the layers, so everything in the room sits in front of the
      // haze rather than behind it. With additive blending the order does not
      // change the sum, but it does decide what the depth buffer sees when a
      // layer is occluding — and fog that could hide the room would be fog you
      // could not see through.
      if (fog && fog.on && (fog.volume === undefined || fog.volume)) {
        const motes = Math.max(8, Math.round(VG_FOG_MOTES
          * Math.max(0.05, Math.min(1.5, fog.thickness === undefined ? 0.6 : fog.thickness))));
        if (!fogPos || fogPos.length < motes * 3) {
          fogPos = new Float32Array(Math.ceil(motes * 1.4) * 3);
          fogW = new Float32Array(Math.ceil(motes * 1.4));
        }
        // Slowly, and on the wall clock, so it drifts while the room is paused
        // as well as while it is running. Air does not stop when the sound does.
        const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        for (let i = 0; i < motes; i++) {
          // Its own place, held for good: a hash rather than a random, so the
          // haze does not reshuffle itself every frame into a different fog.
          const h = (i * 2654435761) >>> 0;
          const hx = ((h & 0xffff) / 0x8000) - 1;
          const hy = (((h >>> 16) & 0x7fff) / 0x4000) - 1;
          const h2 = ((i * 40503) ^ 0x9e3779b9) >>> 0;
          const hz = (h2 & 0xffff) / 0x10000;
          const drift = 0.06 + (h2 >>> 24) / 255 * 0.12;
          // Across, up, and back — with the depth wrapped so a mote that
          // reaches the wall reappears at the front instead of the field
          // slowly emptying.
          const zf = (hz + t * drift * 0.06) % 1;
          // **Well past the frame on every side.**
          //
          // The field was a slab a shade wider than the room — ±1.15 of its
          // half-width and ±0.62 of its height — and a slab has edges. Near the
          // front, where the frustum is at its widest and a mote is at its
          // biggest, those edges land *inside* the picture: a rectangle of air
          // with clear air around it, which is the square that was reported.
          //
          // Fog has no boundary you are supposed to see. The field is drawn far
          // enough out that its own edge is always off the frame, at both ends
          // of the room, and the motes that fall outside cost a vertex each and
          // nothing more.
          const x = (hx * 2.6 + Math.sin(t * drift + hz * 9.0) * 0.06) * halfW;
          const y = yb + (yt - yb) * (0.5 + hy * 1.45
            + Math.sin(t * drift * 0.7 + hx * 7.0) * 0.03);
          fogPos[i * 3] = x;
          fogPos[i * 3 + 1] = y;
          fogPos[i * 3 + 2] = zAt(zf);
          // **Thin at the front, thick at the back**, the same way the tint is.
          //
          // The motes were spread evenly through the room and drawn at one
          // alpha, so there was as much haze a hand's breadth from the eye as
          // there was at the back wall — which is a colour wash over the whole
          // picture rather than air with depth in it, and it is what was left of
          // "the fog only colours the whole scene" after the tint was fixed.
          //
          // Nothing pops at either end: it comes up from nothing at the near
          // plane and eases off again as it reaches the wall.
          const depthIn = Math.pow(zf, 1.6) * (1 - Math.pow(zf, 6));
          fogW[i] = 0.05 + depthIn * 0.22;
        }
        const strength = Math.max(0, Math.min(1.5,
          fog.density === undefined ? 0.5 : fog.density));
        drawSoft = true;
        // Three sizes of the same field. One size is a texture; three is a
        // depth of air.
        //
        // **None of them enormous.** A point sprite is a square, and the bigger
        // it is the more of the picture one square covers when anything goes
        // wrong with its mask — a third of the canvas, in the case that was
        // reported. Drivers also clamp `gl_PointSize` somewhere around 255 and
        // do not say when they have, so a size past that is a size that means
        // something different on every machine. More, smaller motes instead.
        const rgb = fog.rgb || [0.5, 0.6, 0.7];
        draw(gl.POINTS, fogPos, fogW, motes, 0.11 * strength, true, rgb, rgb, 48);
        draw(gl.POINTS, fogPos, fogW, motes, 0.07 * strength, true, rgb, rgb, 104);
        draw(gl.POINTS, fogPos, fogW, motes, 0.04 * strength, true, rgb, rgb, 190);
        drawSoft = false;
      }

      // ── the hierarchy ──
      //
      // Top of the list first, and that is what puts it on top: with occlusion
      // on it writes depth before anything below it is drawn, so where two
      // layers want the same pixel the higher one keeps it.
      //
      // **With nothing occluding, this order buys you nothing.** Every pass
      // here is additive, and addition does not care what order it happens in —
      // reversing the whole stack gives the same picture. On a dark scene it is
      // the same to the byte; on a bright one it differs by a fraction of a per
      // cent, because this addition saturates at 255 and saturating addition is
      // not associative. That is a rounding artefact, not a hierarchy. An
      // earlier note here claimed the order still decided "which additive pass
      // lands last, which is the same idea with the volume down", and that was
      // simply wrong. Depth is the only thing that makes being drawn earlier
      // mean anything, so the interface says as much rather than leaving it to
      // be discovered.
      //
      // Two more things follow from occlusion being geometric, and both look
      // like the control being ignored when they are not:
      //
      // * A layer masks with the geometry it actually has. The floor is a
      //   surface and hides a great deal; the box is eight lines and hides
      //   almost nothing.
      // * A layer at the bottom of the list masks no *other* layer, because
      //   nothing is drawn after it — but it still occludes itself, which for
      //   the terrain means its near ridges standing in front of its far ones.
      const LAYER_DRAW = {
        room: drawRoom,
        floor: drawFloor,
        lead: drawLead,
        grains: () => drawGrains(!!occ.grains),
        skin: () => drawRings(true, false),
        sky: () => drawRings(false, true),
      };
      for (const key of order) {
        if (!on[key]) continue;
        // A layer that is not occluding still *gets* occluded — it is drawn
        // against whatever depth has been written already, it just does not add
        // to it.
        gl.depthMask(!!occ[key]);
        LAYER_DRAW[key]();
      }
      gl.depthMask(true);
    },

    dispose() {
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(wBuf);
      gl.deleteProgram(prog.p);
    },
  };
}
