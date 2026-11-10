// What the `room-editor` specs share.

import { test, expect } from './test.mjs';

export async function openRoom(page) {
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
  // Every test starts from the same room.
  //
  // Not fussiness: the layers, the streams, the block size and the opacity are
  // all remembered on purpose, so a test that turns the Data layer off leaves
  // it off for everything after it — which is exactly what happened, and it
  // made the blocks test pass on its own and fail in the suite, reading an
  // empty block and comparing against nothing.
  await page.evaluate(() => {
    for (const k of ['roomCameras', 'roomLayers', 'roomStreams', 'roomData']) {
      localStorage.removeItem(k);
    }
    roomEdit.cams = {};
    roomEdit.layers = {};
    roomEdit.streams = null;
    roomEdit.chunk = 4;
    roomEdit.opacity = 0.7;
    roomEdit.frame = 'dock';
    if (!roomEdit.on) toggleRoomEdit();
  });
  await page.waitForTimeout(300);
}

/// Drag from a fraction of the way across the room to another.
export async function dragRoom(page, from, to) {
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

export const cam = () => roomWorldNow();
/// What the source ships: the box's tilt, as a pitch.
export const VG_WORLD_DEFAULT_PITCH = 6.843;
