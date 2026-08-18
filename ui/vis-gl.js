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

/// How far the room runs back, as a multiple of the distance to its front face.
/// This sets how strongly it converges: the back face draws at `1 / (1 + D)` of
/// the front one.
const VG_DEPTH = 1.9;
/// Where the floor sits below the eye, and the ceiling above it, at the front
/// face. Their ratio is what puts the vanishing point above the middle, which
/// is what lets you see the floor at all.
const VG_FLOOR_Y = -0.38;
const VG_CEIL_Y = 0.62;

/// Frames kept for the trail. About three seconds at the poll's rate, which is
/// long enough to see a phrase move away from you.
const VG_HISTORY = 56;
/// Points in one Lissajous figure. The trace arrives with a thousand-odd pairs;
/// at the size this draws, and fifty-six deep, a quarter of them is the same
/// picture for a quarter of the memory.
const VG_LISS_POINTS = 256;
/// How thick the leading edge is drawn, in world units.
///
/// It is geometry rather than `gl.lineWidth`, which almost every driver clamps
/// to 1 and is therefore not a way to make anything thicker.
const VG_LEAD = 0.012;
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
      const yb = VG_FLOOR_Y, yt = VG_CEIL_Y;
      const halfW = (yt - yb) * 0.5 * aspect;
      const far = near * (1 + VG_DEPTH);
      const mvp = vgFrustum(-halfW, halfW, yb, yt, near, far + 1);
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.uMVP, false, mvp);

      // Depth runs 0 at the front to 1 at the back, which is what the shaders
      // fade against.
      const zAt = (t) => -(near + t * (far - near));

      // ── the room ──
      //
      // Only the four runs back and the far rectangle. The near rectangle is
      // the canvas border and drawing it would be a line painted on the bezel.
      {
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

      if (rows > 1) {
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

      // The wire over it, so the ridges keep their edge.
      if (rows) {
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
          leadPos[i * 6] = x; leadPos[i * 6 + 1] = y - VG_LEAD; leadPos[i * 6 + 2] = z;
          leadPos[i * 6 + 3] = x; leadPos[i * 6 + 4] = y + VG_LEAD; leadPos[i * 6 + 5] = z;
          leadW[i * 2] = now[i]; leadW[i * 2 + 1] = now[i];
        }
        draw(gl.TRIANGLE_STRIP, leadPos, leadW, n2, 1.0, false, f.cold, f.hot, 1);
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
      {
        const skyY = yb + (yt - yb) * 0.72;
        const r0 = (yt - yb) * 0.17;
        if (!skyPos || skyPos.length !== (VG_LISS_POINTS + 1) * 3) {
          skyPos = new Float32Array((VG_LISS_POINTS + 1) * 3);
          skyW = new Float32Array(VG_LISS_POINTS + 1);
        }
        for (let r = 0; r < rows; r++) {
          const liss = history[r].liss;
          if (!liss) continue;
          const age = ageOf(r);
          const z = zAt(age);
          for (let i = 0; i <= VG_LISS_POINTS; i++) {
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
            skyPos[i * 3] = Math.cos(th) * rad;
            skyPos[i * 3 + 1] = skyY + Math.sin(th) * rad;
            skyPos[i * 3 + 2] = z;
            skyW[i] = Math.min(1, 0.25 + Math.abs(mid) * 1.6);
          }
          const lead = r === rows - 1;
          // The floor runs all the way to the wall; the ring does not. Every
          // older ring is smaller by the same perspective, so a trail carried
          // to the back converges on a point and reads as a hard cone with a
          // spike at its tip. Easing it out over the last third leaves the
          // shape hanging in the air with nothing to snag on.
          const ease = 1 - Math.pow(Math.max(0, age - 0.34) / 0.66, 1.6);
          draw(gl.LINE_STRIP, skyPos, skyW, VG_LISS_POINTS + 1,
            lead ? 1.0 : (0.28 + (1 - age) * 0.5) * Math.max(0, ease),
            false, f.core, f.hot, 1);
          // The frame being heard now gets weight, the same way the floor's
          // leading ridge does.
          if (lead) {
            draw(gl.POINTS, skyPos, skyW, VG_LISS_POINTS + 1, 0.85, true,
              f.core, f.hot, 7);
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
