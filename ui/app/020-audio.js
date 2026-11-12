// ==================================================================== audio
//
// Playback is the Rust engine's, not the browser's. There is no <audio>
// element: the engine owns the output device, renders the grains itself and
// reports where it has got to. That removes a whole category of problem the
// element used to create — a coarse media clock, cache-busted URLs to force a
// reload after every parameter change, autoplay policy, and a loop wrap driven
// from an animation frame.
//
// What is left is a thin client: post transport commands, poll for position.

const engine = {
  path: null,
  /// Whether what is loaded is the bare file or the document.
  ///
  /// The library auditions a sound; the editor plays a document. Both go
  /// through the same load, so the engine has to remember which it was given
  /// or pressing play in the editor would resume the audition.
  raw: false,
  playing: false,
  /// The ratio the engine's position is counted at, from its own reports.
  ratio: 0,
  /// Engine output frames, at the device's rate. Authoritative.
  position: 0,
  deviceRate: 48000,
  /// performance.now() when `position` was last heard from.
  heard: 0,
  /// Whether this machine has an audio output at all.
  ///
  /// `null` until asked. The server opens the device lazily, so a box with no
  /// output answers every engine route with 503 — and the interface used to
  /// keep asking, which put a failed request in the console for every engine
  /// switch and every transport press. Browsing, editing, tagging and
  /// exporting all work perfectly well without a device; only playback does
  /// not. So it asks once and then stops asking.
  device: null,
  spectrum: null,
  /// The shape of the last output window, -127..127. What the compressor's
  /// display draws its signal from.
  waveform: null,
  gain: 0.85,
  /// Where the engine says it wraps, in engine output frames, or null.
  ///
  /// Reported rather than computed here: a loop end of zero means "the whole
  /// document" and only the callback knows how long that is under the current
  /// ratio. This side guessed once and playback ran past the end of a looping
  /// file.
  loop: null,
  /// How far ahead of the speaker the frame counter is.
  ///
  /// The counter counts frames *produced*; the device holds a buffer of them
  /// before any are heard. Drawing straight from it puts the playhead ahead of
  /// the sound. The backend reports this, so it is measured, not assumed.
  latency: 0,
};

$('volume').oninput = (e) => {
  engine.gain = +e.target.value;
  enginePost({ gain: engine.gain });
};

// ── the two sound generators, and which of them play ──────────────────────
//
// GRAIN is the granular engine; SEQ is the sequencer. Each is a switch on the
// transport — so it is in the room's foot as well — and a source switched
// off is silent, out of the picture, and out of an export. Before this the
// sequencer played on every Play once it had ever been opened, and there was
// no way to hear one without the other. The engine keeps running with GRAIN
// off: the transport, the clock and the sequencer's sync come from it.
//
// Neither switch is remembered between loads: GRAIN left off by an earlier
// session is an app that plays nothing, with nothing on screen to say why
// (RJ, 9 Nov 2026). Every load starts with both on; the key they were kept
// under is cleared, so a switch saved off before this goes too.
const SOURCES_KEY = 'audiolab.sources.v1';
state.sources = { grain: true, seq: true };
try { localStorage.removeItem(SOURCES_KEY); } catch { /* private mode */ }

function sourceOn(key) {
  return state.sources[key] !== false;
}

function setSource(key, on) {
  state.sources[key] = !!on;
  paintSources();
  if (key === 'grain') enginePost({ mute: !on });
  if (key === 'seq') {
    if (on) { seqEnsureFrame(); if (engine.playing) seqSync(true); }
    else { seqSync(false); seq.feed = null; }
  }
}

function paintSources() {
  for (const [id, key, what] of [['srcGrain', 'grain', 'The granular engine'], ['srcSeq', 'seq', 'The sequencer']]) {
    const b = $(id);
    if (!b) continue;
    const on = sourceOn(key);
    b.classList.toggle('on', on);
    b.title = `${what}: ${on ? 'plays, is drawn, and is exported' : 'off — silent, out of the picture, out of an export'}. Click to switch.`;
  }
}
for (const [id, key] of [['srcGrain', 'grain'], ['srcSeq', 'seq']]) {
  $(id)?.addEventListener('click', () => setSource(key, !sourceOn(key)));
}
paintSources();

/// Is there anything to play through?
const noAudio = () => engine.device === false;

/// Ask once, at startup, and tell the interface.
///
/// `/api/engine/state` is the one engine route that answers without a device —
/// see `api_engine_state`. Everything else here is gated on what it says.
async function checkAudioDevice() {
  try {
    const r = await api('/api/engine/state');
    engine.device = r.device !== false;
    engine.deviceError = r.deviceError || '';
  } catch {
    // Unreachable is not the same as absent: leave it unknown and let the
    // calls try, rather than switching the transport off over one bad fetch.
    engine.device = null;
  }
  reflectAudioDevice();
  watchAudioDevice();
}

/// While there is no device, ask again now and then, and whenever the window
/// comes back to the front.
///
/// The server opens the device on the next request that needs it, so a device
/// that was missing when the page loaded (an interface unplugged, the output
/// switched, the server restarted at the wrong moment) is found again on its
/// own. The page asked once and never again, so the transport stayed switched
/// off, with no sound, until someone reloaded it (RJ, 10 Nov 2026: "they were
/// disabled at one point and it stopped all sound playing"). Only
/// `/api/engine/state` is asked, which answers either way, and only while the
/// answer is no.
let audioDeviceTimer = null;
function watchAudioDevice() {
  if (!noAudio()) { clearInterval(audioDeviceTimer); audioDeviceTimer = null; return; }
  if (!audioDeviceTimer) audioDeviceTimer = setInterval(checkAudioDevice, 8000);
}
window.addEventListener('focus', () => { if (noAudio()) checkAudioDevice(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && noAudio()) checkAudioDevice(); });

/// Say so, once, in the transport bar — and take the controls out of service.
///
/// A transport that looks live and silently does nothing is worse than one that
/// says why.
function reflectAudioDevice() {
  const off = noAudio();
  const note = $('noAudio');
  if (note) {
    note.classList.toggle('hidden', !off);
    note.title = `${engine.deviceError || 'This machine has no audio output.'} Click to look again.`;
  }
  for (const id of ['playBtn', 'stopBtn', 'loopBtn', 'recBtn']) {
    const b = $(id);
    if (!b) continue;
    // The button's own title is kept, so it can have it back.
    if (b.dataset.title === undefined) b.dataset.title = b.title;
    b.disabled = off;
    b.title = off ? 'No audio device on this machine' : b.dataset.title;
  }
}
$('noAudio')?.addEventListener('click', () => checkAudioDevice());

async function enginePost(body) {
  if (noAudio()) return null;
  try {
    return await postJSON('/api/engine/transport', body);
  } catch (e) {
    toast(e.message);
    return null;
  }
}

/// Load a file into the engine. Expensive — once per file, never per control.
async function engineLoad(file, { raw = false } = {}) {
  if (noAudio()) return false;
  try {
    const r = await api(
      `/api/engine/load?p=${encodeURIComponent(file.path)}${raw ? '&raw=1' : ''}`,
      { method: 'POST', body: '{}' },
    );
    engine.path = file.path;
    engine.raw = raw;
    engine.deviceRate = r.sampleRate || 48000;
    // The governor's flag lives on the audio thread's shared state, and opening
    // a sound builds a fresh one — so without this the setting would lapse on
    // the next file and the layers would start disappearing again with nothing
    // having been changed.
    await pushShedLayers();
    return true;
  } catch (e) {
    toast('Cannot play: ' + e.message);
    return false;
  }
}

// ------------------------------------------------------- frames and time
//
// Three frames of reference meet here. The file has its own sample rate; the
// device has another; and the engine counts *output* frames, which the stretch
// ratio separates from source frames. Everything below converts between them in
// one place so no call site has to remember which it is holding.

/// Time ratio between what is playing and the source the overview shows.
const timeRatio = () => {
  // The engine's own, while it is playing this sound: its position is counted
  // at that ratio, and the document's runs ahead of it during a drag — which
  // is what made the readout jump about when the stretch moved.
  const live = engine.ratio;
  if (engine.playing && engine.path === state.selectedFile?.path && live > 0 && isFinite(live)) return live;
  const r = state.edit?.stretch?.ratio;
  return r && isFinite(r) && r > 0 ? r : 1;
};

/// File sample rate over device sample rate.
const rateScale = () =>
  (state.view.sampleRate || 48000) / (engine.deviceRate || 48000);

/// Engine output frame to a frame in the source file.
const srcFromEngine = (p) => (p / timeRatio()) * rateScale();

/// A frame in the source file to an engine output frame.
const engineFromSrc = (f) => (f / rateScale()) * timeRatio();

/// Where the engine is now.
///
/// The engine's own count is sample accurate, but it is polled rather than
/// shared, so this carries it forward on the wall clock between polls. The
/// anchor is exact and cannot drift: every poll resets it.
/// Where the engine is now, in engine output frames.
///
/// The count is polled twenty times a second and carried forward on the wall
/// clock in between, so the playhead moves at the frame rate rather than in
/// twenty steps. Two corrections on top of that:
///
/// **The loop.** Carrying forward is monotonic, and a loop is not. Between one
/// poll and the next the playhead ran past the loop end and was dragged back
/// when the truth arrived — on a short loop that is most of the loop, drawn
/// outside it, flickering. So the carried-forward part wraps where the engine
/// says it wraps.
///
/// **The output latency.** The counter is frames produced, not frames heard.
/// Subtracting what the device reports puts the line on the sound rather than
/// a buffer ahead of it.
///
/// **`produced`** leaves the latency on: the frames the engine has made rather
/// than the ones heard, which is what the sequencer's sound is stamped against
/// when it plays through the engine. And while the sequencer is being started
/// ahead of the engine (`engine.rolling`) the position holds — the engine has
/// not moved yet, and a playhead carried forward would run ahead of it.
function enginePosition(produced = false) {
  const latency = produced ? 0 : engine.latency;
  if (!engine.playing || !engine.heard || engine.rolling) return Math.max(0, engine.position - latency);
  const dt = (performance.now() - engine.heard) / 1000;
  let p = engine.position + dt * engine.deviceRate - latency;

  const lp = engine.loop;
  if (lp && lp.b > lp.a) {
    const span = lp.b - lp.a;
    if (p >= lp.b) p = lp.a + ((p - lp.a) % span);
    // Latency can push the first moments of a loop back before its start,
    // which belongs at the far end of the previous pass rather than clamped.
    else if (p < lp.a) p = lp.b - ((lp.a - p) % span);
  }
  return Math.max(0, p);
}

function playbackTime() {
  return enginePosition() / (engine.deviceRate || 48000);
}

/// How far out the clock has to be before it is corrected in one step rather
/// than eased. A quarter of a second is far past anything the network can
/// account for, so what is left is a seek, a loop wrap or a start — real
/// discontinuities, which should look like discontinuities.
const CLOCK_SNAP_SECONDS = 0.25;
/// How much of the remaining error is taken out per poll. At twenty polls a
/// second this settles in about a fifth of a second, which is quick enough to
/// track drift and slow enough that no single correction is visible.
const CLOCK_GAIN = 0.12;

/// Take a position from the engine without lurching.
///
/// The poll used to write `engine.position = r.position` and stamp
/// `engine.heard = performance.now()`. That is a hard snap twenty times a
/// second: the value was true at some instant on the engine, but the stamp is
/// when the *reply arrived*, so the baseline moved by however much the round
/// trip varied that time. Between polls the playhead glides; at each poll it
/// jumps by the network's jitter.
///
/// Measured against a perfect clock sampled with a 2–18 ms arrival spread: a
/// tick that should advance 800 frames was out by up to 687 of them — 14.3 ms,
/// most of a frame — with an RMS error of 184. That is the stutter, and no
/// amount of drawing faster would have touched it.
///
/// So the error is not applied, it is *dissolved*: predict where we already
/// think we are, take a fraction of the difference, and carry on. Only a
/// genuine discontinuity is allowed to jump.
function lockClock(reported) {
  const now = performance.now();
  const rate = engine.deviceRate || 48000;
  if (!engine.playing || !engine.heard || engine.rolling) {
    engine.position = reported;
    engine.heard = now;
    return;
  }
  const predicted = engine.position + ((now - engine.heard) / 1000) * rate;
  const error = reported - predicted;
  if (Math.abs(error) > CLOCK_SNAP_SECONDS * rate) {
    engine.position = reported;
    engine.heard = now;
    return;
  }
  // Re-base on our own prediction, nudged. The playhead never moves by the
  // correction; it moves by the clock, and the correction changes its slope by
  // a fraction of a per cent.
  engine.position = predicted + error * CLOCK_GAIN;
  engine.heard = now;
}

/// Playback position expressed as a frame in the source file.
const sourceFrameNow = () => srcFromEngine(enginePosition());

/// Ask the engine to put the playhead on a source frame.
function seekSource(srcFrame) {
  const p = Math.max(0, engineFromSrc(srcFrame));
  engine.position = p;
  engine.heard = performance.now();
  // A new epoch: whatever of the sequencer's sound the engine holds from before
  // the seek is let go, and anything still on its way is refused.
  seqNextEpoch();
  enginePost({ seek: p, seqEpoch: seq.epoch });
  // Straight away, not at the next clock tick: a seek is a discontinuity and
  // the sequencer should land with it.
  if (engine.playing) seqClock();
}

// ------------------------------------------------------------- transport

/// Audition a sound, or play a document.
///
/// In the library it is the sound itself — no edits, no stretch, no grain
/// cloud, no rack. Clicking a file there is a question about the file, and
/// answering it through whatever was last done to that file answers a
/// different question: a one-shot playing back thirty-six times longer than it
/// is, because of something set last week, tells you nothing about the sound.
///
/// In the editor the document is the point, so it plays in full.
async function playFile(file) {
  const raw = !playsDocument();
  // Same sound *and* the same kind of playback: otherwise it has to be
  // reloaded, or pressing play in the editor would resume the audition.
  if (engine.path === file.path && engine.raw === raw) {
    engine.playing ? pausePlayback() : startPlayback();
    return;
  }
  if (state.selectedFile?.path !== file.path) selectFile(file);
  if (!(await engineLoad(file, { raw }))) return;
  applyLoop();
  seekSource(state.cue || 0);
  startPlayback();
}

function startPlayback() {
  engine.playing = true;
  captureFollow(true);
  engine.heard = performance.now();
  reflectTransport();
  const serial = engine.startSerial = (engine.startSerial || 0) + 1;
  const go = () => {
    engine.rolling = false;
    engine.heard = performance.now();
    // Not told, as far as a poll can know, until the engine has answered.
    engine.toldAt = Infinity;
    Promise.resolve(enginePost({ play: true, mute: !sourceOn('grain'), seqEpoch: seq.epoch }))
      .finally(() => { engine.toldAt = performance.now(); });
  };
  // **The sequencer first, when it plays through the engine**: started where
  // the engine is and the engine a lead later, so the sequencer's sound is
  // already waiting when the engine reaches the frames it belongs at.
  // Otherwise the two start together, as they always have.
  const roll = seqSync(true, { preroll: true });
  if (roll) {
    engine.rolling = true;
    roll.then(() => { if (engine.playing && engine.rolling && engine.startSerial === serial) go(); });
  } else {
    go();
  }
  captureTransport(true);
  if (typeof visualLanesStart === 'function') visualLanesStart();
  startTransportLoop();
  startPolling();
  startSwarm();
}

function pausePlayback() {
  engine.playing = false;
  engine.rolling = false;
  // After the poll loop has stopped, not before: a request already in flight
  // lands with the last levels that were heard and paints them back on.
  setTimeout(resetRackMeters, 120);
  captureFollow(false);
  reflectTransport();
  enginePost({ play: false });
  updatePlayhead();
  updateOverviewPlayhead();
  paintTime();
  stopSwarm();
  seqSync(false);
  if (typeof visualLanesStop === 'function') visualLanesStop();
  captureTransport(false);
  if ($('perfCanvas')?.offsetParent) perfDrawTimeline();
}

function reflectTransport() {
  const b = $('playBtn');
  b.classList.toggle('on', nbPlaying());
  nbPaintPlay();
  if (engine.playing) nbMeterRun();
  const pp = $('perfPlayBtn');
  if (pp) {
    pp.textContent = engine.playing ? '⏸ PLAYING' : '▶ PLAY PERF';
    pp.classList.toggle('active', engine.playing);
  }
  markPlaying();
  // One more pass so the lane playhead is cleared when playback ends; the poll
  // loop that normally draws it has already stopped by then.
  repaintAutomationLanes();
}

function markPlaying() {
  document.querySelectorAll('.file-row').forEach((el) => {
    const on = el.dataset.path === engine.path && engine.playing;
    el.classList.toggle('playing', on);
    const b = el.querySelector('.pb');
    if (b) { b.classList.toggle('on', on); b.textContent = on ? '❚❚' : '▶'; }
  });
}

// --------------------------------------------------------------- polling
//
// One request serves the playhead, the swarm and the spectrum, because all
// three describe the same instant and fetching them separately would let them
// disagree. Deliberately not on an animation frame: a hidden window stops
// painting, and the audio does not stop with it.

let pollTimer = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    // A held note on the Grain page sounds with the transport stopped.
    if ((!engine.playing && !gsPollWanted()) || noAudio()) { stopPolling(); return; }
    try {
      const asked = performance.now();
      const r = await api('/api/engine/grains');
      gsPicFeed(r);
      engine.deviceRate = r.sampleRate || engine.deviceRate;
      // A new stretch moves the engine's count to keep the same moment of the
      // file (`Stretcher::rescale`). The clock here does the same, so the
      // playhead stays put instead of being smoothed across the jump.
      if (r.ratio > 0 && engine.ratio > 0 && r.ratio !== engine.ratio) {
        engine.position *= r.ratio / engine.ratio;
      }
      if (r.ratio > 0) engine.ratio = r.ratio;
      // A note on a stopped transport is not the transport moving.
      if (engine.playing || !gsPollWanted()) lockClock(r.position);
      engine.loop = r.loop || null;
      engine.latency = r.latency || 0;
      engine.spectrum = r.spectrum && r.spectrum.length ? r.spectrum : engine.spectrum;
      engine.waveform = r.waveform && r.waveform.length ? r.waveform : engine.waveform;
      // The rail's meters and its visual editors are driven from the same poll
      // as the playhead, so everything on screen describes one instant.
      // All three draw into the effects rail, so none of them is worth doing
      // while another dock is open. The meters are the expensive one: a needle
      // per stage, redrawn on every poll, whether or not the rail is on screen.
      engine.rackLevels = r.rackLevels || [];
      engine.load = r.load || null;
      // Grains the voice pool had no room for. Counted in the callback and
      // surfaced rather than degrading quietly.
      engine.overflows = r.overflows ?? engine.overflows ?? 0;
      paintLoad();
      // The schedule is windowed now, and the swarm reads it around the
      // playhead — so playing out of the covered range would empty it. Cheap:
      // this returns immediately unless the playhead is near the edge.
      grainsFollowView();
      if (!$('dockEffects')?.classList.contains('hidden')) {
        paintRackMeters(r.rackLevels || []);
        repaintVisualEqs();
        repaintVisualCompressors();
      }
      repaintVisualChamberlins();
      repaintAutomationLanes();
      // **Only an answer asked for after the engine had its Play can say it
      // stopped.** While the sequencer is started ahead of it the engine has not
      // been told to play yet, and an answer already on its way when it was
      // told still describes it stopped. Both read as the sound having ended:
      // the transport dropped back to the cue before a note was heard, and the
      // engine was never started at all.
      if (!r.playing && engine.playing && !engine.rolling && asked > (engine.toldAt ?? 0)) {
        // The engine stopped itself at the end of the document. Drop back to
        // the cue so pressing play again auditions the same moment.
        engine.playing = false;
        captureFollow(false);
        reflectTransport();
        stopSwarm();
        resetRackMeters();
        // **Everything a stop stops.** This stopped the engine's own things and
        // left the sequencer playing on past the end of the sound — through the
        // browser, or through the engine, which refused it all as having no
        // sound to go with — and the picture's lanes and a take running with it.
        seqSync(false);
        if (typeof visualLanesStop === 'function') visualLanesStop();
        captureTransport(false);
        returnToCue();
        paintTime();
        updatePlayhead();
        updateOverviewPlayhead();
      }
    } catch { gsPicFeed(null); /* a dropped poll is a stale playhead, not a failure */ }
  }, 50);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

let transportRaf = null;
function startTransportLoop() {
  if (transportRaf) return;
  const tick = () => {
    if (!engine.playing) { transportRaf = null; return; }
    transportRaf = requestAnimationFrame(tick);
    paintTime();
    followPlayhead();
    updatePlayhead();
    updateOverviewPlayhead();
    nbTick();
    edTickCursor();
    // The timeline's playhead, where the timeline is on screen — the dock's
    // Automation tab, or Compose's arrangement. Fifteen times a second: a take
    // can hold thousands of breakpoints, and the head does not need sixty.
    // The picture's lanes, and the hand on the picture.
    if (typeof visualLanesTick === 'function') visualLanesTick();
    const now = performance.now();
    if (now - perfTickAt > 66 && $('perfCanvas')?.offsetParent) {
      perfTickAt = now;
      perfDrawTimeline();
    }
  };
  tick();
}
let perfTickAt = 0;

function paintTime() {
  // On the Prism page the clock is the Prism deck's (`prismBarShow`).
  if (prismOwnsBar()) return;
  $('timeNow').textContent = fmtTime(playbackTime());
  nbTick();
}

/// Stop the transport if it is playing something other than `file`.
///
/// The transport belongs to the sound on screen. Choosing a different one
/// while the old was still playing left it playing underneath the new picture,
/// with the playhead running against a timeline it did not belong to — and the
/// capture button would then have kept the wrong sound entirely.
///
/// The guard is on the *path*, not on whether anything is playing, because
/// `playFile` selects before it loads: the sound being started is never the one
/// stopped here.
function releaseEngineFor(file) {
  if (engine.playing && engine.path && file && engine.path !== file.path) {
    pausePlayback();
  }
}

/// Play means play *what is selected*, not whatever the engine is holding.
///
/// Selecting a sound deliberately does not load it — loading folds the whole
/// document into a buffer and hands it over, which is far too much to do on
/// every click in the library — so after picking a second sound the engine is
/// still holding the first. This used to ask only whether the engine had
/// *anything* loaded, which is false exactly once: the first play after
/// launch. Every play after that resumed the previous sound while the screen
/// showed the new one.
///
/// `playFile` already knows both cases: same path, toggle; different path,
/// load it and start from the cue.
$('playBtn').onclick = async () => {
  // The Prism page's sound is its own deck's (`prismOwnsBar`).
  if (prismOwnsBar()) { prismBarPlay(); return; }
  if (state.selectedFile) { await playFile(state.selectedFile); return; }
  if (!engine.path) return;
  engine.playing ? pausePlayback() : startPlayback();
};

// The cue: where playback starts from and returns to. Set by clicking the
// waveform, and kept until it is moved or cleared, so repeated auditions of the
// same moment do not mean re-finding it every time.
state.cue = 0;

function setCue(srcFrame) {
  state.cue = Math.max(0, srcFrame || 0);
  drawCue();
}

function drawCue() {
  updateOverviewCue();
  const el = $('cue');
  if (!el) return;
  const { from, to } = state.view;
  if (!state.peaks || to <= from || state.cue == null) { el.style.display = 'none'; return; }
  if (state.cue < from || state.cue > to) { el.style.display = 'none'; return; }
  const w = $('lane').clientWidth || 0;
  el.style.display = 'block';
  el.style.transform = `translateX(${(((state.cue - from) / (to - from)) * w).toFixed(2)}px)`;
}

function returnToCue() {
  seekSource(state.cue || 0);
}

$('stopBtn').onclick = () => {
  if (prismOwnsBar()) { prismDeckStop(); return; }
  pausePlayback();
  returnToCue();
  updatePlayhead();
  paintTime();
};

/// Double-click for the top of the file, rather than for the cue.
///
/// Stop returns to the cue, which is right — it is where you said playback
/// starts from — but it leaves no way back to the beginning except moving the
/// cue there, and then you have lost the cue.
///
/// So the cue is deliberately not touched by this. The comment on `state.cue`
/// is the reason: the point of a cue is that auditioning the same moment over
/// and over does not mean re-finding it, and a transport gesture that quietly
/// threw it away would cost more than it saved. This is a return to zero, not
/// a re-cue.
///
/// The pair of clicks underneath arrive first and each returns to the cue, so
/// the seek to zero lands last and wins.
$('stopBtn').ondblclick = () => {
  if (prismOwnsBar()) { prismDeckStop(); return; }
  pausePlayback();
  seekSource(0);
  updatePlayhead();
  paintTime();
};

// ------------------------------------------------------------ loop playback

// Loop is simply on or off. What it loops follows from whether anything is
// selected — a selection loops, otherwise the whole file — so the button never
// needs a mode and never goes stale when the selection changes.
//
// The wrap itself happens in the audio callback, which fades across the seam on
// an exact frame. The browser cannot do that and never could.
state.loopOn = false;

function applyLoop() {
  const hasSel = !!state.sel && state.sel.end > state.sel.start;
  // Zero means "the whole document". The engine knows how long that is under
  // the current ratio; this side would have to recompute it on every stretch
  // change and would eventually be wrong.
  enginePost({
    loop: {
      on: !!state.loopOn,
      a: hasSel ? Math.max(0, Math.round(engineFromSrc(state.sel.start))) : 0,
      b: hasSel ? Math.max(0, Math.round(engineFromSrc(state.sel.end))) : 0,
    },
  });

  paintLoop();
}

/// The loop button and its label. On the Prism page, the Prism deck's loop,
/// which is always the whole sound.
function paintLoop() {
  const btn = $('loopBtn');
  const on = prismOwnsBar() ? prismDeck.loop : state.loopOn;
  const what = !prismOwnsBar() && state.sel && state.sel.end > state.sel.start ? 'selection' : 'whole file';
  btn.classList.toggle('on', on);
  btn.title = on ? `Looping the ${what}` : 'Loop off';
  $('loopLabel').textContent = on ? what : '';
}

$('loopBtn').onclick = () => {
  if (prismOwnsBar()) { prismDeckLoop(); return; }
  state.loopOn = !state.loopOn;
  applyLoop();
};

/// Start a selection loop from the beginning of the selection.
async function playSelectionLoop() {
  if (!state.selectedFile) return;
  state.loopOn = true;
  if (state.sel) setCue(state.sel.start);
  await playFile(state.selectedFile);
  applyLoop();
}

/// The playback position on the whole-file overview.
///
/// Drawn against the file's full length, not the zoomed range, so it still
/// tells you where you are once playback has run outside the window.
function updateOverviewPlayhead() {
  const el = $('ovPlayhead');
  if (!el) return;
  const total = state.view.frames || state.overview?.frames || 0;
  const w = $('overview')?.clientWidth || 0;
  if (!state.peaks || !total || !w) { el.style.display = 'none'; return; }
  const frame = sourceFrameNow();
  if (!isFinite(frame)) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.transform =
    `translateX(${(Math.max(0, Math.min(1, frame / total)) * w).toFixed(2)}px)`;
}

function updateOverviewCue() {
  const el = $('ovCue');
  if (!el) return;
  const total = state.view.frames || state.overview?.frames || 0;
  const w = $('overview')?.clientWidth || 0;
  if (!state.peaks || !total || !w || state.cue == null) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.transform =
    `translateX(${(Math.max(0, Math.min(1, state.cue / total)) * w).toFixed(2)}px)`;
}


