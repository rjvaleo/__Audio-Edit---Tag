// The Seq page's Band (`ui/sequencer/band.js`, `drums.js`): its mixer, its
// drums and its styles, checked by offline renders of the page's own graph.
//
// - the melody, at its channel's defaults, sounds exactly as it did before the Band;
// - a channel at level 0, muted, or not soloed is silent; pan moves a drum
//   between the channels;
// - the 808 synth's kick ends at its tune; a closed hat chokes the open one;
// - the grid: velocity 0 is silent, chance is the same every time, a ratchet
//   repeats, a row's own length runs against the others;
// - a sample kit plays its sample, tuned by Tune;
// - Style writes the same band from the same seed, and another from another;
// - Arrange takes the kick and the bass out in the breakdown.

import { test, expect } from './test.mjs';

async function openSeq(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof bandVoice === 'function' && typeof drumPlan === 'function' && !!document.getElementById('dmKitSelect'));
  await page.evaluate(() => {
    window.__set = (id, v) => { const el = document.getElementById(id); el.value = v; };
    window.__parts = (on) => {
      for (const p of ['Drums', 'Bass', 'Chord', 'Arp', 'Drone']) __set(`ac${p}OnSelect`, on.includes(p.toLowerCase()) ? 'on' : 'off');
      accompanyRead(); bandRead(); drumsRead();
    };
    /// One grid for the drums: rows given as { slot: [[step, vel, extra]] }.
    window.__grid = (rows) => {
      DM.grid = dmEmptyGrid();
      for (const [slot, hits] of Object.entries(rows)) for (const [i, v, x] of hits) Object.assign(DM.grid[slot].steps[i], { v }, x || {});
      dmGridSave(); drumsRead();
    };
    /// The page's graph rendered offline from boundary 0 for `seconds`; with
    /// `melody`, the steps play too.
    window.__render = async (seconds, { rate = 24000, melody = false, band = true } = {}) => {
      const off = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
      off.createMediaStreamDestination = () => off.createGain();
      const Real = window.AudioContext;
      window.AudioContext = function () { return off; };
      audioCtx = null;
      try { initAudio(); } finally { window.AudioContext = Real; }
      const d = (60 / bpm) * stepBeats;
      for (let k = 0; k * d < seconds; k++) {
        if (band) accompanyAt(k, k * d);
        const s = steps[k % numSteps];
        if (melody && !s.rest) seqPlayAt(s, k * d, d);
      }
      const buf = await off.startRendering();
      audioCtx = null;
      return buf;
    };
    window.__rms = (x, a = 0, z = x.length) => { let s = 0; for (let i = a; i < z; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, z - a)); };
  });
}

test('the melody, at its channel\'s defaults, sounds exactly as it did before the Band', async ({ page }) => {
  test.setTimeout(60_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    numSteps = 8; stepBeats = 0.5; bpm = 120;
    __parts([]);
    const withBand = (await __render(2, { melody: true, band: false })).getChannelData(0).slice();
    // The graph as it was: no Band, the filter straight into the dry path, the delay and Space.
    const keep = window.bandInit;
    window.bandInit = undefined;
    const before = (await __render(2, { melody: true, band: false })).getChannelData(0);
    window.bandInit = keep;
    let diff = 0;
    for (let i = 0; i < before.length; i++) diff = Math.max(diff, Math.abs(before[i] - withBand[i]));
    return { diff, rms: __rms(before) };
  });
  expect(got.rms).toBeGreaterThan(0.005);
  expect(got.diff).toBeLessThan(1e-5);
});

test('a channel at level 0, muted or not soloed is silent; pan moves a drum between the channels', async ({ page }) => {
  test.setTimeout(90_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __parts(['drums', 'bass']);
    __set('dmKitSelect', 'synth');
    __grid({ kick: [[0, 127], [4, 127], [8, 127], [12, 127]] });
    const lr = async () => { const b = await __render(1.5); return [__rms(b.getChannelData(0)), __rms(b.getChannelData(1))]; };
    const out = {};
    out.both = await lr();
    __set('mxDrmLevelSlider', 0); bandRead(); out.drmZero = await lr();
    __set('mxDrmLevelSlider', 80); __set('mxDrmMuteSelect', 'on'); bandRead(); out.drmMuted = await lr();
    __set('mxDrmMuteSelect', 'off'); __set('mxBasSoloSelect', 'on'); bandRead(); out.basSolo = await lr();
    __parts(['drums']); out.basSoloNoBass = await lr();
    __set('mxBasSoloSelect', 'off'); bandRead();
    __set('dmKickPanSlider', -100); drumsRead(); out.left = await lr();
    __set('dmKickPanSlider', 100); drumsRead(); out.right = await lr();
    return out;
  });
  expect(got.both[0]).toBeGreaterThan(0.01);
  expect(got.drmZero[0], 'the drums at level 0 still sounded (the bass is on, so not 0 overall)').toBeLessThan(got.both[0]);
  expect(got.basSoloNoBass[0], 'the bass soloed, off, and the drums still sounded').toBe(0);
  expect(got.drmMuted[0]).toBeCloseTo(got.drmZero[0], 6);
  expect(got.left[1] / got.left[0], 'panned left, and the right channel was as loud').toBeLessThan(0.05);
  expect(got.right[0] / got.right[1], 'panned right, and the left channel was as loud').toBeLessThan(0.05);
});

test('the 808 kick ends at its tune; a closed hat chokes the open one', async ({ page }) => {
  test.setTimeout(60_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __parts(['drums']);
    __set('dmKitSelect', 'synth'); __set('dmKickTuneSlider', 0); __set('dmKickDecSlider', 80); __set('dmKickToneSlider', 0);
    for (const s of DM_SLOTS) __set(dmId(s, 'DlySlider'), 0);
    __set('mxDrmDlySlider', 0); __set('mxDrmSpcSlider', 0);
    __grid({ kick: [[0, 127]] });
    const rate = 24000, x = (await __render(1.2, { rate })).getChannelData(0);
    // Its pitch late in the hit, from zero crossings.
    let n = 0, first = -1, last = -1;
    for (let i = Math.round(0.4 * rate); i < Math.round(0.9 * rate); i++) if (x[i - 1] < 0 && x[i] >= 0) { if (first < 0) first = i; last = i; n++; }
    const hz = ((n - 1) * rate) / (last - first);
    // The open hat alone, then with a closed hat a 16th later.
    __set('dmOhhDecSlider', 90);
    __grid({ ohh: [[0, 127]] });
    const open = (await __render(1, { rate })).getChannelData(0);
    __grid({ ohh: [[0, 127]], chh: [[1, 127]] });
    const choked = (await __render(1, { rate })).getChannelData(0);
    const a = Math.round(0.15 * rate), z = Math.round(0.45 * rate);
    return { hz, tune: dmTuneHz(DM.slots.kick, DM_SLOTS[0]), open: __rms(open, a, z), choked: __rms(choked, a, z) };
  });
  expect(Math.abs(got.hz / got.tune - 1), `the kick ended at ${got.hz.toFixed(1)} Hz`).toBeLessThan(0.05);
  expect(got.open).toBeGreaterThan(0.001);
  expect(got.choked / got.open, 'the closed hat did not choke the open one').toBeLessThan(0.1);
});

test('the grid: velocity 0 is silent, chance is the same every time, a ratchet repeats, a row\'s length runs against the others', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __parts(['drums']);
    __set('dmRateSelect', '16'); __set('bdSwingSlider', 50); bandRead();
    const hits = (from, to, slot) => { const o = []; for (let k = from; k < to; k++) for (const h of drumPlan(k)) if (!slot || h.slot === slot) o.push(k + ':' + h.slot + '@' + h.at.toFixed(4)); return o; };
    __grid({ snare: [[4, 0]] });
    const silent = hits(0, 64).length;
    __grid({ chh: Array.from({ length: 16 }, (_, i) => [i, 100, { c: 50 }]) });
    const a = hits(0, 128).join(' '), b = hits(0, 128).join(' ');
    const share = hits(0, 128).length / 256;
    __grid({ snare: [[4, 100, { r: 4 }]] });
    const rat = hits(0, 8, 'snare').length;
    __grid({ kick: [[0, 100]], perc: [[0, 100]] });
    DM.grid.perc.len = 5; dmGridSave(); drumsRead();
    // Kick every 16 sixteenths, perc every 5: their hits in two bars.
    const at16 = (slot) => hits(0, 16, slot).map((h) => Math.round((+h.split(':')[0] * 0.5 + +h.split('@')[1] / 0.5) * 4));
    return { silent, same: a === b, share, rat, kick: at16('kick'), perc: at16('perc') };
  });
  expect(got.silent).toBe(0);
  expect(got.same).toBe(true);
  expect(got.share).toBeGreaterThan(0.35);
  expect(got.share).toBeLessThan(0.65);
  expect(got.rat).toBe(4);
  expect(got.kick).toEqual([0, 16]);
  expect(got.perc).toEqual([0, 5, 10, 15, 20, 25, 30]);
});

test('a sample kit plays its sample, tuned by Tune; a sound the kit lacks plays from the synth', async ({ page }) => {
  test.setTimeout(60_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __parts(['drums']);
    // The 909's kick, stood in for by a second of 1 kHz: the scratch library has no drums.
    const rate = 24000, kit = DM_KITS.r909, sine = new AudioBuffer({ length: rate, sampleRate: rate, numberOfChannels: 1 });
    const d = sine.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate);
    DM_BUF.set(kit.dir + kit.files.kick, sine);
    __set('dmKitSelect', 'r909'); __set('dmKickToneSlider', 100); __set('dmKickDecSlider', 100);
    __grid({ kick: [[0, 127]] });
    const freq = async () => {
      const x = (await __render(0.6, { rate })).getChannelData(0);
      let n = 0, first = -1, last = -1;
      for (let i = Math.round(0.1 * rate); i < Math.round(0.4 * rate); i++) if (x[i - 1] < 0 && x[i] >= 0) { if (first < 0) first = i; last = i; n++; }
      return ((n - 1) * rate) / (last - first);
    };
    const at0 = await freq();
    __set('dmKickTuneSlider', 12); drumsRead();
    const up = await freq();
    // The 606 has no clap: its clap row plays the synth's.
    __set('dmKitSelect', 'r606'); drumsRead();
    return { at0, up, sampled: !!dmSample('kick'), lacks: dmSample('clap') === null };
  });
  expect(got.at0).toBeGreaterThan(990);
  expect(got.at0).toBeLessThan(1010);
  expect(got.up).toBeGreaterThan(1980);
  expect(got.up).toBeLessThan(2020);
  expect(got.lacks).toBe(true);
});

test('Style writes the same band from the same seed, another from another; Arrange takes the kick and bass out in the breakdown', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    numSteps = 16; stepBeats = 0.5;
    const take = () => { const s = getPresetState(); return JSON.stringify([s.selects.dmGridText, s.selects.acChordPatSelect, s.selects.acBassPatSelect, s.sliders.chCutSlider, s.sliders.mxChdDlySlider, s.selects.dmKitSelect]); };
    __set('bdStyleSelect', 'bc'); __set('bdSeedSlider', 42); bandRead(); bandGenerate();
    const a = take();
    bandGenerate();
    const b = take();
    __set('bdSeedSlider', 4242); bandGenerate();
    const c = take();
    // Arrange: 128 bars of four beats, eight steps a bar.
    __set('jOnSelect', 'off'); journeyRead();
    const where = (f) => Math.round(f * 128 * 8);
    const kickIn = (k) => bandArranged('kick', k), bassIn = (k) => bandArranged('bass', k);
    return {
      same: a === b, other: a !== c, arrange: BAND.arrange, tempo: Math.round(bpmTarget),
      start: [kickIn(0), bassIn(0)], built: [kickIn(where(0.4)), bassIn(where(0.4))], brk: [kickIn(where(0.6)), bassIn(where(0.6))],
    };
  });
  expect(got.same, 'the same seed wrote another band').toBe(true);
  expect(got.other, 'another seed wrote the same band').toBe(true);
  expect(got.arrange).toBe(true);
  expect(got.tempo).toBeGreaterThanOrEqual(130);
  expect(got.tempo).toBeLessThanOrEqual(140);
  expect(got.start).toEqual([true, false]);
  expect(got.built).toEqual([true, true]);
  expect(got.brk).toEqual([false, false]);
});

test('every drum machine in the library is a kit: the server lists them, their files are mapped onto the rows', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(async () => {
    const list = await (await fetch('/api/seq/kits')).json();
    const kit = dmGuessKit(['TR-909Clap.wav', 'TR-909Hat C 01.wav', 'TR-909Hat O 01.wav', 'TR-909Kick 01.wav', 'TR-909Rim.wav', 'TR-909Snare 01.wav', 'TR-909Ride.wav', 'LoTom.wav', 'MidTom.wav', 'HiTom.wav']);
    return { isList: Array.isArray(list), kit };
  });
  expect(got.isList).toBe(true);
  expect(got.kit).toEqual({ kick: 'TR-909Kick 01.wav', snare: 'TR-909Snare 01.wav', clap: 'TR-909Clap.wav', rim: 'TR-909Rim.wav', ohh: 'TR-909Hat O 01.wav', chh: 'TR-909Hat C 01.wav', ltom: 'LoTom.wav', mtom: 'MidTom.wav', htom: 'HiTom.wav', perc: 'TR-909Ride.wav' });
});
