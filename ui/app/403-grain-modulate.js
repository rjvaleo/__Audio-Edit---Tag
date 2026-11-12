// ================================================================ Grain: MODULATE
//
// AMP and LFO 1–4, all open, one row each, between the trace and the engine's
// own controls. AMP is live: drag its points. The LFOs run on the server
// (`core/crates/server/src/grain_lfos.rs`), which carries their phases and is
// heard; this part edits their settings and draws where they are. The values
// are kept in `GS.amp` and `GS.lfo`, travel with A and B, and are kept per sound
// (`gsVoiceKeep`).
//
// **What an LFO moves is the sound, not the setting.** A bar's draft and a
// knob's slot stay what the hand left them at, and what you hear is reported
// back by `/api/engine/lfos` for the indicators. Map works as on Prism and
// idMLab: press Map, then click the control. Shift-click for several, click a
// mapped one again to take it off, Esc to stop.

const GS_LCOL = ['#5cc8e6', '#a48cf2', '#ee72a8', '#9bd36c'];
const GS_SHAPES = [
  ['sine', 'Sine', 'M1 7 C3 0,6 0,8 7 S13 14,15 7'],
  ['tri', 'Triangle', 'M1 7 L4.5 1 L11.5 13 L15 7'],
  ['up', 'Saw up', 'M1 13 L14 1 V13'],
  ['down', 'Saw down', 'M1 1 L14 13 V1'],
  ['square', 'Square', 'M1 2 H8 V12 H15'],
  ['steps', 'Random steps', 'M1 9 H4 V3 H7 V11 H10 V5 H13 V8 H15'],
  ['smooth', 'Smooth random', 'M1 9 C3 9,3 3,5 3 S7 11,9 11 S12 5,15 6'],
];
const GS_DIVS = ['8 bars', '4 bars', '2 bars', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32'];

const gsRnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function gsLfoVal(s, u, cyc = 0) {
  if (u !== 1) u = ((u % 1) + 1) % 1;
  switch (s.shape) {
    case 'sine': return 0.5 + 0.5 * Math.sin(u * WV_TAU);
    case 'tri': return u < 0.25 ? 0.5 + 2 * u : u < 0.75 ? 1.5 - 2 * u : 2 * u - 1.5;
    case 'up': return u;
    case 'down': return 1 - u;
    case 'square': return u < 0.5 ? 1 : 0;
    case 'steps': return gsRnd(cyc * 8 + Math.floor(u * 8));
    default: {
      const k = u * 4, i = Math.floor(k), f = k - i, a = gsRnd(cyc * 4 + i), b = gsRnd(cyc * 4 + i + 1);
      return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * f));
    }
  }
}

function gsLfoRate(L) {
  if (L.sync) return GS_DIVS[Math.round(L.rate * (GS_DIVS.length - 1))];
  const h = 0.02 * Math.pow(2000, L.rate);
  return h < 1 ? h.toFixed(2) + ' Hz' : h < 10 ? h.toFixed(1) + ' Hz' : Math.round(h) + ' Hz';
}

function gsBuildModulate() {
  $('gsRMod').innerHTML = GS.lfo.map((L, i) => `<div class="gs-lfr" style="--c:${GS_LCOL[i]}">
   <div class="gs-well"><canvas id="gsLsc${i}" data-w="92" data-h="28"></canvas></div>
   <div class="gs-lcol">
    <div class="gs-lr1"><span class="gs-lnm">LFO ${i + 1}</span><div class="gs-seg gs-lshp" id="gsLshp${i}">${GS_SHAPES.map(([k, d, p]) => `<span data-s="${k}" title="${d}"><svg viewBox="0 0 16 14"><path d="${p}"/></svg></span>`).join('')}</div></div>
    <div class="gs-lr2"><div class="gs-seg" id="gsLmode${i}"><span data-m="free" title="Free: runs on its own clock, whatever you play">Free</span><span data-m="trig" title="Each note: starts from the top of its cycle at every key">Each note</span></div><div class="gs-seg" id="gsLsync${i}"><span data-y="0" title="Rate in hertz">Hz</span><span data-y="1" title="Rate in bars and beats at the tempo">Tempo</span></div></div>
   </div>
   <div class="gs-sk" id="gsLkr${i}"></div>
   <div class="gs-sk" id="gsLkd${i}"></div>
   <div class="gs-lmap"><span class="gs-mapb" id="gsLmap${i}"></span><div class="gs-ltg" id="gsLtg${i}"></div></div>
  </div>`).join('');
  gsCvs($('gsPMod'));
  gsWireLfos();
  gsMarkLfo();
  gsDrawModulate();
}

/// Where AMP's points are drawn.
function gsAmpPts(g, E) {
  const { w, h } = g, x0 = 8, W = w - 16;
  const ta = Math.sqrt(E.a) * 0.22 * W, td = Math.sqrt(E.d) * 0.26 * W, hold = 0.16 * W, tr = Math.sqrt(E.r) * 0.36 * W, top = 8, bot = h - 8, sy = bot - (bot - top) * E.s;
  return { o: [x0, bot], a: [x0 + ta, top], d: [x0 + ta + td, sy], s: [x0 + ta + td + hold, sy], r: [x0 + ta + td + hold + tr, bot] };
}

/// Grab the nearest point: attack and release move sideways, decay sideways and
/// up and down, which is the sustain.
function gsWireAmp() {
  const g = GS_CV.gsAmp, E = GS.amp;
  let eh = null;
  gsDrag(g.el, (dx, dy) => {
    if (!eh) return;
    if (eh === 'a') E.a = wvClamp(E.a + dx / 140, 0.005, 1);
    else if (eh === 'd') { E.d = wvClamp(E.d + dx / 140, 0.01, 1); E.s = wvClamp(E.s - dy / 60); }
    else E.r = wvClamp(E.r + dx / 140, 0.01, 1);
    gsDrawModulate();
    gsVoicePost(gsAmpSecs(E));
  }, (e) => {
    const P = gsAmpPts(g, E), x = wvLocal(g.el, e)[0], d = [P.a[0], P.d[0], P.r[0]].map((q) => Math.abs(q - x));
    eh = ['a', 'd', 'r'][d.indexOf(Math.min(...d))];
  }, () => { eh = null; gsVoiceKeep(); });
}

function gsDrawModulate() {
  const cl = gsCl(), E = GS.amp;
  const g = GS_CV.gsAmp;
  if (g) {
    const { c, w, h } = g, P = gsAmpPts(g, E);
    c.clearRect(0, 0, w, h);
    const p = new Path2D();
    p.moveTo(...P.o);
    p.quadraticCurveTo(P.o[0] + (P.a[0] - P.o[0]) * 0.35, P.a[1] + (P.o[1] - P.a[1]) * 0.25, ...P.a);
    p.quadraticCurveTo(P.a[0] + (P.d[0] - P.a[0]) * 0.15, P.d[1], ...P.d);
    p.lineTo(...P.s);
    p.quadraticCurveTo(P.s[0] + (P.r[0] - P.s[0]) * 0.15, P.r[1], ...P.r);
    wvUnder(c, p, P.o[0], P.r[0], h, 0, cl, 0.18);
    wvTrace(c, p, cl, 1.5);
    for (const k of ['a', 'd', 'r']) { c.fillStyle = cl.t; c.beginPath(); c.arc(...P[k], 3, 0, WV_TAU); c.fill(); }
    const ta2 = E.a ** 2 * 4 + 0.004, td2 = E.d ** 2 * 4, tr2 = E.r ** 2 * 6;
    gsTxt('gsAmpRo', `${gsFmtS(ta2)} · ${gsFmtS(td2)} · ${Math.round(E.s * 100)} % · ${gsFmtS(tr2)}`);
  }
  gsDrawLfos();
}

// ─────────────────────────────────────────────────────────────── the LFOs

const GS_DIVB = [32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125];
const gsLfoHz = (L) => 0.02 * Math.pow(2000, L.rate);
const gsLfoBeats = (L) => GS_DIVB[Math.round(L.rate * (GS_DIVB.length - 1))];
/// The sequencer's tempo, as its bridge last sent it (`seq.tempo`).
const gsLfoBpm = () => (seq.tempo?.bpm > 0 ? seq.tempo.bpm : 120);

/// The mapping in progress and what the server last said.
const GS_L = {
  mapI: null, refuse: {}, heard: {}, phase: [0, 0, 0, 0], hz: [1, 1, 1, 1], at: 0,
  poll: 0, busy: false, sending: false, again: false, sentBpm: 0, eat: false, got: false,
};

// ─────────────────────────────────────────────────────── what a target is called

const GS_LFO_ROOT = { s: 'stretch', g: 'stretch.grain', w: 'stretch.wsola', v: 'stretch.vocoder', p: 'stretch.pvsola', h: 'stretch.hybrid' };
/// A bar's name in the lane table, which is the name the server moves it by.
const gsLfoId = (k) => `${GS_LFO_ROOT[GS_C[k].at]}.${GS_C[k].key}`;
let gsLfoKeys = null;
function gsLfoKeyOf(id) {
  if (!gsLfoKeys) { gsLfoKeys = {}; for (const k in GS_C) if (!GS_C[k].sw && !GS_C[k].seg) gsLfoKeys[gsLfoId(k)] = k; }
  return gsLfoKeys[id];
}

const gsSlotOf = (id) => id.startsWith('fx.') ? { slotId: id.slice(3, id.indexOf('.', 3)), key: id.slice(id.indexOf('.', 3) + 1) } : null;
const gsRackSlot = (slotId) => (state.rack?.slots || []).find((s) => s.id === slotId);

const GS_FX_MAP_CELL = '.fxk,.sh-cell:not(.sh-switch):not(.sh-keycap),.lex-knob';
const GS_EQ_RANGE = { freq: { min: 20, max: 20000, log: true }, gainDb: { min: -24, max: 24 }, q: { min: 0.05, max: 18, log: true } };

/// A knob's key on its slot: the selected band's when it is an EQ's.
function gsCellKey(cell, m) {
  const k = cell.dataset.key;
  if (!k) return null;
  return cell.closest('.fx-eq-sel') ? `band.${eqBandSelections.get(+m.dataset.slot) ?? 2}.${k}` : k;
}

/// Its name on a chip and in a tooltip.
function gsLfoName(id) {
  const k = gsLfoKeyOf(id);
  if (k) return { short: GS_C[k].label, long: GS_C[k].full || GS_C[k].label };
  const at = gsSlotOf(id), slot = at && gsRackSlot(at.slotId);
  if (!slot) return null;
  const fx = gsFxShort(slot.kind);
  let label;
  if (at.key === 'slot.wet') label = 'Wet / dry';
  else if (at.key === 'slot.level') label = 'Level';
  else {
    const band = /^band\.(\d+)\.(.+)$/.exec(at.key);
    label = band ? `Band ${+band[1] + 1} ${band[2] === 'gainDb' ? 'gain' : band[2]}` : fxModel(slot).byKey[at.key]?.label || at.key;
  }
  return { short: label, long: `${fx} · ${label}` };
}

// ─────────────────────────────────────────────────────── telling the engine

function gsLfoTarget(id) {
  const k = gsLfoKeyOf(id);
  if (!k) return { t: id };
  const c = GS_C[k];
  return { t: id, lo: c.min, hi: c.max, curve: c.log ? 'log' : 'lin' };
}

function gsLfoPayload() {
  return {
    p: state.selectedFile?.path, bpm: gsLfoBpm(),
    lfos: GS.lfo.map((L) => ({
      shape: L.shape, mode: L.mode, depth: L.depth,
      ...(L.sync ? { beats: gsLfoBeats(L) } : { hz: gsLfoHz(L) }),
      targets: L.targets.map(gsLfoTarget),
    })),
  };
}

/// All four, whole; one at a time, the newest always last, so a drag on Rate
/// cannot arrive out of order.
async function gsLfoSend() {
  if (!state.selectedFile) return;
  GS_L.sentBpm = gsLfoBpm();
  if (GS_L.sending) { GS_L.again = true; return; }
  GS_L.sending = true;
  do {
    GS_L.again = false;
    try {
      const r = await postJSON('/api/engine/lfos', gsLfoPayload());
      if (r?.refused?.length) {
        for (const L of GS.lfo) L.targets = L.targets.filter((t) => !r.refused.includes(t));
        gsMarkLfo();
      }
    } catch { /* the next change says it again */ }
  } while (GS_L.again);
  GS_L.sending = false;
}

/// The LFOs have changed: heard, saved for this sound, and shown.
function gsLfoChanged() {
  gsLfoSend();
  gsVoiceKeep();
  gsMarkLfo();
}

/// Off the page they are off everything: the engine goes back to the settings.
function gsLfoOffAll() {
  postJSON('/api/engine/lfos', { off: true }).catch(() => {});
}

/// Where each LFO is and what each mapped control is sounding at.
async function gsLfoPoll() {
  if (!GS.showing || GS_L.busy) return;
  GS_L.busy = true;
  try {
    const r = await api('/api/engine/lfos');
    GS_L.at = performance.now();
    GS_L.heard = r.heard || {};
    r.lfos.forEach((l, i) => { GS_L.phase[i] = l.phase; GS_L.hz[i] = l.hz; });
    if (r.refuse && !GS_L.got) { GS_L.got = true; GS_L.refuse = r.refuse; gsLfoTitles(); }
    gsLfoPaint();
  } catch { /* no answer: the indicators stay put */ }
  GS_L.busy = false;
}

function gsLfoEnter() {
  if (!GS_L.poll) GS_L.poll = setInterval(gsLfoPoll, 40);
  gsLfoPoll();
}

function gsLfoLeave() {
  clearInterval(GS_L.poll);
  GS_L.poll = 0;
  gsEndMap();
  gsLfoOffAll();
}

// ──────────────────────────────────────────────────────────────── Map

function gsStartMap(i) {
  GS_L.mapI = i;
  gsLfoTitles();
  document.body.classList.add('gs-mapping');
  document.body.style.setProperty('--gs-mapc', GS_LCOL[i]);
  gsMarkLfo();
}

function gsEndMap() {
  if (GS_L.mapI == null) return;
  GS_L.mapI = null;
  document.body.classList.remove('gs-mapping');
  gsMarkLfo();
}

const GS_NOT_A_BAR = 'A switch or a choice: an LFO sweeps bars and knobs';

/// Whatever the pointer is over, as a target: its name, or why it cannot be one.
function gsMapFind(t) {
  const bar = t.closest('#grainView .gs-bc[data-k]');
  if (bar) {
    const c = GS_C[bar.dataset.k];
    if (c.sw || c.seg) return { why: GS_NOT_A_BAR };
    const id = gsLfoId(bar.dataset.k);
    return GS_L.refuse[id] ? { why: GS_L.refuse[id] } : { id, el: bar };
  }
  if (t.closest('#gsSeedRow')) return { why: GS_L.refuse['stretch.grain.seed'] || 'The seed is the whole sound' };
  const m = t.closest('#fxModuleRail > .fx-module[data-slot]'), slot = m && gsFxOf(m);
  if (!slot) return null;
  const foot = t.closest('.gs-bc[data-f]');
  if (foot) return { id: `fx.${slot.id}.${GS_FXFOOT.find((c) => c.key === foot.dataset.f).param}`, el: foot };
  const cell = t.closest(GS_FX_MAP_CELL);
  if (cell) {
    const key = gsCellKey(cell, m);
    return key ? { id: `fx.${slot.id}.${key}`, el: cell } : null;
  }
  if (t.closest('.fxt,.sh-switch,.lex-choice,.fx-led,.fx-eq-on,.fx-eq-modes')) return { why: GS_NOT_A_BAR };
  return null;
}

/// Ahead of everything else, while Map is open: a press that finds a control
/// maps it and goes no further, so a bar is not also dragged.
function gsMapPress(e) {
  GS_L.eat = false;
  if (GS_L.mapI == null || !GS.showing || e.target.closest?.('.gs-mapb')) return;
  const hit = e.target.closest ? gsMapFind(e.target) : null;
  if (!hit) { if (!e.target.closest?.('#gsMenu')) gsEndMap(); return; }
  e.preventDefault();
  e.stopPropagation();
  GS_L.eat = true;
  if (hit.why) { toast(hit.why); return; }
  const L = GS.lfo[GS_L.mapI], j = L.targets.indexOf(hit.id);
  if (j >= 0) L.targets.splice(j, 1);
  else L.targets.push(hit.id);
  hit.el.animate([{ boxShadow: `0 0 0 2px ${GS_LCOL[GS_L.mapI]}` }, { boxShadow: '0 0 0 0 transparent' }], { duration: 600 });
  if (!e.shiftKey) { GS_L.mapI = null; document.body.classList.remove('gs-mapping'); }
  gsLfoChanged();
}

function gsWireMap() {
  document.addEventListener('pointerdown', gsMapPress, true);
  // The click a mapping press is followed by is the mapping's, not the switch's.
  document.addEventListener('click', (e) => {
    if (GS_L.eat) { GS_L.eat = false; e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (GS.showing && e.key === 'Escape' && GS_L.mapI != null) { e.stopPropagation(); gsEndMap(); }
  }, true);
}

/// Say what will not map, and why, on the control itself.
function gsLfoTitles() {
  const say = (el, why) => {
    if (!el || el.dataset.noMap) return;
    el.dataset.noMap = '1';
    el.classList.add('gs-nomap');
    el.title = `${el.title ? el.title + '. ' : ''}Cannot be mapped to an LFO: ${why}`;
  };
  for (const k in GS_BARS) {
    const c = GS_C[k], why = c.sw || c.seg ? GS_NOT_A_BAR : GS_L.refuse[gsLfoId(k)];
    if (why) for (const el of GS_BARS[k]) say(el, why);
  }
  say($('gsSeedRow'), GS_L.refuse['stretch.grain.seed'] || 'The seed is the whole sound');
  document.querySelectorAll('#fxModuleRail .fxt, #fxModuleRail .sh-switch, #fxModuleRail .lex-choice').forEach((el) => say(el, GS_NOT_A_BAR));
}

// ───────────────────────────────────────────────────── the rows' own controls

function gsWireLfos() {
  GS.lfo.forEach((L, i) => {
    document.querySelectorAll(`#gsLshp${i} span`).forEach((s) => { s.onclick = () => { L.shape = s.dataset.s; gsLfoChanged(); }; });
    document.querySelectorAll(`#gsLmode${i} span`).forEach((s) => { s.onclick = () => { L.mode = s.dataset.m; gsLfoChanged(); }; });
    document.querySelectorAll(`#gsLsync${i} span`).forEach((s) => { s.onclick = () => { L.sync = s.dataset.y === '1'; gsLfoChanged(); }; });
    $('gsLmap' + i).onclick = () => { if (GS_L.mapI === i) gsEndMap(); else gsStartMap(i); };
    // The shared knob at 26 (`073a-ui-knob.js`), its arc in the LFO's colour.
    const dial = (el, key, label, d, text) => {
      const k = uiKnob({
        label, size: 26, layout: 'beside', cls: 'gs-sk', sens: 150, fine: 5,
        get: () => L[key], set: (u) => { L[key] = u; gsLfoSend(); gsMarkLfo(); }, commit: () => gsVoiceKeep(),
        reset: () => { L[key] = d; gsLfoChanged(); }, def: d, text,
      });
      k.id = el.id;
      el.replaceWith(k);
    };
    dial($('gsLkr' + i), 'rate', 'Rate', 0.4, () => gsLfoRate(L));
    dial($('gsLkd' + i), 'depth', 'Depth', 0.5, () => `${Math.round(L.depth * 100)} %`);
  });
  // The effects page's header, built once and not touched by a rebuild here.
  for (let i = 0; i < 4; i++) { const b = $('gsLmapF' + i); if (b) b.onclick = () => { if (GS_L.mapI === i) gsEndMap(); else gsStartMap(i); }; }
}

/// Every label, chip and Map button.
function gsMarkLfo() {
  GS.lfo.forEach((L, i) => {
    if (!$('gsLshp' + i)) return;
    const on = (sel, f) => document.querySelectorAll(sel).forEach((s) => s.classList.toggle('on', f(s)));
    on(`#gsLshp${i} span`, (s) => s.dataset.s === L.shape);
    on(`#gsLmode${i} span`, (s) => s.dataset.m === L.mode);
    on(`#gsLsync${i} span`, (s) => (s.dataset.y === '1') === !!L.sync);
    const tip = (fx) => `Map LFO ${i + 1}: press, then click any control${fx ? ' or effect knob' : ''} to move it with LFO ${i + 1}. Shift-click to map several; click a mapped one again to unmap it. Esc ends`;
    const map = $('gsLmap' + i), mapF = $('gsLmapF' + i), mapping = GS_L.mapI === i;
    map.textContent = mapping ? 'CLICK A CONTROL' : 'MAP';
    map.classList.toggle('on', mapping);
    map.title = tip(false);
    if (mapF) { mapF.textContent = mapping ? 'CLICK A KNOB' : `LFO ${i + 1}`; mapF.classList.toggle('on', mapping); mapF.title = tip(true); }
    const kr = $('gsLkr' + i), kd = $('gsLkd' + i);
    kr.sync();
    kr.title = `Rate: ${gsLfoRate(L)}${L.sync ? ', locked to the tempo' : ''}. Drag up and down · ⇧ fine · double-click: reset`;
    kd.sync();
    kd.title = `Depth: how far LFO ${i + 1} moves everything it is mapped to, ${Math.round(L.depth * 100)} % of each control's range`;
    const names = L.targets.map((t) => [t, gsLfoName(t)]).filter(([, n]) => n), tg = $('gsLtg' + i);
    const chip = ([t, n]) => `<span class="gs-tgc" data-t="${gsAttr(t)}" title="LFO ${i + 1} moves ${gsAttr(n.long)}. Click × to unmap">${gsAttr(n.short)}<i title="Unmap">×</i></span>`;
    tg.innerHTML = names.length ? names.slice(0, 4).map(chip).join('') + (names.length > 4 ? `<span class="gs-tgc more">+${names.length - 4}</span>` : '') : '<span class="gs-hint">Moves nothing yet</span>';
    tg.querySelectorAll('.gs-tgc i').forEach((x) => { x.onclick = () => { const t = x.parentElement.dataset.t; L.targets = L.targets.filter((v) => v !== t); gsLfoChanged(); }; });
  });
  gsLfoPaint();
}

/// The colour and the reach of everything mapped.
function gsLfoAims() {
  const aims = new Map();
  GS.lfo.forEach((L, i) => {
    for (const t of L.targets) {
      const a = aims.get(t) || { c: GS_LCOL[i], d: 0 };
      a.d += L.depth;
      aims.set(t, a);
    }
  });
  return aims;
}

/// A bar's ring, its band and the dot where the sound is now.
function gsLfoMarkBar(el, a, n, m) {
  el.classList.toggle('mapped', !!a);
  if (!a) return;
  el.style.setProperty('--mc', a.c);
  const bm = el.querySelector('.gs-bm'), bd = el.querySelector('.gs-bd'), lo = wvClamp(n - a.d), hi = wvClamp(n + a.d);
  bm.style.left = `calc(4px + (100% - 8px) * ${lo.toFixed(4)})`;
  bm.style.width = `calc((100% - 8px) * ${(hi - lo).toFixed(4)})`;
  bd.style.left = `calc(4px + (100% - 8px) * ${wvClamp(m).toFixed(4)})`;
}

/// A knob's ring and a dot on it at the heard value; its reading follows.
function gsLfoMarkKnob(cell, a, u, text) {
  // The shared knob draws its own: the reach in the LFO's colour and the dot.
  if (cell.setMod) {
    cell.classList.toggle('gs-mapped', !!a);
    if (a) cell.style.setProperty('--mc', a.c);
    cell.setMod(a ? { rng: a.d, live: u, col: a.c } : null);
    if (a && text != null) cell.querySelector('.ui-kval').textContent = text;
    return;
  }
  const ring = cell.querySelector(GS_FX_RING);
  cell.classList.toggle('gs-mapped', !!a);
  if (!ring) return;
  let dot = ring.querySelector('.gs-kd');
  if (!a) {
    if (dot) dot.remove();
    if (cell._lfo) { cell._lfo = 0; cell.sync?.(); }
    return;
  }
  cell._lfo = 1;
  cell.style.setProperty('--mc', a.c);
  const vb = ring.viewBox.baseVal.width, cx = vb / 2, r = vb * 0.43, ang = Math.PI * 0.75 + wvClamp(u) * Math.PI * 1.5;
  if (!dot) {
    dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'gs-kd');
    dot.setAttribute('r', (vb * 0.075).toFixed(2));
    ring.appendChild(dot);
  }
  dot.setAttribute('cx', (cx + r * Math.cos(ang)).toFixed(2));
  dot.setAttribute('cy', (cx + r * Math.sin(ang)).toFixed(2));
  const read = cell.querySelector('.fxk-v, .v');
  if (read && text != null) read.textContent = text;
}

/// Every indicator on the page, from the last thing the server heard.
function gsLfoPaint() {
  const aims = gsLfoAims();
  for (const k in GS_BARS) {
    const c = GS_C[k];
    if (c.sw || c.seg) continue;
    const id = gsLfoId(k), a = aims.get(id), v = gsRead(k), n = gsToN(c, v), h = GS_L.heard[id];
    for (const el of GS_BARS[k]) gsLfoMarkBar(el, a, n, h == null ? n : gsToN(c, h));
  }
  document.querySelectorAll('#fxModuleRail > .fx-module[data-slot]').forEach((m) => {
    const slot = gsFxOf(m);
    if (!slot) return;
    const model = fxModel(slot);
    m.querySelectorAll(GS_FX_MAP_CELL).forEach((cell) => {
      const key = gsCellKey(cell, m);
      if (!key) return;
      const id = `fx.${slot.id}.${key}`, a = aims.get(id);
      if (!a) { gsLfoMarkKnob(cell, null); return; }
      const h = GS_L.heard[id], band = /^band\.\d+\.(.+)$/.exec(key), p = band ? null : model.byKey[key];
      const r = band ? GS_EQ_RANGE[band[1]] : p ? fxRange(model, p) : null;
      if (!r) return;
      const base = band ? (slot.bands ? slot.bands[+key.split('.')[1]]?.[band[1]] : slot.params?.[key]) : model.get(key);
      const v = h ?? base;
      gsLfoMarkKnob(cell, a, v == null ? 0 : fxUnit(r, v), v != null && p ? fxFormat(p, v) : null);
    });
    m.querySelectorAll('.gs-bc[data-f]').forEach((el) => {
      const c = GS_FXFOOT.find((x) => x.key === el.dataset.f), id = `fx.${slot.id}.${c.param}`, a = aims.get(id);
      const v = slot[c.key] ?? c.d, norm = (x) => (x - c.min) / (c.max - c.min), h = GS_L.heard[id];
      gsLfoMarkBar(el, a, norm(v), norm(h == null ? v : h));
    });
  });
}

// ───────────────────────────────────────────────────────── drawn each frame

/// The running phase now: the last the server said, carried on by its rate.
const gsLfoNow = (i, now) => GS_L.phase[i] + GS_L.hz[i] * Math.max(0, now - GS_L.at) / 1000;

function gsDrawLfos(now = performance.now()) {
  GS.lfo.forEach((L, i) => {
    const s = GS_CV['gsLsc' + i];
    if (!s || !s.el.offsetParent) return;
    const { c, w, h } = s, col = GS_LCOL[i], q = gsLfoNow(i, now), cyc = Math.floor(q), u0 = q - cyc, live = L.targets.length > 0;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,.05)';
    c.fillRect(4, h / 2, w - 8, 1);
    c.strokeStyle = col;
    c.globalAlpha = live ? 0.95 : 0.45;
    c.lineWidth = 1.4;
    c.stroke(wvPath((u) => [4 + u * (w - 8), h - 5 - gsLfoVal(L, u, cyc) * (h - 10)], 100));
    c.globalAlpha = 1;
    c.fillStyle = `color-mix(in srgb, ${col} 35%, transparent)`;
    c.fillRect(4 + u0 * (w - 8) - 0.5, 2, 1, h - 4);
    wvDot(c, 4 + u0 * (w - 8), h - 5 - gsLfoVal(L, u0, cyc) * (h - 10), 3, col);
  });
}

/// Once a frame: a tempo the sequencer has changed since it was told.
function gsLfoTick() {
  if (gsLfoBpm() !== GS_L.sentBpm && GS.lfo.some((L) => L.sync)) gsLfoSend();
}
