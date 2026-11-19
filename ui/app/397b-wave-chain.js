// Wave's effect chain, read from the board rather than its screen positions.
// Routing nodes make branches; only effects become cards. This layout is pure
// so a partially patched board can be drawn before the engine accepts it.
function wvChainLayout(board) {
  const nodes = board.nodes || [], by = new Map(nodes.map((n) => [n.id, n]));
  const edges = new Map(nodes.map((n) => [n.id, []]));
  for (const c of board.cables || []) {
    const a = c.from?.[0], b = c.to?.[0], next = edges.get(a);
    if (next && by.has(b) && !next.includes(b)) next.push(b);
  }
  const reached = new Set(), emitted = new Set();
  // Breadth-first distances give the first meeting common to every branch,
  // including a routing mix. A visited set also bounds an unfinished cycle.
  const distances = (start, blocked = new Set()) => {
    const found = new Map(), queue = [[start, 0]];
    for (let i = 0; i < queue.length; i++) {
      const [id, d] = queue[i];
      if (!by.has(id) || blocked.has(id) || found.has(id)) continue;
      found.set(id, d);
      for (const n of edges.get(id)) queue.push([n, d + 1]);
    }
    return found;
  };
  const meeting = (starts, blocked) => {
    const maps = starts.map((id) => distances(id, blocked));
    const common = [...maps[0].keys()].filter((id) => maps.every((m) => m.has(id)));
    const cost = (id) => maps.reduce((sum, m) => sum + m.get(id), 0);
    return common.sort((a, b) => cost(a) - cost(b))[0];
  };
  // A structural mix is labelled by the effect just after it, or Out.
  const endLabel = (start) => {
    const seen = new Set();
    let id = start;
    while (by.has(id) && !seen.has(id)) {
      const n = by.get(id);
      if (wvIsFx(n)) return id;
      if (n.kind === 'out' || n.kind.startsWith('in:')) return n.kind;
      seen.add(id);
      const next = edges.get(id);
      if (next.length !== 1) return id;
      id = next[0];
    }
    return 'out';
  };
  const walk = (start, stop, anchor, ancestors = new Set()) => {
    const items = [];
    let id = start, last = anchor;
    while (by.has(id) && id !== stop && !ancestors.has(id)) {
      ancestors.add(id);
      reached.add(id);
      const n = by.get(id);
      if (wvIsFx(n)) {
        if (!emitted.has(id)) { items.push({ t: 'node', id }); emitted.add(id); }
        last = id;
      }
      if (n.kind === 'out') break;
      const next = edges.get(id).filter((n) => !ancestors.has(n));
      if (next.length < 2) { id = next[0]; continue; }
      const join = meeting(next, ancestors);
      const paths = next.map((n) => walk(n, join, last, new Set(ancestors)));
      items.push({ t: 'split', from: last, to: endLabel(join), paths });
      if (!join) break;
      id = join;
    }
    return items;
  };
  const voice = nodes.find((n) => n.kind === 'in:voice');
  const items = voice ? walk(voice.id, undefined, 'in:voice') : [];
  // Insert a send at its meeting, including a meeting inside another split
  // or send. Anything that stops short stays visible at the end of the chain.
  const insert = (list, to, item) => {
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (x.t === 'node' && x.id === to) { list.splice(i, 0, item); return true; }
      if (x.t === 'split' && x.paths.some((p) => insert(p, to, item))) return true;
      if (x.t === 'send' && insert(x.path, to, item)) return true;
    }
    return false;
  };
  for (const input of nodes.filter((n) => n.kind.startsWith('in:') && n.kind !== 'in:voice')) {
    if (!edges.get(input.id).length) continue;
    const targets = [...distances(input.id)].filter(([id]) => reached.has(id));
    targets.sort((a, b) => a[1] - b[1]);
    const join = targets[0]?.[0], to = endLabel(join);
    const path = walk(input.id, join, input.kind);
    const send = { t: 'send', from: input.kind, to, path };
    if (!insert(items, to, send)) items.push(send);
  }
  return { items, unconnected: nodes.filter((n) => wvIsFx(n) && !reached.has(n.id)).map((n) => n.id) };
}

const WV_CHAIN = { board: null, stamp: '', anchor: null, offset: 0, selected: null, cards: new Map() };

function wvRememberDock() {
  const host = $('wvChainDock');
  if (!host || host.hidden || !host.getClientRects().length) return;
  const top = host.getBoundingClientRect().top;
  const card = [...host.querySelectorAll('[data-card]')].find((e) => e.getBoundingClientRect().bottom > top + 1);
  if (card) {
    WV_CHAIN.anchor = card.dataset.card;
    WV_CHAIN.offset = (card.getBoundingClientRect().top - top) / (WV.scale || 1);
  }
}

function wvDockScrollTo(id) {
  const host = $('wvChainDock'), card = WV_CHAIN.cards.get(id)?.el;
  if (!host || !card) return;
  host.scrollTop += (card.getBoundingClientRect().top - host.getBoundingClientRect().top) / (WV.scale || 1);
  WV_CHAIN.selected = id;
  host.querySelectorAll('[data-card]').forEach((el) => el.classList.toggle('sel', el.dataset.card === id));
  wvRememberDock();
}

function wvRenderChainDock() {
  const dock = $('wvRdock');
  if (!dock || !WV.board) return;
  let host = $('wvChainDock');
  if (!host) {
    host = wvH('<div id="wvChainDock" class="wv-chain-dock wv-scroll"></div>');
    dock.appendChild(host);
    host.addEventListener('scroll', wvRememberDock, { passive: true });
  }
  if (WV.view === 'fx') { host.hidden = true; return; }
  wvRememberDock();
  host.hidden = false;
  const stamp = JSON.stringify([WV.board.nodes.map((n) => [n.id, n.kind, n.on, n.sound]), WV.board.cables, !!state.suites?.length]);
  if (WV_CHAIN.board === WV.board && WV_CHAIN.stamp === stamp) return;
  const anchor = WV_CHAIN.anchor, offset = WV_CHAIN.offset, previous = [...WV_CHAIN.cards.keys()];
  WV_CHAIN.board = WV.board;
  WV_CHAIN.stamp = stamp;
  WV_CHAIN.cards.clear();
  const layout = wvChainLayout(WV.board);
  const name = (id) => id.startsWith('in:') ? WV_IN[id]?.n || id : id === 'out' ? 'Out' : wvNodeName(wvNode(id));
  const count = (items) => items.reduce((n, x) => n + (x.t === 'node' ? 1 : x.t === 'split' ? x.paths.reduce((n, p) => n + count(p), 0) : count(x.path)), 0);
  const draw = (items) => items.map((x) => {
    if (x.t === 'node') return `<article class="wv-panel wv-mod wv-finsp wv-chaincard" data-card="${wvEsc(x.id)}">${wvInspFx(wvNode(x.id))}</article>`;
    if (x.t === 'send') return `<section class="wv-chain-send"><div class="wv-chain-send-label">FROM ${wvEsc(name(x.from).toUpperCase())} → ${wvEsc(name(x.to).toUpperCase())}</div>${draw(x.path)}</section>`;
    return `<section class="wv-chain-split"><div class="wv-chain-split-label">SPLITS AFTER ${wvEsc(name(x.from).toUpperCase())}, INTO ${wvEsc(name(x.to).toUpperCase())}</div>${x.paths.map((p, i) => `<div class="wv-chain-path"><div class="wv-chain-path-label">PATH ${i + 1} · ${count(p)} EFFECTS</div>${draw(p)}</div>`).join('')}</section>`;
  }).join('');
  host.innerHTML = '<div class="wv-chain-end">VOICE</div>' + draw(layout.items)
    + '<div class="wv-chain-end">OUT</div>'
    + (layout.unconnected.length ? '<div class="wv-chain-end">NOT CONNECTED</div>' + draw(layout.unconnected.map((id) => ({ t: 'node', id }))) : '');
  for (const el of host.querySelectorAll('[data-card]')) {
    const id = el.dataset.card, n = wvNode(id);
    const pictures = wvWireInspectorFace(el, n);
    WV_CHAIN.cards.set(id, { el, pictures });
    el.querySelector('[data-ipw]')?.setAttribute('data-card-power', id);
    const open = wvH(`<span class="wv-bt wv-btn" data-openfx="${wvEsc(id)}" title="Open this effect on the FX board">⋀ FX ›</span>`);
    el.querySelector('.wv-mh').appendChild(open);
    open.addEventListener('click', () => {
      wvShowView('fx');
      wvBoardSelect({ t: 'node', id });
    });
    el.classList.toggle('sel', id === WV_CHAIN.selected);
  }
  // The same node, at the same distance from the top, survives changed card
  // heights, reordering and deletion before it. A deleted anchor uses its
  // surviving neighbour rather than a stale absolute pixel position.
  wvSizeChainDock();
  const at = previous.indexOf(anchor);
  const neighbour = [...previous.slice(at + 1), ...previous.slice(0, Math.max(0, at)).reverse()].find((id) => WV_CHAIN.cards.has(id));
  const target = WV_CHAIN.cards.get(anchor)?.el || WV_CHAIN.cards.get(neighbour)?.el;
  if (target) host.scrollTop += (target.getBoundingClientRect().top - host.getBoundingClientRect().top) / (WV.scale || 1) - (WV_CHAIN.cards.has(anchor) ? offset : 0);
  wvRememberDock();
}

/// Even a last, newly stranded card can return to the top of the viewport.
function wvSizeChainDock() {
  const host = $('wvChainDock'), last = [...WV_CHAIN.cards.values()].at(-1)?.el;
  if (!host || host.hidden) return;
  host.style.paddingBottom = `${last ? Math.max(0, host.clientHeight - last.offsetHeight) : 0}px`;
}

function wvDrawChainDock(t) {
  const host = $('wvChainDock');
  if (!host || host.hidden) return;
  const bounds = host.getBoundingClientRect(), memo = new Map();
  WV_NWAVE.waves.clear();
  WV_NWAVE.specs.clear();
  wvHistTick(t);
  for (const [id, card] of WV_CHAIN.cards) {
    const r = card.el.getBoundingClientRect();
    if (r.bottom < bounds.top || r.top > bounds.bottom) continue;
    wvDrawInspectorFace(card.el, wvNode(id), card.pictures, t, memo);
  }
}

const WV_FXROW = { board: null, stamp: '', controls: [] };

function wvFxRowParams(n) {
  const main = wvFacePr(n), extra = wvNodeSpec(n).filter((p) => !p.choices && !p.toggle && !main.some((q) => q.key === p.key));
  return main.concat(extra).slice(0, 4);
}

function wvRenderFxRow() {
  const host = $('wvFxRow');
  if (!host || !WV.board) return;
  const stamp = JSON.stringify([WV.board.nodes.map((n) => [n.id, n.kind, n.on]), WV.board.cables, WV_FXCAT.list.length]);
  if (WV_FXROW.board === WV.board && WV_FXROW.stamp === stamp) return;
  WV_FXROW.board = WV.board;
  WV_FXROW.stamp = stamp;
  const layout = wvChainLayout(WV.board), ids = [];
  const flatten = (items) => items.forEach((x) => {
    if (x.t === 'node') ids.push(x.id);
    else if (x.t === 'split') x.paths.forEach(flatten);
    else flatten(x.path);
  });
  flatten(layout.items);
  ids.push(...layout.unconnected);
  host.innerHTML = ids.map((id) => {
    const n = wvNode(id), params = wvFxRowParams(n);
    return `<div class="wv-panel wv-mod wv-fxcard" data-fxcard="${wvEsc(id)}" style="--cc:${wvNodeCol(n)}">
      <div class="wv-mh"><span class="wv-pw wv-btn ${n.on !== false ? 'on' : ''}" data-row-power="${wvEsc(id)}" title="Power: off passes the sound through untouched">${WV_PWR}</span><span class="wv-fxcard-name">${wvEsc(wvNodeName(n))}</span></div>
      <div class="wv-fxrow-controls">${params.map((p) => `<div class="ui-knob under s26 wv-fxrow-control"><div class="ui-kr">${uiPic('', '0 0 64 48', 'side')}${wvBoardKnob(n, p)}</div><span class="ui-lab"><span class="ui-kname">${wvEsc(p.label)}</span><b class="ui-kval"></b></span></div>`).join('') || '<span class="wv-hint">No settings</span>'}</div></div>`;
  }).join('');
  WV_FXROW.controls = [];
  host.querySelectorAll('canvas[data-fxk]').forEach((el) => {
    const [id, key] = el.dataset.fxk.split('|'), cell = el.closest('.wv-fxrow-control');
    WV_FXROW.controls.push({ id, key, g: wvCv(el), pic: cell.querySelector('.ui-pic'), value: cell.querySelector('.ui-kval'), last: null });
  });
  wvWireBoardKnobs(host);
  host.querySelectorAll('[data-fxcard]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ui-knob, [data-row-power]')) return;
      wvDockScrollTo(card.dataset.fxcard);
      host.querySelectorAll('[data-fxcard]').forEach((el) => el.classList.toggle('sel', el === card));
    });
  });
  host.querySelectorAll('[data-row-power]').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation();
    const n = wvNode(button.dataset.rowPower);
    wvBoardParam(n.id, 'on', n.on === false, false);
    wvRenderBoard();
  }));
  wvDrawFxRow();
}

function wvDrawFxRow() {
  for (const ctl of WV_FXROW.controls) {
    const n = wvNode(ctl.id), p = n && wvParamOf(n, ctl.key);
    if (!p) continue;
    wvDrawBoardKnob(ctl.g, n, p);
    const v = wvPVal(n, p);
    if (v !== ctl.last) {
      ctl.last = v;
      const pk = FXP.picFor(p);
      ctl.pic.innerHTML = FXP.noText(FXP.PIC[pk](wvPN(p, v), v, p));
      wvTxtEl(ctl.value, wvFmtP(p, v));
    }
  }
}
