// ============================================================ analytics: summary

/* Events in, everything the Analytics tab shows out. Pure: no page, no server,
   so it can be checked against a hand-made list of events.

   Time is counted between consecutive events of a session, each gap capped at
   the idle threshold. That is what "active time" means here: a gap longer than
   a minute is a minute of use and the rest is idle, whatever the reason. */

const AN_PAGE_NAMES = { overview: 'Browse', edit: 'Edit', room: 'Room', seq: 'Seq', compose: 'Compose', analytics: 'Analytics' };
const AN_USES = new Set(['ctl', 'toggle', 'seg', 'field', 'click', 'menu', 'key', 'view', 'dock']);

function anPageName(m) {
  return AN_PAGE_NAMES[m] || m || '—';
}

/// A short name for an event, for sequences and the session log.
function anStep(e) {
  const d = e.d || {};
  switch (e.k) {
    case 'mode': return `→ ${anPageName(e.m)}`;
    case 'dock': return `Dock: ${e.l}`;
    case 'edit': return `Edit: ${d.op || '?'}`;
    case 'fx.add': return `+ ${d.fx}`;
    case 'fx.remove': return `− ${d.fx}`;
    case 'fx.move': return 'Reorder effects';
    case 'fx.bypass': return `${d.on ? 'Enable' : 'Bypass'} ${d.fx}`;
    case 'preset': return `Preset ${d.op}`;
    case 'export': return `Export ${d.kind}`;
    case 'record': return `Record ${d.op}`;
    case 'file': return d.how === 'edit' ? 'Open in editor' : 'Select file';
    case 'error': return 'Error';
    default: return e.l || e.c || e.k;
  }
}

function anSummarise(events, catalogue = {}, opts = {}) {
  const idleCap = opts.idle ?? 60_000;
  const page = opts.page || '';
  const sorted = events.slice().sort((a, b) => a.t - b.t);
  // Pointer grids are written when a batch is sent, not when the pointer was
  // there, so they take no part in time, paths or sequences.
  const ev = sorted.filter((e) => e.k !== 'mouse');
  const mouse = {};
  for (const e of sorted) {
    if (e.k !== 'mouse' || !e.d) continue;
    const { gw, gh } = e.d;
    let g = mouse[e.m];
    if (!g || g.gw !== gw || g.gh !== gh) g = mouse[e.m] = { gw, gh, move: new Float64Array(gw * gh), click: new Float64Array(gw * gh), samples: 0, clicks: 0 };
    const add = (into, list, key) => {
      for (let i = 0; i + 1 < (list || []).length; i += 2) { into[list[i]] += list[i + 1]; g[key] += list[i + 1]; }
    };
    add(g.move, e.d.move, 'samples');
    add(g.click, e.d.click, 'clicks');
  }

  // ---- sessions and time
  const bySession = new Map();
  for (const e of ev) {
    if (!bySession.has(e.s)) bySession.set(e.s, []);
    bySession.get(e.s).push(e);
  }
  const pageMs = {}, dockMs = {};
  let active = 0, idle = 0;
  const sessions = [];
  for (const [id, list] of bySession) {
    const t0 = list[0].t, t1 = list[list.length - 1].t, span = Math.max(1, t1 - t0);
    const segs = [], ticks = [], errors = [];
    let sIdle = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i], next = list[i + 1];
      if (e.k === 'ctl' || e.k === 'click' || e.k === 'menu' || e.k === 'key' || e.k === 'toggle' || e.k === 'seg') ticks.push((e.t - t0) / span);
      if (e.k === 'error') errors.push((e.t - t0) / span);
      if (!next) break;
      const gap = Math.max(0, next.t - e.t);
      const used = Math.min(gap, idleCap);
      active += used;
      pageMs[e.m] = (pageMs[e.m] || 0) + used;
      if (e.m === 'edit' && e.dk) dockMs[e.dk] = (dockMs[e.dk] || 0) + used;
      const a = (e.t - t0) / span, mid = (e.t + used - t0) / span, b = (next.t - t0) / span;
      const last = segs[segs.length - 1];
      if (last && last.m === e.m && Math.abs(last.b - a) < 1e-9) last.b = mid;
      else segs.push({ m: e.m, a, b: mid });
      if (gap > idleCap) {
        idle += gap - idleCap;
        sIdle += gap - idleCap;
        segs.push({ m: 'idle', a: mid, b });
      }
    }
    sessions.push({ id, start: t0, end: t1, ms: t1 - t0, idle: sIdle, events: list.length, segs, ticks: ticks.slice(0, 400), errors });
  }
  sessions.sort((a, b) => b.start - a.start);

  // ---- controls
  const scoped = page ? ev.filter((e) => e.m === page) : ev;
  const used = new Map();
  for (const e of scoped) {
    if (!AN_USES.has(e.k) || !e.c) continue;
    let u = used.get(e.c);
    if (!u) {
      const cat = catalogue[e.c] || {};
      u = { c: e.c, l: e.l || cat.l || e.c, p: e.p || cat.p || '', ck: e.ck || cat.ck || e.k, uses: 0, last: 0, lo: cat.lo, hi: cat.hi, min: null, max: null, values: {}, tos: [] };
      used.set(e.c, u);
    }
    u.uses++;
    u.last = Math.max(u.last, e.t);
    if (e.lo != null) u.lo = e.lo;
    if (e.hi != null) u.hi = e.hi;
    if (e.k === 'ctl') {
      for (const v of [e.min, e.max, e.to]) {
        if (typeof v !== 'number') continue;
        if (u.min == null || v < u.min) u.min = v;
        if (u.max == null || v > u.max) u.max = v;
      }
      if (typeof e.to === 'number') u.tos.push(e.to);
    }
    if (e.k === 'seg' || e.k === 'toggle') u.values[String(e.to)] = (u.values[String(e.to)] || 0) + 1;
  }
  const controls = [...used.values()].sort((a, b) => b.uses - a.uses || b.last - a.last);
  const never = Object.entries(catalogue)
    .filter(([c, v]) => !used.has(c) && (!page || !v.m || v.m === page))
    .map(([c, v]) => ({ c, l: v.l || c, p: v.p || '', ck: v.ck || '', lo: v.lo, hi: v.hi, uses: 0, last: 0 }))
    .sort((a, b) => (a.p + a.l).localeCompare(b.p + b.l));

  // ---- panels
  const heat = {};
  for (const e of scoped) {
    if (!e.p || !(AN_USES.has(e.k) || e.k.startsWith('fx.'))) continue;
    const p = e.p.startsWith('fx:') ? 'fxModuleRail' : e.p;
    heat[p] = (heat[p] || 0) + 1;
  }

  // ---- paths
  const paths = {};
  for (const e of ev) if (e.k === 'mode' && e.d?.from) {
    const key = `${anPageName(e.d.from)} → ${anPageName(e.m)}`;
    paths[key] = (paths[key] || 0) + 1;
  }
  const seqs = {};
  for (const list of bySession.values()) {
    const steps = [];
    for (const e of list) {
      if (e.k === 'session' || e.k === 'idle') continue;
      if (page && e.m !== page) continue;
      const s = anStep(e);
      if (steps[steps.length - 1] !== s) steps.push(s);
    }
    for (let i = 0; i + 2 < steps.length; i++) {
      const key = `${steps[i]}  →  ${steps[i + 1]}  →  ${steps[i + 2]}`;
      seqs[key] = (seqs[key] || 0) + 1;
    }
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

  // ---- totals
  const count = (k) => scoped.filter((e) => e.k === k).length;
  const undo = scoped.filter((e) => (e.k === 'edit' && /undo/i.test(e.d?.op || ''))
    || (e.k === 'key' && /^(Cmd|Ctrl)-Z$/.test(e.l || '')) || (e.k === 'menu' && /^undo/i.test(e.l || ''))).length;
  const errs = ev.filter((e) => e.k === 'error');
  const allControls = new Set([...Object.keys(catalogue), ...used.keys()]);
  return {
    totals: {
      sessions: sessions.length, active, idle, events: ev.length,
      touched: used.size, controls: allControls.size, never: never.length,
      edits: count('edit'), undo, exports: count('export'), files: count('file'),
      fxAdded: count('fx.add'), fxRemoved: count('fx.remove'), presets: count('preset'),
      errors: errs.length, lastError: errs[errs.length - 1] || null,
    },
    pages: top(pageMs, 20).map(([m, ms]) => ({ m, name: anPageName(m), ms })),
    docks: top(dockMs, 20).map(([dk, ms]) => ({ dk, ms })),
    controls, never, heat, mouse,
    paths: top(paths, 10).map(([label, n]) => ({ label, n })),
    seqs: top(seqs, 10).map(([label, n]) => ({ label, n })),
    sessions,
  };
}

function anDuration(ms) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

function anAgo(t, now = Date.now()) {
  if (!t) return 'never';
  const s = (now - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}
