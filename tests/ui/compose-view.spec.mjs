// Compose, phase one: the view.
//
// Three cells across the top — the compact grain panel, the sequencer, the
// picture — the arrangement under them and the transport at the foot. What is
// worth testing is what is invisible when it is right:
//
//   - the room, the transport, the export buttons and the PERFORMANCE panel
//     are moved in, not copied, so they have to go home exactly;
//   - the sequencer's frame is laid over its cell rather than moved, because
//     moving an iframe reloads it — so it must still be the same page after
//     going in and out;
//   - the cells can be resized, and the frame has to follow its cell.

import { test, expect } from '@playwright/test';

async function openFile(page) {
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
  await page.waitForFunction(() => !!(state.stretchDraft && state.grainDraft), { timeout: 20_000 });
}

async function enterCompose(page) {
  await page.locator('#leftRail [data-mode="compose"]').click();
  await expect.poll(() => page.evaluate(() => state.mode)).toBe('compose');
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  await page.waitForTimeout(300);
}

const MOVED = ['masterBus', 'transportBar', 'exportBtn', 'videoBtn', 'perfPanel'];
const PLACES = `(${(ids) => {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    out[id] = el
      ? { parent: el.parentElement.id || el.parentElement.className,
          index: [...el.parentElement.children].indexOf(el) }
      : null;
  }
  return out;
}})(${JSON.stringify(MOVED)})`;

test('Compose is a workspace on the rail, and the three panels and the timeline are in it', async ({ page }) => {
  await openFile(page);
  const btn = page.locator('#leftRail [data-mode="compose"]');
  await expect(btn).toBeVisible();
  await enterCompose(page);
  await expect(page.locator('#composeView')).toBeVisible();
  await expect(btn).toHaveClass(/active/);
  const got = await page.evaluate(() => {
    const inside = (id, host) => !!document.getElementById(host)?.contains(document.getElementById(id));
    const gl = document.getElementById('visGl');
    return {
      knobs: document.querySelectorAll('#cvGrain .cg .knob').length,
      bar: !!document.querySelector('#cvPicture .cp .cp-bar'),
      room: inside('masterBus', 'cpRoom'),
      transport: inside('transportBar', 'cvFoot'),
      exports: inside('exportBtn', 'cvFoot') && inside('videoBtn', 'cvFoot'),
      timeline: inside('perfPanel', 'cvArrange'),
      canvas: gl ? { w: gl.clientWidth, h: gl.clientHeight } : null,
      body: document.body.classList.contains('composeview'),
      label: $('modeLabel').textContent,
      lane: $('lane').classList.contains('hidden'),
      dock: $('dock').classList.contains('hidden'),
      editor: getComputedStyle($('roomEdit')).display,
      cameraOn: roomEdit.on,
    };
  });
  expect(got.knobs).toBe(8);
  expect(got.bar).toBe(true);
  expect(got.room, 'the room is not in the picture cell').toBe(true);
  expect(got.transport, 'the transport is not at the foot').toBe(true);
  expect(got.exports, 'the export buttons are not at the foot').toBe(true);
  expect(got.timeline, 'the timeline is not in the arrangement').toBe(true);
  expect(got.canvas.w, 'the picture has no width').toBeGreaterThan(50);
  expect(got.canvas.h, 'the picture has no height').toBeGreaterThan(50);
  expect(got.body).toBe(true);
  expect(got.label).toBe('Compose');
  expect(got.lane).toBe(true);
  expect(got.dock).toBe(true);
  expect(got.editor, 'the room editor panel is drawn over the small picture').toBe('none');
  expect(got.cameraOn, 'the camera does not answer the hand in Compose').toBe(true);
});

test('what is moved in goes home exactly, to Edit and to the Visual workspace', async ({ page }) => {
  await openFile(page);
  const home = await page.evaluate(PLACES);
  await enterCompose(page);
  await page.evaluate(() => setMode('edit'));
  expect(await page.evaluate(PLACES), 'Compose to Edit left something out of place').toEqual(home);
  // Through the Visual workspace, which borrows some of the same things.
  await enterCompose(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(200);
  await page.evaluate(() => setMode('compose'));
  await page.waitForTimeout(200);
  await page.evaluate(() => setMode('edit'));
  expect(await page.evaluate(PLACES), 'Compose, Visual, Compose, Edit left something out of place').toEqual(home);
  expect(await page.evaluate(() => roomEdit.on)).toBe(false);
});

test('the sequencer is laid over its cell, compact, and is never reloaded', async ({ page }) => {
  await openFile(page);
  await enterCompose(page);
  const frame = page.frames().find((f) => f.url().includes('/sequencer/'));
  await frame.waitForFunction(() => document.body.classList.contains('compact'), null, { timeout: 5_000 });
  await frame.evaluate(() => { window.__sameDocument = 42; });
  const over = await page.evaluate(() => {
    const a = $('seqView').getBoundingClientRect(), b = $('cvSeq').getBoundingClientRect();
    return {
      docked: $('seqView').classList.contains('seq-docked'),
      dx: Math.abs(a.left - b.left), dy: Math.abs(a.top - b.top),
      dw: Math.abs(a.width - b.width), dh: Math.abs(a.height - b.height), w: b.width,
      parent: $('seqView').parentElement.tagName,
    };
  });
  expect(over.docked).toBe(true);
  expect(over.w).toBeGreaterThan(100);
  for (const k of ['dx', 'dy', 'dw', 'dh']) expect(over[k], `the frame is off its cell (${k})`).toBeLessThan(1.5);
  expect(over.parent, 'the frame was moved out of its place').toBe('MAIN');

  // Out to its own workspace: full layout, filling the view, the same page.
  await page.locator('#leftRail [data-mode="seq"]').click();
  await frame.waitForFunction(() => !document.body.classList.contains('compact'), null, { timeout: 5_000 });
  const seqMode = await page.evaluate(() => ({
    docked: $('seqView').classList.contains('seq-docked'),
    inline: $('seqView').style.left,
    w: $('seqView').getBoundingClientRect().width,
  }));
  expect(seqMode.docked).toBe(false);
  expect(seqMode.inline).toBe('');
  expect(seqMode.w).toBeGreaterThan(over.w);
  expect(await frame.evaluate(() => window.__sameDocument), 'the sequencer reloaded').toBe(42);

  // And back.
  await enterCompose(page);
  await frame.waitForFunction(() => document.body.classList.contains('compact'), null, { timeout: 5_000 });
  expect(await frame.evaluate(() => window.__sameDocument), 'the sequencer reloaded').toBe(42);

  // Leaving Compose for a workspace without the sequencer hides it.
  await page.evaluate(() => setMode('edit'));
  expect(await page.evaluate(() => $('seqView').classList.contains('hidden'))).toBe(true);
});

test('the grips resize the cells, the frame follows its cell, and the sizes are kept', async ({ page }) => {
  await openFile(page);
  await page.evaluate(() => localStorage.removeItem('audiolab.compose.sizes.v1'));
  await enterCompose(page);
  const before = await page.evaluate(() => ({
    grain: $('cvGrain').getBoundingClientRect().width,
    top: $('cvTop').getBoundingClientRect().height,
  }));
  const grip = await page.locator('.cv-vgrip[data-grip="0"]').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  const split = await page.locator('#cvSplit').boundingBox();
  await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
  await page.mouse.down();
  await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2 - 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const a = $('seqView').getBoundingClientRect(), b = $('cvSeq').getBoundingClientRect();
    return {
      grain: $('cvGrain').getBoundingClientRect().width,
      top: $('cvTop').getBoundingClientRect().height,
      off: Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height)),
      saved: JSON.parse(localStorage.getItem('audiolab.compose.sizes.v1') || 'null'),
    };
  });
  expect(after.grain, 'the grip did not widen the grain cell').toBeGreaterThan(before.grain + 40);
  expect(after.top, 'the split did not lower the top row').toBeLessThan(before.top - 30);
  expect(after.off, 'the frame did not follow its cell').toBeLessThan(1.5);
  expect(after.saved, 'the sizes were not kept').not.toBeNull();

  await page.reload();
  await openFile(page);
  await enterCompose(page);
  const kept = await page.evaluate(() => $('cvGrain').getBoundingClientRect().width);
  expect(Math.abs(kept - after.grain), 'the sizes did not survive a reload').toBeLessThan(3);

  await page.locator('.cv-vgrip[data-grip="0"]').dblclick();
  await page.waitForTimeout(150);
  const reset = await page.evaluate(() => $('cvGrain').getBoundingClientRect().width);
  expect(Math.abs(reset - before.grain), 'double-click did not reset the cells').toBeLessThan(3);
});

test('the small picture answers the camera, shows its beads, and the timeline is drawn full width', async ({ page }) => {
  await openFile(page);
  await enterCompose(page);
  const gl = await page.locator('#visGl').boundingBox();
  const before = await page.evaluate(() => camFocus(roomWorldNow()));
  await page.mouse.move(gl.x + gl.width / 2, gl.y + gl.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(150);
  const got = await page.evaluate(() => {
    roomEdit.layers.solid = true;
    paintRoomBeads();
    const out = {
      focus: camFocus(roomWorldNow()),
      beads: !$('roomHandles').querySelector('.room-path').classList.contains('hidden'),
      canvas: $('perfCanvas').getBoundingClientRect().width,
      arrange: $('cvArrange').getBoundingClientRect().width,
    };
    roomEdit.layers.solid = false;
    delete roomEdit.cams[roomEdit.frame];
    saveRoomCameras();
    return out;
  });
  expect(got.focus, 'the wheel did not dolly the small picture').toBeLessThan(before);
  expect(got.beads, 'the beads are hidden in Compose').toBe(true);
  expect(got.canvas, 'the timeline is not drawn across the arrangement').toBeGreaterThan(got.arrange * 0.9);
});
