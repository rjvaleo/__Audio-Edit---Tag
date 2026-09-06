// ─── PERFORMANCE CAPTURE / REPLAY / AUTOMATON ────────────────────────────────
// A performance = initial preset snapshot + timestamped gesture stream.
// Capture hooks the same input/change events the knobs and selects already
// fire; replay dispatches them back on the audio clock; the automaton learns
// gesture statistics from recorded takes and generates new streams.

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PERF_KEY = "scaleSeqPerfs";
const PERF_SLIDERS = [
  "bpmSlider",
  "stepsSlider",
  "atkSlider",
  "decSlider",
  "susSlider",
  "relSlider",
  "volSlider",
  "cutoffSlider",
  "resSlider",
  "keyFollowSlider",
  "fatkSlider",
  "fdecSlider",
  "fsusSlider",
  "frelSlider",
  "famtSlider",
  "lfo1RateSlider",
  "lfo1DepthSlider",
  "lfo2RateSlider",
  "lfo2DepthSlider",
  "lfo3RateSlider",
  "lfo3DepthSlider",
  "pwSlider",
  "delayFbSlider",
  "delayWetSlider",
  "delaySpreadSlider",
  "delayHiCutSlider",
];
const PERF_SELECTS = [
  "dirSelect",
  "stepLenSelect",
  "waveSelect",
  "rootSelect",
  "octaveSelect",
  "lfo1WaveSelect",
  "lfo1TargetSelect",
  "lfo2WaveSelect",
  "lfo2TargetSelect",
  "lfo3WaveSelect",
  "lfo3TargetSelect",
  "delayTimeSelect",
  "tapeSpeedSelect",
];
const PERF_SLIDER_SET = new Set(PERF_SLIDERS);
const PERF_SELECT_SET = new Set(PERF_SELECTS);
const GESTURE_GAP_S = 0.4; // raw events closer than this merge into one gesture
const MAX_GESTURE_POINTS = 24;
// Section split over normalized time, matching the analysis/ruler labels
const PERF_SECTIONS = [
  { name: "INTRO", a: 0.0, b: 0.15 },
  { name: "BUILD", a: 0.15, b: 0.5 },
  { name: "PEAK", a: 0.5, b: 0.85 },
  { name: "OUTRO", a: 0.85, b: 1.0 },
];
const SECTION_TINTS = [
  "rgba(0,229,255,0.045)",
  "rgba(127,255,0,0.045)",
  "rgba(255,107,53,0.055)",
  "rgba(0,229,255,0.03)",
];

// Lane colors follow module identity
function perfLaneColor(id) {
  if (id.startsWith("cutoff") || id.startsWith("res")) return "#00e5ff";
  if (id.startsWith("lfo1")) return "#ff6b35";
  if (id.startsWith("lfo2")) return "#00e5ff";
  if (id.startsWith("lfo3")) return "#a0ff60";
  if (id.startsWith("delay")) return "#7fff00";
  if (id.startsWith("bpm") || id.startsWith("steps")) return "#ff60b8";
  if (id.startsWith("f") || id.startsWith("keyFollow")) return "#ff6b35";
  return "#c8d8e0";
}
function perfLaneLabel(id) {
  return id
    .replace("Slider", "")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .toUpperCase();
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let perfRec = null; // {t0, events, discretes, raw:{id:[[t,v]]}, wasPlaying, snapshot, beat:{lastT,lastBpm,beats}}
let perfReplay = null; // {t0, timer, fired:Set, playheadT}
let perfLoaded = null; // currently loaded performance object
let perfVariation = 0.35;
let perfSelectedGesture = null; // index into perfLoaded.gestures
let perfSelRange = null; // {a, b} seconds, from ruler drag
let perfBrainOpen = false;
let perfDrawTimer = null;
let perfLaneHits = []; // hit rects rebuilt on each draw

// ─── STORAGE ─────────────────────────────────────────────────────────────────
function perfLoadAll() {
  try {
    return JSON.parse(localStorage.getItem(PERF_KEY) || "[]");
  } catch {
    return [];
  }
}
function perfSaveAll(list) {
  localStorage.setItem(PERF_KEY, JSON.stringify(list));
}
function perfPersistLoaded() {
  if (!perfLoaded) return;
  const list = perfLoadAll();
  const i = list.findIndex((p) => p.id === perfLoaded.id);
  if (i >= 0) list[i] = perfLoaded;
  perfSaveAll(list);
}
function perfRenderList() {
  const sel = document.getElementById("perfSelect");
  if (!sel) return;
  const current = perfLoaded ? perfLoaded.id : "";
  sel.innerHTML = '<option value="">— takes —</option>';
  perfLoadAll().forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

// ─── MUSICAL TIME ────────────────────────────────────────────────────────────
// Piecewise BPM map from the snapshot + any bpm gestures, so bars stay honest
// across tempo changes mid-take.
function perfBpmSegments(p) {
  const segs = [
    { t: 0, bpm: parseFloat((p.snapshot.sliders || {}).bpmSlider) || 120 },
  ];
  (p.gestures || [])
    .filter((g) => g.kind === "slider" && g.id === "bpmSlider")
    .forEach((g) => {
      segs.push({ t: g.points[g.points.length - 1][0], bpm: g.points[g.points.length - 1][1] });
    });
  segs.sort((a, b) => a.t - b.t);
  return segs;
}
function perfBarAt(p, t) {
  const segs = perfBpmSegments(p);
  let beats = 0;
  for (let i = 0; i < segs.length; i++) {
    const end = i + 1 < segs.length ? Math.min(segs[i + 1].t, t) : t;
    if (end > segs[i].t) beats += ((end - segs[i].t) * segs[i].bpm) / 60;
    if (i + 1 < segs.length && segs[i + 1].t >= t) break;
  }
  return beats / 4 + 1;
}
function perfTimeOfBar(p, bar) {
  // invert perfBarAt by walking segments
  const segs = perfBpmSegments(p);
  let beats = (bar - 1) * 4;
  for (let i = 0; i < segs.length; i++) {
    const segEnd = i + 1 < segs.length ? segs[i + 1].t : Infinity;
    const segBeats = ((segEnd - segs[i].t) * segs[i].bpm) / 60;
    if (beats <= segBeats || i === segs.length - 1)
      return segs[i].t + (beats * 60) / segs[i].bpm;
    beats -= segBeats;
  }
  return 0;
}

// ─── CAPTURE ─────────────────────────────────────────────────────────────────
function perfNow() {
  return audioCtx ? audioCtx.currentTime : performance.now() / 1000;
}

function perfToggleRec() {
  if (perfReplay) perfStop();
  if (perfRec) {
    perfRecStop();
  } else {
    perfRecStart();
  }
}

function perfRecStart() {
  initAudio();
  perfSelectedGesture = null;
  perfSelRange = null;
  perfRec = {
    t0: perfNow(),
    events: [],
    discretes: [],
    raw: {},
    wasPlaying: isPlaying,
    snapshot: getPresetState(),
  };
  const btn = document.getElementById("perfRecBtn");
  btn.textContent = "⏺ CAPTURING";
  btn.classList.add("recording");
  perfSetStatus("CAPTURING — EVERY KNOB MOVE, SWITCH, SCALE + STEP EDIT IS BEING RECORDED");
  perfStartDrawLoop();
}

function perfRecStop() {
  const rec = perfRec;
  perfRec = null;
  const btn = document.getElementById("perfRecBtn");
  btn.textContent = "⏺ REC PERF";
  btn.classList.remove("recording");
  perfStopDrawLoop();
  const duration = perfNow() - rec.t0;
  if (duration < 1 || (rec.events.length === 0 && rec.discretes.length === 0)) {
    perfSetStatus("CAPTURE DISCARDED — NOTHING RECORDED");
    perfDrawTimeline();
    return;
  }
  const gestures = perfCoalesce(rec).concat(
    rec.discretes.map((d) => ({ kind: "discrete", ...d, gen: false })),
  );
  gestures.sort((a, b) => (a.t0 ?? a.t) - (b.t0 ?? b.t));
  const perf = {
    id: `perf_${Date.now()}`,
    name: generatePresetName(),
    created: Date.now(),
    generated: false,
    duration,
    wasPlaying: rec.wasPlaying,
    snapshot: rec.snapshot,
    gestures,
  };
  const list = perfLoadAll();
  list.unshift(perf);
  perfSaveAll(list);
  perfLoaded = perf;
  perfRenderList();
  perfUpdateHeader();
  perfSetStatus(
    `SAVED — ${gestures.filter((g) => g.kind === "slider").length} GESTURES · ${gestures.filter((g) => g.kind === "discrete").length} STRUCT EVENTS · ${duration.toFixed(1)}s`,
  );
  perfDrawTimeline();
}

// group raw slider events into gestures
function perfCoalesce(rec) {
  const gestures = [];
  Object.entries(rec.raw).forEach(([id, pts]) => {
    let start = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i === pts.length || pts[i][0] - pts[i - 1][0] > GESTURE_GAP_S) {
        const seg = pts.slice(start, i);
        // downsample, always keeping first + last
        let points = seg;
        if (seg.length > MAX_GESTURE_POINTS) {
          const stride = Math.ceil(seg.length / MAX_GESTURE_POINTS);
          points = seg.filter(
            (_, k) => k % stride === 0 || k === seg.length - 1,
          );
        }
        gestures.push({
          kind: "slider",
          id,
          t0: points[0][0],
          t1: points[points.length - 1][0],
          points: points.map(([t, v]) => [
            +t.toFixed(3),
            +(+v).toFixed(2),
          ]),
          gen: false,
        });
        start = i;
      }
    }
  });
  return gestures;
}

// Document-level hooks: sliders fire input, selects fire change
document.addEventListener(
  "input",
  (e) => {
    if (!perfRec || !e.target || !PERF_SLIDER_SET.has(e.target.id)) return;
    const t = perfNow() - perfRec.t0;
    const v = parseFloat(e.target.value);
    (perfRec.raw[e.target.id] = perfRec.raw[e.target.id] || []).push([t, v]);
  },
  true,
);
document.addEventListener(
  "change",
  (e) => {
    if (!perfRec || !e.target || !PERF_SELECT_SET.has(e.target.id)) return;
    perfRec.discretes.push({
      t: perfNow() - perfRec.t0,
      type: "select",
      id: e.target.id,
      v: e.target.value,
    });
  },
  true,
);

// Wrap the non-DOM performance surfaces
(function () {
  const origSelectScale = window.selectScale;
  window.selectScale = function (idx) {
    origSelectScale(idx);
    if (perfRec)
      perfRec.discretes.push({ t: perfNow() - perfRec.t0, type: "scale", v: idx });
  };
  ["stepDegChange", "stepOctChange", "toggleRest"].forEach((fn) => {
    const orig = window[fn];
    window[fn] = function (i, delta) {
      orig(i, delta);
      if (perfRec)
        perfRec.discretes.push({
          t: perfNow() - perfRec.t0,
          type: "step",
          i,
          degree: steps[i].degree,
          rest: steps[i].rest,
        });
    };
  });
  const origTogglePlay = window.togglePlay;
  window.togglePlay = function () {
    origTogglePlay();
    if (perfRec)
      perfRec.discretes.push({
        t: perfNow() - perfRec.t0,
        type: isPlaying ? "play" : "pause",
      });
  };
  const origStopSeq = window.stopSeq;
  window.stopSeq = function () {
    origStopSeq();
    if (perfRec)
      perfRec.discretes.push({ t: perfNow() - perfRec.t0, type: "stop" });
  };
})();

// ─── REPLAY ──────────────────────────────────────────────────────────────────
function perfTogglePlay() {
  if (perfRec) return;
  if (perfReplay) {
    perfStop();
    return;
  }
  if (!perfLoaded) {
    perfSetStatus("NO TAKE LOADED — RECORD ONE OR PICK FROM THE LIST");
    return;
  }
  initAudio();
  const p = perfLoaded;
  applyPresetState(p.snapshot);
  if (p.wasPlaying && !isPlaying) togglePlay();
  p.gestures.forEach((g) => delete g._fired);
  perfReplay = { t0: perfNow(), playheadT: 0 };
  perfReplay.timer = setInterval(perfReplayTick, 25);
  const btn = document.getElementById("perfPlayBtn");
  btn.textContent = "⏸ PLAYING";
  btn.classList.add("active");
  perfSetStatus("REPLAY — THE RECORDED HANDS ARE ON THE KNOBS");
  perfStartDrawLoop();
}

function perfReplayTick() {
  const p = perfLoaded;
  if (!p || !perfReplay) return;
  const tNow = perfNow() - perfReplay.t0;
  perfReplay.playheadT = tNow;
  p.gestures.forEach((g) => {
    if (g.kind === "slider") {
      if (g._fired || tNow < g.t0) return;
      const el = document.getElementById(g.id);
      if (!el) {
        g._fired = true;
        return;
      }
      const v = perfInterp(g.points, Math.min(tNow, g.t1));
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (window.updateKnobVisual) window.updateKnobVisual(g.id);
      if (tNow >= g.t1) g._fired = true;
    } else if (!g._fired && tNow >= g.t) {
      g._fired = true;
      perfApplyDiscrete(g);
    }
  });
  const bar = perfBarAt(p, Math.min(tNow, p.duration));
  document.getElementById("perfPos").textContent =
    `${String(Math.floor(bar)).padStart(2, "0")} · ${String(Math.floor(((bar % 1) * 4) + 1)).padStart(2, "0")}`;
  if (tNow >= p.duration) perfStop();
}

function perfInterp(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) {
      const [ta, va] = points[i - 1];
      const [tb, vb] = points[i];
      const f = tb > ta ? (t - ta) / (tb - ta) : 1;
      return va + (vb - va) * f;
    }
  }
  return points[points.length - 1][1];
}

function perfApplyDiscrete(g) {
  if (g.type === "select") {
    const el = document.getElementById(g.id);
    if (el) {
      el.value = g.v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else if (g.type === "scale") {
    selectScale(g.v);
  } else if (g.type === "step") {
    if (steps[g.i]) {
      steps[g.i].degree = g.degree;
      steps[g.i].rest = g.rest;
      renderStepGrid();
    }
  } else if (g.type === "play") {
    if (!isPlaying) togglePlay();
  } else if (g.type === "pause" || g.type === "stop") {
    if (isPlaying) togglePlay();
  }
}

function perfStop() {
  if (perfRec) {
    perfRecStop();
    return;
  }
  if (perfReplay) {
    clearInterval(perfReplay.timer);
    perfReplay = null;
    const btn = document.getElementById("perfPlayBtn");
    btn.textContent = "▶ PLAY PERF";
    btn.classList.remove("active");
    perfSetStatus("REPLAY STOPPED");
  }
  perfStopDrawLoop();
  perfDrawTimeline();
}

function perfLoad(id) {
  if (perfRec) return;
  if (perfReplay) perfStop();
  perfSelectedGesture = null;
  perfSelRange = null;
  perfLoaded = perfLoadAll().find((p) => p.id === id) || null;
  perfUpdateHeader();
  perfUpdateSelInfo();
  perfDrawTimeline();
}

function perfDeleteSelected() {
  const sel = document.getElementById("perfSelect");
  if (!sel || !sel.value) return;
  perfSaveAll(perfLoadAll().filter((p) => p.id !== sel.value));
  if (perfLoaded && perfLoaded.id === sel.value) perfLoaded = null;
  perfSelectedGesture = null;
  perfRenderList();
  perfUpdateHeader();
  perfDrawTimeline();
}

// ─── ANALYSIS ────────────────────────────────────────────────────────────────
function perfSectionIdx(norm) {
  for (let i = 0; i < PERF_SECTIONS.length; i++)
    if (norm <= PERF_SECTIONS[i].b) return i;
  return PERF_SECTIONS.length - 1;
}

function perfBuildModel() {
  const takes = perfLoadAll().filter((p) => !p.generated);
  if (!takes.length) return null;
  const model = {
    takeCount: takes.length,
    durations: takes.map((p) => p.duration),
    byId: {},
    gaps: [],
    markov: {},
    density: [0, 0, 0, 0],
    structs: [],
    gestureCount: 0,
  };
  takes.forEach((p) => {
    const sliders = p.gestures
      .filter((g) => g.kind === "slider")
      .sort((a, b) => a.t0 - b.t0);
    model.gestureCount += sliders.length;
    let lastOnset = null;
    let lastId = null;
    sliders.forEach((g) => {
      const m = (model.byId[g.id] = model.byId[g.id] || {
        count: 0,
        deltas: [],
        durs: [],
        minV: Infinity,
        maxV: -Infinity,
        dirBySection: [0, 0, 0, 0],
      });
      const v0 = g.points[0][1];
      const v1 = g.points[g.points.length - 1][1];
      m.count++;
      m.deltas.push(v1 - v0);
      m.durs.push(Math.max(0.05, g.t1 - g.t0));
      m.minV = Math.min(m.minV, v0, v1);
      m.maxV = Math.max(m.maxV, v0, v1);
      const sec = perfSectionIdx(g.t0 / p.duration);
      m.dirBySection[sec] += Math.sign(v1 - v0);
      model.density[sec]++;
      if (lastOnset !== null) model.gaps.push(g.t0 - lastOnset);
      if (lastId) {
        const row = (model.markov[lastId] = model.markov[lastId] || {});
        row[g.id] = (row[g.id] || 0) + 1;
      }
      lastOnset = g.t0;
      lastId = g.id;
    });
    p.gestures
      .filter((g) => g.kind === "discrete" && (g.type === "select" || g.type === "scale"))
      .forEach((g) =>
        model.structs.push({ type: g.type, id: g.id, v: g.v, norm: g.t / p.duration }),
      );
  });
  return model;
}

function perfSample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function perfMedian(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function perfJitter(v, amount) {
  return v * (1 + (Math.random() * 2 - 1) * amount);
}

// ─── GENERATOR ───────────────────────────────────────────────────────────────
function updatePerfVar() {
  perfVariation =
    parseInt(document.getElementById("perfVarSlider").value) / 100;
  document.getElementById("perfVarVal").textContent =
    Math.round(perfVariation * 100) + "%";
}

function perfGenerate() {
  if (perfRec) return;
  if (perfReplay) perfStop();
  const model = perfBuildModel();
  if (!model) {
    perfSetStatus("NOTHING TO LEARN FROM YET — RECORD A TAKE FIRST");
    return;
  }
  const duration = perfMedian(model.durations);
  const gestures = perfGenerateWindow(model, 0, duration, duration, null);
  const perf = {
    id: `perf_${Date.now()}`,
    name: "◌ " + generatePresetName(),
    created: Date.now(),
    generated: true,
    duration,
    wasPlaying: true,
    snapshot: getPresetState(),
    gestures,
  };
  const list = perfLoadAll();
  list.unshift(perf);
  perfSaveAll(list);
  perfLoaded = perf;
  perfSelectedGesture = null;
  perfSelRange = null;
  perfRenderList();
  perfUpdateHeader();
  perfSetStatus(
    `GENERATED FROM ${model.takeCount} TAKE${model.takeCount > 1 ? "S" : ""} · ${gestures.filter((g) => g.kind === "slider").length} GESTURES · VARIATION ${Math.round(perfVariation * 100)}% — DASHED = MACHINE`,
  );
  perfDrawTimeline();
  if (perfBrainOpen) perfDrawBrain();
}

// Generate gestures inside [tA, tB) of a performance of length `total`.
// `seedState` maps slider id -> value at tA (null = read the live UI).
function perfGenerateWindow(model, tA, tB, total, seedState) {
  const gestures = [];
  const state = {};
  Object.keys(model.byId).forEach((id) => {
    const el = document.getElementById(id);
    state[id] =
      seedState && seedState[id] !== undefined
        ? seedState[id]
        : el
          ? parseFloat(el.value)
          : (model.byId[id].minV + model.byId[id].maxV) / 2;
  });
  const ids = Object.keys(model.byId);
  const meanDensity =
    model.density.reduce((a, b) => a + b, 0) / model.density.length || 1;
  let t = tA;
  let lastId = null;
  while (true) {
    const sec = perfSectionIdx(t / total);
    const densityScale = meanDensity / Math.max(0.5, model.density[sec]);
    const gap = Math.max(
      0.15,
      perfJitter(perfSample(model.gaps) * densityScale, perfVariation),
    );
    t += gap;
    if (t >= tB) break;
    // pick next control: markov chain, with `variation` odds of a free pick
    let id;
    const row = lastId && model.markov[lastId];
    if (row && Math.random() > perfVariation) {
      const entries = Object.entries(row);
      const totalW = entries.reduce((a, [, w]) => a + w, 0);
      let r = Math.random() * totalW;
      id = entries.find(([, w]) => (r -= w) <= 0)?.[0] || perfSample(ids);
    } else {
      id = perfSample(ids);
    }
    const m = model.byId[id];
    const dur = Math.max(0.08, perfJitter(perfSample(m.durs), perfVariation));
    let delta = perfJitter(perfSample(m.deltas), perfVariation * 0.8);
    // bias direction toward this section's learned tendency
    const bias = m.dirBySection[perfSectionIdx(t / total)];
    if (bias !== 0 && Math.sign(delta) !== Math.sign(bias) && Math.random() < 0.4)
      delta = -delta;
    const v0 = state[id];
    const v1 = Math.min(m.maxV, Math.max(m.minV, v0 + delta));
    // ease-in-out curve
    const points = [];
    const N = 8;
    for (let k = 0; k <= N; k++) {
      const f = k / N;
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      points.push([+(t + f * dur).toFixed(3), +(v0 + (v1 - v0) * e).toFixed(2)]);
    }
    gestures.push({
      kind: "slider",
      id,
      t0: t,
      t1: t + dur,
      points,
      gen: true,
    });
    state[id] = v1;
    lastId = id;
    t += dur;
  }
  // structural moves land where they landed in the takes, sometimes
  model.structs.forEach((s) => {
    const st = s.norm * total;
    if (st < tA || st >= tB) return;
    if (Math.random() < 0.5)
      gestures.push({
        kind: "discrete",
        t: +perfJitter(st, 0.05).toFixed(3),
        type: s.type,
        id: s.id,
        v: s.v,
        gen: true,
      });
  });
  gestures.sort((a, b) => (a.t0 ?? a.t) - (b.t0 ?? b.t));
  return gestures;
}

// ─── EDITING ─────────────────────────────────────────────────────────────────
function perfValueAtTime(p, id, t) {
  // value of slider `id` at time t, walking snapshot + gestures before t
  let v = parseFloat((p.snapshot.sliders || {})[id]);
  p.gestures
    .filter((g) => g.kind === "slider" && g.id === id && g.t0 < t)
    .sort((a, b) => a.t0 - b.t0)
    .forEach((g) => {
      v = g.points[g.points.length - 1][1];
    });
  return isNaN(v) ? 50 : v;
}

function perfReroll() {
  if (!perfLoaded || !perfSelRange) return;
  const model = perfBuildModel();
  if (!model) {
    perfSetStatus("NOTHING TO LEARN FROM YET — RECORD A TAKE FIRST");
    return;
  }
  const { a, b } = perfSelRange;
  const seed = {};
  Object.keys(model.byId).forEach((id) => {
    seed[id] = perfValueAtTime(perfLoaded, id, a);
  });
  perfLoaded.gestures = perfLoaded.gestures.filter((g) => {
    const t = g.t0 ?? g.t;
    return t < a || t >= b;
  });
  const fresh = perfGenerateWindow(model, a, b, perfLoaded.duration, seed);
  perfLoaded.gestures = perfLoaded.gestures.concat(fresh);
  perfLoaded.gestures.sort((x, y) => (x.t0 ?? x.t) - (y.t0 ?? y.t));
  perfPersistLoaded();
  perfSelectedGesture = null;
  perfSelRange = null;
  perfUpdateSelInfo();
  perfSetStatus(`REROLLED — ${fresh.length} NEW GESTURES IN THE REGION (DASHED)`);
  perfDrawTimeline();
}

function perfKeepGesture() {
  if (!perfLoaded || perfSelectedGesture === null) return;
  perfLoaded.gestures[perfSelectedGesture].gen = false;
  perfPersistLoaded();
  perfUpdateSelInfo();
  perfDrawTimeline();
}

function perfCutGesture() {
  if (!perfLoaded || perfSelectedGesture === null) return;
  perfLoaded.gestures.splice(perfSelectedGesture, 1);
  perfSelectedGesture = null;
  perfPersistLoaded();
  perfUpdateSelInfo();
  perfDrawTimeline();
}

function perfUpdateSelInfo() {
  const info = document.getElementById("perfSelInfo");
  const keep = document.getElementById("perfKeepBtn");
  const cut = document.getElementById("perfCutBtn");
  const reroll = document.getElementById("perfRerollBtn");
  reroll.style.display = perfSelRange && perfLoaded ? "" : "none";
  if (perfSelRange && perfLoaded) {
    reroll.textContent = `◌ REROLL ${Math.floor(perfBarAt(perfLoaded, perfSelRange.a))}–${Math.floor(perfBarAt(perfLoaded, perfSelRange.b))}`;
  }
  if (!perfLoaded || perfSelectedGesture === null) {
    info.textContent = "";
    keep.style.display = "none";
    cut.style.display = "none";
    return;
  }
  const g = perfLoaded.gestures[perfSelectedGesture];
  if (!g) return;
  if (g.kind === "slider") {
    info.textContent = `${perfLaneLabel(g.id)} · BAR ${Math.floor(perfBarAt(perfLoaded, g.t0))} · ${(g.t1 - g.t0).toFixed(1)}s${g.gen ? " · GEN" : ""}`;
  } else {
    info.textContent = `${g.type.toUpperCase()} · BAR ${Math.floor(perfBarAt(perfLoaded, g.t))}${g.gen ? " · GEN" : ""}`;
  }
  keep.style.display = g.gen ? "" : "none";
  cut.style.display = "";
}

// ─── TIMELINE CANVAS ─────────────────────────────────────────────────────────
const PERF_GUTTER = 92;
const PERF_RULER_H = 18;
const PERF_LANE_H = 34; // natural lane height; compresses when user resizes
const PERF_MIN_LANE_H = 14;
const PERF_STRUCT_H = 22;
const PERF_MAX_LANES = 6;
const PERF_H_KEY = "scaleSeqPerfH";
let perfTimelineH = parseInt(localStorage.getItem(PERF_H_KEY)) || 0; // 0 = auto

function perfTimelineData() {
  // returns {duration, laneIds, gestures, discretes, live}
  if (perfRec) {
    const laneIds = Object.keys(perfRec.raw).slice(0, PERF_MAX_LANES);
    return {
      live: true,
      duration: Math.max(8, perfNow() - perfRec.t0),
      laneIds,
      raw: perfRec.raw,
      discretes: perfRec.discretes,
      perf: null,
    };
  }
  if (perfLoaded) {
    const seen = [];
    perfLoaded.gestures.forEach((g) => {
      if (g.kind === "slider" && !seen.includes(g.id)) seen.push(g.id);
    });
    return {
      live: false,
      duration: perfLoaded.duration,
      laneIds: seen.slice(0, PERF_MAX_LANES),
      perf: perfLoaded,
    };
  }
  return null;
}

function perfDrawTimeline() {
  const canvas = document.getElementById("perfCanvas");
  if (!canvas) return;
  const data = perfTimelineData();
  const nLanes = data ? Math.max(1, data.laneIds.length) : 1;
  const cssW = canvas.offsetWidth;
  // lane height compresses to honor a user-set panel height
  let laneH = PERF_LANE_H;
  if (perfTimelineH > 0) {
    laneH = Math.max(
      PERF_MIN_LANE_H,
      Math.min(
        PERF_LANE_H,
        (perfTimelineH - PERF_RULER_H - PERF_STRUCT_H - 6) / nLanes,
      ),
    );
  }
  const H = Math.round(PERF_RULER_H + nLanes * laneH + PERF_STRUCT_H + 6);
  if (cssW > 0 && canvas.width !== cssW) canvas.width = cssW;
  if (canvas.height !== H) canvas.height = H;
  const W = canvas.width;
  const c = canvas.getContext("2d");
  c.fillStyle = "#0a0c0e";
  c.fillRect(0, 0, W, H);
  perfLaneHits = [];
  if (!data) {
    c.fillStyle = "#2a3540";
    c.font = "10px monospace";
    c.textAlign = "center";
    c.fillText("NO TAKE — ⏺ REC PERF WHILE THE SEQUENCER PLAYS, THEN PERFORM", W / 2, H / 2);
    return;
  }
  const plotW = W - PERF_GUTTER - 8;
  const xOf = (t) => PERF_GUTTER + (t / data.duration) * plotW;

  // Ruler: section tints (only on analyzed/loaded takes) + bar ticks
  c.fillStyle = "#0d1115";
  c.fillRect(PERF_GUTTER, 0, plotW, PERF_RULER_H);
  if (!data.live) {
    PERF_SECTIONS.forEach((s, i) => {
      c.fillStyle = SECTION_TINTS[i];
      c.fillRect(
        xOf(s.a * data.duration),
        0,
        ((s.b - s.a) * data.duration * plotW) / data.duration,
        PERF_RULER_H,
      );
      c.fillStyle = "#4a6070";
      c.font = "8px monospace";
      c.textAlign = "center";
      c.fillText(s.name, xOf(((s.a + s.b) / 2) * data.duration), 12);
    });
  }
  const barSrc = data.perf || { snapshot: { sliders: { bpmSlider: bpm } }, gestures: [] };
  const totalBars = perfBarAt(barSrc, data.duration);
  const barStep = totalBars > 48 ? 8 : totalBars > 24 ? 4 : 2;
  c.strokeStyle = "#1e2830";
  c.fillStyle = "#2a3540";
  c.font = "7px monospace";
  c.textAlign = "left";
  for (let bNum = 1; bNum <= totalBars; bNum += barStep) {
    const x = xOf(perfTimeOfBar(barSrc, bNum));
    c.beginPath();
    c.moveTo(x, PERF_RULER_H - 5);
    c.lineTo(x, H - 4);
    c.stroke();
    if (data.live) c.fillText(bNum, x + 2, PERF_RULER_H - 7);
  }

  // Reroll selection overlay
  if (perfSelRange && !data.live) {
    c.fillStyle = "rgba(0,229,255,0.08)";
    c.fillRect(
      xOf(perfSelRange.a),
      0,
      xOf(perfSelRange.b) - xOf(perfSelRange.a),
      H - 4,
    );
    c.strokeStyle = "rgba(0,229,255,0.5)";
    c.setLineDash([3, 3]);
    c.strokeRect(
      xOf(perfSelRange.a),
      0.5,
      xOf(perfSelRange.b) - xOf(perfSelRange.a),
      H - 5,
    );
    c.setLineDash([]);
  }

  // Lanes
  data.laneIds.forEach((id, li) => {
    const y0 = PERF_RULER_H + li * laneH;
    c.strokeStyle = "#1e2830";
    c.strokeRect(PERF_GUTTER + 0.5, y0 + 1.5, plotW - 1, laneH - 3);
    const color = perfLaneColor(id);
    c.fillStyle = color;
    c.font = "9px monospace";
    c.textAlign = "left";
    c.fillText(perfLaneLabel(id), 4, y0 + laneH / 2 + 3);
    const el = document.getElementById(id);
    const vMin = el ? parseFloat(el.min) : 0;
    const vMax = el ? parseFloat(el.max) : 100;
    const yOf = (v) =>
      y0 + laneH - 5 - ((v - vMin) / (vMax - vMin)) * (laneH - 9);
    const drawPts = (pts, dashed, bold) => {
      if (pts.length < 1) return;
      c.beginPath();
      pts.forEach(([t, v], k) => {
        const x = xOf(t);
        if (k === 0) c.moveTo(x, yOf(v));
        else c.lineTo(x, yOf(v));
      });
      c.setLineDash(dashed ? [4, 3] : []);
      c.strokeStyle = color;
      c.lineWidth = bold ? 2.5 : 1.5;
      c.globalAlpha = dashed ? 0.85 : 1;
      c.stroke();
      c.globalAlpha = 1;
      c.setLineDash([]);
      c.lineWidth = 1;
    };
    if (data.live) {
      drawPts(data.raw[id], false, false);
    } else {
      data.perf.gestures.forEach((g, gi) => {
        if (g.kind !== "slider" || g.id !== id) return;
        drawPts(g.points, g.gen, gi === perfSelectedGesture);
        perfLaneHits.push({
          gi,
          x0: xOf(g.t0) - 4,
          x1: xOf(g.t1) + 4,
          y0,
          y1: y0 + laneH,
        });
        if (gi === perfSelectedGesture) {
          c.strokeStyle = "rgba(200,216,224,0.6)";
          c.setLineDash([3, 3]);
          c.strokeRect(xOf(g.t0) - 4, y0 + 2.5, xOf(g.t1) - xOf(g.t0) + 8, laneH - 5);
          c.setLineDash([]);
        }
      });
    }
  });

  // Struct lane
  const sy = PERF_RULER_H + data.laneIds.length * laneH;
  c.strokeStyle = "#1e2830";
  c.strokeRect(PERF_GUTTER + 0.5, sy + 1.5, plotW - 1, PERF_STRUCT_H - 3);
  c.fillStyle = "#ff60b8";
  c.font = "9px monospace";
  c.fillText("STRUCT", 4, sy + PERF_STRUCT_H / 2 + 3);
  const discretes = data.live
    ? data.discretes
    : data.perf.gestures.filter((g) => g.kind === "discrete");
  c.font = "8px monospace";
  discretes.forEach((d, di) => {
    const x = xOf(d.t);
    c.strokeStyle = "#ff60b8";
    c.globalAlpha = d.gen ? 0.7 : 1;
    c.beginPath();
    c.moveTo(x, sy + 2);
    c.lineTo(x, sy + PERF_STRUCT_H - 2);
    c.stroke();
    let label =
      d.type === "select"
        ? `${d.id.replace("Select", "").toUpperCase()}→${String(d.v).toUpperCase().slice(0, 6)}`
        : d.type === "scale"
          ? "SCALE"
          : d.type.toUpperCase();
    if (d.gen) label += "·G";
    c.fillStyle = "#ff60b8";
    c.fillText(label, x + 3, sy + PERF_STRUCT_H / 2 + 3);
    c.globalAlpha = 1;
    if (!data.live) {
      const gi = data.perf.gestures.indexOf(d);
      perfLaneHits.push({ gi, x0: x - 4, x1: x + 40, y0: sy, y1: sy + PERF_STRUCT_H });
    }
  });

  // Playhead / write head
  let headT = null;
  let headColor = "#ff6b35";
  if (perfReplay) headT = perfReplay.playheadT;
  if (data.live) {
    headT = perfNow() - perfRec.t0;
    headColor = "#ff3333";
  }
  if (headT !== null) {
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
}

function perfStartDrawLoop() {
  if (perfDrawTimer) return;
  perfDrawTimer = setInterval(perfDrawTimeline, 66);
}
function perfStopDrawLoop() {
  clearInterval(perfDrawTimer);
  perfDrawTimer = null;
}

// Canvas interaction: click selects a gesture; drag on the ruler selects a
// bar range for reroll.
(function () {
  let rulerDrag = null;
  function canvasT(e, canvas) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const data = perfTimelineData();
    if (!data) return null;
    const plotW = canvas.width - PERF_GUTTER - 8;
    return Math.max(0, Math.min(data.duration, ((x - PERF_GUTTER) / plotW) * data.duration));
  }
  document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("perfCanvas");
    if (!canvas) return;
    canvas.addEventListener("mousedown", (e) => {
      if (perfRec || !perfLoaded) return;
      const r = canvas.getBoundingClientRect();
      const y = e.clientY - r.top;
      if (y <= PERF_RULER_H) {
        rulerDrag = canvasT(e, canvas);
        perfSelRange = null;
      }
    });
    canvas.addEventListener("mousemove", (e) => {
      if (rulerDrag === null) return;
      const t = canvasT(e, canvas);
      if (t === null) return;
      perfSelRange = { a: Math.min(rulerDrag, t), b: Math.max(rulerDrag, t) };
      perfUpdateSelInfo();
      perfDrawTimeline();
    });
    document.addEventListener("mouseup", () => {
      if (rulerDrag !== null) {
        rulerDrag = null;
        if (perfSelRange && perfSelRange.b - perfSelRange.a < 0.2) {
          perfSelRange = null;
          perfUpdateSelInfo();
          perfDrawTimeline();
        }
      }
    });
    canvas.addEventListener("click", (e) => {
      if (perfRec || !perfLoaded) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (y <= PERF_RULER_H) return;
      const hit = perfLaneHits.find(
        (h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1,
      );
      perfSelectedGesture = hit ? hit.gi : null;
      perfUpdateSelInfo();
      perfDrawTimeline();
    });
  });
})();

// ─── BRAIN PANEL ─────────────────────────────────────────────────────────────
function perfToggleBrain() {
  perfBrainOpen = !perfBrainOpen;
  document.getElementById("perfBrain").style.display = perfBrainOpen
    ? "flex"
    : "none";
  document
    .getElementById("perfBrainBtn")
    .classList.toggle("active", perfBrainOpen);
  if (perfBrainOpen) perfDrawBrain();
}

function perfBrainPanel(canvasId, title) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const cssW = canvas.offsetWidth;
  if (cssW > 0 && canvas.width !== cssW) canvas.width = cssW;
  const c = canvas.getContext("2d");
  c.fillStyle = "#0a0c0e";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#4a6070";
  c.font = "8px monospace";
  c.textAlign = "left";
  c.fillText(title, 6, 11);
  return { c, W: canvas.width, H: canvas.height };
}

function perfDrawBrain() {
  const model = perfBuildModel();
  const empty = (p) => {
    p.c.fillStyle = "#2a3540";
    p.c.textAlign = "center";
    p.c.fillText("NO RECORDED TAKES YET", p.W / 2, p.H / 2 + 8);
  };

  // FORM: activity density over normalized time
  let p = perfBrainPanel("brainFormCanvas", "FORM — ACTIVITY ARC");
  if (p) {
    if (!model) empty(p);
    else {
      const bins = new Array(8).fill(0);
      perfLoadAll()
        .filter((x) => !x.generated)
        .forEach((take) =>
          take.gestures.forEach((g) => {
            if (g.kind !== "slider") return;
            bins[Math.min(7, Math.floor((g.t0 / take.duration) * 8))]++;
          }),
        );
      const maxB = Math.max(...bins, 1);
      p.c.beginPath();
      const px = (i) => 8 + (i / 7) * (p.W - 16);
      const py = (v) => p.H - 14 - (v / maxB) * (p.H - 34);
      bins.forEach((v, i) => (i === 0 ? p.c.moveTo(px(i), py(v)) : p.c.lineTo(px(i), py(v))));
      p.c.strokeStyle = "#00e5ff";
      p.c.lineWidth = 1.5;
      p.c.stroke();
      p.c.lineTo(px(7), p.H - 12);
      p.c.lineTo(px(0), p.H - 12);
      p.c.closePath();
      p.c.fillStyle = "rgba(0,229,255,0.07)";
      p.c.fill();
      p.c.fillStyle = "#4a6070";
      p.c.textAlign = "center";
      PERF_SECTIONS.forEach((s) => {
        p.c.fillText(s.name, 8 + ((s.a + s.b) / 2) * (p.W - 16), p.H - 3);
      });
    }
  }

  // TRANSITIONS heatmap
  p = perfBrainPanel("brainTransCanvas", "TRANSITIONS — X THEN Y");
  if (p) {
    if (!model) empty(p);
    else {
      const ids = Object.keys(model.byId)
        .sort((a, b) => model.byId[b].count - model.byId[a].count)
        .slice(0, 6);
      const cell = Math.min(
        (p.W - 60) / Math.max(1, ids.length),
        (p.H - 34) / Math.max(1, ids.length),
      );
      let maxW = 1;
      ids.forEach((a) =>
        ids.forEach((b) => {
          maxW = Math.max(maxW, (model.markov[a] || {})[b] || 0);
        }),
      );
      ids.forEach((a, i) => {
        p.c.fillStyle = "#4a6070";
        p.c.font = "7px monospace";
        p.c.textAlign = "right";
        p.c.fillText(perfLaneLabel(a).slice(0, 6), 52, 26 + i * cell + cell / 2 + 2);
        ids.forEach((b, j) => {
          const w = (model.markov[a] || {})[b] || 0;
          p.c.fillStyle = `rgba(0,229,255,${0.04 + (w / maxW) * 0.6})`;
          p.c.fillRect(56 + j * cell, 20 + i * cell, cell - 1, cell - 1);
        });
      });
    }
  }

  // TIMING histogram of inter-gesture gaps
  p = perfBrainPanel("brainTimingCanvas", "ACTION TIMING — GAPS");
  if (p) {
    if (!model || !model.gaps.length) {
      if (p) empty(p);
    } else {
      const maxGap = Math.max(...model.gaps);
      const nBins = 12;
      const bins = new Array(nBins).fill(0);
      model.gaps.forEach((g) =>
        bins[Math.min(nBins - 1, Math.floor((g / maxGap) * nBins))]++,
      );
      const maxB = Math.max(...bins, 1);
      const bw = (p.W - 16) / nBins;
      bins.forEach((v, i) => {
        const h = (v / maxB) * (p.H - 36);
        p.c.fillStyle = "rgba(0,229,255,0.55)";
        p.c.fillRect(8 + i * bw, p.H - 14 - h, bw - 2, h);
      });
      p.c.fillStyle = "#4a6070";
      p.c.textAlign = "left";
      p.c.fillText(`MEDIAN ${perfMedian(model.gaps).toFixed(1)}s`, 8, p.H - 3);
      p.c.textAlign = "right";
      p.c.fillText(`MAX ${maxGap.toFixed(1)}s`, p.W - 8, p.H - 3);
    }
  }

  // RANGE guardrails
  p = perfBrainPanel("brainRangeCanvas", "RANGE — WHERE YOU PLAY");
  if (p) {
    if (!model) empty(p);
    else {
      const ids = Object.keys(model.byId)
        .sort((a, b) => model.byId[b].count - model.byId[a].count)
        .slice(0, 3);
      const n = ids.length;
      ids.forEach((id, i) => {
        const cx = (p.W / (n + 1)) * (i + 1);
        const cy = p.H / 2 + 2;
        const r = 16;
        const el = document.getElementById(id);
        const vMin = el ? parseFloat(el.min) : 0;
        const vMax = el ? parseFloat(el.max) : 100;
        const m = model.byId[id];
        const a0 = 0.75 * Math.PI;
        const span = 1.5 * Math.PI;
        const norm = (v) => (v - vMin) / (vMax - vMin);
        p.c.beginPath();
        p.c.arc(cx, cy, r, a0, a0 + span);
        p.c.strokeStyle = "#2a3540";
        p.c.lineWidth = 3;
        p.c.stroke();
        p.c.beginPath();
        p.c.arc(cx, cy, r, a0 + norm(m.minV) * span, a0 + norm(m.maxV) * span);
        p.c.strokeStyle = perfLaneColor(id);
        p.c.stroke();
        p.c.lineWidth = 1;
        p.c.fillStyle = "#4a6070";
        p.c.font = "7px monospace";
        p.c.textAlign = "center";
        p.c.fillText(perfLaneLabel(id).slice(0, 10), cx, cy + r + 12);
        p.c.fillStyle = perfLaneColor(id);
        p.c.fillText(
          `${Math.round(m.minV)}–${Math.round(m.maxV)}`,
          cx,
          cy + r + 21,
        );
      });
    }
  }
}

// ─── UI PLUMBING ─────────────────────────────────────────────────────────────
function perfSetStatus(msg) {
  const el = document.getElementById("perfStatus");
  if (el) el.textContent = msg;
}
function perfUpdateHeader() {
  const name = document.getElementById("perfName");
  const info = document.getElementById("perfHeaderInfo");
  if (perfLoaded) {
    name.textContent = perfLoaded.name.toUpperCase();
    const bars = Math.floor(perfBarAt(perfLoaded, perfLoaded.duration));
    info.textContent = `${bars} BARS · ${perfLoaded.duration.toFixed(0)}s · ${perfLoaded.gestures.filter((g) => g.kind === "slider").length} GESTURES${perfLoaded.generated ? " · GENERATED" : ""}`;
  } else {
    name.textContent = "NO TAKE";
    info.textContent = "—";
  }
}
function perfResizeReset() {
  perfTimelineH = 0;
  localStorage.removeItem(PERF_H_KEY);
  perfDrawTimeline();
}

// Sequencer note window: drag the splitter under the step grid to fix its
// height (persisted); double-click resets to the default flexible fill.
const SEQ_H_KEY = "scaleSeqSeqH";
function seqApplyHeight(h) {
  const el = document.querySelector(".seq-panel");
  if (!el) return;
  el.style.flex = h > 0 ? `0 0 ${h}px` : "";
}
function seqResizeStart(e) {
  e.preventDefault();
  const el = document.querySelector(".seq-panel");
  if (!el) return;
  const startY = e.clientY;
  const startH = el.offsetHeight;
  function onMove(ev) {
    const h = Math.max(48, Math.min(900, startH + (ev.clientY - startY)));
    seqApplyHeight(h);
    localStorage.setItem(SEQ_H_KEY, h);
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
function seqResizeReset() {
  localStorage.removeItem(SEQ_H_KEY);
  seqApplyHeight(0);
}
seqApplyHeight(parseInt(localStorage.getItem(SEQ_H_KEY)) || 0);

function perfResizeStart(e) {
  e.preventDefault();
  const canvas = document.getElementById("perfCanvas");
  const startY = e.clientY;
  const startH = canvas.height;
  function onMove(ev) {
    perfTimelineH = Math.max(
      PERF_RULER_H + PERF_STRUCT_H + PERF_MIN_LANE_H + 6,
      Math.min(420, startH + (ev.clientY - startY)),
    );
    localStorage.setItem(PERF_H_KEY, Math.round(perfTimelineH));
    perfDrawTimeline();
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function perfToggleCollapse() {
  const body = document.getElementById("perfBody");
  const open = body.style.display === "none";
  body.style.display = open ? "" : "none";
  document.getElementById("perfCollapseIcon").textContent = open ? "▾" : "▸";
  if (open) perfDrawTimeline();
}

// ─── INIT ────────────────────────────────────────────────────────────────────
perfRenderList();
updatePerfVar();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", perfDrawTimeline);
} else {
  perfDrawTimeline();
}
window.addEventListener("resize", perfDrawTimeline);
