// ============================================================== the keyboard
//
// One listener. There were six, and they did not know about each other: a
// single Escape ran four of them, so dismissing the preset manager also wiped
// the selection and sent the cue to zero. Nothing called `stopPropagation`,
// no two agreed on what counted as a text field, and only one of them knew a
// dialog could be open at all.
//
// Three tiers, in order. A key never falls past the tier that claims it:
//
//   1. focus is in a text field  — the field owns every key
//   2. an overlay is open        — Escape closes the topmost, space still
//                                  plays, nothing else is interpreted
//   3. otherwise                 — the shortcuts
//
// Space stays live in tier 2 on purpose. The transport answers the space bar
// everywhere, because that is the one binding a user should never have to
// think about. The ask dialog is the single exception and it enforces that
// itself: while it is up it holds a handler on the capture phase, so Enter and
// Escape reach it before this listener exists as far as the event is
// concerned.

/// A key belongs to the field being typed into, and to nothing else.
///
/// `SELECT` is in here because a dropdown takes arrow keys and type-ahead, and
/// it was the gap that let space start playback with a menu focused. Two of
/// the old handlers guarded it and three did not.
function inTextField(t) {
  if (!t) return false;
  if (t.isContentEditable) return true;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/// What Escape should close, most transient first, or null if nothing is open.
///
/// A menu is drawn over everything and is the cheapest thing to dismiss, so it
/// is tested before the panels it may be covering. Returning null is what puts
/// a keypress through to tier 3, which is why "deselect" can safely live down
/// there — it now only fires when the screen really is clear.
function topOverlay() {
  if (openMenu || !$('menuPop').classList.contains('hidden')) return closeMenus;
  if (!$('pickerModal').classList.contains('hidden')) {
    return () => $('pickerModal').classList.add('hidden');
  }
  if (!$('exportLoop').classList.contains('hidden')) return closeExportLoop;
  if (!$('presetManager').classList.contains('hidden')) return closePresetManager;
  // The note keyboard is a floating panel rather than a shadowbox, but it is
  // still a window, and Escape closes the front one. So is the grain views
  // window, which was opened after this list was written and left out of it.
  if (keyboardOpen()) return closeKeyboard;
  if (visWindowOpen()) return closeVisWindow;
  if (pop.el && !pop.el.classList.contains('hidden')) return closeVisPop;
  return null;
}


// ─────────────────────────────────────────────────────────── the note keyboard
//
// Play the pitch from the computer keyboard.
//
// The letters are the layout every tracker and DAW has used for thirty years:
// `A` is the tonic, the row above carries the notes between, and the two rows
// interlock exactly the way a piano's whites and blacks do. `Z` and `X` move an
// octave and latch, so three presses of `X` is three octaves up.
//
// **What each key plays comes from the tuning, not from twelve semitones.** The
// scale menu offers eighty-one of them and many are not twelve-tone — so the
// keys are bound to scale *degrees* in order, and an octave is the scale's own
// span rather than 1200 cents by assumption. On plain 12-TET that reproduces a
// piano exactly; on a seven-degree scale the eighth key is the tonic again, a
// span up; on a 22-degree scale the row simply keeps going.

/// The letters, in pitch order. Two rows interlocking as whites and blacks.
const NOTE_KEYS = [
  ['a', 0], ['w', 1], ['s', 2], ['e', 3], ['d', 4], ['f', 5], ['t', 6],
  ['g', 7], ['y', 8], ['h', 9], ['u', 10], ['j', 11], ['k', 12],
  ['o', 13], ['l', 14], ['p', 15], [';', 16], ["'", 17],
];

/// Which of those sit on the upper row — the ones a piano draws black.
const UPPER_ROW = new Set(['w', 'e', 't', 'y', 'u', 'o', 'p']);

const keyboardState = { octave: 0, held: null };

/// The degrees of the chosen tuning, in cents, and the span that repeats.
///
/// With no scale the grid is the answer: a pitch step if one is set, and plain
/// semitones otherwise. That is what "free" already means everywhere else.
function scaleDegrees() {
  const name = currentScale();
  if (name) {
    for (const g of state.scales || []) {
      for (const s of g.scales) {
        if (s.name === name) return { cents: s.cents.slice(), span: s.span || 1200 };
      }
    }
  }
  const step = currentStep() > 0 ? currentStep() : 1;
  const n = Math.max(1, Math.round(12 / step));
  return { cents: Array.from({ length: n }, (_, i) => i * step * 100), span: 1200 };
}

/// The pitch a key plays, in semitones.
///
/// `i` counts degrees from the tonic and may run past the end of the scale, at
/// which point it wraps and climbs a span — which is what makes the row keep
/// working whatever the degree count is.
function noteSemitones(i) {
  const { cents, span } = scaleDegrees();
  const n = cents.length || 1;
  const up = Math.floor(i / n);
  const c = cents[((i % n) + n) % n];
  const semis = (up * span + c) / 100 + keyboardState.octave * (span / 100);
  return Math.max(-48, Math.min(48, semis));
}

/// Play one. Sets the pitch exactly as the slider does, so everything that
/// watches it — the readout, automation, the engine — sees one kind of change.
function playNote(i) {
  // The draft is built by the stretch panel, and the keys work whether that
  // panel has been opened or not — so there may not be one yet.
  if (!state.stretchDraft) return;
  const v = noteSemitones(i);
  state.stretchDraft.semitones = v;
  state.stretchRows?.semitones?.sync?.(v);
  previewStretch();
  commitStretch();
  keyboardState.held = i;
  paintKeyboard();
}

function shiftOctave(by) {
  const { span } = scaleDegrees();
  const perOct = span / 100;
  // Latching, and bounded by what the pitch control can actually reach — three
  // presses of X is three octaves, and a fourth past the end is not a silent
  // no-op that looks like a missed keystroke.
  const limit = Math.max(1, Math.floor(48 / Math.max(1, perOct)));
  keyboardState.octave = Math.max(-limit, Math.min(limit, keyboardState.octave + by));
  if (keyboardState.held !== null) playNote(keyboardState.held);
  else paintKeyboard();
}

const keyboardOpen = () => !$('keyboardModal').classList.contains('hidden');

/// The keys, drawn as a piano.
///
/// The lower row is the whites and the upper row the blacks, which is not a
/// decoration — it is the same relationship the two rows have under your hand.
/// `W` sits between `A` and `S` on the keyboard and `C#` sits between `C` and
/// `D` on a piano, so a black drawn straddling the seam it plays is showing you
/// the layout you are already touching. That correspondence is the whole reason
/// this letter arrangement has outlasted every program that used it.
///
/// The whites are one unbroken row — a piano has no gaps in them. What varies
/// is where a black sits *over* the seam between two of them: there is one after
/// the first, second, fourth, fifth, sixth, eighth and ninth, and none after the
/// third or seventh. Those two bare seams are E to F and B to C, they are why
/// the pattern repeats every seven, and they are why the letters work out.
///
/// Keyed by which white a black follows.
const WHITE_AFTER = { w: 0, e: 1, t: 3, y: 4, u: 5, o: 7, p: 8 };

/// One white key, in pixels. The keyboard is this times eleven and the panel is
/// only as wide as that.
const KEY_WIDTH = 26;

function paintKeyboard() {
  const box = $('kbPiano');
  if (!box) return;
  const { cents, span } = scaleDegrees();
  box.innerHTML = '';

  const whites = NOTE_KEYS.filter(([k]) => !UPPER_ROW.has(k));
  const blacks = NOTE_KEYS.filter(([k]) => UPPER_ROW.has(k));
  // Sized from the key, not from the panel. Stretching eleven whites across a
  // 680px window made each one sixty pixels wide against eighty-four tall,
  // which is not a piano key — a real one is roughly one to six. At 26 by 84
  // the proportion reads right and the panel is only as wide as the keyboard.
  const unit = KEY_WIDTH;
  const span_px = whites.length * unit;
  box.style.width = `${span_px}px`;
  // The window is the width of the keyboard, full stop. Letting it size to its
  // contents meant a long scale name set the width and the keyboard sat in a
  // wide empty box.
  const card = document.querySelector('.kb-card');
  if (card) card.style.width = `${span_px + 14}px`;

  const label = (key, i) => {
    const semis = noteSemitones(i);
    return {
      semis,
      html: `<span class="kb-letter">${key.toUpperCase()}</span>`
        + `<span class="kb-semis">${semis >= 0 ? '+' : ''}${semis.toFixed(2)}</span>`,
      title: `${key.toUpperCase()} — degree ${(i % (cents.length || 1)) + 1} of ${cents.length}`
        + `, ${semis >= 0 ? '+' : ''}${semis.toFixed(2)} semitones`,
    };
  };

  whites.forEach(([key], n) => {
    const i = NOTE_KEYS.findIndex(([k]) => k === key);
    const l = label(key, i);
    const b = document.createElement('button');
    b.className = 'kb-key white' + (keyboardState.held === i ? ' on' : '');
    b.style.left = `${n * unit}px`;
    b.style.width = `${unit}px`;
    b.innerHTML = l.html;
    b.title = l.title;
    b.onclick = () => playNote(i);
    box.appendChild(b);
  });

  blacks.forEach(([key]) => {
    const after = WHITE_AFTER[key];
    if (after === undefined) return;
    const i = NOTE_KEYS.findIndex(([k]) => k === key);
    const l = label(key, i);
    const b = document.createElement('button');
    b.className = 'kb-key black' + (keyboardState.held === i ? ' on' : '');
    // Straddling the seam between two whites, and a shade left of centre —
    // which is where the upper row actually sits above the home row.
    b.style.left = `${(after + 1) * unit - unit * 0.34}px`;
    b.style.width = `${unit * 0.62}px`;
    b.innerHTML = l.html;
    b.title = l.title;
    b.onclick = () => playNote(i);
    box.appendChild(b);
  });

  const oct = $('kbOctave');
  if (oct) {
    oct.textContent = keyboardState.octave === 0
      ? 'octave 0'
      : `octave ${keyboardState.octave > 0 ? '+' : ''}${keyboardState.octave}`;
    oct.classList.toggle('on', keyboardState.octave !== 0);
  }
  const now = $('kbNow');
  if (now) {
    now.textContent = keyboardState.held === null
      ? ''
      : `${noteSemitones(keyboardState.held).toFixed(2)} st`;
  }
  const sc = $('kbScale');
  if (sc) {
    // Same rules as a button: no parentheses, no qualifier after a dash, and
    // the words collapse rather than the panel growing to hold them. This line
    // was stretching the window past the keyboard it is describing.
    sc.textContent = currentScale()
      ? `${fitLabel(currentScale())} · ${cents.length} deg`
      : `${cents.length} steps / oct`;
  }
}

/// The hints, taking turns on one line.
///
/// Shown side by side they forced the panel to more than twice the keyboard's
/// width for text you read once. One at a time they cost a single line and can
/// say more than they did — and a slow fade is legible in a way a hard swap is
/// not, because the eye is drawn to the change rather than startled by it.
const KB_HINTS = [
  '<b>A</b> is the tonic',
  '<b>Z</b> / <b>X</b> shift an octave, and latch',
];

let kbHintAt = 0;
let kbHintTimer = null;

function showHint() {
  const el = $('kbHint');
  if (!el) return;
  el.innerHTML = KB_HINTS[kbHintAt % KB_HINTS.length];
  el.classList.remove('out');
}

function cycleHint() {
  const el = $('kbHint');
  if (!el) return;
  el.classList.add('out');
  // Half a second is the fade in the stylesheet; swapping at the end of it is
  // what makes this a cross-fade rather than a flicker.
  setTimeout(() => {
    kbHintAt += 1;
    showHint();
  }, 450);
}

/// Advance it now, and start the ten seconds again from here — a click that
/// only queued the next one behind an old timer would sometimes change twice.
function nudgeHint() {
  cycleHint();
  if (kbHintTimer) {
    clearInterval(kbHintTimer);
    kbHintTimer = setInterval(cycleHint, 10_000);
  }
}

function openKeyboard() {
  $('keyboardModal').classList.remove('hidden');
  paintKeyboard();
  showHint();
  // Only while it is open. A timer left running against a hidden panel is a
  // wakeup every ten seconds for nothing.
  clearInterval(kbHintTimer);
  kbHintTimer = setInterval(cycleHint, 10_000);
}

function closeKeyboard() {
  $('keyboardModal').classList.add('hidden');
  keyboardState.held = null;
  clearInterval(kbHintTimer);
  kbHintTimer = null;
}

$('visWindowClose').onclick = closeVisWindow;
$('kbClose').onclick = closeKeyboard;
$('kbHint').onclick = nudgeHint;

/// Draggable by its header, because a floating panel that cannot be moved is a
/// panel sitting on top of whatever you wanted to look at.
(() => {
  const panel = $('keyboardModal');
  const head = $('kbDrag');
  if (!panel || !head) return;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    head.classList.add('dragging');
    const box = panel.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (ev) => {
      // Placed from the top-left once dragged, so the centring transform has to
      // go — otherwise it fights the pointer by half the panel's width.
      panel.style.transform = 'none';
      panel.style.bottom = 'auto';
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - box.width, ev.clientX - dx))}px`;
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
    };
    const up = () => {
      head.classList.remove('dragging');
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
})();

/// Handle a keystroke as a note. Returns true if it was one.
///
/// **Live whenever a sound is open in Edit**, not only while the window is
/// showing — the window is the picture of the layout, not a mode you have to be
/// in to play. There is one app-wide binding besides these (space, for the
/// transport) and none of these letters is it, so the keyboard was free to take.
///
/// Modifiers are always let through: `⌘Z` is undo and must stay undo.
function noteKeys(e) {
  if (state.mode !== 'edit' || !state.selectedFile) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); shiftOctave(-1); return true; }
  if (k === 'x') { e.preventDefault(); shiftOctave(1); return true; }
  const at = NOTE_KEYS.findIndex(([n]) => n === k);
  if (at < 0) return false;
  e.preventDefault();
  if (!e.repeat) playNote(at);
  return true;
}

document.addEventListener('keydown', (e) => {
  // 1 — the field owns it.
  if (inTextField(e.target)) return;

  // The ask dialog has the event already; reacting here as well is how Enter
  // used to confirm a dialog and change section in the same keystroke.
  if (!$('askModal').classList.contains('hidden')) return;

  // The note keyboard. Before the overlay tier so the Keys window can stay open
  // while you play, and after the text-field guard so typing a name is typing a
  // name. Escape is never a note.
  if (e.key !== 'Escape' && noteKeys(e)) return;

  // 2 — something is open. Escape closes exactly one thing, and stops.
  const dismiss = topOverlay();
  if (dismiss) {
    if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
    if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
    return;
  }

  // 3 — the shortcuts.
  const mod = e.metaKey || e.ctrlKey;

  if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }

  else if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); $('undoBtn').click(); }
  else if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); $('redoBtn').click(); }

  else if (mod && e.key === '`') { e.preventDefault(); op('crop')(); }
  else if (mod && !e.shiftKey && e.key.toLowerCase() === 'x' && state.mode === 'edit') { e.preventDefault(); op('cut')(); }
  else if (mod && !e.shiftKey && e.key.toLowerCase() === 'c' && state.mode === 'edit' && state.sel) { e.preventDefault(); copyCmd(); }
  else if (mod && !e.shiftKey && e.key.toLowerCase() === 'v' && state.mode === 'edit') { e.preventDefault(); pasteCmd(); }
  else if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && state.mode === 'edit' && state.sel) { e.preventDefault(); deleteCmd(); }
  else if (mod && !e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); goTo(); }
  else if (mod && e.shiftKey && e.key === ']') { e.preventDefault(); fitSelection(); }

  else if (!mod && e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); zoomToSample(false); }
  else if (!mod && e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); zoomToSample(true); }

  // Scoped to Edit, and given a `preventDefault` it never had. A bare letter
  // with a consequence has no business firing while you are browsing.
  else if (!mod && e.key === 'm' && state.mode === 'edit') { e.preventDefault(); addMarker(); }

  else if (!mod && e.key === 'Enter' && state.selectedFile) {
    e.preventDefault();
    setMode(state.mode === 'edit' ? 'overview' : 'edit');
  }

  // Nothing is open, so Escape means deselect. This is the branch that used to
  // fire underneath every dialog on the page.
  else if (e.key === 'Escape') {
    state.sel = null; setCue(0); drawSelection(); applyLoop();
  }
});


