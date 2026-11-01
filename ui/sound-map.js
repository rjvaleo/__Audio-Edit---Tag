// The sound map: the library as a world you fly through.
//
// Every sound is a tile showing its own waveform, placed by what it sounds
// like. Up is higher, right is noisier, further away is longer; or, in the
// second layout, sounds that sound alike sit together as islands. Pass close
// to one and it plays; point at one and it is shown large, with a playhead
// while it plays; click it to fly there and read what is known about it. See
// `docs/SOUND-MAP.md`.
//
// **Everything about where a sound goes and how big it is is decided in Rust**
// (`search::map`, served by `/api/map`), and the waveform is the library's own
// overview (`/api/thumbs`, the one Browse draws). This file draws what it is
// told and handles the mouse. That split is deliberate: when the program moves
// to a native window and `wgpu`, this file is what gets replaced, and no rule
// moves with it.
//
// The tiles are sprites from one atlas: every waveform drawn once into a grid
// on a canvas, each sprite pointing at its cell. 818 tiles is one draw call,
// and a tile always faces you, so a waveform is never seen edge on.
//
// Playback goes through the engine's own audition path — `engineLoad` with
// `raw`, then `startPlayback` — the same one a click in Browse uses, so a
// sound heard here is the file as it is, through the native device.

(() => {
  'use strict';

  /// The world's width and depth. Its height follows the window's shape, so
  /// the library fills the window from edge to edge rather than sitting in a
  /// box in the middle of it.
  const W = 120;
  let H = 70;

  /// The camera's vertical field of view, in radians: Babylon's default.
  const FOV = 0.8;

  /// How close the camera has to come for a sound to play by itself.
  const REACH = 7;

  /// How long the pointer or the camera has to rest on a sound before it
  /// plays. Short enough to feel immediate, long enough that sweeping across
  /// a cluster does not load twenty files on the way.
  const DWELL_MS = 140;

  /// How long a flight takes, and how long the tour stays at each sound.
  const FLY_MS = 700;
  const TOUR_MS = 2200;

  /// How far in front of a sound a flight stops, in world units: close enough
  /// that the tile is the size of a hand on the screen.
  const STAND_OFF = 12;

  /// One atlas cell, in pixels. Twice as wide as it is tall, like a waveform.
  /// A big library gets smaller cells so the atlas stays inside what a GPU
  /// will take (8192 on a side).
  const cellFor = (n) => (n > 2000 ? { w: 96, h: 48 } : { w: 128, h: 64 });

  /// The tile's size in the world: a quiet sound must still be findable, so
  /// the range is narrow.
  const tileWidth = (p) => 4.5 + p.size * 3;

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
  let bjs = null;        // { engine, scene, camera, sprites, ... } while open
  let data = { points: [], dimensions: [] };
  let layout = 'axes';
  let glide = 1;         // 0..1 from the previous layout to this one
  let found = null;      // Set of indices that match the search, or null
  let selected = -1;
  let hovered = -1;
  let playing = '';      // path the map last asked the engine to play
  let startedPlayback = false;
  let fetchTimer = 0;
  let waves = [];        // index → Uint8Array, the waveform's columns 0..255
  let waveCount = 0;
  let touring = false;
  let tourTimer = 0;
  let trail = [];        // the sounds Tab has hopped to, in order
  let trailAt = -1;      // where in the trail we are

  const $ = (sel) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (cls, text, title, onclick) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.title = title;
    b.onclick = onclick;
    return b;
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
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const family = (p) => FAMILIES[p.family] || FAMILIES.other;

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
      const b = button(key === layout ? 'on' : '', label, `${tip} (L)`, () => setLayout(key));
      b.dataset.layout = key;
      seg.append(b);
    }
    bar.append(seg);

    const find = el('input', 'smap-find');
    find.type = 'search';
    find.placeholder = 'Find a name, label or word';
    find.oninput = () => setFind(find.value);
    find.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && found && found.size) go([...found][0]);
      if (e.key === 'Escape') { find.value = ''; setFind(''); find.blur(); }
    };
    bar.append(find, el('span', 'smap-found'));

    const moves = el('div', 'smap-seg smap-moves');
    moves.append(
      button('smap-tour', 'Tour', 'Fly from sound to sound by itself, playing each (T)', () => setTour(!touring)),
      button('smap-home', 'Whole library', 'Back to where every sound is in view (Home)', home),
    );
    bar.append(moves);

    bar.append(el('span', 'smap-status'));
    bar.append(button('smap-close', 'Close', 'Back to the library (Esc)', closeMap));

    const stage = el('div', 'smap-stage');
    const canvas = el('canvas', 'smap-world');
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
    legend.append(fams,
      el('div', 'smap-keys', 'Each tile is the sound’s waveform · size = loudness · throb = rhythm · its note, when it has one'),
      el('div', 'smap-keys',
        'Point and scroll to fly in · click a sound to go to it · Tab next sound · T tour · Home whole library · drag to look · WASD move · L layout'));
    stage.append(legend);

    for (const key of ['tonal', 'noisy', 'low', 'high', 'short', 'long']) {
      const a = el('div', 'smap-axis', key);
      a.dataset.axis = key;
      stage.append(a);
    }

    // The sound in hand, large: under the pointer, else the one clicked, else
    // the one playing. Its waveform, its name, and a playhead while it plays.
    const focus = el('div', 'smap-focus');
    focus.hidden = true;
    const fc = el('canvas');
    focus.append(fc, el('div', 'name'), el('div', 'meta'));
    stage.append(focus);

    const card = el('div', 'smap-card hidden');
    stage.append(card);

    stage.append(el('div', 'smap-empty'));

    root.append(bar, stage);
    document.body.append(root);
    ui = { canvas, card, focus, focusCanvas: fc, find, stage, status: $('.smap-status'), found: $('.smap-found'),
           empty: $('.smap-empty'), tour: $('.smap-tour') };

    root.addEventListener('keydown', (e) => {
      if (e.target === ui.find) return;
      if (e.key === 'Escape') {
        if (touring) setTour(false);
        else if (!ui.card.classList.contains('hidden')) hideCard();
        else closeMap();
        e.preventDefault();
      } else if (e.key === 'l' || e.key === 'L') {
        setLayout(layout === 'axes' ? 'islands' : 'axes');
      } else if (e.key === 't' || e.key === 'T') {
        setTour(!touring);
      } else if (e.key === 'Tab') {
        // Tab is the map's here: it hops, rather than walking focus out of
        // the map into the window underneath.
        hop(e.shiftKey ? -1 : 1);
        e.preventDefault();
      } else if (e.key === 'Home') {
        home();
        e.preventDefault();
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
    scene.fogDensity = 0.0042;
    scene.fogColor = new BABYLON.Color3(ground[0], ground[1], ground[2]);

    const camera = new BABYLON.UniversalCamera('smapCam', BABYLON.Vector3.Zero(), scene);
    camera.fov = FOV;
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
    // The wheel is ours: it flies toward what the pointer is on.
    camera.inputs.removeByType('FreeCameraMouseWheelInput');
    camera.attachControl(ui.canvas, true);

    bjs = { gl, scene, camera, sprites: null, list: [], atlas: null, tex: null, flight: null, lastNear: 0 };
    fitWorld();
    const h = homePose();
    camera.position.copyFrom(h.at);
    camera.setTarget(h.look);

    ui.canvas.addEventListener('wheel', onWheel, { passive: false });
    ui.canvas.addEventListener('pointermove', onPointerMove);
    ui.canvas.addEventListener('pointerdown', onPointerDown);
    ui.canvas.addEventListener('pointerup', onPointerUp);
    ui.canvas.addEventListener('pointerleave', () => { hovered = -1; });
    window.addEventListener('resize', onResize);

    const t0 = performance.now();
    gl.runRenderLoop(() => {
      const now = performance.now();
      step(now - t0, gl.getDeltaTime());
      scene.render();
      placeAxisLabels();
      placeFocus();
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

  function onResize() {
    if (!bjs) return;
    bjs.gl.resize();
    fitWorld();
  }

  /// The world's height from the window's shape: as tall as the window is,
  /// for its width, so the front of the library fills it both ways.
  function fitWorld() {
    const aspect = bjs.gl.getRenderWidth() / Math.max(1, bjs.gl.getRenderHeight());
    H = Math.max(40, Math.min(110, W / aspect));
  }

  /// Where the camera stands to see the whole library: straight on, back just
  /// far enough that the front of the world is exactly the window's width.
  function homePose() {
    const aspect = bjs.gl.getRenderWidth() / Math.max(1, bjs.gl.getRenderHeight());
    const half = Math.tan(FOV / 2) * aspect;
    const back = W / 2 / half;
    return {
      at: new BABYLON.Vector3(0, 0, -W / 2 - back),
      look: new BABYLON.Vector3(0, 0, -W / 2),
    };
  }

  // ------------------------------------------------------------ the tiles

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

  function rebuild() {
    if (!bjs) return;
    const pts = data.points;
    if (bjs.sprites) bjs.sprites.dispose();
    if (bjs.tex) bjs.tex.dispose();
    bjs.sprites = null;
    bjs.list = [];
    waves = [];
    waveCount = 0;
    trail = [];
    trailAt = -1;
    ui.empty.textContent = pts.length ? '' : 'Measuring the library…';
    if (!pts.length) return;

    const cell = cellFor(pts.length);
    const cols = Math.floor(2048 / cell.w);
    const rows = Math.ceil(pts.length / cols);
    const atlas = document.createElement('canvas');
    atlas.width = cols * cell.w;
    atlas.height = rows * cell.h;
    bjs.atlas = { canvas: atlas, cell, cols };
    pts.forEach((p, i) => drawTile(i));

    const tex = new BABYLON.DynamicTexture('smapAtlas', atlas, bjs.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    tex.hasAlpha = true;
    tex.update(false);
    const sprites = new BABYLON.SpriteManager('smapTiles', null, pts.length, { width: cell.w, height: cell.h }, bjs.scene);
    sprites.texture = tex;
    sprites.isPickable = true;
    sprites.fogEnabled = true;
    bjs.sprites = sprites;
    bjs.tex = tex;
    bjs.list = pts.map((p, i) => {
      const s = new BABYLON.Sprite(`smap${i}`, sprites);
      s.cellIndex = i;
      s.isPickable = true;
      return s;
    });
    paintColours();
    writeTiles(0);
    fetchWaves();
  }

  /// One tile: the waveform in its family's colour on a dark card, with the
  /// note in the corner when it has one. Drawn before the waveform has arrived
  /// as a flat line, so the library is there at once and fills in.
  function drawTile(i) {
    const { canvas, cell, cols } = bjs.atlas;
    const g = canvas.getContext('2d');
    const p = data.points[i];
    const x = (i % cols) * cell.w;
    const y = Math.floor(i / cols) * cell.h;
    const pad = 2;
    const w = cell.w - pad * 2;
    const h = cell.h - pad * 2;
    const hue = family(p).hex;
    g.clearRect(x, y, cell.w, cell.h);
    g.save();
    g.translate(x + pad, y + pad);
    g.beginPath();
    g.roundRect(0, 0, w, h, cell.h * 0.14);
    g.fillStyle = token('--sink') || '#0b0d10';
    g.fill();
    g.globalAlpha = 0.16;
    g.fillStyle = hue;
    g.fill();
    g.globalAlpha = 0.7;
    g.lineWidth = 2;
    g.strokeStyle = hue;
    g.stroke();
    g.globalAlpha = 0.55 + 0.45 * p.crisp;
    drawWave(g, waves[i], 5, 5, w - 10, h - 10, hue);
    if (p.note) {
      g.globalAlpha = 1;
      g.font = `600 ${Math.round(cell.h * 0.2)}px system-ui, sans-serif`;
      g.textBaseline = 'top';
      g.fillStyle = token('--text') || '#eee';
      g.fillText(p.note, 6, 4);
    }
    g.restore();
  }

  /// A waveform, mirrored about its middle, into the box given. Shared by the
  /// tiles and the large view, so the two are the same picture.
  function drawWave(g, cols, x, y, w, h, colour) {
    const mid = y + h / 2;
    g.fillStyle = colour;
    if (!cols || !cols.length) {
      g.fillRect(x, mid - 0.75, w, 1.5);
      return;
    }
    const n = cols.length;
    const step = w / n;
    for (let k = 0; k < n; k++) {
      const a = Math.max(1.5, (cols[k] / 255) * h);
      g.fillRect(x + k * step, mid - a / 2, Math.max(step - 0.6, 0.8), a);
    }
  }

  /// The library's own overviews, a batch at a time (the route takes 400).
  async function fetchWaves() {
    const pts = data.points;
    const want = data;
    for (let start = 0; start < pts.length; start += 400) {
      const batch = pts.slice(start, start + 400).map((p) => p.path);
      let got;
      try {
        const r = await fetch('/api/thumbs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: batch, cols: 64 }),
        });
        got = await r.json();
      } catch {
        return;
      }
      // The map was closed, or the library changed, while this was asked for.
      if (!bjs || data !== want) return;
      for (let k = 0; k < batch.length; k++) {
        const b64 = got[batch[k]];
        if (!b64) continue;
        const bin = atob(b64);
        const cols = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) cols[j] = bin.charCodeAt(j);
        waves[start + k] = cols;
        waveCount++;
        drawTile(start + k);
      }
      bjs.tex.update(false);
    }
  }

  /// Sounds outside a search fade nearly out. Darkened rather than made
  /// transparent: a sprite below the alpha cut is not drawn at all.
  function paintColours() {
    if (!bjs || !bjs.list.length) return;
    bjs.list.forEach((s, i) => {
      const dim = found && !found.has(i) ? 0.18 : 1;
      s.color = new BABYLON.Color4(dim, dim, dim, 1);
    });
  }

  /// Every tile's place and size. Throbbing ones beat at their own rate,
  /// capped so a dense roll does not become a flicker. The one in hand is
  /// drawn a little larger.
  function writeTiles(ms) {
    if (!bjs || !bjs.list.length) return;
    data.points.forEach((p, i) => {
      const s = bjs.list[i];
      let w = tileWidth(p);
      if (p.pulseHz > 0) {
        const hz = Math.min(p.pulseHz, 6);
        const beat = Math.max(0, Math.sin((ms / 1000) * hz * Math.PI * 2));
        w *= 1 + 0.14 * beat ** 4;
      }
      if (i === hovered || i === selected) w *= 1.3;
      const at = position(p);
      s.position.set(at[0], at[1], at[2]);
      s.width = w;
      s.height = w / 2;
    });
  }

  // ------------------------------------------------------------ every frame

  function step(ms, dt) {
    if (glide < 1) glide = Math.min(1, glide + dt / 1200);
    writeTiles(ms);

    if (bjs.flight) {
      const f = bjs.flight;
      const t = Math.min(1, (performance.now() - f.start) / FLY_MS);
      const e = t * t * (3 - 2 * t);
      bjs.camera.position = BABYLON.Vector3.Lerp(f.from, f.to, e);
      bjs.camera.setTarget(BABYLON.Vector3.Lerp(f.lookFrom, f.look, e));
      if (t >= 1) bjs.flight = null;
    }

    // Flying past a sound plays it, when the pointer is not already on one.
    if (hovered < 0 && !bjs.flight && performance.now() - bjs.lastNear > 200) {
      bjs.lastNear = performance.now();
      const near = nearest(bjs.camera.position, REACH);
      if (near >= 0) want(near);
    }
  }

  function nearest(pos, reach, skip) {
    let best = -1;
    let bestD = reach * reach;
    data.points.forEach((p, i) => {
      if (found && !found.has(i)) return;
      if (skip && skip.has(i)) return;
      const at = position(p);
      const d = (at[0] - pos.x) ** 2 + (at[1] - pos.y) ** 2 + (at[2] - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /// A world point on the screen, in stage pixels, and whether it is in front.
  function project(at) {
    const w = bjs.gl.getRenderWidth();
    const h = bjs.gl.getRenderHeight();
    const p = BABYLON.Vector3.Project(new BABYLON.Vector3(...at), BABYLON.Matrix.IdentityReadOnly,
      bjs.scene.getTransformMatrix(), bjs.camera.viewport.toGlobal(w, h));
    const scale = ui.canvas.clientWidth / w;
    return { x: p.x * scale, y: p.y * scale, front: p.z > 0 && p.z < 1 };
  }

  /// The axis ends, at the edges of the front of the world, nudged inside the
  /// window when they sit on its edge. Once the camera has flown in and an end
  /// is well off the screen it is not shown: held at the edge, the names would
  /// pile up in the corners. Hidden in the islands layout, whose directions
  /// mean nothing nameable.
  function placeAxisLabels() {
    if (!bjs) return;
    const show = layout === 'axes';
    const z0 = -W / 2;
    const ends = {
      tonal: [-W / 2, 0, z0], noisy: [W / 2, 0, z0],
      low: [0, -H / 2, z0], high: [0, H / 2, z0],
      short: [W * 0.35, -H / 2, z0], long: [W * 0.35, -H / 2, W / 2],
    };
    const sw = ui.canvas.clientWidth;
    const sh = ui.canvas.clientHeight;
    for (const [key, at] of Object.entries(ends)) {
      const label = root.querySelector(`[data-axis="${key}"]`);
      const p = project(at);
      const near = p.x > -60 && p.x < sw + 60 && p.y > -60 && p.y < sh + 60;
      label.hidden = !(show && p.front && near);
      if (label.hidden) continue;
      label.style.left = `${Math.max(36, Math.min(sw - 36, p.x))}px`;
      label.style.top = `${Math.max(12, Math.min(sh - 12, p.y))}px`;
    }
  }

  /// The large view of the sound in hand, over its tile.
  function placeFocus() {
    if (!bjs) return;
    const i = hovered >= 0 ? hovered : selected >= 0 ? selected : playingIndex();
    const p = i >= 0 ? data.points[i] : null;
    const at = p ? project(position(p)) : null;
    if (!p || !at.front) { ui.focus.hidden = true; return; }
    ui.focus.hidden = false;
    const live = playing === p.path && typeof engine !== 'undefined' && engine.playing;
    ui.focus.classList.toggle('playing', live);

    if (ui.focus.dataset.i !== String(i)) {
      ui.focus.dataset.i = String(i);
      ui.focus.style.setProperty('--fam', family(p).hex);
      ui.focus.querySelector('.name').textContent = p.name;
      ui.focus.querySelector('.meta').textContent =
        [p.note, family(p).name, p.label && p.label !== family(p).name ? p.label : '', fmtSeconds(p.seconds)]
          .filter(Boolean).join(' · ');
    }
    drawFocus(p, i, live);

    const box = ui.focus.getBoundingClientRect();
    const sw = ui.canvas.clientWidth;
    const sh = ui.canvas.clientHeight;
    const x = Math.max(8, Math.min(sw - box.width - 8, at.x - box.width / 2));
    const y = Math.max(8, Math.min(sh - box.height - 8, at.y - box.height / 2));
    ui.focus.style.transform = `translate(${x}px, ${y}px)`;
  }

  function drawFocus(p, i, live) {
    const c = ui.focusCanvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const hue = family(p).hex;
    drawWave(g, waves[i], 0, 0, w, h, hue);
    if (!live) return;
    const frac = (enginePosition() / engine.deviceRate / Math.max(0.01, p.seconds)) % 1;
    g.globalAlpha = 0.35;
    g.fillStyle = token('--text') || '#fff';
    g.fillRect(0, 0, frac * w, h);
    g.globalAlpha = 1;
    g.fillRect(frac * w - 1, 0, 2, h);
  }

  const playingIndex = () =>
    (playing && typeof engine !== 'undefined' && engine.playing ? data.points.findIndex((q) => q.path === playing) : -1);

  // ---------------------------------------------------------- pointer, keys

  /// What is under the pointer, by the event's own position. Not Babylon's
  /// remembered pointer: a click that arrives without a move before it would
  /// pick whatever was under the last move.
  function pick(e) {
    if (!bjs || !bjs.sprites) return -1;
    const rect = ui.canvas.getBoundingClientRect();
    const r = bjs.scene.pickSprite(e.clientX - rect.left, e.clientY - rect.top, (s) => s.manager === bjs.sprites);
    if (!r || !r.hit || !r.pickedSprite) return -1;
    return r.pickedSprite.cellIndex;
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
    if (moved > 5) { setTour(false); return; }
    const i = pick(e);
    if (i >= 0) go(i);
  }

  function onPointerMove(e) {
    if (!bjs || !bjs.sprites || (down && e.buttons)) return;
    const i = pick(e);
    hovered = i;
    if (i >= 0) want(i);
  }

  /// Fly toward whatever the pointer is on: along the line from the eye
  /// through the pointer, so what is under it stays under it and grows. A
  /// share of the way to it per notch, so a long way is quick and the last
  /// stretch is gentle, and never through it.
  function onWheel(e) {
    e.preventDefault();
    const rect = ui.canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (bjs.gl.getRenderWidth() / rect.width);
    const sy = (e.clientY - rect.top) * (bjs.gl.getRenderHeight() / rect.height);
    const ray = bjs.scene.createPickingRay(sx, sy, BABYLON.Matrix.Identity(), bjs.camera);
    const i = pick(e);
    let reach = 60;
    if (i >= 0) {
      const at = position(data.points[i]);
      reach = Math.max(0, BABYLON.Vector3.Distance(bjs.camera.position, new BABYLON.Vector3(...at)) - 3);
    }
    const share = 1 - Math.exp(-Math.abs(e.deltaY) * 0.0015);
    const move = Math.sign(-e.deltaY) * share * reach;
    bjs.flight = null;
    bjs.camera.position.addInPlace(ray.direction.scale(move));
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

  // ------------------------------------------------------------- moving

  /// Go to a sound: fly there, open its card, play it.
  function go(i) {
    flyTo(i);
    select(i);
  }

  /// Glide the camera to a sound, stopping a little in front of it.
  function flyTo(i) {
    const at = position(data.points[i]);
    const look = new BABYLON.Vector3(at[0], at[1], at[2]);
    const cam = bjs.camera;
    const back = cam.position.subtract(look);
    const len = back.length() || 1;
    flyBetween(look.add(back.scale(Math.min(len, STAND_OFF) / len)), look);
  }

  function flyBetween(to, look) {
    bjs.flight = {
      start: performance.now(),
      from: bjs.camera.position.clone(),
      to,
      lookFrom: bjs.camera.getTarget().clone(),
      look,
    };
  }

  /// Back to where the whole library is in view.
  function home() {
    if (!bjs) return;
    setTour(false);
    const h = homePose();
    flyBetween(h.at, h.look);
  }

  /// Tab: on to the nearest sound not yet visited on this walk, from the one
  /// in hand (or from what the camera is looking at). Shift+Tab: back along
  /// the walk. When every sound has been visited the walk starts over.
  function hop(dir) {
    if (!bjs || !data.points.length) return;
    if (dir < 0) {
      if (trailAt > 0) { trailAt--; go(trail[trailAt]); }
      return;
    }
    if (trailAt < trail.length - 1) { trailAt++; go(trail[trailAt]); return; }
    const from = selected >= 0 ? new BABYLON.Vector3(...position(data.points[selected])) : bjs.camera.getTarget();
    const seen = new Set(trail);
    let next = nearest(from, Infinity, seen);
    if (next < 0) {
      trail = [];
      trailAt = -1;
      next = nearest(from, Infinity, new Set(selected >= 0 ? [selected] : []));
      if (next < 0) return;
    }
    trail.push(next);
    trailAt = trail.length - 1;
    go(next);
  }

  /// The tour: Tab on a timer, until it is stopped.
  function setTour(on) {
    touring = !!on && !!bjs;
    clearInterval(tourTimer);
    if (ui.tour) ui.tour.classList.toggle('on', touring);
    if (!touring) return;
    hop(1);
    tourTimer = setInterval(() => hop(1), TOUR_MS);
  }

  // ------------------------------------------------------------ the card

  function select(i) {
    selected = i;
    const p = data.points[i];
    want(i);
    const c = ui.card;
    c.replaceChildren();
    c.append(button('x', '×', 'Close (Esc)', hideCard), el('h3', '', p.name), el('div', 'where', p.folder));

    const pitch = el('div', 'row');
    if (p.note) pitch.append(el('span', 'note', p.note), el('span', 'dim', `${p.hz.toFixed(1)} Hz`));
    else pitch.append(el('span', 'dim', 'No steady note'));
    pitch.append(el('span', 'dim', `· ${fmtSeconds(p.seconds)}`));
    c.append(pitch);

    const heard = el('div', 'row');
    const dot = el('i', 'smap-dot');
    dot.style.background = family(p).hex;
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
          b.onclick = () => { if (j >= 0) go(j); };
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

  // ------------------------------------------------------------- controls

  function setLayout(which) {
    if (!LAYOUTS.includes(which) || which === layout) return;
    layout = which;
    glide = 0;
    root.querySelectorAll('.smap-seg button[data-layout]').forEach((b) => b.classList.toggle('on', b.dataset.layout === which));
  }

  function setFind(text) {
    const q = text.trim().toLowerCase();
    if (!q) {
      found = null;
      ui.found.textContent = '';
    } else {
      found = new Set();
      data.points.forEach((p, i) => {
        const hay = [p.name, p.folder, p.label, family(p).name, p.note || '', ...(p.words || [])].join(' ').toLowerCase();
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
    if (changed) {
      data = { points: m.points || [], dimensions: m.dimensions || [] };
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
    if (!bjs) {
      start3d();
      // A fresh world: the tiles are built again from what is already known.
      if (data.points.length) rebuild();
    }
    onResize();
    ui.canvas.focus();
    load();
  }

  function closeMap() {
    clearTimeout(fetchTimer);
    setTour(false);
    silence();
    hideCard();
    hovered = -1;
    stop3d();
    root.classList.add('hidden');
  }

  /// Where sound `i` is on screen, in page pixels. For the tests, which have
  /// to point at a tile to hover or click it.
  function screenOf(i) {
    if (!bjs || !data.points[i]) return null;
    const p = project(position(data.points[i]));
    const rect = ui.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y, name: data.points[i].name };
  }

  /// How wide the library looks at the depth the camera is looking at, in
  /// pixels: the window's width at home, many windows close up.
  function span() {
    if (!bjs) return null;
    const t = bjs.camera.getTarget();
    const a = project([-W / 2, t.y, t.z]);
    const b = project([W / 2, t.y, t.z]);
    return { left: a.x, right: b.x, width: b.x - a.x };
  }

  /// How far the camera is from sound `i`, in world units.
  function distanceTo(i) {
    if (!bjs || !data.points[i]) return null;
    return BABYLON.Vector3.Distance(bjs.camera.position, new BABYLON.Vector3(...position(data.points[i])));
  }

  window.SoundMap = {
    open,
    close: closeMap,
    screenOf,
    span,
    distanceTo,
    get state() {
      return { layout, count: data.points.length, selected, found: found ? found.size : null, glide,
               open: !!root && !root.classList.contains('hidden'),
               waves: waveCount, frame: false, tour: touring };
    },
  };
})();
