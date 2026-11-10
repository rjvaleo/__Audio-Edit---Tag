// ───────────────────────────────────────────────────────────────── the box ──
//
// The master bus as a room in perspective: the spectrum along the floor
// travelling backwards as the sound plays, the Lissajous in the sky with time
// as its third axis, the ladders standing at the right end. Rendered by
// `vis-gl.js`, which is ours — see `docs/VISUALISER.md`.

let visGl = null;
let visGlRaf = null;

/// A theme token as a WebGL colour.
function vgRgb(token, fallback) {
  const hex = cssHex(mbInk(token, fallback)) || fallback;
  return new Float32Array([
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]);
}

/// The ridgeline's settings, as the renderer wants them — its own defaults with
/// whatever has been changed laid over.
function ridgeSettings() {
  return { ...RDG_DEFAULTS, ...(roomEdit.ridge || {}) };
}

/// The room built out of ridgelines. See `docs/ROOM-3D.md`.
function room3dSettings() {
  return { ...R3_DEFAULTS, ...(roomEdit.room3d || {}) };
}

/// The rebuild. See `docs/PORT-PLAN.md`.
/// **The palette wins over the defaults.** The colours in `ST_DEFAULTS` are where
/// a scheme starts from, not what it is stuck with — a slot the palette has been
/// given a colour for overrides the default, and one left inheriting keeps it.
/// Without this the colour manager applied to the stage did nothing at all,
/// which is a control that lies.
function stageSettings() {
  const base = { ...ST_DEFAULTS, ...(roomEdit.stage || {}) };
  // **A setting that is not in the admin is not taken from a saved scene
  // either.** Otherwise a value stored before it was unlisted turns the thing
  // on and nothing on screen can turn it off again — the switch it needs is the
  // one that was just taken away. Saved scenes are not edited to achieve this;
  // the value is simply ignored while the key is hidden, so emptying
  // `ST_ADMIN_HIDDEN` hands every one of them straight back.
  for (const k of ST_ADMIN_HIDDEN) base[k] = ST_DEFAULTS[k];
  if (typeof ST_SLOTS === 'undefined' || typeof rpSlot !== 'function') return base;
  const painted = {
    stageTerrain: 'terrainColour',
    stageSleeve: 'sleeveColour',
    stageRing: 'ringColour',
    stageGrains: 'cloudColour',
    stageMist: 'mistColour',
    stageType: 'typeColour',
    stageWalls: 'wallColour',
    stageGround: 'groundColour',
  };
  for (const [slot, key] of Object.entries(painted)) {
    const c = rpSlot(slot);
    if (c && c.mode === 'flat' && c.colour) base[key] = c.colour;
  }
  return base;
}

/// The card of type. See `docs/ROOM-TEXT.md`.
function roomTextSettings() {
  return rtSettings(roomEdit.text);
}

/// What the card is drawn in.
///
/// **The card itself defaults to the background of whichever module is on**,
/// which is the whole of why it works: filled with the ground, the card is not a
/// panel laid over the picture but a hole in it, and the lines behind simply
/// stop at its edge.
function roomTextPaint() {
  const pick = (key, fallback) => {
    const c = rpSlot(key);
    return c.mode === 'flat' && c.colour ? c.colour : fallback;
  };
  const ground = visModuleKey() === 'room'
    ? rpToken('--bg', '#07090c')
    : ridgePaint().background;
  return {
    face: pick('textFace', rpToken('--text', '#ffffff')),
    side: pick('textSide', rpToken('--muted', '#6d7480')),
    card: pick('textCard', ground),
  };
}

/// What it is drawn in. The palette owns it, the same way it owns the room's
/// fourteen slots, and falls back to the theme.
///
/// **The fill is the background by default and is its own slot anyway.** It is
/// what hides the lines behind, so it is normally the ground — but a picture
/// where the fill is a shade off the ground is a different and sometimes better
/// picture, and there is no reason to forbid it.
function ridgePaint() {
  const pick = (key, fallback) => {
    const c = rpSlot(key);
    return c.mode === 'flat' && c.colour ? c.colour : fallback;
  };
  const ground = pick('ridgeBackground', rpToken('--sink', '#07090c'));
  return {
    line: pick('ridgeLine', rpToken('--text', '#ffffff')),
    fill: pick('ridgeFill', ground),
    background: ground,
  };
}

/// The card's controls.
///
/// Its own block rather than a tab, and shown under both modules, because the
/// card belongs to the room and not to either visualiser.
function buildRoomTextPanel() {
  const host = $('textEdit');
  if (!host || host.children.length) return;
  const set = (k, v) => {
    roomEdit.text = { ...roomTextSettings(), [k]: v };
    saveRoomData();
    paintRoomText();
    paintRoomTextPanel();
  };

  const head = rpEl('div', 're-row');
  head.appendChild(rpEl('span', 're-tag', 'TEXT'));
  const on = rpEl('button', 're-btn', 'off');
  on.id = 'rtOn';
  on.title = 'A card of type, in front of everything. Filled with the background, so the picture stops at its edge rather than running behind it.';
  on.onclick = () => set('on', !roomTextSettings().on);
  head.appendChild(on);
  const edit = rpEl('button', 're-btn', 'edit');
  edit.title = 'Type into the card. Double-clicking it in the room does the same.';
  edit.onclick = () => {
    if (!roomTextSettings().on) set('on', true);
    const c = roomTextCanvas();
    if (c) openRoomTextInput(c);
  };
  head.appendChild(edit);
  host.appendChild(head);

  // Where it stands, which is the one thing better dragged than typed — so this
  // says so rather than offering four more sliders for it.
  const note = rpEl('div', 're-note',
    'Drag the card to move it and its corners to size it. Double-click to type.');
  host.appendChild(note);

  // Solid or wireframe. A pair of buttons rather than a switch, because there
  // are two of them and they are both nouns.
  const styleRow = rpEl('div', 're-row');
  styleRow.appendChild(rpEl('span', 're-tag', 'STYLE'));
  const styleBox = rpEl('div', 're-frames');
  styleBox.id = 'rtStyle';
  for (const [key, label, hint] of [
    ['solid', 'solid', 'Filled letters, with their sides a solid mass.'],
    ['wire', 'wireframe', 'Outlines all the way through, so the picture shows between the rungs and the letters read as built rather than as printed.'],
  ]) {
    const b = rpEl('button', 're-btn', label);
    b.dataset.rtStyle = key;
    b.title = hint;
    b.onclick = () => set('style', key);
    styleBox.appendChild(b);
  }
  styleRow.appendChild(styleBox);
  host.appendChild(styleRow);

  const alignRow = rpEl('div', 're-row');
  alignRow.appendChild(rpEl('span', 're-tag', 'ALIGN'));
  const alignBox = rpEl('div', 're-frames');
  alignBox.id = 'rtAlign';
  for (const a of ['left', 'center', 'right']) {
    const b = rpEl('button', 're-btn', a === 'center' ? 'centre' : a);
    b.dataset.rtAlign = a;
    b.onclick = () => set('align', a);
    alignBox.appendChild(b);
  }
  alignRow.appendChild(alignBox);
  host.appendChild(alignRow);

  for (const row of RT_UI) {
    const box = rpEl('div', 're-row');
    const tag = rpEl('span', 're-tag', row.tag);
    tag.title = row.hint;
    box.appendChild(tag);
    const sl = rpEl('input', 're-slider');
    sl.type = 'range';
    const k = row.round ? 1 : 10000;
    sl.min = String(Math.round(row.min * k));
    sl.max = String(Math.round(row.max * k));
    sl.step = String(Math.max(1, Math.round(row.step * k)));
    sl.dataset.rtKey = row.key;
    sl.title = row.hint;
    const read = rpEl('span', 'rg-read', '');
    read.dataset.rtRead = row.key;
    sl.oninput = () => set(row.key, +sl.value / k);
    box.appendChild(sl);
    box.appendChild(read);
    host.appendChild(box);
  }
  paintRoomTextPanel();
}

function paintRoomTextPanel() {
  const host = $('textEdit');
  if (!host || !host.children.length) return;
  const st = roomTextSettings();
  const on = $('rtOn');
  if (on) {
    on.classList.toggle('active', st.on);
    on.textContent = st.on ? 'on' : 'off';
  }
  for (const b of host.querySelectorAll('[data-rt-align]')) {
    b.classList.toggle('active', b.dataset.rtAlign === st.align);
  }
  for (const b of host.querySelectorAll('[data-rt-style]')) {
    b.classList.toggle('active', b.dataset.rtStyle === st.style);
  }
  for (const row of RT_UI) {
    const sl = host.querySelector(`[data-rt-key="${row.key}"]`);
    const read = host.querySelector(`[data-rt-read="${row.key}"]`);
    if (!sl) continue;
    const k = row.round ? 1 : 10000;
    if (document.activeElement !== sl) sl.value = String(Math.round(st[row.key] * k));
    if (read) {
      read.textContent = row.round ? String(Math.round(st[row.key]))
        : (row.step < 0.001 ? st[row.key].toFixed(4) : st[row.key].toFixed(2));
    }
    // Nothing to lean if the letters are flat.
    if (row.key === 'angle') {
      sl.closest('.re-row').classList.toggle('dim-block', st.depth <= 0);
    }
    // The rungs and the stroke are the wireframe's, and mean nothing to solid
    // letters.
    if (row.wire) {
      sl.closest('.re-row').classList.toggle('dim-block', st.style !== 'wire');
    }
  }
  // Everything below the switch is inert while the card is off.
  host.classList.toggle('rt-off', !st.on);
}

/// The surfaces module's controls.
function buildRoom3dPanel() {
  const host = $('room3dEdit');
  if (!host || host.children.length) return;
  const set = (k, v) => {
    roomEdit.room3d = { ...room3dSettings(), [k]: v };
    saveRoomData();
    const r = visLive.room3d;
    if (r && r.configure) r.configure(room3dSettings());
    paintRoom3dPanel();
  };

  const faceRow = rpEl('div', 're-row');
  faceRow.appendChild(rpEl('span', 're-tag', 'FACES'));
  const faceBox = rpEl('div', 're-frames');
  faceBox.id = 'r3Faces';
  for (const [key, label] of R3_FACES) {
    const b = rpEl('button', 're-btn', label);
    b.dataset.r3Face = key;
    b.title = key === 'back'
      ? 'The sleeve itself, at the end of the room: rows born at the bottom and climbing.'
      : `The ${label.toLowerCase()}, with its rows running away from you into the room.`;
    b.onclick = () => set(key, !room3dSettings()[key]);
    faceBox.appendChild(b);
  }
  faceRow.appendChild(faceBox);
  host.appendChild(faceRow);

  for (const row of R3_UI) {
    const box = rpEl('div', 're-row');
    const tag = rpEl('span', 're-tag', row.tag);
    tag.title = row.hint;
    box.appendChild(tag);
    const sl = rpEl('input', 're-slider');
    sl.type = 'range';
    const k = row.round ? 1 : 1000;
    sl.min = String(Math.round(row.min * k));
    sl.max = String(Math.round(row.max * k));
    sl.step = String(Math.max(1, Math.round(row.step * k)));
    sl.dataset.r3Key = row.key;
    sl.title = row.hint;
    const read = rpEl('span', 'rg-read', '');
    read.dataset.r3Read = row.key;
    sl.oninput = () => set(row.key, +sl.value / k);
    box.appendChild(sl);
    box.appendChild(read);
    host.appendChild(box);
  }
  paintRoom3dPanel();
}

/// The stage's controls: what is switched on, then everything with a number.
///
/// Built from `ST_OBJECTS` and `ST_UI` rather than written out by hand, so a
/// thing added to the scene appears here by having been described once. The
/// room's own panel is a row per control in the markup, which is why adding a
/// layer to it means editing a panel and why the two could disagree about what
/// exists.
/// One control, two numbers.
///
/// **A pad, because it is one gesture.** Where the key light hangs is a single
/// decision with two components; split into two sliders you make it by
/// alternating between them and checking a third thing to see whether you have
/// arrived. Here the two axes are under one finger and the thing being steered
/// is the picture.
function stagePad(spec, set) {
  const xDef = ST_UI.find((r) => r.key === spec.x);
  const yDef = ST_UI.find((r) => r.key === spec.y);
  if (!xDef || !yDef) return null;

  const wrap = rpEl('div', 'st-pad-wrap');
  const tag = rpEl('span', 're-tag', spec.label);
  tag.title = spec.hint;
  wrap.appendChild(tag);

  const pad = rpEl('div', 'st-pad');
  pad.title = spec.hint;
  pad.dataset.stPadX = spec.x;
  pad.dataset.stPadY = spec.y;
  const dot = rpEl('div', 'st-pad-dot');
  pad.appendChild(dot);
  const read = rpEl('span', 'st-pad-read', '');
  read.dataset.stPadRead = `${spec.x}|${spec.y}`;

  const frac = (def, v) => (v - def.min) / Math.max(1e-9, def.max - def.min);
  const val = (def, f) => {
    const raw = def.min + Math.max(0, Math.min(1, f)) * (def.max - def.min);
    return def.round ? Math.round(raw) : Math.round(raw / def.step) * def.step;
  };

  let dragging = false;
  const put = (e) => {
    const b = pad.getBoundingClientRect();
    const fx = (e.clientX - b.left) / b.width;
    // Up is more. A pad where up means less is a pad nobody trusts.
    const fy = 1 - (e.clientY - b.top) / b.height;
    const st = stageSettings();
    roomEdit.stage = { ...st, [spec.x]: val(xDef, fx), [spec.y]: val(yDef, fy) };
    saveRoomData();
    const r = visLive.stage;
    if (r && r.configure) r.configure(stageSettings());
    paintStagePanel();
  };
  pad.addEventListener('pointerdown', (e) => {
    dragging = true;
    pad.setPointerCapture(e.pointerId);
    e.preventDefault();
    put(e);
  });
  pad.addEventListener('pointermove', (e) => { if (dragging) put(e); });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { pad.releasePointerCapture(e.pointerId); } catch {}
  };
  pad.addEventListener('pointerup', stop);
  pad.addEventListener('pointercancel', stop);

  pad.__paint = () => {
    const st = stageSettings();
    dot.style.left = `${Math.max(0, Math.min(1, frac(xDef, st[spec.x]))) * 100}%`;
    dot.style.bottom = `${Math.max(0, Math.min(1, frac(yDef, st[spec.y]))) * 100}%`;
    const fmt = (d, v) => (d.round ? String(Math.round(v)) : v.toFixed(d.step < 0.01 ? 3 : 2));
    read.textContent = `${xDef.tag} ${fmt(xDef, st[spec.x])}  ·  ${yDef.tag} ${fmt(yDef, st[spec.y])}`;
  };

  wrap.appendChild(pad);
  wrap.appendChild(read);
  return wrap;
}

function stageSlider(row, set) {
  const box = rpEl('div', 're-row');
  const tag = rpEl('span', 're-tag', row.tag);
  tag.title = row.hint;
  box.appendChild(tag);
  // **A choice from a list is a menu, not a slider.** Thirty-eight named solids
  // have no order to slide along, no readout anyone can read as a shape, and no
  // way back to the one you liked. See `ST_PICKS`.
  if (row.pick && typeof ST_PICKS !== 'undefined' && ST_PICKS[row.pick]) {
    const sel = rpEl('select', 'field mini');
    sel.dataset.stPick = row.key;
    sel.title = row.hint;
    for (const o of ST_PICKS[row.pick]()) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.value = stageSettings()[row.key];
    sel.onchange = () => set(row.key, sel.value);
    box.appendChild(sel);
    return box;
  }
  const sl = rpEl('input', 're-slider');
  sl.type = 'range';
  const k = row.round ? 1 : 1000;
  sl.min = String(Math.round(row.min * k));
  sl.max = String(Math.round(row.max * k));
  sl.step = String(Math.max(1, Math.round(row.step * k)));
  sl.dataset.stKey = row.key;
  sl.title = row.hint;
  const read = rpEl('span', 'rg-read', '');
  read.dataset.stRead = row.key;
  sl.oninput = () => set(row.key, +sl.value / k);
  box.appendChild(sl);
  box.appendChild(read);
  return box;
}

function buildStagePanel() {
  const host = $('stageEdit');
  if (!host || host.children.length) return;
  const set = (k, v) => {
    roomEdit.stage = { ...stageSettings(), [k]: v };
    // Solo is a way of working rather than a look, and a session that opened
    // soloed would look broken.
    if (k !== 'solo') saveRoomData();
    const r = visLive.stage;
    if (r && r.configure) r.configure(stageSettings());
    paintStagePanel();
  };

  // **Everything has a switch, and the switches are grouped too.** Twenty
  // buttons in one row is the same fault as forty-four sliders in a column: it
  // is a list of everything rather than a way of reaching anything.
  let objGroup = null;
  for (const o of ST_OBJECTS) {
    // Described but not listed — see `ST_ADMIN_HIDDEN`. The group header is only
    // written when a switch is actually about to go under it, or hiding the last
    // switch in a group leaves an empty heading behind.
    if (!stInAdmin(o.key)) continue;
    if (o.group !== objGroup) {
      objGroup = o.group;
      const row = rpEl('div', 're-row');
      row.appendChild(rpEl('span', 're-tag', (o.group || 'Things').toUpperCase()));
      const box = rpEl('div', 're-frames');
      box.dataset.stObjGroup = o.group || 'Things';
      row.appendChild(box);
      host.appendChild(row);
    }
    const box = host.querySelector(`[data-st-obj-group="${o.group || 'Things'}"]`);
    const b = rpEl('button', 're-btn', o.label);
    b.dataset.stObj = o.key;
    // **Shift to solo.** Judging one object through the other eight is really
    // judging the pile; soloed it is tuned on its own and then let back in. It
    // is a filter rather than an edit, so letting go of it puts the scene back
    // exactly as it was without anyone having to remember what was on.
    b.title = `${o.hint}\n\nShift-click to solo.`;
    b.onclick = (e) => {
      if (e.shiftKey) {
        const st = stageSettings();
        set('solo', st.solo === o.key ? null : o.key);
        return;
      }
      set(o.key, !stageSettings()[o.key]);
      // **The two halves of the panel stay in step.** Turning a thing on and
      // then hunting for its controls is the navigation problem the sections
      // were meant to solve, not one to leave in place.
      const owner = ST_GROUPS.find((g) => g.owner === o.key);
      if (owner) { stageOpenGroup = owner.key; paintStagePanel(); }
    };
    box.appendChild(b);
  }

  // ── where you are standing ──
  //
  // **Pinned above the scene, not filed among it.** The camera is not a thing in
  // the room; it is where you are to look at the room, and every 3D application
  // treats that as a property of the viewport. So it sits apart, it says what the
  // gestures are, and its numbers are a readout you can also dial.
  const camHead = rpEl('div', 'st-group');
  camHead.textContent = 'View';
  host.appendChild(camHead);
  const camNote = rpEl('div', 'st-note',
    'Drag the picture to orbit · shift-drag to slide · wheel to pull in · alt-drag the key light · double-click to frame it again');
  host.appendChild(camNote);
  for (const key of ST_CAM_UI) {
    const row = ST_UI.find((r) => r.key === key);
    if (row) host.appendChild(stageSlider(row, set));
  }
  const camRow = rpEl('div', 're-row');
  const frame = rpEl('button', 're-btn', 'Frame it');
  frame.title = 'Back to where this view opens. Double-clicking the picture does the same thing.';
  frame.onclick = () => frameStageView();
  camRow.appendChild(frame);
  host.appendChild(camRow);

  // ── one section per object ──
  //
  // Named after the switch that turns the object on, in the same order as the
  // switches, so the thing you are looking at and the controls for it have the
  // same name in the same order in both halves of the panel.
  //
  // **One open at a time.** Fifty numbers are only a list when they are all on
  // screen at once; opened one section at a time they are eight or nine, which
  // is a set you can read.
  for (const g of ST_GROUPS) {
    const sliders = (g.sliders || []).filter((k) => stInAdmin(k));
    if (!sliders.length) continue;
    const head = rpEl('button', 'st-group st-fold', g.label);
    head.dataset.stFold = g.key;
    head.title = g.hint;
    const body = rpEl('div', 'st-fold-body');
    body.dataset.stFoldBody = g.key;
    for (const key of sliders) {
      const row = ST_UI.find((r) => r.key === key);
      if (row) body.appendChild(stageSlider(row, set));
    }
    head.onclick = () => {
      const openNow = stageOpenGroup === g.key ? null : g.key;
      stageOpenGroup = openNow;
      paintStagePanel();
    };
    host.appendChild(head);
    host.appendChild(body);
  }

  buildViewEditor(host, set);

  const foot = rpEl('div', 're-row');
  const reset = rpEl('button', 're-btn', 'Back to default');
  reset.title = 'Put the whole room back to the shape and the light it ships with.';
  reset.onclick = () => { roomEdit.stage = {}; saveRoomData();
    const r = visLive.stage; if (r && r.configure) r.configure(stageSettings());
    paintStagePanel(); };
  foot.appendChild(reset);
  host.appendChild(foot);

  paintStagePanel();
}


