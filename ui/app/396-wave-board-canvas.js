// ========================================================= Wave: the board's canvas
//
// v8 (mock-up G). The FX view: a bar of board presets along the top; the
// library of the 82 effects and the five routing nodes down the left; the
// canvas in the middle, a grid you pan (drag the background) and zoom (the
// wheel, Fit, 100%), with the main path above it as a strip you reorder and
// the sources under that, to drag onto any control; the inspector on the
// right (`397-wave-board-inspector.js`). The model is `395-wave-board.js`.
//
// Patching: drag from an out (a node's right side) to an in (its left). One out
// feeds any number of ins; cables into one in are summed. Drag a node onto a
// cable to splice it in; ⌥-drag lifts a node out and joins its neighbours.
// Right-click the grid to add, a node to bypass, duplicate, replace or lift it,
// a cable to insert an effect on it. Delete removes what is selected.

/// The canvas's pan and zoom, what is selected, and which library groups are
/// open.
const WV_BOARD_VIEW = { x: 0, y: 0, z: 1, sel: null, open: new Set(['routing', 'reverb', 'delay']), note: 0 };
/// The canvases on the nodes and in the inspector, by what they draw.
const WV_BOARD_CV = { nodes: {}, insp: {} };

function wvBuildFx(view) {
  view.appendChild(wvH(`<div class="wv-panel wv-bbar">
   <span class="wv-nm">MASTER BUS</span>
   <div class="wv-preset wv-btn wv-bsel"><div class="wv-ib" id="wvBprev" title="Previous board"><svg viewBox="0 0 12 12"><path d="M8 2 L4 6 L8 10"/></svg></div><span class="pn" id="wvBname" title="Board name: double-click to rename"></span><span class="pt" id="wvBpos"></span><div class="wv-ib" id="wvBnext" title="Next board"><svg viewBox="0 0 12 12"><path d="M4 2 L8 6 L4 10"/></svg></div></div>
   <div class="wv-seg" id="wvBex"></div>
   <span class="wv-bt wv-btn" id="wvBsave" title="Save: keep this patch in this board"><svg viewBox="0 0 12 12"><path d="M2 2 H8.5 L10 3.5 V10 H2 Z M4 2 V4.5 H7.5 V2 M4 10 V7 H8 V10"/></svg>Save</span>
   <span class="wv-bt wv-btn" id="wvBsaveas" title="Save as: keep this patch as a new board">Save as</span>
   <span class="wv-bt wv-btn" id="wvBdup" title="Duplicate: a copy of this board to change">Duplicate</span>
   <span class="wv-bt wv-btn" id="wvBinit" title="Init: an empty board, the voice straight to Out">Init</span>
   <span class="wv-bt wv-btn" id="wvBrm" title="Remove: take this saved board off the list. The factory boards stay">Remove</span>
   <span class="wv-sp"></span>
   <span class="wv-hint wv-bnote"><svg viewBox="0 0 16 12"><path d="M1 6 C3 1,5 1,7 6 S11 11,13 6"/><circle cx="14" cy="6" r="1.4"/></svg>Each oscillator's own effect is on Play</span>
   <span class="wv-ro" id="wvBcount"></span></div>`));
  view.appendChild(wvH(`<div class="wv-fxmain">
   <div class="wv-panel wv-mod wv-flib">
    <div class="wv-mh"><span class="wv-nm">EFFECTS</span><span class="wv-sp"></span><span class="wv-ro" id="wvFxn"></span></div>
    <div class="wv-well wv-fsearch"><svg viewBox="0 0 12 12"><circle cx="5" cy="5" r="3.6"/><path d="M7.8 7.8 L11 11"/></svg><input id="wvFxq" placeholder="Search the effects" spellcheck="false" autocomplete="off"></div>
    <div class="wv-flist wv-scroll" id="wvFlist"></div></div>
   <div class="wv-panel wv-mod wv-fcan">
    <div class="wv-fchain" id="wvFchain"></div>
    <div class="wv-fstrip" id="wvFstrip"></div>
    <div class="wv-well wv-fwell wv-scroll" id="wvFwell"><div class="wv-world" id="wvWorld"></div>
     <div class="wv-fstat"><span class="note" id="wvFnote"></span><span class="wv-hint" id="wvFhint">Right-click to add · drag from an out to an in to patch · Delete removes · drag the grid to pan, wheel to zoom</span></div>
     <div class="wv-fzoom"><span class="wv-ib" id="wvZout" title="Zoom out">−</span><span class="wv-ro" id="wvZro">100 %</span><span class="wv-ib" id="wvZin" title="Zoom in">+</span><span class="wv-bt wv-btn" id="wvZfit" title="Fit the whole board">Fit</span><span class="wv-bt wv-btn" id="wvZ100" title="Actual size">100%</span></div></div></div>
   <div class="wv-panel wv-mod wv-finsp" id="wvFinsp"></div></div>`));
}

function wvWireFx() {
  wvBoardEnsure();
  wvWireBar();
  wvWireBoardCanvas();
  wvBuildLibrary();
  wvBuildFxStrip();
  wvRenderBoard();
}

/// The lit things on the view that follow the patch: called with the rest.
function wvSyncFx() {
  if (!WV.board) return;
  wvRenderBar();
}

// ─────────────────────────────────────────────────────────────── the bar

function wvRenderBar() {
  if (!$('wvBname') || !WV.board) return;
  wvTxt('wvBname', WV.board.name);
  const B = WV_BOARDS, pos = $('wvBpos');
  wvTxt('wvBpos', B.dirty ? 'edited' : B.fresh ? 'new' : B.at >= 0 ? `${B.at + 1} / ${B.list.length}` : '');
  pos.style.color = B.dirty ? 'var(--wv-acc)' : '';
  const ex = $('wvBex'), fac = B.list.slice(0, 4);
  if (ex.dataset.names !== fac.map((b) => b.name).join('|')) {
    ex.dataset.names = fac.map((b) => b.name).join('|');
    ex.innerHTML = fac.map((b, i) => `<span data-bx="${i}" title="${b.factory ? 'Factory board' : 'Board'}: ${wvEsc(b.name)}">${wvEsc(b.name)}</span>`).join('');
    ex.querySelectorAll('span').forEach((s) => s.addEventListener('click', () => wvLoadBoard(+s.dataset.bx)));
  }
  ex.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', !B.fresh && i === B.at));
  $('wvBrm').style.display = !B.fresh && wvBoardRemovable(B.at) ? '' : 'none';
  wvBoardCount();
}

function wvBoardCount() {
  if (!WV.board) return;
  const n = WV.board.nodes.filter((x) => !wvIsIO(x)).length, m = WV.mods.filter((x) => x.dst.startsWith('board:')).length;
  wvTxt('wvBcount', `${n} nodes · ${WV.board.cables.length} cables · ${m} mapped`);
}

function wvWireBar() {
  $('wvBprev').addEventListener('click', () => wvLoadBoard(WV_BOARDS.at < 0 ? 0 : WV_BOARDS.at - 1));
  $('wvBnext').addEventListener('click', () => wvLoadBoard(WV_BOARDS.at < 0 ? 0 : WV_BOARDS.at + 1));
  $('wvBsave').addEventListener('click', () => wvSaveBoard(WV_BOARDS.fresh ? wvUniqBoard(WV.board.name) : WV.board.name));
  $('wvBsaveas').addEventListener('click', () => wvRenameBoard(wvUniqBoard(WV.board.name), true));
  $('wvBdup').addEventListener('click', () => wvSaveBoard(wvUniqBoard(WV.board.name + ' copy')));
  $('wvBinit').addEventListener('click', wvInitBoardNow);
  $('wvBrm').addEventListener('click', wvRemoveBoard);
  const bn = $('wvBname');
  bn.addEventListener('dblclick', () => wvRenameBoard(WV.board.name, false));
  bn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); bn.blur(); } if (e.key === 'Escape') { bn.textContent = WV.board.name; bn.blur(); } });
  bn.addEventListener('blur', () => {
    if (bn.contentEditable !== 'true') return;
    bn.contentEditable = 'false';
    const t = bn.textContent.trim(), save = bn.dataset.save === '1';
    if (save) wvSaveBoard(t || WV.board.name);
    else if (t && t !== WV.board.name) { WV.board.name = t; wvBoardDirty(); }
    wvRenderBar();
  });
}

/// The name, ready to type over; with `save`, Enter keeps the board under it.
function wvRenameBoard(name, save) {
  const e = $('wvBname');
  e.textContent = name;
  e.dataset.save = save ? '1' : '';
  e.contentEditable = 'true';
  e.focus();
  const r = document.createRange();
  r.selectNodeContents(e);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/// A line under the canvas, for a moment: what was done, or why not.
function wvBoardNote(s, bad) {
  const e = $('wvFnote'), h = $('wvFhint');
  if (!e) return;
  e.textContent = s;
  e.classList.add('on');
  e.classList.toggle('bad', !!bad);
  h.style.display = 'none';
  clearTimeout(WV_BOARD_VIEW.note);
  WV_BOARD_VIEW.note = setTimeout(() => {
    e.classList.remove('on');
    setTimeout(() => { if (!e.classList.contains('on')) h.style.display = ''; }, 260);
  }, 2600);
}

// ─────────────────────────────────────────────────────────────── the library

const WV_TW = '<svg class="tw" viewBox="0 0 8 8"><path d="M2.5 1 L5.5 4 L2.5 7"/></svg>';

function wvBuildLibrary() {
  const L = $('wvFlist');
  if (!L) return;
  const open = WV_BOARD_VIEW.open, cats = WV_CAT_ORDER.map((c) => [c, WV_FXCAT.list.filter((f) => f.category === c)]).filter(([, l]) => l.length);
  let h = `<div class="wv-fcat ${open.has('routing') ? 'open' : ''}" data-cat="routing" style="--cc:var(--wv-t2)">${WV_TW}<i class="cc"></i>ROUTING<span class="wv-sp"></span><b data-cn>5</b></div>`
    + `<div class="wv-fitems">${Object.entries(WV_ROUTING).map(([k, r]) => `<div class="wv-fit" data-add="${k}" data-q="${r.n.toLowerCase()}" style="--cc:var(--wv-t2)" title="${r.tip}"><svg viewBox="0 0 17 14"><path d="${r.g}"/></svg><span>${r.n}</span></div>`).join('')}</div>`;
  for (const [c, items] of cats) {
    h += `<div class="wv-fcat ${open.has(c) ? 'open' : ''}" data-cat="${c}" style="--cc:${wvCatCol(c, 64)}">${WV_TW}<i class="cc"></i>${c.toUpperCase()}<span class="wv-sp"></span><b data-cn>${items.length}</b></div>`
      + `<div class="wv-fitems">${items.map((f) => `<div class="wv-fit" data-add="${f.kind}" data-q="${wvEsc(f.label.toLowerCase())}" style="--cc:${wvCatCol(c, 64)}" title="${wvEsc(f.label)}: drag onto the board, or double-click to add it"><i></i><span>${wvEsc(f.label)}</span></div>`).join('')}</div>`;
  }
  if (!cats.length) h += '<div class="wv-hint wv-fnone">The effects come from the engine, which has not answered</div>';
  L.innerHTML = h;
  wvTxt('wvFxn', `${WV_FXCAT.list.length} + 5`);
  L.querySelectorAll('.wv-fcat').forEach((c) => c.addEventListener('click', () => {
    c.classList.toggle('open');
    if (c.classList.contains('open')) open.add(c.dataset.cat); else open.delete(c.dataset.cat);
  }));
  L.querySelectorAll('.wv-fit').forEach((it) => {
    it.addEventListener('dblclick', () => wvAddNode(it.dataset.add, null));
    it.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      const sx = e.clientX, sy = e.clientY;
      let gh = null;
      const mv = (ev) => {
        if (!gh && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) {
          gh = wvH(`<div class="wv-fghost wv-fit wv-panel" style="${it.getAttribute('style')}">${it.innerHTML}</div>`);
          $('waveView').appendChild(gh);
        }
        if (gh) { gh.style.left = ev.clientX + 'px'; gh.style.top = ev.clientY + 'px'; }
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        if (!gh) return;
        gh.remove();
        const r = $('wvFwell').getBoundingClientRect();
        if (ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) wvAddNode(it.dataset.add, wvToWorld(ev));
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  });
  const q = $('wvFxq');
  q.oninput = () => {
    const s = q.value.trim().toLowerCase();
    L.querySelectorAll('.wv-fcat').forEach((c) => {
      const items = c.nextElementSibling.querySelectorAll('.wv-fit');
      let k = 0;
      items.forEach((it) => {
        const ok = !s || it.dataset.q.includes(s), sp = it.querySelector('span'), t = sp.textContent;
        it.classList.toggle('hide', !ok);
        if (ok) k++;
        if (s && ok) { const i = t.toLowerCase().indexOf(s); sp.innerHTML = `${wvEsc(t.slice(0, i))}<em>${wvEsc(t.slice(i, i + s.length))}</em>${wvEsc(t.slice(i + s.length))}`; } else sp.textContent = t;
      });
      c.classList.toggle('hide', !!s && !k);
      c.classList.toggle('open', s ? k > 0 : open.has(c.dataset.cat));
      c.querySelector('[data-cn]').textContent = s ? `${k} / ${items.length}` : items.length;
    });
  };
}

// ─────────────────────────────────────────────────────────────── the sources strip

function wvBuildFxStrip() {
  const el = $('wvFstrip');
  el.innerHTML = '<span class="sl">MOD<br>FROM</span>' + WV_SOURCES.map((s) => `<div class="wv-gxc wv-btn ${s.g0 ? 'g0' : ''}" data-src="${s.key}" style="--c:${wvSrcColour(s.key)}" title="${s.label}: drag onto any control on a node or in the inspector to make it move that control"><i class="act"></i><b>${s.label}</b><canvas data-fs="${s.key}" data-w="28" data-h="12"></canvas></div>`).join('');
  el.querySelectorAll('canvas[data-fs]').forEach((c) => { WV_BOARD_CV['fs' + c.dataset.fs] = wvCv(c); });
  wvWireSrc(el);
  el.querySelectorAll('[data-src]').forEach((t) => {
    t.addEventListener('mouseenter', () => wvHlBoardSrc(t.dataset.src, true));
    t.addEventListener('mouseleave', () => wvHlBoardSrc(t.dataset.src, false));
  });
}

/// Light every board control a source moves.
function wvHlBoardSrc(src, on) {
  for (const m of WV.mods) {
    if (m.src !== src || !m.dst.startsWith('board:')) continue;
    document.querySelectorAll('#wvViewFx [data-tgt]').forEach((c) => {
      if (c.dataset.tgt !== m.dst) return;
      const k = c.closest('.wv-knob') || c;
      k.classList.toggle('wv-hl', on);
      k.style.setProperty('--hc', wvSrcColour(src));
    });
  }
}

// ─────────────────────────────────────────────────────────────── the nodes

/// A node's knob: the shared knob at 26 (`073a-ui-knob.js`), its canvas taking
/// the drag.
function wvBoardKnob(n, p) {
  return uiKnobHtml({ size: 26, face: false, cls: 'wv-knob', inner: `<canvas data-fxk="${wvEsc(n.id)}|${p.key}" data-tgt="board:${wvEsc(n.id)}:${p.key}" data-w="26" data-h="26" title="${wvEsc(p.label)}: drag up and down, Shift for fine, double-click for the default. Drop a source here to modulate it"></canvas>` });
}

function wvPins(n) {
  return wvInPorts(n).map((p) => `<i class="wv-pin in" data-pin="${wvEsc(n.id)}|${p}|in" style="top:${wvPinY(n, p)}px" title="${wvPortName(n, p)}: cables into one in are summed. Drag from it to move its cable"></i>`).join('')
    + wvOutPorts(n).map((p) => `<i class="wv-pin out" data-pin="${wvEsc(n.id)}|${p}|out" style="top:${wvPinY(n, p)}px" title="${wvPortName(n, p)}: drag onto an in to patch. One out can feed several ins"></i>`).join('');
}

function wvNodeEl(n) {
  const st = `left:${n.x}px;top:${n.y}px`, id = wvEsc(n.id), cv = (w, h, extra = '') => `<canvas data-np="${id}" data-w="${w}" data-h="${h}" ${extra}></canvas>`;
  if (n.kind.startsWith('in:')) {
    const I = WV_IN[n.kind], live = n.on !== false && wvInputLive(n.kind), main = n.kind === 'in:voice';
    return `<div class="wv-fn io ${live ? '' : 'dead'} ${main ? 'main' : 'send'}" data-node="${id}" style="${st};--cc:${I.c}" title="${I.n}: ${I.d}"><div class="ioh" data-drag><i data-pw title="${I.n}: on or off"></i><b>${I.n}</b><span class="wv-ro">${main ? 'main' : live ? 'send' : 'off'}</span></div><div class="wv-well">${cv(88, 24)}</div>${wvPins(n)}</div>`;
  }
  if (n.kind === 'out') return `<div class="wv-fn io" data-node="${id}" style="${st};--cc:var(--wv-acc)" title="Out: the end of the master bus, to the synth's output. Several cables in are summed"><div class="ioh" data-drag><i></i><b>Out</b><span class="wv-ro">master</span></div><div class="wv-well">${cv(88, 24)}</div>${wvPins(n)}</div>`;
  const head = (sub, extra) => `<div class="fh" data-drag><div class="fhn"><b>${wvEsc(wvNodeName(n))}</b><span>${sub}</span></div>${extra}</div>`;
  if (wvIsFx(n)) {
    const pr = wvFacePr(n), cw = 136 / Math.max(pr.length, 1) - 5, F = wvFxOf(n), snd = F && F.sound;
    const nm = wvNodeName(n), big = wvTextW(nm, `600 11px ${wvCl().sans}`) > 110;
    const sndLab = snd ? (wvSoundState(n) === 'loaded' ? wvSoundFile(n) : wvSoundState(n) === 'unreadable' ? 'Unreadable' : `No ${snd.label.toLowerCase()}`) : '';
    return `<div class="wv-fn fx ${n.on ? '' : 'off'}" data-node="${id}" style="${st};--cc:${wvCatCol(wvNodeCat(n), 64)}">`
      + `<div class="fh" data-drag><div class="fhn"><b class="${big ? 'sm' : ''}">${wvEsc(nm)}</b><span>${wvCatName(wvNodeCat(n))} · ${wvNodeMaker(n)}</span></div><span class="wv-pw wv-btn ${n.on ? 'on' : ''}" data-pw title="Power: off passes the sound through untouched">${WV_PWR}</span></div>`
      + `<div class="wv-well fp">${cv(136, 40)}${snd ? `<span class="wv-fsnd ${wvSoundState(n)}" data-snd="${id}" title="${wvEsc(snd.label)}: ${wvEsc(wvSoundText(n))}. Click to pick one from the library">${wvEsc(wvFitLab(sndLab, 124))}</span>` : ''}</div>`
      + `<div class="fk">${pr.length ? pr.map((p) => `<div class="fkc">${wvBoardKnob(n, p)}<span class="kl">${wvEsc(wvFitLab(p.label, cw))}</span><b data-nv="${p.key}"></b></div>`).join('') : `<div class="none">No settings:<br>${n.kind === 'fx:invert' ? 'it flips the wave upside down' : 'it swaps left and right'}</div>`}</div>${wvPins(n)}</div>`;
  }
  const R = WV_ROUTING[n.kind] || { n: n.kind, tip: '' }, base = `class="wv-fn rt" data-node="${id}" style="${st};--cc:var(--wv-t2)" title="${R.tip}"`;
  if (n.kind === 'split') {
    const k = wvPortCount(n);
    return `<div ${base}>${head('ROUTING', `<div class="wv-seg" data-sn title="How many outs">${[2, 3].map((x) => `<span class="${k === x ? 'on' : ''}" data-k="${x}">${x}</span>`).join('')}</div>`)}<div class="sb">${cv(116, k * 14)}<div>${[...Array(k).keys()].map((i) => `<div class="pl">${'ABC'[i]}</div>`).join('')}</div></div>${wvPins(n)}</div>`;
  }
  if (n.kind === 'mix') {
    return `<div ${base}>${head('ROUTING', '<span class="wv-ib wv-btn" data-mn="-1" title="One input fewer">−</span><span class="wv-ib wv-btn" data-mn="1" title="One more input">+</span>')}${wvNodeSpec(n).map((p, i) => `<div class="mrow"><span class="pl">In ${i + 1}</span>${wvBoardKnob(n, p)}<canvas data-nm="${id}|${i}" data-w="44" data-h="8"></canvas><b data-nv="${p.key}"></b></div>`).join('')}${wvPins(n)}</div>`;
  }
  if (n.kind === 'drywet') return `<div ${base}>${head('ROUTING', '')}<div class="dwb"><span class="pl">in</span><div class="mid">${wvBoardKnob(n, wvNodeSpec(n)[0])}${cv(34, 30)}</div><span class="pl r">send</span><span class="pl">return</span><span class="pl r">out</span></div>${wvPins(n)}</div>`;
  const p = wvNodeSpec(n)[0];
  return `<div ${base}>${head('ROUTING', '')}<div class="rb">${p ? wvBoardKnob(n, p) : ''}<div class="wv-well">${cv(66, 30)}</div><b data-nv="${p ? p.key : ''}"></b></div>${wvPins(n)}</div>`;
}

/// The whole board: its nodes, then its cables over them, and everything
/// around that follows it.
function wvRenderBoard() {
  const w = $('wvWorld');
  if (!w || !WV.board) return;
  WV_BOARD_CV.nodes = {};
  w.innerHTML = '<svg id="wvCables" xmlns="http://www.w3.org/2000/svg"></svg><div class="wv-wcap" style="left:16px;top:94px" title="Sends: the oscillators, sub and noise, before the filters">SENDS</div>' + WV.board.nodes.map(wvNodeEl).join('');
  w.querySelectorAll('canvas[data-w]').forEach((c) => {
    const g = wvCv(c), id = c.dataset.np || c.dataset.fxk?.split('|')[0] || c.dataset.nm?.split('|')[0];
    const e = WV_BOARD_CV.nodes[id] || (WV_BOARD_CV.nodes[id] = { pic: null, knobs: [], bars: [] });
    if (c.dataset.np) e.pic = g; else if (c.dataset.fxk) e.knobs.push(g); else e.bars.push(g);
  });
  wvWireBoardKnobs(w);
  w.querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => {
    const n = wvNode(b.closest('.wv-fn').dataset.node);
    wvBoardParam(n.id, 'on', n.on === false, false);
    wvRenderBoard();
  }));
  w.querySelectorAll('[data-sn] span').forEach((s) => s.addEventListener('click', () => wvSetPorts(wvNode(s.closest('.wv-fn').dataset.node), +s.dataset.k)));
  w.querySelectorAll('[data-snd]').forEach((b) => b.addEventListener('click', () => wvSoundMenu(b, b.dataset.snd)));
  w.querySelectorAll('[data-mn]').forEach((s) => s.addEventListener('click', () => { const n = wvNode(s.closest('.wv-fn').dataset.node); wvSetPorts(n, wvPortCount(n) + +s.dataset.mn); }));
  wvRenderCables();
  wvApplyView();
  wvMarkSel();
  wvRenderBar();
  wvRenderInspector();
}

/// Knobs that work, on the nodes and in the inspector.
function wvWireBoardKnobs(root) {
  root.querySelectorAll('canvas[data-fxk]').forEach((el) => {
    const [nid, key] = el.dataset.fxk.split('|');
    const P = () => { const n = wvNode(nid); return [n, n && wvParamOf(n, key)]; };
    let u = 0;
    wvDrag(el, (dx, dy, e) => {
      const [n, p] = P();
      if (!p) return;
      u = wvClamp(u - dy / (e.shiftKey ? 750 : 150));
      wvBoardParam(nid, key, wvPV(p, u), true);
    }, () => { const [n, p] = P(); if (p) u = wvPN(p, wvPVal(n, p)); }, wvBoardCommitTouched);
    el.addEventListener('dblclick', () => { const [, p] = P(); if (p) wvBoardParam(nid, key, p.default, false); });
  });
}

function wvCabPath(x1, y1, x2, y2) {
  const dx = x2 - x1;
  if (dx > 24) { const c = Math.max(24, dx * 0.45); return `M${x1} ${y1} C${x1 + c} ${y1},${x2 - c} ${y2},${x2} ${y2}`; }
  const sy = Math.max(y1, y2) + Math.min(120, 40 + Math.abs(dx) * 0.12), c = 36, mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${x1 + c} ${y1},${x1 + c} ${sy},${mx} ${sy} S${x2 - c} ${y2},${x2} ${y2}`;
}

function wvRenderCables() {
  const svg = $('wvCables');
  if (!svg) return;
  const S = WV_BOARD_VIEW.sel;
  svg.innerHTML = WV.board.cables.map((c, i) => {
    const A = wvNode(c.from[0]), B = wvNode(c.to[0]);
    if (!A || !B) return '';
    const [x1, y1] = wvPinXY(A, c.from[1], 1), [x2, y2] = wvPinXY(B, c.to[1], 0), d = wvCabPath(x1, y1, x2, y2);
    return `<g data-cab="${i}" class="${S && S.t === 'cab' && S.i === i ? 'sel' : ''}"><path class="co" d="${d}"/><path class="cb" d="${d}"/><path class="cg" d="${d}"/><path class="ch" d="${d}"/></g>`;
  }).join('') + '<path class="tmp" id="wvCtmp" d=""/>';
  wvRenderChain();
}

function wvMarkSel() {
  const S = WV_BOARD_VIEW.sel;
  document.querySelectorAll('#wvWorld .wv-fn').forEach((e) => e.classList.toggle('sel', !!S && S.t === 'node' && e.dataset.node === S.id));
  document.querySelectorAll('#wvCables g[data-cab]').forEach((g) => g.classList.toggle('sel', !!S && S.t === 'cab' && +g.dataset.cab === S.i));
  document.querySelectorAll('#wvFchain .chi').forEach((c) => c.classList.toggle('sel', !!S && S.t === 'node' && c.dataset.chn === S.id));
}

function wvBoardSelect(s) {
  const same = JSON.stringify(s) === JSON.stringify(WV_BOARD_VIEW.sel);
  WV_BOARD_VIEW.sel = s;
  wvMarkSel();
  if (!same) wvRenderInspector();
}

// ─────────────────────────────────────────────────────────────── pan and zoom

const wvWellScale = () => { const W = $('wvFwell'), r = W.getBoundingClientRect(); return r.width / W.offsetWidth || 1; };
function wvToWorld(e) {
  const W = $('wvFwell'), r = W.getBoundingClientRect(), s = wvWellScale(), V = WV_BOARD_VIEW;
  return [((e.clientX - r.left) / s - V.x) / V.z, ((e.clientY - r.top) / s - V.y) / V.z];
}
const wvBoardCentre = () => { const W = $('wvFwell'), V = WV_BOARD_VIEW; return [(W.clientWidth / 2 - V.x) / V.z, (W.clientHeight / 2 - V.y) / V.z]; };
function wvApplyView() {
  const V = WV_BOARD_VIEW, w = $('wvWorld'), st = $('wvFwell').style;
  w.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.z})`;
  st.setProperty('--g1', WV_GRID * V.z + 'px');
  st.setProperty('--g4', WV_GRID * 4 * V.z + 'px');
  st.setProperty('--gx', V.x + 'px');
  st.setProperty('--gy', V.y + 'px');
  wvTxt('wvZro', Math.round(V.z * 100) + ' %');
}
function wvZoomAt(z, cx, cy) {
  const V = WV_BOARD_VIEW;
  z = wvClamp(z, 0.4, 1.6);
  const wx = (cx - V.x) / V.z, wy = (cy - V.y) / V.z;
  V.z = z; V.x = cx - wx * z; V.y = cy - wy * z;
  wvApplyView();
}
function wvBoardFit() {
  const W = $('wvFwell');
  if (!W || !W.clientWidth) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of WV.board.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + wvNodeW(n)); y1 = Math.max(y1, n.y + wvNodeH(n)); }
  x0 -= 10; x1 += 10;
  const V = WV_BOARD_VIEW, H0 = W.clientHeight - 30, z = wvClamp(Math.min((W.clientWidth - 24) / (x1 - x0), (H0 - 20) / (y1 - y0)), 0.4, 1.25);
  V.z = z; V.x = (W.clientWidth - (x1 - x0) * z) / 2 - x0 * z; V.y = (H0 - (y1 - y0) * z) / 2 - y0 * z;
  wvApplyView();
}

// ─────────────────────────────────────────────────────────────── the pointer

function wvWireBoardCanvas() {
  const W = $('wvFwell'), w = $('wvWorld'), V = WV_BOARD_VIEW;
  w.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const pin = e.target.closest('.wv-pin');
    if (pin) { wvStartCable(e, pin); return; }
    const ne = e.target.closest('.wv-fn');
    if (ne) {
      wvBoardSelect({ t: 'node', id: ne.dataset.node });
      if (e.target.closest('[data-drag]') && !e.target.closest('[data-pw], .wv-seg, .wv-ib')) wvStartMove(e, ne);
      return;
    }
    const cb = e.target.closest('[data-cab]');
    if (cb) wvBoardSelect({ t: 'cab', i: +cb.dataset.cab });
  });
  W.addEventListener('pointerdown', (e) => {
    if (e.button || e.target.closest('.wv-fn, .wv-pin, [data-cab], .wv-fzoom')) return;
    wvCloseMenus();
    wvBoardSelect(null);
    const sx = e.clientX, sy = e.clientY, x0 = V.x, y0 = V.y, s = wvWellScale();
    W.setPointerCapture(e.pointerId);
    W.classList.add('panning');
    const mv = (ev) => { V.x = x0 + (ev.clientX - sx) / s; V.y = y0 + (ev.clientY - sy) / s; wvApplyView(); };
    const up = () => { W.removeEventListener('pointermove', mv); W.removeEventListener('pointerup', up); W.classList.remove('panning'); };
    W.addEventListener('pointermove', mv);
    W.addEventListener('pointerup', up);
  });
  W.addEventListener('contextmenu', wvBoardMenu);
  W.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = W.getBoundingClientRect(), s = wvWellScale();
    wvZoomAt(V.z * Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) / s, (e.clientY - r.top) / s);
  }, { passive: false });
  const mid = () => [W.clientWidth / 2, W.clientHeight / 2];
  $('wvZin').addEventListener('click', () => wvZoomAt(V.z * 1.15, ...mid()));
  $('wvZout').addEventListener('click', () => wvZoomAt(V.z / 1.15, ...mid()));
  $('wvZfit').addEventListener('click', wvBoardFit);
  $('wvZ100').addEventListener('click', () => { V.z = 1; V.x = 0; V.y = 0; wvApplyView(); });
}

/// Move a node, on the grid. Dropped on a cable while it has none of its own,
/// it is spliced in; ⌥ lifts it out first, joining its neighbours.
function wvStartMove(e, el) {
  const n = wvNode(el.dataset.node), sx = e.clientX, sy = e.clientY, x0 = n.x, y0 = n.y, s = wvWellScale(), h = e.target, io = wvIsIO(n), V = WV_BOARD_VIEW;
  h.setPointerCapture(e.pointerId);
  let lifted = false, cand = null;
  if (e.altKey && !io && wvLiftOut(n)) {
    lifted = true;
    wvRenderCables();
    wvBoardNote(`Lifted ${wvNodeName(n)} out; its neighbours are joined. Drop it on a cable to put it back in`);
  }
  const mv = (ev) => {
    n.x = Math.max(0, Math.round((x0 + (ev.clientX - sx) / s / V.z) / WV_GRID) * WV_GRID);
    n.y = Math.max(0, Math.round((y0 + (ev.clientY - sy) / s / V.z) / WV_GRID) * WV_GRID);
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    wvRenderCables();
    cand = !io && !WV.board.cables.some((c) => c.from[0] === n.id || c.to[0] === n.id) ? wvCableNear(n) : null;
    document.querySelectorAll('#wvCables g[data-cab]').forEach((g) => g.classList.toggle('ins', cand != null && +g.dataset.cab === cand));
  };
  const up = () => {
    h.removeEventListener('pointermove', mv);
    h.removeEventListener('pointerup', up);
    if (cand != null) wvSplice(n, cand);
    else if (lifted) wvBoardPost(`Lifted ${wvNodeName(n)} out; its neighbours are joined`);
    else if (n.x !== x0 || n.y !== y0) wvBoardPost();
  };
  h.addEventListener('pointermove', mv);
  h.addEventListener('pointerup', up);
}

/// The cable nearest a node's in, within 30 board pixels.
function wvCableNear(n) {
  const cx = n.x + wvNodeW(n) / 2, cy = n.y + 1 + wvPinY(n, wvMainIn(n));
  let best = null, bd = 30;
  document.querySelectorAll('#wvCables g[data-cab]').forEach((g) => {
    const p = g.querySelector('.cb'), L = p.getTotalLength();
    for (let k = 0; k <= 32; k++) {
      const q = p.getPointAtLength(L * k / 32), d = Math.hypot(q.x - cx, q.y - cy);
      if (d < bd) { bd = d; best = +g.dataset.cab; }
    }
  });
  return best;
}

/// Drag from an out to an in. From an in, the cable in it comes away to be
/// put somewhere else.
function wvStartCable(e, pin) {
  e.preventDefault();
  e.stopPropagation();
  let [nid, port, dir] = pin.dataset.pin.split('|'), moved = false;
  if (dir === 'in') {
    const i = WV.board.cables.map((c, j) => [c, j]).filter(([c]) => c.to[0] === nid && c.to[1] === port).pop();
    if (!i) { wvBoardNote('Drag from an out (on the right of a node) to an in', true); return; }
    WV.board.cables.splice(i[1], 1);
    [nid, port] = i[0].from;
    wvRenderCables();
    if (WV_BOARD_VIEW.sel && WV_BOARD_VIEW.sel.t === 'cab') WV_BOARD_VIEW.sel = null;
    moved = true;
  }
  const n = wvNode(nid), [x1, y1] = wvPinXY(n, port, 1), tmp = $('wvCtmp');
  document.querySelectorAll('#wvWorld .wv-pin.in').forEach((p) => p.classList.add('ok'));
  const mv = (ev) => { const [x2, y2] = wvToWorld(ev); tmp.setAttribute('d', wvCabPath(x1, y1, x2, y2)); };
  mv(e);
  const up = (ev) => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    tmp.setAttribute('d', '');
    document.querySelectorAll('#wvWorld .wv-pin.ok').forEach((p) => p.classList.remove('ok'));
    const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.wv-pin');
    if (!t || t.dataset.pin.split('|')[2] !== 'in') {
      if (t) wvBoardNote('An out goes to an in', true);
      if (moved) wvBoardPost('Removed the cable');
      return;
    }
    const [b, bp] = t.dataset.pin.split('|');
    if (!wvAddCable(nid, port, b, bp) && moved) wvBoardPost('Removed the cable');
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

// ─────────────────────────────────────────────────────────────── right-click

const WV_CHEV = '<svg viewBox="0 0 8 8"><path d="M2.5 1 L5.5 4 L2.5 7"/></svg>';

/// Everything that can be added, as menu items: routing, then each category.
function wvAddItems(pick) {
  return [{ l: 'Routing', cc: 'var(--wv-t2)', right: 5, sub: () => Object.entries(WV_ROUTING).map(([k, r]) => ({ l: r.n, cc: 'var(--wv-t2)', act: () => pick(k) })) }, { sep: 1 },
    ...WV_CAT_ORDER.map((c) => [c, WV_FXCAT.list.filter((f) => f.category === c)]).filter(([, l]) => l.length)
      .map(([c, l]) => ({ l: wvCatName(c), cc: wvCatCol(c, 64), right: l.length, sub: () => l.map((f) => ({ l: f.label, cc: wvCatCol(c, 64), act: () => pick(f.kind) })) }))];
}

/// A menu at the pointer, in the page's own pixels, kept inside the page.
function wvOpenCmenu(e, title, items) {
  const m = $('wvCmenu'), app = document.querySelector('#waveView .wv-app'), ar = app.getBoundingClientRect(), s = ar.width / app.offsetWidth || 1;
  wvCloseMenus();
  m.innerHTML = '';
  m.hidden = false;
  m.style.left = (e.clientX - ar.left) / s + 'px';
  m.style.top = (e.clientY - ar.top) / s + 'px';
  wvMenuCol(0, items, title);
}

function wvMenuCol(level, items, title) {
  const M = $('wvCmenu'), app = document.querySelector('#waveView .wv-app');
  [...M.children].slice(level).forEach((c) => c.remove());
  const leaf = items.every((it) => !it.sub), el = wvH(`<div class="wv-cmcol ${leaf && level ? 'leaf' : ''}">${title ? `<div class="cm-h">${wvEsc(title)}</div>` : ''}</div>`);
  for (const it of items) {
    if (it.sep) { el.appendChild(wvH('<div class="cm-sep"></div>')); continue; }
    const r = wvH(`<div class="cm-it ${it.dis ? 'dis' : ''}" style="--cc:${it.cc || 'var(--wv-t3)'}">${it.cc ? '<i></i>' : ''}<span>${wvEsc(it.l)}</span>${it.right != null && it.right !== '' ? `<b>${it.right}</b>` : ''}${it.sub ? WV_CHEV : ''}</div>`);
    r.addEventListener('mouseenter', () => {
      el.querySelectorAll('.cm-it').forEach((x) => x.classList.toggle('on', x === r));
      if (it.sub && !it.dis) wvMenuCol(level + 1, it.sub()); else [...M.children].slice(level + 1).forEach((c) => c.remove());
    });
    r.addEventListener('click', () => { if (it.dis) return; if (it.sub) { wvMenuCol(level + 1, it.sub()); return; } if (it.act) { M.hidden = true; it.act(); } });
    el.appendChild(r);
  }
  M.appendChild(el);
  if (level) {
    const hov = M.children[level - 1].querySelector('.cm-it.on');
    el.style.marginTop = Math.max(0, hov ? hov.offsetTop + M.children[level - 1].offsetTop - 4 : 0) + 'px';
  }
  // Inside the page: shifted left or up as far as it needs.
  const right = M.offsetLeft + M.offsetWidth, W = app.offsetWidth, H = app.offsetHeight;
  if (right > W - 6) M.style.left = Math.max(6, W - 6 - M.offsetWidth) + 'px';
  const bottom = M.offsetTop + el.offsetTop + el.offsetHeight;
  if (bottom > H - 6) el.style.marginTop = Math.max(-M.offsetTop + 6, (parseFloat(el.style.marginTop) || 0) - (bottom - H + 6)) + 'px';
  if (!level && M.offsetTop + M.offsetHeight > H - 6) M.style.top = Math.max(6, H - 6 - M.offsetHeight) + 'px';
}

function wvBoardMenu(e) {
  e.preventDefault();
  const ne = e.target.closest('.wv-fn'), cb = e.target.closest('[data-cab]'), wp = wvToWorld(e);
  if (ne) {
    const n = wvNode(ne.dataset.node), io = wvIsIO(n), wired = WV.board.cables.some((c) => c.from[0] === n.id || c.to[0] === n.id), fx = wvIsFx(n);
    wvBoardSelect({ t: 'node', id: n.id });
    wvOpenCmenu(e, wvNodeName(n).toUpperCase(), [
      { l: n.on ? 'Bypass' : 'Turn back on', dis: !fx, act: () => { wvBoardParam(n.id, 'on', !n.on, false); wvRenderBoard(); wvBoardNote(`${wvNodeName(n)} ${n.on ? 'is back on' : 'is bypassed: the sound passes through untouched'}`); } },
      { l: 'Duplicate', dis: io, act: () => wvDupNode(n) },
      { l: 'Replace with', dis: io, sub: () => wvAddItems((k) => wvReplaceNode(n, k)) },
      { l: 'Lift out, join its neighbours', dis: io || !wired, act: () => { if (wvLiftOut(n)) wvBoardPost(`Lifted ${wvNodeName(n)} out; its neighbours are joined`); } },
      { sep: 1 },
      { l: 'Remove', dis: io, act: () => { WV_BOARD_VIEW.sel = { t: 'node', id: n.id }; wvBoardDelete(); } }]);
  } else if (cb) {
    const i = +cb.dataset.cab, c = WV.board.cables[i];
    wvBoardSelect({ t: 'cab', i });
    wvOpenCmenu(e, 'CABLE', [{ l: 'Insert effect here', sub: () => wvAddItems((k) => wvInsertOn(c, k, wp)) }, { sep: 1 }, { l: 'Remove', act: wvBoardDelete }]);
  } else wvOpenCmenu(e, 'ADD HERE', wvAddItems((k) => wvAddNode(k, wp)));
}

/// A new node, spliced into a cable.
function wvInsertOn(c, kind, wp) {
  const n = wvAddNode(kind, wp, true), i = WV.board.cables.indexOf(c);
  if (i >= 0) wvSplice(n, i); else wvBoardPost();
}

// ─────────────────────────────────────────────────────────────── the main path

function wvRenderChain() {
  const el = $('wvFchain');
  if (!el || !WV.board) return;
  const P = wvMainPath(), mids = P.st.slice(1, P.ok ? -1 : undefined), S = WV_BOARD_VIEW.sel;
  el.innerHTML = `<span class="sl">MAIN<br>PATH</span><span class="ch0 wv-btn" style="--cc:${WV_IN['in:voice'].c}">Voice</span>`
    + mids.map((s) => `<span class="cha">›</span><span class="chi wv-btn ${S && S.t === 'node' && S.id === s.n.id ? 'sel' : ''}" data-chn="${wvEsc(s.n.id)}" style="--cc:${wvNodeCol(s.n)}" title="${wvEsc(wvNodeName(s.n))}: drag left or right to move it along the main path">${wvEsc(wvNodeName(s.n))}</span>`).join('')
    + '<span class="cha">›</span>' + (P.ok ? '<span class="ch0 wv-btn" style="--cc:var(--wv-acc)">Out</span>' : '<span class="wv-hint">not reaching Out yet</span>')
    + '<span class="wv-sp"></span><span class="wv-hint" id="wvChint">Drag to reorder · drop a node on a cable to splice it in · ⌥-drag lifts it out</span>';
  const hn = $('wvChint');
  for (const t of ['Drag to reorder · ⌥-drag lifts a node out', 'Drag to reorder', '']) if (el.scrollWidth > el.clientWidth + 0.5) hn.textContent = t;
  const items = [...el.querySelectorAll('.chi')];
  items.forEach((it) => {
    let moved = false;
    it.addEventListener('click', () => { if (!moved) wvBoardSelect({ t: 'node', id: it.dataset.chn }); });
    it.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      moved = false;
      const sx = e.clientX, rest = items.filter((x) => x !== it);
      let gh = null, idx = 0;
      const mv = (ev) => {
        if (!gh && Math.abs(ev.clientX - sx) > 5) {
          moved = true;
          gh = wvH(`<span class="chi wv-btn wv-fghost" style="${it.getAttribute('style')}">${wvEsc(it.textContent)}</span>`);
          $('waveView').appendChild(gh);
          it.classList.add('lift');
        }
        if (!gh) return;
        gh.style.left = ev.clientX + 'px';
        gh.style.top = ev.clientY + 'px';
        idx = rest.findIndex((x) => { const r = x.getBoundingClientRect(); return ev.clientX < r.left + r.width / 2; });
        if (idx < 0) idx = rest.length;
        rest.forEach((x, i) => { x.classList.toggle('insL', i === idx); x.classList.toggle('insR', idx === rest.length && i === rest.length - 1); });
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        if (!gh) return;
        gh.remove();
        it.classList.remove('lift');
        const ids = rest.map((x) => x.dataset.chn);
        ids.splice(idx, 0, it.dataset.chn);
        wvReorder(ids);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  });
}
