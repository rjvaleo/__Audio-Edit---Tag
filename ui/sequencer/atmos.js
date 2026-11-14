// ─── ATMOSPHERE: THE SECOND SYNTH ────────────────────────────────────────────
// RJ, 13 Nov 2026: "Make the synthesizer better with more atmosphere … add
// more controls, add some types of oscillators, be innovative … so I have two
// synths. We'll be able to switch between them, and they do the full scale
// sequencing with true tone, true pitch."
//
// Classic is the synth as it was. Atmosphere is a second voice: two
// oscillators of eight kinds, blended; unison, drift, a sub, air; notes held
// past their step so they overlap; long envelopes; then character (warmth,
// tape wow, ensemble), sympathy (resonators tuned to the scale), and Space.
//
// Space is a reverb of its own, for both synths. The sequencer's own cathedral
// reverb is in app.js but switched off by its author ("DISABLED — TODO:
// revisit gain staging"); rather than switch on what was pulled for its level,
// Space convolves with a generated impulse response, normalised so its level
// does not change with its size. Its Wet starts at 0, so Classic sounds as it
// did until someone turns it up.
//
// True pitch: every frequency here is the one `getFreqForDegree` hands
// `playNote`, from the scale's cents, times a ratio the voice chooses; nothing
// is rounded to 12-TET. Scale spectrum goes further: its partials sit on the
// scale's own intervals (after Sethares, "Tuning, Timbre, Spectrum, Scale"),
// so a maqam or a just scale is consonant in its own tuning.
//
// The graph is built by `atmosInit`, which `initAudio` calls last, so the
// film and sound export, which build the page's graph on an offline context
// (`bridge.js`), get it too. See `docs/SEQUENCER.md`.

// ─── THE CONTROLS ────────────────────────────────────────────────────────────
const AT_KINDS = [
  { id: "classic", name: "Classic", sub: "sine · tri · saw · square", p: ["Wave", "", ""] },
  { id: "supersaw", name: "Supersaw", sub: "detuned saws, spread", p: ["Spread", "", ""] },
  { id: "spectrum", name: "Scale spectrum", sub: "partials on the scale", p: ["Fit", "Bright", "Partials"] },
  { id: "choir", name: "Choir", sub: "vowel formants", p: ["Vowel", "Voices", "Breath"] },
  { id: "glass", name: "Glass", sub: "struck · bowed modes", p: ["Material", "Ring", "Strike"] },
  { id: "breath", name: "Breath", sub: "noise tuned to pitch", p: ["Focus", "Grit", ""] },
  { id: "cloud", name: "Cloud", sub: "frozen, smeared", p: ["Smear", "Motion", "Partials"] },
  { id: "endless", name: "Endless", sub: "Shepard rise / fall", p: ["Rise", "Spread", ""] },
];
const AT_KIND_IDS = AT_KINDS.map((k) => k.id);
const AT_GLYPH = {
  classic: "M2 17C9 2 16 2 23 17S37 32 44 17 58 2 58 2",
  supersaw: "M2 30 14 4V30L26 4V30L38 4V30L50 4V30M5 30 17 6V30L29 6V30L41 6V30L53 6V30",
  spectrum: "M6 32V6M15 32V14M21 32V10M30 32V18M37 32V12M45 32V22M51 32V16",
  choir: "M2 28C8 28 10 8 15 8S20 26 26 26 30 14 34 14 38 24 44 24 50 18 58 18",
  glass: "M2 17H8L10 4L12 30L14 9L16 25L18 13L22 20L28 16L40 17.5H58",
  breath: "M2 17C4 13 5 21 7 16S10 12 12 19 15 21 17 15 20 13 22 18 26 20 28 16 31 13 33 18 37 20 40 15 44 13 47 19 52 20 58 16",
  cloud: "M2 16C7 24 11 8 16 18S25 10 30 20 38 8 43 18 52 12 58 16M2 20C6 10 9 26 14 14S22 24 26 12 33 26 38 16 46 22 50 12 56 22 58 18",
  endless: "M4 30 20 4M16 30 32 4M28 30 44 4M40 30 56 4",
};

/// Exponential map of a 0–100 knob onto lo…hi.
const atExp = (v, lo, hi) => lo * Math.pow(hi / lo, v / 100);
const atMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + "s" : Math.round(ms) + "ms");
const atPct = (v) => Math.round(v) + "%";

/// Every Atmosphere knob: [id, label, min, max, value, format of the raw value].
/// The per-oscillator knobs (A1…B3) take their name and reading from the kind.
const AT_KNOBS = [
  ["atA1", "", 0, 100, 20], ["atA2", "", 0, 100, 60], ["atA3", "", 0, 100, 35], ["atAOct", "Oct", -2, 2, 0, (v) => (v > 0 ? "+" : "") + v],
  ["atB1", "", 0, 100, 80], ["atB2", "", 0, 100, 45], ["atB3", "", 0, 100, 35], ["atBOct", "Oct", -2, 2, 0, (v) => (v > 0 ? "+" : "") + v],
  ["atBlend", "Blend", 0, 100, 40, (v) => (v < 50 ? "A " + (100 - v) : v > 50 ? "B " + v : "A=B")],
  ["atUnison", "Unison", 1, 9, 5, (v) => String(v)],
  ["atDetune", "Detune", 0, 100, 18, (v) => Math.round(v) + "¢"],
  ["atWidth", "Width", 0, 100, 80, atPct],
  ["atDrift", "Drift", 0, 100, 35, atPct],
  ["atSub", "Sub", 0, 100, 20, atPct],
  ["atAir", "Air", 0, 100, 20, atPct],
  ["atHold", "Hold", 25, 400, 300, (v) => (v / 100).toFixed(2).replace(/0$/, "") + "× step"],
  ["atGlide", "Glide", 0, 100, 20, (v) => atMs(v <= 0 ? 0 : atExp(v, 5, 2000))],
  ["atAtk", "Attack", 0, 100, 74, (v) => atMs(atExp(v, 1, 10000))],
  ["atDec", "Decay", 0, 100, 70, (v) => atMs(atExp(v, 1, 10000))],
  ["atSus", "Sustain", 0, 100, 80, atPct],
  ["atRel", "Release", 0, 100, 78, (v) => atMs(atExp(v, 10, 20000))],
  ["atVol", "Volume", 0, 100, 70, atPct],
  ["atEns", "Ensemble", 0, 100, 40, atPct],
  ["atEnsRate", "Ens. rate", 0, 100, 40, (v) => atExp(v, 0.05, 2).toFixed(2) + "Hz"],
  ["atWow", "Tape wow", 0, 100, 15, atPct],
  ["atWarm", "Warmth", 0, 100, 15, atPct],
  ["atSym", "Amount", 0, 100, 30, atPct],
  ["atSymRing", "Ring", 0, 100, 55, (v) => atExp(v, 0.3, 10).toFixed(1) + "s"],
  ["atSymMat", "Material", 0, 100, 50, (v) => (v < 34 ? "felt" : v < 67 ? "string" : "glass")],
  ["atLowCut", "Low cut", 0, 100, 0, (v) => (v <= 0 ? "off" : Math.round(atExp(v, 20, 1000)) + "Hz")],
  ["atRevWet", "Wet", 0, 100, 0, atPct],
  ["atRevSize", "Size", 0, 100, 60, (v) => atRevRt60(v).toFixed(1) + "s"],
  ["atRevPre", "Pre-delay", 0, 100, 15, (v) => Math.round(v * 1.5) + "ms"],
  ["atRevDamp", "Damp", 0, 100, 45, (v) => { const f = atExp(100 - v, 800, 18000); return f >= 1000 ? (f / 1000).toFixed(1) + "kHz" : Math.round(f) + "Hz"; }],
  ["atRevShim", "Shimmer", 0, 100, 30, atPct],
  ["atRevSpread", "Spread", 0, 100, 80, atPct],
  ["atMacro", "ATMOSPHERE", 0, 100, 60, atPct],
];
const AT_SELECTS = ["atModeSelect", "atKindASelect", "atKindBSelect", "atSymTuneSelect"];
// What presets, morphs and the Performance recorder carry.
const ATMOS_SLIDER_IDS = AT_KNOBS.map((k) => k[0] + "Slider");
const ATMOS_SELECT_IDS = AT_SELECTS.slice();
const ATMOS_REVERB_IDS = []; // Space's knobs are among the AT_KNOBS
const atRevRt60 = (v) => atExp(v, 0.4, 15);
const AT_SPACES = {
  room: { atRevWet: 22, atRevSize: 22, atRevPre: 5, atRevDamp: 55, atRevShim: 10, atRevSpread: 60 },
  hall: { atRevWet: 32, atRevSize: 55, atRevPre: 15, atRevDamp: 45, atRevShim: 25, atRevSpread: 85 },
  cath: { atRevWet: 42, atRevSize: 80, atRevPre: 26, atRevDamp: 35, atRevShim: 55, atRevSpread: 100 },
  inf: { atRevWet: 55, atRevSize: 100, atRevPre: 33, atRevDamp: 25, atRevShim: 80, atRevSpread: 100 },
};

/// The values, read from the controls.
const AT = {};
let atmosOn = false;
let classicOn = true; // the first synth; both can play at once

// ─── THE MARKUP ──────────────────────────────────────────────────────────────
function atKnobHtml(id, label, min, max, value) {
  return `<div class="knob-group at-kg" data-k="${id}"><span class="knob-label" id="${id}Label">${label}</span>`
    + `<div class="knob" id="${id}Knob" onmousedown="knobDown(event, '${id}Slider')" ontouchstart="knobTouchStart(event,'${id}Slider')"></div>`
    + `<input type="range" class="knob-hidden" min="${min}" max="${max}" step="1" value="${value}" id="${id}Slider" oninput="atmosRead()" />`
    + `<span class="knob-val" id="${id}Val"></span></div>`;
}
const atK = (id) => { const k = AT_KNOBS.find((x) => x[0] === id); return atKnobHtml(k[0], k[1], k[2], k[3], k[4]); };

function atPanel(cls, name, meta, inner) {
  return `<section class="panel ${cls}"><div class="ph"><b class="nm">${name}</b><span class="meta">${meta}</span></div>${inner}</section>`;
}
const atKnobs = (ids) => `<div class="at-knobs">${ids.map(atK).join("")}</div>`;

function atOscHtml(w) {
  const cards = AT_KINDS.map((k) => `<button type="button" class="at-osc" data-kind="${k.id}" title="${k.name}: ${k.sub}">`
    + `<svg viewBox="0 0 60 34"><path d="${AT_GLYPH[k.id]}"/></svg><b>${k.name}</b><small>${k.sub}</small></button>`).join("");
  return `<section class="panel at-oscbox" data-osc="${w}"><div class="ph"><b class="nm">OSC ${w}</b><span class="meta" id="at${w}What"></span><span class="grow"></span><span class="meta">8 kinds</span>`
    + `<select id="atKind${w}Select" class="at-hidden" onchange="atmosRead()">${AT_KINDS.map((k) => `<option value="${k.id}">${k.name}</option>`).join("")}</select></div>`
    + `<div class="at-oscs">${cards}</div><div class="at-osc-row"><div class="well scope scope-osc"><canvas id="scope${w}" width="240" height="58"></canvas></div>`
    + `${atKnobs([`at${w}1`, `at${w}2`, `at${w}3`, `at${w}Oct`])}</div></section>`;
}

const AT_STARTS = [
  ["glass-choir", "Glass choir"], ["cathedral-air", "Cathedral air"], ["scale-bells", "Scale bells"],
  ["dark-drone", "Dark drone"], ["endless-rise", "Endless rise"], ["plain", "Plain (Classic)"],
];

/// Which synths play: Classic, Atmosphere, or both at once. One select carries
/// it, so presets, morphs and the Performance recorder keep it as they keep any
/// other switch; the two power buttons set it.
function atPowerClick(syn) {
  const cl = AT.mode !== "atmos", at = AT.mode !== "classic";
  const next = syn === "classic" ? [!cl, at] : [cl, !at];
  if (!next[0] && !next[1]) return; // one of them always plays
  atmosSet("atModeSelect", next[0] && next[1] ? "both" : next[0] ? "classic" : "atmos");
}

function atmosBuildUI() {
  const body = document.getElementById("atBody");
  if (!body || document.getElementById("atModeSelect")) return;
  const mode = document.createElement("select");
  mode.id = "atModeSelect";
  mode.className = "at-hidden";
  mode.innerHTML = `<option value="classic">classic</option><option value="atmos">atmosphere</option><option value="both">both</option>`;
  mode.addEventListener("change", atmosRead);
  document.getElementById("atGroup").append(mode);
  document.getElementById("atStarts").innerHTML = AT_STARTS.map(([k, n]) => `<button type="button" class="btn" data-start="${k}">${n}</button>`).join("");
  // The oscillators and the big knob; the voice and its envelope; what comes after.
  body.innerHTML = `<div class="at-r1 at-row at-only">${atOscHtml("A")}${atOscHtml("B")}`
    + `<section class="panel at-macro">${atK("atMacro")}<small>one knob that opens the whole voice: width, drift, hold, air, ensemble, space and shimmer together</small></section></div>`
    + `<div class="at-r2 at-row at-only">`
    + atPanel("at-voice", "VOICE", "how A and B become one sound", atKnobs(["atBlend", "atUnison", "atDetune", "atWidth", "atDrift", "atSub", "atAir", "atHold", "atGlide"]))
    + atPanel("at-ampp", "AMP", "long swells: attack to 10 s, release to 20 s", `<div class="well pic"><canvas id="atAmpCanvas" width="300" height="64" class="at-amp"></canvas></div>${atKnobs(["atAtk", "atDec", "atSus", "atRel", "atVol"])}`)
    + `</div><div class="at-r3 at-row at-only">`
    + atPanel("at-char", "CHARACTER", "after the voice", atKnobs(["atWarm", "atWow", "atEns", "atEnsRate"]))
    + atPanel("at-sym", "SYMPATHY", "strings tuned to the scale, ringing along", `<div class="at-knobs">${["atSym", "atSymRing", "atSymMat"].map(atK).join("")}`
      + `<div class="select-row"><span class="cap">Tuned to</span><select id="atSymTuneSelect" onchange="atmosRead()"><option value="degrees">Degrees</option><option value="fifths">Root + 5th</option><option value="root">Root</option></select></div></div>`)
    + `</div>`;
  // Space: a reverb for both synths, beside the delay.
  const space = document.getElementById("spaceHost");
  space.classList.add("at-space");
  space.innerHTML = `<div class="ph"><b class="nm">SPACE</b><span class="meta">reverb, both synths</span><span class="grow"></span>`
    + `<div class="seg" id="atSpaceSeg">${[["room", "Room"], ["hall", "Hall"], ["cath", "Cathedral"], ["inf", "Infinite"]].map(([k, n]) => `<button type="button" data-p="${k}">${n}</button>`).join("")}</div>`
    + `<button type="button" class="btn at-freeze" id="atFreeze" title="Freeze: the space takes nothing new and holds what it has">❄ Freeze</button></div>`
    + atKnobs(["atRevWet", "atRevSize", "atRevPre", "atRevDamp", "atRevShim", "atRevSpread", "atLowCut"]);

  // Clicks.
  for (const b of document.querySelectorAll(".power[data-syn]")) b.addEventListener("click", () => atPowerClick(b.dataset.syn));
  // The host's Atmosphere page has no Classic panel, so the bar carries
  // Classic's power there, and offers to turn Atmosphere on while it is off.
  document.getElementById("atWithClassic")?.addEventListener("click", () => atPowerClick("classic"));
  document.getElementById("atTurnOn")?.addEventListener("click", () => atPowerClick("atmos"));
  for (const w of ["A", "B"]) {
    document.querySelector(`.at-oscbox[data-osc="${w}"] .at-oscs`).addEventListener("click", (e) => {
      const b = e.target.closest(".at-osc");
      if (b) atmosSet(`atKind${w}Select`, b.dataset.kind);
    });
  }
  document.getElementById("atStarts").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) atmosStart(b.dataset.start);
  });
  document.getElementById("atSpaceSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    atmosSpace(b.dataset.p);
  });
  document.getElementById("atFreeze").addEventListener("click", () => { atFrozen = !atFrozen; atmosFreezeApply(); atmosPaintSegs(); });
  // The big knob opens the rest.
  document.getElementById("atMacroSlider").addEventListener("input", atmosMacro);
  // Atmosphere's own LFO targets.
  for (let n = 1; n <= 3; n++) {
    const sel = document.getElementById(`lfo${n}TargetSelect`);
    if (!sel) continue;
    for (const [v, t] of [["at-detune", "At detune"], ["at-pan", "At pan"], ["at-air", "At air"], ["at-blend", "At blend"], ["at-vowel", "At vowel"], ["at-fit", "At fit"]]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      sel.appendChild(o);
    }
  }
}

/// Set a select and let it say so, as a person choosing it would.
function atmosSet(id, value) {
  const el = document.getElementById(id);
  if (!el || el.value === value) return;
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/// Read every control into `AT`, write the readings, and follow the mode.
function atmosRead() {
  for (const [id, , , , , fmt] of AT_KNOBS) {
    const inp = document.getElementById(id + "Slider");
    if (!inp) continue;
    AT[id] = parseFloat(inp.value);
    const val = document.getElementById(id + "Val");
    if (val) val.textContent = (fmt || atPct)(AT[id]);
  }
  AT.mode = document.getElementById("atModeSelect")?.value || "classic";
  AT.kindA = document.getElementById("atKindASelect")?.value || "choir";
  AT.kindB = document.getElementById("atKindBSelect")?.value || "spectrum";
  AT.symTune = document.getElementById("atSymTuneSelect")?.value || "degrees";
  atmosOn = AT.mode !== "classic";
  classicOn = AT.mode !== "atmos";
  document.body.classList.toggle("atmos-mode", atmosOn);
  document.body.classList.toggle("classic-off", !classicOn);
  for (const w of ["A", "B"]) {
    const kind = AT_KINDS.find((k) => k.id === AT["kind" + w]) || AT_KINDS[0];
    for (let i = 1; i <= 3; i++) {
      const id = `at${w}${i}`, name = kind.p[i - 1];
      const lab = document.getElementById(id + "Label");
      if (lab) lab.textContent = name || "—";
      document.querySelector(`.at-kg[data-k="${id}"]`)?.classList.toggle("at-unused", !name);
      const val = document.getElementById(id + "Val");
      if (val) val.textContent = name ? atParamText(kind.id, i, AT[id]) : "";
    }
    const what = document.getElementById(`at${w}What`);
    if (what) what.textContent = kind.name + " · " + kind.sub;
  }
  const note = document.getElementById("atModeNote");
  if (note) note.textContent = atmosOn ? (classicOn ? "playing with Classic" : "playing alone") + " · two oscillators, held notes, long swells · true pitch" : "off · turn it on to play it with Classic, or alone";
  atmosPaintSegs();
  atmosApplyGlobal();
  atmosDrawAmp();
}

/// What a per-oscillator knob reads, for its kind.
function atParamText(kind, i, v) {
  const u = v / 100;
  switch (kind + i) {
    case "classic1": return ["SINE", "TRI", "SAW", "SQUARE"][Math.round(u * 3)];
    case "supersaw1": return (0.5 + u * 1.5).toFixed(2) + "×";
    case "spectrum1": return Math.round(v) + "%";
    case "spectrum2": return Math.round(v) + "%";
    case "spectrum3": return String(atPartials(u));
    case "choir1": return atVowelName(u);
    case "choir2": return String(1 + Math.round(u * 7));
    case "glass1": return u < 0.34 ? "string" : u < 0.67 ? "bar" : "bell";
    case "glass2": return (0.3 + u * 6).toFixed(1) + "s";
    case "glass3": return u < 0.5 ? "bow " + Math.round((1 - u) * 100) + "%" : "strike " + Math.round(u * 100) + "%";
    case "cloud1": return Math.round(u * 15) + "¢";
    case "cloud2": return (0.03 + u * 0.6).toFixed(2) + "Hz";
    case "cloud3": return String(8 + Math.round(u * 56));
    case "endless1": { const s = Math.round((u - 0.5) * 24); return (s > 0 ? "+" : "") + s + " st"; }
    default: return Math.round(v) + "%";
  }
}
const atPartials = (u) => 4 + Math.round(u * 20);
const AT_VOWELS = [["ah", [730, 1090, 2440]], ["eh", [530, 1840, 2480]], ["ee", [270, 2290, 3010]], ["oh", [570, 840, 2410]], ["oo", [300, 870, 2240]]];
function atVowelName(u) { return AT_VOWELS[Math.min(4, Math.round(u * 4))][0]; }
function atVowel(u) {
  const x = Math.max(0, Math.min(1, u)) * 4, i = Math.min(3, Math.floor(x)), f = x - i;
  return AT_VOWELS[i][1].map((hz, k) => hz + (AT_VOWELS[i + 1][1][k] - hz) * f);
}

function atmosPaintSegs() {
  for (const b of document.querySelectorAll(".power[data-syn]")) b.classList.toggle("on", b.dataset.syn === "classic" ? classicOn : atmosOn);
  document.getElementById("atWithClassic")?.classList.toggle("on", classicOn);
  for (const w of ["A", "B"]) {
    for (const b of document.querySelectorAll(`.at-oscbox[data-osc="${w}"] .at-osc`)) b.classList.toggle("on", b.dataset.kind === AT["kind" + w]);
  }
  const fr = document.getElementById("atFreeze");
  if (fr) fr.classList.toggle("on", atFrozen);
}

function atmosDrawAmp() {
  const c = document.getElementById("atAmpCanvas");
  if (!c) return;
  const cssW = c.offsetWidth;
  if (cssW > 0 && c.width !== cssW) c.width = cssW;
  const g = c.getContext("2d"), w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  const a = atExp(AT.atAtk ?? 74, 1, 10000), d = atExp(AT.atDec ?? 70, 1, 10000), s = (AT.atSus ?? 80) / 100, r = atExp(AT.atRel ?? 78, 10, 20000);
  const hold = Math.max(a + d, 1500), tot = a + d + hold * 0.4 + r, X = (t) => 4 + (t / tot) * (w - 8), Y = (v) => h - 4 - v * (h - 10);
  g.fillStyle = seqInk("attack", 0.1); g.strokeStyle = seqInk("attack"); g.lineWidth = 1.5; g.beginPath();
  g.moveTo(X(0), Y(0)); g.lineTo(X(a), Y(1)); g.lineTo(X(a + d), Y(s)); g.lineTo(X(a + d + hold * 0.4), Y(s)); g.lineTo(X(tot), Y(0));
  g.stroke();
  g.closePath();
  g.fill();
}

/// The big knob: everything that makes it wider, longer and further away.
function atmosMacro() {
  const u = parseFloat(document.getElementById("atMacroSlider").value) / 100;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = Math.round(v);
    if (window.updateKnobVisual) window.updateKnobVisual(id);
  };
  const lerp = (a, b) => a + (b - a) * u;
  set("atWidthSlider", lerp(30, 100)); set("atDriftSlider", lerp(10, 60)); set("atHoldSlider", lerp(100, 300));
  set("atAirSlider", lerp(0, 40)); set("atEnsSlider", lerp(10, 60));
  set("atRevWetSlider", lerp(20, 60)); set("atRevSizeSlider", lerp(40, 92)); set("atRevShimSlider", lerp(15, 80));
  atmosRead();
}

/// The starting sounds.
const AT_START_VALUES = {
  "glass-choir": { kinds: ["choir", "spectrum"], v: { atA1: 20, atA2: 60, atA3: 35, atAOct: 0, atB1: 80, atB2: 45, atB3: 35, atBOct: 1, atBlend: 40, atUnison: 5, atDetune: 18, atWidth: 80, atDrift: 35, atSub: 20, atAir: 20, atHold: 300, atGlide: 20, atAtk: 74, atDec: 70, atSus: 80, atRel: 78, atVol: 70, atEns: 40, atEnsRate: 40, atWow: 15, atWarm: 15, atSym: 30, atSymRing: 55, atSymMat: 50, atLowCut: 10, atMacro: 60 }, space: "cath" },
  "cathedral-air": { kinds: ["breath", "choir"], v: { atA1: 50, atA2: 30, atA3: 0, atAOct: 0, atB1: 75, atB2: 80, atB3: 60, atBOct: 0, atBlend: 55, atUnison: 3, atDetune: 12, atWidth: 100, atDrift: 45, atSub: 10, atAir: 35, atHold: 400, atGlide: 0, atAtk: 78, atDec: 70, atSus: 85, atRel: 85, atVol: 72, atEns: 55, atEnsRate: 30, atWow: 10, atWarm: 10, atSym: 45, atSymRing: 70, atSymMat: 40, atLowCut: 20, atMacro: 80 }, space: "inf" },
  "scale-bells": { kinds: ["glass", "spectrum"], v: { atA1: 90, atA2: 60, atA3: 90, atAOct: 0, atB1: 100, atB2: 70, atB3: 50, atBOct: 1, atBlend: 50, atUnison: 1, atDetune: 6, atWidth: 60, atDrift: 15, atSub: 0, atAir: 5, atHold: 150, atGlide: 0, atAtk: 5, atDec: 79, atSus: 30, atRel: 74, atVol: 70, atEns: 25, atEnsRate: 40, atWow: 0, atWarm: 10, atSym: 40, atSymRing: 75, atSymMat: 90, atLowCut: 15, atMacro: 45 }, space: "hall" },
  "dark-drone": { kinds: ["supersaw", "cloud"], v: { atA1: 60, atA2: 0, atA3: 0, atAOct: -1, atB1: 50, atB2: 20, atB3: 50, atBOct: 0, atBlend: 60, atUnison: 7, atDetune: 25, atWidth: 85, atDrift: 50, atSub: 50, atAir: 10, atHold: 400, atGlide: 30, atAtk: 80, atDec: 75, atSus: 90, atRel: 88, atVol: 68, atEns: 45, atEnsRate: 20, atWow: 30, atWarm: 40, atSym: 25, atSymRing: 60, atSymMat: 20, atLowCut: 0, atMacro: 70 }, space: "cath" },
  "endless-rise": { kinds: ["endless", "cloud"], v: { atA1: 75, atA2: 50, atA3: 0, atAOct: 0, atB1: 40, atB2: 30, atB3: 40, atBOct: 0, atBlend: 30, atUnison: 1, atDetune: 10, atWidth: 90, atDrift: 30, atSub: 0, atAir: 20, atHold: 400, atGlide: 0, atAtk: 72, atDec: 70, atSus: 90, atRel: 83, atVol: 70, atEns: 50, atEnsRate: 25, atWow: 10, atWarm: 10, atSym: 35, atSymRing: 70, atSymMat: 60, atLowCut: 25, atMacro: 85 }, space: "inf" },
};
function atmosStart(key) {
  if (key === "plain") { atmosSet("atModeSelect", "classic"); return; }
  const s = AT_START_VALUES[key];
  if (!s) return;
  for (const [id, v] of Object.entries(s.v)) {
    const el = document.getElementById(id + "Slider");
    if (!el) continue;
    el.value = v;
    if (window.updateKnobVisual) window.updateKnobVisual(id + "Slider");
  }
  document.getElementById("atKindASelect").value = s.kinds[0];
  document.getElementById("atKindBSelect").value = s.kinds[1];
  // Atmosphere on; Classic stays as it was, so a starting sound can sit on top of it.
  document.getElementById("atModeSelect").value = classicOn ? "both" : "atmos";
  atmosSpace(s.space);
}

/// One of Space's four places: its knobs set, as a person would.
function atmosSpace(key) {
  const sp = AT_SPACES[key];
  if (!sp) return;
  for (const [id, v] of Object.entries(sp)) {
    const el = document.getElementById(id + "Slider");
    if (!el) continue;
    el.value = v;
    if (window.updateKnobVisual) window.updateKnobVisual(id + "Slider");
  }
  atmosRead();
}

// ─── THE GRAPH ───────────────────────────────────────────────────────────────
let atNoise = null, atIn = null, atShaper = null, atWow = null, atWowLfo = null, atFlutLfo = null, atEnsDry = null, atEnsWet = null,
  atEnsLfos = [], atPost = null, atSymIn = null, atSymBank = [], atSymOut = null, atSymKey = "", atBus = {}, atVoices = [], atRev = null,
  atPrevFreq = 0, atWaveCache = null, atFrozen = false;
const AT_MAX_VOICES = 16;
// Accompany's Chords and Drone (accompany.js) play this voice too, through a
// character chain of their own that leaves for the delay and Space without
// passing the melody's filter, and from a pool of their own, so a chord never
// takes a melody note's place.
let atAc = null, atAcVoices = [];
const AT_AC_MAX_VOICES = 24;

/// Built once per context, by `initAudio`.
function atmosInit() {
  const c = audioCtx;
  if (!c || !filterNode) return;
  // Two seconds of white noise, for air, breath and the glass's excitation.
  atNoise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const nd = atNoise.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < nd.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; nd[i] = (seed / 0x3fffffff) - 1; }
  atWaveCache = new Map();
  const ch = atCharChain(c);
  ({ inp: atIn, shaper: atShaper, wow: atWow, wowLfo: atWowLfo, flutLfo: atFlutLfo, ensDry: atEnsDry, ensWet: atEnsWet, ensLfos: atEnsLfos, post: atPost } = ch);
  atPost.connect(filterNode);
  // Accompany's chain: the same character, its output left for accompany.js
  // to take to the delay and Space.
  atAc = atCharChain(c);
  atAcVoices = [];
  // Sympathy: resonators tuned to the scale, fed by the voice.
  atSymIn = c.createGain();
  atSymOut = c.createGain();
  atPost.connect(atSymIn);
  atSymOut.connect(filterNode);
  atSymBank = [];
  atSymKey = "";
  // Space: its own reverb, for both synths (see the top of this file).
  atRev = atSpaceBuild(c);
  // Buses the LFOs drive, which every voice listens to.
  atBus = {};
  for (const k of ["detune", "pan", "air", "blend", "vowel", "fit"]) {
    const s = c.createConstantSource();
    s.offset.value = 0;
    s.start();
    atBus[k] = s;
  }
  atVoices = [];
  atPrevFreq = 0;
  if (!Object.keys(AT).length) atmosRead();
  atmosApplyGlobal();
  // An LFO that was already pointed at one of ours connects now the bus exists.
  if (typeof lfos !== "undefined") lfos.forEach((l, i) => { if (String(l.target).startsWith("at-")) connectLFO(i); });
}

/// Character: warmth, tape wow, and the ensemble (three slowly swept delays,
/// left, centre and right, beside the dry). `.inp` in, `.post` out.
function atCharChain(c) {
  const ch = {};
  ch.inp = c.createGain();
  ch.shaper = c.createWaveShaper();
  ch.shaper.oversample = "2x";
  ch.wow = c.createDelay(0.1);
  ch.wow.delayTime.value = 0.012;
  ch.wowLfo = atLfo(0.6, 0);
  ch.flutLfo = atLfo(6.8, 0);
  ch.wowLfo.out.connect(ch.wow.delayTime);
  ch.flutLfo.out.connect(ch.wow.delayTime);
  ch.inp.connect(ch.shaper);
  ch.shaper.connect(ch.wow);
  ch.post = c.createGain();
  ch.ensDry = c.createGain();
  ch.ensWet = c.createGain();
  ch.wow.connect(ch.ensDry);
  ch.ensDry.connect(ch.post);
  ch.ensLfos = [];
  [[0.011, -0.7, 1], [0.017, 0, 1.13], [0.023, 0.7, 0.87]].forEach(([base, pan, rate]) => {
    const d = c.createDelay(0.1), p = c.createStereoPanner(), l = atLfo(0.3 * rate, 0);
    d.delayTime.value = base;
    l.out.connect(d.delayTime);
    p.pan.value = pan;
    ch.wow.connect(d);
    d.connect(p);
    p.connect(ch.ensWet);
    ch.ensLfos.push({ l, rate });
  });
  ch.ensWet.connect(ch.post);
  return ch;
}

/// A sine LFO into a gain: `.out` to connect, `.gain` its depth.
function atLfo(rate, depth) {
  const c = audioCtx, o = c.createOscillator(), g = c.createGain();
  o.frequency.value = rate;
  g.gain.value = depth;
  o.connect(g);
  o.start();
  return { osc: o, out: g };
}

/// The settings that are not per note: warmth, wow, ensemble, sympathy's level, the low cut.
function atmosApplyGlobal() {
  if (!audioCtx || !atIn) return;
  const now = audioCtx.currentTime, smooth = (p, v) => p.setTargetAtTime(v, now, 0.03);
  const warm = (AT.atWarm ?? 15) / 100, k = 1 + warm * 5, n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = warm <= 0.001 ? x : Math.tanh(k * x) / Math.tanh(k); }
  const wow = (AT.atWow ?? 15) / 100;
  const ens = (AT.atEns ?? 40) / 100, rate = atExp(AT.atEnsRate ?? 40, 0.05, 2);
  // The melody's chain and Accompany's, alike.
  const chains = [{ shaper: atShaper, wowLfo: atWowLfo, flutLfo: atFlutLfo, ensDry: atEnsDry, ensWet: atEnsWet, ensLfos: atEnsLfos }];
  if (atAc) chains.push(atAc);
  for (const ch of chains) {
    ch.shaper.curve = curve;
    smooth(ch.wowLfo.out.gain, wow * 0.004);
    smooth(ch.flutLfo.out.gain, wow * 0.0004);
    smooth(ch.ensWet.gain, ens * 0.75);
    smooth(ch.ensDry.gain, 1 - ens * 0.3);
    for (const { l, rate: r } of ch.ensLfos) { smooth(l.osc.frequency, rate * r); smooth(l.out.gain, 0.0035 * ens); }
  }
  smooth(atSymIn.gain, ((AT.atSym ?? 30) / 100) * 0.9);
  atSpaceApply();
  atSymKey = ""; // ring, material or tuning may have changed: retune on the next note
}

const AT_FREEZE_FB = 0.96;

// ─── SPACE ───────────────────────────────────────────────────────────────────
// filterNode → gate → pre-delay → low cut → convolver → damp → limiter →
// shimmer (two slow chorus lines beside the dry) → wet → masterGain.
// Freeze closes the gate and lets the tail into a loop of a delay and four
// allpass filters (unity at every frequency) with feedback below one, so it
// holds the sound for minutes and cannot run away.
function atSpaceBuild(c) {
  const r = {};
  r.gate = c.createGain();
  r.pre = c.createDelay(0.25);
  r.low = c.createBiquadFilter(); r.low.type = "highpass"; r.low.frequency.value = 10;
  r.conv = c.createConvolver(); r.conv.normalize = false;
  r.damp = c.createBiquadFilter(); r.damp.type = "lowpass";
  r.lim = c.createDynamicsCompressor();
  r.lim.threshold.value = -6; r.lim.knee.value = 6; r.lim.ratio.value = 8; r.lim.attack.value = 0.003; r.lim.release.value = 0.3;
  r.dry = c.createGain();
  r.shim = c.createGain(); r.shim.gain.value = 0;
  r.wet = c.createGain(); r.wet.gain.value = 0;
  filterNode.connect(r.gate);
  r.gate.connect(r.pre); r.pre.connect(r.low); r.low.connect(r.conv); r.conv.connect(r.damp); r.damp.connect(r.lim);
  // The freeze loop.
  r.frzIn = c.createGain(); r.frzIn.gain.value = 0;
  r.frzD = c.createDelay(1); r.frzD.delayTime.value = 0.731;
  r.frzLp = c.createBiquadFilter(); r.frzLp.type = "lowpass"; r.frzLp.frequency.value = 9000;
  // A lowpass's Q is in dB here: -3 dB is flat, no bump above unity inside the loop.
  r.frzLp.Q.value = -3.01;
  r.frzFb = c.createGain(); r.frzFb.gain.value = 0;
  r.damp.connect(r.frzIn); r.frzIn.connect(r.frzD);
  let last = r.frzD;
  for (const hz of [310, 870, 2150, 4900]) {
    const ap = c.createBiquadFilter();
    ap.type = "allpass"; ap.frequency.value = hz; ap.Q.value = 0.6;
    last.connect(ap); last = ap;
  }
  last.connect(r.frzLp); r.frzLp.connect(r.frzFb); r.frzFb.connect(r.frzD);
  r.frzLp.connect(r.lim);
  r.lim.connect(r.dry); r.dry.connect(r.wet);
  r.lfos = [];
  for (const [base, rate, pan] of [[0.019, 0.21, -0.8], [0.027, 0.17, 0.8]]) {
    const d = c.createDelay(0.1), p = c.createStereoPanner(), l = atLfo(rate, 0);
    d.delayTime.value = base; l.out.connect(d.delayTime); p.pan.value = pan;
    r.lim.connect(d); d.connect(p); p.connect(r.shim);
    r.lfos.push(l);
  }
  r.shim.connect(r.wet);
  r.wet.connect(masterGain);
  r.irKey = "";
  r.timer = 0;
  return r;
}

/// A generated impulse response: noise under an exponential decay, the two
/// channels as far apart as Spread says, each scaled to unit energy so the
/// level stays put whatever the size.
function atSpaceIR(c, rt60, spread) {
  const rate = c.sampleRate, len = Math.max(1, Math.round(Math.min(16, rt60 * 1.15 + 0.1) * rate));
  const ir = c.createBuffer(2, len, rate), L = ir.getChannelData(0), R = ir.getChannelData(1);
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const k = -6.907755 / (rt60 * rate), fade = Math.round(0.006 * rate);
  for (let i = 0; i < len; i++) {
    const e = Math.exp(k * i) * (i < fade ? i / fade : 1), a = rnd(), b = rnd();
    L[i] = a * e;
    R[i] = (spread * b + (1 - spread) * a) * e;
  }
  for (const ch of [L, R]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += ch[i] * ch[i];
    const g = 1 / Math.sqrt(sum || 1);
    for (let i = 0; i < len; i++) ch[i] *= g;
  }
  return ir;
}

/// Space's knobs onto its graph. The impulse response is made again only when
/// Size or Spread changed, and not on every step of a drag.
function atSpaceApply() {
  const r = atRev;
  if (!r || !audioCtx) return;
  const c = audioCtx, now = c.currentTime, smooth = (p, v) => p.setTargetAtTime(v, now, 0.03);
  smooth(r.wet.gain, ((AT.atRevWet ?? 0) / 100) * 1.4);
  smooth(r.pre.delayTime, ((AT.atRevPre ?? 15) * 1.5) / 1000);
  smooth(r.low.frequency, (AT.atLowCut ?? 0) <= 0 ? 10 : atExp(AT.atLowCut, 20, 1000));
  smooth(r.damp.frequency, atExp(100 - (AT.atRevDamp ?? 45), 800, 18000));
  const shim = (AT.atRevShim ?? 30) / 100;
  smooth(r.shim.gain, shim * 0.8);
  smooth(r.dry.gain, 1 - shim * 0.35);
  for (const l of r.lfos) smooth(l.out.gain, 0.006 * shim);
  smooth(r.gate.gain, atFrozen ? 0 : 1);
  smooth(r.frzIn.gain, atFrozen ? 0.7 : 0);
  smooth(r.frzFb.gain, atFrozen ? AT_FREEZE_FB : 0);
  const rt = atRevRt60(AT.atRevSize ?? 60), sp = (AT.atRevSpread ?? 80) / 100, key = `${rt.toFixed(2)}|${sp.toFixed(2)}`;
  if (key === r.irKey) return;
  const make = () => { r.timer = 0; r.irKey = key; r.conv.buffer = atSpaceIR(c, rt, sp); };
  // Offline (the film), or the first time: now. Live: once the knob rests.
  if (!r.conv.buffer || typeof c.startRendering === "function") make();
  else { clearTimeout(r.timer); r.timer = setTimeout(make, 150); }
}

/// Freeze: the space takes nothing new and holds what it has.
function atmosFreezeApply() {
  atSpaceApply();
}

/// The resonators, tuned to the scale and root as they now are.
function atmosRetuneSympathy() {
  const sc = SCALES[selectedScaleIdx], cents = sc ? sc.cents : [0];
  const key = `${rootHz}|${cents.join(",")}|${AT.symTune}|${AT.atSymRing}|${AT.atSymMat}`;
  if (key === atSymKey && atSymBank.length) return;
  atSymKey = key;
  for (const f of atSymBank) { try { f.bp.disconnect(); f.g.disconnect(); } catch (e) { /* gone */ } }
  atSymBank = [];
  let set = cents;
  if (AT.symTune === "root") set = [0];
  else if (AT.symTune === "fifths") set = [0, cents.reduce((best, c) => (Math.abs(c - 702) < Math.abs(best - 702) ? c : best), cents[0])];
  const tau = atExp(AT.atSymRing ?? 55, 0.3, 10), mat = (AT.atSymMat ?? 50) / 100, c = audioCtx;
  for (let o = -1; o <= 1; o++) {
    for (const ct of set) {
      const f = rootHz * Math.pow(2, (o * 1200 + ct) / 1200);
      if (f < 30 || f > 12000 || atSymBank.length >= 24) continue;
      const Q = Math.max(2, Math.min(3000, Math.PI * f * tau / (1 + (1 - mat) * o * o)));
      const bp = c.createBiquadFilter(), g = c.createGain();
      bp.type = "bandpass";
      bp.frequency.value = f;
      bp.Q.value = Q;
      // Felt rings low, glass rings high.
      g.gain.value = Math.sqrt(Q) * 0.05 * Math.pow(2, (mat - 0.5) * o * 1.5);
      atSymIn.connect(bp);
      bp.connect(g);
      g.connect(atSymOut);
      atSymBank.push({ bp, g });
    }
  }
}

// ─── A NOTE ──────────────────────────────────────────────────────────────────
/// How long an Atmosphere note sounds before its release: Hold × the step.
function atmosNoteDur(stepDur) {
  return stepDur * ((AT.atHold ?? 300) / 100);
}

/// Play one note at `freq` (true pitch, from the scale) at `time` for `dur`.
/// Accompany (accompany.js) passes `o`: `ac` plays it into Accompany's chain
/// and pool, past the filter; `gain` scales it; `atk` and `rel`, in seconds,
/// stand in for the envelope's (the drone's Swell). Its notes do not glide,
/// move the melody's glide, or show on the oscillators' scopes.
function atmosPlay(freq, time, dur, o = null) {
  const c = audioCtx;
  if (!c || !atIn) return;
  // A Band part's own patch (band.js): its values stand in for the controls'
  // while the note is built, which is all at once.
  if (o && o.patch) {
    atmosRetuneSympathy();
    const was = {};
    for (const k of Object.keys(o.patch)) { was[k] = AT[k]; AT[k] = o.patch[k]; }
    try { return atmosPlay(freq, time, dur, { ...o, patch: null }); } finally { Object.assign(AT, was); }
  }
  const ac = !!(o && o.ac && atAc);
  atmosRetuneSympathy();
  // Notes the context has finished playing let go of the buses; the oldest
  // still sounding at `time` fades if there are too many.
  const now = c.currentTime;
  let pool = ac ? atAcVoices : atVoices;
  for (const old of pool) if (old.end < now) atCleanup(old);
  pool = pool.filter((old) => !old.cleaned);
  if (ac) atAcVoices = pool; else atVoices = pool;
  const sounding = pool.filter((old) => old.end > time);
  while (sounding.length >= (ac ? AT_AC_MAX_VOICES : AT_MAX_VOICES)) atStealOldest(sounding.shift(), time);
  const v = { srcs: [], links: [], end: 0, start: time };
  const a = o && o.atk != null ? o.atk : atExp(AT.atAtk, 1, 10000) / 1000, d = atExp(AT.atDec, 1, 10000) / 1000, s = AT.atSus / 100;
  const r = o && o.rel != null ? o.rel : atExp(AT.atRel, 10, 20000) / 1000;
  const peak = 0.32 * (AT.atVol / 100) * (o && o.gain != null ? o.gain : 1);
  const env = c.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.setTargetAtTime(peak, time, Math.max(0.001, a / 3));
  env.gain.setTargetAtTime(peak * s, time + a, Math.max(0.001, d / 3));
  if (env.gain.cancelAndHoldAtTime) env.gain.cancelAndHoldAtTime(time + dur);
  env.gain.setTargetAtTime(0, time + dur, Math.max(0.004, r / 5));
  v.end = time + dur + r * 1.25 + 0.05;
  v.env = env;
  env.connect(o && o.into ? o.into : ac ? atAc.inp : atIn);
  // Blend: equal power, and the bus an LFO can sweep it with.
  const b = AT.atBlend / 100, gA = c.createGain(), gB = c.createGain(), inv = c.createGain();
  gA.gain.value = Math.cos(b * Math.PI / 2);
  gB.gain.value = Math.sin(b * Math.PI / 2);
  inv.gain.value = -0.7;
  atLink(v, atBus.blend, inv); inv.connect(gA.gain);
  const fwd = c.createGain(); fwd.gain.value = 0.7; atLink(v, atBus.blend, fwd); fwd.connect(gB.gain);
  gA.connect(env); gB.connect(env);
  // Each oscillator to its own scope (scopes.js), on its own.
  if (!ac && typeof scopeTap === "function") { scopeTap("A", gA); scopeTap("B", gB); }
  // A slow wander shared by every oscillator in the note: drift.
  const drift = AT.atDrift / 100;
  const dl = c.createOscillator(), dg = c.createGain();
  dl.frequency.value = 0.06 + Math.random() * 0.2;
  dg.gain.value = drift * 12;
  dl.connect(dg);
  atStart(v, dl, time, v.end);
  // Glide: from where the last note was.
  const glide = ac || AT.atGlide <= 0 ? 0 : atExp(AT.atGlide, 5, 2000) / 1000, from = glide > 0 && atPrevFreq > 0 ? atPrevFreq / freq : 1;
  if (!ac) atPrevFreq = freq;
  const ctx = { v, time, end: v.end, dur, dg, glide, from };
  for (const [w, dest] of [["A", gA], ["B", gB]]) {
    const kind = AT["kind" + w], oct = AT[`at${w}Oct`] || 0;
    const p = { p1: AT[`at${w}1`] / 100, p2: AT[`at${w}2`] / 100, p3: AT[`at${w}3`] / 100 };
    (AT_BUILD[kind] || AT_BUILD.classic)(freq * Math.pow(2, oct), dest, p, ctx);
  }
  // Sub: a sine an octave down.
  if (AT.atSub > 0) {
    const g = c.createGain();
    g.gain.value = (AT.atSub / 100) * 0.45;
    atOsc(ctx, freq / 2, "sine", g, 0, 0, false);
    g.connect(env);
  }
  // Air: noise above 3 kHz, breath over the top.
  if (AT.atAir > 0) {
    const n = atNoiseSrc(v, time, v.end), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = "highpass"; hp.frequency.value = 3000;
    g.gain.value = (AT.atAir / 100) * 0.18;
    atLink(v, atBus.air, g.gain);
    n.connect(hp); hp.connect(g); g.connect(env);
  }
  (ac ? atAcVoices : atVoices).push(v);
}

function atStealOldest(v, time) {
  if (!v) return;
  v.env.gain.cancelScheduledValues(time);
  v.env.gain.setTargetAtTime(0, time, 0.03);
  for (const s of v.srcs) { try { s.stop(time + 0.25); } catch (e) { /* already set */ } }
  v.end = time + 0.25;
}

/// Join a long-lived bus to one note's node, remembered so it can be undone:
/// a bus still joined to a finished note would keep it alive.
function atLink(v, src, dest) {
  src.connect(dest);
  v.links.push([src, dest]);
}
function atCleanup(v) {
  for (const [src, dest] of v.links) { try { src.disconnect(dest); } catch (e) { /* gone */ } }
  v.links = [];
  v.cleaned = true;
}

function atStart(v, src, t, end) {
  src.start(t);
  src.stop(end);
  v.srcs.push(src);
}

/// One oscillator: a type or a wave, at `f` with glide and drift, `cents` off,
/// panned to `pan`. `bus` joins it to the Detune and Pan buses.
function atOsc(ctx, f, wave, dest, cents, pan, bus = true) {
  const c = audioCtx, o = c.createOscillator();
  if (typeof wave === "string") o.type = wave; else o.setPeriodicWave(wave);
  o.detune.value = cents;
  if (ctx.glide > 0 && ctx.from !== 1) {
    o.frequency.setValueAtTime(f * ctx.from, ctx.time);
    o.frequency.exponentialRampToValueAtTime(f, ctx.time + ctx.glide);
  } else o.frequency.value = f;
  ctx.dg.connect(o.detune);
  if (bus) atLink(ctx.v, atBus.detune, o.detune);
  let out = o;
  if (pan) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    if (bus) atLink(ctx.v, atBus.pan, p.pan);
    o.connect(p);
    out = p;
  }
  out.connect(dest);
  atStart(ctx.v, o, ctx.time, ctx.end);
  return o;
}

function atNoiseSrc(v, t, end) {
  const s = audioCtx.createBufferSource();
  s.buffer = atNoise;
  s.loop = true;
  s.loopStart = Math.random() * 1.5;
  atStart(v, s, t, end);
  return s;
}

/// A stack of `n` unison oscillators, spread by Detune and Width.
function atUnison(ctx, f, wave, dest, n, spreadMul = 1) {
  const c = audioCtx, g = c.createGain();
  g.gain.value = 1 / Math.sqrt(n);
  g.connect(dest);
  const det = AT.atDetune * spreadMul, width = AT.atWidth / 100;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    atOsc(ctx, f, wave, g, x * det + (Math.random() - 0.5) * AT.atDrift * 0.08, x * width);
  }
}

/// Each kind's make-up gain, so that switching kinds keeps the level: set from
/// offline renders of one note (tests/ui/sequencer-atmos.spec.mjs).
const AT_LEVEL = { glass: 1000, breath: 100, choir: 15, spectrum: 2.2, cloud: 2.0 };

const AT_BUILD = {
  classic(f, dest, p, ctx) {
    atUnison(ctx, f, ["sine", "triangle", "sawtooth", "square"][Math.round(p.p1 * 3)], dest, Math.round(AT.atUnison));
  },
  supersaw(f, dest, p, ctx) {
    atUnison(ctx, f, "sawtooth", dest, Math.max(5, Math.round(AT.atUnison)), 0.5 + p.p1 * 1.5);
  },
  /// Partials on the scale's own intervals. Fit 0: the harmonic series; Fit 1:
  /// each harmonic moved to the nearest interval the scale has, in any octave.
  spectrum(f, dest, p, ctx) {
    const c = audioCtx, sc = SCALES[selectedScaleIdx], cents = sc ? sc.cents : [0];
    const n = atPartials(p.p3), e = 2.2 - p.p2 * 1.8, width = AT.atWidth / 100, g = c.createGain();
    let sum = 0;
    const parts = [];
    for (let k = 1; k <= n; k++) {
      const h = 1200 * Math.log2(k);
      let near = h, best = Infinity;
      for (let o = 0; o <= 6; o++) for (const ct of cents) { const s = o * 1200 + ct, dd = Math.abs(s - h); if (dd < best) { best = dd; near = s; } }
      const amp = 1 / Math.pow(k, e);
      sum += amp;
      parts.push({ k, h, near, amp });
    }
    g.gain.value = AT_LEVEL.spectrum / sum;
    g.connect(dest);
    for (const { k, h, near, amp } of parts) {
      const pg = c.createGain();
      pg.gain.value = amp;
      pg.connect(g);
      // The fitted partial: h moved toward the scale by Fit, in cents off the harmonic.
      const o = atOsc(ctx, f * k, "sine", pg, (near - h) * p.p1, k === 1 ? 0 : (k % 2 ? 1 : -1) * width * 0.6);
      // AT FIT: the bus moves every partial the rest of the way, or back.
      if (k > 1 && near !== h) { const fg = c.createGain(); fg.gain.value = (near - h); atLink(ctx.v, atBus.fit, fg); fg.connect(o.detune); }
    }
  },
  /// Stacked voices through three vowel formants.
  choir(f, dest, p, ctx) {
    const c = audioCtx, voices = 1 + Math.round(p.p2 * 7), mix = c.createGain();
    mix.gain.value = 1 / Math.sqrt(voices);
    const vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 4.8 + Math.random() * 0.8;
    vg.gain.value = 9;
    vib.connect(vg);
    atStart(ctx.v, vib, ctx.time, ctx.end);
    const width = AT.atWidth / 100;
    for (let i = 0; i < voices; i++) {
      const x = voices === 1 ? 0 : (i / (voices - 1)) * 2 - 1;
      const o = atOsc(ctx, f, "sawtooth", mix, x * (AT.atDetune * 0.6 + 6), x * width);
      vg.connect(o.detune);
    }
    const fm = atVowel(p.p1), amps = [1, 0.55, 0.3], qs = [9, 12, 14], out = c.createGain();
    out.gain.value = AT_LEVEL.choir;
    out.connect(dest);
    let breath = null;
    if (p.p3 > 0) {
      breath = c.createGain();
      breath.gain.value = p.p3 * 0.5;
      atNoiseSrc(ctx.v, ctx.time, ctx.end).connect(breath);
    }
    fm.forEach((hz, i) => {
      const bp = c.createBiquadFilter(), g = c.createGain(), vb = c.createGain();
      bp.type = "bandpass";
      bp.frequency.value = hz;
      bp.Q.value = qs[i];
      vb.gain.value = [200, 600, 400][i];
      atLink(ctx.v, atBus.vowel, vb); vb.connect(bp.frequency);
      g.gain.value = amps[i];
      mix.connect(bp);
      if (breath) breath.connect(bp);
      bp.connect(g); g.connect(out);
    });
  },
  /// Modal: a strike or a bow through resonators, from string to bell.
  glass(f, dest, p, ctx) {
    const c = audioCtx, STR = [1, 2, 3, 4, 5, 6], BELL = [1, 2.756, 5.404, 8.933, 13.34, 18.64];
    const tau = 0.3 + p.p2 * 6, strike = p.p3, ex = c.createGain(), out = c.createGain();
    ex.gain.value = 1;
    out.gain.value = 1;
    out.connect(dest);
    // The strike: a short burst. The bow: noise held for the note, darkened.
    const n = atNoiseSrc(ctx.v, ctx.time, ctx.end);
    const burst = c.createGain(), bow = c.createGain(), lp = c.createBiquadFilter();
    burst.gain.setValueAtTime(strike * 1.2, ctx.time);
    burst.gain.setTargetAtTime(0, ctx.time + 0.002, 0.004);
    bow.gain.value = (1 - strike) * 0.12;
    lp.type = "lowpass"; lp.frequency.value = Math.min(18000, f * 6);
    n.connect(burst); burst.connect(ex);
    n.connect(lp); lp.connect(bow); bow.connect(ex);
    STR.forEach((sr, k) => {
      const ratio = sr + (BELL[k] - sr) * p.p1, fk = f * ratio;
      if (fk > 18000) return;
      const tk = tau / Math.sqrt(k + 1), Q = Math.max(2, Math.min(4000, Math.PI * fk * tk));
      const bp = c.createBiquadFilter(), g = c.createGain();
      bp.type = "bandpass"; bp.frequency.value = fk; bp.Q.value = Q;
      g.gain.value = AT_LEVEL.glass * Math.sqrt(Q / fk) / Math.pow(k + 1, 0.7);
      ex.connect(bp); bp.connect(g); g.connect(out);
    });
  },
  /// Noise tuned to the note: focus narrows it, grit adds a rougher octave.
  breath(f, dest, p, ctx) {
    const c = audioCtx, Q = 4 + p.p1 * 70, n = atNoiseSrc(ctx.v, ctx.time, ctx.end);
    for (const [mul, lvl] of [[1, 1], [2, 0.35 + p.p2 * 0.5]]) {
      const bp = c.createBiquadFilter(), g = c.createGain();
      bp.type = "bandpass"; bp.frequency.value = f * mul; bp.Q.value = Q * (mul === 1 ? 1 : 0.6 + (1 - p.p2) * 0.4);
      g.gain.value = AT_LEVEL.breath * Math.sqrt(Q / (f * mul)) * lvl;
      n.connect(bp); bp.connect(g); g.connect(dest);
    }
  },
  /// A frozen spectrum: two random-phase waves, a little apart, slowly trading places.
  cloud(f, dest, p, ctx) {
    const c = audioCtx, n = 8 + Math.round(p.p3 * 56), waves = atCloudWaves(n), g1 = c.createGain(), g2 = c.createGain();
    const lfo = c.createOscillator(), lg = c.createGain(), inv = c.createGain();
    lfo.frequency.value = 0.03 + p.p2 * 0.6;
    lg.gain.value = 0.5; inv.gain.value = -0.5;
    lfo.connect(lg); lfo.connect(inv);
    g1.gain.value = 0.5; g2.gain.value = 0.5;
    lg.connect(g1.gain); inv.connect(g2.gain);
    atStart(ctx.v, lfo, ctx.time, ctx.end);
    const smear = p.p1 * 15, width = AT.atWidth / 100;
    atOsc(ctx, f, waves[0], g1, -smear, -width * 0.7);
    atOsc(ctx, f, waves[1], g2, smear, width * 0.7);
    const out = c.createGain();
    out.gain.value = AT_LEVEL.cloud;
    g1.connect(out); g2.connect(out); out.connect(dest);
  },
  /// Shepard: octaves under a bell, all gliding together by Rise over the note.
  endless(f, dest, p, ctx) {
    const c = audioCtx, rise = (p.p1 - 0.5) * 2, sigma = 0.8 + p.p2 * 1.5, out = c.createGain();
    out.gain.value = 0.55;
    out.connect(dest);
    for (let k = 0; k < 6; k++) {
      const fk = f * Math.pow(2, k - 2), g = c.createGain();
      if (fk < 20 || fk > 16000) continue;
      g.gain.value = Math.exp(-Math.pow(k - 2, 2) / (2 * sigma * sigma));
      g.connect(out);
      const o = atOsc(ctx, fk, "sine", g, 0, (k % 2 ? 1 : -1) * (AT.atWidth / 100) * 0.5);
      if (rise !== 0) {
        o.frequency.cancelScheduledValues(ctx.time);
        o.frequency.setValueAtTime(fk, ctx.time);
        o.frequency.exponentialRampToValueAtTime(fk * Math.pow(2, rise), ctx.time + Math.max(0.05, ctx.dur));
      }
    }
  },
};

/// Random-phase waves for Cloud, made once per context and partial count.
function atCloudWaves(n) {
  if (atWaveCache.has(n)) return atWaveCache.get(n);
  const make = () => {
    const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) {
      const a = (0.6 + Math.random() * 0.4) / Math.pow(k, 0.9), ph = Math.random() * Math.PI * 2;
      re[k] = a * Math.cos(ph);
      im[k] = a * Math.sin(ph);
    }
    return audioCtx.createPeriodicWave(re, im);
  };
  const w = [make(), make()];
  atWaveCache.set(n, w);
  return w;
}

// ─── THE LFOS ────────────────────────────────────────────────────────────────
/// `getLFOTargetParam` asks here for targets it does not know.
function atmosLfoParam(target) {
  const k = String(target || "").replace(/^at-/, "");
  if (target && target.startsWith("bd-")) return typeof bandLfoParam === "function" ? bandLfoParam(target) : null;
  return target && target.startsWith("at-") && atBus[k] ? atBus[k].offset : null;
}
/// And how deep: detune in cents, pan and blend in their own units, vowel and fit as a share.
function atmosLfoGain(lfo) {
  switch (lfo.target) {
    case "at-detune": return lfo.depth * 40;
    case "at-pan": return lfo.depth;
    case "at-air": return lfo.depth * 0.18;
    case "at-blend": return lfo.depth;
    case "at-vowel": return lfo.depth;
    case "at-fit": return lfo.depth * 0.5;
    default: return typeof bandLfoGain === "function" ? bandLfoGain(lfo) : 0;
  }
}

// ─── START ───────────────────────────────────────────────────────────────────
atmosBuildUI();
atmosRead();
