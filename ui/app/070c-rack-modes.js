// ================================================================ the mode bar
//
// A slot that is a mode of a module (SUITE-PLAN §2.0, §4.1) carries a bar under
// its head: the module's families as tabs, the mode as a dropdown of every mode
// the module has, filed by family, then the class badge with the original in
// its tooltip. A Hyperprism, SoundHack or Lexicon mode adds the switch between
// the MGL face and the original's look (D6).
//
// Switching the mode keeps the slot — its id, its place, its On, its footer —
// so automation lanes and pads that name it stay with it. What the mode left
// had is remembered in the slot's `memory` and comes back on the way back. An
// exact mode opens at its original's defaults; only Mix and Pre-delay carry
// over, and only between two modes of our own. A lane on a control the new
// mode does not have is kept and dimmed (`090-automation.js`), never deleted.

/// The module and mode a slot is, from what it names or, for a slot saved
/// before modules, from its kind. Null for a kind that is no module's mode.
function fxSlotMode(slot) {
  for (const s of state.suites || []) {
    for (const f of s.families) {
      for (const m of f.modes) {
        if (slot.suite && slot.mode ? s.id === slot.suite && m.id === slot.mode : m.kind === slot.kind) {
          return { suite: s, family: f, mode: m };
        }
      }
    }
  }
  return null;
}

/// Which look a slot is drawn in: a Hyperprism, SoundHack or Lexicon mode is
/// in its original's look unless the slot chose the MGL face.
function fxFaceStyle(slot) {
  const suite = fxSuiteOf(state.shapers[slot.kind]);
  if (!suite) return null;
  return slot.face === 'mgl' ? 'mgl' : 'original';
}

/// The fields a slot keeps that are its mode's values rather than the slot's.
const FX_SLOT_OWN = new Set(['id', 'kind', 'bypassed', 'suite', 'mode', 'rev', 'memory', 'face', 'wet', 'level']);

/// A mode's values, as `memory` keeps them.
function fxModeValues(slot) {
  if (slot.params) return { ...slot.params };
  const out = {};
  for (const [k, v] of Object.entries(slot)) if (!FX_SLOT_OWN.has(k)) out[k] = JSON.parse(JSON.stringify(v));
  return out;
}

/// The controls that cross a switch between two modes of our own: Mix and
/// Pre-delay, by role where the mode declares one and by name where not.
function fxCarries(p) {
  if (p.role === 'output') return /mix|wet|dry/i.test(p.key);
  if (p.role === 'time') return /pre-?delay/i.test(p.key);
  return ['mix', 'wet', 'dry'].includes(p.key) || /^pre-?delay/i.test(p.key);
}

/// Put slot `index` into `mode` of its module.
function fxSwitchMode(index, mode, suiteId) {
  const old = state.rack?.slots[index];
  if (!old || !mode) return;
  const at = fxSlotMode(old);
  if (at && at.mode.id === mode.id) return;
  const fresh = defaultFxSlot(mode.kind);
  if (!fresh) return;
  const memory = { ...(old.memory || {}) };
  if (at) memory[at.mode.id] = fxModeValues(old);
  const back = memory[mode.id];
  if (back) {
    if (fresh.params) {
      for (const k of Object.keys(fresh.params)) if (back[k] !== undefined) fresh.params[k] = back[k];
    } else {
      for (const k of Object.keys(fresh)) if (!FX_SLOT_OWN.has(k) && back[k] !== undefined) fresh[k] = back[k];
    }
  }
  if (at && at.mode.class === 'ours' && mode.class === 'ours' && old.params && fresh.params) {
    for (const p of state.shapers[mode.kind]?.params || []) {
      if (fxCarries(p) && old.params[p.key] !== undefined) fresh.params[p.key] = old.params[p.key];
    }
  }
  Object.assign(fresh, {
    id: old.id, bypassed: old.bypassed, suite: suiteId, mode: mode.id, rev: mode.rev, memory,
  });
  for (const k of ['wet', 'level', 'face']) if (old[k] !== undefined) fresh[k] = old[k];
  state.rack.slots[index] = fresh;
  pushRack({ immediate: true });
  renderRack();
  refreshAutomationTargets();
}

/// The bar, for slot `index`; null for a slot that is no module's mode.
function fxModeBar(slot, index) {
  const at = fxSlotMode(slot);
  if (!at) return null;
  const { suite, mode } = at;
  const bar = document.createElement('div');
  bar.className = 'fx-modebar';
  bar.dataset.suite = suite.id;
  bar.dataset.mode = mode.id;
  // A family is offered when it lists a mode, or holds the one this slot is.
  const families = suite.families.filter((f) => f.modes.some((m) => m.listed || m.id === mode.id));
  const offered = (f) => f.modes.filter((m) => m.listed || m.id === mode.id);
  if (families.length > 1) {
    const tabs = uiSeg({
      items: families.map((f) => ({ k: f.label, label: f.label })),
      value: at.family.label,
      h: 20,
      fill: true,
      cls: 'fx-mode-families',
      onPick: (k) => {
        const f = families.find((x) => x.label === k);
        if (f && f !== at.family) fxSwitchMode(index, offered(f)[0], suite.id);
      },
    });
    tabs.setAttribute('aria-label', `${suite.label} families`);
    bar.appendChild(tabs);
  }
  const line = document.createElement('div');
  line.className = 'fx-modebar-line';
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', `${suite.label} mode`);
  for (const f of families) {
    const g = document.createElement('optgroup');
    g.label = f.label;
    for (const m of offered(f)) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      // An old document's unlisted mode shows, and is never offered.
      if (!m.listed) o.disabled = true;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  sel.value = mode.id;
  sel.onchange = () => {
    const m = suite.families.flatMap((f) => f.modes).find((x) => x.id === sel.value);
    fxSwitchMode(index, m, suite.id);
  };
  line.appendChild(sel);
  uiDrop(sel, { h: 20, cls: 'fx-mode-drop' });
  line.appendChild(fxClassBadge(mode));
  const style = fxFaceStyle(slot);
  if (style) {
    const looks = uiSeg({
      items: [{ k: 'original', label: 'Original', title: "The original's look" }, { k: 'mgl', label: 'MGL', title: 'The MGL face' }],
      value: style,
      h: 20,
      cls: 'fx-face-style',
      onPick: (k) => {
        slot.face = k;
        commitRack();
        renderRack();
      },
    });
    looks.setAttribute('aria-label', 'Face');
    line.appendChild(looks);
  }
  bar.appendChild(line);
  return bar;
}
