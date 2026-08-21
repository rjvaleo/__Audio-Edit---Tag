// The room's own shape, as against the camera's pose.
//
// **Nothing in here is a camera field, on purpose.** Where you stand in the
// room is dragged on the room itself, and `docs/ROOM-EDITOR.md` argues that at
// length: `floorY = -0.38` against `ceilY = 0.62` is not a number anybody can
// picture, and a field with it in puts a spreadsheet between you and the box.
//
// What these cover is the geometry that had no control of any kind — five
// constants in `vis-gl.js` that decided what the room *is* rather than where
// you look at it from.

import { test, expect } from '@playwright/test';

async function openRoom(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof setMode === 'function' && typeof roomGeom === 'function',
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    localStorage.removeItem('roomData');
    Object.assign(roomEdit, {
      geomBands: 280, geomHistory: 56, geomRidge: 0.62, geomSpan: 14, geomBody: 0.032,
    });
    setMode('room');
  });
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
}

/// Fill the trail past its limit and read what the renderer actually holds.
///
/// **Read, not measured off the picture.** The terrain is a filled surface that
/// always spans the room whatever its depth — six rows is a coarser mesh over
/// the same ground, not a shorter one — so no count of lit pixels can tell a
/// deep trail from a shallow one. Three attempts at measuring it that way all
/// reported the control doing nothing, and all three were measuring something
/// the control does not change.
const FILL = `((n) => {
  for (let p = 0; p < n; p++) {
    const b = new Float32Array(128);
    for (let i = 0; i < 128; i++) b[i] = -30 + Math.abs(Math.sin(i * 0.3 + p * 0.4)) * 22;
    visGl.push(b, new Float32Array(2048));
  }
})`;

test('the trail runs as deep as it is told to', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(`(() => {
    const out = {};
    for (const h of [56, 24, 8, 3]) {
      roomEdit.geomHistory = h;
      // Applied on a frame, and the push trims to it — so the room has to be
      // drawn once before the trail is filled, or the fill uses the old depth.
      visGlTick();
      visGl.clear();
      ${FILL}(80);
      visGlTick();
      out[h] = visGl.trail().rows;
    }
    return out;
  })()`);
  expect(got).toEqual({ 56: 56, 24: 24, 8: 8, 3: 3 });
});

test('changing the floor width throws the trail away', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(`(() => {
    visGlTick(); visGl.clear(); ${FILL}(80); visGlTick();
    const before = visGl.trail();
    // **Every stored row is an array of the old width.** A surface built from a
    // mix of the two would be read off the end of the short ones, so the
    // terrain starts again rather than being resampled.
    roomEdit.geomBands = 64;
    visGlTick();
    const straightAfter = visGl.trail();
    ${FILL}(80); visGlTick();
    const refilled = visGl.trail();
    return { before, straightAfter, refilled };
  })()`);
  expect(got.before.bands).toBe(280);
  expect(got.before.rows).toBeGreaterThan(40);
  expect(got.straightAfter.bands).toBe(64);
  expect(got.straightAfter.rows, 'the old rows survived a width change').toBe(0);
  expect(got.refilled.rows).toBeGreaterThan(40);
});

test('the terrain stands as tall as it is told to', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(`(async () => {
    const el = document.getElementById('visGl');
    roomEdit.frame = 'dock'; applyRoomFrame();
    roomEdit.layers = { room: false, floor: true, lead: false, sky: false,
      skin: false, grains: false, data: false };
    // How far up the frame anything is lit. This one *is* visible in the
    // picture: a taller ridge reaches higher, and the surface's top edge moves
    // with it.
    const top = () => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 150;
      const g = c.getContext('2d');
      g.drawImage(el, 0, 0, 200, 150);
      const d = g.getImageData(0, 0, 200, 150).data;
      for (let y = 0; y < 150; y++) {
        for (let x = 0; x < 200; x++) {
          const i = (y * 200 + x) * 4;
          if (d[i] + d[i+1] + d[i+2] > 24) return y;
        }
      }
      return 150;
    };
    const at = (r) => {
      roomEdit.geomRidge = r;
      visGlTick(); visGl.clear(); ${FILL}(60); visGlTick(); visGlTick();
      return { ridge: visGl.trail().ridge, top: top() };
    };
    return { low: at(0.15), mid: at(0.62), high: at(1.2) };
  })()`);
  expect(got.low.ridge).toBeCloseTo(0.15, 3);
  expect(got.high.ridge).toBeCloseTo(1.2, 3);
  // Taller means it reaches further up the frame, which is a smaller y.
  expect(got.high.top).toBeLessThan(got.mid.top);
  expect(got.mid.top).toBeLessThan(got.low.top);
});

test('the depth axis and the grain size are settable', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    roomEdit.geomSpan = 40;
    roomEdit.geomBody = 0.12;
    visGlTick();
    const wide = visGl.trail();
    roomEdit.geomSpan = 2;
    roomEdit.geomBody = 0.004;
    visGlTick();
    const tight = visGl.trail();
    return { wide, tight };
  });
  expect(got.wide.span).toBe(40);
  expect(got.wide.body).toBeCloseTo(0.12, 4);
  expect(got.tight.span).toBe(2);
  expect(got.tight.body).toBeCloseTo(0.004, 4);
});

test('the shape is remembered, and the panel drives it', async ({ page }) => {
  await openRoom(page);
  await page.click('#roomAdmin .rv-tab[data-rvtab="geom"]');

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#roomGeomBody .rp-row')]
      .map((r) => r.querySelector('.re-tag')?.textContent).filter(Boolean));
  expect(rows).toEqual(['FLOOR', 'TRAIL', 'RIDGE', 'SPAN', 'GRAIN']);

  // Driven through the control, not by writing the state — a slider that is
  // present and wired to nothing would pass every assertion above.
  const moved = await page.evaluate(() => {
    const sl = [...document.querySelectorAll('#roomGeomBody .rp-row')]
      .find((r) => r.querySelector('.re-tag').textContent === 'TRAIL')
      .querySelector('input[type="range"]');
    sl.value = '20';
    sl.dispatchEvent(new Event('input', { bubbles: true }));
    return { state: roomEdit.geomHistory, sent: roomGeom().history };
  });
  expect(moved.state).toBe(20);
  expect(moved.sent).toBe(20);

  await page.reload();
  await page.waitForFunction(() => typeof roomGeom === 'function');
  expect(await page.evaluate(() => roomEdit.geomHistory)).toBe(20);
});

test('the film is drawn with the same shape as the room', async ({ page }) => {
  await openRoom(page);
  // One accessor for both callers. The live room and the film reading their
  // geometry from two places is the fault this program shipped over the
  // background colour, and there was no reason to leave a second one.
  const same = await page.evaluate(() => {
    roomEdit.geomBands = 96;
    roomEdit.geomHistory = 30;
    roomEdit.geomRidge = 0.4;
    const g = roomGeom();
    return { g, bandsMatch: g.bands === roomEdit.geomBands,
      historyMatch: g.history === roomEdit.geomHistory,
      ridgeMatch: g.ridge === roomEdit.geomRidge };
  });
  expect(same.bandsMatch && same.historyMatch && same.ridgeMatch).toBe(true);
});
