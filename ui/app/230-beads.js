// ───────────────────────────────────────────────── the beads: everything moves ──
//
// Everything with a place in the world is dragged where it is, by the same
// two beads: one in the air, for across and up, and one on the ground beneath
// it, for across and along. A pointer is two numbers and the world is three,
// so something has to supply the third; the two beads are the two planes,
// and neither needs a mode. Nothing is clamped to anything. The solid's path
// has a bead per point, the ring has one, and the terrain's front edge has a
// bead on the ground alone, since the terrain lies on it.

/// Everything with a place, as beads.
function roomBeads() {
  const out = [];
  if (roomLayerOn('solid') && Array.isArray(roomEdit.solidPath) && roomEdit.solidPath.length >= 2) {
    const all = roomEdit.solidPath;
    all.forEach((pt, i) => out.push({
      key: `path:${i}`, path: true,
      end: i === 0 || i === all.length - 1,
      label: i === 0 ? 'front' : i === all.length - 1 ? 'end' : String(i),
      get: () => pt,
      set: (p) => { Object.assign(pt, p); },
      // A waypoint is removed where it is; the ends stay.
      remove: () => { if (all.length > 2 && i > 0 && i < all.length - 1) all.splice(i, 1); },
      save: () => { saveRoomData(); solidPathPanel(); },
    }));
  }
  if (roomLayerOn('sky') || roomLayerOn('skin')) {
    out.push({
      key: 'ring', label: 'ring',
      get: () => ({ ...roomWorldNow().ring }),
      set: (p) => { const c = roomWorldNow(); c.ring = { ...c.ring, ...p }; roomSetWorld(c); },
      save: saveRoomCameras,
    });
  }
  out.push({
    key: 'terrain', label: 'terrain', floorOnly: true,
    get: () => ({ x: roomEdit.geomAt.x, y: 0, z: roomEdit.geomAt.z }),
    set: (p) => { roomEdit.geomAt = { x: p.x, z: p.z }; },
    save: saveRoomData,
  });
  return out;
}

/// The three axes a picked bead can be pushed along, in the colours every 3D
/// program gives them.
const ROOM_AXES = [
  { key: 'x', dir: [1, 0, 0] },
  { key: 'y', dir: [0, 1, 0] },
  { key: 'z', dir: [0, 0, 1] },
];

/// Pick a bead — or nothing — and show it: the gizmo on the bead, the row in
/// the list.
function roomPick(key) {
  roomEdit.pick = key || null;
  paintRoomBeads();
  solidPathPanel();
  syncCamRows();
}

/// The picked bead, if it is still there.
function roomPicked() {
  return roomEdit.pick ? roomBeads().find((b) => b.key === roomEdit.pick) || null : null;
}

/// Frame what is picked, or the ring.
function roomFramePick() {
  const b = roomPicked();
  if (b) {
    const p = b.get();
    roomFrameOn([p.x, p.y, p.z], b.key === 'ring' ? roomWorldNow().ring.size * 2 : roomEdit.solidSize * VG_WORLD_H);
  } else {
    const r = roomWorldNow().ring;
    roomFrameOn([r.x, r.y, r.z], r.size * 2);
  }
}

function paintRoomBeads() {
  const host = $('roomHandles');
  const gl = $('visGl');
  if (!host || !gl) return;
  let svg = host.querySelector('.room-path');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'room-path');
    host.appendChild(svg);
  }
  const show = roomEdit.on && (state.mode === 'room' || state.mode === 'compose')
    && typeof visModuleKey === 'function' && visModuleKey() === 'room';
  svg.classList.toggle('hidden', !show);
  if (!show) return;
  const w = gl.clientWidth, h = gl.clientHeight;
  if (!(w > 0) || !(h > 0)) return;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);

  const beads = roomBeads();
  const keys = beads.map((b) => b.key).join('|');
  if (roomEdit.pick && !beads.some((b) => b.key === roomEdit.pick)) roomEdit.pick = null;
  // Rebuilt only when the set of beads changes — moving one must never
  // replace the element being dragged. Picking one shows a gizmo that was
  // built with it, for the same reason.
  if (svg.dataset.keys !== keys) {
    svg.dataset.keys = keys;
    svg.innerHTML = '';
    const el = (tag, cls) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
      e.setAttribute('class', cls);
      return e;
    };
    svg.appendChild(el('polyline', 'rp-line'));
    for (const b of beads) {
      const g = el('g', 'rp-bead');
      g.dataset.key = b.key;
      g.appendChild(el('line', 'rp-depth'));
      // The point's shadow on the ground: shown, not grabbed. The gizmo's
      // green arrow is how it goes up and down.
      const shadow = el('circle', 'rp-shadow');
      shadow.setAttribute('r', 3);
      g.appendChild(shadow);
      const giz = el('g', 'rp-giz hidden');
      for (const ax of ROOM_AXES) {
        if (b.floorOnly && ax.key === 'y') continue;
        giz.appendChild(el('line', `rp-ax rp-ax-${ax.key}`));
        const tip = el('circle', `rp-tip rp-tip-${ax.key}`);
        tip.setAttribute('r', 5);
        tip.dataset.key = b.key;
        tip.dataset.axis = ax.key;
        giz.appendChild(tip);
      }
      g.appendChild(giz);
      const dot = el('circle', `rp-pt${b.end ? ' rp-end' : ''}${b.key === 'ring' ? ' rp-ring' : ''}${b.floorOnly ? ' rp-only' : ''}`);
      dot.setAttribute('r', b.end || b.key === 'ring' || b.floorOnly ? 6 : 5);
      dot.dataset.key = b.key;
      g.appendChild(dot);
      const lb = el('text', 'rp-lb');
      lb.textContent = b.label;
      g.appendChild(lb);
      svg.appendChild(g);
    }
    wireRoomBeads();
  }

  const pathPts = [];
  for (const b of beads) {
    const g = svg.querySelector(`g[data-key="${b.key}"]`);
    if (!g) continue;
    const p = b.get();
    const air = roomProjectAt(p.x, p.y, p.z, w, h);
    const floor = roomProjectAt(p.x, 0, p.z, w, h);
    const q = (cls) => g.querySelector(`.${cls}`);
    const drop = q('rp-depth'), shadow = q('rp-shadow'), dot = q('rp-pt'), lb = q('rp-lb'), giz = q('rp-giz');
    drop.setAttribute('x1', air.x); drop.setAttribute('y1', air.y);
    drop.setAttribute('x2', floor.x); drop.setAttribute('y2', floor.y);
    drop.classList.toggle('hidden', !!b.floorOnly);
    shadow.setAttribute('cx', floor.x); shadow.setAttribute('cy', floor.y);
    shadow.classList.toggle('hidden', !!b.floorOnly);
    dot.setAttribute('cx', air.x); dot.setAttribute('cy', air.y);
    const picked = roomEdit.pick === b.key;
    dot.classList.toggle('picked', picked);
    lb.setAttribute('x', air.x); lb.setAttribute('y', air.y - 11);
    g.classList.toggle('hidden', !!air.behind && !!floor.behind);
    giz.classList.toggle('hidden', !picked);
    if (picked) {
      // Each arrow is a unit of the world along its axis, scaled to a hand's
      // length on screen — so it points the way that axis goes from here,
      // however the camera stands. An axis seen end-on has nowhere to point
      // and is not offered.
      for (const ax of ROOM_AXES) {
        const line = giz.querySelector(`.rp-ax-${ax.key}`), tip = giz.querySelector(`.rp-tip-${ax.key}`);
        if (!line || !tip) continue;
        const e = roomProjectAt(p.x + ax.dir[0], p.y + ax.dir[1], p.z + ax.dir[2], w, h);
        const vx = e.x - air.x, vy = e.y - air.y, len = Math.hypot(vx, vy);
        const off = e.behind || len < 2;
        line.classList.toggle('hidden', off);
        tip.classList.toggle('hidden', off);
        if (off) continue;
        const k = 46 / len;
        line.setAttribute('x1', air.x); line.setAttribute('y1', air.y);
        line.setAttribute('x2', air.x + vx * k); line.setAttribute('y2', air.y + vy * k);
        tip.setAttribute('cx', air.x + vx * k); tip.setAttribute('cy', air.y + vy * k);
      }
    }
    if (b.path) pathPts.push(`${air.x},${air.y}`);
  }
  svg.querySelector('.rp-line').setAttribute('points', pathPts.join(' '));
}

/// A drag on an element of the overlay: pointer capture, the lost-release
/// guard, and the bead's save at the end. `plan(bead, e)` is handed the press
/// and returns the move — `(dxPx, dyPx) => void` — for this drag.
function roomBeadDrag(el, plan) {
  el.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const bead = roomBeads().find((b) => b.key === el.dataset.key);
    if (!bead) return;
    if (roomEdit.pick !== bead.key) roomPick(bead.key);
    try { el.setPointerCapture(e.pointerId); } catch { /* the move guard covers it */ }
    el.classList.add('dragging');
    const move = plan(bead, e);
    const onMove = (ev) => {
      if (ev.buttons === 0) { up(ev); return; }
      move(ev.clientX - e.clientX, ev.clientY - e.clientY, ev);
      paintRoomBeads();
      paintRoomNums();
    };
    const up = (ev) => {
      el.classList.remove('dragging');
      try { el.releasePointerCapture(ev.pointerId); } catch { /* gone */ }
      el.onpointermove = null;
      el.onpointerup = null;
      el.onpointercancel = null;
      el.onlostpointercapture = null;
      if (bead.save) bead.save();
    };
    el.onpointermove = onMove;
    el.onpointerup = up;
    el.onpointercancel = up;
    el.onlostpointercapture = up;
  };
}

function wireRoomBeads() {
  const svg = $('roomHandles')?.querySelector('.room-path');
  const gl = $('visGl');
  if (!svg || !gl) return;
  // The bead itself: a free move, in the plane facing the camera — the point
  // stays under the hand. On the ground for what lies on it.
  for (const dot of svg.querySelectorAll('.rp-pt')) {
    roomBeadDrag(dot, (bead) => {
      const box = gl.getBoundingClientRect();
      const w = gl.clientWidth, h = gl.clientHeight;
      const c = roomWorldNow();
      const p0 = { ...bead.get() };
      if (bead.floorOnly) {
        return (dx, dy, ev) => {
          const g = roomGroundAt(ev.clientX - box.left, ev.clientY - box.top, w, h);
          if (g) bead.set({ x: g.x, z: g.z });
        };
      }
      const d = camDir(c), r = camRight(c), u = camUp(c);
      const depth = (p0.x - c.x) * d[0] + (p0.y - c.height) * d[1] + (p0.z - c.z) * d[2];
      const s = 2 * Math.max(0.05, depth) * Math.tan(c.fov / 2 / VG_DEG) / Math.max(1, h);
      return (dx, dy) => bead.set({
        x: p0.x + (r[0] * dx - u[0] * dy) * s,
        y: p0.y + (r[1] * dx - u[1] * dy) * s,
        z: p0.z + (r[2] * dx - u[2] * dy) * s,
      });
    });
    dot.ondblclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const bead = roomBeads().find((b) => b.key === dot.dataset.key);
      if (!bead || !bead.remove) return;
      bead.remove();
      if (bead.save) bead.save();
      roomPick(null);
    };
  }
  // An arrow: the move along that one axis, by the hand's travel along the
  // arrow as it lies on screen.
  for (const tip of svg.querySelectorAll('.rp-tip')) {
    roomBeadDrag(tip, (bead) => {
      const w = gl.clientWidth, h = gl.clientHeight;
      const ax = ROOM_AXES.find((a) => a.key === tip.dataset.axis) || ROOM_AXES[0];
      const p0 = { ...bead.get() };
      const a = roomProjectAt(p0.x, p0.y, p0.z, w, h);
      const e = roomProjectAt(p0.x + ax.dir[0], p0.y + ax.dir[1], p0.z + ax.dir[2], w, h);
      const vx = e.x - a.x, vy = e.y - a.y, len = Math.max(1e-6, Math.hypot(vx, vy));
      return (dx, dy) => {
        const along = (dx * vx + dy * vy) / (len * len);
        bead.set({
          x: p0.x + ax.dir[0] * along,
          y: p0.y + ax.dir[1] * along,
          z: p0.z + ax.dir[2] * along,
        });
      };
    });
  }
}

/// The old names, for everything that still calls them.
function paintSolidPath() { paintRoomBeads(); }
function wireSolidPath() { wireRoomBeads(); }

function paintRoomHandles() {
  const host = $('roomHandles');
  const gl = $('visGl');
  if (!host || !gl) return;
  const show = roomEdit.on;
  host.classList.toggle('hidden', !show);
  if (!show) return;

  const w = gl.clientWidth, h = gl.clientHeight;
  if (!(w > 0) || !(h > 0)) return;
  const c = { cam: roomWorldNow(), geom: { reach: roomEdit.geomReach } };
  paintRoomGnomon(host, c.cam);

  // Built once and then only moved. Rebuilding them every frame would drop any
  // drag in progress on the very first pointer move — the same fault the
  // palette's colour wells and the theme editor's swatches both had.
  // The path's SVG lives in here too, so the count is the handles' own share
  // rather than every child — otherwise adding the path rebuilt the handles on
  // every frame, and a handle rebuilt mid-drag drops the drag.
  // The zone word is a tip in look and not in kind: it belongs to the room,
  // not to a grip, and counting it here rebuilt every grip on every frame —
  // which is what dropped the camera drag the first time this shipped.
  const isGrip = (el) => el.classList.contains('rh')
    || (el.classList.contains('rh-tip') && !el.classList.contains('rh-zone-tip'));
  let handleKids = [...host.children].filter(isGrip);
  if (handleKids.length !== ROOM_HANDLES.length * 2) {
    // Everything that is not a grip — the path, the zone furniture — stays.
    const keep = [...host.children].filter((el) => !isGrip(el));
    host.innerHTML = '';
    for (const el of keep) host.appendChild(el);
    for (const hd of ROOM_HANDLES) {
      const el = document.createElement('i');
      el.className = `rh ${hd.cls}`;
      el.dataset.handle = hd.key;
      el.title = hd.tip;
      host.appendChild(el);
      const tip = document.createElement('span');
      tip.className = 'rh-tip';
      tip.textContent = hd.tip;
      host.appendChild(tip);
    }
    wireRoomHandles();
    // Re-read after the rebuild, or this frame positions nothing: the list was
    // taken before the elements it names existed.
    handleKids = [...host.children].filter(isGrip);
  }

  for (let i = 0; i < ROOM_HANDLES.length; i++) {
    const hd = ROOM_HANDLES[i];
    const el = handleKids[i * 2];
    const tip = handleKids[i * 2 + 1];
    if (!el || !tip) continue;
    const [x, y, t] = hd.at(c);
    const p = roomProject(x, y, t, w, h, c);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    tip.style.left = `${p.x}px`;
    tip.style.top = `${p.y}px`;
  }
}

/// The view axis in the corner: X, Y and Z as the camera sees them, so which
/// way the world goes is always in the picture. Each axis is its direction
/// in the camera's frame — across, up — and an axis pointing away is drawn
/// short, as it looks.
function paintRoomGnomon(host, cam) {
  let svg = host.querySelector('.room-gnomon');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'room-gnomon');
    svg.setAttribute('viewBox', '0 0 64 64');
    for (const k of ['x', 'y', 'z']) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', `g${k}`);
      line.dataset.axis = k;
      svg.appendChild(line);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('class', `g${k}`);
      t.dataset.axis = k;
      t.textContent = k.toUpperCase();
      svg.appendChild(t);
    }
    host.appendChild(svg);
  }
  const r = camRight(cam), u = camUp(cam);
  const o = 32, len = 24;
  for (const ax of ROOM_AXES) {
    const sx = ax.dir[0] * r[0] + ax.dir[1] * r[1] + ax.dir[2] * r[2];
    const sy = ax.dir[0] * u[0] + ax.dir[1] * u[1] + ax.dir[2] * u[2];
    const line = svg.querySelector(`line[data-axis="${ax.key}"]`);
    const t = svg.querySelector(`text[data-axis="${ax.key}"]`);
    line.setAttribute('x1', o); line.setAttribute('y1', o);
    line.setAttribute('x2', o + sx * len); line.setAttribute('y2', o - sy * len);
    t.setAttribute('x', o + sx * (len + 7)); t.setAttribute('y', o - sy * (len + 7));
  }
}

function wireRoomHandles() {
  const host = $('roomHandles');
  const gl = $('visGl');
  if (!host || !gl) return;
  for (const el of host.querySelectorAll('.rh')) {
    el.addEventListener('pointerdown', (e) => {
      const hd = ROOM_HANDLES.find((x) => x.key === el.dataset.handle);
      if (!hd) return;
      // The first button only. A secondary press opens a menu, and the menu
      // takes the release with it — see `wireRoomDrag`.
      if (e.button !== 0) return;
      // **Stopped here.** The canvas underneath has its own drag on it, and
      // without this a pull on a handle also swings the whole view.
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* not held; the move guard covers it */ }
      el.classList.add('dragging');
      host.classList.add('gripping');
      const r = gl.getBoundingClientRect();
      const from = { cam: JSON.parse(JSON.stringify(roomWorldNow())), geom: { reach: roomEdit.geomReach } };
      const move = (ev) => {
        // A move with no button down is a release this element never heard
        // about. Ending here is what stops a grip following the pointer with
        // nothing pressed.
        if (ev.buttons === 0) { up(ev); return; }
        const dx = (ev.clientX - e.clientX) / Math.max(1, r.width);
        const dy = (ev.clientY - e.clientY) / Math.max(1, r.height);
        const c = JSON.parse(JSON.stringify(from));
        hd.move(c, from, dx, dy);
        roomSetWorld(c.cam);
        roomEdit.geomReach = c.geom.reach;
        paintRoomNums();
        paintRoomHandles();
        paintSolidPath();
      };
      const up = () => {
        try { el.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
        el.classList.remove('dragging');
        host.classList.remove('gripping');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.removeEventListener('lostpointercapture', up);
        saveRoomData();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    });
  }
}

/// What a press on the bare room takes hold of, said while the pointer is
/// over it and while it drags.
///
/// The room's two gestures were zones you had to be told about — the sky for
/// the ring, the rest for the camera — with no line between them and nothing
/// under the hand to say which you were on. So the zone is shown: a word at
/// the pointer naming it and what each axis does, and, over the sky, the band
/// itself. Grips have their own glow; this is for the room between them.
const ROOM_ZONE_TIPS = {
  camera: 'ORBIT — drag · shift: track · ctrl: dolly · right: look · wheel: dolly · 2×click: focus · F: frame',
  orbit: 'ORBIT', track: 'TRACK', dolly: 'DOLLY', look: 'LOOK',
};

function roomZoneShow(zone, e, dragging) {
  const host = $('roomHandles');
  const gl = $('visGl');
  if (!host || !gl) return;
  // Each made on its own if missing, so losing one to a rebuild elsewhere
  // can never leave the other pointing at nothing.
  let band = host.querySelector('.rh-zone');
  if (!band) {
    band = document.createElement('i');
    band.className = 'rh-zone';
    host.appendChild(band);
  }
  let tip = host.querySelector('.rh-zone-tip');
  if (!tip) {
    tip = document.createElement('span');
    tip.className = 'rh-tip rh-zone-tip';
    host.appendChild(tip);
  }
  const on = !!zone && roomEdit.on && !host.classList.contains('gripping');
  host.dataset.zone = on ? (dragging ? 'camera' : zone) : '';
  host.classList.toggle('zone-dragging', on && dragging);
  gl.style.cursor = !roomEdit.on ? '' : dragging ? 'grabbing' : 'grab';
  if (!on) { tip.style.opacity = '0'; return; }
  const r = gl.getBoundingClientRect();
  tip.textContent = ROOM_ZONE_TIPS[zone] || zone;
  tip.style.left = `${Math.max(60, Math.min(r.width - 60, e.clientX - r.left))}px`;
  tip.style.top = `${e.clientY - r.top + 22}px`;
  tip.style.opacity = '1';
}

/// Which gesture a press is, from its button and its modifiers — the bindings
/// Maya, Blender, Unity and Unreal share between them.
///
///   orbit   drag · alt+drag
///   track   shift+drag · middle-drag · alt+middle-drag
///   dolly   ctrl+drag · ctrl+middle-drag · alt+right-drag · wheel
///   look    right-drag
function camGesture(e) {
  const alt = e.altKey, shift = e.shiftKey, ctrl = e.ctrlKey || e.metaKey;
  if (e.button === 1) return ctrl ? 'dolly' : 'track';
  if (e.button === 2) return alt || ctrl ? 'dolly' : 'look';
  if (e.button === 0) return shift ? 'track' : ctrl ? 'dolly' : 'orbit';
  return null;
}

(function wireRoomDrag() {
  const gl = $('visGl');
  if (!gl) return;

  gl.addEventListener('pointerenter', () => { roomEdit.hover = true; });
  gl.addEventListener('pointerleave', (e) => { roomEdit.hover = false; if (!roomEdit.drag) roomZoneShow(null, e, false); });
  // The right button is a gesture here, so the menu it would open is not.
  // Without this the menu takes the release with it and the room follows the
  // pointer with nothing pressed — see `docs/ROOM-EDITOR.md`, "the mouse
  // gets stuck".
  gl.addEventListener('contextmenu', (e) => { if (roomEdit.on) e.preventDefault(); });

  gl.addEventListener('pointerdown', (e) => {
    if (!roomEdit.on) return;
    const mode = camGesture(e);
    if (!mode) return;
    const r = gl.getBoundingClientRect();
    roomEdit.drag = {
      zone: 'camera', mode, moved: false,
      x: e.clientX, y: e.clientY, w: r.width, h: r.height,
      cam: roomWorldNow(),
    };
    try { gl.setPointerCapture(e.pointerId); } catch { /* the move guard covers it */ }
    roomZoneShow(mode, e, true);
    e.preventDefault();
  });

  gl.addEventListener('pointermove', (e) => {
    const d = roomEdit.drag;
    if (!d) {
      // Not dragging: say what a press here would take hold of.
      if (roomEdit.on) roomZoneShow('camera', e, false);
      return;
    }
    // A move with no button down is a release this element never heard
    // about.
    if (e.buttons === 0) { end(e); return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    roomZoneShow(d.mode, e, true);
    const c = JSON.parse(JSON.stringify(d.cam));
    // Sideways, the world follows the hand: drag right and it turns right
    // under you. Up and down is the camera's: drag down and you go down
    // under the pivot, looking up; drag up and you rise over it. Track: the
    // point under the hand stays under it. Dolly: right or up is in. Look:
    // sideways goes where the hand goes; down looks up, as a flight stick.
    if (d.mode === 'orbit') camOrbit(c, -dx * CAM_ORBIT_DEG, dy * CAM_ORBIT_DEG);
    else if (d.mode === 'track') camTrack(c, dx, dy, d.h);
    else if (d.mode === 'dolly') camDolly(c, Math.exp(-(dx - dy) * 0.004));
    else if (d.mode === 'look') camLook(c, dx * CAM_LOOK_DEG, dy * CAM_LOOK_DEG);
    roomSetWorld(c);
    paintRoomNums();
  });

  const end = (e) => {
    const d = roomEdit.drag;
    if (!d) return;
    roomEdit.drag = null;
    try { gl.releasePointerCapture(e.pointerId); } catch {}
    roomZoneShow(roomEdit.hover ? 'camera' : null, e, false);
    // A click on the bare room, with nothing moved, lets go of what was picked.
    if (!d.moved && d.mode === 'orbit' && roomEdit.pick) roomPick(null);
    saveRoomCameras();
  };
  gl.addEventListener('pointerup', end);
  gl.addEventListener('pointercancel', end);
  gl.addEventListener('lostpointercapture', end);

  // Double-click on the ground: look there, and make it the pivot.
  gl.addEventListener('dblclick', (e) => {
    if (!roomEdit.on) return;
    const r = gl.getBoundingClientRect();
    const g = roomGroundAt(e.clientX - r.left, e.clientY - r.top, gl.clientWidth, gl.clientHeight);
    if (!g) return;
    roomSetWorld(camAim(roomWorldNow(), [g.x, 0, g.z]));
    paintRoomNums();
    saveRoomCameras();
  });

  // The wheel is the dolly, as it is everywhere; a pinch arrives as the same
  // with ctrl held. Sideways scroll tracks sideways, shift and scroll tracks
  // up and down.
  gl.addEventListener('wheel', (e) => {
    if (!roomEdit.on) return;
    e.preventDefault();
    const c = roomWorldNow();
    const h = gl.clientHeight;
    if (e.shiftKey) {
      camTrack(c, 0, -(e.deltaY || e.deltaX), h);
    } else {
      if (e.deltaX) camTrack(c, -e.deltaX, 0, h);
      if (e.deltaY) camDolly(c, Math.exp(e.deltaY * 0.0015));
    }
    roomSetWorld(c);
    paintRoomNums();
    saveRoomCameras();
  }, { passive: false });

  // Keys, while the hand is over the room: fly with WASD and QE, frame with
  // F, home with Home, and the picked point with Delete and Escape. Taken
  // before anything else hears them, so a letter is a step here and not a
  // note on the keyboard.
  document.addEventListener('keydown', (e) => {
    if (!roomEdit.on || !roomEdit.hover || inTextField(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const c = roomWorldNow();
    const step = camFocus(c) * 0.06;
    const fly = {
      w: [step, 0, 0], s: [-step, 0, 0], a: [0, -step, 0], d: [0, step, 0],
      q: [0, 0, -step], e: [0, 0, step],
    }[k];
    let took = true;
    if (fly) { camFly(c, ...fly); roomSetWorld(c); paintRoomNums(); saveRoomCameras(); }
    else if (k === 'f') roomFramePick();
    else if (k === 'Home') { delete roomEdit.cams[roomEdit.frame]; saveRoomCameras(); paintRoomNums(); }
    else if (k === 'Escape' && roomEdit.pick) roomPick(null);
    else if ((k === 'Delete' || k === 'Backspace') && roomEdit.pick) {
      const b = roomPicked();
      if (b && b.remove) { b.remove(); if (b.save) b.save(); }
      roomPick(null);
    } else took = false;
    if (took) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();

