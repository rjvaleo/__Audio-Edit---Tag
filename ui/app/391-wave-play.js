// ================================================================ Wave: Play
//
// The Play view of the synth page: three oscillators, the two filters, the
// modulation band, the mixer and the voicing. Every control is a picture of
// what it does to the sound, and each one writes one patch key
// (`docs/WAVE-SYNTH.md`). Built once, on the first visit.
//
// v7 added what moves what, where you can see it: each source in its own
// colour, a badge on every module a source moves, and one row for every sound
// source with a real on/off. v8 (mock-up F, `docs/mockups/wave-synth-v8.html`)
// gives the oscillators bigger windows and puts four large modulation tiles
// under them: Amp, a slot for ENV 2–4, LFO 1 and a slot for LFO 2–4 (built in
// `391c-wave-tiles.js`), with every other source in a strip beneath. Each
// oscillator's route moves to its row in the mixer.

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

/// Where an oscillator goes, as its row in the mixer offers it.
const WV_ROUTES = [['F1', '1', 'Filter 1'], ['F2', '2', 'Filter 2'], ['both', '1+2', 'Both filters'], ['direct', 'Out', 'Straight out, past the filters']];
const WV_FILTERS = [
  ['lp', 'M2 4 H9 C12 4,12 2,13 4 L16 12', 'Low pass'], ['bp', 'M2 12 C6 12,7 2,9 2 S12 12,16 12', 'Band pass'],
  ['hp', 'M2 12 L5 4 C6 2,6 4,9 4 H16', 'High pass'], ['notch', 'M2 4 H7 L9 12 L11 4 H16', 'Notch'],
  ['comb', 'M2 4 L4 12 L6 4 L8 12 L10 4 L12 12 L14 4 L16 12', 'Comb'], ['form', 'M2 12 C4 3,6 3,7 9 C8 4,10 4,11 10 L16 12', 'Formant'],
];
/// The filter routing, each drawn as the path the sound takes.
const WV_FROUTES = [
  ['serial', '1 → 2', 'Serial: Filter 1, then Filter 2', 'M1 7 H5 M5 4 H11 V10 H5 Z M11 7 H16 M16 4 H22 V10 H16 Z M22 7 H29'],
  ['parallel', '1 ‖ 2', 'Parallel: both filters side by side, summed', 'M1 7 H5 M5 3 V11 M5 3 H10 M5 11 H10 M10 1.5 H16 V4.5 H10 Z M10 9.5 H16 V12.5 H10 Z M16 3 H21 M16 11 H21 M21 3 V11 M21 7 H29'],
  ['split', 'Split', 'Split: A goes to Filter 1, B to Filter 2', 'M1 3 H10 M1 11 H10 M10 1.5 H16 V4.5 H10 Z M10 9.5 H16 V12.5 H10 Z M16 3 H21 M16 11 H21 M21 3 V11 M21 7 H29'],
];

function wvBuildOsc(i) {
  const L = 'ABC'[i], k = `osc${i}.`;
  const warp = (j) => {
    const m = wvG(`${k}warp${j}.mode`);
    return `<div class="wv-wc">${wvKnobEl(`wvWp${i}${j}`, 44, true, `${k}warp${j}.amt`)}`
      + `<div class="wv-glyphs">${wvGlyph(WV_WARPS[m].g, true, `Warp ${j + 1}: ${WV_WARPS[m].name}. Click for every mode, drawn on this wave`, `data-cycle="${i}${j}"`)}`
      + `<span class="wv-lab wv-col"><span id="wvWn${i}${j}"></span><b id="wvWv${i}${j}"></b></span></div></div>`;
  };
  return wvH(`<div class="wv-mod wv-panel wv-osc" id="wvOsc${i}">
   <div class="wv-mh"><span class="wv-pwr wv-btn" data-oscled="${i}" title="Osc ${L}: on or off">${WV_PWR}</span><span class="wv-nm">OSC ${L}</span>
    <span class="wv-pick wv-btn" data-pick="${i}" title="Wavetable: click to pick another"><canvas id="wvPk${i}" data-w="30" data-h="14"></canvas><span id="wvPkName${i}"></span></span>
    <span class="wv-sp"></span>
    <span class="wv-seg" data-face="${i}" style="padding:1px"><span class="on" title="Waves: the table as its frames" data-f="w">${wvIc('M1 7 C4 1,6 1,8 5 S12 9,15 3', 16, 10)}</span><span title="Spectrum: the table as its harmonics" data-f="s">${wvIc('M2 9V2M5 9V4M8 9V3M11 9V6M14 9V7', 16, 10)}</span></span></div>
   <div class="wv-tbl"><div class="wv-well wv-win"><canvas id="wvW3d${i}" data-w="325" data-h="200" data-tgt="${k}pos"></canvas><span class="wv-moved" id="wvMoved${i}"></span><span class="wv-ro wv-fr" id="wvFr${i}"></span></div>
    <div class="wv-well"><canvas id="wvSt${i}" data-w="325" data-h="16" title="Frames: click or drag to pick one"></canvas></div></div>
   <div class="wv-r2">${warp(0)}${warp(1)}
    <div class="wv-wc u">${wvKnobEl(`wvUn${i}`, 44, true, `${k}uni.det`)}<div class="wv-lab wv-col" style="align-items:center"><span>Unison</span><b id="wvUr${i}"></b></div></div>
    <div class="wv-fx8"><div class="wv-well"><canvas id="wvOfx${i}" data-w="123" data-h="44" data-tgt="${k}fx.a"></canvas></div>
     <div class="wv-fxl"><div class="wv-g wv-btn on" data-ofx="${i}" title="Effect: click to pick this oscillator's own effect"><svg viewBox="0 0 18 14"><path d=""/></svg></div><div class="wv-tx"><span id="wvOfn${i}"></span><b id="wvOfr${i}"></b></div></div></div></div>
   <div class="wv-r3"><div class="wv-kl"><div class="wv-well"><canvas id="wvPt${i}" data-w="136" data-h="24" data-tgt="${k}pitch"></canvas></div><div class="wv-lab wv-col" style="width:44px"><span>Pitch</span><b id="wvPtr${i}"></b></div></div>
    <div class="wv-kl">${wvKnobEl(`wvPh${i}`, 26, 1, `${k}phase`)}<div class="wv-lab wv-col" style="width:36px"><span>Phase</span><b id="wvPhr${i}"></b></div></div>
    <div class="wv-kl">${wvKnobEl(`wvPn${i}`, 26, 0, `${k}pan`)}<div class="wv-lab wv-col" style="width:36px"><span>Pan</span><b id="wvPnr${i}"></b></div></div></div>
  </div>`);
}

/// One filter: its type, its lens, and its four knobs.
function wvBuildFilter(i) {
  const knob = (id, n, key, rid) => `<div class="wv-kl">${wvKnobEl(id, 26, 0, `filt${i}.${key}`)}<div class="wv-lab wv-col"><span>${n}</span><b id="${rid}"></b></div></div>`;
  return `<div class="wv-fb">
   <div class="wv-frow"><span class="wv-ro" style="color:var(--wv-t)">${i + 1}</span><div class="wv-glyphs" data-ftype="${i}">${WV_FILTERS.map(([k, d, t]) => wvGlyph(d, false, `${t}: Filter ${i + 1}'s type`, `data-k="${k}"`)).join('')}</div><span class="wv-sp"></span><span class="wv-tn" id="wvFtn${i}"></span></div>
   <div class="wv-well"><canvas id="wvLens${i}" data-w="339" data-h="87" data-tgt="filt${i}.cut" title="Filter ${i + 1}: drag across for the cutoff, up and down for the resonance"></canvas></div>
   <div class="wv-fk4">${knob(`wvCu${i}`, 'Cutoff', 'cut', `wvCur${i}`)}${knob(`wvRs${i}`, 'Res', 'res', `wvRsr${i}`)}${knob(`wvDr${i}`, 'Drive', 'drive', `wvDrr${i}`)}${knob(`wvKy${i}`, 'Key', 'key', `wvKyr${i}`)}</div></div>`;
}

function wvBuildPlay(view) {
  const top = wvH('<div class="wv-top8"></div>');
  for (let i = 0; i < 3; i++) top.appendChild(wvBuildOsc(i));
  top.appendChild(wvH(`<div class="wv-mod wv-panel wv-filt8">
   <div class="wv-mh"><span class="wv-nm">FILTERS</span><span class="wv-moved" id="wvMovedF"></span></div>
   ${wvBuildFilter(0)}
   <div class="wv-route8"><span class="wv-hint">Route</span><div class="wv-seg" id="wvFroute">${WV_FROUTES.map(([k, l, t, d]) => `<span data-k="${k}" title="${t}"><svg viewBox="0 0 30 14"><path d="${d}"/></svg>${l}</span>`).join('')}</div></div>
   ${wvBuildFilter(1)}</div>`));
  const row = wvH(`<div class="wv-modrow">
   <div class="wv-modl">
    <div class="wv-tl"><div class="wv-mod wv-panel wv-grp"><span class="wv-vlab">ENVELOPES</span><div class="wv-tiles" id="wvPEnvTiles"></div></div>
     <div class="wv-mod wv-panel wv-grp"><span class="wv-vlab">LFOS</span><div class="wv-tiles" id="wvPLfoTiles"></div></div></div>
    <div class="wv-mod wv-panel wv-strip9"><div class="wv-sk"><b>MORE SOURCES</b><span class="wv-hint">drag onto a control</span></div><div class="wv-sc9" id="wvSrcStrip"></div></div></div>
   <div class="wv-rcol9"></div></div>`);
  view.append(top, row);
  wvBuildPlayTiles();
  const rc = row.querySelector('.wv-rcol9');
  rc.appendChild(wvBuildMix());
  rc.appendChild(wvH(`<div class="wv-mod wv-panel wv-voice9">
   <div class="wv-mh"><span class="wv-nm">VOICE</span><span class="wv-sp"></span>
    <div class="wv-seg" id="wvVoiceMode"><span data-k="poly" title="Poly: every note its own voice">${wvIc('M1 2 H13 M1 5 H13 M1 8 H13')}Poly</span><span data-k="mono" title="Mono: one note at a time">${wvIc('M1 5 H13')}Mono</span><span data-k="legato" title="Legato: notes glide into each other">${wvIc('M1 8 C4 1,10 1,13 8')}Legato</span></div>
    <div class="wv-seg" id="wvMpe"><span title="MPE: each note its own bend and pressure">${wvIc('M1 9 V3 M5 9 V1 M9 9 V4 M13 9 V2')}MPE</span></div></div>
   <div class="wv-vg"><div class="wv-lab wv-col wv-vl"><span>Glide</span><b id="wvGlRo"></b></div>
    <div class="wv-well"><canvas id="wvGlide" data-w="268" data-h="84" data-tgt="voice.glide"></canvas></div>
    <div class="wv-lab wv-col wv-vl"><span>Bend</span><span class="wv-chip wv-btn" id="wvBendRange" title="Pitch-bend range: click for the next"><b class="wv-mono" id="wvBendRo"></b></span>
     <span>Tempo</span><span class="wv-chip wv-btn wv-tempo" id="wvTempoRo" title="Tempo: drag up and down. Synced LFOs follow it; double-click for 120"></span></div></div></div>`));
}

// ─────────────────────────────────────────────────────────────── wiring

function wvWirePlay() {
  for (let i = 0; i < 3; i++) {
    const k = `osc${i}.`;
    const led = document.querySelector(`[data-oscled="${i}"]`);
    led.addEventListener('click', () => wvCommit(k + 'on', wvG(k + 'on') ? 0 : 1));
    document.querySelector(`[data-pick="${i}"]`).addEventListener('click', (e) => wvTableMenu(e.currentTarget, i));
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
    // The pitch ruler: across or up, a semitone every 7 px; Shift is fine.
    let acc = 0;
    wvDrag(WVW['wvPt' + i].el, (dx, dy, e) => {
      if (e.shiftKey) { wvLive(k + 'fine', wvClamp(wvG(k + 'fine') + (dx - dy) / 200)); return; }
      acc += dx - dy;
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
  wvChoice(document, '#wvFroute span', 'filt.route');
  wvChoice(document, '#wvVoiceMode span', 'voice.mode');
  $('wvMpe').addEventListener('click', () => wvCommit('voice.mpe', wvG('voice.mpe') ? 0 : 1));
  $('wvBendRange').addEventListener('click', () => {
    const r = [1, 2, 7, 12, 24];
    wvCommit('voice.bend', r[(r.indexOf(wvG('voice.bend')) + 1) % r.length]);
  });
  wvDrag(WVW.wvGlide.el, (dx) => wvLive('voice.glide', wvClamp(wvG('voice.glide') + dx / 150)));
  // The tempo: drag up or across, a beat per two pixels, whole BPM only.
  const tp = $('wvTempoRo');
  let tacc = 0, from = 120;
  wvDrag(tp, (dx, dy) => {
    tacc += (dx - dy) / 2;
    wvLive('tempo', Math.round(wvClamp(from + tacc, 30, 300)));
    wvTxt('wvTempoRo', `${wvTempo()} BPM`);
  }, () => { tacc = 0; from = wvTempo(); });
  tp.addEventListener('dblclick', () => wvCommit('tempo', 120));

  [0, 1].forEach((i) => {
    const f = `filt${i}.`;
    // The dot on the lens and the Cutoff and Res knobs are the same two values.
    wvDrag(WVW['wvLens' + i].el, (dx, dy) => {
      wvLive(f + 'cut', wvClamp(wvG(f + 'cut') + dx / 220));
      wvLive(f + 'res', wvClamp(wvG(f + 'res') - dy / 80));
    });
    wvV('wvCu' + i, f + 'cut');
    wvV('wvRs' + i, f + 'res');
    wvV('wvDr' + i, f + 'drive');
    wvV('wvKy' + i, f + 'key');
    wvChoice(document, `[data-ftype="${i}"] .wv-g`, f + 'type');
  });
  wvWireTiles(document.getElementById('wvViewPlay'));
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

/// The rows changed: every page that shows them reads them again.
function wvRenderTargets() {
  wvRenderTileTargets();
  wvRenderBadges();
  if (WV.built && WV.view === 'matrix') wvRenderMatrix();
  if (WV.built && WV.view === 'fx') wvRenderInspector();
}

/// Everything that is a lit choice rather than a drawing, set from the patch.
/// Called after a patch arrives and after any stored change. v8b: a choice a
/// row moves shows the option it is stepped to (`wvChoiceNow`), and again
/// whenever the engine steps it (`wvChoiceTick`).
function wvSyncPlay() {
  for (let i = 0; i < 3; i++) {
    const k = `osc${i}.`;
    document.querySelector(`[data-oscled="${i}"]`).classList.toggle('on', !!wvG(k + 'on'));
    document.getElementById('wvOsc' + i).style.opacity = wvG(k + 'on') ? 1 : 0.55;
    wvTxt('wvPkName' + i, wvChoiceNow(k + 'table'));
    [0, 1].forEach((j) => {
      const m = wvChoiceNow(`${k}warp${j}.mode`);
      const b = document.querySelector(`[data-cycle="${i}${j}"]`);
      b.querySelector('path').setAttribute('d', (WV_WARPS[m] || WV_WARPS.off).g);
      wvTxt(`wvWn${i}${j}`, m === 'off' ? 'Add' : (WV_WARPS[m] || WV_WARPS.off).name);
    });
    const fx = wvChoiceNow(k + 'fx.mode');
    document.querySelector(`[data-ofx="${i}"] path`).setAttribute('d', (WV_OFX[fx] || WV_OFX.off).g);
    wvTxt('wvOfn' + i, (WV_OFX[fx] || WV_OFX.off).name);
    document.querySelectorAll(`[data-route="${i}"] span`).forEach((x) => x.classList.toggle('on', x.dataset.k === wvG(k + 'route')));
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
  lit('#wvFroute span', wvChoiceNow('filt.route'));
  lit('#wvVoiceMode span', wvG('voice.mode'));
  [0, 1].forEach((i) => {
    lit(`[data-ftype="${i}"] .wv-g`, wvChoiceNow(`filt${i}.type`));
    wvTxt('wvFtn' + i, (WV_FILTERS.find((f) => f[0] === wvChoiceNow(`filt${i}.type`)) || WV_FILTERS[0])[2]);
  });
  $('wvMpe').firstElementChild.classList.toggle('on', !!wvG('voice.mpe'));
  wvTxt('wvBendRo', `±${wvG('voice.bend')}`);
  wvTxt('wvTempoRo', `${wvTempo()} BPM`);
  wvSyncTiles();
}

// ─────────────────────────────────────────────────────────── v7: badges
//
// A badge on each module for every route into it: the source's own shape in
// its colour, then what it moves. Hovering one lights the source's tile and
// rings the control; clicking one shows the source in its Play slot.

/// A badge on an oscillator names only the control, since it sits on that
/// oscillator already. One on the filters keeps the filter's number.
const WV_BADGE_SHORT = { pos: 'Position', 'warp0.amt': 'Warp 1', 'warp1.amt': 'Warp 2', 'uni.det': 'Unison', 'uni.spr': 'Width', pitch: 'Pitch', fine: 'Fine', phase: 'Phase', rand: 'Random', pan: 'Pan', level: 'Level', 'fx.a': 'Effect', 'fx.b': 'Effect' };

const wvEsc = (t) => String(t).replace(/[&<>\u0022]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\u0022': '&quot;' })[c]);
const wvSrcOf = (src) => WV_SOURCES.find((s) => s.key === src);
const wvSrcColour = (src) => WV_SRC_COL[src] || 'var(--wv-mod)';
/// A source's short name, as its pill and its pin row read: `ENV 2`, `M3`.
const wvSrcLab = (src) => (src === 'amp' ? 'AMP' : (wvSrcOf(src) || { label: src }).label);

/// A source drawn small: an LFO's own shape, an envelope's corners, a dial for
/// a macro, and the playing hand each as its own little mark.
function wvSrcGlyph(src, w = 14, h = 9) {
  const s = wvSrcOf(src);
  let d;
  if (s && s.kind === 'lfo') {
    const L = +src.slice(3);
    d = '';
    for (let k = 0; k <= 28; k++) {
      const u = k / 28;
      d += (k ? 'L' : 'M') + (1 + u * (w - 2)).toFixed(1) + ' ' + (h - 1 - wvLfoVal(L, u, 0) * (h - 2)).toFixed(1);
    }
  } else if (s && s.kind === 'macro') d = `M2 ${h - 1} A5 5 0 1 1 ${w - 2} ${h - 1}`;
  else if (s && s.kind === 'perf') {
    d = { vel: `M2 ${h - 1} V4 M6 ${h - 1} V2 M10 ${h - 1} V5`, note: `M1 ${h - 1} L${w - 1} 1`, mw: `M1 ${h - 1} H5 V3 H${w - 1}`, at: `M1 ${h - 1} C5 ${h - 1},6 2,${w - 1} 2`, rand: `M1 6 H4 V2 H7 V8 H10 V4 H${w - 1}` }[src];
  } else d = `M1 ${h - 1} L4 1 L7 ${h / 2} H${w - 4} L${w - 1} ${h - 1}`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}

function wvBadge(m, short) {
  const rest = m.dst.replace(/^osc\d\./, '');
  const tn = short ? (WV_BADGE_SHORT[rest] || rest) : wvDstName(m.dst);
  return `<span class="wv-badge" style="--c:${wvSrcColour(m.src)}" data-bs="${wvEsc(m.src)}" data-bt="${wvEsc(m.dst)}">${wvSrcGlyph(m.src)}${wvEsc(wvSrcLab(m.src))}<i>→ ${wvEsc(tn)}</i></span>`;
}

/// Light a route: the source's tiles and pills, and the control it moves, in
/// its colour, on whichever page shows them.
function wvHlMod(src, dst, on) {
  document.querySelectorAll(`#waveView .wv-tile[data-tile="${src}"], #waveView [data-src="${src}"]`).forEach((e) => e.classList.toggle('wv-hl', on));
  document.querySelectorAll('#waveView [data-tgt]').forEach((c) => {
    if (c.dataset.tgt !== dst) return;
    c.style.setProperty('--c', wvSrcColour(src));
    c.classList.toggle('wv-hl', on);
  });
}

/// A source picked from a badge or a pill: an envelope or LFO goes into its
/// Play slot, and it lights what it moves for a moment.
function wvSelectSrc(src) {
  const s = wvSrcOf(src);
  if (s && s.kind === 'env' && src !== 'env1' || s && s.kind === 'lfo' && src !== 'lfo0') wvSetSlot(s.kind, src);
  const ms = WV.mods.filter((m) => m.src === src);
  ms.forEach((m) => wvHlMod(src, m.dst, true));
  if (!ms.length) wvHlMod(src, '', true);
  setTimeout(() => { ms.forEach((m) => wvHlMod(src, m.dst, false)); wvHlMod(src, '', false); }, 800);
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
    const list = WV.mods.filter((m) => keep(m) && !m.off);
    let n = list.length;
    const fill = () => {
      const more = list.slice(n);
      el.innerHTML = list.slice(0, n).map((m) => wvBadge(m, short)).join('')
        + (more.length ? `<span class="wv-badge wv-more" style="--c:var(--wv-t3)" title="${more.length} more: ${wvEsc(more.map((m) => `${wvSrcLab(m.src)} → ${wvDstName(m.dst)}`).join(', '))}">+${more.length}</span>` : '');
    };
    fill();
    // More routes than the header has room for: the last ones fold into "+N",
    // so a badge is never cut off.
    while (n > 0 && el.clientWidth && el.scrollWidth > el.clientWidth + 0.5) { n--; fill(); }
    el.querySelectorAll('.wv-badge[data-bs]').forEach((b) => {
      const src = b.dataset.bs, dst = b.dataset.bt;
      b.addEventListener('mouseenter', () => wvHlMod(src, dst, true));
      b.addEventListener('mouseleave', () => wvHlMod(src, dst, false));
      b.addEventListener('click', () => wvSelectSrc(src));
    });
  }
}

// ─────────────────────────────────────────────────────────── the mixer
//
// v8: one row for every sound source: its power, its level as a bar that draws
// its own sound with the readout at its right end, and where it goes (an
// oscillator's route; the sub's shape and octave; the noise's colour).

const WV_MIX = [0, 1, 2].map((i) => ({ n: `OSC ${'ABC'[i]}`, who: `Osc ${'ABC'[i]}`, on: `osc${i}.on`, lv: `osc${i}.level` }))
  .concat([{ n: 'SUB', who: 'Sub', on: 'sub.on', lv: 'sub.level' }, { n: 'NOISE', who: 'Noise', on: 'noise.on', lv: 'noise.level' }]);
/// One fixed width for every bar; its last 40 px are its readout.
const WV_MIX_W = 212;
const WV_MIX_RO = 40;
const WV_NOISE_COL = [['W', 'White: bright, even hiss', '#e9edf2'], ['P', 'Pink: softer, even in every octave', '#f2a3c0'], ['B', 'Brown: a deep rumble', '#c08f60']];
const WV_SUB_SHAPES = [
  ['M2 7 C5 0,7 0,9 7 S13 14,16 7', 'Sine: the purest, deepest sub'],
  ['M2 7 L6 2 L12 12 L16 7', 'Triangle: a little edge, so it carries on small speakers'],
  ['M2 3 H9 V11 H16', 'Square: hollow, cuts through a mix'],
];

function wvBuildMix() {
  const end = (c) => {
    if (c < 3) return `<div class="wv-seg" data-route="${c}">${WV_ROUTES.map(([k, l, t]) => `<span data-k="${k}" title="${t}: where osc ${'ABC'[c]} goes">${l}</span>`).join('')}</div>`;
    if (c === 3) {
      return `<div class="wv-glyphs" data-subshape>${WV_SUB_SHAPES.map(([d, t], k) => wvGlyph(d, false, t, `data-k="${k}"`)).join('')}</div>`
        + '<div class="wv-seg" data-suboct><span data-k="2" title="−2: two octaves below the note">−2</span><span data-k="1" title="−1: one octave below the note">−1</span></div>';
    }
    return `<div class="wv-seg" data-ncol>${WV_NOISE_COL.map(([l, t, col], k) => `<span data-k="${k}" title="${t}"><i class="wv-nd" style="background:${col}"></i>${l}</span>`).join('')}</div>`;
  };
  return wvH(`<div class="wv-mod wv-panel wv-mix"><div class="wv-mh"><span class="wv-nm">MIX</span><span class="wv-sp"></span><span class="wv-hint">Level · where it goes</span></div>${WV_MIX.map((ch, c) => `<div class="wv-strip" data-strip="${c}">
    <span class="wv-pwr wv-btn" data-mixon="${c}" title="${ch.who}: on or off">${WV_PWR}</span><span class="wv-nm">${ch.n}</span>
    <div class="wv-well"><canvas id="wvMixL${c}" data-w="${WV_MIX_W}" data-h="22" data-tgt="${ch.lv}"></canvas></div><div class="wv-x8">${end(c)}</div></div>`).join('')}</div>`);
}

function wvWireMix() {
  WV_MIX.forEach((ch, c) => {
    const g = WVW['wvMixL' + c], span = WV_MIX_W - WV_MIX_RO - 12;
    // Where you click is the level, and it follows the pointer from there.
    const set = (e) => wvLive(ch.lv, wvClamp((wvLocal(g.el, e)[0] - 6) / span));
    wvDrag(g.el, (dx, dy, e) => set(e), set);
    document.querySelector(`[data-mixon="${c}"]`).addEventListener('click', () => wvCommit(ch.on, wvG(ch.on) ? 0 : 1));
  });
  wvChoice(document, '[data-subshape] .wv-g', 'sub.shape', (el) => +el.dataset.k);
  wvChoice(document, '[data-suboct] span', 'sub.oct', (el) => +el.dataset.k);
  wvChoice(document, '[data-ncol] span', 'noise.color', (el) => +el.dataset.k);
  for (let i = 0; i < 3; i++) wvChoice(document, `[data-route="${i}"] span`, `osc${i}.route`);
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
    x.font = `9px ${cl.mono}`;
    x.textAlign = 'right';
    x.fillStyle = cl.t2;
    x.fillText(wvDbTxt(v), W0 - 6, h / 2 + 3.5);
    x.textAlign = 'left';
    x.globalAlpha = 1;
  });
}
