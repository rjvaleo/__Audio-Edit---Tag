// ============================================================ Prism panel parts

/* The Prism panel's own pieces (v7, RJ, 6 Nov 2026, after the design council:
   "less color, less chaos, less candy, more professional"; the page rebuilt
   from the mock-up he approved, 13 Nov 2026):

   - `prismKnob`: a process's setting as the app's shared knob (`uiKnobParam`,
     `073a-ui-knob.js`) at 26, its picture beside it in its facet's colour, as
     on Chop. The Controls and LFOs panels.
   - `prismBar`: a control as the shared bar (`uiBarOver`, `073b-ui-bar.js`)
     over a `param` row, so a click sets the value, Shift drags fine and a
     double-click on the picture resets, with the Prism picture in front of
     it. The Takes panel.
   - The Process menu: every process Prism can play, each with its picture, in
     Hyperprism's groups, short and wide so it opens inside the panel.
     Choosing a Hyperprism process that is not in Prism's chain adds it. */

/// A control as a bar with its picture. `spec` is a control (`key`, `label`,
/// `min`, `max`, `step`, `log`, `unit`, `choices`, `default`).
function prismBar(spec, value, { facet, colour, kind = '', onInput, onCommit, format } = {}) {
  const stepped = spec.step === 1 || !!spec.choices;
  const fmt = format || ((v) => prismBarFormat(spec, v));
  let paint = () => {};
  const row = param(spec.label, value, spec.min, spec.max, stepped ? 1 : (spec.max - spec.min) / 400, fmt,
    (v) => { onInput?.(stepped ? Math.round(v) : v); paint(); },
    (v) => { onCommit?.(v); },
    !!spec.log && spec.min > 0 && !stepped, spec.default);
  const input = row.querySelector(':scope > input[type=range]');
  row.classList.add('prism-bar');
  row.dataset.key = spec.key;
  row.style.setProperty('--fc', colour || `var(--f-${facet || PRISM_PIC.facetOf(spec.key)})`);
  row.insertAdjacentHTML('afterbegin', '<svg class="gg" viewBox="0 0 64 48" aria-hidden="true"></svg>');
  const glyph = row.firstElementChild;
  const value01 = (v) => (spec.max > spec.min ? (v - spec.min) / (spec.max - spec.min) : 0);
  const draw = (v) => {
    const f = PRISM_PIC.HP_DRAW[spec.key];
    glyph.innerHTML = f && Number.isFinite(v) ? f(v, Math.max(0, Math.min(1, value01(v))), spec, kind) : '';
  };
  paint = () => {
    const lo = +input.min, hi = +input.max;
    row.style.setProperty('--f', String(hi > lo ? (+input.value - lo) / (hi - lo) : 0));
    draw(row.read ? row.read() : +input.value);
  };
  const sync = row.sync;
  row.sync = (v) => { sync?.(v); paint(); };
  if (input) {
    gcRelative(input);
    glyph.addEventListener('dblclick', (e) => { e.preventDefault(); input.ondblclick?.(e); });
  }
  // What an LFO makes of it (`387-prism-lfo.js`): a marker and the reading,
  // the setting itself left where it is.
  const mark = document.createElement('i');
  mark.className = 'plfo-mark ui-keep';
  row.appendChild(mark);
  const shown = row.querySelector(':scope > .v');
  row.show = (v) => {
    if (!input) return;
    const n = Math.max(0, Math.min(1, value01(v)));
    mark.style.left = `${input.offsetLeft + n * input.offsetWidth}px`;
    if (shown) shown.textContent = fmt(v);
    draw(v);
  };
  row.rest = () => { if (shown) shown.textContent = fmt(row.read ? row.read() : +input.value); paint(); };
  if (input) {
    const lo = spec.min < 0 && spec.max > 0 && !spec.log ? value01(0) : 0;
    uiBarOver(row, { input, name: row.querySelector(':scope > .k'), read: shown, pic: glyph, zero: lo, col: row.style.getPropertyValue('--fc') });
  }
  paint();
  return row;
}

/// A control as the shared knob with its picture beside it, over the same
/// `param` row `prismBar` makes, the way Chop's effects are (`chopBar`): the
/// range input stays, unseen, so whatever reads, sets or maps a control by its
/// row and its input (the LFOs, the follow, the tests) goes on as before, and
/// the knob turns that input. The same steps and the same log curve as the
/// bar, so a value lands where it did.
///
/// The row adds what the LFOs ask of it: `show(v, mod)` draws the value the
/// deck hears (the reading, the picture, the reach round the ring and the dot)
/// with the setting left where it is, and `rest()` puts the setting back.
function prismKnob(spec, value, { facet, colour, kind = '', onInput, onCommit, format } = {}) {
  const stepped = spec.step === 1 || !!spec.choices;
  const fmt = format || ((v) => prismBarFormat(spec, v));
  const step = stepped ? 1 : (spec.max - spec.min) / 400;
  const log = !!spec.log && spec.min > 0 && !stepped;
  let face = null, swung = null;
  const row = param(spec.label, value, spec.min, spec.max, step, fmt,
    (v) => { onInput?.(stepped ? Math.round(v) : v); face?.sync(row.read()); },
    (v) => { onCommit?.(v); },
    log, spec.default);
  const input = row.querySelector(':scope > input[type=range]');
  const sync = row.sync;
  // Still a `prism-bar`: that is what the LFOs' Map and the follow look for.
  row.classList.add('prism-bar', 'prism-knob');
  row.dataset.key = spec.key;
  const col = colour || `var(--f-${facet || PRISM_PIC.facetOf(spec.key)})`;
  row.style.setProperty('--fc', col);
  const value01 = (v) => Math.max(0, Math.min(1, spec.max > spec.min ? (v - spec.min) / (spec.max - spec.min) : 0));
  const draw = (v) => {
    const f = PRISM_PIC.HP_DRAW[spec.key];
    return f && Number.isFinite(v) ? f(v, value01(v), spec, kind) : '';
  };
  face = uiKnobParam(spec.label, value, spec.min, spec.max, step, (v) => fmt(swung ?? v),
    (v) => { sync(v); input.dispatchEvent(new Event('input', { bubbles: true })); },
    () => input.dispatchEvent(new Event('change', { bubbles: true })),
    log, spec.default,
    { size: 26, cls: 'prism-face', wheel: true, pic: (u, v) => draw(swung ?? v), pv: '0 0 64 48', col,
      title: Number.isFinite(spec.default) ? `${spec.label} — drag up or down, Shift for fine, double-click to reset to ${fmt(spec.default)}` : undefined });
  row.append(face);
  row.sync = (v) => { sync(v); face.sync(v); };
  const sc = uiScale(spec.min, spec.max, log);
  row.show = (v, mod) => {
    swung = v;
    face.setMod({ rng: Math.max(0.01, Math.min(0.5, mod?.rng || 0)), live: sc.toU(v), col: mod?.col || 'var(--lc)' });
  };
  row.rest = () => { swung = null; face.setMod(null); };
  return row;
}

/// The pad's axes, the sound and the chain's Add: the shared dropdown
/// (`073c-ui-drop.js`) in front of each select, which keeps its value and its
/// handler; and the switches. The presets' row is the preset bar's (phase 4),
/// and left to it.
function prismDrops() {
  // Its switches are the shared segmented switch (`073d-ui-seg.js`); the
  // shapes fill the Takes panel's width.
  document.querySelectorAll('#dockHyper .hs-seg').forEach((s) => s.classList.add('ui-seg', 'h24'));
  $('dockHyper').querySelector('.prism-shapes')?.classList.add('fill');
  uiDrop($('prismX'), { h: 24, w: 120 });
  uiDrop($('prismY'), { h: 24, w: 120 });
  uiDrop($('prismSoundFolder'), { h: 24, w: 150 });
  uiDrop($('prismSoundFile'), { h: 24, w: 190 });
  uiDrop($('prismChainAdd'), { h: 24, w: 140 });
}

/// A bar's reading, short enough to sit beside its name in half a column:
/// whole numbers from 10 up and on a stepped control, two places below.
function prismBarFormat(spec, v) {
  if (!Number.isFinite(v)) return '';
  if (spec.choices) return spec.choices[Math.round(v - spec.min)] ?? String(Math.round(v));
  if (spec.key === 'ratio' || spec.key === 'semitones') return prismFormat(spec, v);
  const n = spec.step === 1 || Math.abs(v) >= 10 ? String(Math.round(v)) : v.toFixed(2);
  return spec.unit ? `${n} ${spec.unit}` : n;
}

// ───────────────────────────────────────────── the Process menu

/// Hyperprism's groups, in its order, and how they sit in the menu's columns:
/// short columns, so the menu opens inside the panel.
const PRISM_GROUPS = [['time', 'Time'], ['filter', 'Filters'], ['delay', 'Delays'], ['reverb', 'Reverbs'], ['modulation', 'Modulation'],
  ['pitch', 'Pitch'], ['stereo', 'Stereo'], ['dynamics', 'Dynamics'], ['distortion', 'Distortion'], ['chain', 'Also in the chain']];
const PRISM_MENU_COLUMNS = [['time', 'reverb', 'pitch', 'distortion'], ['filter', 'dynamics'], ['delay', 'chain'], ['modulation'], ['stereo']];

/// Everything the menu offers: Time & Pitch, the Pitch Time Changer, every
/// Hyperprism process, and anything else already in Prism's chain.
function prismProcesses() {
  const out = [{ id: PRISM_STRETCH, kind: 'stretch', label: 'Time & Pitch', cat: 'time' },
    { id: PRISM_PTC, kind: 'ptc', label: 'Pitch Time Changer', cat: 'time' }];
  const slots = prismDeck.rack?.slots || [];
  for (const s of Object.values(state.shapers || {})) {
    if (!s.kind?.startsWith('prism:hp-')) continue;
    const slot = slots.find((x) => x.kind === s.kind);
    out.push({ id: slot?.id || null, kind: s.kind, label: s.label.replace(/^Hyperprism /, ''), cat: s.category || 'chain' });
  }
  for (const slot of slots) {
    if (slot.kind?.startsWith('prism:hp-')) continue;
    const src = (prismPad.sources || []).find((x) => x.id === slot.id);
    out.push({ id: slot.id, kind: slot.kind, label: src?.label || state.shapers?.[slot.kind]?.label || slot.kind, cat: 'chain' });
  }
  return out;
}

const prismPick = { open: false };

function prismPickerRender() {
  const btn = $('prismPickBtn'), menu = $('prismPickMenu');
  if (!btn || !menu) return;
  const all = prismProcesses();
  const cur = all.find((p) => p.id && p.id === prismPad.source) || all[0];
  btn.innerHTML = `${PRISM_PIC.procIcon(cur)}<span>${prismEsc(cur.label)}</span>`;
  btn.setAttribute('aria-expanded', String(prismPick.open));
  menu.hidden = !prismPick.open;
  if (!prismPick.open) return;
  // Fixed to the screen under the button: the header clips what overflows it.
  const r = btn.getBoundingClientRect();
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 3)}px`;
  const col = (cats) => cats.map((c) => {
    const items = all.filter((p) => p.cat === c);
    if (!items.length) return '';
    const name = PRISM_GROUPS.find(([k]) => k === c)?.[1] || c;
    return `<div class="ppick-g" role="group" aria-label="${prismEsc(name)}"><i>${prismEsc(name)}</i>${items.map((p) => {
      const on = p.id && p.id === prismPad.source;
      return `<button type="button" role="option" class="ppick-i${on ? ' on' : ''}" aria-selected="${!!on}" data-kind="${prismEsc(p.kind)}" data-id="${prismEsc(p.id || '')}"`
        + ` title="${p.id ? '' : 'Adds it to Prism\'s chain'}">${PRISM_PIC.procIcon(p)}<span>${prismEsc(p.label)}</span></button>`;
    }).join('')}</div>`;
  }).join('');
  menu.innerHTML = PRISM_MENU_COLUMNS.map((cats) => `<div class="ppick-col">${col(cats)}</div>`).join('');
  menu.querySelectorAll('.ppick-i').forEach((b) => { b.onclick = () => prismPickChoose(b.dataset.kind, b.dataset.id); });
  menu.querySelector('.ppick-i.on')?.focus({ preventScroll: true });
}

/// A process chosen: on the pad if it is there, added to the chain if not.
async function prismPickChoose(kind, id) {
  prismPick.open = false;
  prismPickerRender();
  if (!id) {
    if (!prismDeck.path && state.selectedFile?.path) await prismDeckUse(state.selectedFile.path, { chosen: false });
    if (!prismDeck.path) { toast('Choose a sound for Prism first'); return; }
    await prismChainAdd(kind);
    id = prismDeck.rack.slots.filter((s) => s.kind === kind).pop()?.id;
    if (!id) return;
  }
  hsSetSource(id);
}

function prismPickerWire() {
  const btn = $('prismPickBtn');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.onclick = (e) => { e.stopPropagation(); prismPick.open = !prismPick.open; prismPickerRender(); };
  window.addEventListener('pointerdown', (e) => {
    if (prismPick.open && !e.target.closest('#prismPick')) { prismPick.open = false; prismPickerRender(); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && prismPick.open) { prismPick.open = false; prismPickerRender(); btn.focus(); }
  });
}

// ───────────────────────────────────────────── bars that follow

/// Bars whose setting something else also moves (a preset, the pad, a take):
/// they are put right each frame the LFOs run, unless a hand is on them.
const prismFollowers = [];
function prismFollow(row, get) { prismFollowers.push([row, get]); }
function prismFollowAll() {
  for (const [row, get] of prismFollowers) {
    const input = row.querySelector(':scope > input[type=range]');
    if (!input || input.classList.contains('gc-dragging') || document.activeElement === input) continue;
    const v = get();
    if (Number.isFinite(v) && Math.abs(v - (row.read ? row.read() : +input.value)) > 1e-6 * Math.max(1, Math.abs(v))) row.sync(v);
  }
}
