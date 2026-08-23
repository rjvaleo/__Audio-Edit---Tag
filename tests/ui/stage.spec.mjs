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

test('the sound is what gives off the light', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(`(async () => ({
    lit: await ${RUN}({}),
    noGlow: await ${RUN}({ glow: 0 }),
    noLamps: await ${RUN}({ keyOn: false, fillOn: false, rimOn: false, ambient: 0 }),
  }))()`);

  expect(got.lit.mean, 'nothing was drawn at all').toBeGreaterThan(4);

  // **GLOW is the picture.** This started out the other way round — lamps
  // pointed at the sound — and the result was a lit grey object in a lit grey
  // room, with the walls the most prominent thing in frame. Correct, and
  // rudimentary. The look this program has always had is that the signal emits
  // and nothing else does, so taking the glow away has to take the picture with
  // it.
  expect(got.noGlow.mean, 'the glow is not what is drawing the picture')
    .toBeLessThan(got.lit.mean * 0.55);

  // And the lamps are for modelling the grains, not for lighting the scene —
  // putting them out dims the solids and leaves the glowing lines alone. A test
  // that demanded darkness here would be describing the version that was wrong.
  expect(got.noLamps.mean, 'the lamps do nothing at all')
    .toBeLessThan(got.lit.mean);
  expect(got.noLamps.mean, 'the lamps are still lighting the whole room')
    .toBeGreaterThan(got.lit.mean * 0.3);
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
  // Two runs of real frames through a ten-mesh scene: slower than the default
  // allows, and measuring fewer frames would weaken the thing being measured.
  test.setTimeout(90_000);
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

test('the ring is a surface the light runs along', async ({ page }) => {
  await openStage(page);
  // The rest of the room is switched off, including the sleeve — a scene with
  // nine objects in it is one where any single object is a rounding error, and
  // this test is about the ring.
  //
  // **Asked at a size where the answer is not noise.** At its default the tube is
  // a sixth of the room across and seen down its own axis, so it moves a
  // whole-frame average by about four per cent — which is drawing, but is too
  // close to nothing to assert on. Widened, the same question has an obvious
  // answer, and it is the same ring either way.
  const got = await page.evaluate(`(async () => ({
    on: await ${RUN}({ ringOn: true, ringSize: 0.5, cloudOn: false, terrainOn: false, sleeveOn: false }),
    off: await ${RUN}({ ringOn: false, ringSize: 0.5, cloudOn: false, terrainOn: false, sleeveOn: false }),
  }))()`);

  // It puts light in the room, and taking it away takes that light with it.
  expect(got.on.mean, 'the ring drew nothing').toBeGreaterThan(got.off.mean * 1.1);

  // **A surface, not a stack of hoops.** The old room draws the Lissajous as
  // wire, which cannot catch a highlight; the point of moving it here is that a
  // lamp can find it. A lit tube has a bright side and a dark one, so the
  // brightest pixel is well above the flat colour it is painted in.
  expect(got.on.max, 'the ring is not being lit, only coloured').toBeGreaterThan(150);
});

test('the sleeve is on the walls, and each face can be taken away', async ({ page }) => {
  await openStage(page);
  const bare = { cloudOn: false, ringOn: false, terrainOn: false, mistOn: false };
  const got = await page.evaluate(`(async () => ({
    all: await ${RUN}({ ...${JSON.stringify(bare)}, sleeveOn: true, sleeveRelief: 0.5 }),
    none: await ${RUN}({ ...${JSON.stringify(bare)}, sleeveOn: false }),
    noBack: await ${RUN}({ ...${JSON.stringify(bare)}, sleeveOn: true, sleeveRelief: 0.5, sleeveBack: false }),
  }))()`);

  // It is there, and switching the whole thing off takes it away.
  expect(got.all.mean, 'the sleeve drew nothing')
    .toBeGreaterThan(got.none.mean * 1.05);

  // **And face by face.** Five surfaces of the same sound look alike from a
  // distance, so "something is drawn" proves nothing about which. Taking one
  // away has to change the picture, or they are not five things.
  expect(Math.abs(got.noBack.mean - got.all.mean), 'the back wall is not its own face')
    .toBeGreaterThan(0.3);

  // Lit, not merely coloured: a ridge standing off a wall has a bright side.
  expect(got.all.max, 'the sleeve is not catching any light').toBeGreaterThan(120);
});

test('the pads move two things at once, and up is more', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof setVisual === 'function', { timeout: 30_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('room');
  });
  await page.waitForTimeout(700);
  await page.selectOption('#rgVisual', 'stage');
  await page.waitForTimeout(800);

  const shape = await page.evaluate(() => {
    const e = document.getElementById('stageEdit');
    return {
      groups: e.querySelectorAll('.st-group').length,
      pads: e.querySelectorAll('.st-pad').length,
      // Every control described has to be reachable: a setting in `ST_UI` that
      // no group claims still gets a slider under "Other", so adding one cannot
      // quietly strand it.
      placed: new Set([
        ...[...e.querySelectorAll('[data-st-key]')].map((x) => x.dataset.stKey),
        ...[...e.querySelectorAll('.st-pad')].flatMap((x) => [x.dataset.stPadX, x.dataset.stPadY]),
      ]).size,
      described: ST_UI.length,
    };
  });
  expect(shape.pads, 'no pads were built').toBeGreaterThan(8);
  expect(shape.groups, 'the controls are not grouped').toBeGreaterThan(5);
  expect(shape.placed, 'a described control has no control').toBe(shape.described);

  // **One gesture, two numbers.** The point of a pad is that the pair moves
  // together; if only one axis answered it would be a slider wearing a square.
  const pad = await page.$('[data-st-pad-x="keySide"]');
  await pad.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => stageSettings());
  // 80% across a range of −1..1, and 20% from the top, which is 80% *up*.
  expect(after.keySide).toBeCloseTo(0.6, 1);
  expect(after.keyHigh, 'up is not more').toBeCloseTo(0.6, 1);
});

test('the preview is a proxy, and the film gets all of it', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(async () => {
    const r = visLive.stage;
    const eng = BABYLON.EngineStore.Instances[BABYLON.EngineStore.Instances.length - 1];
    const sc = eng.scenes[eng.scenes.length - 1];
    const build = async (detail) => {
      const s = { ...stageSettings(), detail };
      r.configure(s); r.clear();
      const bands = new Float32Array(128).fill(-18);
      for (let i = 0; i < 30; i++) r.push(bands, new Float32Array(2048));
      r.frame({ stage: s, stagePaint: ridgePaint(), clock: 5 });
      await new Promise(res => requestAnimationFrame(res));
      const t = sc.meshes.find((m) => m.name === 'stterrmesh');
      return { verts: t ? t.getTotalVertices() : 0, rows: s.rows, points: s.points };
    };
    return { coarse: await build(0.25), mid: await build(0.55), full: await build(1) };
  });

  // **Fewer of the same lines.** A proxy is the same picture drawn with less of
  // it, which is what a video editor cuts against before delivering at 4K.
  expect(got.coarse.verts, 'the preview is not any coarser').toBeLessThan(got.full.verts * 0.3);
  expect(got.mid.verts).toBeGreaterThan(got.coarse.verts);
  expect(got.full.verts).toBeGreaterThan(got.mid.verts);

  // And the numbers themselves do not move: they are the full counts, and what
  // the detail scales is how many of them get built. A preview that edited the
  // settings would hand the film whatever the preview happened to be set to.
  expect(got.coarse.rows).toBe(got.full.rows);
  expect(got.coarse.points).toBe(got.full.points);
  // 120 rows × 320 samples, which is what the film is meant to draw.
  expect(got.full.verts).toBe(got.full.rows * got.full.points);
});

test('the film asks for full detail whatever the preview is set to', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(async () => {
    const why = videoExportSupport();
    if (why) return { skip: why };
    roomEdit.stage = { ...stageSettings(), detail: 0.2 };

    const m = VIS_MODULES.find((x) => x.key === 'stage');
    if (!m.__real) m.__real = m.attach;
    const asked = [];
    m.attach = (canvas) => {
      const r = m.__real(canvas);
      if (!r) return r;
      const rc = r.configure.bind(r);
      r.configure = (s) => { asked.push(s && s.detail); return rc(s); };
      return r;
    };
    const size = { key: 'test', label: 'test', w: 320, h: 180 };
    try {
      await videoExport({
        path: state.selectedFile.path,
        from: 0, to: 0, repeats: 1, tail: 0, size, fps: 30,
        module: 'stage',
        ridge: ridgeSettings(), ridgePaint: ridgePaint(),
        room3d: room3dSettings(), room3dPaint: ridgePaint(),
        stage: stageSettings(), stagePaint: ridgePaint(),
        text: roomTextSettings(), textPaint: roomTextPaint(),
        camera: roomCameraForAspect(size.w / size.h),
        layers: roomLayers(), occlude: roomOcclude(), order: roomOrder(),
        room: { cold: [0.2, 0.45, 0.85], hot: [1, 0.72, 0.35], core: [0.55, 0.85, 1],
          paint: rpForRenderer(), geom: roomGeom() },
        onStage: () => {},
      });
    } finally {
      m.attach = m.__real;
    }
    return { asked, preview: stageSettings().detail };
  });
  if (got.skip) test.skip(true, got.skip);

  expect(got.preview, 'the preview was not left coarse').toBeCloseTo(0.2, 2);
  // **Every configure the film makes asks for all of it.** A film shot at the
  // preview's detail is a 4K picture of a proxy.
  expect(got.asked.length).toBeGreaterThan(0);
  expect(got.asked.every((d) => d === 1), `the film asked for ${got.asked.join(', ')}`).toBe(true);
});
