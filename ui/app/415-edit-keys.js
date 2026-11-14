// ═══════════════════════════════ the Edit page: the pie, and ⌘K ══
//
// Right-click on the wave opens a pie of the eight commands a selection most
// often wants, round the pointer, with ⌘K in its middle. ⌘K, anywhere on the
// Edit page, is every command by name, with the knobs of the ones that have
// settings right in their row. Elsewhere right-click is still the Edit menu.
// See `docs/EDIT-PAGE.md`.

const ED_PIE = ['cut', 'copy', 'paste', 'delete', 'crop', 'reverse', 'normalize', 'region'];

function edPieOpen(x, y) {
  const pie = $('edPie');
  pie.style.left = `${Math.max(110, Math.min(innerWidth - 110, x))}px`;
  pie.style.top = `${Math.max(100, Math.min(innerHeight - 100, y))}px`;
  pie.innerHTML = ED_PIE.map((id, i) => {
    const a = -Math.PI / 2 + i / ED_PIE.length * Math.PI * 2, it = WT_CMDS[id];
    const ok = it.on ? it.on() : it.need === 'sel' ? !!state.sel : !!state.selectedFile;
    return `<button type="button" class="ed-w" data-cmd="${id}" ${ok ? '' : 'disabled'} title="${it.name}${it.key ? `  ${it.key}` : ''}" style="left:${(Math.cos(a) * 86).toFixed(1)}px;top:${(Math.sin(a) * 72).toFixed(1)}px">${wtIcon(id)}${WT_WORDS[id] || it.name}</button>`;
  }).join('') + '<button type="button" class="ed-w0" id="edPieAll" title="Every command  ⌘K" aria-label="Every command">⌘K</button>';
  pie.hidden = false;
}
function edPieClose() { const p = $('edPie'); if (p) p.hidden = true; }

(function wirePie() {
  const lane = $('lane'), pie = $('edPie');
  // In the capture phase, so on this page the pie is what right-click opens.
  lane.addEventListener('contextmenu', (e) => {
    if (!edOn()) return;
    e.preventDefault();
    e.stopPropagation();
    edPieOpen(e.clientX, e.clientY);
  }, true);
  pie.addEventListener('click', (e) => {
    if (e.target.closest('#edPieAll')) { edPieClose(); edKOpen(); return; }
    const b = e.target.closest('[data-cmd]');
    if (b && !b.disabled) { edPieClose(); edRun(b.dataset.cmd); }
  });
  window.addEventListener('mousedown', (e) => { if (!pie.hidden && !pie.contains(e.target)) edPieClose(); });
})();

// ──────────────────────────────────────────────────────────────── ⌘K

let edKRows = [], edKPick = 0;

function edKList() {
  const q = $('edKIn').value.trim().toLowerCase();
  const all = wtLayout.sections.flatMap((s) => s.ids.map((id) => ({ id, sec: s.title })))
    .concat(wtLayout.hidden.map((id) => ({ id, sec: 'Hidden' })));
  edKRows = all.filter(({ id, sec }) => {
    if (!q) return true;
    const it = WT_CMDS[id];
    return `${it.name} ${WT_WORDS[id] || ''} ${sec} ${id}`.toLowerCase().includes(q);
  });
  edKPick = Math.max(0, Math.min(edKPick, edKRows.length - 1));
  const box = $('edKList');
  box.replaceChildren(...edKRows.map(({ id, sec }, i) => {
    const it = WT_CMDS[id], ok = it.on ? it.on() : it.need === 'sel' ? !!state.sel && state.sel.end > state.sel.start : it.need === 'file' ? !!state.selectedFile : true;
    const row = document.createElement('div');
    row.className = `ed-kr${i === edKPick ? ' on' : ''}${ok ? '' : ' dis'}`;
    row.dataset.i = String(i);
    row.innerHTML = `${wtIcon(id)}<span class="ed-kg">${sec}</span><span class="ed-kn">${it.name}</span>`;
    const ks = edKnobsFor(id);
    if (ks.length) { const w = document.createElement('span'); w.className = 'ed-ks'; w.append(...ks); row.append(w); row.classList.add('wide'); }
    else if (it.key) row.insertAdjacentHTML('beforeend', `<kbd>${it.key}</kbd>`);
    return row;
  }));
  box.querySelector('.ed-kr.on')?.scrollIntoView({ block: 'nearest' });
}

function edKOpen() {
  const k = $('edK');
  k.hidden = false;
  $('edKIn').value = '';
  edKPick = 0;
  edKList();
  $('edKIn').focus();
}
function edKClose() { const k = $('edK'); if (k) k.hidden = true; }

function edKRun(i) {
  const r = edKRows[i];
  if (!r || $('edKList').children[i]?.classList.contains('dis')) return;
  edKClose();
  edRun(r.id);
}

(function wireK() {
  const k = $('edK'), inp = $('edKIn');
  $('edCmdK')?.addEventListener('click', edKOpen);
  inp.addEventListener('input', () => { edKPick = 0; edKList(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { edKPick = Math.min(edKRows.length - 1, edKPick + 1); edKList(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { edKPick = Math.max(0, edKPick - 1); edKList(); e.preventDefault(); }
    else if (e.key === 'Enter') { edKRun(edKPick); e.preventDefault(); }
    else if (e.key === 'Escape') { edKClose(); e.preventDefault(); e.stopPropagation(); }
  });
  $('edKList').addEventListener('click', (e) => {
    if (e.target.closest('.knob')) return;
    const r = e.target.closest('.ed-kr');
    if (r) edKRun(+r.dataset.i);
  });
  window.addEventListener('mousedown', (e) => { if (!k.hidden && !k.contains(e.target) && !e.target.closest('#edCmdK, #edPieAll')) edKClose(); });
  // ⌘K on the Edit page. In the capture phase and before the app's own keys,
  // which have nothing on it. Escape closes the pie or the list and stops.
  document.addEventListener('keydown', (e) => {
    if (!edOn()) return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); edKOpen(); }
    else if (e.key === 'Escape' && (!$('edPie').hidden || !k.hidden)) { edPieClose(); edKClose(); e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
