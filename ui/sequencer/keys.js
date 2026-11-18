// Keys and MIDI for the sequencer's synths (ours, 14 Nov 2026). RJ: "The
// atmosphere synth should have a MIDI keyboard on it and respond to its own
// MIDI channel" and "each item gets its own midi channel". Then: "The
// atmosphere synth should be a completely separate synth from the scale
// sequencer … its own keyboard … I shouldn't have to turn it on."
//
// **Held notes.** A key, on the screen or on a MIDI keyboard, sounds for as
// long as it is down: Atmosphere's voice (atmos.js, `atmosPlay`) is started
// long and let go on release with its own Release; Classic gets a held voice
// of its own here, its wave and ADSR as on a step. Both take the velocity.
// The shared filter's envelope runs as it does for one step.
//
// **The pitch** is the key strip's and the 88 keys' (`compute88Notes`): every
// key is the scale's nearest degree in its true tuning, so a maqam keyboard
// plays the maqam.
//
// **MIDI** arrives on the server (`midi.rs`), which keeps each part's channel
// and queues what comes in on it; this page asks for it with a long poll
// (`/api/engine/midi/events`), answered the moment a note lands. Atmosphere is
// on 3 and Classic on 4 until they are changed, each in its own panel; the
// choice is kept in this browser (`midiChannel.<part>`, as Wave's and Grain's
// are) and sent to the server. Atmosphere's keys and MIDI always play it: its
// switch is only whether the sequencer's steps play it too. Classic, which
// has no keys of its own here, is silent to MIDI while it is off. The Band's parts have channels on the server
// already (5 to 8, drums on 10); nothing here plays them yet.

const KY_PARTS = { atmos: 3, classic: 4 };
const KY = {
  held: new Map(), // "part:key" -> a voice to let go
  oct: 2, // the strip's lowest C: C2, five octaves up to C7 (RJ, 16 Nov: "2 to 3 times as many keys")
  n: null, // the last MIDI event seen; none yet is "from now"
  polling: false,
};

function kyChannel(part) {
  try {
    const v = +localStorage.getItem(`midiChannel.${part}`);
    if (v >= 1 && v <= 16) return v;
  } catch {}
  return KY_PARTS[part];
}

function kySendChannels() {
  const body = {};
  for (const p of Object.keys(KY_PARTS)) body[p] = kyChannel(p);
  return fetch("/api/engine/midi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

function kyPickerHtml(part) {
  const name = part === "atmos" ? "Atmosphere" : "Classic";
  return `<select class="ky-midi" id="kyMidi_${part}" title="MIDI channel: ${name} plays what arrives on this channel, and nothing else does unless it is set to the same one">`
    + Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">MIDI ${i + 1}</option>`).join("") + `</select>`;
}

function kyWirePicker(part) {
  const el = document.getElementById(`kyMidi_${part}`);
  if (!el) return;
  el.value = String(kyChannel(part));
  el.onchange = () => {
    try { localStorage.setItem(`midiChannel.${part}`, el.value); } catch {}
    kySendChannels();
    el.blur();
  };
}

/// The true pitch of MIDI key `k` in the scale, as the 88 keys have it.
function kyHz(k) {
  const n = compute88Notes().find((x) => x.midi === k);
  return n ? n.hz : 440 * Math.pow(2, (k - 69) / 12);
}

/// Classic, held: its wave and ADSR, until `release(t)`.
function kyClassicOn(freq, vel) {
  const c = audioCtx, t = c.currentTime;
  const osc = c.createOscillator(), env = c.createGain();
  if (waveType === "pulse") osc.setPeriodicWave(buildPulseWave(currentPW));
  else osc.type = waveType;
  osc.frequency.value = freq;
  osc.connect(env);
  env.connect(filterNode);
  if (typeof scopeTap === "function") scopeTap("classic", env);
  const a = adsr.a / 1000, d = adsr.d / 1000, s = adsr.s, r = adsr.r / 1000;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(vel, t + a);
  env.gain.linearRampToValueAtTime(s * vel, t + a + d);
  osc.start(t);
  return {
    release(at) {
      env.gain.cancelScheduledValues(at);
      if (env.gain.cancelAndHoldAtTime) env.gain.cancelAndHoldAtTime(at);
      else env.gain.setValueAtTime(env.gain.value, at);
      env.gain.linearRampToValueAtTime(0, at + Math.max(0.005, r));
      try { osc.stop(at + r + 0.05); } catch {}
    },
  };
}

/// Atmosphere, held: a long note, let go with its own Release. Its
/// physically modelled voice when it is up (atphys.js); the browser voice until then.
function kyAtmosOn(freq, vel, key) {
  if (typeof atphysOn === "function") { const v = atphysOn(key, freq, vel); if (v) return v; }
  const c = audioCtx, t = c.currentTime;
  const v = atmosPlay(freq, t, 3600, { gain: vel });
  if (!v) return null;
  return {
    release(at) {
      const r = atExp(AT.atRel, 10, 20000) / 1000;
      v.env.gain.cancelScheduledValues(at);
      if (v.env.gain.cancelAndHoldAtTime) v.env.gain.cancelAndHoldAtTime(at);
      v.env.gain.setTargetAtTime(0, at, Math.max(0.004, r / 5));
      v.end = at + r * 1.25 + 0.05;
      for (const s of v.srcs) { try { s.stop(v.end); } catch {} }
    },
  };
}

// Atmosphere is an instrument of its own, played whether or not the steps use it.
const kyOn = (part) => (part === "atmos" ? true : classicOn);

/// A key down for `part`, from the strip or from MIDI.
function kyNoteOn(part, key, vel = 0.8) {
  if (!kyOn(part)) return false;
  initAudio();
  if (!audioCtx) return false;
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  kyNoteOff(part, key);
  // Atmosphere in its own tuning (atmos.js, `atKeyHz`), Seq's synth in Seq's.
  const hz = part === "atmos" && typeof atKeyHz === "function" ? atKeyHz(key) : kyHz(key);
  const voice = part === "atmos" ? kyAtmosOn(hz, vel, key) : kyClassicOn(hz, vel);
  if (!voice) return false;
  if (typeof scopeNote === "function") scopeNote(hz);
  // Seq's filter envelope is Seq's synth's: Atmosphere has a filter of its own.
  if (part !== "atmos") noteFilterEnv(hz, audioCtx.currentTime, (60 / bpm) * stepBeats);
  KY.held.set(`${part}:${key}`, voice);
  kyPaintKeys();
  return true;
}

function kyNoteOff(part, key) {
  const id = `${part}:${key}`, v = KY.held.get(id);
  if (!v) return;
  KY.held.delete(id);
  v.release(audioCtx.currentTime);
  kyPaintKeys();
}

function kyAllOff(part) {
  for (const id of [...KY.held.keys()]) if (!part || id.startsWith(part + ":")) kyNoteOff(id.split(":")[0], +id.split(":")[1]);
}

// ─── THE STRIP ───────────────────────────────────────────────────────────────
// Five octaves from a C (61 keys), on Atmosphere's page, laid as a piano: the
// white keys side by side, the black ones over them. Pressed and held with the
// mouse or a finger; sliding across plays the keys it crosses. The computer's
// keys play it too (`kyQwerty`).
const KY_BLACK = [1, 3, 6, 8, 10];
const KY_KEYS = 61;

function kyStripHtml() {
  return `<section class="panel ky-panel at-only"><div class="ph"><b class="nm">KEYS</b><span class="meta">held as long as a key is down · its own tuning · MIDI on its own channel · computer keys A–; (Z X octave)</span><span class="grow"></span>`
    + `<div class="seg ky-oct"><button type="button" data-o="-1" title="Octave down">−</button><span id="kyOctRo" class="mono">C4</span><button type="button" data-o="1" title="Octave up">+</button></div>`
    + kyPickerHtml("atmos") + `</div><div class="ky-strip" id="kyStrip"></div></section>`;
}

function kyBuildStrip() {
  const strip = document.getElementById("kyStrip");
  if (!strip) return;
  const lo = (KY.oct + 1) * 12;
  const whites = [];
  for (let k = lo; k < lo + KY_KEYS; k++) if (!KY_BLACK.includes(k % 12)) whites.push(k);
  const w = 100 / whites.length;
  let html = "";
  for (const k of whites) html += `<div class="ky-key" data-k="${k}"></div>`;
  // Each black key sits over the line after the white key below it.
  for (let k = lo; k < lo + KY_KEYS; k++) {
    if (!KY_BLACK.includes(k % 12)) continue;
    const at = whites.indexOf(k - 1) + 1;
    html += `<div class="ky-key blk" data-k="${k}" style="left:${(at * w - w * 0.3).toFixed(3)}%;width:${(w * 0.6).toFixed(3)}%"></div>`;
  }
  strip.innerHTML = html;
  document.getElementById("kyOctRo").textContent = "C" + KY.oct;
  kyPaintKeys();
}

function kyPaintKeys() {
  for (const el of document.querySelectorAll(".ky-key")) el.classList.toggle("on", KY.held.has("atmos:" + el.dataset.k));
}

function kyWireStrip() {
  const strip = document.getElementById("kyStrip");
  if (!strip) return;
  let down = null, pid = null;
  const keyAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".ky-key");
  strip.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".ky-key");
    if (!el) return;
    e.preventDefault();
    pid = e.pointerId;
    try { strip.setPointerCapture(pid); } catch {}
    down = +el.dataset.k;
    kyNoteOn("atmos", down, 0.8);
  });
  strip.addEventListener("pointermove", (e) => {
    if (down == null || e.pointerId !== pid) return;
    const el = keyAt(e);
    if (!el || +el.dataset.k === down) return;
    kyNoteOff("atmos", down);
    down = +el.dataset.k;
    kyNoteOn("atmos", down, 0.8);
  });
  const up = (e) => {
    if (down == null || e.pointerId !== pid) return;
    kyNoteOff("atmos", down);
    down = null;
  };
  strip.addEventListener("pointerup", up);
  strip.addEventListener("pointercancel", up);
  document.querySelector(".ky-oct").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    KY.oct = Math.max(0, Math.min(4, KY.oct + +b.dataset.o));
    kyBuildStrip();
  });
}

// ─── THE COMPUTER'S KEYS ─────────────────────────────────────────────────────
// On the Atmosphere page, the letters play it as a piano does in most DAWs:
// A W S E D F T G Y H U J K O L P ; from a C, Z and X an octave down and up.
// That C is the strip's middle one. Held as long as the key is down.
const KY_QWERTY = "awsedftgyhujkolp;";
const KY_QHELD = new Map(); // key letter -> MIDI key
let kyQOct = 2; // octaves above the strip's lowest C

function kyQwerty() {
  const typing = (e) => e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range";
  document.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("only-atmos") || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
    const l = e.key.toLowerCase();
    if (l === "z" || l === "x") { kyQOct = Math.max(0, Math.min(4, kyQOct + (l === "z" ? -1 : 1))); e.preventDefault(); return; }
    const i = KY_QWERTY.indexOf(l);
    if (i < 0) return;
    e.preventDefault();
    if (e.repeat || KY_QHELD.has(l)) return;
    const k = (KY.oct + 1 + kyQOct) * 12 + i;
    KY_QHELD.set(l, k);
    kyNoteOn("atmos", k, 0.8);
  });
  document.addEventListener("keyup", (e) => {
    const l = e.key.toLowerCase();
    const k = KY_QHELD.get(l);
    if (k == null) return;
    KY_QHELD.delete(l);
    kyNoteOff("atmos", k);
  });
  // Keys let go when the page loses the keyboard, so nothing hangs.
  window.addEventListener("blur", () => { for (const [l, k] of KY_QHELD) kyNoteOff("atmos", k); KY_QHELD.clear(); });
}

// ─── MIDI ────────────────────────────────────────────────────────────────────
function kyEvent(ev) {
  if (!(ev.part in KY_PARTS)) return; // the Band's, for later
  if (ev.allOff) kyAllOff(ev.part);
  else if (ev.on === true) kyNoteOn(ev.part, ev.key, ev.vel ?? 0.8);
  else if (ev.on === false) kyNoteOff(ev.part, ev.key);
}

async function kyPoll() {
  if (KY.polling) return;
  KY.polling = true;
  for (;;) {
    try {
      const r = await fetch(`/api/engine/midi/events?wait=1500${KY.n == null ? "" : "&after=" + KY.n}`);
      if (!r.ok) throw new Error(r.status);
      const m = await r.json();
      for (const ev of m.events || []) kyEvent(ev);
      KY.n = m.n ?? 0;
    } catch {
      // No server (the page on its own), or it restarted: try again soon.
      KY.n = null;
      await new Promise((ok) => setTimeout(ok, 4000));
    }
  }
}

function keysInit() {
  // In the app the Atmosphere page has the app's keyboard along its bottom
  // (ui/app/212-atmos-dock.js); the frame's own strip stands down there.
  if (window.parent !== window) document.body.classList.add('in-app');
  const body = document.getElementById("atBody");
  if (body && !document.getElementById("kyStrip")) {
    body.insertAdjacentHTML("beforeend", kyStripHtml());
    kyBuildStrip();
    kyWireStrip();
    kyWirePicker("atmos");
  }
  const classic = document.querySelector('.power[data-syn="classic"]')?.closest(".ph");
  if (classic && !document.getElementById("kyMidi_classic")) {
    classic.insertAdjacentHTML("beforeend", `<span class="grow"></span>${kyPickerHtml("classic")}`);
    kyWirePicker("classic");
  }
  kySendChannels();
  kyPoll();
  kyQwerty();
}

keysInit();
