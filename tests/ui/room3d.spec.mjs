// The room built out of ridgelines.
//
// See `docs/ROOM-3D.md`. What is worth testing is not that Babylon draws — it
// does, and looking at it settles that. It is:
//
//   - **every surface is really there**, and switching one off takes it away.
//     Measured as ink in the part of the frame that surface occupies, because
//     five stacks over each other is exactly the picture where "something is
//     drawn" proves nothing.
//   - **the depth buffer is doing the hiding**, which is the entire reason this
//     module exists rather than being a fourth source in `ridge.js`.
//   - **the film gets the same picture**, on a clock it is handed rather than
//     one it reads — the fault that would make an engine unusable here.
//   - and that it is **deterministic**: the same pushes and the same clock give
//     the same frame, twice.

import { test, expect } from '@playwright/test';

async function openSurfaces(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof setMode === 'function' && typeof r3Attach === 'function'
      && typeof BABYLON !== 'undefined',
    { timeout: 30_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    localStorage.removeItem('roomData');
    roomEdit.room3d = {};
    setMode('room');
  });
  await page.waitForSelector('#roomStageRoom #visRoom3d, #roomStageRoom #visGl',
    { state: 'attached', timeout: 20_000 });
  await page.evaluate(() => setVisModule('room3d'));
  await page.waitForFunction(() => {
    const c = document.getElementById('visRoom3d');
    return c && c.clientWidth > 100;
  }, null, { timeout: 15_000 });
}

/// Fill it with sound and draw one frame on a clock we choose, then read the
/// buffer back.
///
/// **Read inside the draw, from the engine's own context.** A WebGL drawing
/// buffer is thrown away at composite unless it was created to be kept, and
/// re-getting the context does not change how it was created — a probe that
/// reads afterwards comes back empty however well the thing works. That mistake
/// cost an afternoon on the room next door; here the engine is built with
/// `preserveDrawingBuffer` so this read is honest.
const SHOOT = `((patch, clock) => {
  const r = visLive.room3d;
  const s = { ...room3dSettings(), ...(patch || {}) };
  r.configure(s);
  r.clear();
  const burst = (amp, cen) => {
    const n = 1024, a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const e = Math.exp(-Math.pow((t - cen) * 7, 2));
      const v = Math.sin(i * 0.35) * e * amp;
      a[i*2] = v; a[i*2+1] = v;
    }
    return a;
  };
  const bands = new Float32Array(128).fill(-18);
  for (let i = 0; i < 60; i++) {
    r.push(bands, burst(0.85 * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.7))), 0.5 + Math.sin(i * 0.31) * 0.07));
  }
  r.frame({ room3d: s, room3dPaint: ridgePaint(), clock: clock === undefined ? 100 : clock });

  const c = document.getElementById('visRoom3d');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const buf = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const W = c.width, H = c.height;
  // Ink in a box, in fractions of the frame. GL reads bottom-up, so y is
  // measured from the bottom and the names below say which end they mean.
  const ink = (x0, y0, x1, y1) => {
    let n = 0, tot = 0;
    for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++) {
      for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) {
        const i = (y * W + x) * 4;
        if (Math.max(buf[i], buf[i+1], buf[i+2]) > 40) n++;
        tot++;
      }
    }
    return tot ? +(100 * n / tot).toFixed(2) : 0;
  };
  let all = 0, sum = 0;
  for (let i = 0; i < buf.length; i += 4) { if (Math.max(buf[i], buf[i+1], buf[i+2]) > 40) all++; sum += buf[i]; }
  return {
    whole: +(100 * all / (W * H)).toFixed(2),
    checksum: sum,
    floorBand: ink(0.28, 0.0, 0.72, 0.16),
    ceilingBand: ink(0.28, 0.84, 0.72, 1.0),
    leftBand: ink(0.14, 0.3, 0.26, 0.7),
    rightBand: ink(0.74, 0.3, 0.86, 0.7),
    backBand: ink(0.44, 0.44, 0.56, 0.56),
  };
})`;

test('all five surfaces are drawn, and each one can be taken away', async ({ page }) => {
  await openSurfaces(page);
  const got = await page.evaluate(`(() => {
    const all = ${SHOOT}({}).whole;
    const none = ${SHOOT}({ floor: false, ceiling: false, left: false, right: false, back: false }).whole;
    const off = {};
    for (const k of ['floor', 'ceiling', 'left', 'right', 'back']) {
      off[k] = ${SHOOT}({ [k]: false }).whole;
    }
    return { all, none, off };
  })()`);

  // **Ink over the whole frame, not in a box where a surface is expected.**
  // The first version of this sampled five rectangles, which meant it was really
  // testing where the camera happens to point: move the eye and a working room
  // reports its floor missing. What cannot be argued with is that switching a
  // surface off takes ink out of the picture.
  expect(got.all, 'the room drew nothing').toBeGreaterThan(5);

  // With every surface off there is nothing else in the scene — no stray box,
  // no leftover mesh. Without this, five near-identical numbers below could all
  // be measuring the same thing.
  expect(got.none, 'something is drawn that is not one of the five surfaces').toBe(0);

  for (const k of ['floor', 'ceiling', 'left', 'right', 'back']) {
    expect(got.off[k], `${k} is still drawn with it switched off`)
      .toBeLessThan(got.all * 0.92);
    // And only that one goes: a surface whose removal emptied the room would
    // mean they are not independent.
    expect(got.off[k], `switching ${k} off took the rest of the room with it`)
      .toBeGreaterThan(got.all * 0.5);
  }
});

test('the rows hide what is behind them', async ({ page }) => {
  await openSurfaces(page);
  const got = await page.evaluate(`(() => {
    // Flat rows lie on the surface and hide nothing. Standing up, each row's
    // ribbon covers the rows behind it, so the ink *falls* — the far rows stop
    // showing through the near ones.
    const flat = ${SHOOT}({ over: 0.005 });
    const tall = ${SHOOT}({ over: 0.3 });
    return { flat: flat.whole, tall: tall.whole };
  })()`);

  expect(got.flat, 'the flat room drew nothing to compare against').toBeGreaterThan(2);
  // **The depth buffer is the whole reason for the engine.** Relief that did not
  // occlude would only ever add ink; what says the ribbons are solid is that
  // standing them up takes ink away.
  expect(got.tall, 'standing the rows up did not hide anything behind them')
    .toBeLessThan(got.flat);
});

test('the same pushes and the same clock give the same frame', async ({ page }) => {
  await openSurfaces(page);
  const got = await page.evaluate(`(() => {
    const a = ${SHOOT}({}, 0.01);
    const b = ${SHOOT}({}, 0.01);
    // And a different instant is a different picture, or the clock is being
    // ignored and the first two matching means nothing.
    //
    // **Both inside one push-interval**, which is fifty milliseconds. The slide
    // is how far through that gap the stack has travelled and it is clamped at
    // the end of it — pick two instants a second apart and both saturate, the
    // pictures match, and the test reports the clock ignored when it is being
    // read perfectly well. That is what the first version of this did.
    const c = ${SHOOT}({}, 0.04);
    return { a: a.checksum, b: b.checksum, c: c.checksum };
  })()`);

  // **Determinism is what makes an engine safe to film with.** The film draws
  // as fast as the machine manages and hands the renderer a clock; anything
  // reading a wall clock instead gives a different picture every run and the
  // export stops matching the room.
  expect(got.a, 'the same inputs gave two different pictures').toBe(got.b);
  expect(got.c, 'the clock is being ignored').not.toBe(got.a);
});

test('the film draws the surfaces, at the film’s size', async ({ page }) => {
  await openSurfaces(page);
  const got = await page.evaluate(async () => {
    const why = videoExportSupport();
    if (why) return { skip: why };

    const m = VIS_MODULES.find((x) => x.key === 'room3d');
    if (!m.__real) m.__real = m.attach;
    const seen = [];
    m.attach = (canvas) => {
      const r = m.__real(canvas);
      if (!r) return r;
      const rf = r.frame.bind(r);
      r.frame = (f) => { seen.push({ w: canvas.width, h: canvas.height, clock: f.clock }); return rf(f); };
      return r;
    };

    const size = { key: 'test', label: 'test', w: 480, h: 270 };
    try {
      await videoExport({
        path: state.selectedFile.path,
        from: 0, to: 0, repeats: 1, tail: 0, size, fps: 30,
        module: 'room3d',
        ridge: ridgeSettings(), ridgePaint: ridgePaint(),
        room3d: room3dSettings(), room3dPaint: ridgePaint(),
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
    return { count: seen.length, first: seen[0], last: seen[seen.length - 1], size };
  });
  if (got.skip) test.skip(true, got.skip);

  expect(got.count, 'the film never drew a frame of the surfaces').toBeGreaterThan(10);
  // At the film's size, not the window's.
  expect(got.first.w).toBe(got.size.w);
  expect(got.first.h).toBe(got.size.h);
  // **On the film's clock, and it has to move.** Read as milliseconds instead of
  // seconds the slide finishes inside the first frame and the whole room steps
  // instead of travelling — which is exactly what the flat stack did once.
  expect(typeof got.first.clock).toBe('number');
  expect(got.last.clock, 'the film’s clock did not advance').toBeGreaterThan(got.first.clock);
});
