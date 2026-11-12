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
    const name = rpEl('span', 're-tag', tag);
    row.appendChild(name);
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
    uiBarOver(row, { input: sl, name, read, h: 20 });
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

