// ================================================================ Wave: Play
//
// The Play view of the synth page: three oscillators, Sub and Noise, the two
// filters, the amp envelope, the modulators and the voicing. Every control is
// a picture of what it does to the sound, and each one writes one patch key
// (`docs/WAVE-SYNTH.md`). Built once, on the first visit.

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
   <div class="wv-mh"><i class="wv-led" data-oscled="${i}" title="Oscillator ${L} on or off"></i><span class="wv-nm">OSC ${L}</span>
    <span class="wv-pick wv-btn" data-pick="${i}" title="Choose this oscillator's table"><canvas id="wvPk${i}" data-w="30" data-h="14"></canvas><span id="wvPkName${i}"></span></span>
    <span class="wv-sp"></span>
    <span class="wv-chip wv-btn" data-route="${i}" title="Where it goes: click for Filter 1, Filter 2, both, or straight out">${wvIc('M1 5 H11 M8 2 L11 5 L8 8')}<span id="wvRoute${i}"></span></span>
    <span class="wv-seg" data-face="${i}" style="padding:1px"><span class="on" title="Waves" data-f="w">${wvIc('M1 7 C4 1,6 1,8 5 S12 9,15 3', 16, 10)}</span><span title="Spectrum" data-f="s">${wvIc('M2 9V2M5 9V4M8 9V3M11 9V6M14 9V7', 16, 10)}</span></span>
    <span class="wv-ro" id="wvFr${i}"></span></div>
   <div class="wv-body">
    <div class="wv-tbl"><div class="wv-well"><canvas id="wvW3d${i}" data-w="276" data-h="116" data-tgt="${k}pos" title="Drag across for the frame, up and down to tilt"></canvas></div>
     <div class="wv-well"><canvas id="wvSt${i}" data-w="276" data-h="24" title="Click or drag for the frame"></canvas></div></div>
    <div class="wv-warps">${warp(0)}${warp(1)}
     <div class="wv-warp">${wvKnobEl(`wvUn${i}`, 66, true, `${k}uni.det`)}<div class="wv-lab wv-col" style="align-items:center" title="Unison: drag for detune, Shift-drag for width, scroll for voices"><span>Unison</span><b id="wvUr${i}"></b></div></div></div>
    <div class="wv-cell wv-ofx"><div class="wv-well"><canvas id="wvOfx${i}" data-w="150" data-h="94" data-tgt="${k}fx.a" title="Drag across for mix, up and down for its character"></canvas></div>
     <div class="wv-lab"><div class="wv-g wv-btn on" data-ofx="${i}" title="Choose this oscillator's effect"><svg viewBox="0 0 18 14"><path d=""/></svg></div><span id="wvOfn${i}"></span><span class="wv-sp"></span><b id="wvOfr${i}"></b></div></div>
    <div class="wv-k4"><div class="wv-cell"><div class="wv-well"><canvas id="wvPt${i}" data-w="46" data-h="124" data-tgt="${k}pitch" title="Drag for semitones, Shift-drag for cents"></canvas></div><div class="wv-lab" style="justify-content:center"><b id="wvPtr${i}"></b></div></div>
     <div class="wv-kc"><div class="wv-cell c">${wvKnobEl(`wvPh${i}`, 40, 1, `${k}phase`)}<div class="wv-lab" title="Drag for the start phase, Alt-drag for its random spread"><span>Phase</span><b id="wvPhr${i}"></b></div></div>
      <div class="wv-cell c">${wvKnobEl(`wvPn${i}`, 40, 0, `${k}pan`)}<div class="wv-lab"><span>Pan</span><b id="wvPnr${i}"></b></div></div></div></div>
    <div class="wv-cell"><div class="wv-well"><canvas id="wvLv${i}" data-w="40" data-h="124" data-tgt="${k}level" title="Level"></canvas></div><div class="wv-lab" style="justify-content:center"><b id="wvLvr${i}"></b></div></div>
   </div></div>`);
}

function wvBuildPlay(view) {
  const colL = wvH('<div class="wv-colL"></div>');
  const colR = wvH('<div class="wv-colR"></div>');
  view.append(colL, colR);
  for (let i = 0; i < 3; i++) colL.appendChild(wvBuildOsc(i));
  colL.appendChild(wvH(`<div class="wv-subrow">
   <div class="wv-mod wv-panel"><i class="wv-led" data-sub title="Sub on or off"></i><span class="wv-nm">SUB</span>
    <div class="wv-glyphs" data-subshape>${wvGlyph('M2 7 C5 0,7 0,9 7 S13 14,16 7', 0, 'Sine', 'data-k="0"')}${wvGlyph('M2 7 L6 2 L12 12 L16 7', 0, 'Triangle', 'data-k="1"')}${wvGlyph('M2 3 H9 V11 H16', 0, 'Square', 'data-k="2"')}</div>
    <div class="wv-seg" data-suboct><span data-k="2" title="Two octaves down">${wvIc('M2 2 V8 M5 5 L2 8 L-1 5 M9 2 V8 M12 5 L9 8 L6 5', 13, 10)}−2</span><span data-k="1" title="One octave down">${wvIc('M5 1 V9 M8 6 L5 9 L2 6', 10, 10)}−1</span></div>
    <div class="wv-well"><canvas id="wvSubLv" data-w="150" data-h="26" data-tgt="sub.level" title="Sub level"></canvas></div></div>
   <div class="wv-mod wv-panel"><i class="wv-led" data-noise title="Noise on or off"></i><span class="wv-nm">NOISE</span>
    <div class="wv-glyphs" data-ncol>${wvGlyph('M2 4 H16', 0, 'White', 'data-k="0"')}${wvGlyph('M2 3 L16 9', 0, 'Pink', 'data-k="1"')}${wvGlyph('M2 2 L16 12', 0, 'Brown', 'data-k="2"')}</div>
    <div class="wv-well"><canvas id="wvNoiseLv" data-w="246" data-h="26" data-tgt="noise.level" title="Noise level"></canvas></div></div></div>`));

  colR.appendChild(wvH(`<div class="wv-mod wv-panel">
   <div class="wv-mh"><span class="wv-nm">FILTERS</span><span class="wv-sp"></span><div class="wv-seg" id="wvFroute"><span data-k="serial" title="Serial">1 → 2</span><span data-k="parallel" title="Parallel">1 ‖ 2</span><span data-k="split" title="Split: A to 1, B to 2">${wvIc('M1 5 H5 L9 1 H13 M5 5 L9 9 H13')}Split</span></div></div>
   <div class="wv-two" id="wvFilters"></div></div>`));
  const fl = colR.querySelector('#wvFilters');
  [0, 1].forEach((i) => fl.appendChild(wvH(`<div class="wv-fcol">
   <div class="wv-frow"><span class="wv-ro" style="color:var(--wv-t)">${i + 1}</span><div class="wv-glyphs" data-ftype="${i}">${WV_FILTERS.map(([k, d, t]) => wvGlyph(d, false, t, `data-k="${k}"`)).join('')}</div></div>
   <div class="wv-well"><canvas id="wvLens${i}" data-w="258" data-h="86" data-tgt="filt${i}.cut" title="Drag across for cutoff, up and down for resonance"></canvas></div>
   <div class="wv-frow" style="justify-content:space-between">
    <div class="wv-cell c" style="flex-direction:row;gap:4px">${wvKnobEl(`wvDr${i}`, 34, 0, `filt${i}.drive`)}<div class="wv-lab wv-col"><span>Drive</span><b id="wvDrr${i}"></b></div></div>
    <div class="wv-cell c" style="flex-direction:row;gap:4px">${wvKnobEl(`wvKy${i}`, 34, 0, `filt${i}.key`)}<div class="wv-lab wv-col"><span>Key</span><b id="wvKyr${i}"></b></div></div></div></div>`)));

  colR.appendChild(wvH(`<div class="wv-mod wv-panel">
   <div class="wv-mh"><span class="wv-nm">AMP</span><span class="wv-sp"></span><span class="wv-ro" id="wvAmpRo"></span></div>
   <div style="display:flex;gap:8px"><div class="wv-well"><canvas id="wvAmp" data-w="380" data-h="78" title="Drag a corner: attack, decay and sustain, release"></canvas></div><div class="wv-well" title="Voices sounding"><canvas id="wvVox" data-w="138" data-h="78"></canvas></div></div></div>`));

  colR.appendChild(wvH(`<div class="wv-mod wv-panel">
   <div class="wv-mh"><span class="wv-nm">MODULATE</span><span class="wv-sp"></span><span class="wv-hint">Drag a source onto any control</span></div>
   <div class="wv-tabs4" id="wvSrcTabs">${WV_SOURCES.map((s, i) => `<div class="wv-t4 wv-btn" data-src="${i}" title="${s.label}: click to edit, drag onto a control to map it"><i class="act"></i><canvas id="wvT4c${i}" data-w="40" data-h="14"></canvas><b>${s.label}</b></div>`).join('')}</div>
   <div class="wv-ed">
    <div class="wv-well"><canvas id="wvSrcEd" data-w="338" data-h="150" title="Drag the points; double-click to add one"></canvas></div>
    <div style="display:flex;flex-direction:column;gap:8px;width:178px" id="wvSrcSide">
     <div class="wv-seg" id="wvSrcMode"><span data-k="free" title="Free running">${wvIc('M1 5 C3 0,5 0,7 5 S11 10,13 5')}Free</span><span data-k="trig" title="Restarts on each note">${wvIc('M1 9 V1 M1 5 C4 0,6 0,8 5 S11 10,13 5')}Trig</span><span data-k="env" title="Runs once per note">${wvIc('M1 9 L4 1 L13 9')}Env</span></div>
     <div style="display:flex;gap:8px;justify-content:space-between">
      <div class="wv-cell c">${wvKnobEl('wvSrcRate', 46, 0)}<div class="wv-lab"><span>Rate</span><b id="wvSrcRateRo"></b></div></div>
      <div class="wv-cell c">${wvKnobEl('wvSrcSmooth', 46, 0)}<div class="wv-lab"><span>Smooth</span><b id="wvSrcSmoothRo"></b></div></div>
      <div class="wv-cell c">${wvKnobEl('wvSrcRise', 46, 0)}<div class="wv-lab"><span>Rise</span><b id="wvSrcRiseRo"></b></div></div></div></div></div>
   <div class="wv-targets" id="wvSrcTargets"></div></div>`));

  colR.appendChild(wvH(`<div class="wv-mod wv-panel wv-voicing">
   <span class="wv-nm">VOICE</span>
   <div class="wv-seg" id="wvVoiceMode"><span data-k="poly" title="Poly">${wvIc('M1 2 H13 M1 5 H13 M1 8 H13')}Poly</span><span data-k="mono" title="Mono">${wvIc('M1 5 H13')}Mono</span><span data-k="legato" title="Legato: notes glide into each other">${wvIc('M1 8 C4 1,10 1,13 8')}Legato</span></div>
   <div class="wv-well" title="Glide"><canvas id="wvGlide" data-w="96" data-h="26" data-tgt="voice.glide"></canvas></div>
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
    wvV('wvLv' + i, k + 'level', 90);
  }

  wvDrag(WVW.wvSubLv.el, (dx) => wvLive('sub.level', wvClamp(wvG('sub.level') + dx / 140)));
  wvDrag(WVW.wvNoiseLv.el, (dx) => wvLive('noise.level', wvClamp(wvG('noise.level') + dx / 180)));
  document.querySelector('[data-sub]').addEventListener('click', () => wvCommit('sub.on', wvG('sub.on') ? 0 : 1));
  document.querySelector('[data-noise]').addEventListener('click', () => wvCommit('noise.on', wvG('noise.on') ? 0 : 1));
  wvChoice(document, '[data-subshape] .wv-g', 'sub.shape', (el) => +el.dataset.k);
  wvChoice(document, '[data-suboct] span', 'sub.oct', (el) => +el.dataset.k);
  wvChoice(document, '[data-ncol] .wv-g', 'noise.color', (el) => +el.dataset.k);
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

  // The source editor: an LFO's points, or an envelope's corners.
  const se = WVW.wvSrcEd;
  let pi = -1;
  const px = (q) => 8 + q[0] * (se.w - 16), py = (q) => 8 + (1 - q[1]) * (se.h - 16);
  wvDrag(se.el, (dx, dy, e) => {
    const s = WV_SOURCES[WV.sel], [x, y] = wvLocal(se.el, e);
    if (s.kind === 'lfo' && pi >= 0) {
      const key = `${s.key}.points`, pts = wvG(key).map((q) => q.slice());
      const p = pts[pi];
      if (pi > 0 && pi < pts.length - 1) p[0] = wvClamp((x - 8) / (se.w - 16), pts[pi - 1][0] + 0.01, pts[pi + 1][0] - 0.01);
      p[1] = wvClamp(1 - (y - 8) / (se.h - 16));
      wvLive(key, pts);
    } else if (s.kind === 'env' && eh) wvEnvDrag(s.key, eh, dx, dy, 120, 70);
  }, (e) => {
    const s = WV_SOURCES[WV.sel], [x, y] = wvLocal(se.el, e);
    if (s.kind === 'lfo') {
      const pts = wvG(`${s.key}.points`);
      const near = (q) => Math.hypot(px(q) - x, py(q) - y);
      pi = pts.reduce((b, q, i) => (near(q) < near(pts[b]) ? i : b), 0);
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
    const c = wvH(`<span class="wv-chip wv-btn" title="Drag across for the amount"><i></i>${wvDstName(m.dst)} <b class="wv-mono" style="font-weight:400;color:var(--wv-t3)"></b> <span style="color:var(--wv-t3);cursor:pointer" title="Remove">×</span></span>`);
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
}

/// The parts of Modulate that follow the chosen source.
function wvSyncSrc() {
  document.querySelectorAll('#wvSrcTabs [data-src]').forEach((x) => x.classList.toggle('on', +x.dataset.src === WV.sel));
  const s = WV_SOURCES[WV.sel];
  const lfo = s.kind === 'lfo';
  $('wvSrcSide').querySelectorAll('.wv-seg, .wv-cell').forEach((x) => x.classList.toggle('dim', !lfo));
  const mode = lfo ? wvG(`${s.key}.mode`) : '';
  document.querySelectorAll('#wvSrcMode span').forEach((x) => x.classList.toggle('on', x.dataset.k === mode));
  wvRenderTargets();
}

/// Everything that is a lit choice rather than a drawing, set from the patch.
/// Called after a patch arrives and after any stored change.
function wvSyncPlay() {
  for (let i = 0; i < 3; i++) {
    const k = `osc${i}.`;
    document.querySelector(`[data-oscled="${i}"]`).classList.toggle('off', !wvG(k + 'on'));
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
  document.querySelector('[data-sub]').classList.toggle('off', !wvG('sub.on'));
  document.querySelector('[data-noise]').classList.toggle('off', !wvG('noise.on'));
  const lit = (sel, v) => document.querySelectorAll(sel).forEach((x) => x.classList.toggle('on', x.dataset.k === String(v)));
  lit('[data-subshape] .wv-g', wvG('sub.shape'));
  lit('[data-suboct] span', wvG('sub.oct'));
  lit('[data-ncol] .wv-g', wvG('noise.color'));
  lit('#wvFroute span', wvG('filt.route'));
  lit('#wvVoiceMode span', wvG('voice.mode'));
  [0, 1].forEach((i) => lit(`[data-ftype="${i}"] .wv-g`, wvG(`filt${i}.type`)));
  $('wvMpe').firstElementChild.classList.toggle('on', !!wvG('voice.mpe'));
  wvTxt('wvBendRo', `±${wvG('voice.bend')}`);
  wvSyncSrc();
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

function wvDrawStrip(g, T, p, rng, n = 24) {
  const { c, w, h } = g, cl = wvCl();
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
  wvRing(g, v, { cl, mod: o.mod, live: o.live, inset: 4 });
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
  wvRing(k, v, { cl: wvCl(), bip, pointer: 1, mod: m.rng, live: m.live, inset: 4 });
}

function wvDrawUniFace(g, cur, n, det, spr) {
  const { c, w, h } = g, cl = wvCl(), cx = w / 2, cy = h / 2, r = w * 0.3;
  c.clearRect(0, 0, w, h);
  const m = wvModOf(g.el.dataset.tgt);
  wvRing(g, det, { cl, inset: 4, mod: m.rng, live: m.live });
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

/// A level fader, drawn as the wave's own silhouette rising to the cap.
function wvDrawLevel(g, cur, lv, m) {
  const { c, w, h } = g, cl = wvCl(), top = 8, bot = h - 8, y = bot - (bot - top) * lv, cx = w / 2;
  c.clearRect(0, 0, w, h);
  const sil = new Path2D();
  sil.moveTo(cx, bot);
  for (let i = 0; i <= 50; i++) sil.lineTo(cx + Math.abs(wvRd(cur, i / 50 * 3)) * (w * 0.34) * (0.35 + 0.65 * i / 50), bot - (bot - y) * i / 50);
  for (let i = 50; i >= 0; i--) sil.lineTo(cx - Math.abs(wvRd(cur, i / 50 * 3)) * (w * 0.34) * (0.35 + 0.65 * i / 50), bot - (bot - y) * i / 50);
  sil.closePath();
  const gr = c.createLinearGradient(0, y, 0, bot);
  gr.addColorStop(0, `rgba(${cl.bloom},.55)`);
  gr.addColorStop(1, `rgba(${cl.bloom},.06)`);
  c.fillStyle = gr;
  c.fill(sil);
  c.fillStyle = cl.t;
  c.shadowBlur = 6;
  c.shadowColor = 'rgba(0,0,0,.8)';
  c.beginPath(); c.roundRect(4, y - 3, w - 8, 6, 3); c.fill();
  c.shadowBlur = 0;
  c.fillStyle = cl.acc;
  c.fillRect(w / 2 - 5, y - 0.5, 10, 1);
  if (m && m.rng) {
    const y0 = bot - (bot - top) * wvClamp(lv - m.rng), y1 = bot - (bot - top) * wvClamp(lv + m.rng);
    c.fillStyle = cl.mod;
    c.fillRect(w - 4, y1, 2, y0 - y1);
    if (m.live != null) wvDot(c, w - 3, bot - (bot - top) * wvClamp(m.live), 2.2, cl.acc);
  }
}

/// A horizontal bar whose picture is its own effect: the sub's wave, the
/// noise's colour, or the glide's curve.
function wvDrawHBar(g, v, kind, cur) {
  const { c, w, h } = g, cl = wvCl(), x = 6 + (w - 12) * v;
  c.clearRect(0, 0, w, h);
  c.save();
  c.beginPath(); c.rect(6, 3, x - 6, h - 6); c.clip();
  const p = new Path2D();
  if (kind === 'sub') {
    c.strokeStyle = `rgba(${cl.bloom},.18)`;
    c.lineWidth = 1;
    c.stroke(wvPath((u) => [6 + u * (w - 12), h / 2 - wvRd(cur, u * 4) * h * 0.3], 160));
    const sh = [(q) => Math.sin(q * WV_TAU), (q) => 1 - 4 * Math.abs(((q + 0.25) % 1) - 0.5), (q) => ((q % 1) < 0.5 ? 1 : -1) * 0.8][wvG('sub.shape')] || ((q) => Math.sin(q * WV_TAU));
    for (let i = 0; i <= 120; i++) {
      const xx = 6 + i / 120 * (w - 12), yy = h / 2 - sh(i / 120 * 2 / wvG('sub.oct')) * (h * 0.34) * v;
      if (i) p.lineTo(xx, yy); else p.moveTo(xx, yy);
    }
  } else if (kind === 'noise') {
    let s = 7, pr = 0;
    const col = wvG('noise.color');
    for (let i = 0; i <= 160; i++) {
      s = (s * 16807) % 2147483647;
      const r = (s / 2147483647) * 2 - 1;
      pr = col === 0 ? r : col === 1 ? pr * 0.6 + r * 0.6 : pr * 0.9 + r * 0.35;
      const xx = 6 + i / 160 * (w - 12), yy = h / 2 - wvClamp(pr, -1, 1) * (h * 0.38) * v;
      if (i) p.lineTo(xx, yy); else p.moveTo(xx, yy);
    }
  } else {
    for (let i = 0; i <= 60; i++) {
      const xx = 6 + i / 60 * (w - 12), u = i / 60, yy = h - 5 - (h - 10) * (1 - Math.exp(-u * 5 / (v * 3 + 0.05)));
      if (i) p.lineTo(xx, yy); else p.moveTo(xx, yy);
    }
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
    c.fillStyle = cl.mod;
    c.fillRect(6 + (w - 12) * wvClamp(v - m.rng), h - 3, (w - 12) * m.rng * 2, 2);
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
    c.fillStyle = `color-mix(in srgb,${cl.mod} 30%,transparent)`;
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
  const r = wvModOf(f + 'cut').rng;
  if (r) {
    const base = wvG(f + 'cut');
    c.fillStyle = `color-mix(in srgb,${cl.mod} 14%,transparent)`;
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

/// The LFO editor: its points, its curve, and the engine's phase on it.
function wvDrawLfo(g, L) {
  const { c, w, h } = g, cl = wvCl(), pts = wvG(`lfo${L}.points`);
  const px = (q) => 8 + q[0] * (w - 16), py = (q) => 8 + (1 - q[1]) * (h - 16);
  c.clearRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,.05)';
  for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(8 + i * (w - 16) / 8, 6); c.lineTo(8 + i * (w - 16) / 8, h - 6); c.stroke(); }
  c.beginPath(); c.moveTo(8, h / 2); c.lineTo(w - 8, h / 2); c.stroke();
  const p = wvPath((u) => [8 + u * (w - 16), py([0, wvLfoAt(pts, u)])], 160);
  wvUnder(c, p, 8, w - 8, h, 0, cl, 0.16);
  wvTrace(c, p, cl, 1.5);
  for (const q of pts) { c.fillStyle = cl.t; c.beginPath(); c.arc(px(q), py(q), 3, 0, WV_TAU); c.fill(); }
  const ph = wvLfoPhase(L);
  if (ph != null) {
    c.strokeStyle = `color-mix(in srgb,${cl.acc} 50%,transparent)`;
    c.beginPath(); c.moveTo(8 + ph * (w - 16), 6); c.lineTo(8 + ph * (w - 16), h - 6); c.stroke();
    wvDot(c, 8 + ph * (w - 16), py([0, wvLfoAt(pts, ph)]), 3.4, cl.acc);
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
  if (s.kind === 'lfo') p = wvPath((u) => [1 + u * (w - 2), h - 2 - wvLfoAt(wvG(`${s.key}.points`), u) * (h - 4)], 40);
  else {
    const E = wvEnv(s.key);
    p = new Path2D();
    p.moveTo(1, h - 1); p.lineTo(2 + E.a * 8, 1); p.lineTo(6 + E.a * 8 + E.d * 10, h - 1 - E.s * (h - 2));
    p.lineTo(w - 6, h - 1 - E.s * (h - 2)); p.lineTo(w - 1, h - 1);
  }
  c.strokeStyle = cl.wave;
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
  const cl = wvCl(), vs = wvVoices();
  for (let i = 0; i < 3; i++) {
    const k = `osc${i}.`, name = wvG(k + 'table'), T = wvTable(name), p = wvPosNow(i);
    const cur = wvWaveFor(i), warp0 = [wvG(k + 'warp0.mode'), wvClamp(wvLiveOr(k + 'warp0.amt'))], tilt = WV.tilt[i];
    const opt = { rise: 0.3 + 0.38 * tilt, depth: 0.18 + 0.14 * tilt, floor: 1 };
    if (WV.face[i] === 's') wvDrawSpec3D(WVW['wvW3d' + i], T, name, p, warp0, opt);
    else wvDrawW3d(i, T, p, warp0, t, opt, wvG(k + 'on') ? vs : null);
    wvDrawStrip(WVW['wvSt' + i], T, p, wvModOf(k + 'pos').rng);
    const o = i === 1 ? 0 : 1, B = wvFrameAt(wvTable(wvG(`osc${o}.table`)), wvPosNow(o));
    [0, 1].forEach((j) => {
      const key = `${k}warp${j}.amt`, m = wvModOf(key), f = wvFrameAt(T, p), mode = wvG(`${k}warp${j}.mode`);
      const amt = wvClamp(m.live != null ? m.live : wvG(key));
      wvDrawFace(WVW[`wvWp${i}${j}`], wvG(key), wvWarp(f, mode, amt, B), f, { mod: m.rng, live: m.live, empty: mode === 'off' });
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
    const lv = wvG(k + 'level');
    wvDrawLevel(WVW['wvLv' + i], cur, lv, wvModOf(k + 'level'));
    const db = 20 * Math.log10(lv ** 2 + 1e-9);
    wvTxt('wvLvr' + i, lv < 0.01 ? '−∞' : (db < 0 ? '−' : '+') + Math.abs(db).toFixed(1));
    wvTxt('wvFr' + i, `${String(Math.round(p * (T.length - 1)) + 1).padStart(2, '0')} / ${T.length}`);
    const pk = WVW['wvPk' + i];
    pk.c.clearRect(0, 0, pk.w, pk.h);
    pk.c.strokeStyle = cl.wave;
    pk.c.lineWidth = 1.2;
    pk.c.stroke(wvPath((u) => [1 + u * (pk.w - 2), pk.h / 2 - wvRd(wvFrameAt(T, u), (u * 3) % 1) * (pk.h * 0.4)], 60));
  }
  const mix = wvWaveFor(0);
  wvDrawHBar(WVW.wvSubLv, wvG('sub.level'), 'sub', mix);
  wvDrawHBar(WVW.wvNoiseLv, wvG('noise.level'), 'noise', mix);
  wvDrawHBar(WVW.wvGlide, wvG('voice.glide'), 'glide', mix);
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
  wvTxt('wvSrcRateRo', s.kind === 'lfo' ? `${(0.2 + wvG(`${L}.rate`) * 2).toFixed(2)} Hz` : '—');
  wvTxt('wvSrcSmoothRo', s.kind === 'lfo' ? Math.round(wvG(`${L}.smooth`) * 100) + ' %' : '—');
  wvTxt('wvSrcRiseRo', s.kind === 'lfo' ? wvFmtMs(wvG(`${L}.rise`) ** 2 * 4) : '—');
  WV_SOURCES.forEach((x, i) => {
    const g = WVW['wvT4c' + i];
    wvDrawMini(g, x);
    if (x.kind === 'lfo') {
      const ph = wvLfoPhase(+x.key.slice(3));
      if (ph != null) wvDot(g.c, 1 + ph * (g.w - 2), g.h - 2 - wvLfoAt(wvG(`${x.key}.points`), ph) * (g.h - 4), 1.8, cl.acc);
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
