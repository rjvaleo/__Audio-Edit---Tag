// The scopes (ours, 14 Nov 2026). RJ: "I want to see each individual
// oscillator's waveform and then the combined waveform for the output."
//
// Four, each an AnalyserNode on the page's context:
// - **Classic**: every Classic note's voice, after its envelope;
// - **A** and **B**: Atmosphere's two oscillators, each before the blend
//   meets the envelope, so each shows only its own sound;
// - **Output**: the two synths together, after the filter, the delay and
//   Space: what leaves the page.
// A note's nodes reach a scope by an extra connection out of them
// (`scopeTap`), never into them, so a scope keeps no finished note alive.
// The scopes run into a silent gain, so the context keeps pulling them.
//
// Drawn on each frame: from a rising zero crossing, three periods of the
// note last played, scaled to fill the well. Silent, a scope keeps the last
// thing it showed, dimmed; before anything has played, the shape the
// oscillator is set to.

let scopeNodes = null;
let scopeFreq = 220;

/// Called by `initAudio` (app.js), on whatever context it has just made.
function scopesInit() {
  const c = audioCtx;
  if (!c || !masterGain) return;
  const mk = () => {
    const a = c.createAnalyser();
    a.fftSize = 2048;
    a.smoothingTimeConstant = 0;
    return a;
  };
  const sink = c.createGain();
  sink.gain.value = 0;
  sink.connect(c.destination);
  scopeNodes = { classic: mk(), A: mk(), B: mk(), out: mk(), sink, buf: new Float32Array(2048) };
  for (const k of ["classic", "A", "B", "out"]) scopeNodes[k].connect(sink);
  masterGain.connect(scopeNodes.out);
}

/// Let a scope hear `node`, when both are on the same context.
function scopeTap(which, node) {
  if (scopeNodes && scopeNodes[which] && scopeNodes[which].context === node.context) node.connect(scopeNodes[which]);
}

/// The frequency the scopes frame their window by: the note last played.
function scopeNote(freq) {
  if (freq > 0) scopeFreq = freq;
}

// ─── DRAWING ─────────────────────────────────────────────────────────────────
const SCOPES = [
  ["scopeClassic", "classic", "attack"],
  ["scopeA", "A", "pitch"],
  ["scopeB", "B", "tone"],
  ["scopeOut", "out", "on"],
];
const scopeLast = {};

/// Three periods from a rising zero crossing, scaled to ±1; null when silent.
function scopeWindow(an) {
  const buf = scopeNodes.buf;
  an.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak < 0.0015) return null;
  const n = Math.max(64, Math.min(1024, Math.round((3 * audioCtx.sampleRate) / scopeFreq)));
  let start = 0;
  for (let i = 1; i < buf.length - n; i++) if (buf[i - 1] <= 0 && buf[i] > 0) { start = i; break; }
  const out = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(buf[start + i]));
  for (let i = 0; i < n; i++) out[i] = buf[start + i] / (p || 1);
  return out;
}

/// What an oscillator is set to, before it has played: three periods.
function scopeShape(which) {
  const n = 240, out = new Float32Array(n);
  let wave = null, pw = 0.5;
  if (which === "classic") { wave = typeof waveType !== "undefined" ? waveType : "sine"; pw = typeof currentPW !== "undefined" ? currentPW : 0.5; }
  else if (which === "A" || which === "B") {
    const kind = typeof AT !== "undefined" ? AT["kind" + which] : "classic";
    if (kind === "classic") wave = ["sine", "triangle", "sawtooth", "square"][Math.round((AT[`at${which}1`] || 0) / 100 * 3)];
    else if (kind === "supersaw") wave = "sawtooth";
    else return null; // the rest are best seen played
  } else return null;
  for (let i = 0; i < n; i++) {
    const ph = ((i / n) * 3) % 1;
    out[i] = wave === "sine" ? Math.sin(ph * 2 * Math.PI)
      : wave === "triangle" ? (ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4)
      : wave === "sawtooth" ? 2 * ph - 1
      : wave === "square" ? (ph < 0.5 ? 1 : -1)
      : (ph < pw ? 1 : -1); // pulse
  }
  return out;
}

function scopeDraw(cv, data, ink, live, note) {
  const dpr = window.devicePixelRatio || 1, w = cv.offsetWidth, h = cv.offsetHeight;
  if (w > 0 && cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d"), W = cv.width, H = cv.height;
  const col = (a) => (typeof seqInk === "function" ? seqInk(ink, a) : "#aaa");
  g.clearRect(0, 0, W, H);
  g.fillStyle = typeof seqInk === "function" ? seqInk("line") : "#333";
  g.fillRect(0, Math.round(H / 2), W, 1);
  if (data) {
    const mid = H / 2, amp = H * 0.4;
    g.beginPath();
    for (let x = 0; x < W; x++) {
      const v = data[Math.min(data.length - 1, Math.floor((x / W) * data.length))];
      x ? g.lineTo(x, mid - v * amp) : g.moveTo(x, mid - v * amp);
    }
    g.strokeStyle = col(live ? 1 : 0.45);
    g.lineWidth = 1.5 * dpr;
    g.stroke();
  }
  if (note) {
    g.font = `500 ${9 * dpr}px ui-monospace, Menlo, monospace`;
    g.fillStyle = typeof seqInk === "function" ? seqInk("dim") : "#888";
    g.fillText(note, 5 * dpr, H - 5 * dpr);
  }
}

function scopesFrame() {
  const running = scopeNodes && audioCtx && audioCtx.state === "running" && scopeNodes.out.context === audioCtx;
  for (const [id, which, ink] of SCOPES) {
    const cv = document.getElementById(id);
    if (!cv || !cv.offsetParent) continue; // folded away
    const live = running ? scopeWindow(scopeNodes[which]) : null;
    if (live) scopeLast[id] = live;
    const data = live || scopeLast[id] || scopeShape(which);
    const note = live ? "" : scopeLast[id] ? "last heard" : data ? "as set" : "plays when a note sounds";
    scopeDraw(cv, data, ink, !!live, note);
  }
  requestAnimationFrame(scopesFrame);
}
requestAnimationFrame(scopesFrame);
