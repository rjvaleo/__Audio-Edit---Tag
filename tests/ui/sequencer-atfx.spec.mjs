// Atmosphere's own filter and effects (RJ, 16 Nov 2026: "it should have its
// own filter … it's its own synth"; "right click, insert effects … all the
// effects … like I can on the grain page").
//
// - its filter is its own, one per voice: Seq's filter does not touch it;
// - the FX line inserts any of the app's effects, from a right-click;
// - the effect really runs: the engine's rack, built for the browser, in an
//   AudioWorklet, changes what Atmosphere sounds like;
// - a module opens a window with every control; the chain is kept.

import { test, expect } from './test.mjs';

async function openAtmos(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof atfxBuild === 'function' && !!document.getElementById('atFxLine'));
  await page.evaluate(() => { try { localStorage.removeItem('atmos.fx'); } catch {} document.body.classList.add('only-atmos'); });
  await page.waitForFunction(() => ATFX.suites.length > 5);
}

test('the effects are served, and the browser build makes every mode the suites list', async ({ page, request }) => {
  for (const f of ['atfx.js', 'atfx-worklet.js', 'atfx.wasm']) expect((await request.get(`/sequencer/${f}`)).status(), f).toBe(200);
  await openAtmos(page);
  const got = await page.evaluate(async () => {
    const bytes = await (await fetch('atfx.wasm')).arrayBuffer();
    const x = (await WebAssembly.instantiate(bytes, {})).instance.exports;
    x.fx_init(48000);
    const kinds = ATFX.suites.flatMap((s) => s.families.flatMap((f) => f.modes.map((m) => m.kind)));
    const bad = [];
    for (const k of kinds) {
      const b = new TextEncoder().encode(k);
      new Uint8Array(x.memory.buffer, x.fx_text(), 256).set(b);
      if (x.fx_push(b.length, 0) < 0) bad.push(k);
    }
    return { n: kinds.length, bad };
  });
  expect(got.n).toBeGreaterThan(80);
  expect(got.bad).toEqual([]);
});

test('right-click inserts an effect; it opens with its controls; it is kept', async ({ page }) => {
  await openAtmos(page);
  await page.locator('#atFxLine').click({ button: 'right', position: { x: 400, y: 20 } });
  await page.locator('.atfx-menu .atfx-mi', { hasText: 'Reverb' }).hover();
  await page.locator('.atfx-menu').nth(1).locator('.atfx-mi', { hasText: 'Network' }).hover();
  await page.locator('.atfx-menu').nth(2).locator('.atfx-mi', { hasText: 'Mesh 16' }).click();
  await expect(page.locator('.atfx-tile')).toHaveCount(1);
  await expect(page.locator('.atfx-tile b')).toHaveText('Mesh 16');
  await expect(page.locator('#atFxWin')).toBeVisible();
  // Every one of Mesh 16's controls, then Mix and Level.
  const own = await page.evaluate(() => ATFX.shapers['prism:sm-gemini'].params.length);
  expect(own).toBeGreaterThan(5);
  expect(await page.locator('#atFxWin .knob-group').count()).toBe(own + 2);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('atmos.fx')))[0].kind).toBe('prism:sm-gemini');
  expect(JSON.parse(await page.locator('#atFxChain').inputValue())[0].kind).toBe('prism:sm-gemini');
  await page.keyboard.press('Escape');
  await expect(page.locator('#atFxWin')).toHaveCount(0);
  // A second, before it, from the module's own menu; then it goes.
  await page.locator('.atfx-tile').click({ button: 'right' });
  await page.locator('.atfx-menu .atfx-mi', { hasText: 'Insert effect before' }).hover();
  await page.locator('.atfx-menu').nth(1).locator('.atfx-mi', { hasText: 'Saturation' }).hover();
  await page.locator('.atfx-menu').nth(2).locator('.atfx-mi').first().hover();
  const sat = page.locator('.atfx-menu').nth(2).locator('.atfx-mi').first();
  if (await page.locator('.atfx-menu').nth(3).count()) await page.locator('.atfx-menu').nth(3).locator('.atfx-mi').first().click();
  else await sat.click();
  await expect(page.locator('.atfx-tile')).toHaveCount(2);
  await expect(page.locator('.atfx-tile').nth(1).locator('b')).toHaveText('Mesh 16');
  await page.keyboard.press('Escape');
  await page.locator('.atfx-tile').first().click({ button: 'right' });
  await page.locator('.atfx-menu .atfx-mi', { hasText: 'Remove' }).click();
  await expect(page.locator('.atfx-tile')).toHaveCount(1);
});

test('the effect runs on Atmosphere\'s sound: a reverb leaves a tail the dry voice has not', async ({ page }) => {
  await openAtmos(page);
  const tail = async (chain) => page.evaluate(async (chain) => {
    ATFX.chain = chain;
    atfxLaid();
    initAudio();
    await audioCtx.resume();
    // The worklet up and laid.
    for (let k = 0; k < 100 && !ATFX.nodes.some((n) => n.context === audioCtx); k++) await new Promise((r) => setTimeout(r, 50));
    atfxSend({ t: 'chain', slots: ATFX.chain });
    await new Promise((r) => setTimeout(r, 200));
    const an = audioCtx.createAnalyser();
    an.fftSize = 2048;
    melBus.connect(an);
    const t = audioCtx.currentTime + 0.05;
    atmosPlay(440, t, 0.15, { atk: 0.002, rel: 0.02 });
    // Well after the note and its release: what is left.
    await new Promise((r) => setTimeout(r, 900));
    const d = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(d);
    melBus.disconnect(an);
    return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
  }, chain);
  const dry = await tail([]);
  const wet = await tail([{ kind: 'prism:sm-gemini', on: true, params: { mix: 100, feedback: 90 }, wet: 100, level: 0 }]);
  // Dry, only Sympathy's last ring is left; through the reverb, far more.
  expect(dry).toBeLessThan(0.005);
  expect(wet, `dry ${dry}, wet ${wet}`).toBeGreaterThan(dry * 5);
});

test('Atmosphere\'s filter is its own: Seq\'s cutoff leaves it alone, its own closes it', async ({ page }) => {
  await openAtmos(page);
  const level = async (setup) => page.evaluate(async (setup) => {
    initAudio();
    await audioCtx.resume();
    eval(setup);
    atmosRead();
    const an = audioCtx.createAnalyser();
    an.fftSize = 4096;
    melBus.connect(an);
    atmosPlay(880, audioCtx.currentTime + 0.02, 0.6, { atk: 0.002 });
    await new Promise((r) => setTimeout(r, 350));
    const d = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(d);
    melBus.disconnect(an);
    for (const v of atVoices) atStealOldest(v, audioCtx.currentTime);
    await new Promise((r) => setTimeout(r, 300));
    return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
  }, setup);
  const open = await level("document.getElementById('atFltCutSlider').value = 100; document.getElementById('cutoffSlider').value = 67; updateFilter();");
  const seqShut = await level("document.getElementById('cutoffSlider').value = 0; updateFilter();");
  const ownShut = await level("document.getElementById('cutoffSlider').value = 67; updateFilter(); document.getElementById('atFltCutSlider').value = 0;");
  expect(open).toBeGreaterThan(0.001);
  // Seq's filter shut: Atmosphere as loud as before.
  expect(seqShut).toBeGreaterThan(open * 0.7);
  // Its own shut: far quieter.
  expect(ownShut).toBeLessThan(open * 0.3);
});
