// ============================================================ Prism panel parts

/* The v7 Prism panel's own pieces (RJ, 6 Nov 2026, after the design council:
   "less color, less chaos, less candy, more professional"):

   - `prismBar`: a control as a bar with its picture, half the Controls column
     wide. It is the Grain tray's bar (a `param` row styled `gc-bars`, so a
     click sets the value, Shift drags fine and a double-click on the picture
     resets), with the Prism picture in front of it.
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
  row.classList.add('gk-row', 'prism-bar');
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
  mark.className = 'plfo-mark';
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
  paint();
  return row;
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

// ───────────────────────────────────────────── the panel fits its process

/// The dock grows to show all of the process on the pad, as the Grain tray's
/// does (`gkFit`), and goes back to the height you chose for a smaller one:
/// nothing is ever cut off at the foot of a bank (RJ: "shit's falling off the
/// bottom"). Never under the height you dragged it to.
function prismFit() {
  const host = $('dockHyper'), dock = $('dock');
  if (!host || !dock || !host.clientHeight || !document.body.classList.contains('prismpage')) return;
  const now = dock.getBoundingClientRect().height;
  if (dockBase === null) dockBase = Math.round(now);
  // Back to the chosen height first, so a smaller process gives the room back;
  // then grow by whatever still does not fit.
  if (now > dockBase + 1) setDockHeight(dockBase, false);
  requestAnimationFrame(() => {
    let over = 0;
    for (const bank of host.querySelectorAll('.hs-bank')) over = Math.max(over, bank.scrollHeight - bank.clientHeight);
    if (over > 1) setDockHeight(Math.ceil(dock.getBoundingClientRect().height + over), false);
  });
}
