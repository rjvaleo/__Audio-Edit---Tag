// Posing the room.
//
// The room's shape and camera used to be constants read straight out of
// `vis-gl.js` at every draw call, chosen while looking at one frame shape. They
// are a value now, one per frame shape, and they are found by dragging the room
// rather than by typing numbers at it — see `docs/ROOM-EDITOR.md`.
//
// What these hold: that a drag on the room actually moves the camera, that the
// two zones do different things, that each frame keeps its own, and — the one
// that matters most — that `floorY` and `ceilY` move as one asymmetry rather
// than as two independent numbers, because that asymmetry is the tilt.

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
  await page.evaluate(() => {
    localStorage.removeItem('roomCameras');
    roomEdit.cams = {};
    roomEdit.frame = 'dock';
    if (!roomEdit.on) toggleRoomEdit();
  });
  await page.waitForTimeout(300);
}

/// Drag from a fraction of the way across the room to another.
async function dragRoom(page, from, to) {
  const r = await page.evaluate(() => {
    const b = document.getElementById('visGl').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  await page.mouse.move(r.x + r.w * from[0], r.y + r.h * from[1]);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * to[0], r.y + r.h * to[1], { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

const cam = () => roomCamNow();

test('dragging the lower room tilts the camera and keeps the room its own height',
  async ({ page }) => {
    await openRoom(page);
    const before = await page.evaluate(cam);

    // Down the middle of the room: the camera zone, straight down.
    await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
    const after = await page.evaluate(cam);

    expect(after.floorY, 'the floor did not move').not.toBeCloseTo(before.floorY, 4);
    // The whole point: the height is held and the asymmetry moves. Two fields
    // would let these drift apart; one gesture cannot.
    const h0 = before.ceilY - before.floorY;
    const h1 = after.ceilY - after.floorY;
    expect(h1, `the room changed height (${h0} to ${h1}) instead of tilting`)
      .toBeCloseTo(h0, 6);
    // Dragging down looks further up, so the floor takes less of the frame.
    expect(after.floorY, 'the tilt went the wrong way').toBeGreaterThan(before.floorY);
  });

test('dragging sideways slides the frustum and never turns the camera',
  async ({ page }) => {
    await openRoom(page);
    const before = await page.evaluate(cam);

    await dragRoom(page, [0.5, 0.6], [0.8, 0.6]);
    const after = await page.evaluate(cam);

    // Against the drag, because shifting the frustum right swings the view
    // right, which carries the vanishing point left. The hand and the vanishing
    // point go the same way; the number goes the other.
    expect(after.shiftX, 'the vanishing point did not move sideways')
      .toBeLessThan(before.shiftX);
    // A sideways drag is not a tilt.
    expect(after.ceilY - after.floorY, 'the room resized on a sideways drag')
      .toBeCloseTo(before.ceilY - before.floorY, 6);
  });

test('the sky zone moves the ring and not the camera', async ({ page }) => {
  await openRoom(page);
  const before = await page.evaluate(cam);

  // Top of the room, where the ring hangs.
  await dragRoom(page, [0.5, 0.15], [0.5, 0.05]);
  const after = await page.evaluate(cam);

  expect(after.skyAt, 'the ring did not rise').toBeGreaterThan(before.skyAt);
  expect(after.floorY, 'a drag on the sky moved the camera').toBeCloseTo(before.floorY, 6);
});

test('each frame shape keeps its own camera', async ({ page }) => {
  await openRoom(page);

  await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
  const dock = await page.evaluate(cam);
  expect(dock.floorY, 'the dock camera did not move').not.toBeCloseTo(-0.38, 4);

  // Switch to the tall frame: untouched, so it is still what the source ships.
  await page.evaluate(() => { roomEdit.frame = '9x16'; applyRoomFrame(); paintRoomNums(); });
  const vert = await page.evaluate(cam);
  expect(vert.floorY, 'the tall frame inherited the dock camera').toBeCloseTo(-0.38, 6);

  // And the room is actually that shape now, not a wide panel to imagine from.
  const shape = await page.evaluate(() => {
    const b = document.querySelector('#masterBus .mb-cell-3d').getBoundingClientRect();
    return b.width / b.height;
  });
  expect(shape, `the 9:16 frame drew at ${shape}`).toBeCloseTo(9 / 16, 1);

  // Back to the dock and the posed camera is still there.
  await page.evaluate(() => { roomEdit.frame = 'dock'; applyRoomFrame(); paintRoomNums(); });
  expect((await page.evaluate(cam)).floorY, 'the dock camera was lost')
    .toBeCloseTo(dock.floorY, 6);
});

test('a posed camera survives a reload, and Reset puts it back', async ({ page }) => {
  await openRoom(page);
  await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
  const posed = await page.evaluate(cam);

  await page.reload();
  await page.waitForFunction(() => typeof roomEdit !== 'undefined', { timeout: 20_000 });
  const back = await page.evaluate(() => roomCamNow());
  expect(back.floorY, 'the camera did not survive a reload').toBeCloseTo(posed.floorY, 6);

  await page.evaluate(() => { if (!roomEdit.on) toggleRoomEdit(); document.getElementById('reReset').click(); });
  await page.waitForTimeout(150);
  expect((await page.evaluate(cam)).floorY, 'Reset did not restore the source camera')
    .toBeCloseTo(-0.38, 6);
});
