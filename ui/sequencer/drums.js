// The Band's drums (ours, not the sequencer repository's; 14 Nov 2026, the
// plan `WORK DIR/page-mockups/SEQ-BAND-PLAN.md` §2, the mock-up `seq-band.html`).
// RJ: "808 style drums, and they're synthesized … an 808 kit, a 909 kit, a 707
// kit, and then a funky kit made up of all the different drum sounds from my
// drum library. If there are any other drum machines that have sample packs, we
// can use those as well as kit selectors. Do a full drum grid."
//
// **Ten sounds**, in rows: kick, snare, clap, rim, closed hat, open hat, three
// toms and a percussion slot (the 808's cowbell). Each has Tune, Decay, Tone,
// Level, Pan and two sends, and a closed hat chokes the open one, as on an 808.
//
// **Kits.** "808 synth" is synthesised here, after MGL's own drum-voice spec
// (`docs/effects/pluggo-instruments.md`, "analogue drums"), with the 808's clap,
// rim and cowbell added: no samples. Every other kit plays samples from the
// library, through the server's `/audio?p=` (any WAV or AIFF, as WAV), so
// nothing is copied: the 808, 909, 707, 606, CR-78, LinnDrum, DMX and SP-12 from
// `many_drum_machines`, a funky kit from RJ's own drum folders, and every other
// machine in `many_drum_machines`, listed by the server (`/api/seq/kits`) and
// mapped onto the rows by their file names. A sound a kit lacks, or one that has
// not loaded, plays from the synth.
//
// **The grid**: a row per sound, up to 64 steps at 1/8, 1/16 or 1/32. Each step
// has a velocity (0 is off), an accent, a chance and a ratchet (1–8 quick
// repeats); each row has its own length, so rows can run against each other.
// Swing is the Band's. Chance is decided by a hash of the seed, the row and the
// step's count from the start, never by `Math.random`: the same take plays the
// same drums, live, in the film and in the export.

// ─── THE SOUNDS ──────────────────────────────────────────────────────────────
// [key, name, the Tune knob's reading, the Tone knob's name, default tune Hz or
// st, default decay ms, default tone %, default level, pan]
const DM_SLOTS = [
  { k: "kick", name: "Kick", tone: "Tone", tune: 52, dec: 900, tn: 45, lv: 90, pan: 0 },
  { k: "snare", name: "Snare", tone: "Snap", tune: 180, dec: 260, tn: 60, lv: 70, pan: -8 },
  { k: "clap", name: "Clap", tone: "Tone", tune: 1100, dec: 300, tn: 50, lv: 60, pan: 12 },
  { k: "rim", name: "Rim", tone: "Tone", tune: 1700, dec: 45, tn: 50, lv: 55, pan: 30 },
  { k: "chh", name: "Closed hat", tone: "Tone", tune: 8000, dec: 70, tn: 60, lv: 55, pan: 18 },
  { k: "ohh", name: "Open hat", tone: "Tone", tune: 8000, dec: 420, tn: 60, lv: 50, pan: -15 },
  { k: "ltom", name: "Low tom", tone: "Bend", tune: 90, dec: 600, tn: 40, lv: 60, pan: -35 },
  { k: "mtom", name: "Mid tom", tone: "Bend", tune: 140, dec: 480, tn: 40, lv: 60, pan: 0 },
  { k: "htom", name: "High tom", tone: "Bend", tune: 210, dec: 400, tn: 40, lv: 60, pan: 35 },
  { k: "perc", name: "Cowbell", tone: "Tone", tune: 540, dec: 180, tn: 50, lv: 45, pan: 45 },
];
const dmId = (s, what) => `dm${s.k[0].toUpperCase()}${s.k.slice(1)}${what}`;

// ─── THE KITS ────────────────────────────────────────────────────────────────
// Paths are inside the library: `/audio?p=<path>`. RJ's library root holds
// `My Audio Library/` (14 Nov 2026: `/Volumes/2TB Ext/- AAA AUDIO WORK`).
const DM_MDM = "My Audio Library/many_drum_machines/";
const DM_SND = "My Audio Library/Audio Library 4 (S&D)/";
const DM_KITS = {
  synth: { name: "808 synth", files: {} },
  r808: { name: "808", dir: DM_MDM + "roland/roland_tr808/", files: { kick: "TR-808Kick03.wav", snare: "TR-808Snare04.wav", clap: "TR-808Clap01.wav", rim: "TR-808Rim01.wav", chh: "TR-808Hat_C01.wav", ohh: "TR-808Hat_O01.wav", ltom: "TR-808Tom01.wav", mtom: "TR-808Tom04.wav", htom: "TR-808Tom07.wav", perc: "TR-808Cow.wav" } },
  r909: { name: "909", dir: DM_MDM + "roland/roland_tr909/", files: { kick: "TR-909Kick 01.wav", snare: "TR-909Snare 01.wav", clap: "TR-909Clap.wav", rim: "TR-909Rim.wav", chh: "TR-909Hat C 01.wav", ohh: "TR-909Hat O 01.wav", ltom: "MaxV - Roland909 - 909TOMA 11.WAV", mtom: "MaxV - Roland909 - 909TOMA 11.WAV", htom: "MaxV - Roland909 - 909TOMA 11.WAV", perc: "TR-909Ride.wav" }, tune: { ltom: -5, htom: 5 }, perc: "Ride" },
  r707: { name: "707", dir: DM_MDM + "roland/roland_707/", files: { kick: "TR-707Kick01.wav", snare: "TR-707Snare01.wav", clap: "TR-707Clap.wav", rim: "TR-707RimShot.wav", chh: "TR-707Hat_C.wav", ohh: "TR-707Hat_O.wav", ltom: "TR-707Tom_Lo.wav", mtom: "TR-707Tom_Mid.wav", htom: "TR-707Tom_Hi.wav", perc: "TR-707Cow.wav" } },
  r606: { name: "606", dir: DM_MDM + "roland/roland_606/", files: { kick: "TR606Kick01.wav", snare: "TR606Snare01.wav", chh: "TR606Hat_C01.wav", ohh: "TR606Hat_O01.wav", ltom: "MaxV - Roland Tr-606 - Tom-Lo.wav", mtom: "MaxV - Roland Tr-606 - Tom-Med.wav", htom: "MaxV - Roland Tr-606 - Tom-Hi.wav", perc: "TR606Cymb01.wav" }, perc: "Cymbal" },
  cr78: { name: "CR-78", dir: DM_MDM + "roland/roland_cr-78/", files: { kick: "CR78Kick.wav", snare: "CR78Snare.wav", clap: "CR78Perc01.wav", rim: "CR78Rimshot.wav", chh: "CR78Hat_C.wav", ohh: "CR78Hat_O.wav", ltom: "CR78Perc04.wav", mtom: "CR78Perc05.wav", htom: "CR78Perc06.wav", perc: "CR78Cowbell.wav" } },
  linn: { name: "LinnDrum", dir: DM_MDM + "linn/linn_linndrum/", files: { kick: "LinnKick01.wav", snare: "LinnSnare01.wav", clap: "LinnClap.wav", rim: "LinnRimshot.wav", chh: "LinnHat_C.wav", ohh: "LinnHat_O.wav", ltom: "LinnTom01.wav", mtom: "LinnTom02.wav", htom: "LinnTom02.wav", perc: "LinnCowbell.wav" }, tune: { htom: 4 } },
  dmx: { name: "DMX", dir: DM_MDM + "oberheim/oberheim_dmx/", files: { kick: "DMXKick01.wav", snare: "DMXSnare01.wav", clap: "DMXClap.wav", rim: "DMXRim.wav", chh: "DMXHat_C.wav", ohh: "DMXHat_O.wav", ltom: "DMXTomLo.wav", mtom: "DMXTomMid.wav", htom: "DMXTomHi.wav", perc: "DMXTamborine.wav" }, perc: "Tambourine" },
  sp12: { name: "SP-12", dir: DM_MDM + "emu/emu_sp12/", files: { kick: "bd1.wav", snare: "snare.wav", clap: "electro.wav", rim: "rim.wav", chh: "hihat.wav", ohh: "open hi.wav", ltom: "lo tom.wav", mtom: "tom.wav", htom: "tom2.wav", perc: "clank.wav" }, perc: "Clank" },
  funky: { name: "Funky (RJ's library)", dir: DM_SND, files: { kick: "Grungy Drums/Kicks/Kicks Dry/UndergroundKicks/kick142.aif", snare: "Dirty tr505 Edits/soft nsare.aif", clap: "Dirty tr505 Edits/dirty clap.aif", rim: "Grungy Drums/Cymbals and Misc/rim.aif", chh: "Grungy Drums/HiHats/HiHats Dry/hh001s.aif", ohh: "Grungy Drums/HiHats/HiHats Dry/hh002l.aif", ltom: "Dirty tr505 Edits/deep drunk tom.aif", mtom: "Dirty tr505 Edits/mid tom.aif", htom: "Dirty tr505 Edits/hi tom.aif", perc: "Grungy Drums/Cymbals and Misc/tamb1.aif" }, perc: "Tambourine" },
};
/// Every other machine the server found in `many_drum_machines`, as kits.
const DM_MACHINES = {};

/// A machine's files onto the ten rows, by their names.
const DM_GUESS = [
  ["kick", /kick|bd|bass ?drum|boom/i], ["snare", /snare|sd\b|sd\d|snr/i], ["clap", /clap|cp\b|cp\d/i], ["rim", /rim|rs\b|stick|clave/i],
  ["ohh", /(hat|hh).*(o|open)|oh\b|oph|open/i], ["chh", /hat|hh|ch\b|clh/i], ["ltom", /(lo|low).*tom|tom.*(lo|low)|lt\b|tom ?1\b|tom01/i],
  ["mtom", /(mid|med).*tom|tom.*(mid|med)|mt\b|tom ?2\b|tom02/i], ["htom", /(hi|high).*tom|tom.*(hi|high)|ht\b|tom ?3\b|tom03/i], ["perc", /cow|cb\b|bell|tamb|shak|perc|conga|ride|cymb/i],
];
function dmGuessKit(files) {
  const out = {};
  for (const [slot, re] of DM_GUESS) {
    const f = files.find((x) => re.test(x) && !Object.values(out).includes(x));
    if (f) out[slot] = f;
  }
  if (!out.ltom || !out.mtom || !out.htom) {
    const toms = files.filter((x) => /tom/i.test(x) && !Object.values(out).includes(x));
    for (const s of ["ltom", "mtom", "htom"]) if (!out[s] && toms.length) out[s] = toms.shift();
  }
  return out;
}

/// "roland tr808" → "Roland TR-808".
function dmPretty(name) {
  return name.split(/\s+/).map((w) => (/^[a-z]{1,3}-?\d/i.test(w) ? w.toUpperCase().replace(/^([A-Z]+)(\d)/, "$1-$2") : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/// The server's list of machines, once.
let dmMachinesAsked = false;
async function dmLoadMachines() {
  if (dmMachinesAsked) return;
  dmMachinesAsked = true;
  try {
    const r = await fetch("/api/seq/kits");
    if (!r.ok) return;
    const list = await r.json();
    for (const m of list) {
      const files = dmGuessKit(m.files || []);
      if (Object.keys(files).length < 3) continue;
      DM_MACHINES["m:" + m.path] = { name: dmPretty(m.name), dir: m.path.replace(/\/?$/, "/"), files };
    }
    dmFillKitSelect();
  } catch (e) { /* on its own, with no server: the built-in kits */ }
}
const dmKit = (id) => DM_KITS[id] || DM_MACHINES[id] || DM_KITS.synth;

/// Decoded samples, by path: shared by every context, the offline ones too.
const DM_BUF = new Map();
const DM_LOADING = new Map();
function dmFetch(path) {
  if (DM_BUF.has(path)) return Promise.resolve(DM_BUF.get(path));
  if (DM_LOADING.has(path)) return DM_LOADING.get(path);
  const p = (async () => {
    try {
      const r = await fetch("/audio?p=" + encodeURIComponent(path));
      if (!r.ok) throw new Error(r.status);
      const bytes = await r.arrayBuffer();
      const c = new OfflineAudioContext(2, 1, 44100);
      const buf = await c.decodeAudioData(bytes);
      DM_BUF.set(path, buf);
      return buf;
    } catch (e) {
      DM_BUF.set(path, null);
      return null;
    } finally {
      DM_LOADING.delete(path);
    }
  })();
  DM_LOADING.set(path, p);
  return p;
}
/// Load a kit's samples; resolves when every one has loaded or failed.
function dmLoadKit(id) {
  const kit = dmKit(id);
  return Promise.all(Object.values(kit.files || {}).map((f) => dmFetch(kit.dir + f)));
}
function dmSample(slot) {
  const kit = dmKit(DM.kit);
  const f = kit.files && kit.files[slot];
  return f ? DM_BUF.get(kit.dir + f) || null : null;
}

// ─── THE VALUES ──────────────────────────────────────────────────────────────
const DM = { kit: "synth", rate: 16, edit: "vel", seed: 808, slots: {}, grid: null };
/// The grid: per row `{ len, steps: [{ v, a, c, r }] }` (velocity 0–127, 0 off;
/// accent; chance 0–100; ratchet 1–8), 64 steps a row.
const dmEmptyRow = () => ({ len: 16, mute: false, steps: Array.from({ length: 64 }, () => ({ v: 0, a: 0, c: 100, r: 1 })) });
function dmEmptyGrid() { const g = {}; for (const s of DM_SLOTS) g[s.k] = dmEmptyRow(); return g; }

/// The patterns, written as rows of 16: digits are velocity (1–9 → 14–127),
/// `A` an accent at full, `c` a hit at 50 % chance, `r` a ratchet of 2, `.` rest.
const DM_PATTERNS = {
  four: { name: "Four on the floor", rows: { kick: "9...9...9...9...", chh: "..5...5...5...5.", ohh: "..6...6...6...6.", rim: "....c.......4..c", clap: "....5.......5..." } },
  dub: { name: "Dub techno (Basic Channel)", rows: { kick: "9...9...9...9...", chh: "3.5.3.5.3.5.3.5c", ohh: "..7...7...7...7.", rim: "......4.....c...", snare: "............2..." }, len: { chh: 16, rim: 12 } },
  deep: { name: "Dub techno (DeepChord)", rows: { kick: "8...8...8...8...", chh: "2c4c2c4c2c4c2c4c", ohh: "..5...5...5...6.", perc: ".c......c.....c.", rim: "...3.......3...." }, len: { perc: 14 } },
  half: { name: "Half time", rows: { kick: "9.........7.....", snare: "........9.......", chh: "4.4.4.4.4.4.4.4." } },
  broken: { name: "Broken (IDM)", rows: { kick: "9..6..c...9.c...", snare: "....8..r.c..8...", chh: "5c3r5c3.5c3r5c.3", rim: "..c..4...c..4..c", ltom: "...........c..r." }, len: { chh: 13, rim: 11, ltom: 7 } },
  electro: { name: "Electro", rows: { kick: "9.....9...9.....", snare: "....9.......9...", clap: "....6.......6...", chh: "5555555555555555", perc: "..4......4......" } },
  empty: { name: "Empty", rows: {} },
};
function dmFromPattern(key) {
  const p = DM_PATTERNS[key] || DM_PATTERNS.empty;
  const g = dmEmptyGrid();
  for (const [slot, str] of Object.entries(p.rows)) {
    const row = g[slot];
    if (!row) continue;
    row.len = (p.len && p.len[slot]) || 16;
    for (let i = 0; i < 64; i++) {
      const ch = str[i % str.length];
      const st = row.steps[i];
      if (ch === ".") continue;
      if (ch === "A") { st.v = 127; st.a = 1; }
      else if (ch === "c") { st.v = 90; st.c = 50; }
      else if (ch === "r") { st.v = 85; st.r = 2; }
      else st.v = Math.round(14 + ((+ch - 1) / 8) * 113);
    }
  }
  return g;
}

/// The grid lives in a hidden input as text, so presets and the recorder keep it.
function dmGridSave() {
  const el = document.getElementById("dmGridText");
  if (!el) return;
  const rows = {};
  for (const s of DM_SLOTS) {
    const r = DM.grid[s.k];
    rows[s.k] = { len: r.len, mute: r.mute ? 1 : 0, s: r.steps.map((x) => (x.v ? [x.v, x.a, x.c, x.r] : 0)) };
  }
  el.value = JSON.stringify(rows);
}
function dmGridLoad() {
  const el = document.getElementById("dmGridText");
  let rows = null;
  try { rows = el && el.value ? JSON.parse(el.value) : null; } catch (e) { rows = null; }
  const g = dmEmptyGrid();
  if (rows) for (const s of DM_SLOTS) {
    const r = rows[s.k];
    if (!r) continue;
    g[s.k].len = Math.max(1, Math.min(64, r.len || 16));
    g[s.k].mute = !!r.mute;
    (r.s || []).forEach((x, i) => { if (x && i < 64) Object.assign(g[s.k].steps[i], { v: x[0], a: x[1], c: x[2], r: x[3] }); });
  }
  DM.grid = g;
}

function drumsRead() {
  const v = (id, d) => { const el = document.getElementById(id); return el ? el.value : d; };
  const kit = v("dmKitSelect", "synth");
  if (kit !== DM.kit) { DM.kit = kit; dmLoadKit(kit).then(() => drumsPaint()); }
  DM.rate = +v("dmRateSelect", 16) || 16;
  DM.edit = v("dmEditSelect", "vel");
  DM.seed = +v("dmSeedSlider", 808);
  for (const s of DM_SLOTS) {
    DM.slots[s.k] = {
      tune: +v(dmId(s, "TuneSlider"), 0), dec: +v(dmId(s, "DecSlider"), 50), tone: +v(dmId(s, "ToneSlider"), s.tn),
      lv: +v(dmId(s, "LevelSlider"), s.lv), pan: +v(dmId(s, "PanSlider"), s.pan), dly: +v(dmId(s, "DlySlider"), 0), spc: +v(dmId(s, "SpcSlider"), 0),
    };
  }
  dmGridLoad();
  if (typeof bandApplyDrums === "function") bandApplyDrums();
  drumsPaint();
}

// ─── THE PLAN ────────────────────────────────────────────────────────────────
/// The hits in boundary `k`'s step: `{ slot, at, vel }`, `at` in seconds after
/// the boundary. Pure, as `acPlan` is.
function drumPlan(k) {
  const out = [];
  if (!DM.grid || typeof AC === "undefined" || !AC.parts.drums || !AC.parts.drums.on) return out;
  const spb = 60 / bpm, u = 4 / DM.rate, t0 = k * stepBeats;
  const swing = typeof BAND !== "undefined" ? BAND.swing : 50;
  for (const i of acUnits(k, u)) {
    // Swing: every other step late, by up to a third of a step at 75 %.
    const late = i % 2 ? Math.max(0, (swing - 50) / 50) * u : 0;
    for (const s of DM_SLOTS) {
      const row = DM.grid[s.k];
      if (row.mute) continue;
      const j = ((i % row.len) + row.len) % row.len;
      const st = row.steps[j];
      if (!st.v) continue;
      if (st.c < 100 && acHash(i * 31 + DM_SLOTS.indexOf(s), DM.seed * 7919 + j) * 100 >= st.c) continue;
      const vel = Math.min(1.4, (st.v / 127) * (st.a ? 1.35 : 1));
      const n = Math.max(1, st.r | 0);
      for (let q = 0; q < n; q++) out.push({ slot: s.k, at: (i * u + late + (q * u) / n - t0) * spb, vel: vel * (q ? 0.8 - q * 0.05 : 1) });
    }
  }
  return out;
}

// ─── THE VOICES ──────────────────────────────────────────────────────────────
let dmNoise = null, dmOpenHats = [];
/// A second of seeded noise, for every context.
function dmNoiseBuf(c) {
  if (dmNoise && dmNoise.sampleRate === c.sampleRate) return dmNoise;
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
  let s = 80808;
  for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
  dmNoise = b;
  return b;
}

/// One hit of `slot` at `time`, into `dest` (the slot's own strip in the mixer).
function drumHit(slot, time, vel, dest) {
  const c = audioCtx, P = DM.slots[slot], def = DM_SLOTS.find((s) => s.k === slot);
  if (!c || !P || !dest) return;
  const g = c.createGain();
  g.gain.value = vel;
  g.connect(dest);
  // The closed hat chokes the open one.
  if (slot === "chh") { for (const h of dmOpenHats) if (h.end > time && h.start < time) { h.g.gain.cancelScheduledValues(time); h.g.gain.setTargetAtTime(0, time, 0.008); } dmOpenHats = dmOpenHats.filter((h) => h.end > c.currentTime); }
  const buf = dmSample(slot);
  if (buf) return dmPlaySample(buf, slot, P, time, g);
  dmSynth(slot, def, P, time, g);
}

function dmPlaySample(buf, slot, P, time, g) {
  const c = audioCtx, kit = dmKit(DM.kit);
  const src = c.createBufferSource(), env = c.createGain(), lp = c.createBiquadFilter();
  src.buffer = buf;
  const st = P.tune + ((kit.tune && kit.tune[slot]) || 0);
  src.playbackRate.value = Math.pow(2, st / 12);
  lp.type = "lowpass";
  lp.frequency.value = 400 * Math.pow(50, P.tone / 100);
  // Decay: how much of the sample sounds, 5 % to all of it.
  const len = buf.duration / src.playbackRate.value, keep = len * (0.05 + 0.95 * (P.dec / 100));
  env.gain.setValueAtTime(1, time);
  env.gain.setTargetAtTime(0, time + keep * 0.8, Math.max(0.005, keep * 0.07));
  src.connect(lp); lp.connect(env); env.connect(g);
  src.start(time);
  src.stop(time + keep + 0.1);
  if (slot === "ohh") dmOpenHats.push({ g: env, start: time, end: time + keep });
}

/// The 808, synthesised. Knob values: tune is Hz (sample kits use it as
/// semitones), decay 0–100, tone 0–100.
const dmDecMs = (P, def) => def.dec * Math.pow(4, (P.dec - 50) / 50);
const dmTuneHz = (P, def) => def.tune * Math.pow(2, P.tune / 12);
function dmSynth(slot, def, P, time, out) {
  const c = audioCtx, dec = dmDecMs(P, def) / 1000, f = dmTuneHz(P, def), tn = P.tone / 100;
  const osc = (type, hz) => { const o = c.createOscillator(); o.type = type; o.frequency.value = hz; return o; };
  const amp = (peak, d, at = 0.001) => { const e = c.createGain(); e.gain.setValueAtTime(0, time); e.gain.linearRampToValueAtTime(peak, time + at); e.gain.setTargetAtTime(0, time + at, Math.max(0.003, d / 4)); return e; };
  const noise = () => { const n = c.createBufferSource(); n.buffer = dmNoiseBuf(c); n.loop = true; return n; };
  const end = time + dec * 1.6 + 0.05;
  const go = (src) => { src.start(time); src.stop(end); };
  if (slot === "kick") {
    // A sine falling from tune + tone to tune, and a click.
    const o = osc("sine", f), e = amp(1, dec);
    o.frequency.setValueAtTime(f + 40 + tn * 200, time);
    o.frequency.exponentialRampToValueAtTime(f, time + 0.02 + dec * 0.12);
    o.connect(e); e.connect(out); go(o);
    const n = noise(), hp = c.createBiquadFilter(), ce = amp(0.35 * tn, 0.006);
    hp.type = "highpass"; hp.frequency.value = 2500;
    n.connect(hp); hp.connect(ce); ce.connect(out); go(n);
  } else if (slot === "snare") {
    // Two tuned bodies and snappy noise through a low-pass.
    for (const [r, l] of [[1, 0.55], [1.83, 0.35]]) { const o = osc("triangle", f * r), e = amp(l, dec * 0.45); o.connect(e); e.connect(out); go(o); }
    const n = noise(), hp = c.createBiquadFilter(), lp = c.createBiquadFilter(), e = amp(0.25 + 0.6 * tn, dec);
    hp.type = "highpass"; hp.frequency.value = 1200; lp.type = "lowpass"; lp.frequency.value = 7000;
    n.connect(hp); hp.connect(lp); lp.connect(e); e.connect(out); go(n);
  } else if (slot === "clap") {
    // Three quick bursts, then a tail, through a band-pass.
    const n = noise(), bp = c.createBiquadFilter(), e = c.createGain();
    bp.type = "bandpass"; bp.frequency.value = f * (0.6 + tn * 0.8); bp.Q.value = 1.6;
    e.gain.setValueAtTime(0, time);
    for (let j = 0; j < 3; j++) { const t = time + j * 0.011; e.gain.setValueAtTime(1, t); e.gain.setTargetAtTime(0.1, t + 0.001, 0.004); }
    e.gain.setValueAtTime(0.7, time + 0.034);
    e.gain.setTargetAtTime(0, time + 0.035, Math.max(0.01, dec / 4));
    n.connect(bp); bp.connect(e); e.connect(out); go(n);
  } else if (slot === "rim") {
    const o1 = osc("triangle", f), o2 = osc("square", f * 0.3), hp = c.createBiquadFilter(), e = amp(0.7, dec);
    hp.type = "highpass"; hp.frequency.value = 600 + tn * 1500;
    o1.connect(hp); o2.connect(hp); hp.connect(e); e.connect(out); go(o1); go(o2);
  } else if (slot === "chh" || slot === "ohh") {
    // Six square waves at the 808's ratios, band-passed high.
    const k = f / 8000, bp = c.createBiquadFilter(), hp = c.createBiquadFilter(), e = amp(0.5, dec);
    bp.type = "bandpass"; bp.frequency.value = 9000 * k; bp.Q.value = 0.8;
    hp.type = "highpass"; hp.frequency.value = 5000 + tn * 4000;
    for (const hz of [205.3, 304.4, 369.6, 522.7, 540, 800]) { const o = osc("square", hz * 1.7 * k); o.connect(bp); go(o); }
    bp.connect(hp); hp.connect(e); e.connect(out);
    if (slot === "ohh") dmOpenHats.push({ g: e, start: time, end });
  } else if (slot.endsWith("tom")) {
    const o = osc("sine", f), e = amp(0.9, dec);
    o.frequency.setValueAtTime(f * (1 + tn * 0.6), time);
    o.frequency.exponentialRampToValueAtTime(f, time + dec * 0.5);
    o.connect(e); e.connect(out); go(o);
  } else {
    // Cowbell: two squares, the 808's 540 and 800, through a band-pass.
    const bp = c.createBiquadFilter(), e = amp(0.45, dec);
    bp.type = "bandpass"; bp.frequency.value = 2640 * (f / 540) * (0.7 + tn * 0.6); bp.Q.value = 1.2;
    for (const r of [1, 800 / 540]) { const o = osc("square", f * r); o.connect(bp); go(o); }
    bp.connect(e); e.connect(out);
  }
}

// ─── THE EDITOR ──────────────────────────────────────────────────────────────
function dmKnob(id, label, min, max, value, step = 1) {
  return `<div class="knob-group dm-kg"><span class="knob-label">${label}</span>`
    + `<div class="knob" onmousedown="knobDown(event, '${id}')" ontouchstart="knobTouchStart(event,'${id}')"></div>`
    + `<input type="range" class="knob-hidden" min="${min}" max="${max}" step="${step}" value="${value}" id="${id}" oninput="drumsRead()" />`
    + `<span class="knob-val" id="${id.replace(/Slider$/, "Val")}"></span></div>`;
}

function dmFillKitSelect() {
  const sel = document.getElementById("dmKitSelect");
  if (!sel) return;
  const v = sel.value || "synth";
  const opt = (id, k) => `<option value="${id}">${k.name}</option>`;
  const mach = Object.entries(DM_MACHINES).sort((a, b) => a[1].name.localeCompare(b[1].name));
  sel.innerHTML = `<optgroup label="Kits">${Object.entries(DM_KITS).map(([id, k]) => opt(id, k)).join("")}</optgroup>`
    + (mach.length ? `<optgroup label="Every drum machine in the library">${mach.map(([id, k]) => opt(id, k)).join("")}</optgroup>` : "");
  sel.value = [...sel.options].some((o) => o.value === v) ? v : "synth";
}

function drumsBuildUI(host) {
  if (!host || document.getElementById("dmKitSelect")) return;
  const seg = (id, opts, v) => `<select id="${id}" data-seg onchange="drumsRead()">${opts.map(([o, t]) => `<option value="${o}"${o === v ? " selected" : ""}>${t}</option>`).join("")}</select>`;
  let rows = "";
  for (const s of DM_SLOTS) {
    rows += `<div class="dm-row" data-s="${s.k}">`
      + `<button type="button" class="dm-pad" data-s="${s.k}" title="Play ${s.name}"></button><span class="dm-nm">${s.name}</span>`
      + dmKnob(dmId(s, "TuneSlider"), "Tune", -24, 24, 0)
      + dmKnob(dmId(s, "DecSlider"), "Decay", 0, 100, 50)
      + dmKnob(dmId(s, "ToneSlider"), s.tone, 0, 100, s.tn)
      + dmKnob(dmId(s, "LevelSlider"), "Level", 0, 100, s.lv)
      + dmKnob(dmId(s, "PanSlider"), "Pan", -100, 100, s.pan)
      + dmKnob(dmId(s, "DlySlider"), "Delay", 0, 100, 0)
      + dmKnob(dmId(s, "SpcSlider"), "Space", 0, 100, 0)
      + `<div class="dm-cells" data-s="${s.k}"></div>`
      + `<button type="button" class="dm-len" data-s="${s.k}" title="This row's length: click for more, shift-click for less"></button>`
      + `</div>`;
  }
  host.innerHTML = `<div class="ph"><b class="nm dm-title">DRUMS</b><span class="meta">808 synth or samples from the library · a row per sound · its own grid</span><span class="grow"></span>`
    + `<span class="cap">Kit</span><select id="dmKitSelect" class="dm-kit" onchange="drumsRead()"></select>`
    + `<span class="cap">Pattern</span><select id="dmPatSelect" class="dm-pat">${Object.entries(DM_PATTERNS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join("")}</select>`
    + `<button type="button" class="btn" id="dmPatApply" title="Write this pattern into the grid">Use</button>`
    + `<span class="cap">Rate</span>${seg("dmRateSelect", [["8", "1/8"], ["16", "1/16"], ["32", "1/32"]], "16")}`
    + `<span class="cap">Edit</span>${seg("dmEditSelect", [["vel", "Velocity"], ["acc", "Accent"], ["chance", "Chance"], ["rat", "Ratchet"]], "vel")}`
    + `<button type="button" class="btn" id="dmClear">Clear</button>`
    + `<input type="text" class="at-hidden" id="dmGridText" oninput="drumsRead()" onchange="drumsRead()" />`
    + `<input type="range" class="knob-hidden" id="dmSeedSlider" min="1" max="99999" value="808" oninput="drumsRead()" /></div>`
    + `<div class="dm-head"><span>SOUND</span><span>TUNE</span><span>DECAY</span><span>TONE</span><span>LEVEL</span><span>PAN</span><span>DLY</span><span>SPC</span><span class="dm-nums">${Array.from({ length: 16 }, (_, i) => `<i>${i % 4 ? "·" : i / 4 + 1}</i>`).join("")}</span><span>LEN</span></div>`
    + `<div class="dm-rows">${rows}</div>`;
  dmFillKitSelect();
  DM.grid = dmFromPattern("dub");
  dmGridSave();
  // Clicks on the grid: by edit mode. Drag up and down for velocity.
  host.addEventListener("mousedown", (e) => {
    const cell = e.target.closest(".dm-cell");
    if (cell) { dmCellDown(e, cell); return; }
    const pad = e.target.closest(".dm-pad");
    if (pad) { if (typeof initAudio === "function") initAudio(); if (typeof bandPadHit === "function") bandPadHit(pad.dataset.s); return; }
    const len = e.target.closest(".dm-len");
    if (len) {
      const r = DM.grid[len.dataset.s];
      r.len = Math.max(1, Math.min(64, r.len + (e.shiftKey ? -1 : 1)));
      dmGridCommit();
    }
  });
  host.addEventListener("contextmenu", (e) => {
    const nm = e.target.closest(".dm-nm");
    if (!nm) return;
    e.preventDefault();
    const r = DM.grid[nm.parentElement.dataset.s];
    r.mute = !r.mute;
    dmGridCommit();
  });
  document.getElementById("dmPatApply").addEventListener("click", () => { DM.grid = dmFromPattern(document.getElementById("dmPatSelect").value); dmGridCommit(); });
  document.getElementById("dmClear").addEventListener("click", () => { DM.grid = dmEmptyGrid(); dmGridCommit(); });
}

/// After an edit of the grid: saved where presets and the recorder see it.
function dmGridCommit() {
  dmGridSave();
  const el = document.getElementById("dmGridText");
  el.dispatchEvent(new Event("change", { bubbles: true }));
  drumsPaint();
}

function dmCellDown(e, cell) {
  const slot = cell.parentElement.dataset.s, i = +cell.dataset.i, st = DM.grid[slot].steps[i];
  if (DM.edit === "acc") { if (st.v) st.a = st.a ? 0 : 1; dmGridCommit(); return; }
  if (DM.edit === "chance") { if (st.v) st.c = { 100: 75, 75: 50, 50: 25, 25: 100 }[st.c] || 100; dmGridCommit(); return; }
  if (DM.edit === "rat") { if (st.v) st.r = { 1: 2, 2: 3, 3: 4, 4: 6, 6: 8, 8: 1 }[st.r] || 1; dmGridCommit(); return; }
  // Velocity: a click turns it on or off; a drag sets how hard.
  const y0 = e.clientY, was = st.v;
  let moved = false;
  const move = (ev) => {
    const dy = y0 - ev.clientY;
    if (Math.abs(dy) < 3 && !moved) return;
    moved = true;
    st.v = Math.max(1, Math.min(127, (was || 100) + dy * 2));
    drumsPaint();
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    if (!moved) st.v = was ? 0 : 100;
    if (!st.v) Object.assign(st, { a: 0, c: 100, r: 1 });
    dmGridCommit();
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

let dmNow = -1;
function drumsPaint() {
  const host = document.getElementById("drumsHost");
  if (!host || !DM.grid) return;
  // As many columns as the longest row, in bars of 16.
  const steps = Math.min(64, Math.max(16, Math.ceil(Math.max(...DM_SLOTS.map((s) => DM.grid[s.k].len)) / 16) * 16));
  const nums = host.querySelector(".dm-nums");
  if (nums && nums.children.length !== steps) {
    nums.style.gridTemplateColumns = `repeat(${steps}, minmax(0, 1fr))`;
    nums.innerHTML = Array.from({ length: steps }, (_, i) => `<i>${i % 4 ? "·" : i / 4 + 1}</i>`).join("");
  }
  for (const s of DM_SLOTS) {
    const row = DM.grid[s.k], box = host.querySelector(`.dm-cells[data-s="${s.k}"]`);
    if (!box) continue;
    if (box.children.length !== steps) box.innerHTML = Array.from({ length: steps }, (_, i) => `<i class="dm-cell" data-i="${i}"></i>`).join("");
    box.style.setProperty("--n", steps);
    for (let i = 0; i < steps; i++) {
      const st = row.steps[i], el = box.children[i];
      el.className = "dm-cell" + (st.v ? " on" : "") + (st.a ? " ac" : "") + (st.v && st.c < 100 ? " ch" : "") + (st.v && st.r > 1 ? " rt" : "") + (i >= row.len ? " out" : "") + (i % 4 === 0 ? " beat" : "") + (i === dmNow % row.len ? " now" : "");
      el.style.setProperty("--v", (st.v / 127).toFixed(2));
      el.textContent = st.v && st.r > 1 ? "×" + st.r : st.v && st.c < 100 ? st.c : "";
    }
    const len = host.querySelector(`.dm-len[data-s="${s.k}"]`);
    if (len) len.textContent = row.len;
    host.querySelector(`.dm-row[data-s="${s.k}"]`).classList.toggle("muted", row.mute);
  }
  // The knobs' readings.
  const kit = dmKit(DM.kit), synth = DM.kit === "synth";
  for (const s of DM_SLOTS) {
    const P = DM.slots[s.k];
    if (!P) continue;
    const val = (id, t) => { const el = document.getElementById(dmId(s, id)); if (el) el.textContent = t; };
    const sample = !synth && kit.files && kit.files[s.k];
    val("TuneVal", sample || !synth ? (P.tune > 0 ? "+" : "") + P.tune + " st" : (() => { const hz = dmTuneHz(P, s); return hz >= 1000 ? (hz / 1000).toFixed(1) + "k" : Math.round(hz) + " Hz"; })());
    val("DecVal", synth ? Math.round(dmDecMs(P, s)) + " ms" : Math.round(5 + 0.95 * P.dec) + " %");
    val("ToneVal", Math.round(P.tone) + "%");
    val("LevelVal", Math.round(P.lv) + "%");
    val("PanVal", P.pan === 0 ? "C" : (P.pan < 0 ? "L" : "R") + Math.abs(P.pan));
    val("DlyVal", Math.round(P.dly) + "%");
    val("SpcVal", Math.round(P.spc) + "%");
    const nm = document.querySelector(`.dm-row[data-s="${s.k}"] .dm-nm`);
    if (nm) nm.textContent = s.k === "perc" && kit.perc ? kit.perc : s.name;
    const pad = document.querySelector(`.dm-pad[data-s="${s.k}"]`);
    if (pad) pad.classList.toggle("sampled", !!(sample && DM_BUF.get(kit.dir + kit.files[s.k])));
  }
}

/// The step the grid is at, lit, as the transport plays.
function drumsOnStep(k) {
  const i = Math.floor((k * stepBeats) / (4 / DM.rate) + 1e-9);
  if (i === dmNow) return;
  dmNow = i;
  drumsPaint();
}
function drumsFlash(slot) {
  const pad = document.querySelector(`.dm-pad[data-s="${slot}"]`);
  if (!pad) return;
  pad.classList.add("hit");
  setTimeout(() => pad.classList.remove("hit"), 90);
}

// What presets, morphs and the recorder carry.
const DRUMS_MORPH_IDS = DM_SLOTS.flatMap((s) => ["TuneSlider", "DecSlider", "ToneSlider", "LevelSlider", "PanSlider", "DlySlider", "SpcSlider"].map((w) => dmId(s, w)));
const DRUMS_SLIDER_IDS = [...DRUMS_MORPH_IDS, "dmSeedSlider"];
const DRUMS_SELECT_IDS = ["dmKitSelect", "dmRateSelect", "dmGridText"];
