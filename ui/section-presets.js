// Presets for one section at a time.
//
// The preset on the preset row is the document's: every engine's settings at
// once, kept on the server, and able to carry the sound it was made on. These
// are the other kind. One section — the room, or the grain cloud — kept on its
// own, so a look can be put back without touching the sound and a cloud
// without touching the look. See `docs/SECTION-PRESETS.md`.
//
// Pure, like `settings.js`: no DOM, no network, the storage is passed in. What
// a preset *contains* is the section's own business — `app.js` takes the
// snapshot and applies it. This file only keeps named copies of whatever it is
// handed and hands them back unchanged, so it can be checked against a plain
// map rather than a running interface.

const SectionPresets = (() => {
  /// The sections that have presets. A kind not in this list is refused
  /// rather than given a key, so a typo cannot quietly start a third store.
  const KINDS = ['visual', 'grain'];

  const keyFor = (kind) => `audiolab.presets.${kind}.v1`;

  const known = (kind) => KINDS.includes(kind);

  const clone = (v) => JSON.parse(JSON.stringify(v));

  /// Everything stored under a kind, as `{ name: { name, saved, value } }`.
  ///
  /// Anything unreadable — a string where the map should be, an entry with no
  /// value, a value that is not an object — is dropped here, so nothing past
  /// this line has to ask. Unreadable storage is the empty map, never a throw.
  function read(storage, kind) {
    if (!known(kind)) return {};
    let raw = null;
    try { raw = JSON.parse(storage.getItem(keyFor(kind)) || 'null'); } catch { return {}; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [name, entry] of Object.entries(raw)) {
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.value || typeof entry.value !== 'object') continue;
      out[name] = {
        name,
        saved: typeof entry.saved === 'number' ? entry.saved : 0,
        value: entry.value,
      };
    }
    return out;
  }

  function write(storage, kind, all) {
    try { storage.setItem(keyFor(kind), JSON.stringify(all)); } catch { /* private mode */ }
  }

  /// The names under a kind, sorted, each with when it was saved.
  function list(storage, kind) {
    return Object.values(read(storage, kind))
      .map((e) => ({ name: e.name, saved: e.saved }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /// One preset's value, as a copy — so changing what comes back changes
  /// nothing that is stored.
  function get(storage, kind, name) {
    const e = read(storage, kind)[name];
    return e ? clone(e.value) : null;
  }

  /// Keep `value` under `name`. Saving over a name replaces it. Returns the
  /// name as stored — trimmed — or null when there was nothing to store: a
  /// blank name, an unknown kind, or a value that is not an object.
  function save(storage, kind, name, value) {
    const n = String(name ?? '').trim();
    if (!n || !known(kind)) return null;
    if (!value || typeof value !== 'object') return null;
    const all = read(storage, kind);
    all[n] = { name: n, saved: Date.now(), value: clone(value) };
    write(storage, kind, all);
    return n;
  }

  /// Forget one. True if there was one to forget.
  function remove(storage, kind, name) {
    const all = read(storage, kind);
    if (!all[name]) return false;
    delete all[name];
    write(storage, kind, all);
    return true;
  }

  return { KINDS, keyFor, list, get, save, remove };
})();
