// The layer hierarchy, occlusion, and the ring's own size.
//
// Three controls that all answer "what does the room look like" rather than
// "where is the room", which is the line between this and `room-editor`: the
// camera is a pose and these are not.

import { test, expect } from '@playwright/test';

/// Push a few dozen frames of made-up sound into the room.
///
/// **`push(bands, pairs)` takes two positional arguments**, and `bands` is in
/// decibels. Handing it one object instead — `push({ spectrum, liss })` — makes
/// `bands.length` undefined, so it returns at the first line and pushes
/// nothing, silently. Two probes were written against that mistake: the room
/// went on drawing whatever real history the app already had, which is near
/// silence, and a control that scales how hard the sound pushes the ring out of
/// round then correctly did nothing at all. That read as the control being
/// broken for half an hour.
const PUSH_SIGNAL = `
  for (let p = 0; p < 40; p++) {
    const bands = new Float32Array(128);
    for (let i = 0; i < 128; i++) bands[i] = -60 + Math.abs(Math.sin(i * 0.2 + p * 0.3)) * 55;
    const pairs = new Float32Array(1024 * 2);
    for (let i = 0; i < 1024; i++) {
      pairs[i * 2] = Math.sin(i * 0.05 + p * 0.12) * 0.5;
      pairs[i * 2 + 1] = Math.cos(i * 0.037 + p * 0.12) * 0.5;
    }
    visGl.push(bands, pairs);
  }
`;

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
  await page.evaluate(() => {
    for (const k of ['roomCameras', 'roomLayers', 'roomStreams', 'roomData', 'roomHierarchy']) {
      localStorage.removeItem(k);
    }
    roomEdit.cams = {};
    roomEdit.layers = {};
    roomEdit.streams = null;
    roomEdit.order = ROOM_LAYERS.map((l) => l.key);
    roomEdit.occlude = {};
    roomEdit.ringScale = 1;
    roomEdit.grainDensity = 1;
    roomEdit.grainBright = 1;
    roomEdit.ringDrive = 1;
    roomEdit.ringEdge = 0.035;
    roomEdit.leadThick = true;
    roomEdit.ringPoints = 512;
    roomEdit.mist = false;
    roomEdit.mistAmount = 0.5;
    roomEdit.mistLength = 0.06;
    roomEdit.grainFill = false;
    roomEdit.grainFillBg = true;
    roomEdit.grainFillColour = '#1b2b3a';
    roomEdit.frame = 'dock';
    if (!roomEdit.on) toggleRoomEdit();
    buildRoomLayers();
  });
  await page.waitForTimeout(300);
}

/// The list on screen is the hierarchy, read the way a hierarchy is read.
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
  expect(on.map.room, 'one switch turned another layer on').toBe(false);
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
      for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
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
    const small = (() => { roomEdit.ringScale = 0.4; return roomCameraDrawn().ring; })();
    const big = (() => { roomEdit.ringScale = 2.2; return roomCameraDrawn().ring; })();
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
    for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
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
    for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
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
    for (const k of ['room', 'floor', 'lead', 'sky', 'skin', 'grains']) roomEdit.layers[k] = true;
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
    for (const k of ['room', 'floor', 'lead', 'sky', 'skin', 'grains']) roomEdit.layers[k] = true;
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
    for (const k of ['floor', 'lead', 'skin', 'grains', 'data', 'room']) roomEdit.layers[k] = false;
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
    for (const k of ['floor', 'lead', 'skin', 'grains', 'data', 'room']) roomEdit.layers[k] = false;
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
    for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
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
test('picking a colour stops it filling with the background', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(() => {
    roomEdit.grainFill = false;
    roomEdit.grainFillBg = true;
    document.getElementById('reGrainFill').checked = true;
    document.getElementById('reGrainFill').dispatchEvent(new Event('change'));
    const col = document.getElementById('reGrainFillColour');
    col.value = '#4488cc';
    col.dispatchEvent(new Event('input'));
    col.dispatchEvent(new Event('change'));
    return {
      on: roomEdit.grainFill,
      bg: roomEdit.grainFillBg,
      colour: roomEdit.grainFillColour,
      rgb: vgHexRgb(roomEdit.grainFillColour),
    };
  });
  expect(out.on, 'the checkbox did not turn the fill on').toBe(true);
  expect(out.bg, 'picking a colour left it still filling with the background').toBe(false);
  expect(out.colour).toBe('#4488cc');
  expect(out.rgb[0]).toBeCloseTo(0x44 / 255, 3);

  await page.reload();
  await page.waitForFunction(() => typeof roomEdit === 'object', { timeout: 20_000 });
  const kept = await page.evaluate(() => [roomEdit.grainFill, roomEdit.grainFillColour]);
  expect(kept, 'the fill was not remembered').toEqual([true, '#4488cc']);
});

/// Every control in this panel can actually be reached by a pointer.
///
/// **The overlay is `pointer-events: none`.** It has to be — the room is posed
/// by dragging it and the panel sits on top of the whole thing — so each
/// control hands the pointer back for itself, and anything added without that
/// line arrives dead on screen while working perfectly from the console. The
/// entire fill row shipped that way: the checkbox could not be checked and the
/// swatch could not be opened.
///
/// So this clicks, rather than dispatching events at elements. Dispatching is
/// the one way of driving a control that cannot tell whether the control can be
/// reached, which is why the test that was supposed to cover the fill did not.
test('the room editor\'s controls can be clicked, not just dispatched at',
  async ({ page }) => {
    await openRoom(page);

    // Playwright refuses to click something a real pointer could not hit, so
    // the assertion is that these do not throw.
    const fill = page.locator('#reGrainFill');
    await fill.click({ timeout: 3000 });
    expect(await page.evaluate(() => roomEdit.grainFill),
      'the fill checkbox took a click and did nothing').toBe(true);

    await page.locator('#reGrainFillBg').click({ timeout: 3000 });
    expect(await page.evaluate(() => roomEdit.grainFillBg),
      'the BG chip took a click and did nothing').toBe(false);

    // The sliders, the layer chips and the occlusion switches too, since they
    // all sit under the same overlay.
    for (const id of ['reRing', 'reRingDrive', 'reRingEdge', 'reGrainDensity',
      'reGrainBright', 'reOpacity', 'reRingPoints', 'reLeadThick', 'reClear',
      'reReset']) {
      await expect(page.locator(`#${id}`), `#${id} is not reachable`).toBeVisible();
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box, `#${id} has no box to click`).not.toBeNull();
      // A real pointer landing on it must find the slider and not the overlay.
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.id || el.className : null;
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      expect(hit, `a pointer over #${id} lands on "${hit}" instead`).toBe(id);
    }

    await page.locator('#reLayers .re-occ[data-occlude="grains"]').click({ timeout: 3000 });
    expect(await page.evaluate(() => roomOcclude().grains),
      'an occlusion switch took a click and did nothing').toBe(true);
  });

/// The ring's border has a thickness, and nothing is a valid thickness.
test('the stroke slider sets how thick the ring\'s border is', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate((src) => {
    const pushSignal = new Function('visGl', src).bind(null, visGl);
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'skin', 'grains', 'data', 'room']) roomEdit.layers[k] = false;
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
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum;
    };
    return { none: shot(0), thin: shot(0.02), thick: shot(0.14) };
  }, PUSH_SIGNAL);
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // Thicker takes more light out, and nothing takes none.
  expect(out.thin, 'a thin border took nothing out').toBeLessThan(out.none);
  expect(out.thick, `${out.none} bare, ${out.thin} thin, ${out.thick} thick — `
    + 'thicker did not take more out').toBeLessThan(out.thin);
});

/// And it is remembered.
test('the stroke width is remembered', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    const el = document.getElementById('reRingEdge');
    el.value = '90';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  });
  await page.reload();
  await page.waitForFunction(() => typeof roomEdit === 'object', { timeout: 20_000 });
  expect(await page.evaluate(() => roomEdit.ringEdge), 'the stroke width was not kept')
    .toBeCloseTo(0.09, 3);
});

/// Emptying the room.
///
/// Everything in here accumulates on purpose — the trail runs fifty-six frames
/// deep and a grain lives fourteen seconds — so after a loud passage there is no
/// way to see the next quiet one for a quarter of a minute unless the room can
/// be emptied.
test('Clear empties the trail and the cloud, and leaves the settings alone',
  async ({ page }) => {
    await openRoom(page);
    const out = await page.evaluate(async (src) => {
      const pushSignal = new Function('visGl', src).bind(null, visGl);
      const gl = document.getElementById('visGl');
      const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
      if (!ctx) return null;
      for (const k of ['room', 'floor', 'lead', 'sky', 'skin', 'grains']) roomEdit.layers[k] = true;
      roomEdit.layers.data = false;

      // Fill it: a trail, and a cloud walked in against the wall clock so the
      // grains are spread down the room rather than stacked at the near face.
      pushSignal();
      const sr = 44100, srcFrames = sr * 10, grains = [];
      for (let i = 0; i < 400; i++) {
        const t = i / 80;
        grains.push([Math.round(t * sr), Math.round((t / 5) * srcFrames),
          Math.round(sr * 0.04), 0, 0.5, 0.5, 0, i]);
      }
      const send = (pos) => visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(), order: roomOrder(), occlude: {},
        grains, grainRate: sr, srcFrames, positionRate: sr, pollMs: 50,
        position: Math.round(sr * pos),
      });
      send(0);
      for (let t = 0.1; t <= 5.0001; t += 0.1) send(t);
      const read = () => {
        const px = new Uint8Array(gl.width * gl.height * 4);
        ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        let lit = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
        }
        return lit;
      };
      send(5);
      const full = { lit: read(), grains: visGl.grainShapeNames().length };

      // The settings, before and after, so "clear" can be told from "reset".
      const before = JSON.stringify([roomOrder(), roomOcclude(), roomEdit.ringDrive,
        roomEdit.grainDensity, roomCamera()]);

      document.getElementById('reClear').click();
      // Nothing is handed in, so nothing comes back but the empty room.
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(), order: roomOrder(), occlude: {},
        pollMs: 50,
      });
      const after = JSON.stringify([roomOrder(), roomOcclude(), roomEdit.ringDrive,
        roomEdit.grainDensity, roomCamera()]);
      const empty = { lit: read(), grains: visGl.grainShapeNames().length };

      // And it fills again, rather than being cleared for good.
      pushSignal();
      send(0);
      for (let t = 0.1; t <= 2.0001; t += 0.1) send(t);
      send(2);
      const again = { lit: read(), grains: visGl.grainShapeNames().length };

      return { full, empty, again, kept: before === after };
    }, PUSH_SIGNAL);
    if (out === null) test.skip(true, 'no readable WebGL context in this harness');

    expect(out.full.grains, 'nothing was in the room to clear').toBeGreaterThan(100);
    expect(out.empty.grains, `${out.empty.grains} grains still in the air after Clear`)
      .toBe(0);
    // The box is a layer of its own and is drawn from the camera rather than
    // from anything that accumulates, so the room is not expected to go black —
    // what has to go is everything that was poured into it.
    expect(out.empty.lit, `${out.full.lit} lit before, ${out.empty.lit} after — the `
      + 'trail is still there').toBeLessThan(out.full.lit * 0.4);
    expect(out.kept, 'Clear moved a setting, which is Reset\'s job and not its own')
      .toBe(true);
    expect(out.again.grains, 'the room would not fill again after being cleared')
      .toBeGreaterThan(50);
  });

/// The thick band at the front comes off; the line it sits on does not.
test('the leading edge can lose its band and keep its line', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate((src) => {
    const pushSignal = new Function('visGl', src).bind(null, visGl);
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['room', 'floor', 'sky', 'skin', 'grains', 'data']) roomEdit.layers[k] = false;
    roomEdit.layers.lead = true;
    pushSignal();
    const shot = (leadThick) => {
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(), order: roomOrder(), occlude: {},
        leadThick, pollMs: 50,
      });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let lit = 0, hot = 0, sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i] + px[i + 1] + px[i + 2];
        sum += v;
        if (v > 12) lit++;
        // The band is drawn at full alpha over a ridge that is already lit, so
        // it is among the brightest things this layer makes — but not the only
        // one, because forty ridges piled up additively are bright too. It is a
        // bite out of this number rather than the whole of it.
        if (v > 400) hot++;
      }
      return { lit, hot, sum };
    };
    return { on: shot(true), off: shot(false) };
  }, PUSH_SIGNAL);
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // The band goes: it is a ribbon at full alpha across the whole width, so it
  // takes a real bite out of both the light and the brightest pixels.
  expect(out.off.sum, `${out.on.sum} of light with the band, ${out.off.sum} `
    + 'without — it is still there').toBeLessThan(out.on.sum * 0.97);
  expect(out.off.hot, `${out.on.hot} bright pixels with the band, ${out.off.hot} `
    + 'without').toBeLessThan(out.on.hot * 0.9);
  // **And the frame is still drawn.** The row loop draws every frame as a ridge
  // including this one, and the band is laid over the top of that — so what must
  // not happen is the front of the room going empty. The band is thin, so
  // almost every pixel it lit was already lit by the ridge under it.
  expect(out.off.lit, `${out.on.lit} lit with the band, ${out.off.lit} without — `
    + 'the line went with it').toBeGreaterThan(out.on.lit * 0.9);
});

/// And it is remembered.
test('the thick edge setting is remembered', async ({ page }) => {
  await openRoom(page);
  await page.locator('#reLeadThick').click({ timeout: 3000 });
  expect(await page.evaluate(() => roomEdit.leadThick),
    'the checkbox took a click and did nothing').toBe(false);
  await page.reload();
  await page.waitForFunction(() => typeof roomEdit === 'object', { timeout: 20_000 });
  expect(await page.evaluate(() => roomEdit.leadThick), 'it was not kept').toBe(false);
});

/// How finely the ring is drawn.
///
/// At the old fixed 256 the ring was not merely faceted — it was undersampling
/// the trace, so the figure it drew was an alias of the one in the sound. The
/// beads along the leading hoop stood visibly apart, which is what gave it away.
test('the ring can be drawn finer, past what the trace actually holds',
  async ({ page }) => {
    await openRoom(page);
    const out = await page.evaluate((src) => {
      const pushSignal = new Function('visGl', src).bind(null, visGl);
      const gl = document.getElementById('visGl');
      const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
      if (!ctx) return null;
      for (const k of ['floor', 'lead', 'skin', 'grains', 'data', 'room']) roomEdit.layers[k] = false;
      roomEdit.layers.sky = true;
      pushSignal();
      const shot = (ringPoints) => {
        // A big ring, or there is nothing to resolve at dock size.
        const cam = { ...vgCamera(roomCamera()), ring: 0.42 };
        visGl.frame({
          cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
          cam, layers: roomLayers(), order: roomOrder(), occlude: {},
          ringPoints, ringEdge: 0, pollMs: 50,
        });
        const px = new Uint8Array(gl.width * gl.height * 4);
        ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        let lit = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
        }
        return lit;
      };
      return {
        coarse: shot(64),
        fine: shot(2048),
        // Past the top of the range, asking for more must give back the same
        // picture rather than a different one. The ceiling is no longer the
        // trace's length — the curve is interpolated between its samples — so
        // it is `VG_RING_POINTS_MAX` that this clamps to.
        over: shot(9999),
        stored: shot(VG_RING_POINTS_MAX),
      };
    }, PUSH_SIGNAL);
    if (out === null) test.skip(true, 'no readable WebGL context in this harness');

    // A finer ring is a continuous curve where a coarse one is a run of beads
    // with gaps between them, so it covers more of its own path.
    // Modest, and reliably so: a coarse ring is still a closed polygon over
    // most of the same path, so what a fine one adds is the corners it cuts and
    // the gaps between its beads rather than a whole new shape.
    expect(out.fine, `${out.coarse} lit at 64 points, ${out.fine} at 2048 — `
      + 'the resolution made no difference').toBeGreaterThan(out.coarse * 1.03);
    // And it is clamped rather than left to index off the end of the trace.
    expect(out.over, 'asking for more points than are stored drew something else')
      .toBe(out.stored);
  });

/// And it is remembered.
test('the ring resolution is remembered', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    const el = document.getElementById('reRingPoints');
    el.value = '896';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  });
  await page.reload();
  await page.waitForFunction(() => typeof roomEdit === 'object', { timeout: 20_000 });
  expect(await page.evaluate(() => roomEdit.ringPoints), 'it was not kept').toBe(896);
});

/// Smoke dripping off the shapes.
///
/// **Measured through the object the app itself builds**, not through a frame
/// hand-written by the test. The first version of this feature was checked by
/// passing `mist` straight to `visGl.frame`, which proved the renderer drew
/// something and proved nothing about whether the interface ever asked it to.
///
/// And it is checked against *lit* pixels rather than faint ones. The first
/// mist was drawn at an alpha of 0.055, which after the shader's depth fade
/// lands near 0.03: measurably present, and on a black room invisible. The
/// measurement said it worked. It was reported as not working at all, and both
/// were true.
test('the mist is visible, and off means off', async ({ page }) => {
  await openRoom(page);
  const out = await page.evaluate(async () => {
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'sky', 'skin', 'data']) roomEdit.layers[k] = false;
    roomEdit.layers.grains = true;
    roomEdit.layers.room = true;

    const sr = 44100, srcFrames = sr * 10, grains = [];
    for (let i = 0; i < 400; i++) {
      const t = i / 60;
      grains.push([Math.round(t * sr), Math.round((t / 7) * srcFrames),
        Math.round(sr * 0.04), (i % 7) - 3, 0.35 + (i % 5) * 0.12, 0.5,
        (i % 11) / 10 - 0.5, i]);
    }
    // The same shape of object `visGlTick` builds, so what is measured is what
    // the interface actually sends.
    const send = (pos) => visGl.frame({
      cold: [0.2, 0.45, 0.85], hot: [1, 0.72, 0.35], core: [0.55, 0.85, 1],
      cam: roomCameraDrawn(), layers: roomLayers(), order: roomOrder(),
      occlude: roomOcclude(),
      grainDensity: roomEdit.grainDensity, grainBright: roomEdit.grainBright,
      grainFill: { on: roomEdit.grainFill, bg: roomEdit.grainFillBg,
        rgb: vgHexRgb(roomEdit.grainFillColour) },
      mist: { on: roomEdit.mist, amount: roomEdit.mistAmount,
        length: roomEdit.mistLength },
      grains, grainRate: sr, srcFrames, positionRate: sr, pollMs: 50,
      position: Math.round(sr * pos),
    });
    const read = () => {
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
      }
      return lit;
    };

    // A grain can only trail from a journey it has already made, so the cloud
    // is walked in against the wall clock rather than poured in.
    roomEdit.mist = false;
    for (let t = 0; t <= 7.0001; t += 0.05) {
      send(t);
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => setTimeout(r, 700));
    send(7); const off = read();

    // Only the switch moves.
    roomEdit.mist = true;
    send(7); const on = read();
    roomEdit.mistAmount = 1;
    roomEdit.mistLength = 0.25;
    send(7); const lots = read();
    return { off, on, lots };
  });
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // Plainly there at the settings it ships with — not "measurably present".
  expect(out.on, `${out.off} lit without mist, ${out.on} with — that is not smoke, `
    + 'that is a rounding error').toBeGreaterThan(out.off * 1.8);
  // And more of it is more of it.
  expect(out.lots, `${out.on} at the default and ${out.lots} at full — the amount `
    + 'and length do nothing').toBeGreaterThan(out.on * 1.4);
});

/// Fog, and the two halves it is made of.
///
/// **Shading a fragment by its distance cannot put anything between things.**
/// In empty space there is no fragment to shade, so a distance function tints
/// what is already there and nothing else — measured on this room, that moved
/// the picture by two per cent. Every engine with convincing fog draws a
/// volume as well, and both references say so in their own way: one is the
/// shader, the other is a field of particles.
test('fog tints by real distance, and the far wall takes more of it',
  async ({ page }) => {
    await openRoom(page);
    const out = await page.evaluate(() => {
      const gl = document.getElementById('visGl');
      const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
      if (!ctx) return null;
      // Only the box, so everything in the picture runs from the near plane to
      // the far one and nothing else is in the way.
      for (const k of ['floor', 'lead', 'sky', 'skin', 'grains', 'data']) {
        roomEdit.layers[k] = false;
      }
      roomEdit.layers.room = true;
      const shot = (fog) => {
        visGl.frame({
          cold: [0.2, 0.45, 0.85], hot: [0.2, 0.45, 0.85], core: [0.2, 0.45, 0.85],
          cam: roomCamera(), layers: roomLayers(), order: roomOrder(), occlude: {},
          fog, pollMs: 50,
        });
        const px = new Uint8Array(gl.width * gl.height * 4);
        ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        // The far wall is the small rectangle in the middle of this projection
        // and the near edges are the outer ones, so the centre and the sides
        // are near and far — which a top-and-bottom split is not, because the
        // vanishing point is in the middle of the frame.
        const W = gl.width, H = gl.height;
        let cRed = 0, cSum = 0, eRed = 0, eSum = 0;
        for (let i = 0; i < px.length; i += 4) {
          const q = (i / 4) | 0, x = q % W, y = (q / W) | 0;
          const v = px[i] + px[i + 1] + px[i + 2];
          if (v <= 12) continue;
          // How much of the fog's colour this pixel took. The fog is red and
          // the room is blue, so nothing else here can produce any.
          const red = Math.max(0, px[i] - px[i + 2] * 0.5);
          if (Math.abs(x - W / 2) < W * 0.18 && Math.abs(y - H / 2) < H * 0.18) {
            cRed += red; cSum += v;
          } else if (x < W * 0.06 || x > W * 0.94) {
            eRed += red; eSum += v;
          }
        }
        return { far: cRed / Math.max(1, cSum), near: eRed / Math.max(1, eSum), lit: cSum + eSum };
      };
      const red = [1.0, 0.15, 0.15];
      return {
        off: shot({ on: false }),
        tint: shot({ on: true, type: 1, rgb: red, density: 0.9,
          near: 1, far: 2.9, height: -0.38, volume: false }),
        whole: shot({ on: true, type: 1, rgb: red, density: 0.9,
          near: 1, far: 2.9, height: -0.38 }),
      };
    });
    if (out === null) test.skip(true, 'no readable WebGL context in this harness');

    // A blue room has no red in it at all.
    expect(out.off.far, 'the room was already the fog colour').toBeLessThan(0.02);

    // The shader half: it lands, and it lands by distance.
    expect(out.tint.far, 'the fog put none of its colour on anything')
      .toBeGreaterThan(0.2);
    // **And the front of the room is nearly clear.**
    //
    // "The fog's intensity is fogMin before or at the start of the fog's near
    // distance." The first version measured distance from the *eye*, and the
    // near plane of this room is a whole unit away — so `exp(-density * 1.0)`
    // put better than a third of the fog's colour on the nearest thing in the
    // picture and the same again on everything behind it. That is not depth,
    // it is a tint on the whole scene, and it was reported as exactly that.
    // Measured from where the fog starts, the front comes out near nothing and
    // the back wall takes several times as much.
    expect(out.tint.near, `the front of the room took ${out.tint.near.toFixed(3)} `
      + 'of the fog — it should be nearly clear there').toBeLessThan(0.3);
    expect(out.tint.far, `the front took ${out.tint.near.toFixed(3)} and the back `
      + `wall ${out.tint.far.toFixed(3)} — that is a tint, not a distance`)
      .toBeGreaterThan(out.tint.near * 2.0);

    // The volume half: there is something in the air, not only on the walls.
    expect(out.whole.lit, `${out.tint.lit} lit with the tint alone and `
      + `${out.whole.lit} with the volume — the air is empty`)
      .toBeGreaterThan(out.tint.lit * 1.2);
  });

