// ──────────────────────── the camera, the way every 3D program has it ──
//
// An eye, a pivot it looks at, and the gestures Maya, Blender, Unity and
// Unreal share: **orbit** (tumble) around the pivot, **track** (pan) across
// the view, **dolly** (zoom) toward it, and **look** (fly) from where you
// stand. The record stays the eye's place and direction; `focus` is how far
// ahead the pivot sits, kept once a gesture has set it, and until then the
// ring's distance along the look, since the ring is what the room is about.

const CAM_PITCH_MAX = 89;
/// Degrees per pixel of drag: orbit, and looking around.
const CAM_ORBIT_DEG = 0.4;
const CAM_LOOK_DEG = 0.25;
const camWrap = (deg) => ((deg % 360) + 540) % 360 - 180;
const camClampPitch = (deg) => Math.max(-CAM_PITCH_MAX, Math.min(CAM_PITCH_MAX, deg));

/// The way the eye looks, as a unit vector.
function camDir(c) {
  const p = c.pitch / VG_DEG, y = c.yaw / VG_DEG;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}
/// Its right hand, level.
function camRight(c) {
  const y = c.yaw / VG_DEG;
  return [Math.cos(y), 0, Math.sin(y)];
}
/// Its up, at right angles to both.
function camUp(c) {
  const d = camDir(c), r = camRight(c);
  return [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
}
/// How far ahead the pivot is.
function camFocus(c) {
  if (Number.isFinite(c.focus) && c.focus > 0) return c.focus;
  const d = camDir(c), r = c.ring || VG_WORLD_DEFAULT.ring;
  const f = (r.x - c.x) * d[0] + (r.y - c.height) * d[1] + (r.z - c.z) * d[2];
  return Math.max(0.2, f);
}
/// Where the pivot is.
function camPivot(c) {
  const d = camDir(c), f = camFocus(c);
  return [c.x + d[0] * f, c.height + d[1] * f, c.z + d[2] * f];
}
/// The eye placed `f` back from `pivot` along the way it already looks.
function camLookFrom(c, pivot, f) {
  const d = camDir(c);
  c.x = pivot[0] - d[0] * f;
  c.height = pivot[1] - d[1] * f;
  c.z = pivot[2] - d[2] * f;
  c.focus = f;
  return c;
}
/// Orbit: turn about the pivot, staying the same distance from it.
function camOrbit(c, dyaw, dpitch) {
  const p = camPivot(c), f = camFocus(c);
  c.yaw = camWrap(c.yaw + dyaw);
  c.pitch = camClampPitch(c.pitch + dpitch);
  return camLookFrom(c, p, f);
}
/// Dolly: toward the pivot (k < 1) or away from it, keeping it where it is.
function camDolly(c, k) {
  const p = camPivot(c);
  return camLookFrom(c, p, Math.max(0.05, camFocus(c) * k));
}
/// Track: slide across the view. `dxPx`, `dyPx` are the hand's travel in
/// pixels, and the world at the pivot's distance keeps pace with the hand.
function camTrack(c, dxPx, dyPx, h) {
  const s = 2 * camFocus(c) * Math.tan(c.fov / 2 / VG_DEG) / Math.max(1, h);
  const r = camRight(c), u = camUp(c);
  c.focus = camFocus(c);
  c.x += (-r[0] * dxPx + u[0] * dyPx) * s;
  c.height += (-r[1] * dxPx + u[1] * dyPx) * s;
  c.z += (-r[2] * dxPx + u[2] * dyPx) * s;
  return c;
}
/// Look: turn in place, as a first-person camera does.
function camLook(c, dyaw, dpitch) {
  c.focus = camFocus(c);
  c.yaw = camWrap(c.yaw + dyaw);
  c.pitch = camClampPitch(c.pitch + dpitch);
  return c;
}
/// Fly: step forward, sideways and up from where you stand.
function camFly(c, fwd, side, up) {
  const d = camDir(c), r = camRight(c);
  c.focus = camFocus(c);
  c.x += d[0] * fwd + r[0] * side;
  c.height += d[1] * fwd + r[1] * side + up;
  c.z += d[2] * fwd + r[2] * side;
  return c;
}
/// Aim: turn from where the eye stands to look at `p`, and make it the pivot.
function camAim(c, p) {
  const dx = p[0] - c.x, dy = p[1] - c.height, dz = p[2] - c.z;
  const f = Math.hypot(dx, dy, dz);
  if (f < 1e-6) return c;
  c.yaw = Math.atan2(dx, -dz) * VG_DEG;
  c.pitch = camClampPitch(Math.asin(dy / f) * VG_DEG);
  c.focus = f;
  return c;
}
/// A set view — front, side, top — of the same pivot from the same distance.
function camView(c, which) {
  const p = camPivot(c), f = camFocus(c);
  if (which === 'front') { c.yaw = 0; c.pitch = 0; }
  else if (which === 'side') { c.yaw = 90; c.pitch = 0; }
  else if (which === 'top') { c.yaw = 0; c.pitch = -CAM_PITCH_MAX; }
  return camLookFrom(c, p, f);
}

/// Frame: put `p` at the pivot, `size` across, without turning.
function roomFrameOn(p, size) {
  const c = roomWorldNow();
  const f = Math.max(0.3, (size || 0.2) * 2.5 / Math.tan(c.fov / 2 / VG_DEG));
  camLookFrom(c, p, f);
  roomSetWorld(c);
  paintRoomNums();
  saveRoomCameras();
}

/// The camera being edited, filled in, so a drag has something to add to even
/// on a frame nobody has touched.
function roomCamNow() {
  // As the box it draws, whatever shape it is kept in. See `roomWorldNow`.
  return { ...ROOM_CAM_DEFAULT, ...(vgBoxOf(roomEdit.cams[roomEdit.frame]) || {}) };
}

function roomFrame() {
  return ROOM_FRAMES.find((f) => f.key === roomEdit.frame) || ROOM_FRAMES[0];
}

/// Letterbox the room into the shape being designed for.
///
/// Width from height, so the box keeps the panel's height and gives back the
/// width it does not need. A tall frame inside a wide dock is a tall strip in
/// the middle of it — which is exactly what it will be in the file, which is
/// the whole reason for looking at it this way rather than imagining it.
function applyRoomFrame() {
  const cell = document.querySelector('#masterBus .mb-cell-3d');
  if (!cell) return;
  const f = roomFrame();
  // **The frame is honoured whether or not the controls are open.**
  //
  // It used to need `roomEdit.on`, so closing the panel snapped the room back
  // to the dock's own shape and threw away the frame you had chosen — which
  // reads as the setting not sticking. The frame is a decision about the
  // picture, not a state of the editing session; `Dock` is the setting that
  // means "whatever shape the panel is".
  const framed = f.ratio > 0;
  cell.classList.toggle('re-framed', framed);
  cell.style.aspectRatio = framed ? String(f.ratio) : '';
  // The ratio as a bare number as well, for the full view's fit. `aspect-ratio`
  // on its own does not letterbox inside a flex parent — the flex sizing wins
  // in one direction and the box overflows in the other — so the stage works
  // the width out itself against the height it actually has. See `.rv-room`.
  cell.style.setProperty('--rv-ratio', framed ? String(f.ratio) : '');
  // ── a portrait room puts its controls beside it ──
  //
  // The panel is `inset: 0` over the room, which is right when the room is the
  // whole cell. Letterboxed to 9:16 in a wide dock the room is a narrow column
  // and the panel is inside *that* — a 300px control stack in a 200px box.
  //
  // There is empty cell either side of a portrait room and nothing in it, so
  // the controls go there. Landscape frames letterbox into thin bars top and
  // bottom, which no control would fit in, so those keep the overlay.
  //
  // Only while the panel is the dock's: in the Room workspace it has been moved
  // into the admin column already and is not this element's business.
  const main = cell.parentElement;
  const panel = $('roomEdit');
  const mine = panel && (panel.parentElement === cell || panel.parentElement === main);
  if (main && mine) {
    const beside = framed && f.ratio < 1;
    main.classList.toggle('re-beside', beside);
    if (beside && panel.parentElement !== main) main.insertBefore(panel, cell);
    else if (!beside && panel.parentElement !== cell) cell.appendChild(panel);
  }

  // The cell has just changed shape, so every projected point has moved.
  afterLayout(() => { paintRoomHandles(); paintSolidPath(); });
}

function paintRoomNums() {
  // The grips sit on the room, so anything that moves the room moves them.
  // Called from here rather than from the draw loop: the camera only changes
  // when something edits it, and writing seven elements' styles sixty times a
  // second to say nothing would be the same waste as redrawing a still scene.
  paintRoomHandles();
  // The beads and the gizmo sit on the things they move, which sit in the
  // world, which the camera looks at — so a camera move repaints them too.
  // Without this they stayed where the old view put them until a bead was
  // next dragged.
  paintRoomBeads();
  const el = $('reNums');
  if (!el) return;
  // The world camera: where you stand and which way you look. The box it
  // draws is derived; what is printed, and what is copied, is the thing that
  // is kept.
  const w = roomWorldNow();
  const n = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
  el.textContent =
    `height ${n(w.height)}  pitch ${n(w.pitch)}°  yaw ${n(w.yaw)}°  `
    + `fov ${n(w.fov)}°  focus ${n(camFocus(w))}  at ${n(w.x)},${n(w.z)}  ring ${n(w.ring.x)},${n(w.ring.y)},${n(w.ring.z)}/${n(w.ring.size)}`;
  el.dataset.copy = JSON.stringify({
    v: 2, x: +n(w.x), z: +n(w.z), height: +n(w.height), pitch: +n(w.pitch), yaw: +n(w.yaw), focus: +n(camFocus(w)),
    fov: +n(w.fov), aspect: +n(w.aspect),
    ring: { x: +n(w.ring.x), y: +n(w.ring.y), z: +n(w.ring.z), size: +n(w.ring.size) },
  });
  syncCamRows();
  for (const b of document.querySelectorAll('#reFrames .re-btn')) {
    b.classList.toggle('active', b.dataset.frame === roomEdit.frame);
  }
  for (const b of document.querySelectorAll('#reLayers .re-layer-name')) {
    b.classList.toggle('active', roomLayerOn(b.dataset.layer));
  }
  // The solid's rows follow its layer in the dock's overlay; see `.re-solid`.
  $('roomEdit')?.classList.toggle('re-solid-off', !roomLayerOn('solid'));
  const fillBgBtn = $('reGrainFillBg');
  if (fillBgBtn) fillBgBtn.classList.toggle('active', !!roomEdit.grainFillBg);
  const fillBox = $('reGrainFill');
  if (fillBox) fillBox.checked = !!roomEdit.grainFill;
  const thickBox = $('reLeadThick');
  if (thickBox) thickBox.checked = !!roomEdit.leadThick;
  const mistBox = $('reMist');
  if (mistBox) mistBox.checked = !!roomEdit.mist;
  const fogBox = $('reFog');
  if (fogBox) fogBox.checked = !!roomEdit.fog;
  for (const b of document.querySelectorAll('#reLayers .re-occ')) {
    b.classList.toggle('active', roomOccludeOn(b.dataset.occlude));
  }
  for (const b of document.querySelectorAll('#reStreams .re-btn')) {
    b.classList.toggle('active', roomStreamOn(b.dataset.stream));
    b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  }
  for (const b of document.querySelectorAll('#reChunks .re-btn')) {
    b.classList.toggle('active', +b.dataset.chunk === roomEdit.chunk);
    b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  }
}

/// The layer stack: one row each, highest at the top.
///
/// Stacked rather than laid in a line because the list *is* the hierarchy — the
/// order decides who is drawn first and therefore who is seen — and a hierarchy
/// read left to right is a hierarchy nobody reads. Top to bottom is how every
/// other stack of layers is written down.
///
/// Rebuilt whenever the order changes, unlike the other chip rows, which are
/// built once and only ever have their `active` class flipped.
function buildRoomLayers() {
  const box = $('reLayers');
  if (!box) return;
  box.innerHTML = '';
  // The drawn layers in hierarchy order, then the ones that are not in the
  // room at all. Listing only `roomOrder()` dropped the Data block off the
  // stack entirely — it is still a layer you turn on and off, it just has no
  // place in an order it is not part of.
  const listed = [
    ...roomOrder(),
    ...ROOM_LAYERS.filter((l) => l.gl === false).map((l) => l.key),
  ];
  for (const key of listed) {
    const l = ROOM_LAYERS.find((x) => x.key === key);
    if (!l) continue;
    const drawn = l.gl !== false;
    const row = document.createElement('div');
    row.className = drawn ? 're-layer' : 're-layer re-layer-off-stage';
    row.dataset.layer = l.key;
    row.draggable = drawn;

    // The grip is the whole row, but only this says so. Nothing to grip on a
    // layer that is not in the room's draw order.
    const grip = document.createElement('span');
    grip.className = 're-grip';
    grip.textContent = drawn ? '⠿' : '';
    if (drawn) {
      grip.title = 'Drag to move this layer up or down the hierarchy. Higher is '
        + 'drawn first, so with occlusion on it is the one you see. Everything '
        + 'here is drawn additively, so until something occludes, the order '
        + 'makes no difference at all.';
    }
    row.appendChild(grip);

    const b = document.createElement('button');
    b.className = 're-btn re-layer-name';
    b.dataset.layer = l.key;
    b.textContent = l.label;
    b.title = l.hint;
    b.onclick = () => {
      roomEdit.layers[l.key] = !roomLayerOn(l.key);
      saveRoomLayers();
      paintRoomNums();
      paintRoomData();
    };
    // Which part of the room it is, lit in a small room (`control-pictures.js`).
    if (typeof cpLayer === 'function') cpLayer(b, l.key);
    row.appendChild(b);

    // Its own switch, per layer, because "does this hide things" is a different
    // question from "is this drawn" and the answer differs by layer: a terrain
    // that masks the sky is a landscape, and a wireframe box that masks
    // everything inside it is an empty box.
    //
    // Only for the layers the renderer draws. The Data block is type printed on
    // the back wall rather than geometry in the scene, so it has nothing to
    // occlude with and nothing to be occluded by — and a switch that does
    // nothing is worse than a missing one.
    if (drawn) {
      const o = document.createElement('button');
      o.className = 're-btn re-occ';
      o.dataset.occlude = l.key;
      o.textContent = '◑';
      o.title = `Occlusion for ${l.label}: stand in the way of every layer below `
        + 'this one, instead of adding light to it. It masks with the geometry it '
        + 'actually has, so a surface hides a great deal and a few wireframe '
        + 'lines hide very little.';
      o.onclick = () => {
        roomEdit.occlude[l.key] = !roomOccludeOn(l.key);
        saveRoomHierarchy();
        buildRoomLayers();
      };
      row.appendChild(o);
    }
    box.appendChild(row);
  }
  // Said out loud rather than left to be discovered: with nothing occluding,
  // dragging these around changes nothing, because additive blending does not
  // care what order it happens in.
  const live = roomHierarchyLive();
  box.classList.toggle('re-flat', !live);
  const tag = box.parentElement?.querySelector('.re-tag');
  if (tag) {
    tag.title = live
      ? 'Highest first. A layer with occlusion on is drawn before the ones below '
        + 'it, so it is the one you see where they meet.'
      : 'Nothing is occluding, so this order does nothing yet — the room is drawn '
        + 'additively and addition does not care what order it happens in. Turn '
        + 'on occlusion for a layer and its place in this list starts to matter.';
  }
  wireRoomLayerDrag(box);
  paintRoomNums();
}

/// Dragging a layer up or down the stack.
///
/// The native drag events rather than pointer maths, because the room's own
/// pointer handling is a camera drag and the two would fight over the same
/// gestures. This is a list being reordered, which is what these events are
/// for.
function wireRoomLayerDrag(box) {
  let from = null;
  box.ondragstart = (e) => {
    const row = e.target.closest?.('.re-layer');
    if (!row) return;
    from = row.dataset.layer;
    row.classList.add('re-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox will not start a drag without something on the transfer.
    try { e.dataTransfer.setData('text/plain', from); } catch {}
  };
  box.ondragend = () => {
    from = null;
    for (const r of box.querySelectorAll('.re-layer')) {
      r.classList.remove('re-dragging', 're-over');
    }
  };
  box.ondragover = (e) => {
    if (!from) return;
    e.preventDefault();
    const row = e.target.closest?.('.re-layer');
    for (const r of box.querySelectorAll('.re-layer')) r.classList.toggle('re-over', r === row);
  };
  box.ondrop = (e) => {
    if (!from) return;
    e.preventDefault();
    const row = e.target.closest?.('.re-layer');
    if (!row || row.dataset.layer === from) return;
    const order = roomOrder().filter((k) => k !== from);
    order.splice(order.indexOf(row.dataset.layer), 0, from);
    roomEdit.order = order;
    saveRoomHierarchy();
    buildRoomLayers();
  };
}

function buildRoomChunks() {
  const box = $('reChunks');
  if (!box || box.children.length) return;
  for (const n of ROOM_CHUNKS) {
    const b = document.createElement('button');
    b.className = 're-btn';
    b.dataset.chunk = String(n);
    b.textContent = String(n);
    b.title = `Rows travel in blocks of ${n}, every other block running the other way.`;
    b.onclick = () => { roomEdit.chunk = n; saveRoomData(); paintRoomNums(); paintRoomData(); };
    box.appendChild(b);
  }
  const ring = $('reRing');
  if (ring) {
    ring.value = String(Math.round(roomEdit.ringScale * 100));
    ring.oninput = () => {
      roomEdit.ringScale = Math.max(0.15, Math.min(3, ring.value / 100));
      paintRoomNums();
    };
    ring.onchange = saveRoomData;
  }
  const edge = $('reRingEdge');
  if (edge) {
    edge.value = String(Math.round(roomEdit.ringEdge * 1000));
    edge.oninput = () => {
      roomEdit.ringEdge = Math.max(0, Math.min(0.25, edge.value / 1000));
    };
    edge.onchange = saveRoomData;
  }
  const pts = $('reRingPoints');
  if (pts) {
    pts.value = String(Math.round(roomEdit.ringPoints));
    pts.oninput = () => {
      roomEdit.ringPoints = Math.max(48, Math.min(2048, Math.round(pts.value)));
    };
    pts.onchange = saveRoomData;
  }
  const thick = $('reLeadThick');
  if (thick) {
    thick.checked = !!roomEdit.leadThick;
    thick.onchange = () => {
      roomEdit.leadThick = thick.checked;
      saveRoomData();
      paintRoomNums();
    };
  }
  const fog = $('reFog');
  if (fog) {
    fog.checked = !!roomEdit.fog;
    fog.onchange = () => { roomEdit.fog = fog.checked; saveRoomData(); paintRoomNums(); };
  }
  const fogType = $('reFogType');
  if (fogType) {
    fogType.value = String(roomEdit.fogType);
    fogType.onchange = () => {
      roomEdit.fogType = Math.max(0, Math.min(3, +fogType.value | 0));
      saveRoomData();
    };
  }
  const fogDen = $('reFogDensity');
  if (fogDen) {
    fogDen.value = String(Math.round(roomEdit.fogDensity * 100));
    fogDen.oninput = () => {
      roomEdit.fogDensity = Math.max(0, Math.min(2, fogDen.value / 100));
    };
    fogDen.onchange = saveRoomData;
  }
  const fogCol = $('reFogColour');
  if (fogCol) {
    fogCol.value = roomEdit.fogColour;
    fogCol.oninput = () => { roomEdit.fogColour = fogCol.value; };
    fogCol.onchange = saveRoomData;
  }
  const mist = $('reMist');
  if (mist) {
    mist.checked = !!roomEdit.mist;
    mist.onchange = () => {
      roomEdit.mist = mist.checked;
      saveRoomData();
      paintRoomNums();
    };
  }
  const mistAmt = $('reMistAmount');
  if (mistAmt) {
    mistAmt.value = String(Math.round(roomEdit.mistAmount * 100));
    mistAmt.oninput = () => {
      roomEdit.mistAmount = Math.max(0.06, Math.min(1, mistAmt.value / 100));
    };
    mistAmt.onchange = saveRoomData;
  }
  const mistLen = $('reMistLength');
  if (mistLen) {
    mistLen.value = String(Math.round(roomEdit.mistLength * 1000));
    mistLen.oninput = () => {
      roomEdit.mistLength = Math.max(0.004, Math.min(0.6, mistLen.value / 1000));
    };
    mistLen.onchange = saveRoomData;
  }
  const fill = $('reGrainFill');
  if (fill) {
    fill.checked = !!roomEdit.grainFill;
    fill.onchange = () => {
      roomEdit.grainFill = fill.checked;
      saveRoomData();
      paintRoomNums();
    };
  }
  const fillBg = $('reGrainFillBg');
  if (fillBg) {
    fillBg.onclick = () => {
      roomEdit.grainFillBg = !roomEdit.grainFillBg;
      saveRoomData();
      paintRoomNums();
    };
  }
  const fillCol = $('reGrainFillColour');
  if (fillCol) {
    fillCol.value = roomEdit.grainFillColour;
    fillCol.oninput = () => {
      roomEdit.grainFillColour = fillCol.value;
      // Picking a colour is asking for that colour, so it stops filling with
      // the background — otherwise the swatch would sit there doing nothing.
      roomEdit.grainFillBg = false;
      paintRoomNums();
    };
    fillCol.onchange = saveRoomData;
  }
  const drive = $('reRingDrive');
  if (drive) {
    drive.value = String(Math.round(roomEdit.ringDrive * 100));
    drive.oninput = () => {
      roomEdit.ringDrive = Math.max(0, Math.min(8, drive.value / 100));
    };
    drive.onchange = saveRoomData;
  }
  // The solid's own four.
  // Both catalogues, grouped, because they are two kinds of thing: eight solids
  // that need four dimensions to hold them, and thirty-four that do not. The
  // grain shapes are already drawn in this room at eight pixels; there is no
  // reason a dodecahedron should not also be available at four hundred.
  const sShape = $('reSolidShape');
  if (sShape) {
    if (!sShape.options.length) {
      const group = (label, entries) => {
        if (!entries.length) return;
        const g = document.createElement('optgroup');
        g.label = label;
        for (const e of entries) {
          const o = document.createElement('option');
          o.value = e.value;
          o.textContent = e.label;
          if (e.hint) o.title = e.hint;
          g.appendChild(o);
        }
        sShape.appendChild(g);
      };
      group('Four dimensions and more', typeof Shapes4D !== 'undefined'
        ? Shapes4D.CATALOGUE.map((e) => ({ value: e.key, label: e.label, hint: e.hint }))
        : []);
      group('Grain shapes', typeof GRAIN_SHAPES !== 'undefined'
        ? GRAIN_SHAPES.map((m) => ({
          value: m.name,
          label: m.name.replace(/^./, (c) => c.toUpperCase()),
          hint: `${m.verts} vertices · ${m.lines} edges — lifted into four dimensions as a prism, two copies joined vertex to vertex, so it turns inside out like the rest`,
        }))
        : []);
    }
    sShape.value = roomEdit.solidShape;
    sShape.onchange = () => { roomEdit.solidShape = sShape.value; saveRoomData(); };
  }
  const sSpin = $('reSolidSpin');
  if (sSpin) {
    sSpin.value = String(Math.round(roomEdit.solidSpin * 100));
    sSpin.oninput = () => { roomEdit.solidSpin = Math.max(0, Math.min(8, sSpin.value / 100)); };
    sSpin.onchange = saveRoomData;
  }
  const sSwell = $('reSolidSwell');
  if (sSwell) {
    sSwell.value = String(Math.round(roomEdit.solidSwell * 100));
    sSwell.oninput = () => { roomEdit.solidSwell = Math.max(0, Math.min(2, sSwell.value / 100)); };
    sSwell.onchange = saveRoomData;
  }
  const sEye = $('reSolidEye');
  if (sEye) {
    sEye.value = String(Math.round(roomEdit.solidEye * 100));
    sEye.oninput = () => { roomEdit.solidEye = Math.max(1.4, Math.min(8, sEye.value / 100)); };
    sEye.onchange = saveRoomData;
  }
  const sSize = $('reSolidSize');
  if (sSize) {
    sSize.value = String(Math.round(roomEdit.solidSize * 100));
    sSize.oninput = () => { roomEdit.solidSize = Math.max(0.04, Math.min(0.9, sSize.value / 100)); };
    sSize.onchange = saveRoomData;
  }
  const addWp = $('reSolidPathAdd');
  if (addWp) {
    addWp.onclick = () => {
      // Halfway along, between the two points it lands between — so a new
      // waypoint changes nothing until it is moved, which is what makes adding
      // one safe to do while watching.
      const p = roomEdit.solidPath;
      const i = Math.max(1, Math.floor(p.length / 2));
      const a = p[i - 1], b = p[i];
      p.splice(i, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
      saveRoomData();
      solidPathPanel();
      // The overlay is where the path actually is, so it has to hear about a
      // point appearing — a new waypoint with no handle is one you cannot move.
      paintSolidPath();
    };
  }
  const resetWp = $('reSolidPathReset');
  if (resetWp) {
    resetWp.onclick = () => {
      roomEdit.solidPath = [{ x: 0, y: 0.42, z: roomEdit.geomAt.z - 0.08 * roomEdit.geomReach },
        { x: 0, y: 0.42, z: roomEdit.geomAt.z - roomEdit.geomReach }];
      saveRoomData();
      solidPathPanel();
      paintSolidPath();
    };
  }
  const dens = $('reGrainDensity');
  if (dens) {
    dens.value = String(Math.round(roomEdit.grainDensity * 100));
    dens.oninput = () => {
      roomEdit.grainDensity = Math.max(0.04, Math.min(1, dens.value / 100));
    };
    dens.onchange = saveRoomData;
  }
  const bright = $('reGrainBright');
  if (bright) {
    bright.value = String(Math.round(roomEdit.grainBright * 100));
    bright.oninput = () => {
      roomEdit.grainBright = Math.max(0.15, Math.min(3, bright.value / 100));
    };
    bright.onchange = saveRoomData;
  }
  const slider = $('reOpacity');
  if (slider) {
    slider.value = String(Math.round(roomEdit.opacity * 100));
    slider.oninput = () => {
      roomEdit.opacity = Math.max(0.05, Math.min(1, slider.value / 100));
      paintRoomData();
    };
    slider.onchange = saveRoomData;
  }
  // The camera's channel box. Each attribute writes the world camera and
  // repaints; the fields are kept in step by `syncCamRows`.
  for (const [id, read, apply, step, digits] of ROOM_CAM_CHANNELS) {
    const el = $(id);
    if (!el) continue;
    wireChannel(el, {
      get: () => read(roomWorldNow()),
      set: (v) => { const c = roomWorldNow(); apply(c, v); roomSetWorld(c); paintRoomNums(); },
      step, digits, save: saveRoomCameras,
    });
  }
  // The picked point's channels.
  for (const [id, axis] of [['reObjTx', 'x'], ['reObjTy', 'y'], ['reObjTz', 'z']]) {
    const el = $(id);
    if (!el) continue;
    wireChannel(el, {
      get: () => { const b = roomPicked(); return b ? +b.get()[axis] || 0 : 0; },
      set: (v) => { const b = roomPicked(); if (!b) return; b.set({ [axis]: v }); paintRoomBeads(); paintRoomNums(); },
      step: 0.01, digits: 3,
      save: () => { const b = roomPicked(); if (b && b.save) b.save(); },
    });
  }
  // The set views, and framing what is picked.
  for (const [id, which] of [['reCamFront', 'front'], ['reCamSide', 'side'], ['reCamTop', 'top']]) {
    const b = $(id);
    if (b) b.onclick = () => { roomSetWorld(camView(roomWorldNow(), which)); paintRoomNums(); saveRoomCameras(); };
  }
  const fr = $('reCamFrame');
  if (fr) fr.onclick = roomFramePick;
  syncCamRows();
}

/// The camera's channel box, as Maya has it: Translate, Rotate, Focal
/// Length and Center of Interest. Element, what it reads from the camera,
/// what typing a value does to the camera, the step a pixel of scrub or an
/// arrow key is, and the places shown.
///
/// Translate carries the pivot with the eye, as moving a camera does.
/// Rotate turns in place. Focal length is the 35 mm equivalent — 24 mm is
/// the default lens here — and the center of interest is the pivot's
/// distance, so typing it is a dolly.
const ROOM_CAM_CHANNELS = [
  ['reCamTx', (c) => c.x, (c, v) => { c.focus = camFocus(c); c.x = v; }, 0.01, 3],
  ['reCamTy', (c) => c.height, (c, v) => { c.focus = camFocus(c); c.height = v; }, 0.01, 3],
  ['reCamTz', (c) => c.z, (c, v) => { c.focus = camFocus(c); c.z = v; }, 0.01, 3],
  ['reCamRx', (c) => c.pitch, (c, v) => camLook(c, 0, camClampPitch(v) - c.pitch), 0.5, 1],
  ['reCamRy', (c) => c.yaw, (c, v) => camLook(c, camWrap(v) - c.yaw, 0), 0.5, 1],
  ['reCamFocal', (c) => 12 / Math.tan(c.fov / 2 / VG_DEG),
    (c, v) => { c.fov = 2 * Math.atan(12 / Math.max(4, Math.min(600, v))) * VG_DEG; }, 0.25, 1],
  ['reCamCoi', camFocus, (c, v) => camDolly(c, Math.max(0.05, v) / camFocus(c)), 0.01, 3],
];

/// A channel: a number typed, stepped with the arrows, or scrubbed by
/// dragging across it — the field is its own slider, as in Maya and
/// Blender. A press that does not travel is a click, and focuses it to type;
/// one that travels scrubs, and never focuses.
function wireChannel(el, { get, set, step, digits, save }) {
  const show = () => { el.value = (+get() || 0).toFixed(digits); };
  el.show = show;
  el.onfocus = () => el.select();
  el.onchange = () => {
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) { set(v); save(); }
    show();
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter') { el.blur(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    set(get() + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
    show();
    save();
  };
  el.onpointerdown = (e) => {
    if (e.button !== 0 || document.activeElement === el) return;
    const x0 = e.clientX, v0 = get();
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) {
        moved = true;
        el.blur();
        el.classList.add('scrubbing');
        try { el.setPointerCapture(e.pointerId); } catch { /* the guard below */ }
      }
      if (ev.buttons === 0) { up(ev); return; }
      set(v0 + dx * step * (ev.shiftKey ? 10 : 1));
      show();
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!moved) return;
      el.classList.remove('scrubbing');
      try { el.releasePointerCapture(ev.pointerId); } catch { /* gone */ }
      save();
      el.blur();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  show();
}

function syncCamRows() {
  for (const [id] of ROOM_CAM_CHANNELS) {
    const el = $(id);
    if (el && el.show && document.activeElement !== el) el.show();
  }
  // The camera pads, which read the same camera (`rkBuild`).
  if (typeof rkPadsSync === 'function') rkPadsSync();
  // The picked point's row: shown while something is picked, named for it.
  const row = $('reObjRow');
  if (row) {
    const b = roomPicked();
    row.classList.toggle('hidden', !b);
    if (b) {
      $('reObjTag').textContent = (b.label || 'point').toUpperCase();
      $('reObjRowY')?.classList.toggle('hidden', !!b.floorOnly);
      for (const id of ['reObjTx', 'reObjTy', 'reObjTz']) {
        const el = $(id);
        if (el && el.show && document.activeElement !== el) el.show();
      }
    }
  }
}

function buildRoomFrames() {
  const box = $('reFrames');
  if (!box || box.children.length) return;
  for (const f of ROOM_FRAMES) {
    const b = document.createElement('button');
    b.className = 're-btn';
    b.dataset.frame = f.key;
    b.textContent = f.label;
    b.title = f.ratio > 0
      ? `Pose the room for a ${f.label} frame. Its camera is kept separately.`
      : "The dock's own shape.";
    b.onclick = () => {
      roomEdit.frame = f.key;
      applyRoomFrame();
      paintRoomNums();
    };
    box.appendChild(b);
  }
}

function toggleRoomEdit() {
  roomEdit.on = !roomEdit.on;
  buildRoomLayers();
  buildRoomStreams();
  buildRoomChunks();
  buildRoomFrames();
  $('masterBus')?.classList.toggle('room-editing', roomEdit.on);
  $('roomEdit')?.classList.toggle('hidden', visModuleKey() !== 'room' || !roomEdit.on);
  $('ridgeEdit')?.classList.toggle('hidden', visModuleKey() !== 'ridge' || !roomEdit.on);
  $('room3dEdit')?.classList.toggle('hidden', visModuleKey() !== 'room3d' || !roomEdit.on);
  $('stageEdit')?.classList.toggle('hidden', visModuleKey() !== 'stage' || !roomEdit.on);
  $('textEdit')?.classList.toggle('hidden', !roomTextPanelOn());
  $('roomEditOpen')?.classList.toggle('on', roomEdit.on);
  applyRoomFrame();
  paintRoomNums();
  // Straight away, rather than on the next meter poll — which does not come at
  // all when nothing is playing, so opening the editor on a stopped transport
  // showed an empty corner.
  paintRoomData();
}

