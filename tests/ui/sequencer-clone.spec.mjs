// Clone a song (`ui/sequencer/clone.js`): the host's Clone page, which reads
// songs split on the Stems page and writes the Seq Band.
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
// - the PC's model shows that it is not connected.

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

async function openClone(page) {
  await page.route('**/api/stems/list', (r) => r.fulfill({ json: [
    { p: 'Stems/Test Song', name: 'Test Song', analysed: true, card: { title: ONE.title } },
    { p: 'Stems/Other Song', name: 'Other Song', analysed: true, card: { title: TWO.title } },
  ] }));
  await page.route('**/api/stems/info**', (r) => {
    const p = new URL(r.request().url()).searchParams.get('p');
    r.fulfill({ json: { p, analysis: p === 'Stems/Other Song' ? TWO : ONE } });
  });
  await page.addInitScript(() => { try { localStorage.removeItem('mglClone'); localStorage.removeItem('mglLearnedScales'); } catch (e) { /* none */ } });
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof cloneMake === 'function' && !!document.getElementById('clGenerate'));
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
    initAudio(); cloneMake(); cloneApply(); clPaint();
    return {
      bpm: CL.made.bpm, kickA: DM.pats.A.kick.steps.slice(0, 16).map((x) => (x.v ? 'X' : '.')).join(''),
      secs: CL.plan.secs.length, scale: SCALES[selectedScaleIdx].name,
      allOn: !document.querySelector('#clFacets button[data-src="all"]').disabled,
      words: CL.words.style,
    };
  });
  expect(got.bpm).toBe(132);
  expect(got.kickA).toBe('X.X.X.X.X.X.X.X.');
  expect(got.secs).toBe(3);
  expect(got.scale).toBe('Test Song (learned)');
  expect(got.allOn).toBe(true);
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

test('the page: songs, facets, the eleven words, the plan; the PC\'s model says it is not connected', async ({ page }) => {
  await openClone(page);
  await page.click('#clGenerate');
  const got = await page.evaluate(() => ({
    songs: [...document.querySelectorAll('.cl-song[data-p] b')].map((b) => b.textContent),
    facets: document.querySelectorAll('#clFacets .fn').length,
    words: document.querySelectorAll('#clWords input').length,
    lanes: document.querySelectorAll('#clPlan .lane').length,
    pc: document.getElementById('clPcState').textContent,
    renderOff: document.querySelector('.cl-pc button[disabled]') !== null,
    check: document.querySelectorAll('#clCheck .fn').length,
    agree: [...document.querySelectorAll('#clCheck .agree')].map((x) => x.className.split(' ').pop()),
  }));
  expect(got.songs).toEqual(['Test Song', 'Other Song']);
  expect(got.facets).toBe(7);
  expect(got.words).toBe(11);
  expect(got.lanes).toBe(6);
  expect(got.pc).toContain('Not connected yet');
  expect(got.renderOff).toBe(true);
  expect(got.check).toBe(6);
  // At the defaults (near), tempo, key and sections agree with the song.
  expect(got.agree.slice(0, 2)).toEqual(['ok', 'ok']);
  // A lane cell turns a part off there, and the Band's plan follows.
  await page.click('#clPlan .cl-cell[data-p="bass"][data-s="0"]');
  expect(await page.evaluate(() => [CL.plan.secs[0].bass, JSON.parse(document.getElementById('bdPlanText').value).secs[0].bass])).toEqual(['', '']);
});
