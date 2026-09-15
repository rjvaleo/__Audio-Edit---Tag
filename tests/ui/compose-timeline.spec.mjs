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
//   - a group folds with one click, and a sequencer lane opens in the editor
//     here and is deleted from its take;
//   - a sequencer lane edited here is the take's: a point dragged, a lane added,
//     moved onto another control and undone all reach the sequencer and stay;
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
  // Held where the take found it until the gesture takes it, as the take plays.
  expect(pts[1][0]).toBeCloseTo(11, 6);
  expect(pts[1][1], 'the knob was drawn moving before the gesture began').toBeCloseTo(unit(want.snap), 6);
  expect(pts[2][0], 'the gesture is not in engine seconds').toBeCloseTo(11, 6);
  expect(pts[2][1]).toBeCloseTo(unit(20), 6);
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

test('a group folds with one click, and a sequencer lane opens in the editor and is deleted from its take', async ({ page }) => {
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
    const open = {
      editors: document.querySelectorAll('#automationLanes .automation-canvas').length,
      lane: document.querySelector('#automationLanes .automation-lane')?.dataset.lane,
      target: document.querySelector('#automationLanes .automation-lane select')?.value,
      curveFixed: [...document.querySelectorAll('#automationLanes .automation-lane select')].some((s) => s.disabled),
    };
    const lanesBefore = state.automation.lanes.length;
    $('perfLaneDel').click();
    return { folded, reopened, open, kept: state.automation.lanes.length === lanesBefore, sel: state.automationSel };
  });
  expect(got.folded.stored, 'the fold was not kept').toBe(true);
  expect(got.folded.laneShown, 'a folded group still drew its lanes').toBe(false);
  expect(got.reopened).toBe(true);
  expect(got.open.editors, 'a sequencer lane did not open in the editor').toBe(1);
  expect(got.open.lane).toBe('seq:cutoffSlider');
  expect(got.open.target).toBe('seq.cutoffSlider');
  expect(got.open.curveFixed, 'a sequencer lane offered curves a take cannot play').toBe(true);
  expect(got.kept, 'delete on a sequencer lane removed a grain lane').toBe(true);
  // The editor moves on to the lane that is left, as it does for a grain lane.
  expect(got.sel).not.toBe('seq:cutoffSlider');
  // Deleted from the take itself, and gone from the timeline when it comes back.
  await frame.waitForFunction(() => !perfLoaded.gestures.some((g) => g.kind === 'slider'), null, { timeout: 5_000 });
  await page.waitForFunction(() => seq.take && seq.take.lanes.length === 0, null, { timeout: 5_000 });
});

test('a sequencer lane edited here is the take\'s: a point dragged, a lane added, moved and undone', async ({ page }) => {
  await openFile(page);
  const frame = await enterCompose(page);
  const want = await frame.evaluate(TAKE_AT_TEN);
  // Kept in the sequencer's list, so an edit is seen to be kept too.
  await frame.evaluate(() => perfSaveAll([perfLoaded, ...perfLoadAll().filter((t) => t.id !== perfLoaded.id)]));
  await page.waitForFunction(() => seq.take && seq.take.id === 'take-at-ten', null, { timeout: 5_000 });

  // It opens across the take, which runs well past this one-second sound.
  const at = await page.evaluate(() => {
    state.automationSel = 'seq:cutoffSlider';
    renderAutomation();
    const c = document.querySelector('#automationLanes .automation-canvas');
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    const lane = seqEditLane('seq:cutoffSlider');
    const span = laneSpanFrames(lane);
    const last = lane.points[lane.points.length - 1];
    return {
      span: span / perfRate(),
      x: r.left + (last.frame / span) * r.width,
      y: r.top + (1 - last.value) * r.height,
      toX: r.left + ((13 * perfRate()) / span) * r.width,
      toY: r.bottom - 1,
    };
  });
  expect(at.span, 'the editor does not reach the end of the take').toBeCloseTo(14, 1);

  // The last point — twelve seconds, the cutoff at 80 — dragged to thirteen,
  // and to the bottom of the range.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.toX, at.toY, { steps: 8 });
  await page.mouse.up();
  await frame.waitForFunction(() => {
    const g = perfLoaded.gestures.find((x) => x.kind === 'slider' && x.id === 'cutoffSlider');
    return g && Math.abs(g.t1 - 3) < 0.05;
  }, null, { timeout: 5_000 });
  const dragged = await frame.evaluate(() => {
    const g = perfLoaded.gestures.find((x) => x.kind === 'slider' && x.id === 'cutoffSlider');
    const kept = perfLoadAll().find((t) => t.id === 'take-at-ten');
    return {
      last: g.points[g.points.length - 1], first: g.points[0], startAt: perfLoaded.startAt,
      snap: +perfLoaded.snapshot.sliders.cutoffSlider, duration: perfLoaded.duration,
      kept: kept.gestures.find((x) => x.kind === 'slider' && x.id === 'cutoffSlider').t1,
      scale: perfLoaded.gestures.find((x) => x.kind === 'discrete').t,
    };
  });
  expect(dragged.startAt, 'the take moved').toBe(10);
  expect(dragged.last[0]).toBeCloseTo(3, 1);
  // The canvas's last pixel, which is within a hundredth of the range's foot.
  expect(dragged.last[1], 'the point did not go to the bottom of the control\'s range')
    .toBeLessThan(want.lo + (want.hi - want.lo) * 0.02);
  expect(dragged.first[0]).toBe(0);
  expect(dragged.snap, 'where the take finds the knob changed').toBeCloseTo(want.snap, 0);
  expect(dragged.kept, 'the edit was not kept in the sequencer\'s list of takes').toBeCloseTo(3, 1);
  expect(dragged.scale, 'the scale change moved').toBe(3);
  expect(dragged.duration).toBeGreaterThanOrEqual(4);

  // + LANE with a sequencer lane open adds the sequencer's first free control,
  // flat where the take found it.
  await page.evaluate(() => $('automationAdd').click());
  expect(await page.evaluate(() => state.automationSel)).toBe('seq:bpmSlider');
  await frame.waitForFunction(() => perfLoaded.gestures.some((g) => g.kind === 'slider' && g.id === 'bpmSlider'), null, { timeout: 5_000 });
  const tempo = await frame.evaluate(() => {
    const g = perfLoaded.gestures.find((x) => x.kind === 'slider' && x.id === 'bpmSlider');
    return { pts: g.points, bpm: +perfLoaded.snapshot.sliders.bpmSlider };
  });
  expect(tempo.pts.map(([t]) => t)).toEqual([0, 4]);
  for (const [, v] of tempo.pts) expect(v).toBeCloseTo(tempo.bpm, 0);

  // Moved onto the resonance: its moves go with it.
  await page.evaluate(() => {
    const pick = document.querySelector('#automationLanes .automation-lane select');
    pick.value = 'seq.resSlider';
    pick.dispatchEvent(new Event('change'));
  });
  await frame.waitForFunction(() => perfLoaded.gestures.some((g) => g.id === 'resSlider')
    && !perfLoaded.gestures.some((g) => g.id === 'bpmSlider'), null, { timeout: 5_000 });
  expect(await page.evaluate(() => state.automationSel)).toBe('seq:resSlider');

  // Undone: back on the tempo, and the dragged point still where it was put.
  await page.evaluate(() => $('automationUndo').click());
  await frame.waitForFunction(() => perfLoaded.gestures.some((g) => g.id === 'bpmSlider')
    && !perfLoaded.gestures.some((g) => g.id === 'resSlider'), null, { timeout: 5_000 });
  const undone = await frame.evaluate(() => perfLoaded.gestures.find((x) => x.kind === 'slider' && x.id === 'cutoffSlider').t1);
  expect(undone).toBeCloseTo(3, 1);
  await page.waitForFunction(() => seq.take && seq.take.lanes.some((l) => l.id === 'seq:bpmSlider'), null, { timeout: 5_000 });
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
