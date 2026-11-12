// ================================================================ the one switch
//
// Phase 5: one segmented switch for the whole app, Wave's `.wv-seg`: a well,
// 2 px in, the chosen one raised with a 2 px underline in `--on`. Words, icons
// (14 × 10, stroked in `--on` when chosen) or both; two to six choices (more is
// a dropdown); frames of 20, 24 and 28 px. The spec is
// `ui-audit/phase5/controls.html`.
//
// The look is the class: `.ui-seg` with `h20`, `h24` or `h28`, and its choices
// as children with `.on` on the chosen one. A switch that already keeps its
// own state takes the class and keeps its wiring; `uiSeg` builds a new one.

/// A choice's small picture: `d` is a path on 14 × 10.
const uiSegIcon = (d, w = 14, h = 10) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/></svg>`;

/// The switch. `o`:
///   items: [{ k, label, icon (a path on 14 × 10, or an SVG), title }];
///   value; onPick(k, e); h (20 | 24 | 28; 24); fill (fills its column); cls.
/// Returns the element, with `set(k)` to show a choice made elsewhere and
/// `value()`.
function uiSeg(o) {
  const el = document.createElement('div');
  el.className = `ui-seg h${[20, 24, 28].includes(o.h) ? o.h : 24}${o.fill ? ' fill' : ''}${o.cls ? ' ' + o.cls : ''}`;
  el.setAttribute('role', 'radiogroup');
  let v = o.value;
  el.innerHTML = o.items.map((it) => {
    const ic = it.icon ? (it.icon.trim().startsWith('<') ? it.icon : uiSegIcon(it.icon)) : '';
    return `<span role="radio" tabindex="-1" data-k="${uiEsc(it.k)}"${it.title ? ` title="${uiEsc(it.title)}"` : ''}>${ic}${it.label != null ? uiEsc(it.label) : ''}</span>`;
  }).join('');
  const items = [...el.children];
  const show = () => items.forEach((s, i) => {
    const on = String(o.items[i].k) === String(v);
    s.classList.toggle('on', on);
    s.setAttribute('aria-checked', on);
    s.tabIndex = on ? 0 : -1;
  });
  items.forEach((s, i) => {
    s.addEventListener('click', (e) => {
      if (el.classList.contains('off')) return;
      v = o.items[i].k;
      show();
      o.onPick?.(v, e);
    });
    s.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const n = items[(i + d + items.length) % items.length];
      n.focus();
      n.click();
    });
  });
  el.set = (k) => { v = k; show(); };
  el.value = () => v;
  show();
  return el;
}
