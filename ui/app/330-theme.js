// ==================================================================== theme
//
// A palette gives colour and direction. Everything else — the surface ladder,
// the four text steps, the borders — is derived, which is what lets a palette
// nobody designed for this program still produce a usable interface: the steps
// are ours and only the colour is theirs.
//
// The engine is a port and lives in `theme-derive.js`; the palettes in
// `theme-palettes.js`. What is here is the manager, in this app's own idiom
// rather than the React one it arrived in.

const THEME_STORE = 'audiolab.theme';

const themeState = {
  /// Palettes the user added. The shipped 47 are read-only and live in
  /// `THEME_PALETTES` — previewable and duplicable, never edited away.
  mine: [],
  chosen: null,
  plain: false,
  /// Whether `mglLook` has been turned into a theme yet (`themeFromLook`).
  looks: false,
};

/// The palettes this interface can actually wear.
///
/// The chrome assumes depth reads as *lighter* — a raised surface is a lighter
/// one — which is a dark-theme assumption baked into every panel. Give it a
/// light palette and the ladder walks toward white and the whole interface goes
/// flat: all 27 light palettes in the library break it, all 20 dark ones hold.
///
/// So light palettes are withheld rather than offered and disappointing. They
/// are not gone: when the chrome learns to invert its ladder they are already
/// here, and the engine already reports which direction a palette wants.
/// The shipped list, derived once.
///
/// Deciding whether a palette is dark means deriving it, and there are 47 that
/// need it. The answer depends only on `p.colors`, which is a constant — so
/// doing it per call was 47 derivations to answer a question whose answer never
/// changes, on every theme click and twice at startup.
///
/// That was survivable while a derivation was microseconds. It stopped being
/// survivable the day one cost 54ms and the whole call took 2.7 seconds. The
/// underlying bug is fixed, but the work was always wasted; see
/// `tests/ui/globals.spec.mjs`.
let shippedPalettes = null;

function allPalettes() {
  if (!shippedPalettes) {
    shippedPalettes = THEME_PALETTES
      // A theme designed for this interface is listed light or dark; one derived
      // from a palette only when it comes out dark.
      .filter((p) => (p.direct ? true : !p.colors ? p.dark : Theme.deriveTheme(p.colors).mode === 'dark'))
      .map((p) => ({ ...p, readOnly: true }));
  }
  // `mine` is not cached: it is what the Add button changes.
  return [...shippedPalettes, ...themeState.mine];
}

/// What a palette actually writes onto the document.
///
/// Two kinds live in one list. Most give colours and the engine derives sixty
/// tokens from them; a `direct` theme states its tokens outright and they are
/// used verbatim, because derivation cannot be argued with and a theme somebody
/// designed for this interface should not have to be.
///
/// Anything a direct theme omits is left to `app.css` — `Theme.apply` clears the
/// whole map before writing, so the status colours come back on their own.
function themeTokensFor(p) {
  if (!p) return null;
  return p.direct ? p.tokens : Theme.appTokens(p.colors, { plain: themeState.plain }).tokens;
}

/// Kept in the browser rather than in `data/`.
///
/// A theme is a property of the machine you are looking at, not of the library —
/// the same library opened on two screens should be allowed to look different on
/// each. It is also the one setting where losing it costs nothing.
function loadTheme() {
  try {
    const v = JSON.parse(localStorage.getItem(THEME_STORE) || '{}');
    themeState.mine = Array.isArray(v.mine) ? v.mine : [];
    themeState.chosen = v.chosen || null;
    themeState.plain = !!v.plain;
    themeState.looks = !!v.looks;
  } catch { /* a corrupt entry is no theme, not a broken app */ }
  themeFromLook();
}

/// Chop's five Looks became themes on 11 Nov 2026. Whoever had picked one gets
/// its theme, once; Graphite + Acrylic, the default, leaves the theme alone.
function themeFromLook() {
  if (themeState.looks) return;
  themeState.looks = true;
  let look = null;
  try { look = localStorage.getItem('mglLook'); } catch { /* private mode */ }
  const p = look && look !== 'AD' && THEME_PALETTES.find((x) => x.look === look);
  if (p) themeState.chosen = p.id;
  saveTheme();
}

function saveTheme() {
  try {
    localStorage.setItem(THEME_STORE, JSON.stringify({
      mine: themeState.mine, chosen: themeState.chosen, plain: themeState.plain, looks: themeState.looks,
    }));
  } catch { /* private browsing, a full quota — neither is worth a toast */ }
}

/// Counted up each time a theme is put on, so a page that read its colours
/// into a cache (`wvCl`, `gsCl`, Chop's `chopTok`) knows to read them again.
let themeStamp = 0;

/// Which of Grain's Looks a theme is: its own for a Look theme, the default
/// Graphite + Acrylic for any other.
///
/// The Now Playing bar and the Edit page read the Look from `mglLook` and
/// `data-mgl-look`, so they are kept in step with the theme rather than
/// cleared: one setting, chosen on the Theme page or from the bar.
function themeLook(p) {
  return p?.look || 'AD';
}

function applyChosenTheme() {
  const p = allPalettes().find((x) => x.id === themeState.chosen);
  Theme.apply(p ? themeTokensFor(p) : null);
  themeStamp++;
  const look = themeLook(p);
  document.documentElement.dataset.mglLook = look;
  try { localStorage.setItem('mglLook', look); } catch { /* private mode */ }
  // The waveform travels with the theme. `applyWaveColour` is defined below
  // this, but this only ever runs from a handler or after load, never during
  // it, so the ordering is safe — unlike reaching for it at declaration time.
  if (typeof applyWaveColour === 'function') applyWaveColour({ save: false });
}

/// Wear the theme of one of Grain's Looks. The Now Playing bar's Look buttons
/// come here, through `chopSetLook`, which is the name the bar calls.
///
/// Only ever from a handler: Grain's, Wave's and Chop's state is declared in
/// files below this one and is in its dead zone while this file loads.
function themeWearLook(k) {
  const p = allPalettes().find((x) => x.look === k);
  if (!p) return;
  if (themeState.chosen !== p.id) {
    themeState.chosen = p.id;
    saveTheme(); applyChosenTheme(); renderThemeList();
  }
  // The page in front repaints now; the others as they are next shown.
  if (GS.showing) gsRestyle();
  if (WV.showing) wvRestyle();
  if (document.body.classList.contains('choppage')) chopRestyle();
}

/// The studio's own state, declared here rather than beside the rest of the
/// studio because `renderThemeList` reads it and runs during load.
///
/// `let` and `const` hoist into a dead zone: until the declaration executes,
/// even `typeof` on the name throws. Declaring these after their first reader
/// therefore did not merely leave them undefined — it threw during load and
/// took the rest of `app.js` with it, which is the same failure as the palette
/// that had no `colors`. Load order is a real dependency and this file is one
/// long script.
///
/// `tsSelected` is the palette open in the editor. `themeState.chosen` is the
/// one the application is wearing. They are different, and you edit one while
/// wearing another.
let tsSelected = null;
let tsFilterText = '';
let tsShowTokens = false;

/// The palettes, as cards: the swatch row large enough to judge, the name and
/// one tag under it. Click one to preview it in the editor; Wear it puts it on.
function renderThemeList() {
  const box = $('themeList');
  if (!box) return;
  box.innerHTML = '';
  const all = allPalettes();
  const q = tsFilterText.trim().toLowerCase();
  const shown = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  const count = $('tpCount');
  if (count) {
    const mine = all.filter((p) => !p.readOnly).length;
    count.textContent = `${all.length - mine} built in · ${mine} yours`;
  }
  tpRenderWear();
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'tp-empty';
    empty.textContent = q ? 'No palettes match that filter.' : 'No palettes yet.';
    box.appendChild(empty);
    return;
  }
  for (const p of shown) {
    const card = document.createElement('div');
    // Two different states, and conflating them was the old behaviour's fault:
    // `chosen` is the palette the application is *wearing*, `tsSelected` is the
    // one open in the editor. You edit one while wearing another.
    card.className = 'theme-card'
      + (p.id === themeState.chosen ? ' chosen' : '')
      + (p.id === tsSelected ? ' editing' : '');
    card.dataset.id = p.id;
    // A theme saved from the editor states its tokens outright and has no five
    // colours behind it. Assuming every palette carries `colors` threw here at
    // load, which aborted the rest of `app.js` — so the meters, the room and
    // everything after simply never came into being.
    const chips = p.colors
      || (p.tokens ? ['--accent', '--surface-2', '--surface', '--bg', '--sink']
        .map((k) => p.tokens[k]).filter(Boolean) : []);
    card.title = `${p.name} — click to preview, double-click to wear`;

    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    // Dark to light, as the engine reads them: the card shows the order the
    // colours will take on screen rather than the order they were typed in.
    for (const c of tsDarkToLight(chips).slice(0, 6)) {
      const chip = document.createElement('i');
      chip.style.background = c;
      swatch.appendChild(chip);
    }

    const name = document.createElement('span');
    name.className = 'theme-name';
    const title = document.createElement('b');
    title.textContent = p.name;
    name.appendChild(title);
    const tag = document.createElement('em');
    tag.textContent = p.id === themeState.chosen ? 'WEARING'
      : p.id === tsSelected ? 'EDITING' : p.readOnly ? 'BUILT IN' : 'YOURS';
    name.appendChild(tag);

    card.append(swatch, name);
    if (!p.readOnly) {
      const del = document.createElement('button');
      del.className = 'theme-del';
      del.textContent = '×';
      del.title = 'Remove this palette';
      del.onclick = (e) => {
        e.stopPropagation();
        themeState.mine = themeState.mine.filter((x) => x.id !== p.id);
        if (themeState.chosen === p.id) themeState.chosen = null;
        if (tsSelected === p.id) tsSelected = themeState.chosen || themeState.mine[0]?.id || null;
        saveTheme(); applyChosenTheme(); renderThemeList(); tsRender();
      };
      card.appendChild(del);
    }

    // **A click previews; it does not wear** (13 Nov 2026). While the studio was
    // a narrow pane beside the page, looking at the app in a theme meant
    // wearing it, so a click did. The page has a large preview of its own now,
    // and the mock-up RJ approved says it plainly: nothing changes until Wear.
    // A double-click is the shortcut for both.
    card.onclick = () => {
      tsSelected = p.id;
      tsRender();
      renderThemeList();
    };
    card.ondblclick = () => tsWear(p.id);
    box.appendChild(card);
  }
}

/// Colours sorted dark to light, by the lightness the engine sorts them by.
/// Anything unreadable keeps its place at the end.
function tsDarkToLight(colours) {
  const l = (c) => {
    const rgb = /^#[0-9a-f]{6}$/i.test(c) ? Theme.hexToRgb(c) : null;
    return rgb ? Theme.rgbToHsl(rgb).l : 2;
  };
  return [...colours].sort((a, b) => l(a) - l(b));
}

/// Put a palette on the whole app.
function tsWear(id) {
  themeState.chosen = id;
  saveTheme();
  applyChosenTheme();
  renderThemeList();
  tsRender();
}

/// The bar across the top: what is worn and what is open, and how it is worn.
function tpRenderWear() {
  const worn = allPalettes().find((x) => x.id === themeState.chosen);
  const open = allPalettes().find((x) => x.id === tsSelected);
  const status = $('tpStatus');
  if (status) {
    status.textContent = `wearing ${worn ? worn.name : 'no theme'}`
      + (open && open !== worn ? ` · editing ${open.name}` : '');
  }
  const mark = (id, on) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('on', on);
    el.setAttribute('aria-checked', String(on));
  };
  mark('themeWorn', !!worn && !themeState.plain);
  mark('themePlain', !!worn && themeState.plain);
  mark('themeNone', !worn);
  for (const b of document.querySelectorAll('#tpLooks [data-look]')) {
    b.classList.toggle('on', b.dataset.look === document.documentElement.dataset.mglLook);
  }
}

// ------------------------------------------------------------ waveform colour

/// Four neon colours for the waveform, and anything else you name.
///
/// Deliberately *not* part of the palette engine. A theme derives sixty tokens
/// from a handful of colours so the chrome holds contrast; the waveform is not
/// chrome — it is the thing being looked at, and it wants to be the loudest
/// colour on the screen rather than a consequence of the surfaces behind it.
/// `Theme.apply` only clears the tokens in its own map, so this one survives
/// every palette change and every "No theme".
///
/// The chroma is past what sRGB can show on purpose: it clamps to the edge of
/// the gamut, which is exactly as neon as the display goes.
const WAVE_COLOURS = {
  blue:   'oklch(70% 0.24 250)',
  green:  'oklch(82% 0.28 145)',
  red:    'oklch(64% 0.29 27)',
  purple: 'oklch(60% 0.32 310)',
};
const WAVE_STORE = 'audiolab.waveColour';

/// What is stored: one of the four names, a `#hex`, or nothing for the default.
///
/// A palette carries its own now, so this is the *worn* palette's waveform,
/// then the standing choice in local storage, which is what a fresh install and
/// a "No theme" both fall back to.
///
/// **Not the palette open in the editor.** Preferring that meant clicking a
/// palette to look at it repainted the real waveform — which breaks the rule
/// the rest of the studio keeps, that selecting opens a palette and only Wear
/// it wears it. What the editor is holding belongs to the preview; see
/// `waveShown`.
///
/// Deliberately not written with `tsPalette`, which is a `const` declared in the
/// studio block far below: calling it from here at load time would reach into
/// its dead zone and throw. `allPalettes` and `themeState` are declared above.
function waveChoice() {
  const worn = themeState.chosen
    ? allPalettes().find((p) => p.id === themeState.chosen)?.wave
    : null;
  if (worn) return worn;
  try { return localStorage.getItem(WAVE_STORE) || null; } catch { return null; }
}

/// What the *editor* is showing — the open palette's waveform when there is
/// one, otherwise whatever the page is wearing. This drives the swatches and
/// the miniature, and never the page.
function waveShown() {
  const open = tsSelected ? allPalettes().find((p) => p.id === tsSelected) : null;
  return open?.wave ?? waveChoice();
}

/// Whether the waveform controls are editing a palette rather than the standing
/// default — true when an editable palette is open in the studio.
function waveEditsPalette() {
  const p = tsSelected ? allPalettes().find((x) => x.id === tsSelected) : null;
  return !!p && !p.readOnly;
}

function waveColourValue(choice) {
  if (!choice) return null;
  return WAVE_COLOURS[choice] || (/^#[0-9a-f]{3,8}$/i.test(choice) ? choice : null);
}

/// `--wave` inline on `:root`, which beats the stylesheet without touching it —
/// the same trick `Theme.apply` uses, and removing it is how the default comes
/// back rather than a copy of the default that could drift.
function applyWaveColour({ save = true, redraw = true } = {}) {
  const choice = applyWaveColour.live ?? waveChoice();
  const value = waveColourValue(choice);
  const root = document.documentElement;
  if (value) root.style.setProperty('--wave', value);
  else root.style.removeProperty('--wave');
  if (save && applyWaveColour.live === undefined) renderWaveColours();
  if (redraw) {
    // Everywhere the waveform is drawn, not just the lane: the overview, the
    // browse rows and the automation lanes all take `--wave`.
    drawWave(); drawOverview(); drawGrainLayer();
    // The browse rows hold their waveform in a canvas each, drawn once when the
    // row was built — so they are repainted from the thumbnails already in hand
    // rather than re-fetched.
    for (const row of document.querySelectorAll('.file-row')) {
      const path = row.dataset.path;
      const thumb = row.querySelector('.thumb');
      if (thumb && path && state.thumbs?.[path]) {
        drawThumb(thumb, state.thumbs[path], row.classList.contains('selected'));
      }
    }
  }
}

function setWaveColour(choice) {
  // Onto the palette when one is open, so a theme carries the sound's colour
  // with it. Onto local storage otherwise, which is the standing default.
  if (waveEditsPalette()) {
    const p = allPalettes().find((x) => x.id === tsSelected);
    const i = themeState.mine.findIndex((x) => x.id === p.id);
    if (i >= 0) {
      if (choice) themeState.mine[i] = { ...themeState.mine[i], wave: choice };
      else { const { wave, ...rest } = themeState.mine[i]; themeState.mine[i] = rest; }
      saveTheme();
      renderThemeList();
    }
  } else {
    try {
      if (choice) localStorage.setItem(WAVE_STORE, choice);
      else localStorage.removeItem(WAVE_STORE);
    } catch { /* private mode — it still applies for this session */ }
  }
  applyWaveColour.live = undefined;
  applyWaveColour();
}

function renderWaveColours() {
  const box = $('waveColours');
  if (!box) return;
  // What the editor is holding, not what the page is wearing.
  const choice = waveShown();
  for (const b of box.querySelectorAll('[data-wave]')) {
    b.classList.toggle('active', b.dataset.wave === choice);
    b.style.setProperty('--chip', WAVE_COLOURS[b.dataset.wave]);
  }
  // The round chips either side: the default, and your own colour.
  $('waveReset')?.classList.toggle('active', !choice);
  $('waveOwn')?.classList.toggle('active', !!choice && !WAVE_COLOURS[choice]);
  // The swatch starts from what is on screen, whichever way it got there — so
  // reaching for your own colour is a nudge from the current one rather than
  // from whatever the picker happened to hold last. A named colour is `oklch`
  // and the native swatch only speaks hex, so it goes through the browser.
  const own = $('waveOwn');
  if (own) {
    const shown = waveColourValue(choice) || getComputedStyle(document.documentElement)
      .getPropertyValue('--wave').trim();
    const hex = cssHex(shown);
    if (hex) own.value = hex;
  }
}

/// Any CSS colour to `#rrggbb`, by painting one pixel of it and reading it back.
///
/// Not through `getComputedStyle`: a modern browser keeps `oklch()` as `oklch()`
/// there, so scraping numbers out of it read the lightness and chroma as if they
/// were red and green — `oklch(0.7 0.24 250)` came back `#0100fa` and purple came
/// back black. A pixel is the colour after gamut clamping, which is the colour
/// actually on screen and the right thing for the swatch to start from.
///
/// **Named `cssHex`, not `toHex`.** `ui/theme-derive.js` and this file are both
/// classic scripts and share one global scope, and this one loads second — so a
/// `function toHex` here silently replaced the engine's own `toHex(r, g, b)`.
/// Every `hsl()` in the theme engine then handed three numbers to a
/// one-argument function, which returned black: 69 of a derived theme's 86
/// tokens came out `#000000`, and each one built a canvas to do it. See
/// `tests/ui/globals.spec.mjs`, which now fails if the two files declare the
/// same name.
///
/// **Remembered, and read off one canvas.** The Stage asks for the ridge's
/// colours on every frame (`ridgePaint` → `rpToken` → here), and each call built
/// a canvas and read a pixel back off the GPU: a stall per call, "GPU stall due
/// to ReadPixels" in the console, and frames of half a second wherever WebGL is
/// drawn in software. The page stopped answering the pointer, and the browser
/// tests that open the Stage timed out on every push. The answer for a given
/// string never changes, so it is worked out once; the one canvas is kept, and
/// asked to stay on the CPU.
function cssHex(colour) {
  if (!colour) return null;
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour.toLowerCase();
  const memo = cssHex.memo || (cssHex.memo = new Map());
  if (memo.has(colour)) return memo.get(colour);
  let hex = null;
  try {
    if (!cssHex.ctx) {
      const cv = document.createElement('canvas');
      cv.width = 1; cv.height = 1;
      cssHex.ctx = cv.getContext('2d', { willReadFrequently: true });
    }
    const c = cssHex.ctx;
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = '#000';
    c.fillStyle = colour;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  } catch { hex = null; }
  // A theme being dragged through its colours mints a new string at every step.
  if (memo.size > 512) memo.clear();
  memo.set(colour, hex);
  return hex;
}

function wireWaveColour() {
  const box = $('waveColours');
  if (!box) return;
  applyWaveColour({ redraw: false });
  renderWaveColours();

  for (const b of box.querySelectorAll('[data-wave]')) {
    b.onclick = () => {
      // Clicking the chosen one takes it off, back to the waveform's own
      // colour, as the default chip beside them does.
      setWaveColour(waveChoice() === b.dataset.wave ? null : b.dataset.wave);
    };
  }

  const own = $('waveOwn');
  if (own) {
    // Live while dragging in the picker, committed on change — so you can see
    // the waveform take the colour before deciding.
    own.addEventListener('input', () => {
      applyWaveColour.live = own.value;
      applyWaveColour({ save: false });
    });
    own.addEventListener('change', () => setWaveColour(own.value));
  }
  const reset = $('waveReset');
  if (reset) reset.onclick = () => setWaveColour(null);
}

/// What the stylesheet gives every token a theme may set, read once before any
/// theme is put on. The preview starts from these rather than from whatever
/// the page is wearing, so a palette that states only some tokens is shown
/// over the interface's own colours, which is how it will look when worn.
let themeDefaults = {};
function readThemeDefaults() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of [...Object.keys(THEME_TOKEN_MAP), ...THEME_DIRECT_KEYS, ...THEME_LOOK_KEYS]) {
    if (k === '--wave' || k === '--wave-2' || k === 'color-scheme') continue;
    const v = cs.getPropertyValue(k).trim();
    if (v) themeDefaults[k] = v;
  }
}

function wireTheme() {
  if (!$('themeList')) return;
  readThemeDefaults();
  loadTheme();
  applyChosenTheme();
  renderThemeList();

  // Three ways to wear it, one switch: the palette as derived, the palette
  // with plain surfaces, or none. Choosing either of the first two with
  // nothing worn wears the palette open in the editor.
  const wearOpen = () => {
    if (!themeState.chosen && tsSelected) themeState.chosen = tsSelected;
  };
  $('themeWorn').onclick = () => {
    themeState.plain = false;
    wearOpen();
    saveTheme(); applyChosenTheme(); renderThemeList(); tsRender();
  };
  $('themePlain').onclick = () => {
    themeState.plain = true;
    wearOpen();
    saveTheme(); applyChosenTheme(); renderThemeList(); tsRender();
  };
  $('themeNone').onclick = () => {
    themeState.chosen = null;
    saveTheme(); applyChosenTheme(); renderThemeList();
  };
  $('themeAdd').onclick = () => {
    const raw = $('themeColors').value || '';
    const colors = raw.split(/[\s,]+/).filter(Boolean)
      .map((c) => (c.startsWith('#') ? c : `#${c}`))
      .filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
    if (colors.length < 2) { toast('Two colours at least'); return; }
    const taken = allPalettes().map((p) => p.id);
    let id = `mine-${colors.length}-${Date.now().toString(36)}`;
    while (taken.includes(id)) id += 'x';
    themeState.mine.push({ id, name: `Mine ${themeState.mine.length + 1}`, colors });
    themeState.chosen = id;
    tsSelected = id;
    $('themeColors').value = '';
    saveTheme(); applyChosenTheme(); renderThemeList(); tsRender();
  };
}

wireTheme();
wireWaveColour();
checkAudioDevice();
wireLeftPanelResize();

