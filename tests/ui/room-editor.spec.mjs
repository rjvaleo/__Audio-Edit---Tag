// Posing the room.
//
// The room's shape and camera used to be constants read straight out of
// `vis-gl.js` at every draw call, chosen while looking at one frame shape. They
// are a value now, one per frame shape, and they are found by dragging the room
// rather than by typing numbers at it — see `docs/ROOM-EDITOR.md`.
//
// What these hold: that a drag on the room actually moves the camera, that the
// two zones do different things, that each frame keeps its own, and — the one
// that matters most — that `floorY` and `ceilY` move as one asymmetry rather
// than as two independent numbers, because that asymmetry is the tilt.

import { test, expect } from '@playwright/test';

async function openRoom(page) {
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
  await page.waitForSelector('#masterBus .mb-cell-3d', { state: 'visible', timeout: 20_000 });
  // Every test starts from the same room.
  //
  // Not fussiness: the layers, the streams, the block size and the opacity are
  // all remembered on purpose, so a test that turns the Data layer off leaves
  // it off for everything after it — which is exactly what happened, and it
  // made the blocks test pass on its own and fail in the suite, reading an
  // empty block and comparing against nothing.
  await page.evaluate(() => {
    for (const k of ['roomCameras', 'roomLayers', 'roomStreams', 'roomData']) {
      localStorage.removeItem(k);
    }
    roomEdit.cams = {};
    roomEdit.layers = {};
    roomEdit.streams = null;
    roomEdit.chunk = 4;
    roomEdit.opacity = 0.7;
    roomEdit.frame = 'dock';
    if (!roomEdit.on) toggleRoomEdit();
  });
  await page.waitForTimeout(300);
}

/// Drag from a fraction of the way across the room to another.
async function dragRoom(page, from, to) {
  const r = await page.evaluate(() => {
    const b = document.getElementById('visGl').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  await page.mouse.move(r.x + r.w * from[0], r.y + r.h * from[1]);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * to[0], r.y + r.h * to[1], { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

const cam = () => roomCamNow();

test('dragging the lower room tilts the camera and keeps the room its own height',
  async ({ page }) => {
    await openRoom(page);
    const before = await page.evaluate(cam);

    // Down the middle of the room: the camera zone, straight down.
    await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
    const after = await page.evaluate(cam);

    expect(after.floorY, 'the floor did not move').not.toBeCloseTo(before.floorY, 4);
    // The whole point: the height is held and the asymmetry moves. Two fields
    // would let these drift apart; one gesture cannot.
    const h0 = before.ceilY - before.floorY;
    const h1 = after.ceilY - after.floorY;
    expect(h1, `the room changed height (${h0} to ${h1}) instead of tilting`)
      .toBeCloseTo(h0, 6);
    // Dragging down looks further up, so the floor takes less of the frame.
    expect(after.floorY, 'the tilt went the wrong way').toBeGreaterThan(before.floorY);
  });

test('dragging sideways slides the frustum and never turns the camera',
  async ({ page }) => {
    await openRoom(page);
    const before = await page.evaluate(cam);

    await dragRoom(page, [0.5, 0.6], [0.8, 0.6]);
    const after = await page.evaluate(cam);

    // Against the drag, because shifting the frustum right swings the view
    // right, which carries the vanishing point left. The hand and the vanishing
    // point go the same way; the number goes the other.
    expect(after.shiftX, 'the vanishing point did not move sideways')
      .toBeLessThan(before.shiftX);
    // A sideways drag is not a tilt.
    expect(after.ceilY - after.floorY, 'the room resized on a sideways drag')
      .toBeCloseTo(before.ceilY - before.floorY, 6);
  });

test('the sky zone moves the ring and not the camera', async ({ page }) => {
  await openRoom(page);
  const before = await page.evaluate(cam);

  // Top of the room, where the ring hangs.
  await dragRoom(page, [0.5, 0.15], [0.5, 0.05]);
  const after = await page.evaluate(cam);

  expect(after.skyAt, 'the ring did not rise').toBeGreaterThan(before.skyAt);
  expect(after.floorY, 'a drag on the sky moved the camera').toBeCloseTo(before.floorY, 6);
});

test('each frame shape keeps its own camera', async ({ page }) => {
  await openRoom(page);

  await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
  const dock = await page.evaluate(cam);
  expect(dock.floorY, 'the dock camera did not move').not.toBeCloseTo(-0.38, 4);

  // Switch to the tall frame: untouched, so it is still what the source ships.
  await page.evaluate(() => { roomEdit.frame = '9x16'; applyRoomFrame(); paintRoomNums(); });
  const vert = await page.evaluate(cam);
  expect(vert.floorY, 'the tall frame inherited the dock camera').toBeCloseTo(-0.38, 6);

  // And the room is actually that shape now, not a wide panel to imagine from.
  const shape = await page.evaluate(() => {
    const b = document.querySelector('#masterBus .mb-cell-3d').getBoundingClientRect();
    return b.width / b.height;
  });
  expect(shape, `the 9:16 frame drew at ${shape}`).toBeCloseTo(9 / 16, 1);

  // Back to the dock and the posed camera is still there.
  await page.evaluate(() => { roomEdit.frame = 'dock'; applyRoomFrame(); paintRoomNums(); });
  expect((await page.evaluate(cam)).floorY, 'the dock camera was lost')
    .toBeCloseTo(dock.floorY, 6);
});

test('a posed camera survives a reload, and Reset puts it back', async ({ page }) => {
  await openRoom(page);
  await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
  const posed = await page.evaluate(cam);

  await page.reload();
  await page.waitForFunction(() => typeof roomEdit !== 'undefined', { timeout: 20_000 });
  const back = await page.evaluate(() => roomCamNow());
  expect(back.floorY, 'the camera did not survive a reload').toBeCloseTo(posed.floorY, 6);

  await page.evaluate(() => { if (!roomEdit.on) toggleRoomEdit(); document.getElementById('reReset').click(); });
  await page.waitForTimeout(150);
  expect((await page.evaluate(cam)).floorY, 'Reset did not restore the source camera')
    .toBeCloseTo(-0.38, 6);
});

/// The fault that made the tool look broken: opening it with nothing playing.
///
/// The room is fed by the meter, so a stopped transport meant an empty box and
/// invisible things to drag. A camera has to have something to be aimed at.
///
/// The silence is forced rather than waited for. The scratch engine reports
/// live data whether or not anything is audible, so a test that asserted "the
/// meter is empty" as a precondition would be asserting the harness.
test('the room is given something to pose against when the meter is empty',
  async ({ page }) => {
    await openRoom(page);

    const pushed = await page.evaluate(async () => {
      const seen = [];
      const real = visGl.push.bind(visGl);
      visGl.push = (...a) => { seen.push(a); return real(...a); };
      masterBus.data = null;
      const wasLive = () => { masterBus.data = null; };
      const t = setInterval(wasLive, 10);
      await new Promise((r) => setTimeout(r, 600));
      clearInterval(t);
      visGl.push = real;
      return { calls: seen.length, bands: seen.length ? seen[0][0].length : 0 };
    });

    expect(pushed.calls, 'nothing was pushed, so the room stayed empty')
      .toBeGreaterThan(0);
    expect(pushed.bands, 'the test card carried no spectrum').toBeGreaterThan(0);
  });

/// The card is a fixed picture, not a moving one. A camera is judged against
/// something that holds still, and two poses can only be compared if what is in
/// the room is the same both times.
test('the test card is the same picture every time', async ({ page }) => {
  await openRoom(page);
  const same = await page.evaluate(() => {
    const a = roomTestCard()[0], b = roomTestCard()[0];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  });
  expect(same, 'the card changed between looks').toBe(true);
});

// ── the layers ───────────────────────────────────────────────────────────────
//
// The room was one picture with four things always in it. Each is its own
// decision now, so the box can be a landscape, or a scope hanging in the dark,
// or an empty room. What these hold is that the switch actually reaches the
// renderer — a toggle that only greys a button out would look identical from
// here.

test('turning a layer off stops it being drawn', async ({ page }) => {
  await openRoom(page);

  const seen = await page.evaluate(async () => {
    const real = visGl.frame.bind(visGl);
    let last = null;
    visGl.frame = (f) => { last = f && f.layers ? { ...f.layers } : null; return real(f); };
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    await settle();
    const all = { ...last };

    // Off, through the button rather than the state, so the wiring counts.
    document.querySelector('#reLayers .re-btn[data-layer="floor"]').click();
    document.querySelector('#reLayers .re-btn[data-layer="sky"]').click();
    await settle();
    const off = { ...last };

    document.querySelector('#reLayers .re-btn[data-layer="floor"]').click();
    await settle();
    const back = { ...last };

    visGl.frame = real;
    return { all, off, back };
  });

  expect(seen.all.floor, 'the terrain was not on to begin with').toBe(true);
  expect(seen.all.sky, 'the ring was not on to begin with').toBe(true);
  expect(seen.off.floor, 'the terrain kept being drawn after being turned off').toBe(false);
  expect(seen.off.sky, 'the ring kept being drawn after being turned off').toBe(false);
  expect(seen.off.room, 'turning the terrain off took the wireframe with it').toBe(true);
  expect(seen.back.floor, 'the terrain did not come back').toBe(true);
  expect(seen.back.sky, 'the ring came back on its own').toBe(false);
});

test('the layers survive a reload', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => document.querySelector('#reLayers .re-btn[data-layer="room"]').click());
  await page.waitForTimeout(150);

  await page.reload();
  await page.waitForFunction(() => typeof roomLayerOn === 'function', { timeout: 20_000 });
  expect(await page.evaluate(() => roomLayerOn('room')), 'the wireframe came back on')
    .toBe(false);
  expect(await page.evaluate(() => roomLayerOn('floor')), 'the terrain was turned off too')
    .toBe(true);
});

// ── the grain block ──────────────────────────────────────────────────────────

test('the grain block reads the engine, and goes away with its layer',
  async ({ page }) => {
    await openRoom(page);
    const el = '#roomData';

    const text = await page.evaluate(() => {
      paintRoomData();
      return document.getElementById('roomData').textContent;
    });
    // Real telemetry, not set dressing: the window is a number the engine is
    // working to and it has to be the one the block says. The header is terse
    // — `50/s 40ms L1/1 0% D0` — because it sits above the grain rows rather
    // than instead of them.
    const win = await page.evaluate(() => Math.round(state.stretchDraft.windowMs));
    expect(text, 'no rate in the header').toMatch(/\d+\/s/);
    expect(text, `the size does not match the ${win} ms window`).toContain(`${win}ms`);
    expect(text, 'no drop counter').toMatch(/D\d+/);

    await page.evaluate(() => document.querySelector('#reLayers .re-btn[data-layer="data"]').click());
    await page.waitForTimeout(150);
    expect(await page.locator(el).isVisible(), 'the block stayed up with its layer off')
      .toBe(false);
  });

test('the streams can be picked, and the columns follow', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]')?.click();
  });
  await page.waitForTimeout(700);

  const before = await page.evaluate(() => {
    paintRoomData();
    return document.querySelector('#roomData .rd-hdr')?.textContent || '';
  });
  expect(before, 'PAN was already up').not.toContain('PAN');
  expect(before, 'the default columns are missing').toContain('IDX');

  await page.evaluate(() => {
    document.querySelector('#reStreams .re-btn[data-stream="pan"]').click();
    document.querySelector('#reStreams .re-btn[data-stream="idx"]').click();
  });
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => {
    paintRoomData();
    return document.querySelector('#roomData .rd-hdr')?.textContent || '';
  });
  expect(after, 'PAN did not appear').toContain('PAN');
  expect(after, 'IDX did not go away').not.toContain('IDX');

  // And it is per-column, not all-or-nothing.
  expect(after, 'the other columns went with it').toContain('SIZE');
});

test('the rows are grains, not a summary', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]')?.click();
  });
  await page.waitForTimeout(900);

  const seen = await page.evaluate(() => {
    paintRoomData();
    const rows = [...document.querySelectorAll('#roomData .rd-row')]
      .map((r) => r.textContent).filter((t) => !/no schedule/.test(t));
    const sched = (state.grains?.grains || []).length;
    return { rows: rows.length, sched, sample: rows[0] || '' };
  });

  expect(seen.sched, 'there was no schedule to read').toBeGreaterThan(0);
  expect(seen.rows, 'the block printed no grains').toBeGreaterThan(0);
  // A row is numbers off one grain, so it has as many fields as columns shown.
  expect(seen.sample.trim().split(/\s+/).length, `a row read "${seen.sample}"`)
    .toBeGreaterThan(2);
});

// ── the data on the wall ─────────────────────────────────────────────────────
//
// The block is printed on the room's back wall rather than floated in front of
// it. The wall is GPU geometry and never exists as an element, so its rectangle
// is derived from the camera — which means it has to follow the camera, and
// that is the thing worth holding.

test('the data sits on the back wall and follows the camera', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]')?.click();
  });
  await page.waitForTimeout(700);

  const read = () => {
    const el = document.getElementById('roomData');
    paintRoomData();
    const cell = el.parentElement.getBoundingClientRect();
    const wall = roomBackWall(cell.width, cell.height);
    return {
      left: parseFloat(el.style.left), top: parseFloat(el.style.top),
      w: parseFloat(el.style.width), h: parseFloat(el.style.height),
      wall: { x: Math.round(wall.x), y: Math.round(wall.y), w: Math.round(wall.w), h: Math.round(wall.h) },
      depth: roomCamNow().depth,
      rows: el.querySelectorAll('.rd-row').length,
    };
  };

  const near = await page.evaluate(read);
  expect(Number.isFinite(near.left), `left was ${near.left}`).toBe(true);
  expect(near.left, 'the block is not where the wall is').toBe(near.wall.x);
  expect(near.top, 'the block is not where the wall is').toBe(near.wall.y);
  expect(near.w, 'the block is not the width of the wall').toBe(near.wall.w);

  // Push the room deeper. The wall converges harder, so it gets smaller — and
  // the block, being the wall, goes with it. The *type* does not: that is held
  // by its own test.
  await page.evaluate(() => {
    const c = roomCamNow(); c.depth = c.depth * 3;
    roomEdit.cams[roomEdit.frame] = c;
  });
  const far = await page.evaluate(read);
  expect(far.depth, 'the room did not get deeper').toBeGreaterThan(near.depth);
  expect(far.w, `the wall did not recede (${near.w} → ${far.w})`).toBeLessThan(near.w);
  expect(far.left, 'the block came off the wall').toBe(far.wall.x);
  // Less wall, so fewer lines of it. Never more.
  expect(far.rows, 'a smaller wall held more rows').toBeLessThanOrEqual(near.rows);
});

test('a hidden room does not put NaN in the style', async ({ page }) => {
  await openRoom(page);
  const bad = await page.evaluate(() => {
    const r = roomBackWall(0, 0);
    return [r.x, r.y, r.w, r.h, r.k].some((v) => !Number.isFinite(v));
  });
  expect(bad, 'a zero-sized room produced a non-finite rectangle').toBe(false);
});

/// Fixed size, on the wall, nothing over the edge.
test('the block is fixed type clipped to the wall, not scaled with it', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]')?.click();
  });
  await page.waitForTimeout(700);

  const read = () => {
    const el = document.getElementById('roomData');
    paintRoomData();
    const cs = getComputedStyle(el);
    const cell = el.parentElement.getBoundingClientRect();
    const wall = roomBackWall(cell.width, cell.height);
    return {
      fontPx: parseFloat(cs.fontSize),
      transform: cs.transform,
      // The box is the wall's box.
      offWall: Math.abs(parseFloat(el.style.width) - Math.round(wall.w))
             + Math.abs(parseFloat(el.style.height) - Math.round(wall.h)),
      // Nothing sticking out of it.
      overWide: el.scrollWidth - el.clientWidth,
      overTall: el.scrollHeight - el.clientHeight,
      behindCanvas: parseInt(cs.zIndex, 10)
        < parseInt(getComputedStyle(document.getElementById('visGl')).zIndex, 10),
    };
  };

  const a = await page.evaluate(read);
  expect(a.transform, 'the block is still being scaled').toBe('none');
  expect(a.offWall, 'the block is not the size of the wall').toBeLessThanOrEqual(1);
  expect(a.overWide, `content ran ${a.overWide}px past the wall`).toBeLessThanOrEqual(0);
  expect(a.overTall, `content ran ${a.overTall}px below the wall`).toBeLessThanOrEqual(0);
  expect(a.behindCanvas, 'the data is in front of the room, not on its back wall').toBe(true);

  // Push the room deeper. The wall shrinks; the type must not.
  await page.evaluate(() => {
    const c = roomCamNow(); c.depth = c.depth * 3;
    roomEdit.cams[roomEdit.frame] = c;
  });
  const b = await page.evaluate(read);
  expect(b.fontPx, `type went from ${a.fontPx} to ${b.fontPx} when the room moved`)
    .toBe(a.fontPx);
  expect(b.transform, 'a transform came back').toBe('none');
  expect(b.overWide, 'a deeper room let the text out over the edge').toBeLessThanOrEqual(0);
});

/// The canvas is glass.
///
/// The block is printed behind it, so anything opaque on the canvas hides the
/// text completely — which is exactly what happened: a second `#visGl` rule
/// later in the stylesheet put `background: var(--sink)` back at equal
/// specificity, and the readout was invisible while every measurement of it
/// said it was fine.
test('the room is drawn on glass, with the ground behind it', async ({ page }) => {
  await openRoom(page);

  const paint = await page.evaluate(() => {
    const bg = (n) => getComputedStyle(n).backgroundColor;
    const clear = (c) => c === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(c);
    const gl = document.getElementById('visGl');
    const cell = document.querySelector('#masterBus .mb-cell-3d');
    const data = document.getElementById('roomData');
    return {
      canvasClear: clear(bg(gl)),
      cellHasGround: !clear(bg(cell)),
      dataBehindCanvas: parseInt(getComputedStyle(data).zIndex, 10)
        < parseInt(getComputedStyle(gl).zIndex, 10),
      // And no frame drawn over the room's own front face.
      canvasBorder: getComputedStyle(gl).borderTopWidth,
      canvasRadius: getComputedStyle(gl).borderTopLeftRadius,
    };
  });

  expect(paint.canvasClear, 'the canvas is opaque, so nothing behind it can be seen')
    .toBe(true);
  expect(paint.cellHasGround, 'the room lost its dark ground').toBe(true);
  expect(paint.dataBehindCanvas, 'the data is in front of the room').toBe(true);
  expect(paint.canvasBorder, 'a border is drawn over the room\'s front face').toBe('0px');
  expect(paint.canvasRadius, 'the room\'s corners are rounded off').toBe('0px');
});

// ── the blocks ───────────────────────────────────────────────────────────────
//
// Rows travel in blocks with a blank line between, and every other block runs
// the other way. A single column all sliding one way reads as a static texture
// at this size; against a neighbour going the other way the movement is
// obvious. The reversal is the part worth holding — the gaps are visible in the
// markup, the direction is not.

test('rows travel in blocks, and every other block runs the other way',
  async ({ page }) => {
    await openRoom(page);
    await page.evaluate(() => {
      document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]')?.click();
    });
    await page.waitForTimeout(700);

    const shape = await page.evaluate(() => {
      // A very shallow room, so the back wall is nearly the size of the front
      // one and holds as many lines as the panel can give.
      //
      // This is not fussiness: the panel's height is remembered between runs,
      // so a suite that has resized it earlier leaves a shorter dock than a
      // run of this file alone, and a wall that holds three lines cannot show
      // two blocks of two. That is what made this pass by itself and fail in
      // the suite.
      const c = roomCamNow(); c.depth = 0.05; roomEdit.cams[roomEdit.frame] = c;
      roomEdit.chunk = 2;
      paintRoomData();
      const rows = [...document.querySelectorAll('#roomData .rd-row')];
      return {
        printed: rows.filter((r) => !r.classList.contains('rd-gap')).length,
        pattern: rows.map((r) => (r.classList.contains('rd-gap') ? '.' : '#')).join(''),
        // The first column of each printed row, which is the grain index and
        // therefore says which way time is running in that block.
        firsts: rows.filter((r) => !r.classList.contains('rd-gap'))
          .map((r) => parseFloat(r.textContent.trim().split(/\s+/)[0]))
          .filter((n) => Number.isFinite(n)),
      };
    });

    // Said plainly, so a short wall reads as a short wall rather than as a
    // comparison against undefined.
    expect(shape.printed, `the wall only held ${shape.printed} lines, so there is `
      + 'not enough here to see two blocks').toBeGreaterThanOrEqual(4);
    // Two on, one off, two on…
    expect(shape.pattern, `the blocks came out as "${shape.pattern}"`).toMatch(/^##(\.##)+/);

    // The first block ascends and the second descends.
    const [a, b, c, d] = shape.firsts;
    expect(b, `first block did not ascend (${a} → ${b})`).toBeGreaterThan(a);
    expect(d, `second block did not run the other way (${c} → ${d})`).toBeLessThan(c);
  });

test('the block size can be changed, and the gaps follow', async ({ page }) => {
  await openRoom(page);
  const read = () => page.evaluate(() => {
    const c = roomCamNow(); c.depth = 0.05; roomEdit.cams[roomEdit.frame] = c;
    paintRoomData();
    return [...document.querySelectorAll('#roomData .rd-row')]
      .map((r) => (r.classList.contains('rd-gap') ? '.' : '#')).join('');
  });

  await page.evaluate(() => document.querySelector('#reChunks .re-btn[data-chunk="8"]').click());
  const eight = await read();
  expect(eight, `blocks of eight came out as "${eight}"`).toMatch(/^#{8}\./);

  await page.evaluate(() => document.querySelector('#reChunks .re-btn[data-chunk="2"]').click());
  const two = await read();
  expect(two, `blocks of two came out as "${two}"`).toMatch(/^#{2}\./);
});

test('the opacity slider reaches the wall and is remembered', async ({ page }) => {
  await openRoom(page);

  await page.evaluate(() => {
    const s = document.getElementById('reOpacity');
    s.value = '25';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(120);

  const set = await page.evaluate(() => parseFloat(document.getElementById('roomData').style.opacity));
  expect(set, `the wall went to ${set}`).toBeCloseTo(0.25, 2);

  await page.reload();
  await page.waitForFunction(() => typeof roomEdit !== 'undefined', { timeout: 20_000 });
  const kept = await page.evaluate(() => roomEdit.opacity);
  expect(kept, 'the opacity did not survive a reload').toBeCloseTo(0.25, 2);
});

// ── the ring's skin ──────────────────────────────────────────────────────────
//
// The trail was a stack of separate hoops. Joined between neighbours the way
// the floor joins its ridges, it becomes a surface — and the difference between
// hoops and a tube is *area*, which is the thing to measure. Counting lit
// pixels with the skin on and off is the only honest way to tell them apart;
// both look like "something blue in the sky" from the DOM.

test('the ring is a surface, not a stack of hoops', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]')?.click();
  });
  await page.waitForTimeout(600);

  const lit = await page.evaluate(async () => {
    // The ring alone, so nothing else can account for the difference.
    for (const k of ['floor', 'lead', 'room', 'data']) {
      if (roomLayerOn(k)) roomEdit.layers[k] = false;
    }
    roomEdit.layers.sky = true;

    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;

    // Something in the sky to draw: a figure with real width, pushed in over
    // several frames so the trail has neighbours to join.
    const feed = () => {
      const bands = new Float32Array(128).fill(-40);
      const liss = new Float32Array(512);
      for (let i = 0; i < 256; i++) {
        const t = (i / 256) * Math.PI * 2;
        liss[i * 2] = 0.7 * Math.sin(t * 3);
        liss[i * 2 + 1] = 0.7 * Math.sin(t * 2);
      }
      visGl.push(bands, liss);
    };
    for (let i = 0; i < 24; i++) feed();

    const count = () => new Promise((res) => requestAnimationFrame(() => {
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(),
      });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 12) n++;
      res(n);
    }));

    roomEdit.layers.skin = true;
    const withSkin = await count();
    roomEdit.layers.skin = false;
    const without = await count();
    return { withSkin, without };
  });

  if (lit === null) test.skip(true, 'no readable WebGL context in this harness');
  expect(lit.without, 'the hoops themselves drew nothing').toBeGreaterThan(0);
  // A surface covers area the hoops leave empty. Measured at about 15% more,
  // and held at 8% — enough that a skin which stopped drawing would fail, loose
  // enough that the exact figure is free to move with the fade it is drawn at.
  expect(lit.withSkin, `skin ${lit.withSkin} lit vs hoops ${lit.without}`)
    .toBeGreaterThan(lit.without * 1.08);
});

// ── the grains ───────────────────────────────────────────────────────────────
//
// Drawn from the schedule itself rather than from a model of it, which is what
// makes the picture true whatever rule decides how often a grain is laid down.
// Depth is when it sounds, its length is how long for, across is where in the
// source it reads.

test('the grains are drawn from the schedule, and spread across the source',
  async ({ page }) => {
    await openRoom(page);

    // A schedule made here rather than whatever the scratch library happens to
    // produce. Its two tones are a second long and the schedule is windowed
    // around the playhead, so the real count swings between five and forty
    // between runs — which is a fine thing for the app and a useless thing to
    // assert against. What is being held is the *mapping*: a hundred grains
    // spread evenly across the source must come out spread across the room.
    const made = await page.evaluate(() => {
      const sr = 44100, srcFrames = sr * 10;
      const grains = [];
      for (let i = 0; i < 100; i++) {
        const f = i / 99;
        grains.push([
          Math.round(f * sr * 2),      // out: over the two seconds the room holds
          Math.round(f * srcFrames),   // src: evenly across the file
          Math.round(sr * 0.04),       // size: 40 ms
          0, 0.5, 0.5, 0, i,           // pitch, rms, bright, pan, index
        ]);
      }
      window.__probe = { grains, sr, srcFrames };
      for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
      roomEdit.layers.grains = true;
      return grains.length;
    });
    expect(made).toBe(100);

    const shot = async () => page.evaluate(() => {
      const gl = document.getElementById('visGl');
      const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
      if (!ctx) return null;
      const p = window.__probe;
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(),
        grains: p.grains, grainRate: p.sr, srcFrames: p.srcFrames,
        // Playhead at the far end, so every grain is inside the room.
        position: p.sr * 2, positionRate: p.sr, pollMs: 50,
      });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      const cols = new Set();
      const rws = new Set();
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] + px[i + 1] + px[i + 2] > 12) {
          n++;
          const p = (i / 4) | 0;
          cols.add(p % gl.width);
          rws.add((p / gl.width) | 0);
        }
      }
      return { n, cols: cols.size, rows: rws.size, width: gl.width, height: gl.height };
    });

    const on = await shot();
    if (on === null) test.skip(true, 'no readable WebGL context in this harness');
    expect(on.n, 'the grains drew nothing').toBeGreaterThan(0);
    // Scattered over the face of the room, not laid along one axis. The first
    // version put source position along x and drew a diagonal ribbon; before
    // that, pan alone put every grain on the same column and the cloud was one
    // invisible line. Both would fail one of these two.
    expect(on.cols, `the cloud lit ${on.cols} columns of ${on.width}`)
      .toBeGreaterThan(on.width * 0.2);
    expect(on.rows, `the cloud lit ${on.rows} rows of ${on.height}`)
      .toBeGreaterThan(on.height * 0.1);

    await page.evaluate(() => { roomEdit.layers.grains = false; });
    const off = await shot();
    expect(off.n, 'something kept drawing after the grains were turned off').toBe(0);
  });
