// ================================================================ the one knob
//
// Phase 5 of the consistency pass: one knob for the whole app, Wave's face as it
// is (RJ, 11 Nov 2026: face A). The spec is `ui-audit/phase5/controls.html`.
//
// Two sizes. **44 px** for the main controls of a section: the picture of what
// the value does sits in a dark well, the ring round it. **26 px** for rows of
// many: Wave's brushed cap with its pointer, the picture beside it.
//
// The ring is Wave's (`wvRing`, which this replaced): a track, the value arc
// with a soft glow, the modulation's reach just outside it in the source's
// colour and the value the sound is at now as a mint dot. Hovering shows a
// notch at the default. Drag up or down, Shift for fine, double-click for the
// default, the arrow keys to nudge.
//
// Two ways in:
// - `uiKnob(o)`: the knob and its behaviour, on a value from 0 to 1. Whoever
//   builds it keeps the value and says how to read, move and keep it.
// - `uiKnobParam(…)`: the same contract as `knob` and `param` (value in,
//   format, change, commit, log, default; `sync` and `read` back), so a caller
//   changes its builder and nothing else.
// Wave draws its own pictures on a canvas over the face, so it takes the markup
// (`uiKnobHtml`) and paints the ring itself (`uiKnobPaint`).

const UI_A0 = Math.PI * 0.75;
const UI_SWEEP = Math.PI * 1.5;
const uiClamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const uiR2 = (v) => (Math.round(v * 100) / 100).toString();
/// Text for HTML, from anything.
const UI_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\u0022': '&quot;' };
const uiEsc = (s) => String(s ?? '').replace(/[&<>\u0022]/g, (c) => UI_ESC[c]);

/// The ring's geometry for a knob `s` px across: Wave's, the ring 4 px in.
function uiRingGeo(s) {
  const c = s / 2, r = c - 4;
  return { c, r, mr: r + 3.5, w: s > 60 ? 3 : s >= 40 ? 2.4 : 2 };
}

/// An arc of the ring from `u0` to `u1` (0 to 1 of the sweep), at radius `r`.
function uiArc(c, r, u0, u1) {
  if (u1 - u0 < 0.0005) return '';
  const a = UI_A0 + UI_SWEEP * u0, b = UI_A0 + UI_SWEEP * u1;
  return `M${uiR2(c + r * Math.cos(a))} ${uiR2(c + r * Math.sin(a))}A${uiR2(r)} ${uiR2(r)} 0 ${b - a > Math.PI ? 1 : 0} 1 ${uiR2(c + r * Math.cos(b))} ${uiR2(c + r * Math.sin(b))}`;
}

/// The knob's body, as HTML: the cap (a dark well for a face, the brushed cap
/// otherwise), the ring, and whatever goes on top (Wave's canvas).
///   size: px across; face: the picture is inside; inner: HTML laid over it.
function uiKnobHtml({ size = 44, face = size >= 40, inner = '', cls = '' } = {}) {
  const g = uiRingGeo(size), inset = Math.round(size * 0.19);
  return `<div class="ui-kn s${size}${face ? ' face' : ''}${cls ? ' ' + cls : ''}" style="width:${size}px;height:${size}px">`
    + `<div class="ui-cap${face ? ' face' : ''}" style="inset:${inset}px"></div>`
    + `<svg class="ui-ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">`
    + `<path class="ui-tr" d="${uiArc(g.c, g.r, 0, 1)}" stroke-width="${g.w}"/><path class="ui-ar" stroke-width="${g.w}"/>`
    + '<path class="ui-md"/><circle class="ui-live" r="2.4"/><line class="ui-ptr"/><line class="ui-dn"/></svg>'
    + `${inner}</div>`;
}

/// Paint a knob's ring. `kn` is the `.ui-kn` element; the state:
///   u: the value, 0 to 1; bip: drawn from the centre; pointer: the cap's line;
///   mod: { rng, live, col } while a source moves it (rng is its reach either
///   side; live is where the sound is now; col the source's colour); def: the
///   default, for the notch.
function uiKnobPaint(kn, st) {
  const s = kn._s ||= (() => {
    const svg = kn.querySelector(':scope > .ui-ring');
    const q = (c) => svg.querySelector(c);
    return { svg, size: +svg.viewBox.baseVal.width, tr: q('.ui-tr'), ar: q('.ui-ar'), md: q('.ui-md'), live: q('.ui-live'), ptr: q('.ui-ptr'), dn: q('.ui-dn'), cap: kn.querySelector(':scope > .ui-cap'), last: {} };
  })();
  const { c, r, mr } = uiRingGeo(s.size), u = uiClamp(st.u || 0), o = st.bip ? 0.5 : 0;
  const key = `${u.toFixed(4)}|${st.bip ? 1 : 0}|${st.pointer ? 1 : 0}|${st.mod ? `${(+st.mod.rng).toFixed(4)},${st.mod.live == null ? '' : (+st.mod.live).toFixed(4)},${st.mod.col || ''}` : ''}|${st.def ?? ''}`;
  if (s.last.key === key) return;
  s.last.key = key;
  s.ar.setAttribute('d', uiArc(c, r, Math.min(o, u), Math.max(o, u)));
  if (s.cap) s.cap.style.setProperty('--v', (st.bip ? Math.abs(u - 0.5) * 2 : u).toFixed(3));
  const m = st.mod && st.mod.rng > 0 ? st.mod : null;
  kn.classList.toggle('mod', !!m);
  s.md.setAttribute('d', m ? uiArc(c, mr, uiClamp(u - m.rng), uiClamp(u + m.rng)) : '');
  if (m && m.col) kn.style.setProperty('--mc', m.col); else kn.style.removeProperty('--mc');
  if (m && m.live != null) {
    const a = UI_A0 + UI_SWEEP * uiClamp(m.live);
    s.live.setAttribute('cx', uiR2(c + Math.cos(a) * mr));
    s.live.setAttribute('cy', uiR2(c + Math.sin(a) * mr));
    s.live.style.display = '';
  } else s.live.style.display = 'none';
  if (st.pointer) {
    const a = UI_A0 + UI_SWEEP * u;
    s.ptr.setAttribute('x1', uiR2(c + Math.cos(a) * r * 0.2));
    s.ptr.setAttribute('y1', uiR2(c + Math.sin(a) * r * 0.2));
    s.ptr.setAttribute('x2', uiR2(c + Math.cos(a) * r * 0.62));
    s.ptr.setAttribute('y2', uiR2(c + Math.sin(a) * r * 0.62));
    s.ptr.style.display = '';
  } else s.ptr.style.display = 'none';
  if (st.def != null && Number.isFinite(st.def)) {
    const a = UI_A0 + UI_SWEEP * uiClamp(st.def);
    s.dn.setAttribute('x1', uiR2(c + Math.cos(a) * (r + 2)));
    s.dn.setAttribute('y1', uiR2(c + Math.sin(a) * (r + 2)));
    s.dn.setAttribute('x2', uiR2(c + Math.cos(a) * (r + 5)));
    s.dn.setAttribute('y2', uiR2(c + Math.sin(a) * (r + 5)));
  }
}

/// The picture, as an SVG: `inner` drawn on `vb` (an effect's 64 × 48 by default).
const uiPic = (inner, vb = '0 0 64 48', cls = '') => `<svg class="ui-pic${cls ? ' ' + cls : ''}" viewBox="${vb}" aria-hidden="true">${inner || ''}</svg>`;

/// The knob, with its behaviour. `o`:
///   label, title, size (44 | 26), layout ('under' | 'beside'), face;
///   get() → 0…1; set(u, e) while it moves; commit() when it lands;
///   reset() for a double-click (or def: the default, 0…1, which it sets);
///   text() → the reading; pic(u) → the picture's SVG inside, on `pv`;
///   bip; sens (px for the whole sweep, 160); fine (Shift divides by it, 5);
///   step (an arrow key, 0.01); wheel (it turns under the wheel);
///   key, tgt (a modulation target, as `data-tgt`), cls, col (`--gg`, the
///   facet's colour for the picture).
/// Returns the element, with `sync()` to repaint from `get`, `setMod(m)` for a
/// source's reach and live value, and `setOff(b)` for a control not in use.
function uiKnob(o) {
  const size = o.size || 44, face = o.face ?? size >= 40, layout = o.layout || 'under';
  const el = document.createElement('div');
  el.className = `ui-knob ${layout} s${size}${o.cls ? ' ' + o.cls : ''}`;
  if (o.key != null) el.dataset.key = o.key;
  if (o.col) el.style.setProperty('--gg', o.col);
  const side = o.pic && !face ? uiPic('', o.pv, 'side') : '';
  el.innerHTML = `<div class="ui-kr">${side}${uiKnobHtml({ size, face, inner: o.pic && face ? uiPic('', o.pv, 'in') : '' })}</div>`
    + `<span class="ui-lab"><span class="ui-kname"></span><b class="ui-kval"></b></span>`;
  const kn = el.querySelector('.ui-kn'), ring = kn.querySelector('.ui-ring');
  const pic = el.querySelector('.ui-pic'), name = el.querySelector('.ui-kname'), val = el.querySelector('.ui-kval');
  name.textContent = o.label ?? '';
  ring.removeAttribute('aria-hidden');
  ring.setAttribute('role', 'slider');
  ring.setAttribute('tabindex', '0');
  ring.setAttribute('aria-label', o.aria || o.label || '');
  if (o.tgt) kn.dataset.tgt = o.tgt;
  el.title = o.title || `${o.label || ''} — drag up or down, Shift for fine, double-click to reset`;
  const defU = () => (o.def != null && Number.isFinite(o.def) ? o.def : null);
  let lastPic = null;
  const paint = () => {
    const u = uiClamp(o.get());
    uiKnobPaint(kn, { u, bip: o.bip, pointer: !face, mod: el._mod, def: defU() });
    const t = o.text ? o.text() : `${Math.round(u * 100)} %`;
    if (val.textContent !== t) { val.textContent = t; val.title = t; }
    ring.setAttribute('aria-valuetext', t);
    if (pic && o.pic) {
      const s = o.pic(u);
      if (s !== lastPic) { pic.innerHTML = s; lastPic = s; }
    }
  };
  el.sync = paint;
  el.setMod = (m) => { el._mod = m && m.rng > 0 ? m : null; paint(); };
  el.setOff = (b) => el.classList.toggle('off', !!b);
  const move = (u, e) => { o.set(uiClamp(u), e); paint(); };
  const sens = o.sens || 160, fine = o.fine || 5;
  let y = 0, u = 0, on = false;
  kn.addEventListener('pointerdown', (e) => {
    if (e.button || el.classList.contains('off')) return;
    e.preventDefault();
    on = true;
    y = e.clientY;
    u = uiClamp(o.get());
    kn.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    ring.focus({ preventScroll: true });
  });
  kn.addEventListener('pointermove', (e) => {
    if (!on) return;
    u = uiClamp(u + (y - e.clientY) / (e.shiftKey ? sens * fine : sens));
    y = e.clientY;
    move(u, e);
  });
  const up = (e) => {
    if (!on) return;
    on = false;
    el.classList.remove('drag');
    try { kn.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    o.commit?.();
  };
  kn.addEventListener('pointerup', up);
  kn.addEventListener('pointercancel', up);
  const reset = (e) => {
    if (el.classList.contains('off')) return;
    e.preventDefault();
    if (o.reset) o.reset(); else if (defU() != null) o.set(defU(), e);
    paint();
    o.commit?.();
  };
  if (o.reset || defU() != null) {
    kn.addEventListener('dblclick', reset);
    if (pic && !face) pic.addEventListener('dblclick', reset);
  }
  ring.addEventListener('keydown', (e) => {
    const step = (o.step || 0.01) * (e.shiftKey ? 0.2 : 1);
    const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 0.1, PageDown: -0.1 }[e.key];
    if (d == null || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    move(uiClamp(o.get()) + d, e);
    o.commit?.();
  });
  if (o.wheel) {
    kn.addEventListener('wheel', (e) => {
      e.preventDefault();
      move(uiClamp(o.get()) - Math.sign(e.deltaY) * 0.03 * (e.shiftKey ? 0.2 : 1), e);
      o.commit?.();
    }, { passive: false });
  }
  paint();
  return el;
}

/// A value from `min` to `max`, on a log curve or not, as 0…1 and back.
function uiScale(min, max, log) {
  const lg = log && min > 0;
  return {
    toU: (v) => uiClamp(lg ? Math.log(Math.max(v, min) / min) / Math.log(max / min) : (v - min) / ((max - min) || 1)),
    toV: (u) => (lg ? min * Math.pow(max / min, u) : min + u * (max - min)),
  };
}

/// The knob, on `knob`'s and `param`'s contract: the value itself in, `format`
/// for its reading, `onChange` while it moves, `onCommit` when it lands, `log`
/// for a log curve, `def` for a double-click. `o` adds the knob's own options
/// (size, layout, pic as `(u, v) → svg`, pv, col, cls, title, bip, tgt, wheel).
/// The element has `sync(v)` to show a value from elsewhere and `read()`.
function uiKnobParam(label, value, min, max, step, format, onChange, onCommit, log, def, o = {}) {
  const sc = uiScale(min, max, log);
  const q = (v) => (step > 0 ? Math.round(v / step) * step : v);
  let v = value;
  const hasDef = def !== undefined && def !== null && Number.isFinite(def);
  const el = uiKnob({
    ...o,
    label,
    get: () => sc.toU(v),
    set: (u) => { v = q(sc.toV(u)); onChange(v); },
    commit: () => onCommit?.(v),
    reset: hasDef ? () => { v = def; onChange(def); } : null,
    def: hasDef ? sc.toU(def) : null,
    text: () => format(v),
    pic: o.pic ? (u) => o.pic(u, v) : null,
    bip: o.bip ?? (min < 0 && max > 0 && !log),
    title: o.title || (hasDef ? `${label} — double-click to reset to ${format(def)}` : undefined),
  });
  el.sync = ((paint) => (x) => { if (x != null) v = x; paint(); })(el.sync);
  el.read = () => v;
  return el;
}
