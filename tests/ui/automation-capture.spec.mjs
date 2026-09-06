// Capturing a performance.
//
// The recorder itself is the server's and is tested there: a move while the
// transport runs lands in a lane of its own. What is checked here is what the
// interface adds — that every engine control is on offer, that Capture arms
// the recorder and rolls, and that the take is drawn as a stacked timeline.

import { test, expect } from '@playwright/test';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
    document.querySelector('.dock-tab[data-dock="automation"]').click();
  });
  await page.waitForFunction(() => (state.automation.targets || []).length > 0, { timeout: 20_000 });
}

test('every engine control is a target, and the ones that rebuild the file are not', async ({ page }) => {
  await open(page);
  const targets = await page.evaluate(() => state.automation.targets.map(([t]) => t));
  for (const want of [
    'stretch.grain.rateHz', 'stretch.grain.layers', 'stretch.grain.scan', 'stretch.grain.reverse',
    'stretch.grain.panSpread', 'stretch.grain.driftRateHz',
    'stretch.wsola.searchMs', 'stretch.vocoder.magFreeze', 'stretch.pvsola.blend',
    'stretch.hybrid.harmonicLevel', 'stretch.cloudMix',
  ]) {
    expect(targets, `${want} is not offered`).toContain(want);
  }
  for (const not of ['stretch.hybrid.fftSize', 'stretch.wsola.preserveTransients', 'stretch.algorithm', 'stretch.grain.seed']) {
    expect(targets, `${not} would rebuild the file and must not be a lane`).not.toContain(not);
  }
  expect(targets.filter((t) => t.startsWith('stretch.')).length).toBeGreaterThanOrEqual(48);
});

test('Capture arms latch, and ending it disarms and refetches the take', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => state.automationRecord || 'off');
  expect(before).toBe('off');
  // Armed through the button, but without the transport: the scratch server
  // has no sound card to play through, and arming is the interface's part.
  await page.evaluate(async () => {
    startPlayback = () => { engine.playing = true; };
    await startCapture();
  });
  const armed = await page.evaluate(async () => ({
    mode: state.automationRecord,
    server: (await api('/api/automation/record')).mode,
    armed: state.captureArmed,
    button: $('automationCapture').classList.contains('recording'),
  }));
  expect(armed.mode).toBe('latch');
  expect(armed.server, 'the server was not armed').toBe('latch');
  expect(armed.armed).toBe(true);
  expect(armed.button).toBe(true);

  await page.evaluate(async () => { engine.playing = false; await endCapture(); });
  const after = await page.evaluate(async () => ({
    mode: state.automationRecord,
    server: (await api('/api/automation/record')).mode,
    armed: state.captureArmed,
    button: $('automationCapture').classList.contains('recording'),
  }));
  expect(after.mode).toBe('off');
  expect(after.server).toBe('off');
  expect(after.armed).toBe(false);
  expect(after.button).toBe(false);
});

test('the take is drawn as one stacked timeline, and a click opens a lane', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(() => {
    const kept = JSON.stringify(state.automation.lanes);
    state.automation.lanes = [
      { id: 'a', target: 'stretch.grain.rateHz', label: 'Grains — Rate', enabled: true, points: [{ frame: 0, value: 0.2 }, { frame: laneFrames(), value: 0.9 }] },
      { id: 'b', target: 'stretch.vocoder.magFreeze', label: 'Vocoder — Freeze', enabled: true, points: [{ frame: 0, value: 0.5 }] },
      { id: 'c', target: 'fx.g.db', label: 'Gain — Level', enabled: true, points: [] },
    ];
    state.automationSel = null;
    renderAutomation();
    const tl = $('automationTimeline');
    const rows = () => [...document.querySelectorAll('.automation-lane')].map((r) => r.dataset.lane);
    const first = rows();
    // Click the second row.
    const laneH = +tl.dataset.laneH;
    const r = tl.getBoundingClientRect();
    const y = r.top + (AT_RULER + laneH * 1.5) * (r.height / tl.height);
    tl.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width / 2, clientY: y, bubbles: true }));
    const second = rows();
    const colours = ['stretch.grain.rateHz', 'stretch.vocoder.magFreeze', 'fx.g.db', 'stretch.ratio'].map(laneColour);
    state.automation.lanes = JSON.parse(kept);
    state.automationSel = null;
    renderAutomation();
    return { drawn: !!tl && tl.height > AT_RULER + 3 * laneH - 1, laneH, first, second, colours };
  });
  expect(got.drawn, 'the timeline canvas was not drawn for three lanes').toBe(true);
  expect(got.first, 'one editor, for the first lane').toEqual(['a']);
  expect(got.second, 'the click did not open the second lane').toEqual(['b']);
  // Four modules, four colours: grains, engines, the document, the rack.
  expect(new Set(got.colours).size).toBe(4);
});
