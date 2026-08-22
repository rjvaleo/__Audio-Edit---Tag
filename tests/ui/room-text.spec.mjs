// The card of type, in front of everything.
//
// See `docs/ROOM-TEXT.md`. What is worth testing is not that letters appear —
// that is obvious on sight. It is:
//
//   - the card is **a hole in the picture**, not a panel over it. Filled with
//     the ground, the lines behind stop at its edge. Measured as ink *inside*
//     the card versus ink outside it, on a picture that is busy everywhere.
//   - the letters **stand off** it, which is the whole of "in 3d" — DEPTH at
//     nought and DEPTH up must differ, and differ in the direction of LEAN.
//   - dragging an edge **holds the opposite one**, which is what makes the
//     grips feel like handles rather than like the card sliding about.
//   - and the film draws the same card, from the same routine.

import { test, expect } from '@playwright/test';

/// A room with the ridgeline up and sound in it, so there is a picture for the
/// card to interrupt. Silence would be flat lines and a card over flat lines
/// cannot be told from a card over anything else.
async function openCard(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof setMode === 'function' && typeof rtDraw === 'function',
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    localStorage.removeItem('roomData');
    roomEdit.ridge = {};
    roomEdit.text = {};
    setMode('room');
  });
  await page.waitForSelector('#roomStageRoom #visRidge', { state: 'attached', timeout: 20_000 });
  await page.evaluate(() => setVisModule('ridge'));
  await page.waitForFunction(() => {
    const c = document.getElementById('visRidge');
    return c && c.clientWidth > 100;
  }, null, { timeout: 10_000 });
}

/// Fill the stack with sound, and draw one picture of it on a pinned clock.
const FEED = `((rows) => {
  const r = visRenderer();
  r.configure(ridgeSettings());
  r.clear();
  const burst = (amp, c) => {
    const n = 1024, a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const e = Math.exp(-Math.pow((t - c) * 7, 2));
      const v = Math.sin(i * 0.35) * e * amp;
      a[i*2] = v; a[i*2+1] = v;
    }
    return a;
  };
  const bands = new Float32Array(128).fill(-18);
  for (let i = 0; i < rows; i++) {
    r.push(bands, burst(0.85 * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.7))), 0.5 + Math.sin(i * 0.31) * 0.06));
  }
  r.frame({ ridge: ridgeSettings(), ridgePaint: ridgePaint(), clock: 100000 });
})`;

/// The picture with the card drawn on it, and the ink counted in two places.
///
/// **Drawn into a canvas of its own rather than read off the two live ones.**
/// Composing them here is what the screen does, and it is also what the film
/// does — so this measures the thing both of them show rather than one layer of
/// it. A probe that read only the overlay would report a card that is perfect
/// and floating over nothing.
const SHOT = `((patch) => {
  roomEdit.text = { ...rtSettings(roomEdit.text), on: true, ...(patch || {}) };
  const src = document.getElementById('visRidge');
  const out = document.createElement('canvas');
  out.width = src.width; out.height = src.height;
  const g = out.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  rtDraw(g, out.width, out.height, roomTextSettings(), roomTextPaint());
  const st = roomTextSettings();
  const b = rtBox(st, out.width, out.height);
  const ink = (x, y, w, h) => {
    if (w < 2 || h < 2) return 0;
    const d = g.getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 60) n++;
    return n / (Math.round(w) * Math.round(h));
  };
  return {
    // A band across the card, clear of the type: the middle of the left margin.
    cardEdge: ink(b.x + 2, b.y + 2, b.w - 4, b.h - 4),
    // The same height of picture, well outside the card.
    beside: ink(4, b.y + 2, Math.max(4, b.x - 12), b.h - 4),
    whole: ink(b.x, b.y, b.w, b.h),
    box: { x: b.x, y: b.y, w: b.w, h: b.h },
    canvas: { w: out.width, h: out.height },
  };
})`;

test('the card is off until it is asked for', async ({ page }) => {
  await openCard(page);
  const got = await page.evaluate(() => ({
    on: roomTextSettings().on,
    overlayInk: (() => {
      const c = document.getElementById('roomTextGl');
      if (!c) return null;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
      return n;
    })(),
  }));
  expect(got.on, 'the card starts switched on').toBe(false);
  expect(got.overlayInk, 'the card drew something while off').toBe(0);
});

test('the card is a hole in the picture, not a panel over it', async ({ page }) => {
  await openCard(page);
  const got = await page.evaluate(`(() => {
    ${FEED}(80);
    // **No type on it.** The question here is whether the ground is opaque, and
    // a card with words on it answers a different one — the first version of
    // this sampled a margin the letters reached into and read their ink as a
    // leak.
    return ${SHOT}({ text: '', size: 0.075, depth: 0.4, w: 0.5, h: 0.26 });
  })()`);

  // Beside the card the stack is drawn, which is what makes the next line mean
  // something. Without this a card over an empty picture passes.
  expect(got.beside, 'there is no picture beside the card to interrupt')
    .toBeGreaterThan(0.05);

  // **And inside it, nothing.** Not "less" — the ground is opaque and the lines
  // stop dead at the edge.
  expect(got.cardEdge, 'the picture is showing through the card')
    .toBeLessThan(0.005);
});

test('the letters stand off the card, in the direction they lean', async ({ page }) => {
  await openCard(page);
  const got = await page.evaluate(`(() => {
    ${FEED}(80);
    const flat = ${SHOT}({ size: 0.075, depth: 0, w: 0.5, h: 0.26 }).whole;
    const deep = ${SHOT}({ size: 0.075, depth: 0.6, angle: 135, w: 0.5, h: 0.26 }).whole;
    // The same depth thrown the other way. The sides are drawn towards the
    // lean, so the ink lands in a different place even though there is the same
    // amount of it — which is what makes this depth rather than a bolder face.
    const other = ${SHOT}({ size: 0.075, depth: 0.6, angle: 315, w: 0.5, h: 0.26 });
    const oneWay = ${SHOT}({ size: 0.075, depth: 0.6, angle: 135, w: 0.5, h: 0.26 });
    return { flat, deep, other: other.whole, oneWay: oneWay.whole };
  })()`);

  // Standing off puts more ink on the card than lying flat.
  expect(got.deep, 'DEPTH did not thicken the letters at all')
    .toBeGreaterThan(got.flat * 1.15);
  // And the same depth the other way is the same amount of ink — a sanity check
  // that DEPTH is depth and LEAN only turns it.
  expect(Math.abs(got.other - got.oneWay) / got.oneWay,
    'leaning the letters changed how much ink there is, so it is not a rotation')
    .toBeLessThan(0.25);
});

test('dragging an edge holds the opposite one', async ({ page }) => {
  await openCard(page);
  const got = await page.evaluate(() => {
    roomEdit.text = { ...rtSettings(roomEdit.text), on: true, x: 0.5, y: 0.5, w: 0.5, h: 0.26 };
    const W = 1000, H = 600;
    const before = rtBox(roomTextSettings(), W, H);
    // Drag the west edge a hundred pixels to the right.
    const west = rtDrag(roomTextSettings(), W, H, 'w', 100, 0);
    const afterW = rtBox({ ...roomTextSettings(), ...west }, W, H);
    // And the south-east corner, down and out.
    const se = rtDrag(roomTextSettings(), W, H, 'se', 60, 40);
    const afterSE = rtBox({ ...roomTextSettings(), ...se }, W, H);
    // Moving takes the whole card and changes no size.
    const mv = rtDrag(roomTextSettings(), W, H, 'move', 30, -20);
    const afterMove = rtBox({ ...roomTextSettings(), ...mv }, W, H);
    return { before, afterW, afterSE, afterMove };
  });

  // The east edge did not move while the west one was dragged.
  expect(Math.round(got.afterW.x + got.afterW.w))
    .toBe(Math.round(got.before.x + got.before.w));
  expect(Math.round(got.afterW.x)).toBe(Math.round(got.before.x + 100));

  // The north-west corner did not move while the south-east one was dragged.
  expect(Math.round(got.afterSE.x)).toBe(Math.round(got.before.x));
  expect(Math.round(got.afterSE.y)).toBe(Math.round(got.before.y));
  expect(Math.round(got.afterSE.w)).toBe(Math.round(got.before.w + 60));
  expect(Math.round(got.afterSE.h)).toBe(Math.round(got.before.h + 40));

  // Moving changes where and not how big.
  expect(Math.round(got.afterMove.w)).toBe(Math.round(got.before.w));
  expect(Math.round(got.afterMove.h)).toBe(Math.round(got.before.h));
  expect(Math.round(got.afterMove.x)).toBe(Math.round(got.before.x + 30));
  expect(Math.round(got.afterMove.y)).toBe(Math.round(got.before.y - 20));
});

test('the card sits in the same place at any size', async ({ page }) => {
  await openCard(page);
  const got = await page.evaluate(() => {
    roomEdit.text = { ...rtSettings(roomEdit.text), on: true, x: 0.4, y: 0.6, w: 0.5, h: 0.2 };
    const st = roomTextSettings();
    const at = (W, H) => {
      const b = rtBox(st, W, H);
      return { cx: (b.x + b.w / 2) / W, cy: (b.y + b.h / 2) / H, fw: b.w / W, fh: b.h / H };
    };
    return { small: at(640, 360), film: at(3840, 2160) };
  });
  // Fractions, not pixels — a card placed in a window is in the same place when
  // it is filmed at 4K, and the type is the same size relative to the frame.
  for (const k of ['cx', 'cy', 'fw', 'fh']) {
    expect(Math.abs(got.small[k] - got.film[k]), `${k} moved with the frame size`)
      .toBeLessThan(0.001);
  }
});

test('the film draws the card, from the same routine', async ({ page }) => {
  await openCard(page);
  const got = await page.evaluate(async () => {
    const why = videoExportSupport();
    if (why) return { skip: why };
    roomEdit.text = { ...rtSettings(roomEdit.text), on: true, text: 'FILMED', size: 0.12, w: 0.6, h: 0.3 };

    // **Watch the routine, not a canvas.** The card is drawn onto the frame the
    // encoder is handed — the module's canvas is composited under it and never
    // sees the card at all, so a probe that read the module's canvas would
    // report the card missing however well it worked.
    const real = window.rtDraw;
    const calls = [];
    window.rtDraw = (ctx, W, H, st, paint) => {
      calls.push({ W, H, on: st.on, text: st.text, w: st.w, h: st.h, face: paint.face, card: paint.card });
      return real(ctx, W, H, st, paint);
    };

    const size = { key: 'test', label: 'test', w: 480, h: 270 };
    let painted = null;
    try {
      await videoExport({
        path: state.selectedFile.path,
        from: 0, to: 0, repeats: 1, tail: 0, size, fps: 30,
        module: 'ridge', ridge: ridgeSettings(), ridgePaint: ridgePaint(),
        text: roomTextSettings(), textPaint: roomTextPaint(),
        camera: roomCameraForAspect(size.w / size.h),
        layers: roomLayers(), occlude: roomOcclude(), order: roomOrder(),
        room: { cold: [0.2, 0.45, 0.85], hot: [1, 0.72, 0.35], core: [0.55, 0.85, 1],
          paint: rpForRenderer(), geom: roomGeom() },
        onStage: () => {},
      });
      // **The film's calls, not the room's.** The live loop goes on drawing the
      // card on its own overlay while the film runs, and those calls land in
      // here too — at the window's size, not the film's.
      const mine = calls.filter((c) => c.W === size.w && c.H === size.h);
      painted = mine.length ? mine[Math.floor(mine.length / 2)] : null;
      calls.length = 0;
      calls.push(...mine);
    } finally {
      window.rtDraw = real;
    }
    return { count: calls.length, painted, size };
  });
  if (got.skip) test.skip(true, got.skip);

  // Every frame of the film, not once at the start.
  expect(got.count, 'the film never drew the card').toBeGreaterThan(10);

  // **At the film's size**, so the card is in the same fractions of a frame it
  // was placed in — not at the size of the window it was posed in.
  expect(got.painted.W).toBe(got.size.w);
  expect(got.painted.H).toBe(got.size.h);
  expect(got.painted.on).toBe(true);
  expect(got.painted.text).toBe('FILMED');
  expect(got.painted.w).toBeCloseTo(0.6, 5);
  expect(got.painted.h).toBeCloseTo(0.3, 5);
  // And with colours already resolved: the film has no page to read them from.
  expect(got.painted.face).toMatch(/^#|^rgb/);
  expect(got.painted.card).toMatch(/^#|^rgb/);
});
