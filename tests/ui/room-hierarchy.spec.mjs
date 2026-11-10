// The layer hierarchy, occlusion, and the ring's own size.
//
// Three controls that all answer "what does the room look like" rather than
// "where is the room", which is the line between this and `room-editor`: the
// camera is a pose and these are not.

import { test, expect } from './test.mjs';
import { PUSH_SIGNAL, openRoom } from './room-hierarchy.helpers.mjs';

test('the layers are stacked top to bottom, in hierarchy order', async ({ page }) => {
  await openRoom(page);
  const seen = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#reLayers .re-layer')];
    return {
      keys: rows.map((r) => r.dataset.layer),
      order: roomOrder(),
      // Stacked, not laid in a line: each row starts below the last.
      stacked: rows.every((r, i) => i === 0
        || r.getBoundingClientRect().top >= rows[i - 1].getBoundingClientRect().bottom - 1),
      // And every one carries its own occlusion switch.
      switches: rows.filter((r) => r.querySelector('.re-occ')).length,
    };
  });
  // The drawn layers first, in the hierarchy's order, then the ones that are
  // not in the room at all.
  expect(seen.keys.slice(0, seen.order.length),
    'the rows are not in the hierarchy\'s order').toEqual(seen.order);
  expect(seen.keys, 'a layer went missing from the stack')
    .toEqual([...seen.order, 'data']);
  expect(seen.stacked, 'the layer chips are still in a row, not a stack').toBe(true);
  // One switch each, for the layers that are actually drawn.
  expect(seen.switches, 'a drawn layer has no occlusion switch').toBe(seen.order.length);
});

/// Moving one up the list moves it up the hierarchy, and it stays there.
test('the hierarchy can be reordered and is remembered', async ({ page }) => {
  await openRoom(page);
  const before = await page.evaluate(() => roomOrder());
  await page.evaluate((k) => {
    // What the drop handler does, without asking Playwright to synthesise a
    // native drag — the reorder is the thing under test, not the gesture.
    const order = roomOrder().filter((x) => x !== k);
    order.unshift(k);
    roomEdit.order = order;
    saveRoomHierarchy();
    buildRoomLayers();
  }, before[before.length - 1]);

  const moved = await page.evaluate(() => roomOrder());
  expect(moved[0], 'the layer did not reach the top').toBe(before[before.length - 1]);

  await page.reload();
  await page.waitForFunction(() => typeof roomOrder === 'function', { timeout: 20_000 });
  const kept = await page.evaluate(() => roomOrder());
  expect(kept, 'the hierarchy was not remembered').toEqual(moved);
});

/// Occlusion is per layer, off by default, and remembered.
test('each layer has its own occlusion, off until asked for', async ({ page }) => {
  await openRoom(page);
  const initial = await page.evaluate(() => roomOcclude());
  expect(Object.values(initial).every((v) => v === false),
    'something occludes before being asked to').toBe(true);

  await page.evaluate(() => {
    document.querySelector('#reLayers .re-occ[data-occlude="grains"]').click();
  });
  const on = await page.evaluate(() => ({
    map: roomOcclude(),
    lit: document.querySelector('#reLayers .re-occ[data-occlude="grains"]')
      .classList.contains('active'),
  }));
  expect(on.map.grains, 'the switch did not take').toBe(true);
  expect(on.map.grid, 'one switch turned another layer on').toBe(false);
  expect(on.lit, 'the switch does not show as on').toBe(true);

  await page.reload();
  await page.waitForFunction(() => typeof roomOcclude === 'function', { timeout: 20_000 });
  expect((await page.evaluate(() => roomOcclude())).grains,
    'occlusion was not remembered').toBe(true);
});

/// Grains stand in front of each other, and not in front of themselves.
///
/// The whole of what the mask is for. A grain drawn as a wireframe solid shows
/// its own far side — that is what makes it read as a wire and not a lump — so
/// the mask sits at the *back* of the grain: everything it owns is in front of
/// it and everything behind it is gone.
test('occlusion takes light out of the cloud without taking it out of a grain',
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
      // Dense, so there is plenty standing behind something else.
      for (let i = 0; i < 1600; i++) {
        const t = i / 320;
        grains.push([Math.round(t * sr), Math.round((t / 5) * srcFrames),
          Math.round(sr * 0.04), 0, 0.5, 0.5, 0, i]);
      }
      const send = (occlude, pos) => visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(),
        occlude: { grains: occlude }, order: roomOrder(),
        grains, grainRate: sr, srcFrames, positionRate: sr, pollMs: 50,
        position: Math.round(sr * pos),
      });

      // **Walked in against the wall clock, not poured in.**
      //
      // A grain's depth is its age, and its age runs on real time — so a
      // schedule fed to the room in one synchronous loop arrives as a flat
      // sheet of grains all born the same instant, every one at the near face
      // with nothing behind it. Occlusion then correctly hides nothing, and the
      // first version of this test read that as the mask being broken. Let real
      // time pass and the same grains spread down the room, which is the only
      // state in which "in front of" means anything at all.
      send(false, 0);
      for (let t = 0.1; t <= 5.0001; t += 0.1) {
        send(false, t);
        await new Promise((r) => requestAnimationFrame(r));
      }
      await new Promise((r) => setTimeout(r, 1500));

      const read = () => {
        const px = new Uint8Array(gl.width * gl.height * 4);
        ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        let lit = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
        }
        return lit;
      };
      send(false, 5); const off = read();
      send(true, 5); const on = read();
      return { off, on, live: visGl.grainShapeNames().length };
    });

    if (out === null) test.skip(true, 'no readable WebGL context in this harness');

    expect(out.live, 'no cloud to occlude').toBeGreaterThan(200);
    // Something has to go, or the mask is standing in nobody's way.
    expect(out.on, `${out.off} lit without occlusion, ${out.on} with — nothing was hidden`)
      .toBeLessThan(out.off * 0.98);
    // But not half of it. A grain masking *itself* would take its own far side
    // with it, and since a wireframe solid is about half far side, the cloud
    // would halve rather than thin. This is the only reading available from
    // pixels — the shapes are too small to check one by one — so it is a bound
    // rather than a proof.
    expect(out.on, `${out.on} of ${out.off} left — the grains are masking themselves`)
      .toBeGreaterThan(out.off * 0.6);
  });

/// The ring's size is a preference about the room's contents, not a pose.
test('the ring slider resizes the ring without touching the camera', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(() => {
    const posed = roomCamera();
    // The drawn camera may be a box (a number) or a world camera (a size).
    const ringOf = (c) => (typeof c.ring === 'number' ? c.ring : c.ring.size);
    const small = (() => { roomEdit.ringScale = 0.4; return ringOf(roomCameraDrawn()); })();
    const big = (() => { roomEdit.ringScale = 2.2; return ringOf(roomCameraDrawn()); })();
    return { posed, small, big, base: vgCamera(roomCamera()).ring };
  });
  expect(out.small, 'the slider did not shrink the ring').toBeLessThan(out.base);
  expect(out.big, 'the slider did not grow the ring').toBeGreaterThan(out.base);
  // The pose is untouched — it is what gets copied out of `reNums` and pasted
  // back into `vis-gl.js`, and it must not carry somebody's slider with it.
  expect(await page.evaluate(() => roomCamera()), 'the slider wrote into the camera')
    .toEqual(out.posed);
});

/// And it is remembered, like the block size and the opacity beside it.
test('the ring size is remembered', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    const el = document.getElementById('reRing');
    el.value = '180';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  });
  expect(await page.evaluate(() => roomEdit.ringScale)).toBeCloseTo(1.8, 2);
  await page.reload();
  await page.waitForFunction(() => typeof roomEdit === 'object', { timeout: 20_000 });
  expect(await page.evaluate(() => roomEdit.ringScale), 'the ring size was not kept')
    .toBeCloseTo(1.8, 2);
});

/// How much of the cloud is drawn, and how hot it burns.
///
/// Both are about the picture. The cloud's *rate* has its own control in front
/// of the engine and that one changes the sound; these two never touch the
/// schedule, which is the thing worth pinning — a visual control that quietly
/// changed what you hear would be the worst kind of bug to find late.
test('the cloud slider thins the picture and not the schedule', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(async () => {
    for (const k of ['floor', 'lead', 'sky', 'skin', 'grid', 'data']) roomEdit.layers[k] = false;
    roomEdit.layers.grains = true;

    const sr = 44100, srcFrames = sr * 10;
    const grains = [];
    for (let i = 0; i < 400; i++) {
      const t = i / 80;
      grains.push([Math.round(t * sr), Math.round((t / 5) * srcFrames),
        Math.round(sr * 0.04), 0, 0.5, 0.5, 0, i]);
    }

    // **Counted as births, not as a population.**
    //
    // A grain lives fourteen seconds and goes on flying after its schedule is
    // taken away — that is the point of them — so the cloud from one run is
    // still in the air during the next, and reading the population gave the
    // *thinner* setting a bigger number than the full one. What each run
    // actually did is the difference it made.
    const walk = (grainDensity, from) => {
      const before = visGl.grainShapeNames().length;
      const send = (pos) => visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(), order: roomOrder(),
        grainDensity,
        grains, grainRate: sr, srcFrames, positionRate: sr, pollMs: 50,
        position: Math.round(sr * pos),
      });
      send(from);
      for (let t = from + 0.1; t <= from + 5.0001; t += 0.1) send(t);
      return visGl.grainShapeNames().length - before;
    };

    // Different stretches of the same schedule, so neither run is reading the
    // grains the other already took.
    const full = walk(1, 0);
    const thin = walk(0.25, 0);
    return { full, thin, sched: grains.length };
  });

  expect(out.full, 'the whole cloud was not drawn').toBeGreaterThan(300);
  // A coin per grain rather than a quota, so near enough a quarter.
  expect(out.thin, `${out.thin} born at a quarter density, against ${out.full} at full`)
    .toBeLessThan(out.full * 0.45);
  expect(out.thin, 'thinning emptied the room instead of thinning it')
    .toBeGreaterThan(out.full * 0.1);
});

/// Brighter is brighter, and it is not more grains.
///
/// Read off one cloud drawn twice rather than two clouds — brightness is
/// applied where a grain is drawn, not where it is born, so the same grains in
/// the same places can be asked for at two settings and the only difference is
/// the one being measured.
test('the burn slider brightens the same cloud', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(async () => {
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'sky', 'skin', 'grid', 'data']) roomEdit.layers[k] = false;
    roomEdit.layers.grains = true;

    const sr = 44100, srcFrames = sr * 10;
    const grains = [];
    for (let i = 0; i < 400; i++) {
      const t = i / 80;
      grains.push([Math.round(t * sr), Math.round((t / 5) * srcFrames),
        Math.round(sr * 0.04), 0, 0.5, 0.5, 0, i]);
    }
    const send = (grainBright, pos) => visGl.frame({
      cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
      cam: roomCamera(), layers: roomLayers(), order: roomOrder(),
      grainBright,
      grains, grainRate: sr, srcFrames, positionRate: sr, pollMs: 50,
      position: Math.round(sr * pos),
    });
    send(1, 0);
    for (let t = 0.1; t <= 5.0001; t += 0.1) send(1, t);
    const drawn = visGl.grainShapeNames().length;

    const read = () => {
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let lit = 0, sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i] + px[i + 1] + px[i + 2];
        if (v > 12) { lit++; sum += v; }
      }
      return { lit, mean: sum / Math.max(1, lit) };
    };
    send(1, 5); const plain = read();
    send(2.5, 5); const hot = read();
    const after = visGl.grainShapeNames().length;
    return { plain, hot, drawn, after };
  });

  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  expect(out.drawn, 'no cloud to brighten').toBeGreaterThan(200);
  expect(out.after, 'turning the brightness up changed how many grains there are')
    .toBe(out.drawn);
  expect(out.hot.mean, `mean pixel ${out.plain.mean.toFixed(1)} at 1×, `
    + `${out.hot.mean.toFixed(1)} at 2.5× — the slider did not brighten anything`)
    .toBeGreaterThan(out.plain.mean);
});

/// And both are remembered, like the ring size and the block beside them.
test('the grain sliders are remembered', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    for (const [id, v] of [['reGrainDensity', '40'], ['reGrainBright', '220']]) {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    }
  });
  await page.reload();
  await page.waitForFunction(() => typeof roomEdit === 'object', { timeout: 20_000 });
  const kept = await page.evaluate(() => [roomEdit.grainDensity, roomEdit.grainBright]);
  expect(kept[0], 'the density was not kept').toBeCloseTo(0.4, 2);
  expect(kept[1], 'the brightness was not kept').toBeCloseTo(2.2, 2);
});

/// What the hierarchy can and cannot do, stated as tests.
///
/// All three of these read as the control being ignored, and none of them is —
/// they are what geometric occlusion over additive blending actually means. They
/// are pinned because the interface makes promises about the order, and these
/// are the exact edges of what it can deliver.

/// Order alone does nothing, and the interface says so.
test('with nothing occluding, the order makes no usable difference', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate((src) => {
    const pushSignal = new Function('visGl', src).bind(null, visGl);
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['grid', 'floor', 'lead', 'sky', 'skin', 'grains']) roomEdit.layers[k] = true;
    roomEdit.layers.data = false;
    pushSignal();
    const shot = (order) => {
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(), order, occlude: {}, pollMs: 50,
      });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum;
    };
    const a = roomOrder();
    return { a: shot(a), b: shot(a.slice().reverse()), live: roomHierarchyLive() };
  }, PUSH_SIGNAL);
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // **Near enough identical, and not exactly so.** Addition does not care what
  // order it happens in, but this addition saturates at 255 a channel at a
  // time, and saturating addition is not associative — clamp(clamp(a+b)+c) and
  // clamp(clamp(a+c)+b) part company wherever something clipped. On a dark
  // scene the two are equal to the byte; on a bright one they differ by a
  // fraction of a per cent, which is a rounding artefact and not a hierarchy.
  //
  // The bound is loose on purpose. How much clipping there is depends on how
  // bright the scene is, so this figure moves whenever the room's own shading
  // does — fixing the depth fade took it from 0.4% to 0.55% without anything
  // about the ordering changing at all. What it has to catch is order becoming
  // *usable*: a layer visibly landing in front of another is a whole-number
  // percentage, not a fraction of one.
  const drift = Math.abs(out.a - out.b) / out.a;
  expect(drift, `reversing the whole stack moved ${(drift * 100).toFixed(2)}% of `
    + 'the light — that is more than saturation can account for, so the order is '
    + 'doing something').toBeLessThan(0.03);
  // So the interface must not imply otherwise.
  expect(out.live, 'the hierarchy claims to be live with nothing occluding').toBe(false);
  expect(await page.evaluate(() =>
    document.getElementById('reLayers').classList.contains('re-flat')),
  'the layer stack does not show that the order is inert').toBe(true);
});

/// A layer at the bottom masks nothing, because nothing follows it.
test('occlusion only reaches the layers below it in the list', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate((src) => {
    const pushSignal = new Function('visGl', src).bind(null, visGl);
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['grid', 'floor', 'lead', 'sky', 'skin', 'grains']) roomEdit.layers[k] = true;
    roomEdit.layers.data = false;
    pushSignal();
    const shot = (order, occlude) => {
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(), order, occlude, pollMs: 50,
      });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum;
    };
    const rest = roomOrder().filter((k) => k !== 'floor');
    return {
      plain: shot(roomOrder(), {}),
      top: shot(['floor', ...rest], { floor: true }),
      bottom: shot([...rest, 'floor'], { floor: true }),
    };
  }, PUSH_SIGNAL);
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // The terrain is a surface, so from the top of the list it hides a great deal.
  expect(out.top, `${out.plain} plain, ${out.top} with the terrain occluding from `
    + 'the top — it hid nothing').toBeLessThan(out.plain * 0.99);
  // **From the bottom it still hides itself.** Nothing is drawn after it, so it
  // masks no other layer — but a surface written into the depth buffer occludes
  // its own far side, and the terrain is a landscape whose near ridges stand in
  // front of its far ones. That is worth having and is easy to mistake for the
  // hierarchy working when it is not.
  expect(out.bottom, 'the terrain did not even occlude itself').toBeLessThan(out.plain);
  // And it is much less than it hides from the top, which is the part that
  // actually depends on where it sits in the list.
  expect(out.plain - out.bottom, `from the bottom it hid ${out.plain - out.bottom} `
    + `and from the top ${out.plain - out.top} — its place in the list made no `
    + 'difference').toBeLessThan((out.plain - out.top) * 0.6);
});

/// The Data block is not in the room, and is not offered controls that pretend
/// it is.
test('the Data block has no place in the hierarchy and no occlusion',
  async ({ page }) => {
    await openRoom(page);
    const out = await page.evaluate(() => ({
      order: roomOrder(),
      occlude: Object.keys(roomOcclude()),
      hasSwitch: !!document.querySelector('#reLayers .re-occ[data-occlude="data"]'),
      draggable: document.querySelector('#reLayers .re-layer[data-layer="data"]')?.draggable,
      // It is still a layer you can turn off.
      hasToggle: !!document.querySelector('#reLayers .re-layer-name[data-layer="data"]'),
    }));
    expect(out.order, 'Data is in the room\'s draw order').not.toContain('data');
    expect(out.occlude, 'Data is offered to the renderer as an occluder').not.toContain('data');
    expect(out.hasSwitch, 'Data has an occlusion switch that cannot do anything').toBe(false);
    expect(out.draggable, 'Data can be dragged up an order it is not in').toBe(false);
    expect(out.hasToggle, 'Data lost its own on/off switch').toBe(true);
  });

/// How hard the sound pushes the ring out of round.
test('the drive slider reaches far past what the ring used to do', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate((src) => {
    const pushSignal = new Function('visGl', src).bind(null, visGl);
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'skin', 'grains', 'data', 'grid']) roomEdit.layers[k] = false;
    roomEdit.layers.sky = true;
    pushSignal();
    const shot = (ringDrive) => {
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(), order: roomOrder(), occlude: {},
        ringDrive, ringEdge: 0, pollMs: 50,
      });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let lo = 1e9, hi = -1e9, lit = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] + px[i + 1] + px[i + 2] > 12) {
          const x = ((i / 4) | 0) % gl.width;
          lit++; if (x < lo) lo = x; if (x > hi) hi = x;
        }
      }
      return { lit, wide: hi - lo };
    };
    return { off: shot(0), one: shot(1), hard: shot(8) };
  }, PUSH_SIGNAL);
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // At nothing the ring is a plain circle; at one it is what it always was.
  expect(out.one.wide, 'the ring is no wider with the sound in it than without')
    .toBeGreaterThan(out.off.wide);
  // And the top of the range is a long way past that — "a lot more" is the
  // whole point of the control, so a range that merely doubled would be a
  // slider not worth having.
  expect(out.hard.wide, `${out.off.wide}px still, ${out.one.wide}px at 1×, `
    + `${out.hard.wide}px at 8× — the top of the range is not far enough past `
    + 'the middle to be worth a slider').toBeGreaterThan(out.one.wide * 2);
});

/// A dark border under the ring's lines, so a stack of hoops reads as a stack.
test('the ring carries a dark border under its lines', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate((src) => {
    const pushSignal = new Function('visGl', src).bind(null, visGl);
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'skin', 'grains', 'data', 'grid']) roomEdit.layers[k] = false;
    roomEdit.layers.sky = true;
    pushSignal();
    const shot = (ringEdge) => {
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(), order: roomOrder(), occlude: {},
        ringDrive: 1, ringEdge, pollMs: 50,
      });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let lit = 0, sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i] + px[i + 1] + px[i + 2];
        if (v > 12) { lit++; sum += v; }
      }
      return { lit, sum };
    };
    return { none: shot(0), edged: shot(0.035) };
  }, PUSH_SIGNAL);
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // The border takes light *out*. Every other mark in this room adds, and black
  // adds nothing — so this is the one pass that has to darken instead, and the
  // reading is that the trail gets dimmer rather than brighter.
  expect(out.edged.sum, `${out.none.sum} without the border, ${out.edged.sum} with — `
    + 'it added light instead of taking it away').toBeLessThan(out.none.sum);
  // But the hoops themselves survive it. A border that swallowed the lines it
  // is meant to separate would read as the ring going out.
  expect(out.edged.lit, 'the border ate the ring').toBeGreaterThan(out.none.lit * 0.4);
});

/// Filling the shapes in, and what the fill must not do.
test('a filled grain keeps its far side', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(async () => {
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'sky', 'skin', 'grid', 'data']) roomEdit.layers[k] = false;
    roomEdit.layers.grains = true;

    const sr = 44100, srcFrames = sr * 10;
    const grains = [];
    for (let i = 0; i < 500; i++) {
      const t = i / 100;
      grains.push([Math.round(t * sr), Math.round((t / 5) * srcFrames),
        Math.round(sr * 0.04), 0, 0.5, 0.5, 0, i]);
    }
    const send = (grainFill, pos) => visGl.frame({
      cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
      cam: roomCamera(), layers: roomLayers(), order: roomOrder(), occlude: {},
      grainFill,
      grains, grainRate: sr, srcFrames, positionRate: sr, pollMs: 50,
      position: Math.round(sr * pos),
    });
    send({ on: false }, 0);
    for (let t = 0.1; t <= 5.0001; t += 0.1) send({ on: false }, t);
    await new Promise((r) => setTimeout(r, 400));

    const read = () => {
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let sum = 0, bright = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i] + px[i + 1] + px[i + 2];
        sum += v;
        // High enough that only the wires and the hot cores clear it — the
        // fill itself is nowhere near this.
        if (v > 260) bright++;
      }
      return { sum, bright };
    };
    send({ on: false }, 5); const off = read();
    send({ on: true, bg: false, rgb: [0.35, 0.5, 0.8] }, 5); const col = read();
    send({ on: true, bg: true }, 5); const bg = read();
    return { off, col, bg };
  });
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // A colour is painted on, so there is more light than there was.
  expect(out.col.sum, 'filling with a colour put no colour anywhere')
    .toBeGreaterThan(out.off.sum);
  // The background is not a colour — it is the light already there, taken away.
  expect(out.bg.sum, 'filling with the background added light instead of removing it')
    .toBeLessThan(out.off.sum);

  // **And in both cases the wires survive.** The fill is drawn first and every
  // edge lands on top of it, including the far ones. A solid that hides its own
  // back edges is a lump, and the tumbling is only legible because you can see
  // through it — so this is the assertion that says what these shapes are.
  for (const [what, got] of [['a colour', out.col], ['the background', out.bg]]) {
    expect(got.bright, `filling with ${what} took the wires with it: `
      + `${out.off.bright} bright pixels became ${got.bright}`)
      .toBeGreaterThan(out.off.bright * 0.85);
  }
});

/// The two ways of filling are a state, not a swatch value.
