// The master bus panels.
//
// Three displays reading one tap, in the room the grain views left behind. They
// share a poll, a payload and a set of canvases, so a fault in the plumbing
// takes all three out together and none of them says so — a blank meter looks
// exactly like a quiet passage.
//
// The signal here is injected rather than played. These run against a real
// library on somebody's machine, and a test suite that makes noise through the
// speakers to check a needle moves is not a thing to inflict on anyone. The
// numbers are measured in Rust, where `core/crates/audio-core/tests/meter.rs`
// checks them against signals with known answers; what is left to check here is
// that the panel is wired to them.

import { test, expect } from '@playwright/test';

/// A payload shaped exactly like `/api/engine/master`.
const FEED = `(() => {
  const N = 1024, xy = [];
  for (let i = 0; i < N; i++) {
    const t = i / 48000;
    xy.push(+(0.62 * Math.sin(2*Math.PI*220*t)).toFixed(2),
            +(0.50 * Math.sin(2*Math.PI*220*t + 0.5)).toFixed(2));
  }
  const BANDS = 256, lo = 20, hi = 20000, spectrum = [];
  for (let i = 0; i < BANDS; i++) {
    const hz = lo * Math.pow(hi/lo, (i+0.5)/BANDS);
    spectrum.push(Math.max(-96, -70 + 68 * Math.exp(-Math.pow(Math.log(hz/1000), 2) * 6)));
  }
  return { live: true, rate: 48000, frames: 16384,
    left:  { vu: 0.19, vuDb: -14.4, vuUnits: 3.6, peak: 0.74, peakDb: -2.6 },
    right: { vu: 0.16, vuDb: -15.9, vuUnits: 2.1, peak: 0.66, peakDb: -3.6 },
    correlation: 0.78, overKnee: 0.012, vuRef: -18, knee: 0.7079458,
    lo, hi, spectrum, lissajous: xy };
})()`;

async function tray(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
    showPane('right', 'stretch');
  });
  await page.waitForTimeout(800);
}

/// Paint one frame from the fixture, with the live poll held off so it cannot
/// overwrite the fixture between the draw and the assertion.
///
/// The flat goniometer and spectrum are gone — the room replaced them — so what
/// is left to check here is the ladders, the numbers, and that the room stands
/// up at all.
async function paint(page) {
  return page.evaluate((feed) => {
    clearInterval(masterBus.timer);
    masterBus.timer = null;
    masterBus.data = eval(feed);
    masterBus.specHold = null;
    mbUpdateHold(performance.now());
    drawMasterVu(); paintMasterReads();
    if (visGl) visGl.push(masterBus.data.spectrum);
    const lit = (id) => {
      const c = document.getElementById(id);
      if (!c || !c.width) return -1;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
      return n / (d.length / 4);
    };
    const txt = (id) => document.getElementById(id)?.textContent ?? null;
    const room = document.getElementById('visGl');
    return {
      visible: mbVisible(),
      vuLit: lit('mbVu'),
      // The room is WebGL; a pixel read outside its own frame callback comes
      // back cleared, so what is checked is that it attached and has a size.
      roomAttached: !!visGl,
      roomSize: room ? [room.clientWidth, room.clientHeight] : null,
      lvu: txt('mbLvu'), lrms: txt('mbLrms'), lpk: txt('mbLpk'),
      rvu: txt('mbRvu'), corr: txt('mbCorrBig'), word: txt('mbCorrWord'),
      peakHz: txt('mbPeakHz'), stateNote: txt('mbState'),
    };
  }, FEED);
}

test('the master bus draws its meters and stands up its room', async ({ page }) => {
  await tray(page);
  const out = await paint(page);

  expect(out.visible, 'the panel is not on screen in the Time & Pitch tray').toBe(true);
  expect(out.vuLit, 'the VU canvas came back blank').toBeGreaterThan(0.01);
  // Headless Chromium has no GPU unless it is given one, so a missing context
  // here is the harness and not the code — the panel is expected to survive it,
  // which is what the fallback message is for.
  if (out.roomAttached) {
    expect(out.roomSize[0], 'the room has no width').toBeGreaterThan(50);
    expect(out.roomSize[1], 'the room has no height').toBeGreaterThan(50);
  }
});

test('the readouts say what the payload says', async ({ page }) => {
  await tray(page);
  const out = await paint(page);

  // A real minus sign, and the VU column in units rather than dBFS — those are
  // two different numbers and swapping them is invisible unless one is checked.
  expect(out.lvu).toBe('+3.6');
  expect(out.lrms).toBe('−14.4');
  expect(out.lpk).toBe('−2.6');
  expect(out.rvu).toBe('+2.1');
  expect(out.corr).toBe('+0.78');
  expect(out.word).toBe('stereo');
  // One short word, always — a wrapping word changes the row height and moves
  // every reading below it.
  expect(out.word.includes(' '), 'the correlation word can wrap').toBe(false);
  // 1.2% of the last hundred milliseconds was above the ceiling's knee.
  expect(out.stateNote).toBe('ceiling 1%');
});

test('the analyser names the frequency it found, and the note', async ({ page }) => {
  await tray(page);
  const out = await paint(page);
  // The fixture's peak is at 1 kHz. B5 is 987.77 Hz — the nearest note to the
  // centre of the band that holds it.
  expect(out.peakHz, 'the analyser did not report a peak at all').toBeTruthy();
  expect(out.peakHz).toContain('987 Hz');
  expect(out.peakHz).toContain('B5');
});

test('silence reads as silence and not as a number', async ({ page }) => {
  await tray(page);
  const out = await page.evaluate(() => {
    clearInterval(masterBus.timer);
    masterBus.timer = null;
    masterBus.data = {
      live: true, rate: 48000, frames: 16384,
      left:  { vu: 0, vuDb: -120, vuUnits: -102, peak: 0, peakDb: -120 },
      right: { vu: 0, vuDb: -120, vuUnits: -102, peak: 0, peakDb: -120 },
      correlation: 1, overKnee: 0, vuRef: -18, knee: 0.7079458,
      lo: 20, hi: 20000, spectrum: new Array(256).fill(-120), lissajous: [],
    };
    masterBus.hold = { l: -120, r: -120, lAt: 0, rAt: 0 };
    paintMasterReads();
    return { lvu: document.getElementById('mbLvu').textContent,
             lrms: document.getElementById('mbLrms').textContent };
  });
  // The VU column is a difference from the reference, so at the floor the
  // arithmetic yields −102.0 — a real number, and a meaningless one. Printing
  // it makes silence look like a measurement.
  expect(out.lvu).toBe('−∞');
  expect(out.lrms).toBe('−∞');
});

test('with no engine the panels are empty rather than stale', async ({ page }) => {
  await tray(page);
  await paint(page);
  const after = await page.evaluate(() => {
    masterBus.data = null;
    masterBus.hold = { l: -120, r: -120, lAt: 0, rAt: 0 };
    drawMasterVu(); paintMasterReads();
    return { lvu: document.getElementById('mbLvu').textContent,
             stateNote: document.getElementById('mbState').textContent,
             corr: document.getElementById('mbCorrBig').textContent };
  });
  // Freezing on the last reading is the one behaviour a meter may not have.
  expect(after.lvu).toBe('—');
  expect(after.corr).toBe('—');
  expect(after.stateNote).toBe('idle');
});
