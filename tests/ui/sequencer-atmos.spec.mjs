// The scale sequencer's second synth, Atmosphere (`ui/sequencer/atmos.js`).
//
// Notes are rendered offline, as the film does it, with the delay, Space and
// the LFOs out and the filter open, so what is measured is the voice:
// - it plays the true pitch the scale asks for, not a 12-TET one;
// - Scale spectrum moves its partials onto the scale's intervals by Fit;
// - every kind of oscillator sounds, at about the same level;
// - Freeze holds the space and cannot run away;
// - Classic is the synth as it was, and Space starts dry;
// - presets carry Atmosphere, and a film renders it.

import { test, expect } from './test.mjs';

async function openSeq(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof atmosRead === 'function' && !!document.getElementById('atModeSeg'));
  await page.evaluate(() => {
    // One note, offline, dry; `setup` sets the controls and plays.
    window.__atRender = async (setup, secs = 2.5, after) => {
      const Real = window.AudioContext, rate = 48000;
      const off = new OfflineAudioContext(2, Math.round(secs * rate), rate);
      off.createMediaStreamDestination = () => off.createGain();
      window.AudioContext = function () { return off; };
      audioCtx = null;
      try { initAudio(); } finally { window.AudioContext = Real; }
      if (delayWetGain) delayWetGain.gain.value = 0;
      cutoffBaseNode.offset.value = 20000;
      filterNode.Q.value = 0.0001;
      lfos.forEach((l) => { if (l.gainNode) l.gainNode.gain.value = 0; });
      setup();
      if (after) after(off);
      const buf = await off.startRendering();
      audioCtx = null;
      return { x: buf.getChannelData(0), rate };
    };
    window.__set = (id, v) => { document.getElementById(id).value = v; };
    // A plain, still voice: one oscillator, no spread, drift, sub or air, held.
    window.__base = () => {
      __set('atModeSelect', 'atmos');
      for (const [k, v] of Object.entries({ atUnisonSlider: 1, atDetuneSlider: 0, atDriftSlider: 0, atWidthSlider: 0, atSubSlider: 0, atAirSlider: 0, atHoldSlider: 400, atGlideSlider: 0, atAtkSlider: 0, atDecSlider: 0, atSusSlider: 100, atRelSlider: 0, atVolSlider: 100, atBlendSlider: 0, atEnsSlider: 0, atWowSlider: 0, atWarmSlider: 0, atSymSlider: 0, atAOctSlider: 0, atRevWetSlider: 0 })) __set(k, v);
      bpm = 60; stepBeats = 0.5; // a step is 0.5 s; Hold 4× makes a note 2 s
    };
    window.__rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
    window.__db = (x, rate, a, b) => 20 * Math.log10(__rms(x, Math.round(a * rate), Math.round(b * rate)) + 1e-12);
    // Where, in cents from `hz`, the strongest frequency near it is (Hann-windowed bins).
    window.__peakCents = (x, rate, a, b, hz, span, step) => {
      const A = Math.round(a * rate), n = Math.round(b * rate) - A;
      let best = -1, at = 0;
      for (let c = -span; c <= span; c += step) {
        const w = 2 * Math.PI * hz * Math.pow(2, c / 1200) / rate;
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) { const v = x[A + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))); re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
        const p = re * re + im * im;
        if (p > best) { best = p; at = c; }
      }
      return at;
    };
  });
}

test('Atmosphere is served and on the page: its power, eight kinds twice, Space, its LFO targets; Classic alone first, then both together', async ({ page, request }) => {
  expect((await request.get('/sequencer/atmos.js')).status()).toBe(200);
  expect((await request.get('/sequencer/look.js')).status()).toBe(200);
  await openSeq(page);
  const state = () => page.evaluate(() => ({
    mode: document.getElementById('atModeSelect').value, classic: classicOn, atmos: atmosOn,
    lit: [...document.querySelectorAll('.power[data-syn]')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.syn),
    shown: getComputedStyle(document.querySelector('.at-row')).display,
  }));
  const got = await page.evaluate(() => ({
    cards: document.querySelectorAll('.at-osc').length,
    space: document.querySelectorAll('.at-space .knob-group').length,
    targets: [...document.getElementById('lfo1TargetSelect').options].map((o) => o.value).filter((v) => v.startsWith('at-')),
  }));
  expect(got).toEqual({ cards: 16, space: 7, targets: ['at-detune', 'at-pan', 'at-air', 'at-blend', 'at-vowel', 'at-fit'] });
  expect(await state()).toEqual({ mode: 'classic', classic: true, atmos: false, lit: ['classic'], shown: 'none' });
  // Atmosphere on: both play.
  await page.click('.power[data-syn="atmos"]');
  expect(await state()).toEqual({ mode: 'both', classic: true, atmos: true, lit: ['classic', 'atmos'], shown: 'grid' });
  // Classic off: Atmosphere alone; and the last one on cannot be turned off.
  await page.click('.power[data-syn="classic"]');
  await page.click('.power[data-syn="atmos"]');
  expect(await state()).toEqual({ mode: 'atmos', classic: false, atmos: true, lit: ['atmos'], shown: 'grid' });
  await page.click('.at-oscbox[data-osc="A"] .at-osc[data-kind="glass"]');
  expect(await page.evaluate(() => [AT.kindA, document.getElementById('atA1Label').textContent])).toEqual(['glass', 'Material']);
});

test('with both synths on, a note plays both: louder than either alone', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(async () => {
    const at = async (mode) => {
      const r = await __atRender(() => { __base(); __set('atModeSelect', mode); __set('atKindASelect', 'classic'); __set('atA1Slider', 0); atmosRead(); playNote(220, 0.05); });
      return { db: __db(r.x, r.rate, 0.12, 0.35), voices: atVoices.length };
    };
    return { classic: await at('classic'), atmos: await at('atmos'), both: await at('both') };
  });
  expect(got.classic.voices, 'Classic alone made Atmosphere voices').toBe(0);
  expect(got.atmos.voices).toBeGreaterThan(0);
  expect(got.both.voices).toBeGreaterThan(0);
  expect(got.both.db).toBeGreaterThan(got.classic.db + 1);
  expect(got.both.db).toBeGreaterThan(got.atmos.db + 1);
});

test('true pitch: a note on a degree of a just scale is exactly the frequency the scale gives it', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(async () => {
    selectScale(SCALES.findIndex((s) => /Pythagorean/.test(s.name)));
    const hz = getFreqForDegree(3);
    const r = await __atRender(() => { __base(); __set('atKindASelect', 'classic'); __set('atA1Slider', 0); atmosRead(); playNote(hz, 0.05); });
    return { hz, off: __peakCents(r.x, r.rate, 0.5, 1.9, hz, 20, 0.25) };
  });
  // To the quarter cent: no rounding to 12-TET anywhere on the way.
  expect(Math.abs(got.off)).toBeLessThanOrEqual(0.25);
});

test('Scale spectrum puts its partials on the scale by Fit: the 7th harmonic moves 69¢ onto Major Pentatonic', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(async () => {
    selectScale(SCALES.findIndex((s) => s.name === 'Major Pentatonic'));
    const at = async (fit) => {
      const r = await __atRender(() => { __base(); __set('atKindASelect', 'spectrum'); __set('atA1Slider', fit); __set('atA2Slider', 100); __set('atA3Slider', 30); atmosRead(); playNote(110, 0.05); });
      return __peakCents(r.x, r.rate, 0.5, 1.9, 770, 100, 0.5);
    };
    return { fit0: await at(0), fit100: await at(100), expected: 3300 - 1200 * Math.log2(7) };
  });
  expect(Math.abs(got.fit0)).toBeLessThanOrEqual(1);
  expect(Math.abs(got.fit100 - got.expected)).toBeLessThanOrEqual(1);
});

test('every kind of oscillator sounds, within 6 dB of Classic', async ({ page }) => {
  test.setTimeout(90_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    const out = {};
    for (const kind of AT_KIND_IDS) {
      const r = await __atRender(() => { __base(); __set('atKindASelect', kind); __set('atA1Slider', kind === 'classic' ? 0 : 50); __set('atA2Slider', 50); __set('atA3Slider', 50); atmosRead(); playNote(220, 0.05); });
      out[kind] = __db(r.x, r.rate, 0.6, 1.8);
    }
    return out;
  });
  for (const [kind, db] of Object.entries(got)) expect(Math.abs(db - got.classic), `${kind} at ${db.toFixed(1)} dB`).toBeLessThanOrEqual(6);
});

test('Freeze holds the space and fades it slowly; it never grows', async ({ page }) => {
  test.setTimeout(90_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    const r = await __atRender(() => { __base(); __set('atKindASelect', 'classic'); __set('atA1Slider', 70); __set('atHoldSlider', 100); __set('atRevWetSlider', 60); __set('atRevSizeSlider', 70); atmosRead(); playNote(330, 0.05); }, 20, () => {
      atRev.gate.gain.setValueAtTime(0, 1.0); atRev.frzIn.gain.setValueAtTime(0.7, 1.0); atRev.frzFb.gain.setValueAtTime(AT_FREEZE_FB, 1.0);
    });
    let peak = 0;
    for (const v of r.x) peak = Math.max(peak, Math.abs(v));
    return { w: [[6, 8], [9, 11], [12, 14], [15, 17], [17.5, 19.5]].map(([a, b]) => __db(r.x, r.rate, a, b)), peak };
  });
  for (let i = 1; i < got.w.length; i++) expect(got.w[i], `window ${i}`).toBeLessThanOrEqual(got.w[i - 1] + 0.2);
  expect(got.w.at(-1), 'it held something').toBeGreaterThan(-70);
  expect(got.peak).toBeLessThan(0.5);
});

test('Space starts dry, and Classic is the synth as it was', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(async () => {
    const r = await __atRender(() => { __set('atModeSelect', 'classic'); atmosRead(); bpm = 60; stepBeats = 0.5; playNote(220, 0.05); });
    return { wet: AT.atRevWet, voices: atVoices.length, db: __db(r.x, r.rate, 0.1, 0.4) };
  });
  expect(got.wet).toBe(0);
  expect(got.voices, 'Classic made Atmosphere voices').toBe(0);
  expect(got.db).toBeGreaterThan(-60);
});

test('a preset carries Atmosphere: the mode, the kinds and the knobs come back', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    atmosStart('scale-bells');
    const saved = getPresetState();
    atmosStart('dark-drone');
    __set('atModeSelect', 'classic'); atmosRead();
    applyPresetState(saved);
    return { mode: AT.mode, a: AT.kindA, b: AT.kindB, a1: AT.atA1, inState: 'atModeSelect' in saved.selects && 'atA1Slider' in saved.sliders };
  });
  expect(got).toEqual({ mode: 'both', a: 'glass', b: 'spectrum', a1: 90, inState: true });
});

test('a film renders Atmosphere, through the request the film makes', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const frame = page.frames().find((f) => f.url().includes('/sequencer/'));
  await frame.evaluate(() => atmosStart('glass-choir'));
  const loud = await page.evaluate(async () => {
    const r = await seqRenderForFilm({ at0: 0, seconds: 1.5, rate: 48000, fps: 30, bands: 32, lo: 20, hi: 20000, liss: 64 });
    let m = 0;
    for (let i = 0; i < r.left.length; i++) m = Math.max(m, Math.abs(r.left[i]), Math.abs(r.right[i]));
    return m;
  });
  expect(loud, 'the film is silent in Atmosphere').toBeGreaterThan(0.005);
  expect(await frame.evaluate(() => atmosOn)).toBe(true);
});
