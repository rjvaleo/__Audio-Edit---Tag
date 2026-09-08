// The grips sit on the things they move, and are only there while editing.
//
// This spec used to measure the box's back: its width and height on their
// own, the front face pinned while the back changed. The back is gone with
// the box (`docs/OPEN-WORLD.md`, step two), and so are those tests. What is
// left is what is still true of any grip in any world: it is drawn where the
// thing it moves is drawn, by the same projection the room is drawn with.

import { test, expect } from '@playwright/test';

async function openRoom(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForSelector('#masterBus .mb-cell-3d', { state: 'visible', timeout: 20_000 });
}

test('the handles sit on the room they are dragging', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    roomEdit.on = true;
    paintRoomHandles();
    const gl = document.getElementById('visGl');
    const r = gl.getBoundingClientRect();
    const c = roomWorldNow();
    const hw = roomHalfW(r.width, r.height);
    const at = (key) => {
      const el = document.querySelector(`.rh[data-handle="${key}"]`);
      const b = el.getBoundingClientRect();
      return [b.x + b.width / 2 - r.x, b.y + b.height / 2 - r.y];
    };
    const want = (x, y, t) => {
      const p = roomProject(x, y, t, r.width, r.height, c);
      return [p.x, p.y];
    };
    return {
      depth: at('depth'), depthWant: want(0, VG_WORLD_H / 2, 1),
      hw, keys: [...document.querySelectorAll('.rh')].map((e) => e.dataset.handle),
    };
  });
  expect(got.keys.sort()).toEqual(['depth']);
  expect(got.depth[0]).toBeCloseTo(got.depthWant[0], 0);
  expect(got.depth[1]).toBeCloseTo(got.depthWant[1], 0);
  expect(got.hw).toBeGreaterThan(0);
});

test('a point projected and unprojected comes back where it was, turned or pitched', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const gl = document.getElementById('visGl');
    const r = gl.getBoundingClientRect();
    const out = [];
    for (const cam of [
      ROOM_CAM_DEFAULT,
      { depth: 4.4, floorY: -0.9, ceilY: 0.2, shiftX: 0.4, skyAt: 0.5, ring: 0.3 },
      { height: 0.6, pitch: -4, yaw: 25, reach: 3, aspect: r.width / r.height, ring: { at: 0.7, size: 0.2 } },
    ]) {
      for (const [x, y, t] of [[0.3, -0.2, 0.5], [-0.8, 0.4, 0.05], [0.1, 0.1, 0.95]]) {
        const p = roomProject(x, y, t, r.width, r.height, cam);
        const q = roomUnproject(p.x, p.y, t, r.width, r.height, cam);
        out.push({ x, y, qx: q.x, qy: q.y });
      }
    }
    return out;
  });
  for (const g of got) {
    expect(g.qx).toBeCloseTo(g.x, 6);
    expect(g.qy).toBeCloseTo(g.y, 6);
  }
});

test('the grips are only there while the room is being edited', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    roomEdit.on = false;
    paintRoomHandles();
    const off = document.getElementById('roomHandles').classList.contains('hidden');
    roomEdit.on = true;
    paintRoomHandles();
    const on = !document.getElementById('roomHandles').classList.contains('hidden');
    const count = document.querySelectorAll('#roomHandles .rh').length;
    return { off, on, count };
  });
  expect(got.off).toBe(true);
  expect(got.on).toBe(true);
  expect(got.count).toBe(1);
});
