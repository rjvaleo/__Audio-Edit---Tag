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

  // ── how it is drawn ──
  //
  // **Four samples, then a pipeline.** Without multisampling every edge in here
  // is a staircase, and a room is nothing but edges. Without tone mapping the
  // lit parts clip to flat white and the unlit parts crush to flat black, which
  // is most of why the first pass read as cardboard: there was no middle.
  //
  // The bloom is not decoration. The look this program has always had is light
  // that spills, and on the old renderer that came free from additive blending;
  // on a lit renderer it has to be asked for, or the bright ridges are merely
  // pale rather than glowing.
  let pipe = null;
  try {
    pipe = new BABYLON.DefaultRenderingPipeline('stpipe', true, scene, [camera]);
    pipe.samples = 4;
  } catch (e) { pipe = null; }

  // ── the lamps ──
  //
  // Real lights, which is the whole point. `HemisphericLight` is the ambient —
  // sky above, ground below — and the two directional ones are the key and the
  // rim. Their intensities are set every frame from the settings, so moving a
  // slider moves the light rather than rebuilding anything.
  const amb = new BABYLON.HemisphericLight('stamb', new BABYLON.Vector3(0, 1, 0), scene);
  // A spot rather than a bare point, because a point light cannot cast a
  // shadow cheaply and shadows are most of what "definition" means: a thing
  // with no shadow is a thing that is not standing anywhere.
  const key = new BABYLON.SpotLight('stkey', new BABYLON.Vector3(-1, 1, 1),
    new BABYLON.Vector3(0.3, -0.4, 1), Math.PI * 0.9, 2, scene);
  let shadowGen = null;
  try {
    shadowGen = new BABYLON.ShadowGenerator(1024, key);
    shadowGen.useBlurExponentialShadowMap = true;
    shadowGen.blurKernel = 32;
  } catch (e) { shadowGen = null; }
  // Opposite the key and low, so the wall the key misses is *modelled* rather
  // than merely lifted off black. A single ambient makes the dark side flat; a
  // second lamp makes it a surface facing away from the light, which is a
  // different and much better-looking thing.
  const fill = new BABYLON.HemisphericLight('stfill', new BABYLON.Vector3(1, 0.4, -0.3), scene);
  const rim = new BABYLON.DirectionalLight('strim', new BABYLON.Vector3(0, -0.2, -1), scene);

  let cfg = { ...ST_DEFAULTS };
  let paint = { line: '#eceff2', fill: '#12202c', background: '#05080c' };

  let rows = [];
  let hoops = [];
  let ceiling = 1e-4;
  let clockNow = 0;
  let lastPushAt = 0;
  let everPushed = false;
  let level = 0;

  // ── a ruling for the walls ──
  //
  // **A plain surface in perspective has no size.** It could be a metre away or
  // a mile; there is nothing in it to measure against. A ruling gives the room a
  // scale, and it is the single biggest thing between "coloured cardboard" and
  // "a room" — more than the lights, which had nothing to land on that showed
  // they had landed.
  //
  // Drawn, not fetched: nothing here loads a file.
  let gridTex = null;
  function buildGrid() {
    const n = Math.max(2, Math.min(80, cfg.gridSize | 0));
    const k = `${n}|${cfg.gridFade}|${cfg.wallColour}`;
    if (gridTex && gridTex.__k === k) return gridTex;
    if (gridTex) gridTex.dispose();
    const S = 512;
    const t = new BABYLON.DynamicTexture('stgrid', { width: S, height: S }, scene, true);
    const g = t.getContext();
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    const step = S / n;
    g.strokeStyle = `rgba(0,0,0,${0.55 * cfg.gridFade})`;
    g.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      const at = Math.round(i * step) + 0.5;
      g.beginPath(); g.moveTo(at, 0); g.lineTo(at, S); g.stroke();
      g.beginPath(); g.moveTo(0, at); g.lineTo(S, at); g.stroke();
    }
    // Every fifth heavier, so the eye can count without being told to.
    g.strokeStyle = `rgba(0,0,0,${0.9 * cfg.gridFade})`;
    g.lineWidth = 2;
    for (let i = 0; i <= n; i += 5) {
      const at = Math.round(i * step) + 0.5;
      g.beginPath(); g.moveTo(at, 0); g.lineTo(at, S); g.stroke();
      g.beginPath(); g.moveTo(0, at); g.lineTo(S, at); g.stroke();
    }
    t.update();
    t.__k = k;
    t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    gridTex = t;
    return t;
  }

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
    const pos = [], idx = [], nrm = [], uvs = [];
    const quad = (a, b, c, e, us, vs) => {
      const base = pos.length / 3;
      for (const p of [a, b, c, e]) pos.push(p[0], p[1], p[2]);
      // Measured in room units rather than nought-to-one, so the ruling is the
      // same size on a long wall as on a short one — stretched to fit, a grid
      // says the opposite of what a grid is for.
      uvs.push(0, 0, us, 0, us, vs, 0, vs);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let i = 0; i < 4; i++) {
      const [nx0, ny0] = near[i], [nx1, ny1] = near[(i + 1) % 4];
      const [fx0, fy0] = far[i], [fx1, fy1] = far[(i + 1) % 4];
      const across = Math.hypot(nx1 - nx0, ny1 - ny0);
      quad([nx0, ny0, 0], [nx1, ny1, 0], [fx1, fy1, d], [fx0, fy0, d], across, d);
    }
    // And the back.
    quad([far[0][0], far[0][1], d], [far[1][0], far[1][1], d],
      [far[2][0], far[2][1], d], [far[3][0], far[3][1], d],
      cfg.width * t, cfg.height * t);
    shell = new BABYLON.Mesh('stshellmesh', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.uvs = uvs;
    BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
    vd.normals = nrm;
    vd.applyToMesh(shell, true);
    shell.material = shellMat;
    shell.isPickable = false;
    shell.receiveShadows = true;
  }

  // ── the terrain ──
  const terrMat = new BABYLON.StandardMaterial('stterr', scene);
  terrMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  terrMat.backFaceCulling = false;
  let terr = null;
  let terrKey = '';
  let wire = null;
  const wireMat = new BABYLON.StandardMaterial('stwiremat', scene);
  wireMat.wireframe = true;
  wireMat.disableLighting = true;
  wireMat.backFaceCulling = false;

  function buildTerrain() {
    const R = stDetail(cfg, cfg.rows | 0, 2, 200);
    const P = stDetail(cfg, cfg.points | 0, 8, 1024);
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
    if (shadowGen) shadowGen.addShadowCaster(terr);

    // **The line follows the rows, not every edge of every triangle.**
    //
    // Babylon's `wireframe` draws the mesh's own triangulation, which on a grid
    // this fine is two diagonals per square and reads as moiré — noise, at any
    // distance, and worse the further away it is. The look this program has
    // always had is one line per row of sound, and that is also the only version
    // of it that survives perspective.
    if (wire) wire.dispose();
    const lines = [];
    for (let r = 0; r < R; r++) {
      const one = [];
      for (let i = 0; i < P; i++) one.push(new BABYLON.Vector3(0, 0, 0));
      lines.push(one);
    }
    wire = BABYLON.MeshBuilder.CreateLineSystem('stwire', { lines, updatable: true }, scene);
    wire.isPickable = false;
    wire.__R = R; wire.__P = P;
  }

  function placeTerrain() {
    if (!terr) return;
    const R = stDetail(cfg, cfg.rows | 0, 2, 200);
    const P = stDetail(cfg, cfg.points | 0, 8, 1024);
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
    if (wire) {
      // The line sits a shade above the surface it belongs to, or the two argue
      // for the depth buffer and the ridge comes out dashed.
      const lp = new Float32Array(R * P * 3);
      for (let i = 0; i < R * P; i++) {
        lp[i * 3] = pos[i * 3];
        lp[i * 3 + 1] = pos[i * 3 + 1] + 0.006;
        lp[i * 3 + 2] = pos[i * 3 + 2];
      }
      wire.updateVerticesData(BABYLON.VertexBuffer.PositionKind, lp);
    }
  }

  // ── the type ──
  //
  // Glyphs drawn once into a texture and stood on planes in the space. Repeating
  // the plane along the lean gives real relief: the same extrusion the flat card
  // fakes, except here the depth buffer means the sound passes in front of it
  // and behind it, and the camera moving past it actually moves past it.
  //
  // Rebuilt only when the words or their shape change. A texture redrawn every
  // frame is how an engine is made slower than the canvas it replaced.
  let typePlanes = [];
  let typeTex = null;
  let typeMats = [];
  let typeKey = '';

  function disposeType() {
    for (const m of typePlanes) m.dispose();
    for (const m of typeMats) m.dispose();
    if (typeTex) typeTex.dispose();
    typePlanes = []; typeMats = []; typeTex = null; typeKey = '';
  }

  function placeType() {
    const words = typeof roomTextSettings === 'function' ? roomTextSettings() : null;
    const text = words ? String(words.text || '') : '';
    const on = stShows(cfg, 'typeOn') && !!text.trim();
    if (!on) {
      for (const m of typePlanes) m.setEnabled(false);
      return;
    }
    const steps = cfg.typeDepth > 0 ? Math.max(2, Math.min(48, Math.round(6 + cfg.typeDepth * 20))) : 1;
    const key = [text, words.align, words.weight, words.track, words.lead, steps, cfg.typeColour].join('|');
    if (key !== typeKey) {
      disposeType();
      typeKey = key;

      // Big enough that the camera can come close without it going soft.
      const W = 2048;
      const lines = text.split('\n');
      const H = 1024;
      typeTex = new BABYLON.DynamicTexture('sttype', { width: W, height: H }, scene, true);
      typeTex.hasAlpha = true;
      const g = typeTex.getContext();
      g.clearRect(0, 0, W, H);
      const px = Math.max(24, (H / Math.max(1, lines.length)) * 0.62);
      g.font = `${words.weight} ${px}px ${typeof RT_FONT !== 'undefined' ? RT_FONT : 'sans-serif'}`;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      if ('letterSpacing' in g) g.letterSpacing = `${words.track * px}px`;
      const step = words.lead * px;
      const first = H / 2 - (lines.length - 1) * step / 2;
      g.fillStyle = '#ffffff';
      for (let l = 0; l < lines.length; l++) g.fillText(lines[l], W / 2, first + l * step);
      typeTex.update();

      for (let i = 0; i < steps; i++) {
        const m = new BABYLON.StandardMaterial(`sttypem${i}`, scene);
        m.disableLighting = true;
        m.diffuseColor = new BABYLON.Color3(0, 0, 0);
        m.specularColor = new BABYLON.Color3(0, 0, 0);
        // **The texture masks; the colour lights.**
        //
        // An `emissiveTexture` *is* the emission — a white glyph sheet emits
        // white and `emissiveColor` does not scale it. Three different
        // multipliers gave an identical measured mean, which is the signature of
        // a number nothing reads.
        //
        // So the shape comes from the alpha and the brightness from the colour:
        // a plane of one colour, cut out in the shape of the letters.
        m.opacityTexture = typeTex;
        m.backFaceCulling = false;
        typeMats.push(m);
        const pl = BABYLON.MeshBuilder.CreatePlane(`sttype${i}`,
          { width: 1, height: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        pl.material = m;
        pl.isPickable = false;
        typePlanes.push(pl);
      }
    }

    const rad = cfg.typeLean * Math.PI / 180;
    const dep = cfg.typeDepth * cfg.typeSize;
    const n = typePlanes.length;
    const c = stRgb(cfg.typeColour, [1, 1, 1]);
    const glow = Math.max(0, cfg.glow);
    for (let i = 0; i < n; i++) {
      // Back to front, so the face is drawn last and unbroken, and each copy
      // dimmer as it recedes — the sides falling away rather than ending on a
      // hard edge in mid-air.
      const t = n === 1 ? 0 : i / (n - 1);
      const pl = typePlanes[n - 1 - i];
      const m = typeMats[n - 1 - i];
      pl.setEnabled(true);
      pl.scaling.set(cfg.typeSize * 4, cfg.typeSize * 2, 1);
      pl.position.set(
        (cfg.typeSwing || 0) + Math.cos(rad) * dep * t,
        (cfg.typeHigh || 0) - Math.sin(rad) * dep * t,
        cfg.typeAt * cfg.depth + dep * t * 0.5,
      );
      // **Divided among the copies, not repeated on each.** A dozen emissive
      // planes stacked along a lean is a dozen lots of the same light through
      // the bloom, and the letters come out as a white blot with the words
      // barely legible inside it. The face keeps most of it and the sides get
      // what is left, which is what an extrusion looks like anyway.
      // **Saturation, not brightness, is what made the words loud.** Trimming
      // the multiplier from 0.42 to 0.3 changed the measured mean by nothing at
      // all: the face was already past white and the bloom was spreading the
      // clipped part. Below one it comes back down the curve and the letters are
      // type in a room rather than a lamp shaped like type.
      const fade = i === 0 ? 0.85 : (1 - t) * 0.85 / Math.max(1, n * 0.4);
      m.emissiveColor = new BABYLON.Color3(c[0] * glow * fade, c[1] * glow * fade, c[2] * glow * fade);
    }
  }

  // ── the sleeve ──
  //
  // One builder for all five faces, because a surface is only four vectors: a
  // corner, the way the lines run across it, the way the rows travel, and the way
  // a peak stands off. The back wall is the odd one and is the point — on the
  // other four the rows run away into the room, and on the back there is no depth
  // left to run into, so they climb. That is the sleeve, in place.
  const ST_FACES = ['floor', 'ceiling', 'left', 'right', 'back'];

  function stFaceBasis(k) {
    const hw = cfg.width / 2, hh = cfg.height / 2, d = cfg.depth;
    return {
      floor: { o: [-hw, -hh, 0], u: [hw * 2, 0, 0], v: [0, 0, d], n: [0, 1, 0] },
      ceiling: { o: [-hw, hh, 0], u: [hw * 2, 0, 0], v: [0, 0, d], n: [0, -1, 0] },
      left: { o: [-hw, -hh, 0], u: [0, hh * 2, 0], v: [0, 0, d], n: [1, 0, 0] },
      right: { o: [hw, -hh, 0], u: [0, hh * 2, 0], v: [0, 0, d], n: [-1, 0, 0] },
      back: { o: [-hw, -hh, d], u: [hw * 2, 0, 0], v: [0, hh * 2, 0], n: [0, 0, -1] },
    }[k];
  }

  const sleeveMat = new BABYLON.StandardMaterial('stsleevemat', scene);
  sleeveMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
  sleeveMat.backFaceCulling = false;
  const sleeves = {};
  const sleeveWires = {};
  let sleeveKey = '';

  function buildSleeve() {
    const R = stDetail(cfg, cfg.rows | 0, 2, 200);
    const P = stDetail(cfg, cfg.points | 0, 8, 1024);
    const k = `${R}|${P}`;
    if (k === sleeveKey) return;
    sleeveKey = k;
    for (const f of ST_FACES) { if (sleeves[f]) { sleeves[f].dispose(); delete sleeves[f]; } }
    const idx = [];
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < P - 1; i++) {
        const a = r * P + i, b = a + 1, c = a + P, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    for (const f of ST_FACES) {
      const m = new BABYLON.Mesh(`stsleeve_${f}`, scene);
      const vd = new BABYLON.VertexData();
      vd.positions = new Float32Array(R * P * 3);
      vd.indices = idx.slice();
      vd.normals = new Float32Array(R * P * 3);
      vd.applyToMesh(m, true);
      m.material = sleeveMat;
      m.isPickable = false;
      sleeves[f] = m;

      // The line, one per row, over a fill that hides what is behind it.
      if (sleeveWires[f]) sleeveWires[f].dispose();
      const lines = [];
      for (let r = 0; r < R; r++) {
        const one = [];
        for (let i = 0; i < P; i++) one.push(new BABYLON.Vector3(0, 0, 0));
        lines.push(one);
      }
      sleeveWires[f] = BABYLON.MeshBuilder.CreateLineSystem(`stsleevewire_${f}`,
        { lines, updatable: true }, scene);
      sleeveWires[f].isPickable = false;
    }
  }

  function placeSleeve() {
    const R = stDetail(cfg, cfg.rows | 0, 2, 200);
    const P = stDetail(cfg, cfg.points | 0, 8, 1024);
    const span = Math.max(0.05, Math.min(1, cfg.sleeveSpan));
    const margin = (1 - span) / 2;
    for (const f of ST_FACES) {
      const m = sleeves[f];
      if (!m) continue;
      const want = stShows(cfg, 'sleeveOn') && !!cfg[`sleeve${f[0].toUpperCase()}${f.slice(1)}`];
      m.setEnabled(want);
      if (sleeveWires[f]) sleeveWires[f].setEnabled(want && !!cfg.wire);
      if (!want) continue;
      const b = stFaceBasis(f);
      const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      for (let r = 0; r < R; r++) {
        const t = r / (R - 1);
        const row = rows[r];
        for (let i = 0; i < P; i++) {
          const fx = margin + (i / (P - 1)) * span;
          const h = row ? row[Math.min(row.length - 1, Math.round((i / (P - 1)) * (row.length - 1)))] : 0;
          const dd = h * cfg.sleeveRelief;
          const j = (r * P + i) * 3;
          pos[j] = b.o[0] + b.u[0] * fx + b.v[0] * t + b.n[0] * dd;
          pos[j + 1] = b.o[1] + b.u[1] * fx + b.v[1] * t + b.n[1] * dd;
          pos[j + 2] = b.o[2] + b.u[2] * fx + b.v[2] * t + b.n[2] * dd;
        }
      }
      m.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
      const nrm = new Float32Array(pos.length);
      BABYLON.VertexData.ComputeNormals(pos, m.getIndices(), nrm);
      m.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nrm);

      const w = sleeveWires[f];
      if (w) {
        // A hair off the surface, or the two argue for the depth buffer and the
        // ridge comes out dashed.
        const lp = new Float32Array(R * P * 3);
        for (let i = 0; i < R * P; i++) {
          lp[i * 3] = pos[i * 3] + b.n[0] * 0.004;
          lp[i * 3 + 1] = pos[i * 3 + 1] + b.n[1] * 0.004;
          lp[i * 3 + 2] = pos[i * 3 + 2] + b.n[2] * 0.004;
        }
        w.updateVerticesData(BABYLON.VertexBuffer.PositionKind, lp);
        const c = stRgb(cfg.sleeveColour, [1, 1, 1]);
        w.color = new BABYLON.Color3(c[0] * cfg.glow, c[1] * cfg.glow, c[2] * cfg.glow);
      }
    }
  }

  // ── the ring ──
  //
  // A tube: one hoop per frame of sound, the run of them joined into a surface.
  // Built once at a size and then only its positions rewritten, like everything
  // else here — rebuilding a mesh every frame is how an engine is made slower
  // than the hand-written thing it replaced.
  const ringMat = new BABYLON.StandardMaterial('stringmat', scene);
  ringMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
  ringMat.backFaceCulling = false;
  let ring = null;
  let ringWire = null;
  let ringKey = '';

  function buildRing() {
    const R = stDetail(cfg, cfg.ringRows | 0, 2, 400);
    const P = stDetail(cfg, cfg.ringPoints | 0, 16, 512);
    const k = `${R}|${P}`;
    if (k === ringKey && ring) return;
    ringKey = k;
    if (ring) ring.dispose();
    const idx = [];
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < P; i++) {
        // Wrapped, because a hoop closes: the last point joins the first, and
        // without that the tube has a seam running down its length.
        const j = (i + 1) % P;
        const a = r * P + i, b = r * P + j, c = (r + 1) * P + i, d = (r + 1) * P + j;
        idx.push(a, c, b, b, c, d);
      }
    }
    ring = new BABYLON.Mesh('stringmesh', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = new Float32Array(R * P * 3);
    vd.indices = idx;
    vd.normals = new Float32Array(R * P * 3);
    vd.applyToMesh(ring, true);
    ring.material = ringMat;
    ring.isPickable = false;

    // **Hoops of light over a dark tube.** A solid tube made emissive is the
    // white-slab fault again — and in open space, with the camera inside the
    // run of it, a bright solid is a cone aimed at the lens. The surface is
    // there only to stop you seeing the hoops behind; the hoops are the picture.
    if (ringWire) ringWire.dispose();
    const loops = [];
    for (let r = 0; r < R; r++) {
      const one = [];
      // Closed: the last point is the first, or every hoop has a gap in it.
      for (let i = 0; i <= P; i++) one.push(new BABYLON.Vector3(0, 0, 0));
      loops.push(one);
    }
    ringWire = BABYLON.MeshBuilder.CreateLineSystem('stringwire',
      { lines: loops, updatable: true }, scene);
    ringWire.isPickable = false;
  }

  function placeRing() {
    if (!ring) return;
    const R = stDetail(cfg, cfg.ringRows | 0, 2, 400);
    const P = stDetail(cfg, cfg.ringPoints | 0, 16, 512);
    const pos = ring.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const hh = cfg.height / 2;
    const cy = cfg.ringHigh * hh;
    const lp = ringWire ? new Float32Array(R * (P + 1) * 3) : null;
    for (let r = 0; r < R; r++) {
      const t = r / (R - 1);
      const h = hoops[r];
      // **No taper.** The taper is the room's, and it belongs to things lying on
      // the room's surfaces. Applied to the ring it shrinks the far hoops and
      // swells the near ones, and with the camera inside the run of it that
      // reads as a funnel aimed at the lens rather than a tube going away.
      for (let i = 0; i < P; i++) {
        const a = (i / P) * Math.PI * 2;
        // The hoop is a circle pushed out of round by what the two channels were
        // doing: the figure is the deviation, not the shape itself, so silence is
        // a clean bore rather than nothing at all.
        const L = h ? h[i * 2] : 0;
        const Rr = h ? h[i * 2 + 1] : 0;
        const push = (L + Rr) * 0.5 * cfg.ringDrive;
        const rad = cfg.ringSize * (1 + push);
        const x = Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        // Behind the camera's own position and running away, so the near hoops
        // are the sound of a moment ago rather than something in the lens.
        const z = cfg.ringAt * cfg.depth * 0.1 + t * cfg.depth;
        const j = (r * P + i) * 3;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        if (lp) {
          const q = (r * (P + 1) + i) * 3;
          lp[q] = x; lp[q + 1] = y; lp[q + 2] = z;
        }
      }
      // The closing point of each loop.
      if (lp) {
        const first = (r * (P + 1)) * 3;
        const last = (r * (P + 1) + P) * 3;
        lp[last] = lp[first]; lp[last + 1] = lp[first + 1]; lp[last + 2] = lp[first + 2];
      }
    }
    ring.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    const nrm = new Float32Array(pos.length);
    BABYLON.VertexData.ComputeNormals(pos, ring.getIndices(), nrm);
    ring.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nrm);
    if (ringWire && lp) {
      ringWire.updateVerticesData(BABYLON.VertexBuffer.PositionKind, lp);
      const c = stRgb(cfg.ringColour, [0.62, 0.77, 0.88]);
      const g = Math.max(0, cfg.glow);
      ringWire.color = new BABYLON.Color3(c[0] * g, c[1] * g, c[2] * g);
    }
  }

  // ── the cloud ──
  //
  // **Thin instances, not a mesh each.** Two thousand separate meshes is two
  // thousand draw calls and a scene graph that spends longer being walked than
  // drawn; thin instances are one mesh, one call, and a matrix apiece. It is the
  // difference between a cloud that can be large and one that can be seen.
  const cloudMat = new BABYLON.StandardMaterial('stcloudmat', scene);
  cloudMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  // **No per-instance colour.** A colour buffer on a thin instance needs the
  // material to read vertex colours, and a standard material asked to do that
  // wants a colour attribute on the base mesh as well. Set up wrong the whole
  // mesh silently stops drawing — measured, the picture was identical to two
  // decimal places with the cloud switched on and off, which is the shape of a
  // thing that is not being drawn rather than one that is too dim.
  //
  // Every grain the same colour, then, and the fade done with size. What the
  // cloud needed colour for was depth, and the fog already does that.
  let cloud = null;
  let cloudMx = null;
  let live = [];
  let seen = null;
  let cloudBorn = 0;
  let cloudDied = 0;
  let cloudNow = -1;

  // ── the catalogue of solids ──
  //
  // **All thirty-seven, not one.** The cloud drew a single icosahedron because
  // that is what one `CreatePolyhedron` call gives you, and every grain in the
  // room was the same object at a different size. The room on the old renderer
  // has never done that: `ui/grain-shapes.js` builds a catalogue from the sheets
  // in `Gran Shapes/` — the Platonic five, the prisms and pyramids, the swept
  // forms, the truncations, the spiked stars, the simplex projections — and
  // gives each grain one of them by its own hash.
  //
  // Every model carries triangles as well as edges, so on this renderer they can
  // be what the stage's cloud is meant to be: lit solids standing in the fog,
  // rather than the wireframes the old room draws them as because it has no lamp
  // and no depth buffer.
  //
  // One mesh per shape, each with its own thin-instance buffer, because a thin
  // instance is an instance *of a mesh* — thirty-seven draw calls against
  // thirty-seven separate clouds, which is the same trade the single mesh made
  // and the only one on offer.
  const cloudShapes = new Map();

  function shapeMesh(model) {
    let e = cloudShapes.get(model.name);
    if (e) return e;
    const id = `stgrain_${model.name.replace(/[^a-z0-9]/gi, '_')}`;
    let mesh;
    // **The three simplex projections have no skin, on purpose.** A simplex is a
    // graph rather than a surface — every pair of its vertices is joined and none
    // of that is a face — and the catalogue says so by shipping them with no
    // triangles at all. Built as solids they are meshes with no indices, which
    // draw nothing: a grain assigned one is a grain that silently is not there.
    // So they are drawn as what they are.
    if (!model.tri || !model.tri.length) {
      const lines = [];
      for (let i = 0; i < model.idx.length; i += 2) {
        const a = model.idx[i] * 3, b = model.idx[i + 1] * 3;
        lines.push([
          new BABYLON.Vector3(model.pos[a], model.pos[a + 1], model.pos[a + 2]),
          new BABYLON.Vector3(model.pos[b], model.pos[b + 1], model.pos[b + 2]),
        ]);
      }
      mesh = BABYLON.MeshBuilder.CreateLineSystem(id, { lines }, scene);
      mesh.__wire = true;
    } else {
      mesh = new BABYLON.Mesh(id, scene);
      const vd = new BABYLON.VertexData();
      vd.positions = Array.from(model.pos);
      vd.indices = Array.from(model.tri);
      // Worked out rather than shipped: the catalogue is built for a renderer
      // with no lamp in it and carries no normals, and a lit solid without them
      // is a flat silhouette.
      const nrm = new Float32Array(vd.positions.length);
      BABYLON.VertexData.ComputeNormals(vd.positions, vd.indices, nrm);
      vd.normals = Array.from(nrm);
      vd.applyToMesh(mesh, true);
      mesh.material = cloudMat;
    }
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    e = { mesh, mx: new Float32Array(0), cap: 0, n: 0, wire: !!mesh.__wire };
    cloudShapes.set(model.name, e);
    return e;
  }

  /// Room for `n` instances of a shape, without reallocating every frame.
  ///
  /// Grown geometrically and never shrunk: which shapes are busy changes with
  /// the sound, and a buffer that is resized whenever the cloud shifts is a
  /// buffer that is resized constantly.
  function shapeRoom(e, n) {
    if (e.cap >= n) return;
    e.cap = Math.max(16, n * 2);
    e.mx = new Float32Array(e.cap * 16);
    e.mesh.thinInstanceSetBuffer('matrix', e.mx, 16, false);
  }

  /// The catalogue is off: every grain the same solid, as it was.
  const ST_ONE_SHAPE = 'icosahedron';

  function buildCloud() {
    const cap = stDetail(cfg, cfg.cloudCap | 0, 100, 6000);
    if (cloud && cloud.__cap === cap) return;
    if (cloud) cloud.dispose();
    // The base mesh is still here and still used when the catalogue is switched
    // off — an icosahedron: enough faces to catch the light from several
    // directions, few enough to draw thousands of.
    cloud = BABYLON.MeshBuilder.CreatePolyhedron('stcloud', { type: 3, size: 1 }, scene);
    cloud.material = cloudMat;
    cloud.isPickable = false;
    cloud.alwaysSelectAsActiveMesh = true;
    cloud.__cap = cap;
    cloudMx = new Float32Array(cap * 16);
    cloud.thinInstanceSetBuffer('matrix', cloudMx, 16, false);
    // Nothing to draw until the first grain sounds. Left visible with no
    // instances, the base shape draws itself at the origin at full size — which
    // is one enormous grain filling the room, and exactly what it did.
    cloud.thinInstanceCount = 0;
    cloud.isVisible = false;
    cloud.alwaysSelectAsActiveMesh = true;
  }

  /// Which solid a grain is, decided once when it is born.
  ///
  /// **Never re-decided.** The tier is a property of the grain's birth and not
  /// of its age — see the note on `grainShapeFor`. Worked out afresh each frame
  /// from how bright and how near it is, a grain leaves the front of the room a
  /// pentagonal pyramid and reaches the back wall an octahedron, changing shape
  /// in mid-air.
  function shapeFor(key, level) {
    if (typeof GRAIN_SHAPES === 'undefined') return null;
    const want = cfg.cloudShape || 'auto';
    // **Every shape, spread by the grain's own number.** The old room tiers the
    // catalogue by how loud a grain is, so a quiet file only ever shows the six
    // simplest solids — which is right there, where a grain is a wireframe drawn
    // as lines and thirty edges on an eight-pixel mark cost the same as thirty
    // that can be seen. Here a shape is one instanced draw call however many
    // grains wear it, so that bound buys nothing and the whole catalogue is on.
    if (want === 'auto') return GRAIN_SHAPES[(key >>> 16) % GRAIN_SHAPES.length];
    // The room's own rule, for when the picture should say how loud a grain is
    // by how intricate it is.
    if (want === 'tiered') return grainShapeFor((key >>> 16) % 0xffff, grainDetailFor(level));
    return GRAIN_SHAPES.find((m) => m.name === want) || null;
  }

  /// Bring in every grain the playhead has crossed, and move the ones already
  /// flying.
  function stepCloud(f) {
    if (!cloud) return;
    const cap = cloud.__cap;
    const sr = (f && f.grainRate) || 44100;
    const now = ((f && f.position) || 0) / ((f && f.positionRate) || sr);
    const list = (f && f.grains) || null;

    // A seek, a restart, or the first frame: do not pour the whole file into the
    // room to catch up, because those grains were never heard.
    cloudNow = now;
    if (seen === null || now < seen || now - seen > 1) seen = now;

    if (list && list.length && now > seen) {
      for (let i = 0; i < list.length && live.length < cap; i++) {
        const e = list[i];
        const t0 = e[0] / sr;
        if (t0 <= seen || t0 > now) continue;
        // **Its own coin, flipped once.** Thinning by taking every n-th grain
        // samples a periodic schedule at a fixed interval, and two regular rates
        // beat — the cloud comes out banded rather than thinner. A hash of the
        // grain's own index has no period to beat against, and because it is the
        // grain's own number the picture thins in place instead of rearranging.
        const key = (e[7] | 0) * 2654435761 >>> 0;
        if ((key & 0xffff) / 0x10000 > cfg.cloudDensity) continue;
        const hx = ((key & 0xffff) / 0x8000) - 1;
        const hy = (((key >>> 16) & 0xffff) / 0x8000) - 1;
        const k2 = (((e[7] | 0) ^ 0x9e3779b9) * 2246822519) >>> 0;
        cloudBorn++;
        const k3 = (((e[7] | 0) ^ 0x85ebca6b) * 0xc2b2ae35) >>> 0;
        live.push({
          // What every arrangement reads: two stable scatters, where in the
          // source it reads from, what pitch it is at, and a seed of its own.
          seed: (key >>> 8 & 0xffff) / 0x10000,
          src: (k3 & 0xffff) / 0x10000,
          pitch: Math.max(-1, Math.min(1, hy)),
          // **When it was born, on the playhead's own clock.**
          //
          // Age was accumulated per frame before this, which ties how long a
          // grain lives to how fast the machine draws — and worse, the step was
          // clamped, so a frame longer than the clamp aged a grain past its whole
          // life at once. Every grain died on the frame it was born: measured,
          // four thousand three hundred and ninety-five born and the same number
          // dead, with never one alive to draw.
          //
          // Held as a birth time instead, age is a subtraction. There is no
          // accumulator to drift, nothing to clamp, and the film — which draws as
          // fast as it can — gets the same cloud as the room.
          born: t0,
          // Across is pan, up is pitch, and both are scattered a little so a
          // busy schedule is a cloud rather than a line.
          fx: hx * 0.7 + (e[6] || 0) * 0.3,
          fy: Math.max(-0.9, Math.min(0.9, hy * 0.6)),
          dx: (((k2 & 0xffff) / 0x8000) - 1) * cfg.cloudDrift,
          dy: ((((k2 >>> 16) & 0xffff) / 0x8000) - 1) * cfg.cloudDrift * 0.7,
          age: 0,
          // How long it sounds for decides how far it gets.
          // How long it takes to cross the room. Its own length decides it, but
          // floored well above a grain's actual duration — a twentieth of a
          // second is a real grain and an invisible streak.
          life: Math.max(0.6, Math.min(4, (e[2] / sr) * 4)),
          spin: ((k2 & 0xff) / 255) * 6.283,
          size: 0.5 + ((key >>> 8 & 0xff) / 255) * 0.8,
          // Which solid it is. Decided here, once, and kept — see `shapeFor`.
          // **The same level the old room derives**, or the tiers land in a
          // different place and only the simplest few solids ever turn up. Root
          // scaled, not linear: a grain's RMS is small and clustered, and read
          // straight it never reaches the tier where the intricate shapes are.
          shape: shapeFor(key, Math.min(1, Math.sqrt(Math.max(0, e[4] || 0)) * 2.2)),
        });
      }
    }
    seen = now;

    // Move them, and let the old ones go. Age is a subtraction from the
    // playhead, so nothing here depends on how often this is called.
    const hw = cfg.width / 2, hh = cfg.height / 2;
    const lay = stLayout(cfg.cloudLayout);
    let n = 0;
    for (let i = 0; i < live.length; i++) {
      const g = live[i];
      g.age = (now - g.born) / Math.max(0.05, g.life);
      if (g.age >= 1 || g.age < 0) { cloudDied++; continue; }
      // **No break here.** This loop is the one that keeps the survivors, and
      // breaking out of it at the cap threw away every grain after the cut —
      // which is why a full cloud went from seventeen hundred to none in one
      // frame rather than thinning. The cap belongs on births, where it is.
      if (n >= cap) { n = cap; break; }
      const t = g.age;
      // Where a grain goes is the whole of what the ten grain views were. See
      // `ST_LAYOUTS`.
      const at = lay.at(g, t, hw, hh, cfg.depth);
      const x = at[0], y = at[1], z = at[2];
      // **Fading by size, not by alpha.**
      //
      // A vertex alpha is ignored by a standard material unless transparency is
      // switched on for the whole mesh, and switching it on brings sorting with
      // it — two thousand transparent solids in a lit room have to be drawn back
      // to front or they eat each other's depth. Grown in and shrunk out, a
      // grain arrives and leaves just as smoothly and stays opaque the whole
      // time, which is one less thing for the depth buffer to argue about.
      const a = Math.min(1, Math.sin(t * Math.PI) * 1.6);
      const sc = cfg.cloudSize * g.size * a;
      const ang = g.spin + t * 3;
      const cs = Math.cos(ang) * sc, sn = Math.sin(ang) * sc;
      // **Into its own shape's buffer.** A thin instance is an instance of a
      // mesh, so a cloud of thirty-seven different solids is thirty-seven
      // clouds — each one written, sized and drawn on its own.
      const into = g.shape ? shapeMesh(g.shape) : null;
      if (into) {
        shapeRoom(into, into.n + 1);
        // `shapeRoom` may have handed out a new array.
        writeGrain(into.mx, into.n, cs, sn, sc, x, y, z);
        into.n++;
      } else {
        writeGrain(cloudMx, n, cs, sn, sc, x, y, z);
      }
      n++;
      live[n - 1] = g;
    }
    live.length = n;

    // Every shape that had anything in it draws; every shape that did not is
    // switched off rather than left showing its last frame.
    let plain = 0;
    // **Gated on the switch, like everything else in the room.** The base mesh
    // was and these were not, so switching the grains off or soloing something
    // else left thirty-four clouds drawing.
    const showing = stShows(cfg, 'cloudOn');
    for (const e of cloudShapes.values()) {
      e.mesh.thinInstanceCount = e.n;
      if (e.n) e.mesh.thinInstanceBufferUpdated('matrix');
      e.mesh.isVisible = e.n > 0 && showing;
      e.mesh.setEnabled(e.n > 0 && showing);
      // The wire ones take their colour from the cloud rather than from a
      // material, because a line mesh has its own.
      if (e.wire && e.n) {
        const c = stRgb(cfg.cloudColour, [1, 0.85, 0.63]);
        const gg = Math.max(0, cfg.cloudGlow) * Math.max(0, cfg.glow);
        e.mesh.color = new BABYLON.Color3(c[0] * gg, c[1] * gg, c[2] * gg);
      }
      e.n = 0;
    }
    for (const g of live) if (!g.shape) plain++;
    cloud.thinInstanceCount = plain;
    if (plain) cloud.thinInstanceBufferUpdated('matrix');
    // **And tell it where they all are.**
    //
    // Without this the mesh's bounds are whatever the base shape was and go to
    // nothing once instance data is written — `min` and `max` both read `null` —
    // and a mesh that cannot say where it is gets culled and drawn wrong: what
    // came out was the base shape sitting at the origin at full size, one
    // enormous grain instead of two hundred small ones.
    //
    // It is a walk over the matrices, so it is done once here rather than per
    // instance.
    cloud.thinInstanceRefreshBoundingInfo(false);
    cloud.isVisible = plain > 0;
  }

  /// One grain's matrix, written straight into the buffer.
  ///
  /// A rotation about Y, scaled — written rather than built as a `Matrix` and
  /// copied, which at this count matters.
  function writeGrain(buf, i, cs, sn, sc, x, y, z) {
    const m = i * 16;
    buf[m] = cs; buf[m + 1] = 0; buf[m + 2] = -sn; buf[m + 3] = 0;
    buf[m + 4] = 0; buf[m + 5] = sc; buf[m + 6] = 0; buf[m + 7] = 0;
    buf[m + 8] = sn; buf[m + 9] = 0; buf[m + 10] = cs; buf[m + 11] = 0;
    buf[m + 12] = x; buf[m + 13] = y; buf[m + 14] = z; buf[m + 15] = 1;
  }


  // ── the cloud, as strokes ──
  //
  // **A grain is a tick, not a dot.** This is the single largest difference
  // between the arrangements and the views they were named after, and it is why
  // the first attempt read as a scatter: a dot carries a position and nothing
  // else, while a stroke carries how long the grain lasts in its length and what
  // rate it reads at in its tilt. Two more facts about the sound, in the mark
  // itself, at no cost in clutter.
  //
  // Billboarded, so both read from any angle — the length is the length whatever
  // the camera is doing, rather than foreshortening away the moment the view
  // turns.
  //
  // **Additive, on black.** The density is the accumulation. Every renderer this
  // program has had glows because overlapping strokes sum, and where the cloud
  // piles up the picture goes white without anything being told to be brighter.
  // Drawn as lit solids the same grains cannot pile up — a solid in front of a
  // solid is one solid — so the cloud came out as countable objects, which is
  // exactly what it is not.
  //
  // A shader rather than a standard material, because what is wanted here is
  // *no* lighting, a per-instance colour, and a soft edge, and a lit material
  // asked for all three is a material fighting its own defaults. See the note on
  // per-instance colour buffers in `docs/STAGE.md`.
  const ST_TICK_VERT = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    attribute vec4 gcol;
    #include<instancesDeclaration>
    uniform mat4 viewProjection;
    varying vec2 vUV;
    varying vec4 vCol;
    void main(void) {
      #include<instancesVertex>
      vUV = uv;
      vCol = gcol;
      gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
    }`;
  const ST_TICK_FRAG = `
    precision highp float;
    varying vec2 vUV;
    varying vec4 vCol;
    void main(void) {
      // Across the stroke, a falloff rather than an edge — a hard-edged
      // rectangle reads as a rectangle at any size, and what is wanted is a
      // stroke. Along it, eased at the two ends so a tick has ends rather
      // than corners.
      float across = 1.0 - abs(vUV.y * 2.0 - 1.0);
      float along = 1.0 - pow(abs(vUV.x * 2.0 - 1.0), 4.0);
      float a = pow(max(across, 0.0), 0.9) * max(along, 0.0);
      if (a <= 0.003) discard;
      gl_FragColor = vec4(vCol.rgb, vCol.a * a);
    }`;
  BABYLON.Effect.ShadersStore.stgraintickVertexShader = ST_TICK_VERT;
  BABYLON.Effect.ShadersStore.stgraintickFragmentShader = ST_TICK_FRAG;

  const tickMat = new BABYLON.ShaderMaterial('sttickmat', scene, 'stgraintick', {
    // **The instance attributes are not listed here.** Babylon appends
    // `world0`..`world3` itself when a mesh has thin instances; listing them as
    // well puts each name in the effect twice, and the duplicate takes the
    // attribute location the first one was bound to. What comes out is a mesh
    // that compiles, reports ready, is walked, is submitted and draws nothing —
    // every check green and no picture.
    attributes: ['position', 'uv', 'gcol'],
    uniforms: ['world', 'viewProjection'],
    needAlphaBlending: true,
  });
  tickMat.backFaceCulling = false;
  tickMat.alphaMode = BABYLON.Constants.ALPHA_ADD;
  // **Additive and depth-blind, both.** Ticks that write depth occlude each
  // other, and a cloud whose strokes hide one another is the countable-objects
  // picture again by another route. Nothing here is solid; it is light.
  tickMat.disableDepthWrite = true;
  tickMat.needAlphaBlending = () => true;

  let ticks = null;
  let tickMx = null;
  let tickCol = null;
  let tickCap = 0;
  /// How many times the last frame folded the cloud, so a count of strokes can
  /// be turned back into a count of grains.
  let tickFolds = 1;
  /// The grain handed to a projection, reused every time round the loop.
  const gs = { c: 0.5, w: 0, a: 0, e: 0, pn: 0, semis: 0, rate: 1, dur: 0,
    tOut: 0, tSrc: 0, dt: 0, u: 0, v: 0, dev: 0, pan: 0, i: 0, n: 0 };

  function buildTicks(cap) {
    if (ticks && tickCap === cap) return;
    if (ticks) ticks.dispose();
    ticks = BABYLON.MeshBuilder.CreatePlane('sttick', { size: 1 }, scene);
    ticks.material = tickMat;
    ticks.isPickable = false;
    ticks.alwaysSelectAsActiveMesh = true;
    // Nothing behind it and nothing in front: it is drawn last, over the lit
    // scene, the way additive ink goes on last.
    ticks.renderingGroupId = 1;
    tickCap = cap;
    tickMx = new Float32Array(cap * 16);
    tickCol = new Float32Array(cap * 4);
    ticks.thinInstanceSetBuffer('matrix', tickMx, 16, false);
    ticks.thinInstanceSetBuffer('gcol', tickCol, 4, false);
    // The base shape draws itself at the origin at full size when there are no
    // instances — one enormous grain filling the room. See `docs/STAGE.md`.
    ticks.thinInstanceCount = 0;
    ticks.isVisible = false;
  }

  /// What the whole schedule looks like, measured once rather than assumed.
  ///
  /// The colour coordinate is a grain's pitch stretched across the range *this
  /// cloud* actually uses. Against the engine's theoretical ±48 semitones a
  /// couple of semitones of jitter — which is a lot to listen to — spans a
  /// fiftieth of the palette and the cloud comes out monochrome.
  let schedStats = null;
  let schedFor = null;

  function statsFor(list, sr, outFrames, srcFrames, colourBy) {
    const sig = `${list.length}|${outFrames}|${srcFrames}|${colourBy}`;
    if (schedFor === list && schedStats && schedStats.sig === sig) return schedStats;
    schedFor = list;

    const outSec = (outFrames || 1) / sr;
    const srcSec = (srcFrames || 1) / sr;
    const ratio = Math.max(0.01, Math.min(100, outSec / Math.max(srcSec, 1e-9)));
    const of = (ST_COLOUR_BY[colourBy] || ST_COLOUR_BY.pitch).of;

    let lo = Infinity, hi = -Infinity, amp = 1e-6, size = 0, dev = 1e-6;
    let firstOut = Infinity, lastOut = -Infinity;
    const g = { semis: 0, rate: 1, dev: 0, dur: 0, v: 0, u: 0 };
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      g.semis = e[3] || 0;
      g.rate = Math.pow(2, g.semis / 12);
      g.dur = (e[2] || 0) / sr;
      g.v = (e[1] || 0) / Math.max(srcFrames || 1, 1);
      g.u = (e[0] || 0) / Math.max(outFrames || 1, 1);
      // How far this grain's read strayed from where it was nominally due.
      // Nought when position jitter is off, which is what makes the Lattice a
      // perfect crystal at rest.
      g.dev = ((e[1] || 0) - (e[0] || 0) / ratio) / sr;
      const c = of(g);
      if (c < lo) lo = c;
      if (c > hi) hi = c;
      if ((e[4] || 0) > amp) amp = e[4];
      if (Math.abs(g.dev) > dev) dev = Math.abs(g.dev);
      size += e[2] || 0;
      if (e[0] < firstOut) firstOut = e[0];
      if (e[0] > lastOut) lastOut = e[0];
    }
    const n = list.length;
    if (!n) { lo = 0; hi = 0; firstOut = 0; lastOut = 0; }
    const baseDur = n ? (size / n) / sr : 0.04;
    // **Overlap, measured rather than asked for.** The braid's strand count is
    // the overlap, and the engine's setting for it does not reach this far — but
    // it is not needed: how many windows cover a moment is how long one lasts
    // divided by how far apart they are, and both are in the schedule.
    const hop = n > 1 ? ((lastOut - firstOut) / (n - 1)) / sr : baseDur;
    const overlap = Math.max(1, Math.min(16, baseDur / Math.max(hop, 1e-6)));
    // The lattice's grid, and how hard to push a grain off it. The original
    // scales the push by the position-jitter setting; measured against the
    // cloud's own largest deviation it is the same picture and needs nothing
    // passed in — perfect at rest, melting as the jitter comes up.
    const side = Math.max(1, Math.ceil(Math.sqrt(n)));
    const cell = (ST_P5.SPAN * 1.7) / side;
    schedStats = { sig, lo, span: hi - lo, amp, size: n ? size / n : 0,
      baseDur, outSec, srcSec, ratio, overlap, side, cell,
      devScale: (ST_P5.HEIGHT) / Math.max(dev, 1e-6), of };
    return schedStats;
  }

  /// The moment, drawn.
  ///
  /// **Every position is a function of `tOut - now`**, so the present is the
  /// origin by construction and the cloud is always centred. That is what makes
  /// this a picture of an instant rather than of a file: it draws the grains
  /// that are *about* to sound as well as the ones that have, which is the whole
  /// of "blooming outward in both directions at once" and the half the
  /// birth-and-age cloud can never show — it has no future in it.
  function stepTicks(f, lay) {
    // The window for a moment, the whole schedule for an object. See the note
    // where these are handed over in `visGlTick`.
    const list = (f && (lay.moment ? f.grains : (f.schedule || f.grains))) || null;
    const sr = (f && f.grainRate) || 44100;
    const now = ((f && f.position) || 0) / ((f && f.positionRate) || sr);
    const look = stLook(cfg, lay.key);
    // **The fold belongs to the moment, not to the object.** Suite one lays the
    // whole schedule out as one thing and folding it would fold the thing
    // itself; suite two is a window on an instant, and the symmetry is a
    // property of the looking.
    const k = lay.suite === 2 ? Math.max(1, Math.round(look.mirror || 1)) : 1;
    const folds = lay.sym === 'mirror' ? Math.min(4, k) : k;
    tickFolds = folds;
    const cap = stDetail(cfg, cfg.cloudCap | 0, 100, 6000) * folds;
    buildTicks(cap);
    if (!list || !list.length) { ticks.isVisible = false; return; }

    const st = statsFor(list, sr, f.outFrames, f.srcFrames, look.colourBy);
    // How far ahead or behind a grain still counts as part of this moment.
    // Outside it nothing is drawn: from inside a moment you cannot see the whole
    // piece, and pretending otherwise is a different picture.
    const H = Math.max(st.baseDur * 14, 1.6);
    const ramp = stRamp(look.palette, ST_CBINS);
    const glow = Math.max(0, cfg.cloudGlow) * (look.glow == null ? 1 : look.glow);
    const trail = look.trail == null ? 0.5 : look.trail;

    // **One scale from the original's space into the room.**
    //
    // Every projection is written in the units it was written in — `R` 300,
    // `SPAN` 520, `HEIGHT` 260 — and this is the only place they become metres.
    // Ten projections each doing their own conversion is ten chances to get it
    // subtly wrong, and the first attempt managed exactly that in all ten.
    //
    // Sized so the view fills the frame from where the camera is standing.
    // `fit` is how far this particular view reaches as a multiple of `R`: the
    // Lattice is a grid of `SPAN * 1.7` across and the Mandala is a disc of `R`,
    // and framed identically one of them is a speck and the other runs off every
    // edge. It is the only per-view number here that is not the original's, and
    // it exists because the original fits its camera to each view and this one
    // stands in a room you can walk around.
    const dist = BABYLON.Vector3.Distance(camera.position, BABYLON.Vector3.Zero());
    const half = dist * Math.tan(cfg.fov / 2);
    const scale = (half * 1.15) / (ST_P5.R * (lay.fit || 1));

    // Screen-space basis, so a stroke is legible whatever the camera is doing.
    const fwd = camera.getForwardRay ? camera.getForwardRay().direction : new BABYLON.Vector3(0, 0, 1);
    const upW = new BABYLON.Vector3(0, 1, 0);
    let rgt = BABYLON.Vector3.Cross(upW, fwd);
    if (rgt.lengthSquared() < 1e-6) rgt = new BABYLON.Vector3(1, 0, 0);
    rgt.normalize();
    const up = BABYLON.Vector3.Cross(fwd, rgt).normalize();
    const nrm = fwd;
    // **A stroke is a width on the screen, not a size in the room.**
    //
    // The original sets these with `strokeWeight`, which is pixels — a couple of
    // pixels for a grain merely present and five for one sounding. Written as
    // world units instead they came out at two millimetres in a four-metre room,
    // which is under a pixel: every tick was there, every tick was drawn, and
    // nothing was visible. Against the canvas's *CSS* height, not its buffer
    // height: on a retina display the buffer is twice the size, and measured
    // against that every stroke comes out half the width the original draws.
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const cssH = Math.max(1, engine.getRenderHeight() / dpr);
    const wpp = (2 * dist * Math.tan(cfg.fov / 2)) / cssH;

    const ctx = {
      R: ST_P5.R, SPAN: ST_P5.SPAN, HEIGHT: ST_P5.HEIGHT,
      wedge: (Math.PI * 2) / Math.max(1, k), spin: now * 0.55, now, H,
      outSec: st.outSec, srcSec: st.srcSec, overlap: st.overlap,
      side: st.side, cell: st.cell, devScale: st.devScale, baseDur: st.baseDur,
    };

    // **Thinned across the whole thing, not cut off at the cap.**
    //
    // An object view is a picture of the *entire* schedule. Filling the buffer
    // in schedule order and stopping fills it with the first few seconds of the
    // piece and draws nothing after — Shear came out as a clump against the left
    // edge instead of a diagonal across the frame, which reads as a broken
    // projection rather than as a missing three quarters of the file. So the
    // density is lowered until the whole thing fits, through the same per-grain
    // hash, which thins in place rather than rearranging.
    const room = Math.floor(cap / folds);
    const density = lay.moment
      ? cfg.cloudDensity
      : Math.min(cfg.cloudDensity, room / Math.max(1, list.length));
    // How many marks the lattice has to find a grid for. Its side is the square
    // root of what is *drawn*, not of what exists, or the crystal is a corner of
    // a grid several times too big.
    // How many marks there will actually be: the schedule after thinning, or the
    // room in the buffer, whichever runs out first. Multiplying the *capped*
    // count by the density instead counts the thinning twice, and the grid came
    // out a third of the side it needed — so the crystal ran off the bottom of
    // the room in a column eighty rows deep.
    const expect = Math.min(list.length * density, room);
    ctx.side = Math.max(1, Math.ceil(Math.sqrt(expect)));
    ctx.cell = (ST_P5.SPAN * 1.7) / ctx.side;

    let n = 0;
    let drawn = 0;
    for (let i = 0; i < list.length && n + folds <= cap; i++) {
      const e = list[i];
      const dt = e[0] / sr - now;
      // The moment views draw a window either side of the playhead. The object
      // views draw the whole schedule, because that is what they are of.
      if (lay.moment && (dt > H || dt < -H)) continue;
      // Thinned by the grain's own number, not by taking every n-th: a periodic
      // schedule sampled at a fixed interval beats against itself and comes out
      // banded rather than thinner.
      const key = (e[7] | 0) * 2654435761 >>> 0;
      if ((key & 0xffff) / 0x10000 > density) continue;

      const dur = (e[2] || 0) / sr;
      // **A grain that has not sounded yet is still drawn.** It is dark — the
      // dimmest of the three tiers — but it is there, and for the moment views
      // it is half of what they are: the present blooming outward both ways.
      const en = stEnergy(-dt, dur, trail);

      gs.semis = e[3] || 0;
      gs.rate = Math.pow(2, gs.semis / 12);
      gs.dur = dur;
      gs.tOut = e[0] / sr;
      gs.tSrc = e[1] / sr;
      gs.dt = dt;
      gs.w = Math.max(-1, Math.min(1, dt / H));
      gs.u = (e[0] || 0) / Math.max(f.outFrames || 1, 1);
      gs.v = (e[1] || 0) / Math.max(f.srcFrames || 1, 1);
      gs.dev = ((e[1] || 0) - (e[0] || 0) / st.ratio) / sr;
      gs.a = Math.min(1, (e[4] || 0) / st.amp);
      gs.e = en;
      gs.pan = e[6] || 0;
      gs.i = e[7] | 0;
      gs.n = drawn++;
      gs.pn = Math.max(-1, Math.min(1, gs.semis / 48));
      gs.c = st.span > 1e-9 ? (st.of(gs) - st.lo) / st.span : 0.5;

      const at = lay.project(gs, ctx);
      // The original draws in a space with y downward; this one has y up.
      const px = at[0] * scale, py = -at[1] * scale, pz = at[2] * scale;

      // The mark itself: length is how long the grain lasts, tilt is what rate
      // it reads at, and both are facts about the sound rather than decoration.
      const L = 14 * stTickScale(dur) * wpp;
      const tilt = Math.max(-2.2, Math.min(2.2, Math.log2(Math.max(gs.rate, 1e-6)))) * 0.62;
      const ca = Math.cos(tilt), sa = Math.sin(tilt);
      const dxv = rgt.x * ca + up.x * sa, dyv = rgt.y * ca + up.y * sa, dzv = rgt.z * ca + up.z * sa;
      const pxv = -rgt.x * sa + up.x * ca, pyv = -rgt.y * sa + up.y * ca, pzv = -rgt.z * sa + up.z * ca;

      // Three tiers, dimmest first — the sounding grains sit on top of the ones
      // merely present, which is what makes overlap legible as brightness.
      const ei = en > 0.55 ? 2 : (en > 0.08 ? 1 : 0);
      // Never thinner than a pixel and a bit. A stroke narrower than the screen
      // can draw is not a faint stroke, it is an absent one.
      const wgt = Math.max(1.6, (ei === 0 ? 3.8 : (ei === 1 ? 5.6 : 9.5)) * 0.9) * wpp;
      const alpha = Math.min(1, (ei === 0 ? 0.35 : (ei === 1 ? 0.65 : 0.92)) * glow);
      const ci = Math.max(0, Math.min(ST_CBINS - 1, Math.floor(gs.c * ST_CBINS)));
      const col = ramp[ci];

      // **The fold.** The cloud is placed once and written out several times
      // under a transform, rather than every grain being duplicated into the
      // schedule — a dozen extra writes against a dozen times the work. It is
      // also where the density of a moment view comes from.
      //
      //   rot     turned by a share of the circle, every other one flipped.
      //           Flipped *then* turned: the other order reflects each pair
      //           about the wrong axis and twelve folds read as six.
      //   mirror  folded in x, then in y, then both. Four copies and no more,
      //           because a fifth is one of the first four again.
      for (let s = 0; s < folds; s++) {
        let fx = 1, fy = 1, cr = 1, sr2 = 0;
        if (lay.sym === 'mirror') {
          fx = (s & 1) ? -1 : 1;
          fy = (s & 2) ? -1 : 1;
        } else if (k > 1) {
          const ang = (s * Math.PI * 2) / k + now * 0.12;
          cr = Math.cos(ang); sr2 = Math.sin(ang);
          fy = (s & 1) ? -1 : 1;
        }
        const rot = (x, y) => {
          const xx = x * fx, yy = y * fy;
          return [xx * cr - yy * sr2, xx * sr2 + yy * cr];
        };
        const p = rot(px, py);
        const d2 = rot(dxv, dyv);
        const q2 = rot(pxv, pyv);
        const nn2 = rot(nrm.x, nrm.y);
        const m = n * 16;
        tickMx[m] = d2[0] * L; tickMx[m + 1] = d2[1] * L; tickMx[m + 2] = dzv * L; tickMx[m + 3] = 0;
        tickMx[m + 4] = q2[0] * wgt; tickMx[m + 5] = q2[1] * wgt; tickMx[m + 6] = pzv * wgt; tickMx[m + 7] = 0;
        tickMx[m + 8] = nn2[0]; tickMx[m + 9] = nn2[1]; tickMx[m + 10] = nrm.z; tickMx[m + 11] = 0;
        tickMx[m + 12] = p[0]; tickMx[m + 13] = p[1]; tickMx[m + 14] = pz; tickMx[m + 15] = 1;
        const c4 = n * 4;
        tickCol[c4] = col[0]; tickCol[c4 + 1] = col[1]; tickCol[c4 + 2] = col[2]; tickCol[c4 + 3] = alpha;
        n++;
      }
    }

    ticks.thinInstanceCount = n;
    ticks.thinInstanceBufferUpdated('matrix');
    ticks.thinInstanceBufferUpdated('gcol');
    // **No bounding refresh.** The solid cloud needs one because a mesh that
    // cannot say where it is gets culled and drawn wrong. This one is never
    // culled — `alwaysSelectAsActiveMesh` — and refreshing it is a walk over
    // every matrix in the buffer, every frame, twelve of them per grain. That
    // walk on its own was enough to push the stage's tests past their timeout.
    // The one thing the refresh was really guarding against is below: a visible
    // mesh with no instances draws its base shape at the origin at full size.
    ticks.isVisible = n > 0;
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
      hoops = [];
      ceiling = 1e-4;
      clockNow = 0;
      lastPushAt = 0;
      everPushed = false;
      level = 0;
      live = [];
      seen = null;
      const n = stDetail(cfg, cfg.points | 0, 8, 1024);
      const want = stDetail(cfg, cfg.rows | 0, 2, 200) + 1;
      for (let i = 0; i <= want; i++) rows.push(new Float32Array(n));
    },

    push(bands, pairs) {
      const n = stDetail(cfg, cfg.points | 0, 8, 1024);
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

      // The figure of this instant, resampled to the tube's own fineness. Kept
      // beside the row rather than derived later: a Lissajous is what the two
      // channels were doing *then*, and there is no way back to it afterwards.
      const rp = stDetail(cfg, cfg.ringPoints | 0, 16, 512);
      const hoop = new Float32Array(rp * 2);
      if (pairs && pairs.length >= 4) {
        const m = pairs.length / 2;
        for (let i = 0; i < rp; i++) {
          const k = Math.min(m - 1, Math.round((i / rp) * m));
          hoop[i * 2] = pairs[k * 2];
          hoop[i * 2 + 1] = pairs[k * 2 + 1];
        }
      }
      hoops.unshift(hoop);
      const wantH = stDetail(cfg, cfg.ringRows | 0, 2, 400) + 1;
      while (hoops.length > wantH) hoops.pop();

      rows.unshift(v);
      lastPushAt = clockNow;
      everPushed = true;
      const want = stDetail(cfg, cfg.rows | 0, 2, 200) + 2;
      while (rows.length > want) rows.pop();
      while (rows.length < want) rows.push(new Float32Array(n));
    },

    /// What the room is actually doing, for anyone asking from outside.
    ///
    /// Not debugging scaffolding: a cloud that is empty and a cloud that is not
    /// being drawn look identical from the far side of a canvas, and telling
    /// them apart by reading pixels is guesswork. This says which.
    stats() {
      // **How many grains are in the room, whichever renderer put them there.**
      // A ported view draws strokes and never touches the solid cloud, so
      // reading `live` alone reports nought for exactly the views that work.
      // The tick count is per fold, so it is divided back down to grains.
      const folds = Math.max(1, tickFolds);
      const inked = ticks && ticks.isEnabled() ? Math.round(ticks.thinInstanceCount / folds) : 0;
      return { rows: rows.length, live: live.length + inked, solids: live.length, inked,
        born: cloudBorn, died: cloudDied,
        seen, now: cloudNow, cap: cloud ? cloud.__cap : 0 };
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
      buildCloud();
      buildRing();
      buildSleeve();
      placeTerrain();
      placeRing();
      placeSleeve();
      placeType();
      ring.setEnabled(stShows(cfg, 'ringOn'));
      if (ringWire) ringWire.setEnabled(stShows(cfg, 'ringOn') && !!cfg.wire);
      ringMat.diffuseColor = stColor(cfg.ringColour, [0.62, 0.77, 0.88]);
      // **One arrangement or the other, never both.** A ported view is drawn as
      // strokes and the rest as solids, and a view that is halfway through the
      // port draws twice — the same grains as ink and as objects, in the same
      // places, which reads as neither.
      const lay = stLayout(cfg.cloudLayout);
      const inked = !!(lay.ported && cfg.cloudInk);
      const showCloud = stShows(cfg, 'cloudOn');
      // Nothing is built for a cloud that is switched off. The strokes are a
      // pass over the whole schedule and a write of one matrix per fold, which
      // is real work to do for something nobody is going to see.
      if (inked) { if (showCloud) stepTicks(f, lay); } else stepCloud(f);
      if (ticks) ticks.setEnabled(inked && showCloud);
      cloud.setEnabled(!inked && showCloud);
      cloudMat.diffuseColor = stColor(cfg.cloudColour, [1, 0.85, 0.63]);

      shell.setEnabled(stShows(cfg, 'shell'));
      terr.setEnabled(stShows(cfg, 'terrainOn'));
      if (wire) {
        wire.setEnabled(stShows(cfg, 'terrainOn') && !!cfg.wire);
        const wc = stRgb(cfg.terrainColour, [1, 1, 1]);
        const gg = Math.max(0, cfg.glow);
        wire.color = new BABYLON.Color3(wc[0] * gg, wc[1] * gg, wc[2] * gg);
        wire.alpha = Math.max(0.05, Math.min(1, cfg.wireWidth / 2));
      }
      // The ruling, and the shadows it helps you read.
      shellMat.diffuseTexture = cfg.grid ? buildGrid() : null;
      if (shellMat.diffuseTexture) {
        shellMat.diffuseTexture.uScale = 1;
        shellMat.diffuseTexture.vScale = 1;
      }
      if (shadowGen) {
        shadowGen.blurKernel = Math.max(1, cfg.shadowSoft);
        shadowGen.getShadowMap().renderList = cfg.shadows && cfg.terrainOn ? [terr] : [];
      }
      // ── the line glows; the surface hides ──
      //
      // **A filled surface made emissive is a white slab.** That is what the
      // first attempt at this produced: the terrain lit from inside came out as
      // a featureless ramp, brighter than the room but with no form in it at all.
      //
      // The old renderers are not surfaces. They are *lines*, with a fill behind
      // them whose only job is to stop you seeing the lines further back — the
      // fill is the background colour and is meant to be invisible. That is the
      // whole trick, and inverting it is exactly how a picture goes from a
      // stack of ridges to a sheet of white.
      //
      // So here: the surface takes the ground's own colour and emits nothing,
      // and the line over it carries all the glow. The difference from the flat
      // version is that this fill is a real solid in a depth buffer, so it hides
      // what is behind it from any angle rather than only from one.
      const g = Math.max(0, cfg.glow);
      const ground2 = stColor(cfg.groundColour, [0, 0, 0]);
      terrMat.emissiveColor = ground2.scale(1);
      terrMat.diffuseColor = ground2.scale(1);
      sleeveMat.emissiveColor = ground2.scale(1);
      sleeveMat.diffuseColor = ground2.scale(1);
      ringMat.emissiveColor = ground2.scale(1);
      ringMat.diffuseColor = ground2.scale(1);
      cloudMat.emissiveColor = stColor(cfg.cloudColour, [1, 0.85, 0.63]).scale(cfg.cloudGlow * g);

      shellMat.diffuseColor = stColor(cfg.wallColour, [0.14, 0.21, 0.27]);
      // A little of its own, or the walls are a hole behind the terrain: a lamp
      // inside a room only lights what it reaches, and the corners it does not
      // reach have nothing to say they are corners.
      shellMat.emissiveColor = stColor(cfg.wallColour, [0.14, 0.21, 0.27]).scale(0.5);

      // ── the air ──
      if (stShows(cfg, 'fogOn') && cfg.fogDensity > 0) {
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
      key.setEnabled(stShows(cfg, 'keyOn'));
      fill.setEnabled(stShows(cfg, 'fillOn'));
      rim.setEnabled(stShows(cfg, 'rimOn'));
      key.intensity = cfg.key * (1 + level * cfg.drive);
      key.diffuse = stColor(cfg.terrainColour, [1, 1, 1]);
      key.position.set(
        cfg.keySide * cfg.width,
        cfg.keyHigh * cfg.height,
        cfg.keyAt * cfg.depth,
      );
      key.range = cfg.depth * 3;
      // Aimed at the middle of the room from wherever it hangs, so moving it
      // swings the light across the walls rather than merely relocating a glow.
      const aimAt = new BABYLON.Vector3(0, -cfg.height * 0.2, cfg.depth * 0.5);
      key.direction = aimAt.subtract(key.position).normalize();
      key.angle = Math.PI * 0.85;
      key.exponent = 1.5;
      fill.intensity = cfg.fill;
      fill.diffuse = stColor(cfg.floorColour, [0.2, 0.3, 0.4]);
      rim.intensity = cfg.rim;
      rim.diffuse = stColor(cfg.mistColour, [1, 1, 1]);
      rim.direction = new BABYLON.Vector3(0, -0.25, -1);

      // ── the mist ──
      if (mist) {
        const want = Math.max(0, Math.min(6000, cfg.mist | 0));
        mist.emitRate = stShows(cfg, 'mistOn') ? want / 4 : 0;
        mist.minSize = cfg.mistSize * 0.5;
        mist.maxSize = cfg.mistSize;
        mist.minEmitBox = new BABYLON.Vector3(-cfg.width / 2, -cfg.height / 2, 0);
        mist.maxEmitBox = new BABYLON.Vector3(cfg.width / 2, cfg.height / 2, cfg.depth);
        mist.minLifeTime = cfg.mistLife * 0.4;
        mist.maxLifeTime = cfg.mistLife;
        mist.direction1 = new BABYLON.Vector3(-cfg.mistDrift, cfg.mistDrift, -cfg.mistDrift);
        mist.direction2 = new BABYLON.Vector3(cfg.mistDrift, cfg.mistDrift * 2, cfg.mistDrift);
        const c = stRgb(cfg.mistColour, [1, 1, 1]);
        const mg = Math.max(0, cfg.glow);
        mist.color1 = new BABYLON.Color4(c[0], c[1], c[2], 0.5 * mg);
        mist.color2 = new BABYLON.Color4(c[0], c[1], c[2], 0.16 * mg);
        mist.colorDead = new BABYLON.Color4(c[0], c[1], c[2], 0);
      }

      // ── the film ──
      //
      // Tone mapping first, because without it the lit parts clip to white and
      // the unlit crush to black, and everything between — which is where form
      // lives — is thrown away.
      if (pipe) {
        pipe.fxaaEnabled = !!cfg.fxaa;
        pipe.bloomEnabled = !!cfg.bloom;
        pipe.bloomWeight = cfg.bloomAmount;
        pipe.bloomThreshold = cfg.bloomThreshold;
        pipe.bloomKernel = 48;
        pipe.imageProcessingEnabled = true;
        const ip = pipe.imageProcessing;
        if (ip) {
          ip.toneMappingEnabled = true;
          ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
          ip.exposure = cfg.exposure;
          ip.contrast = cfg.contrast;
          ip.vignetteEnabled = cfg.vignette > 0;
          ip.vignetteWeight = cfg.vignette * 4;
          ip.vignetteStretch = 0.4;
          ip.vignetteColor = new BABYLON.Color4(ground[0], ground[1], ground[2], 0);
          ip.vignetteBlendMode = BABYLON.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
        }
      }

      // ── the camera ──
      //
      // **An orbit, not a dolly on rails.** What was here slid the camera about
      // on a plane at a fixed depth and aimed it down the room's axis: `swing`
      // across, `lift` up, `eye` back, `aim` at. That is a rig for looking *at a
      // room*, and it is why the ten views could not be turned over — there was
      // no way to get round the far side of anything, only to shuffle sideways
      // and squint at it.
      //
      // This is the rig every 3D application has: a target, a distance, and two
      // angles round it. Drag turns it, shift-drag slides the target, the wheel
      // pulls in. See `wireStageDrag`.
      //
      // The old four are not deleted — they are unlisted, and `ST_CAM_LEGACY`
      // says how to read them back if this is ever wound in.
      const tgt = new BABYLON.Vector3(cfg.panX || 0, cfg.panY || 0, cfg.panZ || 0);
      const ct = Math.cos(cfg.tilt), st2 = Math.sin(cfg.tilt);
      camera.position.set(
        tgt.x + Math.sin(cfg.orbit) * ct * cfg.dist,
        tgt.y + st2 * cfg.dist,
        tgt.z - Math.cos(cfg.orbit) * ct * cfg.dist,
      );
      camera.setTarget(tgt);
      camera.fov = cfg.fov;

      scene.render();
    },
  };
}
