// ================================================================ the one bar
//
// Phase 5: one slider for the whole app, Grain's bar (`gsBar`) made the one bar.
// It replaces the native range inputs and the shell's `param` row wherever a
// page has been moved onto it. The spec is `ui-audit/phase5/controls.html`.
//
// A picture of the value (30 wide, in the facet's colour), then a well: the
// name on the left, the reading on the right, a fill with a 2 px edge in the
// facet's colour, filled from the centre when the value is bipolar. 24 px by
// default, 20 in dense panels.
//
// A click sets it, a drag follows, Shift is ten times finer (ticks show the
// fine scale while it is held), a double-click on the bar or its picture puts
// it back, the arrow keys nudge. While a source moves it, it is outlined in the
// source's colour with its reach as a strip along the bottom and the value the
// sound is at now as a mint dot.
//
// - `uiBar(o)`: the bar, on a value from 0 to 1.
// - `uiBarParam(…)`: the same contract as `param` (value in, format, change,
//   commit, log, default; `sync` and `read` back), so a caller changes its
//   builder and nothing else.

/// The bar. `o`:
///   label, title, h (24 | 20), w (px, or none to fill its column);
///   get() → 0…1; set(u, e) while it moves; commit() when it lands;
///   reset() for a double-click (or def: 0…1); text() → the reading;
///   pic(u) → the picture's SVG inside, on `pv` (30 × 22 by default); col
///   (`--gg`: the facet's colour); bip, or zero (0…1: where the fill starts);
///   step (an arrow key, 0.01); key, tgt,
///   cls, aria.
/// Returns the element, with `sync()`, `setMod(m)` and `setOff(b)`, as the knob.
function uiBar(o) {
  const el = document.createElement('div');
  const h = o.h === 20 ? 20 : 24;
  el.className = `ui-bar h${h}${o.cls ? ' ' + o.cls : ''}`;
  if (o.key != null) el.dataset.key = o.key;
  if (o.w) el.style.width = `${o.w}px`;
  if (o.col) el.style.setProperty('--gg', o.col);
  el.innerHTML = `${o.pic ? uiPic('', o.pv || '0 0 30 22', 'bar') : ''}<div class="ui-bw" role="slider" tabindex="0">`
    + '<i class="ui-bz"></i><i class="ui-bf"></i><i class="ui-bdef"></i><i class="ui-bfine"></i><i class="ui-bm"></i><i class="ui-bd"></i>'
    + '<span class="ui-bn"></span><b class="ui-bv"></b></div>';
  const w = el.querySelector('.ui-bw'), f = w.querySelector('.ui-bf'), pic = el.querySelector(':scope > .ui-pic');
  const nm = w.querySelector('.ui-bn'), rd = w.querySelector('.ui-bv'), z = w.querySelector('.ui-bz');
  const bm = w.querySelector('.ui-bm'), bd = w.querySelector('.ui-bd'), dn = w.querySelector('.ui-bdef');
  nm.textContent = o.label ?? '';
  w.setAttribute('aria-label', o.aria || o.label || '');
  if (o.tgt) w.dataset.tgt = o.tgt;
  el.title = o.title || `${o.label || ''} — click or drag, Shift for fine, double-click to reset`;
  const at = (u) => `calc(4px + (100% - 8px) * ${uiClamp(u).toFixed(4)})`;
  const defU = () => (o.def != null && Number.isFinite(o.def) ? o.def : null);
  let lastPic = null;
  const paint = () => {
    const n = uiClamp(o.get()), zero = uiClamp(o.zero ?? (o.bip ? 0.5 : 0)), a = Math.min(n, zero), b = Math.max(n, zero);
    f.style.left = at(a);
    f.style.width = `calc((100% - 8px) * ${(b - a).toFixed(4)})`;
    f.classList.toggle('neg', n < zero);
    z.style.display = zero > 0 && zero < 1 ? '' : 'none';
    z.style.left = at(zero);
    const t = o.text ? o.text() : `${Math.round(n * 100)} %`;
    if (rd.textContent !== t) rd.textContent = t;
    w.setAttribute('aria-valuetext', t);
    w.setAttribute('aria-valuenow', n.toFixed(3));
    if (defU() != null) dn.style.left = at(defU());
    const m = el._mod;
    el.classList.toggle('mapped', !!m);
    if (m) {
      if (m.col) el.style.setProperty('--mc', m.col);
      bm.style.left = at(n - m.rng);
      bm.style.width = `calc((100% - 8px) * ${(uiClamp(n + m.rng) - uiClamp(n - m.rng)).toFixed(4)})`;
      bd.style.display = m.live == null ? 'none' : '';
      if (m.live != null) bd.style.left = at(m.live);
    }
    if (pic && o.pic) {
      const s = o.pic(n);
      if (s !== lastPic) { pic.innerHTML = s; lastPic = s; }
    }
  };
  el.sync = paint;
  el.setMod = (m) => { el._mod = m && m.rng > 0 ? m : null; paint(); };
  el.setOff = (b) => el.classList.toggle('off', !!b);
  const move = (u, e) => { o.set(uiClamp(u), e); paint(); };
  w.addEventListener('pointerdown', (e) => {
    if (e.button || el.classList.contains('off')) return;
    e.preventDefault();
    w.focus({ preventScroll: true });
    w.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const r = w.getBoundingClientRect(), W = Math.max(1, r.width - 8);
    const nx = (ev) => uiClamp((ev.clientX - w.getBoundingClientRect().left - 4) / W);
    let lx = e.clientX, n = uiClamp(o.get());
    if (!e.shiftKey) { n = nx(e); move(n, e); }
    const mv = (ev) => {
      el.classList.toggle('fineon', ev.shiftKey);
      n = ev.shiftKey ? uiClamp(n + (ev.clientX - lx) / W * 0.1) : nx(ev);
      lx = ev.clientX;
      move(n, ev);
    };
    const up = () => {
      w.removeEventListener('pointermove', mv);
      w.removeEventListener('pointerup', up);
      w.removeEventListener('pointercancel', up);
      el.classList.remove('drag', 'fineon');
      o.commit?.();
    };
    w.addEventListener('pointermove', mv);
    w.addEventListener('pointerup', up);
    w.addEventListener('pointercancel', up);
  });
  const reset = (e) => {
    if (el.classList.contains('off')) return;
    e.preventDefault();
    if (o.reset) o.reset(); else if (defU() != null) o.set(defU(), e);
    paint();
    o.commit?.();
  };
  if (o.reset || defU() != null) {
    w.addEventListener('dblclick', reset);
    pic?.addEventListener('dblclick', reset);
  }
  w.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || el.classList.contains('off')) return;
    const s = (o.step || 0.01) * (e.shiftKey ? 0.1 : 1), n = uiClamp(o.get());
    const to = { ArrowRight: n + s, ArrowUp: n + s, ArrowLeft: n - s, ArrowDown: n - s, PageUp: n + 0.1, PageDown: n - 0.1, Home: 0, End: 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    move(to, e);
    o.commit?.();
  });
  paint();
  return el;
}

/// The bar, on `param`'s contract: the value itself in, `format` for its
/// reading, `onChange` while it moves, `onCommit` when it lands, `log`, `def`.
/// `o` adds the bar's own options (h, w, pic as `(u, v) → svg`, pv, col, cls,
/// title, bip, tgt). The element has `sync(v)` and `read()`, as `param`'s.
function uiBarParam(label, value, min, max, step, format, onChange, onCommit, log, def, o = {}) {
  const sc = uiScale(min, max, log);
  const q = (v) => (step > 0 && !log ? Math.round(v / step) * step : v);
  let v = value;
  const hasDef = def !== undefined && def !== null && Number.isFinite(def);
  const el = uiBar({
    ...o,
    label,
    get: () => sc.toU(v),
    set: (u) => { v = uiClamp(q(sc.toV(u)), Math.min(min, max), Math.max(min, max)); onChange(v); },
    commit: () => onCommit?.(v),
    reset: hasDef ? () => { v = def; onChange(def); } : null,
    def: hasDef ? sc.toU(def) : null,
    text: () => format(v),
    pic: o.pic ? (u) => o.pic(u, v) : null,
    zero: o.zero ?? (min < 0 && max > 0 ? sc.toU(0) : 0),
    step: o.step || (step > 0 && !log ? step / ((max - min) || 1) : 0.01),
    title: o.title || (hasDef ? `${label} — double-click to reset to ${format(def)}` : undefined),
  });
  el.sync = ((paint) => (x) => { if (x != null) v = x; paint(); })(el.sync);
  el.read = () => v;
  return el;
}

const UI_INPUT_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/// The bar over a native range input that stays where it is: `row` holds the
/// input as a child, and becomes the bar. The input is laid over the bar's well,
/// unseen, so a click, a drag, a double-click, the keys and every handler
/// already on it work exactly as before, and code and tests that read or set
/// its value go on doing so; the bar draws what it holds. `o`:
///   input (the range; `row`'s first otherwise); name and read: the elements
///   holding its name and reading, which the bar shows and follows (or label
///   and text(), as words); pic: the row's own picture element, set in front;
///   h (24 | 20); col (`--gg`); zero (0…1, where a bipolar fill starts); cls.
/// Returns the row, with `paint()`.
function uiBarOver(row, o = {}) {
  const input = o.input || row.querySelector('input[type=range]');
  if (!input || row._uiBar) return row;
  row._uiBar = 1;
  row.classList.add('ui-bar', 'ui-over', o.h === 20 ? 'h20' : 'h24');
  if (o.cls) row.classList.add(...o.cls.split(' '));
  if (o.col) row.style.setProperty('--gg', o.col);
  const w = document.createElement('div');
  w.className = 'ui-bw';
  w.setAttribute('aria-hidden', 'true');
  w.innerHTML = '<i class="ui-bz"></i><i class="ui-bf"></i><i class="ui-bfine"></i><i class="ui-bm"></i><i class="ui-bd"></i><span class="ui-bn"></span><b class="ui-bv"></b>';
  input.before(w);
  input.classList.add('ui-range');
  if (o.pic) o.pic.classList.add('ui-bpic');
  const f = w.querySelector('.ui-bf'), z = w.querySelector('.ui-bz'), nm = w.querySelector('.ui-bn'), rd = w.querySelector('.ui-bv');
  const at = (u) => `calc(4px + (100% - 8px) * ${uiClamp(u).toFixed(4)})`;
  const paint = () => {
    const lo = +input.min, hi = +input.max, v = +UI_INPUT_VALUE.get.call(input);
    const n = hi > lo ? uiClamp((v - lo) / (hi - lo)) : 0, zero = uiClamp(o.zero ?? 0), a = Math.min(n, zero), b = Math.max(n, zero);
    f.style.left = at(a);
    f.style.width = `calc((100% - 8px) * ${(b - a).toFixed(4)})`;
    f.classList.toggle('neg', n < zero);
    z.style.display = zero > 0 && zero < 1 ? '' : 'none';
    z.style.left = at(zero);
    const t = o.read ? o.read.textContent : o.text ? o.text() : '';
    if (rd.textContent !== t) rd.textContent = t;
    const l = o.name ? o.name.textContent : o.label ?? '';
    if (nm.textContent !== l) nm.textContent = l;
  };
  // Every way a value arrives, through `value` or an event.
  const own = Object.getOwnPropertyDescriptor(input, 'value') || UI_INPUT_VALUE;
  Object.defineProperty(input, 'value', { configurable: true, get() { return own.get.call(this); }, set(v) { own.set.call(this, v); paint(); } });
  input.addEventListener('input', paint);
  input.addEventListener('change', paint);
  input.addEventListener('pointerdown', () => row.classList.add('drag'));
  input.addEventListener('pointerup', () => row.classList.remove('drag'));
  input.addEventListener('lostpointercapture', () => row.classList.remove('drag'));
  for (const el of [o.read, o.name]) if (el) new MutationObserver(paint).observe(el, { childList: true, characterData: true, subtree: true });
  row.paint = paint;
  paint();
  return row;
}

/// A loose range input, put in a row of its own and made a bar (`uiBarOver`).
function uiBarRange(input, o = {}) {
  if (!input || input._uiRow) return input?._uiRow;
  const row = document.createElement('span');
  input.before(row);
  row.appendChild(input);
  input._uiRow = row;
  return uiBarOver(row, { ...o, input });
}
