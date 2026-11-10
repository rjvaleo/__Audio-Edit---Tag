// ───────────────────────────────────────────────────────── the classic view ──
//
// The tab as it was before the design pass, unchanged but for the names. Picked
// with the VIEW switch at the top of the tab; see `rpViewRow`.

function rpHeadRowClassic() {
  const box = rpEl('div', 'rp-head');

  // ── the scheme ──
  const nameRow = rpEl('div', 'rp-row');
  nameRow.appendChild(rpEl('span', 're-tag', 'SCHEME'));
  const name = rpEl('input', 'field rp-name');
  name.value = roomPaint.scheme.name || '';
  name.placeholder = 'name…';
  name.oninput = () => { roomPaint.scheme.name = name.value; };
  nameRow.appendChild(name);
  box.appendChild(nameRow);

  const btns = rpEl('div', 'rp-row rp-btns');
  const save = rpEl('button', 're-btn', 'Save');
  save.title = 'Keep this palette under its name. Saving over a name replaces it.';
  save.onclick = () => {
    if (rpSave(name.value)) { toast(`Saved “${name.value.trim()}”`); rpPanel(); }
    else toast('Give it a name first');
  };
  btns.appendChild(save);

  const load = rpEl('select', 'field rp-load');
  const saved = rpSaved();
  const names = Object.keys(saved).sort();
  load.appendChild(new Option(names.length ? 'Load…' : 'nothing saved', ''));
  for (const n of names) load.appendChild(new Option(n, n));
  load.onchange = () => {
    if (load.value && rpLoad(load.value)) { rpApply(); rpPanel(); }
  };
  btns.appendChild(load);

  const del = rpEl('button', 're-btn', 'Delete');
  del.title = 'Remove the palette currently named above from the saved list.';
  del.onclick = () => {
    const n = (name.value || '').trim();
    if (n && rpDelete(n)) { toast(`Deleted “${n}”`); rpPanel(); }
  };
  btns.appendChild(del);
  box.appendChild(btns);

  // ── the generators ──
  const genTag = rpEl('div', 'rp-row');
  genTag.appendChild(rpEl('span', 're-tag', 'GENERATE'));
  box.appendChild(genTag);

  const gens = rpEl('div', 'rp-row rp-gens');
  for (const g of RP_GENERATORS) {
    const b = rpEl('button', 're-btn', g.label);
    b.title = `Paint every object at once. Click again for another ${g.label.toLowerCase()}.`;
    // What it makes, before it is pressed.
    if (typeof cpGenStrip === 'function') b.prepend(cpGenStrip(g.key));
    b.onclick = () => {
      roomPaint.scheme = rpGenerate(g.key);
      rpTouch(); rpRemember(); rpApply(); rpPanel();
    };
    gens.appendChild(b);
  }
  box.appendChild(gens);

  const foot = rpEl('div', 'rp-row rp-btns');
  const reset = rpEl('button', 're-btn', 'Back to theme');
  reset.title = 'Drop every override. The room goes back to the three colours the theme gives it.';
  reset.onclick = () => {
    roomPaint.scheme = rpDefaultScheme();
    rpTouch(); rpRemember(); rpApply(); rpPanel();
  };
  foot.appendChild(reset);
  box.appendChild(foot);
  return box;
}

function rpSlotRowClassic(s) {
  const wrap = rpEl('div', 'rp-slot');
  const head = rpEl('button', 'rp-slot-head');
  head.title = s.hint || '';
  const cfg = rpSlot(s.key);

  const strip = rpEl('span', 'rp-strip');
  strip.style.background = rpGradientCss(s.key);
  head.appendChild(strip);
  head.appendChild(rpEl('span', 'rp-slot-name', s.label));
  // What it is set to, in a word — so a scheme can be read down the list
  // without opening fourteen editors.
  const mode = cfg.mode === 'inherit' ? 'theme' : cfg.mode === 'flat' ? 'flat'
    : (RP_DRIVES[cfg.drive | 0] || RP_DRIVES[0]).label.toLowerCase();
  head.appendChild(rpEl('span', 'rp-slot-mode', mode));
  head.onclick = () => { rpOpen = rpOpen === s.key ? null : s.key; rpPanel(); };
  wrap.appendChild(head);

  if (rpOpen === s.key) wrap.appendChild(rpSlotEditorClassic(s));
  return wrap;
}

function rpSlotEditorClassic(s) {
  const box = rpEl('div', 'rp-edit');
  const cfg = rpSlot(s.key);

  // ── the mode ──
  const modes = rpEl('div', 'rp-row');
  // The background is one colour by definition: the room adds light to it, and
  // a ground that varied per fragment is not a ground.
  const choices = s.flat
    ? [['inherit', 'Theme'], ['flat', 'Colour']]
    : [['inherit', 'Theme'], ['flat', 'Colour'], ['ramp', 'Ramp']];
  for (const [key, label] of choices) {
    const b = rpEl('button', 're-btn' + (cfg.mode === key ? ' active' : ''), label);
    b.title = key === 'inherit'
      ? 'Leave it to the theme. Nothing about this object is sent to the renderer at all, so it draws exactly as it always has.'
      : key === 'flat' ? 'One colour, whatever the sound is doing.'
        : 'A gradient, read against a quantity of your choosing.';
    b.onclick = () => {
      const patch = { mode: key };
      // Starting from what it is already drawn with, so switching mode changes
      // nothing until something else is moved.
      if (key === 'flat' && !cfg.colour) patch.colour = rpInheritedPair(s.key)[1];
      if (key === 'ramp' && !cfg.stops) patch.stops = rpStops(s.key);
      if (key === 'ramp' && cfg.lo == null && cfg.hi == null) Object.assign(patch, rpStartRange(s.key, cfg.drive));
      rpSetSlot(s.key, patch); rpApply(); rpPanel();
    };
    modes.appendChild(b);
  }
  box.appendChild(modes);

  if (cfg.mode === 'flat') {
    const row = rpEl('div', 'rp-row');
    row.appendChild(rpEl('span', 're-tag', 'COLOUR'));
    const well = rpEl('input', 're-colour');
    well.type = 'color';
    well.value = cfg.colour || rpInheritedPair(s.key)[1];
    // Updated in place, never rebuilt: see the note at the top of `rpPanel`.
    well.oninput = () => {
      rpSetSlot(s.key, { colour: well.value });
      rpApply();
      const strip = box.parentElement.querySelector('.rp-strip');
      if (strip) strip.style.background = well.value;
    };
    row.appendChild(well);
    box.appendChild(row);
  }

  if (cfg.mode === 'ramp') {
    box.appendChild(rpStopsEditorClassic(s));
    box.appendChild(rpDriveRowClassic(s));
    box.appendChild(rpRangeRowClassic(s));
  }
  return box;
}

function rpStopsEditorClassic(s) {
  const box = rpEl('div', 'rp-stops');
  // **One list, shared by every control in the editor, and written in place.**
  // Each handler used to rebuild the stops from a copy taken when the editor
  // opened, so the second stop you touched put the first one back to what it
  // was — the well still showed the colour you picked, the strip and the room
  // did not. Sorted once, here: the rows are built in this order and each
  // handler addresses its own row by index, so the order must not move under
  // them while the editor is open. A stop dragged past its neighbour is sorted
  // on the next rebuild.
  const live = [...rpStops(s.key)].sort((a, b) => a.at - b.at);
  const push = () => {
    rpSetSlot(s.key, { stops: live.map((x) => ({ ...x })) });
    rpApply();
    const strip = box.closest('.rp-slot')?.querySelector('.rp-strip');
    if (strip) strip.style.background = rpGradientCss(s.key);
  };

  const tag = rpEl('div', 'rp-row');
  tag.appendChild(rpEl('span', 're-tag', 'STOPS'));
  const add = rpEl('button', 're-btn', '+');
  add.title = 'Another colour in the gradient, dropped in the largest gap.';
  add.onclick = () => {
    // Into the widest gap rather than at the end: a stop added at 1.0 lands on
    // top of the one already there and appears to do nothing.
    let bestAt = 0.5, best = -1;
    for (let i = 0; i < live.length - 1; i++) {
      const gap = live[i + 1].at - live[i].at;
      if (gap > best) { best = gap; bestAt = (live[i].at + live[i + 1].at) / 2; }
    }
    live.push({ at: bestAt, c: '#ffffff' });
    push(); rpPanel();
  };
  tag.appendChild(add);
  box.appendChild(tag);

  live.forEach((st, i) => {
    const row = rpEl('div', 'rp-row rp-stop');
    const well = rpEl('input', 're-colour');
    well.type = 'color';
    well.value = st.c;
    well.oninput = () => { live[i] = { ...live[i], c: well.value }; push(); };
    row.appendChild(well);

    const at = rpEl('input', 're-slider');
    at.type = 'range'; at.min = '0'; at.max = '100'; at.step = '1';
    at.value = String(Math.round(st.at * 100));
    at.title = 'Where in the gradient this colour sits.';
    at.oninput = () => { live[i] = { ...live[i], at: +at.value / 100 }; push(); };
    row.appendChild(at);

    if (live.length > 2) {
      const del = rpEl('button', 're-btn', '−');
      del.title = 'Take this colour out. Two is the fewest a gradient can have.';
      del.onclick = () => {
        live.splice(i, 1);
        push(); rpPanel();
      };
      row.appendChild(del);
    }
    box.appendChild(row);
  });
  return box;
}

function rpDriveRowClassic(s) {
  const cfg = rpSlot(s.key);
  const row = rpEl('div', 'rp-row');
  row.appendChild(rpEl('span', 're-tag', 'READ AGAINST'));
  const sel = rpEl('select', 'field');
  RP_DRIVES.forEach((d, i) => {
    // A layer with nothing of its own to offer does not get the option. The
    // attribute is nought there, so the ramp would collapse to its first colour
    // and read as the control being broken.
    if (d.key === 'own' && !s.own) return;
    const label = d.key === 'own' ? rpOwnLabel(s.key) : d.label;
    const o = new Option(label, String(i));
    o.title = d.hint;
    sel.appendChild(o);
  });
  sel.value = String(cfg.drive | 0);
  sel.onchange = () => { rpSetSlot(s.key, { drive: +sel.value }); rpApply(); rpPanel(); };
  row.appendChild(sel);
  return row;
}

function rpRangeRowClassic(s) {
  const cfg = rpSlot(s.key);
  const box = rpEl('div', 'rp-range');
  const mk = (label, key, def, hint) => {
    const row = rpEl('div', 'rp-row');
    row.appendChild(rpEl('span', 're-tag', label));
    const sl = rpEl('input', 're-slider');
    sl.type = 'range'; sl.min = '0'; sl.max = '100'; sl.step = '1';
    sl.value = String(Math.round((cfg[key] ?? def) * 100));
    sl.title = hint;
    sl.oninput = () => { rpSetSlot(s.key, { [key]: +sl.value / 100 }); rpApply(); };
    row.appendChild(sl);
    return row;
  };
  box.appendChild(mk('FROM', 'lo', 0,
    'Where the gradient starts. Anything below this takes the first colour.'));
  box.appendChild(mk('TO', 'hi', 1,
    'Where it ends. Bring this down and the whole gradient is spent on the quiet part.'));

  const row = rpEl('div', 'rp-row');
  row.appendChild(rpEl('span', 're-tag', 'CURVE'));
  const sl = rpEl('input', 're-slider');
  sl.type = 'range'; sl.min = '20'; sl.max = '400'; sl.step = '1';
  sl.value = String(Math.round((cfg.curve ?? 1) * 100));
  sl.title = 'How the gradient is spent across that range. Left of the middle '
    + 'favours the top end, right of it favours the bottom. Level is '
    + 'perceptual, so a straight ramp spends most of itself on quiet.';
  sl.oninput = () => { rpSetSlot(s.key, { curve: +sl.value / 100 }); rpApply(); };
  row.appendChild(sl);
  box.appendChild(row);
  return box;
}

/// Everything a change has to reach. The renderer picks the atlas up on its own
/// next frame; the two CSS slots have to be written to the page.
function rpApply() {
  rpRemember();
  if (typeof applyRoomPaintCss === 'function') applyRoomPaintCss();
}

// ────────────────────────────────────────────────────── the room's own shape ──
//
// **The shape, not the pose.** Where you stand in the room is dragged on the
// room itself and always has been — `docs/ROOM-EDITOR.md` makes the argument at
// length, and it is a good one: `floorY = -0.38` against `ceilY = 0.62` is not
// a number anybody can picture, and a field with it in puts a spreadsheet
// between you and the box. Nothing in here is a camera field.
//
// What is in here is the geometry that had no control of any kind: how finely
// the floor is resolved, how far back the trail runs before it reaches the
// wall, how tall the terrain stands, how many seconds of sound the depth stands
// for, and how big a grain is drawn. Every one was a constant in `vis-gl.js`.

const RG_ROWS = [
  { key: 'geomBands', tag: 'FLOOR', min: 8, max: 1024, step: 1, round: true,
    unit: ' bands',
    hint: 'How finely the spectrum is resolved across the floor. **Changing it '
      + 'empties the trail** — every frame already in the air is a row of the '
      + 'old width, and a surface built from a mix of the two would be read off '
      + 'the end of the short ones.' },
  { key: 'geomHistory', tag: 'TRAIL', min: 2, max: 240, step: 1, round: true,
    unit: ' frames',
    hint: 'How far back the terrain runs before it reaches the wall, in frames '
      + 'of spectrum. At the meter’s rate the default is about three '
      + 'seconds of sound standing in the room at once.' },
  { key: 'geomRidge', tag: 'RIDGE', min: 0.02, max: 1.6, step: 0.01,
    hint: 'How tall the terrain stands, as a fraction of the room’s height. '
      + 'Full height leaves nothing above it for the ring to hang in.' },
  { key: 'geomSpan', tag: 'SPAN', min: 0.5, max: 90, step: 0.5, unit: ' s',
    hint: 'How many seconds of sound the room’s depth stands for. Depth is '
      + 'time here, so this is the scale of that axis: shorter and the cloud '
      + 'crosses the room quickly, longer and it hangs.' },
  { key: 'geomBody', tag: 'GRAIN', min: 0.002, max: 0.3, step: 0.001,
    hint: 'How big a grain is drawn, against the room’s height rather than '
      + 'the frame’s width — a grain that swelled when the panel was '
      + 'widened would be describing the panel and not the sound.' },
  { key: 'geomWidth', tag: 'WIDTH', min: 0.2, max: 40, step: 0.05, unit: ' u',
    hint: 'How wide the terrain is, in the world\'s units. A size in the world, not a '
      + 'property of the camera: stand closer and it is bigger, further and it is '
      + 'smaller, and that is all.' },
  { key: 'geomReach', tag: 'REACH', min: 0.2, max: 40, step: 0.05, unit: ' u',
    hint: 'How long the terrain is, in the world\'s units — how far back the trail '
      + 'and the cloud run from its front edge. The front edge itself is dragged on '
      + 'the picture, by its bead on the ground.' },
];

const RG_DEFAULTS = {
  geomBands: 280, geomHistory: 56, geomRidge: 0.62, geomSpan: 14, geomBody: 0.032,
  geomWidth: 1.78, geomReach: 1.9,
};

function rgFormat(row, v) {
  const n = row.round ? String(Math.round(v)) : v.toFixed(row.step < 0.01 ? 3 : 2);
  return n + (row.unit || '');
}

function rgPanel() {
  const host = document.getElementById('roomGeomBody');
  if (!host) return;
  // Not while a slider is being dragged: rebuilding the element under the
  // pointer drops the drag, which is the same fault the palette's colour wells
  // had and the theme editor's before them.
  if (document.activeElement && host.contains(document.activeElement)) return;

  host.innerHTML = '';
  const note = rpEl('div', 'rg-note');
  note.textContent = 'Where you stand is dragged on the room itself. This is '
    + 'what the room is.';
  host.appendChild(note);

  for (const row of RG_ROWS) {
    const box = rpEl('div', 'rp-row');
    const tag = rpEl('span', 're-tag', row.tag);
    tag.title = row.hint.replace(/\*\*/g, '');
    box.appendChild(tag);

    const sl = rpEl('input', 're-slider');
    sl.type = 'range';
    // Sliders count in whole steps, so a value that is a fraction is scaled up
    // and back down rather than handed over as a decimal the control rounds.
    const k = row.round ? 1 : 1000;
    sl.min = String(Math.round(row.min * k));
    sl.max = String(Math.round(row.max * k));
    sl.step = String(Math.max(1, Math.round(row.step * k)));
    sl.value = String(Math.round((roomEdit[row.key] ?? RG_DEFAULTS[row.key]) * k));
    sl.title = row.hint.replace(/\*\*/g, '');
    const read = rpEl('span', 'rg-read', rgFormat(row, roomEdit[row.key]));
    sl.oninput = () => {
      roomEdit[row.key] = +sl.value / k;
      read.textContent = rgFormat(row, roomEdit[row.key]);
      // In place. The room picks it up on its own next frame.
      saveRoomData();
    };
    box.appendChild(sl);
    box.appendChild(read);
    host.appendChild(box);
  }

  const foot = rpEl('div', 'rp-row rp-btns');
  const reset = rpEl('button', 're-btn', 'Back to default');
  reset.title = 'Put the room back to the shape it ships with. The camera is '
    + 'not touched — Reset beside the room is the one that does that.';
  reset.onclick = () => {
    Object.assign(roomEdit, RG_DEFAULTS);
    saveRoomData();
    rgPanel();
  };
  foot.appendChild(reset);
  host.appendChild(foot);
}
