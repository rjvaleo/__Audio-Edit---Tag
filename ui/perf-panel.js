// ─── PERFORMANCE PANEL — the scale sequencer's, on the grain page ────────────
//
// This is `performance.js` from `rjvaleo/scale-sequencer` — its timeline, its
// header, its status row, its resize grip, its collapse — carried over as it
// is and pointed at the document's automation lanes instead of the
// sequencer's gesture stream. The constants are the same numbers, the drawing
// is the same drawing, the colours are the same colours, so that the take on
// the grain page and the take on the Seq page are one thing seen twice. When
// the two become one arrangement, this is the timeline they will share.
//
// What differs is only what the data is: a lane has breakpoints in document
// frames where a gesture has points in seconds, and the document has no bars,
// so the ruler counts seconds. The STRUCT lane carries what the document has
// that is discrete — its markers and regions — where the sequencer's carried
// switch and step edits.
//
// Loaded before `app.js`; nothing here runs at load. `app.js` calls
// `perfDrawTimeline` when the lanes change and on every transport tick.

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PERF_H_KEY = 'audiolab.perfH';
const PERF_GUTTER = 92;
const PERF_RULER_H = 18;
const PERF_LANE_H = 34; // natural lane height; compresses when the user resizes
const PERF_MIN_LANE_H = 14;
const PERF_STRUCT_H = 22;
// Section split over normalized time, matching the analysis/ruler labels
const PERF_SECTIONS = [
  { name: 'INTRO', a: 0.0, b: 0.15 },
  { name: 'BUILD', a: 0.15, b: 0.5 },
  { name: 'PEAK', a: 0.5, b: 0.85 },
  { name: 'OUTRO', a: 0.85, b: 1.0 },
];
const SECTION_TINTS = [
  'rgba(0,229,255,0.045)',
  'rgba(127,255,0,0.045)',
  'rgba(255,107,53,0.055)',
  'rgba(0,229,255,0.03)',
];

// Lane colors follow module identity
function perfLaneColor(target) {
  if (target.startsWith('stretch.grain.')) return '#00e5ff';
  if (/^stretch\.(wsola|vocoder|pvsola|hybrid)\./.test(target)) return '#a0ff60';
  if (target.startsWith('stretch.')) return '#ff6b35';
  if (target.startsWith('fx.')) return '#7fff00';
  if (target.startsWith('rack.')) return '#ff60b8';
  return '#c8d8e0';
}
function perfLaneLabel(lane) {
  const l = lane.label || lane.target;
  return l.replace(/^.*— /, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').toUpperCase();
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let perfTimelineH = parseInt(localStorage.getItem(PERF_H_KEY)) || 0; // 0 = auto
let perfLaneHits = []; // hit rects rebuilt on each draw

// ─── THE DOCUMENT AS A TAKE ──────────────────────────────────────────────────
/// The document's length in frames, the timeline every lane is drawn against.
function perfFrames() {
  return state.edit?.frames || state.view?.frames || 1;
}
function perfRate() {
  return state.view?.sampleRate || 44100;
}
function perfDuration() {
  return perfFrames() / perfRate();
}
function perfLanes() {
  return (state.automation && state.automation.lanes) || [];
}
function perfRecording() {
  return !!state.automationRecord && state.automationRecord !== 'off';
}
function perfHeadT() {
  if (typeof engine === 'undefined' || !engine.playing) return null;
  return sourceFrameNow() / perfRate();
}

/// What the STRUCT lane shows: the document's own discrete events.
function perfDiscretes() {
  const sr = perfRate();
  const out = [];
  for (const m of state.annotations?.markers || []) {
    out.push({ t: m.frame / sr, label: (m.name || 'MARK').toUpperCase().slice(0, 10) });
  }
  for (const r of state.annotations?.regions || []) {
    if (typeof r.start === 'number') out.push({ t: r.start / sr, label: `[${(r.name || 'REGION').toUpperCase().slice(0, 8)}` });
  }
  if (state.sel && state.sel.end > state.sel.start) {
    out.push({ t: state.sel.start / sr, label: 'SEL' });
  }
  return out.sort((a, b) => a.t - b.t);
}

function perfTimelineData() {
  const lanes = perfLanes();
  return {
    live: perfRecording() && typeof engine !== 'undefined' && engine.playing,
    duration: Math.max(1, perfDuration()),
    lanes,
    discretes: perfDiscretes(),
  };
}

// ─── DRAW ────────────────────────────────────────────────────────────────────
function perfDrawTimeline() {
  const canvas = document.getElementById('perfCanvas');
  if (!canvas) return;
  const data = perfTimelineData();
  const nLanes = data ? Math.max(1, data.lanes.length) : 1;
  const cssW = canvas.offsetWidth;
  // lane height compresses to honor a user-set panel height
  let laneH = PERF_LANE_H;
  if (perfTimelineH > 0) {
    laneH = Math.max(
      PERF_MIN_LANE_H,
      Math.min(PERF_LANE_H, (perfTimelineH - PERF_RULER_H - PERF_STRUCT_H - 6) / nLanes),
    );
  }
  const H = Math.round(PERF_RULER_H + nLanes * laneH + PERF_STRUCT_H + 6);
  // Drawn at the screen's own resolution, then scaled back: the lines and the
  // type are the sequencer's, only sharper on a dense display.
  const dpr = window.devicePixelRatio || 1;
  if (cssW > 0 && canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
  canvas.style.height = `${H}px`;
  const W = cssW > 0 ? cssW : canvas.width / dpr;
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#0a0c0e';
  c.fillRect(0, 0, W, H);
  perfLaneHits = [];
  if (!data.lanes.length && !data.live) {
    c.fillStyle = '#2a3540';
    c.font = '10px "Share Tech Mono", monospace';
    c.textAlign = 'center';
    c.fillText('NO TAKE — ⏺ REC PERF WHILE THE SOUND PLAYS, THEN PERFORM', W / 2, H / 2);
    return;
  }
  const plotW = W - PERF_GUTTER - 8;
  const xOf = (t) => PERF_GUTTER + (t / data.duration) * plotW;

  // Ruler: section tints + ticks
  c.fillStyle = '#0d1115';
  c.fillRect(PERF_GUTTER, 0, plotW, PERF_RULER_H);
  if (!data.live) {
    PERF_SECTIONS.forEach((s, i) => {
      c.fillStyle = SECTION_TINTS[i];
      c.fillRect(xOf(s.a * data.duration), 0, (s.b - s.a) * plotW, PERF_RULER_H);
      c.fillStyle = '#4a6070';
      c.font = '8px "Share Tech Mono", monospace';
      c.textAlign = 'center';
      c.fillText(s.name, xOf(((s.a + s.b) / 2) * data.duration), 12);
    });
  }
  // Seconds down the plot, where the sequencer has bars: the document keeps
  // no tempo. The step is chosen so there are between eight and sixteen.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => data.duration / s <= 16) || 600;
  c.strokeStyle = '#1e2830';
  c.fillStyle = '#2a3540';
  c.font = '7px "Share Tech Mono", monospace';
  c.textAlign = 'left';
  for (let t = 0; t <= data.duration; t += step) {
    const x = xOf(t);
    c.beginPath();
    c.moveTo(x, PERF_RULER_H - 5);
    c.lineTo(x, H - 4);
    c.stroke();
    if (data.live) c.fillText(t % 1 ? t.toFixed(1) : String(t), x + 2, PERF_RULER_H - 7);
  }

  // Selection overlay
  if (state.sel && state.sel.end > state.sel.start && !data.live) {
    const sr = perfRate();
    const a = xOf(state.sel.start / sr), b = xOf(state.sel.end / sr);
    c.fillStyle = 'rgba(0,229,255,0.08)';
    c.fillRect(a, 0, b - a, H - 4);
    c.strokeStyle = 'rgba(0,229,255,0.5)';
    c.setLineDash([3, 3]);
    c.strokeRect(a, 0.5, b - a, H - 5);
    c.setLineDash([]);
  }

  // Lanes
  const sr = perfRate();
  data.lanes.forEach((lane, li) => {
    const y0 = PERF_RULER_H + li * laneH;
    c.strokeStyle = '#1e2830';
    c.strokeRect(PERF_GUTTER + 0.5, y0 + 1.5, plotW - 1, laneH - 3);
    const color = perfLaneColor(lane.target);
    const dim = lane.enabled === false || (state.automation && state.automation.bypassed);
    const selected = lane.id === state.automationSel;
    c.fillStyle = dim ? '#4a6070' : color;
    c.font = '9px "Share Tech Mono", monospace';
    c.textAlign = 'left';
    c.fillText(perfLaneLabel(lane).slice(0, 14), 4, y0 + laneH / 2 + 3);
    const yOf = (v) => y0 + laneH - 5 - v * (laneH - 9);
    const pts = (lane.points || []).slice().sort((a, b) => a.frame - b.frame);
    perfLaneHits.push({ id: lane.id, x0: 0, x1: W, y0, y1: y0 + laneH });
    if (!pts.length) return;
    // The curve, sampled between breakpoints the way the lane plays it, and
    // held flat out to both edges, as the lane is.
    const path = [[0, pts[0].value]];
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        const kk = curveT(t, pts[i]);
        path.push([
          (pts[i].frame + (pts[i + 1].frame - pts[i].frame) * t) / sr,
          pts[i].value + (pts[i + 1].value - pts[i].value) * kk,
        ]);
      }
    }
    if (pts.length === 1) path.push([pts[0].frame / sr, pts[0].value]);
    path.push([data.duration, pts[pts.length - 1].value]);
    c.beginPath();
    path.forEach(([t, v], k) => {
      const x = xOf(t);
      if (k === 0) c.moveTo(x, yOf(v));
      else c.lineTo(x, yOf(v));
    });
    c.setLineDash(dim ? [4, 3] : []);
    c.strokeStyle = dim ? '#3d5162' : color;
    c.lineWidth = selected ? 2.5 : 1.5;
    c.globalAlpha = dim ? 0.85 : 1;
    c.stroke();
    c.globalAlpha = 1;
    c.setLineDash([]);
    c.lineWidth = 1;
    if (selected) {
      c.strokeStyle = 'rgba(200,216,224,0.6)';
      c.setLineDash([3, 3]);
      c.strokeRect(xOf(pts[0].frame / sr) - 4, y0 + 2.5,
        xOf(pts[pts.length - 1].frame / sr) - xOf(pts[0].frame / sr) + 8, laneH - 5);
      c.setLineDash([]);
    }
  });

  // Struct lane
  const sy = PERF_RULER_H + data.lanes.length * laneH;
  c.strokeStyle = '#1e2830';
  c.strokeRect(PERF_GUTTER + 0.5, sy + 1.5, plotW - 1, PERF_STRUCT_H - 3);
  c.fillStyle = '#ff60b8';
  c.font = '9px "Share Tech Mono", monospace';
  c.textAlign = 'left';
  c.fillText('STRUCT', 4, sy + PERF_STRUCT_H / 2 + 3);
  c.font = '8px "Share Tech Mono", monospace';
  data.discretes.forEach((d) => {
    const x = xOf(d.t);
    c.strokeStyle = '#ff60b8';
    c.beginPath();
    c.moveTo(x, sy + 2);
    c.lineTo(x, sy + PERF_STRUCT_H - 2);
    c.stroke();
    c.fillStyle = '#ff60b8';
    c.fillText(d.label, x + 3, sy + PERF_STRUCT_H / 2 + 3);
  });

  // Playhead / write head
  const headT = perfHeadT();
  if (headT !== null) {
    const headColor = data.live ? '#ff3333' : '#ff6b35';
    const x = xOf(Math.min(headT, data.duration));
    c.strokeStyle = headColor;
    c.lineWidth = 2;
    c.shadowColor = headColor;
    c.shadowBlur = 6;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, H - 4);
    c.stroke();
    c.shadowBlur = 0;
    c.lineWidth = 1;
  }
  perfUpdatePos(headT);
}

/// Which lane a point on the canvas is in, from the rects the last draw left.
function perfLaneAt(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  const hit = perfLaneHits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y < h.y1);
  return hit ? hit.id : null;
}

// ─── HEADER · STATUS · POSITION ──────────────────────────────────────────────
function perfSetStatus(msg) {
  const el = document.getElementById('perfStatus');
  if (el) el.textContent = msg;
}
function perfUpdateHeader() {
  const name = document.getElementById('perfName');
  const info = document.getElementById('perfHeaderInfo');
  if (!name || !info) return;
  const lanes = perfLanes();
  const file = state.selectedFile?.name || state.selectedFile?.path?.split('/').pop() || '';
  if (lanes.length) {
    name.textContent = file.replace(/\.[^.]+$/, '').toUpperCase() || 'TAKE';
    const points = lanes.reduce((n, l) => n + (l.points || []).length, 0);
    const live = lanes.filter((l) => l.enabled !== false && (l.points || []).length).length;
    info.textContent = `${perfDuration().toFixed(0)}s · ${lanes.length} LANES · ${live} LIVE · ${points} POINTS`
      + (state.automation?.bypassed ? ' · BYPASSED' : '');
  } else {
    name.textContent = 'NO TAKE';
    info.textContent = '—';
  }
}
function perfUpdatePos(headT) {
  const el = document.getElementById('perfPos');
  if (!el) return;
  if (headT === null) { el.textContent = '— · —'; return; }
  const s = Math.max(0, headT);
  const m = Math.floor(s / 60);
  el.textContent = `${String(m).padStart(2, '0')} · ${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}

// ─── RESIZE · COLLAPSE ───────────────────────────────────────────────────────
function perfResizeReset() {
  perfTimelineH = 0;
  localStorage.removeItem(PERF_H_KEY);
  perfDrawTimeline();
}
function perfResizeStart(e) {
  e.preventDefault();
  const canvas = document.getElementById('perfCanvas');
  const startY = e.clientY;
  const startH = canvas.offsetHeight;
  function onMove(ev) {
    perfTimelineH = Math.max(
      PERF_RULER_H + PERF_STRUCT_H + PERF_MIN_LANE_H + 6,
      Math.min(420, startH + (ev.clientY - startY)),
    );
    localStorage.setItem(PERF_H_KEY, Math.round(perfTimelineH));
    perfDrawTimeline();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function perfToggleCollapse() {
  const body = document.getElementById('perfBody');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  const icon = document.getElementById('perfCollapseIcon');
  if (icon) icon.textContent = open ? '▾' : '▸';
  if (open) perfDrawTimeline();
}
