// ───────────────────────────────────────── the Room tab as an instrument ──
//
// `docs/DESIGN-CRITIQUE.md`, "The Visual column". The tab used to be a form —
// a tag over a hairline slider, row after row, in the order things were added.
// In the Visual column it is now grouped by subject (layers, camera, ring,
// solid, grains, air, data) and each value gets the control that suits it:
//
//   - an amount is a **knob**, four to a row, its reading printed under it;
//   - a pair that is one decision — where the eye turns, where it stands — is
//     a **pad**, as the Prism tab and Stage have;
//   - an exact number stays a **scrub field**, the channel box as it was;
//   - a choice is a **segment row** of fixed places, lit quietly when on.
//
// **Nothing is rebuilt.** A knob is the same `<input type=range>`, with a face
// drawn behind it and a vertical drag laid over its own: every handler, every
// preset, every look and every test that moves `#reRing` moves it still, and a
// pointer aimed at the knob lands on the input. The pads write the camera
// through `ROOM_CAM_CHANNELS`, the channel box's own read and apply. Outside
// the Visual column — the overlay on the master bus — none of this is drawn
// and the inputs are the sliders they always were.

/// Which group each row belongs to, by the control it holds, and where in it.
const RK_ORDER = [
  ['reLayers', 11],
  ['reCamTx', 22], ['reCamTy', 22], ['reCamTz', 22], ['reCamRx', 22], ['reCamRy', 22],
  ['reCamFocal', 22], ['reCamCoi', 22], ['reCamFront', 23], ['reObjRow', 24], ['re-legend', 25],
  ['reRing', 31], ['reRingDrive', 31], ['reRingPoints', 31], ['reRingEdge', 31],
  ['reSolidShape', 41], ['reSolidSpin', 42], ['reSolidSwell', 42], ['reSolidEye', 42],
  ['reSolidSize', 42], ['reSolidPathAdd', 43], ['reSolidPath', 44],
  ['reGrainDensity', 51], ['reGrainBright', 51], ['reGrainFill', 52], ['reLeadThick', 53],
  ['reFog', 61], ['reMist', 62],
  ['reStreams', 71], ['reChunks', 72],
  ['reFrameRow', 80], ['re-foot', 90], ['reNums', 91],
];
const RK_HEADS = [[10, 'Layers'], [20, 'Camera'], [30, 'Ring'], [40, 'Solid'],
  [50, 'Grains'], [60, 'Air'], [70, 'Data']];
/// The knobs, and the word under each. The reading is the setting itself —
/// the element's count divided back by the scale `ROOM_SLIDERS` gives it.
const RK_KNOBS = {
  reRing: 'Size', reRingDrive: 'Drive', reRingPoints: 'Smooth', reRingEdge: 'Stroke',
  reSolidSpin: 'Turn', reSolidSwell: 'Swell', reSolidEye: 'Eye', reSolidSize: 'Size',
  reGrainDensity: 'Cloud', reGrainBright: 'Burn',
  reMistAmount: 'Amount', reOpacity: 'Opacity',
};

/// The rows that hold one knob and nothing else: a cell of the grid each.
const RK_CELLS = ['reRing', 'reRingDrive', 'reRingPoints', 'reRingEdge', 'reSolidSpin',
  'reSolidSwell', 'reSolidEye', 'reSolidSize', 'reGrainDensity', 'reGrainBright'];

const RK_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/// The face of a knob: a 270° track and the arc to the value, with a pointer.
function rkFace(frac, mark) {
  const r = 11, c = 14, a0 = -135, a1 = a0 + 270 * frac;
  const at = (a) => `${(c + r * Math.sin(a * Math.PI / 180)).toFixed(2)} ${(c - r * Math.cos(a * Math.PI / 180)).toFixed(2)}`;
  // A value the control has a name for — Envelope's symmetric, a spread's
  // nothing — marked just outside the ring. Drawn only where a style asks.
  const tick = (am) => {
    const pt = (rr) => [c + rr * Math.sin(am * Math.PI / 180), c - rr * Math.cos(am * Math.PI / 180)].map((n) => n.toFixed(2));
    const [x1, y1] = pt(12.6), [x2, y2] = pt(14);
    return `<line class="rk-mark" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  };
  const big = frac * 270 > 180 ? 1 : 0;
  return `<svg viewBox="0 0 28 28" aria-hidden="true">`
    + `<path class="rk-track" d="M${at(a0)} A${r} ${r} 0 1 1 ${at(135)}"/>`
    + (frac > 0.002 ? `<path class="rk-arc" d="M${at(a0)} A${r} ${r} 0 ${big} 1 ${at(a1)}"/>` : '')
    + `<line class="rk-hand" x1="${c}" y1="${c}" x2="${at(a1).split(' ')[0]}" y2="${at(a1).split(' ')[1]}"/>`
    + (mark === undefined ? '' : tick(a0 + 270 * mark)) + '</svg>';
}

/// Make a range input a knob. `own` is a reading the panel already keeps up
/// to date (`.rg-read`); it is moved under the knob and left to its panel.
/// Without one, the knob prints the setting from `ROOM_SLIDERS`' scale.
function rkKnob(input, label, own) {
  if (!input || input.dataset.rk) return;
  input.dataset.rk = 'knob';
  const scale = (ROOM_SLIDERS.find(([id]) => id === input.id) || [0, 0, 1])[2];
  const digits = scale >= 1000 ? 3 : scale >= 100 ? 2 : 0;
  const wrap = document.createElement('span');
  wrap.className = 'rk-k';
  input.before(wrap);
  const face = document.createElement('span');
  face.className = 'rk-face';
  const read = own || document.createElement('b');
  read.classList.add('rk-v');
  const name = document.createElement('i');
  name.className = 'rk-l';
  name.textContent = label;
  wrap.append(face, input, read, name);
  // The picture of what it does, above it (`control-pictures.js`), redrawn
  // wherever the face is.
  const picture = typeof cpKnob === 'function' ? cpKnob(input, label, wrap) : null;
  const draw = () => {
    const min = +input.min, max = +input.max, v = +RK_VALUE.get.call(input);
    face.innerHTML = rkFace(max > min ? (v - min) / (max - min) : 0);
    if (!own) read.textContent = (v / scale).toFixed(digits);
    if (picture) picture();
  };
  // Every way a value arrives — a drag, a recalled look, Clear — goes through
  // `value`, so the face is redrawn there rather than on a list of events.
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return RK_VALUE.get.call(this); },
    set(v) { RK_VALUE.set.call(this, v); draw(); },
  });
  input.addEventListener('input', draw);
  // Only in the Visual column — in the overlay it is a slider and drags as one.
  rkDrag(input, () => !!input.closest('.rv-admin'));
  draw();
}

/// Up and down, as a knob turns; shift for fine. `when` says whether the input
/// is a knob where it is now.
function rkDrag(input, when = () => true) {
  input.style.touchAction = 'none';
  input.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !when()) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
    try { input.setPointerCapture(e.pointerId); } catch { /* released below */ }
    const y0 = e.clientY, v0 = +input.value, min = +input.min, max = +input.max;
    const step = +input.step || 1;
    const move = (ev) => {
      let v = v0 + (y0 - ev.clientY) * (max - min) / (ev.shiftKey ? 600 : 160);
      v = Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min));
      if (v !== +input.value) {
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    const up = () => {
      input.removeEventListener('pointermove', move);
      input.removeEventListener('pointerup', up);
      input.removeEventListener('pointercancel', up);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    input.addEventListener('pointermove', move);
    input.addEventListener('pointerup', up);
    input.addEventListener('pointercancel', up);
  });
}

/// The two camera pads. Across and up are two channels of the channel box,
/// each with the range the pad spans; the numbers below stay exact and typed.
const RK_PADS = [
  { name: 'Turn', title: 'Where the eye turns: across is the turn (Rotate Y), up is the tilt (Rotate X). The numbers below are the exact values.',
    x: ['reCamRy', -180, 180], y: ['reCamRx', -CAM_PITCH_MAX, CAM_PITCH_MAX], fmt: (x, y) => `${x.toFixed(1)}° · ${y.toFixed(1)}°` },
  { name: 'Stand', title: 'Where the eye stands on the floor: across is Translate X, up is into the picture (Translate Z). The numbers below are the exact values.',
    x: ['reCamTx', -3, 3], y: ['reCamTz', 3, -3], fmt: (x, y) => `${x.toFixed(2)} · ${y.toFixed(2)}` },
];

function rkChannel(id) {
  const ch = ROOM_CAM_CHANNELS.find(([i]) => i === id);
  return { read: ch[1], apply: ch[2] };
}

/// The pads are kept on the function rather than in a `const` beside it:
/// `syncCamRows` calls this from code that runs before this part of the file
/// has, and a `const` read then throws (STATE.md §10, the temporal dead zone).
function rkPadsSync() {
  const pads = rkPadsSync.pads;
  if (!pads || !pads.length) return;
  const c = roomWorldNow();
  for (const p of pads) {
    const vx = p.cx.read(c), vy = p.cy.read(c);
    const fx = Math.max(0, Math.min(1, (vx - p.def.x[1]) / (p.def.x[2] - p.def.x[1])));
    const fy = Math.max(0, Math.min(1, (vy - p.def.y[1]) / (p.def.y[2] - p.def.y[1])));
    p.dot.style.left = `${fx * 100}%`;
    p.dot.style.top = `${(1 - fy) * 100}%`;
    p.read.textContent = p.def.fmt(vx, vy);
    p.pad.setAttribute('aria-label', `Camera: ${p.def.name.toLowerCase()}, ${p.def.fmt(vx, vy)}`);
  }
}

function rkBuildPads(host) {
  rkPadsSync.pads = [];
  const box = document.createElement('div');
  box.className = 'rk-pads';
  box.style.setProperty('--rk', 21);
  for (const def of RK_PADS) {
    const cell = document.createElement('div');
    cell.className = 'rk-pad-cell';
    const pad = document.createElement('div');
    pad.className = 'rk-pad';
    pad.title = def.title;
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', `Camera: ${def.name.toLowerCase()}`);
    const dot = document.createElement('i');
    pad.appendChild(dot);
    const foot = document.createElement('div');
    foot.className = 'rk-pad-foot';
    foot.innerHTML = `<span>${def.name}</span><span class="rk-pad-read"></span>`;
    cell.append(pad, foot);
    box.appendChild(cell);
    const p = { def, pad, dot, read: foot.querySelector('.rk-pad-read'), cx: rkChannel(def.x[0]), cy: rkChannel(def.y[0]) };
    rkPadsSync.pads.push(p);
    // The keyboard moves the dot as the pointer does: arrows a hundredth of
    // the pad, shift a tenth, written when the key comes up.
    pad.tabIndex = 0;
    pad.onkeydown = (e) => {
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const k = e.shiftKey ? 0.1 : 0.01;
      const c = roomWorldNow();
      const clampTo = (v, lo, hi) => Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), v));
      p.cx.apply(c, clampTo(p.cx.read(c) + dir[0] * k * (def.x[2] - def.x[1]), def.x[1], def.x[2]));
      p.cy.apply(c, clampTo(p.cy.read(c) + dir[1] * k * (def.y[2] - def.y[1]), def.y[1], def.y[2]));
      roomSetWorld(c);
      paintRoomNums();
      syncCamRows();
    };
    pad.onkeyup = (e) => { if (e.key.startsWith('Arrow')) saveRoomCameras(); };
    pad.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch { /* released below */ }
      const to = (ev) => {
        const b = pad.getBoundingClientRect();
        const fx = Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width));
        const fy = Math.max(0, Math.min(1, 1 - (ev.clientY - b.top) / b.height));
        const c = roomWorldNow();
        p.cx.apply(c, def.x[1] + fx * (def.x[2] - def.x[1]));
        p.cy.apply(c, def.y[1] + fy * (def.y[2] - def.y[1]));
        roomSetWorld(c);
        paintRoomNums();
        syncCamRows();
      };
      to(e);
      pad.onpointermove = (ev) => { if (ev.buttons) to(ev); };
      pad.onpointerup = () => { pad.onpointermove = null; saveRoomCameras(); };
    };
  }
  host.appendChild(box);
}

/// Fog as what it does: how much of the room's own colour it has taken, from
/// the front of the room to the back wall. The same sums `fogSurvives` does in
/// `vis-gl.js`, so the curve is the fog rather than a picture of a setting.
/// `t` runs nought to one across the room's depth; `h` is the height above the
/// ground, which only Height fog cares about.
function rkFogAmount(type, density, t, h = 0) {
  const d = t * roomEdit.geomReach;
  if (type === 0) return t;
  if (type === 2) return 1 - Math.exp(-((density * d) ** 2));
  if (type === 3) return 1 - Math.exp(-density * d * Math.exp(-h * 2.2));
  return 1 - Math.exp(-density * d);
}

const RK_FOG_W = 200, RK_FOG_H = 56;

function rkFogPath(type, density, h = 0) {
  let d = '';
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const y = RK_FOG_H - 2 - rkFogAmount(type, density, t, h) * (RK_FOG_H - 4);
    d += `${i ? 'L' : 'M'}${(t * RK_FOG_W).toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

/// The fog row's density, drawn as its falloff and dragged as a knob is: the
/// range input is laid over the drawing, so a pointer, the keyboard, a preset
/// and every test that moves `#reFogDensity` move it still, through its own
/// handlers. The type stays its menu; the curve is redrawn whenever either
/// value is set, from anywhere — a drag, the menu, a recalled look.
function rkFog() {
  const input = $('reFogDensity'), type = $('reFogType'), on = $('reFog');
  if (!input || !type || input.dataset.rk) return;
  input.dataset.rk = 'fog';
  input.setAttribute('aria-label', 'Fog density');
  const box = document.createElement('span');
  box.className = 'rk-fog';
  input.before(box);
  const graph = document.createElement('span');
  graph.className = 'rk-fog-graph';
  graph.title = 'The fog against distance: how much of the room it has taken, from the front to the back wall. Drag up for thicker, shift for fine.';
  graph.innerHTML = `<svg viewBox="0 0 ${RK_FOG_W} ${RK_FOG_H}" preserveAspectRatio="none" aria-hidden="true">`
    + `<path class="rk-fog-fill"/><path class="rk-fog-high"/><path class="rk-fog-curve"/></svg>`;
  const foot = document.createElement('span');
  foot.className = 'rk-pad-foot rk-fog-foot';
  foot.innerHTML = '<span>Near</span><span>Density <b class="rk-pad-read rk-fog-read"></b></span><span>Back wall</span>';
  graph.appendChild(input);
  box.append(graph, foot);
  const [fill, high, curve] = graph.querySelectorAll('path');
  const read = foot.querySelector('.rk-fog-read');
  const draw = () => {
    const t = Math.max(0, Math.min(3, +RK_SELECT.get.call(type) | 0));
    const den = +RK_VALUE.get.call(input) / 100;
    const d = rkFogPath(t, den);
    curve.setAttribute('d', d);
    fill.setAttribute('d', `${d}L${RK_FOG_W} ${RK_FOG_H}L0 ${RK_FOG_H}Z`);
    // Height fog thins as it rises: the same fog a metre up, drawn faint.
    high.setAttribute('d', t === 3 ? rkFogPath(t, den, 0.5) : '');
    box.dataset.type = String(t);
    box.classList.toggle('off', !!on && !on.checked);
    read.textContent = den.toFixed(2);
    // Linear runs from the front of the room to the back wall whatever the
    // density is (`fogSurvives`), so the number is kept but said to be idle.
    read.title = t === 0 ? 'Linear fog runs from the front of the room to the back wall: density is not used.' : '';
    input.setAttribute('aria-valuetext', t === 0 ? `${den.toFixed(2)}, not used by linear fog` : den.toFixed(2));
  };
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return RK_VALUE.get.call(this); },
    set(v) { RK_VALUE.set.call(this, v); draw(); },
  });
  Object.defineProperty(type, 'value', {
    configurable: true,
    get() { return RK_SELECT.get.call(this); },
    set(v) { RK_SELECT.set.call(this, v); draw(); },
  });
  if (on) {
    Object.defineProperty(on, 'checked', {
      configurable: true,
      get() { return RK_CHECKED.get.call(this); },
      set(v) { RK_CHECKED.set.call(this, v); draw(); },
    });
    on.addEventListener('change', draw);
  }
  input.addEventListener('input', draw);
  type.addEventListener('change', draw);
  rkDrag(input, () => !!input.closest('.rv-admin'));
  draw();
}
const RK_SELECT = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

/// Redraw on every way a value arrives, keeping whatever setter is already
/// there — a knob's face draws on the same property.
function rkOnValue(input, draw) {
  const own = Object.getOwnPropertyDescriptor(input, 'value') || RK_VALUE;
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return own.get.call(this); },
    set(v) { own.set.call(this, v); draw(); },
  });
  input.addEventListener('input', draw);
}

/// Mist as what it is: drips falling from a row of grains. The length is how
/// far they fall and is the drawing's own input, dragged as a knob is; the
/// amount — how many points each grain sheds — stays a knob beside it, and the
/// drawing counts it.
const RK_MIST_W = 160, RK_MIST_H = 44;
function rkMist() {
  const len = $('reMistLength'), amt = $('reMistAmount'), on = $('reMist');
  if (!len || !amt || len.dataset.rk) return;
  len.dataset.rk = 'mist';
  len.setAttribute('aria-label', 'Mist length');
  const box = document.createElement('span');
  box.className = 'rk-mist';
  (amt.closest('.rk-k') || len).before(box);
  const graph = document.createElement('span');
  graph.className = 'rk-mist-graph';
  graph.title = 'The drips each grain sheds: how far they fall is the length. Drag up for longer, shift for fine.';
  graph.innerHTML = `<svg viewBox="0 0 ${RK_MIST_W} ${RK_MIST_H}" aria-hidden="true"></svg>`;
  const svg = graph.firstChild;
  const foot = document.createElement('span');
  foot.className = 'rk-pad-foot rk-mist-foot';
  foot.innerHTML = '<span>Length <b class="rk-pad-read rk-mist-read"></b></span>';
  graph.appendChild(len);
  // Amount, then length, as the overlay has always had them; the Visual
  // column draws the length first (CSS `order`).
  const knob = amt.closest('.rk-k');
  const col = document.createElement('span');
  col.className = 'rk-mist-col';
  col.append(graph, foot);
  if (knob) box.append(knob);
  box.append(col);
  const read = foot.querySelector('.rk-mist-read');
  const draw = () => {
    const l = +RK_VALUE.get.call(len), a = +RK_VALUE.get.call(amt);
    const fall = (l - +len.min) / (+len.max - +len.min);
    const n = Math.round(3 + 15 * (a - +amt.min) / (+amt.max - +amt.min));
    const top = 6, reach = 4 + fall * (RK_MIST_H - top - 6);
    let out = '';
    for (let g = 0; g < 5; g++) {
      const x0 = 16 + g * (RK_MIST_W - 32) / 4;
      out += `<circle class="rk-mist-grain" cx="${x0}" cy="${top}" r="3"/>`;
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        out += `<circle class="rk-mist-drop" cx="${(x0 + Math.sin(g * 1.7 + f * 3) * 3 * f).toFixed(1)}" cy="${(top + 3 + f * reach).toFixed(1)}" r="${(1.4 - 0.6 * f).toFixed(2)}" opacity="${(1 - 0.8 * f).toFixed(2)}"/>`;
      }
    }
    svg.innerHTML = out;
    box.classList.toggle('off', !!on && !on.checked);
    read.textContent = (l / 1000).toFixed(3);
  };
  rkOnValue(len, draw);
  rkOnValue(amt, draw);
  if (on) {
    const own = Object.getOwnPropertyDescriptor(on, 'checked') || RK_CHECKED;
    Object.defineProperty(on, 'checked', {
      configurable: true,
      get() { return own.get.call(this); },
      set(v) { own.set.call(this, v); draw(); },
    });
    on.addEventListener('change', draw);
  }
  rkDrag(len, () => !!len.closest('.rv-admin'));
  draw();
}

/// The channel box in the pads' words, four to a line. The long names stay
/// for the overlay on the master bus, where they always were.
const RK_CAM_WORDS = { reCamTx: 'MOVE X', reCamTy: 'MOVE Y', reCamTz: 'MOVE Z', reCamRx: 'TILT',
  reCamRy: 'TURN', reCamFocal: 'FOCAL', reCamCoi: 'CENTRE' };
function rkCamWords() {
  for (const [id, word] of Object.entries(RK_CAM_WORDS)) {
    const tag = $(id)?.closest('.re-row')?.querySelector('.re-tag');
    if (!tag || tag.querySelector('.rk-short')) continue;
    const long = document.createElement('span');
    long.className = 'rk-long';
    long.textContent = tag.textContent;
    const short = document.createElement('span');
    short.className = 'rk-short';
    short.textContent = word;
    tag.replaceChildren(long, short);
  }
}

/// Clear is the whole room back to default in one click, and stays one click —
/// presets and tests rely on it. What makes it safe is taking it back: the
/// look as it was is kept, and offered for a few seconds as Undo.
function rkUndoClear() {
  const clear = $('reClear');
  if (!clear || clear.dataset.rk) return;
  clear.dataset.rk = 'undo';
  const undo = document.createElement('button');
  undo.id = 'rkUndoClear';
  undo.type = 'button';
  undo.className = 're-btn rk-undo on';
  undo.textContent = 'Undo clear';
  undo.title = 'Put the room back as it was before Clear.';
  // In the panel only while it is on offer: a control nobody can see is one
  // the panel's own walk (`room-view.spec`) rightly calls unreachable.
  let kept = null, timer = 0;
  const hide = () => { undo.remove(); kept = null; clearTimeout(timer); };
  // Capture, so the look is kept before `roomClear` runs on the same click.
  clear.addEventListener('click', () => {
    kept = visualSnapshot();
    if (clear.closest('.rv-admin')) clear.before(undo);
    clearTimeout(timer);
    timer = setTimeout(hide, 10000);
  }, true);
  undo.onclick = () => {
    if (kept) applyVisual(kept);
    hide();
  };
}

/// Block is the data's own square on the wall: how many lines it holds and
/// how strongly it sits there. The two are named alike, so the row reads as
/// one thing with two settings.
function rkBlockWords() {
  const chunks = $('reChunks');
  if (!chunks || chunks.parentElement.classList.contains('rk-chunk')) return;
  const box = document.createElement('span');
  box.className = 'rk-chunk';
  chunks.before(box);
  const word = document.createElement('i');
  word.className = 'rk-l';
  word.textContent = 'Size';
  box.append(chunks, word);
}

/// The mouse-and-key legend and the pose readout: what a person learns once
/// and a developer copies once. Folded behind one switch, remembered.
function rkKeys(host) {
  const btn = document.createElement('button');
  btn.id = 'rkKeys';
  btn.className = 're-btn rk-keys';
  btn.type = 'button';
  btn.textContent = 'Keys & pose';
  btn.title = 'How the room is moved with the mouse and keys, and the pose the dragging has made (click it to copy).';
  btn.setAttribute('aria-controls', 'reNums');
  btn.style.setProperty('--rk', 23);
  let open = false;
  try { open = localStorage.getItem('roomKeysOpen') === '1'; } catch { /* folded */ }
  const set = (v) => {
    open = v;
    host.classList.toggle('rk-keys-open', v);
    btn.setAttribute('aria-expanded', String(v));
    try { localStorage.setItem('roomKeysOpen', v ? '1' : '0'); } catch { /* not remembered */ }
  };
  btn.onclick = () => set(!open);
  set(open);
  host.appendChild(btn);
}
const RK_CHECKED = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');

function rkBuild() {
  const host = $('roomEdit');
  if (!host || host.dataset.rk) return;
  host.dataset.rk = 'built';
  for (const [id, label] of Object.entries(RK_KNOBS)) rkKnob($(id), label);
  // Each row takes its group's place. By the control it holds, so a row added
  // later without a place lands at the end rather than in somebody's group.
  for (const [key, order] of RK_ORDER) {
    const el = $(key) || host.querySelector(`.${key}`);
    const row = el && (el.parentElement === host ? el : el.closest('#roomEdit > *'));
    if (row) row.style.setProperty('--rk', order);
  }
  // The rows that are one knob and nothing else, named rather than found: a
  // row can still be filling when this runs — Block's sizes arrive later — and
  // a row counted as a lone knob then loses its tag and its width.
  for (const id of RK_CELLS) $(id)?.closest('.re-row')?.classList.add('rk-cell');
  for (const [order, text] of RK_HEADS) {
    const h = document.createElement('div');
    h.className = 'rk-head';
    h.textContent = text;
    h.style.setProperty('--rk', order);
    host.appendChild(h);
  }
  rkBuildPads(host);
  rkPadsSync();
  rkFog();
  rkMist();
  rkCamWords();
  rkKeys(host);
  rkUndoClear();
  rkBlockWords();
}
rkBuild();

