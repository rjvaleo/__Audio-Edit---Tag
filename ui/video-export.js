// Filming the room.
//
// See `docs/VIDEO-EXPORT.md`. The server has already rendered the audio and
// analysed it frame by frame — the same two meter functions the live scope
// feeds, over the samples that are actually in the file. This replays that reel
// into a `vis-gl` of its own at whatever size was asked for, hands each frame to
// the browser's H.264 encoder, and muxes the result with `ui/mp4.js`.
//
// **Offline, and as fast as the machine manages.** Nothing here waits on a
// clock. A forty-times stretch of a three-minute file is a two-hour render if it
// is filmed as it plays, which is the ratio at which these visuals are worth
// filming in the first place.

/// The sizes offered, as decided.
const VIDEO_SIZES = [
  { key: '720p', label: '720p', w: 1280, h: 720 },
  { key: 'hd', label: 'HD', w: 1920, h: 1080 },
  { key: '1440p', label: '1440p', w: 2560, h: 1440 },
  { key: '4k', label: '4K UHD', w: 3840, h: 2160 },
  { key: 'square', label: 'Square', w: 1080, h: 1080 },
  { key: 'square2k', label: 'Square large', w: 2048, h: 2048 },
  { key: 'portrait', label: 'Portrait', w: 1080, h: 1350 },
  { key: 'vertical', label: 'Vertical', w: 1080, h: 1920 },
  { key: 'vertical4k', label: 'Vertical 4K', w: 2160, h: 3840 },
];

/// Thirty or sixty. Nothing in between is offered, so nothing here has to round
/// a frame duration to a recurring number of ticks.
const VIDEO_RATES = [30, 60];

/// How far the picture runs past the sound, in seconds.
///
/// **Derived, not written down.** The floor holds `VG_HISTORY` frames of
/// spectrum pushed every `MB_POLL_MS`, so that much sound is always on its way
/// to the back wall. Cut on the last sample and the room is chopped mid-journey
/// with the final ridges hanging in the middle of it. If either constant moves,
/// this moves with it — which is the whole reason it is a sum and not a number.
function videoOutroSeconds() {
  return (VG_HISTORY * MB_POLL_MS) / 1000;
}

/// The rate the room's own trail advances at, which is not the video's rate.
///
/// The terrain is pushed at the poll's rate and travels at the poll's rate. Push
/// it once per *video* frame instead and the room drains two or three times too
/// fast — the same picture, played wrong. So the reel is analysed at this rate,
/// and a video frame pushes only when it has crossed into the next one.
function videoPollHz() {
  return 1000 / MB_POLL_MS;
}

/// Whether this browser can do the work at all.
function videoExportSupport() {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return 'this browser has no VideoEncoder — Chrome, Edge or Arc will do it';
  }
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    return 'this browser has no AudioEncoder — Chrome, Edge or Arc will do it';
  }
  return null;
}

/// Ask the server for the reel, and wait for it.
async function videoAnalyse(body, onProgress) {
  await postJSON('/api/video', body);
  for (;;) {
    await new Promise((r) => setTimeout(r, 200));
    const s = await api('/api/video');
    onProgress(s);
    if (s.error) throw new Error(s.error);
    if (!s.running && s.phase === 'ready') return s;
    if (!s.running && (s.phase === 'cancelled' || s.phase === 'failed')) {
      throw new Error(s.phase === 'cancelled' ? 'cancelled' : 'the analysis failed');
    }
  }
}

/// The whole reel, as one `Float32Array`, pulled in runs.
///
/// In runs because a long render is tens of millions of numbers and one request
/// for all of it is a single allocation the size of the render on both sides of
/// the wire.
async function videoFetchFrames(status, onProgress) {
  const per = status.bands + status.liss * 2;
  const out = new Float32Array(status.frames * per);
  const step = 240;
  for (let i = 0; i < status.frames; i += step) {
    const n = Math.min(step, status.frames - i);
    const r = await fetch(`/api/video/frames?i=${i}&n=${n}`);
    if (!r.ok) throw new Error('the reel went away part way through');
    const buf = new Float32Array(await r.arrayBuffer());
    out.set(buf, i * per);
    onProgress(i / status.frames);
  }
  return out;
}

/// The schedule, printed on the back wall of the filmed room.
///
/// **The same lines the live block prints**, from `roomDataBlock` — the film is
/// meant to be what the room looks like, and a second builder would be a second
/// thing to keep in step. What differs is only where they are put: HTML
/// positioned over the page there, glyphs in a 2D context here.
///
/// The wall is worked out for **the camera being filmed with**, which is not
/// necessarily the one on screen — see `roomCameraForAspect`.
function drawRoomData(ctx, size, camera, data, sched, position) {
  const wall = roomBackWall(size.w, size.h, camera);
  const scale = data.scale > 0 ? data.scale : 1;
  const ch = data.ch * scale;
  const lineH = data.line * scale;
  if (!(ch > 0) || !(lineH > 0)) return;

  const block = roomDataBlock({
    wall,
    ch,
    line: lineH,
    sched,
    position,
    chunk: data.chunk,
    head: data.head,
  });

  ctx.save();
  // Clipped to the wall, the same way the live block's box *is* the wall's box
  // and anything that does not fit is simply not seen. Without this a tile that
  // overhangs would print across the room and out over the floor.
  ctx.beginPath();
  ctx.rect(wall.x, wall.y, wall.w, wall.h);
  ctx.clip();
  ctx.font = `300 ${data.fontPx * scale}px ${data.font}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const rgb = dataRgb(data.colour);
  for (let i = 0; i < block.length; i++) {
    const b = block[i];
    // The stylesheet's five steps, in numbers. `roomDataAlpha` owns the ladder
    // so the wall cannot fade differently on film than it does on screen.
    const a = roomDataAlpha(b.kind, i) * (data.opacity ?? 1);
    if (a <= 0.001 || !b.text) continue;
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
    ctx.fillText(b.text, wall.x, wall.y + i * lineH);
  }
  ctx.restore();
}

function dataRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return [120, 160, 210];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/// Film it.
///
/// `onStage(text, fraction)` is called throughout; `signal` stops it.
async function videoExport({ path, from, to, repeats, tail, size, fps, camera,
  layers, occlude, order, room, background, data, schedule, fetchSchedule, padSeconds,
  loopOut, signal, onStage, module, ridge, ridgePaint }) {
  const why = videoExportSupport();
  if (why) throw new Error(why);

  const pollHz = videoPollHz();
  const status = await videoAnalyse({
    p: path,
    from, to, repeats, tail,
    // The reel is the *room's* rate. See `videoPollHz`.
    fps: pollHz,
    bands: VG_FLOOR_BANDS,
    liss: VG_LISS_POINTS,
    fft: 4096,
    outro: videoOutroSeconds(),
  }, (s) => {
    // The server's own two phases, named as it names them. Rendering has no
    // count worth showing — it is a stretch measured in passes over frames —
    // so it reports a fraction and the analysis reports frames.
    // **The render is most of the wait and it used to report nothing.** It is
    // the same render an audio export makes, and its progress goes into the
    // server's export tracker — which this route now reads while that phase is
    // running. Before that it sat at a hard zero for the whole stretch, which
    // on a forty-times render is minutes of a dead bar, and reads as a hang.
    //
    // `stage` is what the render is doing inside itself: reading, stretching,
    // writing. Those cost wildly different amounts per frame, so without it the
    // bar moves in lurches with nothing to account for them.
    if (s.phase === 'rendering') {
      const inner = s.stage && s.stage !== 'starting' ? `Rendering · ${s.stage}` : 'Rendering the sound';
      onStage(inner, (s.fraction || 0) * 0.14, s.done, s.total);
    } else if (s.phase === 'reading') {
      onStage('Reading it back', 0.14);
    } else if (s.phase === 'analysing' && s.total > 1) {
      onStage('Analysing', 0.15 + (s.fraction || 0) * 0.03, s.done, s.total);
    } else {
      onStage('Analysing', 0.15);
    }
  });

  const per = status.bands + status.liss * 2;
  const reel = await videoFetchFrames(status,
    (f) => onStage('Reading the reel', 0.18 + f * 0.04));

  onStage('Reading the sound', 0.22);
  const audioRes = await fetch('/api/video/audio');
  const audio = new Float32Array(await audioRes.arrayBuffer());
  const channels = status.channels;
  const rate = status.rate;
  const audioFrames = audio.length / channels;

  // The room, at the size being filmed, on a canvas of its own. The live one
  // keeps drawing whatever it was drawing; this is not it.
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  // **The module that is on screen, not the room by default.**
  //
  // Passed in rather than read from a global here: which visualiser is chosen
  // lives in one place, and a second copy of that decision inside the filming
  // code is exactly how the film and the room come to disagree — see the
  // background colour, twice, in this file's own history.
  const pick = (typeof VIS_MODULES !== 'undefined' && VIS_MODULES.find((m) => m.key === module))
    || null;
  const gl = pick ? pick.attach(canvas) : vgAttach(canvas);
  if (!gl) {
    throw new Error(pick && pick.key !== 'room'
      ? `this machine would not give the ${pick.label} a canvas`
      : 'this machine would not give a second WebGL context');
  }
  // The settings have to be in hand before any row is made, and the export
  // pushes a run of them before it draws anything. See `configure` in
  // `ridge.js`.
  if (gl.configure) gl.configure(ridge);

  // ── something behind it ──
  //
  // **The room is drawn on glass.** It clears to transparent and the page's own
  // background shows through — which on screen is `--bg` and in an offscreen
  // canvas is nothing at all. H.264 has no alpha, so what was a room on the
  // theme's near-black became a room composited against whatever the encoder
  // assumed, and the colours came out wrong in a way that is hard to name and
  // impossible to miss.
  //
  // So the frame that gets encoded is the room drawn onto an opaque ground, the
  // same way the panel does it when it goes fullscreen and has nothing behind
  // it either.
  const flat = document.createElement('canvas');
  flat.width = size.w;
  flat.height = size.h;
  const ctx = flat.getContext('2d', { alpha: false });
  ctx.fillStyle = background || '#000';

  const seconds = status.frames / pollHz;
  const videoFrames = Math.max(1, Math.ceil(seconds * fps));

  const mux = new Mp4Muxer({
    video: { width: size.w, height: size.h, fps },
    audio: { rate, channels },
    // Known before a frame is drawn, so the file can say how long it is rather
    // than making a player read the whole thing to find out.
    durationSeconds: videoFrames / fps,
  });

  // **An encoder's errors arrive on a callback, not on the call.** Throwing
  // from inside that callback throws into the browser's own task and nobody
  // catches it: the codec closes, the loop goes on handing frames to a dead
  // encoder, and what surfaces is "Cannot call 'encode' on a closed codec" —
  // which says only that something went wrong earlier and not what. So the
  // fault is kept and raised from the loop, where it can be seen.
  let fault = null;
  const keep = (what) => (e) => {
    if (!fault) fault = new Error(`${what} encoder: ${e.message || e}`);
  };
  const check = () => { if (fault) throw fault; };

  // The level has to cover the size, and a level that does not is a configure
  // that fails on some machines and not others. Asked rather than assumed —
  // `isConfigSupported` is there precisely so this is not a guess about what
  // hardware is in the machine.
  const bitrate = Math.min(60_000_000,
    Math.round(size.w * size.h * fps * 0.14));
  const codecs = [
    'avc1.640034',  // High 5.2 — 4K and above
    'avc1.640028',  // High 4.2
    'avc1.4d0028',  // Main 4.2
    'avc1.42e028',  // Baseline 4.2, which almost anything will take
  ];
  let picked = null;
  for (const codec of codecs) {
    const cfg = {
      codec,
      width: size.w,
      height: size.h,
      framerate: fps,
      // Enough that the room's fine wire does not turn to soup. The picture is
      // mostly black with thin bright lines, which is the worst case for a
      // codec tuned on faces and daylight.
      bitrate,
      avc: { format: 'avc' },
      latencyMode: 'quality',
    };
    try {
      const sup = await VideoEncoder.isConfigSupported(cfg);
      if (sup && sup.supported) { picked = sup.config || cfg; break; }
    } catch { /* try the next one */ }
  }
  if (!picked) {
    throw new Error(`nothing here will encode ${size.w}×${size.h} at ${fps}fps `
      + '— try a smaller size');
  }

  const vEnc = new VideoEncoder({
    output: (chunk, meta) => mux.add('video', chunk, meta),
    error: keep('video'),
  });
  vEnc.configure(picked);

  const aCfg = {
    codec: 'mp4a.40.2',
    sampleRate: rate,
    numberOfChannels: channels,
    bitrate: 192_000,
  };
  let aSup = null;
  try { aSup = await AudioEncoder.isConfigSupported(aCfg); } catch { /* below */ }
  if (!aSup || !aSup.supported) {
    throw new Error(`nothing here will encode ${channels}ch AAC at ${rate}Hz`);
  }
  const aEnc = new AudioEncoder({
    output: (chunk, meta) => mux.add('audio', chunk, meta),
    error: keep('audio'),
  });
  aEnc.configure(aSup.config || aCfg);

  // Whatever happens from here, the two codecs and the context are let go. A
  // failed run used to leave both open, and a second attempt then met a machine
  // with fewer encoders left than it started with.
  try {
    return await videoRun(); // eslint-disable-line no-use-before-define
  } finally {
    try { if (vEnc.state !== 'closed') vEnc.close(); } catch { /* already gone */ }
    try { if (aEnc.state !== 'closed') aEnc.close(); } catch { /* already gone */ }
    gl.dispose?.();
  }

  // ── the picture ──
  async function videoRun() {
  // **The cloud is fetched in windows, the way the live room fetches it.**
  //
  // The cap on a schedule request is spent inside whatever range is asked for.
  // Ask for the whole document and eight thousand grains are spread across the
  // entire file, so at any one instant there are almost none — which in the
  // room reads as a cloud that is not there, and made a film of a dense
  // granular passage look nothing like the passage. The live room asks for a
  // few seconds either side of the playhead and gets eight thousand *there*.
  //
  // So does this, refetching as the playhead leaves what it has.
  let sched = schedule || null;
  let schedFrom = 0;
  let schedTo = -1;
  const schedRate = () => (sched && sched.sampleRate) || rate;
  const pad = Math.max(0.5, padSeconds || 4);
  const windowFor = async (seconds) => {
    if (!fetchSchedule) return sched;
    const sr = schedRate();
    const at = seconds * sr;
    // Refetched before the edge rather than at it, so a grain about to be
    // crossed is already in hand.
    if (at >= schedFrom + sr * pad * 0.35 && at <= schedTo - sr * pad * 0.35) return sched;
    const from = Math.max(0, Math.round(at - sr * pad));
    const to = Math.round(at + sr * pad);
    const got = await fetchSchedule(from, to);
    if (got) {
      sched = got;
      schedFrom = from;
      schedTo = to;
    }
    return sched;
  };

  const frame = new Float32Array(status.bands);
  const liss = new Float32Array(status.liss * 2);
  let pushed = -1;
  for (let k = 0; k < videoFrames; k++) {
    check();
    if (signal?.aborted) throw new Error('cancelled');
    const t = k / fps;
    // Push only when the room's own clock has moved on. See `videoPollHz`.
    const want = Math.min(status.frames - 1, Math.floor(t * pollHz));
    while (pushed < want) {
      pushed++;
      const base = pushed * per;
      frame.set(reel.subarray(base, base + status.bands));
      liss.set(reel.subarray(base + status.bands, base + per));
      gl.push(frame, liss);
    }
    // Where the playhead is, as the room reckons it.
    //
    // For the whole file that is simply how far in we are. For a loop it is not:
    // the audio is the loop tiled, so the same stretch of schedule is played
    // again each time round, and a position that ran straight past the end
    // would leave the room empty for every repeat after the first.
    // The schedule for around here, before the room is asked to draw it.
    await windowFor(loopOut && loopOut.to > loopOut.from
      // A loop plays the same stretch again, so the window it wants is the
      // place *in the loop*, not how far into the film we are.
      ? (loopOut.from + ((t * rate) % (loopOut.to - loopOut.from))) / rate
      : t);

    let at = Math.round(t * rate);
    if (loopOut && loopOut.to > loopOut.from) {
      const span = loopOut.to - loopOut.from;
      at = at < span * (repeats || 1)
        ? loopOut.from + (at % span)
        // Past the last repeat is the tail, which is the rack sounding out
        // rather than more schedule. Hold at the end so nothing new is born.
        : loopOut.to;
    }
    gl.frame({
      ...room,
      // What the ridgeline reads. The room ignores them and it ignores the
      // room's — a module takes what it understands out of the frame.
      ridge,
      ridgePaint,
      cam: camera,
      layers,
      occlude,
      order,
      // **The film's clock, not the machine's.** Everything in the room that
      // moves on its own ages against this, and a render that is going as fast
      // as it can has no useful wall clock to offer it — see `clockMs`.
      clock: t,
      pollMs: MB_POLL_MS,
      // The schedule, so the grain layer has something to spawn from. Without
      // it the room draws its terrain and its ring and no cloud at all.
      //
      // **The schedule's own rate, not the render's.** A grain's `e[0]` counts
      // document frames at the document's sample rate; `position` counts
      // rendered frames at the rendered rate. They are two clocks and the room
      // is given both, exactly as the live one is — handing it one for both
      // makes every grain arrive at the wrong moment on any file whose rate is
      // not the device's.
      grains: sched?.grains || null,
      grainRate: sched?.sampleRate || rate,
      srcFrames: sched?.srcFrames || 0,
      position: at,
      positionRate: rate,
    });

    ctx.fillStyle = background || '#000';
    ctx.fillRect(0, 0, size.w, size.h);
    // **Between the ground and the room, which is where it lives.** On screen
    // the block sits at `z-index: 0` with the canvas at 1 over it, so the
    // terrain, the ring and the leading edge lie over the text the way they
    // would lie over anything painted on the far wall. Drawn after the room it
    // would be type on the glass instead, in front of everything.
    if (data && data.on) drawRoomData(ctx, size, camera, data, sched, at);
    ctx.drawImage(canvas, 0, 0);

    const vf = new VideoFrame(flat, {
      timestamp: Math.round((k * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    // A keyframe every two seconds, so the file can be seeked and so a player
    // that joins late has somewhere to start.
    vEnc.encode(vf, { keyFrame: k % (fps * 2) === 0 });
    vf.close();

    // Let the encoder catch up, and notice if it has died while doing so.
    while (vEnc.encodeQueueSize > 8 && !fault) {
      await new Promise((r) => setTimeout(r, 0));
    }
    check();
    // **The stage that actually takes the time**, so it gets most of the bar
    // and a count of its own. Every frame rather than every sixteenth: the
    // whole point of a number of frames is watching it move.
    onStage('Drawing and encoding', 0.24 + (k / videoFrames) * 0.68, k + 1, videoFrames);
  }

  // ── the sound ──
  //
  // In blocks, because `AudioData` wants planar and one block of a whole render
  // is a copy the size of the render.
  onStage('Encoding the sound', 0.92);
  const block = 8192;
  for (let i = 0; i < audioFrames; i += block) {
    check();
    if (signal?.aborted) throw new Error('cancelled');
    const n = Math.min(block, audioFrames - i);
    const planar = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) {
      for (let j = 0; j < n; j++) planar[c * n + j] = audio[(i + j) * channels + c];
    }
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: rate,
      numberOfFrames: n,
      numberOfChannels: channels,
      timestamp: Math.round((i / rate) * 1e6),
      data: planar,
    });
    aEnc.encode(data);
    data.close();
    while (aEnc.encodeQueueSize > 8 && !fault) await new Promise((r) => setTimeout(r, 0));
    check();
    onStage('Encoding the sound', 0.92 + (i / audioFrames) * 0.05);
  }

  onStage('Writing the file', 0.97);
  check();
  await vEnc.flush();
  await aEnc.flush();
  check();

  return mux.finish();
  }
}
