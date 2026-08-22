// The room, built out of ridgelines.
//
// See `docs/ROOM-3D.md`. The stacked lines of the sleeve, laid on the five
// surfaces of a room in perspective — floor, ceiling, both walls, and the back
// wall — with the sound driving all of them at once.
//
// **A third module beside the other two, not a replacement for either.** The
// room in `vis-gl.js` and the ridgeline in `ridge.js` are untouched by this file
// and keep working exactly as they did; this is another entry in `VIS_MODULES`
// answering the same four-method contract. That is deliberate: the two that work
// are not put on the table to build a third.
//
// ── why an engine, and what it actually buys ──
//
// One thing, and it is the thing the whole feature turns on: **the depth
// buffer**. `ridge.js` hides the lines behind by filling under each one and
// drawing near-to-far — a painter's algorithm, which works because the stack is
// flat and the order is known. Lay that stack on five surfaces facing five
// directions and there is no single order to draw them in: the ceiling's near
// rows are the floor's far ones, and a wall's rows cross both. Sorting that by
// hand, per surface, per camera angle, is the whole problem.
//
// A depth buffer does it for nothing. Each ridge is a solid ribbon standing off
// its surface, every surface is drawn in any order, and what is in front is in
// front. That is why this is worth an engine and the flat stack never was.

/// The room, and what is drawn on it.
const R3_DEFAULTS = {
  /// Which surfaces carry a ridgeline. The back wall is the sleeve itself —
  /// rows stacking upward — and the other four run away from you into the room.
  floor: true,
  ceiling: true,
  left: true,
  right: true,
  back: true,
  /// How deep the room is, against a width and height of two.
  depth: 4.2,
  /// How many rows each surface holds, and how many samples make a row.
  rows: 44,
  points: 160,
  /// How far a peak stands off its surface, against the room's half-width.
  ///
  /// **Small.** The surfaces face each other, so a peak on the floor grows
  /// towards the ceiling's and a wall's grows towards the far wall's. At half
  /// the half-width they meet in the middle and the room stops reading as a
  /// room — it becomes a symmetrical knot with no inside. A fifth is enough to
  /// see relief on every surface and still have air in the middle.
  over: 0.22,
  /// How much of a surface the lines run across, leaving flat margins.
  span: 0.88,
  /// How hard the sound is pulled to the middle of each row.
  window: 0.72,
  /// Across the samples of a row, on arrival.
  smooth: 2,
  /// How hard the sound drives the height.
  gain: 1,
  /// Below this is silence and is drawn flat — the same floor the flat stack
  /// has, and for the same reason. See `docs/RIDGELINE.md`.
  floorLevel: 0.004,
  /// Where the camera stands and what it looks at, along the room's length.
  /// **Outside the room, looking in.** The mouth of the room is two units
  /// across at `z = 0`; at a vertical field of 0.8 the camera has to stand about
  /// two and a half back for that opening to fit the frame. Closer and it is
  /// not a room you are looking into, it is a room you are inside, with the
  /// near edges of all five surfaces sweeping past the lens.
  eye: 2.0,
  lift: 0.34,
  aim: 0.42,
  fov: 0.85,
};

/// The five surfaces, as a basis each.
///
/// `o` is a corner, `u` runs across the ridgeline, `v` is the way the rows
/// travel, and `n` is the way a peak stands off. Everything else is these four
/// vectors — one mesh builder serves all five because a surface is only ever
/// this much information.
///
/// **The back wall is the odd one and is the point.** On the other four `v` is
/// depth, so rows are born at your feet and run away into the room. On the back
/// wall there is no depth left to run into, so `v` is *up*: rows are born at the
/// bottom and climb, which is the sleeve, in place, at the end of the room.
function r3Surfaces(d) {
  return {
    floor: { o: [-1, -1, 0], u: [2, 0, 0], v: [0, 0, d], n: [0, 1, 0] },
    ceiling: { o: [-1, 1, 0], u: [2, 0, 0], v: [0, 0, d], n: [0, -1, 0] },
    left: { o: [-1, -1, 0], u: [0, 2, 0], v: [0, 0, d], n: [1, 0, 0] },
    right: { o: [1, -1, 0], u: [0, 2, 0], v: [0, 0, d], n: [-1, 0, 0] },
    back: { o: [-1, -1, d], u: [2, 0, 0], v: [0, 2, 0], n: [0, 0, -1] },
  };
}

const R3_KEYS = ['floor', 'ceiling', 'left', 'right', 'back'];

/// The rate rows arrive at, which is the room's poll rate — the same one the
/// flat stack uses, so the two modules scroll at the same speed.
const R3_PUSH_HZ = 20;

function r3Rgb(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/// The controls, in the order they are shown.
const R3_UI = [
  { key: 'depth', tag: 'DEPTH', min: 1.5, max: 8, step: 0.1,
    hint: 'How far the room runs back, against a width and height of two. Deeper is a tunnel; shallower is a box.' },
  { key: 'rows', tag: 'ROWS', min: 8, max: 120, step: 1, round: true,
    hint: 'How many rows each surface holds. More is a finer weave and more to draw.' },
  { key: 'points', tag: 'POINTS', min: 32, max: 512, step: 8, round: true,
    hint: 'Samples along a row. Below about sixty the peaks go faceted.' },
  { key: 'over', tag: 'RELIEF', min: 0.02, max: 0.6, step: 0.01,
    hint: 'How far a peak stands off its surface. The surfaces face each other, so past about a third they meet in the middle and the room stops reading as a room.' },
  { key: 'span', tag: 'SPAN', min: 0.3, max: 1, step: 0.01,
    hint: 'How much of each surface the lines run across, leaving flat margins at the edges.' },
  { key: 'window', tag: 'WINDOW', min: 0, max: 1, step: 0.01,
    hint: 'How hard the sound is pulled to the middle of each row. One is the sleeve; nought is an honest oscilloscope.' },
  { key: 'smooth', tag: 'SMOOTH', min: 0, max: 8, step: 1, round: true,
    hint: 'Across the samples of a row, on arrival.' },
  { key: 'gain', tag: 'GAIN', min: 0.1, max: 4, step: 0.05,
    hint: 'How hard the sound drives the relief.' },
  { key: 'floorLevel', tag: 'SILENCE', min: 0, max: 0.05, step: 0.001,
    hint: 'Anything quieter is drawn flat, and the auto-gain will not reach below it. Without one a quiet passage is normalised until the noise under the recording fills the room.' },
  { key: 'eye', tag: 'EYE', min: 0.4, max: 6, step: 0.05,
    hint: 'How far back the camera stands. Close enough and you are inside the room rather than looking into it.' },
  { key: 'lift', tag: 'LIFT', min: -1, max: 1, step: 0.01,
    hint: 'How high the camera stands. At nought it is dead centre and the picture is mirror-symmetric.' },
  { key: 'aim', tag: 'AIM', min: 0, max: 1, step: 0.01,
    hint: 'How far down the room it looks, as a share of the depth.' },
  { key: 'fov', tag: 'LENS', min: 0.3, max: 1.6, step: 0.01,
    hint: 'The field of view. Wide is dramatic and bends the near edges; narrow is flat and architectural.' },
];

/// The five surfaces, as switches.
const R3_FACES = [
  ['floor', 'Floor'], ['ceiling', 'Ceiling'], ['left', 'Left'],
  ['right', 'Right'], ['back', 'Back wall'],
];

/// Attach to a canvas. Returns the same four methods every visual module does.
///
/// Null if the machine will not give an engine, which is a fallback and not an
/// error — `vgAttach` has always answered the same way.
function r3Attach(canvas) {
  if (typeof BABYLON === 'undefined') return null;
  let engine;
  try {
    engine = new BABYLON.Engine(canvas, true, {
      // The film reads the canvas back after drawing it, and without this the
      // buffer is thrown away at composite and the read comes back empty. It
      // cost an afternoon to learn that on the room's own context.
      preserveDrawingBuffer: true,
      stencil: false,
      antialias: true,
      // Deterministic: nothing here may depend on how fast the machine is.
      // The film draws as fast as it can and must get the same picture.
      deterministicLockstep: false,
    }, false);
  } catch (e) {
    return null;
  }
  if (!engine) return null;

  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
  // Nothing in here is lit. Every colour is emissive and flat, the way the flat
  // stack's is — a room of glowing wires, not a room with lamps in it.
  scene.ambientColor = new BABYLON.Color3(0, 0, 0);
  scene.skipPointerMovePicking = true;
  scene.autoClear = true;

  const camera = new BABYLON.FreeCamera('r3cam', new BABYLON.Vector3(0, 0, -1.5), scene);
  camera.minZ = 0.01;
  camera.maxZ = 100;

  let cfg = { ...R3_DEFAULTS };
  let paint = { line: '#eceff2', fill: '#050708', background: '#010204' };

  /// The rows, newest first. One history feeds every surface: they are five
  /// views of the same sound, not five sounds.
  let rows = [];
  let born = 0;
  let ceiling = 1e-4;
  let clockNow = 0;
  let lastPushAt = 0;
  let everPushed = false;

  const surfaces = {};

  const fillMat = new BABYLON.StandardMaterial('r3fill', scene);
  fillMat.disableLighting = true;
  fillMat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.04);
  fillMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  fillMat.specularColor = new BABYLON.Color3(0, 0, 0);
  // The fill is what hides the rows behind, so it must write depth and it must
  // not be see-through. It is the whole design, exactly as it is on the flat
  // stack — see `docs/RIDGELINE.md`.
  fillMat.backFaceCulling = false;

  /// Build (or rebuild) a surface's two meshes.
  ///
  /// A fill and a set of lines: the fill is a ribbon per row standing from the
  /// surface up to the ridge, and the lines are the ridges themselves. They are
  /// built once at a given size and then only their positions are rewritten —
  /// rebuilding meshes every frame is how an engine is made slower than the
  /// hand-written thing it replaced.
  function build(key) {
    const R = Math.max(2, Math.min(200, cfg.rows | 0)) + 1;
    const P = Math.max(8, Math.min(1024, cfg.points | 0));
    const old = surfaces[key];
    if (old && old.R === R && old.P === P) return old;
    if (old) { old.fill.dispose(); old.lines.dispose(); }

    const positions = new Float32Array(R * P * 2 * 3);
    const indices = new Uint32Array(R * (P - 1) * 6);
    let k = 0;
    for (let r = 0; r < R; r++) {
      const base = r * P * 2;
      for (let i = 0; i < P - 1; i++) {
        const a = base + i * 2, b = a + 2;
        indices[k++] = a; indices[k++] = a + 1; indices[k++] = b;
        indices[k++] = b; indices[k++] = a + 1; indices[k++] = b + 1;
      }
    }
    const fill = new BABYLON.Mesh(`r3fill_${key}`, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.applyToMesh(fill, true);
    fill.material = fillMat;
    fill.isPickable = false;
    fill.alwaysSelectAsActiveMesh = true;

    const paths = [];
    for (let r = 0; r < R; r++) {
      const one = [];
      for (let i = 0; i < P; i++) one.push(new BABYLON.Vector3(0, 0, 0));
      paths.push(one);
    }
    const lines = BABYLON.MeshBuilder.CreateLineSystem(`r3line_${key}`,
      { lines: paths, updatable: true }, scene);
    lines.isPickable = false;
    lines.alwaysSelectAsActiveMesh = true;

    const made = { R, P, fill, lines, positions, linePts: new Float32Array(R * P * 3) };
    surfaces[key] = made;
    return made;
  }

  /// Put the rows where they belong on one surface.
  function place(key, s) {
    const m = build(key);
    const { R, P } = m;
    const [ox, oy, oz] = s.o, [ux, uy, uz] = s.u, [vx, vy, vz] = s.v, [nx, ny, nz] = s.n;
    const pos = m.positions, lp = m.linePts;
    const span = Math.max(0.05, Math.min(1, cfg.span));
    const margin = (1 - span) / 2;
    const over = cfg.over;

    for (let r = 0; r < R; r++) {
      // Fixed places in the buffer; the slide is a translation of the whole
      // mesh, which is why this is not rebuilt sixty times a second.
      const t = r / R;
      const row = rows[r];
      for (let i = 0; i < P; i++) {
        const f = margin + (i / (P - 1)) * span;
        const bx = ox + ux * f + vx * t;
        const by = oy + uy * f + vy * t;
        const bz = oz + uz * f + vz * t;
        const h = row ? row[Math.min(row.length - 1, Math.round((i / (P - 1)) * (row.length - 1)))] : 0;
        const d = h * over;
        const j = (r * P + i) * 2;
        pos[j * 3] = bx + nx * d; pos[j * 3 + 1] = by + ny * d; pos[j * 3 + 2] = bz + nz * d;
        pos[(j + 1) * 3] = bx; pos[(j + 1) * 3 + 1] = by; pos[(j + 1) * 3 + 2] = bz;
        const q = (r * P + i) * 3;
        lp[q] = bx + nx * d; lp[q + 1] = by + ny * d; lp[q + 2] = bz + nz * d;
      }
    }
    m.fill.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    m.lines.updateVerticesData(BABYLON.VertexBuffer.PositionKind, lp);
  }

  function placeAll() {
    const s = r3Surfaces(cfg.depth);
    for (const key of R3_KEYS) {
      if (!cfg[key]) { if (surfaces[key]) { surfaces[key].fill.setEnabled(false); surfaces[key].lines.setEnabled(false); } continue; }
      place(key, s[key]);
      surfaces[key].fill.setEnabled(true);
      surfaces[key].lines.setEnabled(true);
    }
  }

  return {
    /// Settings before rows, because the film pushes a great many rows before it
    /// draws anything. The flat stack learned this the same way.
    configure(next) {
      if (!next) return;
      const before = { rows: cfg.rows, points: cfg.points };
      cfg = { ...R3_DEFAULTS, ...next };
      if (before.rows !== cfg.rows || before.points !== cfg.points) {
        for (const k of R3_KEYS) {
          if (surfaces[k]) { surfaces[k].fill.dispose(); surfaces[k].lines.dispose(); delete surfaces[k]; }
        }
        this.clear();
      }
    },

    /// A full stack of flat rows, so silence is a room of straight lines rather
    /// than an empty one that fills up as it goes.
    clear() {
      rows = [];
      born = 0;
      ceiling = 1e-4;
      // **The clock too, or starting again is not starting again.**
      //
      // `push` stamps a row with whatever instant the last `frame` set, and
      // `frame` works out the slide from the gap since that stamp. Left alone
      // across a `clear`, the stamp carries over from the run before: the same
      // rows, pushed the same way, come out mid-slide the first time and flat
      // the second, and the picture is not reproducible.
      //
      // That matters more here than anywhere else in the program. The film
      // draws as fast as the machine manages and hands the renderer a clock —
      // if the same inputs and the same clock do not give the same frame, the
      // export stops matching the room and there is no way to tell by looking.
      clockNow = 0;
      lastPushAt = 0;
      everPushed = false;
      const n = Math.max(8, Math.min(1024, cfg.points | 0));
      const want = Math.max(2, Math.min(200, cfg.rows | 0)) + 1;
      for (let i = 0; i <= want; i++) rows.push(new Float32Array(n));
    },

    /// One row of sound, for every surface at once.
    push(bands, pairs) {
      const n = Math.max(8, Math.min(1024, cfg.points | 0));
      // The same row the flat stack makes, from the same function — so the two
      // modules are the same picture seen two ways rather than two pictures
      // that happen to look alike.
      let v = typeof rdgWaveRow === 'function'
        ? rdgWaveRow(n, pairs, cfg.window, cfg.smooth)
        : new Float32Array(n);
      let peak = 0;
      for (let i = 0; i < n; i++) if (v[i] > peak) peak = v[i];
      const fl = Math.max(0, cfg.floorLevel || 0);
      const gate = fl <= 0 ? 1 : Math.max(0, Math.min(1, (peak - fl) / fl));
      ceiling = Math.max(peak, ceiling * 0.995, fl);
      const k = (1.6 * cfg.gain) / Math.max(1e-4, ceiling);
      for (let i = 0; i < n; i++) v[i] *= k * gate;

      rows.unshift(v);
      born++;
      lastPushAt = clockNow;
      everPushed = true;
      const want = Math.max(2, Math.min(200, cfg.rows | 0)) + 2;
      while (rows.length > want) rows.pop();
      while (rows.length < want) rows.push(new Float32Array(n));
      placeAll();
    },

    /// Draw one picture.
    frame(f) {
      if (f && f.room3d) this.configure(f.room3d);
      const p = (f && f.room3dPaint) || (f && f.ridgePaint) || paint;
      paint = p;
      // Seconds, which is the room's convention and therefore the film's.
      clockNow = (f && typeof f.clock === 'number') ? f.clock * 1000 : performance.now();
      if (!everPushed) lastPushAt = clockNow;

      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      if (engine.getRenderWidth() !== w || engine.getRenderHeight() !== h) engine.resize();

      const ground = r3Rgb(p.background, [0, 0, 0]);
      scene.clearColor = new BABYLON.Color4(ground[0], ground[1], ground[2], 1);
      const fillC = r3Rgb(p.fill, ground);
      fillMat.emissiveColor = new BABYLON.Color3(fillC[0], fillC[1], fillC[2]);
      const lineC = r3Rgb(p.line, [1, 1, 1]);

      if (!rows.length) this.clear();

      // Where the camera stands. Taken every frame rather than once, so the
      // controls move it while you watch.
      camera.position.set(0, cfg.lift, -cfg.eye);
      camera.setTarget(new BABYLON.Vector3(0, 0, cfg.depth * cfg.aim));
      camera.fov = cfg.fov;

      // **The slide, as a translation.** Between one row arriving and the next
      // the whole stack travels one row-step along its own surface. Moving the
      // mesh rather than rewriting every vertex is what keeps this cheap enough
      // to be smooth — and smooth is the whole difference between a scroll and
      // a stack that steps up the screen.
      const step = 1000 / R3_PUSH_HZ;
      const slide = Math.max(0, Math.min(1, (clockNow - lastPushAt) / step));
      const s = r3Surfaces(cfg.depth);
      const R = Math.max(2, Math.min(200, cfg.rows | 0)) + 1;
      for (const key of R3_KEYS) {
        const m = surfaces[key];
        if (!m || !cfg[key]) continue;
        const sv = s[key].v;
        const d = slide / R;
        m.fill.position.set(sv[0] * d, sv[1] * d, sv[2] * d);
        m.lines.position.copyFrom(m.fill.position);
        m.lines.color = new BABYLON.Color3(lineC[0], lineC[1], lineC[2]);
      }

      scene.render();
    },
  };
}
