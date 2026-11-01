// ==================================================== the Peak edit commands
//
// Peak's Edit, Action and DSP menus, less the parts that are its own furniture
// (sampler transfer, CD burning, plug-in hosting) and less the ones a
// nondestructive clip list cannot honestly do.
//
// Every one of them is here rather than on the toolbar, for the same reason
// Peak has them in menus: they are the commands you reach for occasionally and
// want to be able to *find*, not the five you press all day. The toolbar keeps
// those five, plus Crop, plus the snap control — which is not a command at all
// but a setting every command reads.

// ------------------------------------------------------------- ask dialog

/// Ask for a few values and hand them back, or `null` if the user backed out.
///
/// `fields` is a list of `{key, label, type, value, min, max, step, options}`.
/// This exists because ten of the commands below need a number first and each
/// one having its own dialog is ten pieces of markup that can drift apart.
function ask(title, fields, { hint = '', note = '', okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    const box = $('askModal');
    $('askTitle').textContent = title;
    $('askNote').textContent = note;
    $('askOk').textContent = okLabel;

    const body = $('askBody');
    body.innerHTML = '';
    if (hint) {
      const p = document.createElement('p');
      p.className = 'ask-hint';
      p.textContent = hint;
      body.appendChild(p);
    }

    const inputs = {};
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'ask-row';
      const lab = document.createElement('label');
      lab.textContent = f.label;
      row.appendChild(lab);

      let el;
      if (f.type === 'select') {
        el = document.createElement('select');
        for (const [v, t] of f.options) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          el.appendChild(o);
        }
        el.value = f.value ?? f.options[0][0];
      } else if (f.type === 'check') {
        el = document.createElement('input');
        el.type = 'checkbox';
        el.checked = !!f.value;
      } else {
        el = document.createElement('input');
        el.type = f.type === 'text' ? 'text' : 'number';
        if (f.min !== undefined) el.min = f.min;
        if (f.max !== undefined) el.max = f.max;
        if (f.step !== undefined) el.step = f.step;
        el.value = f.value ?? '';
      }
      inputs[f.key] = { el, f };
      row.appendChild(el);
      body.appendChild(row);
    }

    const read = () => {
      const out = {};
      for (const [k, { el, f }] of Object.entries(inputs)) {
        if (f.type === 'check') out[k] = el.checked;
        else if (f.type === 'text' || f.type === 'select') out[k] = el.value;
        else out[k] = Number(el.value);
      }
      return out;
    };

    const close = (value) => {
      box.classList.add('hidden');
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    // Enter accepts and Escape cancels, which is what every other dialog on
    // the machine does. Captured, or the global Escape handler that closes
    // menus swallows it first.
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(read()); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
    };
    document.addEventListener('keydown', onKey, true);

    $('askOk').onclick = () => close(read());
    $('askCancel').onclick = () => close(null);
    $('askClose').onclick = () => close(null);

    box.classList.remove('hidden');
    const first = Object.values(inputs)[0]?.el;
    if (first) { first.focus(); first.select?.(); }
  });
}

// ------------------------------------------------------------------- snap

/// Where edits land. Kept across sessions, because it is a way of working
/// rather than a property of a sound — and on by default, as Peak's Auto Snap
/// is, because the alternative is that every cut can click.
state.snap = prefs.snap;

const snapSel = $('snapUnit');
if (snapSel) {
  snapSel.value = state.snap;
  snapSel.onchange = (e) => {
    state.snap = setPref('snap', e.target.value);
  };
}

/// The ops whose position is a place in the waveform, and so worth snapping.
///
/// A gain or a stretch has a range but no edge that can click, and snapping one
/// would move the boundary of a level change for no reason at all.
const SNAPPABLE = ['cut', 'copy', 'delete', 'paste', 'crop', 'silence', 'fadeIn', 'fadeOut', 'reverse',
                   'duplicate', 'insertSilence', 'split'];

// ------------------------------------------------------- selection and zoom

function selFrames() {
  return state.sel ? state.sel.end - state.sel.start : 0;
}

function needSel() {
  if (!state.selectedFile) { toast('Open a sound first'); return false; }
  if (!state.sel || selFrames() < 1) { toast('Select a range first'); return false; }
  return true;
}

/// Peak's Set Selection: type the numbers instead of dragging them.
async function setSelectionDialog() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const sr = state.view.sampleRate || 44100;
  const total = state.edit?.frames || state.view.frames || 0;
  const cur = state.sel || { start: 0, end: total };
  const v = await ask('Set selection', [
    { key: 'units', label: 'Units', type: 'select', value: 'seconds',
      options: [['seconds', 'seconds'], ['ms', 'milliseconds'], ['samples', 'samples']] },
    { key: 'start', label: 'Start', value: +(cur.start / sr).toFixed(6), step: 'any', min: 0 },
    { key: 'end', label: 'End', value: +(cur.end / sr).toFixed(6), step: 'any', min: 0 },
  ], { hint: 'Start and end are read in the units chosen above. Change the units before typing.' });
  if (!v) return;

  const scale = v.units === 'samples' ? 1 : v.units === 'ms' ? sr / 1000 : sr;
  const a = Math.max(0, Math.min(total, Math.round(v.start * scale)));
  const b = Math.max(0, Math.min(total, Math.round(v.end * scale)));
  if (b <= a) { toast('The end must come after the start'); return; }
  state.sel = { start: a, end: b };
  drawSelection();
  setCue(a);
}

/// Peak's Fit Selection: zoom so the selection fills the lane.
function fitSelection() {
  if (!needSel()) return;
  const frames = state.view.frames || state.edit?.frames || 0;
  if (!frames) return;
  // A little air either side, so the edges of the selection are visible rather
  // than sitting exactly on the bezel.
  const pad = Math.max(1, Math.round(selFrames() * 0.02));
  state.view.from = Math.max(0, state.sel.start - pad);
  state.view.to = Math.min(frames, state.sel.end + pad);
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
}

/// Peak's Zoom at Sample Level: as far in as the display goes, on the cursor.
///
/// `end` puts the view on the end of the selection instead of the start, which
/// is Peak's second shortcut for the same command and is what you want when you
/// are checking the far edge of a loop.
function zoomToSample(end = false) {
  const frames = state.view.frames || state.edit?.frames || 0;
  if (!frames) return;
  const at = state.sel ? (end ? state.sel.end : state.sel.start) : (state.cue || 0);
  // The lane's own floor, the same one `zoom()` clamps to.
  const span = 8;
  const from = Math.max(0, Math.min(frames - span, Math.round(at - span / 2)));
  state.view.from = from;
  state.view.to = from + span;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
}

/// Peak's Go To: jump to a marker, a region, or a time you type.
async function goTo() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const sr = state.view.sampleRate || 44100;
  const a = state.annotations || { markers: [], regions: [] };
  const places = [
    ['0', 'Start of file'],
    ...(state.sel ? [['sel-start', 'Start of selection'], ['sel-end', 'End of selection']] : []),
    ...a.markers.map((m, i) => [`m${i}`, `Marker: ${m.label || '(unnamed)'} — ${fmtTime(m.frame / sr)}`]),
    ...a.regions.map((r, i) => [`r${i}`, `Region: ${r.label || '(unnamed)'} — ${fmtTime(r.start / sr)}`]),
    ['time', 'A time I will type…'],
  ];
  const v = await ask('Go to', [
    { key: 'where', label: 'Location', type: 'select', options: places },
    { key: 'seconds', label: 'Time (seconds)', value: 0, step: 'any', min: 0 },
  ], { hint: 'The time field is only read when “A time I will type” is chosen.' });
  if (!v) return;

  let frame = 0;
  if (v.where === 'time') frame = Math.round(v.seconds * sr);
  else if (v.where === 'sel-start') frame = state.sel?.start ?? 0;
  else if (v.where === 'sel-end') frame = state.sel?.end ?? 0;
  else if (v.where.startsWith('m')) frame = a.markers[+v.where.slice(1)]?.frame ?? 0;
  else if (v.where.startsWith('r')) {
    const r = a.regions[+v.where.slice(1)];
    if (r) { state.sel = { start: r.start, end: r.end }; drawSelection(); }
    frame = r?.start ?? 0;
  }
  setCue(frame);
  centreOn(frame);
}

/// Bring a frame into view without changing how far in you are zoomed.
function centreOn(frame) {
  const { from, to, frames } = state.view;
  if (!frames) return;
  const span = to - from;
  if (!span || span >= frames) return;
  if (frame >= from && frame < to) return; // already on screen
  const a = Math.max(0, Math.min(frames - span, Math.round(frame - span / 2)));
  state.view.from = a;
  state.view.to = a + span;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
}

// ---------------------------------------------------------- the operations

/// Post an edit operation, with the snap setting attached where it applies.
///
/// The server answers with where the edit actually went. Snap is the one
/// setting in the program that quietly changes what a command does to something
/// other than what the screen showed, so when it moves an edge it says so —
/// once, with the distance, rather than leaving you to wonder why the cut is
/// not quite where the highlight was.
async function editCmd(body) {
  const snapped = SNAPPABLE.includes(body.op) && state.snap !== 'off';
  if (snapped) body.snap = state.snap;
  const asked = { start: body.start ?? 0, end: body.end ?? 0 };
  await editOp(body);

  const s = state.edit?.snapped;
  if (!s) return null;
  const moved = Math.abs(s.start - asked.start) + Math.abs(s.end - asked.end);
  if (moved > 0) {
    toast(`Snapped to ${s.unit === 'zero' ? 'zero crossings' : s.unit.toUpperCase()} — moved ${moved} sample${moved === 1 ? '' : 's'}`);
  }
  return s;
}

async function duplicateCmd() {
  if (!needSel()) return;
  const v = await ask('Duplicate', [
    { key: 'count', label: 'Extra copies', value: 3, min: 1, max: 128, step: 1 },
  ], { hint: 'The copies go straight after the selection and push everything else along — one bar of drums into four.' });
  if (!v) return;
  await editCmd({ op: 'duplicate', start: state.sel.start, end: state.sel.end, count: v.count });
}

async function insertSilenceCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const at = state.sel ? state.sel.start : (state.cue || 0);
  const v = await ask('Insert silence', [
    { key: 'ms', label: 'Length (ms)', value: 500, min: 1, max: 600000, step: 1 },
  ], { hint: 'Everything after the insertion point moves later in time. This is not the same as Silence, which overwrites.',
       note: `at ${fmtTime(at / (state.view.sampleRate || 44100))}` });
  if (!v) return;
  await editCmd({ op: 'insertSilence', start: at, end: at, ms: v.ms });
}

async function normalizeCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const v = await ask('Normalize', [
    { key: 'db', label: 'Peak level (dB)', value: -0.3, min: -60, max: 0, step: 0.1 },
  ], { hint: 'The whole document is scaled so its loudest sample lands here.' });
  if (!v) return;
  await editOp({ op: 'normalize', db: v.db });
  toast(`Normalized to ${v.db} dB`);
}

async function normalizeRmsCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const v = await ask('Normalize (RMS)', [
    { key: 'db', label: 'Average level (dB)', value: -12, min: -60, max: 0, step: 0.1 },
    { key: 'ceilingDb', label: 'Ceiling (dB)', value: -0.3, min: -60, max: 0, step: 0.1 },
  ], { hint: 'Sets the average rather than the peak. Where the ceiling gets in the way it wins, and the result comes out quieter than asked — nothing is clipped to reach a number.' });
  if (!v) return;
  const r = await postJSON('/api/measure', { p: state.selectedFile.path, start: 0, end: 0 })
    .catch(() => null);
  await editOp({ op: 'normalizeRms', db: v.db, ceilingDb: v.ceilingDb });
  const after = await postJSON('/api/measure', { p: state.selectedFile.path, start: 0, end: 0 })
    .catch(() => null);
  if (r && after) {
    // Both measurements are of the rendered output, rack and all — the same
    // rule peak normalising follows, because normalising against a level that
    // ignored a rack boost would clip the export. The consequence is that an
    // auto-levelling maximiser will pull the result away from the target, and
    // a number that quietly misses by three decibels reads as a broken
    // command unless it says why.
    const miss = Math.abs(after.rmsDb - v.db);
    const levelling = miss > 1 && state.rack?.master?.on && state.rack?.master?.autoLevel;
    toast(`RMS ${r.rmsDb.toFixed(1)} → ${after.rmsDb.toFixed(1)} dB, peak ${after.peakDb.toFixed(1)} dB`
      + (levelling ? ' — the maximiser is levelling the output, so the target is its call, not this one\u2019s' : ''));
  }
}

/// Peak's Find Peak: a measurement that moves the insertion point.
async function findPeakCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const range = state.sel ? { start: state.sel.start, end: state.sel.end } : { start: 0, end: 0 };
  let r;
  try { r = await postJSON('/api/measure', { p: state.selectedFile.path, ...range }); }
  catch (e) { toast(e.message); return; }
  if (r.peakFrame === undefined) { toast('Nothing to measure'); return; }
  setCue(r.peakFrame);
  centreOn(r.peakFrame);
  const sr = state.view.sampleRate || 44100;
  toast(`Peak ${r.peakDb.toFixed(2)} dB at ${fmtTime(r.peakFrame / sr)}${state.sel ? ' in the selection' : ''}`);
}

async function stripSilenceCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const v = await ask('Strip silence', [
    { key: 'thresholdDb', label: 'Threshold (dB)', value: -40, min: -90, max: 0, step: 1 },
    { key: 'minMs', label: 'Shortest gap (ms)', value: 100, min: 1, max: 60000, step: 1 },
    { key: 'padMs', label: 'Leave either side (ms)', value: 10, min: 0, max: 5000, step: 1 },
    { key: 'mode', label: 'What to do', type: 'select', value: 'remove',
      options: [['remove', 'remove it and close the gap'], ['silence', 'flatten it, keep the timing']] },
  ], { hint: 'Level is judged over a short window, so a loud waveform passing through zero is not mistaken for silence. Find Peak on a quiet passage is a good way to choose the threshold.' });
  if (!v) return;
  const before = state.edit?.frames || 0;
  await editOp({ op: 'stripSilence', start: state.sel?.start ?? 0, end: state.sel?.end ?? 0, ...v });
  const after = state.edit?.frames || 0;
  const sr = state.view.sampleRate || 44100;
  toast(v.mode === 'remove'
    ? (before === after ? 'No silence found at that threshold' : `Removed ${((before - after) / sr).toFixed(2)}s`)
    : 'Quiet passages flattened');
}

async function repairClickCmd() {
  if (!needSel()) return;
  const v = await ask('Repair click', [
    { key: 'widthMs', label: 'Width to remove (ms)', value: 1, min: 0.05, max: 50, step: 0.05 },
  ], { hint: 'The worst discontinuity in the selection is taken out and the join is ramped so it cannot step. Peak redraws the damaged samples instead; a clip list has no way to write one, so this removes them — a fraction of a millisecond, and inaudible.' });
  if (!v) return;
  const before = state.edit?.frames || 0;
  await editOp({ op: 'repairClick', start: state.sel.start, end: state.sel.end, widthMs: v.widthMs });
  const gone = before - (state.edit?.frames || 0);
  toast(gone > 0 ? `Repaired — ${gone} samples removed` : 'No click found in the selection');
}

// ----------------------------------------------- markers and regions, Peak's

async function annot(body) {
  if (!state.selectedFile) { toast('Open a sound first'); return null; }
  try {
    state.annotations = await postJSON('/api/annot', { p: state.selectedFile.path, ...body });
  } catch (e) { toast(e.message); return null; }
  drawMarkers();
  return state.annotations;
}

async function markersToRegionsCmd() {
  const each = false;
  const r = await annot({
    op: 'markersToRegions',
    start: state.sel?.start ?? 0,
    end: state.sel?.end ?? 0,
    each,
  });
  if (r) toast(`${r.regions.length} region${r.regions.length === 1 ? '' : 's'}`);
}

async function splitRegionCmd() {
  const pos = state.sel ? state.sel.start : (state.cue || 0);
  const was = state.annotations?.regions?.length ?? 0;
  const r = await annot({ op: 'splitRegion', pos });
  if (!r) return;
  // A split at frame zero, or at the very end, has nothing on both sides of it
  // and does nothing. Saying "Split" anyway is worse than saying nothing.
  toast(r.regions.length > was
    ? 'Split'
    : 'Nothing to split at the cursor — put it inside a region, or somewhere other than the very start');
}

async function nudgeCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const sr = state.view.sampleRate || 44100;
  const v = await ask('Nudge markers', [
    { key: 'seconds', label: 'By (seconds)', value: 0.1, step: 'any' },
  ], { hint: 'Positive moves later, negative earlier. Markers and regions inside the selection move; the rest stay. With no selection, everything moves.' });
  if (!v) return;
  await annot({
    op: 'nudge',
    start: state.sel?.start ?? 0,
    end: state.sel?.end ?? 0,
    frames: Math.round(v.seconds * sr),
  });
}

async function renameCmd() {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  const v = await ask('Rename markers and regions', [
    { key: 'to', label: 'Rename to', type: 'text', value: 'Hit #' },
    { key: 'startAt', label: 'Start at', type: 'text', value: '1' },
    { key: 'contains', label: 'Only those containing', type: 'text', value: '' },
    { key: 'markers', label: 'Markers', type: 'check', value: true },
    { key: 'regions', label: 'Regions', type: 'check', value: false },
  ], { hint: '# becomes a number or a letter counting up from “Start at”. Zeros after it set the width: “Event #000” from 10 gives Event 010, Event 011. They are numbered in timeline order.' });
  if (!v) return;
  const body = {
    op: 'rename',
    start: state.sel?.start ?? 0,
    end: state.sel?.end ?? 0,
    to: v.to,
    startAt: v.startAt,
    markers: v.markers,
    regions: v.regions,
  };
  if (v.contains) body.contains = v.contains;
  await annot(body);
}

async function deleteMarkersCmd() {
  const r = await annot({
    op: 'deleteMarkers',
    start: state.sel?.start ?? 0,
    end: state.sel?.end ?? 0,
  });
  if (r) toast('Markers deleted');
}

// ------------------------------------------------------------ into the menus
//
// Appended rather than written into MENUS above, so the two new menus sit where
// Peak has them — after Edit — without disturbing the four that were there.

MENUS.splice(2, 0,
  {
    title: 'Action',
    items: [
      { label: 'Set selection…', on: hasFile, run: setSelectionDialog },
      { label: 'Select all', key: '⌘A', on: hasFile, run: () => selectAll() },
      { sep: true },
      { label: 'Fit selection', key: '⇧⌘]', on: hasSel, run: fitSelection },
      { label: 'Zoom at sample level', key: '⇧←', on: hasFile, run: () => zoomToSample(false) },
      { label: 'Zoom at sample level (end)', key: '⇧→', on: hasSel, run: () => zoomToSample(true) },
      { label: 'Zoom out all the way', on: hasFile, run: click('zoomFit') },
      { sep: true },
      { label: 'Snap to zero crossings', key: tick(() => state.snap === 'zero'),
        run: () => setSnap('zero') },
      { label: 'Snap to CD frames', key: tick(() => state.snap === 'cd'), run: () => setSnap('cd') },
      { label: 'Snap off', key: tick(() => state.snap === 'off'), run: () => setSnap('off') },
      { sep: true },
      { label: 'New marker', key: 'M', on: hasFile, run: op('marker') },
      { label: 'New region', key: 'R', on: hasSel, run: op('region') },
      { label: 'New region split', on: hasFile, run: splitRegionCmd },
      { label: 'Markers to regions', on: hasFile, run: markersToRegionsCmd },
      { sep: true },
      { label: 'Nudge markers…', on: hasFile, run: nudgeCmd },
      { label: 'Rename…', on: hasFile, run: renameCmd },
      { label: 'Delete markers in selection', on: hasSel, run: deleteMarkersCmd },
      { sep: true },
      { label: 'Go to…', key: '⌘G', on: hasFile, run: goTo },
    ],
  },
  {
    title: 'DSP',
    items: [
      { label: 'Gain…', on: hasFile, run: gainCmd },
      { label: 'Normalize…', on: hasFile, run: normalizeCmd },
      { label: 'Normalize (RMS)…', on: hasFile, run: normalizeRmsCmd },
      { label: 'Find peak', on: hasFile, run: findPeakCmd },
      { sep: true },
      { label: 'Fade in', on: hasSel, run: op('fadeIn') },
      { label: 'Fade out', on: hasSel, run: op('fadeOut') },
      { label: 'Reverse', on: hasSel, run: op('reverse') },
      { sep: true },
      { label: 'Strip silence…', on: hasFile, run: stripSilenceCmd },
      { label: 'Repair click…', on: hasSel, run: repairClickCmd },
      { sep: true },
      // The live ones. They are rack effects here rather than commands you
      // apply and wait for, so the menu says where they are rather than
      // pretending to be a second way of running them.
      { label: 'Live shapers are in the Effects tray', on: () => false, run: () => {} },
    ],
  },
);

function setSnap(unit) {
  state.snap = setPref('snap', unit);
  const sel = $('snapUnit');
  if (sel) sel.value = unit;
  wtSync();
  toast(unit === 'off' ? 'Snap off' : `Snapping to ${unit === 'zero' ? 'zero crossings' : unit.toUpperCase()}`);
}

// The Edit menu gains the three commands that belong to it rather than to
// Action or DSP, next to the ones they are variants of.
(() => {
  const edit = MENUS.find((m) => m.title === 'Edit');
  const at = edit.items.findIndex((i) => i.label === 'Silence');
  edit.items.splice(at, 0,
    { label: 'Crop', key: '⌘`', on: hasSel, run: op('crop') },
    { label: 'Duplicate…', on: hasSel, run: duplicateCmd },
    { label: 'Insert silence…', on: hasFile, run: insertSilenceCmd },
  );
  buildMenuBar();
})();

