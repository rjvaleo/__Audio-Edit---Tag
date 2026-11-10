// ================================================================ effect rack
//
// The rack is server-side: the browser edits a spec, posts it, and every
// subsequent render — waveform, playback, export — goes through it. Nothing is
// applied here, so removing an effect restores the original exactly.

state.rack = null;
state.rackSelected = 0;

const SLOT_META = {
  gain: { icon: 'G', name: 'Gain' },
  eq:   { icon: 'EQ', name: 'Parametric EQ' },
  comp: { icon: 'C', name: 'Compressor' },
};

// What shapers exist and what each one has, straight from the engine.
//
// Not written out here as well. Every shaper module is drawn from this, so an
// effect gains a control by declaring one in `fx::shape` and nothing in the
// interface needs touching — the same reason the rack has one slot kind for
// all of them rather than nine.
state.shapers = {};

async function loadShapers() {
  if (Object.keys(state.shapers).length) return;
  try {
    const r = await api('/api/fx');
    for (const s of r.shapers || []) state.shapers[s.kind] = s;
  } catch { /* the chain still works; only the shapers go missing */ }
  renderFxPicker();
}

function defaultFxSlot(kind) {
  const id = `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  if (kind === 'gain') return { id, kind, bypassed: false, db: 0 };
  if (kind === 'eq') return { id, kind, bypassed: false, bands: defaultEqBands() };
  if (kind === 'comp') return { id, kind, bypassed: false,
    thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 100, kneeDb: 6, makeupDb: 0 };
  const spec = state.shapers[kind];
  if (!spec) return null;
  const params = {};
  for (const p of spec.params) params[p.key] = p.default;
  return { id, kind, bypassed: false, params };
}

/// What a rack control was born with, for double-click reset.
///
/// Read from the same factory that creates a new module rather than from a
/// second table, so a reset can never disagree with what adding one gives you.
/// That is the whole reason `param` refuses to guess: a control that resets to
/// something which was never anybody's default is worse than one that plainly
/// does nothing.
function fxBorn(kind, key) {
  const s = defaultFxSlot(kind);
  return s ? s[key] : undefined;
}

/// The same, for one band of the EQ.
function eqBorn(index, key) {
  return defaultEqBands()[index]?.[key];
}

/// The three-band strip's own defaults, which are a different shape from the
/// band list: `slot.low` / `.mid` / `.high` rather than `slot.bands[i]`.
///
/// Mirrors `fx::eq::EqSettings::default()`. Two tables for one thing is exactly
/// what `fxBorn` avoids elsewhere by reading the factory — there is no factory
/// for this shape on the client, so the comment has to carry the promise
/// instead.
const EQ_STRIP_DEFAULTS = {
  low: { freq: 100, q: 0.7, gainDb: 0 },
  mid: { freq: 1000, q: 1, gainDb: 0 },
  high: { freq: 8000, q: 0.7, gainDb: 0 },
};

/// The same, for a shaper — whose defaults are declared by the server with the
/// rest of its parameter spec, so this is the only place they live.
function shaperBorn(kind, key) {
  return state.shapers?.[kind]?.params?.find((p) => p.key === key)?.default;
}

function addFxModule(kind) {
  if (!kind || !state.rack) return;
  const slot = defaultFxSlot(kind);
  if (!slot) return;
  state.rack.slots.push(slot);
  state.rackSelected = state.rack.slots.length - 1;
  closeFxPicker();
  pushRack({ immediate: true });
  renderRack();
}

/// The picker's catalogue: every effect that can be added, filed by kind, in
/// the order the kinds first appear.
function fxPickerCatalogue() {
  // A prism effect says what it is, so it is filed by that rather than by a
  // list of names here.
  const PRISM_GROUPS = { delay: 'Reverb & Delay', reverb: 'Reverb & Delay',
    modulation: 'Chorus & Phasing', pitch: 'Pitch & Motion', granular: 'Pitch & Motion',
    filter: 'EQ & Compression', dynamics: 'EQ & Compression', spectral: 'Spectral' };
  const groupFor = (kind) => {
    const prism = state.shapers[kind]?.category;
    if (prism) return PRISM_GROUPS[prism] || 'Utility & Shaping';
    if (['gain', 'eq', 'comp', 'gate', 'dattorro_notch', 'dattorro_resonator',
      'regalia_mitra', 'chamberlin', 'damping_filter', 'dc'].includes(kind)) return 'EQ & Compression';
    if (['dattorro_plate', 'allpass_diffuser', 'schroeder_reverb', 'moorer_reverb'].includes(kind)) return 'Reverb & Delay';
    if (['white_chorus', 'dattorro_flanger', 'dattorro_vibrato', 'leslie', 'phaser'].includes(kind)) return 'Chorus & Phasing';
    if (['harmonizer', 'detune', 'doubler', 'doppler', 'boomerang'].includes(kind)) return 'Pitch & Motion';
    if (['pn_noise', 'pn_noise_eq', 'single_bit_pn', 'ring'].includes(kind)) return 'Noise & Generators';
    return 'Utility & Shaping';
  };
  const catalogue = [
    { kind: 'eq', label: 'Parametric EQ' },
    { kind: 'comp', label: 'Compressor' },
    ...Object.values(state.shapers).filter((s) =>
      !['dc', 'gate', 'invert', 'swap', 'width', 'fit', 'dattorro_notch',
        'dattorro_resonator', 'regalia_mitra', 'damping_filter'].includes(s.kind)),
  ];
  const groups = new Map();
  for (const module of catalogue) {
    const category = groupFor(module.kind);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(module);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

/// A module drawn as it would arrive in the rack, for the picker to show:
/// its real face on its defaults, inert, so it is seen and never played.
function fxPreviewModule(kind) {
  const slot = defaultFxSlot(kind);
  if (!slot) return null;
  const shaper = state.shapers[kind];
  const el = document.createElement('section');
  el.className = 'fx-module fx-preview';
  el.dataset.kind = kind;
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<header class="fx-module-head"><h2></h2>
    <div class="fx-module-actions"><button class="ghost fx-power on">On</button>
    <button class="ghost danger fx-remove">Remove</button></div>
    </header><div class="fx-module-signal">
      <div class="fx-vu fx-vu-in"></div><div class="fx-module-controls"></div><div class="fx-vu fx-vu-out"></div>
    </div>`;
  el.querySelector('h2').textContent = SLOT_META[kind]?.name || shaper?.label || kind;
  renderVuMeter(el.querySelector('.fx-vu-in'), 'IN');
  renderVuMeter(el.querySelector('.fx-vu-out'), 'OUT');
  renderFxModuleControls(el.querySelector('.fx-module-controls'), slot, shaper, -1);
  return el;
}

/// A face shrunk into a frame of its own; the frame crops what runs below it.
function fxPickerThumb(kind, scale) {
  const frame = document.createElement('span');
  frame.className = 'fx-picker-thumb';
  frame.style.setProperty('--thumb-scale', scale);
  const face = fxPreviewModule(kind);
  if (face) frame.appendChild(face);
  return frame;
}

/// The picker shows the kinds first, each with a few of its faces; a kind
/// opened shows every effect in it as its face, and a face picked is added.
/// Nothing is drawn while the picker is shut.
function renderFxPicker(open) {
  const box = $('fxPickerGroups');
  if (!box) return;
  box.innerHTML = '';
  const title = $('fxPickerTitle');
  const back = $('fxPickerBack');
  if ($('fxPicker')?.classList.contains('hidden')) return;
  const catalogue = fxPickerCatalogue();
  const group = catalogue.find((g) => g.group === open);
  if (title) title.textContent = group ? group.group : 'Add module';
  if (back) back.hidden = !group;
  box.className = 'fx-picker-groups' + (group ? ' in-group' : '');
  if (!group) {
    for (const { group: name, items } of catalogue) {
      const tile = document.createElement('button');
      tile.className = 'fx-picker-cat';
      tile.dataset.group = name;
      tile.setAttribute('aria-label', `${name}, ${items.length} effects`);
      const faces = document.createElement('span');
      faces.className = 'fx-picker-cat-faces';
      for (const item of items.slice(0, 3)) faces.appendChild(fxPickerThumb(item.kind, 0.25));
      const label = document.createElement('span');
      label.className = 'fx-picker-cat-name';
      label.innerHTML = '<b></b><i></i>';
      label.querySelector('b').textContent = name;
      label.querySelector('i').textContent = String(items.length);
      tile.append(faces, label);
      tile.onclick = () => renderFxPicker(name);
      box.appendChild(tile);
    }
    return;
  }
  const section = document.createElement('section');
  section.className = 'fx-picker-group';
  section.dataset.group = group.group;
  for (const item of group.items) {
    const button = document.createElement('button');
    button.className = 'fx-picker-item';
    button.dataset.kind = item.kind;
    button.setAttribute('aria-label', item.label);
    const name = document.createElement('span');
    name.className = 'fx-picker-name';
    name.textContent = item.label;
    button.append(fxPickerThumb(item.kind, 0.25), name);
    button.onclick = () => addFxModule(item.kind);
    section.appendChild(button);
  }
  box.appendChild(section);
}

function closeFxPicker() {
  $('fxPicker')?.classList.add('hidden');
  renderFxPicker();
}

$('fxAdd').onclick = () => {
  $('fxPicker')?.classList.toggle('hidden');
  renderFxPicker();
};
$('fxPickerClose').onclick = closeFxPicker;
$('fxPickerBack').onclick = () => renderFxPicker();

async function loadRack() {
  await loadShapers();
  const f = state.selectedFile;
  if (!f) return;
  try {
    state.rack = await api(
      `/api/rack?p=${encodeURIComponent(f.path)}&sr=${state.view.sampleRate || 48000}`);
  } catch { state.rack = null; }
  renderRack();
}

/// Post the spec, then refresh everything that depends on it.
let rackTimer;

/// Move one control while the hand is still on it.
///
/// **Deliberately not the whole spec.** Posting the rack rebuilds every effect
/// in the chain from nothing — delay lines cleared, filters restarted, reverb
/// tails cut — and doing that thirty times a second while dragging is why the
/// effects did not sound connected to the control. `/api/rack/param` moves the
/// one number, on the effect that is already running.
///
/// Coalesced per control rather than globally: dragging the EQ's frequency must
/// not swallow the Q that moved in the same gesture.
const pendingLive = new Map();
let liveTimer = null;

function liveParam(slotId, key, value) {
  if (!slotId) return;
  pendingLive.set(`${slotId}\u0000${key}`, { id: slotId, key, value });
  if (liveTimer) return;
  liveTimer = setTimeout(async () => {
    liveTimer = null;
    const f = state.selectedFile;
    const batch = [...pendingLive.values()];
    pendingLive.clear();
    if (!f) return;
    for (const w of batch) {
      try {
        await postJSON('/api/rack/param', { p: f.path, id: w.id, key: w.key, value: w.value });
      } catch { /* the release commit reports a persistent failure */ }
    }
  }, 16);
}

/// Kept for the paths that still have no id to write against.
/// What a released control does.
///
/// The engine already has the value — `liveParam` sent it — so this is only
/// about everything *else* that has to agree: the waveform, the peaks, the
/// spectrogram and the saved session. Deliberately does not rebuild the live
/// rack, because there is nothing to rebuild it for and doing so would cut
/// every tail in the chain at the moment you let go of a slider.
async function commitRack() {
  const f = state.selectedFile;
  if (!f || !state.rack) return;
  try {
    // Adopted rather than assigned: a panel is holding these slot objects and
    // is about to be written to again. See `adoptRack`.
    const restructured = adoptRack(await postJSON('/api/rack', {
      p: f.path,
      sr: state.view.sampleRate || 48000,
      slots: state.rack.slots,
      master: state.rack.master,
      pads: state.rack.pads || {},
      postRoll: state.rack.postRoll || {},
      ranges: state.rack.ranges || {},
      // The engine is already where it needs to be; asking for a rebuild here
      // is what used to cut the reverb tail every time a control was released.
      keepLive: true,
    }));
    if (restructured) renderRack();
  } catch (e) { toast(e.message); return; }
  renderTabs();
  refreshAutomationTargets();
  // No peaks, no spectrogram. The waveform is the material now, and the rack
  // does not change the material — it is processing, and processing shows up in
  // the meters and in the speakers. Re-fetching the picture on every control
  // release was the single most expensive thing an effect could do.
}

/// Take the server's canonical rack without breaking what is holding the old one.
///
/// Every module panel captures its `slot` object when it is built — the
/// compressor's sliders write to it, its canvas draws from it. Replacing
/// `state.rack` wholesale with the reply orphaned that reference: from the
/// first commit onward the panel was writing to an object nothing else could
/// see, while anything that repainted read the fresh one. The two then
/// disagreed, and the next commit posted the *fresh* slot's values — undoing
/// the move that had just been made. Which is exactly what "the display and the
/// sliders fight each other, and any move puts them to one value" is.
///
/// The master panel already knew this and worked around it with a getter; the
/// module panels never did. Fixing it here fixes all of them at once, and means
/// a panel may go on holding its slot.
///
/// Structure changing — a module added, removed or reordered — genuinely needs
/// new objects, and the panels are rebuilt for it.
function adoptRack(fresh) {
  const cur = state.rack;
  const sameShape =
    cur &&
    Array.isArray(cur.slots) &&
    Array.isArray(fresh?.slots) &&
    cur.slots.length === fresh.slots.length &&
    cur.slots.every((s, i) => s.id === fresh.slots[i].id && s.kind === fresh.slots[i].kind);

  if (!sameShape) {
    state.rack = fresh;
    return true;
  }
  // Same modules in the same order: fill the objects that already exist rather
  // than swapping them, so identity survives. The reply is canonical — the
  // server has clamped and stored it — so writing it back over the local copy
  // is right, it just must not be a *different* copy.
  for (let i = 0; i < fresh.slots.length; i++) Object.assign(cur.slots[i], fresh.slots[i]);
  if (fresh.master) Object.assign(cur.master, fresh.master);
  if (fresh.slotIds) cur.slotIds = fresh.slotIds;
  // The Prism pad's setups, as the server checked them against the slots.
  if (fresh.pads) cur.pads = fresh.pads;
  // Each knob's own range, likewise (the Advanced page, `075-fx-faces.js`).
  if (fresh.ranges) cur.ranges = fresh.ranges;
  return false;
}

function pushRack({ immediate = false } = {}) {
  clearTimeout(rackTimer);
  const send = async () => {
    const f = state.selectedFile;
    if (!f || !state.rack) return;
    try {
      adoptRack(await postJSON('/api/rack', {
        p: f.path,
        sr: state.view.sampleRate || 48000,
        slots: state.rack.slots,
        master: state.rack.master,
        pads: state.rack.pads || {},
        postRoll: state.rack.postRoll || {},
        ranges: state.rack.ranges || {},
      }));
    } catch (e) { toast(e.message); return; }
    renderRack();
    renderTabs();
    // The waveform is dry, so adding or removing a module does not change it
    // either. The automation lanes are redrawn because their *targets* move
    // with the rack's structure, which is a different thing from its sound.
    repaintAutomationLanes();
    reloadAudioSource();
  };
  // Dragging a slider fires continuously; debounce so we render once per gesture.
  if (immediate) send(); else rackTimer = setTimeout(send, 220);
}

function slotSummary(slot) {
  if (slot.kind === 'gain') return `${slot.db >= 0 ? '+' : ''}${slot.db.toFixed(1)} dB`;
  if (slot.kind === 'eq') {
    const on = ['low', 'mid', 'high'].filter((b) => Math.abs(slot[b].gainDb) > 0.05).length;
    const hp = slot.highPassHz > 20 ? ` · HP ${Math.round(slot.highPassHz)}Hz` : '';
    return `${on} band${on === 1 ? '' : 's'}${hp}`;
  }
  if (slot.kind === 'comp') {
    return `${slot.ratio.toFixed(1)}:1 · ${slot.thresholdDb.toFixed(0)} dB`;
  }
  // A shaper, summarised from whatever it declares. This used to fall through
  // to the compressor's fields and throw on the first shaper added, which
  // aborted the whole chain redraw partway — so the slot appeared to vanish
  // rather than to be drawn wrongly.
  const spec = state.shapers[slot.kind];
  if (!spec || !spec.params.length) return '—';
  return spec.params
    .slice(0, 2)
    .map((p) => {
      const v = (slot.params || {})[p.key];
      if (v === undefined) return p.label;
      // A percentage only where the range really is nought to one. The gate's
      // threshold tops out at 0 dB, which is not a full scale of anything.
      const pct = p.min >= 0 && p.max <= 1.001;
      return `${p.label} ${pct ? Math.round(v * 100) + '%' : Math.round(v)}`;
    })
    .join(' · ');
}

// The channel strip's defaults and its build cache went with the strip. The
// maximiser is a module now, so its defaults are declared once in
// `MAXIMIZER_SPECS` and reach the interface with every other module's — there
// is no second copy here to drift from them.
//
// `spec.master` still exists and is still posted, because documents saved
// before this carry it and the engine still honours it.

function renderRack() {
  const rail = $('fxModuleRail');
  if (!rail) return;
  rail.innerHTML = '';
  renderVuMeter($('fxInputMeter'), 'IN');
  renderVuMeter($('fxOutputMeter'), 'OUT');
  if (!state.rack) return;

  state.rack.slots.forEach((slot, i) => {
    const shaper = state.shapers[slot.kind];
    const meta = SLOT_META[slot.kind]
      || (shaper ? { icon: shaper.label.slice(0, 2).toUpperCase(), name: shaper.label } : null)
      || { icon: '?', name: slot.kind };
    const el = document.createElement('section');
    el.className = 'fx-module' + (slot.bypassed ? ' off' : '');
    // The built-in effects draw a face of their own (`075-fx-faces.js`); the
    // classes below are the panels they replaced, kept for anything not built in.
    if (!fxIsBuiltin(slot.kind)) {
      if (slot.kind === 'eq') el.classList.add('eq-visual');
      if (slot.kind === 'comp') el.classList.add('comp-visual');
      if (slot.kind === 'dattorro_filter_bank') el.classList.add('filter-bank-visual');
      if (slot.kind === 'chamberlin') el.classList.add('chamberlin-visual');
    }
    el.dataset.kind = slot.kind;
    el.dataset.slot = i;
    el.innerHTML = `<header class="fx-module-head">
      <h2></h2>
      <div class="fx-module-actions"><button class="ghost fx-power"></button>
      <button class="ghost danger fx-remove">Remove</button></div>
      </header><div class="fx-module-signal">
        <div class="fx-vu fx-vu-in" aria-label="${meta.name} input meter"></div>
        <div class="fx-module-controls"></div>
        <div class="fx-vu fx-vu-out" aria-label="${meta.name} output meter"></div>
      </div>`;
    el.querySelector('h2').textContent = meta.name;
    const head = el.querySelector('.fx-module-head');
    head.draggable = true;
    head.ondragstart = (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(i));
      el.classList.add('dragging');
    };
    head.ondragend = () => el.classList.remove('dragging');
    el.ondragover = (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; };
    el.ondrop = (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData('text/plain'));
      if (Number.isInteger(from)) moveFxModule(from, i);
    };
    const power = el.querySelector('.fx-power');
    power.textContent = slot.bypassed ? 'Off' : 'On';
    power.classList.toggle('on', !slot.bypassed);
    power.setAttribute('aria-pressed', String(!slot.bypassed));
    power.onclick = () => {
      slot.bypassed = !slot.bypassed;
      pushRack({ immediate: true });
    };
    el.querySelector('.fx-remove')?.addEventListener('click', () => {
      state.rack.slots.splice(i, 1);
      pushRack({ immediate: true });
      renderRack();
    });
    renderVuMeter(el.querySelector('.fx-vu-in'), 'IN');
    renderVuMeter(el.querySelector('.fx-vu-out'), 'OUT');
    renderFxModuleControls(el.querySelector('.fx-module-controls'), slot, shaper, i);
    rail.appendChild(el);
  });
}

function moveFxModule(from, to) {
  if (!state.rack || from === to || from < 0 || to < 0 || from >= state.rack.slots.length) return;
  const [slot] = state.rack.slots.splice(from, 1);
  state.rack.slots.splice(to, 0, slot);
  const selections=state.rack.slots.map((_,i)=>eqBandSelections.get(i));
  const [selection]=selections.splice(from,1);selections.splice(to,0,selection);
  eqBandSelections.clear();selections.forEach((value,i)=>{if(value!==undefined)eqBandSelections.set(i,value);});
  state.rackSelected = to;
  pushRack({ immediate: true });
  renderRack();
}

function renderVuMeter(box, label) {
  if (!box) return;
  box.innerHTML = `<span class="vu-label">${label}</span><span class="vu-well">
    <i class="vu-bar vu-left"></i><i class="vu-bar vu-right"></i></span>`;
}

function paintRackMeters(levels) {
  if (!levels.length) return;
  const height = (v) => `${Math.max(0, Math.min(100, (20 * Math.log10(Math.max(v, 1e-4)) + 60) / 60 * 100))}%`;
  const paint = (box, pair) => {
    if (!box || !pair) return;
    box.querySelector('.vu-left')?.style.setProperty('--vu', height(pair[0]));
    box.querySelector('.vu-right')?.style.setProperty('--vu', height(pair[1]));
  };
  paint($('fxInputMeter'), levels[0]);
  const modules = [...document.querySelectorAll('.fx-module')];
  modules.forEach((module, i) => {
    paint(module.querySelector('.fx-vu-in'), levels[i]);
    paint(module.querySelector('.fx-vu-out'), levels[i + 1]);
    fxFaceLevels(+module.dataset.slot, levels[i]);
    if (module.dataset.kind === 'comp') recordCompressorLevel(+module.dataset.slot, levels[i]);
  });
  paint($('fxOutputMeter'), levels[modules.length]);
}

const compressorLevels = new Map();
function recordCompressorLevel(slotIndex, input) {
  const slot=state.rack?.slots[slotIndex]; if(!slot||!input)return;
  const peak=Math.max(input[0]||0,input[1]||0,1e-5),db=20*Math.log10(peak);
  const over=Math.max(0,db-slot.thresholdDb),reduction=over*(1-1/Math.max(1,slot.ratio));
  compressorLevels.set(slotIndex,{db:Math.max(-60,Math.min(0,db)),reduction:Math.min(30,reduction)});
}

function resetRackMeters() {
  document.querySelectorAll('.vu-bar').forEach((bar) => bar.style.setProperty('--vu', '0%'));
  // The compressor draws the last window it was given; without this it keeps
  // showing the moment playback stopped.
  engine.waveform = null;
  compressorLevels.clear();
  fxInputDb.clear();
  repaintVisualCompressors();
}

