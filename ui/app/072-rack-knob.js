/// A knob, for the effect rack.
///
/// Same contract as `param` — value in, format, change, commit, and a `sync`
/// so Reset and Undo can push a value back — so the two are interchangeable at
/// the call site and nothing else has to know which it got.
///
/// A rack is a row of little modules rather than a column of long sliders:
/// eight of these fit where three sliders did, and an effect with a handful of
/// controls reads as one object instead of a list. Dragged vertically, which is
/// how a knob has worked since knobs were physical, with shift for fine.
function knob(label, value, min, max, step, format, onChange, onCommit, log, def) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.innerHTML = `
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <circle class="bezel" cx="22" cy="22" r="13"></circle>
      <circle class="cap" cx="22" cy="22" r="10.5"></circle>
      <path class="track" d=""></path>
      <path class="arc" d=""></path>
      <line class="ptr" x1="22" y1="22" x2="22" y2="8"></line>
    </svg>
    <span class="k"></span><span class="v"></span>`;
  const name = el.querySelector('.k');
  name.textContent = label;
  name.title = label;
  const out = el.querySelector('.v');
  const arc = el.querySelector('.arc');
  const ptr = el.querySelector('.ptr');

  // 270 degrees, starting at seven o'clock — the range a knob has room for
  // without the ends meeting.
  const A0 = Math.PI * 0.75;
  const SWEEP = Math.PI * 1.5;
  const R = 15;
  const at = (t) => {
    const a = A0 + SWEEP * t;
    return [22 - R * Math.cos(a - Math.PI / 2), 22 - R * Math.sin(a - Math.PI / 2)];
  };
  const path = (from, to) => {
    const [x0, y0] = at(from);
    const [x1, y1] = at(to);
    const big = SWEEP * (to - from) > Math.PI ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  el.querySelector('.track').setAttribute('d', path(0, 1));

  // The same log mapping `param` uses, so a control that needed one as a
  // slider still gets one as a knob.
  const toPos = (v) => (log ? Math.log(Math.max(v, min) / min) / Math.log(max / min)
                            : (v - min) / (max - min));
  const toVal = (t) => (log ? min * Math.pow(max / min, t) : min + t * (max - min));

  let pos = Math.min(1, Math.max(0, toPos(value)));
  const paint = () => {
    const v = toVal(pos);
    arc.setAttribute('d', pos <= 0.001 ? '' : path(0, pos));
    const [px, py] = at(pos);
    ptr.setAttribute('x2', (22 + (px - 22) * 0.72).toFixed(2));
    ptr.setAttribute('y2', (22 + (py - 22) * 0.72).toFixed(2));
    const t = format(v);
    out.textContent = t;
    out.title = t;
  };
  const quantise = (v) => (step > 0 ? Math.round(v / step) * step : v);
  paint();

  el.sync = (v) => { pos = Math.min(1, Math.max(0, toPos(v))); paint(); };

  // Vertical drag. A full turn is 160 pixels, which is far enough to be
  // controllable and short enough to cross without letting go.
  let dragging = false;
  let lastY = 0;
  const svg = el.querySelector('svg');
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastY = e.clientY;
    svg.setPointerCapture(e.pointerId);
    el.classList.add('turning');
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const fine = e.shiftKey ? 0.2 : 1;
    pos = Math.min(1, Math.max(0, pos + ((lastY - e.clientY) / 160) * fine));
    lastY = e.clientY;
    paint();
    onChange(quantise(toVal(pos)));
  });
  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('turning');
    try { svg.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    if (onCommit) onCommit(quantise(toVal(pos)));
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const fine = e.shiftKey ? 0.2 : 1;
    pos = Math.min(1, Math.max(0, pos - Math.sign(e.deltaY) * 0.03 * fine));
    paint();
    onChange(quantise(toVal(pos)));
    if (onCommit) onCommit(quantise(toVal(pos)));
  }, { passive: false });

  // Double-click puts it back where it started — the same contract as `param`,
  // since the two are interchangeable at the call site and a control should not
  // behave differently for being round.
  if (def !== undefined && def !== null && Number.isFinite(def)) {
    el.title = `${label} — double-click to reset to ${format(def)}`;
    el.ondblclick = (e) => {
      e.preventDefault();
      el.sync(def);
      onChange(def);
      if (onCommit) onCommit(def);
    };
  }

  return el;
}

/// A switch: a button with its own name in it, coloured to say which way it is.
///
/// Built like `Reset all`, because it is the same kind of thing — a button you
/// press. The words are *in* it rather than in the name column beside it, and
/// the state is the colour: outlined and dim when off, filled with the accent
/// when on.
///
/// Two earlier versions got this wrong in opposite directions. A moulded rocker
/// was a small painting of a physical switch that matched nothing else here and
/// read as an indicator rather than a control. Replacing it with a name in the
/// column and a little `on`/`off` box was worse — two things to look at for one
/// bit, and the eye has to pair them up. One button, its own word, one colour.
/// Make a label fit a small button, in the order the eye loses least.
///
/// Anything parenthesised goes first, then anything after a dash — both are
/// qualifiers rather than the name. Only if it is still too long do the vowels
/// come out, and never the first letter of a word: "preserve transients" reads
/// as "prsrv trnsnts" but "rsrv rnsnts" reads as nothing.
/// The switches' fixed slots in the slider-column tray, as before the 27 Oct
/// pass: at 24 the full words ran into the next switch.
const LABEL_MAX = 11;

/// Number words become numbers — on the button only, never in the tooltip.
/// Cardinals and ordinals both, because "fifth" is as long as "five" and half
/// as common in a label.
const NUMBER_WORDS = [
  ['first', '1st'], ['second', '2nd'], ['third', '3rd'], ['fourth', '4th'],
  ['fifth', '5th'], ['sixth', '6th'], ['seventh', '7th'], ['eighth', '8th'],
  ['ninth', '9th'], ['tenth', '10th'], ['eleventh', '11th'], ['twelfth', '12th'],
  ['sixteenth', '16th'],
  ['zero', '0'], ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'],
  ['five', '5'], ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'],
  ['ten', '10'], ['eleven', '11'], ['twelve', '12'], ['sixteen', '16'],
];

function digits(t) {
  let out = t;
  for (const [word, num] of NUMBER_WORDS) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), num);
  }
  return out;
}

function fitLabel(text) {
  // Ordered by what the eye loses least: qualifiers, then long number words,
  // then vowels.
  //
  // **Never truncated and never ellipsised.** A cut word is unreadable and a
  // trailing "…" says only that something is missing; "trnsnts" is still the
  // word. Dropping vowels is the last step and it is where this stops — if the
  // result is still wide, the button is wide.
  let t = String(text).replace(/\s*\([^)]*\)/g, '').replace(/\s*[-–—].*$/, '').trim();
  t = digits(t);
  if (t.length <= LABEL_MAX) return t;
  return t.replace(/\B[aeiou]/gi, '');
}

function check(label, title, value, onChange) {
  const el = document.createElement('div');
  el.className = 'param toggle';
  el.innerHTML = `<button class="tiny switch" role="switch"></button>`;
  const b = el.querySelector('.switch');
  // Spelled out (RJ, 4 Nov 2026: "stop truncating words in buttons"). The
  // shortening is kept only where a name has to fit a fixed place, the scale
  // on the tuning button (`fitLabel`).
  b.textContent = label;
  b.dataset.name = label;
  b.title = title || label;
  el.title = b.title;

  let on = !!value;
  const paint = () => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  };
  paint();
  b.onclick = () => { on = !on; paint(); onChange(on); };
  // Its state as a number, for a picture drawn from it (`grain-glyphs.js`).
  el.read = () => (on ? 1 : 0);
  // Same contract as `param` and `seg`, so Reset can push a value in.
  el.sync = (v) => { on = !!v; paint(); };
  return el;
}

/// A named choice between a few values.
function seg(label, options, value, onChange) {
  const el = document.createElement('div');
  el.className = 'param seg-param';
  // One line, and the same first column as a slider, so a choice sits in the
  // table rather than interrupting it. The bar takes the slider and reading
  // columns between them.
  el.innerHTML = `<span class="k"></span><div class="seg"></div>`;
  const name = el.querySelector('.k');
  name.textContent = label;
  name.title = label;
  const bar = el.querySelector('.seg');
  for (const [val, text, hint] of options) {
    const b = document.createElement('button');
    b.className = 'seg-btn' + (val === value ? ' active' : '');
    b.textContent = text;
    if (hint) b.title = hint;
    b._val = val;
    b.onclick = () => {
      for (const x of bar.children) x.classList.toggle('active', x === b);
      onChange(val);
    };
    bar.appendChild(b);
  }
  // Same contract as `param`, so Reset and Undo can push a value in without
  // knowing which kind of control they are holding.
  el.sync = (v) => {
    for (const b of bar.children) b.classList.toggle('active', b._val === v);
  };
  return el;
}

/// Two switches on one line, for the pairs that only mean anything together.
/// Attach an explanation to a control.
///
/// Set on the whole row rather than the label, so hovering the name, the
/// slider or the reading all say the same thing — and it replaces the
/// label-only title `param` and `knob` put on the name for clipping, which
/// would otherwise be the one that wins where it matters least.
///
/// Every control in the stretch tray has one. They are not decoration: half of
/// these were constants inside an algorithm until recently, and a slider whose
/// name is the only thing telling you what it does is a slider you turn at
/// random.
function tip(el, text) {
  el.title = text;
  // The name and the reading carry it outright: `param` and `knob` put the
  // bare label on the name so a clipped one stays readable, and that would
  // otherwise win over this in the one place a hover is most likely to land.
  for (const k of el.querySelectorAll('.k, .v, input')) k.title = text;
  // A segment that explains itself keeps its own words. Those are about the
  // one choice; this is about the row, and the specific of the two is the more
  // useful thing to be told.
  for (const k of el.querySelectorAll('.seg-btn, .switch')) {
    if (!k.title) k.title = text;
  }
  return el;
}

function pair(a, b) {
  const el = document.createElement('div');
  el.className = 'param-pair';
  el.append(a, b);
  return el;
}

/// A named group inside the Extended column.
///
/// Not a disclosure. These were folded when they lived among the everyday
/// sliders and the reason to hide them was that they are next to Stretch; in
/// their own column that reason is gone, and a control you have to go looking
/// for is a control you forget exists.
function wild(heading, title) {
  const el = document.createElement('div');
  el.className = 'wild';
  el.innerHTML = '<div class="wild-head"></div><div class="wild-body"></div>';
  const head = el.querySelector('.wild-head');
  head.textContent = heading;
  if (title) {
    head.title = title;
    // On the group as well as its heading. A control inside carries its own,
    // and the innermost title is the one a browser shows, so the two do not
    // fight — this only fills the space between them.
    el.title = title;
  }
  el.body = el.querySelector('.wild-body');
  el.add = (...kids) => { for (const k of kids) el.body.appendChild(k); return el; };
  return el;
}

/// Re-read the folder listing and whatever folder is open.
///
/// Called after anything this app does that puts a file in the library, so the
/// browser is never describing a directory that no longer matches the disk.
async function refreshLibrary() {
  try {
    state.folders = await api('/api/folders');
    const open = Object.keys(state.openFolders).filter((n) => state.openFolders[n]);
    for (const name of open) {
      state.folderFiles[name] = await api(`/api/files?folder=${encodeURIComponent(name)}`);
    }
    buildTree();
    for (const name of open) loadHeard(name);
  } catch { /* a failed refresh is a stale list, not a broken app */ }
}

