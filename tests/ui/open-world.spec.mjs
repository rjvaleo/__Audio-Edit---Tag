// The open world, step one: the world camera is what is kept, the box is
// what is drawn, and nothing on screen moves.
//
// See `docs/OPEN-WORLD-PLAN.md`. The room still draws its box in this step;
// what changes is where the camera lives. So the assertions are about
// exactness — the box a world camera draws is the box it was made from, a
// room posed on `main` opens here looking the same, and a drag still lands
// where it landed — and about the matrix that step two will draw with.

import { test, expect } from '@playwright/test';

async function openRoom(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
  await page.evaluate(() => setMode('room'));
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
}

const POSED = { depth: 4.4, floorY: -0.9, ceilY: 0.2, shiftX: 0.4, skyAt: 0.5, ring: 0.3, backW: 0.8, backH: 1.2 };

test('a box camera becomes a world camera and back, exactly, at any aspect', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate((posed) => {
    const out = [];
    for (const [box, aspect] of [[ROOM_CAM_DEFAULT, 16 / 9], [posed, 9 / 16], [posed, 2.35]]) {
      const w = vgWorldFromBox(box, aspect);
      const back = vgBoxFromWorld(w);
      out.push({ w, box: vgCamera(box), back, world: vgIsWorld(w), boxIsWorld: vgIsWorld(box) });
    }
    return out;
  }, POSED);
  for (const g of got) {
    expect(g.world).toBe(true);
    expect(g.boxIsWorld).toBe(false);
    for (const k of ['depth', 'floorY', 'ceilY', 'shiftX', 'skyAt', 'ring', 'backW', 'backH']) {
      expect(g.back[k], `${k} did not survive the round trip`).toBeCloseTo(g.box[k], 9);
    }
  }
  // The default, read as a place to stand.
  expect(got[0].w.height).toBeCloseTo(0.38, 9);
  expect(got[0].w.pitch).toBeCloseTo(6.843, 2);
  expect(got[0].w.yaw).toBe(0);
  expect(got[0].w.reach).toBe(1.9);
  // A slid vanishing point is a yaw, and it depends on the aspect it was posed at.
  expect(got[1].w.yaw).not.toBe(0);
  expect(got[1].w.yaw).not.toBeCloseTo(got[2].w.yaw, 3);
  expect(got[1].w.aspect).toBeCloseTo(9 / 16, 9);
});

test('a room posed on main opens here looking the same, migrated once', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined', { timeout: 20_000 });
  await page.evaluate((posed) => {
    localStorage.removeItem('roomCamerasWorld');
    localStorage.setItem('roomCameras', JSON.stringify({ '16x9': posed, dock: { ...posed, shiftX: -0.2 } }));
  }, POSED);
  await page.reload();
  await page.waitForFunction(() => typeof roomEdit !== 'undefined', { timeout: 20_000 });
  const got = await page.evaluate(() => {
    const kept = JSON.parse(localStorage.getItem('roomCamerasWorld') || 'null');
    const old = JSON.parse(localStorage.getItem('roomCameras') || 'null');
    roomEdit.frame = '16x9';
    const drawn16 = roomCamNow();
    roomEdit.frame = 'dock';
    const drawnDock = roomCamNow();
    const out = { kept, old, drawn16, drawnDock, isWorld: vgIsWorld(roomEdit.cams['16x9']) };
    localStorage.removeItem('roomCamerasWorld');
    localStorage.removeItem('roomCameras');
    roomEdit.cams = {};
    roomEdit.frame = 'dock';
    return out;
  });
  expect(got.isWorld, 'the stored camera is not a world camera').toBe(true);
  expect(got.kept && got.kept['16x9'].height, 'the migrated form was not written').toBeCloseTo(0.9, 9);
  expect(got.old['16x9'].floorY, 'main\'s own key was touched').toBe(-0.9);
  for (const k of ['depth', 'floorY', 'ceilY', 'shiftX', 'skyAt', 'ring', 'backW', 'backH']) {
    expect(got.drawn16[k], `16:9 ${k}`).toBeCloseTo(POSED[k], 9);
  }
  expect(got.drawnDock.shiftX).toBeCloseTo(-0.2, 9);
});

test('a drag writes a world camera, and the box it draws is the one the drag made', async ({ page }) => {
  await openRoom(page);
  const r = await page.evaluate(() => {
    const b = document.getElementById('visGl').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const before = await page.evaluate(() => roomCamNow());
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.6);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.85, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const got = await page.evaluate(() => ({
    stored: roomEdit.cams[roomEdit.frame],
    drawn: roomCamNow(),
    world: roomWorldNow(),
    readout: $('reNums').textContent,
    copy: JSON.parse($('reNums').dataset.copy),
    saved: JSON.parse(localStorage.getItem('roomCamerasWorld') || '{}')[roomEdit.frame],
  }));
  expect('height' in got.stored, 'the drag did not write a world camera').toBe(true);
  expect('floorY' in got.stored, 'the drag wrote a box').toBe(false);
  expect(got.drawn.floorY).not.toBeCloseTo(before.floorY, 4);
  expect(got.drawn.ceilY - got.drawn.floorY).toBeCloseTo(before.ceilY - before.floorY, 6);
  expect(got.world.height).toBeCloseTo(-got.drawn.floorY, 9);
  expect(got.readout).toMatch(/^height .* pitch .*° .* yaw .*° .* reach /);
  expect(got.copy.height).toBeCloseTo(got.world.height, 3);
  expect(got.saved && got.saved.height, 'the world camera was not saved').toBeCloseTo(got.world.height, 9);
});

test('the film and the projection helpers take a camera in either shape', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate((posed) => {
    const gl = $('visGl');
    const w = gl.clientWidth, h = gl.clientHeight;
    const world = vgWorldFromBox(posed, w / h);
    const a = roomProject(0.2, -0.1, 0.5, w, h, posed);
    const b = roomProject(0.2, -0.1, 0.5, w, h, world);
    const wa = roomBackWall(w, h, posed), wb = roomBackWall(w, h, world);
    // Posed as a world camera, drawn as the box.
    roomEdit.cams[roomEdit.frame] = world;
    const drawnA = roomCameraDrawn(undefined);
    delete roomEdit.cams[roomEdit.frame];
    return { a, b, wa, wb, drawnHasFloor: !!drawnA && 'floorY' in drawnA && !('height' in drawnA) };
  }, POSED);
  expect(got.b.x).toBeCloseTo(got.a.x, 6);
  expect(got.b.y).toBeCloseTo(got.a.y, 6);
  expect(got.wb.x).toBeCloseTo(got.wa.x, 6);
  expect(got.wb.w).toBeCloseTo(got.wa.w, 6);
  expect(got.drawnHasFloor, 'the renderer was handed a world camera').toBe(true);
});

test('the world\'s own view looks along its pitch and yaw and narrows with distance', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const proj = (v, p) => {
      const m = v.mvp;
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [x / w, y / w];
    };
    const level = vgWorldView({ height: 1, pitch: 0, yaw: 0, fov: 60 }, 16 / 9, 0.1, 100);
    // Points on the ground straight ahead: below the middle, and rising towards
    // the horizon as they recede, never reaching it.
    const g2 = proj(level, [0, 0, -2]), g20 = proj(level, [0, 0, -20]), g200 = proj(level, [0, 0, -200]);
    // A post to the right, near and far: narrows towards the middle.
    const r2 = proj(level, [1, 1, -2]), r20 = proj(level, [1, 1, -20]);
    // Turned right, the same point ahead moves left in the frame.
    const turned = vgWorldView({ height: 1, pitch: 0, yaw: 20, fov: 60 }, 16 / 9, 0.1, 100);
    const t = proj(turned, [0, 1, -5]);
    // Pitched up, the ground ahead sinks in the frame.
    const up = vgWorldView({ height: 1, pitch: 15, yaw: 0, fov: 60 }, 16 / 9, 0.1, 100);
    const u = proj(up, [0, 0, -5]), flat = proj(level, [0, 0, -5]);
    return { g2, g20, g200, r2, r20, t, u, flat, eye: level.eye, dir: level.dir };
  });
  expect(got.eye).toEqual([0, 1, 0]);
  expect(got.dir[2]).toBeCloseTo(-1, 9);
  expect(got.g2[1]).toBeLessThan(0);
  expect(got.g20[1]).toBeGreaterThan(got.g2[1]);
  expect(got.g200[1]).toBeGreaterThan(got.g20[1]);
  expect(got.g200[1]).toBeLessThan(0);
  expect(Math.abs(got.r20[0])).toBeLessThan(Math.abs(got.r2[0]));
  expect(got.t[0]).toBeLessThan(0);
  expect(got.u[1]).toBeLessThan(got.flat[1]);
});
