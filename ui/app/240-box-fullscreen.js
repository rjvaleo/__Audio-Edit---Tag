// ─────────────────────────────────────────────────── the box, filling the screen
//
// The panel goes fullscreen, not the canvas.
//
// A fullscreen element is positioned as though it were fixed, and an element
// with `position: fixed` has no `offsetParent` — which is precisely what
// `visGlTick` tests to decide whether anybody is looking at the scene. Take the
// canvas fullscreen and the renderer concludes it is hidden and stops drawing,
// at the exact moment it fills the screen. Taking `#masterBus` instead leaves
// the canvas an ordinary absolute child of a positioned cell, and brings the
// meters along with it, which is what you want at that size anyway: the room
// gets the whole screen bar a narrow column and the numbers stay readable.
//
// Nothing needs resizing by hand. `visGlTick` already reconciles the canvas's
// backing store with its client size on every frame, so the box refills the
// screen on the first frame after the change and again on the way out.
function masterIsFullscreen() {
  return !!document.fullscreenElement && document.fullscreenElement === $('masterBus');
}

async function toggleMasterFullscreen() {
  const el = $('masterBus');
  if (!el) return;
  try {
    if (masterIsFullscreen()) await document.exitFullscreen();
    else if (document.fullscreenElement) {
      // Something else is already filling the screen. Hand it over rather than
      // failing: a request while another element holds it is rejected.
      await document.exitFullscreen();
      await el.requestFullscreen();
    } else await el.requestFullscreen();
  } catch (e) {
    // Refused — an embedded view without the permission, or a gesture the
    // browser will not accept. A toast rather than the box's own corner: that
    // corner is `#mbPeakHz`, which the meter tick rewrites on every update, so
    // a message left there is gone before it can be read.
    toast(`full screen refused — ${e.name}`);
  }
}

// Double-click the room itself. Not the meter column beside it, which is a
// column of numbers and has nothing to gain from the whole screen.
$('masterBus')?.querySelector('.mb-cell-3d')?.addEventListener('dblclick', toggleMasterFullscreen);

async function loadSpectrogram() {
  const f = state.selectedFile;
  if (!f || !state.showSpec) return;
  // Scaled up for the wider following window, but not the whole way. Every
  // column is an FFT on the server and a column of pixels the browser fills one
  // at a time, and following refetches often enough that the full count lands
  // as a hitch. A slightly coarser strip while playing is the better trade —
  // stop, and the next fetch is at full detail again.
  const lane = Math.max(200, Math.min(1200, Math.floor($('lane').clientWidth) || 800));
  const win = peakWindow();
  const span = state.view.to - state.view.from;
  const cols = win && span > 0
    ? Math.min(1600, Math.round(lane * Math.sqrt((win.to - win.from) / span)))
    : lane;
  let url = `/api/spectrogram?p=${encodeURIComponent(f.path)}&cols=${cols}&fft=${state.fftSize}`;
  if (win) {
    url += `&from=${Math.floor(win.from)}&to=${Math.ceil(win.to)}`;
  }
  try { state.spec = await api(url); }
  catch (e) { toast(e.message); return; }
  layoutWaveBuffer();
  drawSpectrogram();
}

function drawSpectrogram() {
  const s = state.spec;
  const canvas = $('specCanvas');
  if (!s || !state.showSpec) return;

  const cols = s.columns;
  const bins = s.bins;
  canvas.width = cols;
  canvas.height = bins;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, bins);
  const out = img.data;

  // A typed array and a lookup table, rather than charCodeAt through a closure
  // and a freshly allocated triple for every pixel. This is close to a million
  // pixels and following the playhead redraws it while the sound is playing, so
  // what happens here is the difference between a scroll and a stutter.
  const raw = atob(s.data);
  const lvl = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) lvl[i] = raw.charCodeAt(i);
  const lut = specRamp();

  const rows = logRows(bins, s.maxHz || 22050);
  const grid = logGrid(lvl, cols, bins, rows);

  for (let c = 0; c < cols; c++) {
    const here = c * bins;
    const left = c > 0 ? here - bins : -1;
    const right = c < cols - 1 ? here + bins : -1;
    for (let b = 0; b < bins; b++) {
      // Relief. Treating the level as a height field and lighting it from the
      // upper left turns a flat wash into something with surfaces: a rising
      // partial catches the light on its leading edge and shades on its
      // trailing one, so a sweep reads as a ridge rather than a smear. The
      // gradient is the plain central difference — cheap, and enough. Off the
      // edge of the picture reads as silence.
      const dx = ((right < 0 ? 0 : grid[right + b]) - (left < 0 ? 0 : grid[left + b])) / 255;
      const dy = ((b < bins - 1 ? grid[here + b + 1] : 0)
                - (b > 0 ? grid[here + b - 1] : 0)) / 255;
      const shade = 1 + (dx - dy) * 1.15 * SPEC_RELIEF;

      // Low frequencies at the bottom, which means flipping the row order.
      const i = ((bins - 1 - b) * cols + c) * 4;
      const k = grid[here + b] * 3;
      const r = lut[k] * shade;
      const g = lut[k + 1] * shade;
      const bl = lut[k + 2] * shade;
      out[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
      out[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      out[i + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
      out[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/// The lowest frequency the picture bothers with.
///
/// Below this is rumble and DC, and stretching an octave nobody is listening to
/// across a third of the height would waste the room the change is meant to buy.
const SPEC_FLOOR_HZ = 30;

/// Which analysis bins each display row covers, on a log frequency axis.
///
/// **The axis was linear, and that was the bug.** An FFT's bins are evenly
/// spaced in hertz, so on a 44.1 kHz file 513 bins reach 22 kHz and everything
/// musical is crushed into the bottom of the picture. Measured on a real file:
/// half the energy sat below bin 4 — 172 Hz — ninety per cent below bin 10, and
/// **nine of the ten deciles of height were exactly zero.** The spectrogram was
/// drawing correctly and had nothing to show in 97% of its rows, which is why
/// making the strip taller made it look more broken rather than less.
///
/// Hearing is roughly logarithmic, so the rows are too: each one covers a fixed
/// musical interval rather than a fixed number of hertz, and an octave at the
/// bottom gets the same room as an octave at the top.
///
/// Cached on the two numbers it depends on, because it is the same table for
/// every column of every redraw and this runs while the sound is playing.
let logRowCache = null;
function logRows(bins, maxHz) {
  if (logRowCache && logRowCache.bins === bins && logRowCache.maxHz === maxHz) {
    return logRowCache.rows;
  }
  const lo = new Int32Array(bins);
  const hi = new Int32Array(bins);
  const fmin = Math.min(SPEC_FLOOR_HZ, maxHz / 2);
  const span = Math.log(maxHz / fmin);
  for (let r = 0; r < bins; r++) {
    // r counts up from the bottom of the picture, which is the low end.
    const f0 = fmin * Math.exp(span * (r / bins));
    const f1 = fmin * Math.exp(span * ((r + 1) / bins));
    let a = Math.floor((f0 / maxHz) * (bins - 1));
    let b = Math.ceil((f1 / maxHz) * (bins - 1));
    a = Math.max(0, Math.min(bins - 1, a));
    b = Math.max(a, Math.min(bins - 1, b));
    lo[r] = a;
    hi[r] = b;
  }
  const rows = { lo, hi };
  logRowCache = { bins, maxHz, rows };
  return rows;
}

/// The levels, remapped onto those rows.
///
/// The **loudest** bin in a row's span rather than the average: near the top one
/// row covers dozens of bins, and averaging a partial with the silence either
/// side of it is how a harmonic disappears from the picture at exactly the
/// frequencies the log axis was meant to reveal.
function logGrid(lvl, cols, bins, rows) {
  const { lo, hi } = rows;
  const grid = new Uint8Array(cols * bins);
  for (let c = 0; c < cols; c++) {
    const here = c * bins;
    for (let r = 0; r < bins; r++) {
      let m = 0;
      const end = hi[r];
      for (let b = lo[r]; b <= end; b++) {
        const v = lvl[here + b];
        if (v > m) m = v;
      }
      grid[here + r] = m;
    }
  }
  return grid;
}

/// The colour ramp as its 256 stops, so a pixel costs three array reads. The
/// levels arrive as bytes, so this loses nothing.
let specRampCache = null;
function specRamp() {
  if (specRampCache) return specRampCache;
  specRampCache = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = specColour(i / 255);
    specRampCache[i * 3] = r;
    specRampCache[i * 3 + 1] = g;
    specRampCache[i * 3 + 2] = b;
  }
  return specRampCache;
}

/// How hard the light rakes across the spectrogram.
const SPEC_RELIEF = 2.6;

/// Level to colour, across the whole spectrum rather than one hue of it.
///
/// A single-hue ramp spends its entire range on brightness, and the eye is poor
/// at ranking brightness — two partials twelve decibels apart look like the same
/// blue, slightly dimmer. Running through hue as well as value gives every step
/// its own name: near-black, indigo, magenta, orange, and white at the top. The
/// stops are spaced so the perceived change is roughly even, which a plain
/// rainbow is not — it bunches in the greens and lies about where the energy is.
const SPEC_STOPS = [
  [0.00, [4, 5, 14]],
  [0.16, [28, 16, 68]],
  [0.34, [88, 24, 118]],
  [0.52, [156, 38, 106]],
  [0.68, [214, 76, 66]],
  [0.83, [244, 148, 38]],
  [0.94, [252, 210, 96]],
  [1.00, [255, 250, 226]],
];

function specColour(v) {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  for (let i = 1; i < SPEC_STOPS.length; i++) {
    const [p1, c1] = SPEC_STOPS[i - 1];
    const [p2, c2] = SPEC_STOPS[i];
    if (t <= p2) {
      const k = p2 === p1 ? 0 : (t - p1) / (p2 - p1);
      return [
        (c1[0] + (c2[0] - c1[0]) * k) | 0,
        (c1[1] + (c2[1] - c1[1]) * k) | 0,
        (c1[2] + (c2[2] - c1[2]) * k) | 0,
      ];
    }
  }
  return SPEC_STOPS[SPEC_STOPS.length - 1][1];
}

