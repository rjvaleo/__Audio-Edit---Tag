// The unified visualiser's renderer. WebGL, written here, no dependency.
//
// Four layers composited into one image with additive blending, so where they
// overlap they bloom rather than occlude: a spectrum field, the grain cloud as
// point sprites, the goniometer as a bright core, and a level glow behind all
// of it. See `docs/VISUALISER.md`.
//
// WebGL 1 and unsigned-byte textures only — no float-texture extension, no
// instancing, nothing that needs asking permission for. It runs wherever the
// rest of the interface does, and where it does not, `vgAttach` returns null
// and the caller falls back.
//
// One global scope: every name in here starts `vg`.

/// Compile one shader, or say exactly which one failed and why.
function vgShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log}`);
  }
  return s;
}

/// A linked program with its uniforms and attributes already looked up.
///
/// Looking these up per frame is a string hash per name per draw; there are
/// three programs here and they are built once.
function vgProgram(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  const vs = vgShader(gl, gl.VERTEX_SHADER, vsrc);
  const fs = vgShader(gl, gl.FRAGMENT_SHADER, fsrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`link: ${log}`);
  }
  const u = {}, a = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const n = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[n] = gl.getUniformLocation(p, n);
  }
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i++) {
    const n = gl.getActiveAttrib(p, i).name;
    a[n] = gl.getAttribLocation(p, n);
  }
  return { p, u, a };
}

// ── the spectrum field, and the glow behind everything ──────────────────────
//
// One full-screen quad doing two jobs. They are the only two layers that cover
// the whole frame, and running them in one pass halves the fill.

const VG_QUAD_VS = `
attribute vec2 aXY;
varying vec2 vUV;
void main() {
  vUV = aXY * 0.5 + 0.5;
  gl_Position = vec4(aXY, 0.0, 1.0);
}`;

const VG_QUAD_FS = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uSpec;   // the band spectrum, one texel per band
uniform float uLevel;      // 300 ms VU, 0..1
uniform float uCorr;       // -1..1
uniform vec3 uCold;
uniform vec3 uHot;
uniform float uTilt;       // how much of the frame the field occupies

void main() {
  // The ridge. uSpec holds each band's height; the field is a glow that
  // falls away either side of it, plus a dim wash beneath so the shape reads
  // as a solid mass rather than a wire.
  float band = texture2D(uSpec, vec2(vUV.x, 0.5)).r * uTilt;
  float d = vUV.y - band;
  float ridge = exp(-abs(d) * 30.0);
  float under = smoothstep(0.0, 0.015, band - vUV.y) * (0.10 + band * 0.22);
  vec3 col = mix(uCold, uHot, clamp(band * 1.4, 0.0, 1.0));

  // Behind it, a glow that follows loudness. Warm when the image is coherent,
  // cold when it is not — so a mix drifting out of phase changes the colour of
  // the whole frame rather than only a needle nobody is looking at.
  vec2 c = vUV - 0.5;
  float r = length(vec2(c.x * 1.6, c.y));
  float halo = exp(-r * 3.2) * uLevel * 0.55;
  vec3 haloCol = mix(vec3(0.85, 0.30, 0.25), uHot, clamp(uCorr * 0.5 + 0.5, 0.0, 1.0));

  float a = ridge * 0.85 + under + halo;
  gl_FragColor = vec4(col * (ridge * 0.85 + under) + haloCol * halo, a);
}`;

// ── the grain cloud ─────────────────────────────────────────────────────────

const VG_GRAIN_VS = `
attribute vec2 aPos;    // x: where in the source, y: pitch
attribute vec2 aAux;    // x: level, y: when it is struck, in seconds
uniform float uPlay;    // the playhead, in the same seconds
uniform float uSpan;    // how long a grain stays lit
uniform float uScale;   // point size, scaled for the canvas
varying float vHeat;
void main() {
  float since = uPlay - aAux.y;
  float lit = (since < 0.0 || since > uSpan) ? 0.0 : 1.0 - since / uSpan;
  vHeat = lit * lit;
  gl_PointSize = (1.5 + aAux.x * 22.0) * (0.55 + vHeat * 2.6) * uScale;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, aPos.y, 0.0, 1.0);
}`;

const VG_GRAIN_FS = `
precision mediump float;
varying float vHeat;
uniform vec3 uCold;
uniform vec3 uHot;
uniform float uInk;
void main() {
  // A soft disc. Squaring the falloff gives a core with a halo, which is what
  // makes a point read as struck rather than as a dot.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  vec3 col = mix(uCold, uHot, vHeat);
  gl_FragColor = vec4(col, a * (0.10 + vHeat * 0.9) * uInk);
}`;

// ── the goniometer core ─────────────────────────────────────────────────────

const VG_GONIO_VS = `
attribute vec2 aLR;
attribute float aAge;     // 0 oldest, 1 newest
uniform float uScale;
uniform float uAspect;
varying float vAge;
void main() {
  vAge = aAge;
  // Mid up, sides across — the forty-five degree rotation that puts a mono
  // signal on the vertical.
  vec2 p = vec2(aLR.x - aLR.y, aLR.x + aLR.y) * 0.70710678 * uScale;
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
  gl_PointSize = 1.0 + aAge * 2.5;
}`;

const VG_GONIO_FS = `
precision mediump float;
varying float vAge;
uniform vec3 uInk;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(uInk, a * (0.12 + vAge * 0.75));
}`;

/// Attach a composite scene to a canvas.
///
/// Returns `null` when WebGL is unavailable, which is a fallback and not an
/// error — the caller shows the 2D swarm instead.
function vgAttach(canvas) {
  let gl;
  try {
    gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl');
  } catch { return null; }
  if (!gl) return null;

  let quad, grain, gonio;
  try {
    quad = vgProgram(gl, VG_QUAD_VS, VG_QUAD_FS);
    grain = vgProgram(gl, VG_GRAIN_VS, VG_GRAIN_FS);
    gonio = vgProgram(gl, VG_GONIO_VS, VG_GONIO_FS);
  } catch (e) {
    console.warn('visualiser:', e.message);
    return null;
  }

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const specTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, specTex);
  for (const [k, v] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ]) gl.texParameteri(gl.TEXTURE_2D, k, v);

  const grainPos = gl.createBuffer();
  const grainAux = gl.createBuffer();
  const gonioBuf = gl.createBuffer();
  const gonioAge = gl.createBuffer();

  let grainCount = 0;
  /// Which schedule is on the card. Uploading tens of thousands of points every
  /// frame would be the whole cost of the scene, and the schedule only changes
  /// when the document does.
  let grainKey = null;
  let gonioCount = 0;
  let specWidth = 0;

  const bind = (buf, loc, size) => {
    if (loc === undefined || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };

  return {
    /// Hand the scene a schedule. Cheap to call; it only uploads when the
    /// schedule is not the one already on the card.
    grains(list, key, sampleRate, sourceFrames) {
      if (key === grainKey) return;
      grainKey = key;
      if (!list || !list.length || !sourceFrames) { grainCount = 0; return; }
      const n = list.length;
      const pos = new Float32Array(n * 2);
      const aux = new Float32Array(n * 2);
      const sr = sampleRate || 48000;
      for (let i = 0; i < n; i++) {
        const g = list[i];
        pos[i * 2] = g[1] / sourceFrames;
        // Pitch across the vertical, clamped so a wild scatter still lands on
        // screen instead of being thrown off the top.
        pos[i * 2 + 1] = Math.max(-0.95, Math.min(0.95, (g[3] || 0) / 24));
        aux[i * 2] = Math.min(1, (g[4] || 0) * 6);
        aux[i * 2 + 1] = g[0] / sr;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, grainPos);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, grainAux);
      gl.bufferData(gl.ARRAY_BUFFER, aux, gl.DYNAMIC_DRAW);
      grainCount = n;
    },

    /// Draw one frame. `f` carries already-interpolated values, so this does no
    /// smoothing of its own — see `vgSmooth`.
    frame(f) {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // ── the field and the glow ──
      if (f.spectrum && f.spectrum.length) {
        const n = f.spectrum.length;
        gl.bindTexture(gl.TEXTURE_2D, specTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        if (n !== specWidth) {
          specWidth = n;
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, n, 1, 0, gl.LUMINANCE,
            gl.UNSIGNED_BYTE, f.spectrum);
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.LUMINANCE,
            gl.UNSIGNED_BYTE, f.spectrum);
        }
        gl.useProgram(quad.p);
        bind(quadBuf, quad.a.aXY, 2);
        gl.uniform1i(quad.u.uSpec, 0);
        gl.uniform1f(quad.u.uLevel, f.level);
        gl.uniform1f(quad.u.uCorr, f.correlation);
        gl.uniform1f(quad.u.uTilt, 0.82);
        gl.uniform3fv(quad.u.uCold, f.cold);
        gl.uniform3fv(quad.u.uHot, f.hot);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      // ── the cloud ──
      if (grainCount) {
        gl.useProgram(grain.p);
        bind(grainPos, grain.a.aPos, 2);
        bind(grainAux, grain.a.aAux, 2);
        gl.uniform1f(grain.u.uPlay, f.playSeconds);
        gl.uniform1f(grain.u.uSpan, 0.28);
        gl.uniform1f(grain.u.uScale, Math.max(0.6, h / 420));
        gl.uniform1f(grain.u.uInk, 0.9);
        gl.uniform3fv(grain.u.uCold, f.cold);
        gl.uniform3fv(grain.u.uHot, f.hot);
        gl.drawArrays(gl.POINTS, 0, grainCount);
      }

      // ── the core ──
      if (f.lissajous && f.lissajous.length >= 4) {
        const n = f.lissajous.length / 2;
        if (n !== gonioCount) {
          const age = new Float32Array(n);
          for (let i = 0; i < n; i++) age[i] = i / (n - 1);
          gl.bindBuffer(gl.ARRAY_BUFFER, gonioAge);
          gl.bufferData(gl.ARRAY_BUFFER, age, gl.STATIC_DRAW);
          gonioCount = n;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, gonioBuf);
        gl.bufferData(gl.ARRAY_BUFFER, f.lissajous, gl.DYNAMIC_DRAW);
        gl.useProgram(gonio.p);
        bind(gonioBuf, gonio.a.aLR, 2);
        bind(gonioAge, gonio.a.aAge, 1);
        gl.uniform1f(gonio.u.uScale, 0.42);
        gl.uniform1f(gonio.u.uAspect, Math.max(0.2, w / h));
        gl.uniform3fv(gonio.u.uInk, f.core);
        gl.drawArrays(gl.POINTS, 0, gonioCount);
      }
    },

    dispose() {
      for (const b of [quadBuf, grainPos, grainAux, gonioBuf, gonioAge]) gl.deleteBuffer(b);
      gl.deleteTexture(specTex);
      for (const p of [quad, grain, gonio]) gl.deleteProgram(p.p);
    },
  };
}

/// Twenty hertz of data, sixty hertz of picture.
///
/// The master bus polls five times slower than the display refreshes, which is
/// the right rate for numbers and the wrong one for motion. This keeps the
/// last frame and walks it towards the new one, so the picture moves at the
/// display's rate off a feed that does not. It is the difference between
/// "dynamic" and "steppy", and it costs nothing.
function vgSmooth() {
  let spec = null;
  let level = 0, corr = 1;
  return {
    /// `k` is how far to travel towards the target this frame. Frame-rate
    /// independent: at 60 fps a 0.25 constant is a very different filter than
    /// at 20, and the scene must not change character with the refresh rate.
    step(target, dt) {
      const k = 1 - Math.exp(-dt * 14);
      level += (target.level - level) * k;
      corr += (target.correlation - corr) * k;
      const t = target.spectrum;
      if (t && t.length) {
        if (!spec || spec.length !== t.length) spec = new Uint8Array(t);
        else {
          for (let i = 0; i < t.length; i++) {
            // Fast up, slow down. A spectrum that eases *into* a transient
            // misses it; one that eases out of it is how a peak reads as decay.
            const d = t[i] - spec[i];
            spec[i] += d > 0 ? d : d * k;
          }
        }
      }
      return { level, correlation: corr, spectrum: spec };
    },
  };
}
