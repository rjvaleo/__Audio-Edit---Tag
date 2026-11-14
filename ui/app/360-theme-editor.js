// ────────────────────────────────────────────────────────── the theme editor ──
//
// A page of its own since 13 Nov 2026: the palettes as cards, a large preview
// built from today's parts, and the editor — the colours, the waveform and the
// Look. See `docs/THEME-EDITOR.md`.
//
// The ladder is not invented. The palette that ships is already a good theme,
// so the spacing between its surfaces and its text steps is *measured* from the
// stylesheet and reproduced — what the pickers choose is where the ladder sits
// and what colour it is, never how far apart its rungs are.

// ────────────────────────────────────────────────────────────── theme studio ──
//
// Ported from Emovis' `lib/theme-studio`, which was written to be lifted: it
// depends on React and nothing else there, and on nothing at all here. The
// derivation engine came across long ago as `theme-derive.js`; this is the
// editor that was supposed to come with it.
//
// A palette is a name and a handful of brand colours. The engine turns those
// into sixty-odd tokens, and the preview is painted entirely from them — which
// is what makes this an editor rather than a form. See `docs/THEME-EDITOR.md`.

/// `#abc` → `#aabbcc`; anything unparseable → null.
function tsNormalizeHex(input) {
  const v = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) {
    return `#${v.split('').map((c) => c + c).join('')}`.toLowerCase();
  }
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
}

function tsPaletteId(name, taken = []) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 48) || 'palette';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/// Dark to light, the order the editor shows them in, so a new palette's
/// colours sit in the rows in the order they were made.
const TS_NEW_COLORS = ['#3a3a3c', '#2e5496', '#7fa1d6', '#e8e4dc'];

const tsPalette = () => allPalettes().find((p) => p.id === tsSelected) || null;

/// The tokens for a palette, and which way round it came out.
function tsDerive(p) {
  if (!p) return null;
  try {
    if (p.direct) return { tokens: p.tokens || {}, mode: p.dark ? 'dark' : 'light' };
    if (!p.colors?.length) return null;
    return Theme.appTokens(p.colors, { plain: themeState.plain });
  } catch { return null; }
}

function tsError(message) {
  const el = $('tsError');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

/// Replace the edited palette in the user's own list.
function tsUpdate(next) {
  const i = themeState.mine.findIndex((p) => p.id === next.id);
  if (i < 0) return;
  themeState.mine[i] = next;
  saveTheme();
  tsError(null);
  tsRender();
  renderThemeList();
  // If the application is wearing the palette being edited, it follows along.
  if (themeState.chosen === next.id) applyChosenTheme();
}

function tsSetColor(index, raw) {
  const p = tsPalette();
  if (!p || p.readOnly) return;
  const hex = tsNormalizeHex(raw);
  // A half-typed "#2e5" must not wipe the colour — the field keeps what was
  // typed and the palette keeps its last readable value.
  if (!hex) return;
  const colors = [...p.colors];
  colors[index] = hex;
  tsUpdate({ ...p, colors });
}

/// What each colour on the card becomes, by where the engine puts it.
///
/// The engine sorts the card dark to light and spreads it along the lightness
/// axis (`paletteRamp`): in a dark theme the dark end is the surfaces and the
/// light end the text, and a light theme is the other way round. The accent is
/// the colour it picks as the accent, by the same rule. A theme that states its
/// tokens outright has no roles to show.
function tsRoles(p, derived) {
  if (!p?.colors?.length || p.direct) return [];
  const hsl = p.colors.map((c) => {
    const hex = tsNormalizeHex(c);
    return hex ? Theme.rgbToHsl(Theme.hexToRgb(hex)) : null;
  });
  if (hsl.some((c) => !c)) return [];
  const idx = hsl.map((_, i) => i);
  const rank = [...idx].sort((a, b) => hsl[a].l - hsl[b].l);
  const pick = (c) => c.s * (1 - Math.abs(c.l - 0.5));
  const accent = [...idx].sort((a, b) => pick(hsl[b]) - pick(hsl[a]))[0];
  const dark = derived?.mode !== 'light';
  const n = hsl.length;
  return idx.map((i) => {
    if (i === accent && hsl[i].s >= 0.04) return 'accent';
    const t = n > 1 ? rank.indexOf(i) / (n - 1) : 0;
    return (dark ? t : 1 - t) < 0.5 ? 'surfaces' : 'text';
  });
}

/// The colours: per colour, a well, its hex and what it becomes.
///
/// Both a well and a hex, deliberately. The well is how a colour is *chosen*
/// and the hex is how one is *carried* — brand colours arrive as codes, from a
/// style guide or a designer, and a picker with no way to paste one is a toy.
///
/// **Dark to light**, because that is how the engine reads the card. The rows
/// are sorted when they are built and each remembers which colour it holds
/// (`data-i`), so moving one does not reorder them under the pointer; they are
/// sorted again when a colour is committed (`change`), when nothing is held.
function tsRenderSwatches(p, derived, resort = false) {
  const box = $('tsSwatches');
  if (!box) return;
  const label = $('tsColoursLabel');
  if (label) label.textContent = `Colours · ${p.colors.length} · dark to light`;
  const roles = tsRoles(p, derived);

  // ── in place, when the shape has not changed ──
  //
  // **A colour well cannot be rebuilt while it is being used.** Moving one
  // fires `input` for every step of the drag, each of which came back through
  // here and did `innerHTML = ''` — so the very `<input type="color">` the
  // system's colour panel was attached to was destroyed under it, over and
  // over. The panel stays open, pointing at an element no longer in the
  // document, and nothing you do in it reaches the palette. The hex field lost
  // its caret to the same thing on every keystroke.
  //
  // `tsRender` already knows this about the name field, which it will not write
  // into while it has focus. The swatches never learned it.
  //
  // So: rebuild only when the palette or the number of colours changes, and
  // never write into an element somebody is using.
  const shape = `${p.id}|${p.colors.length}|${!!p.readOnly}`;
  const cells = [...box.querySelectorAll('.ts-swatch')];
  if (!resort && box.dataset.shape === shape && cells.length === p.colors.length) {
    for (const cell of cells) {
      const index = +cell.dataset.i;
      const colour = p.colors[index];
      const [well, hex] = cell.querySelectorAll('input');
      if (well && document.activeElement !== well) well.value = colour;
      if (hex && document.activeElement !== hex) hex.value = colour;
      const role = cell.querySelector('em');
      if (role) role.textContent = roles[index] || '';
    }
    return;
  }
  box.dataset.shape = shape;
  box.innerHTML = '';

  const order = p.colors.map((_, i) => i);
  const l = (c) => { const hex = tsNormalizeHex(c); return hex ? Theme.rgbToHsl(Theme.hexToRgb(hex)).l : 2; };
  order.sort((a, b) => l(p.colors[a]) - l(p.colors[b]));

  for (const index of order) {
    const colour = p.colors[index];
    const cell = document.createElement('div');
    cell.className = 'ts-swatch';
    cell.dataset.i = index;

    const well = document.createElement('input');
    well.type = 'color';
    well.value = colour;
    well.disabled = !!p.readOnly;
    well.setAttribute('aria-label', `Colour ${index + 1}`);
    well.oninput = () => tsSetColor(index, well.value);
    // The panel has closed: nothing is held, so the rows may sort again.
    well.onchange = () => { const q = tsPalette(); if (q) tsRenderSwatches(q, tsDerive(q), true); };

    const hex = document.createElement('input');
    hex.type = 'text';
    hex.value = colour;
    hex.spellcheck = false;
    hex.disabled = !!p.readOnly;
    hex.setAttribute('aria-label', `Colour ${index + 1} hex`);
    hex.oninput = () => tsSetColor(index, hex.value);
    hex.onblur = () => { hex.value = (tsPalette()?.colors || [])[index] || colour; };
    hex.onchange = well.onchange;

    const role = document.createElement('em');
    role.textContent = roles[index] || '';

    cell.append(well, hex, role);
    if (!p.readOnly && p.colors.length > 2) {
      const x = document.createElement('button');
      x.className = 'ts-x';
      x.textContent = '×';
      x.title = 'Remove this colour';
      x.onclick = () => tsUpdate({ ...p, colors: p.colors.filter((_, i) => i !== index) });
      cell.appendChild(x);
    }
    box.appendChild(cell);
  }

  if (!p.readOnly) {
    const add = document.createElement('button');
    add.className = 'tp-btn ts-add';
    add.textContent = '+ colour';
    add.onclick = () => tsUpdate({ ...p, colors: [...p.colors, '#888888'] });
    box.appendChild(add);
  }
}

/// Every derived token, with a chip. Folded away because sixty rows is a
/// reference, not a control — but when a theme looks wrong this is where the
/// reason is.
function tsRenderTokens(derived) {
  const box = $('tsTokens');
  if (!box) return;
  box.classList.toggle('hidden', !tsShowTokens);
  const fold = $('tpTokens');
  if (fold) fold.open = tsShowTokens;
  const btn = $('tsTokensBtn');
  const entries = Object.entries(derived?.tokens || {});
  if (btn) {
    btn.textContent = tsShowTokens ? `Hide the ${entries.length} derived colours`
      : `Every derived colour (${entries.length})`;
  }
  if (!tsShowTokens) return;
  box.innerHTML = '';
  for (const [k, v] of entries) {
    const row = document.createElement('div');
    const chip = document.createElement('i');
    // Some tokens are "R G B" triplets, because that side interpolated them
    // into `rgb()` with an alpha.
    chip.style.background = /^\d/.test(v) ? `rgb(${v})` : v;
    const name = document.createElement('b');
    name.textContent = k;
    const val = document.createElement('span');
    val.textContent = v;
    row.append(chip, name, val);
    box.appendChild(row);
  }
}

function tsRender() {
  const p = tsPalette();
  const editor = $('tsEditor');
  const title = $('tsEditing');
  const mode = $('tsMode');
  if (!editor) return;

  editor.classList.toggle('hidden', !p);
  tpRenderWear();
  if (!p) {
    if (title) title.textContent = 'Select a palette, or make one';
    if (mode) mode.textContent = '';
    tpPaint(null);
    return;
  }

  const derived = tsDerive(p);
  if (title) title.textContent = p.name;
  if (mode) {
    mode.textContent = [p.readOnly ? 'viewing · built in' : 'editing · yours', derived?.mode]
      .filter(Boolean).join(' · ');
  }
  const nameField = $('tsName');
  if (nameField && document.activeElement !== nameField) {
    nameField.value = p.name;
    nameField.disabled = !!p.readOnly;
  }
  $('tsDelete')?.classList.toggle('hidden', !!p.readOnly);
  const wear = $('tsApply');
  if (wear) {
    const worn = themeState.chosen === p.id;
    wear.textContent = worn ? 'Wearing' : 'Wear it';
    wear.classList.toggle('on', worn);
  }

  tsRenderSwatches(p, derived);
  renderWaveColours();
  tpPaint(p, derived);
  tsRenderTokens(derived);
}

function tsImportJson(text) {
  try {
    const doc = JSON.parse(text);
    const list = Array.isArray(doc) ? doc : [doc];
    const taken = allPalettes().map((p) => p.id);
    const clean = list
      .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.colors))
      .map((p) => ({
        id: tsPaletteId(p.id || p.name, taken),
        name: p.name,
        colors: p.colors.map((c) => tsNormalizeHex(c)).filter(Boolean),
        note: p.note || 'Imported',
      }))
      .filter((p) => p.colors.length >= 2);
    if (!clean.length) throw new Error('No palettes with at least two readable hex values.');
    themeState.mine.push(...clean);
    tsSelected = clean[0].id;
    saveTheme();
    renderThemeList();
    tsRender();
    tsError(null);
  } catch (e) {
    tsError(e instanceof Error ? e.message : String(e));
  }
}

function tsWire() {
  if (!$('tsEditor')) return;

  // Open on something.
  //
  // The original selects the first palette on mount; that line did not come
  // across, so the editor sat hidden behind "select a palette, or make one" and
  // read as missing. Preferring the palette being worn is the better default
  // still — you almost always want to look at the one you are wearing.
  if (!tsSelected) {
    tsSelected = themeState.chosen || allPalettes()[0]?.id || null;
  }

  $('tsFilter')?.addEventListener('input', (e) => {
    tsFilterText = e.target.value;
    renderThemeList();
  });

  $('tsNew')?.addEventListener('click', () => {
    const palette = {
      id: tsPaletteId('new palette', allPalettes().map((p) => p.id)),
      name: 'New palette',
      colors: [...TS_NEW_COLORS],
      note: 'Made here',
    };
    themeState.mine.push(palette);
    tsSelected = palette.id;
    saveTheme();
    renderThemeList();
    tsRender();
  });

  $('tsName')?.addEventListener('input', (e) => {
    const p = tsPalette();
    if (p && !p.readOnly) tsUpdate({ ...p, name: e.target.value });
  });

  $('tsDuplicate')?.addEventListener('click', () => {
    const p = tsPalette();
    if (!p) return;
    const copy = {
      id: tsPaletteId(`${p.name} copy`, allPalettes().map((x) => x.id)),
      name: `${p.name} copy`,
      // A built-in states its tokens outright; a copy of one has to carry them,
      // because there are no five colours behind it to derive them from again.
      ...(p.direct ? { direct: true, tokens: { ...p.tokens }, dark: p.dark } : {}),
      colors: [...(p.colors || [])],
      note: `Duplicated from ${p.name}`,
    };
    themeState.mine.push(copy);
    tsSelected = copy.id;
    saveTheme();
    renderThemeList();
    tsRender();
  });

  $('tsDelete')?.addEventListener('click', () => {
    const p = tsPalette();
    if (!p || p.readOnly) return;
    themeState.mine = themeState.mine.filter((x) => x.id !== p.id);
    if (themeState.chosen === p.id) { themeState.chosen = null; applyChosenTheme(); }
    tsSelected = themeState.mine[0]?.id || null;
    saveTheme();
    renderThemeList();
    tsRender();
  });

  $('tsApply')?.addEventListener('click', () => {
    const p = tsPalette();
    if (p) tsWear(p.id);
  });

  // The fold's own toggling is taken over, so its state and the list's are
  // one and the list is filled the moment it opens.
  $('tsTokensBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    tsShowTokens = !tsShowTokens;
    tsRenderTokens(tsDerive(tsPalette()));
  });

  $('tsCopy')?.addEventListener('click', () => {
    const mine = themeState.mine.map(({ id, name, colors, note }) => ({ id, name, colors, note }));
    navigator.clipboard?.writeText(JSON.stringify(mine, null, 2))
      .then(() => toast(`${mine.length} palette${mine.length === 1 ? '' : 's'} copied`))
      .catch(() => tsError('The clipboard refused. Copy from the tokens list instead.'));
  });

  $('tsImport')?.addEventListener('click', () => {
    const text = prompt('Paste palette JSON — one object or an array of { name, colors }');
    if (text) tsImportJson(text);
  });

  tsRender();
}
tsWire();
