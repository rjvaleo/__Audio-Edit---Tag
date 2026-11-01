// ---------------------------------------------------------------- tuning
//
// The pitch control moves in semitones, and in half-semitone steps when left
// alone — a grid, not a tuning. A scale replaces that grid with real intervals
// in true cents, so a maqam's neutral third lands at 355 and not at 300 or 400
// because that is what a piano has.
//
// The scale is quantising the *shift*, not an absolute pitch. This transposes
// a recording rather than playing notes, so there is no key to be in: what a
// scale usefully says here is which intervals you may move by.

state.scales = null;          // the library, once fetched
state.scaleMenuOpen = false;

async function loadScales() {
  if (state.scales) return state.scales;
  try { state.scales = (await api('/api/scales')).groups || []; }
  catch { state.scales = []; }
  return state.scales;
}

const currentScale = () => state.edit?.stretch?.scale || '';
/// The grid when no scale is chosen. Zero is free.
const currentStep = () => {
  const v = state.edit?.stretch?.pitchStep;
  return v === undefined || v === null ? 0 : v;
};

/// The finest step the chosen scale offers, in semitones.
///
/// So the slider itself moves between degrees rather than sliding freely and
/// being pulled back on release, which feels like the control fighting you.
function scaleStep() {
  const name = currentScale();
  // No scale: the plain grid, and zero means the slider is continuous. The
  // finest a range input will take is what limits "free" in practice.
  if (!name) return currentStep() > 0 ? currentStep() : 0.001;
  for (const g of state.scales || []) {
    for (const s of g.scales) {
      if (s.name !== name) continue;
      let finest = s.span;
      for (let i = 1; i < s.cents.length; i++) finest = Math.min(finest, s.cents[i] - s.cents[i - 1]);
      finest = Math.min(finest, s.span - s.cents[s.cents.length - 1]);
      return Math.max(0.01, finest / 100);
    }
  }
  return 0.5;
}

/// Semitones, and the degree it lands on when a scale is chosen.
function scaleLabel(v) {
  const sign = v >= 0 ? '+' : '';
  const name = currentScale();
  // Free shows the extra decimals, because hiding them would make a continuous
  // control look like it was still snapping.
  if (!name) return currentStep() > 0
    ? `${sign}${v.toFixed(1)} st`
    : `${sign}${v.toFixed(2)} st · ${sign}${Math.round(v * 100)}¢`;
  const cents = Math.round(v * 100);
  return `${sign}${v.toFixed(2)} st · ${sign}${cents}¢`;
}

/// The row the engine's switches and the tuning share.
const engineSwitches = () => document.querySelector('.engine-switches');

/// The Keys window, opened from beside the tuning it follows.
function keysButton() {
  const b = document.createElement('button');
  // Its own kind. Everything else on this row sets a value; this opens a
  // window, and a button that opens a window should not look like a button that
  // changes a setting.
  b.className = 'popout-btn';
  b.innerHTML = 'Keys <i class="popout-mark">⧉</i>';
  b.title = 'Play the pitch from the computer keyboard. A is the tonic, the row '
    + 'above plays the notes between, Z and X shift an octave and latch. '
    + 'The notes follow whichever tuning is chosen.';
  // A toggle: it is a panel you leave up, so the way you put it away is the
  // same button you got it with.
  b.onclick = (e) => { e.stopPropagation(); (keyboardOpen() ? closeKeyboard : openKeyboard)(); };
  return b;
}

function scaleButton() {
  const b = document.createElement('button');
  b.className = 'scale-btn' + (currentScale() ? ' on' : '');
  // A caret, because this opens a menu. Keys carries a window mark instead:
  // one says "a list is coming", the other says "a window is coming", and they
  // are not the same promise.
  const name = fitLabel(currentScale() || (currentStep() > 0 ? `${currentStep()} st grid` : 'free'));
  b.innerHTML = `<span class="scale-name"></span><i class="menu-caret">▾</i>`;
  b.querySelector('.scale-name').textContent = name;
  b.title = currentScale()
    ? `${currentScale()} — snap the pitch shift to a tuning`
    : 'Snap the pitch shift to a tuning';
  b.onclick = (e) => { e.stopPropagation(); openScaleMenu(b); };
  return b;
}

/// The scale menu: every scale, grouped, with a filter across all of them.
///
/// It used to open with the categories collapsed. That is a tidy list and a
/// dishonest one — eighty-one scales showed as seven rows, and the library
/// looked like it held seven things. Grouping is worth having; hiding is not.
/// So the groups are headings you can fold rather than doors you must open,
/// everything is showing when it opens, and the count is on the front of it.
async function openScaleMenu(anchor) {
  const groups = await loadScales();
  const total = groups.reduce((n, g) => n + g.scales.length, 0);
  const pop = $('menuPop');
  pop.innerHTML = '';
  pop.classList.remove('hidden');
  pop.classList.add('scale-pop');

  const head = document.createElement('div');
  head.className = 'scale-head';
  const count = document.createElement('span');
  count.className = 'scale-count';
  count.textContent = `${total} scales`;
  const filter = document.createElement('input');
  filter.className = 'filter-box';
  filter.placeholder = 'filter…';
  head.append(count, filter);
  pop.appendChild(head);

  const list = document.createElement('div');
  list.className = 'scale-cats';
  pop.appendChild(list);

  // The two answers that are not a scale. Free is the raw slider value; the
  // grid is what this control has always done.
  const plain = [
    ['Free — no quantising', 'the default \u2014 the slider\u2019s own value, unrounded', 0],
    ['Semitone grid', 'twelve to the octave', 1],
    ['Half-semitone grid', 'twenty-four to the octave', 0.5],
  ];
  for (const [label, info, step] of plain) {
    const item = document.createElement('button');
    const on = !currentScale() && currentStep() === step;
    item.className = 'scale-item' + (on ? ' selected' : '');
    const n = document.createElement('span'); n.className = 'sc-name'; n.textContent = label;
    const i = document.createElement('span'); i.className = 'sc-info'; i.textContent = info;
    item.append(n, i);
    item.dataset.name = label.toLowerCase();
    item.dataset.info = info.toLowerCase();
    item.onclick = () => pickScale('', step);
    list.appendChild(item);
  }

  for (const g of groups) {
    const cat = document.createElement('div');
    cat.className = 'scale-cat';
    const title = document.createElement('button');
    title.className = 'scale-cat-head';
    const body = document.createElement('div');
    body.className = 'scale-cat-body';
    const mark = () => { title.textContent = `${body.classList.contains('hidden') ? '▸' : '▾'} ${g.category}  (${g.scales.length})`; };

    for (const sc of g.scales) {
      const item = document.createElement('button');
      item.className = 'scale-item' + (sc.name === currentScale() ? ' selected' : '');
      const n = document.createElement('span'); n.className = 'sc-name'; n.textContent = sc.name;
      const i = document.createElement('span'); i.className = 'sc-info';
      i.textContent = `${sc.degrees} degrees · ${sc.info}`;
      item.append(n, i);
      item.dataset.name = sc.name.toLowerCase();
      item.dataset.info = (sc.info || '').toLowerCase();
      item.onclick = () => pickScale(sc.name);
      body.appendChild(item);
    }
    // Folding is a choice, not the starting state.
    title.onclick = () => { body.classList.toggle('hidden'); mark(); };
    mark();
    cat.append(title, body);
    list.appendChild(cat);
  }

  // The filter reaches across every category at once, which is the only way to
  // find one scale among eighty-one without knowing which family it is in.
  filter.oninput = () => {
    const q = filter.value.trim().toLowerCase();
    for (const cat of list.querySelectorAll('.scale-cat')) {
      let shown = 0;
      for (const item of cat.querySelectorAll('.scale-item')) {
        const hit = !q || item.dataset.name.includes(q) || item.dataset.info.includes(q);
        item.classList.toggle('hidden', !hit);
        if (hit) shown++;
      }
      cat.classList.toggle('hidden', shown === 0);
      if (q) cat.querySelector('.scale-cat-body').classList.remove('hidden');
    }
    count.textContent = q
      ? `${list.querySelectorAll('.scale-item:not(.hidden)').length} shown`
      : `${total} scales`;
  };
  filter.onkeydown = (e) => e.stopPropagation();

  // Placed after it is in the document, so its real height is known. Below the
  // button when there is room and above it when there is not — the pitch row
  // sits low in the panel, and a menu that runs off the bottom of the window
  // is a menu you cannot use.
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(6, Math.min(window.innerWidth - 340, r.left))}px`;
  pop.style.top = '0px';
  const h = pop.offsetHeight;
  const below = window.innerHeight - r.bottom - 8;
  pop.style.top = h <= below
    ? `${r.bottom + 4}px`
    : `${Math.max(6, Math.min(r.top - h - 4, window.innerHeight - h - 6))}px`;
  list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });

  state.scaleMenuOpen = true;
  setTimeout(() => document.addEventListener('pointerdown', closeScaleMenu, { once: true }), 0);
}

function closeScaleMenu(e) {
  if (!state.scaleMenuOpen) return;
  // A click inside the menu is not a click away from it — typing in the filter
  // or folding a category has to leave it open.
  if (e && $('menuPop').contains(e.target)) {
    document.addEventListener('pointerdown', closeScaleMenu, { once: true });
    return;
  }
  state.scaleMenuOpen = false;
  const pop = $('menuPop');
  pop.classList.add('hidden');
  pop.classList.remove('scale-pop');
}

async function pickScale(name, step) {
  closeScaleMenu();
  if (!state.selectedFile) return;
  // Posted with the current pitch, so choosing a scale snaps what is already
  // set rather than waiting for the next time the slider is touched.
  state.stretchDraft.scale = name;
  await editOp({ op: 'stretch',
                 ratio: state.stretchDraft.ratio,
                 semitones: state.stretchDraft.semitones,
                 windowMs: state.stretchDraft.windowMs,
                 quality: state.stretchDraft.quality,
                 algorithm: state.stretchDraft.algorithm,
                 vocoder: state.stretchDraft.vocoder,
                 wsola: state.stretchDraft.wsola,
                 pvsola: state.stretchDraft.pvsola,
                 hybrid: state.stretchDraft.hybrid,
                 grain: state.grainDraft,
                 scale: name,
                 ...(step === undefined ? {} : { pitchStep: step }) },
               { live: false });
  stretchBuiltFor = null;
  renderStretch();
}

// ------------------------------------------------------------- recording
//
// The one place audio enters this program from outside. Everything else reads
// a file; this makes one, and it is the only feature that can lose something
// that never existed anywhere else. So the panel is deliberately explicit
// about state — armed is not recording, and a take that dropped a block says
// so rather than being quietly shorter than the performance was.

const rec = { armed: false, recording: false, timer: null, seconds: 0 };

async function recordState() {
  try { return await api('/api/record'); } catch { return null; }
}

async function recordPost(body) {
  try { return await postJSON('/api/record', body); }
  catch (e) { toast(e.message); return null; }
}

function recordPanelShown(on) {
  clearInterval(rec.timer);
  rec.timer = null;
  if (!on) return;
  refreshRecord();
  // Fast enough that a level meter is useful, slow enough to be free.
  rec.timer = setInterval(refreshRecord, 100);
}

async function refreshRecord() {
  const st = await recordState();
  if (!st) return;
  rec.armed = !!st.armed;
  rec.recording = !!st.recording;

  const devices = st.devices || null;
  if (devices) {
    const sel = $('recDevice');
    const current = sel.value;
    if (sel.options.length !== devices.length
        || [...sel.options].some((o, i) => o.value !== devices[i])) {
      sel.innerHTML = '';
      for (const d of devices) {
        const o = document.createElement('option');
        o.value = d; o.textContent = d;
        sel.appendChild(o);
      }
      if (devices.includes(current)) sel.value = current;
    }
  }
  drawRecordPanel(st);
}

function drawRecordPanel(st) {
  $('recDevice').disabled = rec.armed;
  $('recArm').textContent = rec.armed ? 'Disarm' : 'Arm';
  $('recArm').disabled = rec.recording;
  $('recStart').classList.toggle('hidden', !rec.armed || rec.recording);
  $('recStop').classList.toggle('hidden', !rec.recording);
  $('recNameRow').classList.toggle('hidden', !rec.armed);

  // A peak meter in dB, because a linear one spends most of its travel in the
  // top 6 dB and tells you nothing about where you actually are.
  const height = (v) => `${Math.max(0, Math.min(100, (20 * Math.log10(Math.max(v || 0, 1e-4)) + 60) / 60 * 100))}%`;
  $('recBarL').style.setProperty('--rec', height(st.left));
  $('recBarR').style.setProperty('--rec', height(st.right));
  const hot = Math.max(st.left || 0, st.right || 0) >= 0.99;
  $('recMeter').classList.toggle('hot', hot);

  const out = $('recReadout');
  if (!rec.armed) { out.textContent = 'not armed'; out.classList.remove('warn'); return; }
  const secs = st.seconds || 0;
  const left = Math.max(0, (st.maxSeconds || 0) - secs);
  const bits = [
    rec.recording ? `● ${fmtTime(secs)}` : 'armed',
    `${st.channels || 0} ch · ${Math.round((st.sampleRate || 0) / 100) / 10} kHz`,
  ];
  if (rec.recording) bits.push(`${fmtTime(left)} left`);
  // Never smoothed over: a take with a hole in it cannot be done again, and
  // finding out afterwards is the worst way to find out.
  if (st.overruns > 0) bits.push(`${st.overruns} dropped`);
  out.textContent = bits.join('  ·  ');
  out.classList.toggle('warn', st.overruns > 0 || hot);
}

$('recArm').onclick = async () => {
  if (rec.armed) { await recordPost({ action: 'disarm' }); await refreshRecord(); return; }
  const device = $('recDevice').value || undefined;
  const st = await recordPost({ action: 'arm', device });
  if (st) await refreshRecord();
};

$('recStart').onclick = async () => {
  if (await recordPost({ action: 'start' })) await refreshRecord();
};

$('recStop').onclick = async () => {
  const name = $('recName').value.trim();
  const done = await recordPost({ action: 'stop', ...(name ? { name } : {}) });
  await refreshRecord();
  if (!done) return;
  $('recName').value = '';
  const where = done.outside
    ? 'outside the library — choose a library folder to keep takes with everything else'
    : done.rel;
  toast(`Recorded ${fmtTime(done.seconds)} → ${where}`
        + (done.overruns > 0 ? ` (${done.overruns} blocks dropped)` : ''));
  // The take is a real file now, so the browser has to be told it exists.
  // A full scan, because that is the only thing that reads a folder that was
  // not there before — `Recordings` will not exist until the first take.
  if (!done.outside) $('rescanBtn')?.click();
};

