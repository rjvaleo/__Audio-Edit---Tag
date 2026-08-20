// The theme studio, ported from Emovis.
//
// A palette is a name and a handful of brand colours; the engine turns those
// into this application's tokens. What the tests are for is the seams — the
// places where a port can be subtly wrong and still look right:
//
//   · selecting a palette must *open* it, not wear it,
//   · editing must repaint the preview and leave the page alone,
//   · a built-in must be previewable and copyable but never editable,
//   · and the whole thing must survive being saved and reloaded, which is the
//     failure that once took the entire interface down.
//
// See `docs/THEME-EDITOR.md`.

import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined', { timeout: 20_000 });
  await page.evaluate(() => {
    const rail = [...document.querySelectorAll('.rail *')]
      .find((e) => e.textContent.trim() === 'Theme');
    rail?.click();
  });
  await page.waitForTimeout(300);
  // Whatever a previous test left behind — these share one browser.
  await page.evaluate(() => {
    themeState.mine = [];
    themeState.chosen = null;
    tsSelected = null;
    saveTheme();
    Theme.apply(null);
    // `Theme.apply` only clears the tokens in its own map, and `--wave` is
    // deliberately not one of them — so without this a waveform left on the
    // root by an earlier test is still there, and the next one measures it.
    setWaveColour(null);
    renderThemeList();
    tsRender();
  });
}

/// The load-order trap, asserted directly.
///
/// `renderThemeList` runs during load and reads the studio's state. When that
/// state was declared further down the file it sat in the temporal dead zone,
/// where even `typeof` throws — so the page threw during load and everything
/// after it, the meters and the visualiser included, never came into being.
test('the page loads without throwing, with everything defined', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto('/');
  await page.waitForTimeout(1500);
  expect(errors, `the page threw during load: ${errors[0] || ''}`).toEqual([]);
  const defined = await page.evaluate(() => ({
    studio: typeof tsRender, palette: typeof tsPalette,
    masterBus: typeof masterBus, room: typeof visGlRaf,
  }));
  expect(defined.studio).toBe('function');
  expect(defined.palette).toBe('function');
  // The proof that nothing aborted partway: things declared *after* the studio.
  expect(defined.masterBus).toBe('object');
  expect(defined.room).toBe('number');
});

test('a new palette opens in the editor with its colours', async ({ page }) => {
  await studio(page);
  const out = await page.evaluate(() => {
    document.getElementById('tsNew').click();
    return {
      selected: tsSelected,
      name: tsPalette()?.name,
      colours: tsPalette()?.colors.length,
      swatches: document.querySelectorAll('#tsSwatches .ts-swatch').length,
      wells: document.querySelectorAll('#tsSwatches input[type=color]').length,
      hexes: document.querySelectorAll('#tsSwatches input[type=text]').length,
      editorShown: !document.getElementById('tsEditor').classList.contains('hidden'),
    };
  });
  expect(out.editorShown).toBe(true);
  expect(out.colours).toBeGreaterThanOrEqual(2);
  // A well *and* a hex for each: the well is how a colour is chosen, the hex is
  // how one arrives from a style guide. Dropping either was the old editor's
  // mistake, in both directions.
  expect(out.swatches).toBe(out.colours);
  expect(out.wells).toBe(out.colours);
  expect(out.hexes).toBe(out.colours);
});

test('editing a colour re-derives the preview and leaves the page alone', async ({ page }) => {
  await studio(page);
  const out = await page.evaluate(() => {
    document.getElementById('tsNew').click();
    const pageBefore = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg').trim();
    const miniBefore = getComputedStyle(document.getElementById('themeMini'))
      .getPropertyValue('--bg').trim();

    const hex = document.querySelector('#tsSwatches input[type=text]');
    hex.value = '#7d3fbf';
    hex.dispatchEvent(new Event('input'));

    return {
      stored: tsPalette().colors[0],
      miniBefore,
      miniAfter: getComputedStyle(document.getElementById('themeMini'))
        .getPropertyValue('--bg').trim(),
      pageBefore,
      pageAfter: getComputedStyle(document.documentElement)
        .getPropertyValue('--bg').trim(),
    };
  });
  expect(out.stored).toBe('#7d3fbf');
  expect(out.miniAfter, 'the preview did not follow the edit').not.toBe(out.miniBefore);
  expect(out.pageAfter, 'editing a palette repainted the application').toBe(out.pageBefore);
});

/// A hex that cannot be read must not wipe the colour.
///
/// Note what is *not* asserted: that `#7d3` leaves it alone. Three-digit hex is
/// valid and expands to `#77dd33`, which means typing a six-digit code passes
/// through a real colour on the way. That is the port behaving as the original
/// does, not a fault — a palette pasted as `#abc` has to work.
test('an unreadable hex leaves the palette alone', async ({ page }) => {
  await studio(page);
  const out = await page.evaluate(() => {
    document.getElementById('tsNew').click();
    const first = tsPalette().colors[0];
    const hex = document.querySelector('#tsSwatches input[type=text]');
    const seen = [];
    for (const partial of ['', '#', '#7', '#7d', '#zzz', 'not a colour']) {
      hex.value = partial;
      hex.dispatchEvent(new Event('input'));
      seen.push(tsPalette().colors[0]);
    }
    // Three digits is a colour, and is taken as one.
    hex.value = '#7d3';
    hex.dispatchEvent(new Event('input'));
    const short = tsPalette().colors[0];
    hex.value = '#7d3fbf';
    hex.dispatchEvent(new Event('input'));
    return { first, seen, short, final: tsPalette().colors[0] };
  });
  for (const v of out.seen) {
    expect(v, 'an unreadable hex overwrote the colour').toBe(out.first);
  }
  expect(out.short, 'three-digit hex was not expanded').toBe('#77dd33');
  expect(out.final).toBe('#7d3fbf');
});

/// Clicking a palette shows it — on the real application, not a swatch.
///
/// The studio this was ported from is an admin screen with the application
/// somewhere else, so there a click opened a palette without wearing it. Here
/// the panel is inside the thing being themed, and looking at the app in a
/// theme is the entire reason to click one. It opens in the editor as well.
test('clicking a palette wears it and opens it', async ({ page }) => {
  await studio(page);
  const out = await page.evaluate(() => {
    document.getElementById('tsNew').click();
    const hex = document.querySelector('#tsSwatches input[type=text]');
    hex.value = '#7d3fbf';
    hex.dispatchEvent(new Event('input'));
    const id = tsSelected;

    themeState.chosen = null;
    saveTheme(); applyChosenTheme(); renderThemeList();
    const before = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg').trim();

    [...document.querySelectorAll('.theme-row')]
      .find((r) => r.textContent.includes('New palette'))?.click();

    return {
      id,
      before,
      after: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      worn: themeState.chosen,
      opened: tsSelected,
      editorShown: !document.getElementById('tsEditor').classList.contains('hidden'),
    };
  });
  expect(out.after, 'clicking a palette did not show it').not.toBe(out.before);
  expect(out.worn).toBe(out.id);
  expect(out.opened).toBe(out.id);
  expect(out.editorShown).toBe(true);
});

test('a built-in palette can be viewed and copied but not edited', async ({ page }) => {
  await studio(page);
  const out = await page.evaluate(() => {
    const shipped = allPalettes().find((p) => p.readOnly);
    if (!shipped) return { skipped: true };
    tsSelected = shipped.id;
    tsRender();
    // Everything about the built-in is read *before* duplicating — the copy
    // becomes the selection, so reading afterwards describes the copy instead.
    const viewing = {
      title: document.getElementById('tsEditing').textContent,
      allDisabled: [...document.querySelectorAll('#tsSwatches input')]
        .every((el) => el.disabled),
      nameDisabled: document.getElementById('tsName').disabled,
      deleteHidden: document.getElementById('tsDelete').classList.contains('hidden'),
    };
    const before = themeState.mine.length;
    document.getElementById('tsDuplicate').click();
    return {
      skipped: false,
      ...viewing,
      copyMade: themeState.mine.length === before + 1,
      copyEditable: !tsPalette()?.readOnly,
      copyTitle: document.getElementById('tsEditing').textContent,
    };
  });
  if (out.skipped) test.skip(true, 'no built-in palettes are shipped');
  expect(out.title).toContain('Viewing');
  expect(out.allDisabled, 'a built-in palette was editable').toBe(true);
  expect(out.nameDisabled).toBe(true);
  expect(out.deleteHidden, 'a built-in palette offered a Delete button').toBe(true);
  // Previewable and duplicable, never edited or deleted — so a shipped palette
  // can never be pulled out from under something built on it.
  expect(out.copyMade).toBe(true);
  expect(out.copyEditable).toBe(true);
  expect(out.copyTitle).toContain('Editing');
});

test('palettes come in as JSON, and bad ones are reported not swallowed', async ({ page }) => {
  await studio(page);
  const good = await page.evaluate(() => {
    tsImportJson(JSON.stringify([
      { name: 'Imported one', colors: ['#101820', '#2e5496', '#e8e4dc'] },
      { name: 'Too few', colors: ['#ffffff'] },
    ]));
    return {
      names: themeState.mine.map((p) => p.name),
      error: document.getElementById('tsError').textContent,
      selectedName: tsPalette()?.name,
    };
  });
  // The one with a single colour is dropped; the good one lands and opens.
  expect(good.names).toContain('Imported one');
  expect(good.names).not.toContain('Too few');
  expect(good.selectedName).toBe('Imported one');
  expect(good.error).toBe('');

  const bad = await page.evaluate(() => {
    tsImportJson('{ not json');
    return document.getElementById('tsError').textContent;
  });
  expect(bad, 'a broken import failed silently').not.toBe('');
});

test('the token inspector lists what the palette actually derived', async ({ page }) => {
  await studio(page);
  const out = await page.evaluate(() => {
    document.getElementById('tsNew').click();
    document.getElementById('tsTokensBtn').click();
    const rows = [...document.querySelectorAll('#tsTokens > div')];
    return {
      rows: rows.length,
      derived: Object.keys(tsDerive(tsPalette()).tokens).length,
      firstName: rows[0]?.querySelector('b')?.textContent,
      hasValue: !!rows[0]?.querySelector('span')?.textContent,
      label: document.getElementById('tsTokensBtn').textContent,
    };
  });
  expect(out.rows).toBeGreaterThan(0);
  expect(out.rows).toBe(out.derived);
  expect(out.firstName).toMatch(/^--/);
  expect(out.hasValue).toBe(true);
  expect(out.label).toContain('Hide');
});

/// The failure that took the application down, kept as a test forever.
///
/// The editor once saved a palette without `colors`; `renderThemeList` read
/// `p.colors.join(' ')`, threw during load, and aborted the rest of `app.js`.
/// Nothing on screen said "error" — the panel simply never moved.
test('a saved palette survives a reload with the application intact', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await studio(page);

  await page.evaluate(() => {
    document.getElementById('tsNew').click();
    const hex = document.querySelector('#tsSwatches input[type=text]');
    hex.value = '#7d3fbf';
    hex.dispatchEvent(new Event('input'));
    document.getElementById('tsApply').click();
  });

  await page.reload();
  await page.waitForTimeout(1200);

  expect(errors, `the page threw during load: ${errors[0] || ''}`).toEqual([]);
  const alive = await page.evaluate(() => ({
    kept: themeState.mine.length,
    worn: themeState.chosen,
    masterBus: typeof masterBus !== 'undefined',
    metersRunning: typeof masterBus !== 'undefined' && !!masterBus.timer,
    room: typeof visGlRaf !== 'undefined',
    rowRendered: !!document.querySelector('.theme-row'),
  }));
  expect(alive.kept).toBe(1);
  expect(alive.worn).toBeTruthy();
  expect(alive.masterBus, 'app.js aborted before the master bus was defined').toBe(true);
  expect(alive.metersRunning, 'the meter poll never started').toBe(true);
  expect(alive.room, 'the visualiser loop never started').toBe(true);
  expect(alive.rowRendered).toBe(true);
});

/// The waveform belongs to the palette.
///
/// It used to sit above the studio as one standing choice, on the argument that
/// a theme has no business colouring the sound. That argument was about
/// *derivation* and it still holds — the waveform is not worked out from the
/// surfaces. But a theme can still carry one, and being asked for it means a
/// theme is a whole look rather than the chrome half of one.
test('the waveform is chosen inside the editor and stored on the palette', async ({ page }) => {
  await studio(page);
  const out = await page.evaluate(() => {
    document.getElementById('tsNew').click();
    const before = tsPalette().wave;
    document.querySelector('#waveColours [data-wave="purple"]').click();
    return {
      inEditor: !!document.querySelector('#tsEditor #waveColours'),
      before,
      after: tsPalette().wave,
      mini: getComputedStyle(document.getElementById('themeMini'))
        .getPropertyValue('--wave').trim(),
    };
  });
  expect(out.inEditor, 'the waveform controls are not in the editor').toBe(true);
  expect(out.before).toBeUndefined();
  expect(out.after).toBe('purple');
  expect(out.mini, 'the preview did not take the palette’s waveform').toBeTruthy();
  // Not asserted: that the page is left alone. A new palette is worn as soon as
  // it is made, and changing the waveform of the theme you are *wearing* should
  // change the waveform — that is the point. What matters is that the colour
  // belongs to the palette rather than to a setting beside it, which is what
  // the next test proves by giving two palettes different ones.
});

test('each palette keeps its own waveform, and wearing one brings it', async ({ page }) => {
  await studio(page);
  const out = await page.evaluate(() => {
    document.getElementById('tsNew').click();
    document.querySelector('#waveColours [data-wave="purple"]').click();
    const first = tsSelected;

    document.getElementById('tsNew').click();
    document.querySelector('#waveColours [data-wave="red"]').click();
    const second = tsSelected;

    document.getElementById('tsApply').click();
    const wearingSecond = getComputedStyle(document.documentElement)
      .getPropertyValue('--wave').trim();

    tsSelected = first; tsRender();
    themeState.chosen = first; saveTheme(); applyChosenTheme();
    const wearingFirst = getComputedStyle(document.documentElement)
      .getPropertyValue('--wave').trim();

    return {
      firstWave: themeState.mine.find((p) => p.id === first).wave,
      secondWave: themeState.mine.find((p) => p.id === second).wave,
      wearingFirst, wearingSecond,
    };
  });
  // Two palettes, two waveforms, neither leaking into the other.
  expect(out.firstWave).toBe('purple');
  expect(out.secondWave).toBe('red');
  expect(out.wearingFirst).not.toBe(out.wearingSecond);
});

/// A colour well cannot be rebuilt while it is being used.
///
/// Moving one fires `input` for every step of the drag, and every one of those
/// came back through `tsRenderSwatches`, which did `innerHTML = ''`. So the very
/// `<input type="color">` the system's colour panel was attached to was
/// destroyed under it, over and over: the panel stays open, pointing at an
/// element no longer in the document, and nothing done in it reaches the
/// palette. The hex field lost its caret to the same thing on every keystroke.
///
/// **The value is not what to assert on.** It arrived correctly even while
/// broken — `tsSetColor` had already run by the time the DOM was thrown away —
/// so a test that checked the palette held the right colour passed on the fault.
/// What has to survive is the element.
test('a colour well survives being dragged', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof themeState !== 'undefined', { timeout: 20_000 });

  const out = await page.evaluate(async () => {
    // Somewhere editable to work in.
    document.getElementById('tsNew').click();
    await new Promise((r) => setTimeout(r, 100));
    const wells = () => [...document.querySelectorAll(
      '#tsSwatches .ts-swatch input[type=color]')];
    const first = wells()[0];
    if (!first) return { err: 'the editor has no colour wells' };

    // What a drag in the system colour panel actually does: a run of `input`
    // events on one element that has to still be there at the end of it.
    const held = first;
    const seen = [];
    for (const c of ['#112233', '#224466', '#3388aa', '#44ccdd']) {
      held.value = c;
      held.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
      seen.push({
        alive: document.contains(held),
        same: wells()[0] === held,
        palette: (tsPalette()?.colors || [])[0],
      });
    }
    return { seen };
  });
  expect(out.err, out.err).toBeUndefined();

  for (const [i, step] of out.seen.entries()) {
    expect(step.alive, `the well was removed from the document on drag step ${i + 1}`)
      .toBe(true);
    expect(step.same, `the well was replaced by a new element on drag step ${i + 1} — `
      + 'the colour panel is now pointing at nothing').toBe(true);
  }
  // And the colour still gets through, which was never the broken part.
  expect(out.seen[out.seen.length - 1].palette).toBe('#44ccdd');
});

/// Adding or removing a colour does still rebuild, because the shape changed.
test('the swatch row rebuilds when the number of colours changes', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof themeState !== 'undefined', { timeout: 20_000 });
  const out = await page.evaluate(async () => {
    document.getElementById('tsNew').click();
    await new Promise((r) => setTimeout(r, 100));
    const count = () => document.querySelectorAll('#tsSwatches .ts-swatch').length;
    const before = count();
    document.querySelector('#tsSwatches .ts-add').click();
    await new Promise((r) => setTimeout(r, 60));
    return { before, after: count() };
  });
  expect(out.after, 'adding a colour did not add a swatch').toBe(out.before + 1);
});

