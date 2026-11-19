// The whole-window Wave frame, as agreed in mock-up A6.
import { test, expect } from './test.mjs';

const views = ['play', 'create', 'matrix', 'fx'];
async function wave(page, width = 2080, height = 1100) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.locator('#leftRail .rl-item[data-mode="synth"]').click();
  await page.waitForFunction(() => typeof WV !== 'undefined' && WV.built);
}
async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const e = document.querySelector(selector), r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const host = document.getElementById('waveView');
    return {
      scale: WV.scale, host: rect('#waveView'), app: rect('#waveView .wv-app'),
      mid: rect('#wvMid'), dock: rect('#wvRdock'), keys: rect('#wvKeys'),
      scroll: [host.scrollWidth - host.clientWidth, host.scrollHeight - host.clientHeight],
    };
  });
}

test('at the iMac’s size the frame fills the window at one size', async ({ page }) => {
  await wave(page);
  expect(await page.locator('#wvRdock').count()).toBe(1);
  let dockLeft;
  for (const view of views) {
    await page.locator(`#wvViews [data-v="${view}"]`).click();
    const g = await geometry(page);
    expect(g.scale, view).toBe(1);
    expect(g.dock.width, view).toBeCloseTo(440, 1);
    dockLeft ??= g.dock.x;
    expect(g.dock.x, view).toBeCloseTo(dockLeft, 1);
    expect([g.keys.width, g.keys.height], view).toEqual([812, 100]);
    expect(g.scroll[0], view).toBeLessThanOrEqual(0);
    expect(g.scroll[1], view).toBeLessThanOrEqual(0);
    expect(Math.abs(g.app.right - g.host.right), view).toBeLessThanOrEqual(2);
    expect(Math.abs(g.app.bottom - g.host.bottom), view).toBeLessThanOrEqual(2);
  }
});

test('the middle grows with the window and nothing else does', async ({ page }) => {
  await wave(page);
  expect(await page.locator('#wvMid').count()).toBe(1);
  const a = await geometry(page);
  await page.setViewportSize({ width: 2300, height: 1100 });
  await expect.poll(async () => (await geometry(page)).mid.width).toBeCloseTo(a.mid.width + 220, 1);
  const b = await geometry(page);
  expect(b.scale).toBe(1);
  expect(b.dock.width).toBeCloseTo(a.dock.width, 1);
  expect([b.keys.width, b.keys.height]).toEqual([a.keys.width, a.keys.height]);
});

test('at the laptop’s size the whole frame scales once for every tab', async ({ page }) => {
  await wave(page, 1440, 900);
  const scale = await page.evaluate(() => WV.scale);
  expect(scale).toBeGreaterThan(0);
  expect(scale).toBeLessThan(1);
  for (const view of views) {
    await page.locator(`#wvViews [data-v="${view}"]`).click();
    const g = await geometry(page);
    expect(g.scale, view).toBeCloseTo(scale, 6);
    expect(g.dock.width, view).toBeCloseTo(440 * scale, 1);
    expect(g.scroll[0], view).toBeLessThanOrEqual(0);
    expect(g.scroll[1], view).toBeLessThanOrEqual(0);
  }
});

test('scaled keys still play the key under the pointer', async ({ page }) => {
  await wave(page, 1440, 900);
  expect(await page.evaluate(() => WV.scale)).toBeLessThan(1);
  const point = await page.evaluate(() => {
    const [x, width] = wvKeyLayout()[60];
    const r = document.getElementById('wvKeys').getBoundingClientRect();
    return { x: r.left + (x + width / 2) * WV.scale, y: r.top + 80 * WV.scale };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  try {
    await expect.poll(() => page.evaluate(() => WV.held.has(60))).toBe(true);
  } finally { await page.mouse.up(); }
  await expect.poll(() => page.evaluate(() => WV.held.has(60))).toBe(false);
});
