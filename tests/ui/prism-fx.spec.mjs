// Effects from prism-fx, the crate shared with idMLab, in the rack.
//
// The engine side is tested in Rust (`core/crates/fx/tests/prism.rs`, and the
// rack and route tests in `server`). What is left to check here is the one new
// piece of interface — a prism effect's panel: its controls laid out in the
// groups the original used, a choice that reads as its name, and the Prism pad
// moving its two controls at once — and that what is moved on screen is what
// the server stores.

import { test, expect } from '@playwright/test';

async function openRack(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  // One server serves every test here, so each starts from an empty rack
  // rather than from whatever the last one left in it.
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await postJSON('/api/rack', { p: files[0].path, sr: 44100, slots: [] });
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.locator('.dock-tab[data-dock="effects"]').click();
  await page.waitForFunction(() => state.rack && Object.keys(state.shapers || {}).length > 0);
}

/// The slot most recently added, as the server has it now, after any pending
/// writes have landed. Checked to be the kind expected.
async function storedSlot(page, kind) {
  await page.waitForTimeout(250);
  const slot = await page.evaluate(async () => {
    const id = state.rack.slots.at(-1)?.id;
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return (r.slots || []).find((s) => s.id === id) || null;
  });
  expect(slot?.kind).toBe(kind);
  return slot;
}

/// Add a module, and wait until the server has it: a control moved before then
/// is addressed to a slot the server does not know yet.
async function addFromPicker(page, label) {
  await page.locator('#fxAdd').click();
  await page.locator('#fxPickerGroups .fx-picker-item', { hasText: new RegExp(`^${label}$`) }).click();
  await page.waitForFunction(async () => {
    const id = state.rack.slots.at(-1)?.id;
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return (r.slots || []).some((s) => s.id === id);
  });
  return page.locator('.fx-module').last();
}

/// Move a range input the way a hand does: input while dragging, change on release.
async function slide(row, value) {
  await row.locator('input[type=range]').evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('the picker offers the prism effects, and Echo only once', async ({ page }) => {
  await openRack(page);
  await page.locator('#fxAdd').click();
  const items = page.locator('#fxPickerGroups .fx-picker-item');
  for (const label of ['Tremolo', 'Decimator', 'Echo', 'Multi Delay', 'Stereo Matrix', 'Spectral Dynamics', 'Convolution']) {
    await expect(items.filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
  }
  const kinds = await page.evaluate(() => Object.keys(state.shapers));
  expect(kinds).toContain('prism:echo');
  expect(kinds).not.toContain('dattorro_echo');
  // Filed where the old Echo was.
  const group = page.locator('.fx-picker-group', { has: page.locator('.fx-picker-item', { hasText: /^Echo$/ }) });
  await expect(group.locator('h3')).toHaveText('Reverb & Delay');
});

test('a prism effect lays its controls out in the original\'s groups', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'Tremolo');
  await expect(module.locator('h2')).toHaveText('Tremolo');
  const groups = module.locator('.prism-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator('.prism-group-label')).toHaveText('LFO');
  await expect(groups.nth(1).locator('.prism-group-label')).toHaveText('Amount');
  await expect(groups.nth(0).locator('.param .k')).toHaveText(['Rate', 'Shape']);
  await expect(groups.nth(1).locator('.param .k')).toHaveText(['Depth', 'Stereo phase']);
  // A choice of three is its three names, the chosen one lit.
  const shape = groups.nth(0).locator('.param', { hasText: 'Shape' });
  await expect(shape.locator('.seg-btn')).toHaveText(['Sine', 'Triangle', 'Square']);
  await expect(shape.locator('.seg-btn.active')).toHaveText('Sine');
  await shape.locator('.seg-btn', { hasText: 'Square' }).click();
  await expect(shape.locator('.seg-btn.active')).toHaveText('Square');
  expect((await storedSlot(page, 'prism:tremolo')).params.shape).toBe(2);
});

test('moving a prism control reaches the stored rack', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'Decimator');
  const bits = module.locator('.param', { hasText: 'Bit depth' });
  await slide(bits, 6);
  await expect(bits.locator('.v')).toHaveText('6');
  expect((await storedSlot(page, 'prism:decimator')).params.bits).toBe(6);
});

test('the Prism pad moves its two controls together', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'Tremolo');
  const pad = module.locator('.prism-pad');
  await expect(pad).toBeVisible();
  await expect(pad).toHaveAttribute('aria-label', /Rate.*Depth/);
  const box = await pad.boundingBox();
  // Top right: the fastest rate the pad reaches, and the deepest.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + 1, { steps: 6 });
  await page.mouse.up();
  const slot = await storedSlot(page, 'prism:tremolo');
  expect(slot.params.rateHz).toBeGreaterThan(18);
  expect(slot.params.depth).toBeGreaterThan(0.97);
  // The sliders follow the pad.
  await expect(module.locator('.param', { hasText: 'Depth' }).locator('.v')).toHaveText(/^(99|100)%$/);
});

test('a document made with the old Echo opens on the prism one', async ({ page }) => {
  await openRack(page);
  await page.evaluate(async () => {
    const f = state.selectedFile;
    await postJSON('/api/rack', { p: f.path, sr: 44100, slots: [
      { id: 'old-echo', kind: 'dattorro_echo', bypassed: false,
        params: { delayMs: 125, feedback: 0.4, damping: 0.3, wet: 0.6, dry: 1, glideMs: 50 } },
    ] });
    await selectFile(f);
  });
  await page.waitForFunction(() => state.rack?.slots?.[0]?.kind === 'prism:echo');
  const module = page.locator('.fx-module').first();
  await expect(module.locator('h2')).toHaveText('Echo');
  await expect(module.locator('.prism-group-label')).toHaveText(['Time', 'Repeats', 'Levels']);
  await expect(module.locator('.param', { hasText: /^Delay/ }).locator('.v')).toHaveText('125 ms');
});

test('Multi Delay and Stereo Matrix arrive in the rack with their groups', async ({ page }) => {
  await openRack(page);
  const delay = await addFromPicker(page, 'Multi Delay');
  await expect(delay.locator('.prism-group-label')).toHaveText(['Taps', 'Repeats', 'Levels']);
  await expect(delay.locator('.param .k')).toContainText(['Delay 1', 'Delay 2', 'Spread', 'Feedback', 'Dry / Wet']);
  await expect(delay.locator('.prism-pad')).toHaveAttribute('aria-label', /Delay 1.*Delay 2/);
  const matrix = await addFromPicker(page, 'Stereo Matrix');
  await expect(matrix.locator('.prism-group-label')).toHaveText(['Width', 'Position', 'Balance']);
  const side = matrix.locator('.param', { hasText: /^Side/ });
  await slide(side, 2);
  // The slider steps in 400ths of its range, so 2 lands within a step of 2.
  expect((await storedSlot(page, 'prism:stereo-matrix')).params.sideGain).toBeCloseTo(2, 1);
});

test('Spectral Dynamics lays out SoundHack\'s dialog and dims the gate\'s reduction out of Gate-Duck', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'Spectral Dynamics');
  await expect(module.locator('.prism-group-label')).toHaveText(['Process', 'Bands', 'Amount', 'Threshold']);
  const reduction = module.locator('.param', { hasText: 'Gain/Reduction' });
  await expect(reduction).toHaveClass(/\binactive\b/);
  await module.locator('.param', { hasText: /^Type/ }).locator('.seg-btn', { hasText: 'Gate-Duck' }).click();
  // Switches keep their whole names.
  await expect(module.locator('.param .k')).toContainText(['3rd octave grouping', 'Smoothed amplitude', 'Relative to peak']);
  await expect(reduction).not.toHaveClass(/\binactive\b/);
  expect((await storedSlot(page, 'prism:spectral-dynamics')).params.mode).toBe(0);
});

test('Convolution takes its impulse from the library', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'Convolution');
  const row = module.locator('.prism-sound');
  await expect(row.locator('.k')).toHaveText('Impulse');
  await expect(row.locator('.prism-sound-name')).toHaveText('none');
  await row.locator('.prism-sound-pick').click();
  const chooser = page.locator('.fx-module').last().locator('.prism-sound-chooser');
  await expect(chooser.locator('.prism-sound-file option')).not.toHaveCount(0);
  await chooser.locator('.prism-sound-file').selectOption({ label: 'short.wav' });
  await chooser.locator('.prism-sound-use').click();
  await expect(page.locator('.fx-module').last().locator('.prism-sound-name')).toHaveText('short.wav');
  const slot = await storedSlot(page, 'prism:convolution');
  expect(slot.sound).toMatch(/short\.wav$/);
});

test('Spectral Dynamics takes a threshold sound from the library, as SoundHack\'s threshold file', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'Spectral Dynamics');
  const row = module.locator('.prism-sound');
  await expect(row.locator('.k')).toHaveText('Threshold sound');
  await expect(module.locator('.param .k', { hasText: 'Use threshold sound' })).toHaveCount(1);
  await row.locator('.prism-sound-pick').click();
  const chooser = page.locator('.fx-module').last().locator('.prism-sound-chooser');
  await chooser.locator('.prism-sound-file').selectOption({ label: 'short.wav' });
  await chooser.locator('.prism-sound-use').click();
  const slot = await storedSlot(page, 'prism:spectral-dynamics');
  expect(slot.sound).toMatch(/short\.wav$/);
});

test('SoundHack\'s nine plug-ins arrive with the originals\' panels, filed by what they do', async ({ page }) => {
  await openRack(page);
  await page.locator('#fxAdd').click();
  const items = page.locator('#fxPickerGroups .fx-picker-item');
  for (const label of ['++decimate', '++matrix', '++phasor', '++delay', '++pitchdelay', '++flipper',
    '++bubbler', '++chebyshev', '++compand']) {
    await expect(items.filter({ hasText: new RegExp(`^\\+\\+${label.slice(2)}$`) })).toHaveCount(1);
  }
  const groupOf = (label) => page.locator('.fx-picker-group', {
    has: page.locator('.fx-picker-item', { hasText: new RegExp(`^\\+\\+${label}$`) }),
  }).locator('h3');
  await expect(groupOf('delay')).toHaveText('Reverb & Delay');
  await expect(groupOf('pitchdelay')).toHaveText('Pitch & Motion');
  // A granular delay that pitches its grains sits with the pitch effects.
  await expect(groupOf('bubbler')).toHaveText('Pitch & Motion');
  await expect(groupOf('compand')).toHaveText('EQ & Compression');
  await page.locator('#fxPickerClose').click();

  const delay = await addFromPicker(page, '\\+\\+delay');
  await expect(delay.locator('.prism-group-label')).toHaveText(['Delay', 'LFO', 'Filter', 'Level']);
  await expect(delay.locator('.param .k')).toContainText(['Feedback −', 'Freeze', 'Two heads']);

  // The response is the RMS window: dimmed while the detector reads peaks.
  const compand = await addFromPicker(page, '\\+\\+compand');
  const response = compand.locator('.param', { hasText: /^Response/ });
  await expect(response).toHaveClass(/\binactive\b/);
  await compand.locator('.param', { hasText: /^RMS detect/ }).locator('.seg-btn', { hasText: 'On' }).click();
  await expect(response).not.toHaveClass(/\binactive\b/);
  expect((await storedSlot(page, 'prism:sh-compand')).params.rms).toBe(1);

  const bubbler = await addFromPicker(page, '\\+\\+bubbler');
  await expect(bubbler.locator('.prism-group-label')).toHaveText(['Delay', 'Grains', 'Keys', 'Level']);
  await bubbler.locator('.param', { hasText: /^5th/ }).locator('.seg-btn', { hasText: 'On' }).click();
  expect((await storedSlot(page, 'prism:sh-bubbler')).params.key7).toBe(1);
});

test('Lexicon\'s four LXP reverbs arrive with their edit pages, filed with the reverbs', async ({ page }) => {
  await openRack(page);
  await page.locator('#fxAdd').click();
  const items = page.locator('#fxPickerGroups .fx-picker-item');
  for (const label of ['LXP Chamber', 'LXP Hall', 'LXP Plate', 'LXP Room']) {
    await expect(items.filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
    const group = page.locator('.fx-picker-group', {
      has: page.locator('.fx-picker-item', { hasText: new RegExp(`^${label}$`) }),
    });
    await expect(group.locator('h3')).toHaveText('Reverb & Delay');
  }
  await page.locator('#fxPickerClose').click();

  // The Hall and the Room have four reflections that cross sides, and no echoes.
  const hall = await addFromPicker(page, 'LXP Hall');
  await expect(hall.locator('.prism-group-label')).toHaveText(['Reverb', 'Modulation', 'Reflections', 'Levels, Mix and EQ']);
  await expect(hall.locator('.param .k')).toContainText(['Reverb Time', 'Tap Slope', 'L-R Rfl Dly', 'R-L Rfl Gain', 'Early Level']);
  await expect(hall.locator('.prism-pad')).toHaveAttribute('aria-label', /Size.*Reverb Time/);
  const size = hall.locator('.param', { hasText: /^Size/ });
  await slide(size, 40);
  expect((await storedSlot(page, 'prism:lxp-hall')).params.sizeM).toBeCloseTo(40, 0);

  // The Chamber and the Plate have two reflections, and echoes with a polarity.
  const chamber = await addFromPicker(page, 'LXP Chamber');
  await expect(chamber.locator('.prism-group-label')).toHaveText(['Reverb', 'Modulation', 'Reflections', 'Echoes', 'Levels, Mix and EQ']);
  const polarity = chamber.locator('.param', { hasText: /^L Eko FBack Polarity/ });
  await expect(polarity.locator('.seg-btn')).toHaveText(['Normal', 'Inverted']);
  // "Medium Honey Vocal 2" inverts the left echo's feedback.
  await expect(polarity.locator('.seg-btn.active')).toHaveText('Inverted');
  await polarity.locator('.seg-btn', { hasText: 'Normal' }).click();
  expect((await storedSlot(page, 'prism:lxp-chamber')).params.lEkoPolarity).toBe(0);
});
