// ================================================================ the preset bar
//
// One preset bar for the whole app (phase 4, design (b) Compact, RJ 11 Nov 2026):
// the name box with ‹ › and a click for the list, A/B where the page has it,
// Save (lit when the preset has been edited), a ⋯ menu with Save as…, Rename…,
// Init and Delete…, and a slot for the page's own extras. Grain, Chop, Wave's
// patch, the Wave FX board, Prism and Visual all use it.
//
// The bar knows nothing about where presets live. The page hands it an
// **adapter**, and storage stays wherever the page kept it (the server, the
// engine, the browser):
//
//   list()            [{ name, tag?, factory? }]: factory first, then yours
//   refresh()         optional, async: read the list again (before the list opens)
//   current()         the loaded preset's name, or '' for none
//   label(), tag()    optional: what the name box says when it is not current()
//   dirty()           optional: edited since it was loaded; or
//   snapshot()        optional: the settings, compared with those at load
//   load(item)        async
//   save(name)        async: these settings over the loaded preset (saveAs when absent)
//   saveAs(name)      async: these settings under a new name, which becomes current
//   rename(from, to)  async
//   remove(name)      async: Delete; always asked first
//   init()            async: the page's own starting point
//   listExtras(foot)  optional: the page's own options, in the list's footer
//
// A factory preset can't be renamed or deleted, and Save on one asks for a name.
// The list, the menu and the name and delete asks are `106-preset-bar-pop.js`.

const PBAR = { bars: [], pop: null, last: null, timer: 0 };

const PBAR_ICON = {
  prev: 'M7.5 2.5 L4 6 L7.5 9.5',
  next: 'M4.5 2.5 L8 6 L4.5 9.5',
  caret: 'M3.2 4.6L6 7.4L8.8 4.6',
  save: 'M2 2H8L10 4V10H2Z M4 2V4.6H7V2 M4 10V7H8V10',
  saveAs: 'M2 2H7.4L9 3.6V5.2 M2 2V10H5.6 M4 2V4.4H6.6V2 M9 7V11 M7 9H11',
  rename: 'M2 10L2.6 7.8L7.8 2.6L9.4 4.2L4.2 9.4Z M6.8 3.6L8.4 5.2',
  init: 'M3 2.6V5.6H6 M3.3 5.6A3.4 3.4 0 1 0 4.2 3.1',
  del: 'M2.4 3.4H9.6 M4.6 3.4V2.2H7.4V3.4 M3.4 3.4L3.9 10H8.1L8.6 3.4',
  search: 'M5.2 1.8A3.4 3.4 0 1 1 5.2 8.6A3.4 3.4 0 1 1 5.2 1.8Z M7.7 7.7L10.4 10.4',
  lock: 'M3 5.6H9V10.4H3Z M4.2 5.6V4A1.8 1.8 0 0 1 7.8 4V5.6',
  check: 'M2.4 6.4L4.8 8.8L9.6 3.4',
  dice: 'M2 2H10V10H2Z',
  dup: 'M4.2 4.2H10V10H4.2Z M2 7.8V2H7.8',
};

const pbarSvg = (d, cls = '') => `<svg class="pbar-i ${cls}" viewBox="0 0 12 12" aria-hidden="true"><path d="${d}"/></svg>`;
const pbarDots = '<svg class="pbar-i pbar-f" viewBox="0 0 12 12" aria-hidden="true"><circle cx="2.6" cy="6" r="1.1"/><circle cx="6" cy="6" r="1.1"/><circle cx="9.4" cy="6" r="1.1"/></svg>';
const PBAR_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const pbarEsc = (s) => String(s ?? '').replace(/[&<>\u0022]/g, (c) => PBAR_ESC[c]);

function pbarH(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/// A button in the bar's own style, for a page's extras: `icon` is a path in a
/// 12 × 12 box, or markup. The page gives it its id.
function pbarButton(icon, label, title) {
  const pic = !icon ? '' : icon.startsWith('<') ? icon : pbarSvg(icon);
  return pbarH(`<button type="button" class="pbar-btn pbar-act" title="${pbarEsc(title)}">${pic}${pbarEsc(label)}</button>`);
}

/// Make a bar. `o`: { id, adapter, nouns: ['preset', 'presets'], ab: { get(), set(k) },
/// extras: [elements], size: 'mini', title, deleteNote }. Element ids start with
/// `id`: `${id}Pb` the bar, `${id}AB` its A/B.
function pbarMake(o) {
  const a = o.adapter, mini = o.size === 'mini';
  const [one, many] = o.nouns || ['preset', 'presets'];
  const el = pbarH(`<div class="pbar${mini ? ' mini' : ''}" id="${o.id}Pb" data-pbar="${o.id}" role="group" aria-label="${pbarEsc(o.title || 'Presets')}">
    <div class="pbar-name">
     <button type="button" class="pbar-ib" data-pb="prev" title="Previous ${one}" aria-label="Previous ${one}">${pbarSvg(PBAR_ICON.prev)}</button>
     <button type="button" class="pbar-open" data-pb="open" title="${pbarEsc(o.title || 'Presets')}: click for the list" aria-haspopup="dialog">
      <span class="pbar-nm"><b data-pb="label"></b><i class="pbar-dirty" data-pb="dirty" hidden title="Edited since it was loaded"></i><span class="pbar-tg" data-pb="tag"></span></span>${pbarSvg(PBAR_ICON.caret, 'pbar-cr')}</button>
     <button type="button" class="pbar-ib" data-pb="next" title="Next ${one}" aria-label="Next ${one}">${pbarSvg(PBAR_ICON.next)}</button>
    </div>
    ${o.ab ? `<div class="pbar-seg" id="${o.id}AB" title="A / B: two settings to compare"><button type="button" data-ab="A" title="A: compare two settings">A</button><button type="button" data-ab="B" title="B: a second setting to compare against A">B</button></div>` : ''}
    <button type="button" class="pbar-btn pbar-act${mini ? ' pbar-sq' : ''}" data-pb="save" title="Save: these settings over the ${one}" aria-label="Save">${pbarSvg(PBAR_ICON.save)}${mini ? '' : 'Save'}</button>
    <button type="button" class="pbar-btn pbar-sq" data-pb="more" title="More: Save as, Rename, Init, Delete" aria-label="More" aria-haspopup="menu">${pbarDots}</button>
    ${o.extras?.length ? '<span class="pbar-vsep"></span><div class="pbar-x"></div>' : ''}
   </div>`);
  if (o.extras?.length) el.querySelector('.pbar-x').append(...o.extras);
  const q = (k) => el.querySelector(`[data-pb="${k}"]`);
  const bar = { o, a, el, one, many, mini, base: undefined, baseFor: null, until: 0, at: 0, shown: '' };

  bar.list = () => { try { return a.list() || []; } catch { return []; } };
  bar.item = (name) => bar.list().find((p) => p.name === name) || null;
  bar.locked = () => { const c = a.current(); return !c || !!bar.item(c)?.factory; };
  bar.snap = () => { try { return a.snapshot ? JSON.stringify(a.snapshot()) : ''; } catch { return ''; } };
  /// What is loaded now is the clean state: dirty is measured from here. For a
  /// moment after, too, while what was loaded finishes landing.
  bar.settle = () => { bar.base = bar.snap(); bar.baseFor = a.current(); bar.until = performance.now() + 500; };
  bar.dirty = () => {
    if (!a.current()) return false;
    if (a.dirty) return !!a.dirty();
    return !!a.snapshot && bar.base !== undefined && bar.snap() !== bar.base;
  };
  bar.mark = () => {
    const cur = a.current();
    if (cur !== bar.baseFor || performance.now() < bar.until) {
      if (cur !== bar.baseFor) bar.until = performance.now() + 500;
      bar.base = bar.snap();
      bar.baseFor = cur;
    }
    const label = (a.label ? a.label() : cur) || `No ${one}`;
    const tag = a.tag ? a.tag() : bar.item(cur)?.tag || '';
    const fac = !!cur && !!bar.item(cur)?.factory;
    const d = bar.dirty();
    const key = `${label}|${tag}|${fac}|${d}|${o.ab ? o.ab.get() : ''}`;
    if (key === bar.shown) return;
    bar.shown = key;
    q('label').textContent = label;
    q('tag').innerHTML = (fac ? pbarSvg(PBAR_ICON.lock, 'pbar-lk') + 'Factory' : '') + (fac && tag ? ' · ' : '') + pbarEsc(tag);
    q('open').title = `${label}${tag ? ' · ' + tag : ''}${d ? ' (edited)' : ''}: click for the list`;
    q('dirty').hidden = !d;
    q('save').classList.toggle('lit', d);
    if (o.ab) el.querySelectorAll('.pbar-seg [data-ab]').forEach((b) => b.classList.toggle('on', b.dataset.ab === o.ab.get()));
  };
  /// Run one of the adapter's verbs: the bar repainted after, and a failure
  /// said rather than thrown.
  bar.run = async (f, settle = true) => {
    try { await f(); } catch (e) { pbarSay(e?.message || String(e)); }
    if (settle) bar.settle();
    bar.shown = '';
    bar.mark();
  };
  bar.load = (p) => bar.run(() => a.load(p));
  bar.step = async (by) => {
    if (a.refresh && !bar.list().length) await bar.run(() => a.refresh(), false);
    const L = bar.list();
    if (!L.length) return;
    const i = L.findIndex((p) => p.name === a.current());
    await bar.load(L[i < 0 ? (by > 0 ? 0 : L.length - 1) : (i + by + L.length) % L.length]);
  };
  bar.save = () => {
    if (bar.locked()) { pbarAskName(bar, 'saveAs'); return; }
    const name = a.current();
    bar.run(() => (a.save ? a.save(name) : a.saveAs(name)));
  };

  el.addEventListener('pointerdown', () => { PBAR.last = bar; });
  q('prev').onclick = () => bar.step(-1);
  q('next').onclick = () => bar.step(1);
  q('open').onclick = () => (PBAR.pop?.bar === bar && PBAR.pop.kind === 'list' ? pbarClose() : pbarOpenList(bar));
  q('save').onclick = () => bar.save();
  q('more').onclick = () => (PBAR.pop?.bar === bar && PBAR.pop.kind === 'menu' ? pbarClose() : pbarOpenMenu(bar));
  if (o.ab) {
    el.querySelectorAll('.pbar-seg [data-ab]').forEach((b) => {
      b.onclick = async () => { await o.ab.set(b.dataset.ab); bar.shown = ''; bar.mark(); };
    });
  }
  PBAR.bars.push(bar);
  if (!PBAR.timer) PBAR.timer = setInterval(pbarTick, 250);
  bar.settle();
  bar.mark();
  return bar;
}

/// The bars on screen keep their name, tag and edited light current.
function pbarTick() {
  for (const b of PBAR.bars) {
    if (!b.el.isConnected || !b.el.getClientRects().length) continue;
    try { b.mark(); } catch (e) { if (!b.failed) { b.failed = true; console.error('[preset bar]', e); } }
  }
}

function pbarSay(s) {
  if (typeof toast === 'function') toast(s);
}

/// The bar the keys act on: the one last touched, if it is on screen, else the
/// first full-size one that is.
function pbarKeyBar() {
  const shown = (b) => b.el.isConnected && b.el.getClientRects().length > 0;
  if (PBAR.last && shown(PBAR.last)) return PBAR.last;
  return PBAR.bars.find((b) => !b.mini && shown(b)) || null;
}

// F2 renames and ⇧⌘S saves as, on the page's bar, as the ⋯ menu shows them.
// Delete's ⌫ is the menu's only: on a page, Delete belongs to what is selected.
document.addEventListener('keydown', (e) => {
  if (PBAR.pop || inTextField(e.target)) return;
  const saveAs = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's';
  if (e.key !== 'F2' && !saveAs) return;
  const bar = pbarKeyBar();
  if (!bar) return;
  e.preventDefault();
  e.stopPropagation();
  if (saveAs) pbarAskName(bar, 'saveAs');
  else if (!bar.locked()) pbarAskName(bar, 'rename');
}, true);
