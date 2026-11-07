// The sound map: Browse › Map.
//
// Every dot is one sound in the library. Sounds the model hears as alike sit
// together, so the map falls into clusters, and each cluster is named for what
// its sounds were heard as. Move across the dots and each one plays; click one
// to keep it and see the sounds most like it; from there it opens in Edit or
// on the Grain page.
//
// **Where each sound goes is decided in Rust** (`search::soundmap`, served by
// `/api/soundmap`), from YAMNet's fingerprint of the audio — the same kind of
// map XO, Atlas and the Infinite Drum Machine are built on. This file nudges
// dots apart so none hides another, draws them and handles the mouse. When the
// program moves to a native window this file is what gets replaced, and no
// rule moves with it. The 3D world (`ui/sound-map.js`) is the 3D button.
//
// Playback goes through the engine's own audition path, the one a click in
// Browse uses. See `docs/SOUND-MAP.md`.

(() => {
  'use strict';

  /// How long the pointer rests on a dot before it plays: short enough to
  /// sweep across a cluster and hear it, long enough not to load every file
  /// the pointer crosses on its way somewhere else.
  const DWELL_MS = 80;
  const FLY_MS = 600;
  /// The map's size in world units; positions arrive in a unit square.
  const WORLD = 1000;
  /// While sounds are still being listened to, how often to ask for more.
  const POLL_MS = 2500;
  /// The most sounds still to be heard that are shown, in rows under the map.
  const WAITING_SHOWN = 400;

  /// Family colours, as in the 3D world (`FAMILIES` in `ui/sound-map.js`).
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
  const TONE = [[70, 52, 190], [40, 140, 220], [40, 190, 160], [200, 210, 80], [255, 190, 70]];
  const LENGTH = [[120, 220, 255], [150, 140, 255], [220, 90, 200], [255, 110, 90]];
  const HIT = '#ff4b4b';
  const HEARD = 'rgba(111,208,140,';
  const ALIKE = 'rgba(130,195,255,';

  const COLOURS = [
    ['cluster', 'Cluster', 'One colour per cluster'],
    ['family', 'Family', 'What kind of sound it is'],
    ['tone', 'Dark → bright', 'Deep blue for a dark sound, yellow for a bright one'],
    ['length', 'Short → long', 'Pale for a hit, red for a long sound'],
  ];

  let root = null;
  let ui = {};
  let data = null;
  let dots = [];
  let tint = remembered('mapTint', 'cluster');
  let hoverPlays = remembered('mapHoverPlays', 'on') === 'on';
  let cam = { x: WORLD / 2, y: WORLD / 2, k: 1 };
  let fly = null, userMoved = false;
  let homeK = 1; // the zoom at which the whole map fits
  let VW = 0, VH = 0, DPR = 1, raf = 0, pollTimer = 0;
  let hits = null, hover = null, selected = null, focus = null;
  let playing = -1, wantTimer = 0, startedPlayback = false;
  let trail = [];
  const colours = {};
  /// How many more frames the dots are nudged apart for after they arrive.
  let settling = 0;
  /// The dots drawn once and kept, until the view or what they show changes.
  let layer = null, layerKey = '';
  /// Bumped whenever what the dots show changes without the camera moving.
  let look = 0;

  function remembered(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  }
  function remember(key, v) {
    try { localStorage.setItem(key, v); } catch { /* private window */ }
  }
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
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fam = (f) => FAMILIES[f] || FAMILIES.other;
  const secs = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)} s`
    : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  const ramp = (t, stops) => {
    t = Math.max(0, Math.min(1, t));
    const k = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    const f = t * (stops.length - 1) - k;
    const a = stops[k], b = stops[k + 1];
    return `rgb(${[0, 1, 2].map((q) => Math.round(a[q] + (b[q] - a[q]) * f)).join(',')})`;
  };
  /// A colour per cluster, a golden angle apart round the wheel, so
  /// neighbouring numbers never look alike.
  const clusterColour = (c) => (c == null ? '#5a606b' : `hsl(${Math.round((c * 137.508 + 25) % 360)},68%,62%)`);

  function canvasColour(css, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(css).trim() || fallback;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d');
    g.fillStyle = v;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  }

  // ------------------------------------------------------------- the overlay

  function build() {
    root = el('div', 'lgraph hidden');
    root.id = 'libraryGraph';
    root.tabIndex = -1;

    const bar = el('div', 'lg-bar');
    bar.append(el('span', 'lg-title', 'Sound map'));
    bar.append(el('span', 'lg-lbl', 'Colour'));
    const tints = el('div', 'lg-seg lg-tints');
    for (const [key, label, tip] of COLOURS) {
      const b = button('', label, tip, () => setTint(key));
      b.dataset.tint = key;
      tints.append(b);
    }
    bar.append(tints);
    const find = el('input', 'lg-find');
    find.type = 'search';
    find.placeholder = 'Find a sound, label or word  ( / )';
    find.oninput = () => setFind(find.value);
    find.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && hits && hits.size) goTo([...hits][0]);
      if (e.key === 'Escape') { find.value = ''; setFind(''); root.focus(); }
    };
    bar.append(find, el('span', 'lg-found'));
    bar.append(el('span', 'lg-lbl', 'Hover plays'));
    const plays = el('div', 'lg-seg lg-plays');
    for (const [key, label] of [['on', 'On'], ['off', 'Off']]) {
      const b = button('', label, key === 'on' ? 'Each sound plays as the pointer rests on it' : 'Only a click plays', () => setHoverPlays(key === 'on'));
      b.dataset.plays = key;
      plays.append(b);
    }
    bar.append(plays);
    bar.append(button('lg-home', 'Whole map', 'Back to every sound in view (Home)', home));
    bar.append(el('span', 'lg-status'));
    bar.append(button('lg-3d', '3D', 'The library as a 3D world you fly through', open3d));
    bar.append(button('lg-close', 'Close', 'Back to the library (Esc)', close));

    const stage = el('div', 'lg-stage');
    const canvas = el('canvas', 'lg-canvas');
    const now = el('div', 'lg-now');
    const legend = el('div', 'lg-legend');
    const key = el('div', 'lg-key');
    legend.append(key,
      el('div', 'lg-keys', 'Every dot is one sound · size = length · ring = it loops · names float where a kind of sound gathers'),
      el('div', 'lg-keys', 'Move across the dots to hear them · click one to keep it · scroll to zoom · drag to pan · space stop · / find · Esc back'));
    const card = el('div', 'lg-card');
    const empty = el('div', 'lg-empty');
    stage.append(canvas, now, legend, card, empty);
    root.append(bar, stage);
    document.body.append(root);
    ui = {
      canvas, g: canvas.getContext('2d'), now, key, card, empty, find,
      found: bar.querySelector('.lg-found'), status: bar.querySelector('.lg-status'),
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', () => setHover(null));
    canvas.addEventListener('dblclick', (e) => { if (!pick(e.offsetX, e.offsetY)) home(); });
    canvas.addEventListener('wheel', onWheel, { passive: false });

    root.addEventListener('keydown', (e) => {
      if (e.target === ui.find) return;
      if (e.key === 'Escape') back();
      else if (e.key === '/') ui.find.focus();
      else if (e.key === 'Home') home();
      else if (e.key === ' ') { if (playing >= 0) silence(); else if (selected) audition(selected.i); }
      else return;
      e.preventDefault();
      // While the map is up the keys are its own, not the window's beneath.
      e.stopPropagation();
    });
  }

  // --------------------------------------------------------------- the dots

  /// Lay the dots where Rust put them. A sound not listened to yet waits in
  /// rows under the map, still playable.
  function place() {
    const S = data.sounds;
    const before = new Map(dots.map((d) => [d.i, d]));
    const lens = S.map((s) => s.seconds).sort((a, b) => a - b);
    const lenRank = (x) => {
      let lo = 0, hi = lens.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (lens[m] < x) lo = m + 1; else hi = m; }
      return lo / Math.max(1, lens.length);
    };
    let waiting = 0;
    const cols = 80;
    // A few sounds still to be heard wait in rows under the map, playable. A
    // whole library's worth would dwarf it, so past a few hundred they stay
    // off the map, counted, and appear as they are heard.
    const unplaced = S.filter((s) => !s.at).length;
    const showWaiting = unplaced <= WAITING_SHOWN;
    dots = S.map((s, i) => {
      const was = before.get(i);
      const d = { i, r: 2 + lenRank(s.seconds) * 3.6, len: lenRank(s.seconds) };
      if (s.at) { d.tx = s.at[0] * WORLD; d.ty = s.at[1] * WORLD; }
      else {
        d.tx = WORLD / 2 - cols * 5 + (waiting % cols) * 10;
        d.ty = WORLD + 60 + Math.floor(waiting / cols) * 10;
        d.waiting = true;
        d.hidden = !showWaiting;
        waiting++;
      }
      d.x = was ? was.x : d.tx;
      d.y = was ? was.y : d.ty;
      return d;
    });
    // Nudged apart while they settle — not for a whole library of tens of
    // thousands, where Rust's own spacing has to do.
    settling = dots.length <= 6000 ? 90 : 0;
    for (let i = 0; i < (settling ? 40 : 0); i++) relax(1);
    look++;
  }

  /// Towards where each dot belongs, and apart where two would touch: a dot
  /// you cannot point at is a sound you cannot hear.
  function relax(pull) {
    for (const d of dots) { d.x += (d.tx - d.x) * 0.2 * pull; d.y += (d.ty - d.y) * 0.2 * pull; }
    // Hidden dots take no part.
    const C = 16, grid = new Map(), key = (x, y) => `${x},${y}`;
    for (const d of dots) {
      if (d.hidden) continue;
      const k = key(Math.floor(d.x / C), Math.floor(d.y / C));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(d);
    }
    for (const d of dots) {
      const gx = Math.floor(d.x / C), gy = Math.floor(d.y / C);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cell = grid.get(key(gx + ox, gy + oy));
        if (!cell) continue;
        for (const e of cell) {
          if (e.i <= d.i) continue;
          const dx = e.x - d.x, dy = e.y - d.y, dd = Math.hypot(dx, dy) || 0.01, m = d.r + e.r + 1.2;
          if (dd < m) {
            const p = (m - dd) / dd * 0.5;
            d.x -= dx * p; d.y -= dy * p; e.x += dx * p; e.y += dy * p;
          }
        }
      }
    }
  }

  /// How big a dot is drawn. Not its full size in the world once you zoom
  /// in, or a dot would swell to a coin; the gaps between dots open instead.
  const size = (d) => d.r * Math.min(1, Math.pow(homeK / cam.k, 0.8));

  function colourOf(s, d) {
    if (tint === 'family') return fam(s.family).hex;
    if (tint === 'tone') return s.bright == null ? '#4a505a' : ramp(s.bright, TONE);
    if (tint === 'length') return ramp(d.len, LENGTH);
    return clusterColour(s.cluster);
  }

  // ----------------------------------------------------------------- camera

  const toWorld = (sx, sy) => [(sx - VW / 2) / cam.k + cam.x, (sy - VH / 2) / cam.k + cam.y];
  const toScreen = (x, y) => [(x - cam.x) * cam.k + VW / 2, (y - cam.y) * cam.k + VH / 2];
  const cardOpen = () => ui.card.classList.contains('on');

  function resize() {
    DPR = window.devicePixelRatio || 1;
    const r = ui.canvas.getBoundingClientRect();
    VW = r.width;
    VH = r.height;
    ui.canvas.width = Math.round(VW * DPR);
    ui.canvas.height = Math.round(VH * DPR);
  }

  function fit(list, animate, maxK = 6) {
    const all = list === dots;
    list = list.filter((d) => !d.hidden);
    if (!list.length || VW < 50 || VH < 50) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of list) {
      x0 = Math.min(x0, d.x - d.r); y0 = Math.min(y0, d.y - d.r);
      x1 = Math.max(x1, d.x + d.r); y1 = Math.max(y1, d.y + d.r);
    }
    const right = cardOpen() ? 270 : 0, top = 30, bottom = 64;
    const k = Math.min(maxK, (VW - 40 - right) / Math.max(1, x1 - x0), (VH - top - bottom) / Math.max(1, y1 - y0));
    const to = { x: (x0 + x1) / 2 + right / 2 / k, y: (y0 + y1) / 2 + (bottom - top) / 2 / k, k };
    if (all) homeK = k;
    if (animate) fly = { from: { ...cam }, to, t0: performance.now() };
    else cam = to;
  }

  function flyTo(d, k) {
    const kk = Math.max(cam.k, k);
    fly = { from: { ...cam }, to: { x: d.x + (cardOpen() ? 135 / kk : 0), y: d.y, k: kk }, t0: performance.now() };
  }

  // ------------------------------------------------------------------- draw

  function draw(now) {
    const g = ui.g, k = cam.k;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = colours.ground;
    g.fillRect(0, 0, VW, VH);
    if (!data) return;
    const S = data.sounds;
    const lit = hover || selected;
    const near = new Set();
    if (lit) { near.add(lit.i); nearOf(lit.i).forEach((j) => near.add(j)); }

    // The dots: drawn again only when the view or what they show has changed,
    // and otherwise copied from the last time. Eighty thousand of them every
    // frame would leave nothing for the pointer.
    const key = [cam.x, cam.y, k, VW, VH, tint, look, focus, lit ? lit.i : -1, near.size, hits ? hits.size : -1, ui.find.value].join('|');
    if (key !== layerKey || !layer) {
      layerKey = key;
      if (!layer) layer = document.createElement('canvas');
      if (layer.width !== ui.canvas.width || layer.height !== ui.canvas.height) {
        layer.width = ui.canvas.width;
        layer.height = ui.canvas.height;
      }
      paintDots(layer.getContext('2d'), near, lit);
    }
    g.drawImage(layer, 0, 0, VW, VH);

    g.setTransform(DPR * k, 0, 0, DPR * k, DPR * (VW / 2 - cam.x * k), DPR * (VH / 2 - cam.y * k));
    g.lineCap = 'round';
    // What you just heard, as a fading path.
    for (let q = 1; q < trail.length; q++) {
      const age = (now - trail[q].t) / 5000;
      if (age > 1) continue;
      const a = dots[trail[q - 1].i], b = dots[trail[q].i];
      if (!a || !b) continue;
      g.strokeStyle = `${HEARD}${(0.55 * (1 - age)).toFixed(3)})`;
      g.lineWidth = 1.3 / k;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    if (lit) {
      nearOf(lit.i).forEach((j, q) => {
        const b = dots[j];
        if (!b) return;
        g.strokeStyle = `${ALIKE}0.7)`;
        g.lineWidth = (2 - q * 0.22) / k;
        g.beginPath(); g.moveTo(lit.x, lit.y); g.lineTo(b.x, b.y); g.stroke();
      });
    }
    if (playing >= 0 && dots[playing]) {
      const d = dots[playing], t = (now % 800) / 800;
      g.strokeStyle = `${HEARD}${(1 - t).toFixed(3)})`;
      g.lineWidth = 1.6 / k;
      g.beginPath(); g.arc(d.x, d.y, size(d) + 2 / k + t * 14 / k, 0, 7); g.stroke();
    }
    if (selected) {
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5 / k;
      g.beginPath(); g.arc(selected.x, selected.y, size(selected) + 2.5 / k, 0, 7); g.stroke();
    }
    labels(lit);
  }

  /// Every dot onto `g`, one fill per colour and shade rather than one per
  /// dot, and only those on screen.
  function paintDots(g, near, lit) {
    const k = cam.k, S = data.sounds;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, VW, VH);
    g.setTransform(DPR * k, 0, 0, DPR * k, DPR * (VW / 2 - cam.x * k), DPR * (VH / 2 - cam.y * k));
    const [x0, y0] = toWorld(-10, -10), [x1, y1] = toWorld(VW + 10, VH + 10);
    const fills = new Map(), rings = new Map();
    const add = (m, key, fn) => { let p = m.get(key); if (!p) m.set(key, p = new Path2D()); fn(p); };
    for (const d of dots) {
      if (d.hidden || d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) continue;
      const s = S[d.i];
      const hit = hits && hits.has(d.i);
      let a = 1;
      if (hits && !hit) a = 0.15;
      else if (focus != null && s.cluster !== focus) a = 0.15;
      else if (lit && !near.has(d.i)) a = 0.6;
      if (d.waiting && !hit) a *= 0.7;
      const c = hit ? HIT : colourOf(s, d);
      const r = size(d);
      if (hit) add(fills, `${HIT}|0.25`, (p) => { p.moveTo(d.x + r * 1.8, d.y); p.arc(d.x, d.y, r * 1.8, 0, 7); });
      add(fills, `${c}|${a}`, (p) => { p.moveTo(d.x + r, d.y); p.arc(d.x, d.y, r, 0, 7); });
      if (s.loops) add(rings, `${c}|${a}|${Math.min(1, r * 0.35)}`, (p) => { p.moveTo(d.x + r * 1.45, d.y); p.arc(d.x, d.y, r * 1.45, 0, 7); });
    }
    for (const [key, p] of fills) {
      const [c, a] = key.split('|');
      g.globalAlpha = +a;
      g.fillStyle = c;
      g.fill(p);
    }
    for (const [key, p] of rings) {
      const [c, a, w] = key.split('|');
      g.globalAlpha = +a;
      g.strokeStyle = c;
      g.lineWidth = +w;
      g.stroke(p);
    }
    g.globalAlpha = 1;
  }

  /// A sound's closest matches: sent with the map for a small library, asked
  /// for the first time it is pointed at for a large one.
  const asked = new Set();
  function nearOf(i) {
    const s = data.sounds[i];
    if (s.near.length || asked.has(i)) return s.near;
    asked.add(i);
    fetch(`/api/soundmap/near?i=${i}`).then((r) => (r.ok ? r.json() : null)).then((r) => {
      if (!r || !data || data.sounds[i] !== s) return;
      s.near = r.near;
      look++;
      if (selected && selected.i === i) showSound(i);
    }).catch(() => {});
    return s.near;
  }

  /// Names: the sound in hand and the ones most like it, the cluster names
  /// over their clusters, then — close up — every sound in view. Never one on
  /// top of another.
  function labels(lit) {
    const g = ui.g, S = data.sounds;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.textBaseline = 'middle';
    const taken = [];
    const fits = (x, y, w, h) => {
      for (const t of taken) if (x < t[0] + t[2] && x + w > t[0] && y < t[1] + t[3] && y + h > t[1]) return false;
      taken.push([x, y, w, h]);
      return true;
    };
    const say = (d, text, font, colour, always) => {
      const [sx, sy] = toScreen(d.x, d.y);
      if (sx < -60 || sy < -12 || sx > VW + 60 || sy > VH + 12) return;
      g.font = font;
      g.textAlign = 'left';
      const w = g.measureText(text).width, x = sx + size(d) * cam.k + 4;
      if (!fits(x, sy - 6, w, 12) && !always) return;
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillText(text, x + 0.6, sy + 0.8);
      g.fillStyle = colour;
      g.fillText(text, x, sy);
    };
    if (lit) {
      say(lit, S[lit.i].name, `600 11px ${colours.sans}`, '#fff', true);
      nearOf(lit.i).forEach((j) => { if (dots[j]) say(dots[j], S[j].name, `10px ${colours.sans}`, `${ALIKE}0.95)`); });
    }
    g.textAlign = 'center';
    // From afar only the bigger clusters are named; closer in, all of them.
    const close = cam.k >= homeK * 1.6;
    data.clusters.forEach((c, n) => {
      c.box = null;
      if (focus != null && focus !== n) return;
      if (!close && focus == null && c.size < 8) return;
      const [sx, sy] = toScreen(c.centre[0] * WORLD, c.centre[1] * WORLD);
      const size = Math.min(14, 9.5 + Math.sqrt(c.size) * 0.45);
      g.font = `600 ${size}px ${colours.sans}`;
      const w = g.measureText(c.name).width;
      const box = [sx - w / 2 - 3, sy - size / 2 - 2, w + 6, size + 4];
      if (!fits(...box)) return;
      c.box = box;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillText(c.name, sx + 1, sy + 1);
      g.fillStyle = tint === 'cluster' ? clusterColour(n) : 'rgba(240,244,250,0.92)';
      g.fillText(c.name, sx, sy);
    });
    const waiting = dots.filter((d) => d.waiting && !d.hidden).length;
    if (waiting) {
      const [sx, sy] = toScreen(WORLD / 2, WORLD + 42);
      g.font = `600 11px ${colours.sans}`;
      g.fillStyle = 'rgba(200,210,225,0.65)';
      g.fillText(data.listening ? `Still listening — ${waiting} sound${waiting === 1 ? '' : 's'}, playable already`
        : `Not placed — ${waiting} sound${waiting === 1 ? '' : 's'}, still playable`, sx, sy);
    }
    // Close enough in, every sound in view is named; the whole map's zoom is
    // the yardstick, since a library of eighty thousand starts far further out
    // than one of eight hundred.
    const named = cam.k >= homeK * 2.5;
    if (named || hits) {
      let budget = 260;
      for (const d of dots) {
        if (!budget) break;
        const hit = hits && hits.has(d.i);
        if (d.hidden || (!named && !hit) || d === lit) continue;
        say(d, S[d.i].name, `9.5px ${colours.sans}`, hit ? '#ff6b6b' : 'rgba(200,210,225,0.72)');
        budget--;
      }
    }
  }

  // ------------------------------------------------------------------ mouse

  function pick(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    let best = null, bd = Infinity;
    const reach = 6 / cam.k;
    for (const d of dots) {
      if (d.hidden || (hits && !hits.has(d.i))) continue;
      if (focus != null && data.sounds[d.i].cluster !== focus) continue;
      const e = Math.hypot(d.x - wx, d.y - wy) - size(d);
      if (e < reach && e < bd) { bd = e; best = d; }
    }
    return best;
  }

  /// A cluster's name under the pointer, or -1.
  function pickName(sx, sy) {
    if (!data) return -1;
    return data.clusters.findIndex((c) => c.box && sx >= c.box[0] && sx <= c.box[0] + c.box[2] && sy >= c.box[1] && sy <= c.box[1] + c.box[3]);
  }

  let down = null;
  function onDown(e) {
    root.focus({ preventScroll: true });
    down = { x: e.offsetX, y: e.offsetY, cam: { ...cam }, d: pick(e.offsetX, e.offsetY), name: pickName(e.offsetX, e.offsetY), moved: false };
    ui.canvas.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (!down) {
      setHover(pick(e.offsetX, e.offsetY));
      ui.canvas.classList.toggle('point', !!hover || pickName(e.offsetX, e.offsetY) >= 0);
      return;
    }
    const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
    if (!down.moved) return;
    ui.canvas.classList.add('drag');
    userMoved = true;
    fly = null;
    cam = { ...down.cam, x: down.cam.x - dx / cam.k, y: down.cam.y - dy / cam.k };
  }
  function onUp() {
    const d = down;
    down = null;
    ui.canvas.classList.remove('drag');
    if (!d || d.moved) return;
    if (d.d) choose(d.d);
    else if (d.name >= 0) gather(d.name);
    else { selected = null; hideCard(); showNow(); }
  }
  function onWheel(e) {
    e.preventDefault();
    userMoved = true;
    fly = null;
    const [wx, wy] = toWorld(e.offsetX, e.offsetY);
    cam.k = Math.min(30, Math.max(0.2, cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
    cam.x = wx - (e.offsetX - VW / 2) / cam.k;
    cam.y = wy - (e.offsetY - VH / 2) / cam.k;
  }

  function setHover(d) {
    if (d === hover) return;
    hover = d;
    clearTimeout(wantTimer);
    if (d && hoverPlays) wantTimer = setTimeout(() => { if (hover === d) audition(d.i); }, DWELL_MS);
    showNow();
  }

  function choose(d) {
    selected = d;
    showSound(d.i);
    audition(d.i);
    showNow();
  }

  /// One cluster in view, the rest faded, its sounds listed.
  function gather(c) {
    focus = c;
    selected = null;
    showCluster(c);
    fit(dots.filter((d) => data.sounds[d.i].cluster === c), true, 10);
  }

  function goTo(i) {
    const d = dots[i];
    if (!d) return;
    if (focus != null && data.sounds[i].cluster !== focus) focus = null;
    showSound(i);
    audition(i);
    // Not heard yet, so not on the map: its card, and it plays, but there is
    // nowhere to fly to.
    if (d.hidden) { selected = null; return; }
    selected = d;
    flyTo(d, 3.2);
    userMoved = true;
  }

  function home() {
    focus = null;
    selected = null;
    hideCard();
    showNow();
    fit(dots, true);
    userMoved = false;
  }

  /// Escape steps back one thing at a time: the search, the card, the
  /// gathered cluster, the sound playing, then the map itself.
  function back() {
    if (hits) { ui.find.value = ''; setFind(''); }
    else if (cardOpen()) { selected = null; hideCard(); showNow(); }
    else if (focus != null) home();
    else if (playing >= 0) silence();
    else close();
  }

  // ------------------------------------------------------------------- card

  function showNow() {
    const d = hover || selected;
    if (!d || !data) { ui.now.innerHTML = ''; return; }
    const s = data.sounds[d.i];
    const c = s.cluster != null ? data.clusters[s.cluster] : null;
    ui.now.innerHTML = `<b>${esc(s.name)}</b> · ${secs(s.seconds)}${c ? ` · <span style="color:${clusterColour(s.cluster)}">${esc(c.name)}</span>` : ''}` +
      `${s.words.length ? ` · <span class="d">${esc(s.words.slice(0, 4).join(', '))}</span>` : ''}` +
      (playing === d.i ? ' <span class="p">▶ playing</span>' : '');
  }

  function hideCard() { ui.card.classList.remove('on'); }

  function rows(list) {
    return `<div class="lg-list">${list.map((i) => {
      const s = data.sounds[i];
      return `<div data-i="${i}"><i style="background:${colourOf(s, dots[i] || { len: 0 })}"></i><span class="nm">${esc(s.name)}</span><span class="sub">${secs(s.seconds)}</span></div>`;
    }).join('')}</div>`;
  }

  function wireCard() {
    ui.card.querySelectorAll('.lg-list div').forEach((row) => {
      const i = +row.dataset.i;
      row.onclick = () => goTo(i);
      row.onmouseenter = () => { if (dots[i]) setHover(dots[i]); };
      row.onmouseleave = () => setHover(null);
    });
    ui.card.querySelectorAll('.lg-chip[data-find]').forEach((c) => {
      c.onclick = () => { ui.find.value = c.dataset.find; setFind(c.dataset.find); };
    });
  }

  function showSound(i) {
    const s = data.sounds[i];
    const c = s.cluster != null ? data.clusters[s.cluster] : null;
    const chips = (list) => list.map((w) => `<span class="lg-chip" data-find="${esc(w)}">${esc(w)}</span>`).join('') || '<span class="sub">—</span>';
    ui.card.innerHTML = `
      <h3>${esc(s.name)}</h3>
      <div class="lg-where">${esc(s.folder ? `${s.folder} · ${s.collection}` : s.collection)}</div>
      ${c ? `<div class="lg-row"><span>Cluster</span><span class="lg-link" data-cluster="${s.cluster}" style="color:${clusterColour(s.cluster)}">${esc(c.name)}</span></div>` : ''}
      <div class="lg-row"><span>Heard as</span><div class="lg-chips">${chips(s.heard)}</div></div>
      <div class="lg-row"><span>Sounds</span><div class="lg-chips">${chips(s.words)}</div></div>
      <div class="lg-row"><span>Length</span><span>${secs(s.seconds)}${s.note ? ` · note ${esc(s.note)}` : ''}${s.kind ? ` · ${esc(s.kind)}` : ''}</span></div>
      <div class="lg-btns">
        <button type="button" data-do="play" title="Play it again (space)">▶ Play</button>
        <button type="button" data-do="edit" title="Open it in the editor">Edit</button>
        <button type="button" data-do="grain" title="Open it on the Grain page">Grain</button>
      </div>
      <div class="lg-sec">Most like it — rest on one to hear it, click to go</div>
      ${nearOf(i).length ? rows(s.near) : `<div class="sub">${s.at ? 'Finding them…' : 'Not listened to yet'}</div>`}`;
    ui.card.querySelector('[data-do="play"]').onclick = () => audition(i, true);
    ui.card.querySelector('[data-do="edit"]').onclick = () => openIn(s, 'edit');
    ui.card.querySelector('[data-do="grain"]').onclick = () => openIn(s, 'grain');
    const link = ui.card.querySelector('[data-cluster]');
    if (link) link.onclick = () => gather(+link.dataset.cluster);
    ui.card.classList.add('on');
    wireCard();
  }

  function showCluster(c) {
    const members = data.sounds.map((s, i) => (s.cluster === c ? i : -1)).filter((i) => i >= 0)
      .sort((a, b) => data.sounds[a].name.localeCompare(data.sounds[b].name));
    const cl = data.clusters[c];
    ui.card.innerHTML = `<h3 style="color:${clusterColour(c)}">${esc(cl.name)}</h3>
      <div class="lg-where">Cluster · ${members.length} sound${members.length === 1 ? '' : 's'} · mostly ${fam(cl.family).name.toLowerCase()}</div>
      <div class="lg-sec">Its sounds — rest on one to hear it, click to go</div>${rows(members)}`;
    ui.card.classList.add('on');
    wireCard();
  }

  async function openIn(s, page) {
    if (typeof resolveFile !== 'function' || typeof openInEditor !== 'function') return;
    const file = await resolveFile(s.path);
    close();
    if (page === 'grain' && typeof setEditPage === 'function') setEditPage('grain', false);
    await openInEditor(file);
  }

  // -------------------------------------------------------------- listening

  async function audition(i, again = false) {
    const s = data && data.sounds[i];
    if (!s) return;
    if (playing === i && !again && typeof engine !== 'undefined' && engine.playing) return;
    playing = i;
    trail.push({ i, t: performance.now() });
    if (trail.length > 16) trail.shift();
    showNow();
    if (typeof engineLoad !== 'function') return;
    if (!(await engineLoad({ path: s.path }, { raw: true }))) return;
    // Another sound may have been asked for while this one loaded.
    if (playing !== i) return;
    seekSource(0);
    startPlayback();
    startedPlayback = true;
  }

  function silence() {
    clearTimeout(wantTimer);
    playing = -1;
    if (startedPlayback && typeof pausePlayback === 'function' && engine.playing) pausePlayback();
    startedPlayback = false;
    showNow();
  }

  // ------------------------------------------------------------------- find

  function setFind(q) {
    const t = q.trim().toLowerCase();
    if (!t || !data) { hits = null; ui.found.textContent = ''; return; }
    hits = new Set();
    data.sounds.forEach((s, i) => { if (s.text.includes(t)) hits.add(i); });
    ui.found.textContent = `${hits.size} found`;
  }

  // ---------------------------------------------------------------- choices

  function setTint(t) {
    if (!COLOURS.some((c) => c[0] === t)) t = 'cluster';
    tint = t;
    remember('mapTint', t);
    look++;
    root.querySelectorAll('.lg-tints [data-tint]').forEach((b) => b.classList.toggle('on', b.dataset.tint === t));
    drawKey();
    if (selected && data) showSound(selected.i);
  }

  function setHoverPlays(on) {
    hoverPlays = on;
    remember('mapHoverPlays', on ? 'on' : 'off');
    root.querySelectorAll('.lg-plays [data-plays]').forEach((b) => b.classList.toggle('on', (b.dataset.plays === 'on') === on));
    if (!on) clearTimeout(wantTimer);
  }

  function drawKey() {
    if (!data) { ui.key.innerHTML = ''; return; }
    if (tint === 'family') {
      const c = {};
      data.sounds.forEach((s) => { c[s.family] = (c[s.family] || 0) + 1; });
      ui.key.innerHTML = Object.entries(FAMILIES).filter(([k]) => c[k])
        .map(([k, f]) => `<span><i style="background:${f.hex}"></i>${f.name} ${c[k]}</span>`).join('');
    } else if (tint === 'cluster') {
      ui.key.innerHTML = `<span>${data.clusters.length} clusters — click a name to gather it</span>`;
    } else {
      const [lo, hi, st] = tint === 'tone' ? ['dark', 'bright', TONE] : ['short', 'long', LENGTH];
      ui.key.innerHTML = `<span>${lo}<b class="lg-ramp" style="background:linear-gradient(90deg,${st.map((c) => `rgb(${c})`).join(',')})"></b>${hi}</span>`;
    }
  }

  // ------------------------------------------------------------------- loop

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (settling > 0) { relax(0.5); settling--; look++; }
    if (!userMoved && !fly && focus == null && dots.length) fit(dots, false);
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / FLY_MS), e = t * t * (3 - 2 * t);
      const k = Math.exp(Math.log(fly.from.k) + (Math.log(fly.to.k) - Math.log(fly.from.k)) * e);
      cam = { x: fly.from.x + (fly.to.x - fly.from.x) * e, y: fly.from.y + (fly.to.y - fly.from.y) * e, k };
      if (t >= 1) fly = null;
    }
    draw(now);
  }

  async function load() {
    clearTimeout(pollTimer);
    if (!data) ui.empty.textContent = 'Reading the library…';
    let next;
    try {
      const r = await fetch('/api/soundmap');
      if (!r.ok) throw new Error(`${r.status}`);
      next = await r.json();
    } catch (e) {
      ui.empty.textContent = `Could not read the library (${e.message}).`;
      return;
    }
    if (!root || root.classList.contains('hidden')) return;
    for (const s of next.sounds) {
      const parts = s.path.split('/');
      s.collection = parts[0];
      s.folder = parts.length > 2 ? parts[1] : '';
      const c = s.cluster != null ? next.clusters[s.cluster] : null;
      s.text = [s.name, s.folder, s.collection, s.kind, c ? c.name : '', ...s.heard, ...s.words].join(' ').toLowerCase();
    }
    data = next;
    place();
    ui.empty.textContent = data.count ? '' : 'Nothing in the library yet.';
    ui.status.textContent = `${data.count} sound${data.count === 1 ? '' : 's'} · ${data.clusters.length} cluster${data.clusters.length === 1 ? '' : 's'}` +
      (data.listening ? ` · ${dots.filter((d) => !d.waiting).length} on the map, listening to ${data.listening} more…` : '');
    drawKey();
    setFind(ui.find.value);
    if (selected) selected = dots[selected.i] || null;
    if (hover) hover = dots[hover.i] || null;
    if (data.listening) pollTimer = setTimeout(load, POLL_MS);
  }

  function onResize() {
    resize();
    if (!userMoved && focus == null) fit(dots, false);
  }

  function open() {
    if (!root) build();
    colours.ground = canvasColour('--sink', '#0b0d10');
    colours.sans = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'sans-serif';
    root.classList.remove('hidden');
    setTint(tint);
    setHoverPlays(hoverPlays);
    resize();
    window.addEventListener('resize', onResize);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    userMoved = false;
    root.focus({ preventScroll: true });
    load();
  }

  function close() {
    if (!root) return;
    clearTimeout(pollTimer);
    silence();
    hideCard();
    hover = null;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    root.classList.add('hidden');
  }

  function open3d() {
    close();
    if (window.SoundMap) window.SoundMap.open();
  }

  /// Where sound `i` is on screen, in page pixels. For the tests, which have
  /// to point at a dot to hover or click it.
  function screenOf(i) {
    const d = dots[i];
    if (!d) return null;
    const [x, y] = toScreen(d.x, d.y);
    const r = ui.canvas.getBoundingClientRect();
    return { x: r.left + x, y: r.top + y, name: data.sounds[i].name };
  }

  window.LibraryGraph = {
    open,
    close,
    screenOf,
    get state() {
      return {
        open: !!root && !root.classList.contains('hidden'),
        tint, hoverPlays,
        count: data ? data.count : 0,
        dots: dots.length,
        placed: dots.filter((d) => !d.waiting).length,
        clusters: data ? data.clusters.length : 0,
        listening: data ? data.listening : null,
        selected: selected ? selected.i : null,
        playing,
        focus,
        found: hits ? hits.size : null,
      };
    },
  };
})();
