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


/// The view's own look, and the library of looks.
///
/// **Ten views is ten things to look at, not one thing seen ten ways.** Braid
/// wants long trails and Shear wants none; sharing one set of controls means
/// every switch of view is followed by a re-dial. So what is edited here belongs
/// to the arrangement that is showing, and switching away and back finds it as
/// it was left. See `ST_LOOKS`.
///
/// The pads are the other half of that: a look worth keeping is usually worth
/// dropping onto a different view, so the library is shared while what it lands
/// on is not. Click recalls, shift-click saves what is showing, alt-click
/// clears — and they are on disk, because a saved look is a decision.
function buildViewEditor(host, set) {
  const wrap = rpEl('div', 'st-view');
  wrap.id = 'stageViewEdit';
  host.appendChild(wrap);
  paintViewEditor();
  return wrap;
}

/// The look being edited: whichever arrangement is on the stage.
///
/// Null when the stage is showing as itself rather than as one of the ten — the
/// room's own cloud is lit solids and has none of this.
function viewEditKey() {
  const st = stageSettings();
  if (!st.cloudInk) return null;
  const lay = (typeof stLayout === 'function') ? stLayout(st.cloudLayout) : null;
  return lay && lay.ported ? lay.key : null;
}

function setViewLook(patch) {
  const key = viewEditKey();
  if (!key) return;
  const st = stageSettings();
  const looks = { ...(st.looks || {}) };
  looks[key] = { ...stLook(st, key), ...patch };
  roomEdit.stage = { ...st, looks };
  saveRoomData();
  const r = visLive.stage;
  if (r && r.configure) r.configure(stageSettings());
  paintViewEditor();
}

let stagePads = null;

function paintViewEditor() {
  const wrap = $('stageViewEdit');
  if (!wrap) return;
  const key = viewEditKey();
  wrap.innerHTML = '';
  // Nothing to edit when the stage is showing as itself. An empty panel is
  // better than a panel of controls that quietly write to nothing.
  wrap.classList.toggle('hidden', !key);
  if (!key) return;
  const look = stLook(stageSettings(), key);
  const lay = stLayout(key);

  const head = rpEl('div', 'st-group');
  head.textContent = `${lay.label} — look`;
  wrap.appendChild(head);

  // ── the palette ──
  //
  // Three colours, spread across fourteen. The middle one is the midpoint
  // rather than a third of the way along, which is what makes three colours sit
  // in a picture as a range instead of as three stripes.
  const prow = rpEl('div', 're-row');
  prow.appendChild(rpEl('span', 're-tag', 'PALETTE'));
  for (let i = 0; i < 3; i++) {
    const c = document.createElement('input');
    c.type = 'color';
    c.className = 'st-swatch';
    c.value = look.palette[i];
    c.title = ['The near end of the ramp.', 'The middle of it.', 'The far end.'][i];
    c.oninput = () => {
      const pal = look.palette.slice();
      pal[i] = c.value;
      setViewLook({ palette: pal });
    };
    prow.appendChild(c);
  }
  wrap.appendChild(prow);

  // ── what the colour is of ──
  const crow = rpEl('div', 're-row');
  crow.appendChild(rpEl('span', 're-tag', 'COLOUR BY'));
  const cbox = rpEl('div', 're-frames');
  for (const [k, v] of Object.entries(ST_COLOUR_BY)) {
    const b = rpEl('button', 're-btn', v.label);
    b.classList.toggle('active', look.colourBy === k);
    b.title = 'Stretched across the range this cloud actually uses, not the range it could have — a couple of semitones against forty-eight is a monochrome picture.';
    b.onclick = () => setViewLook({ colourBy: k });
    cbox.appendChild(b);
  }
  crow.appendChild(cbox);
  wrap.appendChild(crow);

  // ── the numbers ──
  const num = (tag, k, lo, hi, step, hint, round) => {
    const row = rpEl('div', 're-row');
    row.appendChild(rpEl('span', 're-tag', tag));
    const sl = rpEl('input', 're-slider');
    sl.type = 'range';
    sl.min = String(Math.round(lo * 1000));
    sl.max = String(Math.round(hi * 1000));
    sl.step = String(Math.round(step * 1000));
    sl.value = String(Math.round(look[k] * 1000));
    sl.title = hint;
    const read = rpEl('span', 'rg-read', round ? String(Math.round(look[k])) : look[k].toFixed(2));
    sl.oninput = () => {
      const v = Number(sl.value) / 1000;
      read.textContent = round ? String(Math.round(v)) : v.toFixed(2);
      setViewLook({ [k]: round ? Math.round(v) : v });
    };
    row.appendChild(sl);
    row.appendChild(read);
    wrap.appendChild(row);
  };
  // The fold is a property of the looking rather than of the sound, so it only
  // means anything where there is a moment to look at.
  if (lay.suite === 2) {
    num('FOLDS', 'mirror', 1, 14, 1,
      'How many times the cloud is repeated around the circle. One is no fold at all.', true);
  }
  // **The third glow, and the third name.** This one is the view's own: it
  // multiplies GRAIN GLOW for whichever of the ten is showing, so Mandala can
  // be hot and Lattice cool without either touching the other. Called GLOW like
  // the other two it was one word over three different things in one panel.
  num('INK', 'glow', 0, 2, 0.01,
    'How much light this view’s strokes give off, on top of GRAIN GLOW. The picture is additive on black, so this is the whole exposure — and it belongs to this view alone.');
  num('TRAIL', 'trail', 0, 1, 0.01,
    'How long a grain lingers after it has finished sounding. Physically there is nothing there — it is an afterimage, so the eye can see where the playhead has been.');

  // ── the pads ──
  if (!stagePads) stagePads = stReadPads();
  const phead = rpEl('div', 're-row');
  phead.appendChild(rpEl('span', 're-tag', 'LOOKS'));
  wrap.appendChild(phead);
  const grid = rpEl('div', 're-frames');
  grid.className = 're-frames st-pads';
  for (let i = 0; i < ST_PAD_COUNT; i++) {
    const pad = stagePads[i];
    const b = rpEl('button', 're-btn', pad ? pad.name : '·');
    b.classList.toggle('st-pad-empty', !pad);
    b.title = pad
      ? `${pad.name}\n\nClick to drop it on ${lay.label}. Shift-click to overwrite it with what is showing. Alt-click to clear it.`
      : 'Empty. Shift-click to save what is showing here.';
    b.onclick = (e) => {
      if (e.altKey) {
        stagePads[i] = null;
        stWritePads(stagePads);
        paintViewEditor();
        return;
      }
      if (e.shiftKey) {
        const cur = stLook(stageSettings(), key);
        stagePads[i] = { name: lay.label, glow: cur.glow, trail: cur.trail,
          mirror: cur.mirror, colourBy: cur.colourBy, palette: cur.palette.slice() };
        stWritePads(stagePads);
        paintViewEditor();
        return;
      }
      if (!pad) return;
      setViewLook({ glow: pad.glow, trail: pad.trail, mirror: pad.mirror,
        colourBy: pad.colourBy, palette: pad.palette.slice() });
    };
    grid.appendChild(b);
  }
  wrap.appendChild(grid);

  // ── back to how the view ships ──
  const frow = rpEl('div', 're-row');
  const back = rpEl('button', 're-btn', 'Back to the view\u2019s own look');
  back.title = 'Everything above, returned to what this view opens as. The other nine are untouched.';
  back.onclick = () => {
    const st = stageSettings();
    const looks = { ...(st.looks || {}) };
    delete looks[key];
    roomEdit.stage = { ...st, looks };
    saveRoomData();
    const r = visLive.stage;
    if (r && r.configure) r.configure(stageSettings());
    paintViewEditor();
  };
  frow.appendChild(back);
  wrap.appendChild(frow);
}

/// Which section of the panel is open. One at a time — see `ST_GROUPS`.
let stageOpenGroup = 'grains';

function paintStagePanel() {
  const host = $('stageEdit');
  if (!host || !host.children.length) return;
  for (const b of host.querySelectorAll('[data-st-fold]')) {
    b.classList.toggle('open', b.dataset.stFold === stageOpenGroup);
  }
  for (const b of host.querySelectorAll('[data-st-fold-body]')) {
    b.classList.toggle('hidden', b.dataset.stFoldBody !== stageOpenGroup);
  }
  // **Rebuilt, not just refreshed.** What the view editor offers depends on
  // which arrangement is showing — the fold means nothing to a view of the whole
  // object — so it cannot be painted once and left. Built once and left, it went
  // on showing the controls for whichever view happened to be up when the panel
  // was first made, and writing to that one.
  paintViewEditor();
  const st = stageSettings();
  for (const b of host.querySelectorAll('[data-st-obj]')) {
    b.classList.toggle('active', !!st[b.dataset.stObj]);
    b.classList.toggle('st-solo', st.solo === b.dataset.stObj);
    // Everything not soloed says so, or a scene with eight things missing looks
    // like eight things broken.
    b.classList.toggle('st-muted', !!st.solo && st.solo !== b.dataset.stObj
      && !(st.solo === 'sleeveOn' && b.dataset.stObj.startsWith('sleeve')));
  }
  host.classList.toggle('st-soloing', !!st.solo);
  for (const row of ST_UI) {
    const pick = host.querySelector(`[data-st-pick="${row.key}"]`);
    if (pick && document.activeElement !== pick) pick.value = st[row.key];
    const sl = host.querySelector(`[data-st-key="${row.key}"]`);
    const read = host.querySelector(`[data-st-read="${row.key}"]`);
    if (!sl) continue;
    const k = row.round ? 1 : 1000;
    if (document.activeElement !== sl) sl.value = String(Math.round(st[row.key] * k));
    if (read) {
      read.textContent = row.round ? String(Math.round(st[row.key]))
        : (row.step < 0.01 ? st[row.key].toFixed(3) : st[row.key].toFixed(2));
    }
    // A control for a thing that is switched off says so rather than lying.
    const owner2 = { gridSize: 'grid', gridFade: 'grid', wireWidth: 'wire',
      shadowSoft: 'shadows', bloomAmount: 'bloom', bloomThreshold: 'bloom',
      fogDensity: 'fogOn', mist: 'mistOn', mistSize: 'mistOn', mistDrift: 'mistOn',
      key: 'keyOn', keySide: 'keyOn', keyHigh: 'keyOn', keyAt: 'keyOn',
      fill: 'fillOn', rim: 'rimOn' }[row.key];
    if (owner2) sl.closest('.re-row').classList.toggle('dim-block', !st[owner2]);
  }
  for (const pad of host.querySelectorAll('.st-pad')) {
    if (pad.__paint) pad.__paint();
  }
}

function paintRoom3dPanel() {
  const host = $('room3dEdit');
  if (!host || !host.children.length) return;
  const st = room3dSettings();
  for (const b of host.querySelectorAll('[data-r3-face]')) {
    b.classList.toggle('active', !!st[b.dataset.r3Face]);
  }
  for (const row of R3_UI) {
    const sl = host.querySelector(`[data-r3-key="${row.key}"]`);
    const read = host.querySelector(`[data-r3-read="${row.key}"]`);
    if (!sl) continue;
    const k = row.round ? 1 : 1000;
    if (document.activeElement !== sl) sl.value = String(Math.round(st[row.key] * k));
    if (read) {
      read.textContent = row.round ? String(Math.round(st[row.key]))
        : (row.step < 0.01 ? st[row.key].toFixed(3) : st[row.key].toFixed(2));
    }
  }
}

/// Dragging the picture itself.
///
/// **The thing you are steering should be under your hand.** A pad beside the
/// picture is better than two sliders, and the picture is better than a pad:
/// there is no mapping to hold in your head, no reaching away from what you are
/// looking at, and no wondering which of two numbers to try next.
///
/// Plain drag stands the camera somewhere else — across and up. Shift-drag moves
/// the key light instead, because where the lamp hangs is the other thing you
/// change while watching. The wheel dollies.
///
/// It is attached once and never removed. The canvas outlives any one visual and
/// a listener added on each switch is a listener added many times.
/// Turning the picture over, the way every 3D application does it.
///
/// **The camera belongs to the viewport, not to the panel.** Maya tumbles on
/// alt-drag, Blender orbits on middle-drag, and both pan on a modifier and dolly
/// on the wheel; not one of them asks you to find a slider. Before this the stage
/// had five camera numbers across three pads and *no way to get round the far
/// side of anything* — the rig slid on a plane and aimed down the room's axis, so
/// a view could be shuffled sideways and squinted at but never turned over.
///
///   drag         orbit. Drag left and the subject turns to the left, because
///                the picture follows the hand — the way every map and every
///                viewport has ever worked.
///   shift-drag   pan. Slides the point being orbited, which is what lets you
///                look at a corner of something rather than always its middle.
///   alt-drag     the key light, which used to be shift-drag and had to move
///                when the camera took the modifier every other program uses.
///   wheel        dolly. Proportional, so it closes in smoothly instead of
///                crawling far out and lurching close in.
///   double-click frame it again: back to how this view opens.
function wireStageDrag(canvas) {
  if (canvas.__stDrag) return;
  canvas.__stDrag = true;
  let from = null;

  const bounds = (key) => ST_UI.find((r) => r.key === key);
  const put = (patch) => {
    const st = stageSettings();
    const next = { ...st };
    for (const [k, v] of Object.entries(patch)) {
      const def = bounds(k);
      next[k] = def ? Math.max(def.min, Math.min(def.max, v)) : v;
    }
    roomEdit.stage = next;
    saveRoomData();
    const r = visLive.stage;
    if (r && r.configure) r.configure(stageSettings());
    paintStagePanel();
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (visModuleKey() !== 'stage') return;
    from = { x: e.clientX, y: e.clientY, alt: e.altKey, shift: e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = e.altKey ? 'crosshair' : (e.shiftKey ? 'move' : 'grabbing');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!from || visModuleKey() !== 'stage') return;
    const b = canvas.getBoundingClientRect();
    const dx = (e.clientX - from.x) / Math.max(1, b.width);
    const dy = (e.clientY - from.y) / Math.max(1, b.height);
    from = { ...from, x: e.clientX, y: e.clientY };
    const st = stageSettings();

    if (from.alt) {
      const kd = bounds('keySide'), kh = bounds('keyHigh');
      // Up is up. Screen y grows downward, and a lamp that goes down when you
      // drag up is a lamp nobody can aim.
      put({ keySide: st.keySide + dx * (kd.max - kd.min),
            keyHigh: st.keyHigh - dy * (kh.max - kh.min) });
      return;
    }
    if (from.shift) {
      // Panning slides the point in the camera's own plane, not the world's, or
      // dragging right sends the subject sideways *and* into the screen as soon
      // as the view has been turned at all.
      const scale = st.dist * Math.tan(st.fov / 2) * 2;
      const c = Math.cos(st.orbit), sn = Math.sin(st.orbit);
      put({ panX: (st.panX || 0) - dx * scale * c,
            panZ: (st.panZ || 0) + dx * scale * sn,
            panY: (st.panY || 0) + dy * scale });
      return;
    }
    // Orbit. Pitch stops short of the poles: straight overhead the up vector is
    // undefined and the picture snaps through a half turn.
    put({ orbit: st.orbit - dx * Math.PI * 2,
          tilt: Math.max(-1.45, Math.min(1.45, st.tilt + dy * Math.PI)) });
  });

  const stop = (e) => {
    if (!from) return;
    from = null;
    canvas.style.cursor = '';
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  // **Framed again.** Every view has an opening camera, and finding your way
  // back to it by hand after a good look round is the one thing an orbit rig
  // makes worse than a fixed one.
  canvas.addEventListener('dblclick', (e) => {
    if (visModuleKey() !== 'stage') return;
    e.preventDefault();
    frameStageView();
  });

  canvas.addEventListener('wheel', (e) => {
    if (visModuleKey() !== 'stage') return;
    e.preventDefault();
    const st = stageSettings();
    // Proportional, so it closes in at the same *rate* wherever it starts. A
    // fixed step crawls when you are far out and jumps through the subject when
    // you are close.
    put({ dist: st.dist * (e.deltaY > 0 ? 1.12 : 1 / 1.12) });
  }, { passive: false });
}

/// Put the camera back where this view opens.
///
/// Each of the ten is a different shape and wants looking at from a different
/// place — a tunnel is looked *down* and a lattice is looked *across*. See
/// `open` in `ST_LAYOUTS`.
function frameStageView() {
  const st = stageSettings();
  const lay = (typeof stLayout === 'function' && st.cloudInk) ? stLayout(st.cloudLayout) : null;
  // **The room is framed differently from the views in it.** A ported view is
  // built around the present and the present is the origin, so it turns around
  // nothing. The stage showing as itself is a room its cloud travels the length
  // of, so it turns around a point partway down that room — which is where the
  // old rig aimed, and without it the camera orbits one end of the cloud and
  // most of it is off screen.
  const open = (lay && lay.open)
    || { orbit: ST_DEFAULTS.orbit, tilt: ST_DEFAULTS.tilt, dist: ST_DEFAULTS.dist };
  const at = lay ? 0 : (st.depth || 9) * 0.3;
  roomEdit.stage = { ...st, ...open, panX: 0, panY: 0, panZ: at };
  saveRoomData();
  const r = visLive.stage;
  if (r && r.configure) r.configure(stageSettings());
  paintStagePanel();
}

/// Whether the card's controls should be on screen.
///
/// **Only in the room workspace, never in the dock.** In the dock a `.room-edit`
/// is `position: absolute; inset: 0` — it covers the whole visual cell, by
/// design, because it *is* the editing overlay. There is only ever meant to be
/// one. Showing a second one there stacks two full-cell panels and you get the
/// card's controls laid over the room's.
///
/// In the admin column they are ordinary blocks in a scrolling list, so any
/// number of them sit happily together. The test of it is not which mode is on
/// but where the panel actually *is*: `roomAdopt` moves it, and where it has
/// been moved to is what decides how it is laid out.
function roomTextPanelOn() {
  if (!ROOM_TEXT_IN_ADMIN) return false;
  const el = $('textEdit');
  return !!(el && roomEdit.on && el.parentElement && el.parentElement.id === 'roomAdminBody');
}

/// The card's own canvas, over whichever module is drawing.
///
/// **A canvas of its own, not the module's.** One of the two modules is WebGL
/// and has no 2D context to set type with, and reaching into the other one's
/// context to draw over it would make the card a feature of the ridgeline rather
/// than of the room. This follows the module's canvas about instead, at the same
/// size and the same pixel ratio.
let roomTextHot = null;
let roomTextDrag = null;

function roomTextCanvas() {
  const host = visCanvas();
  if (!host || !host.parentElement) return null;
  let c = $('roomTextGl');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'roomTextGl';
    c.className = 'rt-canvas';
    wireRoomText(c);
  }
  if (c.parentElement !== host.parentElement) host.parentElement.appendChild(c);
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return null;
  c.style.left = `${host.offsetLeft}px`;
  c.style.top = `${host.offsetTop}px`;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  return c;
}

/// Whether the card is being posed rather than merely shown: the admin panel is
/// open, and the card is on. Only then does it take the pointer, and only then
/// are its grips drawn.
function roomTextPosing() {
  return !!(roomEdit.on && roomTextSettings().on);
}

/// Take the flat card out of the picture without forgetting what it says.
///
/// `display: none` rather than a clear, for the reason in `paintRoomText`: a
/// module that never paints this never clears it either, and a stale card near
/// the frame is a black rectangle over a working picture.
function hideRoomText() {
  const c = $('roomTextGl');
  if (c) c.style.display = 'none';
}

function paintRoomText() {
  const c = roomTextCanvas();
  if (!c) return;
  const st = roomTextSettings();
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  c.classList.toggle('rt-live', roomTextPosing());
  // **Off means gone, not merely cleared.**
  //
  // This canvas sits over the picture at `z-index: 6` and it keeps whatever was
  // last drawn on it. Only some of the modules paint it, so switching to one
  // that does not left the last card hanging over a working picture with
  // nothing to clear it — and a card sized near the frame is a black rectangle,
  // which is indistinguishable from the renderer having died. It cost an
  // evening, twice, on two different modules.
  //
  // Clearing is not enough on its own, because a module that never calls this
  // never clears either. Taken out of the layout altogether, a stale card cannot
  // be shown by anybody.
  c.style.display = st.on ? 'block' : 'none';
  if (!st.on) return;
  // Not while it is being typed into — the textarea is showing the same words a
  // few pixels away and two of them is worse than none.
  if (!$('roomTextInput')) rtDraw(ctx, c.width, c.height, st, roomTextPaint());
  if (roomTextPosing()) rtPaintGrips(ctx, st, c.width, c.height, roomTextHot);
}

/// Moving, resizing, and typing.
function wireRoomText(c) {
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const at = (e) => {
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dpr(), y: (e.clientY - r.top) * dpr() };
  };
  const put = (patch) => {
    roomEdit.text = { ...roomTextSettings(), ...patch };
    saveRoomData();
    paintRoomText();
  };

  c.addEventListener('pointermove', (e) => {
    if (!roomTextPosing()) return;
    if (roomTextDrag) {
      const p = at(e);
      const st = roomTextDrag.start;
      put(rtDrag(st, c.width, c.height, roomTextDrag.grip,
        p.x - roomTextDrag.from.x, p.y - roomTextDrag.from.y));
      return;
    }
    const p = at(e);
    const hit = rtHit(roomTextSettings(), c.width, c.height, p.x, p.y, 10 * dpr());
    if (hit !== roomTextHot) { roomTextHot = hit; paintRoomText(); }
    c.style.cursor = hit ? (RT_CURSOR[hit] || 'default') : 'default';
  });

  c.addEventListener('pointerdown', (e) => {
    if (!roomTextPosing()) return;
    const p = at(e);
    const grip = rtHit(roomTextSettings(), c.width, c.height, p.x, p.y, 10 * dpr());
    if (!grip) return;
    e.preventDefault();
    e.stopPropagation();
    c.setPointerCapture(e.pointerId);
    roomTextDrag = { grip, from: p, start: roomTextSettings() };
  });

  const stop = (e) => {
    if (!roomTextDrag) return;
    roomTextDrag = null;
    try { c.releasePointerCapture(e.pointerId); } catch {}
  };
  c.addEventListener('pointerup', stop);
  c.addEventListener('pointercancel', stop);

  // **Double-click to type**, which is where a text box's words come from.
  c.addEventListener('dblclick', (e) => {
    if (!roomTextPosing()) return;
    const p = at(e);
    if (rtHit(roomTextSettings(), c.width, c.height, p.x, p.y, 10 * dpr()) !== 'move') return;
    e.preventDefault();
    openRoomTextInput(c);
  });
}

/// The textarea, over the card, holding the real words.
function openRoomTextInput(c) {
  if ($('roomTextInput')) return;
  const st = roomTextSettings();
  const box = rtBox(st, c.width, c.height);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const t = document.createElement('textarea');
  t.id = 'roomTextInput';
  t.className = 'rt-input';
  t.value = st.text;
  t.style.left = `${c.offsetLeft + box.x / dpr}px`;
  t.style.top = `${c.offsetTop + box.y / dpr}px`;
  t.style.width = `${box.w / dpr}px`;
  t.style.height = `${box.h / dpr}px`;
  c.parentElement.appendChild(t);
  t.focus();
  t.select();

  const close = (keep) => {
    if (keep) {
      roomEdit.text = { ...roomTextSettings(), text: t.value };
      saveRoomData();
    }
    t.remove();
    paintRoomText();
    paintRoomTextPanel();
  };
  // Enter makes a line, because the card is more than one line of type. Escape
  // abandons, and clicking away keeps — the way every other field here behaves.
  t.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
    e.stopPropagation();
  });
  t.addEventListener('blur', () => close(true));
  paintRoomText();
}

function visGlTick() {
  visGlRaf = requestAnimationFrame(visGlTick);

  // ── the ridgeline ──
  //
  // Its own canvas and its own loop, because the two modules share nothing but
  // the contract. Drawn at the device's pixel ratio like the room, so hairlines
  // stay hair-thin on a retina display instead of being drawn at half density
  // and scaled up.
  if (visModuleKey() === 'stage') {
    const sc = $('visStage');
    if (!sc || sc.offsetParent === null) return;
    const sr = visRenderer();
    if (!sr) return;
    const sw = sc.clientWidth, sh = sc.clientHeight;
    if (!sw || !sh) return;
    const sdpr = Math.min(2, window.devicePixelRatio || 1);
    if (sc.width !== Math.round(sw * sdpr) || sc.height !== Math.round(sh * sdpr)) {
      sc.width = Math.round(sw * sdpr);
      sc.height = Math.round(sh * sdpr);
    }
    // The schedule, so the cloud has something to be. Handed over the same way
    // the room is handed it — see `docs/PORT-PLAN.md`.
    wireStageDrag(sc);
    sr.frame({
      stage: stageSettings(),
      stagePaint: ridgePaint(),
      // **Two copies, because two kinds of view want different things.**
      //
      // The moment views draw a window either side of the playhead and want it
      // as dense as it comes — that is the swarm copy, eight seconds wide and
      // unthinned. The object views draw the *whole* schedule, and handed the
      // window instead they draw eight seconds of a thirty second piece: Shear
      // came out as a clump against the left edge, which reads as a broken
      // projection rather than as three quarters of the file not being there.
      grains: (state.swarm?.grains?.length ? state.swarm : state.grains)?.grains || null,
      schedule: state.grains?.grains || null,
      grainRate: state.grains?.sampleRate || 44100,
      // How long the piece is and how long the source is. The object views lay
      // the *whole* schedule out — Shear states the ratio as a slope, Braid
      // winds the output onto a ring, Shells makes the read position a height —
      // and none of that can be worked out from a list of grains alone.
      outFrames: state.grains?.outFrames || 0,
      srcFrames: state.grains?.srcFrames || 0,
      position: engine.position || 0,
      positionRate: engine.deviceRate || state.grains?.sampleRate || 44100,
    });
    // **Not the flat card. The stage has type of its own.**
    //
    // `roomTextGl` is a 2D canvas at `z-index: 6` laid over the picture, and it
    // was being painted here as well as on every other module — so on the stage
    // the same words were drawn twice, once as geometry standing in the scene
    // and once as a sticker over the frame. The sticker is the one you see: it
    // is on top, it does not occlude and is not occluded, and solo cannot touch
    // it because it is not in the scene at all. Every object here can be
    // switched off and looked at on its own; that one could not, and it is the
    // reason the type never looked like it was in the room.
    //
    // **Never here, not even to pose.** `roomTextPosing()` is only "the room
    // admin is open and the text is switched on", which is true the whole time
    // anyone is in this workspace — so gating on it left the card and its grips
    // drawn exactly as before, dashed rectangle and all. And the grips move the
    // *card's* rectangle, which on this module corresponds to nothing: the words
    // here are geometry, and where they stand is `typeAt`, `typeHigh`,
    // `typeSize`, `typeLean` and `typeSwing`.
    hideRoomText();
    return;
  }

  if (visModuleKey() === 'room3d') {
    const rc = $('visRoom3d');
    if (!rc || rc.offsetParent === null) return;
    const rr = visRenderer();
    if (!rr) return;
    const rw = rc.clientWidth, rh = rc.clientHeight;
    if (!rw || !rh) return;
    const rdpr = Math.min(2, window.devicePixelRatio || 1);
    if (rc.width !== Math.round(rw * rdpr) || rc.height !== Math.round(rh * rdpr)) {
      rc.width = Math.round(rw * rdpr);
      rc.height = Math.round(rh * rdpr);
    }
    rr.frame({ room3d: room3dSettings(), room3dPaint: ridgePaint() });
    // The card, on this module too. Left out, this branch was the one that
    // showed everybody else's leftovers.
    paintRoomText();
    return;
  }

  if (visModuleKey() === 'ridge') {
    const rc = $('visRidge');
    if (!rc || rc.offsetParent === null) return;
    const rr = visRenderer();
    if (!rr) return;
    const rw = rc.clientWidth, rh = rc.clientHeight;
    if (!rw || !rh) return;
    const rdpr = Math.min(2, window.devicePixelRatio || 1);
    if (rc.width !== Math.round(rw * rdpr) || rc.height !== Math.round(rh * rdpr)) {
      rc.width = Math.round(rw * rdpr);
      rc.height = Math.round(rh * rdpr);
    }
    rr.frame({ ridge: ridgeSettings(), ridgePaint: ridgePaint() });
    paintRoomText();
    return;
  }

  const el = $('visGl');
  // A scene nobody is looking at is a full GPU frame for nothing.
  if (!el || el.offsetParent === null) return;

  if (!visGl) {
    visGl = vgAttach(el);
    visLive.room = visGl;
    if (!visGl) {
      // No WebGL. Say so once rather than leave a dead black rectangle.
      const note = $('mbPeakHz');
      if (note) note.textContent = 'no WebGL on this display';
      cancelAnimationFrame(visGlRaf);
      visGlRaf = null;
      return;
    }
  }

  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  // Capped at 2×. Nine times the fill at 3× buys nothing on a glow.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
  }

  visGl.frame({
    cold: vgRgb('--wave-2', '#4a9fd8'),
    hot: vgRgb('--wave', '#5fd47a'),
    core: vgRgb('--accent', '#7fd0ff'),
    // The palette. Null while nothing has been said about colour, and the
    // three above are then the whole of it — which is the room as it shipped.
    paint: rpForRenderer(),
    geom: roomGeom(),
    cam: roomCameraDrawn(),
    layers: roomLayers(),
    occlude: roomOcclude(),
    order: roomOrder(),
    grainDensity: roomEdit.grainDensity,
    grainBright: roomEdit.grainBright,
    ringDrive: roomEdit.ringDrive,
    ringEdge: roomEdit.ringEdge,
    leadThick: roomEdit.leadThick,
    ringPoints: roomEdit.ringPoints,
    // **The live room and the film are two frame calls, not one.** A setting
    // added to only one of them is a control that works on screen and not in
    // the export, or the reverse — which is the fault this program has already
    // shipped once, over the background colour.
    solidShape: roomEdit.solidShape,
    solidSpin: roomEdit.solidSpin,
    solidSwell: roomEdit.solidSwell,
    solidEye: roomEdit.solidEye,
    solidSize: roomEdit.solidSize,
    solidPath: roomEdit.solidPath,
    grainFill: {
      on: roomEdit.grainFill,
      bg: roomEdit.grainFillBg,
      rgb: vgHexRgb(roomEdit.grainFillColour),
    },
    mist: {
      on: roomEdit.mist,
      amount: roomEdit.mistAmount,
      length: roomEdit.mistLength,
    },
    fog: roomFog(),
    // The schedule itself, so the room draws the grains that exist rather than
    // a model of how many there ought to be.
    //
    // **The swarm's window first, and the view's only as a fallback.**
    //
    // `state.grains` covers the *visible waveform*, which has nothing to do
    // with where the playhead is: press play without follow on and the head
    // walks straight out of the fetched range, so the room empties, and it
    // fills again when something scrolls the view and triggers a refetch. That
    // reads as the picture looping — blanking at the end and starting over —
    // and it is really the room being handed a schedule for somewhere else.
    //
    // `state.swarm` is the same schedule fetched *around the playhead*, which
    // is the window this room is built on: depth is time from now, so the
    // grains it wants are the ones near now. It is null whenever the view's
    // range already covers the playhead densely enough, and then the view's own
    // copy is the right answer anyway.
    grains: (state.swarm?.grains?.length ? state.swarm : state.grains)?.grains || null,
    grainRate: (state.swarm?.grains?.length ? state.swarm : state.grains)?.sampleRate || 44100,
    srcFrames: (state.swarm?.grains?.length ? state.swarm : state.grains)?.srcFrames || 0,
    position: engine.position || 0,
    // The playhead counts in engine frames at the *device* rate; the schedule
    // counts in output frames at the document's. A file at 44.1k on a device at
    // 48k would drift apart steadily if both were divided by the same number.
    positionRate: engine.deviceRate || state.grains?.sampleRate || 44100,
    pollMs: MB_POLL_MS,
  });
  // In front of the room, as it is in front of the ridgeline.
  paintRoomText();
}

function startVisGl() {
  if (visGlRaf) return;
  visGlRaf = requestAnimationFrame(visGlTick);
}

// **Show the module that was chosen, before the first frame.**
//
// The choice is remembered and the canvases are not: `visRidge` carries
// `hidden` in the markup and only `visCanvas` takes it off, and `visCanvas` was
// only ever reached through `setVisModule` — which nothing calls on the way in.
// So a session that had last used the ridgeline came back to a tick that read
// the module as `ridge`, found that canvas `display: none`, and returned. Every
// frame. For ever.
//
// Nothing drew, and the panel was black until the room view was opened, because
// opening it calls `setVisModule` and that is what finally revealed the canvas.
// The renderer was never broken and neither was the module: it was simply never
// shown, and the only thing that showed it was somewhere you had to go first.
visCanvas();
startVisGl();

