// Atmosphere's voice in the audio thread (ours, 17 Nov 2026): the physical-
// modelling engine (`core/crates/atmos`, served as `atmos.wasm`) — its ten
// models, its filter, Amp and LFOs, sixteen voices. See `atphys.js` for the
// page's side and `docs/SEQUENCER.md`, "Atmosphere's physical models".
//
// Messages: `{ t: "wasm", bytes }` once; `{ t: "set", kv: { key: value } }`;
// `{ t: "on", id, hz, vel, at }` and `{ t: "off", id, at }` (at: the context's
// time, so a key lands where it was played); `{ t: "scale", cents }`;
// `{ t: "alloff" }`. It sends back `{ t: "view", a, b }` a few times a second:
// each oscillator's model and its picture (32 numbers).

class AtmosVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = null;
    this.pending = [];
    this.tick = 0;
    this.port.onmessage = (e) => {
      try { this.handle(e.data); } catch (err) { this.port.postMessage({ t: "error", text: String(err) }); }
    };
  }

  text(s) {
    // No TextEncoder in the audio thread; keys are plain ASCII.
    const n = Math.min(64, s.length);
    const m = new Uint8Array(this.x.memory.buffer, this.x.at_text(), 64);
    for (let i = 0; i < n; i++) m[i] = s.charCodeAt(i) & 0x7f;
    return n;
  }

  delay(at) {
    return Math.max(0, Math.round(((at ?? currentTime) - currentTime) * sampleRate));
  }

  handle(m) {
    if (m.t === "wasm") {
      this.x = new WebAssembly.Instance(new WebAssembly.Module(m.bytes), {}).exports;
      this.x.at_init(sampleRate);
      for (const p of this.pending) this.handle(p);
      this.pending = [];
      this.port.postMessage({ t: "ready" });
      return;
    }
    if (!this.x) { this.pending.push(m); return; }
    if (m.t === "set") {
      for (const [k, v] of Object.entries(m.kv)) this.x.at_set(this.text(k), v);
    } else if (m.t === "on") {
      this.x.at_note_on(m.id, m.hz, m.vel, this.delay(m.at));
    } else if (m.t === "off") {
      this.x.at_note_off(m.id, this.delay(m.at));
    } else if (m.t === "alloff") {
      this.x.at_all_off();
    } else if (m.t === "scale") {
      const c = m.cents.slice(0, 64);
      new Float32Array(this.x.memory.buffer, this.x.at_scale_buf(), 64).set(c);
      this.x.at_scale(c.length);
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const l = out[0], r = out[1] || out[0];
    if (!this.x) { l.fill(0); if (r !== l) r.fill(0); return true; }
    const n = l.length;
    this.x.at_render(n);
    const b = new Float32Array(this.x.memory.buffer, this.x.at_buf(), n * 2);
    for (let i = 0; i < n; i++) { l[i] = b[2 * i]; if (r !== l) r[i] = b[2 * i + 1]; }
    if (++this.tick % 8 === 0) {
      const view = (w) => {
        const k = this.x.at_view(w);
        return k < 0 ? null : { m: k, v: Array.from(new Float32Array(this.x.memory.buffer, this.x.at_view_buf(), 32)) };
      };
      this.port.postMessage({ t: "view", a: view(0), b: view(1), n: this.x.at_sounding() });
    }
    return true;
  }
}

registerProcessor("atmos-voice", AtmosVoice);
