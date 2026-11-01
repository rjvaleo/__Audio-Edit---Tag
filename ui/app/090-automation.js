// ----------------------------------------------------------- automation
//
// A lane is a curve over the document's timeline, stored as unit values. The
// range belongs to the effect, so this side never converts to hertz or dB and
// never needs to know a control's limits — which is the only reason the picture
// and the sound cannot drift apart.
//
// **`saveAutomation` deliberately does not adopt the server's reply.** It used
// to: `state.automation = await postJSON(…)`. That swapped the whole object,
// and every handler `renderAutomation` had wired closes over the lane it was
// built with — so after the first save those handlers were mutating orphans.
// The first edit after a render stuck and every one after it was silently
// discarded: the target menu would read "Pitch" while the lane, and the engine,
// stayed on "Stretch". Nothing in the reply is worth that.

state.automation = { lanes: [], bypassed: false, targets: [] };

let automationTimer = null;
let automationUndo = [];
let automationRedo = [];

const newLaneId = () => `lane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/// Arm the recorder.
///
/// The server does the writing, not this file. It is the only side that knows
/// how a control's real value becomes a lane value — that mapping is searched
/// rather than inverted, and having a second copy of it here is exactly how
/// a recorded take would come to sit somewhere other than where the control
/// was. See `automation::unit_for`.
async function setAutomationRecord(mode) {
  try {
    await postJSON('/api/automation/record', { mode });
  } catch (e) {
    toast('Recording could not be armed: ' + e.message);
    return;
  }
  showAutomationRecord(mode);
}

/// The page's side of the record mode: the state, the control, and the poll
/// that keeps the lanes fresh while a take is landing.
function showAutomationRecord(mode) {
  state.automationRecord = mode;
  const el = $('automationRecord');
  if (el) el.value = mode;
  // A take lands on the server, so the lanes here are behind until refetched.
  // While armed, keep them fresh so the curve appears as it is drawn.
  clearInterval(recordPoll);
  recordPoll = null;
  if (mode !== 'off') {
    recordPoll = setInterval(async () => {
      if (!engine.playing) return;
      await loadAutomation();
      renderAutomation();
    }, 400);
  }
}

/// **The record mode is the server's, and the page has to ask.** It lives in
/// the server's memory, so a reload does not clear it — but a reloaded page
/// used to come up saying Off whatever the server was doing. Arm, reload, and
/// every control moved on every file from then on was quietly written into a
/// lane, until the server itself was restarted. Now the page asks on the way
/// in, shows what it is told, and says so when it was left armed.
async function syncAutomationRecord() {
  let mode = 'off';
  try { mode = (await api('/api/automation/record')).mode || 'off'; } catch { return; }
  if (mode === (state.automationRecord || 'off')) return;
  showAutomationRecord(mode);
  if (mode !== 'off') {
    perfSetStatus('RECORDING WAS LEFT ARMED — EVERY MOVE IS BEING RECORDED · SET RECORD TO OFF TO STOP');
  }
}

// Leaving the page disarms it. A recording is something you are doing, and
// you are not doing it once the page is gone. A beacon, because an ordinary
// request from a page that is closing is dropped.
window.addEventListener('pagehide', () => {
  if ((state.automationRecord || 'off') === 'off') return;
  try {
    navigator.sendBeacon('/api/automation/record',
      new Blob([JSON.stringify({ mode: 'off' })], { type: 'application/json' }));
  } catch {}
});
let recordPoll = null;

/// What undo keeps: the grain's lanes and the picture's, since one editor edits
/// both.
function automationSnapshot() {
  return JSON.stringify({
    lanes: state.automation.lanes,
    bypassed: state.automation.bypassed,
    visual: typeof visualLanes !== 'undefined' ? visualLanes.lanes : undefined,
    // And the take's, which the same editor edits too.
    seq: seq.take ? seq.take.lanes : undefined,
  });
}

function automationRestore(text) {
  const v = JSON.parse(text);
  state.automation.lanes = v.lanes || [];
  state.automation.bypassed = !!v.bypassed;
  if (Array.isArray(v.visual) && typeof visualLanes !== 'undefined') {
    visualLanes.lanes = v.visual;
    saveVisualLanes();
  }
  // The take's lanes, sent back whole — only when they differ, since every
  // undo of a grain edit carries them too.
  if (Array.isArray(v.seq) && seq.take && JSON.stringify(v.seq) !== JSON.stringify(seq.take.lanes || [])) {
    seqPost({ type: 'seq:take-edit', lanes: v.seq.map((l) => ({ id: l.id, points: l.points })) });
    seq.take.lanes = v.seq;
  }
}

function automationCheckpoint() {
  automationUndo.push(automationSnapshot());
  if (automationUndo.length > 100) automationUndo.shift();
  automationRedo = [];
}

async function loadAutomation() {
  if (!state.selectedFile) return;
  try {
    state.automation = await api(`/api/automation?p=${encodeURIComponent(state.selectedFile.path)}`);
  } catch {
    state.automation = { lanes: [], bypassed: false, targets: [] };
  }
  automationUndo = [];
  automationRedo = [];
  renderAutomation();
}

function saveAutomation() {
  // The timeline keeps sampled curves; an edit makes them stale.
  if (typeof perfBumpLanes === 'function') perfBumpLanes();
  clearTimeout(automationTimer);
  automationTimer = setTimeout(async () => {
    if (!state.selectedFile) return;
    try {
      await postJSON('/api/automation', {
        p: state.selectedFile.path,
        lanes: state.automation.lanes,
        bypassed: state.automation.bypassed,
      });
    } catch (e) {
      toast('Automation could not be saved: ' + e.message);
    }
  }, 120);
}

/// What the menu offers, straight from the server.
///
/// Not assembled here from `state.rack`: the list the menu shows and the list
/// playback can resolve have to be the same list, and there is only one of them.
const automationTargets = () => state.automation.targets || [];

/// Re-read the menu after the rack changes, without disturbing the lanes.
///
/// Only `targets` is taken from the reply. Adopting the whole response would
/// throw away edits made since the last save, and would re-orphan every handler
/// `renderAutomation` has wired — the bug this file is careful about.
async function refreshAutomationTargets() {
  if (!state.selectedFile) return;
  try {
    const r = await api(`/api/automation?p=${encodeURIComponent(state.selectedFile.path)}`);
    state.automation.targets = r.targets || [];
    renderAutomation();
  } catch { /* the menu is stale until the next open; the lanes are unharmed */ }
}

function automationNote() {
  const el = $('automationNote');
  if (!el) return;
  const lanes = state.automation.lanes || [];
  const live = lanes.filter((l) => l.enabled !== false && (l.points || []).length).length;
  if (state.automation.stale) {
    el.textContent = 'the file changed — the old lanes were dropped';
  } else if (state.automation.bypassed && lanes.length) {
    el.textContent = 'bypassed';
  } else {
    el.textContent = lanes.length ? `${live} live` : 'no lanes yet';
  }
}

function renderAutomation() {
  const box = $('automationLanes');
  if (!box) return;
  loadLaneWave();
  $('automationBypass').checked = !!state.automation.bypassed;
  box.innerHTML = '';
  const targets = automationTargets();

  // The take, in the sequencer's own panel: `perf-panel.js` draws every lane
  // on the one timeline above; this builds the editor for the lane that is
  // open, chosen on the timeline or in the lanes menu.
  // A sequencer lane opens here too. Its points are the take's, edited in the
  // same editor and sent back to the take — see `seqLaneSave`. One the take no
  // longer has says so rather than opening something else.
  const seqLane = String(state.automationSel || '').startsWith('seq:') ? seqEditLane(state.automationSel) : null;
  if (String(state.automationSel || '').startsWith('seq:') && !seqLane) {
    const note = document.createElement('div');
    note.className = 'perf-seq-note';
    note.textContent = 'THAT SEQUENCER LANE IS GONE — PICK ANOTHER';
    box.appendChild(note);
    automationNote();
    perfFillLaneSelect();
    perfUpdateHeader();
    perfDrawTimeline();
    return;
  }
  // The picture's lanes open in the same editor, and save to their own store.
  const visualPool = typeof visualLanes !== 'undefined' ? visualLanes.lanes : [];
  const lanes = state.automation.lanes || [];
  const chosen = seqLane
    || lanes.find((l) => l.id === state.automationSel)
    || visualPool.find((l) => l.id === state.automationSel)
    || lanes[0] || null;
  const visualLane = !seqLane && !!chosen && String(chosen.id).startsWith('vis:');
  const pool = visualLane ? visualLanes : state.automation;
  const save = seqLane ? () => seqLaneSave(seqLane) : visualLane ? saveVisualLanes : saveAutomation;
  const offered = seqLane ? seqTargetOptions() : visualLane ? visualTargetOptions() : targets;
  state.automationSel = chosen ? chosen.id : null;
  for (const lane of chosen ? [chosen] : []) {
    const row = document.createElement('article');
    row.className = 'automation-lane';
    row.dataset.lane = lane.id;

    const controls = document.createElement('div');
    controls.className = 'automation-lane-controls';

    const top = document.createElement('div');
    top.className = 'row';
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = lane.enabled !== false;
    on.title = 'Whether this lane is in the signal path';
    on.onchange = () => { automationCheckpoint(); lane.enabled = on.checked; save(); automationNote(); };
    // A take has no switch per lane: it plays what it has.
    if (seqLane) on.style.display = 'none';

    const pick = document.createElement('select');
    pick.title = 'Which control this lane moves';
    for (const [value, label] of offered) {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      pick.appendChild(o);
    }
    // A lane naming something that no longer exists keeps its curve and says
    // so, rather than being silently repointed at whatever is first in the list.
    if (!offered.some(([v]) => v === lane.target)) {
      const o = document.createElement('option');
      o.value = lane.target; o.textContent = `Missing — ${lane.target}`;
      pick.appendChild(o);
    }
    pick.value = lane.target;
    pick.onchange = () => {
      automationCheckpoint();
      // A sequencer lane moved onto another control takes its moves with it.
      if (seqLane) {
        const to = pick.value.replace(/^seq\./, '');
        seqLaneSave(lane, to);
        state.automationSel = `seq:${to}`;
        renderAutomation();
        return;
      }
      lane.target = pick.value;
      lane.label = pick.selectedOptions[0]?.textContent || pick.value;
      save();
      automationNote();
    };

    const del = document.createElement('button');
    del.className = 'ghost danger';
    del.textContent = '×';
    del.title = 'Delete this lane';
    del.onclick = () => {
      automationCheckpoint();
      if (seqLane) {
        seqLaneSave({ ...lane, points: [] });
        state.automationSel = null;
        renderAutomation();
        return;
      }
      pool.lanes = pool.lanes.filter((x) => x !== lane);
      save();
      renderAutomation();
    };
    top.append(on, pick, del);
    controls.appendChild(top);

    const tools = document.createElement('div');
    tools.className = 'row';
    const curve = document.createElement('select');
    curve.title = 'How the curve travels between breakpoints';
    for (const c of ['step', 'linear', 'smooth', 'exponential', 'bezier']) {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      curve.appendChild(o);
    }
    curve.value = lane.points?.[0]?.curve || 'linear';
    curve.onchange = () => {
      automationCheckpoint();
      for (const p of lane.points || []) p.curve = curve.value;
      save();
      drawLane(canvas, lane);
    };
    tools.appendChild(curve);
    // A take moves in straight lines between its points, so that is the one
    // curve a sequencer lane has.
    if (seqLane) {
      curve.value = 'linear';
      curve.disabled = true;
      curve.title = 'A take moves in straight lines between its points';
    }
    controls.appendChild(tools);

    const canvas = document.createElement('canvas');
    canvas.className = 'automation-canvas';
    wireLane(canvas, lane);

    row.append(controls, canvas);
    box.appendChild(row);
    drawLane(canvas, lane);
  }
  automationNote();
  perfFillLaneSelect();
  perfUpdateHeader();
  perfDrawTimeline();
}

/// The lanes menu on the performance row, and the lane it stands on.
function perfFillLaneSelect() {
  const sel = $('perfLaneSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— lanes —';
  sel.appendChild(blank);
  // Grouped once the sequencer has lanes too, the way the timeline groups them.
  const seqLanes = perfSeqLanes();
  const visLanes = perfVisualLanes();
  let grainHost = sel;
  if (seqLanes.length || visLanes.length) {
    grainHost = document.createElement('optgroup');
    grainHost.label = 'GRAIN';
    sel.appendChild(grainHost);
  }
  for (const l of state.automation.lanes || []) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = perfLaneLabel(l);
    grainHost.appendChild(o);
  }
  if (seqLanes.length) {
    const g = document.createElement('optgroup');
    g.label = 'SEQ';
    for (const l of seqLanes) {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = l.label;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  if (visLanes.length) {
    const g = document.createElement('optgroup');
    g.label = 'VISUAL';
    for (const l of visLanes) {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = typeof visualLaneShort === 'function' ? visualLaneShort(l) : l.label;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  sel.value = state.automationSel || '';
}

/// The document's length, which is what a lane's frames are measured against.
const laneFrames = () => state.edit?.frames || state.view?.frames || 1;

function snapLaneFrame(frame, frames = laneFrames()) {
  const candidates = [];
  if (state.sel) candidates.push(state.sel.start, state.sel.end);
  for (const m of state.annotations?.markers || []) candidates.push(m.frame);
  for (const r of state.annotations?.regions || []) candidates.push(r.start, r.end);
  let best = frame;
  let near = frames * 0.006;
  for (const x of candidates) {
    if (Math.abs(x - frame) < near) { best = x; near = Math.abs(x - frame); }
  }
  return Math.round(Math.max(0, Math.min(frames, best)));
}

// ── the sequencer's lanes, edited here ──
//
// A sequencer lane is its take's: `seq.take` holds the lanes as the bridge sent
// them, points of `[output seconds, 0..1]`. One opens in the same editor as the
// grain's and the picture's, in their shape, and every edit goes back to the
// take as `seq:take-edit`, where the bridge makes it the control's gesture again
// (`takeEdit` in `ui/sequencer/bridge.js`) and the take sends itself back.

/// A sequencer lane in the editor's shape: points in output frames at the
/// file's rate, joined by straight lines, which is how a take plays them.
function seqEditLane(id) {
  const l = perfSeqLanes().find((x) => x.id === id);
  if (!l) return null;
  const sr = perfRate();
  return {
    id: l.id, target: l.target, label: l.label, enabled: true, seq: true,
    points: (l.points || []).map(([t, v]) => ({ frame: Math.round(t * sr), value: v, curve: 'linear', tension: 0 })),
  };
}

/// The controls a sequencer lane can move, as the take names them.
function seqTargetOptions() {
  return (seq.take?.controls || []).map(([id, label]) => [`seq.${id}`, label]);
}

/// Send a sequencer lane back to its take — onto another control when `to`
/// names one, and removed when it has no points. Drawn here at once, rather
/// than when the take comes back a moment later.
function seqLaneSave(lane, to) {
  const sr = perfRate();
  const from = String(lane.id).replace(/^seq:/, '');
  const onto = to || from;
  const points = (lane.points || []).slice().sort((a, b) => a.frame - b.frame).map((p) => [p.frame / sr, p.value]);
  seqPost({ type: 'seq:take-edit', id: from, to: onto, points });
  const take = seq.take;
  if (!take) return;
  const list = take.lanes || [];
  const at = list.findIndex((l) => l.id === `seq:${from}`);
  const rest = list.filter((l) => l.id !== `seq:${from}` && l.id !== `seq:${onto}`);
  if (points.length) {
    const label = (take.controls || []).find(([id]) => id === onto)?.[1] || onto;
    rest.splice(at < 0 ? rest.length : Math.min(at, rest.length), 0,
      { id: `seq:${onto}`, target: `seq.${onto}`, label, color: perfSeqColor(onto), points });
  }
  take.lanes = rest;
  perfFillLaneSelect();
  perfUpdateHeader();
  perfDrawTimeline();
}

/// How many frames a lane's editor spans: the document, or — for a sequencer
/// lane — the take as well, which can run past the document's end, as the
/// timeline above already allows.
function laneSpanFrames(lane) {
  const frames = laneFrames();
  if (!lane?.seq || !seq.take) return frames;
  const end = ((+seq.take.startAt || 0) + (+seq.take.duration || 0)) * perfRate();
  return Math.max(frames, Math.ceil(end));
}

/// A lane is saved to the store it came from: the sequencer's to its take, the
/// picture's to their own store per document, the grain's to the server's
/// automation.
function laneSave(lane) {
  if (String(lane?.id || '').startsWith('seq:')) seqLaneSave(lane);
  else if (String(lane?.id || '').startsWith('vis:') && typeof saveVisualLanes === 'function') saveVisualLanes();
  else saveAutomation();
}

function wireLane(canvas, lane) {
  let drag = null;
  const nearest = (e) => {
    const r = canvas.getBoundingClientRect();
    const frames = laneSpanFrames(lane);
    let best = null;
    let d = 12;
    for (const p of lane.points || []) {
      const n = Math.hypot(
        e.clientX - r.left - (p.frame / frames) * r.width,
        e.clientY - r.top - (1 - p.value) * r.height,
      );
      if (n < d) { best = p; d = n; }
    }
    return best;
  };

  canvas.onpointerdown = (e) => {
    automationCheckpoint();
    canvas.setPointerCapture(e.pointerId);
    lane.points ||= [];
    drag = nearest(e);
    if (!drag) {
      drag = { frame: 0, value: 0, curve: 'linear', tension: 0 };
      lane.points.push(drag);
    }
    canvas.onpointermove(e);
  };

  canvas.onpointermove = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!drag) {
      const p = nearest(e);
      const sr = state.view?.sampleRate || 44100;
      canvas.title = p
        ? `${fmtTime(p.frame / sr)} · ${Math.round(p.value * 100)}% · ${p.curve}`
        : 'Click to add a breakpoint · drag one to move it · double-click to remove';
      return;
    }
    const span = laneSpanFrames(lane);
    drag.frame = snapLaneFrame(((e.clientX - r.left) / r.width) * span, span);
    drag.value = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    lane.points.sort((a, b) => a.frame - b.frame);
    drawLane(canvas, lane);
  };

  canvas.onpointerup = () => {
    if (!drag) return;
    drag = null;
    // Deliberately not simplified here. A release used to run the simplifier,
    // which reduces a smooth drag to its two end points — so the breakpoints
    // you had just drawn vanished the instant you let go. Simplify is a button.
    laneSave(lane);
    automationNote();
  };

  canvas.ondblclick = (e) => {
    const p = nearest(e);
    if (!p) return;
    automationCheckpoint();
    lane.points = lane.points.filter((x) => x !== p);
    laneSave(lane);
    drawLane(canvas, lane);
  };
}

const curveT = (t, p) => {
  if (p.curve === 'step') return 0;
  if (p.curve === 'smooth') return t * t * (3 - 2 * t);
  if (p.curve === 'exponential') return Math.pow(t, Math.pow(2, Math.max(-2, Math.min(2, p.tension || 0))));
  if (p.curve === 'bezier') {
    const k = Math.max(0.05, Math.min(0.95, 0.5 + Math.max(-1, Math.min(1, p.tension || 0)) * 0.45));
    return t < k ? 0.5 * Math.pow(t / k, 2) : 1 - 0.5 * Math.pow((1 - t) / (1 - k), 2);
  }
  return t;
};

/// Fetch the whole-file envelope the lanes are drawn over.
///
/// Once per file, at a fixed column count — the lanes never zoom, so there is
/// nothing to refetch for. Failure is silent: a lane with no picture behind it
/// is the lane as it was, and a toast for a decoration would be noise.
const LANE_WAVE_COLUMNS = 900;
let laneWaveFor = null;
async function loadLaneWave() {
  const f = state.selectedFile;
  if (!f) { state.laneWave = null; laneWaveFor = null; return; }
  if (laneWaveFor === f.path) return;
  laneWaveFor = f.path;
  try {
    const w = await api(`/api/peaks?p=${encodeURIComponent(f.path)}&cols=${LANE_WAVE_COLUMNS}`);
    // The file may have been changed out during the await.
    if (laneWaveFor !== f.path) return;
    state.laneWave = w;
  } catch { state.laneWave = null; }
  repaintAutomationLanes();
}

/// The sound itself, behind the curve.
///
/// Breakpoints are placed against what is being heard, and doing that from a
/// clock reading alone means counting seconds against a waveform in another
/// part of the window. Drawn dim and mono — it is a reference, and it must not
/// compete with the line the lane is actually for.
function drawLaneWave(c, w, h, frames) {
  const p = state.laneWave;
  if (!p || !p.channels?.length) return;
  const cols = p.channels[0].max?.length || 0;
  if (!cols) return;

  // Drawn across the whole lane rather than at the source's own scale. The lane
  // counts output frames, and the output *is* the source spread over them — at
  // eight times, a source-scaled envelope would huddle into the first eighth of
  // a lane whose audio runs the full width.
  //
  // The alternative was to ask the server for the edited timeline, which is
  // exact. It also renders the whole stretched document through the rack — four
  // minutes of audio for a thirty-second file at eight times — and would go
  // stale on every move of the ratio. This is cheap, never stale, and right for
  // everything except a document with material cut out of it.
  const mid = h / 2;
  const half = h / 2 * 0.86;

  // This is audio, so it takes `--wave` like every other waveform in the
  // program. It was a hardcoded blue, which is why it stayed blue when the
  // waveform colour changed and the lanes did not.
  c.fillStyle = waveInk();
  withAlpha(c, 0.13, () => {
    c.beginPath();
    c.moveTo(0, mid);
    for (let i = 0; i < cols; i++) {
      let hi = 0;
      for (const ch of p.channels) hi = Math.max(hi, Math.abs(ch.max[i]), Math.abs(ch.min[i]));
      c.lineTo((i / (cols - 1)) * w, mid - hi * half);
    }
    for (let i = cols - 1; i >= 0; i--) {
      let hi = 0;
      for (const ch of p.channels) hi = Math.max(hi, Math.abs(ch.max[i]), Math.abs(ch.min[i]));
      c.lineTo((i / (cols - 1)) * w, mid + hi * half);
    }
    c.closePath();
    c.fill();
  });
}

function drawLane(canvas, lane) {
  // At the screen's own resolution. It was a fixed 1200 by 110 stretched to
  // whatever width the tab had, which is what made it soft.
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 1200;
  const h = 110;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const frames = laneSpanFrames(lane);
  const sr = state.view?.sampleRate || 44100;
  c.clearRect(0, 0, w, h);

  // The sound across its own length, which is the whole lane unless a take
  // runs past its end.
  drawLaneWave(c, (laneFrames() / frames) * w, h, frames);

  c.strokeStyle = '#1e2830';
  c.fillStyle = '#4a6070';
  c.font = '9px "Share Tech Mono", monospace';
  for (let i = 0; i <= 8; i++) {
    const x = (i * w) / 8;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
    if (i < 8) c.fillText(fmtTime((frames * i) / 8 / sr), x + 3, 10);
  }
  for (const m of state.annotations?.markers || []) {
    const x = (m.frame / frames) * w;
    c.strokeStyle = 'rgba(244,190,73,.45)';
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }

  const p = (lane.points || []).slice().sort((a, b) => a.frame - b.frame);
  // Bypass stops the grain's lanes and the picture's; a take plays regardless.
  const dim = lane.enabled === false || (!lane.seq && state.automation.bypassed);
  // The lane's own colour, the one the timeline above draws it in.
  c.strokeStyle = dim ? '#3d5162' : perfLaneColor(lane.target);
  c.fillStyle = c.strokeStyle;
  c.lineWidth = 2;

  if (p.length) {
    c.beginPath();
    // A lane holds its end values, so the line is drawn flat out to both edges
    // rather than stopping where the drawing stopped. The curve goes on meaning
    // something past its last breakpoint, and it should look like it.
    c.moveTo(0, (1 - p[0].value) * h);
    c.lineTo((p[0].frame / frames) * w, (1 - p[0].value) * h);
    for (let i = 0; i < p.length - 1; i++) {
      for (let n = 1; n <= 24; n++) {
        const t = n / 24;
        const k = curveT(t, p[i]);
        c.lineTo(
          ((p[i].frame + (p[i + 1].frame - p[i].frame) * t) / frames) * w,
          (1 - (p[i].value + (p[i + 1].value - p[i].value) * k)) * h,
        );
      }
    }
    const last = p[p.length - 1];
    c.lineTo((last.frame / frames) * w, (1 - last.value) * h);
    c.lineTo(w, (1 - last.value) * h);
    c.stroke();

    for (const [i, v] of p.entries()) {
      const x = (v.frame / frames) * w;
      const y = (1 - v.value) * h;
      c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0a0c0e';
      c.font = 'bold 8px "Share Tech Mono", monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(i + 1), x, y);
      c.fillStyle = c.strokeStyle;
      c.textAlign = 'start';
      c.textBaseline = 'alphabetic';
    }
  }

  if (engine.playing) {
    const x = (sourceFrameNow() / frames) * w;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
}

function repaintAutomationLanes() {
  perfDrawTimeline();
  for (const row of document.querySelectorAll('.automation-lane')) {
    const lane = (state.automation.lanes || []).find((l) => l.id === row.dataset.lane);
    const canvas = row.querySelector('.automation-canvas');
    if (lane && canvas) drawLane(canvas, lane);
  }
}

/// Drop breakpoints the curve does not need, within `tol` of full scale.
function simplifyLane(lane, tol = 0.012) {
  const p = lane.points || [];
  if (p.length < 3) return;
  const keep = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = keep[keep.length - 1];
    const b = p[i + 1];
    const x = (p[i].frame - a.frame) / Math.max(1, b.frame - a.frame);
    if (Math.abs(p[i].value - (a.value + (b.value - a.value) * x)) > tol) keep.push(p[i]);
  }
  keep.push(p[p.length - 1]);
  lane.points = keep;
}

$('automationAdd').onclick = () => {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  // With a sequencer lane open, the new lane is the sequencer's: the first of
  // its controls with none, flat where the take found it, across the take.
  if (String(state.automationSel || '').startsWith('seq:') && seq.take) {
    const used = new Set((seq.take.lanes || []).map((l) => String(l.id).replace(/^seq:/, '')));
    const free = (seq.take.controls || []).find(([id]) => !used.has(id));
    if (!free) { toast('Every sequencer control has a lane already'); return; }
    automationCheckpoint();
    const sr = perfRate();
    const start = +seq.take.startAt || 0;
    const end = start + Math.max(1, +seq.take.duration || 0);
    const v = Number.isFinite(free[2]) ? free[2] : 0.5;
    const added = { id: `seq:${free[0]}`, points: [{ frame: Math.round(start * sr), value: v }, { frame: Math.round(end * sr), value: v }] };
    seqLaneSave(added);
    state.automationSel = added.id;
    renderAutomation();
    return;
  }
  const targets = automationTargets();
  if (!targets.length) { toast('Nothing to automate yet'); return; }
  automationCheckpoint();
  const [target, label] = targets[0];
  const id = newLaneId();
  // The new lane is the one the editor opens on; a lane added and not shown
  // is a lane that appears to have failed to arrive.
  state.automationSel = id;
  state.automation.lanes.push({
    id, target, label, enabled: true, trim: 0, loop: null,
    // Two points, not one: a lane with a single breakpoint is a constant, and
    // looks identical whatever you do to it until you add a second.
    points: [{ frame: 0, value: 0.5, curve: 'linear', tension: 0 },
             { frame: laneFrames(), value: 0.5, curve: 'linear', tension: 0 }],
    modulators: [],
  });
  saveAutomation();
  renderAutomation();
};

$('automationBypass').onchange = (e) => {
  automationCheckpoint();
  state.automation.bypassed = e.target.checked;
  saveAutomation();
  renderAutomation();
};

$('automationRecord').onchange = (e) => setAutomationRecord(e.target.value);
$('automationCapture')?.addEventListener('click', () => {
  // Arm; pressed again while armed, disarm — or, mid-take, end the take by
  // stopping the transport, which is what ends it.
  if (!state.captureArmed) { startCapture(); return; }
  if (engine.playing) pausePlayback(); else endCapture();
});
$('perfPlayBtn')?.addEventListener('click', () => {
  if (!state.selectedFile) { toast('Open a sound first'); return; }
  if (engine.playing) pausePlayback(); else startPlayback();
});
$('perfStopBtn')?.addEventListener('click', () => { pausePlayback(); returnToCue(); updatePlayhead(); });
$('perfLaneSelect')?.addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.automationSel = e.target.value;
  renderAutomation();
});
$('perfLaneDel')?.addEventListener('click', () => {
  if (String(state.automationSel || '').startsWith('seq:')) {
    const slane = seqEditLane(state.automationSel);
    if (!slane) { toast('Pick a lane first'); return; }
    automationCheckpoint();
    seqLaneSave({ ...slane, points: [] });
    state.automationSel = null;
    renderAutomation();
    return;
  }
  if (String(state.automationSel || '').startsWith('vis:') && typeof visualLanes !== 'undefined') {
    const vlane = visualLanes.lanes.find((l) => l.id === state.automationSel);
    if (!vlane) { toast('Pick a lane first'); return; }
    automationCheckpoint();
    visualLanes.lanes = visualLanes.lanes.filter((x) => x !== vlane);
    state.automationSel = null;
    saveVisualLanes();
    renderAutomation();
    return;
  }
  const lane = (state.automation.lanes || []).find((l) => l.id === state.automationSel);
  if (!lane) { toast('Pick a lane first'); return; }
  automationCheckpoint();
  state.automation.lanes = state.automation.lanes.filter((x) => x !== lane);
  state.automationSel = null;
  saveAutomation();
  renderAutomation();
});
$('perfCanvas')?.addEventListener('click', (e) => {
  const hit = perfHitAt(e.currentTarget, e.clientX, e.clientY);
  if (!hit) return;
  // A group's heading folds the group; a lane opens it.
  if (hit.group && !hit.id) { perfToggleGroup(hit.group); return; }
  state.automationSel = hit.id;
  renderAutomation();
});
$('perfHeader')?.addEventListener('click', perfToggleCollapse);
$('perfResize')?.addEventListener('mousedown', perfResizeStart);
$('perfResize')?.addEventListener('dblclick', perfResizeReset);
window.addEventListener('resize', () => { if ($('perfCanvas')) perfDrawTimeline(); });

$('automationSimplify').onclick = () => {
  automationCheckpoint();
  for (const l of state.automation.lanes) simplifyLane(l);
  saveAutomation();
  renderAutomation();
};

$('automationInvert').onclick = () => {
  automationCheckpoint();
  for (const l of state.automation.lanes) for (const p of l.points || []) p.value = 1 - p.value;
  saveAutomation();
  renderAutomation();
};

$('automationLoop').onclick = () => {
  if (!state.sel) { toast('Make a selection first'); return; }
  automationCheckpoint();
  for (const l of state.automation.lanes) l.loop = [state.sel.start, state.sel.end];
  saveAutomation();
  toast('Lanes now loop over the selection');
};

$('automationUndo').onclick = () => {
  const s = automationUndo.pop();
  if (!s) return;
  automationRedo.push(automationSnapshot());
  automationRestore(s);
  saveAutomation();
  renderAutomation();
};

$('automationRedo').onclick = () => {
  const s = automationRedo.pop();
  if (!s) return;
  automationUndo.push(automationSnapshot());
  automationRestore(s);
  saveAutomation();
  renderAutomation();
};

