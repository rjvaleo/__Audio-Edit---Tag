// What the `room-hierarchy` specs share.

import { test, expect } from './test.mjs';

/// Push a few dozen frames of made-up sound into the room.
///
/// **`push(bands, pairs)` takes two positional arguments**, and `bands` is in
/// decibels. Handing it one object instead — `push({ spectrum, liss })` — makes
/// `bands.length` undefined, so it returns at the first line and pushes
/// nothing, silently. Two probes were written against that mistake: the room
/// went on drawing whatever real history the app already had, which is near
/// silence, and a control that scales how hard the sound pushes the ring out of
/// round then correctly did nothing at all. That read as the control being
/// broken for half an hour.
export const PUSH_SIGNAL = `
  for (let p = 0; p < 40; p++) {
    const bands = new Float32Array(128);
    for (let i = 0; i < 128; i++) bands[i] = -60 + Math.abs(Math.sin(i * 0.2 + p * 0.3)) * 55;
    const pairs = new Float32Array(1024 * 2);
    for (let i = 0; i < 1024; i++) {
      pairs[i * 2] = Math.sin(i * 0.05 + p * 0.12) * 0.5;
      pairs[i * 2 + 1] = Math.cos(i * 0.037 + p * 0.12) * 0.5;
    }
    visGl.push(bands, pairs);
  }
`;

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
  await page.evaluate(() => {
    for (const k of ['roomCameras', 'roomLayers', 'roomStreams', 'roomData', 'roomHierarchy']) {
      localStorage.removeItem(k);
    }
    roomEdit.cams = {};
    roomEdit.layers = {};
    roomEdit.streams = null;
    roomEdit.order = ROOM_LAYERS.map((l) => l.key);
    roomEdit.occlude = {};
    roomEdit.ringScale = 1;
    roomEdit.grainDensity = 1;
    roomEdit.grainBright = 1;
    roomEdit.ringDrive = 1;
    roomEdit.ringEdge = 0.035;
    roomEdit.leadThick = true;
    roomEdit.ringPoints = 512;
    roomEdit.mist = false;
    roomEdit.mistAmount = 0.5;
    roomEdit.mistLength = 0.06;
    roomEdit.grainFill = false;
    roomEdit.grainFillBg = true;
    roomEdit.grainFillColour = '#1b2b3a';
    roomEdit.frame = 'dock';
    if (!roomEdit.on) toggleRoomEdit();
    buildRoomLayers();
  });
  await page.waitForTimeout(300);
}

/// The list on screen is the hierarchy, read the way a hierarchy is read.
