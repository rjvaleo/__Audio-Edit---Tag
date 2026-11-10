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

