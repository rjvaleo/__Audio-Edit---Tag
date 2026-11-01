// Compose, phase four: the composition.
//
// Everything the view shows, kept under a name and put back as one thing, and
// one export that writes the sound and the film into one folder. What is
// checked:
//
//   - a composition keeps the engine, the grain's lanes, the picture's lanes,
//     the look, the source switches, the frame, and the sequencer's state and
//     take — and opening it puts every one back;
//   - compositions are listed by the names they were saved under, and a name
//     cannot climb out of their folder;
//   - one export puts the sound and the film beside each other in a folder
//     named for the composition.

import { test, expect } from './test.mjs';

async function openCompose(page) {
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
    () => !!(seq.ready && state.automation && state.edit && visualLanes.path === state.selectedFile?.path),
    { timeout: 20_000 },
  );
}

const frameOf = (page) => page.frames().find((f) => f.url().includes('/sequencer/'));

test('a composition keeps everything the view shows, and opening it puts every part back', async ({ page }) => {
  await openCompose(page);
  const frame = frameOf(page);

  // Every part set to something that is not its default.
  await frame.evaluate(() => {
    const el = document.getElementById('cutoffSlider');
    el.value = '23';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    perfLoaded = {
      id: 'take-kept', name: 'Kept', created: Date.now(), generated: false,
      duration: 2, startAt: 1, wasPlaying: true, snapshot: getPresetState(), gestures: [],
    };
  });
  const saved = await page.evaluate(async () => {
    await editOp({ op: 'stretch', ratio: 2.5 });
    state.automation.lanes = [{
      id: 'g-kept', target: 'stretch.grain.rateHz', label: 'Grains — Rate', enabled: true,
      points: [{ frame: 0, value: 0.3 }, { frame: laneFrames(), value: 0.6 }],
    }];
    saveAutomation();
    visualLanes.lanes = [{
      id: 'vis:room.ringScale', target: 'visual.room.ringScale', label: 'Ring — Size', enabled: true,
      points: [{ frame: 0, value: 0.2, curve: 'linear', tension: 0 }],
    }];
    roomEdit.ringDrive = 3.25;
    saveRoomData();
    setSource('seq', false);
    roomEdit.frame = '16x9';
    applyRoomFrame();
    await new Promise((r) => setTimeout(r, 400));
    await compositionSave('Compose test piece');
    return { names: await compositionList(), picked: $('cvCompPick').value };
  });
  expect(saved.names).toContain('Compose test piece');
  expect(saved.picked).toBe('Compose test piece');

  // Every part moved again.
  await frame.evaluate(() => {
    const el = document.getElementById('cutoffSlider');
    el.value = '67';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    perfLoaded = null;
  });
  await page.evaluate(async () => {
    await editOp({ op: 'stretch', ratio: 1 });
    state.automation.lanes = [];
    saveAutomation();
    visualLanes.lanes = [];
    saveVisualLanes();
    roomEdit.ringDrive = 1;
    setSource('seq', true);
    roomEdit.frame = 'dock';
    applyRoomFrame();
    await new Promise((r) => setTimeout(r, 400));
  });

  await page.evaluate(() => compositionLoad('Compose test piece'));
  await frame.waitForFunction(() => perfLoaded && perfLoaded.id === 'take-kept', null, { timeout: 8_000 });
  const got = await page.evaluate(() => ({
    ratio: state.edit.stretch.ratio,
    grain: state.automation.lanes.map((l) => l.id),
    visual: visualLanes.lanes.map((l) => l.id),
    drive: roomEdit.ringDrive,
    seq: sourceOn('seq'),
    frame: roomEdit.frame,
    picked: $('cvCompPick').value,
  }));
  const inSeq = await frame.evaluate(() => ({
    cutoff: document.getElementById('cutoffSlider').value,
    take: perfLoaded.id,
    listed: perfLoadAll()[0]?.id,
  }));
  expect(got.ratio, 'the engine was not put back').toBeCloseTo(2.5, 6);
  expect(got.grain, 'the grain lanes were not put back').toEqual(['g-kept']);
  expect(got.visual, 'the picture lanes were not put back').toEqual(['vis:room.ringScale']);
  expect(got.drive, 'the look was not put back').toBeCloseTo(3.25, 6);
  expect(got.seq, 'the source switches were not put back').toBe(false);
  expect(got.frame, 'the frame was not put back').toBe('16x9');
  expect(got.picked).toBe('Compose test piece');
  expect(inSeq.cutoff, 'the sequencer state was not put back').toBe('23');
  expect(inSeq.take, 'the sequencer take was not put back').toBe('take-kept');
  expect(inSeq.listed, 'the take is not at the head of the list of takes').toBe('take-kept');

  await page.evaluate(async () => {
    setSource('seq', true);
    state.automation.lanes = [];
    saveAutomation();
    visualLanes.lanes = [];
    saveVisualLanes();
    roomEdit.frame = 'dock';
    await compositionDelete('Compose test piece');
  });
  expect(await page.evaluate(() => compositionList())).not.toContain('Compose test piece');
});

test('compositions are listed by the names they were saved under, and a name cannot climb out', async ({ page }) => {
  await openCompose(page);
  const got = await page.evaluate(async () => {
    await compositionSave('b piece');
    await compositionSave('A piece');
    await compositionSave('../../escape');
    const names = await compositionList();
    const back = await api(`/api/compositions/get?name=${encodeURIComponent('../../escape')}`);
    const menu = [...$('cvCompPick').options].map((o) => o.value);
    for (const n of ['b piece', 'A piece', '../../escape']) await compositionDelete(n);
    return { names, backName: back.name, menu, after: await compositionList() };
  });
  expect(got.names).toEqual(expect.arrayContaining(['A piece', 'b piece', '../../escape']));
  expect(got.names.indexOf('A piece')).toBeLessThan(got.names.indexOf('b piece'));
  expect(got.backName, 'the name it was saved under was lost').toBe('../../escape');
  expect(got.menu).toEqual(expect.arrayContaining(['A piece', 'b piece']));
  for (const n of ['A piece', 'b piece', '../../escape']) expect(got.after).not.toContain(n);
});

test('one export puts the sound and the film beside each other, in a folder named for the composition', async ({ page }) => {
  await openCompose(page);
  const got = await page.evaluate(async () => {
    const realExport = videoExport, realSupport = videoExportSupport;
    // The film is made in the page and needs a codec the test browser may not
    // have. What is tested here is where it goes, so a few bytes stand in.
    videoExport = async () => new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109])],
      { type: 'video/mp4' });
    videoExportSupport = () => null;
    try {
      await compositionPaint('');
      openExportLoop(null);
      const out = await composeExportAll();
      closeExportLoop();
      return { sound: out?.sound?.path || null, error: out?.sound?.error || null, film: out?.film || null };
    } finally {
      videoExport = realExport;
      videoExportSupport = realSupport;
    }
  });
  expect(got.error).toBeNull();
  expect(got.sound, 'the sound did not go into the composition folder').toMatch(/ composition\//);
  expect(got.film, 'the film did not go into the composition folder').toMatch(/ composition\//);
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
  expect(dirOf(got.film), 'the sound and the film are in different folders').toBe(dirOf(got.sound));
  expect(got.film).toMatch(/\.mp4$/);
});
