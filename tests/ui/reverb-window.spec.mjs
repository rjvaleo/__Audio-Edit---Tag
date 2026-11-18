// The Reverb window (`077-fx-reverb-window.js`, Network Face 3): one fixed
// 1280 × 640 plugin window, opened from a Reverb module. Every Reverb mode
// wears it; every control in it reaches the running effect and the saved rack;
// Place is off until turned on and is kept with the slot.

import { test, expect } from './test.mjs';

async function openRack(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.evaluate(async () => {
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await postJSON('/api/rack', { p: files[0].path, sr: 44100, slots: [] });
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.locator('.dock-tab[data-dock="effects"]').click();
  await page.waitForFunction(() => state.rack && (state.suites || []).length > 0);
}

async function addMode(page, suite, mode) {
  await page.evaluate(([s, m]) => {
    const mo = state.suites.find((x) => x.id === s).families.flatMap((f) => f.modes).find((x) => x.id === m);
    addFxModule(mo.kind, { ...mo, suite: s });
  }, [suite, mode]);
  await page.waitForFunction(async () => {
    const id = state.rack.slots.at(-1)?.id;
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return (r.slots || []).some((s) => s.id === id);
  });
}

async function stored(page) {
  await page.waitForTimeout(400);
  return page.evaluate(async () => (await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`)).slots.at(-1));
}

test('a Reverb module opens one fixed 1280 × 640 window; other modules have no Open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRack(page);
  await addMode(page, 'modulation', 'tremolo');
  await expect(page.locator('.fx-module').last().locator('.fx-open')).toHaveCount(0);
  await addMode(page, 'reverb', 'sm-gemini');
  await page.locator('.fx-module').last().locator('.fx-open').click();
  const win = page.locator('#reverbWindow');
  await expect(win).toBeVisible();
  const size = await win.evaluate((el) => [el.offsetWidth, el.offsetHeight]);
  expect(size).toEqual([1280, 640]);
  await expect(win.locator('.rv-mode .ui-dd')).toContainText('Mesh 16');
  await expect(win.locator('.rv-badge .fx-class-badge')).toHaveText(/measured/);
  // no strip of modes: the dropdowns show their networks instead (RJ, 16 Nov)
  await expect(win.locator('.rv-strip, .rv-mini')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(win).toBeHidden();
});

test('every Reverb mode wears the window: its own controls and Place, all inside it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRack(page);
  await addMode(page, 'reverb', 'sm-gemini');
  await page.locator('.fx-module').last().locator('.fx-open').click();
  const modes = await page.evaluate(() => state.suites.find((s) => s.id === 'reverb').families.flatMap((f) => f.modes).filter((m) => m.listed).map((m) => [m.id, m.kind]));
  const bad = [];
  for (const [id, kind] of modes) {
    await page.evaluate((m) => { const mo = state.suites.find((s) => s.id === 'reverb').families.flatMap((f) => f.modes).find((x) => x.id === m); fxSwitchMode(state.rack.slots.length - 1, mo, 'reverb'); }, id);
    await page.waitForFunction((m) => state.rack.slots.at(-1)?.mode === m && document.querySelector('#reverbWindow .rv-mode select')?.value === m, id);
    const r = await page.evaluate((k) => {
      const win = document.getElementById('reverbWindow');
      const band = win.querySelector('.rv-band');
      const own = (state.shapers[k]?.params || []).length;
      const shown = band.querySelectorAll('.fxk, .fxf, .fxt, .fxs').length;
      const bottom = Math.max(...[...band.children].map((c) => c.getBoundingClientRect().bottom));
      return { own, shown, over: bottom - win.getBoundingClientRect().bottom };
    }, kind);
    if (r.shown !== r.own + 6) bad.push(`${id}: ${r.shown} controls for ${r.own} + 6`);
    if (r.over > 0) bad.push(`${id}: runs ${Math.round(r.over)} px past the window`);
  }
  expect(bad).toEqual([]);
});

test('a knob in the window reaches the stored rack, and Place is kept once turned on', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRack(page);
  await addMode(page, 'reverb', 'schroeder-reverb');
  await page.locator('.fx-module').last().locator('.fx-open').click();
  const before = await stored(page);
  expect(before.place?.on ?? false).toBe(false);
  // Decay, on its knob in the window
  const ring = page.locator('#reverbWindow .fxk').first().locator('.ui-ring');
  const b = await ring.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 40, { steps: 6 });
  await page.mouse.up();
  const after = await stored(page);
  expect(JSON.stringify(after.params)).not.toEqual(JSON.stringify(before.params));
  // Place on, then the sound dragged in the room
  await page.locator('#reverbWindow .rv-led').click();
  expect((await stored(page)).place.on).toBe(true);
  const pos0 = (await stored(page)).place.pos;
  const sq = await page.evaluate(() => { const r = document.querySelector('#reverbWindow .rv-room').getBoundingClientRect(); const z = r.width / document.querySelector('#reverbWindow .rv-room').offsetWidth; return [r.left + RV_ROOM.Sq[0] * z, r.top + RV_ROOM.Sq[1] * z]; });
  await page.mouse.move(sq[0], sq[1]);
  await page.mouse.down();
  await page.mouse.move(sq[0] + 60, sq[1] + 10, { steps: 8 });
  await page.mouse.up();
  const moved = await stored(page);
  expect(moved.place.pos).not.toBeCloseTo(pos0, 1);
});

test('switching the mode in the window keeps it open on the new mode, Place and all', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRack(page);
  await addMode(page, 'reverb', 'freeverb');
  await page.locator('.fx-module').last().locator('.fx-open').click();
  await page.locator('#reverbWindow .rv-led').click();
  // through the dropdowns: Network, then Mesh 4 (Lyra)
  await page.locator('#reverbWindow .rv-fam .ui-dd').click();
  await page.locator('.ui-menu .ui-mi .ui-mt').getByText('Network', { exact: true }).click();
  await page.waitForFunction(() => state.rack.slots.at(-1)?.mode === 'sm-gemini');
  await page.locator('#reverbWindow .rv-mode .ui-dd').click();
  await page.locator('.ui-menu .ui-mi .ui-mt').getByText('Mesh 4', { exact: true }).click();
  await page.waitForFunction(() => state.rack.slots.at(-1)?.mode === 'sm-lyra');
  await expect(page.locator('#reverbWindow')).toBeVisible();
  await expect(page.locator('#reverbWindow .rv-mode .ui-dd')).toContainText('Mesh 4');
  const s = await stored(page);
  expect(s.mode).toBe('sm-lyra');
  expect(s.place.on).toBe(true);
});

test('moving a Place control moves the room, every time, also after the move before it was saved', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRack(page);
  await addMode(page, 'reverb', 'schroeder-reverb');
  await page.locator('.fx-module').last().locator('.fx-open').click();
  await page.locator('#reverbWindow .rv-led').click();
  await page.waitForTimeout(500);
  const caption = () => page.locator('#reverbWindow .rv-room .rv-cap.b').textContent();
  const sound = () => page.evaluate(() => RV_ROOM.W.src.slice());
  const turn = async (label, pixels) => {
    const knob = page.locator('#reverbWindow .rv-sect.ours .fxk').filter({ hasText: label });
    const b = await knob.locator('.ui-ring').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - pixels, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  };
  const s0 = await sound();
  await turn('Distance', 40);
  const s1 = await sound();
  expect(s1[1]).not.toBeCloseTo(s0[1], 3);
  // the move above was saved; the next must still move the room
  await turn('Distance', 40);
  const s2 = await sound();
  expect(s2[1]).not.toBeCloseTo(s1[1], 3);
  const c2 = await caption();
  await turn('Position', 50);
  expect((await sound())[0]).not.toBeCloseTo(s2[0], 3);
  await turn('Height', 40);
  expect((await sound())[2]).not.toBeCloseTo(s2[2], 3);
  await turn('Room size', 40);
  expect(await caption()).not.toEqual(c2);
});

test('the Family and Mode dropdowns show each mode\'s network', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRack(page);
  await addMode(page, 'reverb', 'sm-gemini');
  await page.locator('.fx-module').last().locator('.fx-open').click();
  await expect(page.locator('#reverbWindow .rv-mode .ui-dd img.rv-ddpic')).toHaveCount(1);
  await page.locator('#reverbWindow .rv-mode .ui-dd').click();
  const items = page.locator('.ui-menu .ui-mi');
  const n = await items.count();
  expect(n).toBe(12);
  await expect(page.locator('.ui-menu .ui-mi img.rv-ddpic.big')).toHaveCount(n);
  await page.keyboard.press('Escape');
  await page.locator('#reverbWindow .rv-fam .ui-dd').click();
  await expect(page.locator('.ui-menu .ui-mi img.rv-ddpic.big')).toHaveCount(await page.locator('.ui-menu .ui-mi').count());
});

test('the window follows the engine\'s levels on any page: every hit lights the room again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRack(page);
  await addMode(page, 'reverb', 'sm-gemini');
  await page.locator('.fx-module').last().locator('.fx-open').click();
  // the Effects dock hidden, as on the Grain page; levels only from the engine
  await page.evaluate(() => { document.getElementById('dockEffects')?.classList.add('hidden'); REVERB_LEVELS = []; });
  const e0 = await page.evaluate(() => RV.e);
  const hits = await page.evaluate(async () => {
    const seen = new Set();
    for (let k = 0; k < 60; k++) {
      const hit = k % 15 === 0 ? 0.8 : 0.05;
      engine.rackLevels = [[hit, hit], [0.5, 0.5]];
      await new Promise((r) => setTimeout(r, 30));
      seen.add(RV.pingAt.toFixed(3));
    }
    return seen.size;
  });
  expect(await page.evaluate(() => RV.e)).toBeGreaterThan(Math.max(0.3, e0));
  expect(hits).toBeGreaterThanOrEqual(4);
});
