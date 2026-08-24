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

test('every control is labelled, reachable, and filed under its own object', async ({ page }) => {
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
    const sliders = [...e.querySelectorAll('[data-st-key]')].map((x) => x.dataset.stKey);
    return {
      folds: [...e.querySelectorAll('[data-st-fold]')].map((b) => b.dataset.stFold),
      open: [...e.querySelectorAll('[data-st-fold-body]')]
        .filter((b) => !b.classList.contains('hidden')).map((b) => b.dataset.stFoldBody),
      // **No pads.** A pad is two numbers with their names, their values and
      // their ranges taken off to save a row, and you cannot dial a number you
      // cannot read. `stagePad` is still in the source and nothing calls it.
      pads: e.querySelectorAll('.st-pad').length,
      sliders,
      // Nothing twice. `lift` used to be half of two different pads and
      // `bloomAmount` half of two others: moving one moved the other, and
      // neither said so.
      dupes: sliders.filter((k, i) => sliders.indexOf(k) !== i),
      // Everything described *and listed*. A setting can be hidden from the
      // panel without being deleted — see `ST_ADMIN_HIDDEN` — and the check is
      // that nothing offered goes missing, not that everything that exists is
      // offered.
      described: ST_UI.filter((r) => stInAdmin(r.key)).length,
      // Each section is named after the switch that turns its object on, so the
      // two halves of the panel say the same words in the same order.
      owners: ST_GROUPS.filter((g) => g.owner)
        .map((g) => [g.owner, !!ST_OBJECTS.find((o) => o.key === g.owner)]),
      note: !!e.querySelector('.st-note'),
      tagDupes: (() => {
        const tags = [...e.querySelectorAll('.re-tag')].map((t) => t.textContent);
        return tags.filter((t, i) => tags.indexOf(t) !== i);
      })(),
      cam: [...e.querySelectorAll('[data-st-key]')].slice(0, 4).map((x) => x.dataset.stKey),
    };
  });

  expect(shape.pads, 'a pad is still in the panel').toBe(0);
  // **No two controls share a name.** Two things called GLOW in one panel is the
  // same fault as two pads sharing an axis: you cannot tell which one you are
  // moving, and the one you wanted is somewhere else.
  expect(shape.tagDupes, 'two controls share a name').toEqual([]);
  expect(shape.dupes, 'a control is offered twice under two names').toEqual([]);
  expect(new Set(shape.sliders).size, 'a described control has no control').toBe(shape.described);
  // One section per object, and one of them open: fifty numbers are only a list
  // when they are all on screen at once.
  expect(shape.folds.length, 'the controls are not in sections').toBeGreaterThan(5);
  expect(shape.open.length, 'more than one section is open').toBe(1);
  for (const [key, exists] of shape.owners) {
    expect(exists, `${key} names a section but no switch`).toBe(true);
  }

  // **The camera is above the scene, not filed in it.** It is not a thing in the
  // room; it is where you are standing to look at the room.
  expect(shape.cam).toEqual(['orbit', 'tilt', 'dist', 'fov']);
  expect(shape.note, 'the panel does not say what the gestures are').toBe(true);
});

test('the picture can be turned over, and framed again', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(async () => {
    const cam = () => {
      const eng = BABYLON.EngineStore.Instances[BABYLON.EngineStore.Instances.length - 1];
      const sc = eng.scenes[eng.scenes.length - 1];
      return sc.activeCamera.position.asArray().map((v) => +v.toFixed(3));
    };
    const put = (patch) => {
      roomEdit.stage = { ...stageSettings(), ...patch };
      visLive.stage.configure(stageSettings());
      visLive.stage.frame({ stage: stageSettings(), stagePaint: ridgePaint() });
    };
    setVisual('g-mandala');
    const opened = { ...stageSettings() };
    put({ orbit: 0 }); const front = cam();
    put({ orbit: Math.PI / 2 }); const side = cam();
    put({ orbit: Math.PI }); const back = cam();
    put({ tilt: 1.2, orbit: 0 }); const above = cam();
    put({ dist: 6, tilt: 0 }); const far = cam();
    // Every view opens from a place that suits its shape.
    const opens = ST_LAYOUTS.map((l) => l.open && [l.open.orbit, l.open.tilt, l.open.dist]);
    setVisual('g-lattice');
    const lattice = { ...stageSettings() };
    put({ orbit: 2.2, tilt: -1, dist: 9, panX: 3 });
    frameStageView();
    const framed = { ...stageSettings() };
    return { opened: [opened.orbit, opened.tilt, opened.dist], front, side, back, above, far,
      opens, lattice: [lattice.orbit, lattice.tilt, lattice.dist],
      framed: [framed.orbit, framed.tilt, framed.dist, framed.panX] };
  });

  // **It goes round.** The rig this replaced slid the camera on a plane at a
  // fixed depth and aimed it down the room's axis — you could shuffle sideways
  // and squint at a thing but never get to the far side of it, which is the
  // whole of what these views are for.
  const r = (p) => Math.hypot(p[0], p[2]);
  expect(got.front[2], 'the camera is not in front at nought').toBeLessThan(0);
  expect(got.back[2], 'half a turn did not put it behind').toBeGreaterThan(0);
  expect(Math.abs(got.side[0]), 'a quarter turn did not put it to the side').toBeGreaterThan(1);
  expect(r(got.side)).toBeCloseTo(r(got.front), 1);
  // Tilt lifts it without changing how far away it is.
  expect(got.above[1], 'tilt did not raise it').toBeGreaterThan(got.front[1]);
  // Distance is distance.
  expect(r(got.far)).toBeGreaterThan(5);

  // Ten shapes, ten places to look at them from.
  expect(got.opens.every(Boolean), 'a view has no opening camera').toBe(true);
  expect(new Set(got.opens.map(String)).size, 'the views all open from the same place')
    .toBeGreaterThan(4);
  // Choosing a view puts the camera where that view opens.
  expect(got.opened, 'choosing a view did not frame it').toEqual(got.opens[6]);

  // **And back.** Finding your way home by hand after a good look round is the
  // one thing an orbit rig makes worse than a fixed one.
  expect(got.framed.slice(0, 3), 'framing it again did not put the camera back')
    .toEqual(got.lattice);
  expect(got.framed[3], 'framing it again left the target where it had been slid').toBe(0);
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

test('the picture itself is the control', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof setVisual === 'function', { timeout: 30_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    localStorage.removeItem('roomData');
    roomEdit.stage = {};
    setMode('room');
  });
  await page.waitForTimeout(700);
  await page.selectOption('#rgVisual', 'stage');
  await page.waitForTimeout(900);

  const read = () => page.evaluate(() => stageSettings());
  const box = await (await page.$('#visStage')).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const before = await read();

  // **Drag left and the subject turns left.** The picture follows the hand, the
  // way every map and every viewport has ever worked — and it *orbits*, which
  // the rig this replaced could not do at all.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 200, cy - 100, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const dragged = await read();
  expect(dragged.orbit, 'dragging the picture did not turn it')
    .toBeGreaterThan(before.orbit);
  expect(dragged.tilt, 'dragging up did not raise the camera')
    .toBeLessThan(before.tilt);

  // **Shift pans**, which is the modifier Blender and Maya both use for it, and
  // it slides the point being orbited rather than the camera — so you can look
  // at a corner of something instead of always its middle.
  await page.keyboard.down('Shift');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy - 120, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
  const panned = await read();
  expect(Math.abs(panned.panX - dragged.panX) + Math.abs(panned.panY - dragged.panY),
    'shift-drag did not slide the target').toBeGreaterThan(0.05);
  // And the turn stayed where it was put.
  expect(panned.orbit).toBeCloseTo(dragged.orbit, 5);

  // **Alt is the lamp**, moved off shift when the camera took the modifier every
  // other program uses for panning. Up is up: screen y grows downward, and a
  // lamp that goes down when you drag up is a lamp nobody can aim.
  await page.keyboard.down('Alt');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy - 120, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(250);
  const lamp = await read();
  expect(lamp.keySide, 'alt-drag did not move the key').toBeGreaterThan(panned.keySide);
  expect(lamp.keyHigh, 'dragging the lamp up sent it down').toBeGreaterThan(panned.keyHigh);

  // The wheel dollies, proportionally — a fixed step crawls when you are far out
  // and jumps through the subject when you are close.
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(250);
  expect((await read()).dist, 'the wheel did not dolly').toBeGreaterThan(lamp.dist);
});

test('the type stands in the space and is passed in front of', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(`(async () => {
    roomEdit.text = { ...rtSettings(roomEdit.text), on: true, text: 'UNKNOWN\\nPLEASURES' };
    return {
      off: await ${RUN}({ typeOn: false, cloudOn: false }),
      near: await ${RUN}({ typeOn: true, typeSize: 0.6, typeAt: 0.05, cloudOn: false }),
      far: await ${RUN}({ typeOn: true, typeSize: 0.6, typeAt: 0.95, cloudOn: false }),
    };
  })()`);

  // It is there.
  expect(got.near.mean, 'the type drew nothing').toBeGreaterThan(got.off.mean * 1.05);

  // **And it is in the space rather than over it.** Standing at the far end it
  // is behind everything and small; at the near end it is in front and large. A
  // sheet laid over the picture would look the same wherever it was told to
  // stand, which is exactly what the flat card does and why it belongs here
  // instead.
  expect(got.near.mean, 'moving the type through the space changed nothing')
    .toBeGreaterThan(got.far.mean * 1.15);
});

test('solo shows one thing without editing the switches', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(`(async () => {
    const before = { ...stageSettings() };
    const all = await ${RUN}({});
    const one = await ${RUN}({ solo: 'terrainOn' });
    const back = await ${RUN}({ solo: null });
    return { all: all.mean, one: one.mean, back: back.mean,
      switchesBefore: Object.fromEntries(ST_OBJECTS.map((o) => [o.key, before[o.key]])),
      switchesAfter: Object.fromEntries(ST_OBJECTS.map((o) => [o.key, stageSettings()[o.key]])) };
  })()`);

  // Soloed, there is less in the frame.
  expect(got.one, 'solo showed everything').toBeLessThan(got.all * 0.8);
  // And letting go puts it all back.
  expect(got.back, 'the scene did not come back').toBeCloseTo(got.all, 0);

  // **It is a filter, not an edit.** Turning the other eight off to look at one
  // means turning eight back on afterwards and hoping you remembered which.
  expect(got.switchesAfter, 'solo edited the switches').toEqual(got.switchesBefore);
});

test('every object is worth seeing on its own', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(`(async () => {
    roomEdit.text = { ...rtSettings(roomEdit.text), on: true, text: 'UNKNOWN' };
    const out = {};
    for (const k of ['terrainOn', 'ringOn', 'cloudOn', 'sleeveOn', 'typeOn']) {
      out[k] = (await ${RUN}({ solo: k, typeOn: true })).max;
    }
    return out;
  })()`);

  // **Bright enough to see, soloed.** This is the check that catches an object
  // going dark when something else changes underneath it: the grains are lit
  // solids, and when the lamps came down to modelling strength the brightest
  // grain in the room fell to 63 of 255 — findable, not visible — while the
  // scene as a whole looked fine because five other things were still in it.
  for (const [k, max] of Object.entries(got)) {
    expect(max, `${k} is too dark to see on its own`).toBeGreaterThan(110);
  }
});

test('the ten grain views are arrangements of the one cloud', async ({ page }) => {
  test.setTimeout(180_000);
  await openStage(page);
  const got = await page.evaluate(async () => {
    const r = visLive.stage;
    const sr = 44100, grains = [];
    for (let i = 0; i < 4000; i++) {
      grains.push([Math.round((i / 4000) * 4 * sr), 0, Math.round(0.25 * sr), 0, 0, 0, Math.sin(i * 0.13) * 0.8, i]);
    }
    const out = {};
    for (const l of ST_LAYOUTS) {
      const s = { ...stageSettings(), cloudLayout: l.key, solo: 'cloudOn', cloudDensity: 0.8 };
      r.configure(s); r.clear();
      const bands = new Float32Array(128).fill(-18);
      for (let i = 0; i < 40; i++) r.push(bands, new Float32Array(2048));
      for (let k = 0; k < 22; k++) {
        r.frame({ stage: s, stagePaint: ridgePaint(), clock: 5 + k * 0.033,
          grains, grainRate: sr, position: Math.round((k / 22) * 2.2 * sr), positionRate: sr });
        await new Promise((res) => requestAnimationFrame(res));
      }
      const c = document.getElementById('visStage');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const buf = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // A coarse fingerprint of where the ink is, so two arrangements are told
      // apart by their shape rather than by how much of it there is.
      const cells = new Array(16).fill(0);
      for (let y = 0; y < c.height; y += 3) {
        for (let x = 0; x < c.width; x += 3) {
          const i = (y * c.width + x) * 4;
          if (Math.max(buf[i], buf[i+1], buf[i+2]) > 40) {
            cells[Math.min(3, (y * 4 / c.height) | 0) * 4 + Math.min(3, (x * 4 / c.width) | 0)]++;
          }
        }
      }
      const total = cells.reduce((a, b) => a + b, 0) || 1;
      out[l.key] = { live: r.stats().live, shape: cells.map((v) => Math.round(v / total * 100)) };
    }
    return out;
  });

  const keys = Object.keys(got);
  expect(keys.length, 'there are not ten arrangements').toBe(10);

  for (const k of keys) {
    expect(got[k].live, `${k} put no grains in the room`).toBeGreaterThan(50);
    expect(got[k].shape.reduce((a, b) => a + b, 0), `${k} drew nothing`).toBeGreaterThan(50);
  }

  // **They have to be different pictures.** Ten names over one arrangement is
  // what a menu of aliases looks like, and the whole claim here is that the
  // difference between the grain views was only ever where a grain goes.
  const seen = new Map();
  for (const k of keys) {
    const sig = got[k].shape.join(',');
    if (seen.has(sig)) {
      throw new Error(`${k} and ${seen.get(sig)} draw the same picture`);
    }
    seen.set(sig, k);
  }
});

test('the palette paints the stage', async ({ page }) => {
  await openStage(page);
  const slots = await page.evaluate(() => rpSlots().map((s) => s.key));
  // Its own eight, not the room's fourteen and not the flat stack's three. It
  // is neither of those, and offering it either one's slots is offering controls
  // that paint nothing — which is what it did: a scheme applied while the stage
  // was up changed the room and left the stage exactly as it was.
  expect(slots).toContain('stageTerrain');
  expect(slots).toContain('stageGround');
  expect(slots, 'the stage is being offered the flat stack’s slots')
    .not.toContain('ridgeLine');

  const got = await page.evaluate(async () => {
    const before = stageSettings().terrainColour;
    rpSetSlot('stageTerrain', { mode: 'flat', colour: '#ff2200' });
    const after = stageSettings().terrainColour;

    // And it has to reach the picture, not merely the settings.
    const r = visLive.stage;
    const s = { ...stageSettings(), solo: 'terrainOn' };
    r.configure(s); r.clear();
    const bands = new Float32Array(128).fill(-18);
    for (let i = 0; i < 40; i++) r.push(bands, new Float32Array(2048));
    for (let k = 0; k < 18; k++) {
      r.frame({ stage: s, stagePaint: ridgePaint(), clock: 5 + k * 0.033 });
      await new Promise((res) => requestAnimationFrame(res));
    }
    const c = document.getElementById('visStage');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const buf = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let red = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i] > 80 && buf[i+1] < 70 && buf[i+2] < 70) red++;
    }
    rpSetSlot('stageTerrain', { mode: 'inherit' });
    return { before, after, red, back: stageSettings().terrainColour };
  });

  expect(got.after, 'the palette did not reach the settings').toBe('#ff2200');
  expect(got.red, 'the palette did not reach the picture').toBeGreaterThan(1000);
  // A slot left inheriting keeps the default: the colours in ST_DEFAULTS are
  // where a scheme starts from, not what it is stuck with.
  expect(got.back, 'inheriting did not go back to the default').toBe(got.before);
});

test('all ten views are ported, and each is drawn as strokes', async ({ page }) => {
  test.setTimeout(180_000);
  await openStage(page);
  const got = await page.evaluate(async () => {
    const r = visLive.stage;
    const sr = 44100, grains = [];
    // A schedule with variation in it: without a spread of pitch every grain
    // lands on the same colour and, in the folded views, on the same angle —
    // which is a real picture of a monotone cloud and a useless test.
    for (let i = 0; i < 3000; i++) {
      grains.push([Math.round((i / 3000) * 8 * sr), Math.round((i / 3000) * 3 * sr),
        Math.round((0.03 + (i % 7) * 0.01) * sr), ((i * 37) % 25) - 12,
        0.2 + 0.3 * Math.abs(Math.sin(i * 0.11)), 0.4, Math.sin(i * 0.13) * 0.8, i]);
    }
    const out = { ported: [], shapes: {} };
    for (const l of ST_LAYOUTS) {
      if (l.ported) out.ported.push(l.key);
      const s = { ...stageSettings(), cloudLayout: l.key, cloudInk: true,
        solo: 'cloudOn', cloudDensity: 1, detail: 1 };
      r.configure(s); r.clear();
      const bands = new Float32Array(128).fill(-18);
      for (let i = 0; i < 30; i++) r.push(bands, new Float32Array(2048));
      for (let k = 0; k < 18; k++) {
        r.frame({ stage: s, stagePaint: ridgePaint(), clock: 5 + k * 0.033,
          grains, schedule: grains, grainRate: sr,
          outFrames: 8 * sr, srcFrames: 3 * sr,
          position: Math.round(4 * sr), positionRate: sr });
        await new Promise((res) => requestAnimationFrame(res));
      }
      const c = document.getElementById('visStage');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const buf = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const cells = new Array(16).fill(0);
      let lit = 0;
      for (let y = 0; y < c.height; y += 3) {
        for (let x = 0; x < c.width; x += 3) {
          const i = (y * c.width + x) * 4;
          if (Math.max(buf[i], buf[i + 1], buf[i + 2]) > 40) {
            lit++;
            cells[Math.min(3, (y * 4 / c.height) | 0) * 4 + Math.min(3, (x * 4 / c.width) | 0)]++;
          }
        }
      }
      const total = cells.reduce((a, b) => a + b, 0) || 1;
      out.shapes[l.key] = { lit, ink: r.stats().inked,
        shape: cells.map((v) => Math.round(v / total * 100)) };
    }
    return out;
  });

  // **All ten, not one.** The count is written down so that a view quietly
  // falling back to the placement-only sketch is a failure rather than a
  // slightly worse picture nobody notices.
  expect(got.ported.length, 'a view is not ported').toBe(10);

  for (const [k, v] of Object.entries(got.shapes)) {
    expect(v.ink, `${k} put no strokes in the room`).toBeGreaterThan(50);
    expect(v.lit, `${k} drew nothing`).toBeGreaterThan(200);
  }

  // And they are still ten different pictures rather than ten names over one.
  const keys = Object.keys(got.shapes);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = got.shapes[keys[i]].shape, b = got.shapes[keys[j]].shape;
      const apart = a.reduce((sum, v, n) => sum + Math.abs(v - b[n]), 0);
      expect(apart, `${keys[i]} and ${keys[j]} are the same picture`).toBeGreaterThan(8);
    }
  }
});

test('a look belongs to the view it was set on', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(() => {
    // Every view opens as itself: Braid wants long trails and Shear wants none,
    // and one set of controls for all ten means every switch of view is
    // followed by a re-dial.
    const opens = Object.fromEntries(ST_LAYOUTS.map((l) => [l.key, stLook(stageSettings(), l.key)]));
    setVisual('g-vortex');
    setViewLook({ glow: 0.42, colourBy: 'size' });
    const vortex = stLook(stageSettings(), 'vortex');
    const shear = stLook(stageSettings(), 'shear');
    return {
      defaultsDiffer: new Set(Object.values(opens).map((l) => JSON.stringify(l))).size,
      vortex: { glow: vortex.glow, colourBy: vortex.colourBy },
      shearGlow: shear.glow,
      shearOpens: opens.shear.glow,
      pads: stReadPads().filter(Boolean).length,
      padNames: stReadPads().filter(Boolean).map((p) => p.name),
      colourBy: Object.keys(ST_COLOUR_BY),
    };
  });

  // Ten views, ten looks. Seeding them all the same is the same mistake as
  // sharing the sliders.
  expect(got.defaultsDiffer, 'the views all open looking the same').toBeGreaterThan(7);
  expect(got.vortex).toEqual({ glow: 0.42, colourBy: 'size' });
  // **And editing one leaves the other nine alone**, which is the whole claim.
  expect(got.shearGlow, 'editing one view changed another').toBe(got.shearOpens);

  // The pad library starts with the six the original ships.
  expect(got.padNames).toEqual(['Swarm', 'Trails', 'Kaleid', 'Ink', 'Ember', 'Still']);
  expect(got.colourBy).toEqual(['pitch', 'rate', 'position', 'size', 'source', 'time']);
});

test('the view editor offers the showing view, and only where it means something', async ({ page }) => {
  await openStage(page);
  const got = await page.evaluate(async () => {
    const read = (key) => {
      setVisual(key);
      const w = document.getElementById('stageViewEdit');
      return { hidden: w.classList.contains('hidden'),
        head: (w.querySelector('.st-group') || {}).textContent || '',
        tags: [...w.querySelectorAll('.re-tag')].map((t) => t.textContent),
        pads: w.querySelectorAll('.st-pads .re-btn').length };
    };
    return { moment: read('g-vortex'), object: read('g-shear'), room: read('stage') };
  });

  // A moment view folds and an object view does not — folding the whole
  // schedule would fold the object itself — so the control is only offered
  // where it does something.
  expect(got.moment.tags).toContain('FOLDS');
  expect(got.object.tags, 'an object view was offered a fold').not.toContain('FOLDS');
  expect(got.moment.head).toContain('Vortex');
  expect(got.object.head).toContain('Shear');
  expect(got.moment.pads).toBe(16);

  // **The stage showing as itself has none of this.** Its cloud is lit solids,
  // and a panel of controls writing to nothing is worse than no panel.
  expect(got.room.hidden, 'the room was offered a view editor').toBe(true);
});
