// The bridge to the granular engine.
//
// This file is not part of the scale sequencer. It is added to the copy that
// ships inside the granular app, where the sequencer runs in a frame under the
// Seq button on the rail, and it does two things the standalone page has no
// reason to do:
//
//   - **follow the engine's transport.** Play in the granular app plays the
//     sequencer; stop stops it. One transport, two voices.
//   - **hand the room what it is playing.** The room is drawn from the engine's
//     master bus. The sequencer's sound goes out through the browser, which the
//     engine never hears — so this taps the sequencer's own output, measures it
//     the way the engine measures its own, and posts it to the parent, which
//     mixes the two pictures.
//
// Everything crosses the frame boundary as a message. The parent is the same
// origin, and only the same origin is listened to. Opened on its own, outside
// any frame, this file does nothing at all.
//
// See `docs/SEQUENCER.md`.

(() => {
  if (window.parent === window) return;
  const ORIGIN = location.origin;
  const post = (m) => window.parent.postMessage(m, ORIGIN);

  // What the room wants: how many bands, between which frequencies. The engine
  // answers the same question for its own bus with the same numbers.
  let want = { bands: 256, lo: 20, hi: 20000 };
  let tapL = null;
  let tapR = null;
  let tapM = null;
  let freq = null;
  let timeL = null;
  let timeR = null;

  /// Hang the analysers off the master gain, once there is one.
  function ensureTap() {
    if (tapM || typeof audioCtx === 'undefined' || !audioCtx || !masterGain) return;
    tapM = audioCtx.createAnalyser();
    tapM.fftSize = 2048;
    tapM.smoothingTimeConstant = 0.55;
    masterGain.connect(tapM);
    const split = audioCtx.createChannelSplitter(2);
    masterGain.connect(split);
    tapL = audioCtx.createAnalyser();
    tapR = audioCtx.createAnalyser();
    tapL.fftSize = 1024;
    tapR.fftSize = 1024;
    split.connect(tapL, 0);
    split.connect(tapR, 1);
    freq = new Float32Array(tapM.frequencyBinCount);
    timeL = new Float32Array(tapL.fftSize);
    timeR = new Float32Array(tapR.fftSize);
  }

  /// The spectrum as the engine reports its own: one dB value per band, the
  /// bands spaced logarithmically from `lo` to `hi`, the loudest bin in each.
  function spectrum() {
    tapM.getFloatFrequencyData(freq);
    const rate = audioCtx.sampleRate;
    const binHz = rate / tapM.fftSize;
    const out = new Array(want.bands);
    const ratio = Math.log(want.hi / want.lo);
    for (let i = 0; i < want.bands; i++) {
      const a = want.lo * Math.exp((ratio * i) / want.bands);
      const b = want.lo * Math.exp((ratio * (i + 1)) / want.bands);
      let lo = Math.floor(a / binHz);
      let hi = Math.max(lo + 1, Math.ceil(b / binHz));
      lo = Math.min(lo, freq.length - 1);
      hi = Math.min(hi, freq.length);
      let best = -160;
      for (let k = lo; k < hi; k++) if (freq[k] > best) best = freq[k];
      out[i] = Math.max(-96, Math.min(0, best));
    }
    return out;
  }

  /// A short run of left/right pairs, for the ring.
  function lissajous() {
    tapL.getFloatTimeDomainData(timeL);
    tapR.getFloatTimeDomainData(timeR);
    const n = 512;
    const out = new Array(n * 2);
    let rms = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const l = timeL[i];
      const r = timeR[i];
      out[i * 2] = +l.toFixed(3);
      out[i * 2 + 1] = +r.toFixed(3);
      rms += l * l + r * r;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
    }
    return { xy: out, rms: Math.sqrt(rms / (2 * n)), peak };
  }

  function tick() {
    const playing = typeof isPlaying !== 'undefined' && !!isPlaying;
    if (!playing) {
      post({ type: 'seq:feed', playing: false });
      return;
    }
    ensureTap();
    if (!tapM) return;
    const l = lissajous();
    post({
      type: 'seq:feed',
      playing: true,
      rate: audioCtx.sampleRate,
      spectrum: spectrum(),
      lissajous: l.xy,
      rms: l.rms,
      peak: l.peak,
    });
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== ORIGIN) return;
    const m = e.data || {};
    if (m.type === 'seq:transport') {
      // The engine's play and stop. The context may be asleep — a frame that
      // was never clicked in has had no gesture of its own — so it is asked to
      // wake, and if the browser refuses, the first click inside will do it.
      if (typeof initAudio === 'function') initAudio();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const on = typeof isPlaying !== 'undefined' && !!isPlaying;
      if (m.playing && !on && typeof togglePlay === 'function') togglePlay();
      if (!m.playing && on && typeof stopSeq === 'function') stopSeq();
    } else if (m.type === 'seq:want') {
      want = {
        bands: Math.max(8, Math.min(4096, m.bands | 0) || want.bands),
        lo: m.lo > 0 ? m.lo : want.lo,
        hi: m.hi > 0 ? m.hi : want.hi,
      };
    }
  });

  // Thirty times a second, which is what the engine's meter is polled at.
  setInterval(tick, 33);
  post({ type: 'seq:ready' });
})();
