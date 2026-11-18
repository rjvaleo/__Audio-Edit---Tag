// Atmosphere's effects, in the audio thread (ours, 16 Nov 2026). The effect
// rack the engine runs — the `fx` crate, every effect the Grain page has —
// built for the browser (`core/crates/fx-wasm`, served as `atfx.wasm`) and run
// here on each block of Atmosphere's sound. See `atfx.js` for the page's side
// and `docs/SEQUENCER.md`, "Atmosphere's own effects".
//
// The page sends the module's bytes once, then the chain: `{ t: "chain",
// slots: [{ kind, on, params: { key: value } }] }` lays it again, `{ t: "set" }`
// moves one control and `{ t: "on" }` switches a slot. With no chain, or before
// the module is here, the sound passes through untouched.

class AtFx extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = null; // the module's exports
    this.n = 0; // slots in the chain
    this.peak = [];
    this.tick = 0;
    this.port.onmessage = (e) => this.message(e.data);
  }

  message(m) {
    try { this.handle(m); } catch (err) { this.port.postMessage({ t: "error", text: String(err) }); }
  }

  handle(m) {
    if (m.t === "wasm") {
      try {
        const inst = new WebAssembly.Instance(new WebAssembly.Module(m.bytes), {});
        this.x = inst.exports;
        this.x.fx_init(sampleRate);
      } catch (err) {
        this.port.postMessage({ t: "error", text: String(err) });
      }
      return;
    }
    if (!this.x) return;
    if (m.t === "chain") {
      this.x.fx_clear();
      this.n = 0;
      for (const s of m.slots) {
        if (this.x.fx_push(this.text(s.kind), s.on ? 0 : 1) < 0) continue;
        for (const [k, v] of Object.entries(s.params || {})) this.x.fx_set(this.n, this.text(k), v);
        if (s.wet != null) this.x.fx_set(this.n, this.text("slot.wet"), s.wet / 100);
        if (s.level != null) this.x.fx_set(this.n, this.text("slot.level"), s.level);
        this.n++;
      }
      this.port.postMessage({ t: "laid", n: this.n });
    } else if (m.t === "board") {
      // The board (Wave's, run by the same engine): `text` is its lines (see
      // fx-wasm's `bd_load`); empty clears it and the chain plays again.
      if (!m.text) { this.x.bd_clear(); this.bn = 0; this.port.postMessage({ t: "boarded", n: 0 }); return; }
      const n = this.btext(m.text);
      const got = this.x.bd_load(n);
      if (got >= 0) this.bn = got;
      this.port.postMessage({ t: "boarded", n: got });
    } else if (m.t === "bset") {
      this.x.bd_set(m.i, this.bkey(m.k), m.v);
    } else if (m.t === "bon") {
      this.x.bd_on(m.i, m.on ? 1 : 0);
    } else if (m.t === "set") {
      this.x.fx_set(m.i, this.text(m.k), m.v);
    } else if (m.t === "on") {
      this.x.fx_bypass(m.i, m.on ? 0 : 1);
    }
  }

  /// A board's text where the module reads it; its length.
  btext(s) {
    const n = Math.min(65536, s.length);
    const m = new Uint8Array(this.x.memory.buffer, this.x.bd_text(), 65536);
    for (let i = 0; i < n; i++) m[i] = s.charCodeAt(i) & 0x7f;
    return n;
  }

  bkey(s) {
    const n = Math.min(256, s.length);
    const m = new Uint8Array(this.x.memory.buffer, this.x.bd_text(), 256);
    for (let i = 0; i < n; i++) m[i] = s.charCodeAt(i) & 0x7f;
    return n;
  }

  /// Write a kind or a key where the module reads it; its length.
  text(s) {
    // No TextEncoder in the audio thread; kinds and keys are plain ASCII.
    const n = Math.min(256, s.length);
    const m = new Uint8Array(this.x.memory.buffer, this.x.fx_text(), 256);
    for (let i = 0; i < n; i++) m[i] = s.charCodeAt(i) & 0x7f;
    return n;
  }

  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    const l = out[0], r = out[1] || out[0];
    const il = inp[0], ir = inp[1] || inp[0];
    if (!il) { l.fill(0); if (r !== l) r.fill(0); return true; }
    const board = this.x && this.x.bd_active();
    if (!this.x || (this.n === 0 && !board)) {
      l.set(il);
      if (r !== l) r.set(ir);
      return true;
    }
    const n = il.length;
    const buf = new Float32Array(this.x.memory.buffer, this.x.fx_buf(), n * 2);
    for (let i = 0; i < n; i++) { buf[2 * i] = il[i]; buf[2 * i + 1] = ir[i]; }
    if (board) this.x.bd_process(n); else this.x.fx_process(n);
    const b2 = new Float32Array(this.x.memory.buffer, this.x.fx_buf(), n * 2);
    let pk = 0;
    for (let i = 0; i < n; i++) {
      const a = b2[2 * i], c = b2[2 * i + 1];
      l[i] = a;
      if (r !== l) r[i] = c;
      pk = Math.max(pk, Math.abs(a), Math.abs(c));
    }
    // How loud it leaves, and how hard each effect is working, a few times a second.
    this.peak.push(pk);
    if (++this.tick % 12 === 0) {
      const tel = [];
      if (!board) for (let i = 0; i < this.n; i++) tel.push(this.x.fx_telemetry(i));
      const bpk = [];
      if (board) for (let i = 0; i < (this.bn || 0); i++) bpk.push(this.x.bd_peak(i));
      this.port.postMessage({ t: "lvl", peak: Math.max(...this.peak), tel, bpk });
      this.peak = [];
    }
    return true;
  }
}

registerProcessor("atfx", AtFx);
