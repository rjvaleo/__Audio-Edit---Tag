// ──────────────────────────────────────────────────────── classic or modern ──
//
// **Two views of one palette.** Classic is the tab as it was before the design
// pass — sliders, a menu, a button to go back to the theme — kept whole below
// (`…Classic`). Modern is the instrument: rows of fixed places, knobs, the
// range dragged on its strip, Undo. They read and write the same scheme, so
// switching changes how the controls look and nothing about the room. Which one
// is a per-viewer convenience, kept in the browser.

const RP_VIEW_KEY = 'roomPaintView';
let rpView = (() => {
  try { return localStorage.getItem(RP_VIEW_KEY) === 'classic' ? 'classic' : 'modern'; }
  catch { return 'modern'; }
})();

function rpViewRow() {
  const row = rpEl('div', 'rp-row rp-view-row');
  row.appendChild(rpEl('span', 're-tag', 'VIEW'));
  const seg = rpEl('div', 'rp-view');
  for (const [key, label, title] of [
    ['classic', 'Classic', 'The palette as it was: sliders, a menu for what a ramp is read against.'],
    ['modern', 'Modern', 'The palette as an instrument: fixed places, knobs, the range dragged on its strip, Undo.'],
  ]) {
    const b = rpEl('button', 're-btn' + (rpView === key ? ' active' : ''), label);
    b.title = title;
    b.setAttribute('aria-pressed', rpView === key ? 'true' : 'false');
    b.onclick = () => {
      rpView = key;
      try { localStorage.setItem(RP_VIEW_KEY, key); } catch { /* private mode */ }
      rpPanel();
    };
    seg.appendChild(b);
  }
  row.appendChild(seg);
  return row;
}

/// Replace the whole scheme, keeping the one before for Undo.
function rpReplace(scheme) {
  const before = JSON.parse(JSON.stringify(roomPaint.scheme));
  roomPaint.scheme = scheme;
  rpTouch(); rpRemember(); rpApply();
  rpPrev = before;
  rpPanel();
}

/// What a load menu entry for the theme carries. Not a name anyone can save
/// under: it has a character no text field types.
const RP_THEME_ENTRY = '\u0000theme';

function rpEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function rpHeadRow() {
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

  // Under the name, in the control column: the scheme's own line.
  const btns = rpEl('div', 'rp-row rp-btns rp-under');
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
  load.appendChild(new Option('Load…', ''));
  // The theme is a scheme like any other — the one with nothing in it — so it
  // is first in the menu rather than a button of its own.
  const theme = new Option('Theme — as shipped', RP_THEME_ENTRY);
  theme.title = 'Drop every override. The room goes back to the three colours the theme gives it.';
  load.appendChild(theme);
  for (const n of names) load.appendChild(new Option(n, n));
  load.onchange = () => {
    if (load.value === RP_THEME_ENTRY) { rpReplace(rpDefaultScheme()); return; }
    const s = load.value && rpSaved()[load.value];
    if (s) rpReplace({ name: s.name || load.value, slots: s.slots || {} });
  };
  btns.appendChild(load);

  const del = rpEl('button', 're-btn', 'Delete');
  del.title = 'Remove the palette currently named above from the saved list.';
  del.onclick = () => {
    const n = (name.value || '').trim();
    if (n && rpDelete(n)) { toast(`Deleted “${n}”`); rpPanel(); }
  };
  btns.appendChild(del);
  // Undo, in a place of its own that stays when there is nothing to undo, so
  // the line never shifts. A second Undo is a redo: two rolls to flip between.
  if (rpPrev) {
    const undo = rpEl('button', 're-btn rp-undo', 'Undo');
    undo.title = 'Put back the palette from before the last generator, load or reset. Again to flip back.';
    undo.onclick = () => rpReplace(rpPrev);
    btns.appendChild(undo);
  } else {
    btns.appendChild(rpEl('span', 'rp-undo-gap'));
  }
  box.appendChild(btns);

  // ── the generators ──
  // On the tag's own line, in six fixed places: two full lines of three, where
  // they used to wrap to whatever the words left over.
  const genRow = rpEl('div', 'rp-row');
  genRow.appendChild(rpEl('span', 're-tag', 'GENERATE'));
  const gens = rpEl('div', 'rp-gens');
  for (const g of RP_GENERATORS) {
    const b = rpEl('button', 're-btn', g.label);
    b.title = `Paint every object at once. Click again for another ${g.label.toLowerCase()}.`;
    // What it makes, before it is pressed.
    if (typeof cpGenStrip === 'function') b.prepend(cpGenStrip(g.key));
    b.onclick = () => rpReplace(rpGenerate(g.key));
    gens.appendChild(b);
  }
  genRow.appendChild(gens);
  box.appendChild(genRow);
  return box;
}

function rpSlotRow(s) {
  const wrap = rpEl('div', 'rp-slot');
  const open = rpOpen === s.key;
  // The open row is lit like a chosen place, so the editor under it is plainly
  // its own.
  const head = rpEl('button', 'rp-slot-head' + (open ? ' open' : ''));
  head.title = s.hint || '';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const cfg = rpSlot(s.key);

  head.appendChild(rpEl('span', 'rp-chev', open ? '\u25BE' : '\u25B8'));
  // Where in the room this colour lands (`control-pictures.js`).
  if (typeof cpWhere === 'function') head.appendChild(cpWhere(s.key));
  const strip = rpEl('span', 'rp-strip');
  strip.style.background = rpGradientCss(s.key);
  head.appendChild(strip);
  head.appendChild(rpEl('span', 'rp-slot-name', s.label));
  // What it is set to, in a word — so a scheme can be read down the list
  // without opening fourteen editors.
  // The same word as the button that set it.
  const mode = cfg.mode === 'inherit' ? 'theme' : cfg.mode === 'flat' ? 'colour'
    : rpDriveLabel(s, cfg.drive | 0).toLowerCase();
  head.appendChild(rpEl('span', 'rp-slot-mode', mode));
  head.onclick = () => { rpOpen = rpOpen === s.key ? null : s.key; rpPanel(); };
  wrap.appendChild(head);

  if (rpOpen === s.key) wrap.appendChild(rpSlotEditor(s));
  return wrap;
}

/// What a drive is called for this slot. `Own` is the one quantity the layer
/// alone knows, so it goes by that quantity's name.
function rpDriveLabel(s, i) {
  const d = RP_DRIVES[i] || RP_DRIVES[0];
  return d.key === 'own' ? (RP_OWN_LABEL[s.own] || d.label) : d.label;
}

/// A row of fixed places: one per choice, lit by a tint and an edge when on.
///
/// `places` is `[label, on, title, pick]`, or `null` for a place this slot does
/// not have. **An absent choice keeps its place, empty.** The row never closes
/// up, so a word is where it was on every slot and the hand learns it once —
/// the rule the engine row and the Data layer's missing switch already follow.
function rpSeg(name, places) {
  const row = rpEl('div', 'rp-seg');
  row.dataset.seg = name;
  for (const p of places) {
    if (!p) { row.appendChild(rpEl('span', 'rp-seg-gap')); continue; }
    const [label, on, title, pick] = p;
    const b = rpEl('button', 're-btn' + (on ? ' active' : ''), label);
    b.title = title || '';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.onclick = pick;
    row.appendChild(b);
  }
  return row;
}

/// A knob over a range input, as the rest of the Visual column draws them
/// (`rkKnob` in `app.js`). The input stays: the face is drawn behind it and it
/// is laid over the face, so a pointer or the keyboard on the knob is on it.
/// `read` is the reading under the face, kept up to date here.
function rpKnob(input, label, read) {
  const cell = rpEl('span', 'rp-knob');
  cell.appendChild(input);
  if (typeof rkKnob === 'function') rkKnob(input, label, read);
  return cell;
}

function rpSlotEditor(s) {
  const box = rpEl('div', 'rp-edit');
  const cfg = rpSlot(s.key);

  // ── the mode ──
  const modes = rpEl('div', 'rp-row');
  modes.appendChild(rpEl('span', 're-tag', 'PAINT'));
  // The background is one colour by definition: the room adds light to it, and
  // a ground that varied per fragment is not a ground. Its Ramp place is kept,
  // empty.
  const pick = (key) => () => {
    const patch = { mode: key };
    // Starting from what it is already drawn with, so switching mode changes
    // nothing until something else is moved.
    if (key === 'flat' && !cfg.colour) patch.colour = rpInheritedPair(s.key)[1];
    if (key === 'ramp' && !cfg.stops) patch.stops = rpStops(s.key);
    // A ramp's first window, unless it already has one of its own.
    if (key === 'ramp' && cfg.lo == null && cfg.hi == null) Object.assign(patch, rpStartRange(s.key, cfg.drive));
    rpSetSlot(s.key, patch); rpApply(); rpPanel();
  };
  modes.appendChild(rpSeg('mode', [
    ['Theme', cfg.mode === 'inherit',
      'Leave it to the theme. Nothing about this object is sent to the renderer at all, so it draws exactly as it always has.',
      pick('inherit')],
    ['Colour', cfg.mode === 'flat', 'One colour, whatever the sound is doing.', pick('flat')],
    s.flat ? null
      : ['Ramp', cfg.mode === 'ramp', 'A gradient, read against a quantity of your choosing.', pick('ramp')],
  ]));
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
    box.appendChild(rpStopsEditor(s));
    box.appendChild(rpDriveRow(s));
    box.appendChild(rpRangeRow(s));
  }
  return box;
}

function rpStopsEditor(s) {
  const box = rpEl('div', 'rp-row rp-stops');
  // **One list, shared by every control in the editor, and written in place.**
  // Each handler used to rebuild the stops from a copy taken when the editor
  // opened, so the second stop you touched put the first one back to what it
  // was — the well still showed the colour you picked, the strip and the room
  // did not. Sorted once, here: the cells are built in this order and each
  // handler addresses its own cell by index, so the order must not move under
  // them while the editor is open. A stop turned past its neighbour is sorted
  // on the next rebuild.
  const live = [...rpStops(s.key)].sort((a, b) => a.at - b.at);
  const push = () => {
    rpSetSlot(s.key, { stops: live.map((x) => ({ ...x })) });
    rpApply();
    const slot = box.closest('.rp-slot');
    const strip = slot?.querySelector('.rp-strip');
    if (strip) strip.style.background = rpGradientCss(s.key);
    bar.style.background = rpGradientCss(s.key);
    slot?.querySelector('.rp-span')?.rpRedraw?.();
  };

  box.appendChild(rpEl('span', 're-tag', 'STOPS'));

  // ── the gradient, with a tick where each stop sits ──
  // The direct way to move a stop: along the line it is a point on. The knob
  // under each colour stays as the exact one, and the two follow each other.
  const bar = rpEl('div', 'rp-stopbar');
  bar.style.background = rpGradientCss(s.key);
  const ticks = [], knobs = [], reads = [];
  /// Move stop `i` to `v`, from whichever control moved it.
  const setAt = (i, v, from) => {
    v = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
    live[i] = { ...live[i], at: v };
    if (from !== 'knob' && knobs[i]) knobs[i].value = String(Math.round(v * 100));
    if (reads[i]) reads[i].textContent = v.toFixed(2);
    const tk = ticks[i];
    tk.style.left = `${v * 100}%`;
    tk.setAttribute('aria-valuenow', v.toFixed(2));
    push();
  };
  live.forEach((st, i) => {
    const tk = rpEl('span', 'rp-tick');
    tk.appendChild(rpEl('i'));
    tk.querySelector('i').style.background = st.c;
    tk.style.left = `${st.at * 100}%`;
    tk.tabIndex = 0;
    tk.title = 'Where this colour sits. Drag along the gradient; arrow keys, shift for coarse.';
    tk.setAttribute('role', 'slider');
    tk.setAttribute('aria-label', `Stop ${i + 1}: where it sits`);
    tk.setAttribute('aria-valuemin', '0');
    tk.setAttribute('aria-valuemax', '1');
    tk.setAttribute('aria-valuenow', st.at.toFixed(2));
    tk.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      tk.focus({ preventScroll: true });
      try { tk.setPointerCapture(e.pointerId); } catch { /* released below */ }
      // Inside the border, where the ticks are placed.
      const x0 = bar.getBoundingClientRect().left + bar.clientLeft, w = bar.clientWidth;
      const move = (ev) => setAt(i, (ev.clientX - x0) / w, 'tick');
      const up = () => {
        tk.removeEventListener('pointermove', move);
        tk.removeEventListener('pointerup', up);
        tk.removeEventListener('pointercancel', up);
      };
      tk.addEventListener('pointermove', move);
      tk.addEventListener('pointerup', up);
      tk.addEventListener('pointercancel', up);
    });
    tk.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      const cur = live[i].at;
      const to = { ArrowRight: cur + step, ArrowUp: cur + step, ArrowLeft: cur - step, ArrowDown: cur - step,
        Home: 0, End: 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setAt(i, to, 'tick');
    });
    ticks.push(tk);
    bar.appendChild(tk);
  });
  box.appendChild(bar);
  // A cell a stop: its colour on top, where it sits in the gradient as a knob
  // under it, and a way to take it out in the corner.
  const grid = rpEl('div', 'rp-stop-grid');
  live.forEach((st, i) => {
    const cell = rpEl('div', 'rp-stop');
    const well = rpEl('input', 're-colour');
    well.type = 'color';
    well.value = st.c;
    well.title = 'This colour.';
    well.oninput = () => {
      live[i] = { ...live[i], c: well.value };
      ticks[i].querySelector('i').style.background = well.value;
      push();
    };
    cell.appendChild(well);

    const at = rpEl('input', 're-slider');
    at.type = 'range'; at.min = '0'; at.max = '100'; at.step = '1';
    at.value = String(Math.round(st.at * 100));
    at.title = 'Where in the gradient this colour sits. Drag up or down; shift for fine.';
    at.setAttribute('aria-label', `Stop ${i + 1}: where it sits`);
    const read = rpEl('b', null, st.at.toFixed(2));
    at.oninput = () => setAt(i, +at.value / 100, 'knob');
    knobs.push(at);
    reads.push(read);
    cell.appendChild(rpKnob(at, `Stop ${i + 1}`, read));

    if (live.length > 2) {
      const del = rpEl('button', 're-btn rp-stop-del', '×');
      del.title = 'Take this colour out. Two is the fewest a gradient can have.';
      del.setAttribute('aria-label', `Remove stop ${i + 1}`);
      del.onclick = () => {
        live.splice(i, 1);
        push(); rpPanel();
      };
      cell.appendChild(del);
    }
    grid.appendChild(cell);
  });

  const add = rpEl('button', 're-btn rp-add', '+');
  add.title = 'Another colour in the gradient, dropped in the largest gap.';
  add.setAttribute('aria-label', 'Add a stop');
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
  grid.appendChild(add);
  box.appendChild(grid);
  return box;
}

function rpDriveRow(s) {
  const cfg = rpSlot(s.key);
  const row = rpEl('div', 'rp-row');
  row.appendChild(rpEl('span', 're-tag', 'READ AGAINST'));
  row.appendChild(rpSeg('drive', RP_DRIVES.map((d, i) => {
    // A layer with nothing of its own to offer does not get the choice. The
    // attribute is nought there, so the ramp would collapse to its first colour
    // and read as the control being broken.
    if (d.key === 'own' && !s.own) return null;
    return [rpDriveLabel(s, i), (cfg.drive | 0) === i, d.hint,
      () => { rpSetSlot(s.key, { drive: i }); rpApply(); rpPanel(); }];
  })));
  return row;
}

/// The ramp as the room reads it, across the whole of the quantity: the first
/// colour below the window, the gradient spent across it through the curve,
/// the last colour above it. The same row the atlas holds, sampled through the
/// shader's own arithmetic (`pow(clamp((d - lo) / (hi - lo)), curve)`).
function rpSpanCss(key) {
  const cfg = rpSlot(key);
  const row = new Uint8Array(RP_RAMP_W * 4);
  rpFillRow(row, 0, rpStops(key));
  const lo = cfg.lo ?? 0, hi = cfg.hi ?? 1, curve = cfg.curve ?? 1;
  const n = 48, parts = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    const t = Math.max(0, Math.min(1, (x - lo) / Math.max(1e-4, hi - lo)));
    const o = Math.round(Math.pow(t, curve) * (RP_RAMP_W - 1)) * 4;
    parts.push(`rgb(${row[o]}, ${row[o + 1]}, ${row[o + 2]}) ${(x * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/// The smallest window a range can close to. The two ends cannot cross: a
/// window turned inside out is a hard step in the shader, not a reversed ramp.
const RP_SPAN_GAP = 0.01;

/// Each end's number under its own handle, pushed apart where they would
/// touch and kept within the strip. Measured, so it waits for a layout: a
/// row built and not yet in the page is placed on the next turn.
function rpPlaceReads(read, span, lo, hi) {
  const [a, b] = read.children;
  a.textContent = lo.toFixed(2);
  b.textContent = hi.toFixed(2);
  const W = span.clientWidth;
  if (!W) { setTimeout(() => span.isConnected && span.clientWidth && rpPlaceReads(read, span, lo, hi), 0); return; }
  const wa = a.offsetWidth, wb = b.offsetWidth, gap = 4;
  let xa = lo * W - wa / 2, xb = hi * W - wb / 2;
  const over = xa + wa + gap - xb;
  if (over > 0) { xa -= over / 2; xb += over / 2; }
  if (xa < 0) { xb += -xa; xa = 0; }
  if (xb + wb > W) { xa -= xb + wb - W; xb = W - wb; }
  xa = Math.max(0, xa);
  a.style.left = `${xa}px`;
  b.style.left = `${xb}px`;
}

function rpRangeRow(s) {
  const cfg = rpSlot(s.key);
  const row = rpEl('div', 'rp-row rp-range');
  row.appendChild(rpEl('span', 're-tag', 'RANGE'));

  // ── the window, drawn on the strip ──
  const col = rpEl('div', 'rp-span-col');
  const span = rpEl('div', 'rp-span');
  span.title = 'The window of the quantity the gradient is spent across. Drag the window to move it, '
    + 'an edge to move that end. Below it everything takes the first colour, above it the last.';
  const win = rpEl('div', 'rp-span-win');
  const ends = ['lo', 'hi'].map((key) => {
    const h = rpEl('span', `rp-span-end rp-span-${key}`);
    h.tabIndex = 0;
    h.setAttribute('role', 'slider');
    h.setAttribute('aria-label', key === 'lo' ? 'Where the gradient starts' : 'Where the gradient ends');
    h.setAttribute('aria-valuemin', '0');
    h.setAttribute('aria-valuemax', '1');
    h.dataset.end = key;
    win.appendChild(h);
    return h;
  });
  span.appendChild(win);
  const read = rpEl('div', 'rp-span-read');
  read.append(rpEl('span'), rpEl('span'));
  col.append(span, read);
  row.appendChild(col);

  const now = () => { const c = rpSlot(s.key); return { lo: c.lo ?? 0, hi: c.hi ?? 1 }; };
  const draw = () => {
    const { lo, hi } = now();
    win.style.left = `${lo * 100}%`;
    win.style.width = `${(hi - lo) * 100}%`;
    ends[0].setAttribute('aria-valuenow', lo.toFixed(2));
    ends[1].setAttribute('aria-valuenow', hi.toFixed(2));
    span.style.background = rpSpanCss(s.key);
    rpPlaceReads(read, span, lo, hi);
  };
  span.rpRedraw = draw;
  const r2 = (v) => Math.round(v * 100) / 100;
  const set = (lo, hi) => {
    rpSetSlot(s.key, { lo: r2(lo), hi: r2(hi) });
    rpApply();
    draw();
  };
  // One end moved, held clear of the other.
  const setEnd = (key, v) => {
    const { lo, hi } = now();
    if (key === 'lo') set(Math.max(0, Math.min(v, hi - RP_SPAN_GAP)), hi);
    else set(lo, Math.min(1, Math.max(v, lo + RP_SPAN_GAP)));
  };

  span.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const b = span.getBoundingClientRect();
    const at = (ev) => Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width));
    const x0 = at(e), { lo, hi } = now();
    // An edge within a few pixels is that edge; inside the window is the
    // window; outside it, the nearer end jumps to the pointer and follows it.
    const near = 8 / b.width;
    const dLo = Math.abs(x0 - lo), dHi = Math.abs(x0 - hi);
    let grab;
    if (Math.min(dLo, dHi) <= near) grab = dHi < dLo || (dHi === dLo && x0 > hi) ? 'hi' : 'lo';
    else if (x0 > lo && x0 < hi) grab = 'move';
    else { grab = x0 < lo ? 'lo' : 'hi'; setEnd(grab, x0); }
    if (grab !== 'move') ends[grab === 'lo' ? 0 : 1].focus({ preventScroll: true });
    try { span.setPointerCapture(e.pointerId); } catch { /* released below */ }
    const move = (ev) => {
      if (grab !== 'move') { setEnd(grab, at(ev)); return; }
      const w = hi - lo;
      const nlo = Math.max(0, Math.min(1 - w, lo + at(ev) - x0));
      set(nlo, nlo + w);
    };
    const up = () => {
      span.removeEventListener('pointermove', move);
      span.removeEventListener('pointerup', up);
      span.removeEventListener('pointercancel', up);
    };
    span.addEventListener('pointermove', move);
    span.addEventListener('pointerup', up);
    span.addEventListener('pointercancel', up);
  });
  for (const h of ends) {
    h.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      const cur = now()[h.dataset.end];
      const to = { ArrowRight: cur + step, ArrowUp: cur + step, ArrowLeft: cur - step, ArrowDown: cur - step,
        Home: 0, End: 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setEnd(h.dataset.end, to);
    });
  }

  // ── the curve, a knob beside the window it shapes ──
  const curve = rpEl('input', 're-slider rp-curve');
  curve.type = 'range'; curve.min = '20'; curve.max = '400'; curve.step = '1';
  curve.value = String(Math.round((cfg.curve ?? 1) * 100));
  curve.title = 'How the gradient is spent across that range. Below 1 '
    + 'favours the top end, above it favours the bottom. Level is '
    + 'perceptual, so a straight ramp spends most of itself on quiet.';
  curve.setAttribute('aria-label', 'Curve');
  const curveRead = rpEl('b', null, (+curve.value / 100).toFixed(2));
  curve.oninput = () => {
    rpSetSlot(s.key, { curve: +curve.value / 100 });
    curveRead.textContent = (+curve.value / 100).toFixed(2);
    rpApply();
    draw();
  };
  row.appendChild(rpKnob(curve, 'Curve', curveRead));
  draw();
  return row;
}

