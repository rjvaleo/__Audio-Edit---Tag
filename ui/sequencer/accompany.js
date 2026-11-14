// Accompany (ours, not the sequencer repository's; 14 Nov 2026, the plans
// `WORK DIR/page-mockups/SEQ-JOURNEY-PLAN.md` §3 and `SEQ-BAND-PLAN.md`).
// RJ: "do some auto accompaniment stuff", and then: "it's like a whole band".
//
// What the Band's parts play, from the scale's own degrees; how they sound is
// band.js's, and the drums' grid is drums.js's:
//
//   Bass    the root, root and fifth, a walk, off-beats, a dub line, held, or a line by hand
//   Chords  stacked scale degrees (triads, sevenths, ninths, fourths), each bar, on
//           each change, as dub stabs on the off-beat, or a two-bar stab pattern
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
// happened to be played (`acPlan`, `drumPlan`). The live scheduler and the
// film's offline render (bridge.js) both call `accompanyAt` at every boundary,
// so the film and the sound export render what was heard. A jump (Play, a
// seek, the loop's wrap) starts the bar's chord and drone from where it lands.

// ─── THE CONTROLS ────────────────────────────────────────────────────────────
const AC_CHORD_KINDS = [["triad", "Triads"], ["seventh", "Sevenths"], ["ninth", "Ninths"], ["fourth", "Fourths"]];
const AC_CHORD_RHYTHMS = [["bar", "/ bar"], ["change", "/ change"], ["stab", "· dub stabs"], ["stab2", "· 2-bar stabs"]];
const AC_PARTS = [
  { k: "drums", name: "DRUMS", fam: "attack", what: "808 · kits", pat: [], def: "" },
  { k: "bass", name: "BASS", fam: "tone", what: "sine · dub",
    pat: [["root", "Root"], ["fifth", "Root – fifth"], ["walk", "Walk"], ["offbeat", "Off-beats"], ["dub", "Dub line"], ["held", "Held root"], ["hand", "By hand"]], def: "fifth" },
  { k: "chord", name: "CHORDS", fam: "space", what: "Atmos · own patch",
    pat: AC_CHORD_KINDS.flatMap(([k, t]) => AC_CHORD_RHYTHMS.map(([r, rt]) => [`${k}-${r}`, `${t} ${rt}`])), def: "triad-bar" },
  { k: "arp", name: "ARP", fam: "time", what: "pluck",
    pat: ["up", "down", "updown", "random"].flatMap((d) => [8, 16, 32].map((r) => [`${d}-${r}`, `${{ up: "Up", down: "Down", updown: "Up-down", random: "Random" }[d]} · 1/${r}`])), def: "up-16" },
  { k: "drone", name: "DRONE", fam: "level", what: "Atmos · own patch", pat: [["root", "Root"], ["fifth", "Root + fifth"]], def: "fifth" },
];
const acId = (p, what) => `ac${p.k[0].toUpperCase()}${p.k.slice(1)}${what}`;

// What presets, morphs and the Performance recorder carry (the parts' sounds
// and the mixer are band.js's lists).
const ACCOMPANY_SLIDER_IDS = [];
const ACCOMPANY_SELECT_IDS = ["acFollowSelect", ...AC_PARTS.flatMap((p) => (p.pat.length ? [acId(p, "OnSelect"), acId(p, "PatSelect")] : [acId(p, "OnSelect")]))];

/// The values, read from the controls.
const AC = { follow: "melody", parts: {} };

/// The bass lines, a bar of 16ths: R root, 3 the chord's next note, 4 the
/// fourth, 5 the fifth, 7 the chord's seventh, 8 the octave, – held, . rest.
const AC_BASS_LINES = { offbeat: "..R...R...R...R.", dub: "R-....R.....5.4.", held: "R---------------" };

function accompanyRead() {
  const v = (id, d) => { const el = document.getElementById(id); return el ? el.value : d; };
  AC.follow = v("acFollowSelect", "melody");
  for (const p of AC_PARTS) {
    AC.parts[p.k] = { on: v(acId(p, "OnSelect"), "off") === "on", pat: v(acId(p, "PatSelect"), p.def) };
    const card = document.querySelector(`.ac-part[data-p="${p.k}"]`);
    if (card) card.classList.toggle("on", AC.parts[p.k].on);
    const pw = document.querySelector(`.power[data-ac="${p.k}"]`);
    if (pw) pw.classList.toggle("on", AC.parts[p.k].on);
  }
  accompanyDraw();
}

/// A band knob's value, by id (band.js), or its default.
const acB = (part, id, d) => (typeof BAND !== "undefined" && BAND[part] && BAND[part][id] != null ? BAND[part][id] : d);

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
  const size = kind === "seventh" ? 4 : kind === "ninth" ? 5 : 3;
  while (out.length < size) out.push(acNext(cents, out[out.length - 1], kind));
  // A ninth leaves out its fifth, as a player would: root, third, seventh, ninth.
  if (kind === "ninth") out.splice(2, 1);
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

/// A seeded hash of two integers, 0–1, for the random arp and the drums' chances.
function acHash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/// Swing: how late a 16th falls, in beats (every other 16th, by the Band's Swing).
function acSwing(i16) {
  const s = typeof BAND !== "undefined" ? BAND.swing : 50;
  return i16 % 2 ? Math.max(0, (s - 50) / 50) * 0.25 : 0;
}

/// The degree nearest `target` cents above degree `r`.
function acNear(cents, r, target) {
  const n = cents.length, c0 = acCents(cents, r);
  let best = r + 1, err = Infinity;
  for (let e = r + 1; e < r + n; e++) {
    const x = Math.abs(acCents(cents, e) - c0 - target);
    if (x < err - 1e-6) { err = x; best = e; }
  }
  return best;
}

/// A bass-line token's degree on chord `ch`.
function acLineDeg(tok, ch) {
  if (tok === "3") return ch.degs[1];
  if (tok === "4") return acNear(ch.cents, ch.root, 498);
  if (tok === "5") return acFifth(ch.cents, ch.root);
  if (tok === "7") return acStack(ch.cents, ch.root, "seventh")[3];
  if (tok === "8") return ch.root + ch.cents.length;
  return ch.root;
}

/// What plays in boundary `k`'s step: a list of notes, each `{ part, at`
/// (seconds after the boundary)`, dur` (seconds)`, hz }` (drum hits are
/// drums.js's). `jump` when the boundary does not follow the last one played:
/// the bar's chord and drone start from here. Pure: the same `k` and settings
/// give the same list.
function acPlan(k, jump = false) {
  const out = [];
  const spb = 60 / bpm, t0 = k * stepBeats;
  const P = AC.parts;
  if (!P.bass || !AC_PARTS.some((p) => p.k !== "drums" && P[p.k].on)) return out;
  const arr = (what) => (typeof bandArranged === "function" ? bandArranged(what, k) : true);
  const memo = {};
  const [kindOf, rhythm] = (P.chord.pat || "triad-bar").split("-");
  const chordAt = (b) => memo[b] || (memo[b] = acChord(b, kindOf));
  const at = (beat) => (beat - t0) * spb;
  const firstBar = Math.floor(t0 / AC_BAR + 1e-9);
  // Bars that begin in this step, and the bar this step is in on a jump.
  const bars = acUnits(k, AC_BAR);
  const starts = bars.map((b) => ({ b, beat: b * AC_BAR }));
  if (jump && !bars.includes(firstBar)) starts.unshift({ b: firstBar, beat: t0 });
  const same = (x, y) => x.degs.join() === y.degs.join() && x.cents === y.cents;
  const open = typeof bandOpen === "function" ? bandOpen(k) : 0.5;

  for (const { b, beat } of starts) {
    const fresh = jump && beat === t0;
    // Chords, held: each bar, or held until they change (eight bars at most).
    if (P.chord.on && arr("chord") && (rhythm === "bar" || rhythm === "change")) {
      const ch = chordAt(b), change = rhythm === "change";
      if (!change || fresh || !same(ch, chordAt(b - 1))) {
        let nb = 1;
        if (change) while (nb < 8 && same(chordAt(b + nb), ch)) nb++;
        const end = (b + nb) * AC_BAR, n = ch.cents.length;
        acVoice(ch.degs, n, acB("chord", "chSpread", 30)).forEach((d, j) => out.push({ part: "chord", at: at(beat), dur: (end - beat) * spb * 0.98, hz: acHz(ch.cents, d), n: ch.degs.length, first: j === 0, cut: 0.6 + open * 0.8 }));
      }
    }
    // Drone: the root the scale is on, and its fifth, held until the root
    // moves, eight bars at most; it swells in as the last swells out.
    if (P.drone.on && arr("drone")) {
      const sc = acScaleAt(acK(b * AC_BAR)), root = sc.shift;
      const key = (bb) => { const s = acScaleAt(acK(bb * AC_BAR)); return s.shift + "|" + s.cents.join(); };
      const here = key(b);
      if (fresh || b % 8 === 0 || key(b - 1) !== here) {
        let nb = 1;
        while (nb < 8 && (b + nb) % 8 !== 0 && key(b + nb) === here) nb++;
        const end = (b + nb) * AC_BAR;
        const degs = P.drone.pat === "fifth" ? [root, acFifth(sc.cents, root)] : [root];
        for (const d of degs) out.push({ part: "drone", at: at(beat), dur: (end - beat) * spb, hz: acHz(sc.cents, d, -1), n: degs.length });
      }
    }
  }

  // Chords as stabs: one 16th position or more in each bar, short, by Stab.
  if (P.chord.on && arr("chord") && (rhythm === "stab" || rhythm === "stab2")) {
    const stab = typeof bdStabBeats === "function" ? bdStabBeats(acB("chord", "chStab", 35)) : 0.25;
    for (const i of acUnits(k, 0.25)) {
      const b = Math.floor(i / 16), j = i - b * 16;
      const hits = rhythm === "stab" ? [2, 10] : b % 2 ? [2, 7, 13] : [2, 10];
      if (!hits.includes(j)) continue;
      const ch = chordAt(b), n = ch.cents.length;
      acVoice(ch.degs, n, acB("chord", "chSpread", 30)).forEach((d, q) => out.push({ part: "chord", at: at(i * 0.25), dur: stab * spb, hz: acHz(ch.cents, d), n: ch.degs.length, first: q === 0, cut: 0.6 + open * 0.8 }));
    }
  }

  // Bass: on the beat, or a line of 16ths.
  if (P.bass.on && arr("bass")) {
    const oct = acB("bass", "bsOct", 1) >= 1.5 ? -2 : -1;
    const place = (d, ch) => centsToHz(rootHz, ((acCents(ch.cents, d) % 1200) + 1200) % 1200 + oct * 1200 + (d - ch.root >= ch.cents.length ? 1200 : 0));
    const line = P.bass.pat === "hand" ? acB("bass", "line", "R-..") : AC_BASS_LINES[P.bass.pat];
    if (line) {
      const L = line.padEnd(16, ".").slice(0, 16);
      for (const i of acUnits(k, 0.25)) {
        const b = Math.floor(i / 16), j = i - b * 16, tok = L[j];
        if (tok === "." || tok === "-") continue;
        let len = 1;
        while (j + len < 16 && L[j + len] === "-") len++;
        const ch = chordAt(b);
        out.push({ part: "bass", at: at(i * 0.25 + acSwing(i)), dur: len * 0.25 * spb, hz: place(acLineDeg(tok, ch), ch) });
      }
    } else {
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
  }

  // Arp: the chord, over Range octaves, at its rate.
  if (P.arp.on && arr("arp")) {
    const [dir, rate] = (P.arp.pat || "up-16").split("-");
    const u = 4 / (+rate || 16);
    const range = Math.max(1, Math.round(acB("arp", "apRange", 2)));
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
      const sw = u === 0.25 ? acSwing(i) : 0;
      out.push({ part: "arp", at: at(i * u + sw), dur: u * spb * 0.8, hz: acHz(ch.cents, seq[x]) });
    }
  }
  return out;
}

/// Everything the Band plays in boundary `k`'s step, the drums included.
function bandPlan(k, jump = false) {
  const out = acPlan(k, jump);
  if (typeof drumPlan === "function") for (const h of drumPlan(k)) if (typeof bandArranged !== "function" || bandArranged(h.slot, k)) out.push({ part: "drum", slot: h.slot, at: h.at, vel: h.vel });
  return out;
}

// ─── THE SOUND ───────────────────────────────────────────────────────────────
let acLastK = -2;

/// Built once per context, by `initAudio`, after Atmosphere's graph: the
/// Band's mixer and instruments (band.js).
function accompanyInit() {
  acLastK = -2;
  if (typeof bandInit === "function") bandInit();
}

/// Play what boundary `k` holds, at `time`. Both the scheduler and the film's
/// offline render (bridge.js) call this at every boundary, rest or not.
function accompanyAt(k, time) {
  if (!audioCtx || typeof bdNodes === "undefined" || !bdNodes) return;
  const jump = k !== acLastK + 1;
  acLastK = k;
  // A jump lets go of what the last place was holding.
  if (jump) accompanyRelease(time);
  if (!AC.parts.bass) accompanyRead();
  const plan = bandPlan(k, jump);
  for (const e of plan) bandVoice(e, time + e.at);
  accompanyBarUI(k);
}

/// Everything the Band is holding fades from `time`: on a stop, a pause, a jump.
function accompanyRelease(time) {
  const c = audioCtx;
  if (!c) return;
  const t = Math.max(time, c.currentTime);
  if (typeof bandRelease === "function") bandRelease(t);
  if (typeof atAcVoices !== "undefined") {
    for (const v of atAcVoices) {
      if (v.end <= t) continue;
      const g = v.env.gain;
      if (v.start >= t) { g.cancelScheduledValues(v.start); g.setValueAtTime(0, v.start); }
      else { if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.06); }
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
  if (typeof drumsOnStep === "function") { const w = Math.max(0, (nextNoteTime - audioCtx.currentTime) * 1000); setTimeout(() => drumsOnStep(k), w); }
  const b = Math.floor((k * stepBeats) / AC_BAR + 1e-9);
  if (b === acShownBar) return;
  acShownBar = b;
  const wait = Math.max(0, (nextNoteTime - audioCtx.currentTime) * 1000);
  setTimeout(() => accompanyDraw(b), wait);
}

function accompanyDraw(bar) {
  if (bar == null) bar = acShownBar >= 0 && typeof isPlaying !== "undefined" && isPlaying ? acShownBar : 0;
  const k0 = acK(bar * AC_BAR), k1 = Math.max(k0 + 1, acK((bar + 1) * AC_BAR));
  // The whole bar, as if played from its start, every part on, all arranged in.
  const P = AC.parts;
  if (!P.bass) return;
  const was = {}, arr = typeof BAND !== "undefined" ? BAND.arrange : false;
  for (const p of AC_PARTS) { was[p.k] = P[p.k].on; P[p.k].on = true; }
  if (typeof BAND !== "undefined") BAND.arrange = false;
  const notes = [];
  try {
    for (let k = k0; k < k1; k++) {
      const off = (k * stepBeats - bar * AC_BAR) * (60 / bpm);
      for (const e of bandPlan(k, k === k0)) notes.push({ ...e, at: e.at + off });
      // The melody, for its card.
      const s = typeof journeyStep === "function" ? journeyStep(k, acStepAt(k)) : steps[acStepAt(k)];
      if (s && !s.rest) notes.push({ part: "melody", at: off, dur: stepBeats * (60 / bpm) * 0.9, hz: s.freq || getFreqForDegree(s.degree) });
    }
  } finally {
    for (const p of AC_PARTS) P[p.k].on = was[p.k];
    if (typeof BAND !== "undefined") BAND.arrange = arr;
  }
  const barSec = AC_BAR * (60 / bpm);
  for (const p of [{ k: "melody", fam: "pitch" }, ...AC_PARTS]) {
    const c = document.getElementById(p.k === "melody" ? "acMelodyRoll" : acId(p, "Roll"));
    if (!c) continue;
    const cssW = c.offsetWidth;
    if (cssW > 0 && c.width !== cssW) c.width = cssW;
    const g = c.getContext("2d"), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const on = p.k === "melody" || P[p.k].on;
    g.fillStyle = typeof seqInk === "function" ? seqInk(p.fam, on ? 1 : 0.45) : "#888";
    if (p.k === "drums") {
      // A row a sound, low at the bottom; taller for harder hits.
      for (const e of notes.filter((x) => x.part === "drum")) {
        const r = DM_SLOTS.findIndex((s) => s.k === e.slot), x = (e.at / barSec) * W;
        const y = H - 3 - (r / (DM_SLOTS.length - 1)) * (H - 8);
        g.fillRect(Math.round(x), Math.round(y - 2 * Math.min(1.4, e.vel)), 2, Math.max(2, Math.round(3 * Math.min(1.4, e.vel))));
      }
      continue;
    }
    const mine = notes.filter((e) => e.part === p.k);
    if (!mine.length) continue;
    const lo = Math.min(...mine.map((e) => Math.log2(e.hz))), hi = Math.max(...mine.map((e) => Math.log2(e.hz)));
    const span = Math.max(0.5, hi - lo);
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

accompanyRead();
