// ─────────────────────────────────────────────────────────── the master bus ──
//
// Three panels reading one tap. The audio callback copies L and R into a ring
// and does nothing else with them; the transform, the correlation and the
// 300 ms integration all happen on the server, and this draws the answers.
// See `docs/MASTER-BUS.md`.

/// The data arrives at this rate, so there is nothing to be gained by drawing
/// faster. A sixty-hertz loop over a twenty-hertz feed redraws the same numbers
/// three times and costs three times as much to do it.
const MB_POLL_MS = 50;
/// The bottom of the meter scale, in dBFS.
const MB_METER_FLOOR = -60;
/// The bottom of the spectrum.
const MB_SPEC_FLOOR = -96;
/// How long a peak stays where it landed, and how fast it falls after that.
const MB_HOLD_MS = 1400;
const MB_HOLD_FALL_DB = 18;
/// How much of the goniometer trace is drawn bright. The newest samples read as
/// the live edge; the rest is the short tail that makes the shape legible.
const MB_GONIO_HEAD = 160;

const masterBus = {
  /// The analyser's transform size. Frequency resolution, and the only part of
  /// the detail worth choosing by hand — the band count follows the pixels.
  fft: prefs.masterFft,
  /// The last reply, or null when there is nothing playing to report on.
  data: null,
  /// Peak hold per channel: the value, and when it was set.
  hold: { l: MB_METER_FLOOR, r: MB_METER_FLOOR, lAt: 0, rAt: 0 },
  /// The spectrum's own hold, one value per band.
  specHold: null,
  timer: null,
};

/// A proper minus sign, matching every other number in the interface.
function mbDb(v, places = 1) {
  if (!Number.isFinite(v) || v <= -119) return '−∞';
  return v.toFixed(places).replace('-', '−');
}

function mbSigned(v, places = 1) {
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(places);
}

const MB_NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/// The nearest equal-tempered note to a frequency, A440.
///
/// On a spectrum analyser this is the difference between "there is energy at
/// 87 Hz" and "that is an F2" — which is the one a musician can act on.
function noteName(hz) {
  if (!(hz > 0)) return '';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  if (midi < 12 || midi > 127) return '';
  return `${MB_NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/// A token, read from the document so a theme actually reaches these panels.
function mbInk(name, fallback = '#8a949c') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/// Size a canvas to its element and hand back a context ready to draw in CSS
/// pixels, or `null` when it has no size worth drawing into.
///
/// **Both dimensions.** Testing only the width is what left the grain layer's
/// backing store at the old height after a window resize, drawing everything
/// squashed at a size nothing on screen had.
function mbFit(el) {
  if (!el) return null;
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  const wantW = Math.round(w * dpr), wantH = Math.round(h * dpr);
  if (el.width !== wantW || el.height !== wantH) { el.width = wantW; el.height = wantH; }
  const c = el.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return { c, w, h };
}

/// Whether anything would be seen if it were drawn.
///
/// `offsetParent` is null whenever the element or any ancestor is display:none,
/// which covers the dock being shut and another dock tab being chosen without
/// having to know about either.
///
/// And it is null for a fullscreen element too, which is the one state where
/// this read exactly the wrong answer. A fullscreen element is positioned as
/// though it were fixed, and a fixed element has no `offsetParent` — so the
/// panel filling the screen looked identical to the panel being closed, the
/// poll that feeds the room stopped, and what you got was a still picture of
/// the last frame before it went up. The most visible the thing ever gets was
/// the one case counted as hidden.
function mbVisible() {
  const el = $('masterBus');
  if (!el) return false;
  if (document.fullscreenElement === el) return el.clientWidth > 0;
  return el.offsetParent !== null && el.clientWidth > 0;
}

/// dBFS to a fraction of the meter's width.
const mbX = (db) => Math.max(0, Math.min(1, (db - MB_METER_FLOOR) / (0 - MB_METER_FLOOR)));

function mbUpdateHold(now) {
  const d = masterBus.data;
  for (const [side, key, at] of [['left', 'l', 'lAt'], ['right', 'r', 'rAt']]) {
    const db = d ? d[side].peakDb : -120;
    const h = masterBus.hold;
    if (db >= h[key]) { h[key] = db; h[at] = now; continue; }
    const idle = now - h[at];
    if (idle > MB_HOLD_MS) {
      h[key] = Math.max(db, h[key] - MB_HOLD_FALL_DB * (idle - MB_HOLD_MS) / 1000);
      h[at] = now - MB_HOLD_MS;
    }
  }
}

/// The level ladders.
///
/// Two-tone, the way a mastering meter is: a solid body that is 300 ms of RMS —
/// loudness, which is what you mix by — with a dimmer extension above it
/// reaching the peak. One bar tells you both, and the gap between them is the
/// crest factor, read at a glance.
///
/// The scale runs down **both** sides. On a meter this narrow a single column
/// of numbers is always on the wrong side of one of the two bars.
function drawMasterVu() {
  const f = mbFit($('mbVu'));
  if (!f) return;
  const { c, w, h } = f;
  const d = masterBus.data;

  const good = mbInk('--good', '#4fbf7a');
  const warn = mbInk('--warn', '#e0a23c');
  const bad = mbInk('--bad', '#e05c4a');
  const dim = mbInk('--text-dim', '#78838c');
  const line = mbInk('--line-2', '#2a3138');

  const refDb = d?.vuRef ?? -18;
  const kneeDb = d?.knee ? 20 * Math.log10(d.knee) : -3;

  const barW = 20, gap = 4, foot = 10, top = 4;
  const plotH = h - foot - top;
  const mid = w / 2;
  const xs = [mid - barW - gap / 2, mid + gap / 2];
  const yOf = (db) => top + (1 - mbX(db)) * plotH;

  c.font = '8px ui-monospace, monospace';
  c.lineWidth = 1;
  c.textBaseline = 'middle';
  for (const t of [0, -6, -12, -18, -24, -30, -36, -48, -60]) {
    const y = Math.round(yOf(t)) + 0.5;
    c.strokeStyle = line;
    c.globalAlpha = t === refDb ? 0.9 : 0.3;
    c.beginPath(); c.moveTo(xs[0], y); c.lineTo(xs[1] + barW, y); c.stroke();
    c.globalAlpha = 1;
    // Named, because "0 VU = −18 dBFS" is a choice and the meter should say
    // which one was made rather than leave it to be assumed.
    c.fillStyle = t === refDb ? warn : dim;
    c.textAlign = 'right'; c.fillText(t === refDb ? '0VU' : String(t), xs[0] - 3, y);
    c.textAlign = 'left'; c.fillText(String(t), xs[1] + barW + 3, y);
  }

  for (const [i, side] of ['left', 'right'].entries()) {
    const x = xs[i];
    c.fillStyle = 'rgba(255,255,255,.04)';
    c.fillRect(x, top, barW, plotH);
    if (!d) continue;

    const zone = (db) => (db >= kneeDb ? bad : db >= refDb ? warn : good);

    // The peak extension first, dim, so the solid body paints over its foot.
    //
    // Shaded by the level at each height rather than by the peak: colouring the
    // whole extension red because its tip is red paints eleven decibels of
    // perfectly good signal as an alarm.
    const pk = d[side].peakDb;
    if (pk > MB_METER_FLOOR) {
      c.globalAlpha = 0.3;
      for (const [lo2, hi2, colour] of [
        [MB_METER_FLOOR, refDb, good], [refDb, kneeDb, warn], [kneeDb, 0, bad],
      ]) {
        const yB = yOf(lo2), yT = Math.max(yOf(hi2), yOf(pk));
        if (yB <= yT) continue;
        c.fillStyle = colour;
        c.fillRect(x, yT, barW, yB - yT);
      }
      c.globalAlpha = 1;
    }
    // Then the body, in the three zones it actually crosses.
    const vuDb = d[side].vuDb;
    const endY = yOf(vuDb);
    for (const [lo, hi, colour] of [
      [MB_METER_FLOOR, refDb, good], [refDb, kneeDb, warn], [kneeDb, 0, bad],
    ]) {
      const yB = yOf(lo), yT = Math.max(yOf(hi), endY);
      if (yB <= yT) continue;
      c.fillStyle = colour;
      c.fillRect(x, yT, barW, yB - yT);
    }
    // And the hold, riding on top of both.
    const held = masterBus.hold[i ? 'r' : 'l'];
    if (held > MB_METER_FLOOR) {
      c.fillStyle = zone(held);
      c.fillRect(x, Math.round(yOf(held)) - 1, barW, 2);
    }
  }

  c.fillStyle = dim;
  c.textAlign = 'center'; c.textBaseline = 'top';
  c.fillText('L', xs[0] + barW / 2, top + plotH + 2);
  c.fillText('R', xs[1] + barW / 2, top + plotH + 2);
}

/// What the numbers say. The part that was actually asked for.
function paintMasterReads() {
  const d = masterBus.data;
  const kneeDb = d?.knee ? 20 * Math.log10(d.knee) : -3;

  for (const [side, key] of [['left', 'L'], ['right', 'R']]) {
    const ch = d?.[side];
    const hold = masterBus.hold[key === 'L' ? 'l' : 'r'];
    const vu = $(`mb${key}vu`), rms = $(`mb${key}rms`);
    const pk = $(`mb${key}pk`), hd = $(`mb${key}hold`);
    if (!vu) continue;
    // Silence is −∞, not −102.0. The units are a difference from the
    // reference, so at the floor the arithmetic gives a real number and it is a
    // meaningless one — printing it makes silence look like a measurement.
    vu.textContent = ch ? (ch.vuDb <= -119 ? '−∞' : mbSigned(ch.vuUnits)) : '—';
    rms.textContent = ch ? mbDb(ch.vuDb) : '—';
    pk.textContent = ch ? mbDb(ch.peakDb) : '—';
    hd.textContent = d && hold > MB_METER_FLOOR ? mbDb(hold) : '—';
    for (const [el, v] of [[pk, ch?.peakDb], [hd, hold]]) {
      el.classList.toggle('over', !!d && v >= -0.2);
      el.classList.toggle('hot', !!d && v < -0.2 && v >= kneeDb);
    }
  }

  // Sustained negative correlation is the state where every other meter looks
  // fine and the mono fold-down does not, so it is the one worth colouring.
  const corr = $('mbCorrBig');
  if (corr) {
    corr.textContent = d ? mbSigned(d.correlation, 2) : '—';
    corr.classList.toggle('over', !!d && d.correlation < 0);
    corr.classList.toggle('good', !!d && d.correlation > 0.5);
    corr.classList.toggle('hot', !!d && d.correlation >= 0 && d.correlation <= 0.5);
  }
  const word = $('mbCorrWord');
  if (word) {
    // One short word, always.
    //
    // "out of phase" wrapped to two lines in a column this narrow, which made
    // the row taller and shoved every reading below it down the panel — the
    // whole block jumped every time the correlation crossed zero. The state it
    // names is the one you most want to watch steadily, so it is the one that
    // must not make the meter move.
    word.textContent = !d ? ''
      : d.correlation > 0.9 ? 'mono'
      : d.correlation < 0 ? 'phase'
      : d.correlation < 0.4 ? 'wide' : 'stereo';
    word.classList.toggle('warn', !!d && d.correlation < 0);
  }

  // Where the energy actually is. This used to be drawn onto the flat spectrum;
  // the room has no room for a label, so it is computed here and shown in the
  // corner instead.
  const note = $('mbPeakHz');
  if (note) {
    const bands = d?.spectrum;
    if (!bands || !bands.length) note.textContent = '';
    else {
      let top = 0;
      for (let i = 1; i < bands.length; i++) if (bands[i] > bands[top]) top = i;
      if (bands[top] <= MB_SPEC_FLOOR + 6) note.textContent = '';
      else {
        const hz = d.lo * Math.pow(d.hi / d.lo, (top + 0.5) / bands.length);
        const name = noteName(hz);
        note.textContent =
          `${hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`}`
          + `${name ? ` · ${name}` : ''} · ${mbDb(bands[top])} dB`;
      }
    }
  }

  const st = $('mbState');
  if (st) {
    if (!d) st.textContent = 'idle';
    // How much of the last hundred milliseconds the output stage is rounding
    // off. The ceiling working is not a fault, but it should be visible rather
    // than only audible.
    else if (d.overKnee > 0.0005) st.textContent = `ceiling ${(d.overKnee * 100).toFixed(0)}%`;
    else st.textContent = `${(d.rate / 1000).toFixed(1)} kHz · ${(d.fft || 4096) / 1024}k`;
  }
}

async function mbTick() {
  if (!mbVisible()) return;
  // No sound card, no master bus. Without this the meters ask the engine
  // twenty times a second forever on a machine that has none — which is the
  // exact fault `tests/ui/no-audio.spec.mjs` was written for, arriving by a new
  // route. See `docs/NO-AUDIO-DEVICE.md`.
  if (noAudio()) { masterBus.data = null; return; }
  try {
    // One band per pixel of the display about to be drawn into: as much detail
    // as can be seen and not a number more. The transform size is the knob —
    // that is frequency resolution, and it is the one worth choosing.
    const el = $('visGl');
    const want = Math.max(64, Math.min(2048, Math.round(el?.clientWidth || 256)));
    const r = await api(`/api/engine/master?fft=${masterBus.fft}&bands=${want}`);
    // GRAIN off: the engine's own feed is not drawn, so the picture is the
    // sequencer's alone, or nothing.
    masterBus.data = masterFeed(r, want);
  } catch {
    // A meter that cannot reach the server shows nothing rather than the last
    // thing it saw. Freezing on a stale reading is the one behaviour a meter is
    // not allowed to have.
    masterBus.data = null;
  }
  if (!mbVisible()) return;
  mbUpdateHold(performance.now());
  drawMasterVu();
  paintMasterReads();
  // The room only moves when there is something new to move it, so the
  // waterfall is pushed at the poll's rate and drawn at the display's.
  paintRoomData();
  // **Whichever module is chosen gets the sound.** One feed, at the meter's
  // rate; the modules differ in what they draw with it, not in what they are
  // given.
  const vis = visRenderer();
  // The settings before the row is made, not after. See `configure`.
  if (vis && vis.configure) {
    vis.configure(visModuleKey() === 'room3d' ? room3dSettings()
      : visModuleKey() === 'stage' ? stageSettings() : ridgeSettings());
  }
  if (vis && masterBus.data?.spectrum) {
    vis.push(masterBus.data.spectrum, masterBus.data.lissajous);
  } else if (vis && visModuleKey() !== 'room') {
    // Silence is a picture too, and for the ridgeline it is the right one: flat
    // lines, which is what the top and bottom of the plot look like. So it is
    // fed nothing rather than a test card, and the stack goes quiet honestly.
    vis.push(new Float32Array(0), null);
  } else if (visGl && roomEdit.on) {
    // Something to pose against.
    //
    // The room is fed by the meter, so with nothing playing there is nothing in
    // it — which is right for a meter and useless for a camera. Turning the
    // editor on with the transport stopped gave a black rectangle and invisible
    // things to drag.
    //
    // So while the room is being posed it is given a **still test pattern**: a
    // fixed spectrum shape and a fixed figure, pushed at the poll's rate so the
    // terrain fills and then holds. Steady is the point — a camera is judged
    // against something that is not moving, and a signal that jumps under the
    // hand is the same fault the theme editor's miniature was built to avoid.
    visGl.push(...roomTestCard());
  }
}

/// A fixed room to aim at: a few humps across the spectrum and a lopsided
/// figure, so floor, depth and ring all have something in them. Deterministic,
/// so the picture is the same every time the editor is opened and two poses can
/// actually be compared.
function roomTestCard() {
  if (!roomTestCard.made) {
    const bands = new Float32Array(256);
    for (let i = 0; i < bands.length; i++) {
      const f = i / (bands.length - 1);
      // Three humps and a slope, in dB, over the meter's own range.
      const hump = (at, w) => Math.exp(-((f - at) ** 2) / (2 * w * w));
      const v = 0.92 * hump(0.08, 0.05) + 0.66 * hump(0.32, 0.09) + 0.44 * hump(0.7, 0.14);
      bands[i] = -96 + 96 * Math.max(0.04, v * (1 - 0.45 * f));
    }
    const liss = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const t = (i / 256) * Math.PI * 2;
      // Not a circle: a wide-ish image, so the ring is visibly pushed out of
      // round the way real material pushes it.
      liss[i * 2] = 0.62 * Math.sin(t * 3);
      liss[i * 2 + 1] = 0.62 * Math.sin(t * 2);
    }
    roomTestCard.made = [bands, liss];
  }
  return roomTestCard.made;
}

function wireMasterRes() {
  for (const b of document.querySelectorAll('.mb-res-btn')) {
    b.classList.toggle('active', +b.dataset.fft === masterBus.fft);
    b.onclick = () => {
      masterBus.fft = setPref('masterFft', +b.dataset.fft);
      for (const o of document.querySelectorAll('.mb-res-btn')) {
        o.classList.toggle('active', o === b);
      }
      // The hold is in the old resolution's bands and would be compared against
      // the new ones index by index, which draws a hold that never happened.
      masterBus.specHold = null;
    };
  }
}

function startMasterBus() {
  if (masterBus.timer) return;
  wireMasterRes();
  masterBus.timer = setInterval(mbTick, MB_POLL_MS);
  // The panels are drawn once so they are not blank before the first reply
  // lands, and again whenever the tray is resized under them.
  const redraw = () => { if (mbVisible()) drawMasterVu(); };
  if (window.ResizeObserver) new ResizeObserver(redraw).observe($('masterBus'));
  redraw();
}
startMasterBus();

