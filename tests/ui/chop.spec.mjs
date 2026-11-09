// Chop: Recycle Reborn, ReCycle's slice editing and Ratchet's grid, on a page of
// its own. See `ui/app/400-chop-cut.js` and `docs/CHOP.md`.
//
// Recycle Reborn (github.com/rjvaleo/Recycle-Reborn) finds the sounds in a file
// by the silences between them, lets you listen to each, gives each an optional
// ping-pong loop tail, and writes them out as WAVs. Its cutting and its tail are
// carried over line for line, so the first test pins them to what the original
// produces on the same signal: the numbers below were taken by running the
// original's own functions on it.

import { test, expect } from './test.mjs';

/// The signal the expectations were taken from: five decaying 220 Hz bursts in
/// two seconds of silence, the last one only 15 ms long.
const SIGNAL = `(() => {
  const rate = 44100, n = rate * 2;
  const mono = new Float32Array(n);
  const burst = (at, len) => { const s = Math.round(at * rate), m = Math.round(len * rate);
    for (let i = 0; i < m; i++) mono[s + i] = 0.8 * Math.exp(-i / (m / 4)) * Math.sin(i * 2 * Math.PI * 220 / rate); };
  burst(0.1, 0.15); burst(0.5, 0.15); burst(0.9, 0.3); burst(1.4, 0.12); burst(1.8, 0.015);
  return { rate, mono };
})()`;

/// What Recycle Reborn's `detectSegs` gives for it, by top_db / min ms / pad ms.
const RECYCLE = {
  '40/40/12': [[3584, 11776], [21504, 29184], [38912, 53760], [60928, 67584], [78848, 80896]],
  '25/40/12': [[3584, 9728], [21504, 27648], [38912, 50176], [60928, 66048], [78848, 80384]],
  '40/10/0': [[4096, 11264], [22016, 28672], [39424, 53248], [61440, 67072], [79360, 80384]],
  '60/100/30': [[2560, 12800], [20480, 30208], [37888, 54784], [59904, 68608]],
};

const N = 88200;

async function openChop(page) {
  await page.goto('/');
  // Each test starts from the settings' starting points, whatever the last left.
  await page.evaluate(() => { localStorage.removeItem('chopSettings'); localStorage.removeItem('chopPresets'); });
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setEditPage('chop');
    setMode('edit');
  });
  await expect(page.locator('#dockChop')).toBeVisible();
  // The selected sound has been read and cut before anything else is tried.
  await page.waitForFunction(() => window.Chop.state.slices > 0, null, { timeout: 20_000 });
}

/// The test signal, loaded as if it were the selected sound. The detail shows
/// a new sound whole, so a place on it is a place in those two seconds.
async function loadSignal(page, settings = {}) {
  await page.evaluate(([src, settings, n]) => {
    const { rate, mono } = eval(src);
    window.Chop.set(settings);
    window.Chop.loadSamples([mono], rate, 'break');
    window.Chop.repaint();
  }, [SIGNAL, settings, N]);
  // The measures arrive from a worker and redraw the overlay; wait, so a test
  // never holds an element that is about to be replaced.
  await page.evaluate(() => window.Chop.analysed());
}

/// Where frame `f` is on the lane, in page pixels.
async function laneAt(page, f, yFrac = 0.5) {
  const box = await page.locator('#chopLane').boundingBox();
  return [box.x + box.width * (f / N), box.y + box.height * yFrac];
}

test('it cuts exactly where Recycle Reborn cuts, and makes the same tail', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.Chop, null, { timeout: 20_000 });
  const got = await page.evaluate((src) => {
    const { rate, mono } = eval(src);
    const C = window.Chop;
    const rms = C.buildRms(mono);
    const cuts = {};
    for (const key of ['40/40/12', '25/40/12', '40/10/0', '60/100/30']) {
      const [db, md, pad] = key.split('/').map(Number);
      cuts[key] = C.detectSegs(rms, db, md, pad, rate, mono.length);
    }
    const segs = cuts['40/40/12'];
    const tails = segs.map(([s, e]) => {
      const p = C.getTailParams(s, e, 80, rate);
      return p.viable ? [p.tailLen, p.numCycles, p.clamped, p.totalFrames] : null;
    });
    const t = C.buildPingPongTail([mono], segs[2][0], segs[2][1], 80, rate);
    let sum = 0;
    for (const v of t.interleaved) sum += v;
    return { cuts, tails, tailSum: +sum.toFixed(6), tailFrames: t.totalFrames,
             tailAt: [1000, 9000, 15000, t.totalFrames - 5].map((i) => +t.interleaved[i].toFixed(7)) };
  }, SIGNAL);
  expect(got.cuts).toEqual(RECYCLE);
  expect(got.tails).toEqual([[2340, 8, true, 26912], [2194, 8, true, 25232], [3528, 7, false, 39544],
    [1901, 8, true, 21864], [585, 8, true, 6728]]);
  expect(got.tailFrames).toBe(39544);
  expect(got.tailSum).toBeCloseTo(17.380471, 3);
  expect(got.tailAt).toEqual([0.4676605, 0.0070091, 0.0256622, 0]);
});

test('the Chop page has its own detail, with the slices on it', async ({ page }) => {
  await openChop(page);
  // The scratch library's sounds are unbroken tones: one slice each.
  await expect(page.locator('#dockChop .chop-row')).toHaveCount(1);
  await expect(page.locator('#dockChop .chop-stat[data-k="clips"] b')).toHaveText('1');
  await expect(page.locator('#chopLane canvas')).toBeVisible();
  await expect(page.locator('#chopLane .chop-layer')).toBeVisible();
  await expect(page.locator('#chopLane .chop-slice')).toHaveCount(1);
  await expect(page.locator('#chopLane .chop-flag.s')).toBeVisible();
  await expect(page.locator('#chopLane .chop-flag.e')).toBeVisible();
});

test('Transient puts a cut at every hit, each slice running to the next', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'transient' });
  const slices = await page.evaluate(() => window.Chop.slices);
  expect(slices).toHaveLength(5);
  const hits = [0.1, 0.5, 0.9, 1.4, 1.8].map((t) => t * 44100);
  slices.forEach((x, i) => {
    expect(Math.abs(x.s - hits[i])).toBeLessThan(300);
    expect(x.e).toBe(i < 4 ? slices[i + 1].s : N);
  });
  await expect(page.locator('#chopLane .chop-slice')).toHaveCount(5);
  await expect(page.locator('#chopLane .chop-cut')).toHaveCount(5);
});

test('Silence re-cuts it as the knobs move, as Recycle Reborn did', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'silence' });
  await expect(page.locator('#dockChop .chop-row')).toHaveCount(5);
  expect((await page.evaluate(() => window.Chop.slices)).map((x) => [x.s, x.e])).toEqual(RECYCLE['40/40/12']);
  await page.evaluate(() => window.Chop.set({ topDb: 60, minDur: 100, pad: 30 }));
  await expect(page.locator('#dockChop .chop-row')).toHaveCount(4);
  await expect(page.locator('#dockChop .chop-stat[data-k="clips"] b')).toHaveText('4');
  // And the knob itself turns it: the wheel down on Threshold finds fewer.
  await page.evaluate(() => window.Chop.set({ topDb: 40, minDur: 40, pad: 12 }));
  const thr = page.locator('#chopKnobs .knob[data-k="topDb"] svg:not(.gl)');
  await expect(thr).toBeVisible();
  for (let i = 0; i < 10; i++) await thr.dispatchEvent('wheel', { deltaY: 100 });
  expect((await page.evaluate(() => window.Chop.settings)).topDb).toBeLessThan(40);
});

test('Grid cuts on every grid line at the tempo, nudged and shuffled', async ({ page }) => {
  await openChop(page);
  // Two seconds as one bar of 4/4 is 120 BPM: an eighth is 11025 frames.
  await loadSignal(page, { mode: 'grid', div: '8', bars: 1 });
  expect(await page.evaluate(() => window.Chop.bpm())).toBeCloseTo(120, 5);
  let starts = (await page.evaluate(() => window.Chop.slices)).map((x) => x.s);
  expect(starts).toEqual([0, 11025, 22050, 33075, 44100, 55125, 66150, 77175]);
  await expect(page.locator('#chopLane .chop-ticks i')).toHaveCount(8);
  await page.locator('#chopDiv button[data-v="4"]').click();
  await expect(page.locator('#dockChop .chop-row')).toHaveCount(4);
  // A quarter-note triplet is two thirds of a beat: six in the bar.
  await page.locator('#chopFeel button[data-v="trip"]').click();
  await expect(page.locator('#dockChop .chop-row')).toHaveCount(6);
  await page.evaluate(() => window.Chop.set({ div: '8', feel: 'straight', shuffle: 75 }));
  starts = (await page.evaluate(() => window.Chop.slices)).map((x) => x.s);
  // Every second line half a step late.
  expect(starts.slice(0, 4)).toEqual([0, 11025 + 5513, 22050, 33075 + 5513]);
  await expect(page.locator('#chopStatus')).toContainText('1/8 · plays at 120.0 BPM');
  await expect(page.locator('#chopStatus2')).toHaveText('chop every 0.250 s');
});

test('with the tail on, each slice says what tail it gets', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'silence' });
  await page.locator('#chopKnobs .chop-tail-on').click();
  const badges = page.locator('#dockChop .chop-row .tail-badge');
  await expect(badges).toHaveText(['↓53 ms', '↓50 ms', '80 ms', '↓43 ms', '↓13 ms']);
});

test('a click on the detail picks the slice under it', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'silence' });
  // Slice 3 runs from sample 38912 to 53760 of 88200.
  await page.mouse.click(...await laneAt(page, 46000));
  await expect(page.locator('#dockChop .chop-row.current .chop-idx')).toHaveText('3');
  await expect(page.locator('#chopLane .chop-slice.current')).toHaveAttribute('data-i', '2');
  await page.evaluate(() => window.Chop.stop());
});

test('dragging a cut on the ruler moves it; off the ruler deletes it', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'transient' });
  const cut = page.locator('#chopLane .chop-cut[data-i="2"]');
  const b = await cut.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 2);
  await page.mouse.down();
  const [x] = await laneAt(page, 35000);
  await page.mouse.move(x, b.y + 2, { steps: 4 });
  await page.mouse.up();
  let after = await page.evaluate(() => window.Chop.slices);
  expect(Math.abs(after[2].s - 35000)).toBeLessThan(200);
  expect(after[1].e).toBe(after[2].s);
  expect(after[2].moved).toBe(true);
  await expect(page.locator('#chopEdited')).toHaveText('1 moved');
  // A moved cut survives cutting again.
  await page.evaluate(() => window.Chop.set({ sens: 65 }));
  after = await page.evaluate(() => window.Chop.slices);
  expect(after.some((s) => s.s === after.find((y) => y.moved).s)).toBe(true);
  expect(after.find((y) => y.moved).s).toBeLessThan(36000);

  // Off the ruler, and it goes: the slice joins the one before.
  const count = after.length;
  const c3 = await page.locator('#chopLane .chop-cut[data-i="3"]').boundingBox();
  await page.mouse.move(c3.x + c3.width / 2, c3.y + 2);
  await page.mouse.down();
  await page.mouse.move(c3.x + c3.width / 2, c3.y + 200, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.Chop.slices.length)).toBe(count - 1);
});

test('the lock tool locks a cut, which stays when cut again; the pencil adds one', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'transient' });
  await page.locator('#chopTools button[data-v="lock"]').click();
  await page.locator('#chopLane .chop-cut[data-i="1"]').click();
  await expect(page.locator('#chopLane .chop-cut.locked')).toHaveCount(1);
  const locked = (await page.evaluate(() => window.Chop.slices))[1].s;
  // Cut again on the grid instead: every hit's cut goes, the locked one stays.
  await page.evaluate(() => window.Chop.set({ mode: 'grid', div: '8' }));
  const after = await page.evaluate(() => window.Chop.slices);
  expect(after.some((x) => x.s === locked && x.locked)).toBe(true);

  await page.locator('#chopTools button[data-v="pencil"]').click();
  const n = after.length;
  await page.mouse.click(...await laneAt(page, 70000));
  const added = await page.evaluate(() => window.Chop.slices);
  expect(added).toHaveLength(n + 1);
  expect(added.some((x) => Math.abs(x.s - 70000) < 100)).toBe(true);
});

test('S and E set what is chopped; double-click on the ruler is the whole sound', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'transient' });
  const e = await page.locator('#chopLane .chop-flag.e').boundingBox();
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  const [x] = await laneAt(page, 60000);
  await page.mouse.move(x, e.y + e.height / 2, { steps: 5 });
  await page.mouse.up();
  const r = await page.evaluate(() => window.Chop.region);
  expect(Math.abs(r.e - 60000)).toBeLessThan(200);
  expect(await page.evaluate(() => window.Chop.slices.length)).toBe(3);
  const ruler = await page.locator('#chopLane .chop-ruler').boundingBox();
  await page.mouse.dblclick(...await laneAt(page, 80000).then(([px]) => [px, ruler.y + 8]));
  expect(await page.evaluate(() => window.Chop.region)).toEqual({ s: 0, e: N });
});

test('Rev, Gate and Pitch change the sound of a slice; Mute keeps it out', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'silence' });
  const got = await page.evaluate(() => {
    const C = window.Chop;
    const plain = C.sliceAudio(2)[0];
    C.pick(2);
    C.toggle('rev');
    const rev = C.sliceAudio(2)[0];
    C.toggle('rev');
    C.set({ gate: 50 });
    const gated = C.sliceAudio(2)[0].length;
    C.set({ gate: 100, pitch: 12 });
    const up = C.sliceAudio(2)[0].length;
    C.set({ pitch: 0 });
    return { len: plain.length, revOk: rev[0] === plain[plain.length - 1] && rev[100] === plain[plain.length - 101], gated, up };
  });
  expect(got.len).toBe(53760 - 38912);
  expect(got.revOk).toBe(true);
  expect(got.gated).toBe(Math.round(got.len / 2));
  expect(got.up).toBe(Math.floor(got.len / 2));
  await page.locator('#chopLane .chop-slice[data-i="1"]').click({ modifiers: ['Shift'] });
  await page.evaluate(() => window.Chop.pick(1));
  await page.locator('#chopMute').click();
  await expect(page.locator('#chopLane .chop-slice.muted')).toHaveCount(1);
  await expect(page.locator('#dockChop .chop-row.muted')).toHaveCount(1);
});

test('the processing rows shape the sound, and each has its own on switch', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'silence' });
  const energy = () => page.evaluate(() => { const c = window.Chop.sliceAudio(2)[0]; let s = 0; for (const v of c) s += v * v; return s; });
  const dry = await energy();
  for (const [fx, on, settings] of [
    ['env', 'envOn', { decay: 50 }],
    ['filter', 'fltOn', { fltType: 'hp', fltFreq: 5000 }],
    ['eq', 'eqOn', { loCut: 800 }],
    ['trans', 'trOn', { trAmount: -100, trThresh: -60, trGain: -6 }],
  ]) {
    const sw = page.locator(`.chop-fxs[data-fx="${fx}"] .chop-fxs-on`);
    await page.evaluate((s) => window.Chop.set(s), settings);
    await sw.click();
    expect((await page.evaluate(() => window.Chop.settings))[on]).toBe(true);
    await expect(sw).toHaveClass(/\bon\b/);
    expect(await energy()).toBeLessThan(dry * 0.9);
    await sw.click();
    expect(await energy()).toBeCloseTo(dry, 6);
  }
});

// RJ, 5 Nov 2026: "instead of having all of those behind a button … display
// each one of those right in line there … that title as the headline", in
// "the visual icon style developed for the grain modules".
test('Envelope, Transient, EQ and Filter are all in line at once, each headed, as knobs over their sliders', async ({ page }) => {
  await openChop(page);
  await expect(page.locator('#chopFxTab')).toHaveCount(0);
  const got = await page.evaluate(() => [...document.querySelectorAll('#dockChop .chop-fxs')].map((s) => ({
    fx: s.dataset.fx,
    head: s.querySelector('.chop-fxs-name')?.textContent,
    top: Math.round(s.getBoundingClientRect().top),
    shown: s.getClientRects().length > 0,
    bars: [...s.querySelectorAll('.gk-row')].map((r) => ({
      k: r.dataset.k, pic: !!r.querySelector(':scope > svg.gg path, :scope > svg.gg line, :scope > svg.gg circle, :scope > svg.gg rect'),
      fc: r.style.getPropertyValue('--fc'), range: !!r.querySelector(':scope > input[type=range]'),
      cut: (() => { const k = r.querySelector(':scope > .k'); return k.scrollWidth > k.clientWidth; })(),
    })),
  })));
  expect(got.map((s) => [s.fx, s.head])).toEqual([['env', 'Envelope'], ['trans', 'Transient'], ['eq', 'EQ'], ['filter', 'Filter']]);
  expect(got.map((s) => s.bars.length)).toEqual([2, 5, 8, 5]);
  for (const s of got) {
    expect(s.shown, `${s.fx} is shown`).toBe(true);
    expect(s.top, `${s.fx} is on the same line as Envelope`).toBe(got[0].top);
    for (const b of s.bars) {
      expect(b.pic, `${b.k} has a picture`).toBe(true);
      expect(b.range, `${b.k} still has its slider`).toBe(true);
      expect(b.fc, `${b.k} has a function colour`).toMatch(/--f-(attack|level|pitch|space|time|tone)/);
      expect(b.cut, `${b.k}'s name is whole`).toBe(false);
    }
  }
});

test('a processing control sets its setting, and follows a setting made elsewhere', async ({ page }) => {
  await openChop(page);
  const got = await page.evaluate(async () => {
    const row = document.querySelector('.chop-fxs[data-fx="trans"] .gk-row[data-k="trThresh"]');
    const input = row.querySelector('input[type=range]');
    input.value = -30;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const set = window.Chop.settings.trThresh;
    const pic = row.querySelector('svg.gg').innerHTML;
    window.Chop.set({ trThresh: -6 });
    return { set, after: row.querySelector('.v').textContent, picMoved: row.querySelector('svg.gg').innerHTML !== pic };
  });
  expect(got.set).toBe(-30);
  expect(got.after).toContain('-6');
  expect(got.picMoved, 'the picture follows the value').toBe(true);
});

test('Preview lays the slices out at the play tempo; Ratchet fires the chop on every grid line', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'transient', bars: 1 });
  const got = await page.evaluate(() => {
    const C = window.Chop;
    const a = C.renderPreview();
    C.set({ tempo: 60 });
    const b = C.renderPreview();
    C.set({ tempo: 0, div: '8', gate: 50 });
    const r = C.renderRatchet();
    return { a: a.chs[0].length, b: b.chs[0].length, at: b.map.map((m) => m.at),
             fires: r.map.map((m) => m.at), fireLen: r.map[0].len, loop: r.chs[0].length };
  });
  expect(got.a).toBe(88200);
  expect(got.b).toBe(176400);
  expect(got.fires).toEqual([0, 11025, 22050, 33075, 44100, 55125, 66150, 77175]);
  expect(got.fireLen).toBe(Math.round(11025 / 2));
  expect(got.loop).toBe(88200);
  await page.locator('#chopPreview').click();
  await expect.poll(() => page.evaluate(() => window.Chop.playing)).toBe('preview');
  await page.locator('#chopPreview').click();
  await expect.poll(() => page.evaluate(() => window.Chop.playing)).toBe('');
});

test('A and B hold two settings; a preset saves and comes back; Init puts it all back', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'transient' });
  await page.evaluate(() => window.Chop.set({ sens: 90 }));
  await page.locator('#chopB').click();
  expect((await page.evaluate(() => window.Chop.settings)).sens).toBe(60);
  await page.locator('#chopA').click();
  expect((await page.evaluate(() => window.Chop.settings)).sens).toBe(90);
  page.once('dialog', (d) => d.accept('Hot'));
  await page.locator('#chopSave').click();
  await page.locator('#chopInit').click();
  expect((await page.evaluate(() => window.Chop.settings)).sens).toBe(60);
  await page.locator('#chopPreset').selectOption('Hot');
  expect((await page.evaluate(() => window.Chop.settings)).sens).toBe(90);
  await page.locator('#chopDice').click();
  await expect(page.locator('#dockChop .chop-row').first()).toBeVisible();
});

test('Write slices sends each one that is not muted, named for the sound, with the MIDI and SFZ', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'silence' });
  const sent = [];
  await page.route('**/api/chop/save**', async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataBuffer();
    sent.push({ name: url.searchParams.get('name'), p: url.searchParams.get('p'),
                head: body.subarray(0, 4).toString(), bytes: body.length, text: body.toString() });
    await route.fulfill({ json: { path: `kit/break slices/${url.searchParams.get('name')}`, name: url.searchParams.get('name') } });
  });
  // The path a written slice is beside: any file in the library will do here.
  await page.evaluate(() => { window.Chop.pick(4); window.Chop.toggle('muted'); });
  await page.locator('#chopOutMidi').click();
  await page.locator('#chopOutSfz').click();
  await page.locator('#dockChop .chop-write').click();
  await expect.poll(() => sent.length).toBe(6);
  expect(sent.map((s) => s.name)).toEqual(['break_0001.wav', 'break_0002.wav', 'break_0003.wav', 'break_0004.wav', 'break.mid', 'break.sfz']);
  expect(sent.slice(0, 4).every((s) => s.head === 'RIFF')).toBe(true);
  // 16-bit mono: the header and two bytes a frame, as Recycle Reborn wrote it.
  expect(sent[0].bytes).toBe(44 + (11776 - 3584) * 2);
  expect(sent[4].head).toBe('MThd');
  expect(sent[5].text).toContain('<region> sample=break_0004.wav key=39');
  await expect(page.locator('#dockChop .chop-said')).toContainText('4 slices and the MIDI and SFZ');
});

test('the slices show on the Chop page only, softened by the switch', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'silence' });
  const layer = page.locator('#chopLane .chop-layer');
  await expect(page.locator('#chopLane .chop-slice')).toHaveCount(5);
  // Off the Chop page the lane is the sound alone.
  for (const p of ['wave', 'prism']) {
    await page.evaluate((p) => setEditPage(p), p);
    await expect(layer).toBeHidden();
  }
  await page.evaluate(() => setEditPage('chop'));
  await expect(layer).toBeVisible();
  // The switch softens them, and its wheel sets how much.
  await page.locator('.chop-soft').click();
  await expect(layer).toHaveClass(/soft/);
  const op = () => page.locator('#chopLane .chop-slice').first().evaluate((el) => +getComputedStyle(el).opacity);
  expect(await op()).toBeCloseTo(0.3, 2);
  await page.locator('.chop-soft').dispatchEvent('wheel', { deltaY: 100 });
  expect(await op()).toBeCloseTo(0.25, 2);
  await page.reload();
  await page.waitForFunction(() => window.Chop);
  expect(await page.evaluate(() => window.Chop.soft)).toEqual({ on: true, alpha: 0.25 });
  await page.evaluate(() => localStorage.removeItem('chopSoft'));
});

test('→ Regions puts every slice that is not muted into the Region manager, once', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'silence' });
  const posted = [];
  await page.route('**/api/markers', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = JSON.parse(route.request().postData());
    posted.push(body);
    await route.fulfill({ json: { markers: body.markers, regions: body.regions } });
  });
  await page.evaluate(() => { state.annotations = { markers: [], regions: [] }; window.Chop.pick(1); window.Chop.toggle('muted'); });
  await page.locator('#chopToRegions').click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].regions.map((r) => [r.start, r.end, r.label])).toEqual(
    RECYCLE['40/40/12'].filter((_, i) => i !== 1).map(([s, e], j) => [s, e, `break ${[1, 3, 4, 5][j]}`]));
  await expect(page.locator('#dockChop .chop-said')).toContainText('4 slices added to Regions');
  await page.locator('#chopToRegions').click();
  await expect(page.locator('#dockChop .chop-said')).toContainText('already');
  expect(posted.length).toBe(1);
  await expect(page.locator('#regionList .region-item')).toHaveCount(4);
});

test('nothing hides by mode: a knob that makes no cuts dims and stays where it is', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'transient' });
  const place = () => page.evaluate(() => [...document.querySelectorAll('#chopKnobs .knob')].map((k) => {
    const r = k.getBoundingClientRect();
    return [k.dataset.k, Math.round(r.left), k.classList.contains('dim')];
  }));
  const transient = await place();
  await page.locator('#chopMode button[data-v="grid"]').click();
  const grid = await place();
  expect(grid.map((k) => k.slice(0, 2))).toEqual(transient.map((k) => k.slice(0, 2)));
  expect(transient.find((k) => k[0] === 'shuffle')[2]).toBe(true);
  expect(grid.find((k) => k[0] === 'shuffle')[2]).toBe(false);
  // Ratchet uses Shuffle in every mode, so a dimmed one still works.
  await page.locator('#chopMode button[data-v="transient"]').click();
  await page.locator('#chopKnobs .knob[data-k="shuffle"] svg:not(.gl)').dispatchEvent('wheel', { deltaY: -100 });
  expect((await page.evaluate(() => window.Chop.settings)).shuffle).toBeGreaterThan(50);
});

test('Detect finds the tempo and counts the bars, and ½× and 2× correct it', async ({ page }) => {
  await openChop(page);
  // Four bars of 4/4 at 120: a click on every beat.
  await page.evaluate(() => {
    const rate = 44100, n = rate * 8, mono = new Float32Array(n);
    for (let b = 0; b < 16; b++) { const at = Math.round(b * rate / 2); for (let i = 0; i < 2000; i++) mono[at + i] = 0.9 * Math.exp(-i / 300) * ((i * 7919) % 13 > 6 ? 1 : -1); }
    window.Chop.loadSamples([mono], rate, 'clicks');
    window.Chop.detect();
  });
  const s = () => page.evaluate(() => [window.Chop.settings.bars, window.Chop.settings.beats, +window.Chop.bpm().toFixed(1)]);
  expect(await s()).toEqual([4, 0, 120]);
  await expect(page.locator('#chopTempoSaid')).toHaveText('4 bars, loops even');
  await page.locator('#chopDouble').click();
  expect(await s()).toEqual([8, 0, 240]);
  await page.locator('#chopHalf').click();
  await page.locator('#chopHalf').click();
  expect(await s()).toEqual([2, 0, 60]);
});

test('every slice is measured and named, and the colour row says what the colour means', async ({ page }) => {
  await openChop(page);
  await page.evaluate(() => {
    const rate = 44100, n = rate * 2, mono = new Float32Array(n);
    // A low thump and a burst of noise, a second apart.
    for (let i = 0; i < 6000; i++) mono[2000 + i] = 0.9 * Math.exp(-i / 2500) * Math.sin(i * 2 * Math.PI * 55 / rate);
    let v = 12345;
    for (let i = 0; i < 4000; i++) { v = (v * 16807) % 2147483647; mono[46000 + i] = 0.7 * Math.exp(-i / 700) * ((v % 2001) / 1000 - 1); }
    window.Chop.loadSamples([mono], rate, 'hits');
    window.Chop.set({ mode: 'silence' });
  });
  await page.evaluate(() => window.Chop.analysed());
  await expect.poll(() => page.evaluate(() => window.Chop.kinds)).toEqual(['Kick', 'Hat']);
  await expect(page.locator('#chopList .chop-row .chop-kind')).toHaveText(['Kick', 'Hat']);
  await page.locator('#chopColour button[data-v="kind"]').click();
  await expect(page.locator('#chopLegend')).toContainText('Kick 1');
  await page.locator('#chopColour button[data-v="pitch"]').click();
  await expect(page.locator('#chopLegend')).toContainText('none');
  await expect(page.locator('#chopPickAn')).toContainText('bright');
});

test('all five of Grain\'s Looks apply, and orange still means on in each', async ({ page }) => {
  await openChop(page);
  for (const k of ['AD', 'A', 'B', 'C', 'D']) {
    await page.locator(`#chopLook button[data-s="${k}"]`).click();
    const got = await page.evaluate(() => {
      const app = document.querySelector('.chop-app'), s = getComputedStyle(app);
      return { look: app.dataset.look, acc: s.getPropertyValue('--acc').trim(), wave: s.getPropertyValue('--wave').trim() };
    });
    expect(got.look).toBe(k);
    expect(got.acc).toBe('#ffb547');
    expect(got.wave).not.toBe('');
  }
  await page.locator('#chopLook button[data-s="AD"]').click();
  await page.evaluate(() => localStorage.removeItem('mglLook'));
});

test('the page fits: nothing runs off it and nothing is cut off', async ({ page }) => {
  await openChop(page);
  await loadSignal(page, { mode: 'transient' });
  const got = await page.evaluate(() => {
    const app = document.querySelector('.chop-app'), r = app.getBoundingClientRect();
    const wide = (s) => { const e = document.querySelector(s); return e.scrollWidth - e.clientWidth; };
    return { bar: wide('.chop-top'), cut: wide('.chop-cutrow'), foot: wide('.chop-foot'), list: wide('#chopList'),
             tall: app.scrollHeight - app.clientHeight, cutOff: [...document.querySelectorAll('.chop-app .knob > .k')].filter((k) => k.scrollWidth > k.clientWidth + 1 && getComputedStyle(k).overflow !== 'visible').length, onScreen: r.right <= innerWidth + 1 };
  });
  expect(got).toEqual({ bar: 0, cut: 0, foot: 0, list: 0, tall: 0, cutOff: 0, onScreen: true });
});

test('the transport and file tabs are moved in, and put back on leaving', async ({ page }) => {
  await openChop(page);
  expect(await page.evaluate(() => document.getElementById('playBtn').closest('#chopTransport') !== null)).toBe(true);
  await page.evaluate(() => setEditPage('grain'));
  await expect.poll(() => page.evaluate(() => document.getElementById('playBtn').closest('#transportBar') !== null)).toBe(true);
  await page.evaluate(() => setEditPage('chop'));
  await expect.poll(() => page.evaluate(() => document.getElementById('playBtn').closest('#chopTransport') !== null)).toBe(true);
});
