// The stage: one room, one scene, everything in it.
//
// See `docs/PORT-PLAN.md`. This is the rebuild — not another visualiser beside
// the others but the room they are all going to end up living in, with real
// light in it, real air, and objects that can see one another.
//
// **Built beside what works, not on top of it.** Nothing in here touches
// `vis-gl.js`, `ridge.js` or `room3d.js`; it is another entry in the registry
// until it is better than they are. That is not caution for its own sake — it is
// the only way a rebuild of this size does not spend its first week with the app
// broken.
//
// ── what is different from everything before it ──
//
// Every visualiser this program has had draws **lines that emit their own
// light**: additive blending over black, no lamps, no surfaces, no air. It is a
// good look and it is the only look those renderers can do. The room is a
// wireframe because a wireframe is what you get when nothing is lit.
//
// This has lights. Which means it also has to have **materials that answer
// them**, **surfaces for light to land on**, and **air for it to travel
// through** — the three things the old room fakes. Its fog is a distance-shade
// applied per vertex; here it is the scene's own fog, so a thing far away is
// actually further away. Its mist is a sprite trick; here it is particles with
// positions and lifetimes. Its walls are four lines; here they are surfaces that
// catch the key light and fall off into the dark.

/// The room, the camera, the light, the air.
const ST_DEFAULTS = {
  // ── the room ──
  width: 2.4,
  height: 2.2,
  depth: 6,
  /// How far the back of the room draws in from the front. At one it is a box;
  /// under one it is a funnel, which is what gives the old room its perspective
  /// even before the camera has one.
  taper: 0.72,
  shell: true,
  /// How matte the walls are. Nothing in here is glossy on purpose — a specular
  /// highlight on a wall reads as a mistake at this scale.
  rough: 0.55,

  // ── the camera ──
  eye: 2.4,
  lift: 0.35,
  aim: 0.45,
  fov: 0.9,

  // ── the light ──
  //
  // Three: a key that makes the form, a fill that stops the dark going black,
  // and a rim from behind that finds the edges. It is the ordinary way to light
  // anything and it is ordinary because it works.
  ambient: 0.32,
  keyOn: true,
  key: 2.6,
  keyAt: 0.22,
  keySide: -0.55,
  keyHigh: 0.75,
  fillOn: true,
  fill: 0.55,
  rimOn: true,
  rim: 1.4,
  /// The key light answering the sound rather than sitting still. Nought is a
  /// lamp; up is the room breathing with what it is playing.
  drive: 0.55,

  // ── the air ──
  fogOn: true,
  /// Exponential-squared: thick close to, and hiding the back of the room
  /// entirely rather than shading it a bit. Linear is the honest surveyor's fog
  /// and looks like a fade; this looks like air.
  fogDensity: 0.045,

  // ── the mist ──
  //
  // Particles, with positions and lifetimes, drifting in the light. The old
  // room's mist is shed by grains and lives as long as the shape does; this is
  // the air itself having something in it.
  mistOn: true,
  mist: 1400,
  mistSize: 0.055,
  mistDrift: 0.05,
  mistLife: 6,

  // ── the sound ──
  terrainOn: true,
  rows: 60,
  points: 140,
  relief: 0.5,
  span: 0.9,
  window: 0.6,
  smooth: 2,
  gain: 1,
  floorLevel: 0.004,

  // ── what it is made of ──
  //
  // **Its own colours, not the flat stack's.** Borrowing those gave a wall
  // colour of `#010204`, which is the *ground* — right for a picture drawn as
  // glowing lines over black, and hopeless for a surface meant to catch light.
  // No lamp makes a black wall bright; it only makes it a slightly less black
  // wall. A lit room needs things with tone in them for the light to find.
  wallColour: '#243544',
  floorColour: '#2b3d4e',
  terrainColour: '#cfe0ee',
  mistColour: '#9fc4e0',
  groundColour: '#05080c',
};

/// The rate rows arrive at, which is the room's poll rate.
const ST_PUSH_HZ = 20;

/// Everything that can be switched on or off, in the order the panel shows it.
///
/// **The admin is built from this.** The room's controls were written out by
/// hand, one row per thing, which is why adding a layer meant editing a panel —
/// and why the panel and the renderer could disagree about what existed.
const ST_OBJECTS = [
  { key: 'shell', label: 'Walls', hint: 'The room itself: five surfaces for the light to land on.' },
  { key: 'terrainOn', label: 'Terrain', hint: 'The sound along the floor, receding as it ages.' },
  { key: 'mistOn', label: 'Mist', hint: 'Particles in the air, drifting through the light.' },
  { key: 'fogOn', label: 'Fog', hint: 'The air itself. Thick enough and the back of the room is gone rather than dim.' },
  { key: 'keyOn', label: 'Key light', hint: 'The lamp that makes the form.' },
  { key: 'fillOn', label: 'Fill', hint: 'Stops the shadow side going to black.' },
  { key: 'rimOn', label: 'Rim', hint: 'From behind, to find the edges.' },
];

/// The sliders.
const ST_UI = [
  { key: 'depth', tag: 'DEPTH', min: 2, max: 14, step: 0.1, hint: 'How far the room runs back.' },
  { key: 'width', tag: 'WIDTH', min: 1, max: 6, step: 0.05, hint: 'How wide it is.' },
  { key: 'height', tag: 'HEIGHT', min: 1, max: 6, step: 0.05, hint: 'How tall it is.' },
  { key: 'taper', tag: 'TAPER', min: 0.2, max: 1, step: 0.01,
    hint: 'How far the back draws in. At one it is a box; under one it is a funnel, which is perspective before the camera has any.' },
  { key: 'eye', tag: 'EYE', min: 0.2, max: 8, step: 0.05, hint: 'How far back the camera stands.' },
  { key: 'lift', tag: 'LIFT', min: -1.5, max: 1.5, step: 0.01, hint: 'How high it stands.' },
  { key: 'aim', tag: 'AIM', min: 0, max: 1, step: 0.01, hint: 'How far down the room it looks.' },
  { key: 'fov', tag: 'LENS', min: 0.3, max: 1.6, step: 0.01, hint: 'The field of view.' },
  { key: 'ambient', tag: 'AMBIENT', min: 0, max: 1, step: 0.01, hint: 'The light that comes from nowhere. Too much and nothing has form.' },
  { key: 'key', tag: 'KEY', min: 0, max: 4, step: 0.02, hint: 'The main lamp.' },
  { key: 'keySide', tag: 'KEY SIDE', min: -1, max: 1, step: 0.01, hint: 'Which side it stands.' },
  { key: 'keyHigh', tag: 'KEY HIGH', min: -1, max: 1, step: 0.01, hint: 'How high it hangs.' },
  { key: 'keyAt', tag: 'KEY AT', min: 0, max: 1, step: 0.01, hint: 'How far down the room it hangs.' },
  { key: 'fill', tag: 'FILL', min: 0, max: 2, step: 0.02, hint: 'The soft one opposite the key.' },
  { key: 'rim', tag: 'RIM', min: 0, max: 4, step: 0.02, hint: 'The one behind.' },
  { key: 'drive', tag: 'DRIVE', min: 0, max: 3, step: 0.02, hint: 'How hard the sound moves the key light.' },
  { key: 'fogDensity', tag: 'FOG', min: 0, max: 0.6, step: 0.005, hint: 'How thick the air is.' },
  { key: 'mist', tag: 'MIST', min: 0, max: 6000, step: 50, round: true, hint: 'How many particles are in it.' },
  { key: 'mistSize', tag: 'MIST SIZE', min: 0.005, max: 0.3, step: 0.005, hint: 'How big each one is.' },
  { key: 'mistDrift', tag: 'DRIFT', min: 0, max: 0.5, step: 0.005, hint: 'How fast they move.' },
  { key: 'relief', tag: 'RELIEF', min: 0.02, max: 2, step: 0.01, hint: 'How high the terrain stands.' },
  { key: 'rows', tag: 'ROWS', min: 8, max: 160, step: 1, round: true, hint: 'How many rows of it.' },
  { key: 'points', tag: 'POINTS', min: 32, max: 400, step: 4, round: true, hint: 'Samples along a row.' },
  { key: 'span', tag: 'SPAN', min: 0.3, max: 1, step: 0.01, hint: 'How much of the floor it crosses.' },
  { key: 'window', tag: 'WINDOW', min: 0, max: 1, step: 0.01, hint: 'How hard the sound is pulled to the middle.' },
  { key: 'smooth', tag: 'SMOOTH', min: 0, max: 8, step: 1, round: true, hint: 'Across the samples of a row.' },
  { key: 'gain', tag: 'GAIN', min: 0.1, max: 4, step: 0.05, hint: 'How hard the sound drives it.' },
  { key: 'floorLevel', tag: 'SILENCE', min: 0, max: 0.05, step: 0.001, hint: 'Below this is drawn flat.' },
];

function stRgb(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function stColor(hex, fallback) {
  const c = stRgb(hex, fallback);
  return new BABYLON.Color3(c[0], c[1], c[2]);
}

/// Attach to a canvas. The same four methods every visual module answers.
function stAttach(canvas) {
  if (typeof BABYLON === 'undefined') return null;
  let engine;
  try {
    engine = new BABYLON.Engine(canvas, true, {
      // The film reads the canvas back after drawing it.
      preserveDrawingBuffer: true,
      stencil: false,
      antialias: true,
    }, false);
  } catch (e) {
    return null;
  }
  if (!engine) return null;

  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
  scene.skipPointerMovePicking = true;

  const camera = new BABYLON.FreeCamera('stcam', new BABYLON.Vector3(0, 0, -3), scene);
  camera.minZ = 0.01;
  camera.maxZ = 200;

  // ── the lamps ──
  //
  // Real lights, which is the whole point. `HemisphericLight` is the ambient —
  // sky above, ground below — and the two directional ones are the key and the
  // rim. Their intensities are set every frame from the settings, so moving a
  // slider moves the light rather than rebuilding anything.
  const amb = new BABYLON.HemisphericLight('stamb', new BABYLON.Vector3(0, 1, 0), scene);
  const key = new BABYLON.PointLight('stkey', new BABYLON.Vector3(-1, 1, 1), scene);
  const fill = new BABYLON.HemisphericLight('stfill', new BABYLON.Vector3(0, -1, 0), scene);
  const rim = new BABYLON.DirectionalLight('strim', new BABYLON.Vector3(0, -0.2, -1), scene);

  let cfg = { ...ST_DEFAULTS };
  let paint = { line: '#eceff2', fill: '#12202c', background: '#05080c' };

  let rows = [];
  let ceiling = 1e-4;
  let clockNow = 0;
  let lastPushAt = 0;
  let everPushed = false;
  let level = 0;

  // ── the shell ──
  const shellMat = new BABYLON.StandardMaterial('stshell', scene);
  shellMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
  shellMat.backFaceCulling = false;
  let shell = null;
  let shellKey = '';

  function buildShell() {
    const k = `${cfg.width}|${cfg.height}|${cfg.depth}|${cfg.taper}`;
    if (k === shellKey && shell) return;
    shellKey = k;
    if (shell) shell.dispose();
    const hw = cfg.width / 2, hh = cfg.height / 2, d = cfg.depth, t = cfg.taper;
    // A funnel, not a box: the far rectangle is the near one drawn in by the
    // taper, so the room converges before the lens does anything.
    const near = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const far = near.map(([x, y]) => [x * t, y * t]);
    const pos = [], idx = [], nrm = [];
    const quad = (a, b, c, e) => {
      const base = pos.length / 3;
      for (const p of [a, b, c, e]) pos.push(p[0], p[1], p[2]);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let i = 0; i < 4; i++) {
      const [nx0, ny0] = near[i], [nx1, ny1] = near[(i + 1) % 4];
      const [fx0, fy0] = far[i], [fx1, fy1] = far[(i + 1) % 4];
      quad([nx0, ny0, 0], [nx1, ny1, 0], [fx1, fy1, d], [fx0, fy0, d]);
    }
    // And the back.
    quad([far[0][0], far[0][1], d], [far[1][0], far[1][1], d],
      [far[2][0], far[2][1], d], [far[3][0], far[3][1], d]);
    shell = new BABYLON.Mesh('stshellmesh', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
    vd.normals = nrm;
    vd.applyToMesh(shell, true);
    shell.material = shellMat;
    shell.isPickable = false;
  }

  // ── the terrain ──
  const terrMat = new BABYLON.StandardMaterial('stterr', scene);
  terrMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  terrMat.backFaceCulling = false;
  let terr = null;
  let terrKey = '';

  function buildTerrain() {
    const R = Math.max(2, Math.min(200, cfg.rows | 0));
    const P = Math.max(8, Math.min(1024, cfg.points | 0));
    const k = `${R}|${P}`;
    if (k === terrKey && terr) return;
    terrKey = k;
    if (terr) terr.dispose();
    const pos = new Float32Array(R * P * 3);
    const idx = [];
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < P - 1; i++) {
        const a = r * P + i, b = a + 1, c = a + P, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    terr = new BABYLON.Mesh('stterrmesh', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = new Float32Array(R * P * 3);
    vd.applyToMesh(terr, true);
    terr.material = terrMat;
    terr.isPickable = false;
  }

  function placeTerrain() {
    if (!terr) return;
    const R = Math.max(2, Math.min(200, cfg.rows | 0));
    const P = Math.max(8, Math.min(1024, cfg.points | 0));
    const hw = cfg.width / 2, hh = cfg.height / 2, d = cfg.depth;
    const span = Math.max(0.05, Math.min(1, cfg.span));
    const margin = (1 - span) / 2;
    const pos = terr.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    for (let r = 0; r < R; r++) {
      const t = r / (R - 1);
      // The floor narrows with the walls, so the terrain sits on it rather than
      // through it.
      const tap = 1 + (cfg.taper - 1) * t;
      const row = rows[r];
      for (let i = 0; i < P; i++) {
        const f = margin + (i / (P - 1)) * span;
        const h = row ? row[Math.min(row.length - 1, Math.round((i / (P - 1)) * (row.length - 1)))] : 0;
        const j = (r * P + i) * 3;
        pos[j] = (f * 2 - 1) * hw * tap;
        // **Just off the floor.** Sat exactly on it, the terrain's flat parts and
        // the floor are the same plane and the depth buffer cannot say which is
        // in front — the two flicker against each other pixel by pixel and the
        // floor comes out speckled. A hair of clearance costs nothing and is
        // what stops it.
        pos[j + 1] = -hh * tap + 0.004 + h * cfg.relief;
        pos[j + 2] = t * d;
      }
    }
    terr.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    // Normals, or the light has nothing to answer. This is the whole difference
    // between a lit surface and a coloured one.
    const idx = terr.getIndices();
    const nrm = new Float32Array(pos.length);
    BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
    terr.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nrm);
  }

  // ── the mist ──
  //
  // A particle system: positions, velocities and lifetimes, drifting through the
  // room. The old room's mist is sprites shed by grains and gone when the grain
  // is; this is the air having something in it whether anything is sounding or
  // not.
  let mist = null;
  let mistTex = null;

  function buildMist() {
    if (mist) return;
    // One soft dot, drawn rather than loaded — nothing here fetches a file.
    const dt = new BABYLON.DynamicTexture('stmisttex', { width: 64, height: 64 }, scene, true);
    const g = dt.getContext();
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    dt.hasAlpha = true;
    dt.update();
    mistTex = dt;

    mist = new BABYLON.ParticleSystem('stmist', 8000, scene);
    mist.particleTexture = mistTex;
    mist.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    mist.emitter = new BABYLON.Vector3(0, 0, 0);
    mist.minEmitBox = new BABYLON.Vector3(-1, -1, 0);
    mist.maxEmitBox = new BABYLON.Vector3(1, 1, 1);
    mist.minLifeTime = 2;
    mist.maxLifeTime = 8;
    mist.emitRate = 400;
    mist.gravity = new BABYLON.Vector3(0, 0.01, 0);
    mist.start();
  }

  return {
    configure(next) {
      if (!next) return;
      cfg = { ...ST_DEFAULTS, ...next };
    },

    clear() {
      rows = [];
      ceiling = 1e-4;
      clockNow = 0;
      lastPushAt = 0;
      everPushed = false;
      level = 0;
      const n = Math.max(8, Math.min(1024, cfg.points | 0));
      const want = Math.max(2, Math.min(200, cfg.rows | 0)) + 1;
      for (let i = 0; i <= want; i++) rows.push(new Float32Array(n));
    },

    push(bands, pairs) {
      const n = Math.max(8, Math.min(1024, cfg.points | 0));
      let v = typeof rdgWaveRow === 'function'
        ? rdgWaveRow(n, pairs, cfg.window, cfg.smooth)
        : new Float32Array(n);
      let peak = 0;
      for (let i = 0; i < n; i++) if (v[i] > peak) peak = v[i];
      const fl = Math.max(0, cfg.floorLevel || 0);
      const gate = fl <= 0 ? 1 : Math.max(0, Math.min(1, (peak - fl) / fl));
      ceiling = Math.max(peak, ceiling * 0.995, fl);
      const k = (1.2 * cfg.gain) / Math.max(1e-4, ceiling);
      for (let i = 0; i < n; i++) v[i] *= k * gate;
      // What the light answers, smoothed so a lamp does not stutter.
      level = level * 0.8 + Math.min(1, peak / Math.max(1e-4, ceiling)) * 0.2;

      rows.unshift(v);
      lastPushAt = clockNow;
      everPushed = true;
      const want = Math.max(2, Math.min(200, cfg.rows | 0)) + 2;
      while (rows.length > want) rows.pop();
      while (rows.length < want) rows.push(new Float32Array(n));
    },

    frame(f) {
      if (f && f.stage) this.configure(f.stage);
      paint = (f && f.stagePaint) || (f && f.ridgePaint) || paint;
      clockNow = (f && typeof f.clock === 'number') ? f.clock * 1000 : performance.now();
      if (!everPushed) lastPushAt = clockNow;

      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      if (engine.getRenderWidth() !== w || engine.getRenderHeight() !== h) engine.resize();
      if (!rows.length) this.clear();

      const ground = stRgb(cfg.groundColour, [0.02, 0.03, 0.05]);
      scene.clearColor = new BABYLON.Color4(ground[0], ground[1], ground[2], 1);

      buildShell();
      buildTerrain();
      buildMist();
      placeTerrain();

      shell.setEnabled(!!cfg.shell);
      terr.setEnabled(!!cfg.terrainOn);
      shellMat.diffuseColor = stColor(cfg.wallColour, [0.14, 0.21, 0.27]);
      // A little of its own, or the walls are a hole behind the terrain: a lamp
      // inside a room only lights what it reaches, and the corners it does not
      // reach have nothing to say they are corners.
      shellMat.emissiveColor = stColor(cfg.wallColour, [0.14, 0.21, 0.27]).scale(0.16);
      terrMat.diffuseColor = stColor(cfg.terrainColour, [0.81, 0.88, 0.93]);
      terrMat.emissiveColor = stColor(cfg.terrainColour, [0.81, 0.88, 0.93]).scale(0.07);

      // ── the air ──
      if (cfg.fogOn && cfg.fogDensity > 0) {
        scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
        scene.fogDensity = cfg.fogDensity;
        scene.fogColor = new BABYLON.Color3(ground[0], ground[1], ground[2]);
      } else {
        scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
      }

      // ── the lamps ──
      //
      // The key answers the sound; the others hold still. A room where every
      // lamp pumps is a disco, and a room where none of them do is a diagram.
      amb.intensity = cfg.ambient;
      amb.diffuse = stColor(cfg.wallColour, [0.2, 0.3, 0.4]);
      key.setEnabled(!!cfg.keyOn);
      fill.setEnabled(!!cfg.fillOn);
      rim.setEnabled(!!cfg.rimOn);
      key.intensity = cfg.key * (1 + level * cfg.drive);
      key.diffuse = stColor(cfg.terrainColour, [1, 1, 1]);
      key.position.set(
        cfg.keySide * cfg.width,
        cfg.keyHigh * cfg.height,
        cfg.keyAt * cfg.depth,
      );
      key.range = cfg.depth * 3;
      fill.intensity = cfg.fill;
      fill.diffuse = stColor(cfg.floorColour, [0.2, 0.3, 0.4]);
      rim.intensity = cfg.rim;
      rim.diffuse = stColor(cfg.mistColour, [1, 1, 1]);
      rim.direction = new BABYLON.Vector3(0, -0.25, -1);

      // ── the mist ──
      if (mist) {
        const want = Math.max(0, Math.min(6000, cfg.mist | 0));
        mist.emitRate = cfg.mistOn ? want / 4 : 0;
        mist.minSize = cfg.mistSize * 0.5;
        mist.maxSize = cfg.mistSize;
        mist.minEmitBox = new BABYLON.Vector3(-cfg.width / 2, -cfg.height / 2, 0);
        mist.maxEmitBox = new BABYLON.Vector3(cfg.width / 2, cfg.height / 2, cfg.depth);
        mist.minLifeTime = cfg.mistLife * 0.4;
        mist.maxLifeTime = cfg.mistLife;
        mist.direction1 = new BABYLON.Vector3(-cfg.mistDrift, cfg.mistDrift, -cfg.mistDrift);
        mist.direction2 = new BABYLON.Vector3(cfg.mistDrift, cfg.mistDrift * 2, cfg.mistDrift);
        const c = stRgb(cfg.mistColour, [1, 1, 1]);
        mist.color1 = new BABYLON.Color4(c[0], c[1], c[2], 0.22);
        mist.color2 = new BABYLON.Color4(c[0], c[1], c[2], 0.06);
        mist.colorDead = new BABYLON.Color4(c[0], c[1], c[2], 0);
      }

      // ── the camera ──
      camera.position.set(0, cfg.lift, -cfg.eye);
      camera.setTarget(new BABYLON.Vector3(0, 0, cfg.depth * cfg.aim));
      camera.fov = cfg.fov;

      scene.render();
    },
  };
}
