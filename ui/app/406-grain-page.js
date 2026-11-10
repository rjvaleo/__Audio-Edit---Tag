// ================================================================ Grain: the page
//
// The shell around the views and the controls: the page's own row (preset, A/B,
// Randomize, the transport), the engine tabs, the fit, the frame loop, and coming
// and going. `setMode` calls `gsEnter` and `gsLeave`; nothing here runs while the
// page is not on screen.
//
// The transport buttons are the real ones, pressed: `#playBtn` and its neighbours
// stay built in their hidden bar and are what actually happens.

function gsBuild() {
  const host = $('grainView');
  host.innerHTML = '';
  host.appendChild(wvH(`<div class="gs-app">
   <div class="gs-bar">
    <div class="gs-preset gs-btn" id="gsPresetBtn" title="Presets: click for the shelf">
     <div class="gs-ib" data-step="-1" title="Previous preset"><svg viewBox="0 0 12 12"><path d="M8 2 L4 6 L8 10"/></svg></div>
     <span class="pn" id="gsPresetName"></span><span class="pt" id="gsPresetTag"></span>
     <div class="gs-ib" data-step="1" title="Next preset"><svg viewBox="0 0 12 12"><path d="M4 2 L8 6 L4 10"/></svg></div>
    </div>
    <div class="gs-seg" id="gsAB"><span class="on" data-ab="A" title="A: compare two settings">A</span><span data-ab="B" title="B: a second setting to compare against A">B</span></div>
    <span class="gs-btn gs-chip gs-rndb" id="gsRndBtn" title="Throw every control in the tray somewhere at random. The engine stays where it is, and the seed is reported so a good accident can be found again. ⇧-click: nudge each a little instead"><svg viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="2.5"/><circle cx="4.6" cy="4.6" r="1"/><circle cx="9.4" cy="4.6" r="1"/><circle cx="7" cy="7" r="1"/><circle cx="4.6" cy="9.4" r="1"/><circle cx="9.4" cy="9.4" r="1"/></svg>Randomize</span>
    <span class="gs-btn gs-chip" id="gsRndUndo" hidden title="Undo the last randomize">↶ Undo</span>
    <div class="gs-tp">
     <span class="gs-btn gs-tb" id="gsTPlay" title="Play"><svg viewBox="0 0 12 12"><path d="M3 1.8 L10.4 6 L3 10.2 Z"/></svg></span>
     <span class="gs-btn gs-tb" id="gsTStop" title="Stop: back to the cue. Double-click: back to the top of the file"><svg viewBox="0 0 12 12"><rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1"/></svg></span>
     <span class="gs-btn gs-tb" id="gsTLoop" title="Loop: the head wraps round the loop"><svg viewBox="0 0 12 12"><path d="M2.5 6.5 V5 A2 2 0 0 1 4.5 3 H9.5 M8 1.5 L9.6 3 L8 4.5 M9.5 5.5 V7 A2 2 0 0 1 7.5 9 H2.5 M4 10.5 L2.4 9 L4 7.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
     <span class="gs-btn gs-tb rec" id="gsTRec" title="Capture: record what you hear to a new file"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.4"/></svg></span>
     <span class="gs-btn gs-tchip" id="gsTGrain" title="GRAIN: the grain cloud sounds">GRAIN</span><span class="gs-btn gs-tchip" id="gsTSeq" title="SEQ: the step sequencer plays through the engine">SEQ</span>
     <span class="gs-ro" id="gsRecRo"></span>
     <span class="gs-well gs-clock" id="gsClock">00:00.000</span>
    </div>
    ${gsTrayHtml()}
   </div>
   <div class="gs-head" id="gsHead">
    <div class="gs-tabs gs-etabs" id="gsEngTabs" role="tablist"></div>
    <svg class="gs-cable" viewBox="0 0 40 32" style="width:40px"><path d="M0 29 C16 29,20 16,40 16"/></svg>
    <div class="gs-rack" id="gsFxStrip"></div>
    <svg class="gs-cable" viewBox="0 0 24 32" style="width:24px"><path d="M0 16 H24"/></svg>
    <span class="gs-outl">OUT</span>
    <div class="gs-well" title="What you hear: after the effects"><canvas id="gsOutWave" data-w="72" data-h="26"></canvas></div>
    <span class="gs-ro gs-meta" id="gsMeta"></span>
    <span class="gs-ro" id="gsVoicesRo" title="Layers sounding, and voices held; in Poly, the heads the engine is reading"></span>
    <canvas id="gsLoadM" data-w="64" data-h="22" class="gs-well" title="Load: the worst block as a share of the time it had. Click to forget it; ⇧-click sets whether layers are shed"></canvas>
    <canvas id="gsMaster" data-w="72" data-h="22" class="gs-well" title="The VU meter: what comes out. Drag across for the volume"></canvas>
   </div>
   <section class="gs-view">
    <div class="gs-colL">
     <div class="gs-mod gs-panel" id="gsPSrc" style="height:316px">
      <div class="gs-mh"><span class="gs-nm">SOURCE</span>
       <span class="gs-pick gs-btn" id="gsSndPick" style="width:150px" title="Sound: click to pick another from the library"><canvas id="gsSndMini" data-w="30" data-h="14"></canvas><span id="gsSndName"></span></span>
       <span class="gs-chip gs-btn" id="gsRegChip" title="Loop region: click to step to the next region"></span>
       <span class="gs-chip gs-btn" id="gsLoopChip" title="Loop: the head goes back to the loop start at its end">⟲ Loop</span>
       <span class="gs-sp"></span>
       <div class="gs-zb"><span class="gs-ib" id="gsFollow" title="Follow the playhead: keep it on screen while the detail is zoomed in">⇥</span><select class="gs-midi" id="gsFollowMode" title="How the view keeps up with the playhead"><option value="scroll">scroll</option><option value="page">page</option></select><span class="gs-ro" id="gsCzRo"></span><span class="gs-ib" id="gsCzOut" title="Zoom out">−</span><span class="gs-ib" id="gsCzIn" title="Zoom in round the head (or scroll on the detail)">+</span><span class="gs-ib zt" id="gsCzFit" title="The whole loop (or double-click the detail)">Fit</span></div>
      </div>
      <div class="gs-well"><canvas id="gsSrcPic" data-w="686" data-h="84" title="The whole file. Drag a bracket to move the loop, drag across for a new one; click or drag the green flag for Start; ⌥-drag scrubs. A region's strip along the bottom selects it"></canvas></div>
      <div class="gs-well"><canvas id="gsCloud" data-w="686" data-h="172" title="Only what is between the brackets. Inside the box moves the read head; beside it, across is Position jitter and up and down is Pitch jitter. Scroll to zoom, double-click for the whole loop"></canvas><span class="gs-ro gs-cloudro" id="gsCloudRo"></span></div>
     </div>
     <div class="gs-mod gs-panel" id="gsShared" style="flex:1;min-height:0"><div class="gs-g3"><div class="gs-gcol" id="gsSh1"></div><div class="gs-gcol" id="gsSh2"></div><div class="gs-gcol" id="gsSh3"></div></div></div>
    </div>
    <div class="gs-mod gs-panel" id="gsEngPanel">
     <div class="gs-mh"><span class="gs-nm" id="gsEngName"></span><span class="gs-sp"></span><span class="gs-chip gs-btn" id="gsEngReset" title="Reset only the extended controls: the standard ones are left alone">Reset</span></div>
     <div class="gs-well"><canvas id="gsTrace" data-w="616" data-h="60"></canvas></div>
     <div class="gs-modblk" id="gsPMod">
      <div class="gs-mh"><span class="gs-nm">MODULATE</span><span class="gs-sp"></span></div>
      <div class="gs-ampr" title="AMP: the note envelope. Drag the attack, decay and release points. With Run on, the sound is not gated"><span class="gs-lnm">AMP</span><div class="gs-well"><canvas id="gsAmp" data-w="404" data-h="28"></canvas></div><span class="gs-ro" id="gsAmpRo"></span></div>
      <div id="gsRMod"></div>
     </div>
     <div class="gs-eright" id="gsERight"></div>
     <div id="gsREng"><div class="gs-esects" id="gsESects"></div>
      <div class="gs-hrow" id="gsHeadRow" style="display:none"><div class="gs-well"><canvas id="gsHeadPic" data-w="404" data-h="92"></canvas></div><div class="gs-well"><canvas id="gsMapPic" data-w="203" data-h="92"></canvas></div></div>
      <div class="gs-well" id="gsLensWell" style="display:none"><canvas id="gsLens" data-w="616" data-h="120"></canvas></div>
     </div>
    </div>
   </section>
   ${gsFxPageHtml()}
   ${gsDockHtml()}
   <div class="gs-menu" id="gsMenu" hidden></div>
   <div class="gs-menu gs-shelf" id="gsShelf" hidden></div>
  </div>`));
  gsCvs(host);
  gsBuildTabs();
  const trace = document.createElement('i');
  trace.id = 'gsFxTrace';
  $('gsEngTabs').appendChild(trace);
  gsBuildShared();
  gsBuildModulate();
  gsWireMap();
  gsWireAmp();
  gsDrawDock();
  gsWireDock();
  gsWireOverview();
  gsWireDetail();
  gsWirePage();
  gsFxWire();
  GS.built = true;
  new ResizeObserver(gsFit).observe(host);
}

function gsWirePage() {
  const press = (id) => $(id).click();
  $('gsTPlay').onclick = () => press('playBtn');
  $('gsTStop').onclick = () => press('stopBtn');
  $('gsTStop').ondblclick = () => $('stopBtn').ondblclick();
  $('gsTLoop').onclick = () => press('loopBtn');
  $('gsLoopChip').onclick = () => press('loopBtn');
  $('gsTRec').onclick = () => press('recBtn');
  $('gsTGrain').onclick = () => press('srcGrain');
  $('gsTSeq').onclick = () => press('srcSeq');
  $('gsSndPick').onclick = () => { showPane('left', 'browse'); openDrawer(); };
  $('gsRegChip').onclick = gsNextRegion;
  $('gsCzIn').onclick = () => gsZoomCloud(0.5, gsHead());
  $('gsCzOut').onclick = () => gsZoomCloud(2);
  $('gsCzFit').onclick = () => { GS.czA = GS.czB = 0; };
  $('gsEngReset').onclick = gsResetEngine;
  $('gsKbScale').onclick = (e) => gsTuneMenu(e.currentTarget);
  gsWireTray();
  gsWireMidiChannel($('gsMidiCh'), 'grain');
  $('gsPresetBtn').onclick = (e) => {
    const step = e.target.closest('[data-step]');
    if (step) gsStepPreset(+step.dataset.step);
    else gsOpenShelf();
  };
  document.querySelectorAll('#gsAB span').forEach((s) => { s.onclick = () => gsSwitchAB(s.dataset.ab); });
  $('gsRndBtn').onclick = (e) => gsRandomize(e.shiftKey);
  $('gsRndUndo').onclick = gsRandomizeUndo;
  $('gsLoadM').onclick = (e) => $('engineLoad')?.onclick?.({ shiftKey: e.shiftKey });
  // The volume is the transport's own slider, moved from here.
  const vol = GS_CV.gsMaster;
  const setVol = (e) => {
    const input = $('volume');
    input.value = String(wvClamp((wvLocal(vol.el, e)[0] - 4) / (vol.w - 8)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  gsDrag(vol.el, (a, b, e) => setVol(e), setVol);
  window.addEventListener('pointerdown', (e) => {
    if (GS.showing && !e.target.closest?.('#gsMenu,#gsShelf,#gsPresetBtn,#gsTuneBtn,#gsKbScale')) gsCloseMenus();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (GS.showing && e.key === 'Escape' && gsMenusOpen()) { e.stopPropagation(); gsCloseMenus(); }
  }, true);
}

/// Step the loop to the next named region, if the sound has any.
function gsNextRegion() {
  const rs = state.annotations?.regions || [];
  if (!rs.length) { toast('No regions yet: make them on the Regions page'); return; }
  const f = gsFile(), { a } = gsLoop(), i = rs.findIndex((r) => f && Math.abs(r.start / f.sr - a) < 0.01), r = rs[(i + 1) % rs.length];
  state.sel = { start: r.start, end: r.end };
  setCue(r.start);
  drawSelection();
  applyLoop();
}

/// The tray's Reset, on the extended controls: every engine's own and the
/// grain's, the standard ones left alone.
function gsResetEngine() {
  GS.touched = true;
  return resetExtended();
}

/// Scale the page whole to fit the centre: the same page smaller, never a
/// cropped one.
function gsFit() {
  const host = $('grainView'), app = host && host.querySelector('.gs-app');
  if (!app) return;
  const cw = host.clientWidth, ch = host.clientHeight;
  if (!cw || !ch) return;
  const s = Math.min(cw / GS_W, ch / GS_H, 1.3);
  GS.scale = s;
  app.style.transform = `translate(${Math.floor((cw - GS_W * s) / 2)}px, 0px) scale(${s})`;
}

// ──────────────────────────────────────────────────────────────────── presets

const gsEngName = (a) => (GS_ENG.find((x) => x[0] === a) || ['', a || ''])[1];
const gsPresetTag = (p) => [p.note, gsEngName(p.stretch?.algorithm)].filter(Boolean).join(' · ');

function gsApplyPreset(name) {
  const pick = $('presetPick');
  pick.value = name;
  // The tray's own handler: it applies, rebuilds and says what it did.
  pick.dispatchEvent(new Event('change', { bubbles: true }));
}

function gsStepPreset(by) {
  const list = state.presets;
  if (!list.length) return;
  const i = list.findIndex((p) => p.name === $('presetPick').value);
  gsApplyPreset(list[(i + by + list.length + (i < 0 && by < 0 ? 1 : 0)) % list.length].name);
}

function gsOpenShelf() {
  const m = $('gsShelf');
  if (!m.hidden) { gsCloseMenus(); return; }
  gsCloseMenus();
  const cur = $('presetPick').value;
  m.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'gs-shelfgrid';
  for (const p of state.presets) {
    const el = wvH(`<div class="gs-pc ${p.name === cur ? 'on' : ''}" title="${gsAttr(p.name)}"><div class="gs-well gs-pcg">${gsSvgG((GG_ENGINE[p.stretch?.algorithm] || GG_ENGINE.wsola)())}</div><b></b><span></span></div>`);
    el.querySelector('b').textContent = p.name;
    el.querySelector('span').textContent = gsPresetTag(p);
    el.onclick = () => { gsCloseMenus(); gsApplyPreset(p.name); };
    grid.appendChild(el);
  }
  if (!state.presets.length) grid.appendChild(wvH('<span class="gs-hint">No presets yet: Save as… keeps this sound’s settings</span>'));
  m.appendChild(grid);
  const foot = wvH(`<div class="gs-shelffoot"><label class="gs-hint"><input type="checkbox" id="gsPresetSound"> with sound</label><span class="gs-sp"></span><span class="gs-btn gs-chip" id="gsPresetSave">Save as…</span><span class="gs-btn gs-chip" id="gsPresetManage">Manage…</span><span class="gs-btn gs-chip" id="gsPresetDelete">Delete</span></div>`);
  m.appendChild(foot);
  const sound = $('gsPresetSound');
  sound.checked = !!$('presetWithSound')?.checked;
  sound.onchange = () => { $('presetWithSound').checked = sound.checked; };
  for (const [id, real] of [['gsPresetSave', 'presetSave'], ['gsPresetManage', 'presetManage'], ['gsPresetDelete', 'presetDelete']]) {
    $(id).onclick = () => { gsCloseMenus(); $(real).click(); };
  }
  gsPlaceMenu(m, $('gsPresetBtn'));
}

function gsMarkPreset() {
  const name = $('presetPick').value, p = state.presets.find((x) => x.name === name);
  gsTxt('gsPresetName', name || 'No preset');
  gsTxt('gsPresetTag', p ? gsPresetTag(p) : gsEngName(GS.engine));
}

// ────────────────────────────────────────────────────── A/B and Randomize

const gsClone = (x) => JSON.parse(JSON.stringify(x));

function gsSnapshot(withRack) {
  const s = { stretch: gsClone(state.stretchDraft), grain: { ...state.grainDraft }, amp: { ...GS.amp }, lfo: gsClone(GS.lfo), scale: currentScale(), pitchStep: currentStep() };
  if (withRack && state.rack) {
    const r = state.rack;
    s.rack = gsClone({ slots: r.slots, master: r.master, pads: r.pads || {}, postRoll: r.postRoll || {}, ranges: r.ranges || {} });
  }
  return s;
}

/// Put a snapshot back as one edit, and the rack with it when it has one.
async function gsRestore(o) {
  state.stretchDraft = gsClone(o.stretch);
  state.grainDraft = { ...o.grain };
  Object.assign(GS.amp, o.amp);
  GS.lfo = gsClone(o.lfo);
  gsBuildModulate();
  gsLfoSend();
  gsVoicePost(gsAmpSecs(GS.amp));
  gsVoiceKeep();
  await gsPostAll({ scale: o.scale, pitchStep: o.pitchStep });
  if (o.rack && state.rack) {
    Object.assign(state.rack, gsClone(o.rack));
    pushRack({ immediate: true });
  }
  gsRebuildTray();
}

async function gsSwitchAB(k) {
  if (k === GS.ab || !state.stretchDraft) return;
  GS.abs[GS.ab] = gsSnapshot(true);
  GS.ab = k;
  document.querySelectorAll('#gsAB span').forEach((x) => x.classList.toggle('on', x.dataset.ab === k));
  // The first visit to B is A as it stands, to depart from.
  if (GS.abs[k]) await gsRestore(GS.abs[k]);
}

/// The tray's Random, on the tray's own controls, reported the same way. Shift
/// nudges what is there instead, and either can be undone.
function gsRandomize(nudge) {
  if (!state.stretchDraft || !state.grainDraft) return;
  GS.rndPrev = gsSnapshot(false);
  const ks = [...new Set([...document.querySelectorAll('#gsShared .gs-bc[data-k], #gsESects .gs-bc[data-k]')].map((e) => e.dataset.k))].filter((k) => k !== 'semitones');
  if (nudge) {
    for (const k of ks) {
      const c = GS_C[k];
      if (!c.sw && !c.seg) gsSetV(k, gsFromN(c, wvClamp(gsToN(c, gsRead(k)) + (Math.random() * 2 - 1) * 0.1)));
    }
    gsApplyDims();
    gsPostAll();
  } else {
    // The tray has to be showing what the page has done before it is thrown.
    if (GS.touched) gsRebuildTray();
    $('stretchRandom').click();
    GS.touched = true;
    gsApplyDims();
  }
  $('gsRndUndo').hidden = false;
  for (const k of ks) for (const el of GS_BARS[k] || []) el.animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], { duration: 500 });
}

async function gsRandomizeUndo() {
  const o = GS.rndPrev;
  if (!o) return;
  GS.rndPrev = null;
  $('gsRndUndo').hidden = true;
  await gsRestore(o);
}

// ──────────────────────────────────────────────────────────────── the frame loop

/// What comes out: the VU meter and the wave after the effects. Asked for only
/// while the page shows and the transport runs.
async function gsPollMaster() {
  const live = gsMetersLive();
  if (!GS.showing || !live || noAudio() || GS.pollBusy) { if (!live) GS.master = null; return; }
  GS.pollBusy = true;
  try {
    // The ring before the chain is written only while the effects page asks.
    const r = await api(`/api/engine/master?fft=1024&bands=64${GS_FX.view === 'fx' ? '&pre=1' : ''}`);
    GS.master = masterFeed(r, 64);
    if (GS.master) GS.master.pre = r.pre || null;
  } catch { GS.master = null; }
  GS.pollBusy = false;
}

function gsDrawMeters() {
  const cl = gsCl(), m = GS.master;
  const o = GS_CV.gsOutWave;
  if (o) {
    const { c, w, h } = o, xy = m?.lissajous;
    c.clearRect(0, 0, w, h);
    if (!xy || xy.length < 8) {
      c.strokeStyle = `rgba(${cl.bloom},.15)`;
      c.beginPath(); c.moveTo(6, h / 2); c.lineTo(w - 6, h / 2); c.stroke();
    } else {
      const n = xy.length / 2;
      wvTrace(c, wvPath((u) => { const i = Math.min(n - 1, Math.floor(u * n)); return [6 + u * (w - 12), h / 2 - wvClamp((xy[i * 2] + xy[i * 2 + 1]) * 1.1, -1, 1) * h * 0.42]; }, 240), cl, 1.1, 0.6);
    }
  }
  const v = GS_CV.gsMaster;
  if (v) {
    const { c, w, h } = v, db = (ch) => ch?.vuDb ?? -96;
    const lv = m ? Math.max(db(m.left), db(m.right)) : -96, l = wvClamp((lv + 48) / 48), n = Math.floor((w - 8) / 4.6);
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      c.fillStyle = i / n < l ? (i > n - 4 ? cl.on : `rgba(${cl.bloom},.8)`) : 'rgba(255,255,255,.06)';
      c.fillRect(4 + i * 4.6, 6, 3, 10);
    }
    // Where the volume is set.
    c.fillStyle = cl.t2;
    c.fillRect(4 + (+$('volume').value) * (w - 8) - 0.5, 18, 1.5, 3);
  }
  const g = GS_CV.gsLoadM;
  if (g) {
    const { c, w, h } = g, L = engine.load, l = wvClamp(gsMetersLive() && L ? L.worst : 0, 0, 1.2), n = 10;
    c.clearRect(0, 0, w, h);
    c.font = `9px ${cl.mono}`;
    c.fillStyle = cl.t3;
    c.fillText(gsMetersLive() && L ? Math.round(L.worst * 100) + '%' : 'LOAD', 4, 14);
    for (let i = 0; i < n; i++) {
      c.fillStyle = i / n < l ? (i >= 8 ? (l > 1 ? '#ff6b5e' : cl.on) : `rgba(${cl.bloom},.8)`) : 'rgba(255,255,255,.06)';
      c.fillRect(30 + i * 3.2, 6, 2, 10);
    }
  }
}

/// The two source chips: the switch each mirrors, and its title on and off.
const GS_SOURCE_CHIPS = [
  ['gsTGrain', 'srcGrain', 'GRAIN: the grain cloud sounds', 'GRAIN, the grain cloud,'],
  ['gsTSeq', 'srcSeq', 'SEQ: the step sequencer plays through the engine', 'SEQ, the step sequencer,'],
];

function gsMarkTransport() {
  const on = (id, v) => $(id).classList.toggle('on', !!v);
  on('gsTPlay', engine.playing);
  on('gsTLoop', state.loopOn);
  on('gsLoopChip', state.loopOn);
  on('gsTRec', capture.running || capture.armed);
  on('gsTGrain', $('srcGrain').classList.contains('on'));
  on('gsTSeq', $('srcSeq').classList.contains('on'));
  // A source switched off is silent, and the page has to say so: a chip that
  // is merely not pressed in reads as any other button.
  for (const [id, src, on, what] of GS_SOURCE_CHIPS) {
    const off = !$(src).classList.contains('on');
    $(id).classList.toggle('off', off);
    $(id).title = off ? `${what} is off, so it is silent. Click to turn it on` : on;
  }
  $('gsHead').classList.toggle('live', gsMetersLive());
  gsTxt('gsClock', $('timeNow').textContent);
  gsTxt('gsSndName', state.selectedFile?.name || '');
  gsTxt('gsRegChip', gsRegLabel());
  const L = Math.round(gsRead('layers')), run = gsMetersLive() ? engine.load?.layersRunning : 0;
  const v = GS.voice.mode === 'poly' ? gsPolyHeads().length : new Set([...GS_N.held.keys(), ...GS_N.midi]).size;
  gsTxt('gsVoicesRo', `${run && run < L ? run + '/' + L : L} layer${L > 1 ? 's' : ''} · ${v} voice${v === 1 ? '' : 's'}`);
}

const GS_KEYS = { ov: '', tr: '', cl: '', mini: null, glyph: 0 };

function gsTick(now) {
  const d = state.stretchDraft, path = state.selectedFile?.path || null;
  // A/B belong to the sound they were made on.
  if (GS.abFor !== path) { GS.abFor = path; GS.abs = { A: null, B: null }; GS.ab = 'A'; GS.rndPrev = null; $('gsRndUndo').hidden = true; document.querySelectorAll('#gsAB span').forEach((x) => x.classList.toggle('on', x.dataset.ab === 'A')); GS.czA = GS.czB = 0; gsVoiceForSound(); }
  if (d && d.algorithm !== GS.engine) gsApplyEngine();
  if (d) { gsPaintAll(); gsApplyDims(); }
  gsPaintSeed();
  gsMarkTune();
  gsMarkPreset();
  gsMarkTransport();
  gsMirrorTray();
  gsFollowTick();
  gsKeysTick();
  gsLfoTick();
  gsPicKeep();
  gsFxTick(now);
  // The engine's pictures are behind the effects page: not drawn while it shows.
  if (GS_FX.view === 'fx') return;
  if (now - GS_KEYS.glyph > 80) { GS_KEYS.glyph = now; gsAnimateGlyphs(); }
  if (GS_KEYS.mini !== state.overview) { GS_KEYS.mini = state.overview; GS_KEYS.ov = GS_KEYS.tr = ''; GS_TR.key = ''; gsDrawMini(); }
  const sel = state.sel ? `${state.sel.start}|${state.sel.end}` : '';
  const stamp = gsHeadLive() ? now : 0, frames = state.overview?.frames || 0;
  if (GS_KEYS.ann !== state.annotations) { GS_KEYS.ann = state.annotations; GS_KEYS.ov = ''; }
  const ovKey = `${frames}|${sel}|${state.cue}|${state.loopOn}|${stamp}`;
  if (ovKey !== GS_KEYS.ov) { GS_KEYS.ov = ovKey; gsDrawOverview(); }
  const trKey = `${frames}|${sel}|${stamp}`;
  if (trKey !== GS_KEYS.tr) { GS_KEYS.tr = trKey; gsDrawTrace(); }
  const clKey = [ovKey, GS.czA, GS.czB, GS.engine, GS_DET.got, GS_DET.staticKey, state.grains?.total, GS_PIC.pcm ? GS_PIC.serial : 0].concat(
    ['position', 'positionJitterMs', 'windowMs', 'wrap', 'cloud', 'ratio', 'scan', 'preserveTransients', 'sensitivity', 'floor', 'guardHops', 'overlap', 'vocWindowMs', 'anchorFrames', 'rateHz', 'densityHz', 'layers', 'semitones', 'envelope'].map(gsRead)).join('|');
  if (clKey !== GS_KEYS.cl || GS_DET.want !== GS_DET.got) { GS_KEYS.cl = clKey; gsDrawCloud(); }
  gsPicTick(now);
  gsDrawMeters();
  gsDrawLfos(now);
}

function gsFrame(now) {
  GS.raf = 0;
  if (!GS.showing) return;
  GS.raf = requestAnimationFrame(gsFrame);
  try { gsTick(now); } catch (e) { if (!GS.failed) { GS.failed = true; console.error('[grain page]', e); } }
}

// ─────────────────────────────────────────────────────────── coming and going

function gsEnter() {
  if (!GS.built) gsBuild();
  GS.showing = true;
  gsFit();
  loadScales();
  if (!state.presets.length) loadPresets();
  if (!state.overview && state.selectedFile) loadOverview();
  GS.engine = '';
  GS_KEYS.ov = GS_KEYS.tr = GS_KEYS.cl = '';
  if (!GS.raf) GS.raf = requestAnimationFrame(gsFrame);
  if (!GS.poll) GS.poll = setInterval(gsPollMaster, 80);
  gsKeysEnter();
  gsLfoEnter();
}

function gsLeave() {
  GS.showing = false;
  gsLfoLeave();
  gsKeysLeave();
  gsCloseMenus();
  gsFxLeave();
  if (GS.raf) cancelAnimationFrame(GS.raf);
  GS.raf = 0;
  clearInterval(GS.poll);
  GS.poll = 0;
  GS.master = null;
  gsPicLeave();
  // Anywhere else that shows the tray shows it as this page left things.
  if (GS.touched) gsRebuildTray();
}
