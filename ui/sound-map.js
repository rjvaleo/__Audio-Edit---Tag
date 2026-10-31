// The sound map: the library as a world you fly through.
//
// Every sound is an object, placed by what it sounds like. Up is higher, right
// is noisier, further away is longer; or, in the second layout, sounds that
// sound alike sit together as islands. Pass close to one and it plays; click
// it for what is known about it. See `docs/SOUND-MAP.md`.
//
// **Everything about where a sound goes and how it looks is decided in Rust**
// (`search::map`, served by `/api/map`). This file draws what it is told and
// handles the mouse. That split is deliberate: when the program moves to a
// native window and `wgpu`, this file is what gets replaced, and no rule moves
// with it.
//
// Two meshes, instanced: a smooth sphere for a sound with a note, a faceted
// one for a sound without. 818 objects is two draw calls.
//
// Playback goes through the engine's own audition path — `engineLoad` with
// `raw`, then `startPlayback` — the same one a click in Browse uses, so a
// sound heard here is the file as it is, through the native device.

(() => {
  'use strict';

  /// The world's size. Wider and deeper than it is tall: you walk across a
  /// library more than you climb it.
  const W = 120;
  const H = 70;

  /// How close the camera has to come for a sound to play by itself.
  const REACH = 7;

  /// How long the pointer or the camera has to rest on a sound before it
  /// plays. Short enough to feel immediate, long enough that sweeping across
  /// a cluster does not load twenty files on the way.
  const DWELL_MS = 140;

  /// Colour carries family, and nothing else. Seven is about as many as the
  /// eye keeps apart at a glance; each is pitched to read on the dark ground.
  const FAMILIES = {
    percussion: { name: 'Percussion', hex: '#f2a33a' },
    voice:      { name: 'Voice',      hex: '#ef6f8e' },
    instrument: { name: 'Instrument', hex: '#4fc3e8' },
    music:      { name: 'Music',      hex: '#a98bf0' },
    machine:    { name: 'Machine',    hex: '#9aa7b8' },
    nature:     { name: 'Nature',     hex: '#6fd08c' },
    other:      { name: 'Other',      hex: '#d9c38f' },
    unknown:    { name: 'Not heard',  hex: '#6c7480' },
  };

  const LAYOUTS = ['axes', 'islands'];

  let root = null;       // the overlay
  let ui = {};           // its parts, by name
  let bjs = null;        // { engine, scene, camera, meshes, ... } while open
  let data = { points: [], dimensions: [] };
  let layout = 'axes';
  let glide = 1;         // 0..1 from the previous layout to this one
  let found = null;      // Set of indices that match the search, or null
  let selected = -1;
  let hovered = -1;
  let playing = '';      // path the map last asked the engine to play
  let startedPlayback = false;
  let fetchTimer = 0;

  const $ = (sel) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /// A CSS colour, whatever its notation, as 0..1 RGB. The theme is written in
  /// oklch and Babylon wants numbers, so the browser does the conversion.
  function rgb(css) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d');
    g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  }
  const familyCache = {};
  const familyRgb = (f) => (familyCache[f] ||= rgb((FAMILIES[f] || FAMILIES.other).hex));
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ------------------------------------------------------------- the overlay

  function build() {
    root = el('div', 'smap hidden');
    root.id = 'soundMap';

    const bar = el('div', 'smap-bar');
    bar.append(el('span', 'smap-title', 'Sound map'));

    const seg = el('div', 'smap-seg');
    for (const [key, label, tip] of [
      ['axes', 'Axes', 'Up is higher, right is noisier, further is longer'],
      ['islands', 'Islands', 'Sounds that sound alike, together'],
    ]) {
      const b = el('button', key === layout ? 'on' : '', label);
      b.type = 'button';
      b.title = `${tip} (L)`;
      b.dataset.layout = key;
      b.onclick = () => setLayout(key);
      seg.append(b);
    }
    bar.append(seg);

    const find = el('input', 'smap-find');
    find.type = 'search';
    find.placeholder = 'Find a name, label or word';
    find.oninput = () => setFind(find.value);
    find.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && found && found.size) flyTo([...found][0]);
      if (e.key === 'Escape') { find.value = ''; setFind(''); find.blur(); }
    };
    bar.append(find, el('span', 'smap-found'));

    bar.append(el('span', 'smap-status'));
    const close = el('button', 'smap-close', 'Close');
    close.type = 'button';
    close.title = 'Back to the library (Esc)';
    close.onclick = closeMap;
    bar.append(close);

    const stage = el('div', 'smap-stage');
    const canvas = el('canvas');
    canvas.tabIndex = 0;
    stage.append(canvas);

    const legend = el('div', 'smap-legend');
    const fams = el('div', 'smap-fams');
    for (const [key, f] of Object.entries(FAMILIES)) {
      const s = el('span', 'smap-fam');
      s.dataset.family = key;
      const dot = el('i', 'smap-dot');
      dot.style.background = f.hex;
      s.append(dot, f.name);
      fams.append(s);
    }
    const shapes = el('div', 'smap-fams');
    const solid = el('span', 'smap-fam');
    const sd = el('i', 'smap-dot');
    sd.style.background = 'var(--text-dim)';
    solid.append(sd, 'has a note');
    const grain = el('span', 'smap-fam');
    const gd = el('i', 'smap-dot grain');
    gd.style.background = 'var(--text-dim)';
    grain.append(gd, 'no steady note');
    shapes.append(solid, grain, el('span', 'smap-fam', 'size = loudness · throb = rhythm'));
    legend.append(fams, shapes, el('div', 'smap-keys',
      'Drag to look · WASD or arrows to move · Q/E down/up · scroll to go forward · L switches layout'));
    stage.append(legend);

    for (const key of ['tonal', 'noisy', 'low', 'high', 'short', 'long']) {
      const a = el('div', 'smap-axis', key);
      a.dataset.axis = key;
      stage.append(a);
    }

    const tip = el('div', 'smap-tip');
    tip.hidden = true;
    stage.append(tip);

    const card = el('div', 'smap-card hidden');
    stage.append(card);

    stage.append(el('div', 'smap-empty'));

    root.append(bar, stage);
    document.body.append(root);
    ui = { canvas, card, tip, find, stage, status: $('.smap-status'), found: $('.smap-found'),
           empty: $('.smap-empty') };

    root.addEventListener('keydown', (e) => {
      if (e.target === ui.find) return;
      if (e.key === 'Escape') {
        if (!ui.card.classList.contains('hidden')) hideCard();
        else closeMap();
        e.preventDefault();
      } else if (e.key === 'l' || e.key === 'L') {
        setLayout(layout === 'axes' ? 'islands' : 'axes');
      } else if (e.key === '/') {
        ui.find.focus();
        e.preventDefault();
      }
      // The app's own shortcuts (space for play, and the rest) belong to the
      // window underneath; while the map is up, keys are the map's.
      e.stopPropagation();
    });
  }

  // ------------------------------------------------------------------ world

  function start3d() {
    // Not called `engine`: that name is the app's audio engine, which this
    // file talks to below.
    const gl = new BABYLON.Engine(ui.canvas, true, { stencil: false, preserveDrawingBuffer: false });
    const scene = new BABYLON.Scene(gl);
    const ground = rgb(token('--sink') || '#0b0d10');
    scene.clearColor = new BABYLON.Color4(ground[0], ground[1], ground[2], 1);
    // A little haze, so depth reads as depth: far sounds are fainter, as far
    // things are.
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0032;
    scene.fogColor = new BABYLON.Color3(ground[0], ground[1], ground[2]);

    const light = new BABYLON.HemisphericLight('smapSky', new BABYLON.Vector3(0.3, 1, -0.4), scene);
    light.intensity = 0.95;
    light.groundColor = new BABYLON.Color3(0.22, 0.24, 0.3);

    // Three-quarters on, from the near low corner: every axis is in view, so
    // the first look says which way is up, right and away.
    const camera = new BABYLON.UniversalCamera('smapCam', new BABYLON.Vector3(-W * 0.75, H * 0.6, -W * 1.35), scene);
    camera.setTarget(new BABYLON.Vector3(0, -H * 0.12, 0));
    camera.minZ = 0.1;
    camera.speed = 1.1;
    camera.inertia = 0.82;
    camera.angularSensibility = 2600;
    camera.keysUp = [87, 38];
    camera.keysDown = [83, 40];
    camera.keysLeft = [65, 37];
    camera.keysRight = [68, 39];
    camera.keysUpward = [69];
    camera.keysDownward = [81];
    camera.attachControl(ui.canvas, true);

    const material = (name, flat) => {
      const m = new BABYLON.StandardMaterial(name, scene);
      m.diffuseColor = new BABYLON.Color3(1, 1, 1);
      m.specularColor = flat ? new BABYLON.Color3(0.05, 0.05, 0.05) : new BABYLON.Color3(0.35, 0.35, 0.35);
      m.specularPower = 48;
      m.emissiveColor = new BABYLON.Color3(0.24, 0.24, 0.27);
      return m;
    };
    // A sound with a note is a smooth solid; one without is cut into facets,
    // grain-like. The difference is visible at a distance where colour is not.
    const solid = BABYLON.MeshBuilder.CreateSphere('smapSolid', { diameter: 1, segments: 14 }, scene);
    solid.material = material('smapSolidMat', false);
    const grain = BABYLON.MeshBuilder.CreateIcoSphere('smapGrain', { radius: 0.55, subdivisions: 1, flat: true }, scene);
    grain.material = material('smapGrainMat', true);
    for (const m of [solid, grain]) {
      m.thinInstanceEnablePicking = true;
      m.isVisible = false;
    }

    // The bounds of the world, and a floor, so up and away are legible.
    const lines = [];
    const x0 = -W / 2, x1 = W / 2, y0 = -H / 2, y1 = H / 2, z0 = -W / 2, z1 = W / 2;
    const v = (x, y, z) => new BABYLON.Vector3(x, y, z);
    for (const [a, b] of [
      [v(x0, y0, z0), v(x1, y0, z0)], [v(x0, y0, z1), v(x1, y0, z1)],
      [v(x0, y0, z0), v(x0, y0, z1)], [v(x1, y0, z0), v(x1, y0, z1)],
      [v(x0, y1, z0), v(x1, y1, z0)], [v(x0, y1, z1), v(x1, y1, z1)],
      [v(x0, y1, z0), v(x0, y1, z1)], [v(x1, y1, z0), v(x1, y1, z1)],
      [v(x0, y0, z0), v(x0, y1, z0)], [v(x1, y0, z0), v(x1, y1, z0)],
      [v(x0, y0, z1), v(x0, y1, z1)], [v(x1, y0, z1), v(x1, y1, z1)],
    ]) lines.push([a, b]);
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      lines.push([v(x0 + W * t, y0, z0), v(x0 + W * t, y0, z1)]);
      lines.push([v(x0, y0, z0 + W * t), v(x1, y0, z0 + W * t)]);
    }
    const frame = BABYLON.MeshBuilder.CreateLineSystem('smapFrame', { lines }, scene);
    const lc = rgb(token('--text-dimmer') || '#556');
    frame.color = new BABYLON.Color3(lc[0], lc[1], lc[2]);
    frame.alpha = 0.18;
    frame.isPickable = false;

    // The ring round whatever is selected.
    const ring = BABYLON.MeshBuilder.CreateTorus('smapRing', { diameter: 1, thickness: 0.05, tessellation: 48 }, scene);
    const rm = new BABYLON.StandardMaterial('smapRingMat', scene);
    const ac = rgb(token('--accent') || '#3af');
    rm.emissiveColor = new BABYLON.Color3(ac[0], ac[1], ac[2]);
    rm.disableLighting = true;
    ring.material = rm;
    ring.isPickable = false;
    ring.isVisible = false;
    ring.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    ring.rotation.x = Math.PI / 2;

    bjs = { gl, scene, camera, solid, grain, ring, frame, flight: null, lastNear: 0, mat: {}, col: {} };

    ui.canvas.addEventListener('wheel', onWheel, { passive: false });
    ui.canvas.addEventListener('pointermove', onPointerMove);
    ui.canvas.addEventListener('pointerdown', onPointerDown);
    ui.canvas.addEventListener('pointerup', onPointerUp);
    ui.canvas.addEventListener('pointerleave', () => { hovered = -1; ui.tip.hidden = true; });
    window.addEventListener('resize', onResize);

    const t0 = performance.now();
    gl.runRenderLoop(() => {
      const now = performance.now();
      step(now - t0, gl.getDeltaTime());
      scene.render();
      placeAxisLabels();
    });
  }

  function stop3d() {
    if (!bjs) return;
    window.removeEventListener('resize', onResize);
    bjs.gl.stopRenderLoop();
    bjs.scene.dispose();
    bjs.gl.dispose();
    bjs = null;
  }

  const onResize = () => bjs && bjs.gl.resize();

  // ------------------------------------------------------------ the objects

  /// Where point `i` sits in `which` layout, in world units.
  function spot(p, which) {
    const c = p[which];
    return [(c[0] - 0.5) * W, (c[1] - 0.5) * H, (c[2] - 0.5) * W];
  }

  /// Where it is now: between the two layouts while gliding.
  function position(p) {
    const to = spot(p, layout);
    if (glide >= 1) return to;
    const from = spot(p, layout === 'axes' ? 'islands' : 'axes');
    const t = glide * glide * (3 - 2 * glide);
    return [0, 1, 2].map((k) => from[k] + (to[k] - from[k]) * t);
  }

  /// Size from loudness. The range is narrow on purpose: a quiet sound must
  /// still be findable.
  const radius = (p) => 0.75 + p.size * 1.5;

  function rebuild() {
    if (!bjs) return;
    const pts = data.points;
    const groups = { solid: [], grain: [] };
    pts.forEach((p, i) => groups[p.pitched ? 'solid' : 'grain'].push(i));
    bjs.groups = groups;
    for (const kind of ['solid', 'grain']) {
      const mesh = bjs[kind];
      const n = groups[kind].length;
      mesh.isVisible = n > 0;
      if (!n) continue;
      // Kept and written in place; Babylon holds the same arrays and is told
      // when they change.
      bjs.mat[kind] = new Float32Array(16 * n);
      bjs.col[kind] = new Float32Array(4 * n);
      mesh.thinInstanceSetBuffer('matrix', bjs.mat[kind], 16, false);
      mesh.thinInstanceSetBuffer('color', bjs.col[kind], 4, false);
    }
    // A fixed tilt per object, so faceted ones do not all show the same face.
    // Seeded from the index, so it is the same on every visit.
    bjs.tilt = pts.map((_, i) => {
      const r = Math.sin(i * 12.9898) * 43758.5453;
      return BABYLON.Quaternion.RotationYawPitchRoll(r % 6.28, (r * 1.7) % 6.28, (r * 2.3) % 6.28);
    });
    paintColours();
    writeMatrices(0);
    ui.empty.textContent = pts.length ? '' : 'Measuring the library…';
  }

  /// Colour from family; brightness from how crisp its start is, so a hit
  /// glints and a swell glows dimly. Sounds outside a search fade nearly out.
  function paintColours() {
    if (!bjs || !bjs.groups) return;
    for (const kind of ['solid', 'grain']) {
      const idx = bjs.groups[kind];
      if (!idx.length) continue;
      const buf = bjs.col[kind];
      idx.forEach((i, k) => {
        const p = data.points[i];
        const c = familyRgb(p.family);
        const lit = 0.55 + 0.45 * p.crisp;
        const dim = found && !found.has(i) ? 0.12 : 1;
        buf.set([c[0] * lit * dim, c[1] * lit * dim, c[2] * lit * dim, 1], k * 4);
      });
      bjs[kind].thinInstanceBufferUpdated('color');
    }
  }

  const scratch = { s: null, t: null, m: null };

  /// Every object's matrix. Throbbing ones beat at their own rate, capped so a
  /// dense roll does not become a flicker.
  function writeMatrices(ms) {
    if (!bjs || !bjs.groups) return;
    scratch.s = scratch.s || new BABYLON.Vector3();
    scratch.t = scratch.t || new BABYLON.Vector3();
    scratch.m = scratch.m || new BABYLON.Matrix();
    for (const kind of ['solid', 'grain']) {
      const idx = bjs.groups[kind];
      if (!idx.length) continue;
      const mesh = bjs[kind];
      const buf = bjs.mat[kind];
      idx.forEach((i, k) => {
        const p = data.points[i];
        let r = radius(p);
        if (p.pulseHz > 0) {
          const hz = Math.min(p.pulseHz, 6);
          const beat = Math.max(0, Math.sin((ms / 1000) * hz * Math.PI * 2));
          r *= 1 + 0.18 * beat ** 4;
        }
        // Rough sounds are drawn slightly lumpy: stretched on one side.
        const lump = kind === 'grain' ? 1 + 0.35 * p.rough : 1;
        const at = position(p);
        scratch.s.set(r * lump, r, r / Math.sqrt(lump));
        scratch.t.set(at[0], at[1], at[2]);
        BABYLON.Matrix.ComposeToRef(scratch.s, bjs.tilt[i], scratch.t, scratch.m);
        scratch.m.copyToArray(buf, k * 16);
      });
      mesh.thinInstanceBufferUpdated('matrix');
      mesh.thinInstanceRefreshBoundingInfo(false);
    }
  }

  // ------------------------------------------------------------ every frame

  function step(ms, dt) {
    const moving = glide < 1;
    if (moving) glide = Math.min(1, glide + dt / 1200);
    const pulsing = data.points.some((p) => p.pulseHz > 0);
    if (moving || pulsing) writeMatrices(ms);

    if (bjs.flight) {
      const f = bjs.flight;
      const t = Math.min(1, (performance.now() - f.start) / 700);
      const e = t * t * (3 - 2 * t);
      bjs.camera.position = BABYLON.Vector3.Lerp(f.from, f.to, e);
      bjs.camera.setTarget(BABYLON.Vector3.Lerp(f.lookFrom, f.look, e));
      if (t >= 1) bjs.flight = null;
    }

    const sel = selected >= 0 ? data.points[selected] : null;
    bjs.ring.isVisible = !!sel;
    if (sel) {
      const at = position(sel);
      bjs.ring.position.set(at[0], at[1], at[2]);
      bjs.ring.scaling.setAll(radius(sel) * 2.6);
    }

    // Flying past a sound plays it, when the pointer is not already on one.
    if (hovered < 0 && performance.now() - bjs.lastNear > 200) {
      bjs.lastNear = performance.now();
      const near = nearest(bjs.camera.position, REACH);
      if (near >= 0) want(near);
    }
  }

  function nearest(pos, reach) {
    let best = -1;
    let bestD = reach * reach;
    data.points.forEach((p, i) => {
      if (found && !found.has(i)) return;
      const at = position(p);
      const d = (at[0] - pos.x) ** 2 + (at[1] - pos.y) ** 2 + (at[2] - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /// The axis ends, drawn where the world puts them. Hidden in the islands
  /// layout, whose directions mean nothing nameable.
  function placeAxisLabels() {
    if (!bjs) return;
    const show = layout === 'axes';
    const ends = {
      tonal: [-W / 2 - 5, -H / 2, 0], noisy: [W / 2 + 5, -H / 2, 0],
      low: [-W / 2, -H / 2 - 3, -W / 2], high: [-W / 2, H / 2 + 3, -W / 2],
      short: [0, -H / 2 - 3, -W / 2 - 5], long: [0, -H / 2 - 3, W / 2 + 5],
    };
    const w = bjs.gl.getRenderWidth();
    const h = bjs.gl.getRenderHeight();
    const scale = ui.canvas.clientWidth / w;
    const vp = bjs.camera.viewport.toGlobal(w, h);
    const m = bjs.scene.getTransformMatrix();
    for (const [key, at] of Object.entries(ends)) {
      const label = root.querySelector(`[data-axis="${key}"]`);
      const p = BABYLON.Vector3.Project(new BABYLON.Vector3(...at), BABYLON.Matrix.IdentityReadOnly, m, vp);
      const visible = show && p.z > 0 && p.z < 1;
      label.hidden = !visible;
      if (visible) {
        label.style.left = `${p.x * scale}px`;
        label.style.top = `${p.y * scale}px`;
      }
    }
  }

  // ---------------------------------------------------------- pointer, keys

  /// What is under the pointer, by the event's own position. Not Babylon's
  /// remembered pointer: a click that arrives without a move before it would
  /// pick whatever was under the last move.
  function pick(e) {
    const rect = ui.canvas.getBoundingClientRect();
    const r = bjs.scene.pick(e.clientX - rect.left, e.clientY - rect.top, (m) => m === bjs.solid || m === bjs.grain);
    if (!r || !r.hit || r.thinInstanceIndex === undefined || r.thinInstanceIndex < 0) return -1;
    const group = bjs.groups[r.pickedMesh === bjs.solid ? 'solid' : 'grain'];
    return group[r.thinInstanceIndex] ?? -1;
  }

  let down = null;

  function onPointerDown(e) {
    down = { x: e.clientX, y: e.clientY };
    ui.canvas.focus();
  }

  function onPointerUp(e) {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    const i = pick(e);
    if (i >= 0) select(i);
  }

  function onPointerMove(e) {
    if (!bjs || !bjs.groups || (down && e.buttons)) return;
    const i = pick(e);
    hovered = i;
    if (i < 0) { ui.tip.hidden = true; return; }
    const p = data.points[i];
    const rect = ui.stage.getBoundingClientRect();
    ui.tip.style.left = `${e.clientX - rect.left}px`;
    ui.tip.style.top = `${e.clientY - rect.top}px`;
    ui.tip.replaceChildren(document.createTextNode(p.name), el('span', 'dim',
      `  ${p.note || ''}${p.note ? ' · ' : ''}${(FAMILIES[p.family] || FAMILIES.other).name}`));
    ui.tip.hidden = false;
    want(i);
  }

  function onWheel(e) {
    e.preventDefault();
    const fwd = bjs.camera.getDirection(BABYLON.Axis.Z);
    bjs.camera.position.addInPlace(fwd.scale(-e.deltaY * 0.04));
  }

  // ------------------------------------------------------------- listening

  let wanted = -1;
  let wantTimer = 0;

  /// Ask for a sound; it plays if it is still wanted a moment later.
  function want(i) {
    if (i === wanted) return;
    wanted = i;
    clearTimeout(wantTimer);
    wantTimer = setTimeout(() => { if (wanted === i) audition(data.points[i]); }, DWELL_MS);
  }

  async function audition(p) {
    if (!p || typeof engineLoad !== 'function') return;
    if (playing === p.path && engine.playing) return;
    playing = p.path;
    if (!(await engineLoad({ path: p.path }, { raw: true }))) return;
    // Another sound may have been asked for while this one loaded.
    if (playing !== p.path) return;
    seekSource(0);
    startPlayback();
    startedPlayback = true;
  }

  function silence() {
    clearTimeout(wantTimer);
    wanted = -1;
    playing = '';
    if (startedPlayback && typeof pausePlayback === 'function' && engine.playing) pausePlayback();
    startedPlayback = false;
  }

  // ------------------------------------------------------------ the card

  function select(i) {
    selected = i;
    const p = data.points[i];
    want(i);
    const c = ui.card;
    c.replaceChildren();
    const x = el('button', 'x', '×');
    x.type = 'button';
    x.title = 'Close (Esc)';
    x.onclick = hideCard;
    c.append(x, el('h3', '', p.name), el('div', 'where', p.folder));

    const pitch = el('div', 'row');
    if (p.note) pitch.append(el('span', 'note', p.note), el('span', 'dim', `${p.hz.toFixed(1)} Hz`));
    else pitch.append(el('span', 'dim', 'No steady note'));
    pitch.append(el('span', 'dim', `· ${fmtSeconds(p.seconds)}`));
    c.append(pitch);

    const fam = FAMILIES[p.family] || FAMILIES.other;
    const heard = el('div', 'row');
    const dot = el('i', 'smap-dot');
    dot.style.background = fam.hex;
    heard.append(dot, el('span', '', p.label || 'Not heard yet'));
    if (p.from) heard.append(el('span', 'dim', `like ${p.from.split('/').pop()}`));
    c.append(heard);

    if (p.words && p.words.length) {
      const chips = el('div', 'chips');
      for (const w of p.words) chips.append(el('span', 'chip', w));
      c.append(chips);
    }

    // The twelve measurements, as the bar each fills. The ones that duplicate
    // brightness are left out; the card is for reading, not for auditing.
    const keep = ['duration', 'loudness', 'crest', 'brightness', 'flatness', 'attack', 'low', 'pulse', 'density'];
    const bars = el('div', 'bars');
    keep.forEach((name) => {
      const k = data.dimensions.indexOf(name);
      if (k < 0 || !p.v) return;
      const b = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.round(p.v[k] * 100)}%`;
      b.append(fill);
      bars.append(el('span', '', name), b);
    });
    c.append(el('div', 'lbl', 'Measured'), bars);

    const sim = el('div', 'sim');
    c.append(el('div', 'lbl', 'Sounds like'), sim);
    fetch(`/api/similar?p=${encodeURIComponent(p.path)}&limit=5`)
      .then((r) => r.json())
      .then((r) => {
        if (selected !== i) return;
        for (const s of r.results || []) {
          const j = data.points.findIndex((q) => q.path === s.path);
          const b = el('button');
          b.type = 'button';
          b.append(el('span', '', s.name || s.path.split('/').pop()), el('span', 'score', `${Math.round(s.score * 100)}%`));
          b.onclick = () => { if (j >= 0) { flyTo(j); select(j); } };
          sim.append(b);
        }
      })
      .catch(() => sim.append(el('span', 'dim', 'Not available')));

    c.classList.remove('hidden');
  }

  function hideCard() {
    selected = -1;
    ui.card.classList.add('hidden');
    ui.canvas.focus();
  }

  const fmtSeconds = (s) => (s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

  /// Glide the camera to a sound, stopping a little in front of it.
  function flyTo(i) {
    const at = position(data.points[i]);
    const look = new BABYLON.Vector3(at[0], at[1], at[2]);
    const cam = bjs.camera;
    const back = cam.position.subtract(look);
    const len = back.length() || 1;
    const to = look.add(back.scale(Math.min(len, 12) / len));
    bjs.flight = {
      start: performance.now(),
      from: cam.position.clone(),
      to,
      lookFrom: cam.getTarget().clone(),
      look,
    };
  }

  // ------------------------------------------------------------- controls

  function setLayout(which) {
    if (!LAYOUTS.includes(which) || which === layout) return;
    layout = which;
    glide = 0;
    root.querySelectorAll('.smap-seg button').forEach((b) => b.classList.toggle('on', b.dataset.layout === which));
  }

  function setFind(text) {
    const q = text.trim().toLowerCase();
    if (!q) {
      found = null;
      ui.found.textContent = '';
    } else {
      found = new Set();
      data.points.forEach((p, i) => {
        const fam = (FAMILIES[p.family] || FAMILIES.other).name;
        const hay = [p.name, p.folder, p.label, fam, p.note || '', ...(p.words || [])].join(' ').toLowerCase();
        if (hay.includes(q)) found.add(i);
      });
      ui.found.textContent = `${found.size} found`;
    }
    paintColours();
  }

  // ---------------------------------------------------------------- data

  /// Ask for the map until every sound is measured. Each request measures
  /// another batch on the server, so a library being measured for the first
  /// time fills in while you watch rather than holding one long request.
  async function load() {
    clearTimeout(fetchTimer);
    if (!root || root.classList.contains('hidden')) return;
    let m;
    try {
      m = await (await fetch('/api/map')).json();
    } catch (e) {
      ui.status.textContent = 'Could not reach the library';
      return;
    }
    const changed = m.count !== data.points.length;
    data = { points: m.points || [], dimensions: m.dimensions || [] };
    if (changed) {
      selected = -1;
      ui.card.classList.add('hidden');
      rebuild();
      if (ui.find.value) setFind(ui.find.value);
    }
    ui.status.textContent = m.waiting > 0
      ? `${m.count} placed · measuring ${m.waiting} more…`
      : `${m.count} sounds`;
    countFamilies();
    if (m.waiting > 0) fetchTimer = setTimeout(load, 250);
  }

  function countFamilies() {
    const n = {};
    for (const p of data.points) n[p.family] = (n[p.family] || 0) + 1;
    root.querySelectorAll('.smap-fam[data-family]').forEach((s) => {
      s.hidden = !n[s.dataset.family];
      s.title = `${n[s.dataset.family] || 0} sounds`;
    });
  }

  // ------------------------------------------------------------ open, close

  function open() {
    if (!root) build();
    if (typeof BABYLON === 'undefined') {
      if (typeof toast === 'function') toast('The 3D engine did not load');
      return;
    }
    root.classList.remove('hidden');
    if (!bjs) start3d();
    onResize();
    ui.canvas.focus();
    load();
  }

  function closeMap() {
    clearTimeout(fetchTimer);
    silence();
    hideCard();
    stop3d();
    root.classList.add('hidden');
  }

  /// Where sound `i` is on screen, in page pixels. For the tests, which have
  /// to point at a sphere to hover or click it.
  function screenOf(i) {
    if (!bjs || !data.points[i]) return null;
    const w = bjs.gl.getRenderWidth();
    const h = bjs.gl.getRenderHeight();
    const p = BABYLON.Vector3.Project(new BABYLON.Vector3(...position(data.points[i])),
      BABYLON.Matrix.IdentityReadOnly, bjs.scene.getTransformMatrix(), bjs.camera.viewport.toGlobal(w, h));
    const rect = ui.canvas.getBoundingClientRect();
    const scale = rect.width / w;
    return { x: rect.left + p.x * scale, y: rect.top + p.y * scale, name: data.points[i].name };
  }

  window.SoundMap = {
    open,
    close: closeMap,
    screenOf,
    get state() {
      return { layout, count: data.points.length, selected, found: found ? found.size : null, glide,
               open: !!root && !root.classList.contains('hidden') };
    },
  };
})();
