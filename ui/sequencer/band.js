// The Band (ours, not the sequencer repository's; 14 Nov 2026, the plan
// `WORK DIR/page-mockups/SEQ-BAND-PLAN.md`, the mock-up `seq-band.html`).
// RJ: "each one of those auto accompaniment parts should be its own instrument
// that can be tweaked and modified in addition to the main one … it's like a
// whole band … Each one has its own mixer … Band in a Box 2026 for advanced
// electronic music … dub techno and IDM … make sure that it is all
// controllable, configurable, and editable." And: "just do it all at once."
//
// Six parts: the melody (Classic and Atmosphere, as they were), Drums
// (drums.js), Bass, Chords, Arp and Drone. What each plays comes from
// accompany.js (the harmony, from the scale's own cents) and drums.js (the
// grid); what it sounds like is here:
//
//   Bass    a sine, dub and deep: weight (a touch of the octave), drive, a low-pass, glide
//   Chords  its own Atmosphere patch (atmos.js), apart from the melody's, and its own filter
//   Arp     a plain synth, sine to square, plucked through its own filter
//   Drone   its own Atmosphere patch and filter
//
// **The mixer.** A channel for each part, the melody's included: level, pan,
// mute, solo, a meter, and two sends, to the delay and to Space. The melody
// keeps its old path through the filter and, at its default sends of 100 %, sounds
// as it did. The band's dry signals go straight to the master, past the delay's
// dry/wet; the delay's Wet and Space's Wet are the returns.
//
// **Style** writes a whole band from a seed, after the research in
// `WORK DIR/page-mockups/DUB-TECHNO-RESEARCH.md`: Basic Channel, DeepChord /
// Echospace, half-time dub (Rhythm & Sound), IDM-leaning. It writes the same
// controls a person would, so everything it makes can be edited by hand. With
// **Arrange** on, parts come in and go out over the trip (the Journey's length
// when it is on, else 128 bars), worked out from the step boundary like
// everything else.

// ─── THE CHANNELS ────────────────────────────────────────────────────────────
// [id, name, colour family, level, pan, delay send, space send]
const BD_CH = [
  { c: "Mel", part: "melody", name: "MELODY", fam: "pitch", lv: 80, dly: 100, spc: 100 },
  { c: "Drm", part: "drums", name: "DRUMS", fam: "attack", lv: 80, dly: 0, spc: 0 },
  { c: "Bas", part: "bass", name: "BASS", fam: "tone", lv: 80, dly: 0, spc: 0 },
  { c: "Chd", part: "chord", name: "CHORDS", fam: "space", lv: 70, dly: 70, spc: 25 },
  { c: "Arp", part: "arp", name: "ARP", fam: "time", lv: 60, dly: 40, spc: 30 },
  { c: "Drn", part: "drone", name: "DRONE", fam: "level", lv: 55, dly: 20, spc: 60 },
];
const bdGain = (v) => Math.pow(Math.max(0, v) / 80, 2);
const bdDb = (v) => (v <= 0 ? "−∞" : (20 * Math.log10(bdGain(v))).toFixed(1));

// ─── THE INSTRUMENTS' CONTROLS ───────────────────────────────────────────────
// [id, label, min, max, default, reading]
const pct = (v) => Math.round(v) + "%";
const ms = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms");
const hz = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz");
const bdExp = (v, lo, hi) => lo * Math.pow(hi / lo, v / 100);
const BD_KNOBS = {
  bass: [
    ["bsWeight", "Weight", 0, 100, 10, pct], ["bsDrive", "Drive", 0, 100, 15, pct], ["bsLp", "Low-pass", 0, 100, 45, (v) => hz(bdExp(v, 60, 4000))],
    ["bsOct", "Octave", 1, 2, 1, (v) => (v >= 1.5 ? "−2" : "−1")], ["bsAtk", "Attack", 0, 100, 10, (v) => ms(bdExp(v, 1, 300))],
    ["bsLen", "Length", 10, 100, 85, pct], ["bsRel", "Release", 0, 100, 35, (v) => ms(bdExp(v, 10, 2000))], ["bsGlide", "Glide", 0, 100, 0, (v) => (v <= 0 ? "off" : ms(bdExp(v, 5, 500)))],
  ],
  chord: [
    ["chSpread", "Spread", 0, 100, 30, (v) => (v < 20 ? "close" : v < 60 ? "open" : "wide")], ["chStab", "Stab", 0, 100, 35, (v) => bdStabName(v)],
    ["chCut", "Cutoff", 0, 100, 45, (v) => hz(bdExp(v, 150, 12000))], ["chRes", "Reso", 0, 100, 30, (v) => "Q " + (0.5 + (v / 100) * 11.5).toFixed(1)],
    ["chEnv", "Env amt", 0, 100, 35, pct], ["chEnvDec", "Env dec", 0, 100, 40, (v) => ms(bdExp(v, 20, 2000))],
  ],
  arp: [
    ["apRange", "Range", 1, 3, 2, (v) => Math.round(v) + " oct"], ["apGate", "Gate", 5, 100, 60, pct],
    ["apCut", "Cutoff", 0, 100, 60, (v) => hz(bdExp(v, 150, 12000))], ["apRes", "Reso", 0, 100, 25, (v) => "Q " + (0.5 + (v / 100) * 11.5).toFixed(1)],
    ["apEnv", "Env amt", 0, 100, 50, pct], ["apDec", "Decay", 0, 100, 35, (v) => ms(bdExp(v, 20, 2000))],
  ],
  drone: [
    ["drSwell", "Swell", 0, 100, 60, (v) => { const b = 0.25 * Math.pow(32, v / 100); return b < 1 ? b.toFixed(2) + " bar" : b.toFixed(b < 2 ? 1 : 0) + " bars"; }],
    ["drCut", "Cutoff", 0, 100, 55, (v) => hz(bdExp(v, 150, 12000))], ["drRes", "Reso", 0, 100, 15, (v) => "Q " + (0.5 + (v / 100) * 11.5).toFixed(1)],
  ],
};
const BD_STABS = [[0.125, "1/32"], [0.25, "1/16"], [0.5, "1/8"], [1, "1/4"]];
function bdStabName(v) { return BD_STABS[Math.min(3, Math.floor(v / 25))][1]; }
function bdStabBeats(v) { return BD_STABS[Math.min(3, Math.floor(v / 25))][0]; }
const BD_FILTERS = [["lowpass", "LP"], ["highpass", "HP"], ["bandpass", "BP"]];

// The Atmosphere patches of Chords and Drone: the keys a note reads (atmos.js).
const BD_PATCH_KEYS = ["atA1", "atA2", "atA3", "atAOct", "atB1", "atB2", "atB3", "atBOct", "atBlend", "atUnison", "atDetune", "atWidth", "atDrift", "atSub", "atAir", "atAtk", "atDec", "atSus", "atRel", "atVol"];
// The ones on the panel; the rest are kept, in presets, from the starting sound.
const BD_PATCH_SHOWN = [["atBlend", "Blend"], ["atUnison", "Unison"], ["atDetune", "Detune"], ["atWidth", "Width"], ["atDrift", "Drift"], ["atAir", "Air"], ["atAtk", "Attack"], ["atDec", "Decay"], ["atSus", "Sustain"], ["atRel", "Release"]];
const BD_PATCH_STARTS = {
  chord: {
    "dub-chord": { name: "Dub chord", kinds: ["supersaw", "classic"], v: { atA1: 20, atA2: 0, atA3: 0, atAOct: 0, atB1: 100, atB2: 0, atB3: 0, atBOct: -1, atBlend: 25, atUnison: 3, atDetune: 8, atWidth: 70, atDrift: 5, atSub: 0, atAir: 3, atAtk: 5, atDec: 45, atSus: 10, atRel: 40, atVol: 75 } },
    "warm-pad": { name: "Warm pad", kinds: ["supersaw", "choir"], v: { atA1: 40, atA2: 0, atA3: 0, atAOct: 0, atB1: 30, atB2: 50, atB3: 20, atBOct: 0, atBlend: 45, atUnison: 5, atDetune: 14, atWidth: 85, atDrift: 25, atSub: 10, atAir: 10, atAtk: 60, atDec: 70, atSus: 80, atRel: 70, atVol: 70 } },
    glass: { name: "Glass", kinds: ["glass", "spectrum"], v: { atA1: 80, atA2: 50, atA3: 70, atAOct: 0, atB1: 90, atB2: 60, atB3: 40, atBOct: 1, atBlend: 40, atUnison: 1, atDetune: 4, atWidth: 60, atDrift: 10, atSub: 0, atAir: 5, atAtk: 5, atDec: 70, atSus: 25, atRel: 65, atVol: 70 } },
    organ: { name: "Organ", kinds: ["classic", "spectrum"], v: { atA1: 0, atA2: 0, atA3: 0, atAOct: 0, atB1: 0, atB2: 80, atB3: 30, atBOct: 1, atBlend: 35, atUnison: 2, atDetune: 6, atWidth: 50, atDrift: 8, atSub: 25, atAir: 0, atAtk: 15, atDec: 60, atSus: 90, atRel: 45, atVol: 70 } },
  },
  drone: {
    "dark-drone": { name: "Dark drone", kinds: ["supersaw", "cloud"], v: { ...AT_START_VALUES["dark-drone"].v } },
    "cathedral-air": { name: "Cathedral air", kinds: ["breath", "choir"], v: { ...AT_START_VALUES["cathedral-air"].v } },
    "glass-choir": { name: "Glass choir", kinds: ["choir", "spectrum"], v: { ...AT_START_VALUES["glass-choir"].v } },
    "endless-rise": { name: "Endless rise", kinds: ["endless", "cloud"], v: { ...AT_START_VALUES["endless-rise"].v } },
  },
};
const bdPatchId = (part, key) => `${part === "chord" ? "ch" : "dr"}${key[0].toUpperCase()}${key.slice(1)}Slider`;
const bdKindId = (part, w) => `${part === "chord" ? "ch" : "dr"}Kind${w}Select`;

// ─── WHAT PRESETS, MORPHS AND THE RECORDER CARRY ─────────────────────────────
const BAND_MORPH_IDS = [
  ...BD_CH.flatMap((ch) => [`mx${ch.c}LevelSlider`, `mx${ch.c}PanSlider`, `mx${ch.c}DlySlider`, `mx${ch.c}SpcSlider`]),
  ...Object.values(BD_KNOBS).flat().map((k) => k[0] + "Slider"),
  ...["chord", "drone"].flatMap((p) => BD_PATCH_KEYS.map((k) => bdPatchId(p, k))),
  "bdSwingSlider",
];
const BAND_SLIDER_IDS = [...BAND_MORPH_IDS, "bdSeedSlider", ...(typeof DRUMS_SLIDER_IDS !== "undefined" ? DRUMS_SLIDER_IDS : [])];
const BAND_SELECT_IDS = [
  ...BD_CH.flatMap((ch) => [`mx${ch.c}MuteSelect`, `mx${ch.c}SoloSelect`]),
  "apWaveSelect", "chFltSelect", "drFltSelect", "bsLineText", "bdStyleSelect", "bdArrangeSelect",
  ...["chord", "drone"].flatMap((p) => [bdKindId(p, "A"), bdKindId(p, "B")]),
  ...(typeof DRUMS_SELECT_IDS !== "undefined" ? DRUMS_SELECT_IDS : []),
];
const BAND_ALL_MORPH_IDS = [...BAND_MORPH_IDS, ...(typeof DRUMS_MORPH_IDS !== "undefined" ? DRUMS_MORPH_IDS : [])];

// ─── THE VALUES ──────────────────────────────────────────────────────────────
const BAND = { swing: 50, style: "none", arrange: false, ch: {}, bass: {}, chord: {}, arp: {}, drone: {}, patch: { chord: {}, drone: {} }, edit: "drums" };

function bandRead() {
  const v = (id, d) => { const el = document.getElementById(id); return el ? el.value : d; };
  BAND.swing = +v("bdSwingSlider", 50);
  BAND.style = v("bdStyleSelect", "none");
  BAND.arrange = v("bdArrangeSelect", "off") === "on";
  const solo = BD_CH.some((ch) => v(`mx${ch.c}SoloSelect`, "off") === "on");
  for (const ch of BD_CH) {
    BAND.ch[ch.c] = {
      lv: +v(`mx${ch.c}LevelSlider`, ch.lv), pan: +v(`mx${ch.c}PanSlider`, 0), dly: +v(`mx${ch.c}DlySlider`, ch.dly), spc: +v(`mx${ch.c}SpcSlider`, ch.spc),
      mute: v(`mx${ch.c}MuteSelect`, "off") === "on", solo: v(`mx${ch.c}SoloSelect`, "off") === "on",
    };
    BAND.ch[ch.c].heard = !BAND.ch[ch.c].mute && (!solo || BAND.ch[ch.c].solo);
  }
  for (const [part, knobs] of Object.entries(BD_KNOBS)) for (const [id, , , , d] of knobs) BAND[part][id] = +v(id + "Slider", d);
  BAND.arp.wave = v("apWaveSelect", "triangle");
  BAND.chord.flt = v("chFltSelect", "lowpass");
  BAND.drone.flt = v("drFltSelect", "lowpass");
  BAND.bass.line = v("bsLineText", "R-..........R.5.");
  for (const part of ["chord", "drone"]) {
    const p = {};
    for (const k of BD_PATCH_KEYS) p[k] = +v(bdPatchId(part, k), 0);
    p.kindA = v(bdKindId(part, "A"), "supersaw");
    p.kindB = v(bdKindId(part, "B"), "classic");
    BAND.patch[part] = p;
  }
  bandApply();
  bandPaint();
}

// ─── THE GRAPH ───────────────────────────────────────────────────────────────
let bdNodes = null;

/// Built once per context, by `initAudio` (through `accompanyInit`), after
/// Atmosphere's graph. The melody leaves the filter into its own channel.
function bandInit() {
  const c = audioCtx;
  if (!c || !filterNode || !masterGain) return;
  const dlyIn = delayL, spcIn = typeof atRev !== "undefined" && atRev ? atRev.gate : null;
  // The melody: out of the filter into its channel, instead of straight into
  // the dry path, the delay and Space.
  for (const d of [delayDryGain, delayL, spcIn]) { if (d) try { filterNode.disconnect(d); } catch (e) { /* not joined */ } }
  const N = { ch: {}, slots: {}, dlyIn, spcIn };
  for (const ch of BD_CH) {
    const x = { in: c.createGain(), fader: c.createGain(), pan: c.createStereoPanner(), dly: c.createGain(), spc: c.createGain(), meter: c.createAnalyser(), extraDly: c.createGain(), extraSpc: c.createGain() };
    x.meter.fftSize = 512;
    x.in.connect(x.fader); x.fader.connect(x.pan);
    // The melody's dry goes where it always went: the delay's dry side.
    x.pan.connect(ch.c === "Mel" ? delayDryGain : masterGain);
    x.pan.connect(x.dly); x.pan.connect(x.spc); x.pan.connect(x.meter);
    if (dlyIn) { x.dly.connect(dlyIn); x.extraDly.connect(dlyIn); }
    if (spcIn) { x.spc.connect(spcIn); x.extraSpc.connect(spcIn); }
    N.ch[ch.c] = x;
  }
  filterNode.connect(N.ch.Mel.in);
  // Chords and Drone: Atmosphere's accompaniment chain → their filters → channels.
  N.chordFlt = c.createBiquadFilter();
  N.droneFlt = c.createBiquadFilter();
  N.chordIn = c.createGain();
  N.droneIn = c.createGain();
  N.chordIn.connect(N.chordFlt); N.chordFlt.connect(N.ch.Chd.in);
  N.droneIn.connect(N.droneFlt); N.droneFlt.connect(N.ch.Drn.in);
  // The drum slots: their own level, pan and sends, into the drums' channel.
  for (const s of DM_SLOTS) {
    const y = { g: c.createGain(), pan: c.createStereoPanner(), dly: c.createGain(), spc: c.createGain() };
    y.g.connect(y.pan); y.pan.connect(N.ch.Drm.in); y.pan.connect(y.dly); y.pan.connect(y.spc);
    y.dly.connect(N.ch.Drm.extraDly); y.spc.connect(N.ch.Drm.extraSpc);
    N.slots[s.k] = y;
  }
  bdNodes = N;
  bdPrevBass = 0;
  bandApply(true);
}

/// Every level, pan, send and filter, from the values.
function bandApply(now) {
  const N = bdNodes;
  if (!N || !audioCtx) return;
  const t = audioCtx.currentTime, set = (p, v) => (now ? (p.value = v) : p.setTargetAtTime(v, t, 0.02));
  for (const ch of BD_CH) {
    const x = N.ch[ch.c], V = BAND.ch[ch.c];
    if (!V) continue;
    const g = V.heard ? bdGain(V.lv) : 0;
    set(x.fader.gain, g);
    set(x.pan.pan, V.pan / 100);
    set(x.dly.gain, V.dly / 100);
    set(x.spc.gain, V.spc / 100);
    set(x.extraDly.gain, g);
    set(x.extraSpc.gain, g);
  }
  for (const [nd, part] of [[N.chordFlt, "chord"], [N.droneFlt, "drone"]]) {
    const P = BAND[part];
    if (P.flt) nd.type = P.flt;
    const cut = part === "chord" ? P.chCut : P.drCut, res = part === "chord" ? P.chRes : P.drRes;
    set(nd.frequency, bdExp(cut ?? 50, 150, 12000));
    set(nd.Q, 0.5 + ((res ?? 20) / 100) * 11.5);
  }
  bandApplyDrums(now);
}
function bandApplyDrums(now) {
  const N = bdNodes;
  if (!N || !audioCtx || typeof DM === "undefined") return;
  const t = audioCtx.currentTime, set = (p, v) => (now ? (p.value = v) : p.setTargetAtTime(v, t, 0.02));
  for (const s of DM_SLOTS) {
    const y = N.slots[s.k], P = DM.slots[s.k];
    if (!y || !P) continue;
    set(y.g.gain, Math.pow(P.lv / 100, 1.5));
    set(y.pan.pan, P.pan / 100);
    set(y.dly.gain, P.dly / 100);
    set(y.spc.gain, P.spc / 100);
  }
}

// ─── THE VOICES ──────────────────────────────────────────────────────────────
let bdPrevBass = 0;
const bdVoices = [];

/// One planned note (accompany.js) or drum hit (drums.js), at `t`.
function bandVoice(e, t) {
  const N = bdNodes;
  if (!N) return;
  if (e.part === "drum") return drumHit(e.slot, t, e.vel, N.slots[e.slot].g);
  if (e.part === "bass") return bdBass(e, t);
  if (e.part === "arp") return bdArp(e, t);
  if (e.part === "chord" || e.part === "drone") {
    const P = BAND[e.part], patch = BAND.patch[e.part];
    const o = { ac: true, gain: (e.part === "chord" ? 0.9 : 1.1) / Math.sqrt(e.n || 1), patch, into: e.part === "chord" ? N.chordIn : N.droneIn };
    if (e.part === "drone") { const sw = 0.25 * Math.pow(32, P.drSwell / 100) * 4 * (60 / bpm); o.atk = sw; o.rel = sw; }
    atmosPlay(e.hz, t, e.dur, o);
    // The chord's filter opens with each chord, by Env amt, over Env dec.
    if (e.part === "chord" && e.first && P.chEnv > 0) {
      const f = N.chordFlt.frequency, base = bdExp(P.chCut, 150, 12000) * (e.cut || 1), peak = Math.min(18000, base * (1 + (P.chEnv / 100) * 6));
      f.cancelScheduledValues(t);
      f.setValueAtTime(peak, t);
      f.setTargetAtTime(base, t, bdExp(P.chEnvDec, 20, 2000) / 3000);
    }
  }
}

/// The bass: a sine, with the octave above by Weight, through drive and a low-pass.
function bdBass(e, t) {
  const c = audioCtx, P = BAND.bass, N = bdNodes;
  const o = c.createOscillator(), o2 = c.createGain(), w = c.createOscillator(), env = c.createGain(), sh = c.createWaveShaper(), lp = c.createBiquadFilter();
  o.type = "sine"; w.type = "sine";
  const glide = P.bsGlide > 0 ? bdExp(P.bsGlide, 5, 500) / 1000 : 0;
  if (glide && bdPrevBass) {
    o.frequency.setValueAtTime(bdPrevBass, t); o.frequency.exponentialRampToValueAtTime(e.hz, t + glide);
    w.frequency.setValueAtTime(bdPrevBass * 2, t); w.frequency.exponentialRampToValueAtTime(e.hz * 2, t + glide);
  } else { o.frequency.value = e.hz; w.frequency.value = e.hz * 2; }
  bdPrevBass = e.hz;
  o2.gain.value = (P.bsWeight / 100) * 0.35;
  w.connect(o2);
  const drive = P.bsDrive / 100, k = 1 + drive * 8, n = 512, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = drive < 0.01 ? x : Math.tanh(k * x) / Math.tanh(k); }
  sh.curve = curve;
  lp.type = "lowpass"; lp.frequency.value = bdExp(P.bsLp, 60, 4000); lp.Q.value = 0.7;
  const atk = bdExp(P.bsAtk, 1, 300) / 1000, rel = bdExp(P.bsRel, 10, 2000) / 1000, dur = Math.max(0.02, e.dur * (P.bsLen / 100));
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.55, t + atk);
  env.gain.setValueAtTime(0.55, t + Math.max(atk, dur));
  env.gain.setTargetAtTime(0, t + Math.max(atk, dur), rel / 4);
  o.connect(env); o2.connect(env); env.connect(sh); sh.connect(lp); lp.connect(N.ch.Bas.in);
  const end = t + Math.max(atk, dur) + rel * 1.5 + 0.05;
  o.start(t); w.start(t); o.stop(end); w.stop(end);
  bdVoices.push({ env, oscs: [o, w], start: t, end });
}

/// The arp: a plain wave, plucked through its own filter.
function bdArp(e, t) {
  const c = audioCtx, P = BAND.arp, N = bdNodes;
  const o = c.createOscillator(), f = c.createBiquadFilter(), env = c.createGain();
  o.type = P.wave || "triangle";
  o.frequency.value = e.hz;
  f.type = "lowpass"; f.Q.value = 0.5 + (P.apRes / 100) * 11.5;
  const cut = bdExp(P.apCut, 150, 12000), dec = bdExp(P.apDec, 20, 2000) / 1000, dur = Math.max(0.01, e.dur * (P.apGate / 100) / 0.8);
  f.frequency.setValueAtTime(Math.min(18000, cut * (1 + (P.apEnv / 100) * 6)), t);
  f.frequency.setTargetAtTime(cut, t, dec / 3);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.35, t + 0.003);
  env.gain.setTargetAtTime(0.35 * 0.3, t + 0.003, dec / 3);
  if (env.gain.cancelAndHoldAtTime) env.gain.cancelAndHoldAtTime(t + dur);
  env.gain.setTargetAtTime(0, t + dur, 0.015);
  o.connect(f); f.connect(env); env.connect(N.ch.Arp.in);
  const end = t + dur + 0.12;
  o.start(t); o.stop(end);
  bdVoices.push({ env, oscs: [o], start: t, end });
}

/// Let go of the band's own voices from `t` (the Atmosphere ones are atmos.js's).
function bandRelease(t) {
  for (const v of bdVoices) {
    if (v.end <= t) continue;
    if (v.start >= t) { v.env.gain.cancelScheduledValues(v.start); v.env.gain.setValueAtTime(0, v.start); }
    else { if (v.env.gain.cancelAndHoldAtTime) v.env.gain.cancelAndHoldAtTime(t); else v.env.gain.cancelScheduledValues(t); v.env.gain.setTargetAtTime(0, t, 0.04); }
    for (const o of v.oscs) { try { o.stop(Math.max(v.start, t) + 0.3); } catch (e) { /* set already */ } }
    v.end = t + 0.3;
  }
  const now = audioCtx ? audioCtx.currentTime : 0;
  for (let i = bdVoices.length - 1; i >= 0; i--) if (bdVoices[i].end < now) bdVoices.splice(i, 1);
}

/// A pad on the drum editor: the sound now.
function bandPadHit(slot) {
  if (!bdNodes || !audioCtx) return;
  drumHit(slot, audioCtx.currentTime + 0.01, 1, bdNodes.slots[slot].g);
  drumsFlash(slot);
}

// ─── ARRANGE: PARTS IN AND OUT OVER THE TRIP ─────────────────────────────────
// After the research's 128-bar map: intro, build, peak with a breakdown, outro.
// [part or drum row, comes in, goes out] as a share of the trip.
const BD_ARRANGE = [
  ["kick", 0, 0.94], ["ohh", 0.125, 0.875], ["chh", 0.25, 0.81], ["rim", 0.375, 0.75], ["perc", 0.375, 0.75], ["clap", 0.44, 0.75], ["snare", 0.44, 0.75],
  ["bass", 0.19, 0.9], ["chord", 0, 1], ["drone", 0, 1], ["arp", 0.5, 0.7],
];
const BD_BREAK = [0.57, 0.625]; // kick and bass out
/// Whether a part (or drum row) plays at boundary `k`, with Arrange on.
function bandArranged(what, k) {
  if (!BAND.arrange) return true;
  const bars = typeof J !== "undefined" && J.on ? J.bars : 128;
  const f = (((k * stepBeats) / (bars * 4)) % 1 + 1) % 1;
  if ((what === "kick" || what === "bass") && f >= BD_BREAK[0] && f < BD_BREAK[1]) return false;
  const a = BD_ARRANGE.find((x) => x[0] === what);
  return !a || (f >= a[1] && f < a[2]);
}
/// How far the trip has opened (0–1): the Journey's curve when it is on, else
/// the research's shape: up through the peak, down in the outro.
function bandOpen(k) {
  if (typeof J !== "undefined" && J.on && typeof journeyWhere === "function") return journeyCurve(journeyWhere(k).f);
  if (!BAND.arrange) return 0.5;
  const f = (((k * stepBeats) / (128 * 4)) % 1 + 1) % 1;
  return f < 0.45 ? f / 0.45 : f < 0.76 ? 1 : Math.max(0, 1 - (f - 0.76) / 0.24);
}

// ─── STYLE: A WHOLE BAND FROM A SEED ─────────────────────────────────────────
const BD_STYLES = {
  none: { name: "— none" },
  bc: { name: "Dub techno · Basic Channel", bpm: [130, 140], swing: [50, 54], kit: ["r909", "r808"], drums: "dub", chord: ["seventh", "triad", "ninth"], rhythm: ["stab2", "stab"], bass: ["offbeat", "dub"], cut: [35, 50], dTime: "0.75", fb: [40, 55], dWet: [35, 50], space: [18, 30], clap: true },
  deep: { name: "Dub techno · DeepChord", bpm: [116, 122], swing: [50, 53], kit: ["synth", "r808"], drums: "deep", chord: ["seventh", "ninth"], rhythm: ["stab", "stab2"], bass: ["held", "offbeat"], cut: [25, 38], dTime: "0.75", fb: [55, 70], dWet: [40, 55], space: [35, 55] },
  half: { name: "Dub · half time (Rhythm & Sound)", bpm: [128, 136], swing: [55, 60], kit: ["r808", "funky"], drums: "half", chord: ["triad", "seventh"], rhythm: ["stab"], bass: ["dub"], cut: [35, 50], dTime: "1", fb: [45, 60], dWet: [35, 50], space: [25, 40] },
  idm: { name: "IDM-leaning", bpm: [100, 140], swing: [50, 58], kit: ["r606", "cr78", "sp12", "synth"], drums: "broken", chord: ["fourth", "seventh"], rhythm: ["stab2", "change"], bass: ["walk", "dub"], cut: [40, 65], dTime: "0.75", fb: [30, 50], dWet: [25, 40], space: [20, 35], idm: true },
};

/// The style, from the seed: every control a person would set.
function bandGenerate() {
  const key = document.getElementById("bdStyleSelect").value, S = BD_STYLES[key];
  if (!S || !S.bpm) return;
  const seed = +document.getElementById("bdSeedSlider").value || 1;
  const rnd = jRng(seed * 7477 + key.length * 131);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const span = ([lo, hi]) => Math.round(lo + rnd() * (hi - lo));
  const set = (id, v, ev = "input") => { const el = document.getElementById(id); if (!el) return; el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); if (window.updateKnobVisual && ev === "input") window.updateKnobVisual(id); };
  // Tempo and swing.
  const tempo = span(S.bpm);
  set("bpmSlider", tempo);
  if (typeof updateBPM === "function") updateBPM(tempo);
  set("bdSwingSlider", span(S.swing));
  // The scale: minor, unless one is already chosen that is not the default major.
  if (typeof SCALES !== "undefined" && /^Ionian/.test(SCALES[selectedScaleIdx].name)) {
    const i = SCALES.findIndex((s) => /^Aeolian/.test(s.name));
    if (i >= 0) selectScale(i);
  }
  // Drums: the kit and the pattern, then the research's chances.
  set("dmKitSelect", pick(S.kit), "change");
  DM.grid = dmFromPattern(S.drums);
  for (const [slot, p] of [["ohh", 0.97], ["chh", 0.9], ["perc", 0.5], ["rim", 0.6]]) for (const st of DM.grid[slot].steps) if (st.v && st.c === 100) st.c = Math.round(p * 100);
  if (!S.clap) { for (const st of DM.grid.clap.steps) st.v = 0; }
  if (S.idm) {
    DM.grid.perc.len = pick([5, 7, 11]);
    for (const st of DM.grid.chh.steps) if (st.v && rnd() < 0.1) st.r = pick([2, 3, 4]);
  }
  // A ghost kick on the last 16th, sometimes.
  if (rnd() < 0.5) Object.assign(DM.grid.kick.steps[15], { v: 30, c: 10 });
  dmGridCommit();
  set("dmSeedSlider", seed);
  // The parts.
  const on = (part, yes) => set(`ac${part}OnSelect`, yes ? "on" : "off", "change");
  on("Drums", true); on("Bass", true); on("Chord", true); on("Drone", rnd() < 0.7); on("Arp", !!S.idm && rnd() < 0.5);
  set("acChordPatSelect", pick(S.chord) + "-" + pick(S.rhythm), "change");
  set("acBassPatSelect", pick(S.bass), "change");
  set("acDronePatSelect", rnd() < 0.5 ? "fifth" : "root", "change");
  set("acFollowSelect", "root", "change");
  // Sounds.
  bandStart("chord", key === "deep" ? "dub-chord" : pick(["dub-chord", "dub-chord", "organ"]));
  bandStart("drone", key === "deep" ? "dark-drone" : pick(["dark-drone", "cathedral-air"]));
  set("chCutSlider", span(S.cut)); set("chResSlider", span([20, 40])); set("chEnvSlider", span([20, 40])); set("chEnvDecSlider", span([30, 45]));
  set("chStabSlider", 30); set("chSpreadSlider", span([0, 30]));
  set("bsLpSlider", 30); set("bsWeightSlider", span([0, 15])); set("bsDriveSlider", span([5, 20])); set("bsOctSlider", 1);
  // The delay: dotted 1/8 (or the style's), feedback and wet; Space.
  set("delayTimeSelect", S.dTime, "change");
  set("delayFbSlider", span(S.fb)); set("delayWetSlider", span(S.dWet));
  if (typeof updateDelay === "function") updateDelay();
  set("atRevWetSlider", span(S.space));
  // The mixer: the stab mostly heard as echo; the melody down, under the band.
  const mix = { Mel: [50, 0, 60, 40], Drm: [80, 0, 0, 0], Bas: [82, 0, 0, 0], Chd: [62, span([-15, 15]), span([70, 95]), span([15, 25])], Arp: [50, -20, 40, 30], Drn: [48, 0, 15, 50] };
  for (const [c, [lv, pan, d, s]] of Object.entries(mix)) { set(`mx${c}LevelSlider`, lv); set(`mx${c}PanSlider`, pan); set(`mx${c}DlySlider`, d); set(`mx${c}SpcSlider`, s); }
  // Drum sends, after the research: rim and perc into the delay, hats a little.
  for (const [slot, d, s] of [["rim", 50, 15], ["perc", 40, 10], ["ohh", 10, 8], ["chh", 5, 5], ["clap", 25, 20], ["snare", 20, 15]]) {
    set(dmId(DM_SLOTS.find((x) => x.k === slot), "DlySlider"), d); set(dmId(DM_SLOTS.find((x) => x.k === slot), "SpcSlider"), s);
  }
  set("bdArrangeSelect", "on", "change");
  bandRead();
  drumsRead();
  accompanyRead();
}

/// A part's Atmosphere patch from one of its starting sounds.
function bandStart(part, key) {
  const s = BD_PATCH_STARTS[part][key];
  if (!s) return;
  for (const k of BD_PATCH_KEYS) {
    const el = document.getElementById(bdPatchId(part, k));
    if (!el) continue;
    el.value = s.v[k] ?? 0;
    if (window.updateKnobVisual) window.updateKnobVisual(bdPatchId(part, k));
  }
  document.getElementById(bdKindId(part, "A")).value = s.kinds[0];
  document.getElementById(bdKindId(part, "B")).value = s.kinds[1];
  const host = document.querySelector(`.bd-starts[data-p="${part}"]`);
  if (host) for (const b of host.children) b.classList.toggle("on", b.dataset.k === key);
  bandRead();
}

// ─── THE PAGE ────────────────────────────────────────────────────────────────
function bdKnob(id, label, min, max, value, step = 1) {
  return `<div class="knob-group"><span class="knob-label">${label}</span>`
    + `<div class="knob" onmousedown="knobDown(event, '${id}Slider')" ontouchstart="knobTouchStart(event,'${id}Slider')"></div>`
    + `<input type="range" class="knob-hidden" min="${min}" max="${max}" step="${step}" value="${value}" id="${id}Slider" oninput="bandRead()" />`
    + `<span class="knob-val" id="${id}Val"></span></div>`;
}
const bdKnobs = (part) => BD_KNOBS[part].map(([id, l, lo, hi, d]) => bdKnob(id, l, lo, hi, d)).join("");
const bdSel = (id, opts, v, seg) => `<select id="${id}"${seg ? " data-seg" : ""} onchange="bandRead()">${opts.map(([o, t]) => `<option value="${o}"${o === v ? " selected" : ""}>${t}</option>`).join("")}</select>`;

function bdPatchHtml(part) {
  const starts = BD_PATCH_STARTS[part];
  const kinds = (w, d) => `<select id="${bdKindId(part, w)}" onchange="bandRead()">${AT_KINDS.map((k) => `<option value="${k.id}"${k.id === d ? " selected" : ""}>${w} · ${k.name}</option>`).join("")}</select>`;
  const first = Object.values(starts)[0];
  const hidden = BD_PATCH_KEYS.filter((k) => !BD_PATCH_SHOWN.some(([s]) => s === k)).map((k) => `<input type="range" class="knob-hidden" id="${bdPatchId(part, k)}" min="-2" max="400" value="${first.v[k] ?? 0}" oninput="bandRead()" />`).join("");
  const shown = BD_PATCH_SHOWN.map(([k, l]) => {
    const def = AT_KNOBS.find((x) => x[0] === k);
    return `<div class="knob-group"><span class="knob-label">${l}</span><div class="knob" onmousedown="knobDown(event, '${bdPatchId(part, k)}')" ontouchstart="knobTouchStart(event,'${bdPatchId(part, k)}')"></div>`
      + `<input type="range" class="knob-hidden" min="${def[2]}" max="${def[3]}" step="1" value="${first.v[k] ?? def[4]}" id="${bdPatchId(part, k)}" oninput="bandRead()" />`
      + `<span class="knob-val" id="${bdPatchId(part, k).replace(/Slider$/, "Val")}"></span></div>`;
  }).join("");
  return `<div class="bd-sub bd-voice"><div class="bd-sh"><span class="cap">The voice</span><span class="meta">Atmosphere · its own patch, apart from the melody's</span></div>`
    + `<div class="bd-kinds">${kinds("A", first.kinds[0])}${kinds("B", first.kinds[1])}</div><div class="bd-knobs">${shown}</div>${hidden}</div>`;
}

function bandBuildUI() {
  const host = document.getElementById("accompanyHost");
  if (!host || document.getElementById("bdSwingSlider")) return;
  host.classList.add("band");
  const cards = [
    `<div class="ac-part bd-card" data-p="melody" style="--fc: var(--f-pitch)"><div class="ac-pt"><button type="button" class="power on" data-mel title="The melody on or off (its channel's mute)"></button><b>MELODY</b><em>Classic + Atmos</em></div>`
      + `<div class="ac-roll"><canvas id="acMelodyRoll" width="200" height="30"></canvas></div><div class="bd-ft"><span class="meta bd-steps">the steps, below</span><button type="button" class="btn bd-edit" data-p="melody">Edit</button></div></div>`,
    ...AC_PARTS.map((p) => `<div class="ac-part bd-card" data-p="${p.k}" style="--fc: var(--f-${p.fam})"><div class="ac-pt"><button type="button" class="power" data-ac="${p.k}" title="${p.name} on or off"></button><b>${p.name}</b><em>${p.what}</em>`
      + `<select id="${acId(p, "OnSelect")}" class="at-hidden" onchange="accompanyRead()"><option value="off" selected>off</option><option value="on">on</option></select></div>`
      + `<div class="ac-roll"><canvas id="${acId(p, "Roll")}" width="200" height="30"></canvas></div>`
      + `<div class="bd-ft">${p.k === "drums" ? `<select id="bdKitCard" class="ac-pat" title="The kit"></select>` : `<select id="${acId(p, "PatSelect")}" class="ac-pat" onchange="accompanyRead()">${p.pat.map(([v, t]) => `<option value="${v}"${v === p.def ? " selected" : ""}>${t}</option>`).join("")}</select>`}`
      + `<button type="button" class="btn bd-edit" data-p="${p.k}">Edit</button></div></div>`),
  ].join("");
  const mixer = BD_CH.map((ch) => `<div class="bd-strip" data-c="${ch.c}" style="--fc: var(--f-${ch.fam})"><div class="bd-sn">${ch.name}<em id="mx${ch.c}Db"></em></div>`
    + `<div class="bd-fader"><canvas class="bd-meter" id="mx${ch.c}Meter" width="12" height="120"></canvas><input type="range" class="bd-vfader" id="mx${ch.c}LevelSlider" min="0" max="100" value="${ch.lv}" oninput="bandRead()" /></div>`
    + `<div class="bd-kc">${bdKnob(`mx${ch.c}Pan`, "Pan", -100, 100, 0)}${bdKnob(`mx${ch.c}Dly`, "Delay", 0, 100, ch.dly)}${bdKnob(`mx${ch.c}Spc`, "Space", 0, 100, ch.spc)}</div>`
    + `<div class="bd-ms"><button type="button" class="bd-m" data-c="${ch.c}">M</button><button type="button" class="bd-s" data-c="${ch.c}">S</button>`
    + `<select id="mx${ch.c}MuteSelect" class="at-hidden" onchange="bandRead()"><option value="off" selected>off</option><option value="on">on</option></select>`
    + `<select id="mx${ch.c}SoloSelect" class="at-hidden" onchange="bandRead()"><option value="off" selected>off</option><option value="on">on</option></select></div></div>`).join("");
  host.innerHTML = `<div class="ph"><b class="nm">THE BAND</b><span class="meta">six parts, each its own instrument · from the scale's own degrees</span><span class="grow"></span>`
    + `<span class="meta ac-bar" id="acBarVal"></span>`
    + `<span class="cap">Follows</span><select id="acFollowSelect" data-seg onchange="accompanyRead()"><option value="melody" selected>Melody</option><option value="root">Journey root</option></select>`
    + `<div class="bd-swing">${bdKnob("bdSwing", "Swing", 50, 75, 50)}</div>`
    + `<span class="cap">Style</span><select id="bdStyleSelect" onchange="bandRead()">${Object.entries(BD_STYLES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join("")}</select>`
    + `<button type="button" class="btn" id="bdGenerate" title="Write the whole band from the style and the seed">Generate</button>`
    + `<button type="button" class="btn" id="bdReroll" title="Another seed, and generate">◌</button>`
    + `<span class="cap">Arrange</span>${bdSel("bdArrangeSelect", [["off", "Off"], ["on", "On"]], "off", true)}`
    + `<input type="range" class="knob-hidden" id="bdSeedSlider" min="1" max="99999" value="1977" oninput="bandRead()" /></div>`
    + `<div class="ac-parts bd-cards">${cards}</div>`
    + `<div class="bd-editor" id="bdEditor">`
    + `<section class="bd-ed on" data-p="drums" id="drumsHost"></section>`
    + `<section class="bd-ed" data-p="bass"><div class="ph"><b class="nm bd-t">BASS</b><span class="meta">a sine · dub, deep, round · its own channel</span></div><div class="bd-row">`
    + `<div class="bd-sub"><div class="bd-sh"><span class="cap">The sound</span></div><div class="bd-knobs">${bdKnobs("bass")}</div></div>`
    + `<div class="bd-sub bd-line"><div class="bd-sh"><span class="cap">The line</span><span class="meta">used by the pattern "By hand": click a step for R, 3, 4, 5, 7, 8, hold (–) or rest</span></div><div class="bd-lane" id="bsLane"></div>`
    + `<input type="text" class="at-hidden" id="bsLineText" value="R-..........R.5." oninput="bandRead()" onchange="bandRead()" /></div></div></section>`
    + `<section class="bd-ed" data-p="chord"><div class="ph"><b class="nm bd-t">CHORDS</b><span class="meta">its own Atmosphere patch and filter</span><span class="grow"></span><span class="cap">Start from</span><span class="bd-starts" data-p="chord">${Object.entries(BD_PATCH_STARTS.chord).map(([k, s], i) => `<button type="button" class="btn${i ? "" : " on"}" data-k="${k}">${s.name}</button>`).join("")}</span></div>`
    + `<div class="bd-row">${bdPatchHtml("chord")}<div class="bd-sub"><div class="bd-sh"><span class="cap">The chord and its filter</span><span class="grow"></span>${bdSel("chFltSelect", BD_FILTERS, "lowpass", true)}</div><div class="bd-knobs">${bdKnobs("chord")}</div></div></div></section>`
    + `<section class="bd-ed" data-p="arp"><div class="ph"><b class="nm bd-t">ARP</b><span class="meta">a plain synth, plucked through its own filter</span><span class="grow"></span><span class="cap">Wave</span>${bdSel("apWaveSelect", [["sine", "Sine"], ["triangle", "Triangle"], ["sawtooth", "Saw"], ["square", "Square"]], "triangle", true)}</div>`
    + `<div class="bd-row"><div class="bd-sub"><div class="bd-knobs">${bdKnobs("arp")}</div></div></div></section>`
    + `<section class="bd-ed" data-p="drone"><div class="ph"><b class="nm bd-t">DRONE</b><span class="meta">its own Atmosphere patch and filter</span><span class="grow"></span><span class="cap">Start from</span><span class="bd-starts" data-p="drone">${Object.entries(BD_PATCH_STARTS.drone).map(([k, s], i) => `<button type="button" class="btn${i ? "" : " on"}" data-k="${k}">${s.name}</button>`).join("")}</span></div>`
    + `<div class="bd-row">${bdPatchHtml("drone")}<div class="bd-sub"><div class="bd-sh"><span class="cap">Swell and filter</span><span class="grow"></span>${bdSel("drFltSelect", BD_FILTERS, "lowpass", true)}</div><div class="bd-knobs">${bdKnobs("drone")}</div></div></div></section>`
    + `</div>`
    + `<div class="ph bd-mxh"><b class="nm">MIXER</b><span class="meta">a channel for each part · delay and space are sends · the page's Vol is the master</span></div>`
    + `<div class="bd-mixer">${mixer}</div>`;
  drumsBuildUI(document.getElementById("drumsHost"));
  // The drums' card shows the kit, and sets it.
  const card = document.getElementById("bdKitCard"), kit = document.getElementById("dmKitSelect");
  const syncKit = () => { card.innerHTML = kit.innerHTML; card.value = kit.value; };
  syncKit();
  card.addEventListener("change", () => { kit.value = card.value; kit.dispatchEvent(new Event("change", { bubbles: true })); });
  kit.addEventListener("change", syncKit);
  new MutationObserver(syncKit).observe(kit, { childList: true, subtree: true });
  // Clicks.
  host.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.matches(".power[data-ac]")) {
      const p = AC_PARTS.find((x) => x.k === b.dataset.ac), s = document.getElementById(acId(p, "OnSelect"));
      s.value = s.value === "on" ? "off" : "on";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (b.matches(".power[data-mel]")) {
      bdToggle("mxMelMuteSelect");
    } else if (b.matches(".bd-edit")) {
      if (b.dataset.p === "melody") { const g = document.querySelector(".seq-panel"); if (g) g.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      bandEdit(b.dataset.p);
    } else if (b.matches(".bd-m")) bdToggle(`mx${b.dataset.c}MuteSelect`);
    else if (b.matches(".bd-s")) bdToggle(`mx${b.dataset.c}SoloSelect`);
    else if (b.closest(".bd-starts")) bandStart(b.closest(".bd-starts").dataset.p, b.dataset.k);
    else if (b.id === "bdGenerate") { initAudio(); bandGenerate(); }
    else if (b.id === "bdReroll") { const s = document.getElementById("bdSeedSlider"); s.value = 1 + Math.floor(Math.random() * 99998); initAudio(); bandGenerate(); }
  });
  // The bass line, a step at a time.
  document.getElementById("bsLane").addEventListener("click", (e) => {
    const i = e.target.closest("i");
    if (!i) return;
    const order = ["R", "3", "4", "5", "7", "8", "-", "."];
    const line = (BAND.bass.line || "").padEnd(16, ".").slice(0, 16).split("");
    line[+i.dataset.i] = order[(order.indexOf(line[+i.dataset.i]) + 1) % order.length];
    const el = document.getElementById("bsLineText");
    el.value = line.join("");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function bdToggle(id) {
  const s = document.getElementById(id);
  s.value = s.value === "on" ? "off" : "on";
  s.dispatchEvent(new Event("change", { bubbles: true }));
}
function bandEdit(part) {
  BAND.edit = part;
  for (const s of document.querySelectorAll(".bd-ed")) s.classList.toggle("on", s.dataset.p === part);
  for (const c of document.querySelectorAll(".bd-card")) c.classList.toggle("sel", c.dataset.p === part);
}

function bandPaint() {
  const val = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  for (const knobs of Object.values(BD_KNOBS)) for (const [id, , , , , f] of knobs) { const el = document.getElementById(id + "Slider"); if (el) val(id + "Val", f(+el.value)); }
  for (const part of ["chord", "drone"]) for (const [k] of BD_PATCH_SHOWN) {
    const el = document.getElementById(bdPatchId(part, k)), def = AT_KNOBS.find((x) => x[0] === k);
    if (el && def) val(bdPatchId(part, k).replace(/Slider$/, "Val"), (def[5] || pct)(+el.value));
  }
  val("bdSwingVal", BAND.swing <= 50 ? "straight" : Math.round(BAND.swing) + "%");
  for (const ch of BD_CH) {
    const V = BAND.ch[ch.c];
    if (!V) continue;
    val(`mx${ch.c}Db`, bdDb(V.lv) + " dB");
    val(`mx${ch.c}PanVal`, V.pan === 0 ? "C" : (V.pan < 0 ? "L" : "R") + Math.abs(V.pan));
    val(`mx${ch.c}DlyVal`, Math.round(V.dly) + "%");
    val(`mx${ch.c}SpcVal`, Math.round(V.spc) + "%");
    const st = document.querySelector(`.bd-strip[data-c="${ch.c}"]`);
    if (st) {
      st.querySelector(".bd-m").classList.toggle("on", V.mute);
      st.querySelector(".bd-s").classList.toggle("on", V.solo);
      st.classList.toggle("unheard", !V.heard);
    }
  }
  const mel = document.querySelector(".power[data-mel]");
  if (mel && BAND.ch.Mel) mel.classList.toggle("on", !BAND.ch.Mel.mute);
  // The bass line.
  const lane = document.getElementById("bsLane");
  if (lane) {
    const line = (BAND.bass.line || "").padEnd(16, ".").slice(0, 16);
    lane.innerHTML = [...line].map((ch, i) => `<i data-i="${i}" class="${ch === "." ? "" : ch === "-" ? "n tie" : "n"}${i % 4 === 0 ? " beat" : ""}">${ch === "." || ch === "-" ? "" : ch}</i>`).join("");
  }
}

/// The meters, while the page is shown and something plays.
function bandMeters() {
  requestAnimationFrame(bandMeters);
  if (!bdNodes || typeof isPlaying === "undefined" || document.hidden) return;
  const buf = bandMeters.buf || (bandMeters.buf = new Float32Array(512));
  for (const ch of BD_CH) {
    const cv = document.getElementById(`mx${ch.c}Meter`);
    if (!cv || !cv.offsetParent) continue;
    bdNodes.ch[ch.c].meter.getFloatTimeDomainData(buf);
    let pk = 0;
    for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
    const db = pk > 0 ? 20 * Math.log10(pk) : -90, h = Math.max(0, Math.min(1, (db + 48) / 48));
    const g = cv.getContext("2d"), H = cv.height, W = cv.width;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#0d0e11"; g.fillRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, "#4fcc5b"); grad.addColorStop(0.7, "#f2c14e"); grad.addColorStop(0.9, "#f06a5a");
    g.fillStyle = grad; g.fillRect(0, H * (1 - h), W, H * h);
  }
}

// ─── LFO TARGETS: THE PARTS' FILTERS AND LEVELS ──────────────────────────────
const BD_LFO = [["bd-chcut", "Chords cutoff"], ["bd-drcut", "Drone cutoff"], ["bd-chlvl", "Chords level"], ["bd-bslvl", "Bass level"]];
function bandLfoParam(target) {
  const N = bdNodes;
  if (!N) return null;
  return { "bd-chcut": N.chordFlt.detune, "bd-drcut": N.droneFlt.detune, "bd-chlvl": N.ch.Chd.in.gain, "bd-bslvl": N.ch.Bas.in.gain }[target] || null;
}
function bandLfoGain(lfo) {
  return { "bd-chcut": lfo.depth * 2400, "bd-drcut": lfo.depth * 2400, "bd-chlvl": lfo.depth * 0.8, "bd-bslvl": lfo.depth * 0.8 }[lfo.target] || 0;
}

// ─── START ───────────────────────────────────────────────────────────────────
bandBuildUI();
for (let n = 1; n <= 3; n++) {
  const sel = document.getElementById(`lfo${n}TargetSelect`);
  if (sel) for (const [v, t] of BD_LFO) { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); }
}
bandRead();
drumsRead();
dmLoadMachines();
bandEdit("drums");
requestAnimationFrame(bandMeters);
