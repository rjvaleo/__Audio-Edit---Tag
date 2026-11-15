// Clone a song (`ui/sequencer/clone.js`): the host's Clone page, which reads
// songs split on the Stems page and writes the Seq Band. The page is simple
// (your songs, four buttons and a knob, four takes); the engine under it is
// tested here directly too.
//
// The scratch library has no split songs, so the Stems routes are stood in for
// with a small song's reading (the shape of a real `songprint.json`).
//
// - at 0 (the same), the Band gets the song's tempo, its scale in its own
//   cents, its root, its sections and their parts, its drum bars, its bass;
// - the same seed makes the same piece; Re-roll another;
// - the Band plays the plan: drums silent in a section without them, the fill
//   on a section's last bar, the melody only where the plan has it;
// - Blend takes each facet from the song it is set to;
// - presets keep the patterns and the plan, and a preset from before them loads;
// - the page: songs read into a line; Make similar, Mix with, Lean toward,
//   More / Less like this, the family trail; a take plays on the Band; Keep
//   renders it and posts it to Made/Clones; recipes come back after a reload.

import { test, expect } from './test.mjs';

const bar = (kick, snare, hat, db, bassMidi) => ({
  mix_db: db, on: [true, true, false, false],
  kick: [...kick].map((c) => (c === 'X' ? 1 : c === 'x' ? 0.5 : 0)),
  snare: [...snare].map((c) => (c === 'X' ? 1 : c === 'x' ? 0.5 : 0)),
  hat: [...hat].map((c) => (c === 'X' ? 1 : c === 'x' ? 0.5 : 0)),
  bass: bassMidi ? [[0, 4, bassMidi, 0.8]] : [],
});
/// A song's reading, as songprint writes it: 32 bars in three sections.
function song(title, bpm, tonic, keyName, fams, sections, cents) {
  const bars = [];
  for (let i = 0; i < 32; i++) {
    const f = fams[i % fams.length], sec = sections.find((s) => i >= s.start_bar && i < s.start_bar + s.bars);
    // The bar before each change: a fill of snare rolls.
    const fill = sections.some((s) => s.start_bar === i + 1);
    bars.push({ bar: i, ...bar(f.kick, fill ? 'XXXXXXXXxxxxXXXX' : f.snare, f.hat, sec.mix_db, 38) });
  }
  return {
    format: 'songprint/1', title, bar_count: 32,
    tempo: { bpm, map: [[15, bpm, 0.9]] },
    key: { name: keyName, tonic_pc: tonic, minor: true, regions: [] },
    tuning: { offset_cents_from_a440: 0, scale_cents_above_tonic: cents },
    drums: { swing_16th_pct: 50, bar_families: fams.length, common_bars: fams.map((f, i) => ({ bars: 10 - i, first_bar: i, ...f })) },
    bass: { range: 'D1 to D3', notes: [[0, 0, 4, 38, 0.8], [0, 8, 2, 45, 0.6], [1, 0, 4, 38, 0.8], [1, 8, 2, 45, 0.6], [2, 0, 8, 38, 0.8], [3, 0, 4, 50, 0.8]] },
    chords: { changes: [[0, 'Dm7'], [8, 'Gm7']] },
    change: { sections: sections.length, section_bars_median: 8, entries_exits_per_minute: 1.2 },
    sections,
    texture: { stems: [{ stem: 'other', brightness_hz: 1200 }], smear_mean: 0.3, width_mean: 0.2, hiss_floor_db: -70, echoes_other_stem: [{ delay: '1/8', beats: 0.5, strength: 0.2 }, { delay: 'dotted 1/8', beats: 0.75, strength: 0.6 }] },
    bars,
  };
}
const ONE = song('Test Song (An Album)', 118, 2, 'D minor',
  [{ kick: 'X...X...X...X...', snare: '....X.......X...', hat: '..x...x...x...x.' }, { kick: 'X..XX...X..X....', snare: '....X..x....X...', hat: 'xxxxxxxxxxxxxxxx' }, { kick: 'X.......X.......', snare: '........X.......', hat: '................' }, { kick: 'XX..X...XX..X...', snare: '....X.......X..x', hat: 'x.x.x.x.x.x.x.x.' }],
  [{ label: 'A', start_bar: 0, bars: 8, stems_on: ['bass'], mix_db: -10 }, { label: 'B', start_bar: 8, bars: 16, stems_on: ['drums', 'bass'], mix_db: -4 }, { label: 'C', start_bar: 24, bars: 8, stems_on: ['drums', 'bass', 'other', 'vocals'], mix_db: -2 }],
  [204, 316, 498, 702, 814, 1018, 1190]);
const TWO = song('Other Song', 132, 9, 'A minor',
  [{ kick: 'X.X.X.X.X.X.X.X.', snare: '................', hat: '..X...X...X...X.' }, { kick: 'X...X...X...X...', snare: 'XXXX............', hat: 'X.X.X.X.X.X.X.X.' }],
  [{ label: 'A', start_bar: 0, bars: 16, stems_on: ['drums', 'bass'], mix_db: -5 }, { label: 'B', start_bar: 16, bars: 16, stems_on: ['drums', 'bass', 'other'], mix_db: -3 }],
  [200, 300, 500, 700, 800, 1000]);

async function openClone(page, keep) {
  await page.route('**/api/stems/list', (r) => r.fulfill({ json: [
    { p: 'Stems/Test Song', name: 'Test Song', analysed: true, card: { title: ONE.title } },
    { p: 'Stems/Other Song', name: 'Other Song', analysed: true, card: { title: TWO.title } },
  ] }));
  await page.route('**/api/stems/info**', (r) => {
    const p = new URL(r.request().url()).searchParams.get('p');
    r.fulfill({ json: { p, analysis: p === 'Stems/Other Song' ? TWO : ONE } });
  });
  // A clean page once per test; a reload in the test keeps what it saved.
  if (!keep) await page.addInitScript(() => { try { if (!sessionStorage.getItem('clClean')) { localStorage.removeItem('mglClone'); localStorage.removeItem('mglLearnedScales'); sessionStorage.setItem('clClean', '1'); } } catch (e) { /* none */ } });
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof cloneMake === 'function' && !!document.getElementById('clVerbs'));
  await page.evaluate(async () => {
    document.body.classList.add('only-clone');
    await cloneShown();
    window.__facets = (v, from) => { for (const k of Object.keys(CL.facets)) { CL.facets[k].v = v; CL.facets[k].from = from || ''; } };
  });
}

test('at 0 the Band gets the song: tempo, its scale in its own cents, root, sections, drum bars, bass, delay', async ({ page }) => {
  await openClone(page);
  const got = await page.evaluate(() => {
    numSteps = 16; stepBeats = 0.5;
    CL.sel = ['Stems/Test Song']; __facets(0); CL.seed = 7;
    initAudio(); cloneMake(); cloneApply();
    const A = DM.pats.A;
    return {
      bpm: bpmTarget, scale: SCALES[selectedScaleIdx].name, cents: SCALES[selectedScaleIdx].cents.join(' '), root: rootHz,
      arrange: BAND.arrangeMode, secs: BAND.plan.secs.map((x) => `${x.s.l}${x.bars}:${x.s.drums || '-'}${x.s.bass || '-'}${x.s.chord}${x.s.melody}${x.s.fill}`).join(' '),
      kickA: A.kick.steps.slice(0, 16).map((x) => (x.v ? 'X' : '.')).join(''), hatA: A.chh.steps.slice(0, 16).map((x) => (x.v ? 'x' : '.')).join(''),
      fill: DM.pats.F.snare.steps.slice(0, 16).filter((x) => x.v).length,
      lineA: BAND.bass.lines.A, bassPat: AC.parts.bass.pat, delay: document.getElementById('delayTimeSelect').value,
      learnedKept: JSON.parse(localStorage.getItem('mglLearnedScales')).map((s) => s.name),
    };
  });
  expect(got.bpm).toBe(118);
  expect(got.scale).toBe('Test Song (learned)');
  // 1190 is a hair under the octave: one note with the tonic, not another.
  expect(got.cents).toBe('0 204 316 498 702 814 1018');
  expect(got.root).toBeCloseTo(293.66, 1); // D4
  expect(got.arrange).toBe('plan');
  expect(got.secs).toBe('A8:-A000 B16:BB001 C8:CC110');
  expect(got.kickA).toBe('X...X...X...X...');
  expect(got.hatA).toBe('..x...x...x...x.');
  expect(got.fill).toBeGreaterThan(8);
  expect(got.lineA).toBe('R---....5-......');
  expect(got.bassPat).toBe('hand');
  expect(got.delay).toBe('0.75');
  expect(got.learnedKept).toEqual(['Test Song (learned)']);
});

test('the same seed makes the same piece; Re-roll another', async ({ page }) => {
  await openClone(page);
  const got = await page.evaluate(() => {
    CL.sel = ['Stems/Test Song']; __facets(40);
    const take = () => { CL.seed = 99; cloneMake(); return JSON.stringify([CL.plan, CL.made.lines, ['A', 'B', 'C', 'D'].map((l) => dmRowsOut(CL.made.pats[l]))]); };
    const a = take(), b = take();
    CL.seed = 12345; cloneMake();
    const c = JSON.stringify([CL.plan, CL.made.lines, ['A', 'B', 'C', 'D'].map((l) => dmRowsOut(CL.made.pats[l]))]);
    return { same: a === b, other: a !== c };
  });
  expect(got.same).toBe(true);
  expect(got.other).toBe(true);
});

test('the Band plays the plan: no drums where it has none, the fill on a section\'s last bar, the melody only where it plays', async ({ page }) => {
  await openClone(page);
  const got = await page.evaluate(() => {
    numSteps = 16; stepBeats = 0.5; bpm = 120;
    CL.sel = ['Stems/Test Song']; __facets(0); CL.seed = 7;
    initAudio(); cloneMake(); cloneApply();
    const stepsOfBar = (b) => Array.from({ length: 8 }, (_, j) => b * 8 + j); // 8 steps a bar at 1/8
    const drumsIn = (b) => stepsOfBar(b).reduce((a, k) => a + drumPlan(k).filter((h) => bandArranged(h.slot, k)).length, 0);
    const snareHitsIn = (b) => stepsOfBar(b).reduce((a, k) => a + drumPlan(k).filter((h) => h.slot === 'snare').length, 0);
    return {
      drumsA: drumsIn(3), drumsB: drumsIn(10),
      letterB: bandDrumLetter(10), letterLastB: bandDrumLetter(23), letterLastC: bandDrumLetter(31),
      fillSnares: snareHitsIn(23), plainSnares: snareHitsIn(22),
      melodyA: bandMelodyOn(3 * 8), melodyC: bandMelodyOn(25 * 8),
      wraps: bandSectionAt(32).s.l,
    };
  });
  expect(got.drumsA, 'drums in a section without them').toBe(0);
  expect(got.drumsB).toBeGreaterThan(0);
  expect(got.letterB).toBe('B');
  expect(got.letterLastB, 'the last bar before a change is the fill').toBe('F');
  expect(got.letterLastC, 'the last section has no fill').toBe('C');
  expect(got.fillSnares).toBeGreaterThan(got.plainSnares);
  expect(got.melodyA).toBe(false);
  expect(got.melodyC).toBe(true);
  expect(got.wraps, 'the plan goes round').toBe('A');
});

test('Blend takes each facet from the song it is set to', async ({ page }) => {
  await openClone(page);
  const got = await page.evaluate(async () => {
    CL.mode = 'blend'; CL.sel = ['Stems/Test Song', 'Stems/Other Song'];
    await Promise.all(CL.sel.map(clInfo));
    __facets(0);
    CL.facets.tempo.from = 'Stems/Other Song';
    CL.facets.drums.from = 'Stems/Other Song';
    CL.facets.arr.from = 'Stems/Test Song';
    CL.facets.key.from = 'Stems/Test Song';
    initAudio(); cloneMake(); cloneApply();
    return {
      bpm: CL.made.bpm, kickA: DM.pats.A.kick.steps.slice(0, 16).map((x) => (x.v ? 'X' : '.')).join(''),
      secs: CL.plan.secs.length, scale: SCALES[selectedScaleIdx].name,
      words: CL.words.style,
    };
  });
  expect(got.bpm).toBe(132);
  expect(got.kickA).toBe('X.X.X.X.X.X.X.X.');
  expect(got.secs).toBe(3);
  expect(got.scale).toBe('Test Song (learned)');
  expect(got.words).toContain('a blend of 2 songs');
});

test('presets keep the patterns and the plan; a preset from before them loads its grid as A', async ({ page }) => {
  await openClone(page);
  const got = await page.evaluate(() => {
    CL.sel = ['Stems/Test Song']; __facets(0); CL.seed = 7;
    initAudio(); cloneMake(); cloneApply();
    const st = getPresetState();
    const kept = { plan: JSON.parse(st.selects.bdPlanText).secs.length, pats: Object.keys(JSON.parse(st.selects.dmGridText).pats).join(''), lines: Object.keys(JSON.parse(st.selects.bsLineText)).join('') };
    // Off and back.
    document.getElementById('bdArrangeSelect').value = 'off'; document.getElementById('bdPlanText').value = ''; bandRead();
    applyPresetState(st);
    const back = { mode: BAND.arrangeMode, secs: BAND.plan && BAND.plan.secs.length, b: DM.pats.B.kick.steps.slice(0, 16).map((x) => (x.v ? 'X' : '.')).join('') };
    // A preset from before the patterns: one grid's rows.
    const old = { kick: { len: 16, mute: 0, s: [[100, 0, 100, 1], 0, 0, 0, [100, 0, 100, 1]] } };
    const el = document.getElementById('dmGridText'); el.value = JSON.stringify(old); el.dispatchEvent(new Event('change'));
    return { kept, back, oldA: DM.pats.A.kick.steps.slice(0, 8).map((x) => (x.v ? 'X' : '.')).join(''), oldOnlyA: Object.keys(DM.pats).join('') };
  });
  expect(got.kept).toEqual({ plan: 3, pats: 'ABCDF', lines: 'ABCD' });
  expect(got.back.mode).toBe('plan');
  expect(got.back.secs).toBe(3);
  expect(got.back.b).toBe('X..XX...X..X....');
  expect(got.oldA).toBe('X...X...');
  expect(got.oldOnlyA).toBe('A');
});

test('the page: each song in a line; Make similar makes four takes; one plays on the Band; the drawer has the blueprint', async ({ page }) => {
  await openClone(page);
  await expect(page.locator('.cl-song[data-p]')).toHaveCount(2);
  const songs = await page.evaluate(() => [...document.querySelectorAll('.cl-song[data-p]')].map((c) => [c.querySelector('.cl-nm').textContent, c.querySelector('.fp').textContent, c.classList.contains('from')]));
  expect(songs[0][0]).toBe('Test Song');
  expect(songs[0][1]).toContain('118 · D minor, its own tuning');
  expect(songs[0][2]).toBe(true);
  expect(songs[1][1]).toContain('132 · A minor');
  await expect(page.locator('#clTakes .cl-empty')).toBeVisible();
  await page.click('.cl-verb[data-v="similar"]');
  await expect(page.locator('.cl-take')).toHaveCount(4);
  const takes = await page.evaluate(() => CL.family[0].takes.map((t) => [t.name, t.recipe.snap.sel.join(), t.recipe.snap.mode]));
  expect(takes.map((t) => t[0])).toEqual(['Similar A', 'Similar B', 'Similar C', 'Similar D']);
  expect(takes.every((t) => t[1] === 'Stems/Test Song' && t[2] === 'clone')).toBe(true);
  expect(await page.locator('.cl-take .badge').first().textContent()).toMatch(/close|near|loose|far/);
  expect(await page.locator('.cl-take .pc').first().textContent()).toContain('not connected yet');
  // ▶ plays it on the Band, in the song's tuning, on its plan.
  await page.click('.cl-take[data-i="1"] .pb');
  const playing = await page.evaluate(() => ({ playing: isPlaying, mode: BAND.arrangeMode, scale: SCALES[selectedScaleIdx].name, picked: CL.picked, cls: document.querySelector('.cl-take[data-i="1"]').className }));
  expect(playing.playing).toBe(true);
  expect(playing.mode).toBe('plan');
  expect(playing.scale).toBe('Test Song (learned)');
  expect(playing.picked).toBe(1);
  await expect(page.locator('.cl-take[data-i="1"]')).toHaveClass(/playing/);
  await page.click('.cl-take[data-i="1"] .pb');
  expect(await page.evaluate(() => isPlaying)).toBe(false);
  // The drawer: the facets, the plan, the words, the check, what the buttons did.
  await page.click('#clHood > summary');
  const hood = await page.evaluate(() => ({
    facets: document.querySelectorAll('#clFacets .fn').length, words: document.querySelectorAll('#clWords input').length,
    lanes: document.querySelectorAll('#clPlan .lane').length, check: document.querySelectorAll('#clCheck .fn').length,
    log: document.getElementById('clLog').textContent, name: document.getElementById('clHoodName').textContent,
  }));
  expect(hood).toMatchObject({ facets: 7, words: 11, lanes: 6, check: 6 });
  expect(hood.log).toContain('Similar · every facet from Song');
  expect(hood.name).toContain('Similar B');
  // A facet changed there remakes the take.
  const before = await page.evaluate(() => CL.family[0].takes[1].recipe.snap.facets.drums.from);
  await page.click('#clFacets [data-f="drums"] button[data-src="dub"]');
  expect(before).toBe('');
  expect(await page.evaluate(() => [CL.family[0].takes[1].recipe.snap.facets.drums.from, CL.family[0].takes[1].made.pats.F.kick.steps.length > 0])).toEqual(['dub', true]);
});

test('Mix with, Lean toward, More and Less like this, and the family trail', async ({ page }) => {
  await openClone(page);
  await page.click('.cl-verb[data-v="mix"]');
  await expect(page.locator('#clHint')).toBeVisible();
  await page.click('.cl-song[data-p="Stems/Other Song"]');
  await expect(page.locator('.cl-song[data-p="Stems/Other Song"]')).toHaveClass(/mixed/);
  await page.click('.cl-verb[data-v="mix"]');
  await expect(page.locator('.cl-take')).toHaveCount(4);
  const mix = await page.evaluate(() => CL.family[0].takes.map((t) => [t.name, t.recipe.snap.sel.length, t.recipe.snap.facets.drums.from, t.recipe.snap.facets.bass.from]));
  expect(mix[0][0]).toBe('Mixed A');
  expect(mix.every((t) => t[1] === 2 && t[2] === 'Stems/Other Song' && t[3] === 'Stems/Other Song')).toBe(true);
  // Lean toward: slower, and the bass of the other song.
  await page.click('.cl-take[data-i="0"] .tn');
  await page.click('.cl-verb[data-v="lean"]');
  await page.click('.cl-chip[data-l="slower"]');
  await page.click('.cl-chip[data-l="darker"]');
  await page.fill('#clLeanText', 'like a rainy night');
  await page.click('#clLeanGo');
  await expect(page.locator('#clTrail b')).toHaveCount(2);
  const lean = await page.evaluate(() => { const base = CL.family[0].takes[0], t = CL.family[1].takes[0]; return { leans: t.recipe.leans, cut: [t.made.cut, clMakeRecipe({ ...t.recipe, leans: [] }).made.cut], mood: t.words.mood, name: t.name }; });
  expect(lean.leans).toEqual(['slower', 'darker']);
  expect(lean.cut[0]).toBeLessThan(lean.cut[1]);
  expect(lean.mood).toBe('like a rainy night');
  expect(lean.name).toBe('Leaning A');
  // More like this: that take is the new starting point.
  await page.click('.cl-take[data-i="2"] [data-a="more"]');
  await expect(page.locator('#clTrail b')).toHaveCount(3);
  const more = await page.evaluate(() => ({ trail: [...document.querySelectorAll('#clTrail b')].map((b) => b.textContent), varies: CL.family[2].takes.map((t) => t.recipe.varies.length), base: CL.family[2].takes[0].recipe.snap.seed === CL.family[1].takes[2].recipe.snap.seed }));
  expect(more.trail).toEqual(['Mixed', 'Leaning', 'Leaning C']);
  expect(more.varies).toEqual([1, 1, 1, 1]);
  expect(more.base).toBe(true);
  // Less like this: that one, replaced by one further away.
  await page.click('.cl-take[data-i="3"] [data-a="less"]');
  await expect(page.locator('.cl-take[data-i="3"] .tn')).toHaveText('More D′');
  // Back along the trail.
  await page.click('#clTrail b[data-g="0"]');
  await expect(page.locator('.cl-take[data-i="0"] .tn')).toHaveText('Mixed A');
  expect(await page.evaluate(() => CL.family.length)).toBe(3);
});

test('the same recipe makes the same take; the takes come back after a reload', async ({ page }) => {
  await openClone(page);
  await page.click('.cl-verb[data-v="similar"]');
  const same = await page.evaluate(() => {
    const rc = CL.family[0].takes[2].recipe;
    const a = JSON.stringify(clMakeRecipe(rc)), b = JSON.stringify(clMakeRecipe(rc));
    return { same: a === b, stored: JSON.stringify(clMakeRecipe(rc).plan) === JSON.stringify(CL.family[0].takes[2].plan) };
  });
  expect(same).toEqual({ same: true, stored: true });
  const names = await page.evaluate(() => CL.family[0].takes.map((t) => t.name + t.recipe.snap.seed));
  await openClone(page, true);
  await expect(page.locator('.cl-take')).toHaveCount(4);
  expect(await page.evaluate(() => CL.family[0].takes.map((t) => t.name + t.recipe.snap.seed))).toEqual(names);
});

test('in the app, Keep renders the take into Made/Clones, and Open in Grain opens it there', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/api/stems/list', (r) => r.fulfill({ json: [{ p: 'Stems/Test Song', name: 'Test Song', analysed: true, card: { title: ONE.title } }] }));
  await page.route('**/api/stems/info**', (r) => r.fulfill({ json: { p: 'Stems/Test Song', analysis: ONE } }));
  await page.addInitScript(() => { try { localStorage.removeItem('mglClone'); } catch (e) { /* none */ } });
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function');
  await page.evaluate(() => setMode('clone'));
  const frame = () => page.frames().find((f) => f.url().includes('/sequencer/'));
  await expect.poll(() => !!frame()).toBe(true);
  await frame().waitForFunction(() => typeof clKeep === 'function' && document.querySelectorAll('.cl-song[data-p] .fp').length === 1, null, { timeout: 15000 });
  await frame().click('.cl-verb[data-v="similar"]');
  // A short take, so the render is quick: two bars.
  await frame().evaluate(() => { const t = CL.family[0].takes[0]; t.plan.secs = [{ ...t.plan.secs[t.plan.secs.length - 1], b: 2, fill: 0 }]; });
  await frame().click('.cl-take[data-i="0"] [data-a="keep"]');
  await frame().waitForSelector('.cl-take[data-i="0"] .opens', { timeout: 30000 });
  const kept = await frame().evaluate(() => ({ p: CL.family[0].takes[0].kept, bpm: CL.family[0].takes[0].made.bpm, peaks: CL.family[0].takes[0].peaks.length }));
  expect(kept.p).toBe('Made/Clones/Test Song - Similar A.wav');
  expect(kept.peaks).toBe(160);
  const files = await page.evaluate(() => fetch('/api/files?folder=Made').then((r) => r.json()));
  const f = files.find((x) => x.path === kept.p);
  expect(f.sampleRate).toBe(48000);
  expect(f.channels).toBe(2);
  // Two bars at the take's tempo and a 3 s tail.
  expect(Math.abs(f.duration - ((2 * 240) / kept.bpm + 3))).toBeLessThan(0.1);
  await expect(frame().locator('.cl-take[data-i="0"] .pc')).toContainText('Test Song - Similar A.wav');
  await frame().click('.cl-take[data-i="0"] [data-a="open"][data-page="grain"]');
  await expect.poll(() => page.evaluate(() => [state.mode, editPage, state.selectedFile && state.selectedFile.path])).toEqual(['edit', 'grain', 'Made/Clones/Test Song - Similar A.wav']);
});

test('on the page by itself, Keep says it works in the app', async ({ page }) => {
  await openClone(page);
  await page.click('.cl-verb[data-v="similar"]');
  await page.click('.cl-take[data-i="0"] [data-a="keep"]');
  await expect(page.locator('#clToast')).toContainText('Keep works in the app');
});
