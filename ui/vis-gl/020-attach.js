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
      aW2: gl.getAttribLocation(p, 'aW2'),
      uMVP: gl.getUniformLocation(p, 'uMVP'),
      uCold: gl.getUniformLocation(p, 'uCold'),
      uHot: gl.getUniformLocation(p, 'uHot'),
      uRamp: gl.getUniformLocation(p, 'uRamp'),
      uRampV: gl.getUniformLocation(p, 'uRampV'),
      uRampOn: gl.getUniformLocation(p, 'uRampOn'),
      uDrive: gl.getUniformLocation(p, 'uDrive'),
      uRange: gl.getUniformLocation(p, 'uRange'),
      uCurve: gl.getUniformLocation(p, 'uCurve'),
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
  const w2Buf = gl.createBuffer();

  // ── the palette ──
  //
  // One texture holding every ramp in the room, a row each, 256 samples across.
  // Sixteen rows because it has to be a power of two and thirteen things are
  // drawn; the spare rows cost 3 kB.
  //
  // Uploaded only when the palette actually changes, which is when somebody
  // moves a colour. Between those it is bound and read like any other texture.
  const rampTex = gl.createTexture();
  let rampVersion = -1;
  gl.bindTexture(gl.TEXTURE_2D, rampTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // Clamped, so the ends of a ramp are the ends of a ramp. Repeating would make
  // the darkest colour appear next to the brightest at t = 1.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));

  /// The palette this frame is being drawn with, or null for the room's own
  /// two colours. Set once at the top of a frame and read at every draw.
  let paints = null;

  // ── the room's own shape ──
  //
  // Held here rather than taken per frame because **`push` needs them too** and
  // it runs on the meter's clock, not the display's. A row is resampled to the
  // floor's width as it arrives and the trail is trimmed to its depth there, so
  // both numbers have to be known outside `frame`.
  //
  // Set from `f.geom` at the top of every frame; the defaults are the shape the
  // room shipped with, so a caller that says nothing about geometry draws the
  // room it always drew.
  let geomBands = VG_FLOOR_BANDS;
  let geomHistory = VG_HISTORY;
  let geomRidge = VG_RIDGE;
  // How many seconds of sound the room's depth stands for, and how big a
  // grain is drawn against the room's height.
  let geomSpan = VG_GRAIN_SPAN_S;
  let geomBody = VG_GRAIN_BODY;
  // The landscape gets buffers of its own. It is thirty thousand vertices and
  // it only changes when a frame is pushed — rebuilding it sixty times a second
  // to draw the same thing twenty times would be the whole cost of the scene.
  const meshPosBuf = gl.createBuffer();
  const meshWBuf = gl.createBuffer();
  const meshW2Buf = gl.createBuffer();
  let meshRows = 0;
  let geomWidth = VG_WORLD_W;
  let geomReach = VG_WORLD_REACH;
  let geomAt = { ...VG_WORLD_AT };
  let meshKey = '';
  let gridKey = '';
  let gridMinor = null;
  let gridMajor = null;
  let pushes = 0;

  /// The waterfall, oldest row first so the newest is drawn last and on top.
  /// A plain array of rows rather than a ring, because it is rebuilt into one
  /// vertex buffer anyway and 56 shifts of a typed array is nothing.
  const history = [];

  // ── the second drive, per layer ──
  //
  // One extra quantity each, and it is the one that layer knows and cannot
  // otherwise express. Everything else a ramp might be read against is already
  // a varying: loudness is the weight, pitch is the height, time is the depth.
  // What is missing is different in each place —
  //
  //   the floor and the leading edge : which frequency a band is
  //   the ring and its skin          : how wide the stereo image is there
  //   the cloud and its mist         : where a grain is panned
  //
  // — so there is one attribute rather than five, and each layer fills it with
  // its own answer. A second, third and fourth attribute would be three more
  // buffers uploaded every frame to carry numbers no layer asks for at once.
  let floorHz = null, leadHz = null;
  let skyW2 = null, skyPrevW2 = null, skyBandW2 = null;
  let grainW2 = null, grainLineW2 = null, mistW2 = null, grainFillW2 = null;

  // Reused every frame. Sized on first use and never grown again.
  let floorPos = null, floorW = null;
  let leadPos = null, leadW = null;
  let skyPos = null, skyW = null;
  // The solid's own buffers, and the two angles it accumulates. Kept out here
  // because turning *by* the level means remembering where it got to.
  /// The last frame's view, for projecting between the room and the screen.
  let view = null;
  let solidPos = null, solidW = null, solidW2 = null, solidEnv = null;
  let solidZw = 0, solidXw = 0, solidSpinPhase = 0, solidLast = 0;
  /// Where the solid was standing at each frame on the trail.
  ///
  /// **Without this the trail collapses.** Every copy was drawn in the pose the
  /// solid is in *now* and only pushed further back, so twenty identical
  /// wireframes nested inside each other by perspective and the whole thing
  /// read as one shape falling into a point. The trail has to be the shape as
  /// it *was* — which means remembering how it was turned, once per frame of
  /// history, and rebuilding each copy from its own pose.
  const solidPast = [];
  let solidPushSeen = -1;
  let solidCentroid = 0.5, solidGate = 0;
  /// Which slice of the spectrum each vertex reads, per shape. Worked out once:
  /// it depends only on the solid's rest pose.
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

  /// `slot` names which of the room's paintable things this is, so the palette
  /// can have an opinion about it. Left out — or set to something the palette
  /// says nothing about — the draw takes `cold`/`hot` exactly as it always has.
  ///
  /// `w2` is the second quantity for a ramp to be read against, when this layer
  /// has one worth offering.
  const draw = (mode, pos, wts, count, alpha, round, cold, hot, size, slot, w2) => {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, wBuf);
    gl.bufferData(gl.ARRAY_BUFFER, wts, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(prog.aW);
    gl.vertexAttribPointer(prog.aW, 1, gl.FLOAT, false, 0, 0);
    // **Bound to something, always.** A disabled attribute array keeps whatever
    // was last written to that slot, so a layer with no second quantity would
    // silently colour itself from the previous layer's numbers read as its own.
    if (prog.aW2 >= 0) {
      if (w2 && w2.length >= count) {
        gl.bindBuffer(gl.ARRAY_BUFFER, w2Buf);
        gl.bufferData(gl.ARRAY_BUFFER, w2, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(prog.aW2);
        gl.vertexAttribPointer(prog.aW2, 1, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(prog.aW2);
        gl.vertexAttrib1f(prog.aW2, 0);
      }
    }
    const pt = slot && paints ? paints[slot] : null;
    if (pt) {
      gl.uniform1i(prog.uRampOn, 1);
      gl.uniform1f(prog.uRampV, pt.v);
      gl.uniform1i(prog.uDrive, pt.drive | 0);
      gl.uniform2f(prog.uRange, pt.lo, pt.hi);
      gl.uniform1f(prog.uCurve, pt.curve);
    } else {
      gl.uniform1i(prog.uRampOn, 0);
    }
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
  /// Geometry that *covers* what is behind it instead of adding to it.
  ///
  /// **This is what fog is, and additive blending cannot do it.** Everything
  /// else in this room adds — which is right for light, and wrong for air. Fog
  /// that adds paints its colour over the whole picture, the near things
  /// included, and what you get is a tint on the scene rather than something
  /// the scene is standing in. Ordinary alpha over the top: the fog hides what
  /// is behind it in proportion to how much of it there is.
  const drawOver = (mode, pos, wts, count, alpha, cold, hot, size, slot, w2) => {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    draw(mode, pos, wts, count, alpha, true, cold, hot, size, slot, w2);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  };

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
    // **The second weight, put to a constant here too.** Left as the layer
    // before had it, the slot is still an enabled array over that layer's
    // buffer — shorter than these faces — and a GPU refuses the draw
    // (INVALID_OPERATION) where SwiftShader let it through. The faces were then
    // never written to depth, and occlusion hid nothing on any real screen.
    if (prog.aW2 >= 0) {
      gl.disableVertexAttribArray(prog.aW2);
      gl.vertexAttrib1f(prog.aW2, 0);
    }
    gl.drawArrays(mode, 0, count);
    gl.colorMask(true, true, true, true);
  };

  return {
    /// Where a point in the room lands on the screen, in CSS pixels.
    ///
    /// **The thing a manipulator cannot work without.** A handle has to be
    /// drawn where its object is and hit-tested where the pointer is, and both
    /// are this. `behind` is true for a point behind the eye, whose projection
    /// is meaningless — a caller that draws it anyway gets a handle mirrored
    /// through the centre of the frame, which looks like a bug in the drag.
    project(x, y, z) {
      if (!view) return null;
      const p = vgProjectPoint(view.mvp, x, y, z);
      if (p.w <= 1e-6) return { x: 0, y: 0, behind: true };
      const dpr = view.w / (canvas.clientWidth || view.w);
      return {
        x: (p.x * 0.5 + 0.5) * view.w / dpr,
        y: (1 - (p.y * 0.5 + 0.5)) * view.h / dpr,
        behind: false,
      };
    },

    /// The reverse, at a depth you already know.
    ///
    /// A pointer is two numbers and the room is three, so something has to
    /// supply the third — there is no honest way around it. Given the `z` a
    /// thing is already at, this is exact rather than a guess: the frustum is
    /// invertible in closed form, so dragging a point across the screen moves
    /// it in its own plane and nowhere else, and it stays under the cursor.
    unprojectAtZ(sx, sy, z) {
      if (!view) return null;
      const dpr = view.w / (canvas.clientWidth || view.w);
      const ndcX = (sx * dpr / view.w) * 2 - 1;
      const ndcY = 1 - (sy * dpr / view.h) * 2;
      return vgUnprojectAtZ(view.mvp, ndcX, ndcY, z);
    },

    /// The room's own extents, so a caller can speak in its terms rather than
    /// in world units — the floor, the ceiling, the half-width and the depth.
    extents() {
      if (!view) return null;
      return {
        yb: view.yb, yt: view.yt, halfW: view.halfW,
        near: view.near, far: view.far,
        zAt: (t) => view.geomAt.z - Math.max(0, Math.min(1, t)) * view.geomReach,
        width: view.halfW * 2, reach: view.geomReach, at: view.geomAt,
      };
    },

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
      // **The solid's accumulators too.** They turn *by* the sound rather than
      // to a position, so they hold whatever they reached — which is right for
      // a room being watched and wrong for a film, where it would mean the same
      // export starting from a different angle every time it was run.
      solidZw = 0; solidXw = 0; solidSpinPhase = 0; solidLast = 0; solidGate = 0;
      solidPast.length = 0; solidPushSeen = -1;
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

    /// The trail as it actually stands: how many frames deep, and how wide each
    /// of them is.
    ///
    /// The terrain is a filled surface that always spans the room whatever its
    /// depth — six rows is a coarser mesh over the same ground, not a shorter
    /// one — so no count of lit pixels can tell a deep trail from a shallow
    /// one. Three attempts at measuring it from the picture said the control
    /// did nothing, and all three were measuring something the control does not
    /// change. Same reason `grainShapeNames` exists.
    trail: () => ({ rows: history.length, bands: geomBands, ridge: geomRidge,
      span: geomSpan, body: geomBody }),

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
      const row = new Float32Array(geomBands);
      for (let i = 0; i < geomBands; i++) {
        // Resampled by taking the loudest source band in range. An analyser
        // that averages a tone away is not an analyser, and that is as true of
        // the floor as of the flat one.
        const a = Math.floor(i / geomBands * bands.length);
        const b = Math.max(a + 1, Math.floor((i + 1) / geomBands * bands.length));
        let m = -Infinity;
        for (let k = a; k < b && k < bands.length; k++) if (bands[k] > m) m = bands[k];
        row[i] = Math.max(0, Math.min(1, (m + 96) / 96));
      }
      history.push({ row, liss });
      while (history.length > geomHistory) history.shift();
      pushes++;
    },

    frame(f) {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      // The caller owns the camera, because which camera is right depends on
      // the frame being drawn for and this file has no opinion about that.
      const camIn = vgCamera(f && f.cam);

      // ── what time it is here ──
      //
      // **The wall clock is right for a live room and wrong for a film.**
      // Everything in here that moves on its own — a grain ageing towards the
      // back wall, the fog drifting — was measured against `performance.now()`,
      // which is exactly what a room being watched wants. An offline render is
      // not being watched: it runs as fast as the machine manages, so the gap
      // between one frame and the next is however long the last one took to
      // encode. A frame that took fifty milliseconds aged the cloud by fifty
      // and the next one by five, and what that looks like in the finished file
      // is a stutter — the picture lurching once and carrying on.
      //
      // So a caller that knows what time its frame is at says so, and gets a
      // room that moves by the film's clock rather than by the machine's. A
      // caller that says nothing gets the wall clock, unchanged.
      const clockMs = f && typeof f.clock === 'number'
        ? f.clock * 1000
        : (typeof performance !== 'undefined' ? performance.now() : Date.now());
      // And owns which parts are drawn. Everything, unless told otherwise —
      // a caller that says nothing gets the room it has always had.
      const on = { grid: true, floor: true, lead: true, sky: true, skin: true, grains: true,
        // Off unless asked for: it is a new thing in an old room, and a room that
        // gains an object because it was updated is a room that changed by itself.
        solid: false, ...(f && f.layers) };
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

      // ── the palette ──
      //
      // Off unless asked for, same rule as the fog: a caller that says nothing
      // about colour gets the room's own two, which is the picture this has
      // always drawn.
      // ── the room's shape ──
      //
      // Anything not named keeps the shape the room shipped with, the same rule
      // the fog and the palette follow.
      //
      // **Changing the floor's width throws the trail away.** Every stored row
      // is an array of the old width, and a mesh built from a mix of the two is
      // read off the end of the short ones. Cheaper and more honest to start
      // the terrain again than to resample what is already in the air.
      const g = (f && f.geom) || null;
      if (g) {
        const wantBands = Math.max(8, Math.min(2048, Math.round(g.bands || geomBands)));
        if (wantBands !== geomBands) {
          geomBands = wantBands;
          history.length = 0;
          meshKey = '';
        }
        geomHistory = Math.max(2, Math.min(240, Math.round(g.history || geomHistory)));
        while (history.length > geomHistory) history.shift();
        geomRidge = Math.max(0.02, Math.min(1.6, g.ridge ?? geomRidge));
        geomSpan = Math.max(0.5, Math.min(90, g.span ?? geomSpan));
        geomBody = Math.max(0.002, Math.min(0.3, g.body ?? geomBody));
        geomWidth = Math.max(0.2, Math.min(40, g.width ?? geomWidth));
        geomReach = Math.max(0.2, Math.min(40, g.reach ?? geomReach));
        if (g.at && Number.isFinite(g.at.x) && Number.isFinite(g.at.z)) geomAt = { x: g.at.x, z: g.at.z };
      }

      const paint = (f && f.paint) || null;
      paints = paint && paint.slots ? paint.slots : null;
      if (paint && paint.atlas && paint.version !== rampVersion) {
        gl.bindTexture(gl.TEXTURE_2D, rampTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, VG_RAMP_W, VG_RAMP_ROWS, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, paint.atlas);
        rampVersion = paint.version;
      }
      // Bound whatever happens: the sampler defaults to unit 0 and reading an
      // unbound sampler is undefined, even on the passes that never sample it.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rampTex);
      gl.uniform1i(prog.uRamp, 0);

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
      // **The world camera, whatever shape it arrived in.** A box camera — a
      // film's, a test's — is read as the world camera it maps to; the world
      // camera is what the view is built from. The box the layers still lay
      // themselves along is derived from it: the ground is y = 0, the ceiling
      // is where the box's was above the floor, and the eye stands at
      // `height` looking along its pitch and yaw. See `docs/OPEN-WORLD.md`.
      const wc = vgIsWorld(f && f.cam) ? { ...VG_WORLD_DEFAULT, ...vgWorldUpgrade(f.cam) } : vgWorldFromBox(camIn, aspect);
      const height = wc.height;
      // **World sizes.** The ground is y = 0; the layers' height unit and the
      // terrain's width are sizes in the world, and the camera has no say in
      // them — it is a point with a direction and a field of view, and the
      // picture is only the projection.
      const yb = 0, yt = VG_WORLD_H;
      const halfW = geomWidth / 2;
      const fovT = Math.tan(wc.fov / 2 / VG_DEG);
      // The layers' reach, and the world's: the grid and the fog go on to the
      // horizon, past where the trail and the cloud stop.
      // The terrain's own length and place. The layers that ride on it — the
      // cloud, the mist, the motes — are placed along it; the ring and the
      // solid have places of their own.
      const far = near + geomReach;
      const horizon = VG_HORIZON + Math.hypot(wc.x, wc.z) + geomReach;
      // Sideways off-axis, the same way the vertical one works: the camera does
      // not turn, the frustum slides, so the front face stays square to the
      // frame however far the vanishing point moves.
      const wv = vgWorldView(wc, aspect, near, horizon);
      const mvp = wv.mvp;
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.uMVP, false, mvp);

      // Depth runs 0 at the front to 1 at the back, which is what the shaders
      // fade against.
      const zAt = (t) => geomAt.z - t * geomReach;

      // ── the taper ──
      //
      // The room was a rectangular prism: front and back the same size in world
      // units, with the projection doing all of the narrowing. These let the far
      // rectangle be a different size from the near one, which the perspective
      // then shrinks on top — so the walls can converge past what distance
      // alone does, or splay out against it.
      //
      // Linear in `t` rather than in the projected width, because what is being
      // dragged is where the *back* is and the front is pinned to the canvas
      // edges. At `t = 0` both are one whatever the setting, so the near face
      // still lands exactly on the panel and "the panel is the box" survives.

      // **Kept, so something outside can ask where a world point is.**
      // Nothing could before: the matrix was built here, used and dropped, so a
      // handle drawn over the room had no way to know where to sit. Anything
      // that manipulates the room by grabbing it needs this and its inverse.
      //
      // **Here rather than beside the matrix**, which is twenty lines up and
      // inside `backW`'s dead zone: `const` does not hoist a value, so naming
      // it early threw `Cannot access 'backW' before initialization` on every
      // single frame — and an exception in here is silent, so the room simply
      // stopped drawing with nothing in the console to say why. This project
      // has a note about exactly that trap; I wrote the same one anyway.
      view = { mvp, w, h, near, far, yb, yt, halfW, height, horizon, wc, geomAt, geomReach };
      // The height tapers about the room's own middle, so a shorter back pulls
      // the floor up and the ceiling down together. Tapering about the floor
      // would tilt the room instead of narrowing it, which is the eye line's
      // job and already has a gesture.

      // ── the room ──
      //
      // Only the four runs back and the far rectangle. The near rectangle is
      // the canvas border and drawing it would be a line painted on the bezel.
      // **The ground.** Where the box drew its four runs back and its far wall,
      // the world draws a grid on the ground: lines across at a fixed spacing
      // from the near plane to the horizon, and lines along from as far left as
      // the eye can see at the horizon to as far right. Every fourth line is
      // heavier, so distance can be counted. Light grey — the theme's marks
      // are for the sound; this is the floor they stand on — and, like
      // everything else here, fogged and thinned with distance, so the horizon
      // reads as far rather than as an edge. Its weight is distance, for the
      // palette to read a ramp against.
      const drawGrid = () => {
        // Fixed to the world — a line is at a multiple of the spacing whatever
        // the eye does — and laid out around wherever the eye stands, so
        // walking never reaches an edge of it.
        const step = VG_GRID_STEP;
        const ex = Math.round(wc.x / step) * step, ez = Math.round(wc.z / step) * step;
        const key = `${ex}|${ez}|${VG_HORIZON}`;
        if (key !== gridKey) {
          gridKey = key;
          const R = VG_HORIZON;
          const count = Math.floor((2 * R) / step) + 1;
          const minor = [], major = [];
          const wOf = (dx, dz) => Math.min(1, Math.hypot(dx, dz) / R);
          for (let i = 0; i < count; i++) {
            const z = ez - R + i * step;
            const n = Math.round(z / step);
            (n % 4 === 0 ? major : minor).push(ex - R, 0, z, wOf(R, z - ez), ex + R, 0, z, wOf(R, z - ez));
          }
          for (let i = 0; i < count; i++) {
            const x = ex - R + i * step;
            const n = Math.round(x / step);
            (n % 4 === 0 ? major : minor).push(x, 0, ez - R, wOf(x - ex, R), x, 0, ez + R, wOf(x - ex, R));
          }
          const pack = (list) => {
            const count = list.length / 4;
            const pos = new Float32Array(count * 3);
            const wts = new Float32Array(count);
            for (let i = 0; i < count; i++) {
              pos[i * 3] = list[i * 4]; pos[i * 3 + 1] = list[i * 4 + 1]; pos[i * 3 + 2] = list[i * 4 + 2];
              wts[i] = list[i * 4 + 3];
            }
            return { pos, wts, count };
          };
          gridMinor = pack(minor);
          gridMajor = pack(major);
        }
        const grey = [0.62, 0.66, 0.70];
        draw(gl.LINES, gridMinor.pos, gridMinor.wts, gridMinor.count, 0.14, false, grey, grey, 1, 'grid');
        draw(gl.LINES, gridMajor.pos, gridMajor.wts, gridMajor.count, 0.30, false, grey, grey, 1, 'grid');
      };

      // ── the landscape ──
      //
      // The floor is a surface, not a set of wires: every pair of neighbouring
      // frames is joined into a strip, so what you are looking at is terrain
      // with the newest ridge at the near edge and everything before it running
      // away to the back wall.
      const rows = history.length;
      // Both take the row's depth now: the floor narrows with the walls and
      // the ridges stand on it rather than through it.
      const ridgeY = (v) => yb + v * (yt - yb) * geomRidge;
      const xAt = (i) => geomAt.x + ((i / (geomBands - 1)) * 2 - 1) * halfW;
      // Against the room's full depth, not against however many frames happen to
      // be in hand. Dividing by `rows` made a half-filled trail span the whole
      // room and then crawl backwards as it filled — the trail should *grow*
      // into the room from the near edge and reach the back wall when it is
      // full, which is what a fixed step per frame gives.
      const ageOf = (r) => (rows - 1 - r) / Math.max(1, geomHistory - 1);

      const drawFloor = () => {
        if (rows <= 1) return;
        // The floor's width is in the key: change it and every stored row is
        // the wrong length, so a cached mesh built from the old ones would be
        // read past its end.
        const key = `${pushes}|${rows}|${geomBands}|${halfW.toFixed(4)}`;
        if (key !== meshKey) {
          meshKey = key;
          meshRows = rows - 1;
          const per = geomBands * 2;
          const pos = new Float32Array(meshRows * per * 3);
          const wts = new Float32Array(meshRows * per);
          // The band's frequency, for a surface coloured by pitch rather than
          // by loudness. Uploaded with the mesh, so it costs nothing per frame.
          const hz = new Float32Array(meshRows * per);
          let v = 0;
          for (let r = 0; r < meshRows; r++) {
            const a = history[r].row, b = history[r + 1].row;
            const ta = ageOf(r), tb = ageOf(r + 1);
            const za = zAt(ta), zbb = zAt(tb);
            for (let i = 0; i < geomBands; i++) {
              const fr = i / (geomBands - 1);
              pos[v * 3] = xAt(i, ta); pos[v * 3 + 1] = ridgeY(a[i], ta); pos[v * 3 + 2] = za;
              wts[v] = a[i]; hz[v] = fr; v++;
              pos[v * 3] = xAt(i, tb); pos[v * 3 + 1] = ridgeY(b[i], tb); pos[v * 3 + 2] = zbb;
              wts[v] = b[i]; hz[v] = fr; v++;
            }
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, meshPosBuf);
          gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, meshWBuf);
          gl.bufferData(gl.ARRAY_BUFFER, wts, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, meshW2Buf);
          gl.bufferData(gl.ARRAY_BUFFER, hz, gl.DYNAMIC_DRAW);
        }
        // One upload, many draws: a strip per pair, so the near ones are laid
        // over the far ones without a depth buffer.
        gl.bindBuffer(gl.ARRAY_BUFFER, meshPosBuf);
        gl.enableVertexAttribArray(prog.aPos);
        gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, meshWBuf);
        gl.enableVertexAttribArray(prog.aW);
        gl.vertexAttribPointer(prog.aW, 1, gl.FLOAT, false, 0, 0);
        if (prog.aW2 >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, meshW2Buf);
          gl.enableVertexAttribArray(prog.aW2);
          gl.vertexAttribPointer(prog.aW2, 1, gl.FLOAT, false, 0, 0);
        }
        gl.uniform1f(prog.uRound, 0);
        gl.uniform1f(prog.uPointSize, 1);
        gl.uniform3fv(prog.uCold, f.cold);
        gl.uniform3fv(prog.uHot, f.hot);
        // The surface takes its own place in the palette. It and the ridges
        // over it were locked to one pair of colours, which is why the two read
        // as one thing however either was set.
        const mp = paints && paints.terrainMesh;
        if (mp) {
          gl.uniform1i(prog.uRampOn, 1);
          gl.uniform1f(prog.uRampV, mp.v);
          gl.uniform1i(prog.uDrive, mp.drive | 0);
          gl.uniform2f(prog.uRange, mp.lo, mp.hi);
          gl.uniform1f(prog.uCurve, mp.curve);
        } else {
          gl.uniform1i(prog.uRampOn, 0);
        }
        const per = geomBands * 2;
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
        if (!floorPos || floorPos.length !== geomBands * 3) {
          floorPos = new Float32Array(geomBands * 3);
          floorW = new Float32Array(geomBands);
        }
        // Where each band sits across the spectrum, nought to one. Constant for
        // the life of the room, so it is filled once rather than per ridge —
        // there are fifty-six of them a frame.
        if (!floorHz || floorHz.length !== geomBands) {
          floorHz = new Float32Array(geomBands);
          for (let i = 0; i < geomBands; i++) floorHz[i] = i / (geomBands - 1);
        }
        // Every ridge is its own draw call with two buffer uploads behind it,
        // and there are fifty-six of them — the same arithmetic that made the
        // rings expensive, in the other half of the room. The ones at the back
        // are within a few pixels of each other and already faded; drawing
        // every third one there is not visible and drawing all of them is a
        // third of the frame.
        for (let r = rows - 1; r >= 0; r -= 1 + Math.floor(ageOf(r) * 2.4)) {
          const row = history[r].row;
          const age = ageOf(r);
          const z = zAt(age);
          for (let i = 0; i < geomBands; i++) {
            floorPos[i * 3] = xAt(i, age);
            floorPos[i * 3 + 1] = ridgeY(row[i], age);
            floorPos[i * 3 + 2] = z;
            floorW[i] = row[i];
          }
          draw(gl.LINE_STRIP, floorPos, floorW, geomBands,
            0.34 + (1 - age) * 0.5, false, f.cold, f.hot, 1,
            'terrainRidge', floorHz);
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
        const n2 = geomBands * 2;
        if (!leadPos || leadPos.length !== n2 * 3) {
          leadPos = new Float32Array(n2 * 3);
          leadW = new Float32Array(n2);
          // Two vertices a band — the top and the bottom of the ribbon — and
          // both are the same frequency.
          leadHz = new Float32Array(n2);
          for (let i = 0; i < geomBands; i++) {
            const hz = i / (geomBands - 1);
            leadHz[i * 2] = hz; leadHz[i * 2 + 1] = hz;
          }
        }
        for (let i = 0; i < geomBands; i++) {
          const x = xAt(i, 0), y = ridgeY(now[i], 0);
          leadPos[i * 6] = x; leadPos[i * 6 + 1] = y - camIn.lead; leadPos[i * 6 + 2] = z;
          leadPos[i * 6 + 3] = x; leadPos[i * 6 + 4] = y + camIn.lead; leadPos[i * 6 + 5] = z;
          leadW[i * 2] = now[i]; leadW[i * 2 + 1] = now[i];
        }
        draw(gl.TRIANGLE_STRIP, leadPos, leadW, n2, 1.0, false, f.cold, f.hot, 1,
          'lead', leadHz);
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
        const nowMs = clockMs;
        const dt = grainClock ? Math.min(0.25, (nowMs - grainClock) / 1000) : 0;
        grainClock = nowMs;

        // Age everyone, and bury whoever has reached the wall.
        if (dt > 0) {
          const step = dt / geomSpan;
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
                life: Math.max(0.004, (e[2] / sr) / geomSpan) * vel,
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
                // What its mist wanders by. Fixed here, like everything else
                // about it.
                mist: h2 ^ 0x5bf03635,
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
            // Where each grain is panned. Nought hard left, one hard right.
            // Everything else a grain could colour by is already a varying —
            // its loudness is the weight, its pitch is its height in the room,
            // how long ago it sounded is its depth. Pan is the one that is not.
            grainW2 = new Float32Array(VG_GRAIN_CAP);
            grainLineW2 = new Float32Array(VG_GRAIN_LINE_CAP);
            grainFillW2 = new Float32Array(VG_GRAIN_FILL_CAP);
            mistW2 = new Float32Array(VG_MIST_CAP);
          }
          // A grain is a solid standing in the room, so its size is measured
          // against the room's height and not against the frustum's width — a
          // grain that swelled every time the panel was widened would be
          // describing the panel and not the sound.
          const rad = (yt - yb) * geomBody;
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
            // A grain travels with the walls: held inside the box at every
            // depth rather than inside the box the front face describes. A
            // cloud that kept the front's width in a room whose back has been
            // pulled in would spill through the walls on its way to the wall.
            const x = geomAt.x + fx * halfW;
            const y = yb + (yt - yb) * (0.5 + fy);
            const z = zAt(a0);
            // Hot when it lands, cooling as it goes.
            const lit = Math.min(1, p.w * (1 + VG_GRAIN_FLASH
              * Math.exp(-a0 * VG_GRAIN_FLASH_FALL)));
            // Across the room is pan, which is what `fx` is: the schedule's own
            // pan with the grain's scatter on top. Folded to nought..one here
            // because that is the range a ramp is read over.
            const pan = fx * 0.5 + 0.5;

            grainPos[n * 3] = x; grainPos[n * 3 + 1] = y; grainPos[n * 3 + 2] = z;
            grainW[n] = lit;
            grainW2[n] = pan;
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
                grainFillW2[fn] = pan;
                fn++;
              }
            }

            // ── what drips off it ──
            if (misting && sn < VG_MIST_CAP - mistCount) {
              // Its own wander, so two grains side by side do not shed the same
              // shape. Drawn from bits of the hash nothing else is using.
              // **Its own number, not its place in the list.**
              //
              // This was seeded from `i`, the index into `grainLive` — and that
              // array is compacted every frame as grains reach the wall
              // (`grainLive[keep++] = p`), so a grain's index shifts under it
              // the moment anything ahead of it dies. Its mist then jumped
              // sideways to wherever the new index put it: soft orbs that
              // appear, and then relocate, over and over through a render.
              //
              // The same fault as a grain changing shape in mid-air, and the
              // same lesson: nothing about a grain may be derived from where it
              // happens to sit in a list.
              const mh = p.mist;
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
                mistPos[sn * 3] = geomAt.x + Math.max(-1.02, Math.min(1.02, fxk + wob)) * halfW;
                mistPos[sn * 3 + 1] = yb + (yt - yb) * (0.5 + Math.max(-0.55,
                  Math.min(0.55, fyk)));
                mistPos[sn * 3 + 2] = zAt(back);
                // Thinning as it falls, so it fades out rather than stopping —
                // but not to nothing at the top. A trail that starts at half
                // weight and ends at zero is faint along its whole length, and
                // faint over a black room is not there at all.
                mistW[sn] = lit * (1 - t2 * 0.75);
                mistW2[sn] = pan;
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
              grainLineW2[ln] = pan;
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
                f.cold, f.core, 12, 'mist', mistW2);
              draw(gl.POINTS, mistPos, mistW, sn, a(thick * 0.55), true,
                f.cold, f.core, 30, 'mist', mistW2);
              // A third, very large and very faint, which is what turns a run
              // of sprites into a body of smoke rather than a string of puffs.
              draw(gl.POINTS, mistPos, mistW, sn, a(thick * 0.22), true,
                f.cold, f.core, 64, 'mist', mistW2);
              drawSoft = false;
            }
            // The skins first, so every wire lands on top of them — including
            // the far ones, which is what keeps a filled grain readable as a
            // solid you can see into rather than a lump.
            if (fn) {
              if (fillBg) drawDark(gl.TRIANGLES, grainFillPos, grainFillW, fn, 0.88);
              else draw(gl.TRIANGLES, grainFillPos, grainFillW, fn, a(0.5), false,
                fillRgb, fillRgb, 1, 'grainFill', grainFillW2);
            }
            draw(gl.POINTS, grainPos, grainW, n, a(0.07), true, f.cold, f.core, 11,
              'grainBloom', grainW2);
            if (ln) draw(gl.LINES, grainLinePos, grainLineW, ln, a(0.5), false,
              f.cold, f.core, 1, 'grainWire', grainLineW2);
            draw(gl.POINTS, grainPos, grainW, n, a(0.3), true, f.core, f.hot, 2,
              'grainCore', grainW2);
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
        const skyY = wc.ring.y;
        const r0 = wc.ring.size;
        // ── how many points *this* ring needs ──
        //
        // **Not all of them get the full count.** The trail is fifty-six rings
        // deep and only the nearest one is anywhere near the size of the frame;
        // the rest are receding and the furthest is a third of the width of the
        // front. Building every one of them at a thousand points, twice over
        // for the skin and the hoops, and again for the border, is a third of a
        // million vertex writes and a hundred and seventy draw calls a frame.
        // Full screen fell to between one and three frames a second — which
        // does not read as a slow visual, it reads as a mouse that has stopped
        // working.
        //
        // The leading ring keeps everything, because it is the one being looked
        // at. The rest fall away with distance, which is the same argument the
        // grain shapes make about detail nobody can see.
        const ptsAt = (age) => Math.max(64,
          Math.round(pts * (0.28 + 0.72 * (1 - age))) & ~1);
        // The skin is one count for every band, because a band joins two rings
        // and the two have to have the same number of points to be joined at
        // all. A surface needs far fewer than an outline does.
        const skinPts = Math.max(64, Math.min(pts, 256));
        // ── and how many of the rings are drawn at all ──
        //
        // **Fifty-six rings, three passes each.** A band of skin, a hoop, and a
        // dark border under the hoop — and every one of those is its own draw
        // call with two buffer uploads behind it, so the trail alone was a
        // hundred and seventy draws and three hundred and forty uploads a
        // frame. In the dock that is affordable. Full screen it was half of an
        // eighty-millisecond frame, and a room at thirteen frames a second is
        // not a slow visual, it is a mouse that has stopped working.
        //
        // The rings at the back are stacked within a few pixels of each other —
        // the easing has already faded them and the perspective has already
        // shrunk them together. Drawing every third one there is not visible;
        // drawing all of them is most of the cost.
        const strideAt = (age) => 1 + Math.floor(age * 2.4);
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
          // How wide the stereo image is at each point of the ring. Already
          // worked out to place the point and thrown away until now.
          skyW2 = new Float32Array(cap);
          skyPrevW2 = new Float32Array(cap);
          skyBandW2 = new Float32Array(cap * 2);
        }

        /// One ring, into the buffers given. False when that frame has no
        /// figure to build one from. Returns how many points it wrote.
        const ringInto = (r, pos, wts, count, w2) => {
          const liss = history[r].liss;
          if (!liss) return false;
          const n = count || pts;
          // Named, because the taper needs it as well as the depth does.
          const age = ageOf(r);
          const z = wc.ring.z - age * geomReach;
          for (let i = 0; i <= n; i++) {
            const k = i % n;                   // closed, so the
            const th = (k / n) * Math.PI * 2;  // last point is the first
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
            const u = k / n;
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
            // The hoop narrows with the room and keeps its centre on the
            // room's own axis, so a tapered box has the trail running down its
            // middle rather than out through the ceiling.
            pos[i * 3] = wc.ring.x + Math.cos(th) * rad;
            pos[i * 3 + 1] = skyY + Math.sin(th) * rad;
            pos[i * 3 + 2] = z;
            wts[i] = Math.min(1, 0.25 + Math.abs(mid) * 1.6);
            // Nought is mono, one is as wide as this figure gets. `side` is
            // signed — which channel leads — and what reads as width is how far
            // from the middle it is either way.
            if (w2) w2[i] = Math.min(1, Math.abs(side) * 2.4);
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
        for (let r = rows - 1; wantSkin && r >= 0; r -= strideAt(ageOf(r))) {
          const ok = ringInto(r, skyPos, skyW, skinPts, skyW2);
          if (ok && havePrev) {
            for (let i = 0; i <= skinPts; i++) {
              skyBand[i * 6] = skyPrev[i * 3];
              skyBand[i * 6 + 1] = skyPrev[i * 3 + 1];
              skyBand[i * 6 + 2] = skyPrev[i * 3 + 2];
              skyBand[i * 6 + 3] = skyPos[i * 3];
              skyBand[i * 6 + 4] = skyPos[i * 3 + 1];
              skyBand[i * 6 + 5] = skyPos[i * 3 + 2];
              skyBandW[i * 2] = skyPrevW[i];
              skyBandW[i * 2 + 1] = skyW[i];
              skyBandW2[i * 2] = skyPrevW2[i];
              skyBandW2[i * 2 + 1] = skyW2[i];
            }
            const age = ageOf(r);
            // Well under the lines' own alpha. A skin at full strength buries
            // the hoops it is made of, and the hoops are the reading — this is
            // the body between them, not a replacement for them.
            const a = 0.16 * (1 - age * 0.7) * Math.max(0, easeAt(age));
            if (a > 0.002) {
              draw(gl.TRIANGLE_STRIP, skyBand, skyBandW, (skinPts + 1) * 2, a, false,
                f.core, f.hot, 1, 'skin', skyBandW2);
            }
          }
          if (ok) {
            skyPrev.set(skyPos.subarray(0, (skinPts + 1) * 3));
            skyPrevW.set(skyW.subarray(0, skinPts + 1));
            skyPrevW2.set(skyW2.subarray(0, skinPts + 1));
            havePrev = true;
          }
        }

        // ── the hoops ──
        for (let r = rows - 1; wantSky && r >= 0; r -= strideAt(ageOf(r))) {
          const age = ageOf(r);
          const lead = r === rows - 1;
          // The one being looked at keeps every point it was asked for.
          const rn = lead ? pts : ptsAt(age);
          if (!ringInto(r, skyPos, skyW, rn, skyW2)) continue;

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
          // The border is what separates one hoop from the one behind it, and
          // by the back of the room there is nothing left to separate: the
          // easing has faded them and they are a few pixels apart. Near ones
          // only.
          if (edge > 0 && age < 0.45) {
            const w = r0 * edge;
            for (let i = 0; i <= rn; i++) {
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
            if (dark > 0.004) {
              drawDark(gl.TRIANGLE_STRIP, skyBand, skyBandW, (rn + 1) * 2, dark);
            }
          }
          // **No beads.** The leading ring used to carry a point sprite at
          // every vertex, to give the frame being heard now the weight the
          // floor's leading ridge has. On a curve they are nodes: they mark
          // where the samples happen to fall, which is an artefact of the
          // analyser's block size and says nothing whatever about the sound.
          // The line is drawn at full alpha instead, which is the same emphasis
          // without the dots.
          draw(gl.LINE_STRIP, skyPos, skyW, rn + 1,
            lead ? 1.0 : (0.28 + (1 - age) * 0.5) * Math.max(0, easeAt(age)),
            false, f.core, f.hot, 1, 'ring', skyW2);
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
        const t = clockMs / 1000;
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
          const x = geomAt.x + (hx * 2.6 + Math.sin(t * drift + hz * 9.0) * 0.06) * halfW;
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
        // **Back to front.** Alpha blending is order-dependent in a way
        // additive never was: a near mote has to be laid over a far one, or the
        // far one covers it and the haze has no depth in it at all. Nothing
        // else in this room needed sorting, because addition does not care.
        const order2 = new Array(motes);
        for (let i = 0; i < motes; i++) order2[i] = i;
        order2.sort((a, b) => fogPos[a * 3 + 2] - fogPos[b * 3 + 2]);
        const sorted = new Float32Array(motes * 3);
        const sortedW = new Float32Array(motes);
        for (let i = 0; i < motes; i++) {
          const j = order2[i];
          sorted[i * 3] = fogPos[j * 3];
          sorted[i * 3 + 1] = fogPos[j * 3 + 1];
          sorted[i * 3 + 2] = fogPos[j * 3 + 2];
          sortedW[i] = fogW[j];
        }
        fogPos.set(sorted.subarray(0, motes * 3));
        fogW.set(sortedW.subarray(0, motes));

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
        drawOver(gl.POINTS, fogPos, fogW, motes, 0.11 * strength, rgb, rgb, 48, 'fog');
        drawOver(gl.POINTS, fogPos, fogW, motes, 0.07 * strength, rgb, rgb, 104, 'fog');
        drawOver(gl.POINTS, fogPos, fogW, motes, 0.04 * strength, rgb, rgb, 190, 'fog');
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
      // ── the solid ──────────────────────────────────────────────────────────
      //
      // **A four-dimensional solid, turned by the sound.**
      //
      // The ring is a circle pushed out of round; this is the same idea one
      // dimension up. A tesseract's shadow in three dimensions depends on how
      // it is turned in *four* — rotate it through ZW and its two cubes pass
      // through each other and change places. No amount of turning it in three
      // does that, which is the whole reason for drawing one.
      //
      // So the sound drives the fourth-dimensional turn. XY and YZ tick over
      // on the clock, slowly and steadily, so it always reads as an object;
      // **ZW is driven by level**, and that is the one you see. A quiet passage
      // barely moves it. A loud one turns it inside out.
      //
      // The spectrum then pushes the vertices out along their own directions,
      // the way it pushes the ring out of round — so the shape breathes as well
      // as turning. Each vertex takes a fixed band rather than one chosen by
      // where it currently is, because a vertex that re-picks its band as the
      // solid turns flickers between two unrelated numbers.
      // ── the solid ──────────────────────────────────────────────────────────
      //
      // **Every edge is the waveform, drawn along it.** Not a shape the sound
      // nudges — the line itself *is* the trace, the way an oscilloscope draws
      // one. A tesseract has thirty-two edges, so you get the same waveform
      // thirty-two times, once down each edge. That is the whole idea and the
      // two earlier attempts both missed it: the first turned a rigid solid and
      // called the rotation the music; the second pushed the vertices out
      // radially, which is the ring's trick and not this one.
      //
      // **It is not the ring and does not live where the ring lives.** Its own
      // size, its own height, its own depth, its own controls. They do similar
      // things; they are not the same thing, and stacking one on the other made
      // both illegible.
      const drawSolid = () => {
        const key = (f && f.solidShape) || 'cell8';
        // Both catalogues, through one door — see `vgSolidShape`.
        const found = vgSolidShape(key);
        if (!found || !found.shape.verts.length) return;
        const { shape, is4d } = found;

        const rows = history.length;
        if (!rows) return;

        // How hard the sound turns it through the fourth dimension, and how far
        // the trace swings off each edge.
        const spin = Math.max(0, Math.min(8,
          f && typeof f.solidSpin === 'number' ? f.solidSpin : 1));
        const swell = Math.max(0, Math.min(2,
          f && typeof f.solidSwell === 'number' ? f.solidSwell : 0.6));

        // ── where it is, and how big — nothing to do with the ring ──
        const size = (yt - yb) * Math.max(0.04, Math.min(0.9,
          f && typeof f.solidSize === 'number' ? f.solidSize : 0.3));
        // ── the path it travels ────────────────────────────────────────────
        //
        // **Not a straight run back.** The trail used to recede down the room's
        // own axis and nothing else, so every copy sat on one line and the only
        // thing that changed was distance. A path lets the front be somewhere
        // different from the end, with waypoints between, so the shape travels
        // through the room rather than falling away from the camera.
        //
        // A point is `{ x, y, z }` in the room's own terms: `x` from -1 at the
        // left wall to 1 at the right, `y` from 0 on the floor to 1 at the
        // ceiling, `z` from 0 at the near face to 1 at the back wall. Two
        // points is a straight line; add more and it curves through them.
        const path = (f && Array.isArray(f.solidPath) && f.solidPath.length >= 2)
          ? f.solidPath
          : [{ x: 0, y: 0.42, z: -1.152 }, { x: 0, y: 0.42, z: -2.9 }];

        /// Where on the path a copy of a given age stands.
        ///
        /// Catmull-Rom through the points — the same spline the ring reads its
        /// trace with, and for the same reason: it passes through every point
        /// given rather than near it, so a waypoint is somewhere the shape
        /// actually goes. The ends are clamped by repeating the first and last,
        /// which keeps a two-point path exactly straight.
        const pathAt = (t) => {
          const n = path.length;
          const u = Math.max(0, Math.min(0.99999, t)) * (n - 1);
          const i = Math.floor(u), fr = u - i;
          const P = (k) => path[Math.max(0, Math.min(n - 1, k))];
          const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
          const cr = (p, q, r2, s2) => 0.5 * (2 * q
            + (-p + r2) * fr
            + (2 * p - 5 * q + 4 * r2 - s2) * fr * fr
            + (-p + 3 * q - 3 * r2 + s2) * fr * fr * fr);
          return {
            x: cr(a.x, b.x, c.x, d.x),
            y: cr(a.y, b.y, c.y, d.y),
            z: cr(a.z, b.z, c.z, d.z),
          };
        };

        // ── how it is turned ──
        const newest = history[rows - 1];
        const row = newest && newest.row;
        let level = 0;
        if (row && row.length) {
          for (let i = 0; i < row.length; i++) level += row[i];
          level /= row.length;
        }
        const dt = Math.max(0, Math.min(0.1, (clockMs - solidLast) / 1000));
        solidLast = clockMs;
        // Turned *by* the sound rather than to a position, so it keeps whatever
        // it reached and simply stops turning when the sound does — a flywheel
        // rather than a needle snapping back to rest.
        solidGate += (Math.min(1, level * 3) - solidGate)
          * (1 - Math.exp(-dt / (level * 3 > solidGate ? 0.08 : 0.45)));
        solidZw += dt * spin * solidGate * 0.7;
        solidXw += dt * spin * solidGate * 0.23;
        solidSpinPhase += dt * (0.05 + 0.3 * solidGate);

        const angles = vgSolidAngles(shape.verts[0].length, solidSpinPhase, solidZw, solidXw);
        // One pose per frame of history, recorded as the trail advances.
        if (pushes !== solidPushSeen) {
          solidPushSeen = pushes;
          solidPast.push({ ...angles });
          while (solidPast.length > geomHistory) solidPast.shift();
        }

        const eye = Math.max(1.4, Math.min(8, f && f.solidEye ? f.solidEye : 2.5));
        /// The shape as it stood at one frame on the trail.
        const poseAt = (ang) => vgSolidPose(shape, is4d, ang, eye);

        // ── the buffers ──
        //
        // Enough pieces per edge to resolve a waveform, and fewer where there
        // are hundreds of edges — the 600-cell's are shorter than the detail
        // would be, and 720 edges at sixty-four apiece is a wall of line.
        const ne = shape.edges.length;
        const seg = ne <= 40 ? 64 : ne <= 120 ? 28 : 10;
        const per = ne * seg * 2;
        if (!solidPos || solidPos.length !== per * 3) {
          solidPos = new Float32Array(per * 3);
          solidW = new Float32Array(per);
          solidW2 = new Float32Array(per);
        }

        // The hoops' own easing and stride, which live inside `drawRings`.
        const strideAt = (age) => 1 + Math.floor(age * 2.4);
        const easeAt = (age) => 1 - Math.pow(Math.max(0, age - 0.34) / 0.66, 1.6);

        /// One copy of the whole wireframe, every edge carrying the trace.
        const solidInto = (liss, age, flat, turned, ox, oy, oz) => {
          let v = 0;
          for (let e = 0; e < ne; e++) {
            const pair = shape.edges[e];
            const A = flat[pair[0]], B = flat[pair[1]];
            const wA = turned[pair[0]][3] || 0, wB = turned[pair[1]][3] || 0;
            // The edge's own direction, and two directions across it. The
            // trace swings off the line in these — mid one way, side the
            // other — so each edge carries the stereo figure rather than a
            // flattened copy of it.
            let dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
            const dl = Math.hypot(dx, dy, dz) || 1;
            dx /= dl; dy /= dl; dz /= dl;
            const ux = Math.abs(dy) < 0.9 ? 0 : 1, uy = Math.abs(dy) < 0.9 ? 1 : 0;
            let n1x = dy * 0 - dz * uy, n1y = dz * ux - dx * 0, n1z = dx * uy - dy * ux;
            const n1l = Math.hypot(n1x, n1y, n1z) || 1;
            n1x /= n1l; n1y /= n1l; n1z /= n1l;
            const n2x = dy * n1z - dz * n1y, n2y = dz * n1x - dx * n1z, n2z = dx * n1y - dy * n1x;
            // How far the trace swings off the line, as a share of the solid.
            const amp = size * 0.42 * swell;

            let px = 0, py = 0, pz = 0, pw = 0, pm = 0, have = false;
            for (let k = 0; k <= seg; k++) {
              const t = k / seg;
              // **The same run of waveform down every edge.** `t` is where you
              // are along this edge and nothing else, so all thirty-two edges
              // draw the same trace — which is what makes it read as one
              // signal wrapped round a shape rather than as noise.
              let l = 0, rr = 0;
              if (liss) {
                const q = t * (VG_LISS_POINTS - 1);
                const i1 = Math.floor(q), fr = q - i1;
                const at = (o) => Math.max(0, Math.min(VG_LISS_POINTS - 1, i1 + o)) * 2;
                const a0 = at(-1), b0 = at(0), c0 = at(1), d0 = at(2);
                const spline = (a, b, c, d) => 0.5 * (2 * b
                  + (-a + c) * fr
                  + (2 * a - 5 * b + 4 * c - d) * fr * fr
                  + (-a + 3 * b - 3 * c + d) * fr * fr * fr);
                l = spline(liss[a0], liss[b0], liss[c0], liss[d0]);
                rr = spline(liss[a0 + 1], liss[b0 + 1], liss[c0 + 1], liss[d0 + 1]);
              }
              const mid = (l + rr) * 0.5, side = (l - rr) * 0.5;
              // Down the edge, then off it by the trace.
              const bx = (A[0] + (B[0] - A[0]) * t) * size;
              const by = (A[1] + (B[1] - A[1]) * t) * size;
              const bz = (A[2] + (B[2] - A[2]) * t) * size;
              const x = bx + (n1x * mid + n2x * side) * amp;
              const y = by + (n1y * mid + n2y * side) * amp;
              const z = bz + (n1z * mid + n2z * side) * amp;
              const w4 = wA + (wB - wA) * t;
              const lit = Math.min(1, 0.2 + Math.abs(mid) * 1.8);
              if (have) {
                solidPos[v * 3] = ox + px;
                solidPos[v * 3 + 1] = oy + py;
                solidPos[v * 3 + 2] = oz + pz; solidW[v] = pm;
                solidW2[v] = pw * 0.32 + 0.5; v++;
                solidPos[v * 3] = ox + x;
                solidPos[v * 3 + 1] = oy + y;
                solidPos[v * 3 + 2] = oz + z; solidW[v] = lit;
                solidW2[v] = w4 * 0.32 + 0.5; v++;
              }
              px = x; py = y; pz = z; pw = w4; pm = lit; have = true;
            }
          }
          return v;
        };

        // ── the trail ──
        //
        // The whole shape, redrawn as it was at each frame of history — every
        // edge, in the pose it held then, carrying the sound of that moment.
        // The stride and the easing are the hoops', so it thins the way the
        // rest of the room does.
        for (let r = rows - 1; r >= 0; r -= strideAt(ageOf(r))) {
          const hist = history[r];
          if (!hist) continue;
          const age = ageOf(r);
          const lead = r === rows - 1;
          const a = (lead ? 0.95 : 0.30) * Math.max(0, easeAt(age));
          if (a <= 0.003) continue;
          // **Its own pose, not today's.** `back` counts frames from the newest;
          // the pose list is walked from its own end so the two stay lined up
          // however either was trimmed.
          const back = rows - 1 - r;
          const i = solidPast.length - 1 - back;
          const pose = poseAt(i >= 0 ? solidPast[i] : angles);
          // Where on the path this one stands, in the room's own coordinates.
          // The sideways offset narrows with the room, so a path that runs to
          // the left wall still meets it at the back rather than passing
          // through it.
          const at = pathAt(age);
          // A place in the world, in units.
          const ox = at.x;
          const oy = at.y;
          const oz = at.z;
          const v = solidInto(hist.liss, age, pose.flat, pose.turned, ox, oy, oz);
          if (!v) continue;
          draw(gl.LINES, solidPos, solidW, v, a, false, f.cold, f.hot, 1, 'polytope', solidW2);
        }
      };

      const LAYER_DRAW = {
        grid: drawGrid,
        floor: drawFloor,
        lead: drawLead,
        grains: () => drawGrains(!!occ.grains),
        solid: drawSolid,
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
