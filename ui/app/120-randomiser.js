// ─────────────────────────────────────────────────────────── the randomiser ──
//
// Throw every control in the stretch tray somewhere at random, commit, and say
// what it did. Built to find glitches: a cloud has too many interacting
// parameters to reason about one at a time, and the combinations that break it
// are exactly the ones nobody would think to try.
//
// **It drives the real controls rather than the drafts.** Every range, choice
// and switch in the tray is set through the same `input`/`change` events a hand
// would produce, which means it can only ever produce values the interface
// itself allows — no separate table of ranges to drift out of step with the
// controls, which is gotcha 7 waiting to happen. It also means what it exercises
// is the path a user exercises.
//
// The engine picker is deliberately excluded. Which engine you are in is where
// you are, not a setting — the same reason Reset all leaves it alone — and a
// sweep wants to hold it fixed and vary everything else.

/// mulberry32. Small, fast, and good enough for choosing slider positions.
///
/// Seeded on purpose: a randomiser that cannot be replayed is useless for
/// finding a fault, because the interesting run is always the one you have just
/// lost. Every roll records its seed and the same seed gives the same tray.
function rngFrom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// The containers a roll reaches, and the one it must not.
const RANDOM_BOXES = ['stretchParams', 'grainShape', 'grainPitch', 'extEngine', 'extGrain'];

/// Set every control in the tray at random. Returns what it rolled.
///
/// `seed` is optional; without one it picks a seed and tells you what it picked,
/// so an interesting accident is still reproducible afterwards.
function randomizeStretch({ seed = null, commit = true } = {}) {
  const used = seed === null ? (Math.random() * 0xffffffff) >>> 0 : seed >>> 0;
  const rnd = rngFrom(used);
  const rolled = {};

  for (const boxId of RANDOM_BOXES) {
    const box = $(boxId);
    if (!box) continue;

    // Sliders and knobs. A log control's element is 0..1000 ticks, so a uniform
    // roll over the element is uniform in log space — which is the right
    // distribution for a control that was given a log sweep in the first place.
    const ranges = [...box.querySelectorAll('input[type=range]')];
    for (const input of ranges) {
      const min = Number(input.min);
      const max = Number(input.max);
      const step = Number(input.step) || 1;
      const steps = Math.max(1, Math.round((max - min) / step));
      input.value = String(min + Math.round(rnd() * steps) * step);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Three-way choices — but never the engine picker.
    for (const bar of box.querySelectorAll('.seg')) {
      if (bar.id === 'stretchEngine') continue;
      const btns = [...bar.querySelectorAll('.seg-btn')];
      if (!btns.length) continue;
      btns[Math.floor(rnd() * btns.length)].click();
    }

    // Switches. Clicked only when the roll disagrees with where it already is,
    // because the handler toggles rather than sets.
    for (const b of box.querySelectorAll('.switch')) {
      const want = rnd() < 0.5;
      if (b.classList.contains('on') !== want) b.click();
    }

    // One commit per box rather than one per control: `change` is what posts,
    // and forty posts where five will do turns a sweep into a wait.
    if (commit && ranges.length) {
      ranges[ranges.length - 1].dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // What actually landed, read back from the drafts rather than from what was
  // rolled — those are two different things whenever a value is clamped, and
  // the one worth recording is the one the engine got.
  rolled.seed = used;
  rolled.algorithm = state.stretchDraft?.algorithm || null;
  rolled.stretch = JSON.parse(JSON.stringify(state.stretchDraft || {}));
  rolled.grain = JSON.parse(JSON.stringify(state.grainDraft || {}));
  return rolled;
}

async function resetEverything() {
  state.stretchDraft = { ratio: 1, semitones: 0, windowMs: 40, quality: 'standard',
                         // Which engine you are working in is not a setting to
                         // be undone — it is where you are. Reset puts the
                         // controls back; it does not move you somewhere else.
                         algorithm: state.stretchDraft?.algorithm || 'wsola',
                         vocoder: { ...VOCODER_DEFAULTS },
                         wsola: { ...WSOLA_DEFAULTS },
                         pvsola: { ...PVSOLA_DEFAULTS },
                         hybrid: { ...HYBRID_DEFAULTS },
                         cloud: false, cloudMix: 0.5 };
  const grain = {
    ...GRAIN_DEFAULTS,
    seed: state.grainDraft?.seed ?? state.edit?.stretch?.grain?.seed ?? 1,
  };
  state.grainDraft = { ...grain };
  await editOp({ op: 'stretch', ...state.stretchDraft, grain });
  // The per-engine panels are built once and then left alone, so their controls
  // cannot be pushed back to a default the way a slider can — rebuild them.
  stretchBuiltFor = null;
  grainBuiltFor = null;
  renderStretch();
  renderGrainParams();
  syncStretchSliders();
  syncGrainSliders();
}

/// The Extended column's reset, on the first line it has.
///
/// The column has no heading of its own, so the button rides on the heading of
/// whichever group comes first — which changes with the engine, hence moving it
/// rather than building it in. Held outside the DOM between rebuilds so the
/// `innerHTML` that clears the column does not take the handler with it.
let extResetBtn = null;
function placeExtendedReset() {
  const panel = $('extPanel');
  if (!panel) return;
  if (!extResetBtn) {
    extResetBtn = resetButton(
      // This one clears the extended column only. Everything, standard and
      // extended, is a double-click on an engine tab — a gesture rather than a
      // button, so the two do not have to compete for the same strip of room.
      'extReset', 'Reset',
      'Reset only the extended controls — the standard ones are left alone',
      resetExtended,
    );
  }
  // Not `offsetParent`, which needs layout and is unreliable mid-rebuild.
  const heads = [...panel.querySelectorAll('.wild-head')];
  const first = heads.find((h) => !h.closest('.hidden')) || heads[0];
  if (first) first.appendChild(extResetBtn);
}

/// A reset button, built where it belongs rather than declared in the markup.
///
/// The panels these sit in are rebuilt wholesale, so a button placed once in
/// the HTML would be destroyed by the first rebuild and take its handler with
/// it. Keeping the id means the menu can still press it.
function resetButton(id, label, title, run) {
  const b = document.createElement('button');
  b.className = 'tiny';
  b.id = id;
  b.textContent = label;
  b.title = title;
  b.onclick = run;
  return b;
}

/// Draw the EQ response the server computed, so the picture and the filter
/// cannot disagree.
function drawEqCurve(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const RANGE = 20; // dB shown top to bottom
  const y = (db) => h / 2 - (db / RANGE) * h;

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (const db of [-12, -6, 0, 6, 12]) {
    ctx.globalAlpha = db === 0 ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(0, y(db)); ctx.lineTo(w, y(db)); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const curve = state.rack?.curve;
  if (!curve || !curve.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('EQ switched out', 8, h / 2 - 4);
    return;
  }

  const accent = waveInk();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  curve.forEach(([, db], i) => {
    const x = (i / (curve.length - 1)) * w;
    i === 0 ? ctx.moveTo(x, y(db)) : ctx.lineTo(x, y(db));
  });
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('20 Hz', 4, h - 4);
  ctx.fillText('20 kHz', w - 40, h - 4);
}

