// ======================================================= grain visualiser
//
// The whole grain stream, drawn as it is heard: output time across, source
// position up. A clean stretch is a straight diagonal — each moment of output
// reads steadily through the source. Position jitter scatters it vertically,
// pitch jitter colours it, density changes how thickly it is packed.
//
// The events come from the same enumeration the renderer uses, so this is not
// an impression of the process; it is the process.

state.grains = null;

/// The output-frame range the last request covered, so a redraw at the same
/// zoom does not re-ask.
let grainsFor = null;

/// Which file the grains in hand belong to, and when the last ask failed.
///
/// A dropped request is not "there are no grains". It used to be treated as one
/// — the catch cleared `state.grains`, and `grainsFollowView` will not ask again
/// when there is nothing in hand — so a single failed fetch stopped the picture
/// for good while the sound carried on, and the only way back was an action that
/// called `loadGrains` itself. Reselecting a view from the menu is one, which is
/// why that appeared to fix it.
let grainsPath = null;
let grainsFailedAt = 0;

/// Which request the state in hand belongs to.
///
/// `loadGrains` is async and is called from six places — selecting a file, an
/// edit, a zoom, a scroll, the playback poll, the failure retry. Nothing stopped
/// two of them being in flight at once, and nothing said which answer was the
/// current one, so **the response that happened to land last won** whether or
/// not it was the one asked for last.
///
/// Both failures were reproduced before this was written:
///
/// - Ask for the whole document, then zoom in and ask again. If the first
///   request is the slower one it lands second, and `state.grains` and
///   `grainsFor` end up describing four minutes of file while the view is on a
///   fraction of a second. The picture is a handful of marks — the "zoomed in
///   and saw three grains" symptom, by a different route.
/// - Switch sounds while a request is in flight and the *previous* file's
///   grains are drawn on the new file's waveform.
///
/// A ticket per request fixes both: a response that is not the newest is
/// dropped entirely rather than written and then corrected. Nothing partial is
/// ever stored, so `state.grains`, `grainsFor` and `grainsPath` always describe
/// one single response.
let grainsSeq = 0;
/// The swarm has its own counter, and that is not a detail.
///
/// Sharing one counter meant `loadSwarmGrains` — which `loadGrains` awaits —
/// bumped the number its caller was holding, so every view fetch declared
/// itself superseded by its own child and returned before drawing anything.
/// The redraw would have stopped completely. Caught by reading it back rather
/// than by running it, which is luck; the test below is not luck.
let swarmSeq = 0;

/// Is this response still wanted at all — same file, still selected?
const stillWanted = (f) => state.selectedFile?.path === f.path;
const GRAIN_RETRY_MS = 1200;

/// How far either side of the playhead the swarm's schedule has to reach.
///
/// Four seconds rather than the swarm's own 1.4, so playing on does not need a
/// new request every second.
const GRAIN_PLAYHEAD_PAD = 4;

/// **Two pictures read the schedule and they want different ranges.**
///
/// The waveform layer wants the grains in the *view*; the swarm wants the ones
/// around the *playhead*, 1.4 seconds either side. Windowing to the view alone
/// — which is what made zooming work — empties the swarm whenever the playhead
/// is elsewhere.
///
/// The union of the two is not the answer either, and the measurement says so:
/// zoomed into the last tenth of a file with the playhead at the start, the
/// union is the whole document, the cap spreads over all of it, and the swarm
/// gets sixteen grains. A contiguous window cannot serve two disjoint regions.
///
/// So they are two requests, and only when they are actually apart. Following
/// the playhead — the usual case — the second is skipped entirely.
function viewWindow() {
  const v = state.view || {};
  const ratio = state.edit?.stretch?.ratio ?? 1;
  const from = Math.max(0, Math.floor((v.from ?? 0) * ratio));
  const to = Math.ceil((v.to ?? 0) * ratio);
  return to > from ? [from, to] : null;
}

function playheadWindow() {
  const sr = state.grains?.sampleRate || state.view?.sampleRate || 48000;
  const head = playbackTime() * sr;
  if (!Number.isFinite(head) || head <= 0) return null;
  const pad = GRAIN_PLAYHEAD_PAD * sr;
  return [Math.max(0, Math.floor(head - pad)), Math.ceil(head + pad)];
}

/// Is the playhead's horizon already inside what the view fetched?
function covers(win, want) {
  return !!win && !!want && want[0] >= win[0] && want[1] <= win[1];
}

/// Whether the view's schedule is too thinned to strike sparks from.
///
/// The cap is spent across whatever window was asked for, so zoomed out on a
/// long stretch it is spread very thin: measured at ratio 19.4, density 91,
/// three layers, the reply held 7,983 grains of a real 2,913,063 — one in 365.
/// The ticks survive that (they are a density picture and thinning is honest),
/// but the sizzle does not: at any moment 91 × 3 × 0.28 s ≈ 76 grains should be
/// lit, and one in 365 of them is *nought point two*. What you see is a spark
/// appearing alone, twice a second, which reads exactly like a redraw running
/// at two frames a second. It is not — the layer draws in under a millisecond.
/// There is simply almost nothing in the frame.
///
/// So when the view copy is thin, the sparks come from the playhead's own copy,
/// which is eight seconds wide and therefore never thinned at all.
function viewIsThin() {
  const g = state.grains;
  if (!g || !g.total || !g.grains) return false;
  return g.total > g.grains.length * 2;
}

/// The playhead's own schedule, when the view is looking somewhere else.
/// `null` means the view's copy already covers it and the swarm should use that.
let swarmFor = null;

async function loadGrains() {
  const f = state.selectedFile;
  if (!f) {
    state.grains = null; state.swarm = null;
    grainsFor = null; swarmFor = null;
    grainsPath = null; grainsFailedAt = 0;
    drawGrains();
    return;
  }

  // Ask for the range on screen, in *output* frames — the view is in source
  // frames, and the schedule is laid out along the output.
  //
  // This is what makes zooming show more rather than less. The cap is a few
  // thousand grains and it used to be spread over the whole document, so a
  // window holding a thousandth of the file held a handful of them: zoomed all
  // the way in on a cloud of three million, you saw three.
  const win = viewWindow();
  const q = win ? `&from=${win[0]}&to=${win[1]}` : '';
  const seq = ++grainsSeq;
  try {
    const got = await api(`/api/grains?p=${encodeURIComponent(f.path)}${q}`);
    // Superseded while it was in the air. Drop it whole — writing it and
    // letting something later notice is what put the wrong window on screen.
    if (seq !== grainsSeq || !stillWanted(f)) return;
    state.grains = got;
    grainsFor = win;
    grainsPath = f.path;
    grainsFailedAt = 0;
  } catch {
    if (seq !== grainsSeq || !stillWanted(f)) return;
    // Keep the picture if it belongs to this file — a stale schedule is closer
    // to the truth than a blank lane, and it is replaced the moment the retry
    // lands. Grains from a *different* file would be a lie, so those do go.
    if (grainsPath !== f.path) { state.grains = null; grainsPath = null; }
    grainsFor = null;
    grainsFailedAt = performance.now();
  }
  await loadSwarmGrains();
  if (seq !== grainsSeq || !stillWanted(f)) return;
  drawGrains();
  // The lane's own layer too. It is otherwise only drawn from `updatePlayhead`,
  // which does not run with the transport stopped — so a schedule that arrived
  // while stopped stayed invisible until you pressed play.
  drawGrainLayer();
}

/// A second request, only when the playhead is outside the view.
async function loadSwarmGrains() {
  const f = state.selectedFile;
  const want = playheadWindow();
  // `covers` alone was the test, and it is not enough: a range can *contain*
  // the playhead while holding one grain in 365 of it. Density counts too.
  if (!f || !want || (covers(grainsFor, want) && !viewIsThin())) {
    state.swarm = null;
    swarmFor = null;
    return;
  }
  // The swarm's own ticket, on the same counter — a swarm fetch that outlives
  // the view fetch that triggered it must not write either.
  const seq = ++swarmSeq;
  try {
    const got = await api(
      `/api/grains?p=${encodeURIComponent(f.path)}&from=${want[0]}&to=${want[1]}`,
    );
    if (seq !== swarmSeq || !stillWanted(f)) return;
    state.swarm = got;
    swarmFor = want;
  } catch {
    if (seq !== swarmSeq || !stillWanted(f)) return;
    state.swarm = null;
    swarmFor = null;
  }
}

/// Re-fetch when the view or the playhead has moved outside what is covered.
///
/// Throttled: zooming, scrolling and playback all fire continuously, and each
/// of these is a schedule walk on the server.
let grainsViewTimer = null;
/// The view the grain layer was last drawn for.
///
/// `grainsFollowView` is called from the playback poll twenty times a second as
/// well as on every zoom and scroll. Redrawing unconditionally there added
/// twenty full redraws a second on top of the sixty the transport loop already
/// does — for a picture that had not moved. The redraw is needed when the
/// *view* moves, which is what this remembers.
let grainDrawnFor = null;

function grainsFollowView() {
  // Re-place what is already in hand, when the view has actually moved.
  //
  // This function used to redraw *only* when it decided to re-fetch. The marks
  // are drawn at pixel positions derived from `state.view`, so any zoom or
  // scroll moves the waveform out from under them — and if the schedule in hand
  // still covered the new view, nothing ever corrected it. Measured: scroll by
  // 15% of the span and the canvas came back byte-identical.
  //
  // Even when a fetch *is* warranted it is debounced by 120 ms, so there was a
  // window on every single view change where the marks were simply in the wrong
  // places. Drawing first closes both cases: the picture is always right for
  // the data in hand, and a fetch only ever improves the data.
  const now = `${state.view?.from}:${state.view?.to}`;
  if (now !== grainDrawnFor) {
    grainDrawnFor = now;
    drawGrainLayer();
  }
  if (!state.selectedFile) return;

  // The last ask failed: try again, on a timer of its own so a server that is
  // genuinely down is asked once a second rather than eight times.
  if (grainsFailedAt) {
    if (performance.now() - grainsFailedAt < GRAIN_RETRY_MS) return;
    grainsFailedAt = 0;
    loadGrains();
    return;
  }
  const win = viewWindow();
  const head = playheadWindow();

  // Nothing in hand at all: ask for it.
  //
  // This used to `return`, which left the poll able to *refresh* a schedule but
  // never to fetch a first one. So any way the schedule came to be missing — a
  // request superseded by a newer one, a race while switching sounds, a reply
  // that failed — was permanent: the marks and the read band stayed away until
  // something else happened to call `loadGrains`, which is why moving any grain
  // control made them all appear at once.
  //
  // The document has to be a granular one for there to be anything to ask for,
  // and the debounce below keeps this to one request rather than twenty a
  // second while it is in flight.
  if (!state.grains?.grains?.length) {
    // `grain` hangs off `stretch`, not off the document. Testing
    // `state.edit.grain` would have been false on every document there is, so
    // this branch would have returned early every time and fetched nothing —
    // the same silence it was written to end.
    if (!win || !state.edit?.stretch) return;
    clearTimeout(grainsViewTimer);
    grainsViewTimer = setTimeout(() => loadGrains(), 120);
    return;
  }

  // Stale two ways, and the second is the one that matters.
  //
  // Outside what was fetched is obvious. But **zooming in stays inside it** —
  // and that is precisely when a new request is needed, because the grains held
  // were sampled across a range far wider than what is now on screen. Testing
  // only for "outside" meant zooming changed nothing at all: the view narrowed
  // to sixty frames while the schedule in hand still covered sixty-one million,
  // and the picture went empty rather than dense.
  //
  // So: re-ask when the covered range is more than twice the view. Twice rather
  // than any narrowing, or every scroll would re-ask.
  const outside = win && !(grainsFor
    && win[0] >= grainsFor[0] - 1 && win[1] <= grainsFor[1] + 1);
  const tooCoarse = win && grainsFor
    && (grainsFor[1] - grainsFor[0]) > (win[1] - win[0]) * 2;
  const viewStale = !!(outside || tooCoarse);
  // The swarm is stale if its horizon is in neither copy. A margin, so playing
  // forward inside the pad does not re-ask every frame.
  const sr = state.grains?.sampleRate || 48000;
  const margin = 1.5 * sr;
  const near = head ? [head[0] + margin, head[1] - margin] : null;
  const swarmStale = !!head && !covers(swarmFor, near)
    && !(covers(grainsFor, near) && !viewIsThin());
  if (!viewStale && !swarmStale) return;

  clearTimeout(grainsViewTimer);
  grainsViewTimer = setTimeout(() => {
    if (viewStale) loadGrains();
    else loadSwarmGrains().then(() => { drawGrains(); drawGrainLayer(); });
  }, 120);
}

/// Warm and bright for sharp, brilliant grains; cool and deep for flat, dark.
function grainColour(pitchOffset, brightness, alpha) {
  const p = Math.max(-1, Math.min(1, pitchOffset / 9));
  const br = Math.max(0, Math.min(1, brightness * 4));
  const t = Math.max(-1, Math.min(1, p * 0.55 + (br - 0.4) * 1.4));
  const hue = t >= 0 ? 30 - t * 10 : 250 + t * 30;
  const chroma = 0.10 + Math.abs(t) * 0.16;
  const light = 66 + Math.abs(t) * 14;
  return `oklch(${light}% ${chroma} ${hue} / ${alpha})`;
}

function visSetup(fade) {
  const canvas = $('grainCanvas');
  if (!canvas) return null;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  // Both dimensions — see `drawGrainLayer`, where testing only the width left
  // the backing store the wrong height after a vertical resize.
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (fade) {
    // A translucent wash instead of a clear leaves trails, which is what makes
    // a swarm read as moving rather than as a scatter of static dots.
    ctx.fillStyle = 'rgba(7,9,14,0.40)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
  return { ctx, w, h };
}


// --------------------------------------------------------------- cloud pad

/// The grain cloud, drawn where it actually is.
///
/// The swarm above it is a picture of the *sound* — grains orbiting the
/// playhead, flying in and receding. It reads well and it is honest about
/// level, pitch and brightness, but the positions in it are invented: nothing
/// in that orbit tells you which part of the file a grain came from.
///
/// This is the other picture, and the one the controls are actually about.
/// Across is the source, start to end, with its waveform behind. Up and down
/// is pitch offset. Every dot is a real grain from the same enumeration the
/// renderer and the exporter use, sitting at the frame it reads from.
///
/// It is also the control. The box is the read head: where it sits, how far
/// grains are thrown from it, and how far their pitch scatters. Drag the box
/// to move the head, drag outside it to spread it. Three sliders under one
/// hand, which is what those three numbers actually are — a place and a size.
const CLOUD_PITCH_FLOOR = 4;

function cloudPadGeometry(canvas) {
  const st = state.edit?.stretch;
  if (!st) return null;
  const g = state.grainDraft || st.grain;
  if (!g) return null;
  const base = state.edit?.baseFrames || state.view?.frames || 0;
  if (!base) return null;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;

  const scan = g.scan ?? 1;
  const pos = g.position ?? 0;
  // Where the head is at this instant: its home, plus wherever it has been
  // moved to, plus however far the sweep has carried it. The same three terms
  // `event_at` adds up, so the box sits where the grains are coming from.
  //
  // The sweep is the *output* frame over the ratio, and `sourceFrameNow` is
  // already that — it is the engine's position mapped back through the stretch.
  // Dividing by the ratio again was dividing twice: at eight times the head
  // crawled at an eighth speed and reached an eighth of the way across the file
  // by the time the sound had finished, which is exactly how it looked.
  const home = scan < 0 ? base : 0;
  const sweep = sourceFrameNow() * scan;
  const head = home + pos * base + sweep;

  const sr = state.grains?.sampleRate || state.view?.sampleRate || 48000;
  const sprayFrames = ((g.positionJitterMs || 0) / 1000) * sr;
  // A quarter more than the scatter actually reaches, so the box sits *inside*
  // the plot with air around it. Scaled exactly to the scatter, the box filled
  // the full height whenever there was no drift and read as a stripe rather
  // than as something you could take hold of.
  const semis = Math.max(CLOUD_PITCH_FLOOR,
                         ((g.pitchJitterSemis || 0) + (g.pitchDriftSemis || 0)) * 1.25);

  return {
    w, h, base, sr, g, st, head, home, sweep, semis,
    x: (frame) => (frame / base) * w,
    y: (offset) => h / 2 - (offset / semis) * (h / 2 - 8),
    halfW: (sprayFrames / base) * w,
    halfH: ((g.pitchJitterSemis || 0) / semis) * (h / 2 - 8),
  };
}

/// Every cloud pad on the page — the Time & Pitch panel's, and the compact
/// grain panel's in Compose. Each draws only if it is on screen.
function drawCloudPads() {
  for (const c of document.querySelectorAll('canvas.cloud-pad')) drawCloudPad(c);
}

function drawCloudPad(canvas = $('cloudPad')) {
  if (!canvas || canvas.offsetParent === null) return;
  const geo = cloudPadGeometry(canvas);
  const dpr = window.devicePixelRatio || 1;
  if (!geo) return;
  const { w, h } = geo;
  // Both dimensions — see `drawGrainLayer`, where testing only the width left
  // the backing store the wrong height after a vertical resize.
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  // The source underneath, so a position means something. Same envelope the
  // automation lanes use — one fetch, already in hand.
  drawLaneWave(c, w, h, geo.base);

  // The pitch centre line.
  c.strokeStyle = 'rgba(255,255,255,.07)';
  c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();

  // The head and its spread. This is a pointer rather than a reading — it says
  // where you are about to read from — so it takes `--accent` and moves with the
  // theme, unlike the waveform under it.
  const bx = geo.x(geo.head);
  const acc = ink('--accent');
  c.fillStyle = acc;
  withAlpha(c, 0.09, () => {
    c.fillRect(bx - geo.halfW, h / 2 - geo.halfH, geo.halfW * 2, geo.halfH * 2);
  });
  c.strokeStyle = acc;
  c.lineWidth = 1;
  withAlpha(c, 0.7, () => {
    c.strokeRect(bx - geo.halfW, h / 2 - geo.halfH, geo.halfW * 2, geo.halfH * 2);
  });
  withAlpha(c, 0.9, () => {
    c.beginPath(); c.moveTo(bx, 0); c.lineTo(bx, h); c.stroke();
  });

  // The grains themselves, from the renderer's own enumeration.
  const g = state.grains;
  // Each pad names its own readout; the Time & Pitch pad's is the default.
  const readout = $(canvas.dataset.read || 'cloudPadRead');
  if (!g || !g.grains?.length) {
    if (readout) readout.textContent = 'no cloud — raise Density or Layers';
    return;
  }
  const baseSemis = geo.st.semitones ?? 0;
  const now = playbackTime();
  const playFrame = now * geo.sr;

  // A grain is not a point, it is a span: it starts at `srcFrame` and reads
  // forward through `size × rate` frames. Drawn at its start, a cloud of long
  // grains looks as though the end of the file is never touched — and worse,
  // the engine refuses to start a grain that would read off the end, so every
  // one that wants to is clamped to the last legal position and they pile into
  // a wall there. That wall is real, and it was being drawn as the edge of the
  // picture. Plotted at the middle of what each grain actually reads, the cloud
  // covers the file the way the sound does.
  const readMid = (srcFrame, size, pitchSemis) =>
    srcFrame + (size * Math.pow(2, pitchSemis / 12)) / 2;

  for (const [outFrame, srcFrame, size, pitch, , bright] of g.grains) {
    const dt = (outFrame - playFrame) / geo.sr;
    // Everything is drawn, but what is sounding now is drawn brightest — the
    // cloud is a shape you are moving through, not only a shape.
    const near = Math.max(0, 1 - Math.abs(dt) / 2.5);
    const alpha = 0.08 + near * near * 0.72;
    // Dots, not discs. This strip is a hundred and thirty pixels tall and
    // holds a whole file across, so a five-pixel circle covers a tenth of a
    // second of source and a sixth of the pitch range — at that scale a grain
    // was not a grain, it was a blob, and a hundred of them were one blob.
    // A point says where it is and nothing it has no room to say; length and
    // brightness are legible in the panel on the right, which has the space.
    const r = 0.6 + Math.min(1.1, (size / geo.sr) * 8);
    c.fillStyle = grainColour(pitch - baseSemis, bright, alpha);
    c.beginPath();
    c.arc(geo.x(readMid(srcFrame, size, pitch)), geo.y(pitch - baseSemis), r, 0, Math.PI * 2);
    c.fill();
  }
  if (readout) {
    const secs = (geo.head / geo.sr).toFixed(2);
    readout.textContent = `${g.total.toLocaleString()} grains · head ${secs}s`;
  }
}

/// Move the head, or spread it — whichever the gesture is.
///
/// Inside the box moves it; outside spreads it. No corner handles and no modes:
/// a handle a few pixels wide is a thing to miss, and the distinction between
/// "grab the thing" and "grab the air around it" is one nobody has to be told.
function wireCloudPad(canvas = $('cloudPad')) {
  if (!canvas || canvas._wired) return;
  canvas._wired = true;

  let mode = null;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const apply = (e) => {
    const geo = cloudPadGeometry(canvas);
    if (!geo) return;
    const { px, py } = at(e);
    const d = state.grainDraft;
    if (!d) return;

    if (mode === 'move') {
      // Solve `event_at` backwards for the offset: the frame under the pointer
      // is home + position*base + sweep, and everything but position is known.
      const frame = (px / geo.w) * geo.base;
      d.position = Math.max(-1, Math.min(1, (frame - geo.home - geo.sweep) / geo.base));
      state.grainRows?.position?.sync(d.position);
    } else {
      const bx = geo.x(geo.head);
      const spray = Math.abs(px - bx) / geo.w * geo.base / geo.sr * 1000;
      d.positionJitterMs = Math.max(0, Math.min(500, spray));
      const semis = Math.abs(py - geo.h / 2) / (geo.h / 2 - 8) * geo.semis;
      d.pitchJitterSemis = Math.max(0, Math.min(24, semis));
      state.grainRows?.positionJitterMs?.sync(d.positionJitterMs);
      state.grainRows?.pitchJitterSemis?.sync(d.pitchJitterSemis);
    }
    drawCloudPads();
    if (typeof composeGrainSync === 'function') composeGrainSync();
    state.grainSend?.preview();
  };

  canvas.onpointerdown = (e) => {
    const geo = cloudPadGeometry(canvas);
    if (!geo) return;
    const { px, py } = at(e);
    const bx = geo.x(geo.head);
    const inside = Math.abs(px - bx) <= Math.max(geo.halfW, 5)
                && Math.abs(py - geo.h / 2) <= Math.max(geo.halfH, 5);
    mode = inside ? 'move' : 'spread';
    canvas.setPointerCapture(e.pointerId);
    apply(e);
  };
  canvas.onpointermove = (e) => { if (mode) apply(e); };
  canvas.onpointerup = (e) => {
    if (!mode) return;
    mode = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    // The release is what writes it into the document and reloads the cloud.
    state.grainSend?.commit();
  };
}

function drawGrains() {
  // Drawn whether or not the swarm is: the pad is a control as well as a
  // picture, and a control that goes blank when the transport stops is no use.
  drawCloudPads();

  // Only the view that is showing does any work. The swarm was redrawing its
  // whole canvas every frame while a 3D view was up and it was not even on
  // screen — a full clear, a pass over every grain in the window and a
  // gradient per grain, sixty times a second, for nothing.
  if (grainView !== 0) return;

  const set = visSetup(engine.playing);
  if (!set) return;
  const { ctx, w, h } = set;
  const g = state.grains;
  const label = $('grainCount');

  if (!g || !g.grains.length) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Engage a grain control to see the swarm', 12, h / 2);
    if (label) label.textContent = '';
    return;
  }
  if (label) {
    const shown = g.shown < g.total ? ` · showing ${g.shown.toLocaleString()}` : '';
    label.textContent = `${g.total.toLocaleString()} grains${shown}`;
  }

  // The swarm draws around the playhead, so it takes the playhead's copy of the
  // schedule when the view is looking somewhere else — see `loadSwarmGrains`.
  const sg = (state.swarm?.grains?.length ? state.swarm : g);

  // Levels in the stream are small absolute numbers; normalising against the
  // loudest grain is what makes size vary visibly across the swarm.
  if (sg._peak === undefined) {
    sg._peak = sg.grains.reduce((m, r) => Math.max(m, r[4] || 0), 0) || 1;
  }
  drawGrainSwarm(ctx, w, h, sg);
}

/// The swarm: grains as a cloud orbiting the playhead.
///
/// Depth is time from the playhead, so grains fly in, cluster while sounding,
/// then recede. Height is pitch offset. Size is level, normalised against the
/// loudest grain. Colour is brightness and pitch together. Every value comes
/// from the grain stream the renderer uses.
function drawGrainSwarm(ctx, w, h, g) {
  const sr = g.sampleRate || 48000;
  const base = state.edit?.stretch?.semitones ?? 0;
  const now = playbackTime();
  const playFrame = now * sr;
  const cx = w / 2;
  const cy = h / 2;

  const SPAN = 1.4;                    // seconds either side of the playhead
  const FOCAL = 300;
  const R = Math.min(w, h) * 0.46;     // orbit scaled to the box, not fixed px

  const visible = [];
  for (const [outFrame, srcFrame, size, pitch, rms, bright] of g.grains) {
    const dt = (outFrame - playFrame) / sr;
    if (dt < -SPAN || dt > SPAN) continue;
    const z = dt * 230 + 120;
    if (z <= 14) continue;

    const sounding = dt <= 0 && dt + size / sr >= 0;
    const seedish = ((outFrame * 2654435761) % 997) / 997;
    const phase = seedish * Math.PI * 2 + now * (0.8 + seedish * 1.8);

    const spread = 0.35 + Math.min(1, Math.abs(pitch - base) / 9) * 0.65;
    const wob = sounding ? 1 + 0.16 * Math.sin(now * 11 + seedish * 7) : 1;
    const radius = R * spread * (0.45 + seedish * 0.55) * wob;
    const scale = FOCAL / (FOCAL + z);

    const px = cx + Math.cos(phase) * radius * scale;
    const py = cy - ((pitch - base) / 10) * h * 0.30
                  + Math.sin(phase * 1.27) * radius * 0.42 * scale;

    const level = Math.sqrt(Math.max(0, rms) / g._peak);
    const r = Math.max(1.0, (1.8 + level * 13) * scale * (sounding ? 1.5 : 1));
    // Additive blending accumulates: with dozens of overlapping grains a high
    // per-grain alpha saturates the whole cloud to flat white. Keep each one
    // faint and let the density do the work.
    const alpha = Math.max(0.05, (1 - Math.abs(dt) / SPAN) ** 1.6) * (sounding ? 0.42 : 0.16);
    visible.push({ px, py, r, alpha, pitch, bright, sounding, z });
  }

  visible.sort((a, b) => b.z - a.z);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const v of visible) {
    const col = grainColour(v.pitch - base, v.bright, v.alpha);
    ctx.shadowBlur = v.sounding ? 8 : 4;
    ctx.shadowColor = col;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(v.px, v.py, v.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText(`${visible.length} in flight`, 10, h - 10);
  if (!engine.playing) {
    ctx.fillStyle = 'rgba(255,255,255,0.40)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('press play — the swarm follows the playhead', 10, 18);
  }
}

// Animate only while something is playing, so an idle editor costs nothing.
let grainRaf = null;
function grainLoop() {
  grainRaf = requestAnimationFrame(grainLoop);
  if (!playsDocument() || !state.grains) return;
  // Nothing to draw into when the controls are not on screen — with another
  // dock open this loop was painting two canvases nobody could see.
  //
  // **Asked of the pad itself, not of the container it happens to be in.** The
  // controls live in the dock in Edit and in the room's Sound tab in Room, so a
  // check named after `#dockStretch` said "hidden" in the room and stopped the
  // pad animating there — while the controls were on screen and being used.
  const pad = $('cloudPad');
  // Any pad on screen: the compact panel's in Compose counts as much as this.
  const anyPad = [...document.querySelectorAll('canvas.cloud-pad')].some((c) => c.offsetParent !== null);
  if (!pad || !anyPad) return;
  drawGrains();
}
/// The swarm animates only while the engine is playing, so an idle editor
/// costs nothing.
///
/// The grains it draws come from the schedule endpoint, which is the same
/// enumeration the engine renders from — so the picture still cannot show a
/// grain the speakers did not play. What the engine supplies here is the
/// playhead they orbit.
function startSwarm() {
  if (!grainRaf) grainLoop();
}

function stopSwarm() {
  // Let it settle for a moment rather than freezing mid-flight.
  setTimeout(() => {
    if (!engine.playing && grainRaf) { cancelAnimationFrame(grainRaf); grainRaf = null; }
    drawGrains();
  }, 600);
}

enablePainting($('dock'));

if (window.ResizeObserver) {
  const c = $('grainCanvas');
  if (c) new ResizeObserver(() => drawGrains()).observe(c);
  // The pad needs its own. It is redrawn from `drawGrains`, and that loop is
  // cancelled a moment after playback stops — so resizing the window while
  // stopped left the canvas at its old backing size with the browser scaling
  // the stale bitmap to fit. Which is why it came out squashed, with the end
  // of the file looking folded over.
  const pad = $('cloudPad');
  if (pad) new ResizeObserver(() => drawCloudPad(pad)).observe(pad);
}

// ------------------------------------------------------- which view of the grains
//
// Six ways to look at one schedule: the original 2D swarm, and the five 3D
// views. The 3D ones live in an iframe rather than being ported in here — they
// are a p5 sketch with their own render loop, and running that inside the app's
// loop would mean two animation clocks fighting over one canvas. Being a
// separate document also means the same file is the standalone viewer, so there
// is one implementation to keep honest rather than two.

/// 0 is the 2D swarm; 1..5 index the 3D views.
let grainView = 0;

/// Send the document's time, pitch and grain settings to the views.
///
/// They were already drawing the engine's arithmetic faithfully; what they had
/// no way of knowing was which document. Everything else about them is left
/// exactly as it was.
function pushGrainParams() {
  const st = state.edit?.stretch;
  if (!st) return;
  const g = st.grain || {};
  const sr = state.view?.sampleRate || 48000;
  // Without a real length there is nothing to send. Posting a zero here made
  // the page rebuild its whole schedule over a one-frame source, which is a
  // handful of grains in a corner — every view empty, and nothing about it
  // looking like a length problem.
  const seconds = (state.edit?.baseFrames || 0) / sr;
  if (!(seconds > 0.001)) return;
  const msg = {
    type: 'grainParams',
    params: {
      ratio: st.ratio,
      semitones: st.semitones,
      windowMs: st.windowMs,
      rateHz: g.rateHz,
      densityHz: g.densityHz,
      overlap: g.overlap,
      sizeJitter: g.sizeJitter,
      positionJitterMs: g.positionJitterMs,
      pitchJitterSemis: g.pitchJitterSemis,
      pitchDriftSemis: g.pitchDriftSemis,
      driftRateHz: g.driftRateHz,
      panSpread: g.panSpread,
      seed: g.seed,
      // So the geometry is laid out over the real file's length rather than
      // the two seconds the page assumes when it is standing on its own.
      sourceSeconds: seconds,
    },
  };
  $('grainFrame')?.contentWindow?.postMessage(msg, location.origin);
  pop.frame?.contentWindow?.postMessage(msg, location.origin);
}

function setGrainView(v) {
  grainView = v;
  for (const b of document.querySelectorAll('.vis-tab')) {
    b.classList.toggle('active', +b.dataset.vis === v);
  }
  const frame = $('grainFrame'), canvas = $('grainCanvas'), legend = document.querySelector('.vis-legend');
  const is3d = v > 0;

  canvas.classList.toggle('hidden', is3d);
  legend.classList.toggle('hidden', is3d);
  frame.classList.toggle('hidden', !is3d);

  // The frame keeps its engine connection open and polls for it. Hidden, that
  // is a request every eighth of a second for a picture nobody is looking at.
  frame.contentWindow?.postMessage(
    { type: 'grainAwake', awake: is3d }, location.origin);

  if (!is3d) {
    // Coming back to the swarm from a 3D view: the loop skipped it while it was
    // hidden, so it holds whatever was on it when you left. Paint it once.
    drawGrains();
    return;
  }
  if (!frame.src) {
    frame.src = `/grains3d?embed=1&view=${v - 1}`;
    // A document's settings cannot be posted at a frame that has not loaded.
    frame.onload = () => pushGrainParams();
  } else {
    // Already loaded — switch views in place so the camera and the engine
    // connection survive. Reloading the src would restart both.
    frame.contentWindow?.postMessage({ type: 'grainView', view: v - 1 }, location.origin);
  }
}

// Which suite the 3D views are showing. V1 tours the cloud as an object; V2
// sits inside the moment and lets time come past. Same five slots either way,
// so the tabs only need relabelling.
let grainSuite = 1;
const SUITE_NAMES = {
  1: ['Shear', 'Braid', 'Swarm 3D', 'Shells', 'Lattice'],
  2: ['Tunnel', 'Mandala', 'Rorschach', 'Vortex', 'Ripple']
};

function setGrainSuite(n) {
  grainSuite = n === 2 ? 2 : 1;
  $('visSuite').textContent = 'V' + grainSuite;
  $('visSuite').classList.toggle('active', grainSuite === 2);

  const names = SUITE_NAMES[grainSuite];
  for (const b of document.querySelectorAll('.vis-tab')) {
    const i = +b.dataset.vis;
    if (i >= 1) b.textContent = names[i - 1];
  }
  for (const b of document.querySelectorAll('.vis-pop-tab')) {
    b.textContent = names[+b.dataset.view];
  }

  const post = { type: 'grainSuite', suite: grainSuite };
  $('grainFrame').contentWindow?.postMessage(post, location.origin);
  pop.frame?.contentWindow?.postMessage(post, location.origin);
}

for (const b of document.querySelectorAll('.vis-tab')) {
  if (b.id === 'visSuite') continue;
  b.onclick = () => setGrainView(+b.dataset.vis);
}
// Apply the starting view rather than assuming the markup already matches it.
// It did not: `grainView` opened on the composite while the markup still had
// the 2D swarm showing, so the default view was never the one on screen.
setGrainView(grainView);
const visSuiteBtn = $('visSuite');
if (visSuiteBtn) visSuiteBtn.onclick = () => setGrainSuite(grainSuite === 1 ? 2 : 1);
// A floating panel rather than a new tab. The whole point of watching the
// grains is to watch them *while* moving a slider, and a separate window puts
// the controls behind the thing you are looking at.
const pop = {
  el: null, frame: null,
  x: 0, y: 0, w: 1060, h: 680,
  mode: null, ox: 0, oy: 0
};

const fence = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

