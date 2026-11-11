// ================================================================ Grain: the controls
//
// Every control on the page is a bar, a switch or a choice, built from the table
// in `400-grain-kit.js` and painted from the drafts. The bar is the mock-up's: a
// picture of the value, then a well with the name, the reading and the fill. A
// click sets it, a drag follows, Shift is ten times finer, a double-click on it
// or its picture puts it back.
//
// The frame loop repaints any bar whose draft has moved (`gsPaintAll`), so a
// preset, an undo, automation or the tray changing a value shows here with no
// message passed. This part also lays out the shared controls and the engine's
// own, and holds the Tuning menu.

const GS_BARS = {};

function gsBar(k, w, cls = '') {
  const c = GS_C[k], st = `style="${w ? `width:${w}px;` : ''}--gg:var(--gs-f-${gsFacet(k)})"`, g = gsSvgG('');
  const tip = gsAttr(GS_TIPS[k] || c.label);
  if (c.sw) return `<div class="gs-bc sw ${cls}" data-k="${k}" ${st} title="${tip}">${g}<div class="gs-tg gs-btn"><i></i><span>${c.label}</span></div></div>`;
  if (c.seg) return `<div class="gs-bc sg ${cls}" data-k="${k}" ${st} title="${tip}">${g}<span class="sl">${c.label}</span><div class="gs-seg">${c.seg.map((s, i) => `<span data-i="${i}">${s}</span>`).join('')}</div></div>`;
  return `<div class="gs-bc ${cls}" data-k="${k}" ${st} title="${tip}">${g}<div class="gs-bw gs-well"><i class="gs-bf"></i><i class="gs-bm"></i><i class="gs-bd"></i><span class="gs-bn">${c.label}</span><b class="gs-bv"></b></div></div>`;
}

function gsMount(root) {
  root.querySelectorAll('.gs-bc[data-k]').forEach((el) => { if (!el._w) { el._w = 1; gsWireBar(el); } });
  gsCvs(root);
  if (GS_L.got) gsLfoTitles();
}

function gsWireBar(el) {
  const k = el.dataset.k, c = GS_C[k];
  (GS_BARS[k] ??= new Set()).add(el);
  gsPaintBar(el, k);
  const reset = () => { if (!el.classList.contains('dim')) gsUser(k, c.d); };
  el.querySelector('svg.gg').addEventListener('dblclick', reset);
  if (c.sw) {
    el.querySelector('.gs-tg').onclick = () => { if (!el.classList.contains('dim')) gsUser(k, gsRead(k) ? 0 : 1); };
    return;
  }
  if (c.seg) {
    el.querySelectorAll('.gs-seg span').forEach((s, i) => { s.onclick = () => gsUser(k, i); });
    return;
  }
  const w = el.querySelector('.gs-bw');
  // A slider keeps the arrow keys once it has been touched.
  w.tabIndex = -1;
  w.addEventListener('keydown', (e) => gsBarKey(e, k, el));
  w.addEventListener('pointerdown', (e) => {
    if (e.button || el.classList.contains('dim')) return;
    e.preventDefault();
    w.focus({ preventScroll: true });
    w.setPointerCapture(e.pointerId);
    const W = w.offsetWidth, nx = (ev) => wvClamp((wvLocal(w, ev)[0] - 4) / (W - 8));
    let lx = wvLocal(w, e)[0], n = gsToN(c, gsRead(k));
    if (!e.shiftKey) { n = nx(e); gsSetN(k, n); gsSend(c, true); }
    const mv = (ev) => {
      const x = wvLocal(w, ev)[0];
      if (ev.shiftKey) n = wvClamp(n + (x - lx) / (W - 8) * 0.1);
      else n = nx(ev);
      gsSetN(k, n);
      gsSend(c, true);
      lx = x;
    };
    const up = () => {
      w.removeEventListener('pointermove', mv);
      w.removeEventListener('pointerup', up);
      w.removeEventListener('pointercancel', up);
      gsCommit(c);
    };
    w.addEventListener('pointermove', mv);
    w.addEventListener('pointerup', up);
    w.addEventListener('pointercancel', up);
  });
  w.addEventListener('dblclick', reset);
}

function gsGlyph(k, v, t) {
  const f = GG_DRAW[k];
  return f ? f(v, t) : '';
}

function gsPaintGlyph(el, k, v, t) {
  const g = el.querySelector('svg.gg'), s = gsGlyph(k, GS_C[k].sw ? (v ? 1 : 0) : v, t);
  if (g._s !== s) { g.innerHTML = s; g._s = s; }
}

function gsPaintBar(el, k) {
  const c = GS_C[k], v = gsRead(k);
  el._v = v;
  if (c.sw) el.querySelector('.gs-tg').classList.toggle('on', !!v);
  else if (c.seg) el.querySelectorAll('.gs-seg span').forEach((s, i) => s.classList.toggle('on', i === v));
  else {
    const n = gsToN(c, v), z = c.bip ? gsToN(c, 0) : 0, f = el.querySelector('.gs-bf'), a = Math.min(n, z), b = Math.max(n, z);
    f.style.left = `calc(4px + (100% - 8px) * ${a.toFixed(4)})`;
    f.style.width = `calc((100% - 8px) * ${(b - a).toFixed(4)})`;
    f.classList.toggle('neg', n < z);
    el.querySelector('.gs-bv').textContent = c.fmt(v);
  }
  gsPaintGlyph(el, k, v, GG_MOVES.has(k) ? ggNow() : 0);
}

function gsPaint(k) {
  const set = GS_BARS[k];
  if (!set) return;
  for (const el of set) {
    if (!el.isConnected) { set.delete(el); continue; }
    gsPaintBar(el, k);
  }
}

/// Repaint whatever has moved since last time.
function gsPaintAll() {
  for (const k in GS_BARS) {
    for (const el of GS_BARS[k]) {
      if (!el.isConnected) { GS_BARS[k].delete(el); continue; }
      if (el._v !== gsRead(k)) gsPaintBar(el, k);
    }
  }
}

/// The glyphs that move are redrawn on their own clock, as the tray's are.
function gsAnimateGlyphs() {
  const t = ggNow();
  for (const k of GG_MOVES) for (const el of GS_BARS[k] || []) if (el.isConnected) gsPaintGlyph(el, k, gsRead(k), t);
}

/// Pitch lands on the tuning, here as the server will have it.
function gsSnapPitch(v) {
  if (!currentScale() && !(currentStep() > 0)) return v;
  const { cents, span } = scaleDegrees();
  const p = span / 100, o = Math.floor(v / p), r = v - o * p;
  let best = 0, bd = 1e9;
  for (const c of [...cents.map((x) => x / 100), p]) {
    const d = Math.abs(c - r);
    if (d < bd) { bd = d; best = c; }
  }
  return o * p + best;
}

/// Write a value to its draft and show it. Sending is the caller's.
function gsSetV(k, v) {
  const c = GS_C[k];
  if (!Number.isFinite(+v)) return;
  if (!c.sw && !c.seg) {
    v = wvClamp(v, c.min, c.max);
    if (c.detent != null && Math.abs(v - c.detent) <= (c.max - c.min) * 0.06) v = c.detent;
    if (k === 'semitones' || k === 'fbShift') v = wvClamp(gsSnapPitch(v), c.min, c.max);
  }
  gsWrite(k, v);
  gsPaint(k);
  if (k === 'cloud') gsApplyEngine();
  if (k === 'cloud' || k === 'preserveTransients') gsApplyDims();
}

function gsSetN(k, n) { gsSetV(k, gsFromN(GS_C[k], n)); }

/// A hand changed it, once and for all: a switch, a choice, a reset.
function gsUser(k, v) {
  gsSetV(k, v);
  gsCommit(GS_C[k]);
}

/// What the tray hides, this page dims, so nothing moves: Position and Rate
/// until the cloud is playing, the Cloud mix until there is a cloud, Detector,
/// Floor and Guard until transients are preserved.
function gsApplyDims() {
  const act = gsCloudActive(), toggle = (k, on) => { for (const el of GS_BARS[k] || []) el.classList.toggle('dim', on); };
  for (const k of ['position', 'rateHz']) toggle(k, !act);
  toggle('cloudMix', !gsRead('cloud'));
  const off = GS.engine === 'wsola' && !gsRead('preserveTransients');
  for (const k of ['sensitivity', 'floor', 'guardHops']) toggle(k, off);
}

// ──────────────────────────────────────────────────────── laying the controls out

const gsSubHead = (name, keys) => `<div class="gs-sub">${name}${[...new Set(keys.map(gsFacet))].map((f) => `<i style="background:var(--gs-f-${f})"></i>`).join('')}</div>`;

function gsBuildShared() {
  const W = 222, bars = (ks) => ks.map((k) => gsBar(k, W)).join('');
  $('gsSh1').innerHTML = gsSubHead('TIME & PITCH', ['ratio', 'semitones'])
    + bars(['ratio', 'semitones', 'windowMs'])
    + `<div class="gs-bc" style="width:${W}px"><span class="gs-chip gs-btn gs-tunebtn" id="gsTuneBtn" style="height:var(--h-s)"></span><span class="gs-chip gs-btn" id="gsKeysBtn" style="height:var(--h-s)" title="${gsAttr(GS_KEYS_TIP)}">${gsIcon(GS_ICON.keys)}Keys ⧉</span></div>`
    + gsSubHead('PITCH MOVEMENT', ['pitchJitterSemis'])
    + bars(['pitchJitterSemis', 'pitchDriftSemis', 'driftRateHz', 'driftStep'])
    + gsSubHead('RANDOMNESS', ['seed', 'linkJitter'])
    + `<div class="gs-bc" id="gsSeedRow" style="width:${W}px;--gg:var(--gs-f-space)" title="${gsAttr(GS_TIPS.seed)}"><svg class="gg" id="gsSeedG" viewBox="0 0 64 48"></svg><div class="gs-well gs-bw" style="cursor:default"><span class="gs-bn">Seed</span><b class="gs-bv" id="gsSeedRo">1</b></div><span class="gs-btn gs-chip" id="gsReroll" style="height:var(--h-s);flex:none" title="Draw a new seed. Every jitter changes at once; no setting does.">⟳ Re-roll</span></div>`
    + bars(['linkJitter']);
  $('gsSh2').innerHTML = gsSubHead('GRAINS', ['position', 'rateHz', 'envelope'])
    + bars(['position', 'positionJitterMs', 'rateHz', 'densityHz', 'overlap', 'envelope', 'sizeJitter', 'sizeRange', 'scan', 'reverse', 'wrap']);
  $('gsSh3').innerHTML = gsSubHead('LAYERS', ['layers', 'panSpread'])
    + bars(['layers', 'layerSpread', 'layerScatter', 'layerScatterMs', 'panSpread'])
    + gsSubHead('FEEDBACK', ['fbAmount', 'fbShift', 'fbSmear'])
    + bars(['fbAmount', 'fbTimeMs', 'fbSmear', 'fbDamp', 'fbShift', 'fbHold']);
  gsMount($('gsShared'));
  // The tray's own button: its formula, its commit, its readout.
  $('gsReroll').onclick = () => { GS.touched = true; state.grainRows?.seed?.querySelector('button')?.click(); };
  $('gsTuneBtn').onclick = (e) => gsTuneMenu(e.currentTarget);
  $('gsKeysBtn').onclick = (e) => { e.stopPropagation(); (keyboardOpen() ? closeKeyboard : openKeyboard)(); };
  gsEnablePainting($('gsShared'));
}

function gsPaintSeed() {
  const v = state.grainDraft?.seed ?? 1;
  gsTxt('gsSeedRo', String(v));
  const g = $('gsSeedG');
  if (g && g._s !== v && GG_DRAW.seed) { g.innerHTML = GG_DRAW.seed(v); g._s = v; }
}

function gsBuildTabs() {
  $('gsEngTabs').innerHTML = GS_ENG.map(([k, n, d]) => `<div class="gs-tab" data-e="${k}" role="tab" title="${n}: ${d} Double-click: every control back to its default, engine kept">${gsSvgG(GG_ENGINE[k]())}${n}</div>`).join('');
  document.querySelectorAll('#gsEngTabs .gs-tab').forEach((t) => {
    // The tray's own tiles, so the tray, the draft and the commit are its own.
    t.onclick = () => { GS.touched = true; gsFxSetView('eng'); document.querySelector(`#stretchEngine .seg-btn[data-alg="${t.dataset.e}"]`)?.click(); gsApplyEngine(); };
    t.ondblclick = () => { GS.touched = true; resetEverything(); };
  });
}

function gsBuildERight() {
  const e = GS.engine, el = $('gsERight');
  if (e === 'granular') el.innerHTML = '';
  else if (e === 'hybrid') el.innerHTML = `<div class="gs-erow">${gsBar('cloud', 150)}${gsBar('cloudMix', 314)}${gsBar('morphNoise', 136)}</div><div class="gs-erow">${gsBar('harmonicLevel', 200)}${gsBar('percussiveLevel', 200)}${gsBar('residualLevel', 200)}</div>`;
  else el.innerHTML = `<div class="gs-erow">${gsBar('cloud', 160)}${gsBar('cloudMix', 448)}</div>`;
  el.style.display = e === 'granular' ? 'none' : '';
  gsMount(el);
}

/// Three columns that end level, a section running on into the next column when
/// it has to; the switches head the right one.
function gsBuildSections() {
  const e = GS.engine, el = $('gsESects'), ids = GS_ENG_SECT[e];
  el.dataset.e = e;
  if (!ids.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  const B = e === 'hybrid' ? 25 : 29, Hh = 15, sws = [], items = [];
  for (const s of ids) {
    const [nm, ks] = GS_SECT[s], rest = ks.filter((k) => { if (GS_C[k].sw) { sws.push(k); return false; } return true; });
    if (!rest.length) continue;
    items.push({ h: 1, nm, ks: rest });
    rest.forEach((k, i) => items.push({ k, last: i === rest.length - 1 }));
  }
  const cost = (it) => (it.h ? Hh : B + (it.last ? 3 : 0)), sw = sws.length ? sws.length * B + 6 : 0;
  const total = items.reduce((a, it) => a + cost(it), 0) + sw, target = total / 3;
  const cols = [[], [], []], ch = [0, 0, sw];
  let c = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i], next = items[i + 1], need = cost(it) + (it.h && next ? cost(next) : 0);
    if (c < 2 && ch[c] > 0 && ch[c] + need > target + B * 0.5) c++;
    cols[c].push(it);
    ch[c] += cost(it);
  }
  const html = (col, ci) => {
    let out = '', open = false;
    const close = () => { if (open) { out += '</div>'; open = false; } };
    if (ci === 2 && sws.length) out += `<div class="gs-esect">${sws.map((k) => gsBar(k, 196)).join('')}</div>`;
    for (const it of col) {
      if (it.h) {
        close();
        out += `<div class="gs-esect">${gsSubHead(it.nm, GS_SECT[ids.find((s) => GS_SECT[s][0] === it.nm)][1])}`;
        open = true;
      } else {
        if (!open) { out += '<div class="gs-esect">'; open = true; }
        out += gsBar(it.k, 196);
        if (it.last) close();
      }
    }
    close();
    return out;
  };
  el.innerHTML = cols.map((col, i) => `<div class="gs-ecol">${html(col, i)}</div>`).join('');
  el.style.display = '';
  gsMount(el);
  gsEnablePainting(el);
}

/// The boxes for the close-up pictures take what the controls leave: the
/// spectrum at the head and the time map when there is room, then the engine's
/// own (`407-grain-pictures.js`).
function gsSizeEngine() {
  const p = $('gsEngPanel'), re = $('gsREng'), es = $('gsESects');
  if (!p || !GS.showing) return;
  const room = p.clientHeight - re.offsetTop - 10, secH = es.style.display === 'none' ? 0 : es.offsetHeight + 7, rest = room - secH;
  let row = false, lens = 0;
  if (rest >= 190) { row = true; lens = rest - 99; } else if (rest >= 40) lens = rest;
  $('gsHeadRow').style.display = row ? '' : 'none';
  $('gsLensWell').style.display = lens ? '' : 'none';
  if (lens) gsSetH('gsLens', lens - 2);
  gsPicDirty();
}

function gsApplyEngine() {
  const d = state.stretchDraft;
  if (!d) return;
  GS.engine = d.algorithm;
  document.querySelectorAll('#gsEngTabs .gs-tab').forEach((t) => {
    t.classList.toggle('on', t.dataset.e === GS.engine);
    t.setAttribute('aria-selected', String(t.dataset.e === GS.engine));
  });
  gsPlaceTrace();
  gsBuildERight();
  gsBuildSections();
  gsApplyDims();
  gsTxt('gsEngName', (GS_ENG.find((x) => x[0] === GS.engine) || ['', ''])[1].toUpperCase());
  gsSizeEngine();
  requestAnimationFrame(gsSizeEngine);
}

/// The amber line from the engine you are on, under the tabs, into the cable.
function gsPlaceTrace() {
  const v = $('gsEngTabs'), tr = $('gsFxTrace'), t = v?.querySelector('.gs-tab.on');
  if (!tr) return;
  if (!t) { tr.style.display = 'none'; return; }
  tr.style.display = '';
  tr.style.left = (t.offsetLeft + t.offsetWidth / 2) + 'px';
}

// ────────────────────────────────────────────────────────────────── the menus

function gsCloseMenus() {
  for (const id of ['gsMenu', 'gsShelf']) { const m = document.getElementById(id); if (m) { m.hidden = true; m._a = null; } }
}

function gsMenusOpen() {
  return ['gsMenu', 'gsShelf'].some((id) => { const m = document.getElementById(id); return m && !m.hidden; });
}

/// Put a menu under its anchor, in page pixels, inside the page.
function gsPlaceMenu(m, anchor, dx = 0) {
  const app = document.querySelector('#grainView .gs-app'), ar = app.getBoundingClientRect(), r = anchor.getBoundingClientRect();
  const s = ar.width / app.offsetWidth || 1;
  m.hidden = false;
  const left = Math.max(8, Math.min(app.offsetWidth - m.offsetWidth - 8, (r.left - ar.left) / s + dx));
  let top = (r.bottom - ar.top) / s + 6;
  if (top + m.offsetHeight > app.offsetHeight - 8) top = Math.max(8, (r.top - ar.top) / s - m.offsetHeight - 6);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
}

// ───────────────────────────────────────────────────────────────────── tuning

/// A scale as a picture: its degrees round a circle, from its cents, against
/// the semitone ticks.
function gsScaleSvg(cents, span) {
  const r = 14, cx = 19, cy = 19, P = (a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.12)"/>`;
  const nt = Math.round(span / 100);
  for (let k = 0; k < nt; k++) {
    const a = k / nt * WV_TAU - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    s += `<line x1="${(cx + ca * (r + 2)).toFixed(1)}" y1="${(cy + sa * (r + 2)).toFixed(1)}" x2="${(cx + ca * (r + 4)).toFixed(1)}" y2="${(cy + sa * (r + 4)).toFixed(1)}" stroke="rgba(255,255,255,.2)"/>`;
  }
  const pts = cents.map((c) => P(c / span * WV_TAU - Math.PI / 2));
  if (pts.length > 2) s += `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="rgba(124,240,208,.1)" stroke="rgba(124,240,208,.5)" stroke-width="1"/>`;
  pts.forEach(([x, y], i) => { s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i ? 1.7 : 2.4}" fill="${i ? '#e8eaee' : '#7cf0d0'}"/>`; });
  return `<svg viewBox="0 0 38 38" width="38" height="38" aria-hidden="true">${s}</svg>`;
}

const gsAttr = (s) => String(s).split('&').join('&amp;').split('"').join('&quot;').split('<').join('&lt;');

/// Every scale there is, under its groups, with a filter across all of them.
async function gsTuneMenu(anchor) {
  const m = $('gsMenu');
  if (!m.hidden && m._a === anchor) { gsCloseMenus(); return; }
  gsCloseMenus();
  const groups = await loadScales();
  // From the dock, the tuning of the panel in front: an effect's own if it has one.
  const ctx = anchor.id === 'gsKbScale' ? gsDockCtx() : null, fx = ctx?.slot || null, had = fx && GS_FX.tunes.get(fx.id);
  const all = groups.reduce((n, g) => n + g.scales.length, 0), curS = fx ? (had?.scale || '') : currentScale(), curP = fx ? (had?.step ?? -1) : currentStep();
  m._a = anchor;
  m.className = 'gs-menu gs-tmenu';
  const tile = (attr, on, name, info, svg, cat) => `<div class="gs-tt ${on ? 'on' : ''}" ${attr} data-q="${gsAttr((name + ' ' + info + ' ' + (cat || '')).toLowerCase())}" title="${gsAttr(name + ': ' + info)}">${svg}<div class="gs-ttx"><b>${gsAttr(name)}</b><span>${gsAttr(info)}</span></div></div>`;
  let html = `<div class="gs-tmh"><input class="gs-tfilter" id="gsTFilter" placeholder="Filter: name, region, note count…" spellcheck="false"><span class="gs-ro" id="gsTCount"></span></div><div class="gs-tbody"><div class="gs-tg2"><div class="gs-tgh">GRIDS</div><div class="gs-tgrid">`
    + tile('data-step="0"', !curS && !curP, 'Free', 'no grid · any pitch', gsScaleSvg([0], 1200))
    + tile('data-step="1"', !curS && curP === 1, 'Semitone grid', 'twelve to the octave · step 1', gsScaleSvg([...Array(12)].map((_, i) => i * 100), 1200))
    + tile('data-step="0.5"', !curS && curP === 0.5, 'Half-semitone grid', 'twenty-four to the octave · step 0.5', gsScaleSvg([...Array(24)].map((_, i) => i * 50), 1200))
    + '</div></div>';
  for (const g of groups) {
    html += `<div class="gs-tg2"><div class="gs-tgh">${gsAttr(g.category)} <i>${g.scales.length}</i></div><div class="gs-tgrid">`
      + g.scales.map((s) => tile(`data-scale="${gsAttr(s.name)}"`, s.name === curS, s.name, s.info || '', gsScaleSvg(s.cents, s.span || 1200), g.category)).join('')
      + '</div></div>';
  }
  m.innerHTML = html + '</div>';
  const inp = $('gsTFilter'), body = m.querySelector('.gs-tbody');
  const upd = () => {
    const q = inp.value.trim().toLowerCase();
    let n = 0;
    body.querySelectorAll('.gs-tg2').forEach((gr) => {
      let any = 0;
      gr.querySelectorAll('.gs-tt').forEach((t) => {
        const ok = !q || t.dataset.q.includes(q);
        t.style.display = ok ? '' : 'none';
        if (ok) { any = 1; if (t.dataset.scale != null) n++; }
      });
      gr.style.display = any ? '' : 'none';
    });
    $('gsTCount').textContent = q ? `${n} of ${all} scales` : `${all} scales`;
  };
  inp.oninput = upd;
  inp.onkeydown = (e) => e.stopPropagation();
  upd();
  body.querySelectorAll('.gs-tt').forEach((t) => {
    t.onclick = () => {
      gsCloseMenus();
      if (fx) { gsFxTune(fx, t.dataset.scale ?? null, +t.dataset.step, groups); return; }
      GS.touched = true;
      if (t.dataset.scale != null) pickScale(t.dataset.scale);
      else pickScale('', +t.dataset.step);
    };
  });
  gsPlaceMenu(m, anchor, -200);
  setTimeout(() => inp.focus(), 0);
}

function gsTuneName() {
  const n = currentScale(), p = currentStep();
  return n || (p === 1 ? '12 per octave' : p === 0.5 ? '24 per octave' : p > 0 ? `${p} st grid` : 'chromatic');
}

/// The chip in Time & Pitch and the selector in the dock, both from the document.
function gsMarkTune() {
  const n = currentScale(), p = currentStep();
  const text = n || (p === 1 ? 'Semitone grid' : p === 0.5 ? 'Half-semitone grid' : p > 0 ? `${p} st grid` : 'Tuning: free');
  const b = $('gsTuneBtn');
  if (b && b._t !== text) { b._t = text; b.innerHTML = `<span class="tl"></span> ▾`; b.firstChild.textContent = text; b.title = `Tuning: ${text}. What Pitch and the keys snap to. Click to choose`; }
  const k = $('gsKbScale'), ctx = gsDockCtx(), key = `${ctx.who}|${ctx.name}`;
  if (k && k._t !== key) {
    k._t = key;
    k.innerHTML = '<i></i><span></span> ▾';
    k.querySelector('i').textContent = ctx.who;
    k.querySelector('span').textContent = ctx.name;
    k.title = `Tuning for ${ctx.who}: ${ctx.name}. Click to choose. It follows the panel in front: an effect with a tuning of its own shows its own here`;
  }
}
