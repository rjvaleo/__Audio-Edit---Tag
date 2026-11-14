// ============================================================ analytics: summary

/* Events in, everything the Analytics tab shows out. Pure: no page, no server,
   so it can be checked against a hand-made list of events.

   Time is counted between consecutive events of a session, each gap capped at
   the idle threshold. That is what "active time" means here: a gap longer than
   a minute is a minute of use and the rest is idle, whatever the reason. */

const AN_PAGE_NAMES = { overview: 'Browse', edit: 'Edit', room: 'Room', seq: 'Seq', compose: 'Compose', theme: 'Theme', analytics: 'Analytics' };
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
  const ev = sorted.filter((e) => e.k !== 'mouse' && e.k !== 'lof');
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

/// Fold daily summaries into a summary, for the days it has no events for —
/// the days whose detail has been purged. Sessions, timelines and sequences
/// are not in a summary, so those stay as the events left them.
function anMergeDaily(sum, daily, eventDays) {
  const used = (daily || []).filter((d) => !eventDays.has(d.day));
  if (!used.length) return sum;
  const add = (into, from, key) => { for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v; };
  const pageMs = Object.fromEntries(sum.pages.map((p) => [p.m, p.ms]));
  const dockMs = Object.fromEntries(sum.docks.map((d) => [d.dk, d.ms]));
  const paths = Object.fromEntries(sum.paths.map((p) => [p.label, p.n]));
  const byC = new Map(sum.controls.map((c) => [c.c, c]));
  for (const d of used) {
    add(pageMs, d.pages);
    add(dockMs, d.docks);
    add(sum.heat, d.heat);
    for (const [k, n] of Object.entries(d.paths || {})) {
      const [a, b] = k.split('>');
      const label = `${anPageName(a)} → ${anPageName(b)}`;
      paths[label] = (paths[label] || 0) + n;
    }
    for (const [c, v] of Object.entries(d.controls || {})) {
      let u = byC.get(c);
      if (!u) { u = { c, l: v.l || c, p: v.p || '', ck: v.ck || '', uses: 0, last: 0, lo: v.lo, hi: v.hi, min: null, max: null, values: {}, tos: [] }; byC.set(c, u); }
      u.uses += v.n || 0;
      u.last = Math.max(u.last, v.last || 0);
      if (v.min != null && (u.min == null || v.min < u.min)) u.min = v.min;
      if (v.max != null && (u.max == null || v.max > u.max)) u.max = v.max;
      if (u.lo == null) u.lo = v.lo;
      if (u.hi == null) u.hi = v.hi;
    }
    for (const [m, g] of Object.entries(d.mouse || {})) {
      let into = sum.mouse[m];
      if (!into || into.gw !== g.gw || into.gh !== g.gh) into = sum.mouse[m] = { gw: g.gw, gh: g.gh, move: new Float64Array(g.gw * g.gh), click: new Float64Array(g.gw * g.gh), samples: 0, clicks: 0 };
      for (let i = 0; i + 1 < g.move.length; i += 2) { into.move[g.move[i]] += g.move[i + 1]; into.samples += g.move[i + 1]; }
      for (let i = 0; i + 1 < g.click.length; i += 2) { into.click[g.click[i]] += g.click[i + 1]; into.clicks += g.click[i + 1]; }
    }
    const t = sum.totals, c = d.counts || {};
    t.sessions += d.sessions || 0; t.active += d.active || 0; t.idle += d.idle || 0; t.events += d.events || 0;
    t.edits += c.edit || 0; t.exports += c.export || 0; t.files += c.file || 0;
    t.fxAdded += c['fx.add'] || 0; t.fxRemoved += c['fx.remove'] || 0; t.presets += c.preset || 0; t.errors += c.error || 0;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  sum.pages = top(pageMs).map(([m, ms]) => ({ m, name: anPageName(m), ms }));
  sum.docks = top(dockMs).map(([dk, ms]) => ({ dk, ms }));
  sum.paths = top(paths).slice(0, 10).map(([label, n]) => ({ label, n }));
  sum.controls = [...byC.values()].sort((a, b) => b.uses - a.uses || b.last - a.last);
  const touched = new Set(sum.controls.map((c) => c.c));
  sum.never = sum.never.filter((n) => !touched.has(n.c));
  sum.totals.touched = touched.size;
  sum.totals.never = sum.never.length;
  sum.totals.controls = touched.size + sum.never.length;
  sum.fromDaily = used.length;
  return sum;
}

/// The performance figures from sampler rows, spikes, export timings and the
/// interface's long frames.
function anPerfSummarise(perf, spikes, exports, events) {
  const busy = perf.filter((r) => r.act && r.act !== 'quiet' && r.mean != null);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const worstRow = perf.reduce((w, r) => (r.worst != null && (!w || r.worst > w.worst) ? r : w), null);
  const late = perf.reduce((a, r) => a + (r.late || 0), 0);
  const playedHours = busy.length * 10 / 3600;
  const cpu = perf.filter((r) => r.cpu != null);
  const lof = events.filter((e) => e.k === 'lof');

  // The page at a moment, from the last usage event before it.
  const ev = events.filter((e) => e.k !== 'mouse' && e.k !== 'lof');
  const pageAt = (t) => {
    let lo = 0, hi = ev.length - 1, found = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ev[mid].t <= t) { found = ev[mid]; lo = mid + 1; } else hi = mid - 1; }
    if (!found) return '';
    return found.m === 'edit' && found.dk ? `Edit › ${found.dk}` : anPageName(found.m);
  };

  // What costs the most: the average load with a thing against without it,
  // over the rows where something was playing. Only said when both sides have
  // enough rows to mean anything.
  const costs = [];
  const layerGroups = {};
  for (const r of busy) if (r.layers != null) (layerGroups[r.layers] ||= []).push(r.mean);
  for (const [n, xs] of Object.entries(layerGroups)) if (xs.length >= 2) costs.push({ n: `${n} layer${n === '1' ? '' : 's'}`, v: mean(xs), abs: true });
  const delta = (label, has) => {
    const a = busy.filter(has).map((r) => r.mean), b = busy.filter((r) => !has(r)).map((r) => r.mean);
    if (a.length >= 3 && b.length >= 3) costs.push({ n: label, v: mean(a) - mean(b), abs: false });
  };
  delta('Window ≥ 200 ms', (r) => (r.win || 0) >= 200);
  const kinds = new Set(busy.flatMap((r) => r.fx || []));
  for (const k of kinds) delta(`+ ${k}`, (r) => (r.fx || []).includes(k));
  delta('Room open', (r) => pageAt(r.t) === 'Room');
  costs.sort((a, b) => b.v - a.v);

  const lofBy = {};
  for (const e of lof) {
    const where = e.m === 'edit' && e.dk ? `Edit › ${e.dk}` : anPageName(e.m);
    const g = lofBy[where] ||= { n: 0, worst: 0, src: {} };
    g.n++; g.worst = Math.max(g.worst, e.ms || 0);
    if (e.src) g.src[e.src] = (g.src[e.src] || 0) + 1;
  }
  const speeds = exports.filter((x) => x.kind === 'video' && x.speed).map((x) => x.speed).sort((a, b) => a - b);
  return {
    load: mean(busy.map((r) => r.mean)),
    worst: worstRow, late, latePerHour: playedHours > 0 ? late / playedHours : null,
    minCap: busy.reduce((m, r) => (r.cap != null && r.cap < m ? r.cap : m), Infinity),
    cpu: mean(cpu.map((r) => r.cpu)), cpuMax: cpu.reduce((m, r) => Math.max(m, r.cpuMax || 0), 0),
    rss: perf.reduce((m, r) => Math.max(m, r.rss || 0), 0),
    lof: lof.length, lofWorst: lof.reduce((m, e) => Math.max(m, e.ms || 0), 0),
    lofWhere: Object.entries(lofBy).sort((a, b) => b[1].n - a[1].n).map(([where, g]) => ({ where, ...g, top: Object.entries(g.src).sort((a, b) => b[1] - a[1])[0]?.[0] || '' })),
    videoSpeed: speeds.length ? speeds[speeds.length >> 1] : null,
    spikes: spikes.slice().sort((a, b) => b.worst - a.worst).slice(0, 14).map((r) => ({ ...r, page: pageAt(r.t) })),
    costs: costs.slice(0, 10), exports: exports.slice().sort((a, b) => b.t - a.t), rows: perf,
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
