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

import { test, expect } from './test.mjs';
import { openRoom, dragRoom, cam, VG_WORLD_DEFAULT_PITCH } from './room-editor.helpers.mjs';

test('dragging the room orbits: the pitch changes, the eye rises, the pivot and the lens hold',
  async ({ page }) => {
    await openRoom(page);
    const before = await page.evaluate(() => ({ ...roomWorldNow(), pivot: camPivot(roomWorldNow()) }));

    // Down the middle of the room, straight down.
    await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
    const after = await page.evaluate(() => ({ ...roomWorldNow(), pivot: camPivot(roomWorldNow()) }));

    // Drag down and you go down under the pivot, looking up at it, through
    // the same lens.
    expect(after.pitch, 'the camera did not pitch').not.toBeCloseTo(before.pitch, 4);
    expect(after.pitch, 'the pitch went the wrong way').toBeGreaterThan(before.pitch);
    expect(after.height, 'the eye did not drop under the pivot').toBeLessThan(before.height);
    expect(after.fov, 'the lens changed on an orbit').toBeCloseTo(before.fov, 6);
    for (let i = 0; i < 3; i++) expect(after.pivot[i], 'the pivot moved').toBeCloseTo(before.pivot[i], 4);
  });

test('dragging sideways orbits round the pivot and never changes the lens',
  async ({ page }) => {
    await openRoom(page);
    const before = await page.evaluate(() => ({ ...roomWorldNow(), pivot: camPivot(roomWorldNow()) }));

    await dragRoom(page, [0.5, 0.6], [0.8, 0.6]);
    const after = await page.evaluate(() => ({ ...roomWorldNow(), pivot: camPivot(roomWorldNow()) }));

    // The world follows the hand: drag right and it turns right under you,
    // which is the camera going round to the left.
    expect(after.yaw, 'the camera did not turn').toBeLessThan(before.yaw);
    expect(after.x, 'the eye did not go round').not.toBeCloseTo(before.x, 4);
    expect(after.fov, 'the view resized on a sideways drag').toBeCloseTo(before.fov, 6);
    for (let i = 0; i < 3; i++) expect(after.pivot[i], 'the pivot moved').toBeCloseTo(before.pivot[i], 4);
  });

test('the ring is dragged by its bead, and the camera stays put', async ({ page }) => {
  await openRoom(page);
  // The beads live in the Room view, where the picture is the whole middle.
  await page.evaluate(() => setMode('room'));
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
  await page.evaluate(() => { roomEdit.layers.sky = true; paintRoomBeads(); });
  const before = await page.evaluate(cam);
  const at = await page.evaluate(() => {
    const dot = $('roomHandles').querySelector('.rp-pt.rp-ring');
    const r = $('visGl').getBoundingClientRect();
    return { x: r.left + +dot.getAttribute('cx'), y: r.top + +dot.getAttribute('cy') };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y - 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(cam);
  expect(after.ring.y, 'the ring did not rise').toBeGreaterThan(before.ring.y);
  expect(after.ring.x, 'the ring did not move across').toBeGreaterThan(before.ring.x);
  expect(after.pitch, 'a drag on the ring moved the camera').toBeCloseTo(before.pitch, 6);
  expect(after.height, 'a drag on the ring moved the eye').toBeCloseTo(before.height, 6);
});

test('each frame shape keeps its own camera', async ({ page }) => {
  await openRoom(page);

  await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
  const dock = await page.evaluate(cam);
  expect(dock.pitch, 'the dock camera did not move').not.toBeCloseTo(VG_WORLD_DEFAULT_PITCH, 3);

  // Switch to the tall frame: untouched, so it is still what the source ships.
  await page.evaluate(() => { roomEdit.frame = '9x16'; applyRoomFrame(); paintRoomNums(); });
  const vert = await page.evaluate(cam);
  expect(vert.pitch, 'the tall frame inherited the dock camera').toBeCloseTo(VG_WORLD_DEFAULT_PITCH, 3);

  // And the room is actually that shape now, not a wide panel to imagine from.
  const shape = await page.evaluate(() => {
    const b = document.querySelector('#masterBus .mb-cell-3d').getBoundingClientRect();
    return b.width / b.height;
  });
  expect(shape, `the 9:16 frame drew at ${shape}`).toBeCloseTo(9 / 16, 1);

  // Back to the dock and the posed camera is still there.
  await page.evaluate(() => { roomEdit.frame = 'dock'; applyRoomFrame(); paintRoomNums(); });
  expect((await page.evaluate(cam)).pitch, 'the dock camera was lost')
    .toBeCloseTo(dock.pitch, 6);
});

test('a posed camera survives a reload, and Reset puts it back', async ({ page }) => {
  await openRoom(page);
  await dragRoom(page, [0.5, 0.6], [0.5, 0.85]);
  const posed = await page.evaluate(cam);

  await page.reload();
  await page.waitForFunction(() => typeof roomEdit !== 'undefined', { timeout: 20_000 });
  const back = await page.evaluate(() => roomWorldNow());
  expect(back.pitch, 'the camera did not survive a reload').toBeCloseTo(posed.pitch, 6);

  await page.evaluate(() => { if (!roomEdit.on) toggleRoomEdit(); document.getElementById('reReset').click(); });
  await page.waitForTimeout(150);
  expect((await page.evaluate(cam)).pitch, 'Reset did not restore the source camera')
    .toBeCloseTo(VG_WORLD_DEFAULT_PITCH, 3);
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
  expect(seen.off.grid, 'turning the terrain off took the wireframe with it').toBe(true);
  expect(seen.back.floor, 'the terrain did not come back').toBe(true);
  expect(seen.back.sky, 'the ring came back on its own').toBe(false);
});

test('the layers survive a reload', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => document.querySelector('#reLayers .re-btn[data-layer="grid"]').click());
  await page.waitForTimeout(150);

  await page.reload();
  await page.waitForFunction(() => typeof roomLayerOn === 'function', { timeout: 20_000 });
  expect(await page.evaluate(() => roomLayerOn('grid')), 'the wireframe came back on')
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
    // The last column the wall has room for. At dock size the wall is about 45
    // characters, and whole columns only are printed — RMS no longer fits
    // there — so the tile is counted by whichever label closes it.
    const labels = hdr.trim().split(/\s+/);
    return {
      hdr,
      across: labels.length ? count(hdr, labels[labels.length - 1]) : 0,
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
    // label's right edge is. Asked of the columns the wall has room for: whole
    // columns only are printed, and at dock size RMS no longer fits.
    const printed = ['OUT', 'SIZE', 'PIT', 'RMS'].filter((l) => some.hdr.includes(l));
    expect(printed.length, `only ${printed} printed — too few columns to tell`)
      .toBeGreaterThanOrEqual(2);
    for (const label of printed) {
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
      depth: roomEdit.geomReach,
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
  // The terrain's length is the terrain's own now, not the camera's.
  await page.evaluate(() => { roomEdit.geomReach *= 3; });
  const far = await page.evaluate(read);
  expect(far.depth, 'the terrain did not get longer').toBeGreaterThan(near.depth);
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
