// The sound map: Browse › Map, in 3D.
//
// Every node is one sound in the library — move onto it and it plays, and the
// panel at the bottom shows which sound it is: its waveform, with a playhead
// running while it sounds. Three ways to see the same sounds, picked from the
// strip (or 1, 2, 3):
//
//   Cloud           the sound space itself, as the Embedding Projector shows
//                   one: sounds the model hears as alike sit together, in three
//                   dimensions you turn and fly into.
//   Constellations  a 3D force graph: each group of alike sounds a glowing hub,
//                   its sounds round it, neighbouring groups joined.
//   Tag web         what the sounds were heard as, linked by how often the
//                   labels go together, with the sounds hanging off them.
//
// Click a hub — or a group's name in the cloud — to go into it: every sound in
// that group, each tied to the sounds most like it. The breadcrumb, or Escape,
// comes back out. Click a sound to keep it: its card, the sounds most like it,
// and Edit or Grain.
//
// Where each sound sits, and which group it is in, is decided in Rust
// (`search::soundmap`, `/api/soundmap`), from YAMNet's fingerprint of the
// audio. The drawing is 3d-force-graph (three.js underneath), vendored in
// `ui/vendor/`. A library of eighty thousand sounds is more than any 3D graph
// can draw at once, so the top level shows a fair sample of each group, and
// going in shows all of it. See `docs/SOUND-MAP.md`.
//
// **Two places, one map.** It is the full-window overlay opened from Browse ›
// Map, and it is in Browse itself, to the right of the sound's details
// (`mount`, `browse`). One map moved between the two rather than two maps: a
// second would be a second load of the whole library and a second scene.

(() => {
  'use strict';

  /// How long the pointer rests on a sound before it plays.
  const DWELL_MS = 80;
  /// The sound space's size in the scene.
  const SPACE = 700;
  /// Most sounds drawn at once. Past a few thousand a 3D graph stops turning
  /// smoothly; going into a group shows all of its sounds, up to this.
  const CAP = 3000;
  const POLL_MS = 2500;
  /// Coming back to Browse within this long, the map it showed is still the
  /// library: a big one is megabytes to read again on every visit.
  const RELOAD_MS = 30000;

  /// Twelve colours that sit together on the dark: soft, never neon, each
  /// clearly its own. A group takes one by its number.
  const PALETTE = ['#7fd1c8', '#f2b880', '#e89aa8', '#a9a3f0', '#9fd38a', '#f0d77d',
    '#7fb4f0', '#d6a5e0', '#f29e7d', '#8fd3f0', '#c9d98a', '#e0b0a0'];
  const FAMILIES = {
    percussion: ['Percussion', '#f2b880'], voice: ['Voice', '#e89aa8'], instrument: ['Instrument', '#7fb4f0'],
    music: ['Music', '#a9a3f0'], machine: ['Machine', '#a8b2c0'], nature: ['Nature', '#9fd38a'],
    other: ['Other', '#e0cfa0'], unknown: ['Not heard', '#6c7480'],
  };
  const LOOSE = '#5d6470';
  const HIT = '#ff5a5a';
  const ALIKE = '#8fc7ff';
  const HEARD = '#6fd08c';

  const VIEWS = [
    ['cloud', 'Cloud', 'The sound space in 3D: alike sounds together (1)'],
    ['stars', 'Constellations', 'Each group of alike sounds a hub, its sounds round it (2)'],
    ['tags', 'Tag web', 'What the sounds were heard as, linked, with the sounds on them (3)'],
  ];
  const TINTS = [['group', 'Group'], ['family', 'Family'], ['tone', 'Dark → bright']];

  let root = null, ui = {}, graph = null;
  let data = null;
  let view = remembered('mapView', 'cloud');
  let tint = remembered('mapTint3', 'group');
  let hoverPlays = remembered('mapHoverPlays', 'on') === 'on';
  /// The group gone into: { kind: 'cluster' | 'tag', key, label }, or null.
  let inside = null;
  let nodes = [], links = [], nodeOf = new Map();
  let hover = null, selected = null, hits = null;
  /// Whether the camera has framed the sounds now shown (`show`), for the
  /// tests: until then a sound's place on screen is about to move.
  let framed = false, frameSerial = 0;
  let playing = -1, playStart = 0, wantTimer = 0, startedPlayback = false;
  let trail = [];
  let pollTimer = 0, raf = 0;
  /// The box Browse gives the map (`mount`), and whether the full-window
  /// overlay has it now. With both, the overlay borrows it and gives it back.
  let host = null, overlay = false, hostWatch = null, loadedAt = 0;
  const peaks = new Map();

  function remembered(k, fallback) { try { return localStorage.getItem(k) || fallback; } catch { return fallback; } }
  function remember(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } }
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
  const secs = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)} s`
    : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  const groupColour = (c) => (c == null ? LOOSE : PALETTE[c % PALETTE.length]);
  const famColour = (f) => (FAMILIES[f] || FAMILIES.other)[1];
  const tone = (b) => {
    if (b == null) return LOOSE;
    const stops = [[70, 80, 190], [60, 150, 210], [90, 200, 170], [220, 210, 110], [250, 180, 90]];
    const t = Math.max(0, Math.min(1, b)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    return `rgb(${[0, 1, 2].map((q) => Math.round(stops[k][q] + (stops[k + 1][q] - stops[k][q]) * f)).join(',')})`;
  };
  /// A fixed shuffle: the same sounds are picked as a group's sample each time.
  const mix = (i) => { let z = (i + 0x9e3779b9) >>> 0; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0; z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0; return (z ^ (z >>> 16)) >>> 0; };

  // ------------------------------------------------------------- the overlay

  function build() {
    root = el('div', 'lgraph hidden');
    root.id = 'libraryGraph';
    root.tabIndex = -1;
    const bar = el('div', 'lg-bar');
    bar.append(el('span', 'lg-title', 'Sound map'));
    const views = el('div', 'lg-seg lg-views');
    VIEWS.forEach(([key, label, tip], n) => {
      const b = button('', `${n + 1} ${label}`, tip, () => setView(key));
      b.dataset.view = key;
      views.append(b);
    });
    bar.append(views);
    const crumb = el('span', 'lg-crumb');
    bar.append(crumb);
    bar.append(el('span', 'lg-lbl', 'Colour'));
    const tints = el('div', 'lg-seg lg-tints');
    for (const [key, label] of TINTS) {
      const b = button('', label, `Colour by ${label.toLowerCase()}`, () => setTint(key));
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
      if (e.key === 'Enter' && hits && hits.size) goTo([...hits].find((i) => nodeOf.has(i)) ?? [...hits][0]);
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
    bar.append(el('span', 'lg-status'));
    bar.append(button('lg-3d', 'Fly-through', 'The older 3D world you fly through with the keys', openWorld));
    // In Browse, the same map over the whole window; over it, back to Browse.
    bar.append(button('lg-big', 'Full window', 'The map over the whole window', open));
    bar.append(button('lg-close', 'Close', 'Back to the library (Esc)', close));

    const stage = el('div', 'lg-stage');
    const scene = el('div', 'lg-scene');
    const over = el('canvas', 'lg-over');
    const panel = el('div', 'lg-panel');
    panel.innerHTML = '<canvas class="lg-wave"></canvas><div class="lg-pname"></div><div class="lg-pmeta"></div>';
    const legend = el('div', 'lg-legend');
    legend.append(el('div', 'lg-key'), el('div', 'lg-keys',
      'Every node is a sound · rest on one to hear it · click to keep it · click a hub or a name to go in · drag to turn · scroll to fly · right-drag to slide · / find · Esc back'));
    const card = el('div', 'lg-card');
    const empty = el('div', 'lg-empty');
    stage.append(scene, over, panel, legend, card, empty);
    root.append(bar, stage);
    document.body.append(root);
    ui = {
      scene, over, og: over.getContext('2d'), panel, wave: panel.querySelector('.lg-wave'),
      pname: panel.querySelector('.lg-pname'), pmeta: panel.querySelector('.lg-pmeta'),
      key: legend.querySelector('.lg-key'), card, empty, find, crumb,
      found: bar.querySelector('.lg-found'), status: bar.querySelector('.lg-status'),
    };

    root.addEventListener('keydown', (e) => {
      if (e.target === ui.find) return;
      if (e.key === 'Escape') back();
      else if (e.key === '/') ui.find.focus();
      else if (e.key === '1' || e.key === '2' || e.key === '3') setView(VIEWS[+e.key - 1][0]);
      else if (e.key === ' ') { if (playing >= 0) silence(); else if (selected) audition(selected.si, true); }
      else return;
      e.preventDefault();
      // While the map is up the keys are its own, not the window's beneath.
      e.stopPropagation();
    });
  }

  function makeGraph() {
    graph = ForceGraph3D({ controlType: 'orbit' })(ui.scene)
      .backgroundColor('#06080c')
      .showNavInfo(false)
      .nodeRelSize(2.2)
      .nodeResolution(8)
      .nodeOpacity(0.95)
      .nodeLabel(() => '')
      .nodeVal((n) => n.val)
      .nodeColor((n) => colourOf(n))
      .linkColor((l) => (l.kind === 'tie' ? 'rgba(170,200,240,0.35)' : l.kind === 'hub' ? 'rgba(200,215,235,0.35)' : 'rgba(200,215,235,0.16)'))
      .linkWidth((l) => (l.kind === 'hub' ? 0.6 : 0))
      .linkOpacity(0.5)
      .linkDirectionalParticles((l) => (hover && (l.source === hover || l.target === hover) ? 3 : 0))
      .linkDirectionalParticleWidth(1.4)
      .linkDirectionalParticleSpeed(0.012)
      .enableNodeDrag(true)
      .onNodeHover(onHover)
      .onNodeClick(onClick)
      .onBackgroundClick((e) => { if (!onNameClick(e)) { selected = null; hideCard(); showPanel(); } });
    graph.controls().autoRotate = false;
  }

  // ------------------------------------------------------------------ views

  /// The sounds shown: a fair sample of every group at the top level, all of
  /// the group gone into, and always whatever was found.
  function pick(members) {
    if (members.length <= CAP) return members;
    return [...members].sort((a, b) => mix(a) - mix(b)).slice(0, CAP);
  }

  function placed() { return data.sounds.map((s, i) => (s.at ? i : -1)).filter((i) => i >= 0); }

  const at = (s) => ({ x: (s.at[0] - 0.5) * SPACE, y: (s.at[1] - 0.5) * SPACE, z: (s.at[2] - 0.5) * SPACE });

  function soundNode(i, extra) {
    const s = data.sounds[i];
    // A long sound is a little bigger; never so much that it hides its
    // neighbours.
    return Object.assign({ id: `s${i}`, si: i, kind: 'sound', val: 0.6 + Math.min(2.2, Math.log1p(s.seconds) * 0.6) }, extra);
  }

  /// Each sound tied to its `k` nearest among `list`, in the sound space:
  /// the inside of a group is a web of alike sounds.
  function ties(list, k) {
    const out = [], seen = new Set();
    const P = list.map((i) => data.sounds[i].at);
    for (let a = 0; a < list.length; a++) {
      const best = [];
      for (let b = 0; b < list.length; b++) {
        if (a === b) continue;
        const d = (P[a][0] - P[b][0]) ** 2 + (P[a][1] - P[b][1]) ** 2 + (P[a][2] - P[b][2]) ** 2;
        if (best.length < k || d < best[best.length - 1][0]) {
          best.push([d, b]); best.sort((x, y) => x[0] - y[0]); if (best.length > k) best.pop();
        }
      }
      for (const [, b] of best) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ source: `s${list[a]}`, target: `s${list[b]}`, kind: 'tie' });
      }
    }
    return out;
  }

  /// Inside a group: every one of its sounds where it sits in the sound space,
  /// that corner of the space stretched to fill the view, each sound tied to
  /// the two most like it. Held still, so what is near is what is alike.
  function insideOf(list) {
    list = pick(list);
    const P = list.map((i) => data.sounds[i].at);
    const lo = [0, 1, 2].map((k) => Math.min(...P.map((p) => p[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...P.map((p) => p[k])));
    const span = Math.max(1e-6, ...[0, 1, 2].map((k) => hi[k] - lo[k]));
    const ns = list.map((i, a) => {
      const q = [0, 1, 2].map((k) => ((P[a][k] - (lo[k] + hi[k]) / 2) / span) * SPACE);
      return soundNode(i, { fx: q[0], fy: q[1], fz: q[2], val: soundNode(i).val * 2.2 });
    });
    return { nodes: ns, links: ties(list, 2), fixed: true };
  }

  function buildCloud() {
    if (inside) return insideOf(placed().filter((i) => data.sounds[i].cluster === inside.key));
    const list = pick(placed());
    const ns = list.map((i) => { const p = at(data.sounds[i]); return soundNode(i, { fx: p.x, fy: p.y, fz: p.z }); });
    return { nodes: ns, links: [], fixed: true };
  }

  function buildStars() {
    const S = data.sounds;
    if (inside) return insideOf(placed().filter((i) => S[i].cluster === inside.key));
    const groups = data.clusters.map((c, n) => ({ n, c, members: [] }));
    const loose = [];
    for (const i of placed()) (S[i].cluster != null ? groups[S[i].cluster].members : loose).push(i);
    const per = Math.max(6, Math.floor(CAP / Math.max(1, groups.length)));
    const ns = [], ls = [];
    for (const g of groups) {
      const c = g.c.centre;
      const hub = { id: `c${g.n}`, kind: 'hub', group: g.n, label: g.c.name, size: g.c.size, val: 6 + Math.sqrt(g.c.size) * 0.9,
        x: (c[0] - 0.5) * SPACE, y: (c[1] - 0.5) * SPACE, z: (c[2] - 0.5) * SPACE };
      ns.push(hub);
      const shown = [...g.members].sort((a, b) => mix(a) - mix(b)).slice(0, per);
      hub.more = g.members.length - shown.length;
      for (const i of shown) {
        ns.push(soundNode(i, { x: hub.x + (Math.random() - 0.5) * 30, y: hub.y + (Math.random() - 0.5) * 30, z: hub.z + (Math.random() - 0.5) * 30 }));
        ls.push({ source: hub.id, target: `s${i}`, kind: 'spoke' });
      }
    }
    // Each group joined to the two whose middles are nearest its own.
    const seen = new Set();
    for (const a of groups) {
      const near = groups.filter((b) => b !== a)
        .map((b) => [b, a.c.centre.reduce((t, v, k) => t + (v - b.c.centre[k]) ** 2, 0)])
        .sort((x, y) => x[1] - y[1]).slice(0, 2);
      for (const [b] of near) {
        const key = a.n < b.n ? `${a.n}:${b.n}` : `${b.n}:${a.n}`;
        if (!seen.has(key)) { seen.add(key); ls.push({ source: `c${a.n}`, target: `c${b.n}`, kind: 'hub' }); }
      }
    }
    for (const i of loose.slice(0, 200)) ns.push(soundNode(i, at(S[i])));
    return { nodes: ns, links: ls };
  }

  function buildTags() {
    const S = data.sounds;
    const tagOf = new Map();
    placed().forEach((i) => {
      for (const l of S[i].heard) {
        if (!tagOf.has(l)) tagOf.set(l, []);
        tagOf.get(l).push(i);
      }
    });
    if (inside) return insideOf((tagOf.get(inside.key) || []).filter((i) => S[i].at));
    const tags = [...tagOf.entries()].filter(([, m]) => m.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 90);
    const index = new Map(tags.map(([l], n) => [l, n]));
    const ns = [], ls = [];
    const fam = (m) => { const c = {}; m.forEach((i) => { c[S[i].family] = (c[S[i].family] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; };
    tags.forEach(([l, m], n) => ns.push({ id: `t${n}`, kind: 'tag', tag: l, label: l, size: m.length, family: fam(m), val: 5 + Math.sqrt(m.length) * 0.8 }));
    // Each sound hangs off the first of its labels that is drawn.
    const per = Math.max(5, Math.floor(CAP / Math.max(1, tags.length)));
    const hung = new Map();
    for (const i of placed()) {
      const l = S[i].heard.find((x) => index.has(x));
      if (l == null) continue;
      if (!hung.has(l)) hung.set(l, []);
      hung.get(l).push(i);
    }
    for (const [l, m] of hung) {
      const n = index.get(l);
      const shown = [...m].sort((a, b) => mix(a) - mix(b)).slice(0, per);
      ns[n].more = m.length - shown.length;
      for (const i of shown) { ns.push(soundNode(i)); ls.push({ source: `t${n}`, target: `s${i}`, kind: 'spoke' }); }
    }
    // Labels joined by how often they are heard together, more than chance.
    const together = new Map();
    for (const i of placed()) {
      const ts = S[i].heard.filter((x) => index.has(x)).map((x) => index.get(x));
      for (let a = 0; a < ts.length; a++) for (let b = a + 1; b < ts.length; b++) {
        const key = ts[a] < ts[b] ? `${ts[a]}:${ts[b]}` : `${ts[b]}:${ts[a]}`;
        together.set(key, (together.get(key) || 0) + 1);
      }
    }
    const total = placed().length;
    const best = new Map();
    for (const [key, c] of together) {
      const [a, b] = key.split(':').map(Number);
      const lift = c * total / (tags[a][1].length * tags[b][1].length);
      if (c < 2 || lift < 1.15) continue;
      for (const t of [a, b]) { if (!best.has(t)) best.set(t, []); best.get(t).push([c * Math.log1p(lift), key]); }
    }
    const kept = new Set();
    for (const list of best.values()) list.sort((x, y) => y[0] - x[0]).slice(0, 3).forEach(([, k]) => kept.add(k));
    for (const key of kept) { const [a, b] = key.split(':'); ls.push({ source: `t${a}`, target: `t${b}`, kind: 'hub' }); }
    return { nodes: ns, links: ls };
  }

  function show() {
    if (!data || !graph) return;
    const g = view === 'stars' ? buildStars() : view === 'tags' ? buildTags() : buildCloud();
    // What was found but is not among the sounds shown is added, so a find
    // always has something to show.
    if (hits) {
      const have = new Set(g.nodes.filter((n) => n.kind === 'sound').map((n) => n.si));
      for (const i of [...hits].slice(0, 300)) {
        if (have.has(i) || !data.sounds[i].at) continue;
        if (inside && view === 'cloud' && data.sounds[i].cluster !== inside.key) continue;
        const p = at(data.sounds[i]);
        g.nodes.push(soundNode(i, g.fixed ? { fx: p.x, fy: p.y, fz: p.z } : p));
      }
    }
    nodes = g.nodes;
    links = g.links;
    nodeOf = new Map(nodes.filter((n) => n.kind === 'sound').map((n) => [n.si, n]));
    graph.d3Force('charge').strength(g.fixed ? 0 : view === 'tags' ? -40 : -18);
    graph.d3Force('link').distance((l) => (l.kind === 'hub' ? 140 : l.kind === 'spoke' ? 26 : 14)).strength((l) => (l.kind === 'hub' ? 0.08 : l.kind === 'spoke' ? 0.6 : 0.4));
    graph.cooldownTicks(g.fixed ? 0 : 400);
    graph.graphData({ nodes, links });
    hover = null;
    if (selected) selected = nodeOf.get(selected.si) || null;
    framed = false;
    const k = ++frameSerial;
    setTimeout(() => {
      graph.zoomToFit(900, 30);
      setTimeout(() => { if (k === frameSerial) framed = true; }, 950);
    }, g.fixed ? 60 : 1600);
    drawKey();
    sayWhere();
  }

  function colourOf(n) {
    if (n.kind === 'hub') return groupColour(n.group);
    if (n.kind === 'tag') return famColour(n.family);
    const s = data.sounds[n.si];
    if (hits && hits.has(n.si)) return HIT;
    const c = tint === 'family' ? famColour(s.family) : tint === 'tone' ? tone(s.bright) : groupColour(s.cluster);
    return hits ? dim(c) : c;
  }
  /// The same colour, sunk most of the way into the dark.
  function dim(c) {
    const m = c.startsWith('#') ? [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)) : c.match(/\d+/g).map(Number);
    return `rgb(${m.map((v) => Math.round(v * 0.22 + 6)).join(',')})`;
  }

  function recolour() { if (graph) graph.nodeColor(graph.nodeColor()); }

  // ---------------------------------------------------------------- going in

  function enter(kind, key, label) {
    inside = { kind, key, label };
    selected = null;
    hideCard();
    show();
  }

  function leave() {
    inside = null;
    show();
  }

  function sayWhere() {
    ui.crumb.innerHTML = inside
      ? `<span class="lg-up">Library</span> › <b>${esc(inside.label)}</b>`
      : '';
    const up = ui.crumb.querySelector('.lg-up');
    if (up) up.onclick = leave;
    root.querySelectorAll('.lg-views [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  }

  // ------------------------------------------------------------------ mouse

  function onHover(n) {
    ui.scene.style.cursor = n ? 'pointer' : '';
    if (n === hover) return;
    hover = n;
    clearTimeout(wantTimer);
    if (n && n.kind === 'sound' && hoverPlays) wantTimer = setTimeout(() => { if (hover === n) audition(n.si); }, DWELL_MS);
    if (n && n.kind === 'sound') nearOf(n.si);
    // Particles run along whatever touches what is under the pointer.
    graph.linkDirectionalParticles(graph.linkDirectionalParticles());
    showPanel();
  }

  function onClick(n) {
    if (n.kind === 'hub') { enter('cluster', n.group, n.label); return; }
    if (n.kind === 'tag') { enter('tag', n.tag, n.label); return; }
    selected = n;
    showSound(n.si);
    audition(n.si, true);
    showPanel();
    pickInLibrary(n.si);
  }

  /// In Browse the map is the library seen another way, so a sound clicked on
  /// it is picked as a click in the tree picks it: its waveform and details
  /// fill the middle, and the tree marks it. Over the whole window there is
  /// no middle to fill, and it stays as it was.
  async function pickInLibrary(i) {
    if (overlay || !host || typeof resolveFile !== 'function' || typeof selectFile !== 'function') return;
    const s = data && data.sounds[i];
    if (!s) return;
    const file = await resolveFile(s.path);
    // Another sound may have been clicked, or Browse left, while it was found.
    if (!file || overlay || !host || !data || data.sounds[i] !== s || (selected && selected.si !== i)) return;
    if (state.selectedFile?.path !== file.path) selectFile(file);
  }

  /// A click on a group's name floating in the cloud goes into that group.
  function onNameClick(e) {
    const r = ui.over.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = (ui.names || []).find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (hit) enter('cluster', hit.group, hit.label);
    return !!hit;
  }

  function goTo(i) {
    let n = nodeOf.get(i);
    if (!n) {
      const s = data.sounds[i];
      if (s.at && view !== 'tags' && s.cluster != null) { enter('cluster', s.cluster, data.clusters[s.cluster].name); n = nodeOf.get(i); }
    }
    showSound(i);
    audition(i, true);
    pickInLibrary(i);
    if (!n) return;
    selected = n;
    const p = { x: n.x ?? n.fx, y: n.y ?? n.fy, z: n.z ?? n.fz };
    const len = Math.hypot(p.x, p.y, p.z) || 1;
    graph.cameraPosition({ x: p.x * (1 + 80 / len), y: p.y * (1 + 80 / len), z: p.z * (1 + 80 / len) + 40 }, p, 900);
    showPanel();
  }

  /// Escape steps back one thing at a time: the search, the card, the group
  /// gone into, the sound playing, then the map itself.
  function back() {
    if (hits) { ui.find.value = ''; setFind(''); }
    else if (ui.card.classList.contains('on')) { selected = null; hideCard(); showPanel(); }
    else if (inside) leave();
    else if (playing >= 0) silence();
    else if (overlay) close();
  }

  // ------------------------------------------------- what is under the pointer

  /// The panel: the waveform of the sound under the pointer (or the one kept),
  /// its name and where it belongs, and a playhead while it sounds.
  function showPanel() {
    const n = hover && hover.kind === 'sound' ? hover : selected;
    if (!n) {
      const h = hover;
      if (h && (h.kind === 'hub' || h.kind === 'tag')) {
        ui.panel.classList.add('on');
        ui.pname.textContent = h.label;
        ui.pmeta.textContent = `${h.size} sound${h.size === 1 ? '' : 's'}${h.more ? ` · ${h.more} not shown here` : ''} · click to go in`;
        ui.panel.dataset.i = '';
        clearWave();
      } else ui.panel.classList.remove('on');
      return;
    }
    const s = data.sounds[n.si];
    ui.panel.classList.add('on');
    ui.panel.dataset.i = n.si;
    ui.pname.textContent = s.name;
    const c = s.cluster != null ? data.clusters[s.cluster] : null;
    ui.pmeta.innerHTML = `${c ? `<span style="color:${groupColour(s.cluster)}">${esc(c.name)}</span> · ` : ''}${secs(s.seconds)}` +
      `${s.heard[0] ? ` · ${esc(s.heard[0])}` : ''}${s.words.length ? ` · <span class="d">${esc(s.words.slice(0, 3).join(', '))}</span>` : ''}`;
    loadWave(n.si);
  }

  function clearWave() {
    const g = ui.wave.getContext('2d');
    g.clearRect(0, 0, ui.wave.width, ui.wave.height);
  }

  function loadWave(i) {
    if (peaks.has(i)) return;
    peaks.set(i, null);
    const p = data.sounds[i].path;
    fetch(`/api/peaks?p=${encodeURIComponent(p)}&cols=300`).then((r) => (r.ok ? r.json() : null)).then((w) => {
      const ch = w && w.channels && w.channels[0];
      peaks.set(i, ch ? { min: ch.min, max: ch.max } : false);
    }).catch(() => peaks.set(i, false));
  }

  function drawWave(now) {
    const i = !data || !ui.panel.dataset.i ? -1 : +ui.panel.dataset.i;
    const c = ui.wave, g = c.getContext('2d');
    const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (i < 0 || !data.sounds[i]) return;
    const s = data.sounds[i];
    const colour = s.cluster != null ? groupColour(s.cluster) : '#c9d3e6';
    const pk = peaks.get(i);
    if (pk) {
      const cols = pk.max.length;
      g.fillStyle = colour;
      for (let x = 0; x < cols; x++) {
        const top = (1 - pk.max[x]) * h / 2, bot = (1 - pk.min[x]) * h / 2;
        g.fillRect(x * w / cols, top, Math.max(1, w / cols - 0.3), Math.max(1, bot - top));
      }
    } else {
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(0, h / 2 - 0.5, w, 1);
    }
    if (playing === i) {
      const t = ((now - playStart) / 1000) / Math.max(0.05, s.seconds);
      if (t <= 1) {
        g.fillStyle = 'rgba(6,8,12,0.45)';
        g.fillRect(t * w, 0, w - t * w, h);
        g.fillStyle = HEARD;
        g.fillRect(t * w - 1, 0, 2, h);
      }
    }
  }

  // ---------------------------------------------------------------- overlay

  /// Names over the scene — groups and labels, the sound in hand and the ones
  /// most like it — and rings round what is under the pointer and playing.
  function drawOver(now) {
    const c = ui.over, g = ui.og;
    const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!graph || !data) return;
    const scr = (p) => graph.graph2ScreenCoords(p.x ?? p.fx, p.y ?? p.fy, p.z ?? p.fz);
    const taken = [];
    const fits = (x, y, ww, hh) => {
      for (const t of taken) if (x < t[0] + t[2] && x + ww > t[0] && y < t[1] + t[3] && y + hh > t[1]) return false;
      taken.push([x, y, ww, hh]);
      return true;
    };
    const say = (x, y, text, font, colour, always) => {
      g.font = font;
      const tw = g.measureText(text).width;
      if (x < -tw || x > w || y < -10 || y > h + 10) return null;
      if (!fits(x - 2, y - 8, tw + 4, 16) && !always) return null;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillText(text, x + 1, y + 1);
      g.fillStyle = colour;
      g.fillText(text, x, y);
      return { x: x - 2, y: y - 8, w: tw + 4, h: 16 };
    };
    g.textBaseline = 'middle';
    const sans = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'sans-serif';
    const lit = hover && hover.kind === 'sound' ? hover : selected;

    // The sounds most like the one in hand, joined to it.
    if (lit) {
      const a = scr(lit);
      for (const j of data.sounds[lit.si].near) {
        const n = nodeOf.get(j);
        if (!n) continue;
        const b = scr(n);
        g.strokeStyle = 'rgba(143,199,255,0.65)';
        g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        say(b.x + 6, b.y, data.sounds[j].name, `10px ${sans}`, ALIKE);
      }
      say(a.x + 9, a.y, data.sounds[lit.si].name, `600 12px ${sans}`, '#fff', true);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(a.x, a.y, 9, 0, 7); g.stroke();
    }
    // What was just heard, as a fading path.
    for (let q = 1; q < trail.length; q++) {
      const age = (now - trail[q].t) / 5000;
      const na = nodeOf.get(trail[q - 1].i), nb = nodeOf.get(trail[q].i);
      if (age > 1 || !na || !nb) continue;
      const a = scr(na), b = scr(nb);
      g.strokeStyle = `rgba(111,208,140,${(0.6 * (1 - age)).toFixed(3)})`;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    if (playing >= 0 && nodeOf.get(playing)) {
      const p = scr(nodeOf.get(playing)), t = (now % 900) / 900;
      g.strokeStyle = `rgba(111,208,140,${(1 - t).toFixed(3)})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, 7 + t * 18, 0, 7); g.stroke();
    }
    // Names of the hubs, or in the cloud of the groups where they gather.
    ui.names = [];
    if (view === 'cloud' && !inside) {
      // The forty biggest groups are named; going in names the rest.
      const named = new Set(data.clusters.map((c, n) => [c.size, n]).sort((a, b) => b[0] - a[0]).slice(0, 40).map((x) => x[1]));
      data.clusters.forEach((c, n) => {
        if (!named.has(n)) return;
        const p = graph.graph2ScreenCoords(...c.centre.map((v) => (v - 0.5) * SPACE));
        const size = Math.min(15, 10 + Math.sqrt(c.size) * 0.3);
        g.textAlign = 'center';
        const box = say(p.x, p.y, c.name, `600 ${size}px ${sans}`, groupColour(n));
        g.textAlign = 'left';
        if (box) ui.names.push({ ...box, x: box.x - box.w / 2, group: n, label: c.name });
      });
    } else if (!inside) {
      for (const n of nodes) {
        if (n.kind !== 'hub' && n.kind !== 'tag') continue;
        const p = scr(n);
        say(p.x + 8, p.y, n.label, `600 ${Math.min(14, 10 + Math.sqrt(n.size) * 0.25)}px ${sans}`, n.kind === 'hub' ? groupColour(n.group) : famColour(n.family));
      }
    }
    if (hits) {
      let budget = 60;
      for (const i of hits) {
        const n = nodeOf.get(i);
        if (!n || !budget--) continue;
        const p = scr(n);
        say(p.x + 7, p.y, data.sounds[i].name, `10px ${sans}`, HIT);
      }
    }
  }

  // ------------------------------------------------------------------- card

  function hideCard() { ui.card.classList.remove('on'); }

  function rows(list) {
    return `<div class="lg-list">${list.map((i) => {
      const s = data.sounds[i];
      return `<div data-i="${i}"><i style="background:${groupColour(s.cluster)}"></i><span class="nm">${esc(s.name)}</span><span class="sub">${secs(s.seconds)}</span></div>`;
    }).join('')}</div>`;
  }

  function showSound(i) {
    const s = data.sounds[i];
    const c = s.cluster != null ? data.clusters[s.cluster] : null;
    const chips = (list) => list.map((x) => `<span class="lg-chip" data-find="${esc(x)}">${esc(x)}</span>`).join('') || '<span class="sub">—</span>';
    const parts = s.path.split('/');
    ui.card.innerHTML = `
      <h3>${esc(s.name)}</h3>
      <div class="lg-where">${esc(parts.slice(0, -1).join(' › '))}</div>
      ${c ? `<div class="lg-row"><span>Group</span><span class="lg-link" style="color:${groupColour(s.cluster)}">${esc(c.name)}</span></div>` : ''}
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
    const link = ui.card.querySelector('.lg-link');
    if (link && c) link.onclick = () => enter('cluster', s.cluster, c.name);
    ui.card.querySelectorAll('.lg-list div').forEach((row) => {
      const j = +row.dataset.i;
      row.onclick = () => goTo(j);
      row.onmouseenter = () => { if (hoverPlays) audition(j); ui.panel.dataset.i = j; loadWave(j); };
    });
    ui.card.querySelectorAll('.lg-chip[data-find]').forEach((x) => {
      x.onclick = () => { ui.find.value = x.dataset.find; setFind(x.dataset.find); };
    });
    ui.card.classList.add('on');
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
      if (selected && selected.si === i) showSound(i);
    }).catch(() => {});
    return s.near;
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
    playStart = performance.now();
    trail.push({ i, t: playStart });
    if (trail.length > 16) trail.shift();
    if (typeof engineLoad !== 'function') return;
    if (!(await engineLoad({ path: s.path }, { raw: true }))) return;
    // Another sound may have been asked for while this one loaded.
    if (playing !== i) return;
    playStart = performance.now();
    seekSource(0);
    startPlayback();
    startedPlayback = true;
  }

  function silence() {
    clearTimeout(wantTimer);
    playing = -1;
    if (startedPlayback && typeof pausePlayback === 'function' && engine.playing) pausePlayback();
    startedPlayback = false;
  }

  // ------------------------------------------------------------------- find

  function setFind(q) {
    const t = q.trim().toLowerCase();
    if (!t || !data) { hits = null; ui.found.textContent = ''; }
    else {
      hits = new Set();
      data.sounds.forEach((s, i) => { if (s.text.includes(t)) hits.add(i); });
      ui.found.textContent = `${hits.size} found`;
    }
    if (graph && data) show();
  }

  // ---------------------------------------------------------------- choices

  function setView(v) {
    if (!VIEWS.some((x) => x[0] === v)) v = 'cloud';
    if (inside && inside.kind === 'tag' && v !== 'tags') inside = null;
    if (inside && inside.kind === 'cluster' && v === 'tags') inside = null;
    view = v;
    remember('mapView', v);
    show();
    sayWhere();
  }

  function setTint(t) {
    if (!TINTS.some((x) => x[0] === t)) t = 'group';
    tint = t;
    remember('mapTint3', t);
    root.querySelectorAll('.lg-tints [data-tint]').forEach((b) => b.classList.toggle('on', b.dataset.tint === t));
    recolour();
    drawKey();
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
      ui.key.innerHTML = Object.values(FAMILIES).map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('');
    } else if (tint === 'tone') {
      ui.key.innerHTML = `<span>dark<b class="lg-ramp" style="background:linear-gradient(90deg,${tone(0)},${tone(0.25)},${tone(0.5)},${tone(0.75)},${tone(1)})"></b>bright</span>`;
    } else {
      ui.key.innerHTML = `<span>${data.clusters.length} groups of alike sounds, a colour each</span>`;
    }
  }

  // ------------------------------------------------------------------- loop

  function frame(now) {
    raf = requestAnimationFrame(frame);
    // In Browse under the fly-through world, nothing of it is seen.
    if (!overlay && worldOpen()) return;
    drawOver(now);
    drawWave(now);
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
      const c = s.cluster != null ? next.clusters[s.cluster] : null;
      s.text = [s.path, c ? c.name : '', s.kind, ...s.heard, ...s.words].join(' ').toLowerCase();
    }
    // Shown again only when the layout itself changed, so the scene does not
    // jump every few seconds while the library is being listened to.
    const changed = !data || next.current || data.sounds.length !== next.sounds.length ||
      next.clusters.length !== data.clusters.length || placedCount(next) !== placedCount(data);
    data = next;
    loadedAt = Date.now();
    const on = placedCount(data);
    ui.empty.textContent = data.count ? (on ? '' : 'Listening to the library… the first sounds appear in a moment.') : 'Nothing in the library yet.';
    ui.status.textContent = `${on} of ${data.count} sounds placed · ${data.clusters.length} groups` +
      (data.listening ? ` · listening to ${data.listening} more…` : '');
    if (changed) { setFind(ui.find.value); if (!hits) show(); }
    if (data.listening) pollTimer = setTimeout(load, Math.max(POLL_MS, on > 20000 ? 15000 : POLL_MS));
  }
  const placedCount = (d) => d.sounds.reduce((t, s) => t + (s.at ? 1 : 0), 0);

  function onResize() {
    if (graph) graph.width(ui.scene.clientWidth).height(ui.scene.clientHeight);
  }

  /// The scene, colours and choices, and the loop started: the half of
  /// showing the map that is the same in both places.
  function start() {
    root.classList.remove('hidden');
    if (!graph && typeof ForceGraph3D === 'function') makeGraph();
    onResize();
    if (graph) graph.resumeAnimation();
    setTint(tint);
    setHoverPlays(hoverPlays);
    sayWhere();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  /// Everything that runs while it is shown, stopped. What it played is left
  /// playing, as leaving Browse leaves a sound the tree played.
  function stop() {
    clearTimeout(pollTimer);
    clearTimeout(wantTimer);
    hideCard();
    hover = null;
    if (graph) graph.pauseAnimation();
    cancelAnimationFrame(raf);
  }

  function open() {
    if (!root) build();
    overlay = true;
    unwatchHost();
    // The id is the overlay's: `#libraryGraph` is the map over the window.
    root.id = 'libraryGraph';
    root.classList.remove('lg-embedded');
    if (root.parentNode !== document.body) document.body.append(root);
    start();
    window.addEventListener('resize', onResize);
    root.focus({ preventScroll: true });
    load();
  }

  function close() {
    if (!root || !overlay) return;
    overlay = false;
    silence();
    stop();
    window.removeEventListener('resize', onResize);
    root.classList.add('hidden');
    // Opened over Browse, it goes back into Browse.
    if (host) embed();
  }

  // ----------------------------------------------------------- in Browse

  /// Into Browse's box, sized to it.
  function embed() {
    if (!root) build();
    root.id = 'browseGraph';
    root.classList.add('lg-embedded');
    if (root.parentNode !== host) host.append(root);
    start();
    hostWatch = new ResizeObserver(onResize);
    hostWatch.observe(host);
    if (!data || data.listening || Date.now() - loadedAt > RELOAD_MS) load();
  }

  function unwatchHost() {
    if (hostWatch) hostWatch.disconnect();
    hostWatch = null;
  }

  /// Put the map in `el`, sized to that box and following it; `null` takes it
  /// out of the page and stops it. While the overlay is up the box is only
  /// remembered, and the map goes into it when the overlay closes.
  function mount(el) {
    el = el || null;
    if (el === host) return;
    if (host && !overlay) { unwatchHost(); stop(); if (root) root.classList.add('hidden'); }
    host = el;
    if (host && !overlay) embed();
  }

  /// Browse's map, shown or put away with Browse. Called by `setMode`.
  function browse(on) {
    const box = document.getElementById('browseMap');
    if (!box) return;
    box.classList.toggle('hidden', !on);
    document.body.classList.toggle('browsemap', on);
    mount(on ? box : null);
  }

  /// Whether the fly-through world is up.
  function worldOpen() {
    const w = document.getElementById('soundMap');
    return !!w && !w.classList.contains('hidden');
  }

  function openWorld() {
    close();
    if (window.SoundMap) window.SoundMap.open();
  }

  /// Where sound `i` is on screen, in page pixels; null if it is not shown.
  /// For the tests, which have to point at a sound to hover or click it.
  function screenOf(i) {
    const n = nodeOf.get(i);
    if (!n || !graph) return null;
    const p = graph.graph2ScreenCoords(n.x ?? n.fx, n.y ?? n.fy, n.z ?? n.fz);
    const r = ui.scene.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, name: data.sounds[i].name };
  }

  /// The same, for the hub or label called `label`.
  function screenOfHub(label) {
    const n = nodes.find((x) => x.kind !== 'sound' && x.label === label);
    if (!n || !graph) return null;
    const p = graph.graph2ScreenCoords(n.x, n.y, n.z);
    const r = ui.scene.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, label };
  }

  window.LibraryGraph = {
    open,
    close,
    mount,
    browse,
    screenOf,
    screenOfHub,
    hubs: () => nodes.filter((n) => n.kind !== 'sound').map((n) => n.label),
    shownSounds: () => [...nodeOf.keys()],
    get state() {
      return {
        // The overlay; `embedded` is the map in Browse.
        open: !!root && overlay && !root.classList.contains('hidden'),
        embedded: !!root && !overlay && !!host && !root.classList.contains('hidden'),
        view, tint, hoverPlays,
        inside: inside ? inside.label : null,
        count: data ? data.count : 0,
        shown: nodeOf.size,
        hubs: nodes.filter((n) => n.kind !== 'sound').length,
        clusters: data ? data.clusters.length : 0,
        listening: data ? data.listening : null,
        selected: selected ? selected.si : null,
        hovered: hover && hover.kind === 'sound' ? hover.si : null,
        framed,
        playing,
        found: hits ? hits.size : null,
      };
    },
  };

  // Browse no longer shows the map (14 Nov 2026): its types are there instead
  // (`ui/app/251-browse-types.js`). `browse` is kept, and calling it puts the
  // map back beside the sound's details.
})();
