// The room as a workspace of its own: the third mode, beside Browse and Edit.
//
// What is worth testing here is not that the view appears — that is obvious the
// moment it is looked at. It is the two things that are invisible when they are
// right and silent when they are wrong:
//
//   - the view **borrows** the room, its controls and the transport from the
//     dock rather than copying them, so the parts have to go home exactly, and
//   - the panel is a real panel now rather than an overlay with
//     `pointer-events: none`, so every control in it has to be reachable by an
//     actual pointer.
//
// Both have a history in this program. `docs/ROOM-EDITOR.md` records two
// separate occasions when a control shipped that worked perfectly from the
// console and could not be clicked, and the test that was supposed to cover it
// dispatched events straight at the elements — which is the one way of driving
// a control that cannot tell whether the control can be reached.

import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && typeof setMode === 'function',
    { timeout: 20_000 },
  );
}

const BORROWED = ['masterBus', 'roomEdit', 'reFrameRow', 'transportBar', 'videoBtn'];

/// Where each borrowed element lives, and where it sits among its siblings.
///
/// The parent on its own would pass while the page was quietly wrong: an
/// element appended back to its old parent has still *moved*, because it lands
/// at the end. The transport returning after the dock instead of before it is a
/// different page that this check would call identical.
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
}})(${JSON.stringify(BORROWED)})`;

test('the room is a mode of its own, reachable from the rail', async ({ page }) => {
  await openApp(page);
  const btn = page.locator('#leftRail [data-mode="room"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect.poll(() => page.evaluate(() => state.mode)).toBe('room');
  await expect(page.locator('#roomView')).toBeVisible();
  await expect(btn).toHaveClass(/active/);
});

test('the room, its controls and the transport are moved in, not copied', async ({ page }) => {
  await openApp(page);

  // One of each, and only one. A second canvas or a second control panel is the
  // fault this view was built to avoid — two of a thing is two things to keep
  // in step, and this program has already shipped that twice.
  const counts = await page.evaluate(() => ({
    canvases: document.querySelectorAll('#visGl').length,
    panels: document.querySelectorAll('#roomEdit').length,
    buses: document.querySelectorAll('#masterBus').length,
  }));
  expect(counts).toEqual({ canvases: 1, panels: 1, buses: 1 });

  await page.evaluate(() => setMode('room'));
  const inView = await page.evaluate(() => ({
    bus: document.getElementById('masterBus').parentElement.id,
    panel: document.getElementById('roomEdit').parentElement.id,
    frame: document.getElementById('reFrameRow').parentElement.id,
    transport: document.getElementById('transportBar').parentElement.id,
  }));
  expect(inView).toEqual({
    bus: 'roomStageRoom',
    panel: 'roomAdminBody',
    frame: 'roomStageBar',
    transport: 'roomFoot',
  });
  // Still one of each after the move.
  expect(await page.evaluate(() => document.querySelectorAll('#visGl').length)).toBe(1);
});

test('every borrowed part goes home, to the same place among its siblings', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => setMode('overview'));
  const home = await page.evaluate(PLACES);

  // Round trips, including one that leaves by a different door than it came in.
  for (const seq of [['room', 'overview'], ['room', 'edit'], ['room', 'edit', 'room', 'overview']]) {
    await page.evaluate((s) => { for (const m of s) setMode(m); }, seq);
    const now = await page.evaluate(PLACES);
    expect(now, `after ${seq.join(' > ')}`).toEqual(home);
  }
});

test('the library tray and the tag rail are gone', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => setMode('room'));

  const vis = `(${(sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'absent';
    if (getComputedStyle(el).display === 'none') return 'none';
    const b = el.getBoundingClientRect();
    // On screen at all — the tray is moved off by a transform rather than
    // hidden, so a `display` check alone would miss it sitting over the room.
    return b.right > 0 && b.left < innerWidth && b.width > 0 ? 'showing' : 'off-screen';
  }})`;

  // The tag side is hidden outright and is true immediately.
  expect(await page.evaluate(`${vis}('#rightRail')`)).not.toBe('showing');
  expect(await page.evaluate(`${vis}('.panel.right')`)).not.toBe('showing');

  // The tray *slides*. It is a docked column in Browse and an overlay drawer
  // here, and the move between them is a .18s transform — so what is asserted
  // is where it comes to rest, not where it is the instant the mode changes.
  // Reading it too early is reading the animation's first frame, which is the
  // panel still fully on screen and perfectly correct.
  await expect
    .poll(() => page.evaluate(`${vis}('#leftPanel')`), { timeout: 5_000 })
    .not.toBe('showing');
});

test('the controls can be clicked, not just dispatched at', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForSelector('#roomAdminBody #roomEdit', { state: 'visible' });

  // The panel is asked what is in it rather than working from a written list of
  // ids. A list somebody has to remember to extend has already failed twice in
  // this panel — the whole fill row, and then the fog selector, both of which
  // shipped unclickable behind a green test.
  const unreachable = await page.evaluate(() => {
    const body = document.getElementById('roomAdminBody');
    const bad = [];
    let checked = 0;
    const ctrls = document.getElementById('roomEdit')
      .querySelectorAll('input, select, button, .re-layer, .re-frame, .re-chunk');
    for (const el of ctrls) {
      // Scroll it under the pointer first: the panel is a scrolling column, and
      // "below the fold" is not the same fault as "covered".
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) { bad.push({ el: el.id || el.className, why: 'zero size' }); continue; }
      checked++;
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      if (!hit) { bad.push({ el: el.id || el.className, why: 'off screen' }); continue; }
      if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
        bad.push({ el: el.id || el.className, why: `covered by ${hit.id || hit.className || hit.tagName}` });
      }
      // **Inside the panel's box, not merely inside its DOM.** A control can be
      // a descendant of the panel and still be drawn outside it — that is
      // exactly how `Clear` and `Reset` once ended up over the dock, where a
      // pointer aimed at them hit the dock instead. `contains()` calls that
      // arrangement perfectly fine, which is why it is not what is asked.
      const p = body.getBoundingClientRect();
      if (b.right > p.right + 1 || b.left < p.left - 1) {
        bad.push({ el: el.id || el.className, why: 'drawn outside the panel' });
      }
    }
    return { checked, bad };
  });
  expect(unreachable.bad).toEqual([]);
  // A run that found nothing because it looked at nothing is not a pass.
  expect(unreachable.checked).toBeGreaterThan(20);
});

test('each frame shows the shape it will be exported at', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForSelector('#roomStageRoom #masterBus', { state: 'visible' });

  const got = await page.evaluate(() => {
    const stage = document.getElementById('roomStageRoom').getBoundingClientRect();
    const want = { '16x9': 16 / 9, '1x1': 1, '4x5': 4 / 5, '9x16': 9 / 16 };
    const out = [];
    for (const [key, ratio] of Object.entries(want)) {
      roomEdit.frame = key;
      applyRoomFrame();
      const b = document.querySelector('#masterBus .mb-cell-3d').getBoundingClientRect();
      out.push({
        key,
        ratio: b.height ? b.width / b.height : 0,
        want: ratio,
        // Inside the stage in both directions, or it is not a preview of
        // anything — it is a box with its edges off the screen.
        fits: b.width <= stage.width + 1 && b.height <= stage.height + 1,
        centred: Math.abs((b.left - stage.left) - (stage.right - b.right)) < 2,
      });
    }
    return out;
  });

  for (const f of got) {
    expect(f.ratio, `${f.key} is drawn at its own ratio`).toBeCloseTo(f.want, 2);
    expect(f.fits, `${f.key} fits inside the stage`).toBe(true);
    expect(f.centred, `${f.key} is centred`).toBe(true);
  }
});

test('the divider resizes the controls and the size is remembered', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => setMode('room'));

  const width = () => page.evaluate(
    () => Math.round(document.getElementById('roomAdmin').getBoundingClientRect().width));
  const before = await width();

  const grip = page.locator('#roomGrip');
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = await width();
  expect(after).toBeGreaterThan(before + 60);

  // And it survives a reload, like every other panel size in this program.
  await page.reload();
  await page.waitForFunction(() => typeof setMode === 'function');
  await page.evaluate(() => setMode('room'));
  expect(await width()).toBe(after);
});

// ── the sound the room is drawing ──
//
// This workspace hides the dock, and every stretch and grain control lives in
// it. So they were not broken, they were *not on screen* — and a room you
// cannot change the sound of is a room you cannot design. An export made from
// here then rendered whatever the document had last been given in the editor,
// which read as the export ignoring them too.

test('the stretch and grain controls are reachable in the room', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('room');
  });
  await page.waitForSelector('#roomAdmin .rv-tab[data-rvtab="sound"]');
  await page.click('#roomAdmin .rv-tab[data-rvtab="sound"]');

  const got = await page.evaluate(() => {
    const body = document.getElementById('roomSoundBody');
    const ctrls = body.querySelectorAll('input, select, button');
    let reachable = 0;
    const bad = [];
    for (const el of ctrls) {
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) reachable++;
      else bad.push({ el: el.id || el.className, over: hit ? (hit.id || hit.className) : 'nothing' });
    }
    return {
      moved: document.getElementById('grainControls')?.parentElement?.id,
      hasStretch: !!body.querySelector('#stretchParams'),
      hasGrain: !!body.querySelector('#grainShape'),
      total: ctrls.length, reachable, bad: bad.slice(0, 5),
    };
  });

  expect(got.moved, 'the controls were not borrowed into the room').toBe('roomSoundBody');
  expect(got.hasStretch).toBe(true);
  expect(got.hasGrain).toBe(true);
  expect(got.total).toBeGreaterThan(20);
  // Present is not the same as usable. This is the check that would have caught
  // it: they were in the DOM the whole time, inside a hidden dock.
  expect(got.bad).toEqual([]);
  expect(got.reachable).toBe(got.total);
});

test('a grain control in the room reaches the document', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('room');
  });
  await page.click('#roomAdmin .rv-tab[data-rvtab="sound"]');

  const got = await page.evaluate(async () => {
    const p = state.selectedFile.path;
    const slider = [...document.querySelectorAll('#roomSoundBody input[type="range"]')]
      .find((s) => (s.closest('div')?.textContent || '').includes('Layers'));
    if (!slider) return { err: 'no Layers slider in the room' };
    slider.value = '12';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 900));
    const doc = await api(`/api/edit?p=${encodeURIComponent(p)}`);
    const layers = (doc?.stretch?.grain || {}).layers;
    // Put it back: the library is the user's, not the test's.
    slider.value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return { max: slider.max, layers };
  });

  expect(got.err).toBeUndefined();
  // **What the export renders is the document.** So a control that reaches the
  // document is a control the film obeys, which is the other half of the report.
  expect(got.layers, 'the control did not reach the document').toBe(12);
  // And the ceiling is the raised one, not the sixteen it was.
  expect(Number(got.max)).toBeGreaterThan(16);
});

// ── the room plays the document, not the bare file ──
//
// `playFile` decided this with `state.mode !== 'edit'`. Adding a third mode
// quietly turned that into "the room plays raw" — and raw means no edits, no
// stretch, no grain cloud and no rack, which is the granular engine not running
// when you press play in the room.
//
// The button is the same element in both modes; it is the *mode* that changed
// what pressing it meant.

test('pressing play in the room plays the document', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    const p = state.selectedFile.path;
    // A document with something to lose: a granular stretch is exactly what
    // raw playback drops on the floor.
    await postJSON('/api/edit', { p, op: 'stretch', ratio: 12, algorithm: 'granular', quality: 'standard' });
  });

  const got = await page.evaluate(async () => {
    const out = {};
    for (const mode of ['edit', 'room', 'overview']) {
      setMode(mode);
      await new Promise((r) => setTimeout(r, 200));
      // What `playFile` would decide, without having to start the engine.
      out[mode] = { raw: !playsDocument(), inRoomFoot: !!document.getElementById('playBtn').closest('#roomFoot') };
    }
    return out;
  });

  // Browse auditions the bare sound — a click there is a question about the
  // file, and answering it through last week's stretch answers a different one.
  expect(got.overview.raw, 'Browse should audition raw').toBe(true);
  // Edit and Room are both looking at the document.
  expect(got.edit.raw, 'Edit should play the document').toBe(false);
  expect(got.room.raw, 'the room played the bare file instead of the document').toBe(false);
  // And it really is the room's own transport being pressed.
  expect(got.room.inRoomFoot).toBe(true);

  // End to end: the engine is loaded as the document when the room's transport
  // is used, not as an audition.
  const live = await page.evaluate(async () => {
    setMode('room');
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('playBtn').click();
    await new Promise((r) => setTimeout(r, 1200));
    const st = await api('/api/engine/state');
    document.getElementById('playBtn').click();
    return { engineRaw: engine.raw, playing: st.playing };
  });
  expect(live.playing).toBe(true);
  expect(live.engineRaw, 'the engine was loaded as a raw audition').toBe(false);
});
