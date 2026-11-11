// ================================================================ Wave: Matrix
//
// v8 (mock-up F): all the modulation in one place. Every envelope and LFO as a
// small tile across the top (`391c-wave-tiles.js`); under them the patch
// matrix, the only list of connections in the app. Its main form is pins:
// every source a row, every target a column under its group's band, a pin in
// a hole for each connection, dragged up and down for its amount. The columns
// page a group at a time. A switch shows the same connections as rows: on,
// source, amount, target, × source, curve. Every numeric control is a target
// (`docs/WAVE-SYNTH.md`, v8), the modulators' own and the board's included.

// ─────────────────────────────────────────────────────────────── the targets

const WV_OSC_TGT = [['pos', 'Position', 'Position'], ['warp0.amt', 'Warp 1', 'Warp 1'], ['warp1.amt', 'Warp 2', 'Warp 2'], ['uni.det', 'Detune', 'Unison detune'], ['uni.spr', 'Width', 'Unison width'], ['fx.a', 'Effect', 'Effect mix'], ['pitch', 'Pitch', 'Pitch'], ['fine', 'Fine', 'Fine'], ['phase', 'Phase', 'Start phase'], ['rand', 'Rand', 'Phase rand'], ['pan', 'Pan', 'Pan']];
const WV_TGT_GREY = '#c9cfdc';

/// Every target, in groups as the pins' bands show them: `{g, c, ks: [[key,
/// short, full]]}`. The board's group lists the board controls a row moves,
/// so it changes with them.
function wvTargetGroups() {
  const G = [
    ...[0, 1, 2].map((o) => ({ g: 'OSC ' + 'ABC'[o], c: WV_TGT_GREY, ks: WV_OSC_TGT.map(([k, n, f]) => [`osc${o}.${k}`, n, `${'ABC'[o]} ${f}`]) })),
    { g: 'SUB · NOISE', c: WV_TGT_GREY, ks: [['sub.level', 'Sub', 'Sub level'], ['noise.level', 'Noise', 'Noise level']] },
    { g: 'FILTERS', c: WV_TGT_GREY, ks: [0, 1].flatMap((f) => [['cut', 'Cut', 'Cutoff'], ['res', 'Res', 'Res'], ['drive', 'Drive', 'Drive'], ['key', 'Key', 'Key']].map(([k, n, l]) => [`filt${f}.${k}`, `F${f + 1} ${n}`, `F${f + 1} ${l}`])) },
    { g: 'MIX', c: WV_TGT_GREY, ks: [0, 1, 2].map((o) => [`osc${o}.level`, `${'ABC'[o]} Level`, `${'ABC'[o]} Level`]) },
    { g: 'VOICE', c: WV_TGT_GREY, ks: [['voice.glide', 'Glide', 'Glide']] },
    ...[0, 1, 2, 3].map((l) => ({ g: `LFO ${l + 1}`, c: wvSrcColour(`lfo${l}`), ks: [['rate', 'Rate'], ['smooth', 'Smooth'], ['rise', 'Rise']].map(([k, n]) => [`lfo${l}.${k}`, n, `LFO ${l + 1} ${n}`]) })),
    ...['amp', 'env1', 'env2', 'env3'].map((e) => ({ g: e === 'amp' ? 'AMP' : wvSrcLab(e), c: wvSrcColour(e), ks: WV_ADSR.map(([k, n]) => [`${e}.${k}`, n, `${e === 'amp' ? 'Amp' : wvSrcLab(e)} ${n}`]) })),
    { g: 'MACROS', c: '#e6d8b8', ks: WV.macroNames.map((n, i) => [`macro${i}`, `M${i + 1}`, `M${i + 1} ${n}`]) },
  ];
  const board = [...new Set(WV.mods.map((m) => m.dst).filter((d) => d.startsWith('board:')))];
  if (board.length) G.push({ g: 'FX BOARD', c: '#7cf0d0', ks: board.map((d) => [d, wvBoardDstName(d, true), wvBoardDstName(d)]) });
  return G;
}

/// A target's name as a person reads it, from the groups.
function wvTargetName(t) {
  if (!t) return '—';
  if (t.startsWith('board:')) return wvBoardDstName(t);
  for (const G of wvTargetGroups()) for (const [k, , f] of G.ks) if (k === t) return f;
  const m = /^(?:fx)(\d)\.k([0-9])$/.exec(t);
  if (m && WV_FX_CHAIN[+m[1]]) return `${WV_FX_CHAIN[+m[1]].n} ${WV_FX_CHAIN[+m[1]].kn[+m[2]]}`;
  return t.replace('.', ' ');
}

// ─────────────────────────────────────────────────────────────── the view

/// The row under construction in the Rows view's empty slot.
const WV_DRAFT = { src: null, dst: null, via: null };
const wvModAt = (src, dst) => WV.mods.find((m) => m.src === src && m.dst === dst);
const wvAmtTxt = (a) => (a > 0 ? '+' : a < 0 ? '−' : '') + Math.round(Math.abs(a) * 100);

function wvBuildMatrix(view) {
  const top = wvH(`<div class="wv-mxtop">
   <div class="wv-mod wv-panel wv-grp8"><span class="wv-vlab">ENVELOPES</span><div class="wv-tiles" id="wvMEnvTiles"></div></div>
   <div class="wv-mod wv-panel wv-grp8"><span class="wv-vlab">LFOS</span><div class="wv-tiles" id="wvMLfoTiles"></div></div></div>`);
  view.appendChild(top);
  wvBuildMatrixTiles($('wvMEnvTiles'), $('wvMLfoTiles'));
  view.appendChild(wvH(`<div class="wv-mod wv-panel wv-mxt">
   <div class="wv-mh"><span class="wv-nm">PATCH MATRIX</span><span class="wv-ro" id="wvMxCount"></span><span class="wv-sp"></span><span class="wv-hint" id="wvMxHint"></span>
    <div class="wv-seg wv-pgnav" id="wvPgNav"><span data-pg="-1" title="Page back one group of targets">‹</span><span data-pg="1" title="Page on one group of targets">›</span></div>
    <div class="wv-seg" id="wvMxMode"><span data-m="pins" title="Pins: every source down, every target across. Put a pin in a hole to connect them">Pins</span><span data-m="rows" title="Rows: the same connections, one row each: on, source, amount, target, × source, curve">Rows</span></div></div>
   <div class="wv-pg wv-scroll" id="wvMxPins"></div>
   <div id="wvMxList" hidden><div class="wv-mxh"><span>#</span><span>On</span><span>Source</span><span>Amount</span><span>Target</span><span>× Source</span><span>Curve</span><span></span></div><div class="wv-mxb wv-scroll" id="wvMxRows"></div></div></div>`));
}

function wvWireMatrix() {
  wvWireTiles($('wvViewMatrix'));
  document.querySelectorAll('#wvMxMode span').forEach((b) => b.addEventListener('click', () => { WV.mx = b.dataset.m; wvRenderMatrix(); }));
  document.querySelectorAll('#wvPgNav span').forEach((b) => b.addEventListener('click', () => wvPagePins(+b.dataset.pg)));
}

/// The pins or the rows, rebuilt whenever the connections change.
function wvRenderMatrix() {
  if (!$('wvMxPins')) return;
  wvTxt('wvMxCount', `${WV.mods.length} of 64`);
  const pins = WV.mx !== 'rows';
  $('wvMxPins').hidden = !pins;
  $('wvMxList').hidden = pins;
  $('wvPgNav').style.visibility = pins ? '' : 'hidden';
  document.querySelectorAll('#wvMxMode span').forEach((x) => x.classList.toggle('on', x.dataset.m === (pins ? 'pins' : 'rows')));
  wvTxt('wvMxHint', pins ? 'Click a hole for a pin · drag it up and down for the amount · double-click pulls it' : 'Drag an amount across · click a source, target or × source to change it');
  for (const id of Object.keys(WVW)) if (['wvMpr', 'wvMxs', 'wvMxa', 'wvMxc'].some((x) => id.startsWith(x))) delete WVW[id];
  if (pins) wvBuildPins(); else wvBuildRows();
  wvRenderTileTargets();
}

/// A change to the rows from the Matrix: sent, and every page told.
function wvMatrixChanged() {
  wvSendMods();
  wvTxt('wvMxCount', `${WV.mods.length} of 64`);
  wvRenderTileTargets();
  wvRenderBadges();
}

// ─────────────────────────────────────────────────────────────── the pins

function wvBuildPins() {
  const el = $('wvMxPins'), sl = el.scrollLeft, G = wvTargetGroups();
  // A hole is 24 px; a group too narrow for its band's name gets wider holes
  // rather than a cut-off name.
  const cw = G.map((g) => Math.max(24, Math.ceil((g.g.length * 6.2 + 12) / g.ks.length)));
  let h = `<div class="wv-pgrid" style="grid-template-columns:92px ${G.map((g, gi) => `repeat(${g.ks.length},${cw[gi]}px)`).join(' ')}"><div class="wv-pc0"></div>`;
  G.forEach((g, gi) => { h += `<div class="wv-pband g0" data-gi="${gi}" style="grid-column:span ${g.ks.length};--c:${g.c}" title="${wvEsc(g.g)}: click to bring this group to the front">${wvEsc(g.g)}</div>`; });
  h += '<div class="wv-pc0 lab"><span>source ↓</span><span>target →</span></div>';
  const cols = G.flatMap((g) => g.ks.map(([k, n], j) => [k, n, j === 0, g.c]));
  for (const [k, n, first, c] of cols) h += `<div class="wv-plab ${first ? 'g0' : ''}" data-col="${wvEsc(k)}" style="--c:${c}"><span>${wvEsc(n)}</span></div>`;
  for (const s of WV_SOURCES) {
    h += `<div class="wv-rh ${s.g0 ? 'r0' : ''}" data-src="${s.key}" style="--c:${wvSrcColour(s.key)}" title="${wvEsc(wvTileTip(s.key))}"><i class="act"></i><b>${s.label}</b><canvas id="wvMpr${s.key}" data-w="34" data-h="11"></canvas></div>`;
    for (const [k, , first] of cols) h += `<div class="wv-hole ${first ? 'g0' : ''} ${s.g0 ? 'r0' : ''}" data-s="${s.key}" data-t="${wvEsc(k)}" style="--c:${wvSrcColour(s.key)}"><b></b></div>`;
  }
  el.innerHTML = h + '</div>';
  el.scrollLeft = sl;
  el.querySelectorAll('canvas[data-w]').forEach((c) => { WVW[c.id] = wvCv(c); });
  wvWireSrc(el);
  el.querySelectorAll('.wv-pband').forEach((b) => b.addEventListener('click', () => wvPinScroll(+b.dataset.gi)));
  el.querySelectorAll('.wv-hole').forEach((c) => {
    const src = c.dataset.s, dst = c.dataset.t;
    wvPaintHole(c, wvModAt(src, dst));
    c.addEventListener('mouseenter', () => wvPinHl(c, src, dst, true));
    c.addEventListener('mouseleave', () => wvPinHl(c, src, dst, false));
    let moved = false;
    wvDrag(c, (dx, dy, e) => {
      if (!dy) return;
      moved = true;
      let m = wvModAt(src, dst);
      if (!m) {
        if (WV.mods.length >= 64) return;
        m = { src, dst, amt: 0, curve: 'lin', via: null };
        WV.mods.push(m);
      }
      m.amt = wvClamp(m.amt - dy / (e.shiftKey ? 400 : 80), -1, 1);
      wvPaintHole(c, m);
    }, () => { moved = false; }, () => {
      if (!moved && !wvModAt(src, dst) && WV.mods.length < 64) {
        WV.mods.push({ src, dst, amt: 0.25, curve: 'lin', via: null });
        wvPaintHole(c, wvModAt(src, dst));
      }
      wvMatrixChanged();
    });
    c.addEventListener('dblclick', () => {
      const m = wvModAt(src, dst);
      if (!m) return;
      WV.mods.splice(WV.mods.indexOf(m), 1);
      wvPaintHole(c, null);
      wvMatrixChanged();
    });
  });
}

function wvPaintHole(el, m) {
  el.classList.toggle('pin', !!m);
  el.classList.toggle('off', !!m?.off);
  const s = el.dataset.s, t = el.dataset.t;
  el.querySelector('b').textContent = m ? wvAmtTxt(m.amt) : '';
  el.dataset.tip = m
    ? `${wvSrcLab(s)} → ${wvTargetName(t)} ${wvAmtTxt(m.amt)}${m.via ? ' × ' + wvSrcLab(m.via) : ''}: drag up and down for the amount, Shift for fine. Double-click pulls the pin`
    : `${wvSrcLab(s)} → ${wvTargetName(t)}: click to put a pin in`;
}

function wvPinHl(c, src, dst, on) {
  document.querySelector(`.wv-rh[data-src="${src}"]`)?.classList.toggle('wv-hl', on);
  const lab = [...document.querySelectorAll('.wv-plab')].find((x) => x.dataset.col === dst);
  lab?.classList.toggle('wv-hl', on);
  lab?.style.setProperty('--hc', wvSrcColour(src));
  c.classList.toggle('wv-hl', on);
}

const wvGroupX = (gi) => { const b = document.querySelector(`.wv-pband[data-gi="${gi}"]`); return b ? b.offsetLeft - 92 : 0; };
function wvPinScroll(gi) { $('wvMxPins').scrollTo({ left: wvGroupX(gi), behavior: 'smooth' }); }

/// Page the columns a group at a time: on to the first group not wholly in
/// view, or back by as many as fill the width.
function wvPagePins(dir) {
  const el = $('wvMxPins'), x = el.scrollLeft, n = wvTargetGroups().length;
  let gi = 0;
  for (let g = 0; g < n; g++) if (wvGroupX(g) <= x + 2) gi = g;
  if (dir > 0) {
    const right = x + el.clientWidth - 92;
    let g = gi;
    while (g < n - 1 && wvGroupX(g + 1) < right - 24) g++;
    gi = Math.max(gi + 1, g);
  } else {
    let g = gi;
    while (g > 0 && x - wvGroupX(g - 1) < el.clientWidth - 92) g--;
    gi = Math.min(gi - 1, g);
  }
  wvPinScroll(wvClamp(gi, 0, n - 1));
}

// ─────────────────────────────────────────────────────────────── the rows

const wvSrcBtn = (src, kind, r) => (src == null
  ? `<span class="wv-pk wv-btn ${kind}" data-pk="${kind}" data-r="${r}"><span class="wv-hint">${kind === 'v' ? '× —' : 'Source ▾'}</span></span>`
  : `<span class="wv-pk wv-btn ${kind}" data-pk="${kind}" data-r="${r}" style="--c:${wvSrcColour(src)}">${kind === 's' ? `<canvas id="wvMxs${r}" data-w="34" data-h="13"></canvas>` : '<i>×</i>'}<b>${wvSrcLab(src)}</b></span>`);

function wvBuildRows() {
  const el = $('wvMxRows'), top = el.scrollTop, G = wvTargetGroups();
  el.innerHTML = '';
  const groupOf = (t) => (G.find((g) => g.ks.some((q) => q[0] === t)) || { g: '' }).g;
  WV.mods.forEach((m, r) => {
    m.curve = m.curve || 'lin';
    const row = wvH(`<div class="wv-mxr ${m.off ? 'off' : ''}" style="--c:${wvSrcColour(m.src)}"><span class="wv-ro">${r + 1}</span><span class="wv-pwr wv-btn ${m.off ? '' : 'on'}" title="On or off: switch this connection off without losing it">${WV_PWR}</span>${wvSrcBtn(m.src, 's', r)}
     <div class="wv-well"><canvas id="wvMxa${r}" data-w="300" data-h="22" title="Amount: drag across, Shift for fine. Double-click: 0"></canvas></div><span class="wv-pk wv-btn t" data-pk="t" data-r="${r}"><span>${wvEsc(wvTargetName(m.dst))}</span><i class="gname">${wvEsc(groupOf(m.dst))}</i></span>${wvSrcBtn(m.via, 'v', r)}
     <div class="wv-well" title="Curve: click for the next one"><canvas id="wvMxc${r}" data-w="84" data-h="22"></canvas></div><span class="wv-ib" data-rm title="Remove this row"><svg viewBox="0 0 12 12"><path d="M3 3 L9 9 M9 3 L3 9"/></svg></span></div>`);
    el.appendChild(row);
    for (const c of row.querySelectorAll('canvas')) WVW[c.id] = wvCv(c);
    wvDrag(WVW['wvMxa' + r].el, (dx, dy, e) => { m.amt = wvClamp(m.amt + dx / (e.shiftKey ? 600 : 120), -1, 1); WV.modsDirty = true; });
    WVW['wvMxa' + r].el.addEventListener('dblclick', () => { m.amt = 0; wvMatrixChanged(); });
    WVW['wvMxc' + r].el.addEventListener('click', () => {
      const ks = Object.keys(WV_CURVES);
      m.curve = ks[(ks.indexOf(m.curve) + 1) % ks.length];
      wvSendMods();
    });
    row.querySelector('.wv-pwr').addEventListener('click', () => { m.off = !m.off; wvMatrixChanged(); wvBuildRows(); });
    row.querySelector('[data-rm]').addEventListener('click', () => { WV.mods.splice(r, 1); wvMatrixChanged(); wvRenderMatrix(); });
    row.querySelectorAll('.wv-pk').forEach((b) => {
      b.addEventListener('mouseenter', () => wvHlMod(m.src, m.dst, true));
      b.addEventListener('mouseleave', () => wvHlMod(m.src, m.dst, false));
    });
  });
  // The next free slot: pick a source and a target, and it is a row.
  if (WV.mods.length < 64) {
    const r = WV.mods.length, d = WV_DRAFT;
    const row = wvH(`<div class="wv-mxr add"><span class="wv-ro">${r + 1}</span><span></span>${wvSrcBtn(d.src, 's', 'new')}<span class="wv-hint">${d.src != null || d.dst ? 'pick the other one' : 'pick a source and a target · or drag a source onto any control'}</span>
     <span class="wv-pk wv-btn t" data-pk="t" data-r="new">${d.dst ? `<span>${wvEsc(wvTargetName(d.dst))}</span>` : '<span class="wv-hint">Target ▾</span>'}</span>${wvSrcBtn(d.via, 'v', 'new')}<span></span><span></span></div>`);
    el.appendChild(row);
    for (const c of row.querySelectorAll('canvas')) WVW[c.id] = wvCv(c);
  }
  for (let r = WV.mods.length + 1; r < 64; r++) el.appendChild(wvH(`<div class="wv-mxr empty"><span class="wv-ro">${r + 1}</span></div>`));
  el.querySelectorAll('[data-pk]').forEach((b) => b.addEventListener('click', () => wvOpenPicker(b)));
  el.scrollTop = top;
}

/// The pickers: sources as their coloured pills; targets grouped as the pins'
/// bands are.
function wvOpenPicker(b) {
  const m = $('wvPmenu'), kind = b.dataset.pk, r = b.dataset.r, row = r === 'new' ? null : WV.mods[+r];
  if (!m.hidden && m.dataset.for === kind + r) { m.hidden = true; return; }
  m.dataset.for = kind + r;
  const done = (v) => {
    if (row) {
      if (kind === 's') row.src = v; else if (kind === 't') row.dst = v; else row.via = v;
    } else {
      WV_DRAFT[{ s: 'src', t: 'dst', v: 'via' }[kind]] = v;
      if (WV_DRAFT.src != null && WV_DRAFT.dst) {
        const ex = wvModAt(WV_DRAFT.src, WV_DRAFT.dst);
        if (ex) ex.amt = 0.3;
        else WV.mods.push({ src: WV_DRAFT.src, dst: WV_DRAFT.dst, amt: 0.3, curve: 'lin', via: WV_DRAFT.via });
        Object.assign(WV_DRAFT, { src: null, dst: null, via: null });
      }
    }
    m.hidden = true;
    wvMatrixChanged();
    wvRenderMatrix();
  };
  if (kind === 't') {
    const cur = row ? row.dst : WV_DRAFT.dst;
    m.className = 'wv-pmenu tg';
    m.innerHTML = wvTargetGroups().map((G) => `<div class="wv-pmg" style="--c:${G.c}"><b>${wvEsc(G.g)}</b>${G.ks.map(([k, n, f]) => `<span data-v="${wvEsc(k)}" class="${cur === k ? 'on' : ''}">${wvEsc(/^(LFO|AMP|ENV)/.test(G.g) ? n : f)}</span>`).join('')}</div>`).join('');
  } else {
    m.className = 'wv-pmenu sr';
    m.innerHTML = (kind === 'v' ? '<span class="wv-pill none" data-v="">× none</span>' : '')
      + WV_SOURCES.map((s) => `<span class="wv-pill" data-v="${s.key}" style="--c:${wvSrcColour(s.key)}">${wvSrcGlyph(s.key)}${s.label}</span>`).join('');
  }
  m.querySelectorAll('[data-v]').forEach((x) => x.addEventListener('click', () => done(x.dataset.v === '' ? null : x.dataset.v)));
  wvPlaceMenu(m, b, 0);
}

// ─────────────────────────────────────────────────────────────── drawing

function wvDrawMatrix(t) {
  wvDrawTiles(t, 'm');
  const cl = wvCl();
  const sig = (m) => wvSrcVal(m.src) * (m.via ? wvSrcVal(m.via) : 1);
  if (WV.mx !== 'rows') {
    for (const s of WV_SOURCES) {
      const g = WVW['wvMpr' + s.key];
      if (!g) continue;
      wvTilePic(g, s.key, t);
      const used = WV.mods.some((m) => m.src === s.key && !m.off);
      g.el.parentElement.querySelector('.act').style.setProperty('--o', used ? (0.3 + 0.7 * Math.abs(wvSrcVal(s.key))).toFixed(2) : 0);
    }
    for (const m of WV.mods) {
      const c = [...document.querySelectorAll(`#wvMxPins .wv-hole[data-s="${m.src}"]`)].find((x) => x.dataset.t === m.dst);
      if (c) c.style.setProperty('--o', m.off ? 0 : (0.25 + 0.75 * wvClamp(Math.abs(sig(m)))).toFixed(2));
    }
    return;
  }
  WV.mods.forEach((m, r) => {
    if (!WVW['wvMxa' + r]) return;
    if (WVW['wvMxs' + r]) wvTilePic(WVW['wvMxs' + r], m.src, t);
    const lfo = /^lfo/.test(m.src), raw = wvSrcVal(m.src), sv = wvClamp(lfo ? (raw + 1) / 2 : raw);
    const g = WVW['wvMxc' + r], { c, w, h } = g;
    c.clearRect(0, 0, w, h);
    wvTrace(c, wvPath((u) => [4 + u * (w - 8), h - 4 - wvCurveAt(m.curve, u) * (h - 8)], 40), cl, 1.2, 0.4);
    if (WV.tele) wvDot(c, 4 + sv * (w - 8), h - 4 - wvCurveAt(m.curve, sv) * (h - 8), 2.4, cl.acc);
    const a = WVW['wvMxa' + r], ac = a.c, mid = a.w / 2, col = wvSrcColour(m.src);
    ac.clearRect(0, 0, a.w, a.h);
    ac.fillStyle = 'rgba(255,255,255,.06)';
    ac.fillRect(8, a.h / 2 - 0.5, a.w - 16, 1);
    ac.fillStyle = 'rgba(255,255,255,.22)';
    ac.fillRect(mid - 0.5, 4, 1, a.h - 8);
    ac.globalAlpha = m.off ? 0.35 : 1;
    ac.fillStyle = col;
    ac.shadowBlur = 6;
    ac.shadowColor = col;
    const x2 = mid + m.amt * (a.w / 2 - 40);
    ac.fillRect(Math.min(mid, x2), a.h / 2 - 3, Math.abs(x2 - mid), 6);
    ac.shadowBlur = 0;
    if (!m.off && WV.tele) wvDot(ac, mid + wvClamp(m.amt * sig(m), -1, 1) * (a.w / 2 - 40), a.h / 2, 2.6, '#fff');
    ac.fillStyle = col;
    ac.font = `10px ${cl.mono}`;
    ac.textAlign = m.amt < 0 ? 'left' : 'right';
    ac.fillText(wvAmtTxt(m.amt), m.amt < 0 ? 6 : a.w - 6, a.h / 2 + 3.5);
    ac.textAlign = 'left';
    ac.globalAlpha = 1;
  });
  if (WVW.wvMxsnew && WV_DRAFT.src != null) wvTilePic(WVW.wvMxsnew, WV_DRAFT.src, t);
}
