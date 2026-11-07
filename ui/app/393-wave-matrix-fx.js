// ================================================== Wave: Matrix, FX and menus
//
// The matrix lists every route from a source to a control, each with the
// curve it goes through and how far it moves; beside it, the same routes drawn
// as ropes that brighten with the signal. FX is the page's chain, each effect
// drawing what it does. Then the menus: every warp drawn on this oscillator's
// wave, every effect on it, the tables, and the preset shelf.

function wvBuildMatrix(view) {
  view.appendChild(wvH(`<div class="wv-panel wv-mod wv-mxt"><div class="wv-mh"><span class="wv-nm">MATRIX</span><span class="wv-sp"></span><span class="wv-ro" id="wvMxCount"></span></div>
   <div class="wv-mxh"><span></span><span>Source</span><span>Via</span><span>Curve</span><span>Amount</span><span>Destination</span><span></span></div>
   <div id="wvMxRows"></div></div>`));
  view.appendChild(wvH(`<div class="wv-panel wv-mod" style="width:468px;flex:none;align-self:flex-start"><div class="wv-mh"><span class="wv-nm">WHAT MOVES WHAT</span><span class="wv-sp"></span><span class="wv-hint">Live</span></div>
   <div class="wv-well"><canvas id="wvMxMap" data-w="446" data-h="607"></canvas></div></div>`));
}

/// The rows, rebuilt whenever the routes change.
function wvRenderMatrix() {
  const el = $('wvMxRows');
  if (!el) return;
  el.innerHTML = '';
  for (const id of Object.keys(WVW)) if (/^wvMx[sca]\d/.test(id)) delete WVW[id];
  WV.mods.forEach((m, r) => {
    const row = wvH(`<div class="wv-mxr"><span class="wv-ro">${r + 1}</span>
     <span class="src"><canvas id="wvMxs${r}" data-w="36" data-h="14"></canvas>${wvSrcName(m.src)}</span>
     <span class="wv-chip wv-btn" data-via title="Scaled by: click for the next source">${wvIc('M1 5 H5 M9 5 H13 M7 1 V9')}${wvSrcName(m.via)}</span>
     <div class="wv-well" style="width:100px"><canvas id="wvMxc${r}" data-w="100" data-h="26" title="The curve: click for the next"></canvas></div>
     <div class="wv-well" style="width:236px"><canvas id="wvMxa${r}" data-w="236" data-h="26" title="Drag across for the amount"></canvas></div>
     <span class="dst">${wvDstName(m.dst)}</span><span class="wv-ib" data-rm title="Remove"><svg viewBox="0 0 12 12"><path d="M3 3 L9 9 M9 3 L3 9"/></svg></span></div>`);
    el.appendChild(row);
    for (const c of row.querySelectorAll('canvas')) WVW[c.id] = wvCv(c);
    wvDrag(WVW['wvMxa' + r].el, (dx) => { m.amt = wvClamp(m.amt + dx / 110, -1, 1); WV.modsDirty = true; });
    WVW['wvMxc' + r].el.addEventListener('click', () => {
      const ks = Object.keys(WV_CURVES);
      m.curve = ks[(ks.indexOf(m.curve) + 1) % ks.length];
      wvSendMods();
    });
    row.querySelector('[data-via]').addEventListener('click', () => {
      m.via = WV_VIA[(WV_VIA.indexOf(m.via ?? null) + 1) % WV_VIA.length];
      wvSendMods();
      wvRenderMatrix();
    });
    row.querySelector('[data-rm]').addEventListener('click', () => {
      WV.mods.splice(r, 1);
      wvSendMods();
      wvRenderMatrix();
      wvRenderTargets();
    });
  });
  for (let r = WV.mods.length; r < 16; r++) {
    el.appendChild(wvH(`<div class="wv-mxr empty"><span class="wv-ro">${r + 1}</span><span class="wv-hint">Drag a source onto a control</span><span></span><span></span><span></span><span></span><span></span></div>`));
  }
  wvTxt('wvMxCount', `${WV.mods.length} of 64`);
}

function wvMiniTo(c, src, w, h) {
  const s = WV_SOURCES.find((x) => x.key === src);
  const cl = wvCl();
  let p;
  if (s && s.kind === 'lfo') p = wvPath((u) => [u * w, h - wvLfoAt(wvG(`${src}.points`), u) * h], 40);
  else if (s) {
    const E = wvEnv(src);
    p = new Path2D();
    p.moveTo(0, h); p.lineTo(E.a * 14, 0); p.lineTo(E.a * 14 + E.d * 18, h - E.s * h); p.lineTo(w - 10, h - E.s * h); p.lineTo(w, h);
  } else p = wvPath((u) => [u * w, h - u * h], 2);
  c.strokeStyle = `rgba(${cl.bloom},.7)`;
  c.lineWidth = 1.2;
  c.stroke(p);
}

function wvDrawMatrix(t) {
  const cl = wvCl(), live = !!WV.tele;
  WV.mods.forEach((m, r) => {
    if (!WVW['wvMxa' + r]) return;
    const sg = WVW['wvMxs' + r];
    sg.c.clearRect(0, 0, sg.w, sg.h);
    wvMiniTo(sg.c, m.src, sg.w - 2, sg.h - 2);
    const lfo = /^lfo/.test(m.src), raw = wvSrcVal(m.src), sv = wvClamp(lfo ? (raw + 1) / 2 : raw);
    const g = WVW['wvMxc' + r], { c, w, h } = g;
    c.clearRect(0, 0, w, h);
    wvTrace(c, wvPath((u) => [4 + u * (w - 8), h - 4 - wvCurveAt(m.curve, u) * (h - 8)], 40), cl, 1.2, 0.4);
    if (live) wvDot(c, 4 + sv * (w - 8), h - 4 - wvCurveAt(m.curve, sv) * (h - 8), 2.4, cl.acc);
    const a = WVW['wvMxa' + r], ac = a.c, mid = a.w / 2;
    ac.clearRect(0, 0, a.w, a.h);
    ac.fillStyle = 'rgba(255,255,255,.06)';
    ac.fillRect(mid - 0.5, 4, 1, a.h - 8);
    ac.fillStyle = cl.mod;
    const x2 = mid + m.amt * (a.w / 2 - 8);
    ac.fillRect(Math.min(mid, x2), a.h / 2 - 3, Math.abs(x2 - mid), 6);
    if (live) wvDot(ac, mid + m.amt * wvCurveAt(m.curve, sv) * (a.w / 2 - 8), a.h / 2, 2.6, cl.acc);
    ac.fillStyle = cl.t2;
    ac.font = `10px ${cl.mono}`;
    ac.textAlign = m.amt < 0 ? 'left' : 'right';
    ac.fillText((m.amt > 0 ? '+' : '') + Math.round(m.amt * 100), m.amt < 0 ? 8 : a.w - 8, a.h / 2 + 3.5);
    ac.textAlign = 'left';
  });
  // Sources on the left, destinations on the right; a rope is as thick as its
  // amount and as bright as its signal, and a bead runs along it.
  const g = WVW.wvMxMap, { c, w, h } = g;
  c.clearRect(0, 0, w, h);
  const srcs = [...new Set(WV.mods.map((m) => m.src))], dsts = [...new Set(WV.mods.map((m) => m.dst))];
  const gap = (n) => Math.min(78, (h - 80) / Math.max(1, n - 1));
  const sy = (i) => h / 2 - (srcs.length - 1) * gap(srcs.length) / 2 + i * gap(srcs.length);
  const dy = (i) => h / 2 - (dsts.length - 1) * gap(dsts.length) / 2 + i * gap(dsts.length);
  WV.mods.forEach((m) => {
    const a = sy(srcs.indexOf(m.src)), b = dy(dsts.indexOf(m.dst)), v = Math.abs(wvSrcVal(m.src));
    const p = new Path2D();
    p.moveTo(96, a);
    p.bezierCurveTo(w / 2, a, w / 2, b, w - 120, b);
    c.strokeStyle = `rgba(${cl.bloom},${0.12 + 0.6 * v * Math.abs(m.amt) * 2})`;
    c.lineWidth = 1 + Math.abs(m.amt) * 6;
    c.stroke(p);
    if (!live) return;
    const u = (t * 0.4 + srcs.indexOf(m.src) * 0.3) % 1;
    const px = (1 - u) ** 3 * 96 + 3 * (1 - u) ** 2 * u * w / 2 + 3 * (1 - u) * u * u * w / 2 + u ** 3 * (w - 120);
    const py = (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3 * b;
    wvDot(c, px, py, 2.2, cl.acc);
  });
  c.font = `11px ${cl.sans}`;
  srcs.forEach((s, i) => {
    const y = sy(i);
    c.fillStyle = cl.t;
    c.fillText(wvSrcName(s), 12, y - 6);
    c.save();
    c.translate(12, y - 2);
    wvMiniTo(c, s, 70, 16);
    c.restore();
  });
  c.textAlign = 'right';
  dsts.forEach((d, i) => { c.fillStyle = cl.t; c.fillText(wvDstName(d), w - 10, dy(i) + 4); });
  c.textAlign = 'left';
}

// ───────────────────────────────────────────────────────────────────── FX

function wvBuildFx(view) {
  const row = wvH('<div class="wv-fxrow" id="wvFxRow"></div>');
  view.appendChild(row);
  WV_FX_CHAIN.forEach((f, i) => {
    row.appendChild(wvH(`<div class="wv-mod wv-panel wv-fxc" id="wvFxc${i}"><div class="wv-mh"><i class="wv-led" data-fxled="${i}" title="${f.n} on or off"></i><span class="wv-nm">${f.n.toUpperCase()}</span></div>
     <div class="wv-well"><canvas id="wvFxd${i}" data-w="254" data-h="210"></canvas></div>
     <div class="wv-fxk">${f.kn.map((n, j) => `<div class="wv-cell c">${wvKnobEl(`wvFx${i}k${j}`, 46, 0, `fx${i}.k${j}`)}<div class="wv-lab"><span>${n}</span><b id="wvFx${i}r${j}"></b></div></div>`).join('')}</div></div>`));
  });
  view.appendChild(wvH(`<div class="wv-panel wv-mod"><div class="wv-mh"><span class="wv-nm">OUT</span><span class="wv-sp"></span><span class="wv-hint">What the chain does to the sound: before, faint; after, bright</span></div>
   <div class="wv-well"><canvas id="wvFxOut" data-w="1410" data-h="250"></canvas></div></div>`));
}

function wvWireFx() {
  WV_FX_CHAIN.forEach((f, i) => {
    f.k.forEach((_, j) => wvV(`wvFx${i}k${j}`, `fx${i}.k${j}`));
    document.querySelector(`[data-fxled="${i}"]`).addEventListener('click', () => wvCommit(`fx${i}.on`, wvG(`fx${i}.on`) ? 0 : 1));
  });
}

function wvSyncFx() {
  WV_FX_CHAIN.forEach((f, i) => {
    const on = !!wvG(`fx${i}.on`);
    document.querySelector(`[data-fxled="${i}"]`).classList.toggle('off', !on);
    document.getElementById('wvFxc' + i).classList.toggle('off', !on);
  });
}

function wvDrawFx(t) {
  const cl = wvCl(), src = wvWaveFor(0), K = (i, j) => wvG(`fx${i}.k${j}`);
  WV_FX_CHAIN.forEach((f, i) => {
    const g = WVW['wvFxd' + i], { c, w, h } = g, k0 = K(i, 0), k1 = K(i, 1), k2 = K(i, 2);
    c.clearRect(0, 0, w, h);
    if (f.n === 'Drive') {
      const d = 1 + k0 * 12, tf = (x) => Math.tanh(x * d) / Math.tanh(d);
      c.strokeStyle = 'rgba(255,255,255,.06)';
      c.beginPath(); c.moveTo(w / 2, 6); c.lineTo(w / 2, h - 6); c.moveTo(6, h / 2); c.lineTo(w - 6, h / 2); c.stroke();
      wvTrace(c, wvPath((u) => { const x = u * 2 - 1; return [w / 2 + x * (h / 2 - 10), h / 2 - tf(x) * (h / 2 - 10)]; }, 80), cl, 1.4, 0.6);
      c.strokeStyle = `rgba(${cl.bloom},.25)`;
      c.stroke(wvPath((u) => [10 + u * (w / 2 - 20), h - 14 - wvRd(src, u) * 8], 60));
      wvTrace(c, wvPath((u) => [w / 2 + 8 + u * (w / 2 - 16), h - 14 - tf(wvRd(src, u)) * 8], 80), cl, 1, 0.4);
    } else if (f.n === 'Chorus') {
      for (let v = 0; v < 3; v++) {
        const off = Math.sin(t * (0.6 + k0 * 3) + v * 2.1) * k1 * 14;
        c.globalAlpha = v ? 0.5 : 1;
        wvTrace(c, wvPath((u) => [10 + u * (w - 20), h / 2 + (v - 1) * 16 - wvRd(src, u * 2 + off / 200) * 16], 120), cl, 1.1, 0.5);
        c.globalAlpha = 1;
      }
    } else if (f.n === 'Delay') {
      const tm = 20 + k0 * (w / 3), n = Math.floor((w - 20) / tm) + 1;
      for (let r = 0; r < n; r++) {
        const x = 12 + r * tm, a = Math.pow(0.15 + k1 * 0.8, r);
        c.globalAlpha = a;
        wvTrace(c, wvPath((u) => [x + u * Math.min(tm - 6, 34), h / 2 - wvRd(src, u * 2) * 30 * a], 50), cl, 1.2, 0.5);
        c.globalAlpha = 1;
        c.fillStyle = `rgba(${cl.bloom},${0.4 * a})`;
        c.fillRect(x, h - 14, 2, -((h - 30) * a));
      }
    } else if (f.n === 'Reverb') {
      let s = 11;
      for (let x = 8; x < w - 8; x += 2) {
        s = (s * 16807) % 2147483647;
        const u = (x - 8) / (w - 16), env = Math.exp(-u * (1.5 + (1 - k0) * 6)) * (1 - k1 * u * 0.6), a = env * (h / 2 - 12) * (0.35 + 0.65 * (s / 2147483647));
        c.fillStyle = `rgba(${cl.bloom},${0.25 + 0.4 * env})`;
        c.fillRect(x, h / 2 - a, 1.4, a * 2);
      }
    } else {
      const fx = (u) => 8 + u * (w - 16);
      const gain = (u) => (k0 - 0.5) * 30 * Math.exp(-(((u - 0.1) / 0.12) ** 2)) + (k1 - 0.5) * 30 * Math.exp(-(((u - 0.5) / 0.15) ** 2)) + (k2 - 0.5) * 30 * Math.exp(-(((u - 0.9) / 0.12) ** 2));
      const m = wvMags(wvSpectrum(src));
      for (let k = 0; k < 48; k++) {
        const u = Math.log2(k + 1) / Math.log2(48) * 0.85, a = m[k];
        if (a < 0.003) continue;
        const hh = wvClamp((20 * Math.log10(a) + gain(u) + 48) / 48) * (h - 20);
        c.fillStyle = `rgba(${cl.bloom},.5)`;
        c.fillRect(fx(u) - 1, h - 6 - hh, 2, hh);
      }
      wvTrace(c, wvPath((u) => [fx(u), h / 2 - gain(u) * 1.6], 100), cl, 1.5, 0.6);
    }
    f.k.forEach((_, j) => {
      const v = K(i, j), eq = f.n === 'EQ';
      wvDrawKnob(`wvFx${i}k${j}`, `fx${i}.k${j}`, eq);
      wvTxt(`wvFx${i}r${j}`, eq ? ((v - 0.5) * 30 >= 0 ? '+' : '−') + Math.abs((v - 0.5) * 30).toFixed(1) : Math.round(v * 100) + (j === 2 ? ' %' : ''));
    });
  });
  const g = WVW.wvFxOut, { c, w, h } = g;
  c.clearRect(0, 0, w, h);
  c.strokeStyle = `rgba(${cl.bloom},.18)`;
  c.lineWidth = 1;
  c.stroke(wvPath((u) => [10 + u * (w - 20), h / 2 - wvRd(src, u * 8) * h * 0.3], 900));
  const d = 1 + K(0, 0) * 12;
  let prev = 0;
  const wet = wvPath((u) => {
    const x = wvRd(src, u * 8);
    let y = wvG('fx0.on') ? Math.tanh(x * d) / Math.tanh(d) : x;
    if (wvG('fx2.on')) y = y * 0.7 + 0.3 * wvRd(src, u * 8 - 0.03 * K(2, 0) * 8) * K(2, 2) * 2;
    const tone = wvG('fx4.on') ? K(4, 2) * 0.6 : 0;
    prev = prev * tone + y * (1 - tone);
    return [10 + u * (w - 20), h / 2 - prev * h * 0.3];
  }, 900);
  wvUnder(c, wet, 10, w - 10, h / 2, h * 0.2, cl, 0.1);
  wvTrace(c, wet, cl, 1.3, 0.7);
}

// ─────────────────────────────────────────────────────────────────── menus
//
// Drawn inside the page, so they scale with it, placed under the control that
// opened them and kept inside the page. One open at a time.

const WV_MENU = { owner: null };

function wvMenuEl() { return $('wvMenu'); }

function wvCloseMenus() {
  const m = $('wvMenu'), s = $('wvShelf');
  const open = (m && !m.hidden) || (s && !s.hidden);
  if (m) m.hidden = true;
  if (s) s.hidden = true;
  WV_MENU.owner = null;
  return open;
}

/// Put a menu under its anchor, in page pixels, inside the page.
function wvPlaceMenu(m, anchor, dx) {
  const app = document.querySelector('#waveView .wv-app'), ar = app.getBoundingClientRect(), r = anchor.getBoundingClientRect();
  const s = ar.width / app.offsetWidth || 1;
  m.hidden = false;
  const left = Math.max(8, Math.min(app.offsetWidth - m.offsetWidth - 8, (r.left - ar.left) / s + dx));
  let top = (r.bottom - ar.top) / s + 6;
  if (top + m.offsetHeight > app.offsetHeight - 8) top = Math.max(8, (r.top - ar.top) / s - m.offsetHeight - 6);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
}

/// Toggle: the same control opening its own menu again shuts it.
function wvMenuFor(owner) {
  const m = wvMenuEl();
  if (WV_MENU.owner === owner && !m.hidden) { wvCloseMenus(); return null; }
  wvCloseMenus();
  WV_MENU.owner = owner;
  m.innerHTML = '';
  m.className = 'wv-menu';
  return m;
}

function wvMenuTile(m, label, on, color) {
  const t = wvH(`<div class="wv-wt ${on ? 'on' : ''}"${color ? ` style="color:${color}"` : ''}><canvas data-w="88" data-h="38"></canvas><span></span></div>`);
  t.lastElementChild.textContent = label;
  m.appendChild(t);
  return { t, g: wvCv(t.firstElementChild) };
}

function wvWarpMenu(anchor, i, j, set) {
  const m = wvMenuFor(`warp${i}${j}`);
  if (!m) return;
  const k = `osc${i}.`, f = wvFrameAt(wvTable(wvG(k + 'table')), wvPosNow(i));
  const o = i === 1 ? 0 : 1, B = wvFrameAt(wvTable(wvG(`osc${o}.table`)), wvPosNow(o)), cl = wvCl();
  for (const key of Object.keys(WV_WARPS)) {
    const { t, g } = wvMenuTile(m, key === 'off' ? 'None' : WV_WARPS[key].name, wvG(`${k}warp${j}.mode`) === key);
    if (key !== 'off') {
      g.c.strokeStyle = `rgba(${cl.bloom},.18)`;
      g.c.lineWidth = 1;
      g.c.stroke(wvPath((u) => [4 + u * 80, 19 - wvRd(f, u) * 14], 80));
    }
    wvTrace(g.c, wvPath((u) => [4 + u * 80, 19 - wvRd(key === 'off' ? f : wvWarp(f, key, 0.55, B), u) * 14], 120), cl, 1.3, 0.6);
    t.addEventListener('click', () => { set(key); wvCloseMenus(); });
  }
  wvPlaceMenu(m, anchor, -120);
}

function wvFxMenu(anchor, i) {
  const m = wvMenuFor(`fx${i}`);
  if (!m) return;
  const k = `osc${i}.`, dry = wvWaveFor(i, true), cl = wvCl();
  for (const key of Object.keys(WV_OFX)) {
    const { t, g } = wvMenuTile(m, WV_OFX[key].name, wvG(k + 'fx.mode') === key, wvFxCol(key, 78));
    t.dataset.fx = key;
    const c = g.c, bg = c.createLinearGradient(0, 0, 88, 0);
    bg.addColorStop(0, wvFxCol(key, 45, 0.25));
    bg.addColorStop(1, wvFxCol(key, 45, 0));
    c.fillStyle = bg;
    c.fillRect(0, 0, 88, 38);
    wvFxIcon(c, key, 2, 10, 1.05, wvFxCol(key, 76));
    c.strokeStyle = `rgba(${cl.bloom},.18)`;
    c.lineWidth = 1;
    c.stroke(wvPath((u) => [24 + u * 60, 19 - wvRd(dry, u * 2) * 13], 80));
    if (key === 'chorus') {
      for (let v = 0; v < 3; v++) {
        c.globalAlpha = v ? 0.5 : 1;
        wvFxTrace(c, wvPath((u) => [24 + u * 60, 19 + (v - 1) * 4 - wvRd(dry, u * 2 + v * 0.03) * 12], 80), key, 1.1);
      }
      c.globalAlpha = 1;
    } else if (key === 'delay') {
      for (let r = 0; r < 4; r++) {
        const A = Math.pow(0.6, r);
        c.globalAlpha = A;
        wvFxTrace(c, wvPath((u) => [24 + r * 16 + u * 13, 19 - wvRd(dry, u * 2) * 12 * A], 30), key, 1.1);
      }
      c.globalAlpha = 1;
    } else if (key === 'phaser') {
      wvFxTrace(c, wvPath((u) => [24 + u * 60, 19 - (wvRd(dry, u * 2) * 0.5 + wvRd(dry, u * 2 + 0.1) * 0.5) * 13], 100), key, 1.2);
    } else {
      wvFxTrace(c, wvPath((u) => [24 + u * 60, 19 - wvRd(wvOfxShape(dry, key, 0.75, 0.5), u * 2) * 13], key === 'crush' ? 300 : 120), key, 1.2);
    }
    t.addEventListener('click', () => { wvCommit(k + 'fx.mode', key); wvCloseMenus(); });
  }
  wvPlaceMenu(m, anchor, -60);
}

/// The tables: the engine's list when it has one, the built-ins otherwise,
/// each drawn as its middle frame.
async function wvTableMenu(anchor, i) {
  const m = wvMenuFor(`table${i}`);
  if (!m) return;
  let names = WV_TABLE_NAMES.slice();
  if (WV.connected) {
    try {
      const r = await fetch('/api/wave/tables');
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length) names = list.map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean);
      }
    } catch { /* the built-ins */ }
  }
  if (WV_MENU.owner !== `table${i}`) return;
  const cl = wvCl(), k = `osc${i}.table`;
  for (const name of names) {
    const { t, g } = wvMenuTile(m, name, wvG(k) === name);
    const f = wvFrameAt(wvTable(name), 0.5);
    wvTrace(g.c, wvPath((u) => [4 + u * 80, 19 - wvRd(f, u) * 14], 100), cl, 1.3, 0.6);
    t.addEventListener('click', async () => {
      wvCloseMenus();
      wvCommit(k, name);
      await wvFetchTable(name);
    });
  }
  wvPlaceMenu(m, anchor, 0);
}

/// The presets the mock-up offered, for when the engine has none to list.
const WV_PRESETS_OFFLINE = [
  ['Night Glass Pad', 'Pad · Warm', 'Formant Sweep'], ['Hollow Choir', 'Pad · Vocal', 'Vowel Ah–Oo'], ['Organ Bloom', 'Keys · Bright', 'Glass Organ'],
  ['Pulse Runner', 'Bass · Hard', 'Hollow Pulse'], ['Grit Engine', 'Lead · Dirty', 'Grit Saw'], ['Vowel Pluck', 'Pluck · Vocal', 'Vowel Ah–Oo'],
  ['Formant Bass', 'Bass · Warm', 'Formant Sweep'], ['Glass Bell', 'Keys · Glassy', 'Glass Organ'],
].map(([name, tags, table]) => ({ name, tags, patch: { params: { 'osc0.table': table } } }));

async function wvLoadPresets() {
  if (WV.connected) {
    try {
      const r = await fetch('/api/wave/presets');
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length) { WV.presets = list; return list; }
      }
    } catch { /* offline list */ }
  }
  WV.presets = WV_PRESETS_OFFLINE;
  return WV.presets;
}

const wvPresetTags = (p) => (Array.isArray(p.tags) ? p.tags.join(' · ') : String(p.tags || ''));

/// Load a preset: over the current patch, sent whole to the engine.
async function wvApplyPreset(p) {
  const patch = p.patch || {};
  wvAdopt({ ...patch, name: p.name, tags: wvPresetTags(p) });
  WV.name = p.name;
  WV.tags = wvPresetTags(p);
  await wvPost('/api/wave/patch', wvPatchBody());
  await Promise.all([0, 1, 2].map((i) => wvFetchTable(wvG(`osc${i}.table`))));
  wvSyncAll();
}

async function wvStepPreset(by) {
  const list = WV.presets || await wvLoadPresets();
  const at = list.findIndex((p) => p.name === WV.name);
  await wvApplyPreset(list[((at < 0 ? 0 : at + by) % list.length + list.length) % list.length]);
}

async function wvOpenShelf() {
  const s = $('wvShelf');
  if (!s.hidden) { s.hidden = true; return; }
  wvCloseMenus();
  const list = await wvLoadPresets();
  s.innerHTML = '';
  for (const p of list) {
    const el = wvH(`<div class="wv-pc ${p.name === WV.name ? 'on' : ''}"><div class="wv-well"><canvas data-w="146" data-h="64"></canvas></div><b></b><span></span></div>`);
    el.querySelector('b').textContent = p.name;
    el.querySelector('span').textContent = wvPresetTags(p);
    s.appendChild(el);
    const table = (p.patch && p.patch.params && p.patch.params['osc0.table']) || p.table || WV_TABLE_NAMES[0];
    wvDraw3D(wvCv(el.querySelector('canvas')), wvTable(table), 0.4, ['off', 0], 0, { n: 18, rise: 0.55, depth: 0.3 });
    el.addEventListener('click', () => { s.hidden = true; wvApplyPreset(p); });
  }
  wvPlaceMenu(s, $('wvPresetBtn'), 0);
}

/// A and B: two patches to compare. Switching keeps the one you leave.
async function wvSwitchAB(to) {
  if (to === WV.ab) return;
  WV.abSlots[WV.ab] = JSON.parse(JSON.stringify(wvPatchBody()));
  const next = WV.abSlots[to] || JSON.parse(JSON.stringify(WV.abSlots[WV.ab]));
  WV.ab = to;
  wvAdopt(next);
  await wvPost('/api/wave/patch', wvPatchBody());
  wvSyncAll();
}

window.addEventListener('pointerdown', (e) => {
  if (!WV.showing) return;
  const m = $('wvMenu'), s = $('wvShelf');
  if (m && !m.hidden && !e.target.closest('#wvMenu, [data-cycle], [data-ofx], [data-pick], #wvCTable, canvas[id^="wvWp"]')) { m.hidden = true; WV_MENU.owner = null; }
  if (s && !s.hidden && !e.target.closest('#wvShelf, #wvPresetBtn')) s.hidden = true;
});
