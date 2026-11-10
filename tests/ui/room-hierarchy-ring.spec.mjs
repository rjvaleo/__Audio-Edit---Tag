// The room's look, continued from `room-hierarchy.spec.mjs`: the ring's colour,
// stroke, leading edge and resolution, the mist, and the fog.

import { test, expect } from './test.mjs';
import { PUSH_SIGNAL, openRoom } from './room-hierarchy.helpers.mjs';

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

    // **Every control in the panel, found rather than listed.**
    //
    // This was a list of ids somebody had to remember to extend, and twice
    // somebody did not: the whole fill row shipped unclickable, and later the
    // fog's type selector, because `select` was not among the elements handed
    // the pointer back. Asking the DOM what is in there cannot fall behind.
    const ids = await page.evaluate(() => [...document.querySelectorAll(
      '#roomEdit input, #roomEdit select, #roomEdit button')]
      .map((el) => el.id).filter(Boolean));
    expect(ids.length, 'no controls found in the room editor at all')
      .toBeGreaterThan(10);
    for (const id of ids) {
      const el = page.locator(`#${id}`);
      if (!await el.isVisible()) continue;   // a chip inside a collapsed row
      // The column scrolls, and a knob with its picture above it can sit below
      // the fold: a pointer reaches it as a person does, after scrolling to it.
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      if (!box || box.width < 2 || box.height < 2) continue;
      // A real pointer landing on it must find the slider and not the overlay.
      // What a real pointer aimed at the middle of it would actually hit. The
      // control itself, or something inside it — a `<span>` in a label counts,
      // because the click still reaches the input through it.
      const hit = await page.evaluate(({ x, y, want }) => {
        const at = document.elementFromPoint(x, y);
        if (!at) return null;
        return at.closest(`#${want}`) || at.id === want
          ? want
          : (at.id || at.className || at.tagName);
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2, want: id });
      expect(hit, `a pointer over #${id} lands on "${hit}" instead — that control `
        + 'cannot be used').toBe(id);
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
      for (const k of ['grid', 'floor', 'lead', 'sky', 'skin', 'grains']) roomEdit.layers[k] = true;
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

      // The settings, before and after. Clear is the whole room back to
      // default, so one is moved first and expected to come back.
      roomEdit.ringDrive = 3;
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
    expect(out.kept, 'Clear left the settings where they were; it puts every one back')
      .toBe(false);
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
    for (const k of ['grid', 'floor', 'sky', 'skin', 'grains', 'data']) roomEdit.layers[k] = false;
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
      for (const k of ['floor', 'lead', 'skin', 'grains', 'data', 'grid']) roomEdit.layers[k] = false;
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
    roomEdit.layers.grid = true;

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
    // **Paced by the clock, not by frames.** The trails are history in real
    // time, and a frame is 16 ms on a GPU and anything up to a quarter of a
    // second in a software renderer — so walking frame by frame gave the cloud
    // 2.3 s of journey on one and 35 s on the other, and the amount measured
    // was really the browser's frame rate.
    for (let t = 0; t <= 7.0001; t += 0.05) {
      send(t);
      await new Promise((r) => setTimeout(r, 30));
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
      roomEdit.layers.grid = true;
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
          } else if (y < H * 0.12) {
            // The nearest ground: the bottom rows. (readPixels counts rows
            // from the bottom.) The frame's edge columns were the near walls
            // when there were walls; on open ground they run to the horizon.
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

    // The ground is grey — a little red by this measure, since grey has as
    // much red as anything else — and not the fog's red. What the fog adds is
    // measured over that, not from nought: the box's cold blue lines, which
    // had no red at all, went with the box.
    expect(out.off.far, 'the ground was already the fog colour').toBeLessThan(0.2);
    const addedFar = out.tint.far - out.off.far;
    const addedNear = out.tint.near - out.off.near;

    // The shader half: it lands, and it lands by distance.
    expect(addedFar, 'the fog put none of its colour on anything')
      .toBeGreaterThan(0.15);
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
    expect(addedNear, `the front of the room took ${addedNear.toFixed(3)} `
      + 'of the fog — it should be nearly clear there').toBeLessThan(0.15);
    expect(addedFar, `the front took ${addedNear.toFixed(3)} and the far end `
      + `${addedFar.toFixed(3)} — that is a tint, not a distance`)
      .toBeGreaterThan(Math.max(0.02, addedNear) * 2.0);

    // The volume half: there is something in the air, not only on the walls.
    expect(out.whole.lit, `${out.tint.lit} lit with the tint alone and `
      + `${out.whole.lit} with the volume — the air is empty`)
      .toBeGreaterThan(out.tint.lit * 1.2);
  });
