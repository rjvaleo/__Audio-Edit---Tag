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
  expect(before, 'BRT was already up').not.toContain('BRT');
  expect(before, 'the default columns are missing').toContain('IDX');

  await page.evaluate(() => {
    document.querySelector('#reStreams .re-btn[data-stream="brt"]').click();
    document.querySelector('#reStreams .re-btn[data-stream="idx"]').click();
  });
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => {
    paintRoomData();
    return {
      hdr: document.querySelector('#roomData .rd-hdr')?.textContent || '',
      // How many of the eight have room on this wall at all. Every stream has a
      // fixed place, so what fits is decided by the wall and not by how many
      // are switched on — see the note in `paintRoomData`.
      room: Math.floor(roomBackWall(
        document.getElementById('roomData').parentElement.getBoundingClientRect().width,
        document.getElementById('roomData').parentElement.getBoundingClientRect().height,
      ).w / roomChPx(document.getElementById('roomData'))),
    };
  });
  expect(after.hdr, 'IDX did not go away').not.toContain('IDX');
  // BRT's place is the seventh, which is past the edge of a dock-sized wall.
  // **A stream is only shown where its own column falls on the wall**, and
  // switching its neighbours off no longer buys it room — that is the price of
  // the columns holding still, and it is the whole of the trade. On a taller
  // frame, where the wall is wider, the same click brings it up.
  if (after.room >= 56) {
    expect(after.hdr, 'BRT did not appear on a wall wide enough for it').toContain('BRT');
  } else {
    expect(after.hdr, 'BRT was drawn past the edge of the wall').not.toContain('BRT');
  }

  // And it is per-column, not all-or-nothing.
  expect(after.hdr, 'the other columns went with it').toContain('SIZE');
});

/// The back wall is tiled, not stretched.
///
/// One block of columns is narrower than the wall and the schedule around the
/// playhead is shorter than the wall is tall, so printing one of each left most
/// of the wall empty. The answer is more of it, not bigger: this is small type
/// printed on a wall, and type on a wall does not grow because the wall is big.
test('the data tiles across and down the back wall', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(() => {
    roomEdit.layers.data = true;
    paintRoomData();
    const el = document.getElementById('roomData');
    const rows = [...el.querySelectorAll('.rd-row')];
    const hdr = el.querySelector('.rd-hdr')?.textContent || '';
    // How many times one tile's first label appears across a line.
    const count = (s, needle) => s.split(needle).length - 1;
    return {
      hdr,
      across: count(hdr, 'RMS'),
      // Nothing printed should be an empty line except the gaps between blocks,
      // which carry spaces on purpose.
      printed: rows.filter((r) => !r.classList.contains('rd-gap')).length,
      filled: rows.filter((r) => !r.classList.contains('rd-gap')
        && r.textContent.trim().length > 0).length,
      size: getComputedStyle(el).fontSize,
    };
  });

  // Down: every printed row carries data. Before this, the wall ran out of
  // schedule and the rest of it was blank.
  expect(out.printed, 'no rows were printed at all').toBeGreaterThan(4);
  expect(out.filled, `${out.filled} of ${out.printed} printed rows have anything `
    + 'in them — the wall stops part way down').toBe(out.printed);

  // Across: at dock size one tile may be the whole width, which is why this
  // only asks that the tiling is whole tiles rather than a stretched one.
  expect(out.across, 'the header lost its columns').toBeGreaterThanOrEqual(1);

  // And the type did not grow to fill anything.
  expect(out.size, 'the block was scaled instead of repeated').toBe('7px');
});

/// On a wall with room for more than one, there is more than one.
test('a wider wall gets more tiles, not bigger ones', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => { roomEdit.layers.data = true; paintRoomData(); });
  const dock = await page.evaluate(() => ({
    hdr: document.querySelector('#roomData .rd-hdr')?.textContent || '',
    size: getComputedStyle(document.getElementById('roomData')).fontSize,
  }));

  // The panel goes fullscreen, which is what makes the wall wide.
  await page.dblclick('#masterBus .mb-cell-3d');
  await page.waitForTimeout(600);
  const full = await page.evaluate(() => {
    paintRoomData();
    return {
      hdr: document.querySelector('#roomData .rd-hdr')?.textContent || '',
      size: getComputedStyle(document.getElementById('roomData')).fontSize,
    };
  });
  const count = (s) => s.split('RMS').length - 1;

  expect(count(full.hdr), `${count(dock.hdr)} tiles in the dock and `
    + `${count(full.hdr)} on the whole screen — the wall did not tile`)
    .toBeGreaterThan(count(dock.hdr));
  // Tiled, not stretched: same type at both sizes.
  expect(full.size, 'the type grew with the wall').toBe(dock.size);
});

/// A column's place does not depend on its neighbours being switched on.
///
/// The block is a readout you watch while it runs. Packing only the streams
/// that were on meant switching one off pulled every column after it to the
/// left — turn off IDX and SRC lands where OUT was, so a number you had been
/// reading in one place became a different number in the same place. That is
/// the same fault as a field that reflows as its value changes, which is why
/// every field is padded to a fixed width in the first place.
test('a stream keeps its column when its neighbours are switched off',
  async ({ page }) => {
    await openRoom(page);
    const read = (off) => page.evaluate((drop) => {
      roomEdit.layers.data = true;
      roomEdit.streams = Object.fromEntries(
        ROOM_STREAMS.map((c) => [c.key, !drop.includes(c.key)]));
      paintRoomData();
      const hdr = document.querySelector('#roomData .rd-hdr')?.textContent || '';
      const row = document.querySelector('#roomData .rd-row')?.textContent || '';
      return { hdr, row };
    }, off);

    const all = await read([]);
    const some = await read(['idx', 'src']);

    // Where a label sits, before and after.
    for (const label of ['OUT', 'SIZE', 'PIT', 'RMS']) {
      expect(some.hdr.indexOf(label),
        `${label} moved from ${all.hdr.indexOf(label)} to ${some.hdr.indexOf(label)} `
        + `when two other streams were switched off`).toBe(all.hdr.indexOf(label));
    }
    // The ones that were switched off leave their room behind rather than
    // closing it up.
    expect(some.hdr.indexOf('IDX'), 'IDX is still printed').toBe(-1);
    expect(some.hdr.length, 'the header closed up instead of holding its places')
      .toBe(all.hdr.length);

    // And the numbers are under the labels, which is the point of all of it.
    // `fitCell` right-aligns every field, so a column's right edge is where its
    // label's right edge is.
    for (const label of ['OUT', 'SIZE', 'RMS']) {
      const end = some.hdr.indexOf(label) + label.length;
      const under = some.row.slice(0, end).trimEnd();
      expect(under.length, `the ${label} column's numbers do not end where `
        + 'its header does').toBe(end);
    }
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
    // **A cloud this test owns.** `openRoom` resets the room's own settings but
    // not the document's, so whichever grain rate an earlier test left behind
    // decides whether the window round the playhead holds one grain or forty.
    // With one, every row of the block prints the same grain and every index is
    // the same number — which is `first block did not ascend (0 → 0)`, and it
    // is what made this pass alone and fail in the suite.
    await page.evaluate(async () => {
      // **The longest file there is, not whichever came first.** `openRoom`
      // takes `files[0]`, and in the test library that is a tenth of a second —
      // eight times stretched at eighty grains a second is *nine* grains, so
      // the window round the playhead holds one or two and the block prints the
      // same grain in every row. Reading a direction off that compares 0 with
      // 0 whatever the renderer did.
      const folder = state.folders[0].name;
      const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
      const longest = files.slice().sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
      await selectFile(longest);
      document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]')?.click();
      await postJSON('/api/edit', {
        p: state.selectedFile.path, op: 'stretch',
        ratio: 8, algorithm: 'granular', quality: 'standard',
        grain: { rateHz: 80, layers: 1, densityHz: 0 },
      });
    });
    // Waited for rather than slept through: the schedule arrives when it
    // arrives, and 700 ms was a guess that held until the machine was busy.
    await page.waitForFunction(
      () => (state.grains?.grains?.length || 0) > 20, null, { timeout: 15_000 });

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

    // The precondition, said plainly. Reading a *direction* needs a window with
    // more than one grain in it; with one, every row is that grain and the
    // comparison is 0 against 0 whatever the renderer did.
    expect(new Set(shape.firsts).size,
      `the block printed the same grain in every row (${shape.firsts.slice(0, 6).join(', ')})`)
      .toBeGreaterThan(1);

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

test('grains spawn from the schedule, then travel on their own',
  async ({ page }) => {
    await openRoom(page);

    const out = await page.evaluate(async () => {
      const gl = document.getElementById('visGl');
      const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
      if (!ctx) return null;
      for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
      roomEdit.layers.grains = true;

      const sr = 44100, srcFrames = sr * 10;
      const grains = [];
      for (let i = 0; i < 100; i++) {
        const f = i / 99;
        grains.push([Math.round(f * sr * 2), Math.round(f * srcFrames),
          Math.round(sr * 0.04), 0, 0.5, 0.5, 0, i]);
      }

      const paint = (payload) => {
        visGl.frame({
          cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
          cam: roomCamera(), layers: roomLayers(),
          grainRate: sr, srcFrames, positionRate: sr, pollMs: 50,
          ...payload,
        });
        const px = new Uint8Array(gl.width * gl.height * 4);
        ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        const cols = new Set(); const rws = new Set();
        let n = 0, deepest = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] + px[i + 1] + px[i + 2] > 12) {
            n++;
            const q = (i / 4) | 0;
            cols.add(q % gl.width); rws.add((q / gl.width) | 0);
          }
        }
        return { n, cols: cols.size, rows: rws.size, width: gl.width, height: gl.height, deepest };
      };

      // The first frame only sets the baseline: nothing has been crossed yet,
      // so nothing is born. That is the point — the schedule says *when* a
      // grain arrives, and arriving is an event, not a standing fact.
      const first = paint({ grains, position: 0 });
      // Walked forward the way a playhead walks, in steps well under the jump
      // that counts as a seek. A seek is not a birth: skipping two seconds
      // ahead did not *play* the grains in between, so they were never heard
      // and must never appear.
      let born = first;
      for (let t = 0.1; t <= 2.0001; t += 0.1) {
        born = paint({ grains, position: Math.round(sr * t) });
      }

      // Now sever it: no schedule at all, and no playhead. Whatever is in the
      // room was heard, and it should still be flying.
      await new Promise((r) => setTimeout(r, 350));
      const orphaned = paint({ grains: null, position: 0 });
      await new Promise((r) => setTimeout(r, 350));
      const later = paint({ grains: null, position: 0 });

      return { first, born, orphaned, later };
    });

    if (out === null) test.skip(true, 'no readable WebGL context in this harness');

    expect(out.first.n, 'grains appeared before the playhead reached them').toBe(0);
    expect(out.born.n, 'the playhead crossed the schedule and nothing was born')
      .toBeGreaterThan(0);
    // Scattered over the face of the room, not laid along one axis.
    expect(out.born.cols, `the cloud lit ${out.born.cols} columns of ${out.born.width}`)
      .toBeGreaterThan(out.born.width * 0.2);
    expect(out.born.rows, `the cloud lit ${out.born.rows} rows of ${out.born.height}`)
      .toBeGreaterThan(out.born.height * 0.1);

    // The half that matters here: the data is gone and they are still there.
    expect(out.orphaned.n, 'the grains vanished the moment the schedule did')
      .toBeGreaterThan(0);
    expect(out.later.n, 'the grains stopped travelling once orphaned')
      .toBeGreaterThan(0);
    // And they are receding — a grain further from the eye covers less of the
    // screen, so the lit area falls as the journey goes on.
    expect(out.later.n, `${out.orphaned.n} then ${out.later.n}: they are not receding`)
      .toBeLessThan(out.orphaned.n);
  });

/// The skin stands on its own, the way the terrain does against the edge.
test('the skin draws with the hoops turned off', async ({ page }) => {
  await openRoom(page);

  const lit = await page.evaluate(async () => {
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'room', 'data', 'grains']) roomEdit.layers[k] = false;

    const liss = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const t = (i / 256) * Math.PI * 2;
      liss[i * 2] = 0.7 * Math.sin(t * 3);
      liss[i * 2 + 1] = 0.7 * Math.sin(t * 2);
    }
    for (let i = 0; i < 24; i++) visGl.push(new Float32Array(128).fill(-40), liss);

    const count = () => new Promise((res) => requestAnimationFrame(() => {
      visGl.frame({ cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers() });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 12) n++;
      res(n);
    }));

    roomEdit.layers.sky = false; roomEdit.layers.skin = true;
    const skinOnly = await count();
    roomEdit.layers.skin = false;
    const neither = await count();
    return { skinOnly, neither };
  });

  if (lit === null) test.skip(true, 'no readable WebGL context in this harness');
  expect(lit.skinOnly, 'the skin needs the hoops to draw').toBeGreaterThan(0);
  expect(lit.neither, 'something drew with both off').toBe(0);
});

/// The grains persist far deeper than the floor's trail.
///
/// They shared the terrain's 2.8 seconds and the room drew about a hundred of
/// four thousand in hand — the depth window was the limit, not the cap, and the
/// room was thinner than the waveform's own grain layer for no visible reason.
/// A spectrum ridge becomes fog when it is stacked deep; a grain stays a mark.
test('the room holds far more schedule than the floor does', async ({ page }) => {
  await openRoom(page);

  const seen = await page.evaluate(() => {
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
    roomEdit.layers.grains = true;

    // Twelve seconds of grains at fifty a second, and a playhead at the end of
    // them — so what is drawn is entirely a question of how deep the room is.
    const sr = 44100, srcFrames = sr * 60;
    const grains = [];
    for (let i = 0; i < 600; i++) {
      grains.push([Math.round((i / 50) * sr), Math.round((i / 600) * srcFrames),
        Math.round(sr * 0.04), 0, 0.5, 0.5, 0, i]);
    }

    const shot = () => {
      // Walked, not jumped: a grain is born when the playhead crosses it, and
      // a leap forward is a seek rather than twelve seconds of playing.
      for (let t = 0; t <= 12.0001; t += 0.2) {
        visGl.frame({
          cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
          cam: roomCamera(), layers: roomLayers(),
          grains, grainRate: sr, srcFrames,
          position: Math.round(sr * t), positionRate: sr, pollMs: 50,
        });
      }
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 12) n++;
      return n;
    };

    // How many of those 600 fall inside the room, worked out the same way the
    // renderer does, so the assertion is about the window and not about pixels.
    const inSpan = (span) => grains.filter((e) => {
      const a = (12 - e[0] / sr) / span;
      return a >= -0.02 && a <= 1;
    }).length;

    return { lit: shot(), floorsTrail: inSpan(2.8), roomsDepth: inSpan(14) };
  });

  if (seen === null) test.skip(true, 'no readable WebGL context in this harness');
  expect(seen.lit, 'the grains drew nothing').toBeGreaterThan(0);
  expect(seen.floorsTrail, 'the floor-length window should hold about 140').toBeLessThan(200);
  // Five times the depth, five times the schedule in the air.
  expect(seen.roomsDepth, `${seen.roomsDepth} in the room against ${seen.floorsTrail} in the floor's trail`)
    .toBeGreaterThan(seen.floorsTrail * 3);
});

// ── the frame is honoured, and a portrait room stands its controls outside ──
//
// The chosen frame used to need the panel open: `roomEdit.on && f.ratio > 0`.
// Closing the panel snapped the room back to the dock's own shape and threw the
// choice away, which reads as the setting not sticking. `Dock` is the setting
// that means "whatever shape the panel is"; the rest are decisions about the
// picture and outlive the editing session.

test('the frame is kept whether or not the controls are open', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(async () => {
    const cell = () => document.querySelector('#masterBus .mb-cell-3d');
    const out = {};
    if (roomEdit.on) toggleRoomEdit();          // closed
    for (const key of ['16x9', '1x1', '9x16', 'dock']) {
      roomEdit.frame = key;
      applyRoomFrame();
      await new Promise((r) => setTimeout(r, 150));
      const b = cell().getBoundingClientRect();
      out[key] = { ratio: +(b.width / b.height).toFixed(2),
        framed: cell().classList.contains('re-framed') };
    }
    return out;
  });
  expect(got['16x9'].ratio).toBeCloseTo(16 / 9, 1);
  expect(got['1x1'].ratio).toBeCloseTo(1, 1);
  expect(got['9x16'].ratio).toBeCloseTo(9 / 16, 1);
  // Dock is the one that means "the shape of the panel", so it is not framed.
  expect(got.dock.framed).toBe(false);
});

test('a framed room fits its cell instead of forcing the dock open', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(async () => {
    const cell = () => document.querySelector('#masterBus .mb-cell-3d');
    const main = () => document.querySelector('#masterBus .mb-main');
    const start = main().getBoundingClientRect().height;
    const out = {};
    for (const key of ['dock', '16x9', '1x1', '4x5', '9x16']) {
      roomEdit.frame = key;
      applyRoomFrame();
      await new Promise((r) => setTimeout(r, 150));
      const c = cell().getBoundingClientRect();
      const m = main().getBoundingClientRect();
      out[key] = {
        fits: c.width <= m.width + 1 && c.height <= m.height + 1,
        dockHeld: Math.abs(m.height - start) <= 1,
      };
    }
    return out;
  });
  for (const [key, v] of Object.entries(got)) {
    // A 9:16 frame in a short dock came out 882 px tall and forced the whole
    // dock open, because the width was capped and the ratio derived the height.
    expect(v.fits, `${key} does not fit inside its cell`).toBe(true);
    expect(v.dockHeld, `${key} changed the dock's height`).toBe(true);
  }
});

test('a portrait room puts its controls beside it, not inside it', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(async () => {
    const cell = () => document.querySelector('#masterBus .mb-cell-3d');
    const main = () => document.querySelector('#masterBus .mb-main');
    const panel = () => document.getElementById('roomEdit');
    const out = {};
    for (const key of ['dock', '16x9', '1x1', '4x5', '9x16']) {
      roomEdit.frame = key;
      applyRoomFrame();
      await new Promise((r) => setTimeout(r, 150));
      const p = panel().getBoundingClientRect();
      const c = cell().getBoundingClientRect();
      out[key] = {
        outside: panel().parentElement === main(),
        // Actually clear of the room, not merely reparented.
        clearOfTheRoom: p.right <= c.left + 1 || p.left >= c.right - 1,
      };
    }
    return out;
  });
  // Landscape letterboxes into thin bars top and bottom, which no control would
  // fit in — those keep the overlay.
  expect(got.dock.outside).toBe(false);
  expect(got['16x9'].outside).toBe(false);
  expect(got['1x1'].outside).toBe(false);
  // Portrait leaves empty cell either side, and that is where they go.
  expect(got['4x5'].outside, '4:5 kept its controls inside the room').toBe(true);
  expect(got['9x16'].outside, '9:16 kept its controls inside the room').toBe(true);
  expect(got['9x16'].clearOfTheRoom, 'the controls still overlap the room').toBe(true);
});
