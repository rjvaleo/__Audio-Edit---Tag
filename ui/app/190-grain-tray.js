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

/// The tray's two styles (RJ, 4 Nov 2026). **Bars**, the default: each slider
/// row is one bar, its name and reading inside it and its picture in front,
/// and the groups go two to a line — the same controls in a little over half
/// the height. **Sliders**: the rows as they were. Only the drawing changes;
/// every row is the same range input either way.
const GC_STYLES = [['bars', 'Bars', 'Each control a bar, two to a line'], ['sliders', 'Sliders', 'One slider to a line, as before']];
let gcStyle = (() => {
  try { const v = localStorage.getItem('gcStyle'); return GC_STYLES.some(([k]) => k === v) ? v : 'bars'; }
  catch { return 'bars'; }
})();

function gcSetStyle(key) {
  gcStyle = key;
  try { localStorage.setItem('gcStyle', key); } catch { /* private mode */ }
  $('grainControls')?.classList.toggle('gc-bars', key === 'bars');
  requestAnimationFrame(gcWiden);
  for (const b of document.querySelectorAll('#gcStyle .seg-btn')) b.classList.toggle('active', b.dataset.style === key);
}

/// **Unlisted** (RJ, 4 Nov 2026: "drop this selector"): the tray is bars. The
/// slider style and this switch are kept, not deleted; `true` puts the switch
/// back at the end of the readout line.
const GC_STYLE_LISTED = false;

/// The switch between them, at the end of the readout line under the picker.
function gcStyleRow() {
  if (!GC_STYLE_LISTED) { gcSetStyle('bars'); return; }
  const line = document.querySelector('#grainControls .stretch-readout');
  if (!line || $('gcStyle')) return;
  const seg = document.createElement('div');
  seg.className = 'seg gc-style';
  seg.id = 'gcStyle';
  for (const [key, text, title] of GC_STYLES) {
    const btn = document.createElement('button');
    btn.className = 'seg-btn';
    btn.dataset.style = key;
    btn.textContent = text;
    btn.title = title;
    btn.onclick = () => gcSetStyle(key);
    seg.appendChild(btn);
  }
  line.appendChild(seg);
  gcSetStyle(gcStyle);
}

/// A bar whose name and reading do not both fit at half width takes the whole
/// line rather than cutting its name short.
/// Each section's own width, watched: a section that changes width re-measures
/// its bars, so a bar is wide exactly when it needs to be at the width it has.
const gcWatch = window.ResizeObserver ? new ResizeObserver(() => gcWidenSoon()) : null;
let gcWidenQueued = false;
function gcWidenSoon() {
  if (gcWidenQueued) return;
  gcWidenQueued = true;
  requestAnimationFrame(() => { gcWidenQueued = false; gcWiden(); });
}

function gcWiden() {
  const host = $('grainControls');
  if (!host) return;
  for (const body of host.querySelectorAll('.engine-params, .wild-body')) {
    if (!body.gcWatched && gcWatch) { gcWatch.observe(body); body.gcWatched = true; }
  }
  if (!host.classList.contains('gc-bars')) {
    for (const row of host.querySelectorAll('.gc-wide')) row.classList.remove('gc-wide');
    return;
  }
  // Measured afresh each time: a row widened while the tray was still
  // settling would otherwise stay wide when it fits at half.
  // Bars, by their name; switches, by their button — a switch whose name
  // does not fit at half width spills past its own border otherwise.
  const rows = [...host.querySelectorAll(':is(.engine-params, .wild-body) > .gk-row')]
    .filter((r) => (r.querySelector(':scope > input[type=range]') || r.matches('.toggle')) && r.getClientRects().length);
  for (const row of rows) row.classList.remove('gc-wide');
  const tight = rows.filter((row) => {
    const k = row.querySelector(':scope > .k') || row.querySelector(':scope > .switch');
    return k && k.scrollWidth > k.clientWidth;
  });
  for (const row of tight) row.classList.add('gc-wide');
  // A group's last bar, when it would sit alone in its line, takes the whole
  // line: no half line left empty. Worked out from the layout itself, since a
  // group already holding full-width rows cannot be counted by position.
  for (const body of host.querySelectorAll('.engine-params, .wild-body')) {
    // In the order they are laid out: a choice is moved after its group's bars.
    const kids = [...body.children].filter((k) => k.getClientRects().length)
      .map((k, i) => [k, +getComputedStyle(k).order || 0, i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([k]) => k);
    const last = kids[kids.length - 1];
    if (!last?.matches('.gk-row') || last.classList.contains('gc-wide')) continue;
    let col = 0;
    for (const k of kids.slice(0, -1)) {
      const full = getComputedStyle(k).gridColumnStart === '1' && getComputedStyle(k).gridColumnEnd === '-1';
      col = full ? 0 : (col + 1) % 2;
    }
    if (col === 0) last.classList.add('gc-wide');
  }
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
///
/// A row that is not a slider — a choice, the seed — draws from its own
/// `read`, again after a click on it and whenever Reset or Undo syncs it.
function gkGlyphRow(row) {
  const input = row.querySelector(':scope > input[type=range]');
  const key = row.dataset.glyph;
  if (!key || (!input && !row.read) || row.querySelector(':scope > .gg')) return;
  const glyph = ggMake(key);
  if (!glyph) return;
  row.classList.add('gk-row');
  // What the control does to the sound, as a colour (`GG_FACET`).
  row.style.setProperty('--fc', `var(--f-${GG_FACET[key] || 'time'})`);
  row.prepend(glyph);
  // A bar's fill (`gc-bars`): where the handle is, as a share of the track.
  const fill = () => {
    if (!input) return;
    const min = +input.min, max = +input.max, p = +RK_VALUE.get.call(input);
    row.style.setProperty('--f', String(max > min ? (p - min) / (max - min) : 0));
  };
  const draw = () => { fill(); ggPaint(glyph, key, row.read ? row.read() : +RK_VALUE.get.call(input)); };
  if (!input) {
    row.addEventListener('click', () => requestAnimationFrame(draw));
    const sync = row.sync;
    if (sync) row.sync = (...a) => { sync(...a); draw(); };
    draw();
    return;
  }
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return RK_VALUE.get.call(this); },
    set(v) { RK_VALUE.set.call(this, v); draw(); },
  });
  input.addEventListener('input', draw);
  gcRelative(input);
  // Double-clicking the picture resets the value, as double-clicking the bar
  // does (RJ, 4 Nov 2026); a single click on it does nothing.
  glyph.addEventListener('dblclick', (e) => {
    e.preventDefault();
    input.ondblclick?.(e);
  });
  glyph.classList.add('gc-reset');
  draw();
}

/// A bar goes where you click it (RJ, 4 Nov 2026: "clicking in a slider
/// should set the slider to the clicked on value"), and a drag follows the
/// pointer from there. Holding Shift drags ten times finer, from wherever the
/// bar is when it is pressed. The same `input` and `change` events a hand on
/// the native slider sends, so presets, automation and the resets see no
/// difference.
function gcRelative(input) {
  input.addEventListener('pointerdown', (e) => {
    if (!$('grainControls')?.classList.contains('gc-bars') || e.button !== 0) return;
    e.preventDefault();
    input.focus();
    const min = +input.min, max = +input.max;
    const box = input.getBoundingClientRect();
    const at = (x) => min + Math.max(0, Math.min(1, (x - box.left) / (box.width || 1))) * (max - min);
    let last = e.clientX;
    const put = (v) => {
      input.value = String(Math.max(min, Math.min(max, v)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    put(at(e.clientX));
    input.classList.add('gc-dragging');
    const move = (m) => {
      if (m.shiftKey) put(+input.value + (m.clientX - last) / (box.width || 1) / 10 * (max - min));
      else put(at(m.clientX));
      last = m.clientX;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      input.classList.remove('gc-dragging');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

/// The tray's sections as bands (RJ, 4 Nov 2026): alternating backgrounds down
/// each column, and a dot in each heading for every kind of control the
/// section holds. The key that names the kinds is in Help (`openColourKey`).
function gcBands() {
  const host = $('grainControls');
  if (!host) return;
  host.querySelector(':scope > .gc-key')?.remove();
  for (const col of host.querySelectorAll(':scope > .cpanel')) {
    const bands = [...col.querySelectorAll('.gc-band, .wild')].filter((b) => !b.parentElement.closest('.gc-band, .wild') && b.getClientRects().length);
    bands.forEach((b, i) => {
      b.classList.toggle('gc-alt', i % 2 === 1);
      const head = b.querySelector(':scope > .wild-head');
      if (!head) return;
      const kinds = new Set([...b.querySelectorAll('.gk-row')].filter((r) => r.getClientRects().length).map((r) => GG_FACET[r.dataset.glyph]).filter(Boolean));
      const sig = GG_FACETS.filter(([id]) => kinds.has(id)).map(([id]) => id).join(' ');
      let dots = head.querySelector(':scope > .gc-dots');
      if (dots?.dataset.sig === sig) return;
      if (!dots) {
        // Right after the heading's name, ahead of anything else on its line.
        dots = document.createElement('span');
        dots.className = 'gc-dots';
        head.insertBefore(dots, head.firstChild ? head.firstChild.nextSibling : null);
      }
      dots.dataset.sig = sig;
      dots.innerHTML = sig ? sig.split(' ').map((id) => `<b style="background: var(--f-${id})"></b>`).join('') : '';
    });
  }
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
      setTimeout(() => { queued = false; gkAdopt(); gcBands(); gcWiden(); gkPack(); gkFit(); }, 0);
    }).observe(host, { childList: true, subtree: true });

    // Packed on every width change; fitted only when the tray comes into view
    // (the Stretch tab chosen again), so a drag is never fought.
    let shown = false;
    if (window.ResizeObserver) new ResizeObserver(() => {
      gkPack();
      gcWiden();
      const now = host.clientHeight > 0;
      if (now && !shown) gkFit();
      shown = now;
    }).observe(host);
  }
  gkAdopt();
  gcStyleRow();
  gcBands();
  // A label's width changes once the face loads; measure again then.
  document.fonts?.ready?.then(() => gcWidenSoon());
}

/// What each colour means, for Help › What the colours mean.
const GG_FACET_WORDS = {
  time: 'When and for how long: the stretch, the grains\u2019 length, rate and timing, where they read.',
  pitch: 'How high: transposition, pitch jitter and drift, partials pulled on or off their frequency.',
  tone: 'The colour of the sound: the spectrum, how it is split, smeared, frozen or thinned.',
  attack: 'The edges: transients, the grain envelope, how joins are made.',
  space: 'Width and thickness: stereo spread, layers, how far they scatter, and the feedback that keeps them sounding.',
  level: 'How loud: the mix between the cloud and the engine, and the hybrid\u2019s three parts.',
};

function openColourKey() {
  const list = $('colourKeyList');
  list.innerHTML = '';
  for (const [id, name] of GG_FACETS) {
    const row = document.createElement('div');
    row.className = 'ck-row';
    row.innerHTML = `<b class="ck-sw" style="background: var(--f-${id})"></b><span class="ck-name" style="color: var(--f-${id})"></span><span class="ck-what"></span>`;
    row.querySelector('.ck-name').textContent = name;
    row.querySelector('.ck-what').textContent = GG_FACET_WORDS[id];
    list.appendChild(row);
  }
  $('colourKey').classList.remove('hidden');
  $('colourKeyClose').focus();
}
function closeColourKey() { $('colourKey').classList.add('hidden'); }
$('colourKeyClose').onclick = closeColourKey;
$('colourKey').onclick = (e) => { if (e.target === $('colourKey')) closeColourKey(); };
$('colourKey').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeColourKey(); });
