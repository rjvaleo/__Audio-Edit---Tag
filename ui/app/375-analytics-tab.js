// ============================================================ analytics: the tab

/* View › Analytics. A page laid over the app rather than a mode of it: the app
   underneath keeps playing and keeps its layout, which is also what lets the
   panel heat and the mouse map be drawn over where the panels really are.

   Nothing here runs unless the tab is open, and then only when it is drawn —
   on opening, on a filter change, on a click. */

const anv = {
  el: null, tab: 'overview', range: '7d', page: '', session: '', ctl: 'most', mouse: 'move',
  data: null, sum: null, open: false, detail: null, log: null,
};

const AN_RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All']];

function anEsc(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\u0022', '&quot;');
}

function anRangeFrom(r, now = Date.now()) {
  if (r === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (r === '7d') return now - 7 * 86_400_000;
  if (r === '30d') return now - 30 * 86_400_000;
  return 0;
}

function anPanelName(p) {
  if (!p) return '—';
  if (p.startsWith('fx:')) return `Effects › ${p.slice(3)}`;
  return AN_PANELS[p] || p;
}

function anSeg(group, items, current) {
  return `<div class="an-seg" role="group" data-group="${group}">${items.map(([k, l]) =>
    `<button type="button" data-${group}="${k}" class="${k === current ? 'on' : ''}" aria-pressed="${k === current}">${l}</button>`).join('')}</div>`;
}

function anBuild() {
  const el = document.createElement('div');
  el.id = 'analyticsView';
  el.className = 'an-view hidden';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Analytics');
  el.innerHTML = `
    <div class="an-head">
      <span class="an-title">ANALYTICS</span>
      <div class="an-tabs" role="tablist">
        <button type="button" role="tab" data-antab="overview" aria-selected="true">Overview</button>
        <button type="button" role="tab" data-antab="mouse" aria-selected="false">Mouse heat map</button>
        <button type="button" role="tab" data-antab="perf" aria-selected="false">Performance</button>
        <button type="button" role="tab" data-antab="storage" aria-selected="false">Storage</button>
      </div>
      <span class="an-vsep"></span>
      <span class="an-ranges"></span>
      <span class="mono an-span" id="anSpan"></span>
      <label class="an-lbl">Page <select id="anPage"></select></label>
      <label class="an-lbl">Session <select id="anSession"></select></label>
      <span class="an-fill"></span>
      <span class="mono an-local">local only · data/ANALYTICS</span>
      <button type="button" class="an-btn" id="anPause"></button>
      <button type="button" class="an-btn" id="anExport">Export JSON…</button>
      <button type="button" class="an-btn bad" id="anClear">Clear…</button>
      <button type="button" class="an-btn" id="anClose" aria-label="Close analytics" title="Close (Esc)">✕</button>
    </div>
    <div class="an-body" id="anOverview">
      <div class="an-kpis" id="anKpis"></div>
      <div class="an-upper">
        <section class="an-cell" aria-label="Time per page">
          <div class="an-h">TIME PER PAGE <span>active · idle excluded</span></div>
          <div id="anPages"></div>
          <div class="an-rule"></div>
          <div class="an-h">EDIT › DOCK TABS <span>share of Edit time</span></div>
          <div id="anDocks"></div>
        </section>
        <section class="an-cell an-controls" aria-label="Controls">
          <div class="an-h">CONTROLS <span id="anCtlCount"></span><span class="an-fill"></span><span class="an-ctlseg"></span>
            <select id="anKind" aria-label="Control kind">
              <option value="">all kinds</option><option value="slider">sliders</option><option value="knob">knobs</option>
              <option value="switch">switches</option><option value="segment">segments</option><option value="button">buttons</option>
              <option value="tab">tabs</option><option value="menu">menu items</option><option value="shortcut">shortcuts</option>
              <option value="pad">pads</option><option value="field">fields</option>
            </select></div>
          <div class="an-row an-rowhead"><span>#</span><span>CONTROL</span><span>PANEL</span><span>KIND</span><span class="r">USES</span><span>VALUES USED</span><span class="r">LAST</span></div>
          <div class="an-rows" id="anCtlRows"></div>
        </section>
        <section class="an-cell" aria-label="Heat by panel">
          <div class="an-h">HEAT BY PANEL <span id="anHeatNote"></span></div>
          <div class="an-heat" id="anHeat"></div>
          <div class="an-heatlist" id="anHeatList"></div>
        </section>
      </div>
      <div class="an-lower">
        <section class="an-cell" aria-label="Common paths">
          <div class="an-h">COMMON PATHS <span>what follows what</span></div>
          <div class="an-two">
            <div><div class="an-sub">PAGE → PAGE</div><div id="anPaths"></div></div>
            <div><div class="an-sub">ACTION SEQUENCES (3 STEPS)</div><div id="anSeqs"></div></div>
          </div>
        </section>
        <section class="an-cell" aria-label="Sessions">
          <div class="an-h">SESSIONS <span id="anLegend" class="an-legend"></span><span class="an-fill"></span><span>click a session for its event log</span></div>
          <div id="anSessions" class="an-sessions"></div>
          <div id="anLog" class="an-log hidden"></div>
        </section>
      </div>
    </div>
    <div class="an-body hidden" id="anMouse">
      <div class="an-mousebar">
        ${anSeg('anmouse', [['move', 'Where it rests'], ['click', 'Where it clicks']], 'move')}
        <span class="mono an-span" id="anMouseNote"></span>
      </div>
      <div class="an-mousebox" id="anMouseBox"><canvas id="anMouseCanvas" aria-label="Mouse heat map" role="img"></canvas></div>
    </div>
    <div class="an-body hidden" id="anPerf">
      <div class="an-kpis" id="anPerfKpis"></div>
      <div class="an-pupper">
        <section class="an-cell" aria-label="Audio engine load">
          <div class="an-h">AUDIO ENGINE LOAD <span id="anLoadNote"></span></div>
          <div class="an-load" id="anLoad"></div>
          <div class="an-strips">
            <span>doing</span><div class="an-strip" id="anDoing"></div>
            <span>server CPU</span><div class="an-strip tall" id="anCpu"></div>
            <span>UI long frames</span><div class="an-strip" id="anLof"></div>
          </div>
          <div class="an-legend an-acts"><span><i class="act-play"></i>playing</span><span><i class="act-export"></i>exporting audio</span><span><i class="act-video"></i>exporting video</span><span><i class="act-quiet"></i>quiet (every 60 s)</span><span><i class="err"></i>late blocks</span></div>
        </section>
        <section class="an-cell" aria-label="When it spiked">
          <div class="an-h">WHEN IT SPIKED <span>blocks over 90%, with what was running</span></div>
          <div class="an-prow an-rowhead"><span>TIME</span><span>WORST</span><span>LAYERS</span><span>WINDOW</span><span>RACK · PAGE</span></div>
          <div id="anSpikes" class="an-rows"></div>
        </section>
      </div>
      <div class="an-plower">
        <section class="an-cell" aria-label="What costs the most">
          <div class="an-h">WHAT COSTS THE MOST <span>average load while playing</span></div>
          <div id="anCosts"></div>
          <div class="an-empty">With against without, over the samples where something was playing. Per-effect timing in the engine itself is not built yet.</div>
        </section>
        <section class="an-cell" aria-label="Exports">
          <div class="an-h">EXPORTS <span>render speed against real time</span></div>
          <div class="an-xrow an-rowhead"><span>KIND</span><span>LENGTH</span><span>TOOK</span><span>SPEED</span><span>PEAK CPU · FILE</span></div>
          <div id="anExports" class="an-rows"></div>
        </section>
        <section class="an-cell" aria-label="Interface frames">
          <div class="an-h">INTERFACE <span>frames over 50 ms, reported by the browser</span></div>
          <div id="anFrames"></div>
        </section>
      </div>
    </div>
    <div class="an-body hidden" id="anStorage">
      <section class="an-cell an-store">
        <div class="an-h">ON DISK <span id="anStoreTotal"></span><span class="an-fill"></span><span id="anStoreLast"></span></div>
        <div class="an-stack" id="anStoreBar"></div>
        <div class="an-legend" id="anStoreLegend"></div>
        <div class="an-ret">
          <span class="an-sub">WHAT</span><span class="an-sub">KEEP</span><span class="an-sub">THEN</span>
          <span>Usage events and mouse grids</span><select data-ret="events"></select><span class="d">rolled into daily summaries, then deleted</span>
          <span>Performance samples</span><select data-ret="perf"></select><span class="d">percentiles kept in the summaries, then deleted</span>
          <span>Spikes and export timings</span><select data-ret="spikes"></select><span class="d">deleted</span>
          <span>Daily summaries</span><select data-ret="daily"></select><span class="d">deleted</span>
          <span>Folder cap</span><select data-ret="capMB"></select><span class="d">over it, the oldest detail goes first and summaries last</span>
        </div>
        <div class="an-h"><span class="an-fill"></span><button type="button" class="an-btn" id="anPurge">Purge now</button></div>
        <div class="an-empty">The server checks when it starts and then once a day, on its own thread, never during an export. A day's detail is summarised before it is deleted.</div>
      </section>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.an-ranges').innerHTML = anSeg('anrange', AN_RANGES, anv.range);
  el.querySelector('.an-ctlseg').innerHTML = anSeg('anctl', [['most', 'Most used'], ['least', 'Least used'], ['never', 'Never touched']], anv.ctl);

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, .an-row[data-c], .an-srow[data-s]');
    if (!b) return;
    if (b.dataset.antab) { anv.tab = b.dataset.antab; anRender(); return; }
    if (b.dataset.anrange) { anv.range = b.dataset.anrange; anLoad(); return; }
    if (b.dataset.anctl) { anv.ctl = b.dataset.anctl; anv.detail = null; anRenderControls(); return; }
    if (b.dataset.anmouse) { anv.mouse = b.dataset.anmouse; anRenderMouse(); return; }
    if (b.dataset.c) { anv.detail = anv.detail === b.dataset.c ? null : b.dataset.c; anRenderControls(); return; }
    if (b.dataset.s) { anv.log = anv.log === b.dataset.s ? null : b.dataset.s; anRenderLog(); return; }
    if (b.id === 'anClose') closeAnalytics();
    if (b.id === 'anPause') { anSetRecording(!an.on); anRenderPause(); }
    if (b.id === 'anExport') anExport();
    if (b.id === 'anClear') anClear();
    if (b.id === 'anPurge') anPurge();
  });
  for (const sel of el.querySelectorAll('[data-ret]')) sel.addEventListener('change', () => anSetRetention(sel.dataset.ret, +sel.value));
  el.querySelector('#anPage').addEventListener('change', (e) => { anv.page = e.target.value; anSummariseNow(); });
  el.querySelector('#anSession').addEventListener('change', (e) => { anv.session = e.target.value; anSummariseNow(); });
  el.querySelector('#anKind').addEventListener('change', () => anRenderControls());
  document.addEventListener('keydown', (e) => {
    if (anv.open && e.key === 'Escape') { e.stopPropagation(); closeAnalytics(); }
  }, true);
  window.addEventListener('resize', () => { if (anv.open) anRender(); });
  anv.el = el;
}

function openAnalytics() {
  if (!anv.el) anBuild();
  if (anv.open) return;
  anPageChange('analytics');
  an.page = 'analytics';
  anv.open = true;
  const bar = document.querySelector('header.menubar');
  anv.el.style.top = `${bar ? bar.getBoundingClientRect().bottom : 0}px`;
  anv.el.classList.remove('hidden');
  anRenderPause();
  anLoad();
}

function closeAnalytics() {
  if (!anv.open) return;
  anv.open = false;
  anv.el.classList.add('hidden');
  anPageChange(state.mode);
  an.page = null;
}

function toggleAnalytics() {
  anv.open ? closeAnalytics() : openAnalytics();
}

async function anLoad() {
  const to = Date.now() + 1;
  const from = anRangeFrom(anv.range);
  await analytics.flush();
  try {
    const [r, p, st] = await Promise.all([
      an.fetch(`/api/analytics?from=${from}&to=${to}`),
      an.fetch(`/api/analytics/perf?from=${from}&to=${to}`),
      an.fetch('/api/analytics/storage'),
    ]);
    anv.data = await r.json();
    anv.perf = await p.json();
    anv.storage = await st.json();
  } catch {
    anv.data = { events: [], catalogue: {}, daily: [] };
    anv.perf = { perf: [], spikes: [], exports: [] };
  }
  anv.from = from;
  anSummariseNow();
}

function anSummariseNow() {
  const d = anv.data || { events: [], catalogue: {} };
  const events = anv.session ? d.events.filter((e) => e.s === anv.session) : d.events;
  anv.sum = anSummarise(events, d.catalogue || {}, { page: anv.page });
  // Days already purged to summaries count too, unless one session is chosen.
  if (!anv.session && !anv.page) anMergeDaily(anv.sum, d.daily, new Set(d.events.map((e) => analyticsDay(e.t))));
  anv.all = anv.session ? anSummarise(d.events, {}, {}) : anv.sum;
  const pf = anv.perf || { perf: [], spikes: [], exports: [] };
  const sess = anv.session && anv.all.sessions.find((s) => s.id === anv.session);
  const inS = (r) => !sess || (r.t >= sess.start && r.t <= sess.end + 10_000);
  anv.psum = anPerfSummarise(pf.perf.filter(inS), pf.spikes.filter(inS), pf.exports.filter(inS), events);
  anv.span = sess ? [sess.start, sess.end] : anv.all.sessions[0] ? [anv.all.sessions[0].start, anv.all.sessions[0].end] : null;
  anRender();
}

function anRenderPause() {
  if (!anv.el) return;
  const b = anv.el.querySelector('#anPause');
  b.textContent = an.on ? 'Pause recording' : 'Resume recording';
  b.classList.toggle('warn', !an.on);
}

function anRender() {
  if (!anv.el || !anv.sum) return;
  const el = anv.el;
  for (const b of el.querySelectorAll('[data-antab]')) b.setAttribute('aria-selected', String(b.dataset.antab === anv.tab));
  for (const b of el.querySelectorAll('[data-anrange]')) { b.classList.toggle('on', b.dataset.anrange === anv.range); b.setAttribute('aria-pressed', String(b.dataset.anrange === anv.range)); }
  el.querySelector('#anOverview').classList.toggle('hidden', anv.tab !== 'overview');
  el.querySelector('#anMouse').classList.toggle('hidden', anv.tab !== 'mouse');
  el.querySelector('#anPerf').classList.toggle('hidden', anv.tab !== 'perf');
  el.querySelector('#anStorage').classList.toggle('hidden', anv.tab !== 'storage');
  const fmt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  el.querySelector('#anSpan').textContent = `${anv.from ? fmt(anv.from) : 'all time'} – ${fmt(Date.now())}`;

  const pages = new Set(['overview', 'edit', 'room', 'seq', 'compose']);
  for (const e of anv.data.events) if (e.m) pages.add(e.m);
  el.querySelector('#anPage').innerHTML = `<option value="">all pages</option>${[...pages].map((m) =>
    `<option value="${anEsc(m)}" ${m === anv.page ? 'selected' : ''}>${anEsc(anPageName(m))}</option>`).join('')}`;
  const ss = anv.all.sessions;
  el.querySelector('#anSession').innerHTML = `<option value="">all ${ss.length} sessions</option>${ss.map((s) =>
    `<option value="${anEsc(s.id)}" ${s.id === anv.session ? 'selected' : ''}>${anEsc(anWhen(s.start))} · ${anDuration(s.ms)}</option>`).join('')}`;

  if (anv.tab === 'mouse') { anRenderMouse(); return; }
  if (anv.tab === 'perf') { anRenderPerf(); return; }
  if (anv.tab === 'storage') { anRenderStorage(); return; }
  anRenderKpis();
  anRenderPages();
  anRenderControls();
  anRenderHeat();
  anRenderPaths();
  anRenderSessions();
  anRenderLog();
}

function anWhen(t) {
  return new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function anRenderKpis() {
  const t = anv.sum.totals;
  const avg = t.sessions ? anDuration((t.active + t.idle) / t.sessions) : '—';
  const per = t.active > 60_000 ? (t.events / (t.active / 60_000)).toFixed(1) : '—';
  const k = [
    ['SESSIONS', t.sessions, `avg ${avg}`],
    ['ACTIVE TIME', anDuration(t.active), `idle ${anDuration(t.idle)} excluded`],
    ['EVENTS', t.events.toLocaleString('en-GB'), `${per} / active min`],
    ['CONTROLS TOUCHED', `${t.touched} / ${t.controls}`, `${t.never} never touched`],
    ['EDITS', t.edits, `undo ${t.undo}`],
    ['EFFECTS', `+${t.fxAdded} −${t.fxRemoved}`, `presets ${t.presets}`],
    ['EXPORTS', t.exports, `files opened ${t.files}`],
    ['ERRORS', t.errors, t.lastError ? `last: ${anEsc(t.lastError.d?.path || t.lastError.d?.msg || '')}` : 'none'],
  ];
  anv.el.querySelector('#anKpis').innerHTML = k.map(([l, v, s]) =>
    `<div class="an-kpi"><span class="l">${l}</span><span class="v mono">${v}</span><span class="s">${s}</span></div>`).join('');
}

function anBarRow(name, value, pct, cls = '') {
  return `<div class="an-bar ${cls}"><span class="n">${anEsc(name)}</span><span class="t"><i style="width:${Math.max(0.5, pct).toFixed(1)}%"></i></span><span class="mono v">${value}</span></div>`;
}

function anRenderPages() {
  const { pages, docks } = anv.all === anv.sum ? anv.sum : anv.sum;
  const total = pages.reduce((a, p) => a + p.ms, 0) || 1;
  anv.el.querySelector('#anPages').innerHTML = pages.length ? pages.map((p) =>
    anBarRow(p.name, `${anDuration(p.ms)} · ${Math.round(p.ms / total * 100)}%`, p.ms / total * 100, `pg-${p.m}`)).join('') : '<div class="an-empty">Nothing recorded yet.</div>';
  const dt = docks.reduce((a, d) => a + d.ms, 0) || 1;
  anv.el.querySelector('#anDocks').innerHTML = docks.map((d) => anBarRow(d.dk, anDuration(d.ms), d.ms / dt * 100)).join('') || '<div class="an-empty">No Edit time.</div>';
}

function anRenderControls() {
  if (!anv.sum) return;
  for (const b of anv.el.querySelectorAll('[data-anctl]')) { b.classList.toggle('on', b.dataset.anctl === anv.ctl); b.setAttribute('aria-pressed', String(b.dataset.anctl === anv.ctl)); }
  const kind = anv.el.querySelector('#anKind').value;
  const { controls, never, totals } = anv.sum;
  let rows = anv.ctl === 'never' ? never : anv.ctl === 'least' ? controls.slice().reverse() : controls;
  if (kind) rows = rows.filter((r) => r.ck === kind);
  anv.el.querySelector('#anCtlCount').textContent = `${totals.touched} of ${totals.controls} touched · ${totals.never} never`;
  const now = Date.now();
  anv.el.querySelector('#anCtlRows').innerHTML = rows.slice(0, 150).map((r, i) => {
    const lo = r.lo ?? r.min, hi = r.hi ?? r.max;
    let bar = '', txt = '—';
    if (r.min != null && hi != null && hi > lo) {
      const a = (r.min - lo) / (hi - lo) * 100, b = (r.max - lo) / (hi - lo) * 100;
      bar = `<i style="left:${a.toFixed(1)}%;width:${Math.max(1, b - a).toFixed(1)}%"></i>`;
      txt = `${anNum(r.min)}–${anNum(r.max)}`;
    } else if (r.values && Object.keys(r.values).length) {
      txt = Object.entries(r.values).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([v]) => v).join(', ');
    }
    const open = anv.detail === r.c;
    return `<div class="an-row ${open ? 'open' : ''}" data-c="${anEsc(r.c)}" title="${anEsc(r.c)}">
      <span class="mono d">${i + 1}</span><span class="nm">${anEsc(r.l)}</span><span class="d">${anEsc(anPanelName(r.p))}</span>
      <span class="d">${anEsc(r.ck)}</span><span class="mono r">${r.uses.toLocaleString('en-GB')}</span>
      <span class="rng"><span class="trk">${bar}</span><span class="mono d">${anEsc(txt)}</span></span>
      <span class="mono r d">${anAgo(r.last, now)}</span></div>${open ? anDetail(r) : ''}`;
  }).join('') || '<div class="an-empty">None.</div>';
}

function anNum(v) {
  return Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(2);
}

/// One control in depth: where its values went, and when it was used.
function anDetail(r) {
  const ev = (anv.data?.events || []).filter((e) => e.c === r.c);
  const days = {};
  for (const e of ev) { const d = new Date(e.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); days[d] = (days[d] || 0) + 1; }
  const dayMax = Math.max(1, ...Object.values(days));
  const dayBars = Object.entries(days).map(([d, n]) => `<span class="db" title="${d}: ${n}"><i style="height:${(n / dayMax * 100).toFixed(0)}%"></i><b>${d}</b></span>`).join('');
  let hist = '';
  if (r.tos?.length) {
    const lo = r.lo ?? r.min, hi = r.hi ?? r.max, bins = new Array(20).fill(0);
    if (hi > lo) for (const v of r.tos) bins[Math.min(19, Math.max(0, Math.floor((v - lo) / (hi - lo) * 20)))]++;
    const m = Math.max(1, ...bins);
    hist = `<div class="an-hist" title="Where it was left, ${anNum(lo)} to ${anNum(hi)}">${bins.map((n) => `<i style="height:${(n / m * 100).toFixed(0)}%"></i>`).join('')}</div>`;
  }
  return `<div class="an-detail">${hist ? `<div><div class="an-sub">VALUES LEFT AT</div>${hist}</div>` : ''}<div><div class="an-sub">USES BY DAY</div><div class="an-days">${dayBars || '—'}</div></div></div>`;
}

/// The panels, drawn where they are on the page that is open behind this one.
function anRenderHeat() {
  const box = anv.el.querySelector('#anHeat');
  const heat = anv.sum.heat;
  const max = Math.max(1, ...Object.values(heat));
  const W = box.clientWidth || 380, H = box.clientHeight || 300;
  const sx = W / innerWidth, sy = H / innerHeight;
  const placed = [], off = [];
  for (const [p, n] of Object.entries(heat)) {
    const node = document.getElementById(p);
    const r = node && node.offsetParent !== null ? node.getBoundingClientRect() : null;
    if (r && r.width > 4 && r.height > 4) placed.push({ p, n, r, area: r.width * r.height });
    else off.push({ p, n });
  }
  placed.sort((a, b) => b.area - a.area);
  box.innerHTML = placed.map(({ p, n, r }) => {
    const v = Math.sqrt(n / max);
    return `<div class="an-hb" style="left:${(r.left * sx).toFixed(1)}px;top:${(r.top * sy).toFixed(1)}px;width:${(r.width * sx).toFixed(1)}px;height:${(r.height * sy).toFixed(1)}px;--h:${v.toFixed(3)}" title="${anEsc(anPanelName(p))}: ${n}">
      <span>${anEsc(anPanelName(p))}</span><span class="mono">${n.toLocaleString('en-GB')}</span></div>`;
  }).join('') || '<div class="an-empty">Nothing on this page has been used yet.</div>';
  anv.el.querySelector('#anHeatNote').textContent = `as ${anPageName(state.mode)} is laid out now`;
  off.sort((a, b) => b.n - a.n);
  anv.el.querySelector('#anHeatList').innerHTML = off.length
    ? `<div class="an-sub">NOT ON THIS PAGE</div>${off.slice(0, 12).map(({ p, n }) => anBarRow(anPanelName(p), n.toLocaleString('en-GB'), n / max * 100)).join('')}` : '';
}

function anRenderPaths() {
  const { paths, seqs } = anv.sum;
  const pm = Math.max(1, ...paths.map((p) => p.n));
  anv.el.querySelector('#anPaths').innerHTML = paths.map((p) => anBarRow(p.label, p.n, p.n / pm * 100)).join('') || '<div class="an-empty">No page changes.</div>';
  anv.el.querySelector('#anSeqs').innerHTML = seqs.map((s) => `<div class="an-seq"><span>${anEsc(s.label)}</span><span class="mono">${s.n}</span></div>`).join('') || '<div class="an-empty">Not enough actions yet.</div>';
}

function anRenderSessions() {
  const pages = ['overview', 'edit', 'room', 'seq', 'compose', 'analytics'];
  anv.el.querySelector('#anLegend').innerHTML = pages.map((m) => `<span><i class="pg-${m}"></i>${anPageName(m)}</span>`).join('')
    + '<span><i class="idle"></i>idle</span><span><i class="err"></i>error</span>';
  anv.el.querySelector('#anSessions').innerHTML = anv.sum.sessions.slice(0, 40).map((s) => `
    <button type="button" class="an-srow ${anv.log === s.id ? 'open' : ''}" data-s="${anEsc(s.id)}">
      <span class="w"><span>${anEsc(anWhen(s.start))}</span><span class="mono d">${anDuration(s.ms)} · idle ${anDuration(s.idle)}</span></span>
      <span class="tl">${s.segs.map((g) => `<i class="${g.m === 'idle' ? 'idle' : `pg-${anEsc(g.m)}`}" style="left:${(g.a * 100).toFixed(2)}%;width:${Math.max(0.2, (g.b - g.a) * 100).toFixed(2)}%"></i>`).join('')}${
        s.ticks.map((x) => `<b style="left:${(x * 100).toFixed(2)}%"></b>`).join('')}${s.errors.map((x) => `<b class="err" style="left:${(x * 100).toFixed(2)}%"></b>`).join('')}</span>
      <span class="mono d n">${s.events.toLocaleString('en-GB')} ev</span>
    </button>`).join('') || '<div class="an-empty">No sessions in this range.</div>';
}

function anRenderLog() {
  const box = anv.el.querySelector('#anLog');
  box.classList.toggle('hidden', !anv.log);
  if (!anv.log) return;
  const ev = (anv.data?.events || []).filter((e) => e.s === anv.log && e.k !== 'mouse');
  const t0 = ev[0]?.t || 0;
  box.innerHTML = ev.slice(0, 800).map((e) => {
    const s = Math.round((e.t - t0) / 1000);
    return `<div class="an-le"><span class="mono d">${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}</span><span class="mono k">${anEsc(e.k)}</span><span class="d">${anEsc(anPageName(e.m))}</span><span>${anEsc(anStep(e))}</span><span class="d">${anEsc(anPanelName(e.p))}</span></div>`;
  }).join('') + (ev.length > 800 ? `<div class="an-empty">…and ${ev.length - 800} more</div>` : '');
}

// ------------------------------------------------------------- the mouse map

const AN_HEAT_RAMP = [[0, 0, 0, 0], [40, 90, 200, 110], [60, 200, 220, 170], [250, 220, 60, 210], [250, 80, 40, 240]];

function anRamp(v) {
  const x = Math.min(1, Math.max(0, v)) * (AN_HEAT_RAMP.length - 1), i = Math.floor(x), f = x - i;
  const a = AN_HEAT_RAMP[i], b = AN_HEAT_RAMP[Math.min(AN_HEAT_RAMP.length - 1, i + 1)];
  return a.map((c, j) => c + (b[j] - c) * f);
}

function anRenderMouse() {
  for (const b of anv.el.querySelectorAll('[data-anmouse]')) { b.classList.toggle('on', b.dataset.anmouse === anv.mouse); b.setAttribute('aria-pressed', String(b.dataset.anmouse === anv.mouse)); }
  const page = anv.page || state.mode;
  const g = anv.sum.mouse[page];
  const box = anv.el.querySelector('#anMouseBox');
  const cv = anv.el.querySelector('#anMouseCanvas');
  // The page's own shape, as big as fits.
  const bw = box.clientWidth, bh = box.clientHeight, aspect = innerWidth / innerHeight;
  const w = Math.max(10, Math.min(bw, bh * aspect)), h = w / aspect;
  const dpr = devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0e13';
  ctx.fillRect(0, 0, w, h);

  // Panel outlines, for the page that is open behind this one.
  const sx = w / innerWidth, sy = h / innerHeight;
  if (page === state.mode) {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px -apple-system, sans-serif';
    for (const id of Object.keys(AN_PANELS)) {
      if (id === 'analyticsView' || id === 'menuPop') continue;
      const n = document.getElementById(id);
      if (!n || n.offsetParent === null) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 30 || r.height < 14) continue;
      ctx.strokeRect(r.left * sx + 0.5, r.top * sy + 0.5, r.width * sx - 1, r.height * sy - 1);
      if (r.width * sx > 60 && r.height * sy > 14) ctx.fillText(AN_PANELS[id], r.left * sx + 4, r.top * sy + 11);
    }
  }

  const note = anv.el.querySelector('#anMouseNote');
  if (!g) { note.textContent = `${anPageName(page)}: no pointer data in this range yet`; return; }
  const grid = anv.mouse === 'click' ? g.click : g.move;
  let max = 0;
  for (const v of grid) if (v > max) max = v;
  note.textContent = `${anPageName(page)} · ${g.samples.toLocaleString('en-GB')} samples (4 a second while moving) · ${g.clicks.toLocaleString('en-GB')} clicks${page === state.mode ? '' : ' · open that page to see its panels outlined'}`;
  if (!max) return;
  // The grid as a tiny picture, scaled up smooth: the blur comes free.
  const small = document.createElement('canvas');
  small.width = g.gw; small.height = g.gh;
  const img = small.getContext('2d').createImageData(g.gw, g.gh);
  for (let i = 0; i < grid.length; i++) {
    const [r, gg, b, a] = anRamp(grid[i] ? 0.12 + 0.88 * Math.sqrt(grid[i] / max) : 0);
    img.data.set([r, gg, b, a], i * 4);
  }
  small.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
}

// ------------------------------------------------------------- performance

function analyticsDay(t) {
  return new Date(t).toISOString().slice(0, 10);
}

const anPct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function anRenderPerf() {
  const p = anv.psum;
  const clock = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const k = [
    ['AUDIO LOAD', anPct(p.load), 'avg while playing', p.load > 0.7 ? 'warn' : ''],
    ['WORST BLOCK', anPct(p.worst?.worst), p.worst ? `${clock(p.worst.t)}${p.worst.layers != null ? ` · ${p.worst.layers} layers` : ''}` : 'no samples', (p.worst?.worst || 0) > 1 ? 'bad' : (p.worst?.worst || 0) > 0.9 ? 'warn' : ''],
    ['LATE BLOCKS', p.late, p.latePerHour != null ? `${p.latePerHour.toFixed(1)} / hour played` : '—', p.late ? 'bad' : ''],
    ['LOWEST LAYER CAP', Number.isFinite(p.minCap) ? p.minCap : '—', 'while playing', ''],
    ['SERVER CPU', p.cpu == null ? '—' : `${Math.round(p.cpu)}%`, `peak ${Math.round(p.cpuMax)}% (100% = one core)`, ''],
    ['MEMORY', p.rss ? `${Math.round(p.rss)} MB` : '—', 'peak resident', ''],
    ['UI LONG FRAMES', p.lof, p.lof ? `worst ${p.lofWorst} ms` : 'none', p.lofWorst > 150 ? 'warn' : ''],
    ['VIDEO EXPORT', p.videoSpeed ? `×${p.videoSpeed.toFixed(1)}` : '—', 'median speed against real time', ''],
  ];
  anv.el.querySelector('#anPerfKpis').innerHTML = k.map(([l, v, s, c]) =>
    `<div class="an-kpi"><span class="l">${l}</span><span class="v mono ${c}">${anEsc(v)}</span><span class="s">${anEsc(s)}</span></div>`).join('');

  // The timeline: the chosen session, or the latest.
  const span = anv.span;
  const rows = span ? p.rows.filter((r) => r.t >= span[0] - 60_000 && r.t <= span[1] + 60_000) : p.rows;
  const t0 = span ? span[0] : rows[0]?.t || 0, t1 = span ? span[1] : rows[rows.length - 1]?.t || 1;
  const w = Math.max(1, t1 - t0), x = (t) => Math.min(100, Math.max(0, (t - t0) / w * 100));
  const step = Math.max(0.2, 100 / Math.max(1, rows.length));
  const y = (v) => Math.min(100, v / 1.3 * 100);
  anv.el.querySelector('#anLoadNote').textContent = span ? `${anWhen(span[0])} · share of the real-time budget per sample · band = average, mark = worst block` : 'no session in range';
  anv.el.querySelector('#anLoad').innerHTML = `<div class="an-budget" style="bottom:${y(1)}%"><span>100% budget</span></div><div class="an-half" style="bottom:${y(0.5)}%"><span>50%</span></div>`
    + rows.filter((r) => r.mean != null).map((r) => `<i style="left:${x(r.t).toFixed(2)}%;width:${step.toFixed(2)}%;height:${y(r.mean).toFixed(1)}%"></i><b class="${r.worst > 1 ? 'bad' : ''}" style="left:${x(r.t).toFixed(2)}%;width:${step.toFixed(2)}%;bottom:${y(r.worst || 0).toFixed(1)}%"></b>`).join('')
    + rows.filter((r) => r.late).map((r) => `<u style="left:${x(r.t).toFixed(2)}%" title="${r.late} late"></u>`).join('');
  anv.el.querySelector('#anDoing').innerHTML = rows.map((r) => `<i class="act-${anEsc(r.act)}" style="left:${x(r.t).toFixed(2)}%;width:${step.toFixed(2)}%"></i>`).join('');
  const cmax = Math.max(100, ...rows.map((r) => r.cpu || 0));
  anv.el.querySelector('#anCpu').innerHTML = rows.map((r) => `<i style="left:${x(r.t).toFixed(2)}%;width:${step.toFixed(2)}%;height:${((r.cpu || 0) / cmax * 100).toFixed(0)}%"></i>`).join('');
  const lof = (anv.data?.events || []).filter((e) => e.k === 'lof' && (!span || (e.t >= t0 && e.t <= t1)));
  anv.el.querySelector('#anLof').innerHTML = lof.map((e) => `<b style="left:${x(e.t).toFixed(2)}%" title="${e.ms} ms"></b>`).join('');

  anv.el.querySelector('#anSpikes').innerHTML = p.spikes.map((r) => `<div class="an-prow">
    <span class="mono d">${clock(r.t)}</span><span class="mono ${r.worst > 1 ? 'bad' : 'warn'}">${anPct(r.worst)}</span><span class="mono">${r.layers ?? '—'}</span>
    <span class="mono">${r.win != null ? `${Math.round(r.win)} ms` : '—'}</span><span class="d">${anEsc([(r.fx || []).join(', ') || '—', r.page].filter(Boolean).join(' · '))}</span></div>`).join('')
    || '<div class="an-empty">No block has passed 90% in this range.</div>';
  const cm = Math.max(0.01, ...p.costs.map((c) => Math.abs(c.v)));
  anv.el.querySelector('#anCosts').innerHTML = p.costs.map((c) => anBarRow(c.n, c.abs ? anPct(c.v) : `${c.v >= 0 ? '+' : '−'}${Math.round(Math.abs(c.v) * 100)}%`, Math.abs(c.v) / cm * 100)).join('')
    || '<div class="an-empty">Not enough playing time yet to compare.</div>';
  const secs = (v) => (v >= 60 ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}` : `${v.toFixed(1)} s`);
  anv.el.querySelector('#anExports').innerHTML = p.exports.map((x) => `<div class="an-xrow">
    <span>${anEsc(x.kind)}</span><span class="mono">${x.len != null ? secs(x.len) : '—'}</span><span class="mono">${secs(x.took || 0)}</span>
    <span class="mono ${x.speed != null && x.speed < 3 ? 'warn' : ''}">${x.speed != null ? `×${x.speed.toFixed(1)}` : '—'}</span>
    <span class="d">${Math.round(x.cpuMax || 0)}% · ${anEsc(x.file || '')}${x.ok === false ? ' · failed' : ''}</span></div>`).join('')
    || '<div class="an-empty">No exports in this range.</div>';
  const fm = Math.max(1, ...p.lofWhere.map((g) => g.n));
  anv.el.querySelector('#anFrames').innerHTML = p.lofWhere.map((g) => anBarRow(g.where, `${g.n} · ${g.worst} ms`, g.n / fm * 100)
    + (g.top ? `<div class="an-src d">mostly ${anEsc(g.top)}</div>` : '')).join('') || '<div class="an-empty">No long frames.</div>';
}

// ------------------------------------------------------------- storage

const AN_RET_OPTIONS = {
  events: [7, 30, 60, 90, 180, 365], perf: [7, 14, 30, 60, 90], spikes: [30, 90, 180, 365],
  daily: [180, 365, 730, 1825], capMB: [25, 50, 100, 250, 500, 1000],
};

function anBytes(b) {
  return b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

function anRenderStorage() {
  const st = anv.storage || { bytes: 0, kinds: {}, retention: {}, last: null };
  const cap = (st.retention.capMB || 100) * 1_048_576;
  anv.el.querySelector('#anStoreTotal').textContent = `${anBytes(st.bytes)} of a ${anBytes(cap)} cap`;
  anv.el.querySelector('#anStoreLast').textContent = st.last
    ? `last purge ${anWhen(st.last.at)} · removed ${anBytes(st.last.removed || 0)} · ${st.last.summarised || 0} days summarised` : 'not purged yet';
  const kinds = [['events', 'usage events'], ['perf', 'performance'], ['spikes', 'spikes and exports'], ['daily', 'daily summaries'], ['other', 'catalogue and settings']];
  anv.el.querySelector('#anStoreBar').innerHTML = kinds.map(([k]) => `<i class="st-${k}" style="width:${((st.kinds[k] || 0) / cap * 100).toFixed(2)}%"></i>`).join('');
  anv.el.querySelector('#anStoreLegend').innerHTML = kinds.map(([k, l]) => `<span><i class="st-${k}"></i>${l} ${anBytes(st.kinds[k] || 0)}</span>`).join('');
  for (const sel of anv.el.querySelectorAll('[data-ret]')) {
    const key = sel.dataset.ret, cur = st.retention[key];
    const opts = [...new Set([...AN_RET_OPTIONS[key], cur].filter((v) => v != null))].sort((a, b) => a - b);
    sel.innerHTML = opts.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${key === 'capMB' ? (v >= 1000 ? `${v / 1000} GB` : `${v} MB`) : v >= 365 && v % 365 === 0 ? `${v / 365} year${v === 365 ? '' : 's'}` : `${v} days`}</option>`).join('');
  }
}

async function anSetRetention(key, value) {
  const r = await an.fetch('/api/analytics/retention', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) });
  anv.storage = await r.json();
  anRenderStorage();
}

async function anPurge() {
  await an.fetch('/api/analytics/purge', { method: 'POST' });
  anv.storage = await (await an.fetch('/api/analytics/storage')).json();
  anRenderStorage();
}

// ------------------------------------------------------------- export and clear

function anExport() {
  const blob = new Blob([JSON.stringify({ ...(anv.data || {}), ...(anv.perf || {}) }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `multigrainlive-analytics-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function anClear() {
  if (!confirm('Forget everything recorded about how the app has been used? This cannot be undone.')) return;
  an.queue = [];
  await an.fetch('/api/analytics/clear', { method: 'POST' });
  an.catalogued.clear();
  anLoad();
}

// View › Analytics, appended the way the peak commands are.
MENUS.find((m) => m.title === 'View')?.items.push({ sep: true }, { label: 'Analytics', key: tick(() => anv.open), run: toggleAnalytics });
