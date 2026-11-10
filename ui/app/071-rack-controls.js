function fxValueFormat(p, v) {
  if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz`
    : `${v < 10 ? v.toFixed(2) : Math.round(v)} Hz`;
  if (p.unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
  if (p.unit === 'dB') return `${v.toFixed(1)} dB`;
  if (p.unit) return `${v.toFixed(2)} ${p.unit}`;
  return p.min >= 0 && p.max <= 1.001 ? `${Math.round(v * 100)}%` : v.toFixed(2);
}

function automationUnit(value,min,max,log=false){
  return Math.max(0,Math.min(1,log&&min>0?Math.log(value/min)/Math.log(max/min):(value-min)/(max-min)));
}

function renderFxModuleControls(box, slot, shaper, slotIndex) {
  if (fxIsBuiltin(slot.kind)) { renderFxFace(box, slot, slotIndex, box.closest('.fx-module')); return; }
  // `key` names the one control this row writes, so the value can be moved on
  // the effect that is already running. Without one there is nothing to address
  // and the whole rack has to be posted instead — which *rebuilds the chain*,
  // clearing every delay line and reverb tail in it. That is fine for a control
  // that has no key and no other way to be sent, and ruinous for one that has
  // already sent itself: the linked Dry / Wet writes both of its values through
  // `liveParam` inside `set`, and was then having the rack rebuilt under it
  // thirty times a second — which is exactly what "the reverb cuts out" is.
  //
  // `sent` says the row has taken care of it.
  const add = (label, value, min, max, step, format, set, log = false, key = null,
               def = undefined, sent = false) => {
    box.appendChild(param(label, value, min, max, step, format,
      (v) => {
        set(v);
        if (key) liveParam(slot.id, key, v);
        else if (!sent) {
          // Deliberately does nothing but complain. This used to call
          // `pushRackLive`, which posted the whole rack every 32ms — thirty
          // rebuilds a second, each one clearing every delay line and reverb
          // tail in the chain. A control that cannot name its parameter should
          // be visibly broken, not quietly destructive.
          console.error(`rack control "${label}" has no key and did not send its own — it will not reach the engine`);
        }
      },
      () => { commitRack(); }, log, def));
  };
  if (shaper) {
    if (slot.kind === 'dattorro_filter_bank') { renderDattorroFilterBank(box, slot, shaper); return; }
    if (slot.kind === 'chamberlin') { renderVisualChamberlin(box, slot, shaper); return; }
    if (shaper.panel) { renderPrismControls(box, slot, shaper); return; }
    slot.params = slot.params || {};
    const fitRows = [];
    if (!shaper.params.length) {
      const note = document.createElement('p');
      note.className = 'engine-note';
      note.textContent = 'No controls';
      box.appendChild(note);
    }
    const wetSpec=shaper.params.find(p=>p.key==='wet'),drySpec=shaper.params.find(p=>p.key==='dry');
    if(wetSpec&&drySpec){
      if(slot.params.wet===undefined)slot.params.wet=wetSpec.default;
      if(slot.params.dry===undefined)slot.params.dry=drySpec.default;
      box.appendChild(linkedDryWet(slot));
    }
    for (const p of shaper.params) {
      if(p.key==='wet'||p.key==='dry')continue;
      if (slot.params[p.key] === undefined) slot.params[p.key] = p.default;
      if (slot.kind === 'utility' && ['invert', 'swap', 'ampFit'].includes(p.key)) {
        const toggle = check(p.label, p.label, slot.params[p.key] >= .5, (on) => {
          slot.params[p.key] = on ? 1 : 0;
          fitRows.forEach((row) => row.classList.toggle('inactive', slot.params.ampFit < .5));
          pushRack({ immediate: true });
          
        });
        box.appendChild(toggle);
        continue;
      }
      add(p.label, slot.params[p.key], p.min, p.max, (p.max - p.min) / 400,
        (v) => fxValueFormat(p, v), (v) => { slot.params[p.key] = v; }, p.log, p.key,
        p.default);
      if (slot.kind === 'utility' && ['grainMs', 'amount', 'floorDb'].includes(p.key)) {
        const row = box.lastElementChild; fitRows.push(row);
        row.classList.toggle('inactive', slot.params.ampFit < .5);
      }
    }
    return;
  }
  if (slot.kind === 'eq') { renderVisualEq(box, slot, slotIndex); return; }
  if (slot.kind === 'gain') {
    // Addressed by key like every other control, so moving it does not take
    // the rest of the chain's delay lines and tails with it.
    add('Level', slot.db, -24, 24, 0.1, (v) => `${v.toFixed(1)} dB`, (v) => { slot.db = v; },
        false, 'db', 0);
  } else if (slot.kind === 'comp') {
    renderVisualCompressor(box, slot);
  }
}

/// Wet and dry as one control, for any effect that has both.
///
/// Left of centre is all dry and less wet, right of centre all wet and less
/// dry. One control, two writes: the linked position is an interface idea and
/// the effect only knows wet and dry.
function linkedDryWet(slot) {
  const position = slot.params.wet >= .999 ? 1 - slot.params.dry / 2 : slot.params.wet / 2;
  return param('Dry / Wet', position, 0, 1, .001,
    (v) => { const wet = Math.min(1, v * 2), dry = Math.min(1, (1 - v) * 2);
      return `D ${Math.round(dry * 100)} · W ${Math.round(wet * 100)}`; },
    (v) => {
      slot.params.wet = Math.min(1, v * 2); slot.params.dry = Math.min(1, (1 - v) * 2);
      liveParam(slot.id, 'wet', slot.params.wet);
      liveParam(slot.id, 'dry', slot.params.dry);
    },
    () => { commitRack(); }, false, undefined);
}

/// An effect from prism-fx, drawn from the panel it declares.
///
/// The crate carries each effect's layout as well as its controls — the
/// groups and order the original used, and the Prism pad's default pair — so
/// this draws what it is given and knows nothing about any one effect. A new
/// prism effect needs no work here, as a new shaper needs none above.
function renderPrismControls(box, slot, shaper) {
  // Hyperprism, SoundHack and Lexicon draw their originals' faces (`076-fx-suites.js`).
  const suite = fxSuiteOf(shaper);
  if (suite) { renderSuiteFace(box, slot, shaper, suite); return; }
  slot.params = slot.params || {};
  for (const p of shaper.params) if (slot.params[p.key] === undefined) slot.params[p.key] = p.default;
  const byKey = Object.fromEntries(shaper.params.map((p) => [p.key, p]));
  // Each control's row, so the pad can move the sliders it moves.
  const rows = {};
  // A control that only means something in one setting of another — the
  // gate's reduction, while the type is Gate-Duck — is dimmed otherwise, as
  // SoundHack swapped that box's label with the type.
  const refresh = () => {
    for (const p of shaper.params) {
      if (p.when && rows[p.key]) rows[p.key].classList.toggle('inactive', Math.round(slot.params[p.when.key]) !== p.when.value);
    }
  };
  if (shaper.sound) box.appendChild(prismSoundRow(slot, shaper.sound));
  const pad = shaper.panel.pad;
  if (pad && byKey[pad.x] && byKey[pad.y]) box.appendChild(prismModulePad(slot, byKey[pad.x], byKey[pad.y], pad, rows));
  const groups = shaper.panel.groups?.length ? shaper.panel.groups
    : [{ label: '', keys: shaper.params.map((p) => p.key) }];
  for (const group of groups) {
    const section = document.createElement('div');
    section.className = 'prism-group';
    if (group.label) {
      const label = document.createElement('span');
      label.className = 'prism-group-label';
      label.textContent = group.label;
      section.appendChild(label);
    }
    // Wet and dry in one group are one linked control, as on every other
    // effect that has both.
    const linked = group.keys.includes('wet') && group.keys.includes('dry');
    for (const key of group.keys) {
      const p = byKey[key];
      if (!p || (linked && key === 'dry')) continue;
      const row = linked && key === 'wet' ? linkedDryWet(slot) : prismModuleControl(slot, p, rows, refresh);
      // Each control with the picture of what its value does (`fxDecorateRow`).
      if (linked && key === 'wet') fxDecorateRow(row, { key: 'mix', label: 'Dry / Wet', min: 0, max: 1 }, () => slot.params.wet >= .999 ? 1 - slot.params.dry / 2 : slot.params.wet / 2);
      else fxDecorateRow(row, p, () => slot.params[p.key]);
      section.appendChild(row);
    }
    box.appendChild(section);
  }
  refresh();
}

/// The sound an effect takes as well as its input — a convolution's impulse —
/// chosen from the library. Changing it rebuilds the chain: the effect is
/// handed a new sound, which is not something done mid-stream.
function prismSoundRow(slot, input) {
  const row = document.createElement('div');
  row.className = 'param prism-sound';
  const name = (path) => (path ? path.split('/').pop() : 'none');
  row.innerHTML = `<span class="k"></span><span class="prism-sound-name"></span><button class="ghost prism-sound-pick">Pick…</button>`;
  row.querySelector('.k').textContent = input.label;
  const shown = row.querySelector('.prism-sound-name');
  shown.textContent = name(slot.sound);
  shown.title = slot.sound || `No ${input.label.toLowerCase()} yet: the sound passes through`;
  const choose = document.createElement('div');
  choose.className = 'prism-sound-chooser hidden';
  choose.innerHTML = `<select class="mini prism-sound-folder" aria-label="Folder"></select>
    <select class="mini prism-sound-file" aria-label="${input.label}"></select>
    <button class="ghost prism-sound-use">Use</button><button class="ghost prism-sound-none">None</button>`;
  const folders = choose.querySelector('.prism-sound-folder');
  const files = choose.querySelector('.prism-sound-file');
  const fill = async () => {
    files.innerHTML = '';
    try {
      const list = await api(`/api/files?folder=${encodeURIComponent(folders.value)}`);
      for (const f of list) files.add(choiceOption(f.filename || name(f.path), f.path, f.path === slot.sound));
    } catch { /* an empty list says it */ }
  };
  for (const f of state.folders || []) folders.add(choiceOption(f.name, f.name, (slot.sound || '').startsWith(f.name + '/')));
  folders.onchange = fill;
  const use = (path) => {
    slot.sound = path || undefined;
    pushRack({ immediate: true });
    renderRack();
  };
  choose.querySelector('.prism-sound-use').onclick = () => use(files.value);
  choose.querySelector('.prism-sound-none').onclick = () => use(null);
  row.querySelector('.prism-sound-pick').onclick = async () => {
    choose.classList.toggle('hidden');
    if (!choose.classList.contains('hidden')) await fill();
  };
  const wrap = document.createElement('div');
  wrap.className = 'prism-sound-wrap';
  wrap.append(row, choose);
  return wrap;
}

/// One prism control: a slider, stepping through whole values for a count and
/// reading as a name for a choice, or a switch. `io` is where it sends: the FX
/// tab's rack by default, the Prism deck's chain from the Prism page.
function prismModuleControl(slot, p, rows, moved = () => {}, io = { live: liveParam, commit: commitRack }) {
  // A switch, or a choice of two or three, as named buttons beside its full
  // label — the shared panel's radio buttons, as SoundHack drew "Below Thresh."
  // and "Above Thresh." — rather than a slider or a squeezed switch label.
  const few = p.choices && p.choices.length <= 3;
  if (p.toggle || few) {
    const options = p.toggle ? [[p.min, 'Off'], [p.max, 'On']] : p.choices.map((c, i) => [p.min + i, c]);
    const now = p.toggle ? (slot.params[p.key] >= (p.min + p.max) / 2 ? p.max : p.min) : Math.round(slot.params[p.key]);
    const row = seg(p.label, options, now, (v) => {
      slot.params[p.key] = v;
      io.live(slot.id, p.key, v);
      io.commit();
      moved();
    });
    rows[p.key] = row;
    return row;
  }
  // On the Grain v12 page, a knob: the same value by the same routes
  // (`fxModel`), on its own face only (`gsFxKnobs`).
  if (gsFxKnobs() && io.live === liveParam) {
    const k = fxKnob(fxModel(slot), p, moved);
    rows[p.key] = k;
    return k;
  }
  const stepped = p.step === 1;
  const format = p.choices ? (v) => p.choices[Math.round(v - p.min)] ?? String(Math.round(v))
    : stepped ? (v) => String(Math.round(v)) : (v) => fxValueFormat(p, v);
  const row = param(p.label, slot.params[p.key], p.min, p.max, stepped ? 1 : (p.max - p.min) / 400, format,
    (v) => {
      const value = stepped ? Math.round(v) : v;
      slot.params[p.key] = value;
      io.live(slot.id, p.key, value);
      moved();
    },
    () => { io.commit(); }, p.log && !stepped, p.default);
  rows[p.key] = row;
  return row;
}

/// A value from a place along a control's travel: the inverse of `automationUnit`.
function unitValue(unit, min, max, log = false) {
  const u = Math.max(0, Math.min(1, unit));
  return log && min > 0 ? min * Math.pow(max / min, u) : min + (max - min) * u;
}

/// The Prism pad: two controls on one surface, across and up.
///
/// Hyperprism's whole interface, in miniature. Each axis covers the part of its
/// control's range the effect declares, which may be narrower than the
/// slider's: the useful part, rather than everything the control can reach.
function prismModulePad(slot, px, py, pad, rows) {
  const el = document.createElement('div');
  el.className = 'prism-pad';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', `${px.label} across, ${py.label} up`);
  el.title = `${px.label} across · ${py.label} up`;
  const dot = document.createElement('i');
  dot.className = 'prism-pad-dot';
  el.appendChild(dot);
  const axes = [[px, pad.xMin, pad.xMax], [py, pad.yMin, pad.yMax]];
  const place = () => {
    const [u, w] = axes.map(([p, lo, hi]) => automationUnit(slot.params[p.key], lo, hi, p.log));
    dot.style.left = `${u * 100}%`;
    dot.style.top = `${(1 - w) * 100}%`;
  };
  const move = (event) => {
    const r = el.getBoundingClientRect();
    const units = [(event.clientX - r.left) / r.width, 1 - (event.clientY - r.top) / r.height];
    axes.forEach(([p, lo, hi], i) => {
      let v = unitValue(units[i], lo, hi, p.log);
      if (p.step === 1) v = Math.round(v);
      slot.params[p.key] = v;
      liveParam(slot.id, p.key, v);
      rows[p.key]?.sync(v);
    });
    place();
  };
  el.onpointerdown = (event) => {
    event.preventDefault();
    el.setPointerCapture?.(event.pointerId);
    move(event);
    el.onpointermove = move;
  };
  el.onpointerup = el.onpointercancel = () => {
    if (!el.onpointermove) return;
    el.onpointermove = null;
    commitRack();
  };
  place();
  return el;
}

function renderDattorroFilterBank(box,slot,shaper){
  slot.params=slot.params||{};for(const p of shaper.params)if(slot.params[p.key]===undefined)slot.params[p.key]=p.default;
  box.classList.add('visual-filter-bank-controls');const graph=document.createElement('div');graph.className='filter-bank-graph';graph.innerHTML='<canvas class="filter-bank-canvas"></canvas><div class="filter-bank-readout"></div><div class="filter-bank-tabs"></div><div class="filter-bank-selected-controls"></div>';box.appendChild(graph);const canvas=graph.querySelector('canvas'),readout=graph.querySelector('.filter-bank-readout'),tabs=graph.querySelector('.filter-bank-tabs'),controlsBox=graph.querySelector('.filter-bank-selected-controls');
  const filters=[
    {name:'Notch',color:'#e35b52',on:'notchOn',hz:'notchHz',q:'notchQ',amp:'notchAmp'},
    {name:'Resonator',color:'#dc9d46',on:'resonatorOn',hz:'resonatorHz',q:'resonatorQ',amp:'resonatorAmp'},
    {name:'Regalia–Mitra',color:'#62d374',on:'regaliaOn',hz:'regaliaHz',q:'regaliaQ',amp:'regaliaAmp'},
    {name:'Damping',color:'#62aeda',on:'dampingOn',hz:'dampingHz',q:'dampingQ',amp:'dampingAmp'}];let selected=0;
  const curve=(f,hz)=>{const p=slot.params,q=p[f.q],amp=p[f.amp];if(f.name==='Notch')return-24*amp*Math.exp(-Math.pow(Math.log(hz/p[f.hz])*q,2)*5);if(f.name==='Resonator')return 14*amp*Math.exp(-Math.pow(Math.log(hz/p[f.hz])*q,2));if(f.name==='Damping')return 20*amp*Math.log10(1/Math.sqrt(1+Math.pow(hz/p[f.hz],2*Math.max(.2,q))));return 12*amp*Math.exp(-Math.pow(Math.log(hz/p[f.hz])*q,2));};
  const draw=()=>{const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;const d=devicePixelRatio||1;canvas.width=w*d;canvas.height=h*d;const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);const xf=hz=>Math.log(hz/20)/Math.log(1000)*w,yf=db=>h/2-db/48*h;c.fillStyle='#090b0d';c.fillRect(0,0,w,h);c.strokeStyle='rgba(255,255,255,.1)';for(const hz of [20,100,1000,10000,20000]){const x=xf(hz);c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}c.beginPath();c.moveTo(0,yf(0));c.lineTo(w,yf(0));c.stroke();filters.forEach((f,i)=>{if(slot.params[f.on]<.5)return;const pts=[];for(let x=0;x<=w;x+=2){const hz=20*Math.pow(1000,x/w);pts.push([x,yf(curve(f,hz))]);}c.beginPath();c.moveTo(0,yf(0));pts.forEach(([x,y])=>c.lineTo(x,y));c.lineTo(w,yf(0));c.closePath();c.globalAlpha=.22;c.fillStyle=f.color;c.fill();c.globalAlpha=1;c.beginPath();pts.forEach(([x,y],j)=>j?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=f.color;c.stroke();const x=xf(slot.params[f.hz]),y=yf(curve(f,slot.params[f.hz]));c.beginPath();c.arc(x,y,i===selected?9:7,0,Math.PI*2);c.fillStyle=i===selected?'#f4f7f9':f.color;c.fill();c.fillStyle='#20252a';c.textAlign='center';c.textBaseline='middle';c.font='bold 9px sans-serif';c.fillText(String(i+1),x,y);});};
  const controls=()=>{tabs.innerHTML='';filters.forEach((f,i)=>{const b=document.createElement('button');b.className='filter-bank-tab'+(i===selected?' selected':'')+(slot.params[f.on]<.5?' off':'');b.style.setProperty('--filter-color',f.color);b.textContent=f.name;b.onclick=()=>{selected=i;controls();};tabs.appendChild(b);});controlsBox.innerHTML='';const f=filters[selected],toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=slot.params[f.on]>=.5?'On':'Off';toggle.onclick=()=>{slot.params[f.on]=slot.params[f.on]>=.5?0:1;controls();pushRack({immediate:true});};controlsBox.appendChild(toggle);const add=(label,key,min,max,unit='',log=false)=>{let last=slot.params[key];controlsBox.appendChild(param(label,slot.params[key],min,max,(max-min)/400,v=>fxValueFormat({unit,min,max},v),v=>{last=v;slot.params[key]=v;draw();read();liveParam(slot.id,key,v);},()=>{commitRack();},log,shaperBorn(slot.kind,key)));};add('Frequency',f.hz,20,20000,'Hz',true);add('Q',f.q,.2,18);add('Amplitude',f.amp,0,1);read();draw();function read(){readout.textContent=`${f.name.toUpperCase()} · ${fxValueFormat({unit:'Hz'},slot.params[f.hz])} · Q ${slot.params[f.q].toFixed(2)} · AMP ${Math.round(slot.params[f.amp]*100)}% · ${slot.params[f.on]>=.5?'ON':'OFF'}`;}};
  const pick=e=>{const r=canvas.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top,xf=hz=>Math.log(hz/20)/Math.log(1000)*r.width,yf=db=>r.height/2-db/48*r.height;return filters.map((f,i)=>[i,Math.hypot(px-xf(slot.params[f.hz]),py-yf(curve(f,slot.params[f.hz])))]).sort((a,b)=>a[1]-b[1])[0][0];};let dragging=false;canvas.onpointerdown=e=>{selected=pick(e);dragging=true;canvas.setPointerCapture(e.pointerId);controls();};canvas.onpointermove=e=>{if(!dragging)return;const r=canvas.getBoundingClientRect(),f=filters[selected];slot.params[f.hz]=20*Math.pow(1000,Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));slot.params[f.q]=Math.max(.2,Math.min(18,(1-(e.clientY-r.top)/r.height)*18));draw();liveParam(slot.id,f.hz,slot.params[f.hz]);liveParam(slot.id,f.q,slot.params[f.q]);};canvas.onpointerup=e=>{const f=filters[selected];dragging=false;try{canvas.releasePointerCapture(e.pointerId);}catch{}controls();pushRack({immediate:true});};controls();
  requestAnimationFrame(draw);new ResizeObserver(draw).observe(canvas);
}

const CHAMBERLIN_COLORS={low:'#62aeda',band:'#62d374',high:'#dc9d46',notch:'#aa78d0'};
function drawVisualChamberlin(canvas,p){
  const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;const d=devicePixelRatio||1;canvas.width=w*d;canvas.height=h*d;
  const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);const xf=hz=>Math.log(hz/20)/Math.log(1000)*w,yf=db=>h/2-db/36*h;
  c.fillStyle='#090b0d';c.fillRect(0,0,w,h);c.strokeStyle='rgba(255,255,255,.1)';for(const hz of [20,100,1000,10000,20000]){const x=xf(hz);c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}c.beginPath();c.moveTo(0,yf(0));c.lineTo(w,yf(0));c.stroke();
  if(engine.spectrum?.length){const bins=engine.spectrum,nyquist=(engine.deviceRate||48000)/2;c.beginPath();c.moveTo(0,h);for(let i=1;i<bins.length;i++){const hz=i/(bins.length-1)*nyquist;if(hz>=20&&hz<=20000)c.lineTo(xf(hz),h-bins[i]/255*h*.9);}c.lineTo(w,h);c.closePath();c.fillStyle='rgba(52,137,202,.18)';c.fill();}
  const filters=['low','band','high','notch'];for(const [index,key] of filters.entries()){const freq=p[key+'Freq'],q=p[key+'Q'],amp=p[key+'Amp'];if(amp<=.001)continue;const response=hz=>key==='low'?-10*Math.log10(1+Math.pow(hz/freq,4)):key==='high'?-10*Math.log10(1+Math.pow(freq/hz,4)):key==='band'?-18*Math.pow(Math.log(hz/freq)*q,2):-18*Math.exp(-Math.pow(Math.log(hz/freq)*q,2)*4);const pts=[];for(let x=0;x<=w;x+=2){const hz=20*Math.pow(1000,x/w);pts.push([x,yf(response(hz)*amp)]);}c.beginPath();c.moveTo(0,yf(0));pts.forEach(([x,y])=>c.lineTo(x,y));c.lineTo(w,yf(0));c.closePath();c.globalAlpha=.2;c.fillStyle=CHAMBERLIN_COLORS[key];c.fill();c.globalAlpha=1;c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=CHAMBERLIN_COLORS[key];c.stroke();const nx=xf(freq),ny=h*(.84-Math.min(1,q/10)*.66);c.beginPath();c.arc(nx,ny,8,0,Math.PI*2);c.fillStyle=CHAMBERLIN_COLORS[key];c.fill();c.fillStyle='#20252a';c.textAlign='center';c.textBaseline='middle';c.font='bold 9px sans-serif';c.fillText(String(index+1),nx,ny);}
  c.textAlign='right';c.textBaseline='alphabetic';c.fillStyle='rgba(93,184,245,.7)';c.font='8px ui-monospace, Menlo, monospace';c.fillText('POST FILTER',w-4,10);
}
function repaintVisualChamberlins(){document.querySelectorAll('.fx-module.chamberlin-visual').forEach(module=>{const slot=state.rack?.slots[+module.dataset.slot],canvas=module.querySelector('.chamberlin-graph canvas');if(slot&&canvas)drawVisualChamberlin(canvas,slot.params);});}
function renderVisualChamberlin(box,slot,shaper){
  slot.params=slot.params||{};for(const p of shaper.params)if(slot.params[p.key]===undefined)slot.params[p.key]=p.default;box.classList.add('visual-chamberlin-controls');
  const graph=document.createElement('div');graph.className='chamberlin-graph';graph.innerHTML='<canvas></canvas><div class="chamberlin-readout"></div><div class="chamberlin-sliders"></div>';box.appendChild(graph);const canvas=graph.querySelector('canvas'),readout=graph.querySelector('.chamberlin-readout'),stack=graph.querySelector('.chamberlin-sliders');
  let selected='low';const redraw=()=>{readout.textContent=`${selected.toUpperCase()} · ${fxValueFormat({unit:'Hz'},slot.params[selected+'Freq'])} · Q ${slot.params[selected+'Q'].toFixed(2)} · AMP ${Math.round(slot.params[selected+'Amp']*100)}%`;drawVisualChamberlin(canvas,slot.params);};
  let selectedRows=[];const controls=()=>{stack.innerHTML='';const tabs=document.createElement('div');tabs.className='filter-bank-tabs';for(const [key,label] of [['low','Low pass'],['band','Band pass'],['high','High pass'],['notch','Notch']]){const button=document.createElement('button');button.className='filter-bank-tab'+(key===selected?' selected':'')+(slot.params[key+'On']<.5?' off':'');button.style.setProperty('--filter-color',CHAMBERLIN_COLORS[key]);button.textContent=label;button.onclick=()=>{selected=key;controls();};tabs.appendChild(button);}stack.appendChild(tabs);const toggle=document.createElement('button');toggle.className='ghost';toggle.textContent=slot.params[selected+'On']>=.5?'On':'Off';toggle.onclick=()=>{const key=selected+'On';slot.params[key]=slot.params[key]>=.5?0:1;controls();pushRack({immediate:true});};stack.appendChild(toggle);const add=(label,key,min,max,unit='',log=false)=>{let last=slot.params[key];const row=param(label,slot.params[key],min,max,(max-min)/400,v=>fxValueFormat({unit,min,max},v),v=>{last=v;slot.params[key]=v;redraw();liveParam(slot.id,key,v);},()=>{commitRack();},log,shaperBorn(slot.kind,key));stack.appendChild(row);return row;};selectedRows=[add('Frequency',selected+'Freq',20,18000,'Hz',true),add('Q',selected+'Q',.2,10),add('Amplitude',selected+'Amp',0,1)];add('Drive','drive',.25,8,'x',true);redraw();};
  const pick=(e)=>{const r=canvas.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top,xf=hz=>Math.log(hz/20)/Math.log(1000)*r.width;return ['low','band','high','notch'].map(key=>[key,Math.hypot(px-xf(slot.params[key+'Freq']),py-r.height*(.84-Math.min(1,slot.params[key+'Q']/10)*.66))]).sort((a,b)=>a[1]-b[1])[0][0];};let dragging=false;canvas.onpointerdown=e=>{selected=pick(e);dragging=true;canvas.setPointerCapture(e.pointerId);controls();};canvas.onpointermove=e=>{if(!dragging)return;const r=canvas.getBoundingClientRect(),freq=selected+'Freq',q=selected+'Q';slot.params[freq]=20*Math.pow(1000,Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));slot.params[q]=Math.max(.2,Math.min(10,(1-(e.clientY-r.top)/r.height)*10));selectedRows[0].sync(slot.params[freq]);selectedRows[1].sync(slot.params[q]);redraw();liveParam(slot.id,freq,slot.params[freq]);liveParam(slot.id,q,slot.params[q]);};canvas.onpointerup=e=>{const freq=selected+'Freq',q=selected+'Q';dragging=false;try{canvas.releasePointerCapture(e.pointerId);}catch{}pushRack({immediate:true});};controls();requestAnimationFrame(redraw);new ResizeObserver(redraw).observe(canvas);
}

function drawVisualCompressor(canvas, slot, slotIndex) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const level=compressorLevels.get(slotIndex)||{db:-60,reduction:0};
  const samples=engine.waveform||[];
  const signalTop=h*.28, signalBottom=h*.94;
  const signalY=(db)=>signalBottom-(Math.max(-60,Math.min(0,db))+60)/60*(signalBottom-signalTop);
  ctx.fillStyle = '#090b0d'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.11)'; ctx.lineWidth = 1;
  for (const db of [-60, -40, -20, 0]) {
    const y=signalY(db);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.38)';ctx.font='8px ui-monospace, Menlo, monospace';ctx.textAlign='left';ctx.fillText(`${db}`,3,y-2);
  }
  if(samples.length){
    const mid=(signalTop+signalBottom)/2,amp=(signalBottom-signalTop)*.46;
    ctx.beginPath();samples.forEach((sample,i)=>{const x=i/(samples.length-1)*w,y=mid-sample/127*amp;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.lineTo(w,mid);ctx.lineTo(0,mid);ctx.closePath();ctx.fillStyle='rgba(174,181,188,.24)';ctx.fill();
    ctx.beginPath();samples.forEach((sample,i)=>{const x=i/(samples.length-1)*w,y=mid-sample/127*amp;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle='rgba(190,197,203,.78)';ctx.lineWidth=1.15;ctx.stroke();
  }
  const reductionY=6+level.reduction/30*(signalTop-12);ctx.beginPath();ctx.moveTo(0,reductionY);ctx.lineTo(w,reductionY);ctx.strokeStyle='#e6c83f';ctx.lineWidth=2;ctx.stroke();
  const kneeTop=signalY(slot.thresholdDb+slot.kneeDb/2),kneeBottom=signalY(slot.thresholdDb-slot.kneeDb/2);
  if(slot.kneeDb>0){ctx.fillStyle='rgba(73,174,232,.13)';ctx.fillRect(0,kneeTop,w,kneeBottom-kneeTop);ctx.setLineDash([3,3]);ctx.strokeStyle='rgba(73,174,232,.42)';ctx.beginPath();ctx.moveTo(0,kneeTop);ctx.lineTo(w,kneeTop);ctx.moveTo(0,kneeBottom);ctx.lineTo(w,kneeBottom);ctx.stroke();ctx.setLineDash([]);}
  const thresholdY=signalY(slot.thresholdDb);ctx.beginPath();ctx.moveTo(0,thresholdY);ctx.lineTo(w,thresholdY);ctx.strokeStyle='#49aee8';ctx.lineWidth=1.5;ctx.stroke();
  ctx.font='8px ui-monospace, Menlo, monospace';ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.fillStyle='#e6c83f';ctx.fillText('GAIN REDUCTION',4,10);
  ctx.textAlign='right';ctx.fillStyle='#49aee8';ctx.fillText(`THRESH ${slot.thresholdDb.toFixed(1)} dB`,w-4,thresholdY-3);
  if(slot.kneeDb>0)ctx.fillText(`KNEE ${slot.kneeDb.toFixed(1)} dB`,w-4,Math.max(kneeTop+10,thresholdY+10)); // C10: never printed over THRESH
  ctx.fillStyle='rgba(190,197,203,.65)';ctx.fillText('LIVE SIGNAL',w-4,h-4);
}

function repaintVisualCompressors() {
  fxFaceLiveRepaint();
  document.querySelectorAll('.fx-module.comp-visual').forEach((module) => {
    const slot=state.rack?.slots[+module.dataset.slot],canvas=module.querySelector('.comp-graph canvas');
    if(slot&&canvas)drawVisualCompressor(canvas,slot,+module.dataset.slot);
  });
}

function renderVisualCompressor(box, slot) {
  box.classList.add('visual-comp-controls');
  const graph=document.createElement('div');graph.className='comp-graph';graph.innerHTML='<canvas></canvas><div class="comp-slider-stack"></div>';
  box.appendChild(graph);const canvas=graph.querySelector('canvas'),stack=graph.querySelector('.comp-slider-stack');
  const slotIndex=state.rack.slots.indexOf(slot);
  const redraw=()=>drawVisualCompressor(canvas,slot,slotIndex);
  const add=(label,key,value,min,max,step,format,set,log=false)=>{let last=value;const target=`fx.${slot.id}.${key}`;const row=param(label,value,min,max,step,format,
    v=>{last=v;set(v);redraw();liveParam(slot.id,key,v);},()=>{commitRack();},log,fxBorn(slot.kind,key));stack.appendChild(row);return row;};
  const thresholdRow=add('Threshold','thresholdDb',slot.thresholdDb,-60,0,.5,v=>`${v.toFixed(1)} dB`,v=>{slot.thresholdDb=v;});
  add('Ratio','ratio',slot.ratio,1,20,.1,v=>`${v.toFixed(1)}:1`,v=>{slot.ratio=v;});
  add('Attack','attackMs',slot.attackMs,.05,500,.1,v=>`${v.toFixed(1)} ms`,v=>{slot.attackMs=v;},true);
  add('Release','releaseMs',slot.releaseMs,5,3000,1,v=>`${Math.round(v)} ms`,v=>{slot.releaseMs=v;},true);
  const kneeRow=add('Knee','kneeDb',slot.kneeDb,0,24,.5,v=>`${v.toFixed(1)} dB`,v=>{slot.kneeDb=v;});
  add('Makeup','makeupDb',slot.makeupDb,-24,24,.1,v=>`${v.toFixed(1)} dB`,v=>{slot.makeupDb=v;});
  let dragging=false;
  canvas.addEventListener('pointerdown',e=>{dragging=true;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;const r=canvas.getBoundingClientRect();const top=r.height*.28,bottom=r.height*.94;slot.thresholdDb=Math.max(-60,Math.min(0,-60+(bottom-(e.clientY-r.top))/(bottom-top)*60));slot.kneeDb=Math.max(0,Math.min(24,(e.clientX-r.left)/r.width*24));thresholdRow.sync(slot.thresholdDb);kneeRow.sync(slot.kneeDb);redraw();liveParam(slot.id,'thresholdDb',slot.thresholdDb);liveParam(slot.id,'kneeDb',slot.kneeDb);});
  canvas.addEventListener('pointerup',e=>{dragging=false;try{canvas.releasePointerCapture(e.pointerId);}catch{}pushRack({immediate:true});});
  requestAnimationFrame(redraw);new ResizeObserver(redraw).observe(canvas);
}

function defaultEqBands() {
  return [
    {type:'highpass',enabled:false,freq:30,q:.71,gainDb:0},
    {type:'lowshelf',enabled:true,freq:100,q:.7,gainDb:0},
    {type:'bell',enabled:true,freq:250,q:1,gainDb:0},
    {type:'bell',enabled:false,freq:500,q:1,gainDb:0},
    {type:'bell',enabled:false,freq:2000,q:1,gainDb:0},
    {type:'bell',enabled:false,freq:4000,q:1,gainDb:0},
    {type:'highshelf',enabled:true,freq:10000,q:.7,gainDb:0},
    {type:'lowpass',enabled:false,freq:18000,q:.71,gainDb:0},
  ];
}

const EQ_TYPES = [
  ['highpass','╱','High-pass'], ['lowshelf','⌞','Low shelf'], ['bell','⌒','Bell'],
  ['notch','∨','Notch'], ['highshelf','⌝','High shelf'], ['lowpass','╲','Low-pass'],
];
const EQ_COLORS=['#e35b52','#dc9d46','#b5d34b','#62d374','#52cbb0','#62aeda','#aa78d0','#7b8188'];

function drawVisualEq(canvas, slot, selected) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const xFor = (hz) => Math.log(hz / 20) / Math.log(1000) * w;
  const hzFor = (x) => 20 * Math.pow(1000, Math.max(0, Math.min(1, x / w)));
  const yFor = (db) => h / 2 - db / 36 * h;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#090b0d'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
  for (const hz of [20, 100, 1000, 10000, 20000]) { const x=xFor(hz); ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke(); }
  for (const db of [-12, 0, 12]) { const y=yFor(db);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke(); }
  if (engine.spectrum?.length) {
    const bins = engine.spectrum, nyquist = (engine.deviceRate || 48000) / 2;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 1; i < bins.length; i++) {
      const hz = i / (bins.length - 1) * nyquist;
      if (hz < 20 || hz > 20000) continue;
      ctx.lineTo(xFor(hz), h - bins[i] / 255 * h * .92);
    }
    ctx.lineTo(w, h); ctx.closePath();
    ctx.fillStyle = 'rgba(52,137,202,.26)'; ctx.fill();
    ctx.strokeStyle = 'rgba(93,184,245,.72)'; ctx.lineWidth = 1; ctx.stroke();
  }
  const bands=slot.bands||defaultEqBands();
  const bandResponse = (b,hz) => {if(!b.enabled)return 0;
    if(b.type==='highpass')return 20*Math.log10(1/Math.sqrt(1+Math.pow(b.freq/hz,4)));
    if(b.type==='lowpass')return 20*Math.log10(1/Math.sqrt(1+Math.pow(hz/b.freq,4)));
    if(b.type==='notch')return b.gainDb*Math.exp(-Math.pow(Math.log(hz/b.freq)*b.q,2)*5);
    if(b.type==='lowshelf')return b.gainDb/(1+Math.pow(hz/b.freq,2*Math.max(.2,b.q)));
    if(b.type==='highshelf')return b.gainDb/(1+Math.pow(b.freq/hz,2*Math.max(.2,b.q)));
    return b.gainDb*Math.exp(-Math.pow(Math.log(hz/b.freq)*b.q,2));};
  const response = (hz) => bands.reduce((sum,b)=>sum+bandResponse(b,hz),0);
  bands.forEach((band,i)=>{if(!band.enabled)return;const bp=[];for(let x=0;x<=w;x+=2)bp.push([x,yFor(bandResponse(band,hzFor(x)))]);ctx.beginPath();ctx.moveTo(0,yFor(0));bp.forEach(([x,y])=>ctx.lineTo(x,y));ctx.lineTo(w,yFor(0));ctx.closePath();ctx.globalAlpha=.18;ctx.fillStyle=EQ_COLORS[i];ctx.fill();ctx.globalAlpha=1;});
  const points=[]; for(let x=0;x<=w;x+=2) points.push([x,yFor(response(hzFor(x)))]);
  ctx.beginPath();ctx.moveTo(0,h);for(const [x,y] of points)ctx.lineTo(x,y);ctx.lineTo(w,h);ctx.closePath();
  ctx.fillStyle='rgba(94,190,52,.25)';ctx.fill(); ctx.beginPath();
  points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle='#78dd42';ctx.lineWidth=1.8;ctx.stroke();
  bands.forEach((b,i)=>{const x=xFor(b.freq),y=yFor(['highpass','lowpass','notch'].includes(b.type)?0:b.gainDb);ctx.beginPath();ctx.arc(x,y,i===selected?9:7,0,Math.PI*2);ctx.fillStyle=!b.enabled?'#454a50':i===selected?'#f4f7f9':EQ_COLORS[i];ctx.fill();ctx.fillStyle='#20252a';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);});
  ctx.fillStyle='rgba(255,255,255,.45)';ctx.font='8px ui-monospace, Menlo, monospace';ctx.textAlign='left';ctx.fillText('20',3,h-4);ctx.fillText('100',xFor(100)+2,h-4);ctx.fillText('1k',xFor(1000)+2,h-4);ctx.fillText('10k',xFor(10000)+2,h-4);
  ctx.textAlign='right';ctx.fillStyle='rgba(93,184,245,.7)';ctx.fillText('POST FILTER',w-4,10);
}

function repaintVisualEqs() {
  document.querySelectorAll('.fx-module.eq-visual').forEach((module) => {
    const slot = state.rack?.slots[+module.dataset.slot];
    const canvas = module.querySelector('.eq-graph canvas');
    if (slot && canvas) drawVisualEq(canvas, slot, +(module.querySelector('.eq-graph')?.dataset.selected || 2));
  });
}

const eqBandSelections = new Map();
function renderVisualEq(box, slot, slotIndex) {
  slot.bands=slot.bands||defaultEqBands();
  box.classList.add('visual-eq-controls');
  const graph = document.createElement('div'); graph.className='eq-graph';
  graph.innerHTML='<canvas></canvas><div class="eq-selected"></div><div class="eq-slider-stack"></div>';
  box.appendChild(graph); const canvas=graph.querySelector('canvas'); const stack=graph.querySelector('.eq-slider-stack');
  let selected=eqBandSelections.get(slotIndex) ?? 2;
  const current=()=>slot.bands[selected];
  const redraw=()=>{graph.dataset.selected=selected;const b=current();graph.querySelector('.eq-selected').textContent=`BAND ${selected+1} · ${b.type.toUpperCase()} · ${b.enabled?'ON':'OFF'} · ${fxValueFormat({unit:'Hz'},b.freq)} · ${b.gainDb.toFixed(1)} dB · Q ${b.q.toFixed(2)}`;drawVisualEq(canvas,slot,selected);};
  const controls=()=>{
    stack.innerHTML=''; const band=current();
    const toolbar=document.createElement('div');toolbar.className='eq-band-toolbar';
    const enabled=document.createElement('button');enabled.className='ghost';enabled.textContent=band.enabled?'On':'Off';enabled.onclick=()=>{band.enabled=!band.enabled;controls();pushRack({immediate:true});};
    const shapes=document.createElement('div');shapes.className='eq-shape-icons';for(const [value,icon,label] of EQ_TYPES){const button=document.createElement('button');button.type='button';button.className='eq-shape-icon'+(band.type===value?' selected':'');button.textContent=icon;button.title=label;button.setAttribute('aria-label',label);button.onclick=()=>{band.type=value;if(value==='notch'&&Math.abs(band.gainDb)<.01)band.gainDb=-12;controls();pushRack({immediate:true});};shapes.appendChild(button);}toolbar.append(enabled,shapes);stack.appendChild(toolbar);
    const target=k=>`fx.${slot.id}.band.${selected}.${k}`;
    stack.appendChild(param('Frequency',band.freq,20,20000,1,v=>fxValueFormat({unit:'Hz'},v),v=>{band.freq=v;redraw();liveParam(slot.id,`band.${selected}.freq`,v);},()=>{commitRack();},true, eqBorn(selected, 'freq')));
    if(!['highpass','lowpass'].includes(band.type))stack.appendChild(param('Q',band.q,.05,18,.05,v=>v.toFixed(2),v=>{band.q=v;redraw();liveParam(slot.id,`band.${selected}.q`,v);},()=>{commitRack();}, false, eqBorn(selected, 'q')));
    if(!['highpass','lowpass'].includes(band.type))stack.appendChild(param('Gain',band.gainDb,-24,24,.1,v=>`${v.toFixed(1)} dB`,v=>{band.gainDb=v;redraw();liveParam(slot.id,`band.${selected}.gainDb`,v);},()=>{commitRack();}, false, eqBorn(selected, 'gainDb')));
    redraw();
  };
  const pick=(x,y)=>{const rect=canvas.getBoundingClientRect(),px=x-rect.left,py=y-rect.top,xFor=hz=>Math.log(hz/20)/Math.log(1000)*rect.width,yFor=db=>rect.height/2-db/36*rect.height;return slot.bands.map((b,i)=>[i,Math.hypot(px-xFor(b.freq),py-yFor(['highpass','lowpass','notch'].includes(b.type)?0:b.gainDb))]).sort((a,b)=>a[1]-b[1])[0][0];};
  let dragging=false;
  canvas.addEventListener('pointerdown',e=>{selected=pick(e.clientX,e.clientY);eqBandSelections.set(slotIndex,selected);dragging=true;canvas.setPointerCapture(e.pointerId);controls();});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;const r=canvas.getBoundingClientRect(),band=current(),base=`fx.${slot.id}.band.${selected}`;band.freq=20*Math.pow(1000,Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));if(!['highpass','lowpass'].includes(band.type))band.gainDb=Math.max(-24,Math.min(24,(r.height/2-(e.clientY-r.top))/r.height*36));redraw();liveParam(slot.id,`${'band.'}${selected}.freq`,band.freq);if(!['highpass','lowpass'].includes(band.type))liveParam(slot.id,`${'band.'}${selected}.gainDb`,band.gainDb);});
  canvas.addEventListener('pointerup',e=>{const band=current(),base=`fx.${slot.id}.band.${selected}`;dragging=false;try{canvas.releasePointerCapture(e.pointerId);}catch{}controls();pushRack({immediate:true});});
  controls(); requestAnimationFrame(redraw);
  new ResizeObserver(redraw).observe(canvas);
}

/// One labelled slider bound to a field on the selected slot.
/// A labelled slider.
///
/// `log` puts the control on a logarithmic curve. That is not decoration: the
/// stretch runs from a hundredth to a hundred times, and on a linear slider 1×
/// would sit at one percent of the travel, with everything musically useful
/// crushed against the left stop. On a log curve 1× sits in the middle and each
/// doubling takes the same distance.
function param(label, value, min, max, step, format, onChange, onCommit, log, def) {
  const el = document.createElement('div');
  el.className = 'param';
  // Name, control, reading — one line, three columns, and the columns are the
  // same width everywhere so a panel reads down as a table rather than as a
  // stack of separately-sized things.
  el.innerHTML = `<span class="k"></span><input type="range"><span class="v"></span>`;
  const name = el.querySelector('.k');
  name.textContent = label;
  // The column is narrower than the longest label, so the full name stays
  // reachable rather than being lost to the ellipsis.
  name.title = label;
  const out = el.querySelector('.v');
  const input = el.querySelector('input');

  // Position 0..1000 on the element, mapped to the real value.
  const TICKS = 1000;
  const toPos = (v) =>
    log ? (Math.log(Math.max(v, min) / min) / Math.log(max / min)) * TICKS
        : v;
  const toVal = (p) =>
    log ? min * Math.pow(max / min, p / TICKS)
        : p;

  if (log) Object.assign(input, { min: 0, max: TICKS, step: 1, value: toPos(value) });
  else Object.assign(input, { min, max, step, value });
  out.textContent = format(value);

  // The readout is updated from the element itself, so a redraw elsewhere
  // cannot leave the number disagreeing with the handle.
  const show = (v) => {
    const t = format(v);
    out.textContent = t;
    // Same reason as the label: the reading has a column, and some of these
    // say a word rather than a number.
    out.title = t;
  };
  el.sync = (v) => { input.value = toPos(v); show(v); };
  // The value itself, for a picture drawn from it (`grain-glyphs.js`) — the
  // element holds a position, which on a log control is not the value.
  el.read = () => toVal(+input.value);

  input.oninput = () => {
    const v = toVal(+input.value);
    show(v);
    onChange(v);
  };
  // Fires on pointer release, which is when the change is worth committing
  // properly rather than previewing.
  if (onCommit) input.onchange = () => onCommit(toVal(+input.value));

  // Double-click puts it back where it started.
  //
  // Only when a default was given. A control that quietly did nothing on a
  // double-click would be worse than one that plainly has no default, and
  // guessing — the midpoint, or zero, or whatever it happened to be built
  // with — would put values in that were never the default of anything.
  if (def === undefined || def === null || !Number.isFinite(def)) {
    // Not an error — `check` and the switches have no meaningful default, and a
    // control that resets to something which was never anybody's default is
    // worse than one that plainly does nothing. But a *slider* without one is
    // almost always an oversight, and the only reason `position` went years
    // without a reset is that this said nothing at all.
    console.warn(`control "${label}" has no default — double-click will not reset it`);
  }
  if (def !== undefined && def !== null && Number.isFinite(def)) {
    el.title = `${label} — double-click to reset to ${format(def)}`;
    const reset = (e) => {
      e.preventDefault();
      el.sync(def);
      onChange(def);
      if (onCommit) onCommit(def);
    };
    input.ondblclick = reset;
    // The label too: the slider is a thin target, and the row is what reads as
    // "this parameter".
    name.ondblclick = reset;
    out.ondblclick = reset;
  }
  return el;
}


