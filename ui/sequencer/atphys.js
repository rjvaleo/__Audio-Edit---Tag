// Atmosphere's physically modelled voice, the page's side (ours, 17 Nov 2026).
// RJ: "its oscillators should be physically modeled" and "builds all of the
// modeled instruments". Plan: WORK DIR/page-mockups/ATMOS-PHYS-PLAN.md.
//
// The voice — two oscillators, each one of ten models (atmos.js, AT_MODELS),
// their blend, unison, sub, air, glide and drift; its own filter and envelope;
// the Amp; its three LFOs — runs in an AudioWorklet (`atmos-worklet.js`) as
// the Rust engine `core/crates/atmos`, built for the browser (`atmos.wasm`).
// What it makes goes on through Character, Sympathy and the FX line, as
// before. Its keys and its MIDI channel play it (keys.js); every control on
// the page is sent to it when it moves (`atphysSend`).

const ATPHYS = {
  bytes: null, // the module, fetched once
  node: null, // the worklet on the current context
  ready: false,
  sent: {}, // what the engine was last told
  view: { a: null, b: null },
  age: 0,
};

function atphysBytes() {
  if (!ATPHYS.bytesP) ATPHYS.bytesP = fetch("atmos.wasm").then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (ATPHYS.bytes = b)).catch(() => null);
  return ATPHYS.bytesP;
}

/// The engine on this context, into `into` (Character's input). An offline
/// context (a film's render) is not given one yet.
function atphysAttach(c, into) {
  if (!c.audioWorklet || typeof AudioWorkletNode === "undefined" || c instanceof OfflineAudioContext) return;
  ATPHYS.ready = false;
  const up = c.__atphys || (c.__atphys = c.audioWorklet.addModule("atmos-worklet.js"));
  Promise.all([up, atphysBytes()]).then(([, bytes]) => {
    if (!bytes || audioCtx !== c) return;
    const node = new AudioWorkletNode(c, "atmos-voice", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === "view") { ATPHYS.view = m; ATPHYS.age = performance.now(); }
      else if (m.t === "ready") ATPHYS.ready = true;
      else if (m.t === "error") console.warn("atmos:", m.text);
    };
    node.port.postMessage({ t: "wasm", bytes: bytes.slice(0) });
    node.connect(into);
    ATPHYS.node = node;
    ATPHYS.sent = {};
    atphysSend(true);
  }).catch((e) => console.warn("atmos:", e));
}

/// Is it up, to be played?
function atphysUp() {
  return !!(ATPHYS.node && audioCtx && ATPHYS.node.context === audioCtx);
}

const atLfoShape = { sine: 0, triangle: 1, sawtooth: 2, square: 3 };

/// Every control as the engine takes it.
function atphysParams() {
  const v = (id, d = 0) => (AT[id] ?? d);
  const sel = (id, d) => document.getElementById(id)?.value ?? d;
  const kv = {};
  for (const w of ["A", "B"]) {
    const o = w.toLowerCase();
    kv[`${o}.model`] = Math.max(0, AT_MODELS.findIndex((m) => m.id === AT["model" + w]));
    for (let i = 1; i <= 4; i++) kv[`${o}.p${i - 1}`] = v(`atM${w}${i}`) / 100;
    kv[`${o}.oct`] = v(`at${w}Oct`);
    kv[`${o}.fine`] = v(`atM${w}Fine`);
  }
  kv.blend = v("atBlend", 40) / 100;
  kv.unison = Math.min(3, v("atUnison", 1));
  kv.detune = v("atDetune", 18);
  kv.width = v("atWidth", 80) / 100;
  kv.drift = v("atDrift", 35) / 100;
  kv.sub = v("atSub") / 100;
  kv.air = v("atAir") / 100;
  kv.glide = v("atGlide") <= 0 ? 0 : atExp(v("atGlide"), 5, 2000) / 1000;
  kv.atk = atExp(v("atAtk", 74), 1, 10000) / 1000;
  kv.dec = atExp(v("atDec", 70), 1, 10000) / 1000;
  kv.sus = v("atSus", 80) / 100;
  kv.rel = atExp(v("atRel", 78), 10, 20000) / 1000;
  kv.vol = v("atVol", 70) / 100;
  kv["flt.type"] = Math.round(v("atFltType"));
  kv["flt.cut"] = atFltHz(v("atFltCut", 100));
  kv["flt.q"] = atFltQ(v("atFltRes", 10));
  kv["flt.key"] = v("atFltKey") / 100;
  kv["flt.amt"] = v("atFltAmt") / 100;
  kv["flt.atk"] = atExp(v("atFltAtk", 40), 1, 10000) / 1000;
  kv["flt.dec"] = atExp(v("atFltDec", 60), 1, 10000) / 1000;
  kv["flt.sus"] = v("atFltSus", 50) / 100;
  kv["flt.rel"] = atExp(v("atFltRel", 70), 10, 20000) / 1000;
  for (const n of [1, 2, 3]) {
    kv[`lfo${n}.shape`] = atLfoShape[sel(`atL${n}ShapeSelect`, "sine")] ?? 0;
    kv[`lfo${n}.rate`] = atLfoHz(v(`atL${n}Rate`, 40));
    kv[`lfo${n}.depth`] = v(`atL${n}Depth`) / 100;
    kv[`lfo${n}.target`] = Math.max(0, AT_LFO_TARGETS.findIndex(([t]) => t === sel(`atL${n}TargetSelect`, "")));
  }
  return kv;
}

/// Tell the engine what has moved since it was last told (all of it, `full`),
/// and its scale.
function atphysSend(full = false) {
  if (!ATPHYS.node) return;
  const kv = atphysParams(), diff = {};
  for (const [k, x] of Object.entries(kv)) if (full || ATPHYS.sent[k] !== x) { diff[k] = x; ATPHYS.sent[k] = x; }
  if (Object.keys(diff).length) ATPHYS.node.port.postMessage({ t: "set", kv: diff });
  const cents = typeof atScale === "function" ? atScale().cents : [0];
  const ck = cents.join(",");
  if (full || ATPHYS.scale !== ck) { ATPHYS.scale = ck; ATPHYS.node.port.postMessage({ t: "scale", cents }); }
}

/// A key down: a voice of the engine, let go by `release(at)`.
function atphysOn(id, hz, vel) {
  if (!atphysUp()) return null;
  atphysSend();
  const n = ATPHYS.node;
  n.port.postMessage({ t: "on", id, hz, vel, at: audioCtx.currentTime });
  return { release(at) { n.port.postMessage({ t: "off", id, at }); } };
}

// ─── THE PICTURES ────────────────────────────────────────────────────────────
// Each oscillator's model as it runs: a string's shape along its length, a
// bar's, bell's, glass's or drumhead's modes ringing, the air in a pipe or a
// reed's bore, the glottis's cycle. Drawn from the engine, not a loop.
function atphysDraw() {
  for (const w of ["A", "B"]) {
    const cv = document.getElementById(`atPic${w}`);
    if (!cv || !cv.getClientRects().length) continue;
    const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    const g = cv.getContext("2d"), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const fam = w === "A" ? "--f-pitch" : "--f-tone";
    g.strokeStyle = g.fillStyle = getComputedStyle(document.body).getPropertyValue(fam).trim() || "#a99be0";
    g.lineWidth = 2 * d;
    const model = AT_MODELS.find((m) => m.id === AT["model" + w]) || AT_MODELS[0];
    const live = performance.now() - ATPHYS.age < 300 ? ATPHYS.view[w.toLowerCase()] : null;
    const v = live && AT_MODELS[live.m]?.id === model.id ? live.v : null;
    const id = model.id;
    if (["pluck", "bow", "pipe", "reed"].includes(id)) {
      // The waveguide, end to end: the string's or the bore's shape now.
      const pk = v ? Math.max(1e-4, ...v.map(Math.abs)) : 1;
      g.beginPath();
      for (let i = 0; i < 32; i++) {
        const x = (i / 31) * (W - 16 * d) + 8 * d, y = v ? (v[i] / pk) * H * 0.38 * Math.min(1, pk * 30) : 0;
        if (i) g.lineTo(x, H / 2 - y); else g.moveTo(x, H / 2 - y);
      }
      g.stroke();
      g.globalAlpha = 0.35;
      if (id === "pipe" || id === "reed") g.strokeRect(6 * d, H * 0.18, W - 12 * d, H * 0.64);
      else { g.fillRect(4 * d, H * 0.2, 2 * d, H * 0.6); g.fillRect(W - 6 * d, H * 0.2, 2 * d, H * 0.6); }
      g.globalAlpha = 1;
    } else if (["bar", "bell", "glass", "membrane"].includes(id)) {
      // Each mode at its ratio across, its level up.
      const ratios = v ? v.slice(16, 26).filter((x) => x > 0) : [1, 2, 3, 4];
      const mx = Math.max(...ratios, 1);
      ratios.forEach((q, k) => {
        const x = 10 * d + (W - 20 * d) * (Math.log2(q * 2) / Math.log2(mx * 2));
        const lv = v ? Math.min(1, Math.sqrt(v[k]) * 3) : 0.04;
        g.fillRect(x - 3 * d, H - 6 * d - lv * (H - 14 * d), 6 * d, Math.max(d, lv * (H - 14 * d)));
      });
      g.globalAlpha = 0.35; g.fillRect(6 * d, H - 6 * d, W - 12 * d, d); g.globalAlpha = 1;
    } else {
      // The voice's and the analog waves' cycle.
      g.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const u = (x / W) * 3;
        const s = id === "voice" ? Math.max(0, Math.sin(Math.PI * (u % 1) / 0.6)) ** 2 * ((u % 1) < 0.6 ? 1 : 0) - 0.3 : Math.sin(u * 2 * Math.PI);
        g.lineTo(x, H / 2 - s * H * 0.3 * (v ? 1 : 0.4));
      }
      g.stroke();
    }
  }
  requestAnimationFrame(atphysDraw);
}
requestAnimationFrame(atphysDraw);
