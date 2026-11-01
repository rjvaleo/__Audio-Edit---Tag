// ============================================================ advanced view

// One pop-up for the selected sound, and only that sound: every one of its tag
// fields side by side — What it is, What it's like, Tags, Notes — where a value
// can be added, removed, put in order, or dragged into another field. Opened
// from "Advanced view…" beside What it is in Browse. Apply writes the fields
// and saves them through Commit, the same path as typing into them.
//
// The fields themselves stay as they were: comma-separated text. This only
// gives that text a better way to be edited, so nothing about how tags are
// stored, searched or written to `_TAGS.txt` changes.

/// What it's like: the words the analysis can say (`Fingerprint::descriptors`
/// in `core/crates/search/src/lib.rs`), offered after the measured ones.
const AV_LIKE_WORDS = ['bassy', 'sizzle', 'bright', 'dark', 'noisy', 'tonal', 'percussive',
  'swelling', 'repetitive', 'scattered', 'sustained', 'short', 'long', 'dynamic', 'quiet'];

/// The three list fields: the input each belongs to and its heading.
const AV_FIELDS = [
  ['is', 'editLevel1', 'What it is'],
  ['like', 'editLevel2', "What it's like"],
  ['tags', 'editTags', 'Tags'],
];

const av = { lists: null, notes: '', path: '', drag: null };

const avSplit = (text) => (text || '').split(',').map((t) => t.trim()).filter(Boolean);
const avHas = (list, word) => list.some((x) => x.toLowerCase() === word.toLowerCase());

/// Where a value came from, said beside it.
function avOrigin(key, word) {
  if (key === 'is' && avHas((state.heard[av.path] || []).map((w) => w.label), word)) return 'heard';
  if (key === 'like' && avHas(state.sonicWords[av.path] || [], word)) return 'measured';
  return '';
}

/// What each field could also say, most likely first, without what it already does.
function avSuggestions(key) {
  const have = av.lists[key];
  let words = [];
  if (key === 'is') {
    words = (state.heard[av.path] || []).map((w) => w.label);
  } else if (key === 'like') {
    words = [...(state.sonicWords[av.path] || []), ...AV_LIKE_WORDS];
  } else {
    const s = state.suggested[av.path];
    words = avSplit(s?.tags);
  }
  const seen = new Set();
  return words.filter((w) => {
    const k = w.toLowerCase();
    if (seen.has(k) || avHas(have, w)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
}

function avOpen() {
  const file = state.selectedFile;
  if (!file) { toast('Select a sound first'); return; }
  av.path = file.path;
  av.lists = Object.fromEntries(AV_FIELDS.map(([key, id]) => [key, avSplit($(id).value)]));
  av.notes = $('editNotes').value;
  av.start = JSON.stringify([av.lists, av.notes]);

  let m = $('avModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'avModal';
    m.className = 'av-modal';
    document.body.appendChild(m);
  }
  m.classList.remove('hidden');
  avRender();
  m.querySelector('.av-new')?.focus();
}

function avClose() {
  $('avModal')?.classList.add('hidden');
  av.lists = null;
}

function avRender() {
  const m = $('avModal');
  if (!m || !av.lists) return;
  const name = av.path.split('/').pop();
  m.innerHTML = `<div class="av-back"></div>
    <div class="av-box" role="dialog" aria-modal="true" aria-label="Advanced view">
      <div class="av-head"><b>Advanced view</b><span class="av-name"></span>
        <span class="av-hint">drag to reorder or move between fields · × removes · type to add</span></div>
      <div class="av-cols"></div>
      <div class="av-foot"><span class="av-say"></span>
        <button class="ghost" data-av="cancel">Cancel</button>
        <button class="primary" data-av="apply">Apply</button></div>
    </div>`;
  m.querySelector('.av-name').textContent = name;
  const cols = m.querySelector('.av-cols');

  for (const [key, , title] of AV_FIELDS) {
    const col = document.createElement('div');
    col.className = 'av-col';
    col.dataset.key = key;
    col.innerHTML = `<div class="av-t">${title}</div><div class="av-list"></div>
      <input class="field av-new" placeholder="add a value… ⏎" aria-label="Add to ${title}">
      <div class="av-sug-t"></div><div class="av-sug"></div>`;
    const list = col.querySelector('.av-list');
    av.lists[key].forEach((word, i) => list.appendChild(avItem(key, word, i)));
    avDropZone(list, key);

    col.querySelector('.av-new').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const word = e.target.value.trim().replace(/,/g, ' ');
      if (word && !avHas(av.lists[key], word)) av.lists[key].push(word);
      avRender();
      $('avModal').querySelector(`.av-col[data-key="${key}"] .av-new`)?.focus();
    };

    const sug = avSuggestions(key);
    if (sug.length) {
      col.querySelector('.av-sug-t').textContent =
        key === 'is' ? 'heard as' : key === 'like' ? 'measured, then the rest' : 'from the name and folder';
      for (const word of sug) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'av-chip' + (avOrigin(key, word) ? ' av-m' : '');
        b.textContent = '+ ' + word;
        b.onclick = () => { av.lists[key].push(word); avRender(); };
        col.querySelector('.av-sug').appendChild(b);
      }
    }
    cols.appendChild(col);
  }

  const notes = document.createElement('div');
  notes.className = 'av-col';
  notes.innerHTML = '<div class="av-t">Notes</div><textarea class="field av-notes" aria-label="Notes"></textarea>';
  const ta = notes.querySelector('textarea');
  ta.value = av.notes;
  ta.placeholder = "where it came from, what it's for…";
  ta.oninput = () => { av.notes = ta.value; avSay(); };
  cols.appendChild(notes);

  m.querySelector('.av-back').onclick = avClose;
  m.querySelector('[data-av="cancel"]').onclick = avClose;
  m.querySelector('[data-av="apply"]').onclick = avApply;
  m.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); avClose(); } };
  avSay();
}

/// One value: a handle to drag it by, the word, where it came from, and ×.
function avItem(key, word, i) {
  const el = document.createElement('div');
  el.className = 'av-item';
  el.draggable = true;
  el.innerHTML = '<span class="av-h" aria-hidden="true">⋮⋮</span><span class="av-w"></span><span class="av-o"></span><button type="button" class="av-x">×</button>';
  el.querySelector('.av-w').textContent = word;
  el.querySelector('.av-o').textContent = avOrigin(key, word);
  const x = el.querySelector('.av-x');
  x.setAttribute('aria-label', `Remove ${word}`);
  x.onclick = () => { av.lists[key].splice(i, 1); avRender(); };
  el.addEventListener('dragstart', (e) => {
    av.drag = { key, i };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', word);
    el.classList.add('av-dragging');
  });
  el.addEventListener('dragend', () => { av.drag = null; el.classList.remove('av-dragging'); });
  return el;
}

/// A field's list takes a dragged value: before the value under the pointer,
/// or at the end. From another field it moves; within one it reorders.
function avDropZone(list, key) {
  const at = (e) => {
    const items = [...list.querySelectorAll('.av-item')];
    const i = items.findIndex((it) => {
      const r = it.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    return i < 0 ? items.length : i;
  };
  list.addEventListener('dragover', (e) => {
    if (!av.drag) return;
    e.preventDefault();
    list.querySelector('.av-line')?.remove();
    const line = document.createElement('div');
    line.className = 'av-line';
    const items = list.querySelectorAll('.av-item');
    const i = at(e);
    if (i < items.length) items[i].before(line); else list.appendChild(line);
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) list.querySelector('.av-line')?.remove();
  });
  list.addEventListener('drop', (e) => {
    if (!av.drag) return;
    e.preventDefault();
    const { key: from, i } = av.drag;
    let to = at(e);
    // Already in the field it is dropped on: the move is just its removal.
    if (from !== key && avHas(av.lists[key], av.lists[from][i])) {
      av.lists[from].splice(i, 1);
      av.drag = null;
      avRender();
      return;
    }
    const [word] = av.lists[from].splice(i, 1);
    if (from === key && i < to) to -= 1;
    av.lists[key].splice(to, 0, word);
    av.drag = null;
    avRender();
  });
}

function avSay() {
  const el = $('avModal')?.querySelector('.av-say');
  if (!el) return;
  const changed = JSON.stringify([av.lists, av.notes]) !== av.start;
  el.textContent = changed ? 'changed · not saved yet' : 'no changes';
}

/// Back into the fields, as the comma lists they always were, and saved.
async function avApply() {
  if (!av.lists) return;
  const path = av.path;
  const edits = (state.tagEdits[path] ??= {});
  const write = (id, key, value) => {
    if ($(id).value === value) return;
    $(id).value = value;
    edits[key] = value;
  };
  write('editLevel1', 'level1', av.lists.is.join(', '));
  write('editLevel2', 'level2', av.lists.like.join(', '));
  write('editTags', 'tags', av.lists.tags.join(', '));
  write('editNotes', 'notes', av.notes.trim());
  if (!Object.keys(edits).length) delete state.tagEdits[path];
  avClose();
  if (!state.tagEdits[path]) return;
  updateDirty();
  tagSourceSay('edited');
  $('commitBtn').click();
}

$('avOpen').onclick = avOpen;
