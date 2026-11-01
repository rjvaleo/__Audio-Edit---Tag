// ───────────────────────────────────────────────────── the room, at full size ──
//
// A third workspace beside Browse and Edit: the room as big as the window will
// give it, with every control it has laid out beside it instead of floating in
// the corner of a canvas the size of a postcard.
//
// **Built by moving, not by copying.** The room, its controls, the transport
// and the video button are the elements the dock already owns. This view
// borrows them and hands them back. There is no second canvas, no second panel
// and no second set of handlers, so there is nothing here that can fall out of
// step with the dock's version of the same thing.
//
// That is not tidiness. This program has shipped that exact fault twice: the
// live room and the exported film kept their own background colour and drifted
// (`--sink` against `--bg`), and the theme editor rebuilt its swatches from
// scratch under the colour panel that was using them. A control that exists
// once cannot disagree with itself.

/// Where a borrowed element came from, so it can be put back exactly.
///
/// The parent on its own is not enough. An element appended back to its old
/// parent has still moved — it lands at the end — and `#transportBar` returning
/// *after* the dock instead of before it is a different page. The next sibling
/// is what actually pins the place.
const roomBorrowed = new Map();

function roomAdopt(id, hostId) {
  const el = $(id), host = $(hostId);
  if (!el || !host || el.parentNode === host) return;
  if (!roomBorrowed.has(id)) {
    roomBorrowed.set(id, { parent: el.parentNode, next: el.nextSibling });
  }
  host.appendChild(el);
}

function roomReleaseAll() {
  for (const [id, home] of roomBorrowed) {
    const el = $(id);
    if (el && home.parent) home.parent.insertBefore(el, home.next);
  }
  roomBorrowed.clear();
}

/// What the full view borrows, and where each piece goes.
///
/// The frame selector is taken out of the control list and put over the room:
/// the frame shape is a question about the picture being composed, so it
/// belongs above the picture rather than at the bottom of a column of settings.
/// Whether the card's controls are offered in the room's admin at all.
///
/// **Off, and the panel is not deleted.** Everything the card is — `rtDraw`,
/// `RT_UI`, the grips, the settings, the export path, `docs/ROOM-TEXT.md` — is
/// still here and still works; it is simply not listed. One `true` puts the
/// whole panel back exactly as it was.
const ROOM_TEXT_IN_ADMIN = false;

// **Declared here, above the list that reads it.** A `const` is not hoisted into
// scope the way a function is: written below the array literal it lands in the
// temporal dead zone, `app.js` throws while it is still loading, and *nothing*
// works — no folders, no modules, a blank interface and a stack trace about a
// flag that reads as unrelated.

const ROOM_VIEW_PARTS = [
  ['masterBus', 'roomStageRoom'],
  ['roomEdit', 'roomAdminBody'],
  // The other module's panel, borrowed the same way. Only one is ever
  // shown; both travel so switching module inside the workspace works.
  ['ridgeEdit', 'roomAdminBody'],
  ['room3dEdit', 'roomAdminBody'],
  ['stageEdit', 'roomAdminBody'],
  // **The card's panel, which must travel too.** It lives inside `masterBus`
  // with the other two, and `masterBus` is itself borrowed into the room stage —
  // so a panel that is not taken out of it first is carried *into the picture*
  // and drawn over the visualiser. That is exactly what it did: a block of
  // controls sitting on top of the room, in the dock and in the full view both.
  // Borrowed only while `ROOM_TEXT_IN_ADMIN` is on — see `roomTextPanelOn`. The
  // pair stays written down so the panel travels correctly the moment it is put
  // back, rather than being rediscovered as the bug it was.
  ...(ROOM_TEXT_IN_ADMIN ? [['textEdit', 'roomAdminBody']] : []),
  // **The sound the room is drawing.** This workspace hides the dock, and the
  // stretch and grain controls live in it — so without borrowing them there is
  // no way to change the sound from here at all. That shipped: the controls
  // were not broken, they were simply not on screen, and an export then
  // rendered whatever the document had last been given in the editor.
  ['grainControls', 'roomSoundBody'],
  ['reFrameRow', 'roomStageBar'],
  ['transportBar', 'roomFoot'],
  ['videoBtn', 'roomFoot'],
  // The gear travels with the button it sits beside, and its panel with the
  // gear — anchored, not floated, so it opens where you pressed.
  ['visMenuBtn', 'roomFoot'],
  ['visMenuAdmin', 'roomFoot'],
];

function enterRoomView() {
  // The controls are the whole point of this view, so they are open here
  // whether or not the dock's overlay had been opened. Leaving `roomEdit.on`
  // false would give a full-screen room and an empty panel beside it.
  roomEdit.on = true;
  buildRoomLayers();
  buildRoomStreams();
  buildRoomChunks();
  buildRoomFrames();
  $('masterBus')?.classList.add('room-editing');
  $('roomEditOpen')?.classList.add('on');

  for (const [id, host] of ROOM_VIEW_PARTS) roomAdopt(id, host);
  // The transport is hidden by mode and this is a mode that wants it.
  $('transportBar')?.classList.remove('hidden');
  $('videoBtn')?.classList.remove('hidden');
  $('visMenuBtn')?.classList.remove('hidden');
  $('roomView')?.classList.remove('hidden');

  setRoomAdminWidth(roomAdminWidth(), { save: false });
  buildVisModulePicker();
  buildRidgePanel();
  buildRoom3dPanel();
  buildStagePanel();
  buildRoomTextPanel();
  $('textEdit')?.classList.toggle('hidden', !roomTextPanelOn());
  setVisModule(roomEdit.module);
  rgPanel();
  rpPanel();
  applyRoomPaintCss();
  applyRoomFrame();
  paintRoomNums();
  paintRoomData();
  paintSolidPath();
}

/// The two tabs. The controls and the palette are both long enough to need the
/// whole column, and stacking them puts everything below the fold behind a
/// scroll past something unrelated.
function wireRoomTabs() {
  for (const b of document.querySelectorAll('#roomAdmin .rv-tab')) {
    b.onclick = () => {
      const want = b.dataset.rvtab;
      for (const o of document.querySelectorAll('#roomAdmin .rv-tab')) {
        o.classList.toggle('active', o === b);
        o.setAttribute('aria-selected', String(o === b));   // C5
      }
      $('roomAdminBody')?.classList.toggle('hidden', want !== 'controls');
      $('roomSoundBody')?.classList.toggle('hidden', want !== 'sound');
      $('roomGeomBody')?.classList.toggle('hidden', want !== 'geom');
      $('roomPaintBody')?.classList.toggle('hidden', want !== 'paint');
      $('room4dBody')?.classList.toggle('hidden', want !== 'dim4');
      if (want === 'paint') rpPanel();
      if (want === 'geom') rgPanel();
      if (want === 'dim4') p4Panel();
    };
  }
}
wireRoomTabs();

// What was being used last time. Before the first frame, so the room is never
// drawn once in the theme's colours and then again in the palette's.
rpRestore();

// ───────────────────────────────────────────────── presets for one section ──
//
// The preset row holds the document: every engine at once, on the server, with
// the sound it was made on if asked. These are narrower on purpose. A *look* is
// everything the room is — layers, hierarchy, cameras, palette, the solid and
// its path, every slider on every module — and none of the sound. A *cloud* is
// the grain section and none of the look. Each is put back without touching
// the other, which is what a preset for a section is for. The store is
// `ui/section-presets.js`; see `docs/SECTION-PRESETS.md`.

/// Everything the room is, as one object.
function visualSnapshot() {
  return {
    room: roomDataSnapshot(),
    layers: { ...roomEdit.layers },
    order: roomOrder(),
    occlude: { ...roomEdit.occlude },
    streams: roomEdit.streams ? { ...roomEdit.streams } : null,
    cams: JSON.parse(JSON.stringify(roomEdit.cams || {})),
    paint: {
      name: roomPaint.scheme.name || '',
      slots: JSON.parse(JSON.stringify(roomPaint.scheme.slots || {})),
    },
  };
}

/// Every slider in the room's panel, the field it moves, and the scale the
/// element counts in. They are built once by `buildRoomChunks` and left alone
/// after, so a value that changes under them — a recalled look — has to be
/// pushed in.
const ROOM_SLIDERS = [
  ['reRing', 'ringScale', 100], ['reRingDrive', 'ringDrive', 100],
  ['reRingEdge', 'ringEdge', 1000], ['reRingPoints', 'ringPoints', 1],
  ['reFogDensity', 'fogDensity', 100],
  ['reMistAmount', 'mistAmount', 100], ['reMistLength', 'mistLength', 1000],
  ['reSolidSpin', 'solidSpin', 100], ['reSolidSwell', 'solidSwell', 100],
  ['reSolidEye', 'solidEye', 100], ['reSolidSize', 'solidSize', 100],
  ['reGrainDensity', 'grainDensity', 100], ['reGrainBright', 'grainBright', 100],
  ['reOpacity', 'opacity', 100],
];

function syncRoomSliders() {
  for (const [id, key, k] of ROOM_SLIDERS) {
    const el = $(id);
    if (el && typeof roomEdit[key] === 'number') el.value = String(Math.round(roomEdit[key] * k));
  }
  const shape = $('reSolidShape');
  if (shape && shape.options.length) shape.value = roomEdit.solidShape;
  const fogType = $('reFogType');
  if (fogType) fogType.value = String(roomEdit.fogType);
  const fogCol = $('reFogColour');
  if (fogCol) fogCol.value = roomEdit.fogColour;
  const fillCol = $('reGrainFillColour');
  if (fillCol) fillCol.value = roomEdit.grainFillColour;
}

