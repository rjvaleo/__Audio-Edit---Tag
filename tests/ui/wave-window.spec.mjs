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

test('on FX the board fills the middle and its inspector is in the dock', async ({ page }) => {
  await wave(page);
  await page.locator('#wvViews [data-v="fx"]').click();
  await expect(page.locator('#wvRdock #wvFinsp')).toBeVisible();
  const g = await geometry(page), well = await page.locator('.wv-fwell').boundingBox();
  expect(well.width).toBeGreaterThanOrEqual(g.mid.width - 40);
  expect(Math.abs(well.y + well.height - g.keys.y)).toBeLessThanOrEqual(20);
});

test('every effect face fits the dock without horizontal clipping', async ({ page }) => {
  test.setTimeout(120_000);
  await wave(page);
  await page.waitForFunction(() => WV.connected && WV_FXCAT.list.length && state.suites?.length);
  await page.locator('#wvViews [data-v="fx"]').click();
  await expect(page.locator('#wvRdock #wvFinsp')).toBeVisible();
  const failures = await page.evaluate(async () => {
    const failures = [];
    for (const f of WV_FXCAT.list) {
      const b = { name: 'Face fit', nodes: [
        { id: 'invoice', kind: 'in:voice', x: 16, y: 16, on: true, params: {} },
        { id: 'face', kind: f.kind, x: 200, y: 16, on: true, params: {} },
        { id: 'out', kind: 'out', x: 600, y: 16, on: true, params: {} },
      ], cables: [{ from: ['invoice', 'o'], to: ['face', 'i'] }, { from: ['face', 'o'], to: ['out', 'i'] }] };
      const posted = await wvBoardFetch('/api/wave/board', 'POST', b);
      if (!posted.ok) { failures.push(`${f.kind}: board rejected`); continue; }
      wvBoardAdopt(b);
      wvRenderBoard();
      wvBoardSelect({ t: 'node', id: 'face' });
      const face = document.querySelector('#wvFinsp .wv-rackface');
      if (!face) { failures.push(`${f.kind}: missing face`); continue; }
      const bounds = face.getBoundingClientRect();
      for (const el of [face, ...face.querySelectorAll('*')]) {
        // SVG graphics report glyph/path metrics, not HTML overflow. Pad
        // dots and meter carets intentionally cross their internal wells;
        // their visible elements must still remain inside the whole face.
        const internalHandle = el.matches('.prism-pad') || el.querySelector(':scope > .fx-caret');
        if (el instanceof HTMLElement && !internalHandle && el.clientWidth && el.scrollWidth > el.clientWidth + 1)
          failures.push(`${f.kind}: ${el.tagName}.${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        if (el instanceof HTMLElement && el.getClientRects().length) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.left < bounds.left - 1 || r.right > bounds.right + 1))
            failures.push(`${f.kind}: ${el.tagName}.${el.className} outside face`);
        }
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
});

test('Play shows all eight envelopes and LFOs with every control', async ({ page }) => {
  await wave(page);
  for (const src of ['amp', 'env1', 'env2', 'env3', 'lfo0', 'lfo1', 'lfo2', 'lfo3']) {
    const tile = page.locator(`#wvViewPlay [data-p="p"][data-tile="${src}"]`);
    await expect(tile).toBeVisible();
    await expect(tile.locator('.wv-slot')).toHaveCount(0);
    if (src.startsWith('lfo')) {
      await expect(tile.locator('[data-lmode] span')).toHaveText(['Free', 'Trig', 'Env']);
      await expect(tile.locator('[data-lsync] span')).toHaveText(['Hz', 'Sync']);
      await expect(tile.locator('.wv-rd')).toHaveCount(3);
    } else await expect(tile.locator('.wv-rd')).toHaveCount(4);
    const r = await tile.boundingBox(), g = await geometry(page);
    expect(r.x).toBeGreaterThanOrEqual(g.mid.x);
    expect(r.x + r.width).toBeLessThanOrEqual(g.dock.x);
    expect(r.y + r.height).toBeLessThan(g.keys.y);
  }
  const fx = await page.locator('#wvFxRow').boundingBox();
  expect(fx.y + fx.height).toBeLessThanOrEqual((await geometry(page)).keys.y);
  expect(await page.evaluate(() => WV.scale)).toBe(1);
});

test('Env 3 attack still drags on Play', async ({ page }) => {
  await wave(page);
  const canvas = page.locator('#wvpevenv2');
  await expect(canvas).toBeVisible();
  const point = await page.evaluate(() => {
    const g = WVW.wvpevenv2, p = wvEnvPts(g, wvEnv('env2')).a, r = g.el.getBoundingClientRect();
    return { x: r.x + p[0] * WV.scale, y: r.y + p[1] * WV.scale, before: wvG('env2.a') };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 18, point.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => wvG('env2.a'))).not.toBe(point.before);
});
