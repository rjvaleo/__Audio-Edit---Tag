// The Stems page's MIDI tab (RJ, 18 Nov 2026: "Stems to MIDI"): the open
// song's drums, bass and chords, as the analysis read them, drawn over the
// song and written as a Standard MIDI File beside the stems.
//
// The drawing is made here from `ST.song.analysis` (songprint.json); the file
// is the server's (`POST /api/stems/midi`, crate `songprint::midi`). The two
// agree on what a part is: drums on channel 10 (kick 36, snare 38, hat 42),
// bass on 5, chords on 6, melody on 7, other notes on 8. The last two are read
// at a press (`POST /api/stems/notes`) and kept beside the stems. One fixed size: 1496 x 640.
//
// See `docs/STEMS.md`.

const SM = {
  parts: { drums: true, bass: true, chords: true, melody: true, other: true },
  read: { melody: null, other: null },   // the notes read from the vocals and other stems, null until read
  reading: '',        // the part being read now
  gpu: false,         // a GPU machine is set: Other notes is read there
  timing: 'grid',     // 'grid' | 'played'
  chords: 'held',     // 'held' | 'bar'
  bass: 'as',         // 'as' | 'up'
  from: 0, to: 0,     // the bars on show
  song: '',           // the song the bars on show belong to
  written: null,      // what the last Write made, until a choice changes
  busy: false,
};
const SM_PARTS = [
  { k: 'drums', name: 'Drums', from: 'from the drums stem', ch: 10, col: 'var(--look-f-attack)' },
  { k: 'bass', name: 'Bass', from: 'from the bass stem', ch: 5, col: 'var(--look-f-tone)' },
  { k: 'chords', name: 'Chords', from: 'from the other and bass stems', ch: 6, col: 'var(--look-f-space)' },
  // Read on their own, at a press: the melody here, the other notes by Basic Pitch on the PC.
  { k: 'melody', name: 'Melody', from: 'from the vocals stem', ch: 7, col: 'var(--look-f-pitch)', read: 'Read it', how: 'one note at a time; a few seconds' },
  { k: 'other', name: 'Other notes', from: 'from the other stem', ch: 8, col: 'var(--look-f-time)', read: 'Read it on the PC', how: 'many notes at once, by Basic Pitch; about a minute' },
];
/// A part is in the file when it is ticked and, if it has to be read first, has been.
function smIn(p) {
  return SM.parts[p.k] && (!p.read || !!SM.read[p.k]);
}
const SM_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SM_SHAPE = { '': [0, 4, 7], m: [0, 3, 7], 5: [0, 7, 12], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7] };

/// The view, built once and added to the Stems page.
function smBuild() {
  const v = $('stemsView');
  if (!v || $('stMidi')) return;
  const el = document.createElement('div');
  el.className = 'st-view hidden';
  el.id = 'stMidi';
  el.innerHTML = `
    <div class="sm-page">
      <section class="st-panel sm-head">
        <span class="st-cap">The song</span>
        <select class="st-field" id="smSong" title="A song that has been split"></select>
        <span class="st-meta" id="smFacts"></span>
      </section>
      <div class="sm-body">
        <section class="st-panel sm-parts">
          <span class="st-cap">Parts <i>what goes in the file</i></span>
          <div id="smParts"></div>
          <p class="st-note">Each part is a track of its own, on its own MIDI channel. Drums use the General MIDI notes: kick 36, snare 38, hat 42.</p>
        </section>
        <section class="st-panel sm-notes">
          <div class="sm-row"><span class="st-cap">The notes</span><span class="st-meta" id="smSpan"></span><span class="st-grow"></span><button class="st-btn" id="smWhole" disabled>Whole song</button></div>
          <canvas id="smRoll"></canvas>
          <p class="st-note" id="smRollNote">Click a section along the top to look closer.</p>
        </section>
        <section class="st-panel sm-file">
          <span class="st-cap">Timing</span><span id="smTiming"></span>
          <p class="st-note" id="smTimingNote"></p>
          <span class="st-cap">Chords</span><span id="smChords"></span>
          <span class="st-cap">Bass</span><span id="smBass"></span>
          <button class="st-btn st-primary" id="smWrite">Write the MIDI file</button>
          <div class="sm-done hidden" id="smDone"></div>
          <p class="st-note">The file goes beside the stems, in the song's own Stems folder, and opens in any DAW or sequencer.</p>
        </section>
      </div>
    </div>`;
  v.append(el);
  const pick = (id, key, items) => $(id).append(uiSeg({ h: 24, value: SM[key], items, onPick: (k) => { SM[key] = k; smChanged(); } }));
  pick('smTiming', 'timing', [{ k: 'grid', label: 'On the grid' }, { k: 'played', label: 'As the song plays' }]);
  pick('smChords', 'chords', [{ k: 'held', label: 'Held' }, { k: 'bar', label: 'Struck each bar' }]);
  pick('smBass', 'bass', [{ k: 'as', label: 'As played' }, { k: 'up', label: 'An octave up' }]);
  $('smSong').onchange = () => { if ($('smSong').value) stOpenSong($('smSong').value); };
  $('smParts').onchange = (e) => { const k = e.target.dataset?.k; if (k) { SM.parts[k] = e.target.checked; smChanged(); } };
  $('smParts').onclick = (e) => { const b = e.target.closest('button[data-read]'); if (b) { e.preventDefault(); smRead(b.dataset.read); } };
  $('smWhole').onclick = () => { SM.from = 0; SM.to = smBars(); smDraw(); };
  $('smRoll').onclick = (e) => {
    const a = ST.song?.analysis, r = $('smRoll').getBoundingClientRect();
    if (!a || e.clientY - r.top > 22) return;
    const bar = SM.from + (e.clientX - r.left) / r.width * (SM.to - SM.from);
    const s = (a.sections || []).find((x) => bar >= x.start_bar && bar < x.start_bar + x.bars);
    if (s) { SM.from = s.start_bar; SM.to = s.start_bar + s.bars; smDraw(); }
  };
  $('smWrite').onclick = smWrite;
}

function smBars() {
  const a = ST.song?.analysis;
  return a ? (a.bar_count || (a.bars || []).length || 0) : 0;
}

function smChordNotes(name) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name || '');
  if (!m) return [];
  const pc = (SM_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? 11 : 0)) % 12;
  return (SM_SHAPE[m[3]] || SM_SHAPE['']).map((i) => 48 + pc + i);
}

/// Every note of the parts as chosen: [part, bar, step, steps, midi note, velocity 0..1].
function smNotes() {
  const a = ST.song?.analysis, out = [];
  if (!a) return out;
  (a.bars || []).forEach((b, bar) => [[b.kick, 36], [b.snare, 38], [b.hat, 42]].forEach(([row, n]) => (row || []).slice(0, 16).forEach((v, st) => { if (v > 0) out.push(['drums', bar, st, 0.5, n, v]); })));
  for (const [bar, st, len, m, v] of a.bass?.notes || []) out.push(['bass', bar, st, len, Math.round(m) + (SM.bass === 'up' ? 12 : 0), v]);
  const ch = a.chords?.changes || [], n = smBars();
  ch.forEach(([bar, name], i) => {
    const end = i + 1 < ch.length ? ch[i + 1][0] : n, ns = smChordNotes(name);
    if (SM.chords === 'held') { if (end > bar) for (const x of ns) out.push(['chords', bar, 0, (end - bar) * 16, x, 0.7]); }
    else for (let b = bar; b < end; b++) for (const x of ns) out.push(['chords', b, 0, 16, x, 0.7]);
  });
  for (const k of ['melody', 'other']) for (const [bar, st, len, m, v] of SM.read[k] || []) out.push([k, bar, st, len, m, v]);
  return out;
}

/// A choice changed: what was written is no longer what the page shows.
function smChanged() {
  SM.written = null;
  smFill();
}

/// The song changed, or the tab came up: the song list, the facts, the parts.
function smFill() {
  if (!$('stMidi')) return;
  const sel = $('smSong'), cur = ST.song?.p || '';
  sel.innerHTML = `<option value="">${ST.list.length ? 'Pick a split song' : 'Nothing split yet'}</option>` + ST.list.map((s) => `<option value="${stEsc(s.p)}">${stEsc(s.name)}</option>`).join('');
  sel.value = ST.list.some((s) => s.p === cur) ? cur : '';
  const a = ST.song?.analysis;
  if (SM.song !== cur) { SM.song = cur; SM.from = 0; SM.to = smBars(); SM.written = null; SM.read = { melody: null, other: null }; if (cur) smKept(cur); }
  if (!SM.to) SM.to = smBars();
  $('smFacts').textContent = !ST.song ? 'Split a song first, on Split a song.' : !a ? 'This song has not been read yet: press Read again on Split a song.'
    : [a.tempo?.bpm ? `${a.tempo.bpm.toFixed(1)} bpm` : '', a.key?.name || '', `${smBars()} bars`].filter(Boolean).join(' · ');
  const notes = smNotes(), count = (k) => notes.filter((n) => n[0] === k).length;
  $('smParts').innerHTML = SM_PARTS.map((p) => {
    const unread = p.read && !SM.read[p.k], busy = SM.reading === p.k, noPc = p.k === 'other' && !SM.gpu;
    const right = unread
      ? `<button class="st-btn" data-read="${p.k}"${!a || SM.reading || noPc ? ' disabled' : ''} title="${noPc ? 'No GPU machine is set: this is read on the PC' : stEsc(p.how)}">${busy ? 'Reading…' : p.read}</button>`
      : `<span class="n">ch ${p.ch}<small>${a ? `${count(p.k)} notes` : ''}</small></span>`;
    return `<label class="sm-part${smIn(p) ? '' : ' off'}${unread ? ' unread' : ''}" data-part="${p.k}" style="--c:${p.col}"><input type="checkbox" data-k="${p.k}"${SM.parts[p.k] ? ' checked' : ''}${unread ? ' disabled' : ''} /><i></i><span class="nm">${p.name}<small>${unread ? (busy ? 'reading…' : `not read yet · ${p.how}`) : p.from}</small></span>${right}</label>`;
  }).join('');
  $('smTimingNote').textContent = SM.timing === 'grid'
    ? `Every note on the sixteenth it was read on${a?.tempo?.bpm ? `, at ${a.tempo.bpm.toFixed(1)} bpm` : ''}. For a sequencer.`
    : 'The tempo follows the song beat by beat, so the notes line up with the stems in a DAW.';
  const any = SM_PARTS.some(smIn);
  $('smWrite').disabled = !a || !any || SM.busy;
  $('smWrite').textContent = SM.busy ? 'Writing…' : 'Write the MIDI file';
  smShowDone();
  smDraw();
}

function smShowDone() {
  const box = $('smDone'), w = SM.written;
  box.classList.toggle('hidden', !w);
  if (!w) { box.innerHTML = ''; return; }
  box.innerHTML = `<b>Written:</b> ${w.parts.length} ${w.parts.length === 1 ? 'track' : 'tracks'}, ${w.notes} notes, ${(w.bytes / 1024).toFixed(1)} KB<span class="sm-path">${stEsc(w.file)}</span><span class="sm-row"><a class="st-btn" id="smSave" href="/api/stems/midi?p=${encodeURIComponent(w.p)}" download>Download</a><button class="st-btn" id="smShow">Show in Finder</button></span>`;
  $('smShow').onclick = async () => {
    const b = $('smShow');
    b.disabled = true;
    try { await postJSON('/api/stems/midi/show', { p: w.p }); b.textContent = 'Shown'; } catch (e) { b.disabled = false; toast(e.message); }
  };
}

/// The notes already read for a song, kept beside its stems.
async function smKept(p) {
  let r;
  try { r = await api(`/api/stems/notes?p=${encodeURIComponent(p)}`); } catch { return; }
  if (ST.song?.p !== p) return;
  SM.read = { melody: r.melody, other: r.other };
  SM.gpu = !!r.gpu;
  smFill();
}

/// Read a part's notes from its stem: the melody here, the other notes on the PC.
async function smRead(part) {
  if (!ST.song || SM.reading) return;
  const p = ST.song.p;
  SM.reading = part; smFill();
  try {
    const r = await postJSON('/api/stems/notes', { p, part });
    if (ST.song?.p === p) { SM.read[part] = r.notes; SM.written = null; }
    if (!r.notes.length) toast(part === 'melody' ? 'No melody was found in the vocals stem.' : 'No notes were found in the other stem.');
  } catch (e) { toast(e.message); }
  SM.reading = '';
  smFill();
}

async function smWrite() {
  if (!ST.song || SM.busy) return;
  const p = ST.song.p;
  SM.busy = true; SM.written = null; smFill();
  try {
    const r = await postJSON('/api/stems/midi', { p, parts: SM_PARTS.filter(smIn).map((x) => x.k), timing: SM.timing, chords: SM.chords, bass: SM.bass });
    if (ST.song?.p === p) SM.written = { ...r, p };
  } catch (e) { toast(e.message); }
  SM.busy = false;
  smFill();
}

/// The notes over the bars on show: sections and chord names along the top,
/// bass and chords by pitch, the three drum rows along the bottom.
function smDraw() {
  const c = $('smRoll');
  if (!c || ST.tab !== 'midi') return;
  const r = devicePixelRatio || 1, w = 846, h = 500;
  c.width = w * r; c.height = h * r;
  const g = c.getContext('2d');
  g.scale(r, r);
  const a = ST.song?.analysis, total = smBars();
  $('smWhole').disabled = !a || (SM.from === 0 && SM.to === total);
  $('smSpan').textContent = !a ? '' : SM.from === 0 && SM.to === total ? `bars 1 to ${total}` : `bars ${SM.from + 1} to ${SM.to}`;
  $('smRollNote').textContent = a ? 'Click a section along the top to look closer.' : 'No notes to show yet.';
  if (!a || !total) return;
  const bars = Math.max(1, SM.to - SM.from), x = (bar, st = 0) => (bar - SM.from + st / 16) / bars * w;
  const TOP = 22, CH = 18, DR = 78, py0 = TOP + CH + 6, py1 = h - DR - 10;
  const ink = Object.fromEntries(SM_PARTS.map((p) => [p.k, stInk(p.col)])), text = stInk('var(--look-text-2)'), dim = stInk('var(--look-text-3)');
  for (let b = SM.from; b <= SM.to; b++) {
    if (bars > 40 && b % 4) continue;
    g.fillStyle = b % 4 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)';
    g.fillRect(x(b), TOP, 1, h - TOP);
  }
  g.font = '10px ui-monospace, Menlo, monospace';
  for (const s of a.sections || []) {
    const s0 = Math.max(s.start_bar, SM.from), s1 = Math.min(s.start_bar + s.bars, SM.to);
    if (s1 <= s0) continue;
    const sw = x(s1) - x(s0);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x(s0) + 1, 2, sw - 2, TOP - 5);
    g.fillStyle = text;
    if (sw > 14) g.fillText(sw > 70 ? `${s.label} · bar ${s.start_bar + 1}` : s.label, x(s0) + 6, 14);
  }
  const ch = a.chords?.changes || [];
  if (SM.parts.chords) ch.forEach(([bar, name], i) => {
    const end = Math.min(i + 1 < ch.length ? ch[i + 1][0] : total, SM.to), from = Math.max(bar, SM.from);
    if (end <= from) return;
    g.globalAlpha = 0.16; g.fillStyle = ink.chords; g.fillRect(x(from) + 1, TOP, x(end) - x(from) - 2, CH);
    g.globalAlpha = 1;
    if (x(end) - x(from) > 26) g.fillText(name, x(from) + 4, TOP + 13);
  });
  const all = smNotes().filter((n) => n[1] >= SM.from && n[1] < SM.to && SM.parts[n[0]]).sort((p, q) => (p[0] === 'melody') - (q[0] === 'melody')), pitched = all.filter((n) => n[0] !== 'drums');
  let lo = 28, hi = 60;
  for (const n of pitched) { if (n[4] < lo) lo = n[4]; if (n[4] > hi) hi = n[4]; }
  lo -= 1; hi += 1;
  const y = (m) => py1 - (m - lo) / (hi - lo) * (py1 - py0);
  for (const n of pitched) {
    g.globalAlpha = n[0] === 'chords' ? 0.45 : n[0] === 'other' ? 0.35 + 0.5 * n[5] : 0.5 + 0.5 * n[5];
    g.fillStyle = ink[n[0]];
    g.fillRect(x(n[1], n[2]), y(n[4]) - 2, Math.max(2, x(n[1], n[2] + n[3]) - x(n[1], n[2]) - 1), 4);
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, h - DR - 4, w, 1);
  g.fillStyle = dim;
  ['hat', 'snare', 'kick'].forEach((nm, i) => g.fillText(nm, 4, h - DR + 14 + i * 24));
  g.fillStyle = ink.drums;
  for (const n of all) {
    if (n[0] !== 'drums') continue;
    g.globalAlpha = 0.35 + 0.65 * n[5];
    g.fillRect(x(n[1], n[2]), h - DR + 4 + { 42: 0, 38: 1, 36: 2 }[n[4]] * 24, Math.max(2, w / bars / 16 - 1), 14);
  }
  g.globalAlpha = 1;
}
