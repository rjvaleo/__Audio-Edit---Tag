// =================================================================== editing

/// Apply a document operation.
///
/// `live` is for continuous controls: it refreshes the document and the
/// waveform but does not refit the zoom or restart playback, so dragging a
/// slider does not stutter the audio or throw away where you were looking.
/// Operations that change what the source timeline contains, as opposed to
/// how it is played back. Only these invalidate a selection or the overview.
const STRUCTURAL = ['cut', 'delete', 'paste', 'crop', 'duplicate', 'insertSilence', 'reverse', 'silence',
                    'fadeIn', 'fadeOut', 'gain', 'normalize', 'normalizeRms',
                    'stripSilence', 'repairClick', 'split', 'undo', 'redo', 'revert'];

async function editOp(body, { live = false } = {}) {
  if (!state.selectedFile) return;
  try { state.edit = await postJSON('/api/edit', { p: state.selectedFile.path, ...body }); }
  catch (e) { toast(e.message); return; }

  reflectEditState();
  renderStretch();
  renderGrainParams();
  loadGrains();
  pushGrainParams();
  renderTabs();

  if (live) {
    // Dragging: the numbers are already right, and the picture catches up when
    // the pointer is released.
    setBusy(true);
    return;
  }

  // Only operations that remove or reorder material invalidate a selection.
  // Clearing it on every change also broke selection looping, since the
  // selection is what defines the loop.
  if (STRUCTURAL.includes(body.op)) {
    state.sel = null;
    applyLoop();
  } else if (state.sel) {
    const max = state.edit?.frames ?? 0;
    state.sel = { start: Math.min(state.sel.start, max), end: Math.min(state.sel.end, max) };
    if (state.sel.end - state.sel.start < 2) state.sel = null;
  }
  drawSelection();

  // The overview is of the source and does not change when a value does, so
  // it is left alone — redrawing it was what made the playhead jump about.
  // Structural edits do change the source mapping, so those still refit.
  if (STRUCTURAL.includes(body.op)) {
    state.view.from = 0;
    state.view.to = 0;
    await loadPeaks();
    if (state.showSpec) loadSpectrogram();
  }
  reloadAudioSource();
  setBusy(false);
}

/// Say plainly that the waveform is behind the controls, rather than letting it
/// look wrong.
function setBusy(on) {
  const el = $('stretchOut');
  if (el) el.classList.toggle('pending', on);
}

function reflectEditState() {
  const e = state.edit;
  $('undoBtn').disabled = !e?.canUndo;
  $('redoBtn').disabled = !e?.canRedo;
  // An effect rack with no edits is still worth exporting, so the button is
  // only gated on having a file open.
  $('editedFlag').classList.toggle('hidden', !e?.edited && !state.rack?.active);
  $('exportBtn').disabled = !state.selectedFile;
  wtSync();
}

/// Nothing to repoint any more.
///
/// The engine holds the audio. Performance controls reach it as parameters and
/// change the sound where it stands; structural edits are folded into its
/// source by the server. Either way playback is never torn down and rebuilt,
/// which is what the old element required and what made a pitch change look
/// like a bug.
function reloadAudioSource() {
  applyLoop();
}

const NEEDS_SELECTION = ['cut', 'crop', 'silence', 'fadeIn', 'fadeOut', 'reverse', 'region'];

document.querySelectorAll('#editTools [data-op]').forEach((b) => {
  b.onclick = () => {
    const op = b.dataset.op;
    if (NEEDS_SELECTION.includes(op) && !state.sel) { toast('Select a range first'); return; }
    if (op === 'marker') return addMarker();
    if (op === 'region') return addRegion();

    const body = { op, start: state.sel.start, end: state.sel.end };
    if (op === 'fadeIn' || op === 'fadeOut') {
      body.frames = state.sel.end - state.sel.start;
      body.shape = state.fadeShape;
    }
    // Through `editCmd` rather than `editOp`, so the snap setting reaches the
    // toolbar buttons and not only the menu items. One command, one path.
    editCmd(body);
  };
});

$('fadeShape').onchange = (e) => { state.fadeShape = e.target.value; };
$('exportBits').onchange = (e) => { state.exportBits = +e.target.value; };

$('undoBtn').onclick = async () => { await editOp({ op: 'undo' }); syncStretchSliders(); };
$('redoBtn').onclick = async () => { await editOp({ op: 'redo' }); syncStretchSliders(); };
$('revertBtn').onclick = async () => { await editOp({ op: 'revert' }); syncStretchSliders(); };

/// Export lands beside the original, as an AIFF named for what was done to it.
///
/// The path is long and mostly the library, so the toast says the name — which
/// is the part that changed and the part you will look for.
/// What the transport is looping, in **source** frames, or `null`.
///
/// The same rule the transport uses: the selection if there is one, the whole
/// document if there is not — see `applyLoop`. Source frames rather than the
/// engine frames `applyLoop` sends, because the export is at the document's own
/// sample rate and the server maps them through the stretch itself.
function exportLoopRange() {
  if (!state.loopOn) return null;
  const sel = state.sel;
  if (sel && sel.end > sel.start) return { from: sel.start, to: sel.end };
  const frames = state.edit?.baseFrames || state.view?.frames || 0;
  return frames > 0 ? { from: 0, to: frames } : null;
}

/// Start it, then watch. `range` null is the whole-file export.
///
/// The request returns as soon as the render has a thread of its own, so what
/// comes back says only that it started — the outcome arrives through
/// `/api/export`, which is also where the progress comes from. A four-minute
/// file takes twenty-five seconds and the old call simply blocked for all of
/// it with nothing on screen.
/// Whoever is waiting for the export under way to finish — the Compose export,
/// which films once the sound is written. Each is handed how it ended.
let exportWaiters = [];
function exportFinished() {
  return new Promise((resolve) => exportWaiters.push(resolve));
}
function exportSettle(outcome) {
  for (const w of exportWaiters.splice(0)) w(outcome);
}

/// What is added to the export once the server has written it: the
/// sequencer's stem, and the GRAIN switch. Set by `runExport`, read by
/// `pollExport` when the file is there. `null` when nothing is to be added.
let exportAfter = null;

/// Whether the sequencer goes into this export: the dialog's switch while it
/// is open, the SEQ source switch otherwise — a whole-file export has no
/// dialog, and the switch on the transport is where you already said.
function exportWithSeq() {
  if (!seqLoaded()) return false;
  const dlg = $('exportLoop');
  if (dlg && !dlg.classList.contains('hidden')) return !!$('elSeq')?.classList.contains('on');
  return sourceOn('seq');
}

async function runExport(range, repeats, tail, opts = {}) {
  if (!state.selectedFile) return;
  const body = { p: state.selectedFile.path, bits: state.exportBits };
  // Into a folder of its own beside the document — the Compose export's.
  if (opts.folder) body.folder = opts.folder;
  const withSeq = exportWithSeq();
  const grain = sourceOn('grain');
  exportAfter = (withSeq || !grain)
    ? { withSeq, grain, at0: ((range ? range.from : 0) / (state.view?.sampleRate || 48000)) * timeRatio(), bits: state.exportBits }
    : null;
  if (range) {
    body.from = Math.round(range.from);
    body.to = Math.round(range.to);
    body.repeats = repeats;
    body.tail = !!tail;
  }
  try {
    await postJSON('/api/export', body);
  } catch (e) {
    toast('Export failed: ' + e.message);
    exportSettle({ error: e.message });
    return;
  }
  showExportProgress(true);
  pollExport();
}

// ----------------------------------------------------------- the export bar

/// What the server calls each phase, in words.
///
/// Named here rather than sent as prose so the server keeps saying one word and
/// the interface decides how to put it — the same split the rest of the app
/// uses for its labels.
const EXPORT_PHASES = {
  starting: 'Starting',
  reading: 'Reading',
  stretching: 'Stretching',
  effects: 'Effects',
  tail: 'Tail',
  writing: 'Writing',
  stopping: 'Stopping',
  done: 'Done',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

function showExportProgress(on) {
  $('exportProgress').classList.toggle('hidden', !on);
  $('exportBtn').disabled = on || !state.selectedFile;
  if (on) {
    $('epFill').style.width = '0%';
    $('epPct').textContent = '0%';
    $('epPhase').textContent = 'Starting';
  }
}

let exportSerial = null;

async function pollExport() {
  let s;
  try { s = await api('/api/export'); } catch { showExportProgress(false); exportSettle({ error: 'the export could not be asked about' }); return; }

  const pct = Math.round((s.fraction || 0) * 100);
  $('epFill').style.width = pct + '%';
  $('epPct').textContent = pct + '%';
  $('epPhase').textContent = EXPORT_PHASES[s.phase] || s.phase || 'Exporting';

  if (s.running) { setTimeout(pollExport, 250); return; }

  showExportProgress(false);
  // `serial` is bumped once per finished run, so a poll landing after a result
  // has already been reported does not report it twice.
  if (s.serial === exportSerial) return;
  exportSerial = s.serial;

  if (s.error) { toast('Export failed: ' + s.error); exportSettle({ error: s.error }); return; }
  if (s.cancelled || s.phase === 'cancelled') { toast('Export stopped — nothing written'); exportSettle({ cancelled: true }); return; }
  if (s.path) {
    const name = s.path.split('/').pop();
    const secs = state.view?.sampleRate ? (s.frames / state.view.sampleRate) : 0;
    const after = exportAfter;
    exportAfter = null;
    if (after) {
      try {
        await exportAddStem(s, after);
      } catch (e) {
        toast('Exported, but the sequencer could not be added: ' + e.message);
        exportSettle({ path: s.path, error: e.message });
        return;
      }
    }
    const what = after && after.withSeq ? (after.grain ? ' with the sequencer' : ', the sequencer alone') : after && !after.grain ? ', silent — GRAIN is off' : '';
    toast(`Exported ${secs.toFixed(2)}s, ${state.exportBits}-bit AIFF beside the original${what} — ${name}`);
    exportSettle({ path: s.path, frames: s.frames });
    return;
  }
  exportSettle({ error: 'nothing was written' });
}

/// The sequencer, rendered for the export's length from where it starts,
/// posted to the server, and summed into the file — after the export, so
/// nothing here has to know how long a loop with a tail comes out.
async function exportAddStem(s, after) {
  // The file's rate, as the server wrote it, so the stem needs no resampling.
  const rate = s.sampleRate || state.view?.sampleRate || 48000;
  const seconds = Math.max(0.1, (s.frames || 0) / rate);
  let body = new ArrayBuffer(0);
  if (after.withSeq) {
    showExportProgress(true);
    $('epPhase').textContent = 'Rendering the sequencer';
    // **Round the loop, as the sound goes.** The server says where the loop it
    // tiled starts, how long it is and how many times it went round, and the
    // sequencer is laid on the same loop — its steps again from the loop's
    // start on every repeat, nothing new through the tail.
    const loop = s.loop && s.loop.frames > 0 ? { span: s.loop.frames / rate, repeats: s.loop.repeats } : null;
    const r = await seqRenderForFilm({
      at0: loop ? s.loop.from / rate : after.at0, seconds, rate, loop,
      // A knob is set once a frame of the render. Once a second is plenty for a
      // pattern and far too coarse for a take, whose moves would step.
      fps: seq.take ? 30 : 1, bands: 8, liss: 16,
      // In a composition's export the film is next, and it is handed this same
      // render — so it is made in the film's shape. See `seqShared`.
      ...seqShareSpec(seconds),
      onProgress: (f) => { $('epFill').style.width = `${Math.round(f * 100)}%`; $('epPct').textContent = `${Math.round(f * 100)}%`; },
    });
    if (r && r.left) {
      const n = r.left.length;
      const inter = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { inter[i * 2] = r.left[i]; inter[i * 2 + 1] = (r.right || r.left)[i]; }
      body = inter.buffer;
    }
    $('epPhase').textContent = 'Adding the sequencer';
  }
  try {
    const q = `rate=${rate}&channels=2&grain=${after.grain ? 1 : 0}&bits=${after.bits}`;
    const res = await fetch(`/api/export/stem?${q}`, { method: 'POST', body });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
  } finally {
    showExportProgress(false);
  }
}

$('epStop').onclick = () => {
  $('epStop').disabled = true;
  api('/api/export/stop', { method: 'POST' })
    .catch(() => {})
    .finally(() => { $('epStop').disabled = false; });
};

// An export left running when the page was reloaded is still running, and the
// bar is the only way to find out. Picked up rather than lost.
(async () => {
  try {
    const s = await api('/api/export');
    exportSerial = s.serial;
    if (s.running) { showExportProgress(true); pollExport(); }
  } catch { /* server not up yet; the next export starts its own poll */ }
})();

// ------------------------------------------------------------- the loop box

let exportRange = null;

function exportSeconds(range, repeats) {
  const sr = state.view?.sampleRate || 48000;
  const ratio = state.edit?.stretch?.ratio ?? 1;
  return ((range.to - range.from) / sr) * ratio * repeats;
}

function paintExportLoop() {
  if (!exportRange) return;
  const repeats = Math.max(1, Math.min(512, +$('elRepeats').value || 1));
  const sr = state.view?.sampleRate || 48000;
  const ratio = state.edit?.stretch?.ratio ?? 1;
  const one = ((exportRange.to - exportRange.from) / sr) * ratio;
  $('elRange').textContent = `${one.toFixed(2)}s loop`;
  $('elLength').textContent =
    `${exportSeconds(exportRange, repeats).toFixed(2)}s of audio${
      $('elTail').classList.contains('on') ? ', plus the tail' : ''}`;
}

/// The export size that matches the frame the room is posed in.
///
/// **The shape is the room's; the resolution stays yours.** Composing in 9:16
/// and then opening the export box on `HD` means filming the vertical camera
/// into a landscape frame — the shape is a decision already made, and the box
/// should arrive agreeing with it rather than asking again.
///
/// So the orientation follows the frame and the resolution is carried across:
/// 4K with the room in 9:16 becomes Vertical 4K, not Vertical. `Dock` says
/// nothing about shape, so it leaves the choice alone.
function videoSizeForFrame(current) {
  const f = roomFrame();
  if (!f || !(f.ratio > 0)) return current;
  const same = VIDEO_SIZES.filter((s) => Math.abs(s.w / s.h - f.ratio) < 0.02);
  if (!same.length || same.some((s) => s.key === current)) return current;
  const cur = VIDEO_SIZES.find((s) => s.key === current);
  const px = cur ? cur.w * cur.h : 1920 * 1080;
  return same.reduce((best, s) =>
    (Math.abs(s.w * s.h - px) < Math.abs(best.w * best.h - px) ? s : best)).key;
}

function openExportLoop(range) {
  exportRange = range;
  buildVideoPickers();
  // The sequencer switch starts from the SEQ source switch; the dialog is
  // where one export can say otherwise.
  $('elSeq')?.classList.toggle('on', seqLoaded() && sourceOn('seq'));
  // Set on every open rather than once when the pickers are built: the frame
  // can change between one export and the next, and the box is the last place
  // that choice is visible before it is filmed.
  const size = $('elVideoSize');
  if (size) size.value = videoSizeForFrame(size.value);
  paintVideoScope();
  $('exportLoop').classList.remove('hidden');
  paintExportLoop();
  $('elRepeats').focus();
  $('elRepeats').select();
}

function closeExportLoop() {
  $('exportLoop').classList.add('hidden');
  exportRange = null;
}

$('exportBtn').onclick = () => {
  if (!state.selectedFile) return;
  // Loop off is the export that was always here — no box, no questions.
  const range = exportLoopRange();
  if (!range) { runExport(null); return; }
  openExportLoop(range);
};

/// The video's own way in.
///
/// `exportBtn` only opens this box when the loop is on — with it off, the audio
/// export is the one that was always here, no box and no questions, and that is
/// worth keeping. But it left the video unreachable in exactly the case where
/// somebody has no loop set and wants to film the whole thing. So the video has
/// a button of its own, and it always opens the box.
$('videoBtn').onclick = () => {
  if (!state.selectedFile) return;
  const why = videoExportSupport();
  if (why) { toast(why); return; }
  openExportLoop(exportLoopRange());
};

$('visMenuBtn').onclick = (e) => {
  e.stopPropagation();
  toggleVisMenuAdmin();
};

// Anywhere else closes it. A panel that edits the menu is a panel you open,
// change one thing in, and leave.
document.addEventListener('pointerdown', (e) => {
  const host = $('visMenuAdmin');
  if (!host || host.classList.contains('hidden')) return;
  if (host.contains(e.target) || $('visMenuBtn')?.contains(e.target)) return;
  toggleVisMenuAdmin(false);
});

$('elClose').onclick = closeExportLoop;
$('elRepeats').oninput = paintExportLoop;
$('elRepeats').onkeydown = (e) => {
  // Tier 1 owns the key while a field has focus, so Enter has to be handled
  // here or it does nothing at all.
  if (e.key === 'Enter') { e.preventDefault(); $('elGo').click(); }
};
$('elSeq')?.addEventListener('click', () => {
  if (!seqLoaded()) { toast('Open Seq first — the sequencer is not loaded'); return; }
  $('elSeq').classList.toggle('on');
});
$('elTail').onclick = () => {
  $('elTail').classList.toggle('on');
  paintExportLoop();
};
$('elWhole').onclick = () => { closeExportLoop(); runExport(null); };

// ── the video ───────────────────────────────────────────────────────────────
//
// The same box, with a second destination on it. Everything the video needs
// about *what* to render — the loop, the repeats, the tail — is already on this
// dialog and already means the same thing; only the size and the rate are new.
// See `docs/VIDEO-EXPORT.md`.

/// What the video is filming: the selection, or the whole file.
///
/// Its own choice rather than being read off the loop, because the two are
/// different questions. The loop decides what the *audio* export renders; a
/// video of the whole file is a perfectly ordinary thing to want while a loop
/// happens to be set, and a video of the selection is what you want most of the
/// time whether or not the loop is currently on.
let videoScope = 'selection';

function paintVideoScope() {
  const range = exportRange;
  // Nothing selected means there is nothing to choose between.
  if (!range) videoScope = 'whole';
  $('elScopeSel').classList.toggle('on', videoScope === 'selection');
  $('elScopeAll').classList.toggle('on', videoScope === 'whole');
  $('elScopeSel').disabled = !range;
  const note = $('elScopeNote');
  if (!note) return;
  if (!range) {
    note.textContent = 'No selection — the whole file, once.';
  } else if (videoScope === 'selection') {
    const secs = (range.to - range.from) / (state.view?.sampleRate || 44100);
    note.textContent = `${secs.toFixed(2)}s, repeated as set above.`;
  } else {
    note.textContent = 'The whole file, once, ignoring the loop.';
  }
}

$('elScopeSel').onclick = () => {
  if (!exportRange) return;
  videoScope = 'selection';
  paintVideoScope();
};
$('elScopeAll').onclick = () => { videoScope = 'whole'; paintVideoScope(); };

function buildVideoPickers() {
  const size = $('elVideoSize');
  const fps = $('elVideoFps');
  if (!size || size.children.length) return;
  for (const s of VIDEO_SIZES) {
    const o = document.createElement('option');
    o.value = s.key;
    o.textContent = `${s.label} · ${s.w}×${s.h}`;
    size.appendChild(o);
  }
  size.value = localStorage.getItem('videoSize') || 'hd';
  size.onchange = () => { try { localStorage.setItem('videoSize', size.value); } catch {} };
  for (const r of VIDEO_RATES) {
    const o = document.createElement('option');
    o.value = String(r);
    o.textContent = `${r} fps`;
    fps.appendChild(o);
  }
  fps.value = localStorage.getItem('videoFps') || '30';
  fps.onchange = () => { try { localStorage.setItem('videoFps', fps.value); } catch {} };
}

let videoRun = null;

/// A duration, said the way somebody waiting would say it.
function videoWhen(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.round(seconds - m * 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function runVideoExport({ save = null } = {}) {
  if (videoRun) {
    videoRun.abort();
    return;
  }
  const why = videoExportSupport();
  if (why) { toast(why); return; }
  if (!state.selectedFile) return;
  const size = VIDEO_SIZES.find((s) => s.key === $('elVideoSize').value) || VIDEO_SIZES[1];
  const fps = +$('elVideoFps').value || 30;
  // The selection looped, or the whole file once. `repeats: 0` is how the
  // server is told there is no loop plan, which is the same thing the audio
  // export's "Whole file instead" says.
  const filming = videoScope === 'selection' && exportRange ? exportRange : null;
  const repeats = filming
    ? Math.max(1, Math.min(512, +$('elRepeats').value || 1))
    : 0;
  const tail = $('elTail').classList.contains('on');

  const ctrl = new AbortController();
  videoRun = ctrl;
  $('elVideo').textContent = 'Stop';

  // The same bar the audio export uses, rather than a second way of saying the
  // same thing in a different corner.
  $('exportProgress').classList.remove('hidden');
  $('epFill').style.width = '0%';
  $('epPct').textContent = '0%';
  $('epPhase').textContent = 'Filming';

  // **What is left, not just what is done.** A percentage on its own says
  // nothing about whether to wait or go and do something else, and the useful
  // part of filming is that it is a known number of frames at a rate that
  // settles within a second or two. So the count and the time are shown, and
  // the time is measured over the *recent* rate rather than the whole run —
  // the first few frames include compiling shaders and warming an encoder, and
  // an average that never forgets them reads high for minutes.
  const began = performance.now();
  let mark = began;
  let markDone = 0;
  let rate = 0;
  const say = (text, f, done, total) => {
    const pct = Math.max(0, Math.min(100, Math.round((f || 0) * 100)));
    $('epFill').style.width = pct + '%';
    $('epPct').textContent = pct + '%';
    $('epPhase').textContent = text;
    let line = text;
    if (total) {
      const now = performance.now();
      if (now - mark > 400) {
        const inst = (done - markDone) / ((now - mark) / 1000);
        rate = rate ? rate * 0.7 + inst * 0.3 : inst;
        mark = now;
        markDone = done;
      }
      line = `${text} · ${done.toLocaleString()} of ${total.toLocaleString()}`;
      if (rate > 0.01) {
        const left = (total - done) / rate;
        line += ` · ${videoWhen(left)} left · ${rate.toFixed(0)}/s`;
      }
    } else {
      line = `${text} · ${pct}%`;
    }
    $('elStatus').textContent = line;
  };
  try {
    // The loop's range in *output* frames, so a repeat plays the same grains
    // again rather than running off the end of the document.
    //
    // The schedule itself is fetched in windows as the film walks, the same way
    // the live room fetches its swarm — see `videoExport`. One request for the
    // whole document spends the cap across the entire file and leaves any given
    // moment nearly empty.
    const grainsAt = (from, to) => api(
      `/api/grains?p=${encodeURIComponent(state.selectedFile.path)}&from=${from}&to=${to}`,
    ).catch(() => null);
    const ratio = state.edit?.baseFrames
      ? (state.edit.frames || state.view?.frames || state.edit.baseFrames) / state.edit.baseFrames
      : 1;
    const loopOut = filming
      ? { from: Math.round(filming.from * ratio), to: Math.round(filming.to * ratio) }
      : null;
    // The sequencer, if it is loaded and asked for. Its grid runs along the
    // engine's output time from the document's start, so the film's first
    // frame is at the range's start, stretched.
    const seqAt0 = ((filming ? filming.from : 0) / (state.view?.sampleRate || 48000)) * timeRatio();
    const blob = await videoExport({
      path: state.selectedFile.path,
      from: filming ? filming.from : 0,
      to: filming ? filming.to : 0,
      repeats,
      tail,
      size,
      fps,
      sequencer: seqInFilm() ? seqRenderForFilm : null,
      seqAt0,
      grain: sourceOn('grain'),
      // The picture's lanes, read by the film at each frame's own time.
      visual: typeof visualLanes !== 'undefined'
        && visualLanes.lanes.some((l) => l.enabled !== false && l.points?.length)
        ? (seconds) => visualFilmFrame(seconds, size.w / size.h) : null,
      // The room as it is posed right now, at the frame being filmed. The
      // camera is the pose; the aspect comes from the canvas, which is why a
      // wide room in a tall frame is a narrower room and not a squashed one.
      // The camera posed for **the shape being filmed**, which is not
      // necessarily the shape on screen. See `roomCameraForAspect`.
      // Which visualiser is being filmed, and what it needs. One place decides
      // it; the export is told rather than working it out again.
      module: visModuleKey(),
      ridge: ridgeSettings(),
      ridgePaint: ridgePaint(),
      room3d: room3dSettings(),
      room3dPaint: ridgePaint(),
      stage: stageSettings(),
      stagePaint: ridgePaint(),
      // The card of type, in front of it all. Handed over already resolved, the
      // same way the palette is: the film has no page to read colours from.
      text: roomTextSettings(),
      textPaint: roomTextPaint(),
      camera: roomCameraForAspect(size.w / size.h),
      // The ground grid is furniture for posing: it says where the ground is
      // while you stand in the world. A film is the sound, not the stage, so
      // the grid — and with it the horizon it draws — stays out of it.
      layers: { ...roomLayers(), grid: false },
      occlude: roomOcclude(),
      order: roomOrder(),
      // **A copy, taken now.** The film draws its frames over the minutes an
      // encode takes, and it reads these settings on every frame. Handed the
      // live objects — the path was the very array the beads write into — a
      // waypoint added or moved while encoding was drawn into the film at
      // the moment it happened, which looked like a recording being played
      // back. The film is the room as posed when Export was pressed; what is
      // done to the room afterwards stays out of it.
      room: structuredClone({
        cold: vgRgb('--wave-2', '#4a9fd8'),
        hot: vgRgb('--wave', '#5fd47a'),
        core: vgRgb('--accent', '#7fd0ff'),
        // The same palette the live room is drawn with. Handed over rather than
        // rebuilt: the film and the room disagreeing about a colour is the
        // fault this program has already shipped once, over the background.
        paint: rpForRenderer(),
        geom: roomGeom(),
        ringDrive: roomEdit.ringDrive,
        ringEdge: roomEdit.ringEdge,
        ringPoints: roomEdit.ringPoints,
        solidShape: roomEdit.solidShape,
        solidSpin: roomEdit.solidSpin,
        solidSwell: roomEdit.solidSwell,
        solidEye: roomEdit.solidEye,
        solidSize: roomEdit.solidSize,
        solidPath: roomEdit.solidPath,
        leadThick: roomEdit.leadThick,
        grainDensity: roomEdit.grainDensity,
        grainBright: roomEdit.grainBright,
        grainFill: {
          on: roomEdit.grainFill,
          bg: roomEdit.grainFillBg,
          rgb: vgHexRgb(roomEdit.grainFillColour),
        },
        mist: {
          on: roomEdit.mist,
          amount: roomEdit.mistAmount,
          length: roomEdit.mistLength,
        },
        fog: roomFog(),
      }),
      // What the room is drawn *on*. It clears to transparent and the page
      // shows through, so an offscreen canvas has nothing behind it at all.
      // ── the schedule printed on the back wall ──
      //
      // The live block is HTML *behind* the canvas — the room is drawn on glass
      // over it — so filming only the canvas left it out of the file entirely.
      // A layer you can switch on in the view was simply absent from the export.
      //
      // What crosses over is the settings; the lines themselves are built per
      // frame by `roomDataBlock`, the same function the live block uses, from
      // that frame's own schedule.
      data: {
        on: roomLayerOn('data'),
        chunk: roomEdit.chunk,
        opacity: roomEdit.opacity,
        colour: roomDataColour(),
        // No engine offline, so no load and no drop count — those are
        // properties of playback rather than of the sound. See `roomDataHead`.
        head: roomDataHead(false),
        ch: roomChPx($('roomData')),
        line: ROOM_LINE,
        font: getComputedStyle(document.documentElement)
          .getPropertyValue('--mono').trim() || 'monospace',
        fontPx: 7,
        // **How much bigger the film is than the room on screen.**
        //
        // The type does not scale with the *room* — small type printed on a
        // wall does not grow because the wall is big, which is why the live
        // block is a fixed 7px however the panel is sized. But a film is the
        // same composition at a different resolution, and 7px in a 1080-tall
        // frame is half the size it is in a 762-tall panel. Scaling by the
        // frame's height is what makes the film look like the view rather than
        // like the view with the readout shrunk.
        scale: ($('visGl')?.clientHeight || size.h) > 0
          ? size.h / ($('visGl').clientHeight || size.h) : 1,
      },
      // **The ground, from one place.** The live room sits on `--sink` (the
      // room cell's own background) and this used to read `--bg`, which is a
      // different token and a visibly different black — so the file came out on
      // a lighter ground than the thing that had been posed. Both now ask the
      // palette, and the palette falls back to the cell's own colour.
      background: roomGroundColour(),
      fetchSchedule: grainsAt,
      // The same few seconds either side the live room asks for.
      padSeconds: GRAIN_PLAYHEAD_PAD,
      loopOut,
      signal: ctrl.signal,
      onStage: say,
    });
    const name = (state.selectedFile.name || 'room').replace(/\.[^.]+$/, '');
    const filmName = `${name} — room ${size.w}x${size.h} ${fps}fps.mp4`;
    if (save) {
      // Handed to whoever asked for the film — the Compose export saves it
      // beside the sound, on the server, rather than as a download.
      const where = await save(blob, filmName);
      $('elStatus').textContent = `saved · ${(blob.size / 1e6).toFixed(1)} MB`;
      return where || true;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filmName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    $('elStatus').textContent = `saved · ${(blob.size / 1e6).toFixed(1)} MB`;
    toast('video saved');
  } catch (e) {
    if (String(e.message) === 'cancelled') {
      $('elStatus').textContent = 'stopped';
    } else {
      $('elStatus').textContent = `failed — ${e.message}`;
      toast('video export failed: ' + e.message);
    }
  } finally {
    videoRun = null;
    $('elVideo').textContent = 'Export video';
    $('exportProgress').classList.add('hidden');
  }
}

$('elVideo').onclick = () => {
  if (videoRun) { videoRun.abort(); postJSON('/api/video/stop', {}).catch(() => {}); return; }
  runVideoExport();
};
$('elGo').onclick = () => {
  const range = exportRange;
  const repeats = Math.max(1, Math.min(512, +$('elRepeats').value || 1));
  const tail = $('elTail').classList.contains('on');
  closeExportLoop();
  runExport(range, repeats, tail);
};

// -------------------------------------------------------------- effects dock

document.querySelectorAll('.dock-tab').forEach((t) => {
  t.onclick = () => {
    // `.active` for the eye, `aria-selected` for anything else reading the page
    // (C5, `docs/DESIGN-CRITIQUE.md`). Moved together, in one place.
    document.querySelectorAll('.dock-tab').forEach((x) => {
      x.classList.toggle('active', x === t);
      x.setAttribute('aria-selected', String(x === t));
    });
    const panes = { effects: 'dockEffects', prism: 'dockPrism', stretch: 'dockStretch',
                    visuals: 'dockVisuals', automation: 'dockAutomation',
                    regions: 'dockRegions', chop: 'dockChop' };
    for (const [k, id] of Object.entries(panes)) $(id).classList.toggle('hidden', k !== t.dataset.dock);
    $('presetBar').dataset.tab = t.dataset.dock;
    // Everything in these panels is skipped while its panel is hidden, so a
    // panel being opened is showing whatever was on it when it was last
    // closed. Paint it once here; the polls take it from there.
    if (t.dataset.dock === 'effects') {
      paintRackMeters(engine.rackLevels || []);
      repaintVisualEqs();
      repaintVisualCompressors();
    } else if (t.dataset.dock === 'chop') {
      chopSelected(state.selectedFile);
      chopDraw();
    } else if (t.dataset.dock === 'stretch') {
      drawGrains();
    } else if (t.dataset.dock === 'prism') {
      prismPadOpen();
    } else if (t.dataset.dock === 'automation') {
      // Drawn while hidden, the timeline took the canvas's default 300 px as
      // its width and the page stretched it across the dock — every word in it
      // three times as wide (C8).
      perfDrawTimeline();
    }
  };
});

// ------------------------------------------------------------- dock height
//
// The panel holds more controls than a fixed height can show, and scrolling a
// wall of sliders means losing sight of the ones you are not touching. So it
// is dragged from its top edge, and remembered.
//
// Set as `flex` rather than a height because the stylesheet sizes it with the
// `flex` shorthand — which writes flex-basis too, so setting basis alone would
// be overruled by it on the next class change.

const DOCK_MIN = 150;
/// Leave enough of the waveform to still be a waveform.
const LANE_MIN = 170;

function dockLimits() {
  const dock = $('dock');
  const top = dock?.parentElement?.getBoundingClientRect().top ?? 0;
  return { min: DOCK_MIN, max: Math.max(DOCK_MIN, window.innerHeight - top - LANE_MIN) };
}

/// The height you chose — dragged, or the stylesheet's — which the tray's fit
/// (`gkFit`) grows from and never goes under. Null until first measured.
let dockBase = null;

function setDockHeight(px, remember = true) {
  const dock = $('dock');
  if (!dock) return;
  const { min, max } = dockLimits();
  const h = Math.round(Math.max(min, Math.min(max, px)));
  dock.style.flex = `0 0 ${h}px`;
  if (remember) {
    dockBase = h;
    try { localStorage.setItem('dockHeight', String(h)); } catch { /* private mode */ }
  }
  // The canvases in here size themselves from their box, and their observers
  // only fire once the layout has settled.
  requestAnimationFrame(() => {
    drawGrains();
    drawWave();
  });
}

/// Back to whatever the stylesheet says, by dropping the override.
function resetDockHeight() {
  const dock = $('dock');
  if (!dock) return;
  dock.style.flex = '';
  dockBase = Math.round(dock.getBoundingClientRect().height);
  try { localStorage.removeItem('dockHeight'); } catch { /* private mode */ }
  requestAnimationFrame(() => { drawGrains(); drawWave(); });
}

(() => {
  const grip = $('dockResize');
  const dock = $('dock');
  if (!grip || !dock) return;

  const stored = (() => {
    try { return parseInt(localStorage.getItem('dockHeight') || '', 10); }
    catch { return NaN; }
  })();
  if (Number.isFinite(stored)) setDockHeight(stored, false);
  dockBase = Number.isFinite(stored) ? Math.round(dock.getBoundingClientRect().height) : null;

  let from = null;
  grip.onpointerdown = (e) => {
    from = { y: e.clientY, h: dock.getBoundingClientRect().height };
    document.body.classList.add('dock-sizing');
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  grip.onpointermove = (e) => {
    if (!from) return;
    // Upward is taller: the panel grows into the space above it.
    setDockHeight(from.h + (from.y - e.clientY));
  };
  const done = (e) => {
    if (!from) return;
    from = null;
    document.body.classList.remove('dock-sizing');
    try { grip.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
  };
  grip.onpointerup = done;
  grip.onpointercancel = done;
  grip.ondblclick = resetDockHeight;

  // A window that has shrunk can leave the dock taller than there is room for.
  window.addEventListener('resize', () => {
    const now = dock.getBoundingClientRect().height;
    const { min, max } = dockLimits();
    if (now > max || now < min) setDockHeight(now);
  });
})();

