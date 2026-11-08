// ================================================================ Grain: the rack
//
// The effects: the rack in the tab row and the effects page. Nothing here keeps
// a chain of its own. The row is drawn from `state.rack`, and the page is the
// real `#dockEffects`, borrowed while it shows (the way Visual › Sound borrows
// `#grainControls`, `170-room.js`) and dressed by `grain.css`. So the knobs, the
// EQ, the compressor, the faces, the picker, the ordering and `/api/rack/param`
// are the rack's own, and nothing about them differs on this page but the look.

const GS_FX = {
  view: 'eng', focus: null, sig: '', home: null, seen: false,
  // Which scale each effect was last given here. The effect only stores its
  // twelve notes; after a reload the dock says "custom", as the mock-up does.
  tunes: new Map(),
};

/// Short names for the tiles; anything else keeps a short name or its last word.
const GS_FXSHORT = {
  eq: 'EQ', comp: 'Comp', dattorro_plate: 'Plate', 'prism:dattorro-plate': 'Plate', 'prism:echo': 'Echo',
  'prism:lxp-hall': 'Hall', 'prism:lxp-plate': 'LXP Plate', 'prism:lxp-room': 'Room', 'prism:lxp-chamber': 'Chamber',
  'prism:sh-bubbler': 'Bubbler', 'sh-bubbler': 'Bubbler',
};
const gsFxName = (kind) => SLOT_META[kind]?.name || state.shapers[kind]?.label || kind;
function gsFxShort(kind) {
  if (GS_FXSHORT[kind]) return GS_FXSHORT[kind];
  const l = gsFxName(kind).replace(/^Hyperprism /, '');
  return l.length <= 10 ? l : l.split(' ').pop();
}

/// Which family of the add menu an effect is in, from that menu's own list.
let gsFxGroups = null;
function gsFxGroup(kind) {
  if (!gsFxGroups && Object.keys(state.shapers).length) {
    gsFxGroups = new Map();
    for (const { group, items } of fxPickerCatalogue()) for (const it of items) gsFxGroups.set(it.kind, group);
  }
  return gsFxGroups?.get(kind) || 'Utility & Shaping';
}

const GS_GICON = {
  'EQ & Compression': 'M2 9 C5 9,6 3,9 3 S13 9,16 9',
  'Reverb & Delay': 'M2 3 V11 M6 5 V9 M10 6 V8 M14 6.5 V7.5',
  'Chorus & Phasing': 'M2 5 C5 1,7 1,9 5 S13 9,16 5 M2 10 C5 6,7 6,9 10 S13 14,16 10',
  'Pitch & Motion': 'M2 11 L6 7 L10 9 L16 3',
  'Noise & Generators': 'M2 7 L3 4 L4 10 L5 3 L6 9 L7 5 L8 11 L9 4 L10 8 L11 6 L12 10 L13 3 L14 9 L16 7',
  Spectral: 'M2 12V8M5 12V4M8 12V6M11 12V2M14 12V9',
  'Utility & Shaping': 'M2 12 C4 12,5 3,8 3 H11 C13 3,13 12,16 12',
};
/// Each effect's own picture on its tile, or its family's when it has none.
const GS_RACKI = [
  [/(^|[^a-z])eq|equal/, 'M1 9 C4 9,5 3,8 3 S12 10,14 7 L17 6'],
  [/comp|limit/, 'M1 12 L9 5 L17 3 M1 5h3M6 5h2M11 5h2M15 5h2'],
  [/echo|delay/, 'M2 2v10M6 4v6M10 5.5v3M14 6.5v1'],
  [/plate/, 'M2 11 L5 3 H16 L13 11 Z M7 7h5'],
  [/hall|room|chamber|verb/, 'M2 3v8M5 4.5v6.5M8 6v5M11 7.5v3.5M14 9v2'],
  [/chorus|flang|phas/, 'M1 7 C3 2,5 2,7 7 S11 12,13 7 S16 3,17 5'],
  [/dist|drive|crush|fold/, 'M1 10 L4 10 L6 3 L9 11 L11 3 L13 10 H17'],
];
const gsRackIcon = (kind) => (GS_RACKI.find(([r]) => r.test(kind.toLowerCase())) || [0, GS_GICON[gsFxGroup(kind)]])[1];

// ──────────────────────────────────────────────────────────── the row

/// Drawn again only when the chain changes, whoever changed it, so a click in
/// progress keeps its target.
function gsFxBuildRow() {
  const el = $('gsFxStrip');
  if (!el) return;
  const slots = state.rack?.slots || [];
  const sig = slots.map((s) => `${s.id}${s.kind}${s.bypassed ? '-' : '+'}`).join(',') + (Object.keys(state.shapers).length ? 'y' : 'n');
  if (sig === GS_FX.sig) return;
  GS_FX.sig = sig;
  el.innerHTML = '<span class="gs-lab2 gs-btn" id="gsFxLab" title="Effects: every engine plays through these, in this order, before the output. Click to open them all; click again to go back"><b>FX</b><svg viewBox="0 0 16 8"><path d="M1 4h4M11 4h4"/><rect x="5" y="1.5" width="6" height="5" rx="1.5"/></svg></span>'
    + slots.map((s, i) => `${i ? '<span class="gs-ar">›</span>' : ''}<span class="gs-tile gs-btn ${s.bypassed ? 'off' : ''}" data-ci="${i}" data-id="${gsAttr(s.id)}" data-kind="${gsAttr(s.kind)}" title="${gsAttr(gsFxName(s.kind))}: click to open it · the light turns it on and off"><i class="gs-led" data-led="${i}"></i><svg class="gs-fxi" viewBox="0 0 18 14"><path d="${gsRackIcon(s.kind)}"/></svg><b>${gsAttr(gsFxShort(s.kind))}</b></span>`).join('')
    + '<span class="gs-tile gs-tplus gs-btn" id="gsFxPlus" title="Add an effect to the end of the chain">＋</span>';
  $('gsFxLab').onclick = () => gsFxSetView(GS_FX.view === 'fx' ? 'eng' : 'fx');
  $('gsFxPlus').onclick = () => { gsFxSetView('fx'); gsFxPicker(); };
  el.querySelectorAll('[data-led]').forEach((l) => { l.onclick = (e) => { e.stopPropagation(); gsFxBypass(+l.dataset.led); }; });
  el.querySelectorAll('[data-ci]').forEach((t) => { t.onclick = () => gsFxOpenAt(+t.dataset.ci); });
  gsFxMarkRow();
  gsFxFit();
}

/// The tile's light. The module's own power button, from here: the effect stays
/// where it is, and the page does not change.
function gsFxBypass(i) {
  const slot = state.rack?.slots[i];
  if (!slot) return;
  slot.bypassed = !slot.bypassed;
  pushRack({ immediate: true });
  gsFxBuildRow();
}

function gsFxMarkRow() {
  const strip = $('gsFxStrip');
  if (!strip) return;
  const open = GS_FX.view === 'fx';
  strip.classList.toggle('on', open);
  $('gsHead').classList.toggle('gs-fxopen', open);
  $('gsFxLab')?.classList.toggle('on', open);
  strip.querySelectorAll('.gs-tile[data-id]').forEach((t) => t.classList.toggle('sel', open && t.dataset.id === GS_FX.focus));
}

/// When the row runs out of width the arrows go first, then the names from the
/// last tile back, and last of all the pictures. The full name is in the tooltip.
function gsFxFit() {
  const strip = $('gsFxStrip'), head = $('gsHead');
  if (!strip || !head) return;
  strip.classList.remove('denser');
  const tiles = [...strip.querySelectorAll('.gs-tile[data-ci]')];
  tiles.forEach((t) => t.classList.remove('nm0', 'ic0'));
  const over = () => head.scrollWidth > head.clientWidth + 1;
  if (over()) strip.classList.add('denser');
  for (let i = tiles.length - 1; i >= 0 && over(); i--) tiles[i].classList.add('nm0');
  for (let i = tiles.length - 1; i >= 0 && over(); i--) tiles[i].classList.add('ic0');
}

// ───────────────────────────────────────────────────────────── the page

function gsFxPageHtml() {
  const lfos = [0, 1, 2, 3].map((i) => `<span class="gs-mapb gs-inert" style="--c:${GS_LCOL[i]};width:auto;padding:0 8px" title="Not connected yet: the LFOs arrive after note input">LFO ${i + 1}</span>`).join('');
  return `<section class="gs-view gs-fxview" id="gsFxView" hidden>
    <div class="gs-panel gs-chainmap"><span class="gs-nm">EFFECTS</span><span class="gs-hint">after every engine, before the output · drag a title to reorder</span><span class="gs-sp"></span><span class="gs-hint">Modulate</span>${lfos}<span class="gs-chip gs-btn" id="gsFxAddChip" title="Add an effect to the end of the chain">＋ Add effect</span><span class="gs-chip gs-btn" id="gsFxBack"></span></div>
    <div class="gs-fxrow" id="gsFxRow"></div>
    <div class="gs-fxbot">
     <div class="gs-fxcol">
      <div class="gs-panel gs-mod"><div class="gs-mh"><span class="gs-nm">OUT</span><span class="gs-sp"></span><span class="gs-hint" id="gsFxOutRo"></span></div><div class="gs-well"><canvas id="gsFxOut" data-w="978" data-h="66" title="Out: what leaves the chain, as it plays"></canvas></div></div>
      <div class="gs-panel gs-mod"><div class="gs-mh"><span class="gs-nm">SPECTRUM</span><span class="gs-sp"></span></div><div class="gs-well"><canvas id="gsFxSpec" data-w="978" data-h="66" title="Spectrum: after the chain, 20 Hz to 20 kHz"></canvas></div></div>
     </div>
     <div class="gs-panel gs-mod gs-fxfad"><div class="gs-mh"><span class="gs-nm">OUTPUT</span><span class="gs-sp"></span></div><div class="gs-faders">
      <div class="gs-fd gs-inert" title="Not connected yet: the engine has one output level, so L alone cannot be set"><b>L</b><div class="gs-well"><canvas id="gsFdL" data-w="40" data-h="140"></canvas></div><span class="gs-ro" id="gsFdLRo"></span></div>
      <div class="gs-fd" title="LR: the output level, the transport's own. Drag up and down · double-click: back to the default"><b>LR</b><div class="gs-well"><canvas id="gsFdLR" data-w="40" data-h="140"></canvas></div><span class="gs-ro" id="gsFdLRRo"></span></div>
      <div class="gs-fd gs-inert" title="Not connected yet: the engine has one output level, so R alone cannot be set"><b>R</b><div class="gs-well"><canvas id="gsFdR" data-w="40" data-h="140"></canvas></div><span class="gs-ro" id="gsFdRRo"></span></div>
     </div></div>
     <div class="gs-panel gs-mod gs-fxmet"><div class="gs-mh"><span class="gs-nm">METERS</span><span class="gs-sp"></span></div><div class="gs-well"><canvas id="gsFxMeters" data-w="148" data-h="170" title="Meters: VU and peak for L and R, and the correlation between them (−1 to +1)"></canvas></div></div>
    </div>
   </section>`;
}

/// Bring the real rack onto the page. Only ever while it is showing: anywhere
/// else, `#dockEffects` is where it has always been.
function gsFxBorrow() {
  const el = $('dockEffects'), host = $('gsFxRow');
  if (!el || !host || el.parentNode === host) return;
  GS_FX.home = { parent: el.parentNode, next: el.nextSibling, hidden: el.classList.contains('hidden') };
  host.appendChild(el);
  // The rack's meters and curves repaint only while it is not hidden.
  el.classList.remove('hidden');
  gsFxAddCard();
  if (!GS_FX.obs) {
    GS_FX.obs = new MutationObserver(gsFxOnRackDrawn);
    GS_FX.obs.observe($('fxModuleRail'), { childList: true, subtree: true });
  }
  // Drawn again, as knobs: the rack's own drawing, nothing posted.
  renderRack();
  gsFxDress();
}

/// The last card in the rail: every family of effects, into the real add menu.
function gsFxAddCard() {
  const vp = document.querySelector('#gsFxRow .fx-module-viewport');
  if (!vp) return;
  const cat = Object.keys(state.shapers).length ? fxPickerCatalogue() : [];
  const total = cat.reduce((n, g) => n + g.items.length, 0);
  const card = wvH(`<div class="gs-mod gs-panel gs-addcard" id="gsFxAddCard"><div class="gs-mh"><span class="gs-nm">ADD</span><span class="gs-sp"></span><span class="gs-ro">${total} effects</span></div><div class="gs-addplus" title="Every effect, by kind">＋ ADD AN EFFECT</div>${cat.map((g) => `<div class="gs-addg" data-g="${gsAttr(g.group)}" title="${gsAttr(g.group)}: ${g.items.length} effects. Click to choose one"><svg viewBox="0 0 18 14"><path d="${GS_GICON[g.group] || ''}"/></svg>${gsAttr(g.group)}<b>${g.items.length}</b></div>`).join('')}</div>`);
  card.querySelector('.gs-addplus').onclick = () => gsFxPicker();
  card.querySelectorAll('[data-g]').forEach((g) => { g.onclick = () => gsFxPicker(g.dataset.g); });
  vp.appendChild(card);
}

function gsFxReturn() {
  const el = $('dockEffects'), h = GS_FX.home;
  if (!el || !h) return;
  GS_FX.home = null;
  h.parent.insertBefore(el, h.next);
  el.classList.toggle('hidden', h.hidden);
  $('gsFxAddCard')?.remove();
  closeFxPicker();
  // Drawn again, as it is everywhere else: none of this page's dress stays on it.
  renderRack();
}

/// Anything built inside the rail is dressed; a knob repainting is not news.
function gsFxOnRackDrawn(list) {
  if (!GS_FX.home) return;
  const built = (n) => n.nodeType === 1 && (n.matches('.fx-module, .fxk, .sh-cell, .lex-knob') || n.querySelector?.('.fxk, .sh-cell, .lex-knob'));
  if (list.some((m) => [...m.addedNodes].some(built))) gsFxDress();
}

function gsFxPicker(group) {
  const p = $('fxPicker');
  if (!p) return;
  p.classList.remove('hidden');
  renderFxPicker(group);
}

function gsFxSetView(v) {
  if (GS_FX.view === v || !$('gsFxView')) return;
  GS_FX.view = v;
  const fx = v === 'fx';
  $('gsFxView').hidden = !fx;
  document.querySelector('#grainView .gs-view:not(.gs-fxview)').hidden = fx;
  if (fx) gsFxBorrow();
  else { gsFxReturn(); }
  gsFxMarkRow();
  gsFxFit();
  gsMarkTune();
}

/// A tile: the page, on that effect, brought into view and marked.
function gsFxOpenAt(i) {
  const slot = state.rack?.slots[i];
  if (!slot) return;
  GS_FX.focus = slot.id;
  gsFxSetView('fx');
  gsFxMarkRow();
  gsFxDress();
  gsMarkTune();
  requestAnimationFrame(() => {
    const vp = document.querySelector('#gsFxRow .fx-module-viewport'), card = document.querySelector(`#fxModuleRail > .fx-module[data-slot="${i}"]`);
    if (!vp || !card) return;
    vp.scrollTo({ left: card.offsetLeft - (vp.clientWidth - card.offsetWidth) / 2, behavior: 'smooth' });
    card.animate([{ boxShadow: '0 0 0 2px #ffb547' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 900 });
  });
}

/// Every effect control a knob, but only while the rack is on this page.
function gsFxKnobs() { return !!GS_FX.home; }

/// Pressing inside a module puts it in front, for the dock's tuning.
function gsFxWire() {
  gsCvs($('gsFxView'));
  $('gsFxAddChip').onclick = () => gsFxPicker();
  $('gsFxBack').onclick = () => gsFxSetView('eng');
  $('gsFxRow').addEventListener('pointerdown', (e) => {
    const m = e.target.closest?.('.fx-module[data-slot]');
    const slot = m && state.rack?.slots[+m.dataset.slot];
    if (slot && GS_FX.focus !== slot.id) { GS_FX.focus = slot.id; gsFxMarkRow(); gsFxDress(); gsMarkTune(); }
  }, true);
  const vol = GS_CV.gsFdLR;
  const setVol = (e) => {
    const input = $('volume');
    input.value = String(wvClamp(1 - (wvLocal(vol.el, e)[1] - 8) / (vol.h - 16)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  gsDrag(vol.el, (a, b, e) => setVol(e), setVol);
  vol.el.ondblclick = () => { const input = $('volume'); input.value = input.defaultValue; input.dispatchEvent(new Event('input', { bubbles: true })); };
}

// ─────────────────────────────────────────────── what the page adds to a module

const gsFxOf = (m) => state.rack?.slots[+m.dataset.slot];
const GS_FX_CAT = { 'EQ & Compression': 'EQ & dynamics', 'Reverb & Delay': 'reverb & delay', 'Chorus & Phasing': 'chorus & phasing', 'Pitch & Motion': 'pitch & motion', 'Noise & Generators': 'noise', Spectral: 'spectral', 'Utility & Shaping': 'utility' };
/// A face of its own: these keep the width they were drawn for.
const GS_FX_OWNW = /^(eq|comp|gate|maximizer|prism:eq|prism:compressor|prism:gate|prism:maximizer)$/;
/// Tiny pictures for the reverb and delay knobs, each in the knob's own empty corner.
const GS_FKI = [
  [/bass/i, 'M1 3 C3 3,4 6.5,6 6.5 H11'],
  [/rfl|refl/i, 'M2 1v8M6 4v5M10 6v3'],
  [/pre ?delay|predelay/i, 'M1 8.5 H4 V1.5 C6 1.5,7 8,11 8.5'],
  [/early/i, 'M2 9V2M4 9V4M6 9V3M8 9V6'],
  [/mix|wet|dry/i, 'M1 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  [/feedback|regen/i, 'M2 3h6a2 2 0 0 1 0 4H3M5 5L3 7l2 2'],
  [/damp|cut|roll|bandwidth|tone/i, 'M1 3h5 C8.5 3,9.5 6,11 9'],
  [/size|room|space/i, 'M1 1h10v8H1zM4 3.5h4v3H4z'],
  [/diffus/i, 'M2 2h.1M6 3h.1M10 2h.1M3 6h.1M8 6.5h.1M5 8.5h.1M10 8.5h.1'],
  [/shape/i, 'M1 9 L3 2 L8 3.5 L11 9'],
  [/spread|width|stereo/i, 'M1 5h10M1 5l2-2M1 5l2 2M11 5l-2-2M11 5l-2 2'],
  [/spin|wander|mod|rate|depth|rand/i, 'M1 5 C2.5 1,4 1,5.5 5 S8.5 9,10 5'],
  [/slope/i, 'M2 1v8M5 3v6M8 5v4M11 7v2'],
  [/glide/i, 'M1 8.5 C5 8.5,7 1.5,11 1.5'],
  [/decay|reverb time|^rt|time$/i, 'M1 1.5 C3 1.5,4 8.5,11 8.5'],
  [/delay|time/i, 'M2 1v8M8 3v6M2 5h6'],
  [/level|gain|out/i, 'M1 9 L11 1 V9 Z'],
];
const gsFkIcon = (label) => GS_FKI.find(([r]) => r.test(label))?.[1];
const GS_FX_RING = '.fxk-ring,.sh-ring,.lex-ring';
const GS_FX_CELL = '.fxk,.fxt,.sh-cell:not(.sh-keycap),.lex-knob';

/// One width per effect, whatever its controls happen to be doing: a module of
/// knobs is as wide as its knobs laid out three deep.
function gsFxShape(m, slot) {
  const body = m.querySelector('.fx-module-controls');
  const page0 = m.querySelector('.lex-page');
  const cells = [...m.querySelectorAll(GS_FX_CELL)].filter((c) => !page0 || c.closest('.lex-page') !== page0);
  const wide = [...m.querySelectorAll('.param:not(.sh-cell, .lex-knob, .fx-preview *)')].filter((c) => !page0 || c.closest('.lex-page') !== page0).length;
  const heads = m.querySelectorAll('.fx-sect > b .fx-led').length;
  // A knob-less moment (the Advanced page) is not a new width.
  if (!cells.length && !wide) return;
  // A strip of a dozen note keys needs six knobs' width to name them all.
  const n = Math.max(cells.length + wide * 4 + heads, m.querySelector('.sh-keys') ? 18 : 0);
  const own = GS_FX_OWNW.test(slot.kind);
  const W = own ? 348 : Math.max(wide ? 310 : 296, Math.ceil(n / 3) * 72 + 22);
  m.style.width = W + 'px';
  body.classList.add('gs-flat');
  body.classList.toggle('gs-own', own);
  body.style.setProperty('--gs-cols', Math.max(Math.ceil(n / 3), Math.min(n, Math.floor((W - 22) / 72)), wide ? 4 : 0));
}

/// A picture in the knob's empty corner, placed after the knob's own element so
/// anything looking up a knob's first svg still finds the knob.
function gsFxKnobIcons(m) {
  m.querySelectorAll(GS_FX_CELL).forEach((c) => {
    if (c.querySelector(':scope > .fki')) return;
    const ring = c.querySelector(GS_FX_RING), d = ring && gsFkIcon(ring.getAttribute('aria-label') || '');
    if (!d) return;
    ring.after(wvH(`<i class="fki"><svg viewBox="0 0 12 10"><path d="${d}"/></svg></i>`));
  });
}

/// What this page adds to a module the rack has drawn: nothing the rack reads.
function gsFxDress() {
  document.querySelectorAll('#fxModuleRail > .fx-module').forEach((m) => {
    const slot = gsFxOf(m);
    if (!slot) return;
    m.classList.toggle('gs-front', slot.id === GS_FX.focus);
    const fresh = !m.querySelector('.gs-cat');
    if (fresh) {
      const c = document.createElement('span');
      c.className = 'gs-cat';
      c.textContent = GS_FX_CAT[gsFxGroup(slot.kind)] || '';
      m.querySelector('h2')?.after(c);
    }
    gsFxShape(m, slot);
    // The family is the last thing a narrow module can lose: never truncated.
    if (fresh) {
      const head = m.querySelector('.fx-module-head'), c = m.querySelector('.gs-cat');
      if (head.scrollWidth > head.clientWidth + 1) c.hidden = true;
      // A long name widens its module once and for all rather than being cut.
      const over = head.scrollWidth - head.clientWidth;
      if (over > 0) m.style.width = (m.offsetWidth + over + 2) + 'px';
    }
    if (gsFxGroup(slot.kind) === 'Reverb & Delay') gsFxKnobIcons(m);
  });
}

// ──────────────────────────────────────────────────────── the dock's tuning

const gsFxHasTune = (slot) => !!slot && [...Array(12).keys()].every((i) => (slot.params || {})[`key${i}`] !== undefined);

/// Whose tuning the dock shows: the effect in front, if it keeps one of its own.
function gsDockCtx() {
  const slot = GS_FX.view === 'fx' ? (state.rack?.slots || []).find((s) => s.id === GS_FX.focus) : null;
  if (gsFxHasTune(slot)) return { who: gsFxShort(slot.kind), name: GS_FX.tunes.get(slot.id)?.name || 'custom', slot };
  return { who: 'Grain', name: gsTuneName(), slot: null };
}

/// A scale on an effect that keeps one: its twelve notes, from the scale's degrees.
function gsFxTune(slot, scale, step, groups) {
  const s = scale != null ? groups.flatMap((g) => g.scales).find((x) => x.name === scale) : null;
  const on = new Set(s ? s.cents.map((c) => ((Math.round(c / 100) % 12) + 12) % 12) : [...Array(12).keys()]);
  for (let i = 0; i < 12; i++) {
    const k = `key${i}`, v = on.has(i) ? 1 : 0;
    slot.params[k] = v;
    liveParam(slot.id, k, v);
  }
  GS_FX.tunes.set(slot.id, { scale: scale || '', step: scale == null ? step : -1, name: s ? s.name : step === 1 ? 'Semitone grid' : step === 0.5 ? 'Half-semitone grid' : 'Free' });
  commitRack();
  renderRack();
  gsMarkTune();
}

// ──────────────────────────────────────────────────── the output, under the rack

/// The dB reading of the output level, whose scale is the transport's own.
const gsFxVol = () => +$('volume').value;

function gsFxFader(id, roId, u, text, cl) {
  const g = GS_CV[id];
  if (!g) return;
  const { c, w, h } = g, y = 8 + (1 - u) * (h - 16);
  c.clearRect(0, 0, w, h);
  c.fillStyle = cl.track;
  c.fillRect(w / 2 - 1, 8, 2, h - 16);
  c.fillStyle = `rgba(${cl.bloom},.55)`;
  c.fillRect(w / 2 - 1, y, 2, h - 8 - y);
  c.fillStyle = cl.t;
  c.beginPath(); c.roundRect(w / 2 - 12, y - 3, 24, 6, 2); c.fill();
  gsTxt(roId, text);
}

function gsFxDrawOutput() {
  const cl = gsCl(), m = GS.master;
  const o = GS_CV.gsFxOut;
  if (o) {
    const { c, w, h } = o, xy = m?.lissajous;
    c.clearRect(0, 0, w, h);
    if (!xy || xy.length < 8) {
      c.strokeStyle = `rgba(${cl.bloom},.15)`;
      c.beginPath(); c.moveTo(8, h / 2); c.lineTo(w - 8, h / 2); c.stroke();
    } else {
      const n = xy.length / 2;
      wvTrace(c, wvPath((u) => { const i = Math.min(n - 1, Math.floor(u * n)); return [8 + u * (w - 16), h / 2 - wvClamp((xy[i * 2] + xy[i * 2 + 1]) * 0.9, -1, 1) * (h / 2 - 6)]; }, 500), cl, 1.2, 0.6);
    }
    c.font = `9px ${cl.mono}`;
    c.fillStyle = cl.t3; c.textAlign = 'right';
    c.fillText('after the chain', w - 8, 11);
    c.textAlign = 'left';
  }
  const sp = GS_CV.gsFxSpec;
  if (sp) {
    const { c, w, h } = sp, b = m?.spectrum;
    c.clearRect(0, 0, w, h);
    c.font = `9px ${cl.mono}`;
    c.fillStyle = cl.t3;
    for (const [f, label] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
      const x = 8 + Math.log(f / 20) / Math.log(1000) * (w - 16);
      c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x, 0, 1, h);
      c.fillStyle = cl.t3; c.fillText(label, x + 3, h - 4);
    }
    if (b?.length) {
      const L = b.length;
      wvTrace(c, wvPath((u) => { const v = b[Math.min(L - 1, Math.floor(u * L))]; return [8 + u * (w - 16), h - 4 - wvClamp((v + 84) / 84) * (h - 10)]; }, 400), cl, 1.2, 0.6);
    }
  }
  const v = gsFxVol(), l = m ? m.left : null, r = m ? m.right : null;
  gsFxFader('gsFdLR', 'gsFdLRRo', v, Math.round(v * 100) + '%', cl);
  for (const [id, ro, ch] of [['gsFdL', 'gsFdLRo', l], ['gsFdR', 'gsFdRRo', r]]) gsFxFader(id, ro, 0, ch ? (ch.vuDb <= -119 ? '−∞' : ch.vuDb.toFixed(1)) : '—', cl);
  const g = GS_CV.gsFxMeters;
  if (g) {
    const { c, w, h } = g, top = 30, bot = h - 34, y = (db) => top + (Math.max(-60, Math.min(6, db)) / -66 + 6 / 66) * (bot - top);
    c.clearRect(0, 0, w, h);
    c.font = `9px ${cl.mono}`;
    c.fillStyle = cl.t3;
    c.textAlign = 'left';
    c.fillText('PEAK', 6, 11);
    c.textAlign = 'right';
    c.fillText((l ? (l.peakDb <= -119 ? '−∞' : l.peakDb.toFixed(1)) : '−∞') + '  ' + (r ? (r.peakDb <= -119 ? '−∞' : r.peakDb.toFixed(1)) : '−∞') + ' dB', w - 6, 11);
    for (const db of [6, 0, -6, -12, -24, -36, -48, -60]) { c.fillText(db > 0 ? '+' + db : String(db), w - 4, y(db) + 3); c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(44, y(db), w - 76, 1); c.fillStyle = cl.t3; }
    c.textAlign = 'center';
    [['L', l, 60], ['R', r, 100]].forEach(([t, ch, x]) => {
      c.fillStyle = cl.t3; c.fillText(t, x, top - 5);
      c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(x - 6, top, 12, bot - top);
      if (!ch) return;
      c.fillStyle = `rgba(${cl.bloom},.8)`;
      const yy = y(Math.max(-60, ch.vuDb));
      c.fillRect(x - 6, yy, 12, bot - yy);
      c.fillStyle = cl.on;
      c.fillRect(x - 6, y(ch.peakDb), 12, 2);
    });
    const corr = m ? m.correlation : 0, cy = h - 14, x0 = 8, cw = w - 16;
    c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(x0, cy - 3, cw, 6);
    c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(x0 + cw / 2 - 0.5, cy - 6, 1, 12);
    const cv = x0 + (corr + 1) / 2 * cw;
    c.fillStyle = corr < 0 ? '#ff6b5e' : cl.acc;
    c.fillRect(Math.min(cv, x0 + cw / 2), cy - 3, Math.abs(cv - (x0 + cw / 2)), 6);
    c.fillStyle = cl.t3;
    c.textAlign = 'left'; c.fillText('−1', x0, cy - 7);
    c.textAlign = 'right'; c.fillText('+1', x0 + cw, cy - 7);
    c.textAlign = 'center'; c.fillText(`CORR ${corr >= 0 ? '+' : '−'}${Math.abs(corr).toFixed(2)}`, w / 2, cy - 7);
    c.textAlign = 'left';
  }
}

// ─────────────────────────────────────────────────────── the frame

function gsFxTick() {
  gsFxBuildRow();
  if (GS_FX.view === 'fx') gsDrawMeters();
  if (GS_FX.view !== 'fx') return;
  gsTxt('gsFxBack', '◂ Back to ' + gsEngName(GS.engine));
  gsFxDrawOutput();
}

function gsFxLeave() {
  gsFxSetView('eng');
}
