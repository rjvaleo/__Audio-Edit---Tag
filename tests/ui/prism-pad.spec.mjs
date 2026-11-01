// The Prism pad: Hyperprism's blue window, on the Effects dock.
//
// One square, two controls — Time & Pitch, or any rack slot — with limits
// typed into its corners. Dragging moves both through the same live paths as
// their sliders, so recording and playback need nothing new; the Rust tests
// (`server/src/pad.rs`, `automation.rs`, `tests/routes.rs`) hold the pad's
// arithmetic to the lanes'. What is checked here is the pad itself, in the
// real interface.
//
// The scratch server has no audio device, so a take is not recorded here by
// playing; the path and LOOP are checked on lanes posted directly.

import { test, expect } from './test.mjs';

async function openPad(page, slots = []) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.evaluate(async (slots) => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await postJSON('/api/rack', { p: files[0].path, sr: 44100, slots });
    await postJSON('/api/automation', { p: files[0].path, bypassed: false, lanes: [] });
    await selectFile(files[0]);
    setMode('edit');
  }, slots);
  await page.locator('.dock-tab[data-dock="prism"]').click();
  await page.waitForFunction(() => (window.prismPad?.sources || []).length > 0);
}

const RING = { id: 'r1', kind: 'ring', bypassed: false, params: { hz: 220, mix: 1, sweep: 0 } };

/// Drag on the pad from its centre to a point given as fractions across and up.
async function drag(page, across, up) {
  const box = await page.locator('#prismPad').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + across * box.width, box.y + (1 - up) * box.height, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function stored(page, id) {
  return page.evaluate(async (id) => {
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return { slot: (r.slots || []).find((s) => s.id === id), pads: r.pads || {} };
  }, id);
}

test('the pad offers Time & Pitch first, then the rack\'s slots', async ({ page }) => {
  await openPad(page, [RING, { id: 'e1', kind: 'eq', bypassed: false }]);
  await expect(page.locator('#prismSource option')).toHaveText(['Time & Pitch', 'Pitch Time Changer', 'Ring mod']);
  await expect(page.locator('#prismX')).toHaveValue('ratio');
  await expect(page.locator('#prismY')).toHaveValue('semitones');
});

test('Time & Pitch: speed across, pitch up', async ({ page }) => {
  await openPad(page);
  await drag(page, 0.5, 0.5);
  let d = await page.evaluate(() => state.stretchDraft);
  // The middle of a sweep from four times as long to a quarter is untouched.
  expect(d.ratio).toBeGreaterThan(0.93);
  expect(d.ratio).toBeLessThan(1.07);
  expect(Math.abs(d.semitones)).toBeLessThan(0.6);
  await drag(page, 0.999, 0.999);
  d = await page.evaluate(() => state.stretchDraft);
  expect(d.ratio).toBeLessThan(0.27);
  expect(d.semitones).toBeGreaterThan(11.5);
  await expect(page.locator('#prismXRead')).toContainText('Stretch');
  await expect(page.locator('#prismYRead')).toContainText('Pitch');
});

test('a rack slot on the pad moves both of its controls', async ({ page }) => {
  await openPad(page, [RING]);
  await page.locator('#prismSource').selectOption({ label: 'Ring mod' });
  await expect(page.locator('#prismX')).toHaveValue('hz');
  await expect(page.locator('#prismY')).toHaveValue('mix');
  await drag(page, 0.999, 0.02);
  const { slot } = await stored(page, 'r1');
  expect(slot.params.hz).toBeGreaterThan(3_500);
  expect(slot.params.mix).toBeLessThan(0.06);
});

test('limits typed into the corners narrow the sweep, and stay with the rack', async ({ page }) => {
  await openPad(page, [RING]);
  await page.locator('#prismSource').selectOption({ label: 'Ring mod' });
  await page.locator('#prismXHi').fill('1000');
  await page.locator('#prismXHi').dispatchEvent('change');
  await drag(page, 0.999, 0.5);
  const { slot, pads } = await stored(page, 'r1');
  expect(slot.params.hz).toBeGreaterThan(950);
  expect(slot.params.hz).toBeLessThanOrEqual(1000);
  expect(pads.r1?.xHi).toBe(1000);
  // Back again later, the pad is set up as it was left.
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0);
  await page.evaluate(async () => {
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.locator('.dock-tab[data-dock="prism"]').click();
  await page.waitForFunction(() => (window.prismPad?.sources || []).length > 1);
  await page.locator('#prismSource').selectOption({ label: 'Ring mod' });
  await expect(page.locator('#prismXHi')).toHaveValue('1000');
});

test('double-click puts the dot back in the middle', async ({ page }) => {
  await openPad(page);
  await drag(page, 0.9, 0.9);
  await page.locator('#prismPad').dblclick();
  await page.waitForTimeout(200);
  const d = await page.evaluate(() => state.stretchDraft);
  expect(d.ratio).toBeGreaterThan(0.93);
  expect(d.ratio).toBeLessThan(1.07);
  expect(Math.abs(d.semitones)).toBeLessThan(0.6);
});

test('a take is drawn as a path, and LOOP wraps both of its lanes', async ({ page }) => {
  await openPad(page);
  await page.evaluate(async () => {
    const lane = (id, target, points) => ({ id, target, label: target, enabled: true, trim: 0, loop: null,
      modulators: [], points: points.map(([frame, value]) => ({ frame, value, curve: 'linear', tension: 0 })) });
    await postJSON('/api/automation', { p: state.selectedFile.path, bypassed: false, lanes: [
      lane('a', 'stretch.ratio', [[1000, 0.2], [9000, 0.8]]),
      lane('b', 'stretch.semitones', [[1000, 0.5], [5000, 0.9]]),
    ] });
    await loadAutomation();
    await prismLoadPath();
  });
  await expect(page.locator('#prismPad .prism-path polyline')).toHaveAttribute('points', /^(\S+ ){2}\S+$/);
  await page.locator('#prismLoop').click();
  await expect(page.locator('#prismLoop')).toHaveClass(/\bon\b/);
  const loops = await page.evaluate(async () => {
    const a = await api(`/api/automation?p=${encodeURIComponent(state.selectedFile.path)}`);
    return a.lanes.map((l) => l.loop);
  });
  expect(loops).toEqual([[1000, 9000], [1000, 9000]]);
});

test('REC arms the recorder for a take on the pad, and pressing it again disarms', async ({ page }) => {
  await openPad(page);
  await page.locator('#prismRec').click();
  await expect.poll(() => page.evaluate(async () => (await api('/api/automation/record')).mode)).toBe('latch');
  await expect(page.locator('#prismRec')).toHaveClass(/\barmed\b|\brecording\b/);
  await page.locator('#prismRec').click();
  await expect.poll(() => page.evaluate(async () => (await api('/api/automation/record')).mode)).toBe('off');
});

test('the new stereo and delay effects come to the pad with Hyperprism\'s pairs', async ({ page }) => {
  await openPad(page, [
    { id: 'm1', kind: 'prism:multi-delay', bypassed: false, params: {} },
    { id: 's1', kind: 'prism:stereo-matrix', bypassed: false, params: {} },
  ]);
  await expect(page.locator('#prismSource option')).toHaveText(['Time & Pitch', 'Pitch Time Changer', 'Multi Delay', 'Stereo Matrix']);
  await page.locator('#prismSource').selectOption({ label: 'Multi Delay' });
  await expect(page.locator('#prismX')).toHaveValue('delay1Ms');
  await expect(page.locator('#prismY')).toHaveValue('delay2Ms');
  await page.locator('#prismSource').selectOption({ label: 'Stereo Matrix' });
  await expect(page.locator('#prismX')).toHaveValue('rotate');
  await expect(page.locator('#prismY')).toHaveValue('sideGain');
  await drag(page, 0.999, 0.999);
  const { slot } = await stored(page, 's1');
  expect(slot.params.rotate).toBeGreaterThan(88);
  expect(slot.params.sideGain).toBeGreaterThan(1.45);
});

test('the SoundHack effects come to the pad with their pairs', async ({ page }) => {
  await openPad(page, [
    { id: 'd1', kind: 'prism:spectral-dynamics', bypassed: false, params: {} },
    { id: 'c1', kind: 'prism:convolution', bypassed: false, params: {} },
  ]);
  await page.locator('#prismSource').selectOption({ label: 'Spectral Dynamics' });
  await expect(page.locator('#prismX')).toHaveValue('thresholdDb');
  await expect(page.locator('#prismY')).toHaveValue('ratio');
  await page.locator('#prismSource').selectOption({ label: 'Convolution' });
  await expect(page.locator('#prismX')).toHaveValue('lengthMs');
  await expect(page.locator('#prismY')).toHaveValue('gainDb');
});


// ─────────────────────────────────────────── Hyperprism's own controls

test('the Pitch Time Changer is on the pad with Hyperprism\'s window and settings', async ({ page }) => {
  await openPad(page);
  await page.locator('#prismSource').selectOption({ label: 'Pitch Time Changer' });
  await expect(page.locator('#prismX')).toHaveValue('speed');
  await expect(page.locator('#prismY')).toHaveValue('pitch');
  await expect(page.locator('#prismXLo')).toHaveValue('1');
  await expect(page.locator('#prismXHi')).toHaveValue('200');
  await expect(page.locator('#prismYLo')).toHaveValue('0');
  await expect(page.locator('#prismYHi')).toHaveValue('200');
  // Its window's four settings, under the pad.
  const settings = page.locator('#prismSettings');
  await expect(settings.locator('.param .k')).toHaveText(['Feedback', 'Grain Size', 'X-Fade Size', 'Smoothing']);
  // Playing it is hearing it: a move turns it on.
  await drag(page, 0.75, 0.25);
  const pt = await page.evaluate(async () =>
    (await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`)).pitchTime);
  expect(pt.on).toBe(true);
  expect(pt.speed).toBeGreaterThan(140);
  expect(pt.speed).toBeLessThan(160);
  expect(pt.pitch).toBeGreaterThan(40);
  expect(pt.pitch).toBeLessThan(60);
  await expect(page.locator('#prismPtcOn')).toHaveClass(/\bon\b/);
  // And the switch turns it off again.
  await page.locator('#prismPtcOn').click();
  await page.waitForTimeout(300);
  const off = await page.evaluate(async () =>
    (await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`)).pitchTime);
  expect(off.on).toBe(false);
});

test('Playback Speed and the L, LR and R faders go to the engine', async ({ page }) => {
  await openPad(page);
  const sent = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/engine/transport')) sent.push(r.postDataJSON()); });
  // Hyperprism's slider: 0–255, the rate a 128th of it.
  const speed = page.locator('#prismSpeed');
  await expect(speed).toHaveAttribute('max', '255');
  await speed.evaluate((el) => { el.value = '192'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#prismSpeedRead')).toHaveText('150 %');
  // Hyperprism's faders: 0–255, gain 10^((36v/255 − 18)/20). LR sets both
  // sides to its own value.
  const lr = page.locator('#prismFaderLR');
  await expect(lr).toHaveAttribute('max', '255');
  await lr.evaluate((el) => { el.value = '85'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(400);
  expect(sent.some((b) => Math.abs(b.speed - 1.5) < 1e-9)).toBe(true);
  const last = sent.filter((b) => b.gainL !== undefined).at(-1);
  expect(last.gainL).toBeCloseTo(Math.pow(10, -6 / 20), 6);
  expect(last.gainR).toBeCloseTo(Math.pow(10, -6 / 20), 6);
  await expect(page.locator('#prismFaderL')).toHaveValue('85');
  await expect(page.locator('#prismFaderR')).toHaveValue('85');
  await expect(page.locator('#prismFaderLRRead')).toHaveText('−6.0 dB');
  // Return to zero is the slider's 128, as the original's buttons set it.
  await page.locator('#prismFaderZeroLR').click();
  await expect(lr).toHaveValue('128');
});

test('Post-Roll is kept per process and reaches the rack', async ({ page }) => {
  await openPad(page, [RING]);
  await page.locator('#prismSource').selectOption({ label: 'Ring mod' });
  await page.locator('#prismPostRoll').fill('750');
  await page.locator('#prismPostRoll').dispatchEvent('change');
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`));
  expect(r.postRoll.r1).toBe(750);
  await page.locator('#prismSource').selectOption({ label: 'Pitch Time Changer' });
  await expect(page.locator('#prismPostRoll')).toHaveValue('0');
});

test('Hyperprism\'s presets set the pad window and the settings, not the position', async ({ page }) => {
  await openPad(page);
  await page.locator('#prismSource').selectOption({ label: 'Pitch Time Changer' });
  const presets = page.locator('#prismPreset');
  await expect(presets.locator('option')).toHaveCount(1 + 10);
  const first = await presets.locator('option').nth(1).textContent();
  const want = await page.evaluate(async () => (await api('/api/pad/presets?kind=ptc')).factory[0]);
  await presets.selectOption({ label: first });
  await page.waitForTimeout(400);
  await expect(page.locator('#prismXLo')).toHaveValue(String(want.xLo));
  await expect(page.locator('#prismXHi')).toHaveValue(String(want.xHi));
  const pt = await page.evaluate(async () =>
    (await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`)).pitchTime);
  expect(pt.grain).toBe(want.settings.grain);
  // A preset of the user's own, saved, and offered next time.
  await page.locator('#prismPresetName').fill('Slow drift');
  await page.locator('#prismPresetSave').click();
  await page.waitForTimeout(300);
  await expect(presets.locator('option', { hasText: 'Slow drift' })).toHaveCount(1);
  await presets.selectOption({ label: 'Slow drift' });
  await page.locator('#prismPresetDelete').click();
  await page.waitForTimeout(300);
  await expect(presets.locator('option', { hasText: 'Slow drift' })).toHaveCount(0);
});
