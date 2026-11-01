// ------------------------------------------------------------------- capture
//
// Keeps what comes out of the speakers, rather than re-rendering the document.
// Those can differ — the engine is what you were listening to — and when they
// do, the recording is the honest one.
//
// Arming before playback and stopping when playback stops is the whole gesture:
// press record, press play, and when the sound ends the file is already written
// beside the original.

const capture = { armed: false, running: false };

async function setCapture(on) {
  try {
    const r = await postJSON('/api/capture', { on });
    if (on) {
      capture.running = true;
      return;
    }
    capture.running = false;
    if (!r.frames) { toast('Nothing captured'); return; }
    // The library has a file in it that was not there a moment ago.
    await refreshLibrary();
    const where = r.elsewhere ? ' (library not writable — saved to the app folder)' : '';
    const cut = r.truncated ? ' — hit the ten minute limit' : '';
    toast(`Captured ${r.seconds.toFixed(1)}s → ${r.name}${where}${cut}`);
  } catch (e) {
    capture.running = false;
    toast('Capture failed: ' + e.message);
  }
}

function reflectCapture() {
  const b = $('recBtn'), l = $('recLabel');
  if (!b) return;
  b.classList.toggle('on', capture.running);
  b.classList.toggle('armed', capture.armed && !capture.running);
  b.title = capture.running ? 'Recording — stops and saves when playback stops'
          : capture.armed ? 'Armed — starts when playback starts'
          : 'Capture what is playing';
  if (l) l.textContent = capture.running ? 'REC' : (capture.armed ? 'armed' : '');
}

const recBtn = $('recBtn');
if (recBtn) recBtn.onclick = async () => {
  if (capture.running) {
    // Stop now, without waiting for the sound to end.
    await setCapture(false);
    capture.armed = false;
  } else if (capture.armed) {
    capture.armed = false;
  } else {
    capture.armed = true;
    // Pressed while already playing: start keeping it immediately.
    if (engine.playing) await setCapture(true);
  }
  reflectCapture();
};

/// Called from the engine poll. Starts on play, finishes on stop.
function captureFollow(playing) {
  if (!capture.armed) return;
  if (playing && !capture.running) { setCapture(true).then(reflectCapture); }
  else if (!playing && capture.running) {
    capture.armed = false;
    setCapture(false).then(reflectCapture);
  }
}

// ------------------------------------------------------------ painting values
//
// A bank of sliders is a row of faders, and the thing you want to do with a row
// of faders is sweep a hand across it. Drag within one bar and it behaves
// exactly as it always did — the native control handles it. Carry the stroke
// off that bar and onto its neighbours and each one takes the value where the
// stroke crosses it, so a contour can be drawn across a whole panel in one
// gesture.
//
// The painted rows are driven through the same input/change events a pointer
// would produce, so everything downstream — the draft preview, the throttle,
// the commit on release — is reached by exactly the path it already trusts.

function paintValueAt(row, clientX) {
  const input = row.querySelector('input[type=range]');
  if (!input) return;
  const r = input.getBoundingClientRect();
  if (r.width <= 0) return;

  const min = +input.min, max = +input.max;
  const step = +input.step || 1;
  const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  const raw = min + t * (max - min);
  const snapped = Math.round(raw / step) * step;

  const next = String(Math.min(max, Math.max(min, snapped)));
  if (next === input.value) return;
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function enablePainting(scope) {
  if (!scope || scope.dataset.painting) return;
  scope.dataset.painting = '1';

  let painting = false;
  const touched = new Set();

  /// The bar under a point, by geometry rather than by hit-testing.
  ///
  /// `elementFromPoint` would be the obvious tool and is the wrong one: it
  /// answers about whatever is painted on top, so a tooltip, an overlay or a
  /// slider's own thumb can shadow a row and the stroke skips it.
  ///
  /// Both axes are tested, not just the vertical one, because the panels sit
  /// side by side — matching on height alone would set the bar in the next
  /// column along at the same time.
  const rowAt = (x, y) => {
    for (const row of scope.querySelectorAll('.param')) {
      const r = row.getBoundingClientRect();
      if (r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return row;
      }
    }
    return null;
  };

  const mark = (x, y) => {
    const row = rowAt(x, y);
    if (!row) return;
    // Set once, where the stroke crosses. An intersection is a point, so a bar
    // takes its value at the moment the line enters it and keeps it even if the
    // hand wanders on the way out.
    if (touched.has(row)) return;
    row.classList.add('painting');
    touched.add(row);
    paintValueAt(row, x);
  };

  scope.addEventListener('pointerdown', (e) => {
    // Pressing on a control is that control's own drag, and stealing it would
    // fight the gesture already under way. A stroke begins on the background
    // between them.
    if (e.target.closest('input, button, select, textarea, a, label')) {
      painting = false;
      return;
    }
    painting = true;
    touched.clear();
    mark(e.clientX, e.clientY);
  });

  // On the window, so the stroke survives the pointer leaving the panel.
  window.addEventListener('pointermove', (e) => {
    if (!painting || !e.buttons) return;
    mark(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', () => {
    if (!painting) return;
    painting = false;
    for (const row of touched) {
      row.classList.remove('painting');
      // Release, so each draft becomes a proper commit at full quality.
      row.querySelector('input[type=range]')
         ?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    touched.clear();
  });
}

/// Fire at most every `ms`, but fire *during* the gesture, not after it.
///
/// Both preview paths used a trailing debounce — clearTimeout on every input
/// event, then send once the events stop. Which means that while a slider is
/// actually moving the timer is reset on every pixel and never fires at all,
/// and the change only lands when the pointer pauses or is released. The whole
/// point of a preview is that it happens while you are still dragging.
function throttled(fn, ms) {
  let last = 0, timer = null;
  return () => {
    const now = performance.now();
    const wait = Math.max(0, ms - (now - last));
    clearTimeout(timer);
    if (wait === 0) { last = now; fn(); }
    else timer = setTimeout(() => { last = performance.now(); fn(); }, wait);
  };
}

/// Time and pitch live on the document, so they are posted as an edit
/// operation rather than as part of the rack.
/// Which file the stretch sliders were built for.
///
/// The panel is built once and then left alone. Rebuilding it on every server
/// response destroyed the very slider under the pointer, so the first change
/// landed and no further drag did anything.
let stretchBuiltFor = null;

function sendStretch({ live }) {
  const d = state.stretchDraft;
  editOp(
    { op: 'stretch', ratio: d.ratio, semitones: d.semitones,
      windowMs: d.windowMs, quality: live ? 'draft' : d.quality,
      algorithm: d.algorithm, vocoder: d.vocoder, wsola: d.wsola,
      pvsola: d.pvsola, hybrid: d.hybrid,
      cloud: d.cloud, cloudMix: d.cloudMix },
    { live },
  );
}

// The engines' own defaults, mirroring `VocoderParams`, `WsolaParams` and
// `Grain` in the fx crate. Kept here so a document saved before a control
// existed still opens with that control at the value the engine assumes, rather
// than at undefined — which a slider reads as NaN and posts back as a reset.
const VOCODER_DEFAULTS = {
  windowMs: 46, phaseLock: true,
  freqTrust: 1, phaseSpread: 1, peakWidth: 2, lockWidth: 1,
  magFreeze: 0, magBlur: 0, magGate: 0, stereoLink: false,
};
const WSOLA_DEFAULTS = {
  preserveTransients: false, sensitivity: 0.5,
  searchMs: 10, splice: 'similar', stride: 4, shape: 'hann',
  guardHops: 3, floor: 1,
};
// Which engines the audio callback can actually run. Mirrors
// `engine::stretcher::is_live`; the rest are rendered on export and
// approximated live, which the panel says out loud.
const LIVE_ENGINES = ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular'];
const PVSOLA_DEFAULTS = { anchorFrames: 6, searchMs: 10, blend: 0.5 };
const HYBRID_DEFAULTS = {
  fftSize: 2048, timeSpan: 17, freqSpan: 17, margin: 2, morphNoise: true,
  harmonicLevel: 1, percussiveLevel: 1, residualLevel: 1,
};
const GRAIN_DEFAULTS = {
  rateHz: 0, densityHz: 0, overlap: 2, sizeJitter: 0, positionJitterMs: 0,
  pitchJitterSemis: 0, pitchDriftSemis: 0, driftRateHz: 0.5, layers: 1,
  scan: 1, reverse: false, envelope: 0.5, sizeRange: 1, wrap: false,
  layerSpread: 1, linkJitter: false, driftStep: false, panSpread: 0,
  // Zero is the sweep's own beginning, matching `Grain::default` in `fx`. It
  // was missing, so Position was the one fader in its group with no
  // double-click reset — silently, because `param` only attaches the handler
  // when it is given a default and says nothing when it is not.
  position: 0,
  layerScatter: 0, layerScatterMs: 120,
};

/// Continuous preview while dragging, at draft quality so it keeps up.
const previewStretch = throttled(() => sendStretch({ live: true }), 90);

/// Pointer released: commit properly, at the chosen quality, and repoint audio.
function commitStretch() {
  sendStretch({ live: false });
}

function renderStretch() {
  const box = $('stretchParams');
  if (!box) return;
  const st = state.edit?.stretch;
  const path = state.selectedFile?.path || null;

  if (!st) { box.innerHTML = ''; stretchBuiltFor = null; return; }

  // Already built for this document: refresh the derived readout only.
  if (stretchBuiltFor === path) { showStretchOut(); return; }

  stretchBuiltFor = path;
  box.innerHTML = '';
  // Take the tier from the document, not from whatever the last file used.
  state.stretchDraft = {
    ratio: st.ratio, semitones: st.semitones,
    windowMs: st.windowMs, quality: st.quality || 'standard',
    algorithm: st.algorithm || 'wsola',
    vocoder: { ...VOCODER_DEFAULTS, ...(st.vocoder || {}) },
    wsola: { ...WSOLA_DEFAULTS, ...(st.wsola || {}) },
    pvsola: { ...PVSOLA_DEFAULTS, ...(st.pvsola || {}) },
    hybrid: { ...HYBRID_DEFAULTS, ...(st.hybrid || {}) },
    // A document written before the cloud could be layered has neither field.
    // Off is what it sounds like, so off is what it opens as.
    cloud: !!st.cloud,
    cloudMix: st.cloudMix ?? 0.5,
  };

  // Which engine does the stretching. Not a quality ladder — they fail in
  // different directions, so this is a choice about the material rather than
  // about how hard to work.
  const eng = document.createElement('div');
  eng.className = 'engine-pick';
  eng.dataset.gmLabel = 'Engine';
  eng.innerHTML = `
    <div class="seg" id="stretchEngine">
      <button class="seg-btn" data-alg="wsola" title="WSOLA — time domain. Keeps transients intact: drums, percussion, one-shots.">WSOLA</button>
      <button class="seg-btn" data-alg="vocoder" title="Frequency domain. Holds chords and sustained tone together - pads, strings.">Vocoder</button>
      <button class="seg-btn" data-alg="pvsola" title="The vocoder, re-anchored to the waveform every few frames. Holds tone together without the phasiness - the one-knob default for pitched material.">PVSOLA</button>
      <button class="seg-btn" data-alg="hybrid" title="Splits the sound into tone, hits and air, and stretches each its own way. The slow one, and the only one that will not repeat noise.">Hybrid</button>
      <button class="seg-btn" data-alg="granular" title="A cloud of grains. Not trying to be transparent - this is the one you hear.">Granular</button>
    </div>`;
  // No reset button on this row any more.
  //
  // It was the sixth thing on a row that already lost its engine labels the
  // moment a second button joined it, and it spent all of its time being a
  // button you did not want next to five you did. Double-clicking an engine
  // tab does the same job — see the tabs' `ondblclick` below — which costs the
  // row nothing and puts the gesture on the thing it resets.
  box.appendChild(eng);

  // The order under the picker is fixed, and it is the same on every engine:
  //
  //   1. the button row
  //   2. Stretch, Pitch, Window — always, always these three
  //   3. whatever sliders this engine has of its own
  //
  // They used to come third, after the engine's own controls, so the first
  // slider under the buttons was `Re-anchor` on PVSOLA, `Analysis window` on
  // the vocoder and `Tone` on the hybrid. Three separate containers rather than
  // one, so the order cannot depend on what happens to be appended when.
  const switchHost = document.createElement('div');
  switchHost.className = 'engine-switch-host';
  eng.after(switchHost);

  const coreHost = document.createElement('div');
  coreHost.className = 'stretch-core';
  switchHost.after(coreHost);

  // Each engine gets its own controls. They mean different things by a
  // "window" — a splice for WSOLA, an analysis frame for the vocoder, a grain
  // for the cloud — so one shared slider was three half-explained ones.
  const own = document.createElement('div');
  own.className = 'engine-params';
  coreHost.after(own);

  const reflectEngine = () => {
    const alg = state.stretchDraft.algorithm;
    for (const b of eng.querySelectorAll('.seg-btn')) {
      b.classList.toggle('active', b.dataset.alg === alg);
    }
    own.innerHTML = '';
    // One row at the top of the engine's own controls: whatever switches it
    // has on the left, the tuning on the right. Built for every engine, so the
    // scale is in the same place whichever one is picked — pitch applies to
    // all of them, and only WSOLA has a transient switch to sit beside.
    const switches = document.createElement('div');
    switches.className = 'engine-switches';
    // The tuning goes on first and the engine's own switches are prepended in
    // front of it, so it sits at the right-hand end of the row whether or not
    // this engine has anything to put beside it.
    // Four fixed slots, and WSOLA is the master.
    //
    // 1 the engine's own switch · 2 the grain cloud · 3 the tuning · 4 Keys.
    // An engine with nothing for slot 1 leaves it empty rather than sliding the
    // rest left, so no button ever moves when you change engine — which is the
    // whole point of a row of controls you learn the position of.
    const scale = scaleButton();
    scale.dataset.slot = '3';
    switches.appendChild(scale);
    const keys = keysButton();
    keys.dataset.slot = '4';
    switches.appendChild(keys);
    // Its own host, above the three core sliders — `own` is cleared and rebuilt
    // per engine and sits below them.
    switchHost.innerHTML = '';
    switchHost.appendChild(switches);

    // The grain cloud, layered over whichever engine is running.
    //
    // The picker chooses one of five, and choosing one used to silence the
    // other four — including the cloud, which is not really the same kind of
    // thing. The other four are trying to move a recording through time
    // without being noticed; the cloud is an instrument. So it can now run
    // beside them on the same source. Nothing to offer when the cloud already
    // *is* the engine.
    if (alg !== 'granular') {
      const d = state.stretchDraft;
      const cloudRow = check('grain cloud',
        'Run the grain cloud over this engine, reading the same source at the same stretch',
        d.cloud,
        (on) => { d.cloud = on; reflectEngine(); commitStretch(); });
      cloudRow.dataset.slot = '2';
      switches.prepend(cloudRow);
      if (d.cloud) {
        own.appendChild(tip(param('Cloud', d.cloudMix, 0, 1, 0.01,
          (x) => `${Math.round(x * 100)}%`,
          (x) => { d.cloudMix = x; previewStretch(); }, () => commitStretch(), false, 0.5),
          'How much cloud against the engine underneath. Equal power, so the middle is not a dip — the two are decorrelated and a straight crossfade would sag there.'));
      }
    }
    // The engine's standard controls stay under the picker. Everything that
    // used to be a constant in the algorithm goes to the Extended column
    // instead: those values are constants because that is where the algorithm
    // works, so they belong together and away from the everyday sliders.
    const ext = $('extEngine');
    ext.innerHTML = '';
    // The vocoder's standard pair and its two extended groups.
    //
    // Written once and called from three engines, because PVSOLA and Hybrid
    // both *run* the vocoder — a control that reaches the audio but has no
    // control on the panel is the same bug as one that does nothing, and
    // harder to notice. `what` names whose vocoder it is, since inside the
    // hybrid it is only shaping one third of the sound.
    const vocoderControls = (what) => {
      const v = state.stretchDraft.vocoder;
      own.appendChild(tip(param('Analysis window', v.windowMs, 5, 500, 1,
        (x) => `${Math.round(x)} ms`,
        (x) => { v.windowMs = x; previewStretch(); }, () => commitStretch(), true, VOCODER_DEFAULTS.windowMs),
        "The length of one transform, rounded to a power of two. Long resolves partials that sit close together and smears transients; short does the opposite. This is the vocoder's own window and means something different from the one above."));
      const phaseRow = check('phase lock',
        'Holds each partial together instead of letting it dissolve into neighbouring bins',
        v.phaseLock, (on) => { v.phaseLock = on; commitStretch(); });
      const alg = state.stretchDraft.algorithm;
      if (alg === 'pvsola' || alg === 'vocoder') {
        // Neither has a switch of its own, so slot 1 on the row is empty and
        // this sits there — beside the grain cloud rather than loose among the
        // sliders. Slot 1 packs from the left and the grain cloud follows it,
        // so the tuning and Keys keep the two places they always have.
        //
        // Hybrid keeps it in the panel: it already has `remake noise` on the
        // row, and two of its own switches plus the cloud, the tuning and Keys
        // is five buttons where the row holds four.
        phaseRow.dataset.slot = '1';
        engineSwitches().prepend(phaseRow);
      } else {
        own.appendChild(phaseRow);
      }

      ext.appendChild(wild('Spectrum',
        `The vocoder normally copies magnitudes through untouched and rewrites only phase. These do not.${what}`).add(
        tip(param('Freeze', v.magFreeze, 0, 1, 0.01,
          (x) => (x >= 0.999 ? 'held' : `${Math.round(x * 100)}%`),
          (x) => { v.magFreeze = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.magFreeze),
        'Hold the magnitude spectrum where it is instead of following the source. At 100% the sound stops changing timbre and only its phase keeps moving.'),
        tip(param('Blur', v.magBlur, 0, 1, 0.01, (x) => `${Math.round(x * 100)}%`,
          (x) => { v.magBlur = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.magBlur),
        "Smear each frame's magnitudes into neighbouring bins. Softens the edges between partials and turns a pitched sound toward noise."),
        tip(param('Gate', v.magGate, 0, 1, 0.01,
          (x) => (x <= 0 ? 'off' : `${Math.round(x * 100)}%`),
          (x) => { v.magGate = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.magGate),
        "Drop every bin below this share of the frame's loudest. Thins the sound to its strongest partials, and at high settings leaves a sparse, bell-like residue."),
      ));

      ext.appendChild(wild('Phase',
        `How the frequency estimate is believed and how far a peak imposes its phase on its neighbours.${what}`).add(
        tip(param('Freq trust', v.freqTrust, 0, 4, 0.01,
          (x) => (x <= 0.001 ? 'to bins' : `${x.toFixed(2)}×`),
          (x) => { v.freqTrust = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.freqTrust),
        "How far the frequency measured from the phase difference is believed over the bin's nominal centre. At zero every partial is forced onto its bin, which detunes the sound into a metallic grid."),
        tip(param('Phase spread', v.phaseSpread, 0, 4, 0.01, (x) => `${x.toFixed(2)}×`,
          (x) => { v.phaseSpread = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.phaseSpread),
        "How far a peak's phase correction reaches into the bins around it. This is what stops a partial dissolving into its neighbours as the stretch gets long."),
        tip(param('Peak width', v.peakWidth, 1, 16, 1, (x) => `${Math.round(x)} bin`,
          (x) => { v.peakWidth = Math.round(x); previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.peakWidth),
        'How many bins either side of a maximum count as belonging to it. Wider claims more of the spectrum for each peak, which holds thick tone together and blurs closely spaced partials.'),
        tip(param('Lock width', v.lockWidth, 0, 4, 0.01, (x) => `${x.toFixed(2)}×`,
          (x) => { v.lockWidth = x; previewStretch(); }, () => commitStretch(), false, VOCODER_DEFAULTS.lockWidth),
        'How strongly a peak imposes its phase on the bins it owns. Zero leaves each bin to itself, which is the classic phase vocoder and the classic phasiness.'),
        check('link stereo',
          'Move both channels by one shared correction, so the image survives the stretch instead of drifting apart',
          v.stereoLink, (on) => { v.stereoLink = on; commitStretch(); }),
      ));
    };

    // WSOLA's splice group, and its transient group when the detector is on.
    //
    // `forced` is for the hybrid, which turns transient preservation on and
    // keeps it on — an attack surviving at its original rate is the whole
    // reason that part was separated out. So there is no switch to show, but
    // the detector and its two constants are live and need reaching.
    const wsolaControls = ({ forced = false, what = '' } = {}) => {
      const w = state.stretchDraft.wsola;
      const detecting = forced || w.preserveTransients;
      if (!forced) {
        const ptRow = check('preserve transients',
          'Hold drum hits at their original rate so they are not laid down twice',
          w.preserveTransients,
          (on) => { w.preserveTransients = on; reflectEngine(); commitStretch(); });
        ptRow.dataset.slot = '1';
        engineSwitches().prepend(ptRow);
      }
      if (detecting) {
        own.appendChild(tip(param('Detector', w.sensitivity, 0, 1, 0.01,
          (x) => `${Math.round(x * 100)}%`,
          (x) => { w.sensitivity = x; previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.sensitivity),
        'How eager the onset detector is. Higher finds more hits to protect, including ones that are not really hits; lower protects only the clearest attacks.'));
      }

      ext.appendChild(wild('Splice',
        `How far the similarity search looks, what it goes looking for, and what the result is laid down under.${what}`).add(
        tip(param('Search', w.searchMs, 0, 200, 0.5,
          (x) => (x <= 0 ? 'plain OLA' : `${x.toFixed(1)} ms`),
          (x) => { w.searchMs = x; previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.searchMs),
        'How far either side of the ideal splice point the similarity search may look for a better join. At zero there is no search at all and this becomes plain overlap-add, which is where the flanging comes from.'),
        tip(seg('Pick', [
          ['similar', 'best', 'The segment that best continues what came before. What WSOLA is for.'],
          ['different', 'worst', 'The least similar segment the search can find, every time.'],
          ['loudest', 'loud', 'Un-normalised, so the search walks toward whatever is loudest nearby.'],
        ], w.splice, (x) => { w.splice = x; commitStretch(); }),
        'What the similarity search goes looking for. Only the first is trying to be transparent; the other two are the engine used as an instrument.'),
        tip(seg('Window', [
          ['hann', 'hann', 'Sums flat at 50% overlap, which is why it is the default.'],
          ['triangle', 'tri', 'Sums flat too, with a corner on every splice.'],
          ['rect', 'rect', 'No envelope. Every splice is a step, so the seams become a rhythm.'],
        ], w.shape, (x) => { w.shape = x; commitStretch(); }),
        'The envelope each spliced segment is laid down under. Hann and triangle both sum flat at the usual overlap; rect does not, which is the point of it.'),
        tip(param('Stride', w.stride, 1, 128, 1, (x) => `${Math.round(x)} fr`,
          (x) => { w.stride = Math.round(x); previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.stride),
        'How many frames the similarity search steps by as it looks. Bigger is cheaper and coarser - the join lands near the best place rather than on it.'),
      ));

      // Only reachable once the detector is running, so it appears with it.
      if (detecting) {
        ext.appendChild(wild('Transients',
          'What the detector counts as a hit, and how much either side of one is held at its original rate.').add(
          tip(param('Floor', w.floor, 0, 2, 0.01,
            (x) => (x <= 0 ? 'none' : `${x.toFixed(2)}×`),
            (x) => { w.floor = x; previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.floor),
        'How far above the local average a peak has to rise before it counts as a hit. Low finds hits everywhere, which protects so much of the sound that the stretch stops happening.'),
          tip(param('Guard', w.guardHops, 1, 16, 0.1, (x) => `${x.toFixed(1)} hop`,
            (x) => { w.guardHops = x; previewStretch(); }, () => commitStretch(), false, WSOLA_DEFAULTS.guardHops),
        'How many hops either side of a detected hit are held at the original rate, so the attack is not laid down twice or cut in half.'),
        ));
      }
    };

    // Three of the five do not run in the audio callback yet, so playback
    // approximates them with the grain cloud while export uses the real engine.
    // A control that quietly does something else is worse than one that says so.
    if (!LIVE_ENGINES.includes(alg)) {
      const note = document.createElement('p');
      note.className = 'engine-note';
      note.textContent = 'Rendered on export — playback approximates this with the grain cloud.';
      own.appendChild(note);
    }

    if (alg === 'vocoder') vocoderControls('');
    if (alg === 'wsola') wsolaControls();

    if (alg === 'pvsola') {
      const p = state.stretchDraft.pvsola;
      // One knob, and it really is the only one that matters: how long the
      // vocoder is allowed to run on its own guesses before being put back on
      // the ground. Everything else about this engine is the vocoder's, and
      // the vocoder's own panel is shown below it for that reason.
      own.appendChild(tip(param('Re-anchor', p.anchorFrames, 1, 64, 1,
        (x) => `${Math.round(x)} fr`,
        (x) => { p.anchorFrames = Math.round(x); previewStretch(); },
        () => commitStretch(), false, PVSOLA_DEFAULTS.anchorFrames),
        'How many analysis frames the vocoder is allowed to run on its own guesses before being spliced back onto the real waveform. Short kills phasiness and costs splices; long is the plain vocoder again.'));

      ext.appendChild(wild('Anchor',
        'How the splice back to the waveform is found and how it is joined. Both off is a hard cut every few frames, which you can hear as a rhythm.').add(
        tip(param('Search', p.searchMs, 0, 200, 0.5,
          (x) => (x <= 0 ? 'no search' : `${x.toFixed(1)} ms`),
          (x) => { p.searchMs = x; previewStretch(); }, () => commitStretch(), false, PVSOLA_DEFAULTS.searchMs),
        'How far the anchor search looks for the best place to splice back onto the waveform. At zero it joins wherever it lands, which you hear as a click every few frames.'),
        tip(param('Blend', p.blend, 0, 1, 0.01,
          (x) => (x <= 0 ? 'butt join' : `${Math.round(x * 100)}%`),
          (x) => { p.blend = x; previewStretch(); }, () => commitStretch(), false, PVSOLA_DEFAULTS.blend),
        'How much of the anchor is crossfaded rather than butt-joined. The fade is linear here, not equal power, because the search has just spent its whole effort making both sides correlated.'),
      ));

      // The vocoder is what is actually running between anchors, so all of its
      // controls are live here and all of them are shown. Not copies — the
      // same settings, reached from a second place.
      //
      // WSOLA's are deliberately absent: this engine finds its splice with its
      // own search, so the WSOLA panel's search, pick, window and stride do
      // not reach it. Showing them would be worse than not having them.
      vocoderControls(' Between anchors, this engine is the vocoder, so these are live here too.');
    }

    if (alg === 'hybrid') {
      const h = state.stretchDraft.hybrid;
      // The three levels are the reason to be in this engine rather than the
      // vocoder: nothing else here will turn a sound's air down without
      // touching its tone.
      own.appendChild(tip(param('Tone', h.harmonicLevel, 0, 2, 0.01,
        (x) => (x <= 0 ? 'out' : `${x.toFixed(2)}×`),
        (x) => { h.harmonicLevel = x; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.harmonicLevel),
        "The level of the harmonic part - the ridges that run along time. This is the reason to be in this engine: nothing else here will turn a sound's air down without touching its tone."));
      own.appendChild(tip(param('Hits', h.percussiveLevel, 0, 2, 0.01,
        (x) => (x <= 0 ? 'out' : `${x.toFixed(2)}×`),
        (x) => { h.percussiveLevel = x; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.percussiveLevel),
        'The level of the percussive part - the ridges that run across frequency. Attacks, clicks and transients, stretched by WSOLA with preservation held on.'));
      own.appendChild(tip(param('Air', h.residualLevel, 0, 2, 0.01,
        (x) => (x <= 0 ? 'out' : `${x.toFixed(2)}×`),
        (x) => { h.residualLevel = x; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.residualLevel),
        'The level of the residual - everything that is neither a partial nor a hit. Breath, hiss, room. This is the part Margin decides the existence of.'));
      own.appendChild(check('remake noise',
        'Rebuild the air as fresh noise shaped like the old, instead of stretching it. Off, it repeats at long ratios like every other engine here does',
        h.morphNoise, (on) => { h.morphNoise = on; commitStretch(); }));

      ext.appendChild(wild('Separation',
        'How the sound is cut into three. A partial is a ridge along time and a hit is a ridge across frequency; these decide how long and how broad each has to be to count.').add(
        tip(param('Hold', h.timeSpan, 3, 101, 2, (x) => `${Math.round(x) | 1} fr`,
          (x) => { h.timeSpan = Math.round(x) | 1; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.timeSpan),
        'How many frames long a ridge has to hold steady before it counts as a partial. Longer is stricter and sends more of the sound to the other two parts.'),
        tip(param('Spread', h.freqSpan, 3, 101, 2, (x) => `${Math.round(x) | 1} bin`,
          (x) => { h.freqSpan = Math.round(x) | 1; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.freqSpan),
        'How many bins wide a ridge has to be before it counts as a hit. Wider is stricter about what an attack is.'),
        tip(param('Margin', h.margin, 1, 8, 0.05,
          (x) => (x <= 1.001 ? 'no air' : `${x.toFixed(2)}×`),
          (x) => { h.margin = x; previewStretch(); }, () => commitStretch(), false, HYBRID_DEFAULTS.margin),
        'How much louder one part has to be than the other before it may claim a bin outright. At 1x nothing is left over and there is no Air at all - which is why the noise remaker then has nothing to work on.'),
        tip(param('Resolution', h.fftSize, 256, 8192, 256, (x) => `${Math.round(x)}`,
          (x) => { h.fftSize = Math.round(x); previewStretch(); }, () => commitStretch(), true, HYBRID_DEFAULTS.fftSize),
        'The transform size the separation runs at. Bigger tells partials apart more finely and blurs the timing of hits; the separation is a property of the sound, not of the stretch.'),
      ));

      // This engine runs both of the others, so both of their control sets are
      // live and both are shown — the vocoder shapes the tone, WSOLA shapes
      // the hits. The transient detector has no switch here because the hybrid
      // keeps it on: an attack surviving at its own rate is the whole reason
      // that part was separated out in the first place.
      vocoderControls(' Here they shape the tone, which is the part the vocoder is given.');
      wsolaControls({
        forced: true,
        what: ' Here they shape the hits, which is the part WSOLA is given.',
      });
    }

    // Grain shape and Pitch movement drive every engine now — a window is a
    // splice for WSOLA and an analysis frame for the vocoder, but all three
    // have a rate, a length, a place they read from and a speed they read at.
    for (const id of ['grainShape', 'grainPitch']) {
      $(id)?.classList.remove('hidden');
    }
    // Scan, Shape and Randomness reach all three engines: a window is a splice
    // for WSOLA and a frame for the vocoder, but each has a read pointer, a
    // direction, an envelope and a place in the field.
    $('extGrain')?.classList.remove('hidden');
    // Granular has no engine-specific extended groups, so this wrapper is empty
    // — and an empty flex child still takes the gap either side of it, which
    // showed as a band of nothing above the first heading.
    ext.classList.toggle('hidden', !ext.children.length);
    placeExtendedReset();
  };
  for (const b of eng.querySelectorAll('.seg-btn')) {
    b.onclick = () => {
      state.stretchDraft.algorithm = b.dataset.alg;
      reflectEngine();
      commitStretch();
    };
    // Double-click resets everything, standard and extended, which is what the
    // button that used to sit at the end of this row did.
    //
    // The engine you land on is where you were already going: the first click
    // selects, and reset deliberately does not move you somewhere else — see
    // `resetEverything`. So double-clicking the tab you are on resets in place,
    // and double-clicking another one arrives there with the controls fresh.
    //
    // Undoable like any other edit, because it goes through `editOp`.
    b.ondblclick = () => { resetEverything(); };
  }
  reflectEngine();


  const rows = {};
  rows.ratio = tip(param('Stretch', st.ratio, 0.01, 100, 0.01,
    (v) => (v >= 10 ? `${v.toFixed(0)}×` : v >= 1 ? `${v.toFixed(2)}×` : `${v.toFixed(3)}×`),
    (v) => { state.stretchDraft.ratio = v; showStretchOut(); previewStretch();  },
    () => {commitStretch();}, true, 1),
        'How much longer the result is than the source. 1x is untouched, 0.5x is half the length, 100x is the point of a granular stretcher. Logarithmic, so the everyday range is not squeezed into the first tenth of the slider.');
  // The step is the finest the *scale* offers, so dragging cannot land
  // between two degrees and then be snapped back on release. With no scale
  // chosen it stays where it has always been: half a semitone.
  rows.semitones = tip(param('Pitch', st.semitones, -48, 48, scaleStep(),
    (v) => scaleLabel(v),
    (v) => { state.stretchDraft.semitones = v; previewStretch();  },
    () => {commitStretch();}, false, 0),
        'Shifts the pitch without changing the length. The engine is driven at ratio x pitch and the result read back that much faster, and the two length changes cancel. Twelve semitones is an octave. The tuning it snaps to is chosen on the row above.');
  // Log too: 40 ms is the everyday setting and second-long grains are the
  // extreme, so a linear control would bunch the useful range at one end.
  rows.windowMs = tip(param('Window', st.windowMs, 5, 2000, 1, (v) => `${Math.round(v)} ms`,
    (v) => { state.stretchDraft.windowMs = v; previewStretch();  },
    () => {commitStretch();}, true, 40),
        'The length of one piece the engine works with - a splice for WSOLA, a grain for the cloud. Short follows transients and roughens tone; long holds tone together and smears attacks.');

  // Into the core host, which sits directly under the button row — not appended
  // to the end of the panel, which is what put them below the engine's own
  // sliders.
  const core = box.querySelector('.stretch-core') || box;
  core.innerHTML = '';
  for (const el of Object.values(rows)) core.appendChild(el);
  state.stretchRows = rows;
  showStretchOut();
}

/// The granular controls. Separate from the stretch sliders because they only
/// matter once one of them is engaged, but built the same way.
function renderGrainParams() {
  if (!$('grainShape')) return;
  const g = state.edit?.stretch?.grain;
  const path = state.selectedFile?.path || null;
  if (!g) { grainBuiltFor = null; return; }
  // Keyed on the engine as well as the file: the sixth engine adds two rows of
  // its own, so switching to or from it has to rebuild the panel. Keying on the
  // file alone meant they only appeared after opening a different sound.
  const alg = state.edit?.stretch?.algorithm || '';
  const key = `${path}\u0000${alg}`;
  if (grainBuiltFor === key) return;

  grainBuiltFor = key;
  const shape = $('grainShape');
  const pitchBox = $('grainPitch');
  shape.innerHTML = ''; pitchBox.innerHTML = '';
  // The seed has no control of its own. It stays part of the document and is
  // carried through untouched by this spread, so the engine keeps using it.
  state.grainDraft = { ...g };

  const send = ({ live }) => {
    editOp({ op: 'stretch',
             ratio: state.stretchDraft.ratio,
             semitones: state.stretchDraft.semitones,
             windowMs: state.stretchDraft.windowMs,
             quality: live ? 'draft' : state.stretchDraft.quality,
             algorithm: state.stretchDraft.algorithm,
             vocoder: state.stretchDraft.vocoder,
             wsola: state.stretchDraft.wsola,
             pvsola: state.stretchDraft.pvsola,
             hybrid: state.stretchDraft.hybrid,
             grain: state.grainDraft },
           { live });
  };
  const preview = throttled(() => send({ live: true }), 90);
  const commit = () => send({ live: false });
  // Reachable from the cloud pad, which moves these same values by dragging.
  state.grainSend = { preview, commit };

  // Grouped by what they do, so each panel stays short enough to read at once.
  const groups = [
    [shape, 'Grain shape',
     'How often something is laid down, how long it is, how many of them, and how much any of that varies. Every engine answers these — a window is a splice for WSOLA and an analysis frame for the vocoder.', [
      ['Position', 'position', -1, 1, 0.001, (v) => `${(v * 100).toFixed(1)}%`,
       'Where in the source the cloud reads from, as a fraction of the file. Measured from where the sweep begins — the start going forwards, the end going backwards — so zero is the ordinary sweep. Turn Scan down to nothing and this is the whole instrument: the read head parks wherever you put it and the cloud is made from that one place. Automate it and the head skips around under its own hand.'],
      ['Rate', 'rateHz', 0, 500, 1, (v) => (v <= 0 ? 'off' : `${Math.round(v)}/s`),
       'Grains per second, for the cloud alone — how often a grain is thrown, with nothing to do with how long it lasts. A grain is an event: it is spawned, it sounds for as long as it sounds, and it ends, and none of that waits on the one before it. So the same number are laid down every second whether they are five milliseconds long or two. Off, the old rule applies and the rate comes from the window instead, which is why lengthening a grain used to thin the cloud. This control is the cloud’s own and does not touch WSOLA, the vocoder, PVSOLA or the hybrid — Density does, and reaching into them is what it costs.'],
      ['Density', 'densityHz', 0, 500, 1, (v) => (v <= 0 ? 'auto' : `${Math.round(v)}/s`),
       'How often a window is laid down, in windows per second. Read by every engine, so it is the *window* engines’ control as much as the cloud’s; for the cloud alone use Rate above. On “auto” the rate comes from the window length divided by Overlap instead, which is what keeps the sound even as the window changes.'],
      ['Layers', 'layers', 1, 64, 1, (v) => `${Math.round(v)}×`,
       'How many copies of the whole engine run at once, each reading its own place in the source. Level is compensated by the square root of the count, which is exact once Scatter or the jitters have decorrelated them. The ceiling is sixty-four; what stops you before that is the machine, and the load line says so — if it reads fewer running than asked for, the engine is shedding layers to keep the sound whole rather than refusing them.'],
      ['Overlap', 'overlap', 1, 8, 0.1, (v) => `${v.toFixed(1)}×`,
       'How many windows cover any one moment. Only read while Density is on “auto”. More overlap is smoother and more expensive; at 1x the windows are laid end to end.'],
      ['Size jitter', 'sizeJitter', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`,
       'How much each window’s length varies around Window. Size range sets how far the variation may reach.'],
      ['Position jitter', 'positionJitterMs', 0, 500, 1, (v) => `${Math.round(v)} ms`,
       'How far each window may be thrown from the instant it should have read. This is what turns a line of windows into a cloud.'],
    ]],
    [pitchBox, 'Pitch movement',
     'Pitch that changes while the sound plays, as against the fixed shift on the Pitch slider. Jitter is per grain; drift is shared by the whole cloud.', [
      ['Pitch jitter', 'pitchJitterSemis', 0, 24, 0.1, (v) => `±${v.toFixed(1)} st`,
       'A fresh random shift for every grain, up to this far either way. Small amounts thicken; large amounts scatter the sound across the keyboard.'],
      ['Pitch drift', 'pitchDriftSemis', 0, 24, 0.1, (v) => `±${v.toFixed(1)} st`,
       'A slow wander in pitch shared by the whole cloud, up to this far either way. Vibrato at the small end, seasickness at the large.'],
      ['Drift rate', 'driftRateHz', 0.01, 10, 0.01, (v) => `${v.toFixed(2)} Hz`,
       'How fast that wander moves, in cycles per second. “Step the drift” turns the glide into jumps.'],
    ]],
  ];

  state.grainRows = {};
  for (const [target, heading, blurb, rows] of groups) {
    const group = wild(heading, blurb);
    for (const [label, key, min, max, step, fmt, hint] of rows) {
      const el = tip(param(label, g[key], min, max, step, fmt,
        (v) => { state.grainDraft[key] = v; preview();  },
        () => {commit();}, false, GRAIN_DEFAULTS[key]), hint);
      state.grainRows[key] = el;
      group.add(el);
    }
    target.appendChild(group);
  }

  /// `detent` is a value the control snaps to when it comes close.
  ///
  /// For a control whose middle means something. Envelope's 0.5 is the only
  /// value that gives a pure Hann — every other setting warps the shape — so
  /// "symmetric" is not one label of three, it is *the* shape the other two are
  /// departures from.
  ///
  /// **The band is sized in pixels, not in steps**, because these sliders are
  /// 56 px wide. At a step of 0.01 that is half a pixel per step: exactly one
  /// position out of a hundred and one gave a Hann, and no hand can land on it.
  /// A first attempt at this snapped within two steps and was still barely more
  /// than a pixel — measurably better and still unusable. Six per cent of the
  /// range is about three and a half pixels either side, which is a target.
  const DETENT_FRAC = 0.06;
  const gp = (label, key, min, max, step, fmt, log, detent) => {
    const band = (max - min) * DETENT_FRAC;
    const snap = (v) =>
      (detent !== undefined && Math.abs(v - detent) <= band ? detent : v);
    const el = param(label, state.grainDraft[key], min, max, step, fmt,
      (v) => {
        const s = snap(v);
        // Move the handle too when it snapped, or the reading and the control
        // disagree — which is the fault this whole panel was audited for.
        if (s !== v) el.sync(s);
        state.grainDraft[key] = s;
        preview();
      },
      (v) => { state.grainDraft[key] = snap(v); commit(); }, log,
      GRAIN_DEFAULTS[key]);
    state.grainRows[key] = el;
    return el;
  };
  const gc = (label, key, title) => {
    const el = check(label, title, state.grainDraft[key],
      (on) => { state.grainDraft[key] = on; commit(); });
    state.grainRows[key] = el;
    return el;
  };

  // The extended grain controls join the engines' in the one column, rather
  // than hiding at the bottom of two different panels.
  const extGrain = $('extGrain');
  extGrain.innerHTML = '';

  // The read pointer's relationship to the ratio, which is what makes a stretch
  // a stretch. Severing it is the difference between a granular stretcher and a
  // granular instrument.
  extGrain.appendChild(wild('Scan',
    'Where in the source the cloud reads from, and which way each grain runs.').add(
    tip(gp('Scan', 'scan', -2, 2, 0.01,
      (v) => (Math.abs(v) < 0.005 ? 'frozen' : `${v.toFixed(2)}×`)),
        'How fast the read pointer moves through the source relative to the output. 1x is an ordinary stretch, 0 freezes on one instant, and negative runs the source backwards under a forward-moving cloud. Severing this from the ratio is the difference between a stretcher and an instrument.'),
    pair(
      gc('reverse grains', 'reverse',
        'Each grain reads its own span backwards. The cloud still moves forward.'),
      gc('wrap positions', 'wrap',
        'A grain pushed past the end of the file reappears at the beginning instead of piling up against it.'),
    ),
  ));

  extGrain.appendChild(wild('Shape',
    'The grain envelope, how far sizes may reach, and where the layers sit.').add(
    tip(gp('Envelope', 'envelope', 0, 1, 0.01,
      (v) => {
        const word = Math.abs(v - 0.5) < 0.005 ? 'symmetric' : v < 0.5 ? 'percussive' : 'swelling';
        // The word alone hides how far from symmetric it is; Modern says both.
        return grainUiModern() && word !== 'symmetric' ? `${v.toFixed(2)} ${word}` : word;
      },
      false, 0.5),
        'The shape each window is laid down under. Symmetric is a bell; percussive is a sharp attack and a long tail; swelling is the reverse.'),
    tip(gp('Size range', 'sizeRange', 1, 8, 0.05, (v) => `${v.toFixed(2)}×`),
        'How far Size jitter is allowed to reach, as a multiple of the window. Inert until there is some jitter to reach with.'),
    tip(gp('Layer spread', 'layerSpread', 0, 4, 0.01,
      (v) => (v <= 0.005 ? 'stacked' : `${v.toFixed(2)}×`)),
        'How far each layer is delayed behind the one before, as a share of a hop. It is also what keeps sixteen layers from all transforming on the same block.'),
    tip(gp('Pan spread', 'panSpread', 0, 1, 0.01, (v) => (v <= 0 ? 'centred' : `${Math.round(v * 100)}%`)),
        'How far apart the grains are placed across the stereo field. At zero everything is centred.'),
  ));

  // Layers on their own are a delay line, not a cloud: without this every
  // layer reads the same instant and is laid down a fixed offset later, and
  // regular delays make regular notches. These two throw each layer somewhere
  // else in the source so the layers are different audio rather than copies.
  extGrain.appendChild(wild('Layer scatter',
    'How far each layer is thrown from the others. At zero they all read the same instant and comb; turned up they read their own places and sum like a crowd. Reaches every engine.').add(
    tip(gp('Scatter', 'layerScatter', 0, 1, 0.01,
      (v) => (v <= 0 ? 'stacked' : `${Math.round(v * 100)}%`)),
        'How far each layer is thrown from the others. At zero every layer reads the same instant and the stack is a delay line, which combs - sixteen layers made the sound thinner, not fuller. Turned up they read their own places and sum like a crowd. Layer zero never moves.'),
    // Log, because the useful range is tens of milliseconds — a chorus — and
    // the far end is a second, which is a wash. Linear would bunch everything
    // worth reaching into the first tenth of the slider.
    tip(gp('Range', 'layerScatterMs', 1, 2000, 1,
      (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`), true),
        'How far a thrown layer may land from where it would otherwise have read. Tens of milliseconds is a chorus; a second is a wash. Logarithmic, because everything worth reaching is at the bottom of the range.'),
  ));

  // The seed used to have no control at all. It is the one value here that
  // changes everything at once without changing any setting.
  const seedRow = document.createElement('div');
  seedRow.className = 'param seed-row';
  seedRow.innerHTML = `<span class="k">Seed</span>
    <button class="ghost">Re-roll</button>
    <span class="v"></span>`;
  tip(seedRow,
    'The number every random choice here is drawn from. Each jitter is a pure function of the grain index and this seed, never a running generator — which is what makes the picture, the playback and the exported file the same sound. Re-roll re-deals the whole cloud without moving a single slider.');
  seedRow.querySelector('button').title =
    'Draw a new seed. Every jitter changes at once; no setting does.';
  const showSeed = () => {
    seedRow.querySelector('.v').textContent = state.grainDraft.seed;
  };
  seedRow.querySelector('button').onclick = () => {
    // Every jitter is a pure function of the grain index and this number, so
    // one new number re-deals the whole cloud without moving a single slider.
    state.grainDraft.seed = (state.grainDraft.seed * 1664525 + 1013904223) % 2147483647;
    showSeed();
    commit();
  };
  showSeed();
  seedRow.sync = showSeed;
  state.grainRows.seed = seedRow;

  extGrain.appendChild(wild('Randomness',
    'Where the per-grain variation comes from, and whether the streams move together.').add(
    pair(
      gc('link jitter', 'linkJitter',
        'Size, position and pitch draw from one stream instead of three, so they vary together.'),
      gc('step the drift', 'driftStep',
        'Drift jumps between values instead of gliding through them.'),
    ),
    seedRow,
  ));

  // This rebuild replaced whatever the reset was sitting on.
  placeExtendedReset();
  // The pad draws the source behind the cloud, and that envelope is fetched
  // once per file by the same call the automation lanes use.
  loadLaneWave();
  wireCloudPad();
  drawCloudPads();
  if (typeof composeGrainSync === 'function') composeGrainSync();
}

let grainBuiltFor = null;

function syncGrainSliders() {
  const g = state.edit?.stretch?.grain;
  if (!g || !state.grainRows) return;
  state.grainDraft = { ...g };
  for (const [k, el] of Object.entries(state.grainRows)) el.sync(g[k]);
  drawCloudPads();
  if (typeof composeGrainSync === 'function') composeGrainSync();
}

/// Push values into the sliders — used by Reset and Undo, which change the
/// document without the pointer having touched anything.
function syncStretchSliders() {
  const st = state.edit?.stretch;
  if (!st || !state.stretchRows) return;
  state.stretchDraft = { ...state.stretchDraft, ratio: st.ratio,
                         semitones: st.semitones, windowMs: st.windowMs };
  state.stretchRows.ratio.sync(st.ratio);
  state.stretchRows.semitones.sync(st.semitones);
  state.stretchRows.windowMs.sync(st.windowMs);
  if (st.quality) state.stretchDraft.quality = st.quality;

  syncGrainSliders();
  showStretchOut();
}

function showStretchOut() {
  const el = $('stretchOut');
  if (!el || !state.edit) return;
  const sr = state.view.sampleRate || 48000;
  const d = state.stretchDraft || {};
  const base = state.edit.baseFrames / sr;
  const out = (state.edit.baseFrames * (d.ratio ?? 1)) / sr;
  const semis = d.semitones ?? 0;
  const pitch = Math.abs(semis) < 0.05
    ? ''
    : ` · pitch ${semis > 0 ? '+' : ''}${semis.toFixed(1)} st`;
  el.textContent = `${base.toFixed(2)}s → ${out.toFixed(2)}s${pitch}`;
  el.title = 'Source length, then the length this will render to, and the pitch shift if there is one. '
    + 'The length follows the Stretch slider alone — pitch does not change it. '
    + 'It dims while the waveform is still catching up with the controls.';
  paintLoad();
  if (typeof composeGrainSync === 'function') composeGrainSync();
}

/// What the engine is costing, beside the controls that cost it.
///
/// Window, layers and density are each monotonic in block cost and they
/// multiply, and no one control knows what the others are set to — so three
/// sliders that each look affordable land somewhere unplayable, with nothing on
/// screen saying so until the sound breaks up. A 300-render sweep put the
/// median randomised hybrid at three times real time. See
/// `docs/GLITCH-SWEEP.md`.
///
/// Measured in the callback, not predicted from the controls: a model would
/// need refitting every time the DSP changed and would still be guessing about
/// this machine.
function paintLoad() {
  const el = $('engineLoad');
  if (!el) return;
  const l = engine.load;
  if (!l || !engine.playing) { el.textContent = ''; el.className = 'mono dim engine-load'; return; }

  // The worst block, not the average. A mean of 40% with a spike to 150% is a
  // click every few seconds, and the mean is what hides it.
  const pct = Math.round(l.worst * 100);
  // What the governor has done, if anything. A program that quietly plays fewer
  // layers than the control says is lying about its own settings, so this is
  // said out loud rather than left to be noticed.
  const asked = state.grainDraft?.layers ?? 1;
  const thinned = asked > 1 && l.layersRunning > 0 && l.layersRunning < asked;
  el.textContent = thinned ? `load ${pct}% · ${l.layersRunning}/${asked} layers` : `load ${pct}%`;
  el.className = 'mono engine-load'
    + (thinned || l.worst >= 1 ? ' over' : l.worst >= 0.75 ? ' near' : ' dim');
  el.title = `The worst block since this was last reset, as a share of the time that block had to play for.\n`
    + `Now ${Math.round(l.now * 100)}% · average ${Math.round(l.mean * 100)}% · worst ${pct}%`
    + (l.late ? `\n${l.late} block${l.late === 1 ? '' : 's'} missed the deadline — that is what a dropout is.` : '')
    + (thinned
      ? `\n\nRunning ${l.layersRunning} of the ${asked} layers asked for: the engine could not make `
        + 'blocks fast enough, and a thinner cloud is better than a dropout. It takes them back on '
        + 'its own once there is room, or immediately if you open another sound.'
        + '\n\nShift-click to stop it doing that — the engine will then play every layer you ask '
        + 'for and let the sound break if it cannot.'
      : '')
    + '\nClick to forget the worst; it only means anything next to a change you just made.';
  el.onclick = async (e) => {
    if (noAudio()) return;
    // **Shift-click is the switch.** It sits on the readout that shows the
    // shedding rather than in a settings panel somewhere else, because the
    // moment you want it off is the moment you are looking at "5 of 12" — and
    // a switch you have to go and find is one you do not know exists.
    if (e.shiftKey) {
      const want = !roomShedLayers();
      try {
        const r = await postJSON('/api/engine/shed', { on: want });
        setRoomShedLayers(!!r.shedding);
        toast(r.shedding
          ? 'Layers will be shed when the engine cannot keep up'
          : 'Every layer will be played, even if the sound breaks');
      } catch { /* not playing */ }
      return;
    }
    try { await postJSON('/api/engine/load/reset', {}); } catch { /* not playing */ }
  };
}

/// Whether the engine may take layers away when it cannot keep up.
///
/// **Off by default**, which is the engine playing what the control says. Kept
/// in the browser like every other preference about how the program behaves,
/// and pushed at the engine whenever a sound is opened — the flag lives on the
/// audio thread's shared state and a fresh engine starts from its own default,
/// so without re-sending it the setting would quietly lapse on the next file.
const SHED_STORE = 'engineShedLayers';

function roomShedLayers() {
  try { return localStorage.getItem(SHED_STORE) === '1'; } catch { return false; }
}

function setRoomShedLayers(on) {
  try { localStorage.setItem(SHED_STORE, on ? '1' : '0'); } catch { /* private mode */ }
}

async function pushShedLayers() {
  if (noAudio()) return;
  try { await postJSON('/api/engine/shed', { on: roomShedLayers() }); }
  catch { /* nothing open yet */ }
}

