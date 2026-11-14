// Accompany (ours, not the sequencer repository's; 14 Nov 2026, the plan
// `WORK DIR/page-mockups/SEQ-JOURNEY-PLAN.md` §3 and the mock-up
// `seq-journey.html`). RJ: "do some auto accompaniment stuff".
//
// Four parts, each on or off with a level, built from the scale's own degrees:
//
//   Bass    the root, root and fifth, or a walk, on the beat; an octave or two down
//   Chords  stacked scale degrees (triads, sevenths, fourths), each bar or on each change
//   Arp     the chord, up, down, up-down or random, at 1/8, 1/16 or 1/32
//   Drone   the root, or root and fifth, held, swelling in and out
//
// **In the scale's own tuning.** Every note is the scale's cents from the
// root, as the melody's are (`acHz`): a maqam, a just or a microtonal scale
// gets chords in its own tuning, never 12-TET ones. A seven-note scale stacks
// every other degree (every third for fourths); any other stacks the degree
// nearest a third (350¢) or a fourth (500¢) above.
//
// **Follows** the melody (each bar's chord is the one that holds the bar's
// strongest note, weighed by where it falls and how long it lasts) or the
// Journey's root (the chord is on the root the Journey has moved to). Either
// way a Journey that moves to a family scale is played in that scale.
//
// **Worked out, not rolled.** What plays at step boundary `k` comes from `k`,
// the settings, the steps and the Journey (journey.js), never from when it
// happened to be played (`acPlan`). The live scheduler and the film's offline
// render (bridge.js) both call `accompanyAt` at every boundary, so the film and
// the sound export render what was heard. A jump (Play, a seek, the loop's
// wrap) starts the bar's chord and drone from where it lands.
//
// **The sound** (RJ, 14 Nov: not through the melody's filter). Chords and
// Drone play the Atmosphere voice (atmos.js, its own chain and pool); Bass and
// Arp a plain one here. All four go to `acBus`, which feeds what the filter
// feeds: the dry path, the delay and Space.

// ─── THE CONTROLS ────────────────────────────────────────────────────────────
// [part, its colour family, its pattern's options, its second knob]
const AC_PARTS = [
  { k: "bass", name: "BASS", fam: "attack", pat: [["root", "Root"], ["fifth", "Root – fifth"], ["walk", "Walk"]], def: "fifth",
    knob: ["Oct", "Octave", 1, 2, 1], level: 70 },
  { k: "chord", name: "CHORDS", fam: "tone",
    pat: [["triad-bar", "Triads / bar"], ["triad-change", "Triads / change"], ["seventh-bar", "Sevenths / bar"], ["seventh-change", "Sevenths / change"], ["fourth-bar", "Fourths / bar"], ["fourth-change", "Fourths / change"]],
    def: "triad-bar", knob: ["Spread", "Spread", 0, 100, 40], level: 45 },
  { k: "arp", name: "ARP", fam: "space",
    pat: ["up", "down", "updown", "random"].flatMap((d) => [8, 16, 32].map((r) => [`${d}-${r}`, `${{ up: "Up", down: "Down", updown: "Up-down", random: "Random" }[d]} · 1/${r}`])),
    def: "up-16", knob: ["Range", "Range", 1, 3, 2], level: 40 },
  { k: "drone", name: "DRONE", fam: "pitch", pat: [["root", "Root"], ["fifth", "Root + fifth"]], def: "fifth",
    knob: ["Swell", "Swell", 0, 100, 60], level: 30 },
];
const acId = (p, what) => `ac${p.k[0].toUpperCase()}${p.k.slice(1)}${what}`;

// What presets, morphs and the Performance recorder carry.
const ACCOMPANY_SLIDER_IDS = AC_PARTS.flatMap((p) => [acId(p, "LevelSlider"), acId(p, p.knob[0] + "Slider")]);
const ACCOMPANY_SELECT_IDS = ["acFollowSelect", ...AC_PARTS.flatMap((p) => [acId(p, "OnSelect"), acId(p, "PatSelect")])];

/// The values, read from the controls.
const AC = { follow: "melody", parts: {} };

/// Swell, 0–100, in bars: a quarter of a bar to eight.
const acSwellBars = (v) => 0.25 * Math.pow(32, v / 100);

function accompanyRead() {
  const v = (id, d) => { const el = document.getElementById(id); return el ? el.value : d; };
  AC.follow = v("acFollowSelect", "melody");
  for (const p of AC_PARTS) {
    AC.parts[p.k] = {
      on: v(acId(p, "OnSelect"), "off") === "on",
      pat: v(acId(p, "PatSelect"), p.def),
      level: +v(acId(p, "LevelSlider"), p.level),
      x: +v(acId(p, p.knob[0] + "Slider"), p.knob[4]),
    };
    const q = AC.parts[p.k];
    const card = document.querySelector(`.ac-part[data-p="${p.k}"]`);
    if (card) card.classList.toggle("on", q.on);
    const pw = document.querySelector(`.power[data-ac="${p.k}"]`);
    if (pw) pw.classList.toggle("on", q.on);
    const val = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    val(acId(p, "LevelVal"), Math.round(q.level) + "%");
    let t = "";
    if (p.k === "bass") t = q.x >= 1.5 ? "−2" : "−1";
    else if (p.k === "chord") t = q.x < 20 ? "close" : q.x < 60 ? "open" : "wide";
    else if (p.k === "arp") t = Math.round(q.x) + " oct";
    else { const b = acSwellBars(q.x); t = b < 1 ? (b < 0.4 ? "¼ bar" : b < 0.75 ? "½ bar" : "¾ bar") : b.toFixed(b < 2 ? 1 : 0) + " bars"; }
    val(acId(p, p.knob[0] + "Val"), t);
  }
  accompanyDraw();
}

// ─── THE HARMONY ─────────────────────────────────────────────────────────────
/// Beats in a bar.
const AC_BAR = 4;

/// Which step sounds at boundary `k`, in the pattern's direction (as bridge.js
/// lays it). Random has no answer that holds, so it is read as forward.
function acStepAt(k) {
  const n = Math.max(1, numSteps);
  if (direction === "rev") return (n - 1 - (k % n) + n) % n;
  if (direction === "ping") {
    const period = Math.max(1, 2 * n - 2), r = k % period;
    return r < n ? r : period - r;
  }
  return k % n;
}

/// The first boundary at or after beat `b`.
const acK = (beat) => Math.max(0, Math.ceil(beat / stepBeats - 1e-9));

/// The scale and the root that sound at boundary `k`: the Journey's family
/// scale and the root it has moved to, while it is on.
function acScaleAt(k) {
  let cents = SCALES[selectedScaleIdx].cents, shift = 0;
  if (typeof J !== "undefined" && J.on && typeof journeyWhere === "function") {
    const w = journeyWhere(k), p = journeyPattern(w.moves, w.a);
    if (p.g.scale >= 0 && SCALES[p.g.scale].cents.length === cents.length) cents = SCALES[p.g.scale].cents;
    shift = p.g.shift;
  }
  return { cents, shift };
}

/// A degree's cents from the root, any octave.
function acCents(cents, d) {
  const n = cents.length;
  return cents[((d % n) + n) % n] + Math.floor(d / n) * 1200;
}
/// …and its frequency, `oct` octaves from the root's.
const acHz = (cents, d, oct = 0) => centsToHz(rootHz, acCents(cents, d) + oct * 1200);

/// The degree above `d` a chord stacks next: every other degree (every third
/// for fourths) in a seven-note scale; otherwise the one nearest 350¢ (500¢).
function acNext(cents, d, kind) {
  const n = cents.length;
  if (n === 7) return d + (kind === "fourth" ? 3 : 2);
  const target = kind === "fourth" ? 500 : 350, c0 = acCents(cents, d);
  let best = d + 1, err = Infinity;
  for (let e = d + 1; e <= d + n; e++) {
    const x = Math.abs(acCents(cents, e) - c0 - target);
    if (x < err - 1e-6) { err = x; best = e; }
  }
  return best;
}

/// A chord on degree `r`: its degrees, stacked.
function acStack(cents, r, kind) {
  const out = [r];
  const size = kind === "seventh" ? 4 : 3;
  while (out.length < size) out.push(acNext(cents, out[out.length - 1], kind));
  return out;
}

/// The degree nearest a fifth (702¢) above `r`.
function acFifth(cents, r) {
  const n = cents.length, c0 = acCents(cents, r);
  let best = r + 1, err = Infinity;
  for (let e = r + 1; e < r + n; e++) {
    const x = Math.abs(acCents(cents, e) - c0 - 702);
    if (x < err - 1e-6) { err = x; best = e; }
  }
  return best;
}

/// Bar `b`'s chord: its root degree (0 to the scale's length), its degrees
/// stacked from there, and the scale it is in. Deterministic in `b`.
function acChord(b, kind) {
  const k0 = acK(b * AC_BAR), k1 = acK((b + 1) * AC_BAR);
  const { cents, shift } = acScaleAt(k0);
  const n = cents.length, mod = (d) => ((d % n) + n) % n;
  const tonic = mod(shift);
  let root = tonic;
  if (AC.follow === "melody") {
    // The bar's notes, weighed by where they fall and how long they last.
    const w = new Array(n).fill(0);
    let strongest = -1;
    for (let k = k0; k < Math.max(k1, k0 + 1); k++) {
      const i = acStepAt(k);
      const s = typeof journeyStep === "function" ? journeyStep(k, i) : steps[i];
      if (!s || s.rest) continue;
      const pos = k * stepBeats - b * AC_BAR;
      const metre = Math.abs(pos) < 1e-6 ? 4 : Math.abs(pos % 2) < 1e-6 ? 2.5 : Math.abs(pos % 1) < 1e-6 ? 1.5 : 1;
      const pc = mod(s.degree);
      w[pc] += metre * (s.hold || 1);
      if (strongest < 0 || w[pc] > w[strongest]) strongest = pc;
    }
    if (strongest >= 0) {
      // Of the chords that hold it, the one that holds most of the bar, the
      // home chords first when it is close.
      const near = (c) => { let best = 0, e = Infinity; cents.forEach((x, i) => { if (Math.abs(x - c) < e) { e = Math.abs(x - c); best = i; } }); return best; };
      const fifth = mod(tonic + near(702)), fourth = mod(tonic + near(498));
      const home = { [tonic]: 0.6, [fifth]: 0.4, [fourth]: 0.3 };
      let bestScore = -Infinity;
      for (let j = 0; j < n; j++) {
        const r = mod(tonic + j);
        const pcs = new Set(acStack(cents, r, kind).map(mod));
        if (!pcs.has(strongest)) continue;
        let score = (home[r] || 0) + (r === strongest ? 0.5 : 0);
        for (const pc of pcs) score += w[pc];
        if (score > bestScore + 1e-9) { bestScore = score; root = r; }
      }
    }
  }
  return { root, degs: acStack(cents, root, kind), cents };
}

/// The chord's degrees as voiced, by Spread: close, then the upper notes
/// lifted an octave at a time as it opens.
function acVoice(degs, n, spread) {
  const s = spread / 100;
  return degs.map((d, j) => d + n * (j ? Math.floor(s * j * 1.2 + 0.4) : 0));
}

// ─── THE PLAN ────────────────────────────────────────────────────────────────
/// The beats-long units of size `u` that start inside boundary `k`'s step.
function acUnits(k, u) {
  const a = k * stepBeats, z = (k + 1) * stepBeats, out = [];
  for (let i = Math.ceil(a / u - 1e-9); i * u < z - 1e-9; i++) out.push(i);
  return out;
}

/// A seeded hash of two integers, 0–1, for the random arp.
function acHash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/// What plays in boundary `k`'s step: a list of notes, each `{ part, at`
/// (seconds after the boundary)`, dur` (seconds)`, hz }`. `jump` when the
/// boundary does not follow the last one played: the bar's chord and drone
/// start from here. Pure: the same `k` and settings give the same list.
function acPlan(k, jump = false) {
  const out = [];
  const spb = 60 / bpm, t0 = k * stepBeats;
  const P = AC.parts;
  if (!P.bass || !AC_PARTS.some((p) => P[p.k].on)) return out;
  const memo = {};
  const kindOf = (P.chord.pat || "triad-bar").split("-")[0];
  const chordAt = (b) => memo[b] || (memo[b] = acChord(b, kindOf));
  const at = (beat) => (beat - t0) * spb;
  const firstBar = Math.floor(t0 / AC_BAR + 1e-9);
  // Bars that begin in this step, and the bar this step is in on a jump.
  const bars = acUnits(k, AC_BAR);
  const starts = bars.map((b) => ({ b, beat: b * AC_BAR }));
  if (jump && !bars.includes(firstBar)) starts.unshift({ b: firstBar, beat: t0 });
  const same = (x, y) => x.degs.join() === y.degs.join() && x.cents === y.cents;

  for (const { b, beat } of starts) {
    const fresh = jump && beat === t0;
    // Chords: each bar, or held until they change (eight bars at most).
    if (P.chord.on) {
      const ch = chordAt(b), change = (P.chord.pat || "").endsWith("change");
      if (!change || fresh || !same(ch, chordAt(b - 1))) {
        let bars = 1;
        if (change) while (bars < 8 && same(chordAt(b + bars), ch)) bars++;
        const end = (b + bars) * AC_BAR, n = ch.cents.length;
        for (const d of acVoice(ch.degs, n, P.chord.x)) out.push({ part: "chord", at: at(beat), dur: (end - beat) * spb * 0.98, hz: acHz(ch.cents, d), n: ch.degs.length });
      }
    }
    // Drone: the root the scale is on, and its fifth, held until the root
    // moves, eight bars at most; it swells in as the last swells out.
    if (P.drone.on) {
      const sc = acScaleAt(acK(b * AC_BAR)), root = sc.shift;
      const key = (bb) => { const s = acScaleAt(acK(bb * AC_BAR)); return s.shift + "|" + s.cents.join(); };
      const here = key(b);
      if (fresh || b % 8 === 0 || key(b - 1) !== here) {
        let bars = 1;
        while (bars < 8 && (b + bars) % 8 !== 0 && key(b + bars) === here) bars++;
        const end = (b + bars) * AC_BAR;
        const degs = P.drone.pat === "fifth" ? [root, acFifth(sc.cents, root)] : [root];
        for (const d of degs) out.push({ part: "drone", at: at(beat), dur: (end - beat) * spb, hz: acHz(sc.cents, d, -1), n: degs.length });
      }
    }
  }

  // Bass: on the beat.
  if (P.bass.on) {
    const oct = P.bass.x >= 1.5 ? -2 : -1;
    for (const i of acUnits(k, 1)) {
      const b = Math.floor(i / AC_BAR), j = i - b * AC_BAR, ch = chordAt(b);
      let d = ch.root;
      if (P.bass.pat === "fifth") d = j % 2 ? acFifth(ch.cents, ch.root) : ch.root;
      else if (P.bass.pat === "walk") {
        // Root, the chord's next two notes, then a step to the next bar's root.
        const next = chordAt(b + 1).root;
        if (j === 1) d = ch.degs[1];
        else if (j === 2) d = ch.degs[2];
        else if (j === 3) d = next - 1 === ch.degs[2] ? next + 1 : next - 1;
      }
      // Kept in one octave: the bass's register does not climb.
      const c = ((acCents(ch.cents, d) % 1200) + 1200) % 1200;
      out.push({ part: "bass", at: at(i), dur: spb * 0.9, hz: centsToHz(rootHz, c + oct * 1200) });
    }
  }

  // Arp: the chord, over Range octaves, at its rate.
  if (P.arp.on) {
    const [dir, rate] = (P.arp.pat || "up-16").split("-");
    const u = 4 / (+rate || 16);
    const range = Math.max(1, Math.round(P.arp.x));
    for (const i of acUnits(k, u)) {
      const b = Math.floor((i * u) / AC_BAR + 1e-9), ch = chordAt(b), n = ch.cents.length;
      const seq = [];
      for (let o = 0; o < range; o++) for (const d of ch.degs) seq.push(d + o * n);
      const L = seq.length;
      let x;
      if (dir === "down") x = L - 1 - (i % L);
      else if (dir === "updown") { const per = Math.max(1, 2 * L - 2), r = i % per; x = r < L ? r : per - r; }
      else if (dir === "random") x = Math.floor(acHash(i, b) * L);
      else x = i % L;
      out.push({ part: "arp", at: at(i * u), dur: u * spb * 0.8, hz: acHz(ch.cents, seq[x]) });
    }
  }
  return out;
}

// ─── THE SOUND ───────────────────────────────────────────────────────────────
let acBus = null, acLastK = -2, acPlain = [];

/// Built once per context, by `initAudio`, after Atmosphere's graph.
function accompanyInit() {
  const c = audioCtx;
  if (!c || !filterNode) return;
  acBus = c.createGain();
  // What the filter feeds: the dry path, the delay, Space.
  if (delayDryGain) acBus.connect(delayDryGain);
  if (delayL) acBus.connect(delayL);
  if (typeof atRev !== "undefined" && atRev && atRev.gate) acBus.connect(atRev.gate);
  if (typeof atAc !== "undefined" && atAc) atAc.post.connect(acBus);
  acLastK = -2;
  acPlain = [];
}

/// Bass and Arp: a plain voice. Bass a sine under a soft triangle; Arp a
/// triangle plucked.
function acPlainNote(part, hz, time, dur, level) {
  const c = audioCtx;
  const env = c.createGain(), out = c.createGain();
  out.gain.value = level;
  env.connect(out);
  out.connect(acBus);
  const oscs = [];
  const add = (type, f, g) => {
    const o = c.createOscillator(), og = c.createGain();
    o.type = type; o.frequency.value = f; og.gain.value = g;
    o.connect(og); og.connect(env); oscs.push(o);
  };
  let rel;
  env.gain.setValueAtTime(0, time);
  if (part === "bass") {
    add("sine", hz, 0.75); add("triangle", hz, 0.35);
    env.gain.linearRampToValueAtTime(1, time + 0.006);
    env.gain.setTargetAtTime(0.7, time + 0.006, 0.12);
    rel = 0.08;
  } else {
    add("triangle", hz, 0.8); add("sine", hz * 2, 0.12);
    env.gain.linearRampToValueAtTime(1, time + 0.003);
    env.gain.setTargetAtTime(0.25, time + 0.003, Math.max(0.02, dur * 0.5));
    rel = 0.06;
  }
  if (env.gain.cancelAndHoldAtTime) env.gain.cancelAndHoldAtTime(time + dur);
  env.gain.setTargetAtTime(0, time + dur, rel / 4);
  const end = time + dur + rel * 2 + 0.02;
  for (const o of oscs) { o.start(time); o.stop(end); }
  acPlain.push({ env, oscs, start: time, end });
}

/// Play what boundary `k` holds, at `time`. Both the scheduler and the film's
/// offline render (bridge.js) call this at every boundary, rest or not.
function accompanyAt(k, time) {
  if (!audioCtx || !acBus) return;
  const jump = k !== acLastK + 1;
  acLastK = k;
  // A jump lets go of what the last place was holding.
  if (jump) accompanyRelease(time);
  if (!AC.parts.bass) accompanyRead();
  const plan = acPlan(k, jump);
  if (!plan.length) return;
  const now = audioCtx.currentTime;
  acPlain = acPlain.filter((v) => v.end > now);
  const P = AC.parts;
  for (const e of plan) {
    const t = time + e.at;
    if (e.part === "bass" || e.part === "arp") {
      const lv = (P[e.part].level / 100) * (e.part === "bass" ? 0.42 : 0.2);
      acPlainNote(e.part, e.hz, t, e.dur, lv);
    } else if (typeof atmosPlay === "function") {
      const lv = (P[e.part].level / 100) * (e.part === "chord" ? 0.9 : 1.1) / Math.sqrt(e.n || 1);
      const o = { ac: true, gain: lv };
      if (e.part === "drone") { const sw = acSwellBars(P.drone.x) * AC_BAR * (60 / bpm); o.atk = sw; o.rel = sw; }
      atmosPlay(e.hz, t, e.dur, o);
    }
  }
  accompanyBarUI(k);
}

/// Everything Accompany is holding fades from `time`: on a stop, a pause, a jump.
function accompanyRelease(time) {
  const c = audioCtx;
  if (!c) return;
  const t = Math.max(time, c.currentTime);
  const fade = (g, start) => {
    if (start >= t) { g.cancelScheduledValues(start); g.setValueAtTime(0, start); return; }
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, 0.06);
  };
  for (const v of acPlain) {
    if (v.end <= t) continue;
    fade(v.env.gain, v.start);
    for (const o of v.oscs) { try { o.stop(Math.max(v.start, t) + 0.4); } catch (e) { /* set already */ } }
    v.end = t + 0.4;
  }
  if (typeof atAcVoices !== "undefined") {
    for (const v of atAcVoices) {
      if (v.end <= t) continue;
      fade(v.env.gain, v.start);
      for (const s of v.srcs) { try { s.stop(Math.max(v.start, t) + 0.5); } catch (e) { /* set already */ } }
      v.end = t + 0.5;
    }
  }
}

/// The transport has stopped: let go now, and the next boundary is a jump.
function accompanyStop() {
  acLastK = -2;
  if (audioCtx) accompanyRelease(audioCtx.currentTime);
}

// ─── WHAT THE PAGE SHOWS ─────────────────────────────────────────────────────
/// Each part's bar, as it will play: the bar the transport is in, or the first.
let acShownBar = -1;
function accompanyBarUI(k) {
  if (typeof OfflineAudioContext !== "undefined" && audioCtx instanceof OfflineAudioContext) return;
  const b = Math.floor((k * stepBeats) / AC_BAR + 1e-9);
  if (b === acShownBar) return;
  acShownBar = b;
  const wait = Math.max(0, (nextNoteTime - audioCtx.currentTime) * 1000);
  setTimeout(() => accompanyDraw(b), wait);
}

function accompanyDraw(bar) {
  if (bar == null) bar = acShownBar >= 0 && typeof isPlaying !== "undefined" && isPlaying ? acShownBar : 0;
  const k0 = acK(bar * AC_BAR), k1 = Math.max(k0 + 1, acK((bar + 1) * AC_BAR));
  // The whole bar, as if played from its start, every part on.
  const P = AC.parts;
  if (!P.bass) return;
  const was = {};
  for (const p of AC_PARTS) { was[p.k] = P[p.k].on; P[p.k].on = true; }
  const notes = [];
  try {
    for (let k = k0; k < k1; k++) {
      const off = (k * stepBeats - bar * AC_BAR) * (60 / bpm);
      for (const e of acPlan(k, k === k0)) notes.push({ ...e, at: e.at + off });
    }
  } finally {
    for (const p of AC_PARTS) P[p.k].on = was[p.k];
  }
  const barSec = AC_BAR * (60 / bpm);
  for (const p of AC_PARTS) {
    const c = document.getElementById(acId(p, "Roll"));
    if (!c) continue;
    const cssW = c.offsetWidth;
    if (cssW > 0 && c.width !== cssW) c.width = cssW;
    const g = c.getContext("2d"), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const mine = notes.filter((e) => e.part === p.k);
    if (!mine.length) continue;
    const lo = Math.min(...mine.map((e) => Math.log2(e.hz))), hi = Math.max(...mine.map((e) => Math.log2(e.hz)));
    const span = Math.max(0.5, hi - lo);
    const ink = typeof seqInk === "function" ? seqInk(p.fam, P[p.k].on ? 1 : 0.45) : "#888";
    g.fillStyle = ink;
    for (const e of mine) {
      const x = Math.max(0, (e.at / barSec) * W), w = Math.max(2, Math.min(W - x, (e.dur / barSec) * W) - 1);
      const y = 3 + (1 - (Math.log2(e.hz) - lo) / span) * (H - 9);
      g.fillRect(Math.round(x), Math.round(y), Math.round(w), 3);
    }
  }
  const lab = document.getElementById("acBarVal");
  if (lab) {
    const ch = acChord(bar, (P.chord.pat || "triad-bar").split("-")[0]);
    const n = ch.cents.length, names = ch.degs.map((d) => "D" + ((((d % n) + n) % n) + 1));
    lab.textContent = `bar ${bar + 1} · ${names.join(" ")} · ${ch.degs.map((d) => acCents(ch.cents, d).toFixed(0) + "¢").join(" ")}`;
  }
}

// ─── THE MARKUP ──────────────────────────────────────────────────────────────
function acKnob(id, label, min, max, value, step = 1) {
  return `<div class="knob-group"><span class="knob-label">${label}</span>`
    + `<div class="knob" onmousedown="knobDown(event, '${id}Slider')" ontouchstart="knobTouchStart(event,'${id}Slider')"></div>`
    + `<input type="range" class="knob-hidden" min="${min}" max="${max}" step="${step}" value="${value}" id="${id}Slider" oninput="accompanyRead()" />`
    + `<span class="knob-val" id="${id}Val"></span></div>`;
}

function accompanyBuildUI() {
  const host = document.getElementById("accompanyHost");
  if (!host || document.getElementById("acFollowSelect")) return;
  const parts = AC_PARTS.map((p) => {
    const [kid, klabel, kmin, kmax, kdef] = p.knob;
    return `<div class="ac-part" data-p="${p.k}" style="--fc: var(--f-${p.fam})">`
      + `<div class="ac-pt"><button type="button" class="power" data-ac="${p.k}" title="${p.name[0] + p.name.slice(1).toLowerCase()} on or off"></button><b>${p.name}</b>`
      + `<select id="${acId(p, "OnSelect")}" class="at-hidden" onchange="accompanyRead()"><option value="off" selected>off</option><option value="on">on</option></select></div>`
      + `<div class="ac-roll"><canvas id="${acId(p, "Roll")}" width="200" height="30"></canvas></div>`
      + `<select id="${acId(p, "PatSelect")}" class="ac-pat" onchange="accompanyRead()">${p.pat.map(([v, t]) => `<option value="${v}"${v === p.def ? " selected" : ""}>${t}</option>`).join("")}</select>`
      + `<div class="ac-knobs">${acKnob(acId(p, "Level"), "Level", 0, 100, p.level)}${acKnob(acId(p, kid), klabel, kmin, kmax, kdef)}</div>`
      + `</div>`;
  }).join("");
  host.innerHTML = `<div class="ph"><b class="nm">ACCOMPANY</b><span class="meta">from the scale's own degrees · past the filter, into the delay and space</span><span class="grow"></span>`
    + `<span class="meta ac-bar" id="acBarVal"></span>`
    + `<span class="cap">Follows</span><select id="acFollowSelect" data-seg onchange="accompanyRead()"><option value="melody" selected>Melody</option><option value="root">Journey root</option></select></div>`
    + `<div class="ac-parts">${parts}</div>`;
  for (const b of host.querySelectorAll(".power[data-ac]")) {
    b.addEventListener("click", () => {
      const p = AC_PARTS.find((x) => x.k === b.dataset.ac);
      const s = document.getElementById(acId(p, "OnSelect"));
      s.value = s.value === "on" ? "off" : "on";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
}

accompanyBuildUI();
accompanyRead();
