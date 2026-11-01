// The Chop panel: Recycle Reborn, in the dock. See `ui/chop.js`.
//
// Recycle Reborn (github.com/rjvaleo/Recycle-Reborn) finds the sounds in a file
// by the silences between them, lets you listen to each, gives each an optional
// ping-pong loop tail, and writes them out as WAVs. Its cutting and its tail are
// carried over line for line, so the first test pins them to what the original
// produces on the same signal: the numbers below were taken by running the
// original's own functions on it.

import { test, expect } from '@playwright/test';

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

async function openChop(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.locator('.dock-tab[data-dock="chop"]').click();
  await expect(page.locator('#dockChop')).toBeVisible();
  // The selected sound has been read and cut before anything else is tried.
  await page.waitForFunction(() => window.Chop.state.slices > 0, null, { timeout: 20_000 });
}

/// The test signal, loaded into the panel as if it were the selected sound.
async function loadSignal(page) {
  await page.evaluate((src) => {
    const { rate, mono } = eval(src);
    window.Chop.loadSamples([mono], rate, 'break');
  }, SIGNAL);
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

test('Chop is a tab in the dock, and slices the selected sound', async ({ page }) => {
  await openChop(page);
  // The scratch library's sounds are unbroken tones: one slice each.
  await expect(page.locator('#dockChop .chop-row')).toHaveCount(1);
  await expect(page.locator('#dockChop .chop-stat[data-k="clips"] b')).toHaveText('1');
  await expect(page.locator('#dockChop canvas.chop-wave')).toBeVisible();
});

test('the sliders re-cut it as they move', async ({ page }) => {
  await openChop(page);
  await loadSignal(page);
  await expect(page.locator('#dockChop .chop-row')).toHaveCount(5);
  await page.evaluate(() => {
    for (const [id, v] of [['chopTopDb', 60], ['chopMinDur', 100], ['chopPad', 30]]) {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await expect(page.locator('#dockChop .chop-row')).toHaveCount(4);
  await expect(page.locator('#dockChop .chop-stat[data-k="clips"] b')).toHaveText('4');
});

test('with the tail on, each slice says what tail it gets', async ({ page }) => {
  await openChop(page);
  await loadSignal(page);
  await page.locator('#chopTail').check();
  const badges = page.locator('#dockChop .chop-row .tail-badge');
  await expect(badges).toHaveText(['tail ↓53ms', 'tail ↓50ms', 'tail 80ms', 'tail ↓43ms', 'tail ↓13ms']);
});

test('a click on the waveform picks the slice under it', async ({ page }) => {
  await openChop(page);
  await loadSignal(page);
  const canvas = page.locator('#dockChop canvas.chop-wave');
  const box = await canvas.boundingBox();
  // Slice 3 runs from sample 38912 to 53760 of 88200.
  await page.mouse.click(box.x + box.width * (46000 / 88200), box.y + box.height / 2);
  await expect(page.locator('#dockChop .chop-row.current .chop-idx')).toHaveText('3');
});

test('Write slices sends each one, named for the sound, as a WAV', async ({ page }) => {
  await openChop(page);
  await loadSignal(page);
  const sent = [];
  await page.route('**/api/chop/save**', async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataBuffer();
    sent.push({ name: url.searchParams.get('name'), p: url.searchParams.get('p'),
                riff: body.subarray(0, 4).toString(), bytes: body.length });
    await route.fulfill({ json: { path: `kit/break slices/${url.searchParams.get('name')}`, name: url.searchParams.get('name') } });
  });
  await page.locator('#dockChop .chop-write').click();
  await expect.poll(() => sent.length).toBe(5);
  expect(sent.map((s) => s.name)).toEqual(['break_0001.wav', 'break_0002.wav', 'break_0003.wav', 'break_0004.wav', 'break_0005.wav']);
  expect(sent.every((s) => s.riff === 'RIFF')).toBe(true);
  // 16-bit mono: the header and two bytes a frame, as Recycle Reborn wrote it.
  expect(sent[0].bytes).toBe(44 + (11776 - 3584) * 2);
  await expect(page.locator('#dockChop .chop-said')).toContainText('5 slices');
});
