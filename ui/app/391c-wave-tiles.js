// ================================================ Wave: the modulation tiles
//
// v8 (mock-up F). Every envelope and LFO is a tile: mostly its picture, with
// one line of readings under it that drag. Play shows four large ones (Amp, a
// slot for ENV 2–4, LFO 1, a slot for LFO 2–4, picked by the 2 · 3 · 4 buttons
// in the slot's header); the Matrix shows all eight, smaller. The two are the
// same controls on the same keys. A tile's header pill, and every tile in the
// strips (the playing hand and the macros), drags onto any control to make the
// source move it: anything with a `data-tgt`, on any view, a board control
// included. A click lights what the source moves.

/// The Play slots: which tiles each can show. ENV 2 and LFO 2 by default.
const WV_SLOTS = { env: ['env1', 'env2', 'env3'], lfo: ['lfo1', 'lfo2', 'lfo3'] };
const WV_ADSR = [['a', 'Attack'], ['d', 'Decay'], ['s', 'Sustain'], ['r', 'Release']];
const WV_LMODES = [['free', 'Free', 'Free: runs all the time, the same for every note'], ['trig', 'Trig', 'Trig: starts again from the beginning on each note'], ['env', 'Env', 'Env: plays once per note, then holds its last value']];
const WV_LREAD = [['lr', 'Rate', 'rate', 'Rate: drag up and down, Shift for fine. Hz or Sync beside the picture sets how it counts'], ['ls', 'Smooth', 'smooth', 'Smooth: rounds off the corners of the shape'], ['li', 'Rise', 'rise', 'Rise: how long it takes to fade in after each note']];
/// The sources in the strip under Play's tiles: the playing hand, the macros.
const WV_STRIP = WV_SOURCES.filter((s) => s.kind === 'perf' || s.kind === 'macro');
/// Tile sizes: Play's large, the Matrix's small (its tiles share 711 px four ways).
const WV_TILE_PX = { big: { env: 213, lfo: 179, h: 175 }, small: { env: 154, lfo: 120, h: 117 } };

const wvTileTip = (src) => {
  if (src === 'amp') return 'Amp envelope: drag its points or its A, D, S and R. It shapes the level of every note, so it is not a mod source';
  const s = wvSrcOf(src);
  const d = s.kind === 'macro' ? `${s.label} · ${WV.macroNames[+src.slice(5)]}` : s.kind === 'perf' ? wvSrcName(src) : s.label;
  return `${d}: drag it onto any control to make it move that control`;
};

/// A tile's header pill. On Play, ENV 2 is named as the filter envelope (its
/// usual row goes to F1 Cutoff) and Amp as the main one.
function wvTileGrab(src, P) {
  const amp = src === 'amp', em = P === 'p' && src === 'env1' ? '<em> · filter</em>' : P === 'p' && amp ? '<em> · main</em>' : '';
  return `<span class="wv-grab ${amp ? 'fixed' : ''}" ${amp ? '' : `data-src="${src}"`} style="--c:${wvSrcColour(src)}" title="${wvTileTip(src)}">${amp ? '' : '<i class="gr"></i>'}${wvSrcLab(src)}${em}</span>`;
}

const wvSlotBtns = (slot, src) => `<span class="wv-slot">${WV_SLOTS[slot].map((j) => `<span class="wv-sb wv-btn ${j === src ? 'on' : ''}" data-slotpick="${slot}" data-s="${j}" style="--c:${wvSrcColour(j)}" title="Show ${wvSrcLab(j)} in this tile">${wvSrcLab(j).slice(-1)}</span>`).join('')}</span>`;

/// A reading that drags, and takes a dropped source: its top line is the
/// modulation range, in the source's colour, with a dot where it is now.
const wvRdEl = (tgt, n, tip, extra = '') => `<div class="wv-rd wv-btn" data-tgt="${tgt}" ${extra} title="${tip}"><span>${n}</span><b></b><i class="bar"></i><i class="mb"></i><i class="md"></i></div>`;

function wvEnvTile(P, src, big, slot) {
  const px = WV_TILE_PX[big ? 'big' : 'small'], tg = `<span class="wv-tgts ${big ? 'ov' : ''}" id="wv${P}tg${src}"></span>`;
  return `<div class="wv-tile ${big ? 'big' : ''}" data-tile="${src}" data-p="${P}" ${slot ? `data-slot="${slot}"` : ''} style="--c:${wvSrcColour(src)}">
   <div class="wv-th">${wvTileGrab(src, P)}${big ? '<span class="wv-sp"></span>' : tg}${slot ? wvSlotBtns(slot, src) : ''}<i class="act"></i></div>
   <div class="wv-well"><canvas id="wv${P}ev${src}" data-w="${px.env}" data-h="${px.h}" title="${src === 'amp' ? 'Amp envelope' : wvSrcLab(src)}: drag a point. Attack and decay across, sustain up and down, release across"></canvas>${big ? tg : ''}</div>
   <div class="wv-rds four">${WV_ADSR.map(([k, n]) => wvRdEl(`${src}.${k}`, n, `${n}: drag up and down, Shift for fine. Drop a source here to modulate it`, `data-env="${src}" data-k="${k}"`)).join('')}</div></div>`;
}

function wvLfoTile(P, src, big, slot) {
  const px = WV_TILE_PX[big ? 'big' : 'small'], tg = `<span class="wv-tgts ${big ? 'ov' : ''}" id="wv${P}tg${src}"></span>`;
  return `<div class="wv-tile ${big ? 'big' : ''}" data-tile="${src}" data-p="${P}" ${slot ? `data-slot="${slot}"` : ''} style="--c:${wvSrcColour(src)}">
   <div class="wv-th">${wvTileGrab(src, P)}${big ? '<span class="wv-sp"></span>' : tg}${slot ? wvSlotBtns(slot, src) : ''}<i class="act"></i></div>
   <div class="wv-lb"><div class="wv-well"><canvas id="wv${P}lv${src}" data-w="${px.lfo}" data-h="${px.h}" title="${wvSrcLab(src)}: its shape, and where it is now. Drag a point to draw your own; double-click to add one"></canvas>${big ? tg : ''}</div>
    <div class="wv-lcol"><div class="wv-lshp wv-btn" data-lshape="${src}" title="Shape: click to pick another"><svg viewBox="0 0 16 14"><path d=""/></svg></div>
     <div class="wv-seg wv-vseg" data-lmode="${src}">${WV_LMODES.map(([k, l, t]) => `<span data-k="${k}" title="${t}">${l}</span>`).join('')}</div>
     <div class="wv-seg wv-vseg" data-lsync="${src}"><span data-k="0" title="Hz: the rate runs free of the tempo">Hz</span><span data-k="1" title="Sync: the rate locks to the tempo, in bars and notes">Sync</span></div></div></div>
   <div class="wv-rds three">${WV_LREAD.map(([k, n, key, t]) => wvRdEl(`${src}.${key}`, n, t + '. Drop a source here to modulate it', `id="wv${P}${k}${src}" data-lfo="${src}" data-lk="${key}"`)).join('')}</div></div>`;
}

/// Play's four large tiles and its strip.
function wvBuildPlayTiles() {
  $('wvPEnvTiles').innerHTML = wvEnvTile('p', 'amp', 1) + WV_SLOTS.env.map((s) => wvEnvTile('p', s, 1, 'env')).join('');
  $('wvPLfoTiles').innerHTML = wvLfoTile('p', 'lfo0', 1) + WV_SLOTS.lfo.map((s) => wvLfoTile('p', s, 1, 'lfo')).join('');
  $('wvSrcStrip').innerHTML = WV_STRIP.map((s) => `<div class="wv-sc wv-btn ${s.g0 && s.kind === 'macro' ? 'g0' : ''}" data-src="${s.key}" style="--c:${wvSrcColour(s.key)}" title="${wvTileTip(s.key)}"><i class="act"></i><b>${s.label}</b><canvas id="wvSc${s.key}" data-w="54" data-h="13"></canvas></div>`).join('');
}

/// The Matrix view's eight small tiles.
function wvBuildMatrixTiles(env, lfo) {
  env.innerHTML = ['amp', 'env1', 'env2', 'env3'].map((s) => wvEnvTile('m', s, 0)).join('');
  lfo.innerHTML = ['lfo0', 'lfo1', 'lfo2', 'lfo3'].map((s) => wvLfoTile('m', s, 0)).join('');
}

/// Show one envelope or LFO in its Play slot.
function wvSetSlot(kind, src) {
  WV.slot[kind] = src;
  wvSyncTiles();
  wvRenderTileTargets();
}

// ─────────────────────────────────────────────────────────────── wiring

function wvWireTiles(root) {
  root.querySelectorAll('.wv-tile').forEach((tile) => {
    const src = tile.dataset.tile, P = tile.dataset.p;
    const ev = tile.querySelector(`#wv${P}ev${src}`), lv = tile.querySelector(`#wv${P}lv${src}`);
    if (ev) {
      // The nearest corner is the one dragged.
      const g = WVW[ev.id];
      let eh = null;
      wvDrag(g.el, (dx, dy) => wvEnvDrag(src, eh, dx, dy, 70, 50), (e) => { eh = wvEnvHandle(g, src, wvLocal(g.el, e)[0]); });
    }
    if (lv) wvWireLfoPicture(WVW[lv.id], +src.slice(3));
  });
  root.querySelectorAll('.wv-rd[data-env]').forEach((b) => {
    const key = b.dataset.tgt, lo = { a: 0.005, d: 0.01, s: 0, r: 0.01 }[b.dataset.k];
    wvDrag(b, (dx, dy, e) => wvLive(key, Math.max(lo, wvClamp(wvG(key) - dy / (e.shiftKey ? 600 : 120)))));
  });
  root.querySelectorAll('.wv-rd[data-lfo]').forEach((b) => {
    const key = b.dataset.tgt;
    wvDrag(b, (dx, dy, e) => wvLive(key, wvClamp((wvG(key) ?? 0) - dy / (e.shiftKey ? 750 : 150))));
  });
  root.querySelectorAll('[data-lshape]').forEach((b) => b.addEventListener('click', () => wvLfoMenu(b, +b.dataset.lshape.slice(3))));
  root.querySelectorAll('[data-lmode] span').forEach((b) => b.addEventListener('click', () => wvCommit(`${b.parentElement.dataset.lmode}.mode`, b.dataset.k)));
  root.querySelectorAll('[data-lsync] span').forEach((b) => b.addEventListener('click', () => wvCommit(`${b.parentElement.dataset.lsync}.sync`, +b.dataset.k)));
  root.querySelectorAll('[data-slotpick]').forEach((b) => b.addEventListener('click', () => wvSetSlot(b.dataset.slotpick, b.dataset.s)));
  wvWireSrc(root);
}

/// An LFO's picture: drag a point. A standard shape has no points to drag, so
/// the first drag or double-click on one makes it Drawn, sampled from what is
/// on screen, points first, and goes on from there.
function wvWireLfoPicture(g, L) {
  const key = `lfo${L}.points`;
  let pi = -1, at0 = null;
  const px = (q) => 8 + q[0] * (g.w - 16), py = (q) => 8 + (1 - q[1]) * (g.h - 16);
  const nearest = (pts, x, y) => pts.reduce((b, q, i) => (Math.hypot(px(q) - x, py(q) - y) < Math.hypot(px(pts[b]) - x, py(pts[b]) - y) ? i : b), 0);
  wvDrag(g.el, (dx, dy, e) => {
    const [x, y] = wvLocal(g.el, e);
    if (pi === -2) {
      wvToDrawn(L);
      pi = nearest(wvG(key), at0[0], at0[1]);
    }
    if (pi < 0) return;
    const pts = wvG(key).map((q) => q.slice()), p = pts[pi];
    if (pi > 0 && pi < pts.length - 1) p[0] = wvClamp((x - 8) / (g.w - 16), pts[pi - 1][0] + 0.01, pts[pi + 1][0] - 0.01);
    p[1] = wvClamp(1 - (y - 8) / (g.h - 16));
    wvLive(key, pts);
  }, (e) => {
    const [x, y] = wvLocal(g.el, e);
    at0 = [x, y];
    // Not yet: a plain click on a standard shape leaves it as it is.
    if (wvLfoShape(L) !== 'drawn' && e.detail !== 2) { pi = -2; return; }
    wvToDrawn(L);
    const pts = wvG(key);
    pi = nearest(pts, x, y);
    if (Math.hypot(px(pts[pi]) - x, py(pts[pi]) - y) > 14) {
      if (e.detail !== 2) { pi = -1; return; }
      const nx = wvClamp((x - 8) / (g.w - 16));
      const at = Math.max(1, pts.findIndex((q) => q[0] > nx));
      const next = pts.map((q) => q.slice());
      next.splice(at, 0, [nx, wvClamp(1 - (y - 8) / (g.h - 16))]);
      wvLive(key, next);
      pi = at;
    }
  }, () => { pi = -1; });
}

/// Make an LFO Drawn, keeping the shape it had: the points first, so the
/// engine never plays the old points as Drawn, then the shape.
function wvToDrawn(L) {
  if (wvLfoShape(L) === 'drawn') return;
  wvCommit(`lfo${L}.points`, wvShapePoints(L));
  wvCommit(`lfo${L}.shape`, 'drawn');
}

/// Every source pill and tile drags onto a control, on any view. A drop on
/// anything with a `data-tgt` makes (or resets) the row; a click picks it.
function wvWireSrc(root) {
  root.querySelectorAll('[data-src]').forEach((t) => {
    if (t.dataset.wired) return;
    t.dataset.wired = '1';
    t.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      const src = t.dataset.src, sx = e.clientX, sy = e.clientY, host = $('waveView');
      let moved = false, over = null;
      const mv = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
          moved = true;
          host.classList.add('wv-mapping');
          host.style.setProperty('--wv-mc', wvSrcColour(src));
        }
        if (!moved) return;
        const o = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('#waveView [data-tgt]') || null;
        if (o !== over) { over?.classList.remove('wv-over'); over = o; o?.classList.add('wv-over'); }
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        host.classList.remove('wv-mapping');
        over?.classList.remove('wv-over');
        if (!moved) { wvSelectSrc(src); return; }
        const tg = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('#waveView [data-tgt]');
        if (tg) wvMapSource(src, tg.dataset.tgt);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  });
}

/// A source onto a control: a new row at +30, or an existing one back to it.
function wvMapSource(src, dst) {
  const ex = WV.mods.find((m) => m.src === src && m.dst === dst);
  if (ex) { ex.amt = 0.3; ex.off = false; }
  else if (WV.mods.length < 64) WV.mods.push({ src, dst, amt: 0.3, curve: 'lin', via: null });
  else return;
  wvSendMods();
  wvRenderTargets();
  if (dst.startsWith('board:')) wvBoardNote(`${wvSrcLab(src)} now moves ${wvDstName(dst)}`);
}

// ─────────────────────────────────────────────────────────────── text

/// What each tile moves, in its header (small tiles) or over its picture.
function wvRenderTileTargets() {
  document.querySelectorAll('#waveView .wv-tile').forEach((tile) => {
    const src = tile.dataset.tile, tg = tile.querySelector('.wv-tgts');
    if (!tg) return;
    if (src === 'amp') { tg.innerHTML = '<span class="wv-tg" title="The amp envelope shapes the level of every note">→ <i>Level</i></span>'; return; }
    const mine = WV.mods.filter((m) => m.src === src && !m.off);
    const one = (m) => `<span class="wv-tg" data-bt="${wvEsc(m.dst)}">→ <i>${wvEsc(wvDstName(m.dst))}</i></span>`;
    tg.innerHTML = mine.length ? mine.map(one).join('') : '<span class="wv-hint">drag to map</span>';
    if (tg.offsetParent && mine.length > 1 && tg.scrollWidth > tg.clientWidth + 1) tg.innerHTML = one(mine[0]) + `<span class="wv-tg" title="${wvEsc(mine.slice(1).map((m) => wvDstName(m.dst)).join(', '))}">+${mine.length - 1}</span>`;
    if (tg.offsetParent && tg.scrollWidth > tg.clientWidth + 1) tg.innerHTML = `<span class="wv-tg" title="${wvEsc(mine.map((m) => wvDstName(m.dst)).join(', '))}">→ <i>${mine.length} control${mine.length > 1 ? 's' : ''}</i></span>`;
    tg.querySelectorAll('[data-bt]').forEach((b) => {
      b.addEventListener('mouseenter', () => wvHlMod(src, b.dataset.bt, true));
      b.addEventListener('mouseleave', () => wvHlMod(src, b.dataset.bt, false));
    });
  });
}

/// The lit choices on every tile, and which tiles the Play slots show.
function wvSyncTiles() {
  for (const slot of Object.keys(WV_SLOTS)) {
    document.querySelectorAll(`#wvViewPlay .wv-tile[data-slot="${slot}"]`).forEach((t) => { t.style.display = t.dataset.tile === WV.slot[slot] ? '' : 'none'; });
    document.querySelectorAll(`[data-slotpick="${slot}"]`).forEach((b) => b.classList.toggle('on', b.dataset.s === WV.slot[slot]));
  }
  for (let L = 0; L < 4; L++) {
    const sh = WV_LFO_SHAPES.find((q) => q[0] === wvLfoShape(L)) || WV_LFO_SHAPES[7];
    document.querySelectorAll(`[data-lshape="lfo${L}"]`).forEach((b) => {
      b.querySelector('path').setAttribute('d', sh[2]);
      b.dataset.tip = `Shape: ${sh[1].split(':')[0]}. Click to pick another`;
      b.dataset.shape = sh[0];
    });
    document.querySelectorAll(`[data-lsync="lfo${L}"] span`).forEach((b) => b.classList.toggle('on', +b.dataset.k === (wvG(`lfo${L}.sync`) ? 1 : 0)));
    document.querySelectorAll(`[data-lmode="lfo${L}"] span`).forEach((b) => b.classList.toggle('on', b.dataset.k === (wvG(`lfo${L}.mode`) || 'free')));
  }
}

/// Every shape, drawn in the LFO's colour; the one it has is lit.
function wvLfoMenu(anchor, L) {
  const m = wvMenuFor(`lfo${L}`);
  if (!m) return;
  const col = wvSrcColour(`lfo${L}`);
  for (const [k, n] of WV_LFO_SHAPES) {
    const { t, g } = wvMenuTile(m, n.split(':')[0], wvLfoShape(L) === k, col);
    t.dataset.shape = k;
    const c = g.c;
    c.strokeStyle = 'rgba(255,255,255,.07)';
    c.beginPath(); c.moveTo(4, 19); c.lineTo(84, 19); c.stroke();
    c.lineJoin = 'round';
    c.strokeStyle = col;
    c.lineWidth = 1.4;
    c.shadowBlur = 6;
    c.shadowColor = col;
    c.stroke(wvPath((u) => [4 + u * 80, 33 - wvShapeAt(k, wvG(`lfo${L}.points`), u, 0) * 28], 120));
    c.shadowBlur = 0;
    t.addEventListener('click', () => {
      if (k === 'drawn') wvToDrawn(L); else wvCommit(`lfo${L}.shape`, k);
      wvCloseMenus();
    });
  }
  wvPlaceMenu(m, anchor, -150);
}

// ─────────────────────────────────────────────────────────────── drawing

/// A source's colour as a palette the kit's trace and under can use.
function wvSrcCl(src) {
  const hx = wvSrcColour(src), n = parseInt(hx.slice(1), 16);
  return { ...wvCl(), wave: hx, bloom: `${n >> 16},${(n >> 8) & 255},${n & 255}` };
}

/// What each source has done for the last four seconds, sampled fifty times a
/// second, for the tiles that draw a trace (the wheel, aftertouch, velocity).
const WV_HIST = { buf: {}, at: 0, last: null };
function wvHistTick(t) {
  if (WV_HIST.last == null || t - WV_HIST.last > 1) WV_HIST.last = t - 0.02;
  while (t - WV_HIST.last >= 0.02) {
    WV_HIST.last += 0.02;
    for (const s of WV_SOURCES) {
      const b = WV_HIST.buf[s.key] || (WV_HIST.buf[s.key] = new Float32Array(200));
      b[WV_HIST.at] = wvSrcVal(s.key);
    }
    WV_HIST.at = (WV_HIST.at + 1) % 200;
  }
}

/// A tile's live picture: what the source is doing now.
function wvTilePic(g, src, t) {
  const { c, w, h } = g, s = wvSrcOf(src), col = wvSrcColour(src), C = wvSrcCl(src);
  c.clearRect(0, 0, w, h);
  const line = (p, lw = 1.3) => { c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = col; c.lineWidth = lw; c.shadowBlur = 6; c.shadowColor = col; c.stroke(p); c.shadowBlur = 0; };
  const fill = (p, x0, x1) => { const f = new Path2D(p); f.lineTo(x1, h - 1); f.lineTo(x0, h - 1); f.closePath(); c.fillStyle = `rgba(${C.bloom},.14)`; c.fill(f); };
  if (s.kind === 'lfo') {
    const L = +src.slice(3), p = wvPath((u) => [1 + u * (w - 2), h - 2 - wvLfoVal(L, u) * (h - 4)], 48);
    fill(p, 1, w - 1);
    line(p);
    const ph = wvLfoPhase(L);
    if (ph != null) wvDot(c, 1 + ph * (w - 2), h - 2 - wvLfoVal(L, ph) * (h - 4), 1.9, '#fff');
  } else if (s.kind === 'env') {
    const E = wvEnv(src), P = wvEnvPts({ w: w + 12, h: h + 12 }, E), p = new Path2D();
    const sh = (q) => [q[0] - 6, q[1] - 6];
    p.moveTo(...sh(P.o));
    for (const k of ['a', 'd', 's', 'r']) p.lineTo(...sh(P[k]));
    fill(p, 2, P.r[0] - 6);
    line(p);
  } else if (s.kind === 'macro') {
    const v = wvG(src), cx = w / 2, cy = h / 2 + 1, r = h / 2 - 2, a0 = Math.PI * 0.75;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,.1)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, r, a0, a0 + Math.PI * 1.5); c.stroke();
    c.strokeStyle = col;
    c.shadowBlur = 6;
    c.shadowColor = col;
    c.beginPath(); c.arc(cx, cy, r, a0, a0 + Math.PI * 1.5 * v + 1e-4); c.stroke();
    c.shadowBlur = 0;
  } else if (src === 'note') {
    for (let k = 0; k <= 24; k++) {
      const x = 1 + k / 24 * (w - 2), blk = [1, 3, 6, 8, 10].includes(k % 12);
      c.fillStyle = blk ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.18)';
      c.fillRect(x, h - (blk ? 4 : 6), 1, blk ? 4 : 6);
    }
    c.strokeStyle = `rgba(${C.bloom},.35)`;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(1, h - 7); c.lineTo(w - 1, 1); c.stroke();
    const v = wvSrcVal(src);
    wvDot(c, 1 + v * (w - 2), h - 7 - v * (h - 8), 2, col);
  } else {
    // The playing hand: its last four seconds, newest at the right.
    const b = WV_HIST.buf[src] || new Float32Array(200), y = (v) => h - 2 - wvClamp(v) * (h - 4);
    const p = wvPath((u) => [1 + u * (w - 2), y(b[(WV_HIST.at + Math.round(u * 199)) % 200])], 60);
    fill(p, 1, w - 1);
    line(p);
    wvDot(c, w - 2, y(wvSrcVal(src)), 1.9, '#fff');
  }
}

/// A reading's modulation: its top line spans what the rows can reach, in the
/// first source's colour, with a dot where the engine has it now.
function wvRdMod(el, tgt, v) {
  const m = wvModOf(tgt);
  el.classList.toggle('mod', !!m.rng);
  if (!m.rng) return;
  el.style.setProperty('--mc', m.col || 'var(--wv-mod)');
  const a = wvClamp(v - m.rng), b = wvClamp(v + m.rng), at = m.live != null ? wvClamp(m.live) : v;
  el.style.setProperty('--ma', (a * 100).toFixed(1) + '%');
  el.style.setProperty('--mw', ((b - a) * 100).toFixed(1) + '%');
  el.style.setProperty('--ml', (at * 100).toFixed(1) + '%');
}

const wvShown = (el) => el && el.offsetParent !== null;
const wvFmtC = (s) => (s < 1 ? Math.round(s * 1000) + 'ms' : s.toFixed(2) + 's');

/// Every tile on page `P` ('p' Play, 'm' Matrix) that is on screen.
function wvDrawTiles(t, P) {
  wvHistTick(t);
  const vs = wvVoices();
  document.querySelectorAll(`#waveView .wv-tile[data-p="${P}"]`).forEach((tile) => {
    if (!wvShown(tile)) return;
    const src = tile.dataset.tile;
    const used = src === 'amp' || WV.mods.some((m) => m.src === src && !m.off), sv = wvSrcVal(src);
    tile.querySelector('.act').style.setProperty('--o', used ? (0.3 + 0.7 * Math.abs(src === 'amp' ? wvSrcVal('env1') : sv)).toFixed(2) : 0);
    if (src === 'amp' || src.startsWith('env')) {
      const g = WVW[`wv${P}ev${src}`], E = wvEnv(src);
      wvDrawEnv(g, E, src === 'amp' ? vs : [], src === 'amp' ? wvCl() : wvSrcCl(src));
      const T = { a: wvFmtC(E.a ** 2 * 4), d: wvFmtC(E.d ** 2 * 4), s: Math.round(E.s * 100) + '%', r: wvFmtC(E.r ** 2 * 6) };
      tile.querySelectorAll('.wv-rd[data-env]').forEach((r) => {
        const k = r.dataset.k;
        wvTxtEl(r.querySelector('b'), T[k]);
        r.querySelector('.bar').style.width = (E[k] * 100).toFixed(1) + '%';
        wvRdMod(r, r.dataset.tgt, E[k]);
      });
      return;
    }
    const L = +src.slice(3), g = WVW[`wv${P}lv${src}`], C = wvSrcCl(src);
    wvDrawLfo(g, L, C);
    const rise = wvG(`lfo${L}.rise`) || 0;
    if (rise > 0.005) {
      const { c, w, h } = g, x1 = 8 + rise * (w - 16) * 0.5, gr = c.createLinearGradient(8, 0, x1, 0);
      gr.addColorStop(0, 'rgba(0,0,0,.55)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr;
      c.fillRect(8, 6, x1 - 8, h - 12);
      c.strokeStyle = `rgba(${C.bloom},.6)`;
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(8, h - 8); c.lineTo(x1, 8); c.stroke();
      c.setLineDash([]);
    }
    const tx = { rate: wvLfoRateTxt(L).replace(/ Hz$/, 'Hz'), smooth: Math.round((wvG(`lfo${L}.smooth`) || 0) * 100) + '%', rise: wvFmtC(rise ** 2 * 4) };
    tile.querySelectorAll('.wv-rd[data-lfo]').forEach((r) => {
      const key = r.dataset.lk, v = wvG(`lfo${L}.${key}`) ?? 0;
      wvTxtEl(r.querySelector('b'), tx[key]);
      r.querySelector('.bar').style.width = (v * 100).toFixed(1) + '%';
      wvRdMod(r, r.dataset.tgt, v);
    });
  });
  if (P !== 'p') return;
  for (const s of WV_STRIP) {
    const g = WVW['wvSc' + s.key];
    if (!g) continue;
    wvTilePic(g, s.key, t);
    const used = WV.mods.some((m) => m.src === s.key && !m.off);
    g.el.parentElement.querySelector('.act').style.setProperty('--o', used ? (0.3 + 0.7 * Math.abs(wvSrcVal(s.key))).toFixed(2) : 0);
  }
}

function wvTxtEl(el, s) {
  if (el && el.textContent !== s) el.textContent = s;
}
