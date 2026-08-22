// The ridgeline: stacked lines, each one hiding what is behind it.
//
// See `docs/RIDGELINE.md`. A second visualiser, chosen instead of the room
// rather than layered with it, and drawn on a 2D canvas rather than in WebGL —
// because hidden-line removal *is* the design and the painter's algorithm gives
// it away free, because `gl.lineWidth` is clamped to 1 by almost every driver
// and this design is hairlines, and because a third WebGL context is a real
// risk on a machine that already opens a second one to film with.
//
// **One generator, four sources of rows.** A row is three hundred numbers; where
// they come from is a setting:
//
//   pulsar     — Craft's measured CP 1919 pulses, the real eighty
//   synth      — generated from the statistics measured off those eighty
//   driven     — the same generator, with its four parameters from the sound
//   waveform   — the audio itself, windowed so the energy lands centrally
//
// The last two are the point; the first two are how we know the last two look
// right.
//
// **Every name in here starts `rdg`, not `rg`.** `room-paint.js` already owns
// the `rg` prefix for the room's *geometry* panel, and a second top-level
// `const RG_DEFAULTS` is a duplicate declaration that kills the whole script
// on load — silently, with nothing in the console, and every symbol in the
// file simply absent. Two files, one prefix, no error message.

/// How a row's numbers are found.
const RDG_SOURCES = [
  { key: 'pulsar', label: 'Pulsar',
    hint: 'The real thing: eighty measured pulses from CP 1919, looping. No sound reaches it — this is the benchmark the rest are judged against.' },
  { key: 'synth', label: 'Synth',
    hint: 'Generated from the statistics of those eighty, so it runs forever without repeating. Still no sound.' },
  { key: 'driven', label: 'Driven',
    hint: 'The same generator with its four numbers taken from the sound: level, centroid, spread and flatness. Looks like the plot, moves with the music.' },
  { key: 'wave', label: 'Waveform',
    hint: 'The audio itself. Each line is the waveform of that instant, rectified and pulled to the middle by WINDOW, so it keeps the look and is the sound.' },
];

/// The room's own defaults, and the sleeve's proportions.
const RDG_DEFAULTS = {
  source: 'wave',
  rows: 80,
  points: 300,
  /// How far a peak reaches, in row-gaps. The sleeve's tallest spans about ten,
  /// which is what makes the stack tangle instead of reading as a bar chart.
  over: 10,
  /// The share of the frame the lines run across, leaving the flat tails. The
  /// data's own ends are already quiet, so this is only the margin.
  span: 0.86,
  /// A fraction of the frame's height, not a pixel count. A 1px line is right at
  /// 1080 and invisible at 4K, and this is filmed at both.
  weight: 0.0013,
  /// **The whole design.** Off, every line shows through every other one and the
  /// picture is a hairball. It is a switch so that can be seen rather than
  /// argued about.
  fill: true,
  /// How hard the energy is pulled to the middle in `wave`. One is the sleeve;
  /// nought is an honest oscilloscope running edge to edge.
  window: 0.72,
  /// Across the samples of a row, on arrival. Raw audio is spiky; the pulses are
  /// jagged but coherent.
  smooth: 2,
  /// How hard the sound drives the height.
  gain: 1,
  /// **Silence, as an amplitude.** Anything under this is drawn flat, and the
  /// auto-gain in `push` is not allowed to reach below it. Roughly −48dB, which
  /// is under the noise of a recording and well under anything meant to be
  /// heard. At nought there is no floor at all.
  floor: 0.004,
};

/// The room's `push` arrives at this rate, so this many rows a second.
const RDG_PUSH_HZ = 20;

// ───────────────────────────────────────────────────────────── the generator ──

/// A deterministic number from a counter. Rows are fixed when they are born and
/// never revisited, the same discipline the grain cloud follows for its shape
/// and seed — so the picture on screen and the picture in the film are the same
/// picture rather than two evaluations that drift apart.
function rdgRand(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/// Two independent normals from two uniforms, so heights and positions spread
/// the way the measured ones do rather than sitting flat across a range.
function rdgNormal(seed) {
  const u = Math.max(1e-6, rdgRand(seed));
  const v = rdgRand(seed + 1013);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/// The backbone, read at an arbitrary place with the ends running flat.
function rdgProfileAt(t) {
  if (t <= 0 || t >= 1) return 0;
  const x = t * (RIDGE_PROFILE.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RIDGE_PROFILE[i];
  const b = RIDGE_PROFILE[Math.min(RIDGE_PROFILE.length - 1, i + 1)];
  return a + (b - a) * f;
}

/// One synthesised row: the backbone rescaled and nudged.
///
/// `height`, `pos`, `width` and `rough` are the four numbers. In `synth` they
/// are drawn from the measured spreads; in `driven` they come from the sound.
/// **The generator does not know which**, which is what keeps the two paths one
/// piece of code.
function rdgSynthRow(n, seed, height, pos, width, rough) {
  const out = new Float32Array(n);
  const w = Math.max(0.04, width);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    // Where this sample falls on the backbone, once it has been moved and
    // stretched. Outside it, flat.
    const t = 0.5 + (x - pos) / (w * 2);
    let v = rdgProfileAt(t) * height;
    // The fine jaggedness riding on the hump. Without it the row is a bell
    // curve and reads as a diagram rather than a measurement.
    v += (rdgRand(seed * 7919 + i) - 0.5) * rough;
    out[i] = v;
  }
  return out;
}

/// A row drawn from the measured statistics.
function rdgSynthFromStats(n, seed) {
  const s = RIDGE_STATS;
  const h = Math.max(s.heightMin * 0.6,
    Math.min(s.heightMax, s.heightMean + rdgNormal(seed) * s.heightSd));
  const p = s.posMean + rdgNormal(seed + 77) * s.posSd;
  const w = Math.max(0.05, s.widthMean + rdgNormal(seed + 131) * s.widthSd);
  return rdgSynthRow(n, seed, h, p, w, s.baselineSd * 3);
}

// ───────────────────────────────────────────────────── what the sound says ──

/// The four numbers, read off one spectrum.
///
/// `bands` is in decibels and already geometric — `meter::spectrum` spaces its
/// edges by a constant ratio — so an index is a log frequency and the centroid
/// computed over indices is a *musical* centre rather than an arithmetic one
/// dragged upward by the top octave.
function rdgListen(bands) {
  const n = bands.length;
  if (!n) return { level: 0, pos: 0.42, width: 0.17, flat: 0.5 };
  let sum = 0, wsum = 0, peak = 0;
  const lin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Decibels to something that can be weighted. The floor is −96 in the
    // analyser; below about −72 is silence as far as a picture is concerned.
    const v = Math.max(0, (bands[i] + 72) / 72);
    lin[i] = v;
    sum += v;
    wsum += v * i;
    if (v > peak) peak = v;
  }
  if (sum <= 1e-6) return { level: 0, pos: 0.42, width: 0.17, flat: 0.5 };
  const centroid = wsum / sum / (n - 1);
  // Spread about the centroid, as a share of the whole width.
  let sp = 0;
  for (let i = 0; i < n; i++) {
    const d = i / (n - 1) - centroid;
    sp += lin[i] * d * d;
  }
  sp = Math.sqrt(sp / sum);
  // Flat spectra are noise, peaky ones are tones. Geometric over arithmetic
  // mean, the usual measure, on the linearised weights.
  let logSum = 0;
  for (let i = 0; i < n; i++) logSum += Math.log(lin[i] + 1e-4);
  const flat = Math.exp(logSum / n) / (sum / n + 1e-9);
  return {
    level: Math.min(1, peak),
    pos: Math.max(0.12, Math.min(0.88, centroid)),
    width: Math.max(0.05, Math.min(0.5, sp * 1.6)),
    flat: Math.max(0, Math.min(1, flat)),
  };
}

/// The waveform of this instant, as a row.
///
/// **Rectified, then windowed.** A raw bipolar trace stacked eighty deep is an
/// oscilloscope and not this picture; the absolute value is unipolar like a
/// pulse, and the window pulls the energy into the middle and lets the tails run
/// flat. That is the one shaping step, and `window` at nought turns it off.
///
/// Silence gives a flat line with no special case, because the absolute value of
/// nothing is nothing.
function rdgWaveRow(n, pairs, windowAmt, smooth) {
  const out = new Float32Array(n);
  if (!pairs || pairs.length < 4) return out;
  const m = pairs.length / 2;
  for (let i = 0; i < n; i++) {
    // The loudest sample in this slice rather than the mean: an envelope that
    // averages a transient away is not an envelope.
    const a = Math.floor((i / n) * m);
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * m));
    let peak = 0;
    for (let k = a; k < b && k < m; k++) {
      const l = pairs[k * 2], r = pairs[k * 2 + 1];
      const v = Math.abs(l + r) * 0.5;
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  // A raised cosine, mixed in by `windowAmt`. At one the ends are pinned to
  // nothing and the middle is untouched.
  if (windowAmt > 0) {
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
      out[i] *= 1 - windowAmt + windowAmt * w;
    }
  }
  if (smooth > 0) rdgSmooth(out, smooth);
  return out;
}

/// A short box blur across the samples, run `passes` times. Cheap, and three
/// passes of a box is close enough to a gaussian for this.
function rdgSmooth(a, passes) {
  const n = a.length;
  const t = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const l = a[i > 0 ? i - 1 : 0];
      const r = a[i < n - 1 ? i + 1 : n - 1];
      t[i] = (l + a[i] * 2 + r) * 0.25;
    }
    a.set(t);
  }
}

// ──────────────────────────────────────────────────────────────── the module ──

/// Attach a ridgeline to a canvas. Null if it will not give a 2D context, which
/// is a fallback and not an error — the same contract `vgAttach` follows.
function rdgAttach(canvas) {
  let ctx;
  try { ctx = canvas.getContext('2d'); } catch { return null; }
  if (!ctx) return null;

  /// Newest last. A row is pushed, fixed, and never touched again.
  const rows = [];
  let born = 0;
  /// A slowly falling ceiling, so a quiet passage stays quiet instead of being
  /// auto-gained up into a wall. Per-row normalisation would do that and would
  /// also flatten the one giant pulse that makes the picture recognisable.
  let ceiling = 0.0001;

  const cfg = { ...RDG_DEFAULTS };

  // ── sliding, rather than stepping ──
  //
  // Rows arrive twenty times a second and the stack is eighty deep, so snapping
  // each row to its slot moves the whole picture a full row-gap every fifty
  // milliseconds. That is a visible stair, and it was: *"it seems to step up the
  // page."*
  //
  // So the stack is offset by however far through the gap between pushes we are,
  // and one row beyond the top is kept and drawn so nothing appears out of
  // nowhere at the edge as it slides.
  //
  // **The clock is the caller's when it offers one.** The film has no wall clock
  // worth having — it renders as fast as it can — so it passes `clock`, exactly
  // as the room does, and the slide is then a function of the film's own time
  // rather than of how long a frame took to encode.
  let clockNow = 0;
  let lastPushAt = 0;
  let everPushed = false;

  return {
    /// Take the settings, without drawing.
    ///
    /// **`push` needs them and `frame` is too late.** A row is made and fixed at
    /// push, so the settings have to be in hand by then — and the export pushes
    /// a whole run of rows before it draws anything, which would have made every
    /// one of them with whatever the defaults were. On screen the mistake hides,
    /// because frames run three times as often as pushes and it corrects itself
    /// within one; in the film it does not run at all.
    configure(s) {
      if (!s) return;
      for (const k of Object.keys(RDG_DEFAULTS)) if (s[k] !== undefined) cfg[k] = s[k];
    },

    /// Empty it. Not a reset: the settings belong to the caller.
    ///
    /// **Emptied to a full stack of flat lines, not to nothing.** At rest this
    /// picture is eighty flat lines — that is what the top and bottom of the
    /// sleeve are, and it is what "no sound playing, all the waveforms flat"
    /// means. Starting from nothing and growing at twenty rows a second gives
    /// four seconds of an empty frame with a few lines creeping up it, which
    /// reads as broken rather than as quiet.
    ///
    /// New rows still arrive at the bottom and push these off the top, so the
    /// motion is unchanged; there is simply always a stack for them to push.
    clear() {
      rows.length = 0;
      born = 0;
      ceiling = 0.0001;
      const n = Math.max(8, Math.min(2048, cfg.points | 0));
      const want = Math.max(2, Math.min(400, cfg.rows | 0));
      for (let i = 0; i <= want; i++) rows.push({ v: new Float32Array(n), level: 0 });
    },

    /// What is actually held, for the tests. Some of this cannot be recovered
    /// from the picture — the same reason `visGl.trail()` exists.
    stack: () => ({ rows: rows.length, points: rows.length ? rows[0].v.length : 0,
      born, ceiling, source: cfg.source }),

    /// One analysis frame: a spectrum and the raw waveform behind it.
    ///
    /// **This is where a row is made and fixed.** Everything random or measured
    /// about it is resolved here, so the same pushes always give the same
    /// picture — which is what lets the film and the screen agree.
    push(bands, pairs) {
      const n = Math.max(8, Math.min(2048, cfg.points | 0));
      let v;
      const heard = rdgListen(bands || []);

      if (cfg.source === 'pulsar') {
        // The real eighty, looping. Resampled if the row width has been changed.
        const src = RIDGE_DATA[born % RIDGE_DATA.length];
        v = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * (src.length - 1);
          const a = Math.floor(x), f = x - a;
          v[i] = src[a] + ((src[Math.min(src.length - 1, a + 1)] - src[a]) * f);
        }
      } else if (cfg.source === 'synth') {
        v = rdgSynthFromStats(n, born * 2654435761 % 2147483647);
      } else if (cfg.source === 'driven') {
        const s = RIDGE_STATS;
        // The four numbers, from the sound rather than from the spreads.
        // Gated on the same floor as the waveform — see there. `heard.level` is
        // already a share of the analyser's range rather than an amplitude, so
        // the floor is read against it directly.
        const gate = cfg.floor > 0
          ? Math.max(0, Math.min(1, (heard.level - cfg.floor) / cfg.floor))
          : 1;
        const h = s.heightMean * (0.25 + heard.level * 2.2 * cfg.gain) * gate;
        v = rdgSynthRow(n, born * 2654435761 % 2147483647,
          h, heard.pos, heard.width, s.baselineSd * (1 + heard.flat * 6));
      } else {
        v = rdgWaveRow(n, pairs, cfg.window, cfg.smooth);
        let peak = 0;
        for (let i = 0; i < n; i++) if (v[i] > peak) peak = v[i];

        // **Below the floor is silence, and silence is flat.**
        //
        // The scale below is an auto-gain: the ceiling decays at 0.995 a push,
        // which at twenty a second halves it in seven seconds. Through a quiet
        // passage it keeps falling, the gain keeps climbing, and what is left to
        // normalise is the noise under the recording — so a stretch with nothing
        // audible in it is drawn at full height, hunting and alive. It is the
        // one part of this that lies about the sound.
        //
        // The floor stops it twice over: nothing quieter than this is drawn at
        // all, and the ceiling is not allowed to chase down past it, so there is
        // no gain left to run away with.
        const floor = Math.max(0, cfg.floor || 0);
        // Fading in over the octave above the floor rather than switching on at
        // it, because a gate that opens in one push clacks.
        const gate = floor <= 0
          ? 1
          : Math.max(0, Math.min(1, (peak - floor) / floor));

        ceiling = Math.max(peak, ceiling * 0.995, floor);
        const k = (RIDGE_STATS.heightMean * 1.6 * cfg.gain) / Math.max(1e-4, ceiling);
        for (let i = 0; i < n; i++) v[i] *= k * gate;
      }

      if (cfg.source !== 'wave' && cfg.smooth > 0) rdgSmooth(v, cfg.smooth);
      rows.push({ v, level: heard.level });
      born++;
      lastPushAt = clockNow;
      everPushed = true;
      // One more than is drawn: the spare is what slides in at the top.
      const want = Math.max(2, Math.min(400, cfg.rows | 0)) + 1;
      while (rows.length > want) rows.shift();
      // Asking for more rows fills the new ones flat rather than leaving the
      // stack short until enough sound has arrived to grow it.
      while (rows.length < want) rows.unshift({ v: new Float32Array(v.length), level: 0 });
    },

    /// Draw one picture.
    frame(f) {
      if (f && f.ridge) this.configure(f.ridge);
      // **`f.clock` is in seconds**, which is the room's convention and
      // therefore the export's — `vis-gl.js` does `f.clock * 1000` for the same
      // reason. Reading it as milliseconds makes the slide finish in the first
      // twentieth of a frame and the stack step exactly as it did before.
      clockNow = (f && typeof f.clock === 'number')
        ? f.clock * 1000
        : performance.now();
      if (!everPushed) lastPushAt = clockNow;
      const W = canvas.width, H = canvas.height;
      if (!W || !H) return;

      const paint = (f && f.ridgePaint) || {};
      const line = paint.line || '#ffffff';
      const under = paint.fill || paint.background || '#000000';
      const ground = paint.background || '#000000';

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, W, H);
      if (!rows.length) return;
      // **Clipped to its own box.** The spare row sits above the top and slides
      // down into view, so without this it is drawn outside the picture — which
      // on a canvas is harmless and on the eye is a line appearing from nothing
      // above the stack.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();

      const want = Math.max(2, Math.min(400, cfg.rows | 0));
      const pad = H * 0.045;
      const top = pad, bot = H - pad;
      const gap = (bot - top) / (want - 1);
      // Globally, against the pulses' own range — so a quiet row is short and a
      // loud one is tall, which is the whole character of the picture.
      const amp = (gap * cfg.over) / (RIDGE_MAX - RIDGE_MIN);
      const spanW = W * cfg.span;
      const x0 = (W - spanW) / 2;
      const xAt = (i, n) => x0 + spanW * (i / (n - 1));

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // **Never thinner than one device pixel.**
      //
      // Below that the canvas cannot make the line narrower, so it makes it
      // *fainter* instead — a half-pixel stroke is drawn as a full pixel at half
      // opacity. WEIGHT then reads as a brightness control rather than a
      // thickness one, and because the stack slides through sub-pixel positions
      // the same line lands differently every frame and shimmers.
      //
      // Floored, the thinnest setting is a crisp hairline and the slider's lower
      // reach is honest about doing nothing further.
      ctx.lineWidth = Math.max(1, H * cfg.weight);
      ctx.strokeStyle = line;
      ctx.fillStyle = under;

      // ── back to front ──
      //
      // The oldest row is at the top and furthest away; each newer one is drawn
      // over it, and the fill under each line is what hides what is behind. That
      // is the whole of the depth in this picture, and with the fill off it is a
      // hairball rather than a stack.
      //
      // New rows arrive at the bottom, so a row's age decides how far up it has
      // travelled — and a stack that is not yet full grows from the bottom
      // rather than starting full of nothing.
      // How far through the gap between pushes we are. Clamped, because a
      // stalled feed must park the stack rather than let it slide away.
      const step = 1000 / RDG_PUSH_HZ;
      const slide = Math.max(0, Math.min(1, (clockNow - lastPushAt) / step));

      // Short of a full stack only while the row count has just been raised —
      // `clear` fills it, so ordinarily this is nought.
      const first = Math.max(0, want - rows.length);
      for (let r = 0; r < rows.length; r++) {
        const v = rows[r].v;
        const n = v.length;
        // **The spare sits one gap above the top, and the stack rises.**
        //
        // `rows[0]` is the spare. At rest it is a whole gap above `top`, so it
        // is clipped away and exactly the asked-for number of lines is on
        // screen; `rows[1]` is the top visible line and `rows[want]` is the
        // bottom one. As the slide runs to one the whole stack lifts by a gap,
        // and the push that follows shifts the array by one — so the two
        // motions join with nothing jumping.
        //
        // Subtracting the slide is what makes it rise. Adding it drops the
        // stack instead, which looks like the picture falling into the frame.
        const base = top + gap * (first + r - 1 - slide);

        // ── the line, edge to edge ──
        //
        // **SPAN narrows the signal, not the line.** The signal occupies the
        // middle and the row runs flat from the frame's left edge to meet it and
        // flat again to the right edge — so every line is one unbroken stroke
        // across the picture however narrow the signal is.
        //
        // Narrowing the stroke itself was the first version, and it left eighty
        // lines stopping in mid-air with a band of nothing either side: *"there
        // is nothing to connect to the wall so it looks strange."*
        //
        // The tails carry the row's own end values rather than a nominal zero,
        // so they meet the signal with no step at the join.
        const yL = base - (v[0] - RIDGE_MIN) * amp;
        const yR = base - (v[n - 1] - RIDGE_MIN) * amp;
        const walk = () => {
          ctx.moveTo(0, yL);
          ctx.lineTo(xAt(0, n), yL);
          for (let i = 1; i < n; i++) {
            ctx.lineTo(xAt(i, n), base - (v[i] - RIDGE_MIN) * amp);
          }
          ctx.lineTo(W, yR);
        };

        ctx.beginPath();
        walk();
        if (cfg.fill) {
          ctx.lineTo(W, base + gap);
          ctx.lineTo(0, base + gap);
          ctx.closePath();
          ctx.fill();
          // Re-walk for the stroke: the closing edge along the bottom is
          // structural and must not be drawn, or every row carries a bar under
          // it and the picture is a grid.
          ctx.beginPath();
          walk();
        }
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// ────────────────────────────────────────────────────────────── the controls ──
//
// Built once and then only updated. Rebuilding a panel under a slider being
// dragged drops the drag, which is the fault the palette's colour wells and the
// theme editor's swatches both had before them.

const RDG_ROWS_UI = [
  { key: 'rows', tag: 'ROWS', min: 8, max: 200, step: 1, round: true,
    hint: 'How many lines are stacked. Eighty is the sleeve.' },
  { key: 'points', tag: 'POINTS', min: 32, max: 1024, step: 1, round: true,
    hint: 'How finely each line is drawn across. Three hundred is what the pulses were sampled at.' },
  { key: 'over', tag: 'HEIGHT', min: 1, max: 30, step: 0.1,
    hint: 'How many row-gaps the tallest peak reaches. Under about four the stack reads as a bar chart; ten is the sleeve, where peaks tangle several rows deep.' },
  { key: 'span', tag: 'SPAN', min: 0.3, max: 1, step: 0.01,
    hint: 'How much of the width the lines run across, leaving the flat tails either side.' },
  { key: 'weight', tag: 'WEIGHT', min: 0.0008, max: 0.006, step: 0.0001,
    hint: 'How thick the line is, as a fraction of the frame height — so it looks the same filmed at 1080 and at 4K rather than vanishing at the larger one. It will not go below one pixel: under that a canvas cannot draw a thinner line, only a fainter one, which reads as brightness and shimmers as the stack slides.' },
  { key: 'window', tag: 'WINDOW', min: 0, max: 1, step: 0.01,
    hint: 'How hard the sound is pulled to the middle. One is the sleeve: flat tails, everything in the centre. Nought is an honest oscilloscope running edge to edge. Waveform source only.' },
  { key: 'floor', tag: 'SILENCE', min: 0, max: 0.05, step: 0.001,
    hint: 'Anything quieter than this is drawn flat, and the auto-gain will not reach below it. Without one a quiet passage is normalised until the noise under the recording fills the frame — the picture busy over dead air. At nought there is no floor and the gain runs as far as it likes.' },
  { key: 'smooth', tag: 'SMOOTH', min: 0, max: 8, step: 1, round: true,
    hint: 'Softening across each line. Raw audio is spiky; the pulses are jagged but coherent.' },
  { key: 'gain', tag: 'GAIN', min: 0.1, max: 6, step: 0.05,
    hint: 'How hard the sound drives the height.' },
];

function rdgFmt(row, v) {
  if (row.round) return String(Math.round(v));
  if (row.step < 0.001) return v.toFixed(4);
  return v.toFixed(2);
}

function buildRidgePanel() {
  const host = document.getElementById('ridgeEdit');
  if (!host || host.children.length) return;
  const set = (k, v) => {
    roomEdit.ridge = { ...(roomEdit.ridge || {}), [k]: v };
    saveRoomData();
  };

  // ── the source: the four phases, as a setting rather than four builds ──
  const srcRow = rpEl('div', 're-row');
  srcRow.appendChild(rpEl('span', 're-tag', 'SOURCE'));
  const srcBox = rpEl('div', 're-frames');
  srcBox.id = 'rgSources';
  for (const src of RDG_SOURCES) {
    const b = rpEl('button', 're-btn', src.label);
    b.dataset.rgSource = src.key;
    b.title = src.hint;
    b.onclick = () => { set('source', src.key); paintRidgePanel(); };
    srcBox.appendChild(b);
  }
  srcRow.appendChild(srcBox);
  host.appendChild(srcRow);

  for (const row of RDG_ROWS_UI) {
    const box = rpEl('div', 're-row');
    const tag = rpEl('span', 're-tag', row.tag);
    tag.title = row.hint;
    box.appendChild(tag);
    const sl = rpEl('input', 're-slider');
    sl.type = 'range';
    const k = row.round ? 1 : 10000;
    sl.min = String(Math.round(row.min * k));
    sl.max = String(Math.round(row.max * k));
    sl.step = String(Math.max(1, Math.round(row.step * k)));
    sl.dataset.rgKey = row.key;
    sl.title = row.hint;
    const read = rpEl('span', 'rg-read', '');
    read.dataset.rgRead = row.key;
    sl.oninput = () => {
      const v = +sl.value / k;
      set(row.key, v);
      read.textContent = rdgFmt(row, v);
    };
    box.appendChild(sl);
    box.appendChild(read);
    host.appendChild(box);
  }

  // ── the fill, which is the whole design ──
  const fillRow = rpEl('div', 're-row');
  fillRow.appendChild(rpEl('span', 're-tag', 'FILL'));
  const fill = rpEl('button', 're-btn', 'on');
  fill.id = 'rgFill';
  fill.title = 'The fill under each line, which is what hides the lines behind '
    + 'it. Off, every line shows through every other one and the picture is a '
    + 'hairball — worth seeing once, because it is the fill and nothing else '
    + 'that makes this read as depth.';
  fill.onclick = () => {
    set('fill', !(ridgeSettings().fill));
    paintRidgePanel();
  };
  fillRow.appendChild(fill);
  host.appendChild(fillRow);

  const foot = rpEl('div', 're-foot');
  const reset = rpEl('button', 're-btn', 'Reset');
  reset.title = 'Back to the sleeve’s own proportions.';
  reset.onclick = () => { roomEdit.ridge = {}; saveRoomData(); paintRidgePanel(); };
  foot.appendChild(reset);
  const clear = rpEl('button', 're-btn', 'Clear');
  clear.title = 'Empty the stack. It fills again from the bottom.';
  clear.onclick = () => { const r = visLive.ridge; if (r) r.clear(); };
  foot.appendChild(clear);
  host.appendChild(foot);
}

/// Written into, never rebuilt — and never into the control being used.
function paintRidgePanel() {
  const host = document.getElementById('ridgeEdit');
  if (!host || !host.children.length) return;
  const cfg = ridgeSettings();
  for (const b of host.querySelectorAll('[data-rg-source]')) {
    b.classList.toggle('active', b.dataset.rgSource === cfg.source);
  }
  for (const row of RDG_ROWS_UI) {
    const sl = host.querySelector(`[data-rg-key="${row.key}"]`);
    const read = host.querySelector(`[data-rg-read="${row.key}"]`);
    if (!sl) continue;
    const k = row.round ? 1 : 10000;
    if (document.activeElement !== sl) sl.value = String(Math.round(cfg[row.key] * k));
    if (read) read.textContent = rdgFmt(row, cfg[row.key]);
    // WINDOW only means anything to the waveform source; the others have no
    // waveform to pull anywhere.
    if (row.key === 'window') sl.closest('.re-row').classList.toggle('dim-block', cfg.source !== 'wave');
    if (row.key === 'gain') sl.closest('.re-row').classList.toggle('dim-block',
      cfg.source === 'pulsar' || cfg.source === 'synth');
  }
  const fill = document.getElementById('rgFill');
  if (fill) {
    fill.classList.toggle('active', !!cfg.fill);
    fill.textContent = cfg.fill ? 'on' : 'off';
  }
}

/// The module picker, beside the frame selector.
function paintVisModulePicker() {
  const box = document.getElementById('rgModules');
  if (!box) return;
  for (const b of box.querySelectorAll('[data-vis-module]')) {
    b.classList.toggle('active', b.dataset.visModule === visModuleKey());
  }
}

function buildVisModulePicker() {
  const box = document.getElementById('rgModules');
  if (!box || box.children.length) return;
  for (const m of VIS_MODULES) {
    const b = rpEl('button', 're-btn', m.label);
    b.dataset.visModule = m.key;
    b.title = m.hint;
    b.onclick = () => setVisModule(m.key);
    box.appendChild(b);
  }
  paintVisModulePicker();
}
