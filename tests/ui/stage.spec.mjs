// The stage: one room with real light in it.
//
// See `docs/PORT-PLAN.md`. What is worth testing is what the old renderers could
// not do, and the two faults that made this hard to see.

import { test, expect } from '@playwright/test';

async function openStage(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof stAttach === 'function' && typeof BABYLON !== 'undefined',
    { timeout: 30_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    localStorage.removeItem('roomData');
    roomEdit.stage = {};
    setMode('room');
  });
  await page.waitForSelector('#roomStageRoom #visStage, #roomStageRoom #visGl',
    { state: 'attached', timeout: 20_000 });
  await page.evaluate(() => setVisual('stage'));
  await page.waitForFunction(() => {
    const c = document.getElementById('visStage');
    return c && c.clientWidth > 100;
  }, null, { timeout: 15_000 });
  // **Stop the app's own loop.**
  //
  // It calls `frame` sixty times a second with the playhead at nought whenever
  // nothing is playing. Interleaved with frames driven from a test that resets
  // the clock between every one of them, and every grain dies the instant it is
  // born — measured, four thousand born and four thousand dead with never one
  // alive. The cloud was working the whole time and the probe was fighting it.
  await page.evaluate(() => {
    if (typeof visGlRaf !== 'undefined' && visGlRaf) { cancelAnimationFrame(visGlRaf); visGlRaf = null; }
  });
}

/// Drive the room over real frames.
///
/// Real frames because Babylon compiles a material's shader asynchronously: a
/// hundred frames in one synchronous turn never lets it finish, `isReady` stays
/// false, and the mesh is silently skipped. A probe that hurries is a probe that
/// lies.
const RUN = `(async (patch, opts) => {
  const r = visLive.stage;
  const s = { ...stageSettings(), ...(patch || {}) };
  r.configure(s); r.clear();
  const burst = (a, c) => {
    const n = 1024, q = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / n, e = Math.exp(-Math.pow((t - c) * 7, 2));
      const x = Math.sin(i * 0.35) * e * a;
      q[i*2] = x; q[i*2+1] = x;
    }
    return q;
  };
  const bands = new Float32Array(128).fill(-18);
  for (let i = 0; i < 70; i++) {
    r.push(bands, burst(0.85 * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.7))), 0.5 + Math.sin(i * 0.31) * 0.07));
  }
  const sr = 44100, grains = [];
  for (let i = 0; i < 4000; i++) {
    grains.push([Math.round((i / 4000) * 4 * sr), 0, Math.round(0.25 * sr), 0, 0, 0, Math.sin(i * 0.13) * 0.8, i]);
  }
  const frames = (opts && opts.frames) || 30;
  for (let k = 0; k < frames; k++) {
    r.frame({ stage: s, stagePaint: ridgePaint(), clock: 5 + k * 0.0333,
      grains, grainRate: sr, position: Math.round((k / frames) * 2 * sr), positionRate: sr });
    await new Promise(res => requestAnimationFrame(res));
  }
  const c = document.getElementById('visStage');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const buf = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let lit = 0, sum = 0, max = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const m = Math.max(buf[i], buf[i+1], buf[i+2]);
    if (m > 24) lit++;
    if (m > max) max = m;
    sum += m;
  }
  return { litPct: +(100 * lit / (c.width * c.height)).toFixed(2),
    mean: +(sum / (c.width * c.height)).toFixed(1), max, stats: r.stats() };
})`;

test('the room is lit, and the light can be turned off', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(`(async () => ({
    lit: await ${RUN}({}),
    dark: await ${RUN}({ keyOn: false, fillOn: false, rimOn: false, ambient: 0, cloudOn: false }),
  }))()`);

  // **Lamps that do something.** Every renderer before this drew lines that emit
  // their own light, where switching the lighting off is not a question that can
  // be asked. Here it is, and the answer has to be darkness.
  expect(got.lit.mean, 'the room is not lit').toBeGreaterThan(12);
  expect(got.dark.mean, 'putting every lamp out changed nothing')
    .toBeLessThan(got.lit.mean * 0.6);
});

test('the cloud fills and empties rather than filling up', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(`${RUN}({ cloudOn: true }, { frames: 40 })`);
  const s = got.stats;

  // Grains are born and grains die, and neither number is the other.
  expect(s.born, 'no grain was ever born').toBeGreaterThan(50);
  expect(s.died, 'nothing ever died, so the cloud only fills up').toBeGreaterThan(10);
  expect(s.live, 'the cloud is empty at the end').toBeGreaterThan(20);
  expect(s.live, 'the cloud never lets anything go').toBeLessThan(s.born);

  // **The playhead reaches it.** `now` at nought with births happening is
  // impossible from one caller, and was the tell that something else was calling
  // `frame` with a stopped transport in between.
  expect(s.now, 'the cloud never saw the playhead move').toBeGreaterThan(0.5);
});

test('the cloud is drawn, not merely counted', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(`(async () => ({
    on: await ${RUN}({ cloudOn: true }, { frames: 40 }),
    off: await ${RUN}({ cloudOn: false }, { frames: 40 }),
  }))()`);

  // A mesh with instances it never draws and a mesh with no instances look the
  // same from outside — identical to two decimal places, which is how a bad
  // bounding box and an unread colour buffer both presented. So the count is
  // checked *and* the picture.
  expect(got.on.stats.live, 'nothing was alive to draw').toBeGreaterThan(20);
  expect(got.on.mean, 'the cloud put no light in the room')
    .toBeGreaterThan(got.off.mean * 1.05);
});
