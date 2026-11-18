// The synth pages, 17 Nov 2026 (WORK DIR/page-mockups/SYNTH-PAGES-PLAN.md).
// RJ: the transport to the bottom on every page, the white overview gone;
// "all the keyboards should be the same size" and Atmosphere's "should work";
// "it's a fixed size… we scroll around"; Wave's FX board without the list on
// the left, "right click to add", with "the same effects… the same visuals
// and the same amount of controls" as Prism's FX tab; Grain starting on a
// pulse wave; Edit's sonogram at 4096.

import { test, expect } from './test.mjs';

async function go(page, sel) {
  await page.locator(`#leftRail ${sel}`).first().click();
}

test('the transport is along the bottom of the page, and the white overview is gone', async ({ page }) => {
  await page.goto('/');
  const vh = page.viewportSize().height;
  const r = await page.locator('#nowBar').boundingBox();
  expect(Math.round(r.y + r.height)).toBe(vh);
  await expect(page.locator('#nbStrip')).toBeHidden();
  await expect(page.locator('#playBtn')).toBeVisible();
  await expect(page.locator('#volume')).toBeVisible();
});

test('Grain with nothing open starts on the pulse wave, and its keys are the one keyboard', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof setGrainUi === 'function');
  await page.evaluate(() => setGrainUi('synth'));
  await go(page, '.rl-item[data-page="grain"]');
  await expect.poll(() => page.evaluate(() => state.selectedFile?.path)).toBe('.mgl/Pulse 25%.wav');
  await expect(page.locator('body')).toHaveClass(/grainpage/);
  const k = await page.locator('#gsKeys').boundingBox();
  expect([Math.round(k.width), Math.round(k.height)]).toEqual([812, 100]);
  expect(await page.evaluate(() => GS.scale)).toBe(1);
});

test('Wave: no overview, the one keyboard, one size; its board has no list and offers the rack\'s effects with their faces', async ({ page }) => {
  await page.goto('/');
  await go(page, '.rl-item[data-mode="synth"]');
  await page.waitForFunction(() => WV.built);
  const k = await page.locator('#wvKeys').boundingBox();
  expect([Math.round(k.width), Math.round(k.height)]).toEqual([812, 100]);
  expect(await page.evaluate(() => WV.scale)).toBe(1);
  expect(await page.evaluate(() => document.getElementById('poWell')?.offsetParent ?? null)).toBe(null);
  await page.locator('#wvViews [data-v="fx"]').click();
  await expect(page.locator('#waveView .wv-flib')).toBeHidden();
  await page.waitForFunction(() => state.suites?.length > 0);
  // The menu is the rack's suites.
  const menu = await page.evaluate(() => wvAddItems(() => {}).filter((i) => !i.sep).map((i) => i.l));
  for (const s of ['Reverb', 'Delay', 'Modulation', 'Filter']) expect(menu).toContain(s);
  // An effect node wears the rack's face, every control.
  const n = await page.evaluate(() => {
    const x = WV.board.nodes.find((n) => wvRackMode(n));
    wvBoardSelect({ t: 'node', id: x.id });
    return { id: x.id, controls: wvRackMode(x).shaper.params.length };
  });
  await expect(page.locator('#wvFinsp .wv-rackface .fx-module-controls')).not.toBeEmpty();
  expect(n.controls).toBeGreaterThan(0);
});

test('Atmosphere: the app\'s keyboard along its bottom, and the computer\'s keys play it', async ({ page }) => {
  await page.goto('/');
  await go(page, '.rl-item[data-mode="atmos"]');
  await expect(page.locator('#atmosDock')).toBeVisible();
  const k = await page.locator('#adKeys').boundingBox();
  expect([Math.round(k.width), Math.round(k.height)]).toEqual([812, 100]);
  const frame = page.frameLocator('#seqFrame');
  await frame.locator('#atPicA').waitFor({ state: 'attached' });
  await expect(frame.locator('.ky-panel')).toBeHidden();
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('a');
  const f = page.frame({ url: /\/sequencer\// });
  await expect.poll(() => f.evaluate(() => [...KY.held.keys()].join(','))).toMatch(/^atmos:\d+$/);
  await page.keyboard.up('a');
  await expect.poll(() => f.evaluate(() => KY.held.size)).toBe(0);
});

test('Atmosphere is one size: its columns do not follow the window', async ({ page }) => {
  await page.goto('/');
  await go(page, '.rl-item[data-mode="atmos"]');
  const f = page.frame({ url: /\/sequencer\// }) || (await page.waitForEvent('frameattached'));
  await page.frameLocator('#seqFrame').locator('.at-oscbox[data-osc="A"] >> visible=true').waitFor();
  const w1 = await page.frameLocator('#seqFrame').locator('.at-oscbox[data-osc="A"] >> visible=true').evaluate((e) => e.getBoundingClientRect().width);
  await page.setViewportSize({ width: 1300, height: 900 });
  const w2 = await page.frameLocator('#seqFrame').locator('.at-oscbox[data-osc="A"] >> visible=true').evaluate((e) => e.getBoundingClientRect().width);
  expect(Math.round(w1)).toBe(490);
  expect(Math.round(w2)).toBe(490);
});

test('Edit\'s sonogram reads at 4096, and its setting is off the Visuals tab', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => state.fftSize)).toBe(4096);
  expect(await page.evaluate(() => document.getElementById('fftSizes').closest('.fx').classList.contains('hidden'))).toBe(true);
});
