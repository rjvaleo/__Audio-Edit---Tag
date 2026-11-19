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
