// ================================================================ the preset bar's pop-ups
//
// What opens from the bar (`105-preset-bar.js`): the list (search, Factory, then
// Yours, with keys), the ⋯ menu, and the two asks — a name, for Save as and
// Rename, and are you sure, for Delete. One open at a time. They are laid on the
// page itself, fixed under what opened them, so a page scaled to fit or a header
// that clips does not clip them.

function pbarClose() {
  const p = PBAR.pop;
  if (!p) return;
  PBAR.pop = null;
  p.el.remove();
  p.from?.classList.remove('open');
  if (p.focus?.isConnected && document.activeElement && p.el.contains(document.activeElement)) p.focus.focus({ preventScroll: true });
}

/// Show `el` under `from` (above it if there is no room), and close it on a
/// click anywhere else.
function pbarShow(bar, kind, el, from) {
  pbarClose();
  el.classList.add('pbar-pop');
  el.dataset.pbarFor = bar.o.id;
  document.body.appendChild(el);
  from.classList.add('open');
  PBAR.pop = { bar, kind, el, from, focus: from };
  const r = from.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  const top = r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); pbarClose(); }
  });
}

window.addEventListener('pointerdown', (e) => {
  const p = PBAR.pop;
  if (p && !p.el.contains(e.target) && !p.from.contains(e.target)) pbarClose();
}, true);
window.addEventListener('resize', () => pbarClose());

// ─────────────────────────────────────────────────────────────── the list

async function pbarOpenList(bar) {
  if (bar.a.refresh) await bar.run(() => bar.a.refresh(), false);
  const all = bar.list(), cur = bar.a.current();
  const el = pbarH(`<div class="pbar-list" role="dialog" aria-label="${pbarEsc(bar.many)}">
    <label class="pbar-search">${pbarSvg(PBAR_ICON.search)}<input type="text" spellcheck="false" autocomplete="off" placeholder="Search ${all.length} ${all.length === 1 ? bar.one : bar.many}" aria-label="Search"><span class="pbar-kbd">/</span></label>
    <div class="pbar-rows" role="listbox"></div>
    <div class="pbar-foot"><span class="pbar-count"></span><span class="pbar-sp"></span><span class="pbar-kbd">↑↓</span> move <span class="pbar-kbd">⏎</span> load <span class="pbar-kbd">esc</span></div>
   </div>`);
  const rows = el.querySelector('.pbar-rows'), input = el.querySelector('input');
  if (bar.a.listExtras) {
    const x = document.createElement('span');
    x.className = 'pbar-fx';
    bar.a.listExtras(x);
    el.querySelector('.pbar-count').after(x);
  }
  let shown = [], hov = -1;
  const paint = () => {
    const f = input.value.trim().toLowerCase();
    shown = all.filter((p) => !f || p.name.toLowerCase().includes(f) || String(p.tag || '').toLowerCase().includes(f));
    rows.innerHTML = '';
    const group = (title, list, lock) => {
      rows.appendChild(pbarH(`<div class="pbar-grp">${lock ? pbarSvg(PBAR_ICON.lock, 'pbar-lk') : ''}${title}<span class="pbar-gn">${list.length}</span></div>`));
      for (const p of list) {
        const i = shown.indexOf(p);
        const r = pbarH(`<div class="pbar-row${p.name === cur ? ' cur' : ''}" role="option" data-i="${i}" aria-selected="${p.name === cur}">${p.name === cur ? pbarSvg(PBAR_ICON.check, 'pbar-ck') : '<span class="pbar-ck0"></span>'}<span class="pbar-rn"></span><span class="pbar-rt"></span></div>`);
        r.querySelector('.pbar-rn').textContent = p.name;
        r.querySelector('.pbar-rt').textContent = p.tag || '';
        r.title = p.name;
        r.onclick = () => { pbarClose(); bar.load(p); };
        r.onpointermove = () => { if (hov !== i) { hov = i; mark(); } };
        rows.appendChild(r);
      }
    };
    const fac = shown.filter((p) => p.factory), mine = shown.filter((p) => !p.factory);
    if (fac.length || all.some((p) => p.factory)) group('Factory', fac, true);
    group('Yours', mine, false);
    if (!mine.length) {
      rows.appendChild(pbarH(`<div class="pbar-none">${f ? 'Nothing matches' : `None yet: Save as… keeps these settings`}</div>`));
    }
    el.querySelector('.pbar-count').textContent = `${shown.length} ${shown.length === 1 ? bar.one : bar.many}`;
    hov = Math.max(0, shown.findIndex((p) => p.name === cur));
    if (!shown.length) hov = -1;
    mark();
  };
  const mark = () => rows.querySelectorAll('.pbar-row').forEach((r) => {
    const on = +r.dataset.i === hov;
    r.classList.toggle('hov', on);
    if (on) r.scrollIntoView({ block: 'nearest' });
  });
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) hov = (hov + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = shown[hov];
      if (p) { pbarClose(); bar.load(p); }
    }
  });
  el.addEventListener('keydown', (e) => { if (e.key === '/' && e.target !== input) { e.preventDefault(); input.focus(); } });
  pbarShow(bar, 'list', el, bar.el.querySelector('.pbar-name'));
  paint();
  input.focus({ preventScroll: true });
}

// ─────────────────────────────────────────────────────────────── the menu

function pbarOpenMenu(bar) {
  const locked = bar.locked(), a = bar.a;
  const items = [
    { k: 'saveAs', l: 'Save as…', key: '⇧⌘S', icon: PBAR_ICON.saveAs, act: () => pbarAskName(bar, 'saveAs') },
    { k: 'rename', l: 'Rename…', key: 'F2', icon: PBAR_ICON.rename, dis: locked || !a.rename, act: () => pbarAskName(bar, 'rename') },
    { k: 'init', l: 'Init', key: '', icon: PBAR_ICON.init, dis: !a.init, act: () => bar.run(() => a.init()) },
    { sep: true },
    { k: 'delete', l: 'Delete…', key: '⌫', icon: PBAR_ICON.del, dis: locked || !a.remove, danger: true, act: () => pbarAskDelete(bar) },
  ];
  const el = pbarH('<div class="pbar-menu" role="menu" tabindex="-1"></div>');
  for (const it of items) {
    if (it.sep) { el.appendChild(pbarH('<div class="pbar-msep" role="separator"></div>')); continue; }
    const why = locked ? (bar.a.current() ? 'A factory preset can\'t be changed' : `No ${bar.one} is loaded`) : '';
    const m = pbarH(`<div class="pbar-mi${it.danger ? ' danger' : ''}${it.dis ? ' dis' : ''}" role="menuitem" data-mi="${it.k}" aria-disabled="${!!it.dis}"${it.dis && why ? ` title="${pbarEsc(why)}"` : ''}>${pbarSvg(it.icon)}<span class="pbar-ml">${it.l}</span><span class="pbar-mk">${it.key}</span></div>`);
    m.onclick = () => { if (it.dis) return; pbarClose(); it.act(); };
    el.appendChild(m);
  }
  const live = () => [...el.querySelectorAll('.pbar-mi:not(.dis)')];
  let hov = -1;
  const mark = () => live().forEach((m, i) => m.classList.toggle('hov', i === hov));
  el.addEventListener('pointermove', (e) => { const m = e.target.closest('.pbar-mi'); hov = live().indexOf(m); mark(); });
  el.addEventListener('keydown', (e) => {
    const L = live();
    const go = (k) => { const it = items.find((x) => x.k === k); if (it && !it.dis) { e.preventDefault(); pbarClose(); it.act(); } };
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hov = (hov + (e.key === 'ArrowDown' ? 1 : -1) + L.length) % L.length; mark(); }
    else if (e.key === 'Enter' && L[hov]) { e.preventDefault(); L[hov].click(); }
    else if (e.key === 'F2') go('rename');
    else if (e.key === 'Backspace' || e.key === 'Delete') go('delete');
    else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') go('saveAs');
  });
  pbarShow(bar, 'menu', el, bar.el.querySelector('[data-pb="more"]'));
  el.focus({ preventScroll: true });
}

// ─────────────────────────────────────────────────────────────── the asks

/// A name, for Save as or Rename: typed in place, Enter keeps it, Esc goes.
function pbarAskName(bar, kind) {
  const a = bar.a, cur = a.current(), rename = kind === 'rename';
  if (rename && (bar.locked() || !a.rename)) return;
  const L = bar.list();
  let base = rename ? cur : (cur || (a.label ? a.label() : '') || `${bar.one[0].toUpperCase()}${bar.one.slice(1)} ${L.filter((p) => !p.factory).length + 1}`);
  if (!rename && bar.item(base)?.factory) base = `${base} (mine)`;
  const el = pbarH(`<div class="pbar-ask" role="dialog" aria-label="${rename ? 'Rename' : 'Save as'}">
    <div class="pbar-askh">${rename ? `Rename “${pbarEsc(cur)}”` : `Save these settings as`}</div>
    <input type="text" class="pbar-field" spellcheck="false" autocomplete="off" aria-label="Name">
    <div class="pbar-note"></div>
    <div class="pbar-askb"><button type="button" class="pbar-btn" data-a="no">Cancel</button><button type="button" class="pbar-btn lit" data-a="ok">${rename ? 'Rename' : 'Save'}</button></div>
   </div>`);
  const input = el.querySelector('input'), ok = el.querySelector('[data-a="ok"]'), note = el.querySelector('.pbar-note');
  input.value = base;
  const check = () => {
    const n = input.value.trim(), hit = L.find((p) => p.name === n);
    let why = '', bad = false;
    if (!n) { bad = true; }
    else if (hit?.factory) { bad = true; why = 'A factory preset has that name: choose another'; }
    else if (rename && hit && n !== cur) { bad = true; why = 'That name is taken'; }
    else if (!rename && hit) why = `Replaces your “${n}”`;
    note.textContent = why;
    note.classList.toggle('bad', bad && !!why);
    ok.disabled = bad || (rename && n === cur);
    return !ok.disabled;
  };
  const go = () => {
    if (!check()) return;
    const n = input.value.trim();
    pbarClose();
    bar.run(() => (rename ? a.rename(cur, n) : a.saveAs(n)));
  };
  input.addEventListener('input', check);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  ok.onclick = go;
  el.querySelector('[data-a="no"]').onclick = () => pbarClose();
  pbarShow(bar, 'ask', el, bar.el.querySelector('.pbar-name'));
  check();
  input.focus({ preventScroll: true });
  input.select();
}

/// Delete asks first, always, and names what goes.
function pbarAskDelete(bar) {
  const a = bar.a, cur = a.current();
  if (bar.locked() || !a.remove) return;
  const el = pbarH(`<div class="pbar-ask" role="alertdialog" aria-label="Delete">
    <div class="pbar-askh">Delete “${pbarEsc(cur)}”?</div>
    <div class="pbar-note">${pbarEsc(bar.o.deleteNote || 'It can\'t be undone. The settings on screen stay as they are.')}</div>
    <div class="pbar-askb"><button type="button" class="pbar-btn" data-a="no">Cancel</button><button type="button" class="pbar-btn danger" data-a="ok">Delete</button></div>
   </div>`);
  el.querySelector('[data-a="ok"]').onclick = () => { pbarClose(); bar.run(() => a.remove(cur)); };
  el.querySelector('[data-a="no"]').onclick = () => pbarClose();
  el.tabIndex = -1;
  pbarShow(bar, 'ask', el, bar.el.querySelector('[data-pb="more"]'));
  el.querySelector('[data-a="no"]').focus({ preventScroll: true });
}
