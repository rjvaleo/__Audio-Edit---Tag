// The back of the room, and the grips that move it.
//
// The room was a rectangular prism: front and back the same size in world
// units, with the projection doing all of the narrowing. So the far rectangle's
// size was entirely decided by `depth`, which moves the wall away and takes its
// width and its height with it in step. These are the two coming apart — and
// the front face stays pinned to the canvas edges throughout, because "the
// panel is the box" is the identity the whole room is built on.

import { test, expect } from '@playwright/test';

async function openRoom(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof setMode === 'function' && typeof roomProject === 'function',
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    localStorage.removeItem('roomCameras');
    roomEdit.cams = {};
    roomEdit.frame = 'dock';
    setMode('room');
  });
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('visGl');
    return el && el.clientWidth > 200;
  });
}

/// The far rectangle as the room actually **draws** it, read off the canvas.
///
/// Sampled at native resolution over a band of rows. Downscaling loses it
/// entirely — the box is drawn at weights of 0.02 to 0.16, so a half-size copy
/// blurs a one-pixel line below any threshold worth setting, and the first
/// version of this measured a blank picture at every setting and reported the
/// control doing nothing.
const DRAWN_WALL = `((cam) => {
  const gl = document.getElementById('visGl');
  roomEdit.layers = { room: true, floor: false, lead: false, sky: false,
    skin: false, grains: false, data: false };
  if (cam) roomEdit.cams[roomEdit.frame] = cam;
  visGlTick(); visGlTick();
  const r = gl.getBoundingClientRect();
  const W = Math.round(r.width), H = Math.round(r.height);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(gl, 0, 0, W, H);
  const wl = roomBackWall(r.width, r.height);
  const scan = (rows, horizontal) => {
    let lo = 1e9, hi = -1;
    for (const q of rows) {
      const d = horizontal
        ? g.getImageData(0, q, W, 1).data
        : g.getImageData(q, 0, 1, H).data;
      const n = horizontal ? W : H;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (d[o] + d[o+1] + d[o+2] > 6) { if (i < lo) lo = i; if (i > hi) hi = i; }
      }
    }
    return hi < 0 ? 0 : hi - lo;
  };
  const midY = Math.round(wl.y + wl.h / 2);
  const midX = Math.round(wl.x + wl.w / 2);
  return {
    drawnW: scan([midY-2, midY-1, midY, midY+1, midY+2], true),
    drawnH: scan([midX-2, midX-1, midX, midX+1, midX+2], false),
    predictedW: Math.round(wl.w),
    predictedH: Math.round(wl.h),
    canvas: [W, H],
  };
})`;

test('the back can be narrowed and widened on its own', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(`(() => {
    const base = { ...roomCamNow(), backW: 1, backH: 1 };
    const out = {};
    for (const bw of [0.45, 1, 1.8]) {
      out['w' + bw] = ${DRAWN_WALL}({ ...base, backW: bw, backH: 1 });
    }
    return out;
  })()`);

  // **What is drawn is what was asked for.** The renderer's frustum runs on the
  // GPU as a matrix and `roomProject` answers for one point on the CPU; they
  // are the same frustum written twice, and this is what says so.
  for (const [k, v] of Object.entries(got)) {
    expect(v.drawnW, `${k}: the drawn wall is not where it was predicted`)
      .toBeCloseTo(v.predictedW, -1);
  }
  expect(got['w0.45'].drawnW).toBeLessThan(got.w1.drawnW * 0.7);
  expect(got['w1.8'].drawnW).toBeGreaterThan(got.w1.drawnW * 1.4);
  // The height is untouched by any of it.
  expect(got['w0.45'].drawnH).toBeCloseTo(got.w1.drawnH, -1);
  expect(got['w1.8'].drawnH).toBeCloseTo(got.w1.drawnH, -1);
});

test('the back can be shortened and raised on its own', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(`(() => {
    const base = { ...roomCamNow(), backW: 1, backH: 1 };
    const out = {};
    for (const bh of [0.45, 1, 1.8]) {
      out['h' + bh] = ${DRAWN_WALL}({ ...base, backW: 1, backH: bh });
    }
    return out;
  })()`);
  expect(got['h0.45'].drawnH).toBeLessThan(got.h1.drawnH * 0.7);
  expect(got['h1.8'].drawnH).toBeGreaterThan(got.h1.drawnH * 1.4);
  // And the width is untouched by any of it. This is the whole request: the
  // two are separate, and `depth` moves them together.
  expect(got['h0.45'].drawnW).toBeCloseTo(got.h1.drawnW, -1);
  expect(got['h1.8'].drawnW).toBeCloseTo(got.h1.drawnW, -1);
});

test('the front face never moves, whatever the back does', async ({ page }) => {
  await openRoom(page);
  // **The identity the room is built on.** `docs/ROOM-EDITOR.md`: the box's near
  // edges *are* the edges of the panel, which is why `#visGl` has no border. A
  // taper that touched the front would break that quietly — the room would
  // still look like a room, and the panel would stop being the box.
  const got = await page.evaluate(() => {
    const gl = document.getElementById('visGl');
    const r = gl.getBoundingClientRect();
    const base = { ...roomCamNow(), backW: 1, backH: 1 };
    const corners = [];
    for (const [bw, bh] of [[1, 1], [0.3, 1], [1, 0.3], [3, 3], [0.1, 4]]) {
      const c = { ...base, backW: bw, backH: bh };
      const hw = roomHalfW(r.width, r.height, c);
      // The four near corners, at t = 0.
      corners.push([bw, bh, [
        roomProject(-hw, c.floorY, 0, r.width, r.height, c),
        roomProject(hw, c.ceilY, 0, r.width, r.height, c),
      ].map((p) => [Math.round(p.x), Math.round(p.y)])]);
    }
    return { corners, size: [Math.round(r.width), Math.round(r.height)] };
  });
  const [w, h] = got.size;
  for (const [bw, bh, pts] of got.corners) {
    expect(pts[0], `backW ${bw} backH ${bh} moved the near bottom-left`).toEqual([0, h]);
    expect(pts[1], `backW ${bw} backH ${bh} moved the near top-right`).toEqual([w, 0]);
  }
});

test('the handles sit on the room they are dragging', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    roomEdit.on = true;
    paintRoomHandles();
    const gl = document.getElementById('visGl');
    const r = gl.getBoundingClientRect();
    const wl = roomBackWall(r.width, r.height);
    const at = (key) => {
      const el = document.querySelector(`.rh[data-handle="${key}"]`);
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2 - r.x, y: b.y + b.height / 2 - r.y };
    };
    return {
      left: at('backW-l'), right: at('backW-r'),
      top: at('backH-t'), bottom: at('backH-b'), depth: at('depth'),
      wall: { x: wl.x, y: wl.y, w: wl.w, h: wl.h },
    };
  });
  const w = got.wall;
  // Each grip is on the edge it moves. A grip floating near the thing it drags
  // is a grip you aim at and miss.
  expect(got.left.x).toBeCloseTo(w.x, 0);
  expect(got.right.x).toBeCloseTo(w.x + w.w, 0);
  expect(got.top.y).toBeCloseTo(w.y, 0);
  expect(got.bottom.y).toBeCloseTo(w.y + w.h, 0);
  expect(got.depth.x).toBeCloseTo(w.x + w.w / 2, 0);
  expect(got.depth.y).toBeCloseTo(w.y + w.h / 2, 0);
});

test('dragging a grip reshapes the back, and only the back', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    roomEdit.on = true;
    paintRoomHandles();
    const gl = document.getElementById('visGl');
    const r = gl.getBoundingClientRect();
    const drag = (key, dx, dy) => {
      const el = document.querySelector(`.rh[data-handle="${key}"]`);
      const b = el.getBoundingClientRect();
      const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
      el.setPointerCapture = () => {}; el.releasePointerCapture = () => {};
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, bubbles: true, pointerId: 1 }));
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + dx, clientY: y0 + dy, bubbles: true, pointerId: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: x0 + dx, clientY: y0 + dy, bubbles: true, pointerId: 1 }));
    };
    const wall = () => { const q = roomBackWall(r.width, r.height); return { w: q.w, h: q.h }; };
    const before = wall();
    const camBefore = { ...roomCamNow() };
    drag('backW-r', -140, 0);
    const afterW = wall();
    const camW = { ...roomCamNow() };
    drag('backH-t', 0, 90);
    const afterH = wall();
    const camH = { ...roomCamNow() };
    return { before, afterW, afterH, camBefore, camW, camH };
  });

  // Narrowing takes the width and leaves the height.
  expect(got.afterW.w).toBeLessThan(got.before.w - 40);
  expect(got.afterW.h).toBeCloseTo(got.before.h, 0);
  // Shortening takes the height and leaves the width where the last drag put it.
  expect(got.afterH.h).toBeLessThan(got.afterW.h - 30);
  expect(got.afterH.w).toBeCloseTo(got.afterW.w, 0);
  // And neither touched anything else about the pose.
  for (const k of ['depth', 'floorY', 'ceilY', 'shiftX', 'skyAt', 'ring']) {
    expect(got.camH[k], `dragging the back moved ${k}`).toBeCloseTo(got.camBefore[k], 6);
  }
});

test('the grips are only there while the room is being edited', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const host = document.getElementById('roomHandles');
    roomEdit.on = true; paintRoomHandles();
    const on = !host.classList.contains('hidden');
    roomEdit.on = false; paintRoomHandles();
    const off = !host.classList.contains('hidden');
    return { on, off };
  });
  // They are furniture for the editing rather than part of the picture — and
  // the film draws to its own canvas and never sees this element at all.
  expect(got.on).toBe(true);
  expect(got.off).toBe(false);
});
