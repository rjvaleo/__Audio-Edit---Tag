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
      .filter((p) => (p.direct || !p.colors ? p.dark : Theme.deriveTheme(p.colors).mode === 'dark'))
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
  } catch { /* a corrupt entry is no theme, not a broken app */ }
}

function saveTheme() {
  try {
    localStorage.setItem(THEME_STORE, JSON.stringify({
      mine: themeState.mine, chosen: themeState.chosen, plain: themeState.plain,
    }));
  } catch { /* private browsing, a full quota — neither is worth a toast */ }
}

function applyChosenTheme() {
  const p = allPalettes().find((x) => x.id === themeState.chosen);
  Theme.apply(p ? themeTokensFor(p) : null);
  // The waveform travels with the theme. `applyWaveColour` is defined below
  // this, but this only ever runs from a handler or after load, never during
  // it, so the ordering is safe — unlike reaching for it at declaration time.
  if (typeof applyWaveColour === 'function') applyWaveColour({ save: false });
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

function renderThemeList() {
  const box = $('themeList');
  if (!box) return;
  box.innerHTML = '';
  const q = tsFilterText.trim().toLowerCase();
  const shown = q
    ? allPalettes().filter((p) => p.name.toLowerCase().includes(q))
    : allPalettes();
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'ts-empty';
    empty.textContent = q ? 'No palettes match that filter.' : 'No palettes yet.';
    box.appendChild(empty);
    return;
  }
  for (const p of shown) {
    const row = document.createElement('div');
    // Two different states, and conflating them was the old behaviour's fault:
    // `chosen` is the palette the application is *wearing*, `tsSelected` is the
    // one open in the editor. You edit one while wearing another.
    row.className = 'theme-row'
      + (p.id === themeState.chosen ? ' chosen' : '')
      + (p.id === tsSelected ? ' editing' : '');
    // A theme saved from the editor states its tokens outright and has no five
    // colours behind it. Assuming every palette carries `colors` threw here at
    // load, which aborted the rest of `app.js` — so the meters, the room and
    // everything after simply never came into being.
    const chips = p.colors
      || (p.tokens ? ['--accent', '--surface-2', '--surface', '--bg', '--sink']
        .map((k) => p.tokens[k]).filter(Boolean) : []);
    row.title = `${p.name} — ${chips.join(' ')}`;

    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    for (const c of chips.slice(0, 6)) {
      const chip = document.createElement('i');
      chip.style.background = c;
      swatch.appendChild(chip);
    }

    const name = document.createElement('span');
    name.className = 'theme-name';
    name.textContent = p.name;
    for (const [when, text] of [[p.id === themeState.chosen, ' · applied'],
      [p.readOnly, ' · built in']]) {
      if (!when) continue;
      const note = document.createElement('i');
      note.className = 'theme-inline-note';
      note.textContent = text;
      name.appendChild(note);
    }

    row.append(swatch, name);
    if (!p.readOnly) {
      const del = document.createElement('button');
      del.className = 'theme-del';
      del.textContent = '×';
      del.title = 'Remove this palette';
      del.onclick = (e) => {
        e.stopPropagation();
        themeState.mine = themeState.mine.filter((x) => x.id !== p.id);
        if (themeState.chosen === p.id) themeState.chosen = null;
        saveTheme(); applyChosenTheme(); renderThemeList();
      };
      row.appendChild(del);
    }

    row.onclick = () => {
      // Clicking the chosen one takes it off, so there is always a way back to
      // the interface's own colours without hunting for a button.
      // Click a theme to *see* it. The studio this came from is an admin
      // screen with the application elsewhere, so there it made sense to open a
      // palette without wearing it. Here the panel sits inside the thing being
      // themed — the whole point of clicking one is to look at the app in it.
      // It opens in the editor at the same time.
      tsSelected = p.id;
      themeState.chosen = themeState.chosen === p.id ? null : p.id;
      saveTheme();
      applyChosenTheme();
      tsRender();
      renderThemeList();
    };
    box.appendChild(row);
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
/// the rest of the studio keeps, that selecting opens a palette and only Apply
/// wears it. What the editor is holding belongs to the preview; see
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
function cssHex(colour) {
  if (!colour) return null;
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour.toLowerCase();
  try {
    const cv = document.createElement('canvas');
    cv.width = 1; cv.height = 1;
    const c = cv.getContext('2d');
    c.fillStyle = '#000';
    c.fillStyle = colour;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

function wireWaveColour() {
  const box = $('waveColours');
  if (!box) return;
  applyWaveColour({ redraw: false });
  renderWaveColours();

  for (const b of box.querySelectorAll('[data-wave]')) {
    b.onclick = () => {
      // Clicking the chosen one takes it off, the same gesture the palette list
      // uses to get back to the interface's own colours.
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

function wireTheme() {
  if (!$('themeList')) return;
  loadTheme();
  applyChosenTheme();
  renderThemeList();

  $('themeNone').onclick = () => {
    themeState.chosen = null;
    saveTheme(); applyChosenTheme(); renderThemeList();
  };
  $('themePlain').onclick = () => {
    themeState.plain = !themeState.plain;
    $('themePlain').classList.toggle('on', themeState.plain);
    saveTheme(); applyChosenTheme();
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
    $('themeColors').value = '';
    saveTheme(); applyChosenTheme(); renderThemeList();
  };
}

wireTheme();
wireWaveColour();
checkAudioDevice();
wireLeftPanelResize();

