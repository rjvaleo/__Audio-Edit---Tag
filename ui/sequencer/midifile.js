// The Band's MIDI file player (ours, not the sequencer repository's; 18 Nov
// 2026, after the approved mock-up `band-midi.html` and `SEQ-MIDI-IMPORT-PLAN.md`).
// RJ: "A, note for note" / "Yes, build it".
//
// Plays a Standard MIDI File note for note through the Band's own instruments,
// mixer channels and sends, at the file's tempo or the Band's, going round or
// stopping at the end, as written or moved to the Band's scale. While a file
// plays (`MF.on`), the parts' own patterns, Style and Arrange rest; switching
// back to "Its own patterns" brings them back unchanged.
//
// Follows Draw's shape (`draw.js`): `mfAt(k, time)` is called from both the
// live scheduler (`app.js`) and the offline render (`bridge.js`), `mfStop()`
// releases held notes on stop or pause, and `mfGetState()` / `mfSetState()`
// carry the state in presets (keeping only the path for a Stems song, and the
// notes in state for a file opened from the computer).

const MF_PARTS = [
  ["drums", "Drums"],
  ["bass", "Bass"],
  ["chord", "Chords"],
  ["melody", "Melody"],
  ["arp", "Arp"],
  ["drone", "Drone"],
  ["none", "Nothing"],
];

const MF_PART_KEYS = new Set(MF_PARTS.map((p) => p[0]));

const MF_FALLBACK_COLORS = [
  "--f-level",
  "--f-pitch",
  "--f-time",
  "--f-tone",
  "--f-space",
  "--f-attack",
];

const MF = {
  on: false,
  src: null,
  song: null,
  map: [],
  from: 0,
  to: 0,
  tempo: "file",
  end: "loop",
  pitch: "written",
};

let mfByStep = new Map();
let mfLastK = -2;
let mfLastI = 0;
let mfSeekOff = 0;
let mfAt16 = 0;
let mfStopped = false;
let mfCtx = null;
let mfVoices = [];
let mfStemsList = [];
let mfStatusMsg = "";
let mfStatusErr = false;
let mfFetchSeq = 0;

/// Default Band part for a 1-based MIDI channel.
function mfDefaultPart(ch) {
  if (ch === 10) return "drums";
  if (ch === 5) return "bass";
  if (ch === 6) return "chord";
  if (ch === 7) return "melody";
  if (ch === 8) return "arp";
  return "none";
}

/// Normalise a saved or UI part key to one of MF_PARTS.
function mfNormPart(v) {
  if (!v) return "none";
  const k = String(v).toLowerCase();
  if (k === "chords") return "chord";
  if (k === "nothing") return "none";
  return MF_PART_KEYS.has(k) ? k : "none";
}

/// General MIDI drum note to one of `DM_SLOTS` (`drums.js`).
function mfDrumSlot(note) {
  const n = Math.round(note);
  if (n === 36) return "kick";
  if (n === 38 || n === 40) return "snare";
  if (n === 39) return "clap";
  if (n === 37) return "rim";
  if (n === 42 || n === 44) return "chh";
  if (n === 46) return "ohh";
  if (n === 41 || n === 43 || n === 45) return "ltom";
  if (n === 47 || n === 48) return "mtom";
  if (n === 50) return "htom";
  return "perc";
}

/// Which CSS colour token represents a track on the list and on the roll.
function mfTrackToken(ch, idx) {
  if (ch === 10) return "--f-attack";
  if (ch === 5) return "--f-tone";
  if (ch === 6) return "--f-space";
  if (ch === 7) return "--f-pitch";
  if (ch === 8) return "--f-time";
  return MF_FALLBACK_COLORS[idx % MF_FALLBACK_COLORS.length];
}

function mfTokenColor(token, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || fallback;
}

function mfSongBars(song) {
  if (!song) return 0;
  let b = Math.round(+song.bars || 0);
  if (b > 0) return b;
  let last = 0;
  for (const p of song.parts || []) {
    for (const n of p.notes || []) {
      const end = n[0] * 16 + n[1] + n[2];
      if (end > last) last = end;
    }
  }
  return Math.max(1, Math.ceil(last / 16));
}

/// Sections derived from the file's markers, covering the whole song.
function mfSections(song) {
  if (!song || !Array.isArray(song.markers) || !song.markers.length) return [];
  const total = mfSongBars(song);
  const sorted = song.markers
    .map((m) => [Math.max(0, Math.min(total, Math.floor(+m[0] || 0))), String(m[1] || "")])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i][0];
    const end = i + 1 < sorted.length ? sorted[i + 1][0] : total;
    if (end > start) out.push({ label: sorted[i][1] || String(i + 1), start, end, bars: end - start });
  }
  return out;
}

/// Index all notes of `MF.song` once at load by `bar * 16 + floor(step)`.
function mfIndex() {
  mfByStep = new Map();
  if (!MF.song || !Array.isArray(MF.song.parts)) return;
  MF.song.parts.forEach((part, ti) => {
    for (const raw of part.notes || []) {
      const bar = raw[0] | 0;
      const step = +raw[1] || 0;
      const steps = Math.max(0.001, +raw[2] || 0.25);
      const note = +raw[3] || 60;
      const vel = Math.max(0.05, Math.min(1, +raw[4] || 0.8));
      const s0 = Math.floor(step);
      const frac = step - s0;
      const key = bar * 16 + s0;
      let list = mfByStep.get(key);
      if (!list) {
        list = [];
        mfByStep.set(key, list);
      }
      list.push({ ti, frac, steps, note, vel });
    }
  });
}

/// Load a parsed song JSON into `MF` and refresh the panel.
function mfLoadSong(song, src, opts = {}) {
  if (!song || !Array.isArray(song.parts)) return;
  const bars = mfSongBars(song);
  MF.song = {
    title: String(song.title || (src && (src.name || src.p)) || "MIDI file"),
    bpm: Number.isFinite(+song.bpm) && +song.bpm > 0 ? +song.bpm : 120,
    bars,
    markers: Array.isArray(song.markers) ? song.markers.map((m) => [m[0] | 0, String(m[1] || "")]) : [],
    parts: song.parts.map((p, i) => ({
      name: String(p.name || `Track ${i + 1}`),
      channel: p.channel | 0 || 1,
      notes: Array.isArray(p.notes) ? p.notes : [],
    })),
  };
  MF.src = src ? JSON.parse(JSON.stringify(src)) : null;
  const savedMap = Array.isArray(opts.map) ? opts.map : null;
  MF.map = MF.song.parts.map((p, i) => {
    if (savedMap && savedMap[i]) {
      return { to: mfNormPart(savedMap[i].to), on: savedMap[i].on !== false };
    }
    return { to: mfDefaultPart(p.channel), on: true };
  });
  const from = opts.from != null ? Math.max(0, Math.min(bars - 1, opts.from | 0)) : 0;
  const to = opts.to != null ? Math.max(from + 1, Math.min(bars, opts.to | 0)) : bars;
  MF.from = from;
  MF.to = to;
  mfSeekOff = 0;
  mfAt16 = MF.from * 16;
  mfStopped = false;
  mfLastK = -2;
  mfIndex();
  if (MF.on && MF.tempo === "file" && !opts.keepTempo) mfApplyTempo();
  mfPaint();
}

/// Apply the file's tempo to the Band's BPM slider and clock.
function mfApplyTempo() {
  if (!MF.song || !(MF.song.bpm > 0)) return;
  const v = Math.max(40, Math.min(240, Math.round(MF.song.bpm)));
  const sl = document.getElementById("bpmSlider");
  if (sl) {
    sl.value = String(v);
    if (window.updateKnobVisual) window.updateKnobVisual("bpmSlider");
  }
  if (typeof updateBPM === "function") updateBPM(v);
}

/// Frequency in Hz for a MIDI note at boundary `k`, written or snapped to the Band's scale.
function mfNoteHz(note, k) {
  const written = 440 * Math.pow(2, (note - 69) / 12);
  if (MF.pitch !== "scale" || typeof acScaleAt !== "function" || typeof acCents !== "function" || typeof acHz !== "function") {
    return written;
  }
  const sc = acScaleAt(k);
  const cents = sc && sc.cents;
  if (!cents || !cents.length) return written;
  const target = 1200 * Math.log2(written / rootHz);
  const n = cents.length;
  const oct = Math.floor(target / 1200);
  let bestD = oct * n;
  let bestErr = Infinity;
  for (let o = oct - 1; o <= oct + 1; o++) {
    for (let j = 0; j < n; j++) {
      const d = o * n + j;
      const err = Math.abs(acCents(cents, d) - target);
      if (err < bestErr) {
        bestErr = err;
        bestD = d;
      }
    }
  }
  return acHz(cents, bestD);
}

/// Destination node in the Band's mixer for a pitched part.
function mfDest(part) {
  const N = typeof bdNodes !== "undefined" ? bdNodes : null;
  if (part === "melody") return typeof filterNode !== "undefined" ? filterNode : null;
  if (!N) return null;
  if (part === "bass") return N.ch.Bas.in;
  if (part === "arp") return N.ch.Arp.in;
  if (part === "chord") return N.chordIn;
  if (part === "drone") return N.droneIn;
  return null;
}

/// Play one note through its mapped Band part's voice.
function mfVoice(part, h, t, dur, k, chordCount, chordIdx) {
  if (part === "drums") {
    if (typeof bandVoice === "function") {
      bandVoice({ part: "drum", slot: mfDrumSlot(h.note), vel: h.vel }, t);
    }
    return;
  }
  const c = audioCtx;
  const dest = mfDest(part);
  if (!c || !dest) return;
  const hz = mfNoteHz(h.note, k);
  const amp = c.createGain();
  amp.gain.value = h.vel;
  amp.connect(dest);
  mfVoices.push({ amp, start: t, end: t + dur + 4 });
  if (part === "melody") {
    const hold = dur / ((60 / bpm) * stepBeats * 0.85);
    if (typeof playClassic === "function") playClassic(hz, t, hold, { into: amp });
    if (typeof noteFilterEnv === "function") noteFilterEnv(hz, t, dur);
  } else if (part === "chord") {
    if (typeof bandVoice === "function") {
      bandVoice({ part: "chord", hz, dur, n: chordCount || 1, first: chordIdx === 0, into: amp }, t);
    }
  } else if (part === "drone") {
    const spb = 60 / bpm;
    const sw = 0.25 * Math.pow(32, ((typeof BAND !== "undefined" && BAND.drone.drSwell) || 60) / 100) * 4 * spb;
    if (typeof bandVoice === "function") {
      bandVoice({ part: "drone", hz, dur, into: amp, atk: Math.min(sw, dur * 0.4) }, t);
    }
  } else if (part === "bass" || part === "arp") {
    if (typeof bandVoice === "function") {
      bandVoice({ part, hz, dur, into: amp }, t);
    }
  }
}

/// Schedule all MIDI file notes falling in boundary `k`, at `time`.
/// Called from both `scheduler()` (`app.js`) and `scheduleUntil()` (`bridge.js`).
function mfAt(k, time) {
  if (!MF.on || !MF.song || !audioCtx) return;
  if (mfCtx !== audioCtx) {
    mfCtx = audioCtx;
    mfVoices = [];
    mfLastK = -2;
    mfStopped = false;
  }
  const jump = k !== mfLastK + 1;
  mfLastK = k;
  if (jump) {
    mfRelease(time);
    mfStopped = false;
  }
  const offline = typeof OfflineAudioContext !== "undefined" && audioCtx instanceof OfflineAudioContext;
  const from16 = MF.from * 16;
  const to16 = Math.max(from16 + 16, MF.to * 16);
  const span = to16 - from16;
  const spb = 60 / bpm;
  const stepS = 15 / bpm;
  const units = typeof acUnits === "function" ? acUnits(k, 0.25) : [];

  for (const i of units) {
    mfLastI = i;
    const pos = i + mfSeekOff;
    const offS = (i * 0.25 - k * stepBeats) * spb;
    let step16;
    if (MF.end === "stop") {
      if (pos >= span) {
        if (!offline && !mfStopped) {
          mfStopped = true;
          if (typeof isPlaying !== "undefined" && isPlaying && typeof stopSeq === "function") {
            const wait = Math.max(0, (time + offS - audioCtx.currentTime) * 1000);
            setTimeout(() => {
              if (typeof isPlaying !== "undefined" && isPlaying) stopSeq();
            }, wait);
          }
        }
        continue;
      }
      if (pos < 0) continue;
      step16 = from16 + pos;
    } else {
      step16 = from16 + (((pos % span) + span) % span);
    }

    const hits = mfByStep.get(step16);
    if (hits && hits.length) {
      let chordCount = 0;
      for (const h of hits) {
        const m = MF.map[h.ti];
        if (m && m.on && m.to === "chord") chordCount++;
      }
      let chordIdx = 0;
      for (const h of hits) {
        const m = MF.map[h.ti];
        if (!m || !m.on || !m.to || m.to === "none") continue;
        const t = time + offS + h.frac * stepS;
        const dur = Math.max(0.01, h.steps * stepS);
        const ci = m.to === "chord" ? chordIdx++ : 0;
        mfVoice(m.to, h, t, dur, k, chordCount, ci);
      }
    }

    if (!offline) {
      const s = step16;
      const wait = Math.max(0, (time + offS - audioCtx.currentTime) * 1000);
      setTimeout(() => {
        if (!MF.on) return;
        mfAt16 = s;
        mfPaintPos();
        mfDrawRoll();
      }, wait);
    }
  }
}

/// Fade out and cancel any notes the MIDI file player is holding, from `time`.
function mfRelease(time) {
  const c = audioCtx;
  if (!c) return;
  const t = Math.max(time, c.currentTime);
  for (const v of mfVoices) {
    if (v.end <= t) continue;
    const g = v.amp.gain;
    if (v.start >= t) {
      g.cancelScheduledValues(v.start);
      g.setValueAtTime(0, v.start);
    } else {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.03);
    }
    v.end = t + 0.3;
  }
  mfVoices = mfVoices.filter((v) => v.end > c.currentTime);
}

/// Transport stopped or paused: release held notes and reset the step tracker.
function mfStop() {
  mfLastK = -2;
  mfStopped = false;
  mfSeekOff = 0;
  mfAt16 = MF.from * 16;
  if (audioCtx && mfCtx === audioCtx) mfRelease(audioCtx.currentTime);
  mfPaintTransport();
  mfPaintPos();
  mfDrawRoll();
}

/// Whether the sequencer's own melody steps should rest (same hook shape as `drawStepsMuted`).
function mfStepsMuted() {
  return !!MF.on;
}

// ─── PRESET STATE ────────────────────────────────────────────────────────────
/// State kept in presets: Stems songs keep only their path; uploaded files keep their notes.
function mfGetState() {
  const out = {
    on: !!MF.on,
    src: MF.src ? JSON.parse(JSON.stringify(MF.src)) : null,
    map: MF.map.map((m) => ({ to: m.to, on: !!m.on })),
    from: MF.from | 0,
    to: MF.to | 0,
    tempo: MF.tempo,
    end: MF.end,
    pitch: MF.pitch,
  };
  if (MF.src && !MF.src.p && MF.song) {
    out.song = JSON.parse(JSON.stringify(MF.song));
  }
  return out;
}

/// Restore MIDI file state from a preset.
function mfSetState(s) {
  if (!s || typeof s !== "object") return;
  MF.on = !!s.on;
  MF.tempo = s.tempo === "band" ? "band" : "file";
  MF.end = s.end === "stop" ? "stop" : "loop";
  MF.pitch = s.pitch === "scale" ? "scale" : "written";
  const savedMap = Array.isArray(s.map) ? s.map : null;
  if (s.song && Array.isArray(s.song.parts)) {
    mfLoadSong(s.song, s.src || { name: s.song.title || "MIDI file" }, {
      map: savedMap,
      from: s.from,
      to: s.to,
      keepTempo: true,
    });
  } else if (s.src && s.src.p) {
    if (MF.song && MF.src && MF.src.p === s.src.p) {
      const bars = mfSongBars(MF.song);
      if (savedMap && savedMap.length === MF.song.parts.length) {
        MF.map = savedMap.map((m) => ({ to: mfNormPart(m.to), on: m.on !== false }));
      }
      MF.from = Math.max(0, Math.min(bars - 1, s.from | 0));
      MF.to = Math.max(MF.from + 1, Math.min(bars, (s.to | 0) || bars));
      mfAt16 = MF.from * 16;
    } else {
      MF.src = { p: String(s.src.p) };
      MF.song = null;
      MF.map = [];
      MF.from = 0;
      MF.to = 0;
      mfIndex();
      mfFetchStems(MF.src.p, { map: savedMap, from: s.from, to: s.to });
    }
  } else {
    MF.src = null;
    MF.song = null;
    MF.map = [];
    MF.from = 0;
    MF.to = 0;
    mfIndex();
  }
  mfSyncSourceUI();
  if (MF.on && MF.tempo === "file" && MF.song) mfApplyTempo();
  mfPaint();
}

// ─── SERVER CALLS ────────────────────────────────────────────────────────────
async function mfRefreshList() {
  try {
    const res = await fetch("/api/stems/list");
    if (!res.ok) return;
    const list = await res.json();
    if (Array.isArray(list)) {
      mfStemsList = list;
      mfPaintSongSelect();
    }
  } catch (e) {
    /* standalone or offline */
  }
}

async function mfFetchStems(p, opts = {}) {
  const seq = ++mfFetchSeq;
  mfStatusMsg = "";
  mfStatusErr = false;
  try {
    const res = await fetch(`/api/seq/midi?p=${encodeURIComponent(p)}`);
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (seq !== mfFetchSeq) return;
    if (!res.ok) {
      mfStatusMsg = data.error || `Could not load MIDI file (HTTP ${res.status})`;
      mfStatusErr = true;
      mfPaint();
      return;
    }
    mfStatusMsg = "";
    mfStatusErr = false;
    mfLoadSong(data, { p }, opts);
  } catch (e) {
    if (seq !== mfFetchSeq) return;
    mfStatusMsg = "Could not load MIDI file";
    mfStatusErr = true;
    mfPaint();
  }
}

async function mfUploadFile(file) {
  if (!file) return;
  const seq = ++mfFetchSeq;
  mfStatusMsg = `Reading ${file.name}…`;
  mfStatusErr = false;
  mfPaintStatus();
  try {
    const buf = await file.arrayBuffer();
    const res = await fetch("/api/seq/midi", {
      method: "POST",
      headers: { "Content-Type": "audio/midi" },
      body: buf,
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (seq !== mfFetchSeq) return;
    if (!res.ok) {
      mfStatusMsg = `${file.name}: ${data.error || `HTTP ${res.status}`}`;
      mfStatusErr = true;
      mfPaintStatus();
      return;
    }
    mfStatusMsg = file.name;
    mfStatusErr = false;
    mfLoadSong(data, { name: file.name });
  } catch (e) {
    if (seq !== mfFetchSeq) return;
    mfStatusMsg = `${file.name}: could not read file`;
    mfStatusErr = true;
    mfPaintStatus();
  }
}

// ─── THE PANEL ───────────────────────────────────────────────────────────────
function mfSetOn(on) {
  const next = !!on;
  if (MF.on === next) {
    mfSyncSourceUI();
    return;
  }
  MF.on = next;
  if (MF.on) {
    if (MF.tempo === "file" && MF.song) mfApplyTempo();
    mfRefreshList();
  } else {
    mfStop();
  }
  mfSyncSourceUI();
  mfPaint();
}

function mfSyncSourceUI() {
  const host = document.getElementById("accompanyHost");
  if (!host) return;
  host.classList.toggle("mf-on", !!MF.on);
  const seg = document.getElementById("mfSrcSeg");
  if (seg) {
    for (const b of seg.querySelectorAll("button")) {
      b.classList.toggle("on", (b.dataset.v === "midi") === !!MF.on);
    }
  }
  const panel = document.getElementById("mfPanel");
  if (panel) panel.style.display = MF.on ? "" : "none";
  // Dim and disable Style and Arrange while a MIDI file plays.
  for (const id of ["bdStyleSelect", "bdGenerate", "bdReroll", "bdArrangeSelect"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = !!MF.on;
    el.classList.toggle("mf-dim", !!MF.on);
    if (el.nextElementSibling && el.nextElementSibling.classList.contains("seg")) {
      el.nextElementSibling.classList.toggle("mf-dim", !!MF.on);
      for (const btn of el.nextElementSibling.querySelectorAll("button")) btn.disabled = !!MF.on;
    }
  }
  for (const cap of host.querySelectorAll(".mf-dim-cap")) {
    cap.classList.toggle("mf-dim", !!MF.on);
  }
}

function mfPaintSongSelect() {
  const sel = document.getElementById("mfSongSelect");
  if (!sel) return;
  const curP = MF.src && MF.src.p ? MF.src.p : "";
  const opts = ['<option value="">— choose a split song —</option>'];
  for (const s of mfStemsList) {
    const p = String(s.p || "");
    const name = String(s.name || p).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const ep = p.replace(/"/g, "&quot;");
    if (s.midi) {
      opts.push(`<option value="${ep}"${p === curP ? " selected" : ""}>${name} (from Stems)</option>`);
    } else {
      opts.push(`<option value="${ep}" disabled>${name} (no MIDI file written yet)</option>`);
    }
  }
  sel.innerHTML = opts.join("");
  if (curP) sel.value = curP;
}

function mfPaintStatus() {
  const el = document.getElementById("mfStatus");
  if (!el) return;
  el.textContent = mfStatusMsg || (MF.src && MF.src.name ? MF.src.name : "");
  el.classList.toggle("err", !!mfStatusErr);
  el.style.display = el.textContent ? "" : "none";
}

function mfPaintTracks() {
  const host = document.getElementById("mfTracks");
  if (!host) return;
  if (!MF.song || !MF.song.parts.length) {
    host.innerHTML = '<div class="mf-empty">No tracks loaded.</div>';
    return;
  }
  host.innerHTML = MF.song.parts
    .map((p, i) => {
      const m = MF.map[i] || { to: "none", on: false };
      const live = m.on && m.to !== "none";
      const tok = mfTrackToken(p.channel, i);
      const nm = p.name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const opts = MF_PARTS.map(([k, lbl]) => `<option value="${k}"${k === m.to ? " selected" : ""}>${lbl}</option>`).join("");
      return `<label class="mf-trk${live ? "" : " off"}" style="--c: var(${tok})">`
        + `<input type="checkbox" data-i="${i}"${m.on ? " checked" : ""} />`
        + `<i></i>`
        + `<span class="nm">${nm}<small>channel ${p.channel} · ${p.notes.length} notes</small></span>`
        + `<select class="mf-ctl" data-i="${i}">${opts}</select>`
        + `</label>`;
    })
    .join("");
}

function mfPaintPos() {
  const el = document.getElementById("mfPos");
  if (!el) return;
  const bar = Math.floor(mfAt16 / 16) + 1;
  el.textContent = `bar ${bar}`;
}

function mfPaintTransport() {
  const playing = typeof isPlaying !== "undefined" && !!isPlaying;
  const playBtn = document.getElementById("mfPlayBtn");
  const stopBtn = document.getElementById("mfStopBtn");
  if (playBtn) playBtn.disabled = playing;
  if (stopBtn) stopBtn.disabled = !playing;
}

function mfPaintSegs() {
  const paint = (id, val) => {
    const seg = document.getElementById(id);
    if (!seg) return;
    for (const b of seg.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === val);
  };
  paint("mfTempoSeg", MF.tempo);
  paint("mfEndSeg", MF.end);
  paint("mfPitchSeg", MF.pitch);
}

function mfDrawRoll() {
  const c = document.getElementById("mfRoll");
  if (!c) return;
  const r = window.devicePixelRatio || 1;
  const w = 730;
  const h = 430;
  if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) {
    c.width = Math.round(w * r);
    c.height = Math.round(h * r);
  }
  const g = c.getContext("2d");
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);

  const textCol = mfTokenColor("--look-text-2", "#b9bec6");
  const dimCol = mfTokenColor("--look-text-3", "#858b94");
  const lineCol = mfTokenColor("--look-line", "#2c3036");
  const onCol = mfTokenColor("--on", "#ffb547");

  if (!MF.song) {
    g.font = "11px 'JetBrains Mono', ui-monospace, monospace";
    g.fillStyle = dimCol;
    g.fillText("Choose a split song or open a .mid file", 20, h / 2);
    return;
  }

  const totalBars = mfSongBars(MF.song);
  const from = MF.from;
  const to = Math.max(from + 1, MF.to || totalBars);
  const bars = to - from;
  const x = (bar, st = 0) => ((bar - from + st / 16) / bars) * w;
  const TOP = 22;
  const DR = 70;
  const py0 = TOP + 8;
  const py1 = h - DR - 10;

  // Bar lines
  for (let b = from; b <= to; b++) {
    if (bars > 40 && b % 4) continue;
    g.globalAlpha = b % 4 ? 0.2 : 0.45;
    g.fillStyle = lineCol;
    g.fillRect(x(b), TOP, 1, h - TOP);
  }
  g.globalAlpha = 1;

  // Section strip along the top
  g.font = "10px 'JetBrains Mono', ui-monospace, monospace";
  const secs = mfSections(MF.song);
  for (const s of secs) {
    const a = Math.max(s.start, from);
    const e = Math.min(s.end, to);
    if (e <= a) continue;
    const sw = x(e) - x(a);
    g.globalAlpha = 0.45;
    g.fillStyle = lineCol;
    g.fillRect(x(a) + 1, 2, Math.max(1, sw - 2), TOP - 5);
    g.globalAlpha = 1;
    g.fillStyle = textCol;
    if (sw > 14) g.fillText(sw > 70 ? `${s.label} · bar ${s.start + 1}` : s.label, x(a) + 6, 14);
  }

  // Gather active notes inside [from, to)
  const pit = [];
  const drm = [];
  MF.song.parts.forEach((p, ti) => {
    const m = MF.map[ti];
    if (!m || !m.on || !m.to || m.to === "none") return;
    const col = mfTokenColor(mfTrackToken(p.channel, ti), "#c4c8d0");
    const isDrum = m.to === "drums";
    for (const n of p.notes) {
      if (n[0] < from || n[0] >= to) continue;
      if (isDrum) drm.push({ bar: n[0], step: n[1], note: n[3], vel: n[4], col });
      else pit.push({ bar: n[0], step: n[1], steps: n[2], note: n[3], vel: n[4], col, bass: m.to === "bass" });
    }
  });

  // Pitched notes
  let lo = 28;
  let hi = 60;
  for (const n of pit) {
    if (n.note < lo) lo = n.note;
    if (n.note > hi) hi = n.note;
  }
  const y = (m) => py1 - ((m - lo + 1) / (hi - lo + 2)) * (py1 - py0);
  for (const n of pit) {
    g.globalAlpha = n.bass ? 0.5 + 0.5 * n.vel : 0.45;
    g.fillStyle = n.col;
    const x0 = x(n.bar, n.step);
    const nw = Math.max(2, x(n.bar, n.step + n.steps) - x0 - 1);
    g.fillRect(x0, y(n.note) - 2, nw, 4);
  }

  // Drum lane (hat / snare / kick rows)
  g.globalAlpha = 1;
  g.fillStyle = dimCol;
  ["hat", "snare", "kick"].forEach((nm, i) => g.fillText(nm, 4, h - DR + 14 + i * 22));
  const stepW = Math.max(2, w / bars / 16 - 1);
  for (const n of drm) {
    const slot = mfDrumSlot(n.note);
    const row = slot === "chh" || slot === "ohh" ? 0 : slot === "snare" || slot === "clap" || slot === "rim" ? 1 : 2;
    g.globalAlpha = 0.35 + 0.65 * n.vel;
    g.fillStyle = n.col;
    g.fillRect(x(n.bar, n.step), h - DR + 4 + row * 22, stepW, 13);
  }
  g.globalAlpha = 1;

  // Playhead
  const playing = typeof isPlaying !== "undefined" && !!isPlaying;
  if (playing || mfAt16 > from * 16) {
    g.fillStyle = onCol;
    g.fillRect(x(0, mfAt16), TOP, 2, h - TOP);
  }
}

function mfPaint() {
  mfPaintSongSelect();
  mfPaintStatus();
  mfPaintTracks();
  mfPaintPos();
  mfPaintTransport();
  mfPaintSegs();
  mfDrawRoll();

  const facts = document.getElementById("mfFacts");
  if (facts) {
    facts.textContent = MF.song
      ? `${MF.song.bpm.toFixed(1)} bpm · ${mfSongBars(MF.song)} bars · ${MF.song.parts.length} tracks`
      : "no file loaded";
  }
  const spanEl = document.getElementById("mfSpan");
  const wholeBtn = document.getElementById("mfWholeBtn");
  if (MF.song) {
    const total = mfSongBars(MF.song);
    const whole = MF.from === 0 && MF.to === total;
    if (spanEl) spanEl.textContent = whole ? `bars 1 to ${total}` : `bars ${MF.from + 1} to ${MF.to}, going round`;
    if (wholeBtn) wholeBtn.disabled = whole;
  } else {
    if (spanEl) spanEl.textContent = "";
    if (wholeBtn) wholeBtn.disabled = true;
  }
  const tempoHint = document.getElementById("mfTempoHint");
  if (tempoHint) {
    tempoHint.textContent = MF.tempo === "file"
      ? (MF.song ? `The Band's tempo goes to the file's, ${MF.song.bpm.toFixed(1)} bpm.` : "The Band's tempo goes to the file's when one loads.")
      : `The file is played at whatever the Band is set to (here ${Math.round(typeof bpm !== "undefined" ? bpm : 120)} bpm).`;
  }
  const pitchHint = document.getElementById("mfPitchHint");
  if (pitchHint) {
    pitchHint.textContent = MF.pitch === "written"
      ? "Twelve notes to the octave, as in the file."
      : "Each note moves to the nearest note of the Band's scale and root, in its own tuning.";
  }
}

/// Build the Band's MIDI file panel below the Band's header and wire all events.
function mfBuildUI() {
  const host = document.getElementById("accompanyHost");
  if (!host || document.getElementById("mfPanel")) return;
  const ph = host.querySelector(".ph");
  if (!ph) return;

  // Tag Style & Arrange labels in the Band's header so they dim when a MIDI file plays.
  for (const cap of ph.querySelectorAll(".cap")) {
    const txt = cap.textContent.trim();
    if (txt === "Style" || txt === "Arrange") cap.classList.add("mf-dim-cap");
  }

  // Insert the "Plays: Its own patterns | A MIDI file" switch in the Band's header.
  const playsCap = document.createElement("span");
  playsCap.className = "cap";
  playsCap.textContent = "Plays";
  const srcSeg = document.createElement("span");
  srcSeg.className = "seg mf-src";
  srcSeg.id = "mfSrcSeg";
  srcSeg.innerHTML = '<button type="button" class="on" data-v="own">Its own patterns</button><button type="button" data-v="midi">A MIDI file</button>';
  const grow = ph.querySelector(".grow");
  if (grow) {
    ph.insertBefore(playsCap, grow);
    ph.insertBefore(srcSeg, grow);
  } else {
    ph.append(playsCap, srcSeg);
  }

  // Build the fixed-size panel (1496 wide: 420 / 752 / 308, 520 tall, roll 730 x 430).
  const panel = document.createElement("div");
  panel.className = "mf-panel";
  panel.id = "mfPanel";
  panel.style.display = "none";
  panel.innerHTML = `<div class="mf-body">`
    + `<div class="panel mf-col"><h3 class="mf-h">The file <span class="mf-sub" id="mfFacts">no file loaded</span></h3>`
    + `<div class="mf-row"><select class="mf-ctl mf-grow" id="mfSongSelect"><option value="">— choose a split song —</option></select>`
    + `<button type="button" class="mf-btn" id="mfOpenBtn">Open a file…</button>`
    + `<input type="file" id="mfFileInput" accept=".mid,.midi" class="at-hidden" /></div>`
    + `<div class="mf-status" id="mfStatus" style="display:none"></div>`
    + `<div class="mf-lab">Its tracks, and the part that plays each</div>`
    + `<div class="mf-tracks" id="mfTracks"></div>`
    + `<p class="mf-hint">Each track goes to a Band part by its channel, and you can send it to another. The part plays it through its own sound, its mixer channel and its sends.</p>`
    + `</div>`
    + `<div class="panel mf-col"><h3 class="mf-h">The notes <span class="mf-sub" id="mfSpan"></span><span class="grow"></span><button type="button" class="mf-btn" id="mfWholeBtn" disabled>Whole song</button></h3>`
    + `<canvas id="mfRoll" width="730" height="430"></canvas>`
    + `<p class="mf-hint">Click a section along the top to play only that; click in the notes to start from there.</p>`
    + `</div>`
    + `<div class="panel mf-col"><h3 class="mf-h">Play it</h3>`
    + `<div class="mf-row"><button type="button" class="mf-btn mf-big on" id="mfPlayBtn">▶ Play</button><button type="button" class="mf-btn mf-big" id="mfStopBtn" disabled>Stop</button><span class="mf-pos" id="mfPos">bar 1</span></div>`
    + `<div class="mf-lab">Tempo</div><span class="mf-seg" id="mfTempoSeg"><button type="button" class="on" data-v="file">The file's</button><button type="button" data-v="band">The Band's</button></span>`
    + `<p class="mf-hint" id="mfTempoHint"></p>`
    + `<div class="mf-lab">At the end</div><span class="mf-seg" id="mfEndSeg"><button type="button" class="on" data-v="loop">Go round</button><button type="button" data-v="stop">Stop</button></span>`
    + `<div class="mf-lab">Pitch</div><span class="mf-seg" id="mfPitchSeg"><button type="button" class="on" data-v="written">As written</button><button type="button" data-v="scale">The Band's scale</button></span>`
    + `<p class="mf-hint" id="mfPitchHint"></p>`
    + `<span class="grow"></span>`
    + `<p class="mf-hint">While a MIDI file plays, the parts' own patterns, Style and Arrange rest. The sounds, the mixer, the effects and the recorder work as always. "Its own patterns" brings them back as they were.</p>`
    + `</div>`
    + `</div>`;
  ph.after(panel);

  // Wire header switch
  srcSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    mfSetOn(b.dataset.v === "midi");
  });

  // Wire Stems song select and file picker
  document.getElementById("mfSongSelect").addEventListener("change", (e) => {
    const p = e.target.value;
    if (p) mfFetchStems(p);
  });
  const fileInput = document.getElementById("mfFileInput");
  document.getElementById("mfOpenBtn").addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) mfUploadFile(f);
  });

  // Wire track list checkboxes and part selects
  document.getElementById("mfTracks").addEventListener("change", (e) => {
    const idx = e.target.dataset.i;
    if (idx == null || !MF.map[+idx]) return;
    if (e.target.type === "checkbox") MF.map[+idx].on = e.target.checked;
    else MF.map[+idx].to = mfNormPart(e.target.value);
    mfPaint();
  });

  // Wire Play / Stop
  document.getElementById("mfPlayBtn").addEventListener("click", () => {
    if (typeof isPlaying !== "undefined" && !isPlaying && typeof togglePlay === "function") togglePlay();
    mfPaintTransport();
  });
  document.getElementById("mfStopBtn").addEventListener("click", () => {
    if (typeof stopSeq === "function") stopSeq();
    mfPaintTransport();
  });

  // Wire Tempo / End / Pitch segmented controls
  for (const [id, key] of [["mfTempoSeg", "tempo"], ["mfEndSeg", "end"], ["mfPitchSeg", "pitch"]]) {
    document.getElementById(id).addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      MF[key] = b.dataset.v;
      if (key === "tempo" && MF.tempo === "file" && MF.on && MF.song) mfApplyTempo();
      mfPaint();
    });
  }

  // Wire Roll click (top strip selects section; notes area seeks to clicked bar)
  document.getElementById("mfRoll").addEventListener("click", (e) => {
    if (!MF.song) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const total = mfSongBars(MF.song);
    const from = MF.from;
    const to = Math.max(from + 1, MF.to || total);
    const bar = from + ((e.clientX - rect.left) / rect.width) * (to - from);
    const playing = typeof isPlaying !== "undefined" && !!isPlaying;
    if (e.clientY - rect.top <= 22) {
      const sec = mfSections(MF.song).find((s) => bar >= s.start && bar < s.end);
      if (!sec) return;
      MF.from = sec.start;
      MF.to = sec.end;
      mfSeekOff = playing ? -(mfLastI + 1) : 0;
      mfAt16 = MF.from * 16;
      mfStopped = false;
      if (playing && audioCtx) mfRelease(audioCtx.currentTime);
    } else {
      const targetBar = Math.max(from, Math.min(to - 1, Math.floor(bar)));
      const targetOff = (targetBar - from) * 16;
      mfSeekOff = playing ? targetOff - (mfLastI + 1) : targetOff;
      mfAt16 = targetBar * 16;
      mfStopped = false;
      if (playing && audioCtx) mfRelease(audioCtx.currentTime);
    }
    mfPaint();
  });

  // Wire Whole song button
  document.getElementById("mfWholeBtn").addEventListener("click", () => {
    if (!MF.song) return;
    MF.from = 0;
    MF.to = mfSongBars(MF.song);
    const playing = typeof isPlaying !== "undefined" && !!isPlaying;
    mfSeekOff = playing ? -(mfLastI + 1) : 0;
    mfAt16 = 0;
    mfStopped = false;
    if (playing && audioCtx) mfRelease(audioCtx.currentTime);
    mfPaint();
  });

  mfSyncSourceUI();
  mfPaint();
  mfRefreshList();
}

mfBuildUI();
