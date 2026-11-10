// Posing the room, continued from `room-editor.spec.mjs`: the blocks, the ring's
// skin, the grains, and the frame.

import { test, expect } from './test.mjs';
import { openRoom, cam } from './room-editor.helpers.mjs';

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
    for (const k of ['floor', 'lead', 'grid', 'data']) {
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
      for (const k of ['floor', 'lead', 'sky', 'skin', 'grid', 'data']) roomEdit.layers[k] = false;
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
    for (const k of ['floor', 'lead', 'grid', 'data', 'grains']) roomEdit.layers[k] = false;

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
    for (const k of ['floor', 'lead', 'sky', 'skin', 'grid', 'data']) roomEdit.layers[k] = false;
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

// Clear is the whole room back to default — every setting, every camera, the
// paint and the path with its waypoints — not only the trail. The editor
// stays open on the frame it was on.
test('Clear puts every setting back to default, waypoints included', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(() => {
    if (!roomEdit.on) toggleRoomEdit();
    document.getElementById('reSolidPathAdd').click();
    document.getElementById('reSolidPathAdd').click();
    roomEdit.ringDrive = 3;
    roomEdit.geomReach = 4.5;
    roomEdit.layers.grid = false;
    roomEdit.cams[roomEdit.frame] = { ...roomWorldNow(), height: 2.5 };
    roomEdit.text = { on: true, body: 'hello' };
    const added = roomEdit.solidPath.length;
    document.getElementById('reClear').click();
    const saved = JSON.parse(localStorage.getItem('roomData') || '{}');
    return {
      added, points: roomEdit.solidPath.length,
      ringDrive: roomEdit.ringDrive, reach: roomEdit.geomReach,
      grid: roomEdit.layers.grid, cams: Object.keys(roomEdit.cams).length,
      text: 'text' in roomEdit, on: roomEdit.on,
      savedPoints: (saved.solidPath || []).length,
      listed: document.querySelectorAll('#reSolidPath .re-wp').length,
    };
  });
  expect(out.added, 'the waypoints were never added').toBe(4);
  expect(out.points, 'the waypoints survived Clear').toBe(2);
  expect(out.savedPoints, 'the saved scene kept the waypoints').toBe(2);
  expect(out.ringDrive).toBe(1);
  expect(out.reach).toBe(1.9);
  expect(out.grid, 'a layer switch survived Clear').toBeUndefined();
  expect(out.cams, 'a posed camera survived Clear').toBe(0);
  expect(out.text, 'a saved-scene key survived Clear').toBe(false);
  expect(out.on, 'Clear shut the editor').toBe(true);
  expect(out.listed, 'the list did not follow').toBe(2);
});

test('a waypoint can be removed from the list, one at a time', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(() => {
    if (state.mode !== 'room') setMode('room');
    if (!roomEdit.on) toggleRoomEdit();
    roomEdit.layers.solid = true;
    document.getElementById('reSolidPathReset').click();
    document.getElementById('reSolidPathAdd').click();
    document.getElementById('reSolidPathAdd').click();
    const before = {
      points: roomEdit.solidPath.length,
      rows: document.querySelectorAll('#reSolidPath .re-wp').length,
      xs: document.querySelectorAll('#reSolidPath .re-wp-x').length,
    };
    document.querySelector('#reSolidPath .re-wp-x[data-wp="1"]').click();
    const after = {
      points: roomEdit.solidPath.length,
      xs: document.querySelectorAll('#reSolidPath .re-wp-x').length,
      beads: document.querySelectorAll('.room-path g[data-key^="path:"]').length,
      saved: (JSON.parse(localStorage.getItem('roomData') || '{}').solidPath || []).length,
    };
    return { before, after };
  });
  expect(out.before.points).toBe(4);
  expect(out.before.rows, 'the list does not show every point').toBe(4);
  expect(out.before.xs, 'the ends must not be removable').toBe(2);
  expect(out.after.points, 'the waypoint was not removed').toBe(3);
  expect(out.after.xs).toBe(1);
  expect(out.after.beads, 'the beads in the room did not follow').toBe(3);
  expect(out.after.saved, 'the removal was not saved').toBe(3);
});
