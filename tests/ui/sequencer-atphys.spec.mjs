// Atmosphere's physically modelled oscillators in the page (atphys.js,
// atmos-worklet.js, atmos.wasm; RJ, 17 Nov 2026: "builds all of the modeled
// instruments"). The models themselves are tested natively
// (core/crates/atmos/tests/models.rs); here: they are on the page, a key and
// MIDI play them, every one sounds, and the controls reach them.

import { test, expect } from './test.mjs';

async function open(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof atphysAttach === 'function' && !!document.getElementById('atPicA'));
  await page.evaluate(() => document.body.classList.add('only-atmos'));
}

/// Play key 60 on Atmosphere and read what leaves it, after `setup`.
async function level(page, setup = '') {
  return page.evaluate(async (setup) => {
    initAudio();
    await audioCtx.resume();
    for (let k = 0; k < 100 && !(ATPHYS.ready && atphysUp()); k++) await new Promise((r) => setTimeout(r, 50));
    new Function(setup)();
    atmosRead();
    const an = audioCtx.createAnalyser();
    an.fftSize = 4096;
    atOut.connect(an);
    kyNoteOn('atmos', 60, 0.9);
    await new Promise((r) => setTimeout(r, 400));
    const d = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(d);
    kyNoteOff('atmos', 60);
    atOut.disconnect(an);
    await new Promise((r) => setTimeout(r, 300));
    return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
  }, setup);
}

test('the engine is served, and each oscillator offers the ten models', async ({ page, request }) => {
  for (const f of ['atphys.js', 'atmos-worklet.js', 'atmos.wasm']) expect((await request.get(`/sequencer/${f}`)).status(), f).toBe(200);
  await open(page);
  for (const w of ['A', 'B']) {
    await expect(page.locator(`.at-oscbox[data-osc="${w}"] .at-osc[data-model]`)).toHaveCount(10);
    await expect(page.locator(`#atPic${w}`)).toBeVisible();
  }
  // A card sets the model and its own controls.
  await page.locator('.at-oscbox[data-osc="A"] .at-osc[data-model="bow"]').click();
  expect(await page.evaluate(() => [AT.modelA, document.getElementById('atMA1Label').textContent, document.getElementById('atMA2Label').textContent])).toEqual(['bow', 'Pressure', 'Speed']);
  await expect(page.locator('#atAWhat')).toContainText('Bowed string');
});

test('a key plays the physically modelled voice, and every model sounds', async ({ page }) => {
  await open(page);
  const quiet = [];
  for (const m of ['pluck', 'bow', 'bar', 'bell', 'glass', 'membrane', 'pipe', 'reed', 'voice', 'classic']) {
    const r = await level(page, `document.getElementById('atModelASelect').value = '${m}'; document.getElementById('atModelBSelect').value = '${m}';`);
    if (!(r > 0.002)) quiet.push(`${m}: ${r}`);
  }
  expect(quiet).toEqual([]);
  // It was the engine, not the old browser voice.
  expect(await page.evaluate(() => ATPHYS.ready && atphysUp() && atVoices.length === 0)).toBe(true);
});

test('its controls reach the engine: Volume, and its own filter', async ({ page }) => {
  await open(page);
  const base = await level(page, "document.getElementById('atModelASelect').value = 'classic'; document.getElementById('atModelBSelect').value = 'classic'; document.getElementById('atVolSlider').value = 70; document.getElementById('atFltCutSlider').value = 100;");
  const silent = await level(page, "document.getElementById('atVolSlider').value = 0;");
  const shut = await level(page, "document.getElementById('atVolSlider').value = 70; document.getElementById('atFltCutSlider').value = 0;");
  expect(base).toBeGreaterThan(0.002);
  expect(silent).toBeLessThan(base * 0.02);
  expect(shut).toBeLessThan(base * 0.3);
});

test('MIDI on Atmosphere\'s channel plays the engine', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    initAudio();
    await audioCtx.resume();
    for (let k = 0; k < 100 && !(ATPHYS.ready && atphysUp()); k++) await new Promise((r) => setTimeout(r, 50));
  });
  await page.request.post('/api/engine/midi/inject', { data: { msg: [0x90 | 2, 64, 100] } });
  await expect.poll(() => page.evaluate(() => ATPHYS.view?.n || 0), { timeout: 5000 }).toBeGreaterThan(0);
  await page.request.post('/api/engine/midi/inject', { data: { msg: [0x80 | 2, 64, 0] } });
});
