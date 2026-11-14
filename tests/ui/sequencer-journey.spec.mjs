// The scale sequencer's 64 steps, its Journey (`ui/sequencer/journey.js`) and
// its scopes (`ui/sequencer/scopes.js`).
//
// - 64 steps in four rows; a picked step's buttons and the arrow keys edit it;
//   a preset of 16 fills the first row; Copy row 1 fills the rest;
// - the Journey is worked out, not rolled: off, every step is as written; on,
//   the same seed gives the same notes, a boundary read on its own (a seek)
//   gives what playing up to it gave, and with Come home the trip ends on the
//   pattern as written; a film renders the trip;
// - each scope hears its own oscillator and nothing else; the output hears both.

import { test, expect } from './test.mjs';

async function openSeq(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof journeyStep === 'function' && typeof scopesInit === 'function' && !!document.getElementById('jOnSelect'));
  await page.evaluate(() => {
    window.__set = (id, v) => { const el = document.getElementById(id); el.value = v; };
    // The trip as notes: degree/rest for every boundary in `n`, from `k0`.
    window.__trip = (k0, n) => Array.from({ length: n }, (_, j) => {
      const k = k0 + j, s = journeyStep(k, k % numSteps);
      return s.rest ? 'r' : `${s.degree}${s.freq ? '@' + s.freq.toFixed(2) : ''}${s.double ? 'x2' : ''}${s.hold > 1 ? 't' : ''}`;
    }).join(' ');
  });
}

test('64 steps in four rows: a picked step opens its buttons, the keys edit it, a 16-step preset fills the first row', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => ({
    max: document.getElementById('stepsSlider').max, steps: steps.length,
    cards: document.querySelectorAll('#stepGrid .step').length,
    rows: [...document.querySelectorAll('.step-row-label')].map((e) => e.textContent),
  }));
  expect(got).toEqual({ max: '64', steps: 64, cards: 64, rows: ['1–16', '17–32', '33–48', '49–64'] });
  await page.click('#step-37');
  expect(await page.evaluate(() => [pickedStep, getComputedStyle(document.querySelector('#step-37 .step-btns')).display])).toEqual([37, 'grid']);
  const before = await page.evaluate(() => steps[37].degree);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  const len = await page.evaluate(() => SCALES[selectedScaleIdx].cents.length);
  expect(await page.evaluate(() => steps[37].degree)).toBe(Math.min(len * 4 - 1, (Math.floor(before / len) + 1) * len + ((before % len) + 1) % len));
  // A preset saved with 16 steps fills the first row and leaves the rest.
  const kept = await page.evaluate(() => {
    steps[40].degree = 5;
    const st = getPresetState();
    st.steps = st.steps.slice(0, 16).map((s) => ({ degree: 2, rest: false }));
    applyPresetState(st);
    return [steps[0].degree, steps[15].degree, steps[40].degree];
  });
  expect(kept).toEqual([2, 2, 5]);
  await page.click('button:text("Copy row 1 to all")');
  expect(await page.evaluate(() => steps.every((s, i) => s.degree === steps[i % 16].degree && s.rest === steps[i % 16].rest))).toBe(true);
});

test('the Journey off plays the steps as written; on, the same seed plays the same trip, and a seek lands where playing got to', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    numSteps = 16; stepBeats = 0.5;
    __set('jLenSelect', '16'); __set('jSeedSlider', 4127); journeyRead();
    const written = __trip(0, 128);
    __set('jOnSelect', 'on'); journeyRead();
    const a = __trip(0, 128);
    jPlanKey = ''; // forget the plan: worked out again from the seed
    const b = __trip(0, 128);
    // A seek: boundary 77 on its own, after reading somewhere else first.
    __trip(300, 5);
    const seek = __trip(77, 1);
    __set('jSeedSlider', 9001); journeyRead();
    const other = __trip(0, 128);
    __set('jOnSelect', 'off'); journeyRead();
    return { written, a, b, seek, at77: a.split(' ')[77], other, offAgain: __trip(0, 128) };
  });
  expect(got.a, 'the Journey on changed nothing').not.toBe(got.written);
  expect(got.b, 'the same seed played another trip').toBe(got.a);
  expect(got.seek).toBe(got.at77);
  expect(got.other, 'another seed played the same trip').not.toBe(got.a);
  expect(got.offAgain).toBe(got.written);
});

test('with Come home the trip ends on the pattern as written, having gone furthest at the Peak', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    numSteps = 16; stepBeats = 0.5;
    __set('jOnSelect', 'on'); __set('jLenSelect', '16'); __set('jEachSlider', 6); __set('jKhomeSelect', 'on'); journeyRead();
    const trip = jTripSteps(); // 16 bars of 4 beats, 8 steps a bar: 128
    const moved = (k) => journeyWhere(k).a;
    return { trip, start: moved(0), peak: moved(Math.round(trip * 0.85)), end: moved(trip - 1), total: journeyPlan(0).length };
  });
  expect(got.trip).toBe(128);
  expect(got.start).toBe(0);
  expect(got.peak).toBe(got.total);
  expect(got.end, 'not home at the end of the trip').toBe(0);
});

test('a film renders the Journey: on, it plays other notes than off, and the same trip twice', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const frame = page.frames().find((f) => f.url().includes('/sequencer/'));
  await frame.evaluate(() => {
    const set = (id, v) => { document.getElementById(id).value = v; };
    set('jLenSelect', '16'); set('jEachSlider', 8); set('jSeedSlider', 321); set('jC1Slider', 100);
    journeyRead();
    // The notes the render plays, in order. The app sets the tempo between
    // renders, so when they fall is not compared; which they are is.
    window.__notes = [];
    const play = window.seqPlayAt;
    window.seqPlayAt = (st, t, d) => { const f = play(st, t, d); __notes.push(f.toFixed(2)); return f; };
  });
  const render = async () => {
    await frame.evaluate(() => { __notes = []; });
    await page.evaluate(() => seqRenderForFilm({ at0: 0, seconds: 4, rate: 24000, fps: 10, bands: 16, lo: 20, hi: 20000, liss: 32 }));
    return frame.evaluate(() => __notes.slice(0, 12).join(' '));
  };
  const off = await render();
  await frame.evaluate(() => { document.getElementById('jOnSelect').value = 'on'; journeyRead(); });
  const on1 = await render();
  const on2 = await render();
  expect(off.split(' ').length).toBe(12);
  expect(on1, 'the film did not hear the Journey').not.toBe(off);
  expect(on2, 'the same trip rendered other notes').toBe(on1);
});

test('each scope hears its own oscillator: Classic alone in its own and the output, A and B in theirs', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(async () => {
    const listen = async (mode) => {
      const Real = window.AudioContext, rate = 48000;
      const off = new OfflineAudioContext(2, rate, rate);
      off.createMediaStreamDestination = () => off.createGain();
      window.AudioContext = function () { return off; };
      audioCtx = null;
      try { initAudio(); } finally { window.AudioContext = Real; }
      __set('atModeSelect', mode); __set('atAtkSlider', 0); __set('atRevWetSlider', 0); atmosRead();
      bpm = 60; stepBeats = 0.5;
      playNote(220, 0.05);
      const peaks = {};
      off.suspend(0.3).then(() => {
        for (const k of ['classic', 'A', 'B', 'out']) {
          const b = new Float32Array(2048);
          scopeNodes[k].getFloatTimeDomainData(b);
          peaks[k] = b.reduce((m, v) => Math.max(m, Math.abs(v)), 0) > 0.001;
        }
        off.resume();
      });
      await off.startRendering();
      audioCtx = null;
      return peaks;
    };
    return { classic: await listen('classic'), atmos: await listen('atmos') };
  });
  expect(got.classic).toEqual({ classic: true, A: false, B: false, out: true });
  expect(got.atmos).toEqual({ classic: false, A: true, B: true, out: true });
  // And they are on the page: Classic's, A's, B's and the output's.
  expect(await page.evaluate(() => ['scopeClassic', 'scopeA', 'scopeB', 'scopeOut'].map((id) => !!document.getElementById(id)))).toEqual([true, true, true, true]);
});
