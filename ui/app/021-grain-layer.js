// ======================================================= the grain layer
//
// The grains on the waveform, the read band and the playhead. The end of
// `020-audio.js` until 11 Nov 2026, in a part of its own so that neither
// passes 1,000 lines. Joined straight after it, so the order is unchanged.

/// The grains, drawn on the sound they read from.
///
/// Two layers, because they answer two different questions. The faint one is
/// every grain in the schedule at the place in the file it reads from — the
/// shape of what the cloud is going to do to this sound, standing still. The
/// bright one is the handful sounding at this instant, struck and fading, so
/// the playhead crossing the file *does* something visible rather than sliding
/// over a picture.
///
/// It sits on the source timeline, which is the lane's axis and not the
/// schedule's. On a stretched document that means the same few marks are struck
/// again and again as the head crawls through them, and that is the honest
/// picture: at eight times the cloud really is re-reading one stretch of file
/// over and over.
///
/// Above the waveform and below the selection: it describes the sound, it is
/// not something you grab.
/// How many schedule marks the waveform layer will draw.
///
/// Raised from 2,000. The server now spends its cap inside the visible window
/// rather than across the whole document, so at any zoom there are thousands of
/// real grains on screen to draw — and the old cap threw three quarters of them
/// away again on this side. Canvas strokes a single path for all of them, so
/// this is one draw call whatever the number.
/// Where on the lane the grain marks are struck from, as a fraction of its
/// height.
///
/// It was `h / 2` — the middle of the *layer*, which spans the whole lane. With
/// the spectrogram splitting that lane the waveform only has the top of it, so
/// the marks were struck from a line well below the sound they describe. The
/// default now follows the split, and the grip overrides it.
function grainCentreDefault() {
  const lane = $('lane');
  if (lane && lane.classList.contains('split')) return laneSplit() / 200;
  return 0.5;
}

/// Where it was put by hand, or where the layout says it belongs.
///
/// `null` in the store means nobody has placed it — which is a different answer
/// from any number, and is why this one setting cannot state its default in the
/// table with the rest.
function grainCentre() {
  return prefs.grainCentre === null ? grainCentreDefault() : prefs.grainCentre;
}

function setGrainCentre(frac, { save = true } = {}) {
  const v = Math.min(0.98, Math.max(0.02, frac));
  if (save) {
    setPref('grainCentre', v);
  } else {
    setGrainCentre.live = v;
  }
  placeGrainCentre(v);
  drawGrainLayer();
  return v;
}

function placeGrainCentre(frac) {
  const grip = $('grainCentre');
  if (grip) grip.style.top = `${(frac * 100).toFixed(3)}%`;
}

/// While dragging, the live value; otherwise what is stored.
function grainCentreNow() {
  const grip = $('grainCentre');
  if (grip?.classList.contains('dragging') && setGrainCentre.live !== undefined) {
    return setGrainCentre.live;
  }
  return grainCentre();
}

const GRAIN_LAYER_CAP = 12000;

/// How long a struck grain stays lit, in seconds of output.
const SIZZLE_SECONDS = 0.28;

function drawGrainLayer() {
  const el = $('grainLayer');
  if (!el) return;
  const g = state.grains;
  const { from, to, sampleRate } = state.view;
  if (!g?.grains?.length || !state.peaks || !sampleRate || to <= from) {
    el.classList.add('hidden');
    $('grainCentre')?.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  $('grainCentre')?.classList.remove('hidden');

  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  // Both dimensions, not just the width.
  //
  // Testing the width alone meant a change in *height* never re-sized the
  // backing store: make the window taller and the element went to 663 CSS px
  // while its canvas stayed 766 device px tall — everything drawn into it
  // squashed by a factor of 1.7, at a size nothing on screen had. The width is
  // the one that usually changes, which is exactly why this survived.
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    // The room is a different size on screen, so the grips are in the wrong
    // places until they are told. Only on the frames where it actually changed.
    if (roomEdit.on) { paintRoomHandles(); paintSolidPath(); }
  }
  const c = el.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const mid = h * grainCentreNow();
  const sr = g.sampleRate || sampleRate;
  const playFrame = playbackTime() * sr;
  const span = to - from;
  const x = (frame) => ((frame - from) / span) * w;
  const base = state.edit?.stretch?.semitones ?? 0;

  // Thinned to what is *in view*, not to the whole schedule.
  //
  // Striding the whole file and then dropping whatever fell off the edges meant
  // zooming in showed the same handful of marks further apart — the picture got
  // bigger and no more detailed, which is backwards. Zooming in is asking to
  // see more, so the closer the window gets the more of the real schedule
  // appears in it.
  const all = g.grains;
  const inView = [];
  for (const ev of all) {
    if (ev[1] >= from && ev[1] <= to) inView.push(ev);
  }
  const stride = Math.max(1, Math.ceil(inView.length / GRAIN_LAYER_CAP));

  // ── the layer ───────────────────────────────────────────────────────────
  // Marks grow with the zoom. Far out, each grain is a fraction of a pixel and
  // wants to be a faint tick; far in, one grain may be tens of pixels wide, and
  // a five-pixel tick says nothing about its length. So the mark is drawn at the
  // grain's real duration once that is worth seeing, and the opacity rises as
  // they thin out — which is what "more visible as you zoom in" has to mean if
  // the density stays honest.
  const pxPerFrame = w / Math.max(1, to - from);
  const spread = inView.length ? (to - from) / inView.length : 0;
  const apart = spread * pxPerFrame;
  const ink = Math.min(0.55, 0.13 + apart * 0.06);
  const tall = Math.min(h * 0.42, 5 + apart * 1.5);

  c.lineWidth = 1;
  c.strokeStyle = waveInk(true);
  c.globalAlpha = ink;
  c.beginPath();
  for (let i = 0; i < inView.length; i += stride) {
    const px = x(inView[i][1]);
    // Short ticks off the centre line rather than full-height bars: the
    // waveform underneath is the thing being read, and a picket fence over it
    // hides exactly what the marks are about.
    c.moveTo(px, mid - tall);
    c.lineTo(px, mid + tall);
  }
  c.stroke();
  c.globalAlpha = 1;

  // ── the sizzle ──────────────────────────────────────────────────────────
  //
  // Every grain that has been struck within the last fraction of a second,
  // brightest at the moment it starts. Drawn from the schedule rather than
  // remembered, so it is a pure function of where the playhead is — scrub
  // backwards and the same grains light in the same places.
  // Struck from the densest copy that covers the playhead. The view's schedule
  // is thinned to fit the cap across the whole window; the swarm's is eight
  // seconds wide and so arrives whole. Ticks stay on the view copy — they are a
  // picture of the *whole* range and want its spread, not the playhead's.
  const sparks = (swarmFor && state.swarm?.grains?.length
    && playFrame >= swarmFor[0] && playFrame <= swarmFor[1])
    ? state.swarm.grains
    : all;

  let lit = 0;
  for (const [outFrame, srcFrame, size, pitch, rms, bright] of sparks) {
    const since = (playFrame - outFrame) / sr;
    if (since < 0 || since > SIZZLE_SECONDS) continue;
    const px = x(srcFrame);
    if (px < -4 || px > w + 4) continue;
    lit++;

    const t = 1 - since / SIZZLE_SECONDS;
    const heat = t * t;
    const lvl = Math.min(1, (rms || 0) * 7 + 0.15);
    const half = (6 + lvl * (h * 0.42)) * (0.45 + heat * 0.55);
    const warm = (pitch - base) >= 0;

    // The spark: a bright core with a short bloom, which is what makes it read
    // as struck rather than merely coloured in.
    const grd = c.createLinearGradient(px, mid - half, px, mid + half);
    const core = warm
      ? `rgba(255, ${190 - Math.min(70, (pitch - base) * 6) | 0}, 130,`
      : `rgba(150, 205, 255,`;
    grd.addColorStop(0, `${core} 0)`);
    grd.addColorStop(0.5, `${core} ${(0.28 + heat * 0.62).toFixed(3)})`);
    grd.addColorStop(1, `${core} 0)`);
    c.strokeStyle = grd;
    c.lineWidth = 1 + heat * 1.6 + (bright || 0) * 2;
    c.beginPath();
    c.moveTo(px, mid - half);
    c.lineTo(px, mid + half);
    c.stroke();
  }

  // Only when it actually dropped some, and only where it cannot be mistaken
  // for part of the sound.
  if (stride > 1) {
    c.fillStyle = 'rgba(220,228,235,.35)';
    c.font = '9px ui-monospace, monospace';
    c.fillText(`1 grain in ${stride} shown · zoom in for more`, 6, h - 6);
  }
}

/// How much of the file the cloud is reading, drawn on the file.
///
/// A playhead is a line because ordinary playback reads one sample at a time.
/// A grain cloud reads a whole region at once — a spray of two hundred
/// milliseconds is two hundred milliseconds wide, and layer scatter can put
/// parts of it seconds away — so a line was saying something untrue about it.
///
/// Measured from the grains that are actually sounding rather than worked out
/// from the controls. Spray, scatter, layer count and the grain length all end
/// up in the answer without any of them having to be named here, and it cannot
/// disagree with what is being heard because it *is* what is being heard.
function updateReadBand() {
  const el = $('readBand');
  if (!el) return;
  const g = state.grains;
  const { from, to, sampleRate } = state.view;
  const lane = $('lane');
  if (!g?.grains?.length || !state.peaks || !sampleRate || to <= from || !lane) {
    el.style.display = 'none';
    return;
  }
  const sr = g.sampleRate || sampleRate;
  const playFrame = playbackTime() * sr;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [outFrame, srcFrame, size] of g.grains) {
    if (outFrame > playFrame || outFrame + size < playFrame) continue;
    // The whole span the grain reads, not just where it starts.
    if (srcFrame < lo) lo = srcFrame;
    if (srcFrame + size > hi) hi = srcFrame + size;
  }
  if (!isFinite(lo) || hi <= lo) { el.style.display = 'none'; return; }

  const w = lane.clientWidth || 0;
  const px = (f) => ((f - from) / (to - from)) * w;
  const a = px(lo);
  const b = px(hi);
  if (b < 0 || a > w) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.transform = `translateX(${Math.max(0, a).toFixed(2)}px)`;
  el.style.width = `${Math.max(1, Math.min(w, b) - Math.max(0, a)).toFixed(2)}px`;
}

function updatePlayhead() {
  // The playhead first, before anything that walks the grain schedule.
  //
  // This used to run after `updateReadBand` and `drawGrainLayer`, so the one
  // element that has to move every single frame was placed only once two full
  // passes over eight thousand grains and a canvas repaint had finished. Any
  // frame those overran was a frame the playhead did not move in.
  const ph = $('playhead');
  const { from, to, sampleRate } = state.view;
  if (!state.peaks || !sampleRate || to <= from) {
    ph.style.display = 'none';
    updateReadBand(); drawGrainLayer();
    return;
  }
  // The overview is the source, so the playhead has to be mapped back through
  // the stretch rather than plotted straight from the clock.
  const frame = sourceFrameNow();
  if (frame < from || frame > to) {
    ph.style.display = 'none';
    updateReadBand(); drawGrainLayer();
    return;
  }
  ph.style.display = 'block';
  // A transform rather than `left`: moving it every frame via a layout property
  // forces a reflow of the whole lane sixty times a second.
  const lane = $('lane');
  const x = ((frame - from) / (to - from)) * (lane.clientWidth || 0);
  ph.style.transform = `translateX(${x.toFixed(2)}px)`;
  // Now the rest, which may take as long as it likes.
  updateReadBand();
  drawGrainLayer();
}

