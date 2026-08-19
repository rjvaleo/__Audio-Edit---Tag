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
/// Points in one Lissajous figure. The trace arrives with a thousand-odd pairs;
/// at the size this draws, and fifty-six deep, a quarter of them is the same
/// picture for a quarter of the memory.
const VG_LISS_POINTS = 256;

/// How many grain streaks may be drawn at once.
///
/// The schedule can hold far more than this — a long file at sixteen layers is
/// millions — and nothing is served by drawing them: past a few thousand the
/// room is a solid wash and the cost is real. The cap is on what is *drawn*,
/// not on what is read, so the ones nearest the playhead are the ones that get
/// in.
const VG_GRAIN_CAP = 3000;

/// Sprites per grain. A grain is drawn as a short run of soft points along its
/// own depth rather than as one mark, which is what lets overlapping grains
/// build into mass instead of hatching into wires.
const VG_GRAIN_PUFFS = 5;
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
void main() {
  vW = aW;
  vec4 p = uMVP * vec4(aPos, 1.0);
  // 0 at the front of the room, 1 at the back. Taken from the world position
  // rather than from gl_Position.z, which is already curved by the projection.
  vDepth = clamp(-aPos.z, 0.0, 1.0);
  gl_Position = p;
  gl_PointSize = uPointSize / max(0.35, p.w) ;
}`;

const VG_FS = `
precision mediump float;
varying float vW;
varying float vDepth;
uniform vec3 uCold;
uniform vec3 uHot;
uniform float uAlpha;
uniform float uRound;   // 1 for point sprites, 0 for lines and triangles
void main() {
  float a = uAlpha;
  if (uRound > 0.5) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    a *= smoothstep(1.0, 0.0, d);
  }
  // The far end of the room is dimmer, which is the whole of the depth cue when
  // there is no fog and no shadow to give one. Only a little dimmer, though:
  // additive blending over a dark panel loses more than it looks like it
  // should, and the trail has to still be there when it reaches the back wall
  // rather than dissolving somewhere in the middle of the room.
  float far = 1.0 - vDepth * 0.42;
  vec3 col = mix(uCold, uHot, clamp(vW, 0.0, 1.0));
  // Lifted at the top end so a loud band burns rather than merely brightens.
  col += uHot * pow(clamp(vW, 0.0, 1.0), 3.0) * 0.55;
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
      uPointSize: gl.getUniformLocation(p, 'uPointSize'),
    };
  } catch (e) {
    console.warn('visualiser:', e.message);
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
  let skyPrev = null, skyPrevW = null, skyBand = null, skyBandW = null;

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
    gl.uniform1f(prog.uPointSize, size || 1);
    gl.uniform3fv(prog.uCold, cold);
    gl.uniform3fv(prog.uHot, hot);
    gl.drawArrays(mode, 0, count);
  };

  return {
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
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

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
      if (on.room) {
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
      }

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

      if (on.floor && rows > 1) {
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
      }

      // The wire over it, so the ridges keep their edge. It is the frame you are
      // hearing *now*, so it is its own layer: the terrain can be turned off and
      // this still says where the sound is.
      if (on.lead && rows) {
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
      }

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
      if (on.grains && f.grains && f.grains.length) {
        const g = f.grains;
        const sr = f.grainRate || 44100;
        const span = VG_HISTORY * (f.pollMs || 50) / 1000;   // seconds the room holds
        const now = (f.position || 0) / (f.positionRate || sr);
        const pitchSpan = 12;                                 // semitones to the ceiling

        const want = Math.min(g.length, VG_GRAIN_CAP);
        const per = VG_GRAIN_PUFFS;
        if (!grainPos || grainPos.length !== VG_GRAIN_CAP * per * 3) {
          grainPos = new Float32Array(VG_GRAIN_CAP * per * 3);
          grainW = new Float32Array(VG_GRAIN_CAP * per);
        }
        let n = 0;
        for (let i = 0; i < g.length && n < want * per; i++) {
          const e = g[i];
          const t0 = e[0] / sr;
          const age = (now - t0) / span;
          // Not yet sounded, or already gone past the back wall.
          if (age < -0.02 || age > 1) continue;
          const life = (e[2] / sr) / span;
          const a0 = Math.max(0, age);
          const a1 = Math.min(1, age + life);
          if (a1 <= a0) continue;

          // Scattered across the room and **overhead**.
          //
          // The scatter is a hash of the grain's own index, so it is stable: a
          // grain keeps its place for its whole life instead of being re-thrown
          // every frame, and the same schedule draws the same cloud twice.
          // `index` is the right key because every jitter the engine gives a
          // grain is already a pure function of it.
          //
          // The band sits in the upper part of the room, so the cloud passes
          // above you rather than through you. Pan leans the x and pitch leans
          // the y — a lean on the scatter rather than the whole of it, so
          // neither collapses to a line when it is left at zero.
          const h = (e[7] | 0) * 2654435761 >>> 0;
          const hx = ((h & 0xffff) / 0x8000) - 1;            // -1..1
          const hy = (((h >>> 16) & 0xffff) / 0x8000) - 1;
          const hz = (((h >>> 8) & 0xff) / 128) - 1;
          const pitchFrac = Math.max(-1, Math.min(1, (e[3] || 0) / pitchSpan));
          const x = (hx * 0.86 + (e[6] || 0) * 0.14) * halfW;
          const y = yb + (yt - yb)
            * Math.max(0.5, Math.min(0.99, 0.78 + hy * 0.16 + pitchFrac * 0.12));

          // A grain is a puff, not a line.
          //
          // Drawn as a short run of soft round sprites along its own depth, so
          // overlapping grains build up into mass the way cloud does instead of
          // hatching into wires. The sprites are the shader's round mode, which
          // falls off to nothing at the edge — hard points would only be a
          // coarser wire.
          const w = Math.min(1, Math.sqrt(Math.max(0, e[4] || 0)) * 2.2);
          for (let k = 0; k < per && n < want * per; k++) {
            const u = per === 1 ? 0 : k / (per - 1);
            const a = a0 + (a1 - a0) * u;
            // A little wander across its life, so a puff is not a straight bar
            // of dots.
            const drift = (u - 0.5) * 0.06 * hz * halfW;
            grainPos[n * 3] = x + drift;
            grainPos[n * 3 + 1] = y + (u - 0.5) * 0.02 * (yt - yb);
            grainPos[n * 3 + 2] = zAt(a);
            // Thickest in the middle of the grain and nothing at its ends,
            // which is the envelope it is actually played with.
            grainW[n] = w * Math.sin(Math.PI * (0.15 + u * 0.7));
            n++;
          }
        }
        if (n) {
          // Big, soft and faint. The mass comes from how many overlap, not from
          // any one of them being visible on its own.
          draw(gl.POINTS, grainPos, grainW, n, 0.30, true, f.cold, f.core, 26);
          draw(gl.POINTS, grainPos, grainW, n, 0.22, true, f.core, f.hot, 9);
        }
      }

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
      if (on.sky) {
        const skyY = yb + (yt - yb) * cam.skyAt;
        const r0 = (yt - yb) * cam.ring;
        const N = VG_LISS_POINTS + 1;
        if (!skyPos || skyPos.length !== N * 3) {
          skyPos = new Float32Array(N * 3);
          skyW = new Float32Array(N);
          skyPrev = new Float32Array(N * 3);
          skyPrevW = new Float32Array(N);
          // Two rings interleaved: A0 B0 A1 B1 … which a triangle strip reads
          // as the band between them.
          skyBand = new Float32Array(N * 2 * 3);
          skyBandW = new Float32Array(N * 2);
        }

        /// One ring, into the buffers given. False when that frame has no
        /// figure to build one from.
        const ringInto = (r, pos, wts) => {
          const liss = history[r].liss;
          if (!liss) return false;
          const z = zAt(ageOf(r));
          for (let i = 0; i < N; i++) {
            const k = i % VG_LISS_POINTS;                   // closed, so the
            const th = (k / VG_LISS_POINTS) * Math.PI * 2;  // last point is the first
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
            const u = k / VG_LISS_POINTS;
            const j = Math.round((1 - Math.cos(u * Math.PI * 2)) * 0.5
              * (VG_LISS_POINTS - 1));
            const l = liss[j * 2], rr = liss[j * 2 + 1];
            const mid = (l + rr) * 0.5, side = (l - rr) * 0.5;
            const rad = r0 * (1 + mid * 0.85 + side * 0.55);
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
        for (let r = 0; on.skin && r < rows; r++) {
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
        for (let r = 0; r < rows; r++) {
          if (!ringInto(r, skyPos, skyW)) continue;
          const age = ageOf(r);
          const lead = r === rows - 1;
          draw(gl.LINE_STRIP, skyPos, skyW, N,
            lead ? 1.0 : (0.28 + (1 - age) * 0.5) * Math.max(0, easeAt(age)),
            false, f.core, f.hot, 1);
          // The frame being heard now gets weight, the same way the floor's
          // leading ridge does.
          if (lead) {
            draw(gl.POINTS, skyPos, skyW, N, 0.85, true, f.core, f.hot, 7);
          }
        }
      }
    },

    dispose() {
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(wBuf);
      gl.deleteProgram(prog.p);
    },
  };
}
