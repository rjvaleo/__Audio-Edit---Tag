// The transport's two stops.
//
// Stop returns to the cue, which is where you said playback starts from. That
// left no way back to the top of the file except moving the cue there — and
// then the cue is gone, which is the one thing a cue is for: auditioning the
// same moment repeatedly without re-finding it.
//
// So double-click returns to zero and leaves the cue alone. Both halves matter
// and the second is the one that would rot quietly: a version that reset the
// cue as well would pass any test that only looked at where the playhead ended
// up.

import { test, expect } from '@playwright/test';

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
    setMode('edit');
  });
  await page.waitForSelector('#stopBtn', { state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(400);
}

/// A cue somewhere that is definitely not the beginning.
const CUE = 12_000;

const read = () => ({
  position: engine.position,
  cue: state.cue,
  atCue: Math.abs(engine.position - engineFromSrc(state.cue)) < 2,
});

test('stop returns to the cue, and double-click returns to the beginning', async ({ page }) => {
  await openFile(page);

  await page.evaluate((c) => { setCue(c); seekSource(c + 5000); }, CUE);
  await page.waitForTimeout(200);

  // One click: back to the cue, which is not zero.
  await page.click('#stopBtn');
  await page.waitForTimeout(300);
  const once = await page.evaluate(read);
  expect(once.cue, 'the cue moved when it should not have').toBe(CUE);
  expect(once.atCue, `stop left the playhead at ${once.position}, not at the cue`).toBe(true);
  expect(once.position, 'the cue was at the beginning, so this proves nothing')
    .toBeGreaterThan(0);

  // Two clicks: back to the beginning.
  await page.dblclick('#stopBtn');
  await page.waitForTimeout(300);
  const twice = await page.evaluate(read);
  expect(twice.position, 'double-click did not return to the beginning').toBe(0);
  // The half that would rot quietly.
  expect(twice.cue, 'double-click moved the cue, and a cue is a mark somebody set')
    .toBe(CUE);
});

test('a single stop after a double-click still goes to the cue', async ({ page }) => {
  await openFile(page);

  await page.evaluate((c) => { setCue(c); }, CUE);
  await page.dblclick('#stopBtn');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => engine.position), 'not at the beginning').toBe(0);

  // The cue survived, so the transport can still be sent back to it.
  await page.click('#stopBtn');
  await page.waitForTimeout(300);
  const back = await page.evaluate(read);
  expect(back.atCue, `stop went to ${back.position} instead of the cue`).toBe(true);
  expect(back.position, 'ended up at the beginning, so the cue was lost').toBeGreaterThan(0);
});
