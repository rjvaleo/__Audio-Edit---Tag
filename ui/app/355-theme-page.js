// ──────────────────────────────────────────────────────────── the Theme page ──
//
// A page of its own (13 Nov 2026, from the mock-up RJ approved): the palettes
// as cards on the left, a large preview in the middle and the editor on the
// right. This file is the preview and the Look; the cards are `330-theme.js`
// and the editor `360-theme-editor.js`. See `docs/THEME-EDITOR.md`.
//
// **Before the editor, not after it.** `tsWire` runs at the end of
// `360-theme-editor.js` and paints the preview as the page loads; a `const`
// declared in a later file is still in its dead zone then, and reading it
// throws and takes the rest of `app.js` with it.

/// What the preview shows of each page a theme reaches through the look:
/// Grain, Chop and Wave. The names and readings are the pages' own.
///   src: the big well's title; a: the panel of bars; b: the panel of knobs;
///   tabs: the switch under the preset bar. A part is [name, value 0…1,
///   reading, centred].
const TP_PAGES = {
  grain: {
    label: 'Grain', src: 'SOURCE · THE WHOLE FILE', file: 'long evolve pad',
    a: ['TIME & PITCH', [['Stretch', 0.52, (u) => `${(0.25 + u * 1.45).toFixed(2)}×`],
      ['Pitch', 0.5, (u) => `${u >= 0.5 ? '+' : '−'}${Math.abs((u - 0.5) * 48).toFixed(2)} st`, true],
      ['Window', 0.3, (u) => `${Math.round(10 + u * 100)} ms`]]],
    b: ['ENVELOPE', [['Attack', 0.2, (u) => `${Math.round(u * 50)} ms`], ['Decay', 0.45, (u) => `${Math.round(u * 180)} ms`],
      ['Sustain', 0.6, (u) => `${Math.round(u * 100)} %`], ['Release', 0.5, (u) => `${Math.round(u * 400)} ms`]]],
    tabs: ['WSOLA', 'Vocoder', 'PVSOLA', 'Hybrid', 'Granular'],
  },
  chop: {
    label: 'Chop', src: 'SLICES · CUT AT THE SILENCES', file: 'break 92',
    a: ['DETECT', [['Sens', 0.6, (u) => `${Math.round(u * 100)}`], ['Pad', 0.2, (u) => `${Math.round(u * 50)} ms`],
      ['Gate', 1, (u) => `${Math.round(5 + u * 95)} %`]]],
    b: ['SHAPE', [['Attack', 0.1, (u) => `${(u * 20).toFixed(1)} ms`], ['Decay', 0.3, (u) => `${(u * 4).toFixed(2)} s`],
      ['Drive', 0, (u) => `${Math.round(u * 100)} %`], ['Mix', 1, (u) => `${Math.round(u * 100)} %`]]],
    tabs: ['Silence', 'Transient', 'Grid'],
  },
  wave: {
    label: 'Wave', src: 'THE TABLE · OSCILLATOR A', file: 'glass table',
    a: ['FILTER', [['Cutoff', 0.62, (u) => `${(0.02 * 1000 ** u).toFixed(1)} kHz`], ['Res', 0.2, (u) => `${Math.round(u * 100)} %`],
      ['Drive', 0.1, (u) => `${Math.round(u * 100)} %`]]],
    b: ['AMP ENVELOPE', [['Attack', 0.15, (u) => `${Math.round(u * 100)} ms`], ['Decay', 0.4, (u) => `${Math.round(u * 800)} ms`],
      ['Sustain', 0.7, (u) => `${Math.round(u * 100)} %`], ['Release', 0.35, (u) => `${Math.round(u * 1200)} ms`]]],
    tabs: ['Play', 'Create', 'Matrix', 'FX'],
  },
};

/// The page shown, and the values its controls hold — the preview's own, so
/// turning one shows how it moves without touching any page's sound.
const TP = { page: 'grain', built: false, vals: {}, preset: 'Glass pad', ab: 'A' };

/// A smooth pseudo-random sound: slow swells with grain in them, the same on
/// every redraw for a given seed.
function tpSound(n, seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const ph = [rnd() * 6, rnd() * 6];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = 0.35 + 0.3 * Math.sin(u * 7 + ph[0]) ** 2 + 0.35 * Math.max(0, Math.sin(u * 3.1 + ph[1])) ** 3;
    out[i] = Math.min(1, env * (0.55 + 0.45 * rnd()));
  }
  return out;
}

/// A waveform in the preview's `--wave`, filling its canvas.
function tpDrawWave(cv, seed, reach) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const r = window.devicePixelRatio || 1;
  cv.width = Math.round(w * r); cv.height = Math.round(h * r);
  const g = cv.getContext('2d');
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  const colour = getComputedStyle(cv).getPropertyValue('--wave').trim();
  g.fillStyle = colour || getComputedStyle(cv).color;
  if (reach > 0.9) { g.shadowColor = g.fillStyle; g.shadowBlur = 4; }
  const a = tpSound(Math.ceil(w), seed);
  for (let x = 0; x < a.length; x++) {
    const m = Math.max(0.5, a[x] * (h / 2) * reach);
    g.fillRect(x, h / 2 - m, 1, m * 2);
  }
}

/// A knob's picture: an envelope with the knob's own stage in colour, or a
/// level for anything that is not one.
function tpPic(label, u) {
  const stages = ['Attack', 'Decay', 'Sustain', 'Release'];
  const k = stages.indexOf(label);
  if (k < 0) return `<path class="f" d="M8 40H56"/><path class="a" d="M8 40H${(8 + 48 * u).toFixed(1)}"/><circle class="d" cx="${(8 + 48 * u).toFixed(1)}" cy="40" r="2.4"/>`;
  const v = TP.vals[TP.page] || {};
  const at = (name, d) => v[`b:${name}`] ?? d;
  const ax = 8 + 14 * at('Attack', 0.2), dx = ax + 14 * at('Decay', 0.4), sy = 40 - 28 * at('Sustain', 0.6);
  const rx = Math.min(58, 44 + 14 * at('Release', 0.5));
  const segs = [`M8 40L${ax} 12`, `M${ax} 12L${dx} ${sy}`, `M${dx} ${sy}L44 ${sy}`, `M44 ${sy}L${rx} 40`];
  return segs.map((d, i) => `<path class="${i === k ? 'a' : 'h'}" d="${d}"/>`).join('');
}

/// The preview's parts, built once: the Now Playing strip, the source well,
/// the panel of bars, the panel of knobs, the preset bar and a switch. They
/// are the app's own — `uiBar`, `uiKnob`, `uiSeg`, `pbarMake` — so the preview
/// is repainted by the same stylesheet as the pages and cannot drift from them.
function tpBuild() {
  const mini = $('themeMini');
  if (!mini || TP.built) return;
  TP.built = true;
  const icon = (d) => `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${d}"/></svg>`;
  mini.innerHTML = `
    <div class="tp-pnb">
      <span class="tp-tb">${icon('M3 1.8 10.4 6 3 10.2Z')}</span><span class="tp-tb">${icon('M2.6 2.6h6.8v6.8H2.6Z')}</span><span class="tp-tb">${icon('M6 2.6A3.4 3.4 0 1 1 6 9.4A3.4 3.4 0 1 1 6 2.6Z')}</span>
      <span class="tp-src on">GRAIN</span><span class="tp-src on">SEQ</span>
      <span class="tp-clock">00:00.000</span>
      <span class="tp-pfile"><b data-tp="file"></b><canvas data-tp="strip"></canvas></span>
    </div>
    <section class="tp-pp tp-psrc"><div class="tp-pt" data-tp="src"></div><div class="tp-well"><canvas data-tp="wave"></canvas></div></section>
    <div class="tp-prow">
      <section class="tp-pp"><div class="tp-pt" data-tp="a"></div><div class="tp-bars" data-tp="bars"></div></section>
      <section class="tp-pp"><div class="tp-pt" data-tp="b"></div><div class="tp-knobs" data-tp="knobs"></div>
        <div class="tp-steps" title="The four text steps: a ladder that collapses is the failure a theme most often has"><span>text</span><span>second</span><span>dim</span><span>dimmer</span></div></section>
    </div>
    <section class="tp-pp"><div class="tp-pt">THE PRESET BAR · THE TABS</div><div class="tp-prow2" data-tp="pbar"></div><div data-tp="tabs"></div></section>`;

  // A preset bar on a list of its own: it opens, steps and compares like the
  // real one, and keeps nothing.
  const names = ['Glass pad', 'Long evolve', 'Tape smear', 'Dust'];
  const bar = pbarMake({
    id: 'tpPrev', title: 'Presets (the preview)',
    adapter: {
      list: () => names.map((name, i) => ({ name, factory: i < 2 })),
      current: () => TP.preset,
      load: async (item) => { TP.preset = item.name; },
      saveAs: async (name) => { TP.preset = name; },
      rename: async () => {}, remove: async () => {}, init: async () => { TP.preset = names[0]; },
    },
    ab: { get: () => TP.ab, set: (k) => { TP.ab = k; } },
  });
  mini.querySelector('[data-tp="pbar"]').append(bar.el);

  // Which page it shows.
  const seg = uiSeg({
    items: Object.entries(TP_PAGES).map(([k, p]) => ({ k, label: p.label, title: `The preview, as ${p.label}` })),
    value: TP.page, h: 24, onPick: (k) => { TP.page = k; tpParts(); tpDraw(); },
  });
  seg.id = 'tpPageSeg';
  $('tpPage')?.replaceChildren(seg);

  tpParts();
  if (window.ResizeObserver) new ResizeObserver(() => tpDraw()).observe(mini);
}

/// The parts that change with the page: titles, bars, knobs and tabs.
function tpParts() {
  const mini = $('themeMini');
  const pg = TP_PAGES[TP.page];
  if (!mini || !pg) return;
  const v = TP.vals[TP.page] || (TP.vals[TP.page] = {});
  const q = (k) => mini.querySelector(`[data-tp="${k}"]`);
  q('src').textContent = pg.src;
  q('file').textContent = pg.file;
  q('a').textContent = pg.a[0];
  q('b').textContent = pg.b[0];

  const bars = pg.a[1].map(([label, def, fmt, bip]) => uiBar({
    label, def, bip, h: 24,
    get: () => v[`a:${label}`] ?? def,
    set: (u) => { v[`a:${label}`] = u; },
    text: () => fmt(v[`a:${label}`] ?? def),
  }));
  q('bars').replaceChildren(...bars);

  const knobs = [];
  const knobsAll = () => knobs.forEach((k) => k.sync());
  for (const [label, def, fmt] of pg.b[1]) {
    knobs.push(uiKnob({
      label, def, size: 44, pv: '0 0 64 48',
      get: () => v[`b:${label}`] ?? def,
      // An envelope's knobs draw it together, so one turned redraws all four.
      set: (u) => { v[`b:${label}`] = u; knobsAll(); },
      text: () => fmt(v[`b:${label}`] ?? def),
      pic: (u) => tpPic(label, u),
    }));
  }
  q('knobs').replaceChildren(...knobs);

  q('tabs').replaceChildren(uiSeg({ items: pg.tabs.map((t) => ({ k: t, label: t })), value: pg.tabs[0], h: 24 }));
}

/// The canvases, in the preview's current colours.
function tpDraw() {
  const mini = $('themeMini');
  if (!mini || !TP.built || mini.closest('.hidden')) return;
  const seed = { grain: 5, chop: 11, wave: 3 }[TP.page] || 5;
  const wave = mini.querySelector('[data-tp="wave"]');
  const strip = mini.querySelector('[data-tp="strip"]');
  if (wave) tpDrawWave(wave, seed, 0.82);
  if (strip) tpDrawWave(strip, seed + 1, 0.95);
}

/// Paint the preview in a palette, or in the interface's own colours.
///
/// The palette's tokens go on the preview, not on `:root` — `Theme.applyTo`
/// scopes them to one element, and everything inside reads its colours through
/// `var(--x)`. They are laid over the stylesheet's own values
/// (`themeDefaults`), not over the theme being worn, so what a palette does not
/// state is shown as it will be when worn.
function tpPaint(p, derived) {
  const mini = $('themeMini');
  if (!mini) return;
  tpBuild();
  const t = derived?.tokens || null;
  Theme.applyTo(mini, t ? { ...themeDefaults, ...Theme.lookTokens(t), ...t } : null);
  // The preview wears the palette's own waveform colour, so what the sound
  // looks like against those surfaces is visible before wearing anything.
  const wave = waveColourValue(waveShown());
  if (wave) mini.style.setProperty('--wave', wave);
  else mini.style.removeProperty('--wave');
  const note = $('tpPrevNote');
  if (note) {
    note.textContent = !p ? '' : themeState.chosen === p.id ? `today's pages, in ${p.name} · wearing it`
      : `today's pages, in ${p.name} · nothing changes until Wear`;
  }
  tpDraw();
}

/// The Look: Grain's five, the material of the panels on Grain, Chop and Edit.
/// Each is a theme (`theme-palettes.js`), and choosing one here is the Now
/// Playing bar's own choice, so the two never disagree.
function tpBuildLooks() {
  const box = $('tpLooks');
  if (!box || box.childElementCount) return;
  for (const p of allPalettes().filter((x) => x.look)) {
    const b = document.createElement('button');
    b.className = 'tp-look';
    b.dataset.look = p.look;
    b.title = `Look: ${p.name}`;
    // Its own surfaces, as on its card: the panel's top and the panel.
    b.style.setProperty('--tl-hi', p.colors[2]);
    b.style.setProperty('--tl-lo', p.colors[1]);
    const name = document.createElement('span');
    name.textContent = p.name;
    b.append(name);
    b.onclick = () => {
      nbSetLook(p.look);
      themeWearLook(p.look);
      tsSelected = p.id;
      renderThemeList();
      tsRender();
    };
    box.append(b);
  }
  tpRenderWear();
}

/// Arriving on the page: everything is drawn as it is now.
function tpEnter() {
  // Open on something, as `tsWire` does at load: the editor is the right
  // third of the page, and arriving with it empty reads as missing.
  if (!tsSelected) tsSelected = themeState.chosen || allPalettes()[0]?.id || null;
  tpBuild();
  tpBuildLooks();
  renderThemeList();
  tsRender();
  afterLayout(tpDraw);
}
