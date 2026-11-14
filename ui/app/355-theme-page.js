// ──────────────────────────────────────────────────────────── the Theme page ──
//
// A page of its own (13 Nov 2026, from the mock-up RJ approved): the palettes
// as cards on the left, a sheet of the app's parts in the middle and the editor
// on the right, and across the top a button for every page of the app. This
// file is the parts, the pages and the Look; the cards are `330-theme.js` and
// the editor `360-theme-editor.js`. See `docs/THEME-EDITOR.md`.
//
// **Before the editor, not after it.** `tsWire` runs at the end of
// `360-theme-editor.js` and paints the preview as the page loads; a `const`
// declared in a later file is still in its dead zone then, and reading it
// throws and takes the rest of `app.js` with it.

/// What the sheet of parts shows: the controls every page is built from, with
/// Grain's names and readings on them.
///   src: the big well's title; a: the panel of bars; b: the panel of knobs;
///   tabs: the switch under the preset bar. A part is [name, value 0…1,
///   reading, centred].
///
/// It used to offer Grain, Chop and Wave (13–14 Nov 2026): three sets of names
/// on the one skeleton, painted on `#themeMini`. The pages' own stylesheets are
/// scoped to `#grainView`, `body.choppage` and `#waveView` and never reached
/// it, so the three looked alike and like none of the pages — RJ: "they're all
/// exactly the same". The pages themselves are what the buttons across the top
/// show now (below, *the page itself*); this is only the parts.
const TP_PARTS = {
  src: 'SOURCE · THE WHOLE FILE', file: 'long evolve pad',
  a: ['TIME & PITCH', [['Stretch', 0.52, (u) => `${(0.25 + u * 1.45).toFixed(2)}×`],
    ['Pitch', 0.5, (u) => `${u >= 0.5 ? '+' : '−'}${Math.abs((u - 0.5) * 48).toFixed(2)} st`, true],
    ['Window', 0.3, (u) => `${Math.round(10 + u * 100)} ms`]]],
  b: ['ENVELOPE', [['Attack', 0.2, (u) => `${Math.round(u * 50)} ms`], ['Decay', 0.45, (u) => `${Math.round(u * 180)} ms`],
    ['Sustain', 0.6, (u) => `${Math.round(u * 100)} %`], ['Release', 0.5, (u) => `${Math.round(u * 400)} ms`]]],
  tabs: ['WSOLA', 'Vocoder', 'PVSOLA', 'Hybrid', 'Granular'],
};

/// The values the parts hold — the preview's own, so turning one shows how it
/// moves without touching any page's sound. `pages` are the buttons across the
/// top, one per page of the rail; `live` is set while one of those pages is
/// showing in the palette being edited (`tpLiveStart`).
const TP = { built: false, vals: {}, preset: 'Glass pad', ab: 'A', pages: [], live: null, soon: false };

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
  const v = TP.vals;
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

  tpParts();
  tpBuildPages();
  if (window.ResizeObserver) new ResizeObserver(() => tpDraw()).observe(mini);
}

/// The titles, the bars, the knobs and the tabs.
function tpParts() {
  const mini = $('themeMini');
  const pg = TP_PARTS;
  if (!mini) return;
  const v = TP.vals;
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
  const seed = 5;
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
    note.textContent = !p ? '' : themeState.chosen === p.id ? `the app's parts, in ${p.name} · wearing it`
      : `the app's parts, in ${p.name} · nothing changes until Wear`;
  }
  tpDraw();
  // A page being previewed follows the editor, a frame at a time.
  tpLiveSoon();
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

/// Arriving on the page: everything is drawn as it is now. Coming back from a
/// page being previewed ends the preview, whichever way you came.
function tpEnter() {
  tpLiveEnd(true);
  tpLiveMark();
  // Open on something, as `tsWire` does at load: the editor is the right
  // third of the page, and arriving with it empty reads as missing.
  if (!tsSelected) tsSelected = themeState.chosen || allPalettes()[0]?.id || null;
  tpBuild();
  tpBuildLooks();
  renderThemeList();
  tsRender();
  afterLayout(tpDraw);
}

// ──────────────────────────────────────────────────────────── the page itself ──
//
// A button for every page of the app, across the top of the Theme page; one
// pressed shows **that page, the real one**, in the palette open in the editor,
// with the editor docked beside it (`#tpDock`). Nothing is worn: the chosen
// theme comes back the moment the preview ends — on the Theme page again, or
// with Stop.
//
// **Why the real page and not a miniature of it** (14 Nov 2026). A miniature
// can only look like a page if the page's own stylesheet reaches it, and those
// are scoped to the page: `#grainView`, `#waveView`, `body.choppage`,
// `#dockHyper`, the Edit page's `body.wavepage`. Carrying the same ids into a
// miniature duplicates them in the document; carrying the body classes changes
// the page underneath. Seq is an iframe and cannot be copied at all — it reads
// the theme off the root (`ui/sequencer/look.js`). And the tokens derived on
// `:root` itself (`color-mix` of `--accent` and the like) are worked out there,
// not on a container, so a scoped copy of a theme is never quite the theme. The
// real page with the tokens on the root is the theme exactly as it will be worn
// — the same call, `Theme.apply`, that Wear it makes.
//
// The earlier objection to previewing on the page was that a control which
// repaints the whole interface jumps under your hand. So the editor beside it
// is held in what is *worn* (its own tokens, `Theme.applyTo`), and only the
// page behind it changes.

/// The buttons, from the rail itself, so a page added there is offered here.
/// Theme is the page they are on, so it is left out.
function tpBuildPages() {
  TP.pages = [...document.querySelectorAll('#leftRail .mode-btn')]
    .filter((r) => r.dataset.mode && r.dataset.mode !== 'theme')
    .map((r) => ({
      key: `${r.dataset.mode}:${r.dataset.page || ''}`,
      label: r.querySelector('.rl-lb')?.textContent.trim() || r.dataset.mode,
      rail: r,
    }));
  for (const box of [$('tpPages'), $('tpLivePages')]) {
    if (!box) continue;
    box.replaceChildren(...TP.pages.map((pg) => {
      const b = document.createElement('button');
      b.className = 'tp-btn tp-pg';
      b.dataset.pg = pg.key;
      b.textContent = pg.label;
      b.title = `${pg.label}, the page itself, in the palette open in the editor. Nothing is worn until Wear it.`;
      b.onclick = () => tpLiveGo(pg);
      return b;
    }));
  }

  $('tpLiveBack')?.addEventListener('click', () => $('leftRail').querySelector('.mode-btn[data-mode="theme"]')?.click());
  $('tpLiveStop')?.addEventListener('click', () => tpLiveEnd(false));
  $('tpLivePrev')?.addEventListener('click', () => tpLiveStep(-1));
  $('tpLiveNext')?.addEventListener('click', () => tpLiveStep(1));

  // The page moves without these buttons being touched — the rail, a
  // double-click in Browse — and `setMode` writes its classes on `<body>`.
  new MutationObserver(() => tpLiveMark())
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  tpLiveMark();
}

/// Whether the rail's button is the page on screen.
function tpLiveHere(r) {
  return state.mode === r.dataset.mode && (!r.dataset.page || editPage === r.dataset.page);
}

/// Edit, Grain, Prism and Chop are the open sound; with none there is nothing
/// to show, as the rail says (`go` in `ui/rail.js`).
const tpNeedsSound = (r) => r.dataset.mode === 'edit' && !state.selectedFile && !state.tabs.length;

/// Show a page in the palette being edited. The page is reached the way the
/// rail reaches it, by its own button, so it arrives exactly as it would.
function tpLiveGo(pg) {
  if (tpNeedsSound(pg.rail)) {
    toast('Open a sound first — double-click one in the library');
    return;
  }
  if (!TP.live) tpLiveStart();
  // The tokens first, so a page drawn as it arrives reads them (`themeStamp`).
  tpLivePaint();
  if (!tpLiveHere(pg.rail)) pg.rail.click();
  tpLiveMark();
}

/// The editor's own section, which is moved rather than copied: the same
/// wells, the same handlers, one of each id.
const tpEditorPanel = () => $('tsEditor')?.closest('.tp-ed');

function tpLiveStart() {
  // The Edit page each of these sets is remembered (`setEditPage`); coming
  // back to Theme puts the one there was back.
  TP.live = { from: editPage };
  document.body.classList.add('tplive');
  const dock = $('tpDock');
  const ed = tpEditorPanel();
  if (dock && ed) dock.append(ed);
  dock?.classList.remove('hidden');
}

/// Paint the page in the palette open in the editor: the same tokens Wear it
/// puts on, on the same element, and the Look and the waveform that come with
/// it. Nothing is saved; `themeState.chosen` is untouched.
function tpLivePaint() {
  if (!TP.live) return;
  const root = document.documentElement;
  const p = tsPalette();
  Theme.apply(p ? tsDerive(p)?.tokens || null : null);
  root.dataset.mglLook = themeLook(p);
  themeStamp++;
  // The colour picker's drag (`applyWaveColour.live`) wins while it lasts.
  const wave = waveColourValue(applyWaveColour.live ?? waveShown());
  if (wave) root.style.setProperty('--wave', wave);
  else root.style.removeProperty('--wave');

  // The editor beside the page holds still: it wears what is worn, laid over
  // the stylesheet's own values as the parts sheet is (`tpPaint`).
  const worn = allPalettes().find((x) => x.id === themeState.chosen);
  const t = worn ? tsDerive(worn)?.tokens : null;
  Theme.applyTo($('tpDock'), { ...themeDefaults, ...(t ? { ...Theme.lookTokens(t), ...t } : {}) });

  tpLiveRestyle();
  tpLiveMark();
}

/// Once a frame at most: a colour well fires for every step of a drag.
function tpLiveSoon() {
  if (!TP.live || TP.soon) return;
  TP.soon = true;
  afterLayout(() => { TP.soon = false; tpLivePaint(); });
}

/// What a page drew once in its colours, drawn again — what `themeWearLook`
/// does for a Look. The rest of every page is CSS and follows on its own.
function tpLiveRestyle() {
  if (GS.showing) gsRestyle();
  if (WV.showing) wvRestyle();
  if (document.body.classList.contains('choppage')) chopRestyle();
  drawWave(); drawOverview(); drawGrainLayer();
  edSetLook();
}

/// End the preview and put back what is worn. `home`: on the way back to the
/// Theme page, which also puts back the Edit page there was.
function tpLiveEnd(home) {
  if (!TP.live) return;
  const { from } = TP.live;
  TP.live = null;
  document.body.classList.remove('tplive');
  const dock = $('tpDock');
  if (dock) {
    dock.classList.add('hidden');
    Theme.applyTo(dock, null);
  }
  const ed = tpEditorPanel();
  if (ed) document.querySelector('#themeView .tp-body')?.append(ed);
  if (home && from !== editPage) setEditPage(from, false);
  applyChosenTheme();
  tpLiveRestyle();
  tpLiveMark();
}

/// The next or the previous palette, in the cards' order and filter, without
/// going back to the cards.
function tpLiveStep(by) {
  const q = tsFilterText.trim().toLowerCase();
  const list = allPalettes().filter((p) => !q || p.name.toLowerCase().includes(q));
  if (!list.length) return;
  const i = list.findIndex((p) => p.id === tsSelected);
  const n = list.length;
  tsSelected = list[i < 0 ? (by > 0 ? 0 : n - 1) : (i + by + n) % n].id;
  renderThemeList();
  tsRender();
}

/// Which page is lit, which need a sound, and what the dock says.
function tpLiveMark() {
  for (const b of document.querySelectorAll('.tp-pg[data-pg]')) {
    const pg = TP.pages.find((x) => x.key === b.dataset.pg);
    if (!pg) continue;
    b.classList.toggle('on', !!TP.live && tpLiveHere(pg.rail));
    b.classList.toggle('tp-off', tpNeedsSound(pg.rail));
  }
  const note = $('tpLiveNote');
  if (note && TP.live) {
    const p = tsPalette();
    const here = TP.pages.find((x) => tpLiveHere(x.rail));
    note.textContent = `${p ? p.name : 'no theme'}${here ? ` on ${here.label}` : ''}`
      + (p && themeState.chosen === p.id ? ' · wearing it' : ' · not worn');
  }
}
