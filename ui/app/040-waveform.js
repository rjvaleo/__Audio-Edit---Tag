// ────────────────────────────────────────────── the waveform/spectrum split ──
//
// The boundary between the two canvases, dragged. One custom property on the
// lane drives both heights and the handle's position, so there is no arithmetic
// in three places to fall out of step — the same reason the stylesheet owns the
// rest of this geometry and the drawing code does not touch it.

/// Far enough from either end that neither canvas can be dragged to nothing.
/// A pane you can lose by accident and cannot get back is worse than one that
/// stops short. The bounds live in `Settings.SPEC` now and are applied on the
/// way in as well as the way out; these two are kept because the drag handler
/// reads them to decide what a gesture means.
const SPLIT_MIN = 25;
const SPLIT_MAX = 88;

const laneSplit = () => prefs.laneSplit;

function setLaneSplit(pct, { save = true } = {}) {
  // Kept in the browser like the theme: how tall you like the spectrogram is a
  // property of the screen you are looking at, not of the library. The clamp is
  // the store's now, so `v` is read back rather than computed twice.
  const v = save ? setPref('laneSplit', pct) : Settings.SPEC.laneSplit.read(pct);
  const lane = $('lane');
  if (lane) lane.style.setProperty('--split', `${v.toFixed(2)}%`);
  // The canvases are stretched by CSS rather than redrawn, so nothing has to be
  // re-rendered — but the waveform's buffer is positioned in pixels.
  layoutWaveBuffer();
  // Unless it has been placed by hand, the grain centre is the waveform's
  // centre — so it moves when the waveform's share of the lane does.
  placeGrainCentre(grainCentre());
  drawGrainLayer();
}

function wireLaneSplit() {
  const handle = $('laneSplit');
  const lane = $('lane');
  if (!handle || !lane) return;
  setLaneSplit(laneSplit(), { save: false });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing-lane');

    const move = (ev) => {
      const r = lane.getBoundingClientRect();
      if (r.height <= 0) return;
      setLaneSplit(((ev.clientY - r.top) / r.height) * 100, { save: false });
    };
    const up = (ev) => {
      handle.releasePointerCapture(e.pointerId);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-lane');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const r = lane.getBoundingClientRect();
      if (r.height > 0) setLaneSplit(((ev.clientY - r.top) / r.height) * 100);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  // Same gesture as every other control here: double-click is "put it back".
  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    setLaneSplit(SPLIT_DEFAULT);
  });
}

wireLaneSplit();

// ------------------------------------------------- the left panel's width
//
// The library list is the one panel whose right width depends on what is in it
// — long file names, deep folders — so it is the one worth being able to drag.

const LEFT_W_DEFAULT = Settings.SPEC.leftPanelWidth.def;
/// Narrow enough to be a sliver, not so narrow the filter box collapses; wide
/// enough to read a long path, not so wide the editor has nowhere to go.
const LEFT_W_MIN = 200;
const LEFT_W_MAX = 720;

const leftPanelWidth = () => prefs.leftPanelWidth;

function setLeftPanelWidth(px, { save = true, redraw = true } = {}) {
  // Kept in the browser like the lane split and the theme: how wide you like a
  // panel is a property of the screen, not of the library.
  const v = save ? setPref('leftPanelWidth', px) : Settings.SPEC.leftPanelWidth.read(px);
  const panel = $('leftPanel');
  if (panel) panel.style.setProperty('--left-w', `${v}px`);
  // The lane's canvases are sized in pixels off their own width, so the
  // waveform has to be re-placed after the space either side of it changes.
  //
  // Not on the first application. `redrawLane` reads `resizeTimer`, which is a
  // `let` declared further down this file — calling it from top-level setup is
  // inside its temporal dead zone and throws `Cannot access 'resizeTimer'
  // before initialization`. That exception aborted the rest of `wireLeftPanelResize`
  // *after* the width was applied and *before* the listeners were attached, so
  // the grip appeared, took a cursor, and did nothing at all.
  if (redraw) redrawLane();
}

function wireLeftPanelResize() {
  const grip = $('leftGrip');
  const panel = $('leftPanel');
  if (!grip || !panel) return;
  setLeftPanelWidth(leftPanelWidth(), { save: false, redraw: false });

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    document.body.classList.add('resizing-panel');

    // From the panel's own left edge, so the width follows the pointer exactly
    // rather than drifting by wherever inside the grip the drag started.
    const left = panel.getBoundingClientRect().left;
    const move = (ev) => setLeftPanelWidth(ev.clientX - left, { save: false });
    const up = (ev) => {
      grip.releasePointerCapture(e.pointerId);
      grip.classList.remove('dragging');
      document.body.classList.remove('resizing-panel');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setLeftPanelWidth(ev.clientX - left);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  // Same gesture as every other control here: double-click is "put it back".
  grip.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setLeftPanelWidth(LEFT_W_DEFAULT);
  });
}

/// The grain centre grip: same gesture as the lane split, including
/// double-click to put it back.
function wireGrainCentre() {
  const grip = $('grainCentre');
  const lane = $('lane');
  if (!grip || !lane) return;
  placeGrainCentre(grainCentre());

  // The lane starts a selection on `mousedown`, which is a separate event from
  // `pointerdown` — stopping one does not stop the other, and without this a
  // drag on the grip also swept a selection across the file underneath it.
  for (const ev of ['mousedown', 'click', 'dblclick']) {
    grip.addEventListener(ev, (e) => e.stopPropagation());
  }

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');

    const frac = (ev) => {
      const r = lane.getBoundingClientRect();
      return r.height > 0 ? (ev.clientY - r.top) / r.height : null;
    };
    const move = (ev) => {
      const f = frac(ev);
      if (f !== null) setGrainCentre(f, { save: false });
    };
    const up = (ev) => {
      grip.releasePointerCapture(e.pointerId);
      grip.classList.remove('dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      const f = frac(ev);
      setGrainCentre(f === null ? grainCentre() : f);
      setGrainCentre.live = undefined;
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  grip.addEventListener('dblclick', (e) => {
    e.preventDefault();
    setPref('grainCentre', null);
    setGrainCentre.live = undefined;
    placeGrainCentre(grainCentreDefault());
    drawGrainLayer();
  });
}
wireGrainCentre();

/// covered, which may be wider and may be a window behind — the peaks and the
/// spectrogram are separate requests and need not agree. So each is sized and
/// offset from its own range, and the lane, which already clips, hides the
/// rest. Nothing else on the lane needs any part of this.
function layoutWaveBuffer() {
  const span = state.view.to - state.view.from;
  const laneW = $('lane').clientWidth || 0;
  placeCanvas($('waveCanvas'), state.peaks, span, laneW);
  placeCanvas($('specCanvas'), state.spec, span, laneW);
}

function placeCanvas(canvas, data, span, laneW) {
  if (!canvas) return;
  // Nothing to offset: hand the geometry back to the stylesheet rather than
  // pinning a pixel width that a resize would then have to catch up with.
  if (!data || !laneW || span <= 0 || !(data.to > data.from)
      || (data.from === state.view.from && data.to === state.view.to)) {
    canvas.style.width = '';
    canvas.style.transform = '';
    return;
  }
  const px = laneW / span;
  canvas.style.width = `${((data.to - data.from) * px).toFixed(2)}px`;
  canvas.style.transform = `translateX(${((data.from - state.view.from) * px).toFixed(2)}px)`;
}

/// Move the window so the playhead stays on screen. Called every frame while
/// playing; most of those frames it does nothing.
function followPlayhead() {
  if (!following()) return;
  const { from, to, frames } = state.view;
  const span = to - from;
  const f = sourceFrameNow();
  if (!isFinite(f)) return;

  let a;
  if (state.follow.mode === 'page') {
    if (f >= from && f < to) return;
    // Start the new page a little before the playhead, so the moment it is on
    // is not pressed against the very edge of the lane.
    a = f - span * 0.06;
  } else {
    a = f - span / 2;
  }
  a = Math.max(0, Math.min(frames - span, Math.round(a)));

  if (a !== from) {
    state.view.from = a;
    state.view.to = a + span;
    layoutWaveBuffer();
    drawSelection();
    drawCue();
    drawOverviewWindow();
    // Rebuilding the ruler and the region strip every frame is only worth it if
    // there is something in them.
    if (state.annotations.markers.length || state.annotations.regions.length) drawMarkers();
  }

  // Checked even when the window did not move, because it may not have been
  // widened yet: pressing play with the lane already where the playhead is
  // leaves nothing to scroll and a buffer that is only as wide as the lane.
  const p = state.peaks;
  const sh = followShape();
  const needFrom = Math.max(0, a - span * sh.behind * FOLLOW_MARGIN);
  const needTo = Math.min(frames, a + span + span * sh.ahead * FOLLOW_MARGIN);
  if (!p || p.from > needFrom || p.to < needTo) refetchWindow();
}

let refetchTimer = null;
function refetchWindow() {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => {
    refetchTimer = null;
    loadPeaks();
    if (state.showSpec) loadSpectrogram();
  }, 60);
}

function setFollow(change) {
  Object.assign(state.follow, change);
  // Whether you follow, and how, is how you like to watch rather than anything
  // about the sound — so it outlives the session, which it did not before.
  if ('on' in change) setPref('followOn', !!state.follow.on);
  if ('mode' in change) setPref('followMode', state.follow.mode);
  reflectFollow();
  if (state.follow.on) {
    followPlayhead();
  } else {
    // Drop the widened buffer, so the strip goes back to being exactly the lane.
    loadPeaks();
    if (state.showSpec) loadSpectrogram();
  }
}

function reflectFollow() {
  $('followBtn')?.classList.toggle('on', state.follow.on);
  const sel = $('followMode');
  if (sel) { sel.value = state.follow.mode; sel.disabled = !state.follow.on; }
}

$('followBtn').onclick = () => setFollow({ on: !state.follow.on });
$('followMode').onchange = (e) => setFollow({ mode: e.target.value });
state.follow.on = prefs.followOn;
state.follow.mode = prefs.followMode;
reflectFollow();

async function loadPeaks() {
  const f = state.selectedFile;
  if (!f) return;
  const seq = ++peakSeq;
  const lanePx = lanePixels();
  // While following, the window is wider than the lane. Scale the columns with
  // it so the extra picture comes at the same detail rather than a coarser one.
  const win = peakWindow();
  const span = state.view.to - state.view.from;
  const cols = win && span > 0
    ? Math.max(200, Math.min(PEAK_COLUMN_CAP, Math.round(lanePx * ((win.to - win.from) / span))))
    : lanePx;
  // Whether what we are about to fetch covers more than the lane shows. Read
  // now, because in scroll mode the visible window moves during the await.
  const padded = !!win && (win.from !== state.view.from || win.to !== state.view.to);

  // Deliberately NOT the edited stream. The overview is the original file, so
  // it stays put while you work; the grain swarm shows what is being pulled
  // from it, and the playhead shows where in the source you are.
  let url = `/api/peaks?p=${encodeURIComponent(f.path)}&cols=${cols}`;
  if (win) {
    url += `&from=${Math.floor(win.from)}&to=${Math.ceil(win.to)}`;
  }

  let peaks;
  try { peaks = await api(url); }
  catch (e) {
    if (seq === peakSeq) { state.peaks = null; toast(e.message); }
    return;
  }
  // Three quick zoom clicks launch three fetches; without this check the
  // slowest response wins and the view snaps back to an earlier zoom.
  if (seq !== peakSeq) return;

  state.peaks = peaks;
  state.view.frames = peaks.frames;
  state.view.sampleRate = peaks.sampleRate;
  // An unpadded response *is* the visible window, clamping and all, so take it.
  // A padded one covers more than the lane shows, and the visible window stays
  // where following put it.
  if (!padded) { state.view.from = peaks.from; state.view.to = peaks.to; }
  layoutWaveBuffer();
  updateZoomLabel();
  drawWave();
  drawMarkers();
  drawSelection();
  drawCue();
  drawOverviewWindow();
}

function updateZoomLabel() {
  const { from, to, frames } = state.view;
  const span = to - from;
  const el = $('zoomLabel');
  if (!frames || span >= frames) { el.textContent = 'fit'; return; }
  // Say so when every column is one sample, because that is the point at which
  // the picture stops being a summary and starts being the data.
  const cols = Math.round(($('lane').clientWidth || 800) * (window.devicePixelRatio || 1));
  el.textContent = span <= cols
    ? `${span} smp`
    : `${(frames / span).toFixed(1)}×`;
}

/// One sample per column: stems from the zero line, a dot on each sample, and
/// a line joining them.
///
/// `x` is `(i / span) * w` — the same mapping the playhead uses — so a sample
/// and the playhead sitting on that sample land on the same pixel. The dot is
/// the truth here; the joining line is only there to make the shape readable
/// and is deliberately faint, because nothing was measured between two samples.
function drawSamples(ctx, values, span, w, mid, half, accent) {
  const n = Math.min(values.length, span);
  const xAt = (i) => (i / span) * w;
  const yAt = (i) => mid - values[i] * half;
  const gap = w / span;

  // Stems read as a sample view rather than a line chart, but they turn into a
  // solid block once the samples are closer together than a few pixels.
  if (gap >= 4) {
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xAt(i);
      ctx.moveTo(x, mid);
      ctx.lineTo(x, yAt(i));
    }
    ctx.stroke();
  }

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xAt(i);
    const y = yAt(i);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  const r = Math.min(3, Math.max(1, gap / 3));
  if (gap >= 3) {
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(i), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWave() {
  const canvas = $('waveCanvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  // A draw can land while the lane has no box yet — switching modes resizes it,
  // and a tab that is not being painted reports zero for everything. Bail here
  // and let the ResizeObserver below redraw once it genuinely has a size;
  // polling on a timer would spin forever against a hidden tab.
  if (!w || !h) return;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const p = state.peaks;
  $('laneEmpty').classList.toggle('hidden', !!p);
  if (!p || !p.channels.length) return;

  const nch = p.channels.length;
  const laneH = h / nch;
  const accent = waveInk();

  // Zoomed in far enough that the server ran out of frames to summarise: it
  // clamps the column count to the frame count, so every column now holds
  // exactly one sample and min === max. An envelope of a single sample is a
  // zero-height rectangle that says nothing, so switch to drawing the samples
  // themselves — stem, dot and the line between them.
  // The canvas covers the range the *peaks* describe, which while following is
  // wider than the lane, so the span in play here is theirs and not the view's.
  const span = p.to - p.from;
  const sampleMode = span > 0 && p.columns >= span;

  for (let ch = 0; ch < nch; ch++) {
    const { min, max, rms } = p.channels[ch];
    const top = ch * laneH;
    const mid = top + laneH / 2;
    const half = (laneH / 2) * 0.92;
    const colW = w / p.columns;

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

    if (sampleMode) {
      drawSamples(ctx, max, span, w, mid, half, accent);
    } else {
      // Min/max envelope, then the RMS body inside it — the reason the server
      // sends three numbers per column rather than one.
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.34;
      for (let i = 0; i < p.columns; i++) {
        const y1 = mid - max[i] * half;
        const y2 = mid - min[i] * half;
        ctx.fillRect(i * colW, y1, Math.max(colW - 0.3, 0.6), Math.max(y2 - y1, 1));
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < p.columns; i++) {
        const r = rms[i] * half;
        ctx.fillRect(i * colW, mid - r, Math.max(colW - 0.3, 0.6), Math.max(r * 2, 1));
      }
    }

    if (ch > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(w, top); ctx.stroke();
    }
  }
}

// --------------------------------------------------------------------- zoom

function zoom(factor) {
  const { from, to, frames } = state.view;
  if (!frames) return;
  const centre = (from + to) / 2;
  let span = (to - from) / factor;
  // Eight samples across the lane is the floor. Below that there is nothing
  // left to look at, and the peak endpoint would be summarising fewer frames
  // than it has columns to put them in.
  span = Math.max(8, Math.min(span, frames));
  const b = Math.min(frames, Math.round(centre + span / 2));
  const a = Math.max(0, b - Math.round(span));
  state.view.from = a;
  state.view.to = b;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
}
$('zoomIn').onclick = () => zoom(2);
$('zoomOut').onclick = () => zoom(0.5);
$('zoomFit').onclick = () => {
  state.view.from = 0; state.view.to = 0;
  loadPeaks();
  if (state.showSpec) loadSpectrogram();
  grainsFollowView();
};

// ------------------------------------------------------------- overview
//
// The whole file, drawn once, with the zoomed window marked on top. Zooming
// into a long sample otherwise leaves no way to tell where you are or to move
// somewhere else without zooming back out.

state.overview = null;

async function loadOverview() {
  const f = state.selectedFile;
  if (!f) { state.overview = null; drawOverview(); return; }
  try {
    // Deliberately coarse and deliberately the whole file: this is a map, not
    // a working view, and it must never change as you zoom.
    state.overview = await api(
      `/api/peaks?p=${encodeURIComponent(f.path)}&cols=1400`);
  } catch { state.overview = null; }
  drawOverview();
}

function drawOverview() {
  const canvas = $('overviewCanvas');
  if (!canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const p = state.overview;
  if (!p || !p.channels.length) return;

  const accent = waveInk();
  const mid = h / 2;
  const half = mid * 0.9;
  const colW = w / p.columns;
  const { min, max } = p.channels[0];

  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < p.columns; i++) {
    const y1 = mid - max[i] * half;
    const y2 = mid - min[i] * half;
    ctx.fillRect(i * colW, y1, Math.max(colW, 0.7), Math.max(y2 - y1, 1));
  }
  ctx.globalAlpha = 1;

  drawOverviewWindow();
  updateOverviewPlayhead();
  updateOverviewCue();
}

function drawOverviewWindow() {
  const el = $('ovWindow');
  const p = state.overview;
  if (!el || !p) return;
  const total = state.view.frames || p.frames || 0;
  const { from, to } = state.view;
  const zoomed = total > 0 && to > from && (to - from) < total * 0.999;
  el.classList.toggle('full', !zoomed);
  if (!zoomed) return;
  const wpx = $('overview').clientWidth || 1;
  el.style.left = `${(from / total) * wpx}px`;
  el.style.width = `${Math.max(2, ((to - from) / total) * wpx)}px`;
}

/// Drag the overview to move the zoomed window.
(function wireOverview() {
  const ov = $('overview');
  if (!ov) return;
  let panning = false;

  const centreOn = (e) => {
    const p = state.overview;
    if (!p) return;
    const total = state.view.frames || p.frames || 0;
    const span = state.view.to - state.view.from;
    if (!total || span <= 0 || span >= total) return;
    const r = ov.getBoundingClientRect();
    if (!r.width) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const centre = frac * total;
    let a = Math.max(0, Math.round(centre - span / 2));
    const b = Math.min(total, a + span);
    a = Math.max(0, b - span);
    state.view.from = a;
    state.view.to = b;
    drawOverviewWindow();
    loadPeaks();
    if (state.showSpec) loadSpectrogram();
  };

  ov.addEventListener('mousedown', (e) => { panning = true; centreOn(e); });
  window.addEventListener('mousemove', (e) => { if (panning) centreOn(e); });
  window.addEventListener('mouseup', () => { panning = false; });
})();

let resizeTimer;
function redrawLane() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // The canvases are sized in pixels off the lane's width while following, so
    // they have to be re-placed before anything is drawn into them.
    layoutWaveBuffer();
    drawWave();
    if (state.showSpec) drawSpectrogram();
    drawSelection();
    drawMarkers();
    drawCue();
    drawOverview();
    // The grain layer is part of this lane and was not in this list, so a
    // resize left its marks at the pixel positions of the *old* width while
    // everything under them moved.
    drawGrainLayer();
  }, 60);
}
window.addEventListener('resize', redrawLane);

// Fires when the lane first gains a size, which a draw scheduled on a timer
// can easily miss.
if (window.ResizeObserver) {
  new ResizeObserver(redrawLane).observe($('lane'));
}

// ---------------------------------------------------------------- selection

const framesToX = (frame) => {
  const { from, to } = state.view;
  return to > from ? (frame - from) / (to - from) : 0;
};
const xToFrames = (frac) => {
  const { from, to } = state.view;
  return Math.round(from + frac * (to - from));
};

(function wireSelection() {
  const lane = $('lane');
  let dragging = false;
  let anchor = 0;

  const posFrom = (e) => {
    const r = lane.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  // One gesture does both: pressing moves the playhead, dragging from there
  // selects — and the playhead follows the drag, so you hear where you are.
  const seekToSource = (frac) => {
    if (!state.selectedFile) return;
    const frame = xToFrames(frac);
    if (engine.path !== state.selectedFile.path) { playFile(state.selectedFile); return; }
    seekSource(frame);
  };

  // Click positions the playhead. Dragging from there selects. Holding option
  // scrubs instead, so you can run over the file and hear it without
  // destroying a selection you already made.
  let scrubbing = false;

  lane.addEventListener('mousedown', (e) => {
    if (!state.peaks) return;
    dragging = true;
    scrubbing = e.altKey;
    anchor = xToFrames(posFrom(e));
    if (scrubbing) { seekToSource(posFrom(e)); return; }
    state.sel = null;
    drawSelection();
    applyLoop();
    setCue(anchor);
    seekToSource(posFrom(e));
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const frac = posFrom(e);
    if (scrubbing || e.altKey) { seekToSource(frac); return; }
    const now = xToFrames(frac);
    // A drag of a pixel or two is a click, not a selection.
    if (Math.abs(now - anchor) < (state.view.to - state.view.from) / 500) return;
    state.sel = { start: Math.min(anchor, now), end: Math.max(anchor, now) };
    setCue(state.sel.start);
    drawSelection();
    applyLoop();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    if (scrubbing) { scrubbing = false; return; }
    updateSelLabel();
    applyLoop();
    // Looping a fresh selection should start from its beginning rather than
    // wherever the drag happened to end.
    if (state.loopOn && state.sel) seekSource(state.sel.start);
  });
})();

function drawSelection() {
  const el = $('selection');
  if (!state.sel) { el.classList.add('hidden'); updateSelLabel(); return; }
  const a = framesToX(state.sel.start);
  const b = framesToX(state.sel.end);
  el.classList.remove('hidden');
  el.style.left = (a * 100) + '%';
  el.style.width = ((b - a) * 100) + '%';
  updateSelLabel();
}

function updateSelLabel() {
  const sr = state.view.sampleRate || 1;
  const el = $('selLabel');
  if (!el) return;
  el.textContent = state.sel
    ? `${fmtTime(state.sel.start / sr)} → ${fmtTime(state.sel.end / sr)} (${((state.sel.end - state.sel.start) / sr).toFixed(3)}s)`
    : 'click · drag · ⌥scrub';
  wtSync();
}

