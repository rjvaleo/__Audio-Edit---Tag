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

