// The four-dimensional solids, and a panel to drive them.
//
// **Built in the idiom of a 3D modelling application, deliberately.** Anyone
// who has used Cinema 4D, Blender or Maya already knows this shape: a list of
// objects on one side, and an attribute manager that shows the parameters of
// whatever is selected and nothing else. That convention is worth borrowing
// exactly rather than approximately — half a convention is worse than none,
// because it invites the muscle memory and then breaks it.
//
// Three things come across:
//
//   * **The object manager.** A list. Selecting is the only thing it does, and
//     what is selected decides what the rest of the panel is about.
//   * **The attribute manager.** Parameters of the selection, grouped, with the
//     group names a modeller expects — Object, Coordinates, Projection.
//   * **Scrubbable numbers.** Dragging sideways on a value changes it. This is
//     the interaction that makes a modelling package feel like one, and it is
//     the one people miss first when it is absent. Shift for fine, and a
//     double-click puts a field back to its default.
//
// One thing deliberately does *not* come across. C4D's coordinates manager has
// three rotation fields — H, P, B — because in three dimensions a rotation can
// be named by the axis it leaves alone. In four dimensions there is no such
// axis: the thing a rotation fixes is another plane, so there are six planes
// and no axes at all. Calling them H/P/B to seem more familiar would be naming
// them after something that is not there. They are XY, XZ, YZ, XW, YW, ZW, and
// the three that reach into the fourth dimension are marked, because those are
// the ones that do something you cannot get any other way.
//
// The geometry is in `shapes-4d.js` and knows nothing about any of this.

const P4_STORE = 'audiolab.shape4d.v1';

/// What the panel is looking at. One selection, one set of angles, one
/// projection — the same state a modelling package would call the document.
const p4 = {
  shape: 'cell8',
  angles: { xy: 0, xz: 0, yz: 0, xw: 0, yw: 0, zw: 0 },
  eye: 2.5,
  mode: 'perspective',
  /// Which plane the clock is turning, and how fast. A 4D solid at rest is a
  /// still picture of a shadow; the whole point is watching the shadow move.
  spin: 'zw',
  spinning: true,
  rate: 0.35,
};

function p4Load() {
  try {
    const v = JSON.parse(localStorage.getItem(P4_STORE) || '{}');
    if (v && typeof v === 'object') {
      // Validated the same way every other stored thing in this program is: a
      // shape the catalogue no longer offers falls back rather than leaving the
      // panel pointing at nothing.
      if (Shapes4D.entry(v.shape)) p4.shape = v.shape;
      for (const p of Shapes4D.PLANES) {
        const a = Number(v.angles?.[p.key]);
        if (Number.isFinite(a)) p4.angles[p.key] = a;
      }
      if (Number.isFinite(Number(v.eye))) p4.eye = Math.min(12, Math.max(1.2, Number(v.eye)));
      if (v.mode === 'orthographic' || v.mode === 'perspective') p4.mode = v.mode;
      if (Shapes4D.PLANES.some((p) => p.key === v.spin)) p4.spin = v.spin;
      if (typeof v.spinning === 'boolean') p4.spinning = v.spinning;
      if (Number.isFinite(Number(v.rate))) p4.rate = Math.min(2, Math.max(0, Number(v.rate)));
    }
  } catch { /* a corrupt entry is no state, not a broken panel */ }
}

function p4Save() {
  try { localStorage.setItem(P4_STORE, JSON.stringify(p4)); } catch { /* private mode */ }
}

// ── drawing it ──────────────────────────────────────────────────────────────

/// The wireframe, on a plain 2D canvas.
///
/// Over black with lighter strokes, like the room it belongs to — and depth is
/// carried by the stroke rather than by a depth buffer, because there is not
/// one here and because a wireframe with every line the same weight is a flat
/// tangle. A vertex further away in the *projected* z is dimmer and thinner,
/// which is enough to read a 600-cell.
function p4Draw() {
  const cv = document.getElementById('p4Canvas');
  if (!cv) return;
  const shape = Shapes4D.shape(p4.shape);
  if (!shape) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 260, h = cv.clientHeight || 190;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const turned = Shapes4D.rotate(shape.verts, p4.angles);
  const flat = Shapes4D.project(turned, { eye: p4.eye, mode: p4.mode });

  // Fit the drawing to the box rather than assuming unit radius survives the
  // projection — it does not, and a solid that grows past its own panel while
  // you turn it looks broken.
  let r = 0;
  for (const v of flat) r = Math.max(r, Math.hypot(v[0], v[1]));
  const k = (Math.min(w, h) * 0.42) / (r || 1);
  const cx = w / 2, cy = h / 2;

  let zMin = Infinity, zMax = -Infinity;
  for (const v of flat) { zMin = Math.min(zMin, v[2]); zMax = Math.max(zMax, v[2]); }
  const span = zMax - zMin || 1;

  const ink = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#5fd47a';

  g.lineCap = 'round';
  // Far edges first, so the near ones are drawn over them.
  const order = shape.edges
    .map(([i, j]) => ({ i, j, z: (flat[i][2] + flat[j][2]) / 2 }))
    .sort((a, b) => a.z - b.z);

  for (const e of order) {
    const a = flat[e.i], b = flat[e.j];
    const depth = (e.z - zMin) / span;
    g.globalAlpha = 0.16 + depth * 0.74;
    g.lineWidth = 0.45 + depth * 1.15;
    g.strokeStyle = ink;
    g.beginPath();
    g.moveTo(cx + a[0] * k, cy - a[1] * k);
    g.lineTo(cx + b[0] * k, cy - b[1] * k);
    g.stroke();
  }

  // The vertices, faintly, so a dense solid still reads as points on a shell.
  g.globalAlpha = 0.5;
  g.fillStyle = ink;
  for (const v of flat) {
    const depth = (v[2] - zMin) / span;
    g.globalAlpha = 0.2 + depth * 0.5;
    g.beginPath();
    g.arc(cx + v[0] * k, cy - v[1] * k, 0.5 + depth * 1.1, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

// ── the clock ───────────────────────────────────────────────────────────────

let p4Timer = null;
let p4Last = 0;

function p4Tick(now) {
  p4Timer = requestAnimationFrame(p4Tick);
  if (!p4.spinning) { p4Last = now; return; }
  const panel = document.getElementById('p4Panel');
  // Nothing is drawn for a panel nobody is looking at. The room already works
  // this way — a feed is gated on being on screen rather than on existing.
  if (!panel || panel.offsetParent === null) { p4Last = now; return; }
  const dt = Math.min(0.05, (now - (p4Last || now)) / 1000);
  p4Last = now;
  p4.angles[p4.spin] = (p4.angles[p4.spin] + p4.rate * dt) % (Math.PI * 2);
  p4Draw();
  p4SyncFields();
}

function p4StartClock() {
  if (p4Timer === null) p4Timer = requestAnimationFrame(p4Tick);
}

// ── scrubbable numbers ──────────────────────────────────────────────────────

/**
 * A value you can drag.
 *
 * The interaction every modelling package has and no web form does: press on
 * the number, move sideways, the value follows. Pointer capture because the
 * pointer leaves a 60px field almost immediately — the same reason every other
 * drag in this program uses it.
 *
 * Typing still works, so a value can be entered exactly; and a double-click
 * puts it back, which is this program's own convention for every other control.
 */
function p4Scrub(input, { get, set, step, fine, def }) {
  let dragging = false, startX = 0, startV = 0, moved = false;

  input.addEventListener('pointerdown', (e) => {
    // Let a deliberate click into the field still place a caret.
    if (e.target === document.activeElement) return;
    e.preventDefault();
    dragging = true; moved = false;
    startX = e.clientX;
    startV = get();
    input.setPointerCapture(e.pointerId);
    input.classList.add('p4-scrubbing');
  });

  input.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 2) moved = true;
    set(startV + dx * (e.shiftKey ? fine : step));
  });

  const up = (e) => {
    if (!dragging) return;
    dragging = false;
    input.classList.remove('p4-scrubbing');
    try { input.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    // A press that never moved is a click, and a click into a number field
    // should let you type in it.
    if (!moved) input.select();
  };
  input.addEventListener('pointerup', up);
  input.addEventListener('pointercancel', up);

  input.addEventListener('dblclick', () => set(def));
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) set(v);
  });
}

// ── the panel ───────────────────────────────────────────────────────────────

const p4El = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

const P4_DEG = 180 / Math.PI;

function p4Field(row, { label, mark, get, set, step, fine, def, digits = 1 }) {
  const r = p4El('div', 'p4-num');
  const lb = p4El('span', 'p4-num-lb', label);
  if (mark) lb.appendChild(p4El('i', 'p4-w', '·w'));
  r.appendChild(lb);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'p4-num-in';
  input.dataset.p4 = label;
  input.value = get().toFixed(digits);
  p4Scrub(input, {
    get, digits,
    set: (v) => { set(v); p4SyncFields(); p4Draw(); p4Save(); },
    step, fine, def,
  });
  r.appendChild(input);
  row.appendChild(r);
  return input;
}

/// Write the live values back into the fields without rebuilding them.
///
/// The clock moves an angle sixty times a second, and rebuilding the panel at
/// that rate would take the caret out of whatever is being typed in and drop
/// any drag in progress — the same failure the theme editor's swatches had.
function p4SyncFields() {
  const panel = document.getElementById('p4Panel');
  if (!panel) return;
  for (const p of Shapes4D.PLANES) {
    const el = panel.querySelector(`.p4-num-in[data-p4="${p.label}"]`);
    if (el && document.activeElement !== el && !el.classList.contains('p4-scrubbing')) {
      el.value = (p4.angles[p.key] * P4_DEG).toFixed(1);
    }
  }
}

function p4BuildPanel() {
  const host = document.getElementById('p4Panel');
  if (!host) return;
  host.innerHTML = '';

  // ── the object manager ──
  const objHead = p4El('div', 're-tag', 'OBJECTS');
  host.appendChild(objHead);

  const list = p4El('div', 'p4-objects');
  for (const entry of Shapes4D.CATALOGUE) {
    const row = p4El('button', 'p4-obj');
    row.classList.toggle('active', entry.key === p4.shape);
    row.title = entry.hint;
    row.appendChild(p4El('span', 'p4-obj-dim', `${entry.dim}D`));
    row.appendChild(p4El('span', 'p4-obj-name', entry.label));
    row.appendChild(p4El('span', 'p4-obj-n', `${entry.verts}·${entry.edges}`));
    row.onclick = () => { p4.shape = entry.key; p4Save(); p4BuildPanel(); p4Draw(); };
    list.appendChild(row);
  }
  host.appendChild(list);

  // ── the attribute manager ──
  const entry = Shapes4D.entry(p4.shape);
  host.appendChild(p4El('div', 're-tag', 'OBJECT'));
  const about = p4El('div', 'p4-about');
  about.appendChild(p4El('div', 'p4-about-name', entry.label));
  about.appendChild(p4El('div', 'p4-about-hint', entry.hint));
  about.appendChild(p4El('div', 'p4-about-n',
    `${entry.dim} dimensions · ${entry.verts} vertices · ${entry.edges} edges`));
  host.appendChild(about);

  // ── coordinates ──
  //
  // The block a modeller looks for first, and the one place this cannot copy
  // C4D: six planes, not three axes. The three that reach into the fourth
  // dimension are marked, because they are the ones worth turning.
  host.appendChild(p4El('div', 're-tag', 'ROTATION · SIX PLANES'));
  const grid = p4El('div', 'p4-grid');
  for (const p of Shapes4D.PLANES) {
    p4Field(grid, {
      label: p.label,
      mark: !p.familiar,
      get: () => p4.angles[p.key] * P4_DEG,
      set: (deg) => { p4.angles[p.key] = (deg / P4_DEG) % (Math.PI * 2); },
      step: 0.9, fine: 0.12, def: 0,
    });
  }
  host.appendChild(grid);
  const note = p4El('div', 'fx-note',
    'Drag a number sideways to turn it; hold shift for fine, double-click to zero. '
    + 'The three marked ·w reach into the fourth dimension — those are the ones that change '
    + 'the shape of the shadow rather than just its pose.');
  host.appendChild(note);

  // ── projection ──
  host.appendChild(p4El('div', 're-tag', 'PROJECTION'));
  const proj = p4El('div', 'p4-row');

  const modes = p4El('div', 're-frames');
  for (const [key, label] of [['perspective', 'Perspective'], ['orthographic', 'Parallel']]) {
    const b = p4El('button', 're-btn', label);
    b.classList.toggle('active', p4.mode === key);
    b.title = key === 'perspective'
      ? 'A vertex further away in w is drawn smaller — which is what puts one cube of a tesseract inside the other.'
      : 'w is dropped rather than divided by. Every cell the same size, and the solid reads as a flat cage.';
    b.onclick = () => { p4.mode = key; p4Save(); p4BuildPanel(); p4Draw(); };
    modes.appendChild(b);
  }
  proj.appendChild(modes);
  host.appendChild(proj);

  const eyeRow = p4El('div', 'p4-grid');
  p4Field(eyeRow, {
    label: 'Eye', get: () => p4.eye,
    set: (v) => { p4.eye = Math.min(12, Math.max(1.2, v)); },
    step: 0.02, fine: 0.004, def: 2.5, digits: 2,
  });
  host.appendChild(eyeRow);
  host.appendChild(p4El('div', 'fx-note',
    'How far down the w axis you are standing. Far off is nearly parallel; close in exaggerates '
    + 'the depth, and the panel holds you clear of the solid rather than dividing by nothing.'));

  // ── the clock ──
  host.appendChild(p4El('div', 're-tag', 'TURNING'));
  const spinRow = p4El('div', 'p4-row');
  const play = p4El('button', 're-btn', p4.spinning ? 'Pause' : 'Turn');
  play.classList.toggle('active', p4.spinning);
  play.onclick = () => { p4.spinning = !p4.spinning; p4Save(); p4BuildPanel(); };
  spinRow.appendChild(play);

  const sel = document.createElement('select');
  sel.className = 'field mini';
  for (const p of Shapes4D.PLANES) {
    const o = document.createElement('option');
    o.value = p.key;
    o.textContent = `${p.label}${p.familiar ? '' : ' ·w'}`;
    sel.appendChild(o);
  }
  sel.value = p4.spin;
  sel.title = 'Which plane the clock turns.';
  sel.onchange = () => { p4.spin = sel.value; p4Save(); };
  spinRow.appendChild(sel);
  host.appendChild(spinRow);

  const rateRow = p4El('div', 'p4-grid');
  p4Field(rateRow, {
    label: 'Rate', get: () => p4.rate,
    set: (v) => { p4.rate = Math.min(2, Math.max(0, v)); },
    step: 0.004, fine: 0.001, def: 0.35, digits: 3,
  });
  host.appendChild(rateRow);

  const reset = p4El('button', 're-btn re-reset', 'Put every plane back');
  reset.onclick = () => {
    for (const p of Shapes4D.PLANES) p4.angles[p.key] = 0;
    p4.eye = 2.5; p4.mode = 'perspective';
    p4Save(); p4BuildPanel(); p4Draw();
  };
  host.appendChild(reset);
}

function p4Panel() {
  p4BuildPanel();
  p4Draw();
  p4StartClock();
}

p4Load();
