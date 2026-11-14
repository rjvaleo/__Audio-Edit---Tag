// Clone a song (ours, not the sequencer repository's; 14 Nov 2026, the plan
// `WORK DIR/page-mockups/CLONE-PLAN.md`, the mock-up `clone.html`). RJ: "It's the
// clone a song", and, with the PC's song-from-song tools doing the same: "figure
// out a way that they can live together … you both do the thing and then you
// can use it to check each other. And then it's how you do like fills."
//
// A page of its own on the host's rail, shown in the Seq frame like Draw and
// Atmosphere (`body.only-clone`, from `seq:only`), so it drives the Seq Band
// directly. Three steps:
//
//   1. Songs: the ones split and read on the Stems page (`/api/stems/list`,
//      `/api/stems/info`, their `songprint.json`). Clone one, Grow a snippet of
//      one, or Blend up to five.
//   2. The description: seven facets (tempo and feel, key and tuning, drums,
//      bass, chords, arrangement, texture and space), each taking its material
//      **From** a song, All of them, or the dub techno style, at a distance
//      **near ↔ far** (0 the song as it was … 100 far); the eleven words the
//      PC's model reads; and the section plan (sections, the parts in each, the
//      drum and bass patterns, a fill at the joins).
//   3. Make it sound: **MGL's instruments** (the Band plays the plan: drum
//      patterns A–D and the fill from your bars, bass lines A–D from your bass,
//      a learned scale in your song's cents, the section plan) and **the PC's
//      model** (not connected yet: shown as such).
//   4. Check: the Band's plan against the description, facet by facet.
//
// **Worked out, not rolled.** Everything comes from the readings, the settings
// and the seed (`jRng`, journey.js): the same seed and settings make the same
// piece; Re-roll draws another. What it makes is written into the Band's own
// controls (`cloneApply`), so presets keep it and Seq edits it like any Band.

// ─── THE FACETS ──────────────────────────────────────────────────────────────
const CL_FACETS = [
  { k: "tempo", n: "Tempo and feel", c: "time" },
  { k: "key", n: "Key and tuning", c: "pitch" },
  { k: "drums", n: "Drums", c: "attack" },
  { k: "bass", n: "Bass", c: "tone" },
  { k: "chords", n: "Chords", c: "space" },
  { k: "arr", n: "Arrangement", c: "level" },
  { k: "tex", n: "Texture and space", c: "tone" },
];
const CL_TIERS = ["the same", "your habits", "your shape", "far"];
const clTier = (v) => (v < 15 ? 0 : v < 50 ? 1 : v < 85 ? 2 : 3);
/// The eleven fields the PC's model reads (PC task 005).
const CL_WORDS = ["style", "tempo", "key", "drums", "bass", "harmony", "pads", "lead", "fx", "mood", "structure"];
const CL_PC = "Not connected yet. The PC's song tools (task 005) are being built there; the Stems session wires them into MGL. Until then: MGL's instruments.";

// ─── STATE (kept per browser; what it makes goes into the Band's controls) ───
const CL = {
  mode: "clone", sel: [], seed: 7, facets: {}, words: {}, edited: {},
  snip: { start: 0.38, len: 0.09 }, plan: null, songs: [], info: {}, made: null,
};
for (const f of CL_FACETS) CL.facets[f.k] = { from: "", v: { tempo: 10, key: 0, drums: 30, bass: 30, chords: 70, arr: 30, tex: 20 }[f.k] };
CL.facets.chords.from = "dub";
function clSave() {
  try { localStorage.setItem("mglClone", JSON.stringify({ mode: CL.mode, sel: CL.sel, seed: CL.seed, facets: CL.facets, words: CL.words, edited: CL.edited, snip: CL.snip, plan: CL.plan })); } catch (e) { /* private window */ }
}
function clLoadSaved() {
  try {
    const d = JSON.parse(localStorage.getItem("mglClone") || "null");
    if (d) for (const k of ["mode", "sel", "seed", "facets", "words", "edited", "snip", "plan"]) if (d[k] != null) CL[k] = d[k];
  } catch (e) { /* none */ }
}

// ─── THE SONGS ───────────────────────────────────────────────────────────────
async function clFetchSongs() {
  try {
    const r = await fetch("/api/stems/list");
    const list = r.ok ? await r.json() : [];
    CL.songs = (Array.isArray(list) ? list : list.songs || []).filter((s) => s.analysed);
  } catch (e) { CL.songs = []; }
  CL.sel = CL.sel.filter((p) => CL.songs.some((s) => s.p === p));
  if (!CL.sel.length && CL.songs.length) CL.sel = [CL.songs[0].p];
  await Promise.all(CL.sel.map(clInfo));
}
async function clInfo(p) {
  if (CL.info[p]) return CL.info[p];
  try {
    const r = await fetch("/api/stems/info?p=" + encodeURIComponent(p));
    const d = r.ok ? await r.json() : null;
    if (d && d.analysis) CL.info[p] = d.analysis;
  } catch (e) { /* not read */ }
  return CL.info[p];
}
/// A song's full title (as read), and its name without the album in brackets.
const clFullName = (p) => { const s = CL.songs.find((x) => x.p === p); const a = CL.info[p]; return (a && a.title) || (s && (s.card && s.card.title)) || (s && s.name) || p; };
const clSongName = (p) => clFullName(p).replace(/\s*\([^)]*\)\s*$/, "");
/// A word or two for the From buttons: the end of its name ("Hangar", "Breakdown").
const clShort = (p) => { const w = clSongName(p).split(/\s+/).filter((x) => !/^(in|the|of|a|an|on|to)$/i.test(x)); return w.slice(-1)[0] || clSongName(p); };
/// The readings a facet takes its material from.
function clSources(fk) {
  const from = CL.facets[fk].from;
  if (from === "dub") return [];
  if (from === "all") return CL.sel.map((p) => CL.info[p]).filter(Boolean);
  if (!from) return [CL.info[CL.sel[0]]].filter(Boolean);
  return [CL.info[from]].filter(Boolean);
}
const clFirst = (fk) => clSources(fk)[0] || CL.info[CL.sel[0]] || null;

// ─── MAKING IT: THE READINGS → THE BAND ─────────────────────────────────────
const clVel = (ch) => (ch === "X" ? 115 : ch === "x" ? 60 : 0);
/// A grid (drums.js) from a songprint bar's rows: kick, snare and hat.
function clGridFrom(rows) {
  const g = dmEmptyGrid();
  const put = (slot, arr) => { arr.forEach((v, i) => { if (i < 16 && v) g[slot].steps[i].v = Math.max(1, Math.min(127, Math.round(v))); }); };
  put("kick", rows.kick); put("snare", rows.snare); put("chh", rows.hat);
  return g;
}
const clRowsFromBar = (fam) => ({ kick: [...fam.kick].map(clVel), snare: [...fam.snare].map(clVel), hat: [...fam.hat].map(clVel) });
const clHits = (rows) => ["kick", "snare", "hat"].reduce((a, r) => a + rows[r].filter((v) => v > 0).length, 0);

/// Drum patterns A–D and the fill, at the drums facet's distance.
function clDrums(rnd) {
  const t = clTier(CL.facets.drums.v), srcs = clSources("drums");
  if (!srcs.length || t === 3) return clDrumsDub(rnd);
  let fams = [];
  for (const a of srcs) for (const f of (a.drums && a.drums.common_bars) || []) fams.push({ ...clRowsFromBar(f), n: f.bars || 1 });
  // Grow: the snippet's own bars first.
  if (CL.mode === "grow") {
    const a = CL.info[CL.sel[0]];
    if (a && a.bars) {
      const n = a.bars.length, b0 = Math.floor(CL.snip.start * n), b1 = Math.max(b0 + 1, Math.floor((CL.snip.start + CL.snip.len) * n));
      const own = a.bars.slice(b0, b1).filter((b) => b.kick).map((b) => ({ kick: b.kick.map((v) => v * 127), snare: b.snare.map((v) => v * 127), hat: b.hat.map((v) => v * 127), n: 1 }));
      fams = own.concat(fams);
    }
  }
  if (!fams.length) return clDrumsDub(rnd);
  let pick;
  if (t === 0) pick = fams.slice(0, 4);
  else {
    // Your habits: four of your bars, drawn by how often you used them.
    const pool = fams.slice(0, 8), tot = pool.reduce((a, f) => a + f.n, 0);
    pick = [];
    for (let i = 0; i < 4; i++) { let r = rnd() * tot, f = pool[0]; for (const x of pool) { if ((r -= x.n) <= 0) { f = x; break; } } pick.push(f); }
  }
  while (pick.length < 4) pick.push(pick[pick.length % Math.max(1, pick.length)] || fams[0]);
  // Your shape: the bars keep how busy they are; the hits move.
  const vary = (rows) => {
    if (t < 2) return rows;
    const o = {};
    for (const r of ["kick", "snare", "hat"]) {
      const a = rows[r].slice();
      for (let i = 0; i < 16; i++) if (a[i] && rnd() < 0.35) { const j = Math.floor(rnd() * 16); if (!a[j]) { a[j] = a[i]; a[i] = 0; } }
      o[r] = a;
    }
    return o;
  };
  const pats = {};
  "ABCD".split("").forEach((l, i) => { pats[l] = clGridFrom(vary(pick[i])); });
  pats.F = clFill(srcs, rnd) || clGridFrom(vary(pick[0]));
  return { pats, fams: pick };
}
/// Far, or the dub style: the research's patterns.
function clDrumsDub(rnd) {
  const keys = ["dub", "deep", "four", "dub"];
  const p = {};
  "ABCD".split("").forEach((l, i) => { p[l] = dmFromPattern(keys[(i + Math.floor(rnd() * 2)) % 4]); });
  p.F = dmFromPattern("broken");
  return { pats: p, fams: [] };
}
/// The fill: the bars just before your section changes, averaged.
function clFill(srcs) {
  const acc = { kick: new Array(16).fill(0), snare: new Array(16).fill(0), hat: new Array(16).fill(0) };
  let n = 0;
  for (const a of srcs) {
    if (!a.sections || !a.bars) continue;
    for (const s of a.sections.slice(1)) {
      const b = a.bars[s.start_bar - 1];
      if (!b || !b.kick) continue;
      for (const r of ["kick", "snare", "hat"]) b[r].forEach((v, i) => { acc[r][i] += v; });
      n++;
    }
  }
  if (!n) return null;
  const rows = {};
  for (const r of ["kick", "snare", "hat"]) rows[r] = acc[r].map((v) => (v / n > 0.18 ? Math.round(Math.min(1, (v / n) * 1.3) * 127) : 0));
  return clGridFrom(rows);
}

/// A bass note's token (accompany.js's bass lines): R 3 4 5 7 8, by its
/// interval above the tonic.
function clToken(midi, tonic, low) {
  const m = Math.round(midi), rel = (((m - tonic) % 12) + 12) % 12;
  if (rel === 0) return m - low >= 12 ? "8" : "R";
  return rel <= 4 ? "3" : rel <= 6 ? "4" : rel <= 8 ? "5" : "7";
}
/// Bass lines A–D, at the bass facet's distance.
function clBass(rnd) {
  const t = clTier(CL.facets.bass.v), srcs = clSources("bass");
  const dub = ["R-....R.....5.4.", "..R...R...R...R.", "R---------------", "R-..R-....5-..4."];
  if (!srcs.length || t === 3) return { A: dub[0], B: dub[1], C: dub[2], D: dub[3] };
  // Every bar's line, as tokens.
  const lines = [];
  for (const a of srcs) {
    const notes = (a.bass && a.bass.notes) || [];
    const tonic = a.key ? a.key.tonic_pc : 0;
    const low = notes.length ? Math.min(...notes.map((x) => Math.round(x[3]))) : 0;
    const byBar = new Map();
    for (const [bar, step, len, midi] of notes) {
      if (!byBar.has(bar)) byBar.set(bar, ".".repeat(16).split(""));
      const L = byBar.get(bar), s = Math.max(0, Math.min(15, step | 0));
      L[s] = clToken(midi, tonic, low);
      for (let j = 1; j < Math.min(16 - s, len | 0); j++) if (L[s + j] === ".") L[s + j] = "-";
    }
    for (const L of byBar.values()) { const str = L.join(""), n = str.replace(/[.-]/g, "").length; if (n) lines.push({ str, n }); }
  }
  if (!lines.length) return { A: dub[0], B: dub[1], C: dub[2], D: dub[3] };
  // The lines you played most, by how many times each one comes back.
  const count = new Map();
  for (const l of lines) count.set(l.str, (count.get(l.str) || 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0].replace(/[.-]/g, "").length - a[0].replace(/[.-]/g, "").length).map((e) => e[0]);
  let pick;
  if (t === 0) pick = top.slice(0, 4);
  else if (t === 1) {
    // Your habits: a new line a step at a time, each step drawn from what you
    // played at that step.
    pick = [];
    for (let k = 0; k < 4; k++) {
      let s = "";
      for (let j = 0; j < 16; j++) { const L = lines[Math.floor(rnd() * lines.length)].str; s += L[j]; }
      pick.push(s.replace(/^-/, "R"));
    }
  } else {
    // Your shape: as busy as yours, on the roots and fifths.
    pick = top.slice(0, 4).map((L) => L.replace(/[R3457 8]/g, () => "R458"[Math.floor(rnd() * 4)]));
  }
  while (pick.length < 4) pick.push(pick[0]);
  return { A: pick[0], B: pick[1], C: pick[2], D: pick[3] };
}

/// The section plan, at the arrangement facet's distance.
function clPlan(rnd, drumFams) {
  const t = clTier(CL.facets.arr.v), srcs = clSources("arr");
  const parts = (stems, i, n) => ({
    drums: stems.includes("drums") ? "A" : "", bass: stems.includes("bass") ? "A" : "",
    chord: stems.includes("other") ? 1 : 0, drone: stems.includes("other") || i === 0 ? 1 : 0,
    arp: 0, melody: stems.includes("vocals") ? 1 : 0, open: 0.5,
  });
  let secs = [];
  const src = srcs[0];
  if (src && src.sections && src.sections.length && t < 3) {
    if (t === 0) {
      secs = src.sections.map((s, i) => ({ l: s.label, b: s.bars, ...parts(s.stems_on || [], i, src.sections.length), db: s.mix_db }));
    } else {
      // Your habits: new sections, their lengths and labels drawn from yours,
      // each label keeping the stems it had.
      const pool = srcs.flatMap((a) => a.sections || []);
      const lens = pool.map((s) => Math.max(4, Math.min(32, Math.round(s.bars / 4) * 4 || 4)));
      const byLabel = {};
      for (const s of pool) byLabel[s.label] = s;
      const labels = Object.keys(byLabel);
      let bars = 0;
      while (bars < 128 && secs.length < 40) {
        const s = pool[Math.floor(rnd() * pool.length)];
        let b = t === 2 ? [4, 8, 12, 16][Math.floor(rnd() * 4)] : lens[Math.floor(rnd() * lens.length)];
        b = Math.max(4, Math.min(b, 128 - bars));
        const lab = t === 2 ? labels[Math.floor(rnd() * labels.length)] : s.label;
        secs.push({ l: lab, b, ...parts(byLabel[lab].stems_on || [], secs.length, 0), db: byLabel[lab].mix_db });
        bars += b;
      }
      if (secs.length) { secs[0].drums = ""; }
    }
  } else {
    // Far, or the dub style: the research's 128-bar shape.
    const shape = [["Intro", 16, "", "", 0, 1], ["Build", 16, "A", "", 1, 1], ["Build", 16, "A", "A", 1, 1], ["Peak", 24, "B", "A", 1, 1], ["Break", 8, "", "", 1, 1], ["Peak", 24, "C", "B", 1, 1], ["Outro", 24, "A", "A", 0, 1]];
    secs = shape.map(([l, b, d, ba, ch, dr]) => ({ l, b, drums: d, bass: ba, chord: ch, drone: dr, arp: l === "Peak" ? 1 : 0, melody: 0, open: l === "Peak" ? 0.9 : l === "Break" ? 0.6 : 0.4 }));
  }
  // Drum and bass patterns per section: the same label, the same pattern.
  const letterOf = {};
  let next = 0;
  for (const s of secs) {
    if (!(s.l in letterOf)) letterOf[s.l] = "ABCD"[t === 0 ? next++ % 4 : Math.floor(rnd() * 4)];
    if (s.drums) s.drums = letterOf[s.l];
    if (s.bass) s.bass = letterOf[s.l];
  }
  // How open the chords' filter is: louder sections open it.
  const dbs = secs.map((s) => s.db).filter((x) => x != null);
  if (dbs.length) { const lo = Math.min(...dbs), hi = Math.max(...dbs); for (const s of secs) if (s.db != null) s.open = hi > lo ? 0.25 + 0.7 * ((s.db - lo) / (hi - lo)) : 0.5; }
  // A fill where the material changes.
  secs.forEach((s, i) => { s.fill = i < secs.length - 1 && secs[i + 1].l !== s.l && !!s.drums ? 1 : 0; delete s.db; });
  // Grow: the snippet is the first section.
  if (CL.mode === "grow" && src) { const n = src.bar_count || (src.bars || []).length || 1; secs.unshift({ l: "S", b: Math.max(1, Math.round(CL.snip.len * n)), drums: "A", bass: "A", chord: 1, drone: 1, arp: 0, melody: 0, open: 0.6, fill: 0, snip: 1 }); }
  return { secs };
}

/// The learned scale: the song's own positions in the octave, in cents.
function clScale(a) {
  if (!a || !a.tuning) return null;
  // The tonic, and the positions the reading found; ones within 30 cents of
  // each other (or of the octave) are one note heard slightly apart.
  const pos = (a.tuning.scale_cents_above_tonic || []).map((c) => ((Math.round(c) % 1200) + 1200) % 1200).sort((x, y) => x - y);
  const cents = [0];
  for (const c of pos) if (c - cents[cents.length - 1] >= 30 && 1200 - c >= 30) cents.push(c);
  if (cents.length < 3) return null;
  return { name: (a.title || "Your song").replace(/\s*\([^)]*\)\s*$/, "") + " (learned)", cents, tonic: a.key ? a.key.tonic_pc : 9 };
}

/// Everything, from the readings, the settings and the seed.
function cloneMake() {
  const rnd = jRng(CL.seed * 2654435761 + CL.sel.length * 97 + CL_FACETS.reduce((a, f, i) => a + CL.facets[f.k].v * (i + 3) + (CL.facets[f.k].from || "").length * 13, 0) + (CL.mode === "grow" ? 991 : CL.mode === "blend" ? 577 : 0));
  // Tempo and feel.
  const ta = clFirst("tempo"), tt = clTier(CL.facets.tempo.v);
  let bpmV = CL.facets.tempo.from === "dub" || !ta ? 122 : (clSources("tempo").reduce((a, x) => a + (x.tempo ? +x.tempo.bpm : 120), 0) / Math.max(1, clSources("tempo").length));
  if (tt === 1) bpmV += (rnd() - 0.5) * 4; else if (tt === 2) bpmV *= 1 + (rnd() - 0.5) * 0.12; else if (tt === 3) bpmV = 110 + rnd() * 25;
  const swing = ta && ta.drums && CL.facets.tempo.from !== "dub" ? Math.max(50, Math.min(75, +ta.drums.swing_16th_pct || 50)) : 52;
  // Key and tuning.
  const ka = clFirst("key"), kt = clTier(CL.facets.key.v);
  const scale = CL.facets.key.from === "dub" ? null : clScale(ka);
  let tonic = scale ? scale.tonic : 9;
  if (kt === 2) tonic = (tonic + (rnd() < 0.5 ? 5 : 7)) % 12;
  const { pats, fams } = clDrums(rnd);
  const lines = clBass(rnd);
  const plan = clPlan(rnd, fams);
  // Chords.
  const chordPat = CL.facets.chords.from === "dub" || clTier(CL.facets.chords.v) >= 2 ? "seventh-stab" : (ka && ka.key && ka.key.minor ? "seventh-change" : "triad-change");
  // Texture and space.
  const xa = clFirst("tex"), xt = clTier(CL.facets.tex.v);
  let cut = 45, space = 25, delayT = "0.75", chPan = 0;
  if (xa && xa.texture && CL.facets.tex.from !== "dub" && xt < 3) {
    const other = (xa.texture.stems || []).find((s) => s.stem === "other");
    if (other && other.brightness_hz) cut = Math.max(5, Math.min(95, (100 * Math.log(other.brightness_hz / 150)) / Math.log(80)));
    space = Math.round(Math.min(90, 8 + (xa.texture.smear_mean || 0.2) * 100));
    const ech = xa.texture.echoes_other_stem || [];
    const strongest = ech.reduce((a, e) => (!a || e.strength > a.strength ? e : a), null);
    delayT = strongest ? String(strongest.beats >= 0.7 && strongest.beats <= 0.8 ? 0.75 : strongest.beats >= 0.9 ? 1 : 0.5) : "0.5";
    chPan = Math.round((xa.texture.width_mean || 0) * 100);
    if (xt === 2) { cut = Math.max(5, Math.min(95, cut + (rnd() - 0.5) * 30)); space = Math.round(space * (0.6 + rnd() * 0.8)); }
  }
  CL.plan = plan;
  CL.made = { bpm: Math.round(bpmV * 10) / 10, swing: Math.round(swing), scale, tonic, pats, lines, chordPat, cut: Math.round(cut), space, delayT, chPan };
  clWords(false);
  clSave();
  return CL.made;
}

// ─── INTO THE BAND ───────────────────────────────────────────────────────────
/// Add a learned scale to the scale library, once, and keep it for next time.
function cloneAddScale(sc) {
  let i = SCALES.findIndex((s) => s.name === sc.name);
  if (i < 0) {
    SCALES.push({ name: sc.name, cents: sc.cents, cat: "LEARNED FROM YOUR SONGS" });
    i = SCALES.length - 1;
    try {
      const kept = JSON.parse(localStorage.getItem("mglLearnedScales") || "[]").filter((s) => s.name !== sc.name);
      kept.push({ name: sc.name, cents: sc.cents });
      localStorage.setItem("mglLearnedScales", JSON.stringify(kept));
    } catch (e) { /* not kept */ }
    renderScaleList();
  }
  return i;
}
function clLearnedScalesBack() {
  try {
    const kept = JSON.parse(localStorage.getItem("mglLearnedScales") || "[]");
    let added = false;
    for (const s of kept) if (!SCALES.some((x) => x.name === s.name)) { SCALES.push({ name: s.name, cents: s.cents, cat: "LEARNED FROM YOUR SONGS" }); added = true; }
    if (added) renderScaleList();
  } catch (e) { /* none */ }
}

/// Write what was made into the Band's controls, as a person would.
function cloneApply() {
  const M = CL.made || cloneMake();
  const set = (id, v, ev = "change") => { const el = document.getElementById(id); if (!el) return; el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); if (ev === "input" && window.updateKnobVisual) window.updateKnobVisual(id); };
  set("bpmSlider", M.bpm, "input");
  if (typeof updateBPM === "function") updateBPM(M.bpm);
  set("bdSwingSlider", M.swing, "input");
  // The scale, in the song's cents, on its root.
  if (M.scale) selectScale(cloneAddScale(M.scale));
  set("rootSelect", String(M.tonic));
  if (typeof updateRoot === "function") updateRoot();
  // The Journey would move the root; the plan is the trip here.
  set("jOnSelect", "off");
  if (typeof journeyRead === "function") journeyRead();
  // Every part on that the plan uses.
  const uses = (k) => CL.plan.secs.some((s) => !!s[k]);
  set("acDrumsOnSelect", uses("drums") ? "on" : "off");
  set("acBassOnSelect", uses("bass") ? "on" : "off");
  set("acChordOnSelect", uses("chord") ? "on" : "off");
  set("acDroneOnSelect", uses("drone") ? "on" : "off");
  set("acArpOnSelect", uses("arp") ? "on" : "off");
  set("acFollowSelect", "root");
  set("acChordPatSelect", M.chordPat);
  set("acBassPatSelect", "hand");
  // Drums: the patterns and the fill; the bass lines; the plan.
  DM.pats = M.pats; DM.cur = "A"; DM.grid = DM.pats.A;
  dmGridSave();
  set("dmGridText", document.getElementById("dmGridText").value);
  set("dmRateSelect", "16");
  set("bsLineText", JSON.stringify(M.lines));
  set("bdPlanText", JSON.stringify(CL.plan));
  set("bdArrangeSelect", "plan");
  // Texture and space.
  set("chCutSlider", M.cut, "input");
  set("mxChdSpcSlider", M.space, "input");
  set("mxDrnSpcSlider", Math.min(90, M.space + 20), "input");
  set("mxChdPanSlider", M.chPan, "input");
  set("delayTimeSelect", M.delayT);
  if (typeof updateDelay === "function") updateDelay();
  if (typeof accompanyRead === "function") accompanyRead();
  if (typeof bandRead === "function") bandRead();
  if (typeof drumsRead === "function") drumsRead();
  clCheck();
}

// ─── THE WORDS THE PC'S MODEL READS ─────────────────────────────────────────
function clWords(force) {
  const M = CL.made || {};
  const name = (fk) => { const f = CL.facets[fk].from; return f === "dub" ? "dub techno" : f === "all" ? "your songs" : clShort(f || CL.sel[0] || ""); };
  const a = clFirst("key");
  const val = {
    style: (CL.mode === "grow" ? "grown from a snippet of " + clSongName(CL.sel[0]) + ", " : CL.mode === "blend" ? `a blend of ${CL.sel.length} songs, ` : "") + (CL_FACETS.some((f) => CL.facets[f.k].from === "dub") ? "dub techno, instrumental electronic" : "instrumental electronic"),
    tempo: `${M.bpm || "?"} BPM, ${M.swing > 52 ? "swung " + M.swing + "%" : "straight"}`,
    key: a && a.key ? `${a.key.name}${M.scale ? ", its own tuning (" + M.scale.cents.join(" ") + " cents)" : ""}` : "minor",
    drums: `like ${name("drums")}: ${clTier(CL.facets.drums.v) === 0 ? "the same bars" : "restless, ever-changing"}`,
    bass: `like ${name("bass")}: deep, held roots`,
    harmony: (M.chordPat || "").includes("stab") ? "dub chord stabs drenched in delay" : "slow chord changes",
    pads: "soft held pad under the chords", lead: "sparse, textural, no vocals",
    fx: M.space > 40 ? "wide, echoes and reverb" : "dry, narrow, close",
    mood: clTier(CL.facets.chords.v) >= 2 ? "hypnotic, deep" : "dark, restless",
    structure: CL.plan ? `${CL.plan.secs.length} sections, ${CL.plan.secs.reduce((x, s) => x + s.b, 0)} bars` : "",
  };
  for (const k of CL_WORDS) if (force || !CL.edited[k]) { CL.words[k] = val[k]; if (force) delete CL.edited[k]; }
}

/// The shared description (CLONE-PLAN.md): what both engines read.
function cloneDescription() {
  const facets = {};
  const names = { tempo: "tempo.bpm", key: "key.name", drums: "drums.common_bars", bass: "bass.notes", chords: "chords.changes", arr: "change.sections", tex: "texture" };
  for (const f of CL_FACETS) facets[names[f.k]] = { from: CL.facets[f.k].from === "dub" ? "dub techno" : CL.facets[f.k].from === "all" ? "all" : clSongName(CL.facets[f.k].from || CL.sel[0]), near_far: CL.facets[f.k].v };
  return { songs: CL.sel.map(clSongName), mode: CL.mode, facets, sections: (CL.plan ? CL.plan.secs : []).map((s) => ({ label: s.l, bars: s.b, parts: ["drums", "bass", "chord", "drone", "arp", "melody"].filter((k) => !!s[k]) })), words: { ...CL.words }, seed: CL.seed };
}

// ─── THE CHECK: THE BAND AGAINST THE DESCRIPTION ────────────────────────────
const clMedian = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
function clCheck() {
  const box = document.getElementById("clCheck");
  if (!box) return;
  const M = CL.made, P = CL.plan;
  let h = `<span class="hd">FACET</span><span class="hd">THE DESCRIPTION</span><span class="hd">THE BAND PLAYS</span><span class="hd">THE PC'S TAKE</span><span class="hd">AGREE</span>`;
  if (!M || !P) { box.innerHTML = h + `<span class="meta" style="grid-column:1/-1">Generate, and the Band's plan is set beside the description here.</span>`; return; }
  const ta = clFirst("tempo"), ka = clFirst("key"), da = clSources("drums"), aa = clFirst("arr");
  const descBpm = ta && ta.tempo ? +ta.tempo.bpm : 122;
  const sc = typeof selectedScaleIdx !== "undefined" ? SCALES[selectedScaleIdx] : null;
  const famHits = da.flatMap((a) => ((a.drums && a.drums.common_bars) || []).slice(0, 4).map((f) => clHits(clRowsFromBar(f))));
  const descHits = famHits.length ? famHits.reduce((a, b) => a + b, 0) / famHits.length : 0;
  const bandHits = ["A", "B", "C", "D"].map((l) => { const g = DM.pats && DM.pats[l]; return g ? ["kick", "snare", "chh"].reduce((a, r) => a + g[r].steps.slice(0, 16).filter((x) => x.v).length, 0) : 0; });
  const bh = bandHits.reduce((a, b) => a + b, 0) / 4;
  const pcs = (lines) => [...new Set(Object.values(lines).join("").replace(/[.-]/g, "").split(""))].sort().join(" ");
  const rows = [
    ["Tempo", `${descBpm.toFixed(1)} BPM`, `${(+M.bpm).toFixed(1)} BPM`, Math.abs(M.bpm - descBpm) / 3],
    ["Key and tuning", ka && ka.key ? `${ka.key.name}${M.scale ? " · " + M.scale.cents.join(" ") + "¢" : ""}` : "—", sc ? `${sc.name.replace(/ \(learned\)$/, "")} · ${sc.cents.map((c) => Math.round(c)).join(" ")}¢` : "—", M.scale && sc && sc.cents.join() === M.scale.cents.join() ? 0 : M.scale ? 1 : 0.4],
    // Sections: how long they run (the piece can be shorter than the song).
    ["Sections", aa && aa.sections ? `${aa.sections.length} of ~${clMedian(aa.sections.map((s) => s.bars))} bars` : "—", `${P.secs.length} of ~${clMedian(P.secs.map((s) => s.b))} bars`, aa && aa.sections ? Math.min(1, Math.abs(clMedian(P.secs.map((s) => s.b)) - clMedian(aa.sections.map((s) => s.bars))) / Math.max(4, clMedian(aa.sections.map((s) => s.bars)))) : 0.5],
    ["Drums per bar", descHits ? `${descHits.toFixed(1)} hits` : "—", `${bh.toFixed(1)} hits`, descHits ? Math.min(1, (Math.abs(bh - descHits) / descHits) * 1.5) : 0.5],
    ["Bass notes", "R 3 4 5 7 8 by step", pcs(M.lines), 0.1],
    ["Space", clFirst("tex") && clFirst("tex").texture ? `smear ${(+clFirst("tex").texture.smear_mean || 0).toFixed(2)}` : "the style's", `chords' space ${M.space}%`, 0.1],
  ];
  for (const [n, d, b, gap] of rows) {
    const cls = gap < 0.15 ? "ok" : gap < 0.5 ? "warn" : "bad";
    h += `<span class="fn">${n}</span><span class="m">${d}</span><span class="m">${b}</span><span class="m dim">needs the PC's model</span><span class="m agree ${cls}"><span class="g"><i style="width:${Math.round(100 - Math.min(1, gap) * 70)}%"></i></span>${cls === "ok" ? "the same" : cls === "warn" ? "close" : "apart"}</span>`;
  }
  box.innerHTML = h;
}

// ─── THE PAGE ────────────────────────────────────────────────────────────────
const clEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function clToast(t) {
  let el = document.getElementById("clToast");
  if (!el) { el = document.createElement("div"); el.id = "clToast"; el.className = "cl-toast"; document.body.append(el); }
  el.textContent = t; el.classList.add("on");
  clearTimeout(clToast.t); clToast.t = setTimeout(() => el.classList.remove("on"), 1800);
}

function cloneBuildUI() {
  if (document.querySelector(".clone-page")) return;
  const page = document.querySelector(".page");
  const sec = document.createElement("section");
  sec.className = "clone-page";
  sec.innerHTML = `
  <div class="panel cl-head"><span class="cl-title">CLONE <span>/ A NEW PIECE FROM YOUR SONGS</span></span><span class="grow"></span>
    <span class="cl-steps"><b data-step="1"><i>1</i>Songs</b><s></s><b data-step="2"><i>2</i>The description</b><s></s><b data-step="3"><i>3</i>Make it sound</b><s></s><b data-step="4"><i>4</i>Check</b></span></div>
  <div class="panel">
    <div class="ph"><b class="nm">1 · SONGS</b><span class="meta">split and read on the Stems page</span><span class="grow"></span>
      <span class="cap">Make</span><span class="seg" id="clMode"><button type="button" data-m="clone">Clone one</button><button type="button" data-m="grow">Grow a snippet</button><button type="button" data-m="blend">Blend up to five</button></span></div>
    <span class="meta cl-help" id="clHelp"></span>
    <div class="cl-songs" id="clSongs"></div>
    <div class="cl-snip" id="clSnip"><div class="well"><canvas id="clSnipWave"></canvas><div class="cl-reg" id="clReg"><span id="clRegLabel"></span></div></div></div>
  </div>
  <div class="cl-grid2">
    <div class="panel"><div class="ph"><b class="nm">2 · THE DESCRIPTION</b><span class="meta">what the reading found · From and how near, for each facet</span></div><div class="cl-facets" id="clFacets"></div></div>
    <div class="panel"><div class="ph"><b class="nm">THE WORDS THE MODEL READS</b><span class="grow"></span><button type="button" class="btn" id="clRewrite">↺ From the facets</button></div>
      <div class="cl-words" id="clWords"></div><span class="meta cl-wrap">Eleven fields for the PC's model, written from the facets; an edited one keeps your words. The Band reads the facets and the plan.</span></div>
  </div>
  <div class="panel"><div class="ph"><b class="nm">THE PLAN</b><span class="meta">click a part to turn it on or off there · ◆ a join: <b class="cl-f">F</b> a fill from the Band, learned from your bars before a change</span><span class="grow"></span>
      <span class="meta" id="clSeed"></span><button type="button" class="btn" id="clReroll">◌ Re-roll</button><button type="button" class="btn primary" id="clGenerate">Generate</button></div>
    <div class="cl-plan" id="clPlan"></div></div>
  <div class="panel"><div class="ph"><b class="nm">3 · MAKE IT SOUND</b><span class="meta">two engines, one description</span><span class="grow"></span><span class="meta" id="clLen"></span></div>
    <div class="cl-engines">
      <div class="cl-eng"><div class="ph"><b class="nm cl-band">MGL'S INSTRUMENTS</b><span class="meta">the Band · every note editable, in your tuning</span></div>
        <div class="row"><button type="button" class="btn primary" id="clPlay">▶ Play</button><button type="button" class="btn" id="clOpen">Open in Seq</button><span class="meta" id="clBandState">not yet made</span></div>
        <span class="meta cl-wrap">drum patterns A–D and the fill from your bars · bass lines A–D from your bass · the learned scale in your song's cents · the plan above</span></div>
      <div class="cl-eng cl-pc"><div class="ph"><b class="nm cl-pcn">THE PC'S MODEL</b><span class="meta">song from song · audio on the RTX 3060</span></div>
        <div class="row cl-waits"><span class="cap">Length</span><span class="seg"><button type="button" class="on">Snippet · 8 bars</button><button type="button">Full</button></span><span class="cap">Takes</span><span class="seg"><button type="button">1</button><button type="button" class="on">3</button><button type="button">5</button></span><button type="button" class="btn" disabled>Render</button></div>
        <span class="meta cl-wrap cl-pcstate" id="clPcState"></span>
        <button type="button" class="btn" id="clDesc" style="align-self:flex-start">Show the description it will read</button><pre class="cl-json" id="clJson"></pre></div>
    </div></div>
  <div class="panel"><div class="ph"><b class="nm">4 · CHECK</b><span class="meta">the Band's plan set against the description, facet by facet; the PC's takes join it when its model is connected</span></div>
    <div class="cl-check" id="clCheck"></div></div>`;
  page.appendChild(sec);

  // Clicks.
  document.getElementById("clMode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-m]"); if (!b) return;
    CL.mode = b.dataset.m;
    if (CL.mode !== "blend") CL.sel = CL.sel.slice(0, 1);
    clRegen("mode");
  });
  document.getElementById("clSongs").addEventListener("click", async (e) => {
    const c = e.target.closest(".cl-song[data-p]"); if (!c) return;
    const p = c.dataset.p;
    if (CL.mode === "blend") { CL.sel = CL.sel.includes(p) ? CL.sel.filter((x) => x !== p) : [...CL.sel, p].slice(-5); if (!CL.sel.length) CL.sel = [p]; }
    else CL.sel = [p];
    await Promise.all(CL.sel.map(clInfo));
    clRegen("songs");
  });
  document.getElementById("clFacets").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-src]"); if (!b || b.disabled) return;
    CL.facets[b.closest("[data-f]").dataset.f].from = b.dataset.src;
    clRegen("facet");
  });
  document.getElementById("clFacets").addEventListener("pointerdown", (e) => {
    const tr = e.target.closest(".cl-tr"); if (!tr) return;
    const fk = tr.dataset.f, box = tr.getBoundingClientRect();
    const go = (x) => {
      CL.facets[fk].v = Math.round(Math.max(0, Math.min(1, (x - box.left) / box.width)) * 100);
      tr.parentElement.style.setProperty("--v", CL.facets[fk].v / 100);
      tr.parentElement.querySelector("em").textContent = `${CL.facets[fk].v} · ${CL_TIERS[clTier(CL.facets[fk].v)]}`;
    };
    go(e.clientX);
    const move = (ev) => go(ev.clientX), up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); clRegen("facet"); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  document.getElementById("clWords").addEventListener("input", (e) => { const k = e.target.dataset.k; if (!k) return; CL.words[k] = e.target.value; CL.edited[k] = true; e.target.classList.add("edited"); clSave(); });
  document.getElementById("clRewrite").addEventListener("click", () => { clWords(true); clPaint(); clSave(); clToast("All eleven written again from the facets"); });
  document.getElementById("clPlan").addEventListener("click", (e) => {
    const u = e.target.closest(".cl-join[data-j]");
    if (u) { const s = CL.plan.secs[+u.dataset.j]; s.fill = s.fill ? 0 : 1; clPlanChanged(s.fill ? "A fill from the Band at this join" : "No fill at this join"); return; }
    const c = e.target.closest(".cl-cell[data-p]"); if (!c) return;
    const s = CL.plan.secs[+c.dataset.s], k = c.dataset.p;
    if (k === "drums" || k === "bass") s[k] = s[k] ? "" : "A"; else s[k] = s[k] ? 0 : 1;
    clPlanChanged(`${k} ${s[k] ? "on" : "off"} in section ${s.l}`);
  });
  document.getElementById("clGenerate").addEventListener("click", () => { initAudio(); cloneMake(); cloneApply(); clPaint(); clStep(3); clToast("Made from the description, seed " + CL.seed + ": the Band has it"); });
  document.getElementById("clReroll").addEventListener("click", () => { CL.seed = 1 + Math.floor(Math.random() * 99998); initAudio(); cloneMake(); cloneApply(); clPaint(); clToast("Re-rolled: seed " + CL.seed); });
  document.getElementById("clPlay").addEventListener("click", () => {
    initAudio();
    if (!CL.made) { cloneMake(); cloneApply(); clPaint(); }
    if (isPlaying) { stopSeq(); clBandState(); return; }
    togglePlay(); clBandState(); clStep(4);
  });
  document.getElementById("clOpen").addEventListener("click", () => {
    if (!CL.made) { cloneMake(); cloneApply(); }
    try { window.parent.postMessage({ type: "seq:goto", mode: "seq" }, location.origin); } catch (e) { /* on its own */ }
    clToast("The Band has the piece; Seq edits every part, pattern and section");
  });
  document.getElementById("clDesc").addEventListener("click", () => { const el = document.getElementById("clJson"); el.classList.toggle("on"); el.textContent = JSON.stringify(cloneDescription(), null, 1); });
  document.getElementById("clReg").addEventListener("pointerdown", (e) => {
    const reg = e.currentTarget, box = reg.parentElement.getBoundingClientRect(), x0 = e.clientX, s0 = CL.snip.start;
    const move = (ev) => { CL.snip.start = Math.max(0, Math.min(1 - CL.snip.len, s0 + (ev.clientX - x0) / box.width)); clSnipPaint(); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); clRegen("snip"); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  setInterval(clBandState, 500);
}

function clPlanChanged(msg) {
  const el = document.getElementById("bdPlanText");
  if (el && CL.made) { el.value = JSON.stringify(CL.plan); el.dispatchEvent(new Event("change", { bubbles: true })); }
  clWords(false); clSave(); clPaint(); clCheck(); clToast(msg);
}
/// After a change to songs, mode or facets: make it again, and the Band has it.
function clRegen(why) {
  if (!CL.sel.length) { clPaint(); return; }
  cloneMake();
  if (CL.applied) cloneApply();
  clPaint();
  clStep(why === "songs" || why === "mode" ? 1 : 2);
}
function clStep(n) { for (const b of document.querySelectorAll(".cl-steps b")) b.classList.toggle("on", +b.dataset.step <= n); }
function clBandState() {
  const el = document.getElementById("clBandState"), play = document.getElementById("clPlay");
  if (!el) return;
  el.textContent = !CL.made ? "Generate makes the piece, and the Band has it" : isPlaying ? `playing · ${clBarNow()}` : "ready · plays here, or open it in Seq";
  play.textContent = isPlaying ? "■ Stop" : "▶ Play";
}
function clBarNow() {
  if (!BAND.plan) return "";
  const bar = Math.floor((seqStepCount * stepBeats) / 4), x = bandSectionAt(bar);
  return x ? `section ${x.s.l}, bar ${x.bar + 1} of ${x.bars}` : "";
}

function clSnipPaint() {
  const reg = document.getElementById("clReg");
  if (!reg) return;
  reg.style.left = CL.snip.start * 100 + "%"; reg.style.width = CL.snip.len * 100 + "%";
  const a = CL.info[CL.sel[0]], n = a ? a.bar_count || (a.bars || []).length : 0;
  const b0 = Math.floor(CL.snip.start * n), b1 = Math.max(b0 + 1, Math.floor((CL.snip.start + CL.snip.len) * n));
  document.getElementById("clRegLabel").textContent = n ? `bars ${b0 + 1}–${b1} of ${clSongName(CL.sel[0])}` : "";
  // The song's loudness by bar, as its waveform.
  const c = document.getElementById("clSnipWave");
  if (!c || !a || !a.bars) return;
  const W = (c.width = c.offsetWidth || 600), H = (c.height = 56), g = c.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.fillStyle = typeof seqInk === "function" ? seqInk("pitch", 0.8) : "#a99be0";
  a.bars.forEach((b, i) => { const h = Math.max(1, ((b.mix_db + 40) / 40) * (H - 6)); g.fillRect((i / a.bars.length) * W, (H - h) / 2, Math.max(1, W / a.bars.length - 1), h); });
}

function clPaint() {
  const help = { clone: "Clone one: a new piece near to or far from one song. Pick one.", grow: "Grow a snippet: drag the stretch you like; the piece grows from it. Pick one.", blend: "Blend up to five: each facet takes its material from one of them, or from all. A new composition, not an average." };
  for (const b of document.querySelectorAll("#clMode button")) b.classList.toggle("on", b.dataset.m === CL.mode);
  document.getElementById("clHelp").textContent = help[CL.mode];
  // Songs.
  const sb = document.getElementById("clSongs");
  if (!CL.songs.length) sb.innerHTML = `<div class="cl-song add"><b>No songs read yet.</b> Split a song on the Stems page; when it is read, it appears here.</div>`;
  else sb.innerHTML = CL.songs.map((s) => {
    const a = CL.info[s.p], card = s.card || {};
    const bars = a ? a.bar_count || (a.bars || []).length : card.bars || 0;
    let strip = "";
    if (a && a.sections) ["drums", "bass", "vocals", "other"].forEach((st, r) => { for (const x of a.sections) if ((x.stems_on || []).includes(st)) strip += `<i style="top:${r * 6}px;left:${(x.start_bar / bars) * 100}%;width:${(x.bars / bars) * 100}%;background:var(--cl-${st})"></i>`; });
    const bpmT = a && a.tempo ? Math.round(+a.tempo.bpm) : card.bpm ? Math.round(card.bpm) : "";
    const key = a && a.key ? a.key.name : card.key || "";
    return `<div class="cl-song${CL.sel.includes(s.p) ? " sel" : ""}" data-p="${clEsc(s.p)}" title="${clEsc(clFullName(s.p))}"><div class="sn"><span class="chk">✓</span><b>${clEsc(clSongName(s.p))}</b></div>`
      + `<div class="nums"><span><em>${bpmT}</em> BPM</span><span>${clEsc(key)}</span><span>${bars ? bars + " bars" : ""}</span></div><div class="strip">${strip}</div></div>`;
  }).join("");
  document.getElementById("clSnip").classList.toggle("on", CL.mode === "grow");
  if (CL.mode === "grow") requestAnimationFrame(clSnipPaint);
  // Facets.
  const srcs = [...CL.sel.map((p) => [p, clShort(p)]), ["all", "All"], ["dub", "Dub techno"]];
  let f = `<span class="hd">FACET</span><span class="hd">FROM</span><span class="hd">NEAR ↔ FAR</span><span class="hd">WHAT IT READ</span>`;
  for (const F of CL_FACETS) {
    const st = CL.facets[F.k];
    if (st.from && st.from !== "all" && st.from !== "dub" && !CL.sel.includes(st.from)) st.from = "";
    if (st.from === "all" && CL.sel.length < 2) st.from = "";
    const cur = st.from || CL.sel[0] || "dub";
    f += `<span class="fn" style="--fc:var(--f-${F.c})"><i></i>${F.n}</span>`
      + `<span class="seg sm" data-f="${F.k}">${srcs.map(([k, n]) => `<button type="button" data-src="${clEsc(k)}" class="${k === cur ? "on" : ""}" ${k === "all" && CL.sel.length < 2 ? "disabled" : ""}>${clEsc(n)}</button>`).join("")}</span>`
      + `<span class="cl-nf" style="--fc:var(--f-${F.c});--v:${st.v / 100}"><span class="cl-tr" data-f="${F.k}"></span><em>${st.v} · ${CL_TIERS[clTier(st.v)]}</em></span>`
      + `<span class="rd">${clRead(F.k)}</span>`;
  }
  document.getElementById("clFacets").innerHTML = f;
  // Words.
  const wb = document.getElementById("clWords");
  if (!wb.children.length) wb.innerHTML = CL_WORDS.map((k) => `<label for="clw-${k}">${k}</label><input id="clw-${k}" data-k="${k}" spellcheck="false">`).join("");
  for (const k of CL_WORDS) { const el = document.getElementById("clw-" + k); if (document.activeElement !== el) el.value = CL.words[k] || ""; el.classList.toggle("edited", !!CL.edited[k]); }
  // The plan.
  clPlanPaint();
  document.getElementById("clSeed").textContent = "seed " + CL.seed;
  document.getElementById("clPcState").textContent = CL_PC;
  if (document.getElementById("clJson").classList.contains("on")) document.getElementById("clJson").textContent = JSON.stringify(cloneDescription(), null, 1);
  clBandState();
  clCheck();
}

/// What a facet read, in a line.
function clRead(fk) {
  const from = CL.facets[fk].from;
  if (from === "dub") return { tempo: "<b>122 BPM</b>, hats swung 52 %", key: "a minor key", drums: "kick on the beat, open hat off it, rim sparse", bass: "sub, root 4th 5th, sparse", chords: "<b>minor 7th</b> stabs off the beat", arr: "<b>16/32-bar</b> lines, parts in and out", tex: "dotted-1/8 delay, a plate" }[fk];
  const ss = clSources(fk);
  if (!ss.length) return `<span class="dim">pick a song</span>`;
  const a = ss[0], more = ss.length > 1 ? ` <span class="dim">+${ss.length - 1} more</span>` : "";
  switch (fk) {
    case "tempo": return `<b>${(+a.tempo.bpm).toFixed(1)} BPM</b>${a.tempo.map && a.tempo.map.length ? `, ${Math.round(Math.min(...a.tempo.map.map((m) => m[1])))}–${Math.round(Math.max(...a.tempo.map.map((m) => m[1])))}` : ""}; 16ths ${(+a.drums.swing_16th_pct).toFixed(0)} %${more}`;
    case "key": return `<b>${a.key.name}</b>, own scale <b>${(a.tuning.scale_cents_above_tonic || []).map((c) => Math.round(c)).join(" · ")}¢</b>${more}`;
    case "drums": return `<b>${a.drums.bar_families} bar families</b>; most-used: ${(a.drums.common_bars || []).slice(0, 1).map((b) => `<code>${b.kick}</code>`).join("")}${more}`;
    case "bass": return `<b>${a.bass.range}</b>, ${(a.bass.notes || []).length} notes${more}`;
    case "chords": return `rough: <b>${(a.chords.changes || []).slice(0, 3).map((c) => c[1]).join(" → ")}</b> …${more}`;
    case "arr": return `<b>${a.change.sections} sections, ~${a.change.section_bars_median} bars</b>; stems come and go <b>${a.change.entries_exits_per_minute}×/min</b>${more}`;
    case "tex": return `smear <b>${(+a.texture.smear_mean).toFixed(2)}</b>, width <b>${(+a.texture.width_mean).toFixed(2)}</b>, hiss ${Math.round(a.texture.hiss_floor_db)} dB${more}`;
  }
  return "";
}

const CL_LANES = [["drums", "DRUMS", "attack"], ["bass", "BASS", "tone"], ["chord", "CHORDS", "space"], ["drone", "DRONE", "level"], ["arp", "ARP", "time"], ["melody", "MELODY", "pitch"]];
function clPlanPaint() {
  const box = document.getElementById("clPlan");
  if (!CL.plan) { box.innerHTML = `<span class="meta">Generate makes a plan from the description.</span>`; return; }
  const secs = CL.plan.secs, T = secs.reduce((a, s) => a + s.b, 0);
  let h = `<span class="pl">SECTIONS</span><div class="secs">${secs.map((s) => `<b style="flex:${s.b}" class="${s.snip ? "snip" : ""}">${s.snip ? "snippet" : clEsc(s.l)}<small>${s.b}</small></b>`).join("")}</div>`;
  h += `<span class="pl">FILLS</span><div class="joins">${secs.map((s, i) => `<i style="flex:${s.b}">${i < secs.length - 1 ? `<u class="cl-join${s.fill ? " on" : ""}" data-j="${i}" title="The join after ${clEsc(s.l)}: click for a fill or none">${s.fill ? "F" : "◆"}</u>` : ""}</i>`).join("")}</div>`;
  for (const [k, n, c] of CL_LANES) h += `<span class="pl" style="color:var(--f-${c})">${n}</span><div class="lane" style="--fc:var(--f-${c})">${secs.map((s, i) => `<i class="cl-cell${s[k] ? " on" : ""}" data-p="${k}" data-s="${i}" style="flex:${s.b}">${(k === "drums" || k === "bass") && s[k] ? `<b>${s[k]}</b>` : ""}</i>`).join("")}</div>`;
  box.innerHTML = h;
  const sec = Math.round((T * 4 * 60) / ((CL.made && CL.made.bpm) || 120));
  document.getElementById("clLen").textContent = `${T} bars · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} at ${(CL.made && CL.made.bpm) || "?"} BPM`;
}

/// The host showed the page: read the songs again (one may have been split since).
async function cloneShown() {
  await clFetchSongs();
  if (!CL.plan && CL.sel.length) cloneMake();
  clPaint();
  clStep(CL.made ? 2 : 1);
}

// ─── START ───────────────────────────────────────────────────────────────────
clLearnedScalesBack();
clLoadSaved();
cloneBuildUI();
clPaint();
// Generate writes the Band; from then on, changes to the description do too.
document.getElementById("clGenerate").addEventListener("click", () => { CL.applied = true; });
document.getElementById("clReroll").addEventListener("click", () => { CL.applied = true; });
