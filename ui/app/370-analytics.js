// ============================================================ analytics: recording

/* How the app is used, so the interface can be shaped around what is actually
   used. See `docs/ANALYTICS.md`.

   Everything is caught from outside: listeners on the document in the capture
   phase, and thin wrappers round `setMode`, `selectFile`, `openInEditor` and
   `fetch`. No panel had to be edited to be counted, and a panel added later is
   counted without anyone remembering to.

   Cheap by construction. A drag is one event, not one per pixel; events wait
   in memory and go to the app's own server every ten seconds, never anywhere
   else. Nothing here runs in the audio or drawing path. */

const AN_IDLE = 60_000;            // no input for this long is idle
const AN_SESSION_GAP = 30 * 60_000; // idle this long starts a new session
const AN_FLUSH_MS = 10_000;
const AN_FLUSH_AT = 200;

/// The containers that count as panels, most specific first. A control belongs
/// to the nearest one above it.
const AN_PANELS = {
  grainControls: 'Stretch › Grains', stretchParams: 'Stretch › Time', grainShape: 'Stretch › Shape',
  grainPitch: 'Stretch › Pitch', extPanel: 'Stretch › Extended', dockStretch: 'Stretch',
  fxPicker: 'Effect picker', fxModuleRail: 'Effects rack', dockEffects: 'Effects',
  hsPad: 'Prism pad', prismSettings: 'Prism settings', dockHyper: 'Prism',
  masterBus: 'Master bus', dockVisuals: 'Visuals', perfPanel: 'Performance',
  dockAutomation: 'Automation', dockRegions: 'Regions', dockChop: 'Chop', dock: 'Dock',
  menuBar: 'Menubar', menuPop: 'Menu', leftRail: 'Left rail', paneBrowse: 'Library',
  paneSearch: 'Search', paneRecord: 'Record', paneScan: 'Scan', paneTheme: 'Theme',
  paneImport: 'Import', paneInspect: 'Inspector', rightPanel: 'Tags',
  editTools: 'Edit tools', tabBar: 'Tabs', overview: 'Overview', ruler: 'Ruler', lane: 'Waveform',
  roomEdit: 'Room editor', roomView: 'Room', seqView: 'Sequencer', composeView: 'Compose',
  nowBar: 'Now Playing', transportBar: 'Transport', presetBar: 'Preset bar', visWindow: 'Grains window',
  keyboardModal: 'Keys', presetManager: 'Preset manager', exportLoop: 'Export loop',
  regions: 'Regions strip', statsView: 'Library stats', pickerModal: 'File picker',
  settingsModal: 'Settings', askModal: 'Dialog', analyticsView: 'Analytics',
};

const AN_CONTROL = 'input, select, textarea, button, [role="slider"], [role="tab"], [role="switch"], .knob, .param, .menu-row, canvas[id], a[href]';
const AN_CONTINUOUS = 'input[type="range"], [role="slider"], .knob, .param, canvas[id]';

const an = {
  on: true,
  queue: [],
  session: null,
  last: Date.now(),
  idle: false,
  page: null,                  // overrides state.mode while the analytics tab is open
  dock: 'stretch',
  gesture: null,
  keyGesture: null,
  catalogued: new Set(),
  rack: new Map(),             // file → [{id, kind, bypassed}] as last sent
  fetch: window.fetch.bind(window),
};

try { an.on = localStorage.getItem('mgl.analytics.paused') !== '1'; } catch {}

function anNewSession() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  an.session = `s-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/// Record one event. `fields` is merged in as it is; keep it small.
function track(k, fields = {}) {
  if (!an.on) return;
  const e = { t: Date.now(), s: an.session, k, m: an.page || state.mode, ...fields };
  if (e.m === 'edit' && !('dk' in e)) e.dk = an.dock;
  an.queue.push(e);
  if (an.queue.length >= AN_FLUSH_AT) anFlush();
}

function anFlush({ beacon = false } = {}) {
  if (!an.queue.length) return Promise.resolve();
  const batch = an.queue;
  an.queue = [];
  const body = JSON.stringify(batch);
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/analytics', new Blob([body], { type: 'application/json' }));
    return Promise.resolve();
  }
  return an.fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
    .catch(() => { an.queue = batch.concat(an.queue).slice(-5000); });
}

function anSetRecording(on) {
  if (!on) { track('session', { d: { paused: true } }); anFlush(); }
  an.on = on;
  try { localStorage.setItem('mgl.analytics.paused', on ? '0' : '1'); } catch {}
  if (on) track('session', { d: { resumed: true } });
}

// ------------------------------------------------------------- who is this

function anPanel(el) {
  const mod = el.closest('[data-kind]');
  if (mod && mod.closest('#fxModuleRail')) return `fx:${mod.dataset.kind}`;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.id && n.id in AN_PANELS) return n.id;
  }
  return 'page';
}

function anText(s) {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/// The label a person would use for the control.
function anLabel(el) {
  const holder = el.closest('.param, .knob, .ui-knob, .ui-bar, label');
  const k = holder?.querySelector('.k, .ui-kname');
  return anText(k?.textContent || el.getAttribute('aria-label') || el.labels?.[0]?.textContent
    || (el.title || '').split(/ [—–:-] /)[0] || (el.matches('input, select, canvas') ? '' : el.textContent) || el.id);
}

function anKind(el) {
  if (el.matches('.menu-row')) return 'menu';
  if (el.matches('[role="tab"]')) return 'tab';
  if (el.matches('input[type="range"]')) return 'slider';
  if (el.matches('[role="slider"], .knob, .param')) return 'knob';
  if (el.matches('input[type="checkbox"], [role="switch"]')) return 'switch';
  if (el.matches('input[type="radio"], select')) return 'segment';
  if (el.matches('canvas')) return 'pad';
  if (el.matches('input, textarea')) return 'field';
  if (el.matches('a')) return 'link';
  return 'button';
}

/// A name that is the same control tomorrow: its id when it has one, else
/// where it sits and what it is called.
function anId(el, panel, label) {
  if (el.id) return el.id;
  const d = el.dataset || {};
  const key = d.op || d.dock || d.rvtab || d.key || d.param || d.rk && label || label;
  return `${panel}/${key || anKind(el)}`;
}

function anControl(target) {
  const el = target instanceof Element ? target.closest(AN_CONTROL) : null;
  if (!el || el.closest('#analyticsView')) return null;
  // A knob's ring, its slider and its holder are one control. Buttons and
  // switches inside a holder stay themselves.
  const own = el.matches('button, select, input:not([type="range"]), textarea, a, .menu-row, [role="slider"]');
  const ctl = own ? el : el.closest('.knob, .param') || el;
  const p = anPanel(ctl);
  const l = anLabel(ctl);
  const named = el.id ? el : ctl;
  return { el: ctl, c: anId(named, p, l), ck: anKind(el.matches('input[type="range"]') ? el : ctl), p, l };
}

function anValue(el) {
  if (!el.matches('input')) el = el.querySelector('input[type="range"]') || el;
  if (el.matches('input[type="range"], input[type="number"]')) return +el.value;
  const ring = el.matches('[role="slider"]') ? el : el.querySelector('[role="slider"]');
  const now = ring?.getAttribute('aria-valuenow');
  if (now != null && now !== '') return +now;
  const txt = ring?.getAttribute('aria-valuetext') || el.querySelector('.v, .ui-kval, .ui-bv')?.textContent || '';
  const n = parseFloat(txt.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function anBounds(el) {
  if (!el.matches('input')) el = el.querySelector('input[type="range"]') || el;
  if (el.matches('input[type="range"]')) return { lo: +el.min || 0, hi: el.max === '' ? 100 : +el.max };
  const r = el.matches('[role="slider"]') ? el : el.querySelector('[role="slider"]');
  const lo = r?.getAttribute('aria-valuemin'), hi = r?.getAttribute('aria-valuemax');
  return lo != null && hi != null ? { lo: +lo, hi: +hi } : {};
}

// ------------------------------------------------------------- activity

function anActivity() {
  const now = Date.now();
  if (an.idle) {
    const gap = now - an.last;
    an.idle = false;
    if (gap >= AN_SESSION_GAP) {
      track('session', { d: { end: true, idle: gap } });
      anNewSession();
      track('session', { d: { start: true, w: innerWidth, h: innerHeight } });
    } else {
      track('idle', { d: { end: true, ms: gap } });
    }
  }
  an.last = now;
}

setInterval(() => {
  if (!an.idle && Date.now() - an.last > AN_IDLE) {
    an.idle = true;
    if (an.on) an.queue.push({ t: an.last + AN_IDLE, s: an.session, k: 'idle', m: an.page || state.mode, d: { start: true } });
  }
}, 5000);

// Sent when the browser has nothing better to do, never in the middle of a frame.
const anIdleCall = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
setInterval(() => anIdleCall(() => { anMouseFlush(); anFlush(); }, { timeout: 5000 }), AN_FLUSH_MS);

// ------------------------------------------------------------- where the mouse is

/* A heat map of the pointer, per page. The move listener stores two numbers and
   nothing else; a timer four times a second adds the latest position to a
   coarse grid, and only when the pointer moved and the window can be seen.
   The grids are sent with the batch as one event per page, not one per sample. */

const AN_GRID_W = 96, AN_GRID_H = 60, AN_SAMPLE_MS = 250;
const anMouse = { x: -1, y: -1, moved: false, grids: new Map() };

function anGrid(m) {
  let g = anMouse.grids.get(m);
  if (!g) { g = { move: new Uint32Array(AN_GRID_W * AN_GRID_H), click: new Uint32Array(AN_GRID_W * AN_GRID_H), any: false }; anMouse.grids.set(m, g); }
  return g;
}

function anCell(x, y) {
  const cx = Math.min(AN_GRID_W - 1, Math.max(0, Math.floor(x / innerWidth * AN_GRID_W)));
  const cy = Math.min(AN_GRID_H - 1, Math.max(0, Math.floor(y / innerHeight * AN_GRID_H)));
  return cy * AN_GRID_W + cx;
}

document.addEventListener('pointermove', (e) => { anMouse.x = e.clientX; anMouse.y = e.clientY; anMouse.moved = true; }, { capture: true, passive: true });
document.addEventListener('pointerdown', (e) => {
  if (!an.on) return;
  const g = anGrid(an.page || state.mode);
  g.click[anCell(e.clientX, e.clientY)]++;
  g.any = true;
}, { capture: true, passive: true });

setInterval(() => {
  if (!anMouse.moved || !an.on || document.hidden) return;
  anMouse.moved = false;
  const g = anGrid(an.page || state.mode);
  g.move[anCell(anMouse.x, anMouse.y)]++;
  g.any = true;
}, AN_SAMPLE_MS);

/// Sparse: [cell, count, cell, count, …] for the cells that have anything.
function anSparse(a) {
  const out = [];
  for (let i = 0; i < a.length; i++) if (a[i]) out.push(i, a[i]);
  return out;
}

function anMouseFlush() {
  for (const [m, g] of anMouse.grids) {
    if (!g.any) continue;
    if (an.on) an.queue.push({ t: Date.now(), s: an.session, k: 'mouse', m, d: { gw: AN_GRID_W, gh: AN_GRID_H, w: innerWidth, h: innerHeight, move: anSparse(g.move), click: anSparse(g.click) } });
    g.move.fill(0); g.click.fill(0); g.any = false;
  }
}

// ------------------------------------------------------------- gestures

function anGestureStart(ctl) {
  const v = anValue(ctl.el);
  an.gesture = { ...ctl, from: v, min: v, max: v, n: 0, t0: Date.now(), seen: 0 };
}

function anGestureSample() {
  const g = an.gesture;
  if (!g) return;
  const v = anValue(g.el);
  if (v == null) return;
  g.n++;
  if (g.min == null || v < g.min) g.min = v;
  if (g.max == null || v > g.max) g.max = v;
}

function anGestureEnd(g) {
  if (!g) return;
  const to = anValue(g.el);
  if (to != null) {
    if (g.min == null || to < g.min) g.min = to;
    if (g.max == null || to > g.max) g.max = to;
  }
  // A press that moved nothing is a click, not an adjustment: dropped here,
  // and counted by the click handler if the control is clickable.
  if (to === g.from && g.n === 0) return;
  const b = anBounds(g.el);
  track('ctl', { c: g.c, ck: g.ck, p: g.p, l: g.l, from: g.from, to, min: g.min, max: g.max, n: g.n, ms: Date.now() - g.t0, ...b });
}

document.addEventListener('pointerdown', (e) => {
  anActivity();
  const ctl = anControl(e.target);
  if (ctl && ctl.el.matches(AN_CONTINUOUS)) anGestureStart(ctl);
}, { capture: true, passive: true });

document.addEventListener('pointermove', () => {
  const g = an.gesture;
  if (!g) return;
  const now = performance.now();
  if (now - g.seen < 50) return;   // twenty readings a second is plenty
  g.seen = now;
  anGestureSample();
}, { capture: true, passive: true });

const anPointerUp = () => {
  const g = an.gesture;
  an.gesture = null;
  anGestureEnd(g);
};
document.addEventListener('pointerup', anPointerUp, { capture: true, passive: true });
document.addEventListener('pointercancel', anPointerUp, { capture: true, passive: true });

// Sliders moved from the keyboard or wheel arrive as input without a press:
// gathered the same way, closed after a pause.
document.addEventListener('input', (e) => {
  if (an.gesture) { anGestureSample(); return; }
  const ctl = anControl(e.target);
  if (!ctl || !ctl.el.matches(AN_CONTINUOUS)) return;
  anActivity();
  let g = an.keyGesture;
  if (!g || g.el !== ctl.el) {
    if (g) { clearTimeout(g.timer); anGestureEnd(g); }
    g = an.keyGesture = { ...ctl, from: null, min: null, max: null, n: 0, t0: Date.now() };
  }
  const v = anValue(ctl.el);
  if (v != null) {
    g.n++;
    if (g.min == null || v < g.min) g.min = v;
    if (g.max == null || v > g.max) g.max = v;
    if (g.from == null) g.from = v;
  }
  clearTimeout(g.timer);
  g.timer = setTimeout(() => { an.keyGesture = null; anGestureEnd(g); }, 800);
}, { capture: true, passive: true });

document.addEventListener('change', (e) => {
  const ctl = anControl(e.target);
  if (!ctl) return;
  const el = ctl.el;
  if (el.matches('input[type="checkbox"]')) track('toggle', { c: ctl.c, ck: 'switch', p: ctl.p, l: ctl.l, to: el.checked });
  else if (el.matches('select, input[type="radio"]')) track('seg', { c: ctl.c, ck: 'segment', p: ctl.p, l: ctl.l, to: anText(el.value) });
  else if (el.matches('input:not([type="range"]), textarea')) track('field', { c: ctl.c, ck: 'field', p: ctl.p, l: ctl.l });
}, { capture: true, passive: true });

document.addEventListener('click', (e) => {
  const ctl = anControl(e.target);
  if (!ctl) return;
  const el = ctl.el;
  if (el.matches('input[type="range"], input[type="checkbox"], input[type="radio"], select, input, textarea, canvas, [role="slider"], .knob, .param')) return;
  if (el.dataset.dock) { anDock(el.dataset.dock); return; }
  if (el.matches('.menu-row')) {
    track('menu', { c: `menu/${ctl.l}`, ck: 'menu', p: 'menuPop', l: ctl.l });
    return;
  }
  if (el.matches('[role="tab"]')) { track('view', { c: ctl.c, ck: 'tab', p: ctl.p, l: ctl.l }); return; }
  track('click', { c: ctl.c, ck: ctl.ck, p: ctl.p, l: ctl.l });
}, { capture: true, passive: true });

function anChord(e) {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.metaKey && 'Cmd', e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('-');
}

document.addEventListener('keydown', (e) => {
  anActivity();
  if (e.repeat || ['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'].includes(e.key)) return;
  const typing = e.target.matches?.('input:not([type="range"]):not([type="checkbox"]), textarea, [contenteditable]');
  // What is typed into a field is nobody's business; only chords are kept there.
  if (typing && !(e.metaKey || e.ctrlKey)) return;
  const chord = anChord(e);
  track('key', { c: `key/${chord}`, ck: 'shortcut', p: 'keyboard', l: chord });
}, { capture: true, passive: true });

document.addEventListener('wheel', anActivity, { capture: true, passive: true });

// ------------------------------------------------------------- pages and tabs

let anPageSince = Date.now();
let anDockSince = Date.now();

function anPageChange(to) {
  const from = an.page || state.mode;
  if (from === to) return;
  const now = Date.now();
  track('mode', { m: to, d: { from, dwell: now - anPageSince } });
  anPageSince = now;
  anCatalogueSoon();
}

function anDock(to) {
  if (to === an.dock) return;
  const now = Date.now();
  track('dock', { c: `dock/${to}`, ck: 'tab', p: 'presetBar', l: to, dk: to, d: { from: an.dock, dwell: now - anDockSince } });
  an.dock = to;
  anDockSince = now;
  anCatalogueSoon();
}

/// Wrap a global function so its calls are recorded first. Calls by name, from
/// anywhere, resolve to the wrapper; the original is kept for the real work.
function anWrap(name, before) {
  const orig = window[name];
  if (typeof orig !== 'function') return;
  window[name] = function (...args) {
    try { before(...args); } catch {}
    return orig.apply(this, args);
  };
}

anWrap('setMode', (mode) => { if (!an.page) anPageChange(mode); });
anWrap('selectFile', (file) => { if (file?.path) track('file', { d: { name: anFileName(file.path), how: 'select' } }); });
anWrap('openInEditor', (file) => { if (file?.path) track('file', { d: { name: anFileName(file.path), how: 'edit' } }); });

/// The library-relative name only, never where the library is.
function anFileName(p) {
  return String(p).split('/').slice(-2).join('/');
}

// ------------------------------------------------------------- server calls

/// What a request to the server *means*, for the requests that are actions.
const AN_ROUTES = {
  '/api/edit': (b) => ['edit', { d: { op: b?.op } }],
  '/api/export': () => ['export', { d: { kind: 'mix' } }],
  '/api/export/stem': () => ['export', { d: { kind: 'stem' } }],
  '/api/video': () => ['export', { d: { kind: 'video' } }],
  '/api/presets': (b) => ['preset', { d: { op: 'save', name: anText(b?.name) } }],
  '/api/presets/apply': (b) => ['preset', { d: { op: 'load', name: anText(b?.name) } }],
  '/api/presets/update': (b) => ['preset', { d: { op: 'update', name: anText(b?.name) } }],
  '/api/presets/duplicate': (b) => ['preset', { d: { op: 'duplicate', name: anText(b?.name) } }],
  '/api/presets/delete': (b) => ['preset', { d: { op: 'delete', name: anText(b?.name) } }],
  '/api/capture': () => ['record', { d: { op: 'capture' } }],
  '/api/record': (b) => ['record', { d: { op: b?.op || b?.action || 'record' } }],
  '/api/chop/save': () => ['edit', { d: { op: 'chop-save' } }],
};

function anRack(b) {
  if (!b || !Array.isArray(b.slots)) return;
  const now = b.slots.map((s) => ({ id: s.id, kind: s.kind, bypassed: !!s.bypassed }));
  const was = an.rack.get(b.p);
  an.rack.set(b.p, now);
  if (!was) return;   // the first sight of a file's rack is loading it, not changing it
  const before = new Map(was.map((s, i) => [s.id, { ...s, i }]));
  const after = new Map(now.map((s, i) => [s.id, { ...s, i }]));
  for (const [id, s] of after) {
    const o = before.get(id);
    if (!o) track('fx.add', { p: 'fxModuleRail', d: { fx: s.kind, slot: s.i } });
    else if (o.bypassed !== s.bypassed) track('fx.bypass', { p: 'fxModuleRail', d: { fx: s.kind, on: !s.bypassed } });
  }
  for (const [id, o] of before) if (!after.has(id)) track('fx.remove', { p: 'fxModuleRail', d: { fx: o.kind, slot: o.i } });
  const order = (m) => [...m.keys()].filter((id) => before.has(id) && after.has(id));
  if (order(before).join() !== order(after).join()) track('fx.move', { p: 'fxModuleRail' });
}

window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input?.url || '';
  const method = (init?.method || input?.method || 'GET').toUpperCase();
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const res = an.fetch(input, init);
  if (path.startsWith('/api/analytics')) return res;
  // Only the few action routes are looked at; the engine's own traffic, which
  // can be many requests a second, passes straight through untouched.
  const m = method === 'POST' && (AN_ROUTES[path] || (path === '/api/rack' && anRack));
  if (m) {
    try {
      const b = typeof init?.body === 'string' && init.body.length < 200_000 ? JSON.parse(init.body) : null;
      if (m === anRack) anRack(b);
      else { const [k, f] = m(b); track(k, f); }
    } catch {}
  }
  res.then((r) => {
    if (!r.ok && r.status !== 404 && r.status !== 503) track('error', { d: { path, status: r.status } });
  }, () => {});
  return res;
};

window.addEventListener('error', (e) => track('error', { d: { msg: anText(e.message).slice(0, 200), at: `${(e.filename || '').split('/').pop()}:${e.lineno}` } }));
window.addEventListener('unhandledrejection', (e) => track('error', { d: { msg: anText(String(e.reason?.message || e.reason)).slice(0, 200) } }));

// ------------------------------------------------------------- long frames

/* Frames the browser itself reports as long (50 ms or more), with the script
   that held them where it says. A PerformanceObserver: the browser does the
   measuring whether anyone listens or not, so this adds no timing loop. At most
   thirty a minute are kept — a page that is janking says so in the first few. */

let anLofMinute = 0, anLofCount = 0;

function anLongFrame(entry) {
  const minute = Math.floor(Date.now() / 60_000);
  if (minute !== anLofMinute) { anLofMinute = minute; anLofCount = 0; }
  if (++anLofCount > 30) return;
  const script = (entry.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
  const src = script ? anText(script.sourceFunctionName || script.invoker || (script.sourceURL || '').split('/').pop()) : '';
  track('lof', { ms: Math.round(entry.duration), block: Math.round(entry.blockingDuration || 0), ...(src ? { src } : {}) });
}

try {
  const Observer = window.PerformanceObserver;
  const types = Observer?.supportedEntryTypes || [];
  const type = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : null;
  if (type) new Observer((list) => { if (an.on) for (const e of list.getEntries()) anLongFrame(e); }).observe({ type, buffered: false });
} catch { /* a browser without it simply reports none */ }

// ------------------------------------------------------------- what is on screen

let anCatTimer = 0;

function anCatalogueSoon() {
  clearTimeout(anCatTimer);
  anCatTimer = setTimeout(() => (window.requestIdleCallback || setTimeout)(anCatalogue), 1500);
}

/// Every control currently on screen that has not been sent yet, so that the
/// ones never touched can be named.
function anCatalogue() {
  if (!an.on) return;
  const controls = [];
  for (const node of document.querySelectorAll(AN_CONTROL)) {
    if (node.offsetParent === null || node.closest('#analyticsView, #menuPop')) continue;
    const ctl = anControl(node);
    if (!ctl || an.catalogued.has(ctl.c)) continue;
    an.catalogued.add(ctl.c);
    controls.push({ c: ctl.c, ck: ctl.ck, p: ctl.p, l: ctl.l, ...anBounds(ctl.el) });
  }
  if (controls.length) {
    an.fetch('/api/analytics/catalogue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ controls }) }).catch(() => {});
  }
}

// ------------------------------------------------------------- start

anNewSession();
track('session', { d: { start: true, w: innerWidth, h: innerHeight } });
anCatalogueSoon();
window.addEventListener('pagehide', () => {
  track('session', { d: { end: true } });
  anMouseFlush();
  anFlush({ beacon: true });
});

/// For the tests, and for anyone asking from the console.
window.analytics = { track, flush: () => { anMouseFlush(); return anFlush(); }, catalogue: anCatalogue, state: an, mouse: anMouse };
