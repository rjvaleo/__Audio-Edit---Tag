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

  /// The grid as the context lays it: context time `ctx` is engine time `at`.
  /// Laid by `locate`, and laid again by the loop's wrap. Oldest first.
  let grid = [];
  /// The engine's loop, in its seconds, as the host last said — or none.
  let loopSec = null;
  /// Whether the engine's transport is driving the step clock. The loop is the
  /// engine's; this page's own Play knows nothing of it.
  let driven = false;

  /// Point the step counter at boundary `k`, in the pattern's direction. Sets
  /// the sequencer's own variables — they are bindings in this frame's global
  /// scope, which this script shares.
  function setStep(k) {
    const n = Math.max(1, numSteps);
    if (direction === 'fwd') {
      currentStep = k % n;
    } else if (direction === 'rev') {
      currentStep = (n - 1 - (k % n) + n) % n;
    } else if (direction === 'ping') {
      // Up then back without repeating the ends: a period of 2n-2.
      const period = Math.max(1, 2 * n - 2);
      const r = k % period;
      if (r < n) { currentStep = r; pingDir = 1; } else { currentStep = period - r; pingDir = -1; }
    }
    // Random keeps its own counsel; only its phase is aligned.
  }

  /// Lay the grid so that context time `ctx` is engine time `at`, and point the
  /// scheduler at step boundary `k`. A grid still waiting ahead is replaced.
  function layGrid(ctx, at, k) {
    setStep(k);
    nextNoteTime = ctx + (k * stepDur() - at);
    grid = grid.filter((g) => g.ctx < ctx);
    grid.push({ ctx, at });
    if (grid.length > 8) grid.splice(0, grid.length - 8);
  }

  /// Where the grid has got to in engine time, at the context's now.
  function gridNow() {
    if (!audioCtx || !grid.length) return null;
    const now = audioCtx.currentTime;
    let g = grid[0];
    for (const x of grid) if (x.ctx <= now) g = x;
    return g.at + (now - g.ctx);
  }

  /// Lay the grid along the engine's time and point the scheduler at the next
  /// step boundary after `at`.
  function locate(at) {
    if (!audioCtx) return;
    const d = stepDur();
    if (route.on) {
      // Routed, the grid is laid two render quanta on, so no sample already
      // rendered is claimed for it; on whole frames, so every stamp is exact;
      // and a step that falls on `at` itself sounds, since the engine has not
      // reached it yet.
      const sr = audioCtx.sampleRate;
      const c = Math.round(audioCtx.currentTime * sr) + 256;
      const f = Math.round(Math.max(0, at) * sr);
      routeSegment(c, f);
      layGrid(c / sr, f / sr, Math.ceil(f / sr / d - 1e-9));
    } else {
      layGrid(audioCtx.currentTime, at, Math.floor(Math.max(0, at) / d) + 1);
    }
    // Carried forward on the wall clock rather than the audio clock: a
    // context the browser has kept asleep — no gesture yet, or no device at
    // all — has a `currentTime` that does not move, and a clock that does not
    // move would read every message as a seek.
    anchor = { perf: performance.now(), at };
    last = { at, step: currentStep, wait: nextNoteTime - audioCtx.currentTime };
  }

  /// Called by the scheduler before it lays each step. A step at or past the
  /// end of the engine's loop is not played: the grid is laid again from the
  /// loop's start at the moment the old grid reaches its end, and the scheduler
  /// looks again. The take and the clock go round at that same moment. It used
  /// to wait to be told the engine had wrapped, a quarter of a second or so
  /// after it had. Returns whether it wrapped.
  function wrapBefore(t) {
    if (!driven || !loopSec || !grid.length || !audioCtx) return false;
    const g = grid[grid.length - 1];
    if (g.at + (t - g.ctx) < loopSec.b - 1e-9) return false;
    const d = stepDur();
    let ctxB = Math.max(audioCtx.currentTime, g.ctx + (loopSec.b - g.at));
    let a = loopSec.a;
    if (route.on) {
      // On whole frames, carried on from the grid being left, so the stamps
      // after the wrap follow the ones before it with no gap and no overlap.
      const sr = audioCtx.sampleRate;
      const s = route.segs[route.segs.length - 1];
      const aF = Math.round(loopSec.a * sr);
      const bF = Math.round(loopSec.b * sr);
      const soonest = Math.round(audioCtx.currentTime * sr) + 256;
      const c = Math.max(soonest, s ? s.c + (bF - s.d) : Math.round(ctxB * sr));
      routeSegment(c, aF);
      ctxB = c / sr;
      a = aF / sr;
    }
    layGrid(ctxB, a, Math.ceil(a / d - 1e-9));
    setTimeout(() => {
      if (!driven || !audioCtx) return;
      const into = a + Math.max(0, audioCtx.currentTime - ctxB);
      anchor = { perf: performance.now(), at: into };
      if (takeOn) takePlayAt(into);
    }, Math.max(0, (ctxB - audioCtx.currentTime) * 1000));
    return true;
  }

  /// The loop the host says the engine is going round, in engine seconds.
  function loopTo(l) {
    loopSec = l && Number.isFinite(l.a) && Number.isFinite(l.b) && l.b > l.a ? { a: +l.a, b: +l.b } : null;
  }

  /// A time taken round the loop, if it has gone past the end of it.
  function wrapInto(at) {
    if (!loopSec || at < loopSec.b) return at;
    return loopSec.a + ((at - loopSec.a) % (loopSec.b - loopSec.a));
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
    driven = true;
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
    driven = false;
    grid = [];
    loopSec = null;
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

  // ── one output ───────────────────────────────────────────────────────────
  //
  // Played here, the sequencer meets the engine in the air: the browser's
  // sound card and the engine's each start when they get round to it, so the
  // two are close and never to the sample. **Routed, the page does not play
  // it.** Its master is tapped by a worklet, each block of samples is stamped
  // with the engine output frame it belongs at, and a worker posts the blocks
  // to the engine (`POST /api/engine/seq`), which adds them in on exactly those
  // frames — so both voices leave through one device together.
  //
  // **The stamps come from the grid.** A step on boundary k is laid at the
  // context time the grid says is engine time k × the step, and a sample the
  // context renders at frame x is stamped with engine frame x plus the same
  // offset — so a note lands on the frame of its step whenever the context
  // happened to render it. Routed, the grid is kept on whole frames, so the
  // two sides of that sum never round apart.
  //
  // **It runs ahead.** The host starts this page where the engine is and the
  // engine a lead later, so the sound is waiting when the engine reaches it;
  // the page's own output is silent meanwhile, and comes back when it stops.
  // An engine that will not take the sound (no engine running, a request that
  // fails) puts the page back to playing it, and the host is told.
  //
  // See `docs/SEQUENCER.md`, "one output".

  const route = {
    want: null, on: false, epoch: 0, segs: [], serial: 0, leadAt: null,
    ctx: null, gain: null, node: null, hush: null, door: null,
    worker: null, module: null, sent: [],
    /// Said-when-flowing: the host is told the sound is going to the engine
    /// once the engine has taken some. `batches`, `stats`, `jumps` and
    /// `aheadNow` are for anyone asking how it is going — the tests, and a
    /// person at the speakers.
    pending: null, batches: 0, stats: null, jumps: 0, strays: 0, aheadNow: null,
  };

  /// The tap: a block of the master's samples at a time, with the context
  /// frame the block began at, handed to whoever holds the port.
  const TAP_SOURCE = `
class SeqTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.on = false;
    this.done = false;
    this.size = 512;
    this.buf = new Float32Array(this.size * 2);
    this.n = 0;
    this.start = 0;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.port) { if (this.out) this.out.close(); this.out = m.port; }
      if (m.on !== undefined) { this.on = !!m.on; this.n = 0; }
      if (m.done) { this.done = true; if (this.out) this.out.close(); this.out = null; }
    };
  }
  process(inputs) {
    if (this.done) return false;
    if (!this.on || !this.out) return true;
    const input = inputs[0] || [];
    const frames = input.length ? input[0].length : 128;
    const L = input[0];
    const R = input[1] || input[0];
    for (let i = 0; i < frames; i++) {
      if (this.n === 0) this.start = currentFrame + i;
      this.buf[this.n * 2] = L ? L[i] : 0;
      this.buf[this.n * 2 + 1] = R ? R[i] : 0;
      if (++this.n === this.size) {
        this.out.postMessage({ frame: this.start, data: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(this.size * 2);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('seq-tap', SeqTap);
`;

  /// The sender, on a thread of its own so the page's work never holds it up:
  /// blocks stamped by the segments of the grid, runs that follow on from each
  /// other joined, and posted every forty milliseconds or so.
  const SEND_SOURCE = `
let segs = [];
let epoch = 0;
let url = '';
let sink = false;
let open = false;
let busy = false;
let timer = 0;
let told = false;
let tap = null;
let posts = 0;
let slowest = 0;
let failures = 0;
const queue = [];
onmessage = (e) => {
  const m = e.data || {};
  // Only the newest tap is heard. An older one — a context built again — is let go.
  if (m.port) { if (tap) tap.close(); tap = m.port; tap.onmessage = (ev) => take(ev.data); }
  if (m.url) url = m.url;
  if (m.sink !== undefined) sink = !!m.sink;
  if (m.epoch !== undefined && m.epoch !== epoch) { epoch = m.epoch; queue.length = 0; }
  if (m.segs) segs = m.segs;
  if (m.open !== undefined) { open = !!m.open; if (!open) queue.length = 0; told = false; }
  if (m.again) told = false;
};
setInterval(() => { if (open) postMessage({ stats: { posts, slowest: Math.round(slowest), failures } }); }, 1000);
function take(b) {
  if (!open || !segs.length || !b || !b.data) return;
  const n = b.data.length / 2;
  let i = 0;
  while (i < n) {
    const frame = b.frame + i;
    let s = null;
    let next = null;
    for (const x of segs) { if (x.c <= frame) s = x; else { next = x; break; } }
    const end = next ? Math.min(n, next.c - b.frame) : n;
    if (s) queue.push({ at: s.d + (frame - s.c), epoch, data: b.data.subarray(i * 2, end * 2) });
    i = end;
  }
  if (!timer) timer = setTimeout(() => { timer = 0; flush(); }, 40);
}
async function flush() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const first = queue[0];
    const parts = [];
    let frames = 0;
    while (queue.length && queue[0].epoch === first.epoch && queue[0].at === first.at + frames && frames < 24000) {
      const q = queue.shift();
      parts.push(q.data);
      frames += q.data.length / 2;
    }
    const body = new Float32Array(frames * 2);
    let o = 0;
    for (const p of parts) { body.set(p, o); o += p.length; }
    let ok = false;
    try {
      if (sink) {
        postMessage({ sent: { at: first.at, epoch: first.epoch, data: body } }, [body.buffer]);
        ok = true;
      } else {
        const t0 = performance.now();
        const r = await fetch(url + '?at=' + first.at + '&epoch=' + first.epoch + '&channels=2', { method: 'POST', body });
        const took = performance.now() - t0;
        posts++;
        if (took > slowest) slowest = took;
        if (r.ok) ok = true;
        else { failures++; postMessage({ failed: r.status }); }
      }
    } catch (err) {
      failures++;
      postMessage({ failed: String(err) });
    }
    if (ok && !told) { told = true; postMessage({ flowing: true }); }
  }
  busy = false;
}
`;

  let tapUrl = null;
  let sendUrl = null;

  // A context built while routing is wanted is built at the engine's rate, or
  // no frame of it would line up with a frame of the engine's.
  const NativeContext = window.AudioContext || window.webkitAudioContext;
  let wantRate = 0;
  if (NativeContext) {
    const Rated = function (options) {
      const o = Object.assign({}, options || {});
      if (wantRate && !o.sampleRate) o.sampleRate = wantRate;
      return new NativeContext(o);
    };
    Rated.prototype = NativeContext.prototype;
    window.AudioContext = Rated;
  }

  /// Build the page's context again at the engine's rate, its knobs where they
  /// stood. Never while it plays.
  function rebuildAt(rate) {
    wantRate = rate;
    if (!audioCtx || audioCtx.sampleRate === rate || isPlaying) return;
    const knobs = typeof getPresetState === 'function' ? getPresetState() : null;
    const old = audioCtx;
    audioCtx = null;
    tapM = null; tapL = null; tapR = null;
    initAudio();
    if (old.close) old.close().catch(() => {});
    if (knobs && typeof applyPresetState === 'function') applyPresetState(knobs);
  }

  /// A new piece of the grid for the sender: context frame `c` is engine frame
  /// `d`. One still waiting ahead of it is replaced.
  function routeSegment(c, d) {
    route.segs = route.segs.filter((x) => x.c < c);
    route.segs.push({ c, d });
    if (route.segs.length > 16) route.segs.splice(0, route.segs.length - 16);
    if (route.worker) route.worker.postMessage({ segs: route.segs, epoch: route.epoch });
  }

  /// Hang the tap on the sequencer's master and silence the page's own output.
  /// Resolves to whether it is sending.
  function routeUp(w) {
    if (typeof initAudio === 'function') initAudio();
    if (!audioCtx || !NativeContext || typeof Worker === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      return Promise.resolve(false);
    }
    rebuildAt(w.rate);
    const ctx = audioCtx;
    if (ctx.sampleRate !== w.rate || !ctx.audioWorklet) return Promise.resolve(false);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (route.on && route.ctx === ctx && route.gain === masterGain) {
      route.worker.postMessage({ sink: !!w.sink, url: ORIGIN + (w.url || '/api/engine/seq'), again: true });
      return Promise.resolve(true);
    }
    if (!route.module || route.module.ctx !== ctx) {
      tapUrl = tapUrl || URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'application/javascript' }));
      route.module = { ctx, ready: ctx.audioWorklet.addModule(tapUrl) };
    }
    return route.module.ready.then(() => {
      if (audioCtx !== ctx || !masterGain) return false;
      if (!route.worker) {
        sendUrl = sendUrl || URL.createObjectURL(new Blob([SEND_SOURCE], { type: 'application/javascript' }));
        route.worker = new Worker(sendUrl);
        route.worker.onmessage = (e) => routeHeard(e.data || {});
      }
      // **One tap for the life of a context**, switched on and off. A tap was
      // made for every Play, and one taken off by a stop went on running,
      // posting silence stamped with the frames the new one was sending — on
      // the speakers, the sequencer came and went, and the engine was sent
      // several times as much as it could use.
      if (!route.node || route.node.context !== ctx) {
        if (route.node) {
          try { route.node.port.postMessage({ done: true }); route.node.disconnect(); } catch { /* gone */ }
        }
        const node = new AudioWorkletNode(ctx, 'seq-tap', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        });
        const pipe = new MessageChannel();
        node.port.postMessage({ port: pipe.port1 }, [pipe.port1]);
        route.worker.postMessage({ port: pipe.port2 }, [pipe.port2]);
        // Pulled by the context through a silent gain: a worklet no one
        // listens to is not run.
        const hush = ctx.createGain();
        hush.gain.value = 0;
        node.connect(hush);
        hush.connect(ctx.destination);
        route.node = node;
        route.hush = hush;
      }
      masterGain.connect(route.node);
      route.node.port.postMessage({ on: true });
      try { masterGain.disconnect(ctx.destination); } catch { /* not connected */ }
      if (route.door && route.door.context === ctx) {
        try { masterGain.disconnect(route.door); } catch { /* not connected */ }
      }
      Object.assign(route, { on: true, ctx, gain: masterGain, sent: [], leadAt: null });
      route.worker.postMessage({
        open: true, url: ORIGIN + (w.url || '/api/engine/seq'), sink: !!w.sink, epoch: route.epoch, segs: [],
      });
      return true;
    }, () => false);
  }

  /// Take the tap off, and give the page its own output back a moment later,
  /// faded up — the engine fades the sequencer out on what it already has.
  function routeDown() {
    if (!route.on) return;
    route.on = false;
    if (route.worker) route.worker.postMessage({ open: false });
    const { ctx, gain, node } = route;
    Object.assign(route, { ctx: null, gain: null, segs: [], leadAt: null });
    // The tap is kept, switched off: made again on every Play, the old ones ran on.
    if (node) node.port.postMessage({ on: false });
    try { gain.disconnect(node); } catch { /* gone */ }
    setTimeout(() => {
      if (route.on || audioCtx !== ctx || masterGain !== gain) return;
      if (!route.door || route.door.context !== ctx) {
        route.door = ctx.createGain();
        route.door.connect(ctx.destination);
      }
      const now = ctx.currentTime;
      route.door.gain.cancelScheduledValues(now);
      route.door.gain.setValueAtTime(0, now);
      route.door.gain.linearRampToValueAtTime(1, now + 0.08);
      gain.connect(route.door);
    }, 300);
  }

  /// What the sender says: a run it was asked to keep, for the tests; or that
  /// the engine would not take one.
  function routeHeard(m) {
    if (m.sent) {
      route.batches++;
      route.sent.push(m.sent);
      if (route.sent.length > 4000) route.sent.shift();
    }
    if (m.stats) route.stats = m.stats;
    if (m.flowing && route.pending) route.pending.say();
    if (m.failed !== undefined && route.on) {
      route.pending = null;
      // The page plays the sequencer again, its grid brought back from a lead
      // ahead of the engine to the engine itself.
      const epoch = route.epoch;
      const lead = route.want ? route.want.lead : 0;
      const at = gridNow();
      routeDown();
      route.want = null;
      if (isPlaying && at !== null) {
        locate(wrapInto(Math.max(0, at - lead)));
        if (takeOn) takePlayAt(last.at);
      }
      post({ type: 'seq:route', on: false, epoch, why: String(m.failed) });
    }
  }

  /// The engine's clock, while routed. A seek arrives as a new epoch: what was
  /// sent before it is let go, and the grid laid again a lead ahead of where
  /// the engine now is. Otherwise the first reading after a start is the lead
  /// to keep, and the grid is laid again only when the clocks have parted by
  /// enough to matter, or the sound would come too late to be placed.
  function routedClock(m) {
    const lead = route.want ? route.want.lead : 0.12;
    const jump = (at) => {
      locate(at);
      if (takeOn) takePlayAt(at);
      route.leadAt = null;
      route.strays = 0;
      route.jumps++;
    };
    // Where the engine is now. The host read its clock when it sent this, and
    // a busy page can be a good while getting round to the message — every
    // millisecond of that looked like the page running further ahead.
    const since = Number.isFinite(m.sentAt)
      ? Math.max(0, (performance.timeOrigin + performance.now() - m.sentAt) / 1000) : 0;
    const engineAt = m.at + since;
    if (Number.isFinite(m.epoch) && m.epoch > route.epoch) {
      route.epoch = m.epoch;
      route.segs = [];
      if (route.worker) route.worker.postMessage({ segs: [], epoch: route.epoch });
      jump(wrapInto(engineAt + lead));
      return;
    }
    const pageAt = gridNow();
    if (pageAt === null) return;
    let ahead = pageAt - engineAt;
    if (loopSec) {
      // Round a loop the page goes round a lead before the engine does.
      const span = loopSec.b - loopSec.a;
      if (ahead < -span / 2) ahead += span;
      else if (ahead > span / 2) ahead -= span;
    }
    route.aheadNow = ahead;
    // Behind, so its sound is refused as late, or parted from the lead it
    // started with. **Two readings in a row, not one**: laying the grid again
    // is itself a gap or a repeat in the sound, and one reading out of line is
    // far more often a page that was busy than clocks that have parted.
    const out = ahead < 0.02 || (route.leadAt !== null && Math.abs(ahead - route.leadAt) > 0.1);
    route.strays = out ? route.strays + 1 : 0;
    if (route.strays >= 2) { jump(wrapInto(engineAt + lead)); return; }
    if (route.leadAt === null && !out) route.leadAt = ahead;
  }

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
    routeDown();
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
      const serial = ++route.serial;
      if (m.playing) {
        const start = () => {
          if ('loop' in m) loopTo(m.loop);
          playAt(at);
          takeOn = true;
          takePlayAt(at);
        };
        if (m.route && Number.isFinite(m.route.rate)) {
          // Through the engine: the tap up first, then the grid laid on it,
          // then the host told, which starts the engine a lead later.
          route.want = m.route;
          route.epoch = m.route.epoch || 0;
          route.segs = [];
          routeUp(m.route).then((on) => {
            if (serial !== route.serial) {
              if (!route.want) routeDown();
              return;
            }
            if (!on) route.want = null;
            start();
            if (!on) {
              post({ type: 'seq:route', on: false, epoch: m.route.epoch, at });
              return;
            }
            // **Said once the engine has taken the first of the sound**, not the
            // moment the tap is up: a sender just started can take longer than
            // the lead to post anything, and an engine started without it lost
            // the first notes. A second at most, then said regardless.
            const pending = {
              say: () => {
                if (route.pending !== pending) return;
                route.pending = null;
                post({ type: 'seq:route', on: route.on, epoch: m.route.epoch, at });
              },
            };
            route.pending = pending;
            setTimeout(pending.say, 1000);
          });
        } else {
          routeDown();
          route.want = null;
          start();
        }
      } else {
        takeOn = false;
        stop();
        takeStop();
        routeDown();
        route.want = null;
      }
    } else if (m.type === 'seq:clock') {
      // The engine's position, while it plays. A seek shows up as a jump and
      // drift as a creep. Both are answered the same way, by laying the grid
      // again — but only past the threshold, so a clock that is merely a few
      // milliseconds out is not forever being nudged. Round a loop, the page
      // wraps on its own; a clock just the other side of the wrap is not a jump.
      if ('loop' in m) loopTo(m.loop);
      if (!m.playing || !isPlaying || !Number.isFinite(m.at)) return;
      if (route.on) { routedClock(m); return; }
      const p = predicted();
      let off = p === null ? Infinity : Math.abs(p - m.at);
      if (loopSec && Number.isFinite(off)) off = Math.min(off, Math.abs(loopSec.b - loopSec.a - off));
      if (off > RELOCATE_S) {
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
    } else if (m.type === 'seq:take-edit') {
      takeEdit(m);
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
      // Where the take found the control, from its start, held until the first
      // gesture takes it — which is how the take plays it: the knob stays put,
      // then moves. It used to be drawn as a slope into the first gesture. Left
      // out when the first gesture starts from that same value, which says it.
      if (Number.isFinite(snap) && Math.abs(gs[0].points[0][1] - snap) > 1e-9) {
        pts.push([start, unit(snap)]);
        if (gs[0].t0 > 1e-6) pts.push([start + gs[0].t0, unit(snap)]);
      }
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
    // Every control a lane can move, with where the take found it on nought to
    // one — what the host's editor offers, and where a new lane starts.
    const controls = PERF_SLIDERS.map((id) => {
      const el = document.getElementById(id);
      const lo = el ? +el.min : 0;
      const hi = el ? +el.max : 100;
      const snap = p.snapshot && p.snapshot.sliders ? parseFloat(p.snapshot.sliders[id]) : NaN;
      const v = Number.isFinite(snap) ? snap : el ? +el.value : lo;
      return [id, typeof perfLaneLabel === 'function' ? perfLaneLabel(id) : id,
        hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5];
    });
    return {
      type: 'seq:take', tempo,
      take: { id: p.id, name: p.name, startAt: start, duration: +p.duration || 0, lanes, discretes, controls },
    };
  }

  /// **The host's timeline, editing the take.** A lane arrives as `takeMessage`
  /// sends one — points in the engine's output seconds, on nought to one — and
  /// goes back into the take as one gesture on its control: the points in the
  /// take's own time and the control's own units, and the first of them the
  /// value the take finds the control at. `to` moves the lane onto another
  /// control; no points removes it; `lanes`, a whole set, replaces every lane
  /// the take has, which is what an undo sends. A point before the take began
  /// moves its start back, and one after it ended moves its end on. Nothing is
  /// done while a take is being recorded.
  function takeEdit(m) {
    const p = typeof perfLoaded !== 'undefined' ? perfLoaded : null;
    if (!p || (typeof perfRec !== 'undefined' && perfRec)) return false;
    const whole = Array.isArray(m.lanes);
    const edits = whole ? m.lanes : [{ id: m.id, to: m.to, points: m.points }];
    if (whole) p.gestures = p.gestures.filter((g) => g.kind !== 'slider');
    for (const e of edits) {
      const from = String(e.id || '').replace(/^seq:/, '');
      const to = String(e.to || from).replace(/^seq:/, '');
      if (!PERF_SLIDER_SET.has(from) || !PERF_SLIDER_SET.has(to)) continue;
      const pts = (Array.isArray(e.points) ? e.points : [])
        .filter((q) => Array.isArray(q) && Number.isFinite(+q[0]) && Number.isFinite(+q[1]))
        .map(([t, v]) => [+t, Math.max(0, Math.min(1, +v))])
        .sort((a, b) => a[0] - b[0]);
      p.gestures = p.gestures.filter((g) => !(g.kind === 'slider' && (g.id === from || g.id === to)));
      if (!pts.length) continue;
      const began = +p.startAt || 0;
      if (pts[0][0] < began) {
        const back = began - pts[0][0];
        for (const g of p.gestures) {
          if (g.kind === 'slider') {
            g.t0 += back;
            g.t1 += back;
            g.points = g.points.map(([t, v]) => [t + back, v]);
          } else {
            g.t += back;
          }
        }
        p.startAt = pts[0][0];
        p.duration = (+p.duration || 0) + back;
      }
      const start = +p.startAt || 0;
      const el = document.getElementById(to);
      const lo = el ? +el.min : 0;
      const hi = el ? +el.max : 100;
      const raw = (v) => +(lo + v * (hi - lo)).toFixed(2);
      const points = pts.map(([t, v]) => [+(t - start).toFixed(3), raw(v)]);
      p.gestures.push({ kind: 'slider', id: to, t0: points[0][0], t1: points[points.length - 1][0], points, gen: false });
      p.snapshot = p.snapshot || {};
      p.snapshot.sliders = { ...(p.snapshot.sliders || {}), [to]: String(raw(pts[0][1])) };
      p.duration = Math.max(+p.duration || 0, pts[pts.length - 1][0] - start);
    }
    p.gestures.sort((a, b) => (a.t0 ?? a.t) - (b.t0 ?? b.t));
    if (typeof perfSelectedGesture !== 'undefined') perfSelectedGesture = null;
    if (typeof perfPersistLoaded === 'function') perfPersistLoaded();
    if (typeof perfUpdateSelInfo === 'function') perfUpdateSelInfo();
    if (typeof perfUpdateHeader === 'function') perfUpdateHeader();
    if (typeof perfDrawTimeline === 'function') perfDrawTimeline();
    postTake();
    return true;
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
  window.seqBridge = {
    predicted, stepDur, locate, renderFilm, takeMessage, takePlayAt, takeValuesAt, takeEdit, wrapBefore,
    /// How far behind the sound a step's light comes on: routed, the page runs
    /// a lead ahead of what is heard.
    uiDelay: () => (route.on && route.want ? (route.leadAt ?? route.want.lead) : 0),
    routeState: () => ({
      on: route.on, epoch: route.epoch, segs: route.segs.slice(), loop: loopSec, grid: grid.slice(),
      batches: route.batches, stats: route.stats, jumps: route.jumps, leadAt: route.leadAt, aheadNow: route.aheadNow,
    }),
    /// The runs the sender kept rather than posted, taken — for the tests.
    routeSent: () => route.sent.splice(0),
    get last() { return last; },
  };

  // Thirty times a second, which is what the engine's meter is polled at.
  setInterval(tick, 33);
  setInterval(postTake, 300);
  post({ type: 'seq:ready' });
})();
