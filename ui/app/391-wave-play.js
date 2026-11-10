// ================================================================ Wave: Play
//
// The Play view of the synth page: three oscillators, the mixer, the two
// filters, the amp envelope, the modulators and the voicing. Every control is
// a picture of what it does to the sound, and each one writes one patch key
// (`docs/WAVE-SYNTH.md`). Built once, on the first visit.
//
// v7 adds what moves what, where you can see it: each source in its own
// colour, a badge on every module a source moves, the LFOs' standard shapes,
// and one MIX row for every sound source with a real on/off.

/// The page's canvases, by id, each with its context and size.
const WVW = {};

function wvTxt(id, s) {
  const el = document.getElementById(id);
  if (el && el.textContent !== s) el.textContent = s;
}

function wvKnobEl(id, size, face, tgt) {
  return `<div class="wv-knob" style="width:${size}px;height:${size}px"><div class="wv-cap ${face ? 'face' : ''}" style="inset:${Math.round(size * 0.19)}px"></div>`
    + `<canvas id="${id}" data-w="${size}" data-h="${size}" ${tgt ? `data-tgt="${tgt}"` : ''}></canvas></div>`;
}

function wvGlyph(d, on, title, attrs = '') {
  return `<div class="wv-g wv-btn ${on ? 'on' : ''}" title="${title}" ${attrs}><svg viewBox="0 0 18 14"><path d="${d}"/></svg></div>`;
}

/// A small picture for a word in a switch, so no switch is words alone.
const wvIc = (d, w = 14, h = 10) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${d}"/></svg>`;

/// A vertical drag on a canvas sets one key. Shift is fine control.
function wvV(id, key, sens = 150, lo = 0, hi = 1) {
  wvDrag(WVW[id].el, (dx, dy, e) => wvLive(key, wvClamp(wvG(key) - dy / (e.shiftKey ? sens * 5 : sens), lo, hi)));
}

/// One choice among glyphs or words: lights the one chosen and stores it.
function wvChoice(root, sel, key, read = (el) => el.dataset.k) {
  const items = root.querySelectorAll(sel);
  items.forEach((el) => {
    el.addEventListener('click', () => {
      wvCommit(key, read(el));
      items.forEach((x) => x.classList.toggle('on', x === el));
    });
  });
}

/// The power glyph: on/off for an oscillator, the sub or the noise.
const WV_PWR = '<svg viewBox="0 0 14 14"><path d="M7 1.5 V6.5 M3.9 3.7 A4.6 4.6 0 1 0 10.1 3.7"/></svg>';

const WV_ROUTE_NAMES = { F1: 'Filter 1', F2: 'Filter 2', both: 'Both', direct: 'Direct' };
const WV_FILTERS = [
  ['lp', 'M2 4 H9 C12 4,12 2,13 4 L16 12', 'Low pass'], ['bp', 'M2 12 C6 12,7 2,9 2 S12 12,16 12', 'Band pass'],
  ['hp', 'M2 12 L5 4 C6 2,6 4,9 4 H16', 'High pass'], ['notch', 'M2 4 H7 L9 12 L11 4 H16', 'Notch'],
  ['comb', 'M2 4 L4 12 L6 4 L8 12 L10 4 L12 12 L14 4 L16 12', 'Comb'], ['form', 'M2 12 C4 3,6 3,7 9 C8 4,10 4,11 10 L16 12', 'Formant'],
];

function wvBuildOsc(i) {
  const L = 'ABC'[i], k = `osc${i}.`;
  const warp = (j) => {
    const m = wvG(`${k}warp${j}.mode`);
    return `<div class="wv-warp">${wvKnobEl(`wvWp${i}${j}`, 66, true, `${k}warp${j}.amt`)}`
      + `<div class="wv-glyphs">${wvGlyph(WV_WARPS[m].g, true, `Warp ${j + 1}: ${WV_WARPS[m].name}. Click for every mode, drawn on this wave`, `data-cycle="${i}${j}"`)}`
      + `<span class="wv-lab wv-col"><span id="wvWn${i}${j}"></span><b id="wvWv${i}${j}"></b></span></div></div>`;
  };
  return wvH(`<div class="wv-mod wv-panel wv-osc" id="wvOsc${i}">
   <div class="wv-mh"><span class="wv-pwr wv-btn" data-oscled="${i}" title="Osc ${L}: on or off">${WV_PWR}</span><span class="wv-nm">OSC ${L}</span>
    <span class="wv-pick wv-btn" data-pick="${i}" title="Wavetable: click to pick another"><canvas id="wvPk${i}" data-w="30" data-h="14"></canvas><span id="wvPkName${i}"></span></span>
    <span class="wv-moved" id="wvMoved${i}"></span>
    <span class="wv-sp"></span>
    <span class="wv-chip wv-btn" data-route="${i}" title="Where it goes: click for Filter 1, Filter 2, both, or straight out">${wvIc('M1 5 H11 M8 2 L11 5 L8 8')}<span id="wvRoute${i}"></span></span>
    <span class="wv-seg" data-face="${i}" style="padding:1px"><span class="on" title="Waves: the table as its frames" data-f="w">${wvIc('M1 7 C4 1,6 1,8 5 S12 9,15 3', 16, 10)}</span><span title="Spectrum: the table as its harmonics" data-f="s">${wvIc('M2 9V2M5 9V4M8 9V3M11 9V6M14 9V7', 16, 10)}</span></span>
    <span class="wv-ro" id="wvFr${i}"></span></div>
   <div class="wv-body">
    <div class="wv-tbl"><div class="wv-well"><canvas id="wvW3d${i}" data-w="324" data-h="116" data-tgt="${k}pos"></canvas></div>
     <div class="wv-well"><canvas id="wvSt${i}" data-w="324" data-h="24" title="Frames: click or drag to pick one"></canvas></div></div>
    <div class="wv-warps">${warp(0)}${warp(1)}
     <div class="wv-warp">${wvKnobEl(`wvUn${i}`, 66, true, `${k}uni.det`)}<div class="wv-lab wv-col" style="align-items:center"><span>Unison</span><b id="wvUr${i}"></b></div></div></div>
    <div class="wv-cell wv-ofx"><div class="wv-well"><canvas id="wvOfx${i}" data-w="168" data-h="94" data-tgt="${k}fx.a"></canvas></div>
     <div class="wv-lab"><div class="wv-g wv-btn on" data-ofx="${i}" title="Effect: click to pick this oscillator's own effect"><svg viewBox="0 0 18 14"><path d=""/></svg></div><span id="wvOfn${i}"></span><span class="wv-sp"></span><b id="wvOfr${i}"></b></div></div>
    <div class="wv-k4"><div class="wv-cell"><div class="wv-well"><canvas id="wvPt${i}" data-w="46" data-h="124" data-tgt="${k}pitch"></canvas></div><div class="wv-lab" style="justify-content:center"><b id="wvPtr${i}"></b></div></div>
     <div class="wv-kc"><div class="wv-cell c">${wvKnobEl(`wvPh${i}`, 40, 1, `${k}phase`)}<div class="wv-lab"><span>Phase</span><b id="wvPhr${i}"></b></div></div>
      <div class="wv-cell c">${wvKnobEl(`wvPn${i}`, 40, 0, `${k}pan`)}<div class="wv-lab"><span>Pan</span><b id="wvPnr${i}"></b></div></div></div></div>
   </div></div>`);
}

function wvBuildPlay(view) {
  const colL = wvH('<div class="wv-colL"></div>');
  const colR = wvH('<div class="wv-colR"></div>');
  view.append(colL, colR);
  for (let i = 0; i < 3; i++) colL.appendChild(wvBuildOsc(i));
  colL.appendChild(wvBuildMix());

  colR.appendChild(wvH(`<div class="wv-mod wv-panel">
   <div class="wv-mh"><span class="wv-nm">FILTERS</span><span class="wv-moved" id="wvMovedF"></span><span class="wv-sp"></span><div class="wv-seg" id="wvFroute"><span data-k="serial" title="Serial: Filter 1, then Filter 2">1 → 2</span><span data-k="parallel" title="Parallel: both filters side by side, summed">1 ‖ 2</span><span data-k="split" title="Split: A goes to Filter 1, B to Filter 2">${wvIc('M1 5 H5 L9 1 H13 M5 5 L9 9 H13')}Split</span></div></div>
   <div class="wv-two" id="wvFilters"></div></div>`));
  const fl = colR.querySelector('#wvFilters');
  [0, 1].forEach((i) => fl.appendChild(wvH(`<div class="wv-fcol">
   <div class="wv-frow"><span class="wv-ro" style="color:var(--wv-t)">${i + 1}</span><div class="wv-glyphs" data-ftype="${i}">${WV_FILTERS.map(([k, d, t]) => wvGlyph(d, false, `${t}: Filter ${i + 1}'s type`, `data-k="${k}"`)).join('')}</div></div>
   <div class="wv-well"><canvas id="wvLens${i}" data-w="258" data-h="86" data-tgt="filt${i}.cut"></canvas></div>
   <div class="wv-frow" style="justify-content:space-between">
    <div class="wv-cell c" style="flex-direction:row;gap:4px">${wvKnobEl(`wvDr${i}`, 34, 0, `filt${i}.drive`)}<div class="wv-lab wv-col"><span>Drive</span><b id="wvDrr${i}"></b></div></div>
    <div class="wv-cell c" style="flex-direction:row;gap:4px">${wvKnobEl(`wvKy${i}`, 34, 0, `filt${i}.key`)}<div class="wv-lab wv-col"><span>Key</span><b id="wvKyr${i}"></b></div></div></div></div>`)));

  colR.appendChild(wvH(`<div class="wv-mod wv-panel">
   <div class="wv-mh"><span class="wv-nm">AMP</span><span class="wv-sp"></span><span class="wv-ro" id="wvAmpRo"></span></div>
   <div style="display:flex;gap:8px"><div class="wv-well"><canvas id="wvAmp" data-w="380" data-h="78" title="Amp envelope: drag a corner. Attack, decay and sustain, release"></canvas></div><div class="wv-well" title="Voices: one cell for each note sounding, filled to its level"><canvas id="wvVox" data-w="138" data-h="78"></canvas></div></div></div>`));

  colR.appendChild(wvH(`<div class="wv-mod wv-panel">
   <div class="wv-mh"><span class="wv-nm">MODULATE</span><span class="wv-sp"></span><span class="wv-hint">Drag a source onto any control</span></div>
   <div class="wv-tabs4" id="wvSrcTabs">${WV_SOURCES.map((s, i) => `<div class="wv-t4 wv-btn" data-src="${i}" style="--c:${WV_SRC_COL[s.key]}" title="${s.label}: click to edit it, drag it onto any control to make it move that control"><i class="act"></i><canvas id="wvT4c${i}" data-w="40" data-h="14"></canvas><b>${s.label}</b></div>`).join('')}</div>
   <div class="wv-shapes" id="wvShapes"><span class="wv-hint" id="wvShpLab">Shape</span>
    <div class="wv-glyphs">${WV_LFO_SHAPES.map(([k, n, d]) => wvGlyph(d, false, n, `data-shape="${k}"`)).join('')}</div><span class="wv-sp"></span>
    <div class="wv-seg" id="wvRateMode"><span data-k="0" title="Hz: the rate runs free of the tempo">Hz</span><span data-k="1" title="Sync: the rate locks to the tempo, in bars and notes">Sync</span></div>
    <span class="wv-ro wv-tempo wv-btn" id="wvTempoRo" title="Tempo: drag up and down. Synced LFOs follow it; double-click for 120"></span></div>
   <div class="wv-ed">
    <div class="wv-well"><canvas id="wvSrcEd" data-w="338" data-h="124" title="Shape: drag a point, double-click to add one. A standard shape becomes Drawn when you change it here"></canvas></div>
    <div style="display:flex;flex-direction:column;gap:8px;width:178px" id="wvSrcSide">
     <div class="wv-seg" id="wvSrcMode"><span data-k="free" title="Free: runs all the time, the same for every note">${wvIc('M1 5 C3 0,5 0,7 5 S11 10,13 5')}Free</span><span data-k="trig" title="Trig: starts again from the beginning on each note">${wvIc('M1 9 V1 M1 5 C4 0,6 0,8 5 S11 10,13 5')}Trig</span><span data-k="env" title="Env: plays once per note, then holds its last value">${wvIc('M1 9 L4 1 L13 9')}Env</span></div>
     <div style="display:flex;gap:8px;justify-content:space-between">
      <div class="wv-cell c" title="Rate: drag up and down. In Hz, or a note length with Sync">${wvKnobEl('wvSrcRate', 46, 0)}<div class="wv-lab"><span>Rate</span><b id="wvSrcRateRo"></b></div></div>
      <div class="wv-cell c" title="Smooth: drag up and down. Rounds off the corners, up to 200 ms">${wvKnobEl('wvSrcSmooth', 46, 0)}<div class="wv-lab"><span>Smooth</span><b id="wvSrcSmoothRo"></b></div></div>
      <div class="wv-cell c" title="Rise: drag up and down. Fades the LFO in from each note's start">${wvKnobEl('wvSrcRise', 46, 0)}<div class="wv-lab"><span>Rise</span><b id="wvSrcRiseRo"></b></div></div></div></div></div>
   <div class="wv-targets" id="wvSrcTargets"></div></div>`));

  colR.appendChild(wvH(`<div class="wv-mod wv-panel wv-voicing">
   <span class="wv-nm">VOICE</span>
   <div class="wv-seg" id="wvVoiceMode"><span data-k="poly" title="Poly: every note its own voice">${wvIc('M1 2 H13 M1 5 H13 M1 8 H13')}Poly</span><span data-k="mono" title="Mono: one note at a time">${wvIc('M1 5 H13')}Mono</span><span data-k="legato" title="Legato: notes glide into each other">${wvIc('M1 8 C4 1,10 1,13 8')}Legato</span></div>
   <div class="wv-well"><canvas id="wvGlide" data-w="96" data-h="26" data-tgt="voice.glide"></canvas></div>
   <span class="wv-chip wv-btn" id="wvBendRange" title="Pitch-bend range: click for the next">${wvIc('M1 8 C5 8,7 2,13 2')}<span>Bend</span><b class="wv-mono" id="wvBendRo"></b></span>
   <div class="wv-seg" id="wvMpe"><span title="MPE: each note its own bend and pressure">${wvIc('M1 9 V3 M5 9 V1 M9 9 V4 M13 9 V2')}MPE</span></div></div>`));
}

// ─────────────────────────────────────────────────────────────── wiring

function wvWirePlay() {
  for (let i = 0; i < 3; i++) {
    const k = `osc${i}.`;
    const led = document.querySelector(`[data-oscled="${i}"]`);
    led.addEventListener('click', () => wvCommit(k + 'on', wvG(k + 'on') ? 0 : 1));
    document.querySelector(`[data-pick="${i}"]`).addEventListener('click', (e) => wvTableMenu(e.currentTarget, i));
    document.querySelector(`[data-route="${i}"]`).addEventListener('click', () => {
      const order = ['F1', 'F2', 'both', 'direct'];
      wvCommit(k + 'route', order[(order.indexOf(wvG(k + 'route')) + 1) % order.length]);
    });
    document.querySelectorAll(`[data-face="${i}"] [data-f]`).forEach((b) => b.addEventListener('click', () => {
      WV.face[i] = b.dataset.f;
      document.querySelectorAll(`[data-face="${i}"] [data-f]`).forEach((x) => x.classList.toggle('on', x === b));
    }));
    wvDrag(WVW['wvW3d' + i].el, (dx, dy) => {
      wvLive(k + 'pos', wvClamp(wvG(k + 'pos') + dx / 260));
      WV.tilt[i] = wvClamp(WV.tilt[i] - dy / 110);
    });
    const st = WVW['wvSt' + i].el;
    const setp = (e) => { const [x] = wvLocal(st, e); wvLive(k + 'pos', wvClamp((x - 6) / (st.offsetWidth - 12))); };
    wvDrag(st, (a, b, e) => setp(e), setp);
    [0, 1].forEach((j) => {
      const amt = `${k}warp${j}.amt`, mode = `${k}warp${j}.mode`;
      wvV(`wvWp${i}${j}`, amt);
      const b = document.querySelector(`[data-cycle="${i}${j}"]`);
      const set = (m) => {
        wvCommit(mode, m);
        if (m !== 'off' && !wvG(amt)) wvCommit(amt, 0.4);
      };
      b.addEventListener('click', () => wvWarpMenu(b, i, j, set));
      WVW[`wvWp${i}${j}`].el.addEventListener('click', () => { if (wvG(mode) === 'off') wvWarpMenu(b, i, j, set); });
    });
    const u = WVW['wvUn' + i].el;
    wvDrag(u, (dx, dy, e) => {
      if (e.shiftKey) wvLive(k + 'uni.spr', wvClamp(wvG(k + 'uni.spr') - dy / 100));
      else wvLive(k + 'uni.det', wvClamp(wvG(k + 'uni.det') - dy / 120));
    });
    let wheelTimer = null;
    u.addEventListener('wheel', (e) => {
      e.preventDefault();
      WV.p[k + 'uni.n'] = Math.max(1, Math.min(16, wvG(k + 'uni.n') + (e.deltaY < 0 ? 1 : -1)));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => wvCommit(k + 'uni.n'), 150);
    }, { passive: false });
    wvDrag(WVW['wvOfx' + i].el, (dx, dy) => {
      wvLive(k + 'fx.a', wvClamp(wvG(k + 'fx.a') + dx / 120));
      wvLive(k + 'fx.b', wvClamp(wvG(k + 'fx.b') - dy / 70));
    });
    document.querySelector(`[data-ofx="${i}"]`).addEventListener('click', (e) => wvFxMenu(e.currentTarget, i));
    let acc = 0;
    wvDrag(WVW['wvPt' + i].el, (dx, dy, e) => {
      if (e.shiftKey) { wvLive(k + 'fine', wvClamp(wvG(k + 'fine') - dy / 200)); return; }
      acc -= dy;
      const steps = Math.trunc(acc / 7);
      if (steps) { acc -= steps * 7; wvLive(k + 'pitch', wvClamp(Math.round((wvG(k + 'pitch') + steps / 48) * 48) / 48)); }
    }, () => { acc = 0; });
    wvV('wvPn' + i, k + 'pan');
    wvDrag(WVW['wvPh' + i].el, (dx, dy, e) => {
      if (e.altKey) wvLive(k + 'rand', wvClamp(wvG(k + 'rand') - dy / 150));
      else wvLive(k + 'phase', ((wvG(k + 'phase') - dy / 150) % 1 + 1) % 1);
    });
  }

  wvWireMix();
  wvWireShapes();
  wvChoice(document, '#wvFroute span', 'filt.route');
  wvChoice(document, '#wvVoiceMode span', 'voice.mode');
  $('wvMpe').addEventListener('click', () => wvCommit('voice.mpe', wvG('voice.mpe') ? 0 : 1));
  $('wvBendRange').addEventListener('click', () => {
    const r = [1, 2, 7, 12, 24];
    wvCommit('voice.bend', r[(r.indexOf(wvG('voice.bend')) + 1) % r.length]);
  });
  wvDrag(WVW.wvGlide.el, (dx) => wvLive('voice.glide', wvClamp(wvG('voice.glide') + dx / 150)));

  [0, 1].forEach((i) => {
    const f = `filt${i}.`;
    wvDrag(WVW['wvLens' + i].el, (dx, dy) => {
      wvLive(f + 'cut', wvClamp(wvG(f + 'cut') + dx / 220));
      wvLive(f + 'res', wvClamp(wvG(f + 'res') - dy / 80));
    });
    wvV('wvDr' + i, f + 'drive');
    wvV('wvKy' + i, f + 'key');
    wvChoice(document, `[data-ftype="${i}"] .wv-g`, f + 'type');
  });

  // The amp ridge: the nearest corner is the one dragged.
  let eh = null;
  const amp = WVW.wvAmp;
  wvDrag(amp.el, (dx, dy) => wvEnvDrag('amp', eh, dx, dy, 140, 60),
    (e) => { eh = wvEnvHandle(amp, 'amp', wvLocal(amp.el, e)[0]); });

  // Sources: a click selects one; a drag onto a control maps it there.
  document.querySelectorAll('#wvSrcTabs [data-src]').forEach((t) => {
    t.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      let moved = false;
      const sx = e.clientX, sy = e.clientY;
      const mv = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) { moved = true; $('waveView').classList.add('wv-mapping'); }
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        $('waveView').classList.remove('wv-mapping');
        const src = WV_SOURCES[+t.dataset.src].key;
        if (moved) {
          const tg = document.elementFromPoint(ev.clientX, ev.clientY);
          const c = tg && tg.closest ? tg.closest('#waveView canvas[data-tgt]') : null;
          if (c) {
            const dst = c.dataset.tgt;
            const ex = WV.mods.find((m) => m.src === src && m.dst === dst);
            if (ex) ex.amt = 0.3;
            else WV.mods.push({ src, dst, amt: 0.3, curve: 'lin', via: null });
            wvSendMods();
            wvRenderTargets();
          }
        } else {
          WV.sel = +t.dataset.src;
          wvSyncSrc();
        }
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  });

  // The source editor: an LFO's points, or an envelope's corners. A standard
  // shape has no points to drag, so the first drag or double-click on one makes
  // it Drawn, sampled from what is on screen, and goes on from there.
  const se = WVW.wvSrcEd;
  let pi = -1, at0 = null;
  const px = (q) => 8 + q[0] * (se.w - 16), py = (q) => 8 + (1 - q[1]) * (se.h - 16);
  const nearest = (pts, x, y) => pts.reduce((b, q, i) => (Math.hypot(px(q) - x, py(q) - y) < Math.hypot(px(pts[b]) - x, py(pts[b]) - y) ? i : b), 0);
  wvDrag(se.el, (dx, dy, e) => {
    const s = WV_SOURCES[WV.sel], [x, y] = wvLocal(se.el, e);
    if (s.kind === 'lfo' && pi === -2) {
      wvToDrawn(+s.key.slice(3));
      pi = nearest(wvG(`${s.key}.points`), at0[0], at0[1]);
    }
    if (s.kind === 'lfo' && pi >= 0) {
      const key = `${s.key}.points`, pts = wvG(key).map((q) => q.slice());
      const p = pts[pi];
      if (pi > 0 && pi < pts.length - 1) p[0] = wvClamp((x - 8) / (se.w - 16), pts[pi - 1][0] + 0.01, pts[pi + 1][0] - 0.01);
      p[1] = wvClamp(1 - (y - 8) / (se.h - 16));
      wvLive(key, pts);
    } else if (s.kind === 'env' && eh) wvEnvDrag(s.key, eh, dx, dy, 120, 70);
  }, (e) => {
    const s = WV_SOURCES[WV.sel], [x, y] = wvLocal(se.el, e);
    at0 = [x, y];
    if (s.kind === 'lfo') {
      const L = +s.key.slice(3);
      // Not yet: a plain click on a standard shape leaves it as it is.
      if (wvLfoShape(L) !== 'drawn' && e.detail !== 2) { pi = -2; return; }
      wvToDrawn(L);
      const pts = wvG(`${s.key}.points`);
      const near = (q) => Math.hypot(px(q) - x, py(q) - y);
      pi = nearest(pts, x, y);
      if (near(pts[pi]) > 14 && e.detail === 2) {
        const nx = wvClamp((x - 8) / (se.w - 16));
        const at = Math.max(1, pts.findIndex((q) => q[0] > nx));
        const next = pts.map((q) => q.slice());
        next.splice(at, 0, [nx, wvClamp(1 - (y - 8) / (se.h - 16))]);
        wvLive(`${s.key}.points`, next);
        pi = at;
      }
    } else eh = wvEnvHandle(se, s.key, x);
  });
  document.querySelectorAll('#wvSrcMode span').forEach((b) => b.addEventListener('click', () => {
    const s = WV_SOURCES[WV.sel];
    if (s.kind === 'lfo') wvCommit(`${s.key}.mode`, b.dataset.k);
  }));
  const srcKnob = (id, field) => wvDrag(WVW[id].el, (dx, dy, e) => {
    const s = WV_SOURCES[WV.sel];
    if (s.kind !== 'lfo') return;
    const key = `${s.key}.${field}`;
    wvLive(key, wvClamp(wvG(key) - dy / (e.shiftKey ? 750 : 150)));
  });
  srcKnob('wvSrcRate', 'rate');
  srcKnob('wvSrcSmooth', 'smooth');
  srcKnob('wvSrcRise', 'rise');
}

// ─────────────────────────────────────────────────────────── v7: LFO shapes

/// Make an LFO Drawn, keeping the shape it had: the points first, so the
/// engine never plays the old points as Drawn, then the shape.
function wvToDrawn(L) {
  if (wvLfoShape(L) === 'drawn') return;
  wvCommit(`lfo${L}.points`, wvShapePoints(L));
  wvCommit(`lfo${L}.shape`, 'drawn');
}

function wvWireShapes() {
  const lfo = () => { const s = WV_SOURCES[WV.sel]; return s.kind === 'lfo' ? +s.key.slice(3) : null; };
  document.querySelectorAll('#wvShapes [data-shape]').forEach((b) => b.addEventListener('click', () => {
    const L = lfo();
    if (L == null) return;
    if (b.dataset.shape === 'drawn') wvToDrawn(L);
    else wvCommit(`lfo${L}.shape`, b.dataset.shape);
  }));
  document.querySelectorAll('#wvRateMode span').forEach((b) => b.addEventListener('click', () => {
    const L = lfo();
    if (L != null) wvCommit(`lfo${L}.sync`, +b.dataset.k);
  }));
  // The tempo: drag up or across, a beat per two pixels, whole BPM only.
  const tp = $('wvTempoRo');
  let acc = 0, from = 120;
  wvDrag(tp, (dx, dy) => {
    acc += (dx - dy) / 2;
    wvLive('tempo', Math.round(wvClamp(from + acc, 30, 300)));
    wvTxt('wvTempoRo', `${wvTempo()} BPM`);
  }, () => { acc = 0; from = wvTempo(); });
  tp.addEventListener('dblclick', () => wvCommit('tempo', 120));
}

/// The Shape row follows the chosen source; an envelope has no shape to pick.
function wvSyncShapes() {
  const s = WV_SOURCES[WV.sel], lfo = s.kind === 'lfo', L = lfo ? +s.key.slice(3) : 0, el = $('wvShapes');
  el.style.setProperty('--c', WV_SRC_COL[s.key]);
  el.classList.toggle('env', !lfo);
  const shape = lfo ? wvLfoShape(L) : '', sync = lfo && !!wvG(`lfo${L}.sync`);
  el.querySelectorAll('[data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === shape));
  el.querySelectorAll('#wvRateMode span').forEach((b) => b.classList.toggle('on', lfo && (b.dataset.k === '1') === sync));
  $('wvTempoRo').classList.toggle('off', !sync);
  wvTxt('wvTempoRo', `${wvTempo()} BPM`);
  wvTxt('wvShpLab', lfo ? 'Shape' : 'Envelope · drag its points');
}

/// Which corner of an envelope drawing is nearest the pointer.
function wvEnvHandle(g, pre, x) {
  const P = wvEnvPts(g, wvEnv(pre));
  const d = [P.a[0], P.d[0], P.r[0]].map((q) => Math.abs(q - x));
  return ['a', 'd', 'r'][d.indexOf(Math.min(...d))];
}

function wvEnvDrag(pre, eh, dx, dy, sx, sy) {
  if (eh === 'a') wvLive(`${pre}.a`, wvClamp(wvG(`${pre}.a`) + dx / sx, 0.005, 1));
  else if (eh === 'd') {
    wvLive(`${pre}.d`, wvClamp(wvG(`${pre}.d`) + dx / sx, 0.01, 1));
    wvLive(`${pre}.s`, wvClamp(wvG(`${pre}.s`) - dy / sy));
  } else if (eh === 'r') wvLive(`${pre}.r`, wvClamp(wvG(`${pre}.r`) + dx / sx, 0.01, 1));
}

const wvEnv = (pre) => ({ a: wvG(`${pre}.a`), d: wvG(`${pre}.d`), s: wvG(`${pre}.s`), r: wvG(`${pre}.r`) });

function wvRenderTargets() {
  const el = $('wvSrcTargets');
  if (!el) return;
  const src = WV_SOURCES[WV.sel].key;
  el.innerHTML = '';
  WV.mods.filter((m) => m.src === src).forEach((m) => {
    const c = wvH(`<span class="wv-chip wv-btn" style="--wv-mod:${WV_SRC_COL[src] || 'var(--wv-mod)'}" title="${wvDstName(m.dst)}: drag across for how far ${WV_SOURCES[WV.sel].label} moves it"><i></i>${wvDstName(m.dst)} <b class="wv-mono" style="font-weight:400;color:var(--wv-t3)"></b> <span style="color:var(--wv-t3);cursor:pointer" title="Remove: this source stops moving it">×</span></span>`);
    const amt = c.querySelector('b');
    const show = () => { amt.textContent = (m.amt > 0 ? '+' : '') + Math.round(m.amt * 100); };
    show();
    c.lastElementChild.addEventListener('pointerdown', (e) => e.stopPropagation());
    c.lastElementChild.addEventListener('click', () => {
      WV.mods.splice(WV.mods.indexOf(m), 1);
      wvSendMods();
      wvRenderTargets();
    });
    wvDrag(c, (dx) => { m.amt = wvClamp(m.amt + dx / 200, -1, 1); WV.modsDirty = true; show(); });
    el.appendChild(c);
  });
  if (!el.children.length) el.appendChild(wvH('<span class="wv-hint">No targets yet. Drag this source onto a control.</span>'));
  wvRenderBadges();
}

/// The parts of Modulate that follow the chosen source.
function wvSyncSrc() {
  document.querySelectorAll('#wvSrcTabs [data-src]').forEach((x) => x.classList.toggle('on', +x.dataset.src === WV.sel));
  const s = WV_SOURCES[WV.sel];
  const lfo = s.kind === 'lfo';
  $('wvSrcSide').querySelectorAll('.wv-seg, .wv-cell').forEach((x) => x.classList.toggle('dim', !lfo));
  const mode = lfo ? wvG(`${s.key}.mode`) : '';
  document.querySelectorAll('#wvSrcMode span').forEach((x) => x.classList.toggle('on', x.dataset.k === mode));
  wvSyncShapes();
  wvRenderTargets();
}

/// Everything that is a lit choice rather than a drawing, set from the patch.
/// Called after a patch arrives and after any stored change.
function wvSyncPlay() {
  for (let i = 0; i < 3; i++) {
    const k = `osc${i}.`;
    document.querySelector(`[data-oscled="${i}"]`).classList.toggle('on', !!wvG(k + 'on'));
    document.getElementById('wvOsc' + i).style.opacity = wvG(k + 'on') ? 1 : 0.55;
    wvTxt('wvPkName' + i, wvG(k + 'table'));
    wvTxt('wvRoute' + i, WV_ROUTE_NAMES[wvG(k + 'route')] || wvG(k + 'route'));
    [0, 1].forEach((j) => {
      const m = wvG(`${k}warp${j}.mode`);
      const b = document.querySelector(`[data-cycle="${i}${j}"]`);
      b.querySelector('path').setAttribute('d', (WV_WARPS[m] || WV_WARPS.off).g);
      wvTxt(`wvWn${i}${j}`, m === 'off' ? 'Add' : (WV_WARPS[m] || WV_WARPS.off).name);
    });
    const fx = wvG(k + 'fx.mode');
    document.querySelector(`[data-ofx="${i}"] path`).setAttribute('d', (WV_OFX[fx] || WV_OFX.off).g);
    wvTxt('wvOfn' + i, (WV_OFX[fx] || WV_OFX.off).name);
  }
  WV_MIX.forEach((ch, c) => {
    const on = !!wvG(ch.on);
    document.querySelector(`[data-mixon="${c}"]`).classList.toggle('on', on);
    document.querySelector(`[data-strip="${c}"]`).classList.toggle('off', !on);
  });
  const lit = (sel, v) => document.querySelectorAll(sel).forEach((x) => x.classList.toggle('on', x.dataset.k === String(v)));
  lit('[data-subshape] .wv-g', wvG('sub.shape'));
  lit('[data-suboct] span', wvG('sub.oct'));
  lit('[data-ncol] span', wvG('noise.color'));
  lit('#wvFroute span', wvG('filt.route'));
  lit('#wvVoiceMode span', wvG('voice.mode'));
  [0, 1].forEach((i) => lit(`[data-ftype="${i}"] .wv-g`, wvG(`filt${i}.type`)));
  $('wvMpe').firstElementChild.classList.toggle('on', !!wvG('voice.mpe'));
  wvTxt('wvBendRo', `±${wvG('voice.bend')}`);
  wvSyncSrc();
}

// ─────────────────────────────────────────────────────────── v7: badges
//
// A badge on each module for every route into it: the source's own shape in
// its colour, then what it moves. Hovering one lights the source's tab and
// rings the control; clicking one opens the source in Modulate.

/// A badge on an oscillator names only the control, since it sits on that
/// oscillator already. One on the filters keeps the filter's number.
const WV_BADGE_SHORT = { pos: 'Position', 'warp0.amt': 'Warp 1', 'warp1.amt': 'Warp 2', 'uni.det': 'Unison', 'uni.spr': 'Width', pitch: 'Pitch', fine: 'Fine', phase: 'Phase', rand: 'Random', pan: 'Pan', level: 'Level', 'fx.a': 'Effect', 'fx.b': 'Effect' };

const wvEsc = (t) => String(t).replace(/[&<>\u0022]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\u0022': '&quot;' })[c]);
const wvSrcIndex = (src) => WV_SOURCES.findIndex((s) => s.key === src);
const wvSrcColour = (src) => WV_SRC_COL[src] || 'var(--wv-mod)';

/// A source drawn small: an LFO's own shape, an envelope's corners, and a
/// plain ramp for the rest (macros, the wheel, velocity).
function wvSrcGlyph(src, w = 14, h = 9) {
  const i = wvSrcIndex(src);
  let d = '';
  if (i >= 0 && WV_SOURCES[i].kind === 'lfo') {
    const L = +src.slice(3);
    for (let k = 0; k <= 28; k++) {
      const u = k / 28;
      d += (k ? 'L' : 'M') + (1 + u * (w - 2)).toFixed(1) + ' ' + (h - 1 - wvLfoVal(L, u, 0) * (h - 2)).toFixed(1);
    }
  } else if (i >= 0) d = `M1 ${h - 1} L4 1 L7 ${h / 2} H${w - 4} L${w - 1} ${h - 1}`;
  else d = `M1 ${h - 1} L${w - 1} 1`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}

function wvBadge(m, short) {
  const rest = m.dst.replace(/^osc\d\./, '');
  const tn = short ? (WV_BADGE_SHORT[rest] || rest) : wvDstName(m.dst);
  return `<span class="wv-badge" style="--c:${wvSrcColour(m.src)}" data-bs="${wvEsc(m.src)}" data-bt="${wvEsc(m.dst)}">${wvSrcGlyph(m.src)}${wvEsc(wvSrcName(m.src))}<i>→ ${wvEsc(tn)}</i></span>`;
}

/// Light a route: the source's tab, and the control it moves, in its colour.
function wvHlMod(src, dst, on) {
  const i = wvSrcIndex(src);
  if (i >= 0) document.querySelector(`#wvSrcTabs [data-src="${i}"]`)?.classList.toggle('wv-hl', on);
  document.querySelectorAll('#waveView canvas[data-tgt]').forEach((c) => {
    if (c.dataset.tgt !== dst) return;
    c.style.setProperty('--c', wvSrcColour(src));
    c.classList.toggle('wv-hl', on);
  });
}

/// Every module's badges, from the routes as they are now. Called whenever the
/// routes change, and when Play comes on screen, since badges that do not fit
/// can only be found once they are laid out.
function wvRenderBadges() {
  if (!WV.built) return;
  document.querySelectorAll('#waveView .wv-hl').forEach((x) => x.classList.remove('wv-hl'));
  const rows = [0, 1, 2].map((i) => [`wvMoved${i}`, (m) => m.dst.startsWith(`osc${i}.`), true])
    .concat([['wvMovedF', (m) => /^filt\d\./.test(m.dst), false]]);
  for (const [id, keep, short] of rows) {
    const el = document.getElementById(id);
    if (!el) continue;
    const list = WV.mods.filter(keep);
    let n = list.length;
    const fill = () => {
      const more = list.slice(n);
      el.innerHTML = list.slice(0, n).map((m) => wvBadge(m, short)).join('')
        + (more.length ? `<span class="wv-badge wv-more" style="--c:var(--wv-t3)" title="${more.length} more: ${wvEsc(more.map((m) => `${wvSrcName(m.src)} → ${wvDstName(m.dst)}`).join(', '))}">+${more.length}</span>` : '');
    };
    fill();
    // More routes than the header has room for: the last ones fold into "+N",
    // so a badge is never cut off.
    while (n > 0 && el.clientWidth && el.scrollWidth > el.clientWidth + 0.5) { n--; fill(); }
    el.querySelectorAll('.wv-badge[data-bs]').forEach((b) => {
      const src = b.dataset.bs, dst = b.dataset.bt;
      b.addEventListener('mouseenter', () => wvHlMod(src, dst, true));
      b.addEventListener('mouseleave', () => wvHlMod(src, dst, false));
      b.addEventListener('click', () => {
        const i = wvSrcIndex(src);
        if (i < 0) return;
        WV.sel = i;
        wvSyncSrc();
      });
    });
  }
}

// ─────────────────────────────────────────────────────────── v7: the mixer
//
// Every sound source on one row, each with a real on/off and a level bar that
// draws its own sound. The bar's right end holds its readout.

const WV_MIX = [0, 1, 2].map((i) => ({ n: `OSC ${'ABC'[i]}`, who: `Osc ${'ABC'[i]}`, on: `osc${i}.on`, lv: `osc${i}.level` }))
  .concat([{ n: 'SUB', who: 'Sub', on: 'sub.on', lv: 'sub.level' }, { n: 'NOISE', who: 'Noise', on: 'noise.on', lv: 'noise.level' }]);
/// Fixed widths, the row's whole width between them; the last 40 px of each
/// bar is its readout.
const WV_MIX_W = [126, 126, 126, 214, 194];
const WV_MIX_RO = 40;
const WV_NOISE_COL = [['W', 'White: bright, even hiss', '#e9edf2'], ['P', 'Pink: softer, even in every octave', '#f2a3c0'], ['B', 'Brown: a deep rumble', '#c08f60']];
const WV_SUB_SHAPES = [
  ['M2 7 C5 0,7 0,9 7 S13 14,16 7', 'Sine: the purest, deepest sub'],
  ['M2 7 L6 2 L12 12 L16 7', 'Triangle: a little edge, so it carries on small speakers'],
  ['M2 3 H9 V11 H16', 'Square: hollow, cuts through a mix'],
];

function wvBuildMix() {
  const head = (ch, c) => {
    let x = `<span class="wv-pwr wv-btn" data-mixon="${c}" title="${ch.who}: on or off">${WV_PWR}</span><span class="wv-nm">${ch.n}</span>`;
    if (c === 3) {
      x += `<div class="wv-glyphs" data-subshape>${WV_SUB_SHAPES.map(([d, t], k) => wvGlyph(d, false, t, `data-k="${k}"`)).join('')}</div>`
        + '<div class="wv-seg" data-suboct><span data-k="2" title="−2: two octaves below the note">−2</span><span data-k="1" title="−1: one octave below the note">−1</span></div>';
    }
    if (c === 4) x += `<div class="wv-seg" data-ncol>${WV_NOISE_COL.map(([l, t, col], k) => `<span data-k="${k}" title="${t}"><i class="wv-nd" style="background:${col}"></i>${l}</span>`).join('')}</div>`;
    return x;
  };
  return wvH(`<div class="wv-mod wv-panel wv-mix"><span class="wv-vlab">MIX</span>${WV_MIX.map((ch, c) => `<div class="wv-strip" data-strip="${c}" style="width:${WV_MIX_W[c]}px">
    <div class="wv-sh">${head(ch, c)}</div>
    <div class="wv-well"><canvas id="wvMixL${c}" data-w="${WV_MIX_W[c]}" data-h="24" data-tgt="${ch.lv}"></canvas></div></div>`).join('')}</div>`);
}

function wvWireMix() {
  WV_MIX.forEach((ch, c) => {
    const g = WVW['wvMixL' + c], span = WV_MIX_W[c] - WV_MIX_RO - 12;
    // Where you click is the level, and it follows the pointer from there.
    const set = (e) => wvLive(ch.lv, wvClamp((wvLocal(g.el, e)[0] - 6) / span));
    wvDrag(g.el, (dx, dy, e) => set(e), set);
    document.querySelector(`[data-mixon="${c}"]`).addEventListener('click', () => wvCommit(ch.on, wvG(ch.on) ? 0 : 1));
  });
  wvChoice(document, '[data-subshape] .wv-g', 'sub.shape', (el) => +el.dataset.k);
  wvChoice(document, '[data-suboct] span', 'sub.oct', (el) => +el.dataset.k);
  wvChoice(document, '[data-ncol] span', 'noise.color', (el) => +el.dataset.k);
}

const wvDbTxt = (v) => (v < 0.01 ? '−∞' : ((d) => (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1))(20 * Math.log10(v * v + 1e-9)));

/// `curs` are the oscillators' cycles this frame, already worked out.
function wvDrawMix(t, curs) {
  const cl = wvCl();
  WV_MIX.forEach((ch, c) => {
    const g = WVW['wvMixL' + c], x = g.c, W0 = g.w, h = g.h, w = W0 - WV_MIX_RO;
    const v = wvClamp(wvG(ch.lv)), X = 6 + (w - 12) * v, a = 0.4 + 0.6 * v;
    x.clearRect(0, 0, W0, h);
    x.globalAlpha = wvG(ch.on) ? 1 : 0.35;
    x.save();
    x.beginPath(); x.rect(6, 2, X - 6, h - 4); x.clip();
    const p = new Path2D();
    let col = null;
    const line = (n, y) => { for (let i = 0; i <= n; i++) { const u = i / n, yy = y(u, i); if (i) p.lineTo(6 + u * (w - 12), yy); else p.moveTo(6 + u * (w - 12), yy); } };
    if (c < 3) line(140, (u) => h / 2 - wvRd(curs[c], u * 4) * (h * 0.36) * a);
    else if (c === 3) {
      const sh = [(q) => Math.sin(q * WV_TAU), (q) => 1 - 4 * Math.abs((((q + 0.25) % 1) + 1) % 1 - 0.5), (q) => ((q % 1) < 0.5 ? 1 : -1) * 0.8][wvG('sub.shape')] || ((q) => Math.sin(q * WV_TAU));
      const cyc = 4 / 2 ** (wvG('sub.oct') || 1);
      line(140, (u) => h / 2 - sh(u * cyc) * (h * 0.36) * a);
    } else {
      // Noise in its own colour, white, pink or brown, the steps reseeded
      // fourteen times a second so it seethes.
      let sd = 7 + Math.floor(t * 14) % 997, pr = 0;
      const nc = wvG('noise.color') | 0;
      col = (WV_NOISE_COL[nc] || WV_NOISE_COL[1])[2];
      line(170, () => {
        sd = (sd * 16807) % 2147483647;
        const r = (sd / 2147483647) * 2 - 1;
        pr = nc === 0 ? r : nc === 1 ? pr * 0.6 + r * 0.6 : pr * 0.9 + r * 0.35;
        return h / 2 - wvClamp(pr, -1, 1) * (h * 0.4) * a;
      });
    }
    if (col) {
      x.strokeStyle = col;
      x.lineWidth = 1.1;
      x.shadowBlur = 6;
      x.shadowColor = col;
      x.stroke(p);
      x.shadowBlur = 0;
    } else wvTrace(x, p, cl, 1.1, 0.6);
    x.restore();
    x.strokeStyle = cl.track;
    x.lineWidth = 1;
    x.beginPath(); x.moveTo(X, h / 2); x.lineTo(w - 6, h / 2); x.stroke();
    const m = wvModOf(ch.lv);
    if (m.rng) {
      const a0 = wvClamp(v - m.rng), a1 = wvClamp(v + m.rng);
      x.fillStyle = m.col || cl.mod;
      x.fillRect(6 + (w - 12) * a0, h - 3, (w - 12) * (a1 - a0), 2);
      if (m.live != null) wvDot(x, 6 + (w - 12) * wvClamp(m.live), h - 2, 2, m.col || cl.acc);
    }
    x.fillStyle = cl.t;
    x.beginPath(); x.roundRect(X - 2, 2, 4, h - 4, 2); x.fill();
    x.font = `10px ${cl.mono}`;
    x.textAlign = 'right';
    x.fillStyle = cl.t2;
    x.fillText(wvDbTxt(v), W0 - 6, h / 2 + 3.5);
    x.textAlign = 'left';
    x.globalAlpha = 1;
  });
}

// ─────────────────────────────────────────────────────────────── drawing

/// The voices the engine says are sounding.
const wvVoices = () => (WV.tele && Array.isArray(WV.tele.voices) ? WV.tele.voices : []);

/// An oscillator's frame position now: the engine's, if it has said.
function wvPosNow(i) {
  const T = WV.tele;
  if (T && Array.isArray(T.pos) && typeof T.pos[i] === 'number') return wvClamp(T.pos[i]);
  return wvClamp(wvLiveOr(`osc${i}.pos`));
}

/// The cycle an oscillator is playing: its frame, warped twice, and — unless
/// `dry` — through its own effect. FM on A and C takes B; on B it takes A.
function wvWaveFor(i, dry) {
  const k = `osc${i}.`;
  let f = wvFrameAt(wvTable(wvG(k + 'table')), wvPosNow(i));
  const o = i === 1 ? 0 : 1;
  const B = wvFrameAt(wvTable(wvG(`osc${o}.table`)), wvPosNow(o));
  for (const j of [0, 1]) f = wvWarp(f, wvG(`${k}warp${j}.mode`), wvClamp(wvLiveOr(`${k}warp${j}.amt`)), B);
  return dry ? f : wvOfxShape(f, wvG(k + 'fx.mode'), wvLiveOr(k + 'fx.a'), wvG(k + 'fx.b'));
}

function wvDraw3D(g, T, p, warp0, t, opt = {}, voices) {
  const { c, w, h } = g, cl = wvCl();
  c.clearRect(0, 0, w, h);
  const n = Math.min(T.length, opt.n || 28), depth = opt.depth || 0.26, rise = opt.rise || 0.5, cf = p * (n - 1);
  const sx = w * (0.98 - depth) - 12, amp = h * 0.15;
  for (let i = n - 1; i >= 0; i--) {
    const d = i / (n - 1);
    const a = wvWarp(T[Math.round(d * (T.length - 1))], warp0[0], warp0[1]);
    const x0 = 8 + d * w * depth, y0 = h * 0.78 - d * h * rise;
    const pts = wvPath((u) => [x0 + u * sx, y0 - wvRd(a, u) * amp], 70);
    const hue = 205 - 175 * d;
    const f = new Path2D(pts);
    f.lineTo(x0 + sx, y0); f.lineTo(x0, y0); f.closePath();
    c.fillStyle = `hsla(${hue},70%,55%,${Math.abs(i - cf) < 1 ? 0.22 : 0.05})`;
    c.fill(f);
    c.strokeStyle = `hsla(${hue},80%,72%,${0.2 + 0.45 * (1 - d)})`;
    c.lineWidth = 1;
    c.stroke(pts);
  }
  const a = wvWarp(wvFrameAt(T, p), warp0[0], warp0[1]);
  const x0 = 8 + p * w * depth, y0 = h * 0.78 - p * h * rise;
  const pts = wvPath((u) => [x0 + u * sx, y0 - wvRd(a, u) * amp], 160);
  if (opt.floor) {
    const yb = h * 0.8;
    c.save();
    c.globalAlpha = 0.18;
    c.strokeStyle = `rgba(${cl.bloom},1)`;
    c.lineWidth = 1.2;
    c.stroke(wvPath((u) => { const y = y0 - wvRd(a, u) * amp; return [x0 + u * sx, yb + Math.max(0, yb - y) * 0.32]; }, 120));
    c.restore();
    const fg = c.createLinearGradient(0, yb, 0, h);
    fg.addColorStop(0, `rgba(${cl.bloom},.05)`);
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fg;
    c.fillRect(0, yb, w, h - yb);
  }
  wvUnder(c, pts, x0, x0 + sx, y0, y0 - amp, cl, 0.2);
  wvTrace(c, pts, cl, 1.6);
  wvDot(c, x0 - 4, y0, 2.6, cl.acc);
  // A dot for every voice the engine has sounding, running round the cycle at
  // its own pitch.
  if (voices) {
    for (const v of voices) {
      const ph = (t * Math.pow(2, ((+v.note || 60) - 60) / 12) * 0.7) % 1;
      c.globalAlpha = wvStage(v) === 'r' ? 0.4 : 1;
      wvDot(c, x0 + ph * sx, y0 - wvRd(a, ph) * amp, 2.8, cl.acc);
      c.globalAlpha = 1;
    }
  }
}

const wvSpecCache = new Map();
function wvSpecOf(T, name, warp0, i) {
  const key = `${name}|${warp0[0]}|${warp0[1].toFixed(2)}|${i}`;
  let v = wvSpecCache.get(key);
  if (!v) {
    v = wvMags(wvSpectrum(wvWarp(T[i], warp0[0], warp0[1]), 40));
    wvSpecCache.set(key, v);
    if (wvSpecCache.size > 3000) wvSpecCache.clear();
  }
  return v;
}

/// Each frame's spectrum as a ridge through its harmonic peaks, low harmonics
/// left, in the same perspective as the waves.
function wvDrawSpec3D(g, T, name, p, warp0, opt = {}) {
  const { c, w, h } = g, cl = wvCl();
  c.clearRect(0, 0, w, h);
  const n = 26, depth = opt.depth || 0.26, rise = opt.rise || 0.5, K = 40;
  const db = (v) => wvClamp((20 * Math.log10(Math.max(v, 1e-5)) + 54) / 54);
  const ridge = (m, x0, y0, sx, hh) => wvPath((u) => {
    const kf = Math.pow(K, u) - 1, k0 = Math.floor(kf), k1 = Math.min(K - 1, k0 + 1), f = kf - k0;
    return [x0 + u * sx, y0 - (db(m[k0]) * (1 - f) + db(m[k1]) * f) * hh];
  }, 90);
  const sx = w * (0.98 - depth) - 12, hh = h * 0.34;
  for (let r = n - 1; r >= 0; r--) {
    const d = r / (n - 1), fi = Math.round(d * (T.length - 1)), m = wvSpecOf(T, name, warp0, fi);
    const x0 = 8 + d * w * depth, y0 = h * 0.8 - d * h * rise, hue = 205 - 175 * d;
    const pts = ridge(m, x0, y0, sx, hh), f = new Path2D(pts);
    f.lineTo(x0 + sx, y0); f.lineTo(x0, y0); f.closePath();
    c.fillStyle = `hsla(${hue},70%,55%,.05)`;
    c.fill(f);
    c.strokeStyle = `hsla(${hue},80%,72%,${0.2 + 0.45 * (1 - d)})`;
    c.lineWidth = 1;
    c.stroke(pts);
  }
  const fi = Math.round(p * (T.length - 1)), m = wvSpecOf(T, name, warp0, fi);
  const x0 = 8 + p * w * depth, y0 = h * 0.8 - p * h * rise, pts = ridge(m, x0, y0, sx, hh);
  wvUnder(c, pts, x0, x0 + sx, y0, y0 - hh, cl, 0.2);
  wvTrace(c, pts, cl, 1.6);
  wvDot(c, x0 - 4, y0, 2.6, cl.acc);
  c.font = `9px ${cl.mono}`;
  c.fillStyle = cl.t3;
  c.fillText('SPECTRUM', 8, 13);
  c.textAlign = 'right';
  c.fillText('low → high', w - 8, 13);
  c.textAlign = 'left';
}

function wvDrawStrip(g, T, p, m, n = 24) {
  const { c, w, h } = g, cl = wvClFor(m), rng = m ? m.rng : 0;
  c.clearRect(0, 0, w, h);
  const pad = 6, cw = (w - pad * 2) / n;
  for (let i = 0; i < n; i++) {
    const f = T[Math.round(i / (n - 1) * (T.length - 1))], x = pad + i * cw, on = Math.abs(i / (n - 1) - p) < 0.5 / (n - 1);
    c.strokeStyle = on ? cl.wave : `rgba(${cl.bloom},.3)`;
    c.lineWidth = on ? 1.3 : 1;
    c.stroke(wvPath((u) => [x + 2 + u * (cw - 4), h / 2 + 2 - wvRd(f, u) * (h * 0.3)], 18));
  }
  if (rng) {
    const a = pad + wvClamp(p - rng) * (w - pad * 2), b = pad + wvClamp(p + rng) * (w - pad * 2);
    c.strokeStyle = cl.mod;
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(a, 5); c.lineTo(a, 2); c.lineTo(b, 2); c.lineTo(b, 5); c.stroke();
  }
  const x = pad + p * (w - pad * 2);
  c.fillStyle = cl.acc;
  c.shadowBlur = 8;
  c.shadowColor = cl.acc;
  c.fillRect(x - 1, 3, 2, h - 6);
  c.shadowBlur = 0;
}

/// A warp knob's face: the ring, and the warped wave over the plain one. An
/// empty slot is a dashed circle and a plus.
function wvDrawFace(g, v, wave, ghost, o = {}) {
  const { c, w, h } = g, cl = wvCl(), cx = w / 2, cy = h / 2;
  c.clearRect(0, 0, w, h);
  if (o.empty) {
    c.setLineDash([3, 4]);
    c.strokeStyle = cl.t3;
    c.lineWidth = 1.2;
    c.beginPath(); c.arc(cx, cy, w / 2 - 6, 0, WV_TAU); c.stroke();
    c.setLineDash([]);
    c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(cx - 7, cy); c.lineTo(cx + 7, cy); c.moveTo(cx, cy - 7); c.lineTo(cx, cy + 7); c.stroke();
    return;
  }
  wvRing(g, v, { cl: o.col ? { ...cl, mod: o.col } : cl, mod: o.mod, live: o.live, inset: 4 });
  const r = w * 0.31;
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, WV_TAU); c.clip();
  if (ghost) {
    c.strokeStyle = `rgba(${cl.bloom},.18)`;
    c.lineWidth = 1;
    c.stroke(wvPath((u) => [cx - r * 0.8 + u * r * 1.6, cy - wvRd(ghost, u) * r * 0.45], 70));
  }
  wvTrace(c, wvPath((u) => [cx - r * 0.8 + u * r * 1.6, cy - wvRd(wave, u) * r * 0.45], 110), cl, 1.4, 0.8);
  c.restore();
}

/// A plain knob, with its modulation when it has any.
function wvDrawKnob(id, key, bip) {
  const k = WVW[id];
  if (!k) return;
  const { c, w, h } = k;
  const v = wvG(key);
  c.clearRect(0, 0, w, h);
  k.el.previousElementSibling?.style.setProperty('--v', (bip ? Math.abs(v - 0.5) * 2 : v).toFixed(3));
  const m = wvModOf(key);
  wvRing(k, v, { cl: wvClFor(m), bip, pointer: 1, mod: m.rng, live: m.live, inset: 4 });
}

function wvDrawUniFace(g, cur, n, det, spr) {
  const { c, w, h } = g, cl = wvCl(), cx = w / 2, cy = h / 2, r = w * 0.3;
  c.clearRect(0, 0, w, h);
  const m = wvModOf(g.el.dataset.tgt);
  wvRing(g, det, { cl: wvClFor(m), inset: 4, mod: m.rng, live: m.live });
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, WV_TAU); c.clip();
  for (let i = 0; i < n; i++) {
    const off = n > 1 ? i / (n - 1) * 2 - 1 : 0, y = cy - off * det * r * 0.9;
    const side = n > 1 ? (i % 2 ? 1 : -1) * Math.abs(off) : 0;
    const x0 = cx - r * 0.85 + side * spr * r * 0.35, len = r * 1.7, hue = 205 - 175 * (off + 1) / 2;
    const p = wvPath((q) => [x0 + q * len, y - wvRd(cur, q * 2) * r * 0.16], 50);
    if (off === 0 || n === 1) wvTrace(c, p, cl, 1.1, 0.5);
    else { c.strokeStyle = `hsla(${hue},70%,70%,.7)`; c.lineWidth = 1; c.stroke(p); }
  }
  c.restore();
  c.font = `600 9px ${cl.mono}`;
  c.fillStyle = cl.t2;
  c.textAlign = 'center';
  c.fillText(String(n), cx, h - 3);
  c.textAlign = 'left';
}

/// The glide's bar: its curve, drawn as far as the glide goes. (The sub and the
/// noise draw on the MIX row now.)
function wvDrawHBar(g, v) {
  const { c, w, h } = g, cl = wvCl(), x = 6 + (w - 12) * v;
  c.clearRect(0, 0, w, h);
  c.save();
  c.beginPath(); c.rect(6, 3, x - 6, h - 6); c.clip();
  const p = new Path2D();
  for (let i = 0; i <= 60; i++) {
    const xx = 6 + i / 60 * (w - 12), u = i / 60, yy = h - 5 - (h - 10) * (1 - Math.exp(-u * 5 / (v * 3 + 0.05)));
    if (i) p.lineTo(xx, yy); else p.moveTo(xx, yy);
  }
  wvTrace(c, p, cl, 1.1, 0.6);
  c.restore();
  c.strokeStyle = cl.track;
  c.lineWidth = 1;
  c.beginPath(); c.moveTo(x, 3); c.lineTo(w - 6, 3); c.stroke();
  c.fillStyle = cl.t;
  c.beginPath(); c.roundRect(x - 2, 2, 4, h - 4, 2); c.fill();
  const m = wvModOf(g.el.dataset.tgt || '');
  if (m.rng) {
    c.fillStyle = m.col || cl.mod;
    c.fillRect(6 + (w - 12) * wvClamp(v - m.rng), h - 3, (w - 12) * (wvClamp(v + m.rng) - wvClamp(v - m.rng)), 2);
    if (m.live != null) wvDot(c, 6 + (w - 12) * wvClamp(m.live), h - 2, 2, cl.acc);
  }
}

/// The pitch ladder: a rung per semitone, octaves long and numbered, the
/// fine offset sliding the whole ladder.
function wvDrawLadder(g, semi, cents, m) {
  const { c, w, h } = g, cl = wvCl(), step = 7, cy = h / 2 - (cents / 100) * step;
  c.clearRect(0, 0, w, h);
  for (let k = -12; k <= 12; k++) {
    const v = semi + k, y = cy - k * step;
    if (y < 4 || y > h - 4) continue;
    const oct = v % 12 === 0, lw = oct ? w - 14 : [2, 4, 7, 9, 11].includes(((v % 12) + 12) % 12) ? 10 : 16;
    c.fillStyle = oct ? cl.t2 : 'rgba(255,255,255,.18)';
    c.fillRect(w / 2 - lw / 2, y - 0.5, lw, 1);
    if (oct) {
      c.font = `9px ${cl.mono}`;
      c.fillStyle = cl.t3;
      c.fillText((v > 0 ? '+' : '') + v / 12, 2, y - 2);
    }
  }
  if (m && m.rng) {
    c.fillStyle = `color-mix(in srgb,${m.col || cl.mod} 30%,transparent)`;
    c.fillRect(w - 5, h / 2 - m.rng * 48 * step, 2, m.rng * 96 * step);
  }
  c.fillStyle = cl.acc;
  c.shadowBlur = 8;
  c.shadowColor = cl.acc;
  c.fillRect(6, h / 2 - 1, w - 12, 2);
  c.shadowBlur = 0;
}

const wvCutHz = (v) => 20 * Math.pow(1000, v);
const wvFmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz');
const wvFmtMs = (s) => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s');

/// A filter's lens: its response over the harmonics of the wave going in.
function wvDrawLens(g, cur, i) {
  const { c, w, h } = g, cl = wvCl(), f = `filt${i}.`;
  c.clearRect(0, 0, w, h);
  const fx = (fr) => 6 + (Math.log10(fr) - Math.log10(20)) / 3 * (w - 12);
  const cut = wvClamp(wvLiveOr(f + 'cut')), fc = wvCutHz(cut), Q = 0.7 + wvG(f + 'res') * 9, type = wvG(f + 'type');
  const Hm = (fr) => {
    const x = fr / fc;
    switch (type) {
      case 'hp': return x * x / Math.sqrt((1 - x * x) ** 2 + (x / Q) ** 2);
      case 'bp': return (x / Q) / Math.sqrt((1 - x * x) ** 2 + (x / Q) ** 2) * Q * 0.6;
      case 'notch': return Math.abs(1 - x * x) / Math.sqrt((1 - x * x) ** 2 + (x / Q) ** 2);
      case 'comb': return 0.55 + 0.45 * Math.cos(WV_TAU * fr / fc);
      case 'form': return 0.2 + Math.exp(-((Math.log2(fr / fc) / 0.25) ** 2)) + 0.7 * Math.exp(-((Math.log2(fr / (fc * 2.3)) / 0.25) ** 2));
      default: return 1 / Math.sqrt((1 - x * x) ** 2 + (x / Q) ** 2);
    }
  };
  const dbY = (db) => h * 0.58 - db * 1.4;
  c.strokeStyle = 'rgba(255,255,255,.05)';
  for (const fr of [100, 1000, 10000]) { c.beginPath(); c.moveTo(fx(fr), 3); c.lineTo(fx(fr), h - 3); c.stroke(); }
  const m = wvMags(wvSpectrum(cur));
  for (let k = 0; k < 48; k++) {
    const fr = 110 * (k + 1);
    if (fr > 20000) break;
    const a = m[k];
    if (a < 0.003) continue;
    const db = 20 * Math.log10(a), x = fx(fr);
    const hh = wvClamp((db + 48) / 48) * h * 0.55, fh = wvClamp((db + 20 * Math.log10(Hm(fr)) + 48) / 48) * h * 0.55;
    c.fillStyle = `rgba(${cl.bloom},.12)`;
    c.fillRect(x - 1, h - 3 - hh, 2, hh);
    c.fillStyle = `rgba(${cl.bloom},.7)`;
    c.fillRect(x - 1, h - 3 - fh, 2, fh);
  }
  const mc = wvModOf(f + 'cut'), r = mc.rng;
  if (r) {
    const base = wvG(f + 'cut');
    c.fillStyle = `color-mix(in srgb,${mc.col || cl.mod} 14%,transparent)`;
    c.fillRect(fx(wvCutHz(wvClamp(base - r))), 3, fx(wvCutHz(wvClamp(base + r))) - fx(wvCutHz(wvClamp(base - r))), h - 6);
  }
  const pts = wvPath((u) => { const fr = 20 * Math.pow(1000, u); return [fx(fr), wvClamp(dbY(20 * Math.log10(Hm(fr) + 1e-6)), 3, h - 3)]; }, 140);
  wvUnder(c, pts, 6, w - 6, h, 0, cl, 0.14);
  wvTrace(c, pts, cl, 1.5);
  wvDot(c, fx(fc), wvClamp(dbY(20 * Math.log10(Hm(fc) + 1e-6)), 5, h - 5), 3.5, cl.acc);
  c.font = `10px ${cl.mono}`;
  c.fillStyle = cl.t2;
  c.textAlign = 'right';
  c.fillText(`${wvFmtHz(fc)} · Q ${Q.toFixed(1)}`, w - 8, 14);
  c.textAlign = 'left';
}

function wvEnvPts(g, E) {
  const { w, h } = g, x0 = 8, W = w - 16, top = 8, bot = h - 8;
  const ta = Math.sqrt(E.a) * 0.22 * W, td = Math.sqrt(E.d) * 0.26 * W, hold = 0.16 * W, tr = Math.sqrt(E.r) * 0.36 * W, sy = bot - (bot - top) * E.s;
  return { o: [x0, bot], a: [x0 + ta, top], d: [x0 + ta + td, sy], s: [x0 + ta + td + hold, sy], r: [x0 + ta + td + hold + tr, bot] };
}

/// A voice's stage as one letter, whatever form the engine sends it in.
function wvStage(v) {
  if (typeof v.stage === 'number') return ['a', 'd', 's', 'r'][v.stage] || 's';
  return String(v.stage || 's').toLowerCase()[0];
}

/// Where a voice sits on a drawn envelope, from the engine's stage and level.
function wvEnvDot(P, E, v) {
  const lvl = wvClamp(+v.env || 0), st = wvStage(v), lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  if (st === 'a') return lerp(P.o, P.a, lvl);
  if (st === 'd') return lerp(P.a, P.d, E.s < 1 ? wvClamp((1 - lvl) / (1 - E.s)) : 1);
  if (st === 'r') return lerp(P.s, P.r, E.s > 0 ? wvClamp(1 - lvl / E.s) : 1);
  return [(P.d[0] + P.s[0]) / 2, P.s[1]];
}

function wvDrawEnv(g, E, voices) {
  const { c, w, h } = g, cl = wvCl(), P = wvEnvPts(g, E);
  c.clearRect(0, 0, w, h);
  const p = new Path2D();
  p.moveTo(...P.o);
  p.quadraticCurveTo(P.o[0] + (P.a[0] - P.o[0]) * 0.35, P.a[1] + (P.o[1] - P.a[1]) * 0.25, ...P.a);
  p.quadraticCurveTo(P.a[0] + (P.d[0] - P.a[0]) * 0.15, P.d[1], ...P.d);
  p.lineTo(...P.s);
  p.quadraticCurveTo(P.s[0] + (P.r[0] - P.s[0]) * 0.15, P.r[1], ...P.r);
  wvUnder(c, p, P.o[0], P.r[0], h, 0, cl, 0.18);
  wvTrace(c, p, cl, 1.5);
  for (const k of ['a', 'd', 'r']) { c.fillStyle = cl.t; c.beginPath(); c.arc(...P[k], 3, 0, WV_TAU); c.fill(); }
  for (const v of voices) { const d = wvEnvDot(P, E, v); wvDot(c, d[0], d[1], 3, cl.acc); }
  return P;
}

/// The LFO editor: its shape, the points when it is Drawn, and the engine's
/// phase on it.
function wvDrawLfo(g, L) {
  const { c, w, h } = g, cl = wvCl(), pts = wvG(`lfo${L}.points`), drawn = wvLfoShape(L) === 'drawn';
  const px = (q) => 8 + q[0] * (w - 16), py = (q) => 8 + (1 - q[1]) * (h - 16);
  c.clearRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,.05)';
  for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(8 + i * (w - 16) / 8, 6); c.lineTo(8 + i * (w - 16) / 8, h - 6); c.stroke(); }
  c.beginPath(); c.moveTo(8, h / 2); c.lineTo(w - 8, h / 2); c.stroke();
  const p = wvPath((u) => [8 + u * (w - 16), py([0, wvLfoVal(L, u)])], 160);
  wvUnder(c, p, 8, w - 8, h, 0, cl, 0.16);
  wvTrace(c, p, cl, 1.5);
  if (drawn) for (const q of pts) { c.fillStyle = cl.t; c.beginPath(); c.arc(px(q), py(q), 3, 0, WV_TAU); c.fill(); }
  const ph = wvLfoPhase(L);
  if (ph != null) {
    c.strokeStyle = `color-mix(in srgb,${cl.acc} 50%,transparent)`;
    c.beginPath(); c.moveTo(8 + ph * (w - 16), 6); c.lineTo(8 + ph * (w - 16), h - 6); c.stroke();
    wvDot(c, 8 + ph * (w - 16), py([0, wvLfoVal(L, ph)]), 3.4, cl.acc);
  }
}

function wvLfoPhase(L) {
  const T = WV.tele;
  if (!T || !Array.isArray(T.lfo) || typeof T.lfo[L] !== 'number') return null;
  return ((T.lfo[L] % 1) + 1) % 1;
}

function wvDrawMini(g, s) {
  const { c, w, h } = g, cl = wvCl();
  c.clearRect(0, 0, w, h);
  let p;
  if (s.kind === 'lfo') p = wvPath((u) => [1 + u * (w - 2), h - 2 - wvLfoVal(+s.key.slice(3), u) * (h - 4)], 40);
  else {
    const E = wvEnv(s.key);
    p = new Path2D();
    p.moveTo(1, h - 1); p.lineTo(2 + E.a * 8, 1); p.lineTo(6 + E.a * 8 + E.d * 10, h - 1 - E.s * (h - 2));
    p.lineTo(w - 6, h - 1 - E.s * (h - 2)); p.lineTo(w - 1, h - 1);
  }
  c.strokeStyle = WV_SRC_COL[s.key] || cl.wave;
  c.lineWidth = 1.3;
  c.stroke(p);
}

/// The voices panel: sixteen cells, one per sounding voice, filled to its level.
function wvDrawVox(g) {
  const { c, w, h } = g, cl = wvCl(), vs = wvVoices();
  c.clearRect(0, 0, w, h);
  const cw = (w - 10) / 4, ch = (h - 10) / 4;
  for (let i = 0; i < 16; i++) {
    const x = 5 + (i % 4) * cw, y = 5 + Math.floor(i / 4) * ch, v = vs[i];
    c.fillStyle = 'rgba(255,255,255,.035)';
    c.beginPath(); c.roundRect(x + 1, y + 1, cw - 2, ch - 2, 3); c.fill();
    if (!v) continue;
    const lvl = wvClamp(+v.env || 0);
    c.fillStyle = `color-mix(in srgb,${cl.acc} ${Math.round(18 + 60 * lvl)}%,transparent)`;
    c.beginPath(); c.roundRect(x + 1, y + 1 + (ch - 2) * (1 - lvl), cw - 2, (ch - 2) * lvl, 3); c.fill();
    c.fillStyle = cl.t;
    c.font = `9px ${cl.mono}`;
    c.fillText(wvNoteName(+v.note), x + 4, y + ch / 2 + 3);
  }
}

const wvNoteName = (n) => ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

function wvDrawPlay(t) {
  const cl = wvCl(), vs = wvVoices(), curs = [];
  for (let i = 0; i < 3; i++) {
    const k = `osc${i}.`, name = wvG(k + 'table'), T = wvTable(name), p = wvPosNow(i);
    const cur = wvWaveFor(i), warp0 = [wvG(k + 'warp0.mode'), wvClamp(wvLiveOr(k + 'warp0.amt'))], tilt = WV.tilt[i];
    const opt = { rise: 0.3 + 0.38 * tilt, depth: 0.18 + 0.14 * tilt, floor: 1 };
    if (WV.face[i] === 's') wvDrawSpec3D(WVW['wvW3d' + i], T, name, p, warp0, opt);
    else wvDrawW3d(i, T, p, warp0, t, opt, wvG(k + 'on') ? vs : null);
    curs.push(cur);
    wvDrawStrip(WVW['wvSt' + i], T, p, wvModOf(k + 'pos'));
    const o = i === 1 ? 0 : 1, B = wvFrameAt(wvTable(wvG(`osc${o}.table`)), wvPosNow(o));
    [0, 1].forEach((j) => {
      const key = `${k}warp${j}.amt`, m = wvModOf(key), f = wvFrameAt(T, p), mode = wvG(`${k}warp${j}.mode`);
      const amt = wvClamp(m.live != null ? m.live : wvG(key));
      wvDrawFace(WVW[`wvWp${i}${j}`], wvG(key), wvWarp(f, mode, amt, B), f, { col: m.col, mod: m.rng, live: m.live, empty: mode === 'off' });
      wvTxt(`wvWv${i}${j}`, mode === 'off' ? '—' : Math.round(wvG(key) * 100) + ' %');
    });
    wvDrawUniFace(WVW['wvUn' + i], cur, wvG(k + 'uni.n'), wvG(k + 'uni.det'), wvG(k + 'uni.spr'));
    wvTxt('wvUr' + i, `${wvG(k + 'uni.n')} v · ${Math.round(wvG(k + 'uni.det') * 60)} ct`);
    wvDrawOfx(WVW['wvOfx' + i], i, t);
    const semi = Math.round((wvG(k + 'pitch') - 0.5) * 48), cents = Math.round((wvG(k + 'fine') - 0.5) * 200);
    wvDrawLadder(WVW['wvPt' + i], semi, cents, wvModOf(k + 'pitch'));
    wvTxt('wvPtr' + i, (semi >= 0 ? '+' : '−') + Math.abs(semi) + (cents ? ` ${cents > 0 ? '+' : '−'}${Math.abs(cents)}c` : ' st'));
    {
      const g = WVW['wvPh' + i], { c, w, h } = g, ph = wvG(k + 'phase');
      c.clearRect(0, 0, w, h);
      wvRing(g, ph, { cl, inset: 3 });
      const cx = w / 2, cy = h / 2, r = w * 0.27;
      wvTrace(c, wvPath((u) => { const a = u * WV_TAU - Math.PI / 2 + ph * WV_TAU, rr = r * 0.6 + wvRd(cur, u) * r * 0.32; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; }, 70), cl, 1, 0.5);
      const a = -Math.PI / 2 + ph * WV_TAU;
      c.strokeStyle = cl.acc;
      c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3); c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.stroke();
      wvTxt('wvPhr' + i, Math.round(ph * 360) + '°');
    }
    wvDrawKnob('wvPn' + i, k + 'pan', 1);
    const pn = Math.round((wvG(k + 'pan') - 0.5) * 200);
    wvTxt('wvPnr' + i, pn === 0 ? 'C' : (pn < 0 ? 'L' : 'R') + Math.abs(pn));
    wvTxt('wvFr' + i, `${String(Math.round(p * (T.length - 1)) + 1).padStart(2, '0')} / ${T.length}`);
    const pk = WVW['wvPk' + i];
    pk.c.clearRect(0, 0, pk.w, pk.h);
    pk.c.strokeStyle = cl.wave;
    pk.c.lineWidth = 1.2;
    pk.c.stroke(wvPath((u) => [1 + u * (pk.w - 2), pk.h / 2 - wvRd(wvFrameAt(T, u), (u * 3) % 1) * (pk.h * 0.4)], 60));
  }
  const mix = curs[0];
  wvDrawMix(t, curs);
  wvDrawHBar(WVW.wvGlide, wvG('voice.glide'));
  [0, 1].forEach((i) => {
    wvDrawLens(WVW['wvLens' + i], mix, i);
    wvDrawKnob('wvDr' + i, `filt${i}.drive`, 0);
    wvTxt('wvDrr' + i, Math.round(wvG(`filt${i}.drive`) * 100) + ' %');
    wvDrawKnob('wvKy' + i, `filt${i}.key`, 0);
    wvTxt('wvKyr' + i, Math.round(wvG(`filt${i}.key`) * 100) + ' %');
  });
  const E = wvEnv('amp'), ap = wvDrawEnv(WVW.wvAmp, E, vs);
  {
    const c = WVW.wvAmp.c;
    c.font = `10px ${cl.mono}`;
    c.fillStyle = cl.t2;
    c.textAlign = 'center';
    const L = [[ap.o, ap.a, wvFmtMs(E.a ** 2 * 4)], [ap.a, ap.d, wvFmtMs(E.d ** 2 * 4)], [ap.d, ap.s, Math.round(E.s * 100) + ' %'], [ap.s, ap.r, wvFmtMs(E.r ** 2 * 6)]];
    for (const [a, b, l] of L) {
      if (b[0] - a[0] <= 30) continue;
      const y = Math.min(a[1], b[1]) - 5 < 10 ? Math.max(a[1], b[1]) + 14 : Math.min(a[1], b[1]) - 5;
      c.fillText(l, (a[0] + b[0]) / 2, y);
    }
    c.textAlign = 'left';
  }
  wvTxt('wvAmpRo', `${wvFmtMs(E.a ** 2 * 4)} · ${wvFmtMs(E.d ** 2 * 4)} · ${Math.round(E.s * 100)} % · ${wvFmtMs(E.r ** 2 * 6)}`);
  wvDrawVox(WVW.wvVox);

  const s = WV_SOURCES[WV.sel];
  if (s.kind === 'lfo') wvDrawLfo(WVW.wvSrcEd, +s.key.slice(3));
  else wvDrawEnv(WVW.wvSrcEd, wvEnv(s.key), vs);
  const L = s.kind === 'lfo' ? s.key : 'lfo0';
  wvDrawKnob('wvSrcRate', `${L}.rate`, 0);
  wvDrawKnob('wvSrcSmooth', `${L}.smooth`, 0);
  wvDrawKnob('wvSrcRise', `${L}.rise`, 0);
  wvTxt('wvSrcRateRo', s.kind === 'lfo' ? wvLfoRateTxt(+L.slice(3)) : '—');
  if (s.kind === 'lfo') wvTxt('wvTempoRo', `${wvTempo()} BPM`);
  wvTxt('wvSrcSmoothRo', s.kind === 'lfo' ? Math.round(wvG(`${L}.smooth`) * 100) + ' %' : '—');
  wvTxt('wvSrcRiseRo', s.kind === 'lfo' ? wvFmtMs(wvG(`${L}.rise`) ** 2 * 4) : '—');
  WV_SOURCES.forEach((x, i) => {
    const g = WVW['wvT4c' + i];
    wvDrawMini(g, x);
    if (x.kind === 'lfo') {
      const ph = wvLfoPhase(+x.key.slice(3));
      if (ph != null) wvDot(g.c, 1 + ph * (g.w - 2), g.h - 2 - wvLfoVal(+x.key.slice(3), ph) * (g.h - 4), 1.8, cl.acc);
    }
    const used = WV.mods.some((m) => m.src === x.key);
    document.querySelector(`#wvSrcTabs [data-src="${i}"] .act`).style.setProperty('--o', used ? 0.3 + 0.7 * Math.abs(wvSrcVal(x.key)) : 0);
  });
}

function wvDrawW3d(i, T, p, warp0, t, opt, voices) {
  wvDraw3D(WVW['wvW3d' + i], T, p, warp0, t, opt, voices);
}

/// An oscillator's effect screen: what it does to this wave, in its own hue.
function wvDrawOfx(g, i, t) {
  const { c, w, h } = g, cl = wvCl(), k = `osc${i}.`, K = WV_OFX[wvG(k + 'fx.mode')] ? wvG(k + 'fx.mode') : 'off';
  const dry = wvWaveFor(i, true), a = wvClamp(wvLiveOr(k + 'fx.a')), b = wvG(k + 'fx.b');
  c.clearRect(0, 0, w, h);
  const bg = c.createRadialGradient(w * 0.25, h * 0.1, 4, w * 0.5, h * 0.5, w * 0.8);
  bg.addColorStop(0, wvFxCol(K, 45, 0.22));
  bg.addColorStop(1, wvFxCol(K, 30, 0));
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const X = (u) => 8 + u * (w - 16), Y = (v, s = 1) => h / 2 + 4 - v * h * 0.3 * s;
  const ghost = () => { c.strokeStyle = `rgba(${cl.bloom},.16)`; c.lineWidth = 1; c.stroke(wvPath((u) => [X(u), Y(wvRd(dry, u * 2))], 120)); };
  let rd = '';
  switch (K) {
    case 'chorus': {
      ghost();
      for (let v = 0; v < 3; v++) {
        const off = Math.sin(t * (0.4 + b * 3) + v * 2.1) * a * 0.06;
        c.globalAlpha = v ? 0.55 : 1;
        wvFxTrace(c, wvPath((u) => [X(u), Y(wvRd(dry, u * 2 + off), 0.9) + (v - 1) * a * 6], 120), K, 1.1);
        c.globalAlpha = 1;
      }
      rd = `${(0.1 + b * 4).toFixed(1)} Hz · ${Math.round(a * 100)} %`;
      break;
    }
    case 'delay': {
      const tm = 0.12 + b * 0.3, fb = 0.25 + a * 0.6;
      for (let r = 0; r < 5; r++) {
        const amp = Math.pow(fb, r);
        c.globalAlpha = amp;
        wvFxTrace(c, wvPath((u) => [X(r * tm + u * tm * 0.85), Y(wvRd(dry, u * 2), amp)], 40), K, 1.1);
        c.globalAlpha = 1;
      }
      rd = `${Math.round(60 + b * 440)} ms · ${Math.round(fb * 100)} %`;
      break;
    }
    case 'phaser': {
      ghost();
      const ph = t * (0.3 + b * 2);
      wvFxTrace(c, wvPath((u) => [X(u), Y(wvRd(dry, u * 2) * (1 - a * 0.6) + wvRd(dry, u * 2 + 0.12 * Math.sin(ph)) * a * 0.6)], 140), K, 1.4);
      rd = `${(0.1 + b * 2).toFixed(1)} Hz · ${Math.round(a * 100)} %`;
      break;
    }
    case 'off': {
      wvFxTrace(c, wvPath((u) => [X(u), Y(wvRd(dry, u * 2))], 120), K, 1.2);
      rd = '—';
      break;
    }
    default: {
      ghost();
      const wet = wvOfxShape(dry, K, a, b), p = wvPath((u) => [X(u), Y(wvRd(wet, u * 2))], K === 'crush' ? 400 : 160);
      const f = new Path2D(p);
      f.lineTo(w - 8, h / 2 + 4); f.lineTo(8, h / 2 + 4); f.closePath();
      const gr = c.createLinearGradient(0, 8, 0, h / 2 + 4);
      gr.addColorStop(0, wvFxCol(K, 60, 0.17));
      gr.addColorStop(1, wvFxCol(K, 60, 0));
      c.fillStyle = gr;
      c.fill(f);
      wvFxTrace(c, p, K, 1.4);
      rd = K === 'crush' ? `${Math.round(2 + (1 - b) * 6)} bit · ${Math.round(a * 100)} %`
        : K === 'drive' ? `×${(1 + b * 10).toFixed(1)} · ${Math.round(a * 100)} %`
          : K === 'ring' ? `×${1 + Math.round(b * 7)} · ${Math.round(a * 100)} %`
            : `${(2 + b * 10).toFixed(1)} · ${Math.round(a * 100)} %`;
    }
  }
  c.font = `9px ${cl.mono}`;
  c.fillStyle = cl.t3;
  c.fillText('mix →', 8, h - 6);
  c.textAlign = 'right';
  c.fillText((K === 'crush' ? 'grit' : K === 'delay' ? 'time' : K === 'drive' ? 'drive' : K === 'ring' || K === 'comb' ? 'tune' : 'rate') + ' ↕', w - 8, 13);
  c.textAlign = 'left';
  // The badge: the effect's glyph in its corner.
  c.fillStyle = 'rgba(0,0,0,.6)';
  c.strokeStyle = wvFxCol(K, 60, 0.5);
  c.lineWidth = 1;
  c.beginPath(); c.roundRect(4, 4, 32, 24, 6); c.fill(); c.stroke();
  wvFxIcon(c, K, 9, 7, 1.25, wvFxCol(K, 76));
  wvTxt('wvOfr' + i, rd);
  const nm = document.getElementById('wvOfn' + i);
  nm.style.color = wvFxCol(K, 76);
  nm.parentElement.style.setProperty('--fxc', wvFxCol(K, 72));
}

function wvFxIcon(c, k, x, y, sc, col) {
  const p = new Path2D((WV_OFX[k] || WV_OFX.off).g);
  c.save();
  c.translate(x, y);
  c.scale(sc, sc);
  c.strokeStyle = col;
  c.lineWidth = 1.7 / sc * 1.1;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.shadowBlur = 8;
  c.shadowColor = col;
  c.stroke(p);
  c.restore();
}

function wvFxTrace(c, p, k, lw = 1.5) {
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = wvFxCol(k, 60, 0.22);
  c.lineWidth = lw * 3.6;
  c.shadowBlur = 10;
  c.shadowColor = wvFxCol(k, 60, 0.5);
  c.stroke(p);
  c.shadowBlur = 0;
  c.strokeStyle = wvFxCol(k, 80);
  c.lineWidth = lw;
  c.stroke(p);
}
