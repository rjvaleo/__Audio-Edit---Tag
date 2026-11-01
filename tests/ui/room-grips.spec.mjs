// Taking hold of the room: nothing may keep the pointer, and everything says
// what it is under the hand.
//
// "Sometimes the mouse gets stuck" — the room following the pointer with
// nothing pressed. That is a drag that was started and never ended, which
// happens whenever the release goes somewhere the element that started the
// drag cannot hear: a context menu opened by a secondary press is the common
// one. Every drag in the room now refuses a secondary press and ends itself
// on the first move with no button down.

import { test, expect } from './test.mjs';

async function openRoom(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
  await page.evaluate(() => setMode('room'));
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
}

const cam = () => roomCamNow();

// The right button is a gesture now — look round — so the menu it would
// open is suppressed while the editor is on. That is also what used to lose
// the release: the menu took it, and the room followed the pointer with
// nothing pressed. The guard against that stays, and is checked here.
test('a right press looks round, opens no menu, and lets go when the button is up', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const gl = $('visGl');
    const r = gl.getBoundingClientRect();
    const before = roomWorldNow();
    const at = (type, x, y, extra) => new PointerEvent(type, {
      clientX: r.left + r.width * x, clientY: r.top + r.height * y, pointerId: 1,
      bubbles: true, ...extra,
    });
    gl.dispatchEvent(at('pointerdown', 0.5, 0.6, { button: 2, buttons: 2 }));
    const mode = roomEdit.drag?.mode;
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    gl.dispatchEvent(menu);
    gl.dispatchEvent(at('pointermove', 0.6, 0.6, { buttons: 2 }));
    const looked = roomWorldNow();
    // The pointer moves on with nothing pressed: the drag ends, nothing moves.
    gl.dispatchEvent(at('pointermove', 0.5, 0.9, { buttons: 0 }));
    const after = roomWorldNow();
    return {
      mode, menu: menu.defaultPrevented,
      turned: looked.yaw !== before.yaw, stood: looked.x === before.x && looked.z === before.z,
      ended: !roomEdit.drag, moved: after.pitch !== looked.pitch || after.yaw !== looked.yaw,
    };
  });
  expect(got.mode, 'a right press is a look').toBe('look');
  expect(got.menu, 'the menu opened on a right press').toBe(true);
  expect(got.turned, 'the look did not turn').toBe(true);
  expect(got.stood, 'a look moved the eye').toBe(true);
  expect(got.ended, 'the drag outlived the button').toBe(true);
  expect(got.moved, 'the room followed a pointer with nothing pressed').toBe(false);
});

test('a drag that lost its release ends on the next move with no button down', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const gl = $('visGl');
    const r = gl.getBoundingClientRect();
    const ev = (type, y, buttons) => new PointerEvent(type, {
      clientX: r.left + r.width * 0.5, clientY: r.top + r.height * y, pointerId: 1,
      button: 0, buttons, bubbles: true,
    });
    gl.dispatchEvent(ev('pointerdown', 0.6, 1));
    const started = !!roomEdit.drag;
    gl.dispatchEvent(ev('pointermove', 0.7, 1));
    const during = roomWorldNow().pitch;
    // No pointerup ever comes. The next move has no button down.
    gl.dispatchEvent(ev('pointermove', 0.9, 0));
    const ended = !roomEdit.drag;
    const after = roomWorldNow().pitch;
    return { started, ended, during, after };
  });
  expect(got.started).toBe(true);
  expect(got.ended, 'the drag did not end when the button was found up').toBe(true);
  expect(got.after, 'the room moved on a move with nothing pressed').toBe(got.during);
});

test('the whole picture is the camera, and the word under the hand says so', async ({ page }) => {
  await openRoom(page);
  const gl = page.locator('#visGl');
  const box = await gl.boundingBox();
  for (const fy of [0.1, 0.7]) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * fy);
    await page.waitForTimeout(100);
    const got = await page.evaluate(() => ({
      zone: $('roomHandles').dataset.zone,
      tip: $('roomHandles').querySelector('.rh-zone-tip')?.textContent,
      band: getComputedStyle($('roomHandles').querySelector('.rh-zone')).opacity,
      cursor: $('visGl').style.cursor,
    }));
    expect(got.zone).toBe('camera');
    expect(got.tip).toMatch(/^ORBIT/);
    expect(got.band, 'there is no sky zone to band').toBe('0');
    expect(got.cursor).toBe('grab');
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => $('roomHandles').dataset.zone)).toBe('');
});

test('a grip lights under the hand and says what it does', async ({ page }) => {
  await openRoom(page);
  const grip = page.locator('#roomHandles .rh-depth').first();
  await expect(grip).toBeVisible();
  const before = await grip.evaluate((el) => getComputedStyle(el).opacity);
  await grip.hover();
  await page.waitForTimeout(200);
  const got = await grip.evaluate((el) => ({
    opacity: getComputedStyle(el).opacity,
    glow: getComputedStyle(el).boxShadow,
    tip: getComputedStyle(el.nextElementSibling).opacity,
    zone: $('roomHandles').dataset.zone,
  }));
  expect(+before).toBeLessThan(1);
  expect(got.opacity).toBe('1');
  expect(got.glow, 'no glow under the hand').not.toBe('none');
  expect(got.tip, 'the grip did not say what it does').toBe('1');
});

test('a bead drag that lost its release ends too', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    roomEdit.layers.solid = true;
    paintSolidPath();
    const dot = $('roomHandles').querySelector('.rp-pt[data-key^="path:"]:not(.rp-foot)');
    if (!dot) return { dot: false };
    const r = $('visGl').getBoundingClientRect();
    const cx = +dot.getAttribute('cx'), cy = +dot.getAttribute('cy');
    const ev = (type, dy, buttons) => new PointerEvent(type, {
      clientX: r.left + cx, clientY: r.top + cy + dy, pointerId: 1, button: 0, buttons, bubbles: true,
    });
    const idx = +dot.dataset.key.split(':')[1];
    const start = { ...roomEdit.solidPath[idx] };
    dot.dispatchEvent(ev('pointerdown', 0, 1));
    dot.dispatchEvent(ev('pointermove', 20, 1));
    const during = roomEdit.solidPath[idx].y;
    dot.dispatchEvent(ev('pointermove', 60, 0));
    const dragging = dot.classList.contains('dragging');
    const after = roomEdit.solidPath[idx].y;
    roomEdit.layers.solid = false;
    return { dot: true, start: start.y, during, after, dragging };
  });
  expect(got.dot, 'no bead to drag').toBe(true);
  expect(got.during, 'the bead did not move on a real drag').not.toBe(got.start);
  expect(got.dragging, 'the bead is still dragging with nothing pressed').toBe(false);
  expect(got.after, 'the bead moved with nothing pressed').toBe(got.during);
});
