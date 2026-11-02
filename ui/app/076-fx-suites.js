// ===================================================== the three suites' faces
//
// Hyperprism, SoundHack and Lexicon, each in the look of the original plug-in,
// with every control the program gives them drawn in that look and with the
// picture of what its value does (`075-fx-faces.js`). Approved as a mock-up on
// 1 Nov 2026; SoundHack after a design critique.
//
// - **Lexicon** is the LXP Native panel: the lexicon band, the reverb's
//   impulse (which is also its Size × Reverb Time pad), and its edit pages of
//   knobs with an LCD reading over each — Soft Row first, then the original's
//   own pages.
// - **SoundHack** is Tom Erbe's name pill and colour on one grid: six equal
//   cells to a row, a dial, a switch or a level taking one, a choice a bar
//   across whole cells, sections sharing rows so none ends half empty, and a
//   run of interval switches as one keyboard.
// - **Hyperprism** is the blue window — its two edges' limits in the corners —
//   and its controls as System 7 sliders, radio buttons and boxes.
//
// They are built on the panel's own parts (`param`, `seg`, `prismModulePad`,
// `prismSoundRow`), so a control moves the running effect, a release saves the
// rack, a reset, a preset or an undo reaches it, and a control that only
// applies in one mode dims outside it — all as before.

/// Which suite an effect belongs to, from where it came from.
function fxSuiteOf(shaper) {
  const src = shaper?.source || '';
  if (src.startsWith('Lexicon')) return 'lexicon';
  if (src.startsWith('SoundHack')) return 'soundhack';
  if (src.startsWith('Hyperprism')) return 'hyperprism';
  return null;
}

/// Tom Erbe's colour for each plug-in's name pill, and its rings and keys.
const FX_SH_HUE = { 'sh-chebyshev': '#2bb39a', 'sh-compand': '#d77fd0', 'sh-decimate': '#ef6a50', 'sh-matrix': '#c9a21f',
  'sh-phasor': '#5b8cff', 'sh-delay': '#6fae3f', 'sh-pitchdelay': '#ff8a2a', 'sh-flipper': '#2fb0d0', 'sh-bubbler': '#9a72f0',
  'spectral-dynamics': '#3ab585', convolution: '#d76b6b' };

/// Draw an effect from one of the three suites. `rows` is the panel's map of
/// control to element, which the pad and the dimming use.
function renderSuiteFace(box, slot, shaper, suite) {
  const el = box.closest('.fx-module');
  el.classList.add('fx-suite', `fx-suite-${suite}`);
  const remove = el.querySelector('.fx-remove');
  if (remove) { remove.textContent = '×'; remove.title = 'Remove'; remove.setAttribute('aria-label', 'Remove'); }
  slot.params = slot.params || {};
  for (const p of shaper.params) if (slot.params[p.key] === undefined) slot.params[p.key] = p.default;
  const byKey = Object.fromEntries(shaper.params.map((p) => [p.key, p]));
  const rows = {};
  const refresh = () => {
    for (const p of shaper.params) {
      if (p.when && rows[p.key]) rows[p.key].classList.toggle('inactive', Math.round(slot.params[p.when.key]) !== p.when.value);
    }
  };
  const groups = shaper.panel.groups?.length ? shaper.panel.groups : [{ label: '', keys: shaper.params.map((p) => p.key) }];
  const pad = shaper.panel.pad && byKey[shaper.panel.pad.x] && byKey[shaper.panel.pad.y] ? shaper.panel.pad : null;
  if (suite === 'hyperprism') fxHyperprismFace(box, slot, shaper, byKey, groups, pad, rows, refresh);
  else if (suite === 'soundhack') fxSoundHackFace(box, slot, shaper, byKey, groups, rows, refresh);
  else fxLexiconFace(box, slot, shaper, byKey, groups, pad, rows, refresh);
  refresh();
}

// ─────────────────────────────────────────────────────────────── Hyperprism

/// The blue window and System 7 sliders. Built from the panel's own rows and
/// pad, which keep every behaviour they had; only the dress is Hyperprism's.
function fxHyperprismFace(box, slot, shaper, byKey, groups, pad, rows, refresh) {
  box.classList.add('hp-face');
  const title = document.createElement('div');
  title.className = 'hp-title';
  title.innerHTML = '<span></span>';
  title.querySelector('span').textContent = shaper.label.replace(/^Hyperprism\s*/, '');
  box.appendChild(title);
  if (shaper.sound) box.appendChild(prismSoundRow(slot, shaper.sound));
  let readout = () => {};
  if (pad) {
    const px = byKey[pad.x], py = byKey[pad.y];
    const top = document.createElement('div');
    top.className = 'hp-top';
    const win = prismModulePad(slot, px, py, pad, rows);
    // The two edges' limits in the corners, as Hyperprism typed them.
    for (const [where, text] of [['tl', fxValueFormat(px, pad.xMin)], ['tr', fxValueFormat(px, pad.xMax)], ['bl', fxValueFormat(py, pad.yMin)], ['tl2', fxValueFormat(py, pad.yMax)]]) {
      const lim = document.createElement('span');
      lim.className = `hp-lim ${where}`;
      lim.textContent = text;
      win.appendChild(lim);
    }
    const side = document.createElement('div');
    side.className = 'hp-axes';
    side.innerHTML = '<div><b></b><span></span></div><div><b></b><span></span></div>';
    side.children[0].querySelector('b').textContent = `Top · ${px.label}`;
    side.children[1].querySelector('b').textContent = `Left · ${py.label}`;
    readout = () => {
      side.children[0].querySelector('span').textContent = fxFormat(px, slot.params[px.key]);
      side.children[1].querySelector('span').textContent = fxFormat(py, slot.params[py.key]);
    };
    win.addEventListener('pointermove', readout);
    win.addEventListener('pointerdown', readout);
    top.append(win, side);
    box.appendChild(top);
  }
  const ctl = document.createElement('div');
  ctl.className = 'hp-controls';
  for (const g of groups) {
    const section = document.createElement('div');
    section.className = 'prism-group';
    if (g.label) {
      const label = document.createElement('span');
      label.className = 'prism-group-label';
      label.textContent = g.label;
      section.appendChild(label);
    }
    const linked = g.keys.includes('wet') && g.keys.includes('dry');
    for (const key of g.keys) {
      const p = byKey[key];
      if (!p || (linked && key === 'dry')) continue;
      const row = linked && key === 'wet' ? linkedDryWet(slot) : prismModuleControl(slot, p, rows, () => { refresh(); readout(); });
      if (linked && key === 'wet') fxDecorateRow(row, { key: 'mix', label: 'Dry / Wet', min: 0, max: 1 }, () => slot.params.wet >= .999 ? 1 - slot.params.dry / 2 : slot.params.wet / 2);
      else fxDecorateRow(row, p, () => slot.params[p.key]);
      section.appendChild(row);
    }
    ctl.appendChild(section);
  }
  box.appendChild(ctl);
  box.addEventListener('input', readout);
  readout();
}

// ──────────────────────────────────────────────────────────────── SoundHack

/// A SoundHack dial: a thin ring in the plug-in's colour, the picture in a
/// white cap, the reading and the name under it. A `.param` with its `.k` and
/// `.v` like every rack control, so presets, resets and the dimming reach it.
function fxShDial(slot, p, hue, moved) {
  const el = document.createElement('div');
  el.className = 'param sh-cell';
  el.innerHTML = '<svg class="sh-ring" viewBox="0 0 60 60" role="slider" tabindex="0"></svg><span class="v"></span><span class="k"></span>';
  el.querySelector('.k').textContent = p.label;
  el.title = `${p.label} — drag up or down, double-click to reset`;
  const ring = el.querySelector('.sh-ring');
  ring.setAttribute('aria-label', p.label);
  const log = fxIsLog(p) && !(p.step === 1), pk = FXP.picFor(p);
  const unit = () => automationUnit(slot.params[p.key], p.min, p.max, log);
  const paint = () => {
    const u = unit(), v = slot.params[p.key], a0 = Math.PI * .75, a = a0 + u * Math.PI * 1.5, r = 26, c = 30;
    const pt = (x) => `${(c + r * Math.cos(x)).toFixed(2)} ${(c + r * Math.sin(x)).toFixed(2)}`;
    const arc = (f, t, cls) => t - f < .001 ? '' : `<path d="M${pt(f)}A${r} ${r} 0 ${t - f > Math.PI ? 1 : 0} 1 ${pt(t)}" class="${cls}"/>`;
    ring.innerHTML = arc(a0, a0 + Math.PI * 1.5, 'sh-track') + arc(a0, a, 'sh-arc')
      + `<circle cx="${(c + r * Math.cos(a)).toFixed(2)}" cy="${(c + r * Math.sin(a)).toFixed(2)}" r="3.6" class="sh-tip"/><circle cx="30" cy="30" r="20" class="sh-cap"/>`
      + `<svg x="12" y="17" width="36" height="27" viewBox="0 0 64 48" class="pic" overflow="visible">${FXP.noText(FXP.PIC[pk](u, v, p))}</svg>`;
    ring.setAttribute('aria-valuetext', fxFormat(p, v));
    el.querySelector('.v').textContent = fxFormat(p, v);
  };
  const to = (u) => {
    let v = unitValue(Math.max(0, Math.min(1, u)), p.min, p.max, log);
    if (p.step === 1) v = Math.round(v);
    slot.params[p.key] = v;
    liveParam(slot.id, p.key, v);
    paint();
    moved();
  };
  let y0 = 0, u0 = 0;
  ring.addEventListener('pointerdown', (e) => { y0 = e.clientY; u0 = unit(); ring.setPointerCapture(e.pointerId); e.preventDefault(); });
  ring.addEventListener('pointermove', (e) => { if (ring.hasPointerCapture(e.pointerId)) to(u0 + (y0 - e.clientY) / (e.shiftKey ? 600 : 160)); });
  ring.addEventListener('pointerup', (e) => { if (ring.hasPointerCapture(e.pointerId)) { ring.releasePointerCapture(e.pointerId); commitRack(); } });
  ring.addEventListener('dblclick', () => { to(automationUnit(p.default ?? p.min, p.min, p.max, log)); commitRack(); });
  ring.addEventListener('keydown', (e) => {
    const d = { ArrowUp: .01, ArrowRight: .01, ArrowDown: -.01, ArrowLeft: -.01 }[e.key];
    if (!d) return;
    e.preventDefault();
    to(unit() + d * (e.shiftKey ? .2 : 1));
    commitRack();
  });
  el.sync = paint;
  el.style.setProperty('--hue', hue);
  paint();
  return el;
}

/// A SoundHack switch: a square key in its cell, filled with the plug-in's
/// colour when on.
function fxShSwitch(slot, p, moved) {
  const el = document.createElement('div');
  el.className = 'param sh-cell sh-switch';
  el.innerHTML = '<button type="button" class="sh-key"></button><span class="k"></span>';
  el.querySelector('.k').textContent = p.label;
  const b = el.querySelector('button');
  const pk = FXP.picFor(p);
  const on = () => slot.params[p.key] >= (p.min + p.max) / 2;
  const paint = () => {
    b.classList.toggle('on', on());
    b.setAttribute('aria-pressed', String(on()));
    b.setAttribute('aria-label', p.label);
    b.innerHTML = FXP.svg(FXP.noText(FXP.PIC[pk](on() ? 1 : 0, on() ? 1 : 0, p))) + `<i>${on() ? 'on' : 'off'}</i>`;
  };
  b.onclick = () => { const v = on() ? p.min : p.max; slot.params[p.key] = v; liveParam(slot.id, p.key, v); paint(); moved(); commitRack(); };
  el.sync = paint;
  paint();
  return el;
}

/// Tom Erbe's panel on one grid. See the header for why it is laid out so.
function fxSoundHackFace(box, slot, shaper, byKey, groups, rows, refresh) {
  const kind = slot.kind.replace(/^prism:/, ''), hue = FX_SH_HUE[kind] || '#6fae3f';
  const name = shaper.label.toLowerCase().replace(/^\+\+/, '');
  box.classList.add('sh-face');
  box.style.setProperty('--hue', hue);
  const top = document.createElement('div');
  top.className = 'sh-top';
  top.innerHTML = '<span class="sh-pill"><span class="a">soundhack</span><span class="b"></span></span><span class="sh-ver">v. 9 · tom erbe</span>';
  top.querySelector('.b').textContent = `++${name}`;
  box.appendChild(top);
  if (shaper.sound) box.appendChild(prismSoundRow(slot, shaper.sound));
  const moved = refresh;
  const secs = [];
  for (const g of groups) {
    const ps = g.keys.map((k) => byKey[k]).filter(Boolean);
    if (!ps.length) continue;
    const sec = document.createElement('div');
    sec.className = 'prism-group sh-sec';
    sec.innerHTML = '<span class="prism-group-label"></span><div class="sh-cells"></div>';
    sec.querySelector('.prism-group-label').textContent = g.label || name;
    const cells = sec.querySelector('.sh-cells');
    let w = 0;
    // A run of seven or more switches is a keyboard of them: one strip.
    if (ps.length >= 7 && ps.every((p) => p.toggle)) {
      sec.classList.add('sh-keys');
      cells.style.setProperty('--n', ps.length);
      for (const p of ps) {
        const c = fxShSwitch(slot, p, moved);
        c.classList.add('sh-keycap');
        rows[p.key] = c;
        cells.appendChild(c);
      }
      w = 6;
    } else {
      for (const p of ps) {
        let c;
        if (p.toggle) c = fxShSwitch(slot, p, moved);
        else if (p.choices && p.choices.length <= 4) {
          c = prismModuleControl(slot, p, rows, moved);
          c.classList.add('sh-choice');
          c.style.setProperty('--w', Math.min(3, p.choices.length));
          w += Math.min(3, p.choices.length) - 1;
        } else c = fxShDial(slot, p, hue, moved);
        rows[p.key] = c;
        cells.appendChild(c);
        w += 1;
      }
    }
    sec.w = Math.min(6, w);
    secs.push(sec);
  }
  // Rows of six cells; sections share a row while they fit and stretch to
  // fill it, so no row has an empty end.
  let row = null, used = 0;
  for (const sec of secs) {
    if (!row || used + sec.w > 6) { row = document.createElement('div'); row.className = 'sh-row'; box.appendChild(row); used = 0; }
    sec.style.setProperty('--n', sec.w);
    row.appendChild(sec);
    used += sec.w;
  }
}

// ────────────────────────────────────────────────────────────────── Lexicon

/// A Lexicon knob: the LCD reading over it, its name under it in blue
/// italics, and its picture.
function fxLexKnob(slot, p, moved) {
  const el = document.createElement('div');
  el.className = 'param lex-knob';
  el.innerHTML = '<span class="v"></span><svg class="lex-ring" viewBox="0 0 64 64" role="slider" tabindex="0"></svg><span class="k"></span><span class="lex-pic"></span>';
  el.querySelector('.k').textContent = p.label;
  el.title = `${p.label} — drag up or down, double-click to reset`;
  const ring = el.querySelector('.lex-ring');
  ring.setAttribute('aria-label', p.label);
  const log = fxIsLog(p) && !(p.step === 1), pk = FXP.picFor(p);
  const unit = () => automationUnit(slot.params[p.key], p.min, p.max, log);
  const paint = () => {
    const u = unit(), v = slot.params[p.key], a0 = Math.PI * .75, a = a0 + u * Math.PI * 1.5, r = 22;
    const pt = (x) => `${(32 + r * Math.cos(x)).toFixed(2)} ${(32 + r * Math.sin(x)).toFixed(2)}`;
    const arc = (f, t, cls) => t - f < .001 ? '' : `<path d="M${pt(f)}A${r} ${r} 0 ${t - f > Math.PI ? 1 : 0} 1 ${pt(t)}" class="${cls}"/>`;
    ring.innerHTML = arc(a0, a0 + Math.PI * 1.5, 'lex-track') + arc(a0, a, 'lex-arc')
      + `<circle cx="32" cy="32" r="15" class="lex-cap"/><line x1="32" y1="32" x2="${(32 + 14 * Math.cos(a)).toFixed(2)}" y2="${(32 + 14 * Math.sin(a)).toFixed(2)}" class="lex-needle"/>`;
    ring.setAttribute('aria-valuetext', fxFormat(p, v));
    el.querySelector('.v').textContent = fxFormat(p, v).toUpperCase();
    el.querySelector('.lex-pic').innerHTML = FXP.svg(FXP.noText(FXP.PIC[pk](u, v, p)));
  };
  const to = (u) => {
    let v = unitValue(Math.max(0, Math.min(1, u)), p.min, p.max, log);
    if (p.step === 1) v = Math.round(v);
    slot.params[p.key] = v;
    liveParam(slot.id, p.key, v);
    paint();
    moved();
  };
  let y0 = 0, u0 = 0;
  ring.addEventListener('pointerdown', (e) => { y0 = e.clientY; u0 = unit(); ring.setPointerCapture(e.pointerId); e.preventDefault(); });
  ring.addEventListener('pointermove', (e) => { if (ring.hasPointerCapture(e.pointerId)) to(u0 + (y0 - e.clientY) / (e.shiftKey ? 600 : 160)); });
  ring.addEventListener('pointerup', (e) => { if (ring.hasPointerCapture(e.pointerId)) { ring.releasePointerCapture(e.pointerId); commitRack(); } });
  ring.addEventListener('dblclick', () => { to(automationUnit(p.default ?? p.min, p.min, p.max, log)); commitRack(); });
  ring.addEventListener('keydown', (e) => {
    const d = { ArrowUp: .01, ArrowRight: .01, ArrowDown: -.01, ArrowLeft: -.01 }[e.key];
    if (!d) return;
    e.preventDefault();
    to(unit() + d * (e.shiftKey ? .2 : 1));
    commitRack();
  });
  el.sync = paint;
  paint();
  return el;
}

/// The reverb's impulse, from its size, time, predelay and tap slope: the
/// display the LXP panel had, 400 × 70.
function fxLexImpulse(v) {
  const W = 400, H = 70, x = (t) => 10 + t * (W - 20), y = (a) => H - 8 - a * (H - 16);
  const u = (val, lo, hi, log) => automationUnit(val ?? lo, lo, hi, log);
  const rn = u(v.reverbTimeS, .1, 20, true), pn = u(v.predelayMs, 0, 500), zn = u(v.sizeM, 2, 80), sl = (v.tapSlope ?? 0) / 10;
  const k = Math.round(60 - 38 * zn), x0 = .02 + .28 * pn, len = .15 + .75 * rn;
  let s = `<path d="M${x(x0)} ${y(0)}L${x(x0)} ${y(.9)}L${x(Math.min(1, x0 + len))} ${y(0)}Z" class="lex-trend"/>`;
  for (let i = 0; i < k; i++) {
    const t = i / k, xx = x0 + t * len;
    if (xx > 1) break;
    const r = Math.sin(i * 127.1 + 5 * 311.7) * 43758.5453, rr = r - Math.floor(r);
    const h = Math.max(0, Math.min(1, (1 - t) * (1 + sl * (t - .5) * 1.4) * (.7 + .3 * rr))) * .9;
    s += `<line x1="${x(xx).toFixed(1)}" x2="${x(xx).toFixed(1)}" y1="${y(0)}" y2="${y(h).toFixed(1)}" class="lex-tap"/>`;
  }
  return `${s}<line x1="${x(0)}" x2="${x(0)}" y1="${y(0)}" y2="${y(.95)}" class="lex-tap lex-direct"/>`;
}

/// The LXP Native panel: band, impulse (the pad), and the edit pages.
function fxLexiconFace(box, slot, shaper, byKey, groups, pad, rows, refresh) {
  box.classList.add('lex-face');
  const model = shaper.label.replace(/^LXP\s*/i, '').toUpperCase();
  const top = document.createElement('div');
  top.className = 'lex-top';
  top.innerHTML = '<span class="lex-logo">lexicon</span><span class="lex-band"></span>';
  top.querySelector('.lex-band').textContent = `LXP NATIVE | ${model}`;
  box.appendChild(top);
  // The impulse is also the pad: drag in it for Size across and Reverb Time up.
  const disp = document.createElement('div');
  disp.className = 'lex-disp';
  const picture = document.createElement('span');
  picture.className = 'lex-impulse';
  const paintImpulse = () => {
    picture.innerHTML = `<svg viewBox="0 0 400 70" preserveAspectRatio="none" aria-hidden="true">${fxLexImpulse(slot.params)}</svg>`
      + `<span class="lex-rt">IMPULSE · ${fxFormat(byKey.reverbTimeS || { unit: 's' }, slot.params.reverbTimeS ?? 0)}</span>`;
  };
  if (pad) {
    const p = prismModulePad(slot, byKey[pad.x], byKey[pad.y], pad, rows);
    p.classList.add('lex-pad');
    p.prepend(picture);
    p.addEventListener('pointermove', paintImpulse);
    disp.appendChild(p);
  } else disp.appendChild(picture);
  box.appendChild(disp);
  const moved = () => { refresh(); paintImpulse(); };
  // Soft Row first, as the original opened, then its own pages. Every page is
  // in the panel; the tabs show one at a time, as the LXP did.
  const pages = [{ label: 'Soft Row', keys: shaper.panel.primary || [] }, ...groups].filter((g) => g.keys.some((k) => byKey[k]));
  const pageBox = document.createElement('div');
  pageBox.className = 'lex-pages';
  const tabs = document.createElement('div');
  tabs.className = 'lex-tabs';
  const show = (i) => {
    [...pageBox.children].forEach((pg, j) => { pg.hidden = j !== i; });
    // A page shown is brought up to date: its controls may have moved on
    // another page, or on the pad, while it was hidden.
    for (const c of pageBox.children[i].querySelectorAll('[data-key]')) c.sync?.(slot.params[c.dataset.key]);
    [...tabs.children].forEach((t, j) => { t.classList.toggle('on', j === i); t.setAttribute('aria-selected', String(j === i)); });
  };
  pages.forEach((g, i) => {
    const page = document.createElement('div');
    page.className = 'prism-group lex-page';
    page.innerHTML = '<span class="prism-group-label"></span>';
    page.querySelector('.prism-group-label').textContent = g.label;
    for (const key of g.keys) {
      const p = byKey[key];
      if (!p) continue;
      let c;
      if (p.toggle || (p.choices && p.choices.length <= 3)) {
        c = prismModuleControl(slot, p, rows, moved);
        c.classList.add('lex-choice');
      } else c = fxLexKnob(slot, p, moved);
      // The Soft Row is a second view of the same controls, so only the
      // page's own copy is the one the dimming and the pad address.
      if (i > 0 || !rows[p.key]) rows[p.key] = c;
      c.dataset.key = p.key;
      page.appendChild(c);
    }
    pageBox.appendChild(page);
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'lex-tab';
    t.setAttribute('role', 'tab');
    t.textContent = g.label.replace(', Mix and EQ', '');
    t.onclick = () => show(i);
    tabs.appendChild(t);
  });
  box.append(pageBox, tabs);
  show(0);
  paintImpulse();
}
