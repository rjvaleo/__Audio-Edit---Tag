// Effects from prism-fx, the crate shared with idMLab, in the rack.
//
// The engine side is tested in Rust (`core/crates/fx/tests/prism.rs`, and the
// rack and route tests in `server`). What is left to check here is the one new
// piece of interface — a prism effect's panel: its controls laid out in the
// groups the original used, a choice that reads as its name, and the Prism pad
// moving its two controls at once — and that what is moved on screen is what
// the server stores.

import { test, expect } from './test.mjs';

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
///
/// The picker shows the modules first (SUITE-PLAN §3.1): the module the kind's
/// mode is filed under is opened, then its face is picked. A kind the picker
/// no longer offers (an unlisted mode, §1.4–1.5) is added as an old document
/// holds it.
async function addFromPicker(page, kind) {
  const suite = await page.evaluate((k) => fxPickerCatalogue().find((g) => g.items.some((i) => i.kind === k))?.suite, kind);
  if (suite) {
    await page.locator('#fxAdd').click();
    await page.locator(`.fx-picker-cat[data-suite="${suite}"]`).click();
    await page.locator(`.fx-picker-item[data-kind="${kind}"]`).click();
  } else {
    await page.evaluate((k) => addFxModule(k), kind);
  }
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

/// Every mode the picker offers, as [kind, module it is filed under], read by
/// opening each module in turn. Leaves the picker shut.
async function pickerEntries(page) {
  await page.locator('#fxAdd').click();
  const entries = [];
  const groups = await page.locator('.fx-picker-cat').evaluateAll((tiles) => tiles.map((t) => t.dataset.group));
  for (const group of groups) {
    await page.locator(`.fx-picker-cat[data-group="${group}"]`).click();
    await expect(page.locator('#fxPickerTitle')).toHaveText(group);
    for (const kind of await page.locator('.fx-picker-item').evaluateAll((b) => b.map((x) => x.dataset.kind))) entries.push([kind, group]);
    await page.locator('#fxPickerBack').click();
  }
  await page.locator('#fxPickerClose').click();
  return entries;
}

const count = (entries, label) => entries.filter(([l]) => l === label).length;
const kindOf = (entries, label) => entries.find(([l]) => l === label)?.[1];

test('the picker shows the kinds first, each with its faces, and a kind opened shows its effects\' faces', async ({ page }) => {
  await openRack(page);
  await page.locator('#fxAdd').click();
  const tiles = page.locator('.fx-picker-cat');
  expect(await tiles.count()).toBeGreaterThan(4);
  await expect(page.locator('.fx-picker-item')).toHaveCount(0);
  await expect(tiles.first().locator('.fx-picker-thumb .fx-face')).not.toHaveCount(0);
  await page.locator('.fx-picker-cat[data-group="Reverb"]').click();
  await expect(page.locator('.fx-picker-cat')).toHaveCount(0);
  const items = page.locator('.fx-picker-item');
  expect(await items.count()).toBeGreaterThan(4);
  // Each is the rack's own face, inert: it is seen, not played.
  for (const item of await items.all()) await expect(item.locator('.fx-picker-thumb .fx-module')).toHaveCount(1);
  expect(await page.locator('.fx-picker-thumb .fx-module').evaluateAll((m) => m.every((e) => e.inert))).toBe(true);
  await page.locator('#fxPickerBack').click();
  await expect(page.locator('.fx-picker-cat')).toHaveCount(await tiles.count());
  await page.locator('#fxPickerClose').click();
  // Shut, it holds nothing.
  await expect(page.locator('#fxPicker .fx-module')).toHaveCount(0);
});

test('the picker offers every listed mode once, under its module, and never an unlisted one', async ({ page }) => {
  await openRack(page);
  const entries = await pickerEntries(page);
  const suites = await page.evaluate(() => state.suites);
  // the modules with something to offer, in the plan's order (Cassette from P6)
  expect([...new Set(entries.map(([, g]) => g))]).toEqual(suites.filter((s) => s.offered).map((s) => s.label));
  for (const s of suites) {
    for (const m of s.families.flatMap((f) => f.modes)) {
      expect(count(entries, m.kind), `${s.id}/${m.id}`).toBe(m.listed ? 1 : 0);
      if (m.listed) expect(kindOf(entries, m.kind)).toBe(s.label);
    }
  }
  for (const gone of ['prism:decimator', 'prism:multi-delay', 'prism:stereo-matrix', 'prism:hp-single-delay', 'invert', 'swap', 'width']) {
    expect(count(entries, gone), gone).toBe(0);
  }
  const kinds = await page.evaluate(() => Object.keys(state.shapers));
  expect(kinds).toContain('prism:echo');
  expect(kinds).not.toContain('dattorro_echo');
  expect(kindOf(entries, 'prism:echo')).toBe('Delay');
});

test('a mode in the picker carries its class badge, the original in its tooltip, and a search finds it', async ({ page }) => {
  await openRack(page);
  await page.locator('#fxAdd').click();
  await page.locator('.fx-picker-cat[data-suite="reverb"]').click();
  const hall = page.locator('.fx-picker-item[data-kind="prism:hp-hall"]');
  await expect(hall.locator('.fx-picker-name')).toHaveText('Large Hall');
  await expect(hall.locator('.fx-class-badge')).toHaveText('Port');
  await expect(hall.locator('.fx-class-badge')).toHaveAttribute('title', /Hyperprism/);
  await expect(page.locator('.fx-picker-item[data-kind="prism:lxp-hall"] .fx-class-badge')).toHaveText('Ours');
  await expect(page.locator('.fx-picker-family')).toContainText(['Classic', 'Hall & Room', 'Studio']);
  await page.locator('#fxPickerBack').click();
  await page.locator('#fxPickerSearch').fill('lexicon');
  await expect(page.locator('.fx-picker-item')).toHaveCount(4);
  await page.locator('#fxPickerSearch').fill('');
  await expect(page.locator('.fx-picker-cat')).not.toHaveCount(0);
});

test('a prism effect lays its controls out in the original\'s groups', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'prism:tremolo');
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
  const module = await addFromPicker(page, 'prism:decimator');
  const bits = module.locator('.param', { hasText: 'Bit depth' });
  await slide(bits, 6);
  await expect(bits.locator('.v')).toHaveText('6');
  expect((await storedSlot(page, 'prism:decimator')).params.bits).toBe(6);
});

test('the Prism pad moves its two controls together', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'prism:tremolo');
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
  // Echo is one of the program's own, so it opens on its face (`fx-faces.spec`).
  await expect(module.locator('.fx-sect > b')).toHaveText(['Time', 'Repeats', 'Levels']);
  await expect(module.locator('.fxk', { has: page.locator('.ui-kname', { hasText: /^Delay$/ }) }).locator('.ui-kval')).toHaveText('125 ms');
});

test('Multi Delay and Stereo Matrix arrive in the rack with their groups', async ({ page }) => {
  await openRack(page);
  const delay = await addFromPicker(page, 'prism:multi-delay');
  await expect(delay.locator('.prism-group-label')).toHaveText(['Taps', 'Repeats', 'Levels']);
  await expect(delay.locator('.param .k')).toContainText(['Delay 1', 'Delay 2', 'Spread', 'Feedback', 'Dry / Wet']);
  await expect(delay.locator('.prism-pad')).toHaveAttribute('aria-label', /Delay 1.*Delay 2/);
  const matrix = await addFromPicker(page, 'prism:stereo-matrix');
  await expect(matrix.locator('.prism-group-label')).toHaveText(['Width', 'Position', 'Balance']);
  const side = matrix.locator('.param', { hasText: /^Side/ });
  await slide(side, 2);
  // The slider steps in 400ths of its range, so 2 lands within a step of 2.
  expect((await storedSlot(page, 'prism:stereo-matrix')).params.sideGain).toBeCloseTo(2, 1);
});

test('Spectral Dynamics lays out SoundHack\'s dialog and dims the gate\'s reduction out of Gate-Duck', async ({ page }) => {
  await openRack(page);
  const module = await addFromPicker(page, 'prism:spectral-dynamics');
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
  const module = await addFromPicker(page, 'prism:convolution');
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
  const module = await addFromPicker(page, 'prism:spectral-dynamics');
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
  const entries = await pickerEntries(page);
  for (const id of ['decimate', 'matrix', 'phasor', 'delay', 'pitchdelay', 'flipper', 'bubbler', 'chebyshev', 'compand']) {
    expect(count(entries, `prism:sh-${id}`), id).toBe(1);
  }
  expect(kindOf(entries, 'prism:sh-delay')).toBe('Delay');
  expect(kindOf(entries, 'prism:sh-pitchdelay')).toBe('Pitch');
  // A granular delay that pitches its grains sits with the pitch effects.
  expect(kindOf(entries, 'prism:sh-bubbler')).toBe('Pitch');
  expect(kindOf(entries, 'prism:sh-compand')).toBe('Dynamics');

  const delay = await addFromPicker(page, 'prism:sh-delay');
  await expect(delay.locator('.prism-group-label')).toHaveText(['Delay', 'LFO', 'Filter', 'Level']);
  await expect(delay.locator('.param .k')).toContainText(['Feedback −', 'Freeze', 'Two heads']);

  // The response is the RMS window: dimmed while the detector reads peaks.
  const compand = await addFromPicker(page, 'prism:sh-compand');
  // A dial reads its value over its name, so it is found by the name.
  const response = compand.locator('.param', { has: page.locator('.k', { hasText: /^Response$/ }) });
  await expect(response).toHaveClass(/\binactive\b/);
  // SoundHack's switches are keys on its grid (`076-fx-suites.js`).
  await compand.locator('.sh-key[aria-label="RMS detect"]').click();
  await expect(response).not.toHaveClass(/\binactive\b/);
  expect((await storedSlot(page, 'prism:sh-compand')).params.rms).toBe(1);

  const bubbler = await addFromPicker(page, 'prism:sh-bubbler');
  await expect(bubbler.locator('.prism-group-label')).toHaveText(['Delay', 'Grains', 'Keys', 'Level']);
  await bubbler.locator('.sh-key[aria-label="5th"]').click();
  expect((await storedSlot(page, 'prism:sh-bubbler')).params.key7).toBe(1);
});

test('Lexicon\'s four LXP reverbs arrive with their edit pages, filed with the reverbs', async ({ page }) => {
  await openRack(page);
  const entries = await pickerEntries(page);
  for (const id of ['chamber', 'hall', 'plate', 'room']) {
    expect(count(entries, `prism:lxp-${id}`), id).toBe(1);
    expect(kindOf(entries, `prism:lxp-${id}`)).toBe('Reverb');
  }

  // The Hall and the Room have four reflections that cross sides, and no echoes.
  const hall = await addFromPicker(page, 'prism:lxp-hall');
  // The LXP's own pages, after its Soft Row (`076-fx-suites.js`).
  await expect(hall.locator('.prism-group-label')).toHaveText(['Soft Row', 'Reverb', 'Modulation', 'Reflections', 'Levels, Mix and EQ']);
  await expect(hall.locator('.param .k')).toContainText(['Reverb Time', 'Tap Slope', 'L-R Rfl Dly', 'R-L Rfl Gain', 'Early Level']);
  await expect(hall.locator('.prism-pad')).toHaveAttribute('aria-label', /Size.*Reverb Time/);
  // Size is a knob on the Reverb page: ten steps down reach the stored rack.
  await hall.locator('.lex-tab', { hasText: /^Reverb$/ }).click();
  const size = hall.locator('.lex-page:not([hidden]) .lex-knob', { has: page.locator('.k', { hasText: /^Size$/ }) });
  const before = await page.evaluate(() => state.rack.slots.at(-1).params.sizeM);
  await size.locator('.lex-ring').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
  const stored = (await storedSlot(page, 'prism:lxp-hall')).params.sizeM;
  expect(stored).toBeLessThan(before);
  expect(stored).toBeCloseTo(await page.evaluate(() => state.rack.slots.at(-1).params.sizeM), 2);

  // The Chamber and the Plate have two reflections, and echoes with a polarity.
  const chamber = await addFromPicker(page, 'prism:lxp-chamber');
  await expect(chamber.locator('.prism-group-label')).toHaveText(['Soft Row', 'Reverb', 'Modulation', 'Reflections', 'Echoes', 'Levels, Mix and EQ']);
  await chamber.locator('.lex-tab', { hasText: /^Echoes$/ }).click();
  const polarity = chamber.locator('.param', { hasText: /^L Eko FBack Polarity/ });
  await expect(polarity.locator('.seg-btn')).toHaveText(['Normal', 'Inverted']);
  // "Medium Honey Vocal 2" inverts the left echo's feedback.
  await expect(polarity.locator('.seg-btn.active')).toHaveText('Inverted');
  await polarity.locator('.seg-btn', { hasText: 'Normal' }).click();
  expect((await storedSlot(page, 'prism:lxp-chamber')).params.lEkoPolarity).toBe(0);
});

test('Hyperprism\'s processes are in the picker, each built from its code', async ({ page }) => {
  await openRack(page);
  const entries = await pickerEntries(page);
  const hp = await page.evaluate(() => Object.keys(state.shapers).filter((k) => k.startsWith('prism:hp-')));
  expect(hp.length).toBe(30);
  for (const kind of hp) expect(count(entries, kind), kind).toBe(kind === 'prism:hp-single-delay' ? 0 : 1);
  // Its pad is Hyperprism's own window: Frequency across, Q up.
  const filter = await addFromPicker(page, 'prism:hp-low-pass');
  await expect(filter.locator('.prism-pad')).toHaveAttribute('aria-label', /Frequency.*Q/);
  expect((await storedSlot(page, 'prism:hp-low-pass')).params.freqHz).toBe(20000);
});
