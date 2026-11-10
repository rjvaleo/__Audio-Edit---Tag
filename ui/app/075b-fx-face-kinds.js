// ──────────────────────────────────────────────────────────── the generic face

/// Display, then the controls in their sections, packed into rows that each
/// run the module's full width.
function fxDeckFace(box, m, el) {
  const panel = fxPanelOf(m.slot.kind, new Set(m.specs.map((p) => p.key)));
  const groups = panel?.groups?.length ? panel.groups : [{ label: '', keys: m.specs.map((p) => p.key) }];
  const pad = panel?.pad && m.byKey[panel.pad.x] && m.byKey[panel.pad.y] ? panel.pad : null;
  const heroKey = FXP.heroFor(m.slot.kind);
  const controls = {};
  const hw = document.createElement('div');
  hw.className = 'fx-face-display';
  const hero = () => {
    const draw = FXP.HERO[heroKey];
    if (!draw) { hw.hidden = true; return; }
    const v = m.values();
    let inner = draw(v);
    if (pad) {
      const px = m.byKey[pad.x], py = m.byKey[pad.y];
      inner += FXP.padMark(automationUnit(v[pad.x], pad.xMin, pad.xMax, fxIsLog(px)), automationUnit(v[pad.y], pad.yMin, pad.yMax, fxIsLog(py)), px.label, py.label);
    }
    hw.innerHTML = FXP.display(inner);
  };
  // The display is the effect's pad too: drag in it and its two main controls
  // follow, as the Prism pad does.
  if (pad) {
    const px = m.byKey[pad.x], py = m.byKey[pad.y];
    hw.classList.add('is-pad');
    hw.title = `Drag: ${px.label} across, ${py.label} up`;
    const drag = (e) => {
      const b = hw.getBoundingClientRect();
      m.set(px.key, fxClamp(px, unitValue((e.clientX - b.left) / b.width, pad.xMin, pad.xMax, fxIsLog(px))));
      m.set(py.key, fxClamp(py, unitValue(1 - (e.clientY - b.top) / b.height, pad.yMin, pad.yMax, fxIsLog(py))));
      controls[px.key]?.sync(); controls[py.key]?.sync();
      hero();
    };
    hw.addEventListener('pointerdown', (e) => { hw.setPointerCapture(e.pointerId); drag(e); });
    hw.addEventListener('pointermove', (e) => { if (hw.hasPointerCapture(e.pointerId)) drag(e); });
    hw.addEventListener('pointerup', (e) => { if (hw.hasPointerCapture(e.pointerId)) { hw.releasePointerCapture(e.pointerId); m.commit(); } });
  }
  const deck = document.createElement('div');
  deck.className = 'fx-deck';
  const secs = [], techRows = [];
  for (const g of groups) {
    const keys = g.keys.filter((k) => m.byKey[k]);
    if (!keys.length) continue;
    const sec = document.createElement('div');
    sec.className = 'fx-sect';
    sec.innerHTML = `${g.label ? '<b><span></span></b>' : ''}<div></div>`;
    if (g.label) sec.querySelector('b span').textContent = g.label;
    // A section's own switch is the lit square in its title.
    const onKey = g.label && keys.find((k) => /On$/.test(k));
    if (onKey) {
      const led = document.createElement('button');
      led.type = 'button';
      led.className = 'fx-led';
      led.setAttribute('aria-label', `${g.label} on`);
      const paint = () => { const on = m.get(onKey) >= .5; led.classList.toggle('on', on); led.setAttribute('aria-pressed', on); sec.classList.toggle('off', !on); };
      led.onclick = () => { m.set(onKey, m.get(onKey) >= .5 ? 0 : 1); paint(); hero(); m.commit(); };
      sec.querySelector('b').prepend(led);
      paint();
    }
    const tech = keys.some((k) => fxIsTech(m, k)) && keys.every((k) => fxIsTech(m, k) || fxIsSwitch(m.byKey[k]));
    if (tech) sec.classList.add('tech');
    for (const key of keys) {
      if (key === onKey) continue;
      const p = m.byKey[key], label = fxShort(p.label, g.label);
      if (tech && !fxIsSwitch(p)) { const c = fxSlider(m, p, hero, label); controls[key] = c; sec.querySelector('div').appendChild(c); continue; }
      if (fxIsTech(m, key) && !fxIsSwitch(p)) { const c = fxSlider(m, p, hero, label); controls[key] = c; techRows.push(c); continue; }
      const c = fxControl(m, p, hero, label);
      controls[key] = c;
      sec.querySelector('div').appendChild(c);
    }
    if (sec.querySelector('div').children.length) secs.push(sec);
  }
  // Rows of up to seven controls, faders counting for less than a knob, each
  // row stretched to the module's full width so none has an empty end.
  const weight = (sec) => [...sec.querySelector('div').children].reduce((a, c) => a + (c.classList.contains('fxf') ? .7 : 1), 0);
  const musical = secs.filter((s) => !s.classList.contains('tech'));
  let row = null, used = 0;
  for (const sec of musical) {
    const w = weight(sec);
    sec.style.setProperty('--n', w);
    if (!row || used + w > 7.5) { row = document.createElement('div'); row.className = 'fx-row'; deck.appendChild(row); used = 0; }
    row.appendChild(sec);
    used += w;
  }
  // A last row of one control joins the row above rather than standing alone.
  const rows = [...deck.children];
  if (rows.length > 1 && [...rows.at(-1).children].reduce((a, s) => a + weight(s), 0) <= 1.2) {
    [...rows.at(-1).children].forEach((s) => rows.at(-2).appendChild(s));
    rows.at(-1).remove();
  }
  for (const s of secs.filter((x) => x.classList.contains('tech'))) deck.appendChild(s);
  if (techRows.length) {
    const sec = document.createElement('div');
    sec.className = 'fx-sect tech';
    sec.innerHTML = '<b><span>Engine</span></b><div></div>';
    techRows.forEach((t) => sec.querySelector('div').appendChild(t));
    deck.appendChild(sec);
  }
  // A last row of one or two controls sits beside the engine sliders.
  const techs = [...deck.querySelectorAll(':scope > .fx-sect.tech')];
  const lastRow = [...deck.querySelectorAll(':scope > .fx-row')].at(-1);
  if (techs.length && lastRow && [...lastRow.children].reduce((a, s) => a + weight(s), 0) <= 2.2) {
    const wrap = document.createElement('div');
    wrap.className = 'fx-twrap';
    const col = document.createElement('div');
    col.className = 'fx-tcol';
    techs.forEach((t) => col.appendChild(t));
    wrap.append(col, lastRow);
    deck.appendChild(wrap);
  }
  box.append(hw, deck);
  // Three controls or fewer sit beside the display, not under it.
  const total = musical.reduce((a, s) => a + weight(s), 0);
  if (total > 0 && total <= 3.2 && !techs.length && FXP.HERO[heroKey]) {
    box.classList.add('fx-side');
    box.style.setProperty('--side', `${Math.max(64, Math.round(total * 52 + 8))}px`);
  }
  if (!m.specs.length) deck.remove();
  hero();
  return { controls, hero };
}

// ────────────────────────────────────────────────────────────── live readings

/// What each face drawn from the meters needs, by slot: its input's peak.
const fxInputDb = new Map();
const fxLive = new Map();

/// Called with the rack's meters, every frame they arrive.
function fxFaceLevels(slotIndex, input) {
  if (!input) return;
  const peak = Math.max(input[0] || 0, input[1] || 0, 1e-5);
  fxInputDb.set(slotIndex, Math.max(-72, Math.min(0, 20 * Math.log10(peak))));
}

function fxFaceLiveRepaint() {
  for (const [module, paint] of fxLive) {
    if (!module.isConnected) { fxLive.delete(module); continue; }
    paint();
  }
}

// ─────────────────────────────────────────────────────── compressor and gate

/// An arrow on a meter is a control like any other: named, focusable, and
/// nudged with the arrow keys a tenth of a dB at a time (a whole one with Shift).
function fxCaretControl(caret, p, get, set, commit) {
  caret.setAttribute('role', 'slider');
  caret.setAttribute('aria-label', p.label);
  caret.tabIndex = 0;
  const say = () => caret.setAttribute('aria-valuetext', fxFormat(p, get()));
  caret.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    set(get() + d * (e.shiftKey ? 1 : .1));
    say();
    commit();
  });
  caret.addEventListener('pointerup', say);
  say();
}

/// The transfer curve between the meters, the threshold as the arrow on the
/// input meter (Pro Tools' Dynamics III, IA-LA1), and the times and levels in
/// one row under it.
function fxDynamicsFace(box, m, el, slotIndex, gate) {
  const key = (re) => m.specs.find((p) => re.test(p.key))?.key;
  const kTh = key(/threshold/i), kRatio = key(/ratio/i), kKnee = key(/knee/i), kMake = key(/makeup/i), kDepth = key(/depth|range|floor/i);
  const lo = -72;
  box.classList.add('fx-dyn');
  box.innerHTML = `<div class="fx-dyn-mid"><div class="fx-mtr in"><span>IN</span><i></i><em></em></div><div class="fx-dyn-curve"></div>
    <div class="fx-mtr gr"><span>GR</span><i></i><em></em></div><div class="fx-mtr out"><span>OUT</span><i></i><em></em></div></div><div class="fx-dyn-row"></div>`;
  const out = (i) => {
    const th = m.get(kTh);
    if (gate) return i >= th ? i : i - (kDepth ? m.get(kDepth) : 1) * Math.min(60, (th - i) * 3);
    const r = m.get(kRatio), k = kKnee ? m.get(kKnee) : 0, d = i - th;
    const o = 2 * d < -k ? i : 2 * Math.abs(d) <= k ? i + (1 / r - 1) * Math.pow(d + k / 2, 2) / (2 * Math.max(k, .01)) : th + d / r;
    return o + (kMake ? m.get(kMake) : 0);
  };
  const W = 260, H = 112, x = (db) => (db - lo) / -lo * W, y = (db) => H - (db - lo) / -lo * H;
  const curve = box.querySelector('.fx-dyn-curve');
  const meter = (sel, unit, text) => { const mt = box.querySelector(sel); mt.querySelector('i').style.setProperty('--h', `${Math.max(0, Math.min(1, unit)) * 100}%`); mt.querySelector('em').textContent = text; };
  const paint = () => {
    const level = fxInputDb.get(slotIndex) ?? lo;
    let s = '';
    for (const g of [-60, -48, -36, -24, -12]) s += `<line x1="${x(g)}" x2="${x(g)}" y1="0" y2="${H}" class="fx-grid"/><line y1="${y(g)}" y2="${y(g)}" x1="0" x2="${W}" class="fx-grid"/>`;
    s += `<line x1="0" y1="${H}" x2="${W}" y2="0" class="fx-dim"/>`;
    let d = '';
    for (let i = 0; i <= 96; i++) { const db = lo + -lo * i / 96; d += `${i ? 'L' : 'M'}${x(db).toFixed(1)} ${Math.max(0, Math.min(H, y(out(db)))).toFixed(1)}`; }
    s += `<path d="${d}L${W} ${H}L0 ${H}Z" class="fx-fill"/><path d="${d}" class="fx-line"/>`;
    s += `<line x1="${x(m.get(kTh))}" x2="${x(m.get(kTh))}" y1="0" y2="${H}" class="fx-thr"/>`;
    if (level > lo) s += `<circle cx="${x(level)}" cy="${Math.max(0, Math.min(H, y(out(level))))}" r="4.5" class="fx-dot"/>`;
    curve.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Transfer curve: drag across for the threshold">${s}</svg>`;
    // Nothing playing is nothing reduced.
    const gr = level > lo ? Math.max(0, level + (gate || !kMake ? 0 : m.get(kMake)) - out(level)) : 0;
    meter('.in', (level - lo) / -lo, level > lo ? level.toFixed(0) : '−∞');
    meter('.gr', gr / 24, gr > .05 ? `−${gr.toFixed(1)}` : '0');
    meter('.out', (out(level) - lo) / -lo, level > lo ? out(level).toFixed(0) : '−∞');
    const caret = box.querySelector('.fx-mtr.in i .fx-caret');
    if (caret) caret.style.top = `${(1 - (m.get(kTh) - lo) / -lo) * 100}%`;
  };
  // The threshold: the arrow on IN, or a drag across the curve.
  const pTh = m.byKey[kTh];
  const setTh = (db) => { m.set(kTh, fxClamp(pTh, db)); paint(); };
  const caret = document.createElement('b');
  caret.className = 'fx-caret';
  caret.title = 'Threshold — drag';
  fxCaretControl(caret, pTh, () => m.get(kTh), (v) => setTh(v), () => m.commit());
  box.querySelector('.fx-mtr.in i').appendChild(caret);
  const meterBox = box.querySelector('.fx-mtr.in i');
  caret.addEventListener('pointerdown', (e) => { caret.setPointerCapture(e.pointerId); e.preventDefault(); });
  caret.addEventListener('pointermove', (e) => { if (!caret.hasPointerCapture(e.pointerId)) return; const b = meterBox.getBoundingClientRect(); setTh(lo + (1 - (e.clientY - b.top) / b.height) * -lo); });
  caret.addEventListener('pointerup', (e) => { if (caret.hasPointerCapture(e.pointerId)) { caret.releasePointerCapture(e.pointerId); m.commit(); } });
  curve.addEventListener('pointerdown', (e) => { curve.setPointerCapture(e.pointerId); const b = curve.getBoundingClientRect(); setTh(lo + (e.clientX - b.left) / b.width * -lo); });
  curve.addEventListener('pointermove', (e) => { if (!curve.hasPointerCapture(e.pointerId)) return; const b = curve.getBoundingClientRect(); setTh(lo + (e.clientX - b.left) / b.width * -lo); });
  curve.addEventListener('pointerup', (e) => { if (curve.hasPointerCapture(e.pointerId)) { curve.releasePointerCapture(e.pointerId); m.commit(); } });
  const row = box.querySelector('.fx-dyn-row');
  for (const p of m.specs) if (p.key !== kTh) row.appendChild(fxControl(m, p, paint, fxShort(p.label, '')));
  fxLive.set(el, paint);
  paint();
}

// ──────────────────────────────────────────────────────────────── maximizer

/// Pro-L's arrangement: the drive pushes the sound in, the ceiling is the red
/// arrow on the output meter.
function fxMaximizerFace(box, m, el, slotIndex) {
  const lo = -48;
  box.classList.add('fx-dyn');
  box.innerHTML = `<div class="fx-dyn-mid"><div class="fx-mtr in"><span>IN</span><i></i><em></em></div><div class="fx-dyn-curve"></div>
    <div class="fx-mtr gr"><span>GR</span><i></i><em></em></div><div class="fx-mtr out"><span>OUT</span><i></i><em></em></div></div><div class="fx-dyn-row"></div>`;
  const pCeil = m.byKey.ceilingDb;
  const meter = (sel, unit, text) => { const mt = box.querySelector(sel); mt.querySelector('i').style.setProperty('--h', `${Math.max(0, Math.min(1, unit)) * 100}%`); mt.querySelector('em').textContent = text; };
  const paint = () => {
    const v = m.values(), drive = 20 * Math.log10(1 + (v.amount ?? 0) * 3), level = fxInputDb.get(slotIndex) ?? lo;
    box.querySelector('.fx-dyn-curve').innerHTML = FXP.display(FXP.HERO.maximizer(v), true);
    const outPk = Math.min(v.ceilingDb, level + drive), gr = Math.max(0, level + drive - v.ceilingDb);
    meter('.in', (level - lo) / -lo, level > lo ? level.toFixed(0) : '−∞');
    meter('.gr', gr / 18, gr > .05 ? `−${gr.toFixed(1)}` : '0');
    meter('.out', (outPk - lo) / -lo, level > lo ? outPk.toFixed(1) : '−∞');
    caret.style.top = `${(1 - (v.ceilingDb - lo) / -lo) * 100}%`;
  };
  const om = box.querySelector('.fx-mtr.out i');
  const caret = document.createElement('b');
  caret.className = 'fx-caret ceil';
  caret.title = 'Ceiling — drag';
  fxCaretControl(caret, pCeil, () => m.get('ceilingDb'), (v) => { m.set('ceilingDb', fxClamp(pCeil, v)); controls.ceilingDb?.sync(); paint(); }, () => m.commit());
  om.appendChild(caret);
  caret.addEventListener('pointerdown', (e) => { caret.setPointerCapture(e.pointerId); e.preventDefault(); });
  caret.addEventListener('pointermove', (e) => { if (!caret.hasPointerCapture(e.pointerId)) return; const b = om.getBoundingClientRect(); m.set('ceilingDb', fxClamp(pCeil, lo + (1 - (e.clientY - b.top) / b.height) * -lo)); controls.ceilingDb?.sync(); paint(); });
  caret.addEventListener('pointerup', (e) => { if (caret.hasPointerCapture(e.pointerId)) { caret.releasePointerCapture(e.pointerId); m.commit(); } });
  const row = box.querySelector('.fx-dyn-row'), controls = {};
  for (const p of m.specs) { const c = fxControl(m, p, paint, p.key === 'amount' ? 'Drive' : fxShort(p.label, '')); controls[p.key] = c; row.appendChild(c); }
  fxLive.set(el, paint);
  paint();
}

// ────────────────────────────────────────────────────────────────────── EQ

const FX_EQ_TYPES = ['highpass', 'lowshelf', 'bell', 'notch', 'highshelf', 'lowpass'];
const FX_EQ_SHORT = ['HP', 'LS', 'Bell', 'Notch', 'HS', 'LP'];
const FX_EQ_ICON = ['M2 12Q8 12 10 4L26 4', 'M2 10L10 10Q14 4 18 4L26 4', 'M2 10Q9 10 14 3Q19 10 26 10', 'M2 4L10 4Q14 13 18 4L26 4', 'M2 4L10 4Q14 10 18 10L26 10', 'M2 4L18 4Q20 12 26 12'];
const FX_EQ_COLOURS = ['#ff5a6e', '#ffa047', '#f5d547', '#4fd67a', '#3fc4ff', '#5a8bff', '#b07cff', '#ff6fd1'];

/// The EQ's eight bands, as one shape for the original (`slot.bands`) and the
/// prism twin (`band.<n>.<key>` params, the type a number).
function fxEqBands(slot) {
  if (slot.kind === 'eq') {
    slot.bands = slot.bands || defaultEqBands();
    return {
      bands: () => slot.bands,
      set(i, k, v) { slot.bands[i][k] = v; if (k === 'type' || k === 'enabled') pushRack({ immediate: true }); else liveParam(slot.id, `band.${i}.${k}`, v); },
    };
  }
  slot.params = slot.params || {};
  for (const p of state.shapers[slot.kind]?.params || []) if (slot.params[p.key] === undefined) slot.params[p.key] = p.default;
  const P = slot.params;
  // Read fresh each time, so a band is always what the params say now.
  const band = (i) => ({
    type: FX_EQ_TYPES[Math.round(P[`band.${i}.mode`] ?? 2)],
    enabled: (P[`band.${i}.enabled`] ?? 1) >= .5,
    freq: P[`band.${i}.freq`],
    q: P[`band.${i}.q`] ?? .71,
    gainDb: P[`band.${i}.gainDb`] ?? 0,
  });
  return {
    bands: () => [...Array(8)].map((_, i) => band(i)),
    set(i, k, v) {
      const key = k === 'type' ? 'mode' : k, value = k === 'type' ? FX_EQ_TYPES.indexOf(v) : k === 'enabled' ? (v ? 1 : 0) : v;
      if (P[`band.${i}.${key}`] === undefined && key !== 'mode' && key !== 'enabled') return;
      P[`band.${i}.${key}`] = value;
      liveParam(slot.id, `band.${i}.${key}`, value);
      if (k === 'type' || k === 'enabled') commitRack();
    },
  };
}

/// Every band its own coloured layer over the live analyser, the sum on top;
/// drag a numbered node for frequency and gain, scroll on it for Q.
function fxEqFace(box, slot, el, slotIndex) {
  const eq = fxEqBands(slot);
  let sel = eqBandSelections.get(slotIndex) ?? 2;
  const W = 340, H = 150, fmin = 20, fmax = 20000, gmax = 18, fs = engine.deviceRate || 48000;
  const xOf = (f) => (W - 4) * Math.log(f / fmin) / Math.log(fmax / fmin) + 2, fOf = (x) => fmin * Math.pow(fmax / fmin, (x - 2) / (W - 4));
  const yOf = (g) => H / 2 - g / gmax * (H / 2 - 10), gOf = (y) => (H / 2 - y) / (H / 2 - 10) * gmax;
  const kind = (b) => FX_EQ_TYPES.indexOf(b.type);
  const passOrNotch = (b) => ['highpass', 'lowpass', 'notch'].includes(b.type);
  box.classList.add('fx-eq');
  box.innerHTML = '<div class="fx-eq-types"></div><div class="fx-eq-disp"></div><div class="fx-eq-read"></div><div class="fx-eq-sel"></div>';
  const disp = box.querySelector('.fx-eq-disp');
  const freqs = [...Array(161)].map((_, i) => fmin * Math.pow(fmax / fmin, i / 160));
  const paintCurve = () => {
    const bands = eq.bands();
    const total = (f) => bands.reduce((a, b) => a + (b.enabled ? FXP.rbjDb(kind(b), b.freq, b.q, b.gainDb, f, fs) : 0), 0);
    let s = '';
    for (const g of [-12, -6, 0, 6, 12]) s += `<line x1="0" x2="${W}" y1="${yOf(g)}" y2="${yOf(g)}" class="fx-grid"/>`;
    for (const f of [100, 1000, 10000]) s += `<line y1="0" y2="${H}" x1="${xOf(f)}" x2="${xOf(f)}" class="fx-grid"/><text x="${xOf(f) + 2}" y="${H - 3}" class="fx-tx">${f >= 1000 ? f / 1000 + 'k' : f}</text>`;
    // The analyser, live, behind everything.
    if (engine.spectrum?.length) {
      const bins = engine.spectrum, nyq = fs / 2;
      let d = `M0 ${H}`;
      for (let i = 1; i < bins.length; i++) { const hz = i / (bins.length - 1) * nyq; if (hz >= fmin && hz <= fmax) d += `L${xOf(hz).toFixed(1)} ${(H - bins[i] / 255 * H * .9).toFixed(1)}`; }
      s += `<path d="${d}L${W} ${H}Z" class="fx-spec"/>`;
    }
    bands.forEach((b, i) => {
      if (!b.enabled) return;
      const d = freqs.map((f, k) => `${k ? 'L' : 'M'}${xOf(f).toFixed(1)} ${Math.max(1, Math.min(H - 1, yOf(FXP.rbjDb(kind(b), b.freq, b.q, b.gainDb, f, fs)))).toFixed(1)}`).join('');
      s += `<path d="${d}L${W} ${yOf(0)}L0 ${yOf(0)}Z" fill="${FX_EQ_COLOURS[i]}" opacity="${i === sel ? .26 : .1}"/><path d="${d}" fill="none" stroke="${FX_EQ_COLOURS[i]}" stroke-width="${i === sel ? 1.5 : 1}" opacity=".85"/>`;
    });
    s += `<path d="${freqs.map((f, k) => `${k ? 'L' : 'M'}${xOf(f).toFixed(1)} ${Math.max(1, Math.min(H - 1, yOf(total(f)))).toFixed(1)}`).join('')}" class="fx-sum"/>`;
    bands.forEach((b, i) => {
      const x = xOf(Math.max(fmin, Math.min(fmax, b.freq))), y = passOrNotch(b) ? yOf(0) : yOf(b.gainDb);
      s += `<g data-b="${i}" class="fx-node${b.enabled ? '' : ' off'}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === sel ? 7.5 : 6}" fill="${FX_EQ_COLOURS[i]}" stroke="${i === sel ? '#fff' : '#04060a'}" stroke-width="1.4"/><text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${i + 1}</text></g>`;
    });
    disp.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-label="EQ curve: drag a numbered node to move its band, scroll on it for Q">${s}</svg>`;
  };
  const paintStrips = () => {
    const types = box.querySelector('.fx-eq-types'), read = box.querySelector('.fx-eq-read');
    types.innerHTML = ''; read.innerHTML = '';
    eq.bands().forEach((b, i) => {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = (b.enabled ? 'on' : '') + (i === sel ? ' sel' : '');
      t.style.setProperty('--bc', FX_EQ_COLOURS[i]);
      t.innerHTML = `<svg viewBox="0 0 28 14"><path d="${FX_EQ_ICON[kind(b)]}"/></svg>${i + 1}`;
      t.title = `Band ${i + 1}, ${FX_EQ_SHORT[kind(b)]}: click to select, double-click to switch on or off`;
      t.onclick = () => select(i);
      t.ondblclick = () => { eq.set(i, 'enabled', !b.enabled); paintAll(); };
      types.appendChild(t);
      const r = document.createElement('div');
      r.className = (b.enabled ? 'on' : '') + (i === sel ? ' sel' : '');
      r.style.setProperty('--bc', FX_EQ_COLOURS[i]);
      const hz = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(b.freq >= 10000 ? 0 : 1)}k` : `${Math.round(b.freq)}`;
      r.innerHTML = `${hz}<br>${b.type === 'highpass' || b.type === 'lowpass' ? '12/oct' : b.type === 'notch' ? 'notch' : `${b.gainDb > 0 ? '+' : ''}${b.gainDb.toFixed(1)}`}`;
      r.onclick = () => select(i);
      read.appendChild(r);
    });
  };
  // The selected band's own knobs and type.
  const bandModel = () => ({
    slot, specs: [], byKey: {},
    get: (k) => eq.bands()[sel][k],
    set: (k, v) => eq.set(sel, k, v),
    commit: () => { if (slot.kind === 'eq') commitRack(); else commitRack(); },
    values: () => ({}),
  });
  const paintSel = () => {
    const box2 = box.querySelector('.fx-eq-sel'), b = eq.bands()[sel], bm = bandModel();
    box2.innerHTML = '';
    box2.style.setProperty('--accent', FX_EQ_COLOURS[sel]);
    const specs = [
      { key: 'freq', label: 'Frequency', min: 20, max: 20000, default: eqBorn(sel, 'freq') ?? 1000, unit: 'Hz', log: true },
      ...(passOrNotch(b) && b.type !== 'notch' ? [] : [{ key: 'gainDb', label: 'Gain', min: -24, max: 24, default: 0, unit: 'dB' }]),
      { key: 'q', label: b.type === 'highpass' || b.type === 'lowpass' ? 'Resonance' : 'Q', min: .05, max: 18, default: .71, log: true },
    ];
    for (const p of specs) {
      bm.byKey[p.key] = p;
      box2.appendChild(fxKnob({ ...bm, slot: { id: `${slot.id}#band` } }, p, () => { paintCurve(); paintStrips(); }));
    }
    // The band's own switch, as plain as the type buttons beside it.
    const power = document.createElement('button');
    power.type = 'button';
    power.className = 'fx-eq-on' + (b.enabled ? ' on' : '');
    power.textContent = b.enabled ? 'On' : 'Off';
    power.title = `Band ${sel + 1} on or off`;
    power.onclick = () => { eq.set(sel, 'enabled', !b.enabled); paintAll(); };
    box2.appendChild(power);
    const modes = document.createElement('div');
    modes.className = 'fx-eq-modes';
    FX_EQ_SHORT.forEach((t, k) => {
      const mb = document.createElement('button');
      mb.type = 'button';
      mb.textContent = t;
      if (k === kind(b)) mb.className = 'on';
      mb.onclick = () => { eq.set(sel, 'type', FX_EQ_TYPES[k]); paintAll(); };
      modes.appendChild(mb);
    });
    box2.appendChild(modes);
  };
  const paintAll = () => { paintCurve(); paintStrips(); paintSel(); };
  const select = (i) => { sel = i; eqBandSelections.set(slotIndex, i); paintAll(); };
  let dragging = false;
  disp.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-b]');
    if (!g) return;
    select(+g.dataset.b);
    dragging = true;
    disp.setPointerCapture(e.pointerId);
  });
  disp.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = disp.getBoundingClientRect(), b = eq.bands()[sel];
    eq.set(sel, 'freq', Math.max(20, Math.min(20000, fOf((e.clientX - r.left) / r.width * W))));
    if (!passOrNotch(b)) eq.set(sel, 'gainDb', Math.max(-24, Math.min(24, gOf((e.clientY - r.top) / r.height * H))));
    paintCurve(); paintStrips();
  });
  disp.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; disp.releasePointerCapture(e.pointerId); paintSel(); commitRack(); });
  disp.addEventListener('wheel', (e) => {
    const g = e.target.closest('[data-b]');
    if (!g) return;
    e.preventDefault();
    const i = +g.dataset.b;
    eq.set(i, 'q', Math.max(.05, Math.min(18, eq.bands()[i].q * (e.deltaY < 0 ? 1.1 : .9))));
    if (i !== sel) select(i); else paintAll();
    clearTimeout(disp.qTimer);
    disp.qTimer = setTimeout(commitRack, 300);
  }, { passive: false });
  // The analyser moves with the sound; the rest only when something is moved.
  fxLive.set(el, () => { if (!dragging) paintCurve(); });
  paintAll();
}

// ─────────────────────────────────────────────────────────── Advanced ranges

/// Each knob's own range: where its travel starts and ends, and its curve —
/// so a delay's knob can sweep 20 to 80 ms instead of 1 ms to 2 s. Inside the
/// effect's own limits: those are the engine's, and it clamps to them.
function fxAdvanced(box, m, back) {
  const knobs = m.specs.filter((p) => !fxIsSwitch(p) && !p.choices);
  box.innerHTML = '';
  box.classList.add('fx-adv');
  box.innerHTML = '<div class="fx-adv-head"><span></span><span>knob</span><span>sweeps</span><span>from</span><span>to</span><span>curve</span></div>';
  const ranges = () => ((state.rack.ranges ||= {})[m.slot.id] ||= {});
  const save = () => { if (!Object.keys(ranges()).length) delete state.rack.ranges[m.slot.id]; commitRack(); };
  for (const p of knobs) {
    const row = document.createElement('div');
    row.className = 'fx-adv-row';
    row.innerHTML = '<span class="fxs-pic"></span><span class="k"></span><div class="fx-rbar"><i class="fac"></i><i class="you"></i></div><input type="number" step="any"><input type="number" step="any"><div class="fx-curve"><button type="button">lin</button><button type="button">log</button></div>';
    row.querySelector('.fxs-pic').innerHTML = FXP.svg(FXP.noText(FXP.PIC[FXP.picFor(p)](.6, p.min + (p.max - p.min) * .6, p)));
    row.querySelector('.k').textContent = p.label + (p.unit && p.unit !== ':1' ? ` (${p.unit})` : '');
    const [lo, hi] = row.querySelectorAll('input');
    lo.setAttribute('aria-label', `${p.label}: start of the knob`); hi.setAttribute('aria-label', `${p.label}: end of the knob`);
    lo.min = hi.min = p.min; lo.max = hi.max = p.max;
    const cur = () => fxRange(m, p);
    const show = () => {
      const r = cur(), span = p.max - p.min || 1;
      lo.value = +r.min.toPrecision(5); hi.value = +r.max.toPrecision(5);
      Object.assign(row.querySelector('.fac').style, { left: '0%', width: '100%' });
      Object.assign(row.querySelector('.you').style, { left: `${(r.min - p.min) / span * 100}%`, width: `${Math.max(0, r.max - r.min) / span * 100}%` });
      row.querySelectorAll('.fx-curve button').forEach((b, i) => b.classList.toggle('on', !!r.log === !!i));
      row.classList.toggle('own', !!state.rack.ranges?.[m.slot.id]?.[p.key]);
    };
    const put = (patch) => {
      const r = { ...cur(), ...patch };
      r.min = Math.max(p.min, Math.min(p.max, r.min)); r.max = Math.max(p.min, Math.min(p.max, r.max));
      if (r.max <= r.min) { show(); return; }
      if (r.log && r.min <= 0) r.log = false;
      const factory = r.min === p.min && r.max === p.max && r.log === fxIsLog(p);
      if (factory) delete ranges()[p.key]; else ranges()[p.key] = r;
      show(); save();
    };
    lo.onchange = () => lo.value !== '' && put({ min: +lo.value });
    hi.onchange = () => hi.value !== '' && put({ max: +hi.value });
    row.querySelectorAll('.fx-curve button').forEach((b, i) => { b.onclick = () => put({ log: !!i }); });
    show();
    box.appendChild(row);
  }
  const foot = document.createElement('div');
  foot.className = 'fx-adv-foot';
  foot.innerHTML = `<span>Grey is the effect's whole range; the outline is what the knob sweeps. Saved with the rack.</span><button class="ghost" type="button">Factory ranges</button>`;
  foot.querySelector('button').onclick = () => { if (state.rack.ranges) delete state.rack.ranges[m.slot.id]; commitRack(); fxAdvanced(box, m, back); };
  box.appendChild(foot);
}

// ──────────────────────────────────────────────────────────────── the entry

/// Draw a built-in effect's face into its module. `renderRack` has made the
/// module and its header; this fills the controls and dresses the header.
function renderFxFace(box, slot, slotIndex, el) {
  el.classList.add('fx-face');
  // The header's power is a lit square and its Remove is ×.
  const remove = el.querySelector('.fx-remove');
  if (remove) { remove.textContent = '×'; remove.title = 'Remove'; remove.setAttribute('aria-label', 'Remove'); }
  el.querySelector('.fx-power')?.setAttribute('aria-label', slot.bypassed ? 'Off — switch on' : 'On — switch off');
  el.style.setProperty('--accent', fxFamilyColour(slot.kind));
  box.classList.add('fx-face-body');
  const isEq = slot.kind === 'eq' || slot.kind === 'prism:eq';
  const isComp = slot.kind === 'comp' || slot.kind === 'prism:compressor';
  const isGate = /^(prism:)?gate$/.test(slot.kind);
  const isMax = /^(prism:)?maximizer$/.test(slot.kind);
  const draw = () => {
    box.innerHTML = '';
    box.className = 'fx-module-controls fx-face-body';
    box.style.removeProperty('--side');
    fxLive.delete(el);
    if (isEq) { fxEqFace(box, slot, el, slotIndex); return; }
    const m = fxModel(slot);
    if (isComp || isGate) { fxDynamicsFace(box, m, el, slotIndex, isGate); return; }
    if (isMax) { fxMaximizerFace(box, m, el, slotIndex); return; }
    fxDeckFace(box, m, el);
  };
  draw();
  // Advanced, for every effect but the EQ and the compressor: their knobs are
  // the ones every other effect is measured against.
  if (isEq || isComp) return;
  const m = fxModel(slot);
  if (!m.specs.some((p) => !fxIsSwitch(p) && !p.choices)) return;
  // One switch: lit, the module shows its knobs' ranges; dark, its knobs.
  const adv = document.createElement('button');
  adv.type = 'button';
  adv.className = 'fx-adv-btn';
  adv.textContent = 'Advanced';
  adv.title = "Each knob's own range";
  adv.setAttribute('aria-pressed', 'false');
  adv.onclick = () => {
    const on = !adv.classList.contains('on');
    adv.classList.toggle('on', on);
    adv.setAttribute('aria-pressed', String(on));
    if (!on) { draw(); return; }
    fxLive.delete(el);
    box.style.removeProperty('--side');
    box.className = 'fx-module-controls fx-face-body';
    fxAdvanced(box, fxModel(slot));
  };
  el.querySelector('.fx-module-actions')?.prepend(adv);
}

/// A picture on each control of the Hyperprism, SoundHack and Lexicon panels:
/// their own layout, with what each value does drawn beside it.
function fxDecorateRow(row, p, read) {
  if (!row || row.querySelector(':scope > .fx-pic')) return;
  const pic = document.createElement('span');
  pic.className = 'fx-pic';
  row.prepend(pic);
  row.classList.add('fx-pic-row');
  const pk = FXP.picFor(p);
  // Without its small print: at this size it cannot be read, and it would
  // become part of the row's text.
  const paint = () => { const v = read(), u = automationUnit(v, p.min, p.max, fxIsLog(p)); pic.innerHTML = FXP.svg(FXP.noText(FXP.PIC[pk](u, v, p))); };
  const sync = row.sync;
  row.sync = (...a) => { sync?.(...a); paint(); };
  row.addEventListener('input', paint);
  row.addEventListener('click', () => requestAnimationFrame(paint));
  paint();
}
