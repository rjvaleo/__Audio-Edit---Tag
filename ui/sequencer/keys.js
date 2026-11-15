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
  oct: 4, // the strip's lowest C: C4
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

/// Atmosphere, held: a long note, let go with its own Release.
function kyAtmosOn(freq, vel) {
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
  const hz = kyHz(key);
  const voice = part === "atmos" ? kyAtmosOn(hz, vel) : kyClassicOn(hz, vel);
  if (!voice) return false;
  if (typeof scopeNote === "function") scopeNote(hz);
  noteFilterEnv(hz, audioCtx.currentTime, (60 / bpm) * stepBeats);
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
// Two octaves from a C, on Atmosphere's panel. Pressed and held with the
// mouse or a finger; sliding across plays the keys it crosses.
const KY_BLACK = [1, 3, 6, 8, 10];

function kyStripHtml() {
  return `<section class="panel ky-panel at-only"><div class="ph"><b class="nm">KEYS</b><span class="meta">held as long as a key is down · the scale's true pitch · MIDI on its own channel</span><span class="grow"></span>`
    + `<div class="seg ky-oct"><button type="button" data-o="-1" title="Octave down">−</button><span id="kyOctRo" class="mono">C4</span><button type="button" data-o="1" title="Octave up">+</button></div>`
    + kyPickerHtml("atmos") + `</div><div class="ky-strip" id="kyStrip"></div></section>`;
}

function kyBuildStrip() {
  const strip = document.getElementById("kyStrip");
  if (!strip) return;
  const lo = (KY.oct + 1) * 12;
  let html = "";
  for (let k = lo; k < lo + 25; k++) html += `<div class="ky-key${KY_BLACK.includes(k % 12) ? " blk" : ""}" data-k="${k}"></div>`;
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
    KY.oct = Math.max(0, Math.min(7, KY.oct + +b.dataset.o));
    kyBuildStrip();
  });
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
}

keysInit();
