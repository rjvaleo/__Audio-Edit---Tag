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
    [shape, 'Grains',
     'How often something is laid down, how long it is, how many of them, and how much any of that varies. Every engine answers these — a window is a splice for WSOLA and an analysis frame for the vocoder.', [
      ['Position', 'position', -1, 1, 0.001, (v) => `${(v * 100).toFixed(1)}%`,
       'Where in the source the cloud reads from, as a fraction of the file. Measured from where the sweep begins — the start going forwards, the end going backwards — so zero is the ordinary sweep. Turn Scan down to nothing and this is the whole instrument: the read head parks wherever you put it and the cloud is made from that one place. Automate it and the head skips around under its own hand.'],
      ['Rate', 'rateHz', 0, 500, 1, (v) => (v <= 0 ? 'off' : `${Math.round(v)}/s`),
       'Grains per second, for the cloud alone — how often a grain is thrown, with nothing to do with how long it lasts. A grain is an event: it is spawned, it sounds for as long as it sounds, and it ends, and none of that waits on the one before it. So the same number are laid down every second whether they are five milliseconds long or two. Off, the old rule applies and the rate comes from the window instead, which is why lengthening a grain used to thin the cloud. This control is the cloud’s own and does not touch WSOLA, the vocoder, PVSOLA or the hybrid — Density does, and reaching into them is what it costs.'],
      ['Density', 'densityHz', 0, 500, 1, (v) => (v <= 0 ? 'auto' : `${Math.round(v)}/s`),
       'How often a window is laid down, in windows per second. Read by every engine, so it is the *window* engines’ control as much as the cloud’s; for the cloud alone use Rate above. On “auto” the rate comes from the window length divided by Overlap instead, which is what keeps the sound even as the window changes.'],
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
  seedRow.read = () => state.grainDraft.seed;
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

  // Where each control lives (RJ, 4 Nov 2026): the rows above are built in
  // the groups they always were, and moved here into the sections they belong
  // to. The whole of this panel is rebuilt together, so nothing is left behind.
  //
  //   Grains          gains the grain's own shape — Envelope, Size range — and
  //                   how it reads: Scan, reverse grains, wrap positions.
  //   Pitch movement  gains step the drift.
  //   Feedback        is new: the cloud re-reading what it just played.
  //   Layers          is every control about the layers and where they sit.
  //   Randomness      keeps the seed and link jitter.
  {
    const R = state.grainRows;
    const grains = shape.querySelector('.wild');
    R.position.after(R.positionJitterMs);
    R.sizeJitter.before(R.envelope);
    R.sizeJitter.after(R.sizeRange);
    grains.add(R.scan, R.reverse, R.wrap);
    pitchBox.querySelector('.wild').add(R.driftStep);

    const feedback = wild('Feedback',
      'The cloud re-reads what it has just played: each new grain takes in some of the last few moments of the cloud as well as the sound, so grains are made of earlier grains and the cloud keeps sounding after the source moves on. Every pass is quieter, so it fades.').add(
      tip(gp('Feedback', 'fbAmount', 0, 0.95, 0.01, (v) => (v <= 0 ? 'off' : `${Math.round(v * 100)}%`)),
        'How much of each pass comes round again. Off is the cloud as it was; near the top the returns pile up into a texture that outlasts the sound.'),
      tip(gp('Time', 'fbTimeMs', 20, 2000, 1, (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`), true),
        'How far back the loop reaches. Short is a shimmer on every grain; long is separate returns.'),
      tip(gp('Smear', 'fbSmear', 0, 1, 0.01, (v) => (v <= 0 ? 'clear' : `${Math.round(v * 100)}%`)),
        'Diffusion inside the loop. Clear repeats at nothing; turned up, each pass blurs into the next until the returns run together into a smear.'),
      tip(gp('Damp', 'fbDamp', 0, 1, 0.01, (v) => (v <= 0 ? 'bright' : `${Math.round(v * 100)}%`)),
        'A high cut inside the loop, so each pass is darker than the last and the tail fades into mist rather than hiss.'),
      // In the tuning chosen on Time & pitch, as Pitch is (RJ, 4 Nov 2026):
      // it steps through that scale's degrees, and the server snaps it there.
      tip(gp('Shift', 'fbShift', -12, 12, scaleStep(), (v) => (Math.abs(v) < 0.005 ? 'none' : `${v > 0 ? '+' : ''}${v.toFixed(2)} st`)),
        'Moves each pass in pitch, so the returns climb (a shimmer) or fall — by degrees of the tuning chosen on Time & pitch.'),
      ggTag(gc('hold the loop', 'fbHold',
        'Nothing new goes in, and what is in the loop goes round at full level: an endless pad from the last few moments.'), 'fbHold'),
    );
    const layers = wild('Layers',
      'How many copies of the cloud run at once, how they sit in time, how far each is thrown from the others, and where they sit across the stereo field.').add(
      tip(gp('Layers', 'layers', 1, 64, 1, (v) => `${Math.round(v)}×`),
        'How many copies of the whole engine run at once, each reading its own place in the source. Level is compensated by the square root of the count, which is exact once Scatter or the jitters have decorrelated them. The ceiling is sixty-four; what stops you before that is the machine, and the load line says so.'),
      R.layerSpread, R.layerScatter, R.layerScatterMs, R.panSpread,
    );
    const randomness = [...extGrain.children].find((el) => el.querySelector(':scope > .wild-head')?.textContent === 'Randomness');
    randomness.before(feedback, layers);
    // The seed first, link jitter beside it.
    randomness.body.prepend(R.seed);
    randomness.body.appendChild(R.linkJitter);
    // The groups the rows came from are empty now.
    for (const el of extGrain.querySelectorAll('.param-pair')) if (!el.children.length) el.remove();
    for (const el of [...extGrain.children]) if (el.matches('.wild') && !el.querySelector('.param')) el.remove();
  }

  syncCloudOnly();
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

