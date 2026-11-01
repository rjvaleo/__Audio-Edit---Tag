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

/// The streams a grain carries.
///
/// Every one of these is a real number the schedule is working to — the same
/// array `api_grains` sends the swarm and the braid, read column by column
/// rather than plotted. Nothing here is invented for the look of it.
const ROOM_STREAMS = [
  { key: 'idx', label: 'IDX', w: 6, get: (g) => g[7], fmt: (v) => String(Math.round(v)) },
  { key: 'out', label: 'OUT', w: 8, get: (g, sr) => g[0] / sr, fmt: (v) => v.toFixed(3) },
  { key: 'src', label: 'SRC', w: 8, get: (g, sr) => g[1] / sr, fmt: (v) => v.toFixed(3) },
  { key: 'size', label: 'SIZE', w: 7, get: (g, sr) => (g[2] / sr) * 1000, fmt: (v) => v.toFixed(1) },
  { key: 'pitch', label: 'PIT', w: 7, get: (g) => g[3], fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { key: 'rms', label: 'RMS', w: 7, get: (g) => g[4], fmt: (v) => v.toFixed(4) },
  { key: 'brt', label: 'BRT', w: 7, get: (g) => g[5], fmt: (v) => v.toFixed(4) },
  { key: 'pan', label: 'PAN', w: 7, get: (g) => g[6], fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
];

/// One line of the grain block, in pixels. Matches `.room-data` in the
/// stylesheet, and has to: the fitting counts whole lines against the wall's
/// height, so a disagreement here spills text past the bottom of the room.
const ROOM_LINE = 9;

/// The width of one character, measured once.
///
/// The layout is counted in characters — every column is a character width and
/// the fitting decides in whole columns — so the number has to come from the
/// face actually in use rather than from an assumption about it.
function roomChPx(el) {
  if (roomChPx.v) return roomChPx.v;
  const probe = document.createElement('span');
  probe.className = 'room-data';
  probe.style.cssText = 'position:absolute;visibility:hidden;width:auto;height:auto;';
  probe.textContent = '0'.repeat(40);
  (el.parentElement || document.body).appendChild(probe);
  const w = probe.offsetWidth / 40;
  probe.remove();
  roomChPx.v = w > 0 ? w : 5.1;
  return roomChPx.v;
}

/// Where a point in the room lands on screen, in canvas pixels.
///
/// `x` and `y` are world units on the **front** face and `t` is how far back it
/// sits, nought to one — so `(halfW, ceilY, 1)` is the far top corner however
/// the back has been tapered, because the taper is applied here.
///
/// The arithmetic is `vgFrustum`'s, written out. It is duplicated rather than
/// shared because the renderer's copy runs on the GPU as a matrix and this one
/// has to answer for a single point on the CPU — but they are the same frustum,
/// and `the handles sit on the room they are dragging` is the test that says so.
/// The view the room is drawn with, for the helpers below: the same numbers
/// the renderer builds its own from, so a grip sits on the thing it moves.
///
/// A world camera is used as it is; a box camera — a film's, a test's — is
/// read as the world camera it maps to at this aspect, which is what the
/// renderer does with it; nothing means the camera being posed.
function roomView(w, h, cam) {
  const aspect = w / h;
  const wc = cam
    ? (vgIsWorld(cam) ? { ...VG_WORLD_DEFAULT, ...vgWorldUpgrade(cam) } : vgWorldFromBox(cam, aspect))
    : roomWorldNow();
  const near = 1;
  const reach = roomEdit.geomReach;
  const at = roomEdit.geomAt;
  const far = near + reach;
  const horizon = VG_HORIZON + Math.hypot(wc.x, wc.z) + reach;
  const wv = vgWorldView(wc, aspect, near, horizon);
  return {
    wc, hh: VG_WORLD_H, height: wc.height, halfW: roomEdit.geomWidth / 2,
    near, far, reach, at, horizon, mvp: wv.mvp,
    eye: [wc.x, wc.height, wc.z],
  };
}

/// A place in the world to a point on the canvas.
function roomProjectAt(x, y, z, w, h, cam) {
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0, behind: true };
  const v = roomView(w, h, cam);
  const p = vgProjectPoint(v.mvp, x, y, z);
  return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h, behind: p.w <= 1e-6 };
}

/// The place at a known `z` that lands under the pixel.
function roomUnprojectZ(px, py, z, w, h, cam) {
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0, z };
  const v = roomView(w, h, cam);
  return vgUnprojectAtZ(v.mvp, (px / w) * 2 - 1, 1 - (py / h) * 2, z);
}

/// The place on the ground under the pixel, or null when the pixel is above
/// the horizon and the ray never lands.
function roomGroundAt(px, py, w, h, cam) {
  if (!(w > 0) || !(h > 0)) return null;
  const v = roomView(w, h, cam);
  const nx = (px / w) * 2 - 1, ny = 1 - (py / h) * 2;
  // Two points on the ray, then the one on it with no height.
  const a = vgUnprojectAtZ(v.mvp, nx, ny, v.eye[2] - 1);
  const b = vgUnprojectAtZ(v.mvp, nx, ny, v.eye[2] - 2);
  const dy = b.y - a.y;
  if (Math.abs(dy) < 1e-9) return null;
  const s = -a.y / dy;
  if (s < -0.999) return null;
  const x = a.x + (b.x - a.x) * s, z = a.z + (b.z - a.z) * s;
  // Ahead of the eye, not behind it.
  const fwd = (x - v.eye[0]) * Math.sin(v.wc.yaw / VG_DEG) - (z - v.eye[2]) * Math.cos(v.wc.yaw / VG_DEG);
  return fwd > 0 ? { x, y: 0, z } : null;
}

/// A point in the room to a point on the canvas.
///
/// `x` runs across, `y` is up from the ground, and `t` is how far back along
/// the terrain — a world point, through the world's view.
function roomProject(x, y, t, w, h, cam) {
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0 };
  const v = roomView(w, h, cam);
  const z = v.at.z - Math.max(0, Math.min(1, t)) * v.reach;
  const p = vgProjectPoint(v.mvp, x, y, z);
  return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h };
}

/// The reverse, at a depth you already know: the point at `t` that lands
/// under the pixel. Exact for a turned or pitched camera, since the matrix
/// is inverted rather than a frustum assumed.
function roomUnproject(px, py, t, w, h, cam) {
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0 };
  const v = roomView(w, h, cam);
  const z = v.at.z - Math.max(0, Math.min(1, t)) * v.reach;
  const q = vgUnprojectAtZ(v.mvp, (px / w) * 2 - 1, 1 - (py / h) * 2, z);
  return { x: q.x, y: q.y };
}

function roomHalfW(w, h, cam) {
  return roomView(w, h, cam).halfW;
}

/// Where the far end of the layers' reach lands on the canvas: the rectangle
/// the data block and the text card are printed on, until they are boards
/// standing in the world. The four corners of the far cross-section are
/// projected and their bounds taken, so under a pitched or turned camera the
/// block still covers the end of the room rather than a rectangle the box
/// would have drawn.
function roomBackWall(w, h, cam) {
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0, w: 1, h: 1, k: 1 };
  const v = roomView(w, h, cam);
  const k = 1 / (1 + v.reach);
  const z = v.at.z - v.reach;
  const pts = [[v.at.x - v.halfW, 0], [v.at.x + v.halfW, 0], [v.at.x + v.halfW, v.hh], [v.at.x - v.halfW, v.hh]]
    .map(([x, y]) => vgProjectPoint(v.mvp, x, y, z))
    .map((p) => ({ x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h }));
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), k };
}

function fitCell(v, w) {
  const t = String(v);
  if (t.length > w) return t.slice(0, w).replace(/\.$/, ' ');
  return t.padStart(w);
}

/// Which columns are up. A few by default: all eight at once is a wall.
const ROOM_STREAM_DEFAULT = ['idx', 'src', 'size', 'pitch', 'rms'];

function roomStreamOn(key) {
  const set = roomEdit.streams;
  return set ? set[key] === true : ROOM_STREAM_DEFAULT.includes(key);
}

function saveRoomStreams() {
  try { localStorage.setItem('roomStreams', JSON.stringify(roomEdit.streams || {})); } catch {}
}

/// The grain block: the schedule itself, running past.
///
/// Not a summary. The rows are grains — the ones nearest the playhead, in the
/// order they are laid down — so what you are reading is the same list the
/// cloud is drawing and the engine is working through, arriving as fast as the
/// playhead crosses it.
///
/// One aggregate line at the top, because rate, load and the drop counter are
/// the three things you want without having to add anything up. The drop
/// counter especially: it is the pool being full and grains being thrown away,
/// which is audible and which nothing else on screen says.
/// The grain block's lines, worked out and handed back rather than written.
///
/// **One builder, two destinations.** The live block is HTML behind the canvas
/// and the filmed one is type drawn into the export's own 2D context, and they
/// have to be the same wall of numbers — the film is meant to be what the room
/// looks like. Two builders would be two things to keep in step, which is the
/// fault this program has shipped over the background colour and over five
/// draw calls' worth of palette.
///
/// Everything that differs between the two is an argument: the wall it is
/// printed on, how wide a character is there, the schedule, where the playhead
/// is, and the header — which offline has no engine to ask about load or drops.
function roomDataBlock({ wall, ch, line: lineH, sched, position, chunk, head }) {
  const sr = sched?.sampleRate || 44100;
  const all = sched?.grains || [];
  const lines = Math.max(0, Math.floor(wall.h / (lineH || ROOM_LINE)) - 2);
  const rows = Math.max(0, Math.min(64, lines));

  // ── every stream has a home ──
  //
  // **A column's place is fixed, whether or not it is switched on.** Packing
  // only the columns that were on meant turning one off pulled every column
  // after it to the left — switch off IDX and SRC lands where OUT was, so a
  // number you had been reading in one place is now a different number in the
  // same place. The block is a readout you watch while it runs, and a readout
  // whose columns move under you cannot be watched.
  const room = Math.max(0, Math.floor(wall.w / ch));
  const slots = [];
  let at = 0;
  for (const c of ROOM_STREAMS) {
    // Whole columns only. A column that does not fit is left out rather than
    // clipped down the middle of its numbers, which would read as damage.
    if (at + c.w <= room) slots.push({ c, on: roomStreamOn(c.key) });
    at += c.w + 1;
  }
  const cols = slots;

  // ── the wall is tiled, not stretched ──
  //
  // One block of columns is narrower than the back wall and the schedule around
  // the playhead is shorter than the wall is tall, so printing one of each left
  // the wall mostly empty. **Repeated instead of resized**: the type stays the
  // size it is — it is small type printed on a wall, and type on a wall does not
  // grow because the wall is big — and what fills the space is more of it.
  //
  // A tile ends at its last *switched-on* column. The empty places after that
  // are still reserved — nothing moves — but they are not printed, or every
  // tile would carry the width of the streams that are off and the tiles would
  // sit that far apart. Leading empties are kept, because those hold the
  // columns still.
  let lastOn = -1;
  for (let i = 0; i < cols.length; i++) if (cols[i].on) lastOn = i;
  const tileCols = lastOn >= 0 ? cols.slice(0, lastOn + 1) : [];
  const tileChars = tileCols.length
    ? tileCols.reduce((w, s2) => w + s2.c.w, 0) + (tileCols.length - 1)
    : 0;
  // A gap between tiles, or two of them read as one row of columns.
  const TILE_GAP = 3;
  const across = tileChars > 0
    ? Math.max(1, Math.floor((room + TILE_GAP) / (tileChars + TILE_GAP)))
    : 1;

  // Around the playhead, so it runs with the sound instead of sitting still at
  // the top of the file.
  let first = 0;
  for (let i = 0; i < all.length; i++) { if (all[i][0] >= position) { first = i; break; } }
  const window = all.slice(Math.max(0, first - 1), Math.max(0, first - 1) + rows);

  const line = (cells) => cells.join(' ');
  /// One tile of a row, with the switched-off streams standing empty in their
  /// own places.
  const slotLine = (cell) => line(tileCols.map((s) => (s.on ? cell(s.c) : ' '.repeat(s.c.w))));
  /// That tile, repeated across the wall.
  const tiled = (text) => {
    if (across <= 1) return text;
    const out2 = [];
    for (let t = 0; t < across; t++) out2.push(text);
    return out2.join(' '.repeat(TILE_GAP));
  };

  const out = [];
  // Trimmed to the wall like everything else. Clipping alone would leave it
  // cut through the middle of a number, which reads as a fault rather than as
  // a wall that ran out.
  out.push({ kind: 'head', text: head.slice(0, room) });
  if (cols.some((s2) => s2.on)) {
    out.push({ kind: 'hdr', text: tiled(slotLine((c) => fitCell(c.label, c.w))) });
    // Always `rows` lines, padded with blanks. Rendering only the grains in
    // range let the block grow and shrink under the sound, which moves
    // everything else in the corner with it.
    //
    // Laid down in blocks of `chunk` with a blank line between, and every other
    // block reversed. Reversing is what makes the movement readable: the
    // schedule runs one way, so a single column of it slides uniformly and at
    // this size that looks like nothing moving at all. Against a neighbour
    // going the other way it is obvious.
    const blank = tiled(line(tileCols.map((s2) => ' '.repeat(s2.c.w))));
    let printed = 0;
    let block = 0;
    while (printed < rows) {
      const take = Math.min(chunk, rows - printed);
      const slice = [];
      for (let i = 0; i < take; i++) {
        // Down the wall the same way: when the schedule around the playhead
        // runs out, it starts again rather than leaving the rest of the wall
        // blank. A grain repeated further down is the same grain, which is the
        // whole idea of a tile.
        const row = window.length ? window[(printed + i) % window.length] : null;
        slice.push(row
          ? tiled(slotLine((c) => fitCell(c.fmt(c.get(row, sr)), c.w)))
          : blank);
      }
      if (block % 2 === 1) slice.reverse();
      for (const text of slice) out.push({ kind: 'row', text });
      printed += take;
      block++;
      // One blank line between blocks, and never one left hanging at the end.
      if (printed < rows) { out.push({ kind: 'gap', text: blank }); printed++; }
    }
  }
  return out;
}

/// The header line: what the engine is doing, rather than what the schedule is.
///
/// `live` false is the filmed one, which has no running engine to ask — the
/// document's own settings are still true, and the load and the drop count are
/// a property of playback rather than of the sound, so they are left out.
function roomDataHead(live) {
  const st = state.stretchDraft || {};
  const g = state.grainDraft || {};
  const l = live ? (engine.load || null) : null;
  const win = st.windowMs || 0;
  const auto = !(g.densityHz > 0);
  const rate = auto ? (win > 0 ? (1000 / win) * (g.overlap || 1) : 0) : g.densityHz;
  const drops = live ? Math.round(engine.overflows || 0) : 0;
  const asked = Math.max(1, Math.round(g.layers || 1));
  const running = l && l.layersRunning > 0 ? Math.round(l.layersRunning) : asked;

  // Every field its own width, so the header is the same length whatever the
  // numbers are. A readout that reflows as the values change is one you cannot
  // read while it runs — the eye goes back to finding the column instead of
  // reading it.
  return [
    fitCell(`${rate ? rate.toFixed(0) : '—'}/s`, 6),
    fitCell(`${win.toFixed(0)}ms`, 6),
    fitCell(`L${running}/${asked}`, 6),
    fitCell(`${l ? Math.round(l.now * 100) : 0}%`, 4),
    fitCell(`D${drops}`, 5),
  ].join(' ');
}

/// How far down the wall a line has faded, nought to one.
///
/// The stylesheet says this in five `color-mix` steps against `--wave-2`, and
/// the filmed block has to say the same thing in numbers. Kept here rather than
/// in either caller so the two cannot drift — a wall that faded differently on
/// film would be the same fault as a background that did.
function roomDataAlpha(kind, childIndex) {
  if (kind === 'gap') return 0;
  if (kind === 'head') return 1;
  if (kind === 'hdr') return 0.45;
  // `nth-child` counts every child, the header and the column names included.
  const n = childIndex + 1;
  if (n >= 22) return 0.26;
  if (n >= 15) return 0.38;
  if (n >= 9) return 0.52;
  return 0.70;
}

/// What the block is printed in.
///
/// The palette owns it — `data` is one of its slots — and falls back to the
/// token the stylesheet uses. Resolved to a hex here because the film has to
/// draw it into a 2D context, where `color-mix` and custom properties mean
/// nothing.
function roomDataColour() {
  const d = rpSlot('data');
  if (d.mode === 'flat' && d.colour) return d.colour;
  return rpToken('--wave-2', '#4a9fd8');
}

function paintRoomData() {
  const el = $('roomData');
  if (!el) return;
  const show = roomLayerOn('data');
  el.classList.toggle('hidden', !show);
  if (!show) return;

  const l = engine.load || null;
  const drops = Math.round(engine.overflows || 0);

  // How many rows fit, rather than a number picked once and wrong at every
  // other size. The room is the same box in a dock and on a wall.
  const cell = el.parentElement?.getBoundingClientRect();
  // On the back wall, so it recedes with the room instead of sitting on the
  // glass in front of it.
  const wall = roomBackWall(cell?.width || 300, cell?.height || 150);
  const ch = roomChPx(el);

  const block = roomDataBlock({
    wall,
    ch,
    line: ROOM_LINE,
    sched: state.grains,
    position: engine.position || 0,
    chunk: roomEdit.chunk,
    head: roomDataHead(true),
  });

  const cls = { head: 'rd-head', hdr: 'rd-hdr', row: 'rd-row', gap: 'rd-row rd-gap' };
  el.innerHTML = block.map((b) => `<div class="${cls[b.kind]}">${b.text}</div>`).join('');
  // The block *is* the wall: its box is the wall's box, and anything that does
  // not fit is clipped rather than allowed over the edge. No transform — a
  // scaled block was the previous attempt and it made the type grow and shrink
  // with the room, which is not what printing on a wall looks like.
  el.style.left = `${Math.round(wall.x)}px`;
  el.style.top = `${Math.round(wall.y)}px`;
  el.style.width = `${Math.round(wall.w)}px`;
  el.style.height = `${Math.round(wall.h)}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = '';
  el.style.opacity = String(roomEdit.opacity);
  el.classList.toggle('rd-hot', !!(l && l.worst >= 1) || drops > 0);
}

function buildRoomStreams() {
  const box = $('reStreams');
  if (!box || box.children.length) return;
  for (const c of ROOM_STREAMS) {
    const b = document.createElement('button');
    b.className = 're-btn';
    b.dataset.stream = c.key;
    b.textContent = c.label;
    b.title = `Show the ${c.label} column in the grain block.`;
    b.onclick = () => {
      if (!roomEdit.streams) {
        roomEdit.streams = {};
        for (const d of ROOM_STREAMS) roomEdit.streams[d.key] = ROOM_STREAM_DEFAULT.includes(d.key);
      }
      roomEdit.streams[c.key] = !roomStreamOn(c.key);
      saveRoomStreams();
      paintRoomNums();
      paintRoomData();
    };
    box.appendChild(b);
  }
}

$('roomEditOpen')?.addEventListener('click', toggleRoomEdit);

$('reClear')?.addEventListener('click', roomClear);

$('reReset')?.addEventListener('click', () => {
  delete roomEdit.cams[roomEdit.frame];
  saveRoomCameras();
  paintRoomNums();
});

$('reNums')?.addEventListener('click', (e) => {
  navigator.clipboard?.writeText(e.currentTarget.dataset.copy || '').then(
    () => toast('camera copied — paste it into VG_CAMERA in vis-gl.js'),
    () => toast('could not reach the clipboard'),
  );
});

