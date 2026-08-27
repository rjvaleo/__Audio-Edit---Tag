// Every preference the application keeps, in one place.
//
// Before this file there were twenty-one storage keys spread across four
// scripts, nine of them written as bare string literals at the point of use.
// Five were the same fifteen lines of read-clamp-write with a `try/catch` each:
//
//     function laneSplit() {
//       const v = Number(localStorage.getItem(SPLIT_STORE));
//       return Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT;
//     }
//
// — once per setting, each with its own chance to be written slightly
// differently. And two of them were written differently: `roomAdminWidth`
// clamped on the way out and not on the way in, so a value from a wider screen
// came back unclamped; and the snap setting was written with no `try/catch` at
// all, in two places, which in a private window throws inside a menu handler.
//
// **A spec per key, not a bare default.** The table below is the whole
// contract: what a setting is called, what it is when nobody has said, and what
// counts as a readable value. One reader applies it, so a stored value that no
// longer means anything cannot reach the interface — which is the failure this
// program has already had twice, once in the theme and once in the visual menu.
//
// Nothing here touches the DOM or the network. Give it a storage-like object,
// get values back — which is what lets it be tested against a plain map, and
// why `load` takes its storage rather than reaching for one.
//
// Loaded before `app.js` and reachable through the `Settings` object at the
// bottom. Whole documents — the room, its palette, the stage pads — are *not*
// in here: a document travels whole and merges per key, and mixing the two is
// how a half-written document gets written over a good one.

/// Clamp helper, local so this file depends on nothing.
function stClampNum(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/// A number within bounds, or the default when it is not a number at all.
function stNumber(def, lo, hi, round = false) {
  return {
    def,
    read(raw) {
      const v = Number(raw);
      if (!Number.isFinite(v)) return def;
      const c = stClampNum(v, lo, hi);
      return round ? Math.round(c) : c;
    },
  };
}

/// One of a fixed set, or the default. Anything else is a value the app no
/// longer offers, and the answer to that is always the default rather than a
/// blank.
function stOneOf(def, allowed) {
  return { def, read: (raw) => (allowed.includes(raw) ? raw : def) };
}

function stBool(def) {
  return { def, read: (raw) => (typeof raw === 'boolean' ? raw : def) };
}

/// Every setting there is.
///
/// The order is the order the settings panel draws them in, grouped by the
/// heading each sits under — so adding a setting here puts it on screen, and
/// there is no second list to keep in step.
const SETTINGS_SPEC = {
  // ── how edits land ──
  snap: stOneOf('zero', ['zero', 'cd', 'off']),

  // ── what the library lists ──
  playAll: stBool(false),

  // ── watching it play ──
  followOn: stBool(true),
  followMode: stOneOf('scroll', ['scroll', 'page']),

  // ── the shape of the window ──
  //
  // Every one of these was a hand-written clamp. The bounds are the originals':
  // far enough from either end that no pane can be dragged to nothing and lost.
  laneSplit: stNumber(64, 25, 88),
  leftPanelWidth: stNumber(330, 200, 720, true),
  roomAdminWidth: stNumber(300, 210, 620, true),

  // ── what is drawn ──
  //
  // The grain centre has no fixed default: with the spectrogram showing it is
  // the waveform's own centre, which moves with the lane split. `null` is
  // "nobody has placed it", and the caller works out what that means — a
  // default that depends on the layout cannot live in a table.
  grainCentre: {
    def: null,
    read(raw) {
      const v = Number(raw);
      return Number.isFinite(v) && v > 0.02 && v < 0.98 ? v : null;
    },
  },
  masterFft: stOneOf(4096, [1024, 2048, 4096, 8192, 16384]),
};

const SETTINGS_STORE = 'audiolab.settings.v1';

/// Where each setting used to live, so nobody loses their layout.
///
/// Read once, folded in, and then never again — `migrated` records that it has
/// happened. Without this the first run of the new store silently puts every
/// panel back to its default width, which reads as the update having thrown the
/// arrangement away.
const SETTINGS_LEGACY = {
  snap: 'audiolab.snap',
  laneSplit: 'audiolab.laneSplit',
  leftPanelWidth: 'audiolab.leftPanelWidth',
  roomAdminWidth: 'roomAdminW',
  grainCentre: 'audiolab.grainCentre',
  masterFft: 'audiolab.masterFft',
};

/// The built-in answers, as a fresh object each time so no caller can edit them.
function settingsDefaults() {
  const out = {};
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) out[key] = spec.def;
  return out;
}

/**
 * Read every setting, validated against what the application offers now.
 *
 * **Each key falls back to the default, never to a literal.** That is the trap
 * worth stating: a validator written as `?? []` or `?? 0` discards the built-in
 * answer on precisely the browsers the default exists for — the fresh ones —
 * and is invisible in testing, because the machine it is written on already has
 * something stored.
 */
function loadSettings(storage) {
  const base = settingsDefaults();
  let raw = {};
  try {
    raw = JSON.parse(storage.getItem(SETTINGS_STORE) || '{}') || {};
  } catch {
    // A corrupt entry is no settings, not a broken app.
    raw = {};
  }

  // The old keys, folded in once. Anything already in the new store wins, so a
  // second run cannot undo what somebody changed after the first.
  if (!raw.migrated) {
    for (const [key, old] of Object.entries(SETTINGS_LEGACY)) {
      if (raw[key] !== undefined) continue;
      let was = null;
      try { was = storage.getItem(old); } catch { was = null; }
      if (was === null) continue;
      raw[key] = typeof SETTINGS_SPEC[key].def === 'number' || SETTINGS_SPEC[key].def === null
        ? Number(was) : was;
    }
    raw.migrated = true;
  }

  const out = {};
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
    out[key] = raw[key] === undefined ? base[key] : spec.read(raw[key]);
  }
  out.migrated = true;
  return out;
}

let warnedAboutStorage = false;

/**
 * Write them back. A failure here must never take a render down with it.
 *
 * The quota is about 5MB and a private window can refuse writes outright. A
 * throw inside a setter travels up through whatever handler called it — which
 * is how adjusting the snap setting in a private window used to be able to stop
 * the menu mid-click, since that one write was never wrapped.
 */
function persistSettings(storage, values) {
  try {
    storage.setItem(SETTINGS_STORE, JSON.stringify(values));
  } catch (error) {
    if (!warnedAboutStorage) {
      warnedAboutStorage = true;
      console.warn(
        '[settings] could not be saved — they apply for this session but will not survive a reload.',
        error,
      );
    }
  }
}

const Settings = {
  STORE: SETTINGS_STORE,
  SPEC: SETTINGS_SPEC,
  LEGACY: SETTINGS_LEGACY,
  defaults: settingsDefaults,
  load: loadSettings,
  persist: persistSettings,
};
