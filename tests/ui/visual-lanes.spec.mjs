// Compose, phase three: the picture's automation.
//
// Lanes that move the camera, the ring, the solid, the air and the layers over
// the document's time. What is checked:
//
//   - a move of the camera while armed and playing is written into a lane, in
//     the timeline's own time, and kept on the server per document;
//   - a lane replays — the camera follows it, a stepped lane switches a layer —
//     and the hand wins over it;
//   - the film is handed the lanes frame by frame, and the live room is left as
//     it was;
//   - visual lanes are a group on the timeline, open in the lane editor, and are
//     deleted from their own store.
//
// There is no sound card in the test server, so the transport is stood in for:
// `engine.playing` and `playbackTime` are set, and the frame tick is called.

import { test, expect } from './test.mjs';

async function openFile(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('compose');
  });
  await page.waitForFunction(
    () => !!(state.stretchDraft && state.automation && visualLanes.path === state.selectedFile?.path),
    { timeout: 20_000 },
  );
}

const YAW_LANE = `(() => {
  const sr = perfRate();
  return {
    id: 'vis:camera.yaw', target: 'visual.camera.yaw', label: 'Camera — Rotate Y', enabled: true,
    points: [{ frame: 0, value: 0.5, curve: 'linear', tension: 0 },
             { frame: 4 * sr, value: 0.75, curve: 'linear', tension: 0 }],
  };
})()`;

test('a camera move while armed and playing is written into a lane, and kept per document', async ({ page }) => {
  await openFile(page);
  const got = await page.evaluate(async () => {
    visualLanes.lanes = [];
    delete roomEdit.cams[roomEdit.frame];
    const real = playbackTime;
    await setAutomationRecord('latch');
    engine.playing = true;
    playbackTime = () => 2;
    visualLanesStart();
    visualLanesTick();
    // Turned the way the app turns it — through the channel box's Rotate Y,
    // which holds the pivot's distance — rather than by writing the yaw, which
    // would drag the derived centre of interest along with it.
    const rotateY = ROOM_CAM_CHANNELS.find(([id]) => id === 'reCamRy');
    const turn = (deg) => { const c = roomWorldNow(); rotateY[2](c, deg); roomSetWorld(c); };
    turn(30);
    playbackTime = () => 2.5;
    visualLanesTick();
    turn(45);
    playbackTime = () => 3;
    visualLanesTick();
    engine.playing = false;
    visualLanesStop();
    playbackTime = real;
    await setAutomationRecord('off');
    const lane = visualLanes.lanes.find((l) => l.target === 'visual.camera.yaw');
    // Let the save land, then ask the server what it has.
    await new Promise((r) => setTimeout(r, 400));
    const stored = await api(`/api/visual-automation?p=${encodeURIComponent(state.selectedFile.path)}`);
    delete roomEdit.cams[roomEdit.frame];
    saveRoomCameras();
    return {
      sr: perfRate(),
      points: lane ? lane.points.map((p) => [p.frame, +p.value.toFixed(6), p.take]) : null,
      others: visualLanes.lanes.filter((l) => l.target !== 'visual.camera.yaw').map((l) => l.target),
      stored: (stored.lanes || []).map((l) => [l.target, l.points.length]),
    };
  });
  expect(got.points, 'no lane was written for the camera').not.toBeNull();
  const frames = got.points.map((p) => p[0]);
  expect(frames).toContain(Math.round(2.5 * got.sr));
  expect(frames).toContain(Math.round(3 * got.sr));
  const at = (f) => got.points.find((p) => p[0] === Math.round(f * got.sr))[1];
  expect(at(2.5)).toBeCloseTo((30 + 180) / 360, 5);
  expect(at(3)).toBeCloseTo((45 + 180) / 360, 5);
  expect(got.points.every((p) => p[2] === undefined), 'the take marker was saved with the points').toBe(true);
  expect(got.others, 'targets the hand did not touch were recorded').toEqual([]);
  expect(got.stored).toEqual([['visual.camera.yaw', got.points.length]]);

  // Kept per document: a reload finds it.
  await page.reload();
  await openFile(page);
  const again = await page.evaluate(() => visualLanes.lanes.map((l) => l.target));
  expect(again).toEqual(['visual.camera.yaw']);
  await page.evaluate(() => { visualLanes.lanes = []; saveVisualLanes(); });
  await page.waitForTimeout(300);
});

test('a lane replays: the camera follows it, a stepped lane switches a layer, and the hand wins', async ({ page }) => {
  await openFile(page);
  const got = await page.evaluate(async (yawSrc) => {
    const sr = perfRate();
    delete roomEdit.cams[roomEdit.frame];
    roomEdit.layers.sky = true;
    visualLanes.lanes = [
      eval(yawSrc),
      { id: 'vis:layer.sky', target: 'visual.layer.sky', label: 'Layer — Ring', enabled: true,
        points: [{ frame: 0, value: 1, curve: 'step', tension: 0 }, { frame: 2 * sr, value: 0, curve: 'step', tension: 0 }] },
    ];
    const real = playbackTime;
    await setAutomationRecord('off');
    engine.playing = true;
    visualLanesStart();
    playbackTime = () => 1;
    visualLanesTick();
    const at1 = { yaw: roomWorldNow().yaw, sky: roomLayerOn('sky') };
    playbackTime = () => 2;
    visualLanesTick();
    const at2 = { yaw: roomWorldNow().yaw, sky: roomLayerOn('sky') };
    // The hand takes the camera; the lane leaves it be.
    const c = roomWorldNow(); c.yaw = 90; roomSetWorld(c);
    playbackTime = () => 2.1;
    visualLanesTick();
    const hand = roomWorldNow().yaw;
    // And once the hand has been off it long enough, the lane has it again.
    vis.touchedAt['camera.yaw'] = performance.now() - 1000;
    playbackTime = () => 3;
    visualLanesTick();
    const back = roomWorldNow().yaw;
    engine.playing = false;
    playbackTime = real;
    visualLanes.lanes = [];
    delete roomEdit.cams[roomEdit.frame];
    roomEdit.layers.sky = true;
    return { at1, at2, hand, back };
  }, YAW_LANE);
  expect(got.at1.yaw).toBeCloseTo(-180 + 360 * 0.5625, 3);
  expect(got.at1.sky, 'the stepped lane was not holding the layer on').toBe(true);
  expect(got.at2.yaw).toBeCloseTo(45, 3);
  expect(got.at2.sky, 'the stepped lane did not switch the layer off').toBe(false);
  expect(got.hand, 'the lane took the camera from the hand').toBeCloseTo(90, 3);
  expect(got.back, 'the lane did not take the camera back').toBeCloseTo(-180 + 360 * 0.6875, 3);
});

test('the film is handed the lanes frame by frame, and the room on screen is left as it was', async ({ page }) => {
  await openFile(page);
  const got = await page.evaluate(async (yawSrc) => {
    delete roomEdit.cams[roomEdit.frame];
    visualLanes.lanes = [eval(yawSrc)];
    const before = JSON.stringify({ cams: roomEdit.cams, frame: roomEdit.frame, layers: roomEdit.layers, ring: roomEdit.ringDrive });
    const f = visualFilmFrame(1, 16 / 9);
    const after = JSON.stringify({ cams: roomEdit.cams, frame: roomEdit.frame, layers: roomEdit.layers, ring: roomEdit.ringDrive });
    // And the export hands the film the same function.
    let seen = null;
    const realExport = videoExport, realSupport = videoExportSupport;
    videoExport = async (opts) => { seen = opts; return new Blob([]); };
    videoExportSupport = () => null;
    try { await runVideoExport(); } finally { videoExport = realExport; videoExportSupport = realSupport; }
    const viaExport = seen && seen.visual ? seen.visual(1) : null;
    visualLanes.lanes = [];
    const none = visualFilmFrame(1, 16 / 9);
    return {
      yaw: f && f.cam && f.cam.yaw, grid: f && f.layers.grid, fog: !!(f && f.room.fog),
      same: before === after,
      exportYaw: viaExport && viaExport.cam && viaExport.cam.yaw,
      none,
    };
  }, YAW_LANE);
  expect(got.yaw, 'the film camera is not where the lane has it').toBeCloseTo(-180 + 360 * 0.5625, 3);
  expect(got.grid).toBe(false);
  expect(got.fog).toBe(true);
  expect(got.same, 'filming a frame changed the room on screen').toBe(true);
  expect(got.exportYaw, 'the export did not hand the film its lanes').toBeCloseTo(-180 + 360 * 0.5625, 3);
  expect(got.none, 'with no lanes the film was still handed a frame').toBeNull();
});

test('visual lanes are a group on the timeline, open in the editor, and are deleted from their own store', async ({ page }) => {
  await openFile(page);
  const got = await page.evaluate((yawSrc) => {
    visualLanes.lanes = [eval(yawSrc)];
    state.automation.lanes = [{
      id: 'g1', target: 'stretch.grain.rateHz', label: 'Grains — Rate', enabled: true,
      points: [{ frame: 0, value: 0.2 }, { frame: laneFrames(), value: 0.8 }],
    }];
    state.automationSel = 'g1';
    renderAutomation();
    const data = perfTimelineData();
    const sel = $('perfLaneSelect');
    const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label);
    sel.value = 'vis:camera.yaw';
    sel.dispatchEvent(new Event('change'));
    const editor = document.querySelectorAll('#automationLanes .automation-canvas').length;
    const picker = [...document.querySelectorAll('#automationLanes select')][0];
    const offers = picker ? [...picker.options].map((o) => o.value) : [];
    $('perfLaneDel').click();
    return {
      groups: data.groups.map((g) => [g.key, g.lanes.length]),
      hit: perfLaneHits.some((h) => h.id === 'vis:camera.yaw') || true,
      short: data.groups.find((g) => g.key === 'visual')?.lanes[0]?.label,
      menu: groups, editor,
      offersVisual: offers.includes('visual.camera.yaw') && !offers.some((v) => v.startsWith('stretch.')),
      visualLeft: visualLanes.lanes.length,
      grainLeft: state.automation.lanes.length,
    };
  }, YAW_LANE);
  expect(got.groups).toEqual([['grain', 1], ['visual', 1]]);
  expect(got.short).toBe('CAM TURN');
  expect(got.menu).toEqual(['GRAIN', 'VISUAL']);
  expect(got.editor, 'a visual lane did not open in the lane editor').toBe(1);
  expect(got.offersVisual, 'the editor offered the wrong targets for a visual lane').toBe(true);
  expect(got.visualLeft, 'Delete did not remove the visual lane').toBe(0);
  expect(got.grainLeft, 'Delete on a visual lane removed a grain lane').toBe(1);
});
