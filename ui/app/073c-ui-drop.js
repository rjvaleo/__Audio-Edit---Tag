// ================================================================ the one dropdown
//
// Phase 5: one dropdown for the whole app, Wave's `.wv-pick` trigger and its
// `.wv-menu` panel. It replaces the native `<select>` wherever a page has been
// moved onto it. The spec is `ui-audit/phase5/controls.html`.
//
// The trigger comes at the three heights: 20 in dense rows, 24 for most, 28 for
// a page's main choice. Open, it sinks into the well with an edge in `--on`.
// The menu: groups in mono capitals, items 24 px, the chosen one ticked in
// `--on`, the keyboard's place a lit row. ↑ ↓ move, ↵ chooses, Esc closes, and
// letters find: over twelve items the menu narrows to what matches.
//
// `uiDrop(select, o)` puts the trigger in front of a `<select>` that stays
// where it was, invisible: code and tests that read its value, set it, fill
// its options or listen for its `change` go on doing exactly that, and the
// trigger follows. `uiMenuOpen` is the menu on its own.

/// The menu that is open, if one is: { el, close }.
let UI_MENU = null;

function uiMenuClose() {
  const m = UI_MENU;
  if (!m) return;
  UI_MENU = null;
  m.close();
}

/// Open the menu under `anchor`. `o`:
///   groups: [{ label, items: [{ label, value, pic, hint, off }] }];
///   value: the chosen one; onPick(value); onClose(); w: its least width.
function uiMenuOpen(anchor, o) {
  uiMenuClose();
  const all = o.groups.flatMap((g) => g.items);
  const big = all.length > 12;
  const el = document.createElement('div');
  el.className = 'ui-menu';
  el.setAttribute('role', 'listbox');
  document.body.appendChild(el);
  let q = '', kf = Math.max(0, all.findIndex((it) => it.value === o.value && !it.off)), qAt = 0;
  const shown = () => (q && big ? all.filter((it) => it.label.toLowerCase().includes(q)) : all);
  const draw = () => {
    const vis = new Set(shown());
    let html = big ? `<div class="ui-find"><i>⌕</i><span>${uiEsc(q) || '<i>type to find</i>'}</span><span class="ui-sp"></span><b>${q ? `${vis.size} of ${all.length}` : all.length}</b></div>` : '';
    for (const g of o.groups) {
      const items = g.items.filter((it) => vis.has(it));
      if (!items.length) continue;
      if (g.label) html += `<div class="ui-mg">${uiEsc(g.label)}</div>`;
      for (const it of items) {
        const i = all.indexOf(it);
        html += `<div class="ui-mi${it.value === o.value ? ' on' : ''}${i === kf ? ' kf' : ''}${it.off ? ' off' : ''}" data-i="${i}" role="option" aria-selected="${it.value === o.value}">`
          + `<span class="ui-ck">${it.value === o.value ? '✓' : ''}</span>${it.pic || ''}<span class="ui-mt">${uiEsc(it.label)}</span>${it.hint != null ? `<span class="ui-mk">${uiEsc(it.hint)}</span>` : ''}</div>`;
      }
    }
    if (!vis.size) html += '<div class="ui-mi off"><span class="ui-ck"></span><span class="ui-mt">nothing matches</span></div>';
    html += '<div class="ui-mf"><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> choose</span><span><kbd>esc</kbd> close</span>'
      + `${big ? '<span>type to find</span>' : ''}</div>`;
    el.innerHTML = html;
    el.querySelector('.ui-mi.kf')?.scrollIntoView({ block: 'nearest' });
  };
  const place = () => {
    const r = anchor.getBoundingClientRect();
    el.style.minWidth = `${Math.max(o.w || 0, r.width)}px`;
    const h = el.offsetHeight, below = innerHeight - r.bottom - 8;
    el.style.left = `${Math.max(4, Math.min(r.left, innerWidth - el.offsetWidth - 4))}px`;
    el.style.top = `${below >= Math.min(h, 240) || r.top < h ? r.bottom + 4 : r.top - h - 4}px`;
    el.style.maxHeight = `${Math.max(120, below >= Math.min(h, 240) || r.top < h ? below : r.top - 12)}px`;
  };
  const pick = (i) => {
    const it = all[i];
    if (!it || it.off) return;
    uiMenuClose();
    o.onPick(it.value);
  };
  const step = (d) => {
    const list = shown().filter((it) => !it.off);
    if (!list.length) return;
    let at = list.indexOf(all[kf]);
    at = at < 0 ? (d > 0 ? 0 : list.length - 1) : (at + d + list.length) % list.length;
    kf = all.indexOf(list[at]);
    draw();
  };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); uiMenuClose(); anchor.focus?.(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' || (e.key === ' ' && !q)) { e.preventDefault(); e.stopPropagation(); pick(kf); anchor.focus?.(); return; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); const l = shown().filter((it) => !it.off); kf = all.indexOf(e.key === 'Home' ? l[0] : l.at(-1)); draw(); return; }
    if (e.key === 'Backspace' && q) { e.preventDefault(); e.stopPropagation(); q = q.slice(0, -1); draw(); place(); return; }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      q = (big || now - qAt < 800 ? q : '') + e.key.toLowerCase();
      qAt = now;
      const hit = all.find((it) => !it.off && (big ? it.label.toLowerCase().includes(q) : it.label.toLowerCase().startsWith(q)));
      if (hit) kf = all.indexOf(hit);
      draw();
      place();
    }
  };
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) uiMenuClose(); };
  const away = (e) => { if (!el.contains(e.target)) uiMenuClose(); };
  el.addEventListener('pointerdown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => { const mi = e.target.closest('.ui-mi[data-i]'); if (mi) pick(+mi.dataset.i); });
  el.addEventListener('pointermove', (e) => {
    const mi = e.target.closest('.ui-mi[data-i]:not(.off)');
    if (mi && +mi.dataset.i !== kf) { kf = +mi.dataset.i; el.querySelectorAll('.ui-mi.kf').forEach((x) => x.classList.remove('kf')); mi.classList.add('kf'); }
  });
  document.addEventListener('keydown', key, true);
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', uiMenuClose);
  document.addEventListener('scroll', away, true);
  UI_MENU = {
    el,
    close: () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', uiMenuClose);
      document.removeEventListener('scroll', away, true);
      el.remove();
      o.onClose?.();
    },
  };
  draw();
  place();
  return UI_MENU;
}

const UI_SELECT = { value: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value'), selectedIndex: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex') };

/// A `<select>`'s options as the menu's groups.
function uiSelectGroups(sel, picOf) {
  const groups = [];
  let loose = null;
  const item = (op) => ({ label: op.textContent.trim(), value: op.value, off: op.disabled, pic: picOf ? picOf(op.value, true) : '' });
  for (const n of sel.children) {
    if (n.tagName === 'OPTGROUP') {
      loose = null;
      groups.push({ label: n.label, items: [...n.children].filter((op) => !op.hidden).map(item) });
    } else if (n.tagName === 'OPTION' && !n.hidden) {
      if (!loose) groups.push(loose = { label: '', items: [] });
      loose.items.push(item(n));
    }
  }
  return groups;
}

/// The dropdown, in front of a `<select>`. `o`:
///   h (20 | 24 | 28, 24 by default); w (px; otherwise the select's own width,
///   if it has one when this runs); label (words in the trigger before the
///   choice); pic(value) → an SVG for the choice; mono (the choice in mono);
///   text(value, option) → what the trigger says; cls.
/// Returns the trigger. The select keeps its value, its options and its events.
function uiDrop(sel, o = {}) {
  if (!sel || sel._ui) return sel?._ui;
  const h = [20, 24, 28].includes(o.h) ? o.h : 24;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ui-dd h${h}${o.mono ? ' mono' : ''}${o.cls ? ' ' + o.cls : ''}`;
  b.setAttribute('aria-haspopup', 'listbox');
  b.setAttribute('aria-expanded', 'false');
  if (sel.id) b.dataset.for = sel.id;
  b.innerHTML = `${o.label ? `<span class="ui-dl">${uiEsc(o.label)}</span>` : ''}<span class="ui-dp"></span><span class="ui-dt"></span><svg class="ui-dc" viewBox="0 0 8 5" aria-hidden="true"><path d="M1 1L4 4L7 1"/></svg>`;
  const w = o.w || (sel.offsetWidth > 0 ? sel.offsetWidth : 0);
  if (w) b.style.width = `${w}px`;
  sel.after(b);
  sel.classList.add('ui-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  sel._ui = b;
  b._sel = sel;
  const dt = b.querySelector('.ui-dt'), dp = b.querySelector('.ui-dp');
  const refresh = () => {
    const op = sel.options[UI_SELECT.selectedIndex.get.call(sel)];
    const v = UI_SELECT.value.get.call(sel);
    const t = o.text ? o.text(v, op) : (op ? op.textContent.trim() : '');
    if (dt.textContent !== t) dt.textContent = t;
    const p = o.pic ? o.pic(v) : '';
    if (dp.innerHTML !== p) dp.innerHTML = p;
    dp.hidden = !p;
    b.disabled = sel.disabled;
    b.hidden = sel.hidden || sel.style.display === 'none';
    b.title = sel.title || t;
    if (sel.getAttribute('aria-label')) b.setAttribute('aria-label', sel.getAttribute('aria-label'));
  };
  // Code that sets the value, rather than a person, fires nothing: the
  // trigger hears it here instead.
  Object.defineProperty(sel, 'value', { configurable: true, get() { return UI_SELECT.value.get.call(this); }, set(v) { UI_SELECT.value.set.call(this, v); refresh(); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return UI_SELECT.selectedIndex.get.call(this); }, set(v) { UI_SELECT.selectedIndex.set.call(this, v); refresh(); } });
  sel.addEventListener('change', refresh);
  sel.addEventListener('input', refresh);
  new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
  const open = () => {
    if (b.disabled) return;
    if (UI_MENU && b.classList.contains('open')) { uiMenuClose(); return; }
    b.classList.add('open');
    b.setAttribute('aria-expanded', 'true');
    uiMenuOpen(b, {
      groups: uiSelectGroups(sel, o.pic),
      value: UI_SELECT.value.get.call(sel),
      w: o.menuW,
      onPick: (v) => {
        if (UI_SELECT.value.get.call(sel) === v) return;
        UI_SELECT.value.set.call(sel, v);
        refresh();
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      },
      onClose: () => { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); },
    });
  };
  b.addEventListener('click', open);
  b.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && !b.classList.contains('open')) { e.preventDefault(); open(); }
  });
  b.refresh = refresh;
  refresh();
  return b;
}
