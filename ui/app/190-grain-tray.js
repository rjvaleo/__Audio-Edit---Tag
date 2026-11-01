// ───────────────────────────────────── the granular tray as an instrument ──
//
// `docs/DESIGN-CRITIQUE.md`, "The granular engine". The tray was two tall
// columns of hairline sliders, a third of it on screen at the dock's height,
// with the cloud pad boxed into a corner. Now:
//
//   - the cloud pad leads, in a column of its own with its readout and the
//     Cloud presets (`gkLayout`, once: those three are static markup);
//   - every slider row is a knob, its reading and its name under it
//     (`gkKnob`, on every rebuild — the rows are built per engine and file);
//   - every group is a bank, and the banks wrap across the dock's width, so
//     the whole engine is in view (the stylesheet, under "the granular tray").
//
// The `.param` rows are the same elements with the same handlers, values and
// double-click resets; a face is drawn behind each input and the input is laid
// over it, so a pointer on the knob is a pointer on the slider. Random, the
// presets, the automation and the tests reach every one of them as before.

/// A slider row of the tray, made a knob.
function gkKnob(row) {
  const input = row.querySelector(':scope > input[type=range]');
  if (!input || input.dataset.rk) return;
  input.dataset.rk = 'knob';
  row.classList.add('gk-k');
  const face = document.createElement('span');
  face.className = 'rk-face';
  input.before(face);
  // The picture of what the knob does, above it (`grain-glyphs.js`). Drawn
  // wherever the face is, so a drag, a reset, a preset and an undo all reach it.
  const key = row.dataset.glyph;
  const glyph = key && ggHas(key) ? ggMake(key) : null;
  if (glyph) face.before(glyph);
  const draw = () => {
    const min = +input.min, max = +input.max, v = +RK_VALUE.get.call(input);
    const mark = row.dataset.mark === undefined ? undefined : +row.dataset.mark;
    face.innerHTML = rkFace(max > min ? (v - min) / (max - min) : 0, mark);
    if (glyph) ggPaint(glyph, key, row.read ? row.read() : v);
  };
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return RK_VALUE.get.call(this); },
    set(v) { RK_VALUE.set.call(this, v); draw(); },
  });
  input.addEventListener('input', draw);
  rkDrag(input);
  draw();
}

/// The cloud pad's column: the pad, what it is reading, and the presets of
/// the cloud. Moved once, ahead of the banks.
function gkLayout() {
  const host = $('grainControls');
  if (!host || host.querySelector(':scope > .gk-left')) return;
  const left = document.createElement('div');
  left.className = 'gk-left';
  for (const el of [host.querySelector('.cloud-pad-wrap'), host.querySelector('.stretch-readout'), $('grainPresetRow')]) {
    if (el) left.appendChild(el);
  }
  host.prepend(left);
}

function gkAdopt() {
  const host = $('grainControls');
  if (!host) return;
  // The named points, as a fraction of each knob's turn. Set before the face
  // is first drawn; the mark is shown only in the Grain view's Modern style.
  for (const [key, at] of Object.entries(gmMarks())) {
    const row = state.grainRows?.[key];
    const input = row?.querySelector(':scope > input[type=range]');
    if (input && row.dataset.mark === undefined) row.dataset.mark = String((at - +input.min) / (+input.max - +input.min));
  }
  // The controls that have a picture say which, before they become knobs.
  for (const [key, row] of Object.entries({ ...state.stretchRows, ...state.grainRows })) {
    if (row && ggHas(key)) row.dataset.glyph = key;
  }
  for (const row of host.querySelectorAll('.param')) gkGlyphRow(row);
}

/// A slider row of the tray with its picture at the front. The tray is the
/// columns of slider rows it was before the knobs (27 Oct); the knobs, the
/// pad's own column and the packed banks (`gkKnob`, `gkLayout`, `gkPack`,
/// `gkFit`, `gkViewRow`) are kept but no longer used here. They act only on a
/// tray marked `gk-banks`, and nothing marks it.
function gkGlyphRow(row) {
  const input = row.querySelector(':scope > input[type=range]');
  const key = row.dataset.glyph;
  if (!input || !key || row.querySelector(':scope > .gg')) return;
  const glyph = ggMake(key);
  if (!glyph) return;
  row.classList.add('gk-row');
  row.prepend(glyph);
  const draw = () => ggPaint(glyph, key, row.read ? row.read() : +RK_VALUE.get.call(input));
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return RK_VALUE.get.call(this); },
    set(v) { RK_VALUE.set.call(this, v); draw(); },
  });
  input.addEventListener('input', draw);
  draw();
}

/// Pack the banks into the dock's lines (UI queue, item 1).
///
/// They wrapped in a fixed order, so a line was left half empty whenever the
/// next bank did not fit: Scan alone, Shape on the line below. Packed largest
/// first into the lines they fit, the same banks take a line or two fewer, and
/// WSOLA and Vocoder come on screen whole. Reading order holds what matters:
/// Time and pitch leads, the engine's own controls beside it, every standard
/// bank before every extended one. Only `order` is set — nothing moves in the
/// DOM and nothing is hidden. In the dock only; the Sound tab is one column.
function gkPack() {
  const host = $('grainControls');
  if (!host || !host.closest('#dockStretch') || !host.classList.contains('gk-banks')) return;
  const cs = getComputedStyle(host);
  const room = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const gap = parseFloat(cs.columnGap) || 0;
  if (room <= 0) return;
  const banks = [...host.querySelectorAll('.stretch-core, .engine-params, .wild')]
    .filter((b) => b.getBoundingClientRect().width > 0);
  const wide = (b) => b.getBoundingClientRect().width;
  const lead = banks.filter((b) => b.matches('.stretch-core, .engine-params'));
  const std = banks.filter((b) => !lead.includes(b) && !b.closest('#extPanel'));
  const ext = banks.filter((b) => b.closest('#extPanel'));
  const lines = [];
  const place = (group, first) => {
    const start = lines.length;
    if (first) lines.push({ used: first.reduce((w, b) => w + wide(b) + gap, -gap), banks: [...first] });
    for (const b of [...group].sort((x, y) => wide(y) - wide(x))) {
      const w = wide(b);
      const line = lines.slice(start).find((l) => l.used + gap + w <= room);
      if (line) { line.used += gap + w; line.banks.push(b); } else lines.push({ used: w, banks: [b] });
    }
  };
  place(std, lead);
  place(ext, null);
  let n = 10;
  for (const line of lines) for (const b of line.banks) b.style.order = String(n++);
}
/// Both views (`docs/DESIGN-CRITIQUE.md`, "Both views, as an option"): All,
/// or one side at a time. A page hides the other side's banks by a class on
/// the tray — their inputs stay in the document for presets, Random,
/// automation and the resets. The engine picker and its switches are on both.
const GK_VIEWS = [['all', 'All', 'Every bank; the dock grows to show them'],
  ['std', 'Standard', 'Time and pitch, the engine, grain shape and pitch movement'],
  ['ext', 'Extended', 'The constants inside the algorithm']];
let gkView = (() => {
  try { const v = localStorage.getItem('gkView'); return GK_VIEWS.some(([k]) => k === v) ? v : 'all'; }
  catch { return 'all'; }
})();

function gkViewRow() {
  const left = $('grainControls')?.querySelector(':scope > .gk-left');
  if (!left || $('gkView')) return;
  const row = document.createElement('div');
  row.className = 'gk-view';
  row.innerHTML = '<span class="re-tag">SHOW</span><div class="seg" id="gkView"></div>';
  const seg = row.querySelector('.seg');
  for (const [key, text, title] of GK_VIEWS) {
    const btn = document.createElement('button');
    btn.className = 'seg-btn';
    btn.dataset.view = key;
    btn.textContent = text;
    btn.title = title;
    btn.onclick = () => gkSetView(key);
    seg.appendChild(btn);
  }
  left.appendChild(row);
}

function gkSetView(key) {
  gkView = key;
  try { localStorage.setItem('gkView', key); } catch { /* private mode */ }
  const host = $('grainControls');
  if (!host) return;
  host.classList.toggle('gk-page-std', key === 'std');
  host.classList.toggle('gk-page-ext', key === 'ext');
  for (const b of host.querySelectorAll('#gkView .seg-btn')) b.classList.toggle('active', b.dataset.view === key);
  gkPack();
  gkFit();
}

/// Grow the dock to what the tray shows, from the height you chose and never
/// under it, never past the room the waveform needs (`setDockHeight` clamps).
/// Called when the engine, the file or the view changes — not on every
/// resize, so a dock dragged shorter afterwards stays where it was put.
function gkFit() {
  const host = $('grainControls');
  const dock = $('dock');
  if (!host || !dock || !host.closest('#dockStretch') || !host.classList.contains('gk-banks') || !host.clientHeight) return;
  const top = host.getBoundingClientRect().top - host.scrollTop;
  let bottom = 0;
  for (const el of host.querySelectorAll(':scope > .gk-left, :scope .stretch-core, :scope .engine-params, :scope .wild, :scope .engine-pick, :scope .engine-switch-host')) {
    const r = el.getBoundingClientRect();
    if (r.width) bottom = Math.max(bottom, r.bottom - top);
  }
  const content = bottom + parseFloat(getComputedStyle(host).paddingBottom || 0);
  const now = dock.getBoundingClientRect().height;
  if (dockBase === null) dockBase = Math.round(now);
  const want = Math.max(dockBase, Math.ceil(now - host.clientHeight + content));
  if (Math.abs(want - now) > 1) setDockHeight(want, false);
}
{
  const host = $('grainControls');
  let queued = false;
  if (host) {
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => { queued = false; gkAdopt(); gkPack(); gkFit(); }, 0);
    }).observe(host, { childList: true, subtree: true });
    // Packed on every width change; fitted only when the tray comes into view
    // (the Stretch tab chosen again), so a drag is never fought.
    let shown = false;
    if (window.ResizeObserver) new ResizeObserver(() => {
      gkPack();
      const now = host.clientHeight > 0;
      if (now && !shown) gkFit();
      shown = now;
    }).observe(host);
  }
  gkAdopt();
}

