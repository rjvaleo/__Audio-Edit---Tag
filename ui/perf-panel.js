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
// **One timeline** (`docs/COMPOSE.md`, phase two). The lanes are drawn in
// groups: the document's own (GRAIN), the sequencer's take (SEQ), and the
// picture's (VISUAL) once those exist. Every group is on the same ruler, in the
// engine's output seconds — a lane's frames are output frames at the file's
// rate, and the sequencer runs on the engine's output time — so a gesture on
// the sequencer and a breakpoint on the grain lie where they sound. A group's
// heading is drawn only when more than one group has lanes, so the Grain
// workspace's timeline looks as it always has. In the Compose arrangement a
// SOUND row sits under the ruler, and when the sequencer is playing a part the
// ruler carries its bars.
//
// Loaded before `app.js`; nothing here runs at load. `app.js` calls
// `perfDrawTimeline` when the lanes change and on the transport's tick.

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PERF_H_KEY = 'audiolab.perfH';
const PERF_GUTTER = 92;
const PERF_RULER_H = 18;
const PERF_LANE_H = 34; // natural lane height; compresses when the user resizes
const PERF_MIN_LANE_H = 14;
const PERF_STRUCT_H = 22;
/// A group's heading. Drawn only when more than one group has lanes.
const PERF_GROUP_H = 14;
/// The sound under the ruler, in the Compose arrangement.
const PERF_SOUND_H = 26;
/// Which groups are folded, kept across reloads.
const PERF_GROUPS_KEY = 'audiolab.perfGroups';
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

/// The groups a lane belongs to, in the order they are drawn.
const PERF_GROUPS = [
  { key: 'grain', label: 'GRAIN', color: '#00e5ff' },
  { key: 'seq', label: 'SEQ', color: '#ff60b8' },
  { key: 'visual', label: 'VISUAL', color: '#ffd166' },
];

// Lane colors follow module identity
function perfLaneColor(target) {
  if (target.startsWith('seq.')) return perfSeqColor(target.slice(4));
  if (target.startsWith('visual.')) return '#ffd166';
  if (target.startsWith('stretch.grain.')) return '#00e5ff';
  if (/^stretch\.(wsola|vocoder|pvsola|hybrid)\./.test(target)) return '#a0ff60';
  if (target.startsWith('stretch.')) return '#ff6b35';
  if (target.startsWith('fx.')) return '#7fff00';
  if (target.startsWith('rack.')) return '#ff60b8';
  return '#c8d8e0';
}
/// The sequencer's own colours for its controls — the same rule its panel uses.
function perfSeqColor(id) {
  if (id.startsWith('cutoff') || id.startsWith('res')) return '#00e5ff';
  if (id.startsWith('lfo1')) return '#ff6b35';
  if (id.startsWith('lfo2')) return '#00e5ff';
  if (id.startsWith('lfo3')) return '#a0ff60';
  if (id.startsWith('delay')) return '#7fff00';
  if (id.startsWith('bpm') || id.startsWith('steps')) return '#ff60b8';
  if (id.startsWith('f') || id.startsWith('keyFollow')) return '#ff6b35';
  return '#c8d8e0';
}
function perfLaneLabel(lane) {
  const l = lane.label || lane.target;
  return l.replace(/^.*— /, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').toUpperCase();
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let perfTimelineH = parseInt(localStorage.getItem(PERF_H_KEY)) || 0; // 0 = auto
let perfLaneHits = []; // hit rects rebuilt on each draw
let perfGroupsCollapsed = {};
try {
  perfGroupsCollapsed = JSON.parse(localStorage.getItem(PERF_GROUPS_KEY) || '{}') || {};
} catch { perfGroupsCollapsed = {}; }

/// Fold a group, or open it.
function perfToggleGroup(key) {
  perfGroupsCollapsed[key] = !perfGroupsCollapsed[key];
  try { localStorage.setItem(PERF_GROUPS_KEY, JSON.stringify(perfGroupsCollapsed)); } catch { /* private mode */ }
  perfDrawTimeline();
}

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
/// Where the playhead is, in the timeline's own seconds: the engine's output
/// time. It used to read the source frame, which is a different clock whenever
/// the sound is stretched — at four times, the head crawled across a quarter
/// of the ruler while the lanes it was playing ran the whole way.
function perfHeadT() {
  if (typeof engine === 'undefined' || !engine.playing) return null;
  return playbackTime();
}

/// The sequencer's take, as its bridge last sent it — lanes of
/// `[output seconds, 0..1]` — while SEQ is on.
function perfSeqTake() {
  if (typeof seq === 'undefined' || !seq.take) return null;
  if (typeof sourceOn === 'function' && !sourceOn('seq')) return null;
  return seq.take;
}
function perfSeqLanes() {
  return perfSeqTake()?.lanes || [];
}
/// The picture's lanes, once there are any. Same shape as the sequencer's.
function perfVisualLanes() {
  return typeof visualTimelineLanes === 'function' ? visualTimelineLanes() : [];
}

/// What the STRUCT lane shows: the document's own discrete events, and the
/// sequencer's — its scale changes, step edits and switches.
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
  for (const d of perfSeqTake()?.discretes || []) {
    out.push({ t: d.t, label: String(d.label || '').slice(0, 10), seq: true });
  }
  return out.sort((a, b) => a.t - b.t);
}

/// The bar lines at the sequencer's tempo, while it is playing a part: four
/// beats to a bar, as its own position display counts them.
function perfBars(duration) {
  if (typeof seq === 'undefined' || !seq.tempo || !(seq.tempo.bpm > 0)) return [];
  if (typeof sourceOn === 'function' && !sourceOn('seq')) return [];
  const bar = (60 / seq.tempo.bpm) * 4;
  const out = [];
  for (let n = 0; n * bar <= duration + 1e-9 && n < 4000; n++) out.push(n * bar);
  return out;
}

/// A grain lane's curve, sampled the way the lane plays it, kept until the
/// lanes change. A recorded take holds thousands of breakpoints and the
/// playhead now redraws the timeline while playing.
const perfPathCache = new WeakMap();
let perfLanesVersion = 0;
function perfBumpLanes() { perfLanesVersion++; }
function perfGrainPath(lane, sr, duration) {
  const n = (lane.points || []).length;
  const key = `${perfLanesVersion}|${sr}|${duration}|${n}`;
  const had = perfPathCache.get(lane);
  if (had && had.key === key) return had;
  const pts = (lane.points || []).slice().sort((a, b) => a.frame - b.frame);
  const path = [];
  if (pts.length) {
    // The curve, sampled between breakpoints the way the lane plays it, and
    // held flat out to both edges, as the lane is.
    path.push([0, pts[0].value]);
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
    path.push([duration, pts[pts.length - 1].value]);
  }
  const out = {
    key, path,
    first: pts.length ? pts[0].frame / sr : 0,
    last: pts.length ? pts[pts.length - 1].frame / sr : 0,
  };
  perfPathCache.set(lane, out);
  return out;
}

function perfTimelineData() {
  const lanes = perfLanes();
  const bypassed = !!(state.automation && state.automation.bypassed);
  const grain = lanes.map((lane) => ({
    group: 'grain', grain: true, lane, id: lane.id,
    label: perfLaneLabel(lane), color: perfLaneColor(lane.target),
    dim: lane.enabled === false || bypassed,
  }));
  const other = (group, list) => list.map((lane) => ({
    group, lane, id: lane.id, label: lane.label || lane.id,
    color: lane.color || perfLaneColor(lane.target || ''), dim: false,
  }));
  // The picture's lanes are the grain's shape — frames and breakpoints — so
  // they are sampled the same way.
  const visual = perfVisualLanes().map((lane) => ({
    group: 'visual', grain: true, lane, id: lane.id,
    label: typeof visualLaneShort === 'function' ? visualLaneShort(lane) : perfLaneLabel(lane),
    color: '#ffd166', dim: lane.enabled === false || bypassed,
  }));
  const byGroup = { grain, seq: other('seq', perfSeqLanes()), visual };
  const groups = PERF_GROUPS
    .map((g) => ({ ...g, lanes: byGroup[g.key] }))
    .filter((g) => g.lanes.length);
  const take = perfSeqLanes().length ? perfSeqTake() : null;
  const takeEnd = take ? (+take.startAt || 0) + (+take.duration || 0) : 0;
  const duration = Math.max(1, perfDuration(), takeEnd);
  return {
    live: perfRecording() && typeof engine !== 'undefined' && engine.playing,
    duration,
    // The document's own lanes, as they always were here.
    lanes,
    groups,
    headed: groups.length > 1,
    discretes: perfDiscretes(),
    bars: perfBars(duration),
  };
}

// ─── DRAW ────────────────────────────────────────────────────────────────────
function perfDrawTimeline() {
  const canvas = document.getElementById('perfCanvas');
  if (!canvas) return;
  const data = perfTimelineData();
  // The SOUND row belongs to the arrangement, where the waveform is not
  // already on screen above the timeline.
  const soundH = document.getElementById('cvArrange')?.contains(canvas) ? PERF_SOUND_H : 0;
  const folded = (g) => data.headed && !!perfGroupsCollapsed[g.key];
  const visible = data.groups.reduce((n, g) => n + (folded(g) ? 0 : g.lanes.length), 0);
  const heads = data.headed ? data.groups.length * PERF_GROUP_H : 0;
  const nLanes = Math.max(1, visible);
  const cssW = canvas.offsetWidth;
  // lane height compresses to honor a user-set panel height
  let laneH = PERF_LANE_H;
  if (perfTimelineH > 0) {
    laneH = Math.max(
      PERF_MIN_LANE_H,
      Math.min(PERF_LANE_H, (perfTimelineH - PERF_RULER_H - soundH - heads - PERF_STRUCT_H - 6) / nLanes),
    );
  }
  const H = Math.round(PERF_RULER_H + soundH + heads + nLanes * laneH + PERF_STRUCT_H + 6);
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
  const plotW = W - PERF_GUTTER - 8;
  const xOf = (t) => PERF_GUTTER + (t / data.duration) * plotW;

  if (soundH) perfDrawSound(c, xOf, plotW, PERF_RULER_H, soundH, data);
  if (!data.groups.length && !data.live) {
    // Readable: it was #2a3540 on #0a0c0e, about 1.4 : 1 (C8).
    c.fillStyle = '#7d93a3';
    c.font = '10px "Share Tech Mono", monospace';
    c.textAlign = 'center';
    c.fillText('NO TAKE — ⏺ REC PERF WHILE THE SOUND PLAYS, THEN PERFORM', W / 2,
      PERF_RULER_H + soundH + (H - PERF_RULER_H - soundH) / 2);
    return;
  }

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
  // Seconds down the plot. The step is chosen so there are between eight and
  // sixteen.
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
  // The sequencer's bars, along the ruler's foot — a numbered tick every few,
  // as many as there is room to read.
  if (data.bars.length) {
    const every = [1, 2, 4, 8, 16, 32].find((k) => (plotW / data.bars.length) * k >= 22) || 64;
    c.strokeStyle = 'rgba(255,96,184,0.45)';
    c.fillStyle = 'rgba(255,96,184,0.8)';
    c.font = '6px "Share Tech Mono", monospace';
    c.textAlign = 'left';
    data.bars.forEach((t, i) => {
      const x = xOf(t);
      const major = i % every === 0;
      c.beginPath();
      c.moveTo(x, PERF_RULER_H - (major ? 6 : 3));
      c.lineTo(x, PERF_RULER_H);
      c.stroke();
      if (major) c.fillText(String(i + 1), x + 2, 6);
    });
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

  // Lanes, group by group
  const sr = perfRate();
  let y = PERF_RULER_H + soundH;
  for (const g of data.groups) {
    const closed = folded(g);
    if (data.headed) {
      c.fillStyle = '#0d1115';
      c.fillRect(0, y, W, PERF_GROUP_H);
      c.fillStyle = g.color;
      c.font = '8px "Share Tech Mono", monospace';
      c.textAlign = 'left';
      c.fillText(`${closed ? '▸' : '▾'} ${g.label} · ${g.lanes.length}`, 4, y + PERF_GROUP_H - 4);
      perfLaneHits.push({ group: g.key, x0: 0, x1: W, y0: y, y1: y + PERF_GROUP_H });
      y += PERF_GROUP_H;
    }
    if (closed) continue;
    for (const item of g.lanes) {
      perfDrawLane(c, item, y, laneH, plotW, xOf, sr, data.duration);
      perfLaneHits.push({ id: item.id, group: g.key, x0: 0, x1: W, y0: y, y1: y + laneH });
      y += laneH;
    }
  }
  if (!visible) y += laneH;

  // Struct lane
  const sy = y;
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

/// One lane: its box, its name, and its curve. A grain lane is sampled from
/// its breakpoints; a sequencer or visual lane arrives as points already.
function perfDrawLane(c, item, y0, laneH, plotW, xOf, sr, duration) {
  c.strokeStyle = '#1e2830';
  c.strokeRect(PERF_GUTTER + 0.5, y0 + 1.5, plotW - 1, laneH - 3);
  const selected = item.id === state.automationSel;
  c.fillStyle = item.dim ? '#4a6070' : item.color;
  c.font = '9px "Share Tech Mono", monospace';
  c.textAlign = 'left';
  c.fillText(String(item.label).slice(0, 14), 4, y0 + laneH / 2 + 3);
  const yOf = (v) => y0 + laneH - 5 - v * (laneH - 9);
  let path = null, first = 0, last = 0;
  if (item.grain) {
    const got = perfGrainPath(item.lane, sr, duration);
    path = got.path;
    first = got.first;
    last = got.last;
  } else {
    const pts = item.lane.points || [];
    if (pts.length) {
      path = [[0, pts[0][1]], ...pts, [duration, pts[pts.length - 1][1]]];
      first = pts[0][0];
      last = pts[pts.length - 1][0];
    }
  }
  if (!path || !path.length) return;
  c.beginPath();
  path.forEach(([t, v], k) => {
    const x = xOf(t);
    if (k === 0) c.moveTo(x, yOf(v));
    else c.lineTo(x, yOf(v));
  });
  c.setLineDash(item.dim ? [4, 3] : []);
  c.strokeStyle = item.dim ? '#3d5162' : item.color;
  c.lineWidth = selected ? 2.5 : 1.5;
  c.globalAlpha = item.dim ? 0.85 : 1;
  c.stroke();
  c.globalAlpha = 1;
  c.setLineDash([]);
  c.lineWidth = 1;
  if (selected) {
    c.strokeStyle = 'rgba(200,216,224,0.6)';
    c.setLineDash([3, 3]);
    c.strokeRect(xOf(first) - 4, y0 + 2.5, xOf(last) - xOf(first) + 8, laneH - 5);
    c.setLineDash([]);
  }
}

/// The sound, under the ruler: the document's envelope across its own length,
/// and the loop, while looping is on — which is what an export of it is.
function perfDrawSound(c, xOf, plotW, y, h, data) {
  c.fillStyle = '#0d1115';
  c.fillRect(PERF_GUTTER, y, plotW, h);
  c.fillStyle = '#4a6070';
  c.font = '9px "Share Tech Mono", monospace';
  c.textAlign = 'left';
  c.fillText('SOUND', 4, y + h / 2 + 3);
  if (typeof drawLaneWave === 'function') {
    c.save();
    c.beginPath();
    c.rect(PERF_GUTTER, y, plotW, h);
    c.clip();
    c.translate(PERF_GUTTER, y);
    drawLaneWave(c, (perfDuration() / data.duration) * plotW, h, perfFrames());
    c.restore();
  }
  if (state.loopOn && state.sel && state.sel.end > state.sel.start) {
    const sr = perfRate();
    const a = xOf(state.sel.start / sr), b = xOf(state.sel.end / sr);
    c.strokeStyle = '#7fff00';
    c.lineWidth = 1;
    c.strokeRect(a + 0.5, y + 1.5, Math.max(1, b - a - 1), h - 3);
    c.fillStyle = '#7fff00';
    c.font = '7px "Share Tech Mono", monospace';
    c.fillText('LOOP', a + 3, y + 8);
  }
}

/// What a point on the canvas is over, from the rects the last draw left: a
/// lane (`id`), or a group's heading (`group` alone).
function perfHitAt(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  return perfLaneHits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y < h.y1) || null;
}

/// Which lane a point on the canvas is in, from the rects the last draw left.
function perfLaneAt(canvas, clientX, clientY) {
  const hit = perfHitAt(canvas, clientX, clientY);
  return hit && hit.id ? hit.id : null;
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
  const seqN = perfSeqLanes().length;
  const visN = perfVisualLanes().length;
  const file = state.selectedFile?.name || state.selectedFile?.path?.split('/').pop() || '';
  if (lanes.length || seqN || visN) {
    name.textContent = file.replace(/\.[^.]+$/, '').toUpperCase() || 'TAKE';
    const points = lanes.reduce((n, l) => n + (l.points || []).length, 0);
    const live = lanes.filter((l) => l.enabled !== false && (l.points || []).length).length;
    info.textContent = `${perfDuration().toFixed(0)}s · ${lanes.length} LANES · ${live} LIVE · ${points} POINTS`
      + (state.automation?.bypassed ? ' · BYPASSED' : '')
      + (seqN ? ` · SEQ ${seqN}` : '')
      + (visN ? ` · VISUAL ${visN}` : '');
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
