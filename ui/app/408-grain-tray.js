// ================================================================ Grain: the tray's
//
// What the old tray did that is not a control's value: every control's own
// explanation, the arrow keys, painting across the bars, the CLOUD presets, the
// file's facts, the length readout, Follow, the markers and regions on the
// overview, and scrubbing. Where the tray's own element can do the work it is
// pressed, so what happens is the tray's.

/// Each control's explanation, as the tray has it.
const GS_TIPS = {
  ratio: "How much longer the result is than the source. 1x is untouched, 0.5x is half the length, 100x is the point of a granular stretcher. Logarithmic, so the everyday range is not squeezed into the first tenth of the slider.",
  semitones: "Shifts the pitch without changing the length. The engine is driven at ratio x pitch and the result read back that much faster, and the two length changes cancel. Twelve semitones is an octave. The tuning it snaps to is chosen on the row above.",
  windowMs: "The length of one piece the engine works with - a splice for WSOLA, a grain for the cloud. Short follows transients and roughens tone; long holds tone together and smears attacks.",
  cloud: "Run the grain cloud over this engine, reading the same source at the same stretch",
  positionJitterMs: "How far each window may be thrown from the instant it should have read. This is what turns a line of windows into a cloud.",
  densityHz: "How often a window is laid down, in windows per second. Read by every engine, so it is the *window* engines’ control as much as the cloud’s; for the cloud alone use Rate above. On “auto” the rate comes from the window length divided by Overlap instead, which is what keeps the sound even as the window changes.",
  overlap: "How many windows cover any one moment. Only read while Density is on “auto”. More overlap is smoother and more expensive; at 1x the windows are laid end to end.",
  envelope: "The shape each window is laid down under. Symmetric is a bell; percussive is a sharp attack and a long tail; swelling is the reverse.",
  sizeJitter: "How much each window’s length varies around Window. Size range sets how far the variation may reach.",
  sizeRange: "How far Size jitter is allowed to reach, as a multiple of the window. Inert until there is some jitter to reach with.",
  scan: "How fast the read pointer moves through the source relative to the output. 1x is an ordinary stretch, 0 freezes on one instant, and negative runs the source backwards under a forward-moving cloud. Severing this from the ratio is the difference between a stretcher and an instrument.",
  reverse: "Each grain reads its own span backwards. The cloud still moves forward.",
  wrap: "A grain pushed past the end of the file reappears at the beginning instead of piling up against it.",
  pitchJitterSemis: "A fresh random shift for every grain, up to this far either way. Small amounts thicken; large amounts scatter the sound across the keyboard.",
  pitchDriftSemis: "A slow wander in pitch shared by the whole cloud, up to this far either way. Vibrato at the small end, seasickness at the large.",
  driftRateHz: "How fast that wander moves, in cycles per second. “Step the drift” turns the glide into jumps.",
  driftStep: "Drift jumps between values instead of gliding through them.",
  searchMs: "How far either side of the ideal splice point the similarity search may look for a better join. At zero there is no search at all and this becomes plain overlap-add, which is where the flanging comes from.",
  splicePick: "What the similarity search goes looking for. Only the first is trying to be transparent; the other two are the engine used as an instrument.",
  spliceShape: "The envelope each spliced segment is laid down under. Hann and triangle both sum flat at the usual overlap; rect does not, which is the point of it.",
  stride: "How many frames the similarity search steps by as it looks. Bigger is cheaper and coarser - the join lands near the best place rather than on it.",
  preserveTransients: "Hold drum hits at their original rate so they are not laid down twice",
  fbAmount: "How much of each pass comes round again. Off is the cloud as it was; near the top the returns pile up into a texture that outlasts the sound.",
  fbTimeMs: "How far back the loop reaches. Short is a shimmer on every grain; long is separate returns.",
  fbSmear: "Diffusion inside the loop. Clear repeats at nothing; turned up, each pass blurs into the next until the returns run together into a smear.",
  fbDamp: "A high cut inside the loop, so each pass is darker than the last and the tail fades into mist rather than hiss.",
  fbShift: "Moves each pass in pitch, so the returns climb (a shimmer) or fall — by degrees of the tuning chosen on Time & pitch.",
  fbHold: "Nothing new goes in, and what is in the loop goes round at full level: an endless pad from the last few moments.",
  layers: "How many copies of the whole engine run at once, each reading its own place in the source. Level is compensated by the square root of the count, which is exact once Scatter or the jitters have decorrelated them. The ceiling is sixty-four; what stops you before that is the machine, and the load line says so.",
  layerSpread: "How far each layer is delayed behind the one before, as a share of a hop. It is also what keeps sixteen layers from all transforming on the same block.",
  layerScatter: "How far each layer is thrown from the others. At zero every layer reads the same instant and the stack is a delay line, which combs - sixteen layers made the sound thinner, not fuller. Turned up they read their own places and sum like a crowd. Layer zero never moves.",
  layerScatterMs: "How far a thrown layer may land from where it would otherwise have read. Tens of milliseconds is a chorus; a second is a wash. Logarithmic, because everything worth reaching is at the bottom of the range.",
  panSpread: "How far apart the grains are placed across the stereo field. At zero everything is centred.",
  seed: "The number every random choice here is drawn from. Each jitter is a pure function of the grain index and this seed, never a running generator — which is what makes the picture, the playback and the exported file the same sound. Re-roll re-deals the whole cloud without moving a single slider.",
  linkJitter: "Size, position and pitch draw from one stream instead of three, so they vary together.",
  cloudMix: "How much cloud against the engine underneath. Equal power, so the middle is not a dip — the two are decorrelated and a straight crossfade would sag there.",
  position: "Where in the source the cloud reads from, as a fraction of the file. Measured from where the sweep begins — the start going forwards, the end going backwards — so zero is the ordinary sweep. Turn Scan down to nothing and this is the whole instrument: the read head parks wherever you put it and the cloud is made from that one place. Automate it and the head skips around under its own hand.",
  rateHz: "Grains per second, for the cloud alone — how often a grain is thrown, with nothing to do with how long it lasts. A grain is an event: it is spawned, it sounds for as long as it sounds, and it ends, and none of that waits on the one before it. So the same number are laid down every second whether they are five milliseconds long or two. Off, the old rule applies and the rate comes from the window instead, which is why lengthening a grain used to thin the cloud. This control is the cloud’s own and does not touch WSOLA, the vocoder, PVSOLA or the hybrid — Density does, and reaching into them is what it costs.",
  vocWindowMs: "The length of one transform, rounded to a power of two. Long resolves partials that sit close together and smears transients; short does the opposite. This is the vocoder's own window and means something different from the one above.",
  magFreeze: "Hold the magnitude spectrum where it is instead of following the source. At 100% the sound stops changing timbre and only its phase keeps moving.",
  magBlur: "Smear each frame's magnitudes into neighbouring bins. Softens the edges between partials and turns a pitched sound toward noise.",
  magGate: "Drop every bin below this share of the frame's loudest. Thins the sound to its strongest partials, and at high settings leaves a sparse, bell-like residue.",
  freqTrust: "How far the frequency measured from the phase difference is believed over the bin's nominal centre. At zero every partial is forced onto its bin, which detunes the sound into a metallic grid.",
  phaseSpread: "How far a peak's phase correction reaches into the bins around it. This is what stops a partial dissolving into its neighbours as the stretch gets long.",
  peakWidth: "How many bins either side of a maximum count as belonging to it. Wider claims more of the spectrum for each peak, which holds thick tone together and blurs closely spaced partials.",
  lockWidth: "How strongly a peak imposes its phase on the bins it owns. Zero leaves each bin to itself, which is the classic phase vocoder and the classic phasiness.",
  phaseLock: "Holds each partial together instead of letting it dissolve into neighbouring bins",
  stereoLink: "Move both channels by one shared correction, so the image survives the stretch instead of drifting apart",
  anchorFrames: "How many analysis frames the vocoder is allowed to run on its own guesses before being spliced back onto the real waveform. Short kills phasiness and costs splices; long is the plain vocoder again.",
  anchorSearchMs: "How far the anchor search looks for the best place to splice back onto the waveform. At zero it joins wherever it lands, which you hear as a click every few frames.",
  blend: "How much of the anchor is crossfaded rather than butt-joined. The fade is linear here, not equal power, because the search has just spent its whole effort making both sides correlated.",
  harmonicLevel: "The level of the harmonic part - the ridges that run along time. This is the reason to be in this engine: nothing else here will turn a sound's air down without touching its tone.",
  percussiveLevel: "The level of the percussive part - the ridges that run across frequency. Attacks, clicks and transients, stretched by WSOLA with preservation held on.",
  residualLevel: "The level of the residual - everything that is neither a partial nor a hit. Breath, hiss, room. This is the part Margin decides the existence of.",
  morphNoise: "Rebuild the air as fresh noise shaped like the old, instead of stretching it. Off, it repeats at long ratios like every other engine here does",
  timeSpan: "How many frames long a ridge has to hold steady before it counts as a partial. Longer is stricter and sends more of the sound to the other two parts.",
  freqSpan: "How many bins wide a ridge has to be before it counts as a hit. Wider is stricter about what an attack is.",
  margin: "How much louder one part has to be than the other before it may claim a bin outright. At 1x nothing is left over and there is no Air at all - which is why the noise remaker then has nothing to work on.",
  fftSize: "The transform size the separation runs at. Bigger tells partials apart more finely and blurs the timing of hits; the separation is a property of the sound, not of the stretch.",
  sensitivity: "How eager the onset detector is. Higher finds more hits to protect, including ones that are not really hits; lower protects only the clearest attacks.",
  floor: "How far above the local average a peak has to rise before it counts as a hit. Low finds hits everywhere, which protects so much of the sound that the stretch stops happening.",
  guardHops: "How many hops either side of a detected hit are held at the original rate, so the attack is not laid down twice or cut in half.",
};

const GS_KEYS_TIP = 'The Keys window: the layout of the computer keyboard and what each key plays. A is the tonic, the row above plays the notes between, Z and X shift an octave and latch. The notes follow whichever tuning is chosen.';

// ──────────────────────────────────────────────────────────────── the arrow keys

/// A focused bar answers the keys a range input does, one step at a time.
function gsBarKey(e, k, el) {
  if (el.classList.contains('dim') || e.metaKey || e.ctrlKey || e.altKey) return;
  const c = GS_C[k], step = typeof c.step === 'function' ? c.step() : c.step;
  const unit = c.log ? 0.001 : (c.odd ? 2 : step || (c.max - c.min) / 1000) / (c.max - c.min);
  const n = gsToN(c, gsRead(k));
  const to = { ArrowRight: n + unit, ArrowUp: n + unit, ArrowLeft: n - unit, ArrowDown: n - unit, PageUp: n + Math.max(unit, 0.1), PageDown: n - Math.max(unit, 0.1), Home: 0, End: 1 }[e.key];
  if (to == null) return;
  e.preventDefault();
  gsSetN(k, to);
  gsSend(c, true);
  gsCommit(c);
}

// ──────────────────────────────────────────────────────────── painting the bars

/// A stroke begun between the bars sets each bar it crosses, once, where it
/// crosses: the tray's `enablePainting`. A press on a bar is that bar's own drag.
function gsEnablePainting(scope) {
  if (!scope || scope.dataset.painting) return;
  scope.dataset.painting = '1';
  let painting = false;
  const touched = new Set();
  const rowAt = (x, y) => {
    for (const row of scope.querySelectorAll('.gs-bc[data-k]')) {
      const r = row.getBoundingClientRect();
      if (r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return row;
    }
    return null;
  };
  const mark = (x, y) => {
    const row = rowAt(x, y);
    if (!row || touched.has(row) || row.classList.contains('dim')) return;
    const c = GS_C[row.dataset.k];
    if (c.sw || c.seg) return;
    touched.add(row);
    const w = row.querySelector('.gs-bw').getBoundingClientRect(), pad = 4 * w.width / row.querySelector('.gs-bw').offsetWidth;
    gsSetN(c.k, (x - w.left - pad) / (w.width - 2 * pad));
    gsSend(c, true);
  };
  scope.addEventListener('pointerdown', (e) => {
    painting = false;
    if (e.button || GS_L.mapI != null || e.target.closest('.gs-bw, .gs-tg, .gs-seg, svg.gg, .gs-btn, select, input')) return;
    painting = true;
    touched.clear();
    mark(e.clientX, e.clientY);
  });
  window.addEventListener('pointermove', (e) => { if (painting && e.buttons) mark(e.clientX, e.clientY); });
  window.addEventListener('pointerup', () => {
    if (!painting) return;
    painting = false;
    for (const row of touched) gsCommit(GS_C[row.dataset.k]);
    touched.clear();
  });
}

// ────────────────────────────────────────────────────── the top row's extras

const gsIcon = (d) => `<svg class="gs-ico" viewBox="0 0 12 12"><path d="${d}"/></svg>`;
const GS_ICON = {
  keys: 'M1.5 2 H10.5 V10 H1.5 Z M4.5 2 V10 M7.5 2 V10 M3.5 2 V6.5 M6.5 2 V6.5 M9.5 2 V6.5',
  cloud: 'M1.5 7 h.1 M4 3.5 h.1 M4.5 8.5 h.1 M6.8 5.5 h.1 M9 3 h.1 M10 8 h.1',
  save: 'M6 1.5 V8 M3.5 5.5 L6 8 L8.5 5.5 M2 10.5 H10',
  del: 'M3 3 L9 9 M9 3 L3 9',
};

function gsTrayHtml() {
  return `<span class="gs-ro" id="gsLength"></span>
    <span class="gs-sp"></span>
    <span class="gs-ro gs-noaudio" id="gsNoAudio" hidden>no audio device</span>
    <span class="gs-lab">${gsIcon(GS_ICON.cloud)}CLOUD</span>
    <select class="gs-midi" id="gsCpPick"></select>
    <span class="gs-btn gs-chip" id="gsCpSave">${gsIcon(GS_ICON.save)}Save as…</span>
    <span class="gs-btn gs-chip" id="gsCpDelete">${gsIcon(GS_ICON.del)}Delete</span>`;
}

function gsWireTray() {
  const pick = $('gsCpPick'), real = $('gpPick');
  pick.title = real.title;
  $('gsCpSave').title = $('gpSave').title;
  $('gsCpDelete').title = $('gpDelete').title;
  pick.onchange = () => { real.value = pick.value; real.dispatchEvent(new Event('change', { bubbles: true })); GS.touched = true; pick.blur(); };
  $('gsCpSave').onclick = () => $('gpSave').click();
  $('gsCpDelete').onclick = () => $('gpDelete').click();
  $('gsFollow').onclick = () => $('followBtn').click();
  $('gsFollowMode').onchange = (e) => { const m = $('followMode'); m.value = e.target.value; m.dispatchEvent(new Event('change', { bubbles: true })); e.target.blur(); };
  uiDrop($('gsFollowMode'), { h: 20, w: 74 });
}

/// The list and the choice are the tray's; this follows them.
function gsMirrorCloudPresets() {
  const pick = $('gsCpPick'), real = $('gpPick');
  if (!pick || !real) return;
  const sig = [...real.options].map((o) => o.value).join('\u0000');
  if (pick._s !== sig) { pick._s = sig; pick.innerHTML = real.innerHTML; }
  if (pick.value !== real.value) pick.value = real.value;
}

/// The file's facts, measured or guessed as the transport's strip has them, as
/// many as fit on the line, and all of them in its tooltip.
function gsMeta() {
  const f = state.selectedFile, el = $('gsMeta');
  if (!el || !f) return;
  const key = `${f.path}|${el.clientWidth}`;
  if (el._k === key) return;
  el._k = key;
  const items = [['format', f.format], ['rate', f.sampleRate ? f.sampleRate + ' Hz' : '—'], ['depth', f.bits ? f.bits + '-bit' : '—'], ['ch', f.channels ? f.channels + ' ch' : '—'], ['duration', fmtDur(f.duration)], ['category', f.category]];
  if (f.machine) items.push(['machine', f.machine]);
  if (f.instrument) items.push(['instrument', f.instrument]);
  if (f.bpm) items.push(['bpm', f.bpm]);
  el.title = items.map(([k, v]) => `${k}: ${v}`).join('\n');
  // Whole words only: whatever does not fit goes, last first.
  for (let n = items.length; n >= 0; n--) {
    el.textContent = items.slice(0, n).map(([, v]) => v).join(' · ');
    if (el.scrollWidth <= el.clientWidth) break;
  }
}

/// What the transport bar and the tray's readouts were saying, every frame.
function gsMirrorTray() {
  const d = state.stretchDraft;
  if (d) {
    const k = `${d.ratio}|${d.semitones}`;
    if (GS_KEYS.len !== k) { GS_KEYS.len = k; showStretchOut(); }
  }
  gsTxt('gsLength', $('stretchOut').textContent);
  const len = $('gsLength');
  if (len.title !== $('stretchOut').title) len.title = $('stretchOut').title;
  gsTxt('gsRecRo', $('recLabel').textContent);
  $('gsNoAudio').hidden = !noAudio();
  $('gsNoAudio').title = $('noAudio').title;
  for (const [id, real] of [['gsTPlay', 'playBtn'], ['gsTStop', 'stopBtn'], ['gsTLoop', 'loopBtn'], ['gsTRec', 'recBtn']]) {
    $(id).classList.toggle('dis', $(real).disabled);
  }
  $('gsTRec').title = $('recBtn').title;
  $('gsTLoop').title = $('loopBtn').title;
  $('gsLoopChip').title = $('loopBtn').title;
  const L = $('gsLoadM'), t = $('engineLoad').title;
  if (t && L.title !== t) L.title = t;
  $('gsFollow').classList.toggle('on', !!state.follow.on);
  if ($('gsFollowMode').value !== state.follow.mode) $('gsFollowMode').value = state.follow.mode;
  $('gsFollowMode').disabled = !state.follow.on;
  gsMirrorCloudPresets();
  gsMeta();
}

// ────────────────────────────────────────────────────────────────────── Follow

/// With the detail zoomed in, the head is kept on screen, the way the lane did:
/// scrolled along, or a page at a time. In steps, so its peaks can arrive.
function gsFollowTick() {
  if (!state.follow.on || !(GS.czB > GS.czA) || !gsHeadLive()) return;
  const t = gsHead(), [a, b] = gsCloudView(), L = b - a;
  if (state.follow.mode === 'page') {
    if (t >= a && t < b) return;
    GS.czA = t - L * 0.06;
    GS.czB = GS.czA + L;
    [GS.czA, GS.czB] = gsCloudView();
    return;
  }
  const q = L / 16, to = Math.round((t - L / 2) / q) * q;
  if (Math.abs(to - a) >= q / 2) { GS.czA = to; GS.czB = to + L; [GS.czA, GS.czB] = gsCloudView(); }
}

// ───────────────────────────────────────────────── markers and regions, seeking

/// The transport to a frame, by the lane's route: a sound the deck is not
/// holding yet starts playing, one it is holding moves.
function gsSeekTo(frame) {
  const f = state.selectedFile;
  if (!f) return;
  if (engine.path !== f.path) { playFile(f); return; }
  seekSource(frame);
}

/// The markers and the regions, along the overview, as the lane had them.
function gsDrawAnnotations(c, X, top, bot, cl) {
  const a = state.annotations, f = gsFile();
  if (!a || !f) return;
  c.font = `9px ${cl.mono}`;
  for (const r of a.regions || []) {
    const x0 = X(r.start / f.sr), x1 = X(r.end / f.sr);
    c.fillStyle = 'rgba(124,240,208,.28)';
    c.fillRect(x0, bot - 9, Math.max(1, x1 - x0 - 1), 9);
    if (x1 - x0 > c.measureText(r.label).width + 6) { c.fillStyle = cl.t; c.fillText(r.label, x0 + 3, bot - 2); }
  }
  for (const m of a.markers || []) {
    const x = X(m.frame / f.sr);
    c.fillStyle = cl.on;
    c.fillRect(x - 0.5, top, 1, bot - top - 10);
    c.beginPath(); c.moveTo(x, top); c.lineTo(x + 6, top + 3); c.lineTo(x, top + 6); c.fill();
    if (m.label) gsLbl(c, m.label, x + 8, top + 8, cl.on);
  }
}

/// The region under a point in the overview's strip, if any.
function gsRegionAt(px, py, X, bot) {
  if (py < bot - 10 || py > bot + 1) return null;
  const f = gsFile();
  return f ? (state.annotations?.regions || []).find((r) => px >= X(r.start / f.sr) && px <= X(r.end / f.sr)) || null : null;
}
