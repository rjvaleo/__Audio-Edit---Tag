// Clone a song (ours, not the sequencer repository's; 14 Nov 2026, the plan
// `WORK DIR/page-mockups/CLONE-PLAN.md`, the mock-up `clone.html`). RJ: "It's the
// clone a song", and, with the PC's song-from-song tools doing the same: "figure
// out a way that they can live together … you both do the thing and then you
// can use it to check each other. And then it's how you do like fills."
//
// A page of its own on the host's rail, shown in the Seq frame like Draw and
// Atmosphere (`body.only-clone`, from `seq:only`), so it drives the Seq Band
// directly. The page is simple (THE PAGE, below): your songs, four buttons
// and a knob, four takes. Under it, the engine each take is made with:
//
//   - Songs: the ones split and read on the Stems page (`/api/stems/list`,
//     `/api/stems/info`, their `songprint.json`).
//   - The description: seven facets (tempo and feel, key and tuning, drums,
//     bass, chords, arrangement, texture and space), each taking its material
//     **From** a song, All of them, or the dub techno style, at a distance
//     **close ↔ far** (0 the song as it was … 100 far); the eleven words the
//     PC's model reads; and the section plan (sections, the parts in each, the
//     drum and bass patterns, a fill at the joins).
//   - The sound: **MGL's instruments** (the Band plays the plan: drum patterns
//     A–D and the fill from your bars, bass lines A–D from your bass, a learned
//     scale in your song's cents, the section plan). The PC's model is not
//     connected yet, and says so.
//   - The check: the Band's plan against the description, facet by facet.
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
  // The page: the song takes start from, the songs mixed in, the knob, the
  // takes (a family of generations), and what the buttons did.
  from: "", mixing: [], dial: 35, family: [], gen: -1, picked: 0, log: [], verb: null, leans: [], playingId: null, keeping: null,
};
for (const f of CL_FACETS) CL.facets[f.k] = { from: "", v: { tempo: 10, key: 0, drums: 30, bass: 30, chords: 70, arr: 30, tex: 20 }[f.k] };
CL.facets.chords.from = "dub";
// ─── THE SONGS ───────────────────────────────────────────────────────────────
async function clFetchSongs() {
  try {
    const r = await fetch("/api/stems/list");
    const list = r.ok ? await r.json() : [];
    CL.songs = (Array.isArray(list) ? list : list.songs || []).filter((s) => s.analysed);
  } catch (e) { CL.songs = []; }
  const has = (p) => CL.songs.some((s) => s.p === p);
  if (CL.from && !has(CL.from)) CL.from = "";
  CL.mixing = CL.mixing.filter(has);
  if (!CL.from && CL.songs.length) CL.from = CL.songs[0].p;
  // Each song shows itself listening until it is read.
  const paint = () => { if (typeof clPaintCrate === "function" && document.getElementById("clCrate")) { clPaintCrate(); clPaintVerbs(); if (!CL.family[CL.gen]) clPaintTakes(); } };
  paint();
  await Promise.all(CL.songs.map(async (s) => { await clInfo(s.p); paint(); }));
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
const clShort = (p) => {
  const raw = clSongName(p).replace(/_/g, " ").split(/\s+/).map((x) => x.replace(/^[^\p{L}\d']+|[^\p{L}\d']+$/gu, "")).filter(Boolean);
  const w = raw.filter((x) => !/^(in|the|of|a|an|on|to)$/i.test(x) && !/^\d+$/.test(x));
  // A name ending in a number ("mark 2"): its first word says more.
  return (/^\d+$/.test(raw[raw.length - 1] || "") ? w[0] : w[w.length - 1]) || clSongName(p);
};
/// A song's name, cut short for a chip.
const clChipName = (p) => { const n = clSongName(p).replace(/_/g, " ").replace(/^[-\s\d]+/, ""); return n.length > 22 ? n.slice(0, 21) + "…" : n; };
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
// The simple page (14 Nov 2026, the design panel; the mock-up
// `WORK DIR/page-mockups/clone-simple.html`). RJ: "I'm loading my songs in.
// You're figuring out what that makes them a song … make similar, mix with
// so-and-so, lean towards da-da-da. Like super simple."
//
// Three things on it: **your songs**, each read into a line; **four buttons and
// one knob** (Make similar, Mix with…, Lean toward…, Surprise me; Close ↔ Far);
// and **four takes**, each a recipe the engine above makes into a Band piece.
// A take plays at once on the Band; More like this makes it the new starting
// point (the family trail goes back); Keep renders it to `Made/Clones/`, where
// Edit, Grain and Chop open it. The facets, the words, the plan and the check
// are the blueprint, closed in the drawer Under the hood.
//
// A take is kept as its **recipe**, not its notes: the songs, the facets, the
// seed, the leans, and any More like this steps on top. The same recipe makes
// the same take (`clMakeRecipe`), so the page keeps only recipes.

const CL_LEANS = ["darker", "brighter", "busier drums", "sparser", "more space", "slower", "faster", "more dub"];
const CL_VERB_NAME = { similar: "Similar", mix: "Mixed", lean: "Leaning", surprise: "Surprise", more: "Like", less: "Less like" };
const clEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function clToast(t) {
  let el = document.getElementById("clToast");
  if (!el) { el = document.createElement("div"); el.id = "clToast"; el.className = "cl-toast"; document.body.append(el); }
  el.textContent = t; el.classList.add("on");
  clearTimeout(clToast.t); clToast.t = setTimeout(() => el.classList.remove("on"), 2200);
}
const clDeep = (o) => JSON.parse(JSON.stringify(o));
const clClamp = (v) => Math.round(Math.max(0, Math.min(100, v)));
function clLog(verb, what) { CL.log.unshift({ verb, what }); CL.log = CL.log.slice(0, 40); }

// ─── A SONG IN A LINE ────────────────────────────────────────────────────────
/// What the reading found, in plain words: "124 · C# minor, its own tuning ·
/// busy drums · deep held bass · dry".
function clPrint(a) {
  if (!a) return "";
  const bpm = a.tempo ? Math.round(+a.tempo.bpm) : "?";
  const tm = a.tempo && a.tempo.map ? a.tempo.map.map((m) => +m[1]).filter(Number.isFinite) : [];
  const drift = tm.length && Math.max(...tm) - Math.min(...tm) > 3 ? ", drifting" : "";
  const sc = clScale(a);
  const own = sc && sc.cents.some((c) => Math.abs(c - Math.round(c / 100) * 100) > 15) ? ", its own tuning" : "";
  const fam = ((a.drums && a.drums.common_bars) || [])[0];
  let dr = "no drums";
  if (fam) {
    const n = clHits(clRowsFromBar(fam)), four = /^X...X...X...X...$/.test(fam.kick.replace(/x/g, "X"));
    dr = four ? "four on the floor" : n >= 18 ? "busy drums" : n >= 9 ? "steady drums" : "sparse drums";
  }
  const notes = (a.bass && a.bass.notes) || [];
  let bs = "no bass";
  if (notes.length) {
    const pcs = new Set(notes.map((x) => ((Math.round(x[3]) % 12) + 12) % 12)).size, len = notes.reduce((s, x) => s + (+x[2] || 0), 0) / notes.length;
    bs = pcs <= 1 ? "one-note bass" : len >= 6 ? "deep held bass" : len <= 2 ? "busy bass" : "moving bass";
  }
  const t = a.texture || {};
  const sp = (+t.width_mean || 0) > 0.4 ? "wide" : (+t.smear_mean || 0) > 0.35 ? "wet" : "dry";
  return `<b>${bpm}</b>${drift} · <b>${clEsc(a.key ? a.key.name : "")}</b>${own} · ${dr} · ${bs} · ${sp}`;
}

// ─── A TAKE: ITS RECIPE, MADE ────────────────────────────────────────────────
/// Put a recipe's songs, facets and seed into the state the engine reads.
function clSetRecipe(rc) {
  CL.mode = rc.snap.mode; CL.sel = rc.snap.sel.slice(); CL.seed = rc.snap.seed; CL.facets = clDeep(rc.snap.facets);
}
/// Make a recipe: the engine, then the leans, then each More like this step.
function clMakeRecipe(rc) {
  clSetRecipe(rc);
  CL.edited = {};
  cloneMake();
  clLean(rc.leans || [], jRng(rc.snap.seed * 7 + 3));
  for (const v of rc.varies || []) clVary(v.amt, jRng(v.seed));
  clWords(true);
  if (rc.text) CL.words.mood = rc.text;
  return { made: CL.made, plan: CL.plan, words: { ...CL.words } };
}
const clGridSteps = (g, fn) => { for (const slot of Object.keys(g)) g[slot].steps.slice(0, 16).forEach((st, i) => fn(slot, st, i)); };
/// Leans that change what was made (the ones that change where it comes from
/// are set in the recipe's facets: the bass of, the drums of, more dub).
function clLean(leans, rnd) {
  const M = CL.made;
  for (const l of leans) {
    if (l === "darker") M.cut = Math.max(5, M.cut - 25);
    else if (l === "brighter") M.cut = Math.min(95, M.cut + 30);
    else if (l === "more space") M.space = Math.min(90, M.space + 30);
    else if (l === "slower") M.bpm = Math.max(60, Math.round((M.bpm - 8) * 10) / 10);
    else if (l === "faster") M.bpm = Math.min(180, Math.round((M.bpm + 8) * 10) / 10);
    else if (l === "more dub") { M.chordPat = "seventh-stab"; M.delayT = "0.75"; M.space = Math.min(90, M.space + 15); }
    else if (l === "busier drums") {
      for (const k of "ABCD") clGridSteps(M.pats[k], (slot, st, i) => {
        if (slot === "chh" && !st.v && rnd() < (i % 2 ? 0.35 : 0.7)) st.v = 50 + Math.floor(rnd() * 30);
        if (slot === "kick" && !st.v && i % 4 === 3 && rnd() < 0.2) st.v = 70;
      });
    } else if (l === "sparser") {
      for (const k of "ABCD") clGridSteps(M.pats[k], (slot, st, i) => { if (st.v && !(slot === "kick" && i % 4 === 0) && rnd() < 0.45) st.v = 0; });
      for (const s of CL.plan.secs) s.arp = 0;
    }
  }
}
/// More like this: the same piece, a little changed. Hits move a step or two,
/// a bass line swaps or changes a note, a part comes or goes in a section.
function clVary(amt, rnd) {
  const M = CL.made;
  for (const k of "ABCD") {
    const g = M.pats[k];
    for (const slot of Object.keys(g)) {
      const st = g[slot].steps;
      for (let i = 0; i < 16; i++) {
        if (!st[i].v || rnd() > amt * 0.5) continue;
        const j = (i + [1, -1, 2, -2][Math.floor(rnd() * 4)] + 16) % 16;
        if (!st[j].v) { st[j].v = st[i].v; st[i].v = 0; }
      }
    }
  }
  const L = M.lines;
  if (rnd() < amt) { const a = "ABCD"[Math.floor(rnd() * 4)], b = "ABCD"[Math.floor(rnd() * 4)]; [L[a], L[b]] = [L[b], L[a]]; }
  for (const k of "ABCD") if (rnd() < amt) L[k] = L[k].replace(/[R3457 8]/g, (c) => (rnd() < 0.3 ? "R458"[Math.floor(rnd() * 4)] : c));
  for (const s of CL.plan.secs) {
    for (const p of ["chord", "arp", "drone"]) if (rnd() < amt * 0.15) s[p] = s[p] ? 0 : 1;
    if (s.drums && rnd() < amt * 0.3) s.drums = "ABCD"[Math.floor(rnd() * 4)];
  }
}
/// How far a take is from its songs: the facets' distances, the leans, the
/// More like this steps.
function clDistance(rc) {
  const vs = Object.values(rc.snap.facets).map((f) => f.v);
  return clClamp(vs.reduce((a, b) => a + b, 0) / vs.length + (rc.leans || []).length * 6 + (rc.varies || []).reduce((a, v) => a + v.amt * 25, 0));
}
const clBadge = (d) => (d < 25 ? "close" : d < 50 ? "near" : d < 75 ? "loose" : "far");
function clEnsure(t) { if (!t.made) Object.assign(t, clMakeRecipe(t.recipe)); return t; }

// ─── THE BUTTONS: A RECIPE FOR EACH OF FOUR TAKES ───────────────────────────
const clFacetsAt = (r, v, from) => { const f = {}; for (const F of CL_FACETS) f[F.k] = { from: from || "", v: clClamp(v + (r() - 0.5) * 30) }; return f; };
const clNewSeed = () => 1 + Math.floor(Math.random() * 99998);
const clPicked = () => { const g = CL.family[CL.gen]; return g && g.takes[CL.picked] ? g.takes[CL.picked] : null; };
/// The recipe a lean starts from: the take you picked, or your song as it is.
function clBase() {
  const t = clPicked();
  if (t && t.recipe.snap.sel[0] === CL.from) return clDeep(t.recipe);
  const r = jRng(CL.seed);
  return { snap: { mode: "clone", sel: [CL.from], seed: CL.seed, facets: clFacetsAt(r, CL.dial) }, leans: [], varies: [] };
}
function clRecipe(verb, i, r, ctx) {
  const seed = clNewSeed();
  if (verb === "similar") return { snap: { mode: "clone", sel: [CL.from], seed, facets: clFacetsAt(r, CL.dial) }, leans: [], varies: [] };
  if (verb === "mix") {
    const sel = [CL.from, ...CL.mixing].slice(0, 5), others = sel.slice(1);
    const f = clFacetsAt(r, CL.dial, CL.from);
    // Each take draws the drums and the bass from the songs mixed in, and the
    // rest from any of them; the first two keep your song's arrangement.
    f.drums.from = others[(i + Math.floor(r() * others.length)) % others.length];
    f.bass.from = others[(i + 1 + Math.floor(r() * others.length)) % others.length];
    for (const k of ["chords", "tex"]) f[k].from = sel[Math.floor(r() * sel.length)];
    f.tempo.from = i % 2 ? "all" : CL.from;
    f.arr.from = i < 2 ? CL.from : sel[Math.floor(r() * sel.length)];
    return { snap: { mode: "blend", sel, seed, facets: f }, leans: [], varies: [] };
  }
  if (verb === "lean") {
    const rc = clDeep(ctx.base);
    rc.snap.seed = seed; rc.varies = [];
    for (const k of Object.keys(rc.snap.facets)) rc.snap.facets[k].v = clClamp(rc.snap.facets[k].v + (r() - 0.5) * 16);
    for (const l of ctx.leans) {
      const m = /^the (bass|drums) of (.+)$/.exec(l);
      if (m) {
        const p = CL.songs.find((s) => s.p === m[2]);
        if (p) { if (!rc.snap.sel.includes(p.p)) rc.snap.sel = [...rc.snap.sel, p.p].slice(0, 5); rc.snap.mode = "blend"; rc.snap.facets[m[1]] = { from: p.p, v: 0 }; }
      } else if (l === "more dub") {
        rc.snap.facets.chords = { from: "dub", v: Math.max(70, rc.snap.facets.chords.v) };
        rc.snap.facets.tex = { from: "dub", v: rc.snap.facets.tex.v };
      }
    }
    rc.leans = [...new Set([...(rc.leans || []), ...ctx.leans.filter((l) => CL_LEANS.includes(l))])];
    if (ctx.text) rc.text = ctx.text;
    return rc;
  }
  if (verb === "surprise") {
    const pool = CL.songs.filter((s) => CL.info[s.p] && s.p !== CL.from).map((s) => s.p);
    const sel = [CL.from];
    while (pool.length && sel.length < 3 && r() < 0.7) sel.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    const f = clFacetsAt(r, Math.max(CL.dial, 70));
    for (const k of Object.keys(f)) { const x = r(); f[k].from = x < 0.2 ? "dub" : sel[Math.floor(r() * sel.length)]; }
    const leans = r() < 0.6 ? [CL_LEANS[Math.floor(r() * CL_LEANS.length)]] : [];
    return { snap: { mode: sel.length > 1 ? "blend" : "clone", sel, seed, facets: f }, leans, varies: [] };
  }
  if (verb === "more") { const rc = clDeep(ctx.base); rc.varies = [...(rc.varies || []), { seed, amt: Math.round((0.12 + CL.dial / 250) * 100) / 100 }]; return rc; }
  return null;
}
/// What a button did, in the engine's words (the drawer's log).
function clSaid(verb, ctx) {
  const n = (p) => (p === "dub" ? "dub techno" : p === "all" ? "all of them" : clShort(p));
  if (verb === "similar") return `every facet from ${n(CL.from)}, ${CL.dial} (each take ±15)`;
  if (verb === "mix") return `drums and bass from ${CL.mixing.map(n).join(" + ")}; the rest drawn from all ${CL.mixing.length + 1}; ${CL.dial}`;
  if (verb === "surprise") return `facets drawn from your songs and dub techno, ${Math.max(CL.dial, 70)}`;
  if (verb === "more") return `${ctx.name} is the new starting point; each take moves its hits, bass and parts a little`;
  if (verb === "lean") {
    const m = { darker: "chords: filter −25", brighter: "chords: filter +30", "busier drums": "drums: more hats, ghost kicks", sparser: "drums: hits thinned; arp out", "more space": "chords: space +30", slower: "tempo −8 BPM", faster: "tempo +8 BPM", "more dub": "chords and texture: dub techno; stabs, dotted-1/8 delay" };
    const parts = ctx.leans.map((l) => { const x = /^the (bass|drums) of (.+)$/.exec(l); return x ? `the ${x[1]} of ${clSongName(x[2])} → ${x[1]} from it, 0` : `${l} → ${m[l] || l}`; });
    if (ctx.text) parts.push(`“${ctx.text}” → the words the PC's model reads (the Band doesn't read words)`);
    return parts.join("; ");
  }
  return "";
}
/// Four takes from a button. They are made at once; the Band plays the one you
/// press ▶ on.
function clMake(verb, ctx = {}) {
  if (!CL.from || !CL.info[CL.from]) { clToast("Pick a song first"); return; }
  const r = jRng(clNewSeed());
  const takes = [0, 1, 2, 3].map((i) => {
    const recipe = clRecipe(verb, i, r, ctx);
    return clEnsure({ id: "t" + clNewSeed(), name: `${verb === "more" ? "More" : CL_VERB_NAME[verb]} ${"ABCD"[i]}`, recipe, kept: null });
  });
  clLog(verb === "more" ? `More like ${ctx.name}` : CL_VERB_NAME[verb], clSaid(verb, ctx));
  // A new family member: after the one shown, dropping any you had gone back past.
  CL.family = CL.family.slice(0, CL.gen + 1);
  if (verb !== "more" && verb !== "lean") CL.family = [];
  CL.family.push({ label: verb === "more" ? ctx.name : verb === "similar" && !CL.family.length ? clShort(CL.from) : CL_VERB_NAME[verb], takes });
  CL.family = CL.family.slice(-8);
  CL.gen = CL.family.length - 1;
  CL.picked = 0;
  CL.verb = null; CL.leans = [];
  clSetFrom(takes[0]);
  // Playing: the first new take carries on playing.
  if (isPlaying) clUseTake(takes[0]);
  clSave(); clPaintAll(true);
  clToast(`Four takes · ${clSaid(verb, ctx).split(";")[0]}`);
}
/// Less like this: that take, replaced by one further from it.
function clLess(i) {
  const g = CL.family[CL.gen], t = g.takes[i];
  const rc = clDeep(t.recipe);
  rc.snap.seed = clNewSeed(); rc.varies = [];
  for (const k of Object.keys(rc.snap.facets)) rc.snap.facets[k].v = clClamp(rc.snap.facets[k].v + 25);
  g.takes[i] = clEnsure({ id: "t" + clNewSeed(), name: t.name.replace(/′*$/, "") + "′", recipe: rc, kept: null });
  clLog(`Less like ${t.name}`, "a new seed, every facet 25 further");
  if (CL.picked === i) clSetFrom(g.takes[i]);
  clSave(); clPaintTakes(); clPaintHood();
  clToast(`${t.name}: replaced by one less like it`);
}

// ─── A TAKE, ON THE BAND ─────────────────────────────────────────────────────
/// The take the drawer shows: its recipe and what it made, as the state.
function clSetFrom(t) {
  clEnsure(t);
  clSetRecipe(t.recipe);
  CL.made = t.made; CL.plan = t.plan; CL.words = { ...t.words }; CL.edited = {};
}
/// The take, written into the Band's controls.
function clUseTake(t) { initAudio(); clSetFrom(t); cloneApply(); CL.playingId = t.id; }
function clPlay(i) {
  const t = CL.family[CL.gen].takes[i];
  if (isPlaying && CL.playingId === t.id) { stopSeq(); clPaintTakes(); return; }
  CL.picked = i;
  clUseTake(t);
  if (!isPlaying) togglePlay();
  clSave(); clPaintTakes(); clPaintHood();
}
/// Keep: the take rendered here (the Band, offline, the whole plan) and written
/// to `Made/Clones/<song> - <take>.wav`.
async function clKeep(i) {
  const t = CL.family[CL.gen].takes[i];
  if (t.kept) { clToast(`${t.name} is kept: ${t.kept}`); return; }
  if (CL.keeping) return;
  // The render runs through the frame's bridge, which is there only in the app.
  if (!window.seqBridge) { clToast("Keep works in the app: open the Clone page there"); return; }
  CL.keeping = t.id; clPaintTakes();
  try {
    if (isPlaying) stopSeq();
    clUseTake(t);
    const bars = t.plan.secs.reduce((a, s) => a + s.b, 0);
    const seconds = (bars * 4 * 60) / t.made.bpm + 3;
    const r = await window.seqBridge.renderFilm({ seconds, rate: 48000, fps: 2, bands: 8, liss: 16, at0: 0 });
    const n = r.left.length, inter = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) { inter[k * 2] = r.left[k]; inter[k * 2 + 1] = (r.right || r.left)[k]; }
    const name = `${clSongName(t.recipe.snap.sel[0])} - ${t.name}`;
    const res = await fetch(`/api/clone/keep?rate=48000&name=${encodeURIComponent(name)}`, { method: "POST", body: inter.buffer });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    t.kept = (await res.json()).p;
    t.peaks = clPeaks(r.left, r.right || r.left, 160);
    clLog(`Kept ${t.name}`, t.kept);
    clToast(`${t.name} kept in ${t.kept}: open it in Edit, Grain or Chop`);
  } catch (e) {
    clToast(`Could not keep ${t.name}: ${e.message || e}`);
  } finally {
    CL.keeping = null; clSave(); clPaintTakes(); clPaintHood();
  }
}
function clPeaks(L, R, n) {
  const out = [], w = Math.max(1, Math.floor(L.length / n));
  for (let i = 0; i < n; i++) { let m = 0; for (let k = i * w; k < Math.min(L.length, (i + 1) * w); k += 16) m = Math.max(m, Math.abs(L[k]), Math.abs(R[k])); out.push(Math.round(m * 100) / 100); }
  return out;
}
const clOpenIn = (p, page) => { try { window.parent.postMessage({ type: "seq:open", p, page }, location.origin); } catch (e) { /* on its own */ } };

// ─── SAVING (recipes only; a take is made again from its recipe) ────────────
function clSave() {
  const fam = CL.family.map((g) => ({ label: g.label, takes: g.takes.map((t) => ({ id: t.id, name: t.name, recipe: t.recipe, kept: t.kept, peaks: t.peaks })) }));
  try { localStorage.setItem("mglClone", JSON.stringify({ v: 2, from: CL.from, mixing: CL.mixing, dial: CL.dial, family: fam, gen: CL.gen, picked: CL.picked, log: CL.log, seed: CL.seed })); } catch (e) { /* private window */ }
}
function clLoadSaved() {
  try {
    const d = JSON.parse(localStorage.getItem("mglClone") || "null");
    if (!d || d.v !== 2) return;
    for (const k of ["from", "mixing", "dial", "family", "gen", "picked", "log", "seed"]) if (d[k] != null) CL[k] = d[k];
  } catch (e) { /* none */ }
}

// ─── THE PAGE, BUILT ─────────────────────────────────────────────────────────
function cloneBuildUI() {
  if (document.querySelector(".clone-page")) return;
  const page = document.querySelector(".page");
  const sec = document.createElement("section");
  sec.className = "clone-page";
  sec.innerHTML = `
  <div class="cl-head"><span class="cl-title">CLONE <span>/ YOUR SONGS, AGAIN</span></span><span class="cl-sub">Pick a song. Press a button. Four takes come back.</span></div>
  <div class="cl-crate" id="clCrate"></div>
  <div class="cl-verbs" id="clVerbs">
    <button type="button" class="cl-verb" data-v="similar"><svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/></svg>Make similar</button>
    <button type="button" class="cl-verb" data-v="mix"><svg viewBox="0 0 24 24"><path d="M4 7h4l8 10h4M4 17h4l8-10h4"/></svg>Mix with…</button>
    <button type="button" class="cl-verb" data-v="lean"><svg viewBox="0 0 24 24"><path d="M5 19 19 5M11 5h8v8"/></svg>Lean toward…</button>
    <button type="button" class="cl-verb" data-v="surprise"><svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>Surprise me</button>
    <div class="cl-dial"><span class="lb">Close</span><div class="cl-knob" id="clKnob" tabindex="0" role="slider" aria-label="Close to far" aria-valuemin="0" aria-valuemax="100" title="Close keeps it like your song; far lets it go"></div><span class="lb">Far</span><span class="rd" id="clDialRd"></span></div>
  </div>
  <div class="cl-hint" id="clHint"></div>
  <div class="cl-chips" id="clChips"></div>
  <div class="cl-trail" id="clTrail"></div>
  <div class="cl-takes" id="clTakes"></div>
  <details class="cl-hood" id="clHood"><summary>UNDER THE HOOD <span>the blueprint of the take you picked, and what every button did</span></summary>
    <div class="cl-hood-in">
      <div class="cl-hood-bar"><b id="clHoodName"></b><span class="meta" id="clLen"></span><span class="grow"></span><button type="button" class="btn" id="clOpen">Open in Seq</button><button type="button" class="btn" id="clDesc">The description</button></div>
      <pre class="cl-json" id="clJson"></pre>
      <div class="cl-sub2">THE FACETS <span>From and how far, for each; a change remakes this take</span></div>
      <div class="cl-facets" id="clFacets"></div>
      <div class="cl-sub2">THE PLAN <span>click a part to turn it on or off there · ◆ a join, F a fill · plays now, not kept with the take</span></div>
      <div class="cl-plan" id="clPlan"></div>
      <div class="cl-grid2">
        <div><div class="cl-sub2">THE WORDS THE PC'S MODEL READS</div><div class="cl-words" id="clWords"></div></div>
        <div><div class="cl-sub2">WHAT THE BUTTONS DID</div><div class="cl-log" id="clLog"></div></div>
      </div>
      <div class="cl-sub2">THE CHECK <span>the Band's take against the description; the PC's takes join it when its model is connected</span></div>
      <div class="cl-check" id="clCheck"></div>
    </div></details>`;
  page.appendChild(sec);

  document.getElementById("clCrate").addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) { try { window.parent.postMessage({ type: "seq:goto", mode: "stems" }, location.origin); } catch (er) { /* on its own */ } return; }
    const c = e.target.closest(".cl-song[data-p]"); if (!c) return;
    const p = c.dataset.p;
    if (!CL.info[p]) return;
    if (CL.verb === "mix" && p !== CL.from) {
      CL.mixing = CL.mixing.includes(p) ? CL.mixing.filter((x) => x !== p) : [...CL.mixing, p].slice(0, 4);
      clSave(); clPaintCrate(); clPaintVerbs();
      return;
    }
    CL.from = p; CL.mixing = CL.mixing.filter((x) => x !== p);
    clSave(); clPaintCrate(); clPaintVerbs();
    clToast(`From ${clSongName(p)}`);
  });
  document.getElementById("clVerbs").addEventListener("click", (e) => {
    const b = e.target.closest(".cl-verb"); if (!b) return;
    const v = b.dataset.v;
    if (!CL.from) { clToast("Pick a song first"); return; }
    if (v === "mix") {
      if (CL.verb === "mix" && CL.mixing.length) { clMake("mix"); return; }
      CL.verb = CL.verb === "mix" ? null : "mix";
      clPaintVerbs(); clPaintCrate();
      return;
    }
    if (v === "lean") { CL.verb = CL.verb === "lean" ? null : "lean"; clPaintVerbs(); return; }
    clMake(v);
  });
  document.getElementById("clChips").addEventListener("click", (e) => {
    const c = e.target.closest(".cl-chip[data-l]");
    if (c) { const l = c.dataset.l; CL.leans = CL.leans.includes(l) ? CL.leans.filter((x) => x !== l) : [...CL.leans, l]; clPaintVerbs(); return; }
    if (e.target.id === "clLeanGo") {
      const text = document.getElementById("clLeanText").value.trim();
      if (!CL.leans.length && !text) { clToast("Pick a lean, or say it"); return; }
      clMake("lean", { base: clBase(), leans: CL.leans.slice(), text });
    }
  });
  document.getElementById("clChips").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "clLeanText") document.getElementById("clLeanGo").click(); });
  document.getElementById("clTakes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const i = +b.closest(".cl-take").dataset.i, a = b.dataset.a, t = CL.family[CL.gen].takes[i];
    if (a === "play") clPlay(i);
    else if (a === "more") clMake("more", { base: t.recipe, name: t.name });
    else if (a === "less") clLess(i);
    else if (a === "keep") clKeep(i);
    else if (a === "open" && t.kept) clOpenIn(t.kept, b.dataset.page);
    else if (a === "pick") { CL.picked = i; clSetFrom(t); clSave(); clPaintTakes(); clPaintHood(); }
  });
  document.getElementById("clTrail").addEventListener("click", (e) => {
    const b = e.target.closest("b[data-g]"); if (!b) return;
    CL.gen = +b.dataset.g; CL.picked = 0;
    clSetFrom(CL.family[CL.gen].takes[0]);
    clSave(); clPaintAll();
    clToast("Back to " + CL.family[CL.gen].label);
  });
  const knob = document.getElementById("clKnob");
  knob.addEventListener("pointerdown", (e) => {
    const y0 = e.clientY, d0 = CL.dial;
    knob.setPointerCapture(e.pointerId);
    const move = (ev) => { CL.dial = clClamp(d0 + (y0 - ev.clientY) * 0.6); clPaintDial(); };
    const up = () => { knob.removeEventListener("pointermove", move); knob.removeEventListener("pointerup", up); clSave(); };
    knob.addEventListener("pointermove", move); knob.addEventListener("pointerup", up);
  });
  knob.addEventListener("wheel", (e) => { e.preventDefault(); CL.dial = clClamp(CL.dial - Math.sign(e.deltaY) * 4); clPaintDial(); clSave(); }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key];
    if (d) { e.preventDefault(); CL.dial = clClamp(CL.dial + d); clPaintDial(); clSave(); }
  });

  // The drawer: the blueprint, editable.
  document.getElementById("clFacets").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-src]"); if (!b || b.disabled) return;
    CL.facets[b.closest("[data-f]").dataset.f].from = b.dataset.src;
    clRemakePicked("facet");
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
    const move = (ev) => go(ev.clientX), up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); clRemakePicked("facet"); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  document.getElementById("clWords").addEventListener("input", (e) => { const k = e.target.dataset.k; if (!k) return; CL.words[k] = e.target.value; CL.edited[k] = true; e.target.classList.add("edited"); });
  document.getElementById("clPlan").addEventListener("click", (e) => {
    if (!CL.plan) return;
    const u = e.target.closest(".cl-join[data-j]");
    if (u) { const s = CL.plan.secs[+u.dataset.j]; s.fill = s.fill ? 0 : 1; clPlanChanged(s.fill ? "A fill from the Band at this join" : "No fill at this join"); return; }
    const c = e.target.closest(".cl-cell[data-p]"); if (!c) return;
    const s = CL.plan.secs[+c.dataset.s], k = c.dataset.p;
    if (k === "drums" || k === "bass") s[k] = s[k] ? "" : "A"; else s[k] = s[k] ? 0 : 1;
    clPlanChanged(`${k} ${s[k] ? "on" : "off"} in section ${s.l}`);
  });
  document.getElementById("clOpen").addEventListener("click", () => {
    const t = clPicked(); if (!t) { clToast("Make some takes first"); return; }
    clUseTake(t);
    try { window.parent.postMessage({ type: "seq:goto", mode: "seq" }, location.origin); } catch (e) { /* on its own */ }
    clToast("The Band has the take; Seq edits every part, pattern and section");
  });
  document.getElementById("clDesc").addEventListener("click", () => { const el = document.getElementById("clJson"); el.classList.toggle("on"); el.textContent = JSON.stringify(cloneDescription(), null, 1); });
  setInterval(() => { if (document.body.classList.contains("only-clone")) clPaintPlaying(); }, 400);
}

/// A facet changed in the drawer: the picked take's recipe changes, and it is
/// made again; the Band has it.
function clRemakePicked(why) {
  const t = clPicked(); if (!t) { clPaintHood(); return; }
  t.recipe.snap.facets = clDeep(CL.facets); t.recipe.snap.sel = CL.sel.slice();
  t.made = null; clEnsure(t); clSetFrom(t);
  if (CL.playingId === t.id) cloneApply();
  clLog(`Changed ${t.name}`, why === "facet" ? "a facet, under the hood" : why);
  clSave(); clPaintTakes(); clPaintHood();
}
function clPlanChanged(msg) {
  const el = document.getElementById("bdPlanText");
  if (el && CL.playingId) { el.value = JSON.stringify(CL.plan); el.dispatchEvent(new Event("change", { bubbles: true })); }
  clPaintHood(); clToast(msg);
}

// ─── PAINTING ────────────────────────────────────────────────────────────────
function clPaintAll(fresh) { clPaintCrate(); clPaintVerbs(); clPaintDial(); clPaintTrail(); clPaintTakes(fresh); clPaintHood(); }
function clPaintCrate() {
  const box = document.getElementById("clCrate");
  const cards = CL.songs.map((s) => {
    const a = CL.info[s.p], from = s.p === CL.from, mixed = CL.mixing.includes(s.p);
    const tag = from ? `<span class="tag">FROM</span>` : mixed ? `<span class="tag mix">+ MIX</span>` : "";
    const body = a ? `<span class="fp">${clPrint(a)}</span>${clStrip(a)}` : `<span class="cl-listen"><i></i><i></i><i></i><i></i>listening…</span>`;
    return `<div class="cl-song${from ? " from" : ""}${mixed ? " mixed" : ""}${a ? "" : " reading"}" data-p="${clEsc(s.p)}" title="${clEsc(clFullName(s.p))}">${tag}<b class="cl-nm">${clEsc(clSongName(s.p))}</b>${body}</div>`;
  }).join("");
  box.innerHTML = cards + `<div class="cl-song add"><b>+ Add songs</b><span>A song you split on the Stems page is read here, and appears.</span><button type="button" class="btn" data-go="stems">Split a song on Stems</button></div>`;
}
/// Which stems play where in a song, as a thin strip.
function clStrip(a) {
  const bars = a.bar_count || (a.bars || []).length;
  if (!a.sections || !bars) return "";
  let h = "";
  ["drums", "bass", "vocals", "other"].forEach((st, r) => { for (const x of a.sections) if ((x.stems_on || []).includes(st)) h += `<i style="top:${r * 5}px;left:${(x.start_bar / bars) * 100}%;width:${(x.bars / bars) * 100}%;background:var(--cl-${st})"></i>`; });
  return `<span class="strip">${h}</span>`;
}
function clPaintVerbs() {
  for (const b of document.querySelectorAll(".cl-verb")) { b.classList.toggle("on", b.dataset.v === CL.verb); b.classList.toggle("dis", !CL.from); }
  const hint = document.getElementById("clHint");
  hint.classList.toggle("on", CL.verb === "mix");
  hint.textContent = CL.mixing.length ? `Mixing in ${CL.mixing.map(clShort).join(", ")}. Press Mix with… again for four takes.` : "Click the songs to mix in (up to four), then press Mix with… again.";
  const chips = document.getElementById("clChips");
  chips.classList.toggle("on", CL.verb === "lean");
  if (CL.verb !== "lean") return;
  const others = CL.songs.filter((s) => s.p !== CL.from && CL.info[s.p]);
  const keep = document.getElementById("clLeanText") ? document.getElementById("clLeanText").value : "";
  const chip = (l, text) => `<span class="cl-chip${CL.leans.includes(l) ? " on" : ""}" data-l="${clEsc(l)}" title="${clEsc(l.replace(/ of Stems\/.*$/, (x) => " of " + clSongName(x.slice(4))))}">${clEsc(text)}</span>`;
  // The song chips: "the bass of" and "the drums of" each song, by its name.
  const ofSong = (part) => (others.length ? `<span class="cl-chrow"><span class="cl-chlab">the ${part} of</span>${others.map((s) => chip(`the ${part} of ${s.p}`, clChipName(s.p))).join("")}</span>` : "");
  chips.innerHTML = CL_LEANS.map((l) => chip(l, l)).join("") + ofSong("bass") + ofSong("drums")
    + `<input id="clLeanText" placeholder="or say it: “like a rainy night in Berlin”" value="${clEsc(keep)}"><button type="button" class="btn primary" id="clLeanGo">Lean</button>`;
}
function clPaintDial() {
  const v = CL.dial / 100, a0 = -135, a1 = a0 + 270 * v, R = 26, cx = 32, cy = 32;
  const P = (a) => [cx + R * Math.sin((a * Math.PI) / 180), cy - R * Math.cos((a * Math.PI) / 180)];
  const arc = (f, t) => { const [x0, y0] = P(f), [x1, y1] = P(t); return `M${x0} ${y0}A${R} ${R} 0 ${t - f > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  const px = cx + 16 * Math.sin((a1 * Math.PI) / 180), py = cy - 16 * Math.cos((a1 * Math.PI) / 180);
  const k = document.getElementById("clKnob");
  k.innerHTML = `<svg viewBox="0 0 64 64"><path d="${arc(a0, 135)}" stroke="var(--look-track)" stroke-width="5" fill="none" stroke-linecap="round"/>${v > 0.004 ? `<path d="${arc(a0, a1)}" stroke="var(--on)" stroke-width="5" fill="none" stroke-linecap="round"/>` : ""}<circle cx="32" cy="32" r="18" fill="#33373e" stroke="rgba(0,0,0,.6)"/><path d="M32 32L${px} ${py}" stroke="var(--look-text)" stroke-width="3" stroke-linecap="round"/></svg>`;
  k.setAttribute("aria-valuenow", CL.dial);
  document.getElementById("clDialRd").textContent = `${CL.dial < 20 ? "very close" : CL.dial < 45 ? "close" : CL.dial < 70 ? "loose" : "far"} · ${CL.dial}`;
}
function clPaintTrail() {
  const el = document.getElementById("clTrail");
  el.innerHTML = CL.family.length ? `<span>FAMILY</span>` + CL.family.map((g, i) => `<b class="${i === CL.gen ? "cur" : ""}" data-g="${i}">${clEsc(g.label)}</b>`).join("<s>→</s>") : "";
}
const clTime = (t) => { const bars = t.plan.secs.reduce((a, s) => a + s.b, 0), sec = Math.round((bars * 240) / t.made.bpm); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
function clPaintTakes(fresh) {
  const box = document.getElementById("clTakes"), g = CL.family[CL.gen];
  if (!g) { box.innerHTML = `<div class="cl-empty">${!CL.songs.length ? "No songs read yet. Split one on the Stems page and it appears here." : CL.info[CL.from] ? "Press a button. Four takes come back." : "Reading your songs…"}</div>`; return; }
  box.innerHTML = g.takes.map((t, i) => {
    clEnsure(t);
    const d = clDistance(t.recipe), w = clBadge(d), keeping = CL.keeping === t.id;
    const key = t.made.scale ? t.made.scale.name.replace(/ \(learned\)$/, "") : "";
    return `<div class="cl-take${i === CL.picked ? " picked" : ""}${t.kept ? " kept" : ""}${fresh ? " fresh" : ""}" data-i="${i}" style="--d:${i * 70}ms">`
      + `<div class="top"><button type="button" class="pb" data-a="play" aria-label="Play ${clEsc(t.name)}">▶</button><b class="tn" data-a="pick">${clEsc(t.name)}</b><span class="badge ${w}">${w}</span></div>`
      + `<div class="cl-shape" data-a="pick">${t.peaks ? clWave(t.peaks) : clShape(t.plan)}</div>`
      + `<span class="src">${Math.round(t.made.bpm)} BPM · ${t.plan.secs.length} sections · ${clTime(t)}${key ? " · in " + clEsc(clShort(t.recipe.snap.sel[0])) + "'s tuning" : ""}</span>`
      + `<span class="pc">${t.kept ? `kept · <b>${clEsc(t.kept.split("/").pop())}</b>` : "the Band now · the PC's version: not connected yet"}</span>`
      + `<div class="acts"><button type="button" class="btn" data-a="more">More like this</button><button type="button" class="btn" data-a="less">Less like this</button><button type="button" class="btn${t.kept ? " on" : ""}" data-a="keep"${keeping ? " disabled" : ""}>${keeping ? "Rendering…" : t.kept ? "Kept" : "Keep"}</button></div>`
      + (t.kept ? `<div class="opens"><button type="button" class="btn" data-a="open" data-page="wave">Open in Edit</button><button type="button" class="btn" data-a="open" data-page="grain">Grain</button><button type="button" class="btn" data-a="open" data-page="chop">Chop</button></div>` : "")
      + `</div>`;
  }).join("");
  clPaintPlaying();
}
/// A take, before it is kept: its plan, part by part, section by section.
function clShape(plan) {
  const lanes = [["drums", "attack"], ["bass", "tone"], ["chord", "space"], ["drone", "level"], ["arp", "time"], ["melody", "pitch"]];
  return lanes.map(([k, c]) => `<span class="ln">${plan.secs.map((s) => `<i style="flex:${s.b};${s[k] ? `background:var(--f-${c})` : ""}"></i>`).join("")}</span>`).join("");
}
/// A kept take: its sound.
function clWave(peaks) { return `<span class="wv">${peaks.map((p) => `<i style="height:${Math.max(4, p * 100)}%"></i>`).join("")}</span>`; }
function clPaintPlaying() {
  for (const el of document.querySelectorAll(".cl-take")) {
    const t = CL.family[CL.gen] && CL.family[CL.gen].takes[+el.dataset.i];
    const on = !!t && isPlaying && CL.playingId === t.id;
    el.classList.toggle("playing", on);
    const b = el.querySelector(".pb"); if (b) b.textContent = on ? "■" : "▶";
  }
}
function clPaintHood() {
  const t = clPicked();
  document.getElementById("clHoodName").textContent = t ? `${t.name} · from ${t.recipe.snap.sel.map(clShort).join(" + ")} · seed ${t.recipe.snap.seed}` : "Make some takes first";
  // The facets.
  const fb = document.getElementById("clFacets");
  if (!t) { fb.innerHTML = ""; document.getElementById("clPlan").innerHTML = ""; }
  else {
    const srcs = [...CL.sel.map((p) => [p, clShort(p)]), ["all", "All"], ["dub", "Dub techno"]];
    let f = `<span class="hd">FACET</span><span class="hd">FROM</span><span class="hd">CLOSE ↔ FAR</span><span class="hd">WHAT IT READ</span>`;
    for (const F of CL_FACETS) {
      const st = CL.facets[F.k];
      const cur = st.from || CL.sel[0] || "dub";
      f += `<span class="fn" style="--fc:var(--f-${F.c})"><i></i>${F.n}</span>`
        + `<span class="seg sm" data-f="${F.k}">${srcs.map(([k, n]) => `<button type="button" data-src="${clEsc(k)}" class="${k === cur ? "on" : ""}" ${k === "all" && CL.sel.length < 2 ? "disabled" : ""}>${clEsc(n)}</button>`).join("")}</span>`
        + `<span class="cl-nf" style="--fc:var(--f-${F.c});--v:${st.v / 100}"><span class="cl-tr" data-f="${F.k}"></span><em>${st.v} · ${CL_TIERS[clTier(st.v)]}</em></span>`
        + `<span class="rd">${clRead(F.k)}</span>`;
    }
    fb.innerHTML = f;
    clPlanPaint();
  }
  // The words.
  const wb = document.getElementById("clWords");
  if (!wb.children.length) wb.innerHTML = CL_WORDS.map((k) => `<label for="clw-${k}">${k}</label><input id="clw-${k}" data-k="${k}" spellcheck="false">`).join("");
  for (const k of CL_WORDS) { const el = document.getElementById("clw-" + k); if (document.activeElement !== el) el.value = (t && CL.words[k]) || ""; }
  document.getElementById("clLog").innerHTML = CL.log.length ? CL.log.map((l) => `<div><b>${clEsc(l.verb)}</b> · ${clEsc(l.what)}</div>`).join("") : `<div class="dim">Nothing yet.</div>`;
  if (document.getElementById("clJson").classList.contains("on")) document.getElementById("clJson").textContent = JSON.stringify(cloneDescription(), null, 1);
  if (t) clCheck(); else document.getElementById("clCheck").innerHTML = "";
}

/// What a facet read, in a line.
function clRead(fk) {
  const from = CL.facets[fk].from;
  if (from === "dub") return { tempo: "<b>122 BPM</b>, hats swung 52 %", key: "a minor key", drums: "kick on the beat, open hat off it, rim sparse", bass: "sub, root 4th 5th, sparse", chords: "<b>minor 7th</b> stabs off the beat", arr: "<b>16/32-bar</b> lines, parts in and out", tex: "dotted-1/8 delay, a plate" }[fk];
  const ss = clSources(fk);
  if (!ss.length) return `<span class="dim">pick a song</span>`;
  const a = ss[0], more = ss.length > 1 ? ` <span class="dim">+${ss.length - 1} more</span>` : "";
  try {
    switch (fk) {
      case "tempo": return `<b>${(+a.tempo.bpm).toFixed(1)} BPM</b>${a.tempo.map && a.tempo.map.length ? `, ${Math.round(Math.min(...a.tempo.map.map((m) => m[1])))}–${Math.round(Math.max(...a.tempo.map.map((m) => m[1])))}` : ""}; 16ths ${(+a.drums.swing_16th_pct).toFixed(0)} %${more}`;
      case "key": return `<b>${a.key.name}</b>, own scale <b>${(a.tuning.scale_cents_above_tonic || []).map((c) => Math.round(c)).join(" · ")}¢</b>${more}`;
      case "drums": return `<b>${a.drums.bar_families} bar families</b>; most-used: ${(a.drums.common_bars || []).slice(0, 1).map((b) => `<code>${b.kick}</code>`).join("")}${more}`;
      case "bass": return `<b>${a.bass.range}</b>, ${(a.bass.notes || []).length} notes${more}`;
      case "chords": return `rough: <b>${(a.chords.changes || []).slice(0, 3).map((c) => c[1]).join(" → ")}</b> …${more}`;
      case "arr": return `<b>${a.change.sections} sections, ~${a.change.section_bars_median} bars</b>; stems come and go <b>${a.change.entries_exits_per_minute}×/min</b>${more}`;
      case "tex": return `smear <b>${(+a.texture.smear_mean).toFixed(2)}</b>, width <b>${(+a.texture.width_mean).toFixed(2)}</b>, hiss ${Math.round(a.texture.hiss_floor_db)} dB${more}`;
    }
  } catch (e) { /* a reading without that part */ }
  return "";
}

const CL_LANES = [["drums", "DRUMS", "attack"], ["bass", "BASS", "tone"], ["chord", "CHORDS", "space"], ["drone", "DRONE", "level"], ["arp", "ARP", "time"], ["melody", "MELODY", "pitch"]];
function clPlanPaint() {
  const box = document.getElementById("clPlan");
  if (!CL.plan) { box.innerHTML = ""; return; }
  const secs = CL.plan.secs, T = secs.reduce((a, s) => a + s.b, 0);
  let h = `<span class="pl">SECTIONS</span><div class="secs">${secs.map((s) => `<b style="flex:${s.b}" class="${s.snip ? "snip" : ""}">${s.snip ? "snippet" : clEsc(s.l)}<small>${s.b}</small></b>`).join("")}</div>`;
  h += `<span class="pl">FILLS</span><div class="joins">${secs.map((s, i) => `<i style="flex:${s.b}">${i < secs.length - 1 ? `<u class="cl-join${s.fill ? " on" : ""}" data-j="${i}" title="The join after ${clEsc(s.l)}: click for a fill or none">${s.fill ? "F" : "◆"}</u>` : ""}</i>`).join("")}</div>`;
  for (const [k, n, c] of CL_LANES) h += `<span class="pl" style="color:var(--f-${c})">${n}</span><div class="lane" style="--fc:var(--f-${c})">${secs.map((s, i) => `<i class="cl-cell${s[k] ? " on" : ""}" data-p="${k}" data-s="${i}" style="flex:${s.b}">${(k === "drums" || k === "bass") && s[k] ? `<b>${s[k]}</b>` : ""}</i>`).join("")}</div>`;
  box.innerHTML = h;
  const sec = Math.round((T * 4 * 60) / ((CL.made && CL.made.bpm) || 120));
  document.getElementById("clLen").textContent = `${T} bars · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} at ${(CL.made && CL.made.bpm) || "?"} BPM`;
}

/// The host showed the page: read the songs again (one may have been split
/// since); each new one shows itself listening while it is read.
async function cloneShown() {
  await clFetchSongs();
  if (CL.family[CL.gen]) clSetFrom(CL.family[CL.gen].takes[CL.picked] || CL.family[CL.gen].takes[0]);
  clPaintAll();
}

// ─── START ───────────────────────────────────────────────────────────────────
clLearnedScalesBack();
clLoadSaved();
cloneBuildUI();
clPaintAll();
