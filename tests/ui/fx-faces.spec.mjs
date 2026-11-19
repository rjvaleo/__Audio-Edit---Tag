// The built-in effects' faces. See `ui/app/075-fx-faces.js`.
//
// Every effect that is the program's own draws a face instead of rows of
// sliders: a display, its controls in sections, every control with a picture
// of its value. What is checked here is that each one draws, that what is
// moved on a face reaches the stored rack, that the dynamics' arrows and the
// EQ's nodes move what they say, that a knob's own range is saved with the
// rack, and that the Hyperprism, SoundHack and Lexicon panels keep their rows
// and gain the pictures.

import { test, expect } from './test.mjs';

async function openRack(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
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

/// Add a module by kind and wait until the server has it.
async function add(page, kind) {
  await page.evaluate((k) => addFxModule(k), kind);
  await page.waitForFunction(async () => {
    const id = state.rack.slots.at(-1)?.id;
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return (r.slots || []).some((s) => s.id === id);
  });
  return page.locator('.fx-module').last();
}

/// The slot most recently added, as the server stores it.
async function stored(page) {
  await page.waitForTimeout(300);
  return page.evaluate(async () => {
    const id = state.rack.slots.at(-1)?.id;
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return { slot: (r.slots || []).find((s) => s.id === id), ranges: (r.ranges || {})[id] };
  });
}

/// Turn a knob by dragging its ring up.
async function turn(knob, pixels) {
  const ring = knob.locator('.ui-ring');
  const b = await ring.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await ring.page().mouse.move(x, y);
  await ring.page().mouse.down();
  await ring.page().mouse.move(x, y - pixels, { steps: 6 });
  await ring.page().mouse.up();
}

test('every built-in effect draws a face, one width, every control with a picture', async ({ page }) => {
  await openRack(page);
  const kinds = await page.evaluate(() => ['eq', 'comp', 'gain', ...Object.keys(state.shapers).filter((k) => fxIsBuiltin(k))]);
  expect(kinds.length).toBeGreaterThan(30);
  const bad = [];
  for (const kind of kinds) {
    const result = await page.evaluate((k) => {
      state.rack.slots = [];
      addFxModule(k);
      const m = document.querySelector('.fx-module');
      if (!m?.classList.contains('fx-face')) return 'no face';
      if (Math.round(m.getBoundingClientRect().width) !== FX_FACE_W) return `width ${m.getBoundingClientRect().width}`;
      if (m.querySelector('.fx-module-controls .param')) return 'slider rows left';
      const knobs = [...m.querySelectorAll('.fxk')];
      if (knobs.some((k) => !k.querySelector('.ui-kn svg.ui-pic'))) return 'a knob without its picture';
      if ([...m.querySelectorAll('.fxt-b')].some((t) => !t.querySelector('svg.pic'))) return 'a switch without its picture';
      if ([...m.querySelectorAll('.fxs')].some((s) => !s.querySelector('.fxs-pic svg'))) return 'a slider without its picture';
      return '';
    }, kind);
    if (result) bad.push(`${kind}: ${result}`);
  }
  expect(bad).toEqual([]);
});

test('turning a knob on a face reaches the stored rack', async ({ page }) => {
  await openRack(page);
  const module = await add(page, 'phaser');
  const before = (await stored(page)).slot.params.rateHz;
  await turn(module.locator('.fxk', { has: page.locator('.ui-kname', { hasText: /^Rate$/ }) }), 40);
  const after = (await stored(page)).slot.params.rateHz;
  expect(after).toBeGreaterThan(before);
  // The face reads what it wrote.
  await expect(module.locator('.fxk', { has: page.locator('.ui-kname', { hasText: /^Rate$/ }) }).locator('.ui-kval')).not.toHaveText(`${before.toFixed(2)} Hz`);
});

test('a switch is a tile that lights, and stores', async ({ page }) => {
  await openRack(page);
  const module = await add(page, 'utility');
  const tile = module.locator('.fxt', { hasText: /Invert$/ }).locator('button');
  await expect(tile).not.toHaveClass(/\bon\b/);
  await tile.click();
  await expect(tile).toHaveClass(/\bon\b/);
  expect((await stored(page)).slot.params.invert).toBe(1);
});

test('the compressor\'s threshold is the arrow on its input meter', async ({ page }) => {
  await openRack(page);
  const module = await add(page, 'comp');
  const caret = module.locator('.fx-mtr.in .fx-caret');
  const meter = module.locator('.fx-mtr.in i');
  const b = await meter.boundingBox(), c = await caret.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + 1);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, b.y + b.height * .25, { steps: 6 });
  await page.mouse.up();
  const t = (await stored(page)).slot.thresholdDb;
  // A quarter of the way down a meter that reads 0 to −72 dB.
  expect(t).toBeGreaterThan(-24);
  expect(t).toBeLessThan(-12);
});

test('the EQ\'s node moves its band', async ({ page }) => {
  await openRack(page);
  const module = await add(page, 'eq');
  const node = module.locator('.fx-node[data-b="2"] circle');
  const b = await node.boundingBox();
  const disp = await module.locator('.fx-eq-disp svg').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(disp.x + disp.width * .75, disp.y + disp.height * .3, { steps: 6 });
  await page.mouse.up();
  const band = (await stored(page)).slot.bands[2];
  expect(band.freq).toBeGreaterThan(2000);
  expect(band.gainDb).toBeGreaterThan(3);
});

test('a knob\'s own range is set on Advanced and kept with the rack', async ({ page }) => {
  await openRack(page);
  const module = await add(page, 'prism:echo');
  await module.locator('.fx-adv-btn').click();
  const row = module.locator('.fx-adv-row', { hasText: /^Delay/ });
  await row.locator('input').nth(0).fill('100');
  await row.locator('input').nth(0).dispatchEvent('change');
  await row.locator('input').nth(1).fill('300');
  await row.locator('input').nth(1).dispatchEvent('change');
  const { ranges } = await stored(page);
  expect(ranges?.delayMs).toMatchObject({ min: 100, max: 300 });
  // Back on the knobs, the Delay knob sweeps only that.
  await module.locator('.fx-adv-btn').click();
  const knob = module.locator('.fxk', { has: page.locator('.ui-kname', { hasText: /^Delay$/ }) });
  await turn(knob, 400);
  expect((await stored(page)).slot.params.delayMs).toBeCloseTo(300, 0);
});

test('Hyperprism, SoundHack and Lexicon draw pictured faces, a picture on every control', async ({ page }) => {
  await openRack(page);
  for (const [kind, face] of [['prism:hp-echo', '.hp-face'], ['prism:sh-delay', '.sh-face'], ['prism:lxp-hall', '.lex-face']]) {
    const module = await add(page, kind);
    await expect(module.locator(face)).toHaveCount(1);
    expect(Math.round((await module.boundingBox()).width)).toBe(348);
    const bare = await module.evaluate((m) => [...m.querySelectorAll('.param')]
      .filter((r) => !r.querySelector('svg.pic, .fx-pic svg, .ui-pic') && !r.matches('.prism-sound, .seg-param, .lex-choice, .sh-choice'))
      .map((r) => r.textContent.trim()));
    expect(bare, `${kind}: controls without a picture`).toEqual([]);
  }
});

test('Hyperprism Multi Delay has Feedback, and it stores', async ({ page }) => {
  await openRack(page);
  const module = await add(page, 'prism:hp-multi-delay');
  const row = module.locator('.hp-face .param', { hasText: 'Feedback' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('svg.pic, .fx-pic svg, .ui-pic')).not.toHaveCount(0);
  await row.locator('input[type=range]').evaluate((el) => {
    el.value = '40';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => (await stored(page)).slot?.params?.feedback).toBe(40);
});

async function soundHackContract(page, kind) {
  const module = await add(page, kind);
  const face = module.locator('.sh-face');
  await expect(face).toBeVisible();
  const contract = await module.evaluate((el, kind) => {
    const face = el.querySelector('.sh-face'), params = state.shapers[kind].params;
    const fonts = [face, ...face.querySelectorAll('*')].filter((e) => getComputedStyle(e).fontFamily.includes('Arial Black')).map((e) => e.className);
    const rgb = getComputedStyle(face).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lin = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return { fonts, luminance: lin[0] * .2126 + lin[1] * .7152 + lin[2] * .0722,
      keys: [...face.querySelectorAll('.param[data-key]')].map((e) => e.dataset.key).sort(), expected: params.map((p) => p.key).sort(),
      move: params.find((p) => !p.toggle && !p.choices && p.max > p.min && p.default < p.max)?.key };
  }, kind);
  expect(contract.fonts, kind).toEqual([]);
  expect(contract.luminance, kind).toBeLessThan(.1);
  expect(contract.keys, kind).toEqual(contract.expected);
  const blank = await face.evaluate((el) => [...el.querySelectorAll('.ui-kn')].filter((kn) => {
    const pic = kn.closest('.ui-knob')?.querySelector('.ui-pic');
    return !pic?.querySelector('path[d], line, polyline, polygon, circle, rect');
  }).length);
  expect(blank, `${kind}: blank knobs`).toBe(0);
  expect(await face.locator('.ui-kn').count(), `${kind}: shared knobs`).toBeGreaterThan(0);
  if (contract.move) {
    const before = (await stored(page)).slot.params[contract.move];
    await turn(face.locator(`.param[data-key="${contract.move}"]`), 16);
    await expect.poll(async () => (await stored(page)).slot.params[contract.move]).not.toBe(before);
  }
}
for (const kind of ['sh-bubbler', 'sh-chebyshev', 'sh-compand', 'sh-decimate', 'sh-delay', 'sh-flipper', 'sh-matrix', 'sh-phasor', 'sh-pitchdelay']) {
  test(`SoundHack ${kind} uses the app face and preserves every parameter`, async ({ page }) => {
    await openRack(page);
    await soundHackContract(page, `prism:${kind}`);
  });
}
test('SoundHack spectral modes use the app face with their exact controls', async ({ page }) => {
  test.setTimeout(120_000);
  await openRack(page);
  const kinds = await page.evaluate(() => [...new Set(state.suites.flatMap((s) => s.families.flatMap((f) => f.modes))
    .filter((m) => m.listed && m.kernel === 'spectral-dynamics' && state.shapers[m.kind]).map((m) => m.kind))]);
  expect(kinds.length).toBeGreaterThan(0);
  for (const kind of kinds) await soundHackContract(page, kind);
});
