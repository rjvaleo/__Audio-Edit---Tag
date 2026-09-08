// The open world, step one: the world camera is what is kept, the box is
// what is drawn, and nothing on screen moves.
//
// See `docs/OPEN-WORLD-PLAN.md`. The room still draws its box in this step;
// what changes is where the camera lives. So the assertions are about
// exactness — the box a world camera draws is the box it was made from, a
// room posed on `main` opens here looking the same, and a drag still lands
// where it landed — and about the matrix that step two will draw with.

import { test, expect } from '@playwright/test';

async function openRoom(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
  await page.evaluate(() => setMode('room'));
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
}

const POSED = { depth: 4.4, floorY: -0.9, ceilY: 0.2, shiftX: 0.4, skyAt: 0.5, ring: 0.3 };

test('a box camera becomes a world camera and back, exactly, at any aspect', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate((posed) => {
    const out = [];
    for (const [box, aspect] of [[ROOM_CAM_DEFAULT, 16 / 9], [posed, 9 / 16], [posed, 2.35]]) {
      const w = vgWorldFromBox(box, aspect);
      const back = vgBoxFromWorld(w);
      out.push({ w, box: vgCamera(box), back, world: vgIsWorld(w), boxIsWorld: vgIsWorld(box) });
    }
    return out;
  }, POSED);
  for (const g of got) {
    expect(g.world).toBe(true);
    expect(g.boxIsWorld).toBe(false);
    for (const k of ['depth', 'floorY', 'ceilY', 'shiftX', 'skyAt', 'ring']) {
      expect(g.back[k], `${k} did not survive the round trip`).toBeCloseTo(g.box[k], 9);
    }
  }
  // The default, read as a place to stand.
  expect(got[0].w.height).toBeCloseTo(0.38, 9);
  expect(got[0].w.pitch).toBeCloseTo(6.843, 2);
  expect(got[0].w.yaw).toBe(0);
  expect(got[0].w.reach).toBe(1.9);
  // A slid vanishing point is a yaw, and it depends on the aspect it was posed at.
  expect(got[1].w.yaw).not.toBe(0);
  expect(got[1].w.yaw).not.toBeCloseTo(got[2].w.yaw, 3);
  expect(got[1].w.aspect).toBeCloseTo(9 / 16, 9);
});

test('a room posed on main opens here looking the same, migrated once', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined', { timeout: 20_000 });
  await page.evaluate((posed) => {
    localStorage.removeItem('roomCamerasWorld');
    localStorage.setItem('roomCameras', JSON.stringify({ '16x9': posed, dock: { ...posed, shiftX: -0.2 } }));
  }, POSED);
  await page.reload();
  await page.waitForFunction(() => typeof roomEdit !== 'undefined', { timeout: 20_000 });
  const got = await page.evaluate(() => {
    const kept = JSON.parse(localStorage.getItem('roomCamerasWorld') || 'null');
    const old = JSON.parse(localStorage.getItem('roomCameras') || 'null');
    roomEdit.frame = '16x9';
    const drawn16 = roomCamNow();
    roomEdit.frame = 'dock';
    const drawnDock = roomCamNow();
    const out = { kept, old, drawn16, drawnDock, isWorld: vgIsWorld(roomEdit.cams['16x9']) };
    localStorage.removeItem('roomCamerasWorld');
    localStorage.removeItem('roomCameras');
    roomEdit.cams = {};
    roomEdit.frame = 'dock';
    return out;
  });
  expect(got.isWorld, 'the stored camera is not a world camera').toBe(true);
  expect(got.kept && got.kept['16x9'].height, 'the migrated form was not written').toBeCloseTo(0.9, 9);
  expect(got.old['16x9'].floorY, 'main\'s own key was touched').toBe(-0.9);
  for (const k of ['depth', 'floorY', 'ceilY', 'shiftX', 'skyAt', 'ring']) {
    expect(got.drawn16[k], `16:9 ${k}`).toBeCloseTo(POSED[k], 9);
  }
  expect(got.drawnDock.shiftX).toBeCloseTo(-0.2, 9);
});

test('a drag writes a world camera, and the box it draws is the one the drag made', async ({ page }) => {
  await openRoom(page);
  const r = await page.evaluate(() => {
    const b = document.getElementById('visGl').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const before = await page.evaluate(() => roomCamNow());
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.6);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.85, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const got = await page.evaluate(() => ({
    stored: roomEdit.cams[roomEdit.frame],
    drawn: roomCamNow(),
    world: roomWorldNow(),
    readout: $('reNums').textContent,
    copy: JSON.parse($('reNums').dataset.copy),
    saved: JSON.parse(localStorage.getItem('roomCamerasWorld') || '{}')[roomEdit.frame],
  }));
  expect('height' in got.stored, 'the drag did not write a world camera').toBe(true);
  expect('floorY' in got.stored, 'the drag wrote a box').toBe(false);
  // A drag down the room orbits: the pitch changes, and the eye moves round
  // the pivot to keep looking at it.
  expect(got.world.pitch).not.toBeCloseTo(6.843, 3);
  expect(got.world.height, 'the eye did not rise over the pivot').toBeGreaterThan(-before.floorY);
  expect(got.world.height).toBeCloseTo(-got.drawn.floorY, 9);
  expect(got.readout).toMatch(/^height .* pitch .*° .* yaw .*° .* fov .* focus /);
  expect(got.copy.height).toBeCloseTo(got.world.height, 3);
  expect(got.saved && got.saved.height, 'the world camera was not saved').toBeCloseTo(got.world.height, 9);
});

test('the film and the projection helpers take a camera in either shape', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate((posed) => {
    const gl = $('visGl');
    const w = gl.clientWidth, h = gl.clientHeight;
    const world = vgWorldFromBox(posed, w / h);
    const a = roomProject(0.2, -0.1, 0.5, w, h, posed);
    const b = roomProject(0.2, -0.1, 0.5, w, h, world);
    const wa = roomBackWall(w, h, posed), wb = roomBackWall(w, h, world);
    // Posed as a world camera, handed to the renderer as one — it builds its
    // view from it and derives the box its layers still read.
    roomEdit.cams[roomEdit.frame] = world;
    const drawnA = roomCameraDrawn(undefined);
    delete roomEdit.cams[roomEdit.frame];
    return { a, b, wa, wb, drawnHasFloor: !!drawnA && 'height' in drawnA };
  }, POSED);
  expect(got.b.x).toBeCloseTo(got.a.x, 6);
  expect(got.b.y).toBeCloseTo(got.a.y, 6);
  expect(got.wb.x).toBeCloseTo(got.wa.x, 6);
  expect(got.wb.w).toBeCloseTo(got.wa.w, 6);
  expect(got.drawnHasFloor, 'the renderer was not handed the world camera').toBe(true);
});

test('the world\'s own view looks along its pitch and yaw and narrows with distance', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const proj = (v, p) => {
      const m = v.mvp;
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [x / w, y / w];
    };
    const level = vgWorldView({ height: 1, pitch: 0, yaw: 0, fov: 60 }, 16 / 9, 0.1, 100);
    // Points on the ground straight ahead: below the middle, and rising towards
    // the horizon as they recede, never reaching it.
    const g2 = proj(level, [0, 0, -2]), g20 = proj(level, [0, 0, -20]), g200 = proj(level, [0, 0, -200]);
    // A post to the right, near and far: narrows towards the middle.
    const r2 = proj(level, [1, 1, -2]), r20 = proj(level, [1, 1, -20]);
    // Turned right, the same point ahead moves left in the frame.
    const turned = vgWorldView({ height: 1, pitch: 0, yaw: 20, fov: 60 }, 16 / 9, 0.1, 100);
    const t = proj(turned, [0, 1, -5]);
    // Pitched up, the ground ahead sinks in the frame.
    const up = vgWorldView({ height: 1, pitch: 15, yaw: 0, fov: 60 }, 16 / 9, 0.1, 100);
    const u = proj(up, [0, 0, -5]), flat = proj(level, [0, 0, -5]);
    return { g2, g20, g200, r2, r20, t, u, flat, eye: level.eye, dir: level.dir };
  });
  expect(got.eye).toEqual([0, 1, 0]);
  expect(got.dir[2]).toBeCloseTo(-1, 9);
  expect(got.g2[1]).toBeLessThan(0);
  expect(got.g20[1]).toBeGreaterThan(got.g2[1]);
  expect(got.g200[1]).toBeGreaterThan(got.g20[1]);
  expect(got.g200[1]).toBeLessThan(0);
  expect(Math.abs(got.r20[0])).toBeLessThan(Math.abs(got.r2[0]));
  expect(got.t[0]).toBeLessThan(0);
  expect(got.u[1]).toBeLessThan(got.flat[1]);
});

// ── step two: the ground ──

test('the box is gone and the ground is a layer, a slot and a horizon', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const gl = $('visGl');
    const w = gl.clientWidth, h = gl.clientHeight;
    const c = roomCamNow();
    // The ground straight ahead, at three depths along the reach.
    const y = (t) => roomProject(0, 0, t, w, h, c).y;
    // And on out to the horizon, past the layers' reach, through the same view.
    const v = roomView(w, h);
    const far = (z) => (1 - vgProjectPoint(v.mvp, 0, 0, -z).y) / 2 * h;
    return {
      layers: ROOM_LAYERS.map((l) => l.key),
      order: VG_LAYER_ORDER,
      slot: rpSlots().find((s) => s.key === 'grid')?.own,
      noBoxSlot: !rpSlots().some((s) => s.key === 'box'),
      grips: ROOM_HANDLES.map((g) => g.key),
      near: y(0), mid: y(0.5), end: y(1),
      far20: far(20), far79: far(79), horizonPx: far(v.horizon),
      h,
    };
  });
  expect(got.layers).toContain('grid');
  expect(got.layers).not.toContain('room');
  expect(got.order[0]).toBe('grid');
  expect(got.slot, 'the ground is painted against distance').toBe('distance');
  expect(got.noBoxSlot).toBe(true);
  expect(got.grips).toEqual(['depth']);
  // The ground recedes upward on the canvas and converges: the far end of the
  // reach is above the near line, twenty units out is above that, and from
  // twenty to seventy-nine it moves less than it did from near to twenty.
  expect(got.mid).toBeLessThan(got.near);
  expect(got.end).toBeLessThan(got.mid);
  expect(got.far20).toBeLessThan(got.end);
  expect(got.far79).toBeLessThan(got.far20);
  expect(got.far20 - got.far79).toBeLessThan(got.end - got.far20);
  // And it never crosses the eye line: the horizon stays below the middle
  // when the camera looks slightly up, as the default does.
  expect(got.horizonPx).toBeGreaterThan(got.h * 0.3);
});

test('a turn moves the world, a pitch moves the horizon, and the box\'s frame shapes still draw', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const gl = $('visGl');
    const w = gl.clientWidth, h = gl.clientHeight;
    const base = roomWorldNow();
    const ahead = (cam) => roomProject(0, 0, 0.5, w, h, cam);
    const turned = ahead({ ...base, yaw: base.yaw + 15 });
    const level = ahead(base);
    const up = ahead({ ...base, pitch: base.pitch + 10 });
    // Every frame shape's camera, as the film asks for it, draws through the
    // renderer without complaint.
    const frames = ROOM_FRAMES.map((f) => {
      const cam = roomCameraForAspect(f.ratio || w / h);
      return { key: f.key, ok: cam === null || typeof cam === 'object' };
    });
    return { turned, level, up, frames };
  });
  expect(got.turned.x).toBeLessThan(got.level.x);
  expect(got.up.y).toBeGreaterThan(got.level.y);
  for (const f of got.frames) expect(f.ok, f.key).toBe(true);
});


// ── step four: everything moves ──

test('everything with a place goes anywhere: the ring, the path, the terrain', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    roomEdit.layers.sky = true;
    roomEdit.layers.solid = true;
    const kept = { path: JSON.stringify(roomEdit.solidPath), at: { ...roomEdit.geomAt }, cam: JSON.stringify(roomEdit.cams[roomEdit.frame] || null) };
    const bead = (k) => roomBeads().find((b) => b.key === k);
    // The ring, far off and high up.
    bead('ring').set({ x: 5, y: 3, z: -30 });
    const ring = { ...roomWorldNow().ring };
    // A path point behind the eye and below nothing — no clamp anywhere.
    bead('path:0').set({ x: -8, y: 2.5, z: 4 });
    // The terrain, moved off to one side and further in.
    bead('terrain').set({ x: 3, z: -6 });
    const at = { ...roomEdit.geomAt };
    // Round-tripped through what is kept, still unclamped.
    readRoomData(roomDataSnapshot());
    const back = { path0: { ...roomEdit.solidPath[0] }, at: { ...roomEdit.geomAt } };
    // The film's far end followed the terrain.
    const gl = $('visGl');
    const wall = roomBackWall(gl.clientWidth, gl.clientHeight);
    const beads = roomBeads().map((b) => b.key);
    roomEdit.solidPath = JSON.parse(kept.path);
    roomEdit.geomAt = kept.at;
    if (kept.cam !== 'null') roomEdit.cams[roomEdit.frame] = JSON.parse(kept.cam); else delete roomEdit.cams[roomEdit.frame];
    roomEdit.layers.sky = true;
    roomEdit.layers.solid = false;
    paintRoomBeads();
    return { ring, at, back, wall, beads };
  });
  expect(got.ring).toEqual({ x: 5, y: 3, z: -30, size: got.ring.size });
  expect(got.at).toEqual({ x: 3, z: -6 });
  expect(got.back.path0).toEqual({ x: -8, y: 2.5, z: 4 });
  expect(got.back.at).toEqual({ x: 3, z: -6 });
  expect(got.wall.w).toBeGreaterThan(0);
  expect(got.beads).toContain('ring');
  expect(got.beads).toContain('terrain');
  expect(got.beads.filter((k) => k.startsWith('path:')).length).toBeGreaterThanOrEqual(2);
});

// The gestures every 3D program shares. Orbit and dolly keep the pivot where
// it is; track carries it; look and fly leave the eye's place or its direction
// alone. The sliders are the same moves as numbers.
test('the camera orbits, tracks, dollies, looks and flies, by hand, wheel, key and slider', async ({ page }) => {
  await openRoom(page);
  const gl = page.locator('#visGl');
  const box = await gl.boundingBox();
  const mid = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.6 };
  const read = () => page.evaluate(() => {
    const c = roomWorldNow();
    return { ...c, focus: camFocus(c), pivot: camPivot(c) };
  });
  const close = (a, b, what, digits = 4) => {
    for (let i = 0; i < 3; i++) expect(a[i], `${what}: the pivot moved`).toBeCloseTo(b[i], digits);
  };
  const before = await read();

  // Wheel up: the dolly comes in, and the pivot stays put.
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  const dollied = await read();
  expect(dollied.focus, 'the wheel did not dolly in').toBeLessThan(before.focus);
  close(dollied.pivot, before.pivot, 'dolly');

  // Shift and drag: track. The direction holds, the pivot goes with the hand.
  await page.keyboard.down('Shift');
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 80, mid.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
  const tracked = await read();
  expect(tracked.yaw).toBeCloseTo(dollied.yaw, 6);
  expect(tracked.pitch).toBeCloseTo(dollied.pitch, 6);
  expect(tracked.pivot[0], 'a track to the right did not carry the world right').toBeLessThan(dollied.pivot[0]);

  // Right-drag: look. The eye stays, the direction turns.
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(mid.x + 60, mid.y, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(100);
  const looked = await read();
  expect(looked.x).toBeCloseTo(tracked.x, 6);
  expect(looked.z).toBeCloseTo(tracked.z, 6);
  expect(looked.yaw, 'a right-drag did not look round').toBeGreaterThan(tracked.yaw);

  // W: a step the way you look.
  await page.mouse.move(mid.x, mid.y);
  await page.keyboard.press('w');
  await page.waitForTimeout(100);
  const flown = await read();
  const d = Math.hypot(flown.x - looked.x, flown.height - looked.height, flown.z - looked.z);
  expect(d, 'W did not step').toBeGreaterThan(0.001);
  expect(flown.yaw).toBeCloseTo(looked.yaw, 6);

  // The sliders, and the set views.
  const bySlider = await page.evaluate(() => {
    const set = (id, v) => { const el = $(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const p0 = camPivot(roomWorldNow());
    set('reCamOrbit', 30);
    set('reCamTilt', -12);
    set('reCamDolly', 250);
    set('reCamFov', 40);
    const w = roomWorldNow();
    const out = { yaw: w.yaw, pitch: w.pitch, focus: camFocus(w), fov: w.fov, p0, p1: camPivot(w), readout: $('reNums').textContent };
    $('reCamTop').click();
    const t = roomWorldNow();
    out.top = { pitch: t.pitch, p2: camPivot(t) };
    delete roomEdit.cams[roomEdit.frame];
    paintRoomNums();
    return out;
  });
  expect(bySlider.yaw).toBeCloseTo(30, 6);
  expect(bySlider.pitch).toBeCloseTo(-12, 6);
  expect(bySlider.focus).toBeCloseTo(2.5, 6);
  expect(bySlider.fov).toBe(40);
  close(bySlider.p1, bySlider.p0, 'sliders');
  expect(bySlider.readout).toMatch(/focus 2\.500/);
  expect(bySlider.top.pitch, 'Top did not look down').toBeCloseTo(-89, 6);
  close(bySlider.top.p2, bySlider.p0, 'top view');
});

// A picked point gets a gizmo: one arrow per axis. Pulling an arrow moves
// the point along that axis and nothing else; the bead itself moves freely,
// under the hand. Delete takes a picked waypoint out; Escape lets go.
test('a picked point is moved along one axis by its arrow, and removed by Delete', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
  const got = await page.evaluate(async () => {
    roomEdit.layers.solid = true;
    roomEdit.solidPath = [{ x: 0, y: 0.42, z: -1.2 }, { x: 0.2, y: 0.5, z: -2 }, { x: 0, y: 0.42, z: -2.8 }];
    paintRoomBeads();
    const r = $('visGl').getBoundingClientRect();
    const svg = $('roomHandles').querySelector('.room-path');
    const dot = svg.querySelector('.rp-pt[data-key="path:1"]');
    const ev = (el, type, x, y, buttons) => el.dispatchEvent(new PointerEvent(type, {
      clientX: r.left + x, clientY: r.top + y, pointerId: 1, button: 0, buttons, bubbles: true,
    }));
    const at = (el) => [+el.getAttribute('cx'), +el.getAttribute('cy')];
    // Pick it: a press and release with no travel.
    let [cx, cy] = at(dot);
    ev(dot, 'pointerdown', cx, cy, 1); ev(dot, 'pointerup', cx, cy, 0);
    const picked = roomEdit.pick;
    const giz = svg.querySelector('g[data-key="path:1"] .rp-giz');
    const shown = giz && !giz.classList.contains('hidden');
    const tips = [...giz.querySelectorAll('.rp-tip')].filter((t) => !t.classList.contains('hidden')).map((t) => t.dataset.axis);
    // Pull the green arrow: only y changes.
    const before = { ...roomEdit.solidPath[1] };
    const ty = giz.querySelector('.rp-tip-y');
    let [tx, tyy] = at(ty);
    ev(ty, 'pointerdown', tx, tyy, 1);
    ev(ty, 'pointermove', tx, tyy - 40, 1);
    ev(ty, 'pointerup', tx, tyy - 40, 0);
    const afterY = { ...roomEdit.solidPath[1] };
    // Pull the red arrow: only x changes.
    const txp = giz.querySelector('.rp-tip-x');
    [tx, tyy] = at(txp);
    ev(txp, 'pointerdown', tx, tyy, 1);
    ev(txp, 'pointermove', tx + 40, tyy, 1);
    ev(txp, 'pointerup', tx + 40, tyy, 0);
    const afterX = { ...roomEdit.solidPath[1] };
    // Delete takes it out.
    roomEdit.hover = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    const points = roomEdit.solidPath.length;
    const pickAfter = roomEdit.pick;
    roomEdit.layers.solid = false;
    return { picked, shown, tips, before, afterY, afterX, points, pickAfter };
  });
  expect(got.picked).toBe('path:1');
  expect(got.shown, 'no gizmo on the picked point').toBe(true);
  expect(got.tips.sort()).toEqual(['x', 'y', 'z']);
  expect(got.afterY.y, 'the green arrow did not lift the point').toBeGreaterThan(got.before.y);
  expect(got.afterY.x).toBeCloseTo(got.before.x, 9);
  expect(got.afterY.z).toBeCloseTo(got.before.z, 9);
  expect(got.afterX.x, 'the red arrow did not move the point across').toBeGreaterThan(got.afterY.x);
  expect(got.afterX.y).toBeCloseTo(got.afterY.y, 9);
  expect(got.afterX.z).toBeCloseTo(got.afterY.z, 9);
  expect(got.points, 'Delete did not remove the picked waypoint').toBe(2);
  expect(got.pickAfter).toBeNull();
});

test('a camera and a path from before the world could move are brought up to date', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined', { timeout: 20_000 });
  await page.evaluate(() => {
    localStorage.setItem('roomCamerasWorld', JSON.stringify({
      dock: { height: 0.5, pitch: 3, yaw: 10, fov: 50, reach: 2.5, aspect: 1.5, ring: { x: 0, y: 0.6, z: 0.2, size: 0.2 } },
    }));
    const data = JSON.parse(localStorage.getItem('roomData') || '{}');
    delete data.solidPathUnits;
    data.solidPath = [{ x: 0.5, y: 0.5, z: 0 }, { x: -0.5, y: 0.5, z: 1 }];
    delete data.geomReach;
    localStorage.setItem('roomData', JSON.stringify(data));
  });
  await page.reload();
  await page.waitForFunction(() => typeof roomEdit !== 'undefined', { timeout: 20_000 });
  const got = await page.evaluate(() => {
    const out = {
      cam: roomEdit.cams.dock, reach: roomEdit.geomReach, path: roomEdit.solidPath.map((p) => ({ ...p })),
    };
    delete roomEdit.cams.dock;
    localStorage.removeItem('roomCamerasWorld');
    return out;
  });
  expect(got.cam.v).toBe(2);
  expect(got.cam.x).toBe(0);
  expect(got.cam.z).toBe(0);
  expect(got.cam.ring.z, 'the ring\'s depth was not made absolute').toBeCloseTo(-1.2, 9);
  expect(got.reach, 'the reach did not move to the terrain').toBe(2.5);
  // Half of the half-width across — the box's x ran -1 to 1 over the floor —
  // half a height up, from the front edge to the far end.
  expect(got.path[0].x).toBeCloseTo(0.5 * 1.78 / 2, 6);
  expect(got.path[0].y).toBeCloseTo(0.5, 6);
  expect(got.path[0].z).toBeCloseTo(-1, 6);
  expect(got.path[1].z).toBeCloseTo(-1 - 2.5, 6);
});
