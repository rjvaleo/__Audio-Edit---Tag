// ============================================================ Browse's types
//
// To the right of the sound's details in Browse, in place of the map of every
// sound (14 Nov 2026, RJ: "on the right-hand side, we've got the different
// types of files listed. So like drum, synth, stem, or whatever. And then you
// click on it, and then it's the files that are in that grouping, and you can
// click on them to preview them").
//
// The types are the index's own categories (`indexer`, one per file), grouped
// here into the words a person would use. The server counts them
// (`/api/types`) and lists a type's files a page at a time
// (`/api/type-files`), since Drums alone is tens of thousands. The rows are the
// folder list's own (`fileRow`), so they play, select and open the same way,
// except that a click here plays: this list is for listening.
//
// It follows Play all files, as the folder list does: without it, only files
// with an audio header are counted or listed.

/// The types, in the words used for them, and the index categories in each.
/// A category the index gains later and nobody has placed gets a type of its
/// own, named for itself, rather than going missing.
const BROWSE_TYPES = [
  { name: 'Drums', cats: ['DRUM-ONESHOT', 'DRUM-HIT-LONG'] },
  { name: 'Chops', cats: ['CHOP'] },
  { name: 'One-shots', cats: ['ONE-SHOT', 'TONAL-HIT'] },
  { name: 'Samples', cats: ['SAMPLE', 'SAMPLE-SHORT'] },
  { name: 'Synth', cats: ['SYNTH-STAB', 'PAD-BED'] },
  { name: 'Loops', cats: ['LOOP'] },
  { name: 'Stems', cats: ['STEM'] },
  { name: 'Vocals', cats: ['VOCAL'] },
  { name: 'FX', cats: ['FX'] },
  { name: 'Songs', cats: ['SONG', 'SONG?'] },
  { name: 'Sessions', cats: ['LONG-SESSION', 'SESSION-TAKE', 'SECTION-BED'] },
  { name: 'Unsorted', cats: ['UNKNOWN'] },
  // Not sounds, so last and dimmed; only there at all with Play all files.
  { name: 'Not audio', cats: ['CACHE', 'DOCUMENT', 'BROKEN'], last: true },
];
const BT_PAGE = 200;
const BT_NO_INSTRUMENT = '-';

const bt = {
  shown: false,
  types: [],          // [{ name, cats, files, instruments: [{ name, files }] }]
  total: 0,
  loadedFor: null,    // which (playAll, folders) the counts are for
  type: null,         // the name of the type picked
  instrument: '',     // '' all, '-' none named, or a name
  sort: 'name',
  q: '',
  files: [],
  count: 0,
  serial: 0,
  loading: false,
};

try {
  bt.type = localStorage.getItem('browseType') || null;
  bt.sort = localStorage.getItem('browseTypeSort') === 'length' ? 'length' : 'name';
} catch { /* private window: start from nothing */ }

/// Shown with Browse and put away with it. Called by `setMode`.
function browseTypesShow(on) {
  const box = $('browseTypes');
  if (!box) return;
  bt.shown = !!on;
  box.classList.toggle('hidden', !on);
  document.body.classList.toggle('browsetypes', !!on);
  if (on) btLoadTypes();
}

/// The counts, again whenever what they count has changed: Play all files
/// switched, or the library re-read (a new `state.folders`).
async function btLoadTypes({ force = false } = {}) {
  const key = { all: !!state.playAll, folders: state.folders };
  if (!force && bt.loadedFor && bt.loadedFor.all === key.all && bt.loadedFor.folders === key.folders) return;
  bt.loadedFor = key;
  let r;
  try { r = await api(`/api/types${key.all ? '?all=1' : ''}`); }
  catch (e) { bt.loadedFor = null; $('btTotal').textContent = e.message; return; }

  const byCat = new Map((r.categories || []).map((c) => [c.category, c]));
  const placed = new Set(BROWSE_TYPES.flatMap((t) => t.cats));
  const extra = [...byCat.keys()].filter((c) => !placed.has(c))
    .map((c) => ({ name: c.charAt(0) + c.slice(1).toLowerCase(), cats: [c] }));
  bt.types = [...BROWSE_TYPES, ...extra].map((t) => {
    const cats = t.cats.filter((c) => byCat.has(c));
    const ins = new Map();
    let files = 0;
    for (const c of cats) {
      const got = byCat.get(c);
      files += got.files;
      for (const i of got.instruments || []) ins.set(i.name, (ins.get(i.name) || 0) + i.files);
    }
    return { ...t, cats, files, instruments: [...ins].map(([name, n]) => ({ name, files: n })) };
  }).filter((t) => t.files > 0)
    .sort((a, b) => (!!a.last - !!b.last) || b.files - a.files);
  bt.total = r.total || 0;

  if (!bt.types.some((t) => t.name === bt.type)) bt.type = bt.types[0]?.name || null;
  const t = btType();
  if (t && bt.instrument && !t.instruments.some((i) => (i.name || BT_NO_INSTRUMENT) === bt.instrument)) bt.instrument = '';
  btRenderTypes();
  btLoadFiles();
}

const btType = () => bt.types.find((t) => t.name === bt.type) || null;

function btRenderTypes() {
  $('btTotal').textContent = `${bt.total.toLocaleString()} files`;
  const list = $('btTypeList');
  list.innerHTML = '';
  const most = Math.max(1, ...bt.types.map((t) => t.files));
  for (const t of bt.types) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bt-type' + (t.name === bt.type ? ' on' : '') + (t.last ? ' dim' : '');
    el.dataset.type = t.name;
    el.innerHTML = `<span class="bt-name"></span><span class="bt-n">${t.files.toLocaleString()}</span>
      <span class="bt-fill"><i style="width:${Math.max(2, Math.sqrt(t.files / most) * 100)}%"></i></span>
      <span class="bt-cats"></span>`;
    el.querySelector('.bt-name').textContent = t.name;
    el.querySelector('.bt-cats').textContent = t.cats.join(' · ');
    el.title = `${t.name}: the index's ${t.cats.join(', ')}`;
    el.onclick = () => btPick(t.name);
    list.appendChild(el);
  }
}

function btPick(name) {
  if (bt.type === name) return;
  bt.type = name;
  bt.instrument = '';
  bt.q = '';
  $('btFind').value = '';
  try { localStorage.setItem('browseType', name); } catch { /* not kept */ }
  for (const el of $('btTypeList').children) el.classList.toggle('on', el.dataset.type === name);
  btLoadFiles();
}

function btRenderChips() {
  const t = btType();
  const box = $('btChips');
  box.innerHTML = '';
  const named = (t?.instruments || []).filter((i) => i.name).sort((a, b) => b.files - a.files);
  box.classList.toggle('hidden', !named.length);
  if (!named.length) return;
  const none = t.instruments.find((i) => !i.name);
  const chips = [{ key: '', label: 'All', n: t.files }, ...named.map((i) => ({ key: i.name, label: i.name, n: i.files }))];
  if (none) chips.push({ key: BT_NO_INSTRUMENT, label: 'Not named', n: none.files });
  for (const c of chips) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bt-chip' + (c.key === bt.instrument ? ' on' : '');
    b.dataset.instrument = c.key;
    b.innerHTML = `<span></span><em>${c.n.toLocaleString()}</em>`;
    b.firstChild.textContent = c.label;
    b.onclick = () => {
      bt.instrument = c.key;
      for (const x of box.children) x.classList.toggle('on', x === b);
      btLoadFiles();
    };
    box.appendChild(b);
  }
}

function btQuery(offset) {
  const t = btType();
  const p = new URLSearchParams({ cats: t.cats.join(','), sort: bt.sort, offset, limit: BT_PAGE });
  if (bt.instrument) p.set('instrument', bt.instrument);
  if (bt.q) p.set('q', bt.q);
  if (state.playAll) p.set('all', '1');
  return `/api/type-files?${p}`;
}

/// The first page of the type picked, replacing whatever was listed.
async function btLoadFiles() {
  const t = btType();
  $('btTypeName').textContent = t ? t.name : 'Pick a type';
  btRenderChips();
  const list = $('btFileList');
  if (!t) { list.innerHTML = ''; $('btCount').textContent = ''; return; }
  const serial = ++bt.serial;
  bt.loading = true;
  let r;
  try { r = await api(btQuery(0)); }
  catch (e) { if (serial === bt.serial) { list.innerHTML = `<div class="loading">${e.message}</div>`; bt.loading = false; } return; }
  if (serial !== bt.serial) return;           // a newer pick got there first
  bt.files = r.files || [];
  bt.count = r.total || 0;
  bt.loading = false;
  btCountLabel();
  list.innerHTML = '';
  list.scrollTop = 0;
  if (!bt.files.length) {
    list.innerHTML = `<div class="loading">${bt.q ? 'nothing matches' : 'none'}</div>`;
    return;
  }
  btAppend(bt.files);
}

/// The next page, when the list is scrolled near its end.
async function btMore() {
  if (bt.loading || bt.files.length >= bt.count || !btType()) return;
  const serial = bt.serial;
  bt.loading = true;
  let r;
  try { r = await api(btQuery(bt.files.length)); }
  catch { bt.loading = false; return; }
  if (serial !== bt.serial) return;
  bt.loading = false;
  const more = r.files || [];
  bt.files.push(...more);
  btAppend(more);
}

function btCountLabel() {
  const t = btType();
  const ins = bt.instrument === BT_NO_INSTRUMENT ? 'not named' : bt.instrument;
  $('btCount').textContent = bt.instrument || bt.q
    ? `${bt.count.toLocaleString()} of ${t.files.toLocaleString()}${ins ? ' · ' + ins : ''}`
    : `${bt.count.toLocaleString()} files`;
}

/// The last two folders a file is in: enough to tell two kits' kicks apart.
function btWhere(file) {
  const dirs = `${file.path.split('/')[0]}${file.subdir ? '/' + file.subdir : ''}`.split('/');
  return (dirs.length > 2 ? '…/' : '') + dirs.slice(-2).join('/');
}

function btAppend(files) {
  const list = $('btFileList');
  for (const file of files) {
    const el = fileRow(file);
    // A click here plays: this list is for listening. Clicking the one
    // playing pauses it. Double-click still opens it in Edit.
    el.onclick = () => { list.focus({ preventScroll: true }); playFile(file); };
    const meta = el.querySelector('.fmeta');
    meta.querySelector('.cat').textContent = file.instrument || file.category;
    const where = document.createElement('span');
    where.className = 'bt-where';
    where.textContent = btWhere(file);
    meta.append(Object.assign(document.createElement('span'), { textContent: '·' }), where);
    el.title = `${file.path}\n${el.title}`;
    list.appendChild(el);
  }
  markPlaying();
  requestThumbs();
}

/// The selection, as the folder list draws it, after anything picks a sound.
/// Called at the end of `buildTree`; also where a change of Play all files or a
/// re-read library is noticed.
function browseTypesMark() {
  if (!bt.shown) return;
  const cur = state.selectedFile?.path;
  for (const el of $('btFileList').querySelectorAll('.file-row')) {
    el.classList.toggle('selected', el.dataset.path === cur);
  }
  btLoadTypes();
}

$('btFileList').addEventListener('scroll', (e) => {
  const l = e.currentTarget;
  if (l.scrollTop + l.clientHeight > l.scrollHeight - 600) btMore();
  requestThumbs();
});

// ↑ ↓ step through the list and play each, as you would down a sample browser.
$('btFileList').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  e.stopPropagation();
  const rows = [...e.currentTarget.querySelectorAll('.file-row')];
  if (!rows.length) return;
  const at = rows.findIndex((r) => r.dataset.path === state.selectedFile?.path);
  const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (e.key === 'ArrowDown' ? 1 : -1)))];
  next.scrollIntoView({ block: 'nearest' });
  const file = bt.files.find((f) => f.path === next.dataset.path);
  if (file && file.path !== engine.path) playFile(file);
  else if (file && !engine.playing) playFile(file);
});

let btFindTimer;
$('btFind').addEventListener('input', (e) => {
  clearTimeout(btFindTimer);
  btFindTimer = setTimeout(() => { bt.q = e.target.value.trim(); btLoadFiles(); }, 200);
});

for (const b of $('btSort').querySelectorAll('button')) {
  b.classList.toggle('on', b.dataset.sort === bt.sort);
  b.onclick = () => {
    if (bt.sort === b.dataset.sort) return;
    bt.sort = b.dataset.sort;
    try { localStorage.setItem('browseTypeSort', bt.sort); } catch { /* not kept */ }
    for (const x of $('btSort').children) x.classList.toggle('on', x === b);
    btLoadFiles();
  };
}
