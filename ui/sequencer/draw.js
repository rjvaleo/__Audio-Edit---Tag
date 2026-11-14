// Draw (ours, not the sequencer repository's; 14 Nov 2026, the plan
// `WORK DIR/page-mockups/DRAW-PLAN.md`, the mock-up `draw.html`). RJ: "I want to
// create a little graphic interface for doing sequencing. I'm going to draw
// shapes and things, and that's going to get converted into making music."
//
// A canvas the sequencer plays. Across is time, a loop of 1–16 bars at the
// sequencer's tempo; up is pitch, on the scale's own degrees over four octaves,
// in true pitch. What a mark sounds like comes from three things you can see:
// its **brush** (how it plays), its **ink** (which instrument plays it) and
// **where it is**.
//
//   Pen     a line: a note per degree it crosses (Degrees), or one note that
//           slides with it (Glide, Free); loudness is its thickness
//   Dots    one note each; a bigger dot is a longer note
//   Shape   a closed shape is a rhythm wheel: it turns once a bar and every
//           corner is a hit; its height is its pitch, or in Drums ink its drum
//   Cloud   a spray: every speck is a grain, so the spray's density is the
//           texture's and its height range the pitch range
//
// **Worked out, not played by ear.** `drawPlan(k, jump)` is what sounds in
// boundary `k`'s step, from the drawing and `k` alone, as `acPlan` is for the
// Band. The scheduler (app.js) and the film's render (bridge.js) both call
// `drawAt` at every boundary, so a seek, a loop's wrap, the film and the sound
// export all play what was drawn. The smudge is a hash of the mark's seed, not
// a roll of the dice.
//
// **The instruments are the sequencer's own.** Bass, Drums, Chords, Arp and
// Drone are the Band's parts (`bandVoice`, band.js), into their channels of its
// mixer; Classic is `playClassic` and Atmosphere `atmosPlay`, through the
// melody's filter; Grain is a small grain voice here. Every note goes through a
// gain of its own (`amp`), which carries the mark's loudness and thickness and
// lets go of it on a stop or a seek.
//
// The page is the host's Draw page: the Seq frame with only this showing
// (`body.only-draw`, from `seq:only`), like Atmosphere. See `docs/SEQUENCER.md`,
// "Draw".

// ─── THE INKS, THE BRUSHES ───────────────────────────────────────────────────
// [key, name, the Band's channel it plays through, if one]
const DRAW_INKS = [
  { k: "bass", name: "Bass", ch: "Bas" },
  { k: "drums", name: "Drums", ch: "Drm" },
  { k: "chords", name: "Chords", ch: "Chd" },
  { k: "arp", name: "Arp", ch: "Arp" },
  { k: "drone", name: "Drone", ch: "Drn" },
  { k: "classic", name: "Classic", ch: "Mel" },
  { k: "atmos", name: "Atmosphere", ch: null },
  { k: "grain", name: "Grain", ch: null },
];
const drawInk = (k) => DRAW_INKS.find((i) => i.k === k) || DRAW_INKS[5];
const DRAW_BRUSHES = [
  { k: "pen", name: "Pen", svg: '<path d="M2 12C5 4 8 14 14 3"/>', hint: "drag a line · its height is the pitch · draw slowly or press harder for a louder line" },
  { k: "dots", name: "Dots", svg: '<circle cx="4" cy="11" r="1.6"/><circle cx="8" cy="6" r="1.6"/><circle cx="12" cy="9" r="1.6"/>', hint: "tap for a note · hold longer for a bigger dot, a longer note" },
  { k: "shape", name: "Shape", svg: '<polygon points="8,2 14,13 2,13"/>', hint: "draw a closed shape · it turns once a bar and every corner is a hit" },
  { k: "cloud", name: "Cloud", svg: '<path d="M3 9h.1M6 5h.1M7 11h.1M10 7h.1M12 12h.1M12 4h.1M5 13h.1M9 3h.1"/>', hint: "spray grains · hold to thicken · its height range is the pitch range" },
  { k: "erase", name: "Erase", svg: '<path d="M3 13h10M5 11 11 3l3 3-6 7"/>', hint: "rub out marks, or specks of a cloud" },
  { k: "select", name: "Select", svg: '<path d="M3 2v11l3-3 2 4 2-1-2-4h4Z"/>', hint: "click a mark · drag to move · corners stretch · ⌥-drag copies · ⌫ deletes · ⌘Z undoes" },
];
/// The Drums ink's rows, from the bottom of the canvas to the top.
const DRAW_DRUM_ROWS = ["kick", "ltom", "mtom", "htom", "snare", "clap", "rim", "perc", "chh", "ohh"];
const DRAW_BARS = [1, 2, 4, 8, 16];
const DRAW_SNAPS = [["degrees", "Degrees"], ["glide", "Glide"], ["free", "Free"]];
/// How many octaves the canvas is tall: two below the root, two above.
const DRAW_OCTAVES = 4;
/// The kaleidoscope's counts, in the order its button steps through them.
const DRAW_KAL = [1, 2, 3, 4, 6, 8];
const DRAW_STORE = "mgl.draw";

// ─── THE DRAWING ─────────────────────────────────────────────────────────────
// A mark: `{ id, brush, ink, snap, level, thick, smudge, oct, seed, kal, pts }`.
// `pts` are `[x, h, w]`: x in beats from the loop's start, h in octaves from the
// bottom of the canvas (0–4, so a degree line is a whole number of steps of
// 1/n), w the thickness, dot size or speck size (0–1). For a Pen, x never runs
// backwards; for a Shape, `pts` are its corners.
const DRAW = { v: 1, bars: 4, snap: "degrees", steps: true, grain: 64, marks: [], next: 1 };
/// What is not the drawing: the tool, the ink, the selection, the undo stack.
const drawUi = { brush: "pen", ink: "classic", sel: null, ver: 0, undo: [], lastBeat: 0, gesture: null, colours: null, coloursAt: 0, hover: null };

const drawMod = (a, m) => ((a % m) + m) % m;
const drawLoopBeats = () => DRAW.bars * 4;
const drawClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/// A number in 0–1 from two integers, the same every time (as `acHash`).
function drawHash(a, b) {
  let h = Math.imul(a ^ 0x5bd1e995, 0x85ebca6b) ^ Math.imul(b + 0x3c6ef372, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const drawMarkById = (id) => DRAW.marks.find((m) => m.id === id) || null;
const drawSelected = () => (drawUi.sel == null ? null : drawMarkById(drawUi.sel));

// ─── PITCH: THE SCALE'S OWN DEGREES ──────────────────────────────────────────
const drawCents = () => SCALES[selectedScaleIdx].cents;
const drawN = () => drawCents().length;
/// A height in octaves as a row: degree lines are whole numbers, 0 the root two
/// octaves down. Rounded off at a millionth, so a point put on a line is on it.
const drawRow = (h) => Math.round(h * drawN() * 1e6) / 1e6;
/// Cents from the root of row `r`, any real `r`: on a line, that degree's cents
/// exactly; between two, the way between them.
function drawRowCents(r) {
  const c = drawCents(), n = c.length, at = (i) => c[drawMod(i, n)] + (Math.floor(i / n) - 2) * 1200;
  const lo = Math.floor(r), f = r - lo;
  return f < 1e-9 ? at(lo) : at(lo) + f * (at(lo + 1) - at(lo));
}
/// The row a mark plays for a height's row, by its snap. Degrees: the nearest
/// degree. Glide: held on a degree near its line, sliding between them, as on
/// Xenakis's UPIC. Free: any pitch.
function drawSnapRow(r, snap) {
  if (snap === "free") return r;
  if (snap === "glide") {
    const lo = Math.floor(r), f = r - lo;
    return f < 0.3 ? lo : f > 0.7 ? lo + 1 : lo + (f - 0.3) / 0.4;
  }
  return Math.round(r);
}
/// The Drums ink's drum for a height: kick at the bottom, hats at the top.
const drawSlot = (h) => DRAW_DRUM_ROWS[drawClamp(Math.floor((h / DRAW_OCTAVES) * DRAW_DRUM_ROWS.length), 0, DRAW_DRUM_ROWS.length - 1)];
/// A dot's length in beats from its size: an eighth of a beat to two beats.
const drawDotBeats = (w) => 0.125 * Math.pow(2, 4 * drawClamp(w, 0, 1));

// ─── WHAT A MARK PLAYS ───────────────────────────────────────────────────────
/// A Pen's height and thickness at `x`, between its points.
function drawPenAt(pts, x) {
  if (x <= pts[0][0]) return [pts[0][1], pts[0][2]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b[0]) {
      const f = b[0] - a[0] > 1e-9 ? (x - a[0]) / (b[0] - a[0]) : 1;
      return [a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
    }
  }
  const z = pts[pts.length - 1];
  return [z[1], z[2]];
}

/// A shape's corners in a fixed measure — a beat 60 units across, an octave 154
/// up, about as the canvas shows them — so its rhythm does not change with the
/// window. Returns the centre and each corner's angle, clockwise from the top.
const DRAW_WHEEL_X = 60, DRAW_WHEEL_Y = 154;
function drawWheel(m) {
  const n = m.pts.length;
  let cx = 0, ch = 0;
  for (const [x, h] of m.pts) { cx += x / n; ch += h / n; }
  const angles = m.pts.map(([x, h]) => drawMod(Math.atan2((x - cx) * DRAW_WHEEL_X, (h - ch) * DRAW_WHEEL_Y), 2 * Math.PI));
  return { cx, ch, angles };
}
/// The bars a wheel turns in: those its shape reaches across.
function drawWheelBars(m) {
  let lo = Infinity, hi = -Infinity;
  for (const [x] of m.pts) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  const out = [];
  for (let b = Math.max(0, Math.floor(lo / 4)); b <= Math.min(DRAW.bars - 1, Math.floor((hi - 1e-9) / 4)); b++) out.push(b);
  return out;
}

/// One mark's notes over one pass of the loop, before the kaleidoscope and the
/// smudge: `{ b, len, r, h, w, bend, amp, grain, corner }`, `b` and `len` in
/// beats, `r` the row it plays (snapped), `h` its height (for a drum), `w` its
/// thickness. `bend` is a slide, `[[beats in, rows]]`; `amp` the thickness along it.
function drawMarkNotes(m) {
  const out = [];
  const pts = m.pts;
  if (!pts || !pts.length) return out;
  const snap = m.snap || "degrees";
  const drums = m.ink === "drums", grain = m.ink === "grain";
  if (m.brush === "dots") {
    for (const [x, h, w] of pts) out.push({ b: x, len: drawDotBeats(w), r: drawSnapRow(drawRow(h), snap), h, w: 1 });
  } else if (m.brush === "cloud") {
    for (const [x, h, w] of pts) out.push({ b: x, len: 0.08 + 0.22 * w, r: drawSnapRow(drawRow(h), snap), h, w: 0.35 + 0.5 * w, grain: true });
  } else if (m.brush === "shape") {
    if (pts.length < 2) return out;
    const { ch, angles } = drawWheel(m);
    const len = Math.min(0.5, 2 / pts.length);
    for (const bar of drawWheelBars(m)) angles.forEach((a, i) => out.push({ b: bar * 4 + (4 * a) / (2 * Math.PI), len, r: drawSnapRow(drawRow(ch), snap), h: ch, w: 1, corner: i }));
  } else if (m.brush === "pen") {
    const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    if (drums || grain) {
      // Drums play a pen as a roll of sixteenths, a grain voice as a stream of
      // grains, each at the line's height and thickness where it falls.
      for (let x = x0; x <= x1 + 1e-9; x += 0.25) {
        const [h, w] = drawPenAt(pts, x);
        out.push({ b: x, len: 0.25, r: drawSnapRow(drawRow(h), snap), h, w });
      }
    } else if (snap === "degrees") {
      // A note per degree the line crosses into, held while it stays. A hand's
      // line wavers across the half-way between two degrees, so it moves on
      // only once it is well past it.
      let cur = Math.round(drawRow(pts[0][1])), b = x0, w = pts[0][2];
      for (let i = 1; i < pts.length; i++) {
        const [x, h, wi] = pts[i], r = drawRow(h);
        if (Math.abs(r - cur) > 0.65) {
          if (x - b >= 1 / 32) out.push({ b, len: x - b, r: cur, h: cur / drawN(), w });
          cur = Math.round(r); b = x; w = wi;
        } else w = Math.max(w, wi);
      }
      out.push({ b, len: Math.max(1 / 16, x1 - b), r: cur, h: cur / drawN(), w });
    } else {
      // Glide and Free: one note that goes where the line goes.
      const bend = [], amp = [];
      let last = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [x, h, w] = pts[i];
        if (x - last < 1 / 32 && i < pts.length - 1) continue;
        last = x;
        bend.push([x - x0, drawSnapRow(drawRow(h), snap)]);
        amp.push([x - x0, w]);
      }
      out.push({ b: x0, len: Math.max(1 / 16, x1 - x0), r: bend[0][1], h: pts[0][1], w: pts[0][2], bend, amp });
    }
  }
  if (!grain || m.brush === "cloud") return out;
  // The Grain ink plays everything as grains: a note becomes a run of them.
  const grains = [];
  for (const e of out) {
    const n = Math.max(1, Math.round(e.len * 16));
    for (let j = 0; j < n; j++) {
      const into = j / 16;
      let r = e.r, w = e.w;
      if (e.bend) { r = drawCurveAt(e.bend, into); w = drawCurveAt(e.amp, into); }
      grains.push({ b: e.b + into, len: 0.14, r, h: e.h, w, grain: true });
    }
  }
  return grains;
}

/// A `[[at, value]]` curve's value at `at`, straight between its points.
function drawCurveAt(c, at) {
  if (!c || !c.length) return 0;
  if (at <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (at <= c[i][0]) {
      const a = c[i - 1], b = c[i], f = b[0] - a[0] > 1e-9 ? (at - a[0]) / (b[0] - a[0]) : 1;
      return a[1] + f * (b[1] - a[1]);
    }
  }
  return c[c.length - 1][1];
}

/// Every note the drawing plays over one pass of the loop, the kaleidoscope's
/// copies and the smudge in, each with its cents from the root: sorted by when.
/// Worked out again only when the drawing, the scale or the loop changes.
let drawEventsKey = "", drawEventsList = [];
function drawEvents() {
  const key = `${drawUi.ver}|${selectedScaleIdx}|${DRAW.bars}`;
  if (key === drawEventsKey) return drawEventsList;
  const L = drawLoopBeats(), out = [];
  for (const m of DRAW.marks) {
    const notes = drawMarkNotes(m), copies = Math.max(1, m.kal | 0), oct = (m.oct | 0) * 1200;
    for (let c = 0; c < copies; c++) {
      notes.forEach((e, i) => {
        let b = e.b + (c * L) / copies, dc = 0;
        // Smudge: a little early or late, a little sharp or flat, from the seed.
        if (m.smudge > 0) {
          const s = (m.seed | 0) + c * 7919;
          b += (drawHash(s, i * 2) - 0.5) * 2 * m.smudge * 0.125;
          dc = (drawHash(s, i * 2 + 1) - 0.5) * 2 * m.smudge * 35;
        }
        const c0 = drawRowCents(e.r) + oct + dc;
        out.push({
          b: drawMod(b, L), len: e.len, c: c0, h: e.h, w: e.w, grain: !!e.grain, corner: e.corner,
          bend: e.bend ? e.bend.map(([x, r]) => [x, drawRowCents(r) + oct + dc - c0]) : null, amp: e.amp || null,
          ink: m.ink, brush: m.brush, mark: m.id, level: m.level ?? 0.8, thick: m.thick ?? 0.6, copy: c,
        });
      });
    }
  }
  out.sort((a, b) => a.b - b.b || a.mark - b.mark);
  drawEventsKey = key;
  drawEventsList = out;
  return out;
}

/// Everything that sounds in boundary `k`'s step: `{ ink, at, dur, hz, slot,
/// vel, amp, bend, grain, mark }`, `at` and `dur` in seconds from the boundary,
/// `bend` in cents from `hz`. Pure: the drawing and `k`, nothing else. After a
/// jump (Play, a seek, the loop's wrap) a note already under way at the
/// boundary starts there, as playing up to it would have had it sounding.
function drawPlan(k, jump = false) {
  const out = [];
  const list = drawEvents();
  if (!list.length) return out;
  const L = drawLoopBeats(), sb = stepBeats, spb = 60 / bpm;
  const p0 = drawMod(k * sb, L);
  const take = (lo, hi, off) => {
    for (const e of list) if (e.b >= lo - 1e-9 && e.b < hi - 1e-9) out.push(drawEv(e, (e.b - lo + off) * spb, 0, spb));
  };
  take(p0, Math.min(L, p0 + sb), 0);
  if (p0 + sb > L + 1e-9) take(0, p0 + sb - L, L - p0);
  if (jump) {
    for (const e of list) {
      const into = drawMod(p0 - e.b, L);
      if (into > 1e-9 && into < e.len - 1e-9 && !e.grain) out.push(drawEv(e, 0, into, spb));
    }
  }
  return out;
}

/// One planned note, `into` beats after it began.
function drawEv(e, at, into, spb) {
  const vel = (w) => e.level * (1 - e.thick + e.thick * drawClamp(w, 0, 1));
  const ev = { ink: e.ink, brush: e.brush, mark: e.mark, at, dur: (e.len - into) * spb, grain: e.grain, corner: e.corner };
  if (e.ink === "drums") { ev.slot = drawSlot(e.h); ev.vel = vel(e.w); return ev; }
  let c = e.c;
  if (e.bend) {
    const c0 = drawCurveAt(e.bend, into);
    c += c0;
    ev.bend = [[0, 0], ...e.bend.filter(([x]) => x > into).map(([x, d]) => [(x - into) * spb, d - c0])];
    ev.amp = [[0, vel(drawCurveAt(e.amp, into))], ...e.amp.filter(([x]) => x > into).map(([x, w]) => [(x - into) * spb, vel(w)])];
    ev.vel = ev.amp[0][1];
  } else ev.vel = vel(e.w);
  ev.cents = c;
  ev.hz = centsToHz(rootHz, c);
  return ev;
}

// ─── THE SOUND ───────────────────────────────────────────────────────────────
let drawLastK = -2, drawCtx = null, drawVoices = [], drawGrainBus = null;
const DRAW_HANN = (() => { const n = 33, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.3 * Math.pow(Math.sin((Math.PI * i) / (n - 1)), 2); return a; })();

/// A new context (the page's own, or the film's offline one): the grain
/// voice's bus, into the master with a little of the delay and Space.
function drawBuild() {
  const c = audioCtx;
  drawCtx = c;
  drawVoices = [];
  drawLastK = -2;
  drawGrainBus = null;
  if (!c || !masterGain) return;
  const g = c.createGain();
  g.connect(masterGain);
  const N = typeof bdNodes !== "undefined" ? bdNodes : null;
  for (const [into, amt] of [[N && N.dlyIn, 0.25], [N && N.spcIn, 0.4]]) {
    if (!into) continue;
    const s = c.createGain();
    s.gain.value = amt;
    g.connect(s); s.connect(into);
  }
  drawGrainBus = g;
  drawApplyGrain(true);
}
function drawApplyGrain(now) {
  if (!drawGrainBus || !audioCtx) return;
  const v = typeof bdGain === "function" ? bdGain(DRAW.grain) : DRAW.grain / 80;
  if (now) drawGrainBus.gain.value = v; else drawGrainBus.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
}

/// Where an ink's sound goes in: its part's input in the Band's mixer, the
/// melody's filter, Atmosphere's chain, or the grain bus.
function drawDest(ink, slot) {
  const N = typeof bdNodes !== "undefined" ? bdNodes : null;
  switch (ink) {
    case "classic": return filterNode;
    case "atmos": return typeof atIn !== "undefined" && atIn ? atIn : filterNode;
    case "grain": return drawGrainBus;
    case "drums": return N ? N.slots[slot || "kick"].g : null;
    case "bass": return N ? N.ch.Bas.in : null;
    case "arp": return N ? N.ch.Arp.in : null;
    case "chords": return N ? N.chordIn : null;
    case "drone": return N ? N.droneIn : null;
  }
  return null;
}

/// A slide, `[[seconds in, cents]]`, written onto a pitch parameter in cents
/// (an oscillator's detune, or a source every oscillator listens to).
function drawBend(param, bend, t) {
  if (!bend || !bend.length) return;
  param.setValueAtTime(bend[0][1], t);
  for (let i = 1; i < bend.length; i++) param.linearRampToValueAtTime(bend[i][1], t + bend[i][0]);
}

/// Play what boundary `k` holds, at `time`. The scheduler and the film's render
/// call this at every boundary, as they call `accompanyAt`.
function drawAt(k, time) {
  if (!audioCtx) return;
  if (drawCtx !== audioCtx) drawBuild();
  const jump = k !== drawLastK + 1;
  drawLastK = k;
  if (jump) drawRelease(time);
  for (const e of drawPlan(k, jump)) drawVoice(e, time + e.at);
}

/// One planned note at `t`, through its own gain, on its ink's instrument.
function drawVoice(e, t) {
  const c = audioCtx, dest = drawDest(e.ink, e.slot);
  if (!c || !dest) return;
  const amp = c.createGain();
  if (e.amp && e.amp.length > 1) {
    amp.gain.setValueAtTime(e.amp[0][1], t);
    for (let i = 1; i < e.amp.length; i++) amp.gain.linearRampToValueAtTime(e.amp[i][1], t + e.amp[i][0]);
  } else amp.gain.value = e.vel;
  amp.connect(dest);
  drawVoices.push({ amp, start: t, end: t + e.dur + 4 });
  const spb = 60 / bpm;
  if (e.ink === "drums") {
    if (typeof bandVoice === "function") bandVoice({ part: "drum", slot: e.slot, vel: e.grain ? 0.5 : 1, into: amp }, t);
  } else if (e.grain) {
    drawGrain(e.hz, t, Math.max(0.02, e.dur), amp, (e.mark * 131 + Math.round(t * 1000)) | 0);
  } else if (e.ink === "classic") {
    playClassic(e.hz, t, e.dur / ((60 / bpm) * stepBeats * 0.85), { into: amp, bend: e.bend });
    noteFilterEnv(e.hz, t, e.dur);
  } else if (e.ink === "atmos") {
    atmosPlay(e.hz, t, e.dur, { into: amp, bend: e.bend });
    noteFilterEnv(e.hz, t, e.dur);
  } else if (e.ink === "chords") {
    // A chord on the note's degree, in the scale's own stacking (accompany.js).
    // Off a degree (Free, or smudged), the whole chord is off it by as much.
    const cents = drawCents(), deg = drawNearestDegree(e.cents);
    const stack = acStack(cents, deg, "triad"), off = e.cents - acCents(cents, deg);
    stack.forEach((d, i) => bandVoice({ part: "chord", hz: centsToHz(rootHz, acCents(cents, d) + off), dur: e.dur, n: stack.length, first: i === 0, into: amp, bend: e.bend }, t));
  } else if (e.ink === "drone") {
    // The drone swells over its part's Swell, but never past half the note.
    const sw = 0.25 * Math.pow(32, ((typeof BAND !== "undefined" && BAND.drone.drSwell) || 60) / 100) * 4 * spb;
    bandVoice({ part: "drone", hz: e.hz, dur: e.dur, into: amp, bend: e.bend, atk: Math.min(sw, e.dur * 0.4) }, t);
  } else if (e.ink === "bass" || e.ink === "arp") {
    bandVoice({ part: e.ink, hz: e.hz, dur: e.dur, into: amp, bend: e.bend }, t);
  }
}

/// The degree nearest some cents from the root, counted from the root (any octave).
function drawNearestDegree(cents) {
  const c = drawCents(), n = c.length;
  let best = 0, err = Infinity;
  const oct = Math.floor(cents / 1200);
  for (let o = oct - 1; o <= oct + 1; o++) for (let d = 0; d < n; d++) {
    const x = Math.abs(c[d] + o * 1200 - cents);
    if (x < err) { err = x; best = o * n + d; }
  }
  return best;
}

/// The grain voice: a sine with a little of its octave, under a Hann window,
/// somewhere across the stereo field.
function drawGrain(hz, t, len, dest, seed) {
  const c = audioCtx, o = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain(), env = c.createGain(), pan = c.createStereoPanner();
  o.type = "sine"; o2.type = "triangle";
  o.frequency.value = hz; o2.frequency.value = hz * 2;
  g2.gain.value = 0.22;
  env.gain.value = 0;
  env.gain.setValueCurveAtTime(DRAW_HANN, t, len);
  pan.pan.value = (drawHash(seed, 3) - 0.5) * 1.3;
  o.connect(env); o2.connect(g2); g2.connect(env); env.connect(pan); pan.connect(dest);
  o.start(t); o2.start(t);
  o.stop(t + len + 0.01); o2.stop(t + len + 0.01);
}

/// Let go of what the drawing is holding, from `time`: on a stop, a pause, a jump.
function drawRelease(time) {
  const c = audioCtx;
  if (!c) return;
  const t = Math.max(time, c.currentTime);
  for (const v of drawVoices) {
    if (v.end <= t) continue;
    const g = v.amp.gain;
    if (v.start >= t) { g.cancelScheduledValues(v.start); g.setValueAtTime(0, v.start); }
    else { if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.03); }
    v.end = t + 0.3;
  }
  drawVoices = drawVoices.filter((v) => v.end > c.currentTime);
}

/// The transport has stopped: let go now, and the next boundary is a jump.
function drawStop() {
  drawLastK = -2;
  if (audioCtx && drawCtx === audioCtx) drawRelease(audioCtx.currentTime);
}

/// Whether Seq's own steps play along (the Draw page's "Seq's steps" switch).
function drawStepsMuted() { return !DRAW.steps; }

// ─── KEEPING IT ──────────────────────────────────────────────────────────────
/// The drawing as presets keep it: plain numbers, as the steps are kept.
function drawGetState() {
  return JSON.parse(JSON.stringify({ v: DRAW.v, bars: DRAW.bars, snap: DRAW.snap, steps: DRAW.steps, grain: DRAW.grain, marks: DRAW.marks, next: DRAW.next }));
}
/// A drawing back, from a preset, a composition or the page's own store.
function drawSetState(s, { keep = false } = {}) {
  if (!s || !Array.isArray(s.marks)) return;
  if (!keep) drawPushUndo();
  DRAW.bars = DRAW_BARS.includes(+s.bars) ? +s.bars : 4;
  DRAW.snap = DRAW_SNAPS.some(([k]) => k === s.snap) ? s.snap : "degrees";
  DRAW.steps = s.steps !== false;
  DRAW.grain = Number.isFinite(+s.grain) ? +s.grain : 64;
  DRAW.marks = JSON.parse(JSON.stringify(s.marks)).filter((m) => m && Array.isArray(m.pts) && DRAW_BRUSHES.some((b) => b.k === m.brush));
  DRAW.next = Math.max(+s.next || 1, ...DRAW.marks.map((m) => (m.id | 0) + 1), 1);
  if (drawUi.sel != null && !drawMarkById(drawUi.sel)) drawUi.sel = null;
  drawChanged();
  drawApplyGrain();
}
let drawSaveTimer = null;
/// Something in the drawing changed: worked out again, kept, shown.
function drawChanged() {
  drawUi.ver++;
  clearTimeout(drawSaveTimer);
  drawSaveTimer = setTimeout(() => { try { localStorage.setItem(DRAW_STORE, JSON.stringify(drawGetState())); } catch (e) { /* full or private */ } }, 250);
  drawPanel();
}
function drawPushUndo() {
  drawUi.undo.push(JSON.stringify(drawGetState()));
  if (drawUi.undo.length > 60) drawUi.undo.shift();
}
function drawUndo() {
  const s = drawUi.undo.pop();
  if (s) drawSetState(JSON.parse(s), { keep: true });
}

// ─── EDITING ─────────────────────────────────────────────────────────────────
function drawNewMark(brush, pts) {
  const m = {
    id: DRAW.next++, brush, ink: drawUi.ink, snap: DRAW.snap, level: 0.8, thick: brush === "pen" ? 0.6 : 0, smudge: 0, oct: 0,
    seed: Math.floor(Math.random() * 1e6), kal: 1, pts,
  };
  DRAW.marks.push(m);
  return m;
}
function drawBox(m) {
  let x0 = Infinity, x1 = -Infinity, h0 = Infinity, h1 = -Infinity;
  for (const [x, h] of m.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); h0 = Math.min(h0, h); h1 = Math.max(h1, h); }
  if (m.brush === "dots") x1 = Math.max(x1, ...m.pts.map(([x, , w]) => x + drawDotBeats(w)));
  return { x0, x1, h0, h1 };
}
/// The mirrors. Retrograde: flipped across, within its own span. Invert:
/// flipped up and down about the root line nearest it, in the scale's steps.
function drawRetrograde(m) {
  const { x0, x1 } = drawBox(m);
  if (m.brush === "dots") { m.pts = m.pts.map(([x, h, w]) => [x0 + x1 - x - drawDotBeats(w), h, w]); return; }
  m.pts = m.pts.map(([x, h, w]) => [x0 + x1 - x, h, w]);
  if (m.brush === "pen") m.pts.reverse();
}
function drawInvert(m) {
  const { h0, h1 } = drawBox(m);
  // The root line nearest its middle: the roots are the whole octaves.
  const root = Math.round((h0 + h1) / 2);
  m.pts = m.pts.map(([x, h, w]) => [x, drawClamp(2 * root - h, 0, DRAW_OCTAVES), w]);
}
function drawMirror(what) {
  const m = drawSelected();
  if (!m) return;
  drawPushUndo();
  if (what === "retro") drawRetrograde(m);
  else if (what === "invert") drawInvert(m);
  else if (what === "kal") m.kal = DRAW_KAL[(DRAW_KAL.indexOf(m.kal | 0) + 1) % DRAW_KAL.length] || 1;
  else if (what === "smudge") { m.seed = Math.floor(Math.random() * 1e6); if (!(m.smudge > 0)) m.smudge = 0.25; }
  else if (what === "copy") drawDuplicate();
  else if (what === "delete") { DRAW.marks = DRAW.marks.filter((x) => x !== m); drawUi.sel = null; }
  drawChanged();
}
function drawDuplicate() {
  const m = drawSelected();
  if (!m) return;
  // Put after it, a whole number of beats on; before it if there is no room.
  const { x0, x1 } = drawBox(m), w = Math.max(1, Math.ceil(x1 - x0));
  const dx = x1 + w <= drawLoopBeats() ? w : x0 - w >= 0 ? -w : 0;
  const copy = JSON.parse(JSON.stringify(m));
  copy.id = DRAW.next++;
  copy.seed = Math.floor(Math.random() * 1e6);
  copy.pts = copy.pts.map(([x, h, w]) => [x + dx, h, w]);
  DRAW.marks.push(copy);
  drawUi.sel = copy.id;
}
function drawSetBars(n) {
  if (!DRAW_BARS.includes(n) || n === DRAW.bars) return;
  drawPushUndo();
  DRAW.bars = n;
  drawChanged();
}

// ─── THE PAGE ────────────────────────────────────────────────────────────────
function drawKnob(id, label, min, max, value, step = 1) {
  return `<div class="knob-group"><span class="knob-label">${label}</span>`
    + `<div class="knob" onmousedown="knobDown(event, '${id}Slider')" ontouchstart="knobTouchStart(event,'${id}Slider')"></div>`
    + `<input type="range" class="knob-hidden" min="${min}" max="${max}" step="${step}" value="${value}" id="${id}Slider" oninput="drawMarkKnobs(this)" />`
    + `<span class="knob-val" id="${id}Val"></span></div>`;
}
const drawSel = (id, opts, v) => `<select id="${id}" data-seg>${opts.map(([o, t]) => `<option value="${o}"${String(o) === String(v) ? " selected" : ""}>${t}</option>`).join("")}</select>`;
const drawChip = (i, cls = "") => `<button type="button" class="dr-ink ${cls}" data-ink="${i.k}" style="--c: var(--ink-${i.k})"><i></i>${i.name}</button>`;
/// The Parts mixer's rows: [ink, the control it moves, its default, what it is].
const DRAW_PARTS = [
  ["bass", "mxBasLevelSlider", 80, "the Band's Bass channel"],
  ["drums", "mxDrmLevelSlider", 80, "the Band's Drums channel"],
  ["chords", "mxChdLevelSlider", 70, "the Band's Chords channel"],
  ["arp", "mxArpLevelSlider", 60, "the Band's Arp channel"],
  ["drone", "mxDrnLevelSlider", 55, "the Band's Drone channel"],
  ["classic", "mxMelLevelSlider", 80, "the Band's Melody channel: Classic, and Atmosphere with it"],
  ["atmos", "atVolSlider", null, "Atmosphere's own Vol, inside the Melody channel"],
  ["grain", null, 64, "Draw's grain voice: its own channel"],
];

function drawBuildUI() {
  const page = document.querySelector(".page");
  if (!page || document.getElementById("drawPage")) return;
  const el = document.createElement("div");
  el.className = "draw-page";
  el.id = "drawPage";
  el.innerHTML = `<section class="panel dr-head">`
    + `<span class="dr-title">DRAW <span>/ the canvas plays</span></span><span class="meta" id="drMeta"></span><span class="grow"></span>`
    + `<span class="cap">Loop</span>${drawSel("drawLoopSelect", DRAW_BARS.map((b) => [b, String(b)]), DRAW.bars)}<span class="cap">bars</span><span class="divider"></span>`
    + `<span class="cap">Snap</span>${drawSel("drawSnapSelect", DRAW_SNAPS, DRAW.snap)}<span class="divider"></span>`
    + `<button type="button" class="power on" id="drawStepsBtn" title="Seq's steps play along with the drawing: off, only the drawing plays"></button><span class="cap">Seq's steps</span><span class="divider"></span>`
    + `<button type="button" class="btn" id="drawUndoBtn" title="Undo (⌘Z)">Undo</button><button type="button" class="btn" id="drawClearBtn" title="Rub out the whole drawing (⌘Z brings it back)">Clear</button>`
    + `<button type="button" class="btn" id="drawSaveBtn" title="Save everything, the drawing with it, as a preset">Save</button></section>`
    + `<section class="panel dr-tools"><div class="seg dr-brush">${DRAW_BRUSHES.map((b) => `<button type="button" data-brush="${b.k}" title="${b.name}: ${b.hint}"><svg viewBox="0 0 16 16" aria-hidden="true">${b.svg}</svg>${b.name}</button>`).join("")}</div>`
    + `<span class="divider"></span><div class="dr-inks" id="drInks">${DRAW_INKS.map((i) => drawChip(i)).join("")}</div><span class="meta dr-hint" id="drHint"></span></section>`
    + `<div class="dr-body"><section class="panel dr-canvasp"><div class="well dr-well" id="drWell"><canvas id="drawCanvas"></canvas></div></section>`
    + `<div class="dr-side"><section class="panel dr-mark" id="drMark"><div class="ph"><b class="nm">THE MARK</b><span class="meta" id="drMarkMeta"></span></div>`
    + `<div class="dr-row2"><span class="cap">Ink</span><span class="dr-inkwrap">${drawChip(DRAW_INKS[5], "on dr-markink")}<div class="dr-inkpop" id="drInkPop">${DRAW_INKS.map((i) => drawChip(i)).join("")}</div></span>`
    + `<span class="cap">Snap</span>${drawSel("drawMarkSnapSelect", DRAW_SNAPS, "degrees")}</div>`
    + `<div class="knobs dr-knobs">${drawKnob("drawLevel", "Level", 0, 100, 80)}${drawKnob("drawThick", "Thickness", 0, 100, 60)}${drawKnob("drawSmudge", "Smudge", 0, 100, 0)}${drawKnob("drawOct", "Octave", -2, 2, 0)}</div>`
    + `<div class="cap">Mirrors</div><div class="dr-mirr">`
    + `<button type="button" class="btn" data-mirror="retro" title="Retrograde: the mark played backwards, flipped across its own span">⇆ Retrograde</button>`
    + `<button type="button" class="btn" data-mirror="invert" title="Inversion: flipped up and down about the root, in the scale's own steps">⇅ Invert</button>`
    + `<button type="button" class="btn" data-mirror="kal" id="drKalBtn" title="Kaleidoscope: the mark repeated round the loop — click for more copies">✺ Kaleidoscope</button>`
    + `<button type="button" class="btn" data-mirror="smudge" title="Smudge: loosen its timing and pitch a little — click again for another smudge">≈ Smudge</button>`
    + `<button type="button" class="btn" data-mirror="copy" title="A copy, after it (⌘D)">⧉ Duplicate</button>`
    + `<button type="button" class="btn" data-mirror="delete" title="Delete it (⌫)">✕ Delete</button></div></section>`
    + `<section class="panel dr-parts"><div class="ph"><b class="nm">PARTS</b><span class="meta">the Band's mixer</span></div><div id="drParts">`
    + DRAW_PARTS.map(([k, , , what]) => `<div class="dr-part" data-ink="${k}" style="--c: var(--ink-${k})" title="${drawInk(k).name}: ${what} · drag · double-click for its default"><i></i>${drawInk(k).name}<span class="f"><b></b></span><em></em></div>`).join("")
    + `</div></section></div></div>`;
  page.append(el);

  el.querySelector(".dr-brush").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-brush]");
    if (b) { drawUi.brush = b.dataset.brush; drawPanel(); }
  });
  document.getElementById("drInks").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ink]");
    if (!b) return;
    drawUi.ink = b.dataset.ink;
    // With Select, the ink is the selected mark's too: pick it, then its colour.
    const m = drawSelected();
    if (m && drawUi.brush === "select" && m.ink !== drawUi.ink) { drawPushUndo(); m.ink = drawUi.ink; drawChanged(); }
    drawPanel();
  });
  const pop = document.getElementById("drInkPop");
  el.querySelector(".dr-markink").addEventListener("click", (e) => { e.stopPropagation(); if (drawSelected()) pop.classList.toggle("open"); });
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ink]"), m = drawSelected();
    pop.classList.remove("open");
    if (!b || !m || m.ink === b.dataset.ink) return;
    drawPushUndo();
    m.ink = b.dataset.ink;
    drawChanged();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".dr-inkwrap")) pop.classList.remove("open"); });
  document.getElementById("drawLoopSelect").addEventListener("change", (e) => drawSetBars(+e.target.value));
  document.getElementById("drawSnapSelect").addEventListener("change", (e) => { DRAW.snap = e.target.value; drawChanged(); });
  document.getElementById("drawMarkSnapSelect").addEventListener("change", (e) => {
    const m = drawSelected();
    if (!m || m.snap === e.target.value) return;
    drawPushUndo();
    m.snap = e.target.value;
    drawChanged();
  });
  document.getElementById("drawStepsBtn").addEventListener("click", () => { DRAW.steps = !DRAW.steps; drawChanged(); });
  document.getElementById("drawUndoBtn").addEventListener("click", drawUndo);
  document.getElementById("drawClearBtn").addEventListener("click", () => {
    if (!DRAW.marks.length) return;
    drawPushUndo();
    DRAW.marks = [];
    drawUi.sel = null;
    drawChanged();
  });
  document.getElementById("drawSaveBtn").addEventListener("click", () => { if (typeof savePreset === "function") savePreset(); });
  el.querySelector(".dr-mirr").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mirror]");
    if (b) drawMirror(b.dataset.mirror);
  });
  drawPartsWire();
  drawCanvasWire();
  document.addEventListener("keydown", drawKey, true);
}

/// A knob in THE MARK moved: the selected mark's value. One undo for a drag.
let drawKnobUndoAt = 0;
function drawMarkKnobs(inp) {
  const m = drawSelected();
  drawKnobReadings();
  if (!m) return;
  if (performance.now() - drawKnobUndoAt > 800) drawPushUndo();
  drawKnobUndoAt = performance.now();
  const v = +inp.value;
  if (inp.id === "drawLevelSlider") m.level = v / 100;
  else if (inp.id === "drawThickSlider") m.thick = v / 100;
  else if (inp.id === "drawSmudgeSlider") m.smudge = v / 100;
  else if (inp.id === "drawOctSlider") m.oct = Math.round(v);
  drawChanged();
}
function drawKnobReadings() {
  const val = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  const v = (id) => +document.getElementById(id).value;
  val("drawLevelVal", Math.round(v("drawLevelSlider")) + " %");
  const th = Math.round(v("drawThickSlider"));
  val("drawThickVal", th ? th + " % · pen" : "even");
  val("drawSmudgeVal", Math.round(v("drawSmudgeSlider")) + " %");
  const o = Math.round(v("drawOctSlider"));
  val("drawOctVal", o > 0 ? "+" + o : String(o));
}

// ─── THE PARTS MIXER ─────────────────────────────────────────────────────────
// The real controls, not copies: the Band's channel faders, Atmosphere's Vol,
// and the grain voice's level. Moving one here moves it on Seq too.
function drawPartValue(k) {
  const row = DRAW_PARTS.find((p) => p[0] === k);
  if (!row[1]) return DRAW.grain;
  const el = document.getElementById(row[1]);
  return el ? +el.value : row[2] ?? 0;
}
function drawPartSet(k, v) {
  const row = DRAW_PARTS.find((p) => p[0] === k);
  v = drawClamp(Math.round(v), 0, 100);
  if (!row[1]) { DRAW.grain = v; drawApplyGrain(); drawChanged(); return; }
  const el = document.getElementById(row[1]);
  if (!el || +el.value === v) return;
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  if (window.updateKnobVisual) window.updateKnobVisual(row[1]);
}
function drawPartsWire() {
  const host = document.getElementById("drParts");
  let drag = null;
  const at = (e, f) => { const r = f.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * 100; };
  host.addEventListener("pointerdown", (e) => {
    const f = e.target.closest(".f");
    if (!f) return;
    drag = { k: f.parentElement.dataset.ink, f };
    f.setPointerCapture(e.pointerId);
    drawPartSet(drag.k, at(e, f));
  });
  host.addEventListener("pointermove", (e) => { if (drag) drawPartSet(drag.k, at(e, drag.f)); });
  host.addEventListener("pointerup", () => { drag = null; });
  host.addEventListener("dblclick", (e) => {
    const p = e.target.closest(".dr-part");
    if (!p) return;
    const row = DRAW_PARTS.find((x) => x[0] === p.dataset.ink);
    const el = row[1] && document.getElementById(row[1]);
    drawPartSet(row[0], row[2] ?? (el ? +el.defaultValue : 70));
  });
}
function drawPartsPaint() {
  for (const p of document.querySelectorAll(".dr-part")) {
    const k = p.dataset.ink, v = drawPartValue(k);
    p.style.setProperty("--v", v + "%");
    const db = k === "atmos" ? (v <= 0 ? "−∞" : (20 * Math.log10(v / 100)).toFixed(1)) : typeof bdDb === "function" ? bdDb(v) : String(v);
    p.querySelector("em").textContent = db;
    // Muted or soloed away on the Band's mixer: shown dimmed here.
    const ch = drawInk(k).ch;
    p.classList.toggle("unheard", !!(ch && typeof BAND !== "undefined" && BAND.ch[ch] && !BAND.ch[ch].heard));
  }
}

/// Everything on the page that is not the canvas, from the values.
function drawPanel() {
  const page = document.getElementById("drawPage");
  if (!page) return;
  for (const b of page.querySelectorAll(".dr-brush button")) b.classList.toggle("on", b.dataset.brush === drawUi.brush);
  for (const b of document.querySelectorAll("#drInks .dr-ink")) b.classList.toggle("on", b.dataset.ink === drawUi.ink);
  const br = DRAW_BRUSHES.find((b) => b.k === drawUi.brush);
  document.getElementById("drHint").textContent = br ? br.hint : "";
  page.dataset.brush = drawUi.brush;
  const setSel = (id, v) => { const s = document.getElementById(id); if (s && s.value !== String(v)) s.value = String(v); };
  setSel("drawLoopSelect", DRAW.bars);
  setSel("drawSnapSelect", DRAW.snap);
  document.getElementById("drawStepsBtn").classList.toggle("on", DRAW.steps);
  document.getElementById("drawUndoBtn").disabled = !drawUi.undo.length;
  const m = drawSelected();
  const mark = document.getElementById("drMark");
  mark.classList.toggle("empty", !m);
  if (m) {
    const ink = drawInk(m.ink), { x0, x1 } = drawBox(m);
    const b0 = Math.floor(x0 / 4) + 1, b1 = Math.max(b0, Math.ceil(x1 / 4));
    document.getElementById("drMarkMeta").textContent = `${DRAW_BRUSHES.find((b) => b.k === m.brush).name} · ${ink.name} · ${b0 === b1 ? "bar " + b0 : `bars ${b0}–${b1}`}${m.brush === "shape" ? ` · ${m.pts.length} a bar` : ""}`;
    const chip = mark.querySelector(".dr-markink");
    chip.style.setProperty("--c", `var(--ink-${ink.k})`);
    chip.lastChild.textContent = ink.name;
    setSel("drawMarkSnapSelect", m.snap || "degrees");
    for (const [id, v] of [["drawLevelSlider", Math.round((m.level ?? 0.8) * 100)], ["drawThickSlider", Math.round((m.thick ?? 0) * 100)], ["drawSmudgeSlider", Math.round((m.smudge ?? 0) * 100)], ["drawOctSlider", m.oct | 0]]) {
      const inp = document.getElementById(id);
      if (+inp.value !== v) { inp.value = v; if (window.updateKnobVisual) window.updateKnobVisual(id); }
    }
    document.getElementById("drKalBtn").textContent = (m.kal | 0) > 1 ? `✺ Kaleidoscope ×${m.kal}` : "✺ Kaleidoscope";
  } else {
    document.getElementById("drMarkMeta").textContent = "draw one, or pick one with Select";
    document.getElementById("drKalBtn").textContent = "✺ Kaleidoscope";
  }
  drawKnobReadings();
  drawPartsPaint();
  if (typeof lookSegsPaint === "function") lookSegsPaint();
}

// ─── THE CANVAS ──────────────────────────────────────────────────────────────
// Margins inside the well: the degree labels on the left, the bar numbers below.
const DRAW_PAD = { l: 50, r: 12, t: 12, b: 22 };
function drawGeom() {
  const cv = document.getElementById("drawCanvas");
  const W = cv.clientWidth, H = cv.clientHeight;
  const iw = Math.max(10, W - DRAW_PAD.l - DRAW_PAD.r), ih = Math.max(10, H - DRAW_PAD.t - DRAW_PAD.b), L = drawLoopBeats();
  return {
    W, H, L,
    X: (b) => DRAW_PAD.l + (b / L) * iw,
    Y: (h) => DRAW_PAD.t + (1 - h / DRAW_OCTAVES) * ih,
    bx: (px) => ((px - DRAW_PAD.l) / iw) * L,
    hy: (py) => (1 - (py - DRAW_PAD.t) / ih) * DRAW_OCTAVES,
    pxBeat: iw / L, pxOct: ih / DRAW_OCTAVES,
  };
}

/// The inks' colours as the canvas wants them, from the page's tokens: read
/// again now and then, so a theme reaches them.
function drawColours() {
  const now = performance.now();
  if (drawUi.colours && now - drawUi.coloursAt < 1000) return drawUi.colours;
  const page = document.getElementById("drawPage"), cs = getComputedStyle(page);
  const probe = document.createElement("canvas").getContext("2d");
  const hex = (v, d) => { probe.fillStyle = d; probe.fillStyle = v || d; return probe.fillStyle; };
  const col = { ink: {} };
  for (const i of DRAW_INKS) col.ink[i.k] = hex(cs.getPropertyValue(`--ink-${i.k}`).trim(), "#a99be0");
  col.text = hex(cs.getPropertyValue("--look-text").trim(), "#e8eaee");
  col.dim = hex(cs.getPropertyValue("--look-text-3").trim(), "#858b94");
  col.on = hex(cs.getPropertyValue("--on").trim(), "#ffb547");
  col.pitch = hex(cs.getPropertyValue("--f-pitch").trim(), "#a99be0");
  drawUi.colours = col;
  drawUi.coloursAt = now;
  return col;
}
const drawRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/// Where the playhead is, in beats from the document's start: the boundary the
/// scheduler will play next, less how far off it still is (and the lead the
/// sound runs ahead of the engine by).
function drawBeatNow() {
  if (typeof isPlaying === "undefined" || !isPlaying || !audioCtx) return drawUi.lastBeat;
  const delay = window.seqBridge && window.seqBridge.uiDelay ? window.seqBridge.uiDelay() : 0;
  const beat = seqStepCount * stepBeats - (nextNoteTime - (audioCtx.currentTime - delay)) * (bpm / 60);
  drawUi.lastBeat = Math.max(0, beat);
  return drawUi.lastBeat;
}

function drawPaint() {
  const cv = document.getElementById("drawCanvas");
  if (!cv || !cv.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(cv.clientWidth * dpr) || cv.height !== Math.round(cv.clientHeight * dpr)) {
    cv.width = Math.round(cv.clientWidth * dpr);
    cv.height = Math.round(cv.clientHeight * dpr);
  }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const G = drawGeom(), col = drawColours(), n = drawN(), L = G.L;
  g.clearRect(0, 0, G.W, G.H);
  const mono = getComputedStyle(cv).getPropertyValue("--mono") || "monospace";
  const drumsView = drawUi.ink === "drums" || (drawSelected() && drawSelected().ink === "drums");

  // The Drums ink's rows, faint bands, when it is the ink in hand (their
  // names go on top of the marks, below).
  const drumBand = (i) => [G.Y(((i + 1) / DRAW_DRUM_ROWS.length) * DRAW_OCTAVES), G.Y((i / DRAW_DRUM_ROWS.length) * DRAW_OCTAVES)];
  if (drumsView) {
    g.fillStyle = drawRgba(col.ink.drums, 0.035);
    for (let i = 1; i < DRAW_DRUM_ROWS.length; i += 2) { const [y0, y1] = drumBand(i); g.fillRect(G.X(0), y0, G.X(L) - G.X(0), y1 - y0); }
  }

  // The degree lines, labelled, the roots brighter: the scale's own, never 12-TET.
  g.font = `400 9px ${mono}`;
  const rowPx = G.pxOct / n;
  for (let r = 0; r <= DRAW_OCTAVES * n; r++) {
    const d = r % n, y = Math.round(G.Y(r / n)) + 0.5, root = d === 0;
    g.strokeStyle = root ? drawRgba(col.pitch, 0.35) : `rgba(255,255,255,${rowPx < 6 ? 0.035 : 0.07})`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(G.X(0), y); g.lineTo(G.X(L), y); g.stroke();
    if (root || rowPx >= 9) {
      g.fillStyle = root ? col.pitch : col.dim;
      g.fillText(`D${d + 1}${root ? " ·" + Math.round(centsToHz(rootHz, (Math.floor(r / n) - 2) * 1200)) : ""}`, 6, y + 3);
    }
  }
  // Bars and beats, and the bar numbers.
  for (let q = 0; q <= L; q++) {
    const x = Math.round(G.X(q)) + 0.5;
    g.strokeStyle = q % 4 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.14)";
    g.beginPath(); g.moveTo(x, DRAW_PAD.t - 2); g.lineTo(x, G.Y(0)); g.stroke();
  }
  g.font = `400 10px ${mono}`;
  g.fillStyle = col.dim;
  const every = DRAW.bars > 8 ? 2 : 1;
  for (let b = 0; b < DRAW.bars; b += every) g.fillText(String(b + 1), G.X(b * 4) + 4, G.H - 6);

  const beat = drawBeatNow(), at = drawMod(beat, L), playing = typeof isPlaying !== "undefined" && isPlaying;
  // The marks, the kaleidoscope's copies faint behind.
  for (const m of DRAW.marks) {
    const copies = Math.max(1, m.kal | 0);
    for (let c = copies - 1; c >= 0; c--) drawPaintMark(g, G, col, m, (c * L) / copies, c ? 0.35 : 1, at, playing);
  }
  // The selection.
  const sel = drawSelected();
  if (sel) {
    const r = drawSelRect(sel, G);
    g.setLineDash([4, 4]);
    g.strokeStyle = drawRgba(col.text, 0.5);
    g.lineWidth = 1;
    g.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0, r.y1 - r.y0);
    g.setLineDash([]);
    g.fillStyle = col.text;
    for (const [x, y] of drawHandles(r)) g.fillRect(x - 4, y - 4, 8, 8);
  }
  if (drumsView) {
    const names = { kick: "kick", ltom: "low tom", mtom: "mid tom", htom: "high tom", snare: "snare", clap: "clap", rim: "rim", perc: "cowbell", chh: "closed hat", ohh: "open hat" };
    g.font = `500 9px ${mono}`;
    g.textAlign = "right";
    DRAW_DRUM_ROWS.forEach((k, i) => {
      // On a dark backing, so a name reads over the marks under it.
      const [y0, y1] = drumBand(i), y = (y0 + y1) / 2, tw = g.measureText(names[k]).width;
      g.fillStyle = "rgba(6,7,10,0.75)";
      g.fillRect(G.X(L) - tw - 9, y - 7, tw + 7, 13);
      g.fillStyle = drawRgba(col.ink.drums, 0.75);
      g.fillText(names[k], G.X(L) - 5, y + 3);
    });
    g.textAlign = "left";
  }
  // A gesture under way: a shape's outline, the eraser.
  const ges = drawUi.gesture;
  if (ges && ges.kind === "shape" && ges.raw.length > 1) {
    g.strokeStyle = drawRgba(col.ink[drawUi.ink], 0.8);
    g.lineWidth = 2;
    g.beginPath();
    ges.raw.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
  if (drawUi.brush === "erase" && drawUi.hover) {
    g.strokeStyle = drawRgba(col.text, 0.45);
    g.beginPath(); g.arc(drawUi.hover[0], drawUi.hover[1], 12, 0, Math.PI * 2); g.stroke();
  }
  // The playhead.
  const px = G.X(at);
  g.strokeStyle = col.on;
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(px, DRAW_PAD.t - 6); g.lineTo(px, G.Y(0)); g.stroke();
  g.fillStyle = col.on;
  g.beginPath(); g.moveTo(px - 6, DRAW_PAD.t - 8); g.lineTo(px + 6, DRAW_PAD.t - 8); g.lineTo(px, DRAW_PAD.t); g.closePath(); g.fill();
}

/// A shape's corners on the canvas, turned by `turn` (0–1 of a turn) about its
/// centre in the wheel's own measure, so a corner reaches the top as it hits.
function drawWheelPts(m, G, dx, turn) {
  const { cx, ch } = drawWheel(m), a = -turn * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
  return m.pts.map(([x, h]) => {
    const u = (x - cx) * DRAW_WHEEL_X, v = (h - ch) * DRAW_WHEEL_Y;
    // Clockwise on screen: x right, h up.
    const ru = u * ca + v * sa, rv = -u * sa + v * ca;
    return [G.X(drawMod(cx + dx, G.L) + ru / DRAW_WHEEL_X), G.Y(ch + rv / DRAW_WHEEL_Y)];
  });
}

function drawPaintMark(g, G, col, m, dx, alpha, at, playing) {
  const ink = col.ink[m.ink] || col.pitch, L = G.L, lvl = 0.35 + 0.65 * (m.level ?? 0.8);
  const X = (x) => G.X(drawMod(x + dx, L));
  g.globalAlpha = alpha;
  if (m.brush === "pen") {
    const pts = m.pts, snap = m.snap || "degrees", n = drawN();
    const wrapAt = (i) => i > 0 && drawMod(pts[i][0] + dx, L) < drawMod(pts[i - 1][0] + dx, L) - 1e-9;
    // What it plays: in Degrees the steps it lands on, in Glide its slides, the
    // line itself in Free; the line as drawn, faint, under the first two.
    if (snap !== "free" && m.ink !== "drums") {
      g.strokeStyle = drawRgba(ink, 0.28 * lvl);
      g.lineWidth = 1.5;
      g.beginPath();
      pts.forEach(([x, h], i) => (i && !wrapAt(i) ? g.lineTo(X(x), G.Y(h)) : g.moveTo(X(x), G.Y(h))));
      g.stroke();
    }
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = drawRgba(ink, lvl);
    if (snap === "degrees" && m.ink !== "drums" && m.ink !== "grain") {
      const notes = drawMarkNotes({ ...m, ink: "classic" });
      g.lineWidth = 2 + 5 * (m.thick ? 0.6 : 0.4);
      g.beginPath();
      notes.forEach((e, i) => {
        const x0 = X(e.b), x1 = X(e.b + e.len) < x0 ? G.X(L) : X(e.b + e.len), y = G.Y(e.r / n);
        if (i && Math.abs(X(e.b) - X(notes[i - 1].b + notes[i - 1].len)) < 2) g.lineTo(x0, y); else g.moveTo(x0, y);
        g.lineTo(x1, y);
      });
      g.stroke();
    } else {
      for (let i = 1; i < pts.length; i++) {
        if (wrapAt(i)) continue;
        const a = pts[i - 1], b = pts[i];
        const ha = snap === "glide" && m.ink !== "drums" ? drawSnapRow(drawRow(a[1]), "glide") / n : a[1];
        const hb = snap === "glide" && m.ink !== "drums" ? drawSnapRow(drawRow(b[1]), "glide") / n : b[1];
        g.lineWidth = 1.5 + 8 * b[2];
        g.beginPath(); g.moveTo(X(a[0]), G.Y(ha)); g.lineTo(X(b[0]), G.Y(hb)); g.stroke();
      }
    }
    g.lineCap = "butt";
  } else if (m.brush === "dots") {
    const n = drawN();
    for (const [x, h, w] of m.pts) {
      const len = drawDotBeats(w), lit = playing && drawMod(at - (x + dx), L) < len;
      const r = drawSnapRow(drawRow(h), m.snap), y = G.Y(r / n);
      // In Chords ink, the chord it plays: its upper notes as bars above it.
      if (m.ink === "chords") {
        const deg = Math.round(r) - 2 * n;
        for (const d of acStack(drawCents(), deg, "triad").slice(1)) {
          const yy = G.Y((d + 2 * n + (r - Math.round(r))) / n);
          g.fillStyle = drawRgba(ink, lit ? 0.75 : 0.4);
          g.beginPath(); g.roundRect(X(x) - 3, yy - 3.5, Math.max(8, len * G.pxBeat), 7, 3.5); g.fill();
        }
      }
      g.strokeStyle = drawRgba(ink, 0.3);
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(X(x), y); g.lineTo(Math.min(G.X(L), X(x) + len * G.pxBeat), y); g.stroke();
      g.fillStyle = lit ? col.on : drawRgba(ink, lvl);
      if (lit) { g.shadowColor = col.on; g.shadowBlur = 10; }
      g.beginPath(); g.arc(X(x), y, 3.5 + 5 * w, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    }
  } else if (m.brush === "shape") {
    if (m.pts.length < 2) { g.globalAlpha = 1; return; }
    const bars = drawWheelBars(m), barOf = Math.floor(drawMod(at - dx, L) / 4);
    const active = playing && bars.includes(barOf);
    const turn = active ? drawMod(at - dx, L) / 4 - barOf : 0;
    const pts = drawWheelPts(m, G, dx, turn);
    const { cx, ch, angles } = drawWheel(m);
    const ccx = X(cx), ccy = G.Y(ch);
    let rad = 0;
    for (const [x, y] of pts) rad = Math.max(rad, Math.hypot(x - ccx, y - ccy));
    g.setLineDash([3, 5]);
    g.strokeStyle = "rgba(255,255,255,0.1)";
    g.lineWidth = 1;
    g.beginPath(); g.arc(ccx, ccy, rad, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.fillStyle = drawRgba(ink, 0.12);
    g.strokeStyle = drawRgba(ink, lvl);
    g.lineWidth = 2.5;
    g.lineJoin = "round";
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath(); g.fill(); g.stroke();
    // Which way it turns.
    g.strokeStyle = "rgba(255,255,255,0.3)";
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(ccx, ccy, rad + 9, -0.5, 0.35); g.stroke();
    const ex = ccx + (rad + 9) * Math.cos(0.35), ey = ccy + (rad + 9) * Math.sin(0.35);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath(); g.moveTo(ex - 5, ey - 1); g.lineTo(ex + 3, ey - 3); g.lineTo(ex, ey + 5); g.closePath(); g.fill();
    // The corners; the one that has just hit, lit.
    pts.forEach(([x, y], i) => {
      const since = active ? drawMod(turn - angles[i] / (2 * Math.PI), 1) * 4 : 9;
      const lit = since < 0.4;
      g.fillStyle = lit ? col.on : ink;
      if (lit) { g.shadowColor = col.on; g.shadowBlur = 12; }
      g.beginPath(); g.arc(x, y, lit ? 7.5 : 4.5, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    });
  } else if (m.brush === "cloud") {
    m.pts.forEach(([x, h, w], i) => {
      const y = G.Y(h);
      const lit = playing && drawMod(at - (x + dx), L) < 0.08 + 0.22 * w;
      g.fillStyle = lit ? col.on : drawRgba(ink, (0.3 + 0.6 * drawHash(m.seed | 0, i)) * lvl);
      g.beginPath(); g.arc(X(x), y, 0.9 + 1.9 * w, 0, Math.PI * 2); g.fill();
    });
  }
  g.globalAlpha = 1;
}

/// The selected mark's box on the canvas, and its four handles.
function drawSelRect(m, G) {
  const { x0, x1, h0, h1 } = drawBox(m), pad = 6;
  return { x0: G.X(x0) - pad, x1: G.X(Math.min(x1, G.L)) + pad, y0: G.Y(h1) - pad, y1: G.Y(h0) + pad };
}
const drawHandles = (r) => [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]];

/// Which mark is under a point on the canvas, the top one first.
function drawHit(px, py, G, slop = 8) {
  for (let i = DRAW.marks.length - 1; i >= 0; i--) {
    const m = DRAW.marks[i];
    if (drawMarkNear(m, px, py, G, slop)) return m;
  }
  return null;
}
function drawMarkNear(m, px, py, G, slop) {
  const P = m.pts.map(([x, h, w]) => [G.X(x), G.Y(h), w]);
  const seg = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? drawClamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
  };
  if (m.brush === "pen") { for (let i = 1; i < P.length; i++) if (seg(P[i - 1], P[i]) <= slop + 4 * P[i][2]) return true; return P.length === 1 && Math.hypot(px - P[0][0], py - P[0][1]) <= slop; }
  if (m.brush === "dots" || m.brush === "cloud") return P.some(([x, y, w]) => Math.hypot(px - x, py - y) <= slop + (m.brush === "dots" ? 4 + 5 * w : 2));
  if (m.brush === "shape") {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      if ((P[i][1] > py) !== (P[j][1] > py) && px < ((P[j][0] - P[i][0]) * (py - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
    }
    if (inside) return true;
    for (let i = 0; i < P.length; i++) if (seg(P[i], P[(i + 1) % P.length]) <= slop) return true;
  }
  return false;
}

// ─── DRAWING ON IT ───────────────────────────────────────────────────────────
/// Douglas–Peucker: the few points a hand-drawn outline is made of.
function drawSimplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let worst = 0, at = 0;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  // A closed outline starts and ends on one point: then it is distance from it.
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len > 1e-6 ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len : Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= eps) return [a, b];
  return [...drawSimplify(pts.slice(0, at + 1), eps).slice(0, -1), ...drawSimplify(pts.slice(at), eps)];
}
/// A closed shape's corners from the outline drawn: simplified, closed, and
/// with any corner that is barely a turn taken out (a start mid-side).
function drawCorners(raw) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of raw) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 14) return [];
  let c = drawSimplify(raw, Math.max(5, diag * 0.07));
  if (c.length > 2 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < diag * 0.3) c.pop();
  for (let changed = true; changed && c.length > 3;) {
    changed = false;
    for (let i = 0; i < c.length; i++) {
      const p = c[(i + c.length - 1) % c.length], q = c[i], r = c[(i + 1) % c.length];
      const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(r[1] - q[1], r[0] - q[0]);
      const turn = Math.abs(drawMod(a2 - a1 + Math.PI, 2 * Math.PI) - Math.PI);
      const short = Math.hypot(q[0] - p[0], q[1] - p[1]) < diag * 0.08;
      if (turn < 0.42 || short) { c.splice(i, 1); changed = true; break; }
    }
  }
  return c.length >= 3 ? c : [];
}

function drawCanvasWire() {
  const cv = document.getElementById("drawCanvas");
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const model = (G, [px, py]) => [drawClamp(G.bx(px), 0, G.L - 1e-6), drawClamp(G.hy(py), 0, DRAW_OCTAVES)];
  let growTimer = null;

  cv.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    const G = drawGeom(), p = pos(e), [x, h] = model(G, p), brush = drawUi.brush;
    const ges = { kind: brush, start: p, t: performance.now(), last: p, lastT: performance.now(), pen: e.pointerType === "pen" };
    drawUi.gesture = ges;
    if (brush === "pen") {
      drawPushUndo();
      ges.w = ges.pen && e.pressure > 0 ? e.pressure : 0.6;
      ges.mark = drawNewMark("pen", [[x, h, ges.w]]);
      drawUi.sel = ges.mark.id;
    } else if (brush === "dots") {
      drawPushUndo();
      ges.mark = drawNewMark("dots", [[x, h, 0.15]]);
      drawUi.sel = ges.mark.id;
      ges.pressure = ges.pen ? e.pressure : 0;
      // A held dot grows: the longer it is held (or the harder), the longer the note.
      growTimer = setInterval(() => {
        const held = (performance.now() - ges.t) / 1000;
        ges.mark.pts[0][2] = drawClamp(Math.max(0.15 + held * 0.9, ges.pressure), 0, 1);
        drawUi.ver++;
      }, 30);
    } else if (brush === "shape") {
      ges.raw = [p];
    } else if (brush === "cloud") {
      drawPushUndo();
      ges.mark = drawNewMark("cloud", []);
      drawUi.sel = ges.mark.id;
      ges.count = 0;
      ges.pressure = ges.pen && e.pressure > 0 ? e.pressure : 1;
      const spray = () => {
        const G2 = drawGeom(), [cx, cy] = ges.last, s = ges.mark.seed | 0;
        const k = Math.max(1, Math.round(3 * ges.pressure));
        for (let i = 0; i < k; i++) {
          const j = ges.count++;
          // Seeded scatter, round the pointer: a speck is where it landed, kept.
          const a = drawHash(s, j * 3) * Math.PI * 2, r = Math.sqrt(drawHash(s, j * 3 + 1)) * 18;
          const [sx, sh] = model(G2, [cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
          ges.mark.pts.push([sx, sh, drawHash(s, j * 3 + 2)]);
        }
        drawChangedQuiet();
      };
      spray();
      growTimer = setInterval(spray, 25);
    } else if (brush === "erase") {
      ges.erased = false;
      drawErase(p, G, ges);
    } else if (brush === "select") {
      const sel = drawSelected();
      const r = sel ? drawSelRect(sel, G) : null;
      const handle = r ? drawHandles(r).findIndex(([hx, hy]) => Math.abs(hx - p[0]) <= 7 && Math.abs(hy - p[1]) <= 7) : -1;
      let m = handle >= 0 ? sel : drawHit(p[0], p[1], G);
      if (!m) { drawUi.sel = null; drawUi.gesture = null; drawPanel(); return; }
      drawPushUndo();
      if (e.altKey && handle < 0) {
        // ⌥-drag: a copy, dragged away from where it was.
        const copy = JSON.parse(JSON.stringify(m));
        copy.id = DRAW.next++;
        copy.seed = Math.floor(Math.random() * 1e6);
        DRAW.marks.push(copy);
        m = copy;
      }
      drawUi.sel = m.id;
      ges.mark = m;
      ges.orig = JSON.parse(JSON.stringify(m.pts));
      ges.box = drawBox(m);
      ges.handle = handle;
      ges.from = [x, h];
      drawChanged();
    }
    drawPanel();
  });

  cv.addEventListener("pointermove", (e) => {
    const G = drawGeom();
    drawUi.hover = pos(e);
    const ges = drawUi.gesture;
    if (!ges) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = pos(ev), [x, h] = model(G, p);
      if (ges.kind === "pen") {
        const pts = ges.mark.pts, last = pts[pts.length - 1];
        if (Math.hypot(p[0] - ges.last[0], p[1] - ges.last[1]) < 2) continue;
        const now = ev.timeStamp || performance.now(), dt = Math.max(1, now - ges.lastT), v = Math.hypot(p[0] - ges.last[0], p[1] - ges.last[1]) / dt;
        // Thickness: the pen's pressure, or for a mouse how slowly it is drawn.
        const want = ges.pen && ev.pressure > 0 ? ev.pressure : drawClamp(1.1 - v / 1.4, 0.08, 1);
        ges.w = ges.w * 0.75 + want * 0.25;
        // Time runs one way: a pen never goes back across.
        pts.push([Math.max(x, last[0]), h, Math.round(ges.w * 1000) / 1000]);
        ges.last = p; ges.lastT = now;
        drawChangedQuiet();
      } else if (ges.kind === "shape") {
        ges.raw.push(p);
      } else if (ges.kind === "cloud") {
        ges.last = p;
        if (ges.pen && ev.pressure > 0) ges.pressure = ev.pressure;
      } else if (ges.kind === "erase") {
        drawErase(p, G, ges);
      } else if (ges.kind === "select" && ges.mark) {
        drawDrag(ges, x, h, G);
      }
    }
  });

  const end = () => {
    clearInterval(growTimer);
    growTimer = null;
    const ges = drawUi.gesture;
    drawUi.gesture = null;
    if (!ges) return;
    if (ges.kind === "shape") {
      const G = drawGeom(), corners = drawCorners(ges.raw);
      if (corners.length >= 3) {
        drawPushUndo();
        const m = drawNewMark("shape", corners.map((p) => [...model(G, p), 1]));
        drawUi.sel = m.id;
      }
    } else if (ges.kind === "pen" && ges.mark.pts.length < 2) {
      // A click with the pen: a short note where it was.
      const [x, h, w] = ges.mark.pts[0];
      ges.mark.pts.push([x + 0.25, h, w]);
    } else if (ges.kind === "cloud" && !ges.mark.pts.length) {
      DRAW.marks = DRAW.marks.filter((m) => m !== ges.mark);
    }
    drawChanged();
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", () => { drawUi.hover = null; });
}

/// A change made while drawing: worked out again at once, kept when it ends.
function drawChangedQuiet() { drawUi.ver++; }

function drawErase(p, G, ges) {
  let hit = false;
  for (const m of DRAW.marks.slice()) {
    if (!drawMarkNear(m, p[0], p[1], G, 12)) continue;
    if (!ges.erased) { drawPushUndo(); ges.erased = true; }
    hit = true;
    if (m.brush === "cloud") {
      m.pts = m.pts.filter(([x, h]) => Math.hypot(G.X(x) - p[0], G.Y(h) - p[1]) > 12);
      if (m.pts.length) continue;
    }
    DRAW.marks = DRAW.marks.filter((x) => x !== m);
    if (drawUi.sel === m.id) drawUi.sel = null;
  }
  if (hit) drawChanged();
}

/// Select's drag: the body moves the mark, a corner stretches it from the
/// opposite one. Kept inside the canvas.
function drawDrag(ges, x, h, G) {
  const b = ges.box, m = ges.mark, L = G.L;
  if (ges.handle < 0) {
    const dx = drawClamp(x - ges.from[0], -b.x0, L - b.x1), dh = drawClamp(h - ges.from[1], -b.h0, DRAW_OCTAVES - b.h1);
    m.pts = ges.orig.map(([px, ph, w]) => [px + dx, ph + dh, w]);
  } else {
    // Handles: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
    const right = ges.handle === 1 || ges.handle === 3, top = ges.handle < 2;
    const ax = right ? b.x0 : b.x1, ah = top ? b.h0 : b.h1;
    const sx = b.x1 - b.x0 > 1e-6 ? drawClamp((x - ax) / ((right ? b.x1 : b.x0) - ax), 0.05, 20) : 1;
    const sh = b.h1 - b.h0 > 1e-6 ? drawClamp((h - ah) / ((top ? b.h1 : b.h0) - ah), 0.05, 20) : 1;
    m.pts = ges.orig.map(([px, ph, w]) => [drawClamp(ax + (px - ax) * sx, 0, L - 1e-6), drawClamp(ah + (ph - ah) * sh, 0, DRAW_OCTAVES), w]);
  }
  drawChangedQuiet();
}

function drawKey(e) {
  if (!document.body.classList.contains("only-draw")) return;
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range") return;
  const mod = e.metaKey || e.ctrlKey;
  let done = true;
  if (mod && e.key.toLowerCase() === "z") drawUndo();
  else if (mod && e.key.toLowerCase() === "d") { if (drawSelected()) { drawPushUndo(); drawDuplicate(); drawChanged(); } }
  else if (!mod && (e.key === "Backspace" || e.key === "Delete")) drawMirror("delete");
  else if (!mod && e.key === "Escape") { drawUi.sel = null; drawPanel(); }
  else if (!mod && !e.altKey && { p: 1, d: 1, s: 1, c: 1, e: 1, v: 1 }[e.key]) {
    drawUi.brush = { p: "pen", d: "dots", s: "shape", c: "cloud", e: "erase", v: "select" }[e.key];
    drawPanel();
  } else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
}

// ─── WHILE IT IS ON SCREEN ───────────────────────────────────────────────────
function drawMeta() {
  const el = document.getElementById("drMeta");
  if (!el) return;
  const sc = SCALES[selectedScaleIdx], rs = document.getElementById("rootSelect");
  const root = rs && rs.selectedOptions[0] ? rs.selectedOptions[0].textContent : "";
  const t = `${sc.name} · root ${root}${rootOctave} ${rootHz.toFixed(1)} Hz · ${Math.round(bpm)} BPM`;
  if (el.textContent !== t) el.textContent = t;
}

let drawPartsAt = 0;
function drawFrame() {
  requestAnimationFrame(drawFrame);
  if (document.hidden || !document.body.classList.contains("only-draw")) return;
  drawPaint();
  const now = performance.now();
  if (now - drawPartsAt > 250) { drawPartsAt = now; drawMeta(); drawPartsPaint(); }
}

// ─── START ───────────────────────────────────────────────────────────────────
(function drawStart() {
  try {
    const s = JSON.parse(localStorage.getItem(DRAW_STORE) || "null");
    if (s) drawSetState(s, { keep: true });
  } catch (e) { /* nothing kept, or not readable: an empty canvas */ }
  drawBuildUI();
  drawPanel();
  requestAnimationFrame(drawFrame);
})();
