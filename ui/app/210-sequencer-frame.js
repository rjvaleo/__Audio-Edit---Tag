// ───────────────────────────────────────────────── the sequencer, in a frame ──
//
// The scale sequencer is its own program — a browser synth with a step grid
// and a performance recorder — and it runs here as itself, in a frame under the
// Seq button, served from this binary at `/sequencer/`. Nothing of it is
// copied into this file. What crosses the frame boundary is two messages each
// way: the engine's play and stop go in, and the sequencer's sound comes out as
// a spectrum and a figure the room can draw, mixed with the engine's own.
//
// **The mix is a picture, not a signal.** The engine plays through the sound
// card and the sequencer through the browser; they meet in the air. What is
// mixed here is what the room is drawn from, so the visual is both voices at
// once. Mixing the audio itself — for the export, and for a third and fourth
// voice — means feeding the sequencer into the engine, which is the next step
// and is not this one. See `docs/SEQUENCER.md`.

const seq = {
  feed: null, feedAt: 0, ready: false, clock: null, want: { bands: 0, lo: 0, hi: 0 }, compact: false,
  /// The sequencer's take and tempo, as its bridge last sent them — drawn on
  /// the timeline beside the grain's lanes. See `perf-panel.js`.
  take: null, tempo: null,
  /// **Playing through the engine.** `epoch` is the transport's, bumped by
  /// every start, stop and seek and told to both the bridge and the engine;
  /// `routed` is whether the bridge has said its sound is going to the engine;
  /// `rolling` is a Play waiting for the sequencer to be under way. `routeSink`
  /// and `routeUrl` are for the tests: keep the sound in the page, or post it
  /// somewhere else. See `docs/SEQUENCER.md`, "one output".
  epoch: 0, routed: false, rolling: null, routeSink: false, routeUrl: null,
};

/// How far ahead of the engine the sequencer runs when it plays through the
/// engine, in seconds: time for its sound to be made, posted and waiting before
/// the engine reaches the frames it belongs at. What it costs: a sequencer knob
/// is heard this much after it is turned.
const SEQ_ROUTE_LEAD = 0.12;
/// How long a Play waits for the sequencer to say it is under way before the
/// engine starts regardless.
const SEQ_ROUTE_WAIT_MS = 1500;

/// A new epoch. **Counted on the wall clock, not from nought**, so two windows
/// on one engine agree which of them spoke last. Counted from nought, the window
/// used longer held the higher number, and the engine refused every other
/// window's sound as having come from before a seek it never made.
function seqNextEpoch() {
  seq.epoch = Math.max(seq.epoch + 1, Date.now());
  return seq.epoch;
}

/// Whether the sequencer's sound goes through the engine: the setting, a
/// device known to be there, and the sequencer loaded and switched on.
function seqRouting() {
  return !!prefs.seqRoute && engine.device === true && seqLoaded() && sourceOn('seq') && engine.deviceRate > 0;
}

/// The engine's loop, in its output seconds, for the sequencer to go round:
/// the loop the engine reports while it plays, and otherwise the one the
/// transport is about to ask it for — worked out the way `applyLoop` asks.
function seqLoopSeconds() {
  if (!state.loopOn) return null;
  const rate = engine.deviceRate || 48000;
  let lp = engine.playing && !engine.rolling && engine.loop && engine.loop.b > engine.loop.a ? engine.loop : null;
  if (!lp) {
    const hasSel = !!state.sel && state.sel.end > state.sel.start;
    const end = Math.round((state.edit?.frames || state.view?.frames || 0) / rateScale());
    const a = hasSel ? Math.max(0, Math.round(engineFromSrc(state.sel.start))) : 0;
    let b = hasSel ? Math.max(0, Math.round(engineFromSrc(state.sel.end))) : 0;
    b = b === 0 ? end : Math.min(b, Math.max(1, end));
    if (!(b > a + 64)) return null;
    lp = { a, b };
  }
  return { a: lp.a / rate, b: lp.b / rate };
}

function seqFrame() { return $('seqFrame'); }

/// Give the frame its address the first time it is shown. A session that never
/// opens the sequencer never loads it, and never starts its audio context.
function seqEnsureFrame() {
  const f = seqFrame();
  if (f && !f.getAttribute('src')) f.src = '/sequencer/';
}

function seqPost(m) {
  const f = seqFrame();
  if (f && f.getAttribute('src') && f.contentWindow) f.contentWindow.postMessage(m, location.origin);
}

/// The sequencer's compact layout: its own, inside its page, for a cell of the
/// Compose workspace. Remembered here, because a frame that reloads comes back
/// in its full layout and has to be told again — see the `seq:ready` handler.
function seqCompact(on) {
  seq.compact = !!on;
  seqPost({ type: 'seq:compact', on: seq.compact });
}

/// The sequencer's recorder, armed with the grain's: one REC PERF for both.
function seqArm(on) {
  seqPost({ type: 'seq:arm', on: !!on });
}

/// Ask the sequencer for its state and its take, for a composition. Resolves
/// to `{ state, take }`, or null if it is not loaded or does not answer.
let seqStateId = 0;
const seqStateWaiting = new Map();
function seqRequestState() {
  if (!seqLoaded()) return Promise.resolve(null);
  const id = ++seqStateId;
  return new Promise((resolve) => {
    seqStateWaiting.set(id, resolve);
    seqPost({ type: 'seq:state-get', id });
    setTimeout(() => { if (seqStateWaiting.delete(id)) resolve(null); }, 3000);
  });
}

/// The engine's transport, told to the sequencer. Play plays it *from where
/// the engine is*; stop stops it. The position is the engine's output time in
/// seconds — `playbackTime` — which is the one clock both run on.
///
/// **Through the engine** (`seqRouting`), with the engine's transport under it
/// — started by Play (`preroll`), or joining an engine already playing — the
/// sequencer is told the engine's rate, the lead, the epoch and the loop, and
/// sends its sound to the engine instead of playing it. Started by Play, this
/// resolves when the engine should start: a lead after the sequencer says it is
/// under way, or once it has waited long enough. Otherwise it returns null.
function seqSync(playing, { preroll = false } = {}) {
  // The SEQ switch: off, the sequencer is told to stop whatever the engine
  // does, and is not clocked.
  playing = playing && sourceOn('seq');
  const routed = playing && seqRouting() && (preroll || engine.playing);
  const wasRouted = seq.routed;
  seqNextEpoch();
  seq.routed = false;
  seq.rolling?.done(false);
  const rate = engine.deviceRate || 48000;
  let at = playing ? playbackTime() : 0;
  if (routed) {
    // Frames made rather than heard: those are what the sound is stamped
    // against. **Starting with the engine, exactly where it is** — it has not
    // moved, and carried forward on the few milliseconds since Play was pressed
    // the sequencer began past its first step, so a note on the first frame was
    // never played. Joining an engine already playing, a lead ahead of it, so
    // its sound is on time.
    at = preroll ? engine.position / rate : enginePosition(true) / rate + SEQ_ROUTE_LEAD;
  }
  const msg = { type: 'seq:transport', playing, at, loop: seqLoopSeconds() };
  if (routed) {
    msg.route = {
      rate, lead: SEQ_ROUTE_LEAD, epoch: seq.epoch,
      sink: !!seq.routeSink, url: seq.routeUrl || undefined,
    };
  }
  seqPost(msg);
  clearInterval(seq.clock);
  seq.clock = null;
  if (playing) {
    // The position, four times a second, so a seek or a loop wrap reaches the
    // sequencer and a creep between the two clocks is caught. The sequencer
    // decides whether the difference is worth acting on.
    seq.clock = setInterval(seqClock, 250);
  }
  // No longer through the engine while it plays on: what it holds is let go.
  if (!routed && wasRouted && engine.playing) enginePost({ seqEpoch: seq.epoch });
  if (!routed || !preroll) return null;
  const epoch = seq.epoch;
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), SEQ_ROUTE_WAIT_MS);
    function done(on) {
      if (!seq.rolling || seq.rolling.epoch !== epoch) return;
      seq.rolling = null;
      clearTimeout(timer);
      resolve(on);
    }
    seq.rolling = { epoch, done };
  });
}

function seqClock() {
  if (!engine.playing || engine.rolling) return;
  const at = seq.routed ? enginePosition(true) / (engine.deviceRate || 48000) : playbackTime();
  seqPost({
    type: 'seq:clock', playing: true, at, epoch: seq.epoch, loop: seqLoopSeconds(),
    // When the clock was read, on the clock both pages share — so the bridge
    // can take out however long it was before it got to the message.
    sentAt: performance.timeOrigin + performance.now(),
  });
}

/// Ask for the spectrum in the shape the room is about to draw.
function seqAsk(bands, lo, hi) {
  if (seq.want.bands === bands && seq.want.lo === lo && seq.want.hi === hi) return;
  seq.want = { bands, lo, hi };
  seqPost({ type: 'seq:want', bands, lo, hi });
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const m = e.data || {};
  if (m.type === 'seq:ready') {
    seq.ready = true;
    seqSync(engine.playing);
    // A frame that reloaded comes up in its full layout; say compact again.
    if (seq.compact) seqPost({ type: 'seq:compact', on: true });
  } else if (m.type === 'seq:route') {
    // Whether the sequencer's sound is going to the engine. An answer for an
    // epoch that has since passed is not true of anything now.
    if (m.epoch !== seq.epoch) return;
    seq.routed = !!m.on;
    const rolling = seq.rolling;
    if (rolling && rolling.epoch === m.epoch) {
      if (m.on) setTimeout(() => rolling.done(true), SEQ_ROUTE_LEAD * 1000);
      else rolling.done(false);
    }
  } else if (m.type === 'seq:state') {
    const done = seqStateWaiting.get(m.id);
    if (done) {
      seqStateWaiting.delete(m.id);
      done({ state: m.state || null, take: m.take || null });
    }
  } else if (m.type === 'seq:take') {
    seq.take = m.take || null;
    seq.tempo = m.tempo || null;
    if ($('perfCanvas')) {
      perfFillLaneSelect();
      perfUpdateHeader();
      perfDrawTimeline();
    }
  } else if (m.type === 'seq:feed') {
    seq.feed = m.playing ? m : null;
    seq.feedAt = performance.now();
  } else if (m.type === 'seq:render-progress') {
    for (const r of seqRenders.values()) r.onProgress?.(m.fraction || 0);
  } else if (m.type === 'seq:rendered') {
    const r = seqRenders.get(m.id);
    if (!r) return;
    seqRenders.delete(m.id);
    if (m.error) r.reject(new Error(`the sequencer could not render: ${m.error}`));
    else r.resolve(m);
  }
});

/// Whether the sequencer is sounding right now — a feed that has gone quiet
/// for half a second is a frame that stopped, not a silence to keep drawing.
function seqPlaying() {
  return !!seq.feed && performance.now() - seq.feedAt < 500;
}

/// The engine's master feed with the sequencer's sound folded in.
///
/// Spectra add as power, so two voices at the same level read six decibels
/// louder than one, which is what a meter would say. The figures add as
/// samples and clip at the rails, which is what a scope would show. With the
/// engine silent the sequencer's feed stands in whole, so the room still has
/// something to draw.
function seqMix(data, bands) {
  if (!sourceOn('seq') || !seqPlaying()) return data;
  const f = seq.feed;
  seqAsk(bands, data?.lo || 20, data?.hi || 20000);
  const spec = f.spectrum || [];
  if (!data) {
    const db = (v) => 20 * Math.log10(Math.max(1e-5, v));
    const side = { vu: f.rms, vuDb: db(f.rms), vuUnits: 0, peak: f.peak, peakDb: db(f.peak) };
    return {
      live: true, seq: true, rate: f.rate || 48000, frames: 0,
      left: side, right: { ...side }, correlation: 1, overKnee: 0, vuRef: -18, knee: 0.7079458,
      lo: 20, hi: 20000, spectrum: spec.slice(0, bands), lissajous: f.lissajous || [],
    };
  }
  const out = { ...data, seq: true };
  if (Array.isArray(data.spectrum) && spec.length) {
    out.spectrum = seqMixSpectrum(data.spectrum.slice(), spec);
  }
  if (Array.isArray(data.lissajous) && Array.isArray(f.lissajous)) {
    out.lissajous = seqMixLiss(data.lissajous.slice(), f.lissajous);
  }
  return out;
}

/// What the room is drawn from. The engine's master feed with the sequencer's
/// folded into the picture — or, when the sequencer plays through the engine,
/// the engine's feed as it is, since the sequencer is in the sound already.
/// GRAIN off, the engine's feed is left out unless the sequencer is in it.
function masterFeed(r, bands) {
  const live = r && r.live ? r : null;
  if (seq.routed) return live;
  return seqMix(sourceOn('grain') ? live : null, bands);
}

/// Two spectra, in decibels, added as power — in place into `a`.
function seqMixSpectrum(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) a[i] = 10 * Math.log10(10 ** (a[i] / 10) + 10 ** (b[i] / 10));
  return a;
}

/// Two figures, added as samples and clipped at the rails — in place into `a`.
function seqMixLiss(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) a[i] = Math.max(-1, Math.min(1, a[i] + b[i]));
  return a;
}

// ── the sequencer, in the film ──
//
// The film is rendered offline, so the sequencer renders itself offline too,
// inside its frame, and hands back its sound and its picture for the film's
// span. See `renderFilm` in `ui/sequencer/bridge.js`.

const seqRenders = new Map();
let seqRenderId = 0;

/// Whether the sequencer is loaded at all — a frame that was never opened has
/// nothing to render.
function seqLoaded() {
  const f = seqFrame();
  return !!(f && f.getAttribute('src') && seq.ready);
}

/// Whether the film should carry it: loaded, and the switch on the dialog on.
function seqInFilm() {
  return seqLoaded() && !!$('elSeq')?.classList.contains('on');
}

/// Ask the frame for its part of the film. Resolves to the render, or null if
/// the sequencer is not there to ask.
function seqRenderForFilm(spec) {
  if (seqShareFits(spec)) {
    spec.onProgress?.(1);
    return Promise.resolve(seqShared.result);
  }
  if (!seqLoaded()) return Promise.resolve(null);
  const id = ++seqRenderId;
  const { onProgress, ...ask } = spec;
  const share = seqShared;
  return new Promise((resolve, reject) => {
    const kept = (r) => {
      // The first render of a composition's export is kept for the film.
      if (share && share === seqShared && !share.result && r) { share.result = r; share.spec = ask; }
      resolve(r);
    };
    seqRenders.set(id, { resolve: kept, reject, onProgress });
    seqPost({ type: 'seq:render', id, ...ask });
  });
}

/// **One render for the sound and the film.** A composition's export writes
/// the sound and then films it, and both carry the sequencer over the same
/// range — so rendering it twice was the same minutes of work done twice. While
/// the export runs this holds the render the sound asked for, made in the
/// film's shape and long enough for the film's outro, and the film is handed
/// it. `null` outside a composition's export.
let seqShared = null;

/// The film's shape, while a composition is being exported; nothing otherwise.
function seqShareSpec(seconds) {
  if (!seqShared || typeof videoPollHz !== 'function') return {};
  const fps = videoPollHz();
  return {
    fps, bands: VG_FLOOR_BANDS, liss: VG_LISS_POINTS, lo: 20, hi: 20000,
    seconds: seconds + videoOutroSeconds() + 2 / fps,
  };
}

/// Whether the render kept for the film is the one this asks for: the same
/// place, rate, loop and shape, and at least as long.
function seqShareFits(spec) {
  const s = seqShared?.spec;
  if (!s || !seqShared.result) return false;
  const same = (a, b) => Math.abs((+a || 0) - (+b || 0)) < 1e-6;
  const loops = (!s.loop && !spec.loop)
    || (!!s.loop && !!spec.loop && same(s.loop.span, spec.loop.span) && s.loop.repeats === spec.loop.repeats);
  return loops && same(s.at0, spec.at0) && s.rate === spec.rate && s.fps === spec.fps
    && s.bands === spec.bands && s.liss === spec.liss
    && same(s.lo || 20, spec.lo || 20) && same(s.hi || 20000, spec.hi || 20000)
    && s.seconds >= spec.seconds - 1e-6;
}

