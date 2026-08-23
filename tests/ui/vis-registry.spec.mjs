// Every visualiser, in one list and behind one picker.
//
// See `docs/PORT-PLAN.md`. Phase 0 does not change how anything draws — it
// changes how everything is *reached*. So what is worth testing is not pictures:
//
//   - the list knows about all fourteen, and the picker offers all fourteen,
//   - choosing any one of them puts the right host on the stage,
//   - and **the editor comes back exactly as it was**, which is the half that
//     was missed and the half that blanked the visual panel.

import { test, expect } from '@playwright/test';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof setVisual === 'function' && typeof VIS_ALL !== 'undefined',
    { timeout: 30_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForTimeout(600);
}

/// The shape of the editor, as a thing that can be compared before and after.
const SHAPE = `(() => {
  const mb = document.getElementById('masterBus').getBoundingClientRect();
  const cell = document.querySelector('.mb-cell-3d').getBoundingClientRect();
  const gv = document.getElementById('grainVis');
  return {
    masterBusH: Math.round(mb.height),
    cellH: Math.round(cell.height),
    grainHidden: gv.classList.contains('hidden'),
    grainParent: gv.parentElement.id || gv.parentElement.className,
  };
})`;

test('the list knows about every visualiser', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(() => ({
    all: VIS_ALL.map((v) => v.key),
    families: VIS_FAMILIES.map((f) => f.key),
    engines: visPortRemaining(),
    // Nothing may be listed twice, and every one needs a family that exists.
    dupes: VIS_ALL.map((v) => v.key).filter((k, i, a) => a.indexOf(k) !== i),
    orphans: VIS_ALL.filter((v) => !VIS_FAMILIES.some((f) => f.key === v.family)).map((v) => v.key),
  }));

  expect(got.dupes, 'a visual is listed twice').toEqual([]);
  expect(got.orphans, 'a visual is in a family that does not exist').toEqual([]);
  expect(got.families).toEqual(['bus', 'grain']);
  // Three on the bus and eleven grain views: the count is written down so that
  // adding one without adding it to the picker is a failure and not a surprise.
  expect(got.all.length).toBe(14);

  // **The state of the port, as a number.** When a phase of the plan lands this
  // changes, and it changing without the plan changing is worth being told.
  const total = Object.values(got.engines).reduce((a, b) => a + b, 0);
  expect(total).toBe(14);
});

test('the picker offers all of them, grouped', async ({ page }) => {
  await open(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(600);
  const got = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('#rgModules [data-visual]')].map((b) => b.dataset.visual),
    headings: [...document.querySelectorAll('#rgModules .vis-fam')].map((e) => e.textContent),
    all: VIS_ALL.map((v) => v.key),
  }));
  expect(got.buttons, 'the picker and the list disagree').toEqual(got.all);
  expect(got.headings.length, 'the families are not labelled').toBe(2);
});

test('choosing any visual puts its own host on the stage', async ({ page }) => {
  await open(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(600);

  const keys = await page.evaluate(() => VIS_ALL.map((v) => v.key));
  const bad = [];
  for (const key of keys) {
    await page.evaluate((k) => setVisual(k), key);
    await page.waitForTimeout(220);
    const r = await page.evaluate(() => {
      const v = visEntry(visualKey());
      const want = v.family === 'bus' ? 'masterBus' : 'grainVis';
      const host = document.getElementById(want);
      const box = host.getBoundingClientRect();
      return {
        key: v.key,
        onStage: host.parentElement.id === 'roomStageRoom',
        big: box.width > 50 && box.height > 50,
        active: document.querySelector('#rgModules .re-btn.active')?.dataset.visual,
      };
    });
    if (!r.onStage || !r.big || r.active !== r.key) bad.push(r);
  }
  expect(bad, 'a visual did not reach the stage').toEqual([]);
});

test('the editor comes back exactly as it was', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(`${SHAPE}()`);

  // In, through a grain view — the one that borrows the *other* host — then a
  // bus one, then out.
  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(500);
  await page.evaluate(() => setVisual('v2-tunnel'));
  await page.waitForTimeout(500);
  await page.evaluate(() => setVisual('room3d'));
  await page.waitForTimeout(500);
  await page.evaluate(() => setMode('edit'));
  await page.waitForTimeout(700);

  const after = await page.evaluate(`${SHAPE}()`);

  // **This is the test that was missing.** Phase 0 shipped without it and
  // collapsed the editor's visual panel: `#grainVis` carries `hidden` in the
  // markup, and the dock's stylesheet reads that class —
  //
  //     .tray-right > .grain-vis.hidden + .master-bus { flex: 1 1 auto; }
  //
  // — so the master bus is only given its size *while the grain views are
  // hidden*. Borrowing them onto the room's stage and stripping `hidden` to show
  // them resized something in a workspace nobody was looking at, and left it
  // resized, because nothing put the class back.
  //
  // A class that only means "not on screen" is safe to toggle. This one is also
  // somebody else's selector, and the name does not say which.
  expect(after, 'the editor did not come back the way it was').toEqual(before);
  expect(after.masterBusH, 'the master bus collapsed').toBeGreaterThan(100);
  expect(after.grainHidden, 'the grain views were left showing in the dock').toBe(true);
});
