// Compose, phase two: one timeline.
//
// The grain's lanes and the sequencer's take on one ruler, in the engine's
// output seconds, with one arm for both recorders. What is checked:
//
//   - a take remembers where on the engine's clock it began, and replays from
//     there — it used to replay as though every take began at nought;
//   - the take reaches the host as lanes in engine seconds, grouped beside the
//     grain's, with its discrete events and its tempo;
//   - REC PERF arms the sequencer's recorder too, and the playhead is drawn on
//     output time;
//   - a group folds with one click, and a sequencer lane is shown here but
//     edited in Seq;
//   - the bars follow the sequencer's tempo.

import { test, expect } from '@playwright/test';

async function openFile(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => !!(state.stretchDraft && state.automation), { timeout: 20_000 });
}

async function enterCompose(page) {
  await page.evaluate(() => setMode('compose'));
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  await page.waitForTimeout(300);
  return page.frames().find((f) => f.url().includes('/sequencer/'));
}

/// A take made at ten seconds on the engine: the cutoff moved from 20 to 80
/// one to two seconds in, and the scale changed at three.
const TAKE_AT_TEN = () => {
  perfLoaded = {
    id: 'take-at-ten', name: 'At ten', created: Date.now(), generated: false,
    duration: 4, startAt: 10, wasPlaying: true, snapshot: getPresetState(),
    gestures: [
      { kind: 'slider', id: 'cutoffSlider', t0: 1, t1: 2, points: [[1, 20], [2, 80]], gen: false },
      { kind: 'discrete', t: 3, type: 'scale', v: 2, gen: false },
    ],
  };
  const el = document.getElementById('cutoffSlider');
  return { lo: +el.min, hi: +el.max, snap: +getPresetState().sliders.cutoffSlider, scale: SCALES[2].name.toUpperCase() };
};

test('a take begins where the engine was, and replays from there', async ({ page }) => {
  await openFile(page);
  const frame = await enterCompose(page);
  // Armed with the transport stopped; the engine's Play at 12.5 s begins it.
  await frame.evaluate(() => { if (isPlaying) stopSeq(); perfRecStart(); });
  expect(await frame.evaluate(() => perfArmed)).toBe(true);
  await page.evaluate(() => { playbackTime = () => 12.5; seqSync(true); });
  await frame.waitForFunction(() => !!perfRec, null, { timeout: 5_000 });
  expect(await frame.evaluate(() => perfRec.startAt), 'the take did not note where it began').toBe(12.5);
  await page.evaluate(() => seqSync(false));
  await frame.waitForFunction(() => !perfRec, null, { timeout: 5_000 });

  // A take made at ten: at 10.5 on the engine it is half a second in, and at
  // four it has not begun — the replay waits six seconds. Read in the same
  // instant the replay is laid, since its head moves on the audio clock after.
  await frame.evaluate(TAKE_AT_TEN);
  const laid = await frame.evaluate(() => {
    if (perfReplay) perfStop();
    seqBridge.takePlayAt(10.5);
    const at = { head: perfReplay.playheadT, clock: perfNow() - perfReplay.t0 };
    perfStop();
    seqBridge.takePlayAt(4);
    const before = perfReplay.playheadT;
    perfStop();
    return { ...at, before };
  });
  expect(laid.head, 'the take replayed from its own start, not from where it was played').toBeCloseTo(0.5, 6);
  expect(laid.clock).toBeCloseTo(0.5, 2);
  expect(laid.before, 'a take replayed before it began did not wait').toBeCloseTo(-6, 6);

  // Through the host's transport, which adds only the time since.
  await page.evaluate(() => { playbackTime = () => 10.5; seqSync(true); });
  await frame.waitForFunction(() => !!perfReplay, null, { timeout: 5_000 });
  const live = await frame.evaluate(() => perfReplay.playheadT);
  expect(live).toBeGreaterThanOrEqual(0.49);
  expect(live).toBeLessThan(3);
  await page.evaluate(() => seqSync(false));
});

test('the take reaches the timeline as a SEQ group, in engine seconds, with its tempo', async ({ page }) => {
  await openFile(page);
  const frame = await enterCompose(page);
  const want = await frame.evaluate(TAKE_AT_TEN);
  const bpm = await frame.evaluate(() => bpm);
  await page.waitForFunction(() => seq.take && seq.take.id === 'take-at-ten', null, { timeout: 5_000 });
  const got = await page.evaluate(() => {
    state.automation.lanes = [{
      id: 'g1', target: 'stretch.grain.rateHz', label: 'Grains — Rate', enabled: true,
      points: [{ frame: 0, value: 0.2 }, { frame: laneFrames(), value: 0.8 }],
    }];
    state.automationSel = 'g1';
    renderAutomation();
    const data = perfTimelineData();
    return {
      lanes: seq.take.lanes.map((l) => ({ id: l.id, target: l.target, points: l.points })),
      discretes: seq.take.discretes,
      tempo: seq.tempo,
      groups: data.groups.map((g) => [g.key, g.lanes.length]),
      headed: data.headed,
      hits: perfLaneHits.map((h) => h.id || `group:${h.group}`),
      menu: [...$('perfLaneSelect').querySelectorAll('optgroup')].map((g) => g.label),
      struct: perfDiscretes().filter((d) => d.seq).map((d) => d.label),
      header: $('perfHeaderInfo').textContent,
    };
  });
  const unit = (v) => (v - want.lo) / (want.hi - want.lo);
  expect(got.lanes.map((l) => l.id)).toEqual(['seq:cutoffSlider']);
  const pts = got.lanes[0].points;
  expect(pts[0][0], 'the lane does not start where the take began').toBeCloseTo(10, 6);
  expect(pts[0][1]).toBeCloseTo(unit(want.snap), 6);
  expect(pts[1][0], 'the gesture is not in engine seconds').toBeCloseTo(11, 6);
  expect(pts[1][1]).toBeCloseTo(unit(20), 6);
  expect(pts[pts.length - 1][0]).toBeCloseTo(12, 6);
  expect(pts[pts.length - 1][1]).toBeCloseTo(unit(80), 6);
  expect(got.discretes).toEqual([{ t: 13, label: `SCALE ${want.scale}` }]);
  expect(got.tempo.bpm).toBe(bpm);
  expect(got.groups).toEqual([['grain', 1], ['seq', 1]]);
  expect(got.headed).toBe(true);
  expect(got.hits).toEqual(['group:grain', 'g1', 'group:seq', 'seq:cutoffSlider']);
  expect(got.menu).toEqual(['GRAIN', 'SEQ']);
  expect(got.struct).toEqual([`SCALE ${want.scale}`.slice(0, 10)]);
  expect(got.header).toMatch(/SEQ 1/);

  // Deleted in the sequencer, it leaves the host's timeline.
  await frame.evaluate(() => { perfLoaded = null; });
  await page.waitForFunction(() => seq.take === null, null, { timeout: 5_000 });
  expect(await page.evaluate(() => perfTimelineData().groups.map((g) => g.key))).toEqual(['grain']);
});

test('REC PERF arms the sequencer too, and the playhead is on output time', async ({ page }) => {
  await openFile(page);
  const frame = await enterCompose(page);
  await page.evaluate(() => { startPlayback = () => { engine.playing = true; }; });
  await page.evaluate(() => startCapture());
  await frame.waitForFunction(() => perfArmed === true, null, { timeout: 5_000 });
  await page.evaluate(() => endCapture());
  await frame.waitForFunction(() => perfArmed === false, null, { timeout: 5_000 });

  // SEQ off: its recorder is left alone.
  await page.evaluate(async () => { setSource('seq', false); await startCapture(); });
  await page.waitForTimeout(400);
  expect(await frame.evaluate(() => perfArmed), 'SEQ off, and its recorder was armed anyway').toBe(false);
  await page.evaluate(async () => { await endCapture(); setSource('seq', true); });

  const head = await page.evaluate(() => {
    const real = playbackTime;
    engine.playing = true;
    playbackTime = () => 6.25;
    const t = perfHeadT();
    engine.playing = false;
    playbackTime = real;
    return t;
  });
  expect(head).toBe(6.25);
});

test('a group folds with one click, and a sequencer lane is shown here but edited in Seq', async ({ page }) => {
  await openFile(page);
  const frame = await enterCompose(page);
  await frame.evaluate(TAKE_AT_TEN);
  await page.waitForFunction(() => seq.take && seq.take.id === 'take-at-ten', null, { timeout: 5_000 });
  const got = await page.evaluate(() => {
    localStorage.removeItem('audiolab.perfGroups');
    perfGroupsCollapsed = {};
    state.automation.lanes = [{
      id: 'g1', target: 'stretch.grain.rateHz', label: 'Grains — Rate', enabled: true,
      points: [{ frame: 0, value: 0.2 }, { frame: laneFrames(), value: 0.8 }],
    }];
    state.automationSel = 'g1';
    renderAutomation();
    const tl = $('perfCanvas');
    const r = tl.getBoundingClientRect();
    const clickHead = () => {
      const head = perfLaneHits.find((h) => h.group === 'seq' && !h.id);
      tl.dispatchEvent(new MouseEvent('click', { clientX: r.left + 20, clientY: r.top + (head.y0 + head.y1) / 2, bubbles: true }));
    };
    clickHead();
    const folded = {
      stored: JSON.parse(localStorage.getItem('audiolab.perfGroups') || '{}').seq,
      laneShown: perfLaneHits.some((h) => h.id === 'seq:cutoffSlider'),
    };
    clickHead();
    const reopened = perfLaneHits.some((h) => h.id === 'seq:cutoffSlider');
    const sel = $('perfLaneSelect');
    sel.value = 'seq:cutoffSlider';
    sel.dispatchEvent(new Event('change'));
    const lanesBefore = state.automation.lanes.length;
    $('perfLaneDel').click();
    return {
      folded, reopened,
      note: document.querySelector('#automationLanes .perf-seq-note')?.textContent || '',
      editors: document.querySelectorAll('#automationLanes .automation-canvas').length,
      kept: state.automation.lanes.length === lanesBefore,
    };
  });
  expect(got.folded.stored, 'the fold was not kept').toBe(true);
  expect(got.folded.laneShown, 'a folded group still drew its lanes').toBe(false);
  expect(got.reopened).toBe(true);
  expect(got.note).toMatch(/SEQUENCER LANE/);
  expect(got.editors, 'a sequencer lane opened the grain lane editor').toBe(0);
  expect(got.kept, 'delete on a sequencer lane removed a grain lane').toBe(true);
});

test('the bars follow the sequencer\'s tempo, and go when SEQ is off', async ({ page }) => {
  await openFile(page);
  const frame = await enterCompose(page);
  await frame.evaluate(() => { bpm = 90; });
  await page.waitForFunction(() => seq.tempo && seq.tempo.bpm === 90, null, { timeout: 5_000 });
  const got = await page.evaluate(() => {
    const on = perfBars(20);
    setSource('seq', false);
    const off = perfBars(20);
    setSource('seq', true);
    return { on, off };
  });
  const bar = (60 / 90) * 4;
  expect(got.on.length).toBe(Math.floor(20 / bar) + 1);
  for (let i = 1; i < got.on.length; i++) expect(got.on[i] - got.on[i - 1]).toBeCloseTo(bar, 6);
  expect(got.off).toEqual([]);
});
