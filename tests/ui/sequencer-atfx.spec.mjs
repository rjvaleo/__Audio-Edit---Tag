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

/// A note on Atmosphere's engine (the physically modelled voice), as a key plays
/// it: started now, let go after `dur` seconds.
const ENGINE_NOTE = `async (hz, dur) => {
  for (let k = 0; k < 100 && !(ATPHYS.ready && atphysUp()); k++) await new Promise((r) => setTimeout(r, 50));
  atphysSend(true);
  const v = atphysOn(77, hz, 0.9);
  setTimeout(() => v.release(audioCtx.currentTime), dur * 1000);
}`;

async function openAtmos(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof atfxBuild === 'function' && !!document.getElementById('atFxLine'));
  await page.evaluate(() => { try { localStorage.removeItem('atmos.fx'); } catch {} document.body.classList.add('only-atmos'); });
  // A still voice, so a level read twice reads the same: one oscillator, no
  // drift, air, ensemble, wow, sub or sympathy.
  await page.evaluate(() => { for (const [k, v] of Object.entries({ atUnison: 1, atDrift: 0, atAir: 0, atEns: 0, atWow: 0, atSym: 0, atSub: 0, atWidth: 0, atAtk: 0, atRel: 0, atBlend: 0 })) document.getElementById(k + 'Slider').value = v; atmosRead(); });
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
  const tail = async (chain) => page.evaluate(async ([chain, ENGINE]) => {
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
    atOut.connect(an);
    await (eval(ENGINE)(440, 0.15));
    // Well after the note and its release: what is left.
    await new Promise((r) => setTimeout(r, 900));
    const d = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(d);
    atOut.disconnect(an);
    return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
  }, [chain, ENGINE_NOTE]);
  const dry = await tail([]);
  const wet = await tail([{ kind: 'prism:sm-gemini', on: true, params: { mix: 100, feedback: 90 }, wet: 100, level: 0 }]);
  // Dry, only Sympathy's last ring is left; through the reverb, far more.
  expect(dry).toBeLessThan(0.005);
  expect(wet, `dry ${dry}, wet ${wet}`).toBeGreaterThan(dry * 5);
});

test('Atmosphere\'s filter is its own: Seq\'s cutoff leaves it alone, its own closes it', async ({ page }) => {
  await openAtmos(page);
  const level = async (setup) => page.evaluate(async ([setup, ENGINE]) => {
    initAudio();
    await audioCtx.resume();
    // A plain wave, so what is heard is the filter, not a string's thump.
    document.getElementById('atModelASelect').value = 'classic';
    eval(setup);
    atmosRead();
    const an = audioCtx.createAnalyser();
    an.fftSize = 4096;
    atOut.connect(an);
    await (eval(ENGINE)(880, 0.6));
    await new Promise((r) => setTimeout(r, 350));
    const d = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(d);
    atOut.disconnect(an);
    await new Promise((r) => setTimeout(r, 500));
    return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
  }, [setup, ENGINE_NOTE]);
  const open = await level("document.getElementById('atFltCutSlider').value = 100; document.getElementById('cutoffSlider').value = 67; updateFilter();");
  const seqShut = await level("document.getElementById('cutoffSlider').value = 0; updateFilter();");
  const ownShut = await level("document.getElementById('cutoffSlider').value = 67; updateFilter(); document.getElementById('atFltCutSlider').value = 0;");
  expect(open).toBeGreaterThan(0.001);
  // Seq's filter shut: Atmosphere as loud as before.
  expect(seqShut).toBeGreaterThan(open * 0.7);
  // Its own shut: far quieter.
  expect(ownShut).toBeLessThan(open * 0.3);
});

// ─── A SYNTH OF ITS OWN ──────────────────────────────────────────────────────
// RJ, 16 Nov 2026: "completely its own synth … its own MIDI channel, its own
// filter section, its own amplitude section, its own effects section … its own
// volume … nothing to do with anything else", with its own LFOs and tuning.

/// Atmosphere's level where everything meets (the master), during a note and
/// in its tail, after `setup` has run.
async function atLevel(page, setup) {
  return page.evaluate(async ([setup, ENGINE]) => {
    initAudio();
    await audioCtx.resume();
    for (let k = 0; k < 60 && !ATFX.nodes.some((n) => n.context === audioCtx); k++) await new Promise((r) => setTimeout(r, 50));
    new Function(setup)();
    atmosRead();
    const an = audioCtx.createAnalyser();
    an.fftSize = 4096;
    masterGain.connect(an);
    const rms = () => { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length); };
    await (eval(ENGINE)(440, 0.6));
    let during = 0;
    await new Promise((r) => setTimeout(r, 150));
    for (let k = 0; k < 5; k++) { during += rms() / 5; await new Promise((r) => setTimeout(r, 60)); }
    await new Promise((r) => setTimeout(r, 900));
    const tail = rms();
    masterGain.disconnect(an);
    return { during, tail };
  }, [setup, ENGINE_NOTE]);
}
const SEQ_RESET = "updateVol(70); document.getElementById('cutoffSlider').value = 67; updateFilter(); document.getElementById('delayWetSlider').value = 0; document.getElementById('delayFbSlider').value = 0; updateDelay(); document.getElementById('atRevWetSlider').value = 0; document.getElementById('atVolSlider').value = 70;";

test('nothing of Seq\'s synth reaches it: Seq\'s volume, filter, delay and Space leave Atmosphere as it is', async ({ page }) => {
  await openAtmos(page);
  // A first note, not measured: the first on a fresh page reads quieter than
  // the next, by about 5 % on the MacBook (19 Nov, ten runs) and by enough on
  // GitHub's runner that the case after it read 1.27 and 1.37 times as loud.
  await atLevel(page, SEQ_RESET);
  const base = await atLevel(page, SEQ_RESET);
  expect(base.during).toBeGreaterThan(0.002);
  const cases = {
    'Seq volume 0': SEQ_RESET + "updateVol(0);",
    'Seq cutoff shut': SEQ_RESET + "document.getElementById('cutoffSlider').value = 0; updateFilter();",
    'Seq delay full': SEQ_RESET + "document.getElementById('delayWetSlider').value = 100; document.getElementById('delayFbSlider').value = 90; updateDelay();",
    'Space full': SEQ_RESET + "document.getElementById('atRevWetSlider').value = 100;",
  };
  for (const [name, setup] of Object.entries(cases)) {
    const got = await atLevel(page, setup);
    expect(got.during / base.during, `${name}: during the note`).toBeGreaterThan(0.8);
    expect(got.during / base.during, `${name}: during the note`).toBeLessThan(1.25);
    // No echo, no reverb tail from Seq's effects.
    expect(got.tail, `${name}: its tail`).toBeLessThan(Math.max(base.tail * 1.5, 0.002));
  }
  // Its own Volume is what sets its level.
  const quiet = await atLevel(page, SEQ_RESET + "document.getElementById('atVolSlider').value = 0;");
  expect(quiet.during).toBeLessThan(base.during * 0.02);
});

test('Seq\'s steps never play it, and Seq\'s LFOs cannot reach it', async ({ page }) => {
  await openAtmos(page);
  const got = await page.evaluate(async () => {
    initAudio();
    await audioCtx.resume();
    atmosSet('atModeSelect', 'both');
    const before = atVoices.length;
    playNote(440, audioCtx.currentTime + 0.02, 1);
    const targets = [1, 2, 3].flatMap((n) => [...document.getElementById(`lfo${n}TargetSelect`).options].map((o) => o.value));
    return { made: atVoices.length - before, at: targets.filter((v) => v.startsWith('at-')) };
  });
  expect(got.made, 'a step played Atmosphere').toBe(0);
  expect(got.at).toEqual([]);
});

test('its own LFOs move its own sound', async ({ page }) => {
  await openAtmos(page);
  const got = await page.evaluate(async (ENGINE) => {
    initAudio();
    await audioCtx.resume();
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; };
    set('atL1ShapeSelect', 'square'); set('atL1TargetSelect', 'volume'); set('atL1RateSlider', 65); set('atL1DepthSlider', 100);
    set('atL2TargetSelect', 'cutoff'); set('atL2DepthSlider', 60);
    set('atSusSlider', 100);
    atmosRead();
    const an = audioCtx.createAnalyser();
    an.fftSize = 256;
    masterGain.connect(an);
    await (eval(ENGINE)(330, 1.5));
    const seen = [];
    for (let k = 0; k < 40; k++) {
      await new Promise((r) => setTimeout(r, 25));
      const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
      seen.push(Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length));
    }
    masterGain.disconnect(an);
    const mid = seen.slice(8);
    // The engine runs them (atphys.js sends them as lfoN.*).
    return { to: ATPHYS.sent['lfo1.target'], cut: ATPHYS.sent['lfo2.target'], lo: Math.min(...mid), hi: Math.max(...mid) };
  }, ENGINE_NOTE);
  // volume is target 3, cutoff 1 (atmos.js AT_LFO_TARGETS, core/crates/atmos LFO_TARGETS)
  expect(got.to).toBe(3);
  expect(got.cut).toBe(1);
  // A square LFO at full depth on its volume: loud and quiet by turns.
  expect(got.hi).toBeGreaterThan(got.lo * 2);
});

test('its own tuning: its scale and root, or Seq\'s when it says Same as Seq', async ({ page }) => {
  await openAtmos(page);
  const got = await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; };
    selectScale(SCALES.findIndex((s) => /Ionian/.test(s.name)));
    document.getElementById('rootSelect').value = '9'; document.getElementById('octaveSelect').value = '4'; updateRoot();
    set('atTuneScaleSelect', 'seq'); set('atTuneRootSelect', 'seq'); set('atTuneOctSelect', 'seq');
    atmosRead();
    const same = [atKeyHz(69), kyHz(69), atKeyHz(61), kyHz(61)];
    // Its own: C, octave 4, a just scale.
    set('atTuneRootSelect', '0'); set('atTuneOctSelect', '4');
    set('atTuneScaleSelect', String(SCALES.findIndex((s) => /Ptolemy/.test(s.name))));
    atmosRead();
    return { same, c4: atKeyHz(60), seqC4: kyHz(60), seqRoot: rootHz, name: atScale().name };
  });
  expect(got.same[0]).toBeCloseTo(got.same[1], 3);
  expect(got.same[2]).toBeCloseTo(got.same[3], 3);
  expect(got.c4).toBeCloseTo(261.63, 1);
  expect(got.name).toMatch(/Ptolemy/);
  // Seq's tuning is untouched by it.
  expect(got.seqRoot).toBeCloseTo(440, 3);
});

test('on its page, in the order its sound goes: Amp, Filter, then its effects; no delay or Space of Seq\'s', async ({ page }) => {
  await openAtmos(page);
  const got = await page.evaluate(() => {
    const top = (s) => document.querySelector(s).getBoundingClientRect().top;
    const shown = (s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0);
    return { amp: top('.at-ampp'), filt: top('.at-filt'), lfo: top('.at-lfo'), fx: top('#atFxLine'), delay: shown('.fx-delay'), space: shown('.fx-space'), seqFilter: shown('.syn-filter'), tune: shown('.at-tune'), lfos: document.querySelectorAll('.at-lfo').length };
  });
  // Laid out as Wave is (17 Nov 2026): the Filter beside the oscillators, the
  // Amp under it, the effects after both.
  expect(got.filt).toBeLessThan(got.amp);
  expect(got.amp).toBeLessThan(got.fx);
  expect(got.lfo).toBeLessThan(got.fx);
  expect([got.delay, got.space, got.seqFilter]).toEqual([false, false, false]);
  expect(got.tune).toBe(true);
  expect(got.lfos).toBe(3);
});

// A film's render is the page's graph on an offline context (bridge.js,
// `renderFilm`). Atmosphere's effects were left out of it; they are in it now
// (18 Nov 2026), up before the render starts.
test('a film\'s render has Atmosphere\'s effects in it, and none when the line is empty', async ({ page }) => {
  // In the app: the film is rendered by the frame's bridge, which only the app has.
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const frame = page.frames().find((f) => f.url().includes('/sequencer/'));
  await frame.waitForFunction(() => typeof ATFX !== 'undefined' && ATFX.suites.length > 5);
  const got = await frame.evaluate(async () => {
    // A still voice that ends when it is let go.
    for (const [k, v] of Object.entries({ atUnison: 1, atDrift: 0, atAir: 0, atEns: 0, atWow: 0, atSym: 0, atSub: 0, atAtk: 0, atRel: 0 })) { const el = document.getElementById(k + 'Slider'); if (el) el.value = v; }
    atmosRead();
    initAudio();
    perfLoaded = null;
    steps.forEach((s) => { s.rest = true; });
    const real = drawAt;
    // One short Atmosphere note at the film's start, laid as Draw lays its own.
    drawAt = (k, time) => { if (k === 0) atmosPlay(440, time, 0.25); };
    const rate = 48000;
    const render = async () => (await seqBridge.renderFilm({ seconds: 2.5, rate, fps: 10, bands: 8, liss: 16 })).left;
    const rms = (b, a, z) => { let e = 0; const i0 = Math.round(a * rate), i1 = Math.round(z * rate); for (let i = i0; i < i1; i++) e += b[i] * b[i]; return Math.sqrt(e / (i1 - i0)); };
    try {
      ATFX.chain = [];
      const dry = await render();
      const kind = ATFX.suites.find((s) => s.id.startsWith('reverb')).families[0].modes[0].kind;
      ATFX.chain = [{ kind, on: true, params: {}, wet: 100, level: 0 }];
      const wet = await render();
      ATFX.chain = [{ kind, on: false, params: {}, wet: 100, level: 0 }];
      const off = await render();
      return { kind, note: rms(dry, 0.05, 0.25), dryTail: rms(dry, 1, 2), wetTail: rms(wet, 1, 2), offTail: rms(off, 1, 2), live: audioCtx.constructor.name };
    } finally {
      drawAt = real;
      ATFX.chain = [];
    }
  });
  // The note sounded, and dry it is over within the second.
  expect(got.note, JSON.stringify(got)).toBeGreaterThan(0.002);
  expect(got.dryTail).toBeLessThan(got.note * 0.02);
  // Through the reverb it rings on; switched off, it does not.
  expect(got.wetTail, JSON.stringify(got)).toBeGreaterThan(Math.max(got.dryTail * 20, got.note * 0.02));
  expect(got.offTail).toBeLessThan(got.note * 0.02);
  // The page has its own context back.
  expect(got.live).toBe('AudioContext');
});
