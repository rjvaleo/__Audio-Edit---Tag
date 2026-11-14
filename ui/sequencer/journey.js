// The Journey (ours, not the sequencer repository's; 14 Nov 2026, the plan
// `WORK DIR/page-mockups/SEQ-JOURNEY-PLAN.md` §2 and the mock-up
// `seq-journey.html`). RJ: "so that it can go off on a little journey".
//
// Over a length of 16, 32, 64 or 128 bars the pattern wanders and, with Come
// home on, is back where it started at the end. How far it has gone follows a
// curve over the four sections the Performance brain uses (Intro, Build, Peak,
// Outro), which can be dragged.
//
// **Worked out, not rolled.** A trip is a list of moves planned once from the
// seed: change step 5's degree by +2, rest step 11, move the root up a fifth,
// play the scale's neighbour in its family. Where the trip is, the curve says
// how many of them are in force: the first N, so moves pile up as the curve
// rises and come off in the reverse order as it falls, and at its end the
// pattern is the one written. Everything comes from the seed and the step
// boundary (`seqStepCount`, app.js), never from when the note happened to be
// played: the same seed gives the same trip, a seek lands where the trip would
// be, and the film and the sound export (bridge.js, offline) play the trip that
// was heard.
//
// The page reads a step through `journeyStep(k, i)`: the step as written while
// the Journey is off, and as moved while it is on.

// ─── THE CONTROLS ────────────────────────────────────────────────────────────
const J_KINDS = [
  ["deg", "Degrees", 1], ["oct", "Octaves", 1], ["rest", "Rests", 1], ["rhythm", "Rhythm", 0],
  ["root", "Root", 1], ["scale", "Scale (same family)", 1], ["dir", "Direction", 0], ["home", "Come home", 1],
];
// How often each kind of move is drawn, against the others that are on.
const J_WEIGHT = { deg: 5, oct: 1.6, rest: 1.6, rhythm: 1.8, root: 0.5, scale: 0.35, dir: 0.3 };
// The curve's points sit at the ends of the sections: Intro, Build, Peak; the
// last is the end, which is home (0) unless Come home is off.
const J_AT = [0, 0.15, 0.5, 0.85, 1];

// What presets, morphs and the Performance recorder carry. The seed goes into
// presets only: morphing between two seeds means nothing.
const JOURNEY_MORPH_IDS = ["jWanderSlider", "jEachSlider", "jC1Slider", "jC2Slider", "jC3Slider", "jC4Slider"];
const JOURNEY_SLIDER_IDS = [...JOURNEY_MORPH_IDS, "jSeedSlider"];
const JOURNEY_SELECT_IDS = ["jOnSelect", "jLenSelect", ...J_KINDS.map(([k]) => `jK${k}Select`)];

/// The values, read from the controls.
const J = { on: false, bars: 32, wander: 45, each: 3, seed: 4127, curve: [15, 70, 100, 60], kinds: {} };

function journeyRead() {
  const v = (id, d) => { const el = document.getElementById(id); return el ? el.value : d; };
  J.on = v("jOnSelect", "off") === "on";
  J.bars = parseInt(v("jLenSelect", "32"), 10) || 32;
  J.wander = +v("jWanderSlider", 45);
  J.each = +v("jEachSlider", 3);
  J.seed = +v("jSeedSlider", 4127);
  J.curve = [1, 2, 3, 4].map((n) => +v(`jC${n}Slider`, [15, 70, 100, 60][n - 1]));
  for (const [k, , d] of J_KINDS) J.kinds[k] = v(`jK${k}Select`, d ? "on" : "off") === "on";
  const val = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  val("jWanderVal", Math.round(J.wander) + "%");
  val("jEachVal", J.each + (J.each === 1 ? " step" : " steps"));
  val("jSeedVal", "seed " + J.seed);
  document.body.classList.toggle("journey-on", J.on);
  for (const b of document.querySelectorAll(".j-kind")) b.classList.toggle("on", !!J.kinds[b.dataset.k]);
  journeyDraw();
  if (typeof renderStepGrid === "function") renderStepGrid();
}

// ─── THE TRIP ────────────────────────────────────────────────────────────────
/// A small, seeded random source (mulberry32).
function jRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Steps in one trip: its bars of four beats, at the step's length.
const jTripSteps = () => Math.max(1, Math.round((J.bars * 4) / stepBeats));

/// How far the trip has gone at `f` (0–1 through it), 0–1.
function journeyCurve(f) {
  const h = [0, ...J.curve.slice(0, 3).map((c) => c / 100), J.kinds.home ? 0 : J.curve[3] / 100];
  f = Math.max(0, Math.min(1, f));
  let i = 0;
  while (i < J_AT.length - 2 && f > J_AT[i + 1]) i++;
  const t = (f - J_AT[i]) / (J_AT[i + 1] - J_AT[i]);
  const s = t * t * (3 - 2 * t);
  return h[i] + (h[i + 1] - h[i]) * s;
}

/// The trip's moves, planned from the seed: the same settings give the same
/// list. Kept until a setting it depends on changes.
let jPlanKey = "", jPlanMoves = [];
function journeyPlan(trip) {
  const scale = SCALES[selectedScaleIdx];
  const n = Math.max(1, numSteps);
  const key = [J.seed, trip, J.each, J.wander, n, scale.cents.length, selectedScaleIdx, jTripSteps(), J_KINDS.map(([k]) => (J.kinds[k] ? 1 : 0)).join("")].join("|");
  if (key === jPlanKey) return jPlanMoves;
  const rnd = jRng(J.seed * 2654435761 + trip * 40503 + 17);
  const kinds = Object.keys(J_WEIGHT).filter((k) => J.kinds[k]);
  const wsum = kinds.reduce((a, k) => a + J_WEIGHT[k], 0);
  // Enough moves that, at the top of the curve, each pass has added Each pass
  // of them on the way up.
  const passes = jTripSteps() / n;
  const total = kinds.length ? Math.max(1, Math.min(600, Math.round(J.each * passes * 0.5))) : 0;
  const len = scale.cents.length;
  // A fifth, in this scale: the degree nearest 702¢.
  let fifth = 1;
  scale.cents.forEach((c, i) => { if (Math.abs(c - 702) < Math.abs(scale.cents[fifth] - 702)) fifth = i; });
  // The scale's family: the others in its group with as many degrees.
  const family = SCALES.map((s, i) => i).filter((i) => i !== selectedScaleIdx && SCALES[i].cat === scale.cat && SCALES[i].cents.length === len);
  const reach = 1 + Math.round((J.wander / 100) * 3); // how far a degree may move
  const moves = [];
  for (let j = 0; j < total; j++) {
    let r = rnd() * wsum, kind = kinds[0];
    for (const k of kinds) { if ((r -= J_WEIGHT[k]) <= 0) { kind = k; break; } }
    const i = Math.floor(rnd() * n), up = rnd() < 0.5 ? -1 : 1;
    if (kind === "deg") moves.push({ kind, i, d: up * (1 + Math.floor(rnd() * reach)) });
    else if (kind === "oct") moves.push({ kind, i, d: up * len });
    else if (kind === "rest") moves.push({ kind, i });
    else if (kind === "rhythm") moves.push({ kind, i, how: rnd() < 0.5 ? "double" : "tie" });
    else if (kind === "root") moves.push({ kind, big: true, d: rnd() < 0.4 ? fifth : up * (1 + Math.floor(rnd() * 2)) });
    else if (kind === "scale") { if (family.length) moves.push({ kind, big: true, to: family[Math.floor(rnd() * family.length)] }); }
    else if (kind === "dir") moves.push({ kind, big: true });
  }
  jPlanKey = key;
  jPlanMoves = moves;
  return moves;
}

/// The pattern with the first `a` moves of the plan in force.
function journeyPattern(moves, a) {
  const n = Math.max(1, numSteps);
  const len = SCALES[selectedScaleIdx].cents.length;
  const top = len * 4 - 1; // four octaves, as the octave buttons allow
  const out = steps.map((s) => ({ degree: s.degree, rest: s.rest, hold: 1, double: false }));
  const g = { shift: 0, scale: -1, reverse: false };
  for (let j = 0; j < Math.min(a, moves.length); j++) {
    const m = moves[j], s = out[m.i];
    if (m.kind === "deg" || m.kind === "oct") s.degree = Math.max(0, Math.min(top, s.degree + m.d));
    else if (m.kind === "rest") s.rest = !s.rest;
    else if (m.kind === "rhythm") {
      if (m.how === "double") s.double = !s.double;
      else if (m.i + 1 < n) { s.hold = 2; out[m.i + 1].rest = true; }
    } else if (m.kind === "root") g.shift += m.d;
    else if (m.kind === "scale") g.scale = m.to;
    else if (m.kind === "dir") g.reverse = !g.reverse;
  }
  // The root's moves are moves of every note, kept inside the four octaves.
  if (g.shift) for (const s of out) s.degree = Math.max(0, Math.min(top, s.degree + g.shift));
  return { steps: out, g };
}

/// Where boundary `k` is: which trip, how far through it, how many moves are in force.
function journeyWhere(k) {
  const u = Math.max(0, k) / jTripSteps();
  const trip = Math.floor(u), f = u - trip;
  const moves = journeyPlan(trip);
  return { trip, f, moves, a: Math.round(journeyCurve(f) * moves.length) };
}

/// The step that sounds at boundary `k` for step `i`: as written while the
/// Journey is off; moved, with its frequency, while it is on.
function journeyStep(k, i) {
  if (!J.on) return steps[i];
  const w = journeyWhere(k);
  const p = journeyPattern(w.moves, w.a);
  const n = Math.max(1, numSteps);
  const s = p.steps[p.g.reverse && i < n ? n - 1 - i : i];
  if (!s || s.rest) return { degree: s ? s.degree : 0, rest: true };
  let freq;
  if (p.g.scale >= 0) {
    // The family's scale, on the same root and degree.
    const c = SCALES[p.g.scale].cents, d = s.degree;
    freq = centsToHz(rootHz, c[d % c.length] + Math.floor(d / c.length) * 1200);
  }
  return { degree: s.degree, rest: false, freq, hold: s.hold, double: s.double };
}

// ─── WHAT THE PAGE SHOWS ─────────────────────────────────────────────────────
/// The steps the Journey has moved, as it stands now: their new names, by index.
function journeyMoved() {
  if (!J.on) return null;
  const w = journeyWhere(seqStepCount);
  if (!w.a) return null;
  const p = journeyPattern(w.moves, w.a);
  const len = SCALES[selectedScaleIdx].cents.length;
  return p.steps.map((s, i) => {
    const b = steps[i];
    if (s.degree === b.degree && s.rest === b.rest && s.hold === 1 && !s.double) return null;
    return s.rest ? "REST" : `D${(s.degree % len) + 1} OCT${Math.floor(s.degree / len) + 1}${s.double ? " ×2" : ""}${s.hold > 1 ? " tied" : ""}`;
  });
}

/// After each played step: move the curve's playhead, and redraw the grid when
/// a move has come into force or gone.
let jLastA = -1;
function journeyOnStep() {
  if (!J.on) return;
  const w = journeyWhere(seqStepCount);
  if (w.a !== jLastA) {
    jLastA = w.a;
    renderStepGrid();
  }
  journeyDraw();
}

function journeyMarkLabel(m) {
  if (m.kind === "root") return "root " + (m.d > 0 ? "+" : "") + m.d;
  if (m.kind === "scale") return "→ " + SCALES[m.to].name.replace(/\s*\(.*\)$/, "");
  return "⇄ direction";
}

function journeyDraw() {
  const c = document.getElementById("jCurve");
  if (!c) return;
  const cssW = c.offsetWidth;
  if (cssW > 0 && c.width !== cssW) c.width = cssW;
  const g = c.getContext("2d"), W = c.width, H = c.height, top = 16, bot = H - 6;
  const ink = (n, a) => (typeof seqInk === "function" ? seqInk(n, a) : "#888");
  g.clearRect(0, 0, W, H);
  // The sections.
  const names = ["INTRO", "BUILD", "PEAK", "OUTRO"];
  g.font = "600 9px ui-monospace, Menlo, monospace";
  for (let i = 0; i < 4; i++) {
    const x = J_AT[i] * W;
    if (i) { g.fillStyle = ink("line"); g.fillRect(Math.round(x), 0, 1, H); }
    g.fillStyle = ink("dim");
    g.fillText(names[i], x + 5, 11);
  }
  // The curve.
  const Y = (v) => bot - v * (bot - top);
  g.beginPath();
  for (let x = 0; x <= W; x++) { const y = Y(journeyCurve(x / W)); x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.strokeStyle = ink(J.on ? "time" : "dim");
  g.lineWidth = 1.6;
  g.stroke();
  g.lineTo(W, bot); g.lineTo(0, bot); g.closePath();
  g.fillStyle = ink(J.on ? "time" : "dim", 0.12);
  g.fill();
  // Its handles.
  const pts = J.kinds.home ? 3 : 4;
  for (let i = 1; i <= pts; i++) {
    g.beginPath();
    g.arc(J_AT[i] * W - (i === 4 ? 5 : 0), Y(journeyCurve(J_AT[i])), 4, 0, Math.PI * 2);
    g.fillStyle = ink(J.on ? "time" : "dim");
    g.fill();
  }
  // The big moves, where they come into force.
  const moves = journeyPlan(J.on ? journeyWhere(seqStepCount).trip : 0);
  if (moves.length) {
    const seen = new Set();
    let lastX = -999;
    for (let x = 0; x <= W; x += 2) {
      const a = Math.round(journeyCurve(x / W) * moves.length);
      for (let j = 0; j < a; j++) {
        if (!moves[j].big || seen.has(j)) continue;
        seen.add(j);
        if (x - lastX < 70) continue; // keep the labels apart
        lastX = x;
        const t = journeyMarkLabel(moves[j]);
        g.font = "500 9px ui-monospace, Menlo, monospace";
        const tw = g.measureText(t).width + 10, y = Y(journeyCurve(x / W)) + 6;
        g.fillStyle = ink("well", 0.85);
        g.fillRect(x - tw / 2, Math.min(bot - 14, y), tw, 13);
        g.fillStyle = ink("pitch");
        g.fillText(t, x - tw / 2 + 5, Math.min(bot - 14, y) + 10);
      }
    }
  }
  // Where it is.
  if (J.on && typeof isPlaying !== "undefined" && isPlaying) {
    const x = journeyWhere(seqStepCount).f * W;
    g.fillStyle = ink("on");
    g.fillRect(Math.round(x) - 1, 0, 2, H);
  }
}

// ─── RE-ROLL, KEEP THIS, THE CURVE'S HANDLES ─────────────────────────────────
function journeySet(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = v;
  if (window.updateKnobVisual) window.updateKnobVisual(id);
}

/// Another trip: a new seed.
function journeyReroll() {
  journeySet("jSeedSlider", 1 + Math.floor(Math.random() * 99998));
  journeyRead();
}

/// Where the trip has got to becomes the pattern; the Journey turns off, so
/// what plays does not change.
function journeyKeep() {
  if (!J.on) return;
  const w = journeyWhere(seqStepCount);
  const p = journeyPattern(w.moves, w.a);
  const n = Math.max(1, numSteps);
  const was = p.steps.map((s) => ({ ...s }));
  for (let i = 0; i < n; i++) {
    const s = was[p.g.reverse ? n - 1 - i : i];
    steps[i].degree = s.degree;
    steps[i].rest = s.rest;
  }
  journeySet("jOnSelect", "off");
  if (p.g.scale >= 0) selectScale(p.g.scale);
  journeyRead();
}

/// Drag a handle of the curve up or down.
function journeyCurveDrag(e) {
  const c = e.currentTarget, r = c.getBoundingClientRect();
  const pts = J.kinds.home ? 3 : 4;
  const fx = (e.clientX - r.left) / r.width;
  let best = 1;
  for (let i = 1; i <= pts; i++) if (Math.abs(J_AT[i] - fx) < Math.abs(J_AT[best] - fx)) best = i;
  const id = `jC${best}Slider`;
  const move = (ev) => {
    const v = 1 - (ev.clientY - r.top - 16) / (r.height - 22);
    journeySet(id, Math.round(Math.max(0, Math.min(1, v)) * 100));
    journeyRead();
  };
  const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  move(e);
}

// ─── THE MARKUP ──────────────────────────────────────────────────────────────
function journeyKnob(id, label, min, max, value, step = 1) {
  return `<div class="knob-group"><span class="knob-label">${label}</span>`
    + `<div class="knob" onmousedown="knobDown(event, '${id}Slider')" ontouchstart="knobTouchStart(event,'${id}Slider')"></div>`
    + `<input type="range" class="knob-hidden" min="${min}" max="${max}" step="${step}" value="${value}" id="${id}Slider" oninput="journeyRead()" />`
    + `<span class="knob-val" id="${id}Val"></span></div>`;
}

function journeyBuildUI() {
  const host = document.getElementById("journeyHost");
  if (!host || document.getElementById("jOnSelect")) return;
  const sel = (id, opts, v) => `<select id="${id}" data-seg onchange="journeyRead()">${opts.map(([o, t]) => `<option value="${o}"${o === v ? " selected" : ""}>${t}</option>`).join("")}</select>`;
  const hidden = (id, v) => `<input type="range" class="knob-hidden" id="${id}" min="0" max="100" value="${v}" oninput="journeyRead()" />`;
  host.innerHTML = `<div class="ph"><b class="nm">JOURNEY</b><span class="meta">the pattern goes somewhere, and comes home</span><span class="grow"></span>`
    + sel("jOnSelect", [["off", "Off"], ["on", "On"]], "off")
    + `<span class="cap">Length</span>${sel("jLenSelect", [["16", "16"], ["32", "32"], ["64", "64"], ["128", "128"]], "32")}<span class="cap">bars</span></div>`
    + `<div class="j-body">`
    + `<div class="well j-curve"><canvas id="jCurve" width="600" height="96" title="Drag a point to change how far it goes, when"></canvas></div>`
    + `<div class="j-knobs">${journeyKnob("jWander", "Wander", 0, 100, 45)}${journeyKnob("jEach", "Each pass", 1, 8, 3)}</div>`
    + `<div class="j-kinds"><span class="cap">What it may change</span><div class="j-chips">`
    + J_KINDS.map(([k, t, d]) => `<button type="button" class="j-kind" data-k="${k}">${t}</button><select id="jK${k}Select" class="at-hidden" onchange="journeyRead()"><option value="on"${d ? " selected" : ""}>on</option><option value="off"${d ? "" : " selected"}>off</option></select>`).join("")
    + `</div></div>`
    + `<div class="j-acts"><button type="button" class="btn" id="jReroll" title="Plan another trip: a new seed">◌ Re-roll</button>`
    + `<button type="button" class="btn" id="jKeep" title="Make where the trip has got to the pattern, and turn the Journey off">Keep this</button>`
    + `<span class="meta" id="jSeedVal"></span><input type="range" class="knob-hidden" id="jSeedSlider" min="1" max="99999" value="4127" oninput="journeyRead()" />`
    + hidden("jC1Slider", 15) + hidden("jC2Slider", 70) + hidden("jC3Slider", 100) + hidden("jC4Slider", 60) + `</div></div>`;
  for (const b of host.querySelectorAll(".j-kind")) {
    b.addEventListener("click", () => {
      const s = document.getElementById(`jK${b.dataset.k}Select`);
      s.value = s.value === "on" ? "off" : "on";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  document.getElementById("jReroll").addEventListener("click", journeyReroll);
  document.getElementById("jKeep").addEventListener("click", journeyKeep);
  document.getElementById("jCurve").addEventListener("mousedown", journeyCurveDrag);
}

journeyBuildUI();
journeyRead();
