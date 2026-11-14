// The scale sequencer's Accompany (`ui/sequencer/accompany.js`): bass, chords,
// arp and drone from the scale's own degrees.
//
// - a chord in a just scale is stacked from its cents: its third sounds at
//   386.3¢, not 12-TET's 400¢, measured in an offline render;
// - worked out, not rolled: the same settings give the same notes, a boundary
//   read on its own (a seek) gives what playing up to it gave, and two offline
//   renders are the same to the sample;
// - a part off is silent; each part on alone sounds;
// - not through the melody's filter (RJ, 14 Nov): the chords keep their level
//   with the cutoff shut;
// - Follows: the melody's strongest note is in the bar's chord; the Journey's
//   root moves the chord;
// - the film (bridge.js) renders the accompaniment, the same twice;
// - presets, morphs and the recorder carry the parts.

import { test, expect } from './test.mjs';

async function openSeq(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof accompanyAt === 'function' && typeof journeyStep === 'function' && !!document.getElementById('acFollowSelect'));
  await page.evaluate(() => {
    window.__set = (id, v) => { const el = document.getElementById(id); el.value = v; };
    /// Parts on or off by name, the rest as given, then read.
    window.__parts = (on, extra = {}) => {
      for (const p of ['Drums', 'Bass', 'Chord', 'Arp', 'Drone']) __set(`ac${p}OnSelect`, on.includes(p.toLowerCase()) ? 'on' : 'off');
      for (const [id, v] of Object.entries(extra)) __set(id, v);
      accompanyRead(); bandRead(); drumsRead();
    };
    /// The Chords' and Drone's own Atmosphere patches made plain, so a chord
    /// tone is one sine at its pitch, and their filters open.
    window.__plainAtmos = () => {
      for (const pre of ['ch', 'dr']) {
        const s = { KindASelect: 'classic', AtA1Slider: 0, AtAOctSlider: 0, AtBlendSlider: 0, AtUnisonSlider: 1, AtDetuneSlider: 0, AtDriftSlider: 0,
          AtSubSlider: 0, AtAirSlider: 0, AtAtkSlider: 20, AtSusSlider: 100, AtVolSlider: 70 };
        for (const [id, v] of Object.entries(s)) __set(pre + id, v);
      }
      __set('chCutSlider', 100); __set('chEnvSlider', 0); __set('drCutSlider', 100);
      bandRead();
    };
    /// Accompany alone, rendered offline from boundary `k0` for `seconds`:
    /// the page's own graph, built on an offline context as the film's is.
    window.__render = async (seconds, rate = 24000, k0 = 0) => {
      const off = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
      off.createMediaStreamDestination = () => off.createGain();
      const Real = window.AudioContext;
      window.AudioContext = function () { return off; };
      audioCtx = null;
      try { initAudio(); } finally { window.AudioContext = Real; }
      const d = (60 / bpm) * stepBeats;
      for (let k = k0; (k - k0) * d < seconds; k++) accompanyAt(k, (k - k0) * d);
      const buf = await off.startRendering();
      audioCtx = null;
      return buf;
    };
    window.__rms = (x, a = 0, z = x.length) => { let s = 0; for (let i = a; i < z; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, z - a)); };
    /// The strongest frequency within ±`span` cents of `hz`, to a tenth of a
    /// cent: a Hann-windowed DFT scanned across the span.
    window.__peak = (x, rate, hz, a, z, span = 40) => {
      const n = z - a;
      let best = 0, bestC = 0;
      for (let c = -span; c <= span; c += 0.1) {
        const f = hz * Math.pow(2, c / 1200), w = (2 * Math.PI * f) / rate;
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) { const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)), v = x[a + i] * h; re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
        const m = re * re + im * im;
        if (m > best) { best = m; bestC = c; }
      }
      return hz * Math.pow(2, bestC / 1200);
    };
    /// Every note Accompany plans from `k0` for `n` boundaries, as text.
    window.__plan = (k0, n, jumpFirst = true) => Array.from({ length: n }, (_, j) => acPlan(k0 + j, jumpFirst && j === 0)
      .map((e) => `${e.part}@${(e.at).toFixed(4)}+${e.dur.toFixed(4)}:${e.hz.toFixed(3)}`).join(',')).join(' | ');
  });
}

test('a chord in a just scale is stacked from its cents: the third sounds at 386.3¢, not 400¢', async ({ page }) => {
  test.setTimeout(60_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    selectScale(SCALES.findIndex((s) => /^Ptolemy's Intense/.test(s.name)));
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __set('jOnSelect', 'off'); journeyRead();
    __plainAtmos();
    __parts(['chord'], { acFollowSelect: 'root', acChordPatSelect: 'triad-bar', chSpreadSlider: 0 });
    const cents = SCALES[selectedScaleIdx].cents;
    const plan = acPlan(0, true).filter((e) => e.part === 'chord').map((e) => e.hz);
    const rate = 24000, buf = await __render(2, rate);
    const x = buf.getChannelData(0);
    const third = rootHz * Math.pow(2, cents[2] / 1200);
    const heard = __peak(x, rate, third, Math.round(0.8 * rate), Math.round(1.8 * rate));
    return { cents: cents.slice(0, 5), plan, third, heard, rootHz };
  });
  expect(got.cents[2]).toBeCloseTo(386.31, 1);
  // The plan: root, third, fifth, from the scale's cents.
  expect(got.plan.length).toBe(3);
  expect(got.plan[0]).toBeCloseTo(got.rootHz, 6);
  expect(got.plan[1]).toBeCloseTo(got.rootHz * Math.pow(2, got.cents[2] / 1200), 6);
  expect(got.plan[2]).toBeCloseTo(got.rootHz * Math.pow(2, got.cents[4] / 1200), 6);
  // The render: the third where the scale puts it, within a cent.
  const off = 1200 * Math.log2(got.heard / got.third);
  expect(Math.abs(off), `the third sounded ${off.toFixed(2)}¢ off its just pitch`).toBeLessThan(1);
  const vs12 = 1200 * Math.log2(got.heard / (got.rootHz * Math.pow(2, 400 / 1200)));
  expect(Math.abs(vs12), 'the third sounded at 12-TET').toBeGreaterThan(12);
});

test('worked out, not rolled: the same notes again, a seek lands where playing got to, two renders are the same to the sample', async ({ page }) => {
  test.setTimeout(60_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __set('jOnSelect', 'on'); __set('jLenSelect', '16'); __set('jEachSlider', 8); __set('jSeedSlider', 777); __set('jC1Slider', 100); journeyRead();
    __parts(['bass', 'chord', 'arp', 'drone'], { acFollowSelect: 'melody', acBassPatSelect: 'walk', acArpPatSelect: 'random-16', acChordPatSelect: 'seventh-change' });
    const a = __plan(0, 256);
    jPlanKey = '';
    const b = __plan(0, 256);
    // A seek, reading elsewhere first: boundary 100 played on from 99 is what
    // playing up to it gave.
    __plan(500, 7);
    const seek = acPlan(100, false);
    const along = a.split(' | ')[100];
    // Bass and arp only (the plain voice, nothing random in it): two renders.
    __parts(['bass', 'arp']);
    const r1 = (await __render(3)).getChannelData(0).slice();
    const r2 = (await __render(3)).getChannelData(0);
    let diff = 0;
    for (let i = 0; i < r1.length; i++) diff = Math.max(diff, Math.abs(r1[i] - r2[i]));
    return { same: a === b, seek: seek.map((e) => `${e.part}@${(e.at).toFixed(4)}+${e.dur.toFixed(4)}:${e.hz.toFixed(3)}`).join(','), along, notes: a.split(',').length, diff, rms: __rms(r1) };
  });
  expect(got.notes).toBeGreaterThan(300);
  expect(got.same, 'the same settings planned other notes').toBe(true);
  expect(got.seek).toBe(got.along);
  expect(got.rms).toBeGreaterThan(0.005);
  // The same to the sample, but for Web Audio's own rounding (−150 dB).
  expect(got.diff, 'two renders differ').toBeLessThan(1e-6);
});

test('a jump mid-bar starts the bar\'s chord and drone from there, for the rest of the bar', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __set('jOnSelect', 'off'); journeyRead();
    __parts(['chord', 'drone'], { acChordPatSelect: 'triad-bar' });
    const mid = acPlan(3, true), along = acPlan(3, false), start = acPlan(0, true);
    return {
      mid: mid.map((e) => [e.part, e.at, +e.dur.toFixed(4)]),
      along: along.length,
      start: start.filter((e) => e.part === 'chord').map((e) => +e.dur.toFixed(4)),
    };
  });
  // Bar 0 is 8 steps of 0.25 s; from step 3, 5 steps (1.25 s) are left.
  expect(got.along).toBe(0);
  expect(got.start).toEqual([1.96, 1.96, 1.96]);
  expect(got.mid.filter(([p]) => p === 'chord').map(([, at, d]) => [at, d])).toEqual([[0, 1.225], [0, 1.225], [0, 1.225]]);
  expect(got.mid.some(([p]) => p === 'drone')).toBe(true);
});

test('a part off is silent, and each part on alone sounds', async ({ page }) => {
  test.setTimeout(90_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __set('jOnSelect', 'off'); journeyRead();
    __plainAtmos();
    const out = {};
    __parts([]);
    out.none = __rms((await __render(2)).getChannelData(0));
    for (const p of ['bass', 'chord', 'arp', 'drone']) {
      __parts([p]);
      out[p] = __rms((await __render(2)).getChannelData(0));
      // Everything but this part: none of its notes in the plan.
      __parts(['bass', 'chord', 'arp', 'drone'].filter((x) => x !== p));
      out[p + 'Planned'] = __plan(0, 32).split(/[|,]/).filter((s) => s.trim().startsWith(p + '@')).length;
    }
    return out;
  });
  expect(got.none, 'all parts off, and still a sound').toBe(0);
  for (const p of ['bass', 'chord', 'arp', 'drone']) {
    expect(got[p], `${p} on alone was silent`).toBeGreaterThan(0.002);
    expect(got[p + 'Planned'], `${p} off, and still planned`).toBe(0);
  }
});

test('not through the melody\'s filter: the chords keep their level with the cutoff shut', async ({ page }) => {
  test.setTimeout(60_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    __set('jOnSelect', 'off'); journeyRead();
    __plainAtmos();
    __parts(['chord', 'bass']);
    const open = __rms((await __render(2)).getChannelData(0));
    filterCutoff = 30; // the melody's filter, shut
    const shut = __rms((await __render(2)).getChannelData(0));
    return { open, shut };
  });
  expect(got.open).toBeGreaterThan(0.005);
  expect(got.shut / got.open).toBeGreaterThan(0.98);
});

test('Follows: the melody\'s strongest note is in the bar\'s chord; the Journey\'s root moves the chord', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    selectScale(SCALES.findIndex((s) => /^Ionian/.test(s.name)));
    numSteps = 16; stepBeats = 0.5; direction = 'fwd';
    __set('jOnSelect', 'off'); journeyRead();
    __parts(['chord'], { acFollowSelect: 'melody', acChordPatSelect: 'triad-bar' });
    // Bar 1: all degree 4 (F in C); bar 2: all degree 5 (G).
    for (let i = 0; i < 16; i++) { steps[i].degree = i < 8 ? 3 : 4; steps[i].rest = false; }
    const melody = [acChord(0, 'triad').degs, acChord(1, 'triad').degs];
    // Every note of every bar is in its chord when the bars hold one degree each.
    __set('acFollowSelect', 'root'); accompanyRead();
    const rootOff = [acChord(0, 'triad').degs, acChord(1, 'triad').degs];
    // The Journey's root: find a bar where it has moved, and the chord there.
    __set('jOnSelect', 'on'); __set('jLenSelect', '16'); __set('jEachSlider', 8); __set('jC1Slider', 100);
    for (const k of ['deg', 'oct', 'rest', 'rhythm', 'scale', 'dir']) __set(`jK${k}Select`, 'off');
    __set('jKrootSelect', 'on');
    let moved = null;
    for (let seed = 1; seed < 60 && !moved; seed++) {
      __set('jSeedSlider', seed); journeyRead();
      for (let b = 0; b < 16 && !moved; b++) {
        const sc = acScaleAt(acK(b * 4));
        if (sc.shift % 7) moved = { seed, b, shift: sc.shift, degs: acChord(b, 'triad').degs };
      }
    }
    return { melody, rootOff, moved };
  });
  expect(got.melody[0].map((d) => d % 7)).toContain(3);
  expect(got.melody[1].map((d) => d % 7)).toContain(4);
  expect(got.melody[0][0]).toBe(3); // F major: the chord on the note, the fourth of the key
  expect(got.melody[1][0]).toBe(4); // G major
  expect(got.rootOff).toEqual([[0, 2, 4], [0, 2, 4]]);
  expect(got.moved, 'no seed moved the root').not.toBeNull();
  expect(got.moved.degs[0]).toBe(((got.moved.shift % 7) + 7) % 7);
});

test('presets, morphs and the recorder carry the parts', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    __parts(['chord', 'drone'], { chSpreadSlider: 77, drSwellSlider: 12, acFollowSelect: 'root', mxChdLevelSlider: 33, dmKickPanSlider: -60 });
    DM.grid.kick.steps[3].v = 99; dmGridSave();
    const st = getPresetState();
    __parts([], { chSpreadSlider: 10, acFollowSelect: 'melody', mxChdLevelSlider: 80, dmKickPanSlider: 0 });
    DM.grid.kick.steps[3].v = 0; dmGridSave(); drumsRead();
    applyPresetState(st);
    return {
      saved: [st.selects.acChordOnSelect, st.selects.acDroneOnSelect, st.selects.acBassOnSelect, st.sliders.chSpreadSlider, st.selects.acFollowSelect],
      back: [AC.parts.chord.on, AC.parts.drone.on, AC.parts.bass.on, BAND.chord.chSpread, AC.follow, BAND.ch.Chd.lv, DM.slots.kick.pan, DM.grid.kick.steps[3].v],
      perf: [...ACCOMPANY_SELECT_IDS, ...BAND_SELECT_IDS].every((id) => PERF_SELECT_SET.has(id)) && BAND_ALL_MORPH_IDS.every((id) => PERF_SLIDER_SET.has(id)),
      knobs: BAND_ALL_MORPH_IDS.length,
    };
  });
  expect(got.saved).toEqual(['on', 'on', 'off', '77', 'root']);
  expect(got.back).toEqual([true, true, false, 77, 'root', 33, -60, 99]);
  expect(got.perf).toBe(true);
  expect(got.knobs).toBeGreaterThan(150);
});

test('a film renders the accompaniment, the same notes twice', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const frame = page.frames().find((f) => f.url().includes('/sequencer/'));
  await frame.evaluate(() => {
    for (const p of ['Drums', 'Bass', 'Chord', 'Arp', 'Drone']) document.getElementById(`ac${p}OnSelect`).value = 'on';
    accompanyRead();
    // The Band's notes as the render plays them, in order.
    window.__ac = [];
    const bass = window.bdBass, arp = window.bdArp, at = window.atmosPlay, hit = window.drumHit;
    window.bdBass = (e, t) => { __ac.push('bass:' + e.hz.toFixed(2)); return bass(e, t); };
    window.bdArp = (e, t) => { __ac.push('arp:' + e.hz.toFixed(2)); return arp(e, t); };
    window.atmosPlay = (hz, t, d, o) => { if (o && o.ac) __ac.push('at:' + hz.toFixed(2)); return at(hz, t, d, o); };
    window.drumHit = (slot, t, v, dest) => { __ac.push('drum:' + slot); return hit(slot, t, v, dest); };
  });
  const render = async () => {
    await frame.evaluate(() => { __ac = []; });
    await page.evaluate(() => seqRenderForFilm({ at0: 0, seconds: 4, rate: 24000, fps: 10, bands: 16, lo: 20, hi: 20000, liss: 32 }));
    return frame.evaluate(() => __ac.join(' '));
  };
  // The first render sets the root from its select when it puts the knobs
  // back (the vendored `updateRoot`: A, octave 4 is 220 Hz, where the page
  // starts at 440), so the two compared are the second and third.
  await render();
  const one = await render();
  const two = await render();
  expect(one.split(' ').length, 'the film played no accompaniment').toBeGreaterThan(20);
  expect(one).toContain('bass:');
  expect(one).toContain('arp:');
  expect(one).toContain('at:');
  expect(one).toContain('drum:kick');
  expect(two).toBe(one);
});

test('the panel: six parts, an editor for each, and a mixer channel for each', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => ({
    parts: [...document.querySelectorAll('.bd-card')].map((c) => c.querySelector('.ac-pt b').textContent),
    editors: [...document.querySelectorAll('.bd-ed')].map((e) => e.dataset.p),
    strips: [...document.querySelectorAll('.bd-strip .bd-sn')].map((e) => e.firstChild.textContent),
    rows: document.querySelectorAll('.dm-row').length,
    follow: [...document.querySelectorAll('.band .ph .seg button')].slice(0, 2).map((b) => b.textContent),
  }));
  expect(got.parts).toEqual(['MELODY', 'DRUMS', 'BASS', 'CHORDS', 'ARP', 'DRONE']);
  expect(got.editors).toEqual(['drums', 'bass', 'chord', 'arp', 'drone']);
  expect(got.strips).toEqual(['MELODY', 'DRUMS', 'BASS', 'CHORDS', 'ARP', 'DRONE']);
  expect(got.rows).toBe(10);
  expect(got.follow).toEqual(['Melody', 'Journey root']);
  await page.click('.bd-edit[data-p="bass"]');
  expect(await page.evaluate(() => document.querySelector('.bd-ed.on').dataset.p)).toBe('bass');
  await page.click('.power[data-ac="chord"]');
  expect(await page.evaluate(() => [AC.parts.chord.on, document.querySelector('.ac-part[data-p="chord"]').classList.contains('on')])).toEqual([true, true]);
});
