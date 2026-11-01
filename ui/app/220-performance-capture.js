// ───────────────────────────────────────────── capturing a performance ──
//
// The sequencer's REC PERF, here: one button that arms every control and
// rolls the transport. The server does the writing — every control that moves
// while it plays lands in a lane of its own, created if it has none — and
// stopping the transport ends the take. Latch, so a control keeps laying its
// value down after the hand comes off, which is what a performance is.

state.captureArmed = false;

/// REC PERF arms. The take starts when Play does, and ends when the
/// transport stops. It used to start playback itself the instant the button
/// was pressed, which meant the take always began with you reaching for the
/// controls; arming and pressing Play is how every recorder works.
async function startCapture() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  await setAutomationRecord('latch');
  state.captureArmed = true;
  // One arm: the sequencer's recorder with the grain's, while it plays a part.
  if (sourceOn('seq') && seqLoaded()) seqArm(true);
  captureShow(engine.playing ? 'taking' : 'armed');
}

/// The capture's state, on the button, the status line and the transport.
function captureShow(how) {
  const b = $('automationCapture');
  const l = $('recLabel');
  if (how === 'armed') {
    if (b) { b.classList.add('armed'); b.classList.remove('recording'); b.textContent = '⏺ ARMED'; }
    perfSetStatus('ARMED — PRESS PLAY TO START THE TAKE · STOP ENDS IT');
    if (l) l.textContent = 'PERF ARMED';
  } else if (how === 'taking') {
    if (b) { b.classList.remove('armed'); b.classList.add('recording'); b.textContent = '⏺ CAPTURING'; }
    perfSetStatus('CAPTURING — EVERY CONTROL MOVE IS BEING RECORDED · STOP ENDS THE TAKE');
    if (l) l.textContent = 'PERF ● REC';
  } else {
    if (b) { b.classList.remove('armed', 'recording'); b.textContent = '⏺ REC PERF'; }
    if (l && /^PERF/.test(l.textContent)) l.textContent = '';
  }
}

/// The transport, as the capture hears it: Play starts an armed take, and
/// a stop ends one.
function captureTransport(playing) {
  if (!state.captureArmed) return;
  if (playing) captureShow('taking');
  else endCapture();
}

async function endCapture() {
  state.captureArmed = false;
  captureShow('off');
  seqArm(false);
  await setAutomationRecord('off');
  await loadAutomation();
  const lanes = state.automation.lanes || [];
  const points = lanes.reduce((n, l) => n + (l.points || []).length, 0);
  perfSetStatus(lanes.length
    ? `SAVED — ${lanes.length} LANES · ${points} POINTS · ${perfDuration().toFixed(1)}s`
    : 'CAPTURE ENDED — NOTHING MOVED, NOTHING RECORDED');
}

function leaveRoomView() {
  $('roomView')?.classList.add('hidden');
  roomReleaseAll();
  // Put the overlay back to shut. It was forced open on the way in, and a
  // panel that opens itself over the dock's room because you visited another
  // workspace is a setting changed behind your back.
  roomEdit.on = false;
  $('roomEdit')?.classList.add('hidden');
  // **And the card's panel with it.** These live inside `masterBus`, which is
  // itself borrowed into the room stage — so a panel released back into it
  // without being hidden again is put straight back on top of the visualiser.
  // `roomEdit` has always been hidden here for that reason; the card's was not,
  // and it covered the dock's room until it was.
  $('textEdit')?.classList.add('hidden');
  $('ridgeEdit')?.classList.add('hidden');
  $('room3dEdit')?.classList.add('hidden');
  $('stageEdit')?.classList.add('hidden');
  // Whatever was borrowed onto the stage goes home hidden if that is how it was
  // found. `roomReleaseAll` above puts it back in the tree; this puts its class
  // back, and the dock's layout depends on that class — see `visRehide`.
  for (const fam of VIS_FAMILIES) {
    const el = $(fam.host);
    if (el) visRehide(el);
  }
  $('masterBus')?.classList.remove('room-editing');
  $('roomEditOpen')?.classList.remove('on');
  applyRoomFrame();
}

const ROOM_ADMIN_MIN = 210;
const ROOM_ADMIN_MAX = 620;

/// The clamp used to be on the write only, so a width saved on a wider screen
/// came back unclamped and the column could open past its own maximum. The
/// store applies the bounds on the way in as well.
const roomAdminWidth = () => prefs.roomAdminWidth;

function setRoomAdminWidth(px, { save = true } = {}) {
  const v = Math.round(Math.min(ROOM_ADMIN_MAX, Math.max(ROOM_ADMIN_MIN, px)));
  $('roomAdmin')?.style.setProperty('--rv-admin-w', `${v}px`);
  if (save) setPref('roomAdminWidth', v);
}

function wireRoomGrip() {
  const grip = $('roomGrip'), panel = $('roomAdmin');
  if (!grip || !panel) return;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    document.body.classList.add('resizing-panel');
    // Measured from the panel's own left edge, so the width tracks the pointer
    // exactly instead of drifting by wherever inside the grip the drag began.
    const left = panel.getBoundingClientRect().left;
    const move = (ev) => setRoomAdminWidth(ev.clientX - left, { save: false });
    const up = (ev) => {
      grip.releasePointerCapture(e.pointerId);
      grip.classList.remove('dragging');
      document.body.classList.remove('resizing-panel');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setRoomAdminWidth(ev.clientX - left);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => setRoomAdminWidth(300));
}
wireRoomGrip();

/// Which part of the room a drag has hold of.
///
/// Two zones rather than two modifier keys: a modifier is a thing you have to
/// be told and a zone is a thing you find. The ring hangs `skyAt` of the way up
/// the room, so it sits `1 - skyAt` of the way down the canvas — the top third
/// contains it at every setting it is usable at.
function roomZoneAt() {
  // The whole picture is the camera. The ring used to be dragged from a
  // zone across the top; it has beads now, like everything with a place.
  return 'camera';
}

// ────────────────────────────────────────────────────────── the handles ──
//
// The room has always been posed by dragging it, and `docs/ROOM-EDITOR.md`
// argues for that over a panel of numbers. What it never had was anything
// **showing** where to take hold: the gestures were zones you had to be told
// about. These are the same idea with the grips made visible, plus two that
// could not be dragged at all before — the width and the height of the far
// rectangle, on their own, against the near one.
//
// Placed from `roomProject`, so a handle sits on the thing it moves however the
// room is posed. Nothing here is drawn into the room: they are DOM over the
// canvas, in a layer that goes away with the editor and is never in a film.

/// Every handle: where it sits, and what dragging it does.
///
/// `at` gives a point in the room — world x and y on the front face, and how
/// far back — and `move` is handed the drag in fractions of the canvas.
const ROOM_HANDLES = [
  // One grip on the picture, for the terrain's length. Everything with a
  // place — the ring, the solid's path, the terrain — has a bead and a move
  // gizmo, and is dragged where it is. The camera is the picture itself.
  {
    key: 'depth', cls: 'rh-depth', tip: 'Reach',
    at: (c) => [roomEdit.geomAt.x, VG_WORLD_H / 2, 1],
    move: (c, d, dx, dy) => {
      c.geom.reach = Math.max(0.2, Math.min(40, d.geom.reach * Math.exp(dy * 3)));
    },
  },
];

/// A quarter to four times the front. Past that the box stops reading as a room
/// — at nothing the back is a point and the walls meet, and far out the taper
/// beats the perspective and the room turns inside out.
/// The solid's path, drawn in the room and grabbed there.
///
/// **This is the third attempt at these controls and the first one in the
/// room.** The first was three sliders; the second was rows of typed X, Y and
/// Z. `docs/ROOM-EDITOR.md` argues against exactly that — *"you edit the room
/// by dragging the room"*, *"there are no inputs"* — and records the same
/// lesson being learned and then undone once before. It was undone again here.
///
/// So the path is a curve in the room with its points on it. Drag one and it
/// moves in its own plane, under the cursor. Hold shift and the same drag moves
/// it in depth instead, which is the one thing a flat pointer cannot say by
/// itself — the dotted line down to the floor is what makes that readable.
