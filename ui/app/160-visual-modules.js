// ─────────────────────────────────────────────────────── the visual modules ──
//
// Two visualisers, and you choose one. Not layers of the same picture — the room
// is a box in perspective and the ridgeline is a stack of lines, and nothing is
// gained by drawing them over each other.
//
// **Each gets its own canvas.** A canvas can only ever have one kind of context:
// once `#visGl` has been given WebGL it can never give a 2D one, so the two
// cannot share an element. One is shown, the other hidden, and each is attached
// the first time it is asked for.
//
// The contract is the one `vgAttach` already had, which is why this is a naming
// job rather than an invention: `push(bands, pairs)`, `frame(f)`, `clear()`.
const VIS_MODULES = [
  { key: 'room', label: 'Room', canvas: 'visGl', attach: (c) => vgAttach(c),
    hint: 'The master bus as a room in perspective. Depth is time.' },
  { key: 'ridge', label: 'Ridgeline', canvas: 'visRidge', attach: (c) => rdgAttach(c),
    hint: 'Stacked lines, each hiding what is behind it. The waveform of the moment, pulled to the middle.' },
  { key: 'room3d', label: 'Surfaces', canvas: 'visRoom3d', attach: (c) => r3Attach(c),
    hint: 'The stacked lines on all five surfaces of a room — floor, ceiling, both walls, and the sleeve itself on the back wall.' },
  { key: 'stage', label: 'Stage', canvas: 'visStage', attach: (c) => stAttach(c),
    hint: 'One room with real light, real air and real particles in it.' },
];

/// The live renderers, one per module, built lazily. A module never opened costs
/// nothing — no context, no buffers, no shaders.
const visLive = {};

function visModuleKey() {
  return VIS_MODULES.some((m) => m.key === roomEdit.module) ? roomEdit.module : 'room';
}

function visModule() {
  return VIS_MODULES.find((m) => m.key === visModuleKey()) || VIS_MODULES[0];
}

/// The canvas the chosen module draws on, with the other one hidden.
function visCanvas() {
  const want = visModule();
  for (const m of VIS_MODULES) {
    const el = $(m.canvas);
    if (el) el.classList.toggle('hidden', m.key !== want.key);
  }
  return $(want.canvas);
}

/// The renderer for the chosen module, attached if it is not yet.
///
/// Null when the machine will not give it a context, which is a fallback rather
/// than an error — the same thing `vgAttach` has always returned.
function visRenderer() {
  const m = visModule();
  const el = $(m.canvas);
  if (!el) return null;
  if (!visLive[m.key]) {
    visLive[m.key] = m.attach(el) || null;
    if (!visLive[m.key]) return null;
    // Settings first, then fill: `clear` builds the stack at the row count and
    // width it has been told about, so it has to be told before it is called.
    if (visLive[m.key].configure) {
      visLive[m.key].configure(m.key === 'room3d' ? room3dSettings()
        : m.key === 'stage' ? stageSettings() : ridgeSettings());
      visLive[m.key].clear();
    }
  }
  return visLive[m.key];
}

/// The picker: everything there is, grouped by what it is looking at.
///
/// **Built from `VIS_ALL`.** The old one listed `VIS_MODULES`, which knew only
/// about the three on the master bus — the eleven grain views were reachable
/// from a different panel in a different workspace, and nothing anywhere listed
/// the fourteen together. See `docs/PORT-PLAN.md`.
/// Which visuals the menu offers, and in what order.
///
/// **Twenty-five entries, and most sessions use four.** The list in
/// `vis-registry.js` says what exists; this says what is *offered*, which is a
/// different question and belongs to whoever is working rather than to the
/// program. Nothing here removes a visual — a hidden one is still in the
/// registry, still reachable from `setVisual`, and still in a saved room; it is
/// simply not in the menu.
///
/// In `localStorage`, not in the room data: which visuals you want to see is a
/// preference that outlives any one document.
const VIS_MENU_STORE = 'audiolab.vismenu.v1';
let visMenuState = null;

function visMenu() {
  if (visMenuState) return visMenuState;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(VIS_MENU_STORE)); } catch { /* blocked */ }
  const all = VIS_ALL.map((v) => v.key);
  const order = Array.isArray(saved?.order) ? saved.order.filter((k) => all.includes(k)) : [];
  // **Anything the registry has gained since this was saved goes on the end**,
  // rather than being silently absent. A new visual that nobody can find because
  // of a stored preference is the same bug as one that was never listed.
  for (const k of all) if (!order.includes(k)) order.push(k);
  const hidden = Array.isArray(saved?.hidden) ? saved.hidden.filter((k) => all.includes(k)) : [];
  visMenuState = { order, hidden };
  return visMenuState;
}

function saveVisMenu() {
  try { localStorage.setItem(VIS_MENU_STORE, JSON.stringify(visMenu())); } catch { /* blocked */ }
}

/// The entries the menu offers, in the order it offers them.
function visMenuList() {
  const m = visMenu();
  return m.order.map((k) => visEntry(k)).filter((v) => v && !m.hidden.includes(v.key));
}

function buildVisModulePicker() {
  const box = $('rgModules');
  if (!box) return;
  // Rebuilt rather than left alone: the menu is editable now, so "it already
  // exists" is not a reason to keep whatever it last said.
  box.innerHTML = '';
  // **A menu, not a row of buttons.** Three fitted along the stage bar; fourteen
  // do not, and the first version of this put a full-width family heading in a
  // bar one line tall — everything after it wrapped out of sight and the picker
  // looked empty. A bar is a bar: what goes in it has to be one line at any
  // width, and a menu is one line however long the list gets.
  const sel = rpEl('select', 'field mini vis-pick-sel');
  sel.id = 'rgVisual';
  sel.title = 'Which visualiser is on the stage.';
  fillVisPicker(sel);
  sel.onchange = () => setVisual(sel.value);
  box.appendChild(sel);
  // The Compose picture bar reads the same menu, and refills its copy itself.
  if (typeof composeVisPickerBuilt === 'function') composeVisPickerBuilt();
  paintVisModulePicker();
}

/// Fill a visuals picker from the menu.
function fillVisPicker(sel) {
  if (!sel) return;
  sel.innerHTML = '';
  // Grouped by family, but in the order the menu was put in — so a family with
  // everything hidden leaves no empty heading behind, and a reordered menu is
  // read in the order it was arranged.
  const shown = visMenuList();
  for (const fam of VIS_FAMILIES) {
    const mine = shown.filter((v) => v.family === fam.key);
    if (!mine.length) continue;
    const group = document.createElement('optgroup');
    group.label = fam.label;
    for (const v of mine) {
      const o = document.createElement('option');
      o.value = v.key;
      // The state of the port, readable off the interface rather than out of a
      // document: a visual that cannot be filmed yet says so here.
      o.textContent = v.films ? v.label : `${v.label} ·`;
      o.title = `${v.hint}\n\n${v.engine}${v.films ? ' · films' : ' · does not film yet'}`;
      group.appendChild(o);
    }
    sel.appendChild(group);
  }
}

function paintVisModulePicker() {
  const sel = $('rgVisual');
  if (sel) paintVisPicker(sel);
  // The Compose picture bar's copy, told the same thing.
  if (typeof composeVisPickerPainted === 'function') composeVisPickerPainted();
}

/// One picker, told what is showing.
function paintVisPicker(sel) {
  const on = visualKey();
  // **A hidden visual that is showing stays in the menu.** Otherwise the menu
  // says one thing and the stage says another, and there is no way back to what
  // you are looking at.
  if (on && !sel.querySelector(`option[value="${on}"]`)) {
    const v = visEntry(on);
    if (v) {
      const o = document.createElement('option');
      o.value = v.key;
      o.textContent = `${v.label} · hidden`;
      sel.appendChild(o);
    }
  }
  if (sel.value !== on) sel.value = on;
}

/// The menu's own admin: what is offered, and in what order.
///
/// Anchored under the gear in the edit bar rather than floated over the middle
/// of the screen — it edits the menu you are about to use, and a box that covers
/// the thing it is about is a box you have to close to check your work.
function buildVisMenuAdmin() {
  const host = $('visMenuAdmin');
  if (!host) return;
  const m = visMenu();
  host.innerHTML = '';

  const head = rpEl('div', 'vma-head');
  head.appendChild(rpEl('span', 're-tag', 'MENU'));
  const all = rpEl('button', 're-btn', 'Show all');
  all.title = 'Put every visual back in the menu. Nothing was ever removed — only unlisted.';
  all.onclick = () => { m.hidden.length = 0; saveVisMenu(); buildVisMenuAdmin(); buildVisModulePicker(); };
  const reset = rpEl('button', 're-btn', 'Default order');
  reset.title = 'Back to the order the registry lists them in.';
  reset.onclick = () => {
    m.order = VIS_ALL.map((v) => v.key);
    saveVisMenu(); buildVisMenuAdmin(); buildVisModulePicker();
  };
  head.appendChild(all);
  head.appendChild(reset);
  host.appendChild(head);

  // **Grouped, because the menu is grouped.** The picker draws its families as
  // headings and always will — twenty-five names in one flat list is the thing
  // the families are there to prevent — so an order that crossed a family
  // boundary is an order the menu cannot show. Moving a row past the end of its
  // family did nothing at all and gave no reason, which is worse than not
  // offering it. So the admin groups the same way, and up and down move within
  // the family, which is exactly what the menu can express.
  const list = rpEl('div', 'vma-list');
  for (const fam of VIS_FAMILIES) {
    const mine = m.order.filter((k) => (visEntry(k) || {}).family === fam.key);
    if (!mine.length) continue;
    const head = rpEl('div', 'vma-fam-head', fam.label);
    head.title = fam.hint;
    list.appendChild(head);

    mine.forEach((key, n) => {
      const v = visEntry(key);
      const off = m.hidden.includes(key);
      const row = rpEl('div', 'vma-row');
      row.classList.toggle('vma-off', off);

      // Shown or not. An eye rather than a checkbox: the question is whether you
      // can see it, and the answer should look like the question.
      const eye = rpEl('button', 'vma-eye', off ? '\u25CB' : '\u25CF');
      eye.title = off ? 'Hidden. Click to put it back in the menu.' : 'In the menu. Click to hide it.';
      eye.onclick = () => {
        if (off) m.hidden.splice(m.hidden.indexOf(key), 1); else m.hidden.push(key);
        saveVisMenu(); buildVisMenuAdmin(); buildVisModulePicker(); paintVisModulePicker();
      };
      row.appendChild(eye);

      const name = rpEl('span', 'vma-name', v.label);
      name.title = v.hint;
      row.appendChild(name);

      // Swap with its neighbour *in this family*, wherever the two of them
      // happen to sit in the whole list.
      const swap = (with_) => {
        const a = m.order.indexOf(key);
        const b = m.order.indexOf(mine[with_]);
        if (a < 0 || b < 0) return;
        m.order[a] = mine[with_];
        m.order[b] = key;
        saveVisMenu(); buildVisMenuAdmin(); buildVisModulePicker();
      };
      const up = rpEl('button', 'vma-move', '\u2191');
      up.title = 'Move it up the menu.';
      up.disabled = n === 0;
      up.onclick = () => swap(n - 1);
      const down = rpEl('button', 'vma-move', '\u2193');
      down.title = 'Move it down the menu.';
      down.disabled = n === mine.length - 1;
      down.onclick = () => swap(n + 1);
      row.appendChild(up);
      row.appendChild(down);
      list.appendChild(row);
    });
  }
  host.appendChild(list);

  const foot = rpEl('div', 'vma-foot');
  foot.textContent = `${m.order.length - m.hidden.length} of ${m.order.length} in the menu. Hiding one does not remove it.`;
  host.appendChild(foot);
}

function toggleVisMenuAdmin(show) {
  const host = $('visMenuAdmin');
  const btn = $('visMenuBtn');
  if (!host) return;
  const on = show === undefined ? host.classList.contains('hidden') : show;
  if (on) buildVisMenuAdmin();
  host.classList.toggle('hidden', !on);
  if (btn) btn.classList.toggle('active', on);
}

/// Which visual is on screen, as the registry knows it.
function visualKey() {
  const v = visEntry(roomEdit.visual);
  if (v) return v.key;
  // Nothing chosen, or a key stored before this list existed: fall back to
  // whichever bus module was remembered, which used to be the whole question.
  return visModuleKey();
}

/// Show one visual, whichever family it belongs to.
///
/// **The one way in.** `setVisModule` still exists and still does the right
/// thing for the three on the master bus, but it cannot reach the grain views —
/// they are in another element and, for now, another document. This is what the
/// interface calls; it works out which host belongs on the stage and puts it
/// there.
function setVisual(key) {
  const v = visEntry(key) || VIS_ALL[0];
  roomEdit.visual = v.key;
  // **An arrangement is the stage with its cloud laid out differently.** The ten
  // grain views used to be ten drawings in another document; now choosing one
  // sets the stage's layout and shows the stage. See `ST_LAYOUTS`.
  if (visIsStage(v)) {
    // **Ink for an arrangement, solids for the room.** The ten views are drawn
    // as strokes, additive on black, which is what they are; the stage's own
    // cloud is a lit solid standing in the fog, which is what *it* is. One
    // renderer serving both would take one of the two pictures away, and the
    // rule on this work is that nothing is taken away.
    if (v.layout) {
      roomEdit.stage = { ...stageSettings(), cloudLayout: v.layout, cloudInk: true };
    } else {
      roomEdit.stage = { ...stageSettings(), cloudInk: false };
    }
    // The room and the views in it are framed differently — see `frameStageView`.
    frameStageView();
    saveRoomData();
    showStageFamily('bus');
    setVisModule('stage');
    const r = visLive.stage;
    if (r && r.configure) r.configure(stageSettings());
    paintStagePanel();
    paintVisModulePicker();
    return;
  }
  saveRoomData();
  showStageFamily(v.family);
  if (v.family === 'bus') {
    setVisModule(v.key);
  } else {
    if (typeof setGrainSuite === 'function' && v.suite) setGrainSuite(v.suite);
    if (typeof setGrainView === 'function') setGrainView(v.view);
  }
  paintVisModulePicker();
}

/// Put the right host on the room's stage.
///
/// The two families live in two elements — `masterBus` and `grainVis` — and only
/// one can be on the stage at a time. Borrowed with `roomAdopt`, so each goes
/// home to the exact place it came from: the same machinery the workspace has
/// always used for the bus.
function showStageFamily(family) {
  const view = $('roomView');
  if (!view || view.classList.contains('hidden')) return;
  // **Decided by host, not by family.** More than one family can live in the
  // same element — the stage arrangements are their own family and share
  // `masterBus` with the bus visuals — and walking the families sending home
  // "the ones that are not this one" then sends the wanted host home again on a
  // later turn of the loop. Every visual came out with nothing on the stage.
  const want = (VIS_FAMILIES.find((f) => f.key === family) || {}).host;
  const hosts = [...new Set(VIS_FAMILIES.map((f) => f.host))];
  for (const host of hosts) {
    const el = $(host);
    if (!el) continue;
    if (host === want) {
      roomAdopt(host, 'roomStageRoom');
      visUnhide(el);
    } else if (el.parentElement && el.parentElement.id === 'roomStageRoom') {
      // Sent home rather than hidden in place: left on the stage it keeps its
      // box, and the next thing adopted stacks underneath it.
      const home = roomBorrowed.get(host);
      if (home && home.parent) home.parent.insertBefore(el, home.next);
      roomBorrowed.delete(host);
      visRehide(el);
    }
  }
}

/// `hidden`, taken off and put back exactly.
///
/// **The class is load-bearing somewhere else.** `#grainVis` ships hidden, and
/// the dock's stylesheet reads that:
///
///     .tray-right > .grain-vis.hidden + .master-bus { flex: 1 1 auto; }
///
/// — the master bus is only given its size *while the grain views are hidden*.
/// Borrowing the grain views onto the room's stage and stripping `hidden` to
/// show them therefore resizes something in a workspace you are not even
/// looking at, and leaves it resized, because nothing ever put the class back.
/// The visual panel in the editor collapsed and stayed collapsed.
///
/// So it is restored rather than assumed: what was hidden goes back to hidden
/// when it goes home. A class that only says "not on screen" is safe to toggle;
/// this one is also a selector somebody else depends on, and there is no way to
/// tell which from the name.
const VIS_WAS_HIDDEN = new WeakSet();

function visUnhide(el) {
  if (el.classList.contains('hidden')) {
    VIS_WAS_HIDDEN.add(el);
    el.classList.remove('hidden');
  }
}

function visRehide(el) {
  if (VIS_WAS_HIDDEN.has(el)) {
    el.classList.add('hidden');
    VIS_WAS_HIDDEN.delete(el);
  }
}

/// Switch module. The sound keeps arriving either way — `mbTick` pushes at the
/// meter's rate to whichever is chosen, so the one you switch to fills up from
/// the moment you arrive rather than showing you the last four seconds of
/// something you were not watching.
function setVisModule(key) {
  roomEdit.module = VIS_MODULES.some((m) => m.key === key) ? key : 'room';
  saveRoomData();
  visCanvas();
  buildRidgePanel();
  paintRidgePanel();
  // Each module's own panel, and only its own. Written as "is this the module"
  // rather than "is this the ridgeline", because there are three now and the
  // next one added should not have to find this line.
  const shown = visModuleKey();
  $('roomEdit')?.classList.toggle('hidden', shown !== 'room' || !roomEdit.on);
  $('ridgeEdit')?.classList.toggle('hidden', shown !== 'ridge' || !roomEdit.on);
  $('room3dEdit')?.classList.toggle('hidden', shown !== 'room3d' || !roomEdit.on);
  $('stageEdit')?.classList.toggle('hidden', shown !== 'stage' || !roomEdit.on);
  // Under both modules, unlike the two above: the card is the room's, not
  // either visualiser's. Hidden with them, though — everything in here is a
  // control, and controls are not part of the picture.
  $('textEdit')?.classList.toggle('hidden', !roomTextPanelOn());
  applyRoomFrame();
  paintVisModulePicker();
}

