// The bridge to the granular engine.
//
// This file is not part of the scale sequencer. It is added to the copy that
// ships inside the granular app, where the sequencer runs in a frame under the
// Seq button on the rail, and it does three things the standalone page has no
// reason to do:
//
//   - **follow the engine's transport, at the engine's position.** Play in the
//     granular app plays the sequencer *from where the engine is*, not from
//     step one; stop stops it; a seek moves it. The engine's output time is the
//     one clock, and the sequencer's step grid is laid along it from zero.
//   - **replay the sequencer's own take with it.** A performance recorded on
//     this page replays from the same position, so the knob moves you
//     recorded here run when you press play over there.
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

  // ── the one clock ────────────────────────────────────────────────────────
  //
  // `at` is the engine's output time in seconds from the start of the
  // document. The grid is laid along it from zero: step k sounds at k times
  // the step length. Locating is arithmetic; nothing is counted.

  /// Where the sequencer's own clock believes the engine is: the position it
  /// was last told, carried forward on the audio clock.
  let anchor = null; // { perf: performance.now(), at }
  /// What the last locate decided, for anyone asking — the tests do.
  let last = null; // { at, step, wait }

  /// How far the two clocks may drift before the grid is re-laid rather than
  /// left alone. Half a step at any tempo would be audible as a skipped or a
  /// doubled note; this is far inside that at any tempo the sequencer offers,
  /// and far outside what two clocks drift in a minute.
  const RELOCATE_S = 0.08;

  function stepDur() { return (60 / bpm) * stepBeats; }

  /// Lay the grid along the engine's time and point the scheduler at the next
  /// step boundary after `at`. Sets the sequencer's own variables — they are
  /// bindings in this frame's global scope, which this script shares.
  function locate(at) {
    if (!audioCtx) return;
    const d = stepDur();
    const total = Math.max(0, at) / d;
    const idx = Math.floor(total);
    const frac = total - idx;
    const next = idx + 1;
    const n = Math.max(1, numSteps);
    if (direction === 'fwd') {
      currentStep = next % n;
    } else if (direction === 'rev') {
      currentStep = (n - 1 - (next % n) + n) % n;
    } else if (direction === 'ping') {
      // Up then back without repeating the ends: a period of 2n-2.
      const period = Math.max(1, 2 * n - 2);
      const r = next % period;
      if (r < n) { currentStep = r; pingDir = 1; } else { currentStep = period - r; pingDir = -1; }
    }
    // Random keeps its own counsel; only its phase is aligned.
    nextNoteTime = audioCtx.currentTime + (1 - frac) * d;
    // Carried forward on the wall clock rather than the audio clock: a
    // context the browser has kept asleep — no gesture yet, or no device at
    // all — has a `currentTime` that does not move, and a clock that does not
    // move would read every message as a seek.
    anchor = { perf: performance.now(), at };
    last = { at, step: currentStep, wait: (1 - frac) * d };
  }

  /// The engine's position as this clock predicts it now.
  function predicted() {
    if (!anchor) return null;
    return anchor.at + (performance.now() - anchor.perf) / 1000;
  }

  /// Start the step clock at `at`. The sequencer's own `togglePlay` starts at
  /// step one and schedules its first note before this could move it, so the
  /// same four lines are done here, with the grid laid first.
  function playAt(at) {
    if (typeof initAudio === 'function') initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (isPlaying) { locate(at); return; }
    isPlaying = true;
    locate(at);
    scheduler();
    // The engine's Play starts an armed take here, as this page's own does.
    if (typeof perfArmedBegin === 'function') perfArmedBegin(at);
    const btn = document.getElementById('playBtn');
    if (btn) { btn.textContent = '⏸ PAUSE'; btn.classList.add('active'); }
  }

  function stop() {
    if (isPlaying && typeof stopSeq === 'function') stopSeq();
    anchor = null;
  }

  // ── the take ─────────────────────────────────────────────────────────────
  //
  // The page's own performance recorder keeps a loaded take in `perfLoaded`
  // and replays it with `perfTogglePlay`, from its own zero. Here it replays
  // from the engine's position: everything before `at` is applied at once so
  // the knobs stand where the take had them, and the rest runs on the clock.

  function takePlayAt(at) {
    if (typeof perfLoaded === 'undefined' || !perfLoaded || typeof perfReplayTick !== 'function') return;
    if (typeof perfRec !== 'undefined' && perfRec) return; // recording a new one: leave it be
    const p = perfLoaded;
    // The take's own time. It began at `startAt` on the engine's clock, so the
    // engine at `at` is `rel` into it — negative while the engine is still
    // before where the take was played, and the replay simply waits.
    const rel = at - (+p.startAt || 0);
    // Back past where the replay has got to — a seek, or the loop coming round:
    // the take starts again from there, so it stands where it stood then and
    // throws its switches again as it reaches them. Moving its clock back alone
    // left every switch it had already thrown thrown.
    if (perfReplay && rel < perfReplay.playheadT - 0.05) {
      clearInterval(perfReplay.timer);
      perfReplay = null;
    }
    if (!perfReplay) {
      if (typeof applyPresetState === 'function' && p.snapshot) applyPresetState(p.snapshot);
      p.gestures.forEach((g) => delete g._fired);
      // Fast-forward: what the take had already done by `at`.
      for (const g of p.gestures) {
        if (g.kind === 'slider') {
          if (g.t1 <= rel) {
            const el = document.getElementById(g.id);
            if (el) {
              el.value = g.points[g.points.length - 1][1];
              el.dispatchEvent(new Event('input', { bubbles: true }));
              if (window.updateKnobVisual) window.updateKnobVisual(g.id);
            }
            g._fired = true;
          }
        } else if (g.t <= rel) {
          // Play and pause events are the transport's, and the transport is
          // the engine's now.
          if (g.type !== 'play' && g.type !== 'pause' && g.type !== 'stop') perfApplyDiscrete(g);
          g._fired = true;
        }
      }
      perfReplay = { t0: perfNow() - rel, playheadT: rel };
      perfReplay.timer = setInterval(perfReplayTick, 25);
      const btn = document.getElementById('perfPlayBtn');
      if (btn) { btn.textContent = '⏸ PLAYING'; btn.classList.add('active'); }
      if (typeof perfSetStatus === 'function') perfSetStatus('REPLAY — ON THE ENGINE\'S TRANSPORT');
      if (typeof perfStartDrawLoop === 'function') perfStartDrawLoop();
    } else {
      perfReplay.t0 = perfNow() - rel;
      perfReplay.playheadT = rel;
    }
  }

  function takeStop() {
    if (typeof perfReplay !== 'undefined' && perfReplay && typeof perfStop === 'function') perfStop();
  }

  /// What a take has done by `at` on the engine's clock: every control it
  /// moves, at its value then, and the switches it has thrown by then, by their
  /// place in its gestures. The take began at `startAt`, so its own time is `at`
  /// less that — a take played ten seconds into the sound makes its first move
  /// ten seconds in, in the film as it does live.
  function takeValuesAt(take, at) {
    const t = at - (+take.startAt || 0);
    const sliders = {};
    const snap = (take.snapshot && take.snapshot.sliders) || {};
    for (const id of PERF_SLIDERS) {
      const moved = take.gestures.some((x) => x.kind === 'slider' && x.id === id);
      if (!moved && snap[id] === undefined) continue;
      const g = take.gestures.find((x) => x.kind === 'slider' && x.id === id && x.t0 <= t && t <= x.t1);
      sliders[id] = g ? perfInterp(g.points, t) : perfValueAtTime(take, id, t);
    }
    const thrown = [];
    take.gestures.forEach((g, i) => {
      // Play and pause are the transport's, and the transport is the engine's.
      if (g.kind === 'discrete' && g.t <= t && g.type !== 'play' && g.type !== 'pause' && g.type !== 'stop') thrown.push(i);
    });
    return { t, sliders, thrown };
  }

  /// Whether the engine's transport has the take playing — so a jump, which
  /// may come after the take has run out, starts it again.
  let takeOn = false;

  // ── the feed ─────────────────────────────────────────────────────────────

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
  /// Written into `out` from `at`, so a film can fill one long array.
  function spectrumInto(an, buf, rate, w, out, at) {
    an.getFloatFrequencyData(buf);
    const binHz = rate / an.fftSize;
    const ratio = Math.log(w.hi / w.lo);
    for (let i = 0; i < w.bands; i++) {
      const a = w.lo * Math.exp((ratio * i) / w.bands);
      const b = w.lo * Math.exp((ratio * (i + 1)) / w.bands);
      let lo = Math.floor(a / binHz);
      let hi = Math.max(lo + 1, Math.ceil(b / binHz));
      lo = Math.min(lo, buf.length - 1);
      hi = Math.min(hi, buf.length);
      let best = -160;
      for (let k = lo; k < hi; k++) if (buf[k] > best) best = buf[k];
      out[at + i] = Math.max(-96, Math.min(0, best));
    }
  }

  /// A short run of left/right pairs, for the ring, into `out` from `at`.
  function lissajousInto(aL, aR, bufL, bufR, n, out, at) {
    aL.getFloatTimeDomainData(bufL);
    aR.getFloatTimeDomainData(bufR);
    let rms = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const l = bufL[i];
      const r = bufR[i];
      out[at + i * 2] = l;
      out[at + i * 2 + 1] = r;
      rms += l * l + r * r;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
    }
    return { rms: Math.sqrt(rms / (2 * n)), peak };
  }

  function spectrum() {
    const out = new Array(want.bands);
    spectrumInto(tapM, freq, audioCtx.sampleRate, want, out, 0);
    return out;
  }

  function lissajous() {
    const n = 512;
    const out = new Array(n * 2);
    const m = lissajousInto(tapL, tapR, timeL, timeR, n, out, 0);
    for (let i = 0; i < out.length; i++) out[i] = +out[i].toFixed(3);
    return { xy: out, rms: m.rms, peak: m.peak };
  }

  // ── the film ─────────────────────────────────────────────────────────────
  //
  // The film is rendered offline, so the sequencer is too: its own graph,
  // built by its own `initAudio` on an offline context, its pattern laid on
  // the shared grid from the film's first second, its loaded take applied at
  // every film frame, and its master measured by the same analysers the room
  // uses live. What comes back is the sound and the picture, both at the
  // film's own rate.
  //
  // `initAudio` makes a context by name and hangs a media-stream tap for the
  // page's recorder, neither of which an offline context has, so both are
  // stood in for while it runs. Afterwards the live graph is built again
  // fresh — the page has its own context back, and the knobs stand where
  // they stood before.

  /// Which step sounds at the k-th boundary, in the pattern's direction.
  function stepAtBoundary(k) {
    const n = Math.max(1, numSteps);
    if (direction === 'fwd') return k % n;
    if (direction === 'rev') return (n - 1 - (k % n) + n) % n;
    if (direction === 'ping') {
      const period = Math.max(1, 2 * n - 2);
      const r = k % period;
      return r < n ? r : period - r;
    }
    return Math.floor(Math.random() * n);
  }

  async function renderFilm(o) {
    const rate = o.rate || 48000;
    const seconds = Math.max(0.1, o.seconds || 1);
    const fps = o.fps || 30;
    const bands = Math.max(8, o.bands | 0);
    const lissN = Math.max(16, o.liss | 0);
    const at0 = Number.isFinite(o.at0) ? Math.max(0, o.at0) : 0;
    const nFrames = Math.max(1, Math.ceil(seconds * fps));
    const length = Math.max(128, Math.ceil(seconds * rate));

    stop();
    takeStop();
    const knobs = typeof getPresetState === 'function' ? getPresetState() : null;
    const live = audioCtx;

    const off = new OfflineAudioContext(2, length, rate);
    off.createMediaStreamDestination = () => off.createGain();
    const Real = window.AudioContext;
    window.AudioContext = function () { return off; };
    audioCtx = null;
    try { initAudio(); } finally { window.AudioContext = Real; }
    if (audioCtx !== off) throw new Error('the sequencer did not take the offline context');

    const an = off.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.55;
    masterGain.connect(an);
    const split = off.createChannelSplitter(2);
    masterGain.connect(split);
    const aL = off.createAnalyser();
    const aR = off.createAnalyser();
    aL.fftSize = 1024;
    aR.fftSize = 1024;
    split.connect(aL, 0);
    split.connect(aR, 1);
    const fbuf = new Float32Array(an.frequencyBinCount);
    const bL = new Float32Array(1024);
    const bR = new Float32Array(1024);
    const w = { bands, lo: o.lo > 0 ? o.lo : 20, hi: o.hi > 0 ? o.hi : 20000 };
    const spectra = new Float32Array(nFrames * bands);
    const liss = new Float32Array(nFrames * lissN * 2);

    // The take, if one is loaded: the knobs it moves, at any moment. It starts
    // from where it stood when it was recorded, as it does when the engine's
    // Play starts it.
    const take = (typeof perfLoaded !== 'undefined' && perfLoaded) || null;
    if (take && take.snapshot && typeof applyPresetState === 'function') applyPresetState(take.snapshot);
    const applied = new Set();
    const applyTakeAt = (at) => {
      if (!take) return;
      const now = takeValuesAt(take, at);
      for (const [id, v] of Object.entries(now.sliders)) {
        const el = document.getElementById(id);
        if (!el || String(el.value) === String(v)) continue;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      for (const i of now.thrown) {
        if (applied.has(i)) continue;
        applied.add(i);
        perfApplyDiscrete(take.gestures[i]);
      }
    };

    // **A loop goes round.** `span` seconds of the document from `at0`,
    // `repeats` times — the sound was tiled that way by the server — and then
    // the tail, where nothing new is played and the take holds where the loop
    // ended, which is the rule the server's render keeps for its own lanes.
    // Without it the sequencer ran straight on through every repeat.
    const span = o.loop && o.loop.span > 0 ? +o.loop.span : 0;
    const repeats = span ? Math.max(1, Math.round(+o.loop.repeats) || 1) : 0;
    const musical = span * repeats;
    /// Which pass a moment of the render is in, and where in the document.
    const placeAt = (t) => {
      if (!span) return { pass: 0, at: at0 + t };
      if (t >= musical - 1e-9) return { pass: repeats - 1, at: at0 + span };
      const pass = Math.floor(t / span + 1e-9);
      return { pass, at: at0 + Math.max(0, t - pass * span) };
    };

    // The grid, laid from the document's zero. The notes of each film frame
    // are scheduled when the render reaches it, so a knob the take moved by
    // then is what they sound through. Round a loop, each pass lays the same
    // steps again at the same places in it.
    const d = stepDur();
    const kFirst = Math.max(0, Math.ceil((at0 - 1e-9) / d));
    let k = kFirst;
    let pass = 0;
    const scheduleUntil = (tEnd) => {
      for (;;) {
        let time = k * d - at0;
        if (span) {
          if (pass >= repeats) return;
          if (time >= span - 1e-9) { pass++; k = kFirst; continue; }
          time += pass * span;
        }
        if (time >= tEnd) return;
        const step = steps[stepAtBoundary(k)];
        let pwMod = 0;
        lfos.forEach((lfo) => {
          if (lfo.target === 'pw') {
            lfo.phase += lfo.rate * d * 2 * Math.PI;
            pwMod += Math.sin(lfo.phase) * lfo.depth * 0.45;
          }
        });
        if (waveType === 'pulse') currentPW = Math.max(0.05, Math.min(0.95, pulseWidth + pwMod));
        if (step && !step.rest && time >= 0) playNote(getFreqForDegree(step.degree), time);
        k++;
      }
    };

    // **Notes are laid a little ahead of the frame that reaches them.** The
    // render stops for a frame on a render quantum's edge, which can fall just
    // past the frame's own time, and a note scheduled for a moment already
    // rendered starts at the next edge instead — up to a quantum late, and
    // whether it is late or not came down to how a float rounded. Two quanta
    // ahead, every note is laid before its moment and starts on its sample.
    const ahead = 256 / rate;
    let takePass = 0;
    const frameWork = (i) => {
      const t = i / fps;
      const here = placeAt(t);
      // Round the loop, the take is put back to where it stood at the loop's
      // start and throws its switches again as the pass reaches them.
      if (take && here.pass > takePass) {
        takePass = here.pass;
        if (take.snapshot) applyPresetState(take.snapshot);
        applied.clear();
      }
      applyTakeAt(here.at);
      scheduleUntil(t + 1 / fps + ahead);
      spectrumInto(an, fbuf, rate, w, spectra, i * bands);
      lissajousInto(aL, aR, bL, bR, lissN, liss, i * lissN * 2);
      if (i % 30 === 0) post({ type: 'seq:render-progress', fraction: i / nFrames });
    };

    let buffer;
    try {
      frameWork(0);
      for (let i = 1; i < nFrames; i++) {
        const at = i / fps;
        if (at >= length / rate) break;
        off.suspend(at).then(() => { frameWork(i); off.resume(); });
      }
      buffer = await off.startRendering();
    } finally {
      // The page's own context, back, and the knobs where they were.
      audioCtx = null;
      tapM = null; tapL = null; tapR = null;
      initAudio();
      if (live && live.close) live.close().catch(() => {});
      if (knobs && typeof applyPresetState === 'function') applyPresetState(knobs);
    }
    return {
      rate, frames: nFrames, seconds,
      left: buffer.getChannelData(0), right: buffer.getChannelData(1),
      spectra, liss, lissN, bands,
    };
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

  // ── messages ─────────────────────────────────────────────────────────────

  window.addEventListener('message', (e) => {
    if (e.origin !== ORIGIN) return;
    const m = e.data || {};
    if (m.type === 'seq:transport') {
      const at = Number.isFinite(m.at) ? m.at : 0;
      if (m.playing) { playAt(at); takeOn = true; takePlayAt(at); } else { takeOn = false; stop(); takeStop(); }
    } else if (m.type === 'seq:clock') {
      // The engine's position, while it plays. A seek or a loop wrap shows up
      // as a jump; drift shows up as a creep. Both are answered the same way,
      // by laying the grid again — but only past the threshold, so a clock
      // that is merely a few milliseconds out is not forever being nudged.
      if (!m.playing || !isPlaying || !Number.isFinite(m.at)) return;
      const p = predicted();
      if (p === null || Math.abs(p - m.at) > RELOCATE_S) {
        locate(m.at);
        if (takeOn) takePlayAt(m.at);
      }
    } else if (m.type === 'seq:render') {
      renderFilm(m).then((r) => {
        window.parent.postMessage({ type: 'seq:rendered', id: m.id, ...r }, ORIGIN,
          [r.left.buffer, r.right.buffer, r.spectra.buffer, r.liss.buffer]);
      }, (err) => {
        post({ type: 'seq:rendered', id: m.id, error: String(err && err.message || err) });
      });
    } else if (m.type === 'seq:state-get') {
      // A composition being kept: everything the sequencer is, and its take.
      post({
        type: 'seq:state', id: m.id,
        state: typeof getPresetState === 'function' ? getPresetState() : null,
        take: typeof perfLoaded !== 'undefined' ? perfLoaded : null,
      });
    } else if (m.type === 'seq:load') {
      // A composition being opened: its state put back, and its take made the
      // loaded one and kept at the head of the list of takes.
      if (m.state && typeof applyPresetState === 'function') applyPresetState(m.state);
      if (typeof perfLoaded !== 'undefined') {
        if (typeof perfReplay !== 'undefined' && perfReplay && typeof perfStop === 'function') perfStop();
        perfLoaded = m.take || null;
        if (m.take && typeof perfLoadAll === 'function' && typeof perfSaveAll === 'function') {
          const list = perfLoadAll().filter((t) => t.id !== m.take.id);
          list.unshift(m.take);
          perfSaveAll(list);
        }
        if (typeof perfRenderList === 'function') perfRenderList();
        if (typeof perfUpdateHeader === 'function') perfUpdateHeader();
        if (typeof perfDrawTimeline === 'function') perfDrawTimeline();
      }
    } else if (m.type === 'seq:arm') {
      // The host's REC PERF: one arm for every recorder. Armed here, the take
      // begins when the engine's Play reaches `playAt`; disarmed before it
      // began, nothing is kept. A take already running is ended by the stop.
      if (m.on) {
        if (!perfRec && !perfArmed && typeof perfRecStart === 'function') perfRecStart();
      } else if (perfArmed && !perfRec && typeof perfRecStop === 'function') {
        perfRecStop();
      }
    } else if (m.type === 'seq:compact') {
      // The host's Compose workspace: this page in a cell. The layout is the
      // page's own — see the COMPACT block at the end of style.css.
      document.body.classList.toggle('compact', !!m.on);
    } else if (m.type === 'seq:want') {
      want = {
        bands: Math.max(8, Math.min(4096, m.bands | 0) || want.bands),
        lo: m.lo > 0 ? m.lo : want.lo,
        hi: m.hi > 0 ? m.hi : want.hi,
      };
    }
  });

  // ── the take, for the host's timeline ────────────────────────────────────
  //
  // The host draws the take on its own timeline, beside the grain's lanes, in
  // the engine's output seconds. So the take is sent as lanes: for each control
  // a gesture moved, one run of points — the value it started the take at, then
  // every gesture, held at its last value until the next — with the value put
  // on nought to one by the control's own range. The discrete events go as
  // labels for the STRUCT lane, and the tempo for the ruler's bars. Sent when it
  // changes, checked three times a second.
  function takeMessage() {
    const tempo = {
      bpm: typeof bpm !== 'undefined' ? +bpm : 0,
      stepBeats: typeof stepBeats !== 'undefined' ? +stepBeats : 0,
    };
    const p = typeof perfLoaded !== 'undefined' ? perfLoaded : null;
    if (!p) return { type: 'seq:take', take: null, tempo };
    const start = +p.startAt || 0;
    const byId = new Map();
    for (const g of p.gestures || []) {
      if (g.kind !== 'slider' || !g.points || !g.points.length) continue;
      if (!byId.has(g.id)) byId.set(g.id, []);
      byId.get(g.id).push(g);
    }
    const lanes = [];
    for (const [id, gs] of byId) {
      const el = document.getElementById(id);
      const lo = el ? +el.min : 0;
      const hi = el ? +el.max : 100;
      const unit = (v) => (hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5);
      gs.sort((a, b) => a.t0 - b.t0);
      const pts = [];
      const snap = p.snapshot && p.snapshot.sliders ? parseFloat(p.snapshot.sliders[id]) : NaN;
      if (Number.isFinite(snap)) pts.push([start, unit(snap)]);
      let held = null;
      for (const g of gs) {
        if (held !== null) pts.push([start + g.t0, held]);
        for (const [t, v] of g.points) pts.push([start + t, unit(v)]);
        held = unit(g.points[g.points.length - 1][1]);
      }
      lanes.push({
        id: `seq:${id}`, target: `seq.${id}`,
        label: typeof perfLaneLabel === 'function' ? perfLaneLabel(id) : id,
        color: typeof perfLaneColor === 'function' ? perfLaneColor(id) : '#ff60b8',
        points: pts,
      });
    }
    const name = (g) => {
      if (g.type === 'scale') return `SCALE ${typeof SCALES !== 'undefined' && SCALES[g.v] ? SCALES[g.v].name.toUpperCase() : g.v}`;
      if (g.type === 'step') return `STEP ${g.i + 1}`;
      if (g.type === 'select') return (typeof perfLaneLabel === 'function' ? perfLaneLabel(g.id) : g.id).replace(' SELECT', '');
      return null;
    };
    const discretes = [];
    for (const g of p.gestures || []) {
      if (g.kind !== 'discrete') continue;
      const label = name(g);
      if (label) discretes.push({ t: start + g.t, label });
    }
    return {
      type: 'seq:take', tempo,
      take: { id: p.id, name: p.name, startAt: start, duration: +p.duration || 0, lanes, discretes },
    };
  }
  let lastTake = '';
  function postTake() {
    let m;
    try { m = takeMessage(); } catch { return; }
    const text = JSON.stringify(m);
    if (text === lastTake) return;
    lastTake = text;
    post(m);
  }

  // For the tests, and for anyone reading the frame: where this clock thinks
  // the engine is.
  window.seqBridge = { predicted, stepDur, locate, renderFilm, takeMessage, takePlayAt, takeValuesAt, get last() { return last; } };

  // Thirty times a second, which is what the engine's meter is polled at.
  setInterval(tick, 33);
  setInterval(postTake, 300);
  post({ type: 'seq:ready' });
})();
