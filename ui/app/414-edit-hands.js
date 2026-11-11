// ══════════════════════════════════ the Edit page: editing on the wave ══
//
// C's half of D: you edit the selection by touching it.
// - The orange squares at its top corners: drag inward to fade in or out.
// - The pill: drag up or down to change its level. The dashed line is where
//   the peak will land, red if it would clip.
// - Its edges: drag to move them (`edEdgeGrab`, read by 040's selection code),
//   with a loupe on the samples at the edit point.
// While a handle is held the result is drawn over the selection from the
// document's own samples; letting go sends one edit op, the one the old button
// sent, and the selection and the view stay where they were. See
// `docs/EDIT-PAGE.md`.

let edLive = null; // a handle being dragged: { kind, v }

const edSelOn = () => !!state.sel && state.sel.end - state.sel.start >= 64;
const edFx = (frame) => framesToX(frame) * $('lane').clientWidth;

function edPaintHands() {
  const box = $('edHands');
  if (!box) return;
  if (!edOn() || !edSelOn() || !state.peaks) { box.replaceChildren(); return; }
  const L = $('lane'), W = L.clientWidth, H = $('waveCanvas').clientHeight;
  const a = edFx(state.sel.start), b = edFx(state.sel.end);
  if (b < 0 || a > W) { box.replaceChildren(); return; }
  const ca = Math.max(0, a), cb = Math.min(W, b), sr = state.view.sampleRate || 44100;
  const lv = edLevels(state.sel.start, state.sel.end);
  const fi = edLive?.kind === 'fi' ? edLive.v : 0, fo = edLive?.kind === 'fo' ? edLive.v : 0, gdb = edLive?.kind === 'g' ? edLive.v : 0;
  // The level line, against the same half-height the waveform is drawn at.
  const nch = state.peaks.channels.length, laneH = H / nch, half = (laneH / 2) * 0.92;
  const peak = lv ? lv.peak : 0, k = Math.min(1.02, Math.pow(10, (peak + gdb) / 20));
  const y = laneH / 2 - k * half;
  const px = (ms) => (ms / 1000 * sr) / (state.view.to - state.view.from) * W;
  let h = `<div class="ed-gl" style="left:${ca}px;width:${cb - ca}px;top:${y}px"></div><div class="ed-gl lo" style="left:${ca}px;width:${cb - ca}px;top:${laneH - y}px"></div>`;
  h += `<div class="ed-gg${peak + gdb > 0 ? ' clip' : ''}" data-h="g" style="left:${(ca + cb) / 2}px;top:${Math.min(laneH - 14, y + 24)}px" title="Drag up or down: the level of the selection">${gdb ? `${gdb > 0 ? '+' : ''}${gdb.toFixed(1)} dB` : lv ? `${lv.peak.toFixed(1)} dB` : 'level'}</div>`;
  h += `<div class="ed-fh" data-h="fi" data-l="${fi ? edFmt.ms(fi) : 'fade'}" style="left:${a + px(fi)}px" title="Drag right: fade in"></div>`;
  h += `<div class="ed-fh" data-h="fo" data-l="${fo ? edFmt.ms(fo) : 'fade'}" style="left:${b - px(fo)}px" title="Drag left: fade out"></div>`;
  if (fi || fo) {
    const w = Math.max(1, px(fi || fo)), x0 = fi ? a : b - w;
    let d = '';
    for (let i = 0; i <= 30; i++) { const u = i / 30, v = edCurve(fi ? u : 1 - u); d += `${i ? 'L' : 'M'}${(u * w).toFixed(1)} ${(H * 0.04 + (1 - v) * H * 0.9).toFixed(1)}`; }
    h += `<svg class="ed-fc" style="left:${x0}px;width:${w}px;height:${H}px" viewBox="0 0 ${w} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  h += `<div class="ed-chip" style="left:${(ca + cb) / 2}px"><b>${((state.sel.end - state.sel.start) / sr).toFixed(3)} s</b><span>${lv ? `${lv.rms.toFixed(1)} dB RMS` : ''}</span><button type="button" data-x="curve" title="The fades' curve">${state.fadeShape === 'linear' ? 'linear' : 'smooth'} fades</button><button type="button" data-x="cut" title="Cut  ⌘X">cut</button><button type="button" data-x="region" title="New region  R">region</button></div>`;
  box.innerHTML = h;
}

/// The fade's shape, as the server makes it: equal power unless linear.
const edCurve = (u) => (state.fadeShape === 'linear' ? u : Math.sin(u * Math.PI / 2));

/// What the selection will sound like with the handle where it is now, drawn
/// over it from the document's own samples.
function edPaintPreview() {
  const cv = $('edPreview');
  if (!cv) return;
  const m = edSound.mono;
  if (!edLive || !m || !edSelOn()) { cv.hidden = true; return; }
  const a = state.sel.start, b = state.sel.end, x0 = edFx(a), x1 = edFx(b);
  cv.hidden = false;
  cv.style.left = `${x0}px`; cv.style.width = `${Math.max(1, x1 - x0)}px`; cv.style.height = `${$('waveCanvas').clientHeight}px`;
  const c = edCanvas(cv);
  if (!c) return;
  const { g, w, h } = c, n = b - a, mid = h / 2, half = mid * 0.92;
  const sr = state.view.sampleRate || 44100, k = edLive.kind === 'g' ? Math.pow(10, edLive.v / 20) : 1;
  const fn = edLive.kind === 'fi' || edLive.kind === 'fo' ? Math.round(edLive.v / 1000 * sr) : 0;
  g.fillStyle = 'rgba(10,12,16,.82)'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffc46e';
  for (let x = 0; x < w; x++) {
    const i0 = a + Math.floor(x / w * n), i1 = Math.max(i0 + 1, a + Math.floor((x + 1) / w * n));
    let mn = 0, mx = 0;
    const step = Math.max(1, Math.floor((i1 - i0) / 48));
    for (let i = i0; i < i1; i += step) { const v = m[i] || 0; if (v < mn) mn = v; if (v > mx) mx = v; }
    const off = a + (x + 0.5) / w * n - a;
    let env = k;
    if (edLive.kind === 'fi' && off < fn) env = edCurve(off / fn);
    if (edLive.kind === 'fo' && n - off < fn) env = edCurve((n - off) / fn);
    const top = Math.max(-1, Math.min(1, mx * env)), bot = Math.max(-1, Math.min(1, mn * env));
    g.fillRect(x, mid - top * half, 1, Math.max(1, (top - bot) * half));
  }
}

/// A handle held, moved and let go.
(function wireHands() {
  const box = $('edHands');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'curve') setFadeShape(state.fadeShape === 'linear' ? 'equalPower' : 'linear');
    else edRun(x.dataset.x);
    edPaintHands();
  });
  box.addEventListener('mousedown', (e) => {
    const t = e.target.closest('[data-h]');
    if (!t || !edSelOn()) return;
    e.stopPropagation(); e.preventDefault();
    const kind = t.dataset.h, x0 = e.clientX, y0 = e.clientY;
    const L = $('lane'), r = L.getBoundingClientRect(), scale = r.width / L.clientWidth || 1;
    const sr = state.view.sampleRate || 44100, lenMs = (state.sel.end - state.sel.start) / sr * 1000;
    const msPerPx = (state.view.to - state.view.from) / L.clientWidth / sr * 1000;
    const lv = edLevels(state.sel.start, state.sel.end), H = $('waveCanvas').clientHeight, nch = state.peaks.channels.length;
    const half = (H / nch / 2) * 0.92, pk = lv ? Math.pow(10, lv.peak / 20) : 1, yPk = H / nch / 2 - pk * half;
    edLive = { kind, v: 0 };
    const move = (m) => {
      if (kind === 'g') {
        const ny = Math.max(2, Math.min(H / nch / 2 - 2, yPk + (m.clientY - y0) / scale));
        const npk = (H / nch / 2 - ny) / half;
        edLive.v = Math.max(-36, Math.min(24, 20 * Math.log10(Math.max(1e-6, npk) / pk)));
      } else {
        edLive.v = Math.max(0, Math.min(lenMs, (kind === 'fi' ? 1 : -1) * (m.clientX - x0) / scale * msPerPx));
      }
      edPaintHands();
      edPaintPreview();
    };
    const up = async () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const v = edLive.v;
      edLive = null;
      edPaintPreview();
      edPaintHands();
      if (kind === 'g' && Math.abs(v) >= 0.05) await edKeepPlace(() => editOp({ op: 'gain', db: Math.round(v * 10) / 10, start: state.sel.start, end: state.sel.end }));
      else if ((kind === 'fi' || kind === 'fo') && v >= 1) {
        const frames = Math.max(1, Math.round(v / 1000 * sr));
        await edKeepPlace(() => editCmd({ op: kind === 'fi' ? 'fadeIn' : 'fadeOut', start: state.sel.start, end: state.sel.end, frames, shape: state.fadeShape }));
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
})();

/// Run an edit that would refit the view and drop the selection, and put both
/// back: a fade made by hand should leave you looking where you were.
async function edKeepPlace(run) {
  const sel = state.sel && { ...state.sel }, from = state.view.from, to = state.view.to;
  await run();
  const total = state.edit?.frames || state.view.frames || 0;
  if (sel && sel.end <= total) { state.sel = sel; drawSelection(); applyLoop(); }
  if (to > from && to <= total) { state.view.from = from; state.view.to = to; await loadPeaks(); drawOverviewWindow(); if (state.showSpec) loadSpectrogram(); }
  edAfterDraw();
}

// ───────────────────────────────────────────── the edges, and the loupe

/// Pressing near a selection's edge picks that edge up. Called by 040's
/// mousedown with the pointer's frame and pixel; returns the frame the drag
/// anchors on (the other edge), or null to make a new selection as before.
function edEdgeGrab(px) {
  if (!edOn() || !edSelOn()) return null;
  const a = edFx(state.sel.start), b = edFx(state.sel.end);
  if (Math.abs(px - a) < 6) return state.sel.end;
  if (Math.abs(px - b) < 6) return state.sel.start;
  return null;
}

/// Where a dragged edge lands: on a hit when Snap to hits is on and one is
/// near, otherwise on the nearest zero crossing when Snap is on zero.
function edEdgeSnap(frame) {
  const sr = state.view.sampleRate || 44100;
  if (edPrefs.snapHits) { const h = edNearestHit(frame, Math.round(0.02 * sr)); if (h != null) frame = h; }
  if (state.snap === 'zero') frame = edNearestZero(frame, Math.round(0.012 * sr));
  return frame;
}

/// The samples at the edit point, drawn large while an edge moves.
function edLoupe(frame) {
  const box = $('edLoupe');
  if (!box) return;
  const m = edSound.mono;
  if (frame == null || !m) { box.hidden = true; return; }
  const L = $('lane'), x = edFx(frame);
  box.hidden = false;
  box.style.left = `${Math.max(4, Math.min(L.clientWidth - 224, x - 110))}px`;
  const c = edCanvas(box.querySelector('canvas'));
  if (!c) return;
  const { g, w, h } = c, R = 80;
  g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(0, h / 2, w, 1);
  g.fillStyle = 'rgba(255,181,71,.6)'; g.fillRect(w / 2, 0, 1, h);
  g.strokeStyle = edInk('--m-wave', '#fff'); g.lineWidth = 1.5; g.beginPath();
  for (let k = -R; k <= R; k++) { const v = m[frame + k] || 0, px = w / 2 + k / R * w / 2, py = h / 2 - v * h / 2 * 1.5; k === -R ? g.moveTo(px, py) : g.lineTo(px, py); }
  g.stroke();
  const v = m[frame] || 0, ok = Math.abs(v) < 0.02;
  g.fillStyle = ok ? '#3ad59b' : '#ff7a70'; g.beginPath(); g.arc(w / 2, h / 2 - v * h / 2 * 1.5, 4, 0, 7); g.fill();
  const say = box.querySelector('span');
  say.className = ok ? 'ok' : 'bad';
  say.textContent = `${fmtTime(frame / (state.view.sampleRate || 44100))} · ${ok ? 'on zero, clean' : `off zero ${v.toFixed(3)}, may click`}`;
}
