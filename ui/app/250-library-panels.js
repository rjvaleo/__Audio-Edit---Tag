// ============================================================= tagging panel

/// What the selected sound itself sounds like, as opposed to what its folder
/// was labelled. Measured from the audio, so it is right even when the name and
/// the folder are not.
let sonicSeq = 0;
async function showSonicTags(file) {
  const box = $('sonicTags');
  if (!box) return;
  const seq = ++sonicSeq;
  box.textContent = '…';
  let r;
  try {
    r = await api(`/api/similar?p=${encodeURIComponent(file.path)}&limit=1`);
  } catch {
    if (seq === sonicSeq) box.textContent = '';
    return;
  }
  // A slower earlier request must not overwrite a newer selection.
  if (seq !== sonicSeq) return;
  const tags = r.tags || [];
  // Kept for the Advanced view, which offers them as suggestions.
  state.sonicWords[file.path] = tags;
  state.suggested[file.path] = r.suggest || null;
  box.innerHTML = tags.length
    ? tags.map((t) => `<span class="sonic-tag">${t}</span>`).join('')
    : '<span class="dim">not measured</span>';

  showHeard(file, r.heard || []);
  fillFileTags(file, r.suggest, r.saved || null);
  showUserTags(file, r.yourTags);
}

// ---------------------------------------------------------- tags of your own

/// Tags you invented, and the ones the system thinks belong here.
///
/// Applied tags are removable chips. Below them are the learned suggestions —
/// dashed, because they are proposals rather than facts — each naming the sound
/// it was inferred from. Clicking one accepts it, which makes this sound an
/// example too, so the next suggestion is better informed.
function showUserTags(file, data) {
  const mine = data?.mine || [];
  const learned = data?.learned || [];
  state.userTags[file.path] = mine;

  const box = $('yourTags');
  box.innerHTML = '';
  if (!mine.length) {
    box.innerHTML = '<span class="dim">none yet</span>';
  }
  for (const tag of mine) {
    const el = document.createElement('span');
    el.className = 'sonic-tag user-tag';
    el.innerHTML = `<span></span><button class="x" title="Remove">×</button>`;
    el.querySelector('span').textContent = tag;
    el.querySelector('.x').onclick = () =>
      setUserTags(file, mine.filter((t) => t !== tag));
    box.appendChild(el);
  }

  const sug = $('learnedTags');
  sug.innerHTML = '';
  for (const s of learned) {
    const el = document.createElement('button');
    el.className = 'sonic-tag user-tag learned';
    el.textContent = '+ ' + s.tag;
    const pct = Math.round(s.score * 100);
    const also = s.support > 1 ? `, and ${s.support - 1} other${s.support > 2 ? 's' : ''}` : '';
    el.title = `${pct}% like ${s.like.split('/').pop()}${also} — click to apply`;
    el.onclick = () => setUserTags(file, [...state.userTags[file.path], s.tag]);
    sug.appendChild(el);
  }

  // Offer words already in use rather than letting three spellings of one idea
  // pile up.
  $('userTagVocab').innerHTML = (data?.vocabulary || [])
    .map((v) => `<option value="${v.replace(/"/g, '&quot;')}">`)
    .join('');
}

async function setUserTags(file, tags) {
  let r;
  try {
    r = await postJSON('/api/usertags', { path: file.path, tags });
  } catch (e) {
    toast('Could not save tag: ' + e.message);
    return;
  }
  showUserTags(file, r);
}

$('addUserTag').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  const file = state.selectedFile;
  const tag = e.target.value.trim();
  if (!file || !tag) return;
  e.target.value = '';
  setUserTags(file, [...(state.userTags[file.path] || []), tag]);
};

/// What the classifier named the sound, as opposed to what it is like.
///
/// A label the model was unsure of is shown faded rather than hidden: a weak
/// guess is still information, and pretending to be certain about it would be
/// worse than showing the number. A borrowed label says whose it is.
function showHeard(file, words) {
  const box = $('heardTags');
  if (!box) return;
  state.heard[file.path] = words;

  if (!words.length) {
    box.innerHTML = '<span class="dim">nothing recognised</span>';
    return;
  }
  // The store keeps more than this; four is what a panel can show without
  // becoming a wall of chips. The rest are in /api/sounds.
  box.innerHTML = words
    .slice(0, 4)
    .map((w) => {
      const faint = w.score < 0.15 ? ' faint' : '';
      const title = w.from
        ? `${(w.score * 100).toFixed(0)}% — heard in ${w.from.split('/').pop()}, not this file`
        : `${(w.score * 100).toFixed(0)}% sure`;
      return `<span class="sonic-tag heard-tag${faint}" title="${title}">${w.label}</span>`;
    })
    .join('');

  const from = words[0].from;
  if (from) {
    box.innerHTML +=
      `<span class="dim borrowed">like ${from.split('/').pop()}</span>`;
  }
}

/// The tag fields describe the selected sound, not the folder it sits in.
///
/// A folder's fields are still editable when no sound is selected — that is
/// what the panel used to be and there is no reason to take it away — but the
/// moment you click a file the fields follow the file.
function fillTagPanel(folder) {
  if (state.selectedFile) return;
  tagLabels('folder');
  const e = state.tagEdits[folder.name] || {};
  $('editLevel1').value = e.level1 ?? folder.level1;
  $('editLevel2').value = e.level2 ?? folder.level2;
  $('editTags').value = e.tags ?? folder.tags;
  $('editNotes').value = e.notes ?? '';
}

/// Fill the fields for one sound.
///
/// Precedence is edited, then saved, then suggested. The distinction between
/// the last two matters: a suggestion is what the classifier would say, and
/// once someone has saved something — even an empty string — that is a
/// decision, and overwriting it with a fresh guess would undo their work every
/// time they clicked the file.
function fillFileTags(file, suggest, saved) {
  const e = state.tagEdits[file.path] || {};
  const pick = (k) => e[k] ?? saved?.[k] ?? suggest?.[k] ?? '';
  tagLabels('file');
  $('editLevel1').value = pick('level1');
  $('editLevel2').value = pick('level2');
  $('editTags').value = pick('tags');
  $('editNotes').value = pick('notes');

  // Say where the values came from, so nobody has to guess whether they are
  // looking at their own work or the machine's.
  tagSourceSay(Object.keys(e).length ? 'edited' : saved ? 'saved' : 'suggested');
}

/// What each field is for, said where it is filled in.
///
/// `level1` and `level2` mean different things for a sound and a folder, and
/// the labels used to say neither. For a sound the suggestion puts the name the
/// listening model gave it in the first (the source: "Snare drum", "Sine wave")
/// and the audio descriptors in the second (the character: "repetitive",
/// "bright"). For a folder they are the two levels of the library tree: the
/// family ("Drum", "Sample") and the kind within it ("Machine", "Loops") — see
/// `levels` in `core/crates/server/src/state.rs`. The stored names are
/// unchanged; only what the fields are called.
function tagLabels(kind) {
  const file = kind === 'file';
  const say = {
    Level1: file
      ? ['What it is', 'The source: what made the sound. Snare, sine wave, voice, rain.', 'snare, sine wave, voice…']
      : ['Family', 'The top of the library tree: Drum, Sample, Synth, Vocal, Session, Song.', 'Drum, Sample, Synth…'],
    Level2: file
      ? ["What it's like", 'Its character: how it sounds. Bright, repetitive, gritty, swelling.', 'bright, repetitive, gritty…']
      : ['Kind', 'The kind within the family: Machine, Kit, Loops, Pads, Oneshots, Takes.', 'Machine, Kit, Loops…'],
    Tags: ['Tags', "Anything you'd search for, comma separated: words from the name, the machine, the instrument, the style.", "words you'd search for…"],
    Notes: ['Notes', "What can't be heard: where it came from, what it's for, how it was made.", "where it came from, what it's for…"],
  };
  for (const [key, [word, tip, hint]] of Object.entries(say)) {
    const label = $('lbl' + key);
    const field = $('edit' + key);
    if (label) { label.textContent = word; label.title = tip; }
    if (field) { field.placeholder = hint; field.title = tip; }
  }
}

/// Where the tag values came from: one word on the line, the whole of it in
/// the tooltip, so the column heads with a word rather than a sentence.
/// The words are inside the function, not a `const` beside it: this can run
/// during load, before a `const` further down the file exists.
function tagSourceSay(kind) {
  const [word, full] = {
    suggested: ['Suggested', 'Suggested from the audio and the filename'],
    saved: ['Saved', 'Saved earlier'],
    edited: ['Edited', 'Edited, not yet committed'],
  }[kind];
  const el = $('tagSource');
  el.textContent = word;
  el.title = full;
}

for (const [id, key] of [['editLevel1', 'level1'], ['editLevel2', 'level2'],
                         ['editTags', 'tags'], ['editNotes', 'notes']]) {
  $(id).onchange = (e) => {
    // Whichever the panel is currently describing.
    const name = state.selectedFile?.path || state.selectedFolder;
    if (!name) return;
    (state.tagEdits[name] ??= {})[key] = e.target.value.trim();
    updateDirty();
    if (state.selectedFile) tagSourceSay('edited');
  };
}

function updateDirty() {
  const n = Object.keys(state.tagEdits).length;
  $('dirtyLabel').textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : '';
}

$('discardBtn').onclick = () => {
  state.tagEdits = {};
  updateDirty();
  if (state.selectedFile) selectFile(state.selectedFile);
  else {
    const f = state.folders.find((x) => x.name === state.selectedFolder);
    if (f) fillTagPanel(f);
  }
  toast('Tag edits discarded');
};

$('commitBtn').onclick = async () => {
  const edits = state.tagEdits;
  if (!Object.keys(edits).length) { toast('Nothing to commit'); return; }

  // A key with a slash in it is a file; anything else is a folder name.
  const folders = {}, files = {};
  for (const [k, v] of Object.entries(edits)) {
    (k.includes('/') ? files : folders)[k] = v;
  }
  try {
    const r = await postJSON('/api/save', { folders, files });
    toast(`Committed — ${r.foldersWritten} _TAGS.txt written`);
    state.tagEdits = {};
    updateDirty();
  } catch (e) { toast('Commit failed: ' + e.message); }
};

// ==================================================================== search

/// Rank the library by acoustic similarity to whatever is selected.
///
/// The first run measures every file, which takes a moment; after that the
/// fingerprints live beside the index and it is instant.
$('similarBtn').onclick = async () => {
  const f = state.selectedFile;
  const box = $('searchResults');
  if (!f) { box.innerHTML = '<div class="dim">Select a sound first.</div>'; return; }

  box.innerHTML = '<div class="dim">Listening to the library…</div>';
  let r;
  try {
    r = await api(`/api/similar?p=${encodeURIComponent(f.path)}&limit=40`);
  } catch (e) {
    box.innerHTML = `<div class="dim">${e.message}</div>`;
    return;
  }

  if (!r.results.length) { box.innerHTML = '<div class="dim">Nothing to compare against.</div>'; return; }
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'dim';
  head.textContent = `Like ${f.name} · ${r.indexed} sounds measured`;
  box.appendChild(head);

  for (const hit of r.results) {
    const row = document.createElement('div');
    row.className = 'result';
    row.innerHTML =
      `<span class="mono">${(hit.score * 100).toFixed(0)}%</span> ` +
      `<span>${hit.name}</span> ` +
      `<span class="dim">${hit.category} · ${hit.seconds.toFixed(2)}s · unlike in ${hit.differs}</span>`;
    row.onclick = () => {
      const file = { path: hit.path, name: hit.name };
      selectFile(file);
    };
    box.appendChild(row);
  }
};

$('searchInput').oninput = () => {
  const q = $('searchInput').value.toLowerCase().trim();
  const box = $('searchResults');
  box.innerHTML = '';
  if (!q) return;
  const terms = q.split(/\s+/);
  const hits = state.folders.filter((f) => {
    const hay = `${f.name} ${f.tags} ${f.machine} ${f.categories} ${f.instruments}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  }).slice(0, 60);

  for (const f of hits) {
    const el = document.createElement('div');
    el.className = 'result';
    el.innerHTML = `<div class="name"></div><div class="sub">${folderCount(f)} files · ${f.level1} › ${f.level2}</div>`;
    el.querySelector('.name').textContent = f.name;
    el.onclick = () => { showPane('left', 'browse'); toggleFolder(f.name); };
    box.appendChild(el);
  }
  if (!hits.length) box.innerHTML = '<div class="empty">No matches</div>';
};

// ====================================================================== scan

$('startScan').onclick = async () => {
  try {
    await api('/api/scan', { method: 'POST' });
    $('scanProgress').classList.remove('hidden');
    $('stopScan').classList.remove('hidden');
    $('startScan').disabled = true;
    pollScan();
  } catch (e) { toast(e.message); }
};
$('stopScan').onclick = () => api('/api/scan/stop', { method: 'POST' }).catch(() => {});

async function pollScan() {
  let s;
  try { s = await api('/api/scan'); } catch { return; }
  $('scanFill').style.width = (s.total ? s.done / s.total * 100 : 0) + '%';
  $('scanCurrent').textContent = s.current || (s.running ? 'scanning…' : 'done');
  $('scanCount').textContent = `${s.done}/${s.total}`;

  if (s.running) { setTimeout(pollScan, 400); return; }
  $('startScan').disabled = false;
  $('stopScan').classList.add('hidden');
  state.folderFiles = {};
  state.thumbs = {};
  state.openFolders = {};
  await refresh();
  toast('Scan complete');
}

// ============================================================= folder picker

let pickerPath = '';

async function openPicker(startPath) {
  $('pickerModal').classList.remove('hidden');
  await loadPicker(startPath || '');
}
$('pickLibrary').onclick = () => openPicker(state.library);
$('rescanLibrary').onclick = () => { showPane('left', 'scan'); $('startScan').click(); };
$('pickerClose').onclick = () => $('pickerModal').classList.add('hidden');

async function loadPicker(path) {
  let d;
  try { d = await api(`/api/browse?path=${encodeURIComponent(path)}`); }
  catch (e) { toast(e.message); return; }

  pickerPath = d.path;
  $('pickerPath').textContent = d.path;
  $('pickerUp').disabled = !d.parent;
  $('pickerUp').onclick = () => loadPicker(d.parent);

  const places = $('pickerPlaces');
  places.innerHTML = '';
  for (const p of d.places) {
    const el = document.createElement('div');
    el.className = 'picker-item';
    el.textContent = p.name;
    el.onclick = () => loadPicker(p.path);
    places.appendChild(el);
  }

  const list = $('pickerList');
  list.innerHTML = '';
  if (!d.dirs.length) list.innerHTML = '<div class="empty">No sub-folders here.</div>';
  for (const dir of d.dirs) {
    const el = document.createElement('div');
    el.className = 'picker-item';
    el.textContent = dir.name;
    el.onclick = () => loadPicker(dir.path);
    list.appendChild(el);
  }
}

$('pickerChoose').onclick = async () => {
  try {
    await postJSON('/api/library', { path: pickerPath });
    $('pickerModal').classList.add('hidden');
    toast('Library set — run a scan to index it');
    state.folderFiles = {}; state.thumbs = {}; state.openFolders = {};
    await refresh();
    showPane('left', 'scan');
  } catch (e) { toast(e.message); }
};

